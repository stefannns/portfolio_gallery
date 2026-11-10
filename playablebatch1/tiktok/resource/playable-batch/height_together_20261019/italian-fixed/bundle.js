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

(()=>{var By=Object.create;var ug=Object.defineProperty;var ky=Object.getOwnPropertyDescriptor;var zy=Object.getOwnPropertyNames;var Vy=Object.getPrototypeOf,Gy=Object.prototype.hasOwnProperty;var Ji=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var Hy=(t,e,n,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of zy(e))!Gy.call(t,r)&&r!==n&&ug(t,r,{get:()=>e[r],enumerable:!(i=ky(e,r))||i.enumerable});return t};var Ll=(t,e,n)=>(n=t!=null?By(Vy(t)):{},Hy(e||!t||!t.__esModule?ug(n,"default",{value:t,enumerable:!0}):n,t));var c_=Ji(at=>{"use strict";var ka=Symbol.for("react.element"),YE=Symbol.for("react.portal"),qE=Symbol.for("react.fragment"),ZE=Symbol.for("react.strict_mode"),$E=Symbol.for("react.profiler"),jE=Symbol.for("react.provider"),KE=Symbol.for("react.context"),JE=Symbol.for("react.forward_ref"),QE=Symbol.for("react.suspense"),eT=Symbol.for("react.memo"),tT=Symbol.for("react.lazy"),J0=Symbol.iterator;function nT(t){return t===null||typeof t!="object"?null:(t=J0&&t[J0]||t["@@iterator"],typeof t=="function"?t:null)}var t_={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},n_=Object.assign,i_={};function xo(t,e,n){this.props=t,this.context=e,this.refs=i_,this.updater=n||t_}xo.prototype.isReactComponent={};xo.prototype.setState=function(t,e){if(typeof t!="object"&&typeof t!="function"&&t!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,t,e,"setState")};xo.prototype.forceUpdate=function(t){this.updater.enqueueForceUpdate(this,t,"forceUpdate")};function r_(){}r_.prototype=xo.prototype;function Hf(t,e,n){this.props=t,this.context=e,this.refs=i_,this.updater=n||t_}var Wf=Hf.prototype=new r_;Wf.constructor=Hf;n_(Wf,xo.prototype);Wf.isPureReactComponent=!0;var Q0=Array.isArray,s_=Object.prototype.hasOwnProperty,Xf={current:null},o_={key:!0,ref:!0,__self:!0,__source:!0};function a_(t,e,n){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)s_.call(e,i)&&!o_.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=n;else if(1<a){for(var l=Array(a),c=0;c<a;c++)l[c]=arguments[c+2];r.children=l}if(t&&t.defaultProps)for(i in a=t.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:ka,type:t,key:s,ref:o,props:r,_owner:Xf.current}}function iT(t,e){return{$$typeof:ka,type:t.type,key:e,ref:t.ref,props:t.props,_owner:t._owner}}function Yf(t){return typeof t=="object"&&t!==null&&t.$$typeof===ka}function rT(t){var e={"=":"=0",":":"=2"};return"$"+t.replace(/[=:]/g,function(n){return e[n]})}var e_=/\/+/g;function Gf(t,e){return typeof t=="object"&&t!==null&&t.key!=null?rT(""+t.key):e.toString(36)}function Vu(t,e,n,i,r){var s=typeof t;(s==="undefined"||s==="boolean")&&(t=null);var o=!1;if(t===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(t.$$typeof){case ka:case YE:o=!0}}if(o)return o=t,r=r(o),t=i===""?"."+Gf(o,0):i,Q0(r)?(n="",t!=null&&(n=t.replace(e_,"$&/")+"/"),Vu(r,e,n,"",function(c){return c})):r!=null&&(Yf(r)&&(r=iT(r,n+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(e_,"$&/")+"/")+t)),e.push(r)),1;if(o=0,i=i===""?".":i+":",Q0(t))for(var a=0;a<t.length;a++){s=t[a];var l=i+Gf(s,a);o+=Vu(s,e,n,l,r)}else if(l=nT(t),typeof l=="function")for(t=l.call(t),a=0;!(s=t.next()).done;)s=s.value,l=i+Gf(s,a++),o+=Vu(s,e,n,l,r);else if(s==="object")throw e=String(t),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function zu(t,e,n){if(t==null)return t;var i=[],r=0;return Vu(t,i,"","",function(s){return e.call(n,s,r++)}),i}function sT(t){if(t._status===-1){var e=t._result;e=e(),e.then(function(n){(t._status===0||t._status===-1)&&(t._status=1,t._result=n)},function(n){(t._status===0||t._status===-1)&&(t._status=2,t._result=n)}),t._status===-1&&(t._status=0,t._result=e)}if(t._status===1)return t._result.default;throw t._result}var In={current:null},Gu={transition:null},oT={ReactCurrentDispatcher:In,ReactCurrentBatchConfig:Gu,ReactCurrentOwner:Xf};function l_(){throw Error("act(...) is not supported in production builds of React.")}at.Children={map:zu,forEach:function(t,e,n){zu(t,function(){e.apply(this,arguments)},n)},count:function(t){var e=0;return zu(t,function(){e++}),e},toArray:function(t){return zu(t,function(e){return e})||[]},only:function(t){if(!Yf(t))throw Error("React.Children.only expected to receive a single React element child.");return t}};at.Component=xo;at.Fragment=qE;at.Profiler=$E;at.PureComponent=Hf;at.StrictMode=ZE;at.Suspense=QE;at.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=oT;at.act=l_;at.cloneElement=function(t,e,n){if(t==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+t+".");var i=n_({},t.props),r=t.key,s=t.ref,o=t._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=Xf.current),e.key!==void 0&&(r=""+e.key),t.type&&t.type.defaultProps)var a=t.type.defaultProps;for(l in e)s_.call(e,l)&&!o_.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=n;else if(1<l){a=Array(l);for(var c=0;c<l;c++)a[c]=arguments[c+2];i.children=a}return{$$typeof:ka,type:t.type,key:r,ref:s,props:i,_owner:o}};at.createContext=function(t){return t={$$typeof:KE,_currentValue:t,_currentValue2:t,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},t.Provider={$$typeof:jE,_context:t},t.Consumer=t};at.createElement=a_;at.createFactory=function(t){var e=a_.bind(null,t);return e.type=t,e};at.createRef=function(){return{current:null}};at.forwardRef=function(t){return{$$typeof:JE,render:t}};at.isValidElement=Yf;at.lazy=function(t){return{$$typeof:tT,_payload:{_status:-1,_result:t},_init:sT}};at.memo=function(t,e){return{$$typeof:eT,type:t,compare:e===void 0?null:e}};at.startTransition=function(t){var e=Gu.transition;Gu.transition={};try{t()}finally{Gu.transition=e}};at.unstable_act=l_;at.useCallback=function(t,e){return In.current.useCallback(t,e)};at.useContext=function(t){return In.current.useContext(t)};at.useDebugValue=function(){};at.useDeferredValue=function(t){return In.current.useDeferredValue(t)};at.useEffect=function(t,e){return In.current.useEffect(t,e)};at.useId=function(){return In.current.useId()};at.useImperativeHandle=function(t,e,n){return In.current.useImperativeHandle(t,e,n)};at.useInsertionEffect=function(t,e){return In.current.useInsertionEffect(t,e)};at.useLayoutEffect=function(t,e){return In.current.useLayoutEffect(t,e)};at.useMemo=function(t,e){return In.current.useMemo(t,e)};at.useReducer=function(t,e,n){return In.current.useReducer(t,e,n)};at.useRef=function(t){return In.current.useRef(t)};at.useState=function(t){return In.current.useState(t)};at.useSyncExternalStore=function(t,e,n){return In.current.useSyncExternalStore(t,e,n)};at.useTransition=function(){return In.current.useTransition()};at.version="18.3.1"});var Hu=Ji((Y2,u_)=>{"use strict";u_.exports=c_()});var y_=Ji(Pt=>{"use strict";function jf(t,e){var n=t.length;t.push(e);e:for(;0<n;){var i=n-1>>>1,r=t[i];if(0<Wu(r,e))t[i]=e,t[n]=r,n=i;else break e}}function Ri(t){return t.length===0?null:t[0]}function Yu(t){if(t.length===0)return null;var e=t[0],n=t.pop();if(n!==e){t[0]=n;e:for(var i=0,r=t.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=t[o],l=o+1,c=t[l];if(0>Wu(a,n))l<r&&0>Wu(c,a)?(t[i]=c,t[l]=n,i=l):(t[i]=a,t[o]=n,i=o);else if(l<r&&0>Wu(c,n))t[i]=c,t[l]=n,i=l;else break e}}return e}function Wu(t,e){var n=t.sortIndex-e.sortIndex;return n!==0?n:t.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(h_=performance,Pt.unstable_now=function(){return h_.now()}):(qf=Date,d_=qf.now(),Pt.unstable_now=function(){return qf.now()-d_});var h_,qf,d_,Yi=[],Hr=[],aT=1,di=null,yn=3,qu=!1,ws=!1,Va=!1,m_=typeof setTimeout=="function"?setTimeout:null,g_=typeof clearTimeout=="function"?clearTimeout:null,f_=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function Kf(t){for(var e=Ri(Hr);e!==null;){if(e.callback===null)Yu(Hr);else if(e.startTime<=t)Yu(Hr),e.sortIndex=e.expirationTime,jf(Yi,e);else break;e=Ri(Hr)}}function Jf(t){if(Va=!1,Kf(t),!ws)if(Ri(Yi)!==null)ws=!0,ep(Qf);else{var e=Ri(Hr);e!==null&&tp(Jf,e.startTime-t)}}function Qf(t,e){ws=!1,Va&&(Va=!1,g_(Ga),Ga=-1),qu=!0;var n=yn;try{for(Kf(e),di=Ri(Yi);di!==null&&(!(di.expirationTime>e)||t&&!x_());){var i=di.callback;if(typeof i=="function"){di.callback=null,yn=di.priorityLevel;var r=i(di.expirationTime<=e);e=Pt.unstable_now(),typeof r=="function"?di.callback=r:di===Ri(Yi)&&Yu(Yi),Kf(e)}else Yu(Yi);di=Ri(Yi)}if(di!==null)var s=!0;else{var o=Ri(Hr);o!==null&&tp(Jf,o.startTime-e),s=!1}return s}finally{di=null,yn=n,qu=!1}}var Zu=!1,Xu=null,Ga=-1,__=5,v_=-1;function x_(){return!(Pt.unstable_now()-v_<__)}function Zf(){if(Xu!==null){var t=Pt.unstable_now();v_=t;var e=!0;try{e=Xu(!0,t)}finally{e?za():(Zu=!1,Xu=null)}}else Zu=!1}var za;typeof f_=="function"?za=function(){f_(Zf)}:typeof MessageChannel<"u"?($f=new MessageChannel,p_=$f.port2,$f.port1.onmessage=Zf,za=function(){p_.postMessage(null)}):za=function(){m_(Zf,0)};var $f,p_;function ep(t){Xu=t,Zu||(Zu=!0,za())}function tp(t,e){Ga=m_(function(){t(Pt.unstable_now())},e)}Pt.unstable_IdlePriority=5;Pt.unstable_ImmediatePriority=1;Pt.unstable_LowPriority=4;Pt.unstable_NormalPriority=3;Pt.unstable_Profiling=null;Pt.unstable_UserBlockingPriority=2;Pt.unstable_cancelCallback=function(t){t.callback=null};Pt.unstable_continueExecution=function(){ws||qu||(ws=!0,ep(Qf))};Pt.unstable_forceFrameRate=function(t){0>t||125<t?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):__=0<t?Math.floor(1e3/t):5};Pt.unstable_getCurrentPriorityLevel=function(){return yn};Pt.unstable_getFirstCallbackNode=function(){return Ri(Yi)};Pt.unstable_next=function(t){switch(yn){case 1:case 2:case 3:var e=3;break;default:e=yn}var n=yn;yn=e;try{return t()}finally{yn=n}};Pt.unstable_pauseExecution=function(){};Pt.unstable_requestPaint=function(){};Pt.unstable_runWithPriority=function(t,e){switch(t){case 1:case 2:case 3:case 4:case 5:break;default:t=3}var n=yn;yn=t;try{return e()}finally{yn=n}};Pt.unstable_scheduleCallback=function(t,e,n){var i=Pt.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,t){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=n+r,t={id:aT++,callback:e,priorityLevel:t,startTime:n,expirationTime:r,sortIndex:-1},n>i?(t.sortIndex=n,jf(Hr,t),Ri(Yi)===null&&t===Ri(Hr)&&(Va?(g_(Ga),Ga=-1):Va=!0,tp(Jf,n-i))):(t.sortIndex=r,jf(Yi,t),ws||qu||(ws=!0,ep(Qf))),t};Pt.unstable_shouldYield=x_;Pt.unstable_wrapCallback=function(t){var e=yn;return function(){var n=yn;yn=e;try{return t.apply(this,arguments)}finally{yn=n}}}});var M_=Ji((Z2,S_)=>{"use strict";S_.exports=y_()});var Ty=Ji(ri=>{"use strict";var lT=Hu(),ni=M_();function le(t){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+t,n=1;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n]);return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var Rv=new Set,ul={};function Fs(t,e){zo(t,e),zo(t+"Capture",e)}function zo(t,e){for(ul[t]=e,t=0;t<e.length;t++)Rv.add(e[t])}var mr=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),bp=Object.prototype.hasOwnProperty,cT=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,w_={},b_={};function uT(t){return bp.call(b_,t)?!0:bp.call(w_,t)?!1:cT.test(t)?b_[t]=!0:(w_[t]=!0,!1)}function hT(t,e,n,i){if(n!==null&&n.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:n!==null?!n.acceptsBooleans:(t=t.toLowerCase().slice(0,5),t!=="data-"&&t!=="aria-");default:return!1}}function dT(t,e,n,i){if(e===null||typeof e>"u"||hT(t,e,n,i))return!0;if(i)return!1;if(n!==null)switch(n.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function Nn(t,e,n,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=n,this.propertyName=t,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var hn={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t){hn[t]=new Nn(t,0,!1,t,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(t){var e=t[0];hn[e]=new Nn(e,1,!1,t[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(t){hn[t]=new Nn(t,2,!1,t.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(t){hn[t]=new Nn(t,2,!1,t,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t){hn[t]=new Nn(t,3,!1,t.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(t){hn[t]=new Nn(t,3,!0,t,null,!1,!1)});["capture","download"].forEach(function(t){hn[t]=new Nn(t,4,!1,t,null,!1,!1)});["cols","rows","size","span"].forEach(function(t){hn[t]=new Nn(t,6,!1,t,null,!1,!1)});["rowSpan","start"].forEach(function(t){hn[t]=new Nn(t,5,!1,t.toLowerCase(),null,!1,!1)});var gm=/[\-:]([a-z])/g;function _m(t){return t[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t){var e=t.replace(gm,_m);hn[e]=new Nn(e,1,!1,t,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t){var e=t.replace(gm,_m);hn[e]=new Nn(e,1,!1,t,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(t){var e=t.replace(gm,_m);hn[e]=new Nn(e,1,!1,t,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(t){hn[t]=new Nn(t,1,!1,t.toLowerCase(),null,!1,!1)});hn.xlinkHref=new Nn("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(t){hn[t]=new Nn(t,1,!1,t.toLowerCase(),null,!0,!0)});function vm(t,e,n,i){var r=hn.hasOwnProperty(e)?hn[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(dT(e,n,r,i)&&(n=null),i||r===null?uT(e)&&(n===null?t.removeAttribute(e):t.setAttribute(e,""+n)):r.mustUseProperty?t[r.propertyName]=n===null?r.type===3?!1:"":n:(e=r.attributeName,i=r.attributeNamespace,n===null?t.removeAttribute(e):(r=r.type,n=r===3||r===4&&n===!0?"":""+n,i?t.setAttributeNS(i,e,n):t.setAttribute(e,n))))}var xr=lT.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,$u=Symbol.for("react.element"),Mo=Symbol.for("react.portal"),wo=Symbol.for("react.fragment"),xm=Symbol.for("react.strict_mode"),Ep=Symbol.for("react.profiler"),Pv=Symbol.for("react.provider"),Iv=Symbol.for("react.context"),ym=Symbol.for("react.forward_ref"),Tp=Symbol.for("react.suspense"),Ap=Symbol.for("react.suspense_list"),Sm=Symbol.for("react.memo"),Xr=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var Lv=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var E_=Symbol.iterator;function Ha(t){return t===null||typeof t!="object"?null:(t=E_&&t[E_]||t["@@iterator"],typeof t=="function"?t:null)}var Wt=Object.assign,np;function Ka(t){if(np===void 0)try{throw Error()}catch(n){var e=n.stack.trim().match(/\n( *(at )?)/);np=e&&e[1]||""}return`
`+np+t}var ip=!1;function rp(t,e){if(!t||ip)return"";ip=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(c){var i=c}Reflect.construct(t,[],e)}else{try{e.call()}catch(c){i=c}t.call(e.prototype)}else{try{throw Error()}catch(c){i=c}t()}}catch(c){if(c&&i&&typeof c.stack=="string"){for(var r=c.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return t.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",t.displayName)),l}while(1<=o&&0<=a);break}}}finally{ip=!1,Error.prepareStackTrace=n}return(t=t?t.displayName||t.name:"")?Ka(t):""}function fT(t){switch(t.tag){case 5:return Ka(t.type);case 16:return Ka("Lazy");case 13:return Ka("Suspense");case 19:return Ka("SuspenseList");case 0:case 2:case 15:return t=rp(t.type,!1),t;case 11:return t=rp(t.type.render,!1),t;case 1:return t=rp(t.type,!0),t;default:return""}}function Cp(t){if(t==null)return null;if(typeof t=="function")return t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case wo:return"Fragment";case Mo:return"Portal";case Ep:return"Profiler";case xm:return"StrictMode";case Tp:return"Suspense";case Ap:return"SuspenseList"}if(typeof t=="object")switch(t.$$typeof){case Iv:return(t.displayName||"Context")+".Consumer";case Pv:return(t._context.displayName||"Context")+".Provider";case ym:var e=t.render;return t=t.displayName,t||(t=e.displayName||e.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case Sm:return e=t.displayName||null,e!==null?e:Cp(t.type)||"Memo";case Xr:e=t._payload,t=t._init;try{return Cp(t(e))}catch{}}return null}function pT(t){var e=t.type;switch(t.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return t=e.render,t=t.displayName||t.name||"",e.displayName||(t!==""?"ForwardRef("+t+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return Cp(e);case 8:return e===xm?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function ss(t){switch(typeof t){case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function Dv(t){var e=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function mT(t){var e=Dv(t)?"checked":"value",n=Object.getOwnPropertyDescriptor(t.constructor.prototype,e),i=""+t[e];if(!t.hasOwnProperty(e)&&typeof n<"u"&&typeof n.get=="function"&&typeof n.set=="function"){var r=n.get,s=n.set;return Object.defineProperty(t,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(t,e,{enumerable:n.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){t._valueTracker=null,delete t[e]}}}}function ju(t){t._valueTracker||(t._valueTracker=mT(t))}function Nv(t){if(!t)return!1;var e=t._valueTracker;if(!e)return!0;var n=e.getValue(),i="";return t&&(i=Dv(t)?t.checked?"true":"false":t.value),t=i,t!==n?(e.setValue(t),!0):!1}function bh(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}function Rp(t,e){var n=e.checked;return Wt({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??t._wrapperState.initialChecked})}function T_(t,e){var n=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;n=ss(e.value!=null?e.value:n),t._wrapperState={initialChecked:i,initialValue:n,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function Uv(t,e){e=e.checked,e!=null&&vm(t,"checked",e,!1)}function Pp(t,e){Uv(t,e);var n=ss(e.value),i=e.type;if(n!=null)i==="number"?(n===0&&t.value===""||t.value!=n)&&(t.value=""+n):t.value!==""+n&&(t.value=""+n);else if(i==="submit"||i==="reset"){t.removeAttribute("value");return}e.hasOwnProperty("value")?Ip(t,e.type,n):e.hasOwnProperty("defaultValue")&&Ip(t,e.type,ss(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(t.defaultChecked=!!e.defaultChecked)}function A_(t,e,n){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+t._wrapperState.initialValue,n||e===t.value||(t.value=e),t.defaultValue=e}n=t.name,n!==""&&(t.name=""),t.defaultChecked=!!t._wrapperState.initialChecked,n!==""&&(t.name=n)}function Ip(t,e,n){(e!=="number"||bh(t.ownerDocument)!==t)&&(n==null?t.defaultValue=""+t._wrapperState.initialValue:t.defaultValue!==""+n&&(t.defaultValue=""+n))}var Ja=Array.isArray;function No(t,e,n,i){if(t=t.options,e){e={};for(var r=0;r<n.length;r++)e["$"+n[r]]=!0;for(n=0;n<t.length;n++)r=e.hasOwnProperty("$"+t[n].value),t[n].selected!==r&&(t[n].selected=r),r&&i&&(t[n].defaultSelected=!0)}else{for(n=""+ss(n),e=null,r=0;r<t.length;r++){if(t[r].value===n){t[r].selected=!0,i&&(t[r].defaultSelected=!0);return}e!==null||t[r].disabled||(e=t[r])}e!==null&&(e.selected=!0)}}function Lp(t,e){if(e.dangerouslySetInnerHTML!=null)throw Error(le(91));return Wt({},e,{value:void 0,defaultValue:void 0,children:""+t._wrapperState.initialValue})}function C_(t,e){var n=e.value;if(n==null){if(n=e.children,e=e.defaultValue,n!=null){if(e!=null)throw Error(le(92));if(Ja(n)){if(1<n.length)throw Error(le(93));n=n[0]}e=n}e==null&&(e=""),n=e}t._wrapperState={initialValue:ss(n)}}function Fv(t,e){var n=ss(e.value),i=ss(e.defaultValue);n!=null&&(n=""+n,n!==t.value&&(t.value=n),e.defaultValue==null&&t.defaultValue!==n&&(t.defaultValue=n)),i!=null&&(t.defaultValue=""+i)}function R_(t){var e=t.textContent;e===t._wrapperState.initialValue&&e!==""&&e!==null&&(t.value=e)}function Ov(t){switch(t){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function Dp(t,e){return t==null||t==="http://www.w3.org/1999/xhtml"?Ov(e):t==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":t}var Ku,Bv=function(t){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,n,i,r){MSApp.execUnsafeLocalFunction(function(){return t(e,n,i,r)})}:t}(function(t,e){if(t.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in t)t.innerHTML=e;else{for(Ku=Ku||document.createElement("div"),Ku.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=Ku.firstChild;t.firstChild;)t.removeChild(t.firstChild);for(;e.firstChild;)t.appendChild(e.firstChild)}});function hl(t,e){if(e){var n=t.firstChild;if(n&&n===t.lastChild&&n.nodeType===3){n.nodeValue=e;return}}t.textContent=e}var tl={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},gT=["Webkit","ms","Moz","O"];Object.keys(tl).forEach(function(t){gT.forEach(function(e){e=e+t.charAt(0).toUpperCase()+t.substring(1),tl[e]=tl[t]})});function kv(t,e,n){return e==null||typeof e=="boolean"||e===""?"":n||typeof e!="number"||e===0||tl.hasOwnProperty(t)&&tl[t]?(""+e).trim():e+"px"}function zv(t,e){t=t.style;for(var n in e)if(e.hasOwnProperty(n)){var i=n.indexOf("--")===0,r=kv(n,e[n],i);n==="float"&&(n="cssFloat"),i?t.setProperty(n,r):t[n]=r}}var _T=Wt({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function Np(t,e){if(e){if(_T[t]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(le(137,t));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(le(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(le(61))}if(e.style!=null&&typeof e.style!="object")throw Error(le(62))}}function Up(t,e){if(t.indexOf("-")===-1)return typeof e.is=="string";switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var Fp=null;function Mm(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var Op=null,Uo=null,Fo=null;function P_(t){if(t=Rl(t)){if(typeof Op!="function")throw Error(le(280));var e=t.stateNode;e&&(e=Jh(e),Op(t.stateNode,t.type,e))}}function Vv(t){Uo?Fo?Fo.push(t):Fo=[t]:Uo=t}function Gv(){if(Uo){var t=Uo,e=Fo;if(Fo=Uo=null,P_(t),e)for(t=0;t<e.length;t++)P_(e[t])}}function Hv(t,e){return t(e)}function Wv(){}var sp=!1;function Xv(t,e,n){if(sp)return t(e,n);sp=!0;try{return Hv(t,e,n)}finally{sp=!1,(Uo!==null||Fo!==null)&&(Wv(),Gv())}}function dl(t,e){var n=t.stateNode;if(n===null)return null;var i=Jh(n);if(i===null)return null;n=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(t=t.type,i=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!i;break e;default:t=!1}if(t)return null;if(n&&typeof n!="function")throw Error(le(231,e,typeof n));return n}var Bp=!1;if(mr)try{yo={},Object.defineProperty(yo,"passive",{get:function(){Bp=!0}}),window.addEventListener("test",yo,yo),window.removeEventListener("test",yo,yo)}catch{Bp=!1}var yo;function vT(t,e,n,i,r,s,o,a,l){var c=Array.prototype.slice.call(arguments,3);try{e.apply(n,c)}catch(d){this.onError(d)}}var nl=!1,Eh=null,Th=!1,kp=null,xT={onError:function(t){nl=!0,Eh=t}};function yT(t,e,n,i,r,s,o,a,l){nl=!1,Eh=null,vT.apply(xT,arguments)}function ST(t,e,n,i,r,s,o,a,l){if(yT.apply(this,arguments),nl){if(nl){var c=Eh;nl=!1,Eh=null}else throw Error(le(198));Th||(Th=!0,kp=c)}}function Os(t){var e=t,n=t;if(t.alternate)for(;e.return;)e=e.return;else{t=e;do e=t,e.flags&4098&&(n=e.return),t=e.return;while(t)}return e.tag===3?n:null}function Yv(t){if(t.tag===13){var e=t.memoizedState;if(e===null&&(t=t.alternate,t!==null&&(e=t.memoizedState)),e!==null)return e.dehydrated}return null}function I_(t){if(Os(t)!==t)throw Error(le(188))}function MT(t){var e=t.alternate;if(!e){if(e=Os(t),e===null)throw Error(le(188));return e!==t?null:t}for(var n=t,i=e;;){var r=n.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){n=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===n)return I_(r),t;if(s===i)return I_(r),e;s=s.sibling}throw Error(le(188))}if(n.return!==i.return)n=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===n){o=!0,n=r,i=s;break}if(a===i){o=!0,i=r,n=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===n){o=!0,n=s,i=r;break}if(a===i){o=!0,i=s,n=r;break}a=a.sibling}if(!o)throw Error(le(189))}}if(n.alternate!==i)throw Error(le(190))}if(n.tag!==3)throw Error(le(188));return n.stateNode.current===n?t:e}function qv(t){return t=MT(t),t!==null?Zv(t):null}function Zv(t){if(t.tag===5||t.tag===6)return t;for(t=t.child;t!==null;){var e=Zv(t);if(e!==null)return e;t=t.sibling}return null}var $v=ni.unstable_scheduleCallback,L_=ni.unstable_cancelCallback,wT=ni.unstable_shouldYield,bT=ni.unstable_requestPaint,Zt=ni.unstable_now,ET=ni.unstable_getCurrentPriorityLevel,wm=ni.unstable_ImmediatePriority,jv=ni.unstable_UserBlockingPriority,Ah=ni.unstable_NormalPriority,TT=ni.unstable_LowPriority,Kv=ni.unstable_IdlePriority,Zh=null,ji=null;function AT(t){if(ji&&typeof ji.onCommitFiberRoot=="function")try{ji.onCommitFiberRoot(Zh,t,void 0,(t.current.flags&128)===128)}catch{}}var Ni=Math.clz32?Math.clz32:PT,CT=Math.log,RT=Math.LN2;function PT(t){return t>>>=0,t===0?32:31-(CT(t)/RT|0)|0}var Ju=64,Qu=4194304;function Qa(t){switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return t&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return t}}function Ch(t,e){var n=t.pendingLanes;if(n===0)return 0;var i=0,r=t.suspendedLanes,s=t.pingedLanes,o=n&268435455;if(o!==0){var a=o&~r;a!==0?i=Qa(a):(s&=o,s!==0&&(i=Qa(s)))}else o=n&~r,o!==0?i=Qa(o):s!==0&&(i=Qa(s));if(i===0)return 0;if(e!==0&&e!==i&&!(e&r)&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if(i&4&&(i|=n&16),e=t.entangledLanes,e!==0)for(t=t.entanglements,e&=i;0<e;)n=31-Ni(e),r=1<<n,i|=t[n],e&=~r;return i}function IT(t,e){switch(t){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function LT(t,e){for(var n=t.suspendedLanes,i=t.pingedLanes,r=t.expirationTimes,s=t.pendingLanes;0<s;){var o=31-Ni(s),a=1<<o,l=r[o];l===-1?(!(a&n)||a&i)&&(r[o]=IT(a,e)):l<=e&&(t.expiredLanes|=a),s&=~a}}function zp(t){return t=t.pendingLanes&-1073741825,t!==0?t:t&1073741824?1073741824:0}function Jv(){var t=Ju;return Ju<<=1,!(Ju&4194240)&&(Ju=64),t}function op(t){for(var e=[],n=0;31>n;n++)e.push(t);return e}function Al(t,e,n){t.pendingLanes|=e,e!==536870912&&(t.suspendedLanes=0,t.pingedLanes=0),t=t.eventTimes,e=31-Ni(e),t[e]=n}function DT(t,e){var n=t.pendingLanes&~e;t.pendingLanes=e,t.suspendedLanes=0,t.pingedLanes=0,t.expiredLanes&=e,t.mutableReadLanes&=e,t.entangledLanes&=e,e=t.entanglements;var i=t.eventTimes;for(t=t.expirationTimes;0<n;){var r=31-Ni(n),s=1<<r;e[r]=0,i[r]=-1,t[r]=-1,n&=~s}}function bm(t,e){var n=t.entangledLanes|=e;for(t=t.entanglements;n;){var i=31-Ni(n),r=1<<i;r&e|t[i]&e&&(t[i]|=e),n&=~r}}var St=0;function Qv(t){return t&=-t,1<t?4<t?t&268435455?16:536870912:4:1}var ex,Em,tx,nx,ix,Vp=!1,eh=[],Kr=null,Jr=null,Qr=null,fl=new Map,pl=new Map,qr=[],NT="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function D_(t,e){switch(t){case"focusin":case"focusout":Kr=null;break;case"dragenter":case"dragleave":Jr=null;break;case"mouseover":case"mouseout":Qr=null;break;case"pointerover":case"pointerout":fl.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":pl.delete(e.pointerId)}}function Wa(t,e,n,i,r,s){return t===null||t.nativeEvent!==s?(t={blockedOn:e,domEventName:n,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=Rl(e),e!==null&&Em(e)),t):(t.eventSystemFlags|=i,e=t.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),t)}function UT(t,e,n,i,r){switch(e){case"focusin":return Kr=Wa(Kr,t,e,n,i,r),!0;case"dragenter":return Jr=Wa(Jr,t,e,n,i,r),!0;case"mouseover":return Qr=Wa(Qr,t,e,n,i,r),!0;case"pointerover":var s=r.pointerId;return fl.set(s,Wa(fl.get(s)||null,t,e,n,i,r)),!0;case"gotpointercapture":return s=r.pointerId,pl.set(s,Wa(pl.get(s)||null,t,e,n,i,r)),!0}return!1}function rx(t){var e=Ts(t.target);if(e!==null){var n=Os(e);if(n!==null){if(e=n.tag,e===13){if(e=Yv(n),e!==null){t.blockedOn=e,ix(t.priority,function(){tx(n)});return}}else if(e===3&&n.stateNode.current.memoizedState.isDehydrated){t.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}t.blockedOn=null}function ph(t){if(t.blockedOn!==null)return!1;for(var e=t.targetContainers;0<e.length;){var n=Gp(t.domEventName,t.eventSystemFlags,e[0],t.nativeEvent);if(n===null){n=t.nativeEvent;var i=new n.constructor(n.type,n);Fp=i,n.target.dispatchEvent(i),Fp=null}else return e=Rl(n),e!==null&&Em(e),t.blockedOn=n,!1;e.shift()}return!0}function N_(t,e,n){ph(t)&&n.delete(e)}function FT(){Vp=!1,Kr!==null&&ph(Kr)&&(Kr=null),Jr!==null&&ph(Jr)&&(Jr=null),Qr!==null&&ph(Qr)&&(Qr=null),fl.forEach(N_),pl.forEach(N_)}function Xa(t,e){t.blockedOn===e&&(t.blockedOn=null,Vp||(Vp=!0,ni.unstable_scheduleCallback(ni.unstable_NormalPriority,FT)))}function ml(t){function e(r){return Xa(r,t)}if(0<eh.length){Xa(eh[0],t);for(var n=1;n<eh.length;n++){var i=eh[n];i.blockedOn===t&&(i.blockedOn=null)}}for(Kr!==null&&Xa(Kr,t),Jr!==null&&Xa(Jr,t),Qr!==null&&Xa(Qr,t),fl.forEach(e),pl.forEach(e),n=0;n<qr.length;n++)i=qr[n],i.blockedOn===t&&(i.blockedOn=null);for(;0<qr.length&&(n=qr[0],n.blockedOn===null);)rx(n),n.blockedOn===null&&qr.shift()}var Oo=xr.ReactCurrentBatchConfig,Rh=!0;function OT(t,e,n,i){var r=St,s=Oo.transition;Oo.transition=null;try{St=1,Tm(t,e,n,i)}finally{St=r,Oo.transition=s}}function BT(t,e,n,i){var r=St,s=Oo.transition;Oo.transition=null;try{St=4,Tm(t,e,n,i)}finally{St=r,Oo.transition=s}}function Tm(t,e,n,i){if(Rh){var r=Gp(t,e,n,i);if(r===null)fp(t,e,i,Ph,n),D_(t,i);else if(UT(r,t,e,n,i))i.stopPropagation();else if(D_(t,i),e&4&&-1<NT.indexOf(t)){for(;r!==null;){var s=Rl(r);if(s!==null&&ex(s),s=Gp(t,e,n,i),s===null&&fp(t,e,i,Ph,n),s===r)break;r=s}r!==null&&i.stopPropagation()}else fp(t,e,i,null,n)}}var Ph=null;function Gp(t,e,n,i){if(Ph=null,t=Mm(i),t=Ts(t),t!==null)if(e=Os(t),e===null)t=null;else if(n=e.tag,n===13){if(t=Yv(e),t!==null)return t;t=null}else if(n===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;t=null}else e!==t&&(t=null);return Ph=t,null}function sx(t){switch(t){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(ET()){case wm:return 1;case jv:return 4;case Ah:case TT:return 16;case Kv:return 536870912;default:return 16}default:return 16}}var $r=null,Am=null,mh=null;function ox(){if(mh)return mh;var t,e=Am,n=e.length,i,r="value"in $r?$r.value:$r.textContent,s=r.length;for(t=0;t<n&&e[t]===r[t];t++);var o=n-t;for(i=1;i<=o&&e[n-i]===r[s-i];i++);return mh=r.slice(t,1<i?1-i:void 0)}function gh(t){var e=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&e===13&&(t=13)):t=e,t===10&&(t=13),32<=t||t===13?t:0}function th(){return!0}function U_(){return!1}function ii(t){function e(n,i,r,s,o){this._reactName=n,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in t)t.hasOwnProperty(a)&&(n=t[a],this[a]=n?n(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?th:U_,this.isPropagationStopped=U_,this}return Wt(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=th)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=th)},persist:function(){},isPersistent:th}),e}var qo={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},Cm=ii(qo),Cl=Wt({},qo,{view:0,detail:0}),kT=ii(Cl),ap,lp,Ya,$h=Wt({},Cl,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:Rm,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==Ya&&(Ya&&t.type==="mousemove"?(ap=t.screenX-Ya.screenX,lp=t.screenY-Ya.screenY):lp=ap=0,Ya=t),ap)},movementY:function(t){return"movementY"in t?t.movementY:lp}}),F_=ii($h),zT=Wt({},$h,{dataTransfer:0}),VT=ii(zT),GT=Wt({},Cl,{relatedTarget:0}),cp=ii(GT),HT=Wt({},qo,{animationName:0,elapsedTime:0,pseudoElement:0}),WT=ii(HT),XT=Wt({},qo,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),YT=ii(XT),qT=Wt({},qo,{data:0}),O_=ii(qT),ZT={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},$T={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},jT={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function KT(t){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(t):(t=jT[t])?!!e[t]:!1}function Rm(){return KT}var JT=Wt({},Cl,{key:function(t){if(t.key){var e=ZT[t.key]||t.key;if(e!=="Unidentified")return e}return t.type==="keypress"?(t=gh(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?$T[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:Rm,charCode:function(t){return t.type==="keypress"?gh(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?gh(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),QT=ii(JT),eA=Wt({},$h,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),B_=ii(eA),tA=Wt({},Cl,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:Rm}),nA=ii(tA),iA=Wt({},qo,{propertyName:0,elapsedTime:0,pseudoElement:0}),rA=ii(iA),sA=Wt({},$h,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),oA=ii(sA),aA=[9,13,27,32],Pm=mr&&"CompositionEvent"in window,il=null;mr&&"documentMode"in document&&(il=document.documentMode);var lA=mr&&"TextEvent"in window&&!il,ax=mr&&(!Pm||il&&8<il&&11>=il),k_=" ",z_=!1;function lx(t,e){switch(t){case"keyup":return aA.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function cx(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var bo=!1;function cA(t,e){switch(t){case"compositionend":return cx(e);case"keypress":return e.which!==32?null:(z_=!0,k_);case"textInput":return t=e.data,t===k_&&z_?null:t;default:return null}}function uA(t,e){if(bo)return t==="compositionend"||!Pm&&lx(t,e)?(t=ox(),mh=Am=$r=null,bo=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return ax&&e.locale!=="ko"?null:e.data;default:return null}}var hA={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function V_(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e==="input"?!!hA[t.type]:e==="textarea"}function ux(t,e,n,i){Vv(i),e=Ih(e,"onChange"),0<e.length&&(n=new Cm("onChange","change",null,n,i),t.push({event:n,listeners:e}))}var rl=null,gl=null;function dA(t){Sx(t,0)}function jh(t){var e=Ao(t);if(Nv(e))return t}function fA(t,e){if(t==="change")return e}var hx=!1;mr&&(mr?(ih="oninput"in document,ih||(up=document.createElement("div"),up.setAttribute("oninput","return;"),ih=typeof up.oninput=="function"),nh=ih):nh=!1,hx=nh&&(!document.documentMode||9<document.documentMode));var nh,ih,up;function G_(){rl&&(rl.detachEvent("onpropertychange",dx),gl=rl=null)}function dx(t){if(t.propertyName==="value"&&jh(gl)){var e=[];ux(e,gl,t,Mm(t)),Xv(dA,e)}}function pA(t,e,n){t==="focusin"?(G_(),rl=e,gl=n,rl.attachEvent("onpropertychange",dx)):t==="focusout"&&G_()}function mA(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return jh(gl)}function gA(t,e){if(t==="click")return jh(e)}function _A(t,e){if(t==="input"||t==="change")return jh(e)}function vA(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var Fi=typeof Object.is=="function"?Object.is:vA;function _l(t,e){if(Fi(t,e))return!0;if(typeof t!="object"||t===null||typeof e!="object"||e===null)return!1;var n=Object.keys(t),i=Object.keys(e);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var r=n[i];if(!bp.call(e,r)||!Fi(t[r],e[r]))return!1}return!0}function H_(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function W_(t,e){var n=H_(t);t=0;for(var i;n;){if(n.nodeType===3){if(i=t+n.textContent.length,t<=e&&i>=e)return{node:n,offset:e-t};t=i}e:{for(;n;){if(n.nextSibling){n=n.nextSibling;break e}n=n.parentNode}n=void 0}n=H_(n)}}function fx(t,e){return t&&e?t===e?!0:t&&t.nodeType===3?!1:e&&e.nodeType===3?fx(t,e.parentNode):"contains"in t?t.contains(e):t.compareDocumentPosition?!!(t.compareDocumentPosition(e)&16):!1:!1}function px(){for(var t=window,e=bh();e instanceof t.HTMLIFrameElement;){try{var n=typeof e.contentWindow.location.href=="string"}catch{n=!1}if(n)t=e.contentWindow;else break;e=bh(t.document)}return e}function Im(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e&&(e==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||e==="textarea"||t.contentEditable==="true")}function xA(t){var e=px(),n=t.focusedElem,i=t.selectionRange;if(e!==n&&n&&n.ownerDocument&&fx(n.ownerDocument.documentElement,n)){if(i!==null&&Im(n)){if(e=i.start,t=i.end,t===void 0&&(t=e),"selectionStart"in n)n.selectionStart=e,n.selectionEnd=Math.min(t,n.value.length);else if(t=(e=n.ownerDocument||document)&&e.defaultView||window,t.getSelection){t=t.getSelection();var r=n.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!t.extend&&s>i&&(r=i,i=s,s=r),r=W_(n,s);var o=W_(n,i);r&&o&&(t.rangeCount!==1||t.anchorNode!==r.node||t.anchorOffset!==r.offset||t.focusNode!==o.node||t.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),t.removeAllRanges(),s>i?(t.addRange(e),t.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),t.addRange(e)))}}for(e=[],t=n;t=t.parentNode;)t.nodeType===1&&e.push({element:t,left:t.scrollLeft,top:t.scrollTop});for(typeof n.focus=="function"&&n.focus(),n=0;n<e.length;n++)t=e[n],t.element.scrollLeft=t.left,t.element.scrollTop=t.top}}var yA=mr&&"documentMode"in document&&11>=document.documentMode,Eo=null,Hp=null,sl=null,Wp=!1;function X_(t,e,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;Wp||Eo==null||Eo!==bh(i)||(i=Eo,"selectionStart"in i&&Im(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),sl&&_l(sl,i)||(sl=i,i=Ih(Hp,"onSelect"),0<i.length&&(e=new Cm("onSelect","select",null,e,n),t.push({event:e,listeners:i}),e.target=Eo)))}function rh(t,e){var n={};return n[t.toLowerCase()]=e.toLowerCase(),n["Webkit"+t]="webkit"+e,n["Moz"+t]="moz"+e,n}var To={animationend:rh("Animation","AnimationEnd"),animationiteration:rh("Animation","AnimationIteration"),animationstart:rh("Animation","AnimationStart"),transitionend:rh("Transition","TransitionEnd")},hp={},mx={};mr&&(mx=document.createElement("div").style,"AnimationEvent"in window||(delete To.animationend.animation,delete To.animationiteration.animation,delete To.animationstart.animation),"TransitionEvent"in window||delete To.transitionend.transition);function Kh(t){if(hp[t])return hp[t];if(!To[t])return t;var e=To[t],n;for(n in e)if(e.hasOwnProperty(n)&&n in mx)return hp[t]=e[n];return t}var gx=Kh("animationend"),_x=Kh("animationiteration"),vx=Kh("animationstart"),xx=Kh("transitionend"),yx=new Map,Y_="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function as(t,e){yx.set(t,e),Fs(e,[t])}for(sh=0;sh<Y_.length;sh++)oh=Y_[sh],q_=oh.toLowerCase(),Z_=oh[0].toUpperCase()+oh.slice(1),as(q_,"on"+Z_);var oh,q_,Z_,sh;as(gx,"onAnimationEnd");as(_x,"onAnimationIteration");as(vx,"onAnimationStart");as("dblclick","onDoubleClick");as("focusin","onFocus");as("focusout","onBlur");as(xx,"onTransitionEnd");zo("onMouseEnter",["mouseout","mouseover"]);zo("onMouseLeave",["mouseout","mouseover"]);zo("onPointerEnter",["pointerout","pointerover"]);zo("onPointerLeave",["pointerout","pointerover"]);Fs("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));Fs("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));Fs("onBeforeInput",["compositionend","keypress","textInput","paste"]);Fs("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));Fs("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));Fs("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var el="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),SA=new Set("cancel close invalid load scroll toggle".split(" ").concat(el));function $_(t,e,n){var i=t.type||"unknown-event";t.currentTarget=n,ST(i,e,void 0,t),t.currentTarget=null}function Sx(t,e){e=(e&4)!==0;for(var n=0;n<t.length;n++){var i=t[n],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,c=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;$_(r,a,c),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,c=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;$_(r,a,c),s=l}}}if(Th)throw t=kp,Th=!1,kp=null,t}function Nt(t,e){var n=e[$p];n===void 0&&(n=e[$p]=new Set);var i=t+"__bubble";n.has(i)||(Mx(e,t,2,!1),n.add(i))}function dp(t,e,n){var i=0;e&&(i|=4),Mx(n,t,i,e)}var ah="_reactListening"+Math.random().toString(36).slice(2);function vl(t){if(!t[ah]){t[ah]=!0,Rv.forEach(function(n){n!=="selectionchange"&&(SA.has(n)||dp(n,!1,t),dp(n,!0,t))});var e=t.nodeType===9?t:t.ownerDocument;e===null||e[ah]||(e[ah]=!0,dp("selectionchange",!1,e))}}function Mx(t,e,n,i){switch(sx(e)){case 1:var r=OT;break;case 4:r=BT;break;default:r=Tm}n=r.bind(null,e,n,t),r=void 0,!Bp||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?t.addEventListener(e,n,{capture:!0,passive:r}):t.addEventListener(e,n,!0):r!==void 0?t.addEventListener(e,n,{passive:r}):t.addEventListener(e,n,!1)}function fp(t,e,n,i,r){var s=i;if(!(e&1)&&!(e&2)&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=Ts(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}Xv(function(){var c=s,d=Mm(n),p=[];e:{var h=yx.get(t);if(h!==void 0){var f=Cm,v=t;switch(t){case"keypress":if(gh(n)===0)break e;case"keydown":case"keyup":f=QT;break;case"focusin":v="focus",f=cp;break;case"focusout":v="blur",f=cp;break;case"beforeblur":case"afterblur":f=cp;break;case"click":if(n.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":f=F_;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":f=VT;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":f=nA;break;case gx:case _x:case vx:f=WT;break;case xx:f=rA;break;case"scroll":f=kT;break;case"wheel":f=oA;break;case"copy":case"cut":case"paste":f=YT;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":f=B_}var M=(e&4)!==0,g=!M&&t==="scroll",u=M?h!==null?h+"Capture":null:h;M=[];for(var m=c,x;m!==null;){x=m;var S=x.stateNode;if(x.tag===5&&S!==null&&(x=S,u!==null&&(S=dl(m,u),S!=null&&M.push(xl(m,S,x)))),g)break;m=m.return}0<M.length&&(h=new f(h,v,null,n,d),p.push({event:h,listeners:M}))}}if(!(e&7)){e:{if(h=t==="mouseover"||t==="pointerover",f=t==="mouseout"||t==="pointerout",h&&n!==Fp&&(v=n.relatedTarget||n.fromElement)&&(Ts(v)||v[gr]))break e;if((f||h)&&(h=d.window===d?d:(h=d.ownerDocument)?h.defaultView||h.parentWindow:window,f?(v=n.relatedTarget||n.toElement,f=c,v=v?Ts(v):null,v!==null&&(g=Os(v),v!==g||v.tag!==5&&v.tag!==6)&&(v=null)):(f=null,v=c),f!==v)){if(M=F_,S="onMouseLeave",u="onMouseEnter",m="mouse",(t==="pointerout"||t==="pointerover")&&(M=B_,S="onPointerLeave",u="onPointerEnter",m="pointer"),g=f==null?h:Ao(f),x=v==null?h:Ao(v),h=new M(S,m+"leave",f,n,d),h.target=g,h.relatedTarget=x,S=null,Ts(d)===c&&(M=new M(u,m+"enter",v,n,d),M.target=x,M.relatedTarget=g,S=M),g=S,f&&v)t:{for(M=f,u=v,m=0,x=M;x;x=So(x))m++;for(x=0,S=u;S;S=So(S))x++;for(;0<m-x;)M=So(M),m--;for(;0<x-m;)u=So(u),x--;for(;m--;){if(M===u||u!==null&&M===u.alternate)break t;M=So(M),u=So(u)}M=null}else M=null;f!==null&&j_(p,h,f,M,!1),v!==null&&g!==null&&j_(p,g,v,M,!0)}}e:{if(h=c?Ao(c):window,f=h.nodeName&&h.nodeName.toLowerCase(),f==="select"||f==="input"&&h.type==="file")var C=fA;else if(V_(h))if(hx)C=_A;else{C=mA;var b=pA}else(f=h.nodeName)&&f.toLowerCase()==="input"&&(h.type==="checkbox"||h.type==="radio")&&(C=gA);if(C&&(C=C(t,c))){ux(p,C,n,d);break e}b&&b(t,h,c),t==="focusout"&&(b=h._wrapperState)&&b.controlled&&h.type==="number"&&Ip(h,"number",h.value)}switch(b=c?Ao(c):window,t){case"focusin":(V_(b)||b.contentEditable==="true")&&(Eo=b,Hp=c,sl=null);break;case"focusout":sl=Hp=Eo=null;break;case"mousedown":Wp=!0;break;case"contextmenu":case"mouseup":case"dragend":Wp=!1,X_(p,n,d);break;case"selectionchange":if(yA)break;case"keydown":case"keyup":X_(p,n,d)}var R;if(Pm)e:{switch(t){case"compositionstart":var _="onCompositionStart";break e;case"compositionend":_="onCompositionEnd";break e;case"compositionupdate":_="onCompositionUpdate";break e}_=void 0}else bo?lx(t,n)&&(_="onCompositionEnd"):t==="keydown"&&n.keyCode===229&&(_="onCompositionStart");_&&(ax&&n.locale!=="ko"&&(bo||_!=="onCompositionStart"?_==="onCompositionEnd"&&bo&&(R=ox()):($r=d,Am="value"in $r?$r.value:$r.textContent,bo=!0)),b=Ih(c,_),0<b.length&&(_=new O_(_,t,null,n,d),p.push({event:_,listeners:b}),R?_.data=R:(R=cx(n),R!==null&&(_.data=R)))),(R=lA?cA(t,n):uA(t,n))&&(c=Ih(c,"onBeforeInput"),0<c.length&&(d=new O_("onBeforeInput","beforeinput",null,n,d),p.push({event:d,listeners:c}),d.data=R))}Sx(p,e)})}function xl(t,e,n){return{instance:t,listener:e,currentTarget:n}}function Ih(t,e){for(var n=e+"Capture",i=[];t!==null;){var r=t,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=dl(t,n),s!=null&&i.unshift(xl(t,s,r)),s=dl(t,e),s!=null&&i.push(xl(t,s,r))),t=t.return}return i}function So(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5);return t||null}function j_(t,e,n,i,r){for(var s=e._reactName,o=[];n!==null&&n!==i;){var a=n,l=a.alternate,c=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&c!==null&&(a=c,r?(l=dl(n,s),l!=null&&o.unshift(xl(n,l,a))):r||(l=dl(n,s),l!=null&&o.push(xl(n,l,a)))),n=n.return}o.length!==0&&t.push({event:e,listeners:o})}var MA=/\r\n?/g,wA=/\u0000|\uFFFD/g;function K_(t){return(typeof t=="string"?t:""+t).replace(MA,`
`).replace(wA,"")}function lh(t,e,n){if(e=K_(e),K_(t)!==e&&n)throw Error(le(425))}function Lh(){}var Xp=null,Yp=null;function qp(t,e){return t==="textarea"||t==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var Zp=typeof setTimeout=="function"?setTimeout:void 0,bA=typeof clearTimeout=="function"?clearTimeout:void 0,J_=typeof Promise=="function"?Promise:void 0,EA=typeof queueMicrotask=="function"?queueMicrotask:typeof J_<"u"?function(t){return J_.resolve(null).then(t).catch(TA)}:Zp;function TA(t){setTimeout(function(){throw t})}function pp(t,e){var n=e,i=0;do{var r=n.nextSibling;if(t.removeChild(n),r&&r.nodeType===8)if(n=r.data,n==="/$"){if(i===0){t.removeChild(r),ml(e);return}i--}else n!=="$"&&n!=="$?"&&n!=="$!"||i++;n=r}while(n);ml(e)}function es(t){for(;t!=null;t=t.nextSibling){var e=t.nodeType;if(e===1||e===3)break;if(e===8){if(e=t.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return t}function Q_(t){t=t.previousSibling;for(var e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="$"||n==="$!"||n==="$?"){if(e===0)return t;e--}else n==="/$"&&e++}t=t.previousSibling}return null}var Zo=Math.random().toString(36).slice(2),$i="__reactFiber$"+Zo,yl="__reactProps$"+Zo,gr="__reactContainer$"+Zo,$p="__reactEvents$"+Zo,AA="__reactListeners$"+Zo,CA="__reactHandles$"+Zo;function Ts(t){var e=t[$i];if(e)return e;for(var n=t.parentNode;n;){if(e=n[gr]||n[$i]){if(n=e.alternate,e.child!==null||n!==null&&n.child!==null)for(t=Q_(t);t!==null;){if(n=t[$i])return n;t=Q_(t)}return e}t=n,n=t.parentNode}return null}function Rl(t){return t=t[$i]||t[gr],!t||t.tag!==5&&t.tag!==6&&t.tag!==13&&t.tag!==3?null:t}function Ao(t){if(t.tag===5||t.tag===6)return t.stateNode;throw Error(le(33))}function Jh(t){return t[yl]||null}var jp=[],Co=-1;function ls(t){return{current:t}}function Ut(t){0>Co||(t.current=jp[Co],jp[Co]=null,Co--)}function It(t,e){Co++,jp[Co]=t.current,t.current=e}var os={},bn=ls(os),Gn=ls(!1),Is=os;function Vo(t,e){var n=t.type.contextTypes;if(!n)return os;var i=t.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in n)r[s]=e[s];return i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=e,t.__reactInternalMemoizedMaskedChildContext=r),r}function Hn(t){return t=t.childContextTypes,t!=null}function Dh(){Ut(Gn),Ut(bn)}function ev(t,e,n){if(bn.current!==os)throw Error(le(168));It(bn,e),It(Gn,n)}function wx(t,e,n){var i=t.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return n;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(le(108,pT(t)||"Unknown",r));return Wt({},n,i)}function Nh(t){return t=(t=t.stateNode)&&t.__reactInternalMemoizedMergedChildContext||os,Is=bn.current,It(bn,t),It(Gn,Gn.current),!0}function tv(t,e,n){var i=t.stateNode;if(!i)throw Error(le(169));n?(t=wx(t,e,Is),i.__reactInternalMemoizedMergedChildContext=t,Ut(Gn),Ut(bn),It(bn,t)):Ut(Gn),It(Gn,n)}var hr=null,Qh=!1,mp=!1;function bx(t){hr===null?hr=[t]:hr.push(t)}function RA(t){Qh=!0,bx(t)}function cs(){if(!mp&&hr!==null){mp=!0;var t=0,e=St;try{var n=hr;for(St=1;t<n.length;t++){var i=n[t];do i=i(!0);while(i!==null)}hr=null,Qh=!1}catch(r){throw hr!==null&&(hr=hr.slice(t+1)),$v(wm,cs),r}finally{St=e,mp=!1}}return null}var Ro=[],Po=0,Uh=null,Fh=0,fi=[],pi=0,Ls=null,dr=1,fr="";function bs(t,e){Ro[Po++]=Fh,Ro[Po++]=Uh,Uh=t,Fh=e}function Ex(t,e,n){fi[pi++]=dr,fi[pi++]=fr,fi[pi++]=Ls,Ls=t;var i=dr;t=fr;var r=32-Ni(i)-1;i&=~(1<<r),n+=1;var s=32-Ni(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,dr=1<<32-Ni(e)+r|n<<r|i,fr=s+t}else dr=1<<s|n<<r|i,fr=t}function Lm(t){t.return!==null&&(bs(t,1),Ex(t,1,0))}function Dm(t){for(;t===Uh;)Uh=Ro[--Po],Ro[Po]=null,Fh=Ro[--Po],Ro[Po]=null;for(;t===Ls;)Ls=fi[--pi],fi[pi]=null,fr=fi[--pi],fi[pi]=null,dr=fi[--pi],fi[pi]=null}var ti=null,ei=null,Ot=!1,Di=null;function Tx(t,e){var n=mi(5,null,null,0);n.elementType="DELETED",n.stateNode=e,n.return=t,e=t.deletions,e===null?(t.deletions=[n],t.flags|=16):e.push(n)}function nv(t,e){switch(t.tag){case 5:var n=t.type;return e=e.nodeType!==1||n.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(t.stateNode=e,ti=t,ei=es(e.firstChild),!0):!1;case 6:return e=t.pendingProps===""||e.nodeType!==3?null:e,e!==null?(t.stateNode=e,ti=t,ei=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(n=Ls!==null?{id:dr,overflow:fr}:null,t.memoizedState={dehydrated:e,treeContext:n,retryLane:1073741824},n=mi(18,null,null,0),n.stateNode=e,n.return=t,t.child=n,ti=t,ei=null,!0):!1;default:return!1}}function Kp(t){return(t.mode&1)!==0&&(t.flags&128)===0}function Jp(t){if(Ot){var e=ei;if(e){var n=e;if(!nv(t,e)){if(Kp(t))throw Error(le(418));e=es(n.nextSibling);var i=ti;e&&nv(t,e)?Tx(i,n):(t.flags=t.flags&-4097|2,Ot=!1,ti=t)}}else{if(Kp(t))throw Error(le(418));t.flags=t.flags&-4097|2,Ot=!1,ti=t}}}function iv(t){for(t=t.return;t!==null&&t.tag!==5&&t.tag!==3&&t.tag!==13;)t=t.return;ti=t}function ch(t){if(t!==ti)return!1;if(!Ot)return iv(t),Ot=!0,!1;var e;if((e=t.tag!==3)&&!(e=t.tag!==5)&&(e=t.type,e=e!=="head"&&e!=="body"&&!qp(t.type,t.memoizedProps)),e&&(e=ei)){if(Kp(t))throw Ax(),Error(le(418));for(;e;)Tx(t,e),e=es(e.nextSibling)}if(iv(t),t.tag===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(le(317));e:{for(t=t.nextSibling,e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="/$"){if(e===0){ei=es(t.nextSibling);break e}e--}else n!=="$"&&n!=="$!"&&n!=="$?"||e++}t=t.nextSibling}ei=null}}else ei=ti?es(t.stateNode.nextSibling):null;return!0}function Ax(){for(var t=ei;t;)t=es(t.nextSibling)}function Go(){ei=ti=null,Ot=!1}function Nm(t){Di===null?Di=[t]:Di.push(t)}var PA=xr.ReactCurrentBatchConfig;function qa(t,e,n){if(t=n.ref,t!==null&&typeof t!="function"&&typeof t!="object"){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(le(309));var i=n.stateNode}if(!i)throw Error(le(147,t));var r=i,s=""+t;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof t!="string")throw Error(le(284));if(!n._owner)throw Error(le(290,t))}return t}function uh(t,e){throw t=Object.prototype.toString.call(e),Error(le(31,t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t))}function rv(t){var e=t._init;return e(t._payload)}function Cx(t){function e(u,m){if(t){var x=u.deletions;x===null?(u.deletions=[m],u.flags|=16):x.push(m)}}function n(u,m){if(!t)return null;for(;m!==null;)e(u,m),m=m.sibling;return null}function i(u,m){for(u=new Map;m!==null;)m.key!==null?u.set(m.key,m):u.set(m.index,m),m=m.sibling;return u}function r(u,m){return u=rs(u,m),u.index=0,u.sibling=null,u}function s(u,m,x){return u.index=x,t?(x=u.alternate,x!==null?(x=x.index,x<m?(u.flags|=2,m):x):(u.flags|=2,m)):(u.flags|=1048576,m)}function o(u){return t&&u.alternate===null&&(u.flags|=2),u}function a(u,m,x,S){return m===null||m.tag!==6?(m=Mp(x,u.mode,S),m.return=u,m):(m=r(m,x),m.return=u,m)}function l(u,m,x,S){var C=x.type;return C===wo?d(u,m,x.props.children,S,x.key):m!==null&&(m.elementType===C||typeof C=="object"&&C!==null&&C.$$typeof===Xr&&rv(C)===m.type)?(S=r(m,x.props),S.ref=qa(u,m,x),S.return=u,S):(S=wh(x.type,x.key,x.props,null,u.mode,S),S.ref=qa(u,m,x),S.return=u,S)}function c(u,m,x,S){return m===null||m.tag!==4||m.stateNode.containerInfo!==x.containerInfo||m.stateNode.implementation!==x.implementation?(m=wp(x,u.mode,S),m.return=u,m):(m=r(m,x.children||[]),m.return=u,m)}function d(u,m,x,S,C){return m===null||m.tag!==7?(m=Ps(x,u.mode,S,C),m.return=u,m):(m=r(m,x),m.return=u,m)}function p(u,m,x){if(typeof m=="string"&&m!==""||typeof m=="number")return m=Mp(""+m,u.mode,x),m.return=u,m;if(typeof m=="object"&&m!==null){switch(m.$$typeof){case $u:return x=wh(m.type,m.key,m.props,null,u.mode,x),x.ref=qa(u,null,m),x.return=u,x;case Mo:return m=wp(m,u.mode,x),m.return=u,m;case Xr:var S=m._init;return p(u,S(m._payload),x)}if(Ja(m)||Ha(m))return m=Ps(m,u.mode,x,null),m.return=u,m;uh(u,m)}return null}function h(u,m,x,S){var C=m!==null?m.key:null;if(typeof x=="string"&&x!==""||typeof x=="number")return C!==null?null:a(u,m,""+x,S);if(typeof x=="object"&&x!==null){switch(x.$$typeof){case $u:return x.key===C?l(u,m,x,S):null;case Mo:return x.key===C?c(u,m,x,S):null;case Xr:return C=x._init,h(u,m,C(x._payload),S)}if(Ja(x)||Ha(x))return C!==null?null:d(u,m,x,S,null);uh(u,x)}return null}function f(u,m,x,S,C){if(typeof S=="string"&&S!==""||typeof S=="number")return u=u.get(x)||null,a(m,u,""+S,C);if(typeof S=="object"&&S!==null){switch(S.$$typeof){case $u:return u=u.get(S.key===null?x:S.key)||null,l(m,u,S,C);case Mo:return u=u.get(S.key===null?x:S.key)||null,c(m,u,S,C);case Xr:var b=S._init;return f(u,m,x,b(S._payload),C)}if(Ja(S)||Ha(S))return u=u.get(x)||null,d(m,u,S,C,null);uh(m,S)}return null}function v(u,m,x,S){for(var C=null,b=null,R=m,_=m=0,T=null;R!==null&&_<x.length;_++){R.index>_?(T=R,R=null):T=R.sibling;var I=h(u,R,x[_],S);if(I===null){R===null&&(R=T);break}t&&R&&I.alternate===null&&e(u,R),m=s(I,m,_),b===null?C=I:b.sibling=I,b=I,R=T}if(_===x.length)return n(u,R),Ot&&bs(u,_),C;if(R===null){for(;_<x.length;_++)R=p(u,x[_],S),R!==null&&(m=s(R,m,_),b===null?C=R:b.sibling=R,b=R);return Ot&&bs(u,_),C}for(R=i(u,R);_<x.length;_++)T=f(R,u,_,x[_],S),T!==null&&(t&&T.alternate!==null&&R.delete(T.key===null?_:T.key),m=s(T,m,_),b===null?C=T:b.sibling=T,b=T);return t&&R.forEach(function(P){return e(u,P)}),Ot&&bs(u,_),C}function M(u,m,x,S){var C=Ha(x);if(typeof C!="function")throw Error(le(150));if(x=C.call(x),x==null)throw Error(le(151));for(var b=C=null,R=m,_=m=0,T=null,I=x.next();R!==null&&!I.done;_++,I=x.next()){R.index>_?(T=R,R=null):T=R.sibling;var P=h(u,R,I.value,S);if(P===null){R===null&&(R=T);break}t&&R&&P.alternate===null&&e(u,R),m=s(P,m,_),b===null?C=P:b.sibling=P,b=P,R=T}if(I.done)return n(u,R),Ot&&bs(u,_),C;if(R===null){for(;!I.done;_++,I=x.next())I=p(u,I.value,S),I!==null&&(m=s(I,m,_),b===null?C=I:b.sibling=I,b=I);return Ot&&bs(u,_),C}for(R=i(u,R);!I.done;_++,I=x.next())I=f(R,u,_,I.value,S),I!==null&&(t&&I.alternate!==null&&R.delete(I.key===null?_:I.key),m=s(I,m,_),b===null?C=I:b.sibling=I,b=I);return t&&R.forEach(function(B){return e(u,B)}),Ot&&bs(u,_),C}function g(u,m,x,S){if(typeof x=="object"&&x!==null&&x.type===wo&&x.key===null&&(x=x.props.children),typeof x=="object"&&x!==null){switch(x.$$typeof){case $u:e:{for(var C=x.key,b=m;b!==null;){if(b.key===C){if(C=x.type,C===wo){if(b.tag===7){n(u,b.sibling),m=r(b,x.props.children),m.return=u,u=m;break e}}else if(b.elementType===C||typeof C=="object"&&C!==null&&C.$$typeof===Xr&&rv(C)===b.type){n(u,b.sibling),m=r(b,x.props),m.ref=qa(u,b,x),m.return=u,u=m;break e}n(u,b);break}else e(u,b);b=b.sibling}x.type===wo?(m=Ps(x.props.children,u.mode,S,x.key),m.return=u,u=m):(S=wh(x.type,x.key,x.props,null,u.mode,S),S.ref=qa(u,m,x),S.return=u,u=S)}return o(u);case Mo:e:{for(b=x.key;m!==null;){if(m.key===b)if(m.tag===4&&m.stateNode.containerInfo===x.containerInfo&&m.stateNode.implementation===x.implementation){n(u,m.sibling),m=r(m,x.children||[]),m.return=u,u=m;break e}else{n(u,m);break}else e(u,m);m=m.sibling}m=wp(x,u.mode,S),m.return=u,u=m}return o(u);case Xr:return b=x._init,g(u,m,b(x._payload),S)}if(Ja(x))return v(u,m,x,S);if(Ha(x))return M(u,m,x,S);uh(u,x)}return typeof x=="string"&&x!==""||typeof x=="number"?(x=""+x,m!==null&&m.tag===6?(n(u,m.sibling),m=r(m,x),m.return=u,u=m):(n(u,m),m=Mp(x,u.mode,S),m.return=u,u=m),o(u)):n(u,m)}return g}var Ho=Cx(!0),Rx=Cx(!1),Oh=ls(null),Bh=null,Io=null,Um=null;function Fm(){Um=Io=Bh=null}function Om(t){var e=Oh.current;Ut(Oh),t._currentValue=e}function Qp(t,e,n){for(;t!==null;){var i=t.alternate;if((t.childLanes&e)!==e?(t.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),t===n)break;t=t.return}}function Bo(t,e){Bh=t,Um=Io=null,t=t.dependencies,t!==null&&t.firstContext!==null&&(t.lanes&e&&(Vn=!0),t.firstContext=null)}function _i(t){var e=t._currentValue;if(Um!==t)if(t={context:t,memoizedValue:e,next:null},Io===null){if(Bh===null)throw Error(le(308));Io=t,Bh.dependencies={lanes:0,firstContext:t}}else Io=Io.next=t;return e}var As=null;function Bm(t){As===null?As=[t]:As.push(t)}function Px(t,e,n,i){var r=e.interleaved;return r===null?(n.next=n,Bm(e)):(n.next=r.next,r.next=n),e.interleaved=n,_r(t,i)}function _r(t,e){t.lanes|=e;var n=t.alternate;for(n!==null&&(n.lanes|=e),n=t,t=t.return;t!==null;)t.childLanes|=e,n=t.alternate,n!==null&&(n.childLanes|=e),n=t,t=t.return;return n.tag===3?n.stateNode:null}var Yr=!1;function km(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function Ix(t,e){t=t.updateQueue,e.updateQueue===t&&(e.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,effects:t.effects})}function pr(t,e){return{eventTime:t,lane:e,tag:0,payload:null,callback:null,next:null}}function ts(t,e,n){var i=t.updateQueue;if(i===null)return null;if(i=i.shared,pt&2){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,_r(t,n)}return r=i.interleaved,r===null?(e.next=e,Bm(i)):(e.next=r.next,r.next=e),i.interleaved=e,_r(t,n)}function _h(t,e,n){if(e=e.updateQueue,e!==null&&(e=e.shared,(n&4194240)!==0)){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,bm(t,n)}}function sv(t,e){var n=t.updateQueue,i=t.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var r=null,s=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};s===null?r=s=o:s=s.next=o,n=n.next}while(n!==null);s===null?r=s=e:s=s.next=e}else r=s=e;n={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},t.updateQueue=n;return}t=n.lastBaseUpdate,t===null?n.firstBaseUpdate=e:t.next=e,n.lastBaseUpdate=e}function kh(t,e,n,i){var r=t.updateQueue;Yr=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,c=l.next;l.next=null,o===null?s=c:o.next=c,o=l;var d=t.alternate;d!==null&&(d=d.updateQueue,a=d.lastBaseUpdate,a!==o&&(a===null?d.firstBaseUpdate=c:a.next=c,d.lastBaseUpdate=l))}if(s!==null){var p=r.baseState;o=0,d=c=l=null,a=s;do{var h=a.lane,f=a.eventTime;if((i&h)===h){d!==null&&(d=d.next={eventTime:f,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var v=t,M=a;switch(h=e,f=n,M.tag){case 1:if(v=M.payload,typeof v=="function"){p=v.call(f,p,h);break e}p=v;break e;case 3:v.flags=v.flags&-65537|128;case 0:if(v=M.payload,h=typeof v=="function"?v.call(f,p,h):v,h==null)break e;p=Wt({},p,h);break e;case 2:Yr=!0}}a.callback!==null&&a.lane!==0&&(t.flags|=64,h=r.effects,h===null?r.effects=[a]:h.push(a))}else f={eventTime:f,lane:h,tag:a.tag,payload:a.payload,callback:a.callback,next:null},d===null?(c=d=f,l=p):d=d.next=f,o|=h;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;h=a,a=h.next,h.next=null,r.lastBaseUpdate=h,r.shared.pending=null}}while(!0);if(d===null&&(l=p),r.baseState=l,r.firstBaseUpdate=c,r.lastBaseUpdate=d,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);Ns|=o,t.lanes=o,t.memoizedState=p}}function ov(t,e,n){if(t=e.effects,e.effects=null,t!==null)for(e=0;e<t.length;e++){var i=t[e],r=i.callback;if(r!==null){if(i.callback=null,i=n,typeof r!="function")throw Error(le(191,r));r.call(i)}}}var Pl={},Ki=ls(Pl),Sl=ls(Pl),Ml=ls(Pl);function Cs(t){if(t===Pl)throw Error(le(174));return t}function zm(t,e){switch(It(Ml,e),It(Sl,t),It(Ki,Pl),t=e.nodeType,t){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:Dp(null,"");break;default:t=t===8?e.parentNode:e,e=t.namespaceURI||null,t=t.tagName,e=Dp(e,t)}Ut(Ki),It(Ki,e)}function Wo(){Ut(Ki),Ut(Sl),Ut(Ml)}function Lx(t){Cs(Ml.current);var e=Cs(Ki.current),n=Dp(e,t.type);e!==n&&(It(Sl,t),It(Ki,n))}function Vm(t){Sl.current===t&&(Ut(Ki),Ut(Sl))}var Gt=ls(0);function zh(t){for(var e=t;e!==null;){if(e.tag===13){var n=e.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data==="$?"||n.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if(e.flags&128)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var gp=[];function Gm(){for(var t=0;t<gp.length;t++)gp[t]._workInProgressVersionPrimary=null;gp.length=0}var vh=xr.ReactCurrentDispatcher,_p=xr.ReactCurrentBatchConfig,Ds=0,Ht=null,en=null,sn=null,Vh=!1,ol=!1,wl=0,IA=0;function Sn(){throw Error(le(321))}function Hm(t,e){if(e===null)return!1;for(var n=0;n<e.length&&n<t.length;n++)if(!Fi(t[n],e[n]))return!1;return!0}function Wm(t,e,n,i,r,s){if(Ds=s,Ht=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,vh.current=t===null||t.memoizedState===null?UA:FA,t=n(i,r),ol){s=0;do{if(ol=!1,wl=0,25<=s)throw Error(le(301));s+=1,sn=en=null,e.updateQueue=null,vh.current=OA,t=n(i,r)}while(ol)}if(vh.current=Gh,e=en!==null&&en.next!==null,Ds=0,sn=en=Ht=null,Vh=!1,e)throw Error(le(300));return t}function Xm(){var t=wl!==0;return wl=0,t}function Zi(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return sn===null?Ht.memoizedState=sn=t:sn=sn.next=t,sn}function vi(){if(en===null){var t=Ht.alternate;t=t!==null?t.memoizedState:null}else t=en.next;var e=sn===null?Ht.memoizedState:sn.next;if(e!==null)sn=e,en=t;else{if(t===null)throw Error(le(310));en=t,t={memoizedState:en.memoizedState,baseState:en.baseState,baseQueue:en.baseQueue,queue:en.queue,next:null},sn===null?Ht.memoizedState=sn=t:sn=sn.next=t}return sn}function bl(t,e){return typeof e=="function"?e(t):e}function vp(t){var e=vi(),n=e.queue;if(n===null)throw Error(le(311));n.lastRenderedReducer=t;var i=en,r=i.baseQueue,s=n.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,n.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,c=s;do{var d=c.lane;if((Ds&d)===d)l!==null&&(l=l.next={lane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),i=c.hasEagerState?c.eagerState:t(i,c.action);else{var p={lane:d,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null};l===null?(a=l=p,o=i):l=l.next=p,Ht.lanes|=d,Ns|=d}c=c.next}while(c!==null&&c!==s);l===null?o=i:l.next=a,Fi(i,e.memoizedState)||(Vn=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,n.lastRenderedState=i}if(t=n.interleaved,t!==null){r=t;do s=r.lane,Ht.lanes|=s,Ns|=s,r=r.next;while(r!==t)}else r===null&&(n.lanes=0);return[e.memoizedState,n.dispatch]}function xp(t){var e=vi(),n=e.queue;if(n===null)throw Error(le(311));n.lastRenderedReducer=t;var i=n.dispatch,r=n.pending,s=e.memoizedState;if(r!==null){n.pending=null;var o=r=r.next;do s=t(s,o.action),o=o.next;while(o!==r);Fi(s,e.memoizedState)||(Vn=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),n.lastRenderedState=s}return[s,i]}function Dx(){}function Nx(t,e){var n=Ht,i=vi(),r=e(),s=!Fi(i.memoizedState,r);if(s&&(i.memoizedState=r,Vn=!0),i=i.queue,Ym(Ox.bind(null,n,i,t),[t]),i.getSnapshot!==e||s||sn!==null&&sn.memoizedState.tag&1){if(n.flags|=2048,El(9,Fx.bind(null,n,i,r,e),void 0,null),on===null)throw Error(le(349));Ds&30||Ux(n,e,r)}return r}function Ux(t,e,n){t.flags|=16384,t={getSnapshot:e,value:n},e=Ht.updateQueue,e===null?(e={lastEffect:null,stores:null},Ht.updateQueue=e,e.stores=[t]):(n=e.stores,n===null?e.stores=[t]:n.push(t))}function Fx(t,e,n,i){e.value=n,e.getSnapshot=i,Bx(e)&&kx(t)}function Ox(t,e,n){return n(function(){Bx(e)&&kx(t)})}function Bx(t){var e=t.getSnapshot;t=t.value;try{var n=e();return!Fi(t,n)}catch{return!0}}function kx(t){var e=_r(t,1);e!==null&&Ui(e,t,1,-1)}function av(t){var e=Zi();return typeof t=="function"&&(t=t()),e.memoizedState=e.baseState=t,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:bl,lastRenderedState:t},e.queue=t,t=t.dispatch=NA.bind(null,Ht,t),[e.memoizedState,t]}function El(t,e,n,i){return t={tag:t,create:e,destroy:n,deps:i,next:null},e=Ht.updateQueue,e===null?(e={lastEffect:null,stores:null},Ht.updateQueue=e,e.lastEffect=t.next=t):(n=e.lastEffect,n===null?e.lastEffect=t.next=t:(i=n.next,n.next=t,t.next=i,e.lastEffect=t)),t}function zx(){return vi().memoizedState}function xh(t,e,n,i){var r=Zi();Ht.flags|=t,r.memoizedState=El(1|e,n,void 0,i===void 0?null:i)}function ed(t,e,n,i){var r=vi();i=i===void 0?null:i;var s=void 0;if(en!==null){var o=en.memoizedState;if(s=o.destroy,i!==null&&Hm(i,o.deps)){r.memoizedState=El(e,n,s,i);return}}Ht.flags|=t,r.memoizedState=El(1|e,n,s,i)}function lv(t,e){return xh(8390656,8,t,e)}function Ym(t,e){return ed(2048,8,t,e)}function Vx(t,e){return ed(4,2,t,e)}function Gx(t,e){return ed(4,4,t,e)}function Hx(t,e){if(typeof e=="function")return t=t(),e(t),function(){e(null)};if(e!=null)return t=t(),e.current=t,function(){e.current=null}}function Wx(t,e,n){return n=n!=null?n.concat([t]):null,ed(4,4,Hx.bind(null,e,t),n)}function qm(){}function Xx(t,e){var n=vi();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&Hm(e,i[1])?i[0]:(n.memoizedState=[t,e],t)}function Yx(t,e){var n=vi();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&Hm(e,i[1])?i[0]:(t=t(),n.memoizedState=[t,e],t)}function qx(t,e,n){return Ds&21?(Fi(n,e)||(n=Jv(),Ht.lanes|=n,Ns|=n,t.baseState=!0),e):(t.baseState&&(t.baseState=!1,Vn=!0),t.memoizedState=n)}function LA(t,e){var n=St;St=n!==0&&4>n?n:4,t(!0);var i=_p.transition;_p.transition={};try{t(!1),e()}finally{St=n,_p.transition=i}}function Zx(){return vi().memoizedState}function DA(t,e,n){var i=is(t);if(n={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null},$x(t))jx(e,n);else if(n=Px(t,e,n,i),n!==null){var r=Dn();Ui(n,t,i,r),Kx(n,e,i)}}function NA(t,e,n){var i=is(t),r={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null};if($x(t))jx(e,r);else{var s=t.alternate;if(t.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,n);if(r.hasEagerState=!0,r.eagerState=a,Fi(a,o)){var l=e.interleaved;l===null?(r.next=r,Bm(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}n=Px(t,e,r,i),n!==null&&(r=Dn(),Ui(n,t,i,r),Kx(n,e,i))}}function $x(t){var e=t.alternate;return t===Ht||e!==null&&e===Ht}function jx(t,e){ol=Vh=!0;var n=t.pending;n===null?e.next=e:(e.next=n.next,n.next=e),t.pending=e}function Kx(t,e,n){if(n&4194240){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,bm(t,n)}}var Gh={readContext:_i,useCallback:Sn,useContext:Sn,useEffect:Sn,useImperativeHandle:Sn,useInsertionEffect:Sn,useLayoutEffect:Sn,useMemo:Sn,useReducer:Sn,useRef:Sn,useState:Sn,useDebugValue:Sn,useDeferredValue:Sn,useTransition:Sn,useMutableSource:Sn,useSyncExternalStore:Sn,useId:Sn,unstable_isNewReconciler:!1},UA={readContext:_i,useCallback:function(t,e){return Zi().memoizedState=[t,e===void 0?null:e],t},useContext:_i,useEffect:lv,useImperativeHandle:function(t,e,n){return n=n!=null?n.concat([t]):null,xh(4194308,4,Hx.bind(null,e,t),n)},useLayoutEffect:function(t,e){return xh(4194308,4,t,e)},useInsertionEffect:function(t,e){return xh(4,2,t,e)},useMemo:function(t,e){var n=Zi();return e=e===void 0?null:e,t=t(),n.memoizedState=[t,e],t},useReducer:function(t,e,n){var i=Zi();return e=n!==void 0?n(e):e,i.memoizedState=i.baseState=e,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:e},i.queue=t,t=t.dispatch=DA.bind(null,Ht,t),[i.memoizedState,t]},useRef:function(t){var e=Zi();return t={current:t},e.memoizedState=t},useState:av,useDebugValue:qm,useDeferredValue:function(t){return Zi().memoizedState=t},useTransition:function(){var t=av(!1),e=t[0];return t=LA.bind(null,t[1]),Zi().memoizedState=t,[e,t]},useMutableSource:function(){},useSyncExternalStore:function(t,e,n){var i=Ht,r=Zi();if(Ot){if(n===void 0)throw Error(le(407));n=n()}else{if(n=e(),on===null)throw Error(le(349));Ds&30||Ux(i,e,n)}r.memoizedState=n;var s={value:n,getSnapshot:e};return r.queue=s,lv(Ox.bind(null,i,s,t),[t]),i.flags|=2048,El(9,Fx.bind(null,i,s,n,e),void 0,null),n},useId:function(){var t=Zi(),e=on.identifierPrefix;if(Ot){var n=fr,i=dr;n=(i&~(1<<32-Ni(i)-1)).toString(32)+n,e=":"+e+"R"+n,n=wl++,0<n&&(e+="H"+n.toString(32)),e+=":"}else n=IA++,e=":"+e+"r"+n.toString(32)+":";return t.memoizedState=e},unstable_isNewReconciler:!1},FA={readContext:_i,useCallback:Xx,useContext:_i,useEffect:Ym,useImperativeHandle:Wx,useInsertionEffect:Vx,useLayoutEffect:Gx,useMemo:Yx,useReducer:vp,useRef:zx,useState:function(){return vp(bl)},useDebugValue:qm,useDeferredValue:function(t){var e=vi();return qx(e,en.memoizedState,t)},useTransition:function(){var t=vp(bl)[0],e=vi().memoizedState;return[t,e]},useMutableSource:Dx,useSyncExternalStore:Nx,useId:Zx,unstable_isNewReconciler:!1},OA={readContext:_i,useCallback:Xx,useContext:_i,useEffect:Ym,useImperativeHandle:Wx,useInsertionEffect:Vx,useLayoutEffect:Gx,useMemo:Yx,useReducer:xp,useRef:zx,useState:function(){return xp(bl)},useDebugValue:qm,useDeferredValue:function(t){var e=vi();return en===null?e.memoizedState=t:qx(e,en.memoizedState,t)},useTransition:function(){var t=xp(bl)[0],e=vi().memoizedState;return[t,e]},useMutableSource:Dx,useSyncExternalStore:Nx,useId:Zx,unstable_isNewReconciler:!1};function Ii(t,e){if(t&&t.defaultProps){e=Wt({},e),t=t.defaultProps;for(var n in t)e[n]===void 0&&(e[n]=t[n]);return e}return e}function em(t,e,n,i){e=t.memoizedState,n=n(i,e),n=n==null?e:Wt({},e,n),t.memoizedState=n,t.lanes===0&&(t.updateQueue.baseState=n)}var td={isMounted:function(t){return(t=t._reactInternals)?Os(t)===t:!1},enqueueSetState:function(t,e,n){t=t._reactInternals;var i=Dn(),r=is(t),s=pr(i,r);s.payload=e,n!=null&&(s.callback=n),e=ts(t,s,r),e!==null&&(Ui(e,t,r,i),_h(e,t,r))},enqueueReplaceState:function(t,e,n){t=t._reactInternals;var i=Dn(),r=is(t),s=pr(i,r);s.tag=1,s.payload=e,n!=null&&(s.callback=n),e=ts(t,s,r),e!==null&&(Ui(e,t,r,i),_h(e,t,r))},enqueueForceUpdate:function(t,e){t=t._reactInternals;var n=Dn(),i=is(t),r=pr(n,i);r.tag=2,e!=null&&(r.callback=e),e=ts(t,r,i),e!==null&&(Ui(e,t,i,n),_h(e,t,i))}};function cv(t,e,n,i,r,s,o){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!_l(n,i)||!_l(r,s):!0}function Jx(t,e,n){var i=!1,r=os,s=e.contextType;return typeof s=="object"&&s!==null?s=_i(s):(r=Hn(e)?Is:bn.current,i=e.contextTypes,s=(i=i!=null)?Vo(t,r):os),e=new e(n,s),t.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=td,t.stateNode=e,e._reactInternals=t,i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=r,t.__reactInternalMemoizedMaskedChildContext=s),e}function uv(t,e,n,i){t=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(n,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(n,i),e.state!==t&&td.enqueueReplaceState(e,e.state,null)}function tm(t,e,n,i){var r=t.stateNode;r.props=n,r.state=t.memoizedState,r.refs={},km(t);var s=e.contextType;typeof s=="object"&&s!==null?r.context=_i(s):(s=Hn(e)?Is:bn.current,r.context=Vo(t,s)),r.state=t.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(em(t,e,s,n),r.state=t.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&td.enqueueReplaceState(r,r.state,null),kh(t,n,r,i),r.state=t.memoizedState),typeof r.componentDidMount=="function"&&(t.flags|=4194308)}function Xo(t,e){try{var n="",i=e;do n+=fT(i),i=i.return;while(i);var r=n}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:t,source:e,stack:r,digest:null}}function yp(t,e,n){return{value:t,source:null,stack:n??null,digest:e??null}}function nm(t,e){try{console.error(e.value)}catch(n){setTimeout(function(){throw n})}}var BA=typeof WeakMap=="function"?WeakMap:Map;function Qx(t,e,n){n=pr(-1,n),n.tag=3,n.payload={element:null};var i=e.value;return n.callback=function(){Wh||(Wh=!0,dm=i),nm(t,e)},n}function ey(t,e,n){n=pr(-1,n),n.tag=3;var i=t.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;n.payload=function(){return i(r)},n.callback=function(){nm(t,e)}}var s=t.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(n.callback=function(){nm(t,e),typeof i!="function"&&(ns===null?ns=new Set([this]):ns.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),n}function hv(t,e,n){var i=t.pingCache;if(i===null){i=t.pingCache=new BA;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(n)||(r.add(n),t=JA.bind(null,t,e,n),e.then(t,t))}function dv(t){do{var e;if((e=t.tag===13)&&(e=t.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return t;t=t.return}while(t!==null);return null}function fv(t,e,n,i,r){return t.mode&1?(t.flags|=65536,t.lanes=r,t):(t===e?t.flags|=65536:(t.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(e=pr(-1,1),e.tag=2,ts(n,e,1))),n.lanes|=1),t)}var kA=xr.ReactCurrentOwner,Vn=!1;function Ln(t,e,n,i){e.child=t===null?Rx(e,null,n,i):Ho(e,t.child,n,i)}function pv(t,e,n,i,r){n=n.render;var s=e.ref;return Bo(e,r),i=Wm(t,e,n,i,s,r),n=Xm(),t!==null&&!Vn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,vr(t,e,r)):(Ot&&n&&Lm(e),e.flags|=1,Ln(t,e,i,r),e.child)}function mv(t,e,n,i,r){if(t===null){var s=n.type;return typeof s=="function"&&!tg(s)&&s.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(e.tag=15,e.type=s,ty(t,e,s,i,r)):(t=wh(n.type,null,i,e,e.mode,r),t.ref=e.ref,t.return=e,e.child=t)}if(s=t.child,!(t.lanes&r)){var o=s.memoizedProps;if(n=n.compare,n=n!==null?n:_l,n(o,i)&&t.ref===e.ref)return vr(t,e,r)}return e.flags|=1,t=rs(s,i),t.ref=e.ref,t.return=e,e.child=t}function ty(t,e,n,i,r){if(t!==null){var s=t.memoizedProps;if(_l(s,i)&&t.ref===e.ref)if(Vn=!1,e.pendingProps=i=s,(t.lanes&r)!==0)t.flags&131072&&(Vn=!0);else return e.lanes=t.lanes,vr(t,e,r)}return im(t,e,n,i,r)}function ny(t,e,n){var i=e.pendingProps,r=i.children,s=t!==null?t.memoizedState:null;if(i.mode==="hidden")if(!(e.mode&1))e.memoizedState={baseLanes:0,cachePool:null,transitions:null},It(Do,Qn),Qn|=n;else{if(!(n&1073741824))return t=s!==null?s.baseLanes|n:n,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:t,cachePool:null,transitions:null},e.updateQueue=null,It(Do,Qn),Qn|=t,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:n,It(Do,Qn),Qn|=i}else s!==null?(i=s.baseLanes|n,e.memoizedState=null):i=n,It(Do,Qn),Qn|=i;return Ln(t,e,r,n),e.child}function iy(t,e){var n=e.ref;(t===null&&n!==null||t!==null&&t.ref!==n)&&(e.flags|=512,e.flags|=2097152)}function im(t,e,n,i,r){var s=Hn(n)?Is:bn.current;return s=Vo(e,s),Bo(e,r),n=Wm(t,e,n,i,s,r),i=Xm(),t!==null&&!Vn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,vr(t,e,r)):(Ot&&i&&Lm(e),e.flags|=1,Ln(t,e,n,r),e.child)}function gv(t,e,n,i,r){if(Hn(n)){var s=!0;Nh(e)}else s=!1;if(Bo(e,r),e.stateNode===null)yh(t,e),Jx(e,n,i),tm(e,n,i,r),i=!0;else if(t===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,c=n.contextType;typeof c=="object"&&c!==null?c=_i(c):(c=Hn(n)?Is:bn.current,c=Vo(e,c));var d=n.getDerivedStateFromProps,p=typeof d=="function"||typeof o.getSnapshotBeforeUpdate=="function";p||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==c)&&uv(e,o,i,c),Yr=!1;var h=e.memoizedState;o.state=h,kh(e,i,o,r),l=e.memoizedState,a!==i||h!==l||Gn.current||Yr?(typeof d=="function"&&(em(e,n,d,i),l=e.memoizedState),(a=Yr||cv(e,n,a,i,h,l,c))?(p||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=c,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,Ix(t,e),a=e.memoizedProps,c=e.type===e.elementType?a:Ii(e.type,a),o.props=c,p=e.pendingProps,h=o.context,l=n.contextType,typeof l=="object"&&l!==null?l=_i(l):(l=Hn(n)?Is:bn.current,l=Vo(e,l));var f=n.getDerivedStateFromProps;(d=typeof f=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==p||h!==l)&&uv(e,o,i,l),Yr=!1,h=e.memoizedState,o.state=h,kh(e,i,o,r);var v=e.memoizedState;a!==p||h!==v||Gn.current||Yr?(typeof f=="function"&&(em(e,n,f,i),v=e.memoizedState),(c=Yr||cv(e,n,c,i,h,v,l)||!1)?(d||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,v,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,v,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=v),o.props=i,o.state=v,o.context=l,i=c):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),i=!1)}return rm(t,e,n,i,s,r)}function rm(t,e,n,i,r,s){iy(t,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&tv(e,n,!1),vr(t,e,s);i=e.stateNode,kA.current=e;var a=o&&typeof n.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,t!==null&&o?(e.child=Ho(e,t.child,null,s),e.child=Ho(e,null,a,s)):Ln(t,e,a,s),e.memoizedState=i.state,r&&tv(e,n,!0),e.child}function ry(t){var e=t.stateNode;e.pendingContext?ev(t,e.pendingContext,e.pendingContext!==e.context):e.context&&ev(t,e.context,!1),zm(t,e.containerInfo)}function _v(t,e,n,i,r){return Go(),Nm(r),e.flags|=256,Ln(t,e,n,i),e.child}var sm={dehydrated:null,treeContext:null,retryLane:0};function om(t){return{baseLanes:t,cachePool:null,transitions:null}}function sy(t,e,n){var i=e.pendingProps,r=Gt.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=t!==null&&t.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(t===null||t.memoizedState!==null)&&(r|=1),It(Gt,r&1),t===null)return Jp(e),t=e.memoizedState,t!==null&&(t=t.dehydrated,t!==null)?(e.mode&1?t.data==="$!"?e.lanes=8:e.lanes=1073741824:e.lanes=1,null):(o=i.children,t=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},!(i&1)&&s!==null?(s.childLanes=0,s.pendingProps=o):s=rd(o,i,0,null),t=Ps(t,i,n,null),s.return=e,t.return=e,s.sibling=t,e.child=s,e.child.memoizedState=om(n),e.memoizedState=sm,t):Zm(e,o));if(r=t.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return zA(t,e,o,i,a,r,n);if(s){s=i.fallback,o=e.mode,r=t.child,a=r.sibling;var l={mode:"hidden",children:i.children};return!(o&1)&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=rs(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=rs(a,s):(s=Ps(s,o,n,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=t.child.memoizedState,o=o===null?om(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=t.childLanes&~n,e.memoizedState=sm,i}return s=t.child,t=s.sibling,i=rs(s,{mode:"visible",children:i.children}),!(e.mode&1)&&(i.lanes=n),i.return=e,i.sibling=null,t!==null&&(n=e.deletions,n===null?(e.deletions=[t],e.flags|=16):n.push(t)),e.child=i,e.memoizedState=null,i}function Zm(t,e){return e=rd({mode:"visible",children:e},t.mode,0,null),e.return=t,t.child=e}function hh(t,e,n,i){return i!==null&&Nm(i),Ho(e,t.child,null,n),t=Zm(e,e.pendingProps.children),t.flags|=2,e.memoizedState=null,t}function zA(t,e,n,i,r,s,o){if(n)return e.flags&256?(e.flags&=-257,i=yp(Error(le(422))),hh(t,e,o,i)):e.memoizedState!==null?(e.child=t.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=rd({mode:"visible",children:i.children},r,0,null),s=Ps(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,e.mode&1&&Ho(e,t.child,null,o),e.child.memoizedState=om(o),e.memoizedState=sm,s);if(!(e.mode&1))return hh(t,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(le(419)),i=yp(s,i,void 0),hh(t,e,o,i)}if(a=(o&t.childLanes)!==0,Vn||a){if(i=on,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=r&(i.suspendedLanes|o)?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,_r(t,r),Ui(i,t,r,-1))}return eg(),i=yp(Error(le(421))),hh(t,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=t.child,e=QA.bind(null,t),r._reactRetry=e,null):(t=s.treeContext,ei=es(r.nextSibling),ti=e,Ot=!0,Di=null,t!==null&&(fi[pi++]=dr,fi[pi++]=fr,fi[pi++]=Ls,dr=t.id,fr=t.overflow,Ls=e),e=Zm(e,i.children),e.flags|=4096,e)}function vv(t,e,n){t.lanes|=e;var i=t.alternate;i!==null&&(i.lanes|=e),Qp(t.return,e,n)}function Sp(t,e,n,i,r){var s=t.memoizedState;s===null?t.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=n,s.tailMode=r)}function oy(t,e,n){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(Ln(t,e,i.children,n),i=Gt.current,i&2)i=i&1|2,e.flags|=128;else{if(t!==null&&t.flags&128)e:for(t=e.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&vv(t,n,e);else if(t.tag===19)vv(t,n,e);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break e;for(;t.sibling===null;){if(t.return===null||t.return===e)break e;t=t.return}t.sibling.return=t.return,t=t.sibling}i&=1}if(It(Gt,i),!(e.mode&1))e.memoizedState=null;else switch(r){case"forwards":for(n=e.child,r=null;n!==null;)t=n.alternate,t!==null&&zh(t)===null&&(r=n),n=n.sibling;n=r,n===null?(r=e.child,e.child=null):(r=n.sibling,n.sibling=null),Sp(e,!1,r,n,s);break;case"backwards":for(n=null,r=e.child,e.child=null;r!==null;){if(t=r.alternate,t!==null&&zh(t)===null){e.child=r;break}t=r.sibling,r.sibling=n,n=r,r=t}Sp(e,!0,n,null,s);break;case"together":Sp(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function yh(t,e){!(e.mode&1)&&t!==null&&(t.alternate=null,e.alternate=null,e.flags|=2)}function vr(t,e,n){if(t!==null&&(e.dependencies=t.dependencies),Ns|=e.lanes,!(n&e.childLanes))return null;if(t!==null&&e.child!==t.child)throw Error(le(153));if(e.child!==null){for(t=e.child,n=rs(t,t.pendingProps),e.child=n,n.return=e;t.sibling!==null;)t=t.sibling,n=n.sibling=rs(t,t.pendingProps),n.return=e;n.sibling=null}return e.child}function VA(t,e,n){switch(e.tag){case 3:ry(e),Go();break;case 5:Lx(e);break;case 1:Hn(e.type)&&Nh(e);break;case 4:zm(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;It(Oh,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(It(Gt,Gt.current&1),e.flags|=128,null):n&e.child.childLanes?sy(t,e,n):(It(Gt,Gt.current&1),t=vr(t,e,n),t!==null?t.sibling:null);It(Gt,Gt.current&1);break;case 19:if(i=(n&e.childLanes)!==0,t.flags&128){if(i)return oy(t,e,n);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),It(Gt,Gt.current),i)break;return null;case 22:case 23:return e.lanes=0,ny(t,e,n)}return vr(t,e,n)}var ay,am,ly,cy;ay=function(t,e){for(var n=e.child;n!==null;){if(n.tag===5||n.tag===6)t.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return;n=n.return}n.sibling.return=n.return,n=n.sibling}};am=function(){};ly=function(t,e,n,i){var r=t.memoizedProps;if(r!==i){t=e.stateNode,Cs(Ki.current);var s=null;switch(n){case"input":r=Rp(t,r),i=Rp(t,i),s=[];break;case"select":r=Wt({},r,{value:void 0}),i=Wt({},i,{value:void 0}),s=[];break;case"textarea":r=Lp(t,r),i=Lp(t,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(t.onclick=Lh)}Np(n,i);var o;n=null;for(c in r)if(!i.hasOwnProperty(c)&&r.hasOwnProperty(c)&&r[c]!=null)if(c==="style"){var a=r[c];for(o in a)a.hasOwnProperty(o)&&(n||(n={}),n[o]="")}else c!=="dangerouslySetInnerHTML"&&c!=="children"&&c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&c!=="autoFocus"&&(ul.hasOwnProperty(c)?s||(s=[]):(s=s||[]).push(c,null));for(c in i){var l=i[c];if(a=r!=null?r[c]:void 0,i.hasOwnProperty(c)&&l!==a&&(l!=null||a!=null))if(c==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(n||(n={}),n[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(n||(n={}),n[o]=l[o])}else n||(s||(s=[]),s.push(c,n)),n=l;else c==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(c,l)):c==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(c,""+l):c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&(ul.hasOwnProperty(c)?(l!=null&&c==="onScroll"&&Nt("scroll",t),s||a===l||(s=[])):(s=s||[]).push(c,l))}n&&(s=s||[]).push("style",n);var c=s;(e.updateQueue=c)&&(e.flags|=4)}};cy=function(t,e,n,i){n!==i&&(e.flags|=4)};function Za(t,e){if(!Ot)switch(t.tailMode){case"hidden":e=t.tail;for(var n=null;e!==null;)e.alternate!==null&&(n=e),e=e.sibling;n===null?t.tail=null:n.sibling=null;break;case"collapsed":n=t.tail;for(var i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?e||t.tail===null?t.tail=null:t.tail.sibling=null:i.sibling=null}}function Mn(t){var e=t.alternate!==null&&t.alternate.child===t.child,n=0,i=0;if(e)for(var r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=t,r=r.sibling;else for(r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=t,r=r.sibling;return t.subtreeFlags|=i,t.childLanes=n,e}function GA(t,e,n){var i=e.pendingProps;switch(Dm(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return Mn(e),null;case 1:return Hn(e.type)&&Dh(),Mn(e),null;case 3:return i=e.stateNode,Wo(),Ut(Gn),Ut(bn),Gm(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(t===null||t.child===null)&&(ch(e)?e.flags|=4:t===null||t.memoizedState.isDehydrated&&!(e.flags&256)||(e.flags|=1024,Di!==null&&(mm(Di),Di=null))),am(t,e),Mn(e),null;case 5:Vm(e);var r=Cs(Ml.current);if(n=e.type,t!==null&&e.stateNode!=null)ly(t,e,n,i,r),t.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(le(166));return Mn(e),null}if(t=Cs(Ki.current),ch(e)){i=e.stateNode,n=e.type;var s=e.memoizedProps;switch(i[$i]=e,i[yl]=s,t=(e.mode&1)!==0,n){case"dialog":Nt("cancel",i),Nt("close",i);break;case"iframe":case"object":case"embed":Nt("load",i);break;case"video":case"audio":for(r=0;r<el.length;r++)Nt(el[r],i);break;case"source":Nt("error",i);break;case"img":case"image":case"link":Nt("error",i),Nt("load",i);break;case"details":Nt("toggle",i);break;case"input":T_(i,s),Nt("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},Nt("invalid",i);break;case"textarea":C_(i,s),Nt("invalid",i)}Np(n,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&lh(i.textContent,a,t),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&lh(i.textContent,a,t),r=["children",""+a]):ul.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&Nt("scroll",i)}switch(n){case"input":ju(i),A_(i,s,!0);break;case"textarea":ju(i),R_(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=Lh)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,t==="http://www.w3.org/1999/xhtml"&&(t=Ov(n)),t==="http://www.w3.org/1999/xhtml"?n==="script"?(t=o.createElement("div"),t.innerHTML="<script><\/script>",t=t.removeChild(t.firstChild)):typeof i.is=="string"?t=o.createElement(n,{is:i.is}):(t=o.createElement(n),n==="select"&&(o=t,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):t=o.createElementNS(t,n),t[$i]=e,t[yl]=i,ay(t,e,!1,!1),e.stateNode=t;e:{switch(o=Up(n,i),n){case"dialog":Nt("cancel",t),Nt("close",t),r=i;break;case"iframe":case"object":case"embed":Nt("load",t),r=i;break;case"video":case"audio":for(r=0;r<el.length;r++)Nt(el[r],t);r=i;break;case"source":Nt("error",t),r=i;break;case"img":case"image":case"link":Nt("error",t),Nt("load",t),r=i;break;case"details":Nt("toggle",t),r=i;break;case"input":T_(t,i),r=Rp(t,i),Nt("invalid",t);break;case"option":r=i;break;case"select":t._wrapperState={wasMultiple:!!i.multiple},r=Wt({},i,{value:void 0}),Nt("invalid",t);break;case"textarea":C_(t,i),r=Lp(t,i),Nt("invalid",t);break;default:r=i}Np(n,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?zv(t,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&Bv(t,l)):s==="children"?typeof l=="string"?(n!=="textarea"||l!=="")&&hl(t,l):typeof l=="number"&&hl(t,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(ul.hasOwnProperty(s)?l!=null&&s==="onScroll"&&Nt("scroll",t):l!=null&&vm(t,s,l,o))}switch(n){case"input":ju(t),A_(t,i,!1);break;case"textarea":ju(t),R_(t);break;case"option":i.value!=null&&t.setAttribute("value",""+ss(i.value));break;case"select":t.multiple=!!i.multiple,s=i.value,s!=null?No(t,!!i.multiple,s,!1):i.defaultValue!=null&&No(t,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(t.onclick=Lh)}switch(n){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return Mn(e),null;case 6:if(t&&e.stateNode!=null)cy(t,e,t.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(le(166));if(n=Cs(Ml.current),Cs(Ki.current),ch(e)){if(i=e.stateNode,n=e.memoizedProps,i[$i]=e,(s=i.nodeValue!==n)&&(t=ti,t!==null))switch(t.tag){case 3:lh(i.nodeValue,n,(t.mode&1)!==0);break;case 5:t.memoizedProps.suppressHydrationWarning!==!0&&lh(i.nodeValue,n,(t.mode&1)!==0)}s&&(e.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[$i]=e,e.stateNode=i}return Mn(e),null;case 13:if(Ut(Gt),i=e.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(Ot&&ei!==null&&e.mode&1&&!(e.flags&128))Ax(),Go(),e.flags|=98560,s=!1;else if(s=ch(e),i!==null&&i.dehydrated!==null){if(t===null){if(!s)throw Error(le(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(le(317));s[$i]=e}else Go(),!(e.flags&128)&&(e.memoizedState=null),e.flags|=4;Mn(e),s=!1}else Di!==null&&(mm(Di),Di=null),s=!0;if(!s)return e.flags&65536?e:null}return e.flags&128?(e.lanes=n,e):(i=i!==null,i!==(t!==null&&t.memoizedState!==null)&&i&&(e.child.flags|=8192,e.mode&1&&(t===null||Gt.current&1?tn===0&&(tn=3):eg())),e.updateQueue!==null&&(e.flags|=4),Mn(e),null);case 4:return Wo(),am(t,e),t===null&&vl(e.stateNode.containerInfo),Mn(e),null;case 10:return Om(e.type._context),Mn(e),null;case 17:return Hn(e.type)&&Dh(),Mn(e),null;case 19:if(Ut(Gt),s=e.memoizedState,s===null)return Mn(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)Za(s,!1);else{if(tn!==0||t!==null&&t.flags&128)for(t=e.child;t!==null;){if(o=zh(t),o!==null){for(e.flags|=128,Za(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=n,n=e.child;n!==null;)s=n,t=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=t,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,t=o.dependencies,s.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext}),n=n.sibling;return It(Gt,Gt.current&1|2),e.child}t=t.sibling}s.tail!==null&&Zt()>Yo&&(e.flags|=128,i=!0,Za(s,!1),e.lanes=4194304)}else{if(!i)if(t=zh(o),t!==null){if(e.flags|=128,i=!0,n=t.updateQueue,n!==null&&(e.updateQueue=n,e.flags|=4),Za(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!Ot)return Mn(e),null}else 2*Zt()-s.renderingStartTime>Yo&&n!==1073741824&&(e.flags|=128,i=!0,Za(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(n=s.last,n!==null?n.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=Zt(),e.sibling=null,n=Gt.current,It(Gt,i?n&1|2:n&1),e):(Mn(e),null);case 22:case 23:return Qm(),i=e.memoizedState!==null,t!==null&&t.memoizedState!==null!==i&&(e.flags|=8192),i&&e.mode&1?Qn&1073741824&&(Mn(e),e.subtreeFlags&6&&(e.flags|=8192)):Mn(e),null;case 24:return null;case 25:return null}throw Error(le(156,e.tag))}function HA(t,e){switch(Dm(e),e.tag){case 1:return Hn(e.type)&&Dh(),t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 3:return Wo(),Ut(Gn),Ut(bn),Gm(),t=e.flags,t&65536&&!(t&128)?(e.flags=t&-65537|128,e):null;case 5:return Vm(e),null;case 13:if(Ut(Gt),t=e.memoizedState,t!==null&&t.dehydrated!==null){if(e.alternate===null)throw Error(le(340));Go()}return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 19:return Ut(Gt),null;case 4:return Wo(),null;case 10:return Om(e.type._context),null;case 22:case 23:return Qm(),null;case 24:return null;default:return null}}var dh=!1,wn=!1,WA=typeof WeakSet=="function"?WeakSet:Set,Pe=null;function Lo(t,e){var n=t.ref;if(n!==null)if(typeof n=="function")try{n(null)}catch(i){Xt(t,e,i)}else n.current=null}function lm(t,e,n){try{n()}catch(i){Xt(t,e,i)}}var xv=!1;function XA(t,e){if(Xp=Rh,t=px(),Im(t)){if("selectionStart"in t)var n={start:t.selectionStart,end:t.selectionEnd};else e:{n=(n=t.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{n.nodeType,s.nodeType}catch{n=null;break e}var o=0,a=-1,l=-1,c=0,d=0,p=t,h=null;t:for(;;){for(var f;p!==n||r!==0&&p.nodeType!==3||(a=o+r),p!==s||i!==0&&p.nodeType!==3||(l=o+i),p.nodeType===3&&(o+=p.nodeValue.length),(f=p.firstChild)!==null;)h=p,p=f;for(;;){if(p===t)break t;if(h===n&&++c===r&&(a=o),h===s&&++d===i&&(l=o),(f=p.nextSibling)!==null)break;p=h,h=p.parentNode}p=f}n=a===-1||l===-1?null:{start:a,end:l}}else n=null}n=n||{start:0,end:0}}else n=null;for(Yp={focusedElem:t,selectionRange:n},Rh=!1,Pe=e;Pe!==null;)if(e=Pe,t=e.child,(e.subtreeFlags&1028)!==0&&t!==null)t.return=e,Pe=t;else for(;Pe!==null;){e=Pe;try{var v=e.alternate;if(e.flags&1024)switch(e.tag){case 0:case 11:case 15:break;case 1:if(v!==null){var M=v.memoizedProps,g=v.memoizedState,u=e.stateNode,m=u.getSnapshotBeforeUpdate(e.elementType===e.type?M:Ii(e.type,M),g);u.__reactInternalSnapshotBeforeUpdate=m}break;case 3:var x=e.stateNode.containerInfo;x.nodeType===1?x.textContent="":x.nodeType===9&&x.documentElement&&x.removeChild(x.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(le(163))}}catch(S){Xt(e,e.return,S)}if(t=e.sibling,t!==null){t.return=e.return,Pe=t;break}Pe=e.return}return v=xv,xv=!1,v}function al(t,e,n){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&t)===t){var s=r.destroy;r.destroy=void 0,s!==void 0&&lm(e,n,s)}r=r.next}while(r!==i)}}function nd(t,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var n=e=e.next;do{if((n.tag&t)===t){var i=n.create;n.destroy=i()}n=n.next}while(n!==e)}}function cm(t){var e=t.ref;if(e!==null){var n=t.stateNode;switch(t.tag){case 5:t=n;break;default:t=n}typeof e=="function"?e(t):e.current=t}}function uy(t){var e=t.alternate;e!==null&&(t.alternate=null,uy(e)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(e=t.stateNode,e!==null&&(delete e[$i],delete e[yl],delete e[$p],delete e[AA],delete e[CA])),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}function hy(t){return t.tag===5||t.tag===3||t.tag===4}function yv(t){e:for(;;){for(;t.sibling===null;){if(t.return===null||hy(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.flags&2||t.child===null||t.tag===4)continue e;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function um(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.nodeType===8?n.parentNode.insertBefore(t,e):n.insertBefore(t,e):(n.nodeType===8?(e=n.parentNode,e.insertBefore(t,n)):(e=n,e.appendChild(t)),n=n._reactRootContainer,n!=null||e.onclick!==null||(e.onclick=Lh));else if(i!==4&&(t=t.child,t!==null))for(um(t,e,n),t=t.sibling;t!==null;)um(t,e,n),t=t.sibling}function hm(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.insertBefore(t,e):n.appendChild(t);else if(i!==4&&(t=t.child,t!==null))for(hm(t,e,n),t=t.sibling;t!==null;)hm(t,e,n),t=t.sibling}var cn=null,Li=!1;function Wr(t,e,n){for(n=n.child;n!==null;)dy(t,e,n),n=n.sibling}function dy(t,e,n){if(ji&&typeof ji.onCommitFiberUnmount=="function")try{ji.onCommitFiberUnmount(Zh,n)}catch{}switch(n.tag){case 5:wn||Lo(n,e);case 6:var i=cn,r=Li;cn=null,Wr(t,e,n),cn=i,Li=r,cn!==null&&(Li?(t=cn,n=n.stateNode,t.nodeType===8?t.parentNode.removeChild(n):t.removeChild(n)):cn.removeChild(n.stateNode));break;case 18:cn!==null&&(Li?(t=cn,n=n.stateNode,t.nodeType===8?pp(t.parentNode,n):t.nodeType===1&&pp(t,n),ml(t)):pp(cn,n.stateNode));break;case 4:i=cn,r=Li,cn=n.stateNode.containerInfo,Li=!0,Wr(t,e,n),cn=i,Li=r;break;case 0:case 11:case 14:case 15:if(!wn&&(i=n.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&(s&2||s&4)&&lm(n,e,o),r=r.next}while(r!==i)}Wr(t,e,n);break;case 1:if(!wn&&(Lo(n,e),i=n.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=n.memoizedProps,i.state=n.memoizedState,i.componentWillUnmount()}catch(a){Xt(n,e,a)}Wr(t,e,n);break;case 21:Wr(t,e,n);break;case 22:n.mode&1?(wn=(i=wn)||n.memoizedState!==null,Wr(t,e,n),wn=i):Wr(t,e,n);break;default:Wr(t,e,n)}}function Sv(t){var e=t.updateQueue;if(e!==null){t.updateQueue=null;var n=t.stateNode;n===null&&(n=t.stateNode=new WA),e.forEach(function(i){var r=eC.bind(null,t,i);n.has(i)||(n.add(i),i.then(r,r))})}}function Pi(t,e){var n=e.deletions;if(n!==null)for(var i=0;i<n.length;i++){var r=n[i];try{var s=t,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:cn=a.stateNode,Li=!1;break e;case 3:cn=a.stateNode.containerInfo,Li=!0;break e;case 4:cn=a.stateNode.containerInfo,Li=!0;break e}a=a.return}if(cn===null)throw Error(le(160));dy(s,o,r),cn=null,Li=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(c){Xt(r,e,c)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)fy(e,t),e=e.sibling}function fy(t,e){var n=t.alternate,i=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:if(Pi(e,t),qi(t),i&4){try{al(3,t,t.return),nd(3,t)}catch(M){Xt(t,t.return,M)}try{al(5,t,t.return)}catch(M){Xt(t,t.return,M)}}break;case 1:Pi(e,t),qi(t),i&512&&n!==null&&Lo(n,n.return);break;case 5:if(Pi(e,t),qi(t),i&512&&n!==null&&Lo(n,n.return),t.flags&32){var r=t.stateNode;try{hl(r,"")}catch(M){Xt(t,t.return,M)}}if(i&4&&(r=t.stateNode,r!=null)){var s=t.memoizedProps,o=n!==null?n.memoizedProps:s,a=t.type,l=t.updateQueue;if(t.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&Uv(r,s),Up(a,o);var c=Up(a,s);for(o=0;o<l.length;o+=2){var d=l[o],p=l[o+1];d==="style"?zv(r,p):d==="dangerouslySetInnerHTML"?Bv(r,p):d==="children"?hl(r,p):vm(r,d,p,c)}switch(a){case"input":Pp(r,s);break;case"textarea":Fv(r,s);break;case"select":var h=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var f=s.value;f!=null?No(r,!!s.multiple,f,!1):h!==!!s.multiple&&(s.defaultValue!=null?No(r,!!s.multiple,s.defaultValue,!0):No(r,!!s.multiple,s.multiple?[]:"",!1))}r[yl]=s}catch(M){Xt(t,t.return,M)}}break;case 6:if(Pi(e,t),qi(t),i&4){if(t.stateNode===null)throw Error(le(162));r=t.stateNode,s=t.memoizedProps;try{r.nodeValue=s}catch(M){Xt(t,t.return,M)}}break;case 3:if(Pi(e,t),qi(t),i&4&&n!==null&&n.memoizedState.isDehydrated)try{ml(e.containerInfo)}catch(M){Xt(t,t.return,M)}break;case 4:Pi(e,t),qi(t);break;case 13:Pi(e,t),qi(t),r=t.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(Km=Zt())),i&4&&Sv(t);break;case 22:if(d=n!==null&&n.memoizedState!==null,t.mode&1?(wn=(c=wn)||d,Pi(e,t),wn=c):Pi(e,t),qi(t),i&8192){if(c=t.memoizedState!==null,(t.stateNode.isHidden=c)&&!d&&t.mode&1)for(Pe=t,d=t.child;d!==null;){for(p=Pe=d;Pe!==null;){switch(h=Pe,f=h.child,h.tag){case 0:case 11:case 14:case 15:al(4,h,h.return);break;case 1:Lo(h,h.return);var v=h.stateNode;if(typeof v.componentWillUnmount=="function"){i=h,n=h.return;try{e=i,v.props=e.memoizedProps,v.state=e.memoizedState,v.componentWillUnmount()}catch(M){Xt(i,n,M)}}break;case 5:Lo(h,h.return);break;case 22:if(h.memoizedState!==null){wv(p);continue}}f!==null?(f.return=h,Pe=f):wv(p)}d=d.sibling}e:for(d=null,p=t;;){if(p.tag===5){if(d===null){d=p;try{r=p.stateNode,c?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=p.stateNode,l=p.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=kv("display",o))}catch(M){Xt(t,t.return,M)}}}else if(p.tag===6){if(d===null)try{p.stateNode.nodeValue=c?"":p.memoizedProps}catch(M){Xt(t,t.return,M)}}else if((p.tag!==22&&p.tag!==23||p.memoizedState===null||p===t)&&p.child!==null){p.child.return=p,p=p.child;continue}if(p===t)break e;for(;p.sibling===null;){if(p.return===null||p.return===t)break e;d===p&&(d=null),p=p.return}d===p&&(d=null),p.sibling.return=p.return,p=p.sibling}}break;case 19:Pi(e,t),qi(t),i&4&&Sv(t);break;case 21:break;default:Pi(e,t),qi(t)}}function qi(t){var e=t.flags;if(e&2){try{e:{for(var n=t.return;n!==null;){if(hy(n)){var i=n;break e}n=n.return}throw Error(le(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(hl(r,""),i.flags&=-33);var s=yv(t);hm(t,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=yv(t);um(t,a,o);break;default:throw Error(le(161))}}catch(l){Xt(t,t.return,l)}t.flags&=-3}e&4096&&(t.flags&=-4097)}function YA(t,e,n){Pe=t,py(t,e,n)}function py(t,e,n){for(var i=(t.mode&1)!==0;Pe!==null;){var r=Pe,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||dh;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||wn;a=dh;var c=wn;if(dh=o,(wn=l)&&!c)for(Pe=r;Pe!==null;)o=Pe,l=o.child,o.tag===22&&o.memoizedState!==null?bv(r):l!==null?(l.return=o,Pe=l):bv(r);for(;s!==null;)Pe=s,py(s,e,n),s=s.sibling;Pe=r,dh=a,wn=c}Mv(t,e,n)}else r.subtreeFlags&8772&&s!==null?(s.return=r,Pe=s):Mv(t,e,n)}}function Mv(t){for(;Pe!==null;){var e=Pe;if(e.flags&8772){var n=e.alternate;try{if(e.flags&8772)switch(e.tag){case 0:case 11:case 15:wn||nd(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!wn)if(n===null)i.componentDidMount();else{var r=e.elementType===e.type?n.memoizedProps:Ii(e.type,n.memoizedProps);i.componentDidUpdate(r,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&ov(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(n=null,e.child!==null)switch(e.child.tag){case 5:n=e.child.stateNode;break;case 1:n=e.child.stateNode}ov(e,o,n)}break;case 5:var a=e.stateNode;if(n===null&&e.flags&4){n=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&n.focus();break;case"img":l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var c=e.alternate;if(c!==null){var d=c.memoizedState;if(d!==null){var p=d.dehydrated;p!==null&&ml(p)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(le(163))}wn||e.flags&512&&cm(e)}catch(h){Xt(e,e.return,h)}}if(e===t){Pe=null;break}if(n=e.sibling,n!==null){n.return=e.return,Pe=n;break}Pe=e.return}}function wv(t){for(;Pe!==null;){var e=Pe;if(e===t){Pe=null;break}var n=e.sibling;if(n!==null){n.return=e.return,Pe=n;break}Pe=e.return}}function bv(t){for(;Pe!==null;){var e=Pe;try{switch(e.tag){case 0:case 11:case 15:var n=e.return;try{nd(4,e)}catch(l){Xt(e,n,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){Xt(e,r,l)}}var s=e.return;try{cm(e)}catch(l){Xt(e,s,l)}break;case 5:var o=e.return;try{cm(e)}catch(l){Xt(e,o,l)}}}catch(l){Xt(e,e.return,l)}if(e===t){Pe=null;break}var a=e.sibling;if(a!==null){a.return=e.return,Pe=a;break}Pe=e.return}}var qA=Math.ceil,Hh=xr.ReactCurrentDispatcher,$m=xr.ReactCurrentOwner,gi=xr.ReactCurrentBatchConfig,pt=0,on=null,jt=null,un=0,Qn=0,Do=ls(0),tn=0,Tl=null,Ns=0,id=0,jm=0,ll=null,zn=null,Km=0,Yo=1/0,ur=null,Wh=!1,dm=null,ns=null,fh=!1,jr=null,Xh=0,cl=0,fm=null,Sh=-1,Mh=0;function Dn(){return pt&6?Zt():Sh!==-1?Sh:Sh=Zt()}function is(t){return t.mode&1?pt&2&&un!==0?un&-un:PA.transition!==null?(Mh===0&&(Mh=Jv()),Mh):(t=St,t!==0||(t=window.event,t=t===void 0?16:sx(t.type)),t):1}function Ui(t,e,n,i){if(50<cl)throw cl=0,fm=null,Error(le(185));Al(t,n,i),(!(pt&2)||t!==on)&&(t===on&&(!(pt&2)&&(id|=n),tn===4&&Zr(t,un)),Wn(t,i),n===1&&pt===0&&!(e.mode&1)&&(Yo=Zt()+500,Qh&&cs()))}function Wn(t,e){var n=t.callbackNode;LT(t,e);var i=Ch(t,t===on?un:0);if(i===0)n!==null&&L_(n),t.callbackNode=null,t.callbackPriority=0;else if(e=i&-i,t.callbackPriority!==e){if(n!=null&&L_(n),e===1)t.tag===0?RA(Ev.bind(null,t)):bx(Ev.bind(null,t)),EA(function(){!(pt&6)&&cs()}),n=null;else{switch(Qv(i)){case 1:n=wm;break;case 4:n=jv;break;case 16:n=Ah;break;case 536870912:n=Kv;break;default:n=Ah}n=My(n,my.bind(null,t))}t.callbackPriority=e,t.callbackNode=n}}function my(t,e){if(Sh=-1,Mh=0,pt&6)throw Error(le(327));var n=t.callbackNode;if(ko()&&t.callbackNode!==n)return null;var i=Ch(t,t===on?un:0);if(i===0)return null;if(i&30||i&t.expiredLanes||e)e=Yh(t,i);else{e=i;var r=pt;pt|=2;var s=_y();(on!==t||un!==e)&&(ur=null,Yo=Zt()+500,Rs(t,e));do try{jA();break}catch(a){gy(t,a)}while(!0);Fm(),Hh.current=s,pt=r,jt!==null?e=0:(on=null,un=0,e=tn)}if(e!==0){if(e===2&&(r=zp(t),r!==0&&(i=r,e=pm(t,r))),e===1)throw n=Tl,Rs(t,0),Zr(t,i),Wn(t,Zt()),n;if(e===6)Zr(t,i);else{if(r=t.current.alternate,!(i&30)&&!ZA(r)&&(e=Yh(t,i),e===2&&(s=zp(t),s!==0&&(i=s,e=pm(t,s))),e===1))throw n=Tl,Rs(t,0),Zr(t,i),Wn(t,Zt()),n;switch(t.finishedWork=r,t.finishedLanes=i,e){case 0:case 1:throw Error(le(345));case 2:Es(t,zn,ur);break;case 3:if(Zr(t,i),(i&130023424)===i&&(e=Km+500-Zt(),10<e)){if(Ch(t,0)!==0)break;if(r=t.suspendedLanes,(r&i)!==i){Dn(),t.pingedLanes|=t.suspendedLanes&r;break}t.timeoutHandle=Zp(Es.bind(null,t,zn,ur),e);break}Es(t,zn,ur);break;case 4:if(Zr(t,i),(i&4194240)===i)break;for(e=t.eventTimes,r=-1;0<i;){var o=31-Ni(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=Zt()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*qA(i/1960))-i,10<i){t.timeoutHandle=Zp(Es.bind(null,t,zn,ur),i);break}Es(t,zn,ur);break;case 5:Es(t,zn,ur);break;default:throw Error(le(329))}}}return Wn(t,Zt()),t.callbackNode===n?my.bind(null,t):null}function pm(t,e){var n=ll;return t.current.memoizedState.isDehydrated&&(Rs(t,e).flags|=256),t=Yh(t,e),t!==2&&(e=zn,zn=n,e!==null&&mm(e)),t}function mm(t){zn===null?zn=t:zn.push.apply(zn,t)}function ZA(t){for(var e=t;;){if(e.flags&16384){var n=e.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var i=0;i<n.length;i++){var r=n[i],s=r.getSnapshot;r=r.value;try{if(!Fi(s(),r))return!1}catch{return!1}}}if(n=e.child,e.subtreeFlags&16384&&n!==null)n.return=e,e=n;else{if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function Zr(t,e){for(e&=~jm,e&=~id,t.suspendedLanes|=e,t.pingedLanes&=~e,t=t.expirationTimes;0<e;){var n=31-Ni(e),i=1<<n;t[n]=-1,e&=~i}}function Ev(t){if(pt&6)throw Error(le(327));ko();var e=Ch(t,0);if(!(e&1))return Wn(t,Zt()),null;var n=Yh(t,e);if(t.tag!==0&&n===2){var i=zp(t);i!==0&&(e=i,n=pm(t,i))}if(n===1)throw n=Tl,Rs(t,0),Zr(t,e),Wn(t,Zt()),n;if(n===6)throw Error(le(345));return t.finishedWork=t.current.alternate,t.finishedLanes=e,Es(t,zn,ur),Wn(t,Zt()),null}function Jm(t,e){var n=pt;pt|=1;try{return t(e)}finally{pt=n,pt===0&&(Yo=Zt()+500,Qh&&cs())}}function Us(t){jr!==null&&jr.tag===0&&!(pt&6)&&ko();var e=pt;pt|=1;var n=gi.transition,i=St;try{if(gi.transition=null,St=1,t)return t()}finally{St=i,gi.transition=n,pt=e,!(pt&6)&&cs()}}function Qm(){Qn=Do.current,Ut(Do)}function Rs(t,e){t.finishedWork=null,t.finishedLanes=0;var n=t.timeoutHandle;if(n!==-1&&(t.timeoutHandle=-1,bA(n)),jt!==null)for(n=jt.return;n!==null;){var i=n;switch(Dm(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&Dh();break;case 3:Wo(),Ut(Gn),Ut(bn),Gm();break;case 5:Vm(i);break;case 4:Wo();break;case 13:Ut(Gt);break;case 19:Ut(Gt);break;case 10:Om(i.type._context);break;case 22:case 23:Qm()}n=n.return}if(on=t,jt=t=rs(t.current,null),un=Qn=e,tn=0,Tl=null,jm=id=Ns=0,zn=ll=null,As!==null){for(e=0;e<As.length;e++)if(n=As[e],i=n.interleaved,i!==null){n.interleaved=null;var r=i.next,s=n.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}n.pending=i}As=null}return t}function gy(t,e){do{var n=jt;try{if(Fm(),vh.current=Gh,Vh){for(var i=Ht.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}Vh=!1}if(Ds=0,sn=en=Ht=null,ol=!1,wl=0,$m.current=null,n===null||n.return===null){tn=1,Tl=e,jt=null;break}e:{var s=t,o=n.return,a=n,l=e;if(e=un,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var c=l,d=a,p=d.tag;if(!(d.mode&1)&&(p===0||p===11||p===15)){var h=d.alternate;h?(d.updateQueue=h.updateQueue,d.memoizedState=h.memoizedState,d.lanes=h.lanes):(d.updateQueue=null,d.memoizedState=null)}var f=dv(o);if(f!==null){f.flags&=-257,fv(f,o,a,s,e),f.mode&1&&hv(s,c,e),e=f,l=c;var v=e.updateQueue;if(v===null){var M=new Set;M.add(l),e.updateQueue=M}else v.add(l);break e}else{if(!(e&1)){hv(s,c,e),eg();break e}l=Error(le(426))}}else if(Ot&&a.mode&1){var g=dv(o);if(g!==null){!(g.flags&65536)&&(g.flags|=256),fv(g,o,a,s,e),Nm(Xo(l,a));break e}}s=l=Xo(l,a),tn!==4&&(tn=2),ll===null?ll=[s]:ll.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var u=Qx(s,l,e);sv(s,u);break e;case 1:a=l;var m=s.type,x=s.stateNode;if(!(s.flags&128)&&(typeof m.getDerivedStateFromError=="function"||x!==null&&typeof x.componentDidCatch=="function"&&(ns===null||!ns.has(x)))){s.flags|=65536,e&=-e,s.lanes|=e;var S=ey(s,a,e);sv(s,S);break e}}s=s.return}while(s!==null)}xy(n)}catch(C){e=C,jt===n&&n!==null&&(jt=n=n.return);continue}break}while(!0)}function _y(){var t=Hh.current;return Hh.current=Gh,t===null?Gh:t}function eg(){(tn===0||tn===3||tn===2)&&(tn=4),on===null||!(Ns&268435455)&&!(id&268435455)||Zr(on,un)}function Yh(t,e){var n=pt;pt|=2;var i=_y();(on!==t||un!==e)&&(ur=null,Rs(t,e));do try{$A();break}catch(r){gy(t,r)}while(!0);if(Fm(),pt=n,Hh.current=i,jt!==null)throw Error(le(261));return on=null,un=0,tn}function $A(){for(;jt!==null;)vy(jt)}function jA(){for(;jt!==null&&!wT();)vy(jt)}function vy(t){var e=Sy(t.alternate,t,Qn);t.memoizedProps=t.pendingProps,e===null?xy(t):jt=e,$m.current=null}function xy(t){var e=t;do{var n=e.alternate;if(t=e.return,e.flags&32768){if(n=HA(n,e),n!==null){n.flags&=32767,jt=n;return}if(t!==null)t.flags|=32768,t.subtreeFlags=0,t.deletions=null;else{tn=6,jt=null;return}}else if(n=GA(n,e,Qn),n!==null){jt=n;return}if(e=e.sibling,e!==null){jt=e;return}jt=e=t}while(e!==null);tn===0&&(tn=5)}function Es(t,e,n){var i=St,r=gi.transition;try{gi.transition=null,St=1,KA(t,e,n,i)}finally{gi.transition=r,St=i}return null}function KA(t,e,n,i){do ko();while(jr!==null);if(pt&6)throw Error(le(327));n=t.finishedWork;var r=t.finishedLanes;if(n===null)return null;if(t.finishedWork=null,t.finishedLanes=0,n===t.current)throw Error(le(177));t.callbackNode=null,t.callbackPriority=0;var s=n.lanes|n.childLanes;if(DT(t,s),t===on&&(jt=on=null,un=0),!(n.subtreeFlags&2064)&&!(n.flags&2064)||fh||(fh=!0,My(Ah,function(){return ko(),null})),s=(n.flags&15990)!==0,n.subtreeFlags&15990||s){s=gi.transition,gi.transition=null;var o=St;St=1;var a=pt;pt|=4,$m.current=null,XA(t,n),fy(n,t),xA(Yp),Rh=!!Xp,Yp=Xp=null,t.current=n,YA(n,t,r),bT(),pt=a,St=o,gi.transition=s}else t.current=n;if(fh&&(fh=!1,jr=t,Xh=r),s=t.pendingLanes,s===0&&(ns=null),AT(n.stateNode,i),Wn(t,Zt()),e!==null)for(i=t.onRecoverableError,n=0;n<e.length;n++)r=e[n],i(r.value,{componentStack:r.stack,digest:r.digest});if(Wh)throw Wh=!1,t=dm,dm=null,t;return Xh&1&&t.tag!==0&&ko(),s=t.pendingLanes,s&1?t===fm?cl++:(cl=0,fm=t):cl=0,cs(),null}function ko(){if(jr!==null){var t=Qv(Xh),e=gi.transition,n=St;try{if(gi.transition=null,St=16>t?16:t,jr===null)var i=!1;else{if(t=jr,jr=null,Xh=0,pt&6)throw Error(le(331));var r=pt;for(pt|=4,Pe=t.current;Pe!==null;){var s=Pe,o=s.child;if(Pe.flags&16){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var c=a[l];for(Pe=c;Pe!==null;){var d=Pe;switch(d.tag){case 0:case 11:case 15:al(8,d,s)}var p=d.child;if(p!==null)p.return=d,Pe=p;else for(;Pe!==null;){d=Pe;var h=d.sibling,f=d.return;if(uy(d),d===c){Pe=null;break}if(h!==null){h.return=f,Pe=h;break}Pe=f}}}var v=s.alternate;if(v!==null){var M=v.child;if(M!==null){v.child=null;do{var g=M.sibling;M.sibling=null,M=g}while(M!==null)}}Pe=s}}if(s.subtreeFlags&2064&&o!==null)o.return=s,Pe=o;else e:for(;Pe!==null;){if(s=Pe,s.flags&2048)switch(s.tag){case 0:case 11:case 15:al(9,s,s.return)}var u=s.sibling;if(u!==null){u.return=s.return,Pe=u;break e}Pe=s.return}}var m=t.current;for(Pe=m;Pe!==null;){o=Pe;var x=o.child;if(o.subtreeFlags&2064&&x!==null)x.return=o,Pe=x;else e:for(o=m;Pe!==null;){if(a=Pe,a.flags&2048)try{switch(a.tag){case 0:case 11:case 15:nd(9,a)}}catch(C){Xt(a,a.return,C)}if(a===o){Pe=null;break e}var S=a.sibling;if(S!==null){S.return=a.return,Pe=S;break e}Pe=a.return}}if(pt=r,cs(),ji&&typeof ji.onPostCommitFiberRoot=="function")try{ji.onPostCommitFiberRoot(Zh,t)}catch{}i=!0}return i}finally{St=n,gi.transition=e}}return!1}function Tv(t,e,n){e=Xo(n,e),e=Qx(t,e,1),t=ts(t,e,1),e=Dn(),t!==null&&(Al(t,1,e),Wn(t,e))}function Xt(t,e,n){if(t.tag===3)Tv(t,t,n);else for(;e!==null;){if(e.tag===3){Tv(e,t,n);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(ns===null||!ns.has(i))){t=Xo(n,t),t=ey(e,t,1),e=ts(e,t,1),t=Dn(),e!==null&&(Al(e,1,t),Wn(e,t));break}}e=e.return}}function JA(t,e,n){var i=t.pingCache;i!==null&&i.delete(e),e=Dn(),t.pingedLanes|=t.suspendedLanes&n,on===t&&(un&n)===n&&(tn===4||tn===3&&(un&130023424)===un&&500>Zt()-Km?Rs(t,0):jm|=n),Wn(t,e)}function yy(t,e){e===0&&(t.mode&1?(e=Qu,Qu<<=1,!(Qu&130023424)&&(Qu=4194304)):e=1);var n=Dn();t=_r(t,e),t!==null&&(Al(t,e,n),Wn(t,n))}function QA(t){var e=t.memoizedState,n=0;e!==null&&(n=e.retryLane),yy(t,n)}function eC(t,e){var n=0;switch(t.tag){case 13:var i=t.stateNode,r=t.memoizedState;r!==null&&(n=r.retryLane);break;case 19:i=t.stateNode;break;default:throw Error(le(314))}i!==null&&i.delete(e),yy(t,n)}var Sy;Sy=function(t,e,n){if(t!==null)if(t.memoizedProps!==e.pendingProps||Gn.current)Vn=!0;else{if(!(t.lanes&n)&&!(e.flags&128))return Vn=!1,VA(t,e,n);Vn=!!(t.flags&131072)}else Vn=!1,Ot&&e.flags&1048576&&Ex(e,Fh,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;yh(t,e),t=e.pendingProps;var r=Vo(e,bn.current);Bo(e,n),r=Wm(null,e,i,t,r,n);var s=Xm();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,Hn(i)?(s=!0,Nh(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,km(e),r.updater=td,e.stateNode=r,r._reactInternals=e,tm(e,i,t,n),e=rm(null,e,i,!0,s,n)):(e.tag=0,Ot&&s&&Lm(e),Ln(null,e,r,n),e=e.child),e;case 16:i=e.elementType;e:{switch(yh(t,e),t=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=nC(i),t=Ii(i,t),r){case 0:e=im(null,e,i,t,n);break e;case 1:e=gv(null,e,i,t,n);break e;case 11:e=pv(null,e,i,t,n);break e;case 14:e=mv(null,e,i,Ii(i.type,t),n);break e}throw Error(le(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Ii(i,r),im(t,e,i,r,n);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Ii(i,r),gv(t,e,i,r,n);case 3:e:{if(ry(e),t===null)throw Error(le(387));i=e.pendingProps,s=e.memoizedState,r=s.element,Ix(t,e),kh(e,i,null,n);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=Xo(Error(le(423)),e),e=_v(t,e,i,n,r);break e}else if(i!==r){r=Xo(Error(le(424)),e),e=_v(t,e,i,n,r);break e}else for(ei=es(e.stateNode.containerInfo.firstChild),ti=e,Ot=!0,Di=null,n=Rx(e,null,i,n),e.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if(Go(),i===r){e=vr(t,e,n);break e}Ln(t,e,i,n)}e=e.child}return e;case 5:return Lx(e),t===null&&Jp(e),i=e.type,r=e.pendingProps,s=t!==null?t.memoizedProps:null,o=r.children,qp(i,r)?o=null:s!==null&&qp(i,s)&&(e.flags|=32),iy(t,e),Ln(t,e,o,n),e.child;case 6:return t===null&&Jp(e),null;case 13:return sy(t,e,n);case 4:return zm(e,e.stateNode.containerInfo),i=e.pendingProps,t===null?e.child=Ho(e,null,i,n):Ln(t,e,i,n),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Ii(i,r),pv(t,e,i,r,n);case 7:return Ln(t,e,e.pendingProps,n),e.child;case 8:return Ln(t,e,e.pendingProps.children,n),e.child;case 12:return Ln(t,e,e.pendingProps.children,n),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,It(Oh,i._currentValue),i._currentValue=o,s!==null)if(Fi(s.value,o)){if(s.children===r.children&&!Gn.current){e=vr(t,e,n);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=pr(-1,n&-n),l.tag=2;var c=s.updateQueue;if(c!==null){c=c.shared;var d=c.pending;d===null?l.next=l:(l.next=d.next,d.next=l),c.pending=l}}s.lanes|=n,l=s.alternate,l!==null&&(l.lanes|=n),Qp(s.return,n,e),a.lanes|=n;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(le(341));o.lanes|=n,a=o.alternate,a!==null&&(a.lanes|=n),Qp(o,n,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}Ln(t,e,r.children,n),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,Bo(e,n),r=_i(r),i=i(r),e.flags|=1,Ln(t,e,i,n),e.child;case 14:return i=e.type,r=Ii(i,e.pendingProps),r=Ii(i.type,r),mv(t,e,i,r,n);case 15:return ty(t,e,e.type,e.pendingProps,n);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Ii(i,r),yh(t,e),e.tag=1,Hn(i)?(t=!0,Nh(e)):t=!1,Bo(e,n),Jx(e,i,r),tm(e,i,r,n),rm(null,e,i,!0,t,n);case 19:return oy(t,e,n);case 22:return ny(t,e,n)}throw Error(le(156,e.tag))};function My(t,e){return $v(t,e)}function tC(t,e,n,i){this.tag=t,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function mi(t,e,n,i){return new tC(t,e,n,i)}function tg(t){return t=t.prototype,!(!t||!t.isReactComponent)}function nC(t){if(typeof t=="function")return tg(t)?1:0;if(t!=null){if(t=t.$$typeof,t===ym)return 11;if(t===Sm)return 14}return 2}function rs(t,e){var n=t.alternate;return n===null?(n=mi(t.tag,e,t.key,t.mode),n.elementType=t.elementType,n.type=t.type,n.stateNode=t.stateNode,n.alternate=t,t.alternate=n):(n.pendingProps=e,n.type=t.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=t.flags&14680064,n.childLanes=t.childLanes,n.lanes=t.lanes,n.child=t.child,n.memoizedProps=t.memoizedProps,n.memoizedState=t.memoizedState,n.updateQueue=t.updateQueue,e=t.dependencies,n.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},n.sibling=t.sibling,n.index=t.index,n.ref=t.ref,n}function wh(t,e,n,i,r,s){var o=2;if(i=t,typeof t=="function")tg(t)&&(o=1);else if(typeof t=="string")o=5;else e:switch(t){case wo:return Ps(n.children,r,s,e);case xm:o=8,r|=8;break;case Ep:return t=mi(12,n,e,r|2),t.elementType=Ep,t.lanes=s,t;case Tp:return t=mi(13,n,e,r),t.elementType=Tp,t.lanes=s,t;case Ap:return t=mi(19,n,e,r),t.elementType=Ap,t.lanes=s,t;case Lv:return rd(n,r,s,e);default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case Pv:o=10;break e;case Iv:o=9;break e;case ym:o=11;break e;case Sm:o=14;break e;case Xr:o=16,i=null;break e}throw Error(le(130,t==null?t:typeof t,""))}return e=mi(o,n,e,r),e.elementType=t,e.type=i,e.lanes=s,e}function Ps(t,e,n,i){return t=mi(7,t,i,e),t.lanes=n,t}function rd(t,e,n,i){return t=mi(22,t,i,e),t.elementType=Lv,t.lanes=n,t.stateNode={isHidden:!1},t}function Mp(t,e,n){return t=mi(6,t,null,e),t.lanes=n,t}function wp(t,e,n){return e=mi(4,t.children!==null?t.children:[],t.key,e),e.lanes=n,e.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},e}function iC(t,e,n,i,r){this.tag=e,this.containerInfo=t,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=op(0),this.expirationTimes=op(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=op(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function ng(t,e,n,i,r,s,o,a,l){return t=new iC(t,e,n,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=mi(3,null,null,e),t.current=s,s.stateNode=t,s.memoizedState={element:i,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},km(s),t}function rC(t,e,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:Mo,key:i==null?null:""+i,children:t,containerInfo:e,implementation:n}}function wy(t){if(!t)return os;t=t._reactInternals;e:{if(Os(t)!==t||t.tag!==1)throw Error(le(170));var e=t;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(Hn(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(le(171))}if(t.tag===1){var n=t.type;if(Hn(n))return wx(t,n,e)}return e}function by(t,e,n,i,r,s,o,a,l){return t=ng(n,i,!0,t,r,s,o,a,l),t.context=wy(null),n=t.current,i=Dn(),r=is(n),s=pr(i,r),s.callback=e??null,ts(n,s,r),t.current.lanes=r,Al(t,r,i),Wn(t,i),t}function sd(t,e,n,i){var r=e.current,s=Dn(),o=is(r);return n=wy(n),e.context===null?e.context=n:e.pendingContext=n,e=pr(s,o),e.payload={element:t},i=i===void 0?null:i,i!==null&&(e.callback=i),t=ts(r,e,o),t!==null&&(Ui(t,r,o,s),_h(t,r,o)),o}function qh(t){if(t=t.current,!t.child)return null;switch(t.child.tag){case 5:return t.child.stateNode;default:return t.child.stateNode}}function Av(t,e){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var n=t.retryLane;t.retryLane=n!==0&&n<e?n:e}}function ig(t,e){Av(t,e),(t=t.alternate)&&Av(t,e)}function sC(){return null}var Ey=typeof reportError=="function"?reportError:function(t){console.error(t)};function rg(t){this._internalRoot=t}od.prototype.render=rg.prototype.render=function(t){var e=this._internalRoot;if(e===null)throw Error(le(409));sd(t,e,null,null)};od.prototype.unmount=rg.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var e=t.containerInfo;Us(function(){sd(null,t,null,null)}),e[gr]=null}};function od(t){this._internalRoot=t}od.prototype.unstable_scheduleHydration=function(t){if(t){var e=nx();t={blockedOn:null,target:t,priority:e};for(var n=0;n<qr.length&&e!==0&&e<qr[n].priority;n++);qr.splice(n,0,t),n===0&&rx(t)}};function sg(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function ad(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11&&(t.nodeType!==8||t.nodeValue!==" react-mount-point-unstable "))}function Cv(){}function oC(t,e,n,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var c=qh(o);s.call(c)}}var o=by(e,i,t,0,null,!1,!1,"",Cv);return t._reactRootContainer=o,t[gr]=o.current,vl(t.nodeType===8?t.parentNode:t),Us(),o}for(;r=t.lastChild;)t.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var c=qh(l);a.call(c)}}var l=ng(t,0,!1,null,null,!1,!1,"",Cv);return t._reactRootContainer=l,t[gr]=l.current,vl(t.nodeType===8?t.parentNode:t),Us(function(){sd(e,l,n,i)}),l}function ld(t,e,n,i,r){var s=n._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=qh(o);a.call(l)}}sd(e,o,t,r)}else o=oC(n,e,t,r,i);return qh(o)}ex=function(t){switch(t.tag){case 3:var e=t.stateNode;if(e.current.memoizedState.isDehydrated){var n=Qa(e.pendingLanes);n!==0&&(bm(e,n|1),Wn(e,Zt()),!(pt&6)&&(Yo=Zt()+500,cs()))}break;case 13:Us(function(){var i=_r(t,1);if(i!==null){var r=Dn();Ui(i,t,1,r)}}),ig(t,1)}};Em=function(t){if(t.tag===13){var e=_r(t,134217728);if(e!==null){var n=Dn();Ui(e,t,134217728,n)}ig(t,134217728)}};tx=function(t){if(t.tag===13){var e=is(t),n=_r(t,e);if(n!==null){var i=Dn();Ui(n,t,e,i)}ig(t,e)}};nx=function(){return St};ix=function(t,e){var n=St;try{return St=t,e()}finally{St=n}};Op=function(t,e,n){switch(e){case"input":if(Pp(t,n),e=n.name,n.type==="radio"&&e!=null){for(n=t;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<n.length;e++){var i=n[e];if(i!==t&&i.form===t.form){var r=Jh(i);if(!r)throw Error(le(90));Nv(i),Pp(i,r)}}}break;case"textarea":Fv(t,n);break;case"select":e=n.value,e!=null&&No(t,!!n.multiple,e,!1)}};Hv=Jm;Wv=Us;var aC={usingClientEntryPoint:!1,Events:[Rl,Ao,Jh,Vv,Gv,Jm]},$a={findFiberByHostInstance:Ts,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},lC={bundleType:$a.bundleType,version:$a.version,rendererPackageName:$a.rendererPackageName,rendererConfig:$a.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:xr.ReactCurrentDispatcher,findHostInstanceByFiber:function(t){return t=qv(t),t===null?null:t.stateNode},findFiberByHostInstance:$a.findFiberByHostInstance||sC,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(ja=__REACT_DEVTOOLS_GLOBAL_HOOK__,!ja.isDisabled&&ja.supportsFiber))try{Zh=ja.inject(lC),ji=ja}catch{}var ja;ri.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=aC;ri.createPortal=function(t,e){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!sg(e))throw Error(le(200));return rC(t,e,null,n)};ri.createRoot=function(t,e){if(!sg(t))throw Error(le(299));var n=!1,i="",r=Ey;return e!=null&&(e.unstable_strictMode===!0&&(n=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=ng(t,1,!1,null,null,n,!1,i,r),t[gr]=e.current,vl(t.nodeType===8?t.parentNode:t),new rg(e)};ri.findDOMNode=function(t){if(t==null)return null;if(t.nodeType===1)return t;var e=t._reactInternals;if(e===void 0)throw typeof t.render=="function"?Error(le(188)):(t=Object.keys(t).join(","),Error(le(268,t)));return t=qv(e),t=t===null?null:t.stateNode,t};ri.flushSync=function(t){return Us(t)};ri.hydrate=function(t,e,n){if(!ad(e))throw Error(le(200));return ld(null,t,e,!0,n)};ri.hydrateRoot=function(t,e,n){if(!sg(t))throw Error(le(405));var i=n!=null&&n.hydratedSources||null,r=!1,s="",o=Ey;if(n!=null&&(n.unstable_strictMode===!0&&(r=!0),n.identifierPrefix!==void 0&&(s=n.identifierPrefix),n.onRecoverableError!==void 0&&(o=n.onRecoverableError)),e=by(e,null,t,1,n??null,r,!1,s,o),t[gr]=e.current,vl(t),i)for(t=0;t<i.length;t++)n=i[t],r=n._getVersion,r=r(n._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[n,r]:e.mutableSourceEagerHydrationData.push(n,r);return new od(e)};ri.render=function(t,e,n){if(!ad(e))throw Error(le(200));return ld(null,t,e,!1,n)};ri.unmountComponentAtNode=function(t){if(!ad(t))throw Error(le(40));return t._reactRootContainer?(Us(function(){ld(null,null,t,!1,function(){t._reactRootContainer=null,t[gr]=null})}),!0):!1};ri.unstable_batchedUpdates=Jm;ri.unstable_renderSubtreeIntoContainer=function(t,e,n,i){if(!ad(n))throw Error(le(200));if(t==null||t._reactInternals===void 0)throw Error(le(38));return ld(t,e,n,!1,i)};ri.version="18.3.1-next-f1338f8080-20240426"});var Ry=Ji((j2,Cy)=>{"use strict";function Ay(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Ay)}catch(t){console.error(t)}}Ay(),Cy.exports=Ty()});var Iy=Ji(og=>{"use strict";var Py=Ry();og.createRoot=Py.createRoot,og.hydrateRoot=Py.hydrateRoot;var K2});var Dy=Ji(cd=>{"use strict";var cC=Hu(),uC=Symbol.for("react.element"),hC=Symbol.for("react.fragment"),dC=Object.prototype.hasOwnProperty,fC=cC.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,pC={key:!0,ref:!0,__self:!0,__source:!0};function Ly(t,e,n){var i,r={},s=null,o=null;n!==void 0&&(s=""+n),e.key!==void 0&&(s=""+e.key),e.ref!==void 0&&(o=e.ref);for(i in e)dC.call(e,i)&&!pC.hasOwnProperty(i)&&(r[i]=e[i]);if(t&&t.defaultProps)for(i in e=t.defaultProps,e)r[i]===void 0&&(r[i]=e[i]);return{$$typeof:uC,type:t,key:s,ref:o,props:r,_owner:fC.current}}cd.Fragment=hC;cd.jsx=Ly;cd.jsxs=Ly});var ag=Ji((e3,Ny)=>{"use strict";Ny.exports=Dy()});var Vc="184",Fr={LEFT:0,MIDDLE:1,RIGHT:2,ROTATE:0,DOLLY:1,PAN:2},Or={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},Ug=0,Xd=1,Fg=2;var xs=1,Og=2,ho=3,sr=0,Pn=1,Jn=2,Gi=0,gs=1,Yd=2,qd=3,Zd=4,Bg=5;var Pr=100,kg=101,zg=102,Vg=103,Gg=104,Hg=200,Wg=201,Xg=202,Yg=203,ec=204,tc=205,qg=206,Zg=207,$g=208,jg=209,Kg=210,Jg=211,Qg=212,e0=213,t0=214,nc=0,ic=1,rc=2,_s=3,sc=4,oc=5,ac=6,lc=7,$d=0,n0=1,i0=2,Ti=0,jd=1,Kd=2,Jd=3,Ta=4,Qd=5,ef=6,tf=7;var nf=300,Br=301,ys=302,Gc=303,Hc=304,Aa=306,cc=1e3,zi=1001,uc=1002,rn=1003,r0=1004;var Ca=1005;var an=1006,Wc=1007;var kr=1008;var On=1009,rf=1010,sf=1011,fo=1012,Xc=1013,Ai=1014,Ci=1015,Hi=1016,Yc=1017,qc=1018,po=1020,of=35902,af=35899,lf=1021,cf=1022,ui=1023,Vi=1026,zr=1027,uf=1028,Zc=1029,Vr=1030,$c=1031;var jc=1033,Ra=33776,Pa=33777,Ia=33778,La=33779,Kc=35840,Jc=35841,Qc=35842,eu=35843,tu=36196,nu=37492,iu=37496,ru=37488,su=37489,Da=37490,ou=37491,au=37808,lu=37809,cu=37810,uu=37811,hu=37812,du=37813,fu=37814,pu=37815,mu=37816,gu=37817,_u=37818,vu=37819,xu=37820,yu=37821,Su=36492,Mu=36494,wu=36495,bu=36283,Eu=36284,Na=36285,Tu=36286;var ia=2300,hc=2301,Ql=2302,Ud=2303,Fd=2400,Od=2401,Bd=2402;var s0=3200;var Au=0,o0=1,cr="",Cn="srgb",ra="srgb-linear",sa="linear",xt="srgb";var ms=7680;var kd=519,a0=512,l0=513,c0=514,Cu=515,u0=516,h0=517,Ru=518,d0=519,zd=35044;var hf="300 es",Mi=2e3,eo=2001;function Wy(t){for(let e=t.length-1;e>=0;--e)if(t[e]>=65535)return!0;return!1}function Xy(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function oa(t){return document.createElementNS("http://www.w3.org/1999/xhtml",t)}function f0(){let t=oa("canvas");return t.style.display="block",t}var hg={},to=null;function df(...t){let e="THREE."+t.shift();to?to("log",e,...t):console.log(e,...t)}function p0(t){let e=t[0];if(typeof e=="string"&&e.startsWith("TSL:")){let n=t[1];n&&n.isStackTrace?t[0]+=" "+n.getLocation():t[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return t}function ke(...t){t=p0(t);let e="THREE."+t.shift();if(to)to("warn",e,...t);else{let n=t[0];n&&n.isStackTrace?console.warn(n.getError(e)):console.warn(e,...t)}}function We(...t){t=p0(t);let e="THREE."+t.shift();if(to)to("error",e,...t);else{let n=t[0];n&&n.isStackTrace?console.error(n.getError(e)):console.error(e,...t)}}function dc(...t){let e=t.join(" ");e in hg||(hg[e]=!0,ke(...t))}function m0(t,e,n){return new Promise(function(i,r){function s(){switch(t.clientWaitSync(e,t.SYNC_FLUSH_COMMANDS_BIT,0)){case t.WAIT_FAILED:r();break;case t.TIMEOUT_EXPIRED:setTimeout(s,n);break;default:i()}}setTimeout(s,n)})}var g0={[nc]:ic,[rc]:ac,[sc]:lc,[_s]:oc,[ic]:nc,[ac]:rc,[lc]:sc,[oc]:_s},bi=class{addEventListener(e,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(n)===-1&&i[e].push(n)}hasEventListener(e,n){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(n)!==-1}removeEventListener(e,n){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(n);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let n=this._listeners;if(n===void 0)return;let i=n[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},pn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],dg=1234567,Qo=Math.PI/180,no=180/Math.PI;function mo(){let t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(pn[t&255]+pn[t>>8&255]+pn[t>>16&255]+pn[t>>24&255]+"-"+pn[e&255]+pn[e>>8&255]+"-"+pn[e>>16&15|64]+pn[e>>24&255]+"-"+pn[n&63|128]+pn[n>>8&255]+"-"+pn[n>>16&255]+pn[n>>24&255]+pn[i&255]+pn[i>>8&255]+pn[i>>16&255]+pn[i>>24&255]).toLowerCase()}function it(t,e,n){return Math.max(e,Math.min(n,t))}function ff(t,e){return(t%e+e)%e}function Yy(t,e,n,i,r){return i+(t-e)*(r-i)/(n-e)}function qy(t,e,n){return t!==e?(n-t)/(e-t):0}function ea(t,e,n){return(1-n)*t+n*e}function Zy(t,e,n,i){return ea(t,e,1-Math.exp(-n*i))}function $y(t,e=1){return e-Math.abs(ff(t,e*2)-e)}function jy(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*(3-2*t))}function Ky(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*t*(t*(t*6-15)+10))}function Jy(t,e){return t+Math.floor(Math.random()*(e-t+1))}function Qy(t,e){return t+Math.random()*(e-t)}function eS(t){return t*(.5-Math.random())}function tS(t){t!==void 0&&(dg=t);let e=dg+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function nS(t){return t*Qo}function iS(t){return t*no}function rS(t){return(t&t-1)===0&&t!==0}function sS(t){return Math.pow(2,Math.ceil(Math.log(t)/Math.LN2))}function oS(t){return Math.pow(2,Math.floor(Math.log(t)/Math.LN2))}function aS(t,e,n,i,r){let s=Math.cos,o=Math.sin,a=s(n/2),l=o(n/2),c=s((e+i)/2),d=o((e+i)/2),p=s((e-i)/2),h=o((e-i)/2),f=s((i-e)/2),v=o((i-e)/2);switch(r){case"XYX":t.set(a*d,l*p,l*h,a*c);break;case"YZY":t.set(l*h,a*d,l*p,a*c);break;case"ZXZ":t.set(l*p,l*h,a*d,a*c);break;case"XZX":t.set(a*d,l*v,l*f,a*c);break;case"YXY":t.set(l*f,a*d,l*v,a*c);break;case"ZYZ":t.set(l*v,l*f,a*d,a*c);break;default:ke("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+r)}}function Js(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return t/4294967295;case Uint16Array:return t/65535;case Uint8Array:return t/255;case Int32Array:return Math.max(t/2147483647,-1);case Int16Array:return Math.max(t/32767,-1);case Int8Array:return Math.max(t/127,-1);default:throw new Error("Invalid component type.")}}function An(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return Math.round(t*4294967295);case Uint16Array:return Math.round(t*65535);case Uint8Array:return Math.round(t*255);case Int32Array:return Math.round(t*2147483647);case Int16Array:return Math.round(t*32767);case Int8Array:return Math.round(t*127);default:throw new Error("Invalid component type.")}}var Bn={DEG2RAD:Qo,RAD2DEG:no,generateUUID:mo,clamp:it,euclideanModulo:ff,mapLinear:Yy,inverseLerp:qy,lerp:ea,damp:Zy,pingpong:$y,smoothstep:jy,smootherstep:Ky,randInt:Jy,randFloat:Qy,randFloatSpread:eS,seededRandom:tS,degToRad:nS,radToDeg:iS,isPowerOfTwo:rS,ceilPowerOfTwo:sS,floorPowerOfTwo:oS,setQuaternionFromProperEuler:aS,normalize:An,denormalize:Js},xf=class xf{constructor(e=0,n=0){this.x=e,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,n){return this.x=e,this.y=n,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let n=this.x,i=this.y,r=e.elements;return this.x=r[0]*n+r[3]*i+r[6],this.y=r[1]*n+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,n){return this.x=it(this.x,e.x,n.x),this.y=it(this.y,e.y,n.y),this}clampScalar(e,n){return this.x=it(this.x,e,n),this.y=it(this.y,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(it(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(it(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y;return n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this}rotateAround(e,n){let i=Math.cos(n),r=Math.sin(n),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};xf.prototype.isVector2=!0;var Le=xf,ln=class{constructor(e=0,n=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=n,this._z=i,this._w=r}static slerpFlat(e,n,i,r,s,o,a){let l=i[r+0],c=i[r+1],d=i[r+2],p=i[r+3],h=s[o+0],f=s[o+1],v=s[o+2],M=s[o+3];if(p!==M||l!==h||c!==f||d!==v){let g=l*h+c*f+d*v+p*M;g<0&&(h=-h,f=-f,v=-v,M=-M,g=-g);let u=1-a;if(g<.9995){let m=Math.acos(g),x=Math.sin(m);u=Math.sin(u*m)/x,a=Math.sin(a*m)/x,l=l*u+h*a,c=c*u+f*a,d=d*u+v*a,p=p*u+M*a}else{l=l*u+h*a,c=c*u+f*a,d=d*u+v*a,p=p*u+M*a;let m=1/Math.sqrt(l*l+c*c+d*d+p*p);l*=m,c*=m,d*=m,p*=m}}e[n]=l,e[n+1]=c,e[n+2]=d,e[n+3]=p}static multiplyQuaternionsFlat(e,n,i,r,s,o){let a=i[r],l=i[r+1],c=i[r+2],d=i[r+3],p=s[o],h=s[o+1],f=s[o+2],v=s[o+3];return e[n]=a*v+d*p+l*f-c*h,e[n+1]=l*v+d*h+c*p-a*f,e[n+2]=c*v+d*f+a*h-l*p,e[n+3]=d*v-a*p-l*h-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,n,i,r){return this._x=e,this._y=n,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,n=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(i/2),d=a(r/2),p=a(s/2),h=l(i/2),f=l(r/2),v=l(s/2);switch(o){case"XYZ":this._x=h*d*p+c*f*v,this._y=c*f*p-h*d*v,this._z=c*d*v+h*f*p,this._w=c*d*p-h*f*v;break;case"YXZ":this._x=h*d*p+c*f*v,this._y=c*f*p-h*d*v,this._z=c*d*v-h*f*p,this._w=c*d*p+h*f*v;break;case"ZXY":this._x=h*d*p-c*f*v,this._y=c*f*p+h*d*v,this._z=c*d*v+h*f*p,this._w=c*d*p-h*f*v;break;case"ZYX":this._x=h*d*p-c*f*v,this._y=c*f*p+h*d*v,this._z=c*d*v-h*f*p,this._w=c*d*p+h*f*v;break;case"YZX":this._x=h*d*p+c*f*v,this._y=c*f*p+h*d*v,this._z=c*d*v-h*f*p,this._w=c*d*p-h*f*v;break;case"XZY":this._x=h*d*p-c*f*v,this._y=c*f*p-h*d*v,this._z=c*d*v+h*f*p,this._w=c*d*p+h*f*v;break;default:ke("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,n){let i=n/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let n=e.elements,i=n[0],r=n[4],s=n[8],o=n[1],a=n[5],l=n[9],c=n[2],d=n[6],p=n[10],h=i+a+p;if(h>0){let f=.5/Math.sqrt(h+1);this._w=.25/f,this._x=(d-l)*f,this._y=(s-c)*f,this._z=(o-r)*f}else if(i>a&&i>p){let f=2*Math.sqrt(1+i-a-p);this._w=(d-l)/f,this._x=.25*f,this._y=(r+o)/f,this._z=(s+c)/f}else if(a>p){let f=2*Math.sqrt(1+a-i-p);this._w=(s-c)/f,this._x=(r+o)/f,this._y=.25*f,this._z=(l+d)/f}else{let f=2*Math.sqrt(1+p-i-a);this._w=(o-r)/f,this._x=(s+c)/f,this._y=(l+d)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,n){let i=e.dot(n)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*n.z-e.z*n.y,this._y=e.z*n.x-e.x*n.z,this._z=e.x*n.y-e.y*n.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(it(this.dot(e),-1,1)))}rotateTowards(e,n){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,n/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=n._x,l=n._y,c=n._z,d=n._w;return this._x=i*d+o*a+r*c-s*l,this._y=r*d+o*l+s*a-i*c,this._z=s*d+o*c+i*l-r*a,this._w=o*d-i*a-r*l-s*c,this._onChangeCallback(),this}slerp(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=this.dot(e);a<0&&(i=-i,r=-r,s=-s,o=-o,a=-a);let l=1-n;if(a<.9995){let c=Math.acos(a),d=Math.sin(c);l=Math.sin(l*c)/d,n=Math.sin(n*c)/d,this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this._onChangeCallback()}else this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this.normalize();return this}slerpQuaternions(e,n,i){return this.copy(e).slerp(n,i)}random(){let e=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(n),s*Math.cos(n))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,n=0){return this._x=e[n],this._y=e[n+1],this._z=e[n+2],this._w=e[n+3],this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._w,e}fromBufferAttribute(e,n){return this._x=e.getX(n),this._y=e.getY(n),this._z=e.getZ(n),this._w=e.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},yf=class yf{constructor(e=0,n=0,i=0){this.x=e,this.y=n,this.z=i}set(e,n,i){return i===void 0&&(i=this.z),this.x=e,this.y=n,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,n){return this.x=e.x*n.x,this.y=e.y*n.y,this.z=e.z*n.z,this}applyEuler(e){return this.applyQuaternion(fg.setFromEuler(e))}applyAxisAngle(e,n){return this.applyQuaternion(fg.setFromAxisAngle(e,n))}applyMatrix3(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[3]*i+s[6]*r,this.y=s[1]*n+s[4]*i+s[7]*r,this.z=s[2]*n+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*n+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*n+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*n+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*n+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let n=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*r-a*i),d=2*(a*n-s*r),p=2*(s*i-o*n);return this.x=n+l*c+o*p-a*d,this.y=i+l*d+a*c-s*p,this.z=r+l*p+s*d-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[4]*i+s[8]*r,this.y=s[1]*n+s[5]*i+s[9]*r,this.z=s[2]*n+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,n){return this.x=it(this.x,e.x,n.x),this.y=it(this.y,e.y,n.y),this.z=it(this.z,e.z,n.z),this}clampScalar(e,n){return this.x=it(this.x,e,n),this.y=it(this.y,e,n),this.z=it(this.z,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(it(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,n){let i=e.x,r=e.y,s=e.z,o=n.x,a=n.y,l=n.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let n=e.lengthSq();if(n===0)return this.set(0,0,0);let i=e.dot(this)/n;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return ud.copy(this).projectOnVector(e),this.sub(ud)}reflect(e){return this.sub(ud.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(it(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return n*n+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,n,i){let r=Math.sin(n)*e;return this.x=r*Math.sin(i),this.y=Math.cos(n)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,n,i){return this.x=e*Math.sin(n),this.y=i,this.z=e*Math.cos(n),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(e){let n=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=n,this.y=i,this.z=r,this}setFromMatrixColumn(e,n){return this.fromArray(e.elements,n*4)}setFromMatrix3Column(e,n){return this.fromArray(e.elements,n*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(e),this.y=n,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};yf.prototype.isVector3=!0;var D=yf,ud=new D,fg=new ln,Sf=class Sf{constructor(e,n,i,r,s,o,a,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c)}set(e,n,i,r,s,o,a,l,c){let d=this.elements;return d[0]=e,d[1]=r,d[2]=a,d[3]=n,d[4]=s,d[5]=l,d[6]=i,d[7]=o,d[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(e,n,i){return e.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let n=e.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[3],l=i[6],c=i[1],d=i[4],p=i[7],h=i[2],f=i[5],v=i[8],M=r[0],g=r[3],u=r[6],m=r[1],x=r[4],S=r[7],C=r[2],b=r[5],R=r[8];return s[0]=o*M+a*m+l*C,s[3]=o*g+a*x+l*b,s[6]=o*u+a*S+l*R,s[1]=c*M+d*m+p*C,s[4]=c*g+d*x+p*b,s[7]=c*u+d*S+p*R,s[2]=h*M+f*m+v*C,s[5]=h*g+f*x+v*b,s[8]=h*u+f*S+v*R,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[3]*=e,n[6]*=e,n[1]*=e,n[4]*=e,n[7]*=e,n[2]*=e,n[5]*=e,n[8]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8];return n*o*d-n*a*c-i*s*d+i*a*l+r*s*c-r*o*l}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],p=d*o-a*c,h=a*l-d*s,f=c*s-o*l,v=n*p+i*h+r*f;if(v===0)return this.set(0,0,0,0,0,0,0,0,0);let M=1/v;return e[0]=p*M,e[1]=(r*c-d*i)*M,e[2]=(a*i-r*o)*M,e[3]=h*M,e[4]=(d*n-r*l)*M,e[5]=(r*s-a*n)*M,e[6]=f*M,e[7]=(i*l-c*n)*M,e[8]=(o*n-i*s)*M,this}transpose(){let e,n=this.elements;return e=n[1],n[1]=n[3],n[3]=e,e=n[2],n[2]=n[6],n[6]=e,e=n[5],n[5]=n[7],n[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let n=this.elements;return e[0]=n[0],e[1]=n[3],e[2]=n[6],e[3]=n[1],e[4]=n[4],e[5]=n[7],e[6]=n[2],e[7]=n[5],e[8]=n[8],this}setUvTransform(e,n,i,r,s,o,a){let l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*o+c*a)+o+e,-r*c,r*l,-r*(-c*o+l*a)+a+n,0,0,1),this}scale(e,n){return this.premultiply(hd.makeScale(e,n)),this}rotate(e){return this.premultiply(hd.makeRotation(-e)),this}translate(e,n){return this.premultiply(hd.makeTranslation(e,n)),this}makeTranslation(e,n){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,n,0,0,1),this}makeRotation(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(e,n){return this.set(e,0,0,0,n,0,0,0,1),this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<9;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<9;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}};Sf.prototype.isMatrix3=!0;var Qe=Sf,hd=new Qe,pg=new Qe().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),mg=new Qe().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function lS(){let t={enabled:!0,workingColorSpace:ra,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===xt&&(r.r=rr(r.r),r.g=rr(r.g),r.b=rr(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===xt&&(r.r=Qs(r.r),r.g=Qs(r.g),r.b=Qs(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===cr?sa:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return dc("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),t.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return dc("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),t.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return t.define({[ra]:{primaries:e,whitePoint:i,transfer:sa,toXYZ:pg,fromXYZ:mg,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:Cn},outputColorSpaceConfig:{drawingBufferColorSpace:Cn}},[Cn]:{primaries:e,whitePoint:i,transfer:xt,toXYZ:pg,fromXYZ:mg,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:Cn}}}),t}var lt=lS();function rr(t){return t<.04045?t*.0773993808:Math.pow(t*.9478672986+.0521327014,2.4)}function Qs(t){return t<.0031308?t*12.92:1.055*Math.pow(t,.41666)-.055}var zs,fc=class{static getDataURL(e,n="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{zs===void 0&&(zs=oa("canvas")),zs.width=e.width,zs.height=e.height;let r=zs.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=zs}return i.toDataURL(n)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let n=oa("canvas");n.width=e.width,n.height=e.height;let i=n.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=rr(s[o]/255)*255;return i.putImageData(r,0,0),n}else if(e.data){let n=e.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor(rr(n[i]/255)*255):n[i]=rr(n[i]);return{data:n,width:e.width,height:e.height}}else return ke("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},cS=0,io=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:cS++}),this.uuid=mo(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?e.set(n.videoWidth,n.videoHeight,0):typeof VideoFrame<"u"&&n instanceof VideoFrame?e.set(n.displayWidth,n.displayHeight,0):n!==null?e.set(n.width,n.height,n.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(dd(r[o].image)):s.push(dd(r[o]))}else s=dd(r);i.url=s}return n||(e.images[this.uuid]=i),i}};function dd(t){return typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap?fc.getDataURL(t):t.data?{data:Array.from(t.data),width:t.width,height:t.height,type:t.data.constructor.name}:(ke("Texture: Unable to serialize Texture."),{})}var uS=0,fd=new D,Fn=class t extends bi{constructor(e=t.DEFAULT_IMAGE,n=t.DEFAULT_MAPPING,i=zi,r=zi,s=an,o=kr,a=ui,l=On,c=t.DEFAULT_ANISOTROPY,d=cr){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:uS++}),this.uuid=mo(),this.name="",this.source=new io(e),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Le(0,0),this.repeat=new Le(1,1),this.center=new Le(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Qe,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=d,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(fd).x}get height(){return this.source.getSize(fd).y}get depth(){return this.source.getSize(fd).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let n in e){let i=e[n];if(i===void 0){ke(`Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){ke(`Texture.setValues(): property '${n}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==nf)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case cc:e.x=e.x-Math.floor(e.x);break;case zi:e.x=e.x<0?0:1;break;case uc:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case cc:e.y=e.y-Math.floor(e.y);break;case zi:e.y=e.y<0?0:1;break;case uc:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Fn.DEFAULT_IMAGE=null;Fn.DEFAULT_MAPPING=nf;Fn.DEFAULT_ANISOTROPY=1;var Mf=class Mf{constructor(e=0,n=0,i=0,r=1){this.x=e,this.y=n,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,n,i,r){return this.x=e,this.y=n,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this.w=e.w+n.w,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this.w+=e.w*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this.w=e.w-n.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*n+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*n+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*n+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*n+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let n=Math.sqrt(1-e.w*e.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/n,this.y=e.y/n,this.z=e.z/n),this}setAxisAngleFromRotationMatrix(e){let n,i,r,s,l=e.elements,c=l[0],d=l[4],p=l[8],h=l[1],f=l[5],v=l[9],M=l[2],g=l[6],u=l[10];if(Math.abs(d-h)<.01&&Math.abs(p-M)<.01&&Math.abs(v-g)<.01){if(Math.abs(d+h)<.1&&Math.abs(p+M)<.1&&Math.abs(v+g)<.1&&Math.abs(c+f+u-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let x=(c+1)/2,S=(f+1)/2,C=(u+1)/2,b=(d+h)/4,R=(p+M)/4,_=(v+g)/4;return x>S&&x>C?x<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(x),r=b/i,s=R/i):S>C?S<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(S),i=b/r,s=_/r):C<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(C),i=R/s,r=_/s),this.set(i,r,s,n),this}let m=Math.sqrt((g-v)*(g-v)+(p-M)*(p-M)+(h-d)*(h-d));return Math.abs(m)<.001&&(m=1),this.x=(g-v)/m,this.y=(p-M)/m,this.z=(h-d)/m,this.w=Math.acos((c+f+u-1)/2),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,n){return this.x=it(this.x,e.x,n.x),this.y=it(this.y,e.y,n.y),this.z=it(this.z,e.z,n.z),this.w=it(this.w,e.w,n.w),this}clampScalar(e,n){return this.x=it(this.x,e,n),this.y=it(this.y,e,n),this.z=it(this.z,e,n),this.w=it(this.w,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(it(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this.w+=(e.w-this.w)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this.w=e.w+(n.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this.w=e[n+3],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e[n+3]=this.w,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this.w=e.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};Mf.prototype.isVector4=!0;var Vt=Mf,pc=class extends bi{constructor(e=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:an,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=n,this.depth=i.depth,this.scissor=new Vt(0,0,e,n),this.scissorTest=!1,this.viewport=new Vt(0,0,e,n),this.textures=[];let r={width:e,height:n,depth:i.depth},s=new Fn(r),o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let n={minFilter:an,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(n.mapping=e.mapping),e.wrapS!==void 0&&(n.wrapS=e.wrapS),e.wrapT!==void 0&&(n.wrapT=e.wrapT),e.wrapR!==void 0&&(n.wrapR=e.wrapR),e.magFilter!==void 0&&(n.magFilter=e.magFilter),e.minFilter!==void 0&&(n.minFilter=e.minFilter),e.format!==void 0&&(n.format=e.format),e.type!==void 0&&(n.type=e.type),e.anisotropy!==void 0&&(n.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(n.colorSpace=e.colorSpace),e.flipY!==void 0&&(n.flipY=e.flipY),e.generateMipmaps!==void 0&&(n.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(n.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,n,i=1){if(this.width!==e||this.height!==n||this.depth!==i){this.width=e,this.height=n,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=n,this.textures[r].image.depth=i,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,n),this.scissor.set(0,0,e,n)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++){this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let r=Object.assign({},e.textures[n].image);this.textures[n].source=new io(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},$n=class extends pc{constructor(e=1,n=1,i={}){super(e,n,i),this.isWebGLRenderTarget=!0}},aa=class extends Fn{constructor(e=null,n=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=rn,this.minFilter=rn,this.wrapR=zi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var mc=class extends Fn{constructor(e=null,n=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=rn,this.minFilter=rn,this.wrapR=zi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var zc=class zc{constructor(e,n,i,r,s,o,a,l,c,d,p,h,f,v,M,g){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c,d,p,h,f,v,M,g)}set(e,n,i,r,s,o,a,l,c,d,p,h,f,v,M,g){let u=this.elements;return u[0]=e,u[4]=n,u[8]=i,u[12]=r,u[1]=s,u[5]=o,u[9]=a,u[13]=l,u[2]=c,u[6]=d,u[10]=p,u[14]=h,u[3]=f,u[7]=v,u[11]=M,u[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new zc().fromArray(this.elements)}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(e){let n=this.elements,i=e.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(e){let n=e.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(e,n,i){return this.determinant()===0?(e.set(1,0,0),n.set(0,1,0),i.set(0,0,1),this):(e.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(e,n,i){return this.set(e.x,n.x,i.x,0,e.y,n.y,i.y,0,e.z,n.z,i.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let n=this.elements,i=e.elements,r=1/Vs.setFromMatrixColumn(e,0).length(),s=1/Vs.setFromMatrixColumn(e,1).length(),o=1/Vs.setFromMatrixColumn(e,2).length();return n[0]=i[0]*r,n[1]=i[1]*r,n[2]=i[2]*r,n[3]=0,n[4]=i[4]*s,n[5]=i[5]*s,n[6]=i[6]*s,n[7]=0,n[8]=i[8]*o,n[9]=i[9]*o,n[10]=i[10]*o,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(e){let n=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),c=Math.sin(r),d=Math.cos(s),p=Math.sin(s);if(e.order==="XYZ"){let h=o*d,f=o*p,v=a*d,M=a*p;n[0]=l*d,n[4]=-l*p,n[8]=c,n[1]=f+v*c,n[5]=h-M*c,n[9]=-a*l,n[2]=M-h*c,n[6]=v+f*c,n[10]=o*l}else if(e.order==="YXZ"){let h=l*d,f=l*p,v=c*d,M=c*p;n[0]=h+M*a,n[4]=v*a-f,n[8]=o*c,n[1]=o*p,n[5]=o*d,n[9]=-a,n[2]=f*a-v,n[6]=M+h*a,n[10]=o*l}else if(e.order==="ZXY"){let h=l*d,f=l*p,v=c*d,M=c*p;n[0]=h-M*a,n[4]=-o*p,n[8]=v+f*a,n[1]=f+v*a,n[5]=o*d,n[9]=M-h*a,n[2]=-o*c,n[6]=a,n[10]=o*l}else if(e.order==="ZYX"){let h=o*d,f=o*p,v=a*d,M=a*p;n[0]=l*d,n[4]=v*c-f,n[8]=h*c+M,n[1]=l*p,n[5]=M*c+h,n[9]=f*c-v,n[2]=-c,n[6]=a*l,n[10]=o*l}else if(e.order==="YZX"){let h=o*l,f=o*c,v=a*l,M=a*c;n[0]=l*d,n[4]=M-h*p,n[8]=v*p+f,n[1]=p,n[5]=o*d,n[9]=-a*d,n[2]=-c*d,n[6]=f*p+v,n[10]=h-M*p}else if(e.order==="XZY"){let h=o*l,f=o*c,v=a*l,M=a*c;n[0]=l*d,n[4]=-p,n[8]=c*d,n[1]=h*p+M,n[5]=o*d,n[9]=f*p-v,n[2]=v*p-f,n[6]=a*d,n[10]=M*p+h}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(e){return this.compose(hS,e,dS)}lookAt(e,n,i){let r=this.elements;return Yn.subVectors(e,n),Yn.lengthSq()===0&&(Yn.z=1),Yn.normalize(),wr.crossVectors(i,Yn),wr.lengthSq()===0&&(Math.abs(i.z)===1?Yn.x+=1e-4:Yn.z+=1e-4,Yn.normalize(),wr.crossVectors(i,Yn)),wr.normalize(),Dl.crossVectors(Yn,wr),r[0]=wr.x,r[4]=Dl.x,r[8]=Yn.x,r[1]=wr.y,r[5]=Dl.y,r[9]=Yn.y,r[2]=wr.z,r[6]=Dl.z,r[10]=Yn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[4],l=i[8],c=i[12],d=i[1],p=i[5],h=i[9],f=i[13],v=i[2],M=i[6],g=i[10],u=i[14],m=i[3],x=i[7],S=i[11],C=i[15],b=r[0],R=r[4],_=r[8],T=r[12],I=r[1],P=r[5],B=r[9],j=r[13],$=r[2],z=r[6],Y=r[10],Z=r[14],ne=r[3],ce=r[7],ue=r[11],Ie=r[15];return s[0]=o*b+a*I+l*$+c*ne,s[4]=o*R+a*P+l*z+c*ce,s[8]=o*_+a*B+l*Y+c*ue,s[12]=o*T+a*j+l*Z+c*Ie,s[1]=d*b+p*I+h*$+f*ne,s[5]=d*R+p*P+h*z+f*ce,s[9]=d*_+p*B+h*Y+f*ue,s[13]=d*T+p*j+h*Z+f*Ie,s[2]=v*b+M*I+g*$+u*ne,s[6]=v*R+M*P+g*z+u*ce,s[10]=v*_+M*B+g*Y+u*ue,s[14]=v*T+M*j+g*Z+u*Ie,s[3]=m*b+x*I+S*$+C*ne,s[7]=m*R+x*P+S*z+C*ce,s[11]=m*_+x*B+S*Y+C*ue,s[15]=m*T+x*j+S*Z+C*Ie,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[4]*=e,n[8]*=e,n[12]*=e,n[1]*=e,n[5]*=e,n[9]*=e,n[13]*=e,n[2]*=e,n[6]*=e,n[10]*=e,n[14]*=e,n[3]*=e,n[7]*=e,n[11]*=e,n[15]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],c=e[13],d=e[2],p=e[6],h=e[10],f=e[14],v=e[3],M=e[7],g=e[11],u=e[15],m=l*f-c*h,x=a*f-c*p,S=a*h-l*p,C=o*f-c*d,b=o*h-l*d,R=o*p-a*d;return n*(M*m-g*x+u*S)-i*(v*m-g*C+u*b)+r*(v*x-M*C+u*R)-s*(v*S-M*b+g*R)}transpose(){let e=this.elements,n;return n=e[1],e[1]=e[4],e[4]=n,n=e[2],e[2]=e[8],e[8]=n,n=e[6],e[6]=e[9],e[9]=n,n=e[3],e[3]=e[12],e[12]=n,n=e[7],e[7]=e[13],e[13]=n,n=e[11],e[11]=e[14],e[14]=n,this}setPosition(e,n,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=n,r[14]=i),this}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],p=e[9],h=e[10],f=e[11],v=e[12],M=e[13],g=e[14],u=e[15],m=n*a-i*o,x=n*l-r*o,S=n*c-s*o,C=i*l-r*a,b=i*c-s*a,R=r*c-s*l,_=d*M-p*v,T=d*g-h*v,I=d*u-f*v,P=p*g-h*M,B=p*u-f*M,j=h*u-f*g,$=m*j-x*B+S*P+C*I-b*T+R*_;if($===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let z=1/$;return e[0]=(a*j-l*B+c*P)*z,e[1]=(r*B-i*j-s*P)*z,e[2]=(M*R-g*b+u*C)*z,e[3]=(h*b-p*R-f*C)*z,e[4]=(l*I-o*j-c*T)*z,e[5]=(n*j-r*I+s*T)*z,e[6]=(g*S-v*R-u*x)*z,e[7]=(d*R-h*S+f*x)*z,e[8]=(o*B-a*I+c*_)*z,e[9]=(i*I-n*B-s*_)*z,e[10]=(v*b-M*S+u*m)*z,e[11]=(p*S-d*b-f*m)*z,e[12]=(a*T-o*P-l*_)*z,e[13]=(n*P-i*T+r*_)*z,e[14]=(M*x-v*C-g*m)*z,e[15]=(d*C-p*x+h*m)*z,this}scale(e){let n=this.elements,i=e.x,r=e.y,s=e.z;return n[0]*=i,n[4]*=r,n[8]*=s,n[1]*=i,n[5]*=r,n[9]*=s,n[2]*=i,n[6]*=r,n[10]*=s,n[3]*=i,n[7]*=r,n[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,n=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(n,i,r))}makeTranslation(e,n,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(e){let n=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,n){let i=Math.cos(n),r=Math.sin(n),s=1-i,o=e.x,a=e.y,l=e.z,c=s*o,d=s*a;return this.set(c*o+i,c*a-r*l,c*l+r*a,0,c*a+r*l,d*a+i,d*l-r*o,0,c*l-r*a,d*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,n,i){return this.set(e,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,n,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,n,r,1,0,0,0,0,1),this}compose(e,n,i){let r=this.elements,s=n._x,o=n._y,a=n._z,l=n._w,c=s+s,d=o+o,p=a+a,h=s*c,f=s*d,v=s*p,M=o*d,g=o*p,u=a*p,m=l*c,x=l*d,S=l*p,C=i.x,b=i.y,R=i.z;return r[0]=(1-(M+u))*C,r[1]=(f+S)*C,r[2]=(v-x)*C,r[3]=0,r[4]=(f-S)*b,r[5]=(1-(h+u))*b,r[6]=(g+m)*b,r[7]=0,r[8]=(v+x)*R,r[9]=(g-m)*R,r[10]=(1-(h+M))*R,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,n,i){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinant();if(s===0)return i.set(1,1,1),n.identity(),this;let o=Vs.set(r[0],r[1],r[2]).length(),a=Vs.set(r[4],r[5],r[6]).length(),l=Vs.set(r[8],r[9],r[10]).length();s<0&&(o=-o),xi.copy(this);let c=1/o,d=1/a,p=1/l;return xi.elements[0]*=c,xi.elements[1]*=c,xi.elements[2]*=c,xi.elements[4]*=d,xi.elements[5]*=d,xi.elements[6]*=d,xi.elements[8]*=p,xi.elements[9]*=p,xi.elements[10]*=p,n.setFromRotationMatrix(xi),i.x=o,i.y=a,i.z=l,this}makePerspective(e,n,i,r,s,o,a=Mi,l=!1){let c=this.elements,d=2*s/(n-e),p=2*s/(i-r),h=(n+e)/(n-e),f=(i+r)/(i-r),v,M;if(l)v=s/(o-s),M=o*s/(o-s);else if(a===Mi)v=-(o+s)/(o-s),M=-2*o*s/(o-s);else if(a===eo)v=-o/(o-s),M=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=h,c[12]=0,c[1]=0,c[5]=p,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=v,c[14]=M,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,n,i,r,s,o,a=Mi,l=!1){let c=this.elements,d=2/(n-e),p=2/(i-r),h=-(n+e)/(n-e),f=-(i+r)/(i-r),v,M;if(l)v=1/(o-s),M=o/(o-s);else if(a===Mi)v=-2/(o-s),M=-(o+s)/(o-s);else if(a===eo)v=-1/(o-s),M=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=0,c[12]=h,c[1]=0,c[5]=p,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=v,c[14]=M,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<16;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<16;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e[n+9]=i[9],e[n+10]=i[10],e[n+11]=i[11],e[n+12]=i[12],e[n+13]=i[13],e[n+14]=i[14],e[n+15]=i[15],e}};zc.prototype.isMatrix4=!0;var Dt=zc,Vs=new D,xi=new Dt,hS=new D(0,0,0),dS=new D(1,1,1),wr=new D,Dl=new D,Yn=new D,gg=new Dt,_g=new ln,li=class t{constructor(e=0,n=0,i=0,r=t.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=n,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,n,i,r=this._order){return this._x=e,this._y=n,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,n=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],d=r[9],p=r[2],h=r[6],f=r[10];switch(n){case"XYZ":this._y=Math.asin(it(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-d,f),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(h,c),this._z=0);break;case"YXZ":this._x=Math.asin(-it(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(a,f),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-p,s),this._z=0);break;case"ZXY":this._x=Math.asin(it(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-p,f),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-it(p,-1,1)),Math.abs(p)<.9999999?(this._x=Math.atan2(h,f),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(it(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-d,c),this._y=Math.atan2(-p,s)):(this._x=0,this._y=Math.atan2(a,f));break;case"XZY":this._z=Math.asin(-it(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(h,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-d,f),this._y=0);break;default:ke("Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,n,i){return gg.makeRotationFromQuaternion(e),this.setFromRotationMatrix(gg,n,i)}setFromVector3(e,n=this._order){return this.set(e.x,e.y,e.z,n)}reorder(e){return _g.setFromEuler(this),this.setFromQuaternion(_g,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};li.DEFAULT_ORDER="XYZ";var la=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},fS=0,vg=new D,Gs=new ln,Qi=new Dt,Nl=new D,$o=new D,pS=new D,mS=new ln,xg=new D(1,0,0),yg=new D(0,1,0),Sg=new D(0,0,1),Mg={type:"added"},gS={type:"removed"},Hs={type:"childadded",child:null},pd={type:"childremoved",child:null},_n=class t extends bi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:fS++}),this.uuid=mo(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=t.DEFAULT_UP.clone();let e=new D,n=new li,i=new ln,r=new D(1,1,1);function s(){i.setFromEuler(n,!1)}function o(){n.setFromQuaternion(i,void 0,!1)}n._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new Dt},normalMatrix:{value:new Qe}}),this.matrix=new Dt,this.matrixWorld=new Dt,this.matrixAutoUpdate=t.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new la,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,n){this.quaternion.setFromAxisAngle(e,n)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,n){return Gs.setFromAxisAngle(e,n),this.quaternion.multiply(Gs),this}rotateOnWorldAxis(e,n){return Gs.setFromAxisAngle(e,n),this.quaternion.premultiply(Gs),this}rotateX(e){return this.rotateOnAxis(xg,e)}rotateY(e){return this.rotateOnAxis(yg,e)}rotateZ(e){return this.rotateOnAxis(Sg,e)}translateOnAxis(e,n){return vg.copy(e).applyQuaternion(this.quaternion),this.position.add(vg.multiplyScalar(n)),this}translateX(e){return this.translateOnAxis(xg,e)}translateY(e){return this.translateOnAxis(yg,e)}translateZ(e){return this.translateOnAxis(Sg,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Qi.copy(this.matrixWorld).invert())}lookAt(e,n,i){e.isVector3?Nl.copy(e):Nl.set(e,n,i);let r=this.parent;this.updateWorldMatrix(!0,!1),$o.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Qi.lookAt($o,Nl,this.up):Qi.lookAt(Nl,$o,this.up),this.quaternion.setFromRotationMatrix(Qi),r&&(Qi.extractRotation(r.matrixWorld),Gs.setFromRotationMatrix(Qi),this.quaternion.premultiply(Gs.invert()))}add(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return e===this?(We("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Mg),Hs.child=e,this.dispatchEvent(Hs),Hs.child=null):We("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(e);return n!==-1&&(e.parent=null,this.children.splice(n,1),e.dispatchEvent(gS),pd.child=e,this.dispatchEvent(pd),pd.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Qi.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Qi.multiply(e.parent.matrixWorld)),e.applyMatrix4(Qi),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Mg),Hs.child=e,this.dispatchEvent(Hs),Hs.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,n){if(this[e]===n)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,n);if(o!==void 0)return o}}getObjectsByProperty(e,n,i=[]){this[e]===n&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,n,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose($o,e,pS),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose($o,mS,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return e.set(n[8],n[9],n[10]).normalize()}raycast(){}traverse(e){e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverseVisible(e)}traverseAncestors(e){let n=this.parent;n!==null&&(e(n),n.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let n=e.x,i=e.y,r=e.z,s=this.matrix.elements;s[12]+=n-s[0]*n-s[4]*i-s[8]*r,s[13]+=i-s[1]*n-s[5]*i-s[9]*r,s[14]+=r-s[2]*n-s[6]*i-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].updateMatrixWorld(e)}updateWorldMatrix(e,n){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),n===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let n=e===void 0||typeof e=="string",i={};n&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,d=l.length;c<d;c++){let p=l[c];s(e.shapes,p)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(n){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),d=o(e.images),p=o(e.shapes),h=o(e.skeletons),f=o(e.animations),v=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),d.length>0&&(i.images=d),p.length>0&&(i.shapes=p),h.length>0&&(i.skeletons=h),f.length>0&&(i.animations=f),v.length>0&&(i.nodes=v)}return i.object=r,i;function o(a){let l=[];for(let c in a){let d=a[c];delete d.metadata,l.push(d)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,n=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),n===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};_n.DEFAULT_UP=new D(0,1,0);_n.DEFAULT_MATRIX_AUTO_UPDATE=!0;_n.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var wi=class extends _n{constructor(){super(),this.isGroup=!0,this.type="Group"}},_S={type:"move"},ro=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new wi,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new wi,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new D,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new D),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new wi,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new D,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new D,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let n=this._hand;if(n)for(let i of e.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,n,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&n.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let M of e.hand.values()){let g=n.getJointPose(M,i),u=this._getHandJoint(c,M);g!==null&&(u.matrix.fromArray(g.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=g.radius),u.visible=g!==null}let d=c.joints["index-finger-tip"],p=c.joints["thumb-tip"],h=d.position.distanceTo(p.position),f=.02,v=.005;c.inputState.pinching&&h>f+v?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&h<=f-v&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=n.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));a!==null&&(r=n.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(_S)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,n){if(e.joints[n.jointName]===void 0){let i=new wi;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[n.jointName]=i,e.add(i)}return e.joints[n.jointName]}},_0={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},br={h:0,s:0,l:0},Ul={h:0,s:0,l:0};function md(t,e,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?t+(e-t)*6*n:n<1/2?e:n<2/3?t+(e-t)*6*(2/3-n):t}var ct=class{constructor(e,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,n,i)}set(e,n,i){if(n===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,n,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,n=Cn){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,lt.colorSpaceToWorking(this,n),this}setRGB(e,n,i,r=lt.workingColorSpace){return this.r=e,this.g=n,this.b=i,lt.colorSpaceToWorking(this,r),this}setHSL(e,n,i,r=lt.workingColorSpace){if(e=ff(e,1),n=it(n,0,1),i=it(i,0,1),n===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+n):i+n-i*n,o=2*i-s;this.r=md(o,s,e+1/3),this.g=md(o,s,e),this.b=md(o,s,e-1/3)}return lt.colorSpaceToWorking(this,r),this}setStyle(e,n=Cn){function i(s){s!==void 0&&parseFloat(s)<1&&ke("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,n);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,n);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,n);break;default:ke("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,n);if(o===6)return this.setHex(parseInt(s,16),n);ke("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,n);return this}setColorName(e,n=Cn){let i=_0[e.toLowerCase()];return i!==void 0?this.setHex(i,n):ke("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=rr(e.r),this.g=rr(e.g),this.b=rr(e.b),this}copyLinearToSRGB(e){return this.r=Qs(e.r),this.g=Qs(e.g),this.b=Qs(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Cn){return lt.workingToColorSpace(mn.copy(this),e),Math.round(it(mn.r*255,0,255))*65536+Math.round(it(mn.g*255,0,255))*256+Math.round(it(mn.b*255,0,255))}getHexString(e=Cn){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,n=lt.workingColorSpace){lt.workingToColorSpace(mn.copy(this),n);let i=mn.r,r=mn.g,s=mn.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,c,d=(a+o)/2;if(a===o)l=0,c=0;else{let p=o-a;switch(c=d<=.5?p/(o+a):p/(2-o-a),o){case i:l=(r-s)/p+(r<s?6:0);break;case r:l=(s-i)/p+2;break;case s:l=(i-r)/p+4;break}l/=6}return e.h=l,e.s=c,e.l=d,e}getRGB(e,n=lt.workingColorSpace){return lt.workingToColorSpace(mn.copy(this),n),e.r=mn.r,e.g=mn.g,e.b=mn.b,e}getStyle(e=Cn){lt.workingToColorSpace(mn.copy(this),e);let n=mn.r,i=mn.g,r=mn.b;return e!==Cn?`color(${e} ${n.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,n,i){return this.getHSL(br),this.setHSL(br.h+e,br.s+n,br.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,n){return this.r=e.r+n.r,this.g=e.g+n.g,this.b=e.b+n.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,n){return this.r+=(e.r-this.r)*n,this.g+=(e.g-this.g)*n,this.b+=(e.b-this.b)*n,this}lerpColors(e,n,i){return this.r=e.r+(n.r-e.r)*i,this.g=e.g+(n.g-e.g)*i,this.b=e.b+(n.b-e.b)*i,this}lerpHSL(e,n){this.getHSL(br),e.getHSL(Ul);let i=ea(br.h,Ul.h,n),r=ea(br.s,Ul.s,n),s=ea(br.l,Ul.l,n);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let n=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*n+s[3]*i+s[6]*r,this.g=s[1]*n+s[4]*i+s[7]*r,this.b=s[2]*n+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,n=0){return this.r=e[n],this.g=e[n+1],this.b=e[n+2],this}toArray(e=[],n=0){return e[n]=this.r,e[n+1]=this.g,e[n+2]=this.b,e}fromBufferAttribute(e,n){return this.r=e.getX(n),this.g=e.getY(n),this.b=e.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},mn=new ct;ct.NAMES=_0;var ca=class extends _n{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new li,this.environmentIntensity=1,this.environmentRotation=new li,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,n){return super.copy(e,n),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let n=super.toJSON(e);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(n.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(n.object.backgroundIntensity=this.backgroundIntensity),n.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(n.object.environmentIntensity=this.environmentIntensity),n.object.environmentRotation=this.environmentRotation.toArray(),n}},yi=new D,er=new D,gd=new D,tr=new D,Ws=new D,Xs=new D,wg=new D,_d=new D,vd=new D,xd=new D,yd=new Vt,Sd=new Vt,Md=new Vt,Rr=class t{constructor(e=new D,n=new D,i=new D){this.a=e,this.b=n,this.c=i}static getNormal(e,n,i,r){r.subVectors(i,n),yi.subVectors(e,n),r.cross(yi);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,n,i,r,s){yi.subVectors(r,n),er.subVectors(i,n),gd.subVectors(e,n);let o=yi.dot(yi),a=yi.dot(er),l=yi.dot(gd),c=er.dot(er),d=er.dot(gd),p=o*c-a*a;if(p===0)return s.set(0,0,0),null;let h=1/p,f=(c*l-a*d)*h,v=(o*d-a*l)*h;return s.set(1-f-v,v,f)}static containsPoint(e,n,i,r){return this.getBarycoord(e,n,i,r,tr)===null?!1:tr.x>=0&&tr.y>=0&&tr.x+tr.y<=1}static getInterpolation(e,n,i,r,s,o,a,l){return this.getBarycoord(e,n,i,r,tr)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,tr.x),l.addScaledVector(o,tr.y),l.addScaledVector(a,tr.z),l)}static getInterpolatedAttribute(e,n,i,r,s,o){return yd.setScalar(0),Sd.setScalar(0),Md.setScalar(0),yd.fromBufferAttribute(e,n),Sd.fromBufferAttribute(e,i),Md.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(yd,s.x),o.addScaledVector(Sd,s.y),o.addScaledVector(Md,s.z),o}static isFrontFacing(e,n,i,r){return yi.subVectors(i,n),er.subVectors(e,n),yi.cross(er).dot(r)<0}set(e,n,i){return this.a.copy(e),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(e,n,i,r){return this.a.copy(e[n]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,n,i,r){return this.a.fromBufferAttribute(e,n),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return yi.subVectors(this.c,this.b),er.subVectors(this.a,this.b),yi.cross(er).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return t.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,n){return t.getBarycoord(e,this.a,this.b,this.c,n)}getInterpolation(e,n,i,r,s){return t.getInterpolation(e,this.a,this.b,this.c,n,i,r,s)}containsPoint(e){return t.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return t.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,n){let i=this.a,r=this.b,s=this.c,o,a;Ws.subVectors(r,i),Xs.subVectors(s,i),_d.subVectors(e,i);let l=Ws.dot(_d),c=Xs.dot(_d);if(l<=0&&c<=0)return n.copy(i);vd.subVectors(e,r);let d=Ws.dot(vd),p=Xs.dot(vd);if(d>=0&&p<=d)return n.copy(r);let h=l*p-d*c;if(h<=0&&l>=0&&d<=0)return o=l/(l-d),n.copy(i).addScaledVector(Ws,o);xd.subVectors(e,s);let f=Ws.dot(xd),v=Xs.dot(xd);if(v>=0&&f<=v)return n.copy(s);let M=f*c-l*v;if(M<=0&&c>=0&&v<=0)return a=c/(c-v),n.copy(i).addScaledVector(Xs,a);let g=d*v-f*p;if(g<=0&&p-d>=0&&f-v>=0)return wg.subVectors(s,r),a=(p-d)/(p-d+(f-v)),n.copy(r).addScaledVector(wg,a);let u=1/(g+M+h);return o=M*u,a=h*u,n.copy(i).addScaledVector(Ws,o).addScaledVector(Xs,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Ei=class{constructor(e=new D(1/0,1/0,1/0),n=new D(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=n}set(e,n){return this.min.copy(e),this.max.copy(n),this}setFromArray(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n+=3)this.expandByPoint(Si.fromArray(e,n));return this}setFromBufferAttribute(e){this.makeEmpty();for(let n=0,i=e.count;n<i;n++)this.expandByPoint(Si.fromBufferAttribute(e,n));return this}setFromPoints(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n++)this.expandByPoint(e[n]);return this}setFromCenterAndSize(e,n){let i=Si.copy(n).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,n=!1){return this.makeEmpty(),this.expandByObject(e,n)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,n=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(n===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,Si):Si.fromBufferAttribute(s,o),Si.applyMatrix4(e.matrixWorld),this.expandByPoint(Si);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Fl.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Fl.copy(i.boundingBox)),Fl.applyMatrix4(e.matrixWorld),this.union(Fl)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],n);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,n){return n.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,Si),Si.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let n,i;return e.normal.x>0?(n=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(n=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(n+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(n+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(n+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(n+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),n<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(jo),Ol.subVectors(this.max,jo),Ys.subVectors(e.a,jo),qs.subVectors(e.b,jo),Zs.subVectors(e.c,jo),Er.subVectors(qs,Ys),Tr.subVectors(Zs,qs),hs.subVectors(Ys,Zs);let n=[0,-Er.z,Er.y,0,-Tr.z,Tr.y,0,-hs.z,hs.y,Er.z,0,-Er.x,Tr.z,0,-Tr.x,hs.z,0,-hs.x,-Er.y,Er.x,0,-Tr.y,Tr.x,0,-hs.y,hs.x,0];return!wd(n,Ys,qs,Zs,Ol)||(n=[1,0,0,0,1,0,0,0,1],!wd(n,Ys,qs,Zs,Ol))?!1:(Bl.crossVectors(Er,Tr),n=[Bl.x,Bl.y,Bl.z],wd(n,Ys,qs,Zs,Ol))}clampPoint(e,n){return n.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Si).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Si).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(nr[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),nr[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),nr[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),nr[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),nr[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),nr[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),nr[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),nr[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(nr),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},nr=[new D,new D,new D,new D,new D,new D,new D,new D],Si=new D,Fl=new Ei,Ys=new D,qs=new D,Zs=new D,Er=new D,Tr=new D,hs=new D,jo=new D,Ol=new D,Bl=new D,ds=new D;function wd(t,e,n,i,r){for(let s=0,o=t.length-3;s<=o;s+=3){ds.fromArray(t,s);let a=r.x*Math.abs(ds.x)+r.y*Math.abs(ds.y)+r.z*Math.abs(ds.z),l=e.dot(ds),c=n.dot(ds),d=i.dot(ds);if(Math.max(-Math.max(l,c,d),Math.min(l,c,d))>a)return!1}return!0}var $t=new D,kl=new Le,vS=0,Zn=class extends bi{constructor(e,n,i=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:vS++}),this.name="",this.array=e,this.itemSize=n,this.count=e!==void 0?e.length/n:0,this.normalized=i,this.usage=zd,this.updateRanges=[],this.gpuType=Ci,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,n,i){e*=this.itemSize,i*=n.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=n.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)kl.fromBufferAttribute(this,n),kl.applyMatrix3(e),this.setXY(n,kl.x,kl.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)$t.fromBufferAttribute(this,n),$t.applyMatrix3(e),this.setXYZ(n,$t.x,$t.y,$t.z);return this}applyMatrix4(e){for(let n=0,i=this.count;n<i;n++)$t.fromBufferAttribute(this,n),$t.applyMatrix4(e),this.setXYZ(n,$t.x,$t.y,$t.z);return this}applyNormalMatrix(e){for(let n=0,i=this.count;n<i;n++)$t.fromBufferAttribute(this,n),$t.applyNormalMatrix(e),this.setXYZ(n,$t.x,$t.y,$t.z);return this}transformDirection(e){for(let n=0,i=this.count;n<i;n++)$t.fromBufferAttribute(this,n),$t.transformDirection(e),this.setXYZ(n,$t.x,$t.y,$t.z);return this}set(e,n=0){return this.array.set(e,n),this}getComponent(e,n){let i=this.array[e*this.itemSize+n];return this.normalized&&(i=Js(i,this.array)),i}setComponent(e,n,i){return this.normalized&&(i=An(i,this.array)),this.array[e*this.itemSize+n]=i,this}getX(e){let n=this.array[e*this.itemSize];return this.normalized&&(n=Js(n,this.array)),n}setX(e,n){return this.normalized&&(n=An(n,this.array)),this.array[e*this.itemSize]=n,this}getY(e){let n=this.array[e*this.itemSize+1];return this.normalized&&(n=Js(n,this.array)),n}setY(e,n){return this.normalized&&(n=An(n,this.array)),this.array[e*this.itemSize+1]=n,this}getZ(e){let n=this.array[e*this.itemSize+2];return this.normalized&&(n=Js(n,this.array)),n}setZ(e,n){return this.normalized&&(n=An(n,this.array)),this.array[e*this.itemSize+2]=n,this}getW(e){let n=this.array[e*this.itemSize+3];return this.normalized&&(n=Js(n,this.array)),n}setW(e,n){return this.normalized&&(n=An(n,this.array)),this.array[e*this.itemSize+3]=n,this}setXY(e,n,i){return e*=this.itemSize,this.normalized&&(n=An(n,this.array),i=An(i,this.array)),this.array[e+0]=n,this.array[e+1]=i,this}setXYZ(e,n,i,r){return e*=this.itemSize,this.normalized&&(n=An(n,this.array),i=An(i,this.array),r=An(r,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,n,i,r,s){return e*=this.itemSize,this.normalized&&(n=An(n,this.array),i=An(i,this.array),r=An(r,this.array),s=An(s,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==zd&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var ua=class extends Zn{constructor(e,n,i){super(new Uint16Array(e),n,i)}};var ha=class extends Zn{constructor(e,n,i){super(new Uint32Array(e),n,i)}};var zt=class extends Zn{constructor(e,n,i){super(new Float32Array(e),n,i)}},xS=new Ei,Ko=new D,bd=new D,so=class{constructor(e=new D,n=-1){this.isSphere=!0,this.center=e,this.radius=n}set(e,n){return this.center.copy(e),this.radius=n,this}setFromPoints(e,n){let i=this.center;n!==void 0?i.copy(n):xS.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let n=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=n*n}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,n){let i=this.center.distanceToSquared(e);return n.copy(e),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Ko.subVectors(e,this.center);let n=Ko.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),r=(i-this.radius)*.5;this.center.addScaledVector(Ko,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(bd.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Ko.copy(e.center).add(bd)),this.expandByPoint(Ko.copy(e.center).sub(bd))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},yS=0,oi=new Dt,Ed=new _n,$s=new D,qn=new Ei,Jo=new Ei,nn=new D,Rn=class t extends bi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:yS++}),this.uuid=mo(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Wy(e)?ha:ua)(e,1):this.index=e,this}setIndirect(e,n=0){return this.indirect=e,this.indirectOffset=n,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,n){return this.attributes[e]=n,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,n,i=0){this.groups.push({start:e,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,n){this.drawRange.start=e,this.drawRange.count=n}applyMatrix4(e){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(e),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new Qe().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return oi.makeRotationFromQuaternion(e),this.applyMatrix4(oi),this}rotateX(e){return oi.makeRotationX(e),this.applyMatrix4(oi),this}rotateY(e){return oi.makeRotationY(e),this.applyMatrix4(oi),this}rotateZ(e){return oi.makeRotationZ(e),this.applyMatrix4(oi),this}translate(e,n,i){return oi.makeTranslation(e,n,i),this.applyMatrix4(oi),this}scale(e,n,i){return oi.makeScale(e,n,i),this.applyMatrix4(oi),this}lookAt(e){return Ed.lookAt(e),Ed.updateMatrix(),this.applyMatrix4(Ed.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter($s).negate(),this.translate($s.x,$s.y,$s.z),this}setFromPoints(e){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new zt(i,3))}else{let i=Math.min(e.length,n.count);for(let r=0;r<i;r++){let s=e[r];n.setXYZ(r,s.x,s.y,s.z||0)}e.length>n.count&&ke("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ei);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){We("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new D(-1/0,-1/0,-1/0),new D(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),n)for(let i=0,r=n.length;i<r;i++){let s=n[i];qn.setFromBufferAttribute(s),this.morphTargetsRelative?(nn.addVectors(this.boundingBox.min,qn.min),this.boundingBox.expandByPoint(nn),nn.addVectors(this.boundingBox.max,qn.max),this.boundingBox.expandByPoint(nn)):(this.boundingBox.expandByPoint(qn.min),this.boundingBox.expandByPoint(qn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&We('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new so);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){We("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new D,1/0);return}if(e){let i=this.boundingSphere.center;if(qn.setFromBufferAttribute(e),n)for(let s=0,o=n.length;s<o;s++){let a=n[s];Jo.setFromBufferAttribute(a),this.morphTargetsRelative?(nn.addVectors(qn.min,Jo.min),qn.expandByPoint(nn),nn.addVectors(qn.max,Jo.max),qn.expandByPoint(nn)):(qn.expandByPoint(Jo.min),qn.expandByPoint(Jo.max))}qn.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)nn.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(nn));if(n)for(let s=0,o=n.length;s<o;s++){let a=n[s],l=this.morphTargetsRelative;for(let c=0,d=a.count;c<d;c++)nn.fromBufferAttribute(a,c),l&&($s.fromBufferAttribute(e,c),nn.add($s)),r=Math.max(r,i.distanceToSquared(nn))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&We('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,n=this.attributes;if(e===null||n.position===void 0||n.normal===void 0||n.uv===void 0){We("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,r=n.normal,s=n.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Zn(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let _=0;_<i.count;_++)a[_]=new D,l[_]=new D;let c=new D,d=new D,p=new D,h=new Le,f=new Le,v=new Le,M=new D,g=new D;function u(_,T,I){c.fromBufferAttribute(i,_),d.fromBufferAttribute(i,T),p.fromBufferAttribute(i,I),h.fromBufferAttribute(s,_),f.fromBufferAttribute(s,T),v.fromBufferAttribute(s,I),d.sub(c),p.sub(c),f.sub(h),v.sub(h);let P=1/(f.x*v.y-v.x*f.y);isFinite(P)&&(M.copy(d).multiplyScalar(v.y).addScaledVector(p,-f.y).multiplyScalar(P),g.copy(p).multiplyScalar(f.x).addScaledVector(d,-v.x).multiplyScalar(P),a[_].add(M),a[T].add(M),a[I].add(M),l[_].add(g),l[T].add(g),l[I].add(g))}let m=this.groups;m.length===0&&(m=[{start:0,count:e.count}]);for(let _=0,T=m.length;_<T;++_){let I=m[_],P=I.start,B=I.count;for(let j=P,$=P+B;j<$;j+=3)u(e.getX(j+0),e.getX(j+1),e.getX(j+2))}let x=new D,S=new D,C=new D,b=new D;function R(_){C.fromBufferAttribute(r,_),b.copy(C);let T=a[_];x.copy(T),x.sub(C.multiplyScalar(C.dot(T))).normalize(),S.crossVectors(b,T);let P=S.dot(l[_])<0?-1:1;o.setXYZW(_,x.x,x.y,x.z,P)}for(let _=0,T=m.length;_<T;++_){let I=m[_],P=I.start,B=I.count;for(let j=P,$=P+B;j<$;j+=3)R(e.getX(j+0)),R(e.getX(j+1)),R(e.getX(j+2))}}computeVertexNormals(){let e=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Zn(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let h=0,f=i.count;h<f;h++)i.setXYZ(h,0,0,0);let r=new D,s=new D,o=new D,a=new D,l=new D,c=new D,d=new D,p=new D;if(e)for(let h=0,f=e.count;h<f;h+=3){let v=e.getX(h+0),M=e.getX(h+1),g=e.getX(h+2);r.fromBufferAttribute(n,v),s.fromBufferAttribute(n,M),o.fromBufferAttribute(n,g),d.subVectors(o,s),p.subVectors(r,s),d.cross(p),a.fromBufferAttribute(i,v),l.fromBufferAttribute(i,M),c.fromBufferAttribute(i,g),a.add(d),l.add(d),c.add(d),i.setXYZ(v,a.x,a.y,a.z),i.setXYZ(M,l.x,l.y,l.z),i.setXYZ(g,c.x,c.y,c.z)}else for(let h=0,f=n.count;h<f;h+=3)r.fromBufferAttribute(n,h+0),s.fromBufferAttribute(n,h+1),o.fromBufferAttribute(n,h+2),d.subVectors(o,s),p.subVectors(r,s),d.cross(p),i.setXYZ(h+0,d.x,d.y,d.z),i.setXYZ(h+1,d.x,d.y,d.z),i.setXYZ(h+2,d.x,d.y,d.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let n=0,i=e.count;n<i;n++)nn.fromBufferAttribute(e,n),nn.normalize(),e.setXYZ(n,nn.x,nn.y,nn.z)}toNonIndexed(){function e(a,l){let c=a.array,d=a.itemSize,p=a.normalized,h=new c.constructor(l.length*d),f=0,v=0;for(let M=0,g=l.length;M<g;M++){a.isInterleavedBufferAttribute?f=l[M]*a.data.stride+a.offset:f=l[M]*d;for(let u=0;u<d;u++)h[v++]=c[f++]}return new Zn(h,d,p)}if(this.index===null)return ke("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new t,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],c=e(l,i);n.setAttribute(a,c)}let s=this.morphAttributes;for(let a in s){let l=[],c=s[a];for(let d=0,p=c.length;d<p;d++){let h=c[d],f=e(h,i);l.push(f)}n.morphAttributes[a]=l}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let n=this.index;n!==null&&(e.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];e.data.attributes[l]=c.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],d=[];for(let p=0,h=c.length;p<h;p++){let f=c[p];d.push(f.toJSON(e.data))}d.length>0&&(r[l]=d,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let c in r){let d=r[c];this.setAttribute(c,d.clone(n))}let s=e.morphAttributes;for(let c in s){let d=[],p=s[c];for(let h=0,f=p.length;h<f;h++)d.push(p[h].clone(n));this.morphAttributes[c]=d}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,d=o.length;c<d;c++){let p=o[c];this.addGroup(p.start,p.count,p.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var SS=0,or=class extends bi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:SS++}),this.uuid=mo(),this.name="",this.type="Material",this.blending=gs,this.side=sr,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=ec,this.blendDst=tc,this.blendEquation=Pr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new ct(0,0,0),this.blendAlpha=0,this.depthFunc=_s,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=kd,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ms,this.stencilZFail=ms,this.stencilZPass=ms,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let n in e){let i=e[n];if(i===void 0){ke(`Material: parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){ke(`Material: '${n}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";n&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==gs&&(i.blending=this.blending),this.side!==sr&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==ec&&(i.blendSrc=this.blendSrc),this.blendDst!==tc&&(i.blendDst=this.blendDst),this.blendEquation!==Pr&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==_s&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==kd&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==ms&&(i.stencilFail=this.stencilFail),this.stencilZFail!==ms&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==ms&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(n){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let n=e.clippingPlanes,i=null;if(n!==null){let r=n.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=n[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var ir=new D,Td=new D,zl=new D,Ar=new D,Ad=new D,Vl=new D,Cd=new D,oo=class{constructor(e=new D,n=new D(0,0,-1)){this.origin=e,this.direction=n}set(e,n){return this.origin.copy(e),this.direction.copy(n),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,n){return n.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,ir)),this}closestPointToPoint(e,n){n.subVectors(e,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let n=ir.subVectors(e,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(e):(ir.copy(this.origin).addScaledVector(this.direction,n),ir.distanceToSquared(e))}distanceSqToSegment(e,n,i,r){Td.copy(e).add(n).multiplyScalar(.5),zl.copy(n).sub(e).normalize(),Ar.copy(this.origin).sub(Td);let s=e.distanceTo(n)*.5,o=-this.direction.dot(zl),a=Ar.dot(this.direction),l=-Ar.dot(zl),c=Ar.lengthSq(),d=Math.abs(1-o*o),p,h,f,v;if(d>0)if(p=o*l-a,h=o*a-l,v=s*d,p>=0)if(h>=-v)if(h<=v){let M=1/d;p*=M,h*=M,f=p*(p+o*h+2*a)+h*(o*p+h+2*l)+c}else h=s,p=Math.max(0,-(o*h+a)),f=-p*p+h*(h+2*l)+c;else h=-s,p=Math.max(0,-(o*h+a)),f=-p*p+h*(h+2*l)+c;else h<=-v?(p=Math.max(0,-(-o*s+a)),h=p>0?-s:Math.min(Math.max(-s,-l),s),f=-p*p+h*(h+2*l)+c):h<=v?(p=0,h=Math.min(Math.max(-s,-l),s),f=h*(h+2*l)+c):(p=Math.max(0,-(o*s+a)),h=p>0?s:Math.min(Math.max(-s,-l),s),f=-p*p+h*(h+2*l)+c);else h=o>0?-s:s,p=Math.max(0,-(o*h+a)),f=-p*p+h*(h+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,p),r&&r.copy(Td).addScaledVector(zl,h),f}intersectSphere(e,n){ir.subVectors(e.center,this.origin);let i=ir.dot(this.direction),r=ir.dot(ir)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,n):this.at(a,n)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let n=e.normal.dot(this.direction);if(n===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/n;return i>=0?i:null}intersectPlane(e,n){let i=this.distanceToPlane(e);return i===null?null:this.at(i,n)}intersectsPlane(e){let n=e.distanceToPoint(this.origin);return n===0||e.normal.dot(this.direction)*n<0}intersectBox(e,n){let i,r,s,o,a,l,c=1/this.direction.x,d=1/this.direction.y,p=1/this.direction.z,h=this.origin;return c>=0?(i=(e.min.x-h.x)*c,r=(e.max.x-h.x)*c):(i=(e.max.x-h.x)*c,r=(e.min.x-h.x)*c),d>=0?(s=(e.min.y-h.y)*d,o=(e.max.y-h.y)*d):(s=(e.max.y-h.y)*d,o=(e.min.y-h.y)*d),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),p>=0?(a=(e.min.z-h.z)*p,l=(e.max.z-h.z)*p):(a=(e.max.z-h.z)*p,l=(e.min.z-h.z)*p),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,n)}intersectsBox(e){return this.intersectBox(e,ir)!==null}intersectTriangle(e,n,i,r,s){Ad.subVectors(n,e),Vl.subVectors(i,e),Cd.crossVectors(Ad,Vl);let o=this.direction.dot(Cd),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Ar.subVectors(this.origin,e);let l=a*this.direction.dot(Vl.crossVectors(Ar,Vl));if(l<0)return null;let c=a*this.direction.dot(Ad.cross(Ar));if(c<0||l+c>o)return null;let d=-a*Ar.dot(Cd);return d<0?null:this.at(d/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},da=class extends or{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new ct(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new li,this.combine=$d,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},bg=new Dt,fs=new oo,Gl=new so,Eg=new D,Hl=new D,Wl=new D,Xl=new D,Rd=new D,Yl=new D,Tg=new D,ql=new D,vn=class extends _n{constructor(e=new Rn,n=new da){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,n){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;n.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){Yl.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let d=a[l],p=s[l];d!==0&&(Rd.fromBufferAttribute(p,e),o?Yl.addScaledVector(Rd,d):Yl.addScaledVector(Rd.sub(n),d))}n.add(Yl)}return n}raycast(e,n){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Gl.copy(i.boundingSphere),Gl.applyMatrix4(s),fs.copy(e.ray).recast(e.near),!(Gl.containsPoint(fs.origin)===!1&&(fs.intersectSphere(Gl,Eg)===null||fs.origin.distanceToSquared(Eg)>(e.far-e.near)**2))&&(bg.copy(s).invert(),fs.copy(e.ray).applyMatrix4(bg),!(i.boundingBox!==null&&fs.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,n,fs)))}_computeIntersections(e,n,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,d=s.attributes.uv1,p=s.attributes.normal,h=s.groups,f=s.drawRange;if(a!==null)if(Array.isArray(o))for(let v=0,M=h.length;v<M;v++){let g=h[v],u=o[g.materialIndex],m=Math.max(g.start,f.start),x=Math.min(a.count,Math.min(g.start+g.count,f.start+f.count));for(let S=m,C=x;S<C;S+=3){let b=a.getX(S),R=a.getX(S+1),_=a.getX(S+2);r=Zl(this,u,e,i,c,d,p,b,R,_),r&&(r.faceIndex=Math.floor(S/3),r.face.materialIndex=g.materialIndex,n.push(r))}}else{let v=Math.max(0,f.start),M=Math.min(a.count,f.start+f.count);for(let g=v,u=M;g<u;g+=3){let m=a.getX(g),x=a.getX(g+1),S=a.getX(g+2);r=Zl(this,o,e,i,c,d,p,m,x,S),r&&(r.faceIndex=Math.floor(g/3),n.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let v=0,M=h.length;v<M;v++){let g=h[v],u=o[g.materialIndex],m=Math.max(g.start,f.start),x=Math.min(l.count,Math.min(g.start+g.count,f.start+f.count));for(let S=m,C=x;S<C;S+=3){let b=S,R=S+1,_=S+2;r=Zl(this,u,e,i,c,d,p,b,R,_),r&&(r.faceIndex=Math.floor(S/3),r.face.materialIndex=g.materialIndex,n.push(r))}}else{let v=Math.max(0,f.start),M=Math.min(l.count,f.start+f.count);for(let g=v,u=M;g<u;g+=3){let m=g,x=g+1,S=g+2;r=Zl(this,o,e,i,c,d,p,m,x,S),r&&(r.faceIndex=Math.floor(g/3),n.push(r))}}}};function MS(t,e,n,i,r,s,o,a){let l;if(e.side===Pn?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===sr,a),l===null)return null;ql.copy(a),ql.applyMatrix4(t.matrixWorld);let c=n.ray.origin.distanceTo(ql);return c<n.near||c>n.far?null:{distance:c,point:ql.clone(),object:t}}function Zl(t,e,n,i,r,s,o,a,l,c){t.getVertexPosition(a,Hl),t.getVertexPosition(l,Wl),t.getVertexPosition(c,Xl);let d=MS(t,e,n,i,Hl,Wl,Xl,Tg);if(d){let p=new D;Rr.getBarycoord(Tg,Hl,Wl,Xl,p),r&&(d.uv=Rr.getInterpolatedAttribute(r,a,l,c,p,new Le)),s&&(d.uv1=Rr.getInterpolatedAttribute(s,a,l,c,p,new Le)),o&&(d.normal=Rr.getInterpolatedAttribute(o,a,l,c,p,new D),d.normal.dot(i.direction)>0&&d.normal.multiplyScalar(-1));let h={a,b:l,c,normal:new D,materialIndex:0};Rr.getNormal(Hl,Wl,Xl,h.normal),d.face=h,d.barycoord=p}return d}var gc=class extends Fn{constructor(e=null,n=1,i=1,r,s,o,a,l,c=rn,d=rn,p,h){super(null,o,a,l,c,d,r,s,p,h),this.isDataTexture=!0,this.image={data:e,width:n,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Pd=new D,wS=new D,bS=new Qe,ai=class{constructor(e=new D(1,0,0),n=0){this.isPlane=!0,this.normal=e,this.constant=n}set(e,n){return this.normal.copy(e),this.constant=n,this}setComponents(e,n,i,r){return this.normal.set(e,n,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,n){return this.normal.copy(e),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(e,n,i){let r=Pd.subVectors(i,n).cross(wS.subVectors(e,n)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,n){return n.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,n,i=!0){let r=e.delta(Pd),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?n.copy(e.start):null;let o=-(e.start.dot(this.normal)+this.constant)/s;return i===!0&&(o<0||o>1)?null:n.copy(e.start).addScaledVector(r,o)}intersectsLine(e){let n=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return n<0&&i>0||i<0&&n>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,n){let i=n||bS.getNormalMatrix(e),r=this.coplanarPoint(Pd).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},ps=new so,ES=new Le(.5,.5),$l=new D,ao=class{constructor(e=new ai,n=new ai,i=new ai,r=new ai,s=new ai,o=new ai){this.planes=[e,n,i,r,s,o]}set(e,n,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(n),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,n=Mi,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],c=s[3],d=s[4],p=s[5],h=s[6],f=s[7],v=s[8],M=s[9],g=s[10],u=s[11],m=s[12],x=s[13],S=s[14],C=s[15];if(r[0].setComponents(c-o,f-d,u-v,C-m).normalize(),r[1].setComponents(c+o,f+d,u+v,C+m).normalize(),r[2].setComponents(c+a,f+p,u+M,C+x).normalize(),r[3].setComponents(c-a,f-p,u-M,C-x).normalize(),i)r[4].setComponents(l,h,g,S).normalize(),r[5].setComponents(c-l,f-h,u-g,C-S).normalize();else if(r[4].setComponents(c-l,f-h,u-g,C-S).normalize(),n===Mi)r[5].setComponents(c+l,f+h,u+g,C+S).normalize();else if(n===eo)r[5].setComponents(l,h,g,S).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ps.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let n=e.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),ps.copy(n.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ps)}intersectsSprite(e){ps.center.set(0,0,0);let n=ES.distanceTo(e.center);return ps.radius=.7071067811865476+n,ps.applyMatrix4(e.matrixWorld),this.intersectsSphere(ps)}intersectsSphere(e){let n=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(n[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let n=this.planes;for(let i=0;i<6;i++){let r=n[i];if($l.x=r.normal.x>0?e.max.x:e.min.x,$l.y=r.normal.y>0?e.max.y:e.min.y,$l.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint($l)<0)return!1}return!0}containsPoint(e){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var fa=class extends Fn{constructor(e=[],n=Br,i,r,s,o,a,l,c,d){super(e,n,i,r,s,o,a,l,c,d),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}};var ar=class extends Fn{constructor(e,n,i=Ai,r,s,o,a=rn,l=rn,c,d=Vi,p=1){if(d!==Vi&&d!==zr)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:n,depth:p};super(h,r,s,o,a,l,d,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new io(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let n=super.toJSON(e);return this.compareFunction!==null&&(n.compareFunction=this.compareFunction),n}},_c=class extends ar{constructor(e,n=Ai,i=Br,r,s,o=rn,a=rn,l,c=Vi){let d={width:e,height:e,depth:1},p=[d,d,d,d,d,d];super(e,e,n,i,r,s,o,a,l,c),this.image=p,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},pa=class extends Fn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Ir=class t extends Rn{constructor(e=1,n=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:n,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],c=[],d=[],p=[],h=0,f=0;v("z","y","x",-1,-1,i,n,e,o,s,0),v("z","y","x",1,-1,i,n,-e,o,s,1),v("x","z","y",1,1,e,i,n,r,o,2),v("x","z","y",1,-1,e,i,-n,r,o,3),v("x","y","z",1,-1,e,n,i,r,s,4),v("x","y","z",-1,-1,e,n,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new zt(c,3)),this.setAttribute("normal",new zt(d,3)),this.setAttribute("uv",new zt(p,2));function v(M,g,u,m,x,S,C,b,R,_,T){let I=S/R,P=C/_,B=S/2,j=C/2,$=b/2,z=R+1,Y=_+1,Z=0,ne=0,ce=new D;for(let ue=0;ue<Y;ue++){let Ie=ue*P-j;for(let De=0;De<z;De++){let Ze=De*I-B;ce[M]=Ze*m,ce[g]=Ie*x,ce[u]=$,c.push(ce.x,ce.y,ce.z),ce[M]=0,ce[g]=0,ce[u]=b>0?1:-1,d.push(ce.x,ce.y,ce.z),p.push(De/R),p.push(1-ue/_),Z+=1}}for(let ue=0;ue<_;ue++)for(let Ie=0;Ie<R;Ie++){let De=h+Ie+z*ue,Ze=h+Ie+z*(ue+1),mt=h+(Ie+1)+z*(ue+1),je=h+(Ie+1)+z*ue;l.push(De,Ze,je),l.push(Ze,mt,je),ne+=6}a.addGroup(f,ne,T),f+=ne,h+=Z}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var ma=class t extends Rn{constructor(e=1,n=1,i=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:n,height:i,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};let c=this;r=Math.floor(r),s=Math.floor(s);let d=[],p=[],h=[],f=[],v=0,M=[],g=i/2,u=0;m(),o===!1&&(e>0&&x(!0),n>0&&x(!1)),this.setIndex(d),this.setAttribute("position",new zt(p,3)),this.setAttribute("normal",new zt(h,3)),this.setAttribute("uv",new zt(f,2));function m(){let S=new D,C=new D,b=0,R=(n-e)/i;for(let _=0;_<=s;_++){let T=[],I=_/s,P=I*(n-e)+e;for(let B=0;B<=r;B++){let j=B/r,$=j*l+a,z=Math.sin($),Y=Math.cos($);C.x=P*z,C.y=-I*i+g,C.z=P*Y,p.push(C.x,C.y,C.z),S.set(z,R,Y).normalize(),h.push(S.x,S.y,S.z),f.push(j,1-I),T.push(v++)}M.push(T)}for(let _=0;_<r;_++)for(let T=0;T<s;T++){let I=M[T][_],P=M[T+1][_],B=M[T+1][_+1],j=M[T][_+1];(e>0||T!==0)&&(d.push(I,P,j),b+=3),(n>0||T!==s-1)&&(d.push(P,B,j),b+=3)}c.addGroup(u,b,0),u+=b}function x(S){let C=v,b=new Le,R=new D,_=0,T=S===!0?e:n,I=S===!0?1:-1;for(let B=1;B<=r;B++)p.push(0,g*I,0),h.push(0,I,0),f.push(.5,.5),v++;let P=v;for(let B=0;B<=r;B++){let $=B/r*l+a,z=Math.cos($),Y=Math.sin($);R.x=T*Y,R.y=g*I,R.z=T*z,p.push(R.x,R.y,R.z),h.push(0,I,0),b.x=z*.5+.5,b.y=Y*.5*I+.5,f.push(b.x,b.y),v++}for(let B=0;B<r;B++){let j=C+B,$=P+B;S===!0?d.push($,$+1,j):d.push($+1,$,j),_+=3}c.addGroup(u,_,S===!0?1:2),u+=_}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var ci=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){ke("Curve: .getPoint() not implemented.")}getPointAt(e,n){let i=this.getUtoTmapping(e);return this.getPoint(i,n)}getPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPoint(i/e));return n}getSpacedPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPointAt(i/e));return n}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let n=[],i,r=this.getPoint(0),s=0;n.push(0);for(let o=1;o<=e;o++)i=this.getPoint(o/e),s+=i.distanceTo(r),n.push(s),r=i;return this.cacheArcLengths=n,n}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,n=null){let i=this.getLengths(),r=0,s=i.length,o;n?o=n:o=e*i[s-1];let a=0,l=s-1,c;for(;a<=l;)if(r=Math.floor(a+(l-a)/2),c=i[r]-o,c<0)a=r+1;else if(c>0)l=r-1;else{l=r;break}if(r=l,i[r]===o)return r/(s-1);let d=i[r],h=i[r+1]-d,f=(o-d)/h;return(r+f)/(s-1)}getTangent(e,n){let r=e-1e-4,s=e+1e-4;r<0&&(r=0),s>1&&(s=1);let o=this.getPoint(r),a=this.getPoint(s),l=n||(o.isVector2?new Le:new D);return l.copy(a).sub(o).normalize(),l}getTangentAt(e,n){let i=this.getUtoTmapping(e);return this.getTangent(i,n)}computeFrenetFrames(e,n=!1){let i=new D,r=[],s=[],o=[],a=new D,l=new Dt;for(let f=0;f<=e;f++){let v=f/e;r[f]=this.getTangentAt(v,new D)}s[0]=new D,o[0]=new D;let c=Number.MAX_VALUE,d=Math.abs(r[0].x),p=Math.abs(r[0].y),h=Math.abs(r[0].z);d<=c&&(c=d,i.set(1,0,0)),p<=c&&(c=p,i.set(0,1,0)),h<=c&&i.set(0,0,1),a.crossVectors(r[0],i).normalize(),s[0].crossVectors(r[0],a),o[0].crossVectors(r[0],s[0]);for(let f=1;f<=e;f++){if(s[f]=s[f-1].clone(),o[f]=o[f-1].clone(),a.crossVectors(r[f-1],r[f]),a.length()>Number.EPSILON){a.normalize();let v=Math.acos(it(r[f-1].dot(r[f]),-1,1));s[f].applyMatrix4(l.makeRotationAxis(a,v))}o[f].crossVectors(r[f],s[f])}if(n===!0){let f=Math.acos(it(s[0].dot(s[e]),-1,1));f/=e,r[0].dot(a.crossVectors(s[0],s[e]))>0&&(f=-f);for(let v=1;v<=e;v++)s[v].applyMatrix4(l.makeRotationAxis(r[v],f*v)),o[v].crossVectors(r[v],s[v])}return{tangents:r,normals:s,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},ga=class extends ci{constructor(e=0,n=0,i=1,r=1,s=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=n,this.xRadius=i,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(e,n=new Le){let i=n,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,o=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(o?s=0:s=r),this.aClockwise===!0&&!o&&(s===r?s=-r:s=s-r);let a=this.aStartAngle+e*s,l=this.aX+this.xRadius*Math.cos(a),c=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let d=Math.cos(this.aRotation),p=Math.sin(this.aRotation),h=l-this.aX,f=c-this.aY;l=h*d-f*p+this.aX,c=h*p+f*d+this.aY}return i.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},vc=class extends ga{constructor(e,n,i,r,s,o){super(e,n,i,i,r,s,o),this.isArcCurve=!0,this.type="ArcCurve"}};function pf(){let t=0,e=0,n=0,i=0;function r(s,o,a,l){t=s,e=a,n=-3*s+3*o-2*a-l,i=2*s-2*o+a+l}return{initCatmullRom:function(s,o,a,l,c){r(o,a,c*(a-s),c*(l-o))},initNonuniformCatmullRom:function(s,o,a,l,c,d,p){let h=(o-s)/c-(a-s)/(c+d)+(a-o)/d,f=(a-o)/d-(l-o)/(d+p)+(l-a)/p;h*=d,f*=d,r(o,a,h,f)},calc:function(s){let o=s*s,a=o*s;return t+e*s+n*o+i*a}}}var Ag=new D,Cg=new D,Id=new pf,Ld=new pf,Dd=new pf,lr=class extends ci{constructor(e=[],n=!1,i="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=n,this.curveType=i,this.tension=r}getPoint(e,n=new D){let i=n,r=this.points,s=r.length,o=(s-(this.closed?0:1))*e,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/s)+1)*s:l===0&&a===s-1&&(a=s-2,l=1);let c,d;this.closed||a>0?c=r[(a-1)%s]:(Cg.subVectors(r[0],r[1]).add(r[0]),c=Cg);let p=r[a%s],h=r[(a+1)%s];if(this.closed||a+2<s?d=r[(a+2)%s]:(Ag.subVectors(r[s-1],r[s-2]).add(r[s-1]),d=Ag),this.curveType==="centripetal"||this.curveType==="chordal"){let f=this.curveType==="chordal"?.5:.25,v=Math.pow(c.distanceToSquared(p),f),M=Math.pow(p.distanceToSquared(h),f),g=Math.pow(h.distanceToSquared(d),f);M<1e-4&&(M=1),v<1e-4&&(v=M),g<1e-4&&(g=M),Id.initNonuniformCatmullRom(c.x,p.x,h.x,d.x,v,M,g),Ld.initNonuniformCatmullRom(c.y,p.y,h.y,d.y,v,M,g),Dd.initNonuniformCatmullRom(c.z,p.z,h.z,d.z,v,M,g)}else this.curveType==="catmullrom"&&(Id.initCatmullRom(c.x,p.x,h.x,d.x,this.tension),Ld.initCatmullRom(c.y,p.y,h.y,d.y,this.tension),Dd.initCatmullRom(c.z,p.z,h.z,d.z,this.tension));return i.set(Id.calc(l),Ld.calc(l),Dd.calc(l)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new D().fromArray(r))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function Rg(t,e,n,i,r){let s=(i-e)*.5,o=(r-n)*.5,a=t*t,l=t*a;return(2*n-2*i+s+o)*l+(-3*n+3*i-2*s-o)*a+s*t+n}function TS(t,e){let n=1-t;return n*n*e}function AS(t,e){return 2*(1-t)*t*e}function CS(t,e){return t*t*e}function ta(t,e,n,i){return TS(t,e)+AS(t,n)+CS(t,i)}function RS(t,e){let n=1-t;return n*n*n*e}function PS(t,e){let n=1-t;return 3*n*n*t*e}function IS(t,e){return 3*(1-t)*t*t*e}function LS(t,e){return t*t*t*e}function na(t,e,n,i,r){return RS(t,e)+PS(t,n)+IS(t,i)+LS(t,r)}var xc=class extends ci{constructor(e=new Le,n=new Le,i=new Le,r=new Le){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new Le){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(na(e,r.x,s.x,o.x,a.x),na(e,r.y,s.y,o.y,a.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},yc=class extends ci{constructor(e=new D,n=new D,i=new D,r=new D){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new D){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(na(e,r.x,s.x,o.x,a.x),na(e,r.y,s.y,o.y,a.y),na(e,r.z,s.z,o.z,a.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Sc=class extends ci{constructor(e=new Le,n=new Le){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=n}getPoint(e,n=new Le){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new Le){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Mc=class extends ci{constructor(e=new D,n=new D){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=n}getPoint(e,n=new D){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new D){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},wc=class extends ci{constructor(e=new Le,n=new Le,i=new Le){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new Le){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(ta(e,r.x,s.x,o.x),ta(e,r.y,s.y,o.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},_a=class extends ci{constructor(e=new D,n=new D,i=new D){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new D){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(ta(e,r.x,s.x,o.x),ta(e,r.y,s.y,o.y),ta(e,r.z,s.z,o.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},bc=class extends ci{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,n=new Le){let i=n,r=this.points,s=(r.length-1)*e,o=Math.floor(s),a=s-o,l=r[o===0?o:o-1],c=r[o],d=r[o>r.length-2?r.length-1:o+1],p=r[o>r.length-3?r.length-1:o+2];return i.set(Rg(a,l.x,c.x,d.x,p.x),Rg(a,l.y,c.y,d.y,p.y)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new Le().fromArray(r))}return this}},DS=Object.freeze({__proto__:null,ArcCurve:vc,CatmullRomCurve3:lr,CubicBezierCurve:xc,CubicBezierCurve3:yc,EllipseCurve:ga,LineCurve:Sc,LineCurve3:Mc,QuadraticBezierCurve:wc,QuadraticBezierCurve3:_a,SplineCurve:bc});var vs=class t extends Rn{constructor(e=1,n=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:n,widthSegments:i,heightSegments:r};let s=e/2,o=n/2,a=Math.floor(i),l=Math.floor(r),c=a+1,d=l+1,p=e/a,h=n/l,f=[],v=[],M=[],g=[];for(let u=0;u<d;u++){let m=u*h-o;for(let x=0;x<c;x++){let S=x*p-s;v.push(S,-m,0),M.push(0,0,1),g.push(x/a),g.push(1-u/l)}}for(let u=0;u<l;u++)for(let m=0;m<a;m++){let x=m+c*u,S=m+c*(u+1),C=m+1+c*(u+1),b=m+1+c*u;f.push(x,S,b),f.push(S,C,b)}this.setIndex(f),this.setAttribute("position",new zt(v,3)),this.setAttribute("normal",new zt(M,3)),this.setAttribute("uv",new zt(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.widthSegments,e.heightSegments)}};var lo=class t extends Rn{constructor(e=1,n=32,i=16,r=0,s=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:n,heightSegments:i,phiStart:r,phiLength:s,thetaStart:o,thetaLength:a},n=Math.max(3,Math.floor(n)),i=Math.max(2,Math.floor(i));let l=Math.min(o+a,Math.PI),c=0,d=[],p=new D,h=new D,f=[],v=[],M=[],g=[];for(let u=0;u<=i;u++){let m=[],x=u/i,S=0;u===0&&o===0?S=.5/n:u===i&&l===Math.PI&&(S=-.5/n);for(let C=0;C<=n;C++){let b=C/n;p.x=-e*Math.cos(r+b*s)*Math.sin(o+x*a),p.y=e*Math.cos(o+x*a),p.z=e*Math.sin(r+b*s)*Math.sin(o+x*a),v.push(p.x,p.y,p.z),h.copy(p).normalize(),M.push(h.x,h.y,h.z),g.push(b+S,1-x),m.push(c++)}d.push(m)}for(let u=0;u<i;u++)for(let m=0;m<n;m++){let x=d[u][m+1],S=d[u][m],C=d[u+1][m],b=d[u+1][m+1];(u!==0||o>0)&&f.push(x,S,b),(u!==i-1||l<Math.PI)&&f.push(S,C,b)}this.setIndex(f),this.setAttribute("position",new zt(v,3)),this.setAttribute("normal",new zt(M,3)),this.setAttribute("uv",new zt(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var va=class t extends Rn{constructor(e=new _a(new D(-1,-1,0),new D(-1,1,0),new D(1,1,0)),n=64,i=1,r=8,s=!1){super(),this.type="TubeGeometry",this.parameters={path:e,tubularSegments:n,radius:i,radialSegments:r,closed:s};let o=e.computeFrenetFrames(n,s);this.tangents=o.tangents,this.normals=o.normals,this.binormals=o.binormals;let a=new D,l=new D,c=new Le,d=new D,p=[],h=[],f=[],v=[];M(),this.setIndex(v),this.setAttribute("position",new zt(p,3)),this.setAttribute("normal",new zt(h,3)),this.setAttribute("uv",new zt(f,2));function M(){for(let x=0;x<n;x++)g(x);g(s===!1?n:0),m(),u()}function g(x){d=e.getPointAt(x/n,d);let S=o.normals[x],C=o.binormals[x];for(let b=0;b<=r;b++){let R=b/r*Math.PI*2,_=Math.sin(R),T=-Math.cos(R);l.x=T*S.x+_*C.x,l.y=T*S.y+_*C.y,l.z=T*S.z+_*C.z,l.normalize(),h.push(l.x,l.y,l.z),a.x=d.x+i*l.x,a.y=d.y+i*l.y,a.z=d.z+i*l.z,p.push(a.x,a.y,a.z)}}function u(){for(let x=1;x<=n;x++)for(let S=1;S<=r;S++){let C=(r+1)*(x-1)+(S-1),b=(r+1)*x+(S-1),R=(r+1)*x+S,_=(r+1)*(x-1)+S;v.push(C,b,_),v.push(b,R,_)}}function m(){for(let x=0;x<=n;x++)for(let S=0;S<=r;S++)c.x=x/n,c.y=S/r,f.push(c.x,c.y)}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON();return e.path=this.parameters.path.toJSON(),e}static fromJSON(e){return new t(new DS[e.path.type]().fromJSON(e.path),e.tubularSegments,e.radius,e.radialSegments,e.closed)}};var xa=class extends or{constructor(e){super(),this.isShadowMaterial=!0,this.type="ShadowMaterial",this.color=new ct(0),this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.fog=e.fog,this}};function Ss(t){let e={};for(let n in t){e[n]={};for(let i in t[n]){let r=t[n][i];if(Pg(r))r.isRenderTargetTexture?(ke("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[n][i]=null):e[n][i]=r.clone();else if(Array.isArray(r))if(Pg(r[0])){let s=[];for(let o=0,a=r.length;o<a;o++)s[o]=r[o].clone();e[n][i]=s}else e[n][i]=r.slice();else e[n][i]=r}}return e}function xn(t){let e={};for(let n=0;n<t.length;n++){let i=Ss(t[n]);for(let r in i)e[r]=i[r]}return e}function Pg(t){return t&&(t.isColor||t.isMatrix3||t.isMatrix4||t.isVector2||t.isVector3||t.isVector4||t.isTexture||t.isQuaternion)}function NS(t){let e=[];for(let n=0;n<t.length;n++)e.push(t[n].clone());return e}function mf(t){let e=t.getRenderTarget();return e===null?t.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:lt.workingColorSpace}var v0={clone:Ss,merge:xn},US=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,FS=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,jn=class extends or{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=US,this.fragmentShader=FS,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Ss(e.uniforms),this.uniformsGroups=NS(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let n=super.toJSON(e);n.glslVersion=this.glslVersion,n.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?n.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?n.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?n.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?n.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?n.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?n.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?n.uniforms[r]={type:"m4",value:o.toArray()}:n.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}},Ec=class extends jn{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},ya=class extends or{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new ct(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new ct(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Au,this.normalScale=new Le(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new li,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var Tc=class extends or{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=s0,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Ac=class extends or{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function jl(t,e){return!t||t.constructor===e?t:typeof e.BYTES_PER_ELEMENT=="number"?new e(t):Array.prototype.slice.call(t)}var Lr=class{constructor(e,n,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let n=this.parameterPositions,i=this._cachedIndex,r=n[i],s=n[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=n[++i],e<r)break t}o=n.length;break n}if(!(e>=s)){let a=n[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=n[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<n[a]?o=a:i=a+1}if(r=n[i],s=n[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let n=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)n[o]=i[s+o];return n}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Cc=class extends Lr{constructor(e,n,i,r){super(e,n,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Fd,endingEnd:Fd}}intervalChanged_(e,n,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case Od:s=e,a=2*n-i;break;case Bd:s=r.length-2,a=n+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case Od:o=e,l=2*i-n;break;case Bd:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=n}let c=(i-n)*.5,d=this.valueSize;this._weightPrev=c/(n-a),this._weightNext=c/(l-i),this._offsetPrev=s*d,this._offsetNext=o*d}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this._offsetPrev,p=this._offsetNext,h=this._weightPrev,f=this._weightNext,v=(i-n)/(r-n),M=v*v,g=M*v,u=-h*g+2*h*M-h*v,m=(1+h)*g+(-1.5-2*h)*M+(-.5+h)*v+1,x=(-1-f)*g+(1.5+f)*M+.5*v,S=f*g-f*M;for(let C=0;C!==a;++C)s[C]=u*o[d+C]+m*o[c+C]+x*o[l+C]+S*o[p+C];return s}},Rc=class extends Lr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=(i-n)/(r-n),p=1-d;for(let h=0;h!==a;++h)s[h]=o[c+h]*p+o[l+h]*d;return s}},Pc=class extends Lr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},Ic=class extends Lr{interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this.settings||this.DefaultSettings_,p=d.inTangents,h=d.outTangents;if(!p||!h){let M=(i-n)/(r-n),g=1-M;for(let u=0;u!==a;++u)s[u]=o[c+u]*g+o[l+u]*M;return s}let f=a*2,v=e-1;for(let M=0;M!==a;++M){let g=o[c+M],u=o[l+M],m=v*f+M*2,x=h[m],S=h[m+1],C=e*f+M*2,b=p[C],R=p[C+1],_=(i-n)/(r-n),T,I,P,B,j;for(let $=0;$<8;$++){T=_*_,I=T*_,P=1-_,B=P*P,j=B*P;let Y=j*n+3*B*_*x+3*P*T*b+I*r-i;if(Math.abs(Y)<1e-10)break;let Z=3*B*(x-n)+6*P*_*(b-x)+3*T*(r-b);if(Math.abs(Z)<1e-10)break;_=_-Y/Z,_=Math.max(0,Math.min(1,_))}s[M]=j*g+3*B*_*S+3*P*T*R+I*u}return s}},Kn=class{constructor(e,n,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=jl(n,this.TimeBufferType),this.values=jl(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let n=e.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(e);else{i={name:e.name,times:jl(e.times,Array),values:jl(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new Pc(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Rc(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Cc(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let n=new Ic(this.times,this.values,this.getValueSize(),e);return this.settings&&(n.settings=this.settings),n}setInterpolation(e){let n;switch(e){case ia:n=this.InterpolantFactoryMethodDiscrete;break;case hc:n=this.InterpolantFactoryMethodLinear;break;case Ql:n=this.InterpolantFactoryMethodSmooth;break;case Ud:n=this.InterpolantFactoryMethodBezier;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return ke("KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return ia;case this.InterpolantFactoryMethodLinear:return hc;case this.InterpolantFactoryMethodSmooth:return Ql;case this.InterpolantFactoryMethodBezier:return Ud}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]+=e}return this}scale(e){if(e!==1){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]*=e}return this}trim(e,n){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>n;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(We("KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(We("KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){We("KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){We("KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&Xy(r))for(let a=0,l=r.length;a!==l;++a){let c=r[a];if(isNaN(c)){We("KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===Ql,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,c=e[a],d=e[a+1];if(c!==d&&(a!==1||c!==e[0]))if(r)l=!0;else{let p=a*i,h=p-i,f=p+i;for(let v=0;v!==i;++v){let M=n[p+v];if(M!==n[h+v]||M!==n[f+v]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let p=a*i,h=o*i;for(let f=0;f!==i;++f)n[h+f]=n[p+f]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,c=0;c!==i;++c)n[l+c]=n[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=n.slice(0,o*i)):(this.times=e,this.values=n),this}clone(){let e=this.times.slice(),n=this.values.slice(),i=this.constructor,r=new i(this.name,e,n);return r.createInterpolant=this.createInterpolant,r}};Kn.prototype.ValueTypeName="";Kn.prototype.TimeBufferType=Float32Array;Kn.prototype.ValueBufferType=Float32Array;Kn.prototype.DefaultInterpolation=hc;var Dr=class extends Kn{constructor(e,n,i){super(e,n,i)}};Dr.prototype.ValueTypeName="bool";Dr.prototype.ValueBufferType=Array;Dr.prototype.DefaultInterpolation=ia;Dr.prototype.InterpolantFactoryMethodLinear=void 0;Dr.prototype.InterpolantFactoryMethodSmooth=void 0;var Lc=class extends Kn{constructor(e,n,i,r){super(e,n,i,r)}};Lc.prototype.ValueTypeName="color";var Dc=class extends Kn{constructor(e,n,i,r){super(e,n,i,r)}};Dc.prototype.ValueTypeName="number";var Nc=class extends Lr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-n)/(r-n),c=e*a;for(let d=c+a;c!==d;c+=4)ln.slerpFlat(s,0,o,c-a,o,c,l);return s}},Sa=class extends Kn{constructor(e,n,i,r){super(e,n,i,r)}InterpolantFactoryMethodLinear(e){return new Nc(this.times,this.values,this.getValueSize(),e)}};Sa.prototype.ValueTypeName="quaternion";Sa.prototype.InterpolantFactoryMethodSmooth=void 0;var Nr=class extends Kn{constructor(e,n,i){super(e,n,i)}};Nr.prototype.ValueTypeName="string";Nr.prototype.ValueBufferType=Array;Nr.prototype.DefaultInterpolation=ia;Nr.prototype.InterpolantFactoryMethodLinear=void 0;Nr.prototype.InterpolantFactoryMethodSmooth=void 0;var Uc=class extends Kn{constructor(e,n,i,r){super(e,n,i,r)}};Uc.prototype.ValueTypeName="vector";var Fc=class{constructor(e,n,i){let r=this,s=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=n,this.onError=i,this._abortController=null,this.itemStart=function(d){a++,s===!1&&r.onStart!==void 0&&r.onStart(d,o,a),s=!0},this.itemEnd=function(d){o++,r.onProgress!==void 0&&r.onProgress(d,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(d){r.onError!==void 0&&r.onError(d)},this.resolveURL=function(d){return l?l(d):d},this.setURLModifier=function(d){return l=d,this},this.addHandler=function(d,p){return c.push(d,p),this},this.removeHandler=function(d){let p=c.indexOf(d);return p!==-1&&c.splice(p,2),this},this.getHandler=function(d){for(let p=0,h=c.length;p<h;p+=2){let f=c[p],v=c[p+1];if(f.global&&(f.lastIndex=0),f.test(d))return v}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},x0=new Fc,Oc=class{constructor(e){this.manager=e!==void 0?e:x0,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,n){let i=this;return new Promise(function(r,s){i.load(e,r,n,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Oc.DEFAULT_MATERIAL_NAME="__DEFAULT";var Ma=class extends _n{constructor(e,n=1){super(),this.isLight=!0,this.type="Light",this.color=new ct(e),this.intensity=n}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,n){return super.copy(e,n),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let n=super.toJSON(e);return n.object.color=this.color.getHex(),n.object.intensity=this.intensity,n}},wa=class extends Ma{constructor(e,n,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(_n.DEFAULT_UP),this.updateMatrix(),this.groundColor=new ct(n)}copy(e,n){return super.copy(e,n),this.groundColor.copy(e.groundColor),this}toJSON(e){let n=super.toJSON(e);return n.object.groundColor=this.groundColor.getHex(),n}},Nd=new Dt,Ig=new D,Lg=new D,Vd=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Le(512,512),this.mapType=On,this.map=null,this.mapPass=null,this.matrix=new Dt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ao,this._frameExtents=new Le(1,1),this._viewportCount=1,this._viewports=[new Vt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let n=this.camera,i=this.matrix;Ig.setFromMatrixPosition(e.matrixWorld),n.position.copy(Ig),Lg.setFromMatrixPosition(e.target.matrixWorld),n.lookAt(Lg),n.updateMatrixWorld(),Nd.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Nd,n.coordinateSystem,n.reversedDepth),n.coordinateSystem===eo||n.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(Nd)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},Kl=new D,Jl=new ln,ki=new D,ba=class extends _n{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Dt,this.projectionMatrix=new Dt,this.projectionMatrixInverse=new Dt,this.coordinateSystem=Mi,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,n){return super.copy(e,n),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(Kl,Jl,ki),ki.x===1&&ki.y===1&&ki.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Kl,Jl,ki.set(1,1,1)).invert()}updateWorldMatrix(e,n){super.updateWorldMatrix(e,n),this.matrixWorld.decompose(Kl,Jl,ki),ki.x===1&&ki.y===1&&ki.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Kl,Jl,ki.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Cr=new D,Dg=new Le,Ng=new Le,gn=class extends ba{constructor(e=50,n=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let n=.5*this.getFilmHeight()/e;this.fov=no*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Qo*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return no*2*Math.atan(Math.tan(Qo*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,n,i){Cr.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Cr.x,Cr.y).multiplyScalar(-e/Cr.z),Cr.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Cr.x,Cr.y).multiplyScalar(-e/Cr.z)}getViewSize(e,n){return this.getViewBounds(e,Dg,Ng),n.subVectors(Ng,Dg)}setViewOffset(e,n,i,r,s,o){this.aspect=e/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,n=e*Math.tan(Qo*.5*this.fov)/this.zoom,i=2*n,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,n-=o.offsetY*i/c,r*=o.width/l,i*=o.height/c}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,n,n-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}};var co=class extends ba{constructor(e=-1,n=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=n,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,n,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+n,l=r-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,d=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=d*this.view.offsetY,l=a-d*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}},Gd=class extends Vd{constructor(){super(new co(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},uo=class extends Ma{constructor(e,n){super(e,n),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(_n.DEFAULT_UP),this.updateMatrix(),this.target=new _n,this.shadow=new Gd}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let n=super.toJSON(e);return n.object.shadow=this.shadow.toJSON(),n.object.target=this.target.uuid,n}};var js=-90,Ks=1,Bc=class extends _n{constructor(e,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new gn(js,Ks,e,n);r.layers=this.layers,this.add(r);let s=new gn(js,Ks,e,n);s.layers=this.layers,this.add(s);let o=new gn(js,Ks,e,n);o.layers=this.layers,this.add(o);let a=new gn(js,Ks,e,n);a.layers=this.layers,this.add(a);let l=new gn(js,Ks,e,n);l.layers=this.layers,this.add(l);let c=new gn(js,Ks,e,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,n=this.children.concat(),[i,r,s,o,a,l]=n;for(let c of n)this.remove(c);if(e===Mi)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===eo)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of n)this.add(c),c.updateMatrixWorld()}update(e,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,c,d]=this.children,p=e.getRenderTarget(),h=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),v=e.xr.enabled;e.xr.enabled=!1;let M=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let g=!1;e.isWebGLRenderer===!0?g=e.state.buffers.depth.getReversed():g=e.reversedDepthBuffer,e.setRenderTarget(i,0,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,s),e.setRenderTarget(i,1,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,o),e.setRenderTarget(i,2,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,a),e.setRenderTarget(i,3,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,l),e.setRenderTarget(i,4,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,c),i.texture.generateMipmaps=M,e.setRenderTarget(i,5,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,d),e.setRenderTarget(p,h,f),e.xr.enabled=v,i.texture.needsPMREMUpdate=!0}},kc=class extends gn{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var gf="\\[\\]\\.:\\/",OS=new RegExp("["+gf+"]","g"),_f="[^"+gf+"]",BS="[^"+gf.replace("\\.","")+"]",kS=/((?:WC+[\/:])*)/.source.replace("WC",_f),zS=/(WCOD+)?/.source.replace("WCOD",BS),VS=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",_f),GS=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",_f),HS=new RegExp("^"+kS+zS+VS+GS+"$"),WS=["material","materials","bones","map"],Hd=class{constructor(e,n,i){let r=i||Lt.parseTrackName(n);this._targetGroup=e,this._bindings=e.subscribe_(n,r)}getValue(e,n){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,n)}setValue(e,n){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,n)}bind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].bind()}unbind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].unbind()}},Lt=class t{constructor(e,n,i){this.path=n,this.parsedPath=i||t.parseTrackName(n),this.node=t.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,n,i){return e&&e.isAnimationObjectGroup?new t.Composite(e,n,i):new t(e,n,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(OS,"")}static parseTrackName(e){let n=HS.exec(e);if(n===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);WS.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,n){if(n===void 0||n===""||n==="."||n===-1||n===e.name||n===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(n);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===n||a.uuid===n)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,n){e[n]=this.targetObject[this.propertyName]}_getValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[n++]=i[r]}_getValue_arrayElement(e,n){e[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,n){this.resolvedProperty.toArray(e,n)}_setValue_direct(e,n){this.targetObject[this.propertyName]=e[n]}_setValue_direct_setNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++]}_setValue_array_setNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,n){this.resolvedProperty[this.propertyIndex]=e[n]}_setValue_arrayElement_setNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,n){this.resolvedProperty.fromArray(e,n)}_setValue_fromArray_setNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,n){this.bind(),this.getValue(e,n)}_setValue_unbound(e,n){this.bind(),this.setValue(e,n)}bind(){let e=this.node,n=this.parsedPath,i=n.objectName,r=n.propertyName,s=n.propertyIndex;if(e||(e=t.findNode(this.rootNode,n.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){ke("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!e.material){We("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){We("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){We("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let d=0;d<e.length;d++)if(e[d].name===c){c=d;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){We("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){We("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){We("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){We("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[r];if(o===void 0){let c=n.nodeName;We("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){We("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){We("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};Lt.Composite=Hd;Lt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};Lt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};Lt.prototype.GetterByBindingType=[Lt.prototype._getValue_direct,Lt.prototype._getValue_array,Lt.prototype._getValue_arrayElement,Lt.prototype._getValue_toArray];Lt.prototype.SetterByBindingTypeAndVersioning=[[Lt.prototype._setValue_direct,Lt.prototype._setValue_direct_setNeedsUpdate,Lt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Lt.prototype._setValue_array,Lt.prototype._setValue_array_setNeedsUpdate,Lt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Lt.prototype._setValue_arrayElement,Lt.prototype._setValue_arrayElement_setNeedsUpdate,Lt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Lt.prototype._setValue_fromArray,Lt.prototype._setValue_fromArray_setNeedsUpdate,Lt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var wC=new Float32Array(1);var Ur=class{constructor(e=1,n=0,i=0){this.radius=e,this.phi=n,this.theta=i}set(e,n,i){return this.radius=e,this.phi=n,this.theta=i,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=it(this.phi,1e-6,Math.PI-1e-6),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,n,i){return this.radius=Math.sqrt(e*e+n*n+i*i),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,i),this.phi=Math.acos(it(n/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}};var wf=class wf{constructor(e,n,i,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,n,i,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,n=0){for(let i=0;i<4;i++)this.elements[i]=e[i+n];return this}set(e,n,i,r){let s=this.elements;return s[0]=e,s[2]=n,s[1]=i,s[3]=r,this}};wf.prototype.isMatrix2=!0;var Wd=wf;var Ea=class extends bi{constructor(e,n=null){super(),this.object=e,this.domElement=n,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(e){if(e===void 0){ke("Controls: connect() now requires an element.");return}this.domElement!==null&&this.disconnect(),this.domElement=e}disconnect(){}dispose(){}update(){}};function vf(t,e,n,i){let r=XS(i);switch(n){case lf:return t*e;case uf:return t*e/r.components*r.byteLength;case Zc:return t*e/r.components*r.byteLength;case Vr:return t*e*2/r.components*r.byteLength;case $c:return t*e*2/r.components*r.byteLength;case cf:return t*e*3/r.components*r.byteLength;case ui:return t*e*4/r.components*r.byteLength;case jc:return t*e*4/r.components*r.byteLength;case Ra:case Pa:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case Ia:case La:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Jc:case eu:return Math.max(t,16)*Math.max(e,8)/4;case Kc:case Qc:return Math.max(t,8)*Math.max(e,8)/2;case tu:case nu:case ru:case su:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case iu:case Da:case ou:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case au:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case lu:return Math.floor((t+4)/5)*Math.floor((e+3)/4)*16;case cu:return Math.floor((t+4)/5)*Math.floor((e+4)/5)*16;case uu:return Math.floor((t+5)/6)*Math.floor((e+4)/5)*16;case hu:return Math.floor((t+5)/6)*Math.floor((e+5)/6)*16;case du:return Math.floor((t+7)/8)*Math.floor((e+4)/5)*16;case fu:return Math.floor((t+7)/8)*Math.floor((e+5)/6)*16;case pu:return Math.floor((t+7)/8)*Math.floor((e+7)/8)*16;case mu:return Math.floor((t+9)/10)*Math.floor((e+4)/5)*16;case gu:return Math.floor((t+9)/10)*Math.floor((e+5)/6)*16;case _u:return Math.floor((t+9)/10)*Math.floor((e+7)/8)*16;case vu:return Math.floor((t+9)/10)*Math.floor((e+9)/10)*16;case xu:return Math.floor((t+11)/12)*Math.floor((e+9)/10)*16;case yu:return Math.floor((t+11)/12)*Math.floor((e+11)/12)*16;case Su:case Mu:case wu:return Math.ceil(t/4)*Math.ceil(e/4)*16;case bu:case Eu:return Math.ceil(t/4)*Math.ceil(e/4)*8;case Na:case Tu:return Math.ceil(t/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function XS(t){switch(t){case On:case rf:return{byteLength:1,components:1};case fo:case sf:case Hi:return{byteLength:2,components:1};case Yc:case qc:return{byteLength:2,components:4};case Ai:case Xc:case Ci:return{byteLength:4,components:1};case of:case af:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${t}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Vc}}));typeof window<"u"&&(window.__THREE__?ke("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Vc);function G0(){let t=null,e=!1,n=null,i=null;function r(s,o){n(s,o),i=t.requestAnimationFrame(r)}return{start:function(){e!==!0&&n!==null&&t!==null&&(i=t.requestAnimationFrame(r),e=!0)},stop:function(){t!==null&&t.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){n=s},setContext:function(s){t=s}}}function YS(t){let e=new WeakMap;function n(a,l){let c=a.array,d=a.usage,p=c.byteLength,h=t.createBuffer();t.bindBuffer(l,h),t.bufferData(l,c,d),a.onUploadCallback();let f;if(c instanceof Float32Array)f=t.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)f=t.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?f=t.HALF_FLOAT:f=t.UNSIGNED_SHORT;else if(c instanceof Int16Array)f=t.SHORT;else if(c instanceof Uint32Array)f=t.UNSIGNED_INT;else if(c instanceof Int32Array)f=t.INT;else if(c instanceof Int8Array)f=t.BYTE;else if(c instanceof Uint8Array)f=t.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)f=t.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:h,type:f,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:p}}function i(a,l,c){let d=l.array,p=l.updateRanges;if(t.bindBuffer(c,a),p.length===0)t.bufferSubData(c,0,d);else{p.sort((f,v)=>f.start-v.start);let h=0;for(let f=1;f<p.length;f++){let v=p[h],M=p[f];M.start<=v.start+v.count+1?v.count=Math.max(v.count,M.start+M.count-v.start):(++h,p[h]=M)}p.length=h+1;for(let f=0,v=p.length;f<v;f++){let M=p[f];t.bufferSubData(c,M.start*d.BYTES_PER_ELEMENT,d,M.start,M.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(t.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let d=e.get(a);(!d||d.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=e.get(a);if(c===void 0)e.set(a,n(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}var qS=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,ZS=`#ifdef USE_ALPHAHASH
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
#endif`,$S=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,jS=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,KS=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,JS=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,QS=`#ifdef USE_AOMAP
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
#endif`,eM=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,tM=`#ifdef USE_BATCHING
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
#endif`,nM=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,iM=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,rM=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,sM=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,oM=`#ifdef USE_IRIDESCENCE
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
#endif`,aM=`#ifdef USE_BUMPMAP
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
#endif`,lM=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,cM=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,uM=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,hM=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,dM=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,fM=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,pM=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,mM=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,gM=`#define PI 3.141592653589793
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
} // validated`,_M=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,vM=`vec3 transformedNormal = objectNormal;
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
#endif`,xM=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,yM=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,SM=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,MM=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,wM="gl_FragColor = linearToOutputTexel( gl_FragColor );",bM=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,EM=`#ifdef USE_ENVMAP
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
#endif`,TM=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,AM=`#ifdef USE_ENVMAP
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
#endif`,CM=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,RM=`#ifdef USE_ENVMAP
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
#endif`,PM=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,IM=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,LM=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,DM=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,NM=`#ifdef USE_GRADIENTMAP
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
}`,UM=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,FM=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,OM=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,BM=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,kM=`#ifdef USE_ENVMAP
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
#endif`,zM=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,VM=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,GM=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,HM=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,WM=`PhysicalMaterial material;
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
#endif`,XM=`uniform sampler2D dfgLUT;
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
}`,YM=`
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
#endif`,qM=`#if defined( RE_IndirectDiffuse )
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
#endif`,ZM=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,$M=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,jM=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,KM=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,JM=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,QM=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,e1=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,t1=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,n1=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,i1=`#if defined( USE_POINTS_UV )
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
#endif`,r1=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,s1=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,o1=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,a1=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,l1=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,c1=`#ifdef USE_MORPHTARGETS
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
#endif`,u1=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,h1=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,d1=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,f1=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,p1=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,m1=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,g1=`#ifdef USE_NORMALMAP
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
#endif`,_1=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,v1=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,x1=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,y1=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,S1=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,M1=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,w1=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,b1=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,E1=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,T1=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,A1=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,C1=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,R1=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,P1=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,I1=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,L1=`float getShadowMask() {
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
}`,D1=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,N1=`#ifdef USE_SKINNING
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
#endif`,U1=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,F1=`#ifdef USE_SKINNING
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
#endif`,O1=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,B1=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,k1=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,z1=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,V1=`#ifdef USE_TRANSMISSION
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
#endif`,G1=`#ifdef USE_TRANSMISSION
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
#endif`,H1=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,W1=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,X1=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Y1=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,q1=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Z1=`uniform sampler2D t2D;
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
}`,$1=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,j1=`#ifdef ENVMAP_TYPE_CUBE
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
}`,K1=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,J1=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Q1=`#include <common>
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
}`,ew=`#if DEPTH_PACKING == 3200
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
}`,tw=`#define DISTANCE
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
}`,nw=`#define DISTANCE
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
}`,iw=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,rw=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,sw=`uniform float scale;
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
}`,ow=`uniform vec3 diffuse;
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
}`,aw=`#include <common>
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
}`,lw=`uniform vec3 diffuse;
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
}`,cw=`#define LAMBERT
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
}`,uw=`#define LAMBERT
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
}`,hw=`#define MATCAP
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
}`,dw=`#define MATCAP
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
}`,fw=`#define NORMAL
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
}`,pw=`#define NORMAL
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
}`,mw=`#define PHONG
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
}`,gw=`#define PHONG
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
}`,_w=`#define STANDARD
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
}`,vw=`#define STANDARD
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
}`,xw=`#define TOON
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
}`,yw=`#define TOON
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
}`,Sw=`uniform float size;
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
}`,Mw=`uniform vec3 diffuse;
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
}`,ww=`#include <common>
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
}`,bw=`uniform vec3 color;
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
}`,Ew=`uniform float rotation;
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
}`,Tw=`uniform vec3 diffuse;
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
}`,rt={alphahash_fragment:qS,alphahash_pars_fragment:ZS,alphamap_fragment:$S,alphamap_pars_fragment:jS,alphatest_fragment:KS,alphatest_pars_fragment:JS,aomap_fragment:QS,aomap_pars_fragment:eM,batching_pars_vertex:tM,batching_vertex:nM,begin_vertex:iM,beginnormal_vertex:rM,bsdfs:sM,iridescence_fragment:oM,bumpmap_pars_fragment:aM,clipping_planes_fragment:lM,clipping_planes_pars_fragment:cM,clipping_planes_pars_vertex:uM,clipping_planes_vertex:hM,color_fragment:dM,color_pars_fragment:fM,color_pars_vertex:pM,color_vertex:mM,common:gM,cube_uv_reflection_fragment:_M,defaultnormal_vertex:vM,displacementmap_pars_vertex:xM,displacementmap_vertex:yM,emissivemap_fragment:SM,emissivemap_pars_fragment:MM,colorspace_fragment:wM,colorspace_pars_fragment:bM,envmap_fragment:EM,envmap_common_pars_fragment:TM,envmap_pars_fragment:AM,envmap_pars_vertex:CM,envmap_physical_pars_fragment:kM,envmap_vertex:RM,fog_vertex:PM,fog_pars_vertex:IM,fog_fragment:LM,fog_pars_fragment:DM,gradientmap_pars_fragment:NM,lightmap_pars_fragment:UM,lights_lambert_fragment:FM,lights_lambert_pars_fragment:OM,lights_pars_begin:BM,lights_toon_fragment:zM,lights_toon_pars_fragment:VM,lights_phong_fragment:GM,lights_phong_pars_fragment:HM,lights_physical_fragment:WM,lights_physical_pars_fragment:XM,lights_fragment_begin:YM,lights_fragment_maps:qM,lights_fragment_end:ZM,lightprobes_pars_fragment:$M,logdepthbuf_fragment:jM,logdepthbuf_pars_fragment:KM,logdepthbuf_pars_vertex:JM,logdepthbuf_vertex:QM,map_fragment:e1,map_pars_fragment:t1,map_particle_fragment:n1,map_particle_pars_fragment:i1,metalnessmap_fragment:r1,metalnessmap_pars_fragment:s1,morphinstance_vertex:o1,morphcolor_vertex:a1,morphnormal_vertex:l1,morphtarget_pars_vertex:c1,morphtarget_vertex:u1,normal_fragment_begin:h1,normal_fragment_maps:d1,normal_pars_fragment:f1,normal_pars_vertex:p1,normal_vertex:m1,normalmap_pars_fragment:g1,clearcoat_normal_fragment_begin:_1,clearcoat_normal_fragment_maps:v1,clearcoat_pars_fragment:x1,iridescence_pars_fragment:y1,opaque_fragment:S1,packing:M1,premultiplied_alpha_fragment:w1,project_vertex:b1,dithering_fragment:E1,dithering_pars_fragment:T1,roughnessmap_fragment:A1,roughnessmap_pars_fragment:C1,shadowmap_pars_fragment:R1,shadowmap_pars_vertex:P1,shadowmap_vertex:I1,shadowmask_pars_fragment:L1,skinbase_vertex:D1,skinning_pars_vertex:N1,skinning_vertex:U1,skinnormal_vertex:F1,specularmap_fragment:O1,specularmap_pars_fragment:B1,tonemapping_fragment:k1,tonemapping_pars_fragment:z1,transmission_fragment:V1,transmission_pars_fragment:G1,uv_pars_fragment:H1,uv_pars_vertex:W1,uv_vertex:X1,worldpos_vertex:Y1,background_vert:q1,background_frag:Z1,backgroundCube_vert:$1,backgroundCube_frag:j1,cube_vert:K1,cube_frag:J1,depth_vert:Q1,depth_frag:ew,distance_vert:tw,distance_frag:nw,equirect_vert:iw,equirect_frag:rw,linedashed_vert:sw,linedashed_frag:ow,meshbasic_vert:aw,meshbasic_frag:lw,meshlambert_vert:cw,meshlambert_frag:uw,meshmatcap_vert:hw,meshmatcap_frag:dw,meshnormal_vert:fw,meshnormal_frag:pw,meshphong_vert:mw,meshphong_frag:gw,meshphysical_vert:_w,meshphysical_frag:vw,meshtoon_vert:xw,meshtoon_frag:yw,points_vert:Sw,points_frag:Mw,shadow_vert:ww,shadow_frag:bw,sprite_vert:Ew,sprite_frag:Tw},Se={common:{diffuse:{value:new ct(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Qe},alphaMap:{value:null},alphaMapTransform:{value:new Qe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Qe}},envmap:{envMap:{value:null},envMapRotation:{value:new Qe},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Qe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Qe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Qe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Qe},normalScale:{value:new Le(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Qe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Qe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Qe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Qe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new ct(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new D},probesMax:{value:new D},probesResolution:{value:new D}},points:{diffuse:{value:new ct(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Qe},alphaTest:{value:0},uvTransform:{value:new Qe}},sprite:{diffuse:{value:new ct(16777215)},opacity:{value:1},center:{value:new Le(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Qe},alphaMap:{value:null},alphaMapTransform:{value:new Qe},alphaTest:{value:0}}},Xi={basic:{uniforms:xn([Se.common,Se.specularmap,Se.envmap,Se.aomap,Se.lightmap,Se.fog]),vertexShader:rt.meshbasic_vert,fragmentShader:rt.meshbasic_frag},lambert:{uniforms:xn([Se.common,Se.specularmap,Se.envmap,Se.aomap,Se.lightmap,Se.emissivemap,Se.bumpmap,Se.normalmap,Se.displacementmap,Se.fog,Se.lights,{emissive:{value:new ct(0)},envMapIntensity:{value:1}}]),vertexShader:rt.meshlambert_vert,fragmentShader:rt.meshlambert_frag},phong:{uniforms:xn([Se.common,Se.specularmap,Se.envmap,Se.aomap,Se.lightmap,Se.emissivemap,Se.bumpmap,Se.normalmap,Se.displacementmap,Se.fog,Se.lights,{emissive:{value:new ct(0)},specular:{value:new ct(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:rt.meshphong_vert,fragmentShader:rt.meshphong_frag},standard:{uniforms:xn([Se.common,Se.envmap,Se.aomap,Se.lightmap,Se.emissivemap,Se.bumpmap,Se.normalmap,Se.displacementmap,Se.roughnessmap,Se.metalnessmap,Se.fog,Se.lights,{emissive:{value:new ct(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:rt.meshphysical_vert,fragmentShader:rt.meshphysical_frag},toon:{uniforms:xn([Se.common,Se.aomap,Se.lightmap,Se.emissivemap,Se.bumpmap,Se.normalmap,Se.displacementmap,Se.gradientmap,Se.fog,Se.lights,{emissive:{value:new ct(0)}}]),vertexShader:rt.meshtoon_vert,fragmentShader:rt.meshtoon_frag},matcap:{uniforms:xn([Se.common,Se.bumpmap,Se.normalmap,Se.displacementmap,Se.fog,{matcap:{value:null}}]),vertexShader:rt.meshmatcap_vert,fragmentShader:rt.meshmatcap_frag},points:{uniforms:xn([Se.points,Se.fog]),vertexShader:rt.points_vert,fragmentShader:rt.points_frag},dashed:{uniforms:xn([Se.common,Se.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:rt.linedashed_vert,fragmentShader:rt.linedashed_frag},depth:{uniforms:xn([Se.common,Se.displacementmap]),vertexShader:rt.depth_vert,fragmentShader:rt.depth_frag},normal:{uniforms:xn([Se.common,Se.bumpmap,Se.normalmap,Se.displacementmap,{opacity:{value:1}}]),vertexShader:rt.meshnormal_vert,fragmentShader:rt.meshnormal_frag},sprite:{uniforms:xn([Se.sprite,Se.fog]),vertexShader:rt.sprite_vert,fragmentShader:rt.sprite_frag},background:{uniforms:{uvTransform:{value:new Qe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:rt.background_vert,fragmentShader:rt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Qe}},vertexShader:rt.backgroundCube_vert,fragmentShader:rt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:rt.cube_vert,fragmentShader:rt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:rt.equirect_vert,fragmentShader:rt.equirect_frag},distance:{uniforms:xn([Se.common,Se.displacementmap,{referencePosition:{value:new D},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:rt.distance_vert,fragmentShader:rt.distance_frag},shadow:{uniforms:xn([Se.lights,Se.fog,{color:{value:new ct(0)},opacity:{value:1}}]),vertexShader:rt.shadow_vert,fragmentShader:rt.shadow_frag}};Xi.physical={uniforms:xn([Xi.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Qe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Qe},clearcoatNormalScale:{value:new Le(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Qe},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Qe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Qe},sheen:{value:0},sheenColor:{value:new ct(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Qe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Qe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Qe},transmissionSamplerSize:{value:new Le},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Qe},attenuationDistance:{value:0},attenuationColor:{value:new ct(0)},specularColor:{value:new ct(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Qe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Qe},anisotropyVector:{value:new Le},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Qe}}]),vertexShader:rt.meshphysical_vert,fragmentShader:rt.meshphysical_frag};var Pu={r:0,b:0,g:0},Aw=new Dt,H0=new Qe;H0.set(-1,0,0,0,1,0,0,0,1);function Cw(t,e,n,i,r,s){let o=new ct(0),a=r===!0?0:1,l,c,d=null,p=0,h=null;function f(m){let x=m.isScene===!0?m.background:null;if(x&&x.isTexture){let S=m.backgroundBlurriness>0;x=e.get(x,S)}return x}function v(m){let x=!1,S=f(m);S===null?g(o,a):S&&S.isColor&&(g(S,1),x=!0);let C=t.xr.getEnvironmentBlendMode();C==="additive"?n.buffers.color.setClear(0,0,0,1,s):C==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,s),(t.autoClear||x)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),t.clear(t.autoClearColor,t.autoClearDepth,t.autoClearStencil))}function M(m,x){let S=f(x);S&&(S.isCubeTexture||S.mapping===Aa)?(c===void 0&&(c=new vn(new Ir(1,1,1),new jn({name:"BackgroundCubeMaterial",uniforms:Ss(Xi.backgroundCube.uniforms),vertexShader:Xi.backgroundCube.vertexShader,fragmentShader:Xi.backgroundCube.fragmentShader,side:Pn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(C,b,R){this.matrixWorld.copyPosition(R.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(c)),c.material.uniforms.envMap.value=S,c.material.uniforms.backgroundBlurriness.value=x.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(Aw.makeRotationFromEuler(x.backgroundRotation)).transpose(),S.isCubeTexture&&S.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(H0),c.material.toneMapped=lt.getTransfer(S.colorSpace)!==xt,(d!==S||p!==S.version||h!==t.toneMapping)&&(c.material.needsUpdate=!0,d=S,p=S.version,h=t.toneMapping),c.layers.enableAll(),m.unshift(c,c.geometry,c.material,0,0,null)):S&&S.isTexture&&(l===void 0&&(l=new vn(new vs(2,2),new jn({name:"BackgroundMaterial",uniforms:Ss(Xi.background.uniforms),vertexShader:Xi.background.vertexShader,fragmentShader:Xi.background.fragmentShader,side:sr,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=S,l.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,l.material.toneMapped=lt.getTransfer(S.colorSpace)!==xt,S.matrixAutoUpdate===!0&&S.updateMatrix(),l.material.uniforms.uvTransform.value.copy(S.matrix),(d!==S||p!==S.version||h!==t.toneMapping)&&(l.material.needsUpdate=!0,d=S,p=S.version,h=t.toneMapping),l.layers.enableAll(),m.unshift(l,l.geometry,l.material,0,0,null))}function g(m,x){m.getRGB(Pu,mf(t)),n.buffers.color.setClear(Pu.r,Pu.g,Pu.b,x,s)}function u(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(m,x=1){o.set(m),a=x,g(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(m){a=m,g(o,a)},render:v,addToRenderList:M,dispose:u}}function Rw(t,e){let n=t.getParameter(t.MAX_VERTEX_ATTRIBS),i={},r=h(null),s=r,o=!1;function a(P,B,j,$,z){let Y=!1,Z=p(P,$,j,B);s!==Z&&(s=Z,c(s.object)),Y=f(P,$,j,z),Y&&v(P,$,j,z),z!==null&&e.update(z,t.ELEMENT_ARRAY_BUFFER),(Y||o)&&(o=!1,S(P,B,j,$),z!==null&&t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,e.get(z).buffer))}function l(){return t.createVertexArray()}function c(P){return t.bindVertexArray(P)}function d(P){return t.deleteVertexArray(P)}function p(P,B,j,$){let z=$.wireframe===!0,Y=i[B.id];Y===void 0&&(Y={},i[B.id]=Y);let Z=P.isInstancedMesh===!0?P.id:0,ne=Y[Z];ne===void 0&&(ne={},Y[Z]=ne);let ce=ne[j.id];ce===void 0&&(ce={},ne[j.id]=ce);let ue=ce[z];return ue===void 0&&(ue=h(l()),ce[z]=ue),ue}function h(P){let B=[],j=[],$=[];for(let z=0;z<n;z++)B[z]=0,j[z]=0,$[z]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:B,enabledAttributes:j,attributeDivisors:$,object:P,attributes:{},index:null}}function f(P,B,j,$){let z=s.attributes,Y=B.attributes,Z=0,ne=j.getAttributes();for(let ce in ne)if(ne[ce].location>=0){let Ie=z[ce],De=Y[ce];if(De===void 0&&(ce==="instanceMatrix"&&P.instanceMatrix&&(De=P.instanceMatrix),ce==="instanceColor"&&P.instanceColor&&(De=P.instanceColor)),Ie===void 0||Ie.attribute!==De||De&&Ie.data!==De.data)return!0;Z++}return s.attributesNum!==Z||s.index!==$}function v(P,B,j,$){let z={},Y=B.attributes,Z=0,ne=j.getAttributes();for(let ce in ne)if(ne[ce].location>=0){let Ie=Y[ce];Ie===void 0&&(ce==="instanceMatrix"&&P.instanceMatrix&&(Ie=P.instanceMatrix),ce==="instanceColor"&&P.instanceColor&&(Ie=P.instanceColor));let De={};De.attribute=Ie,Ie&&Ie.data&&(De.data=Ie.data),z[ce]=De,Z++}s.attributes=z,s.attributesNum=Z,s.index=$}function M(){let P=s.newAttributes;for(let B=0,j=P.length;B<j;B++)P[B]=0}function g(P){u(P,0)}function u(P,B){let j=s.newAttributes,$=s.enabledAttributes,z=s.attributeDivisors;j[P]=1,$[P]===0&&(t.enableVertexAttribArray(P),$[P]=1),z[P]!==B&&(t.vertexAttribDivisor(P,B),z[P]=B)}function m(){let P=s.newAttributes,B=s.enabledAttributes;for(let j=0,$=B.length;j<$;j++)B[j]!==P[j]&&(t.disableVertexAttribArray(j),B[j]=0)}function x(P,B,j,$,z,Y,Z){Z===!0?t.vertexAttribIPointer(P,B,j,z,Y):t.vertexAttribPointer(P,B,j,$,z,Y)}function S(P,B,j,$){M();let z=$.attributes,Y=j.getAttributes(),Z=B.defaultAttributeValues;for(let ne in Y){let ce=Y[ne];if(ce.location>=0){let ue=z[ne];if(ue===void 0&&(ne==="instanceMatrix"&&P.instanceMatrix&&(ue=P.instanceMatrix),ne==="instanceColor"&&P.instanceColor&&(ue=P.instanceColor)),ue!==void 0){let Ie=ue.normalized,De=ue.itemSize,Ze=e.get(ue);if(Ze===void 0)continue;let mt=Ze.buffer,je=Ze.type,ee=Ze.bytesPerElement,oe=je===t.INT||je===t.UNSIGNED_INT||ue.gpuType===Xc;if(ue.isInterleavedBufferAttribute){let se=ue.data,Fe=se.stride,Ve=ue.offset;if(se.isInstancedInterleavedBuffer){for(let ze=0;ze<ce.locationSize;ze++)u(ce.location+ze,se.meshPerAttribute);P.isInstancedMesh!==!0&&$._maxInstanceCount===void 0&&($._maxInstanceCount=se.meshPerAttribute*se.count)}else for(let ze=0;ze<ce.locationSize;ze++)g(ce.location+ze);t.bindBuffer(t.ARRAY_BUFFER,mt);for(let ze=0;ze<ce.locationSize;ze++)x(ce.location+ze,De/ce.locationSize,je,Ie,Fe*ee,(Ve+De/ce.locationSize*ze)*ee,oe)}else{if(ue.isInstancedBufferAttribute){for(let se=0;se<ce.locationSize;se++)u(ce.location+se,ue.meshPerAttribute);P.isInstancedMesh!==!0&&$._maxInstanceCount===void 0&&($._maxInstanceCount=ue.meshPerAttribute*ue.count)}else for(let se=0;se<ce.locationSize;se++)g(ce.location+se);t.bindBuffer(t.ARRAY_BUFFER,mt);for(let se=0;se<ce.locationSize;se++)x(ce.location+se,De/ce.locationSize,je,Ie,De*ee,De/ce.locationSize*se*ee,oe)}}else if(Z!==void 0){let Ie=Z[ne];if(Ie!==void 0)switch(Ie.length){case 2:t.vertexAttrib2fv(ce.location,Ie);break;case 3:t.vertexAttrib3fv(ce.location,Ie);break;case 4:t.vertexAttrib4fv(ce.location,Ie);break;default:t.vertexAttrib1fv(ce.location,Ie)}}}}m()}function C(){T();for(let P in i){let B=i[P];for(let j in B){let $=B[j];for(let z in $){let Y=$[z];for(let Z in Y)d(Y[Z].object),delete Y[Z];delete $[z]}}delete i[P]}}function b(P){if(i[P.id]===void 0)return;let B=i[P.id];for(let j in B){let $=B[j];for(let z in $){let Y=$[z];for(let Z in Y)d(Y[Z].object),delete Y[Z];delete $[z]}}delete i[P.id]}function R(P){for(let B in i){let j=i[B];for(let $ in j){let z=j[$];if(z[P.id]===void 0)continue;let Y=z[P.id];for(let Z in Y)d(Y[Z].object),delete Y[Z];delete z[P.id]}}}function _(P){for(let B in i){let j=i[B],$=P.isInstancedMesh===!0?P.id:0,z=j[$];if(z!==void 0){for(let Y in z){let Z=z[Y];for(let ne in Z)d(Z[ne].object),delete Z[ne];delete z[Y]}delete j[$],Object.keys(j).length===0&&delete i[B]}}}function T(){I(),o=!0,s!==r&&(s=r,c(s.object))}function I(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:T,resetDefaultState:I,dispose:C,releaseStatesOfGeometry:b,releaseStatesOfObject:_,releaseStatesOfProgram:R,initAttributes:M,enableAttribute:g,disableUnusedAttributes:m}}function Pw(t,e,n){let i;function r(l){i=l}function s(l,c){t.drawArrays(i,l,c),n.update(c,i,1)}function o(l,c,d){d!==0&&(t.drawArraysInstanced(i,l,c,d),n.update(c,i,d))}function a(l,c,d){if(d===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,c,0,d);let h=0;for(let f=0;f<d;f++)h+=c[f];n.update(h,i,1)}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a}function Iw(t,e,n,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let R=e.get("EXT_texture_filter_anisotropic");r=t.getParameter(R.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(R){return!(R!==ui&&i.convert(R)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(R){let _=R===Hi&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(R!==On&&i.convert(R)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE)&&R!==Ci&&!_)}function l(R){if(R==="highp"){if(t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.HIGH_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.HIGH_FLOAT).precision>0)return"highp";R="mediump"}return R==="mediump"&&t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.MEDIUM_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",d=l(c);d!==c&&(ke("WebGLRenderer:",c,"not supported, using",d,"instead."),c=d);let p=n.logarithmicDepthBuffer===!0,h=n.reversedDepthBuffer===!0&&e.has("EXT_clip_control");n.reversedDepthBuffer===!0&&h===!1&&ke("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let f=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),v=t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),M=t.getParameter(t.MAX_TEXTURE_SIZE),g=t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),u=t.getParameter(t.MAX_VERTEX_ATTRIBS),m=t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),x=t.getParameter(t.MAX_VARYING_VECTORS),S=t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),C=t.getParameter(t.MAX_SAMPLES),b=t.getParameter(t.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:p,reversedDepthBuffer:h,maxTextures:f,maxVertexTextures:v,maxTextureSize:M,maxCubemapSize:g,maxAttributes:u,maxVertexUniforms:m,maxVaryings:x,maxFragmentUniforms:S,maxSamples:C,samples:b}}function Lw(t){let e=this,n=null,i=0,r=!1,s=!1,o=new ai,a=new Qe,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(p,h){let f=p.length!==0||h||i!==0||r;return r=h,i=p.length,f},this.beginShadows=function(){s=!0,d(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(p,h){n=d(p,h,0)},this.setState=function(p,h,f){let v=p.clippingPlanes,M=p.clipIntersection,g=p.clipShadows,u=t.get(p);if(!r||v===null||v.length===0||s&&!g)s?d(null):c();else{let m=s?0:i,x=m*4,S=u.clippingState||null;l.value=S,S=d(v,h,x,f);for(let C=0;C!==x;++C)S[C]=n[C];u.clippingState=S,this.numIntersection=M?this.numPlanes:0,this.numPlanes+=m}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function d(p,h,f,v){let M=p!==null?p.length:0,g=null;if(M!==0){if(g=l.value,v!==!0||g===null){let u=f+M*4,m=h.matrixWorldInverse;a.getNormalMatrix(m),(g===null||g.length<u)&&(g=new Float32Array(u));for(let x=0,S=f;x!==M;++x,S+=4)o.copy(p[x]).applyMatrix4(m,a),o.normal.toArray(g,S),g[S+3]=o.constant}l.value=g,l.needsUpdate=!0}return e.numPlanes=M,e.numIntersection=0,g}}var Gr=4,y0=[.125,.215,.35,.446,.526,.582],Ms=20,Dw=256,Ua=new co,S0=new ct,bf=null,Ef=0,Tf=0,Af=!1,Nw=new D,Lu=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,n=0,i=.1,r=100,s={}){let{size:o=256,position:a=Nw}=s;bf=this._renderer.getRenderTarget(),Ef=this._renderer.getActiveCubeFace(),Tf=this._renderer.getActiveMipmapLevel(),Af=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,n=null){return this._fromTexture(e,n)}fromCubemap(e,n=null){return this._fromTexture(e,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=b0(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=w0(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(bf,Ef,Tf),this._renderer.xr.enabled=Af,e.scissorTest=!1,go(e,0,0,e.width,e.height)}_fromTexture(e,n){e.mapping===Br||e.mapping===ys?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),bf=this._renderer.getRenderTarget(),Ef=this._renderer.getActiveCubeFace(),Tf=this._renderer.getActiveMipmapLevel(),Af=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:an,minFilter:an,generateMipmaps:!1,type:Hi,format:ui,colorSpace:ra,depthBuffer:!1},r=M0(e,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=M0(e,n,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=Uw(s)),this._blurMaterial=Ow(s,e,n),this._ggxMaterial=Fw(s,e,n)}return r}_compileMaterial(e){let n=new vn(new Rn,e);this._renderer.compile(n,Ua)}_sceneToCubeUV(e,n,i,r,s){let l=new gn(90,1,n,i),c=[1,-1,1,1,1,1],d=[1,1,1,-1,-1,-1],p=this._renderer,h=p.autoClear,f=p.toneMapping;p.getClearColor(S0),p.toneMapping=Ti,p.autoClear=!1,p.state.buffers.depth.getReversed()&&(p.setRenderTarget(r),p.clearDepth(),p.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new vn(new Ir,new da({name:"PMREM.Background",side:Pn,depthWrite:!1,depthTest:!1})));let M=this._backgroundBox,g=M.material,u=!1,m=e.background;m?m.isColor&&(g.color.copy(m),e.background=null,u=!0):(g.color.copy(S0),u=!0);for(let x=0;x<6;x++){let S=x%3;S===0?(l.up.set(0,c[x],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+d[x],s.y,s.z)):S===1?(l.up.set(0,0,c[x]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+d[x],s.z)):(l.up.set(0,c[x],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+d[x]));let C=this._cubeSize;go(r,S*C,x>2?C:0,C,C),p.setRenderTarget(r),u&&p.render(M,l),p.render(e,l)}p.toneMapping=f,p.autoClear=h,e.background=m}_textureToCubeUV(e,n){let i=this._renderer,r=e.mapping===Br||e.mapping===ys;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=b0()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=w0());let s=r?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=s;let a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;go(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(o,Ua)}_applyPMREM(e){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);n.autoClear=i}_applyGGXFilter(e,n,i){let r=this._renderer,s=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[i];a.material=o;let l=o.uniforms,c=i/(this._lodMeshes.length-1),d=n/(this._lodMeshes.length-1),p=Math.sqrt(c*c-d*d),h=0+c*1.25,f=p*h,{_lodMax:v}=this,M=this._sizeLods[i],g=3*M*(i>v-Gr?i-v+Gr:0),u=4*(this._cubeSize-M);l.envMap.value=e.texture,l.roughness.value=f,l.mipInt.value=v-n,go(s,g,u,3*M,2*M),r.setRenderTarget(s),r.render(a,Ua),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=v-i,go(e,g,u,3*M,2*M),r.setRenderTarget(e),r.render(a,Ua)}_blur(e,n,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,n,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,n,i,r,s,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&We("blur direction must be either latitudinal or longitudinal!");let d=3,p=this._lodMeshes[r];p.material=c;let h=c.uniforms,f=this._sizeLods[i]-1,v=isFinite(s)?Math.PI/(2*f):2*Math.PI/(2*Ms-1),M=s/v,g=isFinite(s)?1+Math.floor(d*M):Ms;g>Ms&&ke(`sigmaRadians, ${s}, is too large and will clip, as it requested ${g} samples when the maximum is set to ${Ms}`);let u=[],m=0;for(let R=0;R<Ms;++R){let _=R/M,T=Math.exp(-_*_/2);u.push(T),R===0?m+=T:R<g&&(m+=2*T)}for(let R=0;R<u.length;R++)u[R]=u[R]/m;h.envMap.value=e.texture,h.samples.value=g,h.weights.value=u,h.latitudinal.value=o==="latitudinal",a&&(h.poleAxis.value=a);let{_lodMax:x}=this;h.dTheta.value=v,h.mipInt.value=x-i;let S=this._sizeLods[r],C=3*S*(r>x-Gr?r-x+Gr:0),b=4*(this._cubeSize-S);go(n,C,b,3*S,2*S),l.setRenderTarget(n),l.render(p,Ua)}};function Uw(t){let e=[],n=[],i=[],r=t,s=t-Gr+1+y0.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);e.push(a);let l=1/a;o>t-Gr?l=y0[o-t+Gr-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),d=-c,p=1+c,h=[d,d,p,d,p,p,d,d,p,p,d,p],f=6,v=6,M=3,g=2,u=1,m=new Float32Array(M*v*f),x=new Float32Array(g*v*f),S=new Float32Array(u*v*f);for(let b=0;b<f;b++){let R=b%3*2/3-1,_=b>2?0:-1,T=[R,_,0,R+2/3,_,0,R+2/3,_+1,0,R,_,0,R+2/3,_+1,0,R,_+1,0];m.set(T,M*v*b),x.set(h,g*v*b);let I=[b,b,b,b,b,b];S.set(I,u*v*b)}let C=new Rn;C.setAttribute("position",new Zn(m,M)),C.setAttribute("uv",new Zn(x,g)),C.setAttribute("faceIndex",new Zn(S,u)),i.push(new vn(C,null)),r>Gr&&r--}return{lodMeshes:i,sizeLods:e,sigmas:n}}function M0(t,e,n){let i=new $n(t,e,n);return i.texture.mapping=Aa,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function go(t,e,n,i,r){t.viewport.set(e,n,i,r),t.scissor.set(e,n,i,r)}function Fw(t,e,n){return new jn({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:Dw,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Uu(),fragmentShader:`

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
		`,blending:Gi,depthTest:!1,depthWrite:!1})}function Ow(t,e,n){let i=new Float32Array(Ms),r=new D(0,1,0);return new jn({name:"SphericalGaussianBlur",defines:{n:Ms,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:Uu(),fragmentShader:`

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
		`,blending:Gi,depthTest:!1,depthWrite:!1})}function w0(){return new jn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Uu(),fragmentShader:`

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
		`,blending:Gi,depthTest:!1,depthWrite:!1})}function b0(){return new jn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Uu(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Gi,depthTest:!1,depthWrite:!1})}function Uu(){return`

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
	`}var Du=class extends $n{constructor(e=1,n={}){super(e,e,n),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new fa(r),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new Ir(5,5,5),s=new jn({name:"CubemapFromEquirect",uniforms:Ss(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:Pn,blending:Gi});s.uniforms.tEquirect.value=n;let o=new vn(r,s),a=n.minFilter;return n.minFilter===kr&&(n.minFilter=an),new Bc(1,10,this).update(e,o),n.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,n=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(n,i,r);e.setRenderTarget(s)}};function Bw(t){let e=new WeakMap,n=new WeakMap,i=null;function r(h,f=!1){return h==null?null:f?o(h):s(h)}function s(h){if(h&&h.isTexture){let f=h.mapping;if(f===Gc||f===Hc)if(e.has(h)){let v=e.get(h).texture;return a(v,h.mapping)}else{let v=h.image;if(v&&v.height>0){let M=new Du(v.height);return M.fromEquirectangularTexture(t,h),e.set(h,M),h.addEventListener("dispose",c),a(M.texture,h.mapping)}else return null}}return h}function o(h){if(h&&h.isTexture){let f=h.mapping,v=f===Gc||f===Hc,M=f===Br||f===ys;if(v||M){let g=n.get(h),u=g!==void 0?g.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==u)return i===null&&(i=new Lu(t)),g=v?i.fromEquirectangular(h,g):i.fromCubemap(h,g),g.texture.pmremVersion=h.pmremVersion,n.set(h,g),g.texture;if(g!==void 0)return g.texture;{let m=h.image;return v&&m&&m.height>0||M&&m&&l(m)?(i===null&&(i=new Lu(t)),g=v?i.fromEquirectangular(h):i.fromCubemap(h),g.texture.pmremVersion=h.pmremVersion,n.set(h,g),h.addEventListener("dispose",d),g.texture):null}}}return h}function a(h,f){return f===Gc?h.mapping=Br:f===Hc&&(h.mapping=ys),h}function l(h){let f=0,v=6;for(let M=0;M<v;M++)h[M]!==void 0&&f++;return f===v}function c(h){let f=h.target;f.removeEventListener("dispose",c);let v=e.get(f);v!==void 0&&(e.delete(f),v.dispose())}function d(h){let f=h.target;f.removeEventListener("dispose",d);let v=n.get(f);v!==void 0&&(n.delete(f),v.dispose())}function p(){e=new WeakMap,n=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:p}}function kw(t){let e={};function n(i){if(e[i]!==void 0)return e[i];let r=t.getExtension(i);return e[i]=r,r}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let r=n(i);return r===null&&dc("WebGLRenderer: "+i+" extension not supported."),r}}}function zw(t,e,n,i){let r={},s=new WeakMap;function o(p){let h=p.target;h.index!==null&&e.remove(h.index);for(let v in h.attributes)e.remove(h.attributes[v]);h.removeEventListener("dispose",o),delete r[h.id];let f=s.get(h);f&&(e.remove(f),s.delete(h)),i.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,n.memory.geometries--}function a(p,h){return r[h.id]===!0||(h.addEventListener("dispose",o),r[h.id]=!0,n.memory.geometries++),h}function l(p){let h=p.attributes;for(let f in h)e.update(h[f],t.ARRAY_BUFFER)}function c(p){let h=[],f=p.index,v=p.attributes.position,M=0;if(v===void 0)return;if(f!==null){let m=f.array;M=f.version;for(let x=0,S=m.length;x<S;x+=3){let C=m[x+0],b=m[x+1],R=m[x+2];h.push(C,b,b,R,R,C)}}else{let m=v.array;M=v.version;for(let x=0,S=m.length/3-1;x<S;x+=3){let C=x+0,b=x+1,R=x+2;h.push(C,b,b,R,R,C)}}let g=new(v.count>=65535?ha:ua)(h,1);g.version=M;let u=s.get(p);u&&e.remove(u),s.set(p,g)}function d(p){let h=s.get(p);if(h){let f=p.index;f!==null&&h.version<f.version&&c(p)}else c(p);return s.get(p)}return{get:a,update:l,getWireframeAttribute:d}}function Vw(t,e,n){let i;function r(p){i=p}let s,o;function a(p){s=p.type,o=p.bytesPerElement}function l(p,h){t.drawElements(i,h,s,p*o),n.update(h,i,1)}function c(p,h,f){f!==0&&(t.drawElementsInstanced(i,h,s,p*o,f),n.update(h,i,f))}function d(p,h,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,h,0,s,p,0,f);let M=0;for(let g=0;g<f;g++)M+=h[g];n.update(M,i,1)}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=d}function Gw(t){let e={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(n.calls++,o){case t.TRIANGLES:n.triangles+=a*(s/3);break;case t.LINES:n.lines+=a*(s/2);break;case t.LINE_STRIP:n.lines+=a*(s-1);break;case t.LINE_LOOP:n.lines+=a*s;break;case t.POINTS:n.points+=a*s;break;default:We("WebGLInfo: Unknown draw mode:",o);break}}function r(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:e,render:n,programs:null,autoReset:!0,reset:r,update:i}}function Hw(t,e,n){let i=new WeakMap,r=new Vt;function s(o,a,l){let c=o.morphTargetInfluences,d=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,p=d!==void 0?d.length:0,h=i.get(a);if(h===void 0||h.count!==p){let T=function(){R.dispose(),i.delete(a),a.removeEventListener("dispose",T)};h!==void 0&&h.texture.dispose();let f=a.morphAttributes.position!==void 0,v=a.morphAttributes.normal!==void 0,M=a.morphAttributes.color!==void 0,g=a.morphAttributes.position||[],u=a.morphAttributes.normal||[],m=a.morphAttributes.color||[],x=0;f===!0&&(x=1),v===!0&&(x=2),M===!0&&(x=3);let S=a.attributes.position.count*x,C=1;S>e.maxTextureSize&&(C=Math.ceil(S/e.maxTextureSize),S=e.maxTextureSize);let b=new Float32Array(S*C*4*p),R=new aa(b,S,C,p);R.type=Ci,R.needsUpdate=!0;let _=x*4;for(let I=0;I<p;I++){let P=g[I],B=u[I],j=m[I],$=S*C*4*I;for(let z=0;z<P.count;z++){let Y=z*_;f===!0&&(r.fromBufferAttribute(P,z),b[$+Y+0]=r.x,b[$+Y+1]=r.y,b[$+Y+2]=r.z,b[$+Y+3]=0),v===!0&&(r.fromBufferAttribute(B,z),b[$+Y+4]=r.x,b[$+Y+5]=r.y,b[$+Y+6]=r.z,b[$+Y+7]=0),M===!0&&(r.fromBufferAttribute(j,z),b[$+Y+8]=r.x,b[$+Y+9]=r.y,b[$+Y+10]=r.z,b[$+Y+11]=j.itemSize===4?r.w:1)}}h={count:p,texture:R,size:new Le(S,C)},i.set(a,h),a.addEventListener("dispose",T)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(t,"morphTexture",o.morphTexture,n);else{let f=0;for(let M=0;M<c.length;M++)f+=c[M];let v=a.morphTargetsRelative?1:1-f;l.getUniforms().setValue(t,"morphTargetBaseInfluence",v),l.getUniforms().setValue(t,"morphTargetInfluences",c)}l.getUniforms().setValue(t,"morphTargetsTexture",h.texture,n),l.getUniforms().setValue(t,"morphTargetsTextureSize",h.size)}return{update:s}}function Ww(t,e,n,i,r){let s=new WeakMap;function o(c){let d=r.render.frame,p=c.geometry,h=e.get(c,p);if(s.get(h)!==d&&(e.update(h),s.set(h,d)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==d&&(n.update(c.instanceMatrix,t.ARRAY_BUFFER),c.instanceColor!==null&&n.update(c.instanceColor,t.ARRAY_BUFFER),s.set(c,d))),c.isSkinnedMesh){let f=c.skeleton;s.get(f)!==d&&(f.update(),s.set(f,d))}return h}function a(){s=new WeakMap}function l(c){let d=c.target;d.removeEventListener("dispose",l),i.releaseStatesOfObject(d),n.remove(d.instanceMatrix),d.instanceColor!==null&&n.remove(d.instanceColor)}return{update:o,dispose:a}}var Xw={[jd]:"LINEAR_TONE_MAPPING",[Kd]:"REINHARD_TONE_MAPPING",[Jd]:"CINEON_TONE_MAPPING",[Ta]:"ACES_FILMIC_TONE_MAPPING",[ef]:"AGX_TONE_MAPPING",[tf]:"NEUTRAL_TONE_MAPPING",[Qd]:"CUSTOM_TONE_MAPPING"};function Yw(t,e,n,i,r){let s=new $n(e,n,{type:t,depthBuffer:i,stencilBuffer:r,depthTexture:i?new ar(e,n):void 0}),o=new $n(e,n,{type:Hi,depthBuffer:!1,stencilBuffer:!1}),a=new Rn;a.setAttribute("position",new zt([-1,3,0,-1,-1,0,3,-1,0],3)),a.setAttribute("uv",new zt([0,2,0,0,2,0],2));let l=new Ec({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),c=new vn(a,l),d=new co(-1,1,1,-1,0,1),p=null,h=null,f=!1,v,M=null,g=[],u=!1;this.setSize=function(m,x){s.setSize(m,x),o.setSize(m,x);for(let S=0;S<g.length;S++){let C=g[S];C.setSize&&C.setSize(m,x)}},this.setEffects=function(m){g=m,u=g.length>0&&g[0].isRenderPass===!0;let x=s.width,S=s.height;for(let C=0;C<g.length;C++){let b=g[C];b.setSize&&b.setSize(x,S)}},this.begin=function(m,x){if(f||m.toneMapping===Ti&&g.length===0)return!1;if(M=x,x!==null){let S=x.width,C=x.height;(s.width!==S||s.height!==C)&&this.setSize(S,C)}return u===!1&&m.setRenderTarget(s),v=m.toneMapping,m.toneMapping=Ti,!0},this.hasRenderPass=function(){return u},this.end=function(m,x){m.toneMapping=v,f=!0;let S=s,C=o;for(let b=0;b<g.length;b++){let R=g[b];if(R.enabled!==!1&&(R.render(m,C,S,x),R.needsSwap!==!1)){let _=S;S=C,C=_}}if(p!==m.outputColorSpace||h!==m.toneMapping){p=m.outputColorSpace,h=m.toneMapping,l.defines={},lt.getTransfer(p)===xt&&(l.defines.SRGB_TRANSFER="");let b=Xw[h];b&&(l.defines[b]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=S.texture,m.setRenderTarget(M),m.render(c,d),M=null,f=!1},this.isCompositing=function(){return f},this.dispose=function(){s.depthTexture&&s.depthTexture.dispose(),s.dispose(),o.dispose(),a.dispose(),l.dispose()}}var W0=new Fn,Pf=new ar(1,1),X0=new aa,Y0=new mc,q0=new fa,E0=[],T0=[],A0=new Float32Array(16),C0=new Float32Array(9),R0=new Float32Array(4);function vo(t,e,n){let i=t[0];if(i<=0||i>0)return t;let r=e*n,s=E0[r];if(s===void 0&&(s=new Float32Array(r),E0[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=n,t[o].toArray(s,a)}return s}function Kt(t,e){if(t.length!==e.length)return!1;for(let n=0,i=t.length;n<i;n++)if(t[n]!==e[n])return!1;return!0}function Jt(t,e){for(let n=0,i=e.length;n<i;n++)t[n]=e[n]}function Fu(t,e){let n=T0[e];n===void 0&&(n=new Int32Array(e),T0[e]=n);for(let i=0;i!==e;++i)n[i]=t.allocateTextureUnit();return n}function qw(t,e){let n=this.cache;n[0]!==e&&(t.uniform1f(this.addr,e),n[0]=e)}function Zw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2f(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Kt(n,e))return;t.uniform2fv(this.addr,e),Jt(n,e)}}function $w(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3f(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else if(e.r!==void 0)(n[0]!==e.r||n[1]!==e.g||n[2]!==e.b)&&(t.uniform3f(this.addr,e.r,e.g,e.b),n[0]=e.r,n[1]=e.g,n[2]=e.b);else{if(Kt(n,e))return;t.uniform3fv(this.addr,e),Jt(n,e)}}function jw(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4f(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Kt(n,e))return;t.uniform4fv(this.addr,e),Jt(n,e)}}function Kw(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Kt(n,e))return;t.uniformMatrix2fv(this.addr,!1,e),Jt(n,e)}else{if(Kt(n,i))return;R0.set(i),t.uniformMatrix2fv(this.addr,!1,R0),Jt(n,i)}}function Jw(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Kt(n,e))return;t.uniformMatrix3fv(this.addr,!1,e),Jt(n,e)}else{if(Kt(n,i))return;C0.set(i),t.uniformMatrix3fv(this.addr,!1,C0),Jt(n,i)}}function Qw(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Kt(n,e))return;t.uniformMatrix4fv(this.addr,!1,e),Jt(n,e)}else{if(Kt(n,i))return;A0.set(i),t.uniformMatrix4fv(this.addr,!1,A0),Jt(n,i)}}function eb(t,e){let n=this.cache;n[0]!==e&&(t.uniform1i(this.addr,e),n[0]=e)}function tb(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2i(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Kt(n,e))return;t.uniform2iv(this.addr,e),Jt(n,e)}}function nb(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3i(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Kt(n,e))return;t.uniform3iv(this.addr,e),Jt(n,e)}}function ib(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4i(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Kt(n,e))return;t.uniform4iv(this.addr,e),Jt(n,e)}}function rb(t,e){let n=this.cache;n[0]!==e&&(t.uniform1ui(this.addr,e),n[0]=e)}function sb(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2ui(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Kt(n,e))return;t.uniform2uiv(this.addr,e),Jt(n,e)}}function ob(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3ui(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Kt(n,e))return;t.uniform3uiv(this.addr,e),Jt(n,e)}}function ab(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4ui(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Kt(n,e))return;t.uniform4uiv(this.addr,e),Jt(n,e)}}function lb(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r);let s;this.type===t.SAMPLER_2D_SHADOW?(Pf.compareFunction=n.isReversedDepthBuffer()?Ru:Cu,s=Pf):s=W0,n.setTexture2D(e||s,r)}function cb(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture3D(e||Y0,r)}function ub(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTextureCube(e||q0,r)}function hb(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture2DArray(e||X0,r)}function db(t){switch(t){case 5126:return qw;case 35664:return Zw;case 35665:return $w;case 35666:return jw;case 35674:return Kw;case 35675:return Jw;case 35676:return Qw;case 5124:case 35670:return eb;case 35667:case 35671:return tb;case 35668:case 35672:return nb;case 35669:case 35673:return ib;case 5125:return rb;case 36294:return sb;case 36295:return ob;case 36296:return ab;case 35678:case 36198:case 36298:case 36306:case 35682:return lb;case 35679:case 36299:case 36307:return cb;case 35680:case 36300:case 36308:case 36293:return ub;case 36289:case 36303:case 36311:case 36292:return hb}}function fb(t,e){t.uniform1fv(this.addr,e)}function pb(t,e){let n=vo(e,this.size,2);t.uniform2fv(this.addr,n)}function mb(t,e){let n=vo(e,this.size,3);t.uniform3fv(this.addr,n)}function gb(t,e){let n=vo(e,this.size,4);t.uniform4fv(this.addr,n)}function _b(t,e){let n=vo(e,this.size,4);t.uniformMatrix2fv(this.addr,!1,n)}function vb(t,e){let n=vo(e,this.size,9);t.uniformMatrix3fv(this.addr,!1,n)}function xb(t,e){let n=vo(e,this.size,16);t.uniformMatrix4fv(this.addr,!1,n)}function yb(t,e){t.uniform1iv(this.addr,e)}function Sb(t,e){t.uniform2iv(this.addr,e)}function Mb(t,e){t.uniform3iv(this.addr,e)}function wb(t,e){t.uniform4iv(this.addr,e)}function bb(t,e){t.uniform1uiv(this.addr,e)}function Eb(t,e){t.uniform2uiv(this.addr,e)}function Tb(t,e){t.uniform3uiv(this.addr,e)}function Ab(t,e){t.uniform4uiv(this.addr,e)}function Cb(t,e,n){let i=this.cache,r=e.length,s=Fu(n,r);Kt(i,s)||(t.uniform1iv(this.addr,s),Jt(i,s));let o;this.type===t.SAMPLER_2D_SHADOW?o=Pf:o=W0;for(let a=0;a!==r;++a)n.setTexture2D(e[a]||o,s[a])}function Rb(t,e,n){let i=this.cache,r=e.length,s=Fu(n,r);Kt(i,s)||(t.uniform1iv(this.addr,s),Jt(i,s));for(let o=0;o!==r;++o)n.setTexture3D(e[o]||Y0,s[o])}function Pb(t,e,n){let i=this.cache,r=e.length,s=Fu(n,r);Kt(i,s)||(t.uniform1iv(this.addr,s),Jt(i,s));for(let o=0;o!==r;++o)n.setTextureCube(e[o]||q0,s[o])}function Ib(t,e,n){let i=this.cache,r=e.length,s=Fu(n,r);Kt(i,s)||(t.uniform1iv(this.addr,s),Jt(i,s));for(let o=0;o!==r;++o)n.setTexture2DArray(e[o]||X0,s[o])}function Lb(t){switch(t){case 5126:return fb;case 35664:return pb;case 35665:return mb;case 35666:return gb;case 35674:return _b;case 35675:return vb;case 35676:return xb;case 5124:case 35670:return yb;case 35667:case 35671:return Sb;case 35668:case 35672:return Mb;case 35669:case 35673:return wb;case 5125:return bb;case 36294:return Eb;case 36295:return Tb;case 36296:return Ab;case 35678:case 36198:case 36298:case 36306:case 35682:return Cb;case 35679:case 36299:case 36307:return Rb;case 35680:case 36300:case 36308:case 36293:return Pb;case 36289:case 36303:case 36311:case 36292:return Ib}}var If=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.setValue=db(n.type)}},Lf=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=Lb(n.type)}},Df=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,n,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,n[a.id],i)}}},Cf=/(\w+)(\])?(\[|\.)?/g;function P0(t,e){t.seq.push(e),t.map[e.id]=e}function Db(t,e,n){let i=t.name,r=i.length;for(Cf.lastIndex=0;;){let s=Cf.exec(i),o=Cf.lastIndex,a=s[1],l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){P0(n,c===void 0?new If(a,t,e):new Lf(a,t,e));break}else{let p=n.map[a];p===void 0&&(p=new Df(a),P0(n,p)),n=p}}}var _o=class{constructor(e,n){this.seq=[],this.map={};let i=e.getProgramParameter(n,e.ACTIVE_UNIFORMS);for(let o=0;o<i;++o){let a=e.getActiveUniform(n,o),l=e.getUniformLocation(n,a.name);Db(a,l,this)}let r=[],s=[];for(let o of this.seq)o.type===e.SAMPLER_2D_SHADOW||o.type===e.SAMPLER_CUBE_SHADOW||o.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(o):s.push(o);r.length>0&&(this.seq=r.concat(s))}setValue(e,n,i,r){let s=this.map[n];s!==void 0&&s.setValue(e,i,r)}setOptional(e,n,i){let r=n[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,n,i,r){for(let s=0,o=n.length;s!==o;++s){let a=n[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,n){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in n&&i.push(o)}return i}};function I0(t,e,n){let i=t.createShader(e);return t.shaderSource(i,n),t.compileShader(i),i}var Nb=37297,Ub=0;function Fb(t,e){let n=t.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,n.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${n[o]}`)}return i.join(`
`)}var L0=new Qe;function Ob(t){lt._getMatrix(L0,lt.workingColorSpace,t);let e=`mat3( ${L0.elements.map(n=>n.toFixed(4))} )`;switch(lt.getTransfer(t)){case sa:return[e,"LinearTransferOETF"];case xt:return[e,"sRGBTransferOETF"];default:return ke("WebGLProgram: Unsupported color space: ",t),[e,"LinearTransferOETF"]}}function D0(t,e,n){let i=t.getShaderParameter(e,t.COMPILE_STATUS),s=(t.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return n.toUpperCase()+`

`+s+`

`+Fb(t.getShaderSource(e),a)}else return s}function Bb(t,e){let n=Ob(e);return[`vec4 ${t}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}var kb={[jd]:"Linear",[Kd]:"Reinhard",[Jd]:"Cineon",[Ta]:"ACESFilmic",[ef]:"AgX",[tf]:"Neutral",[Qd]:"Custom"};function zb(t,e){let n=kb[e];return n===void 0?(ke("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+t+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+t+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var Iu=new D;function Vb(){lt.getLuminanceCoefficients(Iu);let t=Iu.x.toFixed(4),e=Iu.y.toFixed(4),n=Iu.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${t}, ${e}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Gb(t){return[t.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",t.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Oa).join(`
`)}function Hb(t){let e=[];for(let n in t){let i=t[n];i!==!1&&e.push("#define "+n+" "+i)}return e.join(`
`)}function Wb(t,e){let n={},i=t.getProgramParameter(e,t.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=t.getActiveAttrib(e,r),o=s.name,a=1;s.type===t.FLOAT_MAT2&&(a=2),s.type===t.FLOAT_MAT3&&(a=3),s.type===t.FLOAT_MAT4&&(a=4),n[o]={type:s.type,location:t.getAttribLocation(e,o),locationSize:a}}return n}function Oa(t){return t!==""}function N0(t,e){let n=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return t.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function U0(t,e){return t.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var Xb=/^[ \t]*#include +<([\w\d./]+)>/gm;function Nf(t){return t.replace(Xb,qb)}var Yb=new Map;function qb(t,e){let n=rt[e];if(n===void 0){let i=Yb.get(e);if(i!==void 0)n=rt[i],ke('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return Nf(n)}var Zb=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function F0(t){return t.replace(Zb,$b)}function $b(t,e,n,i){let r="";for(let s=parseInt(e);s<parseInt(n);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function O0(t){let e=`precision ${t.precision} float;
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
#define LOW_PRECISION`),e}var jb={[xs]:"SHADOWMAP_TYPE_PCF",[ho]:"SHADOWMAP_TYPE_VSM"};function Kb(t){return jb[t.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var Jb={[Br]:"ENVMAP_TYPE_CUBE",[ys]:"ENVMAP_TYPE_CUBE",[Aa]:"ENVMAP_TYPE_CUBE_UV"};function Qb(t){return t.envMap===!1?"ENVMAP_TYPE_CUBE":Jb[t.envMapMode]||"ENVMAP_TYPE_CUBE"}var eE={[ys]:"ENVMAP_MODE_REFRACTION"};function tE(t){return t.envMap===!1?"ENVMAP_MODE_REFLECTION":eE[t.envMapMode]||"ENVMAP_MODE_REFLECTION"}var nE={[$d]:"ENVMAP_BLENDING_MULTIPLY",[n0]:"ENVMAP_BLENDING_MIX",[i0]:"ENVMAP_BLENDING_ADD"};function iE(t){return t.envMap===!1?"ENVMAP_BLENDING_NONE":nE[t.combine]||"ENVMAP_BLENDING_NONE"}function rE(t){let e=t.envMapCubeUVHeight;if(e===null)return null;let n=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,n),7*16)),texelHeight:i,maxMip:n}}function sE(t,e,n,i){let r=t.getContext(),s=n.defines,o=n.vertexShader,a=n.fragmentShader,l=Kb(n),c=Qb(n),d=tE(n),p=iE(n),h=rE(n),f=Gb(n),v=Hb(s),M=r.createProgram(),g,u,m=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(g=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,v].filter(Oa).join(`
`),g.length>0&&(g+=`
`),u=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,v].filter(Oa).join(`
`),u.length>0&&(u+=`
`)):(g=[O0(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,v,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+d:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexNormals?"#define HAS_NORMAL":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Oa).join(`
`),u=[O0(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,v,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+d:"",n.envMap?"#define "+p:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor?"#define USE_COLOR":"",n.vertexAlphas||n.batchingColor?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==Ti?"#define TONE_MAPPING":"",n.toneMapping!==Ti?rt.tonemapping_pars_fragment:"",n.toneMapping!==Ti?zb("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",rt.colorspace_pars_fragment,Bb("linearToOutputTexel",n.outputColorSpace),Vb(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(Oa).join(`
`)),o=Nf(o),o=N0(o,n),o=U0(o,n),a=Nf(a),a=N0(a,n),a=U0(a,n),o=F0(o),a=F0(a),n.isRawShaderMaterial!==!0&&(m=`#version 300 es
`,g=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+g,u=["#define varying in",n.glslVersion===hf?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===hf?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+u);let x=m+g+o,S=m+u+a,C=I0(r,r.VERTEX_SHADER,x),b=I0(r,r.FRAGMENT_SHADER,S);r.attachShader(M,C),r.attachShader(M,b),n.index0AttributeName!==void 0?r.bindAttribLocation(M,0,n.index0AttributeName):n.morphTargets===!0&&r.bindAttribLocation(M,0,"position"),r.linkProgram(M);function R(P){if(t.debug.checkShaderErrors){let B=r.getProgramInfoLog(M)||"",j=r.getShaderInfoLog(C)||"",$=r.getShaderInfoLog(b)||"",z=B.trim(),Y=j.trim(),Z=$.trim(),ne=!0,ce=!0;if(r.getProgramParameter(M,r.LINK_STATUS)===!1)if(ne=!1,typeof t.debug.onShaderError=="function")t.debug.onShaderError(r,M,C,b);else{let ue=D0(r,C,"vertex"),Ie=D0(r,b,"fragment");We("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(M,r.VALIDATE_STATUS)+`

Material Name: `+P.name+`
Material Type: `+P.type+`

Program Info Log: `+z+`
`+ue+`
`+Ie)}else z!==""?ke("WebGLProgram: Program Info Log:",z):(Y===""||Z==="")&&(ce=!1);ce&&(P.diagnostics={runnable:ne,programLog:z,vertexShader:{log:Y,prefix:g},fragmentShader:{log:Z,prefix:u}})}r.deleteShader(C),r.deleteShader(b),_=new _o(r,M),T=Wb(r,M)}let _;this.getUniforms=function(){return _===void 0&&R(this),_};let T;this.getAttributes=function(){return T===void 0&&R(this),T};let I=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return I===!1&&(I=r.getProgramParameter(M,Nb)),I},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(M),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=Ub++,this.cacheKey=e,this.usedTimes=1,this.program=M,this.vertexShader=C,this.fragmentShader=b,this}var oE=0,Uf=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let n=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(n),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let n=this.materialCache.get(e);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let n=this.materialCache,i=n.get(e);return i===void 0&&(i=new Set,n.set(e,i)),i}_getShaderStage(e){let n=this.shaderCache,i=n.get(e);return i===void 0&&(i=new Ff(e),n.set(e,i)),i}},Ff=class{constructor(e){this.id=oE++,this.code=e,this.usedTimes=0}};function aE(t){return t===Vr||t===Da||t===Na}function lE(t,e,n,i,r,s){let o=new la,a=new Uf,l=new Set,c=[],d=new Map,p=i.logarithmicDepthBuffer,h=i.precision,f={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function v(_){return l.add(_),_===0?"uv":`uv${_}`}function M(_,T,I,P,B,j){let $=P.fog,z=B.geometry,Y=_.isMeshStandardMaterial||_.isMeshLambertMaterial||_.isMeshPhongMaterial?P.environment:null,Z=_.isMeshStandardMaterial||_.isMeshLambertMaterial&&!_.envMap||_.isMeshPhongMaterial&&!_.envMap,ne=e.get(_.envMap||Y,Z),ce=ne&&ne.mapping===Aa?ne.image.height:null,ue=f[_.type];_.precision!==null&&(h=i.getMaxPrecision(_.precision),h!==_.precision&&ke("WebGLProgram.getParameters:",_.precision,"not supported, using",h,"instead."));let Ie=z.morphAttributes.position||z.morphAttributes.normal||z.morphAttributes.color,De=Ie!==void 0?Ie.length:0,Ze=0;z.morphAttributes.position!==void 0&&(Ze=1),z.morphAttributes.normal!==void 0&&(Ze=2),z.morphAttributes.color!==void 0&&(Ze=3);let mt,je,ee,oe;if(ue){let he=Xi[ue];mt=he.vertexShader,je=he.fragmentShader}else mt=_.vertexShader,je=_.fragmentShader,a.update(_),ee=a.getVertexShaderID(_),oe=a.getFragmentShaderID(_);let se=t.getRenderTarget(),Fe=t.state.buffers.depth.getReversed(),Ve=B.isInstancedMesh===!0,ze=B.isBatchedMesh===!0,Ct=!!_.map,tt=!!_.matcap,ht=!!ne,gt=!!_.aoMap,Xe=!!_.lightMap,Yt=!!_.bumpMap,Mt=!!_.normalMap,En=!!_.displacementMap,O=!!_.emissiveMap,Ft=!!_.metalnessMap,ot=!!_.roughnessMap,ut=_.anisotropy>0,xe=_.clearcoat>0,_t=_.dispersion>0,A=_.iridescence>0,y=_.sheen>0,W=_.transmission>0,J=ut&&!!_.anisotropyMap,ie=xe&&!!_.clearcoatMap,fe=xe&&!!_.clearcoatNormalMap,ge=xe&&!!_.clearcoatRoughnessMap,K=A&&!!_.iridescenceMap,Q=A&&!!_.iridescenceThicknessMap,Me=y&&!!_.sheenColorMap,Te=y&&!!_.sheenRoughnessMap,me=!!_.specularMap,de=!!_.specularColorMap,$e=!!_.specularIntensityMap,Je=W&&!!_.transmissionMap,F=W&&!!_.thicknessMap,E=!!_.gradientMap,U=!!_.alphaMap,L=_.alphaTest>0,k=!!_.alphaHash,G=!!_.extensions,q=Ti;_.toneMapped&&(se===null||se.isXRRenderTarget===!0)&&(q=t.toneMapping);let te={shaderID:ue,shaderType:_.type,shaderName:_.name,vertexShader:mt,fragmentShader:je,defines:_.defines,customVertexShaderID:ee,customFragmentShaderID:oe,isRawShaderMaterial:_.isRawShaderMaterial===!0,glslVersion:_.glslVersion,precision:h,batching:ze,batchingColor:ze&&B._colorsTexture!==null,instancing:Ve,instancingColor:Ve&&B.instanceColor!==null,instancingMorph:Ve&&B.morphTexture!==null,outputColorSpace:se===null?t.outputColorSpace:se.isXRRenderTarget===!0?se.texture.colorSpace:lt.workingColorSpace,alphaToCoverage:!!_.alphaToCoverage,map:Ct,matcap:tt,envMap:ht,envMapMode:ht&&ne.mapping,envMapCubeUVHeight:ce,aoMap:gt,lightMap:Xe,bumpMap:Yt,normalMap:Mt,displacementMap:En,emissiveMap:O,normalMapObjectSpace:Mt&&_.normalMapType===o0,normalMapTangentSpace:Mt&&_.normalMapType===Au,packedNormalMap:Mt&&_.normalMapType===Au&&aE(_.normalMap.format),metalnessMap:Ft,roughnessMap:ot,anisotropy:ut,anisotropyMap:J,clearcoat:xe,clearcoatMap:ie,clearcoatNormalMap:fe,clearcoatRoughnessMap:ge,dispersion:_t,iridescence:A,iridescenceMap:K,iridescenceThicknessMap:Q,sheen:y,sheenColorMap:Me,sheenRoughnessMap:Te,specularMap:me,specularColorMap:de,specularIntensityMap:$e,transmission:W,transmissionMap:Je,thicknessMap:F,gradientMap:E,opaque:_.transparent===!1&&_.blending===gs&&_.alphaToCoverage===!1,alphaMap:U,alphaTest:L,alphaHash:k,combine:_.combine,mapUv:Ct&&v(_.map.channel),aoMapUv:gt&&v(_.aoMap.channel),lightMapUv:Xe&&v(_.lightMap.channel),bumpMapUv:Yt&&v(_.bumpMap.channel),normalMapUv:Mt&&v(_.normalMap.channel),displacementMapUv:En&&v(_.displacementMap.channel),emissiveMapUv:O&&v(_.emissiveMap.channel),metalnessMapUv:Ft&&v(_.metalnessMap.channel),roughnessMapUv:ot&&v(_.roughnessMap.channel),anisotropyMapUv:J&&v(_.anisotropyMap.channel),clearcoatMapUv:ie&&v(_.clearcoatMap.channel),clearcoatNormalMapUv:fe&&v(_.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ge&&v(_.clearcoatRoughnessMap.channel),iridescenceMapUv:K&&v(_.iridescenceMap.channel),iridescenceThicknessMapUv:Q&&v(_.iridescenceThicknessMap.channel),sheenColorMapUv:Me&&v(_.sheenColorMap.channel),sheenRoughnessMapUv:Te&&v(_.sheenRoughnessMap.channel),specularMapUv:me&&v(_.specularMap.channel),specularColorMapUv:de&&v(_.specularColorMap.channel),specularIntensityMapUv:$e&&v(_.specularIntensityMap.channel),transmissionMapUv:Je&&v(_.transmissionMap.channel),thicknessMapUv:F&&v(_.thicknessMap.channel),alphaMapUv:U&&v(_.alphaMap.channel),vertexTangents:!!z.attributes.tangent&&(Mt||ut),vertexNormals:!!z.attributes.normal,vertexColors:_.vertexColors,vertexAlphas:_.vertexColors===!0&&!!z.attributes.color&&z.attributes.color.itemSize===4,pointsUvs:B.isPoints===!0&&!!z.attributes.uv&&(Ct||U),fog:!!$,useFog:_.fog===!0,fogExp2:!!$&&$.isFogExp2,flatShading:_.wireframe===!1&&(_.flatShading===!0||z.attributes.normal===void 0&&Mt===!1&&(_.isMeshLambertMaterial||_.isMeshPhongMaterial||_.isMeshStandardMaterial||_.isMeshPhysicalMaterial)),sizeAttenuation:_.sizeAttenuation===!0,logarithmicDepthBuffer:p,reversedDepthBuffer:Fe,skinning:B.isSkinnedMesh===!0,morphTargets:z.morphAttributes.position!==void 0,morphNormals:z.morphAttributes.normal!==void 0,morphColors:z.morphAttributes.color!==void 0,morphTargetsCount:De,morphTextureStride:Ze,numDirLights:T.directional.length,numPointLights:T.point.length,numSpotLights:T.spot.length,numSpotLightMaps:T.spotLightMap.length,numRectAreaLights:T.rectArea.length,numHemiLights:T.hemi.length,numDirLightShadows:T.directionalShadowMap.length,numPointLightShadows:T.pointShadowMap.length,numSpotLightShadows:T.spotShadowMap.length,numSpotLightShadowsWithMaps:T.numSpotLightShadowsWithMaps,numLightProbes:T.numLightProbes,numLightProbeGrids:j.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:_.dithering,shadowMapEnabled:t.shadowMap.enabled&&I.length>0,shadowMapType:t.shadowMap.type,toneMapping:q,decodeVideoTexture:Ct&&_.map.isVideoTexture===!0&&lt.getTransfer(_.map.colorSpace)===xt,decodeVideoTextureEmissive:O&&_.emissiveMap.isVideoTexture===!0&&lt.getTransfer(_.emissiveMap.colorSpace)===xt,premultipliedAlpha:_.premultipliedAlpha,doubleSided:_.side===Jn,flipSided:_.side===Pn,useDepthPacking:_.depthPacking>=0,depthPacking:_.depthPacking||0,index0AttributeName:_.index0AttributeName,extensionClipCullDistance:G&&_.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(G&&_.extensions.multiDraw===!0||ze)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:_.customProgramCacheKey()};return te.vertexUv1s=l.has(1),te.vertexUv2s=l.has(2),te.vertexUv3s=l.has(3),l.clear(),te}function g(_){let T=[];if(_.shaderID?T.push(_.shaderID):(T.push(_.customVertexShaderID),T.push(_.customFragmentShaderID)),_.defines!==void 0)for(let I in _.defines)T.push(I),T.push(_.defines[I]);return _.isRawShaderMaterial===!1&&(u(T,_),m(T,_),T.push(t.outputColorSpace)),T.push(_.customProgramCacheKey),T.join()}function u(_,T){_.push(T.precision),_.push(T.outputColorSpace),_.push(T.envMapMode),_.push(T.envMapCubeUVHeight),_.push(T.mapUv),_.push(T.alphaMapUv),_.push(T.lightMapUv),_.push(T.aoMapUv),_.push(T.bumpMapUv),_.push(T.normalMapUv),_.push(T.displacementMapUv),_.push(T.emissiveMapUv),_.push(T.metalnessMapUv),_.push(T.roughnessMapUv),_.push(T.anisotropyMapUv),_.push(T.clearcoatMapUv),_.push(T.clearcoatNormalMapUv),_.push(T.clearcoatRoughnessMapUv),_.push(T.iridescenceMapUv),_.push(T.iridescenceThicknessMapUv),_.push(T.sheenColorMapUv),_.push(T.sheenRoughnessMapUv),_.push(T.specularMapUv),_.push(T.specularColorMapUv),_.push(T.specularIntensityMapUv),_.push(T.transmissionMapUv),_.push(T.thicknessMapUv),_.push(T.combine),_.push(T.fogExp2),_.push(T.sizeAttenuation),_.push(T.morphTargetsCount),_.push(T.morphAttributeCount),_.push(T.numDirLights),_.push(T.numPointLights),_.push(T.numSpotLights),_.push(T.numSpotLightMaps),_.push(T.numHemiLights),_.push(T.numRectAreaLights),_.push(T.numDirLightShadows),_.push(T.numPointLightShadows),_.push(T.numSpotLightShadows),_.push(T.numSpotLightShadowsWithMaps),_.push(T.numLightProbes),_.push(T.shadowMapType),_.push(T.toneMapping),_.push(T.numClippingPlanes),_.push(T.numClipIntersection),_.push(T.depthPacking)}function m(_,T){o.disableAll(),T.instancing&&o.enable(0),T.instancingColor&&o.enable(1),T.instancingMorph&&o.enable(2),T.matcap&&o.enable(3),T.envMap&&o.enable(4),T.normalMapObjectSpace&&o.enable(5),T.normalMapTangentSpace&&o.enable(6),T.clearcoat&&o.enable(7),T.iridescence&&o.enable(8),T.alphaTest&&o.enable(9),T.vertexColors&&o.enable(10),T.vertexAlphas&&o.enable(11),T.vertexUv1s&&o.enable(12),T.vertexUv2s&&o.enable(13),T.vertexUv3s&&o.enable(14),T.vertexTangents&&o.enable(15),T.anisotropy&&o.enable(16),T.alphaHash&&o.enable(17),T.batching&&o.enable(18),T.dispersion&&o.enable(19),T.batchingColor&&o.enable(20),T.gradientMap&&o.enable(21),T.packedNormalMap&&o.enable(22),T.vertexNormals&&o.enable(23),_.push(o.mask),o.disableAll(),T.fog&&o.enable(0),T.useFog&&o.enable(1),T.flatShading&&o.enable(2),T.logarithmicDepthBuffer&&o.enable(3),T.reversedDepthBuffer&&o.enable(4),T.skinning&&o.enable(5),T.morphTargets&&o.enable(6),T.morphNormals&&o.enable(7),T.morphColors&&o.enable(8),T.premultipliedAlpha&&o.enable(9),T.shadowMapEnabled&&o.enable(10),T.doubleSided&&o.enable(11),T.flipSided&&o.enable(12),T.useDepthPacking&&o.enable(13),T.dithering&&o.enable(14),T.transmission&&o.enable(15),T.sheen&&o.enable(16),T.opaque&&o.enable(17),T.pointsUvs&&o.enable(18),T.decodeVideoTexture&&o.enable(19),T.decodeVideoTextureEmissive&&o.enable(20),T.alphaToCoverage&&o.enable(21),T.numLightProbeGrids>0&&o.enable(22),_.push(o.mask)}function x(_){let T=f[_.type],I;if(T){let P=Xi[T];I=v0.clone(P.uniforms)}else I=_.uniforms;return I}function S(_,T){let I=d.get(T);return I!==void 0?++I.usedTimes:(I=new sE(t,T,_,r),c.push(I),d.set(T,I)),I}function C(_){if(--_.usedTimes===0){let T=c.indexOf(_);c[T]=c[c.length-1],c.pop(),d.delete(_.cacheKey),_.destroy()}}function b(_){a.remove(_)}function R(){a.dispose()}return{getParameters:M,getProgramCacheKey:g,getUniforms:x,acquireProgram:S,releaseProgram:C,releaseShaderCache:b,programs:c,dispose:R}}function cE(){let t=new WeakMap;function e(o){return t.has(o)}function n(o){let a=t.get(o);return a===void 0&&(a={},t.set(o,a)),a}function i(o){t.delete(o)}function r(o,a,l){t.get(o)[a]=l}function s(){t=new WeakMap}return{has:e,get:n,remove:i,update:r,dispose:s}}function uE(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.material.id!==e.material.id?t.material.id-e.material.id:t.materialVariant!==e.materialVariant?t.materialVariant-e.materialVariant:t.z!==e.z?t.z-e.z:t.id-e.id}function B0(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.z!==e.z?e.z-t.z:t.id-e.id}function k0(){let t=[],e=0,n=[],i=[],r=[];function s(){e=0,n.length=0,i.length=0,r.length=0}function o(h){let f=0;return h.isInstancedMesh&&(f+=2),h.isSkinnedMesh&&(f+=1),f}function a(h,f,v,M,g,u){let m=t[e];return m===void 0?(m={id:h.id,object:h,geometry:f,material:v,materialVariant:o(h),groupOrder:M,renderOrder:h.renderOrder,z:g,group:u},t[e]=m):(m.id=h.id,m.object=h,m.geometry=f,m.material=v,m.materialVariant=o(h),m.groupOrder=M,m.renderOrder=h.renderOrder,m.z=g,m.group=u),e++,m}function l(h,f,v,M,g,u){let m=a(h,f,v,M,g,u);v.transmission>0?i.push(m):v.transparent===!0?r.push(m):n.push(m)}function c(h,f,v,M,g,u){let m=a(h,f,v,M,g,u);v.transmission>0?i.unshift(m):v.transparent===!0?r.unshift(m):n.unshift(m)}function d(h,f){n.length>1&&n.sort(h||uE),i.length>1&&i.sort(f||B0),r.length>1&&r.sort(f||B0)}function p(){for(let h=e,f=t.length;h<f;h++){let v=t[h];if(v.id===null)break;v.id=null,v.object=null,v.geometry=null,v.material=null,v.group=null}}return{opaque:n,transmissive:i,transparent:r,init:s,push:l,unshift:c,finish:p,sort:d}}function hE(){let t=new WeakMap;function e(i,r){let s=t.get(i),o;return s===void 0?(o=new k0,t.set(i,[o])):r>=s.length?(o=new k0,s.push(o)):o=s[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}function dE(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={direction:new D,color:new ct};break;case"SpotLight":n={position:new D,direction:new D,color:new ct,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new D,color:new ct,distance:0,decay:0};break;case"HemisphereLight":n={direction:new D,skyColor:new ct,groundColor:new ct};break;case"RectAreaLight":n={color:new ct,position:new D,halfWidth:new D,halfHeight:new D};break}return t[e.id]=n,n}}}function fE(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Le};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Le};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Le,shadowCameraNear:1,shadowCameraFar:1e3};break}return t[e.id]=n,n}}}var pE=0;function mE(t,e){return(e.castShadow?2:0)-(t.castShadow?2:0)+(e.map?1:0)-(t.map?1:0)}function gE(t){let e=new dE,n=fE(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new D);let r=new D,s=new Dt,o=new Dt;function a(c){let d=0,p=0,h=0;for(let T=0;T<9;T++)i.probe[T].set(0,0,0);let f=0,v=0,M=0,g=0,u=0,m=0,x=0,S=0,C=0,b=0,R=0;c.sort(mE);for(let T=0,I=c.length;T<I;T++){let P=c[T],B=P.color,j=P.intensity,$=P.distance,z=null;if(P.shadow&&P.shadow.map&&(P.shadow.map.texture.format===Vr?z=P.shadow.map.texture:z=P.shadow.map.depthTexture||P.shadow.map.texture),P.isAmbientLight)d+=B.r*j,p+=B.g*j,h+=B.b*j;else if(P.isLightProbe){for(let Y=0;Y<9;Y++)i.probe[Y].addScaledVector(P.sh.coefficients[Y],j);R++}else if(P.isDirectionalLight){let Y=e.get(P);if(Y.color.copy(P.color).multiplyScalar(P.intensity),P.castShadow){let Z=P.shadow,ne=n.get(P);ne.shadowIntensity=Z.intensity,ne.shadowBias=Z.bias,ne.shadowNormalBias=Z.normalBias,ne.shadowRadius=Z.radius,ne.shadowMapSize=Z.mapSize,i.directionalShadow[f]=ne,i.directionalShadowMap[f]=z,i.directionalShadowMatrix[f]=P.shadow.matrix,m++}i.directional[f]=Y,f++}else if(P.isSpotLight){let Y=e.get(P);Y.position.setFromMatrixPosition(P.matrixWorld),Y.color.copy(B).multiplyScalar(j),Y.distance=$,Y.coneCos=Math.cos(P.angle),Y.penumbraCos=Math.cos(P.angle*(1-P.penumbra)),Y.decay=P.decay,i.spot[M]=Y;let Z=P.shadow;if(P.map&&(i.spotLightMap[C]=P.map,C++,Z.updateMatrices(P),P.castShadow&&b++),i.spotLightMatrix[M]=Z.matrix,P.castShadow){let ne=n.get(P);ne.shadowIntensity=Z.intensity,ne.shadowBias=Z.bias,ne.shadowNormalBias=Z.normalBias,ne.shadowRadius=Z.radius,ne.shadowMapSize=Z.mapSize,i.spotShadow[M]=ne,i.spotShadowMap[M]=z,S++}M++}else if(P.isRectAreaLight){let Y=e.get(P);Y.color.copy(B).multiplyScalar(j),Y.halfWidth.set(P.width*.5,0,0),Y.halfHeight.set(0,P.height*.5,0),i.rectArea[g]=Y,g++}else if(P.isPointLight){let Y=e.get(P);if(Y.color.copy(P.color).multiplyScalar(P.intensity),Y.distance=P.distance,Y.decay=P.decay,P.castShadow){let Z=P.shadow,ne=n.get(P);ne.shadowIntensity=Z.intensity,ne.shadowBias=Z.bias,ne.shadowNormalBias=Z.normalBias,ne.shadowRadius=Z.radius,ne.shadowMapSize=Z.mapSize,ne.shadowCameraNear=Z.camera.near,ne.shadowCameraFar=Z.camera.far,i.pointShadow[v]=ne,i.pointShadowMap[v]=z,i.pointShadowMatrix[v]=P.shadow.matrix,x++}i.point[v]=Y,v++}else if(P.isHemisphereLight){let Y=e.get(P);Y.skyColor.copy(P.color).multiplyScalar(j),Y.groundColor.copy(P.groundColor).multiplyScalar(j),i.hemi[u]=Y,u++}}g>0&&(t.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=Se.LTC_FLOAT_1,i.rectAreaLTC2=Se.LTC_FLOAT_2):(i.rectAreaLTC1=Se.LTC_HALF_1,i.rectAreaLTC2=Se.LTC_HALF_2)),i.ambient[0]=d,i.ambient[1]=p,i.ambient[2]=h;let _=i.hash;(_.directionalLength!==f||_.pointLength!==v||_.spotLength!==M||_.rectAreaLength!==g||_.hemiLength!==u||_.numDirectionalShadows!==m||_.numPointShadows!==x||_.numSpotShadows!==S||_.numSpotMaps!==C||_.numLightProbes!==R)&&(i.directional.length=f,i.spot.length=M,i.rectArea.length=g,i.point.length=v,i.hemi.length=u,i.directionalShadow.length=m,i.directionalShadowMap.length=m,i.pointShadow.length=x,i.pointShadowMap.length=x,i.spotShadow.length=S,i.spotShadowMap.length=S,i.directionalShadowMatrix.length=m,i.pointShadowMatrix.length=x,i.spotLightMatrix.length=S+C-b,i.spotLightMap.length=C,i.numSpotLightShadowsWithMaps=b,i.numLightProbes=R,_.directionalLength=f,_.pointLength=v,_.spotLength=M,_.rectAreaLength=g,_.hemiLength=u,_.numDirectionalShadows=m,_.numPointShadows=x,_.numSpotShadows=S,_.numSpotMaps=C,_.numLightProbes=R,i.version=pE++)}function l(c,d){let p=0,h=0,f=0,v=0,M=0,g=d.matrixWorldInverse;for(let u=0,m=c.length;u<m;u++){let x=c[u];if(x.isDirectionalLight){let S=i.directional[p];S.direction.setFromMatrixPosition(x.matrixWorld),r.setFromMatrixPosition(x.target.matrixWorld),S.direction.sub(r),S.direction.transformDirection(g),p++}else if(x.isSpotLight){let S=i.spot[f];S.position.setFromMatrixPosition(x.matrixWorld),S.position.applyMatrix4(g),S.direction.setFromMatrixPosition(x.matrixWorld),r.setFromMatrixPosition(x.target.matrixWorld),S.direction.sub(r),S.direction.transformDirection(g),f++}else if(x.isRectAreaLight){let S=i.rectArea[v];S.position.setFromMatrixPosition(x.matrixWorld),S.position.applyMatrix4(g),o.identity(),s.copy(x.matrixWorld),s.premultiply(g),o.extractRotation(s),S.halfWidth.set(x.width*.5,0,0),S.halfHeight.set(0,x.height*.5,0),S.halfWidth.applyMatrix4(o),S.halfHeight.applyMatrix4(o),v++}else if(x.isPointLight){let S=i.point[h];S.position.setFromMatrixPosition(x.matrixWorld),S.position.applyMatrix4(g),h++}else if(x.isHemisphereLight){let S=i.hemi[M];S.direction.setFromMatrixPosition(x.matrixWorld),S.direction.transformDirection(g),M++}}}return{setup:a,setupView:l,state:i}}function z0(t){let e=new gE(t),n=[],i=[],r=[];function s(h){p.camera=h,n.length=0,i.length=0,r.length=0}function o(h){n.push(h)}function a(h){i.push(h)}function l(h){r.push(h)}function c(){e.setup(n)}function d(h){e.setupView(n,h)}let p={lightsArray:n,shadowsArray:i,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:p,setupLights:c,setupLightsView:d,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function _E(t){let e=new WeakMap;function n(r,s=0){let o=e.get(r),a;return o===void 0?(a=new z0(t),e.set(r,[a])):s>=o.length?(a=new z0(t),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:n,dispose:i}}var vE=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,xE=`uniform sampler2D shadow_pass;
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
}`,yE=[new D(1,0,0),new D(-1,0,0),new D(0,1,0),new D(0,-1,0),new D(0,0,1),new D(0,0,-1)],SE=[new D(0,-1,0),new D(0,-1,0),new D(0,0,1),new D(0,0,-1),new D(0,-1,0),new D(0,-1,0)],V0=new Dt,Fa=new D,Rf=new D;function ME(t,e,n){let i=new ao,r=new Le,s=new Le,o=new Vt,a=new Tc,l=new Ac,c={},d=n.maxTextureSize,p={[sr]:Pn,[Pn]:sr,[Jn]:Jn},h=new jn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Le},radius:{value:4}},vertexShader:vE,fragmentShader:xE}),f=h.clone();f.defines.HORIZONTAL_PASS=1;let v=new Rn;v.setAttribute("position",new Zn(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let M=new vn(v,h),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=xs;let u=this.type;this.render=function(b,R,_){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||b.length===0)return;this.type===Og&&(ke("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=xs);let T=t.getRenderTarget(),I=t.getActiveCubeFace(),P=t.getActiveMipmapLevel(),B=t.state;B.setBlending(Gi),B.buffers.depth.getReversed()===!0?B.buffers.color.setClear(0,0,0,0):B.buffers.color.setClear(1,1,1,1),B.buffers.depth.setTest(!0),B.setScissorTest(!1);let j=u!==this.type;j&&R.traverse(function($){$.material&&(Array.isArray($.material)?$.material.forEach(z=>z.needsUpdate=!0):$.material.needsUpdate=!0)});for(let $=0,z=b.length;$<z;$++){let Y=b[$],Z=Y.shadow;if(Z===void 0){ke("WebGLShadowMap:",Y,"has no shadow.");continue}if(Z.autoUpdate===!1&&Z.needsUpdate===!1)continue;r.copy(Z.mapSize);let ne=Z.getFrameExtents();r.multiply(ne),s.copy(Z.mapSize),(r.x>d||r.y>d)&&(r.x>d&&(s.x=Math.floor(d/ne.x),r.x=s.x*ne.x,Z.mapSize.x=s.x),r.y>d&&(s.y=Math.floor(d/ne.y),r.y=s.y*ne.y,Z.mapSize.y=s.y));let ce=t.state.buffers.depth.getReversed();if(Z.camera._reversedDepth=ce,Z.map===null||j===!0){if(Z.map!==null&&(Z.map.depthTexture!==null&&(Z.map.depthTexture.dispose(),Z.map.depthTexture=null),Z.map.dispose()),this.type===ho){if(Y.isPointLight){ke("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}Z.map=new $n(r.x,r.y,{format:Vr,type:Hi,minFilter:an,magFilter:an,generateMipmaps:!1}),Z.map.texture.name=Y.name+".shadowMap",Z.map.depthTexture=new ar(r.x,r.y,Ci),Z.map.depthTexture.name=Y.name+".shadowMapDepth",Z.map.depthTexture.format=Vi,Z.map.depthTexture.compareFunction=null,Z.map.depthTexture.minFilter=rn,Z.map.depthTexture.magFilter=rn}else Y.isPointLight?(Z.map=new Du(r.x),Z.map.depthTexture=new _c(r.x,Ai)):(Z.map=new $n(r.x,r.y),Z.map.depthTexture=new ar(r.x,r.y,Ai)),Z.map.depthTexture.name=Y.name+".shadowMap",Z.map.depthTexture.format=Vi,this.type===xs?(Z.map.depthTexture.compareFunction=ce?Ru:Cu,Z.map.depthTexture.minFilter=an,Z.map.depthTexture.magFilter=an):(Z.map.depthTexture.compareFunction=null,Z.map.depthTexture.minFilter=rn,Z.map.depthTexture.magFilter=rn);Z.camera.updateProjectionMatrix()}let ue=Z.map.isWebGLCubeRenderTarget?6:1;for(let Ie=0;Ie<ue;Ie++){if(Z.map.isWebGLCubeRenderTarget)t.setRenderTarget(Z.map,Ie),t.clear();else{Ie===0&&(t.setRenderTarget(Z.map),t.clear());let De=Z.getViewport(Ie);o.set(s.x*De.x,s.y*De.y,s.x*De.z,s.y*De.w),B.viewport(o)}if(Y.isPointLight){let De=Z.camera,Ze=Z.matrix,mt=Y.distance||De.far;mt!==De.far&&(De.far=mt,De.updateProjectionMatrix()),Fa.setFromMatrixPosition(Y.matrixWorld),De.position.copy(Fa),Rf.copy(De.position),Rf.add(yE[Ie]),De.up.copy(SE[Ie]),De.lookAt(Rf),De.updateMatrixWorld(),Ze.makeTranslation(-Fa.x,-Fa.y,-Fa.z),V0.multiplyMatrices(De.projectionMatrix,De.matrixWorldInverse),Z._frustum.setFromProjectionMatrix(V0,De.coordinateSystem,De.reversedDepth)}else Z.updateMatrices(Y);i=Z.getFrustum(),S(R,_,Z.camera,Y,this.type)}Z.isPointLightShadow!==!0&&this.type===ho&&m(Z,_),Z.needsUpdate=!1}u=this.type,g.needsUpdate=!1,t.setRenderTarget(T,I,P)};function m(b,R){let _=e.update(M);h.defines.VSM_SAMPLES!==b.blurSamples&&(h.defines.VSM_SAMPLES=b.blurSamples,f.defines.VSM_SAMPLES=b.blurSamples,h.needsUpdate=!0,f.needsUpdate=!0),b.mapPass===null&&(b.mapPass=new $n(r.x,r.y,{format:Vr,type:Hi})),h.uniforms.shadow_pass.value=b.map.depthTexture,h.uniforms.resolution.value=b.mapSize,h.uniforms.radius.value=b.radius,t.setRenderTarget(b.mapPass),t.clear(),t.renderBufferDirect(R,null,_,h,M,null),f.uniforms.shadow_pass.value=b.mapPass.texture,f.uniforms.resolution.value=b.mapSize,f.uniforms.radius.value=b.radius,t.setRenderTarget(b.map),t.clear(),t.renderBufferDirect(R,null,_,f,M,null)}function x(b,R,_,T){let I=null,P=_.isPointLight===!0?b.customDistanceMaterial:b.customDepthMaterial;if(P!==void 0)I=P;else if(I=_.isPointLight===!0?l:a,t.localClippingEnabled&&R.clipShadows===!0&&Array.isArray(R.clippingPlanes)&&R.clippingPlanes.length!==0||R.displacementMap&&R.displacementScale!==0||R.alphaMap&&R.alphaTest>0||R.map&&R.alphaTest>0||R.alphaToCoverage===!0){let B=I.uuid,j=R.uuid,$=c[B];$===void 0&&($={},c[B]=$);let z=$[j];z===void 0&&(z=I.clone(),$[j]=z,R.addEventListener("dispose",C)),I=z}if(I.visible=R.visible,I.wireframe=R.wireframe,T===ho?I.side=R.shadowSide!==null?R.shadowSide:R.side:I.side=R.shadowSide!==null?R.shadowSide:p[R.side],I.alphaMap=R.alphaMap,I.alphaTest=R.alphaToCoverage===!0?.5:R.alphaTest,I.map=R.map,I.clipShadows=R.clipShadows,I.clippingPlanes=R.clippingPlanes,I.clipIntersection=R.clipIntersection,I.displacementMap=R.displacementMap,I.displacementScale=R.displacementScale,I.displacementBias=R.displacementBias,I.wireframeLinewidth=R.wireframeLinewidth,I.linewidth=R.linewidth,_.isPointLight===!0&&I.isMeshDistanceMaterial===!0){let B=t.properties.get(I);B.light=_}return I}function S(b,R,_,T,I){if(b.visible===!1)return;if(b.layers.test(R.layers)&&(b.isMesh||b.isLine||b.isPoints)&&(b.castShadow||b.receiveShadow&&I===ho)&&(!b.frustumCulled||i.intersectsObject(b))){b.modelViewMatrix.multiplyMatrices(_.matrixWorldInverse,b.matrixWorld);let j=e.update(b),$=b.material;if(Array.isArray($)){let z=j.groups;for(let Y=0,Z=z.length;Y<Z;Y++){let ne=z[Y],ce=$[ne.materialIndex];if(ce&&ce.visible){let ue=x(b,ce,T,I);b.onBeforeShadow(t,b,R,_,j,ue,ne),t.renderBufferDirect(_,null,j,ue,b,ne),b.onAfterShadow(t,b,R,_,j,ue,ne)}}}else if($.visible){let z=x(b,$,T,I);b.onBeforeShadow(t,b,R,_,j,z,null),t.renderBufferDirect(_,null,j,z,b,null),b.onAfterShadow(t,b,R,_,j,z,null)}}let B=b.children;for(let j=0,$=B.length;j<$;j++)S(B[j],R,_,T,I)}function C(b){b.target.removeEventListener("dispose",C);for(let _ in c){let T=c[_],I=b.target.uuid;I in T&&(T[I].dispose(),delete T[I])}}}function wE(t,e){function n(){let E=!1,U=new Vt,L=null,k=new Vt(0,0,0,0);return{setMask:function(G){L!==G&&!E&&(t.colorMask(G,G,G,G),L=G)},setLocked:function(G){E=G},setClear:function(G,q,te,he,Ue){Ue===!0&&(G*=he,q*=he,te*=he),U.set(G,q,te,he),k.equals(U)===!1&&(t.clearColor(G,q,te,he),k.copy(U))},reset:function(){E=!1,L=null,k.set(-1,0,0,0)}}}function i(){let E=!1,U=!1,L=null,k=null,G=null;return{setReversed:function(q){if(U!==q){let te=e.get("EXT_clip_control");q?te.clipControlEXT(te.LOWER_LEFT_EXT,te.ZERO_TO_ONE_EXT):te.clipControlEXT(te.LOWER_LEFT_EXT,te.NEGATIVE_ONE_TO_ONE_EXT),U=q;let he=G;G=null,this.setClear(he)}},getReversed:function(){return U},setTest:function(q){q?se(t.DEPTH_TEST):Fe(t.DEPTH_TEST)},setMask:function(q){L!==q&&!E&&(t.depthMask(q),L=q)},setFunc:function(q){if(U&&(q=g0[q]),k!==q){switch(q){case nc:t.depthFunc(t.NEVER);break;case ic:t.depthFunc(t.ALWAYS);break;case rc:t.depthFunc(t.LESS);break;case _s:t.depthFunc(t.LEQUAL);break;case sc:t.depthFunc(t.EQUAL);break;case oc:t.depthFunc(t.GEQUAL);break;case ac:t.depthFunc(t.GREATER);break;case lc:t.depthFunc(t.NOTEQUAL);break;default:t.depthFunc(t.LEQUAL)}k=q}},setLocked:function(q){E=q},setClear:function(q){G!==q&&(G=q,U&&(q=1-q),t.clearDepth(q))},reset:function(){E=!1,L=null,k=null,G=null,U=!1}}}function r(){let E=!1,U=null,L=null,k=null,G=null,q=null,te=null,he=null,Ue=null;return{setTest:function(Ne){E||(Ne?se(t.STENCIL_TEST):Fe(t.STENCIL_TEST))},setMask:function(Ne){U!==Ne&&!E&&(t.stencilMask(Ne),U=Ne)},setFunc:function(Ne,et,vt){(L!==Ne||k!==et||G!==vt)&&(t.stencilFunc(Ne,et,vt),L=Ne,k=et,G=vt)},setOp:function(Ne,et,vt){(q!==Ne||te!==et||he!==vt)&&(t.stencilOp(Ne,et,vt),q=Ne,te=et,he=vt)},setLocked:function(Ne){E=Ne},setClear:function(Ne){Ue!==Ne&&(t.clearStencil(Ne),Ue=Ne)},reset:function(){E=!1,U=null,L=null,k=null,G=null,q=null,te=null,he=null,Ue=null}}}let s=new n,o=new i,a=new r,l=new WeakMap,c=new WeakMap,d={},p={},h={},f=new WeakMap,v=[],M=null,g=!1,u=null,m=null,x=null,S=null,C=null,b=null,R=null,_=new ct(0,0,0),T=0,I=!1,P=null,B=null,j=null,$=null,z=null,Y=t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS),Z=!1,ne=0,ce=t.getParameter(t.VERSION);ce.indexOf("WebGL")!==-1?(ne=parseFloat(/^WebGL (\d)/.exec(ce)[1]),Z=ne>=1):ce.indexOf("OpenGL ES")!==-1&&(ne=parseFloat(/^OpenGL ES (\d)/.exec(ce)[1]),Z=ne>=2);let ue=null,Ie={},De=t.getParameter(t.SCISSOR_BOX),Ze=t.getParameter(t.VIEWPORT),mt=new Vt().fromArray(De),je=new Vt().fromArray(Ze);function ee(E,U,L,k){let G=new Uint8Array(4),q=t.createTexture();t.bindTexture(E,q),t.texParameteri(E,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(E,t.TEXTURE_MAG_FILTER,t.NEAREST);for(let te=0;te<L;te++)E===t.TEXTURE_3D||E===t.TEXTURE_2D_ARRAY?t.texImage3D(U,0,t.RGBA,1,1,k,0,t.RGBA,t.UNSIGNED_BYTE,G):t.texImage2D(U+te,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,G);return q}let oe={};oe[t.TEXTURE_2D]=ee(t.TEXTURE_2D,t.TEXTURE_2D,1),oe[t.TEXTURE_CUBE_MAP]=ee(t.TEXTURE_CUBE_MAP,t.TEXTURE_CUBE_MAP_POSITIVE_X,6),oe[t.TEXTURE_2D_ARRAY]=ee(t.TEXTURE_2D_ARRAY,t.TEXTURE_2D_ARRAY,1,1),oe[t.TEXTURE_3D]=ee(t.TEXTURE_3D,t.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),se(t.DEPTH_TEST),o.setFunc(_s),Yt(!1),Mt(Xd),se(t.CULL_FACE),gt(Gi);function se(E){d[E]!==!0&&(t.enable(E),d[E]=!0)}function Fe(E){d[E]!==!1&&(t.disable(E),d[E]=!1)}function Ve(E,U){return h[E]!==U?(t.bindFramebuffer(E,U),h[E]=U,E===t.DRAW_FRAMEBUFFER&&(h[t.FRAMEBUFFER]=U),E===t.FRAMEBUFFER&&(h[t.DRAW_FRAMEBUFFER]=U),!0):!1}function ze(E,U){let L=v,k=!1;if(E){L=f.get(U),L===void 0&&(L=[],f.set(U,L));let G=E.textures;if(L.length!==G.length||L[0]!==t.COLOR_ATTACHMENT0){for(let q=0,te=G.length;q<te;q++)L[q]=t.COLOR_ATTACHMENT0+q;L.length=G.length,k=!0}}else L[0]!==t.BACK&&(L[0]=t.BACK,k=!0);k&&t.drawBuffers(L)}function Ct(E){return M!==E?(t.useProgram(E),M=E,!0):!1}let tt={[Pr]:t.FUNC_ADD,[kg]:t.FUNC_SUBTRACT,[zg]:t.FUNC_REVERSE_SUBTRACT};tt[Vg]=t.MIN,tt[Gg]=t.MAX;let ht={[Hg]:t.ZERO,[Wg]:t.ONE,[Xg]:t.SRC_COLOR,[ec]:t.SRC_ALPHA,[Kg]:t.SRC_ALPHA_SATURATE,[$g]:t.DST_COLOR,[qg]:t.DST_ALPHA,[Yg]:t.ONE_MINUS_SRC_COLOR,[tc]:t.ONE_MINUS_SRC_ALPHA,[jg]:t.ONE_MINUS_DST_COLOR,[Zg]:t.ONE_MINUS_DST_ALPHA,[Jg]:t.CONSTANT_COLOR,[Qg]:t.ONE_MINUS_CONSTANT_COLOR,[e0]:t.CONSTANT_ALPHA,[t0]:t.ONE_MINUS_CONSTANT_ALPHA};function gt(E,U,L,k,G,q,te,he,Ue,Ne){if(E===Gi){g===!0&&(Fe(t.BLEND),g=!1);return}if(g===!1&&(se(t.BLEND),g=!0),E!==Bg){if(E!==u||Ne!==I){if((m!==Pr||C!==Pr)&&(t.blendEquation(t.FUNC_ADD),m=Pr,C=Pr),Ne)switch(E){case gs:t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case Yd:t.blendFunc(t.ONE,t.ONE);break;case qd:t.blendFuncSeparate(t.ZERO,t.ONE_MINUS_SRC_COLOR,t.ZERO,t.ONE);break;case Zd:t.blendFuncSeparate(t.DST_COLOR,t.ONE_MINUS_SRC_ALPHA,t.ZERO,t.ONE);break;default:We("WebGLState: Invalid blending: ",E);break}else switch(E){case gs:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case Yd:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE,t.ONE,t.ONE);break;case qd:We("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Zd:We("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:We("WebGLState: Invalid blending: ",E);break}x=null,S=null,b=null,R=null,_.set(0,0,0),T=0,u=E,I=Ne}return}G=G||U,q=q||L,te=te||k,(U!==m||G!==C)&&(t.blendEquationSeparate(tt[U],tt[G]),m=U,C=G),(L!==x||k!==S||q!==b||te!==R)&&(t.blendFuncSeparate(ht[L],ht[k],ht[q],ht[te]),x=L,S=k,b=q,R=te),(he.equals(_)===!1||Ue!==T)&&(t.blendColor(he.r,he.g,he.b,Ue),_.copy(he),T=Ue),u=E,I=!1}function Xe(E,U){E.side===Jn?Fe(t.CULL_FACE):se(t.CULL_FACE);let L=E.side===Pn;U&&(L=!L),Yt(L),E.blending===gs&&E.transparent===!1?gt(Gi):gt(E.blending,E.blendEquation,E.blendSrc,E.blendDst,E.blendEquationAlpha,E.blendSrcAlpha,E.blendDstAlpha,E.blendColor,E.blendAlpha,E.premultipliedAlpha),o.setFunc(E.depthFunc),o.setTest(E.depthTest),o.setMask(E.depthWrite),s.setMask(E.colorWrite);let k=E.stencilWrite;a.setTest(k),k&&(a.setMask(E.stencilWriteMask),a.setFunc(E.stencilFunc,E.stencilRef,E.stencilFuncMask),a.setOp(E.stencilFail,E.stencilZFail,E.stencilZPass)),O(E.polygonOffset,E.polygonOffsetFactor,E.polygonOffsetUnits),E.alphaToCoverage===!0?se(t.SAMPLE_ALPHA_TO_COVERAGE):Fe(t.SAMPLE_ALPHA_TO_COVERAGE)}function Yt(E){P!==E&&(E?t.frontFace(t.CW):t.frontFace(t.CCW),P=E)}function Mt(E){E!==Ug?(se(t.CULL_FACE),E!==B&&(E===Xd?t.cullFace(t.BACK):E===Fg?t.cullFace(t.FRONT):t.cullFace(t.FRONT_AND_BACK))):Fe(t.CULL_FACE),B=E}function En(E){E!==j&&(Z&&t.lineWidth(E),j=E)}function O(E,U,L){E?(se(t.POLYGON_OFFSET_FILL),($!==U||z!==L)&&($=U,z=L,o.getReversed()&&(U=-U),t.polygonOffset(U,L))):Fe(t.POLYGON_OFFSET_FILL)}function Ft(E){E?se(t.SCISSOR_TEST):Fe(t.SCISSOR_TEST)}function ot(E){E===void 0&&(E=t.TEXTURE0+Y-1),ue!==E&&(t.activeTexture(E),ue=E)}function ut(E,U,L){L===void 0&&(ue===null?L=t.TEXTURE0+Y-1:L=ue);let k=Ie[L];k===void 0&&(k={type:void 0,texture:void 0},Ie[L]=k),(k.type!==E||k.texture!==U)&&(ue!==L&&(t.activeTexture(L),ue=L),t.bindTexture(E,U||oe[E]),k.type=E,k.texture=U)}function xe(){let E=Ie[ue];E!==void 0&&E.type!==void 0&&(t.bindTexture(E.type,null),E.type=void 0,E.texture=void 0)}function _t(){try{t.compressedTexImage2D(...arguments)}catch(E){We("WebGLState:",E)}}function A(){try{t.compressedTexImage3D(...arguments)}catch(E){We("WebGLState:",E)}}function y(){try{t.texSubImage2D(...arguments)}catch(E){We("WebGLState:",E)}}function W(){try{t.texSubImage3D(...arguments)}catch(E){We("WebGLState:",E)}}function J(){try{t.compressedTexSubImage2D(...arguments)}catch(E){We("WebGLState:",E)}}function ie(){try{t.compressedTexSubImage3D(...arguments)}catch(E){We("WebGLState:",E)}}function fe(){try{t.texStorage2D(...arguments)}catch(E){We("WebGLState:",E)}}function ge(){try{t.texStorage3D(...arguments)}catch(E){We("WebGLState:",E)}}function K(){try{t.texImage2D(...arguments)}catch(E){We("WebGLState:",E)}}function Q(){try{t.texImage3D(...arguments)}catch(E){We("WebGLState:",E)}}function Me(E){return p[E]!==void 0?p[E]:t.getParameter(E)}function Te(E,U){p[E]!==U&&(t.pixelStorei(E,U),p[E]=U)}function me(E){mt.equals(E)===!1&&(t.scissor(E.x,E.y,E.z,E.w),mt.copy(E))}function de(E){je.equals(E)===!1&&(t.viewport(E.x,E.y,E.z,E.w),je.copy(E))}function $e(E,U){let L=c.get(U);L===void 0&&(L=new WeakMap,c.set(U,L));let k=L.get(E);k===void 0&&(k=t.getUniformBlockIndex(U,E.name),L.set(E,k))}function Je(E,U){let k=c.get(U).get(E);l.get(U)!==k&&(t.uniformBlockBinding(U,k,E.__bindingPointIndex),l.set(U,k))}function F(){t.disable(t.BLEND),t.disable(t.CULL_FACE),t.disable(t.DEPTH_TEST),t.disable(t.POLYGON_OFFSET_FILL),t.disable(t.SCISSOR_TEST),t.disable(t.STENCIL_TEST),t.disable(t.SAMPLE_ALPHA_TO_COVERAGE),t.blendEquation(t.FUNC_ADD),t.blendFunc(t.ONE,t.ZERO),t.blendFuncSeparate(t.ONE,t.ZERO,t.ONE,t.ZERO),t.blendColor(0,0,0,0),t.colorMask(!0,!0,!0,!0),t.clearColor(0,0,0,0),t.depthMask(!0),t.depthFunc(t.LESS),o.setReversed(!1),t.clearDepth(1),t.stencilMask(4294967295),t.stencilFunc(t.ALWAYS,0,4294967295),t.stencilOp(t.KEEP,t.KEEP,t.KEEP),t.clearStencil(0),t.cullFace(t.BACK),t.frontFace(t.CCW),t.polygonOffset(0,0),t.activeTexture(t.TEXTURE0),t.bindFramebuffer(t.FRAMEBUFFER,null),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),t.bindFramebuffer(t.READ_FRAMEBUFFER,null),t.useProgram(null),t.lineWidth(1),t.scissor(0,0,t.canvas.width,t.canvas.height),t.viewport(0,0,t.canvas.width,t.canvas.height),t.pixelStorei(t.PACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.BROWSER_DEFAULT_WEBGL),t.pixelStorei(t.PACK_ROW_LENGTH,0),t.pixelStorei(t.PACK_SKIP_PIXELS,0),t.pixelStorei(t.PACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_ROW_LENGTH,0),t.pixelStorei(t.UNPACK_IMAGE_HEIGHT,0),t.pixelStorei(t.UNPACK_SKIP_PIXELS,0),t.pixelStorei(t.UNPACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_SKIP_IMAGES,0),d={},p={},ue=null,Ie={},h={},f=new WeakMap,v=[],M=null,g=!1,u=null,m=null,x=null,S=null,C=null,b=null,R=null,_=new ct(0,0,0),T=0,I=!1,P=null,B=null,j=null,$=null,z=null,mt.set(0,0,t.canvas.width,t.canvas.height),je.set(0,0,t.canvas.width,t.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:se,disable:Fe,bindFramebuffer:Ve,drawBuffers:ze,useProgram:Ct,setBlending:gt,setMaterial:Xe,setFlipSided:Yt,setCullFace:Mt,setLineWidth:En,setPolygonOffset:O,setScissorTest:Ft,activeTexture:ot,bindTexture:ut,unbindTexture:xe,compressedTexImage2D:_t,compressedTexImage3D:A,texImage2D:K,texImage3D:Q,pixelStorei:Te,getParameter:Me,updateUBOMapping:$e,uniformBlockBinding:Je,texStorage2D:fe,texStorage3D:ge,texSubImage2D:y,texSubImage3D:W,compressedTexSubImage2D:J,compressedTexSubImage3D:ie,scissor:me,viewport:de,reset:F}}function bE(t,e,n,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Le,d=new WeakMap,p=new Set,h,f=new WeakMap,v=!1;try{v=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function M(A,y){return v?new OffscreenCanvas(A,y):oa("canvas")}function g(A,y,W){let J=1,ie=_t(A);if((ie.width>W||ie.height>W)&&(J=W/Math.max(ie.width,ie.height)),J<1)if(typeof HTMLImageElement<"u"&&A instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&A instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&A instanceof ImageBitmap||typeof VideoFrame<"u"&&A instanceof VideoFrame){let fe=Math.floor(J*ie.width),ge=Math.floor(J*ie.height);h===void 0&&(h=M(fe,ge));let K=y?M(fe,ge):h;return K.width=fe,K.height=ge,K.getContext("2d").drawImage(A,0,0,fe,ge),ke("WebGLRenderer: Texture has been resized from ("+ie.width+"x"+ie.height+") to ("+fe+"x"+ge+")."),K}else return"data"in A&&ke("WebGLRenderer: Image in DataTexture is too big ("+ie.width+"x"+ie.height+")."),A;return A}function u(A){return A.generateMipmaps}function m(A){t.generateMipmap(A)}function x(A){return A.isWebGLCubeRenderTarget?t.TEXTURE_CUBE_MAP:A.isWebGL3DRenderTarget?t.TEXTURE_3D:A.isWebGLArrayRenderTarget||A.isCompressedArrayTexture?t.TEXTURE_2D_ARRAY:t.TEXTURE_2D}function S(A,y,W,J,ie,fe=!1){if(A!==null){if(t[A]!==void 0)return t[A];ke("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+A+"'")}let ge;J&&(ge=e.get("EXT_texture_norm16"),ge||ke("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let K=y;if(y===t.RED&&(W===t.FLOAT&&(K=t.R32F),W===t.HALF_FLOAT&&(K=t.R16F),W===t.UNSIGNED_BYTE&&(K=t.R8),W===t.UNSIGNED_SHORT&&ge&&(K=ge.R16_EXT),W===t.SHORT&&ge&&(K=ge.R16_SNORM_EXT)),y===t.RED_INTEGER&&(W===t.UNSIGNED_BYTE&&(K=t.R8UI),W===t.UNSIGNED_SHORT&&(K=t.R16UI),W===t.UNSIGNED_INT&&(K=t.R32UI),W===t.BYTE&&(K=t.R8I),W===t.SHORT&&(K=t.R16I),W===t.INT&&(K=t.R32I)),y===t.RG&&(W===t.FLOAT&&(K=t.RG32F),W===t.HALF_FLOAT&&(K=t.RG16F),W===t.UNSIGNED_BYTE&&(K=t.RG8),W===t.UNSIGNED_SHORT&&ge&&(K=ge.RG16_EXT),W===t.SHORT&&ge&&(K=ge.RG16_SNORM_EXT)),y===t.RG_INTEGER&&(W===t.UNSIGNED_BYTE&&(K=t.RG8UI),W===t.UNSIGNED_SHORT&&(K=t.RG16UI),W===t.UNSIGNED_INT&&(K=t.RG32UI),W===t.BYTE&&(K=t.RG8I),W===t.SHORT&&(K=t.RG16I),W===t.INT&&(K=t.RG32I)),y===t.RGB_INTEGER&&(W===t.UNSIGNED_BYTE&&(K=t.RGB8UI),W===t.UNSIGNED_SHORT&&(K=t.RGB16UI),W===t.UNSIGNED_INT&&(K=t.RGB32UI),W===t.BYTE&&(K=t.RGB8I),W===t.SHORT&&(K=t.RGB16I),W===t.INT&&(K=t.RGB32I)),y===t.RGBA_INTEGER&&(W===t.UNSIGNED_BYTE&&(K=t.RGBA8UI),W===t.UNSIGNED_SHORT&&(K=t.RGBA16UI),W===t.UNSIGNED_INT&&(K=t.RGBA32UI),W===t.BYTE&&(K=t.RGBA8I),W===t.SHORT&&(K=t.RGBA16I),W===t.INT&&(K=t.RGBA32I)),y===t.RGB&&(W===t.UNSIGNED_SHORT&&ge&&(K=ge.RGB16_EXT),W===t.SHORT&&ge&&(K=ge.RGB16_SNORM_EXT),W===t.UNSIGNED_INT_5_9_9_9_REV&&(K=t.RGB9_E5),W===t.UNSIGNED_INT_10F_11F_11F_REV&&(K=t.R11F_G11F_B10F)),y===t.RGBA){let Q=fe?sa:lt.getTransfer(ie);W===t.FLOAT&&(K=t.RGBA32F),W===t.HALF_FLOAT&&(K=t.RGBA16F),W===t.UNSIGNED_BYTE&&(K=Q===xt?t.SRGB8_ALPHA8:t.RGBA8),W===t.UNSIGNED_SHORT&&ge&&(K=ge.RGBA16_EXT),W===t.SHORT&&ge&&(K=ge.RGBA16_SNORM_EXT),W===t.UNSIGNED_SHORT_4_4_4_4&&(K=t.RGBA4),W===t.UNSIGNED_SHORT_5_5_5_1&&(K=t.RGB5_A1)}return(K===t.R16F||K===t.R32F||K===t.RG16F||K===t.RG32F||K===t.RGBA16F||K===t.RGBA32F)&&e.get("EXT_color_buffer_float"),K}function C(A,y){let W;return A?y===null||y===Ai||y===po?W=t.DEPTH24_STENCIL8:y===Ci?W=t.DEPTH32F_STENCIL8:y===fo&&(W=t.DEPTH24_STENCIL8,ke("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):y===null||y===Ai||y===po?W=t.DEPTH_COMPONENT24:y===Ci?W=t.DEPTH_COMPONENT32F:y===fo&&(W=t.DEPTH_COMPONENT16),W}function b(A,y){return u(A)===!0||A.isFramebufferTexture&&A.minFilter!==rn&&A.minFilter!==an?Math.log2(Math.max(y.width,y.height))+1:A.mipmaps!==void 0&&A.mipmaps.length>0?A.mipmaps.length:A.isCompressedTexture&&Array.isArray(A.image)?y.mipmaps.length:1}function R(A){let y=A.target;y.removeEventListener("dispose",R),T(y),y.isVideoTexture&&d.delete(y),y.isHTMLTexture&&p.delete(y)}function _(A){let y=A.target;y.removeEventListener("dispose",_),P(y)}function T(A){let y=i.get(A);if(y.__webglInit===void 0)return;let W=A.source,J=f.get(W);if(J){let ie=J[y.__cacheKey];ie.usedTimes--,ie.usedTimes===0&&I(A),Object.keys(J).length===0&&f.delete(W)}i.remove(A)}function I(A){let y=i.get(A);t.deleteTexture(y.__webglTexture);let W=A.source,J=f.get(W);delete J[y.__cacheKey],o.memory.textures--}function P(A){let y=i.get(A);if(A.depthTexture&&(A.depthTexture.dispose(),i.remove(A.depthTexture)),A.isWebGLCubeRenderTarget)for(let J=0;J<6;J++){if(Array.isArray(y.__webglFramebuffer[J]))for(let ie=0;ie<y.__webglFramebuffer[J].length;ie++)t.deleteFramebuffer(y.__webglFramebuffer[J][ie]);else t.deleteFramebuffer(y.__webglFramebuffer[J]);y.__webglDepthbuffer&&t.deleteRenderbuffer(y.__webglDepthbuffer[J])}else{if(Array.isArray(y.__webglFramebuffer))for(let J=0;J<y.__webglFramebuffer.length;J++)t.deleteFramebuffer(y.__webglFramebuffer[J]);else t.deleteFramebuffer(y.__webglFramebuffer);if(y.__webglDepthbuffer&&t.deleteRenderbuffer(y.__webglDepthbuffer),y.__webglMultisampledFramebuffer&&t.deleteFramebuffer(y.__webglMultisampledFramebuffer),y.__webglColorRenderbuffer)for(let J=0;J<y.__webglColorRenderbuffer.length;J++)y.__webglColorRenderbuffer[J]&&t.deleteRenderbuffer(y.__webglColorRenderbuffer[J]);y.__webglDepthRenderbuffer&&t.deleteRenderbuffer(y.__webglDepthRenderbuffer)}let W=A.textures;for(let J=0,ie=W.length;J<ie;J++){let fe=i.get(W[J]);fe.__webglTexture&&(t.deleteTexture(fe.__webglTexture),o.memory.textures--),i.remove(W[J])}i.remove(A)}let B=0;function j(){B=0}function $(){return B}function z(A){B=A}function Y(){let A=B;return A>=r.maxTextures&&ke("WebGLTextures: Trying to use "+A+" texture units while this GPU supports only "+r.maxTextures),B+=1,A}function Z(A){let y=[];return y.push(A.wrapS),y.push(A.wrapT),y.push(A.wrapR||0),y.push(A.magFilter),y.push(A.minFilter),y.push(A.anisotropy),y.push(A.internalFormat),y.push(A.format),y.push(A.type),y.push(A.generateMipmaps),y.push(A.premultiplyAlpha),y.push(A.flipY),y.push(A.unpackAlignment),y.push(A.colorSpace),y.join()}function ne(A,y){let W=i.get(A);if(A.isVideoTexture&&ut(A),A.isRenderTargetTexture===!1&&A.isExternalTexture!==!0&&A.version>0&&W.__version!==A.version){let J=A.image;if(J===null)ke("WebGLRenderer: Texture marked for update but no image data found.");else if(J.complete===!1)ke("WebGLRenderer: Texture marked for update but image is incomplete");else{Fe(W,A,y);return}}else A.isExternalTexture&&(W.__webglTexture=A.sourceTexture?A.sourceTexture:null);n.bindTexture(t.TEXTURE_2D,W.__webglTexture,t.TEXTURE0+y)}function ce(A,y){let W=i.get(A);if(A.isRenderTargetTexture===!1&&A.version>0&&W.__version!==A.version){Fe(W,A,y);return}else A.isExternalTexture&&(W.__webglTexture=A.sourceTexture?A.sourceTexture:null);n.bindTexture(t.TEXTURE_2D_ARRAY,W.__webglTexture,t.TEXTURE0+y)}function ue(A,y){let W=i.get(A);if(A.isRenderTargetTexture===!1&&A.version>0&&W.__version!==A.version){Fe(W,A,y);return}n.bindTexture(t.TEXTURE_3D,W.__webglTexture,t.TEXTURE0+y)}function Ie(A,y){let W=i.get(A);if(A.isCubeDepthTexture!==!0&&A.version>0&&W.__version!==A.version){Ve(W,A,y);return}n.bindTexture(t.TEXTURE_CUBE_MAP,W.__webglTexture,t.TEXTURE0+y)}let De={[cc]:t.REPEAT,[zi]:t.CLAMP_TO_EDGE,[uc]:t.MIRRORED_REPEAT},Ze={[rn]:t.NEAREST,[r0]:t.NEAREST_MIPMAP_NEAREST,[Ca]:t.NEAREST_MIPMAP_LINEAR,[an]:t.LINEAR,[Wc]:t.LINEAR_MIPMAP_NEAREST,[kr]:t.LINEAR_MIPMAP_LINEAR},mt={[a0]:t.NEVER,[d0]:t.ALWAYS,[l0]:t.LESS,[Cu]:t.LEQUAL,[c0]:t.EQUAL,[Ru]:t.GEQUAL,[u0]:t.GREATER,[h0]:t.NOTEQUAL};function je(A,y){if(y.type===Ci&&e.has("OES_texture_float_linear")===!1&&(y.magFilter===an||y.magFilter===Wc||y.magFilter===Ca||y.magFilter===kr||y.minFilter===an||y.minFilter===Wc||y.minFilter===Ca||y.minFilter===kr)&&ke("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),t.texParameteri(A,t.TEXTURE_WRAP_S,De[y.wrapS]),t.texParameteri(A,t.TEXTURE_WRAP_T,De[y.wrapT]),(A===t.TEXTURE_3D||A===t.TEXTURE_2D_ARRAY)&&t.texParameteri(A,t.TEXTURE_WRAP_R,De[y.wrapR]),t.texParameteri(A,t.TEXTURE_MAG_FILTER,Ze[y.magFilter]),t.texParameteri(A,t.TEXTURE_MIN_FILTER,Ze[y.minFilter]),y.compareFunction&&(t.texParameteri(A,t.TEXTURE_COMPARE_MODE,t.COMPARE_REF_TO_TEXTURE),t.texParameteri(A,t.TEXTURE_COMPARE_FUNC,mt[y.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(y.magFilter===rn||y.minFilter!==Ca&&y.minFilter!==kr||y.type===Ci&&e.has("OES_texture_float_linear")===!1)return;if(y.anisotropy>1||i.get(y).__currentAnisotropy){let W=e.get("EXT_texture_filter_anisotropic");t.texParameterf(A,W.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(y.anisotropy,r.getMaxAnisotropy())),i.get(y).__currentAnisotropy=y.anisotropy}}}function ee(A,y){let W=!1;A.__webglInit===void 0&&(A.__webglInit=!0,y.addEventListener("dispose",R));let J=y.source,ie=f.get(J);ie===void 0&&(ie={},f.set(J,ie));let fe=Z(y);if(fe!==A.__cacheKey){ie[fe]===void 0&&(ie[fe]={texture:t.createTexture(),usedTimes:0},o.memory.textures++,W=!0),ie[fe].usedTimes++;let ge=ie[A.__cacheKey];ge!==void 0&&(ie[A.__cacheKey].usedTimes--,ge.usedTimes===0&&I(y)),A.__cacheKey=fe,A.__webglTexture=ie[fe].texture}return W}function oe(A,y,W){return Math.floor(Math.floor(A/W)/y)}function se(A,y,W,J){let fe=A.updateRanges;if(fe.length===0)n.texSubImage2D(t.TEXTURE_2D,0,0,0,y.width,y.height,W,J,y.data);else{fe.sort((Te,me)=>Te.start-me.start);let ge=0;for(let Te=1;Te<fe.length;Te++){let me=fe[ge],de=fe[Te],$e=me.start+me.count,Je=oe(de.start,y.width,4),F=oe(me.start,y.width,4);de.start<=$e+1&&Je===F&&oe(de.start+de.count-1,y.width,4)===Je?me.count=Math.max(me.count,de.start+de.count-me.start):(++ge,fe[ge]=de)}fe.length=ge+1;let K=n.getParameter(t.UNPACK_ROW_LENGTH),Q=n.getParameter(t.UNPACK_SKIP_PIXELS),Me=n.getParameter(t.UNPACK_SKIP_ROWS);n.pixelStorei(t.UNPACK_ROW_LENGTH,y.width);for(let Te=0,me=fe.length;Te<me;Te++){let de=fe[Te],$e=Math.floor(de.start/4),Je=Math.ceil(de.count/4),F=$e%y.width,E=Math.floor($e/y.width),U=Je,L=1;n.pixelStorei(t.UNPACK_SKIP_PIXELS,F),n.pixelStorei(t.UNPACK_SKIP_ROWS,E),n.texSubImage2D(t.TEXTURE_2D,0,F,E,U,L,W,J,y.data)}A.clearUpdateRanges(),n.pixelStorei(t.UNPACK_ROW_LENGTH,K),n.pixelStorei(t.UNPACK_SKIP_PIXELS,Q),n.pixelStorei(t.UNPACK_SKIP_ROWS,Me)}}function Fe(A,y,W){let J=t.TEXTURE_2D;(y.isDataArrayTexture||y.isCompressedArrayTexture)&&(J=t.TEXTURE_2D_ARRAY),y.isData3DTexture&&(J=t.TEXTURE_3D);let ie=ee(A,y),fe=y.source;n.bindTexture(J,A.__webglTexture,t.TEXTURE0+W);let ge=i.get(fe);if(fe.version!==ge.__version||ie===!0){if(n.activeTexture(t.TEXTURE0+W),(typeof ImageBitmap<"u"&&y.image instanceof ImageBitmap)===!1){let L=lt.getPrimaries(lt.workingColorSpace),k=y.colorSpace===cr?null:lt.getPrimaries(y.colorSpace),G=y.colorSpace===cr||L===k?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,y.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,G)}n.pixelStorei(t.UNPACK_ALIGNMENT,y.unpackAlignment);let Q=g(y.image,!1,r.maxTextureSize);Q=xe(y,Q);let Me=s.convert(y.format,y.colorSpace),Te=s.convert(y.type),me=S(y.internalFormat,Me,Te,y.normalized,y.colorSpace,y.isVideoTexture);je(J,y);let de,$e=y.mipmaps,Je=y.isVideoTexture!==!0,F=ge.__version===void 0||ie===!0,E=fe.dataReady,U=b(y,Q);if(y.isDepthTexture)me=C(y.format===zr,y.type),F&&(Je?n.texStorage2D(t.TEXTURE_2D,1,me,Q.width,Q.height):n.texImage2D(t.TEXTURE_2D,0,me,Q.width,Q.height,0,Me,Te,null));else if(y.isDataTexture)if($e.length>0){Je&&F&&n.texStorage2D(t.TEXTURE_2D,U,me,$e[0].width,$e[0].height);for(let L=0,k=$e.length;L<k;L++)de=$e[L],Je?E&&n.texSubImage2D(t.TEXTURE_2D,L,0,0,de.width,de.height,Me,Te,de.data):n.texImage2D(t.TEXTURE_2D,L,me,de.width,de.height,0,Me,Te,de.data);y.generateMipmaps=!1}else Je?(F&&n.texStorage2D(t.TEXTURE_2D,U,me,Q.width,Q.height),E&&se(y,Q,Me,Te)):n.texImage2D(t.TEXTURE_2D,0,me,Q.width,Q.height,0,Me,Te,Q.data);else if(y.isCompressedTexture)if(y.isCompressedArrayTexture){Je&&F&&n.texStorage3D(t.TEXTURE_2D_ARRAY,U,me,$e[0].width,$e[0].height,Q.depth);for(let L=0,k=$e.length;L<k;L++)if(de=$e[L],y.format!==ui)if(Me!==null)if(Je){if(E)if(y.layerUpdates.size>0){let G=vf(de.width,de.height,y.format,y.type);for(let q of y.layerUpdates){let te=de.data.subarray(q*G/de.data.BYTES_PER_ELEMENT,(q+1)*G/de.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,L,0,0,q,de.width,de.height,1,Me,te)}y.clearLayerUpdates()}else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,L,0,0,0,de.width,de.height,Q.depth,Me,de.data)}else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY,L,me,de.width,de.height,Q.depth,0,de.data,0,0);else ke("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Je?E&&n.texSubImage3D(t.TEXTURE_2D_ARRAY,L,0,0,0,de.width,de.height,Q.depth,Me,Te,de.data):n.texImage3D(t.TEXTURE_2D_ARRAY,L,me,de.width,de.height,Q.depth,0,Me,Te,de.data)}else{Je&&F&&n.texStorage2D(t.TEXTURE_2D,U,me,$e[0].width,$e[0].height);for(let L=0,k=$e.length;L<k;L++)de=$e[L],y.format!==ui?Me!==null?Je?E&&n.compressedTexSubImage2D(t.TEXTURE_2D,L,0,0,de.width,de.height,Me,de.data):n.compressedTexImage2D(t.TEXTURE_2D,L,me,de.width,de.height,0,de.data):ke("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Je?E&&n.texSubImage2D(t.TEXTURE_2D,L,0,0,de.width,de.height,Me,Te,de.data):n.texImage2D(t.TEXTURE_2D,L,me,de.width,de.height,0,Me,Te,de.data)}else if(y.isDataArrayTexture)if(Je){if(F&&n.texStorage3D(t.TEXTURE_2D_ARRAY,U,me,Q.width,Q.height,Q.depth),E)if(y.layerUpdates.size>0){let L=vf(Q.width,Q.height,y.format,y.type);for(let k of y.layerUpdates){let G=Q.data.subarray(k*L/Q.data.BYTES_PER_ELEMENT,(k+1)*L/Q.data.BYTES_PER_ELEMENT);n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,k,Q.width,Q.height,1,Me,Te,G)}y.clearLayerUpdates()}else n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,0,Q.width,Q.height,Q.depth,Me,Te,Q.data)}else n.texImage3D(t.TEXTURE_2D_ARRAY,0,me,Q.width,Q.height,Q.depth,0,Me,Te,Q.data);else if(y.isData3DTexture)Je?(F&&n.texStorage3D(t.TEXTURE_3D,U,me,Q.width,Q.height,Q.depth),E&&n.texSubImage3D(t.TEXTURE_3D,0,0,0,0,Q.width,Q.height,Q.depth,Me,Te,Q.data)):n.texImage3D(t.TEXTURE_3D,0,me,Q.width,Q.height,Q.depth,0,Me,Te,Q.data);else if(y.isFramebufferTexture){if(F)if(Je)n.texStorage2D(t.TEXTURE_2D,U,me,Q.width,Q.height);else{let L=Q.width,k=Q.height;for(let G=0;G<U;G++)n.texImage2D(t.TEXTURE_2D,G,me,L,k,0,Me,Te,null),L>>=1,k>>=1}}else if(y.isHTMLTexture){if("texElementImage2D"in t){let L=t.canvas;if(L.hasAttribute("layoutsubtree")||L.setAttribute("layoutsubtree","true"),Q.parentNode!==L){L.appendChild(Q),p.add(y),L.onpaint=he=>{let Ue=he.changedElements;for(let Ne of p)Ue.includes(Ne.image)&&(Ne.needsUpdate=!0)},L.requestPaint();return}let k=0,G=t.RGBA,q=t.RGBA,te=t.UNSIGNED_BYTE;t.texElementImage2D(t.TEXTURE_2D,k,G,q,te,Q),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE)}}else if($e.length>0){if(Je&&F){let L=_t($e[0]);n.texStorage2D(t.TEXTURE_2D,U,me,L.width,L.height)}for(let L=0,k=$e.length;L<k;L++)de=$e[L],Je?E&&n.texSubImage2D(t.TEXTURE_2D,L,0,0,Me,Te,de):n.texImage2D(t.TEXTURE_2D,L,me,Me,Te,de);y.generateMipmaps=!1}else if(Je){if(F){let L=_t(Q);n.texStorage2D(t.TEXTURE_2D,U,me,L.width,L.height)}E&&n.texSubImage2D(t.TEXTURE_2D,0,0,0,Me,Te,Q)}else n.texImage2D(t.TEXTURE_2D,0,me,Me,Te,Q);u(y)&&m(J),ge.__version=fe.version,y.onUpdate&&y.onUpdate(y)}A.__version=y.version}function Ve(A,y,W){if(y.image.length!==6)return;let J=ee(A,y),ie=y.source;n.bindTexture(t.TEXTURE_CUBE_MAP,A.__webglTexture,t.TEXTURE0+W);let fe=i.get(ie);if(ie.version!==fe.__version||J===!0){n.activeTexture(t.TEXTURE0+W);let ge=lt.getPrimaries(lt.workingColorSpace),K=y.colorSpace===cr?null:lt.getPrimaries(y.colorSpace),Q=y.colorSpace===cr||ge===K?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,y.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),n.pixelStorei(t.UNPACK_ALIGNMENT,y.unpackAlignment),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,Q);let Me=y.isCompressedTexture||y.image[0].isCompressedTexture,Te=y.image[0]&&y.image[0].isDataTexture,me=[];for(let q=0;q<6;q++)!Me&&!Te?me[q]=g(y.image[q],!0,r.maxCubemapSize):me[q]=Te?y.image[q].image:y.image[q],me[q]=xe(y,me[q]);let de=me[0],$e=s.convert(y.format,y.colorSpace),Je=s.convert(y.type),F=S(y.internalFormat,$e,Je,y.normalized,y.colorSpace),E=y.isVideoTexture!==!0,U=fe.__version===void 0||J===!0,L=ie.dataReady,k=b(y,de);je(t.TEXTURE_CUBE_MAP,y);let G;if(Me){E&&U&&n.texStorage2D(t.TEXTURE_CUBE_MAP,k,F,de.width,de.height);for(let q=0;q<6;q++){G=me[q].mipmaps;for(let te=0;te<G.length;te++){let he=G[te];y.format!==ui?$e!==null?E?L&&n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,te,0,0,he.width,he.height,$e,he.data):n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,te,F,he.width,he.height,0,he.data):ke("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):E?L&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,te,0,0,he.width,he.height,$e,Je,he.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,te,F,he.width,he.height,0,$e,Je,he.data)}}}else{if(G=y.mipmaps,E&&U){G.length>0&&k++;let q=_t(me[0]);n.texStorage2D(t.TEXTURE_CUBE_MAP,k,F,q.width,q.height)}for(let q=0;q<6;q++)if(Te){E?L&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,0,0,0,me[q].width,me[q].height,$e,Je,me[q].data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,0,F,me[q].width,me[q].height,0,$e,Je,me[q].data);for(let te=0;te<G.length;te++){let Ue=G[te].image[q].image;E?L&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,te+1,0,0,Ue.width,Ue.height,$e,Je,Ue.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,te+1,F,Ue.width,Ue.height,0,$e,Je,Ue.data)}}else{E?L&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,0,0,0,$e,Je,me[q]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,0,F,$e,Je,me[q]);for(let te=0;te<G.length;te++){let he=G[te];E?L&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,te+1,0,0,$e,Je,he.image[q]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+q,te+1,F,$e,Je,he.image[q])}}}u(y)&&m(t.TEXTURE_CUBE_MAP),fe.__version=ie.version,y.onUpdate&&y.onUpdate(y)}A.__version=y.version}function ze(A,y,W,J,ie,fe){let ge=s.convert(W.format,W.colorSpace),K=s.convert(W.type),Q=S(W.internalFormat,ge,K,W.normalized,W.colorSpace),Me=i.get(y),Te=i.get(W);if(Te.__renderTarget=y,!Me.__hasExternalTextures){let me=Math.max(1,y.width>>fe),de=Math.max(1,y.height>>fe);ie===t.TEXTURE_3D||ie===t.TEXTURE_2D_ARRAY?n.texImage3D(ie,fe,Q,me,de,y.depth,0,ge,K,null):n.texImage2D(ie,fe,Q,me,de,0,ge,K,null)}n.bindFramebuffer(t.FRAMEBUFFER,A),ot(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,J,ie,Te.__webglTexture,0,Ft(y)):(ie===t.TEXTURE_2D||ie>=t.TEXTURE_CUBE_MAP_POSITIVE_X&&ie<=t.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&t.framebufferTexture2D(t.FRAMEBUFFER,J,ie,Te.__webglTexture,fe),n.bindFramebuffer(t.FRAMEBUFFER,null)}function Ct(A,y,W){if(t.bindRenderbuffer(t.RENDERBUFFER,A),y.depthBuffer){let J=y.depthTexture,ie=J&&J.isDepthTexture?J.type:null,fe=C(y.stencilBuffer,ie),ge=y.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;ot(y)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,Ft(y),fe,y.width,y.height):W?t.renderbufferStorageMultisample(t.RENDERBUFFER,Ft(y),fe,y.width,y.height):t.renderbufferStorage(t.RENDERBUFFER,fe,y.width,y.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,ge,t.RENDERBUFFER,A)}else{let J=y.textures;for(let ie=0;ie<J.length;ie++){let fe=J[ie],ge=s.convert(fe.format,fe.colorSpace),K=s.convert(fe.type),Q=S(fe.internalFormat,ge,K,fe.normalized,fe.colorSpace);ot(y)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,Ft(y),Q,y.width,y.height):W?t.renderbufferStorageMultisample(t.RENDERBUFFER,Ft(y),Q,y.width,y.height):t.renderbufferStorage(t.RENDERBUFFER,Q,y.width,y.height)}}t.bindRenderbuffer(t.RENDERBUFFER,null)}function tt(A,y,W){let J=y.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(t.FRAMEBUFFER,A),!(y.depthTexture&&y.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let ie=i.get(y.depthTexture);if(ie.__renderTarget=y,(!ie.__webglTexture||y.depthTexture.image.width!==y.width||y.depthTexture.image.height!==y.height)&&(y.depthTexture.image.width=y.width,y.depthTexture.image.height=y.height,y.depthTexture.needsUpdate=!0),J){if(ie.__webglInit===void 0&&(ie.__webglInit=!0,y.depthTexture.addEventListener("dispose",R)),ie.__webglTexture===void 0){ie.__webglTexture=t.createTexture(),n.bindTexture(t.TEXTURE_CUBE_MAP,ie.__webglTexture),je(t.TEXTURE_CUBE_MAP,y.depthTexture);let Me=s.convert(y.depthTexture.format),Te=s.convert(y.depthTexture.type),me;y.depthTexture.format===Vi?me=t.DEPTH_COMPONENT24:y.depthTexture.format===zr&&(me=t.DEPTH24_STENCIL8);for(let de=0;de<6;de++)t.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+de,0,me,y.width,y.height,0,Me,Te,null)}}else ne(y.depthTexture,0);let fe=ie.__webglTexture,ge=Ft(y),K=J?t.TEXTURE_CUBE_MAP_POSITIVE_X+W:t.TEXTURE_2D,Q=y.depthTexture.format===zr?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;if(y.depthTexture.format===Vi)ot(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,Q,K,fe,0,ge):t.framebufferTexture2D(t.FRAMEBUFFER,Q,K,fe,0);else if(y.depthTexture.format===zr)ot(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,Q,K,fe,0,ge):t.framebufferTexture2D(t.FRAMEBUFFER,Q,K,fe,0);else throw new Error("Unknown depthTexture format")}function ht(A){let y=i.get(A),W=A.isWebGLCubeRenderTarget===!0;if(y.__boundDepthTexture!==A.depthTexture){let J=A.depthTexture;if(y.__depthDisposeCallback&&y.__depthDisposeCallback(),J){let ie=()=>{delete y.__boundDepthTexture,delete y.__depthDisposeCallback,J.removeEventListener("dispose",ie)};J.addEventListener("dispose",ie),y.__depthDisposeCallback=ie}y.__boundDepthTexture=J}if(A.depthTexture&&!y.__autoAllocateDepthBuffer)if(W)for(let J=0;J<6;J++)tt(y.__webglFramebuffer[J],A,J);else{let J=A.texture.mipmaps;J&&J.length>0?tt(y.__webglFramebuffer[0],A,0):tt(y.__webglFramebuffer,A,0)}else if(W){y.__webglDepthbuffer=[];for(let J=0;J<6;J++)if(n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer[J]),y.__webglDepthbuffer[J]===void 0)y.__webglDepthbuffer[J]=t.createRenderbuffer(),Ct(y.__webglDepthbuffer[J],A,!1);else{let ie=A.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,fe=y.__webglDepthbuffer[J];t.bindRenderbuffer(t.RENDERBUFFER,fe),t.framebufferRenderbuffer(t.FRAMEBUFFER,ie,t.RENDERBUFFER,fe)}}else{let J=A.texture.mipmaps;if(J&&J.length>0?n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer[0]):n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer),y.__webglDepthbuffer===void 0)y.__webglDepthbuffer=t.createRenderbuffer(),Ct(y.__webglDepthbuffer,A,!1);else{let ie=A.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,fe=y.__webglDepthbuffer;t.bindRenderbuffer(t.RENDERBUFFER,fe),t.framebufferRenderbuffer(t.FRAMEBUFFER,ie,t.RENDERBUFFER,fe)}}n.bindFramebuffer(t.FRAMEBUFFER,null)}function gt(A,y,W){let J=i.get(A);y!==void 0&&ze(J.__webglFramebuffer,A,A.texture,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,0),W!==void 0&&ht(A)}function Xe(A){let y=A.texture,W=i.get(A),J=i.get(y);A.addEventListener("dispose",_);let ie=A.textures,fe=A.isWebGLCubeRenderTarget===!0,ge=ie.length>1;if(ge||(J.__webglTexture===void 0&&(J.__webglTexture=t.createTexture()),J.__version=y.version,o.memory.textures++),fe){W.__webglFramebuffer=[];for(let K=0;K<6;K++)if(y.mipmaps&&y.mipmaps.length>0){W.__webglFramebuffer[K]=[];for(let Q=0;Q<y.mipmaps.length;Q++)W.__webglFramebuffer[K][Q]=t.createFramebuffer()}else W.__webglFramebuffer[K]=t.createFramebuffer()}else{if(y.mipmaps&&y.mipmaps.length>0){W.__webglFramebuffer=[];for(let K=0;K<y.mipmaps.length;K++)W.__webglFramebuffer[K]=t.createFramebuffer()}else W.__webglFramebuffer=t.createFramebuffer();if(ge)for(let K=0,Q=ie.length;K<Q;K++){let Me=i.get(ie[K]);Me.__webglTexture===void 0&&(Me.__webglTexture=t.createTexture(),o.memory.textures++)}if(A.samples>0&&ot(A)===!1){W.__webglMultisampledFramebuffer=t.createFramebuffer(),W.__webglColorRenderbuffer=[],n.bindFramebuffer(t.FRAMEBUFFER,W.__webglMultisampledFramebuffer);for(let K=0;K<ie.length;K++){let Q=ie[K];W.__webglColorRenderbuffer[K]=t.createRenderbuffer(),t.bindRenderbuffer(t.RENDERBUFFER,W.__webglColorRenderbuffer[K]);let Me=s.convert(Q.format,Q.colorSpace),Te=s.convert(Q.type),me=S(Q.internalFormat,Me,Te,Q.normalized,Q.colorSpace,A.isXRRenderTarget===!0),de=Ft(A);t.renderbufferStorageMultisample(t.RENDERBUFFER,de,me,A.width,A.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+K,t.RENDERBUFFER,W.__webglColorRenderbuffer[K])}t.bindRenderbuffer(t.RENDERBUFFER,null),A.depthBuffer&&(W.__webglDepthRenderbuffer=t.createRenderbuffer(),Ct(W.__webglDepthRenderbuffer,A,!0)),n.bindFramebuffer(t.FRAMEBUFFER,null)}}if(fe){n.bindTexture(t.TEXTURE_CUBE_MAP,J.__webglTexture),je(t.TEXTURE_CUBE_MAP,y);for(let K=0;K<6;K++)if(y.mipmaps&&y.mipmaps.length>0)for(let Q=0;Q<y.mipmaps.length;Q++)ze(W.__webglFramebuffer[K][Q],A,y,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+K,Q);else ze(W.__webglFramebuffer[K],A,y,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+K,0);u(y)&&m(t.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(ge){for(let K=0,Q=ie.length;K<Q;K++){let Me=ie[K],Te=i.get(Me),me=t.TEXTURE_2D;(A.isWebGL3DRenderTarget||A.isWebGLArrayRenderTarget)&&(me=A.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(me,Te.__webglTexture),je(me,Me),ze(W.__webglFramebuffer,A,Me,t.COLOR_ATTACHMENT0+K,me,0),u(Me)&&m(me)}n.unbindTexture()}else{let K=t.TEXTURE_2D;if((A.isWebGL3DRenderTarget||A.isWebGLArrayRenderTarget)&&(K=A.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(K,J.__webglTexture),je(K,y),y.mipmaps&&y.mipmaps.length>0)for(let Q=0;Q<y.mipmaps.length;Q++)ze(W.__webglFramebuffer[Q],A,y,t.COLOR_ATTACHMENT0,K,Q);else ze(W.__webglFramebuffer,A,y,t.COLOR_ATTACHMENT0,K,0);u(y)&&m(K),n.unbindTexture()}A.depthBuffer&&ht(A)}function Yt(A){let y=A.textures;for(let W=0,J=y.length;W<J;W++){let ie=y[W];if(u(ie)){let fe=x(A),ge=i.get(ie).__webglTexture;n.bindTexture(fe,ge),m(fe),n.unbindTexture()}}}let Mt=[],En=[];function O(A){if(A.samples>0){if(ot(A)===!1){let y=A.textures,W=A.width,J=A.height,ie=t.COLOR_BUFFER_BIT,fe=A.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,ge=i.get(A),K=y.length>1;if(K)for(let Me=0;Me<y.length;Me++)n.bindFramebuffer(t.FRAMEBUFFER,ge.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Me,t.RENDERBUFFER,null),n.bindFramebuffer(t.FRAMEBUFFER,ge.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Me,t.TEXTURE_2D,null,0);n.bindFramebuffer(t.READ_FRAMEBUFFER,ge.__webglMultisampledFramebuffer);let Q=A.texture.mipmaps;Q&&Q.length>0?n.bindFramebuffer(t.DRAW_FRAMEBUFFER,ge.__webglFramebuffer[0]):n.bindFramebuffer(t.DRAW_FRAMEBUFFER,ge.__webglFramebuffer);for(let Me=0;Me<y.length;Me++){if(A.resolveDepthBuffer&&(A.depthBuffer&&(ie|=t.DEPTH_BUFFER_BIT),A.stencilBuffer&&A.resolveStencilBuffer&&(ie|=t.STENCIL_BUFFER_BIT)),K){t.framebufferRenderbuffer(t.READ_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.RENDERBUFFER,ge.__webglColorRenderbuffer[Me]);let Te=i.get(y[Me]).__webglTexture;t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,Te,0)}t.blitFramebuffer(0,0,W,J,0,0,W,J,ie,t.NEAREST),l===!0&&(Mt.length=0,En.length=0,Mt.push(t.COLOR_ATTACHMENT0+Me),A.depthBuffer&&A.resolveDepthBuffer===!1&&(Mt.push(fe),En.push(fe),t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,En)),t.invalidateFramebuffer(t.READ_FRAMEBUFFER,Mt))}if(n.bindFramebuffer(t.READ_FRAMEBUFFER,null),n.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),K)for(let Me=0;Me<y.length;Me++){n.bindFramebuffer(t.FRAMEBUFFER,ge.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Me,t.RENDERBUFFER,ge.__webglColorRenderbuffer[Me]);let Te=i.get(y[Me]).__webglTexture;n.bindFramebuffer(t.FRAMEBUFFER,ge.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Me,t.TEXTURE_2D,Te,0)}n.bindFramebuffer(t.DRAW_FRAMEBUFFER,ge.__webglMultisampledFramebuffer)}else if(A.depthBuffer&&A.resolveDepthBuffer===!1&&l){let y=A.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,[y])}}}function Ft(A){return Math.min(r.maxSamples,A.samples)}function ot(A){let y=i.get(A);return A.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&y.__useRenderToTexture!==!1}function ut(A){let y=o.render.frame;d.get(A)!==y&&(d.set(A,y),A.update())}function xe(A,y){let W=A.colorSpace,J=A.format,ie=A.type;return A.isCompressedTexture===!0||A.isVideoTexture===!0||W!==ra&&W!==cr&&(lt.getTransfer(W)===xt?(J!==ui||ie!==On)&&ke("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):We("WebGLTextures: Unsupported texture color space:",W)),y}function _t(A){return typeof HTMLImageElement<"u"&&A instanceof HTMLImageElement?(c.width=A.naturalWidth||A.width,c.height=A.naturalHeight||A.height):typeof VideoFrame<"u"&&A instanceof VideoFrame?(c.width=A.displayWidth,c.height=A.displayHeight):(c.width=A.width,c.height=A.height),c}this.allocateTextureUnit=Y,this.resetTextureUnits=j,this.getTextureUnits=$,this.setTextureUnits=z,this.setTexture2D=ne,this.setTexture2DArray=ce,this.setTexture3D=ue,this.setTextureCube=Ie,this.rebindTextures=gt,this.setupRenderTarget=Xe,this.updateRenderTargetMipmap=Yt,this.updateMultisampleRenderTarget=O,this.setupDepthRenderbuffer=ht,this.setupFrameBufferTexture=ze,this.useMultisampledRTT=ot,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function EE(t,e){function n(i,r=cr){let s,o=lt.getTransfer(r);if(i===On)return t.UNSIGNED_BYTE;if(i===Yc)return t.UNSIGNED_SHORT_4_4_4_4;if(i===qc)return t.UNSIGNED_SHORT_5_5_5_1;if(i===of)return t.UNSIGNED_INT_5_9_9_9_REV;if(i===af)return t.UNSIGNED_INT_10F_11F_11F_REV;if(i===rf)return t.BYTE;if(i===sf)return t.SHORT;if(i===fo)return t.UNSIGNED_SHORT;if(i===Xc)return t.INT;if(i===Ai)return t.UNSIGNED_INT;if(i===Ci)return t.FLOAT;if(i===Hi)return t.HALF_FLOAT;if(i===lf)return t.ALPHA;if(i===cf)return t.RGB;if(i===ui)return t.RGBA;if(i===Vi)return t.DEPTH_COMPONENT;if(i===zr)return t.DEPTH_STENCIL;if(i===uf)return t.RED;if(i===Zc)return t.RED_INTEGER;if(i===Vr)return t.RG;if(i===$c)return t.RG_INTEGER;if(i===jc)return t.RGBA_INTEGER;if(i===Ra||i===Pa||i===Ia||i===La)if(o===xt)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===Ra)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===Pa)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===Ia)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===La)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===Ra)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===Pa)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===Ia)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===La)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Kc||i===Jc||i===Qc||i===eu)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===Kc)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Jc)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===Qc)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===eu)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===tu||i===nu||i===iu||i===ru||i===su||i===Da||i===ou)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===tu||i===nu)return o===xt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===iu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===ru)return s.COMPRESSED_R11_EAC;if(i===su)return s.COMPRESSED_SIGNED_R11_EAC;if(i===Da)return s.COMPRESSED_RG11_EAC;if(i===ou)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===au||i===lu||i===cu||i===uu||i===hu||i===du||i===fu||i===pu||i===mu||i===gu||i===_u||i===vu||i===xu||i===yu)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===au)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===lu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===cu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===uu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===hu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===du)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===fu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===pu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===mu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===gu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===_u)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===vu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===xu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===yu)return o===xt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Su||i===Mu||i===wu)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===Su)return o===xt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===Mu)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===wu)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===bu||i===Eu||i===Na||i===Tu)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===bu)return s.COMPRESSED_RED_RGTC1_EXT;if(i===Eu)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===Na)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===Tu)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===po?t.UNSIGNED_INT_24_8:t[i]!==void 0?t[i]:null}return{convert:n}}var TE=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,AE=`
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

}`,Of=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,n){if(this.texture===null){let i=new pa(e.texture);(e.depthNear!==n.depthNear||e.depthFar!==n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let n=e.cameras[0].viewport,i=new jn({vertexShader:TE,fragmentShader:AE,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new vn(new vs(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Bf=class extends bi{constructor(e,n){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,c=null,d=null,p=null,h=null,f=null,v=null,M=typeof XRWebGLBinding<"u",g=new Of,u={},m=n.getContextAttributes(),x=null,S=null,C=[],b=[],R=new Le,_=null,T=new gn;T.viewport=new Vt;let I=new gn;I.viewport=new Vt;let P=[T,I],B=new kc,j=null,$=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(ee){let oe=C[ee];return oe===void 0&&(oe=new ro,C[ee]=oe),oe.getTargetRaySpace()},this.getControllerGrip=function(ee){let oe=C[ee];return oe===void 0&&(oe=new ro,C[ee]=oe),oe.getGripSpace()},this.getHand=function(ee){let oe=C[ee];return oe===void 0&&(oe=new ro,C[ee]=oe),oe.getHandSpace()};function z(ee){let oe=b.indexOf(ee.inputSource);if(oe===-1)return;let se=C[oe];se!==void 0&&(se.update(ee.inputSource,ee.frame,c||o),se.dispatchEvent({type:ee.type,data:ee.inputSource}))}function Y(){r.removeEventListener("select",z),r.removeEventListener("selectstart",z),r.removeEventListener("selectend",z),r.removeEventListener("squeeze",z),r.removeEventListener("squeezestart",z),r.removeEventListener("squeezeend",z),r.removeEventListener("end",Y),r.removeEventListener("inputsourceschange",Z);for(let ee=0;ee<C.length;ee++){let oe=b[ee];oe!==null&&(b[ee]=null,C[ee].disconnect(oe))}j=null,$=null,g.reset();for(let ee in u)delete u[ee];e.setRenderTarget(x),f=null,h=null,p=null,r=null,S=null,je.stop(),i.isPresenting=!1,e.setPixelRatio(_),e.setSize(R.width,R.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(ee){s=ee,i.isPresenting===!0&&ke("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(ee){a=ee,i.isPresenting===!0&&ke("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(ee){c=ee},this.getBaseLayer=function(){return h!==null?h:f},this.getBinding=function(){return p===null&&M&&(p=new XRWebGLBinding(r,n)),p},this.getFrame=function(){return v},this.getSession=function(){return r},this.setSession=async function(ee){if(r=ee,r!==null){if(x=e.getRenderTarget(),r.addEventListener("select",z),r.addEventListener("selectstart",z),r.addEventListener("selectend",z),r.addEventListener("squeeze",z),r.addEventListener("squeezestart",z),r.addEventListener("squeezeend",z),r.addEventListener("end",Y),r.addEventListener("inputsourceschange",Z),m.xrCompatible!==!0&&await n.makeXRCompatible(),_=e.getPixelRatio(),e.getSize(R),M&&"createProjectionLayer"in XRWebGLBinding.prototype){let se=null,Fe=null,Ve=null;m.depth&&(Ve=m.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,se=m.stencil?zr:Vi,Fe=m.stencil?po:Ai);let ze={colorFormat:n.RGBA8,depthFormat:Ve,scaleFactor:s};p=this.getBinding(),h=p.createProjectionLayer(ze),r.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),S=new $n(h.textureWidth,h.textureHeight,{format:ui,type:On,depthTexture:new ar(h.textureWidth,h.textureHeight,Fe,void 0,void 0,void 0,void 0,void 0,void 0,se),stencilBuffer:m.stencil,colorSpace:e.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1})}else{let se={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:s};f=new XRWebGLLayer(r,n,se),r.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),S=new $n(f.framebufferWidth,f.framebufferHeight,{format:ui,type:On,colorSpace:e.outputColorSpace,stencilBuffer:m.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}S.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),je.setContext(r),je.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return g.getDepthTexture()};function Z(ee){for(let oe=0;oe<ee.removed.length;oe++){let se=ee.removed[oe],Fe=b.indexOf(se);Fe>=0&&(b[Fe]=null,C[Fe].disconnect(se))}for(let oe=0;oe<ee.added.length;oe++){let se=ee.added[oe],Fe=b.indexOf(se);if(Fe===-1){for(let ze=0;ze<C.length;ze++)if(ze>=b.length){b.push(se),Fe=ze;break}else if(b[ze]===null){b[ze]=se,Fe=ze;break}if(Fe===-1)break}let Ve=C[Fe];Ve&&Ve.connect(se)}}let ne=new D,ce=new D;function ue(ee,oe,se){ne.setFromMatrixPosition(oe.matrixWorld),ce.setFromMatrixPosition(se.matrixWorld);let Fe=ne.distanceTo(ce),Ve=oe.projectionMatrix.elements,ze=se.projectionMatrix.elements,Ct=Ve[14]/(Ve[10]-1),tt=Ve[14]/(Ve[10]+1),ht=(Ve[9]+1)/Ve[5],gt=(Ve[9]-1)/Ve[5],Xe=(Ve[8]-1)/Ve[0],Yt=(ze[8]+1)/ze[0],Mt=Ct*Xe,En=Ct*Yt,O=Fe/(-Xe+Yt),Ft=O*-Xe;if(oe.matrixWorld.decompose(ee.position,ee.quaternion,ee.scale),ee.translateX(Ft),ee.translateZ(O),ee.matrixWorld.compose(ee.position,ee.quaternion,ee.scale),ee.matrixWorldInverse.copy(ee.matrixWorld).invert(),Ve[10]===-1)ee.projectionMatrix.copy(oe.projectionMatrix),ee.projectionMatrixInverse.copy(oe.projectionMatrixInverse);else{let ot=Ct+O,ut=tt+O,xe=Mt-Ft,_t=En+(Fe-Ft),A=ht*tt/ut*ot,y=gt*tt/ut*ot;ee.projectionMatrix.makePerspective(xe,_t,A,y,ot,ut),ee.projectionMatrixInverse.copy(ee.projectionMatrix).invert()}}function Ie(ee,oe){oe===null?ee.matrixWorld.copy(ee.matrix):ee.matrixWorld.multiplyMatrices(oe.matrixWorld,ee.matrix),ee.matrixWorldInverse.copy(ee.matrixWorld).invert()}this.updateCamera=function(ee){if(r===null)return;let oe=ee.near,se=ee.far;g.texture!==null&&(g.depthNear>0&&(oe=g.depthNear),g.depthFar>0&&(se=g.depthFar)),B.near=I.near=T.near=oe,B.far=I.far=T.far=se,(j!==B.near||$!==B.far)&&(r.updateRenderState({depthNear:B.near,depthFar:B.far}),j=B.near,$=B.far),B.layers.mask=ee.layers.mask|6,T.layers.mask=B.layers.mask&-5,I.layers.mask=B.layers.mask&-3;let Fe=ee.parent,Ve=B.cameras;Ie(B,Fe);for(let ze=0;ze<Ve.length;ze++)Ie(Ve[ze],Fe);Ve.length===2?ue(B,T,I):B.projectionMatrix.copy(T.projectionMatrix),De(ee,B,Fe)};function De(ee,oe,se){se===null?ee.matrix.copy(oe.matrixWorld):(ee.matrix.copy(se.matrixWorld),ee.matrix.invert(),ee.matrix.multiply(oe.matrixWorld)),ee.matrix.decompose(ee.position,ee.quaternion,ee.scale),ee.updateMatrixWorld(!0),ee.projectionMatrix.copy(oe.projectionMatrix),ee.projectionMatrixInverse.copy(oe.projectionMatrixInverse),ee.isPerspectiveCamera&&(ee.fov=no*2*Math.atan(1/ee.projectionMatrix.elements[5]),ee.zoom=1)}this.getCamera=function(){return B},this.getFoveation=function(){if(!(h===null&&f===null))return l},this.setFoveation=function(ee){l=ee,h!==null&&(h.fixedFoveation=ee),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=ee)},this.hasDepthSensing=function(){return g.texture!==null},this.getDepthSensingMesh=function(){return g.getMesh(B)},this.getCameraTexture=function(ee){return u[ee]};let Ze=null;function mt(ee,oe){if(d=oe.getViewerPose(c||o),v=oe,d!==null){let se=d.views;f!==null&&(e.setRenderTargetFramebuffer(S,f.framebuffer),e.setRenderTarget(S));let Fe=!1;se.length!==B.cameras.length&&(B.cameras.length=0,Fe=!0);for(let tt=0;tt<se.length;tt++){let ht=se[tt],gt=null;if(f!==null)gt=f.getViewport(ht);else{let Yt=p.getViewSubImage(h,ht);gt=Yt.viewport,tt===0&&(e.setRenderTargetTextures(S,Yt.colorTexture,Yt.depthStencilTexture),e.setRenderTarget(S))}let Xe=P[tt];Xe===void 0&&(Xe=new gn,Xe.layers.enable(tt),Xe.viewport=new Vt,P[tt]=Xe),Xe.matrix.fromArray(ht.transform.matrix),Xe.matrix.decompose(Xe.position,Xe.quaternion,Xe.scale),Xe.projectionMatrix.fromArray(ht.projectionMatrix),Xe.projectionMatrixInverse.copy(Xe.projectionMatrix).invert(),Xe.viewport.set(gt.x,gt.y,gt.width,gt.height),tt===0&&(B.matrix.copy(Xe.matrix),B.matrix.decompose(B.position,B.quaternion,B.scale)),Fe===!0&&B.cameras.push(Xe)}let Ve=r.enabledFeatures;if(Ve&&Ve.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&M){p=i.getBinding();let tt=p.getDepthInformation(se[0]);tt&&tt.isValid&&tt.texture&&g.init(tt,r.renderState)}if(Ve&&Ve.includes("camera-access")&&M){e.state.unbindTexture(),p=i.getBinding();for(let tt=0;tt<se.length;tt++){let ht=se[tt].camera;if(ht){let gt=u[ht];gt||(gt=new pa,u[ht]=gt);let Xe=p.getCameraImage(ht);gt.sourceTexture=Xe}}}}for(let se=0;se<C.length;se++){let Fe=b[se],Ve=C[se];Fe!==null&&Ve!==void 0&&Ve.update(Fe,oe,c||o)}Ze&&Ze(ee,oe),oe.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:oe}),v=null}let je=new G0;je.setAnimationLoop(mt),this.setAnimationLoop=function(ee){Ze=ee},this.dispose=function(){}}},CE=new Dt,Z0=new Qe;Z0.set(-1,0,0,0,1,0,0,0,1);function RE(t,e){function n(g,u){g.matrixAutoUpdate===!0&&g.updateMatrix(),u.value.copy(g.matrix)}function i(g,u){u.color.getRGB(g.fogColor.value,mf(t)),u.isFog?(g.fogNear.value=u.near,g.fogFar.value=u.far):u.isFogExp2&&(g.fogDensity.value=u.density)}function r(g,u,m,x,S){u.isNodeMaterial?u.uniformsNeedUpdate=!1:u.isMeshBasicMaterial?s(g,u):u.isMeshLambertMaterial?(s(g,u),u.envMap&&(g.envMapIntensity.value=u.envMapIntensity)):u.isMeshToonMaterial?(s(g,u),p(g,u)):u.isMeshPhongMaterial?(s(g,u),d(g,u),u.envMap&&(g.envMapIntensity.value=u.envMapIntensity)):u.isMeshStandardMaterial?(s(g,u),h(g,u),u.isMeshPhysicalMaterial&&f(g,u,S)):u.isMeshMatcapMaterial?(s(g,u),v(g,u)):u.isMeshDepthMaterial?s(g,u):u.isMeshDistanceMaterial?(s(g,u),M(g,u)):u.isMeshNormalMaterial?s(g,u):u.isLineBasicMaterial?(o(g,u),u.isLineDashedMaterial&&a(g,u)):u.isPointsMaterial?l(g,u,m,x):u.isSpriteMaterial?c(g,u):u.isShadowMaterial?(g.color.value.copy(u.color),g.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function s(g,u){g.opacity.value=u.opacity,u.color&&g.diffuse.value.copy(u.color),u.emissive&&g.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(g.map.value=u.map,n(u.map,g.mapTransform)),u.alphaMap&&(g.alphaMap.value=u.alphaMap,n(u.alphaMap,g.alphaMapTransform)),u.bumpMap&&(g.bumpMap.value=u.bumpMap,n(u.bumpMap,g.bumpMapTransform),g.bumpScale.value=u.bumpScale,u.side===Pn&&(g.bumpScale.value*=-1)),u.normalMap&&(g.normalMap.value=u.normalMap,n(u.normalMap,g.normalMapTransform),g.normalScale.value.copy(u.normalScale),u.side===Pn&&g.normalScale.value.negate()),u.displacementMap&&(g.displacementMap.value=u.displacementMap,n(u.displacementMap,g.displacementMapTransform),g.displacementScale.value=u.displacementScale,g.displacementBias.value=u.displacementBias),u.emissiveMap&&(g.emissiveMap.value=u.emissiveMap,n(u.emissiveMap,g.emissiveMapTransform)),u.specularMap&&(g.specularMap.value=u.specularMap,n(u.specularMap,g.specularMapTransform)),u.alphaTest>0&&(g.alphaTest.value=u.alphaTest);let m=e.get(u),x=m.envMap,S=m.envMapRotation;x&&(g.envMap.value=x,g.envMapRotation.value.setFromMatrix4(CE.makeRotationFromEuler(S)).transpose(),x.isCubeTexture&&x.isRenderTargetTexture===!1&&g.envMapRotation.value.premultiply(Z0),g.reflectivity.value=u.reflectivity,g.ior.value=u.ior,g.refractionRatio.value=u.refractionRatio),u.lightMap&&(g.lightMap.value=u.lightMap,g.lightMapIntensity.value=u.lightMapIntensity,n(u.lightMap,g.lightMapTransform)),u.aoMap&&(g.aoMap.value=u.aoMap,g.aoMapIntensity.value=u.aoMapIntensity,n(u.aoMap,g.aoMapTransform))}function o(g,u){g.diffuse.value.copy(u.color),g.opacity.value=u.opacity,u.map&&(g.map.value=u.map,n(u.map,g.mapTransform))}function a(g,u){g.dashSize.value=u.dashSize,g.totalSize.value=u.dashSize+u.gapSize,g.scale.value=u.scale}function l(g,u,m,x){g.diffuse.value.copy(u.color),g.opacity.value=u.opacity,g.size.value=u.size*m,g.scale.value=x*.5,u.map&&(g.map.value=u.map,n(u.map,g.uvTransform)),u.alphaMap&&(g.alphaMap.value=u.alphaMap,n(u.alphaMap,g.alphaMapTransform)),u.alphaTest>0&&(g.alphaTest.value=u.alphaTest)}function c(g,u){g.diffuse.value.copy(u.color),g.opacity.value=u.opacity,g.rotation.value=u.rotation,u.map&&(g.map.value=u.map,n(u.map,g.mapTransform)),u.alphaMap&&(g.alphaMap.value=u.alphaMap,n(u.alphaMap,g.alphaMapTransform)),u.alphaTest>0&&(g.alphaTest.value=u.alphaTest)}function d(g,u){g.specular.value.copy(u.specular),g.shininess.value=Math.max(u.shininess,1e-4)}function p(g,u){u.gradientMap&&(g.gradientMap.value=u.gradientMap)}function h(g,u){g.metalness.value=u.metalness,u.metalnessMap&&(g.metalnessMap.value=u.metalnessMap,n(u.metalnessMap,g.metalnessMapTransform)),g.roughness.value=u.roughness,u.roughnessMap&&(g.roughnessMap.value=u.roughnessMap,n(u.roughnessMap,g.roughnessMapTransform)),u.envMap&&(g.envMapIntensity.value=u.envMapIntensity)}function f(g,u,m){g.ior.value=u.ior,u.sheen>0&&(g.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),g.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(g.sheenColorMap.value=u.sheenColorMap,n(u.sheenColorMap,g.sheenColorMapTransform)),u.sheenRoughnessMap&&(g.sheenRoughnessMap.value=u.sheenRoughnessMap,n(u.sheenRoughnessMap,g.sheenRoughnessMapTransform))),u.clearcoat>0&&(g.clearcoat.value=u.clearcoat,g.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(g.clearcoatMap.value=u.clearcoatMap,n(u.clearcoatMap,g.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,n(u.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(g.clearcoatNormalMap.value=u.clearcoatNormalMap,n(u.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===Pn&&g.clearcoatNormalScale.value.negate())),u.dispersion>0&&(g.dispersion.value=u.dispersion),u.iridescence>0&&(g.iridescence.value=u.iridescence,g.iridescenceIOR.value=u.iridescenceIOR,g.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],g.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(g.iridescenceMap.value=u.iridescenceMap,n(u.iridescenceMap,g.iridescenceMapTransform)),u.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=u.iridescenceThicknessMap,n(u.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),u.transmission>0&&(g.transmission.value=u.transmission,g.transmissionSamplerMap.value=m.texture,g.transmissionSamplerSize.value.set(m.width,m.height),u.transmissionMap&&(g.transmissionMap.value=u.transmissionMap,n(u.transmissionMap,g.transmissionMapTransform)),g.thickness.value=u.thickness,u.thicknessMap&&(g.thicknessMap.value=u.thicknessMap,n(u.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=u.attenuationDistance,g.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(g.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(g.anisotropyMap.value=u.anisotropyMap,n(u.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=u.specularIntensity,g.specularColor.value.copy(u.specularColor),u.specularColorMap&&(g.specularColorMap.value=u.specularColorMap,n(u.specularColorMap,g.specularColorMapTransform)),u.specularIntensityMap&&(g.specularIntensityMap.value=u.specularIntensityMap,n(u.specularIntensityMap,g.specularIntensityMapTransform))}function v(g,u){u.matcap&&(g.matcap.value=u.matcap)}function M(g,u){let m=e.get(u).light;g.referencePosition.value.setFromMatrixPosition(m.matrixWorld),g.nearDistance.value=m.shadow.camera.near,g.farDistance.value=m.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function PE(t,e,n,i){let r={},s={},o=[],a=t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);function l(m,x){let S=x.program;i.uniformBlockBinding(m,S)}function c(m,x){let S=r[m.id];S===void 0&&(v(m),S=d(m),r[m.id]=S,m.addEventListener("dispose",g));let C=x.program;i.updateUBOMapping(m,C);let b=e.render.frame;s[m.id]!==b&&(h(m),s[m.id]=b)}function d(m){let x=p();m.__bindingPointIndex=x;let S=t.createBuffer(),C=m.__size,b=m.usage;return t.bindBuffer(t.UNIFORM_BUFFER,S),t.bufferData(t.UNIFORM_BUFFER,C,b),t.bindBuffer(t.UNIFORM_BUFFER,null),t.bindBufferBase(t.UNIFORM_BUFFER,x,S),S}function p(){for(let m=0;m<a;m++)if(o.indexOf(m)===-1)return o.push(m),m;return We("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(m){let x=r[m.id],S=m.uniforms,C=m.__cache;t.bindBuffer(t.UNIFORM_BUFFER,x);for(let b=0,R=S.length;b<R;b++){let _=Array.isArray(S[b])?S[b]:[S[b]];for(let T=0,I=_.length;T<I;T++){let P=_[T];if(f(P,b,T,C)===!0){let B=P.__offset,j=Array.isArray(P.value)?P.value:[P.value],$=0;for(let z=0;z<j.length;z++){let Y=j[z],Z=M(Y);typeof Y=="number"||typeof Y=="boolean"?(P.__data[0]=Y,t.bufferSubData(t.UNIFORM_BUFFER,B+$,P.__data)):Y.isMatrix3?(P.__data[0]=Y.elements[0],P.__data[1]=Y.elements[1],P.__data[2]=Y.elements[2],P.__data[3]=0,P.__data[4]=Y.elements[3],P.__data[5]=Y.elements[4],P.__data[6]=Y.elements[5],P.__data[7]=0,P.__data[8]=Y.elements[6],P.__data[9]=Y.elements[7],P.__data[10]=Y.elements[8],P.__data[11]=0):ArrayBuffer.isView(Y)?P.__data.set(new Y.constructor(Y.buffer,Y.byteOffset,P.__data.length)):(Y.toArray(P.__data,$),$+=Z.storage/Float32Array.BYTES_PER_ELEMENT)}t.bufferSubData(t.UNIFORM_BUFFER,B,P.__data)}}}t.bindBuffer(t.UNIFORM_BUFFER,null)}function f(m,x,S,C){let b=m.value,R=x+"_"+S;if(C[R]===void 0)return typeof b=="number"||typeof b=="boolean"?C[R]=b:ArrayBuffer.isView(b)?C[R]=b.slice():C[R]=b.clone(),!0;{let _=C[R];if(typeof b=="number"||typeof b=="boolean"){if(_!==b)return C[R]=b,!0}else{if(ArrayBuffer.isView(b))return!0;if(_.equals(b)===!1)return _.copy(b),!0}}return!1}function v(m){let x=m.uniforms,S=0,C=16;for(let R=0,_=x.length;R<_;R++){let T=Array.isArray(x[R])?x[R]:[x[R]];for(let I=0,P=T.length;I<P;I++){let B=T[I],j=Array.isArray(B.value)?B.value:[B.value];for(let $=0,z=j.length;$<z;$++){let Y=j[$],Z=M(Y),ne=S%C,ce=ne%Z.boundary,ue=ne+ce;S+=ce,ue!==0&&C-ue<Z.storage&&(S+=C-ue),B.__data=new Float32Array(Z.storage/Float32Array.BYTES_PER_ELEMENT),B.__offset=S,S+=Z.storage}}}let b=S%C;return b>0&&(S+=C-b),m.__size=S,m.__cache={},this}function M(m){let x={boundary:0,storage:0};return typeof m=="number"||typeof m=="boolean"?(x.boundary=4,x.storage=4):m.isVector2?(x.boundary=8,x.storage=8):m.isVector3||m.isColor?(x.boundary=16,x.storage=12):m.isVector4?(x.boundary=16,x.storage=16):m.isMatrix3?(x.boundary=48,x.storage=48):m.isMatrix4?(x.boundary=64,x.storage=64):m.isTexture?ke("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(m)?(x.boundary=16,x.storage=m.byteLength):ke("WebGLRenderer: Unsupported uniform value type.",m),x}function g(m){let x=m.target;x.removeEventListener("dispose",g);let S=o.indexOf(x.__bindingPointIndex);o.splice(S,1),t.deleteBuffer(r[x.id]),delete r[x.id],delete s[x.id]}function u(){for(let m in r)t.deleteBuffer(r[m]);o=[],r={},s={}}return{bind:l,update:c,dispose:u}}var IE=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Wi=null;function LE(){return Wi===null&&(Wi=new gc(IE,16,16,Vr,Hi),Wi.name="DFG_LUT",Wi.minFilter=an,Wi.magFilter=an,Wi.wrapS=zi,Wi.wrapT=zi,Wi.generateMipmaps=!1,Wi.needsUpdate=!0),Wi}var Nu=class{constructor(e={}){let{canvas:n=f0(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:d="default",failIfMajorPerformanceCaveat:p=!1,reversedDepthBuffer:h=!1,outputBufferType:f=On}=e;this.isWebGLRenderer=!0;let v;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");v=i.getContextAttributes().alpha}else v=o;let M=f,g=new Set([jc,$c,Zc]),u=new Set([On,Ai,fo,po,Yc,qc]),m=new Uint32Array(4),x=new Int32Array(4),S=new D,C=null,b=null,R=[],_=[],T=null;this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Ti,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let I=this,P=!1,B=null;this._outputColorSpace=Cn;let j=0,$=0,z=null,Y=-1,Z=null,ne=new Vt,ce=new Vt,ue=null,Ie=new ct(0),De=0,Ze=n.width,mt=n.height,je=1,ee=null,oe=null,se=new Vt(0,0,Ze,mt),Fe=new Vt(0,0,Ze,mt),Ve=!1,ze=new ao,Ct=!1,tt=!1,ht=new Dt,gt=new D,Xe=new Vt,Yt={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},Mt=!1;function En(){return z===null?je:1}let O=i;function Ft(w,N){return n.getContext(w,N)}try{let w={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:d,failIfMajorPerformanceCaveat:p};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${Vc}`),n.addEventListener("webglcontextlost",q,!1),n.addEventListener("webglcontextrestored",te,!1),n.addEventListener("webglcontextcreationerror",he,!1),O===null){let N="webgl2";if(O=Ft(N,w),O===null)throw Ft(N)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(w){throw We("WebGLRenderer: "+w.message),w}let ot,ut,xe,_t,A,y,W,J,ie,fe,ge,K,Q,Me,Te,me,de,$e,Je,F,E,U,L;function k(){ot=new kw(O),ot.init(),E=new EE(O,ot),ut=new Iw(O,ot,e,E),xe=new wE(O,ot),ut.reversedDepthBuffer&&h&&xe.buffers.depth.setReversed(!0),_t=new Gw(O),A=new cE,y=new bE(O,ot,xe,A,ut,E,_t),W=new Bw(I),J=new YS(O),U=new Rw(O,J),ie=new zw(O,J,_t,U),fe=new Ww(O,ie,J,U,_t),$e=new Hw(O,ut,y),Te=new Lw(A),ge=new lE(I,W,ot,ut,U,Te),K=new RE(I,A),Q=new hE,Me=new _E(ot),de=new Cw(I,W,xe,fe,v,l),me=new ME(I,fe,ut),L=new PE(O,_t,ut,xe),Je=new Pw(O,ot,_t),F=new Vw(O,ot,_t),_t.programs=ge.programs,I.capabilities=ut,I.extensions=ot,I.properties=A,I.renderLists=Q,I.shadowMap=me,I.state=xe,I.info=_t}k(),M!==On&&(T=new Yw(M,n.width,n.height,r,s));let G=new Bf(I,O);this.xr=G,this.getContext=function(){return O},this.getContextAttributes=function(){return O.getContextAttributes()},this.forceContextLoss=function(){let w=ot.get("WEBGL_lose_context");w&&w.loseContext()},this.forceContextRestore=function(){let w=ot.get("WEBGL_lose_context");w&&w.restoreContext()},this.getPixelRatio=function(){return je},this.setPixelRatio=function(w){w!==void 0&&(je=w,this.setSize(Ze,mt,!1))},this.getSize=function(w){return w.set(Ze,mt)},this.setSize=function(w,N,H=!0){if(G.isPresenting){ke("WebGLRenderer: Can't change size while VR device is presenting.");return}Ze=w,mt=N,n.width=Math.floor(w*je),n.height=Math.floor(N*je),H===!0&&(n.style.width=w+"px",n.style.height=N+"px"),T!==null&&T.setSize(n.width,n.height),this.setViewport(0,0,w,N)},this.getDrawingBufferSize=function(w){return w.set(Ze*je,mt*je).floor()},this.setDrawingBufferSize=function(w,N,H){Ze=w,mt=N,je=H,n.width=Math.floor(w*H),n.height=Math.floor(N*H),this.setViewport(0,0,w,N)},this.setEffects=function(w){if(M===On){We("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(w){for(let N=0;N<w.length;N++)if(w[N].isOutputPass===!0){ke("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}T.setEffects(w||[])},this.getCurrentViewport=function(w){return w.copy(ne)},this.getViewport=function(w){return w.copy(se)},this.setViewport=function(w,N,H,V){w.isVector4?se.set(w.x,w.y,w.z,w.w):se.set(w,N,H,V),xe.viewport(ne.copy(se).multiplyScalar(je).round())},this.getScissor=function(w){return w.copy(Fe)},this.setScissor=function(w,N,H,V){w.isVector4?Fe.set(w.x,w.y,w.z,w.w):Fe.set(w,N,H,V),xe.scissor(ce.copy(Fe).multiplyScalar(je).round())},this.getScissorTest=function(){return Ve},this.setScissorTest=function(w){xe.setScissorTest(Ve=w)},this.setOpaqueSort=function(w){ee=w},this.setTransparentSort=function(w){oe=w},this.getClearColor=function(w){return w.copy(de.getClearColor())},this.setClearColor=function(){de.setClearColor(...arguments)},this.getClearAlpha=function(){return de.getClearAlpha()},this.setClearAlpha=function(){de.setClearAlpha(...arguments)},this.clear=function(w=!0,N=!0,H=!0){let V=0;if(w){let X=!1;if(z!==null){let ae=z.texture.format;X=g.has(ae)}if(X){let ae=z.texture.type,be=u.has(ae),ve=de.getClearColor(),Ae=de.getClearAlpha(),ye=ve.r,Be=ve.g,qe=ve.b;be?(m[0]=ye,m[1]=Be,m[2]=qe,m[3]=Ae,O.clearBufferuiv(O.COLOR,0,m)):(x[0]=ye,x[1]=Be,x[2]=qe,x[3]=Ae,O.clearBufferiv(O.COLOR,0,x))}else V|=O.COLOR_BUFFER_BIT}N&&(V|=O.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),H&&(V|=O.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),V!==0&&O.clear(V)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(w){w.setRenderer(this),B=w},this.dispose=function(){n.removeEventListener("webglcontextlost",q,!1),n.removeEventListener("webglcontextrestored",te,!1),n.removeEventListener("webglcontextcreationerror",he,!1),de.dispose(),Q.dispose(),Me.dispose(),A.dispose(),W.dispose(),fe.dispose(),U.dispose(),L.dispose(),ge.dispose(),G.dispose(),G.removeEventListener("sessionstart",nt),G.removeEventListener("sessionend",Bt),dt.stop()};function q(w){w.preventDefault(),df("WebGLRenderer: Context Lost."),P=!0}function te(){df("WebGLRenderer: Context Restored."),P=!1;let w=_t.autoReset,N=me.enabled,H=me.autoUpdate,V=me.needsUpdate,X=me.type;k(),_t.autoReset=w,me.enabled=N,me.autoUpdate=H,me.needsUpdate=V,me.type=X}function he(w){We("WebGLRenderer: A WebGL context could not be created. Reason: ",w.statusMessage)}function Ue(w){let N=w.target;N.removeEventListener("dispose",Ue),Ne(N)}function Ne(w){et(w),A.remove(w)}function et(w){let N=A.get(w).programs;N!==void 0&&(N.forEach(function(H){ge.releaseProgram(H)}),w.isShaderMaterial&&ge.releaseShaderCache(w))}this.renderBufferDirect=function(w,N,H,V,X,ae){N===null&&(N=Yt);let be=X.isMesh&&X.matrixWorld.determinant()<0,ve=_e(w,N,H,V,X);xe.setMaterial(V,be);let Ae=H.index,ye=1;if(V.wireframe===!0){if(Ae=ie.getWireframeAttribute(H),Ae===void 0)return;ye=2}let Be=H.drawRange,qe=H.attributes.position,Re=Be.start*ye,st=(Be.start+Be.count)*ye;ae!==null&&(Re=Math.max(Re,ae.start*ye),st=Math.min(st,(ae.start+ae.count)*ye)),Ae!==null?(Re=Math.max(Re,0),st=Math.min(st,Ae.count)):qe!=null&&(Re=Math.max(Re,0),st=Math.min(st,qe.count));let kt=st-Re;if(kt<0||kt===1/0)return;U.setup(X,V,ve,H,Ae);let yt,Tt=Je;if(Ae!==null&&(yt=J.get(Ae),Tt=F,Tt.setIndex(yt)),X.isMesh)V.wireframe===!0?(xe.setLineWidth(V.wireframeLinewidth*En()),Tt.setMode(O.LINES)):Tt.setMode(O.TRIANGLES);else if(X.isLine){let fn=V.linewidth;fn===void 0&&(fn=1),xe.setLineWidth(fn*En()),X.isLineSegments?Tt.setMode(O.LINES):X.isLineLoop?Tt.setMode(O.LINE_LOOP):Tt.setMode(O.LINE_STRIP)}else X.isPoints?Tt.setMode(O.POINTS):X.isSprite&&Tt.setMode(O.TRIANGLES);if(X.isBatchedMesh)if(ot.get("WEBGL_multi_draw"))Tt.renderMultiDraw(X._multiDrawStarts,X._multiDrawCounts,X._multiDrawCount);else{let fn=X._multiDrawStarts,Ce=X._multiDrawCounts,Xn=X._multiDrawCount,ft=Ae?J.get(Ae).bytesPerElement:1,si=A.get(V).currentProgram.getUniforms();for(let Bi=0;Bi<Xn;Bi++)si.setValue(O,"_gl_DrawID",Bi),Tt.render(fn[Bi]/ft,Ce[Bi])}else if(X.isInstancedMesh)Tt.renderInstances(Re,kt,X.count);else if(H.isInstancedBufferGeometry){let fn=H._maxInstanceCount!==void 0?H._maxInstanceCount:1/0,Ce=Math.min(H.instanceCount,fn);Tt.renderInstances(Re,kt,Ce)}else Tt.render(Re,kt)};function vt(w,N,H){w.transparent===!0&&w.side===Jn&&w.forceSinglePass===!1?(w.side=Pn,w.needsUpdate=!0,Un(w,N,H),w.side=sr,w.needsUpdate=!0,Un(w,N,H),w.side=Jn):Un(w,N,H)}this.compile=function(w,N,H=null){H===null&&(H=w),b=Me.get(H),b.init(N),_.push(b),H.traverseVisible(function(X){X.isLight&&X.layers.test(N.layers)&&(b.pushLight(X),X.castShadow&&b.pushShadow(X))}),w!==H&&w.traverseVisible(function(X){X.isLight&&X.layers.test(N.layers)&&(b.pushLight(X),X.castShadow&&b.pushShadow(X))}),b.setupLights();let V=new Set;return w.traverse(function(X){if(!(X.isMesh||X.isPoints||X.isLine||X.isSprite))return;let ae=X.material;if(ae)if(Array.isArray(ae))for(let be=0;be<ae.length;be++){let ve=ae[be];vt(ve,H,X),V.add(ve)}else vt(ae,H,X),V.add(ae)}),b=_.pop(),V},this.compileAsync=function(w,N,H=null){let V=this.compile(w,N,H);return new Promise(X=>{function ae(){if(V.forEach(function(be){A.get(be).currentProgram.isReady()&&V.delete(be)}),V.size===0){X(w);return}setTimeout(ae,10)}ot.get("KHR_parallel_shader_compile")!==null?ae():setTimeout(ae,10)})};let Ke=null;function He(w){Ke&&Ke(w)}function nt(){dt.stop()}function Bt(){dt.start()}let dt=new G0;dt.setAnimationLoop(He),typeof self<"u"&&dt.setContext(self),this.setAnimationLoop=function(w){Ke=w,G.setAnimationLoop(w),w===null?dt.stop():dt.start()},G.addEventListener("sessionstart",nt),G.addEventListener("sessionend",Bt),this.render=function(w,N){if(N!==void 0&&N.isCamera!==!0){We("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(P===!0)return;B!==null&&B.renderStart(w,N);let H=G.enabled===!0&&G.isPresenting===!0,V=T!==null&&(z===null||H)&&T.begin(I,z);if(w.matrixWorldAutoUpdate===!0&&w.updateMatrixWorld(),N.parent===null&&N.matrixWorldAutoUpdate===!0&&N.updateMatrixWorld(),G.enabled===!0&&G.isPresenting===!0&&(T===null||T.isCompositing()===!1)&&(G.cameraAutoUpdate===!0&&G.updateCamera(N),N=G.getCamera()),w.isScene===!0&&w.onBeforeRender(I,w,N,z),b=Me.get(w,_.length),b.init(N),b.state.textureUnits=y.getTextureUnits(),_.push(b),ht.multiplyMatrices(N.projectionMatrix,N.matrixWorldInverse),ze.setFromProjectionMatrix(ht,Mi,N.reversedDepth),tt=this.localClippingEnabled,Ct=Te.init(this.clippingPlanes,tt),C=Q.get(w,R.length),C.init(),R.push(C),G.enabled===!0&&G.isPresenting===!0){let be=I.xr.getDepthSensingMesh();be!==null&&dn(be,N,-1/0,I.sortObjects)}dn(w,N,0,I.sortObjects),C.finish(),I.sortObjects===!0&&C.sort(ee,oe),Mt=G.enabled===!1||G.isPresenting===!1||G.hasDepthSensing()===!1,Mt&&de.addToRenderList(C,w),this.info.render.frame++,Ct===!0&&Te.beginShadows();let X=b.state.shadowsArray;if(me.render(X,w,N),Ct===!0&&Te.endShadows(),this.info.autoReset===!0&&this.info.reset(),(V&&T.hasRenderPass())===!1){let be=C.opaque,ve=C.transmissive;if(b.setupLights(),N.isArrayCamera){let Ae=N.cameras;if(ve.length>0)for(let ye=0,Be=Ae.length;ye<Be;ye++){let qe=Ae[ye];Tn(be,ve,w,qe)}Mt&&de.render(w);for(let ye=0,Be=Ae.length;ye<Be;ye++){let qe=Ae[ye];bt(C,w,qe,qe.viewport)}}else ve.length>0&&Tn(be,ve,w,N),Mt&&de.render(w),bt(C,w,N)}z!==null&&$===0&&(y.updateMultisampleRenderTarget(z),y.updateRenderTargetMipmap(z)),V&&T.end(I),w.isScene===!0&&w.onAfterRender(I,w,N),U.resetDefaultState(),Y=-1,Z=null,_.pop(),_.length>0?(b=_[_.length-1],y.setTextureUnits(b.state.textureUnits),Ct===!0&&Te.setGlobalState(I.clippingPlanes,b.state.camera)):b=null,R.pop(),R.length>0?C=R[R.length-1]:C=null,B!==null&&B.renderEnd()};function dn(w,N,H,V){if(w.visible===!1)return;if(w.layers.test(N.layers)){if(w.isGroup)H=w.renderOrder;else if(w.isLOD)w.autoUpdate===!0&&w.update(N);else if(w.isLightProbeGrid)b.pushLightProbeGrid(w);else if(w.isLight)b.pushLight(w),w.castShadow&&b.pushShadow(w);else if(w.isSprite){if(!w.frustumCulled||ze.intersectsSprite(w)){V&&Xe.setFromMatrixPosition(w.matrixWorld).applyMatrix4(ht);let be=fe.update(w),ve=w.material;ve.visible&&C.push(w,be,ve,H,Xe.z,null)}}else if((w.isMesh||w.isLine||w.isPoints)&&(!w.frustumCulled||ze.intersectsObject(w))){let be=fe.update(w),ve=w.material;if(V&&(w.boundingSphere!==void 0?(w.boundingSphere===null&&w.computeBoundingSphere(),Xe.copy(w.boundingSphere.center)):(be.boundingSphere===null&&be.computeBoundingSphere(),Xe.copy(be.boundingSphere.center)),Xe.applyMatrix4(w.matrixWorld).applyMatrix4(ht)),Array.isArray(ve)){let Ae=be.groups;for(let ye=0,Be=Ae.length;ye<Be;ye++){let qe=Ae[ye],Re=ve[qe.materialIndex];Re&&Re.visible&&C.push(w,be,Re,H,Xe.z,qe)}}else ve.visible&&C.push(w,be,ve,H,Xe.z,null)}}let ae=w.children;for(let be=0,ve=ae.length;be<ve;be++)dn(ae[be],N,H,V)}function bt(w,N,H,V){let{opaque:X,transmissive:ae,transparent:be}=w;b.setupLightsView(H),Ct===!0&&Te.setGlobalState(I.clippingPlanes,H),V&&xe.viewport(ne.copy(V)),X.length>0&&Et(X,N,H),ae.length>0&&Et(ae,N,H),be.length>0&&Et(be,N,H),xe.buffers.depth.setTest(!0),xe.buffers.depth.setMask(!0),xe.buffers.color.setMask(!0),xe.setPolygonOffset(!1)}function Tn(w,N,H,V){if((H.isScene===!0?H.overrideMaterial:null)!==null)return;if(b.state.transmissionRenderTarget[V.id]===void 0){let Re=ot.has("EXT_color_buffer_half_float")||ot.has("EXT_color_buffer_float");b.state.transmissionRenderTarget[V.id]=new $n(1,1,{generateMipmaps:!0,type:Re?Hi:On,minFilter:kr,samples:Math.max(4,ut.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:lt.workingColorSpace})}let ae=b.state.transmissionRenderTarget[V.id],be=V.viewport||ne;ae.setSize(be.z*I.transmissionResolutionScale,be.w*I.transmissionResolutionScale);let ve=I.getRenderTarget(),Ae=I.getActiveCubeFace(),ye=I.getActiveMipmapLevel();I.setRenderTarget(ae),I.getClearColor(Ie),De=I.getClearAlpha(),De<1&&I.setClearColor(16777215,.5),I.clear(),Mt&&de.render(H);let Be=I.toneMapping;I.toneMapping=Ti;let qe=V.viewport;if(V.viewport!==void 0&&(V.viewport=void 0),b.setupLightsView(V),Ct===!0&&Te.setGlobalState(I.clippingPlanes,V),Et(w,H,V),y.updateMultisampleRenderTarget(ae),y.updateRenderTargetMipmap(ae),ot.has("WEBGL_multisampled_render_to_texture")===!1){let Re=!1;for(let st=0,kt=N.length;st<kt;st++){let yt=N[st],{object:Tt,geometry:fn,material:Ce,group:Xn}=yt;if(Ce.side===Jn&&Tt.layers.test(V.layers)){let ft=Ce.side;Ce.side=Pn,Ce.needsUpdate=!0,Oi(Tt,H,V,fn,Ce,Xn),Ce.side=ft,Ce.needsUpdate=!0,Re=!0}}Re===!0&&(y.updateMultisampleRenderTarget(ae),y.updateRenderTargetMipmap(ae))}I.setRenderTarget(ve,Ae,ye),I.setClearColor(Ie,De),qe!==void 0&&(V.viewport=qe),I.toneMapping=Be}function Et(w,N,H){let V=N.isScene===!0?N.overrideMaterial:null;for(let X=0,ae=w.length;X<ae;X++){let be=w[X],{object:ve,geometry:Ae,group:ye}=be,Be=be.material;Be.allowOverride===!0&&V!==null&&(Be=V),ve.layers.test(H.layers)&&Oi(ve,N,H,Ae,Be,ye)}}function Oi(w,N,H,V,X,ae){w.onBeforeRender(I,N,H,V,X,ae),w.modelViewMatrix.multiplyMatrices(H.matrixWorldInverse,w.matrixWorld),w.normalMatrix.getNormalMatrix(w.modelViewMatrix),X.onBeforeRender(I,N,H,V,w,ae),X.transparent===!0&&X.side===Jn&&X.forceSinglePass===!1?(X.side=Pn,X.needsUpdate=!0,I.renderBufferDirect(H,N,V,X,w,ae),X.side=sr,X.needsUpdate=!0,I.renderBufferDirect(H,N,V,X,w,ae),X.side=Jn):I.renderBufferDirect(H,N,V,X,w,ae),w.onAfterRender(I,N,H,V,X,ae)}function Un(w,N,H){N.isScene!==!0&&(N=Yt);let V=A.get(w),X=b.state.lights,ae=b.state.shadowsArray,be=X.state.version,ve=ge.getParameters(w,X.state,ae,N,H,b.state.lightProbeGridArray),Ae=ge.getProgramCacheKey(ve),ye=V.programs;V.environment=w.isMeshStandardMaterial||w.isMeshLambertMaterial||w.isMeshPhongMaterial?N.environment:null,V.fog=N.fog;let Be=w.isMeshStandardMaterial||w.isMeshLambertMaterial&&!w.envMap||w.isMeshPhongMaterial&&!w.envMap;V.envMap=W.get(w.envMap||V.environment,Be),V.envMapRotation=V.environment!==null&&w.envMap===null?N.environmentRotation:w.envMapRotation,ye===void 0&&(w.addEventListener("dispose",Ue),ye=new Map,V.programs=ye);let qe=ye.get(Ae);if(qe!==void 0){if(V.currentProgram===qe&&V.lightsStateVersion===be)return Il(w,ve),qe}else ve.uniforms=ge.getUniforms(w),B!==null&&w.isNodeMaterial&&B.build(w,H,ve),w.onBeforeCompile(ve,I),qe=ge.acquireProgram(ve,Ae),ye.set(Ae,qe),V.uniforms=ve.uniforms;let Re=V.uniforms;return(!w.isShaderMaterial&&!w.isRawShaderMaterial||w.clipping===!0)&&(Re.clippingPlanes=Te.uniform),Il(w,ve),V.needsLights=re(w),V.lightsStateVersion=be,V.needsLights&&(Re.ambientLightColor.value=X.state.ambient,Re.lightProbe.value=X.state.probe,Re.directionalLights.value=X.state.directional,Re.directionalLightShadows.value=X.state.directionalShadow,Re.spotLights.value=X.state.spot,Re.spotLightShadows.value=X.state.spotShadow,Re.rectAreaLights.value=X.state.rectArea,Re.ltc_1.value=X.state.rectAreaLTC1,Re.ltc_2.value=X.state.rectAreaLTC2,Re.pointLights.value=X.state.point,Re.pointLightShadows.value=X.state.pointShadow,Re.hemisphereLights.value=X.state.hemi,Re.directionalShadowMatrix.value=X.state.directionalShadowMatrix,Re.spotLightMatrix.value=X.state.spotLightMatrix,Re.spotLightMap.value=X.state.spotLightMap,Re.pointShadowMatrix.value=X.state.pointShadowMatrix),V.lightProbeGrid=b.state.lightProbeGridArray.length>0,V.currentProgram=qe,V.uniformsList=null,qe}function us(w){if(w.uniformsList===null){let N=w.currentProgram.getUniforms();w.uniformsList=_o.seqWithValue(N.seq,w.uniforms)}return w.uniformsList}function Il(w,N){let H=A.get(w);H.outputColorSpace=N.outputColorSpace,H.batching=N.batching,H.batchingColor=N.batchingColor,H.instancing=N.instancing,H.instancingColor=N.instancingColor,H.instancingMorph=N.instancingMorph,H.skinning=N.skinning,H.morphTargets=N.morphTargets,H.morphNormals=N.morphNormals,H.morphColors=N.morphColors,H.morphTargetsCount=N.morphTargetsCount,H.numClippingPlanes=N.numClippingPlanes,H.numIntersection=N.numClipIntersection,H.vertexAlphas=N.vertexAlphas,H.vertexTangents=N.vertexTangents,H.toneMapping=N.toneMapping}function pe(w,N){if(w.length===0)return null;if(w.length===1)return w[0].texture!==null?w[0]:null;S.setFromMatrixPosition(N.matrixWorld);for(let H=0,V=w.length;H<V;H++){let X=w[H];if(X.texture!==null&&X.boundingBox.containsPoint(S))return X}return null}function _e(w,N,H,V,X){N.isScene!==!0&&(N=Yt),y.resetTextureUnits();let ae=N.fog,be=V.isMeshStandardMaterial||V.isMeshLambertMaterial||V.isMeshPhongMaterial?N.environment:null,ve=z===null?I.outputColorSpace:z.isXRRenderTarget===!0?z.texture.colorSpace:lt.workingColorSpace,Ae=V.isMeshStandardMaterial||V.isMeshLambertMaterial&&!V.envMap||V.isMeshPhongMaterial&&!V.envMap,ye=W.get(V.envMap||be,Ae),Be=V.vertexColors===!0&&!!H.attributes.color&&H.attributes.color.itemSize===4,qe=!!H.attributes.tangent&&(!!V.normalMap||V.anisotropy>0),Re=!!H.morphAttributes.position,st=!!H.morphAttributes.normal,kt=!!H.morphAttributes.color,yt=Ti;V.toneMapped&&(z===null||z.isXRRenderTarget===!0)&&(yt=I.toneMapping);let Tt=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,fn=Tt!==void 0?Tt.length:0,Ce=A.get(V),Xn=b.state.lights;if(Ct===!0&&(tt===!0||w!==Z)){let Rt=w===Z&&V.id===Y;Te.setState(V,w,Rt)}let ft=!1;V.version===Ce.__version?(Ce.needsLights&&Ce.lightsStateVersion!==Xn.state.version||Ce.outputColorSpace!==ve||X.isBatchedMesh&&Ce.batching===!1||!X.isBatchedMesh&&Ce.batching===!0||X.isBatchedMesh&&Ce.batchingColor===!0&&X.colorTexture===null||X.isBatchedMesh&&Ce.batchingColor===!1&&X.colorTexture!==null||X.isInstancedMesh&&Ce.instancing===!1||!X.isInstancedMesh&&Ce.instancing===!0||X.isSkinnedMesh&&Ce.skinning===!1||!X.isSkinnedMesh&&Ce.skinning===!0||X.isInstancedMesh&&Ce.instancingColor===!0&&X.instanceColor===null||X.isInstancedMesh&&Ce.instancingColor===!1&&X.instanceColor!==null||X.isInstancedMesh&&Ce.instancingMorph===!0&&X.morphTexture===null||X.isInstancedMesh&&Ce.instancingMorph===!1&&X.morphTexture!==null||Ce.envMap!==ye||V.fog===!0&&Ce.fog!==ae||Ce.numClippingPlanes!==void 0&&(Ce.numClippingPlanes!==Te.numPlanes||Ce.numIntersection!==Te.numIntersection)||Ce.vertexAlphas!==Be||Ce.vertexTangents!==qe||Ce.morphTargets!==Re||Ce.morphNormals!==st||Ce.morphColors!==kt||Ce.toneMapping!==yt||Ce.morphTargetsCount!==fn||!!Ce.lightProbeGrid!=b.state.lightProbeGridArray.length>0)&&(ft=!0):(ft=!0,Ce.__version=V.version);let si=Ce.currentProgram;ft===!0&&(si=Un(V,N,X),B&&V.isNodeMaterial&&B.onUpdateProgram(V,si,Ce));let Bi=!1,yr=!1,Bs=!1,At=si.getUniforms(),qt=Ce.uniforms;if(xe.useProgram(si.program)&&(Bi=!0,yr=!0,Bs=!0),V.id!==Y&&(Y=V.id,yr=!0),Ce.needsLights){let Rt=pe(b.state.lightProbeGridArray,X);Ce.lightProbeGrid!==Rt&&(Ce.lightProbeGrid=Rt,yr=!0)}if(Bi||Z!==w){xe.buffers.depth.getReversed()&&w.reversedDepth!==!0&&(w._reversedDepth=!0,w.updateProjectionMatrix()),At.setValue(O,"projectionMatrix",w.projectionMatrix),At.setValue(O,"viewMatrix",w.matrixWorldInverse);let Mr=At.map.cameraPosition;Mr!==void 0&&Mr.setValue(O,gt.setFromMatrixPosition(w.matrixWorld)),ut.logarithmicDepthBuffer&&At.setValue(O,"logDepthBufFC",2/(Math.log(w.far+1)/Math.LN2)),(V.isMeshPhongMaterial||V.isMeshToonMaterial||V.isMeshLambertMaterial||V.isMeshBasicMaterial||V.isMeshStandardMaterial||V.isShaderMaterial)&&At.setValue(O,"isOrthographic",w.isOrthographicCamera===!0),Z!==w&&(Z=w,yr=!0,Bs=!0)}if(Ce.needsLights&&(Xn.state.directionalShadowMap.length>0&&At.setValue(O,"directionalShadowMap",Xn.state.directionalShadowMap,y),Xn.state.spotShadowMap.length>0&&At.setValue(O,"spotShadowMap",Xn.state.spotShadowMap,y),Xn.state.pointShadowMap.length>0&&At.setValue(O,"pointShadowMap",Xn.state.pointShadowMap,y)),X.isSkinnedMesh){At.setOptional(O,X,"bindMatrix"),At.setOptional(O,X,"bindMatrixInverse");let Rt=X.skeleton;Rt&&(Rt.boneTexture===null&&Rt.computeBoneTexture(),At.setValue(O,"boneTexture",Rt.boneTexture,y))}X.isBatchedMesh&&(At.setOptional(O,X,"batchingTexture"),At.setValue(O,"batchingTexture",X._matricesTexture,y),At.setOptional(O,X,"batchingIdTexture"),At.setValue(O,"batchingIdTexture",X._indirectTexture,y),At.setOptional(O,X,"batchingColorTexture"),X._colorsTexture!==null&&At.setValue(O,"batchingColorTexture",X._colorsTexture,y));let Sr=H.morphAttributes;if((Sr.position!==void 0||Sr.normal!==void 0||Sr.color!==void 0)&&$e.update(X,H,si),(yr||Ce.receiveShadow!==X.receiveShadow)&&(Ce.receiveShadow=X.receiveShadow,At.setValue(O,"receiveShadow",X.receiveShadow)),(V.isMeshStandardMaterial||V.isMeshLambertMaterial||V.isMeshPhongMaterial)&&V.envMap===null&&N.environment!==null&&(qt.envMapIntensity.value=N.environmentIntensity),qt.dfgLUT!==void 0&&(qt.dfgLUT.value=LE()),yr){if(At.setValue(O,"toneMappingExposure",I.toneMappingExposure),Ce.needsLights&&Ee(qt,Bs),ae&&V.fog===!0&&K.refreshFogUniforms(qt,ae),K.refreshMaterialUniforms(qt,V,je,mt,b.state.transmissionRenderTarget[w.id]),Ce.needsLights&&Ce.lightProbeGrid){let Rt=Ce.lightProbeGrid;qt.probesSH.value=Rt.texture,qt.probesMin.value.copy(Rt.boundingBox.min),qt.probesMax.value.copy(Rt.boundingBox.max),qt.probesResolution.value.copy(Rt.resolution)}_o.upload(O,us(Ce),qt,y)}if(V.isShaderMaterial&&V.uniformsNeedUpdate===!0&&(_o.upload(O,us(Ce),qt,y),V.uniformsNeedUpdate=!1),V.isSpriteMaterial&&At.setValue(O,"center",X.center),At.setValue(O,"modelViewMatrix",X.modelViewMatrix),At.setValue(O,"normalMatrix",X.normalMatrix),At.setValue(O,"modelMatrix",X.matrixWorld),V.uniformsGroups!==void 0){let Rt=V.uniformsGroups;for(let Mr=0,ks=Rt.length;Mr<ks;Mr++){let cg=Rt[Mr];L.update(cg,si),L.bind(cg,si)}}return si}function Ee(w,N){w.ambientLightColor.needsUpdate=N,w.lightProbe.needsUpdate=N,w.directionalLights.needsUpdate=N,w.directionalLightShadows.needsUpdate=N,w.pointLights.needsUpdate=N,w.pointLightShadows.needsUpdate=N,w.spotLights.needsUpdate=N,w.spotLightShadows.needsUpdate=N,w.rectAreaLights.needsUpdate=N,w.hemisphereLights.needsUpdate=N}function re(w){return w.isMeshLambertMaterial||w.isMeshToonMaterial||w.isMeshPhongMaterial||w.isMeshStandardMaterial||w.isShadowMaterial||w.isShaderMaterial&&w.lights===!0}this.getActiveCubeFace=function(){return j},this.getActiveMipmapLevel=function(){return $},this.getRenderTarget=function(){return z},this.setRenderTargetTextures=function(w,N,H){let V=A.get(w);V.__autoAllocateDepthBuffer=w.resolveDepthBuffer===!1,V.__autoAllocateDepthBuffer===!1&&(V.__useRenderToTexture=!1),A.get(w.texture).__webglTexture=N,A.get(w.depthTexture).__webglTexture=V.__autoAllocateDepthBuffer?void 0:H,V.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(w,N){let H=A.get(w);H.__webglFramebuffer=N,H.__useDefaultFramebuffer=N===void 0};let Ge=O.createFramebuffer();this.setRenderTarget=function(w,N=0,H=0){z=w,j=N,$=H;let V=null,X=!1,ae=!1;if(w){let ve=A.get(w);if(ve.__useDefaultFramebuffer!==void 0){xe.bindFramebuffer(O.FRAMEBUFFER,ve.__webglFramebuffer),ne.copy(w.viewport),ce.copy(w.scissor),ue=w.scissorTest,xe.viewport(ne),xe.scissor(ce),xe.setScissorTest(ue),Y=-1;return}else if(ve.__webglFramebuffer===void 0)y.setupRenderTarget(w);else if(ve.__hasExternalTextures)y.rebindTextures(w,A.get(w.texture).__webglTexture,A.get(w.depthTexture).__webglTexture);else if(w.depthBuffer){let Be=w.depthTexture;if(ve.__boundDepthTexture!==Be){if(Be!==null&&A.has(Be)&&(w.width!==Be.image.width||w.height!==Be.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");y.setupDepthRenderbuffer(w)}}let Ae=w.texture;(Ae.isData3DTexture||Ae.isDataArrayTexture||Ae.isCompressedArrayTexture)&&(ae=!0);let ye=A.get(w).__webglFramebuffer;w.isWebGLCubeRenderTarget?(Array.isArray(ye[N])?V=ye[N][H]:V=ye[N],X=!0):w.samples>0&&y.useMultisampledRTT(w)===!1?V=A.get(w).__webglMultisampledFramebuffer:Array.isArray(ye)?V=ye[H]:V=ye,ne.copy(w.viewport),ce.copy(w.scissor),ue=w.scissorTest}else ne.copy(se).multiplyScalar(je).floor(),ce.copy(Fe).multiplyScalar(je).floor(),ue=Ve;if(H!==0&&(V=Ge),xe.bindFramebuffer(O.FRAMEBUFFER,V)&&xe.drawBuffers(w,V),xe.viewport(ne),xe.scissor(ce),xe.setScissorTest(ue),X){let ve=A.get(w.texture);O.framebufferTexture2D(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_CUBE_MAP_POSITIVE_X+N,ve.__webglTexture,H)}else if(ae){let ve=N;for(let Ae=0;Ae<w.textures.length;Ae++){let ye=A.get(w.textures[Ae]);O.framebufferTextureLayer(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0+Ae,ye.__webglTexture,H,ve)}}else if(w!==null&&H!==0){let ve=A.get(w.texture);O.framebufferTexture2D(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_2D,ve.__webglTexture,H)}Y=-1},this.readRenderTargetPixels=function(w,N,H,V,X,ae,be,ve=0){if(!(w&&w.isWebGLRenderTarget)){We("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Ae=A.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&be!==void 0&&(Ae=Ae[be]),Ae){xe.bindFramebuffer(O.FRAMEBUFFER,Ae);try{let ye=w.textures[ve],Be=ye.format,qe=ye.type;if(w.textures.length>1&&O.readBuffer(O.COLOR_ATTACHMENT0+ve),!ut.textureFormatReadable(Be)){We("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!ut.textureTypeReadable(qe)){We("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}N>=0&&N<=w.width-V&&H>=0&&H<=w.height-X&&O.readPixels(N,H,V,X,E.convert(Be),E.convert(qe),ae)}finally{let ye=z!==null?A.get(z).__webglFramebuffer:null;xe.bindFramebuffer(O.FRAMEBUFFER,ye)}}},this.readRenderTargetPixelsAsync=async function(w,N,H,V,X,ae,be,ve=0){if(!(w&&w.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Ae=A.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&be!==void 0&&(Ae=Ae[be]),Ae)if(N>=0&&N<=w.width-V&&H>=0&&H<=w.height-X){xe.bindFramebuffer(O.FRAMEBUFFER,Ae);let ye=w.textures[ve],Be=ye.format,qe=ye.type;if(w.textures.length>1&&O.readBuffer(O.COLOR_ATTACHMENT0+ve),!ut.textureFormatReadable(Be))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!ut.textureTypeReadable(qe))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Re=O.createBuffer();O.bindBuffer(O.PIXEL_PACK_BUFFER,Re),O.bufferData(O.PIXEL_PACK_BUFFER,ae.byteLength,O.STREAM_READ),O.readPixels(N,H,V,X,E.convert(Be),E.convert(qe),0);let st=z!==null?A.get(z).__webglFramebuffer:null;xe.bindFramebuffer(O.FRAMEBUFFER,st);let kt=O.fenceSync(O.SYNC_GPU_COMMANDS_COMPLETE,0);return O.flush(),await m0(O,kt,4),O.bindBuffer(O.PIXEL_PACK_BUFFER,Re),O.getBufferSubData(O.PIXEL_PACK_BUFFER,0,ae),O.deleteBuffer(Re),O.deleteSync(kt),ae}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(w,N=null,H=0){let V=Math.pow(2,-H),X=Math.floor(w.image.width*V),ae=Math.floor(w.image.height*V),be=N!==null?N.x:0,ve=N!==null?N.y:0;y.setTexture2D(w,0),O.copyTexSubImage2D(O.TEXTURE_2D,H,0,0,be,ve,X,ae),xe.unbindTexture()};let Oe=O.createFramebuffer(),Ye=O.createFramebuffer();this.copyTextureToTexture=function(w,N,H=null,V=null,X=0,ae=0){let be,ve,Ae,ye,Be,qe,Re,st,kt,yt=w.isCompressedTexture?w.mipmaps[ae]:w.image;if(H!==null)be=H.max.x-H.min.x,ve=H.max.y-H.min.y,Ae=H.isBox3?H.max.z-H.min.z:1,ye=H.min.x,Be=H.min.y,qe=H.isBox3?H.min.z:0;else{let qt=Math.pow(2,-X);be=Math.floor(yt.width*qt),ve=Math.floor(yt.height*qt),w.isDataArrayTexture?Ae=yt.depth:w.isData3DTexture?Ae=Math.floor(yt.depth*qt):Ae=1,ye=0,Be=0,qe=0}V!==null?(Re=V.x,st=V.y,kt=V.z):(Re=0,st=0,kt=0);let Tt=E.convert(N.format),fn=E.convert(N.type),Ce;N.isData3DTexture?(y.setTexture3D(N,0),Ce=O.TEXTURE_3D):N.isDataArrayTexture||N.isCompressedArrayTexture?(y.setTexture2DArray(N,0),Ce=O.TEXTURE_2D_ARRAY):(y.setTexture2D(N,0),Ce=O.TEXTURE_2D),xe.activeTexture(O.TEXTURE0),xe.pixelStorei(O.UNPACK_FLIP_Y_WEBGL,N.flipY),xe.pixelStorei(O.UNPACK_PREMULTIPLY_ALPHA_WEBGL,N.premultiplyAlpha),xe.pixelStorei(O.UNPACK_ALIGNMENT,N.unpackAlignment);let Xn=xe.getParameter(O.UNPACK_ROW_LENGTH),ft=xe.getParameter(O.UNPACK_IMAGE_HEIGHT),si=xe.getParameter(O.UNPACK_SKIP_PIXELS),Bi=xe.getParameter(O.UNPACK_SKIP_ROWS),yr=xe.getParameter(O.UNPACK_SKIP_IMAGES);xe.pixelStorei(O.UNPACK_ROW_LENGTH,yt.width),xe.pixelStorei(O.UNPACK_IMAGE_HEIGHT,yt.height),xe.pixelStorei(O.UNPACK_SKIP_PIXELS,ye),xe.pixelStorei(O.UNPACK_SKIP_ROWS,Be),xe.pixelStorei(O.UNPACK_SKIP_IMAGES,qe);let Bs=w.isDataArrayTexture||w.isData3DTexture,At=N.isDataArrayTexture||N.isData3DTexture;if(w.isDepthTexture){let qt=A.get(w),Sr=A.get(N),Rt=A.get(qt.__renderTarget),Mr=A.get(Sr.__renderTarget);xe.bindFramebuffer(O.READ_FRAMEBUFFER,Rt.__webglFramebuffer),xe.bindFramebuffer(O.DRAW_FRAMEBUFFER,Mr.__webglFramebuffer);for(let ks=0;ks<Ae;ks++)Bs&&(O.framebufferTextureLayer(O.READ_FRAMEBUFFER,O.COLOR_ATTACHMENT0,A.get(w).__webglTexture,X,qe+ks),O.framebufferTextureLayer(O.DRAW_FRAMEBUFFER,O.COLOR_ATTACHMENT0,A.get(N).__webglTexture,ae,kt+ks)),O.blitFramebuffer(ye,Be,be,ve,Re,st,be,ve,O.DEPTH_BUFFER_BIT,O.NEAREST);xe.bindFramebuffer(O.READ_FRAMEBUFFER,null),xe.bindFramebuffer(O.DRAW_FRAMEBUFFER,null)}else if(X!==0||w.isRenderTargetTexture||A.has(w)){let qt=A.get(w),Sr=A.get(N);xe.bindFramebuffer(O.READ_FRAMEBUFFER,Oe),xe.bindFramebuffer(O.DRAW_FRAMEBUFFER,Ye);for(let Rt=0;Rt<Ae;Rt++)Bs?O.framebufferTextureLayer(O.READ_FRAMEBUFFER,O.COLOR_ATTACHMENT0,qt.__webglTexture,X,qe+Rt):O.framebufferTexture2D(O.READ_FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_2D,qt.__webglTexture,X),At?O.framebufferTextureLayer(O.DRAW_FRAMEBUFFER,O.COLOR_ATTACHMENT0,Sr.__webglTexture,ae,kt+Rt):O.framebufferTexture2D(O.DRAW_FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_2D,Sr.__webglTexture,ae),X!==0?O.blitFramebuffer(ye,Be,be,ve,Re,st,be,ve,O.COLOR_BUFFER_BIT,O.NEAREST):At?O.copyTexSubImage3D(Ce,ae,Re,st,kt+Rt,ye,Be,be,ve):O.copyTexSubImage2D(Ce,ae,Re,st,ye,Be,be,ve);xe.bindFramebuffer(O.READ_FRAMEBUFFER,null),xe.bindFramebuffer(O.DRAW_FRAMEBUFFER,null)}else At?w.isDataTexture||w.isData3DTexture?O.texSubImage3D(Ce,ae,Re,st,kt,be,ve,Ae,Tt,fn,yt.data):N.isCompressedArrayTexture?O.compressedTexSubImage3D(Ce,ae,Re,st,kt,be,ve,Ae,Tt,yt.data):O.texSubImage3D(Ce,ae,Re,st,kt,be,ve,Ae,Tt,fn,yt):w.isDataTexture?O.texSubImage2D(O.TEXTURE_2D,ae,Re,st,be,ve,Tt,fn,yt.data):w.isCompressedTexture?O.compressedTexSubImage2D(O.TEXTURE_2D,ae,Re,st,yt.width,yt.height,Tt,yt.data):O.texSubImage2D(O.TEXTURE_2D,ae,Re,st,be,ve,Tt,fn,yt);xe.pixelStorei(O.UNPACK_ROW_LENGTH,Xn),xe.pixelStorei(O.UNPACK_IMAGE_HEIGHT,ft),xe.pixelStorei(O.UNPACK_SKIP_PIXELS,si),xe.pixelStorei(O.UNPACK_SKIP_ROWS,Bi),xe.pixelStorei(O.UNPACK_SKIP_IMAGES,yr),ae===0&&N.generateMipmaps&&O.generateMipmap(Ce),xe.unbindTexture()},this.initRenderTarget=function(w){A.get(w).__webglFramebuffer===void 0&&y.setupRenderTarget(w)},this.initTexture=function(w){w.isCubeTexture?y.setTextureCube(w,0):w.isData3DTexture?y.setTexture3D(w,0):w.isDataArrayTexture||w.isCompressedArrayTexture?y.setTexture2DArray(w,0):y.setTexture2D(w,0),xe.unbindTexture()},this.resetState=function(){j=0,$=0,z=null,xe.reset(),U.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Mi}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let n=this.getContext();n.drawingBufferColorSpace=lt._getDrawingBufferColorSpace(e),n.unpackColorSpace=lt._getUnpackColorSpace()}};var $0={type:"change"},Vf={type:"start"},K0={type:"end"},Ou=new oo,j0=new ai,DE=Math.cos(70*Bn.DEG2RAD),Qt=new D,kn=2*Math.PI,wt={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},zf=1e-6,Bu=class extends Ea{constructor(e,n=null){super(e,n),this.state=wt.NONE,this.target=new D,this.cursor=new D,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:Fr.ROTATE,MIDDLE:Fr.DOLLY,RIGHT:Fr.PAN},this.touches={ONE:Or.ROTATE,TWO:Or.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._cursorStyle="auto",this._domElementKeyEvents=null,this._lastPosition=new D,this._lastQuaternion=new ln,this._lastTargetPosition=new D,this._quat=new ln().setFromUnitVectors(e.up,new D(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new Ur,this._sphericalDelta=new Ur,this._scale=1,this._panOffset=new D,this._rotateStart=new Le,this._rotateEnd=new Le,this._rotateDelta=new Le,this._panStart=new Le,this._panEnd=new Le,this._panDelta=new Le,this._dollyStart=new Le,this._dollyEnd=new Le,this._dollyDelta=new Le,this._dollyDirection=new D,this._mouse=new Le,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=UE.bind(this),this._onPointerDown=NE.bind(this),this._onPointerUp=FE.bind(this),this._onContextMenu=HE.bind(this),this._onMouseWheel=kE.bind(this),this._onKeyDown=zE.bind(this),this._onTouchStart=VE.bind(this),this._onTouchMove=GE.bind(this),this._onMouseDown=OE.bind(this),this._onMouseMove=BE.bind(this),this._interceptControlDown=WE.bind(this),this._interceptControlUp=XE.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}set cursorStyle(e){this._cursorStyle=e,e==="grab"?this.domElement.style.cursor="grab":this.domElement.style.cursor="auto"}get cursorStyle(){return this._cursorStyle}connect(e){super.connect(e),this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction=""}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(e){e.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=e}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent($0),this.update(),this.state=wt.NONE}pan(e,n){this._pan(e,n),this.update()}dollyIn(e){this._dollyIn(e),this.update()}dollyOut(e){this._dollyOut(e),this.update()}rotateLeft(e){this._rotateLeft(e),this.update()}rotateUp(e){this._rotateUp(e),this.update()}update(e=null){let n=this.object.position;Qt.copy(n).sub(this.target),Qt.applyQuaternion(this._quat),this._spherical.setFromVector3(Qt),this.autoRotate&&this.state===wt.NONE&&this._rotateLeft(this._getAutoRotationAngle(e)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let i=this.minAzimuthAngle,r=this.maxAzimuthAngle;isFinite(i)&&isFinite(r)&&(i<-Math.PI?i+=kn:i>Math.PI&&(i-=kn),r<-Math.PI?r+=kn:r>Math.PI&&(r-=kn),i<=r?this._spherical.theta=Math.max(i,Math.min(r,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(i+r)/2?Math.max(i,this._spherical.theta):Math.min(r,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let s=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{let o=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),s=o!=this._spherical.radius}if(Qt.setFromSpherical(this._spherical),Qt.applyQuaternion(this._quatInverse),n.copy(this.target).add(Qt),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let o=null;if(this.object.isPerspectiveCamera){let a=Qt.length();o=this._clampDistance(a*this._scale);let l=a-o;this.object.position.addScaledVector(this._dollyDirection,l),this.object.updateMatrixWorld(),s=!!l}else if(this.object.isOrthographicCamera){let a=new D(this._mouse.x,this._mouse.y,0);a.unproject(this.object);let l=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),s=l!==this.object.zoom;let c=new D(this._mouse.x,this._mouse.y,0);c.unproject(this.object),this.object.position.sub(c).add(a),this.object.updateMatrixWorld(),o=Qt.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;o!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(o).add(this.object.position):(Ou.origin.copy(this.object.position),Ou.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(Ou.direction))<DE?this.object.lookAt(this.target):(j0.setFromNormalAndCoplanarPoint(this.object.up,this.target),Ou.intersectPlane(j0,this.target))))}else if(this.object.isOrthographicCamera){let o=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),o!==this.object.zoom&&(this.object.updateProjectionMatrix(),s=!0)}return this._scale=1,this._performCursorZoom=!1,s||this._lastPosition.distanceToSquared(this.object.position)>zf||8*(1-this._lastQuaternion.dot(this.object.quaternion))>zf||this._lastTargetPosition.distanceToSquared(this.target)>zf?(this.dispatchEvent($0),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(e){return e!==null?kn/60*this.autoRotateSpeed*e:kn/60/60*this.autoRotateSpeed}_getZoomScale(e){let n=Math.abs(e*.01);return Math.pow(.95,this.zoomSpeed*n)}_rotateLeft(e){this._sphericalDelta.theta-=e}_rotateUp(e){this._sphericalDelta.phi-=e}_panLeft(e,n){Qt.setFromMatrixColumn(n,0),Qt.multiplyScalar(-e),this._panOffset.add(Qt)}_panUp(e,n){this.screenSpacePanning===!0?Qt.setFromMatrixColumn(n,1):(Qt.setFromMatrixColumn(n,0),Qt.crossVectors(this.object.up,Qt)),Qt.multiplyScalar(e),this._panOffset.add(Qt)}_pan(e,n){let i=this.domElement;if(this.object.isPerspectiveCamera){let r=this.object.position;Qt.copy(r).sub(this.target);let s=Qt.length();s*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*e*s/i.clientHeight,this.object.matrix),this._panUp(2*n*s/i.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(e*(this.object.right-this.object.left)/this.object.zoom/i.clientWidth,this.object.matrix),this._panUp(n*(this.object.top-this.object.bottom)/this.object.zoom/i.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(e,n){if(!this.zoomToCursor)return;this._performCursorZoom=!0;let i=this.domElement.getBoundingClientRect(),r=e-i.left,s=n-i.top,o=i.width,a=i.height;this._mouse.x=r/o*2-1,this._mouse.y=-(s/a)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(e){return Math.max(this.minDistance,Math.min(this.maxDistance,e))}_handleMouseDownRotate(e){this._rotateStart.set(e.clientX,e.clientY)}_handleMouseDownDolly(e){this._updateZoomParameters(e.clientX,e.clientX),this._dollyStart.set(e.clientX,e.clientY)}_handleMouseDownPan(e){this._panStart.set(e.clientX,e.clientY)}_handleMouseMoveRotate(e){this._rotateEnd.set(e.clientX,e.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let n=this.domElement;this._rotateLeft(kn*this._rotateDelta.x/n.clientHeight),this._rotateUp(kn*this._rotateDelta.y/n.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(e){this._dollyEnd.set(e.clientX,e.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(e){this._panEnd.set(e.clientX,e.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(e){this._updateZoomParameters(e.clientX,e.clientY),e.deltaY<0?this._dollyIn(this._getZoomScale(e.deltaY)):e.deltaY>0&&this._dollyOut(this._getZoomScale(e.deltaY)),this.update()}_handleKeyDown(e){let n=!1;switch(e.code){case this.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(kn*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),n=!0;break;case this.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(-kn*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),n=!0;break;case this.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(kn*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),n=!0;break;case this.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(-kn*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),n=!0;break}n&&(e.preventDefault(),this.update())}_handleTouchStartRotate(e){if(this._pointers.length===1)this._rotateStart.set(e.pageX,e.pageY);else{let n=this._getSecondPointerPosition(e),i=.5*(e.pageX+n.x),r=.5*(e.pageY+n.y);this._rotateStart.set(i,r)}}_handleTouchStartPan(e){if(this._pointers.length===1)this._panStart.set(e.pageX,e.pageY);else{let n=this._getSecondPointerPosition(e),i=.5*(e.pageX+n.x),r=.5*(e.pageY+n.y);this._panStart.set(i,r)}}_handleTouchStartDolly(e){let n=this._getSecondPointerPosition(e),i=e.pageX-n.x,r=e.pageY-n.y,s=Math.sqrt(i*i+r*r);this._dollyStart.set(0,s)}_handleTouchStartDollyPan(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enablePan&&this._handleTouchStartPan(e)}_handleTouchStartDollyRotate(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enableRotate&&this._handleTouchStartRotate(e)}_handleTouchMoveRotate(e){if(this._pointers.length==1)this._rotateEnd.set(e.pageX,e.pageY);else{let i=this._getSecondPointerPosition(e),r=.5*(e.pageX+i.x),s=.5*(e.pageY+i.y);this._rotateEnd.set(r,s)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let n=this.domElement;this._rotateLeft(kn*this._rotateDelta.x/n.clientHeight),this._rotateUp(kn*this._rotateDelta.y/n.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(e){if(this._pointers.length===1)this._panEnd.set(e.pageX,e.pageY);else{let n=this._getSecondPointerPosition(e),i=.5*(e.pageX+n.x),r=.5*(e.pageY+n.y);this._panEnd.set(i,r)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(e){let n=this._getSecondPointerPosition(e),i=e.pageX-n.x,r=e.pageY-n.y,s=Math.sqrt(i*i+r*r);this._dollyEnd.set(0,s),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);let o=(e.pageX+n.x)*.5,a=(e.pageY+n.y)*.5;this._updateZoomParameters(o,a)}_handleTouchMoveDollyPan(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enablePan&&this._handleTouchMovePan(e)}_handleTouchMoveDollyRotate(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enableRotate&&this._handleTouchMoveRotate(e)}_addPointer(e){this._pointers.push(e.pointerId)}_removePointer(e){delete this._pointerPositions[e.pointerId];for(let n=0;n<this._pointers.length;n++)if(this._pointers[n]==e.pointerId){this._pointers.splice(n,1);return}}_isTrackingPointer(e){for(let n=0;n<this._pointers.length;n++)if(this._pointers[n]==e.pointerId)return!0;return!1}_trackPointer(e){let n=this._pointerPositions[e.pointerId];n===void 0&&(n=new Le,this._pointerPositions[e.pointerId]=n),n.set(e.pageX,e.pageY)}_getSecondPointerPosition(e){let n=e.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[n]}_customWheelEvent(e){let n=e.deltaMode,i={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY};switch(n){case 1:i.deltaY*=16;break;case 2:i.deltaY*=100;break}return e.ctrlKey&&!this._controlActive&&(i.deltaY*=10),i}};function NE(t){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(t.pointerId),this.domElement.ownerDocument.addEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(t)&&(this._addPointer(t),t.pointerType==="touch"?this._onTouchStart(t):this._onMouseDown(t),this._cursorStyle==="grab"&&(this.domElement.style.cursor="grabbing")))}function UE(t){this.enabled!==!1&&(t.pointerType==="touch"?this._onTouchMove(t):this._onMouseMove(t))}function FE(t){switch(this._removePointer(t),this._pointers.length){case 0:this.domElement.releasePointerCapture(t.pointerId),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(K0),this.state=wt.NONE,this._cursorStyle==="grab"&&(this.domElement.style.cursor="grab");break;case 1:let e=this._pointers[0],n=this._pointerPositions[e];this._onTouchStart({pointerId:e,pageX:n.x,pageY:n.y});break}}function OE(t){let e;switch(t.button){case 0:e=this.mouseButtons.LEFT;break;case 1:e=this.mouseButtons.MIDDLE;break;case 2:e=this.mouseButtons.RIGHT;break;default:e=-1}switch(e){case Fr.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(t),this.state=wt.DOLLY;break;case Fr.ROTATE:if(t.ctrlKey||t.metaKey||t.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(t),this.state=wt.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(t),this.state=wt.ROTATE}break;case Fr.PAN:if(t.ctrlKey||t.metaKey||t.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(t),this.state=wt.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(t),this.state=wt.PAN}break;default:this.state=wt.NONE}this.state!==wt.NONE&&this.dispatchEvent(Vf)}function BE(t){switch(this.state){case wt.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(t);break;case wt.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(t);break;case wt.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(t);break}}function kE(t){this.enabled===!1||this.enableZoom===!1||this.state!==wt.NONE||(t.preventDefault(),this.dispatchEvent(Vf),this._handleMouseWheel(this._customWheelEvent(t)),this.dispatchEvent(K0))}function zE(t){this.enabled!==!1&&this._handleKeyDown(t)}function VE(t){switch(this._trackPointer(t),this._pointers.length){case 1:switch(this.touches.ONE){case Or.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(t),this.state=wt.TOUCH_ROTATE;break;case Or.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(t),this.state=wt.TOUCH_PAN;break;default:this.state=wt.NONE}break;case 2:switch(this.touches.TWO){case Or.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(t),this.state=wt.TOUCH_DOLLY_PAN;break;case Or.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(t),this.state=wt.TOUCH_DOLLY_ROTATE;break;default:this.state=wt.NONE}break;default:this.state=wt.NONE}this.state!==wt.NONE&&this.dispatchEvent(Vf)}function GE(t){switch(this._trackPointer(t),this.state){case wt.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(t),this.update();break;case wt.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(t),this.update();break;case wt.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(t),this.update();break;case wt.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(t),this.update();break;default:this.state=wt.NONE}}function HE(t){this.enabled!==!1&&t.preventDefault()}function WE(t){t.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function XE(t){t.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}var Ba=new D;function hi(t,e,n,i,r,s){let o=2*Math.PI*r/4,a=Math.max(s-2*r,0),l=Math.PI/4;Ba.copy(e),Ba[i]=0,Ba.normalize();let c=.5*o/(o+a),d=1-Ba.angleTo(t)/l;return Math.sign(Ba[n])===1?d*c:a/(o+a)+c+c*(1-d)}var ku=class t extends Ir{constructor(e=1,n=1,i=1,r=2,s=.1){let o=r*2+1;if(s=Math.min(e/2,n/2,i/2,s),super(1,1,1,o,o,o),this.type="RoundedBoxGeometry",this.parameters={width:e,height:n,depth:i,segments:r,radius:s},o===1)return;let a=this.toNonIndexed();this.index=null,this.attributes.position=a.attributes.position,this.attributes.normal=a.attributes.normal,this.attributes.uv=a.attributes.uv;let l=new D,c=new D,d=new D(e,n,i).divideScalar(2).subScalar(s),p=this.attributes.position.array,h=this.attributes.normal.array,f=this.attributes.uv.array,v=p.length/6,M=new D,g=.5/o;for(let u=0,m=0;u<p.length;u+=3,m+=2)switch(l.fromArray(p,u),c.copy(l),c.x-=Math.sign(c.x)*g,c.y-=Math.sign(c.y)*g,c.z-=Math.sign(c.z)*g,c.normalize(),p[u+0]=d.x*Math.sign(l.x)+c.x*s,p[u+1]=d.y*Math.sign(l.y)+c.y*s,p[u+2]=d.z*Math.sign(l.z)+c.z*s,h[u+0]=c.x,h[u+1]=c.y,h[u+2]=c.z,Math.floor(u/v)){case 0:M.set(1,0,0),f[m+0]=hi(M,c,"z","y",s,i),f[m+1]=1-hi(M,c,"y","z",s,n);break;case 1:M.set(-1,0,0),f[m+0]=1-hi(M,c,"z","y",s,i),f[m+1]=1-hi(M,c,"y","z",s,n);break;case 2:M.set(0,1,0),f[m+0]=1-hi(M,c,"x","z",s,e),f[m+1]=hi(M,c,"z","x",s,i);break;case 3:M.set(0,-1,0),f[m+0]=1-hi(M,c,"x","z",s,e),f[m+1]=1-hi(M,c,"z","x",s,i);break;case 4:M.set(0,0,1),f[m+0]=1-hi(M,c,"x","y",s,e),f[m+1]=1-hi(M,c,"y","x",s,n);break;case 5:M.set(0,0,-1),f[m+0]=hi(M,c,"x","y",s,e),f[m+1]=1-hi(M,c,"y","x",s,n);break}}static fromJSON(e){return new t(e.width,e.height,e.depth,e.segments,e.radius)}};var Uy=Ll(Hu()),Fy=Ll(Iy()),we=Ll(ag());function mC(t){if(typeof ResizeObserver=="function")return new ResizeObserver(t);let e=new Set,n;function i(){cancelAnimationFrame(n),n=requestAnimationFrame(()=>{let r=Array.from(e,s=>({target:s,contentRect:{width:s.clientWidth,height:s.clientHeight}}));r.length&&t(r)})}return{observe(r){e.add(r),window.addEventListener("resize",i),i()},disconnect(){e.clear(),cancelAnimationFrame(n),window.removeEventListener("resize",i)}}}var gC={config_version:"2.0",tweaks:[],texts:[{id:"HINT_TEXT",label:"Camera guide",value:"Ruota trascinando, zoom con due dita",default:"Ruota trascinando, zoom con due dita",max_length:42}],images:[],playable:{runtime_target:"h5",h5_playstyle_type:"general_game",content_locale:"it",min_capability_level:1,full_capability_level:1}},lg=gC;async function _C(){let t;try{let e=fetch("./game.config.json",{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null),n=new Promise(r=>{t=setTimeout(()=>r(null),1200)}),i=await Promise.race([e,n]);return i&&typeof i=="object"&&!Array.isArray(i)&&(lg=i),{ok:!0,json:async()=>lg}}finally{clearTimeout(t)}}var vC=`@font-face{font-family:DM;src:url('./assets/fonts/DMSans.woff') format('woff');font-weight:100 1000;font-display:swap}
:root{font-family:DM,system-ui,sans-serif;color:#243640;background:#edf2f4;font-synthesis:none;--ink:#243640;--muted:#52656f;--line:#afbec6;--primary:#2a5968;--surface:rgba(255,255,255,.88)}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{overscroll-behavior:none}button,input,select{font:inherit}button,select{cursor:pointer;touch-action:manipulation}button{min-width:44px;min-height:44px;color:inherit;border:0;background:transparent;border-radius:14px;transition:background .15s,color .15s}button:active{background:#d1e1e7}button:focus-visible,select:focus-visible,input:focus-visible,#stage:focus-visible{outline:3px solid #296e8b;outline-offset:3px}button svg{width:21px;height:21px;stroke:currentColor;stroke-width:1.7;fill:none;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
#game{width:100%;height:100%;display:grid;grid-template-rows:auto minmax(80px,1fr) auto;padding:30px 30px 50px;gap:10px;background:radial-gradient(ellipse at 45% 35%,#fbfcfc 0,#edf2f4 75%);position:relative}
#top{z-index:2;text-align:center}#difference{display:block;font-size:28px;font-weight:750;line-height:1.25;font-variant-numeric:tabular-nums;margin:0 0 14px}#difference small{font-size:14px;font-weight:550;color:var(--muted)}#views{display:grid;grid-template-columns:1fr 1fr 1fr;background:#dce6ea;border-radius:16px;padding:4px;gap:4px}#views button{font-size:14px;font-weight:650;white-space:nowrap;min-width:0}#views button[aria-pressed=true]{background:white;box-shadow:0 2px 5px #26404b12;color:var(--primary)}
#stage{position:relative;min-height:0;touch-action:none;outline-offset:-3px;border-radius:12px;isolation:isolate}#stage canvas{width:100%;height:100%;display:block;cursor:grab;touch-action:none}#stage canvas:active{cursor:grabbing}#labels{position:absolute;inset:0;pointer-events:none;overflow:hidden}.person-label{position:absolute;max-width:42%;padding:4px 7px;border-radius:9px;font-size:14px;font-weight:700;background:#f8fbfbe8;line-height:1.3;overflow-wrap:anywhere;box-shadow:0 1px 4px #17333d0a;transform:translate(-50%,-100%)}.person-label small{display:block;font-size:12px;font-weight:550;color:var(--muted)}#label-a{border-bottom:2px solid #ab6476}#label-b{border-bottom:2px solid #337794}
.person-label{width:max-content;min-width:72px}#leaders{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}#leaders line{stroke-width:1;opacity:.65}#guide{position:absolute;bottom:2px;left:0;right:0;text-align:center;font-size:18px;line-height:1.5;margin:0;pointer-events:none;color:var(--muted);transition:opacity .18s}#game[data-started=true] #guide{visibility:hidden;opacity:0}
#toolbar{z-index:3;display:grid;gap:8px}.scene-picker{display:block;min-width:0}#scene{width:100%;height:46px;border:1px solid #a5b8c2;border-radius:14px;background:var(--surface);color:var(--ink);font-size:16px;font-weight:650;padding:0 14px;text-overflow:ellipsis}#toolbar .actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}#toolbar button{display:flex;align-items:center;justify-content:center;gap:7px;font-size:14px;font-weight:650;border:1px solid #bccbd2;background:#ffffffaa}#toolbar #photo{color:white;background:var(--primary);border-color:var(--primary)}#photo:disabled{opacity:.55;cursor:wait}
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}dialog{border:1px solid #bdcbd1;border-radius:24px;padding:22px;width:min(calc(100% - 48px),360px);max-height:calc(100% - 60px);overflow:auto;color:var(--ink);background:#f8fbfc;box-shadow:0 18px 65px #1a38482a}dialog::backdrop{background:#1e344270}dialog form{display:grid;gap:18px}.dialog-heading{display:flex;justify-content:space-between;align-items:center;gap:8px}h2{font-size:24px;line-height:1.25;margin:0}.dialog-heading button{font-size:28px;flex:0 0 44px}fieldset{margin:0;padding:0;border:0;display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:6px 12px}legend{font-size:14px;font-weight:750;margin:0 0 8px;color:#79515c}fieldset+fieldset legend{color:#326d87}fieldset label{display:block;font-size:14px;font-weight:650}fieldset label span{font-weight:400;color:var(--muted)}input{display:block;margin-top:6px;width:100%;min-width:0;height:46px;border:1px solid #a5b8c2;background:white;border-radius:10px;padding:0 10px;font-size:16px;color:var(--ink)}input[aria-invalid=true]{border:2px solid #ae3046}.field-error{grid-column:1/-1;min-height:0;font-size:14px;color:#9f263c;margin:0}.field-error:empty{display:none}#apply{color:white;background:var(--primary);font-weight:700;font-size:16px}.privacy{text-align:center;font-size:12px;color:var(--muted);margin:-8px 0 0}#error{position:absolute;inset:100px 30px 130px;display:grid;place-content:center;text-align:center;z-index:5;background:#edf2f4e8}#error[hidden]{display:none}#error button{background:var(--primary);color:white}
#game[data-feed-preview=true]{grid-template-rows:minmax(80px,1fr);padding:60px 30px 120px}#game[data-feed-preview=true] #top,#game[data-feed-preview=true] #toolbar{display:none}#game[data-feed-preview=true] #labels{display:none}#game[data-feed-preview=true] #guide{bottom:0;color:#243640}
@media(max-width:350px){#game{padding-left:26px;padding-right:26px}#views button{font-size:13px}#toolbar button{gap:4px;font-size:13px}#toolbar button svg{width:18px;height:18px}}
@media(max-height:530px){#game{gap:6px;padding-top:24px;padding-bottom:36px}#difference{margin-bottom:8px}#toolbar{gap:6px}#guide{font-size:18px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root #game#game#game p#guide{position:fixed!important;top:0%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
html:root:root:root #game #stage{margin-top:36px}
html:root:root:root #game#game#game p#guide{position:absolute!important;top:-36px!important;translate:-50% 0!important}
html:root:root:root #game[data-feed-preview="true"] #stage{margin-top:0}
html:root:root:root #game#game#game[data-feed-preview="true"] p#guide{top:8%!important}

/* Existing guide text only; position, opacity lifecycle and hit regions remain game-owned. */
@keyframes batch-guide-breathe{0%,100%{filter:opacity(1)}50%{filter:opacity(.65)}}
html:root:root :is(#game p#guide){animation:batch-guide-breathe 2.4s ease-in-out infinite!important}
html[data-guide-breathing-paused]:root:root :is(#game p#guide){animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){html:root:root :is(#game p#guide){animation:none!important}}

/* Italian copy keeps the approved role sizes and may wrap instead of clipping. */
html[lang="it"] :is(.meeting-guide,.feed-first-action,.melody-guide,.particle-guide,.dive-guide,.sandbox-guide,.koi-guide,.ui-guide,.bead-guide,.coloring-guide,.look-guide,.time-print-guide){white-space:normal;overflow-wrap:normal;word-break:normal;line-height:1.4}
html[lang="it"] :is(button,.btn,.btn-neon){overflow-wrap:normal;word-break:normal}
html[lang="it"] .melody-controls button{font-size:18px;padding-inline:12px}
html[lang="it"] .meeting-sand-ball-count{gap:6px!important}
html[lang="it"] #people-dialog fieldset label{min-width:0}
html[lang="it"] #people-dialog input{max-width:100%;min-width:0}
`,Oy=document.createElement("style");Oy.textContent=vC;document.head.append(Oy);document.documentElement.lang="it";function xC(){(()=>{let F=document.documentElement,E=!0,U=()=>F.toggleAttribute("data-guide-breathing-paused",document.hidden||!E),L=typeof IntersectionObserver=="function"?new IntersectionObserver(k=>{E=k.some(G=>G.isIntersecting),U()}):null;document.body&&(L==null||L.observe(document.body)),document.addEventListener("visibilitychange",U),U(),window.addEventListener("pagehide",()=>{L==null||L.disconnect(),document.removeEventListener("visibilitychange",U)},{once:!0})})();let t=Object.freeze([{id:"together",name:"Fianco a fianco"},{id:"umbrella",name:"Sotto l\u2019ombrello"},{id:"cafe",name:"Un caff\xE8 insieme"},{id:"shelf",name:"Raggiungi il ripiano"},{id:"hug",name:"Un abbraccio"},{id:"scarf",name:"Una sciarpa per due"},{id:"piggyback",name:"Sulle spalle"},{id:"carry",name:"In braccio"}]),e=Object.freeze({a:{name:"Tu",height:162,color:"#cf8e9c"},b:{name:"Partner",height:180,color:"#68a8c4"},scene:"together"});function n(){return structuredClone(e)}function i(F,E){return String(F??"").trim().slice(0,20)||E}function r(F){if(String(F).trim()==="")return{error:"Inserisci l\u2019altezza in cm."};let E=Number(F);return!Number.isFinite(E)||E<50||E>500?{error:"Inserisci un\u2019altezza tra 50 e 500 cm."}:{value:Math.round(E*10)/10}}function s(F){return Number(F).toLocaleString("it-IT",{maximumFractionDigits:1})}function o(F){return Math.round(Math.abs(F.a.height-F.b.height)*10)/10}function a(F){return{...F,a:{...F.b},b:{...F.a}}}function l(F,E){let U=r(F.aHeight),L=r(F.bHeight),k={};return U.error&&(k.aHeight=U.error),L.error&&(k.bHeight=L.error),Object.keys(k).length?{errors:k}:{state:{...E,a:{...E.a,name:i(F.aName,"Tu"),height:U.value},b:{...E.b,name:i(F.bName,"Partner"),height:L.value}}}}function c(F){let E=F.a.height/100,U=F.b.height/100,L=Math.max(E,U),k=F.scene==="cafe"?(E+U)*.2+.14:(E+U)*.115+.15,G={x:-k/2,y:0,z:0,yaw:.07,tilt:0,mode:"stand"},q={x:k/2,y:0,z:0,yaw:-.07,tilt:0,mode:"stand"};if(F.scene==="cafe"){G.mode=q.mode="sit";for(let[te,he]of[[G,E],[q,U]])te.y=(L-he)*.4,te.z=(L-he)*.14}if(F.scene==="hug"){let te=(E+U)*.06+Math.min(E,U)*.02;G.x=-te/2,q.x=te/2,G.yaw=Math.PI/2,q.yaw=-Math.PI/2,G.mode=q.mode="hug"}if(F.scene==="piggyback"){let te=E>=U?G:q,he=te===G?q:G,Ue=Math.max(E,U),Ne=Math.min(E,U);te.x=0,te.mode="carrier",he.x=0,he.z=-Ue*.12-Ne*.06,he.y=Ue*.46,he.mode="rider",he.legSpread=Math.min(Ue*.19/Ne,.19)}if(F.scene==="carry"){let te=E>=U?G:q,he=te===G?q:G,Ue=Math.max(E,U),Ne=Math.min(E,U);te.x=0,te.mode="carry",he.x=-Ne*.37,he.y=Ue*.7-Ne*.43*Math.cos(Math.PI*.36),he.z=Ue*.1,he.tilt=-Math.PI*.36,he.mode="cradle"}return F.scene==="shelf"&&(G.yaw=q.yaw=Math.PI,G.mode=q.mode="reach",G.z=-.3*L+.155+.16*E,q.z=-.3*L+.155+.16*U),F.scene==="umbrella"&&((E>=U?G:q).mode="umbrella"),{a:G,b:q,max:L,gap:k,hA:E,hB:U}}function d(F,E,U,L,k=1,G){let q=E.x-F.x,te=E.y-F.y,he=E.z-F.z,Ue=Math.hypot(q,te,he),Ne=Math.min(U+L-1e-5,Math.max(Math.abs(U-L)+1e-5,Ue)),et=Ue>1e-8?q/Ue:0,vt=Ue>1e-8?te/Ue:-1,Ke=Ue>1e-8?he/Ue:0,He=(U*U-L*L+Ne*Ne)/(2*Ne),nt=Math.sqrt(Math.max(0,U*U-He*He)),Bt=-vt,dt=et,dn=0;if(G){let Tn=G.x-F.x,Et=G.y-F.y,Oi=G.z-F.z,Un=Tn*et+Et*vt+Oi*Ke;Bt=Tn-et*Un,dt=Et-vt*Un,dn=Oi-Ke*Un,k=1}let bt=Math.hypot(Bt,dt,dn);return bt<1e-4&&(Bt=-vt,dt=et,dn=0,bt=Math.hypot(Bt,dt),bt<1e-4&&(Bt=1,dt=0,bt=1)),{elbow:{x:F.x+et*He+Bt/bt*nt*k,y:F.y+vt*He+dt/bt*nt*k,z:F.z+Ke*He+dn/bt*nt*k},hand:{x:F.x+et*Ne,y:F.y+vt*Ne,z:F.z+Ke*Ne}}}function p(F,E,U,{segments:L=48,closed:k=!1,axis:G=new D(0,1,0)}={}){let q=[],te=[],he=new D,Ue=new D,Ne=new D,et=new D;for(let Ke=0;Ke<=L;Ke++){let He=k&&Ke===L?0:Ke/L;F.getPoint(He,he),F.getTangent(He,Ue).normalize(),Ne.copy(G).addScaledVector(Ue,-G.dot(Ue)),Ne.lengthSq()<1e-8&&Ne.set(0,0,1).addScaledVector(Ue,-Ue.z),Ne.normalize(),et.crossVectors(Ue,Ne).normalize();for(let[nt,Bt]of[[-1,-1],[1,-1],[1,1],[-1,1]])q.push(he.x+Ne.x*nt*E/2+et.x*Bt*U/2,he.y+Ne.y*nt*E/2+et.y*Bt*U/2,he.z+Ne.z*nt*E/2+et.z*Bt*U/2);if(Ke<L)for(let nt=0;nt<4;nt++){let Bt=Ke*4+nt,dt=Ke*4+(nt+1)%4,dn=dt+4,bt=Bt+4;te.push(Bt,dt,bt,dt,dn,bt)}}k||te.push(0,2,1,0,3,2,L*4,L*4+1,L*4+2,L*4,L*4+2,L*4+3);let vt=new Rn;if(vt.setAttribute("position",new zt(q,3)),vt.setIndex(te),vt.computeVertexNormals(),k){let Ke=vt.attributes.normal;for(let He=0;He<4;He++)et.fromBufferAttribute(Ke,He).add(Ue.fromBufferAttribute(Ke,L*4+He)).normalize(),Ke.setXYZ(He,et.x,et.y,et.z),Ke.setXYZ(L*4+He,et.x,et.y,et.z)}return vt}function h(F){return Array.from({length:16},(E,U)=>{let L=U/16*Math.PI*2;return new D(Math.cos(L)*F*.046,F*.807,Math.sin(L)*F*.046)})}let f=(F=0,E=0,U=0)=>new D(F,E,U),v="#c62828";function M(F){let E=new wi,U=c(F),L=[],k=[],G=[],q=[],te=new Map,he={books:[],seats:[]},Ue=new ku(1,1,1,2,.065),Ne=new lo(1,24,18),et=new ma(1,1,1,16);L.push(Ue,Ne,et);let vt=new Map;function Ke(pe,_e=.65){let Ee=pe+_e;if(!vt.has(Ee)){let re=new ya({color:pe,roughness:_e});vt.set(Ee,re),k.push(re)}return vt.get(Ee)}function He(pe,_e,Ee=E){let re=new vn(pe,_e);return re.castShadow=!0,re.receiveShadow=!0,Ee.add(re),re}function nt(pe,_e,Ee,re){let Ge=He(Ue,Ke(re),pe);return Ge.position.copy(_e),Ge.scale.copy(Ee),Ge}function Bt(pe,_e,Ee,re){let Ge=He(Ne,Ke(re),pe);return Ge.position.copy(_e),Ge.scale.setScalar(Ee),Ge}function dt(pe,_e,Ee,re,Ge,Oe,Ye=!1){let w=Ee.clone().sub(_e),N=He(Ye?et:Ue,Ke(Oe),pe);return N.position.copy(_e).add(Ee).multiplyScalar(.5),N.scale.set(re,w.length(),Ge),N.quaternion.setFromUnitVectors(f(0,1,0),w.normalize()),N}function dn(pe,_e,Ee){let re=pe.height/100,Ge=new wi;E.add(Ge),Ge.position.set(_e.x,_e.y,_e.z),Ge.rotation.set(0,_e.yaw,_e.tilt);let Oe=pe.color,Ye=_e.mode==="sit"||_e.mode==="rider"||_e.mode==="cradle",w=Ye?re*.25:0,N=(ye,Be,qe=0)=>f(ye*re,Be*re-w,qe*re);nt(Ge,N(0,.645),f(.215*re,.27*re,.12*re),Oe),nt(Ge,N(0,.475),f(.19*re,.07*re,.12*re),Oe),dt(Ge,N(0,.795),N(0,.84),.036*re,.036*re,Oe,!0);let H=Bt(Ge,N(0,.915),re*.085,Oe),V=new wi;Ge.add(V),V.position.copy(H.position);let X=Ke("#24333a");for(let ye of[-.029,.029]){let Be=He(Ne,X,V);Be.position.set(ye*re,.004*re,.079*re),Be.scale.set(.009*re,.012*re,.008*re)}let ae=[],be=[],ve=[];for(let ye of[-1,1]){let Be=_e.legSpread??.054,qe=N(ye*.054,.44),Re=Ye?N(ye*Be,.425,.22):N(ye*.054,.235),st=Ye?N(ye*Be,.285,.235):N(ye*.054,.035);if(_e.mode==="cradle"&&(Re=N(ye*.054,.25,.11),st=N(ye*.054,.075,.12)),Ye){let yt=d(qe,st,.205*re,.2*re,ye,Re);Re=f(yt.elbow.x,yt.elbow.y,yt.elbow.z),st=f(yt.hand.x,yt.hand.y,yt.hand.z)}dt(Ge,qe,Re,.073*re,.078*re,Oe),dt(Ge,Re,st,.063*re,.07*re,Oe);let kt=nt(Ge,st.clone().add(f(0,-.017*re,.025*re)),f(.075*re,.035*re,.13*re),Oe);ae.push(kt),be.push(Re),ve.push(qe)}let Ae={group:Ge,head:H,headGroup:V,h:re,pose:_e,feet:ae,knees:be,hips:ve,person:pe,index:Ee,p:N,arms:[]};return G.push(Ae),Ae}dn(F.a,U.a,0),dn(F.b,U.b,1),E.updateMatrixWorld(!0);let bt=(pe,_e,Ee,re=0)=>pe.group.localToWorld(pe.p(_e,Ee,re)),Tn=(pe,_e,Ee,re)=>te.set(pe.index+":"+_e,{position:Ee,kind:re}),Et=U.max,Oi=U.gap,Un="#c3a177",us="#46545b";if(F.scene==="umbrella"){let pe=Et+.24,_e=Math.max(Oi*.85,Et*.32),Ee=0,re=.11*Et,Ge=new lo(_e,40,12,0,Math.PI*2,0,Math.PI*.47);L.push(Ge);let Oe=Ke(v);Oe.side=Jn;let Ye=He(Ge,Oe);Ye.position.set(Ee,pe-_e*.23,re),Ye.scale.y=.28,dt(E,f(Ee,Et*.35,re),f(Ee,pe,re),.013,.013,"#718087",!0);let w=G.find(V=>V.pose.mode==="umbrella");he.umbrella={poleX:Ee,poleZ:re,canopy:Ye,ribs:[]},Tn(w,w.index===0?1:-1,f(Ee,w.h*.68,re),"umbrella-grip");let N=new lr([f(0,Et*.35,re),f(.01,Et*.31,re),f(.055,Et*.31,re),f(.07,Et*.35,re)]),H=new va(N,20,.012,7,!1);L.push(H),He(H,Ke(us));for(let V=0;V<8;V++){let X=V/8*Math.PI*2;he.umbrella.ribs.push(dt(E,f(Ee,pe+.04,re),f(Math.cos(X)*_e*.96,pe-_e*.23+_e*.025,re+Math.sin(X)*_e*.96),.004,.004,"#8f1b1b",!0))}}if(F.scene==="cafe"){let pe=Et*.4,_e=Oi+Et*.48,Ee=Et*.26,re=Et*.24;he.table=nt(E,f(0,pe,Ee),f(_e,.06,re),Un);for(let Ge of[-_e*.43,_e*.43])for(let Oe of[-re*.4,re*.4])nt(E,f(Ge,pe/2,Ee+Oe),f(.035,pe,.035),us);for(let Ge of G){let{h:Oe}=Ge,Ye=Ge.group.position,w=Ye.y+Oe*.19-.0275;he.seats.push(nt(E,f(Ye.x,w,Ye.z-.025),f(Oe*.26,.055,Oe*.26),Un)),nt(E,f(Ye.x,Ye.y+Oe*.37,Ye.z-Oe*.15),f(Oe*.26,Oe*.4,.04),Un);for(let V of[-1,1])for(let X of[-.09,.09])nt(E,f(Ye.x+V*Oe*.1,w/2,Ye.z+X*Oe),f(.027,w,.027),us);Ye.y>.015&&dt(E,f(Ye.x-Oe*.11,Ye.y+Oe*.01,Ye.z+Oe*.23),f(Ye.x+Oe*.11,Ye.y+Oe*.01,Ye.z+Oe*.23),.018,.035,us);for(let V of[-1,1])Tn(Ge,V,f(Ye.x+V*Oe*.12,pe+.03+Oe*.032,Ee-re*.5+Oe*.06),"table-rest");let N=He(et,Ke("#f7f2e9"));N.scale.set(.055,.075,.055),N.position.set(Ye.x,pe+.068,Ee+.01);let H=He(et,Ke("#76513d"));H.scale.set(.047,.004,.047),H.position.set(Ye.x,pe+.107,Ee+.01)}}if(F.scene==="shelf"){let pe=Oi+Et*.55,_e=Et*1.08,Ee=-.3*Et;nt(E,f(0,_e/2,Ee-.08),f(pe,_e,.055),"#b69872");for(let re of[-pe/2,pe/2])nt(E,f(re,_e/2,Ee+.03),f(.055,_e,.23),Un);for(let re=0;re<5;re++){let Ge=.1+re*(_e-.1)/4;if(nt(E,f(0,Ge,Ee+.03),f(pe,.045,.25),Un),re<4)for(let Oe=0;Oe<9;Oe++){let Ye=_e/5*(.65+Oe%3*.1),w=pe*.055;he.books.push(nt(E,f(-pe*.42+Oe*pe*.1,Ge+Ye/2+.03,Ee+.035),f(w,Ye,.14),["#93a9a5","#bfb08d","#718c9a","#bd8c85"][Oe%4]))}}E.updateMatrixWorld(!0);for(let re of G){let Ge=re.index===0?1:-1,Oe=bt(re,Ge*.139,.91,.1),Ye,w=1/0;for(let N of he.books){let H=new Ei().setFromObject(N),V=f(Bn.clamp(Oe.x,H.min.x,H.max.x),Bn.clamp(Oe.y,H.min.y,H.max.y),Ee+.105),X=V.distanceTo(Oe);X<w&&(w=X,Ye=V)}Tn(re,Ge,Ye,"book-reach")}}if(F.scene==="scarf"){let pe=Math.min(U.hA,U.hB)*.048,_e=pe*.14,Ee=Ke(v,.88);Ee.side=Jn,he.scarf={wraps:[],tails:[],width:pe};let re=(ae,be,ve={})=>{let Ae=p(ae,pe,_e,ve);return L.push(Ae),He(Ae,Ee,be)};for(let ae of G){let be=new lr(h(ae.h),!0,"centripetal"),ve=re(be,ae.group,{closed:!0,segments:64});he.scarf.wraps.push(ve);let ye=(ae.index===0?-1:1)*ae.h*.0325,Be=Math.min(U.hA,U.hB)*.26,qe=new lr([f(ye,ae.h*.807,ae.h*.0325),f(ye,ae.h*.765,ae.h*.078),f(ye*1.25,ae.h*.807-Be*.65,ae.h*.078),f(ye*1.35,ae.h*.807-Be,ae.h*.079)]);he.scarf.tails.push(re(qe,ae.group,{axis:f(1,0,0)}));let Re=qe.getPoint(1);for(let st=0;st<6;st++)dt(ae.group,Re.clone().add(f((st-2.5)*pe/6,0,0)),Re.clone().add(f((st-2.5)*pe/6,-pe*.27,0)),pe*.08,_e,v)}let Ge=bt(G[0],.0325,.807,.0325),Oe=bt(G[1],-.0325,.807,.0325),Ye=Math.min(U.hA,U.hB)*.065,w=Et*.09,N=Ge.clone().add(f(0,-Ye*.15,w-Ge.z)),H=Oe.clone().add(f(0,-Ye*.15,w-Oe.z)),V=N.clone().lerp(H,.5).add(f(0,-Ye,0)),X=new lr([Ge,N,V,H,Oe]);he.scarf.bridge=re(X,E)}if(F.scene==="hug")for(let pe of G){let _e=G[1-pe.index];for(let Ee of[-1,1]){let re=bt(pe,Ee*.139,.755),Ge=bt(_e,-Ee*.105,.66,-.075);Ge.y=Bn.clamp(re.y-pe.h*.08,_e.h*.51,_e.h*.74),Tn(pe,Ee,Ge,"hug-back")}}if(F.scene==="piggyback"){let pe=G.find(Ee=>Ee.pose.mode==="carrier"),_e=G.find(Ee=>Ee.pose.mode==="rider");for(let Ee of[-1,1]){let re=_e.group.localToWorld(_e.knees[Ee===-1?0:1].clone());Tn(pe,Ee,re.add(f(0,-_e.h*.04,0)),"rider-knee-support"),Tn(_e,Ee,bt(pe,Ee*.09,.77,.055),"carrier-shoulder")}}if(F.scene==="carry"){let pe=G.find(re=>re.pose.mode==="carry"),_e=G.find(re=>re.pose.mode==="cradle"),Ee=_e.hips[0].clone().lerp(_e.knees[0],.6);Tn(pe,-1,_e.group.localToWorld(Ee).add(f(0,-_e.h*.035,0)),"cradle-thighs"),Tn(pe,1,bt(_e,0,.68,-.08),"cradle-back");for(let re of[-1,1])Tn(_e,re,bt(pe,re*.1,.7,.1),"carrier-chest")}for(let pe of G)for(let _e of[-1,1]){let{h:Ee,p:re}=pe,Ge=re(_e*.139,.755),Oe=te.get(pe.index+":"+_e),Ye=re(_e*.15,.435,.012),w=re(_e*.19,.6,.04);Oe&&(Ye=pe.group.worldToLocal(Oe.position.clone()),w=F.scene==="cafe"?re(_e*.16,.6,.1):re(_e*.22,["reach"].includes(pe.pose.mode)?.86:.6,.13));let N=d(Ge,Ye,.16*Ee,.16*Ee,_e,w),H=f(N.elbow.x,N.elbow.y,N.elbow.z);Ye=f(N.hand.x,N.hand.y,N.hand.z),dt(pe.group,Ge,H,.055*Ee,.065*Ee,pe.person.color),dt(pe.group,H,Ye,.05*Ee,.058*Ee,pe.person.color),Bt(pe.group,H,.032*Ee,pe.person.color);let V=Bt(pe.group,Ye,.032*Ee,pe.person.color);pe.arms.push({sign:_e,shoulder:Ge,elbow:H,hand:Ye,mesh:V}),Oe&&q.push({actor:pe.index,sign:_e,kind:Oe.kind,target:Oe.position.clone(),hand:V})}if(F.scene==="together"){let pe=-Oi*.5-Et*.28,_e=-.12;dt(E,f(pe,0,_e),f(pe,Et+.1,_e),.005,.005,"#b9c7ce",!0);for(let Ee=0;Ee<=Et+.05;Ee+=.1)dt(E,f(pe,Ee,_e),f(pe+(Math.round(Ee*10)%5===0?.075:.035),Ee,_e),.004,.004,"#a6b8c2",!0)}E.updateMatrixWorld(!0);let Il=new Ei().setFromObject(E);return{group:E,actors:G,layout:U,bounds:Il,contacts:q,props:he,dispose(){for(let pe of L)pe.dispose();for(let pe of k)pe.dispose()}}}let g=F=>document.querySelector(F),u=g("#game"),m=g("#stage"),x=g("#people-dialog"),S=n(),C="free",b,R,_,T,I,P,B,j,$=0,z=0,Y=0,Z=!1,ne=!1,ce=!1,ue=null,Ie=5,De,Ze,mt=!1,je=matchMedia("(prefers-reduced-motion: reduce)"),oe=!(new URLSearchParams(location.search).has("review")||new URLSearchParams(location.search).get("feedReview")==="1");u.dataset.feedPreview=String(!oe),u.dataset.started="false";let se=new Map,Fe=0,Ve=0,ze=new ln,Ct=new D,tt=new Map;function ht(F){g("#status").textContent=F}function gt(){if(!(!oe||document.hidden))try{let F=window.AudioContext||window.webkitAudioContext;if(!F)return;Ze??(Ze=new F),Ze.state==="suspended"&&Ze.resume().catch(()=>{});let E=Ze.createOscillator(),U=Ze.createGain(),L=Ze.currentTime;E.type="sine",E.frequency.setValueAtTime(620,L),E.frequency.exponentialRampToValueAtTime(420,L+.07),U.gain.setValueAtTime(.018,L),U.gain.exponentialRampToValueAtTime(1e-4,L+.08),E.connect(U),U.connect(Ze.destination),E.start(L),E.stop(L+.09),E.onended=()=>{E.disconnect(),U.disconnect()}}catch{}}function Xe(){oe&&(ce=!0,u.dataset.started="true")}function Yt(){g("#difference").replaceChildren(document.createTextNode(`${s(o(S))} `));let F=document.createElement("small");F.textContent="cm di differenza",g("#difference").append(F),g("#difference").setAttribute("aria-label","Differenza di altezza: "+s(o(S))+" cm");for(let E of["a","b"]){let U=g("#label-"+E),L=document.createTextNode(S[E].name),k=document.createElement("small");k.textContent=s(S[E].height)+" cm",U.replaceChildren(L,k),U.style.borderBottomColor=S[E].color}u.dataset.scene=S.scene,u.dataset.view=C,u.dataset.heightA=S.a.height,u.dataset.heightB=S.b.height,m.setAttribute("aria-label",`${t.find(E=>E.id===S.scene).name}. A: ${S.a.name}, ${s(S.a.height)} cm. B: ${S.b.name}, ${s(S.b.height)} cm.`)}function Mt(){I&&(R.remove(I.group),I.dispose()),I=M(S),R.add(I.group);let F=I.layout.max;B.scale.setScalar(Math.max(8,F*5)),P.shadow.camera.left=P.shadow.camera.bottom=-F*2,P.shadow.camera.right=P.shadow.camera.top=F*2,P.shadow.camera.far=F*12,P.shadow.camera.updateProjectionMatrix(),P.position.set(-F*2,F*4,F*3),P.target.position.set(0,F*.4,0),Yt(),O(C,{animate:!1})}function En(){let F=I.bounds.getSize(new D),E=I.bounds.getCenter(new D);E.y=Math.max(E.y,.6);let U=Bn.degToRad(35),L=Math.max(F.y*1.42/(2*Math.tan(U/2)),(F.x+.45)*1.2/(2*Math.tan(U/2)*_.aspect))+F.z*.5;return Ie=L,{target:E,position:E.clone().add(new D(.28,.12,1).normalize().multiplyScalar(L))}}function O(F,{animate:E=!0}={}){if(!_||!I)return;C=F,se.clear(),Fe=Ve=0;for(let q of I.actors)q.head.visible=!0,q.headGroup.visible=!0;let U=_.position.clone(),L=T.target.clone(),k,G;if(_.fov=35,C==="free"){let q=En();k=q.position,G=q.target,T.minDistance=Ie*.5,T.maxDistance=Ie*2,T.enabled=oe}else{_.fov=68;let q=C==="a"?0:1,te=I.actors[q],he=I.actors[1-q];I.group.updateMatrixWorld(!0),k=te.head.getWorldPosition(new D),k.z+=te.h*.025,G=he.head.getWorldPosition(new D),te.head.visible=!1,te.headGroup.visible=!1,T.enabled=!1,Ct.copy(k);let Ue=new Dt().lookAt(k,G,new D(0,1,0));ze.setFromRotationMatrix(Ue)}_.updateProjectionMatrix(),ue=E&&!je.matches?{from:U,fromTarget:L,to:k,target:G,start:performance.now()}:null,ue||(_.position.copy(k),T.target.copy(G),_.lookAt(G)),T.saveState();for(let q of document.querySelectorAll("button[data-view]"))q.setAttribute("aria-pressed",String(q.dataset.view===C));u.dataset.view=C,ut(),_t()}function Ft(){if(!b||Z)return;let{width:F,height:E}=m.getBoundingClientRect();!F||!E||(b.setPixelRatio(Math.min(devicePixelRatio||1,1.5)),b.setSize(F,E,!1),_.aspect=F/E,_.updateProjectionMatrix(),I&&O(C,{animate:!1}))}function ot(){if(!I)return;let F=m.clientWidth,E=m.clientHeight;I.group.updateMatrixWorld(!0);let U=[];for(let L=0;L<2;L++){let k=I.actors[L],G=g("#label-"+(L?"b":"a")),q=g("#leader-"+(L?"b":"a"));if(q.style.display="none",C===(L?"b":"a")){G.hidden=!0;continue}let te=k.head.getWorldPosition(new D);te.y+=k.h*.13,te.project(_),G.hidden=te.z<-1||te.z>1||te.x<-1.2||te.x>1.2||te.y<-1.1||te.y>1.15;let he=Math.min(G.offsetWidth/2,F*.21),Ue=Math.max(he+3,Math.min(F-he-3,(te.x*.5+.5)*F)),Ne=Math.max(G.offsetHeight+3,Math.min(E-35,(-te.y*.5+.5)*E));U.push({el:G,x:Ue,y:Ne,line:q,anchorX:(te.x*.5+.5)*F,anchorY:(-te.y*.5+.5)*E+8,color:k.person.color})}U.length===2&&Math.abs(U[0].x-U[1].x)<(U[0].el.offsetWidth+U[1].el.offsetWidth)/2+12&&Math.abs(U[0].y-U[1].y)<52&&(U[0].x=F*.24,U[1].x=F*.76);for(let L of U)if(L.el.style.left=L.x+"px",L.el.style.top=L.y+"px",!L.el.hidden){L.line.style.display="",L.line.setAttribute("stroke",L.color);for(let[k,G]of Object.entries({x1:L.x,y1:L.y+2,x2:L.anchorX,y2:L.anchorY}))L.line.setAttribute(k,String(G))}}function ut(){b&&!ne&&!Z&&(b.render(R,_),ot(),m.dataset.camera=[..._.position.toArray(),..._.quaternion.toArray()].map(F=>F.toFixed(4)).join(","))}function xe(F){if($=0,Z||ne||document.hidden)return;mt=!0;let E=z?Math.min((F-z)/1e3,.05):0;z=F,Y+=E;let U=!1;if(ue){let k=Math.min(1,(F-ue.start)/360),G=k*k*(3-2*k);_.position.lerpVectors(ue.from,ue.to,G),T.target.lerpVectors(ue.fromTarget,ue.target,G),_.lookAt(T.target),k===1&&(ue=null)}else C==="free"&&(U=T.update());let L=I&&!ce&&!je.matches&&Y<8;I&&(I.group.rotation.y=L?Math.sin(Y*1.5)*.012:0),ut(),mt=!1,(L||ue||U)&&($=requestAnimationFrame(xe))}function _t(){!$&&!mt&&!Z&&!ne&&!document.hidden&&(z=0,$=requestAnimationFrame(xe))}function A(){cancelAnimationFrame($),$=0,z=0;for(let F of se.keys())m.hasPointerCapture(F)&&m.releasePointerCapture(F);se.clear();for(let F of tt.keys())b!=null&&b.domElement.hasPointerCapture(F)&&b.domElement.releasePointerCapture(F);tt.clear(),T==null||T.disconnect(),T&&b&&!Z&&(T.connect(b.domElement),T.enabled=oe&&C==="free"&&!document.hidden),Ze==null||Ze.suspend().catch(()=>{})}function y(){Z||document.hidden||ne||(T.enabled=oe&&C==="free",_t())}function W(F){if(oe){if(Xe(),ue=null,C==="free"){let E=_.position.clone().sub(T.target),U=Bn.clamp(E.length()*Math.exp(F*.14),T.minDistance,T.maxDistance);_.position.copy(T.target).add(E.setLength(U)),T.update()}else _.fov=Bn.clamp(_.fov+F*5,25,85),_.updateProjectionMatrix();ut(),_t()}}function J(F){!oe||C==="free"||F.button!==0||F.target.closest("button")||(F.preventDefault(),ue=null,se.set(F.pointerId,{x:F.clientX,y:F.clientY}),m.setPointerCapture(F.pointerId))}function ie(F){let E=se.get(F.pointerId);if(!E||C==="free")return;let U=F.clientX-E.x,L=F.clientY-E.y;if(Math.hypot(U,L)<1)return;Xe();let k=[...se.values()];if(se.set(F.pointerId,{x:F.clientX,y:F.clientY}),se.size===1)Fe-=U*.006,Ve=Bn.clamp(Ve-L*.006,-.65,.65),_.position.copy(Ct),_.quaternion.copy(ze).multiply(new ln().setFromEuler(new li(Ve,Fe,0,"YXZ")));else if(se.size===2){let G=[...se.values()],q=Math.hypot(k[0].x-k[1].x,k[0].y-k[1].y),te=Math.hypot(G[0].x-G[1].x,G[0].y-G[1].y);te>4&&q>4&&(_.fov=Bn.clamp(_.fov*q/te,25,85),_.updateProjectionMatrix())}ut()}function fe(F){se.delete(F.pointerId),m.hasPointerCapture(F.pointerId)&&m.releasePointerCapture(F.pointerId)}function ge(){if(oe){for(let F of["a","b"])g("#"+F+"-name").value=S[F].name,g("#"+F+"-height").value=S[F].height,g("#"+F+"-error").textContent="",g("#"+F+"-height").removeAttribute("aria-invalid");A(),x.showModal()}}function K(){x.close(),g("#edit").focus({preventScroll:!0}),y()}function Q(F){var L;F.preventDefault();let E=l(Object.fromEntries(new FormData(F.currentTarget)),S),U;for(let k of["a","b"]){let G=((L=E.errors)==null?void 0:L[k+"Height"])||"";g("#"+k+"-error").textContent=G,g("#"+k+"-height").setAttribute("aria-invalid",String(!!G)),G&&!U&&(U=g("#"+k+"-height"))}if(U){U.focus();return}S=E.state,Xe(),Mt(),K(),gt(),ht("Altezze aggiornate. "+s(o(S))+" centimetri di differenza.")}async function Me(){if(!oe||ne)return;let F=g("#photo");F.disabled=!0,Xe();try{await document.fonts.ready,ut();let E=document.createElement("canvas"),U=900,L=1200;E.width=U,E.height=L;let k=E.getContext("2d");k.fillStyle="#edf2f4",k.fillRect(0,0,U,L);let G=b.domElement,q=Math.min(820/G.width,930/G.height),te=G.width*q,he=G.height*q;k.drawImage(G,(U-te)/2,140+(930-he)/2,te,he),k.textAlign="center",k.fillStyle="#243640",k.font="700 38px DM",k.fillText(`${s(o(S))} cm di differenza`,U/2,80),k.font="600 24px DM",k.fillText(`${S.a.name} \xB7 ${s(S.a.height)} cm`,U/2,1110,800),k.fillText(`${S.b.name} \xB7 ${s(S.b.height)} cm`,U/2,1152,800);let Ue=await SC(E.toDataURL("image/png"),"height-together");ht(Ue?"Foto salvata.":"Anteprima foto."),gt()}catch{ht("Impossibile salvare la foto. Riprova.")}finally{F.disabled=!1}}function Te(F){var E;F.source!==parent||F.origin!==location.origin||((E=F.data)==null?void 0:E.type)!=="playable-active"||(oe=F.data.active===!0,u.dataset.feedPreview=String(!oe),oe?y():(x.close(),A()),Ft())}function me(){Z||(A(),Z=!0,j==null||j.disconnect(),T==null||T.dispose(),I==null||I.dispose(),B==null||B.geometry.dispose(),B==null||B.material.dispose(),b==null||b.dispose(),Ze==null||Ze.close().catch(()=>{}),De&&URL.revokeObjectURL(De),document.removeEventListener("visibilitychange",de),window.removeEventListener("message",Te),window.removeEventListener("blur",A),window.removeEventListener("focus",y),je.removeEventListener("change",$e))}function de(){document.hidden?A():y()}function $e(){cancelAnimationFrame($),$=0,ut(),_t()}async function Je(){var F,E;try{let U;try{U=await(await _C()).json()}catch{U=lg}g("#guide").textContent=((E=(F=U.texts)==null?void 0:F.find(k=>k.id==="HINT_TEXT"))==null?void 0:E.value)||"Ruota trascinando, zoom con due dita",b=new Nu({antialias:!0,alpha:!0,powerPreference:"low-power",preserveDrawingBuffer:!0}),b.setClearColor(0,0),b.outputColorSpace=Cn,b.toneMapping=Ta,b.toneMappingExposure=1.2,b.shadowMap.enabled=!0,b.shadowMap.type=xs,b.domElement.setAttribute("aria-hidden","true"),m.prepend(b.domElement),R=new ca,_=new gn(35,1,.01,150),R.add(new wa("#ffffff","#91a0aa",2.5)),P=new uo("#fff4e6",3),P.castShadow=!0,P.shadow.mapSize.set(1024,1024),P.shadow.bias=-3e-4,P.shadow.normalBias=.015,R.add(P,P.target);let L=new uo("#e5f2ff",1.2);L.position.set(3,2,-3),R.add(L),B=new vn(new vs(1,1),new xa({color:"#49616d",opacity:.17})),B.rotation.x=-Math.PI/2,B.position.y=-.008,B.receiveShadow=!0,R.add(B),T=new Bu(_,b.domElement),T.enableDamping=!0,T.dampingFactor=.1,T.enablePan=!1,T.minPolarAngle=.35,T.maxPolarAngle=Math.PI*.55,T.rotateSpeed=.65,T.zoomSpeed=.7,T.addEventListener("start",()=>{oe&&(ue=null,_t())}),T.addEventListener("change",()=>{ut(),_t()}),b.domElement.addEventListener("pointerdown",k=>{oe&&C==="free"&&tt.set(k.pointerId,{x:k.clientX,y:k.clientY})}),b.domElement.addEventListener("pointermove",k=>{let G=tt.get(k.pointerId);G&&Math.hypot(k.clientX-G.x,k.clientY-G.y)>3&&Xe()});for(let k of["pointerup","pointercancel","lostpointercapture"])b.domElement.addEventListener(k,G=>tt.delete(G.pointerId));b.domElement.addEventListener("wheel",()=>{oe&&Xe()},{passive:!0}),Mt(),j=mC(Ft),j.observe(m),Ft(),m.dataset.ready="true",m.addEventListener("pointerdown",J),m.addEventListener("pointermove",ie);for(let k of["pointerup","pointercancel","lostpointercapture"])m.addEventListener(k,fe);m.addEventListener("keydown",k=>{if(!(!oe||k.altKey||k.ctrlKey||k.metaKey)){if(["+","=","-","_"].includes(k.key)){k.preventDefault(),W(["-","_"].includes(k.key)?1:-1);return}if(k.key.startsWith("Arrow")){if(k.preventDefault(),Xe(),ue=null,C==="free"){let G=_.position.clone().sub(T.target),q=new Ur().setFromVector3(G);k.key==="ArrowLeft"&&(q.theta-=.12),k.key==="ArrowRight"&&(q.theta+=.12),k.key==="ArrowUp"&&(q.phi=Math.max(.35,q.phi-.1)),k.key==="ArrowDown"&&(q.phi=Math.min(Math.PI*.55,q.phi+.1)),_.position.copy(T.target).add(new D().setFromSpherical(q)),_.lookAt(T.target)}else Fe+=k.key==="ArrowLeft"?.1:k.key==="ArrowRight"?-.1:0,Ve=Bn.clamp(Ve+(k.key==="ArrowUp"?.1:k.key==="ArrowDown"?-.1:0),-.65,.65),_.quaternion.copy(ze).multiply(new ln().setFromEuler(new li(Ve,Fe,0,"YXZ")));ut(),_t()}}});for(let k of document.querySelectorAll("button[data-view]"))k.addEventListener("click",()=>{oe&&(Xe(),O(k.dataset.view),gt())});g("#scene").addEventListener("change",k=>{!oe||!t.some(G=>G.id===k.target.value)||(S.scene=k.target.value,Xe(),Mt(),gt(),ht("Scena selezionata: "+k.target.selectedOptions[0].textContent+"."))}),g("#edit").addEventListener("click",ge),g("#close").addEventListener("click",K),x.addEventListener("close",y),x.addEventListener("click",k=>{if(k.target===x){let G=x.getBoundingClientRect();(k.clientX<G.left||k.clientX>G.right||k.clientY<G.top||k.clientY>G.bottom)&&K()}}),g("#people-form").addEventListener("submit",Q),g("#apply").addEventListener("click",k=>{k.preventDefault(),Q({preventDefault(){},currentTarget:g("#people-form")})}),g("#swap").addEventListener("click",()=>{oe&&(S=a(S),Xe(),Mt(),gt(),ht("Persone scambiate."))}),g("#photo").addEventListener("click",Me),b.domElement.addEventListener("webglcontextlost",k=>{k.preventDefault(),ne=!0,A(),g("#error").hidden=!1}),b.domElement.addEventListener("webglcontextrestored",()=>{ne=!1,g("#error").hidden=!0,Ft(),y()}),document.addEventListener("visibilitychange",de),window.addEventListener("message",Te),window.addEventListener("blur",A),window.addEventListener("focus",y),window.addEventListener("pagehide",me,{once:!0}),je.addEventListener("change",$e),_t()}catch(U){console.warn("Height comparison could not start",U),g("#error").hidden=!1}}g("#retry").addEventListener("click",()=>{g("#error").hidden=!0,Z=!1,Je()}),Je(),(()=>{var vt;let F=["#game p#guide"],E=new Set(["Ruota trascinando, zoom con due dita"].map(Ke=>Ke.replace(/\s+/g," ").trim().toLowerCase())),U=window.matchMedia("(prefers-reduced-motion: reduce)"),L=new Map,k=!1,G=!0,q=/^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;function te(){k=!1;for(let[He,nt]of L)He.isConnected||(nt.cancel(),L.delete(He));if(U.matches){for(let He of L.values())He.cancel();L.clear();return}let Ke=new Set;for(let He of F)try{document.querySelectorAll(He).forEach(nt=>Ke.add(nt))}catch{}for(let He of document.querySelectorAll("p,span,div,label,text")){if(He.children.length||He.closest('button,a,input,select,textarea,[role="button"]'))continue;let nt=(He.textContent||"").replace(/\s+/g," ").trim();nt.length>=5&&nt.length<=140&&(E.has(nt.toLowerCase())||!F.length&&q.test(nt))&&Ke.add(He)}for(let He of Ke){if(L.has(He)||typeof He.animate!="function"||[...Ke].some(bt=>bt!==He&&He.contains(bt)))continue;let nt=getComputedStyle(He);if(/breath/i.test(nt.animationName))continue;let Bt=nt.filter.replace(/opacity\([^)]*\)/g,"").replace(/^none$/,"").trim(),dt=bt=>(Bt?Bt+" ":"")+"opacity("+bt+")",dn=He.animate([{filter:dt(1)},{filter:dt(.65)},{filter:dt(1)}],{duration:2400,iterations:1/0,easing:"ease-in-out"});L.set(He,dn),(document.hidden||!G)&&dn.pause()}}let he=()=>{k||(k=!0,requestAnimationFrame(te))},Ue=()=>{for(let Ke of L.values())document.hidden||!G?Ke.pause():Ke.play()},Ne=new MutationObserver(he);Ne.observe(document.documentElement,{childList:!0,subtree:!0,characterData:!0});let et=typeof IntersectionObserver=="function"?new IntersectionObserver(Ke=>{G=Ke.some(He=>He.isIntersecting),Ue()}):null;document.body?et==null||et.observe(document.body):document.addEventListener("DOMContentLoaded",()=>et==null?void 0:et.observe(document.body),{once:!0}),document.addEventListener("visibilitychange",Ue),(vt=U.addEventListener)==null||vt.call(U,"change",he),he(),window.addEventListener("pagehide",()=>{Ne.disconnect(),et==null||et.disconnect();for(let Ke of L.values())Ke.cancel();L.clear()},{once:!0})})()}function yC(){return Uy.useEffect(()=>{xC()},[]),(0,we.jsx)(we.Fragment,{children:(0,we.jsxs)("main",{id:"game","aria-label":"Simulatore di altezze",children:[(0,we.jsxs)("header",{id:"top",children:[(0,we.jsxs)("output",{id:"difference","aria-label":"Differenza di altezza",children:["18 ",(0,we.jsx)("small",{children:"cm di differenza"})]}),(0,we.jsxs)("nav",{id:"views","aria-label":"Punto di vista",children:[(0,we.jsx)("button",{"data-view":"free","aria-pressed":"true",children:"Vista libera"}),(0,we.jsx)("button",{"data-view":"a","aria-pressed":"false",children:"Vista A"}),(0,we.jsx)("button",{"data-view":"b","aria-pressed":"false",children:"Vista B"})]})]}),(0,we.jsxs)("section",{id:"stage",tabIndex:"0","aria-label":"Confronto delle altezze in 3D","aria-describedby":"keyboard-help",children:[(0,we.jsxs)("div",{id:"labels","aria-hidden":"true",children:[(0,we.jsxs)("svg",{id:"leaders",children:[(0,we.jsx)("line",{id:"leader-a"}),(0,we.jsx)("line",{id:"leader-b"})]}),(0,we.jsx)("span",{id:"label-a",className:"person-label"}),(0,we.jsx)("span",{id:"label-b",className:"person-label"})]}),(0,we.jsx)("p",{id:"guide",children:"Ruota trascinando, zoom con due dita"})]}),(0,we.jsxs)("footer",{id:"toolbar",children:[(0,we.jsxs)("label",{className:"scene-picker",children:[(0,we.jsx)("span",{className:"sr-only",children:"Scena condivisa"}),(0,we.jsxs)("select",{id:"scene",children:[(0,we.jsx)("option",{value:"together",children:"Fianco a fianco"}),(0,we.jsx)("option",{value:"umbrella",children:"Sotto l\u2019ombrello"}),(0,we.jsx)("option",{value:"cafe",children:"Un caff\xE8 insieme"}),(0,we.jsx)("option",{value:"shelf",children:"Raggiungi il ripiano"}),(0,we.jsx)("option",{value:"hug",children:"Un abbraccio"}),(0,we.jsx)("option",{value:"scarf",children:"Una sciarpa per due"}),(0,we.jsx)("option",{value:"piggyback",children:"Sulle spalle"}),(0,we.jsx)("option",{value:"carry",children:"In braccio"})]})]}),(0,we.jsxs)("div",{className:"actions",children:[(0,we.jsxs)("button",{id:"edit",children:[(0,we.jsxs)("svg",{viewBox:"0 0 24 24","aria-hidden":"true",children:[(0,we.jsx)("circle",{cx:"8",cy:"7",r:"3"}),(0,we.jsx)("path",{d:"M2 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 5 5v2"})]}),"Persone"]}),(0,we.jsxs)("button",{id:"swap",children:[(0,we.jsx)("svg",{viewBox:"0 0 24 24","aria-hidden":"true",children:(0,we.jsx)("path",{d:"M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"})}),"Scambia"]}),(0,we.jsxs)("button",{id:"photo",children:[(0,we.jsxs)("svg",{viewBox:"0 0 24 24","aria-hidden":"true",children:[(0,we.jsx)("path",{d:"M3 6h4l2-3h6l2 3h4v15H3z"}),(0,we.jsx)("circle",{cx:"12",cy:"13",r:"4"})]}),"Foto"]})]})]}),(0,we.jsx)("p",{id:"status",className:"sr-only",role:"status","aria-live":"polite"}),(0,we.jsx)("p",{id:"keyboard-help",className:"sr-only",children:"Trascina o usa le frecce per ruotare. Per lo zoom, usa due dita oppure i tasti + e \u2212. Cambia prospettiva con Vista libera, Vista A o Vista B."}),(0,we.jsxs)("div",{id:"error",hidden:!0,role:"alert",children:[(0,we.jsx)("p",{children:"Impossibile avviare il 3D. Ricarica per riprovare."}),(0,we.jsx)("button",{id:"retry",children:"Riprova"})]}),(0,we.jsx)("dialog",{id:"people-dialog","aria-labelledby":"people-title",children:(0,we.jsxs)("form",{id:"people-form",novalidate:"",children:[(0,we.jsxs)("div",{className:"dialog-heading",children:[(0,we.jsx)("h2",{id:"people-title",children:"Le vostre altezze"}),(0,we.jsx)("button",{type:"button",id:"close","aria-label":"Annulla le modifiche",children:"\xD7"})]}),(0,we.jsxs)("fieldset",{children:[(0,we.jsx)("legend",{children:"Persona A"}),(0,we.jsxs)("label",{children:["Nome",(0,we.jsx)("input",{id:"a-name",name:"aName",maxLength:"20",autoComplete:"off"})]}),(0,we.jsxs)("label",{children:["Altezza ",(0,we.jsx)("span",{children:"cm"}),(0,we.jsx)("input",{id:"a-height",name:"aHeight",type:"number",inputMode:"decimal",min:"50",max:"500",step:"0.1",required:!0,"aria-describedby":"a-error"})]}),(0,we.jsx)("p",{className:"field-error",id:"a-error"})]}),(0,we.jsxs)("fieldset",{children:[(0,we.jsx)("legend",{children:"Persona B"}),(0,we.jsxs)("label",{children:["Nome",(0,we.jsx)("input",{id:"b-name",name:"bName",maxLength:"20",autoComplete:"off"})]}),(0,we.jsxs)("label",{children:["Altezza ",(0,we.jsx)("span",{children:"cm"}),(0,we.jsx)("input",{id:"b-height",name:"bHeight",type:"number",inputMode:"decimal",min:"50",max:"500",step:"0.1",required:!0,"aria-describedby":"b-error"})]}),(0,we.jsx)("p",{className:"field-error",id:"b-error"})]}),(0,we.jsx)("button",{id:"apply",type:"submit",children:"Confronta le altezze"}),(0,we.jsx)("p",{className:"privacy",children:"Resta su questo dispositivo."})]})})]})})}Fy.createRoot(document.getElementById("root")).render((0,we.jsx)(yC,{}));function SC(t,e,n="png"){return new Promise(i=>{if(window.tt&&typeof window.tt.saveDataURL=="function"){window.tt.saveDataURL({dataURL:t,filename:e,extension:n,saveToAlbum:"image",success(){i(!0)},fail(l){console.warn("Image save failed",l),i(!1)},complete(){}});return}let r=document.createElement("dialog");r.style.cssText="padding:16px;border:0;border-radius:18px;background:#fff;color:#222;max-width:90vw;max-height:90vh";let s=document.createElement("img");s.src=t,s.alt="Immagine creata",s.style.cssText="display:block;max-width:76vw;max-height:65vh;object-fit:contain";let o=document.createElement("p");o.textContent="Tieni premuta l\u2019immagine per salvarla.";let a=document.createElement("button");a.textContent="Chiudi",a.style.cssText="min-height:44px;padding:8px 20px",a.onclick=()=>{r.close(),r.remove(),i(!1)},r.append(s,o,a),document.body.append(r),r.showModal()})}})();
