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

(()=>{var gh=Object.create;var Ll=Object.defineProperty;var xh=Object.getOwnPropertyDescriptor;var vh=Object.getOwnPropertyNames;var _h=Object.getPrototypeOf,yh=Object.prototype.hasOwnProperty;var Sh=(s,e)=>()=>(e||s((e={exports:{}}).exports,e),e.exports);var Mh=(s,e,t,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let i of vh(e))!yh.call(s,i)&&i!==t&&Ll(s,i,{get:()=>e[i],enumerable:!(n=xh(e,i))||n.enumerable});return s};var bh=(s,e,t)=>(t=s!=null?gh(_h(s)):{},Mh(e||!s||!s.__esModule?Ll(t,"default",{value:s,enumerable:!0}):t,s));var ph=Sh((Gs,Pl)=>{(function(e,t){typeof Gs=="object"&&typeof Pl=="object"?Pl.exports=t():typeof define=="function"&&define.amd?define("Matter",[],t):typeof Gs=="object"?Gs.Matter=t():e.Matter=t()})(Gs,function(){return function(s){var e={};function t(n){if(e[n])return e[n].exports;var i=e[n]={i:n,l:!1,exports:{}};return s[n].call(i.exports,i,i.exports,t),i.l=!0,i.exports}return t.m=s,t.c=e,t.d=function(n,i,r){t.o(n,i)||Object.defineProperty(n,i,{enumerable:!0,get:r})},t.r=function(n){typeof Symbol<"u"&&Symbol.toStringTag&&Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(n,"__esModule",{value:!0})},t.t=function(n,i){if(i&1&&(n=t(n)),i&8||i&4&&typeof n=="object"&&n&&n.__esModule)return n;var r=Object.create(null);if(t.r(r),Object.defineProperty(r,"default",{enumerable:!0,value:n}),i&2&&typeof n!="string")for(var a in n)t.d(r,a,(function(c){return n[c]}).bind(null,a));return r},t.n=function(n){var i=n&&n.__esModule?function(){return n.default}:function(){return n};return t.d(i,"a",i),i},t.o=function(n,i){return Object.prototype.hasOwnProperty.call(n,i)},t.p="",t(t.s=20)}([function(s,e){var t={};s.exports=t,function(){t._baseDelta=1e3/60,t._nextId=0,t._seed=0,t._nowStartTime=+new Date,t._warnedOnce={},t._decomp=null,t.extend=function(i,r){var a,c,l;typeof r=="boolean"?(a=2,l=r):(a=1,l=!0);for(var u=a;u<arguments.length;u++){var d=arguments[u];if(d)for(var o in d)l&&d[o]&&d[o].constructor===Object&&(!i[o]||i[o].constructor===Object)?(i[o]=i[o]||{},t.extend(i[o],l,d[o])):i[o]=d[o]}return i},t.clone=function(i,r){return t.extend({},r,i)},t.keys=function(i){if(Object.keys)return Object.keys(i);var r=[];for(var a in i)r.push(a);return r},t.values=function(i){var r=[];if(Object.keys){for(var a=Object.keys(i),c=0;c<a.length;c++)r.push(i[a[c]]);return r}for(var l in i)r.push(i[l]);return r},t.get=function(i,r,a,c){r=r.split(".").slice(a,c);for(var l=0;l<r.length;l+=1)i=i[r[l]];return i},t.set=function(i,r,a,c,l){var u=r.split(".").slice(c,l);return t.get(i,r,0,-1)[u[u.length-1]]=a,a},t.shuffle=function(i){for(var r=i.length-1;r>0;r--){var a=Math.floor(t.random()*(r+1)),c=i[r];i[r]=i[a],i[a]=c}return i},t.choose=function(i){return i[Math.floor(t.random()*i.length)]},t.isElement=function(i){return typeof HTMLElement<"u"?i instanceof HTMLElement:!!(i&&i.nodeType&&i.nodeName)},t.isArray=function(i){return Object.prototype.toString.call(i)==="[object Array]"},t.isFunction=function(i){return typeof i=="function"},t.isPlainObject=function(i){return typeof i=="object"&&i.constructor===Object},t.isString=function(i){return toString.call(i)==="[object String]"},t.clamp=function(i,r,a){return i<r?r:i>a?a:i},t.sign=function(i){return i<0?-1:1},t.now=function(){if(typeof window<"u"&&window.performance){if(window.performance.now)return window.performance.now();if(window.performance.webkitNow)return window.performance.webkitNow()}return Date.now?Date.now():new Date-t._nowStartTime},t.random=function(i,r){return i=typeof i<"u"?i:0,r=typeof r<"u"?r:1,i+n()*(r-i)};var n=function(){return t._seed=(t._seed*9301+49297)%233280,t._seed/233280};t.colorToNumber=function(i){return i=i.replace("#",""),i.length==3&&(i=i.charAt(0)+i.charAt(0)+i.charAt(1)+i.charAt(1)+i.charAt(2)+i.charAt(2)),parseInt(i,16)},t.logLevel=1,t.log=function(){console&&t.logLevel>0&&t.logLevel<=3&&console.log.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},t.info=function(){console&&t.logLevel>0&&t.logLevel<=2&&console.info.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},t.warn=function(){console&&t.logLevel>0&&t.logLevel<=3&&console.warn.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},t.warnOnce=function(){var i=Array.prototype.slice.call(arguments).join(" ");t._warnedOnce[i]||(t.warn(i),t._warnedOnce[i]=!0)},t.deprecated=function(i,r,a){i[r]=t.chain(function(){t.warnOnce("\u{1F505} deprecated \u{1F505}",a)},i[r])},t.nextId=function(){return t._nextId++},t.indexOf=function(i,r){if(i.indexOf)return i.indexOf(r);for(var a=0;a<i.length;a++)if(i[a]===r)return a;return-1},t.map=function(i,r){if(i.map)return i.map(r);for(var a=[],c=0;c<i.length;c+=1)a.push(r(i[c]));return a},t.topologicalSort=function(i){var r=[],a=[],c=[];for(var l in i)!a[l]&&!c[l]&&t._topologicalSort(l,a,c,i,r);return r},t._topologicalSort=function(i,r,a,c,l){var u=c[i]||[];a[i]=!0;for(var d=0;d<u.length;d+=1){var o=u[d];a[o]||r[o]||t._topologicalSort(o,r,a,c,l)}a[i]=!1,r[i]=!0,l.push(i)},t.chain=function(){for(var i=[],r=0;r<arguments.length;r+=1){var a=arguments[r];a._chained?i.push.apply(i,a._chained):i.push(a)}var c=function(){for(var l,u=new Array(arguments.length),d=0,o=arguments.length;d<o;d++)u[d]=arguments[d];for(d=0;d<i.length;d+=1){var h=i[d].apply(l,u);typeof h<"u"&&(l=h)}return l};return c._chained=i,c},t.chainPathBefore=function(i,r,a){return t.set(i,r,t.chain(a,t.get(i,r)))},t.chainPathAfter=function(i,r,a){return t.set(i,r,t.chain(t.get(i,r),a))},t.setDecomp=function(i){t._decomp=i},t.getDecomp=function(){var i=t._decomp;try{!i&&typeof window<"u"&&(i=window.decomp),!i&&typeof global<"u"&&(i=global.decomp)}catch{i=null}return i}}()},function(s,e){var t={};s.exports=t,function(){t.create=function(n){var i={min:{x:0,y:0},max:{x:0,y:0}};return n&&t.update(i,n),i},t.update=function(n,i,r){n.min.x=1/0,n.max.x=-1/0,n.min.y=1/0,n.max.y=-1/0;for(var a=0;a<i.length;a++){var c=i[a];c.x>n.max.x&&(n.max.x=c.x),c.x<n.min.x&&(n.min.x=c.x),c.y>n.max.y&&(n.max.y=c.y),c.y<n.min.y&&(n.min.y=c.y)}r&&(r.x>0?n.max.x+=r.x:n.min.x+=r.x,r.y>0?n.max.y+=r.y:n.min.y+=r.y)},t.contains=function(n,i){return i.x>=n.min.x&&i.x<=n.max.x&&i.y>=n.min.y&&i.y<=n.max.y},t.overlaps=function(n,i){return n.min.x<=i.max.x&&n.max.x>=i.min.x&&n.max.y>=i.min.y&&n.min.y<=i.max.y},t.translate=function(n,i){n.min.x+=i.x,n.max.x+=i.x,n.min.y+=i.y,n.max.y+=i.y},t.shift=function(n,i){var r=n.max.x-n.min.x,a=n.max.y-n.min.y;n.min.x=i.x,n.max.x=i.x+r,n.min.y=i.y,n.max.y=i.y+a}}()},function(s,e){var t={};s.exports=t,function(){t.create=function(n,i){return{x:n||0,y:i||0}},t.clone=function(n){return{x:n.x,y:n.y}},t.magnitude=function(n){return Math.sqrt(n.x*n.x+n.y*n.y)},t.magnitudeSquared=function(n){return n.x*n.x+n.y*n.y},t.rotate=function(n,i,r){var a=Math.cos(i),c=Math.sin(i);r||(r={});var l=n.x*a-n.y*c;return r.y=n.x*c+n.y*a,r.x=l,r},t.rotateAbout=function(n,i,r,a){var c=Math.cos(i),l=Math.sin(i);a||(a={});var u=r.x+((n.x-r.x)*c-(n.y-r.y)*l);return a.y=r.y+((n.x-r.x)*l+(n.y-r.y)*c),a.x=u,a},t.normalise=function(n){var i=t.magnitude(n);return i===0?{x:0,y:0}:{x:n.x/i,y:n.y/i}},t.dot=function(n,i){return n.x*i.x+n.y*i.y},t.cross=function(n,i){return n.x*i.y-n.y*i.x},t.cross3=function(n,i,r){return(i.x-n.x)*(r.y-n.y)-(i.y-n.y)*(r.x-n.x)},t.add=function(n,i,r){return r||(r={}),r.x=n.x+i.x,r.y=n.y+i.y,r},t.sub=function(n,i,r){return r||(r={}),r.x=n.x-i.x,r.y=n.y-i.y,r},t.mult=function(n,i){return{x:n.x*i,y:n.y*i}},t.div=function(n,i){return{x:n.x/i,y:n.y/i}},t.perp=function(n,i){return i=i===!0?-1:1,{x:i*-n.y,y:i*n.x}},t.neg=function(n){return{x:-n.x,y:-n.y}},t.angle=function(n,i){return Math.atan2(i.y-n.y,i.x-n.x)},t._temp=[t.create(),t.create(),t.create(),t.create(),t.create(),t.create()]}()},function(s,e,t){var n={};s.exports=n;var i=t(2),r=t(0);(function(){n.create=function(a,c){for(var l=[],u=0;u<a.length;u++){var d=a[u],o={x:d.x,y:d.y,index:u,body:c,isInternal:!1};l.push(o)}return l},n.fromPath=function(a,c){var l=/L?\s*([-\d.e]+)[\s,]*([-\d.e]+)*/ig,u=[];return a.replace(l,function(d,o,h){u.push({x:parseFloat(o),y:parseFloat(h)})}),n.create(u,c)},n.centre=function(a){for(var c=n.area(a,!0),l={x:0,y:0},u,d,o,h=0;h<a.length;h++)o=(h+1)%a.length,u=i.cross(a[h],a[o]),d=i.mult(i.add(a[h],a[o]),u),l=i.add(l,d);return i.div(l,6*c)},n.mean=function(a){for(var c={x:0,y:0},l=0;l<a.length;l++)c.x+=a[l].x,c.y+=a[l].y;return i.div(c,a.length)},n.area=function(a,c){for(var l=0,u=a.length-1,d=0;d<a.length;d++)l+=(a[u].x-a[d].x)*(a[u].y+a[d].y),u=d;return c?l/2:Math.abs(l)/2},n.inertia=function(a,c){for(var l=0,u=0,d=a,o,h,f=0;f<d.length;f++)h=(f+1)%d.length,o=Math.abs(i.cross(d[h],d[f])),l+=o*(i.dot(d[h],d[h])+i.dot(d[h],d[f])+i.dot(d[f],d[f])),u+=o;return c/6*(l/u)},n.translate=function(a,c,l){l=typeof l<"u"?l:1;var u=a.length,d=c.x*l,o=c.y*l,h;for(h=0;h<u;h++)a[h].x+=d,a[h].y+=o;return a},n.rotate=function(a,c,l){if(c!==0){var u=Math.cos(c),d=Math.sin(c),o=l.x,h=l.y,f=a.length,p,v,g,m;for(m=0;m<f;m++)p=a[m],v=p.x-o,g=p.y-h,p.x=o+(v*u-g*d),p.y=h+(v*d+g*u);return a}},n.contains=function(a,c){for(var l=c.x,u=c.y,d=a.length,o=a[d-1],h,f=0;f<d;f++){if(h=a[f],(l-o.x)*(h.y-o.y)+(u-o.y)*(o.x-h.x)>0)return!1;o=h}return!0},n.scale=function(a,c,l,u){if(c===1&&l===1)return a;u=u||n.centre(a);for(var d,o,h=0;h<a.length;h++)d=a[h],o=i.sub(d,u),a[h].x=u.x+o.x*c,a[h].y=u.y+o.y*l;return a},n.chamfer=function(a,c,l,u,d){typeof c=="number"?c=[c]:c=c||[8],l=typeof l<"u"?l:-1,u=u||2,d=d||14;for(var o=[],h=0;h<a.length;h++){var f=a[h-1>=0?h-1:a.length-1],p=a[h],v=a[(h+1)%a.length],g=c[h<c.length?h:c.length-1];if(g===0){o.push(p);continue}var m=i.normalise({x:p.y-f.y,y:f.x-p.x}),M=i.normalise({x:v.y-p.y,y:p.x-v.x}),x=Math.sqrt(2*Math.pow(g,2)),S=i.mult(r.clone(m),g),w=i.normalise(i.mult(i.add(m,M),.5)),y=i.sub(p,i.mult(w,x)),E=l;l===-1&&(E=Math.pow(g,.32)*1.75),E=r.clamp(E,u,d),E%2===1&&(E+=1);for(var _=Math.acos(i.dot(m,M)),b=_/E,R=0;R<E;R++)o.push(i.add(i.rotate(S,b*R),y))}return o},n.clockwiseSort=function(a){var c=n.mean(a);return a.sort(function(l,u){return i.angle(c,l)-i.angle(c,u)}),a},n.isConvex=function(a){var c=0,l=a.length,u,d,o,h;if(l<3)return null;for(u=0;u<l;u++)if(d=(u+1)%l,o=(u+2)%l,h=(a[d].x-a[u].x)*(a[o].y-a[d].y),h-=(a[d].y-a[u].y)*(a[o].x-a[d].x),h<0?c|=1:h>0&&(c|=2),c===3)return!1;return c!==0?!0:null},n.hull=function(a){var c=[],l=[],u,d;for(a=a.slice(0),a.sort(function(o,h){var f=o.x-h.x;return f!==0?f:o.y-h.y}),d=0;d<a.length;d+=1){for(u=a[d];l.length>=2&&i.cross3(l[l.length-2],l[l.length-1],u)<=0;)l.pop();l.push(u)}for(d=a.length-1;d>=0;d-=1){for(u=a[d];c.length>=2&&i.cross3(c[c.length-2],c[c.length-1],u)<=0;)c.pop();c.push(u)}return c.pop(),l.pop(),c.concat(l)}})()},function(s,e,t){var n={};s.exports=n;var i=t(3),r=t(2),a=t(7),c=t(0),l=t(1),u=t(11);(function(){n._timeCorrection=!0,n._inertiaScale=4,n._nextCollidingGroupId=1,n._nextNonCollidingGroupId=-1,n._nextCategory=1,n._baseDelta=1e3/60,n.create=function(o){var h={id:c.nextId(),type:"body",label:"Body",parts:[],plugin:{},angle:0,vertices:i.fromPath("L 0 0 L 40 0 L 40 40 L 0 40"),position:{x:0,y:0},force:{x:0,y:0},torque:0,positionImpulse:{x:0,y:0},constraintImpulse:{x:0,y:0,angle:0},totalContacts:0,speed:0,angularSpeed:0,velocity:{x:0,y:0},angularVelocity:0,isSensor:!1,isStatic:!1,isSleeping:!1,motion:0,sleepThreshold:60,density:.001,restitution:0,friction:.1,frictionStatic:.5,frictionAir:.01,collisionFilter:{category:1,mask:4294967295,group:0},slop:.05,timeScale:1,render:{visible:!0,opacity:1,strokeStyle:null,fillStyle:null,lineWidth:null,sprite:{xScale:1,yScale:1,xOffset:0,yOffset:0}},events:null,bounds:null,chamfer:null,circleRadius:0,positionPrev:null,anglePrev:0,parent:null,axes:null,area:0,mass:0,inertia:0,deltaTime:16.666666666666668,_original:null},f=c.extend(h,o);return d(f,o),f},n.nextGroup=function(o){return o?n._nextNonCollidingGroupId--:n._nextCollidingGroupId++},n.nextCategory=function(){return n._nextCategory=n._nextCategory<<1,n._nextCategory};var d=function(o,h){h=h||{},n.set(o,{bounds:o.bounds||l.create(o.vertices),positionPrev:o.positionPrev||r.clone(o.position),anglePrev:o.anglePrev||o.angle,vertices:o.vertices,parts:o.parts||[o],isStatic:o.isStatic,isSleeping:o.isSleeping,parent:o.parent||o}),i.rotate(o.vertices,o.angle,o.position),u.rotate(o.axes,o.angle),l.update(o.bounds,o.vertices,o.velocity),n.set(o,{axes:h.axes||o.axes,area:h.area||o.area,mass:h.mass||o.mass,inertia:h.inertia||o.inertia});var f=o.isStatic?"#14151f":c.choose(["#f19648","#f5d259","#f55a3c","#063e7b","#ececd1"]),p=o.isStatic?"#555":"#ccc",v=o.isStatic&&o.render.fillStyle===null?1:0;o.render.fillStyle=o.render.fillStyle||f,o.render.strokeStyle=o.render.strokeStyle||p,o.render.lineWidth=o.render.lineWidth||v,o.render.sprite.xOffset+=-(o.bounds.min.x-o.position.x)/(o.bounds.max.x-o.bounds.min.x),o.render.sprite.yOffset+=-(o.bounds.min.y-o.position.y)/(o.bounds.max.y-o.bounds.min.y)};n.set=function(o,h,f){var p;typeof h=="string"&&(p=h,h={},h[p]=f);for(p in h)if(Object.prototype.hasOwnProperty.call(h,p))switch(f=h[p],p){case"isStatic":n.setStatic(o,f);break;case"isSleeping":a.set(o,f);break;case"mass":n.setMass(o,f);break;case"density":n.setDensity(o,f);break;case"inertia":n.setInertia(o,f);break;case"vertices":n.setVertices(o,f);break;case"position":n.setPosition(o,f);break;case"angle":n.setAngle(o,f);break;case"velocity":n.setVelocity(o,f);break;case"angularVelocity":n.setAngularVelocity(o,f);break;case"speed":n.setSpeed(o,f);break;case"angularSpeed":n.setAngularSpeed(o,f);break;case"parts":n.setParts(o,f);break;case"centre":n.setCentre(o,f);break;default:o[p]=f}},n.setStatic=function(o,h){for(var f=0;f<o.parts.length;f++){var p=o.parts[f];h?(p.isStatic||(p._original={restitution:p.restitution,friction:p.friction,mass:p.mass,inertia:p.inertia,density:p.density,inverseMass:p.inverseMass,inverseInertia:p.inverseInertia}),p.restitution=0,p.friction=1,p.mass=p.inertia=p.density=1/0,p.inverseMass=p.inverseInertia=0,p.positionPrev.x=p.position.x,p.positionPrev.y=p.position.y,p.anglePrev=p.angle,p.angularVelocity=0,p.speed=0,p.angularSpeed=0,p.motion=0):p._original&&(p.restitution=p._original.restitution,p.friction=p._original.friction,p.mass=p._original.mass,p.inertia=p._original.inertia,p.density=p._original.density,p.inverseMass=p._original.inverseMass,p.inverseInertia=p._original.inverseInertia,p._original=null),p.isStatic=h}},n.setMass=function(o,h){var f=o.inertia/(o.mass/6);o.inertia=f*(h/6),o.inverseInertia=1/o.inertia,o.mass=h,o.inverseMass=1/o.mass,o.density=o.mass/o.area},n.setDensity=function(o,h){n.setMass(o,h*o.area),o.density=h},n.setInertia=function(o,h){o.inertia=h,o.inverseInertia=1/o.inertia},n.setVertices=function(o,h){h[0].body===o?o.vertices=h:o.vertices=i.create(h,o),o.axes=u.fromVertices(o.vertices),o.area=i.area(o.vertices),n.setMass(o,o.density*o.area);var f=i.centre(o.vertices);i.translate(o.vertices,f,-1),n.setInertia(o,n._inertiaScale*i.inertia(o.vertices,o.mass)),i.translate(o.vertices,o.position),l.update(o.bounds,o.vertices,o.velocity)},n.setParts=function(o,h,f){var p;for(h=h.slice(0),o.parts.length=0,o.parts.push(o),o.parent=o,p=0;p<h.length;p++){var v=h[p];v!==o&&(v.parent=o,o.parts.push(v))}if(o.parts.length!==1){if(f=typeof f<"u"?f:!0,f){var g=[];for(p=0;p<h.length;p++)g=g.concat(h[p].vertices);i.clockwiseSort(g);var m=i.hull(g),M=i.centre(m);n.setVertices(o,m),i.translate(o.vertices,M)}var x=n._totalProperties(o);o.area=x.area,o.parent=o,o.position.x=x.centre.x,o.position.y=x.centre.y,o.positionPrev.x=x.centre.x,o.positionPrev.y=x.centre.y,n.setMass(o,x.mass),n.setInertia(o,x.inertia),n.setPosition(o,x.centre)}},n.setCentre=function(o,h,f){f?(o.positionPrev.x+=h.x,o.positionPrev.y+=h.y,o.position.x+=h.x,o.position.y+=h.y):(o.positionPrev.x=h.x-(o.position.x-o.positionPrev.x),o.positionPrev.y=h.y-(o.position.y-o.positionPrev.y),o.position.x=h.x,o.position.y=h.y)},n.setPosition=function(o,h,f){var p=r.sub(h,o.position);f?(o.positionPrev.x=o.position.x,o.positionPrev.y=o.position.y,o.velocity.x=p.x,o.velocity.y=p.y,o.speed=r.magnitude(p)):(o.positionPrev.x+=p.x,o.positionPrev.y+=p.y);for(var v=0;v<o.parts.length;v++){var g=o.parts[v];g.position.x+=p.x,g.position.y+=p.y,i.translate(g.vertices,p),l.update(g.bounds,g.vertices,o.velocity)}},n.setAngle=function(o,h,f){var p=h-o.angle;f?(o.anglePrev=o.angle,o.angularVelocity=p,o.angularSpeed=Math.abs(p)):o.anglePrev+=p;for(var v=0;v<o.parts.length;v++){var g=o.parts[v];g.angle+=p,i.rotate(g.vertices,p,o.position),u.rotate(g.axes,p),l.update(g.bounds,g.vertices,o.velocity),v>0&&r.rotateAbout(g.position,p,o.position,g.position)}},n.setVelocity=function(o,h){var f=o.deltaTime/n._baseDelta;o.positionPrev.x=o.position.x-h.x*f,o.positionPrev.y=o.position.y-h.y*f,o.velocity.x=(o.position.x-o.positionPrev.x)/f,o.velocity.y=(o.position.y-o.positionPrev.y)/f,o.speed=r.magnitude(o.velocity)},n.getVelocity=function(o){var h=n._baseDelta/o.deltaTime;return{x:(o.position.x-o.positionPrev.x)*h,y:(o.position.y-o.positionPrev.y)*h}},n.getSpeed=function(o){return r.magnitude(n.getVelocity(o))},n.setSpeed=function(o,h){n.setVelocity(o,r.mult(r.normalise(n.getVelocity(o)),h))},n.setAngularVelocity=function(o,h){var f=o.deltaTime/n._baseDelta;o.anglePrev=o.angle-h*f,o.angularVelocity=(o.angle-o.anglePrev)/f,o.angularSpeed=Math.abs(o.angularVelocity)},n.getAngularVelocity=function(o){return(o.angle-o.anglePrev)*n._baseDelta/o.deltaTime},n.getAngularSpeed=function(o){return Math.abs(n.getAngularVelocity(o))},n.setAngularSpeed=function(o,h){n.setAngularVelocity(o,c.sign(n.getAngularVelocity(o))*h)},n.translate=function(o,h,f){n.setPosition(o,r.add(o.position,h),f)},n.rotate=function(o,h,f,p){if(!f)n.setAngle(o,o.angle+h,p);else{var v=Math.cos(h),g=Math.sin(h),m=o.position.x-f.x,M=o.position.y-f.y;n.setPosition(o,{x:f.x+(m*v-M*g),y:f.y+(m*g+M*v)},p),n.setAngle(o,o.angle+h,p)}},n.scale=function(o,h,f,p){var v=0,g=0;p=p||o.position;for(var m=0;m<o.parts.length;m++){var M=o.parts[m];i.scale(M.vertices,h,f,p),M.axes=u.fromVertices(M.vertices),M.area=i.area(M.vertices),n.setMass(M,o.density*M.area),i.translate(M.vertices,{x:-M.position.x,y:-M.position.y}),n.setInertia(M,n._inertiaScale*i.inertia(M.vertices,M.mass)),i.translate(M.vertices,{x:M.position.x,y:M.position.y}),m>0&&(v+=M.area,g+=M.inertia),M.position.x=p.x+(M.position.x-p.x)*h,M.position.y=p.y+(M.position.y-p.y)*f,l.update(M.bounds,M.vertices,o.velocity)}o.parts.length>1&&(o.area=v,o.isStatic||(n.setMass(o,o.density*v),n.setInertia(o,g))),o.circleRadius&&(h===f?o.circleRadius*=h:o.circleRadius=null)},n.update=function(o,h){h=(typeof h<"u"?h:1e3/60)*o.timeScale;var f=h*h,p=n._timeCorrection?h/(o.deltaTime||h):1,v=1-o.frictionAir*(h/c._baseDelta),g=(o.position.x-o.positionPrev.x)*p,m=(o.position.y-o.positionPrev.y)*p;o.velocity.x=g*v+o.force.x/o.mass*f,o.velocity.y=m*v+o.force.y/o.mass*f,o.positionPrev.x=o.position.x,o.positionPrev.y=o.position.y,o.position.x+=o.velocity.x,o.position.y+=o.velocity.y,o.deltaTime=h,o.angularVelocity=(o.angle-o.anglePrev)*v*p+o.torque/o.inertia*f,o.anglePrev=o.angle,o.angle+=o.angularVelocity;for(var M=0;M<o.parts.length;M++){var x=o.parts[M];i.translate(x.vertices,o.velocity),M>0&&(x.position.x+=o.velocity.x,x.position.y+=o.velocity.y),o.angularVelocity!==0&&(i.rotate(x.vertices,o.angularVelocity,o.position),u.rotate(x.axes,o.angularVelocity),M>0&&r.rotateAbout(x.position,o.angularVelocity,o.position,x.position)),l.update(x.bounds,x.vertices,o.velocity)}},n.updateVelocities=function(o){var h=n._baseDelta/o.deltaTime,f=o.velocity;f.x=(o.position.x-o.positionPrev.x)*h,f.y=(o.position.y-o.positionPrev.y)*h,o.speed=Math.sqrt(f.x*f.x+f.y*f.y),o.angularVelocity=(o.angle-o.anglePrev)*h,o.angularSpeed=Math.abs(o.angularVelocity)},n.applyForce=function(o,h,f){var p={x:h.x-o.position.x,y:h.y-o.position.y};o.force.x+=f.x,o.force.y+=f.y,o.torque+=p.x*f.y-p.y*f.x},n._totalProperties=function(o){for(var h={mass:0,area:0,inertia:0,centre:{x:0,y:0}},f=o.parts.length===1?0:1;f<o.parts.length;f++){var p=o.parts[f],v=p.mass!==1/0?p.mass:1;h.mass+=v,h.area+=p.area,h.inertia+=p.inertia,h.centre=r.add(h.centre,r.mult(p.position,v))}return h.centre=r.div(h.centre,h.mass),h}})()},function(s,e,t){var n={};s.exports=n;var i=t(0);(function(){n.on=function(r,a,c){for(var l=a.split(" "),u,d=0;d<l.length;d++)u=l[d],r.events=r.events||{},r.events[u]=r.events[u]||[],r.events[u].push(c);return c},n.off=function(r,a,c){if(!a){r.events={};return}typeof a=="function"&&(c=a,a=i.keys(r.events).join(" "));for(var l=a.split(" "),u=0;u<l.length;u++){var d=r.events[l[u]],o=[];if(c&&d)for(var h=0;h<d.length;h++)d[h]!==c&&o.push(d[h]);r.events[l[u]]=o}},n.trigger=function(r,a,c){var l,u,d,o,h=r.events;if(h&&i.keys(h).length>0){c||(c={}),l=a.split(" ");for(var f=0;f<l.length;f++)if(u=l[f],d=h[u],d){o=i.clone(c,!1),o.name=u,o.source=r;for(var p=0;p<d.length;p++)d[p].apply(r,[o])}}}})()},function(s,e,t){var n={};s.exports=n;var i=t(5),r=t(0),a=t(1),c=t(4);(function(){n.create=function(l){return r.extend({id:r.nextId(),type:"composite",parent:null,isModified:!1,bodies:[],constraints:[],composites:[],label:"Composite",plugin:{},cache:{allBodies:null,allConstraints:null,allComposites:null}},l)},n.setModified=function(l,u,d,o){if(l.isModified=u,u&&l.cache&&(l.cache.allBodies=null,l.cache.allConstraints=null,l.cache.allComposites=null),d&&l.parent&&n.setModified(l.parent,u,d,o),o)for(var h=0;h<l.composites.length;h++){var f=l.composites[h];n.setModified(f,u,d,o)}},n.add=function(l,u){var d=[].concat(u);i.trigger(l,"beforeAdd",{object:u});for(var o=0;o<d.length;o++){var h=d[o];switch(h.type){case"body":if(h.parent!==h){r.warn("Composite.add: skipped adding a compound body part (you must add its parent instead)");break}n.addBody(l,h);break;case"constraint":n.addConstraint(l,h);break;case"composite":n.addComposite(l,h);break;case"mouseConstraint":n.addConstraint(l,h.constraint);break}}return i.trigger(l,"afterAdd",{object:u}),l},n.remove=function(l,u,d){var o=[].concat(u);i.trigger(l,"beforeRemove",{object:u});for(var h=0;h<o.length;h++){var f=o[h];switch(f.type){case"body":n.removeBody(l,f,d);break;case"constraint":n.removeConstraint(l,f,d);break;case"composite":n.removeComposite(l,f,d);break;case"mouseConstraint":n.removeConstraint(l,f.constraint);break}}return i.trigger(l,"afterRemove",{object:u}),l},n.addComposite=function(l,u){return l.composites.push(u),u.parent=l,n.setModified(l,!0,!0,!1),l},n.removeComposite=function(l,u,d){var o=r.indexOf(l.composites,u);if(o!==-1){var h=n.allBodies(u);n.removeCompositeAt(l,o);for(var f=0;f<h.length;f++)h[f].sleepCounter=0}if(d)for(var f=0;f<l.composites.length;f++)n.removeComposite(l.composites[f],u,!0);return l},n.removeCompositeAt=function(l,u){return l.composites.splice(u,1),n.setModified(l,!0,!0,!1),l},n.addBody=function(l,u){return l.bodies.push(u),n.setModified(l,!0,!0,!1),l},n.removeBody=function(l,u,d){var o=r.indexOf(l.bodies,u);if(o!==-1&&(n.removeBodyAt(l,o),u.sleepCounter=0),d)for(var h=0;h<l.composites.length;h++)n.removeBody(l.composites[h],u,!0);return l},n.removeBodyAt=function(l,u){return l.bodies.splice(u,1),n.setModified(l,!0,!0,!1),l},n.addConstraint=function(l,u){return l.constraints.push(u),n.setModified(l,!0,!0,!1),l},n.removeConstraint=function(l,u,d){var o=r.indexOf(l.constraints,u);if(o!==-1&&n.removeConstraintAt(l,o),d)for(var h=0;h<l.composites.length;h++)n.removeConstraint(l.composites[h],u,!0);return l},n.removeConstraintAt=function(l,u){return l.constraints.splice(u,1),n.setModified(l,!0,!0,!1),l},n.clear=function(l,u,d){if(d)for(var o=0;o<l.composites.length;o++)n.clear(l.composites[o],u,!0);return u?l.bodies=l.bodies.filter(function(h){return h.isStatic}):l.bodies.length=0,l.constraints.length=0,l.composites.length=0,n.setModified(l,!0,!0,!1),l},n.allBodies=function(l){if(l.cache&&l.cache.allBodies)return l.cache.allBodies;for(var u=[].concat(l.bodies),d=0;d<l.composites.length;d++)u=u.concat(n.allBodies(l.composites[d]));return l.cache&&(l.cache.allBodies=u),u},n.allConstraints=function(l){if(l.cache&&l.cache.allConstraints)return l.cache.allConstraints;for(var u=[].concat(l.constraints),d=0;d<l.composites.length;d++)u=u.concat(n.allConstraints(l.composites[d]));return l.cache&&(l.cache.allConstraints=u),u},n.allComposites=function(l){if(l.cache&&l.cache.allComposites)return l.cache.allComposites;for(var u=[].concat(l.composites),d=0;d<l.composites.length;d++)u=u.concat(n.allComposites(l.composites[d]));return l.cache&&(l.cache.allComposites=u),u},n.get=function(l,u,d){var o,h;switch(d){case"body":o=n.allBodies(l);break;case"constraint":o=n.allConstraints(l);break;case"composite":o=n.allComposites(l).concat(l);break}return o?(h=o.filter(function(f){return f.id.toString()===u.toString()}),h.length===0?null:h[0]):null},n.move=function(l,u,d){return n.remove(l,u),n.add(d,u),l},n.rebase=function(l){for(var u=n.allBodies(l).concat(n.allConstraints(l)).concat(n.allComposites(l)),d=0;d<u.length;d++)u[d].id=r.nextId();return l},n.translate=function(l,u,d){for(var o=d?n.allBodies(l):l.bodies,h=0;h<o.length;h++)c.translate(o[h],u);return l},n.rotate=function(l,u,d,o){for(var h=Math.cos(u),f=Math.sin(u),p=o?n.allBodies(l):l.bodies,v=0;v<p.length;v++){var g=p[v],m=g.position.x-d.x,M=g.position.y-d.y;c.setPosition(g,{x:d.x+(m*h-M*f),y:d.y+(m*f+M*h)}),c.rotate(g,u)}return l},n.scale=function(l,u,d,o,h){for(var f=h?n.allBodies(l):l.bodies,p=0;p<f.length;p++){var v=f[p],g=v.position.x-o.x,m=v.position.y-o.y;c.setPosition(v,{x:o.x+g*u,y:o.y+m*d}),c.scale(v,u,d)}return l},n.bounds=function(l){for(var u=n.allBodies(l),d=[],o=0;o<u.length;o+=1){var h=u[o];d.push(h.bounds.min,h.bounds.max)}return a.create(d)}})()},function(s,e,t){var n={};s.exports=n;var i=t(4),r=t(5),a=t(0);(function(){n._motionWakeThreshold=.18,n._motionSleepThreshold=.08,n._minBias=.9,n.update=function(c,l){for(var u=l/a._baseDelta,d=n._motionSleepThreshold,o=0;o<c.length;o++){var h=c[o],f=i.getSpeed(h),p=i.getAngularSpeed(h),v=f*f+p*p;if(h.force.x!==0||h.force.y!==0){n.set(h,!1);continue}var g=Math.min(h.motion,v),m=Math.max(h.motion,v);h.motion=n._minBias*g+(1-n._minBias)*m,h.sleepThreshold>0&&h.motion<d?(h.sleepCounter+=1,h.sleepCounter>=h.sleepThreshold/u&&n.set(h,!0)):h.sleepCounter>0&&(h.sleepCounter-=1)}},n.afterCollisions=function(c){for(var l=n._motionSleepThreshold,u=0;u<c.length;u++){var d=c[u];if(d.isActive){var o=d.collision,h=o.bodyA.parent,f=o.bodyB.parent;if(!(h.isSleeping&&f.isSleeping||h.isStatic||f.isStatic)&&(h.isSleeping||f.isSleeping)){var p=h.isSleeping&&!h.isStatic?h:f,v=p===h?f:h;!p.isStatic&&v.motion>l&&n.set(p,!1)}}}},n.set=function(c,l){var u=c.isSleeping;l?(c.isSleeping=!0,c.sleepCounter=c.sleepThreshold,c.positionImpulse.x=0,c.positionImpulse.y=0,c.positionPrev.x=c.position.x,c.positionPrev.y=c.position.y,c.anglePrev=c.angle,c.speed=0,c.angularSpeed=0,c.motion=0,u||r.trigger(c,"sleepStart")):(c.isSleeping=!1,c.sleepCounter=0,u&&r.trigger(c,"sleepEnd"))}})()},function(s,e,t){var n={};s.exports=n;var i=t(3),r=t(9);(function(){var a=[],c={overlap:0,axis:null},l={overlap:0,axis:null};n.create=function(u,d){return{pair:null,collided:!1,bodyA:u,bodyB:d,parentA:u.parent,parentB:d.parent,depth:0,normal:{x:0,y:0},tangent:{x:0,y:0},penetration:{x:0,y:0},supports:[null,null],supportCount:0}},n.collides=function(u,d,o){if(n._overlapAxes(c,u.vertices,d.vertices,u.axes),c.overlap<=0||(n._overlapAxes(l,d.vertices,u.vertices,d.axes),l.overlap<=0))return null;var h=o&&o.table[r.id(u,d)],f;h?f=h.collision:(f=n.create(u,d),f.collided=!0,f.bodyA=u.id<d.id?u:d,f.bodyB=u.id<d.id?d:u,f.parentA=f.bodyA.parent,f.parentB=f.bodyB.parent),u=f.bodyA,d=f.bodyB;var p;c.overlap<l.overlap?p=c:p=l;var v=f.normal,g=f.tangent,m=f.penetration,M=f.supports,x=p.overlap,S=p.axis,w=S.x,y=S.y,E=d.position.x-u.position.x,_=d.position.y-u.position.y;w*E+y*_>=0&&(w=-w,y=-y),v.x=w,v.y=y,g.x=-y,g.y=w,m.x=w*x,m.y=y*x,f.depth=x;var b=n._findSupports(u,d,v,1),R=0;if(i.contains(u.vertices,b[0])&&(M[R++]=b[0]),i.contains(u.vertices,b[1])&&(M[R++]=b[1]),R<2){var A=n._findSupports(d,u,v,-1);i.contains(d.vertices,A[0])&&(M[R++]=A[0]),R<2&&i.contains(d.vertices,A[1])&&(M[R++]=A[1])}return R===0&&(M[R++]=b[0]),f.supportCount=R,f},n._overlapAxes=function(u,d,o,h){var f=d.length,p=o.length,v=d[0].x,g=d[0].y,m=o[0].x,M=o[0].y,x=h.length,S=Number.MAX_VALUE,w=0,y,E,_,b,R,A;for(R=0;R<x;R++){var L=h[R],N=L.x,O=L.y,D=v*N+g*O,F=m*N+M*O,k=D,Q=F;for(A=1;A<f;A+=1)b=d[A].x*N+d[A].y*O,b>k?k=b:b<D&&(D=b);for(A=1;A<p;A+=1)b=o[A].x*N+o[A].y*O,b>Q?Q=b:b<F&&(F=b);if(E=k-F,_=Q-D,y=E<_?E:_,y<S&&(S=y,w=R,y<=0))break}u.axis=h[w],u.overlap=S},n._findSupports=function(u,d,o,h){var f=d.vertices,p=f.length,v=u.position.x,g=u.position.y,m=o.x*h,M=o.y*h,x=f[0],S=x,w=m*(v-S.x)+M*(g-S.y),y,E,_;for(_=1;_<p;_+=1)S=f[_],E=m*(v-S.x)+M*(g-S.y),E<w&&(w=E,x=S);return y=f[(p+x.index-1)%p],w=m*(v-y.x)+M*(g-y.y),S=f[(x.index+1)%p],m*(v-S.x)+M*(g-S.y)<w?(a[0]=x,a[1]=S,a):(a[0]=x,a[1]=y,a)}})()},function(s,e,t){var n={};s.exports=n;var i=t(16);(function(){n.create=function(r,a){var c=r.bodyA,l=r.bodyB,u={id:n.id(c,l),bodyA:c,bodyB:l,collision:r,contacts:[i.create(),i.create()],contactCount:0,separation:0,isActive:!0,isSensor:c.isSensor||l.isSensor,timeCreated:a,timeUpdated:a,inverseMass:0,friction:0,frictionStatic:0,restitution:0,slop:0};return n.update(u,r,a),u},n.update=function(r,a,c){var l=a.supports,u=a.supportCount,d=r.contacts,o=a.parentA,h=a.parentB;r.isActive=!0,r.timeUpdated=c,r.collision=a,r.separation=a.depth,r.inverseMass=o.inverseMass+h.inverseMass,r.friction=o.friction<h.friction?o.friction:h.friction,r.frictionStatic=o.frictionStatic>h.frictionStatic?o.frictionStatic:h.frictionStatic,r.restitution=o.restitution>h.restitution?o.restitution:h.restitution,r.slop=o.slop>h.slop?o.slop:h.slop,r.contactCount=u,a.pair=r;var f=l[0],p=d[0],v=l[1],g=d[1];(g.vertex===f||p.vertex===v)&&(d[1]=p,d[0]=p=g,g=d[1]),p.vertex=f,g.vertex=v},n.setActive=function(r,a,c){a?(r.isActive=!0,r.timeUpdated=c):(r.isActive=!1,r.contactCount=0)},n.id=function(r,a){return r.id<a.id?r.id.toString(36)+":"+a.id.toString(36):a.id.toString(36)+":"+r.id.toString(36)}})()},function(s,e,t){var n={};s.exports=n;var i=t(3),r=t(2),a=t(7),c=t(1),l=t(11),u=t(0);(function(){n._warming=.4,n._torqueDampen=1,n._minLength=1e-6,n.create=function(d){var o=d;o.bodyA&&!o.pointA&&(o.pointA={x:0,y:0}),o.bodyB&&!o.pointB&&(o.pointB={x:0,y:0});var h=o.bodyA?r.add(o.bodyA.position,o.pointA):o.pointA,f=o.bodyB?r.add(o.bodyB.position,o.pointB):o.pointB,p=r.magnitude(r.sub(h,f));o.length=typeof o.length<"u"?o.length:p,o.id=o.id||u.nextId(),o.label=o.label||"Constraint",o.type="constraint",o.stiffness=o.stiffness||(o.length>0?1:.7),o.damping=o.damping||0,o.angularStiffness=o.angularStiffness||0,o.angleA=o.bodyA?o.bodyA.angle:o.angleA,o.angleB=o.bodyB?o.bodyB.angle:o.angleB,o.plugin={};var v={visible:!0,lineWidth:2,strokeStyle:"#ffffff",type:"line",anchors:!0};return o.length===0&&o.stiffness>.1?(v.type="pin",v.anchors=!1):o.stiffness<.9&&(v.type="spring"),o.render=u.extend(v,o.render),o},n.preSolveAll=function(d){for(var o=0;o<d.length;o+=1){var h=d[o],f=h.constraintImpulse;h.isStatic||f.x===0&&f.y===0&&f.angle===0||(h.position.x+=f.x,h.position.y+=f.y,h.angle+=f.angle)}},n.solveAll=function(d,o){for(var h=u.clamp(o/u._baseDelta,0,1),f=0;f<d.length;f+=1){var p=d[f],v=!p.bodyA||p.bodyA&&p.bodyA.isStatic,g=!p.bodyB||p.bodyB&&p.bodyB.isStatic;(v||g)&&n.solve(d[f],h)}for(f=0;f<d.length;f+=1)p=d[f],v=!p.bodyA||p.bodyA&&p.bodyA.isStatic,g=!p.bodyB||p.bodyB&&p.bodyB.isStatic,!v&&!g&&n.solve(d[f],h)},n.solve=function(d,o){var h=d.bodyA,f=d.bodyB,p=d.pointA,v=d.pointB;if(!(!h&&!f)){h&&!h.isStatic&&(r.rotate(p,h.angle-d.angleA,p),d.angleA=h.angle),f&&!f.isStatic&&(r.rotate(v,f.angle-d.angleB,v),d.angleB=f.angle);var g=p,m=v;if(h&&(g=r.add(h.position,p)),f&&(m=r.add(f.position,v)),!(!g||!m)){var M=r.sub(g,m),x=r.magnitude(M);x<n._minLength&&(x=n._minLength);var S=(x-d.length)/x,w=d.stiffness>=1||d.length===0,y=w?d.stiffness*o:d.stiffness*o*o,E=d.damping*o,_=r.mult(M,S*y),b=(h?h.inverseMass:0)+(f?f.inverseMass:0),R=(h?h.inverseInertia:0)+(f?f.inverseInertia:0),A=b+R,L,N,O,D,F;if(E>0){var k=r.create();O=r.div(M,x),F=r.sub(f&&r.sub(f.position,f.positionPrev)||k,h&&r.sub(h.position,h.positionPrev)||k),D=r.dot(O,F)}h&&!h.isStatic&&(N=h.inverseMass/b,h.constraintImpulse.x-=_.x*N,h.constraintImpulse.y-=_.y*N,h.position.x-=_.x*N,h.position.y-=_.y*N,E>0&&(h.positionPrev.x-=E*O.x*D*N,h.positionPrev.y-=E*O.y*D*N),L=r.cross(p,_)/A*n._torqueDampen*h.inverseInertia*(1-d.angularStiffness),h.constraintImpulse.angle-=L,h.angle-=L),f&&!f.isStatic&&(N=f.inverseMass/b,f.constraintImpulse.x+=_.x*N,f.constraintImpulse.y+=_.y*N,f.position.x+=_.x*N,f.position.y+=_.y*N,E>0&&(f.positionPrev.x+=E*O.x*D*N,f.positionPrev.y+=E*O.y*D*N),L=r.cross(v,_)/A*n._torqueDampen*f.inverseInertia*(1-d.angularStiffness),f.constraintImpulse.angle+=L,f.angle+=L)}}},n.postSolveAll=function(d){for(var o=0;o<d.length;o++){var h=d[o],f=h.constraintImpulse;if(!(h.isStatic||f.x===0&&f.y===0&&f.angle===0)){a.set(h,!1);for(var p=0;p<h.parts.length;p++){var v=h.parts[p];i.translate(v.vertices,f),p>0&&(v.position.x+=f.x,v.position.y+=f.y),f.angle!==0&&(i.rotate(v.vertices,f.angle,h.position),l.rotate(v.axes,f.angle),p>0&&r.rotateAbout(v.position,f.angle,h.position,v.position)),c.update(v.bounds,v.vertices,h.velocity)}f.angle*=n._warming,f.x*=n._warming,f.y*=n._warming}}},n.pointAWorld=function(d){return{x:(d.bodyA?d.bodyA.position.x:0)+(d.pointA?d.pointA.x:0),y:(d.bodyA?d.bodyA.position.y:0)+(d.pointA?d.pointA.y:0)}},n.pointBWorld=function(d){return{x:(d.bodyB?d.bodyB.position.x:0)+(d.pointB?d.pointB.x:0),y:(d.bodyB?d.bodyB.position.y:0)+(d.pointB?d.pointB.y:0)}},n.currentLength=function(d){var o=(d.bodyA?d.bodyA.position.x:0)+(d.pointA?d.pointA.x:0),h=(d.bodyA?d.bodyA.position.y:0)+(d.pointA?d.pointA.y:0),f=(d.bodyB?d.bodyB.position.x:0)+(d.pointB?d.pointB.x:0),p=(d.bodyB?d.bodyB.position.y:0)+(d.pointB?d.pointB.y:0),v=o-f,g=h-p;return Math.sqrt(v*v+g*g)}})()},function(s,e,t){var n={};s.exports=n;var i=t(2),r=t(0);(function(){n.fromVertices=function(a){for(var c={},l=0;l<a.length;l++){var u=(l+1)%a.length,d=i.normalise({x:a[u].y-a[l].y,y:a[l].x-a[u].x}),o=d.y===0?1/0:d.x/d.y;o=o.toFixed(3).toString(),c[o]=d}return r.values(c)},n.rotate=function(a,c){if(c!==0)for(var l=Math.cos(c),u=Math.sin(c),d=0;d<a.length;d++){var o=a[d],h;h=o.x*l-o.y*u,o.y=o.x*u+o.y*l,o.x=h}}})()},function(s,e,t){var n={};s.exports=n;var i=t(3),r=t(0),a=t(4),c=t(1),l=t(2);(function(){n.rectangle=function(u,d,o,h,f){f=f||{};var p={label:"Rectangle Body",position:{x:u,y:d},vertices:i.fromPath("L 0 0 L "+o+" 0 L "+o+" "+h+" L 0 "+h)};if(f.chamfer){var v=f.chamfer;p.vertices=i.chamfer(p.vertices,v.radius,v.quality,v.qualityMin,v.qualityMax),delete f.chamfer}return a.create(r.extend({},p,f))},n.trapezoid=function(u,d,o,h,f,p){p=p||{},f>=1&&r.warn("Bodies.trapezoid: slope parameter must be < 1."),f*=.5;var v=(1-f*2)*o,g=o*f,m=g+v,M=m+g,x;f<.5?x="L 0 0 L "+g+" "+-h+" L "+m+" "+-h+" L "+M+" 0":x="L 0 0 L "+m+" "+-h+" L "+M+" 0";var S={label:"Trapezoid Body",position:{x:u,y:d},vertices:i.fromPath(x)};if(p.chamfer){var w=p.chamfer;S.vertices=i.chamfer(S.vertices,w.radius,w.quality,w.qualityMin,w.qualityMax),delete p.chamfer}return a.create(r.extend({},S,p))},n.circle=function(u,d,o,h,f){h=h||{};var p={label:"Circle Body",circleRadius:o};f=f||25;var v=Math.ceil(Math.max(10,Math.min(f,o)));return v%2===1&&(v+=1),n.polygon(u,d,v,o,r.extend({},p,h))},n.polygon=function(u,d,o,h,f){if(f=f||{},o<3)return n.circle(u,d,h,f);for(var p=2*Math.PI/o,v="",g=p*.5,m=0;m<o;m+=1){var M=g+m*p,x=Math.cos(M)*h,S=Math.sin(M)*h;v+="L "+x.toFixed(3)+" "+S.toFixed(3)+" "}var w={label:"Polygon Body",position:{x:u,y:d},vertices:i.fromPath(v)};if(f.chamfer){var y=f.chamfer;w.vertices=i.chamfer(w.vertices,y.radius,y.quality,y.qualityMin,y.qualityMax),delete f.chamfer}return a.create(r.extend({},w,f))},n.fromVertices=function(u,d,o,h,f,p,v,g){var m=r.getDecomp(),M,x,S,w,y,E,_,b,R,A,L;for(M=!!(m&&m.quickDecomp),h=h||{},S=[],f=typeof f<"u"?f:!1,p=typeof p<"u"?p:.01,v=typeof v<"u"?v:10,g=typeof g<"u"?g:.01,r.isArray(o[0])||(o=[o]),A=0;A<o.length;A+=1)if(E=o[A],w=i.isConvex(E),y=!w,y&&!M&&r.warnOnce("Bodies.fromVertices: Install the 'poly-decomp' library and use Common.setDecomp or provide 'decomp' as a global to decompose concave vertices."),w||!M)w?E=i.clockwiseSort(E):E=i.hull(E),S.push({position:{x:u,y:d},vertices:E});else{var N=E.map(function(Ce){return[Ce.x,Ce.y]});m.makeCCW(N),p!==!1&&m.removeCollinearPoints(N,p),g!==!1&&m.removeDuplicatePoints&&m.removeDuplicatePoints(N,g);var O=m.quickDecomp(N);for(_=0;_<O.length;_++){var D=O[_],F=D.map(function(Ce){return{x:Ce[0],y:Ce[1]}});v>0&&i.area(F)<v||S.push({position:i.centre(F),vertices:F})}}for(_=0;_<S.length;_++)S[_]=a.create(r.extend(S[_],h));if(f){var k=5;for(_=0;_<S.length;_++){var Q=S[_];for(b=_+1;b<S.length;b++){var ie=S[b];if(c.overlaps(Q.bounds,ie.bounds)){var oe=Q.vertices,xe=ie.vertices;for(R=0;R<Q.vertices.length;R++)for(L=0;L<ie.vertices.length;L++){var Ee=l.magnitudeSquared(l.sub(oe[(R+1)%oe.length],xe[L])),ze=l.magnitudeSquared(l.sub(oe[R],xe[(L+1)%xe.length]));Ee<k&&ze<k&&(oe[R].isInternal=!0,xe[L].isInternal=!0)}}}}}return S.length>1?(x=a.create(r.extend({parts:S.slice(0)},h)),a.setPosition(x,{x:u,y:d}),x):S[0]}})()},function(s,e,t){var n={};s.exports=n;var i=t(0),r=t(8);(function(){n.create=function(a){var c={bodies:[],collisions:[],pairs:null};return i.extend(c,a)},n.setBodies=function(a,c){a.bodies=c.slice(0)},n.clear=function(a){a.bodies=[],a.collisions=[]},n.collisions=function(a){var c=a.pairs,l=a.bodies,u=l.length,d=n.canCollide,o=r.collides,h=a.collisions,f=0,p,v;for(l.sort(n._compareBoundsX),p=0;p<u;p++){var g=l[p],m=g.bounds,M=g.bounds.max.x,x=g.bounds.max.y,S=g.bounds.min.y,w=g.isStatic||g.isSleeping,y=g.parts.length,E=y===1;for(v=p+1;v<u;v++){var _=l[v],b=_.bounds;if(b.min.x>M)break;if(!(x<b.min.y||S>b.max.y)&&!(w&&(_.isStatic||_.isSleeping))&&d(g.collisionFilter,_.collisionFilter)){var R=_.parts.length;if(E&&R===1){var A=o(g,_,c);A&&(h[f++]=A)}else for(var L=y>1?1:0,N=R>1?1:0,O=L;O<y;O++)for(var D=g.parts[O],m=D.bounds,F=N;F<R;F++){var k=_.parts[F],b=k.bounds;if(!(m.min.x>b.max.x||m.max.x<b.min.x||m.max.y<b.min.y||m.min.y>b.max.y)){var A=o(D,k,c);A&&(h[f++]=A)}}}}}return h.length!==f&&(h.length=f),h},n.canCollide=function(a,c){return a.group===c.group&&a.group!==0?a.group>0:(a.mask&c.category)!==0&&(c.mask&a.category)!==0},n._compareBoundsX=function(a,c){return a.bounds.min.x-c.bounds.min.x}})()},function(s,e,t){var n={};s.exports=n;var i=t(0);(function(){n.create=function(r){var a={};return r||i.log("Mouse.create: element was undefined, defaulting to document.body","warn"),a.element=r||document.body,a.absolute={x:0,y:0},a.position={x:0,y:0},a.mousedownPosition={x:0,y:0},a.mouseupPosition={x:0,y:0},a.offset={x:0,y:0},a.scale={x:1,y:1},a.wheelDelta=0,a.button=-1,a.pixelRatio=parseInt(a.element.getAttribute("data-pixel-ratio"),10)||1,a.sourceEvents={mousemove:null,mousedown:null,mouseup:null,mousewheel:null},a.mousemove=function(c){var l=n._getRelativeMousePosition(c,a.element,a.pixelRatio),u=c.changedTouches;u&&(a.button=0,c.preventDefault()),a.absolute.x=l.x,a.absolute.y=l.y,a.position.x=a.absolute.x*a.scale.x+a.offset.x,a.position.y=a.absolute.y*a.scale.y+a.offset.y,a.sourceEvents.mousemove=c},a.mousedown=function(c){var l=n._getRelativeMousePosition(c,a.element,a.pixelRatio),u=c.changedTouches;u?(a.button=0,c.preventDefault()):a.button=c.button,a.absolute.x=l.x,a.absolute.y=l.y,a.position.x=a.absolute.x*a.scale.x+a.offset.x,a.position.y=a.absolute.y*a.scale.y+a.offset.y,a.mousedownPosition.x=a.position.x,a.mousedownPosition.y=a.position.y,a.sourceEvents.mousedown=c},a.mouseup=function(c){var l=n._getRelativeMousePosition(c,a.element,a.pixelRatio),u=c.changedTouches;u&&c.preventDefault(),a.button=-1,a.absolute.x=l.x,a.absolute.y=l.y,a.position.x=a.absolute.x*a.scale.x+a.offset.x,a.position.y=a.absolute.y*a.scale.y+a.offset.y,a.mouseupPosition.x=a.position.x,a.mouseupPosition.y=a.position.y,a.sourceEvents.mouseup=c},a.mousewheel=function(c){a.wheelDelta=Math.max(-1,Math.min(1,c.wheelDelta||-c.detail)),c.preventDefault(),a.sourceEvents.mousewheel=c},n.setElement(a,a.element),a},n.setElement=function(r,a){r.element=a,a.addEventListener("mousemove",r.mousemove,{passive:!0}),a.addEventListener("mousedown",r.mousedown,{passive:!0}),a.addEventListener("mouseup",r.mouseup,{passive:!0}),a.addEventListener("wheel",r.mousewheel,{passive:!1}),a.addEventListener("touchmove",r.mousemove,{passive:!1}),a.addEventListener("touchstart",r.mousedown,{passive:!1}),a.addEventListener("touchend",r.mouseup,{passive:!1})},n.clearSourceEvents=function(r){r.sourceEvents.mousemove=null,r.sourceEvents.mousedown=null,r.sourceEvents.mouseup=null,r.sourceEvents.mousewheel=null,r.wheelDelta=0},n.setOffset=function(r,a){r.offset.x=a.x,r.offset.y=a.y,r.position.x=r.absolute.x*r.scale.x+r.offset.x,r.position.y=r.absolute.y*r.scale.y+r.offset.y},n.setScale=function(r,a){r.scale.x=a.x,r.scale.y=a.y,r.position.x=r.absolute.x*r.scale.x+r.offset.x,r.position.y=r.absolute.y*r.scale.y+r.offset.y},n._getRelativeMousePosition=function(r,a,c){var l=a.getBoundingClientRect(),u=document.documentElement||document.body.parentNode||document.body,d=window.pageXOffset!==void 0?window.pageXOffset:u.scrollLeft,o=window.pageYOffset!==void 0?window.pageYOffset:u.scrollTop,h=r.changedTouches,f,p;return h?(f=h[0].pageX-l.left-d,p=h[0].pageY-l.top-o):(f=r.pageX-l.left-d,p=r.pageY-l.top-o),{x:f/(a.clientWidth/(a.width||a.clientWidth)*c),y:p/(a.clientHeight/(a.height||a.clientHeight)*c)}}})()},function(s,e,t){var n={};s.exports=n;var i=t(0);(function(){n._registry={},n.register=function(r){if(n.isPlugin(r)||i.warn("Plugin.register:",n.toString(r),"does not implement all required fields."),r.name in n._registry){var a=n._registry[r.name],c=n.versionParse(r.version).number,l=n.versionParse(a.version).number;c>l?(i.warn("Plugin.register:",n.toString(a),"was upgraded to",n.toString(r)),n._registry[r.name]=r):c<l?i.warn("Plugin.register:",n.toString(a),"can not be downgraded to",n.toString(r)):r!==a&&i.warn("Plugin.register:",n.toString(r),"is already registered to different plugin object")}else n._registry[r.name]=r;return r},n.resolve=function(r){return n._registry[n.dependencyParse(r).name]},n.toString=function(r){return typeof r=="string"?r:(r.name||"anonymous")+"@"+(r.version||r.range||"0.0.0")},n.isPlugin=function(r){return r&&r.name&&r.version&&r.install},n.isUsed=function(r,a){return r.used.indexOf(a)>-1},n.isFor=function(r,a){var c=r.for&&n.dependencyParse(r.for);return!r.for||a.name===c.name&&n.versionSatisfies(a.version,c.range)},n.use=function(r,a){if(r.uses=(r.uses||[]).concat(a||[]),r.uses.length===0){i.warn("Plugin.use:",n.toString(r),"does not specify any dependencies to install.");return}for(var c=n.dependencies(r),l=i.topologicalSort(c),u=[],d=0;d<l.length;d+=1)if(l[d]!==r.name){var o=n.resolve(l[d]);if(!o){u.push("\u274C "+l[d]);continue}n.isUsed(r,o.name)||(n.isFor(o,r)||(i.warn("Plugin.use:",n.toString(o),"is for",o.for,"but installed on",n.toString(r)+"."),o._warned=!0),o.install?o.install(r):(i.warn("Plugin.use:",n.toString(o),"does not specify an install function."),o._warned=!0),o._warned?(u.push("\u{1F536} "+n.toString(o)),delete o._warned):u.push("\u2705 "+n.toString(o)),r.used.push(o.name))}u.length>0&&i.info(u.join("  "))},n.dependencies=function(r,a){var c=n.dependencyParse(r),l=c.name;if(a=a||{},!(l in a)){r=n.resolve(r)||r,a[l]=i.map(r.uses||[],function(d){n.isPlugin(d)&&n.register(d);var o=n.dependencyParse(d),h=n.resolve(d);return h&&!n.versionSatisfies(h.version,o.range)?(i.warn("Plugin.dependencies:",n.toString(h),"does not satisfy",n.toString(o),"used by",n.toString(c)+"."),h._warned=!0,r._warned=!0):h||(i.warn("Plugin.dependencies:",n.toString(d),"used by",n.toString(c),"could not be resolved."),r._warned=!0),o.name});for(var u=0;u<a[l].length;u+=1)n.dependencies(a[l][u],a);return a}},n.dependencyParse=function(r){if(i.isString(r)){var a=/^[\w-]+(@(\*|[\^~]?\d+\.\d+\.\d+(-[0-9A-Za-z-+]+)?))?$/;return a.test(r)||i.warn("Plugin.dependencyParse:",r,"is not a valid dependency string."),{name:r.split("@")[0],range:r.split("@")[1]||"*"}}return{name:r.name,range:r.range||r.version}},n.versionParse=function(r){var a=/^(\*)|(\^|~|>=|>)?\s*((\d+)\.(\d+)\.(\d+))(-[0-9A-Za-z-+]+)?$/;a.test(r)||i.warn("Plugin.versionParse:",r,"is not a valid version or range.");var c=a.exec(r),l=Number(c[4]),u=Number(c[5]),d=Number(c[6]);return{isRange:!!(c[1]||c[2]),version:c[3],range:r,operator:c[1]||c[2]||"",major:l,minor:u,patch:d,parts:[l,u,d],prerelease:c[7],number:l*1e8+u*1e4+d}},n.versionSatisfies=function(r,a){a=a||"*";var c=n.versionParse(a),l=n.versionParse(r);if(c.isRange){if(c.operator==="*"||r==="*")return!0;if(c.operator===">")return l.number>c.number;if(c.operator===">=")return l.number>=c.number;if(c.operator==="~")return l.major===c.major&&l.minor===c.minor&&l.patch>=c.patch;if(c.operator==="^")return c.major>0?l.major===c.major&&l.number>=c.number:c.minor>0?l.minor===c.minor&&l.patch>=c.patch:l.patch===c.patch}return r===a||r==="*"}})()},function(s,e){var t={};s.exports=t,function(){t.create=function(n){return{vertex:n,normalImpulse:0,tangentImpulse:0}}}()},function(s,e,t){var n={};s.exports=n;var i=t(7),r=t(18),a=t(13),c=t(19),l=t(5),u=t(6),d=t(10),o=t(0),h=t(4);(function(){n._deltaMax=1e3/60,n.create=function(f){f=f||{};var p={positionIterations:6,velocityIterations:4,constraintIterations:2,enableSleeping:!1,events:[],plugin:{},gravity:{x:0,y:1,scale:.001},timing:{timestamp:0,timeScale:1,lastDelta:0,lastElapsed:0,lastUpdatesPerFrame:0}},v=o.extend(p,f);return v.world=f.world||u.create({label:"World"}),v.pairs=f.pairs||c.create(),v.detector=f.detector||a.create(),v.detector.pairs=v.pairs,v.grid={buckets:[]},v.world.gravity=v.gravity,v.broadphase=v.grid,v.metrics={},v},n.update=function(f,p){var v=o.now(),g=f.world,m=f.detector,M=f.pairs,x=f.timing,S=x.timestamp,w;p>n._deltaMax&&o.warnOnce("Matter.Engine.update: delta argument is recommended to be less than or equal to",n._deltaMax.toFixed(3),"ms."),p=typeof p<"u"?p:o._baseDelta,p*=x.timeScale,x.timestamp+=p,x.lastDelta=p;var y={timestamp:x.timestamp,delta:p};l.trigger(f,"beforeUpdate",y);var E=u.allBodies(g),_=u.allConstraints(g);for(g.isModified&&(a.setBodies(m,E),u.setModified(g,!1,!1,!0)),f.enableSleeping&&i.update(E,p),n._bodiesApplyGravity(E,f.gravity),p>0&&n._bodiesUpdate(E,p),l.trigger(f,"beforeSolve",y),d.preSolveAll(E),w=0;w<f.constraintIterations;w++)d.solveAll(_,p);d.postSolveAll(E);var b=a.collisions(m);c.update(M,b,S),f.enableSleeping&&i.afterCollisions(M.list),M.collisionStart.length>0&&l.trigger(f,"collisionStart",{pairs:M.collisionStart,timestamp:x.timestamp,delta:p});var R=o.clamp(20/f.positionIterations,0,1);for(r.preSolvePosition(M.list),w=0;w<f.positionIterations;w++)r.solvePosition(M.list,p,R);for(r.postSolvePosition(E),d.preSolveAll(E),w=0;w<f.constraintIterations;w++)d.solveAll(_,p);for(d.postSolveAll(E),r.preSolveVelocity(M.list),w=0;w<f.velocityIterations;w++)r.solveVelocity(M.list,p);return n._bodiesUpdateVelocities(E),M.collisionActive.length>0&&l.trigger(f,"collisionActive",{pairs:M.collisionActive,timestamp:x.timestamp,delta:p}),M.collisionEnd.length>0&&l.trigger(f,"collisionEnd",{pairs:M.collisionEnd,timestamp:x.timestamp,delta:p}),n._bodiesClearForces(E),l.trigger(f,"afterUpdate",y),f.timing.lastElapsed=o.now()-v,f},n.merge=function(f,p){if(o.extend(f,p),p.world){f.world=p.world,n.clear(f);for(var v=u.allBodies(f.world),g=0;g<v.length;g++){var m=v[g];i.set(m,!1),m.id=o.nextId()}}},n.clear=function(f){c.clear(f.pairs),a.clear(f.detector)},n._bodiesClearForces=function(f){for(var p=f.length,v=0;v<p;v++){var g=f[v];g.force.x=0,g.force.y=0,g.torque=0}},n._bodiesApplyGravity=function(f,p){var v=typeof p.scale<"u"?p.scale:.001,g=f.length;if(!(p.x===0&&p.y===0||v===0))for(var m=0;m<g;m++){var M=f[m];M.isStatic||M.isSleeping||(M.force.y+=M.mass*p.y*v,M.force.x+=M.mass*p.x*v)}},n._bodiesUpdate=function(f,p){for(var v=f.length,g=0;g<v;g++){var m=f[g];m.isStatic||m.isSleeping||h.update(m,p)}},n._bodiesUpdateVelocities=function(f){for(var p=f.length,v=0;v<p;v++)h.updateVelocities(f[v])}})()},function(s,e,t){var n={};s.exports=n;var i=t(3),r=t(0),a=t(1);(function(){n._restingThresh=2,n._restingThreshTangent=Math.sqrt(6),n._positionDampen=.9,n._positionWarming=.8,n._frictionNormalMultiplier=5,n._frictionMaxStatic=Number.MAX_VALUE,n.preSolvePosition=function(c){var l,u,d,o=c.length;for(l=0;l<o;l++)u=c[l],u.isActive&&(d=u.contactCount,u.collision.parentA.totalContacts+=d,u.collision.parentB.totalContacts+=d)},n.solvePosition=function(c,l,u){var d,o,h,f,p,v,g,m,M=n._positionDampen*(u||1),x=r.clamp(l/r._baseDelta,0,1),S=c.length;for(d=0;d<S;d++)o=c[d],!(!o.isActive||o.isSensor)&&(h=o.collision,f=h.parentA,p=h.parentB,v=h.normal,o.separation=h.depth+v.x*(p.positionImpulse.x-f.positionImpulse.x)+v.y*(p.positionImpulse.y-f.positionImpulse.y));for(d=0;d<S;d++)o=c[d],!(!o.isActive||o.isSensor)&&(h=o.collision,f=h.parentA,p=h.parentB,v=h.normal,m=o.separation-o.slop*x,(f.isStatic||p.isStatic)&&(m*=2),f.isStatic||f.isSleeping||(g=M/f.totalContacts,f.positionImpulse.x+=v.x*m*g,f.positionImpulse.y+=v.y*m*g),p.isStatic||p.isSleeping||(g=M/p.totalContacts,p.positionImpulse.x-=v.x*m*g,p.positionImpulse.y-=v.y*m*g))},n.postSolvePosition=function(c){for(var l=n._positionWarming,u=c.length,d=i.translate,o=a.update,h=0;h<u;h++){var f=c[h],p=f.positionImpulse,v=p.x,g=p.y,m=f.velocity;if(f.totalContacts=0,v!==0||g!==0){for(var M=0;M<f.parts.length;M++){var x=f.parts[M];d(x.vertices,p),o(x.bounds,x.vertices,m),x.position.x+=v,x.position.y+=g}f.positionPrev.x+=v,f.positionPrev.y+=g,v*m.x+g*m.y<0?(p.x=0,p.y=0):(p.x*=l,p.y*=l)}}},n.preSolveVelocity=function(c){var l=c.length,u,d;for(u=0;u<l;u++){var o=c[u];if(!(!o.isActive||o.isSensor)){var h=o.contacts,f=o.contactCount,p=o.collision,v=p.parentA,g=p.parentB,m=p.normal,M=p.tangent;for(d=0;d<f;d++){var x=h[d],S=x.vertex,w=x.normalImpulse,y=x.tangentImpulse;if(w!==0||y!==0){var E=m.x*w+M.x*y,_=m.y*w+M.y*y;v.isStatic||v.isSleeping||(v.positionPrev.x+=E*v.inverseMass,v.positionPrev.y+=_*v.inverseMass,v.anglePrev+=v.inverseInertia*((S.x-v.position.x)*_-(S.y-v.position.y)*E)),g.isStatic||g.isSleeping||(g.positionPrev.x-=E*g.inverseMass,g.positionPrev.y-=_*g.inverseMass,g.anglePrev-=g.inverseInertia*((S.x-g.position.x)*_-(S.y-g.position.y)*E))}}}}},n.solveVelocity=function(c,l){var u=l/r._baseDelta,d=u*u,o=d*u,h=-n._restingThresh*u,f=n._restingThreshTangent,p=n._frictionNormalMultiplier*u,v=n._frictionMaxStatic,g=c.length,m,M,x,S;for(x=0;x<g;x++){var w=c[x];if(!(!w.isActive||w.isSensor)){var y=w.collision,E=y.parentA,_=y.parentB,b=y.normal.x,R=y.normal.y,A=y.tangent.x,L=y.tangent.y,N=w.inverseMass,O=w.friction*w.frictionStatic*p,D=w.contacts,F=w.contactCount,k=1/F,Q=E.position.x-E.positionPrev.x,ie=E.position.y-E.positionPrev.y,oe=E.angle-E.anglePrev,xe=_.position.x-_.positionPrev.x,Ee=_.position.y-_.positionPrev.y,ze=_.angle-_.anglePrev;for(S=0;S<F;S++){var Ce=D[S],De=Ce.vertex,J=De.x-E.position.x,ge=De.y-E.position.y,ae=De.x-_.position.x,Pe=De.y-_.position.y,Le=Q-ge*oe,Ne=ie+J*oe,at=xe-Pe*ze,Ze=Ee+ae*ze,nt=Le-at,st=Ne-Ze,ke=b*nt+R*st,Ye=A*nt+L*st,lt=w.separation+ke,ft=Math.min(lt,1);ft=lt<0?0:ft;var z=ft*O;Ye<-z||Ye>z?(M=Ye>0?Ye:-Ye,m=w.friction*(Ye>0?1:-1)*o,m<-M?m=-M:m>M&&(m=M)):(m=Ye,M=v);var ut=J*R-ge*b,Xe=ae*R-Pe*b,qe=k/(N+E.inverseInertia*ut*ut+_.inverseInertia*Xe*Xe),de=(1+w.restitution)*ke*qe;if(m*=qe,ke<h)Ce.normalImpulse=0;else{var rt=Ce.normalImpulse;Ce.normalImpulse+=de,Ce.normalImpulse>0&&(Ce.normalImpulse=0),de=Ce.normalImpulse-rt}if(Ye<-f||Ye>f)Ce.tangentImpulse=0;else{var P=Ce.tangentImpulse;Ce.tangentImpulse+=m,Ce.tangentImpulse<-M&&(Ce.tangentImpulse=-M),Ce.tangentImpulse>M&&(Ce.tangentImpulse=M),m=Ce.tangentImpulse-P}var T=b*de+A*m,G=R*de+L*m;E.isStatic||E.isSleeping||(E.positionPrev.x+=T*E.inverseMass,E.positionPrev.y+=G*E.inverseMass,E.anglePrev+=(J*G-ge*T)*E.inverseInertia),_.isStatic||_.isSleeping||(_.positionPrev.x-=T*_.inverseMass,_.positionPrev.y-=G*_.inverseMass,_.anglePrev-=(ae*G-Pe*T)*_.inverseInertia)}}}}})()},function(s,e,t){var n={};s.exports=n;var i=t(9),r=t(0);(function(){n.create=function(a){return r.extend({table:{},list:[],collisionStart:[],collisionActive:[],collisionEnd:[]},a)},n.update=function(a,c,l){var u=i.update,d=i.create,o=i.setActive,h=a.table,f=a.list,p=f.length,v=p,g=a.collisionStart,m=a.collisionEnd,M=a.collisionActive,x=c.length,S=0,w=0,y=0,E,_,b;for(b=0;b<x;b++)E=c[b],_=E.pair,_?(_.isActive&&(M[y++]=_),u(_,E,l)):(_=d(E,l),h[_.id]=_,g[S++]=_,f[v++]=_);for(v=0,p=f.length,b=0;b<p;b++)_=f[b],_.timeUpdated>=l?f[v++]=_:(o(_,!1,l),_.collision.bodyA.sleepCounter>0&&_.collision.bodyB.sleepCounter>0?f[v++]=_:(m[w++]=_,delete h[_.id]));f.length!==v&&(f.length=v),g.length!==S&&(g.length=S),m.length!==w&&(m.length=w),M.length!==y&&(M.length=y)},n.clear=function(a){return a.table={},a.list.length=0,a.collisionStart.length=0,a.collisionActive.length=0,a.collisionEnd.length=0,a}})()},function(s,e,t){var n=s.exports=t(21);n.Axes=t(11),n.Bodies=t(12),n.Body=t(4),n.Bounds=t(1),n.Collision=t(8),n.Common=t(0),n.Composite=t(6),n.Composites=t(22),n.Constraint=t(10),n.Contact=t(16),n.Detector=t(13),n.Engine=t(17),n.Events=t(5),n.Grid=t(23),n.Mouse=t(14),n.MouseConstraint=t(24),n.Pair=t(9),n.Pairs=t(19),n.Plugin=t(15),n.Query=t(25),n.Render=t(26),n.Resolver=t(18),n.Runner=t(27),n.SAT=t(28),n.Sleeping=t(7),n.Svg=t(29),n.Vector=t(2),n.Vertices=t(3),n.World=t(30),n.Engine.run=n.Runner.run,n.Common.deprecated(n.Engine,"run","Engine.run \u27A4 use Matter.Runner.run(engine) instead")},function(s,e,t){var n={};s.exports=n;var i=t(15),r=t(0);(function(){n.name="matter-js",n.version="0.20.0",n.uses=[],n.used=[],n.use=function(){i.use(n,Array.prototype.slice.call(arguments))},n.before=function(a,c){return a=a.replace(/^Matter./,""),r.chainPathBefore(n,a,c)},n.after=function(a,c){return a=a.replace(/^Matter./,""),r.chainPathAfter(n,a,c)}})()},function(s,e,t){var n={};s.exports=n;var i=t(6),r=t(10),a=t(0),c=t(4),l=t(12),u=a.deprecated;(function(){n.stack=function(d,o,h,f,p,v,g){for(var m=i.create({label:"Stack"}),M=d,x=o,S,w=0,y=0;y<f;y++){for(var E=0,_=0;_<h;_++){var b=g(M,x,_,y,S,w);if(b){var R=b.bounds.max.y-b.bounds.min.y,A=b.bounds.max.x-b.bounds.min.x;R>E&&(E=R),c.translate(b,{x:A*.5,y:R*.5}),M=b.bounds.max.x+p,i.addBody(m,b),S=b,w+=1}else M+=p}x+=E+v,M=d}return m},n.chain=function(d,o,h,f,p,v){for(var g=d.bodies,m=1;m<g.length;m++){var M=g[m-1],x=g[m],S=M.bounds.max.y-M.bounds.min.y,w=M.bounds.max.x-M.bounds.min.x,y=x.bounds.max.y-x.bounds.min.y,E=x.bounds.max.x-x.bounds.min.x,_={bodyA:M,pointA:{x:w*o,y:S*h},bodyB:x,pointB:{x:E*f,y:y*p}},b=a.extend(_,v);i.addConstraint(d,r.create(b))}return d.label+=" Chain",d},n.mesh=function(d,o,h,f,p){var v=d.bodies,g,m,M,x,S;for(g=0;g<h;g++){for(m=1;m<o;m++)M=v[m-1+g*o],x=v[m+g*o],i.addConstraint(d,r.create(a.extend({bodyA:M,bodyB:x},p)));if(g>0)for(m=0;m<o;m++)M=v[m+(g-1)*o],x=v[m+g*o],i.addConstraint(d,r.create(a.extend({bodyA:M,bodyB:x},p))),f&&m>0&&(S=v[m-1+(g-1)*o],i.addConstraint(d,r.create(a.extend({bodyA:S,bodyB:x},p)))),f&&m<o-1&&(S=v[m+1+(g-1)*o],i.addConstraint(d,r.create(a.extend({bodyA:S,bodyB:x},p))))}return d.label+=" Mesh",d},n.pyramid=function(d,o,h,f,p,v,g){return n.stack(d,o,h,f,p,v,function(m,M,x,S,w,y){var E=Math.min(f,Math.ceil(h/2)),_=w?w.bounds.max.x-w.bounds.min.x:0;if(!(S>E)){S=E-S;var b=S,R=h-1-S;if(!(x<b||x>R)){y===1&&c.translate(w,{x:(x+(h%2===1?1:-1))*_,y:0});var A=w?x*_:0;return g(d+A+x*p,M,x,S,w,y)}}})},n.newtonsCradle=function(d,o,h,f,p){for(var v=i.create({label:"Newtons Cradle"}),g=0;g<h;g++){var m=1.9,M=l.circle(d+g*(f*m),o+p,f,{inertia:1/0,restitution:1,friction:0,frictionAir:1e-4,slop:1}),x=r.create({pointA:{x:d+g*(f*m),y:o},bodyB:M});i.addBody(v,M),i.addConstraint(v,x)}return v},u(n,"newtonsCradle","Composites.newtonsCradle \u27A4 moved to newtonsCradle example"),n.car=function(d,o,h,f,p){var v=c.nextGroup(!0),g=20,m=-h*.5+g,M=h*.5-g,x=0,S=i.create({label:"Car"}),w=l.rectangle(d,o,h,f,{collisionFilter:{group:v},chamfer:{radius:f*.5},density:2e-4}),y=l.circle(d+m,o+x,p,{collisionFilter:{group:v},friction:.8}),E=l.circle(d+M,o+x,p,{collisionFilter:{group:v},friction:.8}),_=r.create({bodyB:w,pointB:{x:m,y:x},bodyA:y,stiffness:1,length:0}),b=r.create({bodyB:w,pointB:{x:M,y:x},bodyA:E,stiffness:1,length:0});return i.addBody(S,w),i.addBody(S,y),i.addBody(S,E),i.addConstraint(S,_),i.addConstraint(S,b),S},u(n,"car","Composites.car \u27A4 moved to car example"),n.softBody=function(d,o,h,f,p,v,g,m,M,x){M=a.extend({inertia:1/0},M),x=a.extend({stiffness:.2,render:{type:"line",anchors:!1}},x);var S=n.stack(d,o,h,f,p,v,function(w,y){return l.circle(w,y,m,M)});return n.mesh(S,h,f,g,x),S.label="Soft Body",S},u(n,"softBody","Composites.softBody \u27A4 moved to softBody and cloth examples")})()},function(s,e,t){var n={};s.exports=n;var i=t(9),r=t(0),a=r.deprecated;(function(){n.create=function(c){var l={buckets:{},pairs:{},pairsList:[],bucketWidth:48,bucketHeight:48};return r.extend(l,c)},n.update=function(c,l,u,d){var o,h,f,p=u.world,v=c.buckets,g,m,M=!1;for(o=0;o<l.length;o++){var x=l[o];if(!(x.isSleeping&&!d)&&!(p.bounds&&(x.bounds.max.x<p.bounds.min.x||x.bounds.min.x>p.bounds.max.x||x.bounds.max.y<p.bounds.min.y||x.bounds.min.y>p.bounds.max.y))){var S=n._getRegion(c,x);if(!x.region||S.id!==x.region.id||d){(!x.region||d)&&(x.region=S);var w=n._regionUnion(S,x.region);for(h=w.startCol;h<=w.endCol;h++)for(f=w.startRow;f<=w.endRow;f++){m=n._getBucketId(h,f),g=v[m];var y=h>=S.startCol&&h<=S.endCol&&f>=S.startRow&&f<=S.endRow,E=h>=x.region.startCol&&h<=x.region.endCol&&f>=x.region.startRow&&f<=x.region.endRow;!y&&E&&E&&g&&n._bucketRemoveBody(c,g,x),(x.region===S||y&&!E||d)&&(g||(g=n._createBucket(v,m)),n._bucketAddBody(c,g,x))}x.region=S,M=!0}}}M&&(c.pairsList=n._createActivePairsList(c))},a(n,"update","Grid.update \u27A4 replaced by Matter.Detector"),n.clear=function(c){c.buckets={},c.pairs={},c.pairsList=[]},a(n,"clear","Grid.clear \u27A4 replaced by Matter.Detector"),n._regionUnion=function(c,l){var u=Math.min(c.startCol,l.startCol),d=Math.max(c.endCol,l.endCol),o=Math.min(c.startRow,l.startRow),h=Math.max(c.endRow,l.endRow);return n._createRegion(u,d,o,h)},n._getRegion=function(c,l){var u=l.bounds,d=Math.floor(u.min.x/c.bucketWidth),o=Math.floor(u.max.x/c.bucketWidth),h=Math.floor(u.min.y/c.bucketHeight),f=Math.floor(u.max.y/c.bucketHeight);return n._createRegion(d,o,h,f)},n._createRegion=function(c,l,u,d){return{id:c+","+l+","+u+","+d,startCol:c,endCol:l,startRow:u,endRow:d}},n._getBucketId=function(c,l){return"C"+c+"R"+l},n._createBucket=function(c,l){var u=c[l]=[];return u},n._bucketAddBody=function(c,l,u){var d=c.pairs,o=i.id,h=l.length,f;for(f=0;f<h;f++){var p=l[f];if(!(u.id===p.id||u.isStatic&&p.isStatic)){var v=o(u,p),g=d[v];g?g[2]+=1:d[v]=[u,p,1]}}l.push(u)},n._bucketRemoveBody=function(c,l,u){var d=c.pairs,o=i.id,h;l.splice(r.indexOf(l,u),1);var f=l.length;for(h=0;h<f;h++){var p=d[o(u,l[h])];p&&(p[2]-=1)}},n._createActivePairsList=function(c){var l,u=c.pairs,d=r.keys(u),o=d.length,h=[],f;for(f=0;f<o;f++)l=u[d[f]],l[2]>0?h.push(l):delete u[d[f]];return h}})()},function(s,e,t){var n={};s.exports=n;var i=t(3),r=t(7),a=t(14),c=t(5),l=t(13),u=t(10),d=t(6),o=t(0),h=t(1);(function(){n.create=function(f,p){var v=(f?f.mouse:null)||(p?p.mouse:null);v||(f&&f.render&&f.render.canvas?v=a.create(f.render.canvas):p&&p.element?v=a.create(p.element):(v=a.create(),o.warn("MouseConstraint.create: options.mouse was undefined, options.element was undefined, may not function as expected")));var g=u.create({label:"Mouse Constraint",pointA:v.position,pointB:{x:0,y:0},length:.01,stiffness:.1,angularStiffness:1,render:{strokeStyle:"#90EE90",lineWidth:3}}),m={type:"mouseConstraint",mouse:v,element:null,body:null,constraint:g,collisionFilter:{category:1,mask:4294967295,group:0}},M=o.extend(m,p);return c.on(f,"beforeUpdate",function(){var x=d.allBodies(f.world);n.update(M,x),n._triggerEvents(M)}),M},n.update=function(f,p){var v=f.mouse,g=f.constraint,m=f.body;if(v.button===0){if(g.bodyB)r.set(g.bodyB,!1),g.pointA=v.position;else for(var M=0;M<p.length;M++)if(m=p[M],h.contains(m.bounds,v.position)&&l.canCollide(m.collisionFilter,f.collisionFilter))for(var x=m.parts.length>1?1:0;x<m.parts.length;x++){var S=m.parts[x];if(i.contains(S.vertices,v.position)){g.pointA=v.position,g.bodyB=f.body=m,g.pointB={x:v.position.x-m.position.x,y:v.position.y-m.position.y},g.angleB=m.angle,r.set(m,!1),c.trigger(f,"startdrag",{mouse:v,body:m});break}}}else g.bodyB=f.body=null,g.pointB=null,m&&c.trigger(f,"enddrag",{mouse:v,body:m})},n._triggerEvents=function(f){var p=f.mouse,v=p.sourceEvents;v.mousemove&&c.trigger(f,"mousemove",{mouse:p}),v.mousedown&&c.trigger(f,"mousedown",{mouse:p}),v.mouseup&&c.trigger(f,"mouseup",{mouse:p}),a.clearSourceEvents(p)}})()},function(s,e,t){var n={};s.exports=n;var i=t(2),r=t(8),a=t(1),c=t(12),l=t(3);(function(){n.collides=function(u,d){for(var o=[],h=d.length,f=u.bounds,p=r.collides,v=a.overlaps,g=0;g<h;g++){var m=d[g],M=m.parts.length,x=M===1?0:1;if(v(m.bounds,f))for(var S=x;S<M;S++){var w=m.parts[S];if(v(w.bounds,f)){var y=p(w,u);if(y){o.push(y);break}}}}return o},n.ray=function(u,d,o,h){h=h||1e-100;for(var f=i.angle(d,o),p=i.magnitude(i.sub(d,o)),v=(o.x+d.x)*.5,g=(o.y+d.y)*.5,m=c.rectangle(v,g,p,h,{angle:f}),M=n.collides(m,u),x=0;x<M.length;x+=1){var S=M[x];S.body=S.bodyB=S.bodyA}return M},n.region=function(u,d,o){for(var h=[],f=0;f<u.length;f++){var p=u[f],v=a.overlaps(p.bounds,d);(v&&!o||!v&&o)&&h.push(p)}return h},n.point=function(u,d){for(var o=[],h=0;h<u.length;h++){var f=u[h];if(a.contains(f.bounds,d))for(var p=f.parts.length===1?0:1;p<f.parts.length;p++){var v=f.parts[p];if(a.contains(v.bounds,d)&&l.contains(v.vertices,d)){o.push(f);break}}}return o}})()},function(s,e,t){var n={};s.exports=n;var i=t(4),r=t(0),a=t(6),c=t(1),l=t(5),u=t(2),d=t(14);(function(){var o,h;typeof window<"u"&&(o=window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame||window.msRequestAnimationFrame||function(x){window.setTimeout(function(){x(r.now())},1e3/60)},h=window.cancelAnimationFrame||window.mozCancelAnimationFrame||window.webkitCancelAnimationFrame||window.msCancelAnimationFrame),n._goodFps=30,n._goodDelta=1e3/60,n.create=function(x){var S={engine:null,element:null,canvas:null,mouse:null,frameRequestId:null,timing:{historySize:60,delta:0,deltaHistory:[],lastTime:0,lastTimestamp:0,lastElapsed:0,timestampElapsed:0,timestampElapsedHistory:[],engineDeltaHistory:[],engineElapsedHistory:[],engineUpdatesHistory:[],elapsedHistory:[]},options:{width:800,height:600,pixelRatio:1,background:"#14151f",wireframeBackground:"#14151f",wireframeStrokeStyle:"#bbb",hasBounds:!!x.bounds,enabled:!0,wireframes:!0,showSleeping:!0,showDebug:!1,showStats:!1,showPerformance:!1,showBounds:!1,showVelocity:!1,showCollisions:!1,showSeparations:!1,showAxes:!1,showPositions:!1,showAngleIndicator:!1,showIds:!1,showVertexNumbers:!1,showConvexHulls:!1,showInternalEdges:!1,showMousePosition:!1}},w=r.extend(S,x);return w.canvas&&(w.canvas.width=w.options.width||w.canvas.width,w.canvas.height=w.options.height||w.canvas.height),w.mouse=x.mouse,w.engine=x.engine,w.canvas=w.canvas||v(w.options.width,w.options.height),w.context=w.canvas.getContext("2d"),w.textures={},w.bounds=w.bounds||{min:{x:0,y:0},max:{x:w.canvas.width,y:w.canvas.height}},w.controller=n,w.options.showBroadphase=!1,w.options.pixelRatio!==1&&n.setPixelRatio(w,w.options.pixelRatio),r.isElement(w.element)&&w.element.appendChild(w.canvas),w},n.run=function(x){(function S(w){x.frameRequestId=o(S),f(x,w),n.world(x,w),x.context.setTransform(x.options.pixelRatio,0,0,x.options.pixelRatio,0,0),(x.options.showStats||x.options.showDebug)&&n.stats(x,x.context,w),(x.options.showPerformance||x.options.showDebug)&&n.performance(x,x.context,w),x.context.setTransform(1,0,0,1,0,0)})()},n.stop=function(x){h(x.frameRequestId)},n.setPixelRatio=function(x,S){var w=x.options,y=x.canvas;S==="auto"&&(S=g(y)),w.pixelRatio=S,y.setAttribute("data-pixel-ratio",S),y.width=w.width*S,y.height=w.height*S,y.style.width=w.width+"px",y.style.height=w.height+"px"},n.setSize=function(x,S,w){x.options.width=S,x.options.height=w,x.bounds.max.x=x.bounds.min.x+S,x.bounds.max.y=x.bounds.min.y+w,x.options.pixelRatio!==1?n.setPixelRatio(x,x.options.pixelRatio):(x.canvas.width=S,x.canvas.height=w)},n.lookAt=function(x,S,w,y){y=typeof y<"u"?y:!0,S=r.isArray(S)?S:[S],w=w||{x:0,y:0};for(var E={min:{x:1/0,y:1/0},max:{x:-1/0,y:-1/0}},_=0;_<S.length;_+=1){var b=S[_],R=b.bounds?b.bounds.min:b.min||b.position||b,A=b.bounds?b.bounds.max:b.max||b.position||b;R&&A&&(R.x<E.min.x&&(E.min.x=R.x),A.x>E.max.x&&(E.max.x=A.x),R.y<E.min.y&&(E.min.y=R.y),A.y>E.max.y&&(E.max.y=A.y))}var L=E.max.x-E.min.x+2*w.x,N=E.max.y-E.min.y+2*w.y,O=x.canvas.height,D=x.canvas.width,F=D/O,k=L/N,Q=1,ie=1;k>F?ie=k/F:Q=F/k,x.options.hasBounds=!0,x.bounds.min.x=E.min.x,x.bounds.max.x=E.min.x+L*Q,x.bounds.min.y=E.min.y,x.bounds.max.y=E.min.y+N*ie,y&&(x.bounds.min.x+=L*.5-L*Q*.5,x.bounds.max.x+=L*.5-L*Q*.5,x.bounds.min.y+=N*.5-N*ie*.5,x.bounds.max.y+=N*.5-N*ie*.5),x.bounds.min.x-=w.x,x.bounds.max.x-=w.x,x.bounds.min.y-=w.y,x.bounds.max.y-=w.y,x.mouse&&(d.setScale(x.mouse,{x:(x.bounds.max.x-x.bounds.min.x)/x.canvas.width,y:(x.bounds.max.y-x.bounds.min.y)/x.canvas.height}),d.setOffset(x.mouse,x.bounds.min))},n.startViewTransform=function(x){var S=x.bounds.max.x-x.bounds.min.x,w=x.bounds.max.y-x.bounds.min.y,y=S/x.options.width,E=w/x.options.height;x.context.setTransform(x.options.pixelRatio/y,0,0,x.options.pixelRatio/E,0,0),x.context.translate(-x.bounds.min.x,-x.bounds.min.y)},n.endViewTransform=function(x){x.context.setTransform(x.options.pixelRatio,0,0,x.options.pixelRatio,0,0)},n.world=function(x,S){var w=r.now(),y=x.engine,E=y.world,_=x.canvas,b=x.context,R=x.options,A=x.timing,L=a.allBodies(E),N=a.allConstraints(E),O=R.wireframes?R.wireframeBackground:R.background,D=[],F=[],k,Q={timestamp:y.timing.timestamp};if(l.trigger(x,"beforeRender",Q),x.currentBackground!==O&&M(x,O),b.globalCompositeOperation="source-in",b.fillStyle="transparent",b.fillRect(0,0,_.width,_.height),b.globalCompositeOperation="source-over",R.hasBounds){for(k=0;k<L.length;k++){var ie=L[k];c.overlaps(ie.bounds,x.bounds)&&D.push(ie)}for(k=0;k<N.length;k++){var oe=N[k],xe=oe.bodyA,Ee=oe.bodyB,ze=oe.pointA,Ce=oe.pointB;xe&&(ze=u.add(xe.position,oe.pointA)),Ee&&(Ce=u.add(Ee.position,oe.pointB)),!(!ze||!Ce)&&(c.contains(x.bounds,ze)||c.contains(x.bounds,Ce))&&F.push(oe)}n.startViewTransform(x),x.mouse&&(d.setScale(x.mouse,{x:(x.bounds.max.x-x.bounds.min.x)/x.options.width,y:(x.bounds.max.y-x.bounds.min.y)/x.options.height}),d.setOffset(x.mouse,x.bounds.min))}else F=N,D=L,x.options.pixelRatio!==1&&x.context.setTransform(x.options.pixelRatio,0,0,x.options.pixelRatio,0,0);!R.wireframes||y.enableSleeping&&R.showSleeping?n.bodies(x,D,b):(R.showConvexHulls&&n.bodyConvexHulls(x,D,b),n.bodyWireframes(x,D,b)),R.showBounds&&n.bodyBounds(x,D,b),(R.showAxes||R.showAngleIndicator)&&n.bodyAxes(x,D,b),R.showPositions&&n.bodyPositions(x,D,b),R.showVelocity&&n.bodyVelocity(x,D,b),R.showIds&&n.bodyIds(x,D,b),R.showSeparations&&n.separations(x,y.pairs.list,b),R.showCollisions&&n.collisions(x,y.pairs.list,b),R.showVertexNumbers&&n.vertexNumbers(x,D,b),R.showMousePosition&&n.mousePosition(x,x.mouse,b),n.constraints(F,b),R.hasBounds&&n.endViewTransform(x),l.trigger(x,"afterRender",Q),A.lastElapsed=r.now()-w},n.stats=function(x,S,w){for(var y=x.engine,E=y.world,_=a.allBodies(E),b=0,R=55,A=44,L=0,N=0,O=0;O<_.length;O+=1)b+=_[O].parts.length;var D={Part:b,Body:_.length,Cons:a.allConstraints(E).length,Comp:a.allComposites(E).length,Pair:y.pairs.list.length};S.fillStyle="#0e0f19",S.fillRect(L,N,R*5.5,A),S.font="12px Arial",S.textBaseline="top",S.textAlign="right";for(var F in D){var k=D[F];S.fillStyle="#aaa",S.fillText(F,L+R,N+8),S.fillStyle="#eee",S.fillText(k,L+R,N+26),L+=R}},n.performance=function(x,S){var w=x.engine,y=x.timing,E=y.deltaHistory,_=y.elapsedHistory,b=y.timestampElapsedHistory,R=y.engineDeltaHistory,A=y.engineUpdatesHistory,L=y.engineElapsedHistory,N=w.timing.lastUpdatesPerFrame,O=w.timing.lastDelta,D=p(E),F=p(_),k=p(R),Q=p(A),ie=p(L),oe=p(b),xe=oe/D||0,Ee=Math.round(D/O),ze=1e3/D||0,Ce=4,De=12,J=60,ge=34,ae=10,Pe=69;S.fillStyle="#0e0f19",S.fillRect(0,50,De*5+J*6+22,ge),n.status(S,ae,Pe,J,Ce,E.length,Math.round(ze)+" fps",ze/n._goodFps,function(Le){return E[Le]/D-1}),n.status(S,ae+De+J,Pe,J,Ce,R.length,O.toFixed(2)+" dt",n._goodDelta/O,function(Le){return R[Le]/k-1}),n.status(S,ae+(De+J)*2,Pe,J,Ce,A.length,N+" upf",Math.pow(r.clamp(Q/Ee||1,0,1),4),function(Le){return A[Le]/Q-1}),n.status(S,ae+(De+J)*3,Pe,J,Ce,L.length,ie.toFixed(2)+" ut",1-N*ie/n._goodFps,function(Le){return L[Le]/ie-1}),n.status(S,ae+(De+J)*4,Pe,J,Ce,_.length,F.toFixed(2)+" rt",1-F/n._goodFps,function(Le){return _[Le]/F-1}),n.status(S,ae+(De+J)*5,Pe,J,Ce,b.length,xe.toFixed(2)+" x",xe*xe*xe,function(Le){return(b[Le]/E[Le]/xe||0)-1})},n.status=function(x,S,w,y,E,_,b,R,A){x.strokeStyle="#888",x.fillStyle="#444",x.lineWidth=1,x.fillRect(S,w+7,y,1),x.beginPath(),x.moveTo(S,w+7-E*r.clamp(.4*A(0),-2,2));for(var L=0;L<y;L+=1)x.lineTo(S+L,w+7-(L<_?E*r.clamp(.4*A(L),-2,2):0));x.stroke(),x.fillStyle="hsl("+r.clamp(25+95*R,0,120)+",100%,60%)",x.fillRect(S,w-7,4,4),x.font="12px Arial",x.textBaseline="middle",x.textAlign="right",x.fillStyle="#eee",x.fillText(b,S+y,w-5)},n.constraints=function(x,S){for(var w=S,y=0;y<x.length;y++){var E=x[y];if(!(!E.render.visible||!E.pointA||!E.pointB)){var _=E.bodyA,b=E.bodyB,R,A;if(_?R=u.add(_.position,E.pointA):R=E.pointA,E.render.type==="pin")w.beginPath(),w.arc(R.x,R.y,3,0,2*Math.PI),w.closePath();else{if(b?A=u.add(b.position,E.pointB):A=E.pointB,w.beginPath(),w.moveTo(R.x,R.y),E.render.type==="spring")for(var L=u.sub(A,R),N=u.perp(u.normalise(L)),O=Math.ceil(r.clamp(E.length/5,12,20)),D,F=1;F<O;F+=1)D=F%2===0?1:-1,w.lineTo(R.x+L.x*(F/O)+N.x*D*4,R.y+L.y*(F/O)+N.y*D*4);w.lineTo(A.x,A.y)}E.render.lineWidth&&(w.lineWidth=E.render.lineWidth,w.strokeStyle=E.render.strokeStyle,w.stroke()),E.render.anchors&&(w.fillStyle=E.render.strokeStyle,w.beginPath(),w.arc(R.x,R.y,3,0,2*Math.PI),w.arc(A.x,A.y,3,0,2*Math.PI),w.closePath(),w.fill())}}},n.bodies=function(x,S,w){var y=w,E=x.engine,_=x.options,b=_.showInternalEdges||!_.wireframes,R,A,L,N;for(L=0;L<S.length;L++)if(R=S[L],!!R.render.visible){for(N=R.parts.length>1?1:0;N<R.parts.length;N++)if(A=R.parts[N],!!A.render.visible){if(_.showSleeping&&R.isSleeping?y.globalAlpha=.5*A.render.opacity:A.render.opacity!==1&&(y.globalAlpha=A.render.opacity),A.render.sprite&&A.render.sprite.texture&&!_.wireframes){var O=A.render.sprite,D=m(x,O.texture);y.translate(A.position.x,A.position.y),y.rotate(A.angle),y.drawImage(D,D.width*-O.xOffset*O.xScale,D.height*-O.yOffset*O.yScale,D.width*O.xScale,D.height*O.yScale),y.rotate(-A.angle),y.translate(-A.position.x,-A.position.y)}else{if(A.circleRadius)y.beginPath(),y.arc(A.position.x,A.position.y,A.circleRadius,0,2*Math.PI);else{y.beginPath(),y.moveTo(A.vertices[0].x,A.vertices[0].y);for(var F=1;F<A.vertices.length;F++)!A.vertices[F-1].isInternal||b?y.lineTo(A.vertices[F].x,A.vertices[F].y):y.moveTo(A.vertices[F].x,A.vertices[F].y),A.vertices[F].isInternal&&!b&&y.moveTo(A.vertices[(F+1)%A.vertices.length].x,A.vertices[(F+1)%A.vertices.length].y);y.lineTo(A.vertices[0].x,A.vertices[0].y),y.closePath()}_.wireframes?(y.lineWidth=1,y.strokeStyle=x.options.wireframeStrokeStyle,y.stroke()):(y.fillStyle=A.render.fillStyle,A.render.lineWidth&&(y.lineWidth=A.render.lineWidth,y.strokeStyle=A.render.strokeStyle,y.stroke()),y.fill())}y.globalAlpha=1}}},n.bodyWireframes=function(x,S,w){var y=w,E=x.options.showInternalEdges,_,b,R,A,L;for(y.beginPath(),R=0;R<S.length;R++)if(_=S[R],!!_.render.visible)for(L=_.parts.length>1?1:0;L<_.parts.length;L++){for(b=_.parts[L],y.moveTo(b.vertices[0].x,b.vertices[0].y),A=1;A<b.vertices.length;A++)!b.vertices[A-1].isInternal||E?y.lineTo(b.vertices[A].x,b.vertices[A].y):y.moveTo(b.vertices[A].x,b.vertices[A].y),b.vertices[A].isInternal&&!E&&y.moveTo(b.vertices[(A+1)%b.vertices.length].x,b.vertices[(A+1)%b.vertices.length].y);y.lineTo(b.vertices[0].x,b.vertices[0].y)}y.lineWidth=1,y.strokeStyle=x.options.wireframeStrokeStyle,y.stroke()},n.bodyConvexHulls=function(x,S,w){var y=w,E,_,b,R,A;for(y.beginPath(),b=0;b<S.length;b++)if(E=S[b],!(!E.render.visible||E.parts.length===1)){for(y.moveTo(E.vertices[0].x,E.vertices[0].y),R=1;R<E.vertices.length;R++)y.lineTo(E.vertices[R].x,E.vertices[R].y);y.lineTo(E.vertices[0].x,E.vertices[0].y)}y.lineWidth=1,y.strokeStyle="rgba(255,255,255,0.2)",y.stroke()},n.vertexNumbers=function(x,S,w){var y=w,E,_,b;for(E=0;E<S.length;E++){var R=S[E].parts;for(b=R.length>1?1:0;b<R.length;b++){var A=R[b];for(_=0;_<A.vertices.length;_++)y.fillStyle="rgba(255,255,255,0.2)",y.fillText(E+"_"+_,A.position.x+(A.vertices[_].x-A.position.x)*.8,A.position.y+(A.vertices[_].y-A.position.y)*.8)}}},n.mousePosition=function(x,S,w){var y=w;y.fillStyle="rgba(255,255,255,0.8)",y.fillText(S.position.x+"  "+S.position.y,S.position.x+5,S.position.y-5)},n.bodyBounds=function(x,S,w){var y=w,E=x.engine,_=x.options;y.beginPath();for(var b=0;b<S.length;b++){var R=S[b];if(R.render.visible)for(var A=S[b].parts,L=A.length>1?1:0;L<A.length;L++){var N=A[L];y.rect(N.bounds.min.x,N.bounds.min.y,N.bounds.max.x-N.bounds.min.x,N.bounds.max.y-N.bounds.min.y)}}_.wireframes?y.strokeStyle="rgba(255,255,255,0.08)":y.strokeStyle="rgba(0,0,0,0.1)",y.lineWidth=1,y.stroke()},n.bodyAxes=function(x,S,w){var y=w,E=x.engine,_=x.options,b,R,A,L;for(y.beginPath(),R=0;R<S.length;R++){var N=S[R],O=N.parts;if(N.render.visible)if(_.showAxes)for(A=O.length>1?1:0;A<O.length;A++)for(b=O[A],L=0;L<b.axes.length;L++){var D=b.axes[L];y.moveTo(b.position.x,b.position.y),y.lineTo(b.position.x+D.x*20,b.position.y+D.y*20)}else for(A=O.length>1?1:0;A<O.length;A++)for(b=O[A],L=0;L<b.axes.length;L++)y.moveTo(b.position.x,b.position.y),y.lineTo((b.vertices[0].x+b.vertices[b.vertices.length-1].x)/2,(b.vertices[0].y+b.vertices[b.vertices.length-1].y)/2)}_.wireframes?(y.strokeStyle="indianred",y.lineWidth=1):(y.strokeStyle="rgba(255, 255, 255, 0.4)",y.globalCompositeOperation="overlay",y.lineWidth=2),y.stroke(),y.globalCompositeOperation="source-over"},n.bodyPositions=function(x,S,w){var y=w,E=x.engine,_=x.options,b,R,A,L;for(y.beginPath(),A=0;A<S.length;A++)if(b=S[A],!!b.render.visible)for(L=0;L<b.parts.length;L++)R=b.parts[L],y.arc(R.position.x,R.position.y,3,0,2*Math.PI,!1),y.closePath();for(_.wireframes?y.fillStyle="indianred":y.fillStyle="rgba(0,0,0,0.5)",y.fill(),y.beginPath(),A=0;A<S.length;A++)b=S[A],b.render.visible&&(y.arc(b.positionPrev.x,b.positionPrev.y,2,0,2*Math.PI,!1),y.closePath());y.fillStyle="rgba(255,165,0,0.8)",y.fill()},n.bodyVelocity=function(x,S,w){var y=w;y.beginPath();for(var E=0;E<S.length;E++){var _=S[E];if(_.render.visible){var b=i.getVelocity(_);y.moveTo(_.position.x,_.position.y),y.lineTo(_.position.x+b.x,_.position.y+b.y)}}y.lineWidth=3,y.strokeStyle="cornflowerblue",y.stroke()},n.bodyIds=function(x,S,w){var y=w,E,_;for(E=0;E<S.length;E++)if(S[E].render.visible){var b=S[E].parts;for(_=b.length>1?1:0;_<b.length;_++){var R=b[_];y.font="12px Arial",y.fillStyle="rgba(255,255,255,0.5)",y.fillText(R.id,R.position.x+10,R.position.y-10)}}},n.collisions=function(x,S,w){var y=w,E=x.options,_,b,R,A,L,N,O;for(y.beginPath(),N=0;N<S.length;N++)if(_=S[N],!!_.isActive)for(b=_.collision,O=0;O<_.contactCount;O++){var D=_.contacts[O],F=D.vertex;y.rect(F.x-1.5,F.y-1.5,3.5,3.5)}for(E.wireframes?y.fillStyle="rgba(255,255,255,0.7)":y.fillStyle="orange",y.fill(),y.beginPath(),N=0;N<S.length;N++)if(_=S[N],!!_.isActive&&(b=_.collision,_.contactCount>0)){var k=_.contacts[0].vertex.x,Q=_.contacts[0].vertex.y;_.contactCount===2&&(k=(_.contacts[0].vertex.x+_.contacts[1].vertex.x)/2,Q=(_.contacts[0].vertex.y+_.contacts[1].vertex.y)/2),b.bodyB===b.supports[0].body||b.bodyA.isStatic===!0?y.moveTo(k-b.normal.x*8,Q-b.normal.y*8):y.moveTo(k+b.normal.x*8,Q+b.normal.y*8),y.lineTo(k,Q)}E.wireframes?y.strokeStyle="rgba(255,165,0,0.7)":y.strokeStyle="orange",y.lineWidth=1,y.stroke()},n.separations=function(x,S,w){var y=w,E=x.options,_,b,R,A,L,N,O;for(y.beginPath(),N=0;N<S.length;N++)if(_=S[N],!!_.isActive){b=_.collision,A=b.bodyA,L=b.bodyB;var D=1;!L.isStatic&&!A.isStatic&&(D=.5),L.isStatic&&(D=0),y.moveTo(L.position.x,L.position.y),y.lineTo(L.position.x-b.penetration.x*D,L.position.y-b.penetration.y*D),D=1,!L.isStatic&&!A.isStatic&&(D=.5),A.isStatic&&(D=0),y.moveTo(A.position.x,A.position.y),y.lineTo(A.position.x+b.penetration.x*D,A.position.y+b.penetration.y*D)}E.wireframes?y.strokeStyle="rgba(255,165,0,0.5)":y.strokeStyle="orange",y.stroke()},n.inspector=function(x,S){var w=x.engine,y=x.selected,E=x.render,_=E.options,b;if(_.hasBounds){var R=E.bounds.max.x-E.bounds.min.x,A=E.bounds.max.y-E.bounds.min.y,L=R/E.options.width,N=A/E.options.height;S.scale(1/L,1/N),S.translate(-E.bounds.min.x,-E.bounds.min.y)}for(var O=0;O<y.length;O++){var D=y[O].data;switch(S.translate(.5,.5),S.lineWidth=1,S.strokeStyle="rgba(255,165,0,0.9)",S.setLineDash([1,2]),D.type){case"body":b=D.bounds,S.beginPath(),S.rect(Math.floor(b.min.x-3),Math.floor(b.min.y-3),Math.floor(b.max.x-b.min.x+6),Math.floor(b.max.y-b.min.y+6)),S.closePath(),S.stroke();break;case"constraint":var F=D.pointA;D.bodyA&&(F=D.pointB),S.beginPath(),S.arc(F.x,F.y,10,0,2*Math.PI),S.closePath(),S.stroke();break}S.setLineDash([]),S.translate(-.5,-.5)}x.selectStart!==null&&(S.translate(.5,.5),S.lineWidth=1,S.strokeStyle="rgba(255,165,0,0.6)",S.fillStyle="rgba(255,165,0,0.1)",b=x.selectBounds,S.beginPath(),S.rect(Math.floor(b.min.x),Math.floor(b.min.y),Math.floor(b.max.x-b.min.x),Math.floor(b.max.y-b.min.y)),S.closePath(),S.stroke(),S.fill(),S.translate(-.5,-.5)),_.hasBounds&&S.setTransform(1,0,0,1,0,0)};var f=function(x,S){var w=x.engine,y=x.timing,E=y.historySize,_=w.timing.timestamp;y.delta=S-y.lastTime||n._goodDelta,y.lastTime=S,y.timestampElapsed=_-y.lastTimestamp||0,y.lastTimestamp=_,y.deltaHistory.unshift(y.delta),y.deltaHistory.length=Math.min(y.deltaHistory.length,E),y.engineDeltaHistory.unshift(w.timing.lastDelta),y.engineDeltaHistory.length=Math.min(y.engineDeltaHistory.length,E),y.timestampElapsedHistory.unshift(y.timestampElapsed),y.timestampElapsedHistory.length=Math.min(y.timestampElapsedHistory.length,E),y.engineUpdatesHistory.unshift(w.timing.lastUpdatesPerFrame),y.engineUpdatesHistory.length=Math.min(y.engineUpdatesHistory.length,E),y.engineElapsedHistory.unshift(w.timing.lastElapsed),y.engineElapsedHistory.length=Math.min(y.engineElapsedHistory.length,E),y.elapsedHistory.unshift(y.lastElapsed),y.elapsedHistory.length=Math.min(y.elapsedHistory.length,E)},p=function(x){for(var S=0,w=0;w<x.length;w+=1)S+=x[w];return S/x.length||0},v=function(x,S){var w=document.createElement("canvas");return w.width=x,w.height=S,w.oncontextmenu=function(){return!1},w.onselectstart=function(){return!1},w},g=function(x){var S=x.getContext("2d"),w=window.devicePixelRatio||1,y=S.webkitBackingStorePixelRatio||S.mozBackingStorePixelRatio||S.msBackingStorePixelRatio||S.oBackingStorePixelRatio||S.backingStorePixelRatio||1;return w/y},m=function(x,S){var w=x.textures[S];return w||(w=x.textures[S]=new Image,w.src=S,w)},M=function(x,S){var w=S;/(jpg|gif|png)$/.test(S)&&(w="url("+S+")"),x.canvas.style.background=w,x.canvas.style.backgroundSize="contain",x.currentBackground=S}})()},function(s,e,t){var n={};s.exports=n;var i=t(5),r=t(17),a=t(0);(function(){n._maxFrameDelta=1e3/15,n._frameDeltaFallback=1e3/60,n._timeBufferMargin=1.5,n._elapsedNextEstimate=1,n._smoothingLowerBound=.1,n._smoothingUpperBound=.9,n.create=function(l){var u={delta:16.666666666666668,frameDelta:null,frameDeltaSmoothing:!0,frameDeltaSnapping:!0,frameDeltaHistory:[],frameDeltaHistorySize:100,frameRequestId:null,timeBuffer:0,timeLastTick:null,maxUpdates:null,maxFrameTime:33.333333333333336,lastUpdatesDeferred:0,enabled:!0},d=a.extend(u,l);return d.fps=0,d},n.run=function(l,u){return l.timeBuffer=n._frameDeltaFallback,function d(o){l.frameRequestId=n._onNextFrame(l,d),o&&l.enabled&&n.tick(l,u,o)}(),l},n.tick=function(l,u,d){var o=a.now(),h=l.delta,f=0,p=d-l.timeLastTick;if((!p||!l.timeLastTick||p>Math.max(n._maxFrameDelta,l.maxFrameTime))&&(p=l.frameDelta||n._frameDeltaFallback),l.frameDeltaSmoothing){l.frameDeltaHistory.push(p),l.frameDeltaHistory=l.frameDeltaHistory.slice(-l.frameDeltaHistorySize);var v=l.frameDeltaHistory.slice(0).sort(),g=l.frameDeltaHistory.slice(v.length*n._smoothingLowerBound,v.length*n._smoothingUpperBound),m=c(g);p=m||p}l.frameDeltaSnapping&&(p=1e3/Math.round(1e3/p)),l.frameDelta=p,l.timeLastTick=d,l.timeBuffer+=l.frameDelta,l.timeBuffer=a.clamp(l.timeBuffer,0,l.frameDelta+h*n._timeBufferMargin),l.lastUpdatesDeferred=0;var M=l.maxUpdates||Math.ceil(l.maxFrameTime/h),x={timestamp:u.timing.timestamp};i.trigger(l,"beforeTick",x),i.trigger(l,"tick",x);for(var S=a.now();h>0&&l.timeBuffer>=h*n._timeBufferMargin;){i.trigger(l,"beforeUpdate",x),r.update(u,h),i.trigger(l,"afterUpdate",x),l.timeBuffer-=h,f+=1;var w=a.now()-o,y=a.now()-S,E=w+n._elapsedNextEstimate*y/f;if(f>=M||E>l.maxFrameTime){l.lastUpdatesDeferred=Math.round(Math.max(0,l.timeBuffer/h-n._timeBufferMargin));break}}u.timing.lastUpdatesPerFrame=f,i.trigger(l,"afterTick",x),l.frameDeltaHistory.length>=100&&(l.lastUpdatesDeferred&&Math.round(l.frameDelta/h)>M?a.warnOnce("Matter.Runner: runner reached runner.maxUpdates, see docs."):l.lastUpdatesDeferred&&a.warnOnce("Matter.Runner: runner reached runner.maxFrameTime, see docs."),typeof l.isFixed<"u"&&a.warnOnce("Matter.Runner: runner.isFixed is now redundant, see docs."),(l.deltaMin||l.deltaMax)&&a.warnOnce("Matter.Runner: runner.deltaMin and runner.deltaMax were removed, see docs."),l.fps!==0&&a.warnOnce("Matter.Runner: runner.fps was replaced by runner.delta, see docs."))},n.stop=function(l){n._cancelNextFrame(l)},n._onNextFrame=function(l,u){if(typeof window<"u"&&window.requestAnimationFrame)l.frameRequestId=window.requestAnimationFrame(u);else throw new Error("Matter.Runner: missing required global window.requestAnimationFrame.");return l.frameRequestId},n._cancelNextFrame=function(l){if(typeof window<"u"&&window.cancelAnimationFrame)window.cancelAnimationFrame(l.frameRequestId);else throw new Error("Matter.Runner: missing required global window.cancelAnimationFrame.")};var c=function(l){for(var u=0,d=l.length,o=0;o<d;o+=1)u+=l[o];return u/d||0}})()},function(s,e,t){var n={};s.exports=n;var i=t(8),r=t(0),a=r.deprecated;(function(){n.collides=function(c,l){return i.collides(c,l)},a(n,"collides","SAT.collides \u27A4 replaced by Collision.collides")})()},function(s,e,t){var n={};s.exports=n;var i=t(1),r=t(0);(function(){n.pathToVertices=function(a,c){typeof window<"u"&&!("SVGPathSeg"in window)&&r.warn("Svg.pathToVertices: SVGPathSeg not defined, a polyfill is required.");var l,u,d,o,h,f,p,v,g,m,M=[],x,S,w=0,y=0,E=0;c=c||15;var _=function(R,A,L){var N=L%2===1&&L>1;if(!g||R!=g.x||A!=g.y){g&&N?(x=g.x,S=g.y):(x=0,S=0);var O={x:x+R,y:S+A};(N||!g)&&(g=O),M.push(O),y=x+R,E=S+A}},b=function(R){var A=R.pathSegTypeAsLetter.toUpperCase();if(A!=="Z"){switch(A){case"M":case"L":case"T":case"C":case"S":case"Q":y=R.x,E=R.y;break;case"H":y=R.x;break;case"V":E=R.y;break}_(y,E,R.pathSegType)}};for(n._svgPathToAbsolute(a),d=a.getTotalLength(),f=[],l=0;l<a.pathSegList.numberOfItems;l+=1)f.push(a.pathSegList.getItem(l));for(p=f.concat();w<d;){if(m=a.getPathSegAtLength(w),h=f[m],h!=v){for(;p.length&&p[0]!=h;)b(p.shift());v=h}switch(h.pathSegTypeAsLetter.toUpperCase()){case"C":case"T":case"S":case"Q":case"A":o=a.getPointAtLength(w),_(o.x,o.y,0);break}w+=c}for(l=0,u=p.length;l<u;++l)b(p[l]);return M},n._svgPathToAbsolute=function(a){for(var c,l,u,d,o,h,f=a.pathSegList,p=0,v=0,g=f.numberOfItems,m=0;m<g;++m){var M=f.getItem(m),x=M.pathSegTypeAsLetter;if(/[MLHVCSQTA]/.test(x))"x"in M&&(p=M.x),"y"in M&&(v=M.y);else switch("x1"in M&&(u=p+M.x1),"x2"in M&&(o=p+M.x2),"y1"in M&&(d=v+M.y1),"y2"in M&&(h=v+M.y2),"x"in M&&(p+=M.x),"y"in M&&(v+=M.y),x){case"m":f.replaceItem(a.createSVGPathSegMovetoAbs(p,v),m);break;case"l":f.replaceItem(a.createSVGPathSegLinetoAbs(p,v),m);break;case"h":f.replaceItem(a.createSVGPathSegLinetoHorizontalAbs(p),m);break;case"v":f.replaceItem(a.createSVGPathSegLinetoVerticalAbs(v),m);break;case"c":f.replaceItem(a.createSVGPathSegCurvetoCubicAbs(p,v,u,d,o,h),m);break;case"s":f.replaceItem(a.createSVGPathSegCurvetoCubicSmoothAbs(p,v,o,h),m);break;case"q":f.replaceItem(a.createSVGPathSegCurvetoQuadraticAbs(p,v,u,d),m);break;case"t":f.replaceItem(a.createSVGPathSegCurvetoQuadraticSmoothAbs(p,v),m);break;case"a":f.replaceItem(a.createSVGPathSegArcAbs(p,v,M.r1,M.r2,M.angle,M.largeArcFlag,M.sweepFlag),m);break;case"z":case"Z":p=c,v=l;break}(x=="M"||x=="m")&&(c=p,l=v)}}})()},function(s,e,t){var n={};s.exports=n;var i=t(6),r=t(0);(function(){n.create=i.create,n.add=i.add,n.remove=i.remove,n.clear=i.clear,n.addComposite=i.addComposite,n.addBody=i.addBody,n.addConstraint=i.addConstraint})()}])})});var na="184";var tc=0,Bo=1,nc=2;var Rs=1,ia=2,ki=3,In=0,zt=1,nn=2,_n=0,ui=1,zo=2,Vo=3,ko=4,ic=5;var Yn=100,sc=101,rc=102,ac=103,oc=104,lc=200,cc=201,hc=202,uc=203,vr=204,_r=205,fc=206,dc=207,pc=208,mc=209,gc=210,xc=211,vc=212,_c=213,yc=214,yr=0,Sr=1,Mr=2,fi=3,br=4,wr=5,Tr=6,Er=7,Go=0,Sc=1,Mc=2,hn=0,Ho=1,Wo=2,Xo=3,qo=4,Yo=5,Zo=6,Jo=7;var $o=300,ei=301,mi=302,sa=303,ra=304,Ps=306,Di=1e3,gn=1001,Ar=1002,wt=1003,bc=1004;var Is=1005;var Ct=1006,aa=1007;var ti=1008;var Gt=1009,Ko=1010,Qo=1011,Gi=1012,oa=1013,un=1014,fn=1015,yn=1016,la=1017,ca=1018,Hi=1020,jo=35902,el=35899,tl=1021,nl=1022,sn=1023,xn=1026,ni=1027,il=1028,ha=1029,ii=1030,ua=1031;var fa=1033,Ls=33776,Ds=33777,Us=33778,Ns=33779,da=35840,pa=35841,ma=35842,ga=35843,xa=36196,va=37492,_a=37496,ya=37488,Sa=37489,Fs=37490,Ma=37491,ba=37808,wa=37809,Ta=37810,Ea=37811,Aa=37812,Ca=37813,Ra=37814,Pa=37815,Ia=37816,La=37817,Da=37818,Ua=37819,Na=37820,Fa=37821,Oa=36492,Ba=36494,za=36495,Va=36283,ka=36284,Os=36285,Ga=36286;var is=2300,Cr=2301,xr=2302,Co=2303,Ro=2400,Po=2401,Io=2402;var wc=3200;var Ha=0,Tc=1,Nn="",bt="srgb",ss="srgb-linear",rs="linear",ht="srgb";var hi=7680;var Lo=519,Ec=512,Ac=513,Cc=514,Wa=515,Rc=516,Pc=517,Xa=518,Ic=519,Do=35044;var sl="300 es",cn=2e3,Ui=2001;function wh(s){for(let e=s.length-1;e>=0;--e)if(s[e]>=65535)return!0;return!1}function Th(s){return ArrayBuffer.isView(s)&&!(s instanceof DataView)}function as(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}function Lc(){let s=as("canvas");return s.style.display="block",s}var Dl={},Ni=null;function rl(...s){let e="THREE."+s.shift();Ni?Ni("log",e,...s):console.log(e,...s)}function Dc(s){let e=s[0];if(typeof e=="string"&&e.startsWith("TSL:")){let t=s[1];t&&t.isStackTrace?s[0]+=" "+t.getLocation():s[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return s}function Fe(...s){s=Dc(s);let e="THREE."+s.shift();if(Ni)Ni("warn",e,...s);else{let t=s[0];t&&t.isStackTrace?console.warn(t.getError(e)):console.warn(e,...s)}}function Be(...s){s=Dc(s);let e="THREE."+s.shift();if(Ni)Ni("error",e,...s);else{let t=s[0];t&&t.isStackTrace?console.error(t.getError(e)):console.error(e,...s)}}function Rr(...s){let e=s.join(" ");e in Dl||(Dl[e]=!0,Fe(...s))}function Uc(s,e,t){return new Promise(function(n,i){function r(){switch(s.clientWaitSync(e,s.SYNC_FLUSH_COMMANDS_BIT,0)){case s.WAIT_FAILED:i();break;case s.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}var Nc={[yr]:Sr,[Mr]:Tr,[br]:Er,[fi]:wr,[Sr]:yr,[Tr]:Mr,[Er]:br,[wr]:fi},vn=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let i=n[e];if(i!==void 0){let r=i.indexOf(t);r!==-1&&i.splice(r,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let i=n.slice(0);for(let r=0,a=i.length;r<a;r++)i[r].call(this,e);e.target=null}}},Ut=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var no=Math.PI/180,Pr=180/Math.PI;function Bs(){let s=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Ut[s&255]+Ut[s>>8&255]+Ut[s>>16&255]+Ut[s>>24&255]+"-"+Ut[e&255]+Ut[e>>8&255]+"-"+Ut[e>>16&15|64]+Ut[e>>24&255]+"-"+Ut[t&63|128]+Ut[t>>8&255]+"-"+Ut[t>>16&255]+Ut[t>>24&255]+Ut[n&255]+Ut[n>>8&255]+Ut[n>>16&255]+Ut[n>>24&255]).toLowerCase()}function tt(s,e,t){return Math.max(e,Math.min(t,s))}function Eh(s,e){return(s%e+e)%e}function io(s,e,t){return(1-t)*s+t*e}function Ki(s,e){switch(e.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("Invalid component type.")}}function kt(s,e){switch(e.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("Invalid component type.")}}var hl=class hl{constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6],this.y=i[1]*t+i[4]*n+i[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=tt(this.x,e.x,t.x),this.y=tt(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=tt(this.x,e,t),this.y=tt(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(tt(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(tt(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),i=Math.sin(t),r=this.x-e.x,a=this.y-e.y;return this.x=r*n-a*i+e.x,this.y=r*i+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};hl.prototype.isVector2=!0;var Je=hl,en=class{constructor(e=0,t=0,n=0,i=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=i}static slerpFlat(e,t,n,i,r,a,c){let l=n[i+0],u=n[i+1],d=n[i+2],o=n[i+3],h=r[a+0],f=r[a+1],p=r[a+2],v=r[a+3];if(o!==v||l!==h||u!==f||d!==p){let g=l*h+u*f+d*p+o*v;g<0&&(h=-h,f=-f,p=-p,v=-v,g=-g);let m=1-c;if(g<.9995){let M=Math.acos(g),x=Math.sin(M);m=Math.sin(m*M)/x,c=Math.sin(c*M)/x,l=l*m+h*c,u=u*m+f*c,d=d*m+p*c,o=o*m+v*c}else{l=l*m+h*c,u=u*m+f*c,d=d*m+p*c,o=o*m+v*c;let M=1/Math.sqrt(l*l+u*u+d*d+o*o);l*=M,u*=M,d*=M,o*=M}}e[t]=l,e[t+1]=u,e[t+2]=d,e[t+3]=o}static multiplyQuaternionsFlat(e,t,n,i,r,a){let c=n[i],l=n[i+1],u=n[i+2],d=n[i+3],o=r[a],h=r[a+1],f=r[a+2],p=r[a+3];return e[t]=c*p+d*o+l*f-u*h,e[t+1]=l*p+d*h+u*o-c*f,e[t+2]=u*p+d*f+c*h-l*o,e[t+3]=d*p-c*o-l*h-u*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,i){return this._x=e,this._y=t,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,i=e._y,r=e._z,a=e._order,c=Math.cos,l=Math.sin,u=c(n/2),d=c(i/2),o=c(r/2),h=l(n/2),f=l(i/2),p=l(r/2);switch(a){case"XYZ":this._x=h*d*o+u*f*p,this._y=u*f*o-h*d*p,this._z=u*d*p+h*f*o,this._w=u*d*o-h*f*p;break;case"YXZ":this._x=h*d*o+u*f*p,this._y=u*f*o-h*d*p,this._z=u*d*p-h*f*o,this._w=u*d*o+h*f*p;break;case"ZXY":this._x=h*d*o-u*f*p,this._y=u*f*o+h*d*p,this._z=u*d*p+h*f*o,this._w=u*d*o-h*f*p;break;case"ZYX":this._x=h*d*o-u*f*p,this._y=u*f*o+h*d*p,this._z=u*d*p-h*f*o,this._w=u*d*o+h*f*p;break;case"YZX":this._x=h*d*o+u*f*p,this._y=u*f*o+h*d*p,this._z=u*d*p-h*f*o,this._w=u*d*o-h*f*p;break;case"XZY":this._x=h*d*o-u*f*p,this._y=u*f*o-h*d*p,this._z=u*d*p+h*f*o,this._w=u*d*o+h*f*p;break;default:Fe("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,i=Math.sin(n);return this._x=e.x*i,this._y=e.y*i,this._z=e.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],i=t[4],r=t[8],a=t[1],c=t[5],l=t[9],u=t[2],d=t[6],o=t[10],h=n+c+o;if(h>0){let f=.5/Math.sqrt(h+1);this._w=.25/f,this._x=(d-l)*f,this._y=(r-u)*f,this._z=(a-i)*f}else if(n>c&&n>o){let f=2*Math.sqrt(1+n-c-o);this._w=(d-l)/f,this._x=.25*f,this._y=(i+a)/f,this._z=(r+u)/f}else if(c>o){let f=2*Math.sqrt(1+c-n-o);this._w=(r-u)/f,this._x=(i+a)/f,this._y=.25*f,this._z=(l+d)/f}else{let f=2*Math.sqrt(1+o-n-c);this._w=(a-i)/f,this._x=(r+u)/f,this._y=(l+d)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(tt(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let i=Math.min(1,t/n);return this.slerp(e,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,i=e._y,r=e._z,a=e._w,c=t._x,l=t._y,u=t._z,d=t._w;return this._x=n*d+a*c+i*u-r*l,this._y=i*d+a*l+r*c-n*u,this._z=r*d+a*u+n*l-i*c,this._w=a*d-n*c-i*l-r*u,this._onChangeCallback(),this}slerp(e,t){let n=e._x,i=e._y,r=e._z,a=e._w,c=this.dot(e);c<0&&(n=-n,i=-i,r=-r,a=-a,c=-c);let l=1-t;if(c<.9995){let u=Math.acos(c),d=Math.sin(u);l=Math.sin(l*u)/d,t=Math.sin(t*u)/d,this._x=this._x*l+n*t,this._y=this._y*l+i*t,this._z=this._z*l+r*t,this._w=this._w*l+a*t,this._onChangeCallback()}else this._x=this._x*l+n*t,this._y=this._y*l+i*t,this._z=this._z*l+r*t,this._w=this._w*l+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(i*Math.sin(e),i*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},ul=class ul{constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Ul.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Ul.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,i=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*i,this.y=r[1]*t+r[4]*n+r[7]*i,this.z=r[2]*t+r[5]*n+r[8]*i,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,i=this.z,r=e.elements,a=1/(r[3]*t+r[7]*n+r[11]*i+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*i+r[12])*a,this.y=(r[1]*t+r[5]*n+r[9]*i+r[13])*a,this.z=(r[2]*t+r[6]*n+r[10]*i+r[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,i=this.z,r=e.x,a=e.y,c=e.z,l=e.w,u=2*(a*i-c*n),d=2*(c*t-r*i),o=2*(r*n-a*t);return this.x=t+l*u+a*o-c*d,this.y=n+l*d+c*u-r*o,this.z=i+l*o+r*d-a*u,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,i=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*i,this.y=r[1]*t+r[5]*n+r[9]*i,this.z=r[2]*t+r[6]*n+r[10]*i,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=tt(this.x,e.x,t.x),this.y=tt(this.y,e.y,t.y),this.z=tt(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=tt(this.x,e,t),this.y=tt(this.y,e,t),this.z=tt(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(tt(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,i=e.y,r=e.z,a=t.x,c=t.y,l=t.z;return this.x=i*l-r*c,this.y=r*a-n*l,this.z=n*c-i*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return so.copy(this).projectOnVector(e),this.sub(so)}reflect(e){return this.sub(so.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(tt(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,i=this.z-e.z;return t*t+n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let i=Math.sin(t)*e;return this.x=i*Math.sin(n),this.y=Math.cos(t)*e,this.z=i*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),i=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=i,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};ul.prototype.isVector3=!0;var H=ul,so=new H,Ul=new en,fl=class fl{constructor(e,t,n,i,r,a,c,l,u){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,i,r,a,c,l,u)}set(e,t,n,i,r,a,c,l,u){let d=this.elements;return d[0]=e,d[1]=i,d[2]=c,d[3]=t,d[4]=r,d[5]=l,d[6]=n,d[7]=a,d[8]=u,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,i=t.elements,r=this.elements,a=n[0],c=n[3],l=n[6],u=n[1],d=n[4],o=n[7],h=n[2],f=n[5],p=n[8],v=i[0],g=i[3],m=i[6],M=i[1],x=i[4],S=i[7],w=i[2],y=i[5],E=i[8];return r[0]=a*v+c*M+l*w,r[3]=a*g+c*x+l*y,r[6]=a*m+c*S+l*E,r[1]=u*v+d*M+o*w,r[4]=u*g+d*x+o*y,r[7]=u*m+d*S+o*E,r[2]=h*v+f*M+p*w,r[5]=h*g+f*x+p*y,r[8]=h*m+f*S+p*E,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],i=e[2],r=e[3],a=e[4],c=e[5],l=e[6],u=e[7],d=e[8];return t*a*d-t*c*u-n*r*d+n*c*l+i*r*u-i*a*l}invert(){let e=this.elements,t=e[0],n=e[1],i=e[2],r=e[3],a=e[4],c=e[5],l=e[6],u=e[7],d=e[8],o=d*a-c*u,h=c*l-d*r,f=u*r-a*l,p=t*o+n*h+i*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let v=1/p;return e[0]=o*v,e[1]=(i*u-d*n)*v,e[2]=(c*n-i*a)*v,e[3]=h*v,e[4]=(d*t-i*l)*v,e[5]=(i*r-c*t)*v,e[6]=f*v,e[7]=(n*l-u*t)*v,e[8]=(a*t-n*r)*v,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,i,r,a,c){let l=Math.cos(r),u=Math.sin(r);return this.set(n*l,n*u,-n*(l*a+u*c)+a+e,-i*u,i*l,-i*(-u*a+l*c)+c+t,0,0,1),this}scale(e,t){return this.premultiply(ro.makeScale(e,t)),this}rotate(e){return this.premultiply(ro.makeRotation(-e)),this}translate(e,t){return this.premultiply(ro.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let i=0;i<9;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}};fl.prototype.isMatrix3=!0;var We=fl,ro=new We,Nl=new We().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Fl=new We().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Ah(){let s={enabled:!0,workingColorSpace:ss,spaces:{},convert:function(i,r,a){return this.enabled===!1||r===a||!r||!a||(this.spaces[r].transfer===ht&&(i.r=Pn(i.r),i.g=Pn(i.g),i.b=Pn(i.b)),this.spaces[r].primaries!==this.spaces[a].primaries&&(i.applyMatrix3(this.spaces[r].toXYZ),i.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===ht&&(i.r=Li(i.r),i.g=Li(i.g),i.b=Li(i.b))),i},workingToColorSpace:function(i,r){return this.convert(i,this.workingColorSpace,r)},colorSpaceToWorking:function(i,r){return this.convert(i,r,this.workingColorSpace)},getPrimaries:function(i){return this.spaces[i].primaries},getTransfer:function(i){return i===Nn?rs:this.spaces[i].transfer},getToneMappingMode:function(i){return this.spaces[i].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(i,r=this.workingColorSpace){return i.fromArray(this.spaces[r].luminanceCoefficients)},define:function(i){Object.assign(this.spaces,i)},_getMatrix:function(i,r,a){return i.copy(this.spaces[r].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(i){return this.spaces[i].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(i=this.workingColorSpace){return this.spaces[i].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(i,r){return Rr("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),s.workingToColorSpace(i,r)},toWorkingColorSpace:function(i,r){return Rr("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),s.colorSpaceToWorking(i,r)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return s.define({[ss]:{primaries:e,whitePoint:n,transfer:rs,toXYZ:Nl,fromXYZ:Fl,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:bt},outputColorSpaceConfig:{drawingBufferColorSpace:bt}},[bt]:{primaries:e,whitePoint:n,transfer:ht,toXYZ:Nl,fromXYZ:Fl,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:bt}}}),s}var et=Ah();function Pn(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function Li(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}var yi,Ir=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{yi===void 0&&(yi=as("canvas")),yi.width=e.width,yi.height=e.height;let i=yi.getContext("2d");e instanceof ImageData?i.putImageData(e,0,0):i.drawImage(e,0,0,e.width,e.height),n=yi}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=as("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let i=n.getImageData(0,0,e.width,e.height),r=i.data;for(let a=0;a<r.length;a++)r[a]=Pn(r[a]/255)*255;return n.putImageData(i,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Pn(t[n]/255)*255):t[n]=Pn(t[n]);return{data:t,width:e.width,height:e.height}}else return Fe("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},Ch=0,Fi=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Ch++}),this.uuid=Bs(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<"u"&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let r;if(Array.isArray(i)){r=[];for(let a=0,c=i.length;a<c;a++)i[a].isDataTexture?r.push(ao(i[a].image)):r.push(ao(i[a]))}else r=ao(i);n.url=r}return t||(e.images[this.uuid]=n),n}};function ao(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?Ir.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(Fe("Texture: Unable to serialize Texture."),{})}var Rh=0,oo=new H,Bt=class s extends vn{constructor(e=s.DEFAULT_IMAGE,t=s.DEFAULT_MAPPING,n=gn,i=gn,r=Ct,a=ti,c=sn,l=Gt,u=s.DEFAULT_ANISOTROPY,d=Nn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Rh++}),this.uuid=Bs(),this.name="",this.source=new Fi(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=r,this.minFilter=a,this.anisotropy=u,this.format=c,this.internalFormat=null,this.type=l,this.offset=new Je(0,0),this.repeat=new Je(1,1),this.center=new Je(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new We,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=d,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(oo).x}get height(){return this.source.getSize(oo).y}get depth(){return this.source.getSize(oo).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){Fe(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let i=this[t];if(i===void 0){Fe(`Texture.setValues(): property '${t}' does not exist.`);continue}i&&n&&i.isVector2&&n.isVector2||i&&n&&i.isVector3&&n.isVector3||i&&n&&i.isMatrix3&&n.isMatrix3?i.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==$o)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Di:e.x=e.x-Math.floor(e.x);break;case gn:e.x=e.x<0?0:1;break;case Ar:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Di:e.y=e.y-Math.floor(e.y);break;case gn:e.y=e.y<0?0:1;break;case Ar:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Bt.DEFAULT_IMAGE=null;Bt.DEFAULT_MAPPING=$o;Bt.DEFAULT_ANISOTROPY=1;var dl=class dl{constructor(e=0,t=0,n=0,i=1){this.x=e,this.y=t,this.z=n,this.w=i}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,i){return this.x=e,this.y=t,this.z=n,this.w=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,i=this.z,r=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*i+a[12]*r,this.y=a[1]*t+a[5]*n+a[9]*i+a[13]*r,this.z=a[2]*t+a[6]*n+a[10]*i+a[14]*r,this.w=a[3]*t+a[7]*n+a[11]*i+a[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,i,r,l=e.elements,u=l[0],d=l[4],o=l[8],h=l[1],f=l[5],p=l[9],v=l[2],g=l[6],m=l[10];if(Math.abs(d-h)<.01&&Math.abs(o-v)<.01&&Math.abs(p-g)<.01){if(Math.abs(d+h)<.1&&Math.abs(o+v)<.1&&Math.abs(p+g)<.1&&Math.abs(u+f+m-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let x=(u+1)/2,S=(f+1)/2,w=(m+1)/2,y=(d+h)/4,E=(o+v)/4,_=(p+g)/4;return x>S&&x>w?x<.01?(n=0,i=.707106781,r=.707106781):(n=Math.sqrt(x),i=y/n,r=E/n):S>w?S<.01?(n=.707106781,i=0,r=.707106781):(i=Math.sqrt(S),n=y/i,r=_/i):w<.01?(n=.707106781,i=.707106781,r=0):(r=Math.sqrt(w),n=E/r,i=_/r),this.set(n,i,r,t),this}let M=Math.sqrt((g-p)*(g-p)+(o-v)*(o-v)+(h-d)*(h-d));return Math.abs(M)<.001&&(M=1),this.x=(g-p)/M,this.y=(o-v)/M,this.z=(h-d)/M,this.w=Math.acos((u+f+m-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=tt(this.x,e.x,t.x),this.y=tt(this.y,e.y,t.y),this.z=tt(this.z,e.z,t.z),this.w=tt(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=tt(this.x,e,t),this.y=tt(this.y,e,t),this.z=tt(this.z,e,t),this.w=tt(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(tt(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};dl.prototype.isVector4=!0;var xt=dl,Lr=class extends vn{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Ct,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new xt(0,0,e,t),this.scissorTest=!1,this.viewport=new xt(0,0,e,t),this.textures=[];let i={width:e,height:t,depth:n.depth},r=new Bt(i),a=n.count;for(let c=0;c<a;c++)this.textures[c]=r.clone(),this.textures[c].isRenderTargetTexture=!0,this.textures[c].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview}_setTextureOptions(e={}){let t={minFilter:Ct,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let i=0,r=this.textures.length;i<r;i++)this.textures[i].image.width=e,this.textures[i].image.height=t,this.textures[i].image.depth=n,this.textures[i].isData3DTexture!==!0&&(this.textures[i].isArrayTexture=this.textures[i].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let i=Object.assign({},e.textures[t].image);this.textures[t].source=new Fi(i)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},Yt=class extends Lr{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},os=class extends Bt{constructor(e=null,t=1,n=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=wt,this.minFilter=wt,this.wrapR=gn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var Dr=class extends Bt{constructor(e=null,t=1,n=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=wt,this.minFilter=wt,this.wrapR=gn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var ta=class ta{constructor(e,t,n,i,r,a,c,l,u,d,o,h,f,p,v,g){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,i,r,a,c,l,u,d,o,h,f,p,v,g)}set(e,t,n,i,r,a,c,l,u,d,o,h,f,p,v,g){let m=this.elements;return m[0]=e,m[4]=t,m[8]=n,m[12]=i,m[1]=r,m[5]=a,m[9]=c,m[13]=l,m[2]=u,m[6]=d,m[10]=o,m[14]=h,m[3]=f,m[7]=p,m[11]=v,m[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new ta().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinant()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let t=this.elements,n=e.elements,i=1/Si.setFromMatrixColumn(e,0).length(),r=1/Si.setFromMatrixColumn(e,1).length(),a=1/Si.setFromMatrixColumn(e,2).length();return t[0]=n[0]*i,t[1]=n[1]*i,t[2]=n[2]*i,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,i=e.y,r=e.z,a=Math.cos(n),c=Math.sin(n),l=Math.cos(i),u=Math.sin(i),d=Math.cos(r),o=Math.sin(r);if(e.order==="XYZ"){let h=a*d,f=a*o,p=c*d,v=c*o;t[0]=l*d,t[4]=-l*o,t[8]=u,t[1]=f+p*u,t[5]=h-v*u,t[9]=-c*l,t[2]=v-h*u,t[6]=p+f*u,t[10]=a*l}else if(e.order==="YXZ"){let h=l*d,f=l*o,p=u*d,v=u*o;t[0]=h+v*c,t[4]=p*c-f,t[8]=a*u,t[1]=a*o,t[5]=a*d,t[9]=-c,t[2]=f*c-p,t[6]=v+h*c,t[10]=a*l}else if(e.order==="ZXY"){let h=l*d,f=l*o,p=u*d,v=u*o;t[0]=h-v*c,t[4]=-a*o,t[8]=p+f*c,t[1]=f+p*c,t[5]=a*d,t[9]=v-h*c,t[2]=-a*u,t[6]=c,t[10]=a*l}else if(e.order==="ZYX"){let h=a*d,f=a*o,p=c*d,v=c*o;t[0]=l*d,t[4]=p*u-f,t[8]=h*u+v,t[1]=l*o,t[5]=v*u+h,t[9]=f*u-p,t[2]=-u,t[6]=c*l,t[10]=a*l}else if(e.order==="YZX"){let h=a*l,f=a*u,p=c*l,v=c*u;t[0]=l*d,t[4]=v-h*o,t[8]=p*o+f,t[1]=o,t[5]=a*d,t[9]=-c*d,t[2]=-u*d,t[6]=f*o+p,t[10]=h-v*o}else if(e.order==="XZY"){let h=a*l,f=a*u,p=c*l,v=c*u;t[0]=l*d,t[4]=-o,t[8]=u*d,t[1]=h*o+v,t[5]=a*d,t[9]=f*o-p,t[2]=p*o-f,t[6]=c*d,t[10]=v*o+h}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Ph,e,Ih)}lookAt(e,t,n){let i=this.elements;return Wt.subVectors(e,t),Wt.lengthSq()===0&&(Wt.z=1),Wt.normalize(),Vn.crossVectors(n,Wt),Vn.lengthSq()===0&&(Math.abs(n.z)===1?Wt.x+=1e-4:Wt.z+=1e-4,Wt.normalize(),Vn.crossVectors(n,Wt)),Vn.normalize(),Js.crossVectors(Wt,Vn),i[0]=Vn.x,i[4]=Js.x,i[8]=Wt.x,i[1]=Vn.y,i[5]=Js.y,i[9]=Wt.y,i[2]=Vn.z,i[6]=Js.z,i[10]=Wt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,i=t.elements,r=this.elements,a=n[0],c=n[4],l=n[8],u=n[12],d=n[1],o=n[5],h=n[9],f=n[13],p=n[2],v=n[6],g=n[10],m=n[14],M=n[3],x=n[7],S=n[11],w=n[15],y=i[0],E=i[4],_=i[8],b=i[12],R=i[1],A=i[5],L=i[9],N=i[13],O=i[2],D=i[6],F=i[10],k=i[14],Q=i[3],ie=i[7],oe=i[11],xe=i[15];return r[0]=a*y+c*R+l*O+u*Q,r[4]=a*E+c*A+l*D+u*ie,r[8]=a*_+c*L+l*F+u*oe,r[12]=a*b+c*N+l*k+u*xe,r[1]=d*y+o*R+h*O+f*Q,r[5]=d*E+o*A+h*D+f*ie,r[9]=d*_+o*L+h*F+f*oe,r[13]=d*b+o*N+h*k+f*xe,r[2]=p*y+v*R+g*O+m*Q,r[6]=p*E+v*A+g*D+m*ie,r[10]=p*_+v*L+g*F+m*oe,r[14]=p*b+v*N+g*k+m*xe,r[3]=M*y+x*R+S*O+w*Q,r[7]=M*E+x*A+S*D+w*ie,r[11]=M*_+x*L+S*F+w*oe,r[15]=M*b+x*N+S*k+w*xe,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],i=e[8],r=e[12],a=e[1],c=e[5],l=e[9],u=e[13],d=e[2],o=e[6],h=e[10],f=e[14],p=e[3],v=e[7],g=e[11],m=e[15],M=l*f-u*h,x=c*f-u*o,S=c*h-l*o,w=a*f-u*d,y=a*h-l*d,E=a*o-c*d;return t*(v*M-g*x+m*S)-n*(p*M-g*w+m*y)+i*(p*x-v*w+m*E)-r*(p*S-v*y+g*E)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let i=this.elements;return e.isVector3?(i[12]=e.x,i[13]=e.y,i[14]=e.z):(i[12]=e,i[13]=t,i[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],i=e[2],r=e[3],a=e[4],c=e[5],l=e[6],u=e[7],d=e[8],o=e[9],h=e[10],f=e[11],p=e[12],v=e[13],g=e[14],m=e[15],M=t*c-n*a,x=t*l-i*a,S=t*u-r*a,w=n*l-i*c,y=n*u-r*c,E=i*u-r*l,_=d*v-o*p,b=d*g-h*p,R=d*m-f*p,A=o*g-h*v,L=o*m-f*v,N=h*m-f*g,O=M*N-x*L+S*A+w*R-y*b+E*_;if(O===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let D=1/O;return e[0]=(c*N-l*L+u*A)*D,e[1]=(i*L-n*N-r*A)*D,e[2]=(v*E-g*y+m*w)*D,e[3]=(h*y-o*E-f*w)*D,e[4]=(l*R-a*N-u*b)*D,e[5]=(t*N-i*R+r*b)*D,e[6]=(g*S-p*E-m*x)*D,e[7]=(d*E-h*S+f*x)*D,e[8]=(a*L-c*R+u*_)*D,e[9]=(n*R-t*L-r*_)*D,e[10]=(p*y-v*S+m*M)*D,e[11]=(o*S-d*y-f*M)*D,e[12]=(c*b-a*A-l*_)*D,e[13]=(t*A-n*b+i*_)*D,e[14]=(v*x-p*w-g*M)*D,e[15]=(d*w-o*x+h*M)*D,this}scale(e){let t=this.elements,n=e.x,i=e.y,r=e.z;return t[0]*=n,t[4]*=i,t[8]*=r,t[1]*=n,t[5]*=i,t[9]*=r,t[2]*=n,t[6]*=i,t[10]*=r,t[3]*=n,t[7]*=i,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],i=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,i))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),i=Math.sin(t),r=1-n,a=e.x,c=e.y,l=e.z,u=r*a,d=r*c;return this.set(u*a+n,u*c-i*l,u*l+i*c,0,u*c+i*l,d*c+n,d*l-i*a,0,u*l-i*c,d*l+i*a,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,i,r,a){return this.set(1,n,r,0,e,1,a,0,t,i,1,0,0,0,0,1),this}compose(e,t,n){let i=this.elements,r=t._x,a=t._y,c=t._z,l=t._w,u=r+r,d=a+a,o=c+c,h=r*u,f=r*d,p=r*o,v=a*d,g=a*o,m=c*o,M=l*u,x=l*d,S=l*o,w=n.x,y=n.y,E=n.z;return i[0]=(1-(v+m))*w,i[1]=(f+S)*w,i[2]=(p-x)*w,i[3]=0,i[4]=(f-S)*y,i[5]=(1-(h+m))*y,i[6]=(g+M)*y,i[7]=0,i[8]=(p+x)*E,i[9]=(g-M)*E,i[10]=(1-(h+v))*E,i[11]=0,i[12]=e.x,i[13]=e.y,i[14]=e.z,i[15]=1,this}decompose(e,t,n){let i=this.elements;e.x=i[12],e.y=i[13],e.z=i[14];let r=this.determinant();if(r===0)return n.set(1,1,1),t.identity(),this;let a=Si.set(i[0],i[1],i[2]).length(),c=Si.set(i[4],i[5],i[6]).length(),l=Si.set(i[8],i[9],i[10]).length();r<0&&(a=-a),an.copy(this);let u=1/a,d=1/c,o=1/l;return an.elements[0]*=u,an.elements[1]*=u,an.elements[2]*=u,an.elements[4]*=d,an.elements[5]*=d,an.elements[6]*=d,an.elements[8]*=o,an.elements[9]*=o,an.elements[10]*=o,t.setFromRotationMatrix(an),n.x=a,n.y=c,n.z=l,this}makePerspective(e,t,n,i,r,a,c=cn,l=!1){let u=this.elements,d=2*r/(t-e),o=2*r/(n-i),h=(t+e)/(t-e),f=(n+i)/(n-i),p,v;if(l)p=r/(a-r),v=a*r/(a-r);else if(c===cn)p=-(a+r)/(a-r),v=-2*a*r/(a-r);else if(c===Ui)p=-a/(a-r),v=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+c);return u[0]=d,u[4]=0,u[8]=h,u[12]=0,u[1]=0,u[5]=o,u[9]=f,u[13]=0,u[2]=0,u[6]=0,u[10]=p,u[14]=v,u[3]=0,u[7]=0,u[11]=-1,u[15]=0,this}makeOrthographic(e,t,n,i,r,a,c=cn,l=!1){let u=this.elements,d=2/(t-e),o=2/(n-i),h=-(t+e)/(t-e),f=-(n+i)/(n-i),p,v;if(l)p=1/(a-r),v=a/(a-r);else if(c===cn)p=-2/(a-r),v=-(a+r)/(a-r);else if(c===Ui)p=-1/(a-r),v=-r/(a-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+c);return u[0]=d,u[4]=0,u[8]=0,u[12]=h,u[1]=0,u[5]=o,u[9]=0,u[13]=f,u[2]=0,u[6]=0,u[10]=p,u[14]=v,u[3]=0,u[7]=0,u[11]=0,u[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let i=0;i<16;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}};ta.prototype.isMatrix4=!0;var gt=ta,Si=new H,an=new gt,Ph=new H(0,0,0),Ih=new H(1,1,1),Vn=new H,Js=new H,Wt=new H,Ol=new gt,Bl=new en,Ln=class s{constructor(e=0,t=0,n=0,i=s.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,i=this._order){return this._x=e,this._y=t,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let i=e.elements,r=i[0],a=i[4],c=i[8],l=i[1],u=i[5],d=i[9],o=i[2],h=i[6],f=i[10];switch(t){case"XYZ":this._y=Math.asin(tt(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(-d,f),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(h,u),this._z=0);break;case"YXZ":this._x=Math.asin(-tt(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(c,f),this._z=Math.atan2(l,u)):(this._y=Math.atan2(-o,r),this._z=0);break;case"ZXY":this._x=Math.asin(tt(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-o,f),this._z=Math.atan2(-a,u)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-tt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(h,f),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,u));break;case"YZX":this._z=Math.asin(tt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-d,u),this._y=Math.atan2(-o,r)):(this._x=0,this._y=Math.atan2(c,f));break;case"XZY":this._z=Math.asin(-tt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(h,u),this._y=Math.atan2(c,r)):(this._x=Math.atan2(-d,f),this._y=0);break;default:Fe("Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Ol.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Ol,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Bl.setFromEuler(this),this.setFromQuaternion(Bl,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Ln.DEFAULT_ORDER="XYZ";var ls=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},Lh=0,zl=new H,Mi=new en,wn=new gt,$s=new H,Qi=new H,Dh=new H,Uh=new en,Vl=new H(1,0,0),kl=new H(0,1,0),Gl=new H(0,0,1),Hl={type:"added"},Nh={type:"removed"},bi={type:"childadded",child:null},lo={type:"childremoved",child:null},Rt=class s extends vn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Lh++}),this.uuid=Bs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=s.DEFAULT_UP.clone();let e=new H,t=new Ln,n=new en,i=new H(1,1,1);function r(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new gt},normalMatrix:{value:new We}}),this.matrix=new gt,this.matrixWorld=new gt,this.matrixAutoUpdate=s.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=s.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ls,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Mi.setFromAxisAngle(e,t),this.quaternion.multiply(Mi),this}rotateOnWorldAxis(e,t){return Mi.setFromAxisAngle(e,t),this.quaternion.premultiply(Mi),this}rotateX(e){return this.rotateOnAxis(Vl,e)}rotateY(e){return this.rotateOnAxis(kl,e)}rotateZ(e){return this.rotateOnAxis(Gl,e)}translateOnAxis(e,t){return zl.copy(e).applyQuaternion(this.quaternion),this.position.add(zl.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Vl,e)}translateY(e){return this.translateOnAxis(kl,e)}translateZ(e){return this.translateOnAxis(Gl,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(wn.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?$s.copy(e):$s.set(e,t,n);let i=this.parent;this.updateWorldMatrix(!0,!1),Qi.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?wn.lookAt(Qi,$s,this.up):wn.lookAt($s,Qi,this.up),this.quaternion.setFromRotationMatrix(wn),i&&(wn.extractRotation(i.matrixWorld),Mi.setFromRotationMatrix(wn),this.quaternion.premultiply(Mi.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(Be("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Hl),bi.child=e,this.dispatchEvent(bi),bi.child=null):Be("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Nh),lo.child=e,this.dispatchEvent(lo),lo.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),wn.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),wn.multiply(e.parent.matrixWorld)),e.applyMatrix4(wn),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Hl),bi.child=e,this.dispatchEvent(bi),bi.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,i=this.children.length;n<i;n++){let a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let i=this.children;for(let r=0,a=i.length;r<a;r++)i[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Qi,e,Dh),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Qi,Uh,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,i=e.z,r=this.matrix.elements;r[12]+=t-r[0]*t-r[4]*n-r[8]*i,r[13]+=n-r[1]*t-r[5]*n-r[9]*i,r[14]+=i-r[2]*t-r[6]*n-r[10]*i}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){let n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){let i=this.children;for(let r=0,a=i.length;r<a;r++)i[r].updateWorldMatrix(!1,!0)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let i={};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.castShadow===!0&&(i.castShadow=!0),this.receiveShadow===!0&&(i.receiveShadow=!0),this.visible===!1&&(i.visible=!1),this.frustumCulled===!1&&(i.frustumCulled=!1),this.renderOrder!==0&&(i.renderOrder=this.renderOrder),this.static!==!1&&(i.static=this.static),Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.pivot!==null&&(i.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(i.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(i.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(i.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.geometryInfo=this._geometryInfo.map(c=>({...c,boundingBox:c.boundingBox?c.boundingBox.toJSON():void 0,boundingSphere:c.boundingSphere?c.boundingSphere.toJSON():void 0})),i.instanceInfo=this._instanceInfo.map(c=>({...c})),i.availableInstanceIds=this._availableInstanceIds.slice(),i.availableGeometryIds=this._availableGeometryIds.slice(),i.nextIndexStart=this._nextIndexStart,i.nextVertexStart=this._nextVertexStart,i.geometryCount=this._geometryCount,i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.matricesTexture=this._matricesTexture.toJSON(e),i.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(i.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(i.boundingBox=this.boundingBox.toJSON()));function r(c,l){return c[l.uuid]===void 0&&(c[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=r(e.geometries,this.geometry);let c=this.geometry.parameters;if(c!==void 0&&c.shapes!==void 0){let l=c.shapes;if(Array.isArray(l))for(let u=0,d=l.length;u<d;u++){let o=l[u];r(e.shapes,o)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let c=[];for(let l=0,u=this.material.length;l<u;l++)c.push(r(e.materials,this.material[l]));i.material=c}else i.material=r(e.materials,this.material);if(this.children.length>0){i.children=[];for(let c=0;c<this.children.length;c++)i.children.push(this.children[c].toJSON(e).object)}if(this.animations.length>0){i.animations=[];for(let c=0;c<this.animations.length;c++){let l=this.animations[c];i.animations.push(r(e.animations,l))}}if(t){let c=a(e.geometries),l=a(e.materials),u=a(e.textures),d=a(e.images),o=a(e.shapes),h=a(e.skeletons),f=a(e.animations),p=a(e.nodes);c.length>0&&(n.geometries=c),l.length>0&&(n.materials=l),u.length>0&&(n.textures=u),d.length>0&&(n.images=d),o.length>0&&(n.shapes=o),h.length>0&&(n.skeletons=h),f.length>0&&(n.animations=f),p.length>0&&(n.nodes=p)}return n.object=i,n;function a(c){let l=[];for(let u in c){let d=c[u];delete d.metadata,l.push(d)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let i=e.children[n];this.add(i.clone())}return this}};Rt.DEFAULT_UP=new H(0,1,0);Rt.DEFAULT_MATRIX_AUTO_UPDATE=!0;Rt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Rn=class extends Rt{constructor(){super(),this.isGroup=!0,this.type="Group"}},Fh={type:"move"},Oi=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Rn,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Rn,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new H,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new H),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Rn,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new H,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new H,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let i=null,r=null,a=null,c=this._targetRay,l=this._grip,u=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(u&&e.hand){a=!0;for(let v of e.hand.values()){let g=t.getJointPose(v,n),m=this._getHandJoint(u,v);g!==null&&(m.matrix.fromArray(g.transform.matrix),m.matrix.decompose(m.position,m.rotation,m.scale),m.matrixWorldNeedsUpdate=!0,m.jointRadius=g.radius),m.visible=g!==null}let d=u.joints["index-finger-tip"],o=u.joints["thumb-tip"],h=d.position.distanceTo(o.position),f=.02,p=.005;u.inputState.pinching&&h>f+p?(u.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!u.inputState.pinching&&h<=f-p&&(u.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));c!==null&&(i=t.getPose(e.targetRaySpace,n),i===null&&r!==null&&(i=r),i!==null&&(c.matrix.fromArray(i.transform.matrix),c.matrix.decompose(c.position,c.rotation,c.scale),c.matrixWorldNeedsUpdate=!0,i.linearVelocity?(c.hasLinearVelocity=!0,c.linearVelocity.copy(i.linearVelocity)):c.hasLinearVelocity=!1,i.angularVelocity?(c.hasAngularVelocity=!0,c.angularVelocity.copy(i.angularVelocity)):c.hasAngularVelocity=!1,this.dispatchEvent(Fh)))}return c!==null&&(c.visible=i!==null),l!==null&&(l.visible=r!==null),u!==null&&(u.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new Rn;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},Fc={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},kn={h:0,s:0,l:0},Ks={h:0,s:0,l:0};function co(s,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?s+(e-s)*6*t:t<1/2?e:t<2/3?s+(e-s)*6*(2/3-t):s}var Ke=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let i=e;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=bt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,et.colorSpaceToWorking(this,t),this}setRGB(e,t,n,i=et.workingColorSpace){return this.r=e,this.g=t,this.b=n,et.colorSpaceToWorking(this,i),this}setHSL(e,t,n,i=et.workingColorSpace){if(e=Eh(e,1),t=tt(t,0,1),n=tt(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,a=2*n-r;this.r=co(a,r,e+1/3),this.g=co(a,r,e),this.b=co(a,r,e-1/3)}return et.colorSpaceToWorking(this,i),this}setStyle(e,t=bt){function n(r){r!==void 0&&parseFloat(r)<1&&Fe("Color: Alpha component of "+e+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,a=i[1],c=i[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(c))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(c))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(c))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:Fe("Color: Unknown color model "+e)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=i[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(r,16),t);Fe("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=bt){let n=Fc[e.toLowerCase()];return n!==void 0?this.setHex(n,t):Fe("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Pn(e.r),this.g=Pn(e.g),this.b=Pn(e.b),this}copyLinearToSRGB(e){return this.r=Li(e.r),this.g=Li(e.g),this.b=Li(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=bt){return et.workingToColorSpace(Nt.copy(this),e),Math.round(tt(Nt.r*255,0,255))*65536+Math.round(tt(Nt.g*255,0,255))*256+Math.round(tt(Nt.b*255,0,255))}getHexString(e=bt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=et.workingColorSpace){et.workingToColorSpace(Nt.copy(this),t);let n=Nt.r,i=Nt.g,r=Nt.b,a=Math.max(n,i,r),c=Math.min(n,i,r),l,u,d=(c+a)/2;if(c===a)l=0,u=0;else{let o=a-c;switch(u=d<=.5?o/(a+c):o/(2-a-c),a){case n:l=(i-r)/o+(i<r?6:0);break;case i:l=(r-n)/o+2;break;case r:l=(n-i)/o+4;break}l/=6}return e.h=l,e.s=u,e.l=d,e}getRGB(e,t=et.workingColorSpace){return et.workingToColorSpace(Nt.copy(this),t),e.r=Nt.r,e.g=Nt.g,e.b=Nt.b,e}getStyle(e=bt){et.workingToColorSpace(Nt.copy(this),e);let t=Nt.r,n=Nt.g,i=Nt.b;return e!==bt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(e,t,n){return this.getHSL(kn),this.setHSL(kn.h+e,kn.s+t,kn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(kn),e.getHSL(Ks);let n=io(kn.h,Ks.h,t),i=io(kn.s,Ks.s,t),r=io(kn.l,Ks.l,t);return this.setHSL(n,i,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,i=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*i,this.g=r[1]*t+r[4]*n+r[7]*i,this.b=r[2]*t+r[5]*n+r[8]*i,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Nt=new Ke;Ke.NAMES=Fc;var cs=class s{constructor(e,t=1,n=1e3){this.isFog=!0,this.name="",this.color=new Ke(e),this.near=t,this.far=n}clone(){return new s(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}},hs=class extends Rt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Ln,this.environmentIntensity=1,this.environmentRotation=new Ln,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}},on=new H,Tn=new H,ho=new H,En=new H,wi=new H,Ti=new H,Wl=new H,uo=new H,fo=new H,po=new H,mo=new xt,go=new xt,xo=new xt,qn=class s{constructor(e=new H,t=new H,n=new H){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,i){i.subVectors(n,t),on.subVectors(e,t),i.cross(on);let r=i.lengthSq();return r>0?i.multiplyScalar(1/Math.sqrt(r)):i.set(0,0,0)}static getBarycoord(e,t,n,i,r){on.subVectors(i,t),Tn.subVectors(n,t),ho.subVectors(e,t);let a=on.dot(on),c=on.dot(Tn),l=on.dot(ho),u=Tn.dot(Tn),d=Tn.dot(ho),o=a*u-c*c;if(o===0)return r.set(0,0,0),null;let h=1/o,f=(u*l-c*d)*h,p=(a*d-c*l)*h;return r.set(1-f-p,p,f)}static containsPoint(e,t,n,i){return this.getBarycoord(e,t,n,i,En)===null?!1:En.x>=0&&En.y>=0&&En.x+En.y<=1}static getInterpolation(e,t,n,i,r,a,c,l){return this.getBarycoord(e,t,n,i,En)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,En.x),l.addScaledVector(a,En.y),l.addScaledVector(c,En.z),l)}static getInterpolatedAttribute(e,t,n,i,r,a){return mo.setScalar(0),go.setScalar(0),xo.setScalar(0),mo.fromBufferAttribute(e,t),go.fromBufferAttribute(e,n),xo.fromBufferAttribute(e,i),a.setScalar(0),a.addScaledVector(mo,r.x),a.addScaledVector(go,r.y),a.addScaledVector(xo,r.z),a}static isFrontFacing(e,t,n,i){return on.subVectors(n,t),Tn.subVectors(e,t),on.cross(Tn).dot(i)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,i){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[i]),this}setFromAttributeAndIndices(e,t,n,i){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,i),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return on.subVectors(this.c,this.b),Tn.subVectors(this.a,this.b),on.cross(Tn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return s.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return s.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,i,r){return s.getInterpolation(e,this.a,this.b,this.c,t,n,i,r)}containsPoint(e){return s.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return s.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,i=this.b,r=this.c,a,c;wi.subVectors(i,n),Ti.subVectors(r,n),uo.subVectors(e,n);let l=wi.dot(uo),u=Ti.dot(uo);if(l<=0&&u<=0)return t.copy(n);fo.subVectors(e,i);let d=wi.dot(fo),o=Ti.dot(fo);if(d>=0&&o<=d)return t.copy(i);let h=l*o-d*u;if(h<=0&&l>=0&&d<=0)return a=l/(l-d),t.copy(n).addScaledVector(wi,a);po.subVectors(e,r);let f=wi.dot(po),p=Ti.dot(po);if(p>=0&&f<=p)return t.copy(r);let v=f*u-l*p;if(v<=0&&u>=0&&p<=0)return c=u/(u-p),t.copy(n).addScaledVector(Ti,c);let g=d*p-f*o;if(g<=0&&o-d>=0&&f-p>=0)return Wl.subVectors(r,i),c=(o-d)/(o-d+(f-p)),t.copy(i).addScaledVector(Wl,c);let m=1/(g+v+h);return a=v*m,c=h*m,t.copy(n).addScaledVector(wi,a).addScaledVector(Ti,c)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Zn=class{constructor(e=new H(1/0,1/0,1/0),t=new H(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(ln.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(ln.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=ln.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let a=0,c=r.count;a<c;a++)e.isMesh===!0?e.getVertexPosition(a,ln):ln.fromBufferAttribute(r,a),ln.applyMatrix4(e.matrixWorld),this.expandByPoint(ln);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Qs.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Qs.copy(n.boundingBox)),Qs.applyMatrix4(e.matrixWorld),this.union(Qs)}let i=e.children;for(let r=0,a=i.length;r<a;r++)this.expandByObject(i[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,ln),ln.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(ji),js.subVectors(this.max,ji),Ei.subVectors(e.a,ji),Ai.subVectors(e.b,ji),Ci.subVectors(e.c,ji),Gn.subVectors(Ai,Ei),Hn.subVectors(Ci,Ai),ai.subVectors(Ei,Ci);let t=[0,-Gn.z,Gn.y,0,-Hn.z,Hn.y,0,-ai.z,ai.y,Gn.z,0,-Gn.x,Hn.z,0,-Hn.x,ai.z,0,-ai.x,-Gn.y,Gn.x,0,-Hn.y,Hn.x,0,-ai.y,ai.x,0];return!vo(t,Ei,Ai,Ci,js)||(t=[1,0,0,0,1,0,0,0,1],!vo(t,Ei,Ai,Ci,js))?!1:(er.crossVectors(Gn,Hn),t=[er.x,er.y,er.z],vo(t,Ei,Ai,Ci,js))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,ln).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(ln).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(An[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),An[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),An[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),An[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),An[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),An[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),An[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),An[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(An),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},An=[new H,new H,new H,new H,new H,new H,new H,new H],ln=new H,Qs=new Zn,Ei=new H,Ai=new H,Ci=new H,Gn=new H,Hn=new H,ai=new H,ji=new H,js=new H,er=new H,oi=new H;function vo(s,e,t,n,i){for(let r=0,a=s.length-3;r<=a;r+=3){oi.fromArray(s,r);let c=i.x*Math.abs(oi.x)+i.y*Math.abs(oi.y)+i.z*Math.abs(oi.z),l=e.dot(oi),u=t.dot(oi),d=n.dot(oi);if(Math.max(-Math.max(l,u,d),Math.min(l,u,d))>c)return!1}return!0}var vt=new H,tr=new Je,Oh=0,qt=class extends vn{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Oh++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=Do,this.updateRanges=[],this.gpuType=fn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let i=0,r=this.itemSize;i<r;i++)this.array[e+i]=t.array[n+i];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)tr.fromBufferAttribute(this,t),tr.applyMatrix3(e),this.setXY(t,tr.x,tr.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)vt.fromBufferAttribute(this,t),vt.applyMatrix3(e),this.setXYZ(t,vt.x,vt.y,vt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)vt.fromBufferAttribute(this,t),vt.applyMatrix4(e),this.setXYZ(t,vt.x,vt.y,vt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)vt.fromBufferAttribute(this,t),vt.applyNormalMatrix(e),this.setXYZ(t,vt.x,vt.y,vt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)vt.fromBufferAttribute(this,t),vt.transformDirection(e),this.setXYZ(t,vt.x,vt.y,vt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Ki(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=kt(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Ki(t,this.array)),t}setX(e,t){return this.normalized&&(t=kt(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Ki(t,this.array)),t}setY(e,t){return this.normalized&&(t=kt(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Ki(t,this.array)),t}setZ(e,t){return this.normalized&&(t=kt(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Ki(t,this.array)),t}setW(e,t){return this.normalized&&(t=kt(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=kt(t,this.array),n=kt(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,i){return e*=this.itemSize,this.normalized&&(t=kt(t,this.array),n=kt(n,this.array),i=kt(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this}setXYZW(e,t,n,i,r){return e*=this.itemSize,this.normalized&&(t=kt(t,this.array),n=kt(n,this.array),i=kt(i,this.array),r=kt(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Do&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var us=class extends qt{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var fs=class extends qt{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var mt=class extends qt{constructor(e,t,n){super(new Float32Array(e),t,n)}},Bh=new Zn,es=new H,_o=new H,di=class{constructor(e=new H,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):Bh.setFromPoints(e).getCenter(n);let i=0;for(let r=0,a=e.length;r<a;r++)i=Math.max(i,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(i),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;es.subVectors(e,this.center);let t=es.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),i=(n-this.radius)*.5;this.center.addScaledVector(es,i/n),this.radius+=i}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(_o.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(es.copy(e.center).add(_o)),this.expandByPoint(es.copy(e.center).sub(_o))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},zh=0,jt=new gt,yo=new Rt,Ri=new H,Xt=new Zn,ts=new Zn,Mt=new H,Pt=class s extends vn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:zh++}),this.uuid=Bs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(wh(e)?fs:us)(e,1):this.index=e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new We().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(e),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return jt.makeRotationFromQuaternion(e),this.applyMatrix4(jt),this}rotateX(e){return jt.makeRotationX(e),this.applyMatrix4(jt),this}rotateY(e){return jt.makeRotationY(e),this.applyMatrix4(jt),this}rotateZ(e){return jt.makeRotationZ(e),this.applyMatrix4(jt),this}translate(e,t,n){return jt.makeTranslation(e,t,n),this.applyMatrix4(jt),this}scale(e,t,n){return jt.makeScale(e,t,n),this.applyMatrix4(jt),this}lookAt(e){return yo.lookAt(e),yo.updateMatrix(),this.applyMatrix4(yo.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Ri).negate(),this.translate(Ri.x,Ri.y,Ri.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let i=0,r=e.length;i<r;i++){let a=e[i];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new mt(n,3))}else{let n=Math.min(e.length,t.count);for(let i=0;i<n;i++){let r=e[i];t.setXYZ(i,r.x,r.y,r.z||0)}e.length>t.count&&Fe("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Zn);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Be("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new H(-1/0,-1/0,-1/0),new H(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,i=t.length;n<i;n++){let r=t[n];Xt.setFromBufferAttribute(r),this.morphTargetsRelative?(Mt.addVectors(this.boundingBox.min,Xt.min),this.boundingBox.expandByPoint(Mt),Mt.addVectors(this.boundingBox.max,Xt.max),this.boundingBox.expandByPoint(Mt)):(this.boundingBox.expandByPoint(Xt.min),this.boundingBox.expandByPoint(Xt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Be('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new di);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Be("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new H,1/0);return}if(e){let n=this.boundingSphere.center;if(Xt.setFromBufferAttribute(e),t)for(let r=0,a=t.length;r<a;r++){let c=t[r];ts.setFromBufferAttribute(c),this.morphTargetsRelative?(Mt.addVectors(Xt.min,ts.min),Xt.expandByPoint(Mt),Mt.addVectors(Xt.max,ts.max),Xt.expandByPoint(Mt)):(Xt.expandByPoint(ts.min),Xt.expandByPoint(ts.max))}Xt.getCenter(n);let i=0;for(let r=0,a=e.count;r<a;r++)Mt.fromBufferAttribute(e,r),i=Math.max(i,n.distanceToSquared(Mt));if(t)for(let r=0,a=t.length;r<a;r++){let c=t[r],l=this.morphTargetsRelative;for(let u=0,d=c.count;u<d;u++)Mt.fromBufferAttribute(c,u),l&&(Ri.fromBufferAttribute(e,u),Mt.add(Ri)),i=Math.max(i,n.distanceToSquared(Mt))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&Be('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){Be("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,i=t.normal,r=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new qt(new Float32Array(4*n.count),4));let a=this.getAttribute("tangent"),c=[],l=[];for(let _=0;_<n.count;_++)c[_]=new H,l[_]=new H;let u=new H,d=new H,o=new H,h=new Je,f=new Je,p=new Je,v=new H,g=new H;function m(_,b,R){u.fromBufferAttribute(n,_),d.fromBufferAttribute(n,b),o.fromBufferAttribute(n,R),h.fromBufferAttribute(r,_),f.fromBufferAttribute(r,b),p.fromBufferAttribute(r,R),d.sub(u),o.sub(u),f.sub(h),p.sub(h);let A=1/(f.x*p.y-p.x*f.y);isFinite(A)&&(v.copy(d).multiplyScalar(p.y).addScaledVector(o,-f.y).multiplyScalar(A),g.copy(o).multiplyScalar(f.x).addScaledVector(d,-p.x).multiplyScalar(A),c[_].add(v),c[b].add(v),c[R].add(v),l[_].add(g),l[b].add(g),l[R].add(g))}let M=this.groups;M.length===0&&(M=[{start:0,count:e.count}]);for(let _=0,b=M.length;_<b;++_){let R=M[_],A=R.start,L=R.count;for(let N=A,O=A+L;N<O;N+=3)m(e.getX(N+0),e.getX(N+1),e.getX(N+2))}let x=new H,S=new H,w=new H,y=new H;function E(_){w.fromBufferAttribute(i,_),y.copy(w);let b=c[_];x.copy(b),x.sub(w.multiplyScalar(w.dot(b))).normalize(),S.crossVectors(y,b);let A=S.dot(l[_])<0?-1:1;a.setXYZW(_,x.x,x.y,x.z,A)}for(let _=0,b=M.length;_<b;++_){let R=M[_],A=R.start,L=R.count;for(let N=A,O=A+L;N<O;N+=3)E(e.getX(N+0)),E(e.getX(N+1)),E(e.getX(N+2))}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new qt(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let h=0,f=n.count;h<f;h++)n.setXYZ(h,0,0,0);let i=new H,r=new H,a=new H,c=new H,l=new H,u=new H,d=new H,o=new H;if(e)for(let h=0,f=e.count;h<f;h+=3){let p=e.getX(h+0),v=e.getX(h+1),g=e.getX(h+2);i.fromBufferAttribute(t,p),r.fromBufferAttribute(t,v),a.fromBufferAttribute(t,g),d.subVectors(a,r),o.subVectors(i,r),d.cross(o),c.fromBufferAttribute(n,p),l.fromBufferAttribute(n,v),u.fromBufferAttribute(n,g),c.add(d),l.add(d),u.add(d),n.setXYZ(p,c.x,c.y,c.z),n.setXYZ(v,l.x,l.y,l.z),n.setXYZ(g,u.x,u.y,u.z)}else for(let h=0,f=t.count;h<f;h+=3)i.fromBufferAttribute(t,h+0),r.fromBufferAttribute(t,h+1),a.fromBufferAttribute(t,h+2),d.subVectors(a,r),o.subVectors(i,r),d.cross(o),n.setXYZ(h+0,d.x,d.y,d.z),n.setXYZ(h+1,d.x,d.y,d.z),n.setXYZ(h+2,d.x,d.y,d.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Mt.fromBufferAttribute(e,t),Mt.normalize(),e.setXYZ(t,Mt.x,Mt.y,Mt.z)}toNonIndexed(){function e(c,l){let u=c.array,d=c.itemSize,o=c.normalized,h=new u.constructor(l.length*d),f=0,p=0;for(let v=0,g=l.length;v<g;v++){c.isInterleavedBufferAttribute?f=l[v]*c.data.stride+c.offset:f=l[v]*d;for(let m=0;m<d;m++)h[p++]=u[f++]}return new qt(h,d,o)}if(this.index===null)return Fe("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new s,n=this.index.array,i=this.attributes;for(let c in i){let l=i[c],u=e(l,n);t.setAttribute(c,u)}let r=this.morphAttributes;for(let c in r){let l=[],u=r[c];for(let d=0,o=u.length;d<o;d++){let h=u[d],f=e(h,n);l.push(f)}t.morphAttributes[c]=l}t.morphTargetsRelative=this.morphTargetsRelative;let a=this.groups;for(let c=0,l=a.length;c<l;c++){let u=a[c];t.addGroup(u.start,u.count,u.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let u in l)l[u]!==void 0&&(e[u]=l[u]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let l in n){let u=n[l];e.data.attributes[l]=u.toJSON(e.data)}let i={},r=!1;for(let l in this.morphAttributes){let u=this.morphAttributes[l],d=[];for(let o=0,h=u.length;o<h;o++){let f=u[o];d.push(f.toJSON(e.data))}d.length>0&&(i[l]=d,r=!0)}r&&(e.data.morphAttributes=i,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let c=this.boundingSphere;return c!==null&&(e.data.boundingSphere=c.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let i=e.attributes;for(let u in i){let d=i[u];this.setAttribute(u,d.clone(t))}let r=e.morphAttributes;for(let u in r){let d=[],o=r[u];for(let h=0,f=o.length;h<f;h++)d.push(o[h].clone(t));this.morphAttributes[u]=d}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let u=0,d=a.length;u<d;u++){let o=a[u];this.addGroup(o.start,o.count,o.materialIndex)}let c=e.boundingBox;c!==null&&(this.boundingBox=c.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var Vh=0,Dn=class extends vn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Vh++}),this.uuid=Bs(),this.name="",this.type="Material",this.blending=ui,this.side=In,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=vr,this.blendDst=_r,this.blendEquation=Yn,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ke(0,0,0),this.blendAlpha=0,this.depthFunc=fi,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Lo,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=hi,this.stencilZFail=hi,this.stencilZPass=hi,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){Fe(`Material: parameter '${t}' has value of undefined.`);continue}let i=this[t];if(i===void 0){Fe(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==ui&&(n.blending=this.blending),this.side!==In&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==vr&&(n.blendSrc=this.blendSrc),this.blendDst!==_r&&(n.blendDst=this.blendDst),this.blendEquation!==Yn&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==fi&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Lo&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==hi&&(n.stencilFail=this.stencilFail),this.stencilZFail!==hi&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==hi&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.allowOverride===!1&&(n.allowOverride=!1),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(r){let a=[];for(let c in r){let l=r[c];delete l.metadata,a.push(l)}return a}if(t){let r=i(e.textures),a=i(e.images);r.length>0&&(n.textures=r),a.length>0&&(n.images=a)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let i=t.length;n=new Array(i);for(let r=0;r!==i;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var Cn=new H,So=new H,nr=new H,Wn=new H,Mo=new H,ir=new H,bo=new H,ds=class{constructor(e=new H,t=new H(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Cn)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=Cn.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(Cn.copy(this.origin).addScaledVector(this.direction,t),Cn.distanceToSquared(e))}distanceSqToSegment(e,t,n,i){So.copy(e).add(t).multiplyScalar(.5),nr.copy(t).sub(e).normalize(),Wn.copy(this.origin).sub(So);let r=e.distanceTo(t)*.5,a=-this.direction.dot(nr),c=Wn.dot(this.direction),l=-Wn.dot(nr),u=Wn.lengthSq(),d=Math.abs(1-a*a),o,h,f,p;if(d>0)if(o=a*l-c,h=a*c-l,p=r*d,o>=0)if(h>=-p)if(h<=p){let v=1/d;o*=v,h*=v,f=o*(o+a*h+2*c)+h*(a*o+h+2*l)+u}else h=r,o=Math.max(0,-(a*h+c)),f=-o*o+h*(h+2*l)+u;else h=-r,o=Math.max(0,-(a*h+c)),f=-o*o+h*(h+2*l)+u;else h<=-p?(o=Math.max(0,-(-a*r+c)),h=o>0?-r:Math.min(Math.max(-r,-l),r),f=-o*o+h*(h+2*l)+u):h<=p?(o=0,h=Math.min(Math.max(-r,-l),r),f=h*(h+2*l)+u):(o=Math.max(0,-(a*r+c)),h=o>0?r:Math.min(Math.max(-r,-l),r),f=-o*o+h*(h+2*l)+u);else h=a>0?-r:r,o=Math.max(0,-(a*h+c)),f=-o*o+h*(h+2*l)+u;return n&&n.copy(this.origin).addScaledVector(this.direction,o),i&&i.copy(So).addScaledVector(nr,h),f}intersectSphere(e,t){Cn.subVectors(e.center,this.origin);let n=Cn.dot(this.direction),i=Cn.dot(Cn)-n*n,r=e.radius*e.radius;if(i>r)return null;let a=Math.sqrt(r-i),c=n-a,l=n+a;return l<0?null:c<0?this.at(l,t):this.at(c,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,i,r,a,c,l,u=1/this.direction.x,d=1/this.direction.y,o=1/this.direction.z,h=this.origin;return u>=0?(n=(e.min.x-h.x)*u,i=(e.max.x-h.x)*u):(n=(e.max.x-h.x)*u,i=(e.min.x-h.x)*u),d>=0?(r=(e.min.y-h.y)*d,a=(e.max.y-h.y)*d):(r=(e.max.y-h.y)*d,a=(e.min.y-h.y)*d),n>a||r>i||((r>n||isNaN(n))&&(n=r),(a<i||isNaN(i))&&(i=a),o>=0?(c=(e.min.z-h.z)*o,l=(e.max.z-h.z)*o):(c=(e.max.z-h.z)*o,l=(e.min.z-h.z)*o),n>l||c>i)||((c>n||n!==n)&&(n=c),(l<i||i!==i)&&(i=l),i<0)?null:this.at(n>=0?n:i,t)}intersectsBox(e){return this.intersectBox(e,Cn)!==null}intersectTriangle(e,t,n,i,r){Mo.subVectors(t,e),ir.subVectors(n,e),bo.crossVectors(Mo,ir);let a=this.direction.dot(bo),c;if(a>0){if(i)return null;c=1}else if(a<0)c=-1,a=-a;else return null;Wn.subVectors(this.origin,e);let l=c*this.direction.dot(ir.crossVectors(Wn,ir));if(l<0)return null;let u=c*this.direction.dot(Mo.cross(Wn));if(u<0||l+u>a)return null;let d=-c*Wn.dot(bo);return d<0?null:this.at(d/a,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Jn=class extends Dn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ke(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ln,this.combine=Go,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},Xl=new gt,li=new ds,sr=new di,ql=new H,rr=new H,ar=new H,or=new H,wo=new H,lr=new H,Yl=new H,cr=new H,Tt=class extends Rt{constructor(e=new Pt,t=new Jn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=i.length;r<a;r++){let c=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[c]=r}}}}getVertexPosition(e,t){let n=this.geometry,i=n.attributes.position,r=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(i,e);let c=this.morphTargetInfluences;if(r&&c){lr.set(0,0,0);for(let l=0,u=r.length;l<u;l++){let d=c[l],o=r[l];d!==0&&(wo.fromBufferAttribute(o,e),a?lr.addScaledVector(wo,d):lr.addScaledVector(wo.sub(t),d))}t.add(lr)}return t}raycast(e,t){let n=this.geometry,i=this.material,r=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),sr.copy(n.boundingSphere),sr.applyMatrix4(r),li.copy(e.ray).recast(e.near),!(sr.containsPoint(li.origin)===!1&&(li.intersectSphere(sr,ql)===null||li.origin.distanceToSquared(ql)>(e.far-e.near)**2))&&(Xl.copy(r).invert(),li.copy(e.ray).applyMatrix4(Xl),!(n.boundingBox!==null&&li.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,li)))}_computeIntersections(e,t,n){let i,r=this.geometry,a=this.material,c=r.index,l=r.attributes.position,u=r.attributes.uv,d=r.attributes.uv1,o=r.attributes.normal,h=r.groups,f=r.drawRange;if(c!==null)if(Array.isArray(a))for(let p=0,v=h.length;p<v;p++){let g=h[p],m=a[g.materialIndex],M=Math.max(g.start,f.start),x=Math.min(c.count,Math.min(g.start+g.count,f.start+f.count));for(let S=M,w=x;S<w;S+=3){let y=c.getX(S),E=c.getX(S+1),_=c.getX(S+2);i=hr(this,m,e,n,u,d,o,y,E,_),i&&(i.faceIndex=Math.floor(S/3),i.face.materialIndex=g.materialIndex,t.push(i))}}else{let p=Math.max(0,f.start),v=Math.min(c.count,f.start+f.count);for(let g=p,m=v;g<m;g+=3){let M=c.getX(g),x=c.getX(g+1),S=c.getX(g+2);i=hr(this,a,e,n,u,d,o,M,x,S),i&&(i.faceIndex=Math.floor(g/3),t.push(i))}}else if(l!==void 0)if(Array.isArray(a))for(let p=0,v=h.length;p<v;p++){let g=h[p],m=a[g.materialIndex],M=Math.max(g.start,f.start),x=Math.min(l.count,Math.min(g.start+g.count,f.start+f.count));for(let S=M,w=x;S<w;S+=3){let y=S,E=S+1,_=S+2;i=hr(this,m,e,n,u,d,o,y,E,_),i&&(i.faceIndex=Math.floor(S/3),i.face.materialIndex=g.materialIndex,t.push(i))}}else{let p=Math.max(0,f.start),v=Math.min(l.count,f.start+f.count);for(let g=p,m=v;g<m;g+=3){let M=g,x=g+1,S=g+2;i=hr(this,a,e,n,u,d,o,M,x,S),i&&(i.faceIndex=Math.floor(g/3),t.push(i))}}}};function kh(s,e,t,n,i,r,a,c){let l;if(e.side===zt?l=n.intersectTriangle(a,r,i,!0,c):l=n.intersectTriangle(i,r,a,e.side===In,c),l===null)return null;cr.copy(c),cr.applyMatrix4(s.matrixWorld);let u=t.ray.origin.distanceTo(cr);return u<t.near||u>t.far?null:{distance:u,point:cr.clone(),object:s}}function hr(s,e,t,n,i,r,a,c,l,u){s.getVertexPosition(c,rr),s.getVertexPosition(l,ar),s.getVertexPosition(u,or);let d=kh(s,e,t,n,rr,ar,or,Yl);if(d){let o=new H;qn.getBarycoord(Yl,rr,ar,or,o),i&&(d.uv=qn.getInterpolatedAttribute(i,c,l,u,o,new Je)),r&&(d.uv1=qn.getInterpolatedAttribute(r,c,l,u,o,new Je)),a&&(d.normal=qn.getInterpolatedAttribute(a,c,l,u,o,new H),d.normal.dot(n.direction)>0&&d.normal.multiplyScalar(-1));let h={a:c,b:l,c:u,normal:new H,materialIndex:0};qn.getNormal(rr,ar,or,h.normal),d.face=h,d.barycoord=o}return d}var Ur=class extends Bt{constructor(e=null,t=1,n=1,i,r,a,c,l,u=wt,d=wt,o,h){super(null,a,c,l,u,d,i,r,o,h),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var To=new H,Gh=new H,Hh=new We,mn=class{constructor(e=new H(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,i){return this.normal.set(e,t,n),this.constant=i,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let i=To.subVectors(n,t).cross(Gh.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(i,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let i=e.delta(To),r=this.normal.dot(i);if(r===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/r;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(i,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||Hh.getNormalMatrix(e),i=this.coplanarPoint(To).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},ci=new di,Wh=new Je(.5,.5),ur=new H,Bi=class{constructor(e=new mn,t=new mn,n=new mn,i=new mn,r=new mn,a=new mn){this.planes=[e,t,n,i,r,a]}set(e,t,n,i,r,a){let c=this.planes;return c[0].copy(e),c[1].copy(t),c[2].copy(n),c[3].copy(i),c[4].copy(r),c[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=cn,n=!1){let i=this.planes,r=e.elements,a=r[0],c=r[1],l=r[2],u=r[3],d=r[4],o=r[5],h=r[6],f=r[7],p=r[8],v=r[9],g=r[10],m=r[11],M=r[12],x=r[13],S=r[14],w=r[15];if(i[0].setComponents(u-a,f-d,m-p,w-M).normalize(),i[1].setComponents(u+a,f+d,m+p,w+M).normalize(),i[2].setComponents(u+c,f+o,m+v,w+x).normalize(),i[3].setComponents(u-c,f-o,m-v,w-x).normalize(),n)i[4].setComponents(l,h,g,S).normalize(),i[5].setComponents(u-l,f-h,m-g,w-S).normalize();else if(i[4].setComponents(u-l,f-h,m-g,w-S).normalize(),t===cn)i[5].setComponents(u+l,f+h,m+g,w+S).normalize();else if(t===Ui)i[5].setComponents(l,h,g,S).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ci.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),ci.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ci)}intersectsSprite(e){ci.center.set(0,0,0);let t=Wh.distanceTo(e.center);return ci.radius=.7071067811865476+t,ci.applyMatrix4(e.matrixWorld),this.intersectsSphere(ci)}intersectsSphere(e){let t=this.planes,n=e.center,i=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<i)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let i=t[n];if(ur.x=i.normal.x>0?e.max.x:e.min.x,ur.y=i.normal.y>0?e.max.y:e.min.y,ur.z=i.normal.z>0?e.max.z:e.min.z,i.distanceToPoint(ur)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var ps=class extends Dn{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Ke(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},Nr=new H,Fr=new H,Zl=new gt,ns=new ds,fr=new di,Eo=new H,Jl=new H,ms=class extends Rt{constructor(e=new Pt,t=new ps){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let i=1,r=t.count;i<r;i++)Nr.fromBufferAttribute(t,i-1),Fr.fromBufferAttribute(t,i),n[i]=n[i-1],n[i]+=Nr.distanceTo(Fr);e.setAttribute("lineDistance",new mt(n,1))}else Fe("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){let n=this.geometry,i=this.matrixWorld,r=e.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),fr.copy(n.boundingSphere),fr.applyMatrix4(i),fr.radius+=r,e.ray.intersectsSphere(fr)===!1)return;Zl.copy(i).invert(),ns.copy(e.ray).applyMatrix4(Zl);let c=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=c*c,u=this.isLineSegments?2:1,d=n.index,h=n.attributes.position;if(d!==null){let f=Math.max(0,a.start),p=Math.min(d.count,a.start+a.count);for(let v=f,g=p-1;v<g;v+=u){let m=d.getX(v),M=d.getX(v+1),x=dr(this,e,ns,l,m,M,v);x&&t.push(x)}if(this.isLineLoop){let v=d.getX(p-1),g=d.getX(f),m=dr(this,e,ns,l,v,g,p-1);m&&t.push(m)}}else{let f=Math.max(0,a.start),p=Math.min(h.count,a.start+a.count);for(let v=f,g=p-1;v<g;v+=u){let m=dr(this,e,ns,l,v,v+1,v);m&&t.push(m)}if(this.isLineLoop){let v=dr(this,e,ns,l,p-1,f,p-1);v&&t.push(v)}}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=i.length;r<a;r++){let c=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[c]=r}}}}};function dr(s,e,t,n,i,r,a){let c=s.geometry.attributes.position;if(Nr.fromBufferAttribute(c,i),Fr.fromBufferAttribute(c,r),t.distanceSqToSegment(Nr,Fr,Eo,Jl)>n)return;Eo.applyMatrix4(s.matrixWorld);let u=e.ray.origin.distanceTo(Eo);if(!(u<e.near||u>e.far))return{distance:u,point:Jl.clone().applyMatrix4(s.matrixWorld),index:a,face:null,faceIndex:null,barycoord:null,object:s}}var gs=class extends Bt{constructor(e=[],t=ei,n,i,r,a,c,l,u,d){super(e,t,n,i,r,a,c,l,u,d),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},pi=class extends Bt{constructor(e,t,n,i,r,a,c,l,u){super(e,t,n,i,r,a,c,l,u),this.isCanvasTexture=!0,this.needsUpdate=!0}};var Un=class extends Bt{constructor(e,t,n=un,i,r,a,c=wt,l=wt,u,d=xn,o=1){if(d!==xn&&d!==ni)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:t,depth:o};super(h,i,r,a,c,l,d,n,u),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new Fi(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},Or=class extends Un{constructor(e,t=un,n=ei,i,r,a=wt,c=wt,l,u=xn){let d={width:e,height:e,depth:1},o=[d,d,d,d,d,d];super(e,e,t,n,i,r,a,c,l,u),this.image=o,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},xs=class extends Bt{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},$n=class s extends Pt{constructor(e=1,t=1,n=1,i=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:i,heightSegments:r,depthSegments:a};let c=this;i=Math.floor(i),r=Math.floor(r),a=Math.floor(a);let l=[],u=[],d=[],o=[],h=0,f=0;p("z","y","x",-1,-1,n,t,e,a,r,0),p("z","y","x",1,-1,n,t,-e,a,r,1),p("x","z","y",1,1,e,n,t,i,a,2),p("x","z","y",1,-1,e,n,-t,i,a,3),p("x","y","z",1,-1,e,t,n,i,r,4),p("x","y","z",-1,-1,e,t,-n,i,r,5),this.setIndex(l),this.setAttribute("position",new mt(u,3)),this.setAttribute("normal",new mt(d,3)),this.setAttribute("uv",new mt(o,2));function p(v,g,m,M,x,S,w,y,E,_,b){let R=S/E,A=w/_,L=S/2,N=w/2,O=y/2,D=E+1,F=_+1,k=0,Q=0,ie=new H;for(let oe=0;oe<F;oe++){let xe=oe*A-N;for(let Ee=0;Ee<D;Ee++){let ze=Ee*R-L;ie[v]=ze*M,ie[g]=xe*x,ie[m]=O,u.push(ie.x,ie.y,ie.z),ie[v]=0,ie[g]=0,ie[m]=y>0?1:-1,d.push(ie.x,ie.y,ie.z),o.push(Ee/E),o.push(1-oe/_),k+=1}}for(let oe=0;oe<_;oe++)for(let xe=0;xe<E;xe++){let Ee=h+xe+D*oe,ze=h+xe+D*(oe+1),Ce=h+(xe+1)+D*(oe+1),De=h+(xe+1)+D*oe;l.push(Ee,ze,De),l.push(ze,Ce,De),Q+=6}c.addGroup(f,Q,b),f+=Q,h+=k}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new s(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var Br=class s extends Pt{constructor(e=1,t=1,n=1,i=32,r=1,a=!1,c=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:i,heightSegments:r,openEnded:a,thetaStart:c,thetaLength:l};let u=this;i=Math.floor(i),r=Math.floor(r);let d=[],o=[],h=[],f=[],p=0,v=[],g=n/2,m=0;M(),a===!1&&(e>0&&x(!0),t>0&&x(!1)),this.setIndex(d),this.setAttribute("position",new mt(o,3)),this.setAttribute("normal",new mt(h,3)),this.setAttribute("uv",new mt(f,2));function M(){let S=new H,w=new H,y=0,E=(t-e)/n;for(let _=0;_<=r;_++){let b=[],R=_/r,A=R*(t-e)+e;for(let L=0;L<=i;L++){let N=L/i,O=N*l+c,D=Math.sin(O),F=Math.cos(O);w.x=A*D,w.y=-R*n+g,w.z=A*F,o.push(w.x,w.y,w.z),S.set(D,E,F).normalize(),h.push(S.x,S.y,S.z),f.push(N,1-R),b.push(p++)}v.push(b)}for(let _=0;_<i;_++)for(let b=0;b<r;b++){let R=v[b][_],A=v[b+1][_],L=v[b+1][_+1],N=v[b][_+1];(e>0||b!==0)&&(d.push(R,A,N),y+=3),(t>0||b!==r-1)&&(d.push(A,L,N),y+=3)}u.addGroup(m,y,0),m+=y}function x(S){let w=p,y=new Je,E=new H,_=0,b=S===!0?e:t,R=S===!0?1:-1;for(let L=1;L<=i;L++)o.push(0,g*R,0),h.push(0,R,0),f.push(.5,.5),p++;let A=p;for(let L=0;L<=i;L++){let O=L/i*l+c,D=Math.cos(O),F=Math.sin(O);E.x=b*F,E.y=g*R,E.z=b*D,o.push(E.x,E.y,E.z),h.push(0,R,0),y.x=D*.5+.5,y.y=F*.5*R+.5,f.push(y.x,y.y),p++}for(let L=0;L<i;L++){let N=w+L,O=A+L;S===!0?d.push(O,O+1,N):d.push(O+1,O,N),_+=3}u.addGroup(m,_,S===!0?1:2),m+=_}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new s(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},vs=class s extends Br{constructor(e=1,t=1,n=32,i=1,r=!1,a=0,c=Math.PI*2){super(0,e,t,n,i,r,a,c),this.type="ConeGeometry",this.parameters={radius:e,height:t,radialSegments:n,heightSegments:i,openEnded:r,thetaStart:a,thetaLength:c}}static fromJSON(e){return new s(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var _s=class s extends Pt{constructor(e=[new Je(0,-.5),new Je(.5,0),new Je(0,.5)],t=12,n=0,i=Math.PI*2){super(),this.type="LatheGeometry",this.parameters={points:e,segments:t,phiStart:n,phiLength:i},t=Math.floor(t),i=tt(i,0,Math.PI*2);let r=[],a=[],c=[],l=[],u=[],d=1/t,o=new H,h=new Je,f=new H,p=new H,v=new H,g=0,m=0;for(let M=0;M<=e.length-1;M++)switch(M){case 0:g=e[M+1].x-e[M].x,m=e[M+1].y-e[M].y,f.x=m*1,f.y=-g,f.z=m*0,v.copy(f),f.normalize(),l.push(f.x,f.y,f.z);break;case e.length-1:l.push(v.x,v.y,v.z);break;default:g=e[M+1].x-e[M].x,m=e[M+1].y-e[M].y,f.x=m*1,f.y=-g,f.z=m*0,p.copy(f),f.x+=v.x,f.y+=v.y,f.z+=v.z,f.normalize(),l.push(f.x,f.y,f.z),v.copy(p)}for(let M=0;M<=t;M++){let x=n+M*d*i,S=Math.sin(x),w=Math.cos(x);for(let y=0;y<=e.length-1;y++){o.x=e[y].x*S,o.y=e[y].y,o.z=e[y].x*w,a.push(o.x,o.y,o.z),h.x=M/t,h.y=y/(e.length-1),c.push(h.x,h.y);let E=l[3*y+0]*S,_=l[3*y+1],b=l[3*y+0]*w;u.push(E,_,b)}}for(let M=0;M<t;M++)for(let x=0;x<e.length-1;x++){let S=x+M*e.length,w=S,y=S+e.length,E=S+e.length+1,_=S+1;r.push(w,y,_),r.push(E,_,y)}this.setIndex(r),this.setAttribute("position",new mt(a,3)),this.setAttribute("uv",new mt(c,2)),this.setAttribute("normal",new mt(u,3))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new s(e.points,e.segments,e.phiStart,e.phiLength)}};var ys=class s extends Pt{constructor(e=1,t=1,n=1,i=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:i};let r=e/2,a=t/2,c=Math.floor(n),l=Math.floor(i),u=c+1,d=l+1,o=e/c,h=t/l,f=[],p=[],v=[],g=[];for(let m=0;m<d;m++){let M=m*h-a;for(let x=0;x<u;x++){let S=x*o-r;p.push(S,-M,0),v.push(0,0,1),g.push(x/c),g.push(1-m/l)}}for(let m=0;m<l;m++)for(let M=0;M<c;M++){let x=M+u*m,S=M+u*(m+1),w=M+1+u*(m+1),y=M+1+u*m;f.push(x,S,y),f.push(S,w,y)}this.setIndex(f),this.setAttribute("position",new mt(p,3)),this.setAttribute("normal",new mt(v,3)),this.setAttribute("uv",new mt(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new s(e.width,e.height,e.widthSegments,e.heightSegments)}},Ss=class s extends Pt{constructor(e=.5,t=1,n=32,i=1,r=0,a=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:e,outerRadius:t,thetaSegments:n,phiSegments:i,thetaStart:r,thetaLength:a},n=Math.max(3,n),i=Math.max(1,i);let c=[],l=[],u=[],d=[],o=e,h=(t-e)/i,f=new H,p=new Je;for(let v=0;v<=i;v++){for(let g=0;g<=n;g++){let m=r+g/n*a;f.x=o*Math.cos(m),f.y=o*Math.sin(m),l.push(f.x,f.y,f.z),u.push(0,0,1),p.x=(f.x/t+1)/2,p.y=(f.y/t+1)/2,d.push(p.x,p.y)}o+=h}for(let v=0;v<i;v++){let g=v*(n+1);for(let m=0;m<n;m++){let M=m+g,x=M,S=M+n+1,w=M+n+2,y=M+1;c.push(x,S,y),c.push(S,w,y)}}this.setIndex(c),this.setAttribute("position",new mt(l,3)),this.setAttribute("normal",new mt(u,3)),this.setAttribute("uv",new mt(d,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new s(e.innerRadius,e.outerRadius,e.thetaSegments,e.phiSegments,e.thetaStart,e.thetaLength)}};var Ms=class s extends Pt{constructor(e=1,t=32,n=16,i=0,r=Math.PI*2,a=0,c=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:i,phiLength:r,thetaStart:a,thetaLength:c},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let l=Math.min(a+c,Math.PI),u=0,d=[],o=new H,h=new H,f=[],p=[],v=[],g=[];for(let m=0;m<=n;m++){let M=[],x=m/n,S=0;m===0&&a===0?S=.5/t:m===n&&l===Math.PI&&(S=-.5/t);for(let w=0;w<=t;w++){let y=w/t;o.x=-e*Math.cos(i+y*r)*Math.sin(a+x*c),o.y=e*Math.cos(a+x*c),o.z=e*Math.sin(i+y*r)*Math.sin(a+x*c),p.push(o.x,o.y,o.z),h.copy(o).normalize(),v.push(h.x,h.y,h.z),g.push(y+S,1-x),M.push(u++)}d.push(M)}for(let m=0;m<n;m++)for(let M=0;M<t;M++){let x=d[m][M+1],S=d[m][M],w=d[m+1][M],y=d[m+1][M+1];(m!==0||a>0)&&f.push(x,S,y),(m!==n-1||l<Math.PI)&&f.push(S,w,y)}this.setIndex(f),this.setAttribute("position",new mt(p,3)),this.setAttribute("normal",new mt(v,3)),this.setAttribute("uv",new mt(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new s(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};function gi(s){let e={};for(let t in s){e[t]={};for(let n in s[t]){let i=s[t][n];if($l(i))i.isRenderTargetTexture?(Fe("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=i.clone();else if(Array.isArray(i))if($l(i[0])){let r=[];for(let a=0,c=i.length;a<c;a++)r[a]=i[a].clone();e[t][n]=r}else e[t][n]=i.slice();else e[t][n]=i}}return e}function Ft(s){let e={};for(let t=0;t<s.length;t++){let n=gi(s[t]);for(let i in n)e[i]=n[i]}return e}function $l(s){return s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)}function Xh(s){let e=[];for(let t=0;t<s.length;t++)e.push(s[t].clone());return e}function al(s){let e=s.getRenderTarget();return e===null?s.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:et.workingColorSpace}var Oc={clone:gi,merge:Ft},qh=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Yh=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Zt=class extends Dn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=qh,this.fragmentShader=Yh,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=gi(e.uniforms),this.uniformsGroups=Xh(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let i in this.uniforms){let a=this.uniforms[i].value;a&&a.isTexture?t.uniforms[i]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[i]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[i]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[i]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[i]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[i]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[i]={type:"m4",value:a.toArray()}:t.uniforms[i]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let i in this.extensions)this.extensions[i]===!0&&(n[i]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}},zr=class extends Zt{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},tn=class extends Dn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Ke(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ke(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Ha,this.normalScale=new Je(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ln,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var Vr=class extends Dn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=wc,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},kr=class extends Dn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};var bs=class extends ps{constructor(e){super(),this.isLineDashedMaterial=!0,this.type="LineDashedMaterial",this.scale=1,this.dashSize=3,this.gapSize=1,this.setValues(e)}copy(e){return super.copy(e),this.scale=e.scale,this.dashSize=e.dashSize,this.gapSize=e.gapSize,this}};function pr(s,e){return!s||s.constructor===e?s:typeof e.BYTES_PER_ELEMENT=="number"?new e(s):Array.prototype.slice.call(s)}var Kn=class{constructor(e,t,n,i){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=i!==void 0?i:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,i=t[n],r=t[n-1];n:{e:{let a;t:{i:if(!(e<i)){for(let c=n+2;;){if(i===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===c)break;if(r=i,i=t[++n],e<i)break e}a=t.length;break t}if(!(e>=r)){let c=t[1];e<c&&(n=2,r=c);for(let l=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(i=r,r=t[--n-1],e>=r)break e}a=n,n=0;break t}break n}for(;n<a;){let c=n+a>>>1;e<t[c]?a=c:n=c+1}if(i=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,i)}return this.interpolate_(n,r,e,i)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,r=e*i;for(let a=0;a!==i;++a)t[a]=n[r+a];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Gr=class extends Kn{constructor(e,t,n,i){super(e,t,n,i),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Ro,endingEnd:Ro}}intervalChanged_(e,t,n){let i=this.parameterPositions,r=e-2,a=e+1,c=i[r],l=i[a];if(c===void 0)switch(this.getSettings_().endingStart){case Po:r=e,c=2*t-n;break;case Io:r=i.length-2,c=t+i[r]-i[r+1];break;default:r=e,c=n}if(l===void 0)switch(this.getSettings_().endingEnd){case Po:a=e,l=2*n-t;break;case Io:a=1,l=n+i[1]-i[0];break;default:a=e-1,l=t}let u=(n-t)*.5,d=this.valueSize;this._weightPrev=u/(t-c),this._weightNext=u/(l-n),this._offsetPrev=r*d,this._offsetNext=a*d}interpolate_(e,t,n,i){let r=this.resultBuffer,a=this.sampleValues,c=this.valueSize,l=e*c,u=l-c,d=this._offsetPrev,o=this._offsetNext,h=this._weightPrev,f=this._weightNext,p=(n-t)/(i-t),v=p*p,g=v*p,m=-h*g+2*h*v-h*p,M=(1+h)*g+(-1.5-2*h)*v+(-.5+h)*p+1,x=(-1-f)*g+(1.5+f)*v+.5*p,S=f*g-f*v;for(let w=0;w!==c;++w)r[w]=m*a[d+w]+M*a[u+w]+x*a[l+w]+S*a[o+w];return r}},Hr=class extends Kn{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){let r=this.resultBuffer,a=this.sampleValues,c=this.valueSize,l=e*c,u=l-c,d=(n-t)/(i-t),o=1-d;for(let h=0;h!==c;++h)r[h]=a[u+h]*o+a[l+h]*d;return r}},Wr=class extends Kn{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e){return this.copySampleValue_(e-1)}},Xr=class extends Kn{interpolate_(e,t,n,i){let r=this.resultBuffer,a=this.sampleValues,c=this.valueSize,l=e*c,u=l-c,d=this.settings||this.DefaultSettings_,o=d.inTangents,h=d.outTangents;if(!o||!h){let v=(n-t)/(i-t),g=1-v;for(let m=0;m!==c;++m)r[m]=a[u+m]*g+a[l+m]*v;return r}let f=c*2,p=e-1;for(let v=0;v!==c;++v){let g=a[u+v],m=a[l+v],M=p*f+v*2,x=h[M],S=h[M+1],w=e*f+v*2,y=o[w],E=o[w+1],_=(n-t)/(i-t),b,R,A,L,N;for(let O=0;O<8;O++){b=_*_,R=b*_,A=1-_,L=A*A,N=L*A;let F=N*t+3*L*_*x+3*A*b*y+R*i-n;if(Math.abs(F)<1e-10)break;let k=3*L*(x-t)+6*A*_*(y-x)+3*b*(i-y);if(Math.abs(k)<1e-10)break;_=_-F/k,_=Math.max(0,Math.min(1,_))}r[v]=N*g+3*L*_*S+3*A*b*E+R*m}return r}},Jt=class{constructor(e,t,n,i){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=pr(t,this.TimeBufferType),this.values=pr(n,this.ValueBufferType),this.setInterpolation(i||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:pr(e.times,Array),values:pr(e.values,Array)};let i=e.getInterpolation();i!==e.DefaultInterpolation&&(n.interpolation=i)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Wr(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Hr(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Gr(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new Xr(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.settings=this.settings),t}setInterpolation(e){let t;switch(e){case is:t=this.InterpolantFactoryMethodDiscrete;break;case Cr:t=this.InterpolantFactoryMethodLinear;break;case xr:t=this.InterpolantFactoryMethodSmooth;break;case Co:t=this.InterpolantFactoryMethodBezier;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return Fe("KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return is;case this.InterpolantFactoryMethodLinear:return Cr;case this.InterpolantFactoryMethodSmooth:return xr;case this.InterpolantFactoryMethodBezier:return Co}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]*=e}return this}trim(e,t){let n=this.times,i=n.length,r=0,a=i-1;for(;r!==i&&n[r]<e;)++r;for(;a!==-1&&n[a]>t;)--a;if(++a,r!==0||a!==i){r>=a&&(a=Math.max(a,1),r=a-1);let c=this.getValueSize();this.times=n.slice(r,a),this.values=this.values.slice(r*c,a*c)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(Be("KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,i=this.values,r=n.length;r===0&&(Be("KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let c=0;c!==r;c++){let l=n[c];if(typeof l=="number"&&isNaN(l)){Be("KeyframeTrack: Time is not a valid number.",this,c,l),e=!1;break}if(a!==null&&a>l){Be("KeyframeTrack: Out of order keys.",this,c,l,a),e=!1;break}a=l}if(i!==void 0&&Th(i))for(let c=0,l=i.length;c!==l;++c){let u=i[c];if(isNaN(u)){Be("KeyframeTrack: Value is not a valid number.",this,c,u),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),i=this.getInterpolation()===xr,r=e.length-1,a=1;for(let c=1;c<r;++c){let l=!1,u=e[c],d=e[c+1];if(u!==d&&(c!==1||u!==e[0]))if(i)l=!0;else{let o=c*n,h=o-n,f=o+n;for(let p=0;p!==n;++p){let v=t[o+p];if(v!==t[h+p]||v!==t[f+p]){l=!0;break}}}if(l){if(c!==a){e[a]=e[c];let o=c*n,h=a*n;for(let f=0;f!==n;++f)t[h+f]=t[o+f]}++a}}if(r>0){e[a]=e[r];for(let c=r*n,l=a*n,u=0;u!==n;++u)t[l+u]=t[c+u];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=t.slice(0,a*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,i=new n(this.name,e,t);return i.createInterpolant=this.createInterpolant,i}};Jt.prototype.ValueTypeName="";Jt.prototype.TimeBufferType=Float32Array;Jt.prototype.ValueBufferType=Float32Array;Jt.prototype.DefaultInterpolation=Cr;var Qn=class extends Jt{constructor(e,t,n){super(e,t,n)}};Qn.prototype.ValueTypeName="bool";Qn.prototype.ValueBufferType=Array;Qn.prototype.DefaultInterpolation=is;Qn.prototype.InterpolantFactoryMethodLinear=void 0;Qn.prototype.InterpolantFactoryMethodSmooth=void 0;var qr=class extends Jt{constructor(e,t,n,i){super(e,t,n,i)}};qr.prototype.ValueTypeName="color";var Yr=class extends Jt{constructor(e,t,n,i){super(e,t,n,i)}};Yr.prototype.ValueTypeName="number";var Zr=class extends Kn{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){let r=this.resultBuffer,a=this.sampleValues,c=this.valueSize,l=(n-t)/(i-t),u=e*c;for(let d=u+c;u!==d;u+=4)en.slerpFlat(r,0,a,u-c,a,u,l);return r}},ws=class extends Jt{constructor(e,t,n,i){super(e,t,n,i)}InterpolantFactoryMethodLinear(e){return new Zr(this.times,this.values,this.getValueSize(),e)}};ws.prototype.ValueTypeName="quaternion";ws.prototype.InterpolantFactoryMethodSmooth=void 0;var jn=class extends Jt{constructor(e,t,n){super(e,t,n)}};jn.prototype.ValueTypeName="string";jn.prototype.ValueBufferType=Array;jn.prototype.DefaultInterpolation=is;jn.prototype.InterpolantFactoryMethodLinear=void 0;jn.prototype.InterpolantFactoryMethodSmooth=void 0;var Jr=class extends Jt{constructor(e,t,n,i){super(e,t,n,i)}};Jr.prototype.ValueTypeName="vector";var $r=class{constructor(e,t,n){let i=this,r=!1,a=0,c=0,l,u=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this._abortController=null,this.itemStart=function(d){c++,r===!1&&i.onStart!==void 0&&i.onStart(d,a,c),r=!0},this.itemEnd=function(d){a++,i.onProgress!==void 0&&i.onProgress(d,a,c),a===c&&(r=!1,i.onLoad!==void 0&&i.onLoad())},this.itemError=function(d){i.onError!==void 0&&i.onError(d)},this.resolveURL=function(d){return l?l(d):d},this.setURLModifier=function(d){return l=d,this},this.addHandler=function(d,o){return u.push(d,o),this},this.removeHandler=function(d){let o=u.indexOf(d);return o!==-1&&u.splice(o,2),this},this.getHandler=function(d){for(let o=0,h=u.length;o<h;o+=2){let f=u[o],p=u[o+1];if(f.global&&(f.lastIndex=0),f.test(d))return p}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Bc=new $r,Kr=class{constructor(e){this.manager=e!==void 0?e:Bc,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,t){let n=this;return new Promise(function(i,r){n.load(e,i,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Kr.DEFAULT_MATERIAL_NAME="__DEFAULT";var zi=class extends Rt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Ke(e),this.intensity=t}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},Ts=class extends zi{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Rt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ke(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},Ao=new gt,Kl=new H,Ql=new H,Qr=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Je(512,512),this.mapType=Gt,this.map=null,this.mapPass=null,this.matrix=new gt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Bi,this._frameExtents=new Je(1,1),this._viewportCount=1,this._viewports=[new xt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,n=this.matrix;Kl.setFromMatrixPosition(e.matrixWorld),t.position.copy(Kl),Ql.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Ql),t.updateMatrixWorld(),Ao.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Ao,t.coordinateSystem,t.reversedDepth),t.coordinateSystem===Ui||t.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Ao)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},mr=new H,gr=new en,pn=new H,Es=class extends Rt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new gt,this.projectionMatrix=new gt,this.projectionMatrixInverse=new gt,this.coordinateSystem=cn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(mr,gr,pn),pn.x===1&&pn.y===1&&pn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(mr,gr,pn.set(1,1,1)).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorld.decompose(mr,gr,pn),pn.x===1&&pn.y===1&&pn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(mr,gr,pn.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Xn=new H,jl=new Je,ec=new Je,At=class extends Es{constructor(e=50,t=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=Pr*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(no*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Pr*2*Math.atan(Math.tan(no*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Xn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Xn.x,Xn.y).multiplyScalar(-e/Xn.z),Xn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Xn.x,Xn.y).multiplyScalar(-e/Xn.z)}getViewSize(e,t){return this.getViewBounds(e,jl,ec),t.subVectors(ec,jl)}setViewOffset(e,t,n,i,r,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(no*.5*this.fov)/this.zoom,n=2*t,i=this.aspect*n,r=-.5*i,a=this.view;if(this.view!==null&&this.view.enabled){let l=a.fullWidth,u=a.fullHeight;r+=a.offsetX*i/l,t-=a.offsetY*n/u,i*=a.width/l,n*=a.height/u}let c=this.filmOffset;c!==0&&(r+=e*c/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+i,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}};var Uo=class extends Qr{constructor(){super(new At(90,1,.5,500)),this.isPointLightShadow=!0}},As=class extends zi{constructor(e,t,n=0,i=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new Uo}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.decay=this.decay,t.object.shadow=this.shadow.toJSON(),t}},Vi=class extends Es{constructor(e=-1,t=1,n=1,i=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=i,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,i,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2,r=n-e,a=n+e,c=i+t,l=i-t;if(this.view!==null&&this.view.enabled){let u=(this.right-this.left)/this.view.fullWidth/this.zoom,d=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=u*this.view.offsetX,a=r+u*this.view.width,c-=d*this.view.offsetY,l=c-d*this.view.height}this.projectionMatrix.makeOrthographic(r,a,c,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},No=class extends Qr{constructor(){super(new Vi(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Cs=class extends zi{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Rt.DEFAULT_UP),this.updateMatrix(),this.target=new Rt,this.shadow=new No}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}};var Pi=-90,Ii=1,jr=class extends Rt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let i=new At(Pi,Ii,e,t);i.layers=this.layers,this.add(i);let r=new At(Pi,Ii,e,t);r.layers=this.layers,this.add(r);let a=new At(Pi,Ii,e,t);a.layers=this.layers,this.add(a);let c=new At(Pi,Ii,e,t);c.layers=this.layers,this.add(c);let l=new At(Pi,Ii,e,t);l.layers=this.layers,this.add(l);let u=new At(Pi,Ii,e,t);u.layers=this.layers,this.add(u)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,i,r,a,c,l]=t;for(let u of t)this.remove(u);if(e===cn)n.up.set(0,1,0),n.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),c.up.set(0,1,0),c.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Ui)n.up.set(0,-1,0),n.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),c.up.set(0,-1,0),c.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let u of t)this.add(u),u.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:i}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,a,c,l,u,d]=this.children,o=e.getRenderTarget(),h=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),p=e.xr.enabled;e.xr.enabled=!1;let v=n.texture.generateMipmaps;n.texture.generateMipmaps=!1;let g=!1;e.isWebGLRenderer===!0?g=e.state.buffers.depth.getReversed():g=e.reversedDepthBuffer,e.setRenderTarget(n,0,i),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,r),e.setRenderTarget(n,1,i),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(n,2,i),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,c),e.setRenderTarget(n,3,i),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),e.setRenderTarget(n,4,i),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,u),n.texture.generateMipmaps=v,e.setRenderTarget(n,5,i),g&&e.autoClear===!1&&e.clearDepth(),e.render(t,d),e.setRenderTarget(o,h,f),e.xr.enabled=p,n.texture.needsPMREMUpdate=!0}},ea=class extends At{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var ol="\\[\\]\\.:\\/",Zh=new RegExp("["+ol+"]","g"),ll="[^"+ol+"]",Jh="[^"+ol.replace("\\.","")+"]",$h=/((?:WC+[\/:])*)/.source.replace("WC",ll),Kh=/(WCOD+)?/.source.replace("WCOD",Jh),Qh=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",ll),jh=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",ll),eu=new RegExp("^"+$h+Kh+Qh+jh+"$"),tu=["material","materials","bones","map"],Fo=class{constructor(e,t,n){let i=n||pt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,i)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,i=this._bindings[n];i!==void 0&&i.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let i=this._targetGroup.nCachedObjects_,r=n.length;i!==r;++i)n[i].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},pt=class s{constructor(e,t,n){this.path=t,this.parsedPath=n||s.parseTrackName(t),this.node=s.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new s.Composite(e,t,n):new s(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(Zh,"")}static parseTrackName(e){let t=eu.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},i=n.nodeName&&n.nodeName.lastIndexOf(".");if(i!==void 0&&i!==-1){let r=n.nodeName.substring(i+1);tu.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,i),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let a=0;a<r.length;a++){let c=r[a];if(c.name===t||c.uuid===t)return c;let l=n(c.children);if(l)return l}return null},i=n(e.children);if(i)return i}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)e[t++]=n[i]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)n[i]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)n[i]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)n[i]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,i=t.propertyName,r=t.propertyIndex;if(e||(e=s.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Fe("PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let u=t.objectIndex;switch(n){case"materials":if(!e.material){Be("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Be("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Be("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let d=0;d<e.length;d++)if(e[d].name===u){u=d;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Be("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Be("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){Be("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(u!==void 0){if(e[u]===void 0){Be("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[u]}}let a=e[i];if(a===void 0){let u=t.nodeName;Be("PropertyBinding: Trying to update property for track: "+u+"."+i+" but it wasn't found.",e);return}let c=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?c=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(c=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(r!==void 0){if(i==="morphTargetInfluences"){if(!e.geometry){Be("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Be("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}l=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=r}else a.fromArray!==void 0&&a.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(l=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=i;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][c]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};pt.Composite=Fo;pt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};pt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};pt.prototype.GetterByBindingType=[pt.prototype._getValue_direct,pt.prototype._getValue_array,pt.prototype._getValue_arrayElement,pt.prototype._getValue_toArray];pt.prototype.SetterByBindingTypeAndVersioning=[[pt.prototype._setValue_direct,pt.prototype._setValue_direct_setNeedsUpdate,pt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[pt.prototype._setValue_array,pt.prototype._setValue_array_setNeedsUpdate,pt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[pt.prototype._setValue_arrayElement,pt.prototype._setValue_arrayElement_setNeedsUpdate,pt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[pt.prototype._setValue_fromArray,pt.prototype._setValue_fromArray_setNeedsUpdate,pt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var Ym=new Float32Array(1);var pl=class pl{constructor(e,t,n,i){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,i)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,i){let r=this.elements;return r[0]=e,r[2]=t,r[1]=n,r[3]=i,this}};pl.prototype.isMatrix2=!0;var Oo=pl;function cl(s,e,t,n){let i=nu(n);switch(t){case tl:return s*e;case il:return s*e/i.components*i.byteLength;case ha:return s*e/i.components*i.byteLength;case ii:return s*e*2/i.components*i.byteLength;case ua:return s*e*2/i.components*i.byteLength;case nl:return s*e*3/i.components*i.byteLength;case sn:return s*e*4/i.components*i.byteLength;case fa:return s*e*4/i.components*i.byteLength;case Ls:case Ds:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*8;case Us:case Ns:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*16;case pa:case ga:return Math.max(s,16)*Math.max(e,8)/4;case da:case ma:return Math.max(s,8)*Math.max(e,8)/2;case xa:case va:case ya:case Sa:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*8;case _a:case Fs:case Ma:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*16;case ba:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*16;case wa:return Math.floor((s+4)/5)*Math.floor((e+3)/4)*16;case Ta:return Math.floor((s+4)/5)*Math.floor((e+4)/5)*16;case Ea:return Math.floor((s+5)/6)*Math.floor((e+4)/5)*16;case Aa:return Math.floor((s+5)/6)*Math.floor((e+5)/6)*16;case Ca:return Math.floor((s+7)/8)*Math.floor((e+4)/5)*16;case Ra:return Math.floor((s+7)/8)*Math.floor((e+5)/6)*16;case Pa:return Math.floor((s+7)/8)*Math.floor((e+7)/8)*16;case Ia:return Math.floor((s+9)/10)*Math.floor((e+4)/5)*16;case La:return Math.floor((s+9)/10)*Math.floor((e+5)/6)*16;case Da:return Math.floor((s+9)/10)*Math.floor((e+7)/8)*16;case Ua:return Math.floor((s+9)/10)*Math.floor((e+9)/10)*16;case Na:return Math.floor((s+11)/12)*Math.floor((e+9)/10)*16;case Fa:return Math.floor((s+11)/12)*Math.floor((e+11)/12)*16;case Oa:case Ba:case za:return Math.ceil(s/4)*Math.ceil(e/4)*16;case Va:case ka:return Math.ceil(s/4)*Math.ceil(e/4)*8;case Os:case Ga:return Math.ceil(s/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function nu(s){switch(s){case Gt:case Ko:return{byteLength:1,components:1};case Gi:case Qo:case yn:return{byteLength:2,components:1};case la:case ca:return{byteLength:2,components:4};case un:case oa:case fn:return{byteLength:4,components:1};case jo:case el:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${s}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:na}}));typeof window<"u"&&(window.__THREE__?Fe("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=na);function oh(){let s=null,e=!1,t=null,n=null;function i(r,a){t(r,a),n=s.requestAnimationFrame(i)}return{start:function(){e!==!0&&t!==null&&s!==null&&(n=s.requestAnimationFrame(i),e=!0)},stop:function(){s!==null&&s.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){s=r}}}function iu(s){let e=new WeakMap;function t(c,l){let u=c.array,d=c.usage,o=u.byteLength,h=s.createBuffer();s.bindBuffer(l,h),s.bufferData(l,u,d),c.onUploadCallback();let f;if(u instanceof Float32Array)f=s.FLOAT;else if(typeof Float16Array<"u"&&u instanceof Float16Array)f=s.HALF_FLOAT;else if(u instanceof Uint16Array)c.isFloat16BufferAttribute?f=s.HALF_FLOAT:f=s.UNSIGNED_SHORT;else if(u instanceof Int16Array)f=s.SHORT;else if(u instanceof Uint32Array)f=s.UNSIGNED_INT;else if(u instanceof Int32Array)f=s.INT;else if(u instanceof Int8Array)f=s.BYTE;else if(u instanceof Uint8Array)f=s.UNSIGNED_BYTE;else if(u instanceof Uint8ClampedArray)f=s.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+u);return{buffer:h,type:f,bytesPerElement:u.BYTES_PER_ELEMENT,version:c.version,size:o}}function n(c,l,u){let d=l.array,o=l.updateRanges;if(s.bindBuffer(u,c),o.length===0)s.bufferSubData(u,0,d);else{o.sort((f,p)=>f.start-p.start);let h=0;for(let f=1;f<o.length;f++){let p=o[h],v=o[f];v.start<=p.start+p.count+1?p.count=Math.max(p.count,v.start+v.count-p.start):(++h,o[h]=v)}o.length=h+1;for(let f=0,p=o.length;f<p;f++){let v=o[f];s.bufferSubData(u,v.start*d.BYTES_PER_ELEMENT,d,v.start,v.count)}l.clearUpdateRanges()}l.onUploadCallback()}function i(c){return c.isInterleavedBufferAttribute&&(c=c.data),e.get(c)}function r(c){c.isInterleavedBufferAttribute&&(c=c.data);let l=e.get(c);l&&(s.deleteBuffer(l.buffer),e.delete(c))}function a(c,l){if(c.isInterleavedBufferAttribute&&(c=c.data),c.isGLBufferAttribute){let d=e.get(c);(!d||d.version<c.version)&&e.set(c,{buffer:c.buffer,type:c.type,bytesPerElement:c.elementSize,version:c.version});return}let u=e.get(c);if(u===void 0)e.set(c,t(c,l));else if(u.version<c.version){if(u.size!==c.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(u.buffer,c,l),u.version=c.version}}return{get:i,remove:r,update:a}}var su=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,ru=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,au=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,ou=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,lu=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,cu=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,hu=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,uu=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,fu=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,du=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,pu=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,mu=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,gu=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,xu=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,vu=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,_u=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,yu=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Su=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Mu=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,bu=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,wu=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,Tu=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,Eu=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,Au=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,Cu=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Ru=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,Pu=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Iu=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Lu=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,Du=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Uu="gl_FragColor = linearToOutputTexel( gl_FragColor );",Nu=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Fu=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,Ou=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,Bu=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,zu=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Vu=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,ku=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Gu=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Hu=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Wu=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Xu=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,qu=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Yu=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Zu=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Ju=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,$u=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Ku=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Qu=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,ju=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,ef=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,tf=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,nf=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
		vec3 iridescenceFresnelDielectric;
		vec3 iridescenceFresnelMetallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
vec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 dfgV = texture2D( dfgLUT, vec2( material.roughness, dotNV ) ).rg;
	vec2 dfgL = texture2D( dfgLUT, vec2( material.roughness, dotNL ) ).rg;
	vec3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;
	vec3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;
	float Ess_V = dfgV.x + dfgV.y;
	float Ess_L = dfgL.x + dfgL.y;
	float Ems_V = 1.0 - Ess_V;
	float Ems_L = 1.0 - Ess_L;
	vec3 Favg = material.specularColorBlended + ( 1.0 - material.specularColorBlended ) * 0.047619;
	vec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg + EPSILON );
	float compensationFactor = Ems_V * Ems_L;
	vec3 multiScatter = Fms * compensationFactor;
	return singleScatter + multiScatter;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnelDielectric, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceFresnelMetallic, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,sf=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( material.iridescenceFresnelDielectric, material.iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = inverseTransformDirection( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,rf=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,af=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,of=`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,lf=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,cf=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,hf=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,uf=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,ff=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,df=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,pf=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,mf=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,gf=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,xf=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,vf=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,_f=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,yf=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Sf=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,Mf=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,bf=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,wf=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,Tf=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Ef=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Af=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Cf=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,Rf=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Pf=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,If=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Lf=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Df=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Uf=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,Nf=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Ff=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Of=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Bf=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,zf=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Vf=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,kf=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,Gf=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Hf=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Wf=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Xf=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,qf=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Yf=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Zf=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Jf=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,$f=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Kf=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Qf=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,jf=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,ed=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,td=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,nd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,id=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,sd=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,rd=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,ad=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,od=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,ld=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,cd=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,hd=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,ud=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,fd=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,dd=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,pd=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,md=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,gd=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,xd=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,vd=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,_d=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,yd=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Sd=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Md=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,bd=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,wd=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Td=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,Ed=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,Ad=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Cd=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Rd=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,Pd=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Id=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Ld=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Dd=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,Ud=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Nd=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Fd=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Od=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Bd=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,$e={alphahash_fragment:su,alphahash_pars_fragment:ru,alphamap_fragment:au,alphamap_pars_fragment:ou,alphatest_fragment:lu,alphatest_pars_fragment:cu,aomap_fragment:hu,aomap_pars_fragment:uu,batching_pars_vertex:fu,batching_vertex:du,begin_vertex:pu,beginnormal_vertex:mu,bsdfs:gu,iridescence_fragment:xu,bumpmap_pars_fragment:vu,clipping_planes_fragment:_u,clipping_planes_pars_fragment:yu,clipping_planes_pars_vertex:Su,clipping_planes_vertex:Mu,color_fragment:bu,color_pars_fragment:wu,color_pars_vertex:Tu,color_vertex:Eu,common:Au,cube_uv_reflection_fragment:Cu,defaultnormal_vertex:Ru,displacementmap_pars_vertex:Pu,displacementmap_vertex:Iu,emissivemap_fragment:Lu,emissivemap_pars_fragment:Du,colorspace_fragment:Uu,colorspace_pars_fragment:Nu,envmap_fragment:Fu,envmap_common_pars_fragment:Ou,envmap_pars_fragment:Bu,envmap_pars_vertex:zu,envmap_physical_pars_fragment:$u,envmap_vertex:Vu,fog_vertex:ku,fog_pars_vertex:Gu,fog_fragment:Hu,fog_pars_fragment:Wu,gradientmap_pars_fragment:Xu,lightmap_pars_fragment:qu,lights_lambert_fragment:Yu,lights_lambert_pars_fragment:Zu,lights_pars_begin:Ju,lights_toon_fragment:Ku,lights_toon_pars_fragment:Qu,lights_phong_fragment:ju,lights_phong_pars_fragment:ef,lights_physical_fragment:tf,lights_physical_pars_fragment:nf,lights_fragment_begin:sf,lights_fragment_maps:rf,lights_fragment_end:af,lightprobes_pars_fragment:of,logdepthbuf_fragment:lf,logdepthbuf_pars_fragment:cf,logdepthbuf_pars_vertex:hf,logdepthbuf_vertex:uf,map_fragment:ff,map_pars_fragment:df,map_particle_fragment:pf,map_particle_pars_fragment:mf,metalnessmap_fragment:gf,metalnessmap_pars_fragment:xf,morphinstance_vertex:vf,morphcolor_vertex:_f,morphnormal_vertex:yf,morphtarget_pars_vertex:Sf,morphtarget_vertex:Mf,normal_fragment_begin:bf,normal_fragment_maps:wf,normal_pars_fragment:Tf,normal_pars_vertex:Ef,normal_vertex:Af,normalmap_pars_fragment:Cf,clearcoat_normal_fragment_begin:Rf,clearcoat_normal_fragment_maps:Pf,clearcoat_pars_fragment:If,iridescence_pars_fragment:Lf,opaque_fragment:Df,packing:Uf,premultiplied_alpha_fragment:Nf,project_vertex:Ff,dithering_fragment:Of,dithering_pars_fragment:Bf,roughnessmap_fragment:zf,roughnessmap_pars_fragment:Vf,shadowmap_pars_fragment:kf,shadowmap_pars_vertex:Gf,shadowmap_vertex:Hf,shadowmask_pars_fragment:Wf,skinbase_vertex:Xf,skinning_pars_vertex:qf,skinning_vertex:Yf,skinnormal_vertex:Zf,specularmap_fragment:Jf,specularmap_pars_fragment:$f,tonemapping_fragment:Kf,tonemapping_pars_fragment:Qf,transmission_fragment:jf,transmission_pars_fragment:ed,uv_pars_fragment:td,uv_pars_vertex:nd,uv_vertex:id,worldpos_vertex:sd,background_vert:rd,background_frag:ad,backgroundCube_vert:od,backgroundCube_frag:ld,cube_vert:cd,cube_frag:hd,depth_vert:ud,depth_frag:fd,distance_vert:dd,distance_frag:pd,equirect_vert:md,equirect_frag:gd,linedashed_vert:xd,linedashed_frag:vd,meshbasic_vert:_d,meshbasic_frag:yd,meshlambert_vert:Sd,meshlambert_frag:Md,meshmatcap_vert:bd,meshmatcap_frag:wd,meshnormal_vert:Td,meshnormal_frag:Ed,meshphong_vert:Ad,meshphong_frag:Cd,meshphysical_vert:Rd,meshphysical_frag:Pd,meshtoon_vert:Id,meshtoon_frag:Ld,points_vert:Dd,points_frag:Ud,shadow_vert:Nd,shadow_frag:Fd,sprite_vert:Od,sprite_frag:Bd},be={common:{diffuse:{value:new Ke(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new We},alphaMap:{value:null},alphaMapTransform:{value:new We},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new We}},envmap:{envMap:{value:null},envMapRotation:{value:new We},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new We}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new We}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new We},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new We},normalScale:{value:new Je(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new We},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new We}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new We}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new We}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ke(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new H},probesMax:{value:new H},probesResolution:{value:new H}},points:{diffuse:{value:new Ke(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new We},alphaTest:{value:0},uvTransform:{value:new We}},sprite:{diffuse:{value:new Ke(16777215)},opacity:{value:1},center:{value:new Je(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new We},alphaMap:{value:null},alphaMapTransform:{value:new We},alphaTest:{value:0}}},Mn={basic:{uniforms:Ft([be.common,be.specularmap,be.envmap,be.aomap,be.lightmap,be.fog]),vertexShader:$e.meshbasic_vert,fragmentShader:$e.meshbasic_frag},lambert:{uniforms:Ft([be.common,be.specularmap,be.envmap,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.fog,be.lights,{emissive:{value:new Ke(0)},envMapIntensity:{value:1}}]),vertexShader:$e.meshlambert_vert,fragmentShader:$e.meshlambert_frag},phong:{uniforms:Ft([be.common,be.specularmap,be.envmap,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.fog,be.lights,{emissive:{value:new Ke(0)},specular:{value:new Ke(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:$e.meshphong_vert,fragmentShader:$e.meshphong_frag},standard:{uniforms:Ft([be.common,be.envmap,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.roughnessmap,be.metalnessmap,be.fog,be.lights,{emissive:{value:new Ke(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:$e.meshphysical_vert,fragmentShader:$e.meshphysical_frag},toon:{uniforms:Ft([be.common,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.gradientmap,be.fog,be.lights,{emissive:{value:new Ke(0)}}]),vertexShader:$e.meshtoon_vert,fragmentShader:$e.meshtoon_frag},matcap:{uniforms:Ft([be.common,be.bumpmap,be.normalmap,be.displacementmap,be.fog,{matcap:{value:null}}]),vertexShader:$e.meshmatcap_vert,fragmentShader:$e.meshmatcap_frag},points:{uniforms:Ft([be.points,be.fog]),vertexShader:$e.points_vert,fragmentShader:$e.points_frag},dashed:{uniforms:Ft([be.common,be.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:$e.linedashed_vert,fragmentShader:$e.linedashed_frag},depth:{uniforms:Ft([be.common,be.displacementmap]),vertexShader:$e.depth_vert,fragmentShader:$e.depth_frag},normal:{uniforms:Ft([be.common,be.bumpmap,be.normalmap,be.displacementmap,{opacity:{value:1}}]),vertexShader:$e.meshnormal_vert,fragmentShader:$e.meshnormal_frag},sprite:{uniforms:Ft([be.sprite,be.fog]),vertexShader:$e.sprite_vert,fragmentShader:$e.sprite_frag},background:{uniforms:{uvTransform:{value:new We},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:$e.background_vert,fragmentShader:$e.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new We}},vertexShader:$e.backgroundCube_vert,fragmentShader:$e.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:$e.cube_vert,fragmentShader:$e.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:$e.equirect_vert,fragmentShader:$e.equirect_frag},distance:{uniforms:Ft([be.common,be.displacementmap,{referencePosition:{value:new H},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:$e.distance_vert,fragmentShader:$e.distance_frag},shadow:{uniforms:Ft([be.lights,be.fog,{color:{value:new Ke(0)},opacity:{value:1}}]),vertexShader:$e.shadow_vert,fragmentShader:$e.shadow_frag}};Mn.physical={uniforms:Ft([Mn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new We},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new We},clearcoatNormalScale:{value:new Je(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new We},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new We},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new We},sheen:{value:0},sheenColor:{value:new Ke(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new We},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new We},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new We},transmissionSamplerSize:{value:new Je},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new We},attenuationDistance:{value:0},attenuationColor:{value:new Ke(0)},specularColor:{value:new Ke(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new We},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new We},anisotropyVector:{value:new Je},anisotropyMap:{value:null},anisotropyMapTransform:{value:new We}}]),vertexShader:$e.meshphysical_vert,fragmentShader:$e.meshphysical_frag};var qa={r:0,b:0,g:0},zd=new gt,lh=new We;lh.set(-1,0,0,0,1,0,0,0,1);function Vd(s,e,t,n,i,r){let a=new Ke(0),c=i===!0?0:1,l,u,d=null,o=0,h=null;function f(M){let x=M.isScene===!0?M.background:null;if(x&&x.isTexture){let S=M.backgroundBlurriness>0;x=e.get(x,S)}return x}function p(M){let x=!1,S=f(M);S===null?g(a,c):S&&S.isColor&&(g(S,1),x=!0);let w=s.xr.getEnvironmentBlendMode();w==="additive"?t.buffers.color.setClear(0,0,0,1,r):w==="alpha-blend"&&t.buffers.color.setClear(0,0,0,0,r),(s.autoClear||x)&&(t.buffers.depth.setTest(!0),t.buffers.depth.setMask(!0),t.buffers.color.setMask(!0),s.clear(s.autoClearColor,s.autoClearDepth,s.autoClearStencil))}function v(M,x){let S=f(x);S&&(S.isCubeTexture||S.mapping===Ps)?(u===void 0&&(u=new Tt(new $n(1,1,1),new Zt({name:"BackgroundCubeMaterial",uniforms:gi(Mn.backgroundCube.uniforms),vertexShader:Mn.backgroundCube.vertexShader,fragmentShader:Mn.backgroundCube.fragmentShader,side:zt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),u.geometry.deleteAttribute("normal"),u.geometry.deleteAttribute("uv"),u.onBeforeRender=function(w,y,E){this.matrixWorld.copyPosition(E.matrixWorld)},Object.defineProperty(u.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),n.update(u)),u.material.uniforms.envMap.value=S,u.material.uniforms.backgroundBlurriness.value=x.backgroundBlurriness,u.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,u.material.uniforms.backgroundRotation.value.setFromMatrix4(zd.makeRotationFromEuler(x.backgroundRotation)).transpose(),S.isCubeTexture&&S.isRenderTargetTexture===!1&&u.material.uniforms.backgroundRotation.value.premultiply(lh),u.material.toneMapped=et.getTransfer(S.colorSpace)!==ht,(d!==S||o!==S.version||h!==s.toneMapping)&&(u.material.needsUpdate=!0,d=S,o=S.version,h=s.toneMapping),u.layers.enableAll(),M.unshift(u,u.geometry,u.material,0,0,null)):S&&S.isTexture&&(l===void 0&&(l=new Tt(new ys(2,2),new Zt({name:"BackgroundMaterial",uniforms:gi(Mn.background.uniforms),vertexShader:Mn.background.vertexShader,fragmentShader:Mn.background.fragmentShader,side:In,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),n.update(l)),l.material.uniforms.t2D.value=S,l.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,l.material.toneMapped=et.getTransfer(S.colorSpace)!==ht,S.matrixAutoUpdate===!0&&S.updateMatrix(),l.material.uniforms.uvTransform.value.copy(S.matrix),(d!==S||o!==S.version||h!==s.toneMapping)&&(l.material.needsUpdate=!0,d=S,o=S.version,h=s.toneMapping),l.layers.enableAll(),M.unshift(l,l.geometry,l.material,0,0,null))}function g(M,x){M.getRGB(qa,al(s)),t.buffers.color.setClear(qa.r,qa.g,qa.b,x,r)}function m(){u!==void 0&&(u.geometry.dispose(),u.material.dispose(),u=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(M,x=1){a.set(M),c=x,g(a,c)},getClearAlpha:function(){return c},setClearAlpha:function(M){c=M,g(a,c)},render:p,addToRenderList:v,dispose:m}}function kd(s,e){let t=s.getParameter(s.MAX_VERTEX_ATTRIBS),n={},i=h(null),r=i,a=!1;function c(A,L,N,O,D){let F=!1,k=o(A,O,N,L);r!==k&&(r=k,u(r.object)),F=f(A,O,N,D),F&&p(A,O,N,D),D!==null&&e.update(D,s.ELEMENT_ARRAY_BUFFER),(F||a)&&(a=!1,S(A,L,N,O),D!==null&&s.bindBuffer(s.ELEMENT_ARRAY_BUFFER,e.get(D).buffer))}function l(){return s.createVertexArray()}function u(A){return s.bindVertexArray(A)}function d(A){return s.deleteVertexArray(A)}function o(A,L,N,O){let D=O.wireframe===!0,F=n[L.id];F===void 0&&(F={},n[L.id]=F);let k=A.isInstancedMesh===!0?A.id:0,Q=F[k];Q===void 0&&(Q={},F[k]=Q);let ie=Q[N.id];ie===void 0&&(ie={},Q[N.id]=ie);let oe=ie[D];return oe===void 0&&(oe=h(l()),ie[D]=oe),oe}function h(A){let L=[],N=[],O=[];for(let D=0;D<t;D++)L[D]=0,N[D]=0,O[D]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:L,enabledAttributes:N,attributeDivisors:O,object:A,attributes:{},index:null}}function f(A,L,N,O){let D=r.attributes,F=L.attributes,k=0,Q=N.getAttributes();for(let ie in Q)if(Q[ie].location>=0){let xe=D[ie],Ee=F[ie];if(Ee===void 0&&(ie==="instanceMatrix"&&A.instanceMatrix&&(Ee=A.instanceMatrix),ie==="instanceColor"&&A.instanceColor&&(Ee=A.instanceColor)),xe===void 0||xe.attribute!==Ee||Ee&&xe.data!==Ee.data)return!0;k++}return r.attributesNum!==k||r.index!==O}function p(A,L,N,O){let D={},F=L.attributes,k=0,Q=N.getAttributes();for(let ie in Q)if(Q[ie].location>=0){let xe=F[ie];xe===void 0&&(ie==="instanceMatrix"&&A.instanceMatrix&&(xe=A.instanceMatrix),ie==="instanceColor"&&A.instanceColor&&(xe=A.instanceColor));let Ee={};Ee.attribute=xe,xe&&xe.data&&(Ee.data=xe.data),D[ie]=Ee,k++}r.attributes=D,r.attributesNum=k,r.index=O}function v(){let A=r.newAttributes;for(let L=0,N=A.length;L<N;L++)A[L]=0}function g(A){m(A,0)}function m(A,L){let N=r.newAttributes,O=r.enabledAttributes,D=r.attributeDivisors;N[A]=1,O[A]===0&&(s.enableVertexAttribArray(A),O[A]=1),D[A]!==L&&(s.vertexAttribDivisor(A,L),D[A]=L)}function M(){let A=r.newAttributes,L=r.enabledAttributes;for(let N=0,O=L.length;N<O;N++)L[N]!==A[N]&&(s.disableVertexAttribArray(N),L[N]=0)}function x(A,L,N,O,D,F,k){k===!0?s.vertexAttribIPointer(A,L,N,D,F):s.vertexAttribPointer(A,L,N,O,D,F)}function S(A,L,N,O){v();let D=O.attributes,F=N.getAttributes(),k=L.defaultAttributeValues;for(let Q in F){let ie=F[Q];if(ie.location>=0){let oe=D[Q];if(oe===void 0&&(Q==="instanceMatrix"&&A.instanceMatrix&&(oe=A.instanceMatrix),Q==="instanceColor"&&A.instanceColor&&(oe=A.instanceColor)),oe!==void 0){let xe=oe.normalized,Ee=oe.itemSize,ze=e.get(oe);if(ze===void 0)continue;let Ce=ze.buffer,De=ze.type,J=ze.bytesPerElement,ge=De===s.INT||De===s.UNSIGNED_INT||oe.gpuType===oa;if(oe.isInterleavedBufferAttribute){let ae=oe.data,Pe=ae.stride,Le=oe.offset;if(ae.isInstancedInterleavedBuffer){for(let Ne=0;Ne<ie.locationSize;Ne++)m(ie.location+Ne,ae.meshPerAttribute);A.isInstancedMesh!==!0&&O._maxInstanceCount===void 0&&(O._maxInstanceCount=ae.meshPerAttribute*ae.count)}else for(let Ne=0;Ne<ie.locationSize;Ne++)g(ie.location+Ne);s.bindBuffer(s.ARRAY_BUFFER,Ce);for(let Ne=0;Ne<ie.locationSize;Ne++)x(ie.location+Ne,Ee/ie.locationSize,De,xe,Pe*J,(Le+Ee/ie.locationSize*Ne)*J,ge)}else{if(oe.isInstancedBufferAttribute){for(let ae=0;ae<ie.locationSize;ae++)m(ie.location+ae,oe.meshPerAttribute);A.isInstancedMesh!==!0&&O._maxInstanceCount===void 0&&(O._maxInstanceCount=oe.meshPerAttribute*oe.count)}else for(let ae=0;ae<ie.locationSize;ae++)g(ie.location+ae);s.bindBuffer(s.ARRAY_BUFFER,Ce);for(let ae=0;ae<ie.locationSize;ae++)x(ie.location+ae,Ee/ie.locationSize,De,xe,Ee*J,Ee/ie.locationSize*ae*J,ge)}}else if(k!==void 0){let xe=k[Q];if(xe!==void 0)switch(xe.length){case 2:s.vertexAttrib2fv(ie.location,xe);break;case 3:s.vertexAttrib3fv(ie.location,xe);break;case 4:s.vertexAttrib4fv(ie.location,xe);break;default:s.vertexAttrib1fv(ie.location,xe)}}}}M()}function w(){b();for(let A in n){let L=n[A];for(let N in L){let O=L[N];for(let D in O){let F=O[D];for(let k in F)d(F[k].object),delete F[k];delete O[D]}}delete n[A]}}function y(A){if(n[A.id]===void 0)return;let L=n[A.id];for(let N in L){let O=L[N];for(let D in O){let F=O[D];for(let k in F)d(F[k].object),delete F[k];delete O[D]}}delete n[A.id]}function E(A){for(let L in n){let N=n[L];for(let O in N){let D=N[O];if(D[A.id]===void 0)continue;let F=D[A.id];for(let k in F)d(F[k].object),delete F[k];delete D[A.id]}}}function _(A){for(let L in n){let N=n[L],O=A.isInstancedMesh===!0?A.id:0,D=N[O];if(D!==void 0){for(let F in D){let k=D[F];for(let Q in k)d(k[Q].object),delete k[Q];delete D[F]}delete N[O],Object.keys(N).length===0&&delete n[L]}}}function b(){R(),a=!0,r!==i&&(r=i,u(r.object))}function R(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:c,reset:b,resetDefaultState:R,dispose:w,releaseStatesOfGeometry:y,releaseStatesOfObject:_,releaseStatesOfProgram:E,initAttributes:v,enableAttribute:g,disableUnusedAttributes:M}}function Gd(s,e,t){let n;function i(l){n=l}function r(l,u){s.drawArrays(n,l,u),t.update(u,n,1)}function a(l,u,d){d!==0&&(s.drawArraysInstanced(n,l,u,d),t.update(u,n,d))}function c(l,u,d){if(d===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,u,0,d);let h=0;for(let f=0;f<d;f++)h+=u[f];t.update(h,n,1)}this.setMode=i,this.render=r,this.renderInstances=a,this.renderMultiDraw=c}function Hd(s,e,t,n){let i;function r(){if(i!==void 0)return i;if(e.has("EXT_texture_filter_anisotropic")===!0){let E=e.get("EXT_texture_filter_anisotropic");i=s.getParameter(E.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function a(E){return!(E!==sn&&n.convert(E)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_FORMAT))}function c(E){let _=E===yn&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(E!==Gt&&n.convert(E)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_TYPE)&&E!==fn&&!_)}function l(E){if(E==="highp"){if(s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.HIGH_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.HIGH_FLOAT).precision>0)return"highp";E="mediump"}return E==="mediump"&&s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.MEDIUM_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let u=t.precision!==void 0?t.precision:"highp",d=l(u);d!==u&&(Fe("WebGLRenderer:",u,"not supported, using",d,"instead."),u=d);let o=t.logarithmicDepthBuffer===!0,h=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control");t.reversedDepthBuffer===!0&&h===!1&&Fe("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let f=s.getParameter(s.MAX_TEXTURE_IMAGE_UNITS),p=s.getParameter(s.MAX_VERTEX_TEXTURE_IMAGE_UNITS),v=s.getParameter(s.MAX_TEXTURE_SIZE),g=s.getParameter(s.MAX_CUBE_MAP_TEXTURE_SIZE),m=s.getParameter(s.MAX_VERTEX_ATTRIBS),M=s.getParameter(s.MAX_VERTEX_UNIFORM_VECTORS),x=s.getParameter(s.MAX_VARYING_VECTORS),S=s.getParameter(s.MAX_FRAGMENT_UNIFORM_VECTORS),w=s.getParameter(s.MAX_SAMPLES),y=s.getParameter(s.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:c,precision:u,logarithmicDepthBuffer:o,reversedDepthBuffer:h,maxTextures:f,maxVertexTextures:p,maxTextureSize:v,maxCubemapSize:g,maxAttributes:m,maxVertexUniforms:M,maxVaryings:x,maxFragmentUniforms:S,maxSamples:w,samples:y}}function Wd(s){let e=this,t=null,n=0,i=!1,r=!1,a=new mn,c=new We,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(o,h){let f=o.length!==0||h||n!==0||i;return i=h,n=o.length,f},this.beginShadows=function(){r=!0,d(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(o,h){t=d(o,h,0)},this.setState=function(o,h,f){let p=o.clippingPlanes,v=o.clipIntersection,g=o.clipShadows,m=s.get(o);if(!i||p===null||p.length===0||r&&!g)r?d(null):u();else{let M=r?0:n,x=M*4,S=m.clippingState||null;l.value=S,S=d(p,h,x,f);for(let w=0;w!==x;++w)S[w]=t[w];m.clippingState=S,this.numIntersection=v?this.numPlanes:0,this.numPlanes+=M}};function u(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function d(o,h,f,p){let v=o!==null?o.length:0,g=null;if(v!==0){if(g=l.value,p!==!0||g===null){let m=f+v*4,M=h.matrixWorldInverse;c.getNormalMatrix(M),(g===null||g.length<m)&&(g=new Float32Array(m));for(let x=0,S=f;x!==v;++x,S+=4)a.copy(o[x]).applyMatrix4(M,c),a.normal.toArray(g,S),g[S+3]=a.constant}l.value=g,l.needsUpdate=!0}return e.numPlanes=v,e.numIntersection=0,g}}var si=4,zc=[.125,.215,.35,.446,.526,.582],xi=20,Xd=256,zs=new Vi,Vc=new Ke,ml=null,gl=0,xl=0,vl=!1,qd=new H,Za=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,n=.1,i=100,r={}){let{size:a=256,position:c=qd}=r;ml=this._renderer.getRenderTarget(),gl=this._renderer.getActiveCubeFace(),xl=this._renderer.getActiveMipmapLevel(),vl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,n,i,l,c),t>0&&this._blur(l,0,0,t),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Hc(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Gc(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(ml,gl,xl),this._renderer.xr.enabled=vl,e.scissorTest=!1,Wi(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===ei||e.mapping===mi?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),ml=this._renderer.getRenderTarget(),gl=this._renderer.getActiveCubeFace(),xl=this._renderer.getActiveMipmapLevel(),vl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Ct,minFilter:Ct,generateMipmaps:!1,type:yn,format:sn,colorSpace:ss,depthBuffer:!1},i=kc(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=kc(e,t,n);let{_lodMax:r}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=Yd(r)),this._blurMaterial=Jd(r,e,t),this._ggxMaterial=Zd(r,e,t)}return i}_compileMaterial(e){let t=new Tt(new Pt,e);this._renderer.compile(t,zs)}_sceneToCubeUV(e,t,n,i,r){let l=new At(90,1,t,n),u=[1,-1,1,1,1,1],d=[1,1,1,-1,-1,-1],o=this._renderer,h=o.autoClear,f=o.toneMapping;o.getClearColor(Vc),o.toneMapping=hn,o.autoClear=!1,o.state.buffers.depth.getReversed()&&(o.setRenderTarget(i),o.clearDepth(),o.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Tt(new $n,new Jn({name:"PMREM.Background",side:zt,depthWrite:!1,depthTest:!1})));let v=this._backgroundBox,g=v.material,m=!1,M=e.background;M?M.isColor&&(g.color.copy(M),e.background=null,m=!0):(g.color.copy(Vc),m=!0);for(let x=0;x<6;x++){let S=x%3;S===0?(l.up.set(0,u[x],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x+d[x],r.y,r.z)):S===1?(l.up.set(0,0,u[x]),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y+d[x],r.z)):(l.up.set(0,u[x],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y,r.z+d[x]));let w=this._cubeSize;Wi(i,S*w,x>2?w:0,w,w),o.setRenderTarget(i),m&&o.render(v,l),o.render(e,l)}o.toneMapping=f,o.autoClear=h,e.background=M}_textureToCubeUV(e,t){let n=this._renderer,i=e.mapping===ei||e.mapping===mi;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=Hc()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Gc());let r=i?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=r;let c=r.uniforms;c.envMap.value=e;let l=this._cubeSize;Wi(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(a,zs)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let i=this._lodMeshes.length;for(let r=1;r<i;r++)this._applyGGXFilter(e,r-1,r);t.autoClear=n}_applyGGXFilter(e,t,n){let i=this._renderer,r=this._pingPongRenderTarget,a=this._ggxMaterial,c=this._lodMeshes[n];c.material=a;let l=a.uniforms,u=n/(this._lodMeshes.length-1),d=t/(this._lodMeshes.length-1),o=Math.sqrt(u*u-d*d),h=0+u*1.25,f=o*h,{_lodMax:p}=this,v=this._sizeLods[n],g=3*v*(n>p-si?n-p+si:0),m=4*(this._cubeSize-v);l.envMap.value=e.texture,l.roughness.value=f,l.mipInt.value=p-t,Wi(r,g,m,3*v,2*v),i.setRenderTarget(r),i.render(c,zs),l.envMap.value=r.texture,l.roughness.value=0,l.mipInt.value=p-n,Wi(e,g,m,3*v,2*v),i.setRenderTarget(e),i.render(c,zs)}_blur(e,t,n,i,r){let a=this._pingPongRenderTarget;this._halfBlur(e,a,t,n,i,"latitudinal",r),this._halfBlur(a,e,n,n,i,"longitudinal",r)}_halfBlur(e,t,n,i,r,a,c){let l=this._renderer,u=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&Be("blur direction must be either latitudinal or longitudinal!");let d=3,o=this._lodMeshes[i];o.material=u;let h=u.uniforms,f=this._sizeLods[n]-1,p=isFinite(r)?Math.PI/(2*f):2*Math.PI/(2*xi-1),v=r/p,g=isFinite(r)?1+Math.floor(d*v):xi;g>xi&&Fe(`sigmaRadians, ${r}, is too large and will clip, as it requested ${g} samples when the maximum is set to ${xi}`);let m=[],M=0;for(let E=0;E<xi;++E){let _=E/v,b=Math.exp(-_*_/2);m.push(b),E===0?M+=b:E<g&&(M+=2*b)}for(let E=0;E<m.length;E++)m[E]=m[E]/M;h.envMap.value=e.texture,h.samples.value=g,h.weights.value=m,h.latitudinal.value=a==="latitudinal",c&&(h.poleAxis.value=c);let{_lodMax:x}=this;h.dTheta.value=p,h.mipInt.value=x-n;let S=this._sizeLods[i],w=3*S*(i>x-si?i-x+si:0),y=4*(this._cubeSize-S);Wi(t,w,y,3*S,2*S),l.setRenderTarget(t),l.render(o,zs)}};function Yd(s){let e=[],t=[],n=[],i=s,r=s-si+1+zc.length;for(let a=0;a<r;a++){let c=Math.pow(2,i);e.push(c);let l=1/c;a>s-si?l=zc[a-s+si-1]:a===0&&(l=0),t.push(l);let u=1/(c-2),d=-u,o=1+u,h=[d,d,o,d,o,o,d,d,o,o,d,o],f=6,p=6,v=3,g=2,m=1,M=new Float32Array(v*p*f),x=new Float32Array(g*p*f),S=new Float32Array(m*p*f);for(let y=0;y<f;y++){let E=y%3*2/3-1,_=y>2?0:-1,b=[E,_,0,E+2/3,_,0,E+2/3,_+1,0,E,_,0,E+2/3,_+1,0,E,_+1,0];M.set(b,v*p*y),x.set(h,g*p*y);let R=[y,y,y,y,y,y];S.set(R,m*p*y)}let w=new Pt;w.setAttribute("position",new qt(M,v)),w.setAttribute("uv",new qt(x,g)),w.setAttribute("faceIndex",new qt(S,m)),n.push(new Tt(w,null)),i>si&&i--}return{lodMeshes:n,sizeLods:e,sigmas:t}}function kc(s,e,t){let n=new Yt(s,e,t);return n.texture.mapping=Ps,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Wi(s,e,t,n,i){s.viewport.set(e,t,n,i),s.scissor.set(e,t,n,i)}function Zd(s,e,t){return new Zt({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:Xd,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Ka(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:_n,depthTest:!1,depthWrite:!1})}function Jd(s,e,t){let n=new Float32Array(xi),i=new H(0,1,0);return new Zt({name:"SphericalGaussianBlur",defines:{n:xi,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:Ka(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:_n,depthTest:!1,depthWrite:!1})}function Gc(){return new Zt({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Ka(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:_n,depthTest:!1,depthWrite:!1})}function Hc(){return new Zt({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Ka(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:_n,depthTest:!1,depthWrite:!1})}function Ka(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}var Ja=class extends Yt{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},i=[n,n,n,n,n,n];this.texture=new gs(i),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},i=new $n(5,5,5),r=new Zt({name:"CubemapFromEquirect",uniforms:gi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:zt,blending:_n});r.uniforms.tEquirect.value=t;let a=new Tt(i,r),c=t.minFilter;return t.minFilter===ti&&(t.minFilter=Ct),new jr(1,10,this).update(e,a),t.minFilter=c,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,i=!0){let r=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,i);e.setRenderTarget(r)}};function $d(s){let e=new WeakMap,t=new WeakMap,n=null;function i(h,f=!1){return h==null?null:f?a(h):r(h)}function r(h){if(h&&h.isTexture){let f=h.mapping;if(f===sa||f===ra)if(e.has(h)){let p=e.get(h).texture;return c(p,h.mapping)}else{let p=h.image;if(p&&p.height>0){let v=new Ja(p.height);return v.fromEquirectangularTexture(s,h),e.set(h,v),h.addEventListener("dispose",u),c(v.texture,h.mapping)}else return null}}return h}function a(h){if(h&&h.isTexture){let f=h.mapping,p=f===sa||f===ra,v=f===ei||f===mi;if(p||v){let g=t.get(h),m=g!==void 0?g.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==m)return n===null&&(n=new Za(s)),g=p?n.fromEquirectangular(h,g):n.fromCubemap(h,g),g.texture.pmremVersion=h.pmremVersion,t.set(h,g),g.texture;if(g!==void 0)return g.texture;{let M=h.image;return p&&M&&M.height>0||v&&M&&l(M)?(n===null&&(n=new Za(s)),g=p?n.fromEquirectangular(h):n.fromCubemap(h),g.texture.pmremVersion=h.pmremVersion,t.set(h,g),h.addEventListener("dispose",d),g.texture):null}}}return h}function c(h,f){return f===sa?h.mapping=ei:f===ra&&(h.mapping=mi),h}function l(h){let f=0,p=6;for(let v=0;v<p;v++)h[v]!==void 0&&f++;return f===p}function u(h){let f=h.target;f.removeEventListener("dispose",u);let p=e.get(f);p!==void 0&&(e.delete(f),p.dispose())}function d(h){let f=h.target;f.removeEventListener("dispose",d);let p=t.get(f);p!==void 0&&(t.delete(f),p.dispose())}function o(){e=new WeakMap,t=new WeakMap,n!==null&&(n.dispose(),n=null)}return{get:i,dispose:o}}function Kd(s){let e={};function t(n){if(e[n]!==void 0)return e[n];let i=s.getExtension(n);return e[n]=i,i}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){let i=t(n);return i===null&&Rr("WebGLRenderer: "+n+" extension not supported."),i}}}function Qd(s,e,t,n){let i={},r=new WeakMap;function a(o){let h=o.target;h.index!==null&&e.remove(h.index);for(let p in h.attributes)e.remove(h.attributes[p]);h.removeEventListener("dispose",a),delete i[h.id];let f=r.get(h);f&&(e.remove(f),r.delete(h)),n.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,t.memory.geometries--}function c(o,h){return i[h.id]===!0||(h.addEventListener("dispose",a),i[h.id]=!0,t.memory.geometries++),h}function l(o){let h=o.attributes;for(let f in h)e.update(h[f],s.ARRAY_BUFFER)}function u(o){let h=[],f=o.index,p=o.attributes.position,v=0;if(p===void 0)return;if(f!==null){let M=f.array;v=f.version;for(let x=0,S=M.length;x<S;x+=3){let w=M[x+0],y=M[x+1],E=M[x+2];h.push(w,y,y,E,E,w)}}else{let M=p.array;v=p.version;for(let x=0,S=M.length/3-1;x<S;x+=3){let w=x+0,y=x+1,E=x+2;h.push(w,y,y,E,E,w)}}let g=new(p.count>=65535?fs:us)(h,1);g.version=v;let m=r.get(o);m&&e.remove(m),r.set(o,g)}function d(o){let h=r.get(o);if(h){let f=o.index;f!==null&&h.version<f.version&&u(o)}else u(o);return r.get(o)}return{get:c,update:l,getWireframeAttribute:d}}function jd(s,e,t){let n;function i(o){n=o}let r,a;function c(o){r=o.type,a=o.bytesPerElement}function l(o,h){s.drawElements(n,h,r,o*a),t.update(h,n,1)}function u(o,h,f){f!==0&&(s.drawElementsInstanced(n,h,r,o*a,f),t.update(h,n,f))}function d(o,h,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,h,0,r,o,0,f);let v=0;for(let g=0;g<f;g++)v+=h[g];t.update(v,n,1)}this.setMode=i,this.setIndex=c,this.render=l,this.renderInstances=u,this.renderMultiDraw=d}function ep(s){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,a,c){switch(t.calls++,a){case s.TRIANGLES:t.triangles+=c*(r/3);break;case s.LINES:t.lines+=c*(r/2);break;case s.LINE_STRIP:t.lines+=c*(r-1);break;case s.LINE_LOOP:t.lines+=c*r;break;case s.POINTS:t.points+=c*r;break;default:Be("WebGLInfo: Unknown draw mode:",a);break}}function i(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:i,update:n}}function tp(s,e,t){let n=new WeakMap,i=new xt;function r(a,c,l){let u=a.morphTargetInfluences,d=c.morphAttributes.position||c.morphAttributes.normal||c.morphAttributes.color,o=d!==void 0?d.length:0,h=n.get(c);if(h===void 0||h.count!==o){let b=function(){E.dispose(),n.delete(c),c.removeEventListener("dispose",b)};h!==void 0&&h.texture.dispose();let f=c.morphAttributes.position!==void 0,p=c.morphAttributes.normal!==void 0,v=c.morphAttributes.color!==void 0,g=c.morphAttributes.position||[],m=c.morphAttributes.normal||[],M=c.morphAttributes.color||[],x=0;f===!0&&(x=1),p===!0&&(x=2),v===!0&&(x=3);let S=c.attributes.position.count*x,w=1;S>e.maxTextureSize&&(w=Math.ceil(S/e.maxTextureSize),S=e.maxTextureSize);let y=new Float32Array(S*w*4*o),E=new os(y,S,w,o);E.type=fn,E.needsUpdate=!0;let _=x*4;for(let R=0;R<o;R++){let A=g[R],L=m[R],N=M[R],O=S*w*4*R;for(let D=0;D<A.count;D++){let F=D*_;f===!0&&(i.fromBufferAttribute(A,D),y[O+F+0]=i.x,y[O+F+1]=i.y,y[O+F+2]=i.z,y[O+F+3]=0),p===!0&&(i.fromBufferAttribute(L,D),y[O+F+4]=i.x,y[O+F+5]=i.y,y[O+F+6]=i.z,y[O+F+7]=0),v===!0&&(i.fromBufferAttribute(N,D),y[O+F+8]=i.x,y[O+F+9]=i.y,y[O+F+10]=i.z,y[O+F+11]=N.itemSize===4?i.w:1)}}h={count:o,texture:E,size:new Je(S,w)},n.set(c,h),c.addEventListener("dispose",b)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(s,"morphTexture",a.morphTexture,t);else{let f=0;for(let v=0;v<u.length;v++)f+=u[v];let p=c.morphTargetsRelative?1:1-f;l.getUniforms().setValue(s,"morphTargetBaseInfluence",p),l.getUniforms().setValue(s,"morphTargetInfluences",u)}l.getUniforms().setValue(s,"morphTargetsTexture",h.texture,t),l.getUniforms().setValue(s,"morphTargetsTextureSize",h.size)}return{update:r}}function np(s,e,t,n,i){let r=new WeakMap;function a(u){let d=i.render.frame,o=u.geometry,h=e.get(u,o);if(r.get(h)!==d&&(e.update(h),r.set(h,d)),u.isInstancedMesh&&(u.hasEventListener("dispose",l)===!1&&u.addEventListener("dispose",l),r.get(u)!==d&&(t.update(u.instanceMatrix,s.ARRAY_BUFFER),u.instanceColor!==null&&t.update(u.instanceColor,s.ARRAY_BUFFER),r.set(u,d))),u.isSkinnedMesh){let f=u.skeleton;r.get(f)!==d&&(f.update(),r.set(f,d))}return h}function c(){r=new WeakMap}function l(u){let d=u.target;d.removeEventListener("dispose",l),n.releaseStatesOfObject(d),t.remove(d.instanceMatrix),d.instanceColor!==null&&t.remove(d.instanceColor)}return{update:a,dispose:c}}var ip={[Ho]:"LINEAR_TONE_MAPPING",[Wo]:"REINHARD_TONE_MAPPING",[Xo]:"CINEON_TONE_MAPPING",[qo]:"ACES_FILMIC_TONE_MAPPING",[Zo]:"AGX_TONE_MAPPING",[Jo]:"NEUTRAL_TONE_MAPPING",[Yo]:"CUSTOM_TONE_MAPPING"};function sp(s,e,t,n,i){let r=new Yt(e,t,{type:s,depthBuffer:n,stencilBuffer:i,depthTexture:n?new Un(e,t):void 0}),a=new Yt(e,t,{type:yn,depthBuffer:!1,stencilBuffer:!1}),c=new Pt;c.setAttribute("position",new mt([-1,3,0,-1,-1,0,3,-1,0],3)),c.setAttribute("uv",new mt([0,2,0,0,2,0],2));let l=new zr({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),u=new Tt(c,l),d=new Vi(-1,1,1,-1,0,1),o=null,h=null,f=!1,p,v=null,g=[],m=!1;this.setSize=function(M,x){r.setSize(M,x),a.setSize(M,x);for(let S=0;S<g.length;S++){let w=g[S];w.setSize&&w.setSize(M,x)}},this.setEffects=function(M){g=M,m=g.length>0&&g[0].isRenderPass===!0;let x=r.width,S=r.height;for(let w=0;w<g.length;w++){let y=g[w];y.setSize&&y.setSize(x,S)}},this.begin=function(M,x){if(f||M.toneMapping===hn&&g.length===0)return!1;if(v=x,x!==null){let S=x.width,w=x.height;(r.width!==S||r.height!==w)&&this.setSize(S,w)}return m===!1&&M.setRenderTarget(r),p=M.toneMapping,M.toneMapping=hn,!0},this.hasRenderPass=function(){return m},this.end=function(M,x){M.toneMapping=p,f=!0;let S=r,w=a;for(let y=0;y<g.length;y++){let E=g[y];if(E.enabled!==!1&&(E.render(M,w,S,x),E.needsSwap!==!1)){let _=S;S=w,w=_}}if(o!==M.outputColorSpace||h!==M.toneMapping){o=M.outputColorSpace,h=M.toneMapping,l.defines={},et.getTransfer(o)===ht&&(l.defines.SRGB_TRANSFER="");let y=ip[h];y&&(l.defines[y]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=S.texture,M.setRenderTarget(v),M.render(u,d),v=null,f=!1},this.isCompositing=function(){return f},this.dispose=function(){r.depthTexture&&r.depthTexture.dispose(),r.dispose(),a.dispose(),c.dispose(),l.dispose()}}var ch=new Bt,Sl=new Un(1,1),hh=new os,uh=new Dr,fh=new gs,Wc=[],Xc=[],qc=new Float32Array(16),Yc=new Float32Array(9),Zc=new Float32Array(4);function qi(s,e,t){let n=s[0];if(n<=0||n>0)return s;let i=e*t,r=Wc[i];if(r===void 0&&(r=new Float32Array(i),Wc[i]=r),e!==0){n.toArray(r,0);for(let a=1,c=0;a!==e;++a)c+=t,s[a].toArray(r,c)}return r}function yt(s,e){if(s.length!==e.length)return!1;for(let t=0,n=s.length;t<n;t++)if(s[t]!==e[t])return!1;return!0}function St(s,e){for(let t=0,n=e.length;t<n;t++)s[t]=e[t]}function Qa(s,e){let t=Xc[e];t===void 0&&(t=new Int32Array(e),Xc[e]=t);for(let n=0;n!==e;++n)t[n]=s.allocateTextureUnit();return t}function rp(s,e){let t=this.cache;t[0]!==e&&(s.uniform1f(this.addr,e),t[0]=e)}function ap(s,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(s.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(yt(t,e))return;s.uniform2fv(this.addr,e),St(t,e)}}function op(s,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(s.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(s.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(yt(t,e))return;s.uniform3fv(this.addr,e),St(t,e)}}function lp(s,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(s.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(yt(t,e))return;s.uniform4fv(this.addr,e),St(t,e)}}function cp(s,e){let t=this.cache,n=e.elements;if(n===void 0){if(yt(t,e))return;s.uniformMatrix2fv(this.addr,!1,e),St(t,e)}else{if(yt(t,n))return;Zc.set(n),s.uniformMatrix2fv(this.addr,!1,Zc),St(t,n)}}function hp(s,e){let t=this.cache,n=e.elements;if(n===void 0){if(yt(t,e))return;s.uniformMatrix3fv(this.addr,!1,e),St(t,e)}else{if(yt(t,n))return;Yc.set(n),s.uniformMatrix3fv(this.addr,!1,Yc),St(t,n)}}function up(s,e){let t=this.cache,n=e.elements;if(n===void 0){if(yt(t,e))return;s.uniformMatrix4fv(this.addr,!1,e),St(t,e)}else{if(yt(t,n))return;qc.set(n),s.uniformMatrix4fv(this.addr,!1,qc),St(t,n)}}function fp(s,e){let t=this.cache;t[0]!==e&&(s.uniform1i(this.addr,e),t[0]=e)}function dp(s,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(s.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(yt(t,e))return;s.uniform2iv(this.addr,e),St(t,e)}}function pp(s,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(s.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(yt(t,e))return;s.uniform3iv(this.addr,e),St(t,e)}}function mp(s,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(s.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(yt(t,e))return;s.uniform4iv(this.addr,e),St(t,e)}}function gp(s,e){let t=this.cache;t[0]!==e&&(s.uniform1ui(this.addr,e),t[0]=e)}function xp(s,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(s.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(yt(t,e))return;s.uniform2uiv(this.addr,e),St(t,e)}}function vp(s,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(s.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(yt(t,e))return;s.uniform3uiv(this.addr,e),St(t,e)}}function _p(s,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(s.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(yt(t,e))return;s.uniform4uiv(this.addr,e),St(t,e)}}function yp(s,e,t){let n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i);let r;this.type===s.SAMPLER_2D_SHADOW?(Sl.compareFunction=t.isReversedDepthBuffer()?Xa:Wa,r=Sl):r=ch,t.setTexture2D(e||r,i)}function Sp(s,e,t){let n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),t.setTexture3D(e||uh,i)}function Mp(s,e,t){let n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),t.setTextureCube(e||fh,i)}function bp(s,e,t){let n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),t.setTexture2DArray(e||hh,i)}function wp(s){switch(s){case 5126:return rp;case 35664:return ap;case 35665:return op;case 35666:return lp;case 35674:return cp;case 35675:return hp;case 35676:return up;case 5124:case 35670:return fp;case 35667:case 35671:return dp;case 35668:case 35672:return pp;case 35669:case 35673:return mp;case 5125:return gp;case 36294:return xp;case 36295:return vp;case 36296:return _p;case 35678:case 36198:case 36298:case 36306:case 35682:return yp;case 35679:case 36299:case 36307:return Sp;case 35680:case 36300:case 36308:case 36293:return Mp;case 36289:case 36303:case 36311:case 36292:return bp}}function Tp(s,e){s.uniform1fv(this.addr,e)}function Ep(s,e){let t=qi(e,this.size,2);s.uniform2fv(this.addr,t)}function Ap(s,e){let t=qi(e,this.size,3);s.uniform3fv(this.addr,t)}function Cp(s,e){let t=qi(e,this.size,4);s.uniform4fv(this.addr,t)}function Rp(s,e){let t=qi(e,this.size,4);s.uniformMatrix2fv(this.addr,!1,t)}function Pp(s,e){let t=qi(e,this.size,9);s.uniformMatrix3fv(this.addr,!1,t)}function Ip(s,e){let t=qi(e,this.size,16);s.uniformMatrix4fv(this.addr,!1,t)}function Lp(s,e){s.uniform1iv(this.addr,e)}function Dp(s,e){s.uniform2iv(this.addr,e)}function Up(s,e){s.uniform3iv(this.addr,e)}function Np(s,e){s.uniform4iv(this.addr,e)}function Fp(s,e){s.uniform1uiv(this.addr,e)}function Op(s,e){s.uniform2uiv(this.addr,e)}function Bp(s,e){s.uniform3uiv(this.addr,e)}function zp(s,e){s.uniform4uiv(this.addr,e)}function Vp(s,e,t){let n=this.cache,i=e.length,r=Qa(t,i);yt(n,r)||(s.uniform1iv(this.addr,r),St(n,r));let a;this.type===s.SAMPLER_2D_SHADOW?a=Sl:a=ch;for(let c=0;c!==i;++c)t.setTexture2D(e[c]||a,r[c])}function kp(s,e,t){let n=this.cache,i=e.length,r=Qa(t,i);yt(n,r)||(s.uniform1iv(this.addr,r),St(n,r));for(let a=0;a!==i;++a)t.setTexture3D(e[a]||uh,r[a])}function Gp(s,e,t){let n=this.cache,i=e.length,r=Qa(t,i);yt(n,r)||(s.uniform1iv(this.addr,r),St(n,r));for(let a=0;a!==i;++a)t.setTextureCube(e[a]||fh,r[a])}function Hp(s,e,t){let n=this.cache,i=e.length,r=Qa(t,i);yt(n,r)||(s.uniform1iv(this.addr,r),St(n,r));for(let a=0;a!==i;++a)t.setTexture2DArray(e[a]||hh,r[a])}function Wp(s){switch(s){case 5126:return Tp;case 35664:return Ep;case 35665:return Ap;case 35666:return Cp;case 35674:return Rp;case 35675:return Pp;case 35676:return Ip;case 5124:case 35670:return Lp;case 35667:case 35671:return Dp;case 35668:case 35672:return Up;case 35669:case 35673:return Np;case 5125:return Fp;case 36294:return Op;case 36295:return Bp;case 36296:return zp;case 35678:case 36198:case 36298:case 36306:case 35682:return Vp;case 35679:case 36299:case 36307:return kp;case 35680:case 36300:case 36308:case 36293:return Gp;case 36289:case 36303:case 36311:case 36292:return Hp}}var Ml=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=wp(t.type)}},bl=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Wp(t.type)}},wl=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let i=this.seq;for(let r=0,a=i.length;r!==a;++r){let c=i[r];c.setValue(e,t[c.id],n)}}},_l=/(\w+)(\])?(\[|\.)?/g;function Jc(s,e){s.seq.push(e),s.map[e.id]=e}function Xp(s,e,t){let n=s.name,i=n.length;for(_l.lastIndex=0;;){let r=_l.exec(n),a=_l.lastIndex,c=r[1],l=r[2]==="]",u=r[3];if(l&&(c=c|0),u===void 0||u==="["&&a+2===i){Jc(t,u===void 0?new Ml(c,s,e):new bl(c,s,e));break}else{let o=t.map[c];o===void 0&&(o=new wl(c),Jc(t,o)),t=o}}}var Xi=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let a=0;a<n;++a){let c=e.getActiveUniform(t,a),l=e.getUniformLocation(t,c.name);Xp(c,l,this)}let i=[],r=[];for(let a of this.seq)a.type===e.SAMPLER_2D_SHADOW||a.type===e.SAMPLER_CUBE_SHADOW||a.type===e.SAMPLER_2D_ARRAY_SHADOW?i.push(a):r.push(a);i.length>0&&(this.seq=i.concat(r))}setValue(e,t,n,i){let r=this.map[t];r!==void 0&&r.setValue(e,n,i)}setOptional(e,t,n){let i=t[n];i!==void 0&&this.setValue(e,n,i)}static upload(e,t,n,i){for(let r=0,a=t.length;r!==a;++r){let c=t[r],l=n[c.id];l.needsUpdate!==!1&&c.setValue(e,l.value,i)}}static seqWithValue(e,t){let n=[];for(let i=0,r=e.length;i!==r;++i){let a=e[i];a.id in t&&n.push(a)}return n}};function $c(s,e,t){let n=s.createShader(e);return s.shaderSource(n,t),s.compileShader(n),n}var qp=37297,Yp=0;function Zp(s,e){let t=s.split(`
`),n=[],i=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let a=i;a<r;a++){let c=a+1;n.push(`${c===e?">":" "} ${c}: ${t[a]}`)}return n.join(`
`)}var Kc=new We;function Jp(s){et._getMatrix(Kc,et.workingColorSpace,s);let e=`mat3( ${Kc.elements.map(t=>t.toFixed(4))} )`;switch(et.getTransfer(s)){case rs:return[e,"LinearTransferOETF"];case ht:return[e,"sRGBTransferOETF"];default:return Fe("WebGLProgram: Unsupported color space: ",s),[e,"LinearTransferOETF"]}}function Qc(s,e,t){let n=s.getShaderParameter(e,s.COMPILE_STATUS),r=(s.getShaderInfoLog(e)||"").trim();if(n&&r==="")return"";let a=/ERROR: 0:(\d+)/.exec(r);if(a){let c=parseInt(a[1]);return t.toUpperCase()+`

`+r+`

`+Zp(s.getShaderSource(e),c)}else return r}function $p(s,e){let t=Jp(e);return[`vec4 ${s}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}var Kp={[Ho]:"Linear",[Wo]:"Reinhard",[Xo]:"Cineon",[qo]:"ACESFilmic",[Zo]:"AgX",[Jo]:"Neutral",[Yo]:"Custom"};function Qp(s,e){let t=Kp[e];return t===void 0?(Fe("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+s+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+s+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}var Ya=new H;function jp(){et.getLuminanceCoefficients(Ya);let s=Ya.x.toFixed(4),e=Ya.y.toFixed(4),t=Ya.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${s}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function em(s){return[s.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",s.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(ks).join(`
`)}function tm(s){let e=[];for(let t in s){let n=s[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function nm(s,e){let t={},n=s.getProgramParameter(e,s.ACTIVE_ATTRIBUTES);for(let i=0;i<n;i++){let r=s.getActiveAttrib(e,i),a=r.name,c=1;r.type===s.FLOAT_MAT2&&(c=2),r.type===s.FLOAT_MAT3&&(c=3),r.type===s.FLOAT_MAT4&&(c=4),t[a]={type:r.type,location:s.getAttribLocation(e,a),locationSize:c}}return t}function ks(s){return s!==""}function jc(s,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return s.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function eh(s,e){return s.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var im=/^[ \t]*#include +<([\w\d./]+)>/gm;function Tl(s){return s.replace(im,rm)}var sm=new Map;function rm(s,e){let t=$e[e];if(t===void 0){let n=sm.get(e);if(n!==void 0)t=$e[n],Fe('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return Tl(t)}var am=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function th(s){return s.replace(am,om)}function om(s,e,t,n){let i="";for(let r=parseInt(e);r<parseInt(t);r++)i+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return i}function nh(s){let e=`precision ${s.precision} float;
	precision ${s.precision} int;
	precision ${s.precision} sampler2D;
	precision ${s.precision} samplerCube;
	precision ${s.precision} sampler3D;
	precision ${s.precision} sampler2DArray;
	precision ${s.precision} sampler2DShadow;
	precision ${s.precision} samplerCubeShadow;
	precision ${s.precision} sampler2DArrayShadow;
	precision ${s.precision} isampler2D;
	precision ${s.precision} isampler3D;
	precision ${s.precision} isamplerCube;
	precision ${s.precision} isampler2DArray;
	precision ${s.precision} usampler2D;
	precision ${s.precision} usampler3D;
	precision ${s.precision} usamplerCube;
	precision ${s.precision} usampler2DArray;
	`;return s.precision==="highp"?e+=`
#define HIGH_PRECISION`:s.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:s.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}var lm={[Rs]:"SHADOWMAP_TYPE_PCF",[ki]:"SHADOWMAP_TYPE_VSM"};function cm(s){return lm[s.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var hm={[ei]:"ENVMAP_TYPE_CUBE",[mi]:"ENVMAP_TYPE_CUBE",[Ps]:"ENVMAP_TYPE_CUBE_UV"};function um(s){return s.envMap===!1?"ENVMAP_TYPE_CUBE":hm[s.envMapMode]||"ENVMAP_TYPE_CUBE"}var fm={[mi]:"ENVMAP_MODE_REFRACTION"};function dm(s){return s.envMap===!1?"ENVMAP_MODE_REFLECTION":fm[s.envMapMode]||"ENVMAP_MODE_REFLECTION"}var pm={[Go]:"ENVMAP_BLENDING_MULTIPLY",[Sc]:"ENVMAP_BLENDING_MIX",[Mc]:"ENVMAP_BLENDING_ADD"};function mm(s){return s.envMap===!1?"ENVMAP_BLENDING_NONE":pm[s.combine]||"ENVMAP_BLENDING_NONE"}function gm(s){let e=s.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:n,maxMip:t}}function xm(s,e,t,n){let i=s.getContext(),r=t.defines,a=t.vertexShader,c=t.fragmentShader,l=cm(t),u=um(t),d=dm(t),o=mm(t),h=gm(t),f=em(t),p=tm(r),v=i.createProgram(),g,m,M=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(g=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,p].filter(ks).join(`
`),g.length>0&&(g+=`
`),m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,p].filter(ks).join(`
`),m.length>0&&(m+=`
`)):(g=[nh(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,p,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+d:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexNormals?"#define HAS_NORMAL":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(ks).join(`
`),m=[nh(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,p,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+u:"",t.envMap?"#define "+d:"",t.envMap?"#define "+o:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas||t.batchingColor?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==hn?"#define TONE_MAPPING":"",t.toneMapping!==hn?$e.tonemapping_pars_fragment:"",t.toneMapping!==hn?Qp("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",$e.colorspace_pars_fragment,$p("linearToOutputTexel",t.outputColorSpace),jp(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(ks).join(`
`)),a=Tl(a),a=jc(a,t),a=eh(a,t),c=Tl(c),c=jc(c,t),c=eh(c,t),a=th(a),c=th(c),t.isRawShaderMaterial!==!0&&(M=`#version 300 es
`,g=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+g,m=["#define varying in",t.glslVersion===sl?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===sl?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+m);let x=M+g+a,S=M+m+c,w=$c(i,i.VERTEX_SHADER,x),y=$c(i,i.FRAGMENT_SHADER,S);i.attachShader(v,w),i.attachShader(v,y),t.index0AttributeName!==void 0?i.bindAttribLocation(v,0,t.index0AttributeName):t.morphTargets===!0&&i.bindAttribLocation(v,0,"position"),i.linkProgram(v);function E(A){if(s.debug.checkShaderErrors){let L=i.getProgramInfoLog(v)||"",N=i.getShaderInfoLog(w)||"",O=i.getShaderInfoLog(y)||"",D=L.trim(),F=N.trim(),k=O.trim(),Q=!0,ie=!0;if(i.getProgramParameter(v,i.LINK_STATUS)===!1)if(Q=!1,typeof s.debug.onShaderError=="function")s.debug.onShaderError(i,v,w,y);else{let oe=Qc(i,w,"vertex"),xe=Qc(i,y,"fragment");Be("THREE.WebGLProgram: Shader Error "+i.getError()+" - VALIDATE_STATUS "+i.getProgramParameter(v,i.VALIDATE_STATUS)+`

Material Name: `+A.name+`
Material Type: `+A.type+`

Program Info Log: `+D+`
`+oe+`
`+xe)}else D!==""?Fe("WebGLProgram: Program Info Log:",D):(F===""||k==="")&&(ie=!1);ie&&(A.diagnostics={runnable:Q,programLog:D,vertexShader:{log:F,prefix:g},fragmentShader:{log:k,prefix:m}})}i.deleteShader(w),i.deleteShader(y),_=new Xi(i,v),b=nm(i,v)}let _;this.getUniforms=function(){return _===void 0&&E(this),_};let b;this.getAttributes=function(){return b===void 0&&E(this),b};let R=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return R===!1&&(R=i.getProgramParameter(v,qp)),R},this.destroy=function(){n.releaseStatesOfProgram(this),i.deleteProgram(v),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=Yp++,this.cacheKey=e,this.usedTimes=1,this.program=v,this.vertexShader=w,this.fragmentShader=y,this}var vm=0,El=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,n=e.fragmentShader,i=this._getShaderStage(t),r=this._getShaderStage(n),a=this._getShaderCacheForMaterial(e);return a.has(i)===!1&&(a.add(i),i.usedTimes++),a.has(r)===!1&&(a.add(r),r.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new Al(e),t.set(e,n)),n}},Al=class{constructor(e){this.id=vm++,this.code=e,this.usedTimes=0}};function _m(s){return s===ii||s===Fs||s===Os}function ym(s,e,t,n,i,r){let a=new ls,c=new El,l=new Set,u=[],d=new Map,o=n.logarithmicDepthBuffer,h=n.precision,f={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function p(_){return l.add(_),_===0?"uv":`uv${_}`}function v(_,b,R,A,L,N){let O=A.fog,D=L.geometry,F=_.isMeshStandardMaterial||_.isMeshLambertMaterial||_.isMeshPhongMaterial?A.environment:null,k=_.isMeshStandardMaterial||_.isMeshLambertMaterial&&!_.envMap||_.isMeshPhongMaterial&&!_.envMap,Q=e.get(_.envMap||F,k),ie=Q&&Q.mapping===Ps?Q.image.height:null,oe=f[_.type];_.precision!==null&&(h=n.getMaxPrecision(_.precision),h!==_.precision&&Fe("WebGLProgram.getParameters:",_.precision,"not supported, using",h,"instead."));let xe=D.morphAttributes.position||D.morphAttributes.normal||D.morphAttributes.color,Ee=xe!==void 0?xe.length:0,ze=0;D.morphAttributes.position!==void 0&&(ze=1),D.morphAttributes.normal!==void 0&&(ze=2),D.morphAttributes.color!==void 0&&(ze=3);let Ce,De,J,ge;if(oe){let Ge=Mn[oe];Ce=Ge.vertexShader,De=Ge.fragmentShader}else Ce=_.vertexShader,De=_.fragmentShader,c.update(_),J=c.getVertexShaderID(_),ge=c.getFragmentShaderID(_);let ae=s.getRenderTarget(),Pe=s.state.buffers.depth.getReversed(),Le=L.isInstancedMesh===!0,Ne=L.isBatchedMesh===!0,at=!!_.map,Ze=!!_.matcap,nt=!!Q,st=!!_.aoMap,ke=!!_.lightMap,Ye=!!_.bumpMap,lt=!!_.normalMap,ft=!!_.displacementMap,z=!!_.emissiveMap,ut=!!_.metalnessMap,Xe=!!_.roughnessMap,qe=_.anisotropy>0,de=_.clearcoat>0,rt=_.dispersion>0,P=_.iridescence>0,T=_.sheen>0,G=_.transmission>0,j=qe&&!!_.anisotropyMap,se=de&&!!_.clearcoatMap,he=de&&!!_.clearcoatNormalMap,pe=de&&!!_.clearcoatRoughnessMap,K=P&&!!_.iridescenceMap,ee=P&&!!_.iridescenceThicknessMap,ve=T&&!!_.sheenColorMap,we=T&&!!_.sheenRoughnessMap,me=!!_.specularMap,ue=!!_.specularColorMap,Ve=!!_.specularIntensityMap,Ue=G&&!!_.transmissionMap,He=G&&!!_.thicknessMap,U=!!_.gradientMap,le=!!_.alphaMap,$=_.alphaTest>0,_e=!!_.alphaHash,fe=!!_.extensions,ne=hn;_.toneMapped&&(ae===null||ae.isXRRenderTarget===!0)&&(ne=s.toneMapping);let Ae={shaderID:oe,shaderType:_.type,shaderName:_.name,vertexShader:Ce,fragmentShader:De,defines:_.defines,customVertexShaderID:J,customFragmentShaderID:ge,isRawShaderMaterial:_.isRawShaderMaterial===!0,glslVersion:_.glslVersion,precision:h,batching:Ne,batchingColor:Ne&&L._colorsTexture!==null,instancing:Le,instancingColor:Le&&L.instanceColor!==null,instancingMorph:Le&&L.morphTexture!==null,outputColorSpace:ae===null?s.outputColorSpace:ae.isXRRenderTarget===!0?ae.texture.colorSpace:et.workingColorSpace,alphaToCoverage:!!_.alphaToCoverage,map:at,matcap:Ze,envMap:nt,envMapMode:nt&&Q.mapping,envMapCubeUVHeight:ie,aoMap:st,lightMap:ke,bumpMap:Ye,normalMap:lt,displacementMap:ft,emissiveMap:z,normalMapObjectSpace:lt&&_.normalMapType===Tc,normalMapTangentSpace:lt&&_.normalMapType===Ha,packedNormalMap:lt&&_.normalMapType===Ha&&_m(_.normalMap.format),metalnessMap:ut,roughnessMap:Xe,anisotropy:qe,anisotropyMap:j,clearcoat:de,clearcoatMap:se,clearcoatNormalMap:he,clearcoatRoughnessMap:pe,dispersion:rt,iridescence:P,iridescenceMap:K,iridescenceThicknessMap:ee,sheen:T,sheenColorMap:ve,sheenRoughnessMap:we,specularMap:me,specularColorMap:ue,specularIntensityMap:Ve,transmission:G,transmissionMap:Ue,thicknessMap:He,gradientMap:U,opaque:_.transparent===!1&&_.blending===ui&&_.alphaToCoverage===!1,alphaMap:le,alphaTest:$,alphaHash:_e,combine:_.combine,mapUv:at&&p(_.map.channel),aoMapUv:st&&p(_.aoMap.channel),lightMapUv:ke&&p(_.lightMap.channel),bumpMapUv:Ye&&p(_.bumpMap.channel),normalMapUv:lt&&p(_.normalMap.channel),displacementMapUv:ft&&p(_.displacementMap.channel),emissiveMapUv:z&&p(_.emissiveMap.channel),metalnessMapUv:ut&&p(_.metalnessMap.channel),roughnessMapUv:Xe&&p(_.roughnessMap.channel),anisotropyMapUv:j&&p(_.anisotropyMap.channel),clearcoatMapUv:se&&p(_.clearcoatMap.channel),clearcoatNormalMapUv:he&&p(_.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:pe&&p(_.clearcoatRoughnessMap.channel),iridescenceMapUv:K&&p(_.iridescenceMap.channel),iridescenceThicknessMapUv:ee&&p(_.iridescenceThicknessMap.channel),sheenColorMapUv:ve&&p(_.sheenColorMap.channel),sheenRoughnessMapUv:we&&p(_.sheenRoughnessMap.channel),specularMapUv:me&&p(_.specularMap.channel),specularColorMapUv:ue&&p(_.specularColorMap.channel),specularIntensityMapUv:Ve&&p(_.specularIntensityMap.channel),transmissionMapUv:Ue&&p(_.transmissionMap.channel),thicknessMapUv:He&&p(_.thicknessMap.channel),alphaMapUv:le&&p(_.alphaMap.channel),vertexTangents:!!D.attributes.tangent&&(lt||qe),vertexNormals:!!D.attributes.normal,vertexColors:_.vertexColors,vertexAlphas:_.vertexColors===!0&&!!D.attributes.color&&D.attributes.color.itemSize===4,pointsUvs:L.isPoints===!0&&!!D.attributes.uv&&(at||le),fog:!!O,useFog:_.fog===!0,fogExp2:!!O&&O.isFogExp2,flatShading:_.wireframe===!1&&(_.flatShading===!0||D.attributes.normal===void 0&&lt===!1&&(_.isMeshLambertMaterial||_.isMeshPhongMaterial||_.isMeshStandardMaterial||_.isMeshPhysicalMaterial)),sizeAttenuation:_.sizeAttenuation===!0,logarithmicDepthBuffer:o,reversedDepthBuffer:Pe,skinning:L.isSkinnedMesh===!0,morphTargets:D.morphAttributes.position!==void 0,morphNormals:D.morphAttributes.normal!==void 0,morphColors:D.morphAttributes.color!==void 0,morphTargetsCount:Ee,morphTextureStride:ze,numDirLights:b.directional.length,numPointLights:b.point.length,numSpotLights:b.spot.length,numSpotLightMaps:b.spotLightMap.length,numRectAreaLights:b.rectArea.length,numHemiLights:b.hemi.length,numDirLightShadows:b.directionalShadowMap.length,numPointLightShadows:b.pointShadowMap.length,numSpotLightShadows:b.spotShadowMap.length,numSpotLightShadowsWithMaps:b.numSpotLightShadowsWithMaps,numLightProbes:b.numLightProbes,numLightProbeGrids:N.length,numClippingPlanes:r.numPlanes,numClipIntersection:r.numIntersection,dithering:_.dithering,shadowMapEnabled:s.shadowMap.enabled&&R.length>0,shadowMapType:s.shadowMap.type,toneMapping:ne,decodeVideoTexture:at&&_.map.isVideoTexture===!0&&et.getTransfer(_.map.colorSpace)===ht,decodeVideoTextureEmissive:z&&_.emissiveMap.isVideoTexture===!0&&et.getTransfer(_.emissiveMap.colorSpace)===ht,premultipliedAlpha:_.premultipliedAlpha,doubleSided:_.side===nn,flipSided:_.side===zt,useDepthPacking:_.depthPacking>=0,depthPacking:_.depthPacking||0,index0AttributeName:_.index0AttributeName,extensionClipCullDistance:fe&&_.extensions.clipCullDistance===!0&&t.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(fe&&_.extensions.multiDraw===!0||Ne)&&t.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:t.has("KHR_parallel_shader_compile"),customProgramCacheKey:_.customProgramCacheKey()};return Ae.vertexUv1s=l.has(1),Ae.vertexUv2s=l.has(2),Ae.vertexUv3s=l.has(3),l.clear(),Ae}function g(_){let b=[];if(_.shaderID?b.push(_.shaderID):(b.push(_.customVertexShaderID),b.push(_.customFragmentShaderID)),_.defines!==void 0)for(let R in _.defines)b.push(R),b.push(_.defines[R]);return _.isRawShaderMaterial===!1&&(m(b,_),M(b,_),b.push(s.outputColorSpace)),b.push(_.customProgramCacheKey),b.join()}function m(_,b){_.push(b.precision),_.push(b.outputColorSpace),_.push(b.envMapMode),_.push(b.envMapCubeUVHeight),_.push(b.mapUv),_.push(b.alphaMapUv),_.push(b.lightMapUv),_.push(b.aoMapUv),_.push(b.bumpMapUv),_.push(b.normalMapUv),_.push(b.displacementMapUv),_.push(b.emissiveMapUv),_.push(b.metalnessMapUv),_.push(b.roughnessMapUv),_.push(b.anisotropyMapUv),_.push(b.clearcoatMapUv),_.push(b.clearcoatNormalMapUv),_.push(b.clearcoatRoughnessMapUv),_.push(b.iridescenceMapUv),_.push(b.iridescenceThicknessMapUv),_.push(b.sheenColorMapUv),_.push(b.sheenRoughnessMapUv),_.push(b.specularMapUv),_.push(b.specularColorMapUv),_.push(b.specularIntensityMapUv),_.push(b.transmissionMapUv),_.push(b.thicknessMapUv),_.push(b.combine),_.push(b.fogExp2),_.push(b.sizeAttenuation),_.push(b.morphTargetsCount),_.push(b.morphAttributeCount),_.push(b.numDirLights),_.push(b.numPointLights),_.push(b.numSpotLights),_.push(b.numSpotLightMaps),_.push(b.numHemiLights),_.push(b.numRectAreaLights),_.push(b.numDirLightShadows),_.push(b.numPointLightShadows),_.push(b.numSpotLightShadows),_.push(b.numSpotLightShadowsWithMaps),_.push(b.numLightProbes),_.push(b.shadowMapType),_.push(b.toneMapping),_.push(b.numClippingPlanes),_.push(b.numClipIntersection),_.push(b.depthPacking)}function M(_,b){a.disableAll(),b.instancing&&a.enable(0),b.instancingColor&&a.enable(1),b.instancingMorph&&a.enable(2),b.matcap&&a.enable(3),b.envMap&&a.enable(4),b.normalMapObjectSpace&&a.enable(5),b.normalMapTangentSpace&&a.enable(6),b.clearcoat&&a.enable(7),b.iridescence&&a.enable(8),b.alphaTest&&a.enable(9),b.vertexColors&&a.enable(10),b.vertexAlphas&&a.enable(11),b.vertexUv1s&&a.enable(12),b.vertexUv2s&&a.enable(13),b.vertexUv3s&&a.enable(14),b.vertexTangents&&a.enable(15),b.anisotropy&&a.enable(16),b.alphaHash&&a.enable(17),b.batching&&a.enable(18),b.dispersion&&a.enable(19),b.batchingColor&&a.enable(20),b.gradientMap&&a.enable(21),b.packedNormalMap&&a.enable(22),b.vertexNormals&&a.enable(23),_.push(a.mask),a.disableAll(),b.fog&&a.enable(0),b.useFog&&a.enable(1),b.flatShading&&a.enable(2),b.logarithmicDepthBuffer&&a.enable(3),b.reversedDepthBuffer&&a.enable(4),b.skinning&&a.enable(5),b.morphTargets&&a.enable(6),b.morphNormals&&a.enable(7),b.morphColors&&a.enable(8),b.premultipliedAlpha&&a.enable(9),b.shadowMapEnabled&&a.enable(10),b.doubleSided&&a.enable(11),b.flipSided&&a.enable(12),b.useDepthPacking&&a.enable(13),b.dithering&&a.enable(14),b.transmission&&a.enable(15),b.sheen&&a.enable(16),b.opaque&&a.enable(17),b.pointsUvs&&a.enable(18),b.decodeVideoTexture&&a.enable(19),b.decodeVideoTextureEmissive&&a.enable(20),b.alphaToCoverage&&a.enable(21),b.numLightProbeGrids>0&&a.enable(22),_.push(a.mask)}function x(_){let b=f[_.type],R;if(b){let A=Mn[b];R=Oc.clone(A.uniforms)}else R=_.uniforms;return R}function S(_,b){let R=d.get(b);return R!==void 0?++R.usedTimes:(R=new xm(s,b,_,i),u.push(R),d.set(b,R)),R}function w(_){if(--_.usedTimes===0){let b=u.indexOf(_);u[b]=u[u.length-1],u.pop(),d.delete(_.cacheKey),_.destroy()}}function y(_){c.remove(_)}function E(){c.dispose()}return{getParameters:v,getProgramCacheKey:g,getUniforms:x,acquireProgram:S,releaseProgram:w,releaseShaderCache:y,programs:u,dispose:E}}function Sm(){let s=new WeakMap;function e(a){return s.has(a)}function t(a){let c=s.get(a);return c===void 0&&(c={},s.set(a,c)),c}function n(a){s.delete(a)}function i(a,c,l){s.get(a)[c]=l}function r(){s=new WeakMap}return{has:e,get:t,remove:n,update:i,dispose:r}}function Mm(s,e){return s.groupOrder!==e.groupOrder?s.groupOrder-e.groupOrder:s.renderOrder!==e.renderOrder?s.renderOrder-e.renderOrder:s.material.id!==e.material.id?s.material.id-e.material.id:s.materialVariant!==e.materialVariant?s.materialVariant-e.materialVariant:s.z!==e.z?s.z-e.z:s.id-e.id}function ih(s,e){return s.groupOrder!==e.groupOrder?s.groupOrder-e.groupOrder:s.renderOrder!==e.renderOrder?s.renderOrder-e.renderOrder:s.z!==e.z?e.z-s.z:s.id-e.id}function sh(){let s=[],e=0,t=[],n=[],i=[];function r(){e=0,t.length=0,n.length=0,i.length=0}function a(h){let f=0;return h.isInstancedMesh&&(f+=2),h.isSkinnedMesh&&(f+=1),f}function c(h,f,p,v,g,m){let M=s[e];return M===void 0?(M={id:h.id,object:h,geometry:f,material:p,materialVariant:a(h),groupOrder:v,renderOrder:h.renderOrder,z:g,group:m},s[e]=M):(M.id=h.id,M.object=h,M.geometry=f,M.material=p,M.materialVariant=a(h),M.groupOrder=v,M.renderOrder=h.renderOrder,M.z=g,M.group=m),e++,M}function l(h,f,p,v,g,m){let M=c(h,f,p,v,g,m);p.transmission>0?n.push(M):p.transparent===!0?i.push(M):t.push(M)}function u(h,f,p,v,g,m){let M=c(h,f,p,v,g,m);p.transmission>0?n.unshift(M):p.transparent===!0?i.unshift(M):t.unshift(M)}function d(h,f){t.length>1&&t.sort(h||Mm),n.length>1&&n.sort(f||ih),i.length>1&&i.sort(f||ih)}function o(){for(let h=e,f=s.length;h<f;h++){let p=s[h];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:t,transmissive:n,transparent:i,init:r,push:l,unshift:u,finish:o,sort:d}}function bm(){let s=new WeakMap;function e(n,i){let r=s.get(n),a;return r===void 0?(a=new sh,s.set(n,[a])):i>=r.length?(a=new sh,r.push(a)):a=r[i],a}function t(){s=new WeakMap}return{get:e,dispose:t}}function wm(){let s={};return{get:function(e){if(s[e.id]!==void 0)return s[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new H,color:new Ke};break;case"SpotLight":t={position:new H,direction:new H,color:new Ke,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new H,color:new Ke,distance:0,decay:0};break;case"HemisphereLight":t={direction:new H,skyColor:new Ke,groundColor:new Ke};break;case"RectAreaLight":t={color:new Ke,position:new H,halfWidth:new H,halfHeight:new H};break}return s[e.id]=t,t}}}function Tm(){let s={};return{get:function(e){if(s[e.id]!==void 0)return s[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Je};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Je};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Je,shadowCameraNear:1,shadowCameraFar:1e3};break}return s[e.id]=t,t}}}var Em=0;function Am(s,e){return(e.castShadow?2:0)-(s.castShadow?2:0)+(e.map?1:0)-(s.map?1:0)}function Cm(s){let e=new wm,t=Tm(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let u=0;u<9;u++)n.probe.push(new H);let i=new H,r=new gt,a=new gt;function c(u){let d=0,o=0,h=0;for(let b=0;b<9;b++)n.probe[b].set(0,0,0);let f=0,p=0,v=0,g=0,m=0,M=0,x=0,S=0,w=0,y=0,E=0;u.sort(Am);for(let b=0,R=u.length;b<R;b++){let A=u[b],L=A.color,N=A.intensity,O=A.distance,D=null;if(A.shadow&&A.shadow.map&&(A.shadow.map.texture.format===ii?D=A.shadow.map.texture:D=A.shadow.map.depthTexture||A.shadow.map.texture),A.isAmbientLight)d+=L.r*N,o+=L.g*N,h+=L.b*N;else if(A.isLightProbe){for(let F=0;F<9;F++)n.probe[F].addScaledVector(A.sh.coefficients[F],N);E++}else if(A.isDirectionalLight){let F=e.get(A);if(F.color.copy(A.color).multiplyScalar(A.intensity),A.castShadow){let k=A.shadow,Q=t.get(A);Q.shadowIntensity=k.intensity,Q.shadowBias=k.bias,Q.shadowNormalBias=k.normalBias,Q.shadowRadius=k.radius,Q.shadowMapSize=k.mapSize,n.directionalShadow[f]=Q,n.directionalShadowMap[f]=D,n.directionalShadowMatrix[f]=A.shadow.matrix,M++}n.directional[f]=F,f++}else if(A.isSpotLight){let F=e.get(A);F.position.setFromMatrixPosition(A.matrixWorld),F.color.copy(L).multiplyScalar(N),F.distance=O,F.coneCos=Math.cos(A.angle),F.penumbraCos=Math.cos(A.angle*(1-A.penumbra)),F.decay=A.decay,n.spot[v]=F;let k=A.shadow;if(A.map&&(n.spotLightMap[w]=A.map,w++,k.updateMatrices(A),A.castShadow&&y++),n.spotLightMatrix[v]=k.matrix,A.castShadow){let Q=t.get(A);Q.shadowIntensity=k.intensity,Q.shadowBias=k.bias,Q.shadowNormalBias=k.normalBias,Q.shadowRadius=k.radius,Q.shadowMapSize=k.mapSize,n.spotShadow[v]=Q,n.spotShadowMap[v]=D,S++}v++}else if(A.isRectAreaLight){let F=e.get(A);F.color.copy(L).multiplyScalar(N),F.halfWidth.set(A.width*.5,0,0),F.halfHeight.set(0,A.height*.5,0),n.rectArea[g]=F,g++}else if(A.isPointLight){let F=e.get(A);if(F.color.copy(A.color).multiplyScalar(A.intensity),F.distance=A.distance,F.decay=A.decay,A.castShadow){let k=A.shadow,Q=t.get(A);Q.shadowIntensity=k.intensity,Q.shadowBias=k.bias,Q.shadowNormalBias=k.normalBias,Q.shadowRadius=k.radius,Q.shadowMapSize=k.mapSize,Q.shadowCameraNear=k.camera.near,Q.shadowCameraFar=k.camera.far,n.pointShadow[p]=Q,n.pointShadowMap[p]=D,n.pointShadowMatrix[p]=A.shadow.matrix,x++}n.point[p]=F,p++}else if(A.isHemisphereLight){let F=e.get(A);F.skyColor.copy(A.color).multiplyScalar(N),F.groundColor.copy(A.groundColor).multiplyScalar(N),n.hemi[m]=F,m++}}g>0&&(s.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=be.LTC_FLOAT_1,n.rectAreaLTC2=be.LTC_FLOAT_2):(n.rectAreaLTC1=be.LTC_HALF_1,n.rectAreaLTC2=be.LTC_HALF_2)),n.ambient[0]=d,n.ambient[1]=o,n.ambient[2]=h;let _=n.hash;(_.directionalLength!==f||_.pointLength!==p||_.spotLength!==v||_.rectAreaLength!==g||_.hemiLength!==m||_.numDirectionalShadows!==M||_.numPointShadows!==x||_.numSpotShadows!==S||_.numSpotMaps!==w||_.numLightProbes!==E)&&(n.directional.length=f,n.spot.length=v,n.rectArea.length=g,n.point.length=p,n.hemi.length=m,n.directionalShadow.length=M,n.directionalShadowMap.length=M,n.pointShadow.length=x,n.pointShadowMap.length=x,n.spotShadow.length=S,n.spotShadowMap.length=S,n.directionalShadowMatrix.length=M,n.pointShadowMatrix.length=x,n.spotLightMatrix.length=S+w-y,n.spotLightMap.length=w,n.numSpotLightShadowsWithMaps=y,n.numLightProbes=E,_.directionalLength=f,_.pointLength=p,_.spotLength=v,_.rectAreaLength=g,_.hemiLength=m,_.numDirectionalShadows=M,_.numPointShadows=x,_.numSpotShadows=S,_.numSpotMaps=w,_.numLightProbes=E,n.version=Em++)}function l(u,d){let o=0,h=0,f=0,p=0,v=0,g=d.matrixWorldInverse;for(let m=0,M=u.length;m<M;m++){let x=u[m];if(x.isDirectionalLight){let S=n.directional[o];S.direction.setFromMatrixPosition(x.matrixWorld),i.setFromMatrixPosition(x.target.matrixWorld),S.direction.sub(i),S.direction.transformDirection(g),o++}else if(x.isSpotLight){let S=n.spot[f];S.position.setFromMatrixPosition(x.matrixWorld),S.position.applyMatrix4(g),S.direction.setFromMatrixPosition(x.matrixWorld),i.setFromMatrixPosition(x.target.matrixWorld),S.direction.sub(i),S.direction.transformDirection(g),f++}else if(x.isRectAreaLight){let S=n.rectArea[p];S.position.setFromMatrixPosition(x.matrixWorld),S.position.applyMatrix4(g),a.identity(),r.copy(x.matrixWorld),r.premultiply(g),a.extractRotation(r),S.halfWidth.set(x.width*.5,0,0),S.halfHeight.set(0,x.height*.5,0),S.halfWidth.applyMatrix4(a),S.halfHeight.applyMatrix4(a),p++}else if(x.isPointLight){let S=n.point[h];S.position.setFromMatrixPosition(x.matrixWorld),S.position.applyMatrix4(g),h++}else if(x.isHemisphereLight){let S=n.hemi[v];S.direction.setFromMatrixPosition(x.matrixWorld),S.direction.transformDirection(g),v++}}}return{setup:c,setupView:l,state:n}}function rh(s){let e=new Cm(s),t=[],n=[],i=[];function r(h){o.camera=h,t.length=0,n.length=0,i.length=0}function a(h){t.push(h)}function c(h){n.push(h)}function l(h){i.push(h)}function u(){e.setup(t)}function d(h){e.setupView(t,h)}let o={lightsArray:t,shadowsArray:n,lightProbeGridArray:i,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:r,state:o,setupLights:u,setupLightsView:d,pushLight:a,pushShadow:c,pushLightProbeGrid:l}}function Rm(s){let e=new WeakMap;function t(i,r=0){let a=e.get(i),c;return a===void 0?(c=new rh(s),e.set(i,[c])):r>=a.length?(c=new rh(s),a.push(c)):c=a[r],c}function n(){e=new WeakMap}return{get:t,dispose:n}}var Pm=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Im=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,Lm=[new H(1,0,0),new H(-1,0,0),new H(0,1,0),new H(0,-1,0),new H(0,0,1),new H(0,0,-1)],Dm=[new H(0,-1,0),new H(0,-1,0),new H(0,0,1),new H(0,0,-1),new H(0,-1,0),new H(0,-1,0)],ah=new gt,Vs=new H,yl=new H;function Um(s,e,t){let n=new Bi,i=new Je,r=new Je,a=new xt,c=new Vr,l=new kr,u={},d=t.maxTextureSize,o={[In]:zt,[zt]:In,[nn]:nn},h=new Zt({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Je},radius:{value:4}},vertexShader:Pm,fragmentShader:Im}),f=h.clone();f.defines.HORIZONTAL_PASS=1;let p=new Pt;p.setAttribute("position",new qt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let v=new Tt(p,h),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Rs;let m=this.type;this.render=function(y,E,_){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||y.length===0)return;this.type===ia&&(Fe("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=Rs);let b=s.getRenderTarget(),R=s.getActiveCubeFace(),A=s.getActiveMipmapLevel(),L=s.state;L.setBlending(_n),L.buffers.depth.getReversed()===!0?L.buffers.color.setClear(0,0,0,0):L.buffers.color.setClear(1,1,1,1),L.buffers.depth.setTest(!0),L.setScissorTest(!1);let N=m!==this.type;N&&E.traverse(function(O){O.material&&(Array.isArray(O.material)?O.material.forEach(D=>D.needsUpdate=!0):O.material.needsUpdate=!0)});for(let O=0,D=y.length;O<D;O++){let F=y[O],k=F.shadow;if(k===void 0){Fe("WebGLShadowMap:",F,"has no shadow.");continue}if(k.autoUpdate===!1&&k.needsUpdate===!1)continue;i.copy(k.mapSize);let Q=k.getFrameExtents();i.multiply(Q),r.copy(k.mapSize),(i.x>d||i.y>d)&&(i.x>d&&(r.x=Math.floor(d/Q.x),i.x=r.x*Q.x,k.mapSize.x=r.x),i.y>d&&(r.y=Math.floor(d/Q.y),i.y=r.y*Q.y,k.mapSize.y=r.y));let ie=s.state.buffers.depth.getReversed();if(k.camera._reversedDepth=ie,k.map===null||N===!0){if(k.map!==null&&(k.map.depthTexture!==null&&(k.map.depthTexture.dispose(),k.map.depthTexture=null),k.map.dispose()),this.type===ki){if(F.isPointLight){Fe("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}k.map=new Yt(i.x,i.y,{format:ii,type:yn,minFilter:Ct,magFilter:Ct,generateMipmaps:!1}),k.map.texture.name=F.name+".shadowMap",k.map.depthTexture=new Un(i.x,i.y,fn),k.map.depthTexture.name=F.name+".shadowMapDepth",k.map.depthTexture.format=xn,k.map.depthTexture.compareFunction=null,k.map.depthTexture.minFilter=wt,k.map.depthTexture.magFilter=wt}else F.isPointLight?(k.map=new Ja(i.x),k.map.depthTexture=new Or(i.x,un)):(k.map=new Yt(i.x,i.y),k.map.depthTexture=new Un(i.x,i.y,un)),k.map.depthTexture.name=F.name+".shadowMap",k.map.depthTexture.format=xn,this.type===Rs?(k.map.depthTexture.compareFunction=ie?Xa:Wa,k.map.depthTexture.minFilter=Ct,k.map.depthTexture.magFilter=Ct):(k.map.depthTexture.compareFunction=null,k.map.depthTexture.minFilter=wt,k.map.depthTexture.magFilter=wt);k.camera.updateProjectionMatrix()}let oe=k.map.isWebGLCubeRenderTarget?6:1;for(let xe=0;xe<oe;xe++){if(k.map.isWebGLCubeRenderTarget)s.setRenderTarget(k.map,xe),s.clear();else{xe===0&&(s.setRenderTarget(k.map),s.clear());let Ee=k.getViewport(xe);a.set(r.x*Ee.x,r.y*Ee.y,r.x*Ee.z,r.y*Ee.w),L.viewport(a)}if(F.isPointLight){let Ee=k.camera,ze=k.matrix,Ce=F.distance||Ee.far;Ce!==Ee.far&&(Ee.far=Ce,Ee.updateProjectionMatrix()),Vs.setFromMatrixPosition(F.matrixWorld),Ee.position.copy(Vs),yl.copy(Ee.position),yl.add(Lm[xe]),Ee.up.copy(Dm[xe]),Ee.lookAt(yl),Ee.updateMatrixWorld(),ze.makeTranslation(-Vs.x,-Vs.y,-Vs.z),ah.multiplyMatrices(Ee.projectionMatrix,Ee.matrixWorldInverse),k._frustum.setFromProjectionMatrix(ah,Ee.coordinateSystem,Ee.reversedDepth)}else k.updateMatrices(F);n=k.getFrustum(),S(E,_,k.camera,F,this.type)}k.isPointLightShadow!==!0&&this.type===ki&&M(k,_),k.needsUpdate=!1}m=this.type,g.needsUpdate=!1,s.setRenderTarget(b,R,A)};function M(y,E){let _=e.update(v);h.defines.VSM_SAMPLES!==y.blurSamples&&(h.defines.VSM_SAMPLES=y.blurSamples,f.defines.VSM_SAMPLES=y.blurSamples,h.needsUpdate=!0,f.needsUpdate=!0),y.mapPass===null&&(y.mapPass=new Yt(i.x,i.y,{format:ii,type:yn})),h.uniforms.shadow_pass.value=y.map.depthTexture,h.uniforms.resolution.value=y.mapSize,h.uniforms.radius.value=y.radius,s.setRenderTarget(y.mapPass),s.clear(),s.renderBufferDirect(E,null,_,h,v,null),f.uniforms.shadow_pass.value=y.mapPass.texture,f.uniforms.resolution.value=y.mapSize,f.uniforms.radius.value=y.radius,s.setRenderTarget(y.map),s.clear(),s.renderBufferDirect(E,null,_,f,v,null)}function x(y,E,_,b){let R=null,A=_.isPointLight===!0?y.customDistanceMaterial:y.customDepthMaterial;if(A!==void 0)R=A;else if(R=_.isPointLight===!0?l:c,s.localClippingEnabled&&E.clipShadows===!0&&Array.isArray(E.clippingPlanes)&&E.clippingPlanes.length!==0||E.displacementMap&&E.displacementScale!==0||E.alphaMap&&E.alphaTest>0||E.map&&E.alphaTest>0||E.alphaToCoverage===!0){let L=R.uuid,N=E.uuid,O=u[L];O===void 0&&(O={},u[L]=O);let D=O[N];D===void 0&&(D=R.clone(),O[N]=D,E.addEventListener("dispose",w)),R=D}if(R.visible=E.visible,R.wireframe=E.wireframe,b===ki?R.side=E.shadowSide!==null?E.shadowSide:E.side:R.side=E.shadowSide!==null?E.shadowSide:o[E.side],R.alphaMap=E.alphaMap,R.alphaTest=E.alphaToCoverage===!0?.5:E.alphaTest,R.map=E.map,R.clipShadows=E.clipShadows,R.clippingPlanes=E.clippingPlanes,R.clipIntersection=E.clipIntersection,R.displacementMap=E.displacementMap,R.displacementScale=E.displacementScale,R.displacementBias=E.displacementBias,R.wireframeLinewidth=E.wireframeLinewidth,R.linewidth=E.linewidth,_.isPointLight===!0&&R.isMeshDistanceMaterial===!0){let L=s.properties.get(R);L.light=_}return R}function S(y,E,_,b,R){if(y.visible===!1)return;if(y.layers.test(E.layers)&&(y.isMesh||y.isLine||y.isPoints)&&(y.castShadow||y.receiveShadow&&R===ki)&&(!y.frustumCulled||n.intersectsObject(y))){y.modelViewMatrix.multiplyMatrices(_.matrixWorldInverse,y.matrixWorld);let N=e.update(y),O=y.material;if(Array.isArray(O)){let D=N.groups;for(let F=0,k=D.length;F<k;F++){let Q=D[F],ie=O[Q.materialIndex];if(ie&&ie.visible){let oe=x(y,ie,b,R);y.onBeforeShadow(s,y,E,_,N,oe,Q),s.renderBufferDirect(_,null,N,oe,y,Q),y.onAfterShadow(s,y,E,_,N,oe,Q)}}}else if(O.visible){let D=x(y,O,b,R);y.onBeforeShadow(s,y,E,_,N,D,null),s.renderBufferDirect(_,null,N,D,y,null),y.onAfterShadow(s,y,E,_,N,D,null)}}let L=y.children;for(let N=0,O=L.length;N<O;N++)S(L[N],E,_,b,R)}function w(y){y.target.removeEventListener("dispose",w);for(let _ in u){let b=u[_],R=y.target.uuid;R in b&&(b[R].dispose(),delete b[R])}}}function Nm(s,e){function t(){let U=!1,le=new xt,$=null,_e=new xt(0,0,0,0);return{setMask:function(fe){$!==fe&&!U&&(s.colorMask(fe,fe,fe,fe),$=fe)},setLocked:function(fe){U=fe},setClear:function(fe,ne,Ae,Ge,ot){ot===!0&&(fe*=Ge,ne*=Ge,Ae*=Ge),le.set(fe,ne,Ae,Ge),_e.equals(le)===!1&&(s.clearColor(fe,ne,Ae,Ge),_e.copy(le))},reset:function(){U=!1,$=null,_e.set(-1,0,0,0)}}}function n(){let U=!1,le=!1,$=null,_e=null,fe=null;return{setReversed:function(ne){if(le!==ne){let Ae=e.get("EXT_clip_control");ne?Ae.clipControlEXT(Ae.LOWER_LEFT_EXT,Ae.ZERO_TO_ONE_EXT):Ae.clipControlEXT(Ae.LOWER_LEFT_EXT,Ae.NEGATIVE_ONE_TO_ONE_EXT),le=ne;let Ge=fe;fe=null,this.setClear(Ge)}},getReversed:function(){return le},setTest:function(ne){ne?ae(s.DEPTH_TEST):Pe(s.DEPTH_TEST)},setMask:function(ne){$!==ne&&!U&&(s.depthMask(ne),$=ne)},setFunc:function(ne){if(le&&(ne=Nc[ne]),_e!==ne){switch(ne){case yr:s.depthFunc(s.NEVER);break;case Sr:s.depthFunc(s.ALWAYS);break;case Mr:s.depthFunc(s.LESS);break;case fi:s.depthFunc(s.LEQUAL);break;case br:s.depthFunc(s.EQUAL);break;case wr:s.depthFunc(s.GEQUAL);break;case Tr:s.depthFunc(s.GREATER);break;case Er:s.depthFunc(s.NOTEQUAL);break;default:s.depthFunc(s.LEQUAL)}_e=ne}},setLocked:function(ne){U=ne},setClear:function(ne){fe!==ne&&(fe=ne,le&&(ne=1-ne),s.clearDepth(ne))},reset:function(){U=!1,$=null,_e=null,fe=null,le=!1}}}function i(){let U=!1,le=null,$=null,_e=null,fe=null,ne=null,Ae=null,Ge=null,ot=null;return{setTest:function(it){U||(it?ae(s.STENCIL_TEST):Pe(s.STENCIL_TEST))},setMask:function(it){le!==it&&!U&&(s.stencilMask(it),le=it)},setFunc:function(it,Et,Ot){($!==it||_e!==Et||fe!==Ot)&&(s.stencilFunc(it,Et,Ot),$=it,_e=Et,fe=Ot)},setOp:function(it,Et,Ot){(ne!==it||Ae!==Et||Ge!==Ot)&&(s.stencilOp(it,Et,Ot),ne=it,Ae=Et,Ge=Ot)},setLocked:function(it){U=it},setClear:function(it){ot!==it&&(s.clearStencil(it),ot=it)},reset:function(){U=!1,le=null,$=null,_e=null,fe=null,ne=null,Ae=null,Ge=null,ot=null}}}let r=new t,a=new n,c=new i,l=new WeakMap,u=new WeakMap,d={},o={},h={},f=new WeakMap,p=[],v=null,g=!1,m=null,M=null,x=null,S=null,w=null,y=null,E=null,_=new Ke(0,0,0),b=0,R=!1,A=null,L=null,N=null,O=null,D=null,F=s.getParameter(s.MAX_COMBINED_TEXTURE_IMAGE_UNITS),k=!1,Q=0,ie=s.getParameter(s.VERSION);ie.indexOf("WebGL")!==-1?(Q=parseFloat(/^WebGL (\d)/.exec(ie)[1]),k=Q>=1):ie.indexOf("OpenGL ES")!==-1&&(Q=parseFloat(/^OpenGL ES (\d)/.exec(ie)[1]),k=Q>=2);let oe=null,xe={},Ee=s.getParameter(s.SCISSOR_BOX),ze=s.getParameter(s.VIEWPORT),Ce=new xt().fromArray(Ee),De=new xt().fromArray(ze);function J(U,le,$,_e){let fe=new Uint8Array(4),ne=s.createTexture();s.bindTexture(U,ne),s.texParameteri(U,s.TEXTURE_MIN_FILTER,s.NEAREST),s.texParameteri(U,s.TEXTURE_MAG_FILTER,s.NEAREST);for(let Ae=0;Ae<$;Ae++)U===s.TEXTURE_3D||U===s.TEXTURE_2D_ARRAY?s.texImage3D(le,0,s.RGBA,1,1,_e,0,s.RGBA,s.UNSIGNED_BYTE,fe):s.texImage2D(le+Ae,0,s.RGBA,1,1,0,s.RGBA,s.UNSIGNED_BYTE,fe);return ne}let ge={};ge[s.TEXTURE_2D]=J(s.TEXTURE_2D,s.TEXTURE_2D,1),ge[s.TEXTURE_CUBE_MAP]=J(s.TEXTURE_CUBE_MAP,s.TEXTURE_CUBE_MAP_POSITIVE_X,6),ge[s.TEXTURE_2D_ARRAY]=J(s.TEXTURE_2D_ARRAY,s.TEXTURE_2D_ARRAY,1,1),ge[s.TEXTURE_3D]=J(s.TEXTURE_3D,s.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),c.setClear(0),ae(s.DEPTH_TEST),a.setFunc(fi),Ye(!1),lt(Bo),ae(s.CULL_FACE),st(_n);function ae(U){d[U]!==!0&&(s.enable(U),d[U]=!0)}function Pe(U){d[U]!==!1&&(s.disable(U),d[U]=!1)}function Le(U,le){return h[U]!==le?(s.bindFramebuffer(U,le),h[U]=le,U===s.DRAW_FRAMEBUFFER&&(h[s.FRAMEBUFFER]=le),U===s.FRAMEBUFFER&&(h[s.DRAW_FRAMEBUFFER]=le),!0):!1}function Ne(U,le){let $=p,_e=!1;if(U){$=f.get(le),$===void 0&&($=[],f.set(le,$));let fe=U.textures;if($.length!==fe.length||$[0]!==s.COLOR_ATTACHMENT0){for(let ne=0,Ae=fe.length;ne<Ae;ne++)$[ne]=s.COLOR_ATTACHMENT0+ne;$.length=fe.length,_e=!0}}else $[0]!==s.BACK&&($[0]=s.BACK,_e=!0);_e&&s.drawBuffers($)}function at(U){return v!==U?(s.useProgram(U),v=U,!0):!1}let Ze={[Yn]:s.FUNC_ADD,[sc]:s.FUNC_SUBTRACT,[rc]:s.FUNC_REVERSE_SUBTRACT};Ze[ac]=s.MIN,Ze[oc]=s.MAX;let nt={[lc]:s.ZERO,[cc]:s.ONE,[hc]:s.SRC_COLOR,[vr]:s.SRC_ALPHA,[gc]:s.SRC_ALPHA_SATURATE,[pc]:s.DST_COLOR,[fc]:s.DST_ALPHA,[uc]:s.ONE_MINUS_SRC_COLOR,[_r]:s.ONE_MINUS_SRC_ALPHA,[mc]:s.ONE_MINUS_DST_COLOR,[dc]:s.ONE_MINUS_DST_ALPHA,[xc]:s.CONSTANT_COLOR,[vc]:s.ONE_MINUS_CONSTANT_COLOR,[_c]:s.CONSTANT_ALPHA,[yc]:s.ONE_MINUS_CONSTANT_ALPHA};function st(U,le,$,_e,fe,ne,Ae,Ge,ot,it){if(U===_n){g===!0&&(Pe(s.BLEND),g=!1);return}if(g===!1&&(ae(s.BLEND),g=!0),U!==ic){if(U!==m||it!==R){if((M!==Yn||w!==Yn)&&(s.blendEquation(s.FUNC_ADD),M=Yn,w=Yn),it)switch(U){case ui:s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case zo:s.blendFunc(s.ONE,s.ONE);break;case Vo:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case ko:s.blendFuncSeparate(s.DST_COLOR,s.ONE_MINUS_SRC_ALPHA,s.ZERO,s.ONE);break;default:Be("WebGLState: Invalid blending: ",U);break}else switch(U){case ui:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case zo:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE,s.ONE,s.ONE);break;case Vo:Be("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case ko:Be("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Be("WebGLState: Invalid blending: ",U);break}x=null,S=null,y=null,E=null,_.set(0,0,0),b=0,m=U,R=it}return}fe=fe||le,ne=ne||$,Ae=Ae||_e,(le!==M||fe!==w)&&(s.blendEquationSeparate(Ze[le],Ze[fe]),M=le,w=fe),($!==x||_e!==S||ne!==y||Ae!==E)&&(s.blendFuncSeparate(nt[$],nt[_e],nt[ne],nt[Ae]),x=$,S=_e,y=ne,E=Ae),(Ge.equals(_)===!1||ot!==b)&&(s.blendColor(Ge.r,Ge.g,Ge.b,ot),_.copy(Ge),b=ot),m=U,R=!1}function ke(U,le){U.side===nn?Pe(s.CULL_FACE):ae(s.CULL_FACE);let $=U.side===zt;le&&($=!$),Ye($),U.blending===ui&&U.transparent===!1?st(_n):st(U.blending,U.blendEquation,U.blendSrc,U.blendDst,U.blendEquationAlpha,U.blendSrcAlpha,U.blendDstAlpha,U.blendColor,U.blendAlpha,U.premultipliedAlpha),a.setFunc(U.depthFunc),a.setTest(U.depthTest),a.setMask(U.depthWrite),r.setMask(U.colorWrite);let _e=U.stencilWrite;c.setTest(_e),_e&&(c.setMask(U.stencilWriteMask),c.setFunc(U.stencilFunc,U.stencilRef,U.stencilFuncMask),c.setOp(U.stencilFail,U.stencilZFail,U.stencilZPass)),z(U.polygonOffset,U.polygonOffsetFactor,U.polygonOffsetUnits),U.alphaToCoverage===!0?ae(s.SAMPLE_ALPHA_TO_COVERAGE):Pe(s.SAMPLE_ALPHA_TO_COVERAGE)}function Ye(U){A!==U&&(U?s.frontFace(s.CW):s.frontFace(s.CCW),A=U)}function lt(U){U!==tc?(ae(s.CULL_FACE),U!==L&&(U===Bo?s.cullFace(s.BACK):U===nc?s.cullFace(s.FRONT):s.cullFace(s.FRONT_AND_BACK))):Pe(s.CULL_FACE),L=U}function ft(U){U!==N&&(k&&s.lineWidth(U),N=U)}function z(U,le,$){U?(ae(s.POLYGON_OFFSET_FILL),(O!==le||D!==$)&&(O=le,D=$,a.getReversed()&&(le=-le),s.polygonOffset(le,$))):Pe(s.POLYGON_OFFSET_FILL)}function ut(U){U?ae(s.SCISSOR_TEST):Pe(s.SCISSOR_TEST)}function Xe(U){U===void 0&&(U=s.TEXTURE0+F-1),oe!==U&&(s.activeTexture(U),oe=U)}function qe(U,le,$){$===void 0&&(oe===null?$=s.TEXTURE0+F-1:$=oe);let _e=xe[$];_e===void 0&&(_e={type:void 0,texture:void 0},xe[$]=_e),(_e.type!==U||_e.texture!==le)&&(oe!==$&&(s.activeTexture($),oe=$),s.bindTexture(U,le||ge[U]),_e.type=U,_e.texture=le)}function de(){let U=xe[oe];U!==void 0&&U.type!==void 0&&(s.bindTexture(U.type,null),U.type=void 0,U.texture=void 0)}function rt(){try{s.compressedTexImage2D(...arguments)}catch(U){Be("WebGLState:",U)}}function P(){try{s.compressedTexImage3D(...arguments)}catch(U){Be("WebGLState:",U)}}function T(){try{s.texSubImage2D(...arguments)}catch(U){Be("WebGLState:",U)}}function G(){try{s.texSubImage3D(...arguments)}catch(U){Be("WebGLState:",U)}}function j(){try{s.compressedTexSubImage2D(...arguments)}catch(U){Be("WebGLState:",U)}}function se(){try{s.compressedTexSubImage3D(...arguments)}catch(U){Be("WebGLState:",U)}}function he(){try{s.texStorage2D(...arguments)}catch(U){Be("WebGLState:",U)}}function pe(){try{s.texStorage3D(...arguments)}catch(U){Be("WebGLState:",U)}}function K(){try{s.texImage2D(...arguments)}catch(U){Be("WebGLState:",U)}}function ee(){try{s.texImage3D(...arguments)}catch(U){Be("WebGLState:",U)}}function ve(U){return o[U]!==void 0?o[U]:s.getParameter(U)}function we(U,le){o[U]!==le&&(s.pixelStorei(U,le),o[U]=le)}function me(U){Ce.equals(U)===!1&&(s.scissor(U.x,U.y,U.z,U.w),Ce.copy(U))}function ue(U){De.equals(U)===!1&&(s.viewport(U.x,U.y,U.z,U.w),De.copy(U))}function Ve(U,le){let $=u.get(le);$===void 0&&($=new WeakMap,u.set(le,$));let _e=$.get(U);_e===void 0&&(_e=s.getUniformBlockIndex(le,U.name),$.set(U,_e))}function Ue(U,le){let _e=u.get(le).get(U);l.get(le)!==_e&&(s.uniformBlockBinding(le,_e,U.__bindingPointIndex),l.set(le,_e))}function He(){s.disable(s.BLEND),s.disable(s.CULL_FACE),s.disable(s.DEPTH_TEST),s.disable(s.POLYGON_OFFSET_FILL),s.disable(s.SCISSOR_TEST),s.disable(s.STENCIL_TEST),s.disable(s.SAMPLE_ALPHA_TO_COVERAGE),s.blendEquation(s.FUNC_ADD),s.blendFunc(s.ONE,s.ZERO),s.blendFuncSeparate(s.ONE,s.ZERO,s.ONE,s.ZERO),s.blendColor(0,0,0,0),s.colorMask(!0,!0,!0,!0),s.clearColor(0,0,0,0),s.depthMask(!0),s.depthFunc(s.LESS),a.setReversed(!1),s.clearDepth(1),s.stencilMask(4294967295),s.stencilFunc(s.ALWAYS,0,4294967295),s.stencilOp(s.KEEP,s.KEEP,s.KEEP),s.clearStencil(0),s.cullFace(s.BACK),s.frontFace(s.CCW),s.polygonOffset(0,0),s.activeTexture(s.TEXTURE0),s.bindFramebuffer(s.FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.useProgram(null),s.lineWidth(1),s.scissor(0,0,s.canvas.width,s.canvas.height),s.viewport(0,0,s.canvas.width,s.canvas.height),s.pixelStorei(s.PACK_ALIGNMENT,4),s.pixelStorei(s.UNPACK_ALIGNMENT,4),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,!1),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,s.BROWSER_DEFAULT_WEBGL),s.pixelStorei(s.PACK_ROW_LENGTH,0),s.pixelStorei(s.PACK_SKIP_PIXELS,0),s.pixelStorei(s.PACK_SKIP_ROWS,0),s.pixelStorei(s.UNPACK_ROW_LENGTH,0),s.pixelStorei(s.UNPACK_IMAGE_HEIGHT,0),s.pixelStorei(s.UNPACK_SKIP_PIXELS,0),s.pixelStorei(s.UNPACK_SKIP_ROWS,0),s.pixelStorei(s.UNPACK_SKIP_IMAGES,0),d={},o={},oe=null,xe={},h={},f=new WeakMap,p=[],v=null,g=!1,m=null,M=null,x=null,S=null,w=null,y=null,E=null,_=new Ke(0,0,0),b=0,R=!1,A=null,L=null,N=null,O=null,D=null,Ce.set(0,0,s.canvas.width,s.canvas.height),De.set(0,0,s.canvas.width,s.canvas.height),r.reset(),a.reset(),c.reset()}return{buffers:{color:r,depth:a,stencil:c},enable:ae,disable:Pe,bindFramebuffer:Le,drawBuffers:Ne,useProgram:at,setBlending:st,setMaterial:ke,setFlipSided:Ye,setCullFace:lt,setLineWidth:ft,setPolygonOffset:z,setScissorTest:ut,activeTexture:Xe,bindTexture:qe,unbindTexture:de,compressedTexImage2D:rt,compressedTexImage3D:P,texImage2D:K,texImage3D:ee,pixelStorei:we,getParameter:ve,updateUBOMapping:Ve,uniformBlockBinding:Ue,texStorage2D:he,texStorage3D:pe,texSubImage2D:T,texSubImage3D:G,compressedTexSubImage2D:j,compressedTexSubImage3D:se,scissor:me,viewport:ue,reset:He}}function Fm(s,e,t,n,i,r,a){let c=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),u=new Je,d=new WeakMap,o=new Set,h,f=new WeakMap,p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function v(P,T){return p?new OffscreenCanvas(P,T):as("canvas")}function g(P,T,G){let j=1,se=rt(P);if((se.width>G||se.height>G)&&(j=G/Math.max(se.width,se.height)),j<1)if(typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&P instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&P instanceof ImageBitmap||typeof VideoFrame<"u"&&P instanceof VideoFrame){let he=Math.floor(j*se.width),pe=Math.floor(j*se.height);h===void 0&&(h=v(he,pe));let K=T?v(he,pe):h;return K.width=he,K.height=pe,K.getContext("2d").drawImage(P,0,0,he,pe),Fe("WebGLRenderer: Texture has been resized from ("+se.width+"x"+se.height+") to ("+he+"x"+pe+")."),K}else return"data"in P&&Fe("WebGLRenderer: Image in DataTexture is too big ("+se.width+"x"+se.height+")."),P;return P}function m(P){return P.generateMipmaps}function M(P){s.generateMipmap(P)}function x(P){return P.isWebGLCubeRenderTarget?s.TEXTURE_CUBE_MAP:P.isWebGL3DRenderTarget?s.TEXTURE_3D:P.isWebGLArrayRenderTarget||P.isCompressedArrayTexture?s.TEXTURE_2D_ARRAY:s.TEXTURE_2D}function S(P,T,G,j,se,he=!1){if(P!==null){if(s[P]!==void 0)return s[P];Fe("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+P+"'")}let pe;j&&(pe=e.get("EXT_texture_norm16"),pe||Fe("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let K=T;if(T===s.RED&&(G===s.FLOAT&&(K=s.R32F),G===s.HALF_FLOAT&&(K=s.R16F),G===s.UNSIGNED_BYTE&&(K=s.R8),G===s.UNSIGNED_SHORT&&pe&&(K=pe.R16_EXT),G===s.SHORT&&pe&&(K=pe.R16_SNORM_EXT)),T===s.RED_INTEGER&&(G===s.UNSIGNED_BYTE&&(K=s.R8UI),G===s.UNSIGNED_SHORT&&(K=s.R16UI),G===s.UNSIGNED_INT&&(K=s.R32UI),G===s.BYTE&&(K=s.R8I),G===s.SHORT&&(K=s.R16I),G===s.INT&&(K=s.R32I)),T===s.RG&&(G===s.FLOAT&&(K=s.RG32F),G===s.HALF_FLOAT&&(K=s.RG16F),G===s.UNSIGNED_BYTE&&(K=s.RG8),G===s.UNSIGNED_SHORT&&pe&&(K=pe.RG16_EXT),G===s.SHORT&&pe&&(K=pe.RG16_SNORM_EXT)),T===s.RG_INTEGER&&(G===s.UNSIGNED_BYTE&&(K=s.RG8UI),G===s.UNSIGNED_SHORT&&(K=s.RG16UI),G===s.UNSIGNED_INT&&(K=s.RG32UI),G===s.BYTE&&(K=s.RG8I),G===s.SHORT&&(K=s.RG16I),G===s.INT&&(K=s.RG32I)),T===s.RGB_INTEGER&&(G===s.UNSIGNED_BYTE&&(K=s.RGB8UI),G===s.UNSIGNED_SHORT&&(K=s.RGB16UI),G===s.UNSIGNED_INT&&(K=s.RGB32UI),G===s.BYTE&&(K=s.RGB8I),G===s.SHORT&&(K=s.RGB16I),G===s.INT&&(K=s.RGB32I)),T===s.RGBA_INTEGER&&(G===s.UNSIGNED_BYTE&&(K=s.RGBA8UI),G===s.UNSIGNED_SHORT&&(K=s.RGBA16UI),G===s.UNSIGNED_INT&&(K=s.RGBA32UI),G===s.BYTE&&(K=s.RGBA8I),G===s.SHORT&&(K=s.RGBA16I),G===s.INT&&(K=s.RGBA32I)),T===s.RGB&&(G===s.UNSIGNED_SHORT&&pe&&(K=pe.RGB16_EXT),G===s.SHORT&&pe&&(K=pe.RGB16_SNORM_EXT),G===s.UNSIGNED_INT_5_9_9_9_REV&&(K=s.RGB9_E5),G===s.UNSIGNED_INT_10F_11F_11F_REV&&(K=s.R11F_G11F_B10F)),T===s.RGBA){let ee=he?rs:et.getTransfer(se);G===s.FLOAT&&(K=s.RGBA32F),G===s.HALF_FLOAT&&(K=s.RGBA16F),G===s.UNSIGNED_BYTE&&(K=ee===ht?s.SRGB8_ALPHA8:s.RGBA8),G===s.UNSIGNED_SHORT&&pe&&(K=pe.RGBA16_EXT),G===s.SHORT&&pe&&(K=pe.RGBA16_SNORM_EXT),G===s.UNSIGNED_SHORT_4_4_4_4&&(K=s.RGBA4),G===s.UNSIGNED_SHORT_5_5_5_1&&(K=s.RGB5_A1)}return(K===s.R16F||K===s.R32F||K===s.RG16F||K===s.RG32F||K===s.RGBA16F||K===s.RGBA32F)&&e.get("EXT_color_buffer_float"),K}function w(P,T){let G;return P?T===null||T===un||T===Hi?G=s.DEPTH24_STENCIL8:T===fn?G=s.DEPTH32F_STENCIL8:T===Gi&&(G=s.DEPTH24_STENCIL8,Fe("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):T===null||T===un||T===Hi?G=s.DEPTH_COMPONENT24:T===fn?G=s.DEPTH_COMPONENT32F:T===Gi&&(G=s.DEPTH_COMPONENT16),G}function y(P,T){return m(P)===!0||P.isFramebufferTexture&&P.minFilter!==wt&&P.minFilter!==Ct?Math.log2(Math.max(T.width,T.height))+1:P.mipmaps!==void 0&&P.mipmaps.length>0?P.mipmaps.length:P.isCompressedTexture&&Array.isArray(P.image)?T.mipmaps.length:1}function E(P){let T=P.target;T.removeEventListener("dispose",E),b(T),T.isVideoTexture&&d.delete(T),T.isHTMLTexture&&o.delete(T)}function _(P){let T=P.target;T.removeEventListener("dispose",_),A(T)}function b(P){let T=n.get(P);if(T.__webglInit===void 0)return;let G=P.source,j=f.get(G);if(j){let se=j[T.__cacheKey];se.usedTimes--,se.usedTimes===0&&R(P),Object.keys(j).length===0&&f.delete(G)}n.remove(P)}function R(P){let T=n.get(P);s.deleteTexture(T.__webglTexture);let G=P.source,j=f.get(G);delete j[T.__cacheKey],a.memory.textures--}function A(P){let T=n.get(P);if(P.depthTexture&&(P.depthTexture.dispose(),n.remove(P.depthTexture)),P.isWebGLCubeRenderTarget)for(let j=0;j<6;j++){if(Array.isArray(T.__webglFramebuffer[j]))for(let se=0;se<T.__webglFramebuffer[j].length;se++)s.deleteFramebuffer(T.__webglFramebuffer[j][se]);else s.deleteFramebuffer(T.__webglFramebuffer[j]);T.__webglDepthbuffer&&s.deleteRenderbuffer(T.__webglDepthbuffer[j])}else{if(Array.isArray(T.__webglFramebuffer))for(let j=0;j<T.__webglFramebuffer.length;j++)s.deleteFramebuffer(T.__webglFramebuffer[j]);else s.deleteFramebuffer(T.__webglFramebuffer);if(T.__webglDepthbuffer&&s.deleteRenderbuffer(T.__webglDepthbuffer),T.__webglMultisampledFramebuffer&&s.deleteFramebuffer(T.__webglMultisampledFramebuffer),T.__webglColorRenderbuffer)for(let j=0;j<T.__webglColorRenderbuffer.length;j++)T.__webglColorRenderbuffer[j]&&s.deleteRenderbuffer(T.__webglColorRenderbuffer[j]);T.__webglDepthRenderbuffer&&s.deleteRenderbuffer(T.__webglDepthRenderbuffer)}let G=P.textures;for(let j=0,se=G.length;j<se;j++){let he=n.get(G[j]);he.__webglTexture&&(s.deleteTexture(he.__webglTexture),a.memory.textures--),n.remove(G[j])}n.remove(P)}let L=0;function N(){L=0}function O(){return L}function D(P){L=P}function F(){let P=L;return P>=i.maxTextures&&Fe("WebGLTextures: Trying to use "+P+" texture units while this GPU supports only "+i.maxTextures),L+=1,P}function k(P){let T=[];return T.push(P.wrapS),T.push(P.wrapT),T.push(P.wrapR||0),T.push(P.magFilter),T.push(P.minFilter),T.push(P.anisotropy),T.push(P.internalFormat),T.push(P.format),T.push(P.type),T.push(P.generateMipmaps),T.push(P.premultiplyAlpha),T.push(P.flipY),T.push(P.unpackAlignment),T.push(P.colorSpace),T.join()}function Q(P,T){let G=n.get(P);if(P.isVideoTexture&&qe(P),P.isRenderTargetTexture===!1&&P.isExternalTexture!==!0&&P.version>0&&G.__version!==P.version){let j=P.image;if(j===null)Fe("WebGLRenderer: Texture marked for update but no image data found.");else if(j.complete===!1)Fe("WebGLRenderer: Texture marked for update but image is incomplete");else{Pe(G,P,T);return}}else P.isExternalTexture&&(G.__webglTexture=P.sourceTexture?P.sourceTexture:null);t.bindTexture(s.TEXTURE_2D,G.__webglTexture,s.TEXTURE0+T)}function ie(P,T){let G=n.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&G.__version!==P.version){Pe(G,P,T);return}else P.isExternalTexture&&(G.__webglTexture=P.sourceTexture?P.sourceTexture:null);t.bindTexture(s.TEXTURE_2D_ARRAY,G.__webglTexture,s.TEXTURE0+T)}function oe(P,T){let G=n.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&G.__version!==P.version){Pe(G,P,T);return}t.bindTexture(s.TEXTURE_3D,G.__webglTexture,s.TEXTURE0+T)}function xe(P,T){let G=n.get(P);if(P.isCubeDepthTexture!==!0&&P.version>0&&G.__version!==P.version){Le(G,P,T);return}t.bindTexture(s.TEXTURE_CUBE_MAP,G.__webglTexture,s.TEXTURE0+T)}let Ee={[Di]:s.REPEAT,[gn]:s.CLAMP_TO_EDGE,[Ar]:s.MIRRORED_REPEAT},ze={[wt]:s.NEAREST,[bc]:s.NEAREST_MIPMAP_NEAREST,[Is]:s.NEAREST_MIPMAP_LINEAR,[Ct]:s.LINEAR,[aa]:s.LINEAR_MIPMAP_NEAREST,[ti]:s.LINEAR_MIPMAP_LINEAR},Ce={[Ec]:s.NEVER,[Ic]:s.ALWAYS,[Ac]:s.LESS,[Wa]:s.LEQUAL,[Cc]:s.EQUAL,[Xa]:s.GEQUAL,[Rc]:s.GREATER,[Pc]:s.NOTEQUAL};function De(P,T){if(T.type===fn&&e.has("OES_texture_float_linear")===!1&&(T.magFilter===Ct||T.magFilter===aa||T.magFilter===Is||T.magFilter===ti||T.minFilter===Ct||T.minFilter===aa||T.minFilter===Is||T.minFilter===ti)&&Fe("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),s.texParameteri(P,s.TEXTURE_WRAP_S,Ee[T.wrapS]),s.texParameteri(P,s.TEXTURE_WRAP_T,Ee[T.wrapT]),(P===s.TEXTURE_3D||P===s.TEXTURE_2D_ARRAY)&&s.texParameteri(P,s.TEXTURE_WRAP_R,Ee[T.wrapR]),s.texParameteri(P,s.TEXTURE_MAG_FILTER,ze[T.magFilter]),s.texParameteri(P,s.TEXTURE_MIN_FILTER,ze[T.minFilter]),T.compareFunction&&(s.texParameteri(P,s.TEXTURE_COMPARE_MODE,s.COMPARE_REF_TO_TEXTURE),s.texParameteri(P,s.TEXTURE_COMPARE_FUNC,Ce[T.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(T.magFilter===wt||T.minFilter!==Is&&T.minFilter!==ti||T.type===fn&&e.has("OES_texture_float_linear")===!1)return;if(T.anisotropy>1||n.get(T).__currentAnisotropy){let G=e.get("EXT_texture_filter_anisotropic");s.texParameterf(P,G.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(T.anisotropy,i.getMaxAnisotropy())),n.get(T).__currentAnisotropy=T.anisotropy}}}function J(P,T){let G=!1;P.__webglInit===void 0&&(P.__webglInit=!0,T.addEventListener("dispose",E));let j=T.source,se=f.get(j);se===void 0&&(se={},f.set(j,se));let he=k(T);if(he!==P.__cacheKey){se[he]===void 0&&(se[he]={texture:s.createTexture(),usedTimes:0},a.memory.textures++,G=!0),se[he].usedTimes++;let pe=se[P.__cacheKey];pe!==void 0&&(se[P.__cacheKey].usedTimes--,pe.usedTimes===0&&R(T)),P.__cacheKey=he,P.__webglTexture=se[he].texture}return G}function ge(P,T,G){return Math.floor(Math.floor(P/G)/T)}function ae(P,T,G,j){let he=P.updateRanges;if(he.length===0)t.texSubImage2D(s.TEXTURE_2D,0,0,0,T.width,T.height,G,j,T.data);else{he.sort((we,me)=>we.start-me.start);let pe=0;for(let we=1;we<he.length;we++){let me=he[pe],ue=he[we],Ve=me.start+me.count,Ue=ge(ue.start,T.width,4),He=ge(me.start,T.width,4);ue.start<=Ve+1&&Ue===He&&ge(ue.start+ue.count-1,T.width,4)===Ue?me.count=Math.max(me.count,ue.start+ue.count-me.start):(++pe,he[pe]=ue)}he.length=pe+1;let K=t.getParameter(s.UNPACK_ROW_LENGTH),ee=t.getParameter(s.UNPACK_SKIP_PIXELS),ve=t.getParameter(s.UNPACK_SKIP_ROWS);t.pixelStorei(s.UNPACK_ROW_LENGTH,T.width);for(let we=0,me=he.length;we<me;we++){let ue=he[we],Ve=Math.floor(ue.start/4),Ue=Math.ceil(ue.count/4),He=Ve%T.width,U=Math.floor(Ve/T.width),le=Ue,$=1;t.pixelStorei(s.UNPACK_SKIP_PIXELS,He),t.pixelStorei(s.UNPACK_SKIP_ROWS,U),t.texSubImage2D(s.TEXTURE_2D,0,He,U,le,$,G,j,T.data)}P.clearUpdateRanges(),t.pixelStorei(s.UNPACK_ROW_LENGTH,K),t.pixelStorei(s.UNPACK_SKIP_PIXELS,ee),t.pixelStorei(s.UNPACK_SKIP_ROWS,ve)}}function Pe(P,T,G){let j=s.TEXTURE_2D;(T.isDataArrayTexture||T.isCompressedArrayTexture)&&(j=s.TEXTURE_2D_ARRAY),T.isData3DTexture&&(j=s.TEXTURE_3D);let se=J(P,T),he=T.source;t.bindTexture(j,P.__webglTexture,s.TEXTURE0+G);let pe=n.get(he);if(he.version!==pe.__version||se===!0){if(t.activeTexture(s.TEXTURE0+G),(typeof ImageBitmap<"u"&&T.image instanceof ImageBitmap)===!1){let $=et.getPrimaries(et.workingColorSpace),_e=T.colorSpace===Nn?null:et.getPrimaries(T.colorSpace),fe=T.colorSpace===Nn||$===_e?s.NONE:s.BROWSER_DEFAULT_WEBGL;t.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,T.flipY),t.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,T.premultiplyAlpha),t.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,fe)}t.pixelStorei(s.UNPACK_ALIGNMENT,T.unpackAlignment);let ee=g(T.image,!1,i.maxTextureSize);ee=de(T,ee);let ve=r.convert(T.format,T.colorSpace),we=r.convert(T.type),me=S(T.internalFormat,ve,we,T.normalized,T.colorSpace,T.isVideoTexture);De(j,T);let ue,Ve=T.mipmaps,Ue=T.isVideoTexture!==!0,He=pe.__version===void 0||se===!0,U=he.dataReady,le=y(T,ee);if(T.isDepthTexture)me=w(T.format===ni,T.type),He&&(Ue?t.texStorage2D(s.TEXTURE_2D,1,me,ee.width,ee.height):t.texImage2D(s.TEXTURE_2D,0,me,ee.width,ee.height,0,ve,we,null));else if(T.isDataTexture)if(Ve.length>0){Ue&&He&&t.texStorage2D(s.TEXTURE_2D,le,me,Ve[0].width,Ve[0].height);for(let $=0,_e=Ve.length;$<_e;$++)ue=Ve[$],Ue?U&&t.texSubImage2D(s.TEXTURE_2D,$,0,0,ue.width,ue.height,ve,we,ue.data):t.texImage2D(s.TEXTURE_2D,$,me,ue.width,ue.height,0,ve,we,ue.data);T.generateMipmaps=!1}else Ue?(He&&t.texStorage2D(s.TEXTURE_2D,le,me,ee.width,ee.height),U&&ae(T,ee,ve,we)):t.texImage2D(s.TEXTURE_2D,0,me,ee.width,ee.height,0,ve,we,ee.data);else if(T.isCompressedTexture)if(T.isCompressedArrayTexture){Ue&&He&&t.texStorage3D(s.TEXTURE_2D_ARRAY,le,me,Ve[0].width,Ve[0].height,ee.depth);for(let $=0,_e=Ve.length;$<_e;$++)if(ue=Ve[$],T.format!==sn)if(ve!==null)if(Ue){if(U)if(T.layerUpdates.size>0){let fe=cl(ue.width,ue.height,T.format,T.type);for(let ne of T.layerUpdates){let Ae=ue.data.subarray(ne*fe/ue.data.BYTES_PER_ELEMENT,(ne+1)*fe/ue.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,$,0,0,ne,ue.width,ue.height,1,ve,Ae)}T.clearLayerUpdates()}else t.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,$,0,0,0,ue.width,ue.height,ee.depth,ve,ue.data)}else t.compressedTexImage3D(s.TEXTURE_2D_ARRAY,$,me,ue.width,ue.height,ee.depth,0,ue.data,0,0);else Fe("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Ue?U&&t.texSubImage3D(s.TEXTURE_2D_ARRAY,$,0,0,0,ue.width,ue.height,ee.depth,ve,we,ue.data):t.texImage3D(s.TEXTURE_2D_ARRAY,$,me,ue.width,ue.height,ee.depth,0,ve,we,ue.data)}else{Ue&&He&&t.texStorage2D(s.TEXTURE_2D,le,me,Ve[0].width,Ve[0].height);for(let $=0,_e=Ve.length;$<_e;$++)ue=Ve[$],T.format!==sn?ve!==null?Ue?U&&t.compressedTexSubImage2D(s.TEXTURE_2D,$,0,0,ue.width,ue.height,ve,ue.data):t.compressedTexImage2D(s.TEXTURE_2D,$,me,ue.width,ue.height,0,ue.data):Fe("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Ue?U&&t.texSubImage2D(s.TEXTURE_2D,$,0,0,ue.width,ue.height,ve,we,ue.data):t.texImage2D(s.TEXTURE_2D,$,me,ue.width,ue.height,0,ve,we,ue.data)}else if(T.isDataArrayTexture)if(Ue){if(He&&t.texStorage3D(s.TEXTURE_2D_ARRAY,le,me,ee.width,ee.height,ee.depth),U)if(T.layerUpdates.size>0){let $=cl(ee.width,ee.height,T.format,T.type);for(let _e of T.layerUpdates){let fe=ee.data.subarray(_e*$/ee.data.BYTES_PER_ELEMENT,(_e+1)*$/ee.data.BYTES_PER_ELEMENT);t.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,_e,ee.width,ee.height,1,ve,we,fe)}T.clearLayerUpdates()}else t.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,0,ee.width,ee.height,ee.depth,ve,we,ee.data)}else t.texImage3D(s.TEXTURE_2D_ARRAY,0,me,ee.width,ee.height,ee.depth,0,ve,we,ee.data);else if(T.isData3DTexture)Ue?(He&&t.texStorage3D(s.TEXTURE_3D,le,me,ee.width,ee.height,ee.depth),U&&t.texSubImage3D(s.TEXTURE_3D,0,0,0,0,ee.width,ee.height,ee.depth,ve,we,ee.data)):t.texImage3D(s.TEXTURE_3D,0,me,ee.width,ee.height,ee.depth,0,ve,we,ee.data);else if(T.isFramebufferTexture){if(He)if(Ue)t.texStorage2D(s.TEXTURE_2D,le,me,ee.width,ee.height);else{let $=ee.width,_e=ee.height;for(let fe=0;fe<le;fe++)t.texImage2D(s.TEXTURE_2D,fe,me,$,_e,0,ve,we,null),$>>=1,_e>>=1}}else if(T.isHTMLTexture){if("texElementImage2D"in s){let $=s.canvas;if($.hasAttribute("layoutsubtree")||$.setAttribute("layoutsubtree","true"),ee.parentNode!==$){$.appendChild(ee),o.add(T),$.onpaint=Ge=>{let ot=Ge.changedElements;for(let it of o)ot.includes(it.image)&&(it.needsUpdate=!0)},$.requestPaint();return}let _e=0,fe=s.RGBA,ne=s.RGBA,Ae=s.UNSIGNED_BYTE;s.texElementImage2D(s.TEXTURE_2D,_e,fe,ne,Ae,ee),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MIN_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_S,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_T,s.CLAMP_TO_EDGE)}}else if(Ve.length>0){if(Ue&&He){let $=rt(Ve[0]);t.texStorage2D(s.TEXTURE_2D,le,me,$.width,$.height)}for(let $=0,_e=Ve.length;$<_e;$++)ue=Ve[$],Ue?U&&t.texSubImage2D(s.TEXTURE_2D,$,0,0,ve,we,ue):t.texImage2D(s.TEXTURE_2D,$,me,ve,we,ue);T.generateMipmaps=!1}else if(Ue){if(He){let $=rt(ee);t.texStorage2D(s.TEXTURE_2D,le,me,$.width,$.height)}U&&t.texSubImage2D(s.TEXTURE_2D,0,0,0,ve,we,ee)}else t.texImage2D(s.TEXTURE_2D,0,me,ve,we,ee);m(T)&&M(j),pe.__version=he.version,T.onUpdate&&T.onUpdate(T)}P.__version=T.version}function Le(P,T,G){if(T.image.length!==6)return;let j=J(P,T),se=T.source;t.bindTexture(s.TEXTURE_CUBE_MAP,P.__webglTexture,s.TEXTURE0+G);let he=n.get(se);if(se.version!==he.__version||j===!0){t.activeTexture(s.TEXTURE0+G);let pe=et.getPrimaries(et.workingColorSpace),K=T.colorSpace===Nn?null:et.getPrimaries(T.colorSpace),ee=T.colorSpace===Nn||pe===K?s.NONE:s.BROWSER_DEFAULT_WEBGL;t.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,T.flipY),t.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,T.premultiplyAlpha),t.pixelStorei(s.UNPACK_ALIGNMENT,T.unpackAlignment),t.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,ee);let ve=T.isCompressedTexture||T.image[0].isCompressedTexture,we=T.image[0]&&T.image[0].isDataTexture,me=[];for(let ne=0;ne<6;ne++)!ve&&!we?me[ne]=g(T.image[ne],!0,i.maxCubemapSize):me[ne]=we?T.image[ne].image:T.image[ne],me[ne]=de(T,me[ne]);let ue=me[0],Ve=r.convert(T.format,T.colorSpace),Ue=r.convert(T.type),He=S(T.internalFormat,Ve,Ue,T.normalized,T.colorSpace),U=T.isVideoTexture!==!0,le=he.__version===void 0||j===!0,$=se.dataReady,_e=y(T,ue);De(s.TEXTURE_CUBE_MAP,T);let fe;if(ve){U&&le&&t.texStorage2D(s.TEXTURE_CUBE_MAP,_e,He,ue.width,ue.height);for(let ne=0;ne<6;ne++){fe=me[ne].mipmaps;for(let Ae=0;Ae<fe.length;Ae++){let Ge=fe[Ae];T.format!==sn?Ve!==null?U?$&&t.compressedTexSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,Ae,0,0,Ge.width,Ge.height,Ve,Ge.data):t.compressedTexImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,Ae,He,Ge.width,Ge.height,0,Ge.data):Fe("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):U?$&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,Ae,0,0,Ge.width,Ge.height,Ve,Ue,Ge.data):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,Ae,He,Ge.width,Ge.height,0,Ve,Ue,Ge.data)}}}else{if(fe=T.mipmaps,U&&le){fe.length>0&&_e++;let ne=rt(me[0]);t.texStorage2D(s.TEXTURE_CUBE_MAP,_e,He,ne.width,ne.height)}for(let ne=0;ne<6;ne++)if(we){U?$&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,0,0,0,me[ne].width,me[ne].height,Ve,Ue,me[ne].data):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,0,He,me[ne].width,me[ne].height,0,Ve,Ue,me[ne].data);for(let Ae=0;Ae<fe.length;Ae++){let ot=fe[Ae].image[ne].image;U?$&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,Ae+1,0,0,ot.width,ot.height,Ve,Ue,ot.data):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,Ae+1,He,ot.width,ot.height,0,Ve,Ue,ot.data)}}else{U?$&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,0,0,0,Ve,Ue,me[ne]):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,0,He,Ve,Ue,me[ne]);for(let Ae=0;Ae<fe.length;Ae++){let Ge=fe[Ae];U?$&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,Ae+1,0,0,Ve,Ue,Ge.image[ne]):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ne,Ae+1,He,Ve,Ue,Ge.image[ne])}}}m(T)&&M(s.TEXTURE_CUBE_MAP),he.__version=se.version,T.onUpdate&&T.onUpdate(T)}P.__version=T.version}function Ne(P,T,G,j,se,he){let pe=r.convert(G.format,G.colorSpace),K=r.convert(G.type),ee=S(G.internalFormat,pe,K,G.normalized,G.colorSpace),ve=n.get(T),we=n.get(G);if(we.__renderTarget=T,!ve.__hasExternalTextures){let me=Math.max(1,T.width>>he),ue=Math.max(1,T.height>>he);se===s.TEXTURE_3D||se===s.TEXTURE_2D_ARRAY?t.texImage3D(se,he,ee,me,ue,T.depth,0,pe,K,null):t.texImage2D(se,he,ee,me,ue,0,pe,K,null)}t.bindFramebuffer(s.FRAMEBUFFER,P),Xe(T)?c.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,j,se,we.__webglTexture,0,ut(T)):(se===s.TEXTURE_2D||se>=s.TEXTURE_CUBE_MAP_POSITIVE_X&&se<=s.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&s.framebufferTexture2D(s.FRAMEBUFFER,j,se,we.__webglTexture,he),t.bindFramebuffer(s.FRAMEBUFFER,null)}function at(P,T,G){if(s.bindRenderbuffer(s.RENDERBUFFER,P),T.depthBuffer){let j=T.depthTexture,se=j&&j.isDepthTexture?j.type:null,he=w(T.stencilBuffer,se),pe=T.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;Xe(T)?c.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,ut(T),he,T.width,T.height):G?s.renderbufferStorageMultisample(s.RENDERBUFFER,ut(T),he,T.width,T.height):s.renderbufferStorage(s.RENDERBUFFER,he,T.width,T.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,pe,s.RENDERBUFFER,P)}else{let j=T.textures;for(let se=0;se<j.length;se++){let he=j[se],pe=r.convert(he.format,he.colorSpace),K=r.convert(he.type),ee=S(he.internalFormat,pe,K,he.normalized,he.colorSpace);Xe(T)?c.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,ut(T),ee,T.width,T.height):G?s.renderbufferStorageMultisample(s.RENDERBUFFER,ut(T),ee,T.width,T.height):s.renderbufferStorage(s.RENDERBUFFER,ee,T.width,T.height)}}s.bindRenderbuffer(s.RENDERBUFFER,null)}function Ze(P,T,G){let j=T.isWebGLCubeRenderTarget===!0;if(t.bindFramebuffer(s.FRAMEBUFFER,P),!(T.depthTexture&&T.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let se=n.get(T.depthTexture);if(se.__renderTarget=T,(!se.__webglTexture||T.depthTexture.image.width!==T.width||T.depthTexture.image.height!==T.height)&&(T.depthTexture.image.width=T.width,T.depthTexture.image.height=T.height,T.depthTexture.needsUpdate=!0),j){if(se.__webglInit===void 0&&(se.__webglInit=!0,T.depthTexture.addEventListener("dispose",E)),se.__webglTexture===void 0){se.__webglTexture=s.createTexture(),t.bindTexture(s.TEXTURE_CUBE_MAP,se.__webglTexture),De(s.TEXTURE_CUBE_MAP,T.depthTexture);let ve=r.convert(T.depthTexture.format),we=r.convert(T.depthTexture.type),me;T.depthTexture.format===xn?me=s.DEPTH_COMPONENT24:T.depthTexture.format===ni&&(me=s.DEPTH24_STENCIL8);for(let ue=0;ue<6;ue++)s.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ue,0,me,T.width,T.height,0,ve,we,null)}}else Q(T.depthTexture,0);let he=se.__webglTexture,pe=ut(T),K=j?s.TEXTURE_CUBE_MAP_POSITIVE_X+G:s.TEXTURE_2D,ee=T.depthTexture.format===ni?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;if(T.depthTexture.format===xn)Xe(T)?c.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,ee,K,he,0,pe):s.framebufferTexture2D(s.FRAMEBUFFER,ee,K,he,0);else if(T.depthTexture.format===ni)Xe(T)?c.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,ee,K,he,0,pe):s.framebufferTexture2D(s.FRAMEBUFFER,ee,K,he,0);else throw new Error("Unknown depthTexture format")}function nt(P){let T=n.get(P),G=P.isWebGLCubeRenderTarget===!0;if(T.__boundDepthTexture!==P.depthTexture){let j=P.depthTexture;if(T.__depthDisposeCallback&&T.__depthDisposeCallback(),j){let se=()=>{delete T.__boundDepthTexture,delete T.__depthDisposeCallback,j.removeEventListener("dispose",se)};j.addEventListener("dispose",se),T.__depthDisposeCallback=se}T.__boundDepthTexture=j}if(P.depthTexture&&!T.__autoAllocateDepthBuffer)if(G)for(let j=0;j<6;j++)Ze(T.__webglFramebuffer[j],P,j);else{let j=P.texture.mipmaps;j&&j.length>0?Ze(T.__webglFramebuffer[0],P,0):Ze(T.__webglFramebuffer,P,0)}else if(G){T.__webglDepthbuffer=[];for(let j=0;j<6;j++)if(t.bindFramebuffer(s.FRAMEBUFFER,T.__webglFramebuffer[j]),T.__webglDepthbuffer[j]===void 0)T.__webglDepthbuffer[j]=s.createRenderbuffer(),at(T.__webglDepthbuffer[j],P,!1);else{let se=P.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,he=T.__webglDepthbuffer[j];s.bindRenderbuffer(s.RENDERBUFFER,he),s.framebufferRenderbuffer(s.FRAMEBUFFER,se,s.RENDERBUFFER,he)}}else{let j=P.texture.mipmaps;if(j&&j.length>0?t.bindFramebuffer(s.FRAMEBUFFER,T.__webglFramebuffer[0]):t.bindFramebuffer(s.FRAMEBUFFER,T.__webglFramebuffer),T.__webglDepthbuffer===void 0)T.__webglDepthbuffer=s.createRenderbuffer(),at(T.__webglDepthbuffer,P,!1);else{let se=P.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,he=T.__webglDepthbuffer;s.bindRenderbuffer(s.RENDERBUFFER,he),s.framebufferRenderbuffer(s.FRAMEBUFFER,se,s.RENDERBUFFER,he)}}t.bindFramebuffer(s.FRAMEBUFFER,null)}function st(P,T,G){let j=n.get(P);T!==void 0&&Ne(j.__webglFramebuffer,P,P.texture,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,0),G!==void 0&&nt(P)}function ke(P){let T=P.texture,G=n.get(P),j=n.get(T);P.addEventListener("dispose",_);let se=P.textures,he=P.isWebGLCubeRenderTarget===!0,pe=se.length>1;if(pe||(j.__webglTexture===void 0&&(j.__webglTexture=s.createTexture()),j.__version=T.version,a.memory.textures++),he){G.__webglFramebuffer=[];for(let K=0;K<6;K++)if(T.mipmaps&&T.mipmaps.length>0){G.__webglFramebuffer[K]=[];for(let ee=0;ee<T.mipmaps.length;ee++)G.__webglFramebuffer[K][ee]=s.createFramebuffer()}else G.__webglFramebuffer[K]=s.createFramebuffer()}else{if(T.mipmaps&&T.mipmaps.length>0){G.__webglFramebuffer=[];for(let K=0;K<T.mipmaps.length;K++)G.__webglFramebuffer[K]=s.createFramebuffer()}else G.__webglFramebuffer=s.createFramebuffer();if(pe)for(let K=0,ee=se.length;K<ee;K++){let ve=n.get(se[K]);ve.__webglTexture===void 0&&(ve.__webglTexture=s.createTexture(),a.memory.textures++)}if(P.samples>0&&Xe(P)===!1){G.__webglMultisampledFramebuffer=s.createFramebuffer(),G.__webglColorRenderbuffer=[],t.bindFramebuffer(s.FRAMEBUFFER,G.__webglMultisampledFramebuffer);for(let K=0;K<se.length;K++){let ee=se[K];G.__webglColorRenderbuffer[K]=s.createRenderbuffer(),s.bindRenderbuffer(s.RENDERBUFFER,G.__webglColorRenderbuffer[K]);let ve=r.convert(ee.format,ee.colorSpace),we=r.convert(ee.type),me=S(ee.internalFormat,ve,we,ee.normalized,ee.colorSpace,P.isXRRenderTarget===!0),ue=ut(P);s.renderbufferStorageMultisample(s.RENDERBUFFER,ue,me,P.width,P.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+K,s.RENDERBUFFER,G.__webglColorRenderbuffer[K])}s.bindRenderbuffer(s.RENDERBUFFER,null),P.depthBuffer&&(G.__webglDepthRenderbuffer=s.createRenderbuffer(),at(G.__webglDepthRenderbuffer,P,!0)),t.bindFramebuffer(s.FRAMEBUFFER,null)}}if(he){t.bindTexture(s.TEXTURE_CUBE_MAP,j.__webglTexture),De(s.TEXTURE_CUBE_MAP,T);for(let K=0;K<6;K++)if(T.mipmaps&&T.mipmaps.length>0)for(let ee=0;ee<T.mipmaps.length;ee++)Ne(G.__webglFramebuffer[K][ee],P,T,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+K,ee);else Ne(G.__webglFramebuffer[K],P,T,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+K,0);m(T)&&M(s.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(pe){for(let K=0,ee=se.length;K<ee;K++){let ve=se[K],we=n.get(ve),me=s.TEXTURE_2D;(P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&(me=P.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),t.bindTexture(me,we.__webglTexture),De(me,ve),Ne(G.__webglFramebuffer,P,ve,s.COLOR_ATTACHMENT0+K,me,0),m(ve)&&M(me)}t.unbindTexture()}else{let K=s.TEXTURE_2D;if((P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&(K=P.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),t.bindTexture(K,j.__webglTexture),De(K,T),T.mipmaps&&T.mipmaps.length>0)for(let ee=0;ee<T.mipmaps.length;ee++)Ne(G.__webglFramebuffer[ee],P,T,s.COLOR_ATTACHMENT0,K,ee);else Ne(G.__webglFramebuffer,P,T,s.COLOR_ATTACHMENT0,K,0);m(T)&&M(K),t.unbindTexture()}P.depthBuffer&&nt(P)}function Ye(P){let T=P.textures;for(let G=0,j=T.length;G<j;G++){let se=T[G];if(m(se)){let he=x(P),pe=n.get(se).__webglTexture;t.bindTexture(he,pe),M(he),t.unbindTexture()}}}let lt=[],ft=[];function z(P){if(P.samples>0){if(Xe(P)===!1){let T=P.textures,G=P.width,j=P.height,se=s.COLOR_BUFFER_BIT,he=P.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,pe=n.get(P),K=T.length>1;if(K)for(let ve=0;ve<T.length;ve++)t.bindFramebuffer(s.FRAMEBUFFER,pe.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+ve,s.RENDERBUFFER,null),t.bindFramebuffer(s.FRAMEBUFFER,pe.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+ve,s.TEXTURE_2D,null,0);t.bindFramebuffer(s.READ_FRAMEBUFFER,pe.__webglMultisampledFramebuffer);let ee=P.texture.mipmaps;ee&&ee.length>0?t.bindFramebuffer(s.DRAW_FRAMEBUFFER,pe.__webglFramebuffer[0]):t.bindFramebuffer(s.DRAW_FRAMEBUFFER,pe.__webglFramebuffer);for(let ve=0;ve<T.length;ve++){if(P.resolveDepthBuffer&&(P.depthBuffer&&(se|=s.DEPTH_BUFFER_BIT),P.stencilBuffer&&P.resolveStencilBuffer&&(se|=s.STENCIL_BUFFER_BIT)),K){s.framebufferRenderbuffer(s.READ_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.RENDERBUFFER,pe.__webglColorRenderbuffer[ve]);let we=n.get(T[ve]).__webglTexture;s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,we,0)}s.blitFramebuffer(0,0,G,j,0,0,G,j,se,s.NEAREST),l===!0&&(lt.length=0,ft.length=0,lt.push(s.COLOR_ATTACHMENT0+ve),P.depthBuffer&&P.resolveDepthBuffer===!1&&(lt.push(he),ft.push(he),s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,ft)),s.invalidateFramebuffer(s.READ_FRAMEBUFFER,lt))}if(t.bindFramebuffer(s.READ_FRAMEBUFFER,null),t.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),K)for(let ve=0;ve<T.length;ve++){t.bindFramebuffer(s.FRAMEBUFFER,pe.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+ve,s.RENDERBUFFER,pe.__webglColorRenderbuffer[ve]);let we=n.get(T[ve]).__webglTexture;t.bindFramebuffer(s.FRAMEBUFFER,pe.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+ve,s.TEXTURE_2D,we,0)}t.bindFramebuffer(s.DRAW_FRAMEBUFFER,pe.__webglMultisampledFramebuffer)}else if(P.depthBuffer&&P.resolveDepthBuffer===!1&&l){let T=P.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,[T])}}}function ut(P){return Math.min(i.maxSamples,P.samples)}function Xe(P){let T=n.get(P);return P.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&T.__useRenderToTexture!==!1}function qe(P){let T=a.render.frame;d.get(P)!==T&&(d.set(P,T),P.update())}function de(P,T){let G=P.colorSpace,j=P.format,se=P.type;return P.isCompressedTexture===!0||P.isVideoTexture===!0||G!==ss&&G!==Nn&&(et.getTransfer(G)===ht?(j!==sn||se!==Gt)&&Fe("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Be("WebGLTextures: Unsupported texture color space:",G)),T}function rt(P){return typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement?(u.width=P.naturalWidth||P.width,u.height=P.naturalHeight||P.height):typeof VideoFrame<"u"&&P instanceof VideoFrame?(u.width=P.displayWidth,u.height=P.displayHeight):(u.width=P.width,u.height=P.height),u}this.allocateTextureUnit=F,this.resetTextureUnits=N,this.getTextureUnits=O,this.setTextureUnits=D,this.setTexture2D=Q,this.setTexture2DArray=ie,this.setTexture3D=oe,this.setTextureCube=xe,this.rebindTextures=st,this.setupRenderTarget=ke,this.updateRenderTargetMipmap=Ye,this.updateMultisampleRenderTarget=z,this.setupDepthRenderbuffer=nt,this.setupFrameBufferTexture=Ne,this.useMultisampledRTT=Xe,this.isReversedDepthBuffer=function(){return t.buffers.depth.getReversed()}}function Om(s,e){function t(n,i=Nn){let r,a=et.getTransfer(i);if(n===Gt)return s.UNSIGNED_BYTE;if(n===la)return s.UNSIGNED_SHORT_4_4_4_4;if(n===ca)return s.UNSIGNED_SHORT_5_5_5_1;if(n===jo)return s.UNSIGNED_INT_5_9_9_9_REV;if(n===el)return s.UNSIGNED_INT_10F_11F_11F_REV;if(n===Ko)return s.BYTE;if(n===Qo)return s.SHORT;if(n===Gi)return s.UNSIGNED_SHORT;if(n===oa)return s.INT;if(n===un)return s.UNSIGNED_INT;if(n===fn)return s.FLOAT;if(n===yn)return s.HALF_FLOAT;if(n===tl)return s.ALPHA;if(n===nl)return s.RGB;if(n===sn)return s.RGBA;if(n===xn)return s.DEPTH_COMPONENT;if(n===ni)return s.DEPTH_STENCIL;if(n===il)return s.RED;if(n===ha)return s.RED_INTEGER;if(n===ii)return s.RG;if(n===ua)return s.RG_INTEGER;if(n===fa)return s.RGBA_INTEGER;if(n===Ls||n===Ds||n===Us||n===Ns)if(a===ht)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Ls)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Ds)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Us)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Ns)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Ls)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Ds)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Us)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Ns)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===da||n===pa||n===ma||n===ga)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===da)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===pa)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===ma)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===ga)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===xa||n===va||n===_a||n===ya||n===Sa||n===Fs||n===Ma)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===xa||n===va)return a===ht?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===_a)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC;if(n===ya)return r.COMPRESSED_R11_EAC;if(n===Sa)return r.COMPRESSED_SIGNED_R11_EAC;if(n===Fs)return r.COMPRESSED_RG11_EAC;if(n===Ma)return r.COMPRESSED_SIGNED_RG11_EAC}else return null;if(n===ba||n===wa||n===Ta||n===Ea||n===Aa||n===Ca||n===Ra||n===Pa||n===Ia||n===La||n===Da||n===Ua||n===Na||n===Fa)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===ba)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===wa)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===Ta)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===Ea)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===Aa)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===Ca)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Ra)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Pa)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===Ia)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===La)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Da)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===Ua)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Na)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Fa)return a===ht?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Oa||n===Ba||n===za)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===Oa)return a===ht?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===Ba)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===za)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===Va||n===ka||n===Os||n===Ga)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===Va)return r.COMPRESSED_RED_RGTC1_EXT;if(n===ka)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Os)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Ga)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Hi?s.UNSIGNED_INT_24_8:s[n]!==void 0?s[n]:null}return{convert:t}}var Bm=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,zm=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,Cl=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new xs(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new Zt({vertexShader:Bm,fragmentShader:zm,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new Tt(new ys(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Rl=class extends vn{constructor(e,t){super();let n=this,i=null,r=1,a=null,c="local-floor",l=1,u=null,d=null,o=null,h=null,f=null,p=null,v=typeof XRWebGLBinding<"u",g=new Cl,m={},M=t.getContextAttributes(),x=null,S=null,w=[],y=[],E=new Je,_=null,b=new At;b.viewport=new xt;let R=new At;R.viewport=new xt;let A=[b,R],L=new ea,N=null,O=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(J){let ge=w[J];return ge===void 0&&(ge=new Oi,w[J]=ge),ge.getTargetRaySpace()},this.getControllerGrip=function(J){let ge=w[J];return ge===void 0&&(ge=new Oi,w[J]=ge),ge.getGripSpace()},this.getHand=function(J){let ge=w[J];return ge===void 0&&(ge=new Oi,w[J]=ge),ge.getHandSpace()};function D(J){let ge=y.indexOf(J.inputSource);if(ge===-1)return;let ae=w[ge];ae!==void 0&&(ae.update(J.inputSource,J.frame,u||a),ae.dispatchEvent({type:J.type,data:J.inputSource}))}function F(){i.removeEventListener("select",D),i.removeEventListener("selectstart",D),i.removeEventListener("selectend",D),i.removeEventListener("squeeze",D),i.removeEventListener("squeezestart",D),i.removeEventListener("squeezeend",D),i.removeEventListener("end",F),i.removeEventListener("inputsourceschange",k);for(let J=0;J<w.length;J++){let ge=y[J];ge!==null&&(y[J]=null,w[J].disconnect(ge))}N=null,O=null,g.reset();for(let J in m)delete m[J];e.setRenderTarget(x),f=null,h=null,o=null,i=null,S=null,De.stop(),n.isPresenting=!1,e.setPixelRatio(_),e.setSize(E.width,E.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(J){r=J,n.isPresenting===!0&&Fe("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(J){c=J,n.isPresenting===!0&&Fe("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return u||a},this.setReferenceSpace=function(J){u=J},this.getBaseLayer=function(){return h!==null?h:f},this.getBinding=function(){return o===null&&v&&(o=new XRWebGLBinding(i,t)),o},this.getFrame=function(){return p},this.getSession=function(){return i},this.setSession=async function(J){if(i=J,i!==null){if(x=e.getRenderTarget(),i.addEventListener("select",D),i.addEventListener("selectstart",D),i.addEventListener("selectend",D),i.addEventListener("squeeze",D),i.addEventListener("squeezestart",D),i.addEventListener("squeezeend",D),i.addEventListener("end",F),i.addEventListener("inputsourceschange",k),M.xrCompatible!==!0&&await t.makeXRCompatible(),_=e.getPixelRatio(),e.getSize(E),v&&"createProjectionLayer"in XRWebGLBinding.prototype){let ae=null,Pe=null,Le=null;M.depth&&(Le=M.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,ae=M.stencil?ni:xn,Pe=M.stencil?Hi:un);let Ne={colorFormat:t.RGBA8,depthFormat:Le,scaleFactor:r};o=this.getBinding(),h=o.createProjectionLayer(Ne),i.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),S=new Yt(h.textureWidth,h.textureHeight,{format:sn,type:Gt,depthTexture:new Un(h.textureWidth,h.textureHeight,Pe,void 0,void 0,void 0,void 0,void 0,void 0,ae),stencilBuffer:M.stencil,colorSpace:e.outputColorSpace,samples:M.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1})}else{let ae={antialias:M.antialias,alpha:!0,depth:M.depth,stencil:M.stencil,framebufferScaleFactor:r};f=new XRWebGLLayer(i,t,ae),i.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),S=new Yt(f.framebufferWidth,f.framebufferHeight,{format:sn,type:Gt,colorSpace:e.outputColorSpace,stencilBuffer:M.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}S.isXRRenderTarget=!0,this.setFoveation(l),u=null,a=await i.requestReferenceSpace(c),De.setContext(i),De.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return g.getDepthTexture()};function k(J){for(let ge=0;ge<J.removed.length;ge++){let ae=J.removed[ge],Pe=y.indexOf(ae);Pe>=0&&(y[Pe]=null,w[Pe].disconnect(ae))}for(let ge=0;ge<J.added.length;ge++){let ae=J.added[ge],Pe=y.indexOf(ae);if(Pe===-1){for(let Ne=0;Ne<w.length;Ne++)if(Ne>=y.length){y.push(ae),Pe=Ne;break}else if(y[Ne]===null){y[Ne]=ae,Pe=Ne;break}if(Pe===-1)break}let Le=w[Pe];Le&&Le.connect(ae)}}let Q=new H,ie=new H;function oe(J,ge,ae){Q.setFromMatrixPosition(ge.matrixWorld),ie.setFromMatrixPosition(ae.matrixWorld);let Pe=Q.distanceTo(ie),Le=ge.projectionMatrix.elements,Ne=ae.projectionMatrix.elements,at=Le[14]/(Le[10]-1),Ze=Le[14]/(Le[10]+1),nt=(Le[9]+1)/Le[5],st=(Le[9]-1)/Le[5],ke=(Le[8]-1)/Le[0],Ye=(Ne[8]+1)/Ne[0],lt=at*ke,ft=at*Ye,z=Pe/(-ke+Ye),ut=z*-ke;if(ge.matrixWorld.decompose(J.position,J.quaternion,J.scale),J.translateX(ut),J.translateZ(z),J.matrixWorld.compose(J.position,J.quaternion,J.scale),J.matrixWorldInverse.copy(J.matrixWorld).invert(),Le[10]===-1)J.projectionMatrix.copy(ge.projectionMatrix),J.projectionMatrixInverse.copy(ge.projectionMatrixInverse);else{let Xe=at+z,qe=Ze+z,de=lt-ut,rt=ft+(Pe-ut),P=nt*Ze/qe*Xe,T=st*Ze/qe*Xe;J.projectionMatrix.makePerspective(de,rt,P,T,Xe,qe),J.projectionMatrixInverse.copy(J.projectionMatrix).invert()}}function xe(J,ge){ge===null?J.matrixWorld.copy(J.matrix):J.matrixWorld.multiplyMatrices(ge.matrixWorld,J.matrix),J.matrixWorldInverse.copy(J.matrixWorld).invert()}this.updateCamera=function(J){if(i===null)return;let ge=J.near,ae=J.far;g.texture!==null&&(g.depthNear>0&&(ge=g.depthNear),g.depthFar>0&&(ae=g.depthFar)),L.near=R.near=b.near=ge,L.far=R.far=b.far=ae,(N!==L.near||O!==L.far)&&(i.updateRenderState({depthNear:L.near,depthFar:L.far}),N=L.near,O=L.far),L.layers.mask=J.layers.mask|6,b.layers.mask=L.layers.mask&-5,R.layers.mask=L.layers.mask&-3;let Pe=J.parent,Le=L.cameras;xe(L,Pe);for(let Ne=0;Ne<Le.length;Ne++)xe(Le[Ne],Pe);Le.length===2?oe(L,b,R):L.projectionMatrix.copy(b.projectionMatrix),Ee(J,L,Pe)};function Ee(J,ge,ae){ae===null?J.matrix.copy(ge.matrixWorld):(J.matrix.copy(ae.matrixWorld),J.matrix.invert(),J.matrix.multiply(ge.matrixWorld)),J.matrix.decompose(J.position,J.quaternion,J.scale),J.updateMatrixWorld(!0),J.projectionMatrix.copy(ge.projectionMatrix),J.projectionMatrixInverse.copy(ge.projectionMatrixInverse),J.isPerspectiveCamera&&(J.fov=Pr*2*Math.atan(1/J.projectionMatrix.elements[5]),J.zoom=1)}this.getCamera=function(){return L},this.getFoveation=function(){if(!(h===null&&f===null))return l},this.setFoveation=function(J){l=J,h!==null&&(h.fixedFoveation=J),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=J)},this.hasDepthSensing=function(){return g.texture!==null},this.getDepthSensingMesh=function(){return g.getMesh(L)},this.getCameraTexture=function(J){return m[J]};let ze=null;function Ce(J,ge){if(d=ge.getViewerPose(u||a),p=ge,d!==null){let ae=d.views;f!==null&&(e.setRenderTargetFramebuffer(S,f.framebuffer),e.setRenderTarget(S));let Pe=!1;ae.length!==L.cameras.length&&(L.cameras.length=0,Pe=!0);for(let Ze=0;Ze<ae.length;Ze++){let nt=ae[Ze],st=null;if(f!==null)st=f.getViewport(nt);else{let Ye=o.getViewSubImage(h,nt);st=Ye.viewport,Ze===0&&(e.setRenderTargetTextures(S,Ye.colorTexture,Ye.depthStencilTexture),e.setRenderTarget(S))}let ke=A[Ze];ke===void 0&&(ke=new At,ke.layers.enable(Ze),ke.viewport=new xt,A[Ze]=ke),ke.matrix.fromArray(nt.transform.matrix),ke.matrix.decompose(ke.position,ke.quaternion,ke.scale),ke.projectionMatrix.fromArray(nt.projectionMatrix),ke.projectionMatrixInverse.copy(ke.projectionMatrix).invert(),ke.viewport.set(st.x,st.y,st.width,st.height),Ze===0&&(L.matrix.copy(ke.matrix),L.matrix.decompose(L.position,L.quaternion,L.scale)),Pe===!0&&L.cameras.push(ke)}let Le=i.enabledFeatures;if(Le&&Le.includes("depth-sensing")&&i.depthUsage=="gpu-optimized"&&v){o=n.getBinding();let Ze=o.getDepthInformation(ae[0]);Ze&&Ze.isValid&&Ze.texture&&g.init(Ze,i.renderState)}if(Le&&Le.includes("camera-access")&&v){e.state.unbindTexture(),o=n.getBinding();for(let Ze=0;Ze<ae.length;Ze++){let nt=ae[Ze].camera;if(nt){let st=m[nt];st||(st=new xs,m[nt]=st);let ke=o.getCameraImage(nt);st.sourceTexture=ke}}}}for(let ae=0;ae<w.length;ae++){let Pe=y[ae],Le=w[ae];Pe!==null&&Le!==void 0&&Le.update(Pe,ge,u||a)}ze&&ze(J,ge),ge.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ge}),p=null}let De=new oh;De.setAnimationLoop(Ce),this.setAnimationLoop=function(J){ze=J},this.dispose=function(){}}},Vm=new gt,dh=new We;dh.set(-1,0,0,0,1,0,0,0,1);function km(s,e){function t(g,m){g.matrixAutoUpdate===!0&&g.updateMatrix(),m.value.copy(g.matrix)}function n(g,m){m.color.getRGB(g.fogColor.value,al(s)),m.isFog?(g.fogNear.value=m.near,g.fogFar.value=m.far):m.isFogExp2&&(g.fogDensity.value=m.density)}function i(g,m,M,x,S){m.isNodeMaterial?m.uniformsNeedUpdate=!1:m.isMeshBasicMaterial?r(g,m):m.isMeshLambertMaterial?(r(g,m),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)):m.isMeshToonMaterial?(r(g,m),o(g,m)):m.isMeshPhongMaterial?(r(g,m),d(g,m),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)):m.isMeshStandardMaterial?(r(g,m),h(g,m),m.isMeshPhysicalMaterial&&f(g,m,S)):m.isMeshMatcapMaterial?(r(g,m),p(g,m)):m.isMeshDepthMaterial?r(g,m):m.isMeshDistanceMaterial?(r(g,m),v(g,m)):m.isMeshNormalMaterial?r(g,m):m.isLineBasicMaterial?(a(g,m),m.isLineDashedMaterial&&c(g,m)):m.isPointsMaterial?l(g,m,M,x):m.isSpriteMaterial?u(g,m):m.isShadowMaterial?(g.color.value.copy(m.color),g.opacity.value=m.opacity):m.isShaderMaterial&&(m.uniformsNeedUpdate=!1)}function r(g,m){g.opacity.value=m.opacity,m.color&&g.diffuse.value.copy(m.color),m.emissive&&g.emissive.value.copy(m.emissive).multiplyScalar(m.emissiveIntensity),m.map&&(g.map.value=m.map,t(m.map,g.mapTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,t(m.alphaMap,g.alphaMapTransform)),m.bumpMap&&(g.bumpMap.value=m.bumpMap,t(m.bumpMap,g.bumpMapTransform),g.bumpScale.value=m.bumpScale,m.side===zt&&(g.bumpScale.value*=-1)),m.normalMap&&(g.normalMap.value=m.normalMap,t(m.normalMap,g.normalMapTransform),g.normalScale.value.copy(m.normalScale),m.side===zt&&g.normalScale.value.negate()),m.displacementMap&&(g.displacementMap.value=m.displacementMap,t(m.displacementMap,g.displacementMapTransform),g.displacementScale.value=m.displacementScale,g.displacementBias.value=m.displacementBias),m.emissiveMap&&(g.emissiveMap.value=m.emissiveMap,t(m.emissiveMap,g.emissiveMapTransform)),m.specularMap&&(g.specularMap.value=m.specularMap,t(m.specularMap,g.specularMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest);let M=e.get(m),x=M.envMap,S=M.envMapRotation;x&&(g.envMap.value=x,g.envMapRotation.value.setFromMatrix4(Vm.makeRotationFromEuler(S)).transpose(),x.isCubeTexture&&x.isRenderTargetTexture===!1&&g.envMapRotation.value.premultiply(dh),g.reflectivity.value=m.reflectivity,g.ior.value=m.ior,g.refractionRatio.value=m.refractionRatio),m.lightMap&&(g.lightMap.value=m.lightMap,g.lightMapIntensity.value=m.lightMapIntensity,t(m.lightMap,g.lightMapTransform)),m.aoMap&&(g.aoMap.value=m.aoMap,g.aoMapIntensity.value=m.aoMapIntensity,t(m.aoMap,g.aoMapTransform))}function a(g,m){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,m.map&&(g.map.value=m.map,t(m.map,g.mapTransform))}function c(g,m){g.dashSize.value=m.dashSize,g.totalSize.value=m.dashSize+m.gapSize,g.scale.value=m.scale}function l(g,m,M,x){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,g.size.value=m.size*M,g.scale.value=x*.5,m.map&&(g.map.value=m.map,t(m.map,g.uvTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,t(m.alphaMap,g.alphaMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest)}function u(g,m){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,g.rotation.value=m.rotation,m.map&&(g.map.value=m.map,t(m.map,g.mapTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,t(m.alphaMap,g.alphaMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest)}function d(g,m){g.specular.value.copy(m.specular),g.shininess.value=Math.max(m.shininess,1e-4)}function o(g,m){m.gradientMap&&(g.gradientMap.value=m.gradientMap)}function h(g,m){g.metalness.value=m.metalness,m.metalnessMap&&(g.metalnessMap.value=m.metalnessMap,t(m.metalnessMap,g.metalnessMapTransform)),g.roughness.value=m.roughness,m.roughnessMap&&(g.roughnessMap.value=m.roughnessMap,t(m.roughnessMap,g.roughnessMapTransform)),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)}function f(g,m,M){g.ior.value=m.ior,m.sheen>0&&(g.sheenColor.value.copy(m.sheenColor).multiplyScalar(m.sheen),g.sheenRoughness.value=m.sheenRoughness,m.sheenColorMap&&(g.sheenColorMap.value=m.sheenColorMap,t(m.sheenColorMap,g.sheenColorMapTransform)),m.sheenRoughnessMap&&(g.sheenRoughnessMap.value=m.sheenRoughnessMap,t(m.sheenRoughnessMap,g.sheenRoughnessMapTransform))),m.clearcoat>0&&(g.clearcoat.value=m.clearcoat,g.clearcoatRoughness.value=m.clearcoatRoughness,m.clearcoatMap&&(g.clearcoatMap.value=m.clearcoatMap,t(m.clearcoatMap,g.clearcoatMapTransform)),m.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=m.clearcoatRoughnessMap,t(m.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),m.clearcoatNormalMap&&(g.clearcoatNormalMap.value=m.clearcoatNormalMap,t(m.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(m.clearcoatNormalScale),m.side===zt&&g.clearcoatNormalScale.value.negate())),m.dispersion>0&&(g.dispersion.value=m.dispersion),m.iridescence>0&&(g.iridescence.value=m.iridescence,g.iridescenceIOR.value=m.iridescenceIOR,g.iridescenceThicknessMinimum.value=m.iridescenceThicknessRange[0],g.iridescenceThicknessMaximum.value=m.iridescenceThicknessRange[1],m.iridescenceMap&&(g.iridescenceMap.value=m.iridescenceMap,t(m.iridescenceMap,g.iridescenceMapTransform)),m.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=m.iridescenceThicknessMap,t(m.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),m.transmission>0&&(g.transmission.value=m.transmission,g.transmissionSamplerMap.value=M.texture,g.transmissionSamplerSize.value.set(M.width,M.height),m.transmissionMap&&(g.transmissionMap.value=m.transmissionMap,t(m.transmissionMap,g.transmissionMapTransform)),g.thickness.value=m.thickness,m.thicknessMap&&(g.thicknessMap.value=m.thicknessMap,t(m.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=m.attenuationDistance,g.attenuationColor.value.copy(m.attenuationColor)),m.anisotropy>0&&(g.anisotropyVector.value.set(m.anisotropy*Math.cos(m.anisotropyRotation),m.anisotropy*Math.sin(m.anisotropyRotation)),m.anisotropyMap&&(g.anisotropyMap.value=m.anisotropyMap,t(m.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=m.specularIntensity,g.specularColor.value.copy(m.specularColor),m.specularColorMap&&(g.specularColorMap.value=m.specularColorMap,t(m.specularColorMap,g.specularColorMapTransform)),m.specularIntensityMap&&(g.specularIntensityMap.value=m.specularIntensityMap,t(m.specularIntensityMap,g.specularIntensityMapTransform))}function p(g,m){m.matcap&&(g.matcap.value=m.matcap)}function v(g,m){let M=e.get(m).light;g.referencePosition.value.setFromMatrixPosition(M.matrixWorld),g.nearDistance.value=M.shadow.camera.near,g.farDistance.value=M.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:i}}function Gm(s,e,t,n){let i={},r={},a=[],c=s.getParameter(s.MAX_UNIFORM_BUFFER_BINDINGS);function l(M,x){let S=x.program;n.uniformBlockBinding(M,S)}function u(M,x){let S=i[M.id];S===void 0&&(p(M),S=d(M),i[M.id]=S,M.addEventListener("dispose",g));let w=x.program;n.updateUBOMapping(M,w);let y=e.render.frame;r[M.id]!==y&&(h(M),r[M.id]=y)}function d(M){let x=o();M.__bindingPointIndex=x;let S=s.createBuffer(),w=M.__size,y=M.usage;return s.bindBuffer(s.UNIFORM_BUFFER,S),s.bufferData(s.UNIFORM_BUFFER,w,y),s.bindBuffer(s.UNIFORM_BUFFER,null),s.bindBufferBase(s.UNIFORM_BUFFER,x,S),S}function o(){for(let M=0;M<c;M++)if(a.indexOf(M)===-1)return a.push(M),M;return Be("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(M){let x=i[M.id],S=M.uniforms,w=M.__cache;s.bindBuffer(s.UNIFORM_BUFFER,x);for(let y=0,E=S.length;y<E;y++){let _=Array.isArray(S[y])?S[y]:[S[y]];for(let b=0,R=_.length;b<R;b++){let A=_[b];if(f(A,y,b,w)===!0){let L=A.__offset,N=Array.isArray(A.value)?A.value:[A.value],O=0;for(let D=0;D<N.length;D++){let F=N[D],k=v(F);typeof F=="number"||typeof F=="boolean"?(A.__data[0]=F,s.bufferSubData(s.UNIFORM_BUFFER,L+O,A.__data)):F.isMatrix3?(A.__data[0]=F.elements[0],A.__data[1]=F.elements[1],A.__data[2]=F.elements[2],A.__data[3]=0,A.__data[4]=F.elements[3],A.__data[5]=F.elements[4],A.__data[6]=F.elements[5],A.__data[7]=0,A.__data[8]=F.elements[6],A.__data[9]=F.elements[7],A.__data[10]=F.elements[8],A.__data[11]=0):ArrayBuffer.isView(F)?A.__data.set(new F.constructor(F.buffer,F.byteOffset,A.__data.length)):(F.toArray(A.__data,O),O+=k.storage/Float32Array.BYTES_PER_ELEMENT)}s.bufferSubData(s.UNIFORM_BUFFER,L,A.__data)}}}s.bindBuffer(s.UNIFORM_BUFFER,null)}function f(M,x,S,w){let y=M.value,E=x+"_"+S;if(w[E]===void 0)return typeof y=="number"||typeof y=="boolean"?w[E]=y:ArrayBuffer.isView(y)?w[E]=y.slice():w[E]=y.clone(),!0;{let _=w[E];if(typeof y=="number"||typeof y=="boolean"){if(_!==y)return w[E]=y,!0}else{if(ArrayBuffer.isView(y))return!0;if(_.equals(y)===!1)return _.copy(y),!0}}return!1}function p(M){let x=M.uniforms,S=0,w=16;for(let E=0,_=x.length;E<_;E++){let b=Array.isArray(x[E])?x[E]:[x[E]];for(let R=0,A=b.length;R<A;R++){let L=b[R],N=Array.isArray(L.value)?L.value:[L.value];for(let O=0,D=N.length;O<D;O++){let F=N[O],k=v(F),Q=S%w,ie=Q%k.boundary,oe=Q+ie;S+=ie,oe!==0&&w-oe<k.storage&&(S+=w-oe),L.__data=new Float32Array(k.storage/Float32Array.BYTES_PER_ELEMENT),L.__offset=S,S+=k.storage}}}let y=S%w;return y>0&&(S+=w-y),M.__size=S,M.__cache={},this}function v(M){let x={boundary:0,storage:0};return typeof M=="number"||typeof M=="boolean"?(x.boundary=4,x.storage=4):M.isVector2?(x.boundary=8,x.storage=8):M.isVector3||M.isColor?(x.boundary=16,x.storage=12):M.isVector4?(x.boundary=16,x.storage=16):M.isMatrix3?(x.boundary=48,x.storage=48):M.isMatrix4?(x.boundary=64,x.storage=64):M.isTexture?Fe("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(M)?(x.boundary=16,x.storage=M.byteLength):Fe("WebGLRenderer: Unsupported uniform value type.",M),x}function g(M){let x=M.target;x.removeEventListener("dispose",g);let S=a.indexOf(x.__bindingPointIndex);a.splice(S,1),s.deleteBuffer(i[x.id]),delete i[x.id],delete r[x.id]}function m(){for(let M in i)s.deleteBuffer(i[M]);a=[],i={},r={}}return{bind:l,update:u,dispose:m}}var Hm=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Sn=null;function Wm(){return Sn===null&&(Sn=new Ur(Hm,16,16,ii,yn),Sn.name="DFG_LUT",Sn.minFilter=Ct,Sn.magFilter=Ct,Sn.wrapS=gn,Sn.wrapT=gn,Sn.generateMipmaps=!1,Sn.needsUpdate=!0),Sn}var $a=class{constructor(e={}){let{canvas:t=Lc(),context:n=null,depth:i=!0,stencil:r=!1,alpha:a=!1,antialias:c=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:u=!1,powerPreference:d="default",failIfMajorPerformanceCaveat:o=!1,reversedDepthBuffer:h=!1,outputBufferType:f=Gt}=e;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=n.getContextAttributes().alpha}else p=a;let v=f,g=new Set([fa,ua,ha]),m=new Set([Gt,un,Gi,Hi,la,ca]),M=new Uint32Array(4),x=new Int32Array(4),S=new H,w=null,y=null,E=[],_=[],b=null;this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=hn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let R=this,A=!1,L=null;this._outputColorSpace=bt;let N=0,O=0,D=null,F=-1,k=null,Q=new xt,ie=new xt,oe=null,xe=new Ke(0),Ee=0,ze=t.width,Ce=t.height,De=1,J=null,ge=null,ae=new xt(0,0,ze,Ce),Pe=new xt(0,0,ze,Ce),Le=!1,Ne=new Bi,at=!1,Ze=!1,nt=new gt,st=new H,ke=new xt,Ye={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},lt=!1;function ft(){return D===null?De:1}let z=n;function ut(C,V){return t.getContext(C,V)}try{let C={alpha:!0,depth:i,stencil:r,antialias:c,premultipliedAlpha:l,preserveDrawingBuffer:u,powerPreference:d,failIfMajorPerformanceCaveat:o};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${na}`),t.addEventListener("webglcontextlost",ne,!1),t.addEventListener("webglcontextrestored",Ae,!1),t.addEventListener("webglcontextcreationerror",Ge,!1),z===null){let V="webgl2";if(z=ut(V,C),z===null)throw ut(V)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(C){throw Be("WebGLRenderer: "+C.message),C}let Xe,qe,de,rt,P,T,G,j,se,he,pe,K,ee,ve,we,me,ue,Ve,Ue,He,U,le,$;function _e(){Xe=new Kd(z),Xe.init(),U=new Om(z,Xe),qe=new Hd(z,Xe,e,U),de=new Nm(z,Xe),qe.reversedDepthBuffer&&h&&de.buffers.depth.setReversed(!0),rt=new ep(z),P=new Sm,T=new Fm(z,Xe,de,P,qe,U,rt),G=new $d(R),j=new iu(z),le=new kd(z,j),se=new Qd(z,j,rt,le),he=new np(z,se,j,le,rt),Ve=new tp(z,qe,T),we=new Wd(P),pe=new ym(R,G,Xe,qe,le,we),K=new km(R,P),ee=new bm,ve=new Rm(Xe),ue=new Vd(R,G,de,he,p,l),me=new Um(R,he,qe),$=new Gm(z,rt,qe,de),Ue=new Gd(z,Xe,rt),He=new jd(z,Xe,rt),rt.programs=pe.programs,R.capabilities=qe,R.extensions=Xe,R.properties=P,R.renderLists=ee,R.shadowMap=me,R.state=de,R.info=rt}_e(),v!==Gt&&(b=new sp(v,t.width,t.height,i,r));let fe=new Rl(R,z);this.xr=fe,this.getContext=function(){return z},this.getContextAttributes=function(){return z.getContextAttributes()},this.forceContextLoss=function(){let C=Xe.get("WEBGL_lose_context");C&&C.loseContext()},this.forceContextRestore=function(){let C=Xe.get("WEBGL_lose_context");C&&C.restoreContext()},this.getPixelRatio=function(){return De},this.setPixelRatio=function(C){C!==void 0&&(De=C,this.setSize(ze,Ce,!1))},this.getSize=function(C){return C.set(ze,Ce)},this.setSize=function(C,V,Y=!0){if(fe.isPresenting){Fe("WebGLRenderer: Can't change size while VR device is presenting.");return}ze=C,Ce=V,t.width=Math.floor(C*De),t.height=Math.floor(V*De),Y===!0&&(t.style.width=C+"px",t.style.height=V+"px"),b!==null&&b.setSize(t.width,t.height),this.setViewport(0,0,C,V)},this.getDrawingBufferSize=function(C){return C.set(ze*De,Ce*De).floor()},this.setDrawingBufferSize=function(C,V,Y){ze=C,Ce=V,De=Y,t.width=Math.floor(C*Y),t.height=Math.floor(V*Y),this.setViewport(0,0,C,V)},this.setEffects=function(C){if(v===Gt){Be("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(C){for(let V=0;V<C.length;V++)if(C[V].isOutputPass===!0){Fe("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}b.setEffects(C||[])},this.getCurrentViewport=function(C){return C.copy(Q)},this.getViewport=function(C){return C.copy(ae)},this.setViewport=function(C,V,Y,q){C.isVector4?ae.set(C.x,C.y,C.z,C.w):ae.set(C,V,Y,q),de.viewport(Q.copy(ae).multiplyScalar(De).round())},this.getScissor=function(C){return C.copy(Pe)},this.setScissor=function(C,V,Y,q){C.isVector4?Pe.set(C.x,C.y,C.z,C.w):Pe.set(C,V,Y,q),de.scissor(ie.copy(Pe).multiplyScalar(De).round())},this.getScissorTest=function(){return Le},this.setScissorTest=function(C){de.setScissorTest(Le=C)},this.setOpaqueSort=function(C){J=C},this.setTransparentSort=function(C){ge=C},this.getClearColor=function(C){return C.copy(ue.getClearColor())},this.setClearColor=function(){ue.setClearColor(...arguments)},this.getClearAlpha=function(){return ue.getClearAlpha()},this.setClearAlpha=function(){ue.setClearAlpha(...arguments)},this.clear=function(C=!0,V=!0,Y=!0){let q=0;if(C){let W=!1;if(D!==null){let Se=D.texture.format;W=g.has(Se)}if(W){let Se=D.texture.type,Te=m.has(Se),ye=ue.getClearColor(),Re=ue.getClearAlpha(),Ie=ye.r,I=ye.g,B=ye.b;Te?(M[0]=Ie,M[1]=I,M[2]=B,M[3]=Re,z.clearBufferuiv(z.COLOR,0,M)):(x[0]=Ie,x[1]=I,x[2]=B,x[3]=Re,z.clearBufferiv(z.COLOR,0,x))}else q|=z.COLOR_BUFFER_BIT}V&&(q|=z.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),Y&&(q|=z.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),q!==0&&z.clear(q)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(C){C.setRenderer(this),L=C},this.dispose=function(){t.removeEventListener("webglcontextlost",ne,!1),t.removeEventListener("webglcontextrestored",Ae,!1),t.removeEventListener("webglcontextcreationerror",Ge,!1),ue.dispose(),ee.dispose(),ve.dispose(),P.dispose(),G.dispose(),he.dispose(),le.dispose(),$.dispose(),pe.dispose(),fe.dispose(),fe.removeEventListener("sessionstart",_t),fe.removeEventListener("sessionend",Yi),dn.stop()};function ne(C){C.preventDefault(),rl("WebGLRenderer: Context Lost."),A=!0}function Ae(){rl("WebGLRenderer: Context Restored."),A=!1;let C=rt.autoReset,V=me.enabled,Y=me.autoUpdate,q=me.needsUpdate,W=me.type;_e(),rt.autoReset=C,me.enabled=V,me.autoUpdate=Y,me.needsUpdate=q,me.type=W}function Ge(C){Be("WebGLRenderer: A WebGL context could not be created. Reason: ",C.statusMessage)}function ot(C){let V=C.target;V.removeEventListener("dispose",ot),it(V)}function it(C){Et(C),P.remove(C)}function Et(C){let V=P.get(C).programs;V!==void 0&&(V.forEach(function(Y){pe.releaseProgram(Y)}),C.isShaderMaterial&&pe.releaseShaderCache(C))}this.renderBufferDirect=function(C,V,Y,q,W,Se){V===null&&(V=Ye);let Te=W.isMesh&&W.matrixWorld.determinant()<0,ye=$i(C,V,Y,q,W);de.setMaterial(q,Te);let Re=Y.index,Ie=1;if(q.wireframe===!0){if(Re=se.getWireframeAttribute(Y),Re===void 0)return;Ie=2}let I=Y.drawRange,B=Y.attributes.position,X=I.start*Ie,Z=(I.start+I.count)*Ie;Se!==null&&(X=Math.max(X,Se.start*Ie),Z=Math.min(Z,(Se.start+Se.count)*Ie)),Re!==null?(X=Math.max(X,0),Z=Math.min(Z,Re.count)):B!=null&&(X=Math.max(X,0),Z=Math.min(Z,B.count));let re=Z-X;if(re<0||re===1/0)return;le.setup(W,q,ye,Y,Re);let te,ce=Ue;if(Re!==null&&(te=j.get(Re),ce=He,ce.setIndex(te)),W.isMesh)q.wireframe===!0?(de.setLineWidth(q.wireframeLinewidth*ft()),ce.setMode(z.LINES)):ce.setMode(z.TRIANGLES);else if(W.isLine){let Oe=q.linewidth;Oe===void 0&&(Oe=1),de.setLineWidth(Oe*ft()),W.isLineSegments?ce.setMode(z.LINES):W.isLineLoop?ce.setMode(z.LINE_LOOP):ce.setMode(z.LINE_STRIP)}else W.isPoints?ce.setMode(z.POINTS):W.isSprite&&ce.setMode(z.TRIANGLES);if(W.isBatchedMesh)if(Xe.get("WEBGL_multi_draw"))ce.renderMultiDraw(W._multiDrawStarts,W._multiDrawCounts,W._multiDrawCount);else{let Oe=W._multiDrawStarts,Me=W._multiDrawCounts,Lt=W._multiDrawCount,Qe=Re?j.get(Re).bytesPerElement:1,Dt=P.get(q).currentProgram.getUniforms();for(let Ht=0;Ht<Lt;Ht++)Dt.setValue(z,"_gl_DrawID",Ht),ce.render(Oe[Ht]/Qe,Me[Ht])}else if(W.isInstancedMesh)ce.renderInstances(X,re,W.count);else if(Y.isInstancedBufferGeometry){let Oe=Y._maxInstanceCount!==void 0?Y._maxInstanceCount:1/0,Me=Math.min(Y.instanceCount,Oe);ce.renderInstances(X,re,Me)}else ce.render(X,re)};function Ot(C,V,Y){C.transparent===!0&&C.side===nn&&C.forceSinglePass===!1?(C.side=zt,C.needsUpdate=!0,ri(C,V,Y),C.side=In,C.needsUpdate=!0,ri(C,V,Y),C.side=nn):ri(C,V,Y)}this.compile=function(C,V,Y=null){Y===null&&(Y=C),y=ve.get(Y),y.init(V),_.push(y),Y.traverseVisible(function(W){W.isLight&&W.layers.test(V.layers)&&(y.pushLight(W),W.castShadow&&y.pushShadow(W))}),C!==Y&&C.traverseVisible(function(W){W.isLight&&W.layers.test(V.layers)&&(y.pushLight(W),W.castShadow&&y.pushShadow(W))}),y.setupLights();let q=new Set;return C.traverse(function(W){if(!(W.isMesh||W.isPoints||W.isLine||W.isSprite))return;let Se=W.material;if(Se)if(Array.isArray(Se))for(let Te=0;Te<Se.length;Te++){let ye=Se[Te];Ot(ye,Y,W),q.add(ye)}else Ot(Se,Y,W),q.add(Se)}),y=_.pop(),q},this.compileAsync=function(C,V,Y=null){let q=this.compile(C,V,Y);return new Promise(W=>{function Se(){if(q.forEach(function(Te){P.get(Te).currentProgram.isReady()&&q.delete(Te)}),q.size===0){W(C);return}setTimeout(Se,10)}Xe.get("KHR_parallel_shader_compile")!==null?Se():setTimeout(Se,10)})};let Fn=null;function On(C){Fn&&Fn(C)}function _t(){dn.stop()}function Yi(){dn.start()}let dn=new oh;dn.setAnimationLoop(On),typeof self<"u"&&dn.setContext(self),this.setAnimationLoop=function(C){Fn=C,fe.setAnimationLoop(C),C===null?dn.stop():dn.start()},fe.addEventListener("sessionstart",_t),fe.addEventListener("sessionend",Yi),this.render=function(C,V){if(V!==void 0&&V.isCamera!==!0){Be("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(A===!0)return;L!==null&&L.renderStart(C,V);let Y=fe.enabled===!0&&fe.isPresenting===!0,q=b!==null&&(D===null||Y)&&b.begin(R,D);if(C.matrixWorldAutoUpdate===!0&&C.updateMatrixWorld(),V.parent===null&&V.matrixWorldAutoUpdate===!0&&V.updateMatrixWorld(),fe.enabled===!0&&fe.isPresenting===!0&&(b===null||b.isCompositing()===!1)&&(fe.cameraAutoUpdate===!0&&fe.updateCamera(V),V=fe.getCamera()),C.isScene===!0&&C.onBeforeRender(R,C,V,D),y=ve.get(C,_.length),y.init(V),y.state.textureUnits=T.getTextureUnits(),_.push(y),nt.multiplyMatrices(V.projectionMatrix,V.matrixWorldInverse),Ne.setFromProjectionMatrix(nt,cn,V.reversedDepth),Ze=this.localClippingEnabled,at=we.init(this.clippingPlanes,Ze),w=ee.get(C,E.length),w.init(),E.push(w),fe.enabled===!0&&fe.isPresenting===!0){let Te=R.xr.getDepthSensingMesh();Te!==null&&vi(Te,V,-1/0,R.sortObjects)}vi(C,V,0,R.sortObjects),w.finish(),R.sortObjects===!0&&w.sort(J,ge),lt=fe.enabled===!1||fe.isPresenting===!1||fe.hasDepthSensing()===!1,lt&&ue.addToRenderList(w,C),this.info.render.frame++,at===!0&&we.beginShadows();let W=y.state.shadowsArray;if(me.render(W,C,V),at===!0&&we.endShadows(),this.info.autoReset===!0&&this.info.reset(),(q&&b.hasRenderPass())===!1){let Te=w.opaque,ye=w.transmissive;if(y.setupLights(),V.isArrayCamera){let Re=V.cameras;if(ye.length>0)for(let Ie=0,I=Re.length;Ie<I;Ie++){let B=Re[Ie];rn(Te,ye,C,B)}lt&&ue.render(C);for(let Ie=0,I=Re.length;Ie<I;Ie++){let B=Re[Ie];Hs(w,C,B,B.viewport)}}else ye.length>0&&rn(Te,ye,C,V),lt&&ue.render(C),Hs(w,C,V)}D!==null&&O===0&&(T.updateMultisampleRenderTarget(D),T.updateRenderTargetMipmap(D)),q&&b.end(R),C.isScene===!0&&C.onAfterRender(R,C,V),le.resetDefaultState(),F=-1,k=null,_.pop(),_.length>0?(y=_[_.length-1],T.setTextureUnits(y.state.textureUnits),at===!0&&we.setGlobalState(R.clippingPlanes,y.state.camera)):y=null,E.pop(),E.length>0?w=E[E.length-1]:w=null,L!==null&&L.renderEnd()};function vi(C,V,Y,q){if(C.visible===!1)return;if(C.layers.test(V.layers)){if(C.isGroup)Y=C.renderOrder;else if(C.isLOD)C.autoUpdate===!0&&C.update(V);else if(C.isLightProbeGrid)y.pushLightProbeGrid(C);else if(C.isLight)y.pushLight(C),C.castShadow&&y.pushShadow(C);else if(C.isSprite){if(!C.frustumCulled||Ne.intersectsSprite(C)){q&&ke.setFromMatrixPosition(C.matrixWorld).applyMatrix4(nt);let Te=he.update(C),ye=C.material;ye.visible&&w.push(C,Te,ye,Y,ke.z,null)}}else if((C.isMesh||C.isLine||C.isPoints)&&(!C.frustumCulled||Ne.intersectsObject(C))){let Te=he.update(C),ye=C.material;if(q&&(C.boundingSphere!==void 0?(C.boundingSphere===null&&C.computeBoundingSphere(),ke.copy(C.boundingSphere.center)):(Te.boundingSphere===null&&Te.computeBoundingSphere(),ke.copy(Te.boundingSphere.center)),ke.applyMatrix4(C.matrixWorld).applyMatrix4(nt)),Array.isArray(ye)){let Re=Te.groups;for(let Ie=0,I=Re.length;Ie<I;Ie++){let B=Re[Ie],X=ye[B.materialIndex];X&&X.visible&&w.push(C,Te,X,Y,ke.z,B)}}else ye.visible&&w.push(C,Te,ye,Y,ke.z,null)}}let Se=C.children;for(let Te=0,ye=Se.length;Te<ye;Te++)vi(Se[Te],V,Y,q)}function Hs(C,V,Y,q){let{opaque:W,transmissive:Se,transparent:Te}=C;y.setupLightsView(Y),at===!0&&we.setGlobalState(R.clippingPlanes,Y),q&&de.viewport(Q.copy(q)),W.length>0&&Bn(W,V,Y),Se.length>0&&Bn(Se,V,Y),Te.length>0&&Bn(Te,V,Y),de.buffers.depth.setTest(!0),de.buffers.depth.setMask(!0),de.buffers.color.setMask(!0),de.setPolygonOffset(!1)}function rn(C,V,Y,q){if((Y.isScene===!0?Y.overrideMaterial:null)!==null)return;if(y.state.transmissionRenderTarget[q.id]===void 0){let X=Xe.has("EXT_color_buffer_half_float")||Xe.has("EXT_color_buffer_float");y.state.transmissionRenderTarget[q.id]=new Yt(1,1,{generateMipmaps:!0,type:X?yn:Gt,minFilter:ti,samples:Math.max(4,qe.samples),stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:et.workingColorSpace})}let Se=y.state.transmissionRenderTarget[q.id],Te=q.viewport||Q;Se.setSize(Te.z*R.transmissionResolutionScale,Te.w*R.transmissionResolutionScale);let ye=R.getRenderTarget(),Re=R.getActiveCubeFace(),Ie=R.getActiveMipmapLevel();R.setRenderTarget(Se),R.getClearColor(xe),Ee=R.getClearAlpha(),Ee<1&&R.setClearColor(16777215,.5),R.clear(),lt&&ue.render(Y);let I=R.toneMapping;R.toneMapping=hn;let B=q.viewport;if(q.viewport!==void 0&&(q.viewport=void 0),y.setupLightsView(q),at===!0&&we.setGlobalState(R.clippingPlanes,q),Bn(C,Y,q),T.updateMultisampleRenderTarget(Se),T.updateRenderTargetMipmap(Se),Xe.has("WEBGL_multisampled_render_to_texture")===!1){let X=!1;for(let Z=0,re=V.length;Z<re;Z++){let te=V[Z],{object:ce,geometry:Oe,material:Me,group:Lt}=te;if(Me.side===nn&&ce.layers.test(q.layers)){let Qe=Me.side;Me.side=zt,Me.needsUpdate=!0,Zi(ce,Y,q,Oe,Me,Lt),Me.side=Qe,Me.needsUpdate=!0,X=!0}}X===!0&&(T.updateMultisampleRenderTarget(Se),T.updateRenderTargetMipmap(Se))}R.setRenderTarget(ye,Re,Ie),R.setClearColor(xe,Ee),B!==void 0&&(q.viewport=B),R.toneMapping=I}function Bn(C,V,Y){let q=V.isScene===!0?V.overrideMaterial:null;for(let W=0,Se=C.length;W<Se;W++){let Te=C[W],{object:ye,geometry:Re,group:Ie}=Te,I=Te.material;I.allowOverride===!0&&q!==null&&(I=q),ye.layers.test(Y.layers)&&Zi(ye,V,Y,Re,I,Ie)}}function Zi(C,V,Y,q,W,Se){C.onBeforeRender(R,V,Y,q,W,Se),C.modelViewMatrix.multiplyMatrices(Y.matrixWorldInverse,C.matrixWorld),C.normalMatrix.getNormalMatrix(C.modelViewMatrix),W.onBeforeRender(R,V,Y,q,C,Se),W.transparent===!0&&W.side===nn&&W.forceSinglePass===!1?(W.side=zt,W.needsUpdate=!0,R.renderBufferDirect(Y,V,q,W,C,Se),W.side=In,W.needsUpdate=!0,R.renderBufferDirect(Y,V,q,W,C,Se),W.side=nn):R.renderBufferDirect(Y,V,q,W,C,Se),C.onAfterRender(R,V,Y,q,W,Se)}function ri(C,V,Y){V.isScene!==!0&&(V=Ye);let q=P.get(C),W=y.state.lights,Se=y.state.shadowsArray,Te=W.state.version,ye=pe.getParameters(C,W.state,Se,V,Y,y.state.lightProbeGridArray),Re=pe.getProgramCacheKey(ye),Ie=q.programs;q.environment=C.isMeshStandardMaterial||C.isMeshLambertMaterial||C.isMeshPhongMaterial?V.environment:null,q.fog=V.fog;let I=C.isMeshStandardMaterial||C.isMeshLambertMaterial&&!C.envMap||C.isMeshPhongMaterial&&!C.envMap;q.envMap=G.get(C.envMap||q.environment,I),q.envMapRotation=q.environment!==null&&C.envMap===null?V.environmentRotation:C.envMapRotation,Ie===void 0&&(C.addEventListener("dispose",ot),Ie=new Map,q.programs=Ie);let B=Ie.get(Re);if(B!==void 0){if(q.currentProgram===B&&q.lightsStateVersion===Te)return Ji(C,ye),B}else ye.uniforms=pe.getUniforms(C),L!==null&&C.isNodeMaterial&&L.build(C,Y,ye),C.onBeforeCompile(ye,R),B=pe.acquireProgram(ye,Re),Ie.set(Re,B),q.uniforms=ye.uniforms;let X=q.uniforms;return(!C.isShaderMaterial&&!C.isRawShaderMaterial||C.clipping===!0)&&(X.clippingPlanes=we.uniform),Ji(C,ye),q.needsLights=qs(C),q.lightsStateVersion=Te,q.needsLights&&(X.ambientLightColor.value=W.state.ambient,X.lightProbe.value=W.state.probe,X.directionalLights.value=W.state.directional,X.directionalLightShadows.value=W.state.directionalShadow,X.spotLights.value=W.state.spot,X.spotLightShadows.value=W.state.spotShadow,X.rectAreaLights.value=W.state.rectArea,X.ltc_1.value=W.state.rectAreaLTC1,X.ltc_2.value=W.state.rectAreaLTC2,X.pointLights.value=W.state.point,X.pointLightShadows.value=W.state.pointShadow,X.hemisphereLights.value=W.state.hemi,X.directionalShadowMatrix.value=W.state.directionalShadowMatrix,X.spotLightMatrix.value=W.state.spotLightMatrix,X.spotLightMap.value=W.state.spotLightMap,X.pointShadowMatrix.value=W.state.pointShadowMatrix),q.lightProbeGrid=y.state.lightProbeGridArray.length>0,q.currentProgram=B,q.uniformsList=null,B}function zn(C){if(C.uniformsList===null){let V=C.currentProgram.getUniforms();C.uniformsList=Xi.seqWithValue(V.seq,C.uniforms)}return C.uniformsList}function Ji(C,V){let Y=P.get(C);Y.outputColorSpace=V.outputColorSpace,Y.batching=V.batching,Y.batchingColor=V.batchingColor,Y.instancing=V.instancing,Y.instancingColor=V.instancingColor,Y.instancingMorph=V.instancingMorph,Y.skinning=V.skinning,Y.morphTargets=V.morphTargets,Y.morphNormals=V.morphNormals,Y.morphColors=V.morphColors,Y.morphTargetsCount=V.morphTargetsCount,Y.numClippingPlanes=V.numClippingPlanes,Y.numIntersection=V.numClipIntersection,Y.vertexAlphas=V.vertexAlphas,Y.vertexTangents=V.vertexTangents,Y.toneMapping=V.toneMapping}function Ws(C,V){if(C.length===0)return null;if(C.length===1)return C[0].texture!==null?C[0]:null;S.setFromMatrixPosition(V.matrixWorld);for(let Y=0,q=C.length;Y<q;Y++){let W=C[Y];if(W.texture!==null&&W.boundingBox.containsPoint(S))return W}return null}function $i(C,V,Y,q,W){V.isScene!==!0&&(V=Ye),T.resetTextureUnits();let Se=V.fog,Te=q.isMeshStandardMaterial||q.isMeshLambertMaterial||q.isMeshPhongMaterial?V.environment:null,ye=D===null?R.outputColorSpace:D.isXRRenderTarget===!0?D.texture.colorSpace:et.workingColorSpace,Re=q.isMeshStandardMaterial||q.isMeshLambertMaterial&&!q.envMap||q.isMeshPhongMaterial&&!q.envMap,Ie=G.get(q.envMap||Te,Re),I=q.vertexColors===!0&&!!Y.attributes.color&&Y.attributes.color.itemSize===4,B=!!Y.attributes.tangent&&(!!q.normalMap||q.anisotropy>0),X=!!Y.morphAttributes.position,Z=!!Y.morphAttributes.normal,re=!!Y.morphAttributes.color,te=hn;q.toneMapped&&(D===null||D.isXRRenderTarget===!0)&&(te=R.toneMapping);let ce=Y.morphAttributes.position||Y.morphAttributes.normal||Y.morphAttributes.color,Oe=ce!==void 0?ce.length:0,Me=P.get(q),Lt=y.state.lights;if(at===!0&&(Ze===!0||C!==k)){let ct=C===k&&q.id===F;we.setState(q,C,ct)}let Qe=!1;q.version===Me.__version?(Me.needsLights&&Me.lightsStateVersion!==Lt.state.version||Me.outputColorSpace!==ye||W.isBatchedMesh&&Me.batching===!1||!W.isBatchedMesh&&Me.batching===!0||W.isBatchedMesh&&Me.batchingColor===!0&&W.colorTexture===null||W.isBatchedMesh&&Me.batchingColor===!1&&W.colorTexture!==null||W.isInstancedMesh&&Me.instancing===!1||!W.isInstancedMesh&&Me.instancing===!0||W.isSkinnedMesh&&Me.skinning===!1||!W.isSkinnedMesh&&Me.skinning===!0||W.isInstancedMesh&&Me.instancingColor===!0&&W.instanceColor===null||W.isInstancedMesh&&Me.instancingColor===!1&&W.instanceColor!==null||W.isInstancedMesh&&Me.instancingMorph===!0&&W.morphTexture===null||W.isInstancedMesh&&Me.instancingMorph===!1&&W.morphTexture!==null||Me.envMap!==Ie||q.fog===!0&&Me.fog!==Se||Me.numClippingPlanes!==void 0&&(Me.numClippingPlanes!==we.numPlanes||Me.numIntersection!==we.numIntersection)||Me.vertexAlphas!==I||Me.vertexTangents!==B||Me.morphTargets!==X||Me.morphNormals!==Z||Me.morphColors!==re||Me.toneMapping!==te||Me.morphTargetsCount!==Oe||!!Me.lightProbeGrid!=y.state.lightProbeGridArray.length>0)&&(Qe=!0):(Qe=!0,Me.__version=q.version);let Dt=Me.currentProgram;Qe===!0&&(Dt=ri(q,V,W),L&&q.isNodeMaterial&&L.onUpdateProgram(q,Dt,Me));let Ht=!1,Vt=!1,$t=!1,je=Dt.getUniforms(),dt=Me.uniforms;if(de.useProgram(Dt.program)&&(Ht=!0,Vt=!0,$t=!0),q.id!==F&&(F=q.id,Vt=!0),Me.needsLights){let ct=Ws(y.state.lightProbeGridArray,W);Me.lightProbeGrid!==ct&&(Me.lightProbeGrid=ct,Vt=!0)}if(Ht||k!==C){de.buffers.depth.getReversed()&&C.reversedDepth!==!0&&(C._reversedDepth=!0,C.updateProjectionMatrix()),je.setValue(z,"projectionMatrix",C.projectionMatrix),je.setValue(z,"viewMatrix",C.matrixWorldInverse);let Qt=je.map.cameraPosition;Qt!==void 0&&Qt.setValue(z,st.setFromMatrixPosition(C.matrixWorld)),qe.logarithmicDepthBuffer&&je.setValue(z,"logDepthBufFC",2/(Math.log(C.far+1)/Math.LN2)),(q.isMeshPhongMaterial||q.isMeshToonMaterial||q.isMeshLambertMaterial||q.isMeshBasicMaterial||q.isMeshStandardMaterial||q.isShaderMaterial)&&je.setValue(z,"isOrthographic",C.isOrthographicCamera===!0),k!==C&&(k=C,Vt=!0,$t=!0)}if(Me.needsLights&&(Lt.state.directionalShadowMap.length>0&&je.setValue(z,"directionalShadowMap",Lt.state.directionalShadowMap,T),Lt.state.spotShadowMap.length>0&&je.setValue(z,"spotShadowMap",Lt.state.spotShadowMap,T),Lt.state.pointShadowMap.length>0&&je.setValue(z,"pointShadowMap",Lt.state.pointShadowMap,T)),W.isSkinnedMesh){je.setOptional(z,W,"bindMatrix"),je.setOptional(z,W,"bindMatrixInverse");let ct=W.skeleton;ct&&(ct.boneTexture===null&&ct.computeBoneTexture(),je.setValue(z,"boneTexture",ct.boneTexture,T))}W.isBatchedMesh&&(je.setOptional(z,W,"batchingTexture"),je.setValue(z,"batchingTexture",W._matricesTexture,T),je.setOptional(z,W,"batchingIdTexture"),je.setValue(z,"batchingIdTexture",W._indirectTexture,T),je.setOptional(z,W,"batchingColorTexture"),W._colorsTexture!==null&&je.setValue(z,"batchingColorTexture",W._colorsTexture,T));let Kt=Y.morphAttributes;if((Kt.position!==void 0||Kt.normal!==void 0||Kt.color!==void 0)&&Ve.update(W,Y,Dt),(Vt||Me.receiveShadow!==W.receiveShadow)&&(Me.receiveShadow=W.receiveShadow,je.setValue(z,"receiveShadow",W.receiveShadow)),(q.isMeshStandardMaterial||q.isMeshLambertMaterial||q.isMeshPhongMaterial)&&q.envMap===null&&V.environment!==null&&(dt.envMapIntensity.value=V.environmentIntensity),dt.dfgLUT!==void 0&&(dt.dfgLUT.value=Wm()),Vt){if(je.setValue(z,"toneMappingExposure",R.toneMappingExposure),Me.needsLights&&Xs(dt,$t),Se&&q.fog===!0&&K.refreshFogUniforms(dt,Se),K.refreshMaterialUniforms(dt,q,De,Ce,y.state.transmissionRenderTarget[C.id]),Me.needsLights&&Me.lightProbeGrid){let ct=Me.lightProbeGrid;dt.probesSH.value=ct.texture,dt.probesMin.value.copy(ct.boundingBox.min),dt.probesMax.value.copy(ct.boundingBox.max),dt.probesResolution.value.copy(ct.resolution)}Xi.upload(z,zn(Me),dt,T)}if(q.isShaderMaterial&&q.uniformsNeedUpdate===!0&&(Xi.upload(z,zn(Me),dt,T),q.uniformsNeedUpdate=!1),q.isSpriteMaterial&&je.setValue(z,"center",W.center),je.setValue(z,"modelViewMatrix",W.modelViewMatrix),je.setValue(z,"normalMatrix",W.normalMatrix),je.setValue(z,"modelMatrix",W.matrixWorld),q.uniformsGroups!==void 0){let ct=q.uniformsGroups;for(let Qt=0,bn=ct.length;Qt<bn;Qt++){let _i=ct[Qt];$.update(_i,Dt),$.bind(_i,Dt)}}return Dt}function Xs(C,V){C.ambientLightColor.needsUpdate=V,C.lightProbe.needsUpdate=V,C.directionalLights.needsUpdate=V,C.directionalLightShadows.needsUpdate=V,C.pointLights.needsUpdate=V,C.pointLightShadows.needsUpdate=V,C.spotLights.needsUpdate=V,C.spotLightShadows.needsUpdate=V,C.rectAreaLights.needsUpdate=V,C.hemisphereLights.needsUpdate=V}function qs(C){return C.isMeshLambertMaterial||C.isMeshToonMaterial||C.isMeshPhongMaterial||C.isMeshStandardMaterial||C.isShadowMaterial||C.isShaderMaterial&&C.lights===!0}this.getActiveCubeFace=function(){return N},this.getActiveMipmapLevel=function(){return O},this.getRenderTarget=function(){return D},this.setRenderTargetTextures=function(C,V,Y){let q=P.get(C);q.__autoAllocateDepthBuffer=C.resolveDepthBuffer===!1,q.__autoAllocateDepthBuffer===!1&&(q.__useRenderToTexture=!1),P.get(C.texture).__webglTexture=V,P.get(C.depthTexture).__webglTexture=q.__autoAllocateDepthBuffer?void 0:Y,q.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(C,V){let Y=P.get(C);Y.__webglFramebuffer=V,Y.__useDefaultFramebuffer=V===void 0};let Ys=z.createFramebuffer();this.setRenderTarget=function(C,V=0,Y=0){D=C,N=V,O=Y;let q=null,W=!1,Se=!1;if(C){let ye=P.get(C);if(ye.__useDefaultFramebuffer!==void 0){de.bindFramebuffer(z.FRAMEBUFFER,ye.__webglFramebuffer),Q.copy(C.viewport),ie.copy(C.scissor),oe=C.scissorTest,de.viewport(Q),de.scissor(ie),de.setScissorTest(oe),F=-1;return}else if(ye.__webglFramebuffer===void 0)T.setupRenderTarget(C);else if(ye.__hasExternalTextures)T.rebindTextures(C,P.get(C.texture).__webglTexture,P.get(C.depthTexture).__webglTexture);else if(C.depthBuffer){let I=C.depthTexture;if(ye.__boundDepthTexture!==I){if(I!==null&&P.has(I)&&(C.width!==I.image.width||C.height!==I.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");T.setupDepthRenderbuffer(C)}}let Re=C.texture;(Re.isData3DTexture||Re.isDataArrayTexture||Re.isCompressedArrayTexture)&&(Se=!0);let Ie=P.get(C).__webglFramebuffer;C.isWebGLCubeRenderTarget?(Array.isArray(Ie[V])?q=Ie[V][Y]:q=Ie[V],W=!0):C.samples>0&&T.useMultisampledRTT(C)===!1?q=P.get(C).__webglMultisampledFramebuffer:Array.isArray(Ie)?q=Ie[Y]:q=Ie,Q.copy(C.viewport),ie.copy(C.scissor),oe=C.scissorTest}else Q.copy(ae).multiplyScalar(De).floor(),ie.copy(Pe).multiplyScalar(De).floor(),oe=Le;if(Y!==0&&(q=Ys),de.bindFramebuffer(z.FRAMEBUFFER,q)&&de.drawBuffers(C,q),de.viewport(Q),de.scissor(ie),de.setScissorTest(oe),W){let ye=P.get(C.texture);z.framebufferTexture2D(z.FRAMEBUFFER,z.COLOR_ATTACHMENT0,z.TEXTURE_CUBE_MAP_POSITIVE_X+V,ye.__webglTexture,Y)}else if(Se){let ye=V;for(let Re=0;Re<C.textures.length;Re++){let Ie=P.get(C.textures[Re]);z.framebufferTextureLayer(z.FRAMEBUFFER,z.COLOR_ATTACHMENT0+Re,Ie.__webglTexture,Y,ye)}}else if(C!==null&&Y!==0){let ye=P.get(C.texture);z.framebufferTexture2D(z.FRAMEBUFFER,z.COLOR_ATTACHMENT0,z.TEXTURE_2D,ye.__webglTexture,Y)}F=-1},this.readRenderTargetPixels=function(C,V,Y,q,W,Se,Te,ye=0){if(!(C&&C.isWebGLRenderTarget)){Be("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Re=P.get(C).__webglFramebuffer;if(C.isWebGLCubeRenderTarget&&Te!==void 0&&(Re=Re[Te]),Re){de.bindFramebuffer(z.FRAMEBUFFER,Re);try{let Ie=C.textures[ye],I=Ie.format,B=Ie.type;if(C.textures.length>1&&z.readBuffer(z.COLOR_ATTACHMENT0+ye),!qe.textureFormatReadable(I)){Be("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!qe.textureTypeReadable(B)){Be("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}V>=0&&V<=C.width-q&&Y>=0&&Y<=C.height-W&&z.readPixels(V,Y,q,W,U.convert(I),U.convert(B),Se)}finally{let Ie=D!==null?P.get(D).__webglFramebuffer:null;de.bindFramebuffer(z.FRAMEBUFFER,Ie)}}},this.readRenderTargetPixelsAsync=async function(C,V,Y,q,W,Se,Te,ye=0){if(!(C&&C.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Re=P.get(C).__webglFramebuffer;if(C.isWebGLCubeRenderTarget&&Te!==void 0&&(Re=Re[Te]),Re)if(V>=0&&V<=C.width-q&&Y>=0&&Y<=C.height-W){de.bindFramebuffer(z.FRAMEBUFFER,Re);let Ie=C.textures[ye],I=Ie.format,B=Ie.type;if(C.textures.length>1&&z.readBuffer(z.COLOR_ATTACHMENT0+ye),!qe.textureFormatReadable(I))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!qe.textureTypeReadable(B))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let X=z.createBuffer();z.bindBuffer(z.PIXEL_PACK_BUFFER,X),z.bufferData(z.PIXEL_PACK_BUFFER,Se.byteLength,z.STREAM_READ),z.readPixels(V,Y,q,W,U.convert(I),U.convert(B),0);let Z=D!==null?P.get(D).__webglFramebuffer:null;de.bindFramebuffer(z.FRAMEBUFFER,Z);let re=z.fenceSync(z.SYNC_GPU_COMMANDS_COMPLETE,0);return z.flush(),await Uc(z,re,4),z.bindBuffer(z.PIXEL_PACK_BUFFER,X),z.getBufferSubData(z.PIXEL_PACK_BUFFER,0,Se),z.deleteBuffer(X),z.deleteSync(re),Se}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(C,V=null,Y=0){let q=Math.pow(2,-Y),W=Math.floor(C.image.width*q),Se=Math.floor(C.image.height*q),Te=V!==null?V.x:0,ye=V!==null?V.y:0;T.setTexture2D(C,0),z.copyTexSubImage2D(z.TEXTURE_2D,Y,0,0,Te,ye,W,Se),de.unbindTexture()};let Zs=z.createFramebuffer(),ja=z.createFramebuffer();this.copyTextureToTexture=function(C,V,Y=null,q=null,W=0,Se=0){let Te,ye,Re,Ie,I,B,X,Z,re,te=C.isCompressedTexture?C.mipmaps[Se]:C.image;if(Y!==null)Te=Y.max.x-Y.min.x,ye=Y.max.y-Y.min.y,Re=Y.isBox3?Y.max.z-Y.min.z:1,Ie=Y.min.x,I=Y.min.y,B=Y.isBox3?Y.min.z:0;else{let dt=Math.pow(2,-W);Te=Math.floor(te.width*dt),ye=Math.floor(te.height*dt),C.isDataArrayTexture?Re=te.depth:C.isData3DTexture?Re=Math.floor(te.depth*dt):Re=1,Ie=0,I=0,B=0}q!==null?(X=q.x,Z=q.y,re=q.z):(X=0,Z=0,re=0);let ce=U.convert(V.format),Oe=U.convert(V.type),Me;V.isData3DTexture?(T.setTexture3D(V,0),Me=z.TEXTURE_3D):V.isDataArrayTexture||V.isCompressedArrayTexture?(T.setTexture2DArray(V,0),Me=z.TEXTURE_2D_ARRAY):(T.setTexture2D(V,0),Me=z.TEXTURE_2D),de.activeTexture(z.TEXTURE0),de.pixelStorei(z.UNPACK_FLIP_Y_WEBGL,V.flipY),de.pixelStorei(z.UNPACK_PREMULTIPLY_ALPHA_WEBGL,V.premultiplyAlpha),de.pixelStorei(z.UNPACK_ALIGNMENT,V.unpackAlignment);let Lt=de.getParameter(z.UNPACK_ROW_LENGTH),Qe=de.getParameter(z.UNPACK_IMAGE_HEIGHT),Dt=de.getParameter(z.UNPACK_SKIP_PIXELS),Ht=de.getParameter(z.UNPACK_SKIP_ROWS),Vt=de.getParameter(z.UNPACK_SKIP_IMAGES);de.pixelStorei(z.UNPACK_ROW_LENGTH,te.width),de.pixelStorei(z.UNPACK_IMAGE_HEIGHT,te.height),de.pixelStorei(z.UNPACK_SKIP_PIXELS,Ie),de.pixelStorei(z.UNPACK_SKIP_ROWS,I),de.pixelStorei(z.UNPACK_SKIP_IMAGES,B);let $t=C.isDataArrayTexture||C.isData3DTexture,je=V.isDataArrayTexture||V.isData3DTexture;if(C.isDepthTexture){let dt=P.get(C),Kt=P.get(V),ct=P.get(dt.__renderTarget),Qt=P.get(Kt.__renderTarget);de.bindFramebuffer(z.READ_FRAMEBUFFER,ct.__webglFramebuffer),de.bindFramebuffer(z.DRAW_FRAMEBUFFER,Qt.__webglFramebuffer);for(let bn=0;bn<Re;bn++)$t&&(z.framebufferTextureLayer(z.READ_FRAMEBUFFER,z.COLOR_ATTACHMENT0,P.get(C).__webglTexture,W,B+bn),z.framebufferTextureLayer(z.DRAW_FRAMEBUFFER,z.COLOR_ATTACHMENT0,P.get(V).__webglTexture,Se,re+bn)),z.blitFramebuffer(Ie,I,Te,ye,X,Z,Te,ye,z.DEPTH_BUFFER_BIT,z.NEAREST);de.bindFramebuffer(z.READ_FRAMEBUFFER,null),de.bindFramebuffer(z.DRAW_FRAMEBUFFER,null)}else if(W!==0||C.isRenderTargetTexture||P.has(C)){let dt=P.get(C),Kt=P.get(V);de.bindFramebuffer(z.READ_FRAMEBUFFER,Zs),de.bindFramebuffer(z.DRAW_FRAMEBUFFER,ja);for(let ct=0;ct<Re;ct++)$t?z.framebufferTextureLayer(z.READ_FRAMEBUFFER,z.COLOR_ATTACHMENT0,dt.__webglTexture,W,B+ct):z.framebufferTexture2D(z.READ_FRAMEBUFFER,z.COLOR_ATTACHMENT0,z.TEXTURE_2D,dt.__webglTexture,W),je?z.framebufferTextureLayer(z.DRAW_FRAMEBUFFER,z.COLOR_ATTACHMENT0,Kt.__webglTexture,Se,re+ct):z.framebufferTexture2D(z.DRAW_FRAMEBUFFER,z.COLOR_ATTACHMENT0,z.TEXTURE_2D,Kt.__webglTexture,Se),W!==0?z.blitFramebuffer(Ie,I,Te,ye,X,Z,Te,ye,z.COLOR_BUFFER_BIT,z.NEAREST):je?z.copyTexSubImage3D(Me,Se,X,Z,re+ct,Ie,I,Te,ye):z.copyTexSubImage2D(Me,Se,X,Z,Ie,I,Te,ye);de.bindFramebuffer(z.READ_FRAMEBUFFER,null),de.bindFramebuffer(z.DRAW_FRAMEBUFFER,null)}else je?C.isDataTexture||C.isData3DTexture?z.texSubImage3D(Me,Se,X,Z,re,Te,ye,Re,ce,Oe,te.data):V.isCompressedArrayTexture?z.compressedTexSubImage3D(Me,Se,X,Z,re,Te,ye,Re,ce,te.data):z.texSubImage3D(Me,Se,X,Z,re,Te,ye,Re,ce,Oe,te):C.isDataTexture?z.texSubImage2D(z.TEXTURE_2D,Se,X,Z,Te,ye,ce,Oe,te.data):C.isCompressedTexture?z.compressedTexSubImage2D(z.TEXTURE_2D,Se,X,Z,te.width,te.height,ce,te.data):z.texSubImage2D(z.TEXTURE_2D,Se,X,Z,Te,ye,ce,Oe,te);de.pixelStorei(z.UNPACK_ROW_LENGTH,Lt),de.pixelStorei(z.UNPACK_IMAGE_HEIGHT,Qe),de.pixelStorei(z.UNPACK_SKIP_PIXELS,Dt),de.pixelStorei(z.UNPACK_SKIP_ROWS,Ht),de.pixelStorei(z.UNPACK_SKIP_IMAGES,Vt),Se===0&&V.generateMipmaps&&z.generateMipmap(Me),de.unbindTexture()},this.initRenderTarget=function(C){P.get(C).__webglFramebuffer===void 0&&T.setupRenderTarget(C)},this.initTexture=function(C){C.isCubeTexture?T.setTextureCube(C,0):C.isData3DTexture?T.setTexture3D(C,0):C.isDataArrayTexture||C.isCompressedArrayTexture?T.setTexture2DArray(C,0):T.setTexture2D(C,0),de.unbindTexture()},this.resetState=function(){N=0,O=0,D=null,de.reset(),le.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return cn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=et._getDrawingBufferColorSpace(e),t.unpackColorSpace=et._getUnpackColorSpace()}};var It=bh(ph());(()=>{"use strict";let s=document.getElementById("root"),e=(I,B,X)=>Math.max(B,Math.min(X,I)),t=(I,B)=>I+Math.random()*(B-I),n=I=>I[Math.floor(Math.random()*I.length)],i=I=>I[I.length-1],r=I=>{for(let B=I.length-1;B>0;B--){let X=Math.floor(Math.random()*(B+1));[I[B],I[X]]=[I[X],I[B]]}return I},a=[],c=[],l=!0,u=!1,d;function o(I,B,X,Z){I.addEventListener(B,X,Z),a.push(()=>I.removeEventListener(B,X,Z))}function h(I,B,X="#faf8f1"){let Z=document.createElement("style");Z.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+I,document.head.append(Z),s.style.background=X,s.innerHTML='<div class="fit">'+B+"</div>";let re=s.querySelector(".fit");function te(){let ce=s.getBoundingClientRect(),Oe=Math.min(ce.width/390,ce.height/598);re.style.transform=`translate(${(ce.width-390*Oe)/2}px,${(ce.height-598*Oe)/2}px) scale(${Oe})`,s.dataset.layout=`${Math.round(ce.width)}x${Math.round(ce.height)}`}te(),o(window,"resize",te)}function f(I){return s.querySelector(I)}function p(){var I;(I=f(".guide"))==null||I.classList.add("gone")}function v(I){s.dataset.phase=I}function g(){m(),p()}function m(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function M(I=450,B=.08,X=.18,Z="sine",re=0){if(!(!d||!l))try{let te=d.createOscillator(),ce=d.createGain(),Oe=d.currentTime;te.type=Z,te.frequency.setValueAtTime(I,Oe),re&&te.frequency.exponentialRampToValueAtTime(Math.max(30,re),Oe+B),ce.gain.setValueAtTime(.001,Oe),ce.gain.exponentialRampToValueAtTime(X,Oe+.006),ce.gain.exponentialRampToValueAtTime(.001,Oe+B),te.connect(ce),ce.connect(d.destination),te.start(Oe),te.stop(Oe+B+.02),te.onended=()=>{te.disconnect(),ce.disconnect()}}catch{}}function x(){M(523,.12,.18),setTimeout(()=>M(784,.17,.16),100)}function S(){M(180,.22,.18,"triangle",65)}function w(I){let B=0;function X(Z){if(u)return;let re=Math.min(.035,(Z-(B||Z))/1e3);B=Z,document.hidden||I(l?re:0,Z/1e3),requestAnimationFrame(X)}requestAnimationFrame(X)}function y(){let I=f("canvas.stage"),B=I.getContext("2d"),X=Math.min(2,window.devicePixelRatio||1);return I.width=390*X,I.height=598*X,B.scale(X,X),{canvas:I,ctx:B}}function E(I,B=f("canvas.stage")){let X=B.getBoundingClientRect();return{x:(I.clientX-X.left)*390/X.width,y:(I.clientY-X.top)*598/X.height}}function _(I,B,X,Z,re,te){te=Math.min(Math.abs(Z)/2,Math.abs(re)/2,te),I.moveTo(B+te,X),I.lineTo(B+Z-te,X),I.quadraticCurveTo(B+Z,X,B+Z,X+te),I.lineTo(B+Z,X+re-te),I.quadraticCurveTo(B+Z,X+re,B+Z-te,X+re),I.lineTo(B+te,X+re),I.quadraticCurveTo(B,X+re,B,X+re-te),I.lineTo(B,X+te),I.quadraticCurveTo(B,X,B+te,X),I.closePath()}function b(I,B,X,Z,re,te,ce,Oe){I.beginPath(),_(I,B,X,Z,re,te),ce&&(I.fillStyle=ce,I.fill()),Oe&&(I.strokeStyle=Oe,I.stroke())}function R(I,B,X,Z,re,te){I.beginPath(),I.arc(B,X,Math.max(.01,Z),0,Math.PI*2),re&&(I.fillStyle=re,I.fill()),te&&(I.strokeStyle=te,I.stroke())}function A(I,B,X,Z,re,te,ce=2){I.beginPath(),I.moveTo(B,X),I.lineTo(Z,re),I.strokeStyle=te,I.lineWidth=ce,I.stroke()}function L(I,B,X,Z,re=18,te="#25252a",ce="UIBody",Oe="center"){I.font=`700 ${re}px ${ce}`,I.fillStyle=te,I.textAlign=Oe,I.textBaseline="middle",I.fillText(B,X,Z)}let N=[];function O(I){let B=I.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(Ce(B,I))}function D(I){let B=new Image;return B.onerror=()=>{s.dataset.assetIssue="image"},B.src=O(I),N.push({im:B,path:I}),B}function F(I,B,X,Z,re,te){if(!B||!B.width)return;let ce=B.videoWidth||B.width,Oe=B.videoHeight||B.height;if(!ce||!Oe)return;let Me=Math.max(re/ce,te/Oe);I.save(),I.beginPath(),I.rect(X,Z,re,te),I.clip(),I.drawImage(B,X+(re-ce*Me)/2,Z+(te-Oe*Me)/2,ce*Me,Oe*Me),I.restore()}function k(I,B,X,Z,re){I.save(),I.beginPath(),I.arc(X,Z,re,0,Math.PI*2),I.clip(),F(I,B,X-re,Z-re,re*2,re*2),I.restore()}function Q(I,B,X,Z){let re=f(".modal");if(!re)return;re.hidden=!1,re.querySelector("h2").textContent=I,re.querySelector(".value").textContent=B,re.querySelector("p").textContent=X;let te=re.querySelector("button");te.onclick=()=>{re.hidden=!0,g(),Z()},v("result")}function ie(I="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${I}</button></section></div>`}function oe(){let I=f(".flash");I&&(I.classList.remove("fire"),I.offsetWidth,I.classList.add("fire"))}let xe=[];function Ee(I){l=I,I||d==null||d.suspend().catch(()=>{});for(let B of xe)B(I)}o(window,"message",I=>{var B;I.source===parent&&((B=I.data)==null?void 0:B.type)==="playable-active"&&Ee(I.data.active===!0)}),o(document,"visibilitychange",()=>{Ee(!document.hidden)}),o(window,"pagehide",()=>{u=!0,a.splice(0).forEach(I=>I()),c.splice(0).forEach(I=>I()),d==null||d.close().catch(()=>{})});let ze={};function Ce(I,B){return ze[I]??B}async function De(I=()=>{}){let B=new AbortController,X=setTimeout(()=>B.abort(),1600);try{let Z=await fetch("./game.config.json",{signal:B.signal});if(!Z.ok)throw Error("Config unavailable");let re=await Z.json();for(let te of["texts","tweaks","images"])for(let ce of re[te]||[])ze[ce.id]=te==="images"?ce.path:ce.value;for(let te of N){let ce=O(te.path);te.im.getAttribute("src")!==ce&&(te.im.src=ce)}for(let te of s.querySelectorAll('img[src^="./assets/"]'))te.src=O(te.getAttribute("src"));I(),s.dataset.config="loaded"}catch{s.dataset.config="defaults"}finally{clearTimeout(X)}}let J=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],ge=()=>{};function ae(){var B,X;function I(Z,re){J=Z.slice(0,24).map(te=>({nickname:String(te.nickname||"Friend"),avatar:te.avatar,image:null}));for(let te of J){let ce;try{ce=re?window.tt.createImage():new Image,ce.onload=()=>{te.image=ce,ge()},ce.onerror=()=>{te.image=null},ce.src=te.avatar}catch{te.image=null}}ge()}I(J,!1),s.dataset.friends="sample",!(!((B=window.tt)!=null&&B.getFriendsInfo)||!((X=window.tt)!=null&&X.createImage))&&window.tt.getFriendsInfo({success(Z){let re=Array.isArray(Z==null?void 0:Z.friends)?Z.friends.filter(te=>te&&typeof te.avatar=="string"):[];re.length&&(I(re,!0),s.dataset.friends="host")},fail(){s.dataset.friends="sample"}})}function Pe(I,B,X,Z,re,te="#fff"){let ce=J[(B%J.length+J.length)%J.length];I.save(),I.shadowColor="#25212d20",I.shadowBlur=6,R(I,X,Z,re,te),I.shadowBlur=0,ce!=null&&ce.image?k(I,ce.image,X,Z,Math.max(1,re-2)):(R(I,X,Z,Math.max(1,re-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][B%4]),L(I,Array.from((ce==null?void 0:ce.nickname)||"?")[0],X,Z,re*.7,"#fff")),I.restore()}function Le(I){var B;return((B=J[(I%J.length+J.length)%J.length])==null?void 0:B.nickname)||"Friend"}function Ne(I,B,X,Z,re=13){L(I,Array.from(Le(B)).slice(0,15).join(""),X,Z,re)}ae(),h('.spin-control{position:absolute;left:30px;bottom:132px;width:64px;z-index:10;text-align:center;user-select:none}.spin-ball{position:relative;width:64px;height:64px;border:2px solid #d4dfef;border-radius:50%;background:radial-gradient(circle at 30% 25%,#7587aa,#303f65 55%,#18233e);box-shadow:0 3px 8px #0005;touch-action:none;cursor:ew-resize}.spin-ball:focus-visible{outline:3px solid #f6deb1;outline-offset:4px}.spin-ball[aria-disabled="true"]{opacity:.45;cursor:default}.spin-ball:before,.spin-ball:after{content:"";position:absolute;width:5px;height:7px;border-radius:50%;background:#17223d;top:11px;left:22px}.spin-ball:after{left:33px;top:13px}.spin-line{position:absolute;left:9px;right:9px;top:29px;height:1px;background:#d9e7fa80}.spin-dot{position:absolute;width:14px;height:14px;left:calc(50% - 7px);top:calc(50% - 7px);border-radius:50%;background:#f9edcc;box-shadow:0 1px 4px #0007;border:1px solid #fff}.spin-label{margin-top:5px;color:#f0dfbd;font:600 12px/1.3 UIBody,Arial,sans-serif;text-shadow:0 1px 3px #000}.fit{background:#28231f;color:#eee5d2}.scene{position:absolute;inset:0}.scene canvas{display:block;width:390px;height:598px;touch-action:none}.hud{font-size:23px;font-family:Georgia,serif;text-shadow:0 2px 5px #000}.guide{top:106px;font-size:16px;font-weight:500;color:#f0dfbd;text-shadow:0 1px 5px #000}.roll-note{position:absolute;left:30px;right:30px;bottom:35px;text-align:center;font-size:12px;color:#f2e4ca;text-shadow:0 1px 3px #241a10;pointer-events:none}.result{background:#efe3c9;color:#4b3e2c;border-radius:12px;border:4px solid #7f6846}.result .pill{background:#886a3c}',`<div class="scene"></div><div class="spin-control"><div class="spin-ball" role="slider" tabindex="0" aria-label="Side spin" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Straight"><span class="spin-line"></span><span class="spin-dot"></span></div><div class="spin-label">Spin</div></div><div class="hud"><span class="frame">1 / 10</span><span class="score">0</span></div><div class="guide">Swipe up to bowl</div><div class="roll-note">First roll</div>${ie()}`,"#28231f");let at=1/120,Ze=.013,nt=-15.25,st=-19.7,ke=0,Ye=0,lt=0,ft=null,z=null,ut=0,Xe=0,qe=new hs;qe.background=new Ke("#28231f"),qe.fog=new cs("#28231f",30,55);let de=new At(45,390/598,.1,70);de.position.set(0,6.5,10),de.lookAt(0,0,-6.5);let rt=new $a({antialias:!0,powerPreference:"low-power"});rt.setSize(390,598),rt.setPixelRatio(Math.min(2,devicePixelRatio||1)),rt.outputColorSpace=bt,rt.shadowMap.enabled=!0,rt.shadowMap.type=ia,f(".scene").append(rt.domElement),qe.add(new Ts(16771263,2434086,2.1));for(let I of[4,-5,-12]){let B=new As(16771256,25,18,2);B.position.set(0,5,I),qe.add(B)}let P=new Cs(16777215,2);P.position.set(2,7,-8),P.castShadow=!0,P.shadow.mapSize.set(1024,1024),P.shadow.camera.left=-5,P.shadow.camera.right=5,P.shadow.camera.top=8,P.shadow.camera.bottom=-8,qe.add(P);let T=document.createElement("canvas");T.width=512,T.height=1024;let G=T.getContext("2d");G.fillStyle="#b68d54",G.fillRect(0,0,512,1024);for(let I=0;I<512;I+=32){G.fillStyle=["#caa16a","#b18b56","#bc965f","#d0aa76"][Math.floor(I/32)%4],G.fillRect(I,0,31,1024),G.strokeStyle="#83643b38",G.lineWidth=1;for(let B=0;B<18;B++){let X=I+t(0,31);G.beginPath(),G.moveTo(X,0),G.bezierCurveTo(X+t(-3,3),300,X+t(-3,3),700,X,1024),G.stroke()}for(let B=t(0,150);B<1024;B+=t(150,300))G.fillStyle="#84623e55",G.fillRect(I,B,31,1)}let j=new pi(T);j.colorSpace=bt,j.wrapT=Di,j.repeat.set(1,3);function se(I,B,X,Z,re,te,ce){let Oe=new Tt(new $n(I,B,X),ce);return Oe.position.set(Z,re,te),Oe.receiveShadow=!0,qe.add(Oe),Oe}se(3.15,.18,24.25,0,-.12,-3.125,new tn({map:j,roughness:.48,metalness:.02}));let he=new tn({color:"#29251f",roughness:.5});for(let I of[-1.8,1.8])se(.42,.1,29,I,-.14,-5.5,he),se(.08,.22,29,I+Math.sign(I)*.23,-.04,-5.5,new tn({color:"#624e36",roughness:.35}));let pe=new tn({color:"#39352d",roughness:.9});se(18,.3,35.25,0,-.4,2.375,pe);for(let I of[-5.4,5.4])se(7.2,.3,15,I,-.4,-22.75,pe);se(18,.3,10,0,-.4,-25.25,pe);let K=new tn({color:"#101317",roughness:.95});se(3.55,.12,4.9,0,-.85,-17.7,K),se(4.3,2.5,.2,0,.4,-20.15,new tn({color:"#25282d",roughness:.9}));for(let I of[-1.4,-.9,-.45,0,.45,.9,1.4]){let B=new Tt(new vs(.055,.2,3),new Jn({color:"#665338"}));B.rotation.x=-Math.PI/2,B.position.set(I,.01,-2),qe.add(B)}let ee=document.createElement("canvas");ee.width=32,ee.height=256;let ve=ee.getContext("2d");ve.fillStyle="#fffdf5",ve.fillRect(0,0,32,256),ve.fillStyle="#b7423b",ve.fillRect(0,175,32,11),ve.fillRect(0,193,32,11);let we=new pi(ee);we.colorSpace=bt;let me=new tn({map:we,roughness:.25}),ue=[[.07,0],[.12,.04],[.16,.2],[.145,.35],[.09,.5],[.055,.64],[.055,.73],[.1,.79],[.105,.87],[.07,.94],[0,.98]].map(([I,B])=>new Je(I,B)),Ve=new _s(ue,24),Ue=It.default.Engine.create({gravity:{x:0,y:0}}),He=[],U=null,le=null,$=null,_e=null,fe=0,ne=!1,Ae="ready",Ge=[],ot=[],it=0,Et=0,Ot=!0,Fn=0,On=.29,_t=new Tt(new Ms(On,40,28),new tn({color:"#ffffff",roughness:.22,metalness:.1}));_t.castShadow=!0,qe.add(_t);function Yi(){let I=document.createElement("canvas");I.width=1024,I.height=512;let B=I.getContext("2d");B.fillStyle="#303f65",B.fillRect(0,0,1024,512),B.fillStyle="#a7bedc",B.fillRect(0,78,1024,10),B.fillRect(0,424,1024,10),Pe(B,0,256,256,112,"#eee5d2"),Pe(B,0,768,256,112,"#eee5d2");let X=new pi(I);X.colorSpace=bt,_t.material.map=X,_t.material.needsUpdate=!0,le==null||le.dispose(),le=X}ge=Yi,Yi();let dn=new H,vi=new en,Hs=new H(0,1,0),rn=new Rn;rn.visible=!1,qe.add(rn);let Bn=new Pt,Zi=new bs({color:"#fff0bd",dashSize:.16,gapSize:.12,transparent:!0,opacity:.78,depthWrite:!1}),ri=new ms(Bn,Zi);rn.add(ri);let zn=new Tt(new Ss(.075,.095,24),new Jn({color:"#fff0bd",transparent:!0,opacity:.8,side:nn,depthWrite:!1}));zn.rotation.x=-Math.PI/2,rn.add(zn);function Ji(I,B){return{x:e((B.x-I.x)/1800,-.09,.09),y:-e((I.y-B.y)/500,.19,.4)}}function Ws(I,B,X,Z,re){if(X<nt||Math.abs(B)>1.75)return{x:I.x,y:I.y};let te=e((2-X-1.5)/8,0,1);return{x:I.x+Z*Ze*I.y*I.y*60*re*te,y:I.y}}function $i(I){if(!$||!U||ne||Ae==="result"){rn.visible=!1;return}let B=Ji($,I),X=[new H(U.position.x,.025,U.position.y)],Z=U.position.x,re=U.position.y,te=B.x,ce=B.y,Oe=at*60,Me=1-U.frictionAir*Oe;for(let Lt=0;Lt<Math.ceil(4.5/at);Lt++){let Qe=Ws({x:te,y:ce},Z,re,Ye,at);te=Qe.x*Me,ce=Qe.y*Me;let Dt=Z+te*Oe,Ht=re+ce*Oe,Vt=Dt-Z,$t=Ht-re,je=1,dt=!1;for(let Kt of He){let ct=Z-Kt.body.position.x,Qt=re-Kt.body.position.y,bn=On+(Kt.body.circleRadius||.145),_i=Vt*Vt+$t*$t,eo=2*(ct*Vt+Qt*$t),mh=ct*ct+Qt*Qt-bn*bn,Il=eo*eo-4*_i*mh;if(_i>0&&Il>=0){let to=(-eo-Math.sqrt(Il))/(2*_i);to>=0&&to<=je&&(je=to,dt=!0)}}if(Math.abs(Dt)>2&&(je=Math.min(je,(Math.sign(Dt)*2-Z)/Vt),dt=!0),Ht<st&&(je=Math.min(je,(st-re)/$t),dt=!0),Z+=Vt*je,re+=$t*je,X.push(new H(Z,.025,re)),dt)break}Bn.setFromPoints(X),ri.computeLineDistances(),zn.position.set(Z,.028,re),rn.visible=!0}function Xs(){for(let I of He)qe.remove(I.mesh),It.default.World.remove(Ue.world,I.body);He=[]}function qs(){Xs();let I=0;for(let B=0;B<4;B++)for(let X=0;X<=B;X++){let Z=(X-B/2)*.43,re=-13-B*.47,te=new Tt(Ve,me);te.position.set(Z,0,re),te.castShadow=!0,te.receiveShadow=!0,qe.add(te);let ce=It.default.Bodies.circle(Z,re,.145,{frictionAir:.03,restitution:.45,density:.001});ce.pinId=I,It.default.World.add(Ue.world,ce),He.push({id:I++,mesh:te,body:ce,fallen:!1,tilt:0,angle:0,pitDrop:0,fallVelocity:0})}}function Ys(){Y(),U&&It.default.World.remove(Ue.world,U),U=It.default.Bodies.circle(0,2,On,{frictionAir:.002,restitution:.55,density:.007}),U.isBall=!0,It.default.World.add(Ue.world,U),_t.visible=!0,ne=!1,fe=0,ke=0,ut=0,Xe=0,_t.position.set(0,On,2),_t.quaternion.setFromUnitVectors(new H(0,0,1),new H().subVectors(de.position,_t.position).normalize())}It.default.Events.on(Ue,"collisionStart",I=>{for(let B of I.pairs){let X=B.bodyA,Z=B.bodyB;if(!(Math.hypot(X.velocity.x-Z.velocity.x,X.velocity.y-Z.velocity.y)<.035)){for(let te of[X,Z])if(te.pinId!==void 0){let ce=He.find(Oe=>Oe.id===te.pinId);ce&&!ce.fallen&&(ce.fallen=!0,ce.angle=Math.atan2(te.velocity.x,-te.velocity.y),Fn<=0&&(M(850,.045,.13,"triangle"),Fn=.09))}}}});function Zs(){let I=[...Ge,ot].filter(re=>re.length),B=I.flat(),X=0,Z=0;for(let re=0;re<Math.min(I.length,10);re++){let te=B[X]||0,ce=B[X+1]||0;te===10?(Z+=10+ce+(B[X+2]||0),X++):te+ce===10?(Z+=10+(B[X+2]||0),X+=2):(Z+=te+ce,X+=2)}return Z}function ja(){ne=!1,rn.visible=!1;let I=He.filter(Z=>Z.fallen).length;ot.push(I);let B=!1;it<9?B=I===10||ot.length===2:(ot.length===3||ot.length===2&&ot[0]+ot[1]<10)&&(B=!0),f(".score").textContent=Zs();let X=He.every(Z=>Z.fallen);if(B){if(Ge.push(ot),ot=[],it++,it===10){Ae="result",x(),Q("A full ten frames",Zs(),"Every pin counts.",C);return}Ot=!0}else Ot=X;Et=.65,v("between-rolls"),f(".roll-note").textContent=I===10?"Strike!":X?"Spare!":I+" pins"}function C(){Ye=0,lt=0,ye(),Xs(),Ge=[],ot=[],it=0,Ae="ready",Ot=!0,Et=0,qs(),Ys(),f(".frame").textContent="1 / 10",f(".score").textContent="0",f(".roll-note").textContent="First roll",v("ready")}let V=rt.domElement;function Y(){let I=_e;$=null,z=null,_e=null,rn.visible=!1,I!==null&&V.hasPointerCapture(I)&&V.releasePointerCapture(I)}function q(I){z=I,It.default.Body.setPosition(U,{x:e((I.x-195)/110,-1.15,1.15),y:2})}let W=f(".spin-ball"),Se=f(".spin-dot");function Te(){return l&&!ne&&Et<=0&&Ae!=="result"}function ye(){Se.style.transform=`translate(${(Ye*21).toFixed(1)}px,0)`,W.setAttribute("aria-valuenow",String(Math.round(Ye*100))),W.setAttribute("aria-valuetext",Math.abs(Ye)<.01?"Straight":(Ye<0?"Left ":"Right ")+Math.round(Math.abs(Ye)*100)+"%"),$&&$i(z||$)}function Re(I){let B=W.getBoundingClientRect();Ye=e((I.clientX-B.left-B.width/2)/(B.width*.34),-1,1),ye()}function Ie(){let I=ft;ft=null,I!==null&&W.hasPointerCapture(I)&&W.releasePointerCapture(I)}o(W,"pointerdown",I=>{!Te()||ft!==null||I.button!==0||(I.preventDefault(),ft=I.pointerId,W.setPointerCapture(I.pointerId),Re(I))}),o(W,"pointermove",I=>{I.pointerId===ft&&(I.preventDefault(),Re(I))}),o(W,"pointerup",I=>{I.pointerId===ft&&(Re(I),Ie())}),o(W,"pointercancel",I=>{I.pointerId===ft&&Ie()}),o(W,"lostpointercapture",I=>{I.pointerId===ft&&Ie()}),o(W,"keydown",I=>{!Te()||!["ArrowLeft","ArrowRight","Home"].includes(I.key)||(I.preventDefault(),Ye=I.key==="Home"?0:e(Ye+(I.key==="ArrowLeft"?-.1:.1),-1,1),ye())}),o(V,"pointerdown",I=>{if(!l||ne||Et>0||Ae==="result"||_e!==null||I.button!==0)return;let B=E(I,V);B.y<280||B.y>550||(g(),$=B,_e=I.pointerId,q(B),V.setPointerCapture(I.pointerId),$i(B))}),o(V,"pointermove",I=>{if(I.pointerId===_e&&$){let B=E(I,V);q(B),$i(B)}}),o(V,"pointerup",I=>{if(I.pointerId!==_e||!$)return;let B=E(I,V),X=$.y-B.y,Z=Ji($,B);q(B),Y(),!(X<15)&&(It.default.Body.setVelocity(U,Z),lt=Ye,ne=!0,fe=0,Ae="playing",f(".roll-note").textContent="",v("rolling"),M(80,.3,.12,"triangle",50))}),o(V,"pointercancel",I=>{I.pointerId===_e&&Y()}),o(V,"lostpointercapture",I=>{I.pointerId===_e&&Y()}),xe.push(I=>{I||(Y(),Ie())}),C(),w(I=>{Fn=Math.max(0,Fn-I);let B=ne;if(Ae!=="result"){if(I>0)for(ke+=I;ke>=at;)ne&&It.default.Body.setVelocity(U,Ws(U.velocity,U.position.x,U.position.y,lt,at)),It.default.Engine.update(Ue,at*1e3),ke-=at;if(ne&&(fe+=I,(fe>4.5||U.position.y<st)&&ja()),Et>0&&(Et-=I,Et<=0)){if(Ot)qs();else for(let Z of[...He])Z.fallen&&(qe.remove(Z.mesh),It.default.World.remove(Ue.world,Z.body),He=He.filter(re=>re!==Z));Ys(),f(".frame").textContent=it+1+" / 10",f(".roll-note").textContent=ot.length?"Second roll":"First roll",v("ready")}}if(U){let Z=U.position.x-_t.position.x,re=U.position.y-_t.position.z,te=Math.hypot(Z,re);B&&I>0&&te>0&&(dn.set(re,0,-Z).normalize(),vi.setFromAxisAngle(dn,te/On),_t.quaternion.premultiply(vi),_t.rotateOnWorldAxis(Hs,lt*I*8)),U.position.y<nt&&(Xe+=9.8*I,ut=Math.min(.79,ut+Xe*I)),_t.position.set(U.position.x,On-ut,U.position.y),(U.position.y<st||Math.abs(U.position.x)>2)&&(_t.visible=!1)}for(let Z of He)Z.mesh.position.x=Z.body.position.x,Z.mesh.position.z=Z.body.position.y,Z.body.position.y<nt&&(Z.fallen=!0,Z.fallVelocity+=9.8*I,Z.pitDrop=Math.min(.65,Z.pitDrop+Z.fallVelocity*I)),Z.fallen&&(Z.tilt=Math.min(Math.PI/2,Z.tilt+I*3.7),Z.mesh.position.y=.08-Z.pitDrop,Z.mesh.rotation.x=-Math.cos(Z.angle)*Z.tilt,Z.mesh.rotation.z=-Math.sin(Z.angle)*Z.tilt),Z.body.position.y<st+.7&&(Z.mesh.visible=!1);let X=String(!Te());W.getAttribute("aria-disabled")!==X&&W.setAttribute("aria-disabled",X),rt.render(qe,de),s.dataset.frame=it+1}),c.push(()=>{It.default.Events.off(Ue),It.default.World.clear(Ue.world,!1),It.default.Engine.clear(Ue),rt.dispose(),j.dispose(),we.dispose(),Ve.dispose(),me.dispose(),le==null||le.dispose(),_t.geometry.dispose(),_t.material.dispose(),Bn.dispose(),Zi.dispose(),zn.geometry.dispose(),zn.material.dispose()}),De(()=>{f(".guide")&&(f(".guide").textContent=String(Ce("GUIDE","Position the ball \xB7 swipe up to bowl")))})})();(()=>{let s=document.createElement("style");s.dataset.batch3Ui="20261116",s.textContent=`
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
.hud{font:700 28px/1.2 Georgia,serif}.guide{font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#fff0d5}.roll-note{bottom:50px;font-size:14px;line-height:1.4}.result h2{font-family:Georgia,serif}`,document.head.append(s)})();})();
