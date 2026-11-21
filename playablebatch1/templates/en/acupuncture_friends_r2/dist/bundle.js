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

(()=>{var $S=Object.create;var u0=Object.defineProperty;var ZS=Object.getOwnPropertyDescriptor;var KS=Object.getOwnPropertyNames;var JS=Object.getPrototypeOf,jS=Object.prototype.hasOwnProperty;var hr=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var QS=(t,e,n,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of KS(e))!jS.call(t,r)&&r!==n&&u0(t,r,{get:()=>e[r],enumerable:!(i=ZS(e,r))||i.enumerable});return t};var gc=(t,e,n)=>(n=t!=null?$S(JS(t)):{},QS(e||!t||!t.__esModule?u0(n,"default",{value:t,enumerable:!0}):n,t));var M0=hr(_t=>{"use strict";var Sa=Symbol.for("react.element"),eM=Symbol.for("react.portal"),tM=Symbol.for("react.fragment"),nM=Symbol.for("react.strict_mode"),iM=Symbol.for("react.profiler"),rM=Symbol.for("react.provider"),sM=Symbol.for("react.context"),oM=Symbol.for("react.forward_ref"),aM=Symbol.for("react.suspense"),lM=Symbol.for("react.memo"),cM=Symbol.for("react.lazy"),h0=Symbol.iterator;function uM(t){return t===null||typeof t!="object"?null:(t=h0&&t[h0]||t["@@iterator"],typeof t=="function"?t:null)}var p0={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},m0=Object.assign,g0={};function oo(t,e,n){this.props=t,this.context=e,this.refs=g0,this.updater=n||p0}oo.prototype.isReactComponent={};oo.prototype.setState=function(t,e){if(typeof t!="object"&&typeof t!="function"&&t!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,t,e,"setState")};oo.prototype.forceUpdate=function(t){this.updater.enqueueForceUpdate(this,t,"forceUpdate")};function _0(){}_0.prototype=oo.prototype;function Qf(t,e,n){this.props=t,this.context=e,this.refs=g0,this.updater=n||p0}var ed=Qf.prototype=new _0;ed.constructor=Qf;m0(ed,oo.prototype);ed.isPureReactComponent=!0;var f0=Array.isArray,v0=Object.prototype.hasOwnProperty,td={current:null},x0={key:!0,ref:!0,__self:!0,__source:!0};function y0(t,e,n){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)v0.call(e,i)&&!x0.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=n;else if(1<a){for(var l=Array(a),c=0;c<a;c++)l[c]=arguments[c+2];r.children=l}if(t&&t.defaultProps)for(i in a=t.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:Sa,type:t,key:s,ref:o,props:r,_owner:td.current}}function hM(t,e){return{$$typeof:Sa,type:t.type,key:e,ref:t.ref,props:t.props,_owner:t._owner}}function nd(t){return typeof t=="object"&&t!==null&&t.$$typeof===Sa}function fM(t){var e={"=":"=0",":":"=2"};return"$"+t.replace(/[=:]/g,function(n){return e[n]})}var d0=/\/+/g;function jf(t,e){return typeof t=="object"&&t!==null&&t.key!=null?fM(""+t.key):e.toString(36)}function vc(t,e,n,i,r){var s=typeof t;(s==="undefined"||s==="boolean")&&(t=null);var o=!1;if(t===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(t.$$typeof){case Sa:case eM:o=!0}}if(o)return o=t,r=r(o),t=i===""?"."+jf(o,0):i,f0(r)?(n="",t!=null&&(n=t.replace(d0,"$&/")+"/"),vc(r,e,n,"",function(c){return c})):r!=null&&(nd(r)&&(r=hM(r,n+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(d0,"$&/")+"/")+t)),e.push(r)),1;if(o=0,i=i===""?".":i+":",f0(t))for(var a=0;a<t.length;a++){s=t[a];var l=i+jf(s,a);o+=vc(s,e,n,l,r)}else if(l=uM(t),typeof l=="function")for(t=l.call(t),a=0;!(s=t.next()).done;)s=s.value,l=i+jf(s,a++),o+=vc(s,e,n,l,r);else if(s==="object")throw e=String(t),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function _c(t,e,n){if(t==null)return t;var i=[],r=0;return vc(t,i,"","",function(s){return e.call(n,s,r++)}),i}function dM(t){if(t._status===-1){var e=t._result;e=e(),e.then(function(n){(t._status===0||t._status===-1)&&(t._status=1,t._result=n)},function(n){(t._status===0||t._status===-1)&&(t._status=2,t._result=n)}),t._status===-1&&(t._status=0,t._result=e)}if(t._status===1)return t._result.default;throw t._result}var Pn={current:null},xc={transition:null},pM={ReactCurrentDispatcher:Pn,ReactCurrentBatchConfig:xc,ReactCurrentOwner:td};function S0(){throw Error("act(...) is not supported in production builds of React.")}_t.Children={map:_c,forEach:function(t,e,n){_c(t,function(){e.apply(this,arguments)},n)},count:function(t){var e=0;return _c(t,function(){e++}),e},toArray:function(t){return _c(t,function(e){return e})||[]},only:function(t){if(!nd(t))throw Error("React.Children.only expected to receive a single React element child.");return t}};_t.Component=oo;_t.Fragment=tM;_t.Profiler=iM;_t.PureComponent=Qf;_t.StrictMode=nM;_t.Suspense=aM;_t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=pM;_t.act=S0;_t.cloneElement=function(t,e,n){if(t==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+t+".");var i=m0({},t.props),r=t.key,s=t.ref,o=t._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=td.current),e.key!==void 0&&(r=""+e.key),t.type&&t.type.defaultProps)var a=t.type.defaultProps;for(l in e)v0.call(e,l)&&!x0.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=n;else if(1<l){a=Array(l);for(var c=0;c<l;c++)a[c]=arguments[c+2];i.children=a}return{$$typeof:Sa,type:t.type,key:r,ref:s,props:i,_owner:o}};_t.createContext=function(t){return t={$$typeof:sM,_currentValue:t,_currentValue2:t,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},t.Provider={$$typeof:rM,_context:t},t.Consumer=t};_t.createElement=y0;_t.createFactory=function(t){var e=y0.bind(null,t);return e.type=t,e};_t.createRef=function(){return{current:null}};_t.forwardRef=function(t){return{$$typeof:oM,render:t}};_t.isValidElement=nd;_t.lazy=function(t){return{$$typeof:cM,_payload:{_status:-1,_result:t},_init:dM}};_t.memo=function(t,e){return{$$typeof:lM,type:t,compare:e===void 0?null:e}};_t.startTransition=function(t){var e=xc.transition;xc.transition={};try{t()}finally{xc.transition=e}};_t.unstable_act=S0;_t.useCallback=function(t,e){return Pn.current.useCallback(t,e)};_t.useContext=function(t){return Pn.current.useContext(t)};_t.useDebugValue=function(){};_t.useDeferredValue=function(t){return Pn.current.useDeferredValue(t)};_t.useEffect=function(t,e){return Pn.current.useEffect(t,e)};_t.useId=function(){return Pn.current.useId()};_t.useImperativeHandle=function(t,e,n){return Pn.current.useImperativeHandle(t,e,n)};_t.useInsertionEffect=function(t,e){return Pn.current.useInsertionEffect(t,e)};_t.useLayoutEffect=function(t,e){return Pn.current.useLayoutEffect(t,e)};_t.useMemo=function(t,e){return Pn.current.useMemo(t,e)};_t.useReducer=function(t,e,n){return Pn.current.useReducer(t,e,n)};_t.useRef=function(t){return Pn.current.useRef(t)};_t.useState=function(t){return Pn.current.useState(t)};_t.useSyncExternalStore=function(t,e,n){return Pn.current.useSyncExternalStore(t,e,n)};_t.useTransition=function(){return Pn.current.useTransition()};_t.version="18.3.1"});var yc=hr((FR,w0)=>{"use strict";w0.exports=M0()});var N0=hr(Dt=>{"use strict";function od(t,e){var n=t.length;t.push(e);e:for(;0<n;){var i=n-1>>>1,r=t[i];if(0<Sc(r,e))t[i]=e,t[n]=r,n=i;else break e}}function yi(t){return t.length===0?null:t[0]}function wc(t){if(t.length===0)return null;var e=t[0],n=t.pop();if(n!==e){t[0]=n;e:for(var i=0,r=t.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=t[o],l=o+1,c=t[l];if(0>Sc(a,n))l<r&&0>Sc(c,a)?(t[i]=c,t[l]=n,i=l):(t[i]=a,t[o]=n,i=o);else if(l<r&&0>Sc(c,n))t[i]=c,t[l]=n,i=l;else break e}}return e}function Sc(t,e){var n=t.sortIndex-e.sortIndex;return n!==0?n:t.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(E0=performance,Dt.unstable_now=function(){return E0.now()}):(id=Date,T0=id.now(),Dt.unstable_now=function(){return id.now()-T0});var E0,id,T0,Vi=[],Or=[],mM=1,ui=null,xn=3,Ec=!1,ws=!1,wa=!1,C0=typeof setTimeout=="function"?setTimeout:null,R0=typeof clearTimeout=="function"?clearTimeout:null,b0=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function ad(t){for(var e=yi(Or);e!==null;){if(e.callback===null)wc(Or);else if(e.startTime<=t)wc(Or),e.sortIndex=e.expirationTime,od(Vi,e);else break;e=yi(Or)}}function ld(t){if(wa=!1,ad(t),!ws)if(yi(Vi)!==null)ws=!0,ud(cd);else{var e=yi(Or);e!==null&&hd(ld,e.startTime-t)}}function cd(t,e){ws=!1,wa&&(wa=!1,R0(Ea),Ea=-1),Ec=!0;var n=xn;try{for(ad(e),ui=yi(Vi);ui!==null&&(!(ui.expirationTime>e)||t&&!L0());){var i=ui.callback;if(typeof i=="function"){ui.callback=null,xn=ui.priorityLevel;var r=i(ui.expirationTime<=e);e=Dt.unstable_now(),typeof r=="function"?ui.callback=r:ui===yi(Vi)&&wc(Vi),ad(e)}else wc(Vi);ui=yi(Vi)}if(ui!==null)var s=!0;else{var o=yi(Or);o!==null&&hd(ld,o.startTime-e),s=!1}return s}finally{ui=null,xn=n,Ec=!1}}var Tc=!1,Mc=null,Ea=-1,P0=5,I0=-1;function L0(){return!(Dt.unstable_now()-I0<P0)}function rd(){if(Mc!==null){var t=Dt.unstable_now();I0=t;var e=!0;try{e=Mc(!0,t)}finally{e?Ma():(Tc=!1,Mc=null)}}else Tc=!1}var Ma;typeof b0=="function"?Ma=function(){b0(rd)}:typeof MessageChannel<"u"?(sd=new MessageChannel,A0=sd.port2,sd.port1.onmessage=rd,Ma=function(){A0.postMessage(null)}):Ma=function(){C0(rd,0)};var sd,A0;function ud(t){Mc=t,Tc||(Tc=!0,Ma())}function hd(t,e){Ea=C0(function(){t(Dt.unstable_now())},e)}Dt.unstable_IdlePriority=5;Dt.unstable_ImmediatePriority=1;Dt.unstable_LowPriority=4;Dt.unstable_NormalPriority=3;Dt.unstable_Profiling=null;Dt.unstable_UserBlockingPriority=2;Dt.unstable_cancelCallback=function(t){t.callback=null};Dt.unstable_continueExecution=function(){ws||Ec||(ws=!0,ud(cd))};Dt.unstable_forceFrameRate=function(t){0>t||125<t?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):P0=0<t?Math.floor(1e3/t):5};Dt.unstable_getCurrentPriorityLevel=function(){return xn};Dt.unstable_getFirstCallbackNode=function(){return yi(Vi)};Dt.unstable_next=function(t){switch(xn){case 1:case 2:case 3:var e=3;break;default:e=xn}var n=xn;xn=e;try{return t()}finally{xn=n}};Dt.unstable_pauseExecution=function(){};Dt.unstable_requestPaint=function(){};Dt.unstable_runWithPriority=function(t,e){switch(t){case 1:case 2:case 3:case 4:case 5:break;default:t=3}var n=xn;xn=t;try{return e()}finally{xn=n}};Dt.unstable_scheduleCallback=function(t,e,n){var i=Dt.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,t){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=n+r,t={id:mM++,callback:e,priorityLevel:t,startTime:n,expirationTime:r,sortIndex:-1},n>i?(t.sortIndex=n,od(Or,t),yi(Vi)===null&&t===yi(Or)&&(wa?(R0(Ea),Ea=-1):wa=!0,hd(ld,n-i))):(t.sortIndex=r,od(Vi,t),ws||Ec||(ws=!0,ud(cd))),t};Dt.unstable_shouldYield=L0;Dt.unstable_wrapCallback=function(t){var e=xn;return function(){var n=xn;xn=e;try{return t.apply(this,arguments)}finally{xn=n}}}});var U0=hr((BR,D0)=>{"use strict";D0.exports=N0()});var kx=hr(ei=>{"use strict";var gM=yc(),jn=U0();function he(t){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+t,n=1;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n]);return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var H_=new Set,qa={};function Fs(t,e){Co(t,e),Co(t+"Capture",e)}function Co(t,e){for(qa[t]=e,t=0;t<e.length;t++)H_.add(e[t])}var _r=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),Dd=Object.prototype.hasOwnProperty,_M=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,F0={},O0={};function vM(t){return Dd.call(O0,t)?!0:Dd.call(F0,t)?!1:_M.test(t)?O0[t]=!0:(F0[t]=!0,!1)}function xM(t,e,n,i){if(n!==null&&n.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:n!==null?!n.acceptsBooleans:(t=t.toLowerCase().slice(0,5),t!=="data-"&&t!=="aria-");default:return!1}}function yM(t,e,n,i){if(e===null||typeof e>"u"||xM(t,e,n,i))return!0;if(i)return!1;if(n!==null)switch(n.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function Nn(t,e,n,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=n,this.propertyName=t,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var gn={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t){gn[t]=new Nn(t,0,!1,t,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(t){var e=t[0];gn[e]=new Nn(e,1,!1,t[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(t){gn[t]=new Nn(t,2,!1,t.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(t){gn[t]=new Nn(t,2,!1,t,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t){gn[t]=new Nn(t,3,!1,t.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(t){gn[t]=new Nn(t,3,!0,t,null,!1,!1)});["capture","download"].forEach(function(t){gn[t]=new Nn(t,4,!1,t,null,!1,!1)});["cols","rows","size","span"].forEach(function(t){gn[t]=new Nn(t,6,!1,t,null,!1,!1)});["rowSpan","start"].forEach(function(t){gn[t]=new Nn(t,5,!1,t.toLowerCase(),null,!1,!1)});var bp=/[\-:]([a-z])/g;function Ap(t){return t[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t){var e=t.replace(bp,Ap);gn[e]=new Nn(e,1,!1,t,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t){var e=t.replace(bp,Ap);gn[e]=new Nn(e,1,!1,t,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(t){var e=t.replace(bp,Ap);gn[e]=new Nn(e,1,!1,t,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(t){gn[t]=new Nn(t,1,!1,t.toLowerCase(),null,!1,!1)});gn.xlinkHref=new Nn("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(t){gn[t]=new Nn(t,1,!1,t.toLowerCase(),null,!0,!0)});function Cp(t,e,n,i){var r=gn.hasOwnProperty(e)?gn[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(yM(e,n,r,i)&&(n=null),i||r===null?vM(e)&&(n===null?t.removeAttribute(e):t.setAttribute(e,""+n)):r.mustUseProperty?t[r.propertyName]=n===null?r.type===3?!1:"":n:(e=r.attributeName,i=r.attributeNamespace,n===null?t.removeAttribute(e):(r=r.type,n=r===3||r===4&&n===!0?"":""+n,i?t.setAttributeNS(i,e,n):t.setAttribute(e,n))))}var Sr=gM.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,bc=Symbol.for("react.element"),co=Symbol.for("react.portal"),uo=Symbol.for("react.fragment"),Rp=Symbol.for("react.strict_mode"),Ud=Symbol.for("react.profiler"),G_=Symbol.for("react.provider"),W_=Symbol.for("react.context"),Pp=Symbol.for("react.forward_ref"),Fd=Symbol.for("react.suspense"),Od=Symbol.for("react.suspense_list"),Ip=Symbol.for("react.memo"),kr=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var X_=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var B0=Symbol.iterator;function Ta(t){return t===null||typeof t!="object"?null:(t=B0&&t[B0]||t["@@iterator"],typeof t=="function"?t:null)}var Xt=Object.assign,fd;function Na(t){if(fd===void 0)try{throw Error()}catch(n){var e=n.stack.trim().match(/\n( *(at )?)/);fd=e&&e[1]||""}return`
`+fd+t}var dd=!1;function pd(t,e){if(!t||dd)return"";dd=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(c){var i=c}Reflect.construct(t,[],e)}else{try{e.call()}catch(c){i=c}t.call(e.prototype)}else{try{throw Error()}catch(c){i=c}t()}}catch(c){if(c&&i&&typeof c.stack=="string"){for(var r=c.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return t.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",t.displayName)),l}while(1<=o&&0<=a);break}}}finally{dd=!1,Error.prepareStackTrace=n}return(t=t?t.displayName||t.name:"")?Na(t):""}function SM(t){switch(t.tag){case 5:return Na(t.type);case 16:return Na("Lazy");case 13:return Na("Suspense");case 19:return Na("SuspenseList");case 0:case 2:case 15:return t=pd(t.type,!1),t;case 11:return t=pd(t.type.render,!1),t;case 1:return t=pd(t.type,!0),t;default:return""}}function Bd(t){if(t==null)return null;if(typeof t=="function")return t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case uo:return"Fragment";case co:return"Portal";case Ud:return"Profiler";case Rp:return"StrictMode";case Fd:return"Suspense";case Od:return"SuspenseList"}if(typeof t=="object")switch(t.$$typeof){case W_:return(t.displayName||"Context")+".Consumer";case G_:return(t._context.displayName||"Context")+".Provider";case Pp:var e=t.render;return t=t.displayName,t||(t=e.displayName||e.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case Ip:return e=t.displayName||null,e!==null?e:Bd(t.type)||"Memo";case kr:e=t._payload,t=t._init;try{return Bd(t(e))}catch{}}return null}function MM(t){var e=t.type;switch(t.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return t=e.render,t=t.displayName||t.name||"",e.displayName||(t!==""?"ForwardRef("+t+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return Bd(e);case 8:return e===Rp?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function Qr(t){switch(typeof t){case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function q_(t){var e=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function wM(t){var e=q_(t)?"checked":"value",n=Object.getOwnPropertyDescriptor(t.constructor.prototype,e),i=""+t[e];if(!t.hasOwnProperty(e)&&typeof n<"u"&&typeof n.get=="function"&&typeof n.set=="function"){var r=n.get,s=n.set;return Object.defineProperty(t,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(t,e,{enumerable:n.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){t._valueTracker=null,delete t[e]}}}}function Ac(t){t._valueTracker||(t._valueTracker=wM(t))}function Y_(t){if(!t)return!1;var e=t._valueTracker;if(!e)return!0;var n=e.getValue(),i="";return t&&(i=q_(t)?t.checked?"true":"false":t.value),t=i,t!==n?(e.setValue(t),!0):!1}function tu(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}function kd(t,e){var n=e.checked;return Xt({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??t._wrapperState.initialChecked})}function k0(t,e){var n=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;n=Qr(e.value!=null?e.value:n),t._wrapperState={initialChecked:i,initialValue:n,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function $_(t,e){e=e.checked,e!=null&&Cp(t,"checked",e,!1)}function zd(t,e){$_(t,e);var n=Qr(e.value),i=e.type;if(n!=null)i==="number"?(n===0&&t.value===""||t.value!=n)&&(t.value=""+n):t.value!==""+n&&(t.value=""+n);else if(i==="submit"||i==="reset"){t.removeAttribute("value");return}e.hasOwnProperty("value")?Vd(t,e.type,n):e.hasOwnProperty("defaultValue")&&Vd(t,e.type,Qr(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(t.defaultChecked=!!e.defaultChecked)}function z0(t,e,n){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+t._wrapperState.initialValue,n||e===t.value||(t.value=e),t.defaultValue=e}n=t.name,n!==""&&(t.name=""),t.defaultChecked=!!t._wrapperState.initialChecked,n!==""&&(t.name=n)}function Vd(t,e,n){(e!=="number"||tu(t.ownerDocument)!==t)&&(n==null?t.defaultValue=""+t._wrapperState.initialValue:t.defaultValue!==""+n&&(t.defaultValue=""+n))}var Da=Array.isArray;function Mo(t,e,n,i){if(t=t.options,e){e={};for(var r=0;r<n.length;r++)e["$"+n[r]]=!0;for(n=0;n<t.length;n++)r=e.hasOwnProperty("$"+t[n].value),t[n].selected!==r&&(t[n].selected=r),r&&i&&(t[n].defaultSelected=!0)}else{for(n=""+Qr(n),e=null,r=0;r<t.length;r++){if(t[r].value===n){t[r].selected=!0,i&&(t[r].defaultSelected=!0);return}e!==null||t[r].disabled||(e=t[r])}e!==null&&(e.selected=!0)}}function Hd(t,e){if(e.dangerouslySetInnerHTML!=null)throw Error(he(91));return Xt({},e,{value:void 0,defaultValue:void 0,children:""+t._wrapperState.initialValue})}function V0(t,e){var n=e.value;if(n==null){if(n=e.children,e=e.defaultValue,n!=null){if(e!=null)throw Error(he(92));if(Da(n)){if(1<n.length)throw Error(he(93));n=n[0]}e=n}e==null&&(e=""),n=e}t._wrapperState={initialValue:Qr(n)}}function Z_(t,e){var n=Qr(e.value),i=Qr(e.defaultValue);n!=null&&(n=""+n,n!==t.value&&(t.value=n),e.defaultValue==null&&t.defaultValue!==n&&(t.defaultValue=n)),i!=null&&(t.defaultValue=""+i)}function H0(t){var e=t.textContent;e===t._wrapperState.initialValue&&e!==""&&e!==null&&(t.value=e)}function K_(t){switch(t){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function Gd(t,e){return t==null||t==="http://www.w3.org/1999/xhtml"?K_(e):t==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":t}var Cc,J_=function(t){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,n,i,r){MSApp.execUnsafeLocalFunction(function(){return t(e,n,i,r)})}:t}(function(t,e){if(t.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in t)t.innerHTML=e;else{for(Cc=Cc||document.createElement("div"),Cc.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=Cc.firstChild;t.firstChild;)t.removeChild(t.firstChild);for(;e.firstChild;)t.appendChild(e.firstChild)}});function Ya(t,e){if(e){var n=t.firstChild;if(n&&n===t.lastChild&&n.nodeType===3){n.nodeValue=e;return}}t.textContent=e}var Oa={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},EM=["Webkit","ms","Moz","O"];Object.keys(Oa).forEach(function(t){EM.forEach(function(e){e=e+t.charAt(0).toUpperCase()+t.substring(1),Oa[e]=Oa[t]})});function j_(t,e,n){return e==null||typeof e=="boolean"||e===""?"":n||typeof e!="number"||e===0||Oa.hasOwnProperty(t)&&Oa[t]?(""+e).trim():e+"px"}function Q_(t,e){t=t.style;for(var n in e)if(e.hasOwnProperty(n)){var i=n.indexOf("--")===0,r=j_(n,e[n],i);n==="float"&&(n="cssFloat"),i?t.setProperty(n,r):t[n]=r}}var TM=Xt({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function Wd(t,e){if(e){if(TM[t]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(he(137,t));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(he(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(he(61))}if(e.style!=null&&typeof e.style!="object")throw Error(he(62))}}function Xd(t,e){if(t.indexOf("-")===-1)return typeof e.is=="string";switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var qd=null;function Lp(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var Yd=null,wo=null,Eo=null;function G0(t){if(t=hl(t)){if(typeof Yd!="function")throw Error(he(280));var e=t.stateNode;e&&(e=Ru(e),Yd(t.stateNode,t.type,e))}}function ev(t){wo?Eo?Eo.push(t):Eo=[t]:wo=t}function tv(){if(wo){var t=wo,e=Eo;if(Eo=wo=null,G0(t),e)for(t=0;t<e.length;t++)G0(e[t])}}function nv(t,e){return t(e)}function iv(){}var md=!1;function rv(t,e,n){if(md)return t(e,n);md=!0;try{return nv(t,e,n)}finally{md=!1,(wo!==null||Eo!==null)&&(iv(),tv())}}function $a(t,e){var n=t.stateNode;if(n===null)return null;var i=Ru(n);if(i===null)return null;n=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(t=t.type,i=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!i;break e;default:t=!1}if(t)return null;if(n&&typeof n!="function")throw Error(he(231,e,typeof n));return n}var $d=!1;if(_r)try{ao={},Object.defineProperty(ao,"passive",{get:function(){$d=!0}}),window.addEventListener("test",ao,ao),window.removeEventListener("test",ao,ao)}catch{$d=!1}var ao;function bM(t,e,n,i,r,s,o,a,l){var c=Array.prototype.slice.call(arguments,3);try{e.apply(n,c)}catch(f){this.onError(f)}}var Ba=!1,nu=null,iu=!1,Zd=null,AM={onError:function(t){Ba=!0,nu=t}};function CM(t,e,n,i,r,s,o,a,l){Ba=!1,nu=null,bM.apply(AM,arguments)}function RM(t,e,n,i,r,s,o,a,l){if(CM.apply(this,arguments),Ba){if(Ba){var c=nu;Ba=!1,nu=null}else throw Error(he(198));iu||(iu=!0,Zd=c)}}function Os(t){var e=t,n=t;if(t.alternate)for(;e.return;)e=e.return;else{t=e;do e=t,e.flags&4098&&(n=e.return),t=e.return;while(t)}return e.tag===3?n:null}function sv(t){if(t.tag===13){var e=t.memoizedState;if(e===null&&(t=t.alternate,t!==null&&(e=t.memoizedState)),e!==null)return e.dehydrated}return null}function W0(t){if(Os(t)!==t)throw Error(he(188))}function PM(t){var e=t.alternate;if(!e){if(e=Os(t),e===null)throw Error(he(188));return e!==t?null:t}for(var n=t,i=e;;){var r=n.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){n=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===n)return W0(r),t;if(s===i)return W0(r),e;s=s.sibling}throw Error(he(188))}if(n.return!==i.return)n=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===n){o=!0,n=r,i=s;break}if(a===i){o=!0,i=r,n=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===n){o=!0,n=s,i=r;break}if(a===i){o=!0,i=s,n=r;break}a=a.sibling}if(!o)throw Error(he(189))}}if(n.alternate!==i)throw Error(he(190))}if(n.tag!==3)throw Error(he(188));return n.stateNode.current===n?t:e}function ov(t){return t=PM(t),t!==null?av(t):null}function av(t){if(t.tag===5||t.tag===6)return t;for(t=t.child;t!==null;){var e=av(t);if(e!==null)return e;t=t.sibling}return null}var lv=jn.unstable_scheduleCallback,X0=jn.unstable_cancelCallback,IM=jn.unstable_shouldYield,LM=jn.unstable_requestPaint,Jt=jn.unstable_now,NM=jn.unstable_getCurrentPriorityLevel,Np=jn.unstable_ImmediatePriority,cv=jn.unstable_UserBlockingPriority,ru=jn.unstable_NormalPriority,DM=jn.unstable_LowPriority,uv=jn.unstable_IdlePriority,Tu=null,Xi=null;function UM(t){if(Xi&&typeof Xi.onCommitFiberRoot=="function")try{Xi.onCommitFiberRoot(Tu,t,void 0,(t.current.flags&128)===128)}catch{}}var Ti=Math.clz32?Math.clz32:BM,FM=Math.log,OM=Math.LN2;function BM(t){return t>>>=0,t===0?32:31-(FM(t)/OM|0)|0}var Rc=64,Pc=4194304;function Ua(t){switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return t&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return t}}function su(t,e){var n=t.pendingLanes;if(n===0)return 0;var i=0,r=t.suspendedLanes,s=t.pingedLanes,o=n&268435455;if(o!==0){var a=o&~r;a!==0?i=Ua(a):(s&=o,s!==0&&(i=Ua(s)))}else o=n&~r,o!==0?i=Ua(o):s!==0&&(i=Ua(s));if(i===0)return 0;if(e!==0&&e!==i&&!(e&r)&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if(i&4&&(i|=n&16),e=t.entangledLanes,e!==0)for(t=t.entanglements,e&=i;0<e;)n=31-Ti(e),r=1<<n,i|=t[n],e&=~r;return i}function kM(t,e){switch(t){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function zM(t,e){for(var n=t.suspendedLanes,i=t.pingedLanes,r=t.expirationTimes,s=t.pendingLanes;0<s;){var o=31-Ti(s),a=1<<o,l=r[o];l===-1?(!(a&n)||a&i)&&(r[o]=kM(a,e)):l<=e&&(t.expiredLanes|=a),s&=~a}}function Kd(t){return t=t.pendingLanes&-1073741825,t!==0?t:t&1073741824?1073741824:0}function hv(){var t=Rc;return Rc<<=1,!(Rc&4194240)&&(Rc=64),t}function gd(t){for(var e=[],n=0;31>n;n++)e.push(t);return e}function cl(t,e,n){t.pendingLanes|=e,e!==536870912&&(t.suspendedLanes=0,t.pingedLanes=0),t=t.eventTimes,e=31-Ti(e),t[e]=n}function VM(t,e){var n=t.pendingLanes&~e;t.pendingLanes=e,t.suspendedLanes=0,t.pingedLanes=0,t.expiredLanes&=e,t.mutableReadLanes&=e,t.entangledLanes&=e,e=t.entanglements;var i=t.eventTimes;for(t=t.expirationTimes;0<n;){var r=31-Ti(n),s=1<<r;e[r]=0,i[r]=-1,t[r]=-1,n&=~s}}function Dp(t,e){var n=t.entangledLanes|=e;for(t=t.entanglements;n;){var i=31-Ti(n),r=1<<i;r&e|t[i]&e&&(t[i]|=e),n&=~r}}var Pt=0;function fv(t){return t&=-t,1<t?4<t?t&268435455?16:536870912:4:1}var dv,Up,pv,mv,gv,Jd=!1,Ic=[],Xr=null,qr=null,Yr=null,Za=new Map,Ka=new Map,Vr=[],HM="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function q0(t,e){switch(t){case"focusin":case"focusout":Xr=null;break;case"dragenter":case"dragleave":qr=null;break;case"mouseover":case"mouseout":Yr=null;break;case"pointerover":case"pointerout":Za.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":Ka.delete(e.pointerId)}}function ba(t,e,n,i,r,s){return t===null||t.nativeEvent!==s?(t={blockedOn:e,domEventName:n,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=hl(e),e!==null&&Up(e)),t):(t.eventSystemFlags|=i,e=t.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),t)}function GM(t,e,n,i,r){switch(e){case"focusin":return Xr=ba(Xr,t,e,n,i,r),!0;case"dragenter":return qr=ba(qr,t,e,n,i,r),!0;case"mouseover":return Yr=ba(Yr,t,e,n,i,r),!0;case"pointerover":var s=r.pointerId;return Za.set(s,ba(Za.get(s)||null,t,e,n,i,r)),!0;case"gotpointercapture":return s=r.pointerId,Ka.set(s,ba(Ka.get(s)||null,t,e,n,i,r)),!0}return!1}function _v(t){var e=bs(t.target);if(e!==null){var n=Os(e);if(n!==null){if(e=n.tag,e===13){if(e=sv(n),e!==null){t.blockedOn=e,gv(t.priority,function(){pv(n)});return}}else if(e===3&&n.stateNode.current.memoizedState.isDehydrated){t.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}t.blockedOn=null}function Xc(t){if(t.blockedOn!==null)return!1;for(var e=t.targetContainers;0<e.length;){var n=jd(t.domEventName,t.eventSystemFlags,e[0],t.nativeEvent);if(n===null){n=t.nativeEvent;var i=new n.constructor(n.type,n);qd=i,n.target.dispatchEvent(i),qd=null}else return e=hl(n),e!==null&&Up(e),t.blockedOn=n,!1;e.shift()}return!0}function Y0(t,e,n){Xc(t)&&n.delete(e)}function WM(){Jd=!1,Xr!==null&&Xc(Xr)&&(Xr=null),qr!==null&&Xc(qr)&&(qr=null),Yr!==null&&Xc(Yr)&&(Yr=null),Za.forEach(Y0),Ka.forEach(Y0)}function Aa(t,e){t.blockedOn===e&&(t.blockedOn=null,Jd||(Jd=!0,jn.unstable_scheduleCallback(jn.unstable_NormalPriority,WM)))}function Ja(t){function e(r){return Aa(r,t)}if(0<Ic.length){Aa(Ic[0],t);for(var n=1;n<Ic.length;n++){var i=Ic[n];i.blockedOn===t&&(i.blockedOn=null)}}for(Xr!==null&&Aa(Xr,t),qr!==null&&Aa(qr,t),Yr!==null&&Aa(Yr,t),Za.forEach(e),Ka.forEach(e),n=0;n<Vr.length;n++)i=Vr[n],i.blockedOn===t&&(i.blockedOn=null);for(;0<Vr.length&&(n=Vr[0],n.blockedOn===null);)_v(n),n.blockedOn===null&&Vr.shift()}var To=Sr.ReactCurrentBatchConfig,ou=!0;function XM(t,e,n,i){var r=Pt,s=To.transition;To.transition=null;try{Pt=1,Fp(t,e,n,i)}finally{Pt=r,To.transition=s}}function qM(t,e,n,i){var r=Pt,s=To.transition;To.transition=null;try{Pt=4,Fp(t,e,n,i)}finally{Pt=r,To.transition=s}}function Fp(t,e,n,i){if(ou){var r=jd(t,e,n,i);if(r===null)wd(t,e,i,au,n),q0(t,i);else if(GM(r,t,e,n,i))i.stopPropagation();else if(q0(t,i),e&4&&-1<HM.indexOf(t)){for(;r!==null;){var s=hl(r);if(s!==null&&dv(s),s=jd(t,e,n,i),s===null&&wd(t,e,i,au,n),s===r)break;r=s}r!==null&&i.stopPropagation()}else wd(t,e,i,null,n)}}var au=null;function jd(t,e,n,i){if(au=null,t=Lp(i),t=bs(t),t!==null)if(e=Os(t),e===null)t=null;else if(n=e.tag,n===13){if(t=sv(e),t!==null)return t;t=null}else if(n===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;t=null}else e!==t&&(t=null);return au=t,null}function vv(t){switch(t){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(NM()){case Np:return 1;case cv:return 4;case ru:case DM:return 16;case uv:return 536870912;default:return 16}default:return 16}}var Gr=null,Op=null,qc=null;function xv(){if(qc)return qc;var t,e=Op,n=e.length,i,r="value"in Gr?Gr.value:Gr.textContent,s=r.length;for(t=0;t<n&&e[t]===r[t];t++);var o=n-t;for(i=1;i<=o&&e[n-i]===r[s-i];i++);return qc=r.slice(t,1<i?1-i:void 0)}function Yc(t){var e=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&e===13&&(t=13)):t=e,t===10&&(t=13),32<=t||t===13?t:0}function Lc(){return!0}function $0(){return!1}function Qn(t){function e(n,i,r,s,o){this._reactName=n,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in t)t.hasOwnProperty(a)&&(n=t[a],this[a]=n?n(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?Lc:$0,this.isPropagationStopped=$0,this}return Xt(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=Lc)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=Lc)},persist:function(){},isPersistent:Lc}),e}var Uo={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},Bp=Qn(Uo),ul=Xt({},Uo,{view:0,detail:0}),YM=Qn(ul),_d,vd,Ca,bu=Xt({},ul,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:kp,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==Ca&&(Ca&&t.type==="mousemove"?(_d=t.screenX-Ca.screenX,vd=t.screenY-Ca.screenY):vd=_d=0,Ca=t),_d)},movementY:function(t){return"movementY"in t?t.movementY:vd}}),Z0=Qn(bu),$M=Xt({},bu,{dataTransfer:0}),ZM=Qn($M),KM=Xt({},ul,{relatedTarget:0}),xd=Qn(KM),JM=Xt({},Uo,{animationName:0,elapsedTime:0,pseudoElement:0}),jM=Qn(JM),QM=Xt({},Uo,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),e1=Qn(QM),t1=Xt({},Uo,{data:0}),K0=Qn(t1),n1={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},i1={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},r1={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function s1(t){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(t):(t=r1[t])?!!e[t]:!1}function kp(){return s1}var o1=Xt({},ul,{key:function(t){if(t.key){var e=n1[t.key]||t.key;if(e!=="Unidentified")return e}return t.type==="keypress"?(t=Yc(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?i1[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:kp,charCode:function(t){return t.type==="keypress"?Yc(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?Yc(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),a1=Qn(o1),l1=Xt({},bu,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),J0=Qn(l1),c1=Xt({},ul,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:kp}),u1=Qn(c1),h1=Xt({},Uo,{propertyName:0,elapsedTime:0,pseudoElement:0}),f1=Qn(h1),d1=Xt({},bu,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),p1=Qn(d1),m1=[9,13,27,32],zp=_r&&"CompositionEvent"in window,ka=null;_r&&"documentMode"in document&&(ka=document.documentMode);var g1=_r&&"TextEvent"in window&&!ka,yv=_r&&(!zp||ka&&8<ka&&11>=ka),j0=" ",Q0=!1;function Sv(t,e){switch(t){case"keyup":return m1.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function Mv(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var ho=!1;function _1(t,e){switch(t){case"compositionend":return Mv(e);case"keypress":return e.which!==32?null:(Q0=!0,j0);case"textInput":return t=e.data,t===j0&&Q0?null:t;default:return null}}function v1(t,e){if(ho)return t==="compositionend"||!zp&&Sv(t,e)?(t=xv(),qc=Op=Gr=null,ho=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return yv&&e.locale!=="ko"?null:e.data;default:return null}}var x1={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function e_(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e==="input"?!!x1[t.type]:e==="textarea"}function wv(t,e,n,i){ev(i),e=lu(e,"onChange"),0<e.length&&(n=new Bp("onChange","change",null,n,i),t.push({event:n,listeners:e}))}var za=null,ja=null;function y1(t){Dv(t,0)}function Au(t){var e=mo(t);if(Y_(e))return t}function S1(t,e){if(t==="change")return e}var Ev=!1;_r&&(_r?(Dc="oninput"in document,Dc||(yd=document.createElement("div"),yd.setAttribute("oninput","return;"),Dc=typeof yd.oninput=="function"),Nc=Dc):Nc=!1,Ev=Nc&&(!document.documentMode||9<document.documentMode));var Nc,Dc,yd;function t_(){za&&(za.detachEvent("onpropertychange",Tv),ja=za=null)}function Tv(t){if(t.propertyName==="value"&&Au(ja)){var e=[];wv(e,ja,t,Lp(t)),rv(y1,e)}}function M1(t,e,n){t==="focusin"?(t_(),za=e,ja=n,za.attachEvent("onpropertychange",Tv)):t==="focusout"&&t_()}function w1(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return Au(ja)}function E1(t,e){if(t==="click")return Au(e)}function T1(t,e){if(t==="input"||t==="change")return Au(e)}function b1(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var Ai=typeof Object.is=="function"?Object.is:b1;function Qa(t,e){if(Ai(t,e))return!0;if(typeof t!="object"||t===null||typeof e!="object"||e===null)return!1;var n=Object.keys(t),i=Object.keys(e);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var r=n[i];if(!Dd.call(e,r)||!Ai(t[r],e[r]))return!1}return!0}function n_(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function i_(t,e){var n=n_(t);t=0;for(var i;n;){if(n.nodeType===3){if(i=t+n.textContent.length,t<=e&&i>=e)return{node:n,offset:e-t};t=i}e:{for(;n;){if(n.nextSibling){n=n.nextSibling;break e}n=n.parentNode}n=void 0}n=n_(n)}}function bv(t,e){return t&&e?t===e?!0:t&&t.nodeType===3?!1:e&&e.nodeType===3?bv(t,e.parentNode):"contains"in t?t.contains(e):t.compareDocumentPosition?!!(t.compareDocumentPosition(e)&16):!1:!1}function Av(){for(var t=window,e=tu();e instanceof t.HTMLIFrameElement;){try{var n=typeof e.contentWindow.location.href=="string"}catch{n=!1}if(n)t=e.contentWindow;else break;e=tu(t.document)}return e}function Vp(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e&&(e==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||e==="textarea"||t.contentEditable==="true")}function A1(t){var e=Av(),n=t.focusedElem,i=t.selectionRange;if(e!==n&&n&&n.ownerDocument&&bv(n.ownerDocument.documentElement,n)){if(i!==null&&Vp(n)){if(e=i.start,t=i.end,t===void 0&&(t=e),"selectionStart"in n)n.selectionStart=e,n.selectionEnd=Math.min(t,n.value.length);else if(t=(e=n.ownerDocument||document)&&e.defaultView||window,t.getSelection){t=t.getSelection();var r=n.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!t.extend&&s>i&&(r=i,i=s,s=r),r=i_(n,s);var o=i_(n,i);r&&o&&(t.rangeCount!==1||t.anchorNode!==r.node||t.anchorOffset!==r.offset||t.focusNode!==o.node||t.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),t.removeAllRanges(),s>i?(t.addRange(e),t.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),t.addRange(e)))}}for(e=[],t=n;t=t.parentNode;)t.nodeType===1&&e.push({element:t,left:t.scrollLeft,top:t.scrollTop});for(typeof n.focus=="function"&&n.focus(),n=0;n<e.length;n++)t=e[n],t.element.scrollLeft=t.left,t.element.scrollTop=t.top}}var C1=_r&&"documentMode"in document&&11>=document.documentMode,fo=null,Qd=null,Va=null,ep=!1;function r_(t,e,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;ep||fo==null||fo!==tu(i)||(i=fo,"selectionStart"in i&&Vp(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),Va&&Qa(Va,i)||(Va=i,i=lu(Qd,"onSelect"),0<i.length&&(e=new Bp("onSelect","select",null,e,n),t.push({event:e,listeners:i}),e.target=fo)))}function Uc(t,e){var n={};return n[t.toLowerCase()]=e.toLowerCase(),n["Webkit"+t]="webkit"+e,n["Moz"+t]="moz"+e,n}var po={animationend:Uc("Animation","AnimationEnd"),animationiteration:Uc("Animation","AnimationIteration"),animationstart:Uc("Animation","AnimationStart"),transitionend:Uc("Transition","TransitionEnd")},Sd={},Cv={};_r&&(Cv=document.createElement("div").style,"AnimationEvent"in window||(delete po.animationend.animation,delete po.animationiteration.animation,delete po.animationstart.animation),"TransitionEvent"in window||delete po.transitionend.transition);function Cu(t){if(Sd[t])return Sd[t];if(!po[t])return t;var e=po[t],n;for(n in e)if(e.hasOwnProperty(n)&&n in Cv)return Sd[t]=e[n];return t}var Rv=Cu("animationend"),Pv=Cu("animationiteration"),Iv=Cu("animationstart"),Lv=Cu("transitionend"),Nv=new Map,s_="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function ts(t,e){Nv.set(t,e),Fs(e,[t])}for(Fc=0;Fc<s_.length;Fc++)Oc=s_[Fc],o_=Oc.toLowerCase(),a_=Oc[0].toUpperCase()+Oc.slice(1),ts(o_,"on"+a_);var Oc,o_,a_,Fc;ts(Rv,"onAnimationEnd");ts(Pv,"onAnimationIteration");ts(Iv,"onAnimationStart");ts("dblclick","onDoubleClick");ts("focusin","onFocus");ts("focusout","onBlur");ts(Lv,"onTransitionEnd");Co("onMouseEnter",["mouseout","mouseover"]);Co("onMouseLeave",["mouseout","mouseover"]);Co("onPointerEnter",["pointerout","pointerover"]);Co("onPointerLeave",["pointerout","pointerover"]);Fs("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));Fs("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));Fs("onBeforeInput",["compositionend","keypress","textInput","paste"]);Fs("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));Fs("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));Fs("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var Fa="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),R1=new Set("cancel close invalid load scroll toggle".split(" ").concat(Fa));function l_(t,e,n){var i=t.type||"unknown-event";t.currentTarget=n,RM(i,e,void 0,t),t.currentTarget=null}function Dv(t,e){e=(e&4)!==0;for(var n=0;n<t.length;n++){var i=t[n],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,c=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;l_(r,a,c),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,c=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;l_(r,a,c),s=l}}}if(iu)throw t=Zd,iu=!1,Zd=null,t}function Ot(t,e){var n=e[sp];n===void 0&&(n=e[sp]=new Set);var i=t+"__bubble";n.has(i)||(Uv(e,t,2,!1),n.add(i))}function Md(t,e,n){var i=0;e&&(i|=4),Uv(n,t,i,e)}var Bc="_reactListening"+Math.random().toString(36).slice(2);function el(t){if(!t[Bc]){t[Bc]=!0,H_.forEach(function(n){n!=="selectionchange"&&(R1.has(n)||Md(n,!1,t),Md(n,!0,t))});var e=t.nodeType===9?t:t.ownerDocument;e===null||e[Bc]||(e[Bc]=!0,Md("selectionchange",!1,e))}}function Uv(t,e,n,i){switch(vv(e)){case 1:var r=XM;break;case 4:r=qM;break;default:r=Fp}n=r.bind(null,e,n,t),r=void 0,!$d||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?t.addEventListener(e,n,{capture:!0,passive:r}):t.addEventListener(e,n,!0):r!==void 0?t.addEventListener(e,n,{passive:r}):t.addEventListener(e,n,!1)}function wd(t,e,n,i,r){var s=i;if(!(e&1)&&!(e&2)&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=bs(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}rv(function(){var c=s,f=Lp(n),d=[];e:{var h=Nv.get(t);if(h!==void 0){var p=Bp,_=t;switch(t){case"keypress":if(Yc(n)===0)break e;case"keydown":case"keyup":p=a1;break;case"focusin":_="focus",p=xd;break;case"focusout":_="blur",p=xd;break;case"beforeblur":case"afterblur":p=xd;break;case"click":if(n.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":p=Z0;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":p=ZM;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":p=u1;break;case Rv:case Pv:case Iv:p=jM;break;case Lv:p=f1;break;case"scroll":p=YM;break;case"wheel":p=p1;break;case"copy":case"cut":case"paste":p=e1;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":p=J0}var y=(e&4)!==0,m=!y&&t==="scroll",u=y?h!==null?h+"Capture":null:h;y=[];for(var g=c,v;g!==null;){v=g;var S=v.stateNode;if(v.tag===5&&S!==null&&(v=S,u!==null&&(S=$a(g,u),S!=null&&y.push(tl(g,S,v)))),m)break;g=g.return}0<y.length&&(h=new p(h,_,null,n,f),d.push({event:h,listeners:y}))}}if(!(e&7)){e:{if(h=t==="mouseover"||t==="pointerover",p=t==="mouseout"||t==="pointerout",h&&n!==qd&&(_=n.relatedTarget||n.fromElement)&&(bs(_)||_[vr]))break e;if((p||h)&&(h=f.window===f?f:(h=f.ownerDocument)?h.defaultView||h.parentWindow:window,p?(_=n.relatedTarget||n.toElement,p=c,_=_?bs(_):null,_!==null&&(m=Os(_),_!==m||_.tag!==5&&_.tag!==6)&&(_=null)):(p=null,_=c),p!==_)){if(y=Z0,S="onMouseLeave",u="onMouseEnter",g="mouse",(t==="pointerout"||t==="pointerover")&&(y=J0,S="onPointerLeave",u="onPointerEnter",g="pointer"),m=p==null?h:mo(p),v=_==null?h:mo(_),h=new y(S,g+"leave",p,n,f),h.target=m,h.relatedTarget=v,S=null,bs(f)===c&&(y=new y(u,g+"enter",_,n,f),y.target=v,y.relatedTarget=m,S=y),m=S,p&&_)t:{for(y=p,u=_,g=0,v=y;v;v=lo(v))g++;for(v=0,S=u;S;S=lo(S))v++;for(;0<g-v;)y=lo(y),g--;for(;0<v-g;)u=lo(u),v--;for(;g--;){if(y===u||u!==null&&y===u.alternate)break t;y=lo(y),u=lo(u)}y=null}else y=null;p!==null&&c_(d,h,p,y,!1),_!==null&&m!==null&&c_(d,m,_,y,!0)}}e:{if(h=c?mo(c):window,p=h.nodeName&&h.nodeName.toLowerCase(),p==="select"||p==="input"&&h.type==="file")var A=S1;else if(e_(h))if(Ev)A=T1;else{A=w1;var w=M1}else(p=h.nodeName)&&p.toLowerCase()==="input"&&(h.type==="checkbox"||h.type==="radio")&&(A=E1);if(A&&(A=A(t,c))){wv(d,A,n,f);break e}w&&w(t,h,c),t==="focusout"&&(w=h._wrapperState)&&w.controlled&&h.type==="number"&&Vd(h,"number",h.value)}switch(w=c?mo(c):window,t){case"focusin":(e_(w)||w.contentEditable==="true")&&(fo=w,Qd=c,Va=null);break;case"focusout":Va=Qd=fo=null;break;case"mousedown":ep=!0;break;case"contextmenu":case"mouseup":case"dragend":ep=!1,r_(d,n,f);break;case"selectionchange":if(C1)break;case"keydown":case"keyup":r_(d,n,f)}var C;if(zp)e:{switch(t){case"compositionstart":var x="onCompositionStart";break e;case"compositionend":x="onCompositionEnd";break e;case"compositionupdate":x="onCompositionUpdate";break e}x=void 0}else ho?Sv(t,n)&&(x="onCompositionEnd"):t==="keydown"&&n.keyCode===229&&(x="onCompositionStart");x&&(yv&&n.locale!=="ko"&&(ho||x!=="onCompositionStart"?x==="onCompositionEnd"&&ho&&(C=xv()):(Gr=f,Op="value"in Gr?Gr.value:Gr.textContent,ho=!0)),w=lu(c,x),0<w.length&&(x=new K0(x,t,null,n,f),d.push({event:x,listeners:w}),C?x.data=C:(C=Mv(n),C!==null&&(x.data=C)))),(C=g1?_1(t,n):v1(t,n))&&(c=lu(c,"onBeforeInput"),0<c.length&&(f=new K0("onBeforeInput","beforeinput",null,n,f),d.push({event:f,listeners:c}),f.data=C))}Dv(d,e)})}function tl(t,e,n){return{instance:t,listener:e,currentTarget:n}}function lu(t,e){for(var n=e+"Capture",i=[];t!==null;){var r=t,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=$a(t,n),s!=null&&i.unshift(tl(t,s,r)),s=$a(t,e),s!=null&&i.push(tl(t,s,r))),t=t.return}return i}function lo(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5);return t||null}function c_(t,e,n,i,r){for(var s=e._reactName,o=[];n!==null&&n!==i;){var a=n,l=a.alternate,c=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&c!==null&&(a=c,r?(l=$a(n,s),l!=null&&o.unshift(tl(n,l,a))):r||(l=$a(n,s),l!=null&&o.push(tl(n,l,a)))),n=n.return}o.length!==0&&t.push({event:e,listeners:o})}var P1=/\r\n?/g,I1=/\u0000|\uFFFD/g;function u_(t){return(typeof t=="string"?t:""+t).replace(P1,`
`).replace(I1,"")}function kc(t,e,n){if(e=u_(e),u_(t)!==e&&n)throw Error(he(425))}function cu(){}var tp=null,np=null;function ip(t,e){return t==="textarea"||t==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var rp=typeof setTimeout=="function"?setTimeout:void 0,L1=typeof clearTimeout=="function"?clearTimeout:void 0,h_=typeof Promise=="function"?Promise:void 0,N1=typeof queueMicrotask=="function"?queueMicrotask:typeof h_<"u"?function(t){return h_.resolve(null).then(t).catch(D1)}:rp;function D1(t){setTimeout(function(){throw t})}function Ed(t,e){var n=e,i=0;do{var r=n.nextSibling;if(t.removeChild(n),r&&r.nodeType===8)if(n=r.data,n==="/$"){if(i===0){t.removeChild(r),Ja(e);return}i--}else n!=="$"&&n!=="$?"&&n!=="$!"||i++;n=r}while(n);Ja(e)}function $r(t){for(;t!=null;t=t.nextSibling){var e=t.nodeType;if(e===1||e===3)break;if(e===8){if(e=t.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return t}function f_(t){t=t.previousSibling;for(var e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="$"||n==="$!"||n==="$?"){if(e===0)return t;e--}else n==="/$"&&e++}t=t.previousSibling}return null}var Fo=Math.random().toString(36).slice(2),Wi="__reactFiber$"+Fo,nl="__reactProps$"+Fo,vr="__reactContainer$"+Fo,sp="__reactEvents$"+Fo,U1="__reactListeners$"+Fo,F1="__reactHandles$"+Fo;function bs(t){var e=t[Wi];if(e)return e;for(var n=t.parentNode;n;){if(e=n[vr]||n[Wi]){if(n=e.alternate,e.child!==null||n!==null&&n.child!==null)for(t=f_(t);t!==null;){if(n=t[Wi])return n;t=f_(t)}return e}t=n,n=t.parentNode}return null}function hl(t){return t=t[Wi]||t[vr],!t||t.tag!==5&&t.tag!==6&&t.tag!==13&&t.tag!==3?null:t}function mo(t){if(t.tag===5||t.tag===6)return t.stateNode;throw Error(he(33))}function Ru(t){return t[nl]||null}var op=[],go=-1;function ns(t){return{current:t}}function Bt(t){0>go||(t.current=op[go],op[go]=null,go--)}function Ut(t,e){go++,op[go]=t.current,t.current=e}var es={},wn=ns(es),Gn=ns(!1),Is=es;function Ro(t,e){var n=t.type.contextTypes;if(!n)return es;var i=t.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in n)r[s]=e[s];return i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=e,t.__reactInternalMemoizedMaskedChildContext=r),r}function Wn(t){return t=t.childContextTypes,t!=null}function uu(){Bt(Gn),Bt(wn)}function d_(t,e,n){if(wn.current!==es)throw Error(he(168));Ut(wn,e),Ut(Gn,n)}function Fv(t,e,n){var i=t.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return n;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(he(108,MM(t)||"Unknown",r));return Xt({},n,i)}function hu(t){return t=(t=t.stateNode)&&t.__reactInternalMemoizedMergedChildContext||es,Is=wn.current,Ut(wn,t),Ut(Gn,Gn.current),!0}function p_(t,e,n){var i=t.stateNode;if(!i)throw Error(he(169));n?(t=Fv(t,e,Is),i.__reactInternalMemoizedMergedChildContext=t,Bt(Gn),Bt(wn),Ut(wn,t)):Bt(Gn),Ut(Gn,n)}var dr=null,Pu=!1,Td=!1;function Ov(t){dr===null?dr=[t]:dr.push(t)}function O1(t){Pu=!0,Ov(t)}function is(){if(!Td&&dr!==null){Td=!0;var t=0,e=Pt;try{var n=dr;for(Pt=1;t<n.length;t++){var i=n[t];do i=i(!0);while(i!==null)}dr=null,Pu=!1}catch(r){throw dr!==null&&(dr=dr.slice(t+1)),lv(Np,is),r}finally{Pt=e,Td=!1}}return null}var _o=[],vo=0,fu=null,du=0,hi=[],fi=0,Ls=null,pr=1,mr="";function Es(t,e){_o[vo++]=du,_o[vo++]=fu,fu=t,du=e}function Bv(t,e,n){hi[fi++]=pr,hi[fi++]=mr,hi[fi++]=Ls,Ls=t;var i=pr;t=mr;var r=32-Ti(i)-1;i&=~(1<<r),n+=1;var s=32-Ti(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,pr=1<<32-Ti(e)+r|n<<r|i,mr=s+t}else pr=1<<s|n<<r|i,mr=t}function Hp(t){t.return!==null&&(Es(t,1),Bv(t,1,0))}function Gp(t){for(;t===fu;)fu=_o[--vo],_o[vo]=null,du=_o[--vo],_o[vo]=null;for(;t===Ls;)Ls=hi[--fi],hi[fi]=null,mr=hi[--fi],hi[fi]=null,pr=hi[--fi],hi[fi]=null}var Jn=null,Kn=null,zt=!1,Ei=null;function kv(t,e){var n=di(5,null,null,0);n.elementType="DELETED",n.stateNode=e,n.return=t,e=t.deletions,e===null?(t.deletions=[n],t.flags|=16):e.push(n)}function m_(t,e){switch(t.tag){case 5:var n=t.type;return e=e.nodeType!==1||n.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(t.stateNode=e,Jn=t,Kn=$r(e.firstChild),!0):!1;case 6:return e=t.pendingProps===""||e.nodeType!==3?null:e,e!==null?(t.stateNode=e,Jn=t,Kn=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(n=Ls!==null?{id:pr,overflow:mr}:null,t.memoizedState={dehydrated:e,treeContext:n,retryLane:1073741824},n=di(18,null,null,0),n.stateNode=e,n.return=t,t.child=n,Jn=t,Kn=null,!0):!1;default:return!1}}function ap(t){return(t.mode&1)!==0&&(t.flags&128)===0}function lp(t){if(zt){var e=Kn;if(e){var n=e;if(!m_(t,e)){if(ap(t))throw Error(he(418));e=$r(n.nextSibling);var i=Jn;e&&m_(t,e)?kv(i,n):(t.flags=t.flags&-4097|2,zt=!1,Jn=t)}}else{if(ap(t))throw Error(he(418));t.flags=t.flags&-4097|2,zt=!1,Jn=t}}}function g_(t){for(t=t.return;t!==null&&t.tag!==5&&t.tag!==3&&t.tag!==13;)t=t.return;Jn=t}function zc(t){if(t!==Jn)return!1;if(!zt)return g_(t),zt=!0,!1;var e;if((e=t.tag!==3)&&!(e=t.tag!==5)&&(e=t.type,e=e!=="head"&&e!=="body"&&!ip(t.type,t.memoizedProps)),e&&(e=Kn)){if(ap(t))throw zv(),Error(he(418));for(;e;)kv(t,e),e=$r(e.nextSibling)}if(g_(t),t.tag===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(he(317));e:{for(t=t.nextSibling,e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="/$"){if(e===0){Kn=$r(t.nextSibling);break e}e--}else n!=="$"&&n!=="$!"&&n!=="$?"||e++}t=t.nextSibling}Kn=null}}else Kn=Jn?$r(t.stateNode.nextSibling):null;return!0}function zv(){for(var t=Kn;t;)t=$r(t.nextSibling)}function Po(){Kn=Jn=null,zt=!1}function Wp(t){Ei===null?Ei=[t]:Ei.push(t)}var B1=Sr.ReactCurrentBatchConfig;function Ra(t,e,n){if(t=n.ref,t!==null&&typeof t!="function"&&typeof t!="object"){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(he(309));var i=n.stateNode}if(!i)throw Error(he(147,t));var r=i,s=""+t;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof t!="string")throw Error(he(284));if(!n._owner)throw Error(he(290,t))}return t}function Vc(t,e){throw t=Object.prototype.toString.call(e),Error(he(31,t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t))}function __(t){var e=t._init;return e(t._payload)}function Vv(t){function e(u,g){if(t){var v=u.deletions;v===null?(u.deletions=[g],u.flags|=16):v.push(g)}}function n(u,g){if(!t)return null;for(;g!==null;)e(u,g),g=g.sibling;return null}function i(u,g){for(u=new Map;g!==null;)g.key!==null?u.set(g.key,g):u.set(g.index,g),g=g.sibling;return u}function r(u,g){return u=jr(u,g),u.index=0,u.sibling=null,u}function s(u,g,v){return u.index=v,t?(v=u.alternate,v!==null?(v=v.index,v<g?(u.flags|=2,g):v):(u.flags|=2,g)):(u.flags|=1048576,g)}function o(u){return t&&u.alternate===null&&(u.flags|=2),u}function a(u,g,v,S){return g===null||g.tag!==6?(g=Ld(v,u.mode,S),g.return=u,g):(g=r(g,v),g.return=u,g)}function l(u,g,v,S){var A=v.type;return A===uo?f(u,g,v.props.children,S,v.key):g!==null&&(g.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===kr&&__(A)===g.type)?(S=r(g,v.props),S.ref=Ra(u,g,v),S.return=u,S):(S=eu(v.type,v.key,v.props,null,u.mode,S),S.ref=Ra(u,g,v),S.return=u,S)}function c(u,g,v,S){return g===null||g.tag!==4||g.stateNode.containerInfo!==v.containerInfo||g.stateNode.implementation!==v.implementation?(g=Nd(v,u.mode,S),g.return=u,g):(g=r(g,v.children||[]),g.return=u,g)}function f(u,g,v,S,A){return g===null||g.tag!==7?(g=Ps(v,u.mode,S,A),g.return=u,g):(g=r(g,v),g.return=u,g)}function d(u,g,v){if(typeof g=="string"&&g!==""||typeof g=="number")return g=Ld(""+g,u.mode,v),g.return=u,g;if(typeof g=="object"&&g!==null){switch(g.$$typeof){case bc:return v=eu(g.type,g.key,g.props,null,u.mode,v),v.ref=Ra(u,null,g),v.return=u,v;case co:return g=Nd(g,u.mode,v),g.return=u,g;case kr:var S=g._init;return d(u,S(g._payload),v)}if(Da(g)||Ta(g))return g=Ps(g,u.mode,v,null),g.return=u,g;Vc(u,g)}return null}function h(u,g,v,S){var A=g!==null?g.key:null;if(typeof v=="string"&&v!==""||typeof v=="number")return A!==null?null:a(u,g,""+v,S);if(typeof v=="object"&&v!==null){switch(v.$$typeof){case bc:return v.key===A?l(u,g,v,S):null;case co:return v.key===A?c(u,g,v,S):null;case kr:return A=v._init,h(u,g,A(v._payload),S)}if(Da(v)||Ta(v))return A!==null?null:f(u,g,v,S,null);Vc(u,v)}return null}function p(u,g,v,S,A){if(typeof S=="string"&&S!==""||typeof S=="number")return u=u.get(v)||null,a(g,u,""+S,A);if(typeof S=="object"&&S!==null){switch(S.$$typeof){case bc:return u=u.get(S.key===null?v:S.key)||null,l(g,u,S,A);case co:return u=u.get(S.key===null?v:S.key)||null,c(g,u,S,A);case kr:var w=S._init;return p(u,g,v,w(S._payload),A)}if(Da(S)||Ta(S))return u=u.get(v)||null,f(g,u,S,A,null);Vc(g,S)}return null}function _(u,g,v,S){for(var A=null,w=null,C=g,x=g=0,b=null;C!==null&&x<v.length;x++){C.index>x?(b=C,C=null):b=C.sibling;var I=h(u,C,v[x],S);if(I===null){C===null&&(C=b);break}t&&C&&I.alternate===null&&e(u,C),g=s(I,g,x),w===null?A=I:w.sibling=I,w=I,C=b}if(x===v.length)return n(u,C),zt&&Es(u,x),A;if(C===null){for(;x<v.length;x++)C=d(u,v[x],S),C!==null&&(g=s(C,g,x),w===null?A=C:w.sibling=C,w=C);return zt&&Es(u,x),A}for(C=i(u,C);x<v.length;x++)b=p(C,u,x,v[x],S),b!==null&&(t&&b.alternate!==null&&C.delete(b.key===null?x:b.key),g=s(b,g,x),w===null?A=b:w.sibling=b,w=b);return t&&C.forEach(function(P){return e(u,P)}),zt&&Es(u,x),A}function y(u,g,v,S){var A=Ta(v);if(typeof A!="function")throw Error(he(150));if(v=A.call(v),v==null)throw Error(he(151));for(var w=A=null,C=g,x=g=0,b=null,I=v.next();C!==null&&!I.done;x++,I=v.next()){C.index>x?(b=C,C=null):b=C.sibling;var P=h(u,C,I.value,S);if(P===null){C===null&&(C=b);break}t&&C&&P.alternate===null&&e(u,C),g=s(P,g,x),w===null?A=P:w.sibling=P,w=P,C=b}if(I.done)return n(u,C),zt&&Es(u,x),A;if(C===null){for(;!I.done;x++,I=v.next())I=d(u,I.value,S),I!==null&&(g=s(I,g,x),w===null?A=I:w.sibling=I,w=I);return zt&&Es(u,x),A}for(C=i(u,C);!I.done;x++,I=v.next())I=p(C,u,x,I.value,S),I!==null&&(t&&I.alternate!==null&&C.delete(I.key===null?x:I.key),g=s(I,g,x),w===null?A=I:w.sibling=I,w=I);return t&&C.forEach(function(F){return e(u,F)}),zt&&Es(u,x),A}function m(u,g,v,S){if(typeof v=="object"&&v!==null&&v.type===uo&&v.key===null&&(v=v.props.children),typeof v=="object"&&v!==null){switch(v.$$typeof){case bc:e:{for(var A=v.key,w=g;w!==null;){if(w.key===A){if(A=v.type,A===uo){if(w.tag===7){n(u,w.sibling),g=r(w,v.props.children),g.return=u,u=g;break e}}else if(w.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===kr&&__(A)===w.type){n(u,w.sibling),g=r(w,v.props),g.ref=Ra(u,w,v),g.return=u,u=g;break e}n(u,w);break}else e(u,w);w=w.sibling}v.type===uo?(g=Ps(v.props.children,u.mode,S,v.key),g.return=u,u=g):(S=eu(v.type,v.key,v.props,null,u.mode,S),S.ref=Ra(u,g,v),S.return=u,u=S)}return o(u);case co:e:{for(w=v.key;g!==null;){if(g.key===w)if(g.tag===4&&g.stateNode.containerInfo===v.containerInfo&&g.stateNode.implementation===v.implementation){n(u,g.sibling),g=r(g,v.children||[]),g.return=u,u=g;break e}else{n(u,g);break}else e(u,g);g=g.sibling}g=Nd(v,u.mode,S),g.return=u,u=g}return o(u);case kr:return w=v._init,m(u,g,w(v._payload),S)}if(Da(v))return _(u,g,v,S);if(Ta(v))return y(u,g,v,S);Vc(u,v)}return typeof v=="string"&&v!==""||typeof v=="number"?(v=""+v,g!==null&&g.tag===6?(n(u,g.sibling),g=r(g,v),g.return=u,u=g):(n(u,g),g=Ld(v,u.mode,S),g.return=u,u=g),o(u)):n(u,g)}return m}var Io=Vv(!0),Hv=Vv(!1),pu=ns(null),mu=null,xo=null,Xp=null;function qp(){Xp=xo=mu=null}function Yp(t){var e=pu.current;Bt(pu),t._currentValue=e}function cp(t,e,n){for(;t!==null;){var i=t.alternate;if((t.childLanes&e)!==e?(t.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),t===n)break;t=t.return}}function bo(t,e){mu=t,Xp=xo=null,t=t.dependencies,t!==null&&t.firstContext!==null&&(t.lanes&e&&(Hn=!0),t.firstContext=null)}function mi(t){var e=t._currentValue;if(Xp!==t)if(t={context:t,memoizedValue:e,next:null},xo===null){if(mu===null)throw Error(he(308));xo=t,mu.dependencies={lanes:0,firstContext:t}}else xo=xo.next=t;return e}var As=null;function $p(t){As===null?As=[t]:As.push(t)}function Gv(t,e,n,i){var r=e.interleaved;return r===null?(n.next=n,$p(e)):(n.next=r.next,r.next=n),e.interleaved=n,xr(t,i)}function xr(t,e){t.lanes|=e;var n=t.alternate;for(n!==null&&(n.lanes|=e),n=t,t=t.return;t!==null;)t.childLanes|=e,n=t.alternate,n!==null&&(n.childLanes|=e),n=t,t=t.return;return n.tag===3?n.stateNode:null}var zr=!1;function Zp(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function Wv(t,e){t=t.updateQueue,e.updateQueue===t&&(e.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,effects:t.effects})}function gr(t,e){return{eventTime:t,lane:e,tag:0,payload:null,callback:null,next:null}}function Zr(t,e,n){var i=t.updateQueue;if(i===null)return null;if(i=i.shared,wt&2){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,xr(t,n)}return r=i.interleaved,r===null?(e.next=e,$p(i)):(e.next=r.next,r.next=e),i.interleaved=e,xr(t,n)}function $c(t,e,n){if(e=e.updateQueue,e!==null&&(e=e.shared,(n&4194240)!==0)){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,Dp(t,n)}}function v_(t,e){var n=t.updateQueue,i=t.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var r=null,s=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};s===null?r=s=o:s=s.next=o,n=n.next}while(n!==null);s===null?r=s=e:s=s.next=e}else r=s=e;n={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},t.updateQueue=n;return}t=n.lastBaseUpdate,t===null?n.firstBaseUpdate=e:t.next=e,n.lastBaseUpdate=e}function gu(t,e,n,i){var r=t.updateQueue;zr=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,c=l.next;l.next=null,o===null?s=c:o.next=c,o=l;var f=t.alternate;f!==null&&(f=f.updateQueue,a=f.lastBaseUpdate,a!==o&&(a===null?f.firstBaseUpdate=c:a.next=c,f.lastBaseUpdate=l))}if(s!==null){var d=r.baseState;o=0,f=c=l=null,a=s;do{var h=a.lane,p=a.eventTime;if((i&h)===h){f!==null&&(f=f.next={eventTime:p,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var _=t,y=a;switch(h=e,p=n,y.tag){case 1:if(_=y.payload,typeof _=="function"){d=_.call(p,d,h);break e}d=_;break e;case 3:_.flags=_.flags&-65537|128;case 0:if(_=y.payload,h=typeof _=="function"?_.call(p,d,h):_,h==null)break e;d=Xt({},d,h);break e;case 2:zr=!0}}a.callback!==null&&a.lane!==0&&(t.flags|=64,h=r.effects,h===null?r.effects=[a]:h.push(a))}else p={eventTime:p,lane:h,tag:a.tag,payload:a.payload,callback:a.callback,next:null},f===null?(c=f=p,l=d):f=f.next=p,o|=h;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;h=a,a=h.next,h.next=null,r.lastBaseUpdate=h,r.shared.pending=null}}while(!0);if(f===null&&(l=d),r.baseState=l,r.firstBaseUpdate=c,r.lastBaseUpdate=f,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);Ds|=o,t.lanes=o,t.memoizedState=d}}function x_(t,e,n){if(t=e.effects,e.effects=null,t!==null)for(e=0;e<t.length;e++){var i=t[e],r=i.callback;if(r!==null){if(i.callback=null,i=n,typeof r!="function")throw Error(he(191,r));r.call(i)}}}var fl={},qi=ns(fl),il=ns(fl),rl=ns(fl);function Cs(t){if(t===fl)throw Error(he(174));return t}function Kp(t,e){switch(Ut(rl,e),Ut(il,t),Ut(qi,fl),t=e.nodeType,t){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:Gd(null,"");break;default:t=t===8?e.parentNode:e,e=t.namespaceURI||null,t=t.tagName,e=Gd(e,t)}Bt(qi),Ut(qi,e)}function Lo(){Bt(qi),Bt(il),Bt(rl)}function Xv(t){Cs(rl.current);var e=Cs(qi.current),n=Gd(e,t.type);e!==n&&(Ut(il,t),Ut(qi,n))}function Jp(t){il.current===t&&(Bt(qi),Bt(il))}var Gt=ns(0);function _u(t){for(var e=t;e!==null;){if(e.tag===13){var n=e.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data==="$?"||n.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if(e.flags&128)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var bd=[];function jp(){for(var t=0;t<bd.length;t++)bd[t]._workInProgressVersionPrimary=null;bd.length=0}var Zc=Sr.ReactCurrentDispatcher,Ad=Sr.ReactCurrentBatchConfig,Ns=0,Wt=null,tn=null,ln=null,vu=!1,Ha=!1,sl=0,k1=0;function yn(){throw Error(he(321))}function Qp(t,e){if(e===null)return!1;for(var n=0;n<e.length&&n<t.length;n++)if(!Ai(t[n],e[n]))return!1;return!0}function em(t,e,n,i,r,s){if(Ns=s,Wt=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,Zc.current=t===null||t.memoizedState===null?G1:W1,t=n(i,r),Ha){s=0;do{if(Ha=!1,sl=0,25<=s)throw Error(he(301));s+=1,ln=tn=null,e.updateQueue=null,Zc.current=X1,t=n(i,r)}while(Ha)}if(Zc.current=xu,e=tn!==null&&tn.next!==null,Ns=0,ln=tn=Wt=null,vu=!1,e)throw Error(he(300));return t}function tm(){var t=sl!==0;return sl=0,t}function Gi(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return ln===null?Wt.memoizedState=ln=t:ln=ln.next=t,ln}function gi(){if(tn===null){var t=Wt.alternate;t=t!==null?t.memoizedState:null}else t=tn.next;var e=ln===null?Wt.memoizedState:ln.next;if(e!==null)ln=e,tn=t;else{if(t===null)throw Error(he(310));tn=t,t={memoizedState:tn.memoizedState,baseState:tn.baseState,baseQueue:tn.baseQueue,queue:tn.queue,next:null},ln===null?Wt.memoizedState=ln=t:ln=ln.next=t}return ln}function ol(t,e){return typeof e=="function"?e(t):e}function Cd(t){var e=gi(),n=e.queue;if(n===null)throw Error(he(311));n.lastRenderedReducer=t;var i=tn,r=i.baseQueue,s=n.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,n.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,c=s;do{var f=c.lane;if((Ns&f)===f)l!==null&&(l=l.next={lane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),i=c.hasEagerState?c.eagerState:t(i,c.action);else{var d={lane:f,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null};l===null?(a=l=d,o=i):l=l.next=d,Wt.lanes|=f,Ds|=f}c=c.next}while(c!==null&&c!==s);l===null?o=i:l.next=a,Ai(i,e.memoizedState)||(Hn=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,n.lastRenderedState=i}if(t=n.interleaved,t!==null){r=t;do s=r.lane,Wt.lanes|=s,Ds|=s,r=r.next;while(r!==t)}else r===null&&(n.lanes=0);return[e.memoizedState,n.dispatch]}function Rd(t){var e=gi(),n=e.queue;if(n===null)throw Error(he(311));n.lastRenderedReducer=t;var i=n.dispatch,r=n.pending,s=e.memoizedState;if(r!==null){n.pending=null;var o=r=r.next;do s=t(s,o.action),o=o.next;while(o!==r);Ai(s,e.memoizedState)||(Hn=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),n.lastRenderedState=s}return[s,i]}function qv(){}function Yv(t,e){var n=Wt,i=gi(),r=e(),s=!Ai(i.memoizedState,r);if(s&&(i.memoizedState=r,Hn=!0),i=i.queue,nm(Kv.bind(null,n,i,t),[t]),i.getSnapshot!==e||s||ln!==null&&ln.memoizedState.tag&1){if(n.flags|=2048,al(9,Zv.bind(null,n,i,r,e),void 0,null),cn===null)throw Error(he(349));Ns&30||$v(n,e,r)}return r}function $v(t,e,n){t.flags|=16384,t={getSnapshot:e,value:n},e=Wt.updateQueue,e===null?(e={lastEffect:null,stores:null},Wt.updateQueue=e,e.stores=[t]):(n=e.stores,n===null?e.stores=[t]:n.push(t))}function Zv(t,e,n,i){e.value=n,e.getSnapshot=i,Jv(e)&&jv(t)}function Kv(t,e,n){return n(function(){Jv(e)&&jv(t)})}function Jv(t){var e=t.getSnapshot;t=t.value;try{var n=e();return!Ai(t,n)}catch{return!0}}function jv(t){var e=xr(t,1);e!==null&&bi(e,t,1,-1)}function y_(t){var e=Gi();return typeof t=="function"&&(t=t()),e.memoizedState=e.baseState=t,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:ol,lastRenderedState:t},e.queue=t,t=t.dispatch=H1.bind(null,Wt,t),[e.memoizedState,t]}function al(t,e,n,i){return t={tag:t,create:e,destroy:n,deps:i,next:null},e=Wt.updateQueue,e===null?(e={lastEffect:null,stores:null},Wt.updateQueue=e,e.lastEffect=t.next=t):(n=e.lastEffect,n===null?e.lastEffect=t.next=t:(i=n.next,n.next=t,t.next=i,e.lastEffect=t)),t}function Qv(){return gi().memoizedState}function Kc(t,e,n,i){var r=Gi();Wt.flags|=t,r.memoizedState=al(1|e,n,void 0,i===void 0?null:i)}function Iu(t,e,n,i){var r=gi();i=i===void 0?null:i;var s=void 0;if(tn!==null){var o=tn.memoizedState;if(s=o.destroy,i!==null&&Qp(i,o.deps)){r.memoizedState=al(e,n,s,i);return}}Wt.flags|=t,r.memoizedState=al(1|e,n,s,i)}function S_(t,e){return Kc(8390656,8,t,e)}function nm(t,e){return Iu(2048,8,t,e)}function ex(t,e){return Iu(4,2,t,e)}function tx(t,e){return Iu(4,4,t,e)}function nx(t,e){if(typeof e=="function")return t=t(),e(t),function(){e(null)};if(e!=null)return t=t(),e.current=t,function(){e.current=null}}function ix(t,e,n){return n=n!=null?n.concat([t]):null,Iu(4,4,nx.bind(null,e,t),n)}function im(){}function rx(t,e){var n=gi();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&Qp(e,i[1])?i[0]:(n.memoizedState=[t,e],t)}function sx(t,e){var n=gi();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&Qp(e,i[1])?i[0]:(t=t(),n.memoizedState=[t,e],t)}function ox(t,e,n){return Ns&21?(Ai(n,e)||(n=hv(),Wt.lanes|=n,Ds|=n,t.baseState=!0),e):(t.baseState&&(t.baseState=!1,Hn=!0),t.memoizedState=n)}function z1(t,e){var n=Pt;Pt=n!==0&&4>n?n:4,t(!0);var i=Ad.transition;Ad.transition={};try{t(!1),e()}finally{Pt=n,Ad.transition=i}}function ax(){return gi().memoizedState}function V1(t,e,n){var i=Jr(t);if(n={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null},lx(t))cx(e,n);else if(n=Gv(t,e,n,i),n!==null){var r=Ln();bi(n,t,i,r),ux(n,e,i)}}function H1(t,e,n){var i=Jr(t),r={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null};if(lx(t))cx(e,r);else{var s=t.alternate;if(t.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,n);if(r.hasEagerState=!0,r.eagerState=a,Ai(a,o)){var l=e.interleaved;l===null?(r.next=r,$p(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}n=Gv(t,e,r,i),n!==null&&(r=Ln(),bi(n,t,i,r),ux(n,e,i))}}function lx(t){var e=t.alternate;return t===Wt||e!==null&&e===Wt}function cx(t,e){Ha=vu=!0;var n=t.pending;n===null?e.next=e:(e.next=n.next,n.next=e),t.pending=e}function ux(t,e,n){if(n&4194240){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,Dp(t,n)}}var xu={readContext:mi,useCallback:yn,useContext:yn,useEffect:yn,useImperativeHandle:yn,useInsertionEffect:yn,useLayoutEffect:yn,useMemo:yn,useReducer:yn,useRef:yn,useState:yn,useDebugValue:yn,useDeferredValue:yn,useTransition:yn,useMutableSource:yn,useSyncExternalStore:yn,useId:yn,unstable_isNewReconciler:!1},G1={readContext:mi,useCallback:function(t,e){return Gi().memoizedState=[t,e===void 0?null:e],t},useContext:mi,useEffect:S_,useImperativeHandle:function(t,e,n){return n=n!=null?n.concat([t]):null,Kc(4194308,4,nx.bind(null,e,t),n)},useLayoutEffect:function(t,e){return Kc(4194308,4,t,e)},useInsertionEffect:function(t,e){return Kc(4,2,t,e)},useMemo:function(t,e){var n=Gi();return e=e===void 0?null:e,t=t(),n.memoizedState=[t,e],t},useReducer:function(t,e,n){var i=Gi();return e=n!==void 0?n(e):e,i.memoizedState=i.baseState=e,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:e},i.queue=t,t=t.dispatch=V1.bind(null,Wt,t),[i.memoizedState,t]},useRef:function(t){var e=Gi();return t={current:t},e.memoizedState=t},useState:y_,useDebugValue:im,useDeferredValue:function(t){return Gi().memoizedState=t},useTransition:function(){var t=y_(!1),e=t[0];return t=z1.bind(null,t[1]),Gi().memoizedState=t,[e,t]},useMutableSource:function(){},useSyncExternalStore:function(t,e,n){var i=Wt,r=Gi();if(zt){if(n===void 0)throw Error(he(407));n=n()}else{if(n=e(),cn===null)throw Error(he(349));Ns&30||$v(i,e,n)}r.memoizedState=n;var s={value:n,getSnapshot:e};return r.queue=s,S_(Kv.bind(null,i,s,t),[t]),i.flags|=2048,al(9,Zv.bind(null,i,s,n,e),void 0,null),n},useId:function(){var t=Gi(),e=cn.identifierPrefix;if(zt){var n=mr,i=pr;n=(i&~(1<<32-Ti(i)-1)).toString(32)+n,e=":"+e+"R"+n,n=sl++,0<n&&(e+="H"+n.toString(32)),e+=":"}else n=k1++,e=":"+e+"r"+n.toString(32)+":";return t.memoizedState=e},unstable_isNewReconciler:!1},W1={readContext:mi,useCallback:rx,useContext:mi,useEffect:nm,useImperativeHandle:ix,useInsertionEffect:ex,useLayoutEffect:tx,useMemo:sx,useReducer:Cd,useRef:Qv,useState:function(){return Cd(ol)},useDebugValue:im,useDeferredValue:function(t){var e=gi();return ox(e,tn.memoizedState,t)},useTransition:function(){var t=Cd(ol)[0],e=gi().memoizedState;return[t,e]},useMutableSource:qv,useSyncExternalStore:Yv,useId:ax,unstable_isNewReconciler:!1},X1={readContext:mi,useCallback:rx,useContext:mi,useEffect:nm,useImperativeHandle:ix,useInsertionEffect:ex,useLayoutEffect:tx,useMemo:sx,useReducer:Rd,useRef:Qv,useState:function(){return Rd(ol)},useDebugValue:im,useDeferredValue:function(t){var e=gi();return tn===null?e.memoizedState=t:ox(e,tn.memoizedState,t)},useTransition:function(){var t=Rd(ol)[0],e=gi().memoizedState;return[t,e]},useMutableSource:qv,useSyncExternalStore:Yv,useId:ax,unstable_isNewReconciler:!1};function Mi(t,e){if(t&&t.defaultProps){e=Xt({},e),t=t.defaultProps;for(var n in t)e[n]===void 0&&(e[n]=t[n]);return e}return e}function up(t,e,n,i){e=t.memoizedState,n=n(i,e),n=n==null?e:Xt({},e,n),t.memoizedState=n,t.lanes===0&&(t.updateQueue.baseState=n)}var Lu={isMounted:function(t){return(t=t._reactInternals)?Os(t)===t:!1},enqueueSetState:function(t,e,n){t=t._reactInternals;var i=Ln(),r=Jr(t),s=gr(i,r);s.payload=e,n!=null&&(s.callback=n),e=Zr(t,s,r),e!==null&&(bi(e,t,r,i),$c(e,t,r))},enqueueReplaceState:function(t,e,n){t=t._reactInternals;var i=Ln(),r=Jr(t),s=gr(i,r);s.tag=1,s.payload=e,n!=null&&(s.callback=n),e=Zr(t,s,r),e!==null&&(bi(e,t,r,i),$c(e,t,r))},enqueueForceUpdate:function(t,e){t=t._reactInternals;var n=Ln(),i=Jr(t),r=gr(n,i);r.tag=2,e!=null&&(r.callback=e),e=Zr(t,r,i),e!==null&&(bi(e,t,i,n),$c(e,t,i))}};function M_(t,e,n,i,r,s,o){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!Qa(n,i)||!Qa(r,s):!0}function hx(t,e,n){var i=!1,r=es,s=e.contextType;return typeof s=="object"&&s!==null?s=mi(s):(r=Wn(e)?Is:wn.current,i=e.contextTypes,s=(i=i!=null)?Ro(t,r):es),e=new e(n,s),t.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=Lu,t.stateNode=e,e._reactInternals=t,i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=r,t.__reactInternalMemoizedMaskedChildContext=s),e}function w_(t,e,n,i){t=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(n,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(n,i),e.state!==t&&Lu.enqueueReplaceState(e,e.state,null)}function hp(t,e,n,i){var r=t.stateNode;r.props=n,r.state=t.memoizedState,r.refs={},Zp(t);var s=e.contextType;typeof s=="object"&&s!==null?r.context=mi(s):(s=Wn(e)?Is:wn.current,r.context=Ro(t,s)),r.state=t.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(up(t,e,s,n),r.state=t.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&Lu.enqueueReplaceState(r,r.state,null),gu(t,n,r,i),r.state=t.memoizedState),typeof r.componentDidMount=="function"&&(t.flags|=4194308)}function No(t,e){try{var n="",i=e;do n+=SM(i),i=i.return;while(i);var r=n}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:t,source:e,stack:r,digest:null}}function Pd(t,e,n){return{value:t,source:null,stack:n??null,digest:e??null}}function fp(t,e){try{console.error(e.value)}catch(n){setTimeout(function(){throw n})}}var q1=typeof WeakMap=="function"?WeakMap:Map;function fx(t,e,n){n=gr(-1,n),n.tag=3,n.payload={element:null};var i=e.value;return n.callback=function(){Su||(Su=!0,Mp=i),fp(t,e)},n}function dx(t,e,n){n=gr(-1,n),n.tag=3;var i=t.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;n.payload=function(){return i(r)},n.callback=function(){fp(t,e)}}var s=t.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(n.callback=function(){fp(t,e),typeof i!="function"&&(Kr===null?Kr=new Set([this]):Kr.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),n}function E_(t,e,n){var i=t.pingCache;if(i===null){i=t.pingCache=new q1;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(n)||(r.add(n),t=ow.bind(null,t,e,n),e.then(t,t))}function T_(t){do{var e;if((e=t.tag===13)&&(e=t.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return t;t=t.return}while(t!==null);return null}function b_(t,e,n,i,r){return t.mode&1?(t.flags|=65536,t.lanes=r,t):(t===e?t.flags|=65536:(t.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(e=gr(-1,1),e.tag=2,Zr(n,e,1))),n.lanes|=1),t)}var Y1=Sr.ReactCurrentOwner,Hn=!1;function In(t,e,n,i){e.child=t===null?Hv(e,null,n,i):Io(e,t.child,n,i)}function A_(t,e,n,i,r){n=n.render;var s=e.ref;return bo(e,r),i=em(t,e,n,i,s,r),n=tm(),t!==null&&!Hn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,yr(t,e,r)):(zt&&n&&Hp(e),e.flags|=1,In(t,e,i,r),e.child)}function C_(t,e,n,i,r){if(t===null){var s=n.type;return typeof s=="function"&&!hm(s)&&s.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(e.tag=15,e.type=s,px(t,e,s,i,r)):(t=eu(n.type,null,i,e,e.mode,r),t.ref=e.ref,t.return=e,e.child=t)}if(s=t.child,!(t.lanes&r)){var o=s.memoizedProps;if(n=n.compare,n=n!==null?n:Qa,n(o,i)&&t.ref===e.ref)return yr(t,e,r)}return e.flags|=1,t=jr(s,i),t.ref=e.ref,t.return=e,e.child=t}function px(t,e,n,i,r){if(t!==null){var s=t.memoizedProps;if(Qa(s,i)&&t.ref===e.ref)if(Hn=!1,e.pendingProps=i=s,(t.lanes&r)!==0)t.flags&131072&&(Hn=!0);else return e.lanes=t.lanes,yr(t,e,r)}return dp(t,e,n,i,r)}function mx(t,e,n){var i=e.pendingProps,r=i.children,s=t!==null?t.memoizedState:null;if(i.mode==="hidden")if(!(e.mode&1))e.memoizedState={baseLanes:0,cachePool:null,transitions:null},Ut(So,Zn),Zn|=n;else{if(!(n&1073741824))return t=s!==null?s.baseLanes|n:n,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:t,cachePool:null,transitions:null},e.updateQueue=null,Ut(So,Zn),Zn|=t,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:n,Ut(So,Zn),Zn|=i}else s!==null?(i=s.baseLanes|n,e.memoizedState=null):i=n,Ut(So,Zn),Zn|=i;return In(t,e,r,n),e.child}function gx(t,e){var n=e.ref;(t===null&&n!==null||t!==null&&t.ref!==n)&&(e.flags|=512,e.flags|=2097152)}function dp(t,e,n,i,r){var s=Wn(n)?Is:wn.current;return s=Ro(e,s),bo(e,r),n=em(t,e,n,i,s,r),i=tm(),t!==null&&!Hn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,yr(t,e,r)):(zt&&i&&Hp(e),e.flags|=1,In(t,e,n,r),e.child)}function R_(t,e,n,i,r){if(Wn(n)){var s=!0;hu(e)}else s=!1;if(bo(e,r),e.stateNode===null)Jc(t,e),hx(e,n,i),hp(e,n,i,r),i=!0;else if(t===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,c=n.contextType;typeof c=="object"&&c!==null?c=mi(c):(c=Wn(n)?Is:wn.current,c=Ro(e,c));var f=n.getDerivedStateFromProps,d=typeof f=="function"||typeof o.getSnapshotBeforeUpdate=="function";d||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==c)&&w_(e,o,i,c),zr=!1;var h=e.memoizedState;o.state=h,gu(e,i,o,r),l=e.memoizedState,a!==i||h!==l||Gn.current||zr?(typeof f=="function"&&(up(e,n,f,i),l=e.memoizedState),(a=zr||M_(e,n,a,i,h,l,c))?(d||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=c,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,Wv(t,e),a=e.memoizedProps,c=e.type===e.elementType?a:Mi(e.type,a),o.props=c,d=e.pendingProps,h=o.context,l=n.contextType,typeof l=="object"&&l!==null?l=mi(l):(l=Wn(n)?Is:wn.current,l=Ro(e,l));var p=n.getDerivedStateFromProps;(f=typeof p=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==d||h!==l)&&w_(e,o,i,l),zr=!1,h=e.memoizedState,o.state=h,gu(e,i,o,r);var _=e.memoizedState;a!==d||h!==_||Gn.current||zr?(typeof p=="function"&&(up(e,n,p,i),_=e.memoizedState),(c=zr||M_(e,n,c,i,h,_,l)||!1)?(f||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,_,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,_,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=_),o.props=i,o.state=_,o.context=l,i=c):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),i=!1)}return pp(t,e,n,i,s,r)}function pp(t,e,n,i,r,s){gx(t,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&p_(e,n,!1),yr(t,e,s);i=e.stateNode,Y1.current=e;var a=o&&typeof n.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,t!==null&&o?(e.child=Io(e,t.child,null,s),e.child=Io(e,null,a,s)):In(t,e,a,s),e.memoizedState=i.state,r&&p_(e,n,!0),e.child}function _x(t){var e=t.stateNode;e.pendingContext?d_(t,e.pendingContext,e.pendingContext!==e.context):e.context&&d_(t,e.context,!1),Kp(t,e.containerInfo)}function P_(t,e,n,i,r){return Po(),Wp(r),e.flags|=256,In(t,e,n,i),e.child}var mp={dehydrated:null,treeContext:null,retryLane:0};function gp(t){return{baseLanes:t,cachePool:null,transitions:null}}function vx(t,e,n){var i=e.pendingProps,r=Gt.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=t!==null&&t.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(t===null||t.memoizedState!==null)&&(r|=1),Ut(Gt,r&1),t===null)return lp(e),t=e.memoizedState,t!==null&&(t=t.dehydrated,t!==null)?(e.mode&1?t.data==="$!"?e.lanes=8:e.lanes=1073741824:e.lanes=1,null):(o=i.children,t=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},!(i&1)&&s!==null?(s.childLanes=0,s.pendingProps=o):s=Uu(o,i,0,null),t=Ps(t,i,n,null),s.return=e,t.return=e,s.sibling=t,e.child=s,e.child.memoizedState=gp(n),e.memoizedState=mp,t):rm(e,o));if(r=t.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return $1(t,e,o,i,a,r,n);if(s){s=i.fallback,o=e.mode,r=t.child,a=r.sibling;var l={mode:"hidden",children:i.children};return!(o&1)&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=jr(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=jr(a,s):(s=Ps(s,o,n,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=t.child.memoizedState,o=o===null?gp(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=t.childLanes&~n,e.memoizedState=mp,i}return s=t.child,t=s.sibling,i=jr(s,{mode:"visible",children:i.children}),!(e.mode&1)&&(i.lanes=n),i.return=e,i.sibling=null,t!==null&&(n=e.deletions,n===null?(e.deletions=[t],e.flags|=16):n.push(t)),e.child=i,e.memoizedState=null,i}function rm(t,e){return e=Uu({mode:"visible",children:e},t.mode,0,null),e.return=t,t.child=e}function Hc(t,e,n,i){return i!==null&&Wp(i),Io(e,t.child,null,n),t=rm(e,e.pendingProps.children),t.flags|=2,e.memoizedState=null,t}function $1(t,e,n,i,r,s,o){if(n)return e.flags&256?(e.flags&=-257,i=Pd(Error(he(422))),Hc(t,e,o,i)):e.memoizedState!==null?(e.child=t.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=Uu({mode:"visible",children:i.children},r,0,null),s=Ps(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,e.mode&1&&Io(e,t.child,null,o),e.child.memoizedState=gp(o),e.memoizedState=mp,s);if(!(e.mode&1))return Hc(t,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(he(419)),i=Pd(s,i,void 0),Hc(t,e,o,i)}if(a=(o&t.childLanes)!==0,Hn||a){if(i=cn,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=r&(i.suspendedLanes|o)?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,xr(t,r),bi(i,t,r,-1))}return um(),i=Pd(Error(he(421))),Hc(t,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=t.child,e=aw.bind(null,t),r._reactRetry=e,null):(t=s.treeContext,Kn=$r(r.nextSibling),Jn=e,zt=!0,Ei=null,t!==null&&(hi[fi++]=pr,hi[fi++]=mr,hi[fi++]=Ls,pr=t.id,mr=t.overflow,Ls=e),e=rm(e,i.children),e.flags|=4096,e)}function I_(t,e,n){t.lanes|=e;var i=t.alternate;i!==null&&(i.lanes|=e),cp(t.return,e,n)}function Id(t,e,n,i,r){var s=t.memoizedState;s===null?t.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=n,s.tailMode=r)}function xx(t,e,n){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(In(t,e,i.children,n),i=Gt.current,i&2)i=i&1|2,e.flags|=128;else{if(t!==null&&t.flags&128)e:for(t=e.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&I_(t,n,e);else if(t.tag===19)I_(t,n,e);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break e;for(;t.sibling===null;){if(t.return===null||t.return===e)break e;t=t.return}t.sibling.return=t.return,t=t.sibling}i&=1}if(Ut(Gt,i),!(e.mode&1))e.memoizedState=null;else switch(r){case"forwards":for(n=e.child,r=null;n!==null;)t=n.alternate,t!==null&&_u(t)===null&&(r=n),n=n.sibling;n=r,n===null?(r=e.child,e.child=null):(r=n.sibling,n.sibling=null),Id(e,!1,r,n,s);break;case"backwards":for(n=null,r=e.child,e.child=null;r!==null;){if(t=r.alternate,t!==null&&_u(t)===null){e.child=r;break}t=r.sibling,r.sibling=n,n=r,r=t}Id(e,!0,n,null,s);break;case"together":Id(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function Jc(t,e){!(e.mode&1)&&t!==null&&(t.alternate=null,e.alternate=null,e.flags|=2)}function yr(t,e,n){if(t!==null&&(e.dependencies=t.dependencies),Ds|=e.lanes,!(n&e.childLanes))return null;if(t!==null&&e.child!==t.child)throw Error(he(153));if(e.child!==null){for(t=e.child,n=jr(t,t.pendingProps),e.child=n,n.return=e;t.sibling!==null;)t=t.sibling,n=n.sibling=jr(t,t.pendingProps),n.return=e;n.sibling=null}return e.child}function Z1(t,e,n){switch(e.tag){case 3:_x(e),Po();break;case 5:Xv(e);break;case 1:Wn(e.type)&&hu(e);break;case 4:Kp(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;Ut(pu,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(Ut(Gt,Gt.current&1),e.flags|=128,null):n&e.child.childLanes?vx(t,e,n):(Ut(Gt,Gt.current&1),t=yr(t,e,n),t!==null?t.sibling:null);Ut(Gt,Gt.current&1);break;case 19:if(i=(n&e.childLanes)!==0,t.flags&128){if(i)return xx(t,e,n);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),Ut(Gt,Gt.current),i)break;return null;case 22:case 23:return e.lanes=0,mx(t,e,n)}return yr(t,e,n)}var yx,_p,Sx,Mx;yx=function(t,e){for(var n=e.child;n!==null;){if(n.tag===5||n.tag===6)t.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return;n=n.return}n.sibling.return=n.return,n=n.sibling}};_p=function(){};Sx=function(t,e,n,i){var r=t.memoizedProps;if(r!==i){t=e.stateNode,Cs(qi.current);var s=null;switch(n){case"input":r=kd(t,r),i=kd(t,i),s=[];break;case"select":r=Xt({},r,{value:void 0}),i=Xt({},i,{value:void 0}),s=[];break;case"textarea":r=Hd(t,r),i=Hd(t,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(t.onclick=cu)}Wd(n,i);var o;n=null;for(c in r)if(!i.hasOwnProperty(c)&&r.hasOwnProperty(c)&&r[c]!=null)if(c==="style"){var a=r[c];for(o in a)a.hasOwnProperty(o)&&(n||(n={}),n[o]="")}else c!=="dangerouslySetInnerHTML"&&c!=="children"&&c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&c!=="autoFocus"&&(qa.hasOwnProperty(c)?s||(s=[]):(s=s||[]).push(c,null));for(c in i){var l=i[c];if(a=r!=null?r[c]:void 0,i.hasOwnProperty(c)&&l!==a&&(l!=null||a!=null))if(c==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(n||(n={}),n[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(n||(n={}),n[o]=l[o])}else n||(s||(s=[]),s.push(c,n)),n=l;else c==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(c,l)):c==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(c,""+l):c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&(qa.hasOwnProperty(c)?(l!=null&&c==="onScroll"&&Ot("scroll",t),s||a===l||(s=[])):(s=s||[]).push(c,l))}n&&(s=s||[]).push("style",n);var c=s;(e.updateQueue=c)&&(e.flags|=4)}};Mx=function(t,e,n,i){n!==i&&(e.flags|=4)};function Pa(t,e){if(!zt)switch(t.tailMode){case"hidden":e=t.tail;for(var n=null;e!==null;)e.alternate!==null&&(n=e),e=e.sibling;n===null?t.tail=null:n.sibling=null;break;case"collapsed":n=t.tail;for(var i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?e||t.tail===null?t.tail=null:t.tail.sibling=null:i.sibling=null}}function Sn(t){var e=t.alternate!==null&&t.alternate.child===t.child,n=0,i=0;if(e)for(var r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=t,r=r.sibling;else for(r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=t,r=r.sibling;return t.subtreeFlags|=i,t.childLanes=n,e}function K1(t,e,n){var i=e.pendingProps;switch(Gp(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return Sn(e),null;case 1:return Wn(e.type)&&uu(),Sn(e),null;case 3:return i=e.stateNode,Lo(),Bt(Gn),Bt(wn),jp(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(t===null||t.child===null)&&(zc(e)?e.flags|=4:t===null||t.memoizedState.isDehydrated&&!(e.flags&256)||(e.flags|=1024,Ei!==null&&(Tp(Ei),Ei=null))),_p(t,e),Sn(e),null;case 5:Jp(e);var r=Cs(rl.current);if(n=e.type,t!==null&&e.stateNode!=null)Sx(t,e,n,i,r),t.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(he(166));return Sn(e),null}if(t=Cs(qi.current),zc(e)){i=e.stateNode,n=e.type;var s=e.memoizedProps;switch(i[Wi]=e,i[nl]=s,t=(e.mode&1)!==0,n){case"dialog":Ot("cancel",i),Ot("close",i);break;case"iframe":case"object":case"embed":Ot("load",i);break;case"video":case"audio":for(r=0;r<Fa.length;r++)Ot(Fa[r],i);break;case"source":Ot("error",i);break;case"img":case"image":case"link":Ot("error",i),Ot("load",i);break;case"details":Ot("toggle",i);break;case"input":k0(i,s),Ot("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},Ot("invalid",i);break;case"textarea":V0(i,s),Ot("invalid",i)}Wd(n,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&kc(i.textContent,a,t),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&kc(i.textContent,a,t),r=["children",""+a]):qa.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&Ot("scroll",i)}switch(n){case"input":Ac(i),z0(i,s,!0);break;case"textarea":Ac(i),H0(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=cu)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,t==="http://www.w3.org/1999/xhtml"&&(t=K_(n)),t==="http://www.w3.org/1999/xhtml"?n==="script"?(t=o.createElement("div"),t.innerHTML="<script><\/script>",t=t.removeChild(t.firstChild)):typeof i.is=="string"?t=o.createElement(n,{is:i.is}):(t=o.createElement(n),n==="select"&&(o=t,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):t=o.createElementNS(t,n),t[Wi]=e,t[nl]=i,yx(t,e,!1,!1),e.stateNode=t;e:{switch(o=Xd(n,i),n){case"dialog":Ot("cancel",t),Ot("close",t),r=i;break;case"iframe":case"object":case"embed":Ot("load",t),r=i;break;case"video":case"audio":for(r=0;r<Fa.length;r++)Ot(Fa[r],t);r=i;break;case"source":Ot("error",t),r=i;break;case"img":case"image":case"link":Ot("error",t),Ot("load",t),r=i;break;case"details":Ot("toggle",t),r=i;break;case"input":k0(t,i),r=kd(t,i),Ot("invalid",t);break;case"option":r=i;break;case"select":t._wrapperState={wasMultiple:!!i.multiple},r=Xt({},i,{value:void 0}),Ot("invalid",t);break;case"textarea":V0(t,i),r=Hd(t,i),Ot("invalid",t);break;default:r=i}Wd(n,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?Q_(t,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&J_(t,l)):s==="children"?typeof l=="string"?(n!=="textarea"||l!=="")&&Ya(t,l):typeof l=="number"&&Ya(t,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(qa.hasOwnProperty(s)?l!=null&&s==="onScroll"&&Ot("scroll",t):l!=null&&Cp(t,s,l,o))}switch(n){case"input":Ac(t),z0(t,i,!1);break;case"textarea":Ac(t),H0(t);break;case"option":i.value!=null&&t.setAttribute("value",""+Qr(i.value));break;case"select":t.multiple=!!i.multiple,s=i.value,s!=null?Mo(t,!!i.multiple,s,!1):i.defaultValue!=null&&Mo(t,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(t.onclick=cu)}switch(n){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return Sn(e),null;case 6:if(t&&e.stateNode!=null)Mx(t,e,t.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(he(166));if(n=Cs(rl.current),Cs(qi.current),zc(e)){if(i=e.stateNode,n=e.memoizedProps,i[Wi]=e,(s=i.nodeValue!==n)&&(t=Jn,t!==null))switch(t.tag){case 3:kc(i.nodeValue,n,(t.mode&1)!==0);break;case 5:t.memoizedProps.suppressHydrationWarning!==!0&&kc(i.nodeValue,n,(t.mode&1)!==0)}s&&(e.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[Wi]=e,e.stateNode=i}return Sn(e),null;case 13:if(Bt(Gt),i=e.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(zt&&Kn!==null&&e.mode&1&&!(e.flags&128))zv(),Po(),e.flags|=98560,s=!1;else if(s=zc(e),i!==null&&i.dehydrated!==null){if(t===null){if(!s)throw Error(he(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(he(317));s[Wi]=e}else Po(),!(e.flags&128)&&(e.memoizedState=null),e.flags|=4;Sn(e),s=!1}else Ei!==null&&(Tp(Ei),Ei=null),s=!0;if(!s)return e.flags&65536?e:null}return e.flags&128?(e.lanes=n,e):(i=i!==null,i!==(t!==null&&t.memoizedState!==null)&&i&&(e.child.flags|=8192,e.mode&1&&(t===null||Gt.current&1?nn===0&&(nn=3):um())),e.updateQueue!==null&&(e.flags|=4),Sn(e),null);case 4:return Lo(),_p(t,e),t===null&&el(e.stateNode.containerInfo),Sn(e),null;case 10:return Yp(e.type._context),Sn(e),null;case 17:return Wn(e.type)&&uu(),Sn(e),null;case 19:if(Bt(Gt),s=e.memoizedState,s===null)return Sn(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)Pa(s,!1);else{if(nn!==0||t!==null&&t.flags&128)for(t=e.child;t!==null;){if(o=_u(t),o!==null){for(e.flags|=128,Pa(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=n,n=e.child;n!==null;)s=n,t=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=t,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,t=o.dependencies,s.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext}),n=n.sibling;return Ut(Gt,Gt.current&1|2),e.child}t=t.sibling}s.tail!==null&&Jt()>Do&&(e.flags|=128,i=!0,Pa(s,!1),e.lanes=4194304)}else{if(!i)if(t=_u(o),t!==null){if(e.flags|=128,i=!0,n=t.updateQueue,n!==null&&(e.updateQueue=n,e.flags|=4),Pa(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!zt)return Sn(e),null}else 2*Jt()-s.renderingStartTime>Do&&n!==1073741824&&(e.flags|=128,i=!0,Pa(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(n=s.last,n!==null?n.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=Jt(),e.sibling=null,n=Gt.current,Ut(Gt,i?n&1|2:n&1),e):(Sn(e),null);case 22:case 23:return cm(),i=e.memoizedState!==null,t!==null&&t.memoizedState!==null!==i&&(e.flags|=8192),i&&e.mode&1?Zn&1073741824&&(Sn(e),e.subtreeFlags&6&&(e.flags|=8192)):Sn(e),null;case 24:return null;case 25:return null}throw Error(he(156,e.tag))}function J1(t,e){switch(Gp(e),e.tag){case 1:return Wn(e.type)&&uu(),t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 3:return Lo(),Bt(Gn),Bt(wn),jp(),t=e.flags,t&65536&&!(t&128)?(e.flags=t&-65537|128,e):null;case 5:return Jp(e),null;case 13:if(Bt(Gt),t=e.memoizedState,t!==null&&t.dehydrated!==null){if(e.alternate===null)throw Error(he(340));Po()}return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 19:return Bt(Gt),null;case 4:return Lo(),null;case 10:return Yp(e.type._context),null;case 22:case 23:return cm(),null;case 24:return null;default:return null}}var Gc=!1,Mn=!1,j1=typeof WeakSet=="function"?WeakSet:Set,Oe=null;function yo(t,e){var n=t.ref;if(n!==null)if(typeof n=="function")try{n(null)}catch(i){$t(t,e,i)}else n.current=null}function vp(t,e,n){try{n()}catch(i){$t(t,e,i)}}var L_=!1;function Q1(t,e){if(tp=ou,t=Av(),Vp(t)){if("selectionStart"in t)var n={start:t.selectionStart,end:t.selectionEnd};else e:{n=(n=t.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{n.nodeType,s.nodeType}catch{n=null;break e}var o=0,a=-1,l=-1,c=0,f=0,d=t,h=null;t:for(;;){for(var p;d!==n||r!==0&&d.nodeType!==3||(a=o+r),d!==s||i!==0&&d.nodeType!==3||(l=o+i),d.nodeType===3&&(o+=d.nodeValue.length),(p=d.firstChild)!==null;)h=d,d=p;for(;;){if(d===t)break t;if(h===n&&++c===r&&(a=o),h===s&&++f===i&&(l=o),(p=d.nextSibling)!==null)break;d=h,h=d.parentNode}d=p}n=a===-1||l===-1?null:{start:a,end:l}}else n=null}n=n||{start:0,end:0}}else n=null;for(np={focusedElem:t,selectionRange:n},ou=!1,Oe=e;Oe!==null;)if(e=Oe,t=e.child,(e.subtreeFlags&1028)!==0&&t!==null)t.return=e,Oe=t;else for(;Oe!==null;){e=Oe;try{var _=e.alternate;if(e.flags&1024)switch(e.tag){case 0:case 11:case 15:break;case 1:if(_!==null){var y=_.memoizedProps,m=_.memoizedState,u=e.stateNode,g=u.getSnapshotBeforeUpdate(e.elementType===e.type?y:Mi(e.type,y),m);u.__reactInternalSnapshotBeforeUpdate=g}break;case 3:var v=e.stateNode.containerInfo;v.nodeType===1?v.textContent="":v.nodeType===9&&v.documentElement&&v.removeChild(v.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(he(163))}}catch(S){$t(e,e.return,S)}if(t=e.sibling,t!==null){t.return=e.return,Oe=t;break}Oe=e.return}return _=L_,L_=!1,_}function Ga(t,e,n){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&t)===t){var s=r.destroy;r.destroy=void 0,s!==void 0&&vp(e,n,s)}r=r.next}while(r!==i)}}function Nu(t,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var n=e=e.next;do{if((n.tag&t)===t){var i=n.create;n.destroy=i()}n=n.next}while(n!==e)}}function xp(t){var e=t.ref;if(e!==null){var n=t.stateNode;switch(t.tag){case 5:t=n;break;default:t=n}typeof e=="function"?e(t):e.current=t}}function wx(t){var e=t.alternate;e!==null&&(t.alternate=null,wx(e)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(e=t.stateNode,e!==null&&(delete e[Wi],delete e[nl],delete e[sp],delete e[U1],delete e[F1])),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}function Ex(t){return t.tag===5||t.tag===3||t.tag===4}function N_(t){e:for(;;){for(;t.sibling===null;){if(t.return===null||Ex(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.flags&2||t.child===null||t.tag===4)continue e;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function yp(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.nodeType===8?n.parentNode.insertBefore(t,e):n.insertBefore(t,e):(n.nodeType===8?(e=n.parentNode,e.insertBefore(t,n)):(e=n,e.appendChild(t)),n=n._reactRootContainer,n!=null||e.onclick!==null||(e.onclick=cu));else if(i!==4&&(t=t.child,t!==null))for(yp(t,e,n),t=t.sibling;t!==null;)yp(t,e,n),t=t.sibling}function Sp(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.insertBefore(t,e):n.appendChild(t);else if(i!==4&&(t=t.child,t!==null))for(Sp(t,e,n),t=t.sibling;t!==null;)Sp(t,e,n),t=t.sibling}var pn=null,wi=!1;function Br(t,e,n){for(n=n.child;n!==null;)Tx(t,e,n),n=n.sibling}function Tx(t,e,n){if(Xi&&typeof Xi.onCommitFiberUnmount=="function")try{Xi.onCommitFiberUnmount(Tu,n)}catch{}switch(n.tag){case 5:Mn||yo(n,e);case 6:var i=pn,r=wi;pn=null,Br(t,e,n),pn=i,wi=r,pn!==null&&(wi?(t=pn,n=n.stateNode,t.nodeType===8?t.parentNode.removeChild(n):t.removeChild(n)):pn.removeChild(n.stateNode));break;case 18:pn!==null&&(wi?(t=pn,n=n.stateNode,t.nodeType===8?Ed(t.parentNode,n):t.nodeType===1&&Ed(t,n),Ja(t)):Ed(pn,n.stateNode));break;case 4:i=pn,r=wi,pn=n.stateNode.containerInfo,wi=!0,Br(t,e,n),pn=i,wi=r;break;case 0:case 11:case 14:case 15:if(!Mn&&(i=n.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&(s&2||s&4)&&vp(n,e,o),r=r.next}while(r!==i)}Br(t,e,n);break;case 1:if(!Mn&&(yo(n,e),i=n.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=n.memoizedProps,i.state=n.memoizedState,i.componentWillUnmount()}catch(a){$t(n,e,a)}Br(t,e,n);break;case 21:Br(t,e,n);break;case 22:n.mode&1?(Mn=(i=Mn)||n.memoizedState!==null,Br(t,e,n),Mn=i):Br(t,e,n);break;default:Br(t,e,n)}}function D_(t){var e=t.updateQueue;if(e!==null){t.updateQueue=null;var n=t.stateNode;n===null&&(n=t.stateNode=new j1),e.forEach(function(i){var r=lw.bind(null,t,i);n.has(i)||(n.add(i),i.then(r,r))})}}function Si(t,e){var n=e.deletions;if(n!==null)for(var i=0;i<n.length;i++){var r=n[i];try{var s=t,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:pn=a.stateNode,wi=!1;break e;case 3:pn=a.stateNode.containerInfo,wi=!0;break e;case 4:pn=a.stateNode.containerInfo,wi=!0;break e}a=a.return}if(pn===null)throw Error(he(160));Tx(s,o,r),pn=null,wi=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(c){$t(r,e,c)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)bx(e,t),e=e.sibling}function bx(t,e){var n=t.alternate,i=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:if(Si(e,t),Hi(t),i&4){try{Ga(3,t,t.return),Nu(3,t)}catch(y){$t(t,t.return,y)}try{Ga(5,t,t.return)}catch(y){$t(t,t.return,y)}}break;case 1:Si(e,t),Hi(t),i&512&&n!==null&&yo(n,n.return);break;case 5:if(Si(e,t),Hi(t),i&512&&n!==null&&yo(n,n.return),t.flags&32){var r=t.stateNode;try{Ya(r,"")}catch(y){$t(t,t.return,y)}}if(i&4&&(r=t.stateNode,r!=null)){var s=t.memoizedProps,o=n!==null?n.memoizedProps:s,a=t.type,l=t.updateQueue;if(t.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&$_(r,s),Xd(a,o);var c=Xd(a,s);for(o=0;o<l.length;o+=2){var f=l[o],d=l[o+1];f==="style"?Q_(r,d):f==="dangerouslySetInnerHTML"?J_(r,d):f==="children"?Ya(r,d):Cp(r,f,d,c)}switch(a){case"input":zd(r,s);break;case"textarea":Z_(r,s);break;case"select":var h=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var p=s.value;p!=null?Mo(r,!!s.multiple,p,!1):h!==!!s.multiple&&(s.defaultValue!=null?Mo(r,!!s.multiple,s.defaultValue,!0):Mo(r,!!s.multiple,s.multiple?[]:"",!1))}r[nl]=s}catch(y){$t(t,t.return,y)}}break;case 6:if(Si(e,t),Hi(t),i&4){if(t.stateNode===null)throw Error(he(162));r=t.stateNode,s=t.memoizedProps;try{r.nodeValue=s}catch(y){$t(t,t.return,y)}}break;case 3:if(Si(e,t),Hi(t),i&4&&n!==null&&n.memoizedState.isDehydrated)try{Ja(e.containerInfo)}catch(y){$t(t,t.return,y)}break;case 4:Si(e,t),Hi(t);break;case 13:Si(e,t),Hi(t),r=t.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(am=Jt())),i&4&&D_(t);break;case 22:if(f=n!==null&&n.memoizedState!==null,t.mode&1?(Mn=(c=Mn)||f,Si(e,t),Mn=c):Si(e,t),Hi(t),i&8192){if(c=t.memoizedState!==null,(t.stateNode.isHidden=c)&&!f&&t.mode&1)for(Oe=t,f=t.child;f!==null;){for(d=Oe=f;Oe!==null;){switch(h=Oe,p=h.child,h.tag){case 0:case 11:case 14:case 15:Ga(4,h,h.return);break;case 1:yo(h,h.return);var _=h.stateNode;if(typeof _.componentWillUnmount=="function"){i=h,n=h.return;try{e=i,_.props=e.memoizedProps,_.state=e.memoizedState,_.componentWillUnmount()}catch(y){$t(i,n,y)}}break;case 5:yo(h,h.return);break;case 22:if(h.memoizedState!==null){F_(d);continue}}p!==null?(p.return=h,Oe=p):F_(d)}f=f.sibling}e:for(f=null,d=t;;){if(d.tag===5){if(f===null){f=d;try{r=d.stateNode,c?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=d.stateNode,l=d.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=j_("display",o))}catch(y){$t(t,t.return,y)}}}else if(d.tag===6){if(f===null)try{d.stateNode.nodeValue=c?"":d.memoizedProps}catch(y){$t(t,t.return,y)}}else if((d.tag!==22&&d.tag!==23||d.memoizedState===null||d===t)&&d.child!==null){d.child.return=d,d=d.child;continue}if(d===t)break e;for(;d.sibling===null;){if(d.return===null||d.return===t)break e;f===d&&(f=null),d=d.return}f===d&&(f=null),d.sibling.return=d.return,d=d.sibling}}break;case 19:Si(e,t),Hi(t),i&4&&D_(t);break;case 21:break;default:Si(e,t),Hi(t)}}function Hi(t){var e=t.flags;if(e&2){try{e:{for(var n=t.return;n!==null;){if(Ex(n)){var i=n;break e}n=n.return}throw Error(he(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(Ya(r,""),i.flags&=-33);var s=N_(t);Sp(t,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=N_(t);yp(t,a,o);break;default:throw Error(he(161))}}catch(l){$t(t,t.return,l)}t.flags&=-3}e&4096&&(t.flags&=-4097)}function ew(t,e,n){Oe=t,Ax(t,e,n)}function Ax(t,e,n){for(var i=(t.mode&1)!==0;Oe!==null;){var r=Oe,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||Gc;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||Mn;a=Gc;var c=Mn;if(Gc=o,(Mn=l)&&!c)for(Oe=r;Oe!==null;)o=Oe,l=o.child,o.tag===22&&o.memoizedState!==null?O_(r):l!==null?(l.return=o,Oe=l):O_(r);for(;s!==null;)Oe=s,Ax(s,e,n),s=s.sibling;Oe=r,Gc=a,Mn=c}U_(t,e,n)}else r.subtreeFlags&8772&&s!==null?(s.return=r,Oe=s):U_(t,e,n)}}function U_(t){for(;Oe!==null;){var e=Oe;if(e.flags&8772){var n=e.alternate;try{if(e.flags&8772)switch(e.tag){case 0:case 11:case 15:Mn||Nu(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!Mn)if(n===null)i.componentDidMount();else{var r=e.elementType===e.type?n.memoizedProps:Mi(e.type,n.memoizedProps);i.componentDidUpdate(r,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&x_(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(n=null,e.child!==null)switch(e.child.tag){case 5:n=e.child.stateNode;break;case 1:n=e.child.stateNode}x_(e,o,n)}break;case 5:var a=e.stateNode;if(n===null&&e.flags&4){n=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&n.focus();break;case"img":l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var c=e.alternate;if(c!==null){var f=c.memoizedState;if(f!==null){var d=f.dehydrated;d!==null&&Ja(d)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(he(163))}Mn||e.flags&512&&xp(e)}catch(h){$t(e,e.return,h)}}if(e===t){Oe=null;break}if(n=e.sibling,n!==null){n.return=e.return,Oe=n;break}Oe=e.return}}function F_(t){for(;Oe!==null;){var e=Oe;if(e===t){Oe=null;break}var n=e.sibling;if(n!==null){n.return=e.return,Oe=n;break}Oe=e.return}}function O_(t){for(;Oe!==null;){var e=Oe;try{switch(e.tag){case 0:case 11:case 15:var n=e.return;try{Nu(4,e)}catch(l){$t(e,n,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){$t(e,r,l)}}var s=e.return;try{xp(e)}catch(l){$t(e,s,l)}break;case 5:var o=e.return;try{xp(e)}catch(l){$t(e,o,l)}}}catch(l){$t(e,e.return,l)}if(e===t){Oe=null;break}var a=e.sibling;if(a!==null){a.return=e.return,Oe=a;break}Oe=e.return}}var tw=Math.ceil,yu=Sr.ReactCurrentDispatcher,sm=Sr.ReactCurrentOwner,pi=Sr.ReactCurrentBatchConfig,wt=0,cn=null,jt=null,mn=0,Zn=0,So=ns(0),nn=0,ll=null,Ds=0,Du=0,om=0,Wa=null,Vn=null,am=0,Do=1/0,fr=null,Su=!1,Mp=null,Kr=null,Wc=!1,Wr=null,Mu=0,Xa=0,wp=null,jc=-1,Qc=0;function Ln(){return wt&6?Jt():jc!==-1?jc:jc=Jt()}function Jr(t){return t.mode&1?wt&2&&mn!==0?mn&-mn:B1.transition!==null?(Qc===0&&(Qc=hv()),Qc):(t=Pt,t!==0||(t=window.event,t=t===void 0?16:vv(t.type)),t):1}function bi(t,e,n,i){if(50<Xa)throw Xa=0,wp=null,Error(he(185));cl(t,n,i),(!(wt&2)||t!==cn)&&(t===cn&&(!(wt&2)&&(Du|=n),nn===4&&Hr(t,mn)),Xn(t,i),n===1&&wt===0&&!(e.mode&1)&&(Do=Jt()+500,Pu&&is()))}function Xn(t,e){var n=t.callbackNode;zM(t,e);var i=su(t,t===cn?mn:0);if(i===0)n!==null&&X0(n),t.callbackNode=null,t.callbackPriority=0;else if(e=i&-i,t.callbackPriority!==e){if(n!=null&&X0(n),e===1)t.tag===0?O1(B_.bind(null,t)):Ov(B_.bind(null,t)),N1(function(){!(wt&6)&&is()}),n=null;else{switch(fv(i)){case 1:n=Np;break;case 4:n=cv;break;case 16:n=ru;break;case 536870912:n=uv;break;default:n=ru}n=Ux(n,Cx.bind(null,t))}t.callbackPriority=e,t.callbackNode=n}}function Cx(t,e){if(jc=-1,Qc=0,wt&6)throw Error(he(327));var n=t.callbackNode;if(Ao()&&t.callbackNode!==n)return null;var i=su(t,t===cn?mn:0);if(i===0)return null;if(i&30||i&t.expiredLanes||e)e=wu(t,i);else{e=i;var r=wt;wt|=2;var s=Px();(cn!==t||mn!==e)&&(fr=null,Do=Jt()+500,Rs(t,e));do try{rw();break}catch(a){Rx(t,a)}while(!0);qp(),yu.current=s,wt=r,jt!==null?e=0:(cn=null,mn=0,e=nn)}if(e!==0){if(e===2&&(r=Kd(t),r!==0&&(i=r,e=Ep(t,r))),e===1)throw n=ll,Rs(t,0),Hr(t,i),Xn(t,Jt()),n;if(e===6)Hr(t,i);else{if(r=t.current.alternate,!(i&30)&&!nw(r)&&(e=wu(t,i),e===2&&(s=Kd(t),s!==0&&(i=s,e=Ep(t,s))),e===1))throw n=ll,Rs(t,0),Hr(t,i),Xn(t,Jt()),n;switch(t.finishedWork=r,t.finishedLanes=i,e){case 0:case 1:throw Error(he(345));case 2:Ts(t,Vn,fr);break;case 3:if(Hr(t,i),(i&130023424)===i&&(e=am+500-Jt(),10<e)){if(su(t,0)!==0)break;if(r=t.suspendedLanes,(r&i)!==i){Ln(),t.pingedLanes|=t.suspendedLanes&r;break}t.timeoutHandle=rp(Ts.bind(null,t,Vn,fr),e);break}Ts(t,Vn,fr);break;case 4:if(Hr(t,i),(i&4194240)===i)break;for(e=t.eventTimes,r=-1;0<i;){var o=31-Ti(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=Jt()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*tw(i/1960))-i,10<i){t.timeoutHandle=rp(Ts.bind(null,t,Vn,fr),i);break}Ts(t,Vn,fr);break;case 5:Ts(t,Vn,fr);break;default:throw Error(he(329))}}}return Xn(t,Jt()),t.callbackNode===n?Cx.bind(null,t):null}function Ep(t,e){var n=Wa;return t.current.memoizedState.isDehydrated&&(Rs(t,e).flags|=256),t=wu(t,e),t!==2&&(e=Vn,Vn=n,e!==null&&Tp(e)),t}function Tp(t){Vn===null?Vn=t:Vn.push.apply(Vn,t)}function nw(t){for(var e=t;;){if(e.flags&16384){var n=e.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var i=0;i<n.length;i++){var r=n[i],s=r.getSnapshot;r=r.value;try{if(!Ai(s(),r))return!1}catch{return!1}}}if(n=e.child,e.subtreeFlags&16384&&n!==null)n.return=e,e=n;else{if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function Hr(t,e){for(e&=~om,e&=~Du,t.suspendedLanes|=e,t.pingedLanes&=~e,t=t.expirationTimes;0<e;){var n=31-Ti(e),i=1<<n;t[n]=-1,e&=~i}}function B_(t){if(wt&6)throw Error(he(327));Ao();var e=su(t,0);if(!(e&1))return Xn(t,Jt()),null;var n=wu(t,e);if(t.tag!==0&&n===2){var i=Kd(t);i!==0&&(e=i,n=Ep(t,i))}if(n===1)throw n=ll,Rs(t,0),Hr(t,e),Xn(t,Jt()),n;if(n===6)throw Error(he(345));return t.finishedWork=t.current.alternate,t.finishedLanes=e,Ts(t,Vn,fr),Xn(t,Jt()),null}function lm(t,e){var n=wt;wt|=1;try{return t(e)}finally{wt=n,wt===0&&(Do=Jt()+500,Pu&&is())}}function Us(t){Wr!==null&&Wr.tag===0&&!(wt&6)&&Ao();var e=wt;wt|=1;var n=pi.transition,i=Pt;try{if(pi.transition=null,Pt=1,t)return t()}finally{Pt=i,pi.transition=n,wt=e,!(wt&6)&&is()}}function cm(){Zn=So.current,Bt(So)}function Rs(t,e){t.finishedWork=null,t.finishedLanes=0;var n=t.timeoutHandle;if(n!==-1&&(t.timeoutHandle=-1,L1(n)),jt!==null)for(n=jt.return;n!==null;){var i=n;switch(Gp(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&uu();break;case 3:Lo(),Bt(Gn),Bt(wn),jp();break;case 5:Jp(i);break;case 4:Lo();break;case 13:Bt(Gt);break;case 19:Bt(Gt);break;case 10:Yp(i.type._context);break;case 22:case 23:cm()}n=n.return}if(cn=t,jt=t=jr(t.current,null),mn=Zn=e,nn=0,ll=null,om=Du=Ds=0,Vn=Wa=null,As!==null){for(e=0;e<As.length;e++)if(n=As[e],i=n.interleaved,i!==null){n.interleaved=null;var r=i.next,s=n.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}n.pending=i}As=null}return t}function Rx(t,e){do{var n=jt;try{if(qp(),Zc.current=xu,vu){for(var i=Wt.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}vu=!1}if(Ns=0,ln=tn=Wt=null,Ha=!1,sl=0,sm.current=null,n===null||n.return===null){nn=1,ll=e,jt=null;break}e:{var s=t,o=n.return,a=n,l=e;if(e=mn,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var c=l,f=a,d=f.tag;if(!(f.mode&1)&&(d===0||d===11||d===15)){var h=f.alternate;h?(f.updateQueue=h.updateQueue,f.memoizedState=h.memoizedState,f.lanes=h.lanes):(f.updateQueue=null,f.memoizedState=null)}var p=T_(o);if(p!==null){p.flags&=-257,b_(p,o,a,s,e),p.mode&1&&E_(s,c,e),e=p,l=c;var _=e.updateQueue;if(_===null){var y=new Set;y.add(l),e.updateQueue=y}else _.add(l);break e}else{if(!(e&1)){E_(s,c,e),um();break e}l=Error(he(426))}}else if(zt&&a.mode&1){var m=T_(o);if(m!==null){!(m.flags&65536)&&(m.flags|=256),b_(m,o,a,s,e),Wp(No(l,a));break e}}s=l=No(l,a),nn!==4&&(nn=2),Wa===null?Wa=[s]:Wa.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var u=fx(s,l,e);v_(s,u);break e;case 1:a=l;var g=s.type,v=s.stateNode;if(!(s.flags&128)&&(typeof g.getDerivedStateFromError=="function"||v!==null&&typeof v.componentDidCatch=="function"&&(Kr===null||!Kr.has(v)))){s.flags|=65536,e&=-e,s.lanes|=e;var S=dx(s,a,e);v_(s,S);break e}}s=s.return}while(s!==null)}Lx(n)}catch(A){e=A,jt===n&&n!==null&&(jt=n=n.return);continue}break}while(!0)}function Px(){var t=yu.current;return yu.current=xu,t===null?xu:t}function um(){(nn===0||nn===3||nn===2)&&(nn=4),cn===null||!(Ds&268435455)&&!(Du&268435455)||Hr(cn,mn)}function wu(t,e){var n=wt;wt|=2;var i=Px();(cn!==t||mn!==e)&&(fr=null,Rs(t,e));do try{iw();break}catch(r){Rx(t,r)}while(!0);if(qp(),wt=n,yu.current=i,jt!==null)throw Error(he(261));return cn=null,mn=0,nn}function iw(){for(;jt!==null;)Ix(jt)}function rw(){for(;jt!==null&&!IM();)Ix(jt)}function Ix(t){var e=Dx(t.alternate,t,Zn);t.memoizedProps=t.pendingProps,e===null?Lx(t):jt=e,sm.current=null}function Lx(t){var e=t;do{var n=e.alternate;if(t=e.return,e.flags&32768){if(n=J1(n,e),n!==null){n.flags&=32767,jt=n;return}if(t!==null)t.flags|=32768,t.subtreeFlags=0,t.deletions=null;else{nn=6,jt=null;return}}else if(n=K1(n,e,Zn),n!==null){jt=n;return}if(e=e.sibling,e!==null){jt=e;return}jt=e=t}while(e!==null);nn===0&&(nn=5)}function Ts(t,e,n){var i=Pt,r=pi.transition;try{pi.transition=null,Pt=1,sw(t,e,n,i)}finally{pi.transition=r,Pt=i}return null}function sw(t,e,n,i){do Ao();while(Wr!==null);if(wt&6)throw Error(he(327));n=t.finishedWork;var r=t.finishedLanes;if(n===null)return null;if(t.finishedWork=null,t.finishedLanes=0,n===t.current)throw Error(he(177));t.callbackNode=null,t.callbackPriority=0;var s=n.lanes|n.childLanes;if(VM(t,s),t===cn&&(jt=cn=null,mn=0),!(n.subtreeFlags&2064)&&!(n.flags&2064)||Wc||(Wc=!0,Ux(ru,function(){return Ao(),null})),s=(n.flags&15990)!==0,n.subtreeFlags&15990||s){s=pi.transition,pi.transition=null;var o=Pt;Pt=1;var a=wt;wt|=4,sm.current=null,Q1(t,n),bx(n,t),A1(np),ou=!!tp,np=tp=null,t.current=n,ew(n,t,r),LM(),wt=a,Pt=o,pi.transition=s}else t.current=n;if(Wc&&(Wc=!1,Wr=t,Mu=r),s=t.pendingLanes,s===0&&(Kr=null),UM(n.stateNode,i),Xn(t,Jt()),e!==null)for(i=t.onRecoverableError,n=0;n<e.length;n++)r=e[n],i(r.value,{componentStack:r.stack,digest:r.digest});if(Su)throw Su=!1,t=Mp,Mp=null,t;return Mu&1&&t.tag!==0&&Ao(),s=t.pendingLanes,s&1?t===wp?Xa++:(Xa=0,wp=t):Xa=0,is(),null}function Ao(){if(Wr!==null){var t=fv(Mu),e=pi.transition,n=Pt;try{if(pi.transition=null,Pt=16>t?16:t,Wr===null)var i=!1;else{if(t=Wr,Wr=null,Mu=0,wt&6)throw Error(he(331));var r=wt;for(wt|=4,Oe=t.current;Oe!==null;){var s=Oe,o=s.child;if(Oe.flags&16){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var c=a[l];for(Oe=c;Oe!==null;){var f=Oe;switch(f.tag){case 0:case 11:case 15:Ga(8,f,s)}var d=f.child;if(d!==null)d.return=f,Oe=d;else for(;Oe!==null;){f=Oe;var h=f.sibling,p=f.return;if(wx(f),f===c){Oe=null;break}if(h!==null){h.return=p,Oe=h;break}Oe=p}}}var _=s.alternate;if(_!==null){var y=_.child;if(y!==null){_.child=null;do{var m=y.sibling;y.sibling=null,y=m}while(y!==null)}}Oe=s}}if(s.subtreeFlags&2064&&o!==null)o.return=s,Oe=o;else e:for(;Oe!==null;){if(s=Oe,s.flags&2048)switch(s.tag){case 0:case 11:case 15:Ga(9,s,s.return)}var u=s.sibling;if(u!==null){u.return=s.return,Oe=u;break e}Oe=s.return}}var g=t.current;for(Oe=g;Oe!==null;){o=Oe;var v=o.child;if(o.subtreeFlags&2064&&v!==null)v.return=o,Oe=v;else e:for(o=g;Oe!==null;){if(a=Oe,a.flags&2048)try{switch(a.tag){case 0:case 11:case 15:Nu(9,a)}}catch(A){$t(a,a.return,A)}if(a===o){Oe=null;break e}var S=a.sibling;if(S!==null){S.return=a.return,Oe=S;break e}Oe=a.return}}if(wt=r,is(),Xi&&typeof Xi.onPostCommitFiberRoot=="function")try{Xi.onPostCommitFiberRoot(Tu,t)}catch{}i=!0}return i}finally{Pt=n,pi.transition=e}}return!1}function k_(t,e,n){e=No(n,e),e=fx(t,e,1),t=Zr(t,e,1),e=Ln(),t!==null&&(cl(t,1,e),Xn(t,e))}function $t(t,e,n){if(t.tag===3)k_(t,t,n);else for(;e!==null;){if(e.tag===3){k_(e,t,n);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(Kr===null||!Kr.has(i))){t=No(n,t),t=dx(e,t,1),e=Zr(e,t,1),t=Ln(),e!==null&&(cl(e,1,t),Xn(e,t));break}}e=e.return}}function ow(t,e,n){var i=t.pingCache;i!==null&&i.delete(e),e=Ln(),t.pingedLanes|=t.suspendedLanes&n,cn===t&&(mn&n)===n&&(nn===4||nn===3&&(mn&130023424)===mn&&500>Jt()-am?Rs(t,0):om|=n),Xn(t,e)}function Nx(t,e){e===0&&(t.mode&1?(e=Pc,Pc<<=1,!(Pc&130023424)&&(Pc=4194304)):e=1);var n=Ln();t=xr(t,e),t!==null&&(cl(t,e,n),Xn(t,n))}function aw(t){var e=t.memoizedState,n=0;e!==null&&(n=e.retryLane),Nx(t,n)}function lw(t,e){var n=0;switch(t.tag){case 13:var i=t.stateNode,r=t.memoizedState;r!==null&&(n=r.retryLane);break;case 19:i=t.stateNode;break;default:throw Error(he(314))}i!==null&&i.delete(e),Nx(t,n)}var Dx;Dx=function(t,e,n){if(t!==null)if(t.memoizedProps!==e.pendingProps||Gn.current)Hn=!0;else{if(!(t.lanes&n)&&!(e.flags&128))return Hn=!1,Z1(t,e,n);Hn=!!(t.flags&131072)}else Hn=!1,zt&&e.flags&1048576&&Bv(e,du,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;Jc(t,e),t=e.pendingProps;var r=Ro(e,wn.current);bo(e,n),r=em(null,e,i,t,r,n);var s=tm();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,Wn(i)?(s=!0,hu(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,Zp(e),r.updater=Lu,e.stateNode=r,r._reactInternals=e,hp(e,i,t,n),e=pp(null,e,i,!0,s,n)):(e.tag=0,zt&&s&&Hp(e),In(null,e,r,n),e=e.child),e;case 16:i=e.elementType;e:{switch(Jc(t,e),t=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=uw(i),t=Mi(i,t),r){case 0:e=dp(null,e,i,t,n);break e;case 1:e=R_(null,e,i,t,n);break e;case 11:e=A_(null,e,i,t,n);break e;case 14:e=C_(null,e,i,Mi(i.type,t),n);break e}throw Error(he(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Mi(i,r),dp(t,e,i,r,n);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Mi(i,r),R_(t,e,i,r,n);case 3:e:{if(_x(e),t===null)throw Error(he(387));i=e.pendingProps,s=e.memoizedState,r=s.element,Wv(t,e),gu(e,i,null,n);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=No(Error(he(423)),e),e=P_(t,e,i,n,r);break e}else if(i!==r){r=No(Error(he(424)),e),e=P_(t,e,i,n,r);break e}else for(Kn=$r(e.stateNode.containerInfo.firstChild),Jn=e,zt=!0,Ei=null,n=Hv(e,null,i,n),e.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if(Po(),i===r){e=yr(t,e,n);break e}In(t,e,i,n)}e=e.child}return e;case 5:return Xv(e),t===null&&lp(e),i=e.type,r=e.pendingProps,s=t!==null?t.memoizedProps:null,o=r.children,ip(i,r)?o=null:s!==null&&ip(i,s)&&(e.flags|=32),gx(t,e),In(t,e,o,n),e.child;case 6:return t===null&&lp(e),null;case 13:return vx(t,e,n);case 4:return Kp(e,e.stateNode.containerInfo),i=e.pendingProps,t===null?e.child=Io(e,null,i,n):In(t,e,i,n),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Mi(i,r),A_(t,e,i,r,n);case 7:return In(t,e,e.pendingProps,n),e.child;case 8:return In(t,e,e.pendingProps.children,n),e.child;case 12:return In(t,e,e.pendingProps.children,n),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,Ut(pu,i._currentValue),i._currentValue=o,s!==null)if(Ai(s.value,o)){if(s.children===r.children&&!Gn.current){e=yr(t,e,n);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=gr(-1,n&-n),l.tag=2;var c=s.updateQueue;if(c!==null){c=c.shared;var f=c.pending;f===null?l.next=l:(l.next=f.next,f.next=l),c.pending=l}}s.lanes|=n,l=s.alternate,l!==null&&(l.lanes|=n),cp(s.return,n,e),a.lanes|=n;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(he(341));o.lanes|=n,a=o.alternate,a!==null&&(a.lanes|=n),cp(o,n,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}In(t,e,r.children,n),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,bo(e,n),r=mi(r),i=i(r),e.flags|=1,In(t,e,i,n),e.child;case 14:return i=e.type,r=Mi(i,e.pendingProps),r=Mi(i.type,r),C_(t,e,i,r,n);case 15:return px(t,e,e.type,e.pendingProps,n);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Mi(i,r),Jc(t,e),e.tag=1,Wn(i)?(t=!0,hu(e)):t=!1,bo(e,n),hx(e,i,r),hp(e,i,r,n),pp(null,e,i,!0,t,n);case 19:return xx(t,e,n);case 22:return mx(t,e,n)}throw Error(he(156,e.tag))};function Ux(t,e){return lv(t,e)}function cw(t,e,n,i){this.tag=t,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function di(t,e,n,i){return new cw(t,e,n,i)}function hm(t){return t=t.prototype,!(!t||!t.isReactComponent)}function uw(t){if(typeof t=="function")return hm(t)?1:0;if(t!=null){if(t=t.$$typeof,t===Pp)return 11;if(t===Ip)return 14}return 2}function jr(t,e){var n=t.alternate;return n===null?(n=di(t.tag,e,t.key,t.mode),n.elementType=t.elementType,n.type=t.type,n.stateNode=t.stateNode,n.alternate=t,t.alternate=n):(n.pendingProps=e,n.type=t.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=t.flags&14680064,n.childLanes=t.childLanes,n.lanes=t.lanes,n.child=t.child,n.memoizedProps=t.memoizedProps,n.memoizedState=t.memoizedState,n.updateQueue=t.updateQueue,e=t.dependencies,n.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},n.sibling=t.sibling,n.index=t.index,n.ref=t.ref,n}function eu(t,e,n,i,r,s){var o=2;if(i=t,typeof t=="function")hm(t)&&(o=1);else if(typeof t=="string")o=5;else e:switch(t){case uo:return Ps(n.children,r,s,e);case Rp:o=8,r|=8;break;case Ud:return t=di(12,n,e,r|2),t.elementType=Ud,t.lanes=s,t;case Fd:return t=di(13,n,e,r),t.elementType=Fd,t.lanes=s,t;case Od:return t=di(19,n,e,r),t.elementType=Od,t.lanes=s,t;case X_:return Uu(n,r,s,e);default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case G_:o=10;break e;case W_:o=9;break e;case Pp:o=11;break e;case Ip:o=14;break e;case kr:o=16,i=null;break e}throw Error(he(130,t==null?t:typeof t,""))}return e=di(o,n,e,r),e.elementType=t,e.type=i,e.lanes=s,e}function Ps(t,e,n,i){return t=di(7,t,i,e),t.lanes=n,t}function Uu(t,e,n,i){return t=di(22,t,i,e),t.elementType=X_,t.lanes=n,t.stateNode={isHidden:!1},t}function Ld(t,e,n){return t=di(6,t,null,e),t.lanes=n,t}function Nd(t,e,n){return e=di(4,t.children!==null?t.children:[],t.key,e),e.lanes=n,e.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},e}function hw(t,e,n,i,r){this.tag=e,this.containerInfo=t,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=gd(0),this.expirationTimes=gd(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=gd(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function fm(t,e,n,i,r,s,o,a,l){return t=new hw(t,e,n,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=di(3,null,null,e),t.current=s,s.stateNode=t,s.memoizedState={element:i,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},Zp(s),t}function fw(t,e,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:co,key:i==null?null:""+i,children:t,containerInfo:e,implementation:n}}function Fx(t){if(!t)return es;t=t._reactInternals;e:{if(Os(t)!==t||t.tag!==1)throw Error(he(170));var e=t;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(Wn(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(he(171))}if(t.tag===1){var n=t.type;if(Wn(n))return Fv(t,n,e)}return e}function Ox(t,e,n,i,r,s,o,a,l){return t=fm(n,i,!0,t,r,s,o,a,l),t.context=Fx(null),n=t.current,i=Ln(),r=Jr(n),s=gr(i,r),s.callback=e??null,Zr(n,s,r),t.current.lanes=r,cl(t,r,i),Xn(t,i),t}function Fu(t,e,n,i){var r=e.current,s=Ln(),o=Jr(r);return n=Fx(n),e.context===null?e.context=n:e.pendingContext=n,e=gr(s,o),e.payload={element:t},i=i===void 0?null:i,i!==null&&(e.callback=i),t=Zr(r,e,o),t!==null&&(bi(t,r,o,s),$c(t,r,o)),o}function Eu(t){if(t=t.current,!t.child)return null;switch(t.child.tag){case 5:return t.child.stateNode;default:return t.child.stateNode}}function z_(t,e){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var n=t.retryLane;t.retryLane=n!==0&&n<e?n:e}}function dm(t,e){z_(t,e),(t=t.alternate)&&z_(t,e)}function dw(){return null}var Bx=typeof reportError=="function"?reportError:function(t){console.error(t)};function pm(t){this._internalRoot=t}Ou.prototype.render=pm.prototype.render=function(t){var e=this._internalRoot;if(e===null)throw Error(he(409));Fu(t,e,null,null)};Ou.prototype.unmount=pm.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var e=t.containerInfo;Us(function(){Fu(null,t,null,null)}),e[vr]=null}};function Ou(t){this._internalRoot=t}Ou.prototype.unstable_scheduleHydration=function(t){if(t){var e=mv();t={blockedOn:null,target:t,priority:e};for(var n=0;n<Vr.length&&e!==0&&e<Vr[n].priority;n++);Vr.splice(n,0,t),n===0&&_v(t)}};function mm(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function Bu(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11&&(t.nodeType!==8||t.nodeValue!==" react-mount-point-unstable "))}function V_(){}function pw(t,e,n,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var c=Eu(o);s.call(c)}}var o=Ox(e,i,t,0,null,!1,!1,"",V_);return t._reactRootContainer=o,t[vr]=o.current,el(t.nodeType===8?t.parentNode:t),Us(),o}for(;r=t.lastChild;)t.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var c=Eu(l);a.call(c)}}var l=fm(t,0,!1,null,null,!1,!1,"",V_);return t._reactRootContainer=l,t[vr]=l.current,el(t.nodeType===8?t.parentNode:t),Us(function(){Fu(e,l,n,i)}),l}function ku(t,e,n,i,r){var s=n._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=Eu(o);a.call(l)}}Fu(e,o,t,r)}else o=pw(n,e,t,r,i);return Eu(o)}dv=function(t){switch(t.tag){case 3:var e=t.stateNode;if(e.current.memoizedState.isDehydrated){var n=Ua(e.pendingLanes);n!==0&&(Dp(e,n|1),Xn(e,Jt()),!(wt&6)&&(Do=Jt()+500,is()))}break;case 13:Us(function(){var i=xr(t,1);if(i!==null){var r=Ln();bi(i,t,1,r)}}),dm(t,1)}};Up=function(t){if(t.tag===13){var e=xr(t,134217728);if(e!==null){var n=Ln();bi(e,t,134217728,n)}dm(t,134217728)}};pv=function(t){if(t.tag===13){var e=Jr(t),n=xr(t,e);if(n!==null){var i=Ln();bi(n,t,e,i)}dm(t,e)}};mv=function(){return Pt};gv=function(t,e){var n=Pt;try{return Pt=t,e()}finally{Pt=n}};Yd=function(t,e,n){switch(e){case"input":if(zd(t,n),e=n.name,n.type==="radio"&&e!=null){for(n=t;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<n.length;e++){var i=n[e];if(i!==t&&i.form===t.form){var r=Ru(i);if(!r)throw Error(he(90));Y_(i),zd(i,r)}}}break;case"textarea":Z_(t,n);break;case"select":e=n.value,e!=null&&Mo(t,!!n.multiple,e,!1)}};nv=lm;iv=Us;var mw={usingClientEntryPoint:!1,Events:[hl,mo,Ru,ev,tv,lm]},Ia={findFiberByHostInstance:bs,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},gw={bundleType:Ia.bundleType,version:Ia.version,rendererPackageName:Ia.rendererPackageName,rendererConfig:Ia.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:Sr.ReactCurrentDispatcher,findHostInstanceByFiber:function(t){return t=ov(t),t===null?null:t.stateNode},findFiberByHostInstance:Ia.findFiberByHostInstance||dw,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(La=__REACT_DEVTOOLS_GLOBAL_HOOK__,!La.isDisabled&&La.supportsFiber))try{Tu=La.inject(gw),Xi=La}catch{}var La;ei.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=mw;ei.createPortal=function(t,e){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!mm(e))throw Error(he(200));return fw(t,e,null,n)};ei.createRoot=function(t,e){if(!mm(t))throw Error(he(299));var n=!1,i="",r=Bx;return e!=null&&(e.unstable_strictMode===!0&&(n=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=fm(t,1,!1,null,null,n,!1,i,r),t[vr]=e.current,el(t.nodeType===8?t.parentNode:t),new pm(e)};ei.findDOMNode=function(t){if(t==null)return null;if(t.nodeType===1)return t;var e=t._reactInternals;if(e===void 0)throw typeof t.render=="function"?Error(he(188)):(t=Object.keys(t).join(","),Error(he(268,t)));return t=ov(e),t=t===null?null:t.stateNode,t};ei.flushSync=function(t){return Us(t)};ei.hydrate=function(t,e,n){if(!Bu(e))throw Error(he(200));return ku(null,t,e,!0,n)};ei.hydrateRoot=function(t,e,n){if(!mm(t))throw Error(he(405));var i=n!=null&&n.hydratedSources||null,r=!1,s="",o=Bx;if(n!=null&&(n.unstable_strictMode===!0&&(r=!0),n.identifierPrefix!==void 0&&(s=n.identifierPrefix),n.onRecoverableError!==void 0&&(o=n.onRecoverableError)),e=Ox(e,null,t,1,n??null,r,!1,s,o),t[vr]=e.current,el(t),i)for(t=0;t<i.length;t++)n=i[t],r=n._getVersion,r=r(n._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[n,r]:e.mutableSourceEagerHydrationData.push(n,r);return new Ou(e)};ei.render=function(t,e,n){if(!Bu(e))throw Error(he(200));return ku(null,t,e,!1,n)};ei.unmountComponentAtNode=function(t){if(!Bu(t))throw Error(he(40));return t._reactRootContainer?(Us(function(){ku(null,null,t,!1,function(){t._reactRootContainer=null,t[vr]=null})}),!0):!1};ei.unstable_batchedUpdates=lm;ei.unstable_renderSubtreeIntoContainer=function(t,e,n,i){if(!Bu(n))throw Error(he(200));if(t==null||t._reactInternals===void 0)throw Error(he(38));return ku(t,e,n,!1,i)};ei.version="18.3.1-next-f1338f8080-20240426"});var Hx=hr((zR,Vx)=>{"use strict";function zx(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(zx)}catch(t){console.error(t)}}zx(),Vx.exports=kx()});var Wx=hr(gm=>{"use strict";var Gx=Hx();gm.createRoot=Gx.createRoot,gm.hydrateRoot=Gx.hydrateRoot;var VR});var zS=hr(Zf=>{"use strict";var TR=yc(),bR=Symbol.for("react.element"),AR=Symbol.for("react.fragment"),CR=Object.prototype.hasOwnProperty,RR=TR.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,PR={key:!0,ref:!0,__self:!0,__source:!0};function kS(t,e,n){var i,r={},s=null,o=null;n!==void 0&&(s=""+n),e.key!==void 0&&(s=""+e.key),e.ref!==void 0&&(o=e.ref);for(i in e)CR.call(e,i)&&!PR.hasOwnProperty(i)&&(r[i]=e[i]);if(t&&t.defaultProps)for(i in e=t.defaultProps,e)r[i]===void 0&&(r[i]=e[i]);return{$$typeof:bR,type:t,key:s,ref:o,props:r,_owner:RR.current}}Zf.Fragment=AR;Zf.jsx=kS;Zf.jsxs=kS});var Jg=hr((iI,VS)=>{"use strict";VS.exports=zS()});var Bi=gc(yc()),GS=gc(Wx());var Kh="184";var My=0,rg=1,wy=2;var Jl=1,Jh=2,ha=3,Cr=0,Bn=1,nr=2,ir=0,Ws=1,sg=2,og=3,ag=4,Ey=5;var hs=100,Ty=101,by=102,Ay=103,Cy=104,Ry=200,Py=201,Iy=202,Ly=203,hh=204,fh=205,Ny=206,Dy=207,Uy=208,Fy=209,Oy=210,By=211,ky=212,zy=213,Vy=214,dh=0,ph=1,mh=2,Xs=3,gh=4,_h=5,vh=6,xh=7,lg=0,Hy=1,Gy=2,Ni=0,cg=1,ug=2,hg=3,jl=4,fg=5,dg=6,pg=7;var mg=300,_s=301,js=302,jh=303,Qh=304,Ql=306,qs=1e3,Zi=1001,yh=1002,fn=1003,Wy=1004;var ec=1005;var _n=1006,ef=1007;var vs=1008;var qn=1009,gg=1010,_g=1011,fa=1012,tf=1013,Di=1014,Ui=1015,rr=1016,nf=1017,rf=1018,da=1020,vg=35902,xg=35899,yg=1021,Sg=1022,vi=1023,Ki=1026,xs=1027,Mg=1028,sf=1029,ys=1030,of=1031;var af=1033,tc=33776,nc=33777,ic=33778,rc=33779,lf=35840,cf=35841,uf=35842,hf=35843,ff=36196,df=37492,pf=37496,mf=37488,gf=37489,sc=37490,_f=37491,vf=37808,xf=37809,yf=37810,Sf=37811,Mf=37812,wf=37813,Ef=37814,Tf=37815,bf=37816,Af=37817,Cf=37818,Rf=37819,Pf=37820,If=37821,Lf=36492,Nf=36494,Df=36495,Uf=36283,Ff=36284,oc=36285,Of=36286;var Ml=2300,Sh=2301,uh=2302,Hm=2303,Gm=2400,Wm=2401,Xm=2402;var Xy=3200;var Bf=0,qy=1,Ir="",Un="srgb",wl="srgb-linear",El="linear",Rt="srgb";var Hs=7680;var qm=519,Yy=512,$y=513,Zy=514,kf=515,Ky=516,Jy=517,zf=518,jy=519,Ym=35044;var wg="300 es",Ii=2e3,Jo=2001;function _w(t){for(let e=t.length-1;e>=0;--e)if(t[e]>=65535)return!0;return!1}function vw(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function Tl(t){return document.createElementNS("http://www.w3.org/1999/xhtml",t)}function Qy(){let t=Tl("canvas");return t.style.display="block",t}var Xx={},jo=null;function Eg(...t){let e="THREE."+t.shift();jo?jo("log",e,...t):console.log(e,...t)}function eS(t){let e=t[0];if(typeof e=="string"&&e.startsWith("TSL:")){let n=t[1];n&&n.isStackTrace?t[0]+=" "+n.getLocation():t[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return t}function Ze(...t){t=eS(t);let e="THREE."+t.shift();if(jo)jo("warn",e,...t);else{let n=t[0];n&&n.isStackTrace?console.warn(n.getError(e)):console.warn(e,...t)}}function Je(...t){t=eS(t);let e="THREE."+t.shift();if(jo)jo("error",e,...t);else{let n=t[0];n&&n.isStackTrace?console.error(n.getError(e)):console.error(e,...t)}}function Mh(...t){let e=t.join(" ");e in Xx||(Xx[e]=!0,Ze(...t))}function tS(t,e,n){return new Promise(function(i,r){function s(){switch(t.clientWaitSync(e,t.SYNC_FLUSH_COMMANDS_BIT,0)){case t.WAIT_FAILED:r();break;case t.TIMEOUT_EXPIRED:setTimeout(s,n);break;default:i()}}setTimeout(s,n)})}var nS={[dh]:ph,[mh]:vh,[gh]:xh,[Xs]:_h,[ph]:dh,[vh]:mh,[xh]:gh,[_h]:Xs},Ji=class{addEventListener(e,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(n)===-1&&i[e].push(n)}hasEventListener(e,n){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(n)!==-1}removeEventListener(e,n){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(n);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let n=this._listeners;if(n===void 0)return;let i=n[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},En=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],qx=1234567,vl=Math.PI/180,Qo=180/Math.PI;function Qs(){let t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(En[t&255]+En[t>>8&255]+En[t>>16&255]+En[t>>24&255]+"-"+En[e&255]+En[e>>8&255]+"-"+En[e>>16&15|64]+En[e>>24&255]+"-"+En[n&63|128]+En[n>>8&255]+"-"+En[n>>16&255]+En[n>>24&255]+En[i&255]+En[i>>8&255]+En[i>>16&255]+En[i>>24&255]).toLowerCase()}function mt(t,e,n){return Math.max(e,Math.min(n,t))}function Tg(t,e){return(t%e+e)%e}function xw(t,e,n,i,r){return i+(t-e)*(r-i)/(n-e)}function yw(t,e,n){return t!==e?(n-t)/(e-t):0}function xl(t,e,n){return(1-n)*t+n*e}function Sw(t,e,n,i){return xl(t,e,1-Math.exp(-n*i))}function Mw(t,e=1){return e-Math.abs(Tg(t,e*2)-e)}function ww(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*(3-2*t))}function Ew(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*t*(t*(t*6-15)+10))}function Tw(t,e){return t+Math.floor(Math.random()*(e-t+1))}function bw(t,e){return t+Math.random()*(e-t)}function Aw(t){return t*(.5-Math.random())}function Cw(t){t!==void 0&&(qx=t);let e=qx+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function Rw(t){return t*vl}function Pw(t){return t*Qo}function Iw(t){return(t&t-1)===0&&t!==0}function Lw(t){return Math.pow(2,Math.ceil(Math.log(t)/Math.LN2))}function Nw(t){return Math.pow(2,Math.floor(Math.log(t)/Math.LN2))}function Dw(t,e,n,i,r){let s=Math.cos,o=Math.sin,a=s(n/2),l=o(n/2),c=s((e+i)/2),f=o((e+i)/2),d=s((e-i)/2),h=o((e-i)/2),p=s((i-e)/2),_=o((i-e)/2);switch(r){case"XYX":t.set(a*f,l*d,l*h,a*c);break;case"YZY":t.set(l*h,a*f,l*d,a*c);break;case"ZXZ":t.set(l*d,l*h,a*f,a*c);break;case"XZX":t.set(a*f,l*_,l*p,a*c);break;case"YXY":t.set(l*p,a*f,l*_,a*c);break;case"ZYZ":t.set(l*_,l*p,a*f,a*c);break;default:Ze("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+r)}}function Zo(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return t/4294967295;case Uint16Array:return t/65535;case Uint8Array:return t/255;case Int32Array:return Math.max(t/2147483647,-1);case Int16Array:return Math.max(t/32767,-1);case Int8Array:return Math.max(t/127,-1);default:throw new Error("Invalid component type.")}}function Dn(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return Math.round(t*4294967295);case Uint16Array:return Math.round(t*65535);case Uint8Array:return Math.round(t*255);case Int32Array:return Math.round(t*2147483647);case Int16Array:return Math.round(t*32767);case Int8Array:return Math.round(t*127);default:throw new Error("Invalid component type.")}}var Fi={DEG2RAD:vl,RAD2DEG:Qo,generateUUID:Qs,clamp:mt,euclideanModulo:Tg,mapLinear:xw,inverseLerp:yw,lerp:xl,damp:Sw,pingpong:Mw,smoothstep:ww,smootherstep:Ew,randInt:Tw,randFloat:bw,randFloatSpread:Aw,seededRandom:Cw,degToRad:Rw,radToDeg:Pw,isPowerOfTwo:Iw,ceilPowerOfTwo:Lw,floorPowerOfTwo:Nw,setQuaternionFromProperEuler:Dw,normalize:Dn,denormalize:Zo},Ig=class Ig{constructor(e=0,n=0){this.x=e,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,n){return this.x=e,this.y=n,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let n=this.x,i=this.y,r=e.elements;return this.x=r[0]*n+r[3]*i+r[6],this.y=r[1]*n+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,n){return this.x=mt(this.x,e.x,n.x),this.y=mt(this.y,e.y,n.y),this}clampScalar(e,n){return this.x=mt(this.x,e,n),this.y=mt(this.y,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(mt(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(mt(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y;return n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this}rotateAround(e,n){let i=Math.cos(n),r=Math.sin(n),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};Ig.prototype.isVector2=!0;var Te=Ig,ji=class{constructor(e=0,n=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=n,this._z=i,this._w=r}static slerpFlat(e,n,i,r,s,o,a){let l=i[r+0],c=i[r+1],f=i[r+2],d=i[r+3],h=s[o+0],p=s[o+1],_=s[o+2],y=s[o+3];if(d!==y||l!==h||c!==p||f!==_){let m=l*h+c*p+f*_+d*y;m<0&&(h=-h,p=-p,_=-_,y=-y,m=-m);let u=1-a;if(m<.9995){let g=Math.acos(m),v=Math.sin(g);u=Math.sin(u*g)/v,a=Math.sin(a*g)/v,l=l*u+h*a,c=c*u+p*a,f=f*u+_*a,d=d*u+y*a}else{l=l*u+h*a,c=c*u+p*a,f=f*u+_*a,d=d*u+y*a;let g=1/Math.sqrt(l*l+c*c+f*f+d*d);l*=g,c*=g,f*=g,d*=g}}e[n]=l,e[n+1]=c,e[n+2]=f,e[n+3]=d}static multiplyQuaternionsFlat(e,n,i,r,s,o){let a=i[r],l=i[r+1],c=i[r+2],f=i[r+3],d=s[o],h=s[o+1],p=s[o+2],_=s[o+3];return e[n]=a*_+f*d+l*p-c*h,e[n+1]=l*_+f*h+c*d-a*p,e[n+2]=c*_+f*p+a*h-l*d,e[n+3]=f*_-a*d-l*h-c*p,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,n,i,r){return this._x=e,this._y=n,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,n=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(i/2),f=a(r/2),d=a(s/2),h=l(i/2),p=l(r/2),_=l(s/2);switch(o){case"XYZ":this._x=h*f*d+c*p*_,this._y=c*p*d-h*f*_,this._z=c*f*_+h*p*d,this._w=c*f*d-h*p*_;break;case"YXZ":this._x=h*f*d+c*p*_,this._y=c*p*d-h*f*_,this._z=c*f*_-h*p*d,this._w=c*f*d+h*p*_;break;case"ZXY":this._x=h*f*d-c*p*_,this._y=c*p*d+h*f*_,this._z=c*f*_+h*p*d,this._w=c*f*d-h*p*_;break;case"ZYX":this._x=h*f*d-c*p*_,this._y=c*p*d+h*f*_,this._z=c*f*_-h*p*d,this._w=c*f*d+h*p*_;break;case"YZX":this._x=h*f*d+c*p*_,this._y=c*p*d+h*f*_,this._z=c*f*_-h*p*d,this._w=c*f*d-h*p*_;break;case"XZY":this._x=h*f*d-c*p*_,this._y=c*p*d-h*f*_,this._z=c*f*_+h*p*d,this._w=c*f*d+h*p*_;break;default:Ze("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,n){let i=n/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let n=e.elements,i=n[0],r=n[4],s=n[8],o=n[1],a=n[5],l=n[9],c=n[2],f=n[6],d=n[10],h=i+a+d;if(h>0){let p=.5/Math.sqrt(h+1);this._w=.25/p,this._x=(f-l)*p,this._y=(s-c)*p,this._z=(o-r)*p}else if(i>a&&i>d){let p=2*Math.sqrt(1+i-a-d);this._w=(f-l)/p,this._x=.25*p,this._y=(r+o)/p,this._z=(s+c)/p}else if(a>d){let p=2*Math.sqrt(1+a-i-d);this._w=(s-c)/p,this._x=(r+o)/p,this._y=.25*p,this._z=(l+f)/p}else{let p=2*Math.sqrt(1+d-i-a);this._w=(o-r)/p,this._x=(s+c)/p,this._y=(l+f)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(e,n){let i=e.dot(n)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*n.z-e.z*n.y,this._y=e.z*n.x-e.x*n.z,this._z=e.x*n.y-e.y*n.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(mt(this.dot(e),-1,1)))}rotateTowards(e,n){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,n/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=n._x,l=n._y,c=n._z,f=n._w;return this._x=i*f+o*a+r*c-s*l,this._y=r*f+o*l+s*a-i*c,this._z=s*f+o*c+i*l-r*a,this._w=o*f-i*a-r*l-s*c,this._onChangeCallback(),this}slerp(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=this.dot(e);a<0&&(i=-i,r=-r,s=-s,o=-o,a=-a);let l=1-n;if(a<.9995){let c=Math.acos(a),f=Math.sin(c);l=Math.sin(l*c)/f,n=Math.sin(n*c)/f,this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this._onChangeCallback()}else this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this.normalize();return this}slerpQuaternions(e,n,i){return this.copy(e).slerp(n,i)}random(){let e=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(n),s*Math.cos(n))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,n=0){return this._x=e[n],this._y=e[n+1],this._z=e[n+2],this._w=e[n+3],this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._w,e}fromBufferAttribute(e,n){return this._x=e.getX(n),this._y=e.getY(n),this._z=e.getZ(n),this._w=e.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},Lg=class Lg{constructor(e=0,n=0,i=0){this.x=e,this.y=n,this.z=i}set(e,n,i){return i===void 0&&(i=this.z),this.x=e,this.y=n,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,n){return this.x=e.x*n.x,this.y=e.y*n.y,this.z=e.z*n.z,this}applyEuler(e){return this.applyQuaternion(Yx.setFromEuler(e))}applyAxisAngle(e,n){return this.applyQuaternion(Yx.setFromAxisAngle(e,n))}applyMatrix3(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[3]*i+s[6]*r,this.y=s[1]*n+s[4]*i+s[7]*r,this.z=s[2]*n+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*n+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*n+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*n+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*n+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let n=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*r-a*i),f=2*(a*n-s*r),d=2*(s*i-o*n);return this.x=n+l*c+o*d-a*f,this.y=i+l*f+a*c-s*d,this.z=r+l*d+s*f-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[4]*i+s[8]*r,this.y=s[1]*n+s[5]*i+s[9]*r,this.z=s[2]*n+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,n){return this.x=mt(this.x,e.x,n.x),this.y=mt(this.y,e.y,n.y),this.z=mt(this.z,e.z,n.z),this}clampScalar(e,n){return this.x=mt(this.x,e,n),this.y=mt(this.y,e,n),this.z=mt(this.z,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(mt(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,n){let i=e.x,r=e.y,s=e.z,o=n.x,a=n.y,l=n.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let n=e.lengthSq();if(n===0)return this.set(0,0,0);let i=e.dot(this)/n;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return _m.copy(this).projectOnVector(e),this.sub(_m)}reflect(e){return this.sub(_m.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(mt(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return n*n+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,n,i){let r=Math.sin(n)*e;return this.x=r*Math.sin(i),this.y=Math.cos(n)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,n,i){return this.x=e*Math.sin(n),this.y=i,this.z=e*Math.cos(n),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(e){let n=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=n,this.y=i,this.z=r,this}setFromMatrixColumn(e,n){return this.fromArray(e.elements,n*4)}setFromMatrix3Column(e,n){return this.fromArray(e.elements,n*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(e),this.y=n,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};Lg.prototype.isVector3=!0;var N=Lg,_m=new N,Yx=new ji,Ng=class Ng{constructor(e,n,i,r,s,o,a,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c)}set(e,n,i,r,s,o,a,l,c){let f=this.elements;return f[0]=e,f[1]=r,f[2]=a,f[3]=n,f[4]=s,f[5]=l,f[6]=i,f[7]=o,f[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(e,n,i){return e.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let n=e.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[3],l=i[6],c=i[1],f=i[4],d=i[7],h=i[2],p=i[5],_=i[8],y=r[0],m=r[3],u=r[6],g=r[1],v=r[4],S=r[7],A=r[2],w=r[5],C=r[8];return s[0]=o*y+a*g+l*A,s[3]=o*m+a*v+l*w,s[6]=o*u+a*S+l*C,s[1]=c*y+f*g+d*A,s[4]=c*m+f*v+d*w,s[7]=c*u+f*S+d*C,s[2]=h*y+p*g+_*A,s[5]=h*m+p*v+_*w,s[8]=h*u+p*S+_*C,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[3]*=e,n[6]*=e,n[1]*=e,n[4]*=e,n[7]*=e,n[2]*=e,n[5]*=e,n[8]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],f=e[8];return n*o*f-n*a*c-i*s*f+i*a*l+r*s*c-r*o*l}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],f=e[8],d=f*o-a*c,h=a*l-f*s,p=c*s-o*l,_=n*d+i*h+r*p;if(_===0)return this.set(0,0,0,0,0,0,0,0,0);let y=1/_;return e[0]=d*y,e[1]=(r*c-f*i)*y,e[2]=(a*i-r*o)*y,e[3]=h*y,e[4]=(f*n-r*l)*y,e[5]=(r*s-a*n)*y,e[6]=p*y,e[7]=(i*l-c*n)*y,e[8]=(o*n-i*s)*y,this}transpose(){let e,n=this.elements;return e=n[1],n[1]=n[3],n[3]=e,e=n[2],n[2]=n[6],n[6]=e,e=n[5],n[5]=n[7],n[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let n=this.elements;return e[0]=n[0],e[1]=n[3],e[2]=n[6],e[3]=n[1],e[4]=n[4],e[5]=n[7],e[6]=n[2],e[7]=n[5],e[8]=n[8],this}setUvTransform(e,n,i,r,s,o,a){let l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*o+c*a)+o+e,-r*c,r*l,-r*(-c*o+l*a)+a+n,0,0,1),this}scale(e,n){return this.premultiply(vm.makeScale(e,n)),this}rotate(e){return this.premultiply(vm.makeRotation(-e)),this}translate(e,n){return this.premultiply(vm.makeTranslation(e,n)),this}makeTranslation(e,n){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,n,0,0,1),this}makeRotation(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(e,n){return this.set(e,0,0,0,n,0,0,0,1),this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<9;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<9;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}};Ng.prototype.isMatrix3=!0;var rt=Ng,vm=new rt,$x=new rt().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Zx=new rt().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Uw(){let t={enabled:!0,workingColorSpace:wl,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===Rt&&(r.r=Ar(r.r),r.g=Ar(r.g),r.b=Ar(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===Rt&&(r.r=Ko(r.r),r.g=Ko(r.g),r.b=Ko(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===Ir?El:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return Mh("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),t.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return Mh("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),t.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return t.define({[wl]:{primaries:e,whitePoint:i,transfer:El,toXYZ:$x,fromXYZ:Zx,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:Un},outputColorSpaceConfig:{drawingBufferColorSpace:Un}},[Un]:{primaries:e,whitePoint:i,transfer:Rt,toXYZ:$x,fromXYZ:Zx,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:Un}}}),t}var xt=Uw();function Ar(t){return t<.04045?t*.0773993808:Math.pow(t*.9478672986+.0521327014,2.4)}function Ko(t){return t<.0031308?t*12.92:1.055*Math.pow(t,.41666)-.055}var Oo,wh=class{static getDataURL(e,n="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{Oo===void 0&&(Oo=Tl("canvas")),Oo.width=e.width,Oo.height=e.height;let r=Oo.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=Oo}return i.toDataURL(n)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let n=Tl("canvas");n.width=e.width,n.height=e.height;let i=n.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=Ar(s[o]/255)*255;return i.putImageData(r,0,0),n}else if(e.data){let n=e.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor(Ar(n[i]/255)*255):n[i]=Ar(n[i]);return{data:n,width:e.width,height:e.height}}else return Ze("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},Fw=0,ea=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Fw++}),this.uuid=Qs(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?e.set(n.videoWidth,n.videoHeight,0):typeof VideoFrame<"u"&&n instanceof VideoFrame?e.set(n.displayWidth,n.displayHeight,0):n!==null?e.set(n.width,n.height,n.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(xm(r[o].image)):s.push(xm(r[o]))}else s=xm(r);i.url=s}return n||(e.images[this.uuid]=i),i}};function xm(t){return typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap?wh.getDataURL(t):t.data?{data:Array.from(t.data),width:t.width,height:t.height,type:t.data.constructor.name}:(Ze("Texture: Unable to serialize Texture."),{})}var Ow=0,ym=new N,On=class t extends Ji{constructor(e=t.DEFAULT_IMAGE,n=t.DEFAULT_MAPPING,i=Zi,r=Zi,s=_n,o=vs,a=vi,l=qn,c=t.DEFAULT_ANISOTROPY,f=Ir){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Ow++}),this.uuid=Qs(),this.name="",this.source=new ea(e),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Te(0,0),this.repeat=new Te(1,1),this.center=new Te(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new rt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=f,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(ym).x}get height(){return this.source.getSize(ym).y}get depth(){return this.source.getSize(ym).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let n in e){let i=e[n];if(i===void 0){Ze(`Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Ze(`Texture.setValues(): property '${n}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==mg)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case qs:e.x=e.x-Math.floor(e.x);break;case Zi:e.x=e.x<0?0:1;break;case yh:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case qs:e.y=e.y-Math.floor(e.y);break;case Zi:e.y=e.y<0?0:1;break;case yh:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};On.DEFAULT_IMAGE=null;On.DEFAULT_MAPPING=mg;On.DEFAULT_ANISOTROPY=1;var Dg=class Dg{constructor(e=0,n=0,i=0,r=1){this.x=e,this.y=n,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,n,i,r){return this.x=e,this.y=n,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this.w=e.w+n.w,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this.w+=e.w*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this.w=e.w-n.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*n+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*n+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*n+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*n+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let n=Math.sqrt(1-e.w*e.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/n,this.y=e.y/n,this.z=e.z/n),this}setAxisAngleFromRotationMatrix(e){let n,i,r,s,l=e.elements,c=l[0],f=l[4],d=l[8],h=l[1],p=l[5],_=l[9],y=l[2],m=l[6],u=l[10];if(Math.abs(f-h)<.01&&Math.abs(d-y)<.01&&Math.abs(_-m)<.01){if(Math.abs(f+h)<.1&&Math.abs(d+y)<.1&&Math.abs(_+m)<.1&&Math.abs(c+p+u-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let v=(c+1)/2,S=(p+1)/2,A=(u+1)/2,w=(f+h)/4,C=(d+y)/4,x=(_+m)/4;return v>S&&v>A?v<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(v),r=w/i,s=C/i):S>A?S<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(S),i=w/r,s=x/r):A<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(A),i=C/s,r=x/s),this.set(i,r,s,n),this}let g=Math.sqrt((m-_)*(m-_)+(d-y)*(d-y)+(h-f)*(h-f));return Math.abs(g)<.001&&(g=1),this.x=(m-_)/g,this.y=(d-y)/g,this.z=(h-f)/g,this.w=Math.acos((c+p+u-1)/2),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,n){return this.x=mt(this.x,e.x,n.x),this.y=mt(this.y,e.y,n.y),this.z=mt(this.z,e.z,n.z),this.w=mt(this.w,e.w,n.w),this}clampScalar(e,n){return this.x=mt(this.x,e,n),this.y=mt(this.y,e,n),this.z=mt(this.z,e,n),this.w=mt(this.w,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(mt(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this.w+=(e.w-this.w)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this.w=e.w+(n.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this.w=e[n+3],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e[n+3]=this.w,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this.w=e.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};Dg.prototype.isVector4=!0;var Yt=Dg,Eh=class extends Ji{constructor(e=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:_n,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=n,this.depth=i.depth,this.scissor=new Yt(0,0,e,n),this.scissorTest=!1,this.viewport=new Yt(0,0,e,n),this.textures=[];let r={width:e,height:n,depth:i.depth},s=new On(r),o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let n={minFilter:_n,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(n.mapping=e.mapping),e.wrapS!==void 0&&(n.wrapS=e.wrapS),e.wrapT!==void 0&&(n.wrapT=e.wrapT),e.wrapR!==void 0&&(n.wrapR=e.wrapR),e.magFilter!==void 0&&(n.magFilter=e.magFilter),e.minFilter!==void 0&&(n.minFilter=e.minFilter),e.format!==void 0&&(n.format=e.format),e.type!==void 0&&(n.type=e.type),e.anisotropy!==void 0&&(n.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(n.colorSpace=e.colorSpace),e.flipY!==void 0&&(n.flipY=e.flipY),e.generateMipmaps!==void 0&&(n.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(n.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,n,i=1){if(this.width!==e||this.height!==n||this.depth!==i){this.width=e,this.height=n,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=n,this.textures[r].image.depth=i,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,n),this.scissor.set(0,0,e,n)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++){this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let r=Object.assign({},e.textures[n].image);this.textures[n].source=new ea(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},ii=class extends Eh{constructor(e=1,n=1,i={}){super(e,n,i),this.isWebGLRenderTarget=!0}},bl=class extends On{constructor(e=null,n=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=fn,this.minFilter=fn,this.wrapR=Zi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var Th=class extends On{constructor(e=null,n=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=fn,this.minFilter=fn,this.wrapR=Zi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Zh=class Zh{constructor(e,n,i,r,s,o,a,l,c,f,d,h,p,_,y,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c,f,d,h,p,_,y,m)}set(e,n,i,r,s,o,a,l,c,f,d,h,p,_,y,m){let u=this.elements;return u[0]=e,u[4]=n,u[8]=i,u[12]=r,u[1]=s,u[5]=o,u[9]=a,u[13]=l,u[2]=c,u[6]=f,u[10]=d,u[14]=h,u[3]=p,u[7]=_,u[11]=y,u[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Zh().fromArray(this.elements)}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(e){let n=this.elements,i=e.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(e){let n=e.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(e,n,i){return this.determinant()===0?(e.set(1,0,0),n.set(0,1,0),i.set(0,0,1),this):(e.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(e,n,i){return this.set(e.x,n.x,i.x,0,e.y,n.y,i.y,0,e.z,n.z,i.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let n=this.elements,i=e.elements,r=1/Bo.setFromMatrixColumn(e,0).length(),s=1/Bo.setFromMatrixColumn(e,1).length(),o=1/Bo.setFromMatrixColumn(e,2).length();return n[0]=i[0]*r,n[1]=i[1]*r,n[2]=i[2]*r,n[3]=0,n[4]=i[4]*s,n[5]=i[5]*s,n[6]=i[6]*s,n[7]=0,n[8]=i[8]*o,n[9]=i[9]*o,n[10]=i[10]*o,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(e){let n=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),c=Math.sin(r),f=Math.cos(s),d=Math.sin(s);if(e.order==="XYZ"){let h=o*f,p=o*d,_=a*f,y=a*d;n[0]=l*f,n[4]=-l*d,n[8]=c,n[1]=p+_*c,n[5]=h-y*c,n[9]=-a*l,n[2]=y-h*c,n[6]=_+p*c,n[10]=o*l}else if(e.order==="YXZ"){let h=l*f,p=l*d,_=c*f,y=c*d;n[0]=h+y*a,n[4]=_*a-p,n[8]=o*c,n[1]=o*d,n[5]=o*f,n[9]=-a,n[2]=p*a-_,n[6]=y+h*a,n[10]=o*l}else if(e.order==="ZXY"){let h=l*f,p=l*d,_=c*f,y=c*d;n[0]=h-y*a,n[4]=-o*d,n[8]=_+p*a,n[1]=p+_*a,n[5]=o*f,n[9]=y-h*a,n[2]=-o*c,n[6]=a,n[10]=o*l}else if(e.order==="ZYX"){let h=o*f,p=o*d,_=a*f,y=a*d;n[0]=l*f,n[4]=_*c-p,n[8]=h*c+y,n[1]=l*d,n[5]=y*c+h,n[9]=p*c-_,n[2]=-c,n[6]=a*l,n[10]=o*l}else if(e.order==="YZX"){let h=o*l,p=o*c,_=a*l,y=a*c;n[0]=l*f,n[4]=y-h*d,n[8]=_*d+p,n[1]=d,n[5]=o*f,n[9]=-a*f,n[2]=-c*f,n[6]=p*d+_,n[10]=h-y*d}else if(e.order==="XZY"){let h=o*l,p=o*c,_=a*l,y=a*c;n[0]=l*f,n[4]=-d,n[8]=c*f,n[1]=h*d+y,n[5]=o*f,n[9]=p*d-_,n[2]=_*d-p,n[6]=a*f,n[10]=y*d+h}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Bw,e,kw)}lookAt(e,n,i){let r=this.elements;return ti.subVectors(e,n),ti.lengthSq()===0&&(ti.z=1),ti.normalize(),rs.crossVectors(i,ti),rs.lengthSq()===0&&(Math.abs(i.z)===1?ti.x+=1e-4:ti.z+=1e-4,ti.normalize(),rs.crossVectors(i,ti)),rs.normalize(),zu.crossVectors(ti,rs),r[0]=rs.x,r[4]=zu.x,r[8]=ti.x,r[1]=rs.y,r[5]=zu.y,r[9]=ti.y,r[2]=rs.z,r[6]=zu.z,r[10]=ti.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[4],l=i[8],c=i[12],f=i[1],d=i[5],h=i[9],p=i[13],_=i[2],y=i[6],m=i[10],u=i[14],g=i[3],v=i[7],S=i[11],A=i[15],w=r[0],C=r[4],x=r[8],b=r[12],I=r[1],P=r[5],F=r[9],W=r[13],q=r[2],U=r[6],k=r[10],z=r[14],ne=r[3],le=r[7],me=r[11],Ce=r[15];return s[0]=o*w+a*I+l*q+c*ne,s[4]=o*C+a*P+l*U+c*le,s[8]=o*x+a*F+l*k+c*me,s[12]=o*b+a*W+l*z+c*Ce,s[1]=f*w+d*I+h*q+p*ne,s[5]=f*C+d*P+h*U+p*le,s[9]=f*x+d*F+h*k+p*me,s[13]=f*b+d*W+h*z+p*Ce,s[2]=_*w+y*I+m*q+u*ne,s[6]=_*C+y*P+m*U+u*le,s[10]=_*x+y*F+m*k+u*me,s[14]=_*b+y*W+m*z+u*Ce,s[3]=g*w+v*I+S*q+A*ne,s[7]=g*C+v*P+S*U+A*le,s[11]=g*x+v*F+S*k+A*me,s[15]=g*b+v*W+S*z+A*Ce,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[4]*=e,n[8]*=e,n[12]*=e,n[1]*=e,n[5]*=e,n[9]*=e,n[13]*=e,n[2]*=e,n[6]*=e,n[10]*=e,n[14]*=e,n[3]*=e,n[7]*=e,n[11]*=e,n[15]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],c=e[13],f=e[2],d=e[6],h=e[10],p=e[14],_=e[3],y=e[7],m=e[11],u=e[15],g=l*p-c*h,v=a*p-c*d,S=a*h-l*d,A=o*p-c*f,w=o*h-l*f,C=o*d-a*f;return n*(y*g-m*v+u*S)-i*(_*g-m*A+u*w)+r*(_*v-y*A+u*C)-s*(_*S-y*w+m*C)}transpose(){let e=this.elements,n;return n=e[1],e[1]=e[4],e[4]=n,n=e[2],e[2]=e[8],e[8]=n,n=e[6],e[6]=e[9],e[9]=n,n=e[3],e[3]=e[12],e[12]=n,n=e[7],e[7]=e[13],e[13]=n,n=e[11],e[11]=e[14],e[14]=n,this}setPosition(e,n,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=n,r[14]=i),this}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],f=e[8],d=e[9],h=e[10],p=e[11],_=e[12],y=e[13],m=e[14],u=e[15],g=n*a-i*o,v=n*l-r*o,S=n*c-s*o,A=i*l-r*a,w=i*c-s*a,C=r*c-s*l,x=f*y-d*_,b=f*m-h*_,I=f*u-p*_,P=d*m-h*y,F=d*u-p*y,W=h*u-p*m,q=g*W-v*F+S*P+A*I-w*b+C*x;if(q===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let U=1/q;return e[0]=(a*W-l*F+c*P)*U,e[1]=(r*F-i*W-s*P)*U,e[2]=(y*C-m*w+u*A)*U,e[3]=(h*w-d*C-p*A)*U,e[4]=(l*I-o*W-c*b)*U,e[5]=(n*W-r*I+s*b)*U,e[6]=(m*S-_*C-u*v)*U,e[7]=(f*C-h*S+p*v)*U,e[8]=(o*F-a*I+c*x)*U,e[9]=(i*I-n*F-s*x)*U,e[10]=(_*w-y*S+u*g)*U,e[11]=(d*S-f*w-p*g)*U,e[12]=(a*b-o*P-l*x)*U,e[13]=(n*P-i*b+r*x)*U,e[14]=(y*v-_*A-m*g)*U,e[15]=(f*A-d*v+h*g)*U,this}scale(e){let n=this.elements,i=e.x,r=e.y,s=e.z;return n[0]*=i,n[4]*=r,n[8]*=s,n[1]*=i,n[5]*=r,n[9]*=s,n[2]*=i,n[6]*=r,n[10]*=s,n[3]*=i,n[7]*=r,n[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,n=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(n,i,r))}makeTranslation(e,n,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(e){let n=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,n){let i=Math.cos(n),r=Math.sin(n),s=1-i,o=e.x,a=e.y,l=e.z,c=s*o,f=s*a;return this.set(c*o+i,c*a-r*l,c*l+r*a,0,c*a+r*l,f*a+i,f*l-r*o,0,c*l-r*a,f*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,n,i){return this.set(e,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,n,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,n,r,1,0,0,0,0,1),this}compose(e,n,i){let r=this.elements,s=n._x,o=n._y,a=n._z,l=n._w,c=s+s,f=o+o,d=a+a,h=s*c,p=s*f,_=s*d,y=o*f,m=o*d,u=a*d,g=l*c,v=l*f,S=l*d,A=i.x,w=i.y,C=i.z;return r[0]=(1-(y+u))*A,r[1]=(p+S)*A,r[2]=(_-v)*A,r[3]=0,r[4]=(p-S)*w,r[5]=(1-(h+u))*w,r[6]=(m+g)*w,r[7]=0,r[8]=(_+v)*C,r[9]=(m-g)*C,r[10]=(1-(h+y))*C,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,n,i){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinant();if(s===0)return i.set(1,1,1),n.identity(),this;let o=Bo.set(r[0],r[1],r[2]).length(),a=Bo.set(r[4],r[5],r[6]).length(),l=Bo.set(r[8],r[9],r[10]).length();s<0&&(o=-o),Ci.copy(this);let c=1/o,f=1/a,d=1/l;return Ci.elements[0]*=c,Ci.elements[1]*=c,Ci.elements[2]*=c,Ci.elements[4]*=f,Ci.elements[5]*=f,Ci.elements[6]*=f,Ci.elements[8]*=d,Ci.elements[9]*=d,Ci.elements[10]*=d,n.setFromRotationMatrix(Ci),i.x=o,i.y=a,i.z=l,this}makePerspective(e,n,i,r,s,o,a=Ii,l=!1){let c=this.elements,f=2*s/(n-e),d=2*s/(i-r),h=(n+e)/(n-e),p=(i+r)/(i-r),_,y;if(l)_=s/(o-s),y=o*s/(o-s);else if(a===Ii)_=-(o+s)/(o-s),y=-2*o*s/(o-s);else if(a===Jo)_=-o/(o-s),y=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=f,c[4]=0,c[8]=h,c[12]=0,c[1]=0,c[5]=d,c[9]=p,c[13]=0,c[2]=0,c[6]=0,c[10]=_,c[14]=y,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,n,i,r,s,o,a=Ii,l=!1){let c=this.elements,f=2/(n-e),d=2/(i-r),h=-(n+e)/(n-e),p=-(i+r)/(i-r),_,y;if(l)_=1/(o-s),y=o/(o-s);else if(a===Ii)_=-2/(o-s),y=-(o+s)/(o-s);else if(a===Jo)_=-1/(o-s),y=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=f,c[4]=0,c[8]=0,c[12]=h,c[1]=0,c[5]=d,c[9]=0,c[13]=p,c[2]=0,c[6]=0,c[10]=_,c[14]=y,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<16;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<16;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e[n+9]=i[9],e[n+10]=i[10],e[n+11]=i[11],e[n+12]=i[12],e[n+13]=i[13],e[n+14]=i[14],e[n+15]=i[15],e}};Zh.prototype.isMatrix4=!0;var At=Zh,Bo=new N,Ci=new At,Bw=new N(0,0,0),kw=new N(1,1,1),rs=new N,zu=new N,ti=new N,Kx=new At,Jx=new ji,Li=class t{constructor(e=0,n=0,i=0,r=t.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=n,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,n,i,r=this._order){return this._x=e,this._y=n,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,n=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],f=r[9],d=r[2],h=r[6],p=r[10];switch(n){case"XYZ":this._y=Math.asin(mt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-f,p),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(h,c),this._z=0);break;case"YXZ":this._x=Math.asin(-mt(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(mt(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-d,p),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-mt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(h,p),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(mt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-f,c),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-mt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(h,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-f,p),this._y=0);break;default:Ze("Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,n,i){return Kx.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Kx,n,i)}setFromVector3(e,n=this._order){return this.set(e.x,e.y,e.z,n)}reorder(e){return Jx.setFromEuler(this),this.setFromQuaternion(Jx,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Li.DEFAULT_ORDER="XYZ";var ta=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},zw=0,jx=new N,ko=new ji,Mr=new At,Vu=new N,dl=new N,Vw=new N,Hw=new ji,Qx=new N(1,0,0),ey=new N(0,1,0),ty=new N(0,0,1),ny={type:"added"},Gw={type:"removed"},zo={type:"childadded",child:null},Sm={type:"childremoved",child:null},rn=class t extends Ji{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:zw++}),this.uuid=Qs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=t.DEFAULT_UP.clone();let e=new N,n=new Li,i=new ji,r=new N(1,1,1);function s(){i.setFromEuler(n,!1)}function o(){n.setFromQuaternion(i,void 0,!1)}n._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new At},normalMatrix:{value:new rt}}),this.matrix=new At,this.matrixWorld=new At,this.matrixAutoUpdate=t.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ta,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,n){this.quaternion.setFromAxisAngle(e,n)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,n){return ko.setFromAxisAngle(e,n),this.quaternion.multiply(ko),this}rotateOnWorldAxis(e,n){return ko.setFromAxisAngle(e,n),this.quaternion.premultiply(ko),this}rotateX(e){return this.rotateOnAxis(Qx,e)}rotateY(e){return this.rotateOnAxis(ey,e)}rotateZ(e){return this.rotateOnAxis(ty,e)}translateOnAxis(e,n){return jx.copy(e).applyQuaternion(this.quaternion),this.position.add(jx.multiplyScalar(n)),this}translateX(e){return this.translateOnAxis(Qx,e)}translateY(e){return this.translateOnAxis(ey,e)}translateZ(e){return this.translateOnAxis(ty,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Mr.copy(this.matrixWorld).invert())}lookAt(e,n,i){e.isVector3?Vu.copy(e):Vu.set(e,n,i);let r=this.parent;this.updateWorldMatrix(!0,!1),dl.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Mr.lookAt(dl,Vu,this.up):Mr.lookAt(Vu,dl,this.up),this.quaternion.setFromRotationMatrix(Mr),r&&(Mr.extractRotation(r.matrixWorld),ko.setFromRotationMatrix(Mr),this.quaternion.premultiply(ko.invert()))}add(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return e===this?(Je("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(ny),zo.child=e,this.dispatchEvent(zo),zo.child=null):Je("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(e);return n!==-1&&(e.parent=null,this.children.splice(n,1),e.dispatchEvent(Gw),Sm.child=e,this.dispatchEvent(Sm),Sm.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Mr.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Mr.multiply(e.parent.matrixWorld)),e.applyMatrix4(Mr),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(ny),zo.child=e,this.dispatchEvent(zo),zo.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,n){if(this[e]===n)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,n);if(o!==void 0)return o}}getObjectsByProperty(e,n,i=[]){this[e]===n&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,n,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(dl,e,Vw),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(dl,Hw,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return e.set(n[8],n[9],n[10]).normalize()}raycast(){}traverse(e){e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverseVisible(e)}traverseAncestors(e){let n=this.parent;n!==null&&(e(n),n.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let n=e.x,i=e.y,r=e.z,s=this.matrix.elements;s[12]+=n-s[0]*n-s[4]*i-s[8]*r,s[13]+=i-s[1]*n-s[5]*i-s[9]*r,s[14]+=r-s[2]*n-s[6]*i-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].updateMatrixWorld(e)}updateWorldMatrix(e,n){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),n===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let n=e===void 0||typeof e=="string",i={};n&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,f=l.length;c<f;c++){let d=l[c];s(e.shapes,d)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(n){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),f=o(e.images),d=o(e.shapes),h=o(e.skeletons),p=o(e.animations),_=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),f.length>0&&(i.images=f),d.length>0&&(i.shapes=d),h.length>0&&(i.skeletons=h),p.length>0&&(i.animations=p),_.length>0&&(i.nodes=_)}return i.object=r,i;function o(a){let l=[];for(let c in a){let f=a[c];delete f.metadata,l.push(f)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,n=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),n===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};rn.DEFAULT_UP=new N(0,1,0);rn.DEFAULT_MATRIX_AUTO_UPDATE=!0;rn.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var hn=class extends rn{constructor(){super(),this.isGroup=!0,this.type="Group"}},Ww={type:"move"},na=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new hn,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new hn,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new N,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new N),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new hn,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new N,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new N,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let n=this._hand;if(n)for(let i of e.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,n,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&n.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let y of e.hand.values()){let m=n.getJointPose(y,i),u=this._getHandJoint(c,y);m!==null&&(u.matrix.fromArray(m.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=m.radius),u.visible=m!==null}let f=c.joints["index-finger-tip"],d=c.joints["thumb-tip"],h=f.position.distanceTo(d.position),p=.02,_=.005;c.inputState.pinching&&h>p+_?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&h<=p-_&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=n.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));a!==null&&(r=n.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(Ww)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,n){if(e.joints[n.jointName]===void 0){let i=new hn;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[n.jointName]=i,e.add(i)}return e.joints[n.jointName]}},iS={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},ss={h:0,s:0,l:0},Hu={h:0,s:0,l:0};function Mm(t,e,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?t+(e-t)*6*n:n<1/2?e:n<2/3?t+(e-t)*6*(2/3-n):t}var ft=class{constructor(e,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,n,i)}set(e,n,i){if(n===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,n,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,n=Un){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,xt.colorSpaceToWorking(this,n),this}setRGB(e,n,i,r=xt.workingColorSpace){return this.r=e,this.g=n,this.b=i,xt.colorSpaceToWorking(this,r),this}setHSL(e,n,i,r=xt.workingColorSpace){if(e=Tg(e,1),n=mt(n,0,1),i=mt(i,0,1),n===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+n):i+n-i*n,o=2*i-s;this.r=Mm(o,s,e+1/3),this.g=Mm(o,s,e),this.b=Mm(o,s,e-1/3)}return xt.colorSpaceToWorking(this,r),this}setStyle(e,n=Un){function i(s){s!==void 0&&parseFloat(s)<1&&Ze("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,n);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,n);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,n);break;default:Ze("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,n);if(o===6)return this.setHex(parseInt(s,16),n);Ze("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,n);return this}setColorName(e,n=Un){let i=iS[e.toLowerCase()];return i!==void 0?this.setHex(i,n):Ze("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Ar(e.r),this.g=Ar(e.g),this.b=Ar(e.b),this}copyLinearToSRGB(e){return this.r=Ko(e.r),this.g=Ko(e.g),this.b=Ko(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Un){return xt.workingToColorSpace(Tn.copy(this),e),Math.round(mt(Tn.r*255,0,255))*65536+Math.round(mt(Tn.g*255,0,255))*256+Math.round(mt(Tn.b*255,0,255))}getHexString(e=Un){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,n=xt.workingColorSpace){xt.workingToColorSpace(Tn.copy(this),n);let i=Tn.r,r=Tn.g,s=Tn.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,c,f=(a+o)/2;if(a===o)l=0,c=0;else{let d=o-a;switch(c=f<=.5?d/(o+a):d/(2-o-a),o){case i:l=(r-s)/d+(r<s?6:0);break;case r:l=(s-i)/d+2;break;case s:l=(i-r)/d+4;break}l/=6}return e.h=l,e.s=c,e.l=f,e}getRGB(e,n=xt.workingColorSpace){return xt.workingToColorSpace(Tn.copy(this),n),e.r=Tn.r,e.g=Tn.g,e.b=Tn.b,e}getStyle(e=Un){xt.workingToColorSpace(Tn.copy(this),e);let n=Tn.r,i=Tn.g,r=Tn.b;return e!==Un?`color(${e} ${n.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,n,i){return this.getHSL(ss),this.setHSL(ss.h+e,ss.s+n,ss.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,n){return this.r=e.r+n.r,this.g=e.g+n.g,this.b=e.b+n.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,n){return this.r+=(e.r-this.r)*n,this.g+=(e.g-this.g)*n,this.b+=(e.b-this.b)*n,this}lerpColors(e,n,i){return this.r=e.r+(n.r-e.r)*i,this.g=e.g+(n.g-e.g)*i,this.b=e.b+(n.b-e.b)*i,this}lerpHSL(e,n){this.getHSL(ss),e.getHSL(Hu);let i=xl(ss.h,Hu.h,n),r=xl(ss.s,Hu.s,n),s=xl(ss.l,Hu.l,n);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let n=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*n+s[3]*i+s[6]*r,this.g=s[1]*n+s[4]*i+s[7]*r,this.b=s[2]*n+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,n=0){return this.r=e[n],this.g=e[n+1],this.b=e[n+2],this}toArray(e=[],n=0){return e[n]=this.r,e[n+1]=this.g,e[n+2]=this.b,e}fromBufferAttribute(e,n){return this.r=e.getX(n),this.g=e.getY(n),this.b=e.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Tn=new ft;ft.NAMES=iS;var Al=class t{constructor(e,n=1,i=1e3){this.isFog=!0,this.name="",this.color=new ft(e),this.near=n,this.far=i}clone(){return new t(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}},Cl=class extends rn{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Li,this.environmentIntensity=1,this.environmentRotation=new Li,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,n){return super.copy(e,n),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let n=super.toJSON(e);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(n.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(n.object.backgroundIntensity=this.backgroundIntensity),n.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(n.object.environmentIntensity=this.environmentIntensity),n.object.environmentRotation=this.environmentRotation.toArray(),n}},Ri=new N,wr=new N,wm=new N,Er=new N,Vo=new N,Ho=new N,iy=new N,Em=new N,Tm=new N,bm=new N,Am=new Yt,Cm=new Yt,Rm=new Yt,us=class t{constructor(e=new N,n=new N,i=new N){this.a=e,this.b=n,this.c=i}static getNormal(e,n,i,r){r.subVectors(i,n),Ri.subVectors(e,n),r.cross(Ri);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,n,i,r,s){Ri.subVectors(r,n),wr.subVectors(i,n),wm.subVectors(e,n);let o=Ri.dot(Ri),a=Ri.dot(wr),l=Ri.dot(wm),c=wr.dot(wr),f=wr.dot(wm),d=o*c-a*a;if(d===0)return s.set(0,0,0),null;let h=1/d,p=(c*l-a*f)*h,_=(o*f-a*l)*h;return s.set(1-p-_,_,p)}static containsPoint(e,n,i,r){return this.getBarycoord(e,n,i,r,Er)===null?!1:Er.x>=0&&Er.y>=0&&Er.x+Er.y<=1}static getInterpolation(e,n,i,r,s,o,a,l){return this.getBarycoord(e,n,i,r,Er)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Er.x),l.addScaledVector(o,Er.y),l.addScaledVector(a,Er.z),l)}static getInterpolatedAttribute(e,n,i,r,s,o){return Am.setScalar(0),Cm.setScalar(0),Rm.setScalar(0),Am.fromBufferAttribute(e,n),Cm.fromBufferAttribute(e,i),Rm.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(Am,s.x),o.addScaledVector(Cm,s.y),o.addScaledVector(Rm,s.z),o}static isFrontFacing(e,n,i,r){return Ri.subVectors(i,n),wr.subVectors(e,n),Ri.cross(wr).dot(r)<0}set(e,n,i){return this.a.copy(e),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(e,n,i,r){return this.a.copy(e[n]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,n,i,r){return this.a.fromBufferAttribute(e,n),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Ri.subVectors(this.c,this.b),wr.subVectors(this.a,this.b),Ri.cross(wr).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return t.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,n){return t.getBarycoord(e,this.a,this.b,this.c,n)}getInterpolation(e,n,i,r,s){return t.getInterpolation(e,this.a,this.b,this.c,n,i,r,s)}containsPoint(e){return t.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return t.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,n){let i=this.a,r=this.b,s=this.c,o,a;Vo.subVectors(r,i),Ho.subVectors(s,i),Em.subVectors(e,i);let l=Vo.dot(Em),c=Ho.dot(Em);if(l<=0&&c<=0)return n.copy(i);Tm.subVectors(e,r);let f=Vo.dot(Tm),d=Ho.dot(Tm);if(f>=0&&d<=f)return n.copy(r);let h=l*d-f*c;if(h<=0&&l>=0&&f<=0)return o=l/(l-f),n.copy(i).addScaledVector(Vo,o);bm.subVectors(e,s);let p=Vo.dot(bm),_=Ho.dot(bm);if(_>=0&&p<=_)return n.copy(s);let y=p*c-l*_;if(y<=0&&c>=0&&_<=0)return a=c/(c-_),n.copy(i).addScaledVector(Ho,a);let m=f*_-p*d;if(m<=0&&d-f>=0&&p-_>=0)return iy.subVectors(s,r),a=(d-f)/(d-f+(p-_)),n.copy(r).addScaledVector(iy,a);let u=1/(m+y+h);return o=y*u,a=h*u,n.copy(i).addScaledVector(Vo,o).addScaledVector(Ho,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},fs=class{constructor(e=new N(1/0,1/0,1/0),n=new N(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=n}set(e,n){return this.min.copy(e),this.max.copy(n),this}setFromArray(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n+=3)this.expandByPoint(Pi.fromArray(e,n));return this}setFromBufferAttribute(e){this.makeEmpty();for(let n=0,i=e.count;n<i;n++)this.expandByPoint(Pi.fromBufferAttribute(e,n));return this}setFromPoints(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n++)this.expandByPoint(e[n]);return this}setFromCenterAndSize(e,n){let i=Pi.copy(n).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,n=!1){return this.makeEmpty(),this.expandByObject(e,n)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,n=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(n===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,Pi):Pi.fromBufferAttribute(s,o),Pi.applyMatrix4(e.matrixWorld),this.expandByPoint(Pi);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Gu.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Gu.copy(i.boundingBox)),Gu.applyMatrix4(e.matrixWorld),this.union(Gu)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],n);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,n){return n.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,Pi),Pi.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let n,i;return e.normal.x>0?(n=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(n=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(n+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(n+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(n+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(n+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),n<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(pl),Wu.subVectors(this.max,pl),Go.subVectors(e.a,pl),Wo.subVectors(e.b,pl),Xo.subVectors(e.c,pl),os.subVectors(Wo,Go),as.subVectors(Xo,Wo),Bs.subVectors(Go,Xo);let n=[0,-os.z,os.y,0,-as.z,as.y,0,-Bs.z,Bs.y,os.z,0,-os.x,as.z,0,-as.x,Bs.z,0,-Bs.x,-os.y,os.x,0,-as.y,as.x,0,-Bs.y,Bs.x,0];return!Pm(n,Go,Wo,Xo,Wu)||(n=[1,0,0,0,1,0,0,0,1],!Pm(n,Go,Wo,Xo,Wu))?!1:(Xu.crossVectors(os,as),n=[Xu.x,Xu.y,Xu.z],Pm(n,Go,Wo,Xo,Wu))}clampPoint(e,n){return n.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Pi).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Pi).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Tr[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Tr[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Tr[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Tr[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Tr[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Tr[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Tr[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Tr[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Tr),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Tr=[new N,new N,new N,new N,new N,new N,new N,new N],Pi=new N,Gu=new fs,Go=new N,Wo=new N,Xo=new N,os=new N,as=new N,Bs=new N,pl=new N,Wu=new N,Xu=new N,ks=new N;function Pm(t,e,n,i,r){for(let s=0,o=t.length-3;s<=o;s+=3){ks.fromArray(t,s);let a=r.x*Math.abs(ks.x)+r.y*Math.abs(ks.y)+r.z*Math.abs(ks.z),l=e.dot(ks),c=n.dot(ks),f=i.dot(ks);if(Math.max(-Math.max(l,c,f),Math.min(l,c,f))>a)return!1}return!0}var Qt=new N,qu=new Te,Xw=0,Fn=class extends Ji{constructor(e,n,i=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Xw++}),this.name="",this.array=e,this.itemSize=n,this.count=e!==void 0?e.length/n:0,this.normalized=i,this.usage=Ym,this.updateRanges=[],this.gpuType=Ui,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,n,i){e*=this.itemSize,i*=n.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=n.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)qu.fromBufferAttribute(this,n),qu.applyMatrix3(e),this.setXY(n,qu.x,qu.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)Qt.fromBufferAttribute(this,n),Qt.applyMatrix3(e),this.setXYZ(n,Qt.x,Qt.y,Qt.z);return this}applyMatrix4(e){for(let n=0,i=this.count;n<i;n++)Qt.fromBufferAttribute(this,n),Qt.applyMatrix4(e),this.setXYZ(n,Qt.x,Qt.y,Qt.z);return this}applyNormalMatrix(e){for(let n=0,i=this.count;n<i;n++)Qt.fromBufferAttribute(this,n),Qt.applyNormalMatrix(e),this.setXYZ(n,Qt.x,Qt.y,Qt.z);return this}transformDirection(e){for(let n=0,i=this.count;n<i;n++)Qt.fromBufferAttribute(this,n),Qt.transformDirection(e),this.setXYZ(n,Qt.x,Qt.y,Qt.z);return this}set(e,n=0){return this.array.set(e,n),this}getComponent(e,n){let i=this.array[e*this.itemSize+n];return this.normalized&&(i=Zo(i,this.array)),i}setComponent(e,n,i){return this.normalized&&(i=Dn(i,this.array)),this.array[e*this.itemSize+n]=i,this}getX(e){let n=this.array[e*this.itemSize];return this.normalized&&(n=Zo(n,this.array)),n}setX(e,n){return this.normalized&&(n=Dn(n,this.array)),this.array[e*this.itemSize]=n,this}getY(e){let n=this.array[e*this.itemSize+1];return this.normalized&&(n=Zo(n,this.array)),n}setY(e,n){return this.normalized&&(n=Dn(n,this.array)),this.array[e*this.itemSize+1]=n,this}getZ(e){let n=this.array[e*this.itemSize+2];return this.normalized&&(n=Zo(n,this.array)),n}setZ(e,n){return this.normalized&&(n=Dn(n,this.array)),this.array[e*this.itemSize+2]=n,this}getW(e){let n=this.array[e*this.itemSize+3];return this.normalized&&(n=Zo(n,this.array)),n}setW(e,n){return this.normalized&&(n=Dn(n,this.array)),this.array[e*this.itemSize+3]=n,this}setXY(e,n,i){return e*=this.itemSize,this.normalized&&(n=Dn(n,this.array),i=Dn(i,this.array)),this.array[e+0]=n,this.array[e+1]=i,this}setXYZ(e,n,i,r){return e*=this.itemSize,this.normalized&&(n=Dn(n,this.array),i=Dn(i,this.array),r=Dn(r,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,n,i,r,s){return e*=this.itemSize,this.normalized&&(n=Dn(n,this.array),i=Dn(i,this.array),r=Dn(r,this.array),s=Dn(s,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Ym&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var Rl=class extends Fn{constructor(e,n,i){super(new Uint16Array(e),n,i)}};var Pl=class extends Fn{constructor(e,n,i){super(new Uint32Array(e),n,i)}};var St=class extends Fn{constructor(e,n,i){super(new Float32Array(e),n,i)}},qw=new fs,ml=new N,Im=new N,Ys=class{constructor(e=new N,n=-1){this.isSphere=!0,this.center=e,this.radius=n}set(e,n){return this.center.copy(e),this.radius=n,this}setFromPoints(e,n){let i=this.center;n!==void 0?i.copy(n):qw.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let n=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=n*n}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,n){let i=this.center.distanceToSquared(e);return n.copy(e),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;ml.subVectors(e,this.center);let n=ml.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),r=(i-this.radius)*.5;this.center.addScaledVector(ml,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Im.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(ml.copy(e.center).add(Im)),this.expandByPoint(ml.copy(e.center).sub(Im))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},Yw=0,_i=new At,Lm=new rn,qo=new N,ni=new fs,gl=new fs,un=new N,Zt=class t extends Ji{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Yw++}),this.uuid=Qs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(_w(e)?Pl:Rl)(e,1):this.index=e,this}setIndirect(e,n=0){return this.indirect=e,this.indirectOffset=n,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,n){return this.attributes[e]=n,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,n,i=0){this.groups.push({start:e,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,n){this.drawRange.start=e,this.drawRange.count=n}applyMatrix4(e){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(e),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new rt().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return _i.makeRotationFromQuaternion(e),this.applyMatrix4(_i),this}rotateX(e){return _i.makeRotationX(e),this.applyMatrix4(_i),this}rotateY(e){return _i.makeRotationY(e),this.applyMatrix4(_i),this}rotateZ(e){return _i.makeRotationZ(e),this.applyMatrix4(_i),this}translate(e,n,i){return _i.makeTranslation(e,n,i),this.applyMatrix4(_i),this}scale(e,n,i){return _i.makeScale(e,n,i),this.applyMatrix4(_i),this}lookAt(e){return Lm.lookAt(e),Lm.updateMatrix(),this.applyMatrix4(Lm.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(qo).negate(),this.translate(qo.x,qo.y,qo.z),this}setFromPoints(e){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new St(i,3))}else{let i=Math.min(e.length,n.count);for(let r=0;r<i;r++){let s=e[r];n.setXYZ(r,s.x,s.y,s.z||0)}e.length>n.count&&Ze("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new fs);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Je("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new N(-1/0,-1/0,-1/0),new N(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),n)for(let i=0,r=n.length;i<r;i++){let s=n[i];ni.setFromBufferAttribute(s),this.morphTargetsRelative?(un.addVectors(this.boundingBox.min,ni.min),this.boundingBox.expandByPoint(un),un.addVectors(this.boundingBox.max,ni.max),this.boundingBox.expandByPoint(un)):(this.boundingBox.expandByPoint(ni.min),this.boundingBox.expandByPoint(ni.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Je('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Ys);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Je("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new N,1/0);return}if(e){let i=this.boundingSphere.center;if(ni.setFromBufferAttribute(e),n)for(let s=0,o=n.length;s<o;s++){let a=n[s];gl.setFromBufferAttribute(a),this.morphTargetsRelative?(un.addVectors(ni.min,gl.min),ni.expandByPoint(un),un.addVectors(ni.max,gl.max),ni.expandByPoint(un)):(ni.expandByPoint(gl.min),ni.expandByPoint(gl.max))}ni.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)un.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(un));if(n)for(let s=0,o=n.length;s<o;s++){let a=n[s],l=this.morphTargetsRelative;for(let c=0,f=a.count;c<f;c++)un.fromBufferAttribute(a,c),l&&(qo.fromBufferAttribute(e,c),un.add(qo)),r=Math.max(r,i.distanceToSquared(un))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&Je('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,n=this.attributes;if(e===null||n.position===void 0||n.normal===void 0||n.uv===void 0){Je("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,r=n.normal,s=n.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Fn(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let x=0;x<i.count;x++)a[x]=new N,l[x]=new N;let c=new N,f=new N,d=new N,h=new Te,p=new Te,_=new Te,y=new N,m=new N;function u(x,b,I){c.fromBufferAttribute(i,x),f.fromBufferAttribute(i,b),d.fromBufferAttribute(i,I),h.fromBufferAttribute(s,x),p.fromBufferAttribute(s,b),_.fromBufferAttribute(s,I),f.sub(c),d.sub(c),p.sub(h),_.sub(h);let P=1/(p.x*_.y-_.x*p.y);isFinite(P)&&(y.copy(f).multiplyScalar(_.y).addScaledVector(d,-p.y).multiplyScalar(P),m.copy(d).multiplyScalar(p.x).addScaledVector(f,-_.x).multiplyScalar(P),a[x].add(y),a[b].add(y),a[I].add(y),l[x].add(m),l[b].add(m),l[I].add(m))}let g=this.groups;g.length===0&&(g=[{start:0,count:e.count}]);for(let x=0,b=g.length;x<b;++x){let I=g[x],P=I.start,F=I.count;for(let W=P,q=P+F;W<q;W+=3)u(e.getX(W+0),e.getX(W+1),e.getX(W+2))}let v=new N,S=new N,A=new N,w=new N;function C(x){A.fromBufferAttribute(r,x),w.copy(A);let b=a[x];v.copy(b),v.sub(A.multiplyScalar(A.dot(b))).normalize(),S.crossVectors(w,b);let P=S.dot(l[x])<0?-1:1;o.setXYZW(x,v.x,v.y,v.z,P)}for(let x=0,b=g.length;x<b;++x){let I=g[x],P=I.start,F=I.count;for(let W=P,q=P+F;W<q;W+=3)C(e.getX(W+0)),C(e.getX(W+1)),C(e.getX(W+2))}}computeVertexNormals(){let e=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Fn(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let h=0,p=i.count;h<p;h++)i.setXYZ(h,0,0,0);let r=new N,s=new N,o=new N,a=new N,l=new N,c=new N,f=new N,d=new N;if(e)for(let h=0,p=e.count;h<p;h+=3){let _=e.getX(h+0),y=e.getX(h+1),m=e.getX(h+2);r.fromBufferAttribute(n,_),s.fromBufferAttribute(n,y),o.fromBufferAttribute(n,m),f.subVectors(o,s),d.subVectors(r,s),f.cross(d),a.fromBufferAttribute(i,_),l.fromBufferAttribute(i,y),c.fromBufferAttribute(i,m),a.add(f),l.add(f),c.add(f),i.setXYZ(_,a.x,a.y,a.z),i.setXYZ(y,l.x,l.y,l.z),i.setXYZ(m,c.x,c.y,c.z)}else for(let h=0,p=n.count;h<p;h+=3)r.fromBufferAttribute(n,h+0),s.fromBufferAttribute(n,h+1),o.fromBufferAttribute(n,h+2),f.subVectors(o,s),d.subVectors(r,s),f.cross(d),i.setXYZ(h+0,f.x,f.y,f.z),i.setXYZ(h+1,f.x,f.y,f.z),i.setXYZ(h+2,f.x,f.y,f.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let n=0,i=e.count;n<i;n++)un.fromBufferAttribute(e,n),un.normalize(),e.setXYZ(n,un.x,un.y,un.z)}toNonIndexed(){function e(a,l){let c=a.array,f=a.itemSize,d=a.normalized,h=new c.constructor(l.length*f),p=0,_=0;for(let y=0,m=l.length;y<m;y++){a.isInterleavedBufferAttribute?p=l[y]*a.data.stride+a.offset:p=l[y]*f;for(let u=0;u<f;u++)h[_++]=c[p++]}return new Fn(h,f,d)}if(this.index===null)return Ze("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new t,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],c=e(l,i);n.setAttribute(a,c)}let s=this.morphAttributes;for(let a in s){let l=[],c=s[a];for(let f=0,d=c.length;f<d;f++){let h=c[f],p=e(h,i);l.push(p)}n.morphAttributes[a]=l}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let n=this.index;n!==null&&(e.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];e.data.attributes[l]=c.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],f=[];for(let d=0,h=c.length;d<h;d++){let p=c[d];f.push(p.toJSON(e.data))}f.length>0&&(r[l]=f,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let c in r){let f=r[c];this.setAttribute(c,f.clone(n))}let s=e.morphAttributes;for(let c in s){let f=[],d=s[c];for(let h=0,p=d.length;h<p;h++)f.push(d[h].clone(n));this.morphAttributes[c]=f}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,f=o.length;c<f;c++){let d=o[c];this.addGroup(d.start,d.count,d.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var $w=0,Rr=class extends Ji{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:$w++}),this.uuid=Qs(),this.name="",this.type="Material",this.blending=Ws,this.side=Cr,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=hh,this.blendDst=fh,this.blendEquation=hs,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new ft(0,0,0),this.blendAlpha=0,this.depthFunc=Xs,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=qm,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Hs,this.stencilZFail=Hs,this.stencilZPass=Hs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let n in e){let i=e[n];if(i===void 0){Ze(`Material: parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Ze(`Material: '${n}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";n&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==Ws&&(i.blending=this.blending),this.side!==Cr&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==hh&&(i.blendSrc=this.blendSrc),this.blendDst!==fh&&(i.blendDst=this.blendDst),this.blendEquation!==hs&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==Xs&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==qm&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Hs&&(i.stencilFail=this.stencilFail),this.stencilZFail!==Hs&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==Hs&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(n){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let n=e.clippingPlanes,i=null;if(n!==null){let r=n.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=n[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var br=new N,Nm=new N,Yu=new N,ls=new N,Dm=new N,$u=new N,Um=new N,ia=class{constructor(e=new N,n=new N(0,0,-1)){this.origin=e,this.direction=n}set(e,n){return this.origin.copy(e),this.direction.copy(n),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,n){return n.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,br)),this}closestPointToPoint(e,n){n.subVectors(e,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let n=br.subVectors(e,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(e):(br.copy(this.origin).addScaledVector(this.direction,n),br.distanceToSquared(e))}distanceSqToSegment(e,n,i,r){Nm.copy(e).add(n).multiplyScalar(.5),Yu.copy(n).sub(e).normalize(),ls.copy(this.origin).sub(Nm);let s=e.distanceTo(n)*.5,o=-this.direction.dot(Yu),a=ls.dot(this.direction),l=-ls.dot(Yu),c=ls.lengthSq(),f=Math.abs(1-o*o),d,h,p,_;if(f>0)if(d=o*l-a,h=o*a-l,_=s*f,d>=0)if(h>=-_)if(h<=_){let y=1/f;d*=y,h*=y,p=d*(d+o*h+2*a)+h*(o*d+h+2*l)+c}else h=s,d=Math.max(0,-(o*h+a)),p=-d*d+h*(h+2*l)+c;else h=-s,d=Math.max(0,-(o*h+a)),p=-d*d+h*(h+2*l)+c;else h<=-_?(d=Math.max(0,-(-o*s+a)),h=d>0?-s:Math.min(Math.max(-s,-l),s),p=-d*d+h*(h+2*l)+c):h<=_?(d=0,h=Math.min(Math.max(-s,-l),s),p=h*(h+2*l)+c):(d=Math.max(0,-(o*s+a)),h=d>0?s:Math.min(Math.max(-s,-l),s),p=-d*d+h*(h+2*l)+c);else h=o>0?-s:s,d=Math.max(0,-(o*h+a)),p=-d*d+h*(h+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,d),r&&r.copy(Nm).addScaledVector(Yu,h),p}intersectSphere(e,n){br.subVectors(e.center,this.origin);let i=br.dot(this.direction),r=br.dot(br)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,n):this.at(a,n)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let n=e.normal.dot(this.direction);if(n===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/n;return i>=0?i:null}intersectPlane(e,n){let i=this.distanceToPlane(e);return i===null?null:this.at(i,n)}intersectsPlane(e){let n=e.distanceToPoint(this.origin);return n===0||e.normal.dot(this.direction)*n<0}intersectBox(e,n){let i,r,s,o,a,l,c=1/this.direction.x,f=1/this.direction.y,d=1/this.direction.z,h=this.origin;return c>=0?(i=(e.min.x-h.x)*c,r=(e.max.x-h.x)*c):(i=(e.max.x-h.x)*c,r=(e.min.x-h.x)*c),f>=0?(s=(e.min.y-h.y)*f,o=(e.max.y-h.y)*f):(s=(e.max.y-h.y)*f,o=(e.min.y-h.y)*f),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),d>=0?(a=(e.min.z-h.z)*d,l=(e.max.z-h.z)*d):(a=(e.max.z-h.z)*d,l=(e.min.z-h.z)*d),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,n)}intersectsBox(e){return this.intersectBox(e,br)!==null}intersectTriangle(e,n,i,r,s){Dm.subVectors(n,e),$u.subVectors(i,e),Um.crossVectors(Dm,$u);let o=this.direction.dot(Um),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;ls.subVectors(this.origin,e);let l=a*this.direction.dot($u.crossVectors(ls,$u));if(l<0)return null;let c=a*this.direction.dot(Dm.cross(ls));if(c<0||l+c>o)return null;let f=-a*ls.dot(Um);return f<0?null:this.at(f/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Qi=class extends Rr{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new ft(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Li,this.combine=lg,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},ry=new At,zs=new ia,Zu=new Ys,sy=new N,Ku=new N,Ju=new N,ju=new N,Fm=new N,Qu=new N,oy=new N,eh=new N,Vt=class extends rn{constructor(e=new Zt,n=new Qi){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,n){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;n.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){Qu.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let f=a[l],d=s[l];f!==0&&(Fm.fromBufferAttribute(d,e),o?Qu.addScaledVector(Fm,f):Qu.addScaledVector(Fm.sub(n),f))}n.add(Qu)}return n}raycast(e,n){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Zu.copy(i.boundingSphere),Zu.applyMatrix4(s),zs.copy(e.ray).recast(e.near),!(Zu.containsPoint(zs.origin)===!1&&(zs.intersectSphere(Zu,sy)===null||zs.origin.distanceToSquared(sy)>(e.far-e.near)**2))&&(ry.copy(s).invert(),zs.copy(e.ray).applyMatrix4(ry),!(i.boundingBox!==null&&zs.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,n,zs)))}_computeIntersections(e,n,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,f=s.attributes.uv1,d=s.attributes.normal,h=s.groups,p=s.drawRange;if(a!==null)if(Array.isArray(o))for(let _=0,y=h.length;_<y;_++){let m=h[_],u=o[m.materialIndex],g=Math.max(m.start,p.start),v=Math.min(a.count,Math.min(m.start+m.count,p.start+p.count));for(let S=g,A=v;S<A;S+=3){let w=a.getX(S),C=a.getX(S+1),x=a.getX(S+2);r=th(this,u,e,i,c,f,d,w,C,x),r&&(r.faceIndex=Math.floor(S/3),r.face.materialIndex=m.materialIndex,n.push(r))}}else{let _=Math.max(0,p.start),y=Math.min(a.count,p.start+p.count);for(let m=_,u=y;m<u;m+=3){let g=a.getX(m),v=a.getX(m+1),S=a.getX(m+2);r=th(this,o,e,i,c,f,d,g,v,S),r&&(r.faceIndex=Math.floor(m/3),n.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let _=0,y=h.length;_<y;_++){let m=h[_],u=o[m.materialIndex],g=Math.max(m.start,p.start),v=Math.min(l.count,Math.min(m.start+m.count,p.start+p.count));for(let S=g,A=v;S<A;S+=3){let w=S,C=S+1,x=S+2;r=th(this,u,e,i,c,f,d,w,C,x),r&&(r.faceIndex=Math.floor(S/3),r.face.materialIndex=m.materialIndex,n.push(r))}}else{let _=Math.max(0,p.start),y=Math.min(l.count,p.start+p.count);for(let m=_,u=y;m<u;m+=3){let g=m,v=m+1,S=m+2;r=th(this,o,e,i,c,f,d,g,v,S),r&&(r.faceIndex=Math.floor(m/3),n.push(r))}}}};function Zw(t,e,n,i,r,s,o,a){let l;if(e.side===Bn?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===Cr,a),l===null)return null;eh.copy(a),eh.applyMatrix4(t.matrixWorld);let c=n.ray.origin.distanceTo(eh);return c<n.near||c>n.far?null:{distance:c,point:eh.clone(),object:t}}function th(t,e,n,i,r,s,o,a,l,c){t.getVertexPosition(a,Ku),t.getVertexPosition(l,Ju),t.getVertexPosition(c,ju);let f=Zw(t,e,n,i,Ku,Ju,ju,oy);if(f){let d=new N;us.getBarycoord(oy,Ku,Ju,ju,d),r&&(f.uv=us.getInterpolatedAttribute(r,a,l,c,d,new Te)),s&&(f.uv1=us.getInterpolatedAttribute(s,a,l,c,d,new Te)),o&&(f.normal=us.getInterpolatedAttribute(o,a,l,c,d,new N),f.normal.dot(i.direction)>0&&f.normal.multiplyScalar(-1));let h={a,b:l,c,normal:new N,materialIndex:0};us.getNormal(Ku,Ju,ju,h.normal),f.face=h,f.barycoord=d}return f}var bh=class extends On{constructor(e=null,n=1,i=1,r,s,o,a,l,c=fn,f=fn,d,h){super(null,o,a,l,c,f,r,s,d,h),this.isDataTexture=!0,this.image={data:e,width:n,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Om=new N,Kw=new N,Jw=new rt,$i=class{constructor(e=new N(1,0,0),n=0){this.isPlane=!0,this.normal=e,this.constant=n}set(e,n){return this.normal.copy(e),this.constant=n,this}setComponents(e,n,i,r){return this.normal.set(e,n,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,n){return this.normal.copy(e),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(e,n,i){let r=Om.subVectors(i,n).cross(Kw.subVectors(e,n)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,n){return n.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,n,i=!0){let r=e.delta(Om),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?n.copy(e.start):null;let o=-(e.start.dot(this.normal)+this.constant)/s;return i===!0&&(o<0||o>1)?null:n.copy(e.start).addScaledVector(r,o)}intersectsLine(e){let n=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return n<0&&i>0||i<0&&n>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,n){let i=n||Jw.getNormalMatrix(e),r=this.coplanarPoint(Om).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},Vs=new Ys,jw=new Te(.5,.5),nh=new N,ra=class{constructor(e=new $i,n=new $i,i=new $i,r=new $i,s=new $i,o=new $i){this.planes=[e,n,i,r,s,o]}set(e,n,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(n),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,n=Ii,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],c=s[3],f=s[4],d=s[5],h=s[6],p=s[7],_=s[8],y=s[9],m=s[10],u=s[11],g=s[12],v=s[13],S=s[14],A=s[15];if(r[0].setComponents(c-o,p-f,u-_,A-g).normalize(),r[1].setComponents(c+o,p+f,u+_,A+g).normalize(),r[2].setComponents(c+a,p+d,u+y,A+v).normalize(),r[3].setComponents(c-a,p-d,u-y,A-v).normalize(),i)r[4].setComponents(l,h,m,S).normalize(),r[5].setComponents(c-l,p-h,u-m,A-S).normalize();else if(r[4].setComponents(c-l,p-h,u-m,A-S).normalize(),n===Ii)r[5].setComponents(c+l,p+h,u+m,A+S).normalize();else if(n===Jo)r[5].setComponents(l,h,m,S).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Vs.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let n=e.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),Vs.copy(n.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Vs)}intersectsSprite(e){Vs.center.set(0,0,0);let n=jw.distanceTo(e.center);return Vs.radius=.7071067811865476+n,Vs.applyMatrix4(e.matrixWorld),this.intersectsSphere(Vs)}intersectsSphere(e){let n=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(n[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let n=this.planes;for(let i=0;i<6;i++){let r=n[i];if(nh.x=r.normal.x>0?e.max.x:e.min.x,nh.y=r.normal.y>0?e.max.y:e.min.y,nh.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(nh)<0)return!1}return!0}containsPoint(e){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var $s=class extends Rr{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new ft(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},ay=new At,$m=new ia,ih=new Ys,rh=new N,sa=class extends rn{constructor(e=new Zt,n=new $s){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,n){let i=this.geometry,r=this.matrixWorld,s=e.params.Points.threshold,o=i.drawRange;if(i.boundingSphere===null&&i.computeBoundingSphere(),ih.copy(i.boundingSphere),ih.applyMatrix4(r),ih.radius+=s,e.ray.intersectsSphere(ih)===!1)return;ay.copy(r).invert(),$m.copy(e.ray).applyMatrix4(ay);let a=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=i.index,d=i.attributes.position;if(c!==null){let h=Math.max(0,o.start),p=Math.min(c.count,o.start+o.count);for(let _=h,y=p;_<y;_++){let m=c.getX(_);rh.fromBufferAttribute(d,m),ly(rh,m,l,r,e,n,this)}}else{let h=Math.max(0,o.start),p=Math.min(d.count,o.start+o.count);for(let _=h,y=p;_<y;_++)rh.fromBufferAttribute(d,_),ly(rh,_,l,r,e,n,this)}}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}};function ly(t,e,n,i,r,s,o){let a=$m.distanceSqToPoint(t);if(a<n){let l=new N;$m.closestPointToPoint(t,l),l.applyMatrix4(i);let c=r.ray.origin.distanceTo(l);if(c<r.near||c>r.far)return;s.push({distance:c,distanceToRay:Math.sqrt(a),point:l,index:e,face:null,faceIndex:null,barycoord:null,object:o})}}var Il=class extends On{constructor(e=[],n=_s,i,r,s,o,a,l,c,f){super(e,n,i,r,s,o,a,l,c,f),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},Ll=class extends On{constructor(e,n,i,r,s,o,a,l,c){super(e,n,i,r,s,o,a,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}};var Pr=class extends On{constructor(e,n,i=Di,r,s,o,a=fn,l=fn,c,f=Ki,d=1){if(f!==Ki&&f!==xs)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:n,depth:d};super(h,r,s,o,a,l,f,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new ea(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let n=super.toJSON(e);return this.compareFunction!==null&&(n.compareFunction=this.compareFunction),n}},Ah=class extends Pr{constructor(e,n=Di,i=_s,r,s,o=fn,a=fn,l,c=Ki){let f={width:e,height:e,depth:1},d=[f,f,f,f,f,f];super(e,e,n,i,r,s,o,a,l,c),this.image=d,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Nl=class extends On{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},ds=class t extends Zt{constructor(e=1,n=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:n,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],c=[],f=[],d=[],h=0,p=0;_("z","y","x",-1,-1,i,n,e,o,s,0),_("z","y","x",1,-1,i,n,-e,o,s,1),_("x","z","y",1,1,e,i,n,r,o,2),_("x","z","y",1,-1,e,i,-n,r,o,3),_("x","y","z",1,-1,e,n,i,r,s,4),_("x","y","z",-1,-1,e,n,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new St(c,3)),this.setAttribute("normal",new St(f,3)),this.setAttribute("uv",new St(d,2));function _(y,m,u,g,v,S,A,w,C,x,b){let I=S/C,P=A/x,F=S/2,W=A/2,q=w/2,U=C+1,k=x+1,z=0,ne=0,le=new N;for(let me=0;me<k;me++){let Ce=me*P-W;for(let Be=0;Be<U;Be++){let Qe=Be*I-F;le[y]=Qe*g,le[m]=Ce*v,le[u]=q,c.push(le.x,le.y,le.z),le[y]=0,le[m]=0,le[u]=w>0?1:-1,f.push(le.x,le.y,le.z),d.push(Be/C),d.push(1-me/x),z+=1}}for(let me=0;me<x;me++)for(let Ce=0;Ce<C;Ce++){let Be=h+Ce+U*me,Qe=h+Ce+U*(me+1),vt=h+(Ce+1)+U*(me+1),et=h+(Ce+1)+U*me;l.push(Be,Qe,et),l.push(Qe,vt,et),ne+=6}a.addGroup(p,ne,b),p+=ne,h+=z}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}},Dl=class t extends Zt{constructor(e=1,n=1,i=4,r=8,s=1){super(),this.type="CapsuleGeometry",this.parameters={radius:e,height:n,capSegments:i,radialSegments:r,heightSegments:s},n=Math.max(0,n),i=Math.max(1,Math.floor(i)),r=Math.max(3,Math.floor(r)),s=Math.max(1,Math.floor(s));let o=[],a=[],l=[],c=[],f=n/2,d=Math.PI/2*e,h=n,p=2*d+h,_=i*2+s,y=r+1,m=new N,u=new N;for(let g=0;g<=_;g++){let v=0,S=0,A=0,w=0;if(g<=i){let b=g/i,I=b*Math.PI/2;S=-f-e*Math.cos(I),A=e*Math.sin(I),w=-e*Math.cos(I),v=b*d}else if(g<=i+s){let b=(g-i)/s;S=-f+b*n,A=e,w=0,v=d+b*h}else{let b=(g-i-s)/i,I=b*Math.PI/2;S=f+e*Math.sin(I),A=e*Math.cos(I),w=e*Math.sin(I),v=d+h+b*d}let C=Math.max(0,Math.min(1,v/p)),x=0;g===0?x=.5/r:g===_&&(x=-.5/r);for(let b=0;b<=r;b++){let I=b/r,P=I*Math.PI*2,F=Math.sin(P),W=Math.cos(P);u.x=-A*W,u.y=S,u.z=A*F,a.push(u.x,u.y,u.z),m.set(-A*W,w,A*F),m.normalize(),l.push(m.x,m.y,m.z),c.push(I+x,C)}if(g>0){let b=(g-1)*y;for(let I=0;I<r;I++){let P=b+I,F=b+I+1,W=g*y+I,q=g*y+I+1;o.push(P,F,W),o.push(F,q,W)}}}this.setIndex(o),this.setAttribute("position",new St(a,3)),this.setAttribute("normal",new St(l,3)),this.setAttribute("uv",new St(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.height,e.capSegments,e.radialSegments,e.heightSegments)}},Ul=class t extends Zt{constructor(e=1,n=32,i=0,r=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:n,thetaStart:i,thetaLength:r},n=Math.max(3,n);let s=[],o=[],a=[],l=[],c=new N,f=new Te;o.push(0,0,0),a.push(0,0,1),l.push(.5,.5);for(let d=0,h=3;d<=n;d++,h+=3){let p=i+d/n*r;c.x=e*Math.cos(p),c.y=e*Math.sin(p),o.push(c.x,c.y,c.z),a.push(0,0,1),f.x=(o[h]/e+1)/2,f.y=(o[h+1]/e+1)/2,l.push(f.x,f.y)}for(let d=1;d<=n;d++)s.push(d,d+1,0);this.setIndex(s),this.setAttribute("position",new St(o,3)),this.setAttribute("normal",new St(a,3)),this.setAttribute("uv",new St(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.segments,e.thetaStart,e.thetaLength)}},er=class t extends Zt{constructor(e=1,n=1,i=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:n,height:i,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};let c=this;r=Math.floor(r),s=Math.floor(s);let f=[],d=[],h=[],p=[],_=0,y=[],m=i/2,u=0;g(),o===!1&&(e>0&&v(!0),n>0&&v(!1)),this.setIndex(f),this.setAttribute("position",new St(d,3)),this.setAttribute("normal",new St(h,3)),this.setAttribute("uv",new St(p,2));function g(){let S=new N,A=new N,w=0,C=(n-e)/i;for(let x=0;x<=s;x++){let b=[],I=x/s,P=I*(n-e)+e;for(let F=0;F<=r;F++){let W=F/r,q=W*l+a,U=Math.sin(q),k=Math.cos(q);A.x=P*U,A.y=-I*i+m,A.z=P*k,d.push(A.x,A.y,A.z),S.set(U,C,k).normalize(),h.push(S.x,S.y,S.z),p.push(W,1-I),b.push(_++)}y.push(b)}for(let x=0;x<r;x++)for(let b=0;b<s;b++){let I=y[b][x],P=y[b+1][x],F=y[b+1][x+1],W=y[b][x+1];(e>0||b!==0)&&(f.push(I,P,W),w+=3),(n>0||b!==s-1)&&(f.push(P,F,W),w+=3)}c.addGroup(u,w,0),u+=w}function v(S){let A=_,w=new Te,C=new N,x=0,b=S===!0?e:n,I=S===!0?1:-1;for(let F=1;F<=r;F++)d.push(0,m*I,0),h.push(0,I,0),p.push(.5,.5),_++;let P=_;for(let F=0;F<=r;F++){let q=F/r*l+a,U=Math.cos(q),k=Math.sin(q);C.x=b*k,C.y=m*I,C.z=b*U,d.push(C.x,C.y,C.z),h.push(0,I,0),w.x=U*.5+.5,w.y=k*.5*I+.5,p.push(w.x,w.y),_++}for(let F=0;F<r;F++){let W=A+F,q=P+F;S===!0?f.push(q,q+1,W):f.push(q+1,q,W),x+=3}c.addGroup(u,x,S===!0?1:2),u+=x}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var ri=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){Ze("Curve: .getPoint() not implemented.")}getPointAt(e,n){let i=this.getUtoTmapping(e);return this.getPoint(i,n)}getPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPoint(i/e));return n}getSpacedPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPointAt(i/e));return n}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let n=[],i,r=this.getPoint(0),s=0;n.push(0);for(let o=1;o<=e;o++)i=this.getPoint(o/e),s+=i.distanceTo(r),n.push(s),r=i;return this.cacheArcLengths=n,n}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,n=null){let i=this.getLengths(),r=0,s=i.length,o;n?o=n:o=e*i[s-1];let a=0,l=s-1,c;for(;a<=l;)if(r=Math.floor(a+(l-a)/2),c=i[r]-o,c<0)a=r+1;else if(c>0)l=r-1;else{l=r;break}if(r=l,i[r]===o)return r/(s-1);let f=i[r],h=i[r+1]-f,p=(o-f)/h;return(r+p)/(s-1)}getTangent(e,n){let r=e-1e-4,s=e+1e-4;r<0&&(r=0),s>1&&(s=1);let o=this.getPoint(r),a=this.getPoint(s),l=n||(o.isVector2?new Te:new N);return l.copy(a).sub(o).normalize(),l}getTangentAt(e,n){let i=this.getUtoTmapping(e);return this.getTangent(i,n)}computeFrenetFrames(e,n=!1){let i=new N,r=[],s=[],o=[],a=new N,l=new At;for(let p=0;p<=e;p++){let _=p/e;r[p]=this.getTangentAt(_,new N)}s[0]=new N,o[0]=new N;let c=Number.MAX_VALUE,f=Math.abs(r[0].x),d=Math.abs(r[0].y),h=Math.abs(r[0].z);f<=c&&(c=f,i.set(1,0,0)),d<=c&&(c=d,i.set(0,1,0)),h<=c&&i.set(0,0,1),a.crossVectors(r[0],i).normalize(),s[0].crossVectors(r[0],a),o[0].crossVectors(r[0],s[0]);for(let p=1;p<=e;p++){if(s[p]=s[p-1].clone(),o[p]=o[p-1].clone(),a.crossVectors(r[p-1],r[p]),a.length()>Number.EPSILON){a.normalize();let _=Math.acos(mt(r[p-1].dot(r[p]),-1,1));s[p].applyMatrix4(l.makeRotationAxis(a,_))}o[p].crossVectors(r[p],s[p])}if(n===!0){let p=Math.acos(mt(s[0].dot(s[e]),-1,1));p/=e,r[0].dot(a.crossVectors(s[0],s[e]))>0&&(p=-p);for(let _=1;_<=e;_++)s[_].applyMatrix4(l.makeRotationAxis(r[_],p*_)),o[_].crossVectors(r[_],s[_])}return{tangents:r,normals:s,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},oa=class extends ri{constructor(e=0,n=0,i=1,r=1,s=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=n,this.xRadius=i,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(e,n=new Te){let i=n,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,o=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(o?s=0:s=r),this.aClockwise===!0&&!o&&(s===r?s=-r:s=s-r);let a=this.aStartAngle+e*s,l=this.aX+this.xRadius*Math.cos(a),c=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let f=Math.cos(this.aRotation),d=Math.sin(this.aRotation),h=l-this.aX,p=c-this.aY;l=h*f-p*d+this.aX,c=h*d+p*f+this.aY}return i.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},Ch=class extends oa{constructor(e,n,i,r,s,o){super(e,n,i,i,r,s,o),this.isArcCurve=!0,this.type="ArcCurve"}};function bg(){let t=0,e=0,n=0,i=0;function r(s,o,a,l){t=s,e=a,n=-3*s+3*o-2*a-l,i=2*s-2*o+a+l}return{initCatmullRom:function(s,o,a,l,c){r(o,a,c*(a-s),c*(l-o))},initNonuniformCatmullRom:function(s,o,a,l,c,f,d){let h=(o-s)/c-(a-s)/(c+f)+(a-o)/f,p=(a-o)/f-(l-o)/(f+d)+(l-a)/d;h*=f,p*=f,r(o,a,h,p)},calc:function(s){let o=s*s,a=o*s;return t+e*s+n*o+i*a}}}var cy=new N,uy=new N,Bm=new bg,km=new bg,zm=new bg,Rh=class extends ri{constructor(e=[],n=!1,i="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=n,this.curveType=i,this.tension=r}getPoint(e,n=new N){let i=n,r=this.points,s=r.length,o=(s-(this.closed?0:1))*e,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/s)+1)*s:l===0&&a===s-1&&(a=s-2,l=1);let c,f;this.closed||a>0?c=r[(a-1)%s]:(uy.subVectors(r[0],r[1]).add(r[0]),c=uy);let d=r[a%s],h=r[(a+1)%s];if(this.closed||a+2<s?f=r[(a+2)%s]:(cy.subVectors(r[s-1],r[s-2]).add(r[s-1]),f=cy),this.curveType==="centripetal"||this.curveType==="chordal"){let p=this.curveType==="chordal"?.5:.25,_=Math.pow(c.distanceToSquared(d),p),y=Math.pow(d.distanceToSquared(h),p),m=Math.pow(h.distanceToSquared(f),p);y<1e-4&&(y=1),_<1e-4&&(_=y),m<1e-4&&(m=y),Bm.initNonuniformCatmullRom(c.x,d.x,h.x,f.x,_,y,m),km.initNonuniformCatmullRom(c.y,d.y,h.y,f.y,_,y,m),zm.initNonuniformCatmullRom(c.z,d.z,h.z,f.z,_,y,m)}else this.curveType==="catmullrom"&&(Bm.initCatmullRom(c.x,d.x,h.x,f.x,this.tension),km.initCatmullRom(c.y,d.y,h.y,f.y,this.tension),zm.initCatmullRom(c.z,d.z,h.z,f.z,this.tension));return i.set(Bm.calc(l),km.calc(l),zm.calc(l)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new N().fromArray(r))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function hy(t,e,n,i,r){let s=(i-e)*.5,o=(r-n)*.5,a=t*t,l=t*a;return(2*n-2*i+s+o)*l+(-3*n+3*i-2*s-o)*a+s*t+n}function Qw(t,e){let n=1-t;return n*n*e}function eE(t,e){return 2*(1-t)*t*e}function tE(t,e){return t*t*e}function yl(t,e,n,i){return Qw(t,e)+eE(t,n)+tE(t,i)}function nE(t,e){let n=1-t;return n*n*n*e}function iE(t,e){let n=1-t;return 3*n*n*t*e}function rE(t,e){return 3*(1-t)*t*t*e}function sE(t,e){return t*t*t*e}function Sl(t,e,n,i,r){return nE(t,e)+iE(t,n)+rE(t,i)+sE(t,r)}var Fl=class extends ri{constructor(e=new Te,n=new Te,i=new Te,r=new Te){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new Te){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(Sl(e,r.x,s.x,o.x,a.x),Sl(e,r.y,s.y,o.y,a.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Ph=class extends ri{constructor(e=new N,n=new N,i=new N,r=new N){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new N){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(Sl(e,r.x,s.x,o.x,a.x),Sl(e,r.y,s.y,o.y,a.y),Sl(e,r.z,s.z,o.z,a.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Ol=class extends ri{constructor(e=new Te,n=new Te){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=n}getPoint(e,n=new Te){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new Te){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ih=class extends ri{constructor(e=new N,n=new N){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=n}getPoint(e,n=new N){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new N){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Bl=class extends ri{constructor(e=new Te,n=new Te,i=new Te){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new Te){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(yl(e,r.x,s.x,o.x),yl(e,r.y,s.y,o.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Lh=class extends ri{constructor(e=new N,n=new N,i=new N){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new N){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(yl(e,r.x,s.x,o.x),yl(e,r.y,s.y,o.y),yl(e,r.z,s.z,o.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},kl=class extends ri{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,n=new Te){let i=n,r=this.points,s=(r.length-1)*e,o=Math.floor(s),a=s-o,l=r[o===0?o:o-1],c=r[o],f=r[o>r.length-2?r.length-1:o+1],d=r[o>r.length-3?r.length-1:o+2];return i.set(hy(a,l.x,c.x,f.x,d.x),hy(a,l.y,c.y,f.y,d.y)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new Te().fromArray(r))}return this}},Zm=Object.freeze({__proto__:null,ArcCurve:Ch,CatmullRomCurve3:Rh,CubicBezierCurve:Fl,CubicBezierCurve3:Ph,EllipseCurve:oa,LineCurve:Ol,LineCurve3:Ih,QuadraticBezierCurve:Bl,QuadraticBezierCurve3:Lh,SplineCurve:kl}),Nh=class extends ri{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),n=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(n)){let i=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new Zm[i](n,e))}return this}getPoint(e,n){let i=e*this.getLength(),r=this.getCurveLengths(),s=0;for(;s<r.length;){if(r[s]>=i){let o=r[s]-i,a=this.curves[s],l=a.getLength(),c=l===0?0:1-o/l;return a.getPointAt(c,n)}s++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],n=0;for(let i=0,r=this.curves.length;i<r;i++)n+=this.curves[i].getLength(),e.push(n);return this.cacheLengths=e,e}getSpacedPoints(e=40){let n=[];for(let i=0;i<=e;i++)n.push(this.getPoint(i/e));return this.autoClose&&n.push(n[0]),n}getPoints(e=12){let n=[],i;for(let r=0,s=this.curves;r<s.length;r++){let o=s[r],a=o.isEllipseCurve?e*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?e*o.points.length:e,l=o.getPoints(a);for(let c=0;c<l.length;c++){let f=l[c];i&&i.equals(f)||(n.push(f),i=f)}}return this.autoClose&&n.length>1&&!n[n.length-1].equals(n[0])&&n.push(n[0]),n}copy(e){super.copy(e),this.curves=[];for(let n=0,i=e.curves.length;n<i;n++){let r=e.curves[n];this.curves.push(r.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let n=0,i=this.curves.length;n<i;n++){let r=this.curves[n];e.curves.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let n=0,i=e.curves.length;n<i;n++){let r=e.curves[n];this.curves.push(new Zm[r.type]().fromJSON(r))}return this}},Zs=class extends Nh{constructor(e){super(),this.type="Path",this.currentPoint=new Te,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let n=1,i=e.length;n<i;n++)this.lineTo(e[n].x,e[n].y);return this}moveTo(e,n){return this.currentPoint.set(e,n),this}lineTo(e,n){let i=new Ol(this.currentPoint.clone(),new Te(e,n));return this.curves.push(i),this.currentPoint.set(e,n),this}quadraticCurveTo(e,n,i,r){let s=new Bl(this.currentPoint.clone(),new Te(e,n),new Te(i,r));return this.curves.push(s),this.currentPoint.set(i,r),this}bezierCurveTo(e,n,i,r,s,o){let a=new Fl(this.currentPoint.clone(),new Te(e,n),new Te(i,r),new Te(s,o));return this.curves.push(a),this.currentPoint.set(s,o),this}splineThru(e){let n=[this.currentPoint.clone()].concat(e),i=new kl(n);return this.curves.push(i),this.currentPoint.copy(e[e.length-1]),this}arc(e,n,i,r,s,o){let a=this.currentPoint.x,l=this.currentPoint.y;return this.absarc(e+a,n+l,i,r,s,o),this}absarc(e,n,i,r,s,o){return this.absellipse(e,n,i,i,r,s,o),this}ellipse(e,n,i,r,s,o,a,l){let c=this.currentPoint.x,f=this.currentPoint.y;return this.absellipse(e+c,n+f,i,r,s,o,a,l),this}absellipse(e,n,i,r,s,o,a,l){let c=new oa(e,n,i,r,s,o,a,l);if(this.curves.length>0){let d=c.getPoint(0);d.equals(this.currentPoint)||this.lineTo(d.x,d.y)}this.curves.push(c);let f=c.getPoint(1);return this.currentPoint.copy(f),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}},aa=class extends Zs{constructor(e){super(e),this.uuid=Qs(),this.type="Shape",this.holes=[]}getPointsHoles(e){let n=[];for(let i=0,r=this.holes.length;i<r;i++)n[i]=this.holes[i].getPoints(e);return n}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let n=0,i=e.holes.length;n<i;n++){let r=e.holes[n];this.holes.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let n=0,i=this.holes.length;n<i;n++){let r=this.holes[n];e.holes.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let n=0,i=e.holes.length;n<i;n++){let r=e.holes[n];this.holes.push(new Zs().fromJSON(r))}return this}};function oE(t,e,n=2){let i=e&&e.length,r=i?e[0]*n:t.length,s=rS(t,0,r,n,!0),o=[];if(!s||s.next===s.prev)return o;let a,l,c;if(i&&(s=hE(t,e,s,n)),t.length>80*n){a=t[0],l=t[1];let f=a,d=l;for(let h=n;h<r;h+=n){let p=t[h],_=t[h+1];p<a&&(a=p),_<l&&(l=_),p>f&&(f=p),_>d&&(d=_)}c=Math.max(f-a,d-l),c=c!==0?32767/c:0}return zl(s,o,n,a,l,c,0),o}function rS(t,e,n,i,r){let s;if(r===ME(t,e,n,i)>0)for(let o=e;o<n;o+=i)s=fy(o/i|0,t[o],t[o+1],s);else for(let o=n-i;o>=e;o-=i)s=fy(o/i|0,t[o],t[o+1],s);return s&&la(s,s.next)&&(Hl(s),s=s.next),s}function Ks(t,e){if(!t)return t;e||(e=t);let n=t,i;do if(i=!1,!n.steiner&&(la(n,n.next)||qt(n.prev,n,n.next)===0)){if(Hl(n),n=e=n.prev,n===n.next)break;i=!0}else n=n.next;while(i||n!==e);return e}function zl(t,e,n,i,r,s,o){if(!t)return;!o&&s&&gE(t,i,r,s);let a=t;for(;t.prev!==t.next;){let l=t.prev,c=t.next;if(s?lE(t,i,r,s):aE(t)){e.push(l.i,t.i,c.i),Hl(t),t=c.next,a=c.next;continue}if(t=c,t===a){o?o===1?(t=cE(Ks(t),e),zl(t,e,n,i,r,s,2)):o===2&&uE(t,e,n,i,r,s):zl(Ks(t),e,n,i,r,s,1);break}}}function aE(t){let e=t.prev,n=t,i=t.next;if(qt(e,n,i)>=0)return!1;let r=e.x,s=n.x,o=i.x,a=e.y,l=n.y,c=i.y,f=Math.min(r,s,o),d=Math.min(a,l,c),h=Math.max(r,s,o),p=Math.max(a,l,c),_=i.next;for(;_!==e;){if(_.x>=f&&_.x<=h&&_.y>=d&&_.y<=p&&_l(r,a,s,l,o,c,_.x,_.y)&&qt(_.prev,_,_.next)>=0)return!1;_=_.next}return!0}function lE(t,e,n,i){let r=t.prev,s=t,o=t.next;if(qt(r,s,o)>=0)return!1;let a=r.x,l=s.x,c=o.x,f=r.y,d=s.y,h=o.y,p=Math.min(a,l,c),_=Math.min(f,d,h),y=Math.max(a,l,c),m=Math.max(f,d,h),u=Km(p,_,e,n,i),g=Km(y,m,e,n,i),v=t.prevZ,S=t.nextZ;for(;v&&v.z>=u&&S&&S.z<=g;){if(v.x>=p&&v.x<=y&&v.y>=_&&v.y<=m&&v!==r&&v!==o&&_l(a,f,l,d,c,h,v.x,v.y)&&qt(v.prev,v,v.next)>=0||(v=v.prevZ,S.x>=p&&S.x<=y&&S.y>=_&&S.y<=m&&S!==r&&S!==o&&_l(a,f,l,d,c,h,S.x,S.y)&&qt(S.prev,S,S.next)>=0))return!1;S=S.nextZ}for(;v&&v.z>=u;){if(v.x>=p&&v.x<=y&&v.y>=_&&v.y<=m&&v!==r&&v!==o&&_l(a,f,l,d,c,h,v.x,v.y)&&qt(v.prev,v,v.next)>=0)return!1;v=v.prevZ}for(;S&&S.z<=g;){if(S.x>=p&&S.x<=y&&S.y>=_&&S.y<=m&&S!==r&&S!==o&&_l(a,f,l,d,c,h,S.x,S.y)&&qt(S.prev,S,S.next)>=0)return!1;S=S.nextZ}return!0}function cE(t,e){let n=t;do{let i=n.prev,r=n.next.next;!la(i,r)&&oS(i,n,n.next,r)&&Vl(i,r)&&Vl(r,i)&&(e.push(i.i,n.i,r.i),Hl(n),Hl(n.next),n=t=r),n=n.next}while(n!==t);return Ks(n)}function uE(t,e,n,i,r,s){let o=t;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&xE(o,a)){let l=aS(o,a);o=Ks(o,o.next),l=Ks(l,l.next),zl(o,e,n,i,r,s,0),zl(l,e,n,i,r,s,0);return}a=a.next}o=o.next}while(o!==t)}function hE(t,e,n,i){let r=[];for(let s=0,o=e.length;s<o;s++){let a=e[s]*i,l=s<o-1?e[s+1]*i:t.length,c=rS(t,a,l,i,!1);c===c.next&&(c.steiner=!0),r.push(vE(c))}r.sort(fE);for(let s=0;s<r.length;s++)n=dE(r[s],n);return n}function fE(t,e){let n=t.x-e.x;if(n===0&&(n=t.y-e.y,n===0)){let i=(t.next.y-t.y)/(t.next.x-t.x),r=(e.next.y-e.y)/(e.next.x-e.x);n=i-r}return n}function dE(t,e){let n=pE(t,e);if(!n)return e;let i=aS(n,t);return Ks(i,i.next),Ks(n,n.next)}function pE(t,e){let n=e,i=t.x,r=t.y,s=-1/0,o;if(la(t,n))return n;do{if(la(t,n.next))return n.next;if(r<=n.y&&r>=n.next.y&&n.next.y!==n.y){let d=n.x+(r-n.y)*(n.next.x-n.x)/(n.next.y-n.y);if(d<=i&&d>s&&(s=d,o=n.x<n.next.x?n:n.next,d===i))return o}n=n.next}while(n!==e);if(!o)return null;let a=o,l=o.x,c=o.y,f=1/0;n=o;do{if(i>=n.x&&n.x>=l&&i!==n.x&&sS(r<c?i:s,r,l,c,r<c?s:i,r,n.x,n.y)){let d=Math.abs(r-n.y)/(i-n.x);Vl(n,t)&&(d<f||d===f&&(n.x>o.x||n.x===o.x&&mE(o,n)))&&(o=n,f=d)}n=n.next}while(n!==a);return o}function mE(t,e){return qt(t.prev,t,e.prev)<0&&qt(e.next,t,t.next)<0}function gE(t,e,n,i){let r=t;do r.z===0&&(r.z=Km(r.x,r.y,e,n,i)),r.prevZ=r.prev,r.nextZ=r.next,r=r.next;while(r!==t);r.prevZ.nextZ=null,r.prevZ=null,_E(r)}function _E(t){let e,n=1;do{let i=t,r;t=null;let s=null;for(e=0;i;){e++;let o=i,a=0;for(let c=0;c<n&&(a++,o=o.nextZ,!!o);c++);let l=n;for(;a>0||l>0&&o;)a!==0&&(l===0||!o||i.z<=o.z)?(r=i,i=i.nextZ,a--):(r=o,o=o.nextZ,l--),s?s.nextZ=r:t=r,r.prevZ=s,s=r;i=o}s.nextZ=null,n*=2}while(e>1);return t}function Km(t,e,n,i,r){return t=(t-n)*r|0,e=(e-i)*r|0,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,t|e<<1}function vE(t){let e=t,n=t;do(e.x<n.x||e.x===n.x&&e.y<n.y)&&(n=e),e=e.next;while(e!==t);return n}function sS(t,e,n,i,r,s,o,a){return(r-o)*(e-a)>=(t-o)*(s-a)&&(t-o)*(i-a)>=(n-o)*(e-a)&&(n-o)*(s-a)>=(r-o)*(i-a)}function _l(t,e,n,i,r,s,o,a){return!(t===o&&e===a)&&sS(t,e,n,i,r,s,o,a)}function xE(t,e){return t.next.i!==e.i&&t.prev.i!==e.i&&!yE(t,e)&&(Vl(t,e)&&Vl(e,t)&&SE(t,e)&&(qt(t.prev,t,e.prev)||qt(t,e.prev,e))||la(t,e)&&qt(t.prev,t,t.next)>0&&qt(e.prev,e,e.next)>0)}function qt(t,e,n){return(e.y-t.y)*(n.x-e.x)-(e.x-t.x)*(n.y-e.y)}function la(t,e){return t.x===e.x&&t.y===e.y}function oS(t,e,n,i){let r=oh(qt(t,e,n)),s=oh(qt(t,e,i)),o=oh(qt(n,i,t)),a=oh(qt(n,i,e));return!!(r!==s&&o!==a||r===0&&sh(t,n,e)||s===0&&sh(t,i,e)||o===0&&sh(n,t,i)||a===0&&sh(n,e,i))}function sh(t,e,n){return e.x<=Math.max(t.x,n.x)&&e.x>=Math.min(t.x,n.x)&&e.y<=Math.max(t.y,n.y)&&e.y>=Math.min(t.y,n.y)}function oh(t){return t>0?1:t<0?-1:0}function yE(t,e){let n=t;do{if(n.i!==t.i&&n.next.i!==t.i&&n.i!==e.i&&n.next.i!==e.i&&oS(n,n.next,t,e))return!0;n=n.next}while(n!==t);return!1}function Vl(t,e){return qt(t.prev,t,t.next)<0?qt(t,e,t.next)>=0&&qt(t,t.prev,e)>=0:qt(t,e,t.prev)<0||qt(t,t.next,e)<0}function SE(t,e){let n=t,i=!1,r=(t.x+e.x)/2,s=(t.y+e.y)/2;do n.y>s!=n.next.y>s&&n.next.y!==n.y&&r<(n.next.x-n.x)*(s-n.y)/(n.next.y-n.y)+n.x&&(i=!i),n=n.next;while(n!==t);return i}function aS(t,e){let n=Jm(t.i,t.x,t.y),i=Jm(e.i,e.x,e.y),r=t.next,s=e.prev;return t.next=e,e.prev=t,n.next=r,r.prev=n,i.next=n,n.prev=i,s.next=i,i.prev=s,i}function fy(t,e,n,i){let r=Jm(t,e,n);return i?(r.next=i.next,r.prev=i,i.next.prev=r,i.next=r):(r.prev=r,r.next=r),r}function Hl(t){t.next.prev=t.prev,t.prev.next=t.next,t.prevZ&&(t.prevZ.nextZ=t.nextZ),t.nextZ&&(t.nextZ.prevZ=t.prevZ)}function Jm(t,e,n){return{i:t,x:e,y:n,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function ME(t,e,n,i){let r=0;for(let s=e,o=n-i;s<n;s+=i)r+=(t[o]-t[s])*(t[s+1]+t[o+1]),o=s;return r}var jm=class{static triangulate(e,n,i=2){return oE(e,n,i)}},Gs=class t{static area(e){let n=e.length,i=0;for(let r=n-1,s=0;s<n;r=s++)i+=e[r].x*e[s].y-e[s].x*e[r].y;return i*.5}static isClockWise(e){return t.area(e)<0}static triangulateShape(e,n){let i=[],r=[],s=[];dy(e),py(i,e);let o=e.length;n.forEach(dy);for(let l=0;l<n.length;l++)r.push(o),o+=n[l].length,py(i,n[l]);let a=jm.triangulate(i,r);for(let l=0;l<a.length;l+=3)s.push(a.slice(l,l+3));return s}};function dy(t){let e=t.length;e>2&&t[e-1].equals(t[0])&&t.pop()}function py(t,e){for(let n=0;n<e.length;n++)t.push(e[n].x),t.push(e[n].y)}var Gl=class t extends Zt{constructor(e=new aa([new Te(.5,.5),new Te(-.5,.5),new Te(-.5,-.5),new Te(.5,-.5)]),n={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:e,options:n},e=Array.isArray(e)?e:[e];let i=this,r=[],s=[];for(let a=0,l=e.length;a<l;a++){let c=e[a];o(c)}this.setAttribute("position",new St(r,3)),this.setAttribute("uv",new St(s,2)),this.computeVertexNormals();function o(a){let l=[],c=n.curveSegments!==void 0?n.curveSegments:12,f=n.steps!==void 0?n.steps:1,d=n.depth!==void 0?n.depth:1,h=n.bevelEnabled!==void 0?n.bevelEnabled:!0,p=n.bevelThickness!==void 0?n.bevelThickness:.2,_=n.bevelSize!==void 0?n.bevelSize:p-.1,y=n.bevelOffset!==void 0?n.bevelOffset:0,m=n.bevelSegments!==void 0?n.bevelSegments:3,u=n.extrudePath,g=n.UVGenerator!==void 0?n.UVGenerator:wE,v,S=!1,A,w,C,x;if(u){v=u.getSpacedPoints(f),S=!0,h=!1;let ie=u.isCatmullRomCurve3?u.closed:!1;A=u.computeFrenetFrames(f,ie),w=new N,C=new N,x=new N}h||(m=0,p=0,_=0,y=0);let b=a.extractPoints(c),I=b.shape,P=b.holes;if(!Gs.isClockWise(I)){I=I.reverse();for(let ie=0,re=P.length;ie<re;ie++){let j=P[ie];Gs.isClockWise(j)&&(P[ie]=j.reverse())}}function W(ie){let j=10000000000000001e-36,Se=ie[0];for(let ve=1;ve<=ie.length;ve++){let Ye=ve%ie.length,L=ie[Ye],tt=L.x-Se.x,ze=L.y-Se.y,Ke=tt*tt+ze*ze,fe=Math.max(Math.abs(L.x),Math.abs(L.y),Math.abs(Se.x),Math.abs(Se.y)),yt=j*fe*fe;if(Ke<=yt){ie.splice(Ye,1),ve--;continue}Se=L}}W(I),P.forEach(W);let q=P.length,U=I;for(let ie=0;ie<q;ie++){let re=P[ie];I=I.concat(re)}function k(ie,re,j){return re||Je("ExtrudeGeometry: vec does not exist"),ie.clone().addScaledVector(re,j)}let z=I.length;function ne(ie,re,j){let Se,ve,Ye,L=ie.x-re.x,tt=ie.y-re.y,ze=j.x-ie.x,Ke=j.y-ie.y,fe=L*L+tt*tt,yt=L*Ke-tt*ze;if(Math.abs(yt)>Number.EPSILON){let T=Math.sqrt(fe),M=Math.sqrt(ze*ze+Ke*Ke),B=re.x-tt/T,K=re.y+L/T,se=j.x-Ke/M,de=j.y+ze/M,pe=((se-B)*Ke-(de-K)*ze)/(L*Ke-tt*ze);Se=B+L*pe-ie.x,ve=K+tt*pe-ie.y;let Y=Se*Se+ve*ve;if(Y<=2)return new Te(Se,ve);Ye=Math.sqrt(Y/2)}else{let T=!1;L>Number.EPSILON?ze>Number.EPSILON&&(T=!0):L<-Number.EPSILON?ze<-Number.EPSILON&&(T=!0):Math.sign(tt)===Math.sign(Ke)&&(T=!0),T?(Se=-tt,ve=L,Ye=Math.sqrt(fe)):(Se=L,ve=tt,Ye=Math.sqrt(fe/2))}return new Te(Se/Ye,ve/Ye)}let le=[];for(let ie=0,re=U.length,j=re-1,Se=ie+1;ie<re;ie++,j++,Se++)j===re&&(j=0),Se===re&&(Se=0),le[ie]=ne(U[ie],U[j],U[Se]);let me=[],Ce,Be=le.concat();for(let ie=0,re=q;ie<re;ie++){let j=P[ie];Ce=[];for(let Se=0,ve=j.length,Ye=ve-1,L=Se+1;Se<ve;Se++,Ye++,L++)Ye===ve&&(Ye=0),L===ve&&(L=0),Ce[Se]=ne(j[Se],j[Ye],j[L]);me.push(Ce),Be=Be.concat(Ce)}let Qe;if(m===0)Qe=Gs.triangulateShape(U,P);else{let ie=[],re=[];for(let j=0;j<m;j++){let Se=j/m,ve=p*Math.cos(Se*Math.PI/2),Ye=_*Math.sin(Se*Math.PI/2)+y;for(let L=0,tt=U.length;L<tt;L++){let ze=k(U[L],le[L],Ye);Ve(ze.x,ze.y,-ve),Se===0&&ie.push(ze)}for(let L=0,tt=q;L<tt;L++){let ze=P[L];Ce=me[L];let Ke=[];for(let fe=0,yt=ze.length;fe<yt;fe++){let T=k(ze[fe],Ce[fe],Ye);Ve(T.x,T.y,-ve),Se===0&&Ke.push(T)}Se===0&&re.push(Ke)}}Qe=Gs.triangulateShape(ie,re)}let vt=Qe.length,et=_+y;for(let ie=0;ie<z;ie++){let re=h?k(I[ie],Be[ie],et):I[ie];S?(C.copy(A.normals[0]).multiplyScalar(re.x),w.copy(A.binormals[0]).multiplyScalar(re.y),x.copy(v[0]).add(C).add(w),Ve(x.x,x.y,x.z)):Ve(re.x,re.y,0)}for(let ie=1;ie<=f;ie++)for(let re=0;re<z;re++){let j=h?k(I[re],Be[re],et):I[re];S?(C.copy(A.normals[ie]).multiplyScalar(j.x),w.copy(A.binormals[ie]).multiplyScalar(j.y),x.copy(v[ie]).add(C).add(w),Ve(x.x,x.y,x.z)):Ve(j.x,j.y,d/f*ie)}for(let ie=m-1;ie>=0;ie--){let re=ie/m,j=p*Math.cos(re*Math.PI/2),Se=_*Math.sin(re*Math.PI/2)+y;for(let ve=0,Ye=U.length;ve<Ye;ve++){let L=k(U[ve],le[ve],Se);Ve(L.x,L.y,d+j)}for(let ve=0,Ye=P.length;ve<Ye;ve++){let L=P[ve];Ce=me[ve];for(let tt=0,ze=L.length;tt<ze;tt++){let Ke=k(L[tt],Ce[tt],Se);S?Ve(Ke.x,Ke.y+v[f-1].y,v[f-1].x+j):Ve(Ke.x,Ke.y,d+j)}}}te(),ye();function te(){let ie=r.length/3;if(h){let re=0,j=z*re;for(let Se=0;Se<vt;Se++){let ve=Qe[Se];qe(ve[2]+j,ve[1]+j,ve[0]+j)}re=f+m*2,j=z*re;for(let Se=0;Se<vt;Se++){let ve=Qe[Se];qe(ve[0]+j,ve[1]+j,ve[2]+j)}}else{for(let re=0;re<vt;re++){let j=Qe[re];qe(j[2],j[1],j[0])}for(let re=0;re<vt;re++){let j=Qe[re];qe(j[0]+z*f,j[1]+z*f,j[2]+z*f)}}i.addGroup(ie,r.length/3-ie,0)}function ye(){let ie=r.length/3,re=0;ce(U,re),re+=U.length;for(let j=0,Se=P.length;j<Se;j++){let ve=P[j];ce(ve,re),re+=ve.length}i.addGroup(ie,r.length/3-ie,1)}function ce(ie,re){let j=ie.length;for(;--j>=0;){let Se=j,ve=j-1;ve<0&&(ve=ie.length-1);for(let Ye=0,L=f+m*2;Ye<L;Ye++){let tt=z*Ye,ze=z*(Ye+1),Ke=re+Se+tt,fe=re+ve+tt,yt=re+ve+ze,T=re+Se+ze;$e(Ke,fe,yt,T)}}}function Ve(ie,re,j){l.push(ie),l.push(re),l.push(j)}function qe(ie,re,j){dt(ie),dt(re),dt(j);let Se=r.length/3,ve=g.generateTopUV(i,r,Se-3,Se-2,Se-1);Ue(ve[0]),Ue(ve[1]),Ue(ve[2])}function $e(ie,re,j,Se){dt(ie),dt(re),dt(Se),dt(re),dt(j),dt(Se);let ve=r.length/3,Ye=g.generateSideWallUV(i,r,ve-6,ve-3,ve-2,ve-1);Ue(Ye[0]),Ue(Ye[1]),Ue(Ye[3]),Ue(Ye[1]),Ue(Ye[2]),Ue(Ye[3])}function dt(ie){r.push(l[ie*3+0]),r.push(l[ie*3+1]),r.push(l[ie*3+2])}function Ue(ie){s.push(ie.x),s.push(ie.y)}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),n=this.parameters.shapes,i=this.parameters.options;return EE(n,i,e)}static fromJSON(e,n){let i=[];for(let s=0,o=e.shapes.length;s<o;s++){let a=n[e.shapes[s]];i.push(a)}let r=e.options.extrudePath;return r!==void 0&&(e.options.extrudePath=new Zm[r.type]().fromJSON(r)),new t(i,e.options)}},wE={generateTopUV:function(t,e,n,i,r){let s=e[n*3],o=e[n*3+1],a=e[i*3],l=e[i*3+1],c=e[r*3],f=e[r*3+1];return[new Te(s,o),new Te(a,l),new Te(c,f)]},generateSideWallUV:function(t,e,n,i,r,s){let o=e[n*3],a=e[n*3+1],l=e[n*3+2],c=e[i*3],f=e[i*3+1],d=e[i*3+2],h=e[r*3],p=e[r*3+1],_=e[r*3+2],y=e[s*3],m=e[s*3+1],u=e[s*3+2];return Math.abs(a-f)<Math.abs(o-c)?[new Te(o,1-l),new Te(c,1-d),new Te(h,1-_),new Te(y,1-u)]:[new Te(a,1-l),new Te(f,1-d),new Te(p,1-_),new Te(m,1-u)]}};function EE(t,e,n){if(n.shapes=[],Array.isArray(t))for(let i=0,r=t.length;i<r;i++){let s=t[i];n.shapes.push(s.uuid)}else n.shapes.push(t.uuid);return n.options=Object.assign({},e),e.extrudePath!==void 0&&(n.options.extrudePath=e.extrudePath.toJSON()),n}var tr=class t extends Zt{constructor(e=1,n=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:n,widthSegments:i,heightSegments:r};let s=e/2,o=n/2,a=Math.floor(i),l=Math.floor(r),c=a+1,f=l+1,d=e/a,h=n/l,p=[],_=[],y=[],m=[];for(let u=0;u<f;u++){let g=u*h-o;for(let v=0;v<c;v++){let S=v*d-s;_.push(S,-g,0),y.push(0,0,1),m.push(v/a),m.push(1-u/l)}}for(let u=0;u<l;u++)for(let g=0;g<a;g++){let v=g+c*u,S=g+c*(u+1),A=g+1+c*(u+1),w=g+1+c*u;p.push(v,S,w),p.push(S,A,w)}this.setIndex(p),this.setAttribute("position",new St(_,3)),this.setAttribute("normal",new St(y,3)),this.setAttribute("uv",new St(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.widthSegments,e.heightSegments)}};var ca=class t extends Zt{constructor(e=1,n=32,i=16,r=0,s=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:n,heightSegments:i,phiStart:r,phiLength:s,thetaStart:o,thetaLength:a},n=Math.max(3,Math.floor(n)),i=Math.max(2,Math.floor(i));let l=Math.min(o+a,Math.PI),c=0,f=[],d=new N,h=new N,p=[],_=[],y=[],m=[];for(let u=0;u<=i;u++){let g=[],v=u/i,S=0;u===0&&o===0?S=.5/n:u===i&&l===Math.PI&&(S=-.5/n);for(let A=0;A<=n;A++){let w=A/n;d.x=-e*Math.cos(r+w*s)*Math.sin(o+v*a),d.y=e*Math.cos(o+v*a),d.z=e*Math.sin(r+w*s)*Math.sin(o+v*a),_.push(d.x,d.y,d.z),h.copy(d).normalize(),y.push(h.x,h.y,h.z),m.push(w+S,1-v),g.push(c++)}f.push(g)}for(let u=0;u<i;u++)for(let g=0;g<n;g++){let v=f[u][g+1],S=f[u][g],A=f[u+1][g],w=f[u+1][g+1];(u!==0||o>0)&&p.push(v,S,w),(u!==i-1||l<Math.PI)&&p.push(S,A,w)}this.setIndex(p),this.setAttribute("position",new St(_,3)),this.setAttribute("normal",new St(y,3)),this.setAttribute("uv",new St(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var Wl=class t extends Zt{constructor(e=1,n=.4,i=12,r=48,s=Math.PI*2,o=0,a=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:n,radialSegments:i,tubularSegments:r,arc:s,thetaStart:o,thetaLength:a},i=Math.floor(i),r=Math.floor(r);let l=[],c=[],f=[],d=[],h=new N,p=new N,_=new N;for(let y=0;y<=i;y++){let m=o+y/i*a;for(let u=0;u<=r;u++){let g=u/r*s;p.x=(e+n*Math.cos(m))*Math.cos(g),p.y=(e+n*Math.cos(m))*Math.sin(g),p.z=n*Math.sin(m),c.push(p.x,p.y,p.z),h.x=e*Math.cos(g),h.y=e*Math.sin(g),_.subVectors(p,h).normalize(),f.push(_.x,_.y,_.z),d.push(u/r),d.push(y/i)}}for(let y=1;y<=i;y++)for(let m=1;m<=r;m++){let u=(r+1)*y+m-1,g=(r+1)*(y-1)+m-1,v=(r+1)*(y-1)+m,S=(r+1)*y+m;l.push(u,g,S),l.push(g,v,S)}this.setIndex(l),this.setAttribute("position",new St(c,3)),this.setAttribute("normal",new St(f,3)),this.setAttribute("uv",new St(d,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}};function eo(t){let e={};for(let n in t){e[n]={};for(let i in t[n]){let r=t[n][i];if(my(r))r.isRenderTargetTexture?(Ze("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[n][i]=null):e[n][i]=r.clone();else if(Array.isArray(r))if(my(r[0])){let s=[];for(let o=0,a=r.length;o<a;o++)s[o]=r[o].clone();e[n][i]=s}else e[n][i]=r.slice();else e[n][i]=r}}return e}function An(t){let e={};for(let n=0;n<t.length;n++){let i=eo(t[n]);for(let r in i)e[r]=i[r]}return e}function my(t){return t&&(t.isColor||t.isMatrix3||t.isMatrix4||t.isVector2||t.isVector3||t.isVector4||t.isTexture||t.isQuaternion)}function TE(t){let e=[];for(let n=0;n<t.length;n++)e.push(t[n].clone());return e}function Ag(t){let e=t.getRenderTarget();return e===null?t.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:xt.workingColorSpace}var lS={clone:eo,merge:An},bE=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,AE=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,si=class extends Rr{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=bE,this.fragmentShader=AE,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=eo(e.uniforms),this.uniformsGroups=TE(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let n=super.toJSON(e);n.glslVersion=this.glslVersion,n.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?n.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?n.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?n.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?n.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?n.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?n.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?n.uniforms[r]={type:"m4",value:o.toArray()}:n.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}},Dh=class extends si{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},Xl=class extends Rr{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new ft(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new ft(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Bf,this.normalScale=new Te(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Li,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var Uh=class extends Rr{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Xy,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Fh=class extends Rr{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function ah(t,e){return!t||t.constructor===e?t:typeof e.BYTES_PER_ELEMENT=="number"?new e(t):Array.prototype.slice.call(t)}var ps=class{constructor(e,n,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let n=this.parameterPositions,i=this._cachedIndex,r=n[i],s=n[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=n[++i],e<r)break t}o=n.length;break n}if(!(e>=s)){let a=n[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=n[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<n[a]?o=a:i=a+1}if(r=n[i],s=n[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let n=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)n[o]=i[s+o];return n}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Oh=class extends ps{constructor(e,n,i,r){super(e,n,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Gm,endingEnd:Gm}}intervalChanged_(e,n,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case Wm:s=e,a=2*n-i;break;case Xm:s=r.length-2,a=n+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case Wm:o=e,l=2*i-n;break;case Xm:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=n}let c=(i-n)*.5,f=this.valueSize;this._weightPrev=c/(n-a),this._weightNext=c/(l-i),this._offsetPrev=s*f,this._offsetNext=o*f}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,f=this._offsetPrev,d=this._offsetNext,h=this._weightPrev,p=this._weightNext,_=(i-n)/(r-n),y=_*_,m=y*_,u=-h*m+2*h*y-h*_,g=(1+h)*m+(-1.5-2*h)*y+(-.5+h)*_+1,v=(-1-p)*m+(1.5+p)*y+.5*_,S=p*m-p*y;for(let A=0;A!==a;++A)s[A]=u*o[f+A]+g*o[c+A]+v*o[l+A]+S*o[d+A];return s}},Bh=class extends ps{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,f=(i-n)/(r-n),d=1-f;for(let h=0;h!==a;++h)s[h]=o[c+h]*d+o[l+h]*f;return s}},kh=class extends ps{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},zh=class extends ps{interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,f=this.settings||this.DefaultSettings_,d=f.inTangents,h=f.outTangents;if(!d||!h){let y=(i-n)/(r-n),m=1-y;for(let u=0;u!==a;++u)s[u]=o[c+u]*m+o[l+u]*y;return s}let p=a*2,_=e-1;for(let y=0;y!==a;++y){let m=o[c+y],u=o[l+y],g=_*p+y*2,v=h[g],S=h[g+1],A=e*p+y*2,w=d[A],C=d[A+1],x=(i-n)/(r-n),b,I,P,F,W;for(let q=0;q<8;q++){b=x*x,I=b*x,P=1-x,F=P*P,W=F*P;let k=W*n+3*F*x*v+3*P*b*w+I*r-i;if(Math.abs(k)<1e-10)break;let z=3*F*(v-n)+6*P*x*(w-v)+3*b*(r-w);if(Math.abs(z)<1e-10)break;x=x-k/z,x=Math.max(0,Math.min(1,x))}s[y]=W*m+3*F*x*S+3*P*b*C+I*u}return s}},oi=class{constructor(e,n,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=ah(n,this.TimeBufferType),this.values=ah(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let n=e.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(e);else{i={name:e.name,times:ah(e.times,Array),values:ah(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new kh(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Bh(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Oh(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let n=new zh(this.times,this.values,this.getValueSize(),e);return this.settings&&(n.settings=this.settings),n}setInterpolation(e){let n;switch(e){case Ml:n=this.InterpolantFactoryMethodDiscrete;break;case Sh:n=this.InterpolantFactoryMethodLinear;break;case uh:n=this.InterpolantFactoryMethodSmooth;break;case Hm:n=this.InterpolantFactoryMethodBezier;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return Ze("KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Ml;case this.InterpolantFactoryMethodLinear:return Sh;case this.InterpolantFactoryMethodSmooth:return uh;case this.InterpolantFactoryMethodBezier:return Hm}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]+=e}return this}scale(e){if(e!==1){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]*=e}return this}trim(e,n){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>n;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(Je("KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(Je("KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){Je("KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){Je("KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&vw(r))for(let a=0,l=r.length;a!==l;++a){let c=r[a];if(isNaN(c)){Je("KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===uh,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,c=e[a],f=e[a+1];if(c!==f&&(a!==1||c!==e[0]))if(r)l=!0;else{let d=a*i,h=d-i,p=d+i;for(let _=0;_!==i;++_){let y=n[d+_];if(y!==n[h+_]||y!==n[p+_]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let d=a*i,h=o*i;for(let p=0;p!==i;++p)n[h+p]=n[d+p]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,c=0;c!==i;++c)n[l+c]=n[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=n.slice(0,o*i)):(this.times=e,this.values=n),this}clone(){let e=this.times.slice(),n=this.values.slice(),i=this.constructor,r=new i(this.name,e,n);return r.createInterpolant=this.createInterpolant,r}};oi.prototype.ValueTypeName="";oi.prototype.TimeBufferType=Float32Array;oi.prototype.ValueBufferType=Float32Array;oi.prototype.DefaultInterpolation=Sh;var ms=class extends oi{constructor(e,n,i){super(e,n,i)}};ms.prototype.ValueTypeName="bool";ms.prototype.ValueBufferType=Array;ms.prototype.DefaultInterpolation=Ml;ms.prototype.InterpolantFactoryMethodLinear=void 0;ms.prototype.InterpolantFactoryMethodSmooth=void 0;var Vh=class extends oi{constructor(e,n,i,r){super(e,n,i,r)}};Vh.prototype.ValueTypeName="color";var Hh=class extends oi{constructor(e,n,i,r){super(e,n,i,r)}};Hh.prototype.ValueTypeName="number";var Gh=class extends ps{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-n)/(r-n),c=e*a;for(let f=c+a;c!==f;c+=4)ji.slerpFlat(s,0,o,c-a,o,c,l);return s}},ql=class extends oi{constructor(e,n,i,r){super(e,n,i,r)}InterpolantFactoryMethodLinear(e){return new Gh(this.times,this.values,this.getValueSize(),e)}};ql.prototype.ValueTypeName="quaternion";ql.prototype.InterpolantFactoryMethodSmooth=void 0;var gs=class extends oi{constructor(e,n,i){super(e,n,i)}};gs.prototype.ValueTypeName="string";gs.prototype.ValueBufferType=Array;gs.prototype.DefaultInterpolation=Ml;gs.prototype.InterpolantFactoryMethodLinear=void 0;gs.prototype.InterpolantFactoryMethodSmooth=void 0;var Wh=class extends oi{constructor(e,n,i,r){super(e,n,i,r)}};Wh.prototype.ValueTypeName="vector";var Xh=class{constructor(e,n,i){let r=this,s=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=n,this.onError=i,this._abortController=null,this.itemStart=function(f){a++,s===!1&&r.onStart!==void 0&&r.onStart(f,o,a),s=!0},this.itemEnd=function(f){o++,r.onProgress!==void 0&&r.onProgress(f,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(f){r.onError!==void 0&&r.onError(f)},this.resolveURL=function(f){return l?l(f):f},this.setURLModifier=function(f){return l=f,this},this.addHandler=function(f,d){return c.push(f,d),this},this.removeHandler=function(f){let d=c.indexOf(f);return d!==-1&&c.splice(d,2),this},this.getHandler=function(f){for(let d=0,h=c.length;d<h;d+=2){let p=c[d],_=c[d+1];if(p.global&&(p.lastIndex=0),p.test(f))return _}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},cS=new Xh,qh=class{constructor(e){this.manager=e!==void 0?e:cS,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,n){let i=this;return new Promise(function(r,s){i.load(e,r,n,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};qh.DEFAULT_MATERIAL_NAME="__DEFAULT";var Yl=class extends rn{constructor(e,n=1){super(),this.isLight=!0,this.type="Light",this.color=new ft(e),this.intensity=n}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,n){return super.copy(e,n),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let n=super.toJSON(e);return n.object.color=this.color.getHex(),n.object.intensity=this.intensity,n}},$l=class extends Yl{constructor(e,n,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(rn.DEFAULT_UP),this.updateMatrix(),this.groundColor=new ft(n)}copy(e,n){return super.copy(e,n),this.groundColor.copy(e.groundColor),this}toJSON(e){let n=super.toJSON(e);return n.object.groundColor=this.groundColor.getHex(),n}},Vm=new At,gy=new N,_y=new N,Qm=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Te(512,512),this.mapType=qn,this.map=null,this.mapPass=null,this.matrix=new At,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ra,this._frameExtents=new Te(1,1),this._viewportCount=1,this._viewports=[new Yt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let n=this.camera,i=this.matrix;gy.setFromMatrixPosition(e.matrixWorld),n.position.copy(gy),_y.setFromMatrixPosition(e.target.matrixWorld),n.lookAt(_y),n.updateMatrixWorld(),Vm.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Vm,n.coordinateSystem,n.reversedDepth),n.coordinateSystem===Jo||n.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(Vm)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},lh=new N,ch=new ji,Yi=new N,Zl=class extends rn{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new At,this.projectionMatrix=new At,this.projectionMatrixInverse=new At,this.coordinateSystem=Ii,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,n){return super.copy(e,n),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(lh,ch,Yi),Yi.x===1&&Yi.y===1&&Yi.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(lh,ch,Yi.set(1,1,1)).invert()}updateWorldMatrix(e,n){super.updateWorldMatrix(e,n),this.matrixWorld.decompose(lh,ch,Yi),Yi.x===1&&Yi.y===1&&Yi.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(lh,ch,Yi.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},cs=new N,vy=new Te,xy=new Te,bn=class extends Zl{constructor(e=50,n=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let n=.5*this.getFilmHeight()/e;this.fov=Qo*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(vl*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Qo*2*Math.atan(Math.tan(vl*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,n,i){cs.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(cs.x,cs.y).multiplyScalar(-e/cs.z),cs.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(cs.x,cs.y).multiplyScalar(-e/cs.z)}getViewSize(e,n){return this.getViewBounds(e,vy,xy),n.subVectors(xy,vy)}setViewOffset(e,n,i,r,s,o){this.aspect=e/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,n=e*Math.tan(vl*.5*this.fov)/this.zoom,i=2*n,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,n-=o.offsetY*i/c,r*=o.width/l,i*=o.height/c}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,n,n-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}};var ua=class extends Zl{constructor(e=-1,n=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=n,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,n,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+n,l=r-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,f=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=f*this.view.offsetY,l=a-f*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}},eg=class extends Qm{constructor(){super(new ua(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Kl=class extends Yl{constructor(e,n){super(e,n),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(rn.DEFAULT_UP),this.updateMatrix(),this.target=new rn,this.shadow=new eg}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let n=super.toJSON(e);return n.object.shadow=this.shadow.toJSON(),n.object.target=this.target.uuid,n}};var Yo=-90,$o=1,Yh=class extends rn{constructor(e,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new bn(Yo,$o,e,n);r.layers=this.layers,this.add(r);let s=new bn(Yo,$o,e,n);s.layers=this.layers,this.add(s);let o=new bn(Yo,$o,e,n);o.layers=this.layers,this.add(o);let a=new bn(Yo,$o,e,n);a.layers=this.layers,this.add(a);let l=new bn(Yo,$o,e,n);l.layers=this.layers,this.add(l);let c=new bn(Yo,$o,e,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,n=this.children.concat(),[i,r,s,o,a,l]=n;for(let c of n)this.remove(c);if(e===Ii)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Jo)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of n)this.add(c),c.updateMatrixWorld()}update(e,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,c,f]=this.children,d=e.getRenderTarget(),h=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),_=e.xr.enabled;e.xr.enabled=!1;let y=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let m=!1;e.isWebGLRenderer===!0?m=e.state.buffers.depth.getReversed():m=e.reversedDepthBuffer,e.setRenderTarget(i,0,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,s),e.setRenderTarget(i,1,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,o),e.setRenderTarget(i,2,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,a),e.setRenderTarget(i,3,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,l),e.setRenderTarget(i,4,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,c),i.texture.generateMipmaps=y,e.setRenderTarget(i,5,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,f),e.setRenderTarget(d,h,p),e.xr.enabled=_,i.texture.needsPMREMUpdate=!0}},$h=class extends bn{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Cg="\\[\\]\\.:\\/",CE=new RegExp("["+Cg+"]","g"),Rg="[^"+Cg+"]",RE="[^"+Cg.replace("\\.","")+"]",PE=/((?:WC+[\/:])*)/.source.replace("WC",Rg),IE=/(WCOD+)?/.source.replace("WCOD",RE),LE=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Rg),NE=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Rg),DE=new RegExp("^"+PE+IE+LE+NE+"$"),UE=["material","materials","bones","map"],tg=class{constructor(e,n,i){let r=i||kt.parseTrackName(n);this._targetGroup=e,this._bindings=e.subscribe_(n,r)}getValue(e,n){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,n)}setValue(e,n){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,n)}bind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].bind()}unbind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].unbind()}},kt=class t{constructor(e,n,i){this.path=n,this.parsedPath=i||t.parseTrackName(n),this.node=t.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,n,i){return e&&e.isAnimationObjectGroup?new t.Composite(e,n,i):new t(e,n,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(CE,"")}static parseTrackName(e){let n=DE.exec(e);if(n===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);UE.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,n){if(n===void 0||n===""||n==="."||n===-1||n===e.name||n===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(n);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===n||a.uuid===n)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,n){e[n]=this.targetObject[this.propertyName]}_getValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[n++]=i[r]}_getValue_arrayElement(e,n){e[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,n){this.resolvedProperty.toArray(e,n)}_setValue_direct(e,n){this.targetObject[this.propertyName]=e[n]}_setValue_direct_setNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++]}_setValue_array_setNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,n){this.resolvedProperty[this.propertyIndex]=e[n]}_setValue_arrayElement_setNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,n){this.resolvedProperty.fromArray(e,n)}_setValue_fromArray_setNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,n){this.bind(),this.getValue(e,n)}_setValue_unbound(e,n){this.bind(),this.setValue(e,n)}bind(){let e=this.node,n=this.parsedPath,i=n.objectName,r=n.propertyName,s=n.propertyIndex;if(e||(e=t.findNode(this.rootNode,n.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Ze("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!e.material){Je("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Je("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Je("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let f=0;f<e.length;f++)if(e[f].name===c){c=f;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Je("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Je("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){Je("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){Je("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[r];if(o===void 0){let c=n.nodeName;Je("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){Je("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Je("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};kt.Composite=tg;kt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};kt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};kt.prototype.GetterByBindingType=[kt.prototype._getValue_direct,kt.prototype._getValue_array,kt.prototype._getValue_arrayElement,kt.prototype._getValue_toArray];kt.prototype.SetterByBindingTypeAndVersioning=[[kt.prototype._setValue_direct,kt.prototype._setValue_direct_setNeedsUpdate,kt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[kt.prototype._setValue_array,kt.prototype._setValue_array_setNeedsUpdate,kt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[kt.prototype._setValue_arrayElement,kt.prototype._setValue_arrayElement_setNeedsUpdate,kt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[kt.prototype._setValue_fromArray,kt.prototype._setValue_fromArray_setNeedsUpdate,kt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var GR=new Float32Array(1);var yy=new At,Js=class{constructor(e,n,i=0,r=1/0){this.ray=new ia(e,n),this.near=i,this.far=r,this.camera=null,this.layers=new ta,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,n){this.ray.set(e,n)}setFromCamera(e,n){n.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(n.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(n).sub(this.ray.origin).normalize(),this.camera=n):n.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(n.near+n.far)/(n.near-n.far)).unproject(n),this.ray.direction.set(0,0,-1).transformDirection(n.matrixWorld),this.camera=n):Je("Raycaster: Unsupported camera type: "+n.type)}setFromXRController(e){return yy.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(yy),this}intersectObject(e,n=!0,i=[]){return ng(e,this,i,n),i.sort(Sy),i}intersectObjects(e,n=!0,i=[]){for(let r=0,s=e.length;r<s;r++)ng(e[r],this,i,n);return i.sort(Sy),i}};function Sy(t,e){return t.distance-e.distance}function ng(t,e,n,i){let r=!0;if(t.layers.test(e.layers)&&t.raycast(e,n)===!1&&(r=!1),r===!0&&i===!0){let s=t.children;for(let o=0,a=s.length;o<a;o++)ng(s[o],e,n,!0)}}var Ug=class Ug{constructor(e,n,i,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,n,i,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,n=0){for(let i=0;i<4;i++)this.elements[i]=e[i+n];return this}set(e,n,i,r){let s=this.elements;return s[0]=e,s[2]=n,s[1]=i,s[3]=r,this}};Ug.prototype.isMatrix2=!0;var ig=Ug;function Pg(t,e,n,i){let r=FE(i);switch(n){case yg:return t*e;case Mg:return t*e/r.components*r.byteLength;case sf:return t*e/r.components*r.byteLength;case ys:return t*e*2/r.components*r.byteLength;case of:return t*e*2/r.components*r.byteLength;case Sg:return t*e*3/r.components*r.byteLength;case vi:return t*e*4/r.components*r.byteLength;case af:return t*e*4/r.components*r.byteLength;case tc:case nc:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case ic:case rc:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case cf:case hf:return Math.max(t,16)*Math.max(e,8)/4;case lf:case uf:return Math.max(t,8)*Math.max(e,8)/2;case ff:case df:case mf:case gf:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case pf:case sc:case _f:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case vf:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case xf:return Math.floor((t+4)/5)*Math.floor((e+3)/4)*16;case yf:return Math.floor((t+4)/5)*Math.floor((e+4)/5)*16;case Sf:return Math.floor((t+5)/6)*Math.floor((e+4)/5)*16;case Mf:return Math.floor((t+5)/6)*Math.floor((e+5)/6)*16;case wf:return Math.floor((t+7)/8)*Math.floor((e+4)/5)*16;case Ef:return Math.floor((t+7)/8)*Math.floor((e+5)/6)*16;case Tf:return Math.floor((t+7)/8)*Math.floor((e+7)/8)*16;case bf:return Math.floor((t+9)/10)*Math.floor((e+4)/5)*16;case Af:return Math.floor((t+9)/10)*Math.floor((e+5)/6)*16;case Cf:return Math.floor((t+9)/10)*Math.floor((e+7)/8)*16;case Rf:return Math.floor((t+9)/10)*Math.floor((e+9)/10)*16;case Pf:return Math.floor((t+11)/12)*Math.floor((e+9)/10)*16;case If:return Math.floor((t+11)/12)*Math.floor((e+11)/12)*16;case Lf:case Nf:case Df:return Math.ceil(t/4)*Math.ceil(e/4)*16;case Uf:case Ff:return Math.ceil(t/4)*Math.ceil(e/4)*8;case oc:case Of:return Math.ceil(t/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function FE(t){switch(t){case qn:case gg:return{byteLength:1,components:1};case fa:case _g:case rr:return{byteLength:2,components:1};case nf:case rf:return{byteLength:2,components:4};case Di:case tf:case Ui:return{byteLength:4,components:1};case vg:case xg:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${t}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Kh}}));typeof window<"u"&&(window.__THREE__?Ze("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Kh);function LS(){let t=null,e=!1,n=null,i=null;function r(s,o){n(s,o),i=t.requestAnimationFrame(r)}return{start:function(){e!==!0&&n!==null&&t!==null&&(i=t.requestAnimationFrame(r),e=!0)},stop:function(){t!==null&&t.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){n=s},setContext:function(s){t=s}}}function OE(t){let e=new WeakMap;function n(a,l){let c=a.array,f=a.usage,d=c.byteLength,h=t.createBuffer();t.bindBuffer(l,h),t.bufferData(l,c,f),a.onUploadCallback();let p;if(c instanceof Float32Array)p=t.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)p=t.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?p=t.HALF_FLOAT:p=t.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=t.SHORT;else if(c instanceof Uint32Array)p=t.UNSIGNED_INT;else if(c instanceof Int32Array)p=t.INT;else if(c instanceof Int8Array)p=t.BYTE;else if(c instanceof Uint8Array)p=t.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=t.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:h,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:d}}function i(a,l,c){let f=l.array,d=l.updateRanges;if(t.bindBuffer(c,a),d.length===0)t.bufferSubData(c,0,f);else{d.sort((p,_)=>p.start-_.start);let h=0;for(let p=1;p<d.length;p++){let _=d[h],y=d[p];y.start<=_.start+_.count+1?_.count=Math.max(_.count,y.start+y.count-_.start):(++h,d[h]=y)}d.length=h+1;for(let p=0,_=d.length;p<_;p++){let y=d[p];t.bufferSubData(c,y.start*f.BYTES_PER_ELEMENT,f,y.start,y.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(t.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let f=e.get(a);(!f||f.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=e.get(a);if(c===void 0)e.set(a,n(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}var BE=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,kE=`#ifdef USE_ALPHAHASH
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
#endif`,zE=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,VE=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,HE=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,GE=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,WE=`#ifdef USE_AOMAP
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
#endif`,XE=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,qE=`#ifdef USE_BATCHING
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
#endif`,YE=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,$E=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,ZE=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,KE=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,JE=`#ifdef USE_IRIDESCENCE
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
#endif`,jE=`#ifdef USE_BUMPMAP
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
#endif`,QE=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,eT=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,tT=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,nT=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,iT=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,rT=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,sT=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,oT=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,aT=`#define PI 3.141592653589793
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
} // validated`,lT=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,cT=`vec3 transformedNormal = objectNormal;
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
#endif`,uT=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,hT=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,fT=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,dT=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,pT="gl_FragColor = linearToOutputTexel( gl_FragColor );",mT=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,gT=`#ifdef USE_ENVMAP
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
#endif`,_T=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,vT=`#ifdef USE_ENVMAP
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
#endif`,xT=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,yT=`#ifdef USE_ENVMAP
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
#endif`,ST=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,MT=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,wT=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,ET=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,TT=`#ifdef USE_GRADIENTMAP
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
}`,bT=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,AT=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,CT=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,RT=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,PT=`#ifdef USE_ENVMAP
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
#endif`,IT=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,LT=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,NT=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,DT=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,UT=`PhysicalMaterial material;
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
#endif`,FT=`uniform sampler2D dfgLUT;
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
}`,OT=`
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
#endif`,BT=`#if defined( RE_IndirectDiffuse )
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
#endif`,kT=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,zT=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,VT=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,HT=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,GT=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,WT=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,XT=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,qT=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,YT=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,$T=`#if defined( USE_POINTS_UV )
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
#endif`,ZT=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,KT=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,JT=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,jT=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,QT=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,eb=`#ifdef USE_MORPHTARGETS
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
#endif`,tb=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,nb=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,ib=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,rb=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,sb=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,ob=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,ab=`#ifdef USE_NORMALMAP
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
#endif`,lb=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,cb=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,ub=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,hb=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,fb=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,db=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,pb=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,mb=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,gb=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,_b=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,vb=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,xb=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,yb=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Sb=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Mb=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,wb=`float getShadowMask() {
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
}`,Eb=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Tb=`#ifdef USE_SKINNING
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
#endif`,bb=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Ab=`#ifdef USE_SKINNING
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
#endif`,Cb=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Rb=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Pb=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Ib=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Lb=`#ifdef USE_TRANSMISSION
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
#endif`,Nb=`#ifdef USE_TRANSMISSION
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
#endif`,Db=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Ub=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Fb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Ob=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,Bb=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,kb=`uniform sampler2D t2D;
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
}`,zb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Vb=`#ifdef ENVMAP_TYPE_CUBE
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
}`,Hb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Gb=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Wb=`#include <common>
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
}`,Xb=`#if DEPTH_PACKING == 3200
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
}`,qb=`#define DISTANCE
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
}`,Yb=`#define DISTANCE
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
}`,$b=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Zb=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Kb=`uniform float scale;
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
}`,Jb=`uniform vec3 diffuse;
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
}`,jb=`#include <common>
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
}`,Qb=`uniform vec3 diffuse;
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
}`,eA=`#define LAMBERT
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
}`,tA=`#define LAMBERT
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
}`,nA=`#define MATCAP
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
}`,iA=`#define MATCAP
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
}`,rA=`#define NORMAL
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
}`,sA=`#define NORMAL
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
}`,oA=`#define PHONG
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
}`,aA=`#define PHONG
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
}`,lA=`#define STANDARD
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
}`,cA=`#define STANDARD
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
}`,uA=`#define TOON
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
}`,hA=`#define TOON
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
}`,fA=`uniform float size;
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
}`,dA=`uniform vec3 diffuse;
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
}`,pA=`#include <common>
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
}`,mA=`uniform vec3 color;
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
}`,gA=`uniform float rotation;
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
}`,_A=`uniform vec3 diffuse;
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
}`,ht={alphahash_fragment:BE,alphahash_pars_fragment:kE,alphamap_fragment:zE,alphamap_pars_fragment:VE,alphatest_fragment:HE,alphatest_pars_fragment:GE,aomap_fragment:WE,aomap_pars_fragment:XE,batching_pars_vertex:qE,batching_vertex:YE,begin_vertex:$E,beginnormal_vertex:ZE,bsdfs:KE,iridescence_fragment:JE,bumpmap_pars_fragment:jE,clipping_planes_fragment:QE,clipping_planes_pars_fragment:eT,clipping_planes_pars_vertex:tT,clipping_planes_vertex:nT,color_fragment:iT,color_pars_fragment:rT,color_pars_vertex:sT,color_vertex:oT,common:aT,cube_uv_reflection_fragment:lT,defaultnormal_vertex:cT,displacementmap_pars_vertex:uT,displacementmap_vertex:hT,emissivemap_fragment:fT,emissivemap_pars_fragment:dT,colorspace_fragment:pT,colorspace_pars_fragment:mT,envmap_fragment:gT,envmap_common_pars_fragment:_T,envmap_pars_fragment:vT,envmap_pars_vertex:xT,envmap_physical_pars_fragment:PT,envmap_vertex:yT,fog_vertex:ST,fog_pars_vertex:MT,fog_fragment:wT,fog_pars_fragment:ET,gradientmap_pars_fragment:TT,lightmap_pars_fragment:bT,lights_lambert_fragment:AT,lights_lambert_pars_fragment:CT,lights_pars_begin:RT,lights_toon_fragment:IT,lights_toon_pars_fragment:LT,lights_phong_fragment:NT,lights_phong_pars_fragment:DT,lights_physical_fragment:UT,lights_physical_pars_fragment:FT,lights_fragment_begin:OT,lights_fragment_maps:BT,lights_fragment_end:kT,lightprobes_pars_fragment:zT,logdepthbuf_fragment:VT,logdepthbuf_pars_fragment:HT,logdepthbuf_pars_vertex:GT,logdepthbuf_vertex:WT,map_fragment:XT,map_pars_fragment:qT,map_particle_fragment:YT,map_particle_pars_fragment:$T,metalnessmap_fragment:ZT,metalnessmap_pars_fragment:KT,morphinstance_vertex:JT,morphcolor_vertex:jT,morphnormal_vertex:QT,morphtarget_pars_vertex:eb,morphtarget_vertex:tb,normal_fragment_begin:nb,normal_fragment_maps:ib,normal_pars_fragment:rb,normal_pars_vertex:sb,normal_vertex:ob,normalmap_pars_fragment:ab,clearcoat_normal_fragment_begin:lb,clearcoat_normal_fragment_maps:cb,clearcoat_pars_fragment:ub,iridescence_pars_fragment:hb,opaque_fragment:fb,packing:db,premultiplied_alpha_fragment:pb,project_vertex:mb,dithering_fragment:gb,dithering_pars_fragment:_b,roughnessmap_fragment:vb,roughnessmap_pars_fragment:xb,shadowmap_pars_fragment:yb,shadowmap_pars_vertex:Sb,shadowmap_vertex:Mb,shadowmask_pars_fragment:wb,skinbase_vertex:Eb,skinning_pars_vertex:Tb,skinning_vertex:bb,skinnormal_vertex:Ab,specularmap_fragment:Cb,specularmap_pars_fragment:Rb,tonemapping_fragment:Pb,tonemapping_pars_fragment:Ib,transmission_fragment:Lb,transmission_pars_fragment:Nb,uv_pars_fragment:Db,uv_pars_vertex:Ub,uv_vertex:Fb,worldpos_vertex:Ob,background_vert:Bb,background_frag:kb,backgroundCube_vert:zb,backgroundCube_frag:Vb,cube_vert:Hb,cube_frag:Gb,depth_vert:Wb,depth_frag:Xb,distance_vert:qb,distance_frag:Yb,equirect_vert:$b,equirect_frag:Zb,linedashed_vert:Kb,linedashed_frag:Jb,meshbasic_vert:jb,meshbasic_frag:Qb,meshlambert_vert:eA,meshlambert_frag:tA,meshmatcap_vert:nA,meshmatcap_frag:iA,meshnormal_vert:rA,meshnormal_frag:sA,meshphong_vert:oA,meshphong_frag:aA,meshphysical_vert:lA,meshphysical_frag:cA,meshtoon_vert:uA,meshtoon_frag:hA,points_vert:fA,points_frag:dA,shadow_vert:pA,shadow_frag:mA,sprite_vert:gA,sprite_frag:_A},be={common:{diffuse:{value:new ft(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new rt},alphaMap:{value:null},alphaMapTransform:{value:new rt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new rt}},envmap:{envMap:{value:null},envMapRotation:{value:new rt},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new rt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new rt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new rt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new rt},normalScale:{value:new Te(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new rt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new rt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new rt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new rt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new ft(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new N},probesMax:{value:new N},probesResolution:{value:new N}},points:{diffuse:{value:new ft(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new rt},alphaTest:{value:0},uvTransform:{value:new rt}},sprite:{diffuse:{value:new ft(16777215)},opacity:{value:1},center:{value:new Te(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new rt},alphaMap:{value:null},alphaMapTransform:{value:new rt},alphaTest:{value:0}}},or={basic:{uniforms:An([be.common,be.specularmap,be.envmap,be.aomap,be.lightmap,be.fog]),vertexShader:ht.meshbasic_vert,fragmentShader:ht.meshbasic_frag},lambert:{uniforms:An([be.common,be.specularmap,be.envmap,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.fog,be.lights,{emissive:{value:new ft(0)},envMapIntensity:{value:1}}]),vertexShader:ht.meshlambert_vert,fragmentShader:ht.meshlambert_frag},phong:{uniforms:An([be.common,be.specularmap,be.envmap,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.fog,be.lights,{emissive:{value:new ft(0)},specular:{value:new ft(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:ht.meshphong_vert,fragmentShader:ht.meshphong_frag},standard:{uniforms:An([be.common,be.envmap,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.roughnessmap,be.metalnessmap,be.fog,be.lights,{emissive:{value:new ft(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:ht.meshphysical_vert,fragmentShader:ht.meshphysical_frag},toon:{uniforms:An([be.common,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.gradientmap,be.fog,be.lights,{emissive:{value:new ft(0)}}]),vertexShader:ht.meshtoon_vert,fragmentShader:ht.meshtoon_frag},matcap:{uniforms:An([be.common,be.bumpmap,be.normalmap,be.displacementmap,be.fog,{matcap:{value:null}}]),vertexShader:ht.meshmatcap_vert,fragmentShader:ht.meshmatcap_frag},points:{uniforms:An([be.points,be.fog]),vertexShader:ht.points_vert,fragmentShader:ht.points_frag},dashed:{uniforms:An([be.common,be.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:ht.linedashed_vert,fragmentShader:ht.linedashed_frag},depth:{uniforms:An([be.common,be.displacementmap]),vertexShader:ht.depth_vert,fragmentShader:ht.depth_frag},normal:{uniforms:An([be.common,be.bumpmap,be.normalmap,be.displacementmap,{opacity:{value:1}}]),vertexShader:ht.meshnormal_vert,fragmentShader:ht.meshnormal_frag},sprite:{uniforms:An([be.sprite,be.fog]),vertexShader:ht.sprite_vert,fragmentShader:ht.sprite_frag},background:{uniforms:{uvTransform:{value:new rt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:ht.background_vert,fragmentShader:ht.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new rt}},vertexShader:ht.backgroundCube_vert,fragmentShader:ht.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:ht.cube_vert,fragmentShader:ht.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:ht.equirect_vert,fragmentShader:ht.equirect_frag},distance:{uniforms:An([be.common,be.displacementmap,{referencePosition:{value:new N},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:ht.distance_vert,fragmentShader:ht.distance_frag},shadow:{uniforms:An([be.lights,be.fog,{color:{value:new ft(0)},opacity:{value:1}}]),vertexShader:ht.shadow_vert,fragmentShader:ht.shadow_frag}};or.physical={uniforms:An([or.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new rt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new rt},clearcoatNormalScale:{value:new Te(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new rt},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new rt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new rt},sheen:{value:0},sheenColor:{value:new ft(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new rt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new rt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new rt},transmissionSamplerSize:{value:new Te},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new rt},attenuationDistance:{value:0},attenuationColor:{value:new ft(0)},specularColor:{value:new ft(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new rt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new rt},anisotropyVector:{value:new Te},anisotropyMap:{value:null},anisotropyMapTransform:{value:new rt}}]),vertexShader:ht.meshphysical_vert,fragmentShader:ht.meshphysical_frag};var Vf={r:0,b:0,g:0},vA=new At,NS=new rt;NS.set(-1,0,0,0,1,0,0,0,1);function xA(t,e,n,i,r,s){let o=new ft(0),a=r===!0?0:1,l,c,f=null,d=0,h=null;function p(g){let v=g.isScene===!0?g.background:null;if(v&&v.isTexture){let S=g.backgroundBlurriness>0;v=e.get(v,S)}return v}function _(g){let v=!1,S=p(g);S===null?m(o,a):S&&S.isColor&&(m(S,1),v=!0);let A=t.xr.getEnvironmentBlendMode();A==="additive"?n.buffers.color.setClear(0,0,0,1,s):A==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,s),(t.autoClear||v)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),t.clear(t.autoClearColor,t.autoClearDepth,t.autoClearStencil))}function y(g,v){let S=p(v);S&&(S.isCubeTexture||S.mapping===Ql)?(c===void 0&&(c=new Vt(new ds(1,1,1),new si({name:"BackgroundCubeMaterial",uniforms:eo(or.backgroundCube.uniforms),vertexShader:or.backgroundCube.vertexShader,fragmentShader:or.backgroundCube.fragmentShader,side:Bn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(A,w,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(c)),c.material.uniforms.envMap.value=S,c.material.uniforms.backgroundBlurriness.value=v.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(vA.makeRotationFromEuler(v.backgroundRotation)).transpose(),S.isCubeTexture&&S.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(NS),c.material.toneMapped=xt.getTransfer(S.colorSpace)!==Rt,(f!==S||d!==S.version||h!==t.toneMapping)&&(c.material.needsUpdate=!0,f=S,d=S.version,h=t.toneMapping),c.layers.enableAll(),g.unshift(c,c.geometry,c.material,0,0,null)):S&&S.isTexture&&(l===void 0&&(l=new Vt(new tr(2,2),new si({name:"BackgroundMaterial",uniforms:eo(or.background.uniforms),vertexShader:or.background.vertexShader,fragmentShader:or.background.fragmentShader,side:Cr,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=S,l.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,l.material.toneMapped=xt.getTransfer(S.colorSpace)!==Rt,S.matrixAutoUpdate===!0&&S.updateMatrix(),l.material.uniforms.uvTransform.value.copy(S.matrix),(f!==S||d!==S.version||h!==t.toneMapping)&&(l.material.needsUpdate=!0,f=S,d=S.version,h=t.toneMapping),l.layers.enableAll(),g.unshift(l,l.geometry,l.material,0,0,null))}function m(g,v){g.getRGB(Vf,Ag(t)),n.buffers.color.setClear(Vf.r,Vf.g,Vf.b,v,s)}function u(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(g,v=1){o.set(g),a=v,m(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(g){a=g,m(o,a)},render:_,addToRenderList:y,dispose:u}}function yA(t,e){let n=t.getParameter(t.MAX_VERTEX_ATTRIBS),i={},r=h(null),s=r,o=!1;function a(P,F,W,q,U){let k=!1,z=d(P,q,W,F);s!==z&&(s=z,c(s.object)),k=p(P,q,W,U),k&&_(P,q,W,U),U!==null&&e.update(U,t.ELEMENT_ARRAY_BUFFER),(k||o)&&(o=!1,S(P,F,W,q),U!==null&&t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,e.get(U).buffer))}function l(){return t.createVertexArray()}function c(P){return t.bindVertexArray(P)}function f(P){return t.deleteVertexArray(P)}function d(P,F,W,q){let U=q.wireframe===!0,k=i[F.id];k===void 0&&(k={},i[F.id]=k);let z=P.isInstancedMesh===!0?P.id:0,ne=k[z];ne===void 0&&(ne={},k[z]=ne);let le=ne[W.id];le===void 0&&(le={},ne[W.id]=le);let me=le[U];return me===void 0&&(me=h(l()),le[U]=me),me}function h(P){let F=[],W=[],q=[];for(let U=0;U<n;U++)F[U]=0,W[U]=0,q[U]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:F,enabledAttributes:W,attributeDivisors:q,object:P,attributes:{},index:null}}function p(P,F,W,q){let U=s.attributes,k=F.attributes,z=0,ne=W.getAttributes();for(let le in ne)if(ne[le].location>=0){let Ce=U[le],Be=k[le];if(Be===void 0&&(le==="instanceMatrix"&&P.instanceMatrix&&(Be=P.instanceMatrix),le==="instanceColor"&&P.instanceColor&&(Be=P.instanceColor)),Ce===void 0||Ce.attribute!==Be||Be&&Ce.data!==Be.data)return!0;z++}return s.attributesNum!==z||s.index!==q}function _(P,F,W,q){let U={},k=F.attributes,z=0,ne=W.getAttributes();for(let le in ne)if(ne[le].location>=0){let Ce=k[le];Ce===void 0&&(le==="instanceMatrix"&&P.instanceMatrix&&(Ce=P.instanceMatrix),le==="instanceColor"&&P.instanceColor&&(Ce=P.instanceColor));let Be={};Be.attribute=Ce,Ce&&Ce.data&&(Be.data=Ce.data),U[le]=Be,z++}s.attributes=U,s.attributesNum=z,s.index=q}function y(){let P=s.newAttributes;for(let F=0,W=P.length;F<W;F++)P[F]=0}function m(P){u(P,0)}function u(P,F){let W=s.newAttributes,q=s.enabledAttributes,U=s.attributeDivisors;W[P]=1,q[P]===0&&(t.enableVertexAttribArray(P),q[P]=1),U[P]!==F&&(t.vertexAttribDivisor(P,F),U[P]=F)}function g(){let P=s.newAttributes,F=s.enabledAttributes;for(let W=0,q=F.length;W<q;W++)F[W]!==P[W]&&(t.disableVertexAttribArray(W),F[W]=0)}function v(P,F,W,q,U,k,z){z===!0?t.vertexAttribIPointer(P,F,W,U,k):t.vertexAttribPointer(P,F,W,q,U,k)}function S(P,F,W,q){y();let U=q.attributes,k=W.getAttributes(),z=F.defaultAttributeValues;for(let ne in k){let le=k[ne];if(le.location>=0){let me=U[ne];if(me===void 0&&(ne==="instanceMatrix"&&P.instanceMatrix&&(me=P.instanceMatrix),ne==="instanceColor"&&P.instanceColor&&(me=P.instanceColor)),me!==void 0){let Ce=me.normalized,Be=me.itemSize,Qe=e.get(me);if(Qe===void 0)continue;let vt=Qe.buffer,et=Qe.type,te=Qe.bytesPerElement,ye=et===t.INT||et===t.UNSIGNED_INT||me.gpuType===tf;if(me.isInterleavedBufferAttribute){let ce=me.data,Ve=ce.stride,qe=me.offset;if(ce.isInstancedInterleavedBuffer){for(let $e=0;$e<le.locationSize;$e++)u(le.location+$e,ce.meshPerAttribute);P.isInstancedMesh!==!0&&q._maxInstanceCount===void 0&&(q._maxInstanceCount=ce.meshPerAttribute*ce.count)}else for(let $e=0;$e<le.locationSize;$e++)m(le.location+$e);t.bindBuffer(t.ARRAY_BUFFER,vt);for(let $e=0;$e<le.locationSize;$e++)v(le.location+$e,Be/le.locationSize,et,Ce,Ve*te,(qe+Be/le.locationSize*$e)*te,ye)}else{if(me.isInstancedBufferAttribute){for(let ce=0;ce<le.locationSize;ce++)u(le.location+ce,me.meshPerAttribute);P.isInstancedMesh!==!0&&q._maxInstanceCount===void 0&&(q._maxInstanceCount=me.meshPerAttribute*me.count)}else for(let ce=0;ce<le.locationSize;ce++)m(le.location+ce);t.bindBuffer(t.ARRAY_BUFFER,vt);for(let ce=0;ce<le.locationSize;ce++)v(le.location+ce,Be/le.locationSize,et,Ce,Be*te,Be/le.locationSize*ce*te,ye)}}else if(z!==void 0){let Ce=z[ne];if(Ce!==void 0)switch(Ce.length){case 2:t.vertexAttrib2fv(le.location,Ce);break;case 3:t.vertexAttrib3fv(le.location,Ce);break;case 4:t.vertexAttrib4fv(le.location,Ce);break;default:t.vertexAttrib1fv(le.location,Ce)}}}}g()}function A(){b();for(let P in i){let F=i[P];for(let W in F){let q=F[W];for(let U in q){let k=q[U];for(let z in k)f(k[z].object),delete k[z];delete q[U]}}delete i[P]}}function w(P){if(i[P.id]===void 0)return;let F=i[P.id];for(let W in F){let q=F[W];for(let U in q){let k=q[U];for(let z in k)f(k[z].object),delete k[z];delete q[U]}}delete i[P.id]}function C(P){for(let F in i){let W=i[F];for(let q in W){let U=W[q];if(U[P.id]===void 0)continue;let k=U[P.id];for(let z in k)f(k[z].object),delete k[z];delete U[P.id]}}}function x(P){for(let F in i){let W=i[F],q=P.isInstancedMesh===!0?P.id:0,U=W[q];if(U!==void 0){for(let k in U){let z=U[k];for(let ne in z)f(z[ne].object),delete z[ne];delete U[k]}delete W[q],Object.keys(W).length===0&&delete i[F]}}}function b(){I(),o=!0,s!==r&&(s=r,c(s.object))}function I(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:b,resetDefaultState:I,dispose:A,releaseStatesOfGeometry:w,releaseStatesOfObject:x,releaseStatesOfProgram:C,initAttributes:y,enableAttribute:m,disableUnusedAttributes:g}}function SA(t,e,n){let i;function r(l){i=l}function s(l,c){t.drawArrays(i,l,c),n.update(c,i,1)}function o(l,c,f){f!==0&&(t.drawArraysInstanced(i,l,c,f),n.update(c,i,f))}function a(l,c,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,c,0,f);let h=0;for(let p=0;p<f;p++)h+=c[p];n.update(h,i,1)}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a}function MA(t,e,n,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let C=e.get("EXT_texture_filter_anisotropic");r=t.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(C){return!(C!==vi&&i.convert(C)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(C){let x=C===rr&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==qn&&i.convert(C)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==Ui&&!x)}function l(C){if(C==="highp"){if(t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.HIGH_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.MEDIUM_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",f=l(c);f!==c&&(Ze("WebGLRenderer:",c,"not supported, using",f,"instead."),c=f);let d=n.logarithmicDepthBuffer===!0,h=n.reversedDepthBuffer===!0&&e.has("EXT_clip_control");n.reversedDepthBuffer===!0&&h===!1&&Ze("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let p=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),_=t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),y=t.getParameter(t.MAX_TEXTURE_SIZE),m=t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),u=t.getParameter(t.MAX_VERTEX_ATTRIBS),g=t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),v=t.getParameter(t.MAX_VARYING_VECTORS),S=t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),A=t.getParameter(t.MAX_SAMPLES),w=t.getParameter(t.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:d,reversedDepthBuffer:h,maxTextures:p,maxVertexTextures:_,maxTextureSize:y,maxCubemapSize:m,maxAttributes:u,maxVertexUniforms:g,maxVaryings:v,maxFragmentUniforms:S,maxSamples:A,samples:w}}function wA(t){let e=this,n=null,i=0,r=!1,s=!1,o=new $i,a=new rt,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,h){let p=d.length!==0||h||i!==0||r;return r=h,i=d.length,p},this.beginShadows=function(){s=!0,f(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(d,h){n=f(d,h,0)},this.setState=function(d,h,p){let _=d.clippingPlanes,y=d.clipIntersection,m=d.clipShadows,u=t.get(d);if(!r||_===null||_.length===0||s&&!m)s?f(null):c();else{let g=s?0:i,v=g*4,S=u.clippingState||null;l.value=S,S=f(_,h,v,p);for(let A=0;A!==v;++A)S[A]=n[A];u.clippingState=S,this.numIntersection=y?this.numPlanes:0,this.numPlanes+=g}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function f(d,h,p,_){let y=d!==null?d.length:0,m=null;if(y!==0){if(m=l.value,_!==!0||m===null){let u=p+y*4,g=h.matrixWorldInverse;a.getNormalMatrix(g),(m===null||m.length<u)&&(m=new Float32Array(u));for(let v=0,S=p;v!==y;++v,S+=4)o.copy(d[v]).applyMatrix4(g,a),o.normal.toArray(m,S),m[S+3]=o.constant}l.value=m,l.needsUpdate=!0}return e.numPlanes=y,e.numIntersection=0,m}}var Ss=4,uS=[.125,.215,.35,.446,.526,.582],to=20,EA=256,ac=new ua,hS=new ft,Fg=null,Og=0,Bg=0,kg=!1,TA=new N,Gf=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,n=0,i=.1,r=100,s={}){let{size:o=256,position:a=TA}=s;Fg=this._renderer.getRenderTarget(),Og=this._renderer.getActiveCubeFace(),Bg=this._renderer.getActiveMipmapLevel(),kg=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,n=null){return this._fromTexture(e,n)}fromCubemap(e,n=null){return this._fromTexture(e,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=pS(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=dS(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(Fg,Og,Bg),this._renderer.xr.enabled=kg,e.scissorTest=!1,pa(e,0,0,e.width,e.height)}_fromTexture(e,n){e.mapping===_s||e.mapping===js?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Fg=this._renderer.getRenderTarget(),Og=this._renderer.getActiveCubeFace(),Bg=this._renderer.getActiveMipmapLevel(),kg=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:_n,minFilter:_n,generateMipmaps:!1,type:rr,format:vi,colorSpace:wl,depthBuffer:!1},r=fS(e,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=fS(e,n,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=bA(s)),this._blurMaterial=CA(s,e,n),this._ggxMaterial=AA(s,e,n)}return r}_compileMaterial(e){let n=new Vt(new Zt,e);this._renderer.compile(n,ac)}_sceneToCubeUV(e,n,i,r,s){let l=new bn(90,1,n,i),c=[1,-1,1,1,1,1],f=[1,1,1,-1,-1,-1],d=this._renderer,h=d.autoClear,p=d.toneMapping;d.getClearColor(hS),d.toneMapping=Ni,d.autoClear=!1,d.state.buffers.depth.getReversed()&&(d.setRenderTarget(r),d.clearDepth(),d.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Vt(new ds,new Qi({name:"PMREM.Background",side:Bn,depthWrite:!1,depthTest:!1})));let y=this._backgroundBox,m=y.material,u=!1,g=e.background;g?g.isColor&&(m.color.copy(g),e.background=null,u=!0):(m.color.copy(hS),u=!0);for(let v=0;v<6;v++){let S=v%3;S===0?(l.up.set(0,c[v],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+f[v],s.y,s.z)):S===1?(l.up.set(0,0,c[v]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+f[v],s.z)):(l.up.set(0,c[v],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+f[v]));let A=this._cubeSize;pa(r,S*A,v>2?A:0,A,A),d.setRenderTarget(r),u&&d.render(y,l),d.render(e,l)}d.toneMapping=p,d.autoClear=h,e.background=g}_textureToCubeUV(e,n){let i=this._renderer,r=e.mapping===_s||e.mapping===js;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=pS()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=dS());let s=r?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=s;let a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;pa(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(o,ac)}_applyPMREM(e){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);n.autoClear=i}_applyGGXFilter(e,n,i){let r=this._renderer,s=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[i];a.material=o;let l=o.uniforms,c=i/(this._lodMeshes.length-1),f=n/(this._lodMeshes.length-1),d=Math.sqrt(c*c-f*f),h=0+c*1.25,p=d*h,{_lodMax:_}=this,y=this._sizeLods[i],m=3*y*(i>_-Ss?i-_+Ss:0),u=4*(this._cubeSize-y);l.envMap.value=e.texture,l.roughness.value=p,l.mipInt.value=_-n,pa(s,m,u,3*y,2*y),r.setRenderTarget(s),r.render(a,ac),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=_-i,pa(e,m,u,3*y,2*y),r.setRenderTarget(e),r.render(a,ac)}_blur(e,n,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,n,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,n,i,r,s,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&Je("blur direction must be either latitudinal or longitudinal!");let f=3,d=this._lodMeshes[r];d.material=c;let h=c.uniforms,p=this._sizeLods[i]-1,_=isFinite(s)?Math.PI/(2*p):2*Math.PI/(2*to-1),y=s/_,m=isFinite(s)?1+Math.floor(f*y):to;m>to&&Ze(`sigmaRadians, ${s}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${to}`);let u=[],g=0;for(let C=0;C<to;++C){let x=C/y,b=Math.exp(-x*x/2);u.push(b),C===0?g+=b:C<m&&(g+=2*b)}for(let C=0;C<u.length;C++)u[C]=u[C]/g;h.envMap.value=e.texture,h.samples.value=m,h.weights.value=u,h.latitudinal.value=o==="latitudinal",a&&(h.poleAxis.value=a);let{_lodMax:v}=this;h.dTheta.value=_,h.mipInt.value=v-i;let S=this._sizeLods[r],A=3*S*(r>v-Ss?r-v+Ss:0),w=4*(this._cubeSize-S);pa(n,A,w,3*S,2*S),l.setRenderTarget(n),l.render(d,ac)}};function bA(t){let e=[],n=[],i=[],r=t,s=t-Ss+1+uS.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);e.push(a);let l=1/a;o>t-Ss?l=uS[o-t+Ss-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),f=-c,d=1+c,h=[f,f,d,f,d,d,f,f,d,d,f,d],p=6,_=6,y=3,m=2,u=1,g=new Float32Array(y*_*p),v=new Float32Array(m*_*p),S=new Float32Array(u*_*p);for(let w=0;w<p;w++){let C=w%3*2/3-1,x=w>2?0:-1,b=[C,x,0,C+2/3,x,0,C+2/3,x+1,0,C,x,0,C+2/3,x+1,0,C,x+1,0];g.set(b,y*_*w),v.set(h,m*_*w);let I=[w,w,w,w,w,w];S.set(I,u*_*w)}let A=new Zt;A.setAttribute("position",new Fn(g,y)),A.setAttribute("uv",new Fn(v,m)),A.setAttribute("faceIndex",new Fn(S,u)),i.push(new Vt(A,null)),r>Ss&&r--}return{lodMeshes:i,sizeLods:e,sigmas:n}}function fS(t,e,n){let i=new ii(t,e,n);return i.texture.mapping=Ql,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function pa(t,e,n,i,r){t.viewport.set(e,n,i,r),t.scissor.set(e,n,i,r)}function AA(t,e,n){return new si({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:EA,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:qf(),fragmentShader:`

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
		`,blending:ir,depthTest:!1,depthWrite:!1})}function CA(t,e,n){let i=new Float32Array(to),r=new N(0,1,0);return new si({name:"SphericalGaussianBlur",defines:{n:to,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:qf(),fragmentShader:`

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
		`,blending:ir,depthTest:!1,depthWrite:!1})}function dS(){return new si({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:qf(),fragmentShader:`

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
		`,blending:ir,depthTest:!1,depthWrite:!1})}function pS(){return new si({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:qf(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:ir,depthTest:!1,depthWrite:!1})}function qf(){return`

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
	`}var Wf=class extends ii{constructor(e=1,n={}){super(e,e,n),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new Il(r),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new ds(5,5,5),s=new si({name:"CubemapFromEquirect",uniforms:eo(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:Bn,blending:ir});s.uniforms.tEquirect.value=n;let o=new Vt(r,s),a=n.minFilter;return n.minFilter===vs&&(n.minFilter=_n),new Yh(1,10,this).update(e,o),n.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,n=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(n,i,r);e.setRenderTarget(s)}};function RA(t){let e=new WeakMap,n=new WeakMap,i=null;function r(h,p=!1){return h==null?null:p?o(h):s(h)}function s(h){if(h&&h.isTexture){let p=h.mapping;if(p===jh||p===Qh)if(e.has(h)){let _=e.get(h).texture;return a(_,h.mapping)}else{let _=h.image;if(_&&_.height>0){let y=new Wf(_.height);return y.fromEquirectangularTexture(t,h),e.set(h,y),h.addEventListener("dispose",c),a(y.texture,h.mapping)}else return null}}return h}function o(h){if(h&&h.isTexture){let p=h.mapping,_=p===jh||p===Qh,y=p===_s||p===js;if(_||y){let m=n.get(h),u=m!==void 0?m.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==u)return i===null&&(i=new Gf(t)),m=_?i.fromEquirectangular(h,m):i.fromCubemap(h,m),m.texture.pmremVersion=h.pmremVersion,n.set(h,m),m.texture;if(m!==void 0)return m.texture;{let g=h.image;return _&&g&&g.height>0||y&&g&&l(g)?(i===null&&(i=new Gf(t)),m=_?i.fromEquirectangular(h):i.fromCubemap(h),m.texture.pmremVersion=h.pmremVersion,n.set(h,m),h.addEventListener("dispose",f),m.texture):null}}}return h}function a(h,p){return p===jh?h.mapping=_s:p===Qh&&(h.mapping=js),h}function l(h){let p=0,_=6;for(let y=0;y<_;y++)h[y]!==void 0&&p++;return p===_}function c(h){let p=h.target;p.removeEventListener("dispose",c);let _=e.get(p);_!==void 0&&(e.delete(p),_.dispose())}function f(h){let p=h.target;p.removeEventListener("dispose",f);let _=n.get(p);_!==void 0&&(n.delete(p),_.dispose())}function d(){e=new WeakMap,n=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:d}}function PA(t){let e={};function n(i){if(e[i]!==void 0)return e[i];let r=t.getExtension(i);return e[i]=r,r}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let r=n(i);return r===null&&Mh("WebGLRenderer: "+i+" extension not supported."),r}}}function IA(t,e,n,i){let r={},s=new WeakMap;function o(d){let h=d.target;h.index!==null&&e.remove(h.index);for(let _ in h.attributes)e.remove(h.attributes[_]);h.removeEventListener("dispose",o),delete r[h.id];let p=s.get(h);p&&(e.remove(p),s.delete(h)),i.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,n.memory.geometries--}function a(d,h){return r[h.id]===!0||(h.addEventListener("dispose",o),r[h.id]=!0,n.memory.geometries++),h}function l(d){let h=d.attributes;for(let p in h)e.update(h[p],t.ARRAY_BUFFER)}function c(d){let h=[],p=d.index,_=d.attributes.position,y=0;if(_===void 0)return;if(p!==null){let g=p.array;y=p.version;for(let v=0,S=g.length;v<S;v+=3){let A=g[v+0],w=g[v+1],C=g[v+2];h.push(A,w,w,C,C,A)}}else{let g=_.array;y=_.version;for(let v=0,S=g.length/3-1;v<S;v+=3){let A=v+0,w=v+1,C=v+2;h.push(A,w,w,C,C,A)}}let m=new(_.count>=65535?Pl:Rl)(h,1);m.version=y;let u=s.get(d);u&&e.remove(u),s.set(d,m)}function f(d){let h=s.get(d);if(h){let p=d.index;p!==null&&h.version<p.version&&c(d)}else c(d);return s.get(d)}return{get:a,update:l,getWireframeAttribute:f}}function LA(t,e,n){let i;function r(d){i=d}let s,o;function a(d){s=d.type,o=d.bytesPerElement}function l(d,h){t.drawElements(i,h,s,d*o),n.update(h,i,1)}function c(d,h,p){p!==0&&(t.drawElementsInstanced(i,h,s,d*o,p),n.update(h,i,p))}function f(d,h,p){if(p===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,h,0,s,d,0,p);let y=0;for(let m=0;m<p;m++)y+=h[m];n.update(y,i,1)}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=f}function NA(t){let e={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(n.calls++,o){case t.TRIANGLES:n.triangles+=a*(s/3);break;case t.LINES:n.lines+=a*(s/2);break;case t.LINE_STRIP:n.lines+=a*(s-1);break;case t.LINE_LOOP:n.lines+=a*s;break;case t.POINTS:n.points+=a*s;break;default:Je("WebGLInfo: Unknown draw mode:",o);break}}function r(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:e,render:n,programs:null,autoReset:!0,reset:r,update:i}}function DA(t,e,n){let i=new WeakMap,r=new Yt;function s(o,a,l){let c=o.morphTargetInfluences,f=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,d=f!==void 0?f.length:0,h=i.get(a);if(h===void 0||h.count!==d){let b=function(){C.dispose(),i.delete(a),a.removeEventListener("dispose",b)};h!==void 0&&h.texture.dispose();let p=a.morphAttributes.position!==void 0,_=a.morphAttributes.normal!==void 0,y=a.morphAttributes.color!==void 0,m=a.morphAttributes.position||[],u=a.morphAttributes.normal||[],g=a.morphAttributes.color||[],v=0;p===!0&&(v=1),_===!0&&(v=2),y===!0&&(v=3);let S=a.attributes.position.count*v,A=1;S>e.maxTextureSize&&(A=Math.ceil(S/e.maxTextureSize),S=e.maxTextureSize);let w=new Float32Array(S*A*4*d),C=new bl(w,S,A,d);C.type=Ui,C.needsUpdate=!0;let x=v*4;for(let I=0;I<d;I++){let P=m[I],F=u[I],W=g[I],q=S*A*4*I;for(let U=0;U<P.count;U++){let k=U*x;p===!0&&(r.fromBufferAttribute(P,U),w[q+k+0]=r.x,w[q+k+1]=r.y,w[q+k+2]=r.z,w[q+k+3]=0),_===!0&&(r.fromBufferAttribute(F,U),w[q+k+4]=r.x,w[q+k+5]=r.y,w[q+k+6]=r.z,w[q+k+7]=0),y===!0&&(r.fromBufferAttribute(W,U),w[q+k+8]=r.x,w[q+k+9]=r.y,w[q+k+10]=r.z,w[q+k+11]=W.itemSize===4?r.w:1)}}h={count:d,texture:C,size:new Te(S,A)},i.set(a,h),a.addEventListener("dispose",b)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(t,"morphTexture",o.morphTexture,n);else{let p=0;for(let y=0;y<c.length;y++)p+=c[y];let _=a.morphTargetsRelative?1:1-p;l.getUniforms().setValue(t,"morphTargetBaseInfluence",_),l.getUniforms().setValue(t,"morphTargetInfluences",c)}l.getUniforms().setValue(t,"morphTargetsTexture",h.texture,n),l.getUniforms().setValue(t,"morphTargetsTextureSize",h.size)}return{update:s}}function UA(t,e,n,i,r){let s=new WeakMap;function o(c){let f=r.render.frame,d=c.geometry,h=e.get(c,d);if(s.get(h)!==f&&(e.update(h),s.set(h,f)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==f&&(n.update(c.instanceMatrix,t.ARRAY_BUFFER),c.instanceColor!==null&&n.update(c.instanceColor,t.ARRAY_BUFFER),s.set(c,f))),c.isSkinnedMesh){let p=c.skeleton;s.get(p)!==f&&(p.update(),s.set(p,f))}return h}function a(){s=new WeakMap}function l(c){let f=c.target;f.removeEventListener("dispose",l),i.releaseStatesOfObject(f),n.remove(f.instanceMatrix),f.instanceColor!==null&&n.remove(f.instanceColor)}return{update:o,dispose:a}}var FA={[cg]:"LINEAR_TONE_MAPPING",[ug]:"REINHARD_TONE_MAPPING",[hg]:"CINEON_TONE_MAPPING",[jl]:"ACES_FILMIC_TONE_MAPPING",[dg]:"AGX_TONE_MAPPING",[pg]:"NEUTRAL_TONE_MAPPING",[fg]:"CUSTOM_TONE_MAPPING"};function OA(t,e,n,i,r){let s=new ii(e,n,{type:t,depthBuffer:i,stencilBuffer:r,depthTexture:i?new Pr(e,n):void 0}),o=new ii(e,n,{type:rr,depthBuffer:!1,stencilBuffer:!1}),a=new Zt;a.setAttribute("position",new St([-1,3,0,-1,-1,0,3,-1,0],3)),a.setAttribute("uv",new St([0,2,0,0,2,0],2));let l=new Dh({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),c=new Vt(a,l),f=new ua(-1,1,1,-1,0,1),d=null,h=null,p=!1,_,y=null,m=[],u=!1;this.setSize=function(g,v){s.setSize(g,v),o.setSize(g,v);for(let S=0;S<m.length;S++){let A=m[S];A.setSize&&A.setSize(g,v)}},this.setEffects=function(g){m=g,u=m.length>0&&m[0].isRenderPass===!0;let v=s.width,S=s.height;for(let A=0;A<m.length;A++){let w=m[A];w.setSize&&w.setSize(v,S)}},this.begin=function(g,v){if(p||g.toneMapping===Ni&&m.length===0)return!1;if(y=v,v!==null){let S=v.width,A=v.height;(s.width!==S||s.height!==A)&&this.setSize(S,A)}return u===!1&&g.setRenderTarget(s),_=g.toneMapping,g.toneMapping=Ni,!0},this.hasRenderPass=function(){return u},this.end=function(g,v){g.toneMapping=_,p=!0;let S=s,A=o;for(let w=0;w<m.length;w++){let C=m[w];if(C.enabled!==!1&&(C.render(g,A,S,v),C.needsSwap!==!1)){let x=S;S=A,A=x}}if(d!==g.outputColorSpace||h!==g.toneMapping){d=g.outputColorSpace,h=g.toneMapping,l.defines={},xt.getTransfer(d)===Rt&&(l.defines.SRGB_TRANSFER="");let w=FA[h];w&&(l.defines[w]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=S.texture,g.setRenderTarget(y),g.render(c,f),y=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){s.depthTexture&&s.depthTexture.dispose(),s.dispose(),o.dispose(),a.dispose(),l.dispose()}}var DS=new On,Hg=new Pr(1,1),US=new bl,FS=new Th,OS=new Il,mS=[],gS=[],_S=new Float32Array(16),vS=new Float32Array(9),xS=new Float32Array(4);function ga(t,e,n){let i=t[0];if(i<=0||i>0)return t;let r=e*n,s=mS[r];if(s===void 0&&(s=new Float32Array(r),mS[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=n,t[o].toArray(s,a)}return s}function sn(t,e){if(t.length!==e.length)return!1;for(let n=0,i=t.length;n<i;n++)if(t[n]!==e[n])return!1;return!0}function on(t,e){for(let n=0,i=e.length;n<i;n++)t[n]=e[n]}function Yf(t,e){let n=gS[e];n===void 0&&(n=new Int32Array(e),gS[e]=n);for(let i=0;i!==e;++i)n[i]=t.allocateTextureUnit();return n}function BA(t,e){let n=this.cache;n[0]!==e&&(t.uniform1f(this.addr,e),n[0]=e)}function kA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2f(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(sn(n,e))return;t.uniform2fv(this.addr,e),on(n,e)}}function zA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3f(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else if(e.r!==void 0)(n[0]!==e.r||n[1]!==e.g||n[2]!==e.b)&&(t.uniform3f(this.addr,e.r,e.g,e.b),n[0]=e.r,n[1]=e.g,n[2]=e.b);else{if(sn(n,e))return;t.uniform3fv(this.addr,e),on(n,e)}}function VA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4f(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(sn(n,e))return;t.uniform4fv(this.addr,e),on(n,e)}}function HA(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(sn(n,e))return;t.uniformMatrix2fv(this.addr,!1,e),on(n,e)}else{if(sn(n,i))return;xS.set(i),t.uniformMatrix2fv(this.addr,!1,xS),on(n,i)}}function GA(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(sn(n,e))return;t.uniformMatrix3fv(this.addr,!1,e),on(n,e)}else{if(sn(n,i))return;vS.set(i),t.uniformMatrix3fv(this.addr,!1,vS),on(n,i)}}function WA(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(sn(n,e))return;t.uniformMatrix4fv(this.addr,!1,e),on(n,e)}else{if(sn(n,i))return;_S.set(i),t.uniformMatrix4fv(this.addr,!1,_S),on(n,i)}}function XA(t,e){let n=this.cache;n[0]!==e&&(t.uniform1i(this.addr,e),n[0]=e)}function qA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2i(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(sn(n,e))return;t.uniform2iv(this.addr,e),on(n,e)}}function YA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3i(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(sn(n,e))return;t.uniform3iv(this.addr,e),on(n,e)}}function $A(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4i(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(sn(n,e))return;t.uniform4iv(this.addr,e),on(n,e)}}function ZA(t,e){let n=this.cache;n[0]!==e&&(t.uniform1ui(this.addr,e),n[0]=e)}function KA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2ui(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(sn(n,e))return;t.uniform2uiv(this.addr,e),on(n,e)}}function JA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3ui(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(sn(n,e))return;t.uniform3uiv(this.addr,e),on(n,e)}}function jA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4ui(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(sn(n,e))return;t.uniform4uiv(this.addr,e),on(n,e)}}function QA(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r);let s;this.type===t.SAMPLER_2D_SHADOW?(Hg.compareFunction=n.isReversedDepthBuffer()?zf:kf,s=Hg):s=DS,n.setTexture2D(e||s,r)}function eC(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture3D(e||FS,r)}function tC(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTextureCube(e||OS,r)}function nC(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture2DArray(e||US,r)}function iC(t){switch(t){case 5126:return BA;case 35664:return kA;case 35665:return zA;case 35666:return VA;case 35674:return HA;case 35675:return GA;case 35676:return WA;case 5124:case 35670:return XA;case 35667:case 35671:return qA;case 35668:case 35672:return YA;case 35669:case 35673:return $A;case 5125:return ZA;case 36294:return KA;case 36295:return JA;case 36296:return jA;case 35678:case 36198:case 36298:case 36306:case 35682:return QA;case 35679:case 36299:case 36307:return eC;case 35680:case 36300:case 36308:case 36293:return tC;case 36289:case 36303:case 36311:case 36292:return nC}}function rC(t,e){t.uniform1fv(this.addr,e)}function sC(t,e){let n=ga(e,this.size,2);t.uniform2fv(this.addr,n)}function oC(t,e){let n=ga(e,this.size,3);t.uniform3fv(this.addr,n)}function aC(t,e){let n=ga(e,this.size,4);t.uniform4fv(this.addr,n)}function lC(t,e){let n=ga(e,this.size,4);t.uniformMatrix2fv(this.addr,!1,n)}function cC(t,e){let n=ga(e,this.size,9);t.uniformMatrix3fv(this.addr,!1,n)}function uC(t,e){let n=ga(e,this.size,16);t.uniformMatrix4fv(this.addr,!1,n)}function hC(t,e){t.uniform1iv(this.addr,e)}function fC(t,e){t.uniform2iv(this.addr,e)}function dC(t,e){t.uniform3iv(this.addr,e)}function pC(t,e){t.uniform4iv(this.addr,e)}function mC(t,e){t.uniform1uiv(this.addr,e)}function gC(t,e){t.uniform2uiv(this.addr,e)}function _C(t,e){t.uniform3uiv(this.addr,e)}function vC(t,e){t.uniform4uiv(this.addr,e)}function xC(t,e,n){let i=this.cache,r=e.length,s=Yf(n,r);sn(i,s)||(t.uniform1iv(this.addr,s),on(i,s));let o;this.type===t.SAMPLER_2D_SHADOW?o=Hg:o=DS;for(let a=0;a!==r;++a)n.setTexture2D(e[a]||o,s[a])}function yC(t,e,n){let i=this.cache,r=e.length,s=Yf(n,r);sn(i,s)||(t.uniform1iv(this.addr,s),on(i,s));for(let o=0;o!==r;++o)n.setTexture3D(e[o]||FS,s[o])}function SC(t,e,n){let i=this.cache,r=e.length,s=Yf(n,r);sn(i,s)||(t.uniform1iv(this.addr,s),on(i,s));for(let o=0;o!==r;++o)n.setTextureCube(e[o]||OS,s[o])}function MC(t,e,n){let i=this.cache,r=e.length,s=Yf(n,r);sn(i,s)||(t.uniform1iv(this.addr,s),on(i,s));for(let o=0;o!==r;++o)n.setTexture2DArray(e[o]||US,s[o])}function wC(t){switch(t){case 5126:return rC;case 35664:return sC;case 35665:return oC;case 35666:return aC;case 35674:return lC;case 35675:return cC;case 35676:return uC;case 5124:case 35670:return hC;case 35667:case 35671:return fC;case 35668:case 35672:return dC;case 35669:case 35673:return pC;case 5125:return mC;case 36294:return gC;case 36295:return _C;case 36296:return vC;case 35678:case 36198:case 36298:case 36306:case 35682:return xC;case 35679:case 36299:case 36307:return yC;case 35680:case 36300:case 36308:case 36293:return SC;case 36289:case 36303:case 36311:case 36292:return MC}}var Gg=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.setValue=iC(n.type)}},Wg=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=wC(n.type)}},Xg=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,n,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,n[a.id],i)}}},zg=/(\w+)(\])?(\[|\.)?/g;function yS(t,e){t.seq.push(e),t.map[e.id]=e}function EC(t,e,n){let i=t.name,r=i.length;for(zg.lastIndex=0;;){let s=zg.exec(i),o=zg.lastIndex,a=s[1],l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){yS(n,c===void 0?new Gg(a,t,e):new Wg(a,t,e));break}else{let d=n.map[a];d===void 0&&(d=new Xg(a),yS(n,d)),n=d}}}var ma=class{constructor(e,n){this.seq=[],this.map={};let i=e.getProgramParameter(n,e.ACTIVE_UNIFORMS);for(let o=0;o<i;++o){let a=e.getActiveUniform(n,o),l=e.getUniformLocation(n,a.name);EC(a,l,this)}let r=[],s=[];for(let o of this.seq)o.type===e.SAMPLER_2D_SHADOW||o.type===e.SAMPLER_CUBE_SHADOW||o.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(o):s.push(o);r.length>0&&(this.seq=r.concat(s))}setValue(e,n,i,r){let s=this.map[n];s!==void 0&&s.setValue(e,i,r)}setOptional(e,n,i){let r=n[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,n,i,r){for(let s=0,o=n.length;s!==o;++s){let a=n[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,n){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in n&&i.push(o)}return i}};function SS(t,e,n){let i=t.createShader(e);return t.shaderSource(i,n),t.compileShader(i),i}var TC=37297,bC=0;function AC(t,e){let n=t.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,n.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${n[o]}`)}return i.join(`
`)}var MS=new rt;function CC(t){xt._getMatrix(MS,xt.workingColorSpace,t);let e=`mat3( ${MS.elements.map(n=>n.toFixed(4))} )`;switch(xt.getTransfer(t)){case El:return[e,"LinearTransferOETF"];case Rt:return[e,"sRGBTransferOETF"];default:return Ze("WebGLProgram: Unsupported color space: ",t),[e,"LinearTransferOETF"]}}function wS(t,e,n){let i=t.getShaderParameter(e,t.COMPILE_STATUS),s=(t.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return n.toUpperCase()+`

`+s+`

`+AC(t.getShaderSource(e),a)}else return s}function RC(t,e){let n=CC(e);return[`vec4 ${t}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}var PC={[cg]:"Linear",[ug]:"Reinhard",[hg]:"Cineon",[jl]:"ACESFilmic",[dg]:"AgX",[pg]:"Neutral",[fg]:"Custom"};function IC(t,e){let n=PC[e];return n===void 0?(Ze("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+t+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+t+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var Hf=new N;function LC(){xt.getLuminanceCoefficients(Hf);let t=Hf.x.toFixed(4),e=Hf.y.toFixed(4),n=Hf.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${t}, ${e}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function NC(t){return[t.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",t.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(cc).join(`
`)}function DC(t){let e=[];for(let n in t){let i=t[n];i!==!1&&e.push("#define "+n+" "+i)}return e.join(`
`)}function UC(t,e){let n={},i=t.getProgramParameter(e,t.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=t.getActiveAttrib(e,r),o=s.name,a=1;s.type===t.FLOAT_MAT2&&(a=2),s.type===t.FLOAT_MAT3&&(a=3),s.type===t.FLOAT_MAT4&&(a=4),n[o]={type:s.type,location:t.getAttribLocation(e,o),locationSize:a}}return n}function cc(t){return t!==""}function ES(t,e){let n=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return t.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function TS(t,e){return t.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var FC=/^[ \t]*#include +<([\w\d./]+)>/gm;function qg(t){return t.replace(FC,BC)}var OC=new Map;function BC(t,e){let n=ht[e];if(n===void 0){let i=OC.get(e);if(i!==void 0)n=ht[i],Ze('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return qg(n)}var kC=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function bS(t){return t.replace(kC,zC)}function zC(t,e,n,i){let r="";for(let s=parseInt(e);s<parseInt(n);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function AS(t){let e=`precision ${t.precision} float;
	precision ${t.precision} int;
	precision ${t.precision} sampler2D;
	precision ${t.precision} samplerCube;
	precision ${t.precision} sampler3D;
	precision ${t.precision} sampler2DArray;
	precision ${t.precision} sampler2DShadow;
	precision ${t.precision} samplerCubeShadow;
	precision ${t.precision} sampler2DArrayShadow;
	precision ${t.precision} isampler2D;
	precision ${t.precision} isampler3D;
	precision ${t.precision} isamplerCube;
	precision ${t.precision} isampler2DArray;
	precision ${t.precision} usampler2D;
	precision ${t.precision} usampler3D;
	precision ${t.precision} usamplerCube;
	precision ${t.precision} usampler2DArray;
	`;return t.precision==="highp"?e+=`
#define HIGH_PRECISION`:t.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:t.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}var VC={[Jl]:"SHADOWMAP_TYPE_PCF",[ha]:"SHADOWMAP_TYPE_VSM"};function HC(t){return VC[t.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var GC={[_s]:"ENVMAP_TYPE_CUBE",[js]:"ENVMAP_TYPE_CUBE",[Ql]:"ENVMAP_TYPE_CUBE_UV"};function WC(t){return t.envMap===!1?"ENVMAP_TYPE_CUBE":GC[t.envMapMode]||"ENVMAP_TYPE_CUBE"}var XC={[js]:"ENVMAP_MODE_REFRACTION"};function qC(t){return t.envMap===!1?"ENVMAP_MODE_REFLECTION":XC[t.envMapMode]||"ENVMAP_MODE_REFLECTION"}var YC={[lg]:"ENVMAP_BLENDING_MULTIPLY",[Hy]:"ENVMAP_BLENDING_MIX",[Gy]:"ENVMAP_BLENDING_ADD"};function $C(t){return t.envMap===!1?"ENVMAP_BLENDING_NONE":YC[t.combine]||"ENVMAP_BLENDING_NONE"}function ZC(t){let e=t.envMapCubeUVHeight;if(e===null)return null;let n=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,n),7*16)),texelHeight:i,maxMip:n}}function KC(t,e,n,i){let r=t.getContext(),s=n.defines,o=n.vertexShader,a=n.fragmentShader,l=HC(n),c=WC(n),f=qC(n),d=$C(n),h=ZC(n),p=NC(n),_=DC(s),y=r.createProgram(),m,u,g=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(m=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_].filter(cc).join(`
`),m.length>0&&(m+=`
`),u=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_].filter(cc).join(`
`),u.length>0&&(u+=`
`)):(m=[AS(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+f:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexNormals?"#define HAS_NORMAL":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(cc).join(`
`),u=[AS(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+f:"",n.envMap?"#define "+d:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor?"#define USE_COLOR":"",n.vertexAlphas||n.batchingColor?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==Ni?"#define TONE_MAPPING":"",n.toneMapping!==Ni?ht.tonemapping_pars_fragment:"",n.toneMapping!==Ni?IC("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",ht.colorspace_pars_fragment,RC("linearToOutputTexel",n.outputColorSpace),LC(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(cc).join(`
`)),o=qg(o),o=ES(o,n),o=TS(o,n),a=qg(a),a=ES(a,n),a=TS(a,n),o=bS(o),a=bS(a),n.isRawShaderMaterial!==!0&&(g=`#version 300 es
`,m=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,u=["#define varying in",n.glslVersion===wg?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===wg?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+u);let v=g+m+o,S=g+u+a,A=SS(r,r.VERTEX_SHADER,v),w=SS(r,r.FRAGMENT_SHADER,S);r.attachShader(y,A),r.attachShader(y,w),n.index0AttributeName!==void 0?r.bindAttribLocation(y,0,n.index0AttributeName):n.morphTargets===!0&&r.bindAttribLocation(y,0,"position"),r.linkProgram(y);function C(P){if(t.debug.checkShaderErrors){let F=r.getProgramInfoLog(y)||"",W=r.getShaderInfoLog(A)||"",q=r.getShaderInfoLog(w)||"",U=F.trim(),k=W.trim(),z=q.trim(),ne=!0,le=!0;if(r.getProgramParameter(y,r.LINK_STATUS)===!1)if(ne=!1,typeof t.debug.onShaderError=="function")t.debug.onShaderError(r,y,A,w);else{let me=wS(r,A,"vertex"),Ce=wS(r,w,"fragment");Je("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(y,r.VALIDATE_STATUS)+`

Material Name: `+P.name+`
Material Type: `+P.type+`

Program Info Log: `+U+`
`+me+`
`+Ce)}else U!==""?Ze("WebGLProgram: Program Info Log:",U):(k===""||z==="")&&(le=!1);le&&(P.diagnostics={runnable:ne,programLog:U,vertexShader:{log:k,prefix:m},fragmentShader:{log:z,prefix:u}})}r.deleteShader(A),r.deleteShader(w),x=new ma(r,y),b=UC(r,y)}let x;this.getUniforms=function(){return x===void 0&&C(this),x};let b;this.getAttributes=function(){return b===void 0&&C(this),b};let I=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return I===!1&&(I=r.getProgramParameter(y,TC)),I},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(y),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=bC++,this.cacheKey=e,this.usedTimes=1,this.program=y,this.vertexShader=A,this.fragmentShader=w,this}var JC=0,Yg=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let n=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(n),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let n=this.materialCache.get(e);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let n=this.materialCache,i=n.get(e);return i===void 0&&(i=new Set,n.set(e,i)),i}_getShaderStage(e){let n=this.shaderCache,i=n.get(e);return i===void 0&&(i=new $g(e),n.set(e,i)),i}},$g=class{constructor(e){this.id=JC++,this.code=e,this.usedTimes=0}};function jC(t){return t===ys||t===sc||t===oc}function QC(t,e,n,i,r,s){let o=new ta,a=new Yg,l=new Set,c=[],f=new Map,d=i.logarithmicDepthBuffer,h=i.precision,p={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(x){return l.add(x),x===0?"uv":`uv${x}`}function y(x,b,I,P,F,W){let q=P.fog,U=F.geometry,k=x.isMeshStandardMaterial||x.isMeshLambertMaterial||x.isMeshPhongMaterial?P.environment:null,z=x.isMeshStandardMaterial||x.isMeshLambertMaterial&&!x.envMap||x.isMeshPhongMaterial&&!x.envMap,ne=e.get(x.envMap||k,z),le=ne&&ne.mapping===Ql?ne.image.height:null,me=p[x.type];x.precision!==null&&(h=i.getMaxPrecision(x.precision),h!==x.precision&&Ze("WebGLProgram.getParameters:",x.precision,"not supported, using",h,"instead."));let Ce=U.morphAttributes.position||U.morphAttributes.normal||U.morphAttributes.color,Be=Ce!==void 0?Ce.length:0,Qe=0;U.morphAttributes.position!==void 0&&(Qe=1),U.morphAttributes.normal!==void 0&&(Qe=2),U.morphAttributes.color!==void 0&&(Qe=3);let vt,et,te,ye;if(me){let We=or[me];vt=We.vertexShader,et=We.fragmentShader}else vt=x.vertexShader,et=x.fragmentShader,a.update(x),te=a.getVertexShaderID(x),ye=a.getFragmentShaderID(x);let ce=t.getRenderTarget(),Ve=t.state.buffers.depth.getReversed(),qe=F.isInstancedMesh===!0,$e=F.isBatchedMesh===!0,dt=!!x.map,Ue=!!x.matcap,ie=!!ne,re=!!x.aoMap,j=!!x.lightMap,Se=!!x.bumpMap,ve=!!x.normalMap,Ye=!!x.displacementMap,L=!!x.emissiveMap,tt=!!x.metalnessMap,ze=!!x.roughnessMap,Ke=x.anisotropy>0,fe=x.clearcoat>0,yt=x.dispersion>0,T=x.iridescence>0,M=x.sheen>0,B=x.transmission>0,K=Ke&&!!x.anisotropyMap,se=fe&&!!x.clearcoatMap,de=fe&&!!x.clearcoatNormalMap,pe=fe&&!!x.clearcoatRoughnessMap,Y=T&&!!x.iridescenceMap,ee=T&&!!x.iridescenceThicknessMap,Ae=M&&!!x.sheenColorMap,De=M&&!!x.sheenRoughnessMap,_e=!!x.specularMap,ue=!!x.specularColorMap,nt=!!x.specularIntensityMap,ot=B&&!!x.transmissionMap,ut=B&&!!x.thicknessMap,D=!!x.gradientMap,ge=!!x.alphaMap,J=x.alphaTest>0,Re=!!x.alphaHash,ae=!!x.extensions,oe=Ni;x.toneMapped&&(ce===null||ce.isXRRenderTarget===!0)&&(oe=t.toneMapping);let He={shaderID:me,shaderType:x.type,shaderName:x.name,vertexShader:vt,fragmentShader:et,defines:x.defines,customVertexShaderID:te,customFragmentShaderID:ye,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:h,batching:$e,batchingColor:$e&&F._colorsTexture!==null,instancing:qe,instancingColor:qe&&F.instanceColor!==null,instancingMorph:qe&&F.morphTexture!==null,outputColorSpace:ce===null?t.outputColorSpace:ce.isXRRenderTarget===!0?ce.texture.colorSpace:xt.workingColorSpace,alphaToCoverage:!!x.alphaToCoverage,map:dt,matcap:Ue,envMap:ie,envMapMode:ie&&ne.mapping,envMapCubeUVHeight:le,aoMap:re,lightMap:j,bumpMap:Se,normalMap:ve,displacementMap:Ye,emissiveMap:L,normalMapObjectSpace:ve&&x.normalMapType===qy,normalMapTangentSpace:ve&&x.normalMapType===Bf,packedNormalMap:ve&&x.normalMapType===Bf&&jC(x.normalMap.format),metalnessMap:tt,roughnessMap:ze,anisotropy:Ke,anisotropyMap:K,clearcoat:fe,clearcoatMap:se,clearcoatNormalMap:de,clearcoatRoughnessMap:pe,dispersion:yt,iridescence:T,iridescenceMap:Y,iridescenceThicknessMap:ee,sheen:M,sheenColorMap:Ae,sheenRoughnessMap:De,specularMap:_e,specularColorMap:ue,specularIntensityMap:nt,transmission:B,transmissionMap:ot,thicknessMap:ut,gradientMap:D,opaque:x.transparent===!1&&x.blending===Ws&&x.alphaToCoverage===!1,alphaMap:ge,alphaTest:J,alphaHash:Re,combine:x.combine,mapUv:dt&&_(x.map.channel),aoMapUv:re&&_(x.aoMap.channel),lightMapUv:j&&_(x.lightMap.channel),bumpMapUv:Se&&_(x.bumpMap.channel),normalMapUv:ve&&_(x.normalMap.channel),displacementMapUv:Ye&&_(x.displacementMap.channel),emissiveMapUv:L&&_(x.emissiveMap.channel),metalnessMapUv:tt&&_(x.metalnessMap.channel),roughnessMapUv:ze&&_(x.roughnessMap.channel),anisotropyMapUv:K&&_(x.anisotropyMap.channel),clearcoatMapUv:se&&_(x.clearcoatMap.channel),clearcoatNormalMapUv:de&&_(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:pe&&_(x.clearcoatRoughnessMap.channel),iridescenceMapUv:Y&&_(x.iridescenceMap.channel),iridescenceThicknessMapUv:ee&&_(x.iridescenceThicknessMap.channel),sheenColorMapUv:Ae&&_(x.sheenColorMap.channel),sheenRoughnessMapUv:De&&_(x.sheenRoughnessMap.channel),specularMapUv:_e&&_(x.specularMap.channel),specularColorMapUv:ue&&_(x.specularColorMap.channel),specularIntensityMapUv:nt&&_(x.specularIntensityMap.channel),transmissionMapUv:ot&&_(x.transmissionMap.channel),thicknessMapUv:ut&&_(x.thicknessMap.channel),alphaMapUv:ge&&_(x.alphaMap.channel),vertexTangents:!!U.attributes.tangent&&(ve||Ke),vertexNormals:!!U.attributes.normal,vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!U.attributes.color&&U.attributes.color.itemSize===4,pointsUvs:F.isPoints===!0&&!!U.attributes.uv&&(dt||ge),fog:!!q,useFog:x.fog===!0,fogExp2:!!q&&q.isFogExp2,flatShading:x.wireframe===!1&&(x.flatShading===!0||U.attributes.normal===void 0&&ve===!1&&(x.isMeshLambertMaterial||x.isMeshPhongMaterial||x.isMeshStandardMaterial||x.isMeshPhysicalMaterial)),sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:Ve,skinning:F.isSkinnedMesh===!0,morphTargets:U.morphAttributes.position!==void 0,morphNormals:U.morphAttributes.normal!==void 0,morphColors:U.morphAttributes.color!==void 0,morphTargetsCount:Be,morphTextureStride:Qe,numDirLights:b.directional.length,numPointLights:b.point.length,numSpotLights:b.spot.length,numSpotLightMaps:b.spotLightMap.length,numRectAreaLights:b.rectArea.length,numHemiLights:b.hemi.length,numDirLightShadows:b.directionalShadowMap.length,numPointLightShadows:b.pointShadowMap.length,numSpotLightShadows:b.spotShadowMap.length,numSpotLightShadowsWithMaps:b.numSpotLightShadowsWithMaps,numLightProbes:b.numLightProbes,numLightProbeGrids:W.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:x.dithering,shadowMapEnabled:t.shadowMap.enabled&&I.length>0,shadowMapType:t.shadowMap.type,toneMapping:oe,decodeVideoTexture:dt&&x.map.isVideoTexture===!0&&xt.getTransfer(x.map.colorSpace)===Rt,decodeVideoTextureEmissive:L&&x.emissiveMap.isVideoTexture===!0&&xt.getTransfer(x.emissiveMap.colorSpace)===Rt,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===nr,flipSided:x.side===Bn,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:ae&&x.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(ae&&x.extensions.multiDraw===!0||$e)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return He.vertexUv1s=l.has(1),He.vertexUv2s=l.has(2),He.vertexUv3s=l.has(3),l.clear(),He}function m(x){let b=[];if(x.shaderID?b.push(x.shaderID):(b.push(x.customVertexShaderID),b.push(x.customFragmentShaderID)),x.defines!==void 0)for(let I in x.defines)b.push(I),b.push(x.defines[I]);return x.isRawShaderMaterial===!1&&(u(b,x),g(b,x),b.push(t.outputColorSpace)),b.push(x.customProgramCacheKey),b.join()}function u(x,b){x.push(b.precision),x.push(b.outputColorSpace),x.push(b.envMapMode),x.push(b.envMapCubeUVHeight),x.push(b.mapUv),x.push(b.alphaMapUv),x.push(b.lightMapUv),x.push(b.aoMapUv),x.push(b.bumpMapUv),x.push(b.normalMapUv),x.push(b.displacementMapUv),x.push(b.emissiveMapUv),x.push(b.metalnessMapUv),x.push(b.roughnessMapUv),x.push(b.anisotropyMapUv),x.push(b.clearcoatMapUv),x.push(b.clearcoatNormalMapUv),x.push(b.clearcoatRoughnessMapUv),x.push(b.iridescenceMapUv),x.push(b.iridescenceThicknessMapUv),x.push(b.sheenColorMapUv),x.push(b.sheenRoughnessMapUv),x.push(b.specularMapUv),x.push(b.specularColorMapUv),x.push(b.specularIntensityMapUv),x.push(b.transmissionMapUv),x.push(b.thicknessMapUv),x.push(b.combine),x.push(b.fogExp2),x.push(b.sizeAttenuation),x.push(b.morphTargetsCount),x.push(b.morphAttributeCount),x.push(b.numDirLights),x.push(b.numPointLights),x.push(b.numSpotLights),x.push(b.numSpotLightMaps),x.push(b.numHemiLights),x.push(b.numRectAreaLights),x.push(b.numDirLightShadows),x.push(b.numPointLightShadows),x.push(b.numSpotLightShadows),x.push(b.numSpotLightShadowsWithMaps),x.push(b.numLightProbes),x.push(b.shadowMapType),x.push(b.toneMapping),x.push(b.numClippingPlanes),x.push(b.numClipIntersection),x.push(b.depthPacking)}function g(x,b){o.disableAll(),b.instancing&&o.enable(0),b.instancingColor&&o.enable(1),b.instancingMorph&&o.enable(2),b.matcap&&o.enable(3),b.envMap&&o.enable(4),b.normalMapObjectSpace&&o.enable(5),b.normalMapTangentSpace&&o.enable(6),b.clearcoat&&o.enable(7),b.iridescence&&o.enable(8),b.alphaTest&&o.enable(9),b.vertexColors&&o.enable(10),b.vertexAlphas&&o.enable(11),b.vertexUv1s&&o.enable(12),b.vertexUv2s&&o.enable(13),b.vertexUv3s&&o.enable(14),b.vertexTangents&&o.enable(15),b.anisotropy&&o.enable(16),b.alphaHash&&o.enable(17),b.batching&&o.enable(18),b.dispersion&&o.enable(19),b.batchingColor&&o.enable(20),b.gradientMap&&o.enable(21),b.packedNormalMap&&o.enable(22),b.vertexNormals&&o.enable(23),x.push(o.mask),o.disableAll(),b.fog&&o.enable(0),b.useFog&&o.enable(1),b.flatShading&&o.enable(2),b.logarithmicDepthBuffer&&o.enable(3),b.reversedDepthBuffer&&o.enable(4),b.skinning&&o.enable(5),b.morphTargets&&o.enable(6),b.morphNormals&&o.enable(7),b.morphColors&&o.enable(8),b.premultipliedAlpha&&o.enable(9),b.shadowMapEnabled&&o.enable(10),b.doubleSided&&o.enable(11),b.flipSided&&o.enable(12),b.useDepthPacking&&o.enable(13),b.dithering&&o.enable(14),b.transmission&&o.enable(15),b.sheen&&o.enable(16),b.opaque&&o.enable(17),b.pointsUvs&&o.enable(18),b.decodeVideoTexture&&o.enable(19),b.decodeVideoTextureEmissive&&o.enable(20),b.alphaToCoverage&&o.enable(21),b.numLightProbeGrids>0&&o.enable(22),x.push(o.mask)}function v(x){let b=p[x.type],I;if(b){let P=or[b];I=lS.clone(P.uniforms)}else I=x.uniforms;return I}function S(x,b){let I=f.get(b);return I!==void 0?++I.usedTimes:(I=new KC(t,b,x,r),c.push(I),f.set(b,I)),I}function A(x){if(--x.usedTimes===0){let b=c.indexOf(x);c[b]=c[c.length-1],c.pop(),f.delete(x.cacheKey),x.destroy()}}function w(x){a.remove(x)}function C(){a.dispose()}return{getParameters:y,getProgramCacheKey:m,getUniforms:v,acquireProgram:S,releaseProgram:A,releaseShaderCache:w,programs:c,dispose:C}}function eR(){let t=new WeakMap;function e(o){return t.has(o)}function n(o){let a=t.get(o);return a===void 0&&(a={},t.set(o,a)),a}function i(o){t.delete(o)}function r(o,a,l){t.get(o)[a]=l}function s(){t=new WeakMap}return{has:e,get:n,remove:i,update:r,dispose:s}}function tR(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.material.id!==e.material.id?t.material.id-e.material.id:t.materialVariant!==e.materialVariant?t.materialVariant-e.materialVariant:t.z!==e.z?t.z-e.z:t.id-e.id}function CS(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.z!==e.z?e.z-t.z:t.id-e.id}function RS(){let t=[],e=0,n=[],i=[],r=[];function s(){e=0,n.length=0,i.length=0,r.length=0}function o(h){let p=0;return h.isInstancedMesh&&(p+=2),h.isSkinnedMesh&&(p+=1),p}function a(h,p,_,y,m,u){let g=t[e];return g===void 0?(g={id:h.id,object:h,geometry:p,material:_,materialVariant:o(h),groupOrder:y,renderOrder:h.renderOrder,z:m,group:u},t[e]=g):(g.id=h.id,g.object=h,g.geometry=p,g.material=_,g.materialVariant=o(h),g.groupOrder=y,g.renderOrder=h.renderOrder,g.z=m,g.group=u),e++,g}function l(h,p,_,y,m,u){let g=a(h,p,_,y,m,u);_.transmission>0?i.push(g):_.transparent===!0?r.push(g):n.push(g)}function c(h,p,_,y,m,u){let g=a(h,p,_,y,m,u);_.transmission>0?i.unshift(g):_.transparent===!0?r.unshift(g):n.unshift(g)}function f(h,p){n.length>1&&n.sort(h||tR),i.length>1&&i.sort(p||CS),r.length>1&&r.sort(p||CS)}function d(){for(let h=e,p=t.length;h<p;h++){let _=t[h];if(_.id===null)break;_.id=null,_.object=null,_.geometry=null,_.material=null,_.group=null}}return{opaque:n,transmissive:i,transparent:r,init:s,push:l,unshift:c,finish:d,sort:f}}function nR(){let t=new WeakMap;function e(i,r){let s=t.get(i),o;return s===void 0?(o=new RS,t.set(i,[o])):r>=s.length?(o=new RS,s.push(o)):o=s[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}function iR(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={direction:new N,color:new ft};break;case"SpotLight":n={position:new N,direction:new N,color:new ft,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new N,color:new ft,distance:0,decay:0};break;case"HemisphereLight":n={direction:new N,skyColor:new ft,groundColor:new ft};break;case"RectAreaLight":n={color:new ft,position:new N,halfWidth:new N,halfHeight:new N};break}return t[e.id]=n,n}}}function rR(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Te};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Te};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Te,shadowCameraNear:1,shadowCameraFar:1e3};break}return t[e.id]=n,n}}}var sR=0;function oR(t,e){return(e.castShadow?2:0)-(t.castShadow?2:0)+(e.map?1:0)-(t.map?1:0)}function aR(t){let e=new iR,n=rR(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new N);let r=new N,s=new At,o=new At;function a(c){let f=0,d=0,h=0;for(let b=0;b<9;b++)i.probe[b].set(0,0,0);let p=0,_=0,y=0,m=0,u=0,g=0,v=0,S=0,A=0,w=0,C=0;c.sort(oR);for(let b=0,I=c.length;b<I;b++){let P=c[b],F=P.color,W=P.intensity,q=P.distance,U=null;if(P.shadow&&P.shadow.map&&(P.shadow.map.texture.format===ys?U=P.shadow.map.texture:U=P.shadow.map.depthTexture||P.shadow.map.texture),P.isAmbientLight)f+=F.r*W,d+=F.g*W,h+=F.b*W;else if(P.isLightProbe){for(let k=0;k<9;k++)i.probe[k].addScaledVector(P.sh.coefficients[k],W);C++}else if(P.isDirectionalLight){let k=e.get(P);if(k.color.copy(P.color).multiplyScalar(P.intensity),P.castShadow){let z=P.shadow,ne=n.get(P);ne.shadowIntensity=z.intensity,ne.shadowBias=z.bias,ne.shadowNormalBias=z.normalBias,ne.shadowRadius=z.radius,ne.shadowMapSize=z.mapSize,i.directionalShadow[p]=ne,i.directionalShadowMap[p]=U,i.directionalShadowMatrix[p]=P.shadow.matrix,g++}i.directional[p]=k,p++}else if(P.isSpotLight){let k=e.get(P);k.position.setFromMatrixPosition(P.matrixWorld),k.color.copy(F).multiplyScalar(W),k.distance=q,k.coneCos=Math.cos(P.angle),k.penumbraCos=Math.cos(P.angle*(1-P.penumbra)),k.decay=P.decay,i.spot[y]=k;let z=P.shadow;if(P.map&&(i.spotLightMap[A]=P.map,A++,z.updateMatrices(P),P.castShadow&&w++),i.spotLightMatrix[y]=z.matrix,P.castShadow){let ne=n.get(P);ne.shadowIntensity=z.intensity,ne.shadowBias=z.bias,ne.shadowNormalBias=z.normalBias,ne.shadowRadius=z.radius,ne.shadowMapSize=z.mapSize,i.spotShadow[y]=ne,i.spotShadowMap[y]=U,S++}y++}else if(P.isRectAreaLight){let k=e.get(P);k.color.copy(F).multiplyScalar(W),k.halfWidth.set(P.width*.5,0,0),k.halfHeight.set(0,P.height*.5,0),i.rectArea[m]=k,m++}else if(P.isPointLight){let k=e.get(P);if(k.color.copy(P.color).multiplyScalar(P.intensity),k.distance=P.distance,k.decay=P.decay,P.castShadow){let z=P.shadow,ne=n.get(P);ne.shadowIntensity=z.intensity,ne.shadowBias=z.bias,ne.shadowNormalBias=z.normalBias,ne.shadowRadius=z.radius,ne.shadowMapSize=z.mapSize,ne.shadowCameraNear=z.camera.near,ne.shadowCameraFar=z.camera.far,i.pointShadow[_]=ne,i.pointShadowMap[_]=U,i.pointShadowMatrix[_]=P.shadow.matrix,v++}i.point[_]=k,_++}else if(P.isHemisphereLight){let k=e.get(P);k.skyColor.copy(P.color).multiplyScalar(W),k.groundColor.copy(P.groundColor).multiplyScalar(W),i.hemi[u]=k,u++}}m>0&&(t.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=be.LTC_FLOAT_1,i.rectAreaLTC2=be.LTC_FLOAT_2):(i.rectAreaLTC1=be.LTC_HALF_1,i.rectAreaLTC2=be.LTC_HALF_2)),i.ambient[0]=f,i.ambient[1]=d,i.ambient[2]=h;let x=i.hash;(x.directionalLength!==p||x.pointLength!==_||x.spotLength!==y||x.rectAreaLength!==m||x.hemiLength!==u||x.numDirectionalShadows!==g||x.numPointShadows!==v||x.numSpotShadows!==S||x.numSpotMaps!==A||x.numLightProbes!==C)&&(i.directional.length=p,i.spot.length=y,i.rectArea.length=m,i.point.length=_,i.hemi.length=u,i.directionalShadow.length=g,i.directionalShadowMap.length=g,i.pointShadow.length=v,i.pointShadowMap.length=v,i.spotShadow.length=S,i.spotShadowMap.length=S,i.directionalShadowMatrix.length=g,i.pointShadowMatrix.length=v,i.spotLightMatrix.length=S+A-w,i.spotLightMap.length=A,i.numSpotLightShadowsWithMaps=w,i.numLightProbes=C,x.directionalLength=p,x.pointLength=_,x.spotLength=y,x.rectAreaLength=m,x.hemiLength=u,x.numDirectionalShadows=g,x.numPointShadows=v,x.numSpotShadows=S,x.numSpotMaps=A,x.numLightProbes=C,i.version=sR++)}function l(c,f){let d=0,h=0,p=0,_=0,y=0,m=f.matrixWorldInverse;for(let u=0,g=c.length;u<g;u++){let v=c[u];if(v.isDirectionalLight){let S=i.directional[d];S.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),S.direction.sub(r),S.direction.transformDirection(m),d++}else if(v.isSpotLight){let S=i.spot[p];S.position.setFromMatrixPosition(v.matrixWorld),S.position.applyMatrix4(m),S.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),S.direction.sub(r),S.direction.transformDirection(m),p++}else if(v.isRectAreaLight){let S=i.rectArea[_];S.position.setFromMatrixPosition(v.matrixWorld),S.position.applyMatrix4(m),o.identity(),s.copy(v.matrixWorld),s.premultiply(m),o.extractRotation(s),S.halfWidth.set(v.width*.5,0,0),S.halfHeight.set(0,v.height*.5,0),S.halfWidth.applyMatrix4(o),S.halfHeight.applyMatrix4(o),_++}else if(v.isPointLight){let S=i.point[h];S.position.setFromMatrixPosition(v.matrixWorld),S.position.applyMatrix4(m),h++}else if(v.isHemisphereLight){let S=i.hemi[y];S.direction.setFromMatrixPosition(v.matrixWorld),S.direction.transformDirection(m),y++}}}return{setup:a,setupView:l,state:i}}function PS(t){let e=new aR(t),n=[],i=[],r=[];function s(h){d.camera=h,n.length=0,i.length=0,r.length=0}function o(h){n.push(h)}function a(h){i.push(h)}function l(h){r.push(h)}function c(){e.setup(n)}function f(h){e.setupView(n,h)}let d={lightsArray:n,shadowsArray:i,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:d,setupLights:c,setupLightsView:f,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function lR(t){let e=new WeakMap;function n(r,s=0){let o=e.get(r),a;return o===void 0?(a=new PS(t),e.set(r,[a])):s>=o.length?(a=new PS(t),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:n,dispose:i}}var cR=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,uR=`uniform sampler2D shadow_pass;
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
}`,hR=[new N(1,0,0),new N(-1,0,0),new N(0,1,0),new N(0,-1,0),new N(0,0,1),new N(0,0,-1)],fR=[new N(0,-1,0),new N(0,-1,0),new N(0,0,1),new N(0,0,-1),new N(0,-1,0),new N(0,-1,0)],IS=new At,lc=new N,Vg=new N;function dR(t,e,n){let i=new ra,r=new Te,s=new Te,o=new Yt,a=new Uh,l=new Fh,c={},f=n.maxTextureSize,d={[Cr]:Bn,[Bn]:Cr,[nr]:nr},h=new si({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Te},radius:{value:4}},vertexShader:cR,fragmentShader:uR}),p=h.clone();p.defines.HORIZONTAL_PASS=1;let _=new Zt;_.setAttribute("position",new Fn(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let y=new Vt(_,h),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Jl;let u=this.type;this.render=function(w,C,x){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||w.length===0)return;this.type===Jh&&(Ze("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=Jl);let b=t.getRenderTarget(),I=t.getActiveCubeFace(),P=t.getActiveMipmapLevel(),F=t.state;F.setBlending(ir),F.buffers.depth.getReversed()===!0?F.buffers.color.setClear(0,0,0,0):F.buffers.color.setClear(1,1,1,1),F.buffers.depth.setTest(!0),F.setScissorTest(!1);let W=u!==this.type;W&&C.traverse(function(q){q.material&&(Array.isArray(q.material)?q.material.forEach(U=>U.needsUpdate=!0):q.material.needsUpdate=!0)});for(let q=0,U=w.length;q<U;q++){let k=w[q],z=k.shadow;if(z===void 0){Ze("WebGLShadowMap:",k,"has no shadow.");continue}if(z.autoUpdate===!1&&z.needsUpdate===!1)continue;r.copy(z.mapSize);let ne=z.getFrameExtents();r.multiply(ne),s.copy(z.mapSize),(r.x>f||r.y>f)&&(r.x>f&&(s.x=Math.floor(f/ne.x),r.x=s.x*ne.x,z.mapSize.x=s.x),r.y>f&&(s.y=Math.floor(f/ne.y),r.y=s.y*ne.y,z.mapSize.y=s.y));let le=t.state.buffers.depth.getReversed();if(z.camera._reversedDepth=le,z.map===null||W===!0){if(z.map!==null&&(z.map.depthTexture!==null&&(z.map.depthTexture.dispose(),z.map.depthTexture=null),z.map.dispose()),this.type===ha){if(k.isPointLight){Ze("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}z.map=new ii(r.x,r.y,{format:ys,type:rr,minFilter:_n,magFilter:_n,generateMipmaps:!1}),z.map.texture.name=k.name+".shadowMap",z.map.depthTexture=new Pr(r.x,r.y,Ui),z.map.depthTexture.name=k.name+".shadowMapDepth",z.map.depthTexture.format=Ki,z.map.depthTexture.compareFunction=null,z.map.depthTexture.minFilter=fn,z.map.depthTexture.magFilter=fn}else k.isPointLight?(z.map=new Wf(r.x),z.map.depthTexture=new Ah(r.x,Di)):(z.map=new ii(r.x,r.y),z.map.depthTexture=new Pr(r.x,r.y,Di)),z.map.depthTexture.name=k.name+".shadowMap",z.map.depthTexture.format=Ki,this.type===Jl?(z.map.depthTexture.compareFunction=le?zf:kf,z.map.depthTexture.minFilter=_n,z.map.depthTexture.magFilter=_n):(z.map.depthTexture.compareFunction=null,z.map.depthTexture.minFilter=fn,z.map.depthTexture.magFilter=fn);z.camera.updateProjectionMatrix()}let me=z.map.isWebGLCubeRenderTarget?6:1;for(let Ce=0;Ce<me;Ce++){if(z.map.isWebGLCubeRenderTarget)t.setRenderTarget(z.map,Ce),t.clear();else{Ce===0&&(t.setRenderTarget(z.map),t.clear());let Be=z.getViewport(Ce);o.set(s.x*Be.x,s.y*Be.y,s.x*Be.z,s.y*Be.w),F.viewport(o)}if(k.isPointLight){let Be=z.camera,Qe=z.matrix,vt=k.distance||Be.far;vt!==Be.far&&(Be.far=vt,Be.updateProjectionMatrix()),lc.setFromMatrixPosition(k.matrixWorld),Be.position.copy(lc),Vg.copy(Be.position),Vg.add(hR[Ce]),Be.up.copy(fR[Ce]),Be.lookAt(Vg),Be.updateMatrixWorld(),Qe.makeTranslation(-lc.x,-lc.y,-lc.z),IS.multiplyMatrices(Be.projectionMatrix,Be.matrixWorldInverse),z._frustum.setFromProjectionMatrix(IS,Be.coordinateSystem,Be.reversedDepth)}else z.updateMatrices(k);i=z.getFrustum(),S(C,x,z.camera,k,this.type)}z.isPointLightShadow!==!0&&this.type===ha&&g(z,x),z.needsUpdate=!1}u=this.type,m.needsUpdate=!1,t.setRenderTarget(b,I,P)};function g(w,C){let x=e.update(y);h.defines.VSM_SAMPLES!==w.blurSamples&&(h.defines.VSM_SAMPLES=w.blurSamples,p.defines.VSM_SAMPLES=w.blurSamples,h.needsUpdate=!0,p.needsUpdate=!0),w.mapPass===null&&(w.mapPass=new ii(r.x,r.y,{format:ys,type:rr})),h.uniforms.shadow_pass.value=w.map.depthTexture,h.uniforms.resolution.value=w.mapSize,h.uniforms.radius.value=w.radius,t.setRenderTarget(w.mapPass),t.clear(),t.renderBufferDirect(C,null,x,h,y,null),p.uniforms.shadow_pass.value=w.mapPass.texture,p.uniforms.resolution.value=w.mapSize,p.uniforms.radius.value=w.radius,t.setRenderTarget(w.map),t.clear(),t.renderBufferDirect(C,null,x,p,y,null)}function v(w,C,x,b){let I=null,P=x.isPointLight===!0?w.customDistanceMaterial:w.customDepthMaterial;if(P!==void 0)I=P;else if(I=x.isPointLight===!0?l:a,t.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){let F=I.uuid,W=C.uuid,q=c[F];q===void 0&&(q={},c[F]=q);let U=q[W];U===void 0&&(U=I.clone(),q[W]=U,C.addEventListener("dispose",A)),I=U}if(I.visible=C.visible,I.wireframe=C.wireframe,b===ha?I.side=C.shadowSide!==null?C.shadowSide:C.side:I.side=C.shadowSide!==null?C.shadowSide:d[C.side],I.alphaMap=C.alphaMap,I.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,I.map=C.map,I.clipShadows=C.clipShadows,I.clippingPlanes=C.clippingPlanes,I.clipIntersection=C.clipIntersection,I.displacementMap=C.displacementMap,I.displacementScale=C.displacementScale,I.displacementBias=C.displacementBias,I.wireframeLinewidth=C.wireframeLinewidth,I.linewidth=C.linewidth,x.isPointLight===!0&&I.isMeshDistanceMaterial===!0){let F=t.properties.get(I);F.light=x}return I}function S(w,C,x,b,I){if(w.visible===!1)return;if(w.layers.test(C.layers)&&(w.isMesh||w.isLine||w.isPoints)&&(w.castShadow||w.receiveShadow&&I===ha)&&(!w.frustumCulled||i.intersectsObject(w))){w.modelViewMatrix.multiplyMatrices(x.matrixWorldInverse,w.matrixWorld);let W=e.update(w),q=w.material;if(Array.isArray(q)){let U=W.groups;for(let k=0,z=U.length;k<z;k++){let ne=U[k],le=q[ne.materialIndex];if(le&&le.visible){let me=v(w,le,b,I);w.onBeforeShadow(t,w,C,x,W,me,ne),t.renderBufferDirect(x,null,W,me,w,ne),w.onAfterShadow(t,w,C,x,W,me,ne)}}}else if(q.visible){let U=v(w,q,b,I);w.onBeforeShadow(t,w,C,x,W,U,null),t.renderBufferDirect(x,null,W,U,w,null),w.onAfterShadow(t,w,C,x,W,U,null)}}let F=w.children;for(let W=0,q=F.length;W<q;W++)S(F[W],C,x,b,I)}function A(w){w.target.removeEventListener("dispose",A);for(let x in c){let b=c[x],I=w.target.uuid;I in b&&(b[I].dispose(),delete b[I])}}}function pR(t,e){function n(){let D=!1,ge=new Yt,J=null,Re=new Yt(0,0,0,0);return{setMask:function(ae){J!==ae&&!D&&(t.colorMask(ae,ae,ae,ae),J=ae)},setLocked:function(ae){D=ae},setClear:function(ae,oe,He,We,It){It===!0&&(ae*=We,oe*=We,He*=We),ge.set(ae,oe,He,We),Re.equals(ge)===!1&&(t.clearColor(ae,oe,He,We),Re.copy(ge))},reset:function(){D=!1,J=null,Re.set(-1,0,0,0)}}}function i(){let D=!1,ge=!1,J=null,Re=null,ae=null;return{setReversed:function(oe){if(ge!==oe){let He=e.get("EXT_clip_control");oe?He.clipControlEXT(He.LOWER_LEFT_EXT,He.ZERO_TO_ONE_EXT):He.clipControlEXT(He.LOWER_LEFT_EXT,He.NEGATIVE_ONE_TO_ONE_EXT),ge=oe;let We=ae;ae=null,this.setClear(We)}},getReversed:function(){return ge},setTest:function(oe){oe?ce(t.DEPTH_TEST):Ve(t.DEPTH_TEST)},setMask:function(oe){J!==oe&&!D&&(t.depthMask(oe),J=oe)},setFunc:function(oe){if(ge&&(oe=nS[oe]),Re!==oe){switch(oe){case dh:t.depthFunc(t.NEVER);break;case ph:t.depthFunc(t.ALWAYS);break;case mh:t.depthFunc(t.LESS);break;case Xs:t.depthFunc(t.LEQUAL);break;case gh:t.depthFunc(t.EQUAL);break;case _h:t.depthFunc(t.GEQUAL);break;case vh:t.depthFunc(t.GREATER);break;case xh:t.depthFunc(t.NOTEQUAL);break;default:t.depthFunc(t.LEQUAL)}Re=oe}},setLocked:function(oe){D=oe},setClear:function(oe){ae!==oe&&(ae=oe,ge&&(oe=1-oe),t.clearDepth(oe))},reset:function(){D=!1,J=null,Re=null,ae=null,ge=!1}}}function r(){let D=!1,ge=null,J=null,Re=null,ae=null,oe=null,He=null,We=null,It=null;return{setTest:function(Mt){D||(Mt?ce(t.STENCIL_TEST):Ve(t.STENCIL_TEST))},setMask:function(Mt){ge!==Mt&&!D&&(t.stencilMask(Mt),ge=Mt)},setFunc:function(Mt,Yn,Lt){(J!==Mt||Re!==Yn||ae!==Lt)&&(t.stencilFunc(Mt,Yn,Lt),J=Mt,Re=Yn,ae=Lt)},setOp:function(Mt,Yn,Lt){(oe!==Mt||He!==Yn||We!==Lt)&&(t.stencilOp(Mt,Yn,Lt),oe=Mt,He=Yn,We=Lt)},setLocked:function(Mt){D=Mt},setClear:function(Mt){It!==Mt&&(t.clearStencil(Mt),It=Mt)},reset:function(){D=!1,ge=null,J=null,Re=null,ae=null,oe=null,He=null,We=null,It=null}}}let s=new n,o=new i,a=new r,l=new WeakMap,c=new WeakMap,f={},d={},h={},p=new WeakMap,_=[],y=null,m=!1,u=null,g=null,v=null,S=null,A=null,w=null,C=null,x=new ft(0,0,0),b=0,I=!1,P=null,F=null,W=null,q=null,U=null,k=t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS),z=!1,ne=0,le=t.getParameter(t.VERSION);le.indexOf("WebGL")!==-1?(ne=parseFloat(/^WebGL (\d)/.exec(le)[1]),z=ne>=1):le.indexOf("OpenGL ES")!==-1&&(ne=parseFloat(/^OpenGL ES (\d)/.exec(le)[1]),z=ne>=2);let me=null,Ce={},Be=t.getParameter(t.SCISSOR_BOX),Qe=t.getParameter(t.VIEWPORT),vt=new Yt().fromArray(Be),et=new Yt().fromArray(Qe);function te(D,ge,J,Re){let ae=new Uint8Array(4),oe=t.createTexture();t.bindTexture(D,oe),t.texParameteri(D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(D,t.TEXTURE_MAG_FILTER,t.NEAREST);for(let He=0;He<J;He++)D===t.TEXTURE_3D||D===t.TEXTURE_2D_ARRAY?t.texImage3D(ge,0,t.RGBA,1,1,Re,0,t.RGBA,t.UNSIGNED_BYTE,ae):t.texImage2D(ge+He,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,ae);return oe}let ye={};ye[t.TEXTURE_2D]=te(t.TEXTURE_2D,t.TEXTURE_2D,1),ye[t.TEXTURE_CUBE_MAP]=te(t.TEXTURE_CUBE_MAP,t.TEXTURE_CUBE_MAP_POSITIVE_X,6),ye[t.TEXTURE_2D_ARRAY]=te(t.TEXTURE_2D_ARRAY,t.TEXTURE_2D_ARRAY,1,1),ye[t.TEXTURE_3D]=te(t.TEXTURE_3D,t.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),ce(t.DEPTH_TEST),o.setFunc(Xs),Se(!1),ve(rg),ce(t.CULL_FACE),re(ir);function ce(D){f[D]!==!0&&(t.enable(D),f[D]=!0)}function Ve(D){f[D]!==!1&&(t.disable(D),f[D]=!1)}function qe(D,ge){return h[D]!==ge?(t.bindFramebuffer(D,ge),h[D]=ge,D===t.DRAW_FRAMEBUFFER&&(h[t.FRAMEBUFFER]=ge),D===t.FRAMEBUFFER&&(h[t.DRAW_FRAMEBUFFER]=ge),!0):!1}function $e(D,ge){let J=_,Re=!1;if(D){J=p.get(ge),J===void 0&&(J=[],p.set(ge,J));let ae=D.textures;if(J.length!==ae.length||J[0]!==t.COLOR_ATTACHMENT0){for(let oe=0,He=ae.length;oe<He;oe++)J[oe]=t.COLOR_ATTACHMENT0+oe;J.length=ae.length,Re=!0}}else J[0]!==t.BACK&&(J[0]=t.BACK,Re=!0);Re&&t.drawBuffers(J)}function dt(D){return y!==D?(t.useProgram(D),y=D,!0):!1}let Ue={[hs]:t.FUNC_ADD,[Ty]:t.FUNC_SUBTRACT,[by]:t.FUNC_REVERSE_SUBTRACT};Ue[Ay]=t.MIN,Ue[Cy]=t.MAX;let ie={[Ry]:t.ZERO,[Py]:t.ONE,[Iy]:t.SRC_COLOR,[hh]:t.SRC_ALPHA,[Oy]:t.SRC_ALPHA_SATURATE,[Uy]:t.DST_COLOR,[Ny]:t.DST_ALPHA,[Ly]:t.ONE_MINUS_SRC_COLOR,[fh]:t.ONE_MINUS_SRC_ALPHA,[Fy]:t.ONE_MINUS_DST_COLOR,[Dy]:t.ONE_MINUS_DST_ALPHA,[By]:t.CONSTANT_COLOR,[ky]:t.ONE_MINUS_CONSTANT_COLOR,[zy]:t.CONSTANT_ALPHA,[Vy]:t.ONE_MINUS_CONSTANT_ALPHA};function re(D,ge,J,Re,ae,oe,He,We,It,Mt){if(D===ir){m===!0&&(Ve(t.BLEND),m=!1);return}if(m===!1&&(ce(t.BLEND),m=!0),D!==Ey){if(D!==u||Mt!==I){if((g!==hs||A!==hs)&&(t.blendEquation(t.FUNC_ADD),g=hs,A=hs),Mt)switch(D){case Ws:t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case sg:t.blendFunc(t.ONE,t.ONE);break;case og:t.blendFuncSeparate(t.ZERO,t.ONE_MINUS_SRC_COLOR,t.ZERO,t.ONE);break;case ag:t.blendFuncSeparate(t.DST_COLOR,t.ONE_MINUS_SRC_ALPHA,t.ZERO,t.ONE);break;default:Je("WebGLState: Invalid blending: ",D);break}else switch(D){case Ws:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case sg:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE,t.ONE,t.ONE);break;case og:Je("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case ag:Je("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Je("WebGLState: Invalid blending: ",D);break}v=null,S=null,w=null,C=null,x.set(0,0,0),b=0,u=D,I=Mt}return}ae=ae||ge,oe=oe||J,He=He||Re,(ge!==g||ae!==A)&&(t.blendEquationSeparate(Ue[ge],Ue[ae]),g=ge,A=ae),(J!==v||Re!==S||oe!==w||He!==C)&&(t.blendFuncSeparate(ie[J],ie[Re],ie[oe],ie[He]),v=J,S=Re,w=oe,C=He),(We.equals(x)===!1||It!==b)&&(t.blendColor(We.r,We.g,We.b,It),x.copy(We),b=It),u=D,I=!1}function j(D,ge){D.side===nr?Ve(t.CULL_FACE):ce(t.CULL_FACE);let J=D.side===Bn;ge&&(J=!J),Se(J),D.blending===Ws&&D.transparent===!1?re(ir):re(D.blending,D.blendEquation,D.blendSrc,D.blendDst,D.blendEquationAlpha,D.blendSrcAlpha,D.blendDstAlpha,D.blendColor,D.blendAlpha,D.premultipliedAlpha),o.setFunc(D.depthFunc),o.setTest(D.depthTest),o.setMask(D.depthWrite),s.setMask(D.colorWrite);let Re=D.stencilWrite;a.setTest(Re),Re&&(a.setMask(D.stencilWriteMask),a.setFunc(D.stencilFunc,D.stencilRef,D.stencilFuncMask),a.setOp(D.stencilFail,D.stencilZFail,D.stencilZPass)),L(D.polygonOffset,D.polygonOffsetFactor,D.polygonOffsetUnits),D.alphaToCoverage===!0?ce(t.SAMPLE_ALPHA_TO_COVERAGE):Ve(t.SAMPLE_ALPHA_TO_COVERAGE)}function Se(D){P!==D&&(D?t.frontFace(t.CW):t.frontFace(t.CCW),P=D)}function ve(D){D!==My?(ce(t.CULL_FACE),D!==F&&(D===rg?t.cullFace(t.BACK):D===wy?t.cullFace(t.FRONT):t.cullFace(t.FRONT_AND_BACK))):Ve(t.CULL_FACE),F=D}function Ye(D){D!==W&&(z&&t.lineWidth(D),W=D)}function L(D,ge,J){D?(ce(t.POLYGON_OFFSET_FILL),(q!==ge||U!==J)&&(q=ge,U=J,o.getReversed()&&(ge=-ge),t.polygonOffset(ge,J))):Ve(t.POLYGON_OFFSET_FILL)}function tt(D){D?ce(t.SCISSOR_TEST):Ve(t.SCISSOR_TEST)}function ze(D){D===void 0&&(D=t.TEXTURE0+k-1),me!==D&&(t.activeTexture(D),me=D)}function Ke(D,ge,J){J===void 0&&(me===null?J=t.TEXTURE0+k-1:J=me);let Re=Ce[J];Re===void 0&&(Re={type:void 0,texture:void 0},Ce[J]=Re),(Re.type!==D||Re.texture!==ge)&&(me!==J&&(t.activeTexture(J),me=J),t.bindTexture(D,ge||ye[D]),Re.type=D,Re.texture=ge)}function fe(){let D=Ce[me];D!==void 0&&D.type!==void 0&&(t.bindTexture(D.type,null),D.type=void 0,D.texture=void 0)}function yt(){try{t.compressedTexImage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function T(){try{t.compressedTexImage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function M(){try{t.texSubImage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function B(){try{t.texSubImage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function K(){try{t.compressedTexSubImage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function se(){try{t.compressedTexSubImage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function de(){try{t.texStorage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function pe(){try{t.texStorage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function Y(){try{t.texImage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function ee(){try{t.texImage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function Ae(D){return d[D]!==void 0?d[D]:t.getParameter(D)}function De(D,ge){d[D]!==ge&&(t.pixelStorei(D,ge),d[D]=ge)}function _e(D){vt.equals(D)===!1&&(t.scissor(D.x,D.y,D.z,D.w),vt.copy(D))}function ue(D){et.equals(D)===!1&&(t.viewport(D.x,D.y,D.z,D.w),et.copy(D))}function nt(D,ge){let J=c.get(ge);J===void 0&&(J=new WeakMap,c.set(ge,J));let Re=J.get(D);Re===void 0&&(Re=t.getUniformBlockIndex(ge,D.name),J.set(D,Re))}function ot(D,ge){let Re=c.get(ge).get(D);l.get(ge)!==Re&&(t.uniformBlockBinding(ge,Re,D.__bindingPointIndex),l.set(ge,Re))}function ut(){t.disable(t.BLEND),t.disable(t.CULL_FACE),t.disable(t.DEPTH_TEST),t.disable(t.POLYGON_OFFSET_FILL),t.disable(t.SCISSOR_TEST),t.disable(t.STENCIL_TEST),t.disable(t.SAMPLE_ALPHA_TO_COVERAGE),t.blendEquation(t.FUNC_ADD),t.blendFunc(t.ONE,t.ZERO),t.blendFuncSeparate(t.ONE,t.ZERO,t.ONE,t.ZERO),t.blendColor(0,0,0,0),t.colorMask(!0,!0,!0,!0),t.clearColor(0,0,0,0),t.depthMask(!0),t.depthFunc(t.LESS),o.setReversed(!1),t.clearDepth(1),t.stencilMask(4294967295),t.stencilFunc(t.ALWAYS,0,4294967295),t.stencilOp(t.KEEP,t.KEEP,t.KEEP),t.clearStencil(0),t.cullFace(t.BACK),t.frontFace(t.CCW),t.polygonOffset(0,0),t.activeTexture(t.TEXTURE0),t.bindFramebuffer(t.FRAMEBUFFER,null),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),t.bindFramebuffer(t.READ_FRAMEBUFFER,null),t.useProgram(null),t.lineWidth(1),t.scissor(0,0,t.canvas.width,t.canvas.height),t.viewport(0,0,t.canvas.width,t.canvas.height),t.pixelStorei(t.PACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.BROWSER_DEFAULT_WEBGL),t.pixelStorei(t.PACK_ROW_LENGTH,0),t.pixelStorei(t.PACK_SKIP_PIXELS,0),t.pixelStorei(t.PACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_ROW_LENGTH,0),t.pixelStorei(t.UNPACK_IMAGE_HEIGHT,0),t.pixelStorei(t.UNPACK_SKIP_PIXELS,0),t.pixelStorei(t.UNPACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_SKIP_IMAGES,0),f={},d={},me=null,Ce={},h={},p=new WeakMap,_=[],y=null,m=!1,u=null,g=null,v=null,S=null,A=null,w=null,C=null,x=new ft(0,0,0),b=0,I=!1,P=null,F=null,W=null,q=null,U=null,vt.set(0,0,t.canvas.width,t.canvas.height),et.set(0,0,t.canvas.width,t.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:ce,disable:Ve,bindFramebuffer:qe,drawBuffers:$e,useProgram:dt,setBlending:re,setMaterial:j,setFlipSided:Se,setCullFace:ve,setLineWidth:Ye,setPolygonOffset:L,setScissorTest:tt,activeTexture:ze,bindTexture:Ke,unbindTexture:fe,compressedTexImage2D:yt,compressedTexImage3D:T,texImage2D:Y,texImage3D:ee,pixelStorei:De,getParameter:Ae,updateUBOMapping:nt,uniformBlockBinding:ot,texStorage2D:de,texStorage3D:pe,texSubImage2D:M,texSubImage3D:B,compressedTexSubImage2D:K,compressedTexSubImage3D:se,scissor:_e,viewport:ue,reset:ut}}function mR(t,e,n,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Te,f=new WeakMap,d=new Set,h,p=new WeakMap,_=!1;try{_=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function y(T,M){return _?new OffscreenCanvas(T,M):Tl("canvas")}function m(T,M,B){let K=1,se=yt(T);if((se.width>B||se.height>B)&&(K=B/Math.max(se.width,se.height)),K<1)if(typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&T instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&T instanceof ImageBitmap||typeof VideoFrame<"u"&&T instanceof VideoFrame){let de=Math.floor(K*se.width),pe=Math.floor(K*se.height);h===void 0&&(h=y(de,pe));let Y=M?y(de,pe):h;return Y.width=de,Y.height=pe,Y.getContext("2d").drawImage(T,0,0,de,pe),Ze("WebGLRenderer: Texture has been resized from ("+se.width+"x"+se.height+") to ("+de+"x"+pe+")."),Y}else return"data"in T&&Ze("WebGLRenderer: Image in DataTexture is too big ("+se.width+"x"+se.height+")."),T;return T}function u(T){return T.generateMipmaps}function g(T){t.generateMipmap(T)}function v(T){return T.isWebGLCubeRenderTarget?t.TEXTURE_CUBE_MAP:T.isWebGL3DRenderTarget?t.TEXTURE_3D:T.isWebGLArrayRenderTarget||T.isCompressedArrayTexture?t.TEXTURE_2D_ARRAY:t.TEXTURE_2D}function S(T,M,B,K,se,de=!1){if(T!==null){if(t[T]!==void 0)return t[T];Ze("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+T+"'")}let pe;K&&(pe=e.get("EXT_texture_norm16"),pe||Ze("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let Y=M;if(M===t.RED&&(B===t.FLOAT&&(Y=t.R32F),B===t.HALF_FLOAT&&(Y=t.R16F),B===t.UNSIGNED_BYTE&&(Y=t.R8),B===t.UNSIGNED_SHORT&&pe&&(Y=pe.R16_EXT),B===t.SHORT&&pe&&(Y=pe.R16_SNORM_EXT)),M===t.RED_INTEGER&&(B===t.UNSIGNED_BYTE&&(Y=t.R8UI),B===t.UNSIGNED_SHORT&&(Y=t.R16UI),B===t.UNSIGNED_INT&&(Y=t.R32UI),B===t.BYTE&&(Y=t.R8I),B===t.SHORT&&(Y=t.R16I),B===t.INT&&(Y=t.R32I)),M===t.RG&&(B===t.FLOAT&&(Y=t.RG32F),B===t.HALF_FLOAT&&(Y=t.RG16F),B===t.UNSIGNED_BYTE&&(Y=t.RG8),B===t.UNSIGNED_SHORT&&pe&&(Y=pe.RG16_EXT),B===t.SHORT&&pe&&(Y=pe.RG16_SNORM_EXT)),M===t.RG_INTEGER&&(B===t.UNSIGNED_BYTE&&(Y=t.RG8UI),B===t.UNSIGNED_SHORT&&(Y=t.RG16UI),B===t.UNSIGNED_INT&&(Y=t.RG32UI),B===t.BYTE&&(Y=t.RG8I),B===t.SHORT&&(Y=t.RG16I),B===t.INT&&(Y=t.RG32I)),M===t.RGB_INTEGER&&(B===t.UNSIGNED_BYTE&&(Y=t.RGB8UI),B===t.UNSIGNED_SHORT&&(Y=t.RGB16UI),B===t.UNSIGNED_INT&&(Y=t.RGB32UI),B===t.BYTE&&(Y=t.RGB8I),B===t.SHORT&&(Y=t.RGB16I),B===t.INT&&(Y=t.RGB32I)),M===t.RGBA_INTEGER&&(B===t.UNSIGNED_BYTE&&(Y=t.RGBA8UI),B===t.UNSIGNED_SHORT&&(Y=t.RGBA16UI),B===t.UNSIGNED_INT&&(Y=t.RGBA32UI),B===t.BYTE&&(Y=t.RGBA8I),B===t.SHORT&&(Y=t.RGBA16I),B===t.INT&&(Y=t.RGBA32I)),M===t.RGB&&(B===t.UNSIGNED_SHORT&&pe&&(Y=pe.RGB16_EXT),B===t.SHORT&&pe&&(Y=pe.RGB16_SNORM_EXT),B===t.UNSIGNED_INT_5_9_9_9_REV&&(Y=t.RGB9_E5),B===t.UNSIGNED_INT_10F_11F_11F_REV&&(Y=t.R11F_G11F_B10F)),M===t.RGBA){let ee=de?El:xt.getTransfer(se);B===t.FLOAT&&(Y=t.RGBA32F),B===t.HALF_FLOAT&&(Y=t.RGBA16F),B===t.UNSIGNED_BYTE&&(Y=ee===Rt?t.SRGB8_ALPHA8:t.RGBA8),B===t.UNSIGNED_SHORT&&pe&&(Y=pe.RGBA16_EXT),B===t.SHORT&&pe&&(Y=pe.RGBA16_SNORM_EXT),B===t.UNSIGNED_SHORT_4_4_4_4&&(Y=t.RGBA4),B===t.UNSIGNED_SHORT_5_5_5_1&&(Y=t.RGB5_A1)}return(Y===t.R16F||Y===t.R32F||Y===t.RG16F||Y===t.RG32F||Y===t.RGBA16F||Y===t.RGBA32F)&&e.get("EXT_color_buffer_float"),Y}function A(T,M){let B;return T?M===null||M===Di||M===da?B=t.DEPTH24_STENCIL8:M===Ui?B=t.DEPTH32F_STENCIL8:M===fa&&(B=t.DEPTH24_STENCIL8,Ze("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):M===null||M===Di||M===da?B=t.DEPTH_COMPONENT24:M===Ui?B=t.DEPTH_COMPONENT32F:M===fa&&(B=t.DEPTH_COMPONENT16),B}function w(T,M){return u(T)===!0||T.isFramebufferTexture&&T.minFilter!==fn&&T.minFilter!==_n?Math.log2(Math.max(M.width,M.height))+1:T.mipmaps!==void 0&&T.mipmaps.length>0?T.mipmaps.length:T.isCompressedTexture&&Array.isArray(T.image)?M.mipmaps.length:1}function C(T){let M=T.target;M.removeEventListener("dispose",C),b(M),M.isVideoTexture&&f.delete(M),M.isHTMLTexture&&d.delete(M)}function x(T){let M=T.target;M.removeEventListener("dispose",x),P(M)}function b(T){let M=i.get(T);if(M.__webglInit===void 0)return;let B=T.source,K=p.get(B);if(K){let se=K[M.__cacheKey];se.usedTimes--,se.usedTimes===0&&I(T),Object.keys(K).length===0&&p.delete(B)}i.remove(T)}function I(T){let M=i.get(T);t.deleteTexture(M.__webglTexture);let B=T.source,K=p.get(B);delete K[M.__cacheKey],o.memory.textures--}function P(T){let M=i.get(T);if(T.depthTexture&&(T.depthTexture.dispose(),i.remove(T.depthTexture)),T.isWebGLCubeRenderTarget)for(let K=0;K<6;K++){if(Array.isArray(M.__webglFramebuffer[K]))for(let se=0;se<M.__webglFramebuffer[K].length;se++)t.deleteFramebuffer(M.__webglFramebuffer[K][se]);else t.deleteFramebuffer(M.__webglFramebuffer[K]);M.__webglDepthbuffer&&t.deleteRenderbuffer(M.__webglDepthbuffer[K])}else{if(Array.isArray(M.__webglFramebuffer))for(let K=0;K<M.__webglFramebuffer.length;K++)t.deleteFramebuffer(M.__webglFramebuffer[K]);else t.deleteFramebuffer(M.__webglFramebuffer);if(M.__webglDepthbuffer&&t.deleteRenderbuffer(M.__webglDepthbuffer),M.__webglMultisampledFramebuffer&&t.deleteFramebuffer(M.__webglMultisampledFramebuffer),M.__webglColorRenderbuffer)for(let K=0;K<M.__webglColorRenderbuffer.length;K++)M.__webglColorRenderbuffer[K]&&t.deleteRenderbuffer(M.__webglColorRenderbuffer[K]);M.__webglDepthRenderbuffer&&t.deleteRenderbuffer(M.__webglDepthRenderbuffer)}let B=T.textures;for(let K=0,se=B.length;K<se;K++){let de=i.get(B[K]);de.__webglTexture&&(t.deleteTexture(de.__webglTexture),o.memory.textures--),i.remove(B[K])}i.remove(T)}let F=0;function W(){F=0}function q(){return F}function U(T){F=T}function k(){let T=F;return T>=r.maxTextures&&Ze("WebGLTextures: Trying to use "+T+" texture units while this GPU supports only "+r.maxTextures),F+=1,T}function z(T){let M=[];return M.push(T.wrapS),M.push(T.wrapT),M.push(T.wrapR||0),M.push(T.magFilter),M.push(T.minFilter),M.push(T.anisotropy),M.push(T.internalFormat),M.push(T.format),M.push(T.type),M.push(T.generateMipmaps),M.push(T.premultiplyAlpha),M.push(T.flipY),M.push(T.unpackAlignment),M.push(T.colorSpace),M.join()}function ne(T,M){let B=i.get(T);if(T.isVideoTexture&&Ke(T),T.isRenderTargetTexture===!1&&T.isExternalTexture!==!0&&T.version>0&&B.__version!==T.version){let K=T.image;if(K===null)Ze("WebGLRenderer: Texture marked for update but no image data found.");else if(K.complete===!1)Ze("WebGLRenderer: Texture marked for update but image is incomplete");else{Ve(B,T,M);return}}else T.isExternalTexture&&(B.__webglTexture=T.sourceTexture?T.sourceTexture:null);n.bindTexture(t.TEXTURE_2D,B.__webglTexture,t.TEXTURE0+M)}function le(T,M){let B=i.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&B.__version!==T.version){Ve(B,T,M);return}else T.isExternalTexture&&(B.__webglTexture=T.sourceTexture?T.sourceTexture:null);n.bindTexture(t.TEXTURE_2D_ARRAY,B.__webglTexture,t.TEXTURE0+M)}function me(T,M){let B=i.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&B.__version!==T.version){Ve(B,T,M);return}n.bindTexture(t.TEXTURE_3D,B.__webglTexture,t.TEXTURE0+M)}function Ce(T,M){let B=i.get(T);if(T.isCubeDepthTexture!==!0&&T.version>0&&B.__version!==T.version){qe(B,T,M);return}n.bindTexture(t.TEXTURE_CUBE_MAP,B.__webglTexture,t.TEXTURE0+M)}let Be={[qs]:t.REPEAT,[Zi]:t.CLAMP_TO_EDGE,[yh]:t.MIRRORED_REPEAT},Qe={[fn]:t.NEAREST,[Wy]:t.NEAREST_MIPMAP_NEAREST,[ec]:t.NEAREST_MIPMAP_LINEAR,[_n]:t.LINEAR,[ef]:t.LINEAR_MIPMAP_NEAREST,[vs]:t.LINEAR_MIPMAP_LINEAR},vt={[Yy]:t.NEVER,[jy]:t.ALWAYS,[$y]:t.LESS,[kf]:t.LEQUAL,[Zy]:t.EQUAL,[zf]:t.GEQUAL,[Ky]:t.GREATER,[Jy]:t.NOTEQUAL};function et(T,M){if(M.type===Ui&&e.has("OES_texture_float_linear")===!1&&(M.magFilter===_n||M.magFilter===ef||M.magFilter===ec||M.magFilter===vs||M.minFilter===_n||M.minFilter===ef||M.minFilter===ec||M.minFilter===vs)&&Ze("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),t.texParameteri(T,t.TEXTURE_WRAP_S,Be[M.wrapS]),t.texParameteri(T,t.TEXTURE_WRAP_T,Be[M.wrapT]),(T===t.TEXTURE_3D||T===t.TEXTURE_2D_ARRAY)&&t.texParameteri(T,t.TEXTURE_WRAP_R,Be[M.wrapR]),t.texParameteri(T,t.TEXTURE_MAG_FILTER,Qe[M.magFilter]),t.texParameteri(T,t.TEXTURE_MIN_FILTER,Qe[M.minFilter]),M.compareFunction&&(t.texParameteri(T,t.TEXTURE_COMPARE_MODE,t.COMPARE_REF_TO_TEXTURE),t.texParameteri(T,t.TEXTURE_COMPARE_FUNC,vt[M.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(M.magFilter===fn||M.minFilter!==ec&&M.minFilter!==vs||M.type===Ui&&e.has("OES_texture_float_linear")===!1)return;if(M.anisotropy>1||i.get(M).__currentAnisotropy){let B=e.get("EXT_texture_filter_anisotropic");t.texParameterf(T,B.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(M.anisotropy,r.getMaxAnisotropy())),i.get(M).__currentAnisotropy=M.anisotropy}}}function te(T,M){let B=!1;T.__webglInit===void 0&&(T.__webglInit=!0,M.addEventListener("dispose",C));let K=M.source,se=p.get(K);se===void 0&&(se={},p.set(K,se));let de=z(M);if(de!==T.__cacheKey){se[de]===void 0&&(se[de]={texture:t.createTexture(),usedTimes:0},o.memory.textures++,B=!0),se[de].usedTimes++;let pe=se[T.__cacheKey];pe!==void 0&&(se[T.__cacheKey].usedTimes--,pe.usedTimes===0&&I(M)),T.__cacheKey=de,T.__webglTexture=se[de].texture}return B}function ye(T,M,B){return Math.floor(Math.floor(T/B)/M)}function ce(T,M,B,K){let de=T.updateRanges;if(de.length===0)n.texSubImage2D(t.TEXTURE_2D,0,0,0,M.width,M.height,B,K,M.data);else{de.sort((De,_e)=>De.start-_e.start);let pe=0;for(let De=1;De<de.length;De++){let _e=de[pe],ue=de[De],nt=_e.start+_e.count,ot=ye(ue.start,M.width,4),ut=ye(_e.start,M.width,4);ue.start<=nt+1&&ot===ut&&ye(ue.start+ue.count-1,M.width,4)===ot?_e.count=Math.max(_e.count,ue.start+ue.count-_e.start):(++pe,de[pe]=ue)}de.length=pe+1;let Y=n.getParameter(t.UNPACK_ROW_LENGTH),ee=n.getParameter(t.UNPACK_SKIP_PIXELS),Ae=n.getParameter(t.UNPACK_SKIP_ROWS);n.pixelStorei(t.UNPACK_ROW_LENGTH,M.width);for(let De=0,_e=de.length;De<_e;De++){let ue=de[De],nt=Math.floor(ue.start/4),ot=Math.ceil(ue.count/4),ut=nt%M.width,D=Math.floor(nt/M.width),ge=ot,J=1;n.pixelStorei(t.UNPACK_SKIP_PIXELS,ut),n.pixelStorei(t.UNPACK_SKIP_ROWS,D),n.texSubImage2D(t.TEXTURE_2D,0,ut,D,ge,J,B,K,M.data)}T.clearUpdateRanges(),n.pixelStorei(t.UNPACK_ROW_LENGTH,Y),n.pixelStorei(t.UNPACK_SKIP_PIXELS,ee),n.pixelStorei(t.UNPACK_SKIP_ROWS,Ae)}}function Ve(T,M,B){let K=t.TEXTURE_2D;(M.isDataArrayTexture||M.isCompressedArrayTexture)&&(K=t.TEXTURE_2D_ARRAY),M.isData3DTexture&&(K=t.TEXTURE_3D);let se=te(T,M),de=M.source;n.bindTexture(K,T.__webglTexture,t.TEXTURE0+B);let pe=i.get(de);if(de.version!==pe.__version||se===!0){if(n.activeTexture(t.TEXTURE0+B),(typeof ImageBitmap<"u"&&M.image instanceof ImageBitmap)===!1){let J=xt.getPrimaries(xt.workingColorSpace),Re=M.colorSpace===Ir?null:xt.getPrimaries(M.colorSpace),ae=M.colorSpace===Ir||J===Re?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,M.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,M.premultiplyAlpha),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,ae)}n.pixelStorei(t.UNPACK_ALIGNMENT,M.unpackAlignment);let ee=m(M.image,!1,r.maxTextureSize);ee=fe(M,ee);let Ae=s.convert(M.format,M.colorSpace),De=s.convert(M.type),_e=S(M.internalFormat,Ae,De,M.normalized,M.colorSpace,M.isVideoTexture);et(K,M);let ue,nt=M.mipmaps,ot=M.isVideoTexture!==!0,ut=pe.__version===void 0||se===!0,D=de.dataReady,ge=w(M,ee);if(M.isDepthTexture)_e=A(M.format===xs,M.type),ut&&(ot?n.texStorage2D(t.TEXTURE_2D,1,_e,ee.width,ee.height):n.texImage2D(t.TEXTURE_2D,0,_e,ee.width,ee.height,0,Ae,De,null));else if(M.isDataTexture)if(nt.length>0){ot&&ut&&n.texStorage2D(t.TEXTURE_2D,ge,_e,nt[0].width,nt[0].height);for(let J=0,Re=nt.length;J<Re;J++)ue=nt[J],ot?D&&n.texSubImage2D(t.TEXTURE_2D,J,0,0,ue.width,ue.height,Ae,De,ue.data):n.texImage2D(t.TEXTURE_2D,J,_e,ue.width,ue.height,0,Ae,De,ue.data);M.generateMipmaps=!1}else ot?(ut&&n.texStorage2D(t.TEXTURE_2D,ge,_e,ee.width,ee.height),D&&ce(M,ee,Ae,De)):n.texImage2D(t.TEXTURE_2D,0,_e,ee.width,ee.height,0,Ae,De,ee.data);else if(M.isCompressedTexture)if(M.isCompressedArrayTexture){ot&&ut&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ge,_e,nt[0].width,nt[0].height,ee.depth);for(let J=0,Re=nt.length;J<Re;J++)if(ue=nt[J],M.format!==vi)if(Ae!==null)if(ot){if(D)if(M.layerUpdates.size>0){let ae=Pg(ue.width,ue.height,M.format,M.type);for(let oe of M.layerUpdates){let He=ue.data.subarray(oe*ae/ue.data.BYTES_PER_ELEMENT,(oe+1)*ae/ue.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,J,0,0,oe,ue.width,ue.height,1,Ae,He)}M.clearLayerUpdates()}else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,J,0,0,0,ue.width,ue.height,ee.depth,Ae,ue.data)}else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY,J,_e,ue.width,ue.height,ee.depth,0,ue.data,0,0);else Ze("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else ot?D&&n.texSubImage3D(t.TEXTURE_2D_ARRAY,J,0,0,0,ue.width,ue.height,ee.depth,Ae,De,ue.data):n.texImage3D(t.TEXTURE_2D_ARRAY,J,_e,ue.width,ue.height,ee.depth,0,Ae,De,ue.data)}else{ot&&ut&&n.texStorage2D(t.TEXTURE_2D,ge,_e,nt[0].width,nt[0].height);for(let J=0,Re=nt.length;J<Re;J++)ue=nt[J],M.format!==vi?Ae!==null?ot?D&&n.compressedTexSubImage2D(t.TEXTURE_2D,J,0,0,ue.width,ue.height,Ae,ue.data):n.compressedTexImage2D(t.TEXTURE_2D,J,_e,ue.width,ue.height,0,ue.data):Ze("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):ot?D&&n.texSubImage2D(t.TEXTURE_2D,J,0,0,ue.width,ue.height,Ae,De,ue.data):n.texImage2D(t.TEXTURE_2D,J,_e,ue.width,ue.height,0,Ae,De,ue.data)}else if(M.isDataArrayTexture)if(ot){if(ut&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ge,_e,ee.width,ee.height,ee.depth),D)if(M.layerUpdates.size>0){let J=Pg(ee.width,ee.height,M.format,M.type);for(let Re of M.layerUpdates){let ae=ee.data.subarray(Re*J/ee.data.BYTES_PER_ELEMENT,(Re+1)*J/ee.data.BYTES_PER_ELEMENT);n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,Re,ee.width,ee.height,1,Ae,De,ae)}M.clearLayerUpdates()}else n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,0,ee.width,ee.height,ee.depth,Ae,De,ee.data)}else n.texImage3D(t.TEXTURE_2D_ARRAY,0,_e,ee.width,ee.height,ee.depth,0,Ae,De,ee.data);else if(M.isData3DTexture)ot?(ut&&n.texStorage3D(t.TEXTURE_3D,ge,_e,ee.width,ee.height,ee.depth),D&&n.texSubImage3D(t.TEXTURE_3D,0,0,0,0,ee.width,ee.height,ee.depth,Ae,De,ee.data)):n.texImage3D(t.TEXTURE_3D,0,_e,ee.width,ee.height,ee.depth,0,Ae,De,ee.data);else if(M.isFramebufferTexture){if(ut)if(ot)n.texStorage2D(t.TEXTURE_2D,ge,_e,ee.width,ee.height);else{let J=ee.width,Re=ee.height;for(let ae=0;ae<ge;ae++)n.texImage2D(t.TEXTURE_2D,ae,_e,J,Re,0,Ae,De,null),J>>=1,Re>>=1}}else if(M.isHTMLTexture){if("texElementImage2D"in t){let J=t.canvas;if(J.hasAttribute("layoutsubtree")||J.setAttribute("layoutsubtree","true"),ee.parentNode!==J){J.appendChild(ee),d.add(M),J.onpaint=We=>{let It=We.changedElements;for(let Mt of d)It.includes(Mt.image)&&(Mt.needsUpdate=!0)},J.requestPaint();return}let Re=0,ae=t.RGBA,oe=t.RGBA,He=t.UNSIGNED_BYTE;t.texElementImage2D(t.TEXTURE_2D,Re,ae,oe,He,ee),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE)}}else if(nt.length>0){if(ot&&ut){let J=yt(nt[0]);n.texStorage2D(t.TEXTURE_2D,ge,_e,J.width,J.height)}for(let J=0,Re=nt.length;J<Re;J++)ue=nt[J],ot?D&&n.texSubImage2D(t.TEXTURE_2D,J,0,0,Ae,De,ue):n.texImage2D(t.TEXTURE_2D,J,_e,Ae,De,ue);M.generateMipmaps=!1}else if(ot){if(ut){let J=yt(ee);n.texStorage2D(t.TEXTURE_2D,ge,_e,J.width,J.height)}D&&n.texSubImage2D(t.TEXTURE_2D,0,0,0,Ae,De,ee)}else n.texImage2D(t.TEXTURE_2D,0,_e,Ae,De,ee);u(M)&&g(K),pe.__version=de.version,M.onUpdate&&M.onUpdate(M)}T.__version=M.version}function qe(T,M,B){if(M.image.length!==6)return;let K=te(T,M),se=M.source;n.bindTexture(t.TEXTURE_CUBE_MAP,T.__webglTexture,t.TEXTURE0+B);let de=i.get(se);if(se.version!==de.__version||K===!0){n.activeTexture(t.TEXTURE0+B);let pe=xt.getPrimaries(xt.workingColorSpace),Y=M.colorSpace===Ir?null:xt.getPrimaries(M.colorSpace),ee=M.colorSpace===Ir||pe===Y?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,M.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,M.premultiplyAlpha),n.pixelStorei(t.UNPACK_ALIGNMENT,M.unpackAlignment),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,ee);let Ae=M.isCompressedTexture||M.image[0].isCompressedTexture,De=M.image[0]&&M.image[0].isDataTexture,_e=[];for(let oe=0;oe<6;oe++)!Ae&&!De?_e[oe]=m(M.image[oe],!0,r.maxCubemapSize):_e[oe]=De?M.image[oe].image:M.image[oe],_e[oe]=fe(M,_e[oe]);let ue=_e[0],nt=s.convert(M.format,M.colorSpace),ot=s.convert(M.type),ut=S(M.internalFormat,nt,ot,M.normalized,M.colorSpace),D=M.isVideoTexture!==!0,ge=de.__version===void 0||K===!0,J=se.dataReady,Re=w(M,ue);et(t.TEXTURE_CUBE_MAP,M);let ae;if(Ae){D&&ge&&n.texStorage2D(t.TEXTURE_CUBE_MAP,Re,ut,ue.width,ue.height);for(let oe=0;oe<6;oe++){ae=_e[oe].mipmaps;for(let He=0;He<ae.length;He++){let We=ae[He];M.format!==vi?nt!==null?D?J&&n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,He,0,0,We.width,We.height,nt,We.data):n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,He,ut,We.width,We.height,0,We.data):Ze("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):D?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,He,0,0,We.width,We.height,nt,ot,We.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,He,ut,We.width,We.height,0,nt,ot,We.data)}}}else{if(ae=M.mipmaps,D&&ge){ae.length>0&&Re++;let oe=yt(_e[0]);n.texStorage2D(t.TEXTURE_CUBE_MAP,Re,ut,oe.width,oe.height)}for(let oe=0;oe<6;oe++)if(De){D?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,_e[oe].width,_e[oe].height,nt,ot,_e[oe].data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,ut,_e[oe].width,_e[oe].height,0,nt,ot,_e[oe].data);for(let He=0;He<ae.length;He++){let It=ae[He].image[oe].image;D?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,He+1,0,0,It.width,It.height,nt,ot,It.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,He+1,ut,It.width,It.height,0,nt,ot,It.data)}}else{D?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,nt,ot,_e[oe]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,ut,nt,ot,_e[oe]);for(let He=0;He<ae.length;He++){let We=ae[He];D?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,He+1,0,0,nt,ot,We.image[oe]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,He+1,ut,nt,ot,We.image[oe])}}}u(M)&&g(t.TEXTURE_CUBE_MAP),de.__version=se.version,M.onUpdate&&M.onUpdate(M)}T.__version=M.version}function $e(T,M,B,K,se,de){let pe=s.convert(B.format,B.colorSpace),Y=s.convert(B.type),ee=S(B.internalFormat,pe,Y,B.normalized,B.colorSpace),Ae=i.get(M),De=i.get(B);if(De.__renderTarget=M,!Ae.__hasExternalTextures){let _e=Math.max(1,M.width>>de),ue=Math.max(1,M.height>>de);se===t.TEXTURE_3D||se===t.TEXTURE_2D_ARRAY?n.texImage3D(se,de,ee,_e,ue,M.depth,0,pe,Y,null):n.texImage2D(se,de,ee,_e,ue,0,pe,Y,null)}n.bindFramebuffer(t.FRAMEBUFFER,T),ze(M)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,K,se,De.__webglTexture,0,tt(M)):(se===t.TEXTURE_2D||se>=t.TEXTURE_CUBE_MAP_POSITIVE_X&&se<=t.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&t.framebufferTexture2D(t.FRAMEBUFFER,K,se,De.__webglTexture,de),n.bindFramebuffer(t.FRAMEBUFFER,null)}function dt(T,M,B){if(t.bindRenderbuffer(t.RENDERBUFFER,T),M.depthBuffer){let K=M.depthTexture,se=K&&K.isDepthTexture?K.type:null,de=A(M.stencilBuffer,se),pe=M.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;ze(M)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,tt(M),de,M.width,M.height):B?t.renderbufferStorageMultisample(t.RENDERBUFFER,tt(M),de,M.width,M.height):t.renderbufferStorage(t.RENDERBUFFER,de,M.width,M.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,pe,t.RENDERBUFFER,T)}else{let K=M.textures;for(let se=0;se<K.length;se++){let de=K[se],pe=s.convert(de.format,de.colorSpace),Y=s.convert(de.type),ee=S(de.internalFormat,pe,Y,de.normalized,de.colorSpace);ze(M)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,tt(M),ee,M.width,M.height):B?t.renderbufferStorageMultisample(t.RENDERBUFFER,tt(M),ee,M.width,M.height):t.renderbufferStorage(t.RENDERBUFFER,ee,M.width,M.height)}}t.bindRenderbuffer(t.RENDERBUFFER,null)}function Ue(T,M,B){let K=M.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(t.FRAMEBUFFER,T),!(M.depthTexture&&M.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let se=i.get(M.depthTexture);if(se.__renderTarget=M,(!se.__webglTexture||M.depthTexture.image.width!==M.width||M.depthTexture.image.height!==M.height)&&(M.depthTexture.image.width=M.width,M.depthTexture.image.height=M.height,M.depthTexture.needsUpdate=!0),K){if(se.__webglInit===void 0&&(se.__webglInit=!0,M.depthTexture.addEventListener("dispose",C)),se.__webglTexture===void 0){se.__webglTexture=t.createTexture(),n.bindTexture(t.TEXTURE_CUBE_MAP,se.__webglTexture),et(t.TEXTURE_CUBE_MAP,M.depthTexture);let Ae=s.convert(M.depthTexture.format),De=s.convert(M.depthTexture.type),_e;M.depthTexture.format===Ki?_e=t.DEPTH_COMPONENT24:M.depthTexture.format===xs&&(_e=t.DEPTH24_STENCIL8);for(let ue=0;ue<6;ue++)t.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+ue,0,_e,M.width,M.height,0,Ae,De,null)}}else ne(M.depthTexture,0);let de=se.__webglTexture,pe=tt(M),Y=K?t.TEXTURE_CUBE_MAP_POSITIVE_X+B:t.TEXTURE_2D,ee=M.depthTexture.format===xs?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;if(M.depthTexture.format===Ki)ze(M)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,ee,Y,de,0,pe):t.framebufferTexture2D(t.FRAMEBUFFER,ee,Y,de,0);else if(M.depthTexture.format===xs)ze(M)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,ee,Y,de,0,pe):t.framebufferTexture2D(t.FRAMEBUFFER,ee,Y,de,0);else throw new Error("Unknown depthTexture format")}function ie(T){let M=i.get(T),B=T.isWebGLCubeRenderTarget===!0;if(M.__boundDepthTexture!==T.depthTexture){let K=T.depthTexture;if(M.__depthDisposeCallback&&M.__depthDisposeCallback(),K){let se=()=>{delete M.__boundDepthTexture,delete M.__depthDisposeCallback,K.removeEventListener("dispose",se)};K.addEventListener("dispose",se),M.__depthDisposeCallback=se}M.__boundDepthTexture=K}if(T.depthTexture&&!M.__autoAllocateDepthBuffer)if(B)for(let K=0;K<6;K++)Ue(M.__webglFramebuffer[K],T,K);else{let K=T.texture.mipmaps;K&&K.length>0?Ue(M.__webglFramebuffer[0],T,0):Ue(M.__webglFramebuffer,T,0)}else if(B){M.__webglDepthbuffer=[];for(let K=0;K<6;K++)if(n.bindFramebuffer(t.FRAMEBUFFER,M.__webglFramebuffer[K]),M.__webglDepthbuffer[K]===void 0)M.__webglDepthbuffer[K]=t.createRenderbuffer(),dt(M.__webglDepthbuffer[K],T,!1);else{let se=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,de=M.__webglDepthbuffer[K];t.bindRenderbuffer(t.RENDERBUFFER,de),t.framebufferRenderbuffer(t.FRAMEBUFFER,se,t.RENDERBUFFER,de)}}else{let K=T.texture.mipmaps;if(K&&K.length>0?n.bindFramebuffer(t.FRAMEBUFFER,M.__webglFramebuffer[0]):n.bindFramebuffer(t.FRAMEBUFFER,M.__webglFramebuffer),M.__webglDepthbuffer===void 0)M.__webglDepthbuffer=t.createRenderbuffer(),dt(M.__webglDepthbuffer,T,!1);else{let se=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,de=M.__webglDepthbuffer;t.bindRenderbuffer(t.RENDERBUFFER,de),t.framebufferRenderbuffer(t.FRAMEBUFFER,se,t.RENDERBUFFER,de)}}n.bindFramebuffer(t.FRAMEBUFFER,null)}function re(T,M,B){let K=i.get(T);M!==void 0&&$e(K.__webglFramebuffer,T,T.texture,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,0),B!==void 0&&ie(T)}function j(T){let M=T.texture,B=i.get(T),K=i.get(M);T.addEventListener("dispose",x);let se=T.textures,de=T.isWebGLCubeRenderTarget===!0,pe=se.length>1;if(pe||(K.__webglTexture===void 0&&(K.__webglTexture=t.createTexture()),K.__version=M.version,o.memory.textures++),de){B.__webglFramebuffer=[];for(let Y=0;Y<6;Y++)if(M.mipmaps&&M.mipmaps.length>0){B.__webglFramebuffer[Y]=[];for(let ee=0;ee<M.mipmaps.length;ee++)B.__webglFramebuffer[Y][ee]=t.createFramebuffer()}else B.__webglFramebuffer[Y]=t.createFramebuffer()}else{if(M.mipmaps&&M.mipmaps.length>0){B.__webglFramebuffer=[];for(let Y=0;Y<M.mipmaps.length;Y++)B.__webglFramebuffer[Y]=t.createFramebuffer()}else B.__webglFramebuffer=t.createFramebuffer();if(pe)for(let Y=0,ee=se.length;Y<ee;Y++){let Ae=i.get(se[Y]);Ae.__webglTexture===void 0&&(Ae.__webglTexture=t.createTexture(),o.memory.textures++)}if(T.samples>0&&ze(T)===!1){B.__webglMultisampledFramebuffer=t.createFramebuffer(),B.__webglColorRenderbuffer=[],n.bindFramebuffer(t.FRAMEBUFFER,B.__webglMultisampledFramebuffer);for(let Y=0;Y<se.length;Y++){let ee=se[Y];B.__webglColorRenderbuffer[Y]=t.createRenderbuffer(),t.bindRenderbuffer(t.RENDERBUFFER,B.__webglColorRenderbuffer[Y]);let Ae=s.convert(ee.format,ee.colorSpace),De=s.convert(ee.type),_e=S(ee.internalFormat,Ae,De,ee.normalized,ee.colorSpace,T.isXRRenderTarget===!0),ue=tt(T);t.renderbufferStorageMultisample(t.RENDERBUFFER,ue,_e,T.width,T.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Y,t.RENDERBUFFER,B.__webglColorRenderbuffer[Y])}t.bindRenderbuffer(t.RENDERBUFFER,null),T.depthBuffer&&(B.__webglDepthRenderbuffer=t.createRenderbuffer(),dt(B.__webglDepthRenderbuffer,T,!0)),n.bindFramebuffer(t.FRAMEBUFFER,null)}}if(de){n.bindTexture(t.TEXTURE_CUBE_MAP,K.__webglTexture),et(t.TEXTURE_CUBE_MAP,M);for(let Y=0;Y<6;Y++)if(M.mipmaps&&M.mipmaps.length>0)for(let ee=0;ee<M.mipmaps.length;ee++)$e(B.__webglFramebuffer[Y][ee],T,M,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Y,ee);else $e(B.__webglFramebuffer[Y],T,M,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Y,0);u(M)&&g(t.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(pe){for(let Y=0,ee=se.length;Y<ee;Y++){let Ae=se[Y],De=i.get(Ae),_e=t.TEXTURE_2D;(T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(_e=T.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(_e,De.__webglTexture),et(_e,Ae),$e(B.__webglFramebuffer,T,Ae,t.COLOR_ATTACHMENT0+Y,_e,0),u(Ae)&&g(_e)}n.unbindTexture()}else{let Y=t.TEXTURE_2D;if((T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(Y=T.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(Y,K.__webglTexture),et(Y,M),M.mipmaps&&M.mipmaps.length>0)for(let ee=0;ee<M.mipmaps.length;ee++)$e(B.__webglFramebuffer[ee],T,M,t.COLOR_ATTACHMENT0,Y,ee);else $e(B.__webglFramebuffer,T,M,t.COLOR_ATTACHMENT0,Y,0);u(M)&&g(Y),n.unbindTexture()}T.depthBuffer&&ie(T)}function Se(T){let M=T.textures;for(let B=0,K=M.length;B<K;B++){let se=M[B];if(u(se)){let de=v(T),pe=i.get(se).__webglTexture;n.bindTexture(de,pe),g(de),n.unbindTexture()}}}let ve=[],Ye=[];function L(T){if(T.samples>0){if(ze(T)===!1){let M=T.textures,B=T.width,K=T.height,se=t.COLOR_BUFFER_BIT,de=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,pe=i.get(T),Y=M.length>1;if(Y)for(let Ae=0;Ae<M.length;Ae++)n.bindFramebuffer(t.FRAMEBUFFER,pe.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Ae,t.RENDERBUFFER,null),n.bindFramebuffer(t.FRAMEBUFFER,pe.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Ae,t.TEXTURE_2D,null,0);n.bindFramebuffer(t.READ_FRAMEBUFFER,pe.__webglMultisampledFramebuffer);let ee=T.texture.mipmaps;ee&&ee.length>0?n.bindFramebuffer(t.DRAW_FRAMEBUFFER,pe.__webglFramebuffer[0]):n.bindFramebuffer(t.DRAW_FRAMEBUFFER,pe.__webglFramebuffer);for(let Ae=0;Ae<M.length;Ae++){if(T.resolveDepthBuffer&&(T.depthBuffer&&(se|=t.DEPTH_BUFFER_BIT),T.stencilBuffer&&T.resolveStencilBuffer&&(se|=t.STENCIL_BUFFER_BIT)),Y){t.framebufferRenderbuffer(t.READ_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.RENDERBUFFER,pe.__webglColorRenderbuffer[Ae]);let De=i.get(M[Ae]).__webglTexture;t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,De,0)}t.blitFramebuffer(0,0,B,K,0,0,B,K,se,t.NEAREST),l===!0&&(ve.length=0,Ye.length=0,ve.push(t.COLOR_ATTACHMENT0+Ae),T.depthBuffer&&T.resolveDepthBuffer===!1&&(ve.push(de),Ye.push(de),t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,Ye)),t.invalidateFramebuffer(t.READ_FRAMEBUFFER,ve))}if(n.bindFramebuffer(t.READ_FRAMEBUFFER,null),n.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),Y)for(let Ae=0;Ae<M.length;Ae++){n.bindFramebuffer(t.FRAMEBUFFER,pe.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Ae,t.RENDERBUFFER,pe.__webglColorRenderbuffer[Ae]);let De=i.get(M[Ae]).__webglTexture;n.bindFramebuffer(t.FRAMEBUFFER,pe.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Ae,t.TEXTURE_2D,De,0)}n.bindFramebuffer(t.DRAW_FRAMEBUFFER,pe.__webglMultisampledFramebuffer)}else if(T.depthBuffer&&T.resolveDepthBuffer===!1&&l){let M=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,[M])}}}function tt(T){return Math.min(r.maxSamples,T.samples)}function ze(T){let M=i.get(T);return T.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&M.__useRenderToTexture!==!1}function Ke(T){let M=o.render.frame;f.get(T)!==M&&(f.set(T,M),T.update())}function fe(T,M){let B=T.colorSpace,K=T.format,se=T.type;return T.isCompressedTexture===!0||T.isVideoTexture===!0||B!==wl&&B!==Ir&&(xt.getTransfer(B)===Rt?(K!==vi||se!==qn)&&Ze("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Je("WebGLTextures: Unsupported texture color space:",B)),M}function yt(T){return typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement?(c.width=T.naturalWidth||T.width,c.height=T.naturalHeight||T.height):typeof VideoFrame<"u"&&T instanceof VideoFrame?(c.width=T.displayWidth,c.height=T.displayHeight):(c.width=T.width,c.height=T.height),c}this.allocateTextureUnit=k,this.resetTextureUnits=W,this.getTextureUnits=q,this.setTextureUnits=U,this.setTexture2D=ne,this.setTexture2DArray=le,this.setTexture3D=me,this.setTextureCube=Ce,this.rebindTextures=re,this.setupRenderTarget=j,this.updateRenderTargetMipmap=Se,this.updateMultisampleRenderTarget=L,this.setupDepthRenderbuffer=ie,this.setupFrameBufferTexture=$e,this.useMultisampledRTT=ze,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function gR(t,e){function n(i,r=Ir){let s,o=xt.getTransfer(r);if(i===qn)return t.UNSIGNED_BYTE;if(i===nf)return t.UNSIGNED_SHORT_4_4_4_4;if(i===rf)return t.UNSIGNED_SHORT_5_5_5_1;if(i===vg)return t.UNSIGNED_INT_5_9_9_9_REV;if(i===xg)return t.UNSIGNED_INT_10F_11F_11F_REV;if(i===gg)return t.BYTE;if(i===_g)return t.SHORT;if(i===fa)return t.UNSIGNED_SHORT;if(i===tf)return t.INT;if(i===Di)return t.UNSIGNED_INT;if(i===Ui)return t.FLOAT;if(i===rr)return t.HALF_FLOAT;if(i===yg)return t.ALPHA;if(i===Sg)return t.RGB;if(i===vi)return t.RGBA;if(i===Ki)return t.DEPTH_COMPONENT;if(i===xs)return t.DEPTH_STENCIL;if(i===Mg)return t.RED;if(i===sf)return t.RED_INTEGER;if(i===ys)return t.RG;if(i===of)return t.RG_INTEGER;if(i===af)return t.RGBA_INTEGER;if(i===tc||i===nc||i===ic||i===rc)if(o===Rt)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===tc)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===nc)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===ic)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===rc)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===tc)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===nc)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===ic)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===rc)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===lf||i===cf||i===uf||i===hf)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===lf)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===cf)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===uf)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===hf)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===ff||i===df||i===pf||i===mf||i===gf||i===sc||i===_f)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===ff||i===df)return o===Rt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===pf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===mf)return s.COMPRESSED_R11_EAC;if(i===gf)return s.COMPRESSED_SIGNED_R11_EAC;if(i===sc)return s.COMPRESSED_RG11_EAC;if(i===_f)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===vf||i===xf||i===yf||i===Sf||i===Mf||i===wf||i===Ef||i===Tf||i===bf||i===Af||i===Cf||i===Rf||i===Pf||i===If)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===vf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===xf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===yf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Sf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Mf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===wf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===Ef)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Tf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===bf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===Af)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===Cf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===Rf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===Pf)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===If)return o===Rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Lf||i===Nf||i===Df)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===Lf)return o===Rt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===Nf)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===Df)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===Uf||i===Ff||i===oc||i===Of)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===Uf)return s.COMPRESSED_RED_RGTC1_EXT;if(i===Ff)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===oc)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===Of)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===da?t.UNSIGNED_INT_24_8:t[i]!==void 0?t[i]:null}return{convert:n}}var _R=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,vR=`
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

}`,Zg=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,n){if(this.texture===null){let i=new Nl(e.texture);(e.depthNear!==n.depthNear||e.depthFar!==n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let n=e.cameras[0].viewport,i=new si({vertexShader:_R,fragmentShader:vR,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new Vt(new tr(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Kg=class extends Ji{constructor(e,n){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,c=null,f=null,d=null,h=null,p=null,_=null,y=typeof XRWebGLBinding<"u",m=new Zg,u={},g=n.getContextAttributes(),v=null,S=null,A=[],w=[],C=new Te,x=null,b=new bn;b.viewport=new Yt;let I=new bn;I.viewport=new Yt;let P=[b,I],F=new $h,W=null,q=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(te){let ye=A[te];return ye===void 0&&(ye=new na,A[te]=ye),ye.getTargetRaySpace()},this.getControllerGrip=function(te){let ye=A[te];return ye===void 0&&(ye=new na,A[te]=ye),ye.getGripSpace()},this.getHand=function(te){let ye=A[te];return ye===void 0&&(ye=new na,A[te]=ye),ye.getHandSpace()};function U(te){let ye=w.indexOf(te.inputSource);if(ye===-1)return;let ce=A[ye];ce!==void 0&&(ce.update(te.inputSource,te.frame,c||o),ce.dispatchEvent({type:te.type,data:te.inputSource}))}function k(){r.removeEventListener("select",U),r.removeEventListener("selectstart",U),r.removeEventListener("selectend",U),r.removeEventListener("squeeze",U),r.removeEventListener("squeezestart",U),r.removeEventListener("squeezeend",U),r.removeEventListener("end",k),r.removeEventListener("inputsourceschange",z);for(let te=0;te<A.length;te++){let ye=w[te];ye!==null&&(w[te]=null,A[te].disconnect(ye))}W=null,q=null,m.reset();for(let te in u)delete u[te];e.setRenderTarget(v),p=null,h=null,d=null,r=null,S=null,et.stop(),i.isPresenting=!1,e.setPixelRatio(x),e.setSize(C.width,C.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(te){s=te,i.isPresenting===!0&&Ze("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(te){a=te,i.isPresenting===!0&&Ze("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(te){c=te},this.getBaseLayer=function(){return h!==null?h:p},this.getBinding=function(){return d===null&&y&&(d=new XRWebGLBinding(r,n)),d},this.getFrame=function(){return _},this.getSession=function(){return r},this.setSession=async function(te){if(r=te,r!==null){if(v=e.getRenderTarget(),r.addEventListener("select",U),r.addEventListener("selectstart",U),r.addEventListener("selectend",U),r.addEventListener("squeeze",U),r.addEventListener("squeezestart",U),r.addEventListener("squeezeend",U),r.addEventListener("end",k),r.addEventListener("inputsourceschange",z),g.xrCompatible!==!0&&await n.makeXRCompatible(),x=e.getPixelRatio(),e.getSize(C),y&&"createProjectionLayer"in XRWebGLBinding.prototype){let ce=null,Ve=null,qe=null;g.depth&&(qe=g.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,ce=g.stencil?xs:Ki,Ve=g.stencil?da:Di);let $e={colorFormat:n.RGBA8,depthFormat:qe,scaleFactor:s};d=this.getBinding(),h=d.createProjectionLayer($e),r.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),S=new ii(h.textureWidth,h.textureHeight,{format:vi,type:qn,depthTexture:new Pr(h.textureWidth,h.textureHeight,Ve,void 0,void 0,void 0,void 0,void 0,void 0,ce),stencilBuffer:g.stencil,colorSpace:e.outputColorSpace,samples:g.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1})}else{let ce={antialias:g.antialias,alpha:!0,depth:g.depth,stencil:g.stencil,framebufferScaleFactor:s};p=new XRWebGLLayer(r,n,ce),r.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),S=new ii(p.framebufferWidth,p.framebufferHeight,{format:vi,type:qn,colorSpace:e.outputColorSpace,stencilBuffer:g.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}S.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),et.setContext(r),et.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function z(te){for(let ye=0;ye<te.removed.length;ye++){let ce=te.removed[ye],Ve=w.indexOf(ce);Ve>=0&&(w[Ve]=null,A[Ve].disconnect(ce))}for(let ye=0;ye<te.added.length;ye++){let ce=te.added[ye],Ve=w.indexOf(ce);if(Ve===-1){for(let $e=0;$e<A.length;$e++)if($e>=w.length){w.push(ce),Ve=$e;break}else if(w[$e]===null){w[$e]=ce,Ve=$e;break}if(Ve===-1)break}let qe=A[Ve];qe&&qe.connect(ce)}}let ne=new N,le=new N;function me(te,ye,ce){ne.setFromMatrixPosition(ye.matrixWorld),le.setFromMatrixPosition(ce.matrixWorld);let Ve=ne.distanceTo(le),qe=ye.projectionMatrix.elements,$e=ce.projectionMatrix.elements,dt=qe[14]/(qe[10]-1),Ue=qe[14]/(qe[10]+1),ie=(qe[9]+1)/qe[5],re=(qe[9]-1)/qe[5],j=(qe[8]-1)/qe[0],Se=($e[8]+1)/$e[0],ve=dt*j,Ye=dt*Se,L=Ve/(-j+Se),tt=L*-j;if(ye.matrixWorld.decompose(te.position,te.quaternion,te.scale),te.translateX(tt),te.translateZ(L),te.matrixWorld.compose(te.position,te.quaternion,te.scale),te.matrixWorldInverse.copy(te.matrixWorld).invert(),qe[10]===-1)te.projectionMatrix.copy(ye.projectionMatrix),te.projectionMatrixInverse.copy(ye.projectionMatrixInverse);else{let ze=dt+L,Ke=Ue+L,fe=ve-tt,yt=Ye+(Ve-tt),T=ie*Ue/Ke*ze,M=re*Ue/Ke*ze;te.projectionMatrix.makePerspective(fe,yt,T,M,ze,Ke),te.projectionMatrixInverse.copy(te.projectionMatrix).invert()}}function Ce(te,ye){ye===null?te.matrixWorld.copy(te.matrix):te.matrixWorld.multiplyMatrices(ye.matrixWorld,te.matrix),te.matrixWorldInverse.copy(te.matrixWorld).invert()}this.updateCamera=function(te){if(r===null)return;let ye=te.near,ce=te.far;m.texture!==null&&(m.depthNear>0&&(ye=m.depthNear),m.depthFar>0&&(ce=m.depthFar)),F.near=I.near=b.near=ye,F.far=I.far=b.far=ce,(W!==F.near||q!==F.far)&&(r.updateRenderState({depthNear:F.near,depthFar:F.far}),W=F.near,q=F.far),F.layers.mask=te.layers.mask|6,b.layers.mask=F.layers.mask&-5,I.layers.mask=F.layers.mask&-3;let Ve=te.parent,qe=F.cameras;Ce(F,Ve);for(let $e=0;$e<qe.length;$e++)Ce(qe[$e],Ve);qe.length===2?me(F,b,I):F.projectionMatrix.copy(b.projectionMatrix),Be(te,F,Ve)};function Be(te,ye,ce){ce===null?te.matrix.copy(ye.matrixWorld):(te.matrix.copy(ce.matrixWorld),te.matrix.invert(),te.matrix.multiply(ye.matrixWorld)),te.matrix.decompose(te.position,te.quaternion,te.scale),te.updateMatrixWorld(!0),te.projectionMatrix.copy(ye.projectionMatrix),te.projectionMatrixInverse.copy(ye.projectionMatrixInverse),te.isPerspectiveCamera&&(te.fov=Qo*2*Math.atan(1/te.projectionMatrix.elements[5]),te.zoom=1)}this.getCamera=function(){return F},this.getFoveation=function(){if(!(h===null&&p===null))return l},this.setFoveation=function(te){l=te,h!==null&&(h.fixedFoveation=te),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=te)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(F)},this.getCameraTexture=function(te){return u[te]};let Qe=null;function vt(te,ye){if(f=ye.getViewerPose(c||o),_=ye,f!==null){let ce=f.views;p!==null&&(e.setRenderTargetFramebuffer(S,p.framebuffer),e.setRenderTarget(S));let Ve=!1;ce.length!==F.cameras.length&&(F.cameras.length=0,Ve=!0);for(let Ue=0;Ue<ce.length;Ue++){let ie=ce[Ue],re=null;if(p!==null)re=p.getViewport(ie);else{let Se=d.getViewSubImage(h,ie);re=Se.viewport,Ue===0&&(e.setRenderTargetTextures(S,Se.colorTexture,Se.depthStencilTexture),e.setRenderTarget(S))}let j=P[Ue];j===void 0&&(j=new bn,j.layers.enable(Ue),j.viewport=new Yt,P[Ue]=j),j.matrix.fromArray(ie.transform.matrix),j.matrix.decompose(j.position,j.quaternion,j.scale),j.projectionMatrix.fromArray(ie.projectionMatrix),j.projectionMatrixInverse.copy(j.projectionMatrix).invert(),j.viewport.set(re.x,re.y,re.width,re.height),Ue===0&&(F.matrix.copy(j.matrix),F.matrix.decompose(F.position,F.quaternion,F.scale)),Ve===!0&&F.cameras.push(j)}let qe=r.enabledFeatures;if(qe&&qe.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&y){d=i.getBinding();let Ue=d.getDepthInformation(ce[0]);Ue&&Ue.isValid&&Ue.texture&&m.init(Ue,r.renderState)}if(qe&&qe.includes("camera-access")&&y){e.state.unbindTexture(),d=i.getBinding();for(let Ue=0;Ue<ce.length;Ue++){let ie=ce[Ue].camera;if(ie){let re=u[ie];re||(re=new Nl,u[ie]=re);let j=d.getCameraImage(ie);re.sourceTexture=j}}}}for(let ce=0;ce<A.length;ce++){let Ve=w[ce],qe=A[ce];Ve!==null&&qe!==void 0&&qe.update(Ve,ye,c||o)}Qe&&Qe(te,ye),ye.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:ye}),_=null}let et=new LS;et.setAnimationLoop(vt),this.setAnimationLoop=function(te){Qe=te},this.dispose=function(){}}},xR=new At,BS=new rt;BS.set(-1,0,0,0,1,0,0,0,1);function yR(t,e){function n(m,u){m.matrixAutoUpdate===!0&&m.updateMatrix(),u.value.copy(m.matrix)}function i(m,u){u.color.getRGB(m.fogColor.value,Ag(t)),u.isFog?(m.fogNear.value=u.near,m.fogFar.value=u.far):u.isFogExp2&&(m.fogDensity.value=u.density)}function r(m,u,g,v,S){u.isNodeMaterial?u.uniformsNeedUpdate=!1:u.isMeshBasicMaterial?s(m,u):u.isMeshLambertMaterial?(s(m,u),u.envMap&&(m.envMapIntensity.value=u.envMapIntensity)):u.isMeshToonMaterial?(s(m,u),d(m,u)):u.isMeshPhongMaterial?(s(m,u),f(m,u),u.envMap&&(m.envMapIntensity.value=u.envMapIntensity)):u.isMeshStandardMaterial?(s(m,u),h(m,u),u.isMeshPhysicalMaterial&&p(m,u,S)):u.isMeshMatcapMaterial?(s(m,u),_(m,u)):u.isMeshDepthMaterial?s(m,u):u.isMeshDistanceMaterial?(s(m,u),y(m,u)):u.isMeshNormalMaterial?s(m,u):u.isLineBasicMaterial?(o(m,u),u.isLineDashedMaterial&&a(m,u)):u.isPointsMaterial?l(m,u,g,v):u.isSpriteMaterial?c(m,u):u.isShadowMaterial?(m.color.value.copy(u.color),m.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function s(m,u){m.opacity.value=u.opacity,u.color&&m.diffuse.value.copy(u.color),u.emissive&&m.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(m.map.value=u.map,n(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,n(u.alphaMap,m.alphaMapTransform)),u.bumpMap&&(m.bumpMap.value=u.bumpMap,n(u.bumpMap,m.bumpMapTransform),m.bumpScale.value=u.bumpScale,u.side===Bn&&(m.bumpScale.value*=-1)),u.normalMap&&(m.normalMap.value=u.normalMap,n(u.normalMap,m.normalMapTransform),m.normalScale.value.copy(u.normalScale),u.side===Bn&&m.normalScale.value.negate()),u.displacementMap&&(m.displacementMap.value=u.displacementMap,n(u.displacementMap,m.displacementMapTransform),m.displacementScale.value=u.displacementScale,m.displacementBias.value=u.displacementBias),u.emissiveMap&&(m.emissiveMap.value=u.emissiveMap,n(u.emissiveMap,m.emissiveMapTransform)),u.specularMap&&(m.specularMap.value=u.specularMap,n(u.specularMap,m.specularMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest);let g=e.get(u),v=g.envMap,S=g.envMapRotation;v&&(m.envMap.value=v,m.envMapRotation.value.setFromMatrix4(xR.makeRotationFromEuler(S)).transpose(),v.isCubeTexture&&v.isRenderTargetTexture===!1&&m.envMapRotation.value.premultiply(BS),m.reflectivity.value=u.reflectivity,m.ior.value=u.ior,m.refractionRatio.value=u.refractionRatio),u.lightMap&&(m.lightMap.value=u.lightMap,m.lightMapIntensity.value=u.lightMapIntensity,n(u.lightMap,m.lightMapTransform)),u.aoMap&&(m.aoMap.value=u.aoMap,m.aoMapIntensity.value=u.aoMapIntensity,n(u.aoMap,m.aoMapTransform))}function o(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,u.map&&(m.map.value=u.map,n(u.map,m.mapTransform))}function a(m,u){m.dashSize.value=u.dashSize,m.totalSize.value=u.dashSize+u.gapSize,m.scale.value=u.scale}function l(m,u,g,v){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.size.value=u.size*g,m.scale.value=v*.5,u.map&&(m.map.value=u.map,n(u.map,m.uvTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,n(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function c(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.rotation.value=u.rotation,u.map&&(m.map.value=u.map,n(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,n(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function f(m,u){m.specular.value.copy(u.specular),m.shininess.value=Math.max(u.shininess,1e-4)}function d(m,u){u.gradientMap&&(m.gradientMap.value=u.gradientMap)}function h(m,u){m.metalness.value=u.metalness,u.metalnessMap&&(m.metalnessMap.value=u.metalnessMap,n(u.metalnessMap,m.metalnessMapTransform)),m.roughness.value=u.roughness,u.roughnessMap&&(m.roughnessMap.value=u.roughnessMap,n(u.roughnessMap,m.roughnessMapTransform)),u.envMap&&(m.envMapIntensity.value=u.envMapIntensity)}function p(m,u,g){m.ior.value=u.ior,u.sheen>0&&(m.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),m.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(m.sheenColorMap.value=u.sheenColorMap,n(u.sheenColorMap,m.sheenColorMapTransform)),u.sheenRoughnessMap&&(m.sheenRoughnessMap.value=u.sheenRoughnessMap,n(u.sheenRoughnessMap,m.sheenRoughnessMapTransform))),u.clearcoat>0&&(m.clearcoat.value=u.clearcoat,m.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(m.clearcoatMap.value=u.clearcoatMap,n(u.clearcoatMap,m.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,n(u.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(m.clearcoatNormalMap.value=u.clearcoatNormalMap,n(u.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===Bn&&m.clearcoatNormalScale.value.negate())),u.dispersion>0&&(m.dispersion.value=u.dispersion),u.iridescence>0&&(m.iridescence.value=u.iridescence,m.iridescenceIOR.value=u.iridescenceIOR,m.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(m.iridescenceMap.value=u.iridescenceMap,n(u.iridescenceMap,m.iridescenceMapTransform)),u.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=u.iridescenceThicknessMap,n(u.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),u.transmission>0&&(m.transmission.value=u.transmission,m.transmissionSamplerMap.value=g.texture,m.transmissionSamplerSize.value.set(g.width,g.height),u.transmissionMap&&(m.transmissionMap.value=u.transmissionMap,n(u.transmissionMap,m.transmissionMapTransform)),m.thickness.value=u.thickness,u.thicknessMap&&(m.thicknessMap.value=u.thicknessMap,n(u.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=u.attenuationDistance,m.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(m.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(m.anisotropyMap.value=u.anisotropyMap,n(u.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=u.specularIntensity,m.specularColor.value.copy(u.specularColor),u.specularColorMap&&(m.specularColorMap.value=u.specularColorMap,n(u.specularColorMap,m.specularColorMapTransform)),u.specularIntensityMap&&(m.specularIntensityMap.value=u.specularIntensityMap,n(u.specularIntensityMap,m.specularIntensityMapTransform))}function _(m,u){u.matcap&&(m.matcap.value=u.matcap)}function y(m,u){let g=e.get(u).light;m.referencePosition.value.setFromMatrixPosition(g.matrixWorld),m.nearDistance.value=g.shadow.camera.near,m.farDistance.value=g.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function SR(t,e,n,i){let r={},s={},o=[],a=t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);function l(g,v){let S=v.program;i.uniformBlockBinding(g,S)}function c(g,v){let S=r[g.id];S===void 0&&(_(g),S=f(g),r[g.id]=S,g.addEventListener("dispose",m));let A=v.program;i.updateUBOMapping(g,A);let w=e.render.frame;s[g.id]!==w&&(h(g),s[g.id]=w)}function f(g){let v=d();g.__bindingPointIndex=v;let S=t.createBuffer(),A=g.__size,w=g.usage;return t.bindBuffer(t.UNIFORM_BUFFER,S),t.bufferData(t.UNIFORM_BUFFER,A,w),t.bindBuffer(t.UNIFORM_BUFFER,null),t.bindBufferBase(t.UNIFORM_BUFFER,v,S),S}function d(){for(let g=0;g<a;g++)if(o.indexOf(g)===-1)return o.push(g),g;return Je("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(g){let v=r[g.id],S=g.uniforms,A=g.__cache;t.bindBuffer(t.UNIFORM_BUFFER,v);for(let w=0,C=S.length;w<C;w++){let x=Array.isArray(S[w])?S[w]:[S[w]];for(let b=0,I=x.length;b<I;b++){let P=x[b];if(p(P,w,b,A)===!0){let F=P.__offset,W=Array.isArray(P.value)?P.value:[P.value],q=0;for(let U=0;U<W.length;U++){let k=W[U],z=y(k);typeof k=="number"||typeof k=="boolean"?(P.__data[0]=k,t.bufferSubData(t.UNIFORM_BUFFER,F+q,P.__data)):k.isMatrix3?(P.__data[0]=k.elements[0],P.__data[1]=k.elements[1],P.__data[2]=k.elements[2],P.__data[3]=0,P.__data[4]=k.elements[3],P.__data[5]=k.elements[4],P.__data[6]=k.elements[5],P.__data[7]=0,P.__data[8]=k.elements[6],P.__data[9]=k.elements[7],P.__data[10]=k.elements[8],P.__data[11]=0):ArrayBuffer.isView(k)?P.__data.set(new k.constructor(k.buffer,k.byteOffset,P.__data.length)):(k.toArray(P.__data,q),q+=z.storage/Float32Array.BYTES_PER_ELEMENT)}t.bufferSubData(t.UNIFORM_BUFFER,F,P.__data)}}}t.bindBuffer(t.UNIFORM_BUFFER,null)}function p(g,v,S,A){let w=g.value,C=v+"_"+S;if(A[C]===void 0)return typeof w=="number"||typeof w=="boolean"?A[C]=w:ArrayBuffer.isView(w)?A[C]=w.slice():A[C]=w.clone(),!0;{let x=A[C];if(typeof w=="number"||typeof w=="boolean"){if(x!==w)return A[C]=w,!0}else{if(ArrayBuffer.isView(w))return!0;if(x.equals(w)===!1)return x.copy(w),!0}}return!1}function _(g){let v=g.uniforms,S=0,A=16;for(let C=0,x=v.length;C<x;C++){let b=Array.isArray(v[C])?v[C]:[v[C]];for(let I=0,P=b.length;I<P;I++){let F=b[I],W=Array.isArray(F.value)?F.value:[F.value];for(let q=0,U=W.length;q<U;q++){let k=W[q],z=y(k),ne=S%A,le=ne%z.boundary,me=ne+le;S+=le,me!==0&&A-me<z.storage&&(S+=A-me),F.__data=new Float32Array(z.storage/Float32Array.BYTES_PER_ELEMENT),F.__offset=S,S+=z.storage}}}let w=S%A;return w>0&&(S+=A-w),g.__size=S,g.__cache={},this}function y(g){let v={boundary:0,storage:0};return typeof g=="number"||typeof g=="boolean"?(v.boundary=4,v.storage=4):g.isVector2?(v.boundary=8,v.storage=8):g.isVector3||g.isColor?(v.boundary=16,v.storage=12):g.isVector4?(v.boundary=16,v.storage=16):g.isMatrix3?(v.boundary=48,v.storage=48):g.isMatrix4?(v.boundary=64,v.storage=64):g.isTexture?Ze("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(g)?(v.boundary=16,v.storage=g.byteLength):Ze("WebGLRenderer: Unsupported uniform value type.",g),v}function m(g){let v=g.target;v.removeEventListener("dispose",m);let S=o.indexOf(v.__bindingPointIndex);o.splice(S,1),t.deleteBuffer(r[v.id]),delete r[v.id],delete s[v.id]}function u(){for(let g in r)t.deleteBuffer(r[g]);o=[],r={},s={}}return{bind:l,update:c,dispose:u}}var MR=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),sr=null;function wR(){return sr===null&&(sr=new bh(MR,16,16,ys,rr),sr.name="DFG_LUT",sr.minFilter=_n,sr.magFilter=_n,sr.wrapS=Zi,sr.wrapT=Zi,sr.generateMipmaps=!1,sr.needsUpdate=!0),sr}var Xf=class{constructor(e={}){let{canvas:n=Qy(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:f="default",failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:h=!1,outputBufferType:p=qn}=e;this.isWebGLRenderer=!0;let _;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");_=i.getContextAttributes().alpha}else _=o;let y=p,m=new Set([af,of,sf]),u=new Set([qn,Di,fa,da,nf,rf]),g=new Uint32Array(4),v=new Int32Array(4),S=new N,A=null,w=null,C=[],x=[],b=null;this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Ni,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let I=this,P=!1,F=null;this._outputColorSpace=Un;let W=0,q=0,U=null,k=-1,z=null,ne=new Yt,le=new Yt,me=null,Ce=new ft(0),Be=0,Qe=n.width,vt=n.height,et=1,te=null,ye=null,ce=new Yt(0,0,Qe,vt),Ve=new Yt(0,0,Qe,vt),qe=!1,$e=new ra,dt=!1,Ue=!1,ie=new At,re=new N,j=new Yt,Se={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},ve=!1;function Ye(){return U===null?et:1}let L=i;function tt(E,O){return n.getContext(E,O)}try{let E={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:f,failIfMajorPerformanceCaveat:d};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${Kh}`),n.addEventListener("webglcontextlost",oe,!1),n.addEventListener("webglcontextrestored",He,!1),n.addEventListener("webglcontextcreationerror",We,!1),L===null){let O="webgl2";if(L=tt(O,E),L===null)throw tt(O)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(E){throw Je("WebGLRenderer: "+E.message),E}let ze,Ke,fe,yt,T,M,B,K,se,de,pe,Y,ee,Ae,De,_e,ue,nt,ot,ut,D,ge,J;function Re(){ze=new PA(L),ze.init(),D=new gR(L,ze),Ke=new MA(L,ze,e,D),fe=new pR(L,ze),Ke.reversedDepthBuffer&&h&&fe.buffers.depth.setReversed(!0),yt=new NA(L),T=new eR,M=new mR(L,ze,fe,T,Ke,D,yt),B=new RA(I),K=new OE(L),ge=new yA(L,K),se=new IA(L,K,yt,ge),de=new UA(L,se,K,ge,yt),nt=new DA(L,Ke,M),De=new wA(T),pe=new QC(I,B,ze,Ke,ge,De),Y=new yR(I,T),ee=new nR,Ae=new lR(ze),ue=new xA(I,B,fe,de,_,l),_e=new dR(I,de,Ke),J=new SR(L,yt,Ke,fe),ot=new SA(L,ze,yt),ut=new LA(L,ze,yt),yt.programs=pe.programs,I.capabilities=Ke,I.extensions=ze,I.properties=T,I.renderLists=ee,I.shadowMap=_e,I.state=fe,I.info=yt}Re(),y!==qn&&(b=new OA(y,n.width,n.height,r,s));let ae=new Kg(I,L);this.xr=ae,this.getContext=function(){return L},this.getContextAttributes=function(){return L.getContextAttributes()},this.forceContextLoss=function(){let E=ze.get("WEBGL_lose_context");E&&E.loseContext()},this.forceContextRestore=function(){let E=ze.get("WEBGL_lose_context");E&&E.restoreContext()},this.getPixelRatio=function(){return et},this.setPixelRatio=function(E){E!==void 0&&(et=E,this.setSize(Qe,vt,!1))},this.getSize=function(E){return E.set(Qe,vt)},this.setSize=function(E,O,X=!0){if(ae.isPresenting){Ze("WebGLRenderer: Can't change size while VR device is presenting.");return}Qe=E,vt=O,n.width=Math.floor(E*et),n.height=Math.floor(O*et),X===!0&&(n.style.width=E+"px",n.style.height=O+"px"),b!==null&&b.setSize(n.width,n.height),this.setViewport(0,0,E,O)},this.getDrawingBufferSize=function(E){return E.set(Qe*et,vt*et).floor()},this.setDrawingBufferSize=function(E,O,X){Qe=E,vt=O,et=X,n.width=Math.floor(E*X),n.height=Math.floor(O*X),this.setViewport(0,0,E,O)},this.setEffects=function(E){if(y===qn){Je("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(E){for(let O=0;O<E.length;O++)if(E[O].isOutputPass===!0){Ze("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}b.setEffects(E||[])},this.getCurrentViewport=function(E){return E.copy(ne)},this.getViewport=function(E){return E.copy(ce)},this.setViewport=function(E,O,X,V){E.isVector4?ce.set(E.x,E.y,E.z,E.w):ce.set(E,O,X,V),fe.viewport(ne.copy(ce).multiplyScalar(et).round())},this.getScissor=function(E){return E.copy(Ve)},this.setScissor=function(E,O,X,V){E.isVector4?Ve.set(E.x,E.y,E.z,E.w):Ve.set(E,O,X,V),fe.scissor(le.copy(Ve).multiplyScalar(et).round())},this.getScissorTest=function(){return qe},this.setScissorTest=function(E){fe.setScissorTest(qe=E)},this.setOpaqueSort=function(E){te=E},this.setTransparentSort=function(E){ye=E},this.getClearColor=function(E){return E.copy(ue.getClearColor())},this.setClearColor=function(){ue.setClearColor(...arguments)},this.getClearAlpha=function(){return ue.getClearAlpha()},this.setClearAlpha=function(){ue.setClearAlpha(...arguments)},this.clear=function(E=!0,O=!0,X=!0){let V=0;if(E){let H=!1;if(U!==null){let xe=U.texture.format;H=m.has(xe)}if(H){let xe=U.texture.type,Pe=u.has(xe),we=ue.getClearColor(),ke=ue.getClearAlpha(),Me=we.r,st=we.g,at=we.b;Pe?(g[0]=Me,g[1]=st,g[2]=at,g[3]=ke,L.clearBufferuiv(L.COLOR,0,g)):(v[0]=Me,v[1]=st,v[2]=at,v[3]=ke,L.clearBufferiv(L.COLOR,0,v))}else V|=L.COLOR_BUFFER_BIT}O&&(V|=L.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),X&&(V|=L.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),V!==0&&L.clear(V)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(E){E.setRenderer(this),F=E},this.dispose=function(){n.removeEventListener("webglcontextlost",oe,!1),n.removeEventListener("webglcontextrestored",He,!1),n.removeEventListener("webglcontextcreationerror",We,!1),ue.dispose(),ee.dispose(),Ae.dispose(),T.dispose(),B.dispose(),de.dispose(),ge.dispose(),J.dispose(),pe.dispose(),ae.dispose(),ae.removeEventListener("sessionstart",Ms),ae.removeEventListener("sessionend",kn),ai.stop()};function oe(E){E.preventDefault(),Eg("WebGLRenderer: Context Lost."),P=!0}function He(){Eg("WebGLRenderer: Context Restored."),P=!1;let E=yt.autoReset,O=_e.enabled,X=_e.autoUpdate,V=_e.needsUpdate,H=_e.type;Re(),yt.autoReset=E,_e.enabled=O,_e.autoUpdate=X,_e.needsUpdate=V,_e.type=H}function We(E){Je("WebGLRenderer: A WebGL context could not be created. Reason: ",E.statusMessage)}function It(E){let O=E.target;O.removeEventListener("dispose",It),Mt(O)}function Mt(E){Yn(E),T.remove(E)}function Yn(E){let O=T.get(E).programs;O!==void 0&&(O.forEach(function(X){pe.releaseProgram(X)}),E.isShaderMaterial&&pe.releaseShaderCache(E))}this.renderBufferDirect=function(E,O,X,V,H,xe){O===null&&(O=Se);let Pe=H.isMesh&&H.matrixWorld.determinant()<0,we=li(E,O,X,V,H);fe.setMaterial(V,Pe);let ke=X.index,Me=1;if(V.wireframe===!0){if(ke=se.getWireframeAttribute(X),ke===void 0)return;Me=2}let st=X.drawRange,at=X.attributes.position,Ge=st.start*Me,pt=(st.start+st.count)*Me;xe!==null&&(Ge=Math.max(Ge,xe.start*Me),pt=Math.min(pt,(xe.start+xe.count)*Me)),ke!==null?(Ge=Math.max(Ge,0),pt=Math.min(pt,ke.count)):at!=null&&(Ge=Math.max(Ge,0),pt=Math.min(pt,at.count));let Nt=pt-Ge;if(Nt<0||Nt===1/0)return;ge.setup(H,V,we,X,ke);let Ct,Tt=ot;if(ke!==null&&(Ct=K.get(ke),Tt=ut,Tt.setIndex(Ct)),H.isMesh)V.wireframe===!0?(fe.setLineWidth(V.wireframeLinewidth*Ye()),Tt.setMode(L.LINES)):Tt.setMode(L.TRIANGLES);else if(H.isLine){let en=V.linewidth;en===void 0&&(en=1),fe.setLineWidth(en*Ye()),H.isLineSegments?Tt.setMode(L.LINES):H.isLineLoop?Tt.setMode(L.LINE_LOOP):Tt.setMode(L.LINE_STRIP)}else H.isPoints?Tt.setMode(L.POINTS):H.isSprite&&Tt.setMode(L.TRIANGLES);if(H.isBatchedMesh)if(ze.get("WEBGL_multi_draw"))Tt.renderMultiDraw(H._multiDrawStarts,H._multiDrawCounts,H._multiDrawCount);else{let en=H._multiDrawStarts,Ie=H._multiDrawCounts,Ht=H._multiDrawCount,gt=ke?K.get(ke).bytesPerElement:1,vn=T.get(V).currentProgram.getUniforms();for(let zn=0;zn<Ht;zn++)vn.setValue(L,"_gl_DrawID",zn),Tt.render(en[zn]/gt,Ie[zn])}else if(H.isInstancedMesh)Tt.renderInstances(Ge,Nt,H.count);else if(X.isInstancedBufferGeometry){let en=X._maxInstanceCount!==void 0?X._maxInstanceCount:1/0,Ie=Math.min(X.instanceCount,en);Tt.renderInstances(Ge,Nt,Ie)}else Tt.render(Ge,Nt)};function Lt(E,O,X){E.transparent===!0&&E.side===nr&&E.forceSinglePass===!1?(E.side=Bn,E.needsUpdate=!0,Ur(E,O,X),E.side=Cr,E.needsUpdate=!0,Ur(E,O,X),E.side=nr):Ur(E,O,X)}this.compile=function(E,O,X=null){X===null&&(X=E),w=Ae.get(X),w.init(O),x.push(w),X.traverseVisible(function(H){H.isLight&&H.layers.test(O.layers)&&(w.pushLight(H),H.castShadow&&w.pushShadow(H))}),E!==X&&E.traverseVisible(function(H){H.isLight&&H.layers.test(O.layers)&&(w.pushLight(H),H.castShadow&&w.pushShadow(H))}),w.setupLights();let V=new Set;return E.traverse(function(H){if(!(H.isMesh||H.isPoints||H.isLine||H.isSprite))return;let xe=H.material;if(xe)if(Array.isArray(xe))for(let Pe=0;Pe<xe.length;Pe++){let we=xe[Pe];Lt(we,X,H),V.add(we)}else Lt(xe,X,H),V.add(xe)}),w=x.pop(),V},this.compileAsync=function(E,O,X=null){let V=this.compile(E,O,X);return new Promise(H=>{function xe(){if(V.forEach(function(Pe){T.get(Pe).currentProgram.isReady()&&V.delete(Pe)}),V.size===0){H(E);return}setTimeout(xe,10)}ze.get("KHR_parallel_shader_compile")!==null?xe():setTimeout(xe,10)})};let Lr=null;function _a(E){Lr&&Lr(E)}function Ms(){ai.stop()}function kn(){ai.start()}let ai=new LS;ai.setAnimationLoop(_a),typeof self<"u"&&ai.setContext(self),this.setAnimationLoop=function(E){Lr=E,ae.setAnimationLoop(E),E===null?ai.stop():ai.start()},ae.addEventListener("sessionstart",Ms),ae.addEventListener("sessionend",kn),this.render=function(E,O){if(O!==void 0&&O.isCamera!==!0){Je("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(P===!0)return;F!==null&&F.renderStart(E,O);let X=ae.enabled===!0&&ae.isPresenting===!0,V=b!==null&&(U===null||X)&&b.begin(I,U);if(E.matrixWorldAutoUpdate===!0&&E.updateMatrixWorld(),O.parent===null&&O.matrixWorldAutoUpdate===!0&&O.updateMatrixWorld(),ae.enabled===!0&&ae.isPresenting===!0&&(b===null||b.isCompositing()===!1)&&(ae.cameraAutoUpdate===!0&&ae.updateCamera(O),O=ae.getCamera()),E.isScene===!0&&E.onBeforeRender(I,E,O,U),w=Ae.get(E,x.length),w.init(O),w.state.textureUnits=M.getTextureUnits(),x.push(w),ie.multiplyMatrices(O.projectionMatrix,O.matrixWorldInverse),$e.setFromProjectionMatrix(ie,Ii,O.reversedDepth),Ue=this.localClippingEnabled,dt=De.init(this.clippingPlanes,Ue),A=ee.get(E,C.length),A.init(),C.push(A),ae.enabled===!0&&ae.isPresenting===!0){let Pe=I.xr.getDepthSensingMesh();Pe!==null&&Nr(Pe,O,-1/0,I.sortObjects)}Nr(E,O,0,I.sortObjects),A.finish(),I.sortObjects===!0&&A.sort(te,ye),ve=ae.enabled===!1||ae.isPresenting===!1||ae.hasDepthSensing()===!1,ve&&ue.addToRenderList(A,E),this.info.render.frame++,dt===!0&&De.beginShadows();let H=w.state.shadowsArray;if(_e.render(H,E,O),dt===!0&&De.endShadows(),this.info.autoReset===!0&&this.info.reset(),(V&&b.hasRenderPass())===!1){let Pe=A.opaque,we=A.transmissive;if(w.setupLights(),O.isArrayCamera){let ke=O.cameras;if(we.length>0)for(let Me=0,st=ke.length;Me<st;Me++){let at=ke[Me];ki(Pe,we,E,at)}ve&&ue.render(E);for(let Me=0,st=ke.length;Me<st;Me++){let at=ke[Me];Dr(A,E,at,at.viewport)}}else we.length>0&&ki(Pe,we,E,O),ve&&ue.render(E),Dr(A,E,O)}U!==null&&q===0&&(M.updateMultisampleRenderTarget(U),M.updateRenderTargetMipmap(U)),V&&b.end(I),E.isScene===!0&&E.onAfterRender(I,E,O),ge.resetDefaultState(),k=-1,z=null,x.pop(),x.length>0?(w=x[x.length-1],M.setTextureUnits(w.state.textureUnits),dt===!0&&De.setGlobalState(I.clippingPlanes,w.state.camera)):w=null,C.pop(),C.length>0?A=C[C.length-1]:A=null,F!==null&&F.renderEnd()};function Nr(E,O,X,V){if(E.visible===!1)return;if(E.layers.test(O.layers)){if(E.isGroup)X=E.renderOrder;else if(E.isLOD)E.autoUpdate===!0&&E.update(O);else if(E.isLightProbeGrid)w.pushLightProbeGrid(E);else if(E.isLight)w.pushLight(E),E.castShadow&&w.pushShadow(E);else if(E.isSprite){if(!E.frustumCulled||$e.intersectsSprite(E)){V&&j.setFromMatrixPosition(E.matrixWorld).applyMatrix4(ie);let Pe=de.update(E),we=E.material;we.visible&&A.push(E,Pe,we,X,j.z,null)}}else if((E.isMesh||E.isLine||E.isPoints)&&(!E.frustumCulled||$e.intersectsObject(E))){let Pe=de.update(E),we=E.material;if(V&&(E.boundingSphere!==void 0?(E.boundingSphere===null&&E.computeBoundingSphere(),j.copy(E.boundingSphere.center)):(Pe.boundingSphere===null&&Pe.computeBoundingSphere(),j.copy(Pe.boundingSphere.center)),j.applyMatrix4(E.matrixWorld).applyMatrix4(ie)),Array.isArray(we)){let ke=Pe.groups;for(let Me=0,st=ke.length;Me<st;Me++){let at=ke[Me],Ge=we[at.materialIndex];Ge&&Ge.visible&&A.push(E,Pe,Ge,X,j.z,at)}}else we.visible&&A.push(E,Pe,we,X,j.z,null)}}let xe=E.children;for(let Pe=0,we=xe.length;Pe<we;Pe++)Nr(xe[Pe],O,X,V)}function Dr(E,O,X,V){let{opaque:H,transmissive:xe,transparent:Pe}=E;w.setupLightsView(X),dt===!0&&De.setGlobalState(I.clippingPlanes,X),V&&fe.viewport(ne.copy(V)),H.length>0&&lt(H,O,X),xe.length>0&&lt(xe,O,X),Pe.length>0&&lt(Pe,O,X),fe.buffers.depth.setTest(!0),fe.buffers.depth.setMask(!0),fe.buffers.color.setMask(!0),fe.setPolygonOffset(!1)}function ki(E,O,X,V){if((X.isScene===!0?X.overrideMaterial:null)!==null)return;if(w.state.transmissionRenderTarget[V.id]===void 0){let Ge=ze.has("EXT_color_buffer_half_float")||ze.has("EXT_color_buffer_float");w.state.transmissionRenderTarget[V.id]=new ii(1,1,{generateMipmaps:!0,type:Ge?rr:qn,minFilter:vs,samples:Math.max(4,Ke.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:xt.workingColorSpace})}let xe=w.state.transmissionRenderTarget[V.id],Pe=V.viewport||ne;xe.setSize(Pe.z*I.transmissionResolutionScale,Pe.w*I.transmissionResolutionScale);let we=I.getRenderTarget(),ke=I.getActiveCubeFace(),Me=I.getActiveMipmapLevel();I.setRenderTarget(xe),I.getClearColor(Ce),Be=I.getClearAlpha(),Be<1&&I.setClearColor(16777215,.5),I.clear(),ve&&ue.render(X);let st=I.toneMapping;I.toneMapping=Ni;let at=V.viewport;if(V.viewport!==void 0&&(V.viewport=void 0),w.setupLightsView(V),dt===!0&&De.setGlobalState(I.clippingPlanes,V),lt(E,X,V),M.updateMultisampleRenderTarget(xe),M.updateRenderTargetMipmap(xe),ze.has("WEBGL_multisampled_render_to_texture")===!1){let Ge=!1;for(let pt=0,Nt=O.length;pt<Nt;pt++){let Ct=O[pt],{object:Tt,geometry:en,material:Ie,group:Ht}=Ct;if(Ie.side===nr&&Tt.layers.test(V.layers)){let gt=Ie.side;Ie.side=Bn,Ie.needsUpdate=!0,ar(Tt,X,V,en,Ie,Ht),Ie.side=gt,Ie.needsUpdate=!0,Ge=!0}}Ge===!0&&(M.updateMultisampleRenderTarget(xe),M.updateRenderTargetMipmap(xe))}I.setRenderTarget(we,ke,Me),I.setClearColor(Ce,Be),at!==void 0&&(V.viewport=at),I.toneMapping=st}function lt(E,O,X){let V=O.isScene===!0?O.overrideMaterial:null;for(let H=0,xe=E.length;H<xe;H++){let Pe=E[H],{object:we,geometry:ke,group:Me}=Pe,st=Pe.material;st.allowOverride===!0&&V!==null&&(st=V),we.layers.test(X.layers)&&ar(we,O,X,ke,st,Me)}}function ar(E,O,X,V,H,xe){E.onBeforeRender(I,O,X,V,H,xe),E.modelViewMatrix.multiplyMatrices(X.matrixWorldInverse,E.matrixWorld),E.normalMatrix.getNormalMatrix(E.modelViewMatrix),H.onBeforeRender(I,O,X,V,E,xe),H.transparent===!0&&H.side===nr&&H.forceSinglePass===!1?(H.side=Bn,H.needsUpdate=!0,I.renderBufferDirect(X,O,V,H,E,xe),H.side=Cr,H.needsUpdate=!0,I.renderBufferDirect(X,O,V,H,E,xe),H.side=nr):I.renderBufferDirect(X,O,V,H,E,xe),E.onAfterRender(I,O,X,V,H,xe)}function Ur(E,O,X){O.isScene!==!0&&(O=Se);let V=T.get(E),H=w.state.lights,xe=w.state.shadowsArray,Pe=H.state.version,we=pe.getParameters(E,H.state,xe,O,X,w.state.lightProbeGridArray),ke=pe.getProgramCacheKey(we),Me=V.programs;V.environment=E.isMeshStandardMaterial||E.isMeshLambertMaterial||E.isMeshPhongMaterial?O.environment:null,V.fog=O.fog;let st=E.isMeshStandardMaterial||E.isMeshLambertMaterial&&!E.envMap||E.isMeshPhongMaterial&&!E.envMap;V.envMap=B.get(E.envMap||V.environment,st),V.envMapRotation=V.environment!==null&&E.envMap===null?O.environmentRotation:E.envMapRotation,Me===void 0&&(E.addEventListener("dispose",It),Me=new Map,V.programs=Me);let at=Me.get(ke);if(at!==void 0){if(V.currentProgram===at&&V.lightsStateVersion===Pe)return fc(E,we),at}else we.uniforms=pe.getUniforms(E),F!==null&&E.isNodeMaterial&&F.build(E,X,we),E.onBeforeCompile(we,I),at=pe.acquireProgram(we,ke),Me.set(ke,at),V.uniforms=we.uniforms;let Ge=V.uniforms;return(!E.isShaderMaterial&&!E.isRawShaderMaterial||E.clipping===!0)&&(Ge.clippingPlanes=De.uniform),fc(E,we),V.needsLights=dc(E),V.lightsStateVersion=Pe,V.needsLights&&(Ge.ambientLightColor.value=H.state.ambient,Ge.lightProbe.value=H.state.probe,Ge.directionalLights.value=H.state.directional,Ge.directionalLightShadows.value=H.state.directionalShadow,Ge.spotLights.value=H.state.spot,Ge.spotLightShadows.value=H.state.spotShadow,Ge.rectAreaLights.value=H.state.rectArea,Ge.ltc_1.value=H.state.rectAreaLTC1,Ge.ltc_2.value=H.state.rectAreaLTC2,Ge.pointLights.value=H.state.point,Ge.pointLightShadows.value=H.state.pointShadow,Ge.hemisphereLights.value=H.state.hemi,Ge.directionalShadowMatrix.value=H.state.directionalShadowMatrix,Ge.spotLightMatrix.value=H.state.spotLightMatrix,Ge.spotLightMap.value=H.state.spotLightMap,Ge.pointShadowMatrix.value=H.state.pointShadowMatrix),V.lightProbeGrid=w.state.lightProbeGridArray.length>0,V.currentProgram=at,V.uniformsList=null,at}function hc(E){if(E.uniformsList===null){let O=E.currentProgram.getUniforms();E.uniformsList=ma.seqWithValue(O.seq,E.uniforms)}return E.uniformsList}function fc(E,O){let X=T.get(E);X.outputColorSpace=O.outputColorSpace,X.batching=O.batching,X.batchingColor=O.batchingColor,X.instancing=O.instancing,X.instancingColor=O.instancingColor,X.instancingMorph=O.instancingMorph,X.skinning=O.skinning,X.morphTargets=O.morphTargets,X.morphNormals=O.morphNormals,X.morphColors=O.morphColors,X.morphTargetsCount=O.morphTargetsCount,X.numClippingPlanes=O.numClippingPlanes,X.numIntersection=O.numClipIntersection,X.vertexAlphas=O.vertexAlphas,X.vertexTangents=O.vertexTangents,X.toneMapping=O.toneMapping}function $n(E,O){if(E.length===0)return null;if(E.length===1)return E[0].texture!==null?E[0]:null;S.setFromMatrixPosition(O.matrixWorld);for(let X=0,V=E.length;X<V;X++){let H=E[X];if(H.texture!==null&&H.boundingBox.containsPoint(S))return H}return null}function li(E,O,X,V,H){O.isScene!==!0&&(O=Se),M.resetTextureUnits();let xe=O.fog,Pe=V.isMeshStandardMaterial||V.isMeshLambertMaterial||V.isMeshPhongMaterial?O.environment:null,we=U===null?I.outputColorSpace:U.isXRRenderTarget===!0?U.texture.colorSpace:xt.workingColorSpace,ke=V.isMeshStandardMaterial||V.isMeshLambertMaterial&&!V.envMap||V.isMeshPhongMaterial&&!V.envMap,Me=B.get(V.envMap||Pe,ke),st=V.vertexColors===!0&&!!X.attributes.color&&X.attributes.color.itemSize===4,at=!!X.attributes.tangent&&(!!V.normalMap||V.anisotropy>0),Ge=!!X.morphAttributes.position,pt=!!X.morphAttributes.normal,Nt=!!X.morphAttributes.color,Ct=Ni;V.toneMapped&&(U===null||U.isXRRenderTarget===!0)&&(Ct=I.toneMapping);let Tt=X.morphAttributes.position||X.morphAttributes.normal||X.morphAttributes.color,en=Tt!==void 0?Tt.length:0,Ie=T.get(V),Ht=w.state.lights;if(dt===!0&&(Ue===!0||E!==z)){let bt=E===z&&V.id===k;De.setState(V,E,bt)}let gt=!1;V.version===Ie.__version?(Ie.needsLights&&Ie.lightsStateVersion!==Ht.state.version||Ie.outputColorSpace!==we||H.isBatchedMesh&&Ie.batching===!1||!H.isBatchedMesh&&Ie.batching===!0||H.isBatchedMesh&&Ie.batchingColor===!0&&H.colorTexture===null||H.isBatchedMesh&&Ie.batchingColor===!1&&H.colorTexture!==null||H.isInstancedMesh&&Ie.instancing===!1||!H.isInstancedMesh&&Ie.instancing===!0||H.isSkinnedMesh&&Ie.skinning===!1||!H.isSkinnedMesh&&Ie.skinning===!0||H.isInstancedMesh&&Ie.instancingColor===!0&&H.instanceColor===null||H.isInstancedMesh&&Ie.instancingColor===!1&&H.instanceColor!==null||H.isInstancedMesh&&Ie.instancingMorph===!0&&H.morphTexture===null||H.isInstancedMesh&&Ie.instancingMorph===!1&&H.morphTexture!==null||Ie.envMap!==Me||V.fog===!0&&Ie.fog!==xe||Ie.numClippingPlanes!==void 0&&(Ie.numClippingPlanes!==De.numPlanes||Ie.numIntersection!==De.numIntersection)||Ie.vertexAlphas!==st||Ie.vertexTangents!==at||Ie.morphTargets!==Ge||Ie.morphNormals!==pt||Ie.morphColors!==Nt||Ie.toneMapping!==Ct||Ie.morphTargetsCount!==en||!!Ie.lightProbeGrid!=w.state.lightProbeGridArray.length>0)&&(gt=!0):(gt=!0,Ie.__version=V.version);let vn=Ie.currentProgram;gt===!0&&(vn=Ur(V,O,H),F&&V.isNodeMaterial&&F.onUpdateProgram(V,vn,Ie));let zn=!1,xi=!1,dn=!1,Et=vn.getUniforms(),Ft=Ie.uniforms;if(fe.useProgram(vn.program)&&(zn=!0,xi=!0,dn=!0),V.id!==k&&(k=V.id,xi=!0),Ie.needsLights){let bt=$n(w.state.lightProbeGridArray,H);Ie.lightProbeGrid!==bt&&(Ie.lightProbeGrid=bt,xi=!0)}if(zn||z!==E){fe.buffers.depth.getReversed()&&E.reversedDepth!==!0&&(E._reversedDepth=!0,E.updateProjectionMatrix()),Et.setValue(L,"projectionMatrix",E.projectionMatrix),Et.setValue(L,"viewMatrix",E.matrixWorldInverse);let zi=Et.map.cameraPosition;zi!==void 0&&zi.setValue(L,re.setFromMatrixPosition(E.matrixWorld)),Ke.logarithmicDepthBuffer&&Et.setValue(L,"logDepthBufFC",2/(Math.log(E.far+1)/Math.LN2)),(V.isMeshPhongMaterial||V.isMeshToonMaterial||V.isMeshLambertMaterial||V.isMeshBasicMaterial||V.isMeshStandardMaterial||V.isShaderMaterial)&&Et.setValue(L,"isOrthographic",E.isOrthographicCamera===!0),z!==E&&(z=E,xi=!0,dn=!0)}if(Ie.needsLights&&(Ht.state.directionalShadowMap.length>0&&Et.setValue(L,"directionalShadowMap",Ht.state.directionalShadowMap,M),Ht.state.spotShadowMap.length>0&&Et.setValue(L,"spotShadowMap",Ht.state.spotShadowMap,M),Ht.state.pointShadowMap.length>0&&Et.setValue(L,"pointShadowMap",Ht.state.pointShadowMap,M)),H.isSkinnedMesh){Et.setOptional(L,H,"bindMatrix"),Et.setOptional(L,H,"bindMatrixInverse");let bt=H.skeleton;bt&&(bt.boneTexture===null&&bt.computeBoneTexture(),Et.setValue(L,"boneTexture",bt.boneTexture,M))}H.isBatchedMesh&&(Et.setOptional(L,H,"batchingTexture"),Et.setValue(L,"batchingTexture",H._matricesTexture,M),Et.setOptional(L,H,"batchingIdTexture"),Et.setValue(L,"batchingIdTexture",H._indirectTexture,M),Et.setOptional(L,H,"batchingColorTexture"),H._colorsTexture!==null&&Et.setValue(L,"batchingColorTexture",H._colorsTexture,M));let ci=X.morphAttributes;if((ci.position!==void 0||ci.normal!==void 0||ci.color!==void 0)&&nt.update(H,X,vn),(xi||Ie.receiveShadow!==H.receiveShadow)&&(Ie.receiveShadow=H.receiveShadow,Et.setValue(L,"receiveShadow",H.receiveShadow)),(V.isMeshStandardMaterial||V.isMeshLambertMaterial||V.isMeshPhongMaterial)&&V.envMap===null&&O.environment!==null&&(Ft.envMapIntensity.value=O.environmentIntensity),Ft.dfgLUT!==void 0&&(Ft.dfgLUT.value=wR()),xi){if(Et.setValue(L,"toneMappingExposure",I.toneMappingExposure),Ie.needsLights&&Kt(Ft,dn),xe&&V.fog===!0&&Y.refreshFogUniforms(Ft,xe),Y.refreshMaterialUniforms(Ft,V,et,vt,w.state.transmissionRenderTarget[E.id]),Ie.needsLights&&Ie.lightProbeGrid){let bt=Ie.lightProbeGrid;Ft.probesSH.value=bt.texture,Ft.probesMin.value.copy(bt.boundingBox.min),Ft.probesMax.value.copy(bt.boundingBox.max),Ft.probesResolution.value.copy(bt.resolution)}ma.upload(L,hc(Ie),Ft,M)}if(V.isShaderMaterial&&V.uniformsNeedUpdate===!0&&(ma.upload(L,hc(Ie),Ft,M),V.uniformsNeedUpdate=!1),V.isSpriteMaterial&&Et.setValue(L,"center",H.center),Et.setValue(L,"modelViewMatrix",H.modelViewMatrix),Et.setValue(L,"normalMatrix",H.normalMatrix),Et.setValue(L,"modelMatrix",H.matrixWorld),V.uniformsGroups!==void 0){let bt=V.uniformsGroups;for(let zi=0,cr=bt.length;zi<cr;zi++){let Cn=bt[zi];J.update(Cn,vn),J.bind(Cn,vn)}}return vn}function Kt(E,O){E.ambientLightColor.needsUpdate=O,E.lightProbe.needsUpdate=O,E.directionalLights.needsUpdate=O,E.directionalLightShadows.needsUpdate=O,E.pointLights.needsUpdate=O,E.pointLightShadows.needsUpdate=O,E.spotLights.needsUpdate=O,E.spotLightShadows.needsUpdate=O,E.rectAreaLights.needsUpdate=O,E.hemisphereLights.needsUpdate=O}function dc(E){return E.isMeshLambertMaterial||E.isMeshToonMaterial||E.isMeshPhongMaterial||E.isMeshStandardMaterial||E.isShadowMaterial||E.isShaderMaterial&&E.lights===!0}this.getActiveCubeFace=function(){return W},this.getActiveMipmapLevel=function(){return q},this.getRenderTarget=function(){return U},this.setRenderTargetTextures=function(E,O,X){let V=T.get(E);V.__autoAllocateDepthBuffer=E.resolveDepthBuffer===!1,V.__autoAllocateDepthBuffer===!1&&(V.__useRenderToTexture=!1),T.get(E.texture).__webglTexture=O,T.get(E.depthTexture).__webglTexture=V.__autoAllocateDepthBuffer?void 0:X,V.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(E,O){let X=T.get(E);X.__webglFramebuffer=O,X.__useDefaultFramebuffer=O===void 0};let lr=L.createFramebuffer();this.setRenderTarget=function(E,O=0,X=0){U=E,W=O,q=X;let V=null,H=!1,xe=!1;if(E){let we=T.get(E);if(we.__useDefaultFramebuffer!==void 0){fe.bindFramebuffer(L.FRAMEBUFFER,we.__webglFramebuffer),ne.copy(E.viewport),le.copy(E.scissor),me=E.scissorTest,fe.viewport(ne),fe.scissor(le),fe.setScissorTest(me),k=-1;return}else if(we.__webglFramebuffer===void 0)M.setupRenderTarget(E);else if(we.__hasExternalTextures)M.rebindTextures(E,T.get(E.texture).__webglTexture,T.get(E.depthTexture).__webglTexture);else if(E.depthBuffer){let st=E.depthTexture;if(we.__boundDepthTexture!==st){if(st!==null&&T.has(st)&&(E.width!==st.image.width||E.height!==st.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");M.setupDepthRenderbuffer(E)}}let ke=E.texture;(ke.isData3DTexture||ke.isDataArrayTexture||ke.isCompressedArrayTexture)&&(xe=!0);let Me=T.get(E).__webglFramebuffer;E.isWebGLCubeRenderTarget?(Array.isArray(Me[O])?V=Me[O][X]:V=Me[O],H=!0):E.samples>0&&M.useMultisampledRTT(E)===!1?V=T.get(E).__webglMultisampledFramebuffer:Array.isArray(Me)?V=Me[X]:V=Me,ne.copy(E.viewport),le.copy(E.scissor),me=E.scissorTest}else ne.copy(ce).multiplyScalar(et).floor(),le.copy(Ve).multiplyScalar(et).floor(),me=qe;if(X!==0&&(V=lr),fe.bindFramebuffer(L.FRAMEBUFFER,V)&&fe.drawBuffers(E,V),fe.viewport(ne),fe.scissor(le),fe.setScissorTest(me),H){let we=T.get(E.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_CUBE_MAP_POSITIVE_X+O,we.__webglTexture,X)}else if(xe){let we=O;for(let ke=0;ke<E.textures.length;ke++){let Me=T.get(E.textures[ke]);L.framebufferTextureLayer(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0+ke,Me.__webglTexture,X,we)}}else if(E!==null&&X!==0){let we=T.get(E.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,we.__webglTexture,X)}k=-1},this.readRenderTargetPixels=function(E,O,X,V,H,xe,Pe,we=0){if(!(E&&E.isWebGLRenderTarget)){Je("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let ke=T.get(E).__webglFramebuffer;if(E.isWebGLCubeRenderTarget&&Pe!==void 0&&(ke=ke[Pe]),ke){fe.bindFramebuffer(L.FRAMEBUFFER,ke);try{let Me=E.textures[we],st=Me.format,at=Me.type;if(E.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+we),!Ke.textureFormatReadable(st)){Je("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Ke.textureTypeReadable(at)){Je("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}O>=0&&O<=E.width-V&&X>=0&&X<=E.height-H&&L.readPixels(O,X,V,H,D.convert(st),D.convert(at),xe)}finally{let Me=U!==null?T.get(U).__webglFramebuffer:null;fe.bindFramebuffer(L.FRAMEBUFFER,Me)}}},this.readRenderTargetPixelsAsync=async function(E,O,X,V,H,xe,Pe,we=0){if(!(E&&E.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let ke=T.get(E).__webglFramebuffer;if(E.isWebGLCubeRenderTarget&&Pe!==void 0&&(ke=ke[Pe]),ke)if(O>=0&&O<=E.width-V&&X>=0&&X<=E.height-H){fe.bindFramebuffer(L.FRAMEBUFFER,ke);let Me=E.textures[we],st=Me.format,at=Me.type;if(E.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+we),!Ke.textureFormatReadable(st))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Ke.textureTypeReadable(at))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Ge=L.createBuffer();L.bindBuffer(L.PIXEL_PACK_BUFFER,Ge),L.bufferData(L.PIXEL_PACK_BUFFER,xe.byteLength,L.STREAM_READ),L.readPixels(O,X,V,H,D.convert(st),D.convert(at),0);let pt=U!==null?T.get(U).__webglFramebuffer:null;fe.bindFramebuffer(L.FRAMEBUFFER,pt);let Nt=L.fenceSync(L.SYNC_GPU_COMMANDS_COMPLETE,0);return L.flush(),await tS(L,Nt,4),L.bindBuffer(L.PIXEL_PACK_BUFFER,Ge),L.getBufferSubData(L.PIXEL_PACK_BUFFER,0,xe),L.deleteBuffer(Ge),L.deleteSync(Nt),xe}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(E,O=null,X=0){let V=Math.pow(2,-X),H=Math.floor(E.image.width*V),xe=Math.floor(E.image.height*V),Pe=O!==null?O.x:0,we=O!==null?O.y:0;M.setTexture2D(E,0),L.copyTexSubImage2D(L.TEXTURE_2D,X,0,0,Pe,we,H,xe),fe.unbindTexture()};let va=L.createFramebuffer(),no=L.createFramebuffer();this.copyTextureToTexture=function(E,O,X=null,V=null,H=0,xe=0){let Pe,we,ke,Me,st,at,Ge,pt,Nt,Ct=E.isCompressedTexture?E.mipmaps[xe]:E.image;if(X!==null)Pe=X.max.x-X.min.x,we=X.max.y-X.min.y,ke=X.isBox3?X.max.z-X.min.z:1,Me=X.min.x,st=X.min.y,at=X.isBox3?X.min.z:0;else{let Ft=Math.pow(2,-H);Pe=Math.floor(Ct.width*Ft),we=Math.floor(Ct.height*Ft),E.isDataArrayTexture?ke=Ct.depth:E.isData3DTexture?ke=Math.floor(Ct.depth*Ft):ke=1,Me=0,st=0,at=0}V!==null?(Ge=V.x,pt=V.y,Nt=V.z):(Ge=0,pt=0,Nt=0);let Tt=D.convert(O.format),en=D.convert(O.type),Ie;O.isData3DTexture?(M.setTexture3D(O,0),Ie=L.TEXTURE_3D):O.isDataArrayTexture||O.isCompressedArrayTexture?(M.setTexture2DArray(O,0),Ie=L.TEXTURE_2D_ARRAY):(M.setTexture2D(O,0),Ie=L.TEXTURE_2D),fe.activeTexture(L.TEXTURE0),fe.pixelStorei(L.UNPACK_FLIP_Y_WEBGL,O.flipY),fe.pixelStorei(L.UNPACK_PREMULTIPLY_ALPHA_WEBGL,O.premultiplyAlpha),fe.pixelStorei(L.UNPACK_ALIGNMENT,O.unpackAlignment);let Ht=fe.getParameter(L.UNPACK_ROW_LENGTH),gt=fe.getParameter(L.UNPACK_IMAGE_HEIGHT),vn=fe.getParameter(L.UNPACK_SKIP_PIXELS),zn=fe.getParameter(L.UNPACK_SKIP_ROWS),xi=fe.getParameter(L.UNPACK_SKIP_IMAGES);fe.pixelStorei(L.UNPACK_ROW_LENGTH,Ct.width),fe.pixelStorei(L.UNPACK_IMAGE_HEIGHT,Ct.height),fe.pixelStorei(L.UNPACK_SKIP_PIXELS,Me),fe.pixelStorei(L.UNPACK_SKIP_ROWS,st),fe.pixelStorei(L.UNPACK_SKIP_IMAGES,at);let dn=E.isDataArrayTexture||E.isData3DTexture,Et=O.isDataArrayTexture||O.isData3DTexture;if(E.isDepthTexture){let Ft=T.get(E),ci=T.get(O),bt=T.get(Ft.__renderTarget),zi=T.get(ci.__renderTarget);fe.bindFramebuffer(L.READ_FRAMEBUFFER,bt.__webglFramebuffer),fe.bindFramebuffer(L.DRAW_FRAMEBUFFER,zi.__webglFramebuffer);for(let cr=0;cr<ke;cr++)dn&&(L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,T.get(E).__webglTexture,H,at+cr),L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,T.get(O).__webglTexture,xe,Nt+cr)),L.blitFramebuffer(Me,st,Pe,we,Ge,pt,Pe,we,L.DEPTH_BUFFER_BIT,L.NEAREST);fe.bindFramebuffer(L.READ_FRAMEBUFFER,null),fe.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else if(H!==0||E.isRenderTargetTexture||T.has(E)){let Ft=T.get(E),ci=T.get(O);fe.bindFramebuffer(L.READ_FRAMEBUFFER,va),fe.bindFramebuffer(L.DRAW_FRAMEBUFFER,no);for(let bt=0;bt<ke;bt++)dn?L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,Ft.__webglTexture,H,at+bt):L.framebufferTexture2D(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,Ft.__webglTexture,H),Et?L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,ci.__webglTexture,xe,Nt+bt):L.framebufferTexture2D(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,ci.__webglTexture,xe),H!==0?L.blitFramebuffer(Me,st,Pe,we,Ge,pt,Pe,we,L.COLOR_BUFFER_BIT,L.NEAREST):Et?L.copyTexSubImage3D(Ie,xe,Ge,pt,Nt+bt,Me,st,Pe,we):L.copyTexSubImage2D(Ie,xe,Ge,pt,Me,st,Pe,we);fe.bindFramebuffer(L.READ_FRAMEBUFFER,null),fe.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else Et?E.isDataTexture||E.isData3DTexture?L.texSubImage3D(Ie,xe,Ge,pt,Nt,Pe,we,ke,Tt,en,Ct.data):O.isCompressedArrayTexture?L.compressedTexSubImage3D(Ie,xe,Ge,pt,Nt,Pe,we,ke,Tt,Ct.data):L.texSubImage3D(Ie,xe,Ge,pt,Nt,Pe,we,ke,Tt,en,Ct):E.isDataTexture?L.texSubImage2D(L.TEXTURE_2D,xe,Ge,pt,Pe,we,Tt,en,Ct.data):E.isCompressedTexture?L.compressedTexSubImage2D(L.TEXTURE_2D,xe,Ge,pt,Ct.width,Ct.height,Tt,Ct.data):L.texSubImage2D(L.TEXTURE_2D,xe,Ge,pt,Pe,we,Tt,en,Ct);fe.pixelStorei(L.UNPACK_ROW_LENGTH,Ht),fe.pixelStorei(L.UNPACK_IMAGE_HEIGHT,gt),fe.pixelStorei(L.UNPACK_SKIP_PIXELS,vn),fe.pixelStorei(L.UNPACK_SKIP_ROWS,zn),fe.pixelStorei(L.UNPACK_SKIP_IMAGES,xi),xe===0&&O.generateMipmaps&&L.generateMipmap(Ie),fe.unbindTexture()},this.initRenderTarget=function(E){T.get(E).__webglFramebuffer===void 0&&M.setupRenderTarget(E)},this.initTexture=function(E){E.isCubeTexture?M.setTextureCube(E,0):E.isData3DTexture?M.setTexture3D(E,0):E.isDataArrayTexture||E.isCompressedArrayTexture?M.setTexture2DArray(E,0):M.setTexture2D(E,0),fe.unbindTexture()},this.resetState=function(){W=0,q=0,U=null,fe.reset(),ge.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Ii}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let n=this.getContext();n.drawingBufferColorSpace=xt._getDrawingBufferColorSpace(e),n.unpackColorSpace=xt._getUnpackColorSpace()}};var $f=class extends Zt{constructor(e=new Vt,n=new N,i=new Li,r=new N(1,1,1)){super();let s=[],o=[],a=[],l=new N,c=new rt().getNormalMatrix(e.matrixWorld),f=new At;f.makeRotationFromEuler(i),f.setPosition(n);let d=new At;d.copy(f).invert(),h(),this.setAttribute("position",new St(s,3)),this.setAttribute("uv",new St(a,2)),o.length>0&&this.setAttribute("normal",new St(o,3));function h(){let m=[],u=new N,g=new N,v=e.geometry,S=v.attributes.position,A=v.attributes.normal;if(v.index!==null){let w=v.index;for(let C=0;C<w.count;C++)u.fromBufferAttribute(S,w.getX(C)),A?(g.fromBufferAttribute(A,w.getX(C)),p(m,u,g)):p(m,u)}else{if(S===void 0)return;for(let w=0;w<S.count;w++)u.fromBufferAttribute(S,w),A?(g.fromBufferAttribute(A,w),p(m,u,g)):p(m,u)}m=_(m,l.set(1,0,0)),m=_(m,l.set(-1,0,0)),m=_(m,l.set(0,1,0)),m=_(m,l.set(0,-1,0)),m=_(m,l.set(0,0,1)),m=_(m,l.set(0,0,-1));for(let w=0;w<m.length;w++){let C=m[w];a.push(.5+C.position.x/r.x,.5+C.position.y/r.y),C.position.applyMatrix4(f),s.push(C.position.x,C.position.y,C.position.z),C.normal!==null&&o.push(C.normal.x,C.normal.y,C.normal.z)}}function p(m,u,g=null){u.applyMatrix4(e.matrixWorld),u.applyMatrix4(d),g?(g.applyNormalMatrix(c),m.push(new uc(u.clone(),g.clone()))):m.push(new uc(u.clone()))}function _(m,u){let g=[],v=.5*Math.abs(r.dot(u));for(let S=0;S<m.length;S+=3){let A=0,w,C,x,b,I=m[S+0].position.dot(u)-v,P=m[S+1].position.dot(u)-v,F=m[S+2].position.dot(u)-v,W=I>0,q=P>0,U=F>0;switch(A=(W?1:0)+(q?1:0)+(U?1:0),A){case 0:{g.push(m[S]),g.push(m[S+1]),g.push(m[S+2]);break}case 1:{if(W&&(w=m[S+1],C=m[S+2],x=y(m[S],w,u,v),b=y(m[S],C,u,v)),q){w=m[S],C=m[S+2],x=y(m[S+1],w,u,v),b=y(m[S+1],C,u,v),g.push(x),g.push(C.clone()),g.push(w.clone()),g.push(C.clone()),g.push(x.clone()),g.push(b);break}U&&(w=m[S],C=m[S+1],x=y(m[S+2],w,u,v),b=y(m[S+2],C,u,v)),g.push(w.clone()),g.push(C.clone()),g.push(x),g.push(b),g.push(x.clone()),g.push(C.clone());break}case 2:{W||(w=m[S].clone(),C=y(w,m[S+1],u,v),x=y(w,m[S+2],u,v),g.push(w),g.push(C),g.push(x)),q||(w=m[S+1].clone(),C=y(w,m[S+2],u,v),x=y(w,m[S],u,v),g.push(w),g.push(C),g.push(x)),U||(w=m[S+2].clone(),C=y(w,m[S],u,v),x=y(w,m[S+1],u,v),g.push(w),g.push(C),g.push(x));break}case 3:break}}return g}function y(m,u,g,v){let S=m.position.dot(g)-v,A=u.position.dot(g)-v,w=S/(S-A),C=new N(m.position.x+w*(u.position.x-m.position.x),m.position.y+w*(u.position.y-m.position.y),m.position.z+w*(u.position.z-m.position.z)),x=null;return m.normal!==null&&u.normal!==null&&(x=new N(m.normal.x+w*(u.normal.x-m.normal.x),m.normal.y+w*(u.normal.y-m.normal.y),m.normal.z+w*(u.normal.z-m.normal.z))),new uc(C,x)}}},uc=class{constructor(e,n=null){this.position=e,this.normal=n}clone(){let e=this.position.clone(),n=this.normal!==null?this.normal.clone():null;return new this.constructor(e,n)}};var Oi=gc(Jg()),jg=null;function WS(t){var e;t.source!==window.parent||t.origin!==window.location.origin||((e=t.data)==null?void 0:e.type)!=="playable-active"||typeof t.data.active!="boolean"||(jg=t.data.active)}window.addEventListener("message",WS);window.addEventListener("pagehide",()=>window.removeEventListener("message",WS),{once:!0});var HS={FRIEND_NAME:"Buddy",FRIEND_AVATAR:"assets/friend-avatar.webp",HINT:"Tap to throw \xB7 drag to aim",AGAIN:"Play again",TARGET_RADIUS:.085},IR=`
@font-face{font-family:Poppins;src:url('assets/fonts/Poppins-Regular.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:Poppins;src:url('assets/fonts/Poppins-Bold.woff2') format('woff2');font-style:normal;font-weight:700;font-display:swap}
*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{background:#e9dcc6}
.game{position:relative;width:100%;height:100%;overflow:hidden;color:#493625;--font-ui:Poppins,sans-serif;font-family:var(--font-ui);user-select:none;-webkit-user-select:none}
.stage{position:absolute;inset:0}.stage canvas{display:block;width:100%;height:100%;touch-action:none}
.score{position:absolute;top:30px;left:50%;transform:translateX(-50%);font-size:28px;font-weight:700;line-height:42px;min-width:64px;text-align:center;color:#493625;background:#fff8eadd;border-radius:18px;padding:0 12px;pointer-events:none;font-variant-numeric:tabular-nums}
.throw-feedback{position:absolute;bottom:50px;left:30px;right:30px;text-align:center;pointer-events:none;font:700 18px/1.4 var(--font-ui);color:#493625;background:#fff8ede8;border-radius:16px;padding:10px 14px;z-index:3}.error{position:absolute;inset:30px;display:grid;place-items:center;text-align:center;font-size:18px}.hint{position:absolute;left:30px;right:30px;top:32%;text-align:center;pointer-events:none;font-size:18px;line-height:27px;color:#493625;animation:breathe 2.3s ease-in-out infinite}
.hint span{display:inline-block;max-width:100%;overflow-wrap:anywhere;background:#fff8eae8;padding:7px 13px;border-radius:24px;box-shadow:0 2px 8px #785a2220}
@keyframes breathe{50%{opacity:.66;transform:scale(.98)}}
@media(prefers-reduced-motion:reduce){.hint{animation:none!important}}
.game[data-paused=true] .hint{animation-play-state:paused}
`;function LR(){let t=(0,Bi.useRef)(null),e=(0,Bi.useRef)(null),[n,i]=(0,Bi.useState)(HS),[r,s]=(0,Bi.useState)(!1),[o,a]=(0,Bi.useState)({state:"ready",score:0,outcome:null,paused:!0,showHint:!0,attempts:0,lastOutcome:null}),[l,c]=(0,Bi.useState)("");return(0,Bi.useEffect)(()=>{let f=!1,d=new AbortController,h=setTimeout(()=>d.abort(),1500);return fetch("game.config.json",{signal:d.signal}).then(p=>p.ok?p.json():Promise.reject(new Error("Config unavailable"))).then(p=>{if(f)return;let _={...HS};for(let u of p.texts||[])u.id in _&&typeof u.value=="string"&&(_[u.id]=u.value);let y=(p.images||[]).find(u=>u.id==="FRIEND_AVATAR");y!=null&&y.path&&!/^(https?:|\/\/)/i.test(y.path)&&(_.FRIEND_AVATAR=y.path);let m=(p.tweaks||[]).find(u=>u.id==="TARGET_RADIUS");Number.isFinite(m==null?void 0:m.value)&&(_.TARGET_RADIUS=Fi.clamp(m.value,.065,.11)),i(_)}).catch(()=>{}).finally(()=>{clearTimeout(h),f||s(!0)}),()=>{f=!0,d.abort(),clearTimeout(h)}},[]),(0,Bi.useEffect)(()=>{if(r){try{e.current=NR(t.current,n,a)}catch(f){c(`3D rendering unavailable. ${f.message}`)}return()=>{var f;(f=e.current)==null||f.dispose(),e.current=null}}},[r,n]),(0,Oi.jsxs)("main",{className:"game","data-testid":"game","data-state":o.state,"data-score":o.score,"data-outcome":o.outcome||"","data-attempts":o.attempts,"data-last-outcome":o.lastOutcome||"","data-paused":o.paused,children:[(0,Oi.jsx)("style",{children:IR}),(0,Oi.jsx)("div",{className:"stage",ref:t,"data-testid":"throw-surface"}),(0,Oi.jsx)("output",{className:"score","aria-label":"Score","data-testid":"score",children:o.score}),o.state==="ready"&&o.showHint&&(0,Oi.jsx)("div",{className:"hint","data-testid":"hint",children:(0,Oi.jsx)("span",{children:n.HINT})}),o.outcome&&(0,Oi.jsx)("div",{className:"throw-feedback",role:"status","data-testid":"throw-feedback",children:o.outcome==="bliss"?"Sweet relief!":o.outcome==="ouch"?"Try the orange spot":"Miss \u2014 try again"}),l&&(0,Oi.jsx)("div",{className:"error",role:"alert",children:l})]})}function NR(t,e,n){var o0;let i=new Xf({antialias:!0});i.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),i.shadowMap.enabled=!0,i.shadowMap.type=Jh,i.toneMapping=jl,i.toneMappingExposure=1.1,t.appendChild(i.domElement),i.domElement.setAttribute("aria-label","Tap to throw \xB7 drag to aim");let r=new Cl;r.background=new ft("#e9dcc6"),r.fog=new Al("#e9dcc6",7,16);let s=new bn(40,1,.05,60);r.add(new $l("#dfefff","#8a6a48",1.1));let o=new Kl("#fff0d8",2.3);o.position.set(-2.5,5,2.5),o.castShadow=!0,o.shadow.mapSize.set(1024,1024),o.shadow.radius=4,o.shadow.bias=-6e-4,Object.assign(o.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.5,far:14}),r.add(o);let a=(R,G,Q)=>{let $=document.createElement("canvas");$.width=R,$.height=G,Q($.getContext("2d"),R,G);let Z=new Ll($);return Z.colorSpace=Un,Z},l=(R,G=.75,Q={})=>new Xl({color:R,roughness:G,...Q}),c=R=>(R.traverse(G=>{G.isMesh&&(G.castShadow=!0,G.receiveShadow=!0)}),R),f=new ca(1,32,20),d=new er(1,1,1,24),h=new ds(1,1,1),p=(R,G,Q,$,Z,Ee,Fe=Ee,Xe=Ee,it=r)=>{let Le=new Vt(R,G);return Le.position.set(Q,$,Z),Le.scale.set(Ee,Fe,Xe),it.add(Le),Le},_=(R,G)=>R+Math.random()*(G-R),y=(R,G,Q)=>new N(R,G,Q),m=[],u=[],g=(R,G,Q)=>(R.wrapS=R.wrapT=qs,R.repeat.set(G,Q),u.push(R),R),v=g(a(512,512,(R,G,Q)=>{for(let $=0;$<8;$++){R.fillStyle=`hsl(${_(28,34)},${_(42,52)}%,${_(46,56)}%)`,R.fillRect($*G/8,0,G/8,Q);for(let Z=0;Z<14;Z++){R.strokeStyle=`rgba(70,35,10,${_(.08,.23)})`,R.lineWidth=_(1,2.5);let Ee=$*G/8+_(0,G/8);R.beginPath(),R.moveTo(Ee,0),R.bezierCurveTo(Ee+_(-4,4),Q*.3,Ee+_(-4,4),Q*.6,Ee,Q),R.stroke()}R.fillStyle="rgba(40,20,5,.45)",R.fillRect($*G/8,0,2,Q),R.fillRect($*G/8,$*.37%1*Q,G/8,2)}}),2.5,2.5),S=new Vt(new tr(12,12),l("#ffffff",.6,{map:v}));S.rotation.x=-Math.PI/2,S.receiveShadow=!0,r.add(S),m.push(S);let A=g(a(256,256,(R,G,Q)=>{R.fillStyle="#f3ead9",R.fillRect(0,0,G,Q);for(let $=0;$<3e3;$++)R.fillStyle=`rgba(120,90,60,${_(0,.06)})`,R.fillRect(_(0,G),_(0,Q),2,2)}),3,2),w=l("#ffffff",.95,{map:A}),C=l("#a87a4e",.7);for(let[R,G,Q,$]of[[8,0,-1.85,0],[9,-2.4,2,Math.PI/2],[9,2.4,2,-Math.PI/2]]){let Z=new hn;Z.position.set(G,0,Q),Z.rotation.y=$,r.add(Z);let Ee=p(new tr(1,1),w,0,1.5,0,R,3,1,Z);Ee.receiveShadow=!0,m.push(Ee),p(h,C,0,.45,.02,R,.9,.04,Z),p(h,l("#7a5232",.6),0,.92,.05,R,.05,.06,Z)}let x=new hn;x.position.set(2.38,1.65,-.4),x.rotation.y=-Math.PI/2,r.add(x);let b=a(4,128,(R,G,Q)=>{let $=R.createLinearGradient(0,0,0,Q);$.addColorStop(0,"#7cc0f0"),$.addColorStop(1,"#e8f6ff"),R.fillStyle=$,R.fillRect(0,0,G,Q)});u.push(b),p(new tr(1,1),new Qi({map:b,fog:!1}),0,0,.01,1.1,.9,1,x);let I=l("#f6f1e8",.5);for(let[R,G,Q,$]of[[0,.47,1.2,.06],[0,-.47,1.2,.06],[-.57,0,.06,1],[.57,0,.06,1],[0,0,.04,.9],[0,0,1.1,.04]])p(h,I,R,G,.03,Q,$,.05,x);let P=new hn;P.position.set(.15,1.45,-1.83),P.rotation.z=.03,r.add(P),p(h,l("#5a3a22",.5),0,0,0,.78,.98,.03,P),p(new tr(1,1),l("#fbf6ea"),0,0,.017,.7,.9,1,P);for(let R of[-1,1]){p(h,l("#bf9875"),R*.11,0,.021,.003,.56,.002,P);for(let G=0;G<5;G++)p(new Ul(.017,16),new Qi({color:"#dd8d3b"}),R*.11,-.22+.11*G,.023,1,1,1,P)}let F=new hn;F.position.set(-1.5,0,-1.4),r.add(F);let W=p(new er(.22,.17,.42,24),l("#c9744a"),0,.21,0,1,1,1,F);p(new er(.2,.2,.02,24),l("#4a3020"),0,.42,0,1,1,1,F);let q=l("#3f8f4a",.55),U=l("#5a7a3a");for(let R=0;R<9;R++){let G=R*2.4,Q=_(.5,1.1),$=_(.12,.3);p(d,U,Math.cos(G)*$/2,.42+Q/2,Math.sin(G)*$/2,.012,Q,.012,F).rotation.set(Math.sin(G)*.35,0,-Math.cos(G)*.35),p(f,q,Math.cos(G)*$,.42+Q,Math.sin(G)*$,.16,.025,.09,F).rotation.set(_(-.4,.4),-G,_(-.5,.5))}c(F),m.push(W);let k=new hn;k.position.set(1.3,0,-1.2),r.add(k);let z=l("#d8dde2",.3,{metalness:.6});for(let R of[.3,.75])m.push(p(h,l("#f4f6f8",.45),0,R,0,.6,.03,.42,k));for(let R of[-.27,.27])for(let G of[-.18,.18])p(d,z,R,.4,G,.015,.8,.015,k);p(h,l("#e04a5a",.6),-.1,.8,0,.18,.07,.12,k),p(new er(.06,.06,.16,16),l("#fff",.3),.15,.85,.05,1,1,1,k),p(h,l("#fff"),.12,.33,0,.36,.05,.3,k),c(k);let ne=.62,le=-1.08,me=new hn;r.add(me);let Ce=g(a(128,128,(R,G,Q)=>{R.fillStyle="#3a8f86",R.fillRect(0,0,G,Q);for(let $=0;$<1200;$++)R.fillStyle=`rgba(0,30,30,${_(0,.07)})`,R.beginPath(),R.arc(_(0,G),_(0,Q),_(1,2.5),0,7),R.fill()}),2,4),Be=l("#ffffff",.45,{map:Ce}),Qe=new aa;Qe.moveTo(-.41,1.3),Qe.lineTo(.41,1.3),Qe.lineTo(.41,-1),Qe.lineTo(-.41,-1),Qe.lineTo(-.41,1.3);let vt=new Zs;vt.absellipse(0,-le,.08,.1,0,Math.PI*2,!0),Qe.holes.push(vt);let et=new Gl(Qe,{depth:.14,bevelEnabled:!1,curveSegments:32});et.rotateX(-Math.PI/2),et.translate(0,ne-.13,0);let te=new Vt(et,Be);me.add(te),m.push(te);for(let R of[-1.3,1]){let G=p(new Dl(.07,.68,6,16),Be,0,ne-.06,R,1,1,1,me);G.rotation.z=Math.PI/2,m.push(G)}p(h,z,0,ne-.17,-.02,.74,.06,1.94,me),p(h,z,0,ne-.17,-1.22,.74,.06,.06,me);for(let R of[-.32,.32])for(let G of[-1.1,.8])p(d,z,R,(ne-.17)/2,G,.03,ne-.17,.03,me);let ye=new Vt(new Wl(.145,.05,14,32),l("#f6f2ea",.85));ye.rotation.x=Math.PI/2,ye.scale.set(1.05,1.15,1),ye.position.set(0,ne+.03,le),me.add(ye),m.push(ye),c(me);let ce=R=>G=>{let Q=0;for(;Q<R.length-2&&G>R[Q+1][0];)Q++;let[$,Z]=R[Q],[Ee,Fe]=R[Q+1],Xe=Fi.clamp((G-$)/(Ee-$),0,1);return Z+(Fe-Z)*(1-Math.cos(Xe*Math.PI))/2};function Ve(R,G,Q,$,Z,Ee){let it=[],Le=[];for(let je=0;je<=64;je++){let ct=je/64,an=R+(G-R)*ct,Rn=Q(ct),Fr=$(ct),YS=Z(ct);for(let Jf=0;Jf<=48;Jf++){let a0=-Math.PI+2*Math.PI*Jf/48,ya=Math.cos(a0),l0=Rn*Math.sin(a0),c0=ya>0?Fr*Math.pow(ya,.8):YS*ya;ya>0&&(c0+=Ee(l0,ct)*ya),it.push(l0,c0,an)}}for(let je=0;je<64;je++)for(let ct=0;ct<48;ct++){let an=je*49+ct,Rn=an+48+1;Le.push(an,Rn,an+1,Rn,Rn+1,an+1)}let Ne=new Zt;return Ne.setAttribute("position",new St(it,3)),Ne.setIndex(Le),Ne.computeVertexNormals(),Ne}let qe=(R,G)=>Math.exp(-((R/G)**2)),$e=y(0,1,0);function dt(R,G,Q,$,Z,Ee){let Fe=new N().subVectors(G,R),Xe=Fe.length(),it=new Vt(new er($,Q,Xe,18),Z);it.position.copy(R).addScaledVector(Fe,.5),it.quaternion.setFromUnitVectors($e,Fe.normalize()),Ee.add(it),p(f,Z,R.x,R.y,R.z,Q,Q,Q,Ee),p(f,Z,G.x,G.y,G.z,$,$,$,Ee)}let Ue=new hn;r.add(Ue);let ie=["torso","pelvis","head","uaL","faL","uaR","faR","legL","legR"],re={},j={},Se=[],ve,Ye=null,L,tt=new N,ze=new N,Ke=e.TARGET_RADIUS,fe=a(256,256,(R,G,Q)=>{let $=R.createRadialGradient(128,128,0,128,128,128);$.addColorStop(0,"rgba(255,230,140,1)"),$.addColorStop(.45,"rgba(255,170,60,.5)"),$.addColorStop(1,"rgba(255,140,40,0)"),R.fillStyle=$,R.fillRect(0,0,G,Q);let Z=128/1.6;R.strokeStyle="#ff7a2a",R.lineWidth=6;for(let Ee of[Z*.965,Z*.63])R.beginPath(),R.arc(128,128,Ee,0,7),R.stroke();R.fillStyle="#ff7a2a",R.beginPath(),R.arc(128,128,Z*.2,0,7),R.fill()});u.push(fe);let yt=new Qi({map:fe,transparent:!0,depthWrite:!1,polygonOffset:!0,polygonOffsetFactor:-4,toneMapped:!1}),T=new Set([f,d,h]);function M(){let R=new Set,G=new Set,Q=new Set;Ue.traverse($=>{$.isMesh&&$!==ae&&(T.has($.geometry)||R.add($.geometry),$.material!==yt&&(G.add($.material),$.material.map&&Q.add($.material.map)))});for(let $ of R)$.dispose();for(let $ of G)$.dispose();for(let $ of Q)$.dispose();Ue.clear()}function B(){M(),Ye=null,re={};for(let Le of ie){let Ne=new hn;Ne.matrixAutoUpdate=!1,Ne.userData.seg=Le,Ue.add(Ne),re[Le]=Ne}let R=l("#e5b088",.55),G=l("#3a2414",.8),Q=a(128,128,(Le,Ne,je)=>{Le.fillStyle="#f4d8a8",Le.fillRect(0,0,Ne,je),Le.fillStyle="rgba(0,0,0,.08)";for(let ct=0;ct<je;ct+=16)Le.fillRect(0,ct,Ne,6);for(let ct=0;ct<1500;ct++)Le.fillStyle=`rgba(255,255,255,${_(0,.25)})`,Le.fillRect(_(0,Ne),_(0,je),1,2)});Q.wrapS=Q.wrapT=qs,Q.repeat.set(2,3);let $=l("#ffffff",1,{map:Q}),Z=ne+.005,Ee=1.03;j={N:y(0,Z+.1,-.88),H:y(0,Z+.11,-1.1),P:y(0,Z+.1,0),SL:y(-.23*Ee,Z+.08,-.79),SR:y(.23*Ee,Z+.08,-.79),HL:y(-.15*Ee,Z+.09,.02),HR:y(.15*Ee,Z+.09,.02),EL:y(-.37,Z+.05,-1.03),ER:y(.37,Z+.05,-1.03),WL:y(-.1,Z+.05,-1.24),WR:y(.1,Z+.05,-1.24),KL:y(-.1,Z+.06,.55),KR:y(.1,Z+.06,.55),AL:y(-.095,Z+.05,.93),AR:y(.095,Z+.05,.93)},ve=new Vt(Ve(-.9,.08,Le=>Ee*ce([[0,.07],[.1,.2],[.2,.245],[.36,.215],[.68,.165],[1,.19]])(Le),ce([[0,.05],[.12,.095],[.3,.115],[.55,.095],[.75,.075],[1,.1]]),ce([[0,.05],[.15,.075],[1,.07]]),(Le,Ne)=>{let je=-.9+.98*Ne,ct=-.012*qe(Le,.022)*ce([[0,0],[.2,1],[.9,1],[1,.3]])(Ne);for(let an of[-1,1])ct+=.02*qe(Le-an*.095,.055)*qe(je+.66,.09);return ct}),R),ve.position.y=Z+.07,re.torso.add(ve);for(let Le of[-1,1])p(f,R,Le*.215*Ee,Z+.085,-.79,.075,.07,.085,re.torso);dt(y(0,Z+.1,-.86),y(0,Z+.1,-.98),.06,.052,R,re.head),p(f,R,0,Z+.11,-1.08,.08,.1,.11,re.head),p(f,G,0,Z+.14,-1.102,.086,.09,.108,re.head);for(let Le of[-1,1]){let Ne=Le<0?"L":"R",je=re["ua"+Ne],ct=re["fa"+Ne],an=j["S"+Ne],Rn=j["E"+Ne],Fr=j["W"+Ne];dt(an,Rn,.058,.045,R,je),p(f,R,Le*.29,Z+.075,-.9,.06,.05,.075,je).rotation.y=Le*.6,dt(Rn,Fr,.044,.034,R,ct),p(f,R,Fr.x-Le*.04,Z+.035,-1.27,.06,.022,.045,ct).rotation.y=Le*.5,p(f,R,Fr.x-Le*.02,Z+.035,-1.22,.025,.017,.012,ct).rotation.y=Le*1.1}let Fe=new Vt(Ve(-.06,.62,Le=>Ee*ce([[0,.205],[.25,.22],[.6,.2],[1,.17]])(Le),ce([[0,.1],[.22,.13],[.45,.1],[1,.075]]),()=>.075,(Le,Ne)=>-.02*qe(Le,.03)*ce([[0,.2],[.3,1],[1,.6]])(Ne)),$);Fe.position.y=Z+.075,Fe.scale.set(1.04,1.04,1),re.pelvis.add(Fe);for(let Le of[-1,1]){let Ne=Le<0?"L":"R",je=re["leg"+Ne];dt(j["K"+Ne],j["A"+Ne],.058,.032,R,je),p(f,R,Le*.1,Z+.075,.68,.058,.05,.1,je),p(f,R,Le*.1,Z+.035,.98,.038,.035,.065,je).rotation.x=1,p(f,R,Le*.1,Z+.075,.955,.033,.03,.03,je)}c(Ue),Se=[],Ue.traverse(Le=>{Le.isMesh&&Se.push(Le)}),Ue.updateMatrixWorld(!0);let Xe=new Js;Xe.set(y(_(-.09,.09),2,_(-.63,-.25)),y(0,-1,0));let it=Xe.intersectObject(ve,!1)[0];if(it){let Le=it.face.normal.clone().transformDirection(it.object.matrixWorld),Ne=new rn;Ne.position.copy(it.point),Ne.lookAt(it.point.clone().add(Le)),L=new Vt(new $f(ve,it.point,Ne.rotation,y(Ke*3.2,Ke*3.2,.12)),yt),L.renderOrder=2,re.torso.add(L),tt.copy(Ue.worldToLocal(it.point.clone()))}}let K={torso:["N","P","SL","SR"],pelvis:["P","KM","HL","HR"],head:["N","H","SL","SR"],uaL:["SL","EL","SL","SR"],faL:["EL","WL","SL","SR"],uaR:["SR","ER","SL","SR"],faR:["ER","WR","SL","SR"],legL:["KL","AL","HL","HR"],legR:["KR","AR","HL","HR"]},se=[["N","H"],["H","SL"],["H","SR"],["SL","EL"],["EL","WL"],["SR","ER"],["ER","WR"],["HL","KL"],["HR","KR"],["KL","AL"],["KR","AR"],["KL","KR"]],de=[["WL","SL"],["WR","SR"],["AL","HL"],["AR","HR"],["H","P"]],pe={N:.07,P:.08,SL:.07,SR:.07,HL:.08,HR:.08,H:.1,EL:.045,ER:.045,WL:.04,WR:.04,KL:.055,KR:.055,AL:.035,AR:.035},Y=new N,ee=new N,Ae=new N,De=(R,G,Q,$,Z)=>{let Ee=Y.subVectors(G,R).normalize(),Fe=ee.subVectors($,Q);Fe.addScaledVector(Ee,-Fe.dot(Ee)).normalize();let Xe=Ae.crossVectors(Fe,Ee);return Z.makeBasis(Fe,Ee,Xe)},_e=R=>R.KM.copy(R.KL).add(R.KR).multiplyScalar(.5),ue=1/120,nt=9.8;function ot(R){Ue.position.set(0,0,0),Ue.scale.set(1,1,1),Ue.updateMatrixWorld(!0);let G={},Q={},$={},Z={};for(let Ne in j)G[Ne]=j[Ne].clone(),Q[Ne]=j[Ne].clone(),Z[Ne]=j[Ne].clone();G.KM=new N,Z.KM=new N,_e(G),_e(Z);for(let Ne of ie){let je=K[Ne];$[Ne]=De(Z[je[0]],Z[je[1]],Z[je[2]],Z[je[3]],new At).transpose()}let Ee=[],Fe=(Ne,je,ct)=>Ee.push([Ne,je,j[Ne].distanceTo(j[je]),ct]),Xe=["N","SL","SR","P","HL","HR"];for(let Ne=0;Ne<Xe.length;Ne++)for(let je=Ne+1;je<Xe.length;je++)Fe(Xe[Ne],Xe[je],0);for(let[Ne,je]of se)Fe(Ne,je,0);for(let[Ne,je]of de)Fe(Ne,je,1);let it=Math.sign(R.x||Math.random()-.5),Le=_(1.2,1.8);for(let Ne in j){let je=j[Ne].distanceTo(R),ct=y(it*_(.2,.45),1.9+1.6*Math.max(0,.7-je),_(-.2,.2));/^[EWKA]/.test(Ne)&&ct.add(y(_(-1.6,1.6),_(0,1.8),_(-.8,.8))),ct.x+=(j[Ne].z-R.z)*Le*.5*it,Q[Ne].addScaledVector(ct,-ue)}Ye={p:G,q:Q,cons:Ee,restB:$,rp:Z,M:new At}}let ut=new N;function D(R,G,Q,$){let Z=.42+$-Math.abs(R),Ee=ne+$-G,Fe=G-(ne-.22-$),Xe=Q-(-1.4-$),it=1.08+$-Q;if(Math.min(Z,Ee,Fe,Xe,it)<=0)return null;let Le=Math.min(Z,Ee,Fe,Xe,it);return ut.set(0,0,0),Le===Ee?ut.y=Ee:Le===Z?ut.x=Math.sign(R||1)*Z:Le===Fe?ut.y=-Fe:Le===Xe?ut.z=-Xe:ut.z=it,ut}let ge=[...se,["N","P"],["SL","HL"],["SR","HR"],["SL","SR"],["HL","HR"]];function J(R){let{p:G,q:Q,cons:$}=Ye;for(let Ee in j){let Fe=G[Ee],Xe=Q[Ee],it=(Fe.x-Xe.x)*.999,Le=(Fe.y-Xe.y)*.999,Ne=(Fe.z-Xe.z)*.999;Xe.copy(Fe),Fe.x+=it,Fe.y+=Le-nt*R*R,Fe.z+=Ne}let Z=new Set;for(let Ee=0;Ee<12;Ee++){for(let[Fe,Xe,it,Le]of $){let Ne=G[Fe],je=G[Xe],ct=Y.subVectors(je,Ne),an=ct.length()||1e-6;if(Le===1&&an>it*.7)continue;let Rn=(an-(Le===1?it*.7:it))/an*.5;Ne.addScaledVector(ct,Rn),je.addScaledVector(ct,-Rn)}for(let[Fe,Xe]of ge){let it=G[Fe],Le=G[Xe],Ne=Math.min(pe[Fe],pe[Xe]);for(let je of[.25,.5,.75]){let ct=D(it.x+(Le.x-it.x)*je,it.y+(Le.y-it.y)*je,it.z+(Le.z-it.z)*je,Ne);if(!ct)continue;let an=1-je,Rn=je,Fr=1/(an*an+Rn*Rn);it.addScaledVector(ct,an*Fr),Le.addScaledVector(ct,Rn*Fr),Z.add(Fe),Z.add(Xe)}}for(let Fe in j){let Xe=G[Fe],it=pe[Fe],Le=D(Xe.x,Xe.y,Xe.z,it);Le&&(Xe.add(Le),Z.add(Fe)),Xe.y<it&&(Xe.y=it,Z.add(Fe)),Xe.x=Fi.clamp(Xe.x,-2.3,2.3),Xe.z=Math.max(Xe.z,-1.75)}}for(let Ee of Z){let Fe=G[Ee],Xe=Q[Ee];Xe.x+=(Fe.x-Xe.x)*.15,Xe.z+=(Fe.z-Xe.z)*.15}}function Re(){let{p:R,restB:G,rp:Q,M:$}=Ye;_e(R);for(let Z of ie){let Ee=K[Z],Fe=re[Z];De(R[Ee[0]],R[Ee[1]],R[Ee[2]],R[Ee[3]],$).multiply(G[Z]),Fe.matrix.copy($).setPosition(0,0,0);let Xe=Q[Ee[0]].clone().applyMatrix4(Fe.matrix);Fe.matrix.setPosition(R[Ee[0]].x-Xe.x,R[Ee[0]].y-Xe.y,R[Ee[0]].z-Xe.z),Fe.matrixWorldNeedsUpdate=!0}}let ae=new hn,oe=l("#f4f7fa",.2,{metalness:.42});p(new er(.0028,.001,.22,10),oe,0,0,-.11,1,1,1,ae).rotation.x=Math.PI/2,c(ae),ae.scale.setScalar(1.95),r.add(ae);let He=y(0,1.32,1.75),We=new N,It=new N,Mt=new N,Yn=new N,Lt="ready",Lr=0,_a=0,Ms=null,kn=null,ai=0,Nr=0,Dr=0,ki=0,lt=null,ar=!1,Ur=!1,hc=window.parent!==window,fc=hc&&new URLSearchParams(window.location.search).get("feedReview")==="1",$n=typeof jg=="boolean"?jg:!fc,li=!document.hidden,Kt=null,dc=(o0=window.matchMedia)==null?void 0:o0.call(window,"(prefers-reduced-motion: reduce)").matches,lr=()=>n({state:Lt,score:Lr,outcome:kn,paused:!$n||!li,showHint:!ar,attempts:_a,lastOutcome:Ms});function va(){if(!(!$n||!li))try{Kt||(Kt=new(window.AudioContext||window.webkitAudioContext)),Kt.state!=="running"&&Kt.resume().catch(()=>{})}catch{Kt=null}}function no(R,G,Q,$=.08){if(!$n||!li||!Kt||Kt.state!=="running")return;let Z=Kt.createOscillator(),Ee=Kt.createGain(),Fe=Kt.currentTime;Z.type="sine",Z.frequency.setValueAtTime(R,Fe),Z.frequency.exponentialRampToValueAtTime(G,Fe+Q),Ee.gain.setValueAtTime($,Fe),Ee.gain.exponentialRampToValueAtTime(.001,Fe+Q),Z.connect(Ee).connect(Kt.destination),Z.onended=()=>{Z.disconnect(),Ee.disconnect()},Z.start(),Z.stop(Fe+Q+.02)}let E=[],O=new ca(1,8,6);function X(R,G,Q){for(let $=0;$<G;$++){let Z=new Vt(O,new Qi({color:Q,transparent:!0,depthWrite:!1}));Z.position.copy(R),Z.scale.setScalar(.012),r.add(Z);let Ee=_(0,Math.PI*2);E.push({m:Z,v:y(Math.cos(Ee)*.3,_(.15,.4),Math.sin(Ee)*.3),t:0})}}function V(){for(let R of E)r.remove(R.m),R.m.material.dispose();E.length=0}let H=new Js,xe=new N,Pe=new N;function we(R){let G=Se.includes(R.object);if(xe.copy(Mt).normalize(),We.copy(R.point).addScaledVector(xe,G?.035:.02),ae.position.copy(We),ae.lookAt(We.clone().sub(xe)),Lt="stuck",Dr=0,G){Ue.updateMatrixWorld(!0),ze.copy(Ue.localToWorld(tt.clone()));let Q=R.point.distanceTo(ze),$=Q<Ke?Math.max(1,Math.round(100*(1-Q/Ke)**.8)):0;if($>0)Lr+=$,kn="bliss",Ue.attach(ae),ki=.001,X(R.point,20,"#ffd36a"),no(420,720,.35);else{kn="ouch";let Z=R.object;for(;Z&&!Z.userData.seg;)Z=Z.parent;ot(R.point),(Z||Ue).attach(ae),X(R.point,8,"#ff5a4a"),no(260,90,.22)}}else kn="miss",no(140,70,.15),X(R.point,6,"#c8b090");Ms=kn,lr()}function ke(R=!1){Ur||(ur(),ae.parent!==r&&r.attach(ae),V(),Ue.position.set(0,0,0),Ue.scale.set(1,1,1),B(),Lt="ready",R||(Lr=0,_a=0,Ms=null,ar=!1),kn=null,ki=0,ai=0,Nr=0,Dr=0,yt.opacity=.95,Yn.set(0,0,0),We.copy(He),It.copy(We),lr(),R||(mc(0),ro()))}let Me={x:0,y:0,vx:0,vy:0,targetX:_(-.28,.28),targetY:_(-.14,.14),remaining:1};function st(R){if(Lt!=="ready")return;Me.remaining-=R,Me.remaining<=0&&(Me.targetX=_(-.28,.28),Me.targetY=_(-.14,.14),Me.remaining=_(.7,1.3));let G=Math.exp(-9*R);Me.vx=(Me.vx+(Me.targetX-Me.x)*28*R)*G,Me.vy=(Me.vy+(Me.targetY-Me.y)*28*R)*G,Me.x+=Me.vx*R,Me.y+=Me.vy*R}function at(R,G,Q,$){let Z=Fi.clamp(2.7+Q*5.2+(Q/$-1.5)*.26,2.75,6.5);return R.set(Fi.clamp(G/Math.max(Q,.08)*Z*.58,-3.3,3.3)+Z*Me.x,(.35+Me.y)*Z,-Z)}function Ge(R,G,Q){return R.copy(He).add(Pe.set(Fi.clamp(G*.15,-.12,.12)+Me.x*.18,Fi.clamp(Q*.06,-.06,.06)+Me.y*.18,0))}let pt={dx:0,length:.24,seconds:.24},Nt=new Float32Array(48*3),Ct=new Zt;Ct.setAttribute("position",new Fn(Nt,3)),Ct.setDrawRange(0,0);let Tt=a(32,32,R=>{R.clearRect(0,0,32,32),R.fillStyle="#fff",R.beginPath(),R.arc(16,16,14,0,Math.PI*2),R.fill()});u.push(Tt);let en=new $s({map:Tt,color:"#fff6cc",size:.045,transparent:!0,opacity:1,alphaTest:.1,depthWrite:!1,depthTest:!1}),Ie=new $s({map:Tt,color:"#61371f",size:.068,transparent:!0,opacity:.9,alphaTest:.1,depthWrite:!1,depthTest:!1}),Ht=new hn,gt=new sa(Ct,Ie),vn=new sa(Ct,en);gt.frustumCulled=vn.frustumCulled=!1,gt.renderOrder=3,vn.renderOrder=4,Ht.add(gt,vn),Ht.visible=!1,r.add(Ht);let zn=new N,xi=new N,dn=new N,Et=new N,Ft=new N,ci=new Js,bt=-1/0;function zi(){let R=Math.max(1,t.clientHeight);if(Lt!=="ready"||!li){Ht.visible=!1;return}let G=lt?(lt.currentX-lt.x)/R:0,Q=lt?(lt.y-lt.currentY)/R:0,$=lt&&Q>=.07&&Math.abs(G)<=Q*1.6;if(lt&&!$&&Math.hypot(G,Q)>.025){Ht.visible=!1;return}let Z=$?G:pt.dx,Ee=$?Q:pt.length,Fe=performance.now(),Xe=$?Math.max(.09,(Fe-lt.t)/1e3):pt.seconds;if(Fe-bt<50&&Ht.visible)return;bt=Fe,Ge(zn,Z,Ee),at(xi,Z,Ee,Xe),Et.copy(zn),r.updateMatrixWorld(!0);let it=0;for(let Le=1;Le<=48;Le++){let Ne=Le*ue*4;dn.copy(zn).addScaledVector(xi,Ne),dn.y-=.5*nt*Ne*(Ne+ue),Ft.subVectors(dn,Et);let je=Ft.length();ci.set(Et,Ft.normalize()),ci.far=je;let ct=ci.intersectObjects(Se.concat(m),!1)[0];if(ct&&dn.copy(ct.point),Nt[it*3]=dn.x,Nt[it*3+1]=dn.y,Nt[it*3+2]=dn.z,it++,ct||dn.y<-.5||dn.z<-6)break;Et.copy(dn)}Ct.setDrawRange(0,it),Ct.attributes.position.needsUpdate=!0,Ht.visible=it>0}function cr(R,G,Q){at(Mt,R,G,Q),Ge(We,R,G),It.copy(We),Ht.visible=!1,ar=!0,_a++,Lt="fly",Nr=0,no(540,210,.16,.045),lr(),ro()}let Cn=i.domElement;function Qg(R){var G;if(!(!$n||!li||Lt!=="ready"||lt||R.button!==void 0&&R.button!==0)){R.preventDefault(),lt={id:R.pointerId,x:R.clientX,y:R.clientY,currentX:R.clientX,currentY:R.clientY,t:performance.now()};try{(G=Cn.setPointerCapture)==null||G.call(Cn,R.pointerId)}catch{}va()}}function e0(R){if(!lt||R.pointerId!==lt.id||!$n||!li)return;let G=Math.max(1,t.clientHeight);R.preventDefault(),lt.currentX=R.clientX,lt.currentY=R.clientY,bt=-1/0,Yn.set(Fi.clamp((R.clientX-lt.x)/G*.15,-.12,.12),Fi.clamp((lt.y-R.clientY)/G*.06,-.06,.06),0),!ar&&Math.hypot(R.clientX-lt.x,R.clientY-lt.y)>=G*.012?(ar=!0,lr(),ro()):ar||mc(0)}function ur(R){var Q;if((R==null?void 0:R.pointerId)!==void 0&&lt&&R.pointerId!==lt.id)return;let G=lt==null?void 0:lt.id;lt=null,Yn.set(0,0,0),Ht.visible=!1,bt=-1/0;try{G!==void 0&&((Q=Cn.hasPointerCapture)!=null&&Q.call(Cn,G))&&Cn.releasePointerCapture(G)}catch{}}function t0(R){if(!lt||R.pointerId!==lt.id)return;let G=lt;if(ur(R),!$n||!li||Lt!=="ready")return;let Q=Math.max(1,t.clientHeight),$=(R.clientX-G.x)/Q,Z=(G.y-R.clientY)/Q;if(Math.hypot($,Z)<=.025){R.preventDefault(),va(),cr(pt.dx,pt.length,pt.seconds);return}Z<.07||Math.abs($)>Z*1.6||(R.preventDefault(),va(),cr($,Z,Math.max(.09,(performance.now()-G.t)/1e3)))}Cn.addEventListener("pointerdown",Qg,{passive:!1}),window.addEventListener("pointermove",e0,{capture:!0,passive:!1}),window.addEventListener("pointerup",t0,{capture:!0,passive:!1}),window.addEventListener("pointercancel",ur,!0),Cn.addEventListener("lostpointercapture",ur);function pc(){let R=Math.max(1,t.clientWidth),G=Math.max(1,t.clientHeight);i.setSize(R,G,!1),s.aspect=R/G,s.clearViewOffset();let Q=y(0,.75,.05),$=y(0,1.05,1).normalize(),Z=Math.max(4.3,4.65*Math.max(1,G/R/(598/390)));s.position.copy(Q).addScaledVector($,Z),s.lookAt(Q),s.updateProjectionMatrix(),s.updateMatrixWorld(),mc(0)}function XS(R,G=!1){if(ai+=R,st(R),Ye)G||J(R);else{let Q=dc?0:Math.sin(ai*1.7);Ue.scale.y=1-ki*.12,Ue.position.y=Q*.008+ne*ki*.12}if(ki>0&&!G&&(ki=Math.min(1,ki+R*1.5)),yt.opacity=dc?.9:.8+Math.sin(ai*5)*.15,!G){for(let Q=E.length-1;Q>=0;Q--){let $=E[Q];$.t+=R,$.v.y-=R*1.5,$.m.position.addScaledVector($.v,R),$.m.material.opacity=Math.max(0,1-$.t),$.t>=1&&(r.remove($.m),$.m.material.dispose(),E.splice(Q,1))}if(Lt==="fly"){Nr+=R,It.copy(We),Mt.y-=nt*R,We.addScaledVector(Mt,R),xe.subVectors(We,It);let Q=xe.length();if(Q>0){H.set(It,xe.normalize()),H.far=Q+.001,r.updateMatrixWorld(!0);let $=H.intersectObjects(Se.concat(m),!1)[0];if($){we($);return}}(We.y<-.5||Nr>4||Math.abs(We.x)>6||We.z<-6)&&(Lt="stuck",kn="miss",Ms=kn,Dr=0,lr())}else Lt==="stuck"&&(Dr+=R,Dr>(kn==="ouch"?2.6:kn==="bliss"?1.6:1.1)&&ke(!0))}}function mc(R){if(ae.visible=Lt!=="ready",Lt==="ready"){let G=Math.max(1,t.clientHeight),Q=lt?(lt.currentX-lt.x)/G:0,$=lt?(lt.y-lt.currentY)/G:0,Z=lt&&$>=.07&&Math.abs(Q)<=$*1.6,Ee=Z?Q:pt.dx,Fe=Z?$:pt.length,Xe=Z?Math.max(.09,(performance.now()-lt.t)/1e3):pt.seconds;Ge(ae.position,Ee,Fe),at(xe,Ee,Fe,Xe),ae.lookAt(Pe.copy(ae.position).sub(xe))}else Lt==="fly"&&(ae.position.lerpVectors(It,We,R),ae.lookAt(Pe.copy(ae.position).sub(Mt)));Ye&&Re(),zi(),i.render(r,s)}let io=0,Kf=performance.now(),xa=0;function n0(){return li&&$n}function i0(R){if(io=0,Ur||!n0())return;let G=Math.min(.05,(R-Kf)/1e3);for(Kf=R,xa+=G;xa>=ue;)XS(ue,!$n),xa-=ue;mc(xa/ue),io=requestAnimationFrame(i0)}function ro(){cancelAnimationFrame(io),io=0,Kf=performance.now(),xa=0,n0()&&(io=requestAnimationFrame(i0))}function qS(R){$n=R,$n||(ur(),Kt==null||Kt.suspend().catch(()=>{})),lr(),ro()}function r0(R){var G;R.source!==window.parent||R.origin!==window.location.origin||((G=R.data)==null?void 0:G.type)!=="playable-active"||typeof R.data.active!="boolean"||qS(R.data.active)}function s0(){li=!document.hidden,li||(ur(),Kt==null||Kt.suspend().catch(()=>{})),lr(),ro()}window.addEventListener("message",r0),document.addEventListener("visibilitychange",s0),window.addEventListener("resize",pc);let so=typeof ResizeObserver<"u"?new ResizeObserver(pc):null;return so==null||so.observe(t),ke(),pc(),i.compile(r,s),ro(),window.__acupuncture={get state(){return Lt},get score(){return Lr},get outcome(){return kn},get active(){return $n},get targetScreen(){let R=Ue.localToWorld(tt.clone()).project(s);return{x:(R.x+1)*t.clientWidth/2,y:(1-R.y)*t.clientHeight/2}},get startScreen(){let R=He.clone().project(s);return{x:(R.x+1)*t.clientWidth/2,y:(1-R.y)*t.clientHeight/2}}},{reset:ke,dispose(){Ur=!0,ur(),cancelAnimationFrame(io),so==null||so.disconnect(),window.removeEventListener("resize",pc),window.removeEventListener("message",r0),document.removeEventListener("visibilitychange",s0),Cn.removeEventListener("pointerdown",Qg),window.removeEventListener("pointermove",e0,!0),window.removeEventListener("pointerup",t0,!0),window.removeEventListener("pointercancel",ur,!0),Cn.removeEventListener("lostpointercapture",ur),Kt==null||Kt.close().catch(()=>{}),V();let R=new Set,G=new Set,Q=new Set(u);r.traverse($=>{if($.isMesh){R.add($.geometry);for(let Z of Array.isArray($.material)?$.material:[$.material])G.add(Z),Z.map&&Q.add(Z.map)}}),R.add(O),R.add(Ct),G.add(en),G.add(Ie);for(let $ of R)$.dispose();for(let $ of G)$.dispose();for(let $ of Q)$.dispose();i.dispose(),Cn.remove(),delete window.__acupuncture}}}(0,GS.createRoot)(document.getElementById("root")).render((0,Oi.jsx)(LR,{}));})();
