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
(()=>{var Ey=Object.create;var ng=Object.defineProperty;var Ty=Object.getOwnPropertyDescriptor;var by=Object.getOwnPropertyNames;var Ay=Object.getPrototypeOf,Cy=Object.prototype.hasOwnProperty;var Oi=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var Ry=(t,e,n,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of by(e))!Cy.call(t,r)&&r!==n&&ng(t,r,{get:()=>e[r],enumerable:!(i=Ty(e,r))||i.enumerable});return t};var wl=(t,e,n)=>(n=t!=null?Ey(Ay(t)):{},Ry(e||!t||!t.__esModule?ng(n,"default",{value:t,enumerable:!0}):n,t));var pg=Oi(Je=>{"use strict";var Do=Symbol.for("react.element"),Py=Symbol.for("react.portal"),Iy=Symbol.for("react.fragment"),Ly=Symbol.for("react.strict_mode"),Ny=Symbol.for("react.profiler"),Dy=Symbol.for("react.provider"),Uy=Symbol.for("react.context"),Fy=Symbol.for("react.forward_ref"),Oy=Symbol.for("react.suspense"),By=Symbol.for("react.memo"),ky=Symbol.for("react.lazy"),ig=Symbol.iterator;function zy(t){return t===null||typeof t!="object"?null:(t=ig&&t[ig]||t["@@iterator"],typeof t=="function"?t:null)}var og={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},ag=Object.assign,lg={};function bs(t,e,n){this.props=t,this.context=e,this.refs=lg,this.updater=n||og}bs.prototype.isReactComponent={};bs.prototype.setState=function(t,e){if(typeof t!="object"&&typeof t!="function"&&t!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,t,e,"setState")};bs.prototype.forceUpdate=function(t){this.updater.enqueueForceUpdate(this,t,"forceUpdate")};function cg(){}cg.prototype=bs.prototype;function id(t,e,n){this.props=t,this.context=e,this.refs=lg,this.updater=n||og}var rd=id.prototype=new cg;rd.constructor=id;ag(rd,bs.prototype);rd.isPureReactComponent=!0;var rg=Array.isArray,ug=Object.prototype.hasOwnProperty,sd={current:null},hg={key:!0,ref:!0,__self:!0,__source:!0};function dg(t,e,n){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)ug.call(e,i)&&!hg.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=n;else if(1<a){for(var l=Array(a),c=0;c<a;c++)l[c]=arguments[c+2];r.children=l}if(t&&t.defaultProps)for(i in a=t.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:Do,type:t,key:s,ref:o,props:r,_owner:sd.current}}function Vy(t,e){return{$$typeof:Do,type:t.type,key:e,ref:t.ref,props:t.props,_owner:t._owner}}function od(t){return typeof t=="object"&&t!==null&&t.$$typeof===Do}function Gy(t){var e={"=":"=0",":":"=2"};return"$"+t.replace(/[=:]/g,function(n){return e[n]})}var sg=/\/+/g;function nd(t,e){return typeof t=="object"&&t!==null&&t.key!=null?Gy(""+t.key):e.toString(36)}function Tl(t,e,n,i,r){var s=typeof t;(s==="undefined"||s==="boolean")&&(t=null);var o=!1;if(t===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(t.$$typeof){case Do:case Py:o=!0}}if(o)return o=t,r=r(o),t=i===""?"."+nd(o,0):i,rg(r)?(n="",t!=null&&(n=t.replace(sg,"$&/")+"/"),Tl(r,e,n,"",function(c){return c})):r!=null&&(od(r)&&(r=Vy(r,n+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(sg,"$&/")+"/")+t)),e.push(r)),1;if(o=0,i=i===""?".":i+":",rg(t))for(var a=0;a<t.length;a++){s=t[a];var l=i+nd(s,a);o+=Tl(s,e,n,l,r)}else if(l=zy(t),typeof l=="function")for(t=l.call(t),a=0;!(s=t.next()).done;)s=s.value,l=i+nd(s,a++),o+=Tl(s,e,n,l,r);else if(s==="object")throw e=String(t),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function El(t,e,n){if(t==null)return t;var i=[],r=0;return Tl(t,i,"","",function(s){return e.call(n,s,r++)}),i}function Hy(t){if(t._status===-1){var e=t._result;e=e(),e.then(function(n){(t._status===0||t._status===-1)&&(t._status=1,t._result=n)},function(n){(t._status===0||t._status===-1)&&(t._status=2,t._result=n)}),t._status===-1&&(t._status=0,t._result=e)}if(t._status===1)return t._result.default;throw t._result}var fn={current:null},bl={transition:null},Wy={ReactCurrentDispatcher:fn,ReactCurrentBatchConfig:bl,ReactCurrentOwner:sd};function fg(){throw Error("act(...) is not supported in production builds of React.")}Je.Children={map:El,forEach:function(t,e,n){El(t,function(){e.apply(this,arguments)},n)},count:function(t){var e=0;return El(t,function(){e++}),e},toArray:function(t){return El(t,function(e){return e})||[]},only:function(t){if(!od(t))throw Error("React.Children.only expected to receive a single React element child.");return t}};Je.Component=bs;Je.Fragment=Iy;Je.Profiler=Ny;Je.PureComponent=id;Je.StrictMode=Ly;Je.Suspense=Oy;Je.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=Wy;Je.act=fg;Je.cloneElement=function(t,e,n){if(t==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+t+".");var i=ag({},t.props),r=t.key,s=t.ref,o=t._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=sd.current),e.key!==void 0&&(r=""+e.key),t.type&&t.type.defaultProps)var a=t.type.defaultProps;for(l in e)ug.call(e,l)&&!hg.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=n;else if(1<l){a=Array(l);for(var c=0;c<l;c++)a[c]=arguments[c+2];i.children=a}return{$$typeof:Do,type:t.type,key:r,ref:s,props:i,_owner:o}};Je.createContext=function(t){return t={$$typeof:Uy,_currentValue:t,_currentValue2:t,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},t.Provider={$$typeof:Dy,_context:t},t.Consumer=t};Je.createElement=dg;Je.createFactory=function(t){var e=dg.bind(null,t);return e.type=t,e};Je.createRef=function(){return{current:null}};Je.forwardRef=function(t){return{$$typeof:Fy,render:t}};Je.isValidElement=od;Je.lazy=function(t){return{$$typeof:ky,_payload:{_status:-1,_result:t},_init:Hy}};Je.memo=function(t,e){return{$$typeof:By,type:t,compare:e===void 0?null:e}};Je.startTransition=function(t){var e=bl.transition;bl.transition={};try{t()}finally{bl.transition=e}};Je.unstable_act=fg;Je.useCallback=function(t,e){return fn.current.useCallback(t,e)};Je.useContext=function(t){return fn.current.useContext(t)};Je.useDebugValue=function(){};Je.useDeferredValue=function(t){return fn.current.useDeferredValue(t)};Je.useEffect=function(t,e){return fn.current.useEffect(t,e)};Je.useId=function(){return fn.current.useId()};Je.useImperativeHandle=function(t,e,n){return fn.current.useImperativeHandle(t,e,n)};Je.useInsertionEffect=function(t,e){return fn.current.useInsertionEffect(t,e)};Je.useLayoutEffect=function(t,e){return fn.current.useLayoutEffect(t,e)};Je.useMemo=function(t,e){return fn.current.useMemo(t,e)};Je.useReducer=function(t,e,n){return fn.current.useReducer(t,e,n)};Je.useRef=function(t){return fn.current.useRef(t)};Je.useState=function(t){return fn.current.useState(t)};Je.useSyncExternalStore=function(t,e,n){return fn.current.useSyncExternalStore(t,e,n)};Je.useTransition=function(){return fn.current.useTransition()};Je.version="18.3.1"});var Al=Oi((NA,mg)=>{"use strict";mg.exports=pg()});var Tg=Oi(vt=>{"use strict";function ud(t,e){var n=t.length;t.push(e);e:for(;0<n;){var i=n-1>>>1,r=t[i];if(0<Cl(r,e))t[i]=e,t[n]=r,n=i;else break e}}function Qn(t){return t.length===0?null:t[0]}function Pl(t){if(t.length===0)return null;var e=t[0],n=t.pop();if(n!==e){t[0]=n;e:for(var i=0,r=t.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=t[o],l=o+1,c=t[l];if(0>Cl(a,n))l<r&&0>Cl(c,a)?(t[i]=c,t[l]=n,i=l):(t[i]=a,t[o]=n,i=o);else if(l<r&&0>Cl(c,n))t[i]=c,t[l]=n,i=l;else break e}}return e}function Cl(t,e){var n=t.sortIndex-e.sortIndex;return n!==0?n:t.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(gg=performance,vt.unstable_now=function(){return gg.now()}):(ad=Date,_g=ad.now(),vt.unstable_now=function(){return ad.now()-_g});var gg,ad,_g,vi=[],or=[],Xy=1,Gn=null,nn=3,Il=!1,Zr=!1,Fo=!1,yg=typeof setTimeout=="function"?setTimeout:null,Sg=typeof clearTimeout=="function"?clearTimeout:null,vg=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function hd(t){for(var e=Qn(or);e!==null;){if(e.callback===null)Pl(or);else if(e.startTime<=t)Pl(or),e.sortIndex=e.expirationTime,ud(vi,e);else break;e=Qn(or)}}function dd(t){if(Fo=!1,hd(t),!Zr)if(Qn(vi)!==null)Zr=!0,pd(fd);else{var e=Qn(or);e!==null&&md(dd,e.startTime-t)}}function fd(t,e){Zr=!1,Fo&&(Fo=!1,Sg(Oo),Oo=-1),Il=!0;var n=nn;try{for(hd(e),Gn=Qn(vi);Gn!==null&&(!(Gn.expirationTime>e)||t&&!Eg());){var i=Gn.callback;if(typeof i=="function"){Gn.callback=null,nn=Gn.priorityLevel;var r=i(Gn.expirationTime<=e);e=vt.unstable_now(),typeof r=="function"?Gn.callback=r:Gn===Qn(vi)&&Pl(vi),hd(e)}else Pl(vi);Gn=Qn(vi)}if(Gn!==null)var s=!0;else{var o=Qn(or);o!==null&&md(dd,o.startTime-e),s=!1}return s}finally{Gn=null,nn=n,Il=!1}}var Ll=!1,Rl=null,Oo=-1,Mg=5,wg=-1;function Eg(){return!(vt.unstable_now()-wg<Mg)}function ld(){if(Rl!==null){var t=vt.unstable_now();wg=t;var e=!0;try{e=Rl(!0,t)}finally{e?Uo():(Ll=!1,Rl=null)}}else Ll=!1}var Uo;typeof vg=="function"?Uo=function(){vg(ld)}:typeof MessageChannel<"u"?(cd=new MessageChannel,xg=cd.port2,cd.port1.onmessage=ld,Uo=function(){xg.postMessage(null)}):Uo=function(){yg(ld,0)};var cd,xg;function pd(t){Rl=t,Ll||(Ll=!0,Uo())}function md(t,e){Oo=yg(function(){t(vt.unstable_now())},e)}vt.unstable_IdlePriority=5;vt.unstable_ImmediatePriority=1;vt.unstable_LowPriority=4;vt.unstable_NormalPriority=3;vt.unstable_Profiling=null;vt.unstable_UserBlockingPriority=2;vt.unstable_cancelCallback=function(t){t.callback=null};vt.unstable_continueExecution=function(){Zr||Il||(Zr=!0,pd(fd))};vt.unstable_forceFrameRate=function(t){0>t||125<t?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):Mg=0<t?Math.floor(1e3/t):5};vt.unstable_getCurrentPriorityLevel=function(){return nn};vt.unstable_getFirstCallbackNode=function(){return Qn(vi)};vt.unstable_next=function(t){switch(nn){case 1:case 2:case 3:var e=3;break;default:e=nn}var n=nn;nn=e;try{return t()}finally{nn=n}};vt.unstable_pauseExecution=function(){};vt.unstable_requestPaint=function(){};vt.unstable_runWithPriority=function(t,e){switch(t){case 1:case 2:case 3:case 4:case 5:break;default:t=3}var n=nn;nn=t;try{return e()}finally{nn=n}};vt.unstable_scheduleCallback=function(t,e,n){var i=vt.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,t){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=n+r,t={id:Xy++,callback:e,priorityLevel:t,startTime:n,expirationTime:r,sortIndex:-1},n>i?(t.sortIndex=n,ud(or,t),Qn(vi)===null&&t===Qn(or)&&(Fo?(Sg(Oo),Oo=-1):Fo=!0,md(dd,n-i))):(t.sortIndex=r,ud(vi,t),Zr||Il||(Zr=!0,pd(fd))),t};vt.unstable_shouldYield=Eg;vt.unstable_wrapCallback=function(t){var e=nn;return function(){var n=nn;nn=e;try{return t.apply(this,arguments)}finally{nn=n}}}});var Ag=Oi((UA,bg)=>{"use strict";bg.exports=Tg()});var Iv=Oi(Un=>{"use strict";var Yy=Al(),Nn=Ag();function ie(t){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+t,n=1;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n]);return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var D0=new Set,sa={};function as(t,e){qs(t,e),qs(t+"Capture",e)}function qs(t,e){for(sa[t]=e,t=0;t<e.length;t++)D0.add(e[t])}var Hi=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),Bd=Object.prototype.hasOwnProperty,qy=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,Cg={},Rg={};function Zy(t){return Bd.call(Rg,t)?!0:Bd.call(Cg,t)?!1:qy.test(t)?Rg[t]=!0:(Cg[t]=!0,!1)}function $y(t,e,n,i){if(n!==null&&n.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:n!==null?!n.acceptsBooleans:(t=t.toLowerCase().slice(0,5),t!=="data-"&&t!=="aria-");default:return!1}}function Jy(t,e,n,i){if(e===null||typeof e>"u"||$y(t,e,n,i))return!0;if(i)return!1;if(n!==null)switch(n.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function gn(t,e,n,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=n,this.propertyName=t,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var Jt={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t){Jt[t]=new gn(t,0,!1,t,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(t){var e=t[0];Jt[e]=new gn(e,1,!1,t[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(t){Jt[t]=new gn(t,2,!1,t.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(t){Jt[t]=new gn(t,2,!1,t,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t){Jt[t]=new gn(t,3,!1,t.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(t){Jt[t]=new gn(t,3,!0,t,null,!1,!1)});["capture","download"].forEach(function(t){Jt[t]=new gn(t,4,!1,t,null,!1,!1)});["cols","rows","size","span"].forEach(function(t){Jt[t]=new gn(t,6,!1,t,null,!1,!1)});["rowSpan","start"].forEach(function(t){Jt[t]=new gn(t,5,!1,t.toLowerCase(),null,!1,!1)});var If=/[\-:]([a-z])/g;function Lf(t){return t[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t){var e=t.replace(If,Lf);Jt[e]=new gn(e,1,!1,t,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t){var e=t.replace(If,Lf);Jt[e]=new gn(e,1,!1,t,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(t){var e=t.replace(If,Lf);Jt[e]=new gn(e,1,!1,t,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(t){Jt[t]=new gn(t,1,!1,t.toLowerCase(),null,!1,!1)});Jt.xlinkHref=new gn("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(t){Jt[t]=new gn(t,1,!1,t.toLowerCase(),null,!0,!0)});function Nf(t,e,n,i){var r=Jt.hasOwnProperty(e)?Jt[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(Jy(e,n,r,i)&&(n=null),i||r===null?Zy(e)&&(n===null?t.removeAttribute(e):t.setAttribute(e,""+n)):r.mustUseProperty?t[r.propertyName]=n===null?r.type===3?!1:"":n:(e=r.attributeName,i=r.attributeNamespace,n===null?t.removeAttribute(e):(r=r.type,n=r===3||r===4&&n===!0?"":""+n,i?t.setAttributeNS(i,e,n):t.setAttribute(e,n))))}var qi=Yy.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,Nl=Symbol.for("react.element"),Rs=Symbol.for("react.portal"),Ps=Symbol.for("react.fragment"),Df=Symbol.for("react.strict_mode"),kd=Symbol.for("react.profiler"),U0=Symbol.for("react.provider"),F0=Symbol.for("react.context"),Uf=Symbol.for("react.forward_ref"),zd=Symbol.for("react.suspense"),Vd=Symbol.for("react.suspense_list"),Ff=Symbol.for("react.memo"),lr=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var O0=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var Pg=Symbol.iterator;function Bo(t){return t===null||typeof t!="object"?null:(t=Pg&&t[Pg]||t["@@iterator"],typeof t=="function"?t:null)}var Rt=Object.assign,gd;function Yo(t){if(gd===void 0)try{throw Error()}catch(n){var e=n.stack.trim().match(/\n( *(at )?)/);gd=e&&e[1]||""}return`
`+gd+t}var _d=!1;function vd(t,e){if(!t||_d)return"";_d=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(c){var i=c}Reflect.construct(t,[],e)}else{try{e.call()}catch(c){i=c}t.call(e.prototype)}else{try{throw Error()}catch(c){i=c}t()}}catch(c){if(c&&i&&typeof c.stack=="string"){for(var r=c.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return t.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",t.displayName)),l}while(1<=o&&0<=a);break}}}finally{_d=!1,Error.prepareStackTrace=n}return(t=t?t.displayName||t.name:"")?Yo(t):""}function Ky(t){switch(t.tag){case 5:return Yo(t.type);case 16:return Yo("Lazy");case 13:return Yo("Suspense");case 19:return Yo("SuspenseList");case 0:case 2:case 15:return t=vd(t.type,!1),t;case 11:return t=vd(t.type.render,!1),t;case 1:return t=vd(t.type,!0),t;default:return""}}function Gd(t){if(t==null)return null;if(typeof t=="function")return t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case Ps:return"Fragment";case Rs:return"Portal";case kd:return"Profiler";case Df:return"StrictMode";case zd:return"Suspense";case Vd:return"SuspenseList"}if(typeof t=="object")switch(t.$$typeof){case F0:return(t.displayName||"Context")+".Consumer";case U0:return(t._context.displayName||"Context")+".Provider";case Uf:var e=t.render;return t=t.displayName,t||(t=e.displayName||e.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case Ff:return e=t.displayName||null,e!==null?e:Gd(t.type)||"Memo";case lr:e=t._payload,t=t._init;try{return Gd(t(e))}catch{}}return null}function jy(t){var e=t.type;switch(t.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return t=e.render,t=t.displayName||t.name||"",e.displayName||(t!==""?"ForwardRef("+t+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return Gd(e);case 8:return e===Df?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function Mr(t){switch(typeof t){case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function B0(t){var e=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function Qy(t){var e=B0(t)?"checked":"value",n=Object.getOwnPropertyDescriptor(t.constructor.prototype,e),i=""+t[e];if(!t.hasOwnProperty(e)&&typeof n<"u"&&typeof n.get=="function"&&typeof n.set=="function"){var r=n.get,s=n.set;return Object.defineProperty(t,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(t,e,{enumerable:n.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){t._valueTracker=null,delete t[e]}}}}function Dl(t){t._valueTracker||(t._valueTracker=Qy(t))}function k0(t){if(!t)return!1;var e=t._valueTracker;if(!e)return!0;var n=e.getValue(),i="";return t&&(i=B0(t)?t.checked?"true":"false":t.value),t=i,t!==n?(e.setValue(t),!0):!1}function lc(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}function Hd(t,e){var n=e.checked;return Rt({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??t._wrapperState.initialChecked})}function Ig(t,e){var n=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;n=Mr(e.value!=null?e.value:n),t._wrapperState={initialChecked:i,initialValue:n,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function z0(t,e){e=e.checked,e!=null&&Nf(t,"checked",e,!1)}function Wd(t,e){z0(t,e);var n=Mr(e.value),i=e.type;if(n!=null)i==="number"?(n===0&&t.value===""||t.value!=n)&&(t.value=""+n):t.value!==""+n&&(t.value=""+n);else if(i==="submit"||i==="reset"){t.removeAttribute("value");return}e.hasOwnProperty("value")?Xd(t,e.type,n):e.hasOwnProperty("defaultValue")&&Xd(t,e.type,Mr(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(t.defaultChecked=!!e.defaultChecked)}function Lg(t,e,n){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+t._wrapperState.initialValue,n||e===t.value||(t.value=e),t.defaultValue=e}n=t.name,n!==""&&(t.name=""),t.defaultChecked=!!t._wrapperState.initialChecked,n!==""&&(t.name=n)}function Xd(t,e,n){(e!=="number"||lc(t.ownerDocument)!==t)&&(n==null?t.defaultValue=""+t._wrapperState.initialValue:t.defaultValue!==""+n&&(t.defaultValue=""+n))}var qo=Array.isArray;function Vs(t,e,n,i){if(t=t.options,e){e={};for(var r=0;r<n.length;r++)e["$"+n[r]]=!0;for(n=0;n<t.length;n++)r=e.hasOwnProperty("$"+t[n].value),t[n].selected!==r&&(t[n].selected=r),r&&i&&(t[n].defaultSelected=!0)}else{for(n=""+Mr(n),e=null,r=0;r<t.length;r++){if(t[r].value===n){t[r].selected=!0,i&&(t[r].defaultSelected=!0);return}e!==null||t[r].disabled||(e=t[r])}e!==null&&(e.selected=!0)}}function Yd(t,e){if(e.dangerouslySetInnerHTML!=null)throw Error(ie(91));return Rt({},e,{value:void 0,defaultValue:void 0,children:""+t._wrapperState.initialValue})}function Ng(t,e){var n=e.value;if(n==null){if(n=e.children,e=e.defaultValue,n!=null){if(e!=null)throw Error(ie(92));if(qo(n)){if(1<n.length)throw Error(ie(93));n=n[0]}e=n}e==null&&(e=""),n=e}t._wrapperState={initialValue:Mr(n)}}function V0(t,e){var n=Mr(e.value),i=Mr(e.defaultValue);n!=null&&(n=""+n,n!==t.value&&(t.value=n),e.defaultValue==null&&t.defaultValue!==n&&(t.defaultValue=n)),i!=null&&(t.defaultValue=""+i)}function Dg(t){var e=t.textContent;e===t._wrapperState.initialValue&&e!==""&&e!==null&&(t.value=e)}function G0(t){switch(t){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function qd(t,e){return t==null||t==="http://www.w3.org/1999/xhtml"?G0(e):t==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":t}var Ul,H0=function(t){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,n,i,r){MSApp.execUnsafeLocalFunction(function(){return t(e,n,i,r)})}:t}(function(t,e){if(t.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in t)t.innerHTML=e;else{for(Ul=Ul||document.createElement("div"),Ul.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=Ul.firstChild;t.firstChild;)t.removeChild(t.firstChild);for(;e.firstChild;)t.appendChild(e.firstChild)}});function oa(t,e){if(e){var n=t.firstChild;if(n&&n===t.lastChild&&n.nodeType===3){n.nodeValue=e;return}}t.textContent=e}var Jo={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},eS=["Webkit","ms","Moz","O"];Object.keys(Jo).forEach(function(t){eS.forEach(function(e){e=e+t.charAt(0).toUpperCase()+t.substring(1),Jo[e]=Jo[t]})});function W0(t,e,n){return e==null||typeof e=="boolean"||e===""?"":n||typeof e!="number"||e===0||Jo.hasOwnProperty(t)&&Jo[t]?(""+e).trim():e+"px"}function X0(t,e){t=t.style;for(var n in e)if(e.hasOwnProperty(n)){var i=n.indexOf("--")===0,r=W0(n,e[n],i);n==="float"&&(n="cssFloat"),i?t.setProperty(n,r):t[n]=r}}var tS=Rt({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function Zd(t,e){if(e){if(tS[t]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(ie(137,t));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(ie(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(ie(61))}if(e.style!=null&&typeof e.style!="object")throw Error(ie(62))}}function $d(t,e){if(t.indexOf("-")===-1)return typeof e.is=="string";switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var Jd=null;function Of(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var Kd=null,Gs=null,Hs=null;function Ug(t){if(t=Ea(t)){if(typeof Kd!="function")throw Error(ie(280));var e=t.stateNode;e&&(e=Fc(e),Kd(t.stateNode,t.type,e))}}function Y0(t){Gs?Hs?Hs.push(t):Hs=[t]:Gs=t}function q0(){if(Gs){var t=Gs,e=Hs;if(Hs=Gs=null,Ug(t),e)for(t=0;t<e.length;t++)Ug(e[t])}}function Z0(t,e){return t(e)}function $0(){}var xd=!1;function J0(t,e,n){if(xd)return t(e,n);xd=!0;try{return Z0(t,e,n)}finally{xd=!1,(Gs!==null||Hs!==null)&&($0(),q0())}}function aa(t,e){var n=t.stateNode;if(n===null)return null;var i=Fc(n);if(i===null)return null;n=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(t=t.type,i=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!i;break e;default:t=!1}if(t)return null;if(n&&typeof n!="function")throw Error(ie(231,e,typeof n));return n}var jd=!1;if(Hi)try{As={},Object.defineProperty(As,"passive",{get:function(){jd=!0}}),window.addEventListener("test",As,As),window.removeEventListener("test",As,As)}catch{jd=!1}var As;function nS(t,e,n,i,r,s,o,a,l){var c=Array.prototype.slice.call(arguments,3);try{e.apply(n,c)}catch(d){this.onError(d)}}var Ko=!1,cc=null,uc=!1,Qd=null,iS={onError:function(t){Ko=!0,cc=t}};function rS(t,e,n,i,r,s,o,a,l){Ko=!1,cc=null,nS.apply(iS,arguments)}function sS(t,e,n,i,r,s,o,a,l){if(rS.apply(this,arguments),Ko){if(Ko){var c=cc;Ko=!1,cc=null}else throw Error(ie(198));uc||(uc=!0,Qd=c)}}function ls(t){var e=t,n=t;if(t.alternate)for(;e.return;)e=e.return;else{t=e;do e=t,e.flags&4098&&(n=e.return),t=e.return;while(t)}return e.tag===3?n:null}function K0(t){if(t.tag===13){var e=t.memoizedState;if(e===null&&(t=t.alternate,t!==null&&(e=t.memoizedState)),e!==null)return e.dehydrated}return null}function Fg(t){if(ls(t)!==t)throw Error(ie(188))}function oS(t){var e=t.alternate;if(!e){if(e=ls(t),e===null)throw Error(ie(188));return e!==t?null:t}for(var n=t,i=e;;){var r=n.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){n=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===n)return Fg(r),t;if(s===i)return Fg(r),e;s=s.sibling}throw Error(ie(188))}if(n.return!==i.return)n=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===n){o=!0,n=r,i=s;break}if(a===i){o=!0,i=r,n=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===n){o=!0,n=s,i=r;break}if(a===i){o=!0,i=s,n=r;break}a=a.sibling}if(!o)throw Error(ie(189))}}if(n.alternate!==i)throw Error(ie(190))}if(n.tag!==3)throw Error(ie(188));return n.stateNode.current===n?t:e}function j0(t){return t=oS(t),t!==null?Q0(t):null}function Q0(t){if(t.tag===5||t.tag===6)return t;for(t=t.child;t!==null;){var e=Q0(t);if(e!==null)return e;t=t.sibling}return null}var e_=Nn.unstable_scheduleCallback,Og=Nn.unstable_cancelCallback,aS=Nn.unstable_shouldYield,lS=Nn.unstable_requestPaint,Dt=Nn.unstable_now,cS=Nn.unstable_getCurrentPriorityLevel,Bf=Nn.unstable_ImmediatePriority,t_=Nn.unstable_UserBlockingPriority,hc=Nn.unstable_NormalPriority,uS=Nn.unstable_LowPriority,n_=Nn.unstable_IdlePriority,Lc=null,Mi=null;function hS(t){if(Mi&&typeof Mi.onCommitFiberRoot=="function")try{Mi.onCommitFiberRoot(Lc,t,void 0,(t.current.flags&128)===128)}catch{}}var ri=Math.clz32?Math.clz32:pS,dS=Math.log,fS=Math.LN2;function pS(t){return t>>>=0,t===0?32:31-(dS(t)/fS|0)|0}var Fl=64,Ol=4194304;function Zo(t){switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return t&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return t}}function dc(t,e){var n=t.pendingLanes;if(n===0)return 0;var i=0,r=t.suspendedLanes,s=t.pingedLanes,o=n&268435455;if(o!==0){var a=o&~r;a!==0?i=Zo(a):(s&=o,s!==0&&(i=Zo(s)))}else o=n&~r,o!==0?i=Zo(o):s!==0&&(i=Zo(s));if(i===0)return 0;if(e!==0&&e!==i&&!(e&r)&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if(i&4&&(i|=n&16),e=t.entangledLanes,e!==0)for(t=t.entanglements,e&=i;0<e;)n=31-ri(e),r=1<<n,i|=t[n],e&=~r;return i}function mS(t,e){switch(t){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function gS(t,e){for(var n=t.suspendedLanes,i=t.pingedLanes,r=t.expirationTimes,s=t.pendingLanes;0<s;){var o=31-ri(s),a=1<<o,l=r[o];l===-1?(!(a&n)||a&i)&&(r[o]=mS(a,e)):l<=e&&(t.expiredLanes|=a),s&=~a}}function ef(t){return t=t.pendingLanes&-1073741825,t!==0?t:t&1073741824?1073741824:0}function i_(){var t=Fl;return Fl<<=1,!(Fl&4194240)&&(Fl=64),t}function yd(t){for(var e=[],n=0;31>n;n++)e.push(t);return e}function Ma(t,e,n){t.pendingLanes|=e,e!==536870912&&(t.suspendedLanes=0,t.pingedLanes=0),t=t.eventTimes,e=31-ri(e),t[e]=n}function _S(t,e){var n=t.pendingLanes&~e;t.pendingLanes=e,t.suspendedLanes=0,t.pingedLanes=0,t.expiredLanes&=e,t.mutableReadLanes&=e,t.entangledLanes&=e,e=t.entanglements;var i=t.eventTimes;for(t=t.expirationTimes;0<n;){var r=31-ri(n),s=1<<r;e[r]=0,i[r]=-1,t[r]=-1,n&=~s}}function kf(t,e){var n=t.entangledLanes|=e;for(t=t.entanglements;n;){var i=31-ri(n),r=1<<i;r&e|t[i]&e&&(t[i]|=e),n&=~r}}var ht=0;function r_(t){return t&=-t,1<t?4<t?t&268435455?16:536870912:4:1}var s_,zf,o_,a_,l_,tf=!1,Bl=[],pr=null,mr=null,gr=null,la=new Map,ca=new Map,ur=[],vS="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function Bg(t,e){switch(t){case"focusin":case"focusout":pr=null;break;case"dragenter":case"dragleave":mr=null;break;case"mouseover":case"mouseout":gr=null;break;case"pointerover":case"pointerout":la.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":ca.delete(e.pointerId)}}function ko(t,e,n,i,r,s){return t===null||t.nativeEvent!==s?(t={blockedOn:e,domEventName:n,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=Ea(e),e!==null&&zf(e)),t):(t.eventSystemFlags|=i,e=t.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),t)}function xS(t,e,n,i,r){switch(e){case"focusin":return pr=ko(pr,t,e,n,i,r),!0;case"dragenter":return mr=ko(mr,t,e,n,i,r),!0;case"mouseover":return gr=ko(gr,t,e,n,i,r),!0;case"pointerover":var s=r.pointerId;return la.set(s,ko(la.get(s)||null,t,e,n,i,r)),!0;case"gotpointercapture":return s=r.pointerId,ca.set(s,ko(ca.get(s)||null,t,e,n,i,r)),!0}return!1}function c_(t){var e=Kr(t.target);if(e!==null){var n=ls(e);if(n!==null){if(e=n.tag,e===13){if(e=K0(n),e!==null){t.blockedOn=e,l_(t.priority,function(){o_(n)});return}}else if(e===3&&n.stateNode.current.memoizedState.isDehydrated){t.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}t.blockedOn=null}function jl(t){if(t.blockedOn!==null)return!1;for(var e=t.targetContainers;0<e.length;){var n=nf(t.domEventName,t.eventSystemFlags,e[0],t.nativeEvent);if(n===null){n=t.nativeEvent;var i=new n.constructor(n.type,n);Jd=i,n.target.dispatchEvent(i),Jd=null}else return e=Ea(n),e!==null&&zf(e),t.blockedOn=n,!1;e.shift()}return!0}function kg(t,e,n){jl(t)&&n.delete(e)}function yS(){tf=!1,pr!==null&&jl(pr)&&(pr=null),mr!==null&&jl(mr)&&(mr=null),gr!==null&&jl(gr)&&(gr=null),la.forEach(kg),ca.forEach(kg)}function zo(t,e){t.blockedOn===e&&(t.blockedOn=null,tf||(tf=!0,Nn.unstable_scheduleCallback(Nn.unstable_NormalPriority,yS)))}function ua(t){function e(r){return zo(r,t)}if(0<Bl.length){zo(Bl[0],t);for(var n=1;n<Bl.length;n++){var i=Bl[n];i.blockedOn===t&&(i.blockedOn=null)}}for(pr!==null&&zo(pr,t),mr!==null&&zo(mr,t),gr!==null&&zo(gr,t),la.forEach(e),ca.forEach(e),n=0;n<ur.length;n++)i=ur[n],i.blockedOn===t&&(i.blockedOn=null);for(;0<ur.length&&(n=ur[0],n.blockedOn===null);)c_(n),n.blockedOn===null&&ur.shift()}var Ws=qi.ReactCurrentBatchConfig,fc=!0;function SS(t,e,n,i){var r=ht,s=Ws.transition;Ws.transition=null;try{ht=1,Vf(t,e,n,i)}finally{ht=r,Ws.transition=s}}function MS(t,e,n,i){var r=ht,s=Ws.transition;Ws.transition=null;try{ht=4,Vf(t,e,n,i)}finally{ht=r,Ws.transition=s}}function Vf(t,e,n,i){if(fc){var r=nf(t,e,n,i);if(r===null)Ad(t,e,i,pc,n),Bg(t,i);else if(xS(r,t,e,n,i))i.stopPropagation();else if(Bg(t,i),e&4&&-1<vS.indexOf(t)){for(;r!==null;){var s=Ea(r);if(s!==null&&s_(s),s=nf(t,e,n,i),s===null&&Ad(t,e,i,pc,n),s===r)break;r=s}r!==null&&i.stopPropagation()}else Ad(t,e,i,null,n)}}var pc=null;function nf(t,e,n,i){if(pc=null,t=Of(i),t=Kr(t),t!==null)if(e=ls(t),e===null)t=null;else if(n=e.tag,n===13){if(t=K0(e),t!==null)return t;t=null}else if(n===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;t=null}else e!==t&&(t=null);return pc=t,null}function u_(t){switch(t){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(cS()){case Bf:return 1;case t_:return 4;case hc:case uS:return 16;case n_:return 536870912;default:return 16}default:return 16}}var dr=null,Gf=null,Ql=null;function h_(){if(Ql)return Ql;var t,e=Gf,n=e.length,i,r="value"in dr?dr.value:dr.textContent,s=r.length;for(t=0;t<n&&e[t]===r[t];t++);var o=n-t;for(i=1;i<=o&&e[n-i]===r[s-i];i++);return Ql=r.slice(t,1<i?1-i:void 0)}function ec(t){var e=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&e===13&&(t=13)):t=e,t===10&&(t=13),32<=t||t===13?t:0}function kl(){return!0}function zg(){return!1}function Dn(t){function e(n,i,r,s,o){this._reactName=n,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in t)t.hasOwnProperty(a)&&(n=t[a],this[a]=n?n(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?kl:zg,this.isPropagationStopped=zg,this}return Rt(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=kl)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=kl)},persist:function(){},isPersistent:kl}),e}var eo={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},Hf=Dn(eo),wa=Rt({},eo,{view:0,detail:0}),wS=Dn(wa),Sd,Md,Vo,Nc=Rt({},wa,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:Wf,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==Vo&&(Vo&&t.type==="mousemove"?(Sd=t.screenX-Vo.screenX,Md=t.screenY-Vo.screenY):Md=Sd=0,Vo=t),Sd)},movementY:function(t){return"movementY"in t?t.movementY:Md}}),Vg=Dn(Nc),ES=Rt({},Nc,{dataTransfer:0}),TS=Dn(ES),bS=Rt({},wa,{relatedTarget:0}),wd=Dn(bS),AS=Rt({},eo,{animationName:0,elapsedTime:0,pseudoElement:0}),CS=Dn(AS),RS=Rt({},eo,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),PS=Dn(RS),IS=Rt({},eo,{data:0}),Gg=Dn(IS),LS={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},NS={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},DS={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function US(t){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(t):(t=DS[t])?!!e[t]:!1}function Wf(){return US}var FS=Rt({},wa,{key:function(t){if(t.key){var e=LS[t.key]||t.key;if(e!=="Unidentified")return e}return t.type==="keypress"?(t=ec(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?NS[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:Wf,charCode:function(t){return t.type==="keypress"?ec(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?ec(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),OS=Dn(FS),BS=Rt({},Nc,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),Hg=Dn(BS),kS=Rt({},wa,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:Wf}),zS=Dn(kS),VS=Rt({},eo,{propertyName:0,elapsedTime:0,pseudoElement:0}),GS=Dn(VS),HS=Rt({},Nc,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),WS=Dn(HS),XS=[9,13,27,32],Xf=Hi&&"CompositionEvent"in window,jo=null;Hi&&"documentMode"in document&&(jo=document.documentMode);var YS=Hi&&"TextEvent"in window&&!jo,d_=Hi&&(!Xf||jo&&8<jo&&11>=jo),Wg=" ",Xg=!1;function f_(t,e){switch(t){case"keyup":return XS.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function p_(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var Is=!1;function qS(t,e){switch(t){case"compositionend":return p_(e);case"keypress":return e.which!==32?null:(Xg=!0,Wg);case"textInput":return t=e.data,t===Wg&&Xg?null:t;default:return null}}function ZS(t,e){if(Is)return t==="compositionend"||!Xf&&f_(t,e)?(t=h_(),Ql=Gf=dr=null,Is=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return d_&&e.locale!=="ko"?null:e.data;default:return null}}var $S={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function Yg(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e==="input"?!!$S[t.type]:e==="textarea"}function m_(t,e,n,i){Y0(i),e=mc(e,"onChange"),0<e.length&&(n=new Hf("onChange","change",null,n,i),t.push({event:n,listeners:e}))}var Qo=null,ha=null;function JS(t){b_(t,0)}function Dc(t){var e=Ds(t);if(k0(e))return t}function KS(t,e){if(t==="change")return e}var g_=!1;Hi&&(Hi?(Vl="oninput"in document,Vl||(Ed=document.createElement("div"),Ed.setAttribute("oninput","return;"),Vl=typeof Ed.oninput=="function"),zl=Vl):zl=!1,g_=zl&&(!document.documentMode||9<document.documentMode));var zl,Vl,Ed;function qg(){Qo&&(Qo.detachEvent("onpropertychange",__),ha=Qo=null)}function __(t){if(t.propertyName==="value"&&Dc(ha)){var e=[];m_(e,ha,t,Of(t)),J0(JS,e)}}function jS(t,e,n){t==="focusin"?(qg(),Qo=e,ha=n,Qo.attachEvent("onpropertychange",__)):t==="focusout"&&qg()}function QS(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return Dc(ha)}function eM(t,e){if(t==="click")return Dc(e)}function tM(t,e){if(t==="input"||t==="change")return Dc(e)}function nM(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var oi=typeof Object.is=="function"?Object.is:nM;function da(t,e){if(oi(t,e))return!0;if(typeof t!="object"||t===null||typeof e!="object"||e===null)return!1;var n=Object.keys(t),i=Object.keys(e);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var r=n[i];if(!Bd.call(e,r)||!oi(t[r],e[r]))return!1}return!0}function Zg(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function $g(t,e){var n=Zg(t);t=0;for(var i;n;){if(n.nodeType===3){if(i=t+n.textContent.length,t<=e&&i>=e)return{node:n,offset:e-t};t=i}e:{for(;n;){if(n.nextSibling){n=n.nextSibling;break e}n=n.parentNode}n=void 0}n=Zg(n)}}function v_(t,e){return t&&e?t===e?!0:t&&t.nodeType===3?!1:e&&e.nodeType===3?v_(t,e.parentNode):"contains"in t?t.contains(e):t.compareDocumentPosition?!!(t.compareDocumentPosition(e)&16):!1:!1}function x_(){for(var t=window,e=lc();e instanceof t.HTMLIFrameElement;){try{var n=typeof e.contentWindow.location.href=="string"}catch{n=!1}if(n)t=e.contentWindow;else break;e=lc(t.document)}return e}function Yf(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e&&(e==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||e==="textarea"||t.contentEditable==="true")}function iM(t){var e=x_(),n=t.focusedElem,i=t.selectionRange;if(e!==n&&n&&n.ownerDocument&&v_(n.ownerDocument.documentElement,n)){if(i!==null&&Yf(n)){if(e=i.start,t=i.end,t===void 0&&(t=e),"selectionStart"in n)n.selectionStart=e,n.selectionEnd=Math.min(t,n.value.length);else if(t=(e=n.ownerDocument||document)&&e.defaultView||window,t.getSelection){t=t.getSelection();var r=n.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!t.extend&&s>i&&(r=i,i=s,s=r),r=$g(n,s);var o=$g(n,i);r&&o&&(t.rangeCount!==1||t.anchorNode!==r.node||t.anchorOffset!==r.offset||t.focusNode!==o.node||t.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),t.removeAllRanges(),s>i?(t.addRange(e),t.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),t.addRange(e)))}}for(e=[],t=n;t=t.parentNode;)t.nodeType===1&&e.push({element:t,left:t.scrollLeft,top:t.scrollTop});for(typeof n.focus=="function"&&n.focus(),n=0;n<e.length;n++)t=e[n],t.element.scrollLeft=t.left,t.element.scrollTop=t.top}}var rM=Hi&&"documentMode"in document&&11>=document.documentMode,Ls=null,rf=null,ea=null,sf=!1;function Jg(t,e,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;sf||Ls==null||Ls!==lc(i)||(i=Ls,"selectionStart"in i&&Yf(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),ea&&da(ea,i)||(ea=i,i=mc(rf,"onSelect"),0<i.length&&(e=new Hf("onSelect","select",null,e,n),t.push({event:e,listeners:i}),e.target=Ls)))}function Gl(t,e){var n={};return n[t.toLowerCase()]=e.toLowerCase(),n["Webkit"+t]="webkit"+e,n["Moz"+t]="moz"+e,n}var Ns={animationend:Gl("Animation","AnimationEnd"),animationiteration:Gl("Animation","AnimationIteration"),animationstart:Gl("Animation","AnimationStart"),transitionend:Gl("Transition","TransitionEnd")},Td={},y_={};Hi&&(y_=document.createElement("div").style,"AnimationEvent"in window||(delete Ns.animationend.animation,delete Ns.animationiteration.animation,delete Ns.animationstart.animation),"TransitionEvent"in window||delete Ns.transitionend.transition);function Uc(t){if(Td[t])return Td[t];if(!Ns[t])return t;var e=Ns[t],n;for(n in e)if(e.hasOwnProperty(n)&&n in y_)return Td[t]=e[n];return t}var S_=Uc("animationend"),M_=Uc("animationiteration"),w_=Uc("animationstart"),E_=Uc("transitionend"),T_=new Map,Kg="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function Er(t,e){T_.set(t,e),as(e,[t])}for(Hl=0;Hl<Kg.length;Hl++)Wl=Kg[Hl],jg=Wl.toLowerCase(),Qg=Wl[0].toUpperCase()+Wl.slice(1),Er(jg,"on"+Qg);var Wl,jg,Qg,Hl;Er(S_,"onAnimationEnd");Er(M_,"onAnimationIteration");Er(w_,"onAnimationStart");Er("dblclick","onDoubleClick");Er("focusin","onFocus");Er("focusout","onBlur");Er(E_,"onTransitionEnd");qs("onMouseEnter",["mouseout","mouseover"]);qs("onMouseLeave",["mouseout","mouseover"]);qs("onPointerEnter",["pointerout","pointerover"]);qs("onPointerLeave",["pointerout","pointerover"]);as("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));as("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));as("onBeforeInput",["compositionend","keypress","textInput","paste"]);as("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));as("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));as("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var $o="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),sM=new Set("cancel close invalid load scroll toggle".split(" ").concat($o));function e0(t,e,n){var i=t.type||"unknown-event";t.currentTarget=n,sS(i,e,void 0,t),t.currentTarget=null}function b_(t,e){e=(e&4)!==0;for(var n=0;n<t.length;n++){var i=t[n],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,c=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;e0(r,a,c),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,c=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;e0(r,a,c),s=l}}}if(uc)throw t=Qd,uc=!1,Qd=null,t}function yt(t,e){var n=e[uf];n===void 0&&(n=e[uf]=new Set);var i=t+"__bubble";n.has(i)||(A_(e,t,2,!1),n.add(i))}function bd(t,e,n){var i=0;e&&(i|=4),A_(n,t,i,e)}var Xl="_reactListening"+Math.random().toString(36).slice(2);function fa(t){if(!t[Xl]){t[Xl]=!0,D0.forEach(function(n){n!=="selectionchange"&&(sM.has(n)||bd(n,!1,t),bd(n,!0,t))});var e=t.nodeType===9?t:t.ownerDocument;e===null||e[Xl]||(e[Xl]=!0,bd("selectionchange",!1,e))}}function A_(t,e,n,i){switch(u_(e)){case 1:var r=SS;break;case 4:r=MS;break;default:r=Vf}n=r.bind(null,e,n,t),r=void 0,!jd||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?t.addEventListener(e,n,{capture:!0,passive:r}):t.addEventListener(e,n,!0):r!==void 0?t.addEventListener(e,n,{passive:r}):t.addEventListener(e,n,!1)}function Ad(t,e,n,i,r){var s=i;if(!(e&1)&&!(e&2)&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=Kr(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}J0(function(){var c=s,d=Of(n),f=[];e:{var h=T_.get(t);if(h!==void 0){var p=Hf,x=t;switch(t){case"keypress":if(ec(n)===0)break e;case"keydown":case"keyup":p=OS;break;case"focusin":x="focus",p=wd;break;case"focusout":x="blur",p=wd;break;case"beforeblur":case"afterblur":p=wd;break;case"click":if(n.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":p=Vg;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":p=TS;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":p=zS;break;case S_:case M_:case w_:p=CS;break;case E_:p=GS;break;case"scroll":p=wS;break;case"wheel":p=WS;break;case"copy":case"cut":case"paste":p=PS;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":p=Hg}var M=(e&4)!==0,_=!M&&t==="scroll",u=M?h!==null?h+"Capture":null:h;M=[];for(var m=c,y;m!==null;){y=m;var w=y.stateNode;if(y.tag===5&&w!==null&&(y=w,u!==null&&(w=aa(m,u),w!=null&&M.push(pa(m,w,y)))),_)break;m=m.return}0<M.length&&(h=new p(h,x,null,n,d),f.push({event:h,listeners:M}))}}if(!(e&7)){e:{if(h=t==="mouseover"||t==="pointerover",p=t==="mouseout"||t==="pointerout",h&&n!==Jd&&(x=n.relatedTarget||n.fromElement)&&(Kr(x)||x[Wi]))break e;if((p||h)&&(h=d.window===d?d:(h=d.ownerDocument)?h.defaultView||h.parentWindow:window,p?(x=n.relatedTarget||n.toElement,p=c,x=x?Kr(x):null,x!==null&&(_=ls(x),x!==_||x.tag!==5&&x.tag!==6)&&(x=null)):(p=null,x=c),p!==x)){if(M=Vg,w="onMouseLeave",u="onMouseEnter",m="mouse",(t==="pointerout"||t==="pointerover")&&(M=Hg,w="onPointerLeave",u="onPointerEnter",m="pointer"),_=p==null?h:Ds(p),y=x==null?h:Ds(x),h=new M(w,m+"leave",p,n,d),h.target=_,h.relatedTarget=y,w=null,Kr(d)===c&&(M=new M(u,m+"enter",x,n,d),M.target=y,M.relatedTarget=_,w=M),_=w,p&&x)t:{for(M=p,u=x,m=0,y=M;y;y=Cs(y))m++;for(y=0,w=u;w;w=Cs(w))y++;for(;0<m-y;)M=Cs(M),m--;for(;0<y-m;)u=Cs(u),y--;for(;m--;){if(M===u||u!==null&&M===u.alternate)break t;M=Cs(M),u=Cs(u)}M=null}else M=null;p!==null&&t0(f,h,p,M,!1),x!==null&&_!==null&&t0(f,_,x,M,!0)}}e:{if(h=c?Ds(c):window,p=h.nodeName&&h.nodeName.toLowerCase(),p==="select"||p==="input"&&h.type==="file")var R=KS;else if(Yg(h))if(g_)R=tM;else{R=QS;var E=jS}else(p=h.nodeName)&&p.toLowerCase()==="input"&&(h.type==="checkbox"||h.type==="radio")&&(R=eM);if(R&&(R=R(t,c))){m_(f,R,n,d);break e}E&&E(t,h,c),t==="focusout"&&(E=h._wrapperState)&&E.controlled&&h.type==="number"&&Xd(h,"number",h.value)}switch(E=c?Ds(c):window,t){case"focusin":(Yg(E)||E.contentEditable==="true")&&(Ls=E,rf=c,ea=null);break;case"focusout":ea=rf=Ls=null;break;case"mousedown":sf=!0;break;case"contextmenu":case"mouseup":case"dragend":sf=!1,Jg(f,n,d);break;case"selectionchange":if(rM)break;case"keydown":case"keyup":Jg(f,n,d)}var A;if(Xf)e:{switch(t){case"compositionstart":var g="onCompositionStart";break e;case"compositionend":g="onCompositionEnd";break e;case"compositionupdate":g="onCompositionUpdate";break e}g=void 0}else Is?f_(t,n)&&(g="onCompositionEnd"):t==="keydown"&&n.keyCode===229&&(g="onCompositionStart");g&&(d_&&n.locale!=="ko"&&(Is||g!=="onCompositionStart"?g==="onCompositionEnd"&&Is&&(A=h_()):(dr=d,Gf="value"in dr?dr.value:dr.textContent,Is=!0)),E=mc(c,g),0<E.length&&(g=new Gg(g,t,null,n,d),f.push({event:g,listeners:E}),A?g.data=A:(A=p_(n),A!==null&&(g.data=A)))),(A=YS?qS(t,n):ZS(t,n))&&(c=mc(c,"onBeforeInput"),0<c.length&&(d=new Gg("onBeforeInput","beforeinput",null,n,d),f.push({event:d,listeners:c}),d.data=A))}b_(f,e)})}function pa(t,e,n){return{instance:t,listener:e,currentTarget:n}}function mc(t,e){for(var n=e+"Capture",i=[];t!==null;){var r=t,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=aa(t,n),s!=null&&i.unshift(pa(t,s,r)),s=aa(t,e),s!=null&&i.push(pa(t,s,r))),t=t.return}return i}function Cs(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5);return t||null}function t0(t,e,n,i,r){for(var s=e._reactName,o=[];n!==null&&n!==i;){var a=n,l=a.alternate,c=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&c!==null&&(a=c,r?(l=aa(n,s),l!=null&&o.unshift(pa(n,l,a))):r||(l=aa(n,s),l!=null&&o.push(pa(n,l,a)))),n=n.return}o.length!==0&&t.push({event:e,listeners:o})}var oM=/\r\n?/g,aM=/\u0000|\uFFFD/g;function n0(t){return(typeof t=="string"?t:""+t).replace(oM,`
`).replace(aM,"")}function Yl(t,e,n){if(e=n0(e),n0(t)!==e&&n)throw Error(ie(425))}function gc(){}var of=null,af=null;function lf(t,e){return t==="textarea"||t==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var cf=typeof setTimeout=="function"?setTimeout:void 0,lM=typeof clearTimeout=="function"?clearTimeout:void 0,i0=typeof Promise=="function"?Promise:void 0,cM=typeof queueMicrotask=="function"?queueMicrotask:typeof i0<"u"?function(t){return i0.resolve(null).then(t).catch(uM)}:cf;function uM(t){setTimeout(function(){throw t})}function Cd(t,e){var n=e,i=0;do{var r=n.nextSibling;if(t.removeChild(n),r&&r.nodeType===8)if(n=r.data,n==="/$"){if(i===0){t.removeChild(r),ua(e);return}i--}else n!=="$"&&n!=="$?"&&n!=="$!"||i++;n=r}while(n);ua(e)}function _r(t){for(;t!=null;t=t.nextSibling){var e=t.nodeType;if(e===1||e===3)break;if(e===8){if(e=t.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return t}function r0(t){t=t.previousSibling;for(var e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="$"||n==="$!"||n==="$?"){if(e===0)return t;e--}else n==="/$"&&e++}t=t.previousSibling}return null}var to=Math.random().toString(36).slice(2),Si="__reactFiber$"+to,ma="__reactProps$"+to,Wi="__reactContainer$"+to,uf="__reactEvents$"+to,hM="__reactListeners$"+to,dM="__reactHandles$"+to;function Kr(t){var e=t[Si];if(e)return e;for(var n=t.parentNode;n;){if(e=n[Wi]||n[Si]){if(n=e.alternate,e.child!==null||n!==null&&n.child!==null)for(t=r0(t);t!==null;){if(n=t[Si])return n;t=r0(t)}return e}t=n,n=t.parentNode}return null}function Ea(t){return t=t[Si]||t[Wi],!t||t.tag!==5&&t.tag!==6&&t.tag!==13&&t.tag!==3?null:t}function Ds(t){if(t.tag===5||t.tag===6)return t.stateNode;throw Error(ie(33))}function Fc(t){return t[ma]||null}var hf=[],Us=-1;function Tr(t){return{current:t}}function St(t){0>Us||(t.current=hf[Us],hf[Us]=null,Us--)}function xt(t,e){Us++,hf[Us]=t.current,t.current=e}var wr={},an=Tr(wr),wn=Tr(!1),ns=wr;function Zs(t,e){var n=t.type.contextTypes;if(!n)return wr;var i=t.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in n)r[s]=e[s];return i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=e,t.__reactInternalMemoizedMaskedChildContext=r),r}function En(t){return t=t.childContextTypes,t!=null}function _c(){St(wn),St(an)}function s0(t,e,n){if(an.current!==wr)throw Error(ie(168));xt(an,e),xt(wn,n)}function C_(t,e,n){var i=t.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return n;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(ie(108,jy(t)||"Unknown",r));return Rt({},n,i)}function vc(t){return t=(t=t.stateNode)&&t.__reactInternalMemoizedMergedChildContext||wr,ns=an.current,xt(an,t),xt(wn,wn.current),!0}function o0(t,e,n){var i=t.stateNode;if(!i)throw Error(ie(169));n?(t=C_(t,e,ns),i.__reactInternalMemoizedMergedChildContext=t,St(wn),St(an),xt(an,t)):St(wn),xt(wn,n)}var ki=null,Oc=!1,Rd=!1;function R_(t){ki===null?ki=[t]:ki.push(t)}function fM(t){Oc=!0,R_(t)}function br(){if(!Rd&&ki!==null){Rd=!0;var t=0,e=ht;try{var n=ki;for(ht=1;t<n.length;t++){var i=n[t];do i=i(!0);while(i!==null)}ki=null,Oc=!1}catch(r){throw ki!==null&&(ki=ki.slice(t+1)),e_(Bf,br),r}finally{ht=e,Rd=!1}}return null}var Fs=[],Os=0,xc=null,yc=0,Hn=[],Wn=0,is=null,zi=1,Vi="";function $r(t,e){Fs[Os++]=yc,Fs[Os++]=xc,xc=t,yc=e}function P_(t,e,n){Hn[Wn++]=zi,Hn[Wn++]=Vi,Hn[Wn++]=is,is=t;var i=zi;t=Vi;var r=32-ri(i)-1;i&=~(1<<r),n+=1;var s=32-ri(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,zi=1<<32-ri(e)+r|n<<r|i,Vi=s+t}else zi=1<<s|n<<r|i,Vi=t}function qf(t){t.return!==null&&($r(t,1),P_(t,1,0))}function Zf(t){for(;t===xc;)xc=Fs[--Os],Fs[Os]=null,yc=Fs[--Os],Fs[Os]=null;for(;t===is;)is=Hn[--Wn],Hn[Wn]=null,Vi=Hn[--Wn],Hn[Wn]=null,zi=Hn[--Wn],Hn[Wn]=null}var Ln=null,In=null,Et=!1,ii=null;function I_(t,e){var n=Xn(5,null,null,0);n.elementType="DELETED",n.stateNode=e,n.return=t,e=t.deletions,e===null?(t.deletions=[n],t.flags|=16):e.push(n)}function a0(t,e){switch(t.tag){case 5:var n=t.type;return e=e.nodeType!==1||n.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(t.stateNode=e,Ln=t,In=_r(e.firstChild),!0):!1;case 6:return e=t.pendingProps===""||e.nodeType!==3?null:e,e!==null?(t.stateNode=e,Ln=t,In=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(n=is!==null?{id:zi,overflow:Vi}:null,t.memoizedState={dehydrated:e,treeContext:n,retryLane:1073741824},n=Xn(18,null,null,0),n.stateNode=e,n.return=t,t.child=n,Ln=t,In=null,!0):!1;default:return!1}}function df(t){return(t.mode&1)!==0&&(t.flags&128)===0}function ff(t){if(Et){var e=In;if(e){var n=e;if(!a0(t,e)){if(df(t))throw Error(ie(418));e=_r(n.nextSibling);var i=Ln;e&&a0(t,e)?I_(i,n):(t.flags=t.flags&-4097|2,Et=!1,Ln=t)}}else{if(df(t))throw Error(ie(418));t.flags=t.flags&-4097|2,Et=!1,Ln=t}}}function l0(t){for(t=t.return;t!==null&&t.tag!==5&&t.tag!==3&&t.tag!==13;)t=t.return;Ln=t}function ql(t){if(t!==Ln)return!1;if(!Et)return l0(t),Et=!0,!1;var e;if((e=t.tag!==3)&&!(e=t.tag!==5)&&(e=t.type,e=e!=="head"&&e!=="body"&&!lf(t.type,t.memoizedProps)),e&&(e=In)){if(df(t))throw L_(),Error(ie(418));for(;e;)I_(t,e),e=_r(e.nextSibling)}if(l0(t),t.tag===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(ie(317));e:{for(t=t.nextSibling,e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="/$"){if(e===0){In=_r(t.nextSibling);break e}e--}else n!=="$"&&n!=="$!"&&n!=="$?"||e++}t=t.nextSibling}In=null}}else In=Ln?_r(t.stateNode.nextSibling):null;return!0}function L_(){for(var t=In;t;)t=_r(t.nextSibling)}function $s(){In=Ln=null,Et=!1}function $f(t){ii===null?ii=[t]:ii.push(t)}var pM=qi.ReactCurrentBatchConfig;function Go(t,e,n){if(t=n.ref,t!==null&&typeof t!="function"&&typeof t!="object"){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(ie(309));var i=n.stateNode}if(!i)throw Error(ie(147,t));var r=i,s=""+t;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof t!="string")throw Error(ie(284));if(!n._owner)throw Error(ie(290,t))}return t}function Zl(t,e){throw t=Object.prototype.toString.call(e),Error(ie(31,t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t))}function c0(t){var e=t._init;return e(t._payload)}function N_(t){function e(u,m){if(t){var y=u.deletions;y===null?(u.deletions=[m],u.flags|=16):y.push(m)}}function n(u,m){if(!t)return null;for(;m!==null;)e(u,m),m=m.sibling;return null}function i(u,m){for(u=new Map;m!==null;)m.key!==null?u.set(m.key,m):u.set(m.index,m),m=m.sibling;return u}function r(u,m){return u=Sr(u,m),u.index=0,u.sibling=null,u}function s(u,m,y){return u.index=y,t?(y=u.alternate,y!==null?(y=y.index,y<m?(u.flags|=2,m):y):(u.flags|=2,m)):(u.flags|=1048576,m)}function o(u){return t&&u.alternate===null&&(u.flags|=2),u}function a(u,m,y,w){return m===null||m.tag!==6?(m=Fd(y,u.mode,w),m.return=u,m):(m=r(m,y),m.return=u,m)}function l(u,m,y,w){var R=y.type;return R===Ps?d(u,m,y.props.children,w,y.key):m!==null&&(m.elementType===R||typeof R=="object"&&R!==null&&R.$$typeof===lr&&c0(R)===m.type)?(w=r(m,y.props),w.ref=Go(u,m,y),w.return=u,w):(w=ac(y.type,y.key,y.props,null,u.mode,w),w.ref=Go(u,m,y),w.return=u,w)}function c(u,m,y,w){return m===null||m.tag!==4||m.stateNode.containerInfo!==y.containerInfo||m.stateNode.implementation!==y.implementation?(m=Od(y,u.mode,w),m.return=u,m):(m=r(m,y.children||[]),m.return=u,m)}function d(u,m,y,w,R){return m===null||m.tag!==7?(m=ts(y,u.mode,w,R),m.return=u,m):(m=r(m,y),m.return=u,m)}function f(u,m,y){if(typeof m=="string"&&m!==""||typeof m=="number")return m=Fd(""+m,u.mode,y),m.return=u,m;if(typeof m=="object"&&m!==null){switch(m.$$typeof){case Nl:return y=ac(m.type,m.key,m.props,null,u.mode,y),y.ref=Go(u,null,m),y.return=u,y;case Rs:return m=Od(m,u.mode,y),m.return=u,m;case lr:var w=m._init;return f(u,w(m._payload),y)}if(qo(m)||Bo(m))return m=ts(m,u.mode,y,null),m.return=u,m;Zl(u,m)}return null}function h(u,m,y,w){var R=m!==null?m.key:null;if(typeof y=="string"&&y!==""||typeof y=="number")return R!==null?null:a(u,m,""+y,w);if(typeof y=="object"&&y!==null){switch(y.$$typeof){case Nl:return y.key===R?l(u,m,y,w):null;case Rs:return y.key===R?c(u,m,y,w):null;case lr:return R=y._init,h(u,m,R(y._payload),w)}if(qo(y)||Bo(y))return R!==null?null:d(u,m,y,w,null);Zl(u,y)}return null}function p(u,m,y,w,R){if(typeof w=="string"&&w!==""||typeof w=="number")return u=u.get(y)||null,a(m,u,""+w,R);if(typeof w=="object"&&w!==null){switch(w.$$typeof){case Nl:return u=u.get(w.key===null?y:w.key)||null,l(m,u,w,R);case Rs:return u=u.get(w.key===null?y:w.key)||null,c(m,u,w,R);case lr:var E=w._init;return p(u,m,y,E(w._payload),R)}if(qo(w)||Bo(w))return u=u.get(y)||null,d(m,u,w,R,null);Zl(m,w)}return null}function x(u,m,y,w){for(var R=null,E=null,A=m,g=m=0,b=null;A!==null&&g<y.length;g++){A.index>g?(b=A,A=null):b=A.sibling;var I=h(u,A,y[g],w);if(I===null){A===null&&(A=b);break}t&&A&&I.alternate===null&&e(u,A),m=s(I,m,g),E===null?R=I:E.sibling=I,E=I,A=b}if(g===y.length)return n(u,A),Et&&$r(u,g),R;if(A===null){for(;g<y.length;g++)A=f(u,y[g],w),A!==null&&(m=s(A,m,g),E===null?R=A:E.sibling=A,E=A);return Et&&$r(u,g),R}for(A=i(u,A);g<y.length;g++)b=p(A,u,g,y[g],w),b!==null&&(t&&b.alternate!==null&&A.delete(b.key===null?g:b.key),m=s(b,m,g),E===null?R=b:E.sibling=b,E=b);return t&&A.forEach(function(P){return e(u,P)}),Et&&$r(u,g),R}function M(u,m,y,w){var R=Bo(y);if(typeof R!="function")throw Error(ie(150));if(y=R.call(y),y==null)throw Error(ie(151));for(var E=R=null,A=m,g=m=0,b=null,I=y.next();A!==null&&!I.done;g++,I=y.next()){A.index>g?(b=A,A=null):b=A.sibling;var P=h(u,A,I.value,w);if(P===null){A===null&&(A=b);break}t&&A&&P.alternate===null&&e(u,A),m=s(P,m,g),E===null?R=P:E.sibling=P,E=P,A=b}if(I.done)return n(u,A),Et&&$r(u,g),R;if(A===null){for(;!I.done;g++,I=y.next())I=f(u,I.value,w),I!==null&&(m=s(I,m,g),E===null?R=I:E.sibling=I,E=I);return Et&&$r(u,g),R}for(A=i(u,A);!I.done;g++,I=y.next())I=p(A,u,g,I.value,w),I!==null&&(t&&I.alternate!==null&&A.delete(I.key===null?g:I.key),m=s(I,m,g),E===null?R=I:E.sibling=I,E=I);return t&&A.forEach(function(N){return e(u,N)}),Et&&$r(u,g),R}function _(u,m,y,w){if(typeof y=="object"&&y!==null&&y.type===Ps&&y.key===null&&(y=y.props.children),typeof y=="object"&&y!==null){switch(y.$$typeof){case Nl:e:{for(var R=y.key,E=m;E!==null;){if(E.key===R){if(R=y.type,R===Ps){if(E.tag===7){n(u,E.sibling),m=r(E,y.props.children),m.return=u,u=m;break e}}else if(E.elementType===R||typeof R=="object"&&R!==null&&R.$$typeof===lr&&c0(R)===E.type){n(u,E.sibling),m=r(E,y.props),m.ref=Go(u,E,y),m.return=u,u=m;break e}n(u,E);break}else e(u,E);E=E.sibling}y.type===Ps?(m=ts(y.props.children,u.mode,w,y.key),m.return=u,u=m):(w=ac(y.type,y.key,y.props,null,u.mode,w),w.ref=Go(u,m,y),w.return=u,u=w)}return o(u);case Rs:e:{for(E=y.key;m!==null;){if(m.key===E)if(m.tag===4&&m.stateNode.containerInfo===y.containerInfo&&m.stateNode.implementation===y.implementation){n(u,m.sibling),m=r(m,y.children||[]),m.return=u,u=m;break e}else{n(u,m);break}else e(u,m);m=m.sibling}m=Od(y,u.mode,w),m.return=u,u=m}return o(u);case lr:return E=y._init,_(u,m,E(y._payload),w)}if(qo(y))return x(u,m,y,w);if(Bo(y))return M(u,m,y,w);Zl(u,y)}return typeof y=="string"&&y!==""||typeof y=="number"?(y=""+y,m!==null&&m.tag===6?(n(u,m.sibling),m=r(m,y),m.return=u,u=m):(n(u,m),m=Fd(y,u.mode,w),m.return=u,u=m),o(u)):n(u,m)}return _}var Js=N_(!0),D_=N_(!1),Sc=Tr(null),Mc=null,Bs=null,Jf=null;function Kf(){Jf=Bs=Mc=null}function jf(t){var e=Sc.current;St(Sc),t._currentValue=e}function pf(t,e,n){for(;t!==null;){var i=t.alternate;if((t.childLanes&e)!==e?(t.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),t===n)break;t=t.return}}function Xs(t,e){Mc=t,Jf=Bs=null,t=t.dependencies,t!==null&&t.firstContext!==null&&(t.lanes&e&&(Mn=!0),t.firstContext=null)}function qn(t){var e=t._currentValue;if(Jf!==t)if(t={context:t,memoizedValue:e,next:null},Bs===null){if(Mc===null)throw Error(ie(308));Bs=t,Mc.dependencies={lanes:0,firstContext:t}}else Bs=Bs.next=t;return e}var jr=null;function Qf(t){jr===null?jr=[t]:jr.push(t)}function U_(t,e,n,i){var r=e.interleaved;return r===null?(n.next=n,Qf(e)):(n.next=r.next,r.next=n),e.interleaved=n,Xi(t,i)}function Xi(t,e){t.lanes|=e;var n=t.alternate;for(n!==null&&(n.lanes|=e),n=t,t=t.return;t!==null;)t.childLanes|=e,n=t.alternate,n!==null&&(n.childLanes|=e),n=t,t=t.return;return n.tag===3?n.stateNode:null}var cr=!1;function ep(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function F_(t,e){t=t.updateQueue,e.updateQueue===t&&(e.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,effects:t.effects})}function Gi(t,e){return{eventTime:t,lane:e,tag:0,payload:null,callback:null,next:null}}function vr(t,e,n){var i=t.updateQueue;if(i===null)return null;if(i=i.shared,it&2){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,Xi(t,n)}return r=i.interleaved,r===null?(e.next=e,Qf(i)):(e.next=r.next,r.next=e),i.interleaved=e,Xi(t,n)}function tc(t,e,n){if(e=e.updateQueue,e!==null&&(e=e.shared,(n&4194240)!==0)){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,kf(t,n)}}function u0(t,e){var n=t.updateQueue,i=t.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var r=null,s=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};s===null?r=s=o:s=s.next=o,n=n.next}while(n!==null);s===null?r=s=e:s=s.next=e}else r=s=e;n={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},t.updateQueue=n;return}t=n.lastBaseUpdate,t===null?n.firstBaseUpdate=e:t.next=e,n.lastBaseUpdate=e}function wc(t,e,n,i){var r=t.updateQueue;cr=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,c=l.next;l.next=null,o===null?s=c:o.next=c,o=l;var d=t.alternate;d!==null&&(d=d.updateQueue,a=d.lastBaseUpdate,a!==o&&(a===null?d.firstBaseUpdate=c:a.next=c,d.lastBaseUpdate=l))}if(s!==null){var f=r.baseState;o=0,d=c=l=null,a=s;do{var h=a.lane,p=a.eventTime;if((i&h)===h){d!==null&&(d=d.next={eventTime:p,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var x=t,M=a;switch(h=e,p=n,M.tag){case 1:if(x=M.payload,typeof x=="function"){f=x.call(p,f,h);break e}f=x;break e;case 3:x.flags=x.flags&-65537|128;case 0:if(x=M.payload,h=typeof x=="function"?x.call(p,f,h):x,h==null)break e;f=Rt({},f,h);break e;case 2:cr=!0}}a.callback!==null&&a.lane!==0&&(t.flags|=64,h=r.effects,h===null?r.effects=[a]:h.push(a))}else p={eventTime:p,lane:h,tag:a.tag,payload:a.payload,callback:a.callback,next:null},d===null?(c=d=p,l=f):d=d.next=p,o|=h;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;h=a,a=h.next,h.next=null,r.lastBaseUpdate=h,r.shared.pending=null}}while(!0);if(d===null&&(l=f),r.baseState=l,r.firstBaseUpdate=c,r.lastBaseUpdate=d,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);ss|=o,t.lanes=o,t.memoizedState=f}}function h0(t,e,n){if(t=e.effects,e.effects=null,t!==null)for(e=0;e<t.length;e++){var i=t[e],r=i.callback;if(r!==null){if(i.callback=null,i=n,typeof r!="function")throw Error(ie(191,r));r.call(i)}}}var Ta={},wi=Tr(Ta),ga=Tr(Ta),_a=Tr(Ta);function Qr(t){if(t===Ta)throw Error(ie(174));return t}function tp(t,e){switch(xt(_a,e),xt(ga,t),xt(wi,Ta),t=e.nodeType,t){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:qd(null,"");break;default:t=t===8?e.parentNode:e,e=t.namespaceURI||null,t=t.tagName,e=qd(e,t)}St(wi),xt(wi,e)}function Ks(){St(wi),St(ga),St(_a)}function O_(t){Qr(_a.current);var e=Qr(wi.current),n=qd(e,t.type);e!==n&&(xt(ga,t),xt(wi,n))}function np(t){ga.current===t&&(St(wi),St(ga))}var At=Tr(0);function Ec(t){for(var e=t;e!==null;){if(e.tag===13){var n=e.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data==="$?"||n.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if(e.flags&128)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var Pd=[];function ip(){for(var t=0;t<Pd.length;t++)Pd[t]._workInProgressVersionPrimary=null;Pd.length=0}var nc=qi.ReactCurrentDispatcher,Id=qi.ReactCurrentBatchConfig,rs=0,Ct=null,kt=null,Ht=null,Tc=!1,ta=!1,va=0,mM=0;function rn(){throw Error(ie(321))}function rp(t,e){if(e===null)return!1;for(var n=0;n<e.length&&n<t.length;n++)if(!oi(t[n],e[n]))return!1;return!0}function sp(t,e,n,i,r,s){if(rs=s,Ct=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,nc.current=t===null||t.memoizedState===null?xM:yM,t=n(i,r),ta){s=0;do{if(ta=!1,va=0,25<=s)throw Error(ie(301));s+=1,Ht=kt=null,e.updateQueue=null,nc.current=SM,t=n(i,r)}while(ta)}if(nc.current=bc,e=kt!==null&&kt.next!==null,rs=0,Ht=kt=Ct=null,Tc=!1,e)throw Error(ie(300));return t}function op(){var t=va!==0;return va=0,t}function yi(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return Ht===null?Ct.memoizedState=Ht=t:Ht=Ht.next=t,Ht}function Zn(){if(kt===null){var t=Ct.alternate;t=t!==null?t.memoizedState:null}else t=kt.next;var e=Ht===null?Ct.memoizedState:Ht.next;if(e!==null)Ht=e,kt=t;else{if(t===null)throw Error(ie(310));kt=t,t={memoizedState:kt.memoizedState,baseState:kt.baseState,baseQueue:kt.baseQueue,queue:kt.queue,next:null},Ht===null?Ct.memoizedState=Ht=t:Ht=Ht.next=t}return Ht}function xa(t,e){return typeof e=="function"?e(t):e}function Ld(t){var e=Zn(),n=e.queue;if(n===null)throw Error(ie(311));n.lastRenderedReducer=t;var i=kt,r=i.baseQueue,s=n.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,n.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,c=s;do{var d=c.lane;if((rs&d)===d)l!==null&&(l=l.next={lane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),i=c.hasEagerState?c.eagerState:t(i,c.action);else{var f={lane:d,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null};l===null?(a=l=f,o=i):l=l.next=f,Ct.lanes|=d,ss|=d}c=c.next}while(c!==null&&c!==s);l===null?o=i:l.next=a,oi(i,e.memoizedState)||(Mn=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,n.lastRenderedState=i}if(t=n.interleaved,t!==null){r=t;do s=r.lane,Ct.lanes|=s,ss|=s,r=r.next;while(r!==t)}else r===null&&(n.lanes=0);return[e.memoizedState,n.dispatch]}function Nd(t){var e=Zn(),n=e.queue;if(n===null)throw Error(ie(311));n.lastRenderedReducer=t;var i=n.dispatch,r=n.pending,s=e.memoizedState;if(r!==null){n.pending=null;var o=r=r.next;do s=t(s,o.action),o=o.next;while(o!==r);oi(s,e.memoizedState)||(Mn=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),n.lastRenderedState=s}return[s,i]}function B_(){}function k_(t,e){var n=Ct,i=Zn(),r=e(),s=!oi(i.memoizedState,r);if(s&&(i.memoizedState=r,Mn=!0),i=i.queue,ap(G_.bind(null,n,i,t),[t]),i.getSnapshot!==e||s||Ht!==null&&Ht.memoizedState.tag&1){if(n.flags|=2048,ya(9,V_.bind(null,n,i,r,e),void 0,null),Wt===null)throw Error(ie(349));rs&30||z_(n,e,r)}return r}function z_(t,e,n){t.flags|=16384,t={getSnapshot:e,value:n},e=Ct.updateQueue,e===null?(e={lastEffect:null,stores:null},Ct.updateQueue=e,e.stores=[t]):(n=e.stores,n===null?e.stores=[t]:n.push(t))}function V_(t,e,n,i){e.value=n,e.getSnapshot=i,H_(e)&&W_(t)}function G_(t,e,n){return n(function(){H_(e)&&W_(t)})}function H_(t){var e=t.getSnapshot;t=t.value;try{var n=e();return!oi(t,n)}catch{return!0}}function W_(t){var e=Xi(t,1);e!==null&&si(e,t,1,-1)}function d0(t){var e=yi();return typeof t=="function"&&(t=t()),e.memoizedState=e.baseState=t,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:xa,lastRenderedState:t},e.queue=t,t=t.dispatch=vM.bind(null,Ct,t),[e.memoizedState,t]}function ya(t,e,n,i){return t={tag:t,create:e,destroy:n,deps:i,next:null},e=Ct.updateQueue,e===null?(e={lastEffect:null,stores:null},Ct.updateQueue=e,e.lastEffect=t.next=t):(n=e.lastEffect,n===null?e.lastEffect=t.next=t:(i=n.next,n.next=t,t.next=i,e.lastEffect=t)),t}function X_(){return Zn().memoizedState}function ic(t,e,n,i){var r=yi();Ct.flags|=t,r.memoizedState=ya(1|e,n,void 0,i===void 0?null:i)}function Bc(t,e,n,i){var r=Zn();i=i===void 0?null:i;var s=void 0;if(kt!==null){var o=kt.memoizedState;if(s=o.destroy,i!==null&&rp(i,o.deps)){r.memoizedState=ya(e,n,s,i);return}}Ct.flags|=t,r.memoizedState=ya(1|e,n,s,i)}function f0(t,e){return ic(8390656,8,t,e)}function ap(t,e){return Bc(2048,8,t,e)}function Y_(t,e){return Bc(4,2,t,e)}function q_(t,e){return Bc(4,4,t,e)}function Z_(t,e){if(typeof e=="function")return t=t(),e(t),function(){e(null)};if(e!=null)return t=t(),e.current=t,function(){e.current=null}}function $_(t,e,n){return n=n!=null?n.concat([t]):null,Bc(4,4,Z_.bind(null,e,t),n)}function lp(){}function J_(t,e){var n=Zn();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&rp(e,i[1])?i[0]:(n.memoizedState=[t,e],t)}function K_(t,e){var n=Zn();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&rp(e,i[1])?i[0]:(t=t(),n.memoizedState=[t,e],t)}function j_(t,e,n){return rs&21?(oi(n,e)||(n=i_(),Ct.lanes|=n,ss|=n,t.baseState=!0),e):(t.baseState&&(t.baseState=!1,Mn=!0),t.memoizedState=n)}function gM(t,e){var n=ht;ht=n!==0&&4>n?n:4,t(!0);var i=Id.transition;Id.transition={};try{t(!1),e()}finally{ht=n,Id.transition=i}}function Q_(){return Zn().memoizedState}function _M(t,e,n){var i=yr(t);if(n={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null},ev(t))tv(e,n);else if(n=U_(t,e,n,i),n!==null){var r=mn();si(n,t,i,r),nv(n,e,i)}}function vM(t,e,n){var i=yr(t),r={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null};if(ev(t))tv(e,r);else{var s=t.alternate;if(t.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,n);if(r.hasEagerState=!0,r.eagerState=a,oi(a,o)){var l=e.interleaved;l===null?(r.next=r,Qf(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}n=U_(t,e,r,i),n!==null&&(r=mn(),si(n,t,i,r),nv(n,e,i))}}function ev(t){var e=t.alternate;return t===Ct||e!==null&&e===Ct}function tv(t,e){ta=Tc=!0;var n=t.pending;n===null?e.next=e:(e.next=n.next,n.next=e),t.pending=e}function nv(t,e,n){if(n&4194240){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,kf(t,n)}}var bc={readContext:qn,useCallback:rn,useContext:rn,useEffect:rn,useImperativeHandle:rn,useInsertionEffect:rn,useLayoutEffect:rn,useMemo:rn,useReducer:rn,useRef:rn,useState:rn,useDebugValue:rn,useDeferredValue:rn,useTransition:rn,useMutableSource:rn,useSyncExternalStore:rn,useId:rn,unstable_isNewReconciler:!1},xM={readContext:qn,useCallback:function(t,e){return yi().memoizedState=[t,e===void 0?null:e],t},useContext:qn,useEffect:f0,useImperativeHandle:function(t,e,n){return n=n!=null?n.concat([t]):null,ic(4194308,4,Z_.bind(null,e,t),n)},useLayoutEffect:function(t,e){return ic(4194308,4,t,e)},useInsertionEffect:function(t,e){return ic(4,2,t,e)},useMemo:function(t,e){var n=yi();return e=e===void 0?null:e,t=t(),n.memoizedState=[t,e],t},useReducer:function(t,e,n){var i=yi();return e=n!==void 0?n(e):e,i.memoizedState=i.baseState=e,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:e},i.queue=t,t=t.dispatch=_M.bind(null,Ct,t),[i.memoizedState,t]},useRef:function(t){var e=yi();return t={current:t},e.memoizedState=t},useState:d0,useDebugValue:lp,useDeferredValue:function(t){return yi().memoizedState=t},useTransition:function(){var t=d0(!1),e=t[0];return t=gM.bind(null,t[1]),yi().memoizedState=t,[e,t]},useMutableSource:function(){},useSyncExternalStore:function(t,e,n){var i=Ct,r=yi();if(Et){if(n===void 0)throw Error(ie(407));n=n()}else{if(n=e(),Wt===null)throw Error(ie(349));rs&30||z_(i,e,n)}r.memoizedState=n;var s={value:n,getSnapshot:e};return r.queue=s,f0(G_.bind(null,i,s,t),[t]),i.flags|=2048,ya(9,V_.bind(null,i,s,n,e),void 0,null),n},useId:function(){var t=yi(),e=Wt.identifierPrefix;if(Et){var n=Vi,i=zi;n=(i&~(1<<32-ri(i)-1)).toString(32)+n,e=":"+e+"R"+n,n=va++,0<n&&(e+="H"+n.toString(32)),e+=":"}else n=mM++,e=":"+e+"r"+n.toString(32)+":";return t.memoizedState=e},unstable_isNewReconciler:!1},yM={readContext:qn,useCallback:J_,useContext:qn,useEffect:ap,useImperativeHandle:$_,useInsertionEffect:Y_,useLayoutEffect:q_,useMemo:K_,useReducer:Ld,useRef:X_,useState:function(){return Ld(xa)},useDebugValue:lp,useDeferredValue:function(t){var e=Zn();return j_(e,kt.memoizedState,t)},useTransition:function(){var t=Ld(xa)[0],e=Zn().memoizedState;return[t,e]},useMutableSource:B_,useSyncExternalStore:k_,useId:Q_,unstable_isNewReconciler:!1},SM={readContext:qn,useCallback:J_,useContext:qn,useEffect:ap,useImperativeHandle:$_,useInsertionEffect:Y_,useLayoutEffect:q_,useMemo:K_,useReducer:Nd,useRef:X_,useState:function(){return Nd(xa)},useDebugValue:lp,useDeferredValue:function(t){var e=Zn();return kt===null?e.memoizedState=t:j_(e,kt.memoizedState,t)},useTransition:function(){var t=Nd(xa)[0],e=Zn().memoizedState;return[t,e]},useMutableSource:B_,useSyncExternalStore:k_,useId:Q_,unstable_isNewReconciler:!1};function ti(t,e){if(t&&t.defaultProps){e=Rt({},e),t=t.defaultProps;for(var n in t)e[n]===void 0&&(e[n]=t[n]);return e}return e}function mf(t,e,n,i){e=t.memoizedState,n=n(i,e),n=n==null?e:Rt({},e,n),t.memoizedState=n,t.lanes===0&&(t.updateQueue.baseState=n)}var kc={isMounted:function(t){return(t=t._reactInternals)?ls(t)===t:!1},enqueueSetState:function(t,e,n){t=t._reactInternals;var i=mn(),r=yr(t),s=Gi(i,r);s.payload=e,n!=null&&(s.callback=n),e=vr(t,s,r),e!==null&&(si(e,t,r,i),tc(e,t,r))},enqueueReplaceState:function(t,e,n){t=t._reactInternals;var i=mn(),r=yr(t),s=Gi(i,r);s.tag=1,s.payload=e,n!=null&&(s.callback=n),e=vr(t,s,r),e!==null&&(si(e,t,r,i),tc(e,t,r))},enqueueForceUpdate:function(t,e){t=t._reactInternals;var n=mn(),i=yr(t),r=Gi(n,i);r.tag=2,e!=null&&(r.callback=e),e=vr(t,r,i),e!==null&&(si(e,t,i,n),tc(e,t,i))}};function p0(t,e,n,i,r,s,o){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!da(n,i)||!da(r,s):!0}function iv(t,e,n){var i=!1,r=wr,s=e.contextType;return typeof s=="object"&&s!==null?s=qn(s):(r=En(e)?ns:an.current,i=e.contextTypes,s=(i=i!=null)?Zs(t,r):wr),e=new e(n,s),t.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=kc,t.stateNode=e,e._reactInternals=t,i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=r,t.__reactInternalMemoizedMaskedChildContext=s),e}function m0(t,e,n,i){t=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(n,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(n,i),e.state!==t&&kc.enqueueReplaceState(e,e.state,null)}function gf(t,e,n,i){var r=t.stateNode;r.props=n,r.state=t.memoizedState,r.refs={},ep(t);var s=e.contextType;typeof s=="object"&&s!==null?r.context=qn(s):(s=En(e)?ns:an.current,r.context=Zs(t,s)),r.state=t.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(mf(t,e,s,n),r.state=t.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&kc.enqueueReplaceState(r,r.state,null),wc(t,n,r,i),r.state=t.memoizedState),typeof r.componentDidMount=="function"&&(t.flags|=4194308)}function js(t,e){try{var n="",i=e;do n+=Ky(i),i=i.return;while(i);var r=n}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:t,source:e,stack:r,digest:null}}function Dd(t,e,n){return{value:t,source:null,stack:n??null,digest:e??null}}function _f(t,e){try{console.error(e.value)}catch(n){setTimeout(function(){throw n})}}var MM=typeof WeakMap=="function"?WeakMap:Map;function rv(t,e,n){n=Gi(-1,n),n.tag=3,n.payload={element:null};var i=e.value;return n.callback=function(){Cc||(Cc=!0,Af=i),_f(t,e)},n}function sv(t,e,n){n=Gi(-1,n),n.tag=3;var i=t.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;n.payload=function(){return i(r)},n.callback=function(){_f(t,e)}}var s=t.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(n.callback=function(){_f(t,e),typeof i!="function"&&(xr===null?xr=new Set([this]):xr.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),n}function g0(t,e,n){var i=t.pingCache;if(i===null){i=t.pingCache=new MM;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(n)||(r.add(n),t=FM.bind(null,t,e,n),e.then(t,t))}function _0(t){do{var e;if((e=t.tag===13)&&(e=t.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return t;t=t.return}while(t!==null);return null}function v0(t,e,n,i,r){return t.mode&1?(t.flags|=65536,t.lanes=r,t):(t===e?t.flags|=65536:(t.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(e=Gi(-1,1),e.tag=2,vr(n,e,1))),n.lanes|=1),t)}var wM=qi.ReactCurrentOwner,Mn=!1;function pn(t,e,n,i){e.child=t===null?D_(e,null,n,i):Js(e,t.child,n,i)}function x0(t,e,n,i,r){n=n.render;var s=e.ref;return Xs(e,r),i=sp(t,e,n,i,s,r),n=op(),t!==null&&!Mn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,Yi(t,e,r)):(Et&&n&&qf(e),e.flags|=1,pn(t,e,i,r),e.child)}function y0(t,e,n,i,r){if(t===null){var s=n.type;return typeof s=="function"&&!gp(s)&&s.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(e.tag=15,e.type=s,ov(t,e,s,i,r)):(t=ac(n.type,null,i,e,e.mode,r),t.ref=e.ref,t.return=e,e.child=t)}if(s=t.child,!(t.lanes&r)){var o=s.memoizedProps;if(n=n.compare,n=n!==null?n:da,n(o,i)&&t.ref===e.ref)return Yi(t,e,r)}return e.flags|=1,t=Sr(s,i),t.ref=e.ref,t.return=e,e.child=t}function ov(t,e,n,i,r){if(t!==null){var s=t.memoizedProps;if(da(s,i)&&t.ref===e.ref)if(Mn=!1,e.pendingProps=i=s,(t.lanes&r)!==0)t.flags&131072&&(Mn=!0);else return e.lanes=t.lanes,Yi(t,e,r)}return vf(t,e,n,i,r)}function av(t,e,n){var i=e.pendingProps,r=i.children,s=t!==null?t.memoizedState:null;if(i.mode==="hidden")if(!(e.mode&1))e.memoizedState={baseLanes:0,cachePool:null,transitions:null},xt(zs,Pn),Pn|=n;else{if(!(n&1073741824))return t=s!==null?s.baseLanes|n:n,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:t,cachePool:null,transitions:null},e.updateQueue=null,xt(zs,Pn),Pn|=t,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:n,xt(zs,Pn),Pn|=i}else s!==null?(i=s.baseLanes|n,e.memoizedState=null):i=n,xt(zs,Pn),Pn|=i;return pn(t,e,r,n),e.child}function lv(t,e){var n=e.ref;(t===null&&n!==null||t!==null&&t.ref!==n)&&(e.flags|=512,e.flags|=2097152)}function vf(t,e,n,i,r){var s=En(n)?ns:an.current;return s=Zs(e,s),Xs(e,r),n=sp(t,e,n,i,s,r),i=op(),t!==null&&!Mn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,Yi(t,e,r)):(Et&&i&&qf(e),e.flags|=1,pn(t,e,n,r),e.child)}function S0(t,e,n,i,r){if(En(n)){var s=!0;vc(e)}else s=!1;if(Xs(e,r),e.stateNode===null)rc(t,e),iv(e,n,i),gf(e,n,i,r),i=!0;else if(t===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,c=n.contextType;typeof c=="object"&&c!==null?c=qn(c):(c=En(n)?ns:an.current,c=Zs(e,c));var d=n.getDerivedStateFromProps,f=typeof d=="function"||typeof o.getSnapshotBeforeUpdate=="function";f||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==c)&&m0(e,o,i,c),cr=!1;var h=e.memoizedState;o.state=h,wc(e,i,o,r),l=e.memoizedState,a!==i||h!==l||wn.current||cr?(typeof d=="function"&&(mf(e,n,d,i),l=e.memoizedState),(a=cr||p0(e,n,a,i,h,l,c))?(f||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=c,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,F_(t,e),a=e.memoizedProps,c=e.type===e.elementType?a:ti(e.type,a),o.props=c,f=e.pendingProps,h=o.context,l=n.contextType,typeof l=="object"&&l!==null?l=qn(l):(l=En(n)?ns:an.current,l=Zs(e,l));var p=n.getDerivedStateFromProps;(d=typeof p=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==f||h!==l)&&m0(e,o,i,l),cr=!1,h=e.memoizedState,o.state=h,wc(e,i,o,r);var x=e.memoizedState;a!==f||h!==x||wn.current||cr?(typeof p=="function"&&(mf(e,n,p,i),x=e.memoizedState),(c=cr||p0(e,n,c,i,h,x,l)||!1)?(d||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,x,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,x,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=x),o.props=i,o.state=x,o.context=l,i=c):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),i=!1)}return xf(t,e,n,i,s,r)}function xf(t,e,n,i,r,s){lv(t,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&o0(e,n,!1),Yi(t,e,s);i=e.stateNode,wM.current=e;var a=o&&typeof n.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,t!==null&&o?(e.child=Js(e,t.child,null,s),e.child=Js(e,null,a,s)):pn(t,e,a,s),e.memoizedState=i.state,r&&o0(e,n,!0),e.child}function cv(t){var e=t.stateNode;e.pendingContext?s0(t,e.pendingContext,e.pendingContext!==e.context):e.context&&s0(t,e.context,!1),tp(t,e.containerInfo)}function M0(t,e,n,i,r){return $s(),$f(r),e.flags|=256,pn(t,e,n,i),e.child}var yf={dehydrated:null,treeContext:null,retryLane:0};function Sf(t){return{baseLanes:t,cachePool:null,transitions:null}}function uv(t,e,n){var i=e.pendingProps,r=At.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=t!==null&&t.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(t===null||t.memoizedState!==null)&&(r|=1),xt(At,r&1),t===null)return ff(e),t=e.memoizedState,t!==null&&(t=t.dehydrated,t!==null)?(e.mode&1?t.data==="$!"?e.lanes=8:e.lanes=1073741824:e.lanes=1,null):(o=i.children,t=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},!(i&1)&&s!==null?(s.childLanes=0,s.pendingProps=o):s=Gc(o,i,0,null),t=ts(t,i,n,null),s.return=e,t.return=e,s.sibling=t,e.child=s,e.child.memoizedState=Sf(n),e.memoizedState=yf,t):cp(e,o));if(r=t.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return EM(t,e,o,i,a,r,n);if(s){s=i.fallback,o=e.mode,r=t.child,a=r.sibling;var l={mode:"hidden",children:i.children};return!(o&1)&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=Sr(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=Sr(a,s):(s=ts(s,o,n,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=t.child.memoizedState,o=o===null?Sf(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=t.childLanes&~n,e.memoizedState=yf,i}return s=t.child,t=s.sibling,i=Sr(s,{mode:"visible",children:i.children}),!(e.mode&1)&&(i.lanes=n),i.return=e,i.sibling=null,t!==null&&(n=e.deletions,n===null?(e.deletions=[t],e.flags|=16):n.push(t)),e.child=i,e.memoizedState=null,i}function cp(t,e){return e=Gc({mode:"visible",children:e},t.mode,0,null),e.return=t,t.child=e}function $l(t,e,n,i){return i!==null&&$f(i),Js(e,t.child,null,n),t=cp(e,e.pendingProps.children),t.flags|=2,e.memoizedState=null,t}function EM(t,e,n,i,r,s,o){if(n)return e.flags&256?(e.flags&=-257,i=Dd(Error(ie(422))),$l(t,e,o,i)):e.memoizedState!==null?(e.child=t.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=Gc({mode:"visible",children:i.children},r,0,null),s=ts(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,e.mode&1&&Js(e,t.child,null,o),e.child.memoizedState=Sf(o),e.memoizedState=yf,s);if(!(e.mode&1))return $l(t,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(ie(419)),i=Dd(s,i,void 0),$l(t,e,o,i)}if(a=(o&t.childLanes)!==0,Mn||a){if(i=Wt,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=r&(i.suspendedLanes|o)?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,Xi(t,r),si(i,t,r,-1))}return mp(),i=Dd(Error(ie(421))),$l(t,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=t.child,e=OM.bind(null,t),r._reactRetry=e,null):(t=s.treeContext,In=_r(r.nextSibling),Ln=e,Et=!0,ii=null,t!==null&&(Hn[Wn++]=zi,Hn[Wn++]=Vi,Hn[Wn++]=is,zi=t.id,Vi=t.overflow,is=e),e=cp(e,i.children),e.flags|=4096,e)}function w0(t,e,n){t.lanes|=e;var i=t.alternate;i!==null&&(i.lanes|=e),pf(t.return,e,n)}function Ud(t,e,n,i,r){var s=t.memoizedState;s===null?t.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=n,s.tailMode=r)}function hv(t,e,n){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(pn(t,e,i.children,n),i=At.current,i&2)i=i&1|2,e.flags|=128;else{if(t!==null&&t.flags&128)e:for(t=e.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&w0(t,n,e);else if(t.tag===19)w0(t,n,e);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break e;for(;t.sibling===null;){if(t.return===null||t.return===e)break e;t=t.return}t.sibling.return=t.return,t=t.sibling}i&=1}if(xt(At,i),!(e.mode&1))e.memoizedState=null;else switch(r){case"forwards":for(n=e.child,r=null;n!==null;)t=n.alternate,t!==null&&Ec(t)===null&&(r=n),n=n.sibling;n=r,n===null?(r=e.child,e.child=null):(r=n.sibling,n.sibling=null),Ud(e,!1,r,n,s);break;case"backwards":for(n=null,r=e.child,e.child=null;r!==null;){if(t=r.alternate,t!==null&&Ec(t)===null){e.child=r;break}t=r.sibling,r.sibling=n,n=r,r=t}Ud(e,!0,n,null,s);break;case"together":Ud(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function rc(t,e){!(e.mode&1)&&t!==null&&(t.alternate=null,e.alternate=null,e.flags|=2)}function Yi(t,e,n){if(t!==null&&(e.dependencies=t.dependencies),ss|=e.lanes,!(n&e.childLanes))return null;if(t!==null&&e.child!==t.child)throw Error(ie(153));if(e.child!==null){for(t=e.child,n=Sr(t,t.pendingProps),e.child=n,n.return=e;t.sibling!==null;)t=t.sibling,n=n.sibling=Sr(t,t.pendingProps),n.return=e;n.sibling=null}return e.child}function TM(t,e,n){switch(e.tag){case 3:cv(e),$s();break;case 5:O_(e);break;case 1:En(e.type)&&vc(e);break;case 4:tp(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;xt(Sc,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(xt(At,At.current&1),e.flags|=128,null):n&e.child.childLanes?uv(t,e,n):(xt(At,At.current&1),t=Yi(t,e,n),t!==null?t.sibling:null);xt(At,At.current&1);break;case 19:if(i=(n&e.childLanes)!==0,t.flags&128){if(i)return hv(t,e,n);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),xt(At,At.current),i)break;return null;case 22:case 23:return e.lanes=0,av(t,e,n)}return Yi(t,e,n)}var dv,Mf,fv,pv;dv=function(t,e){for(var n=e.child;n!==null;){if(n.tag===5||n.tag===6)t.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return;n=n.return}n.sibling.return=n.return,n=n.sibling}};Mf=function(){};fv=function(t,e,n,i){var r=t.memoizedProps;if(r!==i){t=e.stateNode,Qr(wi.current);var s=null;switch(n){case"input":r=Hd(t,r),i=Hd(t,i),s=[];break;case"select":r=Rt({},r,{value:void 0}),i=Rt({},i,{value:void 0}),s=[];break;case"textarea":r=Yd(t,r),i=Yd(t,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(t.onclick=gc)}Zd(n,i);var o;n=null;for(c in r)if(!i.hasOwnProperty(c)&&r.hasOwnProperty(c)&&r[c]!=null)if(c==="style"){var a=r[c];for(o in a)a.hasOwnProperty(o)&&(n||(n={}),n[o]="")}else c!=="dangerouslySetInnerHTML"&&c!=="children"&&c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&c!=="autoFocus"&&(sa.hasOwnProperty(c)?s||(s=[]):(s=s||[]).push(c,null));for(c in i){var l=i[c];if(a=r!=null?r[c]:void 0,i.hasOwnProperty(c)&&l!==a&&(l!=null||a!=null))if(c==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(n||(n={}),n[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(n||(n={}),n[o]=l[o])}else n||(s||(s=[]),s.push(c,n)),n=l;else c==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(c,l)):c==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(c,""+l):c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&(sa.hasOwnProperty(c)?(l!=null&&c==="onScroll"&&yt("scroll",t),s||a===l||(s=[])):(s=s||[]).push(c,l))}n&&(s=s||[]).push("style",n);var c=s;(e.updateQueue=c)&&(e.flags|=4)}};pv=function(t,e,n,i){n!==i&&(e.flags|=4)};function Ho(t,e){if(!Et)switch(t.tailMode){case"hidden":e=t.tail;for(var n=null;e!==null;)e.alternate!==null&&(n=e),e=e.sibling;n===null?t.tail=null:n.sibling=null;break;case"collapsed":n=t.tail;for(var i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?e||t.tail===null?t.tail=null:t.tail.sibling=null:i.sibling=null}}function sn(t){var e=t.alternate!==null&&t.alternate.child===t.child,n=0,i=0;if(e)for(var r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=t,r=r.sibling;else for(r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=t,r=r.sibling;return t.subtreeFlags|=i,t.childLanes=n,e}function bM(t,e,n){var i=e.pendingProps;switch(Zf(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return sn(e),null;case 1:return En(e.type)&&_c(),sn(e),null;case 3:return i=e.stateNode,Ks(),St(wn),St(an),ip(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(t===null||t.child===null)&&(ql(e)?e.flags|=4:t===null||t.memoizedState.isDehydrated&&!(e.flags&256)||(e.flags|=1024,ii!==null&&(Pf(ii),ii=null))),Mf(t,e),sn(e),null;case 5:np(e);var r=Qr(_a.current);if(n=e.type,t!==null&&e.stateNode!=null)fv(t,e,n,i,r),t.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(ie(166));return sn(e),null}if(t=Qr(wi.current),ql(e)){i=e.stateNode,n=e.type;var s=e.memoizedProps;switch(i[Si]=e,i[ma]=s,t=(e.mode&1)!==0,n){case"dialog":yt("cancel",i),yt("close",i);break;case"iframe":case"object":case"embed":yt("load",i);break;case"video":case"audio":for(r=0;r<$o.length;r++)yt($o[r],i);break;case"source":yt("error",i);break;case"img":case"image":case"link":yt("error",i),yt("load",i);break;case"details":yt("toggle",i);break;case"input":Ig(i,s),yt("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},yt("invalid",i);break;case"textarea":Ng(i,s),yt("invalid",i)}Zd(n,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&Yl(i.textContent,a,t),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&Yl(i.textContent,a,t),r=["children",""+a]):sa.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&yt("scroll",i)}switch(n){case"input":Dl(i),Lg(i,s,!0);break;case"textarea":Dl(i),Dg(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=gc)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,t==="http://www.w3.org/1999/xhtml"&&(t=G0(n)),t==="http://www.w3.org/1999/xhtml"?n==="script"?(t=o.createElement("div"),t.innerHTML="<script><\/script>",t=t.removeChild(t.firstChild)):typeof i.is=="string"?t=o.createElement(n,{is:i.is}):(t=o.createElement(n),n==="select"&&(o=t,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):t=o.createElementNS(t,n),t[Si]=e,t[ma]=i,dv(t,e,!1,!1),e.stateNode=t;e:{switch(o=$d(n,i),n){case"dialog":yt("cancel",t),yt("close",t),r=i;break;case"iframe":case"object":case"embed":yt("load",t),r=i;break;case"video":case"audio":for(r=0;r<$o.length;r++)yt($o[r],t);r=i;break;case"source":yt("error",t),r=i;break;case"img":case"image":case"link":yt("error",t),yt("load",t),r=i;break;case"details":yt("toggle",t),r=i;break;case"input":Ig(t,i),r=Hd(t,i),yt("invalid",t);break;case"option":r=i;break;case"select":t._wrapperState={wasMultiple:!!i.multiple},r=Rt({},i,{value:void 0}),yt("invalid",t);break;case"textarea":Ng(t,i),r=Yd(t,i),yt("invalid",t);break;default:r=i}Zd(n,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?X0(t,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&H0(t,l)):s==="children"?typeof l=="string"?(n!=="textarea"||l!=="")&&oa(t,l):typeof l=="number"&&oa(t,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(sa.hasOwnProperty(s)?l!=null&&s==="onScroll"&&yt("scroll",t):l!=null&&Nf(t,s,l,o))}switch(n){case"input":Dl(t),Lg(t,i,!1);break;case"textarea":Dl(t),Dg(t);break;case"option":i.value!=null&&t.setAttribute("value",""+Mr(i.value));break;case"select":t.multiple=!!i.multiple,s=i.value,s!=null?Vs(t,!!i.multiple,s,!1):i.defaultValue!=null&&Vs(t,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(t.onclick=gc)}switch(n){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return sn(e),null;case 6:if(t&&e.stateNode!=null)pv(t,e,t.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(ie(166));if(n=Qr(_a.current),Qr(wi.current),ql(e)){if(i=e.stateNode,n=e.memoizedProps,i[Si]=e,(s=i.nodeValue!==n)&&(t=Ln,t!==null))switch(t.tag){case 3:Yl(i.nodeValue,n,(t.mode&1)!==0);break;case 5:t.memoizedProps.suppressHydrationWarning!==!0&&Yl(i.nodeValue,n,(t.mode&1)!==0)}s&&(e.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[Si]=e,e.stateNode=i}return sn(e),null;case 13:if(St(At),i=e.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(Et&&In!==null&&e.mode&1&&!(e.flags&128))L_(),$s(),e.flags|=98560,s=!1;else if(s=ql(e),i!==null&&i.dehydrated!==null){if(t===null){if(!s)throw Error(ie(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(ie(317));s[Si]=e}else $s(),!(e.flags&128)&&(e.memoizedState=null),e.flags|=4;sn(e),s=!1}else ii!==null&&(Pf(ii),ii=null),s=!0;if(!s)return e.flags&65536?e:null}return e.flags&128?(e.lanes=n,e):(i=i!==null,i!==(t!==null&&t.memoizedState!==null)&&i&&(e.child.flags|=8192,e.mode&1&&(t===null||At.current&1?zt===0&&(zt=3):mp())),e.updateQueue!==null&&(e.flags|=4),sn(e),null);case 4:return Ks(),Mf(t,e),t===null&&fa(e.stateNode.containerInfo),sn(e),null;case 10:return jf(e.type._context),sn(e),null;case 17:return En(e.type)&&_c(),sn(e),null;case 19:if(St(At),s=e.memoizedState,s===null)return sn(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)Ho(s,!1);else{if(zt!==0||t!==null&&t.flags&128)for(t=e.child;t!==null;){if(o=Ec(t),o!==null){for(e.flags|=128,Ho(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=n,n=e.child;n!==null;)s=n,t=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=t,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,t=o.dependencies,s.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext}),n=n.sibling;return xt(At,At.current&1|2),e.child}t=t.sibling}s.tail!==null&&Dt()>Qs&&(e.flags|=128,i=!0,Ho(s,!1),e.lanes=4194304)}else{if(!i)if(t=Ec(o),t!==null){if(e.flags|=128,i=!0,n=t.updateQueue,n!==null&&(e.updateQueue=n,e.flags|=4),Ho(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!Et)return sn(e),null}else 2*Dt()-s.renderingStartTime>Qs&&n!==1073741824&&(e.flags|=128,i=!0,Ho(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(n=s.last,n!==null?n.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=Dt(),e.sibling=null,n=At.current,xt(At,i?n&1|2:n&1),e):(sn(e),null);case 22:case 23:return pp(),i=e.memoizedState!==null,t!==null&&t.memoizedState!==null!==i&&(e.flags|=8192),i&&e.mode&1?Pn&1073741824&&(sn(e),e.subtreeFlags&6&&(e.flags|=8192)):sn(e),null;case 24:return null;case 25:return null}throw Error(ie(156,e.tag))}function AM(t,e){switch(Zf(e),e.tag){case 1:return En(e.type)&&_c(),t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 3:return Ks(),St(wn),St(an),ip(),t=e.flags,t&65536&&!(t&128)?(e.flags=t&-65537|128,e):null;case 5:return np(e),null;case 13:if(St(At),t=e.memoizedState,t!==null&&t.dehydrated!==null){if(e.alternate===null)throw Error(ie(340));$s()}return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 19:return St(At),null;case 4:return Ks(),null;case 10:return jf(e.type._context),null;case 22:case 23:return pp(),null;case 24:return null;default:return null}}var Jl=!1,on=!1,CM=typeof WeakSet=="function"?WeakSet:Set,Ee=null;function ks(t,e){var n=t.ref;if(n!==null)if(typeof n=="function")try{n(null)}catch(i){Lt(t,e,i)}else n.current=null}function wf(t,e,n){try{n()}catch(i){Lt(t,e,i)}}var E0=!1;function RM(t,e){if(of=fc,t=x_(),Yf(t)){if("selectionStart"in t)var n={start:t.selectionStart,end:t.selectionEnd};else e:{n=(n=t.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{n.nodeType,s.nodeType}catch{n=null;break e}var o=0,a=-1,l=-1,c=0,d=0,f=t,h=null;t:for(;;){for(var p;f!==n||r!==0&&f.nodeType!==3||(a=o+r),f!==s||i!==0&&f.nodeType!==3||(l=o+i),f.nodeType===3&&(o+=f.nodeValue.length),(p=f.firstChild)!==null;)h=f,f=p;for(;;){if(f===t)break t;if(h===n&&++c===r&&(a=o),h===s&&++d===i&&(l=o),(p=f.nextSibling)!==null)break;f=h,h=f.parentNode}f=p}n=a===-1||l===-1?null:{start:a,end:l}}else n=null}n=n||{start:0,end:0}}else n=null;for(af={focusedElem:t,selectionRange:n},fc=!1,Ee=e;Ee!==null;)if(e=Ee,t=e.child,(e.subtreeFlags&1028)!==0&&t!==null)t.return=e,Ee=t;else for(;Ee!==null;){e=Ee;try{var x=e.alternate;if(e.flags&1024)switch(e.tag){case 0:case 11:case 15:break;case 1:if(x!==null){var M=x.memoizedProps,_=x.memoizedState,u=e.stateNode,m=u.getSnapshotBeforeUpdate(e.elementType===e.type?M:ti(e.type,M),_);u.__reactInternalSnapshotBeforeUpdate=m}break;case 3:var y=e.stateNode.containerInfo;y.nodeType===1?y.textContent="":y.nodeType===9&&y.documentElement&&y.removeChild(y.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(ie(163))}}catch(w){Lt(e,e.return,w)}if(t=e.sibling,t!==null){t.return=e.return,Ee=t;break}Ee=e.return}return x=E0,E0=!1,x}function na(t,e,n){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&t)===t){var s=r.destroy;r.destroy=void 0,s!==void 0&&wf(e,n,s)}r=r.next}while(r!==i)}}function zc(t,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var n=e=e.next;do{if((n.tag&t)===t){var i=n.create;n.destroy=i()}n=n.next}while(n!==e)}}function Ef(t){var e=t.ref;if(e!==null){var n=t.stateNode;switch(t.tag){case 5:t=n;break;default:t=n}typeof e=="function"?e(t):e.current=t}}function mv(t){var e=t.alternate;e!==null&&(t.alternate=null,mv(e)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(e=t.stateNode,e!==null&&(delete e[Si],delete e[ma],delete e[uf],delete e[hM],delete e[dM])),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}function gv(t){return t.tag===5||t.tag===3||t.tag===4}function T0(t){e:for(;;){for(;t.sibling===null;){if(t.return===null||gv(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.flags&2||t.child===null||t.tag===4)continue e;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function Tf(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.nodeType===8?n.parentNode.insertBefore(t,e):n.insertBefore(t,e):(n.nodeType===8?(e=n.parentNode,e.insertBefore(t,n)):(e=n,e.appendChild(t)),n=n._reactRootContainer,n!=null||e.onclick!==null||(e.onclick=gc));else if(i!==4&&(t=t.child,t!==null))for(Tf(t,e,n),t=t.sibling;t!==null;)Tf(t,e,n),t=t.sibling}function bf(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.insertBefore(t,e):n.appendChild(t);else if(i!==4&&(t=t.child,t!==null))for(bf(t,e,n),t=t.sibling;t!==null;)bf(t,e,n),t=t.sibling}var Zt=null,ni=!1;function ar(t,e,n){for(n=n.child;n!==null;)_v(t,e,n),n=n.sibling}function _v(t,e,n){if(Mi&&typeof Mi.onCommitFiberUnmount=="function")try{Mi.onCommitFiberUnmount(Lc,n)}catch{}switch(n.tag){case 5:on||ks(n,e);case 6:var i=Zt,r=ni;Zt=null,ar(t,e,n),Zt=i,ni=r,Zt!==null&&(ni?(t=Zt,n=n.stateNode,t.nodeType===8?t.parentNode.removeChild(n):t.removeChild(n)):Zt.removeChild(n.stateNode));break;case 18:Zt!==null&&(ni?(t=Zt,n=n.stateNode,t.nodeType===8?Cd(t.parentNode,n):t.nodeType===1&&Cd(t,n),ua(t)):Cd(Zt,n.stateNode));break;case 4:i=Zt,r=ni,Zt=n.stateNode.containerInfo,ni=!0,ar(t,e,n),Zt=i,ni=r;break;case 0:case 11:case 14:case 15:if(!on&&(i=n.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&(s&2||s&4)&&wf(n,e,o),r=r.next}while(r!==i)}ar(t,e,n);break;case 1:if(!on&&(ks(n,e),i=n.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=n.memoizedProps,i.state=n.memoizedState,i.componentWillUnmount()}catch(a){Lt(n,e,a)}ar(t,e,n);break;case 21:ar(t,e,n);break;case 22:n.mode&1?(on=(i=on)||n.memoizedState!==null,ar(t,e,n),on=i):ar(t,e,n);break;default:ar(t,e,n)}}function b0(t){var e=t.updateQueue;if(e!==null){t.updateQueue=null;var n=t.stateNode;n===null&&(n=t.stateNode=new CM),e.forEach(function(i){var r=BM.bind(null,t,i);n.has(i)||(n.add(i),i.then(r,r))})}}function ei(t,e){var n=e.deletions;if(n!==null)for(var i=0;i<n.length;i++){var r=n[i];try{var s=t,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:Zt=a.stateNode,ni=!1;break e;case 3:Zt=a.stateNode.containerInfo,ni=!0;break e;case 4:Zt=a.stateNode.containerInfo,ni=!0;break e}a=a.return}if(Zt===null)throw Error(ie(160));_v(s,o,r),Zt=null,ni=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(c){Lt(r,e,c)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)vv(e,t),e=e.sibling}function vv(t,e){var n=t.alternate,i=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:if(ei(e,t),xi(t),i&4){try{na(3,t,t.return),zc(3,t)}catch(M){Lt(t,t.return,M)}try{na(5,t,t.return)}catch(M){Lt(t,t.return,M)}}break;case 1:ei(e,t),xi(t),i&512&&n!==null&&ks(n,n.return);break;case 5:if(ei(e,t),xi(t),i&512&&n!==null&&ks(n,n.return),t.flags&32){var r=t.stateNode;try{oa(r,"")}catch(M){Lt(t,t.return,M)}}if(i&4&&(r=t.stateNode,r!=null)){var s=t.memoizedProps,o=n!==null?n.memoizedProps:s,a=t.type,l=t.updateQueue;if(t.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&z0(r,s),$d(a,o);var c=$d(a,s);for(o=0;o<l.length;o+=2){var d=l[o],f=l[o+1];d==="style"?X0(r,f):d==="dangerouslySetInnerHTML"?H0(r,f):d==="children"?oa(r,f):Nf(r,d,f,c)}switch(a){case"input":Wd(r,s);break;case"textarea":V0(r,s);break;case"select":var h=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var p=s.value;p!=null?Vs(r,!!s.multiple,p,!1):h!==!!s.multiple&&(s.defaultValue!=null?Vs(r,!!s.multiple,s.defaultValue,!0):Vs(r,!!s.multiple,s.multiple?[]:"",!1))}r[ma]=s}catch(M){Lt(t,t.return,M)}}break;case 6:if(ei(e,t),xi(t),i&4){if(t.stateNode===null)throw Error(ie(162));r=t.stateNode,s=t.memoizedProps;try{r.nodeValue=s}catch(M){Lt(t,t.return,M)}}break;case 3:if(ei(e,t),xi(t),i&4&&n!==null&&n.memoizedState.isDehydrated)try{ua(e.containerInfo)}catch(M){Lt(t,t.return,M)}break;case 4:ei(e,t),xi(t);break;case 13:ei(e,t),xi(t),r=t.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(dp=Dt())),i&4&&b0(t);break;case 22:if(d=n!==null&&n.memoizedState!==null,t.mode&1?(on=(c=on)||d,ei(e,t),on=c):ei(e,t),xi(t),i&8192){if(c=t.memoizedState!==null,(t.stateNode.isHidden=c)&&!d&&t.mode&1)for(Ee=t,d=t.child;d!==null;){for(f=Ee=d;Ee!==null;){switch(h=Ee,p=h.child,h.tag){case 0:case 11:case 14:case 15:na(4,h,h.return);break;case 1:ks(h,h.return);var x=h.stateNode;if(typeof x.componentWillUnmount=="function"){i=h,n=h.return;try{e=i,x.props=e.memoizedProps,x.state=e.memoizedState,x.componentWillUnmount()}catch(M){Lt(i,n,M)}}break;case 5:ks(h,h.return);break;case 22:if(h.memoizedState!==null){C0(f);continue}}p!==null?(p.return=h,Ee=p):C0(f)}d=d.sibling}e:for(d=null,f=t;;){if(f.tag===5){if(d===null){d=f;try{r=f.stateNode,c?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=f.stateNode,l=f.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=W0("display",o))}catch(M){Lt(t,t.return,M)}}}else if(f.tag===6){if(d===null)try{f.stateNode.nodeValue=c?"":f.memoizedProps}catch(M){Lt(t,t.return,M)}}else if((f.tag!==22&&f.tag!==23||f.memoizedState===null||f===t)&&f.child!==null){f.child.return=f,f=f.child;continue}if(f===t)break e;for(;f.sibling===null;){if(f.return===null||f.return===t)break e;d===f&&(d=null),f=f.return}d===f&&(d=null),f.sibling.return=f.return,f=f.sibling}}break;case 19:ei(e,t),xi(t),i&4&&b0(t);break;case 21:break;default:ei(e,t),xi(t)}}function xi(t){var e=t.flags;if(e&2){try{e:{for(var n=t.return;n!==null;){if(gv(n)){var i=n;break e}n=n.return}throw Error(ie(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(oa(r,""),i.flags&=-33);var s=T0(t);bf(t,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=T0(t);Tf(t,a,o);break;default:throw Error(ie(161))}}catch(l){Lt(t,t.return,l)}t.flags&=-3}e&4096&&(t.flags&=-4097)}function PM(t,e,n){Ee=t,xv(t,e,n)}function xv(t,e,n){for(var i=(t.mode&1)!==0;Ee!==null;){var r=Ee,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||Jl;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||on;a=Jl;var c=on;if(Jl=o,(on=l)&&!c)for(Ee=r;Ee!==null;)o=Ee,l=o.child,o.tag===22&&o.memoizedState!==null?R0(r):l!==null?(l.return=o,Ee=l):R0(r);for(;s!==null;)Ee=s,xv(s,e,n),s=s.sibling;Ee=r,Jl=a,on=c}A0(t,e,n)}else r.subtreeFlags&8772&&s!==null?(s.return=r,Ee=s):A0(t,e,n)}}function A0(t){for(;Ee!==null;){var e=Ee;if(e.flags&8772){var n=e.alternate;try{if(e.flags&8772)switch(e.tag){case 0:case 11:case 15:on||zc(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!on)if(n===null)i.componentDidMount();else{var r=e.elementType===e.type?n.memoizedProps:ti(e.type,n.memoizedProps);i.componentDidUpdate(r,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&h0(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(n=null,e.child!==null)switch(e.child.tag){case 5:n=e.child.stateNode;break;case 1:n=e.child.stateNode}h0(e,o,n)}break;case 5:var a=e.stateNode;if(n===null&&e.flags&4){n=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&n.focus();break;case"img":l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var c=e.alternate;if(c!==null){var d=c.memoizedState;if(d!==null){var f=d.dehydrated;f!==null&&ua(f)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(ie(163))}on||e.flags&512&&Ef(e)}catch(h){Lt(e,e.return,h)}}if(e===t){Ee=null;break}if(n=e.sibling,n!==null){n.return=e.return,Ee=n;break}Ee=e.return}}function C0(t){for(;Ee!==null;){var e=Ee;if(e===t){Ee=null;break}var n=e.sibling;if(n!==null){n.return=e.return,Ee=n;break}Ee=e.return}}function R0(t){for(;Ee!==null;){var e=Ee;try{switch(e.tag){case 0:case 11:case 15:var n=e.return;try{zc(4,e)}catch(l){Lt(e,n,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){Lt(e,r,l)}}var s=e.return;try{Ef(e)}catch(l){Lt(e,s,l)}break;case 5:var o=e.return;try{Ef(e)}catch(l){Lt(e,o,l)}}}catch(l){Lt(e,e.return,l)}if(e===t){Ee=null;break}var a=e.sibling;if(a!==null){a.return=e.return,Ee=a;break}Ee=e.return}}var IM=Math.ceil,Ac=qi.ReactCurrentDispatcher,up=qi.ReactCurrentOwner,Yn=qi.ReactCurrentBatchConfig,it=0,Wt=null,Ft=null,$t=0,Pn=0,zs=Tr(0),zt=0,Sa=null,ss=0,Vc=0,hp=0,ia=null,Sn=null,dp=0,Qs=1/0,Bi=null,Cc=!1,Af=null,xr=null,Kl=!1,fr=null,Rc=0,ra=0,Cf=null,sc=-1,oc=0;function mn(){return it&6?Dt():sc!==-1?sc:sc=Dt()}function yr(t){return t.mode&1?it&2&&$t!==0?$t&-$t:pM.transition!==null?(oc===0&&(oc=i_()),oc):(t=ht,t!==0||(t=window.event,t=t===void 0?16:u_(t.type)),t):1}function si(t,e,n,i){if(50<ra)throw ra=0,Cf=null,Error(ie(185));Ma(t,n,i),(!(it&2)||t!==Wt)&&(t===Wt&&(!(it&2)&&(Vc|=n),zt===4&&hr(t,$t)),Tn(t,i),n===1&&it===0&&!(e.mode&1)&&(Qs=Dt()+500,Oc&&br()))}function Tn(t,e){var n=t.callbackNode;gS(t,e);var i=dc(t,t===Wt?$t:0);if(i===0)n!==null&&Og(n),t.callbackNode=null,t.callbackPriority=0;else if(e=i&-i,t.callbackPriority!==e){if(n!=null&&Og(n),e===1)t.tag===0?fM(P0.bind(null,t)):R_(P0.bind(null,t)),cM(function(){!(it&6)&&br()}),n=null;else{switch(r_(i)){case 1:n=Bf;break;case 4:n=t_;break;case 16:n=hc;break;case 536870912:n=n_;break;default:n=hc}n=Av(n,yv.bind(null,t))}t.callbackPriority=e,t.callbackNode=n}}function yv(t,e){if(sc=-1,oc=0,it&6)throw Error(ie(327));var n=t.callbackNode;if(Ys()&&t.callbackNode!==n)return null;var i=dc(t,t===Wt?$t:0);if(i===0)return null;if(i&30||i&t.expiredLanes||e)e=Pc(t,i);else{e=i;var r=it;it|=2;var s=Mv();(Wt!==t||$t!==e)&&(Bi=null,Qs=Dt()+500,es(t,e));do try{DM();break}catch(a){Sv(t,a)}while(!0);Kf(),Ac.current=s,it=r,Ft!==null?e=0:(Wt=null,$t=0,e=zt)}if(e!==0){if(e===2&&(r=ef(t),r!==0&&(i=r,e=Rf(t,r))),e===1)throw n=Sa,es(t,0),hr(t,i),Tn(t,Dt()),n;if(e===6)hr(t,i);else{if(r=t.current.alternate,!(i&30)&&!LM(r)&&(e=Pc(t,i),e===2&&(s=ef(t),s!==0&&(i=s,e=Rf(t,s))),e===1))throw n=Sa,es(t,0),hr(t,i),Tn(t,Dt()),n;switch(t.finishedWork=r,t.finishedLanes=i,e){case 0:case 1:throw Error(ie(345));case 2:Jr(t,Sn,Bi);break;case 3:if(hr(t,i),(i&130023424)===i&&(e=dp+500-Dt(),10<e)){if(dc(t,0)!==0)break;if(r=t.suspendedLanes,(r&i)!==i){mn(),t.pingedLanes|=t.suspendedLanes&r;break}t.timeoutHandle=cf(Jr.bind(null,t,Sn,Bi),e);break}Jr(t,Sn,Bi);break;case 4:if(hr(t,i),(i&4194240)===i)break;for(e=t.eventTimes,r=-1;0<i;){var o=31-ri(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=Dt()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*IM(i/1960))-i,10<i){t.timeoutHandle=cf(Jr.bind(null,t,Sn,Bi),i);break}Jr(t,Sn,Bi);break;case 5:Jr(t,Sn,Bi);break;default:throw Error(ie(329))}}}return Tn(t,Dt()),t.callbackNode===n?yv.bind(null,t):null}function Rf(t,e){var n=ia;return t.current.memoizedState.isDehydrated&&(es(t,e).flags|=256),t=Pc(t,e),t!==2&&(e=Sn,Sn=n,e!==null&&Pf(e)),t}function Pf(t){Sn===null?Sn=t:Sn.push.apply(Sn,t)}function LM(t){for(var e=t;;){if(e.flags&16384){var n=e.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var i=0;i<n.length;i++){var r=n[i],s=r.getSnapshot;r=r.value;try{if(!oi(s(),r))return!1}catch{return!1}}}if(n=e.child,e.subtreeFlags&16384&&n!==null)n.return=e,e=n;else{if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function hr(t,e){for(e&=~hp,e&=~Vc,t.suspendedLanes|=e,t.pingedLanes&=~e,t=t.expirationTimes;0<e;){var n=31-ri(e),i=1<<n;t[n]=-1,e&=~i}}function P0(t){if(it&6)throw Error(ie(327));Ys();var e=dc(t,0);if(!(e&1))return Tn(t,Dt()),null;var n=Pc(t,e);if(t.tag!==0&&n===2){var i=ef(t);i!==0&&(e=i,n=Rf(t,i))}if(n===1)throw n=Sa,es(t,0),hr(t,e),Tn(t,Dt()),n;if(n===6)throw Error(ie(345));return t.finishedWork=t.current.alternate,t.finishedLanes=e,Jr(t,Sn,Bi),Tn(t,Dt()),null}function fp(t,e){var n=it;it|=1;try{return t(e)}finally{it=n,it===0&&(Qs=Dt()+500,Oc&&br())}}function os(t){fr!==null&&fr.tag===0&&!(it&6)&&Ys();var e=it;it|=1;var n=Yn.transition,i=ht;try{if(Yn.transition=null,ht=1,t)return t()}finally{ht=i,Yn.transition=n,it=e,!(it&6)&&br()}}function pp(){Pn=zs.current,St(zs)}function es(t,e){t.finishedWork=null,t.finishedLanes=0;var n=t.timeoutHandle;if(n!==-1&&(t.timeoutHandle=-1,lM(n)),Ft!==null)for(n=Ft.return;n!==null;){var i=n;switch(Zf(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&_c();break;case 3:Ks(),St(wn),St(an),ip();break;case 5:np(i);break;case 4:Ks();break;case 13:St(At);break;case 19:St(At);break;case 10:jf(i.type._context);break;case 22:case 23:pp()}n=n.return}if(Wt=t,Ft=t=Sr(t.current,null),$t=Pn=e,zt=0,Sa=null,hp=Vc=ss=0,Sn=ia=null,jr!==null){for(e=0;e<jr.length;e++)if(n=jr[e],i=n.interleaved,i!==null){n.interleaved=null;var r=i.next,s=n.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}n.pending=i}jr=null}return t}function Sv(t,e){do{var n=Ft;try{if(Kf(),nc.current=bc,Tc){for(var i=Ct.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}Tc=!1}if(rs=0,Ht=kt=Ct=null,ta=!1,va=0,up.current=null,n===null||n.return===null){zt=1,Sa=e,Ft=null;break}e:{var s=t,o=n.return,a=n,l=e;if(e=$t,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var c=l,d=a,f=d.tag;if(!(d.mode&1)&&(f===0||f===11||f===15)){var h=d.alternate;h?(d.updateQueue=h.updateQueue,d.memoizedState=h.memoizedState,d.lanes=h.lanes):(d.updateQueue=null,d.memoizedState=null)}var p=_0(o);if(p!==null){p.flags&=-257,v0(p,o,a,s,e),p.mode&1&&g0(s,c,e),e=p,l=c;var x=e.updateQueue;if(x===null){var M=new Set;M.add(l),e.updateQueue=M}else x.add(l);break e}else{if(!(e&1)){g0(s,c,e),mp();break e}l=Error(ie(426))}}else if(Et&&a.mode&1){var _=_0(o);if(_!==null){!(_.flags&65536)&&(_.flags|=256),v0(_,o,a,s,e),$f(js(l,a));break e}}s=l=js(l,a),zt!==4&&(zt=2),ia===null?ia=[s]:ia.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var u=rv(s,l,e);u0(s,u);break e;case 1:a=l;var m=s.type,y=s.stateNode;if(!(s.flags&128)&&(typeof m.getDerivedStateFromError=="function"||y!==null&&typeof y.componentDidCatch=="function"&&(xr===null||!xr.has(y)))){s.flags|=65536,e&=-e,s.lanes|=e;var w=sv(s,a,e);u0(s,w);break e}}s=s.return}while(s!==null)}Ev(n)}catch(R){e=R,Ft===n&&n!==null&&(Ft=n=n.return);continue}break}while(!0)}function Mv(){var t=Ac.current;return Ac.current=bc,t===null?bc:t}function mp(){(zt===0||zt===3||zt===2)&&(zt=4),Wt===null||!(ss&268435455)&&!(Vc&268435455)||hr(Wt,$t)}function Pc(t,e){var n=it;it|=2;var i=Mv();(Wt!==t||$t!==e)&&(Bi=null,es(t,e));do try{NM();break}catch(r){Sv(t,r)}while(!0);if(Kf(),it=n,Ac.current=i,Ft!==null)throw Error(ie(261));return Wt=null,$t=0,zt}function NM(){for(;Ft!==null;)wv(Ft)}function DM(){for(;Ft!==null&&!aS();)wv(Ft)}function wv(t){var e=bv(t.alternate,t,Pn);t.memoizedProps=t.pendingProps,e===null?Ev(t):Ft=e,up.current=null}function Ev(t){var e=t;do{var n=e.alternate;if(t=e.return,e.flags&32768){if(n=AM(n,e),n!==null){n.flags&=32767,Ft=n;return}if(t!==null)t.flags|=32768,t.subtreeFlags=0,t.deletions=null;else{zt=6,Ft=null;return}}else if(n=bM(n,e,Pn),n!==null){Ft=n;return}if(e=e.sibling,e!==null){Ft=e;return}Ft=e=t}while(e!==null);zt===0&&(zt=5)}function Jr(t,e,n){var i=ht,r=Yn.transition;try{Yn.transition=null,ht=1,UM(t,e,n,i)}finally{Yn.transition=r,ht=i}return null}function UM(t,e,n,i){do Ys();while(fr!==null);if(it&6)throw Error(ie(327));n=t.finishedWork;var r=t.finishedLanes;if(n===null)return null;if(t.finishedWork=null,t.finishedLanes=0,n===t.current)throw Error(ie(177));t.callbackNode=null,t.callbackPriority=0;var s=n.lanes|n.childLanes;if(_S(t,s),t===Wt&&(Ft=Wt=null,$t=0),!(n.subtreeFlags&2064)&&!(n.flags&2064)||Kl||(Kl=!0,Av(hc,function(){return Ys(),null})),s=(n.flags&15990)!==0,n.subtreeFlags&15990||s){s=Yn.transition,Yn.transition=null;var o=ht;ht=1;var a=it;it|=4,up.current=null,RM(t,n),vv(n,t),iM(af),fc=!!of,af=of=null,t.current=n,PM(n,t,r),lS(),it=a,ht=o,Yn.transition=s}else t.current=n;if(Kl&&(Kl=!1,fr=t,Rc=r),s=t.pendingLanes,s===0&&(xr=null),hS(n.stateNode,i),Tn(t,Dt()),e!==null)for(i=t.onRecoverableError,n=0;n<e.length;n++)r=e[n],i(r.value,{componentStack:r.stack,digest:r.digest});if(Cc)throw Cc=!1,t=Af,Af=null,t;return Rc&1&&t.tag!==0&&Ys(),s=t.pendingLanes,s&1?t===Cf?ra++:(ra=0,Cf=t):ra=0,br(),null}function Ys(){if(fr!==null){var t=r_(Rc),e=Yn.transition,n=ht;try{if(Yn.transition=null,ht=16>t?16:t,fr===null)var i=!1;else{if(t=fr,fr=null,Rc=0,it&6)throw Error(ie(331));var r=it;for(it|=4,Ee=t.current;Ee!==null;){var s=Ee,o=s.child;if(Ee.flags&16){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var c=a[l];for(Ee=c;Ee!==null;){var d=Ee;switch(d.tag){case 0:case 11:case 15:na(8,d,s)}var f=d.child;if(f!==null)f.return=d,Ee=f;else for(;Ee!==null;){d=Ee;var h=d.sibling,p=d.return;if(mv(d),d===c){Ee=null;break}if(h!==null){h.return=p,Ee=h;break}Ee=p}}}var x=s.alternate;if(x!==null){var M=x.child;if(M!==null){x.child=null;do{var _=M.sibling;M.sibling=null,M=_}while(M!==null)}}Ee=s}}if(s.subtreeFlags&2064&&o!==null)o.return=s,Ee=o;else e:for(;Ee!==null;){if(s=Ee,s.flags&2048)switch(s.tag){case 0:case 11:case 15:na(9,s,s.return)}var u=s.sibling;if(u!==null){u.return=s.return,Ee=u;break e}Ee=s.return}}var m=t.current;for(Ee=m;Ee!==null;){o=Ee;var y=o.child;if(o.subtreeFlags&2064&&y!==null)y.return=o,Ee=y;else e:for(o=m;Ee!==null;){if(a=Ee,a.flags&2048)try{switch(a.tag){case 0:case 11:case 15:zc(9,a)}}catch(R){Lt(a,a.return,R)}if(a===o){Ee=null;break e}var w=a.sibling;if(w!==null){w.return=a.return,Ee=w;break e}Ee=a.return}}if(it=r,br(),Mi&&typeof Mi.onPostCommitFiberRoot=="function")try{Mi.onPostCommitFiberRoot(Lc,t)}catch{}i=!0}return i}finally{ht=n,Yn.transition=e}}return!1}function I0(t,e,n){e=js(n,e),e=rv(t,e,1),t=vr(t,e,1),e=mn(),t!==null&&(Ma(t,1,e),Tn(t,e))}function Lt(t,e,n){if(t.tag===3)I0(t,t,n);else for(;e!==null;){if(e.tag===3){I0(e,t,n);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(xr===null||!xr.has(i))){t=js(n,t),t=sv(e,t,1),e=vr(e,t,1),t=mn(),e!==null&&(Ma(e,1,t),Tn(e,t));break}}e=e.return}}function FM(t,e,n){var i=t.pingCache;i!==null&&i.delete(e),e=mn(),t.pingedLanes|=t.suspendedLanes&n,Wt===t&&($t&n)===n&&(zt===4||zt===3&&($t&130023424)===$t&&500>Dt()-dp?es(t,0):hp|=n),Tn(t,e)}function Tv(t,e){e===0&&(t.mode&1?(e=Ol,Ol<<=1,!(Ol&130023424)&&(Ol=4194304)):e=1);var n=mn();t=Xi(t,e),t!==null&&(Ma(t,e,n),Tn(t,n))}function OM(t){var e=t.memoizedState,n=0;e!==null&&(n=e.retryLane),Tv(t,n)}function BM(t,e){var n=0;switch(t.tag){case 13:var i=t.stateNode,r=t.memoizedState;r!==null&&(n=r.retryLane);break;case 19:i=t.stateNode;break;default:throw Error(ie(314))}i!==null&&i.delete(e),Tv(t,n)}var bv;bv=function(t,e,n){if(t!==null)if(t.memoizedProps!==e.pendingProps||wn.current)Mn=!0;else{if(!(t.lanes&n)&&!(e.flags&128))return Mn=!1,TM(t,e,n);Mn=!!(t.flags&131072)}else Mn=!1,Et&&e.flags&1048576&&P_(e,yc,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;rc(t,e),t=e.pendingProps;var r=Zs(e,an.current);Xs(e,n),r=sp(null,e,i,t,r,n);var s=op();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,En(i)?(s=!0,vc(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,ep(e),r.updater=kc,e.stateNode=r,r._reactInternals=e,gf(e,i,t,n),e=xf(null,e,i,!0,s,n)):(e.tag=0,Et&&s&&qf(e),pn(null,e,r,n),e=e.child),e;case 16:i=e.elementType;e:{switch(rc(t,e),t=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=zM(i),t=ti(i,t),r){case 0:e=vf(null,e,i,t,n);break e;case 1:e=S0(null,e,i,t,n);break e;case 11:e=x0(null,e,i,t,n);break e;case 14:e=y0(null,e,i,ti(i.type,t),n);break e}throw Error(ie(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:ti(i,r),vf(t,e,i,r,n);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:ti(i,r),S0(t,e,i,r,n);case 3:e:{if(cv(e),t===null)throw Error(ie(387));i=e.pendingProps,s=e.memoizedState,r=s.element,F_(t,e),wc(e,i,null,n);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=js(Error(ie(423)),e),e=M0(t,e,i,n,r);break e}else if(i!==r){r=js(Error(ie(424)),e),e=M0(t,e,i,n,r);break e}else for(In=_r(e.stateNode.containerInfo.firstChild),Ln=e,Et=!0,ii=null,n=D_(e,null,i,n),e.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if($s(),i===r){e=Yi(t,e,n);break e}pn(t,e,i,n)}e=e.child}return e;case 5:return O_(e),t===null&&ff(e),i=e.type,r=e.pendingProps,s=t!==null?t.memoizedProps:null,o=r.children,lf(i,r)?o=null:s!==null&&lf(i,s)&&(e.flags|=32),lv(t,e),pn(t,e,o,n),e.child;case 6:return t===null&&ff(e),null;case 13:return uv(t,e,n);case 4:return tp(e,e.stateNode.containerInfo),i=e.pendingProps,t===null?e.child=Js(e,null,i,n):pn(t,e,i,n),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:ti(i,r),x0(t,e,i,r,n);case 7:return pn(t,e,e.pendingProps,n),e.child;case 8:return pn(t,e,e.pendingProps.children,n),e.child;case 12:return pn(t,e,e.pendingProps.children,n),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,xt(Sc,i._currentValue),i._currentValue=o,s!==null)if(oi(s.value,o)){if(s.children===r.children&&!wn.current){e=Yi(t,e,n);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=Gi(-1,n&-n),l.tag=2;var c=s.updateQueue;if(c!==null){c=c.shared;var d=c.pending;d===null?l.next=l:(l.next=d.next,d.next=l),c.pending=l}}s.lanes|=n,l=s.alternate,l!==null&&(l.lanes|=n),pf(s.return,n,e),a.lanes|=n;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(ie(341));o.lanes|=n,a=o.alternate,a!==null&&(a.lanes|=n),pf(o,n,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}pn(t,e,r.children,n),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,Xs(e,n),r=qn(r),i=i(r),e.flags|=1,pn(t,e,i,n),e.child;case 14:return i=e.type,r=ti(i,e.pendingProps),r=ti(i.type,r),y0(t,e,i,r,n);case 15:return ov(t,e,e.type,e.pendingProps,n);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:ti(i,r),rc(t,e),e.tag=1,En(i)?(t=!0,vc(e)):t=!1,Xs(e,n),iv(e,i,r),gf(e,i,r,n),xf(null,e,i,!0,t,n);case 19:return hv(t,e,n);case 22:return av(t,e,n)}throw Error(ie(156,e.tag))};function Av(t,e){return e_(t,e)}function kM(t,e,n,i){this.tag=t,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Xn(t,e,n,i){return new kM(t,e,n,i)}function gp(t){return t=t.prototype,!(!t||!t.isReactComponent)}function zM(t){if(typeof t=="function")return gp(t)?1:0;if(t!=null){if(t=t.$$typeof,t===Uf)return 11;if(t===Ff)return 14}return 2}function Sr(t,e){var n=t.alternate;return n===null?(n=Xn(t.tag,e,t.key,t.mode),n.elementType=t.elementType,n.type=t.type,n.stateNode=t.stateNode,n.alternate=t,t.alternate=n):(n.pendingProps=e,n.type=t.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=t.flags&14680064,n.childLanes=t.childLanes,n.lanes=t.lanes,n.child=t.child,n.memoizedProps=t.memoizedProps,n.memoizedState=t.memoizedState,n.updateQueue=t.updateQueue,e=t.dependencies,n.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},n.sibling=t.sibling,n.index=t.index,n.ref=t.ref,n}function ac(t,e,n,i,r,s){var o=2;if(i=t,typeof t=="function")gp(t)&&(o=1);else if(typeof t=="string")o=5;else e:switch(t){case Ps:return ts(n.children,r,s,e);case Df:o=8,r|=8;break;case kd:return t=Xn(12,n,e,r|2),t.elementType=kd,t.lanes=s,t;case zd:return t=Xn(13,n,e,r),t.elementType=zd,t.lanes=s,t;case Vd:return t=Xn(19,n,e,r),t.elementType=Vd,t.lanes=s,t;case O0:return Gc(n,r,s,e);default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case U0:o=10;break e;case F0:o=9;break e;case Uf:o=11;break e;case Ff:o=14;break e;case lr:o=16,i=null;break e}throw Error(ie(130,t==null?t:typeof t,""))}return e=Xn(o,n,e,r),e.elementType=t,e.type=i,e.lanes=s,e}function ts(t,e,n,i){return t=Xn(7,t,i,e),t.lanes=n,t}function Gc(t,e,n,i){return t=Xn(22,t,i,e),t.elementType=O0,t.lanes=n,t.stateNode={isHidden:!1},t}function Fd(t,e,n){return t=Xn(6,t,null,e),t.lanes=n,t}function Od(t,e,n){return e=Xn(4,t.children!==null?t.children:[],t.key,e),e.lanes=n,e.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},e}function VM(t,e,n,i,r){this.tag=e,this.containerInfo=t,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=yd(0),this.expirationTimes=yd(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=yd(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function _p(t,e,n,i,r,s,o,a,l){return t=new VM(t,e,n,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=Xn(3,null,null,e),t.current=s,s.stateNode=t,s.memoizedState={element:i,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},ep(s),t}function GM(t,e,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:Rs,key:i==null?null:""+i,children:t,containerInfo:e,implementation:n}}function Cv(t){if(!t)return wr;t=t._reactInternals;e:{if(ls(t)!==t||t.tag!==1)throw Error(ie(170));var e=t;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(En(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(ie(171))}if(t.tag===1){var n=t.type;if(En(n))return C_(t,n,e)}return e}function Rv(t,e,n,i,r,s,o,a,l){return t=_p(n,i,!0,t,r,s,o,a,l),t.context=Cv(null),n=t.current,i=mn(),r=yr(n),s=Gi(i,r),s.callback=e??null,vr(n,s,r),t.current.lanes=r,Ma(t,r,i),Tn(t,i),t}function Hc(t,e,n,i){var r=e.current,s=mn(),o=yr(r);return n=Cv(n),e.context===null?e.context=n:e.pendingContext=n,e=Gi(s,o),e.payload={element:t},i=i===void 0?null:i,i!==null&&(e.callback=i),t=vr(r,e,o),t!==null&&(si(t,r,o,s),tc(t,r,o)),o}function Ic(t){if(t=t.current,!t.child)return null;switch(t.child.tag){case 5:return t.child.stateNode;default:return t.child.stateNode}}function L0(t,e){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var n=t.retryLane;t.retryLane=n!==0&&n<e?n:e}}function vp(t,e){L0(t,e),(t=t.alternate)&&L0(t,e)}function HM(){return null}var Pv=typeof reportError=="function"?reportError:function(t){console.error(t)};function xp(t){this._internalRoot=t}Wc.prototype.render=xp.prototype.render=function(t){var e=this._internalRoot;if(e===null)throw Error(ie(409));Hc(t,e,null,null)};Wc.prototype.unmount=xp.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var e=t.containerInfo;os(function(){Hc(null,t,null,null)}),e[Wi]=null}};function Wc(t){this._internalRoot=t}Wc.prototype.unstable_scheduleHydration=function(t){if(t){var e=a_();t={blockedOn:null,target:t,priority:e};for(var n=0;n<ur.length&&e!==0&&e<ur[n].priority;n++);ur.splice(n,0,t),n===0&&c_(t)}};function yp(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function Xc(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11&&(t.nodeType!==8||t.nodeValue!==" react-mount-point-unstable "))}function N0(){}function WM(t,e,n,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var c=Ic(o);s.call(c)}}var o=Rv(e,i,t,0,null,!1,!1,"",N0);return t._reactRootContainer=o,t[Wi]=o.current,fa(t.nodeType===8?t.parentNode:t),os(),o}for(;r=t.lastChild;)t.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var c=Ic(l);a.call(c)}}var l=_p(t,0,!1,null,null,!1,!1,"",N0);return t._reactRootContainer=l,t[Wi]=l.current,fa(t.nodeType===8?t.parentNode:t),os(function(){Hc(e,l,n,i)}),l}function Yc(t,e,n,i,r){var s=n._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=Ic(o);a.call(l)}}Hc(e,o,t,r)}else o=WM(n,e,t,r,i);return Ic(o)}s_=function(t){switch(t.tag){case 3:var e=t.stateNode;if(e.current.memoizedState.isDehydrated){var n=Zo(e.pendingLanes);n!==0&&(kf(e,n|1),Tn(e,Dt()),!(it&6)&&(Qs=Dt()+500,br()))}break;case 13:os(function(){var i=Xi(t,1);if(i!==null){var r=mn();si(i,t,1,r)}}),vp(t,1)}};zf=function(t){if(t.tag===13){var e=Xi(t,134217728);if(e!==null){var n=mn();si(e,t,134217728,n)}vp(t,134217728)}};o_=function(t){if(t.tag===13){var e=yr(t),n=Xi(t,e);if(n!==null){var i=mn();si(n,t,e,i)}vp(t,e)}};a_=function(){return ht};l_=function(t,e){var n=ht;try{return ht=t,e()}finally{ht=n}};Kd=function(t,e,n){switch(e){case"input":if(Wd(t,n),e=n.name,n.type==="radio"&&e!=null){for(n=t;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<n.length;e++){var i=n[e];if(i!==t&&i.form===t.form){var r=Fc(i);if(!r)throw Error(ie(90));k0(i),Wd(i,r)}}}break;case"textarea":V0(t,n);break;case"select":e=n.value,e!=null&&Vs(t,!!n.multiple,e,!1)}};Z0=fp;$0=os;var XM={usingClientEntryPoint:!1,Events:[Ea,Ds,Fc,Y0,q0,fp]},Wo={findFiberByHostInstance:Kr,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},YM={bundleType:Wo.bundleType,version:Wo.version,rendererPackageName:Wo.rendererPackageName,rendererConfig:Wo.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:qi.ReactCurrentDispatcher,findHostInstanceByFiber:function(t){return t=j0(t),t===null?null:t.stateNode},findFiberByHostInstance:Wo.findFiberByHostInstance||HM,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(Xo=__REACT_DEVTOOLS_GLOBAL_HOOK__,!Xo.isDisabled&&Xo.supportsFiber))try{Lc=Xo.inject(YM),Mi=Xo}catch{}var Xo;Un.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=XM;Un.createPortal=function(t,e){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!yp(e))throw Error(ie(200));return GM(t,e,null,n)};Un.createRoot=function(t,e){if(!yp(t))throw Error(ie(299));var n=!1,i="",r=Pv;return e!=null&&(e.unstable_strictMode===!0&&(n=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=_p(t,1,!1,null,null,n,!1,i,r),t[Wi]=e.current,fa(t.nodeType===8?t.parentNode:t),new xp(e)};Un.findDOMNode=function(t){if(t==null)return null;if(t.nodeType===1)return t;var e=t._reactInternals;if(e===void 0)throw typeof t.render=="function"?Error(ie(188)):(t=Object.keys(t).join(","),Error(ie(268,t)));return t=j0(e),t=t===null?null:t.stateNode,t};Un.flushSync=function(t){return os(t)};Un.hydrate=function(t,e,n){if(!Xc(e))throw Error(ie(200));return Yc(null,t,e,!0,n)};Un.hydrateRoot=function(t,e,n){if(!yp(t))throw Error(ie(405));var i=n!=null&&n.hydratedSources||null,r=!1,s="",o=Pv;if(n!=null&&(n.unstable_strictMode===!0&&(r=!0),n.identifierPrefix!==void 0&&(s=n.identifierPrefix),n.onRecoverableError!==void 0&&(o=n.onRecoverableError)),e=Rv(e,null,t,1,n??null,r,!1,s,o),t[Wi]=e.current,fa(t),i)for(t=0;t<i.length;t++)n=i[t],r=n._getVersion,r=r(n._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[n,r]:e.mutableSourceEagerHydrationData.push(n,r);return new Wc(e)};Un.render=function(t,e,n){if(!Xc(e))throw Error(ie(200));return Yc(null,t,e,!1,n)};Un.unmountComponentAtNode=function(t){if(!Xc(t))throw Error(ie(40));return t._reactRootContainer?(os(function(){Yc(null,null,t,!1,function(){t._reactRootContainer=null,t[Wi]=null})}),!0):!1};Un.unstable_batchedUpdates=fp;Un.unstable_renderSubtreeIntoContainer=function(t,e,n,i){if(!Xc(n))throw Error(ie(200));if(t==null||t._reactInternals===void 0)throw Error(ie(38));return Yc(t,e,n,!1,i)};Un.version="18.3.1-next-f1338f8080-20240426"});var Dv=Oi((OA,Nv)=>{"use strict";function Lv(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Lv)}catch(t){console.error(t)}}Lv(),Nv.exports=Iv()});var Fv=Oi(Sp=>{"use strict";var Uv=Dv();Sp.createRoot=Uv.createRoot,Sp.hydrateRoot=Uv.hydrateRoot;var BA});var Sy=Oi(Qh=>{"use strict";var MA=Al(),wA=Symbol.for("react.element"),EA=Symbol.for("react.fragment"),TA=Object.prototype.hasOwnProperty,bA=MA.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,AA={key:!0,ref:!0,__self:!0,__source:!0};function yy(t,e,n){var i,r={},s=null,o=null;n!==void 0&&(s=""+n),e.key!==void 0&&(s=""+e.key),e.ref!==void 0&&(o=e.ref);for(i in e)TA.call(e,i)&&!AA.hasOwnProperty(i)&&(r[i]=e[i]);if(t&&t.defaultProps)for(i in e=t.defaultProps,e)r[i]===void 0&&(r[i]=e[i]);return{$$typeof:wA,type:t,key:s,ref:o,props:r,_owner:bA.current}}Qh.Fragment=EA;Qh.jsx=yy;Qh.jsxs=yy});var jm=Oi((h3,My)=>{"use strict";My.exports=Sy()});var en=wl(Al()),wy=wl(Fv());var nh="184";var ox=0,sm=1,ax=2;var nl=1,lx=2,Eo=3,er=0,vn=1,Ii=2,Li=0,ps=1,om=2,am=3,lm=4,cx=5;var Dr=100,ux=101,hx=102,dx=103,fx=104,px=200,mx=201,gx=202,_x=203,pu=204,mu=205,vx=206,xx=207,yx=208,Sx=209,Mx=210,wx=211,Ex=212,Tx=213,bx=214,gu=0,_u=1,vu=2,ms=3,xu=4,yu=5,Su=6,Mu=7,cm=0,Ax=1,Cx=2,di=0,um=1,hm=2,dm=3,fm=4,pm=5,mm=6,gm=7;var _m=300,zr=301,xs=302,ih=303,rh=304,il=306,wu=1e3,bi=1001,Eu=1002,qt=1003,Rx=1004;var rl=1005;var jt=1006,sh=1007;var Vr=1008;var Rn=1009,vm=1010,xm=1011,To=1012,oh=1013,fi=1014,pi=1015,Ni=1016,ah=1017,lh=1018,bo=1020,ym=35902,Sm=35899,Mm=1021,wm=1022,Kn=1023,Ai=1026,Gr=1027,Em=1028,ch=1029,Hr=1030,uh=1031;var hh=1033,sl=33776,ol=33777,al=33778,ll=33779,dh=35840,fh=35841,ph=35842,mh=35843,gh=36196,_h=37492,vh=37496,xh=37488,yh=37489,cl=37490,Sh=37491,Mh=37808,wh=37809,Eh=37810,Th=37811,bh=37812,Ah=37813,Ch=37814,Rh=37815,Ph=37816,Ih=37817,Lh=37818,Nh=37819,Dh=37820,Uh=37821,Fh=36492,Oh=36494,Bh=36495,kh=36283,zh=36284,ul=36285,Vh=36286;var Na=2300,Tu=2301,fu=2302,$p=2303,Jp=2400,Kp=2401,jp=2402;var Px=3200;var Gh=0,Ix=1,ir="",Yt="srgb",Da="srgb-linear",Ua="linear",at="srgb";var fs=7680;var Qp=519,Lx=512,Nx=513,Dx=514,Hh=515,Ux=516,Fx=517,Wh=518,Ox=519,em=35044;var Tm="300 es",ui=2e3,go=2001;function qM(t){for(let e=t.length-1;e>=0;--e)if(t[e]>=65535)return!0;return!1}function ZM(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function Fa(t){return document.createElementNS("http://www.w3.org/1999/xhtml",t)}function Bx(){let t=Fa("canvas");return t.style.display="block",t}var Ov={},_o=null;function bm(...t){let e="THREE."+t.shift();_o?_o("log",e,...t):console.log(e,...t)}function kx(t){let e=t[0];if(typeof e=="string"&&e.startsWith("TSL:")){let n=t[1];n&&n.isStackTrace?t[0]+=" "+n.getLocation():t[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return t}function Le(...t){t=kx(t);let e="THREE."+t.shift();if(_o)_o("warn",e,...t);else{let n=t[0];n&&n.isStackTrace?console.warn(n.getError(e)):console.warn(e,...t)}}function De(...t){t=kx(t);let e="THREE."+t.shift();if(_o)_o("error",e,...t);else{let n=t[0];n&&n.isStackTrace?console.error(n.getError(e)):console.error(e,...t)}}function bu(...t){let e=t.join(" ");e in Ov||(Ov[e]=!0,Le(...t))}function zx(t,e,n){return new Promise(function(i,r){function s(){switch(t.clientWaitSync(e,t.SYNC_FLUSH_COMMANDS_BIT,0)){case t.WAIT_FAILED:r();break;case t.TIMEOUT_EXPIRED:setTimeout(s,n);break;default:i()}}setTimeout(s,n)})}var Vx={[gu]:_u,[vu]:Su,[xu]:Mu,[ms]:yu,[_u]:gu,[Su]:vu,[Mu]:xu,[yu]:ms},Ci=class{addEventListener(e,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(n)===-1&&i[e].push(n)}hasEventListener(e,n){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(n)!==-1}removeEventListener(e,n){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(n);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let n=this._listeners;if(n===void 0)return;let i=n[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},ln=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var Mp=Math.PI/180,Au=180/Math.PI;function hl(){let t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(ln[t&255]+ln[t>>8&255]+ln[t>>16&255]+ln[t>>24&255]+"-"+ln[e&255]+ln[e>>8&255]+"-"+ln[e>>16&15|64]+ln[e>>24&255]+"-"+ln[n&63|128]+ln[n>>8&255]+"-"+ln[n>>16&255]+ln[n>>24&255]+ln[i&255]+ln[i>>8&255]+ln[i>>16&255]+ln[i>>24&255]).toLowerCase()}function Ze(t,e,n){return Math.max(e,Math.min(n,t))}function $M(t,e){return(t%e+e)%e}function wp(t,e,n){return(1-n)*t+n*e}function ba(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return t/4294967295;case Uint16Array:return t/65535;case Uint8Array:return t/255;case Int32Array:return Math.max(t/2147483647,-1);case Int16Array:return Math.max(t/32767,-1);case Int8Array:return Math.max(t/127,-1);default:throw new Error("Invalid component type.")}}function bn(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return Math.round(t*4294967295);case Uint16Array:return Math.round(t*65535);case Uint8Array:return Math.round(t*255);case Int32Array:return Math.round(t*2147483647);case Int16Array:return Math.round(t*32767);case Int8Array:return Math.round(t*127);default:throw new Error("Invalid component type.")}}var Lm=class Lm{constructor(e=0,n=0){this.x=e,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,n){return this.x=e,this.y=n,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let n=this.x,i=this.y,r=e.elements;return this.x=r[0]*n+r[3]*i+r[6],this.y=r[1]*n+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,n){return this.x=Ze(this.x,e.x,n.x),this.y=Ze(this.y,e.y,n.y),this}clampScalar(e,n){return this.x=Ze(this.x,e,n),this.y=Ze(this.y,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ze(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Ze(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y;return n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this}rotateAround(e,n){let i=Math.cos(n),r=Math.sin(n),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};Lm.prototype.isVector2=!0;var Ce=Lm,Ri=class{constructor(e=0,n=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=n,this._z=i,this._w=r}static slerpFlat(e,n,i,r,s,o,a){let l=i[r+0],c=i[r+1],d=i[r+2],f=i[r+3],h=s[o+0],p=s[o+1],x=s[o+2],M=s[o+3];if(f!==M||l!==h||c!==p||d!==x){let _=l*h+c*p+d*x+f*M;_<0&&(h=-h,p=-p,x=-x,M=-M,_=-_);let u=1-a;if(_<.9995){let m=Math.acos(_),y=Math.sin(m);u=Math.sin(u*m)/y,a=Math.sin(a*m)/y,l=l*u+h*a,c=c*u+p*a,d=d*u+x*a,f=f*u+M*a}else{l=l*u+h*a,c=c*u+p*a,d=d*u+x*a,f=f*u+M*a;let m=1/Math.sqrt(l*l+c*c+d*d+f*f);l*=m,c*=m,d*=m,f*=m}}e[n]=l,e[n+1]=c,e[n+2]=d,e[n+3]=f}static multiplyQuaternionsFlat(e,n,i,r,s,o){let a=i[r],l=i[r+1],c=i[r+2],d=i[r+3],f=s[o],h=s[o+1],p=s[o+2],x=s[o+3];return e[n]=a*x+d*f+l*p-c*h,e[n+1]=l*x+d*h+c*f-a*p,e[n+2]=c*x+d*p+a*h-l*f,e[n+3]=d*x-a*f-l*h-c*p,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,n,i,r){return this._x=e,this._y=n,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,n=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(i/2),d=a(r/2),f=a(s/2),h=l(i/2),p=l(r/2),x=l(s/2);switch(o){case"XYZ":this._x=h*d*f+c*p*x,this._y=c*p*f-h*d*x,this._z=c*d*x+h*p*f,this._w=c*d*f-h*p*x;break;case"YXZ":this._x=h*d*f+c*p*x,this._y=c*p*f-h*d*x,this._z=c*d*x-h*p*f,this._w=c*d*f+h*p*x;break;case"ZXY":this._x=h*d*f-c*p*x,this._y=c*p*f+h*d*x,this._z=c*d*x+h*p*f,this._w=c*d*f-h*p*x;break;case"ZYX":this._x=h*d*f-c*p*x,this._y=c*p*f+h*d*x,this._z=c*d*x-h*p*f,this._w=c*d*f+h*p*x;break;case"YZX":this._x=h*d*f+c*p*x,this._y=c*p*f+h*d*x,this._z=c*d*x-h*p*f,this._w=c*d*f-h*p*x;break;case"XZY":this._x=h*d*f-c*p*x,this._y=c*p*f-h*d*x,this._z=c*d*x+h*p*f,this._w=c*d*f+h*p*x;break;default:Le("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,n){let i=n/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let n=e.elements,i=n[0],r=n[4],s=n[8],o=n[1],a=n[5],l=n[9],c=n[2],d=n[6],f=n[10],h=i+a+f;if(h>0){let p=.5/Math.sqrt(h+1);this._w=.25/p,this._x=(d-l)*p,this._y=(s-c)*p,this._z=(o-r)*p}else if(i>a&&i>f){let p=2*Math.sqrt(1+i-a-f);this._w=(d-l)/p,this._x=.25*p,this._y=(r+o)/p,this._z=(s+c)/p}else if(a>f){let p=2*Math.sqrt(1+a-i-f);this._w=(s-c)/p,this._x=(r+o)/p,this._y=.25*p,this._z=(l+d)/p}else{let p=2*Math.sqrt(1+f-i-a);this._w=(o-r)/p,this._x=(s+c)/p,this._y=(l+d)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(e,n){let i=e.dot(n)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*n.z-e.z*n.y,this._y=e.z*n.x-e.x*n.z,this._z=e.x*n.y-e.y*n.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ze(this.dot(e),-1,1)))}rotateTowards(e,n){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,n/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=n._x,l=n._y,c=n._z,d=n._w;return this._x=i*d+o*a+r*c-s*l,this._y=r*d+o*l+s*a-i*c,this._z=s*d+o*c+i*l-r*a,this._w=o*d-i*a-r*l-s*c,this._onChangeCallback(),this}slerp(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=this.dot(e);a<0&&(i=-i,r=-r,s=-s,o=-o,a=-a);let l=1-n;if(a<.9995){let c=Math.acos(a),d=Math.sin(c);l=Math.sin(l*c)/d,n=Math.sin(n*c)/d,this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this._onChangeCallback()}else this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this.normalize();return this}slerpQuaternions(e,n,i){return this.copy(e).slerp(n,i)}random(){let e=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(n),s*Math.cos(n))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,n=0){return this._x=e[n],this._y=e[n+1],this._z=e[n+2],this._w=e[n+3],this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._w,e}fromBufferAttribute(e,n){return this._x=e.getX(n),this._y=e.getY(n),this._z=e.getZ(n),this._w=e.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},Nm=class Nm{constructor(e=0,n=0,i=0){this.x=e,this.y=n,this.z=i}set(e,n,i){return i===void 0&&(i=this.z),this.x=e,this.y=n,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,n){return this.x=e.x*n.x,this.y=e.y*n.y,this.z=e.z*n.z,this}applyEuler(e){return this.applyQuaternion(Bv.setFromEuler(e))}applyAxisAngle(e,n){return this.applyQuaternion(Bv.setFromAxisAngle(e,n))}applyMatrix3(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[3]*i+s[6]*r,this.y=s[1]*n+s[4]*i+s[7]*r,this.z=s[2]*n+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*n+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*n+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*n+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*n+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let n=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*r-a*i),d=2*(a*n-s*r),f=2*(s*i-o*n);return this.x=n+l*c+o*f-a*d,this.y=i+l*d+a*c-s*f,this.z=r+l*f+s*d-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[4]*i+s[8]*r,this.y=s[1]*n+s[5]*i+s[9]*r,this.z=s[2]*n+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,n){return this.x=Ze(this.x,e.x,n.x),this.y=Ze(this.y,e.y,n.y),this.z=Ze(this.z,e.z,n.z),this}clampScalar(e,n){return this.x=Ze(this.x,e,n),this.y=Ze(this.y,e,n),this.z=Ze(this.z,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ze(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,n){let i=e.x,r=e.y,s=e.z,o=n.x,a=n.y,l=n.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let n=e.lengthSq();if(n===0)return this.set(0,0,0);let i=e.dot(this)/n;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return Ep.copy(this).projectOnVector(e),this.sub(Ep)}reflect(e){return this.sub(Ep.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Ze(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return n*n+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,n,i){let r=Math.sin(n)*e;return this.x=r*Math.sin(i),this.y=Math.cos(n)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,n,i){return this.x=e*Math.sin(n),this.y=i,this.z=e*Math.cos(n),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(e){let n=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=n,this.y=i,this.z=r,this}setFromMatrixColumn(e,n){return this.fromArray(e.elements,n*4)}setFromMatrix3Column(e,n){return this.fromArray(e.elements,n*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(e),this.y=n,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};Nm.prototype.isVector3=!0;var L=Nm,Ep=new L,Bv=new Ri,Dm=class Dm{constructor(e,n,i,r,s,o,a,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c)}set(e,n,i,r,s,o,a,l,c){let d=this.elements;return d[0]=e,d[1]=r,d[2]=a,d[3]=n,d[4]=s,d[5]=l,d[6]=i,d[7]=o,d[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(e,n,i){return e.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let n=e.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[3],l=i[6],c=i[1],d=i[4],f=i[7],h=i[2],p=i[5],x=i[8],M=r[0],_=r[3],u=r[6],m=r[1],y=r[4],w=r[7],R=r[2],E=r[5],A=r[8];return s[0]=o*M+a*m+l*R,s[3]=o*_+a*y+l*E,s[6]=o*u+a*w+l*A,s[1]=c*M+d*m+f*R,s[4]=c*_+d*y+f*E,s[7]=c*u+d*w+f*A,s[2]=h*M+p*m+x*R,s[5]=h*_+p*y+x*E,s[8]=h*u+p*w+x*A,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[3]*=e,n[6]*=e,n[1]*=e,n[4]*=e,n[7]*=e,n[2]*=e,n[5]*=e,n[8]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8];return n*o*d-n*a*c-i*s*d+i*a*l+r*s*c-r*o*l}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=d*o-a*c,h=a*l-d*s,p=c*s-o*l,x=n*f+i*h+r*p;if(x===0)return this.set(0,0,0,0,0,0,0,0,0);let M=1/x;return e[0]=f*M,e[1]=(r*c-d*i)*M,e[2]=(a*i-r*o)*M,e[3]=h*M,e[4]=(d*n-r*l)*M,e[5]=(r*s-a*n)*M,e[6]=p*M,e[7]=(i*l-c*n)*M,e[8]=(o*n-i*s)*M,this}transpose(){let e,n=this.elements;return e=n[1],n[1]=n[3],n[3]=e,e=n[2],n[2]=n[6],n[6]=e,e=n[5],n[5]=n[7],n[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let n=this.elements;return e[0]=n[0],e[1]=n[3],e[2]=n[6],e[3]=n[1],e[4]=n[4],e[5]=n[7],e[6]=n[2],e[7]=n[5],e[8]=n[8],this}setUvTransform(e,n,i,r,s,o,a){let l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*o+c*a)+o+e,-r*c,r*l,-r*(-c*o+l*a)+a+n,0,0,1),this}scale(e,n){return this.premultiply(Tp.makeScale(e,n)),this}rotate(e){return this.premultiply(Tp.makeRotation(-e)),this}translate(e,n){return this.premultiply(Tp.makeTranslation(e,n)),this}makeTranslation(e,n){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,n,0,0,1),this}makeRotation(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(e,n){return this.set(e,0,0,0,n,0,0,0,1),this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<9;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<9;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}};Dm.prototype.isMatrix3=!0;var He=Dm,Tp=new He,kv=new He().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),zv=new He().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function JM(){let t={enabled:!0,workingColorSpace:Da,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===at&&(r.r=Qi(r.r),r.g=Qi(r.g),r.b=Qi(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===at&&(r.r=mo(r.r),r.g=mo(r.g),r.b=mo(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===ir?Ua:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return bu("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),t.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return bu("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),t.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return t.define({[Da]:{primaries:e,whitePoint:i,transfer:Ua,toXYZ:kv,fromXYZ:zv,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:Yt},outputColorSpaceConfig:{drawingBufferColorSpace:Yt}},[Yt]:{primaries:e,whitePoint:i,transfer:at,toXYZ:kv,fromXYZ:zv,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:Yt}}}),t}var je=JM();function Qi(t){return t<.04045?t*.0773993808:Math.pow(t*.9478672986+.0521327014,2.4)}function mo(t){return t<.0031308?t*12.92:1.055*Math.pow(t,.41666)-.055}var no,Cu=class{static getDataURL(e,n="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{no===void 0&&(no=Fa("canvas")),no.width=e.width,no.height=e.height;let r=no.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=no}return i.toDataURL(n)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let n=Fa("canvas");n.width=e.width,n.height=e.height;let i=n.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=Qi(s[o]/255)*255;return i.putImageData(r,0,0),n}else if(e.data){let n=e.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor(Qi(n[i]/255)*255):n[i]=Qi(n[i]);return{data:n,width:e.width,height:e.height}}else return Le("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},KM=0,vo=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:KM++}),this.uuid=hl(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?e.set(n.videoWidth,n.videoHeight,0):typeof VideoFrame<"u"&&n instanceof VideoFrame?e.set(n.displayWidth,n.displayHeight,0):n!==null?e.set(n.width,n.height,n.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(bp(r[o].image)):s.push(bp(r[o]))}else s=bp(r);i.url=s}return n||(e.images[this.uuid]=i),i}};function bp(t){return typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap?Cu.getDataURL(t):t.data?{data:Array.from(t.data),width:t.width,height:t.height,type:t.data.constructor.name}:(Le("Texture: Unable to serialize Texture."),{})}var jM=0,Ap=new L,_n=class t extends Ci{constructor(e=t.DEFAULT_IMAGE,n=t.DEFAULT_MAPPING,i=bi,r=bi,s=jt,o=Vr,a=Kn,l=Rn,c=t.DEFAULT_ANISOTROPY,d=ir){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:jM++}),this.uuid=hl(),this.name="",this.source=new vo(e),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Ce(0,0),this.repeat=new Ce(1,1),this.center=new Ce(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new He,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=d,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Ap).x}get height(){return this.source.getSize(Ap).y}get depth(){return this.source.getSize(Ap).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let n in e){let i=e[n];if(i===void 0){Le(`Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Le(`Texture.setValues(): property '${n}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==_m)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case wu:e.x=e.x-Math.floor(e.x);break;case bi:e.x=e.x<0?0:1;break;case Eu:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case wu:e.y=e.y-Math.floor(e.y);break;case bi:e.y=e.y<0?0:1;break;case Eu:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};_n.DEFAULT_IMAGE=null;_n.DEFAULT_MAPPING=_m;_n.DEFAULT_ANISOTROPY=1;var Um=class Um{constructor(e=0,n=0,i=0,r=1){this.x=e,this.y=n,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,n,i,r){return this.x=e,this.y=n,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this.w=e.w+n.w,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this.w+=e.w*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this.w=e.w-n.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*n+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*n+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*n+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*n+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let n=Math.sqrt(1-e.w*e.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/n,this.y=e.y/n,this.z=e.z/n),this}setAxisAngleFromRotationMatrix(e){let n,i,r,s,l=e.elements,c=l[0],d=l[4],f=l[8],h=l[1],p=l[5],x=l[9],M=l[2],_=l[6],u=l[10];if(Math.abs(d-h)<.01&&Math.abs(f-M)<.01&&Math.abs(x-_)<.01){if(Math.abs(d+h)<.1&&Math.abs(f+M)<.1&&Math.abs(x+_)<.1&&Math.abs(c+p+u-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let y=(c+1)/2,w=(p+1)/2,R=(u+1)/2,E=(d+h)/4,A=(f+M)/4,g=(x+_)/4;return y>w&&y>R?y<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(y),r=E/i,s=A/i):w>R?w<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(w),i=E/r,s=g/r):R<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(R),i=A/s,r=g/s),this.set(i,r,s,n),this}let m=Math.sqrt((_-x)*(_-x)+(f-M)*(f-M)+(h-d)*(h-d));return Math.abs(m)<.001&&(m=1),this.x=(_-x)/m,this.y=(f-M)/m,this.z=(h-d)/m,this.w=Math.acos((c+p+u-1)/2),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,n){return this.x=Ze(this.x,e.x,n.x),this.y=Ze(this.y,e.y,n.y),this.z=Ze(this.z,e.z,n.z),this.w=Ze(this.w,e.w,n.w),this}clampScalar(e,n){return this.x=Ze(this.x,e,n),this.y=Ze(this.y,e,n),this.z=Ze(this.z,e,n),this.w=Ze(this.w,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ze(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this.w+=(e.w-this.w)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this.w=e.w+(n.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this.w=e[n+3],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e[n+3]=this.w,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this.w=e.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};Um.prototype.isVector4=!0;var It=Um,Ru=class extends Ci{constructor(e=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:jt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=n,this.depth=i.depth,this.scissor=new It(0,0,e,n),this.scissorTest=!1,this.viewport=new It(0,0,e,n),this.textures=[];let r={width:e,height:n,depth:i.depth},s=new _n(r),o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let n={minFilter:jt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(n.mapping=e.mapping),e.wrapS!==void 0&&(n.wrapS=e.wrapS),e.wrapT!==void 0&&(n.wrapT=e.wrapT),e.wrapR!==void 0&&(n.wrapR=e.wrapR),e.magFilter!==void 0&&(n.magFilter=e.magFilter),e.minFilter!==void 0&&(n.minFilter=e.minFilter),e.format!==void 0&&(n.format=e.format),e.type!==void 0&&(n.type=e.type),e.anisotropy!==void 0&&(n.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(n.colorSpace=e.colorSpace),e.flipY!==void 0&&(n.flipY=e.flipY),e.generateMipmaps!==void 0&&(n.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(n.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,n,i=1){if(this.width!==e||this.height!==n||this.depth!==i){this.width=e,this.height=n,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=n,this.textures[r].image.depth=i,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,n),this.scissor.set(0,0,e,n)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++){this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let r=Object.assign({},e.textures[n].image);this.textures[n].source=new vo(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},kn=class extends Ru{constructor(e=1,n=1,i={}){super(e,n,i),this.isWebGLRenderTarget=!0}},Oa=class extends _n{constructor(e=null,n=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=qt,this.minFilter=qt,this.wrapR=bi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var Pu=class extends _n{constructor(e=null,n=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=qt,this.minFilter=qt,this.wrapR=bi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var th=class th{constructor(e,n,i,r,s,o,a,l,c,d,f,h,p,x,M,_){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c,d,f,h,p,x,M,_)}set(e,n,i,r,s,o,a,l,c,d,f,h,p,x,M,_){let u=this.elements;return u[0]=e,u[4]=n,u[8]=i,u[12]=r,u[1]=s,u[5]=o,u[9]=a,u[13]=l,u[2]=c,u[6]=d,u[10]=f,u[14]=h,u[3]=p,u[7]=x,u[11]=M,u[15]=_,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new th().fromArray(this.elements)}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(e){let n=this.elements,i=e.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(e){let n=e.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(e,n,i){return this.determinant()===0?(e.set(1,0,0),n.set(0,1,0),i.set(0,0,1),this):(e.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(e,n,i){return this.set(e.x,n.x,i.x,0,e.y,n.y,i.y,0,e.z,n.z,i.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let n=this.elements,i=e.elements,r=1/io.setFromMatrixColumn(e,0).length(),s=1/io.setFromMatrixColumn(e,1).length(),o=1/io.setFromMatrixColumn(e,2).length();return n[0]=i[0]*r,n[1]=i[1]*r,n[2]=i[2]*r,n[3]=0,n[4]=i[4]*s,n[5]=i[5]*s,n[6]=i[6]*s,n[7]=0,n[8]=i[8]*o,n[9]=i[9]*o,n[10]=i[10]*o,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(e){let n=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),c=Math.sin(r),d=Math.cos(s),f=Math.sin(s);if(e.order==="XYZ"){let h=o*d,p=o*f,x=a*d,M=a*f;n[0]=l*d,n[4]=-l*f,n[8]=c,n[1]=p+x*c,n[5]=h-M*c,n[9]=-a*l,n[2]=M-h*c,n[6]=x+p*c,n[10]=o*l}else if(e.order==="YXZ"){let h=l*d,p=l*f,x=c*d,M=c*f;n[0]=h+M*a,n[4]=x*a-p,n[8]=o*c,n[1]=o*f,n[5]=o*d,n[9]=-a,n[2]=p*a-x,n[6]=M+h*a,n[10]=o*l}else if(e.order==="ZXY"){let h=l*d,p=l*f,x=c*d,M=c*f;n[0]=h-M*a,n[4]=-o*f,n[8]=x+p*a,n[1]=p+x*a,n[5]=o*d,n[9]=M-h*a,n[2]=-o*c,n[6]=a,n[10]=o*l}else if(e.order==="ZYX"){let h=o*d,p=o*f,x=a*d,M=a*f;n[0]=l*d,n[4]=x*c-p,n[8]=h*c+M,n[1]=l*f,n[5]=M*c+h,n[9]=p*c-x,n[2]=-c,n[6]=a*l,n[10]=o*l}else if(e.order==="YZX"){let h=o*l,p=o*c,x=a*l,M=a*c;n[0]=l*d,n[4]=M-h*f,n[8]=x*f+p,n[1]=f,n[5]=o*d,n[9]=-a*d,n[2]=-c*d,n[6]=p*f+x,n[10]=h-M*f}else if(e.order==="XZY"){let h=o*l,p=o*c,x=a*l,M=a*c;n[0]=l*d,n[4]=-f,n[8]=c*d,n[1]=h*f+M,n[5]=o*d,n[9]=p*f-x,n[2]=x*f-p,n[6]=a*d,n[10]=M*f+h}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(e){return this.compose(QM,e,e1)}lookAt(e,n,i){let r=this.elements;return Fn.subVectors(e,n),Fn.lengthSq()===0&&(Fn.z=1),Fn.normalize(),Ar.crossVectors(i,Fn),Ar.lengthSq()===0&&(Math.abs(i.z)===1?Fn.x+=1e-4:Fn.z+=1e-4,Fn.normalize(),Ar.crossVectors(i,Fn)),Ar.normalize(),qc.crossVectors(Fn,Ar),r[0]=Ar.x,r[4]=qc.x,r[8]=Fn.x,r[1]=Ar.y,r[5]=qc.y,r[9]=Fn.y,r[2]=Ar.z,r[6]=qc.z,r[10]=Fn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[4],l=i[8],c=i[12],d=i[1],f=i[5],h=i[9],p=i[13],x=i[2],M=i[6],_=i[10],u=i[14],m=i[3],y=i[7],w=i[11],R=i[15],E=r[0],A=r[4],g=r[8],b=r[12],I=r[1],P=r[5],N=r[9],F=r[13],W=r[2],z=r[6],G=r[10],H=r[14],ee=r[3],re=r[7],se=r[11],ve=r[15];return s[0]=o*E+a*I+l*W+c*ee,s[4]=o*A+a*P+l*z+c*re,s[8]=o*g+a*N+l*G+c*se,s[12]=o*b+a*F+l*H+c*ve,s[1]=d*E+f*I+h*W+p*ee,s[5]=d*A+f*P+h*z+p*re,s[9]=d*g+f*N+h*G+p*se,s[13]=d*b+f*F+h*H+p*ve,s[2]=x*E+M*I+_*W+u*ee,s[6]=x*A+M*P+_*z+u*re,s[10]=x*g+M*N+_*G+u*se,s[14]=x*b+M*F+_*H+u*ve,s[3]=m*E+y*I+w*W+R*ee,s[7]=m*A+y*P+w*z+R*re,s[11]=m*g+y*N+w*G+R*se,s[15]=m*b+y*F+w*H+R*ve,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[4]*=e,n[8]*=e,n[12]*=e,n[1]*=e,n[5]*=e,n[9]*=e,n[13]*=e,n[2]*=e,n[6]*=e,n[10]*=e,n[14]*=e,n[3]*=e,n[7]*=e,n[11]*=e,n[15]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],c=e[13],d=e[2],f=e[6],h=e[10],p=e[14],x=e[3],M=e[7],_=e[11],u=e[15],m=l*p-c*h,y=a*p-c*f,w=a*h-l*f,R=o*p-c*d,E=o*h-l*d,A=o*f-a*d;return n*(M*m-_*y+u*w)-i*(x*m-_*R+u*E)+r*(x*y-M*R+u*A)-s*(x*w-M*E+_*A)}transpose(){let e=this.elements,n;return n=e[1],e[1]=e[4],e[4]=n,n=e[2],e[2]=e[8],e[8]=n,n=e[6],e[6]=e[9],e[9]=n,n=e[3],e[3]=e[12],e[12]=n,n=e[7],e[7]=e[13],e[13]=n,n=e[11],e[11]=e[14],e[14]=n,this}setPosition(e,n,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=n,r[14]=i),this}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=e[9],h=e[10],p=e[11],x=e[12],M=e[13],_=e[14],u=e[15],m=n*a-i*o,y=n*l-r*o,w=n*c-s*o,R=i*l-r*a,E=i*c-s*a,A=r*c-s*l,g=d*M-f*x,b=d*_-h*x,I=d*u-p*x,P=f*_-h*M,N=f*u-p*M,F=h*u-p*_,W=m*F-y*N+w*P+R*I-E*b+A*g;if(W===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let z=1/W;return e[0]=(a*F-l*N+c*P)*z,e[1]=(r*N-i*F-s*P)*z,e[2]=(M*A-_*E+u*R)*z,e[3]=(h*E-f*A-p*R)*z,e[4]=(l*I-o*F-c*b)*z,e[5]=(n*F-r*I+s*b)*z,e[6]=(_*w-x*A-u*y)*z,e[7]=(d*A-h*w+p*y)*z,e[8]=(o*N-a*I+c*g)*z,e[9]=(i*I-n*N-s*g)*z,e[10]=(x*E-M*w+u*m)*z,e[11]=(f*w-d*E-p*m)*z,e[12]=(a*b-o*P-l*g)*z,e[13]=(n*P-i*b+r*g)*z,e[14]=(M*y-x*R-_*m)*z,e[15]=(d*R-f*y+h*m)*z,this}scale(e){let n=this.elements,i=e.x,r=e.y,s=e.z;return n[0]*=i,n[4]*=r,n[8]*=s,n[1]*=i,n[5]*=r,n[9]*=s,n[2]*=i,n[6]*=r,n[10]*=s,n[3]*=i,n[7]*=r,n[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,n=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(n,i,r))}makeTranslation(e,n,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(e){let n=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,n){let i=Math.cos(n),r=Math.sin(n),s=1-i,o=e.x,a=e.y,l=e.z,c=s*o,d=s*a;return this.set(c*o+i,c*a-r*l,c*l+r*a,0,c*a+r*l,d*a+i,d*l-r*o,0,c*l-r*a,d*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,n,i){return this.set(e,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,n,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,n,r,1,0,0,0,0,1),this}compose(e,n,i){let r=this.elements,s=n._x,o=n._y,a=n._z,l=n._w,c=s+s,d=o+o,f=a+a,h=s*c,p=s*d,x=s*f,M=o*d,_=o*f,u=a*f,m=l*c,y=l*d,w=l*f,R=i.x,E=i.y,A=i.z;return r[0]=(1-(M+u))*R,r[1]=(p+w)*R,r[2]=(x-y)*R,r[3]=0,r[4]=(p-w)*E,r[5]=(1-(h+u))*E,r[6]=(_+m)*E,r[7]=0,r[8]=(x+y)*A,r[9]=(_-m)*A,r[10]=(1-(h+M))*A,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,n,i){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinant();if(s===0)return i.set(1,1,1),n.identity(),this;let o=io.set(r[0],r[1],r[2]).length(),a=io.set(r[4],r[5],r[6]).length(),l=io.set(r[8],r[9],r[10]).length();s<0&&(o=-o),ai.copy(this);let c=1/o,d=1/a,f=1/l;return ai.elements[0]*=c,ai.elements[1]*=c,ai.elements[2]*=c,ai.elements[4]*=d,ai.elements[5]*=d,ai.elements[6]*=d,ai.elements[8]*=f,ai.elements[9]*=f,ai.elements[10]*=f,n.setFromRotationMatrix(ai),i.x=o,i.y=a,i.z=l,this}makePerspective(e,n,i,r,s,o,a=ui,l=!1){let c=this.elements,d=2*s/(n-e),f=2*s/(i-r),h=(n+e)/(n-e),p=(i+r)/(i-r),x,M;if(l)x=s/(o-s),M=o*s/(o-s);else if(a===ui)x=-(o+s)/(o-s),M=-2*o*s/(o-s);else if(a===go)x=-o/(o-s),M=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=h,c[12]=0,c[1]=0,c[5]=f,c[9]=p,c[13]=0,c[2]=0,c[6]=0,c[10]=x,c[14]=M,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,n,i,r,s,o,a=ui,l=!1){let c=this.elements,d=2/(n-e),f=2/(i-r),h=-(n+e)/(n-e),p=-(i+r)/(i-r),x,M;if(l)x=1/(o-s),M=o/(o-s);else if(a===ui)x=-2/(o-s),M=-(o+s)/(o-s);else if(a===go)x=-1/(o-s),M=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=0,c[12]=h,c[1]=0,c[5]=f,c[9]=0,c[13]=p,c[2]=0,c[6]=0,c[10]=x,c[14]=M,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<16;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<16;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e[n+9]=i[9],e[n+10]=i[10],e[n+11]=i[11],e[n+12]=i[12],e[n+13]=i[13],e[n+14]=i[14],e[n+15]=i[15],e}};th.prototype.isMatrix4=!0;var Pt=th,io=new L,ai=new Pt,QM=new L(0,0,0),e1=new L(1,1,1),Ar=new L,qc=new L,Fn=new L,Vv=new Pt,Gv=new Ri,tr=class t{constructor(e=0,n=0,i=0,r=t.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=n,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,n,i,r=this._order){return this._x=e,this._y=n,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,n=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],d=r[9],f=r[2],h=r[6],p=r[10];switch(n){case"XYZ":this._y=Math.asin(Ze(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-d,p),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(h,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Ze(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-f,s),this._z=0);break;case"ZXY":this._x=Math.asin(Ze(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-f,p),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Ze(f,-1,1)),Math.abs(f)<.9999999?(this._x=Math.atan2(h,p),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Ze(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-d,c),this._y=Math.atan2(-f,s)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-Ze(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(h,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-d,p),this._y=0);break;default:Le("Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,n,i){return Vv.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Vv,n,i)}setFromVector3(e,n=this._order){return this.set(e.x,e.y,e.z,n)}reorder(e){return Gv.setFromEuler(this),this.setFromQuaternion(Gv,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};tr.DEFAULT_ORDER="XYZ";var Ba=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},t1=0,Hv=new L,ro=new Ri,Zi=new Pt,Zc=new L,Aa=new L,n1=new L,i1=new Ri,Wv=new L(1,0,0),Xv=new L(0,1,0),Yv=new L(0,0,1),qv={type:"added"},r1={type:"removed"},so={type:"childadded",child:null},Cp={type:"childremoved",child:null},un=class t extends Ci{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:t1++}),this.uuid=hl(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=t.DEFAULT_UP.clone();let e=new L,n=new tr,i=new Ri,r=new L(1,1,1);function s(){i.setFromEuler(n,!1)}function o(){n.setFromQuaternion(i,void 0,!1)}n._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new Pt},normalMatrix:{value:new He}}),this.matrix=new Pt,this.matrixWorld=new Pt,this.matrixAutoUpdate=t.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Ba,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,n){this.quaternion.setFromAxisAngle(e,n)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,n){return ro.setFromAxisAngle(e,n),this.quaternion.multiply(ro),this}rotateOnWorldAxis(e,n){return ro.setFromAxisAngle(e,n),this.quaternion.premultiply(ro),this}rotateX(e){return this.rotateOnAxis(Wv,e)}rotateY(e){return this.rotateOnAxis(Xv,e)}rotateZ(e){return this.rotateOnAxis(Yv,e)}translateOnAxis(e,n){return Hv.copy(e).applyQuaternion(this.quaternion),this.position.add(Hv.multiplyScalar(n)),this}translateX(e){return this.translateOnAxis(Wv,e)}translateY(e){return this.translateOnAxis(Xv,e)}translateZ(e){return this.translateOnAxis(Yv,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Zi.copy(this.matrixWorld).invert())}lookAt(e,n,i){e.isVector3?Zc.copy(e):Zc.set(e,n,i);let r=this.parent;this.updateWorldMatrix(!0,!1),Aa.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Zi.lookAt(Aa,Zc,this.up):Zi.lookAt(Zc,Aa,this.up),this.quaternion.setFromRotationMatrix(Zi),r&&(Zi.extractRotation(r.matrixWorld),ro.setFromRotationMatrix(Zi),this.quaternion.premultiply(ro.invert()))}add(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return e===this?(De("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(qv),so.child=e,this.dispatchEvent(so),so.child=null):De("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(e);return n!==-1&&(e.parent=null,this.children.splice(n,1),e.dispatchEvent(r1),Cp.child=e,this.dispatchEvent(Cp),Cp.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Zi.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Zi.multiply(e.parent.matrixWorld)),e.applyMatrix4(Zi),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(qv),so.child=e,this.dispatchEvent(so),so.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,n){if(this[e]===n)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,n);if(o!==void 0)return o}}getObjectsByProperty(e,n,i=[]){this[e]===n&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,n,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Aa,e,n1),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Aa,i1,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return e.set(n[8],n[9],n[10]).normalize()}raycast(){}traverse(e){e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverseVisible(e)}traverseAncestors(e){let n=this.parent;n!==null&&(e(n),n.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let n=e.x,i=e.y,r=e.z,s=this.matrix.elements;s[12]+=n-s[0]*n-s[4]*i-s[8]*r,s[13]+=i-s[1]*n-s[5]*i-s[9]*r,s[14]+=r-s[2]*n-s[6]*i-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].updateMatrixWorld(e)}updateWorldMatrix(e,n){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),n===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let n=e===void 0||typeof e=="string",i={};n&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,d=l.length;c<d;c++){let f=l[c];s(e.shapes,f)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(n){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),d=o(e.images),f=o(e.shapes),h=o(e.skeletons),p=o(e.animations),x=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),d.length>0&&(i.images=d),f.length>0&&(i.shapes=f),h.length>0&&(i.skeletons=h),p.length>0&&(i.animations=p),x.length>0&&(i.nodes=x)}return i.object=r,i;function o(a){let l=[];for(let c in a){let d=a[c];delete d.metadata,l.push(d)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,n=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),n===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};un.DEFAULT_UP=new L(0,1,0);un.DEFAULT_MATRIX_AUTO_UPDATE=!0;un.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Kt=class extends un{constructor(){super(),this.isGroup=!0,this.type="Group"}},s1={type:"move"},xo=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Kt,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Kt,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new L,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new L),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Kt,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new L,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new L,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let n=this._hand;if(n)for(let i of e.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,n,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&n.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let M of e.hand.values()){let _=n.getJointPose(M,i),u=this._getHandJoint(c,M);_!==null&&(u.matrix.fromArray(_.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=_.radius),u.visible=_!==null}let d=c.joints["index-finger-tip"],f=c.joints["thumb-tip"],h=d.position.distanceTo(f.position),p=.02,x=.005;c.inputState.pinching&&h>p+x?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&h<=p-x&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=n.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));a!==null&&(r=n.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(s1)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,n){if(e.joints[n.jointName]===void 0){let i=new Kt;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[n.jointName]=i,e.add(i)}return e.joints[n.jointName]}},Gx={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Cr={h:0,s:0,l:0},$c={h:0,s:0,l:0};function Rp(t,e,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?t+(e-t)*6*n:n<1/2?e:n<2/3?t+(e-t)*6*(2/3-n):t}var Ke=class{constructor(e,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,n,i)}set(e,n,i){if(n===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,n,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,n=Yt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,je.colorSpaceToWorking(this,n),this}setRGB(e,n,i,r=je.workingColorSpace){return this.r=e,this.g=n,this.b=i,je.colorSpaceToWorking(this,r),this}setHSL(e,n,i,r=je.workingColorSpace){if(e=$M(e,1),n=Ze(n,0,1),i=Ze(i,0,1),n===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+n):i+n-i*n,o=2*i-s;this.r=Rp(o,s,e+1/3),this.g=Rp(o,s,e),this.b=Rp(o,s,e-1/3)}return je.colorSpaceToWorking(this,r),this}setStyle(e,n=Yt){function i(s){s!==void 0&&parseFloat(s)<1&&Le("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,n);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,n);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,n);break;default:Le("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,n);if(o===6)return this.setHex(parseInt(s,16),n);Le("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,n);return this}setColorName(e,n=Yt){let i=Gx[e.toLowerCase()];return i!==void 0?this.setHex(i,n):Le("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Qi(e.r),this.g=Qi(e.g),this.b=Qi(e.b),this}copyLinearToSRGB(e){return this.r=mo(e.r),this.g=mo(e.g),this.b=mo(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Yt){return je.workingToColorSpace(cn.copy(this),e),Math.round(Ze(cn.r*255,0,255))*65536+Math.round(Ze(cn.g*255,0,255))*256+Math.round(Ze(cn.b*255,0,255))}getHexString(e=Yt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,n=je.workingColorSpace){je.workingToColorSpace(cn.copy(this),n);let i=cn.r,r=cn.g,s=cn.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,c,d=(a+o)/2;if(a===o)l=0,c=0;else{let f=o-a;switch(c=d<=.5?f/(o+a):f/(2-o-a),o){case i:l=(r-s)/f+(r<s?6:0);break;case r:l=(s-i)/f+2;break;case s:l=(i-r)/f+4;break}l/=6}return e.h=l,e.s=c,e.l=d,e}getRGB(e,n=je.workingColorSpace){return je.workingToColorSpace(cn.copy(this),n),e.r=cn.r,e.g=cn.g,e.b=cn.b,e}getStyle(e=Yt){je.workingToColorSpace(cn.copy(this),e);let n=cn.r,i=cn.g,r=cn.b;return e!==Yt?`color(${e} ${n.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,n,i){return this.getHSL(Cr),this.setHSL(Cr.h+e,Cr.s+n,Cr.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,n){return this.r=e.r+n.r,this.g=e.g+n.g,this.b=e.b+n.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,n){return this.r+=(e.r-this.r)*n,this.g+=(e.g-this.g)*n,this.b+=(e.b-this.b)*n,this}lerpColors(e,n,i){return this.r=e.r+(n.r-e.r)*i,this.g=e.g+(n.g-e.g)*i,this.b=e.b+(n.b-e.b)*i,this}lerpHSL(e,n){this.getHSL(Cr),e.getHSL($c);let i=wp(Cr.h,$c.h,n),r=wp(Cr.s,$c.s,n),s=wp(Cr.l,$c.l,n);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let n=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*n+s[3]*i+s[6]*r,this.g=s[1]*n+s[4]*i+s[7]*r,this.b=s[2]*n+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,n=0){return this.r=e[n],this.g=e[n+1],this.b=e[n+2],this}toArray(e=[],n=0){return e[n]=this.r,e[n+1]=this.g,e[n+2]=this.b,e}fromBufferAttribute(e,n){return this.r=e.getX(n),this.g=e.getY(n),this.b=e.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},cn=new Ke;Ke.NAMES=Gx;var ka=class extends un{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new tr,this.environmentIntensity=1,this.environmentRotation=new tr,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,n){return super.copy(e,n),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let n=super.toJSON(e);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(n.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(n.object.backgroundIntensity=this.backgroundIntensity),n.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(n.object.environmentIntensity=this.environmentIntensity),n.object.environmentRotation=this.environmentRotation.toArray(),n}},li=new L,$i=new L,Pp=new L,Ji=new L,oo=new L,ao=new L,Zv=new L,Ip=new L,Lp=new L,Np=new L,Dp=new It,Up=new It,Fp=new It,Nr=class t{constructor(e=new L,n=new L,i=new L){this.a=e,this.b=n,this.c=i}static getNormal(e,n,i,r){r.subVectors(i,n),li.subVectors(e,n),r.cross(li);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,n,i,r,s){li.subVectors(r,n),$i.subVectors(i,n),Pp.subVectors(e,n);let o=li.dot(li),a=li.dot($i),l=li.dot(Pp),c=$i.dot($i),d=$i.dot(Pp),f=o*c-a*a;if(f===0)return s.set(0,0,0),null;let h=1/f,p=(c*l-a*d)*h,x=(o*d-a*l)*h;return s.set(1-p-x,x,p)}static containsPoint(e,n,i,r){return this.getBarycoord(e,n,i,r,Ji)===null?!1:Ji.x>=0&&Ji.y>=0&&Ji.x+Ji.y<=1}static getInterpolation(e,n,i,r,s,o,a,l){return this.getBarycoord(e,n,i,r,Ji)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Ji.x),l.addScaledVector(o,Ji.y),l.addScaledVector(a,Ji.z),l)}static getInterpolatedAttribute(e,n,i,r,s,o){return Dp.setScalar(0),Up.setScalar(0),Fp.setScalar(0),Dp.fromBufferAttribute(e,n),Up.fromBufferAttribute(e,i),Fp.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(Dp,s.x),o.addScaledVector(Up,s.y),o.addScaledVector(Fp,s.z),o}static isFrontFacing(e,n,i,r){return li.subVectors(i,n),$i.subVectors(e,n),li.cross($i).dot(r)<0}set(e,n,i){return this.a.copy(e),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(e,n,i,r){return this.a.copy(e[n]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,n,i,r){return this.a.fromBufferAttribute(e,n),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return li.subVectors(this.c,this.b),$i.subVectors(this.a,this.b),li.cross($i).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return t.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,n){return t.getBarycoord(e,this.a,this.b,this.c,n)}getInterpolation(e,n,i,r,s){return t.getInterpolation(e,this.a,this.b,this.c,n,i,r,s)}containsPoint(e){return t.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return t.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,n){let i=this.a,r=this.b,s=this.c,o,a;oo.subVectors(r,i),ao.subVectors(s,i),Ip.subVectors(e,i);let l=oo.dot(Ip),c=ao.dot(Ip);if(l<=0&&c<=0)return n.copy(i);Lp.subVectors(e,r);let d=oo.dot(Lp),f=ao.dot(Lp);if(d>=0&&f<=d)return n.copy(r);let h=l*f-d*c;if(h<=0&&l>=0&&d<=0)return o=l/(l-d),n.copy(i).addScaledVector(oo,o);Np.subVectors(e,s);let p=oo.dot(Np),x=ao.dot(Np);if(x>=0&&p<=x)return n.copy(s);let M=p*c-l*x;if(M<=0&&c>=0&&x<=0)return a=c/(c-x),n.copy(i).addScaledVector(ao,a);let _=d*x-p*f;if(_<=0&&f-d>=0&&p-x>=0)return Zv.subVectors(s,r),a=(f-d)/(f-d+(p-x)),n.copy(r).addScaledVector(Zv,a);let u=1/(_+M+h);return o=M*u,a=h*u,n.copy(i).addScaledVector(oo,o).addScaledVector(ao,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},hi=class{constructor(e=new L(1/0,1/0,1/0),n=new L(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=n}set(e,n){return this.min.copy(e),this.max.copy(n),this}setFromArray(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n+=3)this.expandByPoint(ci.fromArray(e,n));return this}setFromBufferAttribute(e){this.makeEmpty();for(let n=0,i=e.count;n<i;n++)this.expandByPoint(ci.fromBufferAttribute(e,n));return this}setFromPoints(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n++)this.expandByPoint(e[n]);return this}setFromCenterAndSize(e,n){let i=ci.copy(n).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,n=!1){return this.makeEmpty(),this.expandByObject(e,n)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,n=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(n===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,ci):ci.fromBufferAttribute(s,o),ci.applyMatrix4(e.matrixWorld),this.expandByPoint(ci);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Jc.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Jc.copy(i.boundingBox)),Jc.applyMatrix4(e.matrixWorld),this.union(Jc)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],n);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,n){return n.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,ci),ci.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let n,i;return e.normal.x>0?(n=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(n=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(n+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(n+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(n+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(n+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),n<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Ca),Kc.subVectors(this.max,Ca),lo.subVectors(e.a,Ca),co.subVectors(e.b,Ca),uo.subVectors(e.c,Ca),Rr.subVectors(co,lo),Pr.subVectors(uo,co),cs.subVectors(lo,uo);let n=[0,-Rr.z,Rr.y,0,-Pr.z,Pr.y,0,-cs.z,cs.y,Rr.z,0,-Rr.x,Pr.z,0,-Pr.x,cs.z,0,-cs.x,-Rr.y,Rr.x,0,-Pr.y,Pr.x,0,-cs.y,cs.x,0];return!Op(n,lo,co,uo,Kc)||(n=[1,0,0,0,1,0,0,0,1],!Op(n,lo,co,uo,Kc))?!1:(jc.crossVectors(Rr,Pr),n=[jc.x,jc.y,jc.z],Op(n,lo,co,uo,Kc))}clampPoint(e,n){return n.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,ci).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(ci).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Ki[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Ki[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Ki[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Ki[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Ki[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Ki[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Ki[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Ki[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Ki),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Ki=[new L,new L,new L,new L,new L,new L,new L,new L],ci=new L,Jc=new hi,lo=new L,co=new L,uo=new L,Rr=new L,Pr=new L,cs=new L,Ca=new L,Kc=new L,jc=new L,us=new L;function Op(t,e,n,i,r){for(let s=0,o=t.length-3;s<=o;s+=3){us.fromArray(t,s);let a=r.x*Math.abs(us.x)+r.y*Math.abs(us.y)+r.z*Math.abs(us.z),l=e.dot(us),c=n.dot(us),d=i.dot(us);if(Math.max(-Math.max(l,c,d),Math.min(l,c,d))>a)return!1}return!0}var Ot=new L,Qc=new Ce,o1=0,Bn=class extends Ci{constructor(e,n,i=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:o1++}),this.name="",this.array=e,this.itemSize=n,this.count=e!==void 0?e.length/n:0,this.normalized=i,this.usage=em,this.updateRanges=[],this.gpuType=pi,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,n,i){e*=this.itemSize,i*=n.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=n.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)Qc.fromBufferAttribute(this,n),Qc.applyMatrix3(e),this.setXY(n,Qc.x,Qc.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)Ot.fromBufferAttribute(this,n),Ot.applyMatrix3(e),this.setXYZ(n,Ot.x,Ot.y,Ot.z);return this}applyMatrix4(e){for(let n=0,i=this.count;n<i;n++)Ot.fromBufferAttribute(this,n),Ot.applyMatrix4(e),this.setXYZ(n,Ot.x,Ot.y,Ot.z);return this}applyNormalMatrix(e){for(let n=0,i=this.count;n<i;n++)Ot.fromBufferAttribute(this,n),Ot.applyNormalMatrix(e),this.setXYZ(n,Ot.x,Ot.y,Ot.z);return this}transformDirection(e){for(let n=0,i=this.count;n<i;n++)Ot.fromBufferAttribute(this,n),Ot.transformDirection(e),this.setXYZ(n,Ot.x,Ot.y,Ot.z);return this}set(e,n=0){return this.array.set(e,n),this}getComponent(e,n){let i=this.array[e*this.itemSize+n];return this.normalized&&(i=ba(i,this.array)),i}setComponent(e,n,i){return this.normalized&&(i=bn(i,this.array)),this.array[e*this.itemSize+n]=i,this}getX(e){let n=this.array[e*this.itemSize];return this.normalized&&(n=ba(n,this.array)),n}setX(e,n){return this.normalized&&(n=bn(n,this.array)),this.array[e*this.itemSize]=n,this}getY(e){let n=this.array[e*this.itemSize+1];return this.normalized&&(n=ba(n,this.array)),n}setY(e,n){return this.normalized&&(n=bn(n,this.array)),this.array[e*this.itemSize+1]=n,this}getZ(e){let n=this.array[e*this.itemSize+2];return this.normalized&&(n=ba(n,this.array)),n}setZ(e,n){return this.normalized&&(n=bn(n,this.array)),this.array[e*this.itemSize+2]=n,this}getW(e){let n=this.array[e*this.itemSize+3];return this.normalized&&(n=ba(n,this.array)),n}setW(e,n){return this.normalized&&(n=bn(n,this.array)),this.array[e*this.itemSize+3]=n,this}setXY(e,n,i){return e*=this.itemSize,this.normalized&&(n=bn(n,this.array),i=bn(i,this.array)),this.array[e+0]=n,this.array[e+1]=i,this}setXYZ(e,n,i,r){return e*=this.itemSize,this.normalized&&(n=bn(n,this.array),i=bn(i,this.array),r=bn(r,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,n,i,r,s){return e*=this.itemSize,this.normalized&&(n=bn(n,this.array),i=bn(i,this.array),r=bn(r,this.array),s=bn(s,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==em&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var za=class extends Bn{constructor(e,n,i){super(new Uint16Array(e),n,i)}};var Va=class extends Bn{constructor(e,n,i){super(new Uint32Array(e),n,i)}};var Tt=class extends Bn{constructor(e,n,i){super(new Float32Array(e),n,i)}},a1=new hi,Ra=new L,Bp=new L,yo=class{constructor(e=new L,n=-1){this.isSphere=!0,this.center=e,this.radius=n}set(e,n){return this.center.copy(e),this.radius=n,this}setFromPoints(e,n){let i=this.center;n!==void 0?i.copy(n):a1.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let n=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=n*n}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,n){let i=this.center.distanceToSquared(e);return n.copy(e),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Ra.subVectors(e,this.center);let n=Ra.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),r=(i-this.radius)*.5;this.center.addScaledVector(Ra,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Bp.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Ra.copy(e.center).add(Bp)),this.expandByPoint(Ra.copy(e.center).sub(Bp))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},l1=0,$n=new Pt,kp=new un,ho=new L,On=new hi,Pa=new hi,Xt=new L,Cn=class t extends Ci{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:l1++}),this.uuid=hl(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(qM(e)?Va:za)(e,1):this.index=e,this}setIndirect(e,n=0){return this.indirect=e,this.indirectOffset=n,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,n){return this.attributes[e]=n,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,n,i=0){this.groups.push({start:e,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,n){this.drawRange.start=e,this.drawRange.count=n}applyMatrix4(e){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(e),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new He().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return $n.makeRotationFromQuaternion(e),this.applyMatrix4($n),this}rotateX(e){return $n.makeRotationX(e),this.applyMatrix4($n),this}rotateY(e){return $n.makeRotationY(e),this.applyMatrix4($n),this}rotateZ(e){return $n.makeRotationZ(e),this.applyMatrix4($n),this}translate(e,n,i){return $n.makeTranslation(e,n,i),this.applyMatrix4($n),this}scale(e,n,i){return $n.makeScale(e,n,i),this.applyMatrix4($n),this}lookAt(e){return kp.lookAt(e),kp.updateMatrix(),this.applyMatrix4(kp.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(ho).negate(),this.translate(ho.x,ho.y,ho.z),this}setFromPoints(e){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new Tt(i,3))}else{let i=Math.min(e.length,n.count);for(let r=0;r<i;r++){let s=e[r];n.setXYZ(r,s.x,s.y,s.z||0)}e.length>n.count&&Le("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new hi);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){De("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new L(-1/0,-1/0,-1/0),new L(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),n)for(let i=0,r=n.length;i<r;i++){let s=n[i];On.setFromBufferAttribute(s),this.morphTargetsRelative?(Xt.addVectors(this.boundingBox.min,On.min),this.boundingBox.expandByPoint(Xt),Xt.addVectors(this.boundingBox.max,On.max),this.boundingBox.expandByPoint(Xt)):(this.boundingBox.expandByPoint(On.min),this.boundingBox.expandByPoint(On.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&De('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new yo);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){De("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new L,1/0);return}if(e){let i=this.boundingSphere.center;if(On.setFromBufferAttribute(e),n)for(let s=0,o=n.length;s<o;s++){let a=n[s];Pa.setFromBufferAttribute(a),this.morphTargetsRelative?(Xt.addVectors(On.min,Pa.min),On.expandByPoint(Xt),Xt.addVectors(On.max,Pa.max),On.expandByPoint(Xt)):(On.expandByPoint(Pa.min),On.expandByPoint(Pa.max))}On.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)Xt.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(Xt));if(n)for(let s=0,o=n.length;s<o;s++){let a=n[s],l=this.morphTargetsRelative;for(let c=0,d=a.count;c<d;c++)Xt.fromBufferAttribute(a,c),l&&(ho.fromBufferAttribute(e,c),Xt.add(ho)),r=Math.max(r,i.distanceToSquared(Xt))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&De('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,n=this.attributes;if(e===null||n.position===void 0||n.normal===void 0||n.uv===void 0){De("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,r=n.normal,s=n.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Bn(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let g=0;g<i.count;g++)a[g]=new L,l[g]=new L;let c=new L,d=new L,f=new L,h=new Ce,p=new Ce,x=new Ce,M=new L,_=new L;function u(g,b,I){c.fromBufferAttribute(i,g),d.fromBufferAttribute(i,b),f.fromBufferAttribute(i,I),h.fromBufferAttribute(s,g),p.fromBufferAttribute(s,b),x.fromBufferAttribute(s,I),d.sub(c),f.sub(c),p.sub(h),x.sub(h);let P=1/(p.x*x.y-x.x*p.y);isFinite(P)&&(M.copy(d).multiplyScalar(x.y).addScaledVector(f,-p.y).multiplyScalar(P),_.copy(f).multiplyScalar(p.x).addScaledVector(d,-x.x).multiplyScalar(P),a[g].add(M),a[b].add(M),a[I].add(M),l[g].add(_),l[b].add(_),l[I].add(_))}let m=this.groups;m.length===0&&(m=[{start:0,count:e.count}]);for(let g=0,b=m.length;g<b;++g){let I=m[g],P=I.start,N=I.count;for(let F=P,W=P+N;F<W;F+=3)u(e.getX(F+0),e.getX(F+1),e.getX(F+2))}let y=new L,w=new L,R=new L,E=new L;function A(g){R.fromBufferAttribute(r,g),E.copy(R);let b=a[g];y.copy(b),y.sub(R.multiplyScalar(R.dot(b))).normalize(),w.crossVectors(E,b);let P=w.dot(l[g])<0?-1:1;o.setXYZW(g,y.x,y.y,y.z,P)}for(let g=0,b=m.length;g<b;++g){let I=m[g],P=I.start,N=I.count;for(let F=P,W=P+N;F<W;F+=3)A(e.getX(F+0)),A(e.getX(F+1)),A(e.getX(F+2))}}computeVertexNormals(){let e=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Bn(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let h=0,p=i.count;h<p;h++)i.setXYZ(h,0,0,0);let r=new L,s=new L,o=new L,a=new L,l=new L,c=new L,d=new L,f=new L;if(e)for(let h=0,p=e.count;h<p;h+=3){let x=e.getX(h+0),M=e.getX(h+1),_=e.getX(h+2);r.fromBufferAttribute(n,x),s.fromBufferAttribute(n,M),o.fromBufferAttribute(n,_),d.subVectors(o,s),f.subVectors(r,s),d.cross(f),a.fromBufferAttribute(i,x),l.fromBufferAttribute(i,M),c.fromBufferAttribute(i,_),a.add(d),l.add(d),c.add(d),i.setXYZ(x,a.x,a.y,a.z),i.setXYZ(M,l.x,l.y,l.z),i.setXYZ(_,c.x,c.y,c.z)}else for(let h=0,p=n.count;h<p;h+=3)r.fromBufferAttribute(n,h+0),s.fromBufferAttribute(n,h+1),o.fromBufferAttribute(n,h+2),d.subVectors(o,s),f.subVectors(r,s),d.cross(f),i.setXYZ(h+0,d.x,d.y,d.z),i.setXYZ(h+1,d.x,d.y,d.z),i.setXYZ(h+2,d.x,d.y,d.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let n=0,i=e.count;n<i;n++)Xt.fromBufferAttribute(e,n),Xt.normalize(),e.setXYZ(n,Xt.x,Xt.y,Xt.z)}toNonIndexed(){function e(a,l){let c=a.array,d=a.itemSize,f=a.normalized,h=new c.constructor(l.length*d),p=0,x=0;for(let M=0,_=l.length;M<_;M++){a.isInterleavedBufferAttribute?p=l[M]*a.data.stride+a.offset:p=l[M]*d;for(let u=0;u<d;u++)h[x++]=c[p++]}return new Bn(h,d,f)}if(this.index===null)return Le("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new t,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],c=e(l,i);n.setAttribute(a,c)}let s=this.morphAttributes;for(let a in s){let l=[],c=s[a];for(let d=0,f=c.length;d<f;d++){let h=c[d],p=e(h,i);l.push(p)}n.morphAttributes[a]=l}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let n=this.index;n!==null&&(e.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];e.data.attributes[l]=c.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],d=[];for(let f=0,h=c.length;f<h;f++){let p=c[f];d.push(p.toJSON(e.data))}d.length>0&&(r[l]=d,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let c in r){let d=r[c];this.setAttribute(c,d.clone(n))}let s=e.morphAttributes;for(let c in s){let d=[],f=s[c];for(let h=0,p=f.length;h<p;h++)d.push(f[h].clone(n));this.morphAttributes[c]=d}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,d=o.length;c<d;c++){let f=o[c];this.addGroup(f.start,f.count,f.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var c1=0,Ur=class extends Ci{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:c1++}),this.uuid=hl(),this.name="",this.type="Material",this.blending=ps,this.side=er,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=pu,this.blendDst=mu,this.blendEquation=Dr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ke(0,0,0),this.blendAlpha=0,this.depthFunc=ms,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Qp,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=fs,this.stencilZFail=fs,this.stencilZPass=fs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let n in e){let i=e[n];if(i===void 0){Le(`Material: parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Le(`Material: '${n}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";n&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==ps&&(i.blending=this.blending),this.side!==er&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==pu&&(i.blendSrc=this.blendSrc),this.blendDst!==mu&&(i.blendDst=this.blendDst),this.blendEquation!==Dr&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==ms&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Qp&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==fs&&(i.stencilFail=this.stencilFail),this.stencilZFail!==fs&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==fs&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(n){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let n=e.clippingPlanes,i=null;if(n!==null){let r=n.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=n[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var ji=new L,zp=new L,eu=new L,Ir=new L,Vp=new L,tu=new L,Gp=new L,So=class{constructor(e=new L,n=new L(0,0,-1)){this.origin=e,this.direction=n}set(e,n){return this.origin.copy(e),this.direction.copy(n),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,n){return n.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,ji)),this}closestPointToPoint(e,n){n.subVectors(e,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let n=ji.subVectors(e,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(e):(ji.copy(this.origin).addScaledVector(this.direction,n),ji.distanceToSquared(e))}distanceSqToSegment(e,n,i,r){zp.copy(e).add(n).multiplyScalar(.5),eu.copy(n).sub(e).normalize(),Ir.copy(this.origin).sub(zp);let s=e.distanceTo(n)*.5,o=-this.direction.dot(eu),a=Ir.dot(this.direction),l=-Ir.dot(eu),c=Ir.lengthSq(),d=Math.abs(1-o*o),f,h,p,x;if(d>0)if(f=o*l-a,h=o*a-l,x=s*d,f>=0)if(h>=-x)if(h<=x){let M=1/d;f*=M,h*=M,p=f*(f+o*h+2*a)+h*(o*f+h+2*l)+c}else h=s,f=Math.max(0,-(o*h+a)),p=-f*f+h*(h+2*l)+c;else h=-s,f=Math.max(0,-(o*h+a)),p=-f*f+h*(h+2*l)+c;else h<=-x?(f=Math.max(0,-(-o*s+a)),h=f>0?-s:Math.min(Math.max(-s,-l),s),p=-f*f+h*(h+2*l)+c):h<=x?(f=0,h=Math.min(Math.max(-s,-l),s),p=h*(h+2*l)+c):(f=Math.max(0,-(o*s+a)),h=f>0?s:Math.min(Math.max(-s,-l),s),p=-f*f+h*(h+2*l)+c);else h=o>0?-s:s,f=Math.max(0,-(o*h+a)),p=-f*f+h*(h+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,f),r&&r.copy(zp).addScaledVector(eu,h),p}intersectSphere(e,n){ji.subVectors(e.center,this.origin);let i=ji.dot(this.direction),r=ji.dot(ji)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,n):this.at(a,n)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let n=e.normal.dot(this.direction);if(n===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/n;return i>=0?i:null}intersectPlane(e,n){let i=this.distanceToPlane(e);return i===null?null:this.at(i,n)}intersectsPlane(e){let n=e.distanceToPoint(this.origin);return n===0||e.normal.dot(this.direction)*n<0}intersectBox(e,n){let i,r,s,o,a,l,c=1/this.direction.x,d=1/this.direction.y,f=1/this.direction.z,h=this.origin;return c>=0?(i=(e.min.x-h.x)*c,r=(e.max.x-h.x)*c):(i=(e.max.x-h.x)*c,r=(e.min.x-h.x)*c),d>=0?(s=(e.min.y-h.y)*d,o=(e.max.y-h.y)*d):(s=(e.max.y-h.y)*d,o=(e.min.y-h.y)*d),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),f>=0?(a=(e.min.z-h.z)*f,l=(e.max.z-h.z)*f):(a=(e.max.z-h.z)*f,l=(e.min.z-h.z)*f),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,n)}intersectsBox(e){return this.intersectBox(e,ji)!==null}intersectTriangle(e,n,i,r,s){Vp.subVectors(n,e),tu.subVectors(i,e),Gp.crossVectors(Vp,tu);let o=this.direction.dot(Gp),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Ir.subVectors(this.origin,e);let l=a*this.direction.dot(tu.crossVectors(Ir,tu));if(l<0)return null;let c=a*this.direction.dot(Vp.cross(Ir));if(c<0||l+c>o)return null;let d=-a*Ir.dot(Gp);return d<0?null:this.at(d/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},gs=class extends Ur{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ke(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new tr,this.combine=cm,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},$v=new Pt,hs=new So,nu=new yo,Jv=new L,iu=new L,ru=new L,su=new L,Hp=new L,ou=new L,Kv=new L,au=new L,Bt=class extends un{constructor(e=new Cn,n=new gs){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,n){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;n.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){ou.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let d=a[l],f=s[l];d!==0&&(Hp.fromBufferAttribute(f,e),o?ou.addScaledVector(Hp,d):ou.addScaledVector(Hp.sub(n),d))}n.add(ou)}return n}raycast(e,n){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),nu.copy(i.boundingSphere),nu.applyMatrix4(s),hs.copy(e.ray).recast(e.near),!(nu.containsPoint(hs.origin)===!1&&(hs.intersectSphere(nu,Jv)===null||hs.origin.distanceToSquared(Jv)>(e.far-e.near)**2))&&($v.copy(s).invert(),hs.copy(e.ray).applyMatrix4($v),!(i.boundingBox!==null&&hs.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,n,hs)))}_computeIntersections(e,n,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,d=s.attributes.uv1,f=s.attributes.normal,h=s.groups,p=s.drawRange;if(a!==null)if(Array.isArray(o))for(let x=0,M=h.length;x<M;x++){let _=h[x],u=o[_.materialIndex],m=Math.max(_.start,p.start),y=Math.min(a.count,Math.min(_.start+_.count,p.start+p.count));for(let w=m,R=y;w<R;w+=3){let E=a.getX(w),A=a.getX(w+1),g=a.getX(w+2);r=lu(this,u,e,i,c,d,f,E,A,g),r&&(r.faceIndex=Math.floor(w/3),r.face.materialIndex=_.materialIndex,n.push(r))}}else{let x=Math.max(0,p.start),M=Math.min(a.count,p.start+p.count);for(let _=x,u=M;_<u;_+=3){let m=a.getX(_),y=a.getX(_+1),w=a.getX(_+2);r=lu(this,o,e,i,c,d,f,m,y,w),r&&(r.faceIndex=Math.floor(_/3),n.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let x=0,M=h.length;x<M;x++){let _=h[x],u=o[_.materialIndex],m=Math.max(_.start,p.start),y=Math.min(l.count,Math.min(_.start+_.count,p.start+p.count));for(let w=m,R=y;w<R;w+=3){let E=w,A=w+1,g=w+2;r=lu(this,u,e,i,c,d,f,E,A,g),r&&(r.faceIndex=Math.floor(w/3),r.face.materialIndex=_.materialIndex,n.push(r))}}else{let x=Math.max(0,p.start),M=Math.min(l.count,p.start+p.count);for(let _=x,u=M;_<u;_+=3){let m=_,y=_+1,w=_+2;r=lu(this,o,e,i,c,d,f,m,y,w),r&&(r.faceIndex=Math.floor(_/3),n.push(r))}}}};function u1(t,e,n,i,r,s,o,a){let l;if(e.side===vn?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===er,a),l===null)return null;au.copy(a),au.applyMatrix4(t.matrixWorld);let c=n.ray.origin.distanceTo(au);return c<n.near||c>n.far?null:{distance:c,point:au.clone(),object:t}}function lu(t,e,n,i,r,s,o,a,l,c){t.getVertexPosition(a,iu),t.getVertexPosition(l,ru),t.getVertexPosition(c,su);let d=u1(t,e,n,i,iu,ru,su,Kv);if(d){let f=new L;Nr.getBarycoord(Kv,iu,ru,su,f),r&&(d.uv=Nr.getInterpolatedAttribute(r,a,l,c,f,new Ce)),s&&(d.uv1=Nr.getInterpolatedAttribute(s,a,l,c,f,new Ce)),o&&(d.normal=Nr.getInterpolatedAttribute(o,a,l,c,f,new L),d.normal.dot(i.direction)>0&&d.normal.multiplyScalar(-1));let h={a,b:l,c,normal:new L,materialIndex:0};Nr.getNormal(iu,ru,su,h.normal),d.face=h,d.barycoord=f}return d}var Iu=class extends _n{constructor(e=null,n=1,i=1,r,s,o,a,l,c=qt,d=qt,f,h){super(null,o,a,l,c,d,r,s,f,h),this.isDataTexture=!0,this.image={data:e,width:n,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Wp=new L,h1=new L,d1=new He,Ti=class{constructor(e=new L(1,0,0),n=0){this.isPlane=!0,this.normal=e,this.constant=n}set(e,n){return this.normal.copy(e),this.constant=n,this}setComponents(e,n,i,r){return this.normal.set(e,n,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,n){return this.normal.copy(e),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(e,n,i){let r=Wp.subVectors(i,n).cross(h1.subVectors(e,n)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,n){return n.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,n,i=!0){let r=e.delta(Wp),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?n.copy(e.start):null;let o=-(e.start.dot(this.normal)+this.constant)/s;return i===!0&&(o<0||o>1)?null:n.copy(e.start).addScaledVector(r,o)}intersectsLine(e){let n=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return n<0&&i>0||i<0&&n>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,n){let i=n||d1.getNormalMatrix(e),r=this.coplanarPoint(Wp).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},ds=new yo,f1=new Ce(.5,.5),cu=new L,Mo=class{constructor(e=new Ti,n=new Ti,i=new Ti,r=new Ti,s=new Ti,o=new Ti){this.planes=[e,n,i,r,s,o]}set(e,n,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(n),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,n=ui,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],c=s[3],d=s[4],f=s[5],h=s[6],p=s[7],x=s[8],M=s[9],_=s[10],u=s[11],m=s[12],y=s[13],w=s[14],R=s[15];if(r[0].setComponents(c-o,p-d,u-x,R-m).normalize(),r[1].setComponents(c+o,p+d,u+x,R+m).normalize(),r[2].setComponents(c+a,p+f,u+M,R+y).normalize(),r[3].setComponents(c-a,p-f,u-M,R-y).normalize(),i)r[4].setComponents(l,h,_,w).normalize(),r[5].setComponents(c-l,p-h,u-_,R-w).normalize();else if(r[4].setComponents(c-l,p-h,u-_,R-w).normalize(),n===ui)r[5].setComponents(c+l,p+h,u+_,R+w).normalize();else if(n===go)r[5].setComponents(l,h,_,w).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ds.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let n=e.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),ds.copy(n.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ds)}intersectsSprite(e){ds.center.set(0,0,0);let n=f1.distanceTo(e.center);return ds.radius=.7071067811865476+n,ds.applyMatrix4(e.matrixWorld),this.intersectsSphere(ds)}intersectsSphere(e){let n=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(n[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let n=this.planes;for(let i=0;i<6;i++){let r=n[i];if(cu.x=r.normal.x>0?e.max.x:e.min.x,cu.y=r.normal.y>0?e.max.y:e.min.y,cu.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(cu)<0)return!1}return!0}containsPoint(e){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var Ga=class extends _n{constructor(e=[],n=zr,i,r,s,o,a,l,c,d){super(e,n,i,r,s,o,a,l,c,d),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},_s=class extends _n{constructor(e,n,i,r,s,o,a,l,c){super(e,n,i,r,s,o,a,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}};var nr=class extends _n{constructor(e,n,i=fi,r,s,o,a=qt,l=qt,c,d=Ai,f=1){if(d!==Ai&&d!==Gr)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:n,depth:f};super(h,r,s,o,a,l,d,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new vo(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let n=super.toJSON(e);return this.compareFunction!==null&&(n.compareFunction=this.compareFunction),n}},Lu=class extends nr{constructor(e,n=fi,i=zr,r,s,o=qt,a=qt,l,c=Ai){let d={width:e,height:e,depth:1},f=[d,d,d,d,d,d];super(e,e,n,i,r,s,o,a,l,c),this.image=f,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Ha=class extends _n{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Pi=class t extends Cn{constructor(e=1,n=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:n,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],c=[],d=[],f=[],h=0,p=0;x("z","y","x",-1,-1,i,n,e,o,s,0),x("z","y","x",1,-1,i,n,-e,o,s,1),x("x","z","y",1,1,e,i,n,r,o,2),x("x","z","y",1,-1,e,i,-n,r,o,3),x("x","y","z",1,-1,e,n,i,r,s,4),x("x","y","z",-1,-1,e,n,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new Tt(c,3)),this.setAttribute("normal",new Tt(d,3)),this.setAttribute("uv",new Tt(f,2));function x(M,_,u,m,y,w,R,E,A,g,b){let I=w/A,P=R/g,N=w/2,F=R/2,W=E/2,z=A+1,G=g+1,H=0,ee=0,re=new L;for(let se=0;se<G;se++){let ve=se*P-F;for(let pe=0;pe<z;pe++){let Pe=pe*I-N;re[M]=Pe*m,re[_]=ve*y,re[u]=W,c.push(re.x,re.y,re.z),re[M]=0,re[_]=0,re[u]=E>0?1:-1,d.push(re.x,re.y,re.z),f.push(pe/A),f.push(1-se/g),H+=1}}for(let se=0;se<g;se++)for(let ve=0;ve<A;ve++){let pe=h+ve+z*se,Pe=h+ve+z*(se+1),st=h+(ve+1)+z*(se+1),Oe=h+(ve+1)+z*se;l.push(pe,Pe,Oe),l.push(Pe,st,Oe),ee+=6}a.addGroup(p,ee,b),p+=ee,h+=H}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var Wa=class t extends Cn{constructor(e=1,n=1,i=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:n,height:i,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};let c=this;r=Math.floor(r),s=Math.floor(s);let d=[],f=[],h=[],p=[],x=0,M=[],_=i/2,u=0;m(),o===!1&&(e>0&&y(!0),n>0&&y(!1)),this.setIndex(d),this.setAttribute("position",new Tt(f,3)),this.setAttribute("normal",new Tt(h,3)),this.setAttribute("uv",new Tt(p,2));function m(){let w=new L,R=new L,E=0,A=(n-e)/i;for(let g=0;g<=s;g++){let b=[],I=g/s,P=I*(n-e)+e;for(let N=0;N<=r;N++){let F=N/r,W=F*l+a,z=Math.sin(W),G=Math.cos(W);R.x=P*z,R.y=-I*i+_,R.z=P*G,f.push(R.x,R.y,R.z),w.set(z,A,G).normalize(),h.push(w.x,w.y,w.z),p.push(F,1-I),b.push(x++)}M.push(b)}for(let g=0;g<r;g++)for(let b=0;b<s;b++){let I=M[b][g],P=M[b+1][g],N=M[b+1][g+1],F=M[b][g+1];(e>0||b!==0)&&(d.push(I,P,F),E+=3),(n>0||b!==s-1)&&(d.push(P,N,F),E+=3)}c.addGroup(u,E,0),u+=E}function y(w){let R=x,E=new Ce,A=new L,g=0,b=w===!0?e:n,I=w===!0?1:-1;for(let N=1;N<=r;N++)f.push(0,_*I,0),h.push(0,I,0),p.push(.5,.5),x++;let P=x;for(let N=0;N<=r;N++){let W=N/r*l+a,z=Math.cos(W),G=Math.sin(W);A.x=b*G,A.y=_*I,A.z=b*z,f.push(A.x,A.y,A.z),h.push(0,I,0),E.x=z*.5+.5,E.y=G*.5*I+.5,p.push(E.x,E.y),x++}for(let N=0;N<r;N++){let F=R+N,W=P+N;w===!0?d.push(W,W+1,F):d.push(W+1,W,F),g+=3}c.addGroup(u,g,w===!0?1:2),u+=g}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var Jn=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){Le("Curve: .getPoint() not implemented.")}getPointAt(e,n){let i=this.getUtoTmapping(e);return this.getPoint(i,n)}getPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPoint(i/e));return n}getSpacedPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPointAt(i/e));return n}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let n=[],i,r=this.getPoint(0),s=0;n.push(0);for(let o=1;o<=e;o++)i=this.getPoint(o/e),s+=i.distanceTo(r),n.push(s),r=i;return this.cacheArcLengths=n,n}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,n=null){let i=this.getLengths(),r=0,s=i.length,o;n?o=n:o=e*i[s-1];let a=0,l=s-1,c;for(;a<=l;)if(r=Math.floor(a+(l-a)/2),c=i[r]-o,c<0)a=r+1;else if(c>0)l=r-1;else{l=r;break}if(r=l,i[r]===o)return r/(s-1);let d=i[r],h=i[r+1]-d,p=(o-d)/h;return(r+p)/(s-1)}getTangent(e,n){let r=e-1e-4,s=e+1e-4;r<0&&(r=0),s>1&&(s=1);let o=this.getPoint(r),a=this.getPoint(s),l=n||(o.isVector2?new Ce:new L);return l.copy(a).sub(o).normalize(),l}getTangentAt(e,n){let i=this.getUtoTmapping(e);return this.getTangent(i,n)}computeFrenetFrames(e,n=!1){let i=new L,r=[],s=[],o=[],a=new L,l=new Pt;for(let p=0;p<=e;p++){let x=p/e;r[p]=this.getTangentAt(x,new L)}s[0]=new L,o[0]=new L;let c=Number.MAX_VALUE,d=Math.abs(r[0].x),f=Math.abs(r[0].y),h=Math.abs(r[0].z);d<=c&&(c=d,i.set(1,0,0)),f<=c&&(c=f,i.set(0,1,0)),h<=c&&i.set(0,0,1),a.crossVectors(r[0],i).normalize(),s[0].crossVectors(r[0],a),o[0].crossVectors(r[0],s[0]);for(let p=1;p<=e;p++){if(s[p]=s[p-1].clone(),o[p]=o[p-1].clone(),a.crossVectors(r[p-1],r[p]),a.length()>Number.EPSILON){a.normalize();let x=Math.acos(Ze(r[p-1].dot(r[p]),-1,1));s[p].applyMatrix4(l.makeRotationAxis(a,x))}o[p].crossVectors(r[p],s[p])}if(n===!0){let p=Math.acos(Ze(s[0].dot(s[e]),-1,1));p/=e,r[0].dot(a.crossVectors(s[0],s[e]))>0&&(p=-p);for(let x=1;x<=e;x++)s[x].applyMatrix4(l.makeRotationAxis(r[x],p*x)),o[x].crossVectors(r[x],s[x])}return{tangents:r,normals:s,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},Xa=class extends Jn{constructor(e=0,n=0,i=1,r=1,s=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=n,this.xRadius=i,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(e,n=new Ce){let i=n,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,o=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(o?s=0:s=r),this.aClockwise===!0&&!o&&(s===r?s=-r:s=s-r);let a=this.aStartAngle+e*s,l=this.aX+this.xRadius*Math.cos(a),c=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let d=Math.cos(this.aRotation),f=Math.sin(this.aRotation),h=l-this.aX,p=c-this.aY;l=h*d-p*f+this.aX,c=h*f+p*d+this.aY}return i.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},Nu=class extends Xa{constructor(e,n,i,r,s,o){super(e,n,i,i,r,s,o),this.isArcCurve=!0,this.type="ArcCurve"}};function Am(){let t=0,e=0,n=0,i=0;function r(s,o,a,l){t=s,e=a,n=-3*s+3*o-2*a-l,i=2*s-2*o+a+l}return{initCatmullRom:function(s,o,a,l,c){r(o,a,c*(a-s),c*(l-o))},initNonuniformCatmullRom:function(s,o,a,l,c,d,f){let h=(o-s)/c-(a-s)/(c+d)+(a-o)/d,p=(a-o)/d-(l-o)/(d+f)+(l-a)/f;h*=d,p*=d,r(o,a,h,p)},calc:function(s){let o=s*s,a=o*s;return t+e*s+n*o+i*a}}}var jv=new L,Qv=new L,Xp=new Am,Yp=new Am,qp=new Am,wo=class extends Jn{constructor(e=[],n=!1,i="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=n,this.curveType=i,this.tension=r}getPoint(e,n=new L){let i=n,r=this.points,s=r.length,o=(s-(this.closed?0:1))*e,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/s)+1)*s:l===0&&a===s-1&&(a=s-2,l=1);let c,d;this.closed||a>0?c=r[(a-1)%s]:(Qv.subVectors(r[0],r[1]).add(r[0]),c=Qv);let f=r[a%s],h=r[(a+1)%s];if(this.closed||a+2<s?d=r[(a+2)%s]:(jv.subVectors(r[s-1],r[s-2]).add(r[s-1]),d=jv),this.curveType==="centripetal"||this.curveType==="chordal"){let p=this.curveType==="chordal"?.5:.25,x=Math.pow(c.distanceToSquared(f),p),M=Math.pow(f.distanceToSquared(h),p),_=Math.pow(h.distanceToSquared(d),p);M<1e-4&&(M=1),x<1e-4&&(x=M),_<1e-4&&(_=M),Xp.initNonuniformCatmullRom(c.x,f.x,h.x,d.x,x,M,_),Yp.initNonuniformCatmullRom(c.y,f.y,h.y,d.y,x,M,_),qp.initNonuniformCatmullRom(c.z,f.z,h.z,d.z,x,M,_)}else this.curveType==="catmullrom"&&(Xp.initCatmullRom(c.x,f.x,h.x,d.x,this.tension),Yp.initCatmullRom(c.y,f.y,h.y,d.y,this.tension),qp.initCatmullRom(c.z,f.z,h.z,d.z,this.tension));return i.set(Xp.calc(l),Yp.calc(l),qp.calc(l)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new L().fromArray(r))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function ex(t,e,n,i,r){let s=(i-e)*.5,o=(r-n)*.5,a=t*t,l=t*a;return(2*n-2*i+s+o)*l+(-3*n+3*i-2*s-o)*a+s*t+n}function p1(t,e){let n=1-t;return n*n*e}function m1(t,e){return 2*(1-t)*t*e}function g1(t,e){return t*t*e}function Ia(t,e,n,i){return p1(t,e)+m1(t,n)+g1(t,i)}function _1(t,e){let n=1-t;return n*n*n*e}function v1(t,e){let n=1-t;return 3*n*n*t*e}function x1(t,e){return 3*(1-t)*t*t*e}function y1(t,e){return t*t*t*e}function La(t,e,n,i,r){return _1(t,e)+v1(t,n)+x1(t,i)+y1(t,r)}var Du=class extends Jn{constructor(e=new Ce,n=new Ce,i=new Ce,r=new Ce){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new Ce){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(La(e,r.x,s.x,o.x,a.x),La(e,r.y,s.y,o.y,a.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Uu=class extends Jn{constructor(e=new L,n=new L,i=new L,r=new L){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new L){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(La(e,r.x,s.x,o.x,a.x),La(e,r.y,s.y,o.y,a.y),La(e,r.z,s.z,o.z,a.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Fu=class extends Jn{constructor(e=new Ce,n=new Ce){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=n}getPoint(e,n=new Ce){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new Ce){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ou=class extends Jn{constructor(e=new L,n=new L){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=n}getPoint(e,n=new L){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new L){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Bu=class extends Jn{constructor(e=new Ce,n=new Ce,i=new Ce){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new Ce){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(Ia(e,r.x,s.x,o.x),Ia(e,r.y,s.y,o.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ya=class extends Jn{constructor(e=new L,n=new L,i=new L){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new L){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(Ia(e,r.x,s.x,o.x),Ia(e,r.y,s.y,o.y),Ia(e,r.z,s.z,o.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},ku=class extends Jn{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,n=new Ce){let i=n,r=this.points,s=(r.length-1)*e,o=Math.floor(s),a=s-o,l=r[o===0?o:o-1],c=r[o],d=r[o>r.length-2?r.length-1:o+1],f=r[o>r.length-3?r.length-1:o+2];return i.set(ex(a,l.x,c.x,d.x,f.x),ex(a,l.y,c.y,d.y,f.y)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new Ce().fromArray(r))}return this}},S1=Object.freeze({__proto__:null,ArcCurve:Nu,CatmullRomCurve3:wo,CubicBezierCurve:Du,CubicBezierCurve3:Uu,EllipseCurve:Xa,LineCurve:Fu,LineCurve3:Ou,QuadraticBezierCurve:Bu,QuadraticBezierCurve3:Ya,SplineCurve:ku});var qa=class t extends Cn{constructor(e=[new Ce(0,-.5),new Ce(.5,0),new Ce(0,.5)],n=12,i=0,r=Math.PI*2){super(),this.type="LatheGeometry",this.parameters={points:e,segments:n,phiStart:i,phiLength:r},n=Math.floor(n),r=Ze(r,0,Math.PI*2);let s=[],o=[],a=[],l=[],c=[],d=1/n,f=new L,h=new Ce,p=new L,x=new L,M=new L,_=0,u=0;for(let m=0;m<=e.length-1;m++)switch(m){case 0:_=e[m+1].x-e[m].x,u=e[m+1].y-e[m].y,p.x=u*1,p.y=-_,p.z=u*0,M.copy(p),p.normalize(),l.push(p.x,p.y,p.z);break;case e.length-1:l.push(M.x,M.y,M.z);break;default:_=e[m+1].x-e[m].x,u=e[m+1].y-e[m].y,p.x=u*1,p.y=-_,p.z=u*0,x.copy(p),p.x+=M.x,p.y+=M.y,p.z+=M.z,p.normalize(),l.push(p.x,p.y,p.z),M.copy(x)}for(let m=0;m<=n;m++){let y=i+m*d*r,w=Math.sin(y),R=Math.cos(y);for(let E=0;E<=e.length-1;E++){f.x=e[E].x*w,f.y=e[E].y,f.z=e[E].x*R,o.push(f.x,f.y,f.z),h.x=m/n,h.y=E/(e.length-1),a.push(h.x,h.y);let A=l[3*E+0]*w,g=l[3*E+1],b=l[3*E+0]*R;c.push(A,g,b)}}for(let m=0;m<n;m++)for(let y=0;y<e.length-1;y++){let w=y+m*e.length,R=w,E=w+e.length,A=w+e.length+1,g=w+1;s.push(R,E,g),s.push(A,g,E)}this.setIndex(s),this.setAttribute("position",new Tt(o,3)),this.setAttribute("uv",new Tt(a,2)),this.setAttribute("normal",new Tt(c,3))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.points,e.segments,e.phiStart,e.phiLength)}};var vs=class t extends Cn{constructor(e=1,n=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:n,widthSegments:i,heightSegments:r};let s=e/2,o=n/2,a=Math.floor(i),l=Math.floor(r),c=a+1,d=l+1,f=e/a,h=n/l,p=[],x=[],M=[],_=[];for(let u=0;u<d;u++){let m=u*h-o;for(let y=0;y<c;y++){let w=y*f-s;x.push(w,-m,0),M.push(0,0,1),_.push(y/a),_.push(1-u/l)}}for(let u=0;u<l;u++)for(let m=0;m<a;m++){let y=m+c*u,w=m+c*(u+1),R=m+1+c*(u+1),E=m+1+c*u;p.push(y,w,E),p.push(w,R,E)}this.setIndex(p),this.setAttribute("position",new Tt(x,3)),this.setAttribute("normal",new Tt(M,3)),this.setAttribute("uv",new Tt(_,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.widthSegments,e.heightSegments)}};var Za=class t extends Cn{constructor(e=1,n=32,i=16,r=0,s=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:n,heightSegments:i,phiStart:r,phiLength:s,thetaStart:o,thetaLength:a},n=Math.max(3,Math.floor(n)),i=Math.max(2,Math.floor(i));let l=Math.min(o+a,Math.PI),c=0,d=[],f=new L,h=new L,p=[],x=[],M=[],_=[];for(let u=0;u<=i;u++){let m=[],y=u/i,w=0;u===0&&o===0?w=.5/n:u===i&&l===Math.PI&&(w=-.5/n);for(let R=0;R<=n;R++){let E=R/n;f.x=-e*Math.cos(r+E*s)*Math.sin(o+y*a),f.y=e*Math.cos(o+y*a),f.z=e*Math.sin(r+E*s)*Math.sin(o+y*a),x.push(f.x,f.y,f.z),h.copy(f).normalize(),M.push(h.x,h.y,h.z),_.push(E+w,1-y),m.push(c++)}d.push(m)}for(let u=0;u<i;u++)for(let m=0;m<n;m++){let y=d[u][m+1],w=d[u][m],R=d[u+1][m],E=d[u+1][m+1];(u!==0||o>0)&&p.push(y,w,E),(u!==i-1||l<Math.PI)&&p.push(w,R,E)}this.setIndex(p),this.setAttribute("position",new Tt(x,3)),this.setAttribute("normal",new Tt(M,3)),this.setAttribute("uv",new Tt(_,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var $a=class t extends Cn{constructor(e=new Ya(new L(-1,-1,0),new L(-1,1,0),new L(1,1,0)),n=64,i=1,r=8,s=!1){super(),this.type="TubeGeometry",this.parameters={path:e,tubularSegments:n,radius:i,radialSegments:r,closed:s};let o=e.computeFrenetFrames(n,s);this.tangents=o.tangents,this.normals=o.normals,this.binormals=o.binormals;let a=new L,l=new L,c=new Ce,d=new L,f=[],h=[],p=[],x=[];M(),this.setIndex(x),this.setAttribute("position",new Tt(f,3)),this.setAttribute("normal",new Tt(h,3)),this.setAttribute("uv",new Tt(p,2));function M(){for(let y=0;y<n;y++)_(y);_(s===!1?n:0),m(),u()}function _(y){d=e.getPointAt(y/n,d);let w=o.normals[y],R=o.binormals[y];for(let E=0;E<=r;E++){let A=E/r*Math.PI*2,g=Math.sin(A),b=-Math.cos(A);l.x=b*w.x+g*R.x,l.y=b*w.y+g*R.y,l.z=b*w.z+g*R.z,l.normalize(),h.push(l.x,l.y,l.z),a.x=d.x+i*l.x,a.y=d.y+i*l.y,a.z=d.z+i*l.z,f.push(a.x,a.y,a.z)}}function u(){for(let y=1;y<=n;y++)for(let w=1;w<=r;w++){let R=(r+1)*(y-1)+(w-1),E=(r+1)*y+(w-1),A=(r+1)*y+w,g=(r+1)*(y-1)+w;x.push(R,E,g),x.push(E,A,g)}}function m(){for(let y=0;y<=n;y++)for(let w=0;w<=r;w++)c.x=y/n,c.y=w/r,p.push(c.x,c.y)}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON();return e.path=this.parameters.path.toJSON(),e}static fromJSON(e){return new t(new S1[e.path.type]().fromJSON(e.path),e.tubularSegments,e.radius,e.radialSegments,e.closed)}};function ys(t){let e={};for(let n in t){e[n]={};for(let i in t[n]){let r=t[n][i];if(tx(r))r.isRenderTargetTexture?(Le("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[n][i]=null):e[n][i]=r.clone();else if(Array.isArray(r))if(tx(r[0])){let s=[];for(let o=0,a=r.length;o<a;o++)s[o]=r[o].clone();e[n][i]=s}else e[n][i]=r.slice();else e[n][i]=r}}return e}function hn(t){let e={};for(let n=0;n<t.length;n++){let i=ys(t[n]);for(let r in i)e[r]=i[r]}return e}function tx(t){return t&&(t.isColor||t.isMatrix3||t.isMatrix4||t.isVector2||t.isVector3||t.isVector4||t.isTexture||t.isQuaternion)}function M1(t){let e=[];for(let n=0;n<t.length;n++)e.push(t[n].clone());return e}function Cm(t){let e=t.getRenderTarget();return e===null?t.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:je.workingColorSpace}var Hx={clone:ys,merge:hn},w1=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,E1=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,zn=class extends Ur{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=w1,this.fragmentShader=E1,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=ys(e.uniforms),this.uniformsGroups=M1(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let n=super.toJSON(e);n.glslVersion=this.glslVersion,n.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?n.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?n.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?n.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?n.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?n.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?n.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?n.uniforms[r]={type:"m4",value:o.toArray()}:n.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}},zu=class extends zn{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},Ja=class extends Ur{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Ke(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ke(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Gh,this.normalScale=new Ce(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new tr,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var Vu=class extends Ur{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Px,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Gu=class extends Ur{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function uu(t,e){return!t||t.constructor===e?t:typeof e.BYTES_PER_ELEMENT=="number"?new e(t):Array.prototype.slice.call(t)}var Fr=class{constructor(e,n,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let n=this.parameterPositions,i=this._cachedIndex,r=n[i],s=n[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=n[++i],e<r)break t}o=n.length;break n}if(!(e>=s)){let a=n[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=n[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<n[a]?o=a:i=a+1}if(r=n[i],s=n[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let n=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)n[o]=i[s+o];return n}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Hu=class extends Fr{constructor(e,n,i,r){super(e,n,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Jp,endingEnd:Jp}}intervalChanged_(e,n,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case Kp:s=e,a=2*n-i;break;case jp:s=r.length-2,a=n+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case Kp:o=e,l=2*i-n;break;case jp:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=n}let c=(i-n)*.5,d=this.valueSize;this._weightPrev=c/(n-a),this._weightNext=c/(l-i),this._offsetPrev=s*d,this._offsetNext=o*d}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this._offsetPrev,f=this._offsetNext,h=this._weightPrev,p=this._weightNext,x=(i-n)/(r-n),M=x*x,_=M*x,u=-h*_+2*h*M-h*x,m=(1+h)*_+(-1.5-2*h)*M+(-.5+h)*x+1,y=(-1-p)*_+(1.5+p)*M+.5*x,w=p*_-p*M;for(let R=0;R!==a;++R)s[R]=u*o[d+R]+m*o[c+R]+y*o[l+R]+w*o[f+R];return s}},Wu=class extends Fr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=(i-n)/(r-n),f=1-d;for(let h=0;h!==a;++h)s[h]=o[c+h]*f+o[l+h]*d;return s}},Xu=class extends Fr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},Yu=class extends Fr{interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this.settings||this.DefaultSettings_,f=d.inTangents,h=d.outTangents;if(!f||!h){let M=(i-n)/(r-n),_=1-M;for(let u=0;u!==a;++u)s[u]=o[c+u]*_+o[l+u]*M;return s}let p=a*2,x=e-1;for(let M=0;M!==a;++M){let _=o[c+M],u=o[l+M],m=x*p+M*2,y=h[m],w=h[m+1],R=e*p+M*2,E=f[R],A=f[R+1],g=(i-n)/(r-n),b,I,P,N,F;for(let W=0;W<8;W++){b=g*g,I=b*g,P=1-g,N=P*P,F=N*P;let G=F*n+3*N*g*y+3*P*b*E+I*r-i;if(Math.abs(G)<1e-10)break;let H=3*N*(y-n)+6*P*g*(E-y)+3*b*(r-E);if(Math.abs(H)<1e-10)break;g=g-G/H,g=Math.max(0,Math.min(1,g))}s[M]=F*_+3*N*g*w+3*P*b*A+I*u}return s}},Vn=class{constructor(e,n,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=uu(n,this.TimeBufferType),this.values=uu(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let n=e.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(e);else{i={name:e.name,times:uu(e.times,Array),values:uu(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new Xu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Wu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Hu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let n=new Yu(this.times,this.values,this.getValueSize(),e);return this.settings&&(n.settings=this.settings),n}setInterpolation(e){let n;switch(e){case Na:n=this.InterpolantFactoryMethodDiscrete;break;case Tu:n=this.InterpolantFactoryMethodLinear;break;case fu:n=this.InterpolantFactoryMethodSmooth;break;case $p:n=this.InterpolantFactoryMethodBezier;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return Le("KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Na;case this.InterpolantFactoryMethodLinear:return Tu;case this.InterpolantFactoryMethodSmooth:return fu;case this.InterpolantFactoryMethodBezier:return $p}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]+=e}return this}scale(e){if(e!==1){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]*=e}return this}trim(e,n){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>n;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(De("KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(De("KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){De("KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){De("KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&ZM(r))for(let a=0,l=r.length;a!==l;++a){let c=r[a];if(isNaN(c)){De("KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===fu,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,c=e[a],d=e[a+1];if(c!==d&&(a!==1||c!==e[0]))if(r)l=!0;else{let f=a*i,h=f-i,p=f+i;for(let x=0;x!==i;++x){let M=n[f+x];if(M!==n[h+x]||M!==n[p+x]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let f=a*i,h=o*i;for(let p=0;p!==i;++p)n[h+p]=n[f+p]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,c=0;c!==i;++c)n[l+c]=n[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=n.slice(0,o*i)):(this.times=e,this.values=n),this}clone(){let e=this.times.slice(),n=this.values.slice(),i=this.constructor,r=new i(this.name,e,n);return r.createInterpolant=this.createInterpolant,r}};Vn.prototype.ValueTypeName="";Vn.prototype.TimeBufferType=Float32Array;Vn.prototype.ValueBufferType=Float32Array;Vn.prototype.DefaultInterpolation=Tu;var Or=class extends Vn{constructor(e,n,i){super(e,n,i)}};Or.prototype.ValueTypeName="bool";Or.prototype.ValueBufferType=Array;Or.prototype.DefaultInterpolation=Na;Or.prototype.InterpolantFactoryMethodLinear=void 0;Or.prototype.InterpolantFactoryMethodSmooth=void 0;var qu=class extends Vn{constructor(e,n,i,r){super(e,n,i,r)}};qu.prototype.ValueTypeName="color";var Zu=class extends Vn{constructor(e,n,i,r){super(e,n,i,r)}};Zu.prototype.ValueTypeName="number";var $u=class extends Fr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-n)/(r-n),c=e*a;for(let d=c+a;c!==d;c+=4)Ri.slerpFlat(s,0,o,c-a,o,c,l);return s}},Ka=class extends Vn{constructor(e,n,i,r){super(e,n,i,r)}InterpolantFactoryMethodLinear(e){return new $u(this.times,this.values,this.getValueSize(),e)}};Ka.prototype.ValueTypeName="quaternion";Ka.prototype.InterpolantFactoryMethodSmooth=void 0;var Br=class extends Vn{constructor(e,n,i){super(e,n,i)}};Br.prototype.ValueTypeName="string";Br.prototype.ValueBufferType=Array;Br.prototype.DefaultInterpolation=Na;Br.prototype.InterpolantFactoryMethodLinear=void 0;Br.prototype.InterpolantFactoryMethodSmooth=void 0;var Ju=class extends Vn{constructor(e,n,i,r){super(e,n,i,r)}};Ju.prototype.ValueTypeName="vector";var Ku=class{constructor(e,n,i){let r=this,s=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=n,this.onError=i,this._abortController=null,this.itemStart=function(d){a++,s===!1&&r.onStart!==void 0&&r.onStart(d,o,a),s=!0},this.itemEnd=function(d){o++,r.onProgress!==void 0&&r.onProgress(d,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(d){r.onError!==void 0&&r.onError(d)},this.resolveURL=function(d){return l?l(d):d},this.setURLModifier=function(d){return l=d,this},this.addHandler=function(d,f){return c.push(d,f),this},this.removeHandler=function(d){let f=c.indexOf(d);return f!==-1&&c.splice(f,2),this},this.getHandler=function(d){for(let f=0,h=c.length;f<h;f+=2){let p=c[f],x=c[f+1];if(p.global&&(p.lastIndex=0),p.test(d))return x}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Wx=new Ku,ju=class{constructor(e){this.manager=e!==void 0?e:Wx,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,n){let i=this;return new Promise(function(r,s){i.load(e,r,n,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};ju.DEFAULT_MATERIAL_NAME="__DEFAULT";var ja=class extends un{constructor(e,n=1){super(),this.isLight=!0,this.type="Light",this.color=new Ke(e),this.intensity=n}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,n){return super.copy(e,n),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let n=super.toJSON(e);return n.object.color=this.color.getHex(),n.object.intensity=this.intensity,n}},Qa=class extends ja{constructor(e,n,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(un.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ke(n)}copy(e,n){return super.copy(e,n),this.groundColor.copy(e.groundColor),this}toJSON(e){let n=super.toJSON(e);return n.object.groundColor=this.groundColor.getHex(),n}},Zp=new Pt,nx=new L,ix=new L,tm=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ce(512,512),this.mapType=Rn,this.map=null,this.mapPass=null,this.matrix=new Pt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Mo,this._frameExtents=new Ce(1,1),this._viewportCount=1,this._viewports=[new It(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let n=this.camera,i=this.matrix;nx.setFromMatrixPosition(e.matrixWorld),n.position.copy(nx),ix.setFromMatrixPosition(e.target.matrixWorld),n.lookAt(ix),n.updateMatrixWorld(),Zp.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Zp,n.coordinateSystem,n.reversedDepth),n.coordinateSystem===go||n.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(Zp)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},hu=new L,du=new Ri,Ei=new L,el=class extends un{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Pt,this.projectionMatrix=new Pt,this.projectionMatrixInverse=new Pt,this.coordinateSystem=ui,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,n){return super.copy(e,n),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(hu,du,Ei),Ei.x===1&&Ei.y===1&&Ei.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(hu,du,Ei.set(1,1,1)).invert()}updateWorldMatrix(e,n){super.updateWorldMatrix(e,n),this.matrixWorld.decompose(hu,du,Ei),Ei.x===1&&Ei.y===1&&Ei.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(hu,du,Ei.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Lr=new L,rx=new Ce,sx=new Ce,An=class extends el{constructor(e=50,n=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let n=.5*this.getFilmHeight()/e;this.fov=Au*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Mp*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Au*2*Math.atan(Math.tan(Mp*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,n,i){Lr.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Lr.x,Lr.y).multiplyScalar(-e/Lr.z),Lr.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Lr.x,Lr.y).multiplyScalar(-e/Lr.z)}getViewSize(e,n){return this.getViewBounds(e,rx,sx),n.subVectors(sx,rx)}setViewOffset(e,n,i,r,s,o){this.aspect=e/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,n=e*Math.tan(Mp*.5*this.fov)/this.zoom,i=2*n,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,n-=o.offsetY*i/c,r*=o.width/l,i*=o.height/c}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,n,n-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}};var kr=class extends el{constructor(e=-1,n=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=n,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,n,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+n,l=r-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,d=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=d*this.view.offsetY,l=a-d*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}},nm=class extends tm{constructor(){super(new kr(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},tl=class extends ja{constructor(e,n){super(e,n),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(un.DEFAULT_UP),this.updateMatrix(),this.target=new un,this.shadow=new nm}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let n=super.toJSON(e);return n.object.shadow=this.shadow.toJSON(),n.object.target=this.target.uuid,n}};var fo=-90,po=1,Qu=class extends un{constructor(e,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new An(fo,po,e,n);r.layers=this.layers,this.add(r);let s=new An(fo,po,e,n);s.layers=this.layers,this.add(s);let o=new An(fo,po,e,n);o.layers=this.layers,this.add(o);let a=new An(fo,po,e,n);a.layers=this.layers,this.add(a);let l=new An(fo,po,e,n);l.layers=this.layers,this.add(l);let c=new An(fo,po,e,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,n=this.children.concat(),[i,r,s,o,a,l]=n;for(let c of n)this.remove(c);if(e===ui)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===go)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of n)this.add(c),c.updateMatrixWorld()}update(e,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,c,d]=this.children,f=e.getRenderTarget(),h=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),x=e.xr.enabled;e.xr.enabled=!1;let M=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let _=!1;e.isWebGLRenderer===!0?_=e.state.buffers.depth.getReversed():_=e.reversedDepthBuffer,e.setRenderTarget(i,0,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,s),e.setRenderTarget(i,1,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,o),e.setRenderTarget(i,2,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,a),e.setRenderTarget(i,3,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,l),e.setRenderTarget(i,4,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,c),i.texture.generateMipmaps=M,e.setRenderTarget(i,5,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,d),e.setRenderTarget(f,h,p),e.xr.enabled=x,i.texture.needsPMREMUpdate=!0}},eh=class extends An{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Rm="\\[\\]\\.:\\/",T1=new RegExp("["+Rm+"]","g"),Pm="[^"+Rm+"]",b1="[^"+Rm.replace("\\.","")+"]",A1=/((?:WC+[\/:])*)/.source.replace("WC",Pm),C1=/(WCOD+)?/.source.replace("WCOD",b1),R1=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Pm),P1=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Pm),I1=new RegExp("^"+A1+C1+R1+P1+"$"),L1=["material","materials","bones","map"],im=class{constructor(e,n,i){let r=i||Mt.parseTrackName(n);this._targetGroup=e,this._bindings=e.subscribe_(n,r)}getValue(e,n){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,n)}setValue(e,n){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,n)}bind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].bind()}unbind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].unbind()}},Mt=class t{constructor(e,n,i){this.path=n,this.parsedPath=i||t.parseTrackName(n),this.node=t.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,n,i){return e&&e.isAnimationObjectGroup?new t.Composite(e,n,i):new t(e,n,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(T1,"")}static parseTrackName(e){let n=I1.exec(e);if(n===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);L1.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,n){if(n===void 0||n===""||n==="."||n===-1||n===e.name||n===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(n);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===n||a.uuid===n)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,n){e[n]=this.targetObject[this.propertyName]}_getValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[n++]=i[r]}_getValue_arrayElement(e,n){e[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,n){this.resolvedProperty.toArray(e,n)}_setValue_direct(e,n){this.targetObject[this.propertyName]=e[n]}_setValue_direct_setNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++]}_setValue_array_setNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,n){this.resolvedProperty[this.propertyIndex]=e[n]}_setValue_arrayElement_setNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,n){this.resolvedProperty.fromArray(e,n)}_setValue_fromArray_setNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,n){this.bind(),this.getValue(e,n)}_setValue_unbound(e,n){this.bind(),this.setValue(e,n)}bind(){let e=this.node,n=this.parsedPath,i=n.objectName,r=n.propertyName,s=n.propertyIndex;if(e||(e=t.findNode(this.rootNode,n.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Le("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!e.material){De("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){De("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){De("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let d=0;d<e.length;d++)if(e[d].name===c){c=d;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){De("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){De("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){De("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){De("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[r];if(o===void 0){let c=n.nodeName;De("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){De("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){De("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};Mt.Composite=im;Mt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};Mt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};Mt.prototype.GetterByBindingType=[Mt.prototype._getValue_direct,Mt.prototype._getValue_array,Mt.prototype._getValue_arrayElement,Mt.prototype._getValue_toArray];Mt.prototype.SetterByBindingTypeAndVersioning=[[Mt.prototype._setValue_direct,Mt.prototype._setValue_direct_setNeedsUpdate,Mt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Mt.prototype._setValue_array,Mt.prototype._setValue_array_setNeedsUpdate,Mt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Mt.prototype._setValue_arrayElement,Mt.prototype._setValue_arrayElement_setNeedsUpdate,Mt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Mt.prototype._setValue_fromArray,Mt.prototype._setValue_fromArray_setNeedsUpdate,Mt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var zA=new Float32Array(1);var Fm=class Fm{constructor(e,n,i,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,n,i,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,n=0){for(let i=0;i<4;i++)this.elements[i]=e[i+n];return this}set(e,n,i,r){let s=this.elements;return s[0]=e,s[2]=n,s[1]=i,s[3]=r,this}};Fm.prototype.isMatrix2=!0;var rm=Fm;function Im(t,e,n,i){let r=N1(i);switch(n){case Mm:return t*e;case Em:return t*e/r.components*r.byteLength;case ch:return t*e/r.components*r.byteLength;case Hr:return t*e*2/r.components*r.byteLength;case uh:return t*e*2/r.components*r.byteLength;case wm:return t*e*3/r.components*r.byteLength;case Kn:return t*e*4/r.components*r.byteLength;case hh:return t*e*4/r.components*r.byteLength;case sl:case ol:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case al:case ll:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case fh:case mh:return Math.max(t,16)*Math.max(e,8)/4;case dh:case ph:return Math.max(t,8)*Math.max(e,8)/2;case gh:case _h:case xh:case yh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case vh:case cl:case Sh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Mh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case wh:return Math.floor((t+4)/5)*Math.floor((e+3)/4)*16;case Eh:return Math.floor((t+4)/5)*Math.floor((e+4)/5)*16;case Th:return Math.floor((t+5)/6)*Math.floor((e+4)/5)*16;case bh:return Math.floor((t+5)/6)*Math.floor((e+5)/6)*16;case Ah:return Math.floor((t+7)/8)*Math.floor((e+4)/5)*16;case Ch:return Math.floor((t+7)/8)*Math.floor((e+5)/6)*16;case Rh:return Math.floor((t+7)/8)*Math.floor((e+7)/8)*16;case Ph:return Math.floor((t+9)/10)*Math.floor((e+4)/5)*16;case Ih:return Math.floor((t+9)/10)*Math.floor((e+5)/6)*16;case Lh:return Math.floor((t+9)/10)*Math.floor((e+7)/8)*16;case Nh:return Math.floor((t+9)/10)*Math.floor((e+9)/10)*16;case Dh:return Math.floor((t+11)/12)*Math.floor((e+9)/10)*16;case Uh:return Math.floor((t+11)/12)*Math.floor((e+11)/12)*16;case Fh:case Oh:case Bh:return Math.ceil(t/4)*Math.ceil(e/4)*16;case kh:case zh:return Math.ceil(t/4)*Math.ceil(e/4)*8;case ul:case Vh:return Math.ceil(t/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function N1(t){switch(t){case Rn:case vm:return{byteLength:1,components:1};case To:case xm:case Ni:return{byteLength:2,components:1};case ah:case lh:return{byteLength:2,components:4};case fi:case oh:case pi:return{byteLength:4,components:1};case ym:case Sm:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${t}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:nh}}));typeof window<"u"&&(window.__THREE__?Le("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=nh);function fy(){let t=null,e=!1,n=null,i=null;function r(s,o){n(s,o),i=t.requestAnimationFrame(r)}return{start:function(){e!==!0&&n!==null&&t!==null&&(i=t.requestAnimationFrame(r),e=!0)},stop:function(){t!==null&&t.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){n=s},setContext:function(s){t=s}}}function D1(t){let e=new WeakMap;function n(a,l){let c=a.array,d=a.usage,f=c.byteLength,h=t.createBuffer();t.bindBuffer(l,h),t.bufferData(l,c,d),a.onUploadCallback();let p;if(c instanceof Float32Array)p=t.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)p=t.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?p=t.HALF_FLOAT:p=t.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=t.SHORT;else if(c instanceof Uint32Array)p=t.UNSIGNED_INT;else if(c instanceof Int32Array)p=t.INT;else if(c instanceof Int8Array)p=t.BYTE;else if(c instanceof Uint8Array)p=t.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=t.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:h,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:f}}function i(a,l,c){let d=l.array,f=l.updateRanges;if(t.bindBuffer(c,a),f.length===0)t.bufferSubData(c,0,d);else{f.sort((p,x)=>p.start-x.start);let h=0;for(let p=1;p<f.length;p++){let x=f[h],M=f[p];M.start<=x.start+x.count+1?x.count=Math.max(x.count,M.start+M.count-x.start):(++h,f[h]=M)}f.length=h+1;for(let p=0,x=f.length;p<x;p++){let M=f[p];t.bufferSubData(c,M.start*d.BYTES_PER_ELEMENT,d,M.start,M.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(t.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let d=e.get(a);(!d||d.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=e.get(a);if(c===void 0)e.set(a,n(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}var U1=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,F1=`#ifdef USE_ALPHAHASH
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
#endif`,O1=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,B1=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,k1=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,z1=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,V1=`#ifdef USE_AOMAP
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
#endif`,G1=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,H1=`#ifdef USE_BATCHING
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
#endif`,W1=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,X1=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Y1=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,q1=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,Z1=`#ifdef USE_IRIDESCENCE
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
#endif`,$1=`#ifdef USE_BUMPMAP
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
#endif`,J1=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,K1=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,j1=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Q1=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,ew=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,tw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,nw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,iw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,rw=`#define PI 3.141592653589793
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
} // validated`,sw=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,ow=`vec3 transformedNormal = objectNormal;
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
#endif`,aw=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,lw=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,cw=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,uw=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,hw="gl_FragColor = linearToOutputTexel( gl_FragColor );",dw=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,fw=`#ifdef USE_ENVMAP
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
#endif`,pw=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,mw=`#ifdef USE_ENVMAP
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
#endif`,gw=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,_w=`#ifdef USE_ENVMAP
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
#endif`,vw=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,xw=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,yw=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Sw=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Mw=`#ifdef USE_GRADIENTMAP
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
}`,ww=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Ew=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Tw=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,bw=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,Aw=`#ifdef USE_ENVMAP
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
#endif`,Cw=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Rw=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Pw=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Iw=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Lw=`PhysicalMaterial material;
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
#endif`,Nw=`uniform sampler2D dfgLUT;
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
}`,Dw=`
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
#endif`,Uw=`#if defined( RE_IndirectDiffuse )
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
#endif`,Fw=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Ow=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,Bw=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,kw=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,zw=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Vw=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Gw=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Hw=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Ww=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,Xw=`#if defined( USE_POINTS_UV )
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
#endif`,Yw=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,qw=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Zw=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,$w=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Jw=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Kw=`#ifdef USE_MORPHTARGETS
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
#endif`,jw=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Qw=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,eE=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,tE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,nE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,iE=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,rE=`#ifdef USE_NORMALMAP
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
#endif`,sE=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,oE=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,aE=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,lE=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,cE=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,uE=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,hE=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,dE=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,fE=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,pE=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,mE=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,gE=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,_E=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,vE=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,xE=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,yE=`float getShadowMask() {
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
}`,SE=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,ME=`#ifdef USE_SKINNING
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
#endif`,wE=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,EE=`#ifdef USE_SKINNING
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
#endif`,TE=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,bE=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,AE=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,CE=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,RE=`#ifdef USE_TRANSMISSION
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
#endif`,PE=`#ifdef USE_TRANSMISSION
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
#endif`,IE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,LE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,NE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,DE=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,UE=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,FE=`uniform sampler2D t2D;
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
}`,OE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,BE=`#ifdef ENVMAP_TYPE_CUBE
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
}`,kE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,zE=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,VE=`#include <common>
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
}`,GE=`#if DEPTH_PACKING == 3200
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
}`,HE=`#define DISTANCE
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
}`,WE=`#define DISTANCE
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
}`,XE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,YE=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,qE=`uniform float scale;
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
}`,ZE=`uniform vec3 diffuse;
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
}`,$E=`#include <common>
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
}`,JE=`uniform vec3 diffuse;
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
}`,KE=`#define LAMBERT
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
}`,jE=`#define LAMBERT
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
}`,QE=`#define MATCAP
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
}`,eT=`#define MATCAP
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
}`,tT=`#define NORMAL
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
}`,nT=`#define NORMAL
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
}`,iT=`#define PHONG
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
}`,rT=`#define PHONG
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
}`,sT=`#define STANDARD
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
}`,oT=`#define STANDARD
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
}`,aT=`#define TOON
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
}`,lT=`#define TOON
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
}`,cT=`uniform float size;
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
}`,uT=`uniform vec3 diffuse;
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
}`,hT=`#include <common>
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
}`,dT=`uniform vec3 color;
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
}`,fT=`uniform float rotation;
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
}`,pT=`uniform vec3 diffuse;
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
}`,Xe={alphahash_fragment:U1,alphahash_pars_fragment:F1,alphamap_fragment:O1,alphamap_pars_fragment:B1,alphatest_fragment:k1,alphatest_pars_fragment:z1,aomap_fragment:V1,aomap_pars_fragment:G1,batching_pars_vertex:H1,batching_vertex:W1,begin_vertex:X1,beginnormal_vertex:Y1,bsdfs:q1,iridescence_fragment:Z1,bumpmap_pars_fragment:$1,clipping_planes_fragment:J1,clipping_planes_pars_fragment:K1,clipping_planes_pars_vertex:j1,clipping_planes_vertex:Q1,color_fragment:ew,color_pars_fragment:tw,color_pars_vertex:nw,color_vertex:iw,common:rw,cube_uv_reflection_fragment:sw,defaultnormal_vertex:ow,displacementmap_pars_vertex:aw,displacementmap_vertex:lw,emissivemap_fragment:cw,emissivemap_pars_fragment:uw,colorspace_fragment:hw,colorspace_pars_fragment:dw,envmap_fragment:fw,envmap_common_pars_fragment:pw,envmap_pars_fragment:mw,envmap_pars_vertex:gw,envmap_physical_pars_fragment:Aw,envmap_vertex:_w,fog_vertex:vw,fog_pars_vertex:xw,fog_fragment:yw,fog_pars_fragment:Sw,gradientmap_pars_fragment:Mw,lightmap_pars_fragment:ww,lights_lambert_fragment:Ew,lights_lambert_pars_fragment:Tw,lights_pars_begin:bw,lights_toon_fragment:Cw,lights_toon_pars_fragment:Rw,lights_phong_fragment:Pw,lights_phong_pars_fragment:Iw,lights_physical_fragment:Lw,lights_physical_pars_fragment:Nw,lights_fragment_begin:Dw,lights_fragment_maps:Uw,lights_fragment_end:Fw,lightprobes_pars_fragment:Ow,logdepthbuf_fragment:Bw,logdepthbuf_pars_fragment:kw,logdepthbuf_pars_vertex:zw,logdepthbuf_vertex:Vw,map_fragment:Gw,map_pars_fragment:Hw,map_particle_fragment:Ww,map_particle_pars_fragment:Xw,metalnessmap_fragment:Yw,metalnessmap_pars_fragment:qw,morphinstance_vertex:Zw,morphcolor_vertex:$w,morphnormal_vertex:Jw,morphtarget_pars_vertex:Kw,morphtarget_vertex:jw,normal_fragment_begin:Qw,normal_fragment_maps:eE,normal_pars_fragment:tE,normal_pars_vertex:nE,normal_vertex:iE,normalmap_pars_fragment:rE,clearcoat_normal_fragment_begin:sE,clearcoat_normal_fragment_maps:oE,clearcoat_pars_fragment:aE,iridescence_pars_fragment:lE,opaque_fragment:cE,packing:uE,premultiplied_alpha_fragment:hE,project_vertex:dE,dithering_fragment:fE,dithering_pars_fragment:pE,roughnessmap_fragment:mE,roughnessmap_pars_fragment:gE,shadowmap_pars_fragment:_E,shadowmap_pars_vertex:vE,shadowmap_vertex:xE,shadowmask_pars_fragment:yE,skinbase_vertex:SE,skinning_pars_vertex:ME,skinning_vertex:wE,skinnormal_vertex:EE,specularmap_fragment:TE,specularmap_pars_fragment:bE,tonemapping_fragment:AE,tonemapping_pars_fragment:CE,transmission_fragment:RE,transmission_pars_fragment:PE,uv_pars_fragment:IE,uv_pars_vertex:LE,uv_vertex:NE,worldpos_vertex:DE,background_vert:UE,background_frag:FE,backgroundCube_vert:OE,backgroundCube_frag:BE,cube_vert:kE,cube_frag:zE,depth_vert:VE,depth_frag:GE,distance_vert:HE,distance_frag:WE,equirect_vert:XE,equirect_frag:YE,linedashed_vert:qE,linedashed_frag:ZE,meshbasic_vert:$E,meshbasic_frag:JE,meshlambert_vert:KE,meshlambert_frag:jE,meshmatcap_vert:QE,meshmatcap_frag:eT,meshnormal_vert:tT,meshnormal_frag:nT,meshphong_vert:iT,meshphong_frag:rT,meshphysical_vert:sT,meshphysical_frag:oT,meshtoon_vert:aT,meshtoon_frag:lT,points_vert:cT,points_frag:uT,shadow_vert:hT,shadow_frag:dT,sprite_vert:fT,sprite_frag:pT},ye={common:{diffuse:{value:new Ke(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new He},alphaMap:{value:null},alphaMapTransform:{value:new He},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new He}},envmap:{envMap:{value:null},envMapRotation:{value:new He},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new He}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new He}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new He},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new He},normalScale:{value:new Ce(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new He},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new He}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new He}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new He}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ke(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new L},probesMax:{value:new L},probesResolution:{value:new L}},points:{diffuse:{value:new Ke(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new He},alphaTest:{value:0},uvTransform:{value:new He}},sprite:{diffuse:{value:new Ke(16777215)},opacity:{value:1},center:{value:new Ce(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new He},alphaMap:{value:null},alphaMapTransform:{value:new He},alphaTest:{value:0}}},Ui={basic:{uniforms:hn([ye.common,ye.specularmap,ye.envmap,ye.aomap,ye.lightmap,ye.fog]),vertexShader:Xe.meshbasic_vert,fragmentShader:Xe.meshbasic_frag},lambert:{uniforms:hn([ye.common,ye.specularmap,ye.envmap,ye.aomap,ye.lightmap,ye.emissivemap,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.fog,ye.lights,{emissive:{value:new Ke(0)},envMapIntensity:{value:1}}]),vertexShader:Xe.meshlambert_vert,fragmentShader:Xe.meshlambert_frag},phong:{uniforms:hn([ye.common,ye.specularmap,ye.envmap,ye.aomap,ye.lightmap,ye.emissivemap,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.fog,ye.lights,{emissive:{value:new Ke(0)},specular:{value:new Ke(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Xe.meshphong_vert,fragmentShader:Xe.meshphong_frag},standard:{uniforms:hn([ye.common,ye.envmap,ye.aomap,ye.lightmap,ye.emissivemap,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.roughnessmap,ye.metalnessmap,ye.fog,ye.lights,{emissive:{value:new Ke(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Xe.meshphysical_vert,fragmentShader:Xe.meshphysical_frag},toon:{uniforms:hn([ye.common,ye.aomap,ye.lightmap,ye.emissivemap,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.gradientmap,ye.fog,ye.lights,{emissive:{value:new Ke(0)}}]),vertexShader:Xe.meshtoon_vert,fragmentShader:Xe.meshtoon_frag},matcap:{uniforms:hn([ye.common,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.fog,{matcap:{value:null}}]),vertexShader:Xe.meshmatcap_vert,fragmentShader:Xe.meshmatcap_frag},points:{uniforms:hn([ye.points,ye.fog]),vertexShader:Xe.points_vert,fragmentShader:Xe.points_frag},dashed:{uniforms:hn([ye.common,ye.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Xe.linedashed_vert,fragmentShader:Xe.linedashed_frag},depth:{uniforms:hn([ye.common,ye.displacementmap]),vertexShader:Xe.depth_vert,fragmentShader:Xe.depth_frag},normal:{uniforms:hn([ye.common,ye.bumpmap,ye.normalmap,ye.displacementmap,{opacity:{value:1}}]),vertexShader:Xe.meshnormal_vert,fragmentShader:Xe.meshnormal_frag},sprite:{uniforms:hn([ye.sprite,ye.fog]),vertexShader:Xe.sprite_vert,fragmentShader:Xe.sprite_frag},background:{uniforms:{uvTransform:{value:new He},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Xe.background_vert,fragmentShader:Xe.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new He}},vertexShader:Xe.backgroundCube_vert,fragmentShader:Xe.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Xe.cube_vert,fragmentShader:Xe.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Xe.equirect_vert,fragmentShader:Xe.equirect_frag},distance:{uniforms:hn([ye.common,ye.displacementmap,{referencePosition:{value:new L},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Xe.distance_vert,fragmentShader:Xe.distance_frag},shadow:{uniforms:hn([ye.lights,ye.fog,{color:{value:new Ke(0)},opacity:{value:1}}]),vertexShader:Xe.shadow_vert,fragmentShader:Xe.shadow_frag}};Ui.physical={uniforms:hn([Ui.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new He},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new He},clearcoatNormalScale:{value:new Ce(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new He},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new He},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new He},sheen:{value:0},sheenColor:{value:new Ke(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new He},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new He},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new He},transmissionSamplerSize:{value:new Ce},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new He},attenuationDistance:{value:0},attenuationColor:{value:new Ke(0)},specularColor:{value:new Ke(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new He},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new He},anisotropyVector:{value:new Ce},anisotropyMap:{value:null},anisotropyMapTransform:{value:new He}}]),vertexShader:Xe.meshphysical_vert,fragmentShader:Xe.meshphysical_frag};var Xh={r:0,b:0,g:0},mT=new Pt,py=new He;py.set(-1,0,0,0,1,0,0,0,1);function gT(t,e,n,i,r,s){let o=new Ke(0),a=r===!0?0:1,l,c,d=null,f=0,h=null;function p(m){let y=m.isScene===!0?m.background:null;if(y&&y.isTexture){let w=m.backgroundBlurriness>0;y=e.get(y,w)}return y}function x(m){let y=!1,w=p(m);w===null?_(o,a):w&&w.isColor&&(_(w,1),y=!0);let R=t.xr.getEnvironmentBlendMode();R==="additive"?n.buffers.color.setClear(0,0,0,1,s):R==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,s),(t.autoClear||y)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),t.clear(t.autoClearColor,t.autoClearDepth,t.autoClearStencil))}function M(m,y){let w=p(y);w&&(w.isCubeTexture||w.mapping===il)?(c===void 0&&(c=new Bt(new Pi(1,1,1),new zn({name:"BackgroundCubeMaterial",uniforms:ys(Ui.backgroundCube.uniforms),vertexShader:Ui.backgroundCube.vertexShader,fragmentShader:Ui.backgroundCube.fragmentShader,side:vn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(R,E,A){this.matrixWorld.copyPosition(A.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(c)),c.material.uniforms.envMap.value=w,c.material.uniforms.backgroundBlurriness.value=y.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(mT.makeRotationFromEuler(y.backgroundRotation)).transpose(),w.isCubeTexture&&w.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(py),c.material.toneMapped=je.getTransfer(w.colorSpace)!==at,(d!==w||f!==w.version||h!==t.toneMapping)&&(c.material.needsUpdate=!0,d=w,f=w.version,h=t.toneMapping),c.layers.enableAll(),m.unshift(c,c.geometry,c.material,0,0,null)):w&&w.isTexture&&(l===void 0&&(l=new Bt(new vs(2,2),new zn({name:"BackgroundMaterial",uniforms:ys(Ui.background.uniforms),vertexShader:Ui.background.vertexShader,fragmentShader:Ui.background.fragmentShader,side:er,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=w,l.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,l.material.toneMapped=je.getTransfer(w.colorSpace)!==at,w.matrixAutoUpdate===!0&&w.updateMatrix(),l.material.uniforms.uvTransform.value.copy(w.matrix),(d!==w||f!==w.version||h!==t.toneMapping)&&(l.material.needsUpdate=!0,d=w,f=w.version,h=t.toneMapping),l.layers.enableAll(),m.unshift(l,l.geometry,l.material,0,0,null))}function _(m,y){m.getRGB(Xh,Cm(t)),n.buffers.color.setClear(Xh.r,Xh.g,Xh.b,y,s)}function u(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(m,y=1){o.set(m),a=y,_(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(m){a=m,_(o,a)},render:x,addToRenderList:M,dispose:u}}function _T(t,e){let n=t.getParameter(t.MAX_VERTEX_ATTRIBS),i={},r=h(null),s=r,o=!1;function a(P,N,F,W,z){let G=!1,H=f(P,W,F,N);s!==H&&(s=H,c(s.object)),G=p(P,W,F,z),G&&x(P,W,F,z),z!==null&&e.update(z,t.ELEMENT_ARRAY_BUFFER),(G||o)&&(o=!1,w(P,N,F,W),z!==null&&t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,e.get(z).buffer))}function l(){return t.createVertexArray()}function c(P){return t.bindVertexArray(P)}function d(P){return t.deleteVertexArray(P)}function f(P,N,F,W){let z=W.wireframe===!0,G=i[N.id];G===void 0&&(G={},i[N.id]=G);let H=P.isInstancedMesh===!0?P.id:0,ee=G[H];ee===void 0&&(ee={},G[H]=ee);let re=ee[F.id];re===void 0&&(re={},ee[F.id]=re);let se=re[z];return se===void 0&&(se=h(l()),re[z]=se),se}function h(P){let N=[],F=[],W=[];for(let z=0;z<n;z++)N[z]=0,F[z]=0,W[z]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:N,enabledAttributes:F,attributeDivisors:W,object:P,attributes:{},index:null}}function p(P,N,F,W){let z=s.attributes,G=N.attributes,H=0,ee=F.getAttributes();for(let re in ee)if(ee[re].location>=0){let ve=z[re],pe=G[re];if(pe===void 0&&(re==="instanceMatrix"&&P.instanceMatrix&&(pe=P.instanceMatrix),re==="instanceColor"&&P.instanceColor&&(pe=P.instanceColor)),ve===void 0||ve.attribute!==pe||pe&&ve.data!==pe.data)return!0;H++}return s.attributesNum!==H||s.index!==W}function x(P,N,F,W){let z={},G=N.attributes,H=0,ee=F.getAttributes();for(let re in ee)if(ee[re].location>=0){let ve=G[re];ve===void 0&&(re==="instanceMatrix"&&P.instanceMatrix&&(ve=P.instanceMatrix),re==="instanceColor"&&P.instanceColor&&(ve=P.instanceColor));let pe={};pe.attribute=ve,ve&&ve.data&&(pe.data=ve.data),z[re]=pe,H++}s.attributes=z,s.attributesNum=H,s.index=W}function M(){let P=s.newAttributes;for(let N=0,F=P.length;N<F;N++)P[N]=0}function _(P){u(P,0)}function u(P,N){let F=s.newAttributes,W=s.enabledAttributes,z=s.attributeDivisors;F[P]=1,W[P]===0&&(t.enableVertexAttribArray(P),W[P]=1),z[P]!==N&&(t.vertexAttribDivisor(P,N),z[P]=N)}function m(){let P=s.newAttributes,N=s.enabledAttributes;for(let F=0,W=N.length;F<W;F++)N[F]!==P[F]&&(t.disableVertexAttribArray(F),N[F]=0)}function y(P,N,F,W,z,G,H){H===!0?t.vertexAttribIPointer(P,N,F,z,G):t.vertexAttribPointer(P,N,F,W,z,G)}function w(P,N,F,W){M();let z=W.attributes,G=F.getAttributes(),H=N.defaultAttributeValues;for(let ee in G){let re=G[ee];if(re.location>=0){let se=z[ee];if(se===void 0&&(ee==="instanceMatrix"&&P.instanceMatrix&&(se=P.instanceMatrix),ee==="instanceColor"&&P.instanceColor&&(se=P.instanceColor)),se!==void 0){let ve=se.normalized,pe=se.itemSize,Pe=e.get(se);if(Pe===void 0)continue;let st=Pe.buffer,Oe=Pe.type,J=Pe.bytesPerElement,ge=Oe===t.INT||Oe===t.UNSIGNED_INT||se.gpuType===oh;if(se.isInterleavedBufferAttribute){let he=se.data,Ie=he.stride,Be=se.offset;if(he.isInstancedInterleavedBuffer){for(let Re=0;Re<re.locationSize;Re++)u(re.location+Re,he.meshPerAttribute);P.isInstancedMesh!==!0&&W._maxInstanceCount===void 0&&(W._maxInstanceCount=he.meshPerAttribute*he.count)}else for(let Re=0;Re<re.locationSize;Re++)_(re.location+Re);t.bindBuffer(t.ARRAY_BUFFER,st);for(let Re=0;Re<re.locationSize;Re++)y(re.location+Re,pe/re.locationSize,Oe,ve,Ie*J,(Be+pe/re.locationSize*Re)*J,ge)}else{if(se.isInstancedBufferAttribute){for(let he=0;he<re.locationSize;he++)u(re.location+he,se.meshPerAttribute);P.isInstancedMesh!==!0&&W._maxInstanceCount===void 0&&(W._maxInstanceCount=se.meshPerAttribute*se.count)}else for(let he=0;he<re.locationSize;he++)_(re.location+he);t.bindBuffer(t.ARRAY_BUFFER,st);for(let he=0;he<re.locationSize;he++)y(re.location+he,pe/re.locationSize,Oe,ve,pe*J,pe/re.locationSize*he*J,ge)}}else if(H!==void 0){let ve=H[ee];if(ve!==void 0)switch(ve.length){case 2:t.vertexAttrib2fv(re.location,ve);break;case 3:t.vertexAttrib3fv(re.location,ve);break;case 4:t.vertexAttrib4fv(re.location,ve);break;default:t.vertexAttrib1fv(re.location,ve)}}}}m()}function R(){b();for(let P in i){let N=i[P];for(let F in N){let W=N[F];for(let z in W){let G=W[z];for(let H in G)d(G[H].object),delete G[H];delete W[z]}}delete i[P]}}function E(P){if(i[P.id]===void 0)return;let N=i[P.id];for(let F in N){let W=N[F];for(let z in W){let G=W[z];for(let H in G)d(G[H].object),delete G[H];delete W[z]}}delete i[P.id]}function A(P){for(let N in i){let F=i[N];for(let W in F){let z=F[W];if(z[P.id]===void 0)continue;let G=z[P.id];for(let H in G)d(G[H].object),delete G[H];delete z[P.id]}}}function g(P){for(let N in i){let F=i[N],W=P.isInstancedMesh===!0?P.id:0,z=F[W];if(z!==void 0){for(let G in z){let H=z[G];for(let ee in H)d(H[ee].object),delete H[ee];delete z[G]}delete F[W],Object.keys(F).length===0&&delete i[N]}}}function b(){I(),o=!0,s!==r&&(s=r,c(s.object))}function I(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:b,resetDefaultState:I,dispose:R,releaseStatesOfGeometry:E,releaseStatesOfObject:g,releaseStatesOfProgram:A,initAttributes:M,enableAttribute:_,disableUnusedAttributes:m}}function vT(t,e,n){let i;function r(l){i=l}function s(l,c){t.drawArrays(i,l,c),n.update(c,i,1)}function o(l,c,d){d!==0&&(t.drawArraysInstanced(i,l,c,d),n.update(c,i,d))}function a(l,c,d){if(d===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,c,0,d);let h=0;for(let p=0;p<d;p++)h+=c[p];n.update(h,i,1)}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a}function xT(t,e,n,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let A=e.get("EXT_texture_filter_anisotropic");r=t.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(A){return!(A!==Kn&&i.convert(A)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(A){let g=A===Ni&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(A!==Rn&&i.convert(A)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE)&&A!==pi&&!g)}function l(A){if(A==="highp"){if(t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.HIGH_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.MEDIUM_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",d=l(c);d!==c&&(Le("WebGLRenderer:",c,"not supported, using",d,"instead."),c=d);let f=n.logarithmicDepthBuffer===!0,h=n.reversedDepthBuffer===!0&&e.has("EXT_clip_control");n.reversedDepthBuffer===!0&&h===!1&&Le("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let p=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),x=t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),M=t.getParameter(t.MAX_TEXTURE_SIZE),_=t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),u=t.getParameter(t.MAX_VERTEX_ATTRIBS),m=t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),y=t.getParameter(t.MAX_VARYING_VECTORS),w=t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),R=t.getParameter(t.MAX_SAMPLES),E=t.getParameter(t.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:f,reversedDepthBuffer:h,maxTextures:p,maxVertexTextures:x,maxTextureSize:M,maxCubemapSize:_,maxAttributes:u,maxVertexUniforms:m,maxVaryings:y,maxFragmentUniforms:w,maxSamples:R,samples:E}}function yT(t){let e=this,n=null,i=0,r=!1,s=!1,o=new Ti,a=new He,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(f,h){let p=f.length!==0||h||i!==0||r;return r=h,i=f.length,p},this.beginShadows=function(){s=!0,d(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(f,h){n=d(f,h,0)},this.setState=function(f,h,p){let x=f.clippingPlanes,M=f.clipIntersection,_=f.clipShadows,u=t.get(f);if(!r||x===null||x.length===0||s&&!_)s?d(null):c();else{let m=s?0:i,y=m*4,w=u.clippingState||null;l.value=w,w=d(x,h,y,p);for(let R=0;R!==y;++R)w[R]=n[R];u.clippingState=w,this.numIntersection=M?this.numPlanes:0,this.numPlanes+=m}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function d(f,h,p,x){let M=f!==null?f.length:0,_=null;if(M!==0){if(_=l.value,x!==!0||_===null){let u=p+M*4,m=h.matrixWorldInverse;a.getNormalMatrix(m),(_===null||_.length<u)&&(_=new Float32Array(u));for(let y=0,w=p;y!==M;++y,w+=4)o.copy(f[y]).applyMatrix4(m,a),o.normal.toArray(_,w),_[w+3]=o.constant}l.value=_,l.needsUpdate=!0}return e.numPlanes=M,e.numIntersection=0,_}}var Wr=4,Xx=[.125,.215,.35,.446,.526,.582],Ss=20,ST=256,dl=new kr,Yx=new Ke,Om=null,Bm=0,km=0,zm=!1,MT=new L,qh=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,n=0,i=.1,r=100,s={}){let{size:o=256,position:a=MT}=s;Om=this._renderer.getRenderTarget(),Bm=this._renderer.getActiveCubeFace(),km=this._renderer.getActiveMipmapLevel(),zm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,n=null){return this._fromTexture(e,n)}fromCubemap(e,n=null){return this._fromTexture(e,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=$x(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Zx(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(Om,Bm,km),this._renderer.xr.enabled=zm,e.scissorTest=!1,Ao(e,0,0,e.width,e.height)}_fromTexture(e,n){e.mapping===zr||e.mapping===xs?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Om=this._renderer.getRenderTarget(),Bm=this._renderer.getActiveCubeFace(),km=this._renderer.getActiveMipmapLevel(),zm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:jt,minFilter:jt,generateMipmaps:!1,type:Ni,format:Kn,colorSpace:Da,depthBuffer:!1},r=qx(e,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=qx(e,n,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=wT(s)),this._blurMaterial=TT(s,e,n),this._ggxMaterial=ET(s,e,n)}return r}_compileMaterial(e){let n=new Bt(new Cn,e);this._renderer.compile(n,dl)}_sceneToCubeUV(e,n,i,r,s){let l=new An(90,1,n,i),c=[1,-1,1,1,1,1],d=[1,1,1,-1,-1,-1],f=this._renderer,h=f.autoClear,p=f.toneMapping;f.getClearColor(Yx),f.toneMapping=di,f.autoClear=!1,f.state.buffers.depth.getReversed()&&(f.setRenderTarget(r),f.clearDepth(),f.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Bt(new Pi,new gs({name:"PMREM.Background",side:vn,depthWrite:!1,depthTest:!1})));let M=this._backgroundBox,_=M.material,u=!1,m=e.background;m?m.isColor&&(_.color.copy(m),e.background=null,u=!0):(_.color.copy(Yx),u=!0);for(let y=0;y<6;y++){let w=y%3;w===0?(l.up.set(0,c[y],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+d[y],s.y,s.z)):w===1?(l.up.set(0,0,c[y]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+d[y],s.z)):(l.up.set(0,c[y],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+d[y]));let R=this._cubeSize;Ao(r,w*R,y>2?R:0,R,R),f.setRenderTarget(r),u&&f.render(M,l),f.render(e,l)}f.toneMapping=p,f.autoClear=h,e.background=m}_textureToCubeUV(e,n){let i=this._renderer,r=e.mapping===zr||e.mapping===xs;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=$x()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Zx());let s=r?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=s;let a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;Ao(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(o,dl)}_applyPMREM(e){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);n.autoClear=i}_applyGGXFilter(e,n,i){let r=this._renderer,s=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[i];a.material=o;let l=o.uniforms,c=i/(this._lodMeshes.length-1),d=n/(this._lodMeshes.length-1),f=Math.sqrt(c*c-d*d),h=0+c*1.25,p=f*h,{_lodMax:x}=this,M=this._sizeLods[i],_=3*M*(i>x-Wr?i-x+Wr:0),u=4*(this._cubeSize-M);l.envMap.value=e.texture,l.roughness.value=p,l.mipInt.value=x-n,Ao(s,_,u,3*M,2*M),r.setRenderTarget(s),r.render(a,dl),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=x-i,Ao(e,_,u,3*M,2*M),r.setRenderTarget(e),r.render(a,dl)}_blur(e,n,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,n,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,n,i,r,s,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&De("blur direction must be either latitudinal or longitudinal!");let d=3,f=this._lodMeshes[r];f.material=c;let h=c.uniforms,p=this._sizeLods[i]-1,x=isFinite(s)?Math.PI/(2*p):2*Math.PI/(2*Ss-1),M=s/x,_=isFinite(s)?1+Math.floor(d*M):Ss;_>Ss&&Le(`sigmaRadians, ${s}, is too large and will clip, as it requested ${_} samples when the maximum is set to ${Ss}`);let u=[],m=0;for(let A=0;A<Ss;++A){let g=A/M,b=Math.exp(-g*g/2);u.push(b),A===0?m+=b:A<_&&(m+=2*b)}for(let A=0;A<u.length;A++)u[A]=u[A]/m;h.envMap.value=e.texture,h.samples.value=_,h.weights.value=u,h.latitudinal.value=o==="latitudinal",a&&(h.poleAxis.value=a);let{_lodMax:y}=this;h.dTheta.value=x,h.mipInt.value=y-i;let w=this._sizeLods[r],R=3*w*(r>y-Wr?r-y+Wr:0),E=4*(this._cubeSize-w);Ao(n,R,E,3*w,2*w),l.setRenderTarget(n),l.render(f,dl)}};function wT(t){let e=[],n=[],i=[],r=t,s=t-Wr+1+Xx.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);e.push(a);let l=1/a;o>t-Wr?l=Xx[o-t+Wr-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),d=-c,f=1+c,h=[d,d,f,d,f,f,d,d,f,f,d,f],p=6,x=6,M=3,_=2,u=1,m=new Float32Array(M*x*p),y=new Float32Array(_*x*p),w=new Float32Array(u*x*p);for(let E=0;E<p;E++){let A=E%3*2/3-1,g=E>2?0:-1,b=[A,g,0,A+2/3,g,0,A+2/3,g+1,0,A,g,0,A+2/3,g+1,0,A,g+1,0];m.set(b,M*x*E),y.set(h,_*x*E);let I=[E,E,E,E,E,E];w.set(I,u*x*E)}let R=new Cn;R.setAttribute("position",new Bn(m,M)),R.setAttribute("uv",new Bn(y,_)),R.setAttribute("faceIndex",new Bn(w,u)),i.push(new Bt(R,null)),r>Wr&&r--}return{lodMeshes:i,sizeLods:e,sigmas:n}}function qx(t,e,n){let i=new kn(t,e,n);return i.texture.mapping=il,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function Ao(t,e,n,i,r){t.viewport.set(e,n,i,r),t.scissor.set(e,n,i,r)}function ET(t,e,n){return new zn({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:ST,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Jh(),fragmentShader:`

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
		`,blending:Li,depthTest:!1,depthWrite:!1})}function TT(t,e,n){let i=new Float32Array(Ss),r=new L(0,1,0);return new zn({name:"SphericalGaussianBlur",defines:{n:Ss,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:Jh(),fragmentShader:`

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
		`,blending:Li,depthTest:!1,depthWrite:!1})}function Zx(){return new zn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Jh(),fragmentShader:`

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
		`,blending:Li,depthTest:!1,depthWrite:!1})}function $x(){return new zn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Jh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Li,depthTest:!1,depthWrite:!1})}function Jh(){return`

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
	`}var Zh=class extends kn{constructor(e=1,n={}){super(e,e,n),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new Ga(r),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new Pi(5,5,5),s=new zn({name:"CubemapFromEquirect",uniforms:ys(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:vn,blending:Li});s.uniforms.tEquirect.value=n;let o=new Bt(r,s),a=n.minFilter;return n.minFilter===Vr&&(n.minFilter=jt),new Qu(1,10,this).update(e,o),n.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,n=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(n,i,r);e.setRenderTarget(s)}};function bT(t){let e=new WeakMap,n=new WeakMap,i=null;function r(h,p=!1){return h==null?null:p?o(h):s(h)}function s(h){if(h&&h.isTexture){let p=h.mapping;if(p===ih||p===rh)if(e.has(h)){let x=e.get(h).texture;return a(x,h.mapping)}else{let x=h.image;if(x&&x.height>0){let M=new Zh(x.height);return M.fromEquirectangularTexture(t,h),e.set(h,M),h.addEventListener("dispose",c),a(M.texture,h.mapping)}else return null}}return h}function o(h){if(h&&h.isTexture){let p=h.mapping,x=p===ih||p===rh,M=p===zr||p===xs;if(x||M){let _=n.get(h),u=_!==void 0?_.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==u)return i===null&&(i=new qh(t)),_=x?i.fromEquirectangular(h,_):i.fromCubemap(h,_),_.texture.pmremVersion=h.pmremVersion,n.set(h,_),_.texture;if(_!==void 0)return _.texture;{let m=h.image;return x&&m&&m.height>0||M&&m&&l(m)?(i===null&&(i=new qh(t)),_=x?i.fromEquirectangular(h):i.fromCubemap(h),_.texture.pmremVersion=h.pmremVersion,n.set(h,_),h.addEventListener("dispose",d),_.texture):null}}}return h}function a(h,p){return p===ih?h.mapping=zr:p===rh&&(h.mapping=xs),h}function l(h){let p=0,x=6;for(let M=0;M<x;M++)h[M]!==void 0&&p++;return p===x}function c(h){let p=h.target;p.removeEventListener("dispose",c);let x=e.get(p);x!==void 0&&(e.delete(p),x.dispose())}function d(h){let p=h.target;p.removeEventListener("dispose",d);let x=n.get(p);x!==void 0&&(n.delete(p),x.dispose())}function f(){e=new WeakMap,n=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:f}}function AT(t){let e={};function n(i){if(e[i]!==void 0)return e[i];let r=t.getExtension(i);return e[i]=r,r}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let r=n(i);return r===null&&bu("WebGLRenderer: "+i+" extension not supported."),r}}}function CT(t,e,n,i){let r={},s=new WeakMap;function o(f){let h=f.target;h.index!==null&&e.remove(h.index);for(let x in h.attributes)e.remove(h.attributes[x]);h.removeEventListener("dispose",o),delete r[h.id];let p=s.get(h);p&&(e.remove(p),s.delete(h)),i.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,n.memory.geometries--}function a(f,h){return r[h.id]===!0||(h.addEventListener("dispose",o),r[h.id]=!0,n.memory.geometries++),h}function l(f){let h=f.attributes;for(let p in h)e.update(h[p],t.ARRAY_BUFFER)}function c(f){let h=[],p=f.index,x=f.attributes.position,M=0;if(x===void 0)return;if(p!==null){let m=p.array;M=p.version;for(let y=0,w=m.length;y<w;y+=3){let R=m[y+0],E=m[y+1],A=m[y+2];h.push(R,E,E,A,A,R)}}else{let m=x.array;M=x.version;for(let y=0,w=m.length/3-1;y<w;y+=3){let R=y+0,E=y+1,A=y+2;h.push(R,E,E,A,A,R)}}let _=new(x.count>=65535?Va:za)(h,1);_.version=M;let u=s.get(f);u&&e.remove(u),s.set(f,_)}function d(f){let h=s.get(f);if(h){let p=f.index;p!==null&&h.version<p.version&&c(f)}else c(f);return s.get(f)}return{get:a,update:l,getWireframeAttribute:d}}function RT(t,e,n){let i;function r(f){i=f}let s,o;function a(f){s=f.type,o=f.bytesPerElement}function l(f,h){t.drawElements(i,h,s,f*o),n.update(h,i,1)}function c(f,h,p){p!==0&&(t.drawElementsInstanced(i,h,s,f*o,p),n.update(h,i,p))}function d(f,h,p){if(p===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,h,0,s,f,0,p);let M=0;for(let _=0;_<p;_++)M+=h[_];n.update(M,i,1)}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=d}function PT(t){let e={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(n.calls++,o){case t.TRIANGLES:n.triangles+=a*(s/3);break;case t.LINES:n.lines+=a*(s/2);break;case t.LINE_STRIP:n.lines+=a*(s-1);break;case t.LINE_LOOP:n.lines+=a*s;break;case t.POINTS:n.points+=a*s;break;default:De("WebGLInfo: Unknown draw mode:",o);break}}function r(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:e,render:n,programs:null,autoReset:!0,reset:r,update:i}}function IT(t,e,n){let i=new WeakMap,r=new It;function s(o,a,l){let c=o.morphTargetInfluences,d=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,f=d!==void 0?d.length:0,h=i.get(a);if(h===void 0||h.count!==f){let b=function(){A.dispose(),i.delete(a),a.removeEventListener("dispose",b)};h!==void 0&&h.texture.dispose();let p=a.morphAttributes.position!==void 0,x=a.morphAttributes.normal!==void 0,M=a.morphAttributes.color!==void 0,_=a.morphAttributes.position||[],u=a.morphAttributes.normal||[],m=a.morphAttributes.color||[],y=0;p===!0&&(y=1),x===!0&&(y=2),M===!0&&(y=3);let w=a.attributes.position.count*y,R=1;w>e.maxTextureSize&&(R=Math.ceil(w/e.maxTextureSize),w=e.maxTextureSize);let E=new Float32Array(w*R*4*f),A=new Oa(E,w,R,f);A.type=pi,A.needsUpdate=!0;let g=y*4;for(let I=0;I<f;I++){let P=_[I],N=u[I],F=m[I],W=w*R*4*I;for(let z=0;z<P.count;z++){let G=z*g;p===!0&&(r.fromBufferAttribute(P,z),E[W+G+0]=r.x,E[W+G+1]=r.y,E[W+G+2]=r.z,E[W+G+3]=0),x===!0&&(r.fromBufferAttribute(N,z),E[W+G+4]=r.x,E[W+G+5]=r.y,E[W+G+6]=r.z,E[W+G+7]=0),M===!0&&(r.fromBufferAttribute(F,z),E[W+G+8]=r.x,E[W+G+9]=r.y,E[W+G+10]=r.z,E[W+G+11]=F.itemSize===4?r.w:1)}}h={count:f,texture:A,size:new Ce(w,R)},i.set(a,h),a.addEventListener("dispose",b)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(t,"morphTexture",o.morphTexture,n);else{let p=0;for(let M=0;M<c.length;M++)p+=c[M];let x=a.morphTargetsRelative?1:1-p;l.getUniforms().setValue(t,"morphTargetBaseInfluence",x),l.getUniforms().setValue(t,"morphTargetInfluences",c)}l.getUniforms().setValue(t,"morphTargetsTexture",h.texture,n),l.getUniforms().setValue(t,"morphTargetsTextureSize",h.size)}return{update:s}}function LT(t,e,n,i,r){let s=new WeakMap;function o(c){let d=r.render.frame,f=c.geometry,h=e.get(c,f);if(s.get(h)!==d&&(e.update(h),s.set(h,d)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==d&&(n.update(c.instanceMatrix,t.ARRAY_BUFFER),c.instanceColor!==null&&n.update(c.instanceColor,t.ARRAY_BUFFER),s.set(c,d))),c.isSkinnedMesh){let p=c.skeleton;s.get(p)!==d&&(p.update(),s.set(p,d))}return h}function a(){s=new WeakMap}function l(c){let d=c.target;d.removeEventListener("dispose",l),i.releaseStatesOfObject(d),n.remove(d.instanceMatrix),d.instanceColor!==null&&n.remove(d.instanceColor)}return{update:o,dispose:a}}var NT={[um]:"LINEAR_TONE_MAPPING",[hm]:"REINHARD_TONE_MAPPING",[dm]:"CINEON_TONE_MAPPING",[fm]:"ACES_FILMIC_TONE_MAPPING",[mm]:"AGX_TONE_MAPPING",[gm]:"NEUTRAL_TONE_MAPPING",[pm]:"CUSTOM_TONE_MAPPING"};function DT(t,e,n,i,r){let s=new kn(e,n,{type:t,depthBuffer:i,stencilBuffer:r,depthTexture:i?new nr(e,n):void 0}),o=new kn(e,n,{type:Ni,depthBuffer:!1,stencilBuffer:!1}),a=new Cn;a.setAttribute("position",new Tt([-1,3,0,-1,-1,0,3,-1,0],3)),a.setAttribute("uv",new Tt([0,2,0,0,2,0],2));let l=new zu({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),c=new Bt(a,l),d=new kr(-1,1,1,-1,0,1),f=null,h=null,p=!1,x,M=null,_=[],u=!1;this.setSize=function(m,y){s.setSize(m,y),o.setSize(m,y);for(let w=0;w<_.length;w++){let R=_[w];R.setSize&&R.setSize(m,y)}},this.setEffects=function(m){_=m,u=_.length>0&&_[0].isRenderPass===!0;let y=s.width,w=s.height;for(let R=0;R<_.length;R++){let E=_[R];E.setSize&&E.setSize(y,w)}},this.begin=function(m,y){if(p||m.toneMapping===di&&_.length===0)return!1;if(M=y,y!==null){let w=y.width,R=y.height;(s.width!==w||s.height!==R)&&this.setSize(w,R)}return u===!1&&m.setRenderTarget(s),x=m.toneMapping,m.toneMapping=di,!0},this.hasRenderPass=function(){return u},this.end=function(m,y){m.toneMapping=x,p=!0;let w=s,R=o;for(let E=0;E<_.length;E++){let A=_[E];if(A.enabled!==!1&&(A.render(m,R,w,y),A.needsSwap!==!1)){let g=w;w=R,R=g}}if(f!==m.outputColorSpace||h!==m.toneMapping){f=m.outputColorSpace,h=m.toneMapping,l.defines={},je.getTransfer(f)===at&&(l.defines.SRGB_TRANSFER="");let E=NT[h];E&&(l.defines[E]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=w.texture,m.setRenderTarget(M),m.render(c,d),M=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){s.depthTexture&&s.depthTexture.dispose(),s.dispose(),o.dispose(),a.dispose(),l.dispose()}}var my=new _n,Hm=new nr(1,1),gy=new Oa,_y=new Pu,vy=new Ga,Jx=[],Kx=[],jx=new Float32Array(16),Qx=new Float32Array(9),ey=new Float32Array(4);function Ro(t,e,n){let i=t[0];if(i<=0||i>0)return t;let r=e*n,s=Jx[r];if(s===void 0&&(s=new Float32Array(r),Jx[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=n,t[o].toArray(s,a)}return s}function Vt(t,e){if(t.length!==e.length)return!1;for(let n=0,i=t.length;n<i;n++)if(t[n]!==e[n])return!1;return!0}function Gt(t,e){for(let n=0,i=e.length;n<i;n++)t[n]=e[n]}function Kh(t,e){let n=Kx[e];n===void 0&&(n=new Int32Array(e),Kx[e]=n);for(let i=0;i!==e;++i)n[i]=t.allocateTextureUnit();return n}function UT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1f(this.addr,e),n[0]=e)}function FT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2f(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Vt(n,e))return;t.uniform2fv(this.addr,e),Gt(n,e)}}function OT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3f(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else if(e.r!==void 0)(n[0]!==e.r||n[1]!==e.g||n[2]!==e.b)&&(t.uniform3f(this.addr,e.r,e.g,e.b),n[0]=e.r,n[1]=e.g,n[2]=e.b);else{if(Vt(n,e))return;t.uniform3fv(this.addr,e),Gt(n,e)}}function BT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4f(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Vt(n,e))return;t.uniform4fv(this.addr,e),Gt(n,e)}}function kT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Vt(n,e))return;t.uniformMatrix2fv(this.addr,!1,e),Gt(n,e)}else{if(Vt(n,i))return;ey.set(i),t.uniformMatrix2fv(this.addr,!1,ey),Gt(n,i)}}function zT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Vt(n,e))return;t.uniformMatrix3fv(this.addr,!1,e),Gt(n,e)}else{if(Vt(n,i))return;Qx.set(i),t.uniformMatrix3fv(this.addr,!1,Qx),Gt(n,i)}}function VT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Vt(n,e))return;t.uniformMatrix4fv(this.addr,!1,e),Gt(n,e)}else{if(Vt(n,i))return;jx.set(i),t.uniformMatrix4fv(this.addr,!1,jx),Gt(n,i)}}function GT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1i(this.addr,e),n[0]=e)}function HT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2i(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Vt(n,e))return;t.uniform2iv(this.addr,e),Gt(n,e)}}function WT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3i(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Vt(n,e))return;t.uniform3iv(this.addr,e),Gt(n,e)}}function XT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4i(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Vt(n,e))return;t.uniform4iv(this.addr,e),Gt(n,e)}}function YT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1ui(this.addr,e),n[0]=e)}function qT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2ui(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Vt(n,e))return;t.uniform2uiv(this.addr,e),Gt(n,e)}}function ZT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3ui(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Vt(n,e))return;t.uniform3uiv(this.addr,e),Gt(n,e)}}function $T(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4ui(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Vt(n,e))return;t.uniform4uiv(this.addr,e),Gt(n,e)}}function JT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r);let s;this.type===t.SAMPLER_2D_SHADOW?(Hm.compareFunction=n.isReversedDepthBuffer()?Wh:Hh,s=Hm):s=my,n.setTexture2D(e||s,r)}function KT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture3D(e||_y,r)}function jT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTextureCube(e||vy,r)}function QT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture2DArray(e||gy,r)}function eb(t){switch(t){case 5126:return UT;case 35664:return FT;case 35665:return OT;case 35666:return BT;case 35674:return kT;case 35675:return zT;case 35676:return VT;case 5124:case 35670:return GT;case 35667:case 35671:return HT;case 35668:case 35672:return WT;case 35669:case 35673:return XT;case 5125:return YT;case 36294:return qT;case 36295:return ZT;case 36296:return $T;case 35678:case 36198:case 36298:case 36306:case 35682:return JT;case 35679:case 36299:case 36307:return KT;case 35680:case 36300:case 36308:case 36293:return jT;case 36289:case 36303:case 36311:case 36292:return QT}}function tb(t,e){t.uniform1fv(this.addr,e)}function nb(t,e){let n=Ro(e,this.size,2);t.uniform2fv(this.addr,n)}function ib(t,e){let n=Ro(e,this.size,3);t.uniform3fv(this.addr,n)}function rb(t,e){let n=Ro(e,this.size,4);t.uniform4fv(this.addr,n)}function sb(t,e){let n=Ro(e,this.size,4);t.uniformMatrix2fv(this.addr,!1,n)}function ob(t,e){let n=Ro(e,this.size,9);t.uniformMatrix3fv(this.addr,!1,n)}function ab(t,e){let n=Ro(e,this.size,16);t.uniformMatrix4fv(this.addr,!1,n)}function lb(t,e){t.uniform1iv(this.addr,e)}function cb(t,e){t.uniform2iv(this.addr,e)}function ub(t,e){t.uniform3iv(this.addr,e)}function hb(t,e){t.uniform4iv(this.addr,e)}function db(t,e){t.uniform1uiv(this.addr,e)}function fb(t,e){t.uniform2uiv(this.addr,e)}function pb(t,e){t.uniform3uiv(this.addr,e)}function mb(t,e){t.uniform4uiv(this.addr,e)}function gb(t,e,n){let i=this.cache,r=e.length,s=Kh(n,r);Vt(i,s)||(t.uniform1iv(this.addr,s),Gt(i,s));let o;this.type===t.SAMPLER_2D_SHADOW?o=Hm:o=my;for(let a=0;a!==r;++a)n.setTexture2D(e[a]||o,s[a])}function _b(t,e,n){let i=this.cache,r=e.length,s=Kh(n,r);Vt(i,s)||(t.uniform1iv(this.addr,s),Gt(i,s));for(let o=0;o!==r;++o)n.setTexture3D(e[o]||_y,s[o])}function vb(t,e,n){let i=this.cache,r=e.length,s=Kh(n,r);Vt(i,s)||(t.uniform1iv(this.addr,s),Gt(i,s));for(let o=0;o!==r;++o)n.setTextureCube(e[o]||vy,s[o])}function xb(t,e,n){let i=this.cache,r=e.length,s=Kh(n,r);Vt(i,s)||(t.uniform1iv(this.addr,s),Gt(i,s));for(let o=0;o!==r;++o)n.setTexture2DArray(e[o]||gy,s[o])}function yb(t){switch(t){case 5126:return tb;case 35664:return nb;case 35665:return ib;case 35666:return rb;case 35674:return sb;case 35675:return ob;case 35676:return ab;case 5124:case 35670:return lb;case 35667:case 35671:return cb;case 35668:case 35672:return ub;case 35669:case 35673:return hb;case 5125:return db;case 36294:return fb;case 36295:return pb;case 36296:return mb;case 35678:case 36198:case 36298:case 36306:case 35682:return gb;case 35679:case 36299:case 36307:return _b;case 35680:case 36300:case 36308:case 36293:return vb;case 36289:case 36303:case 36311:case 36292:return xb}}var Wm=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.setValue=eb(n.type)}},Xm=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=yb(n.type)}},Ym=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,n,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,n[a.id],i)}}},Vm=/(\w+)(\])?(\[|\.)?/g;function ty(t,e){t.seq.push(e),t.map[e.id]=e}function Sb(t,e,n){let i=t.name,r=i.length;for(Vm.lastIndex=0;;){let s=Vm.exec(i),o=Vm.lastIndex,a=s[1],l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){ty(n,c===void 0?new Wm(a,t,e):new Xm(a,t,e));break}else{let f=n.map[a];f===void 0&&(f=new Ym(a),ty(n,f)),n=f}}}var Co=class{constructor(e,n){this.seq=[],this.map={};let i=e.getProgramParameter(n,e.ACTIVE_UNIFORMS);for(let o=0;o<i;++o){let a=e.getActiveUniform(n,o),l=e.getUniformLocation(n,a.name);Sb(a,l,this)}let r=[],s=[];for(let o of this.seq)o.type===e.SAMPLER_2D_SHADOW||o.type===e.SAMPLER_CUBE_SHADOW||o.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(o):s.push(o);r.length>0&&(this.seq=r.concat(s))}setValue(e,n,i,r){let s=this.map[n];s!==void 0&&s.setValue(e,i,r)}setOptional(e,n,i){let r=n[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,n,i,r){for(let s=0,o=n.length;s!==o;++s){let a=n[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,n){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in n&&i.push(o)}return i}};function ny(t,e,n){let i=t.createShader(e);return t.shaderSource(i,n),t.compileShader(i),i}var Mb=37297,wb=0;function Eb(t,e){let n=t.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,n.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${n[o]}`)}return i.join(`
`)}var iy=new He;function Tb(t){je._getMatrix(iy,je.workingColorSpace,t);let e=`mat3( ${iy.elements.map(n=>n.toFixed(4))} )`;switch(je.getTransfer(t)){case Ua:return[e,"LinearTransferOETF"];case at:return[e,"sRGBTransferOETF"];default:return Le("WebGLProgram: Unsupported color space: ",t),[e,"LinearTransferOETF"]}}function ry(t,e,n){let i=t.getShaderParameter(e,t.COMPILE_STATUS),s=(t.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return n.toUpperCase()+`

`+s+`

`+Eb(t.getShaderSource(e),a)}else return s}function bb(t,e){let n=Tb(e);return[`vec4 ${t}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}var Ab={[um]:"Linear",[hm]:"Reinhard",[dm]:"Cineon",[fm]:"ACESFilmic",[mm]:"AgX",[gm]:"Neutral",[pm]:"Custom"};function Cb(t,e){let n=Ab[e];return n===void 0?(Le("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+t+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+t+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var Yh=new L;function Rb(){je.getLuminanceCoefficients(Yh);let t=Yh.x.toFixed(4),e=Yh.y.toFixed(4),n=Yh.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${t}, ${e}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Pb(t){return[t.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",t.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(pl).join(`
`)}function Ib(t){let e=[];for(let n in t){let i=t[n];i!==!1&&e.push("#define "+n+" "+i)}return e.join(`
`)}function Lb(t,e){let n={},i=t.getProgramParameter(e,t.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=t.getActiveAttrib(e,r),o=s.name,a=1;s.type===t.FLOAT_MAT2&&(a=2),s.type===t.FLOAT_MAT3&&(a=3),s.type===t.FLOAT_MAT4&&(a=4),n[o]={type:s.type,location:t.getAttribLocation(e,o),locationSize:a}}return n}function pl(t){return t!==""}function sy(t,e){let n=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return t.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function oy(t,e){return t.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var Nb=/^[ \t]*#include +<([\w\d./]+)>/gm;function qm(t){return t.replace(Nb,Ub)}var Db=new Map;function Ub(t,e){let n=Xe[e];if(n===void 0){let i=Db.get(e);if(i!==void 0)n=Xe[i],Le('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return qm(n)}var Fb=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function ay(t){return t.replace(Fb,Ob)}function Ob(t,e,n,i){let r="";for(let s=parseInt(e);s<parseInt(n);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function ly(t){let e=`precision ${t.precision} float;
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
#define LOW_PRECISION`),e}var Bb={[nl]:"SHADOWMAP_TYPE_PCF",[Eo]:"SHADOWMAP_TYPE_VSM"};function kb(t){return Bb[t.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var zb={[zr]:"ENVMAP_TYPE_CUBE",[xs]:"ENVMAP_TYPE_CUBE",[il]:"ENVMAP_TYPE_CUBE_UV"};function Vb(t){return t.envMap===!1?"ENVMAP_TYPE_CUBE":zb[t.envMapMode]||"ENVMAP_TYPE_CUBE"}var Gb={[xs]:"ENVMAP_MODE_REFRACTION"};function Hb(t){return t.envMap===!1?"ENVMAP_MODE_REFLECTION":Gb[t.envMapMode]||"ENVMAP_MODE_REFLECTION"}var Wb={[cm]:"ENVMAP_BLENDING_MULTIPLY",[Ax]:"ENVMAP_BLENDING_MIX",[Cx]:"ENVMAP_BLENDING_ADD"};function Xb(t){return t.envMap===!1?"ENVMAP_BLENDING_NONE":Wb[t.combine]||"ENVMAP_BLENDING_NONE"}function Yb(t){let e=t.envMapCubeUVHeight;if(e===null)return null;let n=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,n),7*16)),texelHeight:i,maxMip:n}}function qb(t,e,n,i){let r=t.getContext(),s=n.defines,o=n.vertexShader,a=n.fragmentShader,l=kb(n),c=Vb(n),d=Hb(n),f=Xb(n),h=Yb(n),p=Pb(n),x=Ib(s),M=r.createProgram(),_,u,m=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(_=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,x].filter(pl).join(`
`),_.length>0&&(_+=`
`),u=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,x].filter(pl).join(`
`),u.length>0&&(u+=`
`)):(_=[ly(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,x,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+d:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexNormals?"#define HAS_NORMAL":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(pl).join(`
`),u=[ly(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,x,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+d:"",n.envMap?"#define "+f:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor?"#define USE_COLOR":"",n.vertexAlphas||n.batchingColor?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==di?"#define TONE_MAPPING":"",n.toneMapping!==di?Xe.tonemapping_pars_fragment:"",n.toneMapping!==di?Cb("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",Xe.colorspace_pars_fragment,bb("linearToOutputTexel",n.outputColorSpace),Rb(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(pl).join(`
`)),o=qm(o),o=sy(o,n),o=oy(o,n),a=qm(a),a=sy(a,n),a=oy(a,n),o=ay(o),a=ay(a),n.isRawShaderMaterial!==!0&&(m=`#version 300 es
`,_=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+_,u=["#define varying in",n.glslVersion===Tm?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===Tm?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+u);let y=m+_+o,w=m+u+a,R=ny(r,r.VERTEX_SHADER,y),E=ny(r,r.FRAGMENT_SHADER,w);r.attachShader(M,R),r.attachShader(M,E),n.index0AttributeName!==void 0?r.bindAttribLocation(M,0,n.index0AttributeName):n.morphTargets===!0&&r.bindAttribLocation(M,0,"position"),r.linkProgram(M);function A(P){if(t.debug.checkShaderErrors){let N=r.getProgramInfoLog(M)||"",F=r.getShaderInfoLog(R)||"",W=r.getShaderInfoLog(E)||"",z=N.trim(),G=F.trim(),H=W.trim(),ee=!0,re=!0;if(r.getProgramParameter(M,r.LINK_STATUS)===!1)if(ee=!1,typeof t.debug.onShaderError=="function")t.debug.onShaderError(r,M,R,E);else{let se=ry(r,R,"vertex"),ve=ry(r,E,"fragment");De("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(M,r.VALIDATE_STATUS)+`

Material Name: `+P.name+`
Material Type: `+P.type+`

Program Info Log: `+z+`
`+se+`
`+ve)}else z!==""?Le("WebGLProgram: Program Info Log:",z):(G===""||H==="")&&(re=!1);re&&(P.diagnostics={runnable:ee,programLog:z,vertexShader:{log:G,prefix:_},fragmentShader:{log:H,prefix:u}})}r.deleteShader(R),r.deleteShader(E),g=new Co(r,M),b=Lb(r,M)}let g;this.getUniforms=function(){return g===void 0&&A(this),g};let b;this.getAttributes=function(){return b===void 0&&A(this),b};let I=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return I===!1&&(I=r.getProgramParameter(M,Mb)),I},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(M),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=wb++,this.cacheKey=e,this.usedTimes=1,this.program=M,this.vertexShader=R,this.fragmentShader=E,this}var Zb=0,Zm=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let n=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(n),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let n=this.materialCache.get(e);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let n=this.materialCache,i=n.get(e);return i===void 0&&(i=new Set,n.set(e,i)),i}_getShaderStage(e){let n=this.shaderCache,i=n.get(e);return i===void 0&&(i=new $m(e),n.set(e,i)),i}},$m=class{constructor(e){this.id=Zb++,this.code=e,this.usedTimes=0}};function $b(t){return t===Hr||t===cl||t===ul}function Jb(t,e,n,i,r,s){let o=new Ba,a=new Zm,l=new Set,c=[],d=new Map,f=i.logarithmicDepthBuffer,h=i.precision,p={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function x(g){return l.add(g),g===0?"uv":`uv${g}`}function M(g,b,I,P,N,F){let W=P.fog,z=N.geometry,G=g.isMeshStandardMaterial||g.isMeshLambertMaterial||g.isMeshPhongMaterial?P.environment:null,H=g.isMeshStandardMaterial||g.isMeshLambertMaterial&&!g.envMap||g.isMeshPhongMaterial&&!g.envMap,ee=e.get(g.envMap||G,H),re=ee&&ee.mapping===il?ee.image.height:null,se=p[g.type];g.precision!==null&&(h=i.getMaxPrecision(g.precision),h!==g.precision&&Le("WebGLProgram.getParameters:",g.precision,"not supported, using",h,"instead."));let ve=z.morphAttributes.position||z.morphAttributes.normal||z.morphAttributes.color,pe=ve!==void 0?ve.length:0,Pe=0;z.morphAttributes.position!==void 0&&(Pe=1),z.morphAttributes.normal!==void 0&&(Pe=2),z.morphAttributes.color!==void 0&&(Pe=3);let st,Oe,J,ge;if(se){let Ge=Ui[se];st=Ge.vertexShader,Oe=Ge.fragmentShader}else st=g.vertexShader,Oe=g.fragmentShader,a.update(g),J=a.getVertexShaderID(g),ge=a.getFragmentShaderID(g);let he=t.getRenderTarget(),Ie=t.state.buffers.depth.getReversed(),Be=N.isInstancedMesh===!0,Re=N.isBatchedMesh===!0,ke=!!g.map,Ye=!!g.matcap,et=!!ee,rt=!!g.aoMap,We=!!g.lightMap,bt=!!g.bumpMap,pt=!!g.normalMap,mt=!!g.displacementMap,k=!!g.emissiveMap,lt=!!g.metalnessMap,ze=!!g.roughnessMap,ct=g.anisotropy>0,_e=g.clearcoat>0,wt=g.dispersion>0,C=g.iridescence>0,S=g.sheen>0,V=g.transmission>0,Y=ct&&!!g.anisotropyMap,j=_e&&!!g.clearcoatMap,le=_e&&!!g.clearcoatNormalMap,de=_e&&!!g.clearcoatRoughnessMap,X=C&&!!g.iridescenceMap,$=C&&!!g.iridescenceThicknessMap,Se=S&&!!g.sheenColorMap,Me=S&&!!g.sheenRoughnessMap,ue=!!g.specularMap,te=!!g.specularColorMap,Ue=!!g.specularIntensityMap,Ve=V&&!!g.transmissionMap,Qe=V&&!!g.thicknessMap,D=!!g.gradientMap,oe=!!g.alphaMap,q=g.alphaTest>0,xe=!!g.alphaHash,ce=!!g.extensions,Q=di;g.toneMapped&&(he===null||he.isXRRenderTarget===!0)&&(Q=t.toneMapping);let Te={shaderID:se,shaderType:g.type,shaderName:g.name,vertexShader:st,fragmentShader:Oe,defines:g.defines,customVertexShaderID:J,customFragmentShaderID:ge,isRawShaderMaterial:g.isRawShaderMaterial===!0,glslVersion:g.glslVersion,precision:h,batching:Re,batchingColor:Re&&N._colorsTexture!==null,instancing:Be,instancingColor:Be&&N.instanceColor!==null,instancingMorph:Be&&N.morphTexture!==null,outputColorSpace:he===null?t.outputColorSpace:he.isXRRenderTarget===!0?he.texture.colorSpace:je.workingColorSpace,alphaToCoverage:!!g.alphaToCoverage,map:ke,matcap:Ye,envMap:et,envMapMode:et&&ee.mapping,envMapCubeUVHeight:re,aoMap:rt,lightMap:We,bumpMap:bt,normalMap:pt,displacementMap:mt,emissiveMap:k,normalMapObjectSpace:pt&&g.normalMapType===Ix,normalMapTangentSpace:pt&&g.normalMapType===Gh,packedNormalMap:pt&&g.normalMapType===Gh&&$b(g.normalMap.format),metalnessMap:lt,roughnessMap:ze,anisotropy:ct,anisotropyMap:Y,clearcoat:_e,clearcoatMap:j,clearcoatNormalMap:le,clearcoatRoughnessMap:de,dispersion:wt,iridescence:C,iridescenceMap:X,iridescenceThicknessMap:$,sheen:S,sheenColorMap:Se,sheenRoughnessMap:Me,specularMap:ue,specularColorMap:te,specularIntensityMap:Ue,transmission:V,transmissionMap:Ve,thicknessMap:Qe,gradientMap:D,opaque:g.transparent===!1&&g.blending===ps&&g.alphaToCoverage===!1,alphaMap:oe,alphaTest:q,alphaHash:xe,combine:g.combine,mapUv:ke&&x(g.map.channel),aoMapUv:rt&&x(g.aoMap.channel),lightMapUv:We&&x(g.lightMap.channel),bumpMapUv:bt&&x(g.bumpMap.channel),normalMapUv:pt&&x(g.normalMap.channel),displacementMapUv:mt&&x(g.displacementMap.channel),emissiveMapUv:k&&x(g.emissiveMap.channel),metalnessMapUv:lt&&x(g.metalnessMap.channel),roughnessMapUv:ze&&x(g.roughnessMap.channel),anisotropyMapUv:Y&&x(g.anisotropyMap.channel),clearcoatMapUv:j&&x(g.clearcoatMap.channel),clearcoatNormalMapUv:le&&x(g.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:de&&x(g.clearcoatRoughnessMap.channel),iridescenceMapUv:X&&x(g.iridescenceMap.channel),iridescenceThicknessMapUv:$&&x(g.iridescenceThicknessMap.channel),sheenColorMapUv:Se&&x(g.sheenColorMap.channel),sheenRoughnessMapUv:Me&&x(g.sheenRoughnessMap.channel),specularMapUv:ue&&x(g.specularMap.channel),specularColorMapUv:te&&x(g.specularColorMap.channel),specularIntensityMapUv:Ue&&x(g.specularIntensityMap.channel),transmissionMapUv:Ve&&x(g.transmissionMap.channel),thicknessMapUv:Qe&&x(g.thicknessMap.channel),alphaMapUv:oe&&x(g.alphaMap.channel),vertexTangents:!!z.attributes.tangent&&(pt||ct),vertexNormals:!!z.attributes.normal,vertexColors:g.vertexColors,vertexAlphas:g.vertexColors===!0&&!!z.attributes.color&&z.attributes.color.itemSize===4,pointsUvs:N.isPoints===!0&&!!z.attributes.uv&&(ke||oe),fog:!!W,useFog:g.fog===!0,fogExp2:!!W&&W.isFogExp2,flatShading:g.wireframe===!1&&(g.flatShading===!0||z.attributes.normal===void 0&&pt===!1&&(g.isMeshLambertMaterial||g.isMeshPhongMaterial||g.isMeshStandardMaterial||g.isMeshPhysicalMaterial)),sizeAttenuation:g.sizeAttenuation===!0,logarithmicDepthBuffer:f,reversedDepthBuffer:Ie,skinning:N.isSkinnedMesh===!0,morphTargets:z.morphAttributes.position!==void 0,morphNormals:z.morphAttributes.normal!==void 0,morphColors:z.morphAttributes.color!==void 0,morphTargetsCount:pe,morphTextureStride:Pe,numDirLights:b.directional.length,numPointLights:b.point.length,numSpotLights:b.spot.length,numSpotLightMaps:b.spotLightMap.length,numRectAreaLights:b.rectArea.length,numHemiLights:b.hemi.length,numDirLightShadows:b.directionalShadowMap.length,numPointLightShadows:b.pointShadowMap.length,numSpotLightShadows:b.spotShadowMap.length,numSpotLightShadowsWithMaps:b.numSpotLightShadowsWithMaps,numLightProbes:b.numLightProbes,numLightProbeGrids:F.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:g.dithering,shadowMapEnabled:t.shadowMap.enabled&&I.length>0,shadowMapType:t.shadowMap.type,toneMapping:Q,decodeVideoTexture:ke&&g.map.isVideoTexture===!0&&je.getTransfer(g.map.colorSpace)===at,decodeVideoTextureEmissive:k&&g.emissiveMap.isVideoTexture===!0&&je.getTransfer(g.emissiveMap.colorSpace)===at,premultipliedAlpha:g.premultipliedAlpha,doubleSided:g.side===Ii,flipSided:g.side===vn,useDepthPacking:g.depthPacking>=0,depthPacking:g.depthPacking||0,index0AttributeName:g.index0AttributeName,extensionClipCullDistance:ce&&g.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(ce&&g.extensions.multiDraw===!0||Re)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:g.customProgramCacheKey()};return Te.vertexUv1s=l.has(1),Te.vertexUv2s=l.has(2),Te.vertexUv3s=l.has(3),l.clear(),Te}function _(g){let b=[];if(g.shaderID?b.push(g.shaderID):(b.push(g.customVertexShaderID),b.push(g.customFragmentShaderID)),g.defines!==void 0)for(let I in g.defines)b.push(I),b.push(g.defines[I]);return g.isRawShaderMaterial===!1&&(u(b,g),m(b,g),b.push(t.outputColorSpace)),b.push(g.customProgramCacheKey),b.join()}function u(g,b){g.push(b.precision),g.push(b.outputColorSpace),g.push(b.envMapMode),g.push(b.envMapCubeUVHeight),g.push(b.mapUv),g.push(b.alphaMapUv),g.push(b.lightMapUv),g.push(b.aoMapUv),g.push(b.bumpMapUv),g.push(b.normalMapUv),g.push(b.displacementMapUv),g.push(b.emissiveMapUv),g.push(b.metalnessMapUv),g.push(b.roughnessMapUv),g.push(b.anisotropyMapUv),g.push(b.clearcoatMapUv),g.push(b.clearcoatNormalMapUv),g.push(b.clearcoatRoughnessMapUv),g.push(b.iridescenceMapUv),g.push(b.iridescenceThicknessMapUv),g.push(b.sheenColorMapUv),g.push(b.sheenRoughnessMapUv),g.push(b.specularMapUv),g.push(b.specularColorMapUv),g.push(b.specularIntensityMapUv),g.push(b.transmissionMapUv),g.push(b.thicknessMapUv),g.push(b.combine),g.push(b.fogExp2),g.push(b.sizeAttenuation),g.push(b.morphTargetsCount),g.push(b.morphAttributeCount),g.push(b.numDirLights),g.push(b.numPointLights),g.push(b.numSpotLights),g.push(b.numSpotLightMaps),g.push(b.numHemiLights),g.push(b.numRectAreaLights),g.push(b.numDirLightShadows),g.push(b.numPointLightShadows),g.push(b.numSpotLightShadows),g.push(b.numSpotLightShadowsWithMaps),g.push(b.numLightProbes),g.push(b.shadowMapType),g.push(b.toneMapping),g.push(b.numClippingPlanes),g.push(b.numClipIntersection),g.push(b.depthPacking)}function m(g,b){o.disableAll(),b.instancing&&o.enable(0),b.instancingColor&&o.enable(1),b.instancingMorph&&o.enable(2),b.matcap&&o.enable(3),b.envMap&&o.enable(4),b.normalMapObjectSpace&&o.enable(5),b.normalMapTangentSpace&&o.enable(6),b.clearcoat&&o.enable(7),b.iridescence&&o.enable(8),b.alphaTest&&o.enable(9),b.vertexColors&&o.enable(10),b.vertexAlphas&&o.enable(11),b.vertexUv1s&&o.enable(12),b.vertexUv2s&&o.enable(13),b.vertexUv3s&&o.enable(14),b.vertexTangents&&o.enable(15),b.anisotropy&&o.enable(16),b.alphaHash&&o.enable(17),b.batching&&o.enable(18),b.dispersion&&o.enable(19),b.batchingColor&&o.enable(20),b.gradientMap&&o.enable(21),b.packedNormalMap&&o.enable(22),b.vertexNormals&&o.enable(23),g.push(o.mask),o.disableAll(),b.fog&&o.enable(0),b.useFog&&o.enable(1),b.flatShading&&o.enable(2),b.logarithmicDepthBuffer&&o.enable(3),b.reversedDepthBuffer&&o.enable(4),b.skinning&&o.enable(5),b.morphTargets&&o.enable(6),b.morphNormals&&o.enable(7),b.morphColors&&o.enable(8),b.premultipliedAlpha&&o.enable(9),b.shadowMapEnabled&&o.enable(10),b.doubleSided&&o.enable(11),b.flipSided&&o.enable(12),b.useDepthPacking&&o.enable(13),b.dithering&&o.enable(14),b.transmission&&o.enable(15),b.sheen&&o.enable(16),b.opaque&&o.enable(17),b.pointsUvs&&o.enable(18),b.decodeVideoTexture&&o.enable(19),b.decodeVideoTextureEmissive&&o.enable(20),b.alphaToCoverage&&o.enable(21),b.numLightProbeGrids>0&&o.enable(22),g.push(o.mask)}function y(g){let b=p[g.type],I;if(b){let P=Ui[b];I=Hx.clone(P.uniforms)}else I=g.uniforms;return I}function w(g,b){let I=d.get(b);return I!==void 0?++I.usedTimes:(I=new qb(t,b,g,r),c.push(I),d.set(b,I)),I}function R(g){if(--g.usedTimes===0){let b=c.indexOf(g);c[b]=c[c.length-1],c.pop(),d.delete(g.cacheKey),g.destroy()}}function E(g){a.remove(g)}function A(){a.dispose()}return{getParameters:M,getProgramCacheKey:_,getUniforms:y,acquireProgram:w,releaseProgram:R,releaseShaderCache:E,programs:c,dispose:A}}function Kb(){let t=new WeakMap;function e(o){return t.has(o)}function n(o){let a=t.get(o);return a===void 0&&(a={},t.set(o,a)),a}function i(o){t.delete(o)}function r(o,a,l){t.get(o)[a]=l}function s(){t=new WeakMap}return{has:e,get:n,remove:i,update:r,dispose:s}}function jb(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.material.id!==e.material.id?t.material.id-e.material.id:t.materialVariant!==e.materialVariant?t.materialVariant-e.materialVariant:t.z!==e.z?t.z-e.z:t.id-e.id}function cy(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.z!==e.z?e.z-t.z:t.id-e.id}function uy(){let t=[],e=0,n=[],i=[],r=[];function s(){e=0,n.length=0,i.length=0,r.length=0}function o(h){let p=0;return h.isInstancedMesh&&(p+=2),h.isSkinnedMesh&&(p+=1),p}function a(h,p,x,M,_,u){let m=t[e];return m===void 0?(m={id:h.id,object:h,geometry:p,material:x,materialVariant:o(h),groupOrder:M,renderOrder:h.renderOrder,z:_,group:u},t[e]=m):(m.id=h.id,m.object=h,m.geometry=p,m.material=x,m.materialVariant=o(h),m.groupOrder=M,m.renderOrder=h.renderOrder,m.z=_,m.group=u),e++,m}function l(h,p,x,M,_,u){let m=a(h,p,x,M,_,u);x.transmission>0?i.push(m):x.transparent===!0?r.push(m):n.push(m)}function c(h,p,x,M,_,u){let m=a(h,p,x,M,_,u);x.transmission>0?i.unshift(m):x.transparent===!0?r.unshift(m):n.unshift(m)}function d(h,p){n.length>1&&n.sort(h||jb),i.length>1&&i.sort(p||cy),r.length>1&&r.sort(p||cy)}function f(){for(let h=e,p=t.length;h<p;h++){let x=t[h];if(x.id===null)break;x.id=null,x.object=null,x.geometry=null,x.material=null,x.group=null}}return{opaque:n,transmissive:i,transparent:r,init:s,push:l,unshift:c,finish:f,sort:d}}function Qb(){let t=new WeakMap;function e(i,r){let s=t.get(i),o;return s===void 0?(o=new uy,t.set(i,[o])):r>=s.length?(o=new uy,s.push(o)):o=s[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}function eA(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={direction:new L,color:new Ke};break;case"SpotLight":n={position:new L,direction:new L,color:new Ke,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new L,color:new Ke,distance:0,decay:0};break;case"HemisphereLight":n={direction:new L,skyColor:new Ke,groundColor:new Ke};break;case"RectAreaLight":n={color:new Ke,position:new L,halfWidth:new L,halfHeight:new L};break}return t[e.id]=n,n}}}function tA(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ce};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ce};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ce,shadowCameraNear:1,shadowCameraFar:1e3};break}return t[e.id]=n,n}}}var nA=0;function iA(t,e){return(e.castShadow?2:0)-(t.castShadow?2:0)+(e.map?1:0)-(t.map?1:0)}function rA(t){let e=new eA,n=tA(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new L);let r=new L,s=new Pt,o=new Pt;function a(c){let d=0,f=0,h=0;for(let b=0;b<9;b++)i.probe[b].set(0,0,0);let p=0,x=0,M=0,_=0,u=0,m=0,y=0,w=0,R=0,E=0,A=0;c.sort(iA);for(let b=0,I=c.length;b<I;b++){let P=c[b],N=P.color,F=P.intensity,W=P.distance,z=null;if(P.shadow&&P.shadow.map&&(P.shadow.map.texture.format===Hr?z=P.shadow.map.texture:z=P.shadow.map.depthTexture||P.shadow.map.texture),P.isAmbientLight)d+=N.r*F,f+=N.g*F,h+=N.b*F;else if(P.isLightProbe){for(let G=0;G<9;G++)i.probe[G].addScaledVector(P.sh.coefficients[G],F);A++}else if(P.isDirectionalLight){let G=e.get(P);if(G.color.copy(P.color).multiplyScalar(P.intensity),P.castShadow){let H=P.shadow,ee=n.get(P);ee.shadowIntensity=H.intensity,ee.shadowBias=H.bias,ee.shadowNormalBias=H.normalBias,ee.shadowRadius=H.radius,ee.shadowMapSize=H.mapSize,i.directionalShadow[p]=ee,i.directionalShadowMap[p]=z,i.directionalShadowMatrix[p]=P.shadow.matrix,m++}i.directional[p]=G,p++}else if(P.isSpotLight){let G=e.get(P);G.position.setFromMatrixPosition(P.matrixWorld),G.color.copy(N).multiplyScalar(F),G.distance=W,G.coneCos=Math.cos(P.angle),G.penumbraCos=Math.cos(P.angle*(1-P.penumbra)),G.decay=P.decay,i.spot[M]=G;let H=P.shadow;if(P.map&&(i.spotLightMap[R]=P.map,R++,H.updateMatrices(P),P.castShadow&&E++),i.spotLightMatrix[M]=H.matrix,P.castShadow){let ee=n.get(P);ee.shadowIntensity=H.intensity,ee.shadowBias=H.bias,ee.shadowNormalBias=H.normalBias,ee.shadowRadius=H.radius,ee.shadowMapSize=H.mapSize,i.spotShadow[M]=ee,i.spotShadowMap[M]=z,w++}M++}else if(P.isRectAreaLight){let G=e.get(P);G.color.copy(N).multiplyScalar(F),G.halfWidth.set(P.width*.5,0,0),G.halfHeight.set(0,P.height*.5,0),i.rectArea[_]=G,_++}else if(P.isPointLight){let G=e.get(P);if(G.color.copy(P.color).multiplyScalar(P.intensity),G.distance=P.distance,G.decay=P.decay,P.castShadow){let H=P.shadow,ee=n.get(P);ee.shadowIntensity=H.intensity,ee.shadowBias=H.bias,ee.shadowNormalBias=H.normalBias,ee.shadowRadius=H.radius,ee.shadowMapSize=H.mapSize,ee.shadowCameraNear=H.camera.near,ee.shadowCameraFar=H.camera.far,i.pointShadow[x]=ee,i.pointShadowMap[x]=z,i.pointShadowMatrix[x]=P.shadow.matrix,y++}i.point[x]=G,x++}else if(P.isHemisphereLight){let G=e.get(P);G.skyColor.copy(P.color).multiplyScalar(F),G.groundColor.copy(P.groundColor).multiplyScalar(F),i.hemi[u]=G,u++}}_>0&&(t.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=ye.LTC_FLOAT_1,i.rectAreaLTC2=ye.LTC_FLOAT_2):(i.rectAreaLTC1=ye.LTC_HALF_1,i.rectAreaLTC2=ye.LTC_HALF_2)),i.ambient[0]=d,i.ambient[1]=f,i.ambient[2]=h;let g=i.hash;(g.directionalLength!==p||g.pointLength!==x||g.spotLength!==M||g.rectAreaLength!==_||g.hemiLength!==u||g.numDirectionalShadows!==m||g.numPointShadows!==y||g.numSpotShadows!==w||g.numSpotMaps!==R||g.numLightProbes!==A)&&(i.directional.length=p,i.spot.length=M,i.rectArea.length=_,i.point.length=x,i.hemi.length=u,i.directionalShadow.length=m,i.directionalShadowMap.length=m,i.pointShadow.length=y,i.pointShadowMap.length=y,i.spotShadow.length=w,i.spotShadowMap.length=w,i.directionalShadowMatrix.length=m,i.pointShadowMatrix.length=y,i.spotLightMatrix.length=w+R-E,i.spotLightMap.length=R,i.numSpotLightShadowsWithMaps=E,i.numLightProbes=A,g.directionalLength=p,g.pointLength=x,g.spotLength=M,g.rectAreaLength=_,g.hemiLength=u,g.numDirectionalShadows=m,g.numPointShadows=y,g.numSpotShadows=w,g.numSpotMaps=R,g.numLightProbes=A,i.version=nA++)}function l(c,d){let f=0,h=0,p=0,x=0,M=0,_=d.matrixWorldInverse;for(let u=0,m=c.length;u<m;u++){let y=c[u];if(y.isDirectionalLight){let w=i.directional[f];w.direction.setFromMatrixPosition(y.matrixWorld),r.setFromMatrixPosition(y.target.matrixWorld),w.direction.sub(r),w.direction.transformDirection(_),f++}else if(y.isSpotLight){let w=i.spot[p];w.position.setFromMatrixPosition(y.matrixWorld),w.position.applyMatrix4(_),w.direction.setFromMatrixPosition(y.matrixWorld),r.setFromMatrixPosition(y.target.matrixWorld),w.direction.sub(r),w.direction.transformDirection(_),p++}else if(y.isRectAreaLight){let w=i.rectArea[x];w.position.setFromMatrixPosition(y.matrixWorld),w.position.applyMatrix4(_),o.identity(),s.copy(y.matrixWorld),s.premultiply(_),o.extractRotation(s),w.halfWidth.set(y.width*.5,0,0),w.halfHeight.set(0,y.height*.5,0),w.halfWidth.applyMatrix4(o),w.halfHeight.applyMatrix4(o),x++}else if(y.isPointLight){let w=i.point[h];w.position.setFromMatrixPosition(y.matrixWorld),w.position.applyMatrix4(_),h++}else if(y.isHemisphereLight){let w=i.hemi[M];w.direction.setFromMatrixPosition(y.matrixWorld),w.direction.transformDirection(_),M++}}}return{setup:a,setupView:l,state:i}}function hy(t){let e=new rA(t),n=[],i=[],r=[];function s(h){f.camera=h,n.length=0,i.length=0,r.length=0}function o(h){n.push(h)}function a(h){i.push(h)}function l(h){r.push(h)}function c(){e.setup(n)}function d(h){e.setupView(n,h)}let f={lightsArray:n,shadowsArray:i,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:f,setupLights:c,setupLightsView:d,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function sA(t){let e=new WeakMap;function n(r,s=0){let o=e.get(r),a;return o===void 0?(a=new hy(t),e.set(r,[a])):s>=o.length?(a=new hy(t),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:n,dispose:i}}var oA=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,aA=`uniform sampler2D shadow_pass;
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
}`,lA=[new L(1,0,0),new L(-1,0,0),new L(0,1,0),new L(0,-1,0),new L(0,0,1),new L(0,0,-1)],cA=[new L(0,-1,0),new L(0,-1,0),new L(0,0,1),new L(0,0,-1),new L(0,-1,0),new L(0,-1,0)],dy=new Pt,fl=new L,Gm=new L;function uA(t,e,n){let i=new Mo,r=new Ce,s=new Ce,o=new It,a=new Vu,l=new Gu,c={},d=n.maxTextureSize,f={[er]:vn,[vn]:er,[Ii]:Ii},h=new zn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ce},radius:{value:4}},vertexShader:oA,fragmentShader:aA}),p=h.clone();p.defines.HORIZONTAL_PASS=1;let x=new Cn;x.setAttribute("position",new Bn(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let M=new Bt(x,h),_=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=nl;let u=this.type;this.render=function(E,A,g){if(_.enabled===!1||_.autoUpdate===!1&&_.needsUpdate===!1||E.length===0)return;this.type===lx&&(Le("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=nl);let b=t.getRenderTarget(),I=t.getActiveCubeFace(),P=t.getActiveMipmapLevel(),N=t.state;N.setBlending(Li),N.buffers.depth.getReversed()===!0?N.buffers.color.setClear(0,0,0,0):N.buffers.color.setClear(1,1,1,1),N.buffers.depth.setTest(!0),N.setScissorTest(!1);let F=u!==this.type;F&&A.traverse(function(W){W.material&&(Array.isArray(W.material)?W.material.forEach(z=>z.needsUpdate=!0):W.material.needsUpdate=!0)});for(let W=0,z=E.length;W<z;W++){let G=E[W],H=G.shadow;if(H===void 0){Le("WebGLShadowMap:",G,"has no shadow.");continue}if(H.autoUpdate===!1&&H.needsUpdate===!1)continue;r.copy(H.mapSize);let ee=H.getFrameExtents();r.multiply(ee),s.copy(H.mapSize),(r.x>d||r.y>d)&&(r.x>d&&(s.x=Math.floor(d/ee.x),r.x=s.x*ee.x,H.mapSize.x=s.x),r.y>d&&(s.y=Math.floor(d/ee.y),r.y=s.y*ee.y,H.mapSize.y=s.y));let re=t.state.buffers.depth.getReversed();if(H.camera._reversedDepth=re,H.map===null||F===!0){if(H.map!==null&&(H.map.depthTexture!==null&&(H.map.depthTexture.dispose(),H.map.depthTexture=null),H.map.dispose()),this.type===Eo){if(G.isPointLight){Le("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}H.map=new kn(r.x,r.y,{format:Hr,type:Ni,minFilter:jt,magFilter:jt,generateMipmaps:!1}),H.map.texture.name=G.name+".shadowMap",H.map.depthTexture=new nr(r.x,r.y,pi),H.map.depthTexture.name=G.name+".shadowMapDepth",H.map.depthTexture.format=Ai,H.map.depthTexture.compareFunction=null,H.map.depthTexture.minFilter=qt,H.map.depthTexture.magFilter=qt}else G.isPointLight?(H.map=new Zh(r.x),H.map.depthTexture=new Lu(r.x,fi)):(H.map=new kn(r.x,r.y),H.map.depthTexture=new nr(r.x,r.y,fi)),H.map.depthTexture.name=G.name+".shadowMap",H.map.depthTexture.format=Ai,this.type===nl?(H.map.depthTexture.compareFunction=re?Wh:Hh,H.map.depthTexture.minFilter=jt,H.map.depthTexture.magFilter=jt):(H.map.depthTexture.compareFunction=null,H.map.depthTexture.minFilter=qt,H.map.depthTexture.magFilter=qt);H.camera.updateProjectionMatrix()}let se=H.map.isWebGLCubeRenderTarget?6:1;for(let ve=0;ve<se;ve++){if(H.map.isWebGLCubeRenderTarget)t.setRenderTarget(H.map,ve),t.clear();else{ve===0&&(t.setRenderTarget(H.map),t.clear());let pe=H.getViewport(ve);o.set(s.x*pe.x,s.y*pe.y,s.x*pe.z,s.y*pe.w),N.viewport(o)}if(G.isPointLight){let pe=H.camera,Pe=H.matrix,st=G.distance||pe.far;st!==pe.far&&(pe.far=st,pe.updateProjectionMatrix()),fl.setFromMatrixPosition(G.matrixWorld),pe.position.copy(fl),Gm.copy(pe.position),Gm.add(lA[ve]),pe.up.copy(cA[ve]),pe.lookAt(Gm),pe.updateMatrixWorld(),Pe.makeTranslation(-fl.x,-fl.y,-fl.z),dy.multiplyMatrices(pe.projectionMatrix,pe.matrixWorldInverse),H._frustum.setFromProjectionMatrix(dy,pe.coordinateSystem,pe.reversedDepth)}else H.updateMatrices(G);i=H.getFrustum(),w(A,g,H.camera,G,this.type)}H.isPointLightShadow!==!0&&this.type===Eo&&m(H,g),H.needsUpdate=!1}u=this.type,_.needsUpdate=!1,t.setRenderTarget(b,I,P)};function m(E,A){let g=e.update(M);h.defines.VSM_SAMPLES!==E.blurSamples&&(h.defines.VSM_SAMPLES=E.blurSamples,p.defines.VSM_SAMPLES=E.blurSamples,h.needsUpdate=!0,p.needsUpdate=!0),E.mapPass===null&&(E.mapPass=new kn(r.x,r.y,{format:Hr,type:Ni})),h.uniforms.shadow_pass.value=E.map.depthTexture,h.uniforms.resolution.value=E.mapSize,h.uniforms.radius.value=E.radius,t.setRenderTarget(E.mapPass),t.clear(),t.renderBufferDirect(A,null,g,h,M,null),p.uniforms.shadow_pass.value=E.mapPass.texture,p.uniforms.resolution.value=E.mapSize,p.uniforms.radius.value=E.radius,t.setRenderTarget(E.map),t.clear(),t.renderBufferDirect(A,null,g,p,M,null)}function y(E,A,g,b){let I=null,P=g.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(P!==void 0)I=P;else if(I=g.isPointLight===!0?l:a,t.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0||A.alphaToCoverage===!0){let N=I.uuid,F=A.uuid,W=c[N];W===void 0&&(W={},c[N]=W);let z=W[F];z===void 0&&(z=I.clone(),W[F]=z,A.addEventListener("dispose",R)),I=z}if(I.visible=A.visible,I.wireframe=A.wireframe,b===Eo?I.side=A.shadowSide!==null?A.shadowSide:A.side:I.side=A.shadowSide!==null?A.shadowSide:f[A.side],I.alphaMap=A.alphaMap,I.alphaTest=A.alphaToCoverage===!0?.5:A.alphaTest,I.map=A.map,I.clipShadows=A.clipShadows,I.clippingPlanes=A.clippingPlanes,I.clipIntersection=A.clipIntersection,I.displacementMap=A.displacementMap,I.displacementScale=A.displacementScale,I.displacementBias=A.displacementBias,I.wireframeLinewidth=A.wireframeLinewidth,I.linewidth=A.linewidth,g.isPointLight===!0&&I.isMeshDistanceMaterial===!0){let N=t.properties.get(I);N.light=g}return I}function w(E,A,g,b,I){if(E.visible===!1)return;if(E.layers.test(A.layers)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&I===Eo)&&(!E.frustumCulled||i.intersectsObject(E))){E.modelViewMatrix.multiplyMatrices(g.matrixWorldInverse,E.matrixWorld);let F=e.update(E),W=E.material;if(Array.isArray(W)){let z=F.groups;for(let G=0,H=z.length;G<H;G++){let ee=z[G],re=W[ee.materialIndex];if(re&&re.visible){let se=y(E,re,b,I);E.onBeforeShadow(t,E,A,g,F,se,ee),t.renderBufferDirect(g,null,F,se,E,ee),E.onAfterShadow(t,E,A,g,F,se,ee)}}}else if(W.visible){let z=y(E,W,b,I);E.onBeforeShadow(t,E,A,g,F,z,null),t.renderBufferDirect(g,null,F,z,E,null),E.onAfterShadow(t,E,A,g,F,z,null)}}let N=E.children;for(let F=0,W=N.length;F<W;F++)w(N[F],A,g,b,I)}function R(E){E.target.removeEventListener("dispose",R);for(let g in c){let b=c[g],I=E.target.uuid;I in b&&(b[I].dispose(),delete b[I])}}}function hA(t,e){function n(){let D=!1,oe=new It,q=null,xe=new It(0,0,0,0);return{setMask:function(ce){q!==ce&&!D&&(t.colorMask(ce,ce,ce,ce),q=ce)},setLocked:function(ce){D=ce},setClear:function(ce,Q,Te,Ge,gt){gt===!0&&(ce*=Ge,Q*=Ge,Te*=Ge),oe.set(ce,Q,Te,Ge),xe.equals(oe)===!1&&(t.clearColor(ce,Q,Te,Ge),xe.copy(oe))},reset:function(){D=!1,q=null,xe.set(-1,0,0,0)}}}function i(){let D=!1,oe=!1,q=null,xe=null,ce=null;return{setReversed:function(Q){if(oe!==Q){let Te=e.get("EXT_clip_control");Q?Te.clipControlEXT(Te.LOWER_LEFT_EXT,Te.ZERO_TO_ONE_EXT):Te.clipControlEXT(Te.LOWER_LEFT_EXT,Te.NEGATIVE_ONE_TO_ONE_EXT),oe=Q;let Ge=ce;ce=null,this.setClear(Ge)}},getReversed:function(){return oe},setTest:function(Q){Q?he(t.DEPTH_TEST):Ie(t.DEPTH_TEST)},setMask:function(Q){q!==Q&&!D&&(t.depthMask(Q),q=Q)},setFunc:function(Q){if(oe&&(Q=Vx[Q]),xe!==Q){switch(Q){case gu:t.depthFunc(t.NEVER);break;case _u:t.depthFunc(t.ALWAYS);break;case vu:t.depthFunc(t.LESS);break;case ms:t.depthFunc(t.LEQUAL);break;case xu:t.depthFunc(t.EQUAL);break;case yu:t.depthFunc(t.GEQUAL);break;case Su:t.depthFunc(t.GREATER);break;case Mu:t.depthFunc(t.NOTEQUAL);break;default:t.depthFunc(t.LEQUAL)}xe=Q}},setLocked:function(Q){D=Q},setClear:function(Q){ce!==Q&&(ce=Q,oe&&(Q=1-Q),t.clearDepth(Q))},reset:function(){D=!1,q=null,xe=null,ce=null,oe=!1}}}function r(){let D=!1,oe=null,q=null,xe=null,ce=null,Q=null,Te=null,Ge=null,gt=null;return{setTest:function(nt){D||(nt?he(t.STENCIL_TEST):Ie(t.STENCIL_TEST))},setMask:function(nt){oe!==nt&&!D&&(t.stencilMask(nt),oe=nt)},setFunc:function(nt,xn,dn){(q!==nt||xe!==xn||ce!==dn)&&(t.stencilFunc(nt,xn,dn),q=nt,xe=xn,ce=dn)},setOp:function(nt,xn,dn){(Q!==nt||Te!==xn||Ge!==dn)&&(t.stencilOp(nt,xn,dn),Q=nt,Te=xn,Ge=dn)},setLocked:function(nt){D=nt},setClear:function(nt){gt!==nt&&(t.clearStencil(nt),gt=nt)},reset:function(){D=!1,oe=null,q=null,xe=null,ce=null,Q=null,Te=null,Ge=null,gt=null}}}let s=new n,o=new i,a=new r,l=new WeakMap,c=new WeakMap,d={},f={},h={},p=new WeakMap,x=[],M=null,_=!1,u=null,m=null,y=null,w=null,R=null,E=null,A=null,g=new Ke(0,0,0),b=0,I=!1,P=null,N=null,F=null,W=null,z=null,G=t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS),H=!1,ee=0,re=t.getParameter(t.VERSION);re.indexOf("WebGL")!==-1?(ee=parseFloat(/^WebGL (\d)/.exec(re)[1]),H=ee>=1):re.indexOf("OpenGL ES")!==-1&&(ee=parseFloat(/^OpenGL ES (\d)/.exec(re)[1]),H=ee>=2);let se=null,ve={},pe=t.getParameter(t.SCISSOR_BOX),Pe=t.getParameter(t.VIEWPORT),st=new It().fromArray(pe),Oe=new It().fromArray(Pe);function J(D,oe,q,xe){let ce=new Uint8Array(4),Q=t.createTexture();t.bindTexture(D,Q),t.texParameteri(D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(D,t.TEXTURE_MAG_FILTER,t.NEAREST);for(let Te=0;Te<q;Te++)D===t.TEXTURE_3D||D===t.TEXTURE_2D_ARRAY?t.texImage3D(oe,0,t.RGBA,1,1,xe,0,t.RGBA,t.UNSIGNED_BYTE,ce):t.texImage2D(oe+Te,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,ce);return Q}let ge={};ge[t.TEXTURE_2D]=J(t.TEXTURE_2D,t.TEXTURE_2D,1),ge[t.TEXTURE_CUBE_MAP]=J(t.TEXTURE_CUBE_MAP,t.TEXTURE_CUBE_MAP_POSITIVE_X,6),ge[t.TEXTURE_2D_ARRAY]=J(t.TEXTURE_2D_ARRAY,t.TEXTURE_2D_ARRAY,1,1),ge[t.TEXTURE_3D]=J(t.TEXTURE_3D,t.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),he(t.DEPTH_TEST),o.setFunc(ms),bt(!1),pt(sm),he(t.CULL_FACE),rt(Li);function he(D){d[D]!==!0&&(t.enable(D),d[D]=!0)}function Ie(D){d[D]!==!1&&(t.disable(D),d[D]=!1)}function Be(D,oe){return h[D]!==oe?(t.bindFramebuffer(D,oe),h[D]=oe,D===t.DRAW_FRAMEBUFFER&&(h[t.FRAMEBUFFER]=oe),D===t.FRAMEBUFFER&&(h[t.DRAW_FRAMEBUFFER]=oe),!0):!1}function Re(D,oe){let q=x,xe=!1;if(D){q=p.get(oe),q===void 0&&(q=[],p.set(oe,q));let ce=D.textures;if(q.length!==ce.length||q[0]!==t.COLOR_ATTACHMENT0){for(let Q=0,Te=ce.length;Q<Te;Q++)q[Q]=t.COLOR_ATTACHMENT0+Q;q.length=ce.length,xe=!0}}else q[0]!==t.BACK&&(q[0]=t.BACK,xe=!0);xe&&t.drawBuffers(q)}function ke(D){return M!==D?(t.useProgram(D),M=D,!0):!1}let Ye={[Dr]:t.FUNC_ADD,[ux]:t.FUNC_SUBTRACT,[hx]:t.FUNC_REVERSE_SUBTRACT};Ye[dx]=t.MIN,Ye[fx]=t.MAX;let et={[px]:t.ZERO,[mx]:t.ONE,[gx]:t.SRC_COLOR,[pu]:t.SRC_ALPHA,[Mx]:t.SRC_ALPHA_SATURATE,[yx]:t.DST_COLOR,[vx]:t.DST_ALPHA,[_x]:t.ONE_MINUS_SRC_COLOR,[mu]:t.ONE_MINUS_SRC_ALPHA,[Sx]:t.ONE_MINUS_DST_COLOR,[xx]:t.ONE_MINUS_DST_ALPHA,[wx]:t.CONSTANT_COLOR,[Ex]:t.ONE_MINUS_CONSTANT_COLOR,[Tx]:t.CONSTANT_ALPHA,[bx]:t.ONE_MINUS_CONSTANT_ALPHA};function rt(D,oe,q,xe,ce,Q,Te,Ge,gt,nt){if(D===Li){_===!0&&(Ie(t.BLEND),_=!1);return}if(_===!1&&(he(t.BLEND),_=!0),D!==cx){if(D!==u||nt!==I){if((m!==Dr||R!==Dr)&&(t.blendEquation(t.FUNC_ADD),m=Dr,R=Dr),nt)switch(D){case ps:t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case om:t.blendFunc(t.ONE,t.ONE);break;case am:t.blendFuncSeparate(t.ZERO,t.ONE_MINUS_SRC_COLOR,t.ZERO,t.ONE);break;case lm:t.blendFuncSeparate(t.DST_COLOR,t.ONE_MINUS_SRC_ALPHA,t.ZERO,t.ONE);break;default:De("WebGLState: Invalid blending: ",D);break}else switch(D){case ps:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case om:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE,t.ONE,t.ONE);break;case am:De("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case lm:De("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:De("WebGLState: Invalid blending: ",D);break}y=null,w=null,E=null,A=null,g.set(0,0,0),b=0,u=D,I=nt}return}ce=ce||oe,Q=Q||q,Te=Te||xe,(oe!==m||ce!==R)&&(t.blendEquationSeparate(Ye[oe],Ye[ce]),m=oe,R=ce),(q!==y||xe!==w||Q!==E||Te!==A)&&(t.blendFuncSeparate(et[q],et[xe],et[Q],et[Te]),y=q,w=xe,E=Q,A=Te),(Ge.equals(g)===!1||gt!==b)&&(t.blendColor(Ge.r,Ge.g,Ge.b,gt),g.copy(Ge),b=gt),u=D,I=!1}function We(D,oe){D.side===Ii?Ie(t.CULL_FACE):he(t.CULL_FACE);let q=D.side===vn;oe&&(q=!q),bt(q),D.blending===ps&&D.transparent===!1?rt(Li):rt(D.blending,D.blendEquation,D.blendSrc,D.blendDst,D.blendEquationAlpha,D.blendSrcAlpha,D.blendDstAlpha,D.blendColor,D.blendAlpha,D.premultipliedAlpha),o.setFunc(D.depthFunc),o.setTest(D.depthTest),o.setMask(D.depthWrite),s.setMask(D.colorWrite);let xe=D.stencilWrite;a.setTest(xe),xe&&(a.setMask(D.stencilWriteMask),a.setFunc(D.stencilFunc,D.stencilRef,D.stencilFuncMask),a.setOp(D.stencilFail,D.stencilZFail,D.stencilZPass)),k(D.polygonOffset,D.polygonOffsetFactor,D.polygonOffsetUnits),D.alphaToCoverage===!0?he(t.SAMPLE_ALPHA_TO_COVERAGE):Ie(t.SAMPLE_ALPHA_TO_COVERAGE)}function bt(D){P!==D&&(D?t.frontFace(t.CW):t.frontFace(t.CCW),P=D)}function pt(D){D!==ox?(he(t.CULL_FACE),D!==N&&(D===sm?t.cullFace(t.BACK):D===ax?t.cullFace(t.FRONT):t.cullFace(t.FRONT_AND_BACK))):Ie(t.CULL_FACE),N=D}function mt(D){D!==F&&(H&&t.lineWidth(D),F=D)}function k(D,oe,q){D?(he(t.POLYGON_OFFSET_FILL),(W!==oe||z!==q)&&(W=oe,z=q,o.getReversed()&&(oe=-oe),t.polygonOffset(oe,q))):Ie(t.POLYGON_OFFSET_FILL)}function lt(D){D?he(t.SCISSOR_TEST):Ie(t.SCISSOR_TEST)}function ze(D){D===void 0&&(D=t.TEXTURE0+G-1),se!==D&&(t.activeTexture(D),se=D)}function ct(D,oe,q){q===void 0&&(se===null?q=t.TEXTURE0+G-1:q=se);let xe=ve[q];xe===void 0&&(xe={type:void 0,texture:void 0},ve[q]=xe),(xe.type!==D||xe.texture!==oe)&&(se!==q&&(t.activeTexture(q),se=q),t.bindTexture(D,oe||ge[D]),xe.type=D,xe.texture=oe)}function _e(){let D=ve[se];D!==void 0&&D.type!==void 0&&(t.bindTexture(D.type,null),D.type=void 0,D.texture=void 0)}function wt(){try{t.compressedTexImage2D(...arguments)}catch(D){De("WebGLState:",D)}}function C(){try{t.compressedTexImage3D(...arguments)}catch(D){De("WebGLState:",D)}}function S(){try{t.texSubImage2D(...arguments)}catch(D){De("WebGLState:",D)}}function V(){try{t.texSubImage3D(...arguments)}catch(D){De("WebGLState:",D)}}function Y(){try{t.compressedTexSubImage2D(...arguments)}catch(D){De("WebGLState:",D)}}function j(){try{t.compressedTexSubImage3D(...arguments)}catch(D){De("WebGLState:",D)}}function le(){try{t.texStorage2D(...arguments)}catch(D){De("WebGLState:",D)}}function de(){try{t.texStorage3D(...arguments)}catch(D){De("WebGLState:",D)}}function X(){try{t.texImage2D(...arguments)}catch(D){De("WebGLState:",D)}}function $(){try{t.texImage3D(...arguments)}catch(D){De("WebGLState:",D)}}function Se(D){return f[D]!==void 0?f[D]:t.getParameter(D)}function Me(D,oe){f[D]!==oe&&(t.pixelStorei(D,oe),f[D]=oe)}function ue(D){st.equals(D)===!1&&(t.scissor(D.x,D.y,D.z,D.w),st.copy(D))}function te(D){Oe.equals(D)===!1&&(t.viewport(D.x,D.y,D.z,D.w),Oe.copy(D))}function Ue(D,oe){let q=c.get(oe);q===void 0&&(q=new WeakMap,c.set(oe,q));let xe=q.get(D);xe===void 0&&(xe=t.getUniformBlockIndex(oe,D.name),q.set(D,xe))}function Ve(D,oe){let xe=c.get(oe).get(D);l.get(oe)!==xe&&(t.uniformBlockBinding(oe,xe,D.__bindingPointIndex),l.set(oe,xe))}function Qe(){t.disable(t.BLEND),t.disable(t.CULL_FACE),t.disable(t.DEPTH_TEST),t.disable(t.POLYGON_OFFSET_FILL),t.disable(t.SCISSOR_TEST),t.disable(t.STENCIL_TEST),t.disable(t.SAMPLE_ALPHA_TO_COVERAGE),t.blendEquation(t.FUNC_ADD),t.blendFunc(t.ONE,t.ZERO),t.blendFuncSeparate(t.ONE,t.ZERO,t.ONE,t.ZERO),t.blendColor(0,0,0,0),t.colorMask(!0,!0,!0,!0),t.clearColor(0,0,0,0),t.depthMask(!0),t.depthFunc(t.LESS),o.setReversed(!1),t.clearDepth(1),t.stencilMask(4294967295),t.stencilFunc(t.ALWAYS,0,4294967295),t.stencilOp(t.KEEP,t.KEEP,t.KEEP),t.clearStencil(0),t.cullFace(t.BACK),t.frontFace(t.CCW),t.polygonOffset(0,0),t.activeTexture(t.TEXTURE0),t.bindFramebuffer(t.FRAMEBUFFER,null),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),t.bindFramebuffer(t.READ_FRAMEBUFFER,null),t.useProgram(null),t.lineWidth(1),t.scissor(0,0,t.canvas.width,t.canvas.height),t.viewport(0,0,t.canvas.width,t.canvas.height),t.pixelStorei(t.PACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.BROWSER_DEFAULT_WEBGL),t.pixelStorei(t.PACK_ROW_LENGTH,0),t.pixelStorei(t.PACK_SKIP_PIXELS,0),t.pixelStorei(t.PACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_ROW_LENGTH,0),t.pixelStorei(t.UNPACK_IMAGE_HEIGHT,0),t.pixelStorei(t.UNPACK_SKIP_PIXELS,0),t.pixelStorei(t.UNPACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_SKIP_IMAGES,0),d={},f={},se=null,ve={},h={},p=new WeakMap,x=[],M=null,_=!1,u=null,m=null,y=null,w=null,R=null,E=null,A=null,g=new Ke(0,0,0),b=0,I=!1,P=null,N=null,F=null,W=null,z=null,st.set(0,0,t.canvas.width,t.canvas.height),Oe.set(0,0,t.canvas.width,t.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:he,disable:Ie,bindFramebuffer:Be,drawBuffers:Re,useProgram:ke,setBlending:rt,setMaterial:We,setFlipSided:bt,setCullFace:pt,setLineWidth:mt,setPolygonOffset:k,setScissorTest:lt,activeTexture:ze,bindTexture:ct,unbindTexture:_e,compressedTexImage2D:wt,compressedTexImage3D:C,texImage2D:X,texImage3D:$,pixelStorei:Me,getParameter:Se,updateUBOMapping:Ue,uniformBlockBinding:Ve,texStorage2D:le,texStorage3D:de,texSubImage2D:S,texSubImage3D:V,compressedTexSubImage2D:Y,compressedTexSubImage3D:j,scissor:ue,viewport:te,reset:Qe}}function dA(t,e,n,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Ce,d=new WeakMap,f=new Set,h,p=new WeakMap,x=!1;try{x=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function M(C,S){return x?new OffscreenCanvas(C,S):Fa("canvas")}function _(C,S,V){let Y=1,j=wt(C);if((j.width>V||j.height>V)&&(Y=V/Math.max(j.width,j.height)),Y<1)if(typeof HTMLImageElement<"u"&&C instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&C instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&C instanceof ImageBitmap||typeof VideoFrame<"u"&&C instanceof VideoFrame){let le=Math.floor(Y*j.width),de=Math.floor(Y*j.height);h===void 0&&(h=M(le,de));let X=S?M(le,de):h;return X.width=le,X.height=de,X.getContext("2d").drawImage(C,0,0,le,de),Le("WebGLRenderer: Texture has been resized from ("+j.width+"x"+j.height+") to ("+le+"x"+de+")."),X}else return"data"in C&&Le("WebGLRenderer: Image in DataTexture is too big ("+j.width+"x"+j.height+")."),C;return C}function u(C){return C.generateMipmaps}function m(C){t.generateMipmap(C)}function y(C){return C.isWebGLCubeRenderTarget?t.TEXTURE_CUBE_MAP:C.isWebGL3DRenderTarget?t.TEXTURE_3D:C.isWebGLArrayRenderTarget||C.isCompressedArrayTexture?t.TEXTURE_2D_ARRAY:t.TEXTURE_2D}function w(C,S,V,Y,j,le=!1){if(C!==null){if(t[C]!==void 0)return t[C];Le("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+C+"'")}let de;Y&&(de=e.get("EXT_texture_norm16"),de||Le("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let X=S;if(S===t.RED&&(V===t.FLOAT&&(X=t.R32F),V===t.HALF_FLOAT&&(X=t.R16F),V===t.UNSIGNED_BYTE&&(X=t.R8),V===t.UNSIGNED_SHORT&&de&&(X=de.R16_EXT),V===t.SHORT&&de&&(X=de.R16_SNORM_EXT)),S===t.RED_INTEGER&&(V===t.UNSIGNED_BYTE&&(X=t.R8UI),V===t.UNSIGNED_SHORT&&(X=t.R16UI),V===t.UNSIGNED_INT&&(X=t.R32UI),V===t.BYTE&&(X=t.R8I),V===t.SHORT&&(X=t.R16I),V===t.INT&&(X=t.R32I)),S===t.RG&&(V===t.FLOAT&&(X=t.RG32F),V===t.HALF_FLOAT&&(X=t.RG16F),V===t.UNSIGNED_BYTE&&(X=t.RG8),V===t.UNSIGNED_SHORT&&de&&(X=de.RG16_EXT),V===t.SHORT&&de&&(X=de.RG16_SNORM_EXT)),S===t.RG_INTEGER&&(V===t.UNSIGNED_BYTE&&(X=t.RG8UI),V===t.UNSIGNED_SHORT&&(X=t.RG16UI),V===t.UNSIGNED_INT&&(X=t.RG32UI),V===t.BYTE&&(X=t.RG8I),V===t.SHORT&&(X=t.RG16I),V===t.INT&&(X=t.RG32I)),S===t.RGB_INTEGER&&(V===t.UNSIGNED_BYTE&&(X=t.RGB8UI),V===t.UNSIGNED_SHORT&&(X=t.RGB16UI),V===t.UNSIGNED_INT&&(X=t.RGB32UI),V===t.BYTE&&(X=t.RGB8I),V===t.SHORT&&(X=t.RGB16I),V===t.INT&&(X=t.RGB32I)),S===t.RGBA_INTEGER&&(V===t.UNSIGNED_BYTE&&(X=t.RGBA8UI),V===t.UNSIGNED_SHORT&&(X=t.RGBA16UI),V===t.UNSIGNED_INT&&(X=t.RGBA32UI),V===t.BYTE&&(X=t.RGBA8I),V===t.SHORT&&(X=t.RGBA16I),V===t.INT&&(X=t.RGBA32I)),S===t.RGB&&(V===t.UNSIGNED_SHORT&&de&&(X=de.RGB16_EXT),V===t.SHORT&&de&&(X=de.RGB16_SNORM_EXT),V===t.UNSIGNED_INT_5_9_9_9_REV&&(X=t.RGB9_E5),V===t.UNSIGNED_INT_10F_11F_11F_REV&&(X=t.R11F_G11F_B10F)),S===t.RGBA){let $=le?Ua:je.getTransfer(j);V===t.FLOAT&&(X=t.RGBA32F),V===t.HALF_FLOAT&&(X=t.RGBA16F),V===t.UNSIGNED_BYTE&&(X=$===at?t.SRGB8_ALPHA8:t.RGBA8),V===t.UNSIGNED_SHORT&&de&&(X=de.RGBA16_EXT),V===t.SHORT&&de&&(X=de.RGBA16_SNORM_EXT),V===t.UNSIGNED_SHORT_4_4_4_4&&(X=t.RGBA4),V===t.UNSIGNED_SHORT_5_5_5_1&&(X=t.RGB5_A1)}return(X===t.R16F||X===t.R32F||X===t.RG16F||X===t.RG32F||X===t.RGBA16F||X===t.RGBA32F)&&e.get("EXT_color_buffer_float"),X}function R(C,S){let V;return C?S===null||S===fi||S===bo?V=t.DEPTH24_STENCIL8:S===pi?V=t.DEPTH32F_STENCIL8:S===To&&(V=t.DEPTH24_STENCIL8,Le("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):S===null||S===fi||S===bo?V=t.DEPTH_COMPONENT24:S===pi?V=t.DEPTH_COMPONENT32F:S===To&&(V=t.DEPTH_COMPONENT16),V}function E(C,S){return u(C)===!0||C.isFramebufferTexture&&C.minFilter!==qt&&C.minFilter!==jt?Math.log2(Math.max(S.width,S.height))+1:C.mipmaps!==void 0&&C.mipmaps.length>0?C.mipmaps.length:C.isCompressedTexture&&Array.isArray(C.image)?S.mipmaps.length:1}function A(C){let S=C.target;S.removeEventListener("dispose",A),b(S),S.isVideoTexture&&d.delete(S),S.isHTMLTexture&&f.delete(S)}function g(C){let S=C.target;S.removeEventListener("dispose",g),P(S)}function b(C){let S=i.get(C);if(S.__webglInit===void 0)return;let V=C.source,Y=p.get(V);if(Y){let j=Y[S.__cacheKey];j.usedTimes--,j.usedTimes===0&&I(C),Object.keys(Y).length===0&&p.delete(V)}i.remove(C)}function I(C){let S=i.get(C);t.deleteTexture(S.__webglTexture);let V=C.source,Y=p.get(V);delete Y[S.__cacheKey],o.memory.textures--}function P(C){let S=i.get(C);if(C.depthTexture&&(C.depthTexture.dispose(),i.remove(C.depthTexture)),C.isWebGLCubeRenderTarget)for(let Y=0;Y<6;Y++){if(Array.isArray(S.__webglFramebuffer[Y]))for(let j=0;j<S.__webglFramebuffer[Y].length;j++)t.deleteFramebuffer(S.__webglFramebuffer[Y][j]);else t.deleteFramebuffer(S.__webglFramebuffer[Y]);S.__webglDepthbuffer&&t.deleteRenderbuffer(S.__webglDepthbuffer[Y])}else{if(Array.isArray(S.__webglFramebuffer))for(let Y=0;Y<S.__webglFramebuffer.length;Y++)t.deleteFramebuffer(S.__webglFramebuffer[Y]);else t.deleteFramebuffer(S.__webglFramebuffer);if(S.__webglDepthbuffer&&t.deleteRenderbuffer(S.__webglDepthbuffer),S.__webglMultisampledFramebuffer&&t.deleteFramebuffer(S.__webglMultisampledFramebuffer),S.__webglColorRenderbuffer)for(let Y=0;Y<S.__webglColorRenderbuffer.length;Y++)S.__webglColorRenderbuffer[Y]&&t.deleteRenderbuffer(S.__webglColorRenderbuffer[Y]);S.__webglDepthRenderbuffer&&t.deleteRenderbuffer(S.__webglDepthRenderbuffer)}let V=C.textures;for(let Y=0,j=V.length;Y<j;Y++){let le=i.get(V[Y]);le.__webglTexture&&(t.deleteTexture(le.__webglTexture),o.memory.textures--),i.remove(V[Y])}i.remove(C)}let N=0;function F(){N=0}function W(){return N}function z(C){N=C}function G(){let C=N;return C>=r.maxTextures&&Le("WebGLTextures: Trying to use "+C+" texture units while this GPU supports only "+r.maxTextures),N+=1,C}function H(C){let S=[];return S.push(C.wrapS),S.push(C.wrapT),S.push(C.wrapR||0),S.push(C.magFilter),S.push(C.minFilter),S.push(C.anisotropy),S.push(C.internalFormat),S.push(C.format),S.push(C.type),S.push(C.generateMipmaps),S.push(C.premultiplyAlpha),S.push(C.flipY),S.push(C.unpackAlignment),S.push(C.colorSpace),S.join()}function ee(C,S){let V=i.get(C);if(C.isVideoTexture&&ct(C),C.isRenderTargetTexture===!1&&C.isExternalTexture!==!0&&C.version>0&&V.__version!==C.version){let Y=C.image;if(Y===null)Le("WebGLRenderer: Texture marked for update but no image data found.");else if(Y.complete===!1)Le("WebGLRenderer: Texture marked for update but image is incomplete");else{Ie(V,C,S);return}}else C.isExternalTexture&&(V.__webglTexture=C.sourceTexture?C.sourceTexture:null);n.bindTexture(t.TEXTURE_2D,V.__webglTexture,t.TEXTURE0+S)}function re(C,S){let V=i.get(C);if(C.isRenderTargetTexture===!1&&C.version>0&&V.__version!==C.version){Ie(V,C,S);return}else C.isExternalTexture&&(V.__webglTexture=C.sourceTexture?C.sourceTexture:null);n.bindTexture(t.TEXTURE_2D_ARRAY,V.__webglTexture,t.TEXTURE0+S)}function se(C,S){let V=i.get(C);if(C.isRenderTargetTexture===!1&&C.version>0&&V.__version!==C.version){Ie(V,C,S);return}n.bindTexture(t.TEXTURE_3D,V.__webglTexture,t.TEXTURE0+S)}function ve(C,S){let V=i.get(C);if(C.isCubeDepthTexture!==!0&&C.version>0&&V.__version!==C.version){Be(V,C,S);return}n.bindTexture(t.TEXTURE_CUBE_MAP,V.__webglTexture,t.TEXTURE0+S)}let pe={[wu]:t.REPEAT,[bi]:t.CLAMP_TO_EDGE,[Eu]:t.MIRRORED_REPEAT},Pe={[qt]:t.NEAREST,[Rx]:t.NEAREST_MIPMAP_NEAREST,[rl]:t.NEAREST_MIPMAP_LINEAR,[jt]:t.LINEAR,[sh]:t.LINEAR_MIPMAP_NEAREST,[Vr]:t.LINEAR_MIPMAP_LINEAR},st={[Lx]:t.NEVER,[Ox]:t.ALWAYS,[Nx]:t.LESS,[Hh]:t.LEQUAL,[Dx]:t.EQUAL,[Wh]:t.GEQUAL,[Ux]:t.GREATER,[Fx]:t.NOTEQUAL};function Oe(C,S){if(S.type===pi&&e.has("OES_texture_float_linear")===!1&&(S.magFilter===jt||S.magFilter===sh||S.magFilter===rl||S.magFilter===Vr||S.minFilter===jt||S.minFilter===sh||S.minFilter===rl||S.minFilter===Vr)&&Le("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),t.texParameteri(C,t.TEXTURE_WRAP_S,pe[S.wrapS]),t.texParameteri(C,t.TEXTURE_WRAP_T,pe[S.wrapT]),(C===t.TEXTURE_3D||C===t.TEXTURE_2D_ARRAY)&&t.texParameteri(C,t.TEXTURE_WRAP_R,pe[S.wrapR]),t.texParameteri(C,t.TEXTURE_MAG_FILTER,Pe[S.magFilter]),t.texParameteri(C,t.TEXTURE_MIN_FILTER,Pe[S.minFilter]),S.compareFunction&&(t.texParameteri(C,t.TEXTURE_COMPARE_MODE,t.COMPARE_REF_TO_TEXTURE),t.texParameteri(C,t.TEXTURE_COMPARE_FUNC,st[S.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(S.magFilter===qt||S.minFilter!==rl&&S.minFilter!==Vr||S.type===pi&&e.has("OES_texture_float_linear")===!1)return;if(S.anisotropy>1||i.get(S).__currentAnisotropy){let V=e.get("EXT_texture_filter_anisotropic");t.texParameterf(C,V.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(S.anisotropy,r.getMaxAnisotropy())),i.get(S).__currentAnisotropy=S.anisotropy}}}function J(C,S){let V=!1;C.__webglInit===void 0&&(C.__webglInit=!0,S.addEventListener("dispose",A));let Y=S.source,j=p.get(Y);j===void 0&&(j={},p.set(Y,j));let le=H(S);if(le!==C.__cacheKey){j[le]===void 0&&(j[le]={texture:t.createTexture(),usedTimes:0},o.memory.textures++,V=!0),j[le].usedTimes++;let de=j[C.__cacheKey];de!==void 0&&(j[C.__cacheKey].usedTimes--,de.usedTimes===0&&I(S)),C.__cacheKey=le,C.__webglTexture=j[le].texture}return V}function ge(C,S,V){return Math.floor(Math.floor(C/V)/S)}function he(C,S,V,Y){let le=C.updateRanges;if(le.length===0)n.texSubImage2D(t.TEXTURE_2D,0,0,0,S.width,S.height,V,Y,S.data);else{le.sort((Me,ue)=>Me.start-ue.start);let de=0;for(let Me=1;Me<le.length;Me++){let ue=le[de],te=le[Me],Ue=ue.start+ue.count,Ve=ge(te.start,S.width,4),Qe=ge(ue.start,S.width,4);te.start<=Ue+1&&Ve===Qe&&ge(te.start+te.count-1,S.width,4)===Ve?ue.count=Math.max(ue.count,te.start+te.count-ue.start):(++de,le[de]=te)}le.length=de+1;let X=n.getParameter(t.UNPACK_ROW_LENGTH),$=n.getParameter(t.UNPACK_SKIP_PIXELS),Se=n.getParameter(t.UNPACK_SKIP_ROWS);n.pixelStorei(t.UNPACK_ROW_LENGTH,S.width);for(let Me=0,ue=le.length;Me<ue;Me++){let te=le[Me],Ue=Math.floor(te.start/4),Ve=Math.ceil(te.count/4),Qe=Ue%S.width,D=Math.floor(Ue/S.width),oe=Ve,q=1;n.pixelStorei(t.UNPACK_SKIP_PIXELS,Qe),n.pixelStorei(t.UNPACK_SKIP_ROWS,D),n.texSubImage2D(t.TEXTURE_2D,0,Qe,D,oe,q,V,Y,S.data)}C.clearUpdateRanges(),n.pixelStorei(t.UNPACK_ROW_LENGTH,X),n.pixelStorei(t.UNPACK_SKIP_PIXELS,$),n.pixelStorei(t.UNPACK_SKIP_ROWS,Se)}}function Ie(C,S,V){let Y=t.TEXTURE_2D;(S.isDataArrayTexture||S.isCompressedArrayTexture)&&(Y=t.TEXTURE_2D_ARRAY),S.isData3DTexture&&(Y=t.TEXTURE_3D);let j=J(C,S),le=S.source;n.bindTexture(Y,C.__webglTexture,t.TEXTURE0+V);let de=i.get(le);if(le.version!==de.__version||j===!0){if(n.activeTexture(t.TEXTURE0+V),(typeof ImageBitmap<"u"&&S.image instanceof ImageBitmap)===!1){let q=je.getPrimaries(je.workingColorSpace),xe=S.colorSpace===ir?null:je.getPrimaries(S.colorSpace),ce=S.colorSpace===ir||q===xe?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,S.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,ce)}n.pixelStorei(t.UNPACK_ALIGNMENT,S.unpackAlignment);let $=_(S.image,!1,r.maxTextureSize);$=_e(S,$);let Se=s.convert(S.format,S.colorSpace),Me=s.convert(S.type),ue=w(S.internalFormat,Se,Me,S.normalized,S.colorSpace,S.isVideoTexture);Oe(Y,S);let te,Ue=S.mipmaps,Ve=S.isVideoTexture!==!0,Qe=de.__version===void 0||j===!0,D=le.dataReady,oe=E(S,$);if(S.isDepthTexture)ue=R(S.format===Gr,S.type),Qe&&(Ve?n.texStorage2D(t.TEXTURE_2D,1,ue,$.width,$.height):n.texImage2D(t.TEXTURE_2D,0,ue,$.width,$.height,0,Se,Me,null));else if(S.isDataTexture)if(Ue.length>0){Ve&&Qe&&n.texStorage2D(t.TEXTURE_2D,oe,ue,Ue[0].width,Ue[0].height);for(let q=0,xe=Ue.length;q<xe;q++)te=Ue[q],Ve?D&&n.texSubImage2D(t.TEXTURE_2D,q,0,0,te.width,te.height,Se,Me,te.data):n.texImage2D(t.TEXTURE_2D,q,ue,te.width,te.height,0,Se,Me,te.data);S.generateMipmaps=!1}else Ve?(Qe&&n.texStorage2D(t.TEXTURE_2D,oe,ue,$.width,$.height),D&&he(S,$,Se,Me)):n.texImage2D(t.TEXTURE_2D,0,ue,$.width,$.height,0,Se,Me,$.data);else if(S.isCompressedTexture)if(S.isCompressedArrayTexture){Ve&&Qe&&n.texStorage3D(t.TEXTURE_2D_ARRAY,oe,ue,Ue[0].width,Ue[0].height,$.depth);for(let q=0,xe=Ue.length;q<xe;q++)if(te=Ue[q],S.format!==Kn)if(Se!==null)if(Ve){if(D)if(S.layerUpdates.size>0){let ce=Im(te.width,te.height,S.format,S.type);for(let Q of S.layerUpdates){let Te=te.data.subarray(Q*ce/te.data.BYTES_PER_ELEMENT,(Q+1)*ce/te.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,q,0,0,Q,te.width,te.height,1,Se,Te)}S.clearLayerUpdates()}else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,q,0,0,0,te.width,te.height,$.depth,Se,te.data)}else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY,q,ue,te.width,te.height,$.depth,0,te.data,0,0);else Le("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Ve?D&&n.texSubImage3D(t.TEXTURE_2D_ARRAY,q,0,0,0,te.width,te.height,$.depth,Se,Me,te.data):n.texImage3D(t.TEXTURE_2D_ARRAY,q,ue,te.width,te.height,$.depth,0,Se,Me,te.data)}else{Ve&&Qe&&n.texStorage2D(t.TEXTURE_2D,oe,ue,Ue[0].width,Ue[0].height);for(let q=0,xe=Ue.length;q<xe;q++)te=Ue[q],S.format!==Kn?Se!==null?Ve?D&&n.compressedTexSubImage2D(t.TEXTURE_2D,q,0,0,te.width,te.height,Se,te.data):n.compressedTexImage2D(t.TEXTURE_2D,q,ue,te.width,te.height,0,te.data):Le("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Ve?D&&n.texSubImage2D(t.TEXTURE_2D,q,0,0,te.width,te.height,Se,Me,te.data):n.texImage2D(t.TEXTURE_2D,q,ue,te.width,te.height,0,Se,Me,te.data)}else if(S.isDataArrayTexture)if(Ve){if(Qe&&n.texStorage3D(t.TEXTURE_2D_ARRAY,oe,ue,$.width,$.height,$.depth),D)if(S.layerUpdates.size>0){let q=Im($.width,$.height,S.format,S.type);for(let xe of S.layerUpdates){let ce=$.data.subarray(xe*q/$.data.BYTES_PER_ELEMENT,(xe+1)*q/$.data.BYTES_PER_ELEMENT);n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,xe,$.width,$.height,1,Se,Me,ce)}S.clearLayerUpdates()}else n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,0,$.width,$.height,$.depth,Se,Me,$.data)}else n.texImage3D(t.TEXTURE_2D_ARRAY,0,ue,$.width,$.height,$.depth,0,Se,Me,$.data);else if(S.isData3DTexture)Ve?(Qe&&n.texStorage3D(t.TEXTURE_3D,oe,ue,$.width,$.height,$.depth),D&&n.texSubImage3D(t.TEXTURE_3D,0,0,0,0,$.width,$.height,$.depth,Se,Me,$.data)):n.texImage3D(t.TEXTURE_3D,0,ue,$.width,$.height,$.depth,0,Se,Me,$.data);else if(S.isFramebufferTexture){if(Qe)if(Ve)n.texStorage2D(t.TEXTURE_2D,oe,ue,$.width,$.height);else{let q=$.width,xe=$.height;for(let ce=0;ce<oe;ce++)n.texImage2D(t.TEXTURE_2D,ce,ue,q,xe,0,Se,Me,null),q>>=1,xe>>=1}}else if(S.isHTMLTexture){if("texElementImage2D"in t){let q=t.canvas;if(q.hasAttribute("layoutsubtree")||q.setAttribute("layoutsubtree","true"),$.parentNode!==q){q.appendChild($),f.add(S),q.onpaint=Ge=>{let gt=Ge.changedElements;for(let nt of f)gt.includes(nt.image)&&(nt.needsUpdate=!0)},q.requestPaint();return}let xe=0,ce=t.RGBA,Q=t.RGBA,Te=t.UNSIGNED_BYTE;t.texElementImage2D(t.TEXTURE_2D,xe,ce,Q,Te,$),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE)}}else if(Ue.length>0){if(Ve&&Qe){let q=wt(Ue[0]);n.texStorage2D(t.TEXTURE_2D,oe,ue,q.width,q.height)}for(let q=0,xe=Ue.length;q<xe;q++)te=Ue[q],Ve?D&&n.texSubImage2D(t.TEXTURE_2D,q,0,0,Se,Me,te):n.texImage2D(t.TEXTURE_2D,q,ue,Se,Me,te);S.generateMipmaps=!1}else if(Ve){if(Qe){let q=wt($);n.texStorage2D(t.TEXTURE_2D,oe,ue,q.width,q.height)}D&&n.texSubImage2D(t.TEXTURE_2D,0,0,0,Se,Me,$)}else n.texImage2D(t.TEXTURE_2D,0,ue,Se,Me,$);u(S)&&m(Y),de.__version=le.version,S.onUpdate&&S.onUpdate(S)}C.__version=S.version}function Be(C,S,V){if(S.image.length!==6)return;let Y=J(C,S),j=S.source;n.bindTexture(t.TEXTURE_CUBE_MAP,C.__webglTexture,t.TEXTURE0+V);let le=i.get(j);if(j.version!==le.__version||Y===!0){n.activeTexture(t.TEXTURE0+V);let de=je.getPrimaries(je.workingColorSpace),X=S.colorSpace===ir?null:je.getPrimaries(S.colorSpace),$=S.colorSpace===ir||de===X?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,S.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),n.pixelStorei(t.UNPACK_ALIGNMENT,S.unpackAlignment),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,$);let Se=S.isCompressedTexture||S.image[0].isCompressedTexture,Me=S.image[0]&&S.image[0].isDataTexture,ue=[];for(let Q=0;Q<6;Q++)!Se&&!Me?ue[Q]=_(S.image[Q],!0,r.maxCubemapSize):ue[Q]=Me?S.image[Q].image:S.image[Q],ue[Q]=_e(S,ue[Q]);let te=ue[0],Ue=s.convert(S.format,S.colorSpace),Ve=s.convert(S.type),Qe=w(S.internalFormat,Ue,Ve,S.normalized,S.colorSpace),D=S.isVideoTexture!==!0,oe=le.__version===void 0||Y===!0,q=j.dataReady,xe=E(S,te);Oe(t.TEXTURE_CUBE_MAP,S);let ce;if(Se){D&&oe&&n.texStorage2D(t.TEXTURE_CUBE_MAP,xe,Qe,te.width,te.height);for(let Q=0;Q<6;Q++){ce=ue[Q].mipmaps;for(let Te=0;Te<ce.length;Te++){let Ge=ce[Te];S.format!==Kn?Ue!==null?D?q&&n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Te,0,0,Ge.width,Ge.height,Ue,Ge.data):n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Te,Qe,Ge.width,Ge.height,0,Ge.data):Le("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):D?q&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Te,0,0,Ge.width,Ge.height,Ue,Ve,Ge.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Te,Qe,Ge.width,Ge.height,0,Ue,Ve,Ge.data)}}}else{if(ce=S.mipmaps,D&&oe){ce.length>0&&xe++;let Q=wt(ue[0]);n.texStorage2D(t.TEXTURE_CUBE_MAP,xe,Qe,Q.width,Q.height)}for(let Q=0;Q<6;Q++)if(Me){D?q&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,ue[Q].width,ue[Q].height,Ue,Ve,ue[Q].data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,Qe,ue[Q].width,ue[Q].height,0,Ue,Ve,ue[Q].data);for(let Te=0;Te<ce.length;Te++){let gt=ce[Te].image[Q].image;D?q&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Te+1,0,0,gt.width,gt.height,Ue,Ve,gt.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Te+1,Qe,gt.width,gt.height,0,Ue,Ve,gt.data)}}else{D?q&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,Ue,Ve,ue[Q]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,Qe,Ue,Ve,ue[Q]);for(let Te=0;Te<ce.length;Te++){let Ge=ce[Te];D?q&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Te+1,0,0,Ue,Ve,Ge.image[Q]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Te+1,Qe,Ue,Ve,Ge.image[Q])}}}u(S)&&m(t.TEXTURE_CUBE_MAP),le.__version=j.version,S.onUpdate&&S.onUpdate(S)}C.__version=S.version}function Re(C,S,V,Y,j,le){let de=s.convert(V.format,V.colorSpace),X=s.convert(V.type),$=w(V.internalFormat,de,X,V.normalized,V.colorSpace),Se=i.get(S),Me=i.get(V);if(Me.__renderTarget=S,!Se.__hasExternalTextures){let ue=Math.max(1,S.width>>le),te=Math.max(1,S.height>>le);j===t.TEXTURE_3D||j===t.TEXTURE_2D_ARRAY?n.texImage3D(j,le,$,ue,te,S.depth,0,de,X,null):n.texImage2D(j,le,$,ue,te,0,de,X,null)}n.bindFramebuffer(t.FRAMEBUFFER,C),ze(S)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,Y,j,Me.__webglTexture,0,lt(S)):(j===t.TEXTURE_2D||j>=t.TEXTURE_CUBE_MAP_POSITIVE_X&&j<=t.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&t.framebufferTexture2D(t.FRAMEBUFFER,Y,j,Me.__webglTexture,le),n.bindFramebuffer(t.FRAMEBUFFER,null)}function ke(C,S,V){if(t.bindRenderbuffer(t.RENDERBUFFER,C),S.depthBuffer){let Y=S.depthTexture,j=Y&&Y.isDepthTexture?Y.type:null,le=R(S.stencilBuffer,j),de=S.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;ze(S)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,lt(S),le,S.width,S.height):V?t.renderbufferStorageMultisample(t.RENDERBUFFER,lt(S),le,S.width,S.height):t.renderbufferStorage(t.RENDERBUFFER,le,S.width,S.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,de,t.RENDERBUFFER,C)}else{let Y=S.textures;for(let j=0;j<Y.length;j++){let le=Y[j],de=s.convert(le.format,le.colorSpace),X=s.convert(le.type),$=w(le.internalFormat,de,X,le.normalized,le.colorSpace);ze(S)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,lt(S),$,S.width,S.height):V?t.renderbufferStorageMultisample(t.RENDERBUFFER,lt(S),$,S.width,S.height):t.renderbufferStorage(t.RENDERBUFFER,$,S.width,S.height)}}t.bindRenderbuffer(t.RENDERBUFFER,null)}function Ye(C,S,V){let Y=S.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(t.FRAMEBUFFER,C),!(S.depthTexture&&S.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let j=i.get(S.depthTexture);if(j.__renderTarget=S,(!j.__webglTexture||S.depthTexture.image.width!==S.width||S.depthTexture.image.height!==S.height)&&(S.depthTexture.image.width=S.width,S.depthTexture.image.height=S.height,S.depthTexture.needsUpdate=!0),Y){if(j.__webglInit===void 0&&(j.__webglInit=!0,S.depthTexture.addEventListener("dispose",A)),j.__webglTexture===void 0){j.__webglTexture=t.createTexture(),n.bindTexture(t.TEXTURE_CUBE_MAP,j.__webglTexture),Oe(t.TEXTURE_CUBE_MAP,S.depthTexture);let Se=s.convert(S.depthTexture.format),Me=s.convert(S.depthTexture.type),ue;S.depthTexture.format===Ai?ue=t.DEPTH_COMPONENT24:S.depthTexture.format===Gr&&(ue=t.DEPTH24_STENCIL8);for(let te=0;te<6;te++)t.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,ue,S.width,S.height,0,Se,Me,null)}}else ee(S.depthTexture,0);let le=j.__webglTexture,de=lt(S),X=Y?t.TEXTURE_CUBE_MAP_POSITIVE_X+V:t.TEXTURE_2D,$=S.depthTexture.format===Gr?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;if(S.depthTexture.format===Ai)ze(S)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,$,X,le,0,de):t.framebufferTexture2D(t.FRAMEBUFFER,$,X,le,0);else if(S.depthTexture.format===Gr)ze(S)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,$,X,le,0,de):t.framebufferTexture2D(t.FRAMEBUFFER,$,X,le,0);else throw new Error("Unknown depthTexture format")}function et(C){let S=i.get(C),V=C.isWebGLCubeRenderTarget===!0;if(S.__boundDepthTexture!==C.depthTexture){let Y=C.depthTexture;if(S.__depthDisposeCallback&&S.__depthDisposeCallback(),Y){let j=()=>{delete S.__boundDepthTexture,delete S.__depthDisposeCallback,Y.removeEventListener("dispose",j)};Y.addEventListener("dispose",j),S.__depthDisposeCallback=j}S.__boundDepthTexture=Y}if(C.depthTexture&&!S.__autoAllocateDepthBuffer)if(V)for(let Y=0;Y<6;Y++)Ye(S.__webglFramebuffer[Y],C,Y);else{let Y=C.texture.mipmaps;Y&&Y.length>0?Ye(S.__webglFramebuffer[0],C,0):Ye(S.__webglFramebuffer,C,0)}else if(V){S.__webglDepthbuffer=[];for(let Y=0;Y<6;Y++)if(n.bindFramebuffer(t.FRAMEBUFFER,S.__webglFramebuffer[Y]),S.__webglDepthbuffer[Y]===void 0)S.__webglDepthbuffer[Y]=t.createRenderbuffer(),ke(S.__webglDepthbuffer[Y],C,!1);else{let j=C.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,le=S.__webglDepthbuffer[Y];t.bindRenderbuffer(t.RENDERBUFFER,le),t.framebufferRenderbuffer(t.FRAMEBUFFER,j,t.RENDERBUFFER,le)}}else{let Y=C.texture.mipmaps;if(Y&&Y.length>0?n.bindFramebuffer(t.FRAMEBUFFER,S.__webglFramebuffer[0]):n.bindFramebuffer(t.FRAMEBUFFER,S.__webglFramebuffer),S.__webglDepthbuffer===void 0)S.__webglDepthbuffer=t.createRenderbuffer(),ke(S.__webglDepthbuffer,C,!1);else{let j=C.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,le=S.__webglDepthbuffer;t.bindRenderbuffer(t.RENDERBUFFER,le),t.framebufferRenderbuffer(t.FRAMEBUFFER,j,t.RENDERBUFFER,le)}}n.bindFramebuffer(t.FRAMEBUFFER,null)}function rt(C,S,V){let Y=i.get(C);S!==void 0&&Re(Y.__webglFramebuffer,C,C.texture,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,0),V!==void 0&&et(C)}function We(C){let S=C.texture,V=i.get(C),Y=i.get(S);C.addEventListener("dispose",g);let j=C.textures,le=C.isWebGLCubeRenderTarget===!0,de=j.length>1;if(de||(Y.__webglTexture===void 0&&(Y.__webglTexture=t.createTexture()),Y.__version=S.version,o.memory.textures++),le){V.__webglFramebuffer=[];for(let X=0;X<6;X++)if(S.mipmaps&&S.mipmaps.length>0){V.__webglFramebuffer[X]=[];for(let $=0;$<S.mipmaps.length;$++)V.__webglFramebuffer[X][$]=t.createFramebuffer()}else V.__webglFramebuffer[X]=t.createFramebuffer()}else{if(S.mipmaps&&S.mipmaps.length>0){V.__webglFramebuffer=[];for(let X=0;X<S.mipmaps.length;X++)V.__webglFramebuffer[X]=t.createFramebuffer()}else V.__webglFramebuffer=t.createFramebuffer();if(de)for(let X=0,$=j.length;X<$;X++){let Se=i.get(j[X]);Se.__webglTexture===void 0&&(Se.__webglTexture=t.createTexture(),o.memory.textures++)}if(C.samples>0&&ze(C)===!1){V.__webglMultisampledFramebuffer=t.createFramebuffer(),V.__webglColorRenderbuffer=[],n.bindFramebuffer(t.FRAMEBUFFER,V.__webglMultisampledFramebuffer);for(let X=0;X<j.length;X++){let $=j[X];V.__webglColorRenderbuffer[X]=t.createRenderbuffer(),t.bindRenderbuffer(t.RENDERBUFFER,V.__webglColorRenderbuffer[X]);let Se=s.convert($.format,$.colorSpace),Me=s.convert($.type),ue=w($.internalFormat,Se,Me,$.normalized,$.colorSpace,C.isXRRenderTarget===!0),te=lt(C);t.renderbufferStorageMultisample(t.RENDERBUFFER,te,ue,C.width,C.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+X,t.RENDERBUFFER,V.__webglColorRenderbuffer[X])}t.bindRenderbuffer(t.RENDERBUFFER,null),C.depthBuffer&&(V.__webglDepthRenderbuffer=t.createRenderbuffer(),ke(V.__webglDepthRenderbuffer,C,!0)),n.bindFramebuffer(t.FRAMEBUFFER,null)}}if(le){n.bindTexture(t.TEXTURE_CUBE_MAP,Y.__webglTexture),Oe(t.TEXTURE_CUBE_MAP,S);for(let X=0;X<6;X++)if(S.mipmaps&&S.mipmaps.length>0)for(let $=0;$<S.mipmaps.length;$++)Re(V.__webglFramebuffer[X][$],C,S,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+X,$);else Re(V.__webglFramebuffer[X],C,S,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+X,0);u(S)&&m(t.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(de){for(let X=0,$=j.length;X<$;X++){let Se=j[X],Me=i.get(Se),ue=t.TEXTURE_2D;(C.isWebGL3DRenderTarget||C.isWebGLArrayRenderTarget)&&(ue=C.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(ue,Me.__webglTexture),Oe(ue,Se),Re(V.__webglFramebuffer,C,Se,t.COLOR_ATTACHMENT0+X,ue,0),u(Se)&&m(ue)}n.unbindTexture()}else{let X=t.TEXTURE_2D;if((C.isWebGL3DRenderTarget||C.isWebGLArrayRenderTarget)&&(X=C.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(X,Y.__webglTexture),Oe(X,S),S.mipmaps&&S.mipmaps.length>0)for(let $=0;$<S.mipmaps.length;$++)Re(V.__webglFramebuffer[$],C,S,t.COLOR_ATTACHMENT0,X,$);else Re(V.__webglFramebuffer,C,S,t.COLOR_ATTACHMENT0,X,0);u(S)&&m(X),n.unbindTexture()}C.depthBuffer&&et(C)}function bt(C){let S=C.textures;for(let V=0,Y=S.length;V<Y;V++){let j=S[V];if(u(j)){let le=y(C),de=i.get(j).__webglTexture;n.bindTexture(le,de),m(le),n.unbindTexture()}}}let pt=[],mt=[];function k(C){if(C.samples>0){if(ze(C)===!1){let S=C.textures,V=C.width,Y=C.height,j=t.COLOR_BUFFER_BIT,le=C.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,de=i.get(C),X=S.length>1;if(X)for(let Se=0;Se<S.length;Se++)n.bindFramebuffer(t.FRAMEBUFFER,de.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Se,t.RENDERBUFFER,null),n.bindFramebuffer(t.FRAMEBUFFER,de.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Se,t.TEXTURE_2D,null,0);n.bindFramebuffer(t.READ_FRAMEBUFFER,de.__webglMultisampledFramebuffer);let $=C.texture.mipmaps;$&&$.length>0?n.bindFramebuffer(t.DRAW_FRAMEBUFFER,de.__webglFramebuffer[0]):n.bindFramebuffer(t.DRAW_FRAMEBUFFER,de.__webglFramebuffer);for(let Se=0;Se<S.length;Se++){if(C.resolveDepthBuffer&&(C.depthBuffer&&(j|=t.DEPTH_BUFFER_BIT),C.stencilBuffer&&C.resolveStencilBuffer&&(j|=t.STENCIL_BUFFER_BIT)),X){t.framebufferRenderbuffer(t.READ_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.RENDERBUFFER,de.__webglColorRenderbuffer[Se]);let Me=i.get(S[Se]).__webglTexture;t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,Me,0)}t.blitFramebuffer(0,0,V,Y,0,0,V,Y,j,t.NEAREST),l===!0&&(pt.length=0,mt.length=0,pt.push(t.COLOR_ATTACHMENT0+Se),C.depthBuffer&&C.resolveDepthBuffer===!1&&(pt.push(le),mt.push(le),t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,mt)),t.invalidateFramebuffer(t.READ_FRAMEBUFFER,pt))}if(n.bindFramebuffer(t.READ_FRAMEBUFFER,null),n.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),X)for(let Se=0;Se<S.length;Se++){n.bindFramebuffer(t.FRAMEBUFFER,de.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Se,t.RENDERBUFFER,de.__webglColorRenderbuffer[Se]);let Me=i.get(S[Se]).__webglTexture;n.bindFramebuffer(t.FRAMEBUFFER,de.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Se,t.TEXTURE_2D,Me,0)}n.bindFramebuffer(t.DRAW_FRAMEBUFFER,de.__webglMultisampledFramebuffer)}else if(C.depthBuffer&&C.resolveDepthBuffer===!1&&l){let S=C.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,[S])}}}function lt(C){return Math.min(r.maxSamples,C.samples)}function ze(C){let S=i.get(C);return C.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&S.__useRenderToTexture!==!1}function ct(C){let S=o.render.frame;d.get(C)!==S&&(d.set(C,S),C.update())}function _e(C,S){let V=C.colorSpace,Y=C.format,j=C.type;return C.isCompressedTexture===!0||C.isVideoTexture===!0||V!==Da&&V!==ir&&(je.getTransfer(V)===at?(Y!==Kn||j!==Rn)&&Le("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):De("WebGLTextures: Unsupported texture color space:",V)),S}function wt(C){return typeof HTMLImageElement<"u"&&C instanceof HTMLImageElement?(c.width=C.naturalWidth||C.width,c.height=C.naturalHeight||C.height):typeof VideoFrame<"u"&&C instanceof VideoFrame?(c.width=C.displayWidth,c.height=C.displayHeight):(c.width=C.width,c.height=C.height),c}this.allocateTextureUnit=G,this.resetTextureUnits=F,this.getTextureUnits=W,this.setTextureUnits=z,this.setTexture2D=ee,this.setTexture2DArray=re,this.setTexture3D=se,this.setTextureCube=ve,this.rebindTextures=rt,this.setupRenderTarget=We,this.updateRenderTargetMipmap=bt,this.updateMultisampleRenderTarget=k,this.setupDepthRenderbuffer=et,this.setupFrameBufferTexture=Re,this.useMultisampledRTT=ze,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function fA(t,e){function n(i,r=ir){let s,o=je.getTransfer(r);if(i===Rn)return t.UNSIGNED_BYTE;if(i===ah)return t.UNSIGNED_SHORT_4_4_4_4;if(i===lh)return t.UNSIGNED_SHORT_5_5_5_1;if(i===ym)return t.UNSIGNED_INT_5_9_9_9_REV;if(i===Sm)return t.UNSIGNED_INT_10F_11F_11F_REV;if(i===vm)return t.BYTE;if(i===xm)return t.SHORT;if(i===To)return t.UNSIGNED_SHORT;if(i===oh)return t.INT;if(i===fi)return t.UNSIGNED_INT;if(i===pi)return t.FLOAT;if(i===Ni)return t.HALF_FLOAT;if(i===Mm)return t.ALPHA;if(i===wm)return t.RGB;if(i===Kn)return t.RGBA;if(i===Ai)return t.DEPTH_COMPONENT;if(i===Gr)return t.DEPTH_STENCIL;if(i===Em)return t.RED;if(i===ch)return t.RED_INTEGER;if(i===Hr)return t.RG;if(i===uh)return t.RG_INTEGER;if(i===hh)return t.RGBA_INTEGER;if(i===sl||i===ol||i===al||i===ll)if(o===at)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===sl)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===ol)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===al)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===ll)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===sl)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===ol)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===al)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===ll)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===dh||i===fh||i===ph||i===mh)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===dh)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===fh)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===ph)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===mh)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===gh||i===_h||i===vh||i===xh||i===yh||i===cl||i===Sh)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===gh||i===_h)return o===at?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===vh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===xh)return s.COMPRESSED_R11_EAC;if(i===yh)return s.COMPRESSED_SIGNED_R11_EAC;if(i===cl)return s.COMPRESSED_RG11_EAC;if(i===Sh)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===Mh||i===wh||i===Eh||i===Th||i===bh||i===Ah||i===Ch||i===Rh||i===Ph||i===Ih||i===Lh||i===Nh||i===Dh||i===Uh)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===Mh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===wh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Eh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Th)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===bh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===Ah)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===Ch)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Rh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===Ph)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===Ih)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===Lh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===Nh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===Dh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===Uh)return o===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Fh||i===Oh||i===Bh)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===Fh)return o===at?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===Oh)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===Bh)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===kh||i===zh||i===ul||i===Vh)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===kh)return s.COMPRESSED_RED_RGTC1_EXT;if(i===zh)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===ul)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===Vh)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===bo?t.UNSIGNED_INT_24_8:t[i]!==void 0?t[i]:null}return{convert:n}}var pA=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,mA=`
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

}`,Jm=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,n){if(this.texture===null){let i=new Ha(e.texture);(e.depthNear!==n.depthNear||e.depthFar!==n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let n=e.cameras[0].viewport,i=new zn({vertexShader:pA,fragmentShader:mA,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new Bt(new vs(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Km=class extends Ci{constructor(e,n){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,c=null,d=null,f=null,h=null,p=null,x=null,M=typeof XRWebGLBinding<"u",_=new Jm,u={},m=n.getContextAttributes(),y=null,w=null,R=[],E=[],A=new Ce,g=null,b=new An;b.viewport=new It;let I=new An;I.viewport=new It;let P=[b,I],N=new eh,F=null,W=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(J){let ge=R[J];return ge===void 0&&(ge=new xo,R[J]=ge),ge.getTargetRaySpace()},this.getControllerGrip=function(J){let ge=R[J];return ge===void 0&&(ge=new xo,R[J]=ge),ge.getGripSpace()},this.getHand=function(J){let ge=R[J];return ge===void 0&&(ge=new xo,R[J]=ge),ge.getHandSpace()};function z(J){let ge=E.indexOf(J.inputSource);if(ge===-1)return;let he=R[ge];he!==void 0&&(he.update(J.inputSource,J.frame,c||o),he.dispatchEvent({type:J.type,data:J.inputSource}))}function G(){r.removeEventListener("select",z),r.removeEventListener("selectstart",z),r.removeEventListener("selectend",z),r.removeEventListener("squeeze",z),r.removeEventListener("squeezestart",z),r.removeEventListener("squeezeend",z),r.removeEventListener("end",G),r.removeEventListener("inputsourceschange",H);for(let J=0;J<R.length;J++){let ge=E[J];ge!==null&&(E[J]=null,R[J].disconnect(ge))}F=null,W=null,_.reset();for(let J in u)delete u[J];e.setRenderTarget(y),p=null,h=null,f=null,r=null,w=null,Oe.stop(),i.isPresenting=!1,e.setPixelRatio(g),e.setSize(A.width,A.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(J){s=J,i.isPresenting===!0&&Le("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(J){a=J,i.isPresenting===!0&&Le("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(J){c=J},this.getBaseLayer=function(){return h!==null?h:p},this.getBinding=function(){return f===null&&M&&(f=new XRWebGLBinding(r,n)),f},this.getFrame=function(){return x},this.getSession=function(){return r},this.setSession=async function(J){if(r=J,r!==null){if(y=e.getRenderTarget(),r.addEventListener("select",z),r.addEventListener("selectstart",z),r.addEventListener("selectend",z),r.addEventListener("squeeze",z),r.addEventListener("squeezestart",z),r.addEventListener("squeezeend",z),r.addEventListener("end",G),r.addEventListener("inputsourceschange",H),m.xrCompatible!==!0&&await n.makeXRCompatible(),g=e.getPixelRatio(),e.getSize(A),M&&"createProjectionLayer"in XRWebGLBinding.prototype){let he=null,Ie=null,Be=null;m.depth&&(Be=m.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,he=m.stencil?Gr:Ai,Ie=m.stencil?bo:fi);let Re={colorFormat:n.RGBA8,depthFormat:Be,scaleFactor:s};f=this.getBinding(),h=f.createProjectionLayer(Re),r.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),w=new kn(h.textureWidth,h.textureHeight,{format:Kn,type:Rn,depthTexture:new nr(h.textureWidth,h.textureHeight,Ie,void 0,void 0,void 0,void 0,void 0,void 0,he),stencilBuffer:m.stencil,colorSpace:e.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1})}else{let he={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:s};p=new XRWebGLLayer(r,n,he),r.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),w=new kn(p.framebufferWidth,p.framebufferHeight,{format:Kn,type:Rn,colorSpace:e.outputColorSpace,stencilBuffer:m.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}w.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),Oe.setContext(r),Oe.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function H(J){for(let ge=0;ge<J.removed.length;ge++){let he=J.removed[ge],Ie=E.indexOf(he);Ie>=0&&(E[Ie]=null,R[Ie].disconnect(he))}for(let ge=0;ge<J.added.length;ge++){let he=J.added[ge],Ie=E.indexOf(he);if(Ie===-1){for(let Re=0;Re<R.length;Re++)if(Re>=E.length){E.push(he),Ie=Re;break}else if(E[Re]===null){E[Re]=he,Ie=Re;break}if(Ie===-1)break}let Be=R[Ie];Be&&Be.connect(he)}}let ee=new L,re=new L;function se(J,ge,he){ee.setFromMatrixPosition(ge.matrixWorld),re.setFromMatrixPosition(he.matrixWorld);let Ie=ee.distanceTo(re),Be=ge.projectionMatrix.elements,Re=he.projectionMatrix.elements,ke=Be[14]/(Be[10]-1),Ye=Be[14]/(Be[10]+1),et=(Be[9]+1)/Be[5],rt=(Be[9]-1)/Be[5],We=(Be[8]-1)/Be[0],bt=(Re[8]+1)/Re[0],pt=ke*We,mt=ke*bt,k=Ie/(-We+bt),lt=k*-We;if(ge.matrixWorld.decompose(J.position,J.quaternion,J.scale),J.translateX(lt),J.translateZ(k),J.matrixWorld.compose(J.position,J.quaternion,J.scale),J.matrixWorldInverse.copy(J.matrixWorld).invert(),Be[10]===-1)J.projectionMatrix.copy(ge.projectionMatrix),J.projectionMatrixInverse.copy(ge.projectionMatrixInverse);else{let ze=ke+k,ct=Ye+k,_e=pt-lt,wt=mt+(Ie-lt),C=et*Ye/ct*ze,S=rt*Ye/ct*ze;J.projectionMatrix.makePerspective(_e,wt,C,S,ze,ct),J.projectionMatrixInverse.copy(J.projectionMatrix).invert()}}function ve(J,ge){ge===null?J.matrixWorld.copy(J.matrix):J.matrixWorld.multiplyMatrices(ge.matrixWorld,J.matrix),J.matrixWorldInverse.copy(J.matrixWorld).invert()}this.updateCamera=function(J){if(r===null)return;let ge=J.near,he=J.far;_.texture!==null&&(_.depthNear>0&&(ge=_.depthNear),_.depthFar>0&&(he=_.depthFar)),N.near=I.near=b.near=ge,N.far=I.far=b.far=he,(F!==N.near||W!==N.far)&&(r.updateRenderState({depthNear:N.near,depthFar:N.far}),F=N.near,W=N.far),N.layers.mask=J.layers.mask|6,b.layers.mask=N.layers.mask&-5,I.layers.mask=N.layers.mask&-3;let Ie=J.parent,Be=N.cameras;ve(N,Ie);for(let Re=0;Re<Be.length;Re++)ve(Be[Re],Ie);Be.length===2?se(N,b,I):N.projectionMatrix.copy(b.projectionMatrix),pe(J,N,Ie)};function pe(J,ge,he){he===null?J.matrix.copy(ge.matrixWorld):(J.matrix.copy(he.matrixWorld),J.matrix.invert(),J.matrix.multiply(ge.matrixWorld)),J.matrix.decompose(J.position,J.quaternion,J.scale),J.updateMatrixWorld(!0),J.projectionMatrix.copy(ge.projectionMatrix),J.projectionMatrixInverse.copy(ge.projectionMatrixInverse),J.isPerspectiveCamera&&(J.fov=Au*2*Math.atan(1/J.projectionMatrix.elements[5]),J.zoom=1)}this.getCamera=function(){return N},this.getFoveation=function(){if(!(h===null&&p===null))return l},this.setFoveation=function(J){l=J,h!==null&&(h.fixedFoveation=J),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=J)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(N)},this.getCameraTexture=function(J){return u[J]};let Pe=null;function st(J,ge){if(d=ge.getViewerPose(c||o),x=ge,d!==null){let he=d.views;p!==null&&(e.setRenderTargetFramebuffer(w,p.framebuffer),e.setRenderTarget(w));let Ie=!1;he.length!==N.cameras.length&&(N.cameras.length=0,Ie=!0);for(let Ye=0;Ye<he.length;Ye++){let et=he[Ye],rt=null;if(p!==null)rt=p.getViewport(et);else{let bt=f.getViewSubImage(h,et);rt=bt.viewport,Ye===0&&(e.setRenderTargetTextures(w,bt.colorTexture,bt.depthStencilTexture),e.setRenderTarget(w))}let We=P[Ye];We===void 0&&(We=new An,We.layers.enable(Ye),We.viewport=new It,P[Ye]=We),We.matrix.fromArray(et.transform.matrix),We.matrix.decompose(We.position,We.quaternion,We.scale),We.projectionMatrix.fromArray(et.projectionMatrix),We.projectionMatrixInverse.copy(We.projectionMatrix).invert(),We.viewport.set(rt.x,rt.y,rt.width,rt.height),Ye===0&&(N.matrix.copy(We.matrix),N.matrix.decompose(N.position,N.quaternion,N.scale)),Ie===!0&&N.cameras.push(We)}let Be=r.enabledFeatures;if(Be&&Be.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&M){f=i.getBinding();let Ye=f.getDepthInformation(he[0]);Ye&&Ye.isValid&&Ye.texture&&_.init(Ye,r.renderState)}if(Be&&Be.includes("camera-access")&&M){e.state.unbindTexture(),f=i.getBinding();for(let Ye=0;Ye<he.length;Ye++){let et=he[Ye].camera;if(et){let rt=u[et];rt||(rt=new Ha,u[et]=rt);let We=f.getCameraImage(et);rt.sourceTexture=We}}}}for(let he=0;he<R.length;he++){let Ie=E[he],Be=R[he];Ie!==null&&Be!==void 0&&Be.update(Ie,ge,c||o)}Pe&&Pe(J,ge),ge.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:ge}),x=null}let Oe=new fy;Oe.setAnimationLoop(st),this.setAnimationLoop=function(J){Pe=J},this.dispose=function(){}}},gA=new Pt,xy=new He;xy.set(-1,0,0,0,1,0,0,0,1);function _A(t,e){function n(_,u){_.matrixAutoUpdate===!0&&_.updateMatrix(),u.value.copy(_.matrix)}function i(_,u){u.color.getRGB(_.fogColor.value,Cm(t)),u.isFog?(_.fogNear.value=u.near,_.fogFar.value=u.far):u.isFogExp2&&(_.fogDensity.value=u.density)}function r(_,u,m,y,w){u.isNodeMaterial?u.uniformsNeedUpdate=!1:u.isMeshBasicMaterial?s(_,u):u.isMeshLambertMaterial?(s(_,u),u.envMap&&(_.envMapIntensity.value=u.envMapIntensity)):u.isMeshToonMaterial?(s(_,u),f(_,u)):u.isMeshPhongMaterial?(s(_,u),d(_,u),u.envMap&&(_.envMapIntensity.value=u.envMapIntensity)):u.isMeshStandardMaterial?(s(_,u),h(_,u),u.isMeshPhysicalMaterial&&p(_,u,w)):u.isMeshMatcapMaterial?(s(_,u),x(_,u)):u.isMeshDepthMaterial?s(_,u):u.isMeshDistanceMaterial?(s(_,u),M(_,u)):u.isMeshNormalMaterial?s(_,u):u.isLineBasicMaterial?(o(_,u),u.isLineDashedMaterial&&a(_,u)):u.isPointsMaterial?l(_,u,m,y):u.isSpriteMaterial?c(_,u):u.isShadowMaterial?(_.color.value.copy(u.color),_.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function s(_,u){_.opacity.value=u.opacity,u.color&&_.diffuse.value.copy(u.color),u.emissive&&_.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(_.map.value=u.map,n(u.map,_.mapTransform)),u.alphaMap&&(_.alphaMap.value=u.alphaMap,n(u.alphaMap,_.alphaMapTransform)),u.bumpMap&&(_.bumpMap.value=u.bumpMap,n(u.bumpMap,_.bumpMapTransform),_.bumpScale.value=u.bumpScale,u.side===vn&&(_.bumpScale.value*=-1)),u.normalMap&&(_.normalMap.value=u.normalMap,n(u.normalMap,_.normalMapTransform),_.normalScale.value.copy(u.normalScale),u.side===vn&&_.normalScale.value.negate()),u.displacementMap&&(_.displacementMap.value=u.displacementMap,n(u.displacementMap,_.displacementMapTransform),_.displacementScale.value=u.displacementScale,_.displacementBias.value=u.displacementBias),u.emissiveMap&&(_.emissiveMap.value=u.emissiveMap,n(u.emissiveMap,_.emissiveMapTransform)),u.specularMap&&(_.specularMap.value=u.specularMap,n(u.specularMap,_.specularMapTransform)),u.alphaTest>0&&(_.alphaTest.value=u.alphaTest);let m=e.get(u),y=m.envMap,w=m.envMapRotation;y&&(_.envMap.value=y,_.envMapRotation.value.setFromMatrix4(gA.makeRotationFromEuler(w)).transpose(),y.isCubeTexture&&y.isRenderTargetTexture===!1&&_.envMapRotation.value.premultiply(xy),_.reflectivity.value=u.reflectivity,_.ior.value=u.ior,_.refractionRatio.value=u.refractionRatio),u.lightMap&&(_.lightMap.value=u.lightMap,_.lightMapIntensity.value=u.lightMapIntensity,n(u.lightMap,_.lightMapTransform)),u.aoMap&&(_.aoMap.value=u.aoMap,_.aoMapIntensity.value=u.aoMapIntensity,n(u.aoMap,_.aoMapTransform))}function o(_,u){_.diffuse.value.copy(u.color),_.opacity.value=u.opacity,u.map&&(_.map.value=u.map,n(u.map,_.mapTransform))}function a(_,u){_.dashSize.value=u.dashSize,_.totalSize.value=u.dashSize+u.gapSize,_.scale.value=u.scale}function l(_,u,m,y){_.diffuse.value.copy(u.color),_.opacity.value=u.opacity,_.size.value=u.size*m,_.scale.value=y*.5,u.map&&(_.map.value=u.map,n(u.map,_.uvTransform)),u.alphaMap&&(_.alphaMap.value=u.alphaMap,n(u.alphaMap,_.alphaMapTransform)),u.alphaTest>0&&(_.alphaTest.value=u.alphaTest)}function c(_,u){_.diffuse.value.copy(u.color),_.opacity.value=u.opacity,_.rotation.value=u.rotation,u.map&&(_.map.value=u.map,n(u.map,_.mapTransform)),u.alphaMap&&(_.alphaMap.value=u.alphaMap,n(u.alphaMap,_.alphaMapTransform)),u.alphaTest>0&&(_.alphaTest.value=u.alphaTest)}function d(_,u){_.specular.value.copy(u.specular),_.shininess.value=Math.max(u.shininess,1e-4)}function f(_,u){u.gradientMap&&(_.gradientMap.value=u.gradientMap)}function h(_,u){_.metalness.value=u.metalness,u.metalnessMap&&(_.metalnessMap.value=u.metalnessMap,n(u.metalnessMap,_.metalnessMapTransform)),_.roughness.value=u.roughness,u.roughnessMap&&(_.roughnessMap.value=u.roughnessMap,n(u.roughnessMap,_.roughnessMapTransform)),u.envMap&&(_.envMapIntensity.value=u.envMapIntensity)}function p(_,u,m){_.ior.value=u.ior,u.sheen>0&&(_.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),_.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(_.sheenColorMap.value=u.sheenColorMap,n(u.sheenColorMap,_.sheenColorMapTransform)),u.sheenRoughnessMap&&(_.sheenRoughnessMap.value=u.sheenRoughnessMap,n(u.sheenRoughnessMap,_.sheenRoughnessMapTransform))),u.clearcoat>0&&(_.clearcoat.value=u.clearcoat,_.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(_.clearcoatMap.value=u.clearcoatMap,n(u.clearcoatMap,_.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(_.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,n(u.clearcoatRoughnessMap,_.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(_.clearcoatNormalMap.value=u.clearcoatNormalMap,n(u.clearcoatNormalMap,_.clearcoatNormalMapTransform),_.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===vn&&_.clearcoatNormalScale.value.negate())),u.dispersion>0&&(_.dispersion.value=u.dispersion),u.iridescence>0&&(_.iridescence.value=u.iridescence,_.iridescenceIOR.value=u.iridescenceIOR,_.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],_.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(_.iridescenceMap.value=u.iridescenceMap,n(u.iridescenceMap,_.iridescenceMapTransform)),u.iridescenceThicknessMap&&(_.iridescenceThicknessMap.value=u.iridescenceThicknessMap,n(u.iridescenceThicknessMap,_.iridescenceThicknessMapTransform))),u.transmission>0&&(_.transmission.value=u.transmission,_.transmissionSamplerMap.value=m.texture,_.transmissionSamplerSize.value.set(m.width,m.height),u.transmissionMap&&(_.transmissionMap.value=u.transmissionMap,n(u.transmissionMap,_.transmissionMapTransform)),_.thickness.value=u.thickness,u.thicknessMap&&(_.thicknessMap.value=u.thicknessMap,n(u.thicknessMap,_.thicknessMapTransform)),_.attenuationDistance.value=u.attenuationDistance,_.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(_.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(_.anisotropyMap.value=u.anisotropyMap,n(u.anisotropyMap,_.anisotropyMapTransform))),_.specularIntensity.value=u.specularIntensity,_.specularColor.value.copy(u.specularColor),u.specularColorMap&&(_.specularColorMap.value=u.specularColorMap,n(u.specularColorMap,_.specularColorMapTransform)),u.specularIntensityMap&&(_.specularIntensityMap.value=u.specularIntensityMap,n(u.specularIntensityMap,_.specularIntensityMapTransform))}function x(_,u){u.matcap&&(_.matcap.value=u.matcap)}function M(_,u){let m=e.get(u).light;_.referencePosition.value.setFromMatrixPosition(m.matrixWorld),_.nearDistance.value=m.shadow.camera.near,_.farDistance.value=m.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function vA(t,e,n,i){let r={},s={},o=[],a=t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);function l(m,y){let w=y.program;i.uniformBlockBinding(m,w)}function c(m,y){let w=r[m.id];w===void 0&&(x(m),w=d(m),r[m.id]=w,m.addEventListener("dispose",_));let R=y.program;i.updateUBOMapping(m,R);let E=e.render.frame;s[m.id]!==E&&(h(m),s[m.id]=E)}function d(m){let y=f();m.__bindingPointIndex=y;let w=t.createBuffer(),R=m.__size,E=m.usage;return t.bindBuffer(t.UNIFORM_BUFFER,w),t.bufferData(t.UNIFORM_BUFFER,R,E),t.bindBuffer(t.UNIFORM_BUFFER,null),t.bindBufferBase(t.UNIFORM_BUFFER,y,w),w}function f(){for(let m=0;m<a;m++)if(o.indexOf(m)===-1)return o.push(m),m;return De("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(m){let y=r[m.id],w=m.uniforms,R=m.__cache;t.bindBuffer(t.UNIFORM_BUFFER,y);for(let E=0,A=w.length;E<A;E++){let g=Array.isArray(w[E])?w[E]:[w[E]];for(let b=0,I=g.length;b<I;b++){let P=g[b];if(p(P,E,b,R)===!0){let N=P.__offset,F=Array.isArray(P.value)?P.value:[P.value],W=0;for(let z=0;z<F.length;z++){let G=F[z],H=M(G);typeof G=="number"||typeof G=="boolean"?(P.__data[0]=G,t.bufferSubData(t.UNIFORM_BUFFER,N+W,P.__data)):G.isMatrix3?(P.__data[0]=G.elements[0],P.__data[1]=G.elements[1],P.__data[2]=G.elements[2],P.__data[3]=0,P.__data[4]=G.elements[3],P.__data[5]=G.elements[4],P.__data[6]=G.elements[5],P.__data[7]=0,P.__data[8]=G.elements[6],P.__data[9]=G.elements[7],P.__data[10]=G.elements[8],P.__data[11]=0):ArrayBuffer.isView(G)?P.__data.set(new G.constructor(G.buffer,G.byteOffset,P.__data.length)):(G.toArray(P.__data,W),W+=H.storage/Float32Array.BYTES_PER_ELEMENT)}t.bufferSubData(t.UNIFORM_BUFFER,N,P.__data)}}}t.bindBuffer(t.UNIFORM_BUFFER,null)}function p(m,y,w,R){let E=m.value,A=y+"_"+w;if(R[A]===void 0)return typeof E=="number"||typeof E=="boolean"?R[A]=E:ArrayBuffer.isView(E)?R[A]=E.slice():R[A]=E.clone(),!0;{let g=R[A];if(typeof E=="number"||typeof E=="boolean"){if(g!==E)return R[A]=E,!0}else{if(ArrayBuffer.isView(E))return!0;if(g.equals(E)===!1)return g.copy(E),!0}}return!1}function x(m){let y=m.uniforms,w=0,R=16;for(let A=0,g=y.length;A<g;A++){let b=Array.isArray(y[A])?y[A]:[y[A]];for(let I=0,P=b.length;I<P;I++){let N=b[I],F=Array.isArray(N.value)?N.value:[N.value];for(let W=0,z=F.length;W<z;W++){let G=F[W],H=M(G),ee=w%R,re=ee%H.boundary,se=ee+re;w+=re,se!==0&&R-se<H.storage&&(w+=R-se),N.__data=new Float32Array(H.storage/Float32Array.BYTES_PER_ELEMENT),N.__offset=w,w+=H.storage}}}let E=w%R;return E>0&&(w+=R-E),m.__size=w,m.__cache={},this}function M(m){let y={boundary:0,storage:0};return typeof m=="number"||typeof m=="boolean"?(y.boundary=4,y.storage=4):m.isVector2?(y.boundary=8,y.storage=8):m.isVector3||m.isColor?(y.boundary=16,y.storage=12):m.isVector4?(y.boundary=16,y.storage=16):m.isMatrix3?(y.boundary=48,y.storage=48):m.isMatrix4?(y.boundary=64,y.storage=64):m.isTexture?Le("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(m)?(y.boundary=16,y.storage=m.byteLength):Le("WebGLRenderer: Unsupported uniform value type.",m),y}function _(m){let y=m.target;y.removeEventListener("dispose",_);let w=o.indexOf(y.__bindingPointIndex);o.splice(w,1),t.deleteBuffer(r[y.id]),delete r[y.id],delete s[y.id]}function u(){for(let m in r)t.deleteBuffer(r[m]);o=[],r={},s={}}return{bind:l,update:c,dispose:u}}var xA=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Di=null;function yA(){return Di===null&&(Di=new Iu(xA,16,16,Hr,Ni),Di.name="DFG_LUT",Di.minFilter=jt,Di.magFilter=jt,Di.wrapS=bi,Di.wrapT=bi,Di.generateMipmaps=!1,Di.needsUpdate=!0),Di}var $h=class{constructor(e={}){let{canvas:n=Bx(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:d="default",failIfMajorPerformanceCaveat:f=!1,reversedDepthBuffer:h=!1,outputBufferType:p=Rn}=e;this.isWebGLRenderer=!0;let x;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");x=i.getContextAttributes().alpha}else x=o;let M=p,_=new Set([hh,uh,ch]),u=new Set([Rn,fi,To,bo,ah,lh]),m=new Uint32Array(4),y=new Int32Array(4),w=new L,R=null,E=null,A=[],g=[],b=null;this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=di,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let I=this,P=!1,N=null;this._outputColorSpace=Yt;let F=0,W=0,z=null,G=-1,H=null,ee=new It,re=new It,se=null,ve=new Ke(0),pe=0,Pe=n.width,st=n.height,Oe=1,J=null,ge=null,he=new It(0,0,Pe,st),Ie=new It(0,0,Pe,st),Be=!1,Re=new Mo,ke=!1,Ye=!1,et=new Pt,rt=new L,We=new It,bt={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},pt=!1;function mt(){return z===null?Oe:1}let k=i;function lt(v,T){return n.getContext(v,T)}try{let v={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:d,failIfMajorPerformanceCaveat:f};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${nh}`),n.addEventListener("webglcontextlost",Q,!1),n.addEventListener("webglcontextrestored",Te,!1),n.addEventListener("webglcontextcreationerror",Ge,!1),k===null){let T="webgl2";if(k=lt(T,v),k===null)throw lt(T)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(v){throw De("WebGLRenderer: "+v.message),v}let ze,ct,_e,wt,C,S,V,Y,j,le,de,X,$,Se,Me,ue,te,Ue,Ve,Qe,D,oe,q;function xe(){ze=new AT(k),ze.init(),D=new fA(k,ze),ct=new xT(k,ze,e,D),_e=new hA(k,ze),ct.reversedDepthBuffer&&h&&_e.buffers.depth.setReversed(!0),wt=new PT(k),C=new Kb,S=new dA(k,ze,_e,C,ct,D,wt),V=new bT(I),Y=new D1(k),oe=new _T(k,Y),j=new CT(k,Y,wt,oe),le=new LT(k,j,Y,oe,wt),Ue=new IT(k,ct,S),Me=new yT(C),de=new Jb(I,V,ze,ct,oe,Me),X=new _A(I,C),$=new Qb,Se=new sA(ze),te=new gT(I,V,_e,le,x,l),ue=new uA(I,le,ct),q=new vA(k,wt,ct,_e),Ve=new vT(k,ze,wt),Qe=new RT(k,ze,wt),wt.programs=de.programs,I.capabilities=ct,I.extensions=ze,I.properties=C,I.renderLists=$,I.shadowMap=ue,I.state=_e,I.info=wt}xe(),M!==Rn&&(b=new DT(M,n.width,n.height,r,s));let ce=new Km(I,k);this.xr=ce,this.getContext=function(){return k},this.getContextAttributes=function(){return k.getContextAttributes()},this.forceContextLoss=function(){let v=ze.get("WEBGL_lose_context");v&&v.loseContext()},this.forceContextRestore=function(){let v=ze.get("WEBGL_lose_context");v&&v.restoreContext()},this.getPixelRatio=function(){return Oe},this.setPixelRatio=function(v){v!==void 0&&(Oe=v,this.setSize(Pe,st,!1))},this.getSize=function(v){return v.set(Pe,st)},this.setSize=function(v,T,O=!0){if(ce.isPresenting){Le("WebGLRenderer: Can't change size while VR device is presenting.");return}Pe=v,st=T,n.width=Math.floor(v*Oe),n.height=Math.floor(T*Oe),O===!0&&(n.style.width=v+"px",n.style.height=T+"px"),b!==null&&b.setSize(n.width,n.height),this.setViewport(0,0,v,T)},this.getDrawingBufferSize=function(v){return v.set(Pe*Oe,st*Oe).floor()},this.setDrawingBufferSize=function(v,T,O){Pe=v,st=T,Oe=O,n.width=Math.floor(v*O),n.height=Math.floor(T*O),this.setViewport(0,0,v,T)},this.setEffects=function(v){if(M===Rn){De("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(v){for(let T=0;T<v.length;T++)if(v[T].isOutputPass===!0){Le("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}b.setEffects(v||[])},this.getCurrentViewport=function(v){return v.copy(ee)},this.getViewport=function(v){return v.copy(he)},this.setViewport=function(v,T,O,U){v.isVector4?he.set(v.x,v.y,v.z,v.w):he.set(v,T,O,U),_e.viewport(ee.copy(he).multiplyScalar(Oe).round())},this.getScissor=function(v){return v.copy(Ie)},this.setScissor=function(v,T,O,U){v.isVector4?Ie.set(v.x,v.y,v.z,v.w):Ie.set(v,T,O,U),_e.scissor(re.copy(Ie).multiplyScalar(Oe).round())},this.getScissorTest=function(){return Be},this.setScissorTest=function(v){_e.setScissorTest(Be=v)},this.setOpaqueSort=function(v){J=v},this.setTransparentSort=function(v){ge=v},this.getClearColor=function(v){return v.copy(te.getClearColor())},this.setClearColor=function(){te.setClearColor(...arguments)},this.getClearAlpha=function(){return te.getClearAlpha()},this.setClearAlpha=function(){te.setClearAlpha(...arguments)},this.clear=function(v=!0,T=!0,O=!0){let U=0;if(v){let B=!1;if(z!==null){let K=z.texture.format;B=_.has(K)}if(B){let K=z.texture.type,ae=u.has(K),ne=te.getClearColor(),fe=te.getClearAlpha(),be=ne.r,Ne=ne.g,Fe=ne.b;ae?(m[0]=be,m[1]=Ne,m[2]=Fe,m[3]=fe,k.clearBufferuiv(k.COLOR,0,m)):(y[0]=be,y[1]=Ne,y[2]=Fe,y[3]=fe,k.clearBufferiv(k.COLOR,0,y))}else U|=k.COLOR_BUFFER_BIT}T&&(U|=k.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),O&&(U|=k.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),U!==0&&k.clear(U)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(v){v.setRenderer(this),N=v},this.dispose=function(){n.removeEventListener("webglcontextlost",Q,!1),n.removeEventListener("webglcontextrestored",Te,!1),n.removeEventListener("webglcontextcreationerror",Ge,!1),te.dispose(),$.dispose(),Se.dispose(),C.dispose(),V.dispose(),le.dispose(),oe.dispose(),q.dispose(),de.dispose(),ce.dispose(),ce.removeEventListener("sessionstart",Xr),ce.removeEventListener("sessionend",Ms),gi.stop()};function Q(v){v.preventDefault(),bm("WebGLRenderer: Context Lost."),P=!0}function Te(){bm("WebGLRenderer: Context Restored."),P=!1;let v=wt.autoReset,T=ue.enabled,O=ue.autoUpdate,U=ue.needsUpdate,B=ue.type;xe(),wt.autoReset=v,ue.enabled=T,ue.autoUpdate=O,ue.needsUpdate=U,ue.type=B}function Ge(v){De("WebGLRenderer: A WebGL context could not be created. Reason: ",v.statusMessage)}function gt(v){let T=v.target;T.removeEventListener("dispose",gt),nt(T)}function nt(v){xn(v),C.remove(v)}function xn(v){let T=C.get(v).programs;T!==void 0&&(T.forEach(function(O){de.releaseProgram(O)}),v.isShaderMaterial&&de.releaseShaderCache(v))}this.renderBufferDirect=function(v,T,O,U,B,K){T===null&&(T=bt);let ae=B.isMesh&&B.matrixWorld.determinant()<0,ne=Sl(v,T,O,U,B);_e.setMaterial(U,ae);let fe=O.index,be=1;if(U.wireframe===!0){if(fe=j.getWireframeAttribute(O),fe===void 0)return;be=2}let Ne=O.drawRange,Fe=O.attributes.position,we=Ne.start*be,qe=(Ne.start+Ne.count)*be;K!==null&&(we=Math.max(we,K.start*be),qe=Math.min(qe,(K.start+K.count)*be)),fe!==null?(we=Math.max(we,0),qe=Math.min(qe,fe.count)):Fe!=null&&(we=Math.max(we,0),qe=Math.min(qe,Fe.count));let dt=qe-we;if(dt<0||dt===1/0)return;oe.setup(B,U,ne,O,fe);let ot,ut=Ve;if(fe!==null&&(ot=Y.get(fe),ut=Qe,ut.setIndex(ot)),B.isMesh)U.wireframe===!0?(_e.setLineWidth(U.wireframeLinewidth*mt()),ut.setMode(k.LINES)):ut.setMode(k.TRIANGLES);else if(B.isLine){let Ae=U.linewidth;Ae===void 0&&(Ae=1),_e.setLineWidth(Ae*mt()),B.isLineSegments?ut.setMode(k.LINES):B.isLineLoop?ut.setMode(k.LINE_LOOP):ut.setMode(k.LINE_STRIP)}else B.isPoints?ut.setMode(k.POINTS):B.isSprite&&ut.setMode(k.TRIANGLES);if(B.isBatchedMesh)if(ze.get("WEBGL_multi_draw"))ut.renderMultiDraw(B._multiDrawStarts,B._multiDrawCounts,B._multiDrawCount);else{let Ae=B._multiDrawStarts,me=B._multiDrawCounts,Ut=B._multiDrawCount,$e=fe?Y.get(fe).bytesPerElement:1,tn=C.get(U).currentProgram.getUniforms();for(let yn=0;yn<Ut;yn++)tn.setValue(k,"_gl_DrawID",yn),ut.render(Ae[yn]/$e,me[yn])}else if(B.isInstancedMesh)ut.renderInstances(we,dt,B.count);else if(O.isInstancedBufferGeometry){let Ae=O._maxInstanceCount!==void 0?O._maxInstanceCount:1/0,me=Math.min(O.instanceCount,Ae);ut.renderInstances(we,dt,me)}else ut.render(we,dt)};function dn(v,T,O){v.transparent===!0&&v.side===Ii&&v.forceSinglePass===!1?(v.side=vn,v.needsUpdate=!0,qr(v,T,O),v.side=er,v.needsUpdate=!0,qr(v,T,O),v.side=Ii):qr(v,T,O)}this.compile=function(v,T,O=null){O===null&&(O=v),E=Se.get(O),E.init(T),g.push(E),O.traverseVisible(function(B){B.isLight&&B.layers.test(T.layers)&&(E.pushLight(B),B.castShadow&&E.pushShadow(B))}),v!==O&&v.traverseVisible(function(B){B.isLight&&B.layers.test(T.layers)&&(E.pushLight(B),B.castShadow&&E.pushShadow(B))}),E.setupLights();let U=new Set;return v.traverse(function(B){if(!(B.isMesh||B.isPoints||B.isLine||B.isSprite))return;let K=B.material;if(K)if(Array.isArray(K))for(let ae=0;ae<K.length;ae++){let ne=K[ae];dn(ne,O,B),U.add(ne)}else dn(K,O,B),U.add(K)}),E=g.pop(),U},this.compileAsync=function(v,T,O=null){let U=this.compile(v,T,O);return new Promise(B=>{function K(){if(U.forEach(function(ae){C.get(ae).currentProgram.isReady()&&U.delete(ae)}),U.size===0){B(v);return}setTimeout(K,10)}ze.get("KHR_parallel_shader_compile")!==null?K():setTimeout(K,10)})};let Fi=null;function Io(v){Fi&&Fi(v)}function Xr(){gi.stop()}function Ms(){gi.start()}let gi=new fy;gi.setAnimationLoop(Io),typeof self<"u"&&gi.setContext(self),this.setAnimationLoop=function(v){Fi=v,ce.setAnimationLoop(v),v===null?gi.stop():gi.start()},ce.addEventListener("sessionstart",Xr),ce.addEventListener("sessionend",Ms),this.render=function(v,T){if(T!==void 0&&T.isCamera!==!0){De("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(P===!0)return;N!==null&&N.renderStart(v,T);let O=ce.enabled===!0&&ce.isPresenting===!0,U=b!==null&&(z===null||O)&&b.begin(I,z);if(v.matrixWorldAutoUpdate===!0&&v.updateMatrixWorld(),T.parent===null&&T.matrixWorldAutoUpdate===!0&&T.updateMatrixWorld(),ce.enabled===!0&&ce.isPresenting===!0&&(b===null||b.isCompositing()===!1)&&(ce.cameraAutoUpdate===!0&&ce.updateCamera(T),T=ce.getCamera()),v.isScene===!0&&v.onBeforeRender(I,v,T,z),E=Se.get(v,g.length),E.init(T),E.state.textureUnits=S.getTextureUnits(),g.push(E),et.multiplyMatrices(T.projectionMatrix,T.matrixWorldInverse),Re.setFromProjectionMatrix(et,ui,T.reversedDepth),Ye=this.localClippingEnabled,ke=Me.init(this.clippingPlanes,Ye),R=$.get(v,A.length),R.init(),A.push(R),ce.enabled===!0&&ce.isPresenting===!0){let ae=I.xr.getDepthSensingMesh();ae!==null&&Lo(ae,T,-1/0,I.sortObjects)}Lo(v,T,0,I.sortObjects),R.finish(),I.sortObjects===!0&&R.sort(J,ge),pt=ce.enabled===!1||ce.isPresenting===!1||ce.hasDepthSensing()===!1,pt&&te.addToRenderList(R,v),this.info.render.frame++,ke===!0&&Me.beginShadows();let B=E.state.shadowsArray;if(ue.render(B,v,T),ke===!0&&Me.endShadows(),this.info.autoReset===!0&&this.info.reset(),(U&&b.hasRenderPass())===!1){let ae=R.opaque,ne=R.transmissive;if(E.setupLights(),T.isArrayCamera){let fe=T.cameras;if(ne.length>0)for(let be=0,Ne=fe.length;be<Ne;be++){let Fe=fe[be];vl(ae,ne,v,Fe)}pt&&te.render(v);for(let be=0,Ne=fe.length;be<Ne;be++){let Fe=fe[be];_l(R,v,Fe,Fe.viewport)}}else ne.length>0&&vl(ae,ne,v,T),pt&&te.render(v),_l(R,v,T)}z!==null&&W===0&&(S.updateMultisampleRenderTarget(z),S.updateRenderTargetMipmap(z)),U&&b.end(I),v.isScene===!0&&v.onAfterRender(I,v,T),oe.resetDefaultState(),G=-1,H=null,g.pop(),g.length>0?(E=g[g.length-1],S.setTextureUnits(E.state.textureUnits),ke===!0&&Me.setGlobalState(I.clippingPlanes,E.state.camera)):E=null,A.pop(),A.length>0?R=A[A.length-1]:R=null,N!==null&&N.renderEnd()};function Lo(v,T,O,U){if(v.visible===!1)return;if(v.layers.test(T.layers)){if(v.isGroup)O=v.renderOrder;else if(v.isLOD)v.autoUpdate===!0&&v.update(T);else if(v.isLightProbeGrid)E.pushLightProbeGrid(v);else if(v.isLight)E.pushLight(v),v.castShadow&&E.pushShadow(v);else if(v.isSprite){if(!v.frustumCulled||Re.intersectsSprite(v)){U&&We.setFromMatrixPosition(v.matrixWorld).applyMatrix4(et);let ae=le.update(v),ne=v.material;ne.visible&&R.push(v,ae,ne,O,We.z,null)}}else if((v.isMesh||v.isLine||v.isPoints)&&(!v.frustumCulled||Re.intersectsObject(v))){let ae=le.update(v),ne=v.material;if(U&&(v.boundingSphere!==void 0?(v.boundingSphere===null&&v.computeBoundingSphere(),We.copy(v.boundingSphere.center)):(ae.boundingSphere===null&&ae.computeBoundingSphere(),We.copy(ae.boundingSphere.center)),We.applyMatrix4(v.matrixWorld).applyMatrix4(et)),Array.isArray(ne)){let fe=ae.groups;for(let be=0,Ne=fe.length;be<Ne;be++){let Fe=fe[be],we=ne[Fe.materialIndex];we&&we.visible&&R.push(v,ae,we,O,We.z,Fe)}}else ne.visible&&R.push(v,ae,ne,O,We.z,null)}}let K=v.children;for(let ae=0,ne=K.length;ae<ne;ae++)Lo(K[ae],T,O,U)}function _l(v,T,O,U){let{opaque:B,transmissive:K,transparent:ae}=v;E.setupLightsView(O),ke===!0&&Me.setGlobalState(I.clippingPlanes,O),U&&_e.viewport(ee.copy(U)),B.length>0&&Yr(B,T,O),K.length>0&&Yr(K,T,O),ae.length>0&&Yr(ae,T,O),_e.buffers.depth.setTest(!0),_e.buffers.depth.setMask(!0),_e.buffers.color.setMask(!0),_e.setPolygonOffset(!1)}function vl(v,T,O,U){if((O.isScene===!0?O.overrideMaterial:null)!==null)return;if(E.state.transmissionRenderTarget[U.id]===void 0){let we=ze.has("EXT_color_buffer_half_float")||ze.has("EXT_color_buffer_float");E.state.transmissionRenderTarget[U.id]=new kn(1,1,{generateMipmaps:!0,type:we?Ni:Rn,minFilter:Vr,samples:Math.max(4,ct.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:je.workingColorSpace})}let K=E.state.transmissionRenderTarget[U.id],ae=U.viewport||ee;K.setSize(ae.z*I.transmissionResolutionScale,ae.w*I.transmissionResolutionScale);let ne=I.getRenderTarget(),fe=I.getActiveCubeFace(),be=I.getActiveMipmapLevel();I.setRenderTarget(K),I.getClearColor(ve),pe=I.getClearAlpha(),pe<1&&I.setClearColor(16777215,.5),I.clear(),pt&&te.render(O);let Ne=I.toneMapping;I.toneMapping=di;let Fe=U.viewport;if(U.viewport!==void 0&&(U.viewport=void 0),E.setupLightsView(U),ke===!0&&Me.setGlobalState(I.clippingPlanes,U),Yr(v,O,U),S.updateMultisampleRenderTarget(K),S.updateRenderTargetMipmap(K),ze.has("WEBGL_multisampled_render_to_texture")===!1){let we=!1;for(let qe=0,dt=T.length;qe<dt;qe++){let ot=T[qe],{object:ut,geometry:Ae,material:me,group:Ut}=ot;if(me.side===Ii&&ut.layers.test(U.layers)){let $e=me.side;me.side=vn,me.needsUpdate=!0,xl(ut,O,U,Ae,me,Ut),me.side=$e,me.needsUpdate=!0,we=!0}}we===!0&&(S.updateMultisampleRenderTarget(K),S.updateRenderTargetMipmap(K))}I.setRenderTarget(ne,fe,be),I.setClearColor(ve,pe),Fe!==void 0&&(U.viewport=Fe),I.toneMapping=Ne}function Yr(v,T,O){let U=T.isScene===!0?T.overrideMaterial:null;for(let B=0,K=v.length;B<K;B++){let ae=v[B],{object:ne,geometry:fe,group:be}=ae,Ne=ae.material;Ne.allowOverride===!0&&U!==null&&(Ne=U),ne.layers.test(O.layers)&&xl(ne,T,O,fe,Ne,be)}}function xl(v,T,O,U,B,K){v.onBeforeRender(I,T,O,U,B,K),v.modelViewMatrix.multiplyMatrices(O.matrixWorldInverse,v.matrixWorld),v.normalMatrix.getNormalMatrix(v.modelViewMatrix),B.onBeforeRender(I,T,O,U,v,K),B.transparent===!0&&B.side===Ii&&B.forceSinglePass===!1?(B.side=vn,B.needsUpdate=!0,I.renderBufferDirect(O,T,U,B,v,K),B.side=er,B.needsUpdate=!0,I.renderBufferDirect(O,T,U,B,v,K),B.side=Ii):I.renderBufferDirect(O,T,U,B,v,K),v.onAfterRender(I,T,O,U,B,K)}function qr(v,T,O){T.isScene!==!0&&(T=bt);let U=C.get(v),B=E.state.lights,K=E.state.shadowsArray,ae=B.state.version,ne=de.getParameters(v,B.state,K,T,O,E.state.lightProbeGridArray),fe=de.getProgramCacheKey(ne),be=U.programs;U.environment=v.isMeshStandardMaterial||v.isMeshLambertMaterial||v.isMeshPhongMaterial?T.environment:null,U.fog=T.fog;let Ne=v.isMeshStandardMaterial||v.isMeshLambertMaterial&&!v.envMap||v.isMeshPhongMaterial&&!v.envMap;U.envMap=V.get(v.envMap||U.environment,Ne),U.envMapRotation=U.environment!==null&&v.envMap===null?T.environmentRotation:v.envMapRotation,be===void 0&&(v.addEventListener("dispose",gt),be=new Map,U.programs=be);let Fe=be.get(fe);if(Fe!==void 0){if(U.currentProgram===Fe&&U.lightsStateVersion===ae)return No(v,ne),Fe}else ne.uniforms=de.getUniforms(v),N!==null&&v.isNodeMaterial&&N.build(v,O,ne),v.onBeforeCompile(ne,I),Fe=de.acquireProgram(ne,fe),be.set(fe,Fe),U.uniforms=ne.uniforms;let we=U.uniforms;return(!v.isShaderMaterial&&!v.isRawShaderMaterial||v.clipping===!0)&&(we.clippingPlanes=Me.uniform),No(v,ne),U.needsLights=eg(v),U.lightsStateVersion=ae,U.needsLights&&(we.ambientLightColor.value=B.state.ambient,we.lightProbe.value=B.state.probe,we.directionalLights.value=B.state.directional,we.directionalLightShadows.value=B.state.directionalShadow,we.spotLights.value=B.state.spot,we.spotLightShadows.value=B.state.spotShadow,we.rectAreaLights.value=B.state.rectArea,we.ltc_1.value=B.state.rectAreaLTC1,we.ltc_2.value=B.state.rectAreaLTC2,we.pointLights.value=B.state.point,we.pointLightShadows.value=B.state.pointShadow,we.hemisphereLights.value=B.state.hemi,we.directionalShadowMatrix.value=B.state.directionalShadowMatrix,we.spotLightMatrix.value=B.state.spotLightMatrix,we.spotLightMap.value=B.state.spotLightMap,we.pointShadowMatrix.value=B.state.pointShadowMatrix),U.lightProbeGrid=E.state.lightProbeGridArray.length>0,U.currentProgram=Fe,U.uniformsList=null,Fe}function ws(v){if(v.uniformsList===null){let T=v.currentProgram.getUniforms();v.uniformsList=Co.seqWithValue(T.seq,v.uniforms)}return v.uniformsList}function No(v,T){let O=C.get(v);O.outputColorSpace=T.outputColorSpace,O.batching=T.batching,O.batchingColor=T.batchingColor,O.instancing=T.instancing,O.instancingColor=T.instancingColor,O.instancingMorph=T.instancingMorph,O.skinning=T.skinning,O.morphTargets=T.morphTargets,O.morphNormals=T.morphNormals,O.morphColors=T.morphColors,O.morphTargetsCount=T.morphTargetsCount,O.numClippingPlanes=T.numClippingPlanes,O.numIntersection=T.numClipIntersection,O.vertexAlphas=T.vertexAlphas,O.vertexTangents=T.vertexTangents,O.toneMapping=T.toneMapping}function yl(v,T){if(v.length===0)return null;if(v.length===1)return v[0].texture!==null?v[0]:null;w.setFromMatrixPosition(T.matrixWorld);for(let O=0,U=v.length;O<U;O++){let B=v[O];if(B.texture!==null&&B.boundingBox.containsPoint(w))return B}return null}function Sl(v,T,O,U,B){T.isScene!==!0&&(T=bt),S.resetTextureUnits();let K=T.fog,ae=U.isMeshStandardMaterial||U.isMeshLambertMaterial||U.isMeshPhongMaterial?T.environment:null,ne=z===null?I.outputColorSpace:z.isXRRenderTarget===!0?z.texture.colorSpace:je.workingColorSpace,fe=U.isMeshStandardMaterial||U.isMeshLambertMaterial&&!U.envMap||U.isMeshPhongMaterial&&!U.envMap,be=V.get(U.envMap||ae,fe),Ne=U.vertexColors===!0&&!!O.attributes.color&&O.attributes.color.itemSize===4,Fe=!!O.attributes.tangent&&(!!U.normalMap||U.anisotropy>0),we=!!O.morphAttributes.position,qe=!!O.morphAttributes.normal,dt=!!O.morphAttributes.color,ot=di;U.toneMapped&&(z===null||z.isXRRenderTarget===!0)&&(ot=I.toneMapping);let ut=O.morphAttributes.position||O.morphAttributes.normal||O.morphAttributes.color,Ae=ut!==void 0?ut.length:0,me=C.get(U),Ut=E.state.lights;if(ke===!0&&(Ye===!0||v!==H)){let _t=v===H&&U.id===G;Me.setState(U,v,_t)}let $e=!1;U.version===me.__version?(me.needsLights&&me.lightsStateVersion!==Ut.state.version||me.outputColorSpace!==ne||B.isBatchedMesh&&me.batching===!1||!B.isBatchedMesh&&me.batching===!0||B.isBatchedMesh&&me.batchingColor===!0&&B.colorTexture===null||B.isBatchedMesh&&me.batchingColor===!1&&B.colorTexture!==null||B.isInstancedMesh&&me.instancing===!1||!B.isInstancedMesh&&me.instancing===!0||B.isSkinnedMesh&&me.skinning===!1||!B.isSkinnedMesh&&me.skinning===!0||B.isInstancedMesh&&me.instancingColor===!0&&B.instanceColor===null||B.isInstancedMesh&&me.instancingColor===!1&&B.instanceColor!==null||B.isInstancedMesh&&me.instancingMorph===!0&&B.morphTexture===null||B.isInstancedMesh&&me.instancingMorph===!1&&B.morphTexture!==null||me.envMap!==be||U.fog===!0&&me.fog!==K||me.numClippingPlanes!==void 0&&(me.numClippingPlanes!==Me.numPlanes||me.numIntersection!==Me.numIntersection)||me.vertexAlphas!==Ne||me.vertexTangents!==Fe||me.morphTargets!==we||me.morphNormals!==qe||me.morphColors!==dt||me.toneMapping!==ot||me.morphTargetsCount!==Ae||!!me.lightProbeGrid!=E.state.lightProbeGridArray.length>0)&&($e=!0):($e=!0,me.__version=U.version);let tn=me.currentProgram;$e===!0&&(tn=qr(U,T,B),N&&U.isNodeMaterial&&N.onUpdateProgram(U,tn,me));let yn=!1,_i=!1,Es=!1,ft=tn.getUniforms(),Nt=me.uniforms;if(_e.useProgram(tn.program)&&(yn=!0,_i=!0,Es=!0),U.id!==G&&(G=U.id,_i=!0),me.needsLights){let _t=yl(E.state.lightProbeGridArray,B);me.lightProbeGrid!==_t&&(me.lightProbeGrid=_t,_i=!0)}if(yn||H!==v){_e.buffers.depth.getReversed()&&v.reversedDepth!==!0&&(v._reversedDepth=!0,v.updateProjectionMatrix()),ft.setValue(k,"projectionMatrix",v.projectionMatrix),ft.setValue(k,"viewMatrix",v.matrixWorldInverse);let sr=ft.map.cameraPosition;sr!==void 0&&sr.setValue(k,rt.setFromMatrixPosition(v.matrixWorld)),ct.logarithmicDepthBuffer&&ft.setValue(k,"logDepthBufFC",2/(Math.log(v.far+1)/Math.LN2)),(U.isMeshPhongMaterial||U.isMeshToonMaterial||U.isMeshLambertMaterial||U.isMeshBasicMaterial||U.isMeshStandardMaterial||U.isShaderMaterial)&&ft.setValue(k,"isOrthographic",v.isOrthographicCamera===!0),H!==v&&(H=v,_i=!0,Es=!0)}if(me.needsLights&&(Ut.state.directionalShadowMap.length>0&&ft.setValue(k,"directionalShadowMap",Ut.state.directionalShadowMap,S),Ut.state.spotShadowMap.length>0&&ft.setValue(k,"spotShadowMap",Ut.state.spotShadowMap,S),Ut.state.pointShadowMap.length>0&&ft.setValue(k,"pointShadowMap",Ut.state.pointShadowMap,S)),B.isSkinnedMesh){ft.setOptional(k,B,"bindMatrix"),ft.setOptional(k,B,"bindMatrixInverse");let _t=B.skeleton;_t&&(_t.boneTexture===null&&_t.computeBoneTexture(),ft.setValue(k,"boneTexture",_t.boneTexture,S))}B.isBatchedMesh&&(ft.setOptional(k,B,"batchingTexture"),ft.setValue(k,"batchingTexture",B._matricesTexture,S),ft.setOptional(k,B,"batchingIdTexture"),ft.setValue(k,"batchingIdTexture",B._indirectTexture,S),ft.setOptional(k,B,"batchingColorTexture"),B._colorsTexture!==null&&ft.setValue(k,"batchingColorTexture",B._colorsTexture,S));let rr=O.morphAttributes;if((rr.position!==void 0||rr.normal!==void 0||rr.color!==void 0)&&Ue.update(B,O,tn),(_i||me.receiveShadow!==B.receiveShadow)&&(me.receiveShadow=B.receiveShadow,ft.setValue(k,"receiveShadow",B.receiveShadow)),(U.isMeshStandardMaterial||U.isMeshLambertMaterial||U.isMeshPhongMaterial)&&U.envMap===null&&T.environment!==null&&(Nt.envMapIntensity.value=T.environmentIntensity),Nt.dfgLUT!==void 0&&(Nt.dfgLUT.value=yA()),_i){if(ft.setValue(k,"toneMappingExposure",I.toneMappingExposure),me.needsLights&&ed(Nt,Es),K&&U.fog===!0&&X.refreshFogUniforms(Nt,K),X.refreshMaterialUniforms(Nt,U,Oe,st,E.state.transmissionRenderTarget[v.id]),me.needsLights&&me.lightProbeGrid){let _t=me.lightProbeGrid;Nt.probesSH.value=_t.texture,Nt.probesMin.value.copy(_t.boundingBox.min),Nt.probesMax.value.copy(_t.boundingBox.max),Nt.probesResolution.value.copy(_t.resolution)}Co.upload(k,ws(me),Nt,S)}if(U.isShaderMaterial&&U.uniformsNeedUpdate===!0&&(Co.upload(k,ws(me),Nt,S),U.uniformsNeedUpdate=!1),U.isSpriteMaterial&&ft.setValue(k,"center",B.center),ft.setValue(k,"modelViewMatrix",B.modelViewMatrix),ft.setValue(k,"normalMatrix",B.normalMatrix),ft.setValue(k,"modelMatrix",B.matrixWorld),U.uniformsGroups!==void 0){let _t=U.uniformsGroups;for(let sr=0,Ts=_t.length;sr<Ts;sr++){let tg=_t[sr];q.update(tg,tn),q.bind(tg,tn)}}return tn}function ed(v,T){v.ambientLightColor.needsUpdate=T,v.lightProbe.needsUpdate=T,v.directionalLights.needsUpdate=T,v.directionalLightShadows.needsUpdate=T,v.pointLights.needsUpdate=T,v.pointLightShadows.needsUpdate=T,v.spotLights.needsUpdate=T,v.spotLightShadows.needsUpdate=T,v.rectAreaLights.needsUpdate=T,v.hemisphereLights.needsUpdate=T}function eg(v){return v.isMeshLambertMaterial||v.isMeshToonMaterial||v.isMeshPhongMaterial||v.isMeshStandardMaterial||v.isShadowMaterial||v.isShaderMaterial&&v.lights===!0}this.getActiveCubeFace=function(){return F},this.getActiveMipmapLevel=function(){return W},this.getRenderTarget=function(){return z},this.setRenderTargetTextures=function(v,T,O){let U=C.get(v);U.__autoAllocateDepthBuffer=v.resolveDepthBuffer===!1,U.__autoAllocateDepthBuffer===!1&&(U.__useRenderToTexture=!1),C.get(v.texture).__webglTexture=T,C.get(v.depthTexture).__webglTexture=U.__autoAllocateDepthBuffer?void 0:O,U.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(v,T){let O=C.get(v);O.__webglFramebuffer=T,O.__useDefaultFramebuffer=T===void 0};let td=k.createFramebuffer();this.setRenderTarget=function(v,T=0,O=0){z=v,F=T,W=O;let U=null,B=!1,K=!1;if(v){let ne=C.get(v);if(ne.__useDefaultFramebuffer!==void 0){_e.bindFramebuffer(k.FRAMEBUFFER,ne.__webglFramebuffer),ee.copy(v.viewport),re.copy(v.scissor),se=v.scissorTest,_e.viewport(ee),_e.scissor(re),_e.setScissorTest(se),G=-1;return}else if(ne.__webglFramebuffer===void 0)S.setupRenderTarget(v);else if(ne.__hasExternalTextures)S.rebindTextures(v,C.get(v.texture).__webglTexture,C.get(v.depthTexture).__webglTexture);else if(v.depthBuffer){let Ne=v.depthTexture;if(ne.__boundDepthTexture!==Ne){if(Ne!==null&&C.has(Ne)&&(v.width!==Ne.image.width||v.height!==Ne.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");S.setupDepthRenderbuffer(v)}}let fe=v.texture;(fe.isData3DTexture||fe.isDataArrayTexture||fe.isCompressedArrayTexture)&&(K=!0);let be=C.get(v).__webglFramebuffer;v.isWebGLCubeRenderTarget?(Array.isArray(be[T])?U=be[T][O]:U=be[T],B=!0):v.samples>0&&S.useMultisampledRTT(v)===!1?U=C.get(v).__webglMultisampledFramebuffer:Array.isArray(be)?U=be[O]:U=be,ee.copy(v.viewport),re.copy(v.scissor),se=v.scissorTest}else ee.copy(he).multiplyScalar(Oe).floor(),re.copy(Ie).multiplyScalar(Oe).floor(),se=Be;if(O!==0&&(U=td),_e.bindFramebuffer(k.FRAMEBUFFER,U)&&_e.drawBuffers(v,U),_e.viewport(ee),_e.scissor(re),_e.setScissorTest(se),B){let ne=C.get(v.texture);k.framebufferTexture2D(k.FRAMEBUFFER,k.COLOR_ATTACHMENT0,k.TEXTURE_CUBE_MAP_POSITIVE_X+T,ne.__webglTexture,O)}else if(K){let ne=T;for(let fe=0;fe<v.textures.length;fe++){let be=C.get(v.textures[fe]);k.framebufferTextureLayer(k.FRAMEBUFFER,k.COLOR_ATTACHMENT0+fe,be.__webglTexture,O,ne)}}else if(v!==null&&O!==0){let ne=C.get(v.texture);k.framebufferTexture2D(k.FRAMEBUFFER,k.COLOR_ATTACHMENT0,k.TEXTURE_2D,ne.__webglTexture,O)}G=-1},this.readRenderTargetPixels=function(v,T,O,U,B,K,ae,ne=0){if(!(v&&v.isWebGLRenderTarget)){De("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let fe=C.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&ae!==void 0&&(fe=fe[ae]),fe){_e.bindFramebuffer(k.FRAMEBUFFER,fe);try{let be=v.textures[ne],Ne=be.format,Fe=be.type;if(v.textures.length>1&&k.readBuffer(k.COLOR_ATTACHMENT0+ne),!ct.textureFormatReadable(Ne)){De("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!ct.textureTypeReadable(Fe)){De("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}T>=0&&T<=v.width-U&&O>=0&&O<=v.height-B&&k.readPixels(T,O,U,B,D.convert(Ne),D.convert(Fe),K)}finally{let be=z!==null?C.get(z).__webglFramebuffer:null;_e.bindFramebuffer(k.FRAMEBUFFER,be)}}},this.readRenderTargetPixelsAsync=async function(v,T,O,U,B,K,ae,ne=0){if(!(v&&v.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let fe=C.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&ae!==void 0&&(fe=fe[ae]),fe)if(T>=0&&T<=v.width-U&&O>=0&&O<=v.height-B){_e.bindFramebuffer(k.FRAMEBUFFER,fe);let be=v.textures[ne],Ne=be.format,Fe=be.type;if(v.textures.length>1&&k.readBuffer(k.COLOR_ATTACHMENT0+ne),!ct.textureFormatReadable(Ne))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!ct.textureTypeReadable(Fe))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let we=k.createBuffer();k.bindBuffer(k.PIXEL_PACK_BUFFER,we),k.bufferData(k.PIXEL_PACK_BUFFER,K.byteLength,k.STREAM_READ),k.readPixels(T,O,U,B,D.convert(Ne),D.convert(Fe),0);let qe=z!==null?C.get(z).__webglFramebuffer:null;_e.bindFramebuffer(k.FRAMEBUFFER,qe);let dt=k.fenceSync(k.SYNC_GPU_COMMANDS_COMPLETE,0);return k.flush(),await zx(k,dt,4),k.bindBuffer(k.PIXEL_PACK_BUFFER,we),k.getBufferSubData(k.PIXEL_PACK_BUFFER,0,K),k.deleteBuffer(we),k.deleteSync(dt),K}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(v,T=null,O=0){let U=Math.pow(2,-O),B=Math.floor(v.image.width*U),K=Math.floor(v.image.height*U),ae=T!==null?T.x:0,ne=T!==null?T.y:0;S.setTexture2D(v,0),k.copyTexSubImage2D(k.TEXTURE_2D,O,0,0,ae,ne,B,K),_e.unbindTexture()};let Ml=k.createFramebuffer(),Z=k.createFramebuffer();this.copyTextureToTexture=function(v,T,O=null,U=null,B=0,K=0){let ae,ne,fe,be,Ne,Fe,we,qe,dt,ot=v.isCompressedTexture?v.mipmaps[K]:v.image;if(O!==null)ae=O.max.x-O.min.x,ne=O.max.y-O.min.y,fe=O.isBox3?O.max.z-O.min.z:1,be=O.min.x,Ne=O.min.y,Fe=O.isBox3?O.min.z:0;else{let Nt=Math.pow(2,-B);ae=Math.floor(ot.width*Nt),ne=Math.floor(ot.height*Nt),v.isDataArrayTexture?fe=ot.depth:v.isData3DTexture?fe=Math.floor(ot.depth*Nt):fe=1,be=0,Ne=0,Fe=0}U!==null?(we=U.x,qe=U.y,dt=U.z):(we=0,qe=0,dt=0);let ut=D.convert(T.format),Ae=D.convert(T.type),me;T.isData3DTexture?(S.setTexture3D(T,0),me=k.TEXTURE_3D):T.isDataArrayTexture||T.isCompressedArrayTexture?(S.setTexture2DArray(T,0),me=k.TEXTURE_2D_ARRAY):(S.setTexture2D(T,0),me=k.TEXTURE_2D),_e.activeTexture(k.TEXTURE0),_e.pixelStorei(k.UNPACK_FLIP_Y_WEBGL,T.flipY),_e.pixelStorei(k.UNPACK_PREMULTIPLY_ALPHA_WEBGL,T.premultiplyAlpha),_e.pixelStorei(k.UNPACK_ALIGNMENT,T.unpackAlignment);let Ut=_e.getParameter(k.UNPACK_ROW_LENGTH),$e=_e.getParameter(k.UNPACK_IMAGE_HEIGHT),tn=_e.getParameter(k.UNPACK_SKIP_PIXELS),yn=_e.getParameter(k.UNPACK_SKIP_ROWS),_i=_e.getParameter(k.UNPACK_SKIP_IMAGES);_e.pixelStorei(k.UNPACK_ROW_LENGTH,ot.width),_e.pixelStorei(k.UNPACK_IMAGE_HEIGHT,ot.height),_e.pixelStorei(k.UNPACK_SKIP_PIXELS,be),_e.pixelStorei(k.UNPACK_SKIP_ROWS,Ne),_e.pixelStorei(k.UNPACK_SKIP_IMAGES,Fe);let Es=v.isDataArrayTexture||v.isData3DTexture,ft=T.isDataArrayTexture||T.isData3DTexture;if(v.isDepthTexture){let Nt=C.get(v),rr=C.get(T),_t=C.get(Nt.__renderTarget),sr=C.get(rr.__renderTarget);_e.bindFramebuffer(k.READ_FRAMEBUFFER,_t.__webglFramebuffer),_e.bindFramebuffer(k.DRAW_FRAMEBUFFER,sr.__webglFramebuffer);for(let Ts=0;Ts<fe;Ts++)Es&&(k.framebufferTextureLayer(k.READ_FRAMEBUFFER,k.COLOR_ATTACHMENT0,C.get(v).__webglTexture,B,Fe+Ts),k.framebufferTextureLayer(k.DRAW_FRAMEBUFFER,k.COLOR_ATTACHMENT0,C.get(T).__webglTexture,K,dt+Ts)),k.blitFramebuffer(be,Ne,ae,ne,we,qe,ae,ne,k.DEPTH_BUFFER_BIT,k.NEAREST);_e.bindFramebuffer(k.READ_FRAMEBUFFER,null),_e.bindFramebuffer(k.DRAW_FRAMEBUFFER,null)}else if(B!==0||v.isRenderTargetTexture||C.has(v)){let Nt=C.get(v),rr=C.get(T);_e.bindFramebuffer(k.READ_FRAMEBUFFER,Ml),_e.bindFramebuffer(k.DRAW_FRAMEBUFFER,Z);for(let _t=0;_t<fe;_t++)Es?k.framebufferTextureLayer(k.READ_FRAMEBUFFER,k.COLOR_ATTACHMENT0,Nt.__webglTexture,B,Fe+_t):k.framebufferTexture2D(k.READ_FRAMEBUFFER,k.COLOR_ATTACHMENT0,k.TEXTURE_2D,Nt.__webglTexture,B),ft?k.framebufferTextureLayer(k.DRAW_FRAMEBUFFER,k.COLOR_ATTACHMENT0,rr.__webglTexture,K,dt+_t):k.framebufferTexture2D(k.DRAW_FRAMEBUFFER,k.COLOR_ATTACHMENT0,k.TEXTURE_2D,rr.__webglTexture,K),B!==0?k.blitFramebuffer(be,Ne,ae,ne,we,qe,ae,ne,k.COLOR_BUFFER_BIT,k.NEAREST):ft?k.copyTexSubImage3D(me,K,we,qe,dt+_t,be,Ne,ae,ne):k.copyTexSubImage2D(me,K,we,qe,be,Ne,ae,ne);_e.bindFramebuffer(k.READ_FRAMEBUFFER,null),_e.bindFramebuffer(k.DRAW_FRAMEBUFFER,null)}else ft?v.isDataTexture||v.isData3DTexture?k.texSubImage3D(me,K,we,qe,dt,ae,ne,fe,ut,Ae,ot.data):T.isCompressedArrayTexture?k.compressedTexSubImage3D(me,K,we,qe,dt,ae,ne,fe,ut,ot.data):k.texSubImage3D(me,K,we,qe,dt,ae,ne,fe,ut,Ae,ot):v.isDataTexture?k.texSubImage2D(k.TEXTURE_2D,K,we,qe,ae,ne,ut,Ae,ot.data):v.isCompressedTexture?k.compressedTexSubImage2D(k.TEXTURE_2D,K,we,qe,ot.width,ot.height,ut,ot.data):k.texSubImage2D(k.TEXTURE_2D,K,we,qe,ae,ne,ut,Ae,ot);_e.pixelStorei(k.UNPACK_ROW_LENGTH,Ut),_e.pixelStorei(k.UNPACK_IMAGE_HEIGHT,$e),_e.pixelStorei(k.UNPACK_SKIP_PIXELS,tn),_e.pixelStorei(k.UNPACK_SKIP_ROWS,yn),_e.pixelStorei(k.UNPACK_SKIP_IMAGES,_i),K===0&&T.generateMipmaps&&k.generateMipmap(me),_e.unbindTexture()},this.initRenderTarget=function(v){C.get(v).__webglFramebuffer===void 0&&S.setupRenderTarget(v)},this.initTexture=function(v){v.isCubeTexture?S.setTextureCube(v,0):v.isData3DTexture?S.setTexture3D(v,0):v.isDataArrayTexture||v.isCompressedArrayTexture?S.setTexture2DArray(v,0):S.setTexture2D(v,0),_e.unbindTexture()},this.resetState=function(){F=0,W=0,z=null,_e.reset(),oe.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return ui}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let n=this.getContext();n.drawingBufferColorSpace=je._getDrawingBufferColorSpace(e),n.unpackColorSpace=je._getUnpackColorSpace()}};var ml=new L;function jn(t,e,n,i,r,s){let o=2*Math.PI*r/4,a=Math.max(s-2*r,0),l=Math.PI/4;ml.copy(e),ml[i]=0,ml.normalize();let c=.5*o/(o+a),d=1-ml.angleTo(t)/l;return Math.sign(ml[n])===1?d*c:a/(o+a)+c+c*(1-d)}var jh=class t extends Pi{constructor(e=1,n=1,i=1,r=2,s=.1){let o=r*2+1;if(s=Math.min(e/2,n/2,i/2,s),super(1,1,1,o,o,o),this.type="RoundedBoxGeometry",this.parameters={width:e,height:n,depth:i,segments:r,radius:s},o===1)return;let a=this.toNonIndexed();this.index=null,this.attributes.position=a.attributes.position,this.attributes.normal=a.attributes.normal,this.attributes.uv=a.attributes.uv;let l=new L,c=new L,d=new L(e,n,i).divideScalar(2).subScalar(s),f=this.attributes.position.array,h=this.attributes.normal.array,p=this.attributes.uv.array,x=f.length/6,M=new L,_=.5/o;for(let u=0,m=0;u<f.length;u+=3,m+=2)switch(l.fromArray(f,u),c.copy(l),c.x-=Math.sign(c.x)*_,c.y-=Math.sign(c.y)*_,c.z-=Math.sign(c.z)*_,c.normalize(),f[u+0]=d.x*Math.sign(l.x)+c.x*s,f[u+1]=d.y*Math.sign(l.y)+c.y*s,f[u+2]=d.z*Math.sign(l.z)+c.z*s,h[u+0]=c.x,h[u+1]=c.y,h[u+2]=c.z,Math.floor(u/x)){case 0:M.set(1,0,0),p[m+0]=jn(M,c,"z","y",s,i),p[m+1]=1-jn(M,c,"y","z",s,n);break;case 1:M.set(-1,0,0),p[m+0]=1-jn(M,c,"z","y",s,i),p[m+1]=1-jn(M,c,"y","z",s,n);break;case 2:M.set(0,1,0),p[m+0]=1-jn(M,c,"x","z",s,e),p[m+1]=jn(M,c,"z","x",s,i);break;case 3:M.set(0,-1,0),p[m+0]=1-jn(M,c,"x","z",s,e),p[m+1]=1-jn(M,c,"z","x",s,i);break;case 4:M.set(0,0,1),p[m+0]=1-jn(M,c,"x","y",s,e),p[m+1]=1-jn(M,c,"y","x",s,n);break;case 5:M.set(0,0,-1),p[m+0]=jn(M,c,"x","y",s,e),p[m+1]=1-jn(M,c,"y","x",s,n);break}}static fromJSON(e){return new t(e.width,e.height,e.depth,e.segments,e.radius)}};var Qt=wl(jm());async function CA(){let t=typeof AbortController=="function"?new AbortController:null,e;try{let n=fetch("./game.config.json",{signal:t==null?void 0:t.signal}).then(s=>{if(!s.ok)throw new Error(`HTTP ${s.status}`);return s.json()}),i=new Promise((s,o)=>{e=setTimeout(()=>o(new Error("timed out")),1200)}),r=await Promise.race([n,i]);if(!r||typeof r!="object"||Array.isArray(r)||["tweaks","texts","images"].some(s=>r[s]!=null&&!Array.isArray(r[s])))throw new Error("invalid config");return r}catch(n){return console.warn("[playable] Using packaged defaults:",n.message),null}finally{clearTimeout(e),t==null||t.abort()}}function RA(t,e){if(e(),typeof ResizeObserver=="function"){let n=new ResizeObserver(e);return n.observe(t),()=>n.disconnect()}return window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}var mi=window.parent!==window&&new URLSearchParams(location.search).get("feedReview")==="1";mi&&(document.documentElement.dataset.feedCover="true",window.addEventListener("message",t=>{var e;t.source!==window.parent||t.origin!==location.origin||((e=t.data)==null?void 0:e.type)!=="playable-active"||(mi=t.data.active!==!0,document.documentElement.dataset.feedCover=String(mi))}));var Qm={WAIT_TIME:1.55,WINDUP_TIME:.65,LUNGE_TIME:.48,DRAG_SENSITIVITY:.011,GUIDE:"Drag to dodge!",CAUGHT:"Caught!",BEST:"BEST",AGAIN:"Play again"},gl=(t,e,n)=>Math.max(e,Math.min(n,t)),Po=(t,e=!1)=>{try{window.SFX&&(e?window.SFX.playOnce(t):window.SFX.play(t))}catch{}};window.SFX&&window.SFX.register({swish:"buzzer",wood:"./assets/sfx_wood.mp3",catch:"buzzer",best:"./assets/sfx_best.mp3",click:"./assets/sfx_click.mp3"});function PA(){let[t,e]=(0,en.useState)(Qm),[n,i]=(0,en.useState)(!1),[r,s]=(0,en.useState)("intro"),[o,a]=(0,en.useState)(0),[l,c]=(0,en.useState)(0),[d,f]=(0,en.useState)(!1),h=(0,en.useRef)(null),p=(0,en.useRef)({phase:"intro",elapsed:0,tx:0,ty:0,drag:null,broken:0}),x=(0,en.useRef)(Qm),M=(0,en.useRef)(null),_=(0,en.useRef)(!1);(0,en.useEffect)(()=>{CA().then(A=>{let g=A||{},b={...Qm};[...g.tweaks||[],...g.texts||[]].forEach(I=>b[I.id]=I.value),x.current=b,e(b),i(!0)})},[]),(0,en.useEffect)(()=>{let A=()=>{_.current=!1,f(!1)},g=()=>{document.visibilityState==="visible"&&A()};return document.addEventListener("visibilitychange",g),window.addEventListener("pageshow",A),()=>{document.removeEventListener("visibilitychange",g),window.removeEventListener("pageshow",A)}},[]),(0,en.useEffect)(()=>{if(!n||!h.current)return;let A=h.current,g=new ka;g.background=new Ke("#f3e3cb");let b=new kr(-3.2,3.2,4.8,-.3,.1,100);b.position.set(6.32,4.51,10),b.lookAt(-.18,2.31,.1);let I=new $h({antialias:!0,alpha:!1});I.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5)),I.outputColorSpace=Yt,I.shadowMap.enabled=!1,A.appendChild(I.domElement),g.add(new Qa(16774619,10454635,2.1));let P=new tl(16773590,2.5);P.position.set(-4,8,8),P.castShadow=!1,P.shadow.mapSize.set(1024,1024),P.shadow.camera.left=-6,P.shadow.camera.right=6,P.shadow.camera.top=8,P.shadow.camera.bottom=-5,g.add(P);let N=(Z,v={})=>new Ja({color:Z,roughness:.85,...v}),F={wood:N("#a95b2f"),woodLight:N("#d48b4b"),woodDark:N("#703b26"),cream:N("#f8e6c8"),red:N("#c43f36"),redLight:N("#e5594b"),blue:N("#528f9b"),navy:N("#304e59"),skin:N("#d49a72"),skin2:N("#e6ae86"),white:N("#fff5df"),pink:N("#ed9eaa"),dark:N("#372c2a"),gold:N("#d4a054"),metal:N("#9cabb1",{metalness:.65,roughness:.35})},W=N("#376b64"),z=N("#5e8f7f"),G=N("#413638"),H=N("#51312a"),ee=N("#c68168"),re=N("#ded3b8");function se(Z,v,T,O,U,B,K,ae,ne){let fe=new Bt(new jh(v,T,O,1,ne),ae);return fe.position.set(U,B,K),Z.add(fe),fe}let ve=(Z,v,T,O,U,B,K,ae,ne=0)=>{let fe=new Bt(new Pi(v,T,O),ae);return fe.position.set(U,B,K),fe.rotation.z=ne,fe.castShadow=!0,fe.receiveShadow=!0,Z.add(fe),fe},pe=(Z,v,T,O,U,B,K=[1,1,1],ae=12)=>{let ne=new Bt(new Za(v,ae,8),B);return ne.position.set(T,O,U),ne.scale.set(...K),ne.castShadow=!0,Z.add(ne),ne},Pe=(Z,v,T,O,U,B,K,ae,ne=10)=>{let fe=new Bt(new Wa(v,T,O,ne),ae);return fe.position.set(U,B,K),fe.castShadow=!0,Z.add(fe),fe},st=(Z,v,T,O,U)=>{let B=new L().subVectors(T,v),K=Pe(Z,O,O,B.length(),(v.x+T.x)/2,(v.y+T.y)/2,(v.z+T.z)/2,U,8);return K.quaternion.setFromUnitVectors(new L(0,1,0),B.normalize()),K};ve(g,16,10,.2,0,3,-2.3,F.cream),ve(g,30,.12,14,0,-.229,8.99,N("#62646a",{roughness:1})),ve(g,16,.12,4,0,-.12,0,N("#e4c19a")),ve(g,16,.13,.12,0,-.12,1.96,N("#c8b69e")),ve(g,16,1.05,.03,0,.53,-2.16,F.blue);for(let Z=-7.5;Z<8;Z+=.48)for(let v=.18;v<1;v+=.43)ve(g,.37,.34,.025,Z,v,-2.12,F.white),ve(g,.14,.14,.03,Z,v,-2.09,F.blue,Math.PI/4);ve(g,16,.07,.05,0,1.07,-2.1,F.navy);let Oe=document.createElement("canvas");Oe.width=Oe.height=32;let J=Oe.getContext("2d"),ge=J.createRadialGradient(16,16,1,16,16,16);ge.addColorStop(0,"#48302d80"),ge.addColorStop(.55,"#48302d45"),ge.addColorStop(1,"#48302d00"),J.fillStyle=ge,J.fillRect(0,0,32,32);let he=new _s(Oe);he.colorSpace=Yt;let Ie=new gs({map:he,transparent:!0,depthWrite:!1});function Be(Z,v,T,O,U){let B=new Bt(new vs(O,U),Ie);B.rotation.x=-Math.PI/2,B.position.set(v,-.056,T),Z.add(B)}let Re=new Kt;g.add(Re);let ke=new Kt;Re.add(ke),Be(ke,0,-.12,3.95,2.55),se(ke,2.9,1.05,1.38,0,.94,-.15,W,.1),se(ke,3.12,.18,1.6,0,1.52,-.15,F.woodDark,.066),se(ke,3.07,.09,1.55,0,1.61,-.15,F.woodLight,.042);for(let Z of[-.94,.94])se(ke,.76,.68,.065,Z,.95,.55,z,.03);for(let Z of[-1,1])se(ke,.065,.68,1.05,Z*1.45,.95,-.15,z,.03);let Ye=Pe(ke,.32,.32,.045,0,.98,.564,F.cream,16);Ye.rotation.x=Math.PI/2,Pe(ke,.095,.014,.215,0,.925,.601,F.wood,10),pe(ke,.102,0,1.07,.61,F.redLight,[1,.93,.47]);for(let Z of[-1.15,1.15]){let v=Pe(ke,.049,.049,1.64,Z,.34,-.15,F.metal,8);v.rotation.x=Math.PI/2;for(let T of[-1,1]){let O=Pe(ke,.36,.36,.16,Z,.34,-.15+T*.79,G,16);O.rotation.x=Math.PI/2;let U=Pe(ke,.25,.25,.03,Z,.34,-.15+T*.88,F.woodLight,14);if(U.rotation.x=Math.PI/2,T<0)continue;for(let K=0;K<5;K++){let ae=K*Math.PI*2/5;ve(ke,.042,.156,.025,Z-Math.sin(ae)*.142,.34+Math.cos(ae)*.142,.746,F.woodDark,ae)}let B=Pe(ke,.091,.091,.066,Z,.34,.763,F.woodDark,12);B.rotation.x=Math.PI/2}}let et=[ke];for(let Z of[-1.35,1.35]){let v=new Kt;Re.add(v);for(let T of[-.73,.43])se(v,.135,2.42,.145,Z,2.83,T,F.woodDark,.021),se(v,.18,.13,.19,Z,1.715,T,F.woodLight,.02);et.push(v)}let rt=new Kt;Re.add(rt),et.push(rt);for(let Z of[-1,1])for(let v=0;v<10;v++){let T=ve(rt,.32,.085,.92,-1.44+v*.32,4.16,-.15+Z*.43,v%2?F.cream:F.red);T.rotation.x=Z*.35}for(let Z=0;Z<10;Z++)se(rt,.31,.22,.085,-1.44+Z*.32,3.916,.727,Z%2?F.cream:F.red,.035);for(let[Z,v]of[-.76,0,.76].entries()){let T=[F.pink,F.white,F.gold][Z];Pe(ke,.27,.25,.12,v,1.71,-.12,F.metal,14),Pe(ke,.28,.28,.024,v,1.77,-.12,F.white,14),pe(ke,.246,v,1.77,-.12,T,[1,.21,1],14)}function We(Z,v,T,O){let U=new Kt;U.position.set(Z,0,1.02),g.add(U),Be(g,Z,1.02,.98,.76);for(let K of[-1,1]){let ae=Pe(U,.14,.13,.69,K*.19,.43,0,O,10);ae.rotation.z=K*.035;let ne=K*.19;se(U,.31,.062,.42,ne,.03,.082,G,.028),pe(U,.17,ne,.105,.068,F.dark,[.89,.56,1.28],12),pe(U,.118,K*.315,1.53,.025,T,[1,1.12,1],10)}se(U,.73,.97,.48,0,1.235,0,T,.16),Pe(U,.14,.16,.11,0,1.718,.014,T,12),Pe(U,.128,.144,.17,0,1.777,.02,v,12),pe(U,.39,0,2.03,.02,v,[1,1.1,.92],20);for(let K of[-1,1]){pe(U,.075,K*.373,2.015,.015,v,[.76,1,.73],10),pe(U,.042,K*.403,2.015,.042,ee,[.4,1,.61],10),pe(U,.042,K*.137,2.087,.355,F.dark,[.82,1.25,.46],10),pe(U,.011,K*.137+.008,2.103,.372,F.white,[1,1,.5],8);let ae=pe(U,.058,K*.137,2.161,.337,H,[1,.29,.33],10);ae.rotation.z=K*.13,pe(U,.054,K*.237,1.991,.293,ee,[1,.58,.34],10)}pe(U,.066,0,2.007,.371,v,[.88,.89,.96],12);let B=new wo([new L(-.069,1.925,.365),new L(0,1.898,.366),new L(.069,1.925,.365)]);return U.add(new Bt(new $a(B,8,.011,5,!1),H)),U}function bt(Z,v){let T=new Kt;return Z.add(T),pe(T,.105,0,0,0,v,[.83,1,.85],12),pe(T,.051,-.056,.027,.052,v,[1,1.2,.9],10),T}function pt(Z,v,T,O){let U=new L(v*.315,1.53,.035),B=new L(v*.47,1.23,.1),K=new L(v*.48,1.01,.16);st(Z,U,B,.105,T),pe(Z,.103,B.x,B.y,B.z,T),st(Z,B,K,.073,O);let ae=bt(Z,O);ae.position.copy(K),ae.rotation.y=v*.7}let mt=We(-1.75,F.skin,F.red,F.navy);mt.rotation.y=.48,pt(mt,-1,F.red,F.skin),se(mt,.58,.6,.074,0,1.116,.244,F.white,.034),se(mt,.275,.26,.075,0,1.415,.25,F.white,.027),se(mt,.66,.065,.075,0,1.26,.246,re,.022),se(mt,.24,.17,.042,0,1.06,.285,re,.023);for(let Z of[-1,1]){ve(mt,.055,.245,.036,Z*.14,1.56,.228,F.white,Z*.23);let v=pe(mt,.084,Z*.064,1.952,.366,H,[1,.37,.49],12);v.rotation.z=Z*.21}Pe(mt,.365,.374,.061,0,2.385,.02,F.woodDark,16);let k=Pe(mt,.318,.363,.21,0,2.495,.02,F.red,16);k.rotation.z=-.065,Pe(mt,.352,.363,.055,0,2.434,.02,F.redLight,16);let lt=We(1.83,F.skin2,F.blue,F.woodDark);lt.rotation.y=-.31,pt(lt,1,F.blue,F.skin2),pe(lt,.39,0,2.269,-.045,H,[1.025,.49,1.06],16);for(let[Z,v,T]of[[-.25,2.247,.21],[-.124,2.29,.268],[.008,2.301,.283],[.134,2.305,.254]]){let O=pe(lt,.103,Z,v,T,H,[1.12,.58,.69],10);O.rotation.z=.21}se(lt,.18,.16,.038,.115,1.43,.244,z,.02);for(let Z of[-1,1])ve(lt,.114,.051,.033,Z*.07,1.63,.22,F.cream,Z*.37);let ze=new Kt;g.add(ze);function ct(Z,v){return{upper:Pe(ze,.108,.115,1,0,0,0,Z,10),cuff:pe(ze,.105,0,0,0,Z,[1,1,1],10),lower:Pe(ze,.082,.067,1,0,0,0,v,10)}}let _e=ct(F.red,F.skin),wt=ct(F.blue,F.skin2),C=bt(ze,F.skin),S=Pe(ze,.036,.044,1,0,0,0,F.metal,10),V=1.16,Y=document.createElement("canvas");Y.width=256,Y.height=128;let j=Y.getContext("2d");j.fillStyle="#efa2ae",j.fillRect(0,0,Y.width,Y.height);for(let Z=0;Z<440;Z++){j.fillStyle=Z%2?"#b95f741e":"#fff0dd38";let v=Math.random()*Y.width,T=Math.random()*Y.height;j.beginPath(),j.arc(v,T,.6+Math.random()*2.1,0,Math.PI*2),j.fill()}let le=new _s(Y);le.colorSpace=Yt;let de=N("#ffffff",{map:le,roughness:.97}),X=new Kt;ze.add(X),pe(X,.249,0,.014,0,de,[1,.99,.96],18);for(let Z=0;Z<7;Z++){let v=Z*Math.PI*2/7;pe(X,.102,.169*Math.cos(v),-.082,.169*Math.sin(v),de,[1,.64,1],10)}let $=new Kt;ze.add($);let Se=[[.018,-.51],[.183,-.019],[.183,.006],[.154,.006],[.151,-.037],[.03,-.442]],Me=new qa(Se.map(([Z,v])=>new Ce(Z,v)),14),ue=document.createElement("canvas");ue.width=ue.height=128;let te=ue.getContext("2d");te.fillStyle="#e5ae62",te.fillRect(0,0,128,128),te.strokeStyle="#b57d46",te.lineWidth=3,te.beginPath();for(let Z=-128;Z<=256;Z+=16)te.moveTo(Z,0),te.lineTo(Z+64,128),te.moveTo(Z,0),te.lineTo(Z-64,128);te.stroke();let Ue=new _s(ue);Ue.colorSpace=Yt,$.add(new Bt(Me,N("#ffffff",{map:Ue})));let Ve=bt($,F.skin2);Ve.position.set(.09,-.2,.016),Ve.rotation.y=.75;let Qe=new L(0,1,0),D=new L;function oe(Z,v,T){D.subVectors(T,v),Z.position.copy(v).add(T).multiplyScalar(.5),Z.scale.y=D.length(),Z.quaternion.setFromUnitVectors(Qe,D.normalize())}function q(Z,v,T,O){oe(Z.upper,v,T),Z.cuff.position.copy(T),oe(Z.lower,T,O)}let xe=0,ce=[],Q=new L,Te=new L,Ge=new L,gt=new L,nt=new L,xn=new L,dn=new L,Fi=new L,Io=new L,Xr=new So(new L,b.getWorldDirection(new L)),Ms=new L,gi=new L,Lo=et.map(Z=>{let v=new hi().setFromObject(Z);Z===ke&&v.set(new L(-1.56,.41,-.85),new L(1.56,1.65,.65));let T=Z===ke||Z===rt?[v]:Z.children.map(B=>new hi().setFromObject(B)),O=Z===ke?.055:.085,U=T.map(B=>({surface:B,padded:B.clone().expandByScalar(O)}));return{piece:Z,bounds:v,handBounds:U}});function _l({piece:Z,bounds:v},T){Z.visible=!1,p.current.broken++,xe=.21;for(let O=0;O<9;O++){let U=ve(g,.08+Math.random()*.19,.12+Math.random()*.24,.1,T.x+(Math.random()-.5)*.4,gl(T.y,v.min.y,v.max.y),T.z,Z===rt&&O%3!==0?F.red:F.woodLight,Math.random());ce.push({mesh:U,vx:(Math.random()-.5)*3,vy:Math.random()*2.6,life:2.1})}Po("wood")}function vl(Z){let v=Z.distanceTo(Io);if(v<.001)return;let T=Math.min(12,Math.ceil(v/.06));for(let O=1;O<=T;O++){Xr.origin.lerpVectors(Io,Z,O/T).addScaledVector(Xr.direction,-.12);let U=null,B=.9*.9;for(let K of Lo)if(K.piece.visible)for(let{surface:ae,padded:ne}of K.handBounds){if(!Xr.intersectBox(ne,Ms))continue;let fe=Xr.origin.distanceToSquared(Ms);fe>=B||(U=K,B=fe,ae.clampPoint(Ms,gi))}if(U){_l(U,gi);return}}}function Yr(){for(let{mesh:Z}of ce)g.remove(Z),Z.geometry.dispose();ce=[]}function xl(){var v;let Z=p.current;Object.assign(Z,{phase:"intro",elapsed:0,tx:0,ty:0,drag:null,clock:0,attack:"wait",aim:null,broken:0,scoopX:0,scoopY:2.95,lastSwish:0,catchPose:null,catchTime:0}),et.forEach(T=>T.visible=!0),Yr(),xe=0,lt.rotation.z=0,a(0),s("intro"),(v=window.SFX)==null||v.reset(),console.log("[game] replay")}M.current=xl;let qr=performance.now(),ws=0,No=-1,yl=!1,Sl=0,ed=window.matchMedia("(prefers-reduced-motion: reduce)"),td=RA(A,()=>{let Z=A.clientWidth,v=A.clientHeight;if(!Z||!v)return;I.setSize(Z,v,!1);let T=Z/v,O=Math.max(5.5,5.55/T);b.top=O/2,b.bottom=-O/2,b.left=-O*T/2,b.right=O*T/2,b.updateProjectionMatrix()});function Ml(Z){ws=requestAnimationFrame(Ml);let v=Math.min((Z-qr)/1e3,.05);if(qr=Z,document.hidden)return;let T=p.current,O=x.current;yl!==mi&&(b.zoom=mi?.87:1,b.updateProjectionMatrix(),yl=mi,mi||(T.scoopX=0,T.scoopY=2.95));let U=mi&&T.phase==="intro"&&!ed.matches;U&&(Sl+=v);let B=Sl%4.4,K=T.attack;if(T.phase==="playing"&&!mi){T.elapsed+=v,T.clock=(T.clock||0)+v;let Ae=Math.floor(T.elapsed*10);Ae!==No&&(No=Ae,a(Ae/10));let me=Math.max(.65,O.WAIT_TIME-T.elapsed*.012),Ut=Math.max(.34,O.WINDUP_TIME-T.elapsed*.006);T.attack||(T.attack="wait"),T.attack==="wait"&&T.clock>=me&&(T.attack="wind",T.clock=0,T.aim={x:T.scoopX||0,y:T.scoopY||2.95}),T.attack==="wind"&&T.clock>=Ut&&(T.attack="lunge",T.clock=0),T.attack==="lunge"&&T.clock>=O.LUNGE_TIME&&(T.attack="back",T.clock=0),T.attack==="back"&&T.clock>=.55&&(T.attack="wait",T.clock=0)}let ae=T.tx||0,ne=2.95+(T.ty||0);if(U){let Ae=Math.max(0,Math.sin((B-.75)*Math.PI/2.5));ae=.24-1.12*Ae,ne+=.65*Ae}T.scoopX===void 0&&(T.scoopX=0,T.scoopY=2.95),T.scoopX+=(ae-T.scoopX)*Math.min(1,v*12),T.scoopY+=(ne-T.scoopY)*Math.min(1,v*12);let fe=-1.05+T.scoopX*.24,be=2.05+(T.scoopY-2.95)*.23,Ne=Q.set(fe,be,1.06),Fe=Te.set(T.scoopX,T.scoopY,V);gt.set(.31,1.53,.04),mt.localToWorld(gt),xn.copy(gt).lerp(Ne,.53),xn.y-=.12,xn.z+=.1,q(_e,gt,xn,Ne),C.position.copy(Ne),C.rotation.z=Math.atan2(Fe.y-Ne.y,Fe.x-Ne.x)-Math.PI/4,oe(S,Ne,Fe),X.position.copy(Fe);let we=1.04,qe=2.18,dt=1.13,ot=0;if(T.phase==="playing"){if(T.attack==="wind"){let Ae=Math.min(1,T.clock/Math.max(.34,O.WINDUP_TIME-T.elapsed*.006));we=1.04+Ae*.28,qe=2.18-Ae*.12,ot=-Ae*.12}if(T.attack==="lunge"){let Ae=Math.min(1,T.clock/O.LUNGE_TIME),me=Math.sin(Ae*Math.PI/2);we=1.32+(T.aim.x-1.32)*me,qe=2.06+(T.aim.y-2.06)*me,dt=1.13+(V-1.13)*me,ot=.29*me,Math.hypot(we-Fe.x,qe-Fe.y,dt-Fe.z)<.29&&(T.phase="caught",T.drag=null,T.catchTime=0,T.catchPose={x:we,y:qe,z:dt,lean:ot,ice:Fe.clone()},s("caught"),a(Math.floor(T.elapsed*10)/10),Po("catch",!0))}if(T.attack==="back"){let Ae=1-Math.min(1,T.clock/.55);we=1.04+(T.aim.x-1.04)*Ae,qe=2.18+(T.aim.y-2.18)*Ae,ot=.2*Ae}}else if(U){let Ae=Math.max(0,1-Math.abs(B-2.15)/.65);we=1.04-.85*Ae,qe=2.18+.54*Ae,ot=.23*Ae}if(T.catchPose){let Ae=T.catchPose;T.phase==="caught"&&(T.catchTime+=v);let me=gl(T.catchTime/.26,0,1),Ut=gl((T.catchTime-.23)/.37,0,1);if(we=Ae.x+.24*Ut,qe=Ae.y+.18*Ut,dt=Ae.z+.08*Ut,ot=Ae.lean*(1-Ut*.6),X.position.copy(Ae.ice).lerp(Ge.set(we,qe+.152,dt),me),Te.copy(Ae.ice).y-=.27*me,Te.x-=.22*me,oe(S,Ne,Te),T.phase==="caught"&&T.catchTime>=.72){T.phase="over";let $e=Math.floor(T.elapsed*10)/10,tn=0;try{tn=Number(localStorage.getItem("scoopBest")||0)}catch{}let yn=Math.max(tn,$e);try{localStorage.setItem("scoopBest",String(yn))}catch{}c(yn),s("over"),$e>tn&&Po("best",!0),console.log("[game] caught",$e,"best",yn)}}lt.rotation.z=ot,$.position.set(we,qe,dt),nt.set(-.31,1.53,.04),lt.localToWorld(nt),Fi.copy(Ve.position).add($.position);let ut=T.phase==="playing"&&(T.attack==="lunge"||K==="lunge");!mi&&(ut||T.phase==="caught")&&vl(Fi),Io.copy(Fi),dn.copy(nt).lerp(Fi,.52),dn.y-=.13,dn.z+=.1,q(wt,nt,dn,Fi),xe>0?(xe-=v,Re.rotation.z=Math.sin(Z*.08)*xe*.04):Re.rotation.z=0,ce=ce.filter(Ae=>(Ae.life-=v,Ae.vy-=6*v,Ae.mesh.position.x+=Ae.vx*v,Ae.mesh.position.y+=Ae.vy*v,Ae.mesh.rotation.z+=v*5,Ae.mesh.position.y<.06&&(Ae.mesh.position.y=.06,Ae.vy=0,Ae.vx*=.8),Ae.life<=0?(g.remove(Ae.mesh),Ae.mesh.geometry.dispose(),!1):!0)),I.render(g,b)}return ws=requestAnimationFrame(Ml),A.gameState=p.current,()=>{cancelAnimationFrame(ws),td(),Yr();let Z=new Set;g.traverse(v=>{var T;(T=v.geometry)==null||T.dispose(),v.material&&Z.add(v.material)});for(let v of Z)v.dispose();he.dispose(),Ue.dispose(),le.dispose(),I.dispose(),A.removeChild(I.domElement),delete A.gameState}},[n]);let u=A=>{if(mi||A.isPrimary===!1||A.button>0||p.current.phase==="over"||p.current.phase==="caught")return;A.currentTarget.setPointerCapture(A.pointerId);let g=p.current;g.drag={id:A.pointerId,x:A.clientX,y:A.clientY,startX:A.clientX,startY:A.clientY,baseX:g.tx||0,baseY:g.ty||0,lastX:A.clientX,lastY:A.clientY,lastT:performance.now(),active:!1}},m=A=>{let g=p.current,b=g.drag;if(!b||b.id!==A.pointerId)return;let I=A.clientX-b.startX,P=A.clientY-b.startY;if(!b.active&&Math.hypot(I,P)<5)return;let N=!1;b.active||(N=!0,b.active=!0,g.phase==="intro"&&(g.phase="playing",g.elapsed=0,g.clock=0,g.attack="wait",s("playing"),console.log("[game] started")));let F=performance.now(),W=Math.hypot(A.clientX-b.lastX,A.clientY-b.lastY),z=Math.max(16,F-b.lastT);g.tx=gl(b.baseX+I*x.current.DRAG_SENSITIVITY,-1.6,1.55),g.ty=gl(b.baseY-P*x.current.DRAG_SENSITIVITY,-1.45,1.05),(N||F-(g.lastSwish||0)>500&&W/z>.8&&W>20)&&(Po("swish"),g.lastSwish=F),b.lastX=A.clientX,b.lastY=A.clientY,b.lastT=F},y=A=>{var b;let g=p.current;((b=g.drag)==null?void 0:b.id)===A.pointerId&&(g.drag=null)},w=()=>{var A;Po("click"),(A=M.current)==null||A.call(M)},R=typeof tt<"u"&&typeof tt.playableRecordingSubmission=="function",E=()=>{_.current||!R||(_.current=!0,f(!0),Po("click"),tt.playableRecordingSubmission({success(){},fail(A){console.error("[post_my_play] playableRecordingSubmission failed",(A==null?void 0:A.errMsg)||(A==null?void 0:A.message)),_.current=!1,f(!1)},complete(){}}))};return(0,Qt.jsxs)("div",{className:"app","data-phase":r,children:[(0,Qt.jsx)("style",{children:`
@font-face {
  font-family: 'Bangers';
  src: url('./assets/fonts/bangers/Bangers-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "Bangers", "PingFang SC", system-ui, sans-serif;
  --font-body:    -apple-system, "Helvetica Neue", "PingFang SC", system-ui, sans-serif;
  --font-mono:    ui-monospace, Menlo, monospace;
}
*{box-sizing:border-box} .app{position:relative;width:100%;height:100%;overflow:clip;background:#f3e3cb;touch-action:none;color:#fff6df;font-family:var(--font-body)} .scene{position:absolute;inset:0;touch-action:none} .scene canvas{display:block;width:100%;height:100%} .guide{position:absolute;top:17%;left:30px;right:30px;text-align:center;pointer-events:none;animation:breathe 2.1s ease-in-out infinite} .guide span{display:inline-block;background:#fff6df;color:#8b3c2d;padding:8px 19px;border-radius:22px;box-shadow:0 4px 0 #b87452,0 7px 16px #7d523733;font-family:var(--font-display);font-size:18px;letter-spacing:.5px} @keyframes breathe{50%{transform:scale(1.05)}} @media(prefers-reduced-motion:reduce){.guide{animation:none}}
 .timer{position:absolute;top:30px;left:50%;transform:translateX(-50%);font:28px var(--font-display);color:#fff9e7;text-shadow:0 2px 0 #8f4d33,1px 3px 5px #69422f;pointer-events:none}.veil{position:absolute;inset:0;background:#3d281d77;display:flex;align-items:center;justify-content:center;padding:24px}.result{text-align:center;color:#5a3026;background:#fff3db;border:4px solid #a75234;border-radius:26px;padding:24px 26px 25px;box-shadow:0 8px 0 #854731,0 14px 40px #3d281d55;min-width:min(300px,100%)}.result h1{font:30px var(--font-display);margin:0;color:#bd4939;letter-spacing:1px}.score{font:38px var(--font-display);margin:8px 0 2px}.best{font:15px var(--font-display);letter-spacing:1px;color:#9e755c}.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:22px}.actions button{min-height:44px;border:0;border-radius:30px;background:#c84737;color:#fff9ec;padding:12px 22px;font:20px var(--font-display);box-shadow:0 4px 0 #8e352c;cursor:pointer;white-space:nowrap}.actions button:active{transform:translateY(3px);box-shadow:0 1px 0 #8e352c}
 `}),(0,Qt.jsx)("div",{className:"scene",ref:h,onPointerDown:u,onPointerMove:m,onPointerUp:y,onPointerCancel:y,onLostPointerCapture:y}),r==="intro"&&(0,Qt.jsx)("div",{className:"guide",children:(0,Qt.jsx)("span",{children:t.GUIDE})}),(r==="playing"||r==="caught")&&(0,Qt.jsxs)("div",{className:"timer","data-testid":"timer",children:[o.toFixed(1),"s"]}),r==="over"&&(0,Qt.jsx)("div",{className:"veil",children:(0,Qt.jsxs)("div",{className:"result",children:[(0,Qt.jsx)("h1",{children:t.CAUGHT}),(0,Qt.jsxs)("div",{className:"score",children:[o.toFixed(1),"s"]}),(0,Qt.jsxs)("div",{className:"best",children:[t.BEST," ",l.toFixed(1),"s"]}),(0,Qt.jsxs)("div",{className:"actions",children:[(0,Qt.jsx)("button",{onClick:w,children:t.AGAIN}),R&&(0,Qt.jsx)("button",{onClick:E,disabled:d,style:{opacity:d?.55:1,pointerEvents:d?"none":"auto"},children:"Post my play"})]})]})})]})}(0,wy.createRoot)(document.getElementById("root")).render((0,Qt.jsx)(PA,{}));})();
