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
(()=>{var ty=Object.create;var bm=Object.defineProperty;var ny=Object.getOwnPropertyDescriptor;var iy=Object.getOwnPropertyNames;var ry=Object.getPrototypeOf,sy=Object.prototype.hasOwnProperty;var Ni=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var oy=(t,e,n,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of iy(e))!sy.call(t,r)&&r!==n&&bm(t,r,{get:()=>e[r],enumerable:!(i=ny(e,r))||i.enumerable});return t};var Qa=(t,e,n)=>(n=t!=null?ty(ry(t)):{},oy(e||!t||!t.__esModule?bm(n,"default",{value:t,enumerable:!0}):n,t));var Bm=Ni(We=>{"use strict";var So=Symbol.for("react.element"),ay=Symbol.for("react.portal"),ly=Symbol.for("react.fragment"),cy=Symbol.for("react.strict_mode"),uy=Symbol.for("react.profiler"),hy=Symbol.for("react.provider"),fy=Symbol.for("react.context"),dy=Symbol.for("react.forward_ref"),py=Symbol.for("react.suspense"),my=Symbol.for("react.memo"),gy=Symbol.for("react.lazy"),Am=Symbol.iterator;function _y(t){return t===null||typeof t!="object"?null:(t=Am&&t[Am]||t["@@iterator"],typeof t=="function"?t:null)}var Pm={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},Im=Object.assign,Lm={};function _s(t,e,n){this.props=t,this.context=e,this.refs=Lm,this.updater=n||Pm}_s.prototype.isReactComponent={};_s.prototype.setState=function(t,e){if(typeof t!="object"&&typeof t!="function"&&t!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,t,e,"setState")};_s.prototype.forceUpdate=function(t){this.updater.enqueueForceUpdate(this,t,"forceUpdate")};function Nm(){}Nm.prototype=_s.prototype;function bh(t,e,n){this.props=t,this.context=e,this.refs=Lm,this.updater=n||Pm}var Ah=bh.prototype=new Nm;Ah.constructor=bh;Im(Ah,_s.prototype);Ah.isPureReactComponent=!0;var Cm=Array.isArray,Dm=Object.prototype.hasOwnProperty,Ch={current:null},Um={key:!0,ref:!0,__self:!0,__source:!0};function Fm(t,e,n){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)Dm.call(e,i)&&!Um.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=n;else if(1<a){for(var l=Array(a),c=0;c<a;c++)l[c]=arguments[c+2];r.children=l}if(t&&t.defaultProps)for(i in a=t.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:So,type:t,key:s,ref:o,props:r,_owner:Ch.current}}function vy(t,e){return{$$typeof:So,type:t.type,key:e,ref:t.ref,props:t.props,_owner:t._owner}}function Rh(t){return typeof t=="object"&&t!==null&&t.$$typeof===So}function xy(t){var e={"=":"=0",":":"=2"};return"$"+t.replace(/[=:]/g,function(n){return e[n]})}var Rm=/\/+/g;function Th(t,e){return typeof t=="object"&&t!==null&&t.key!=null?xy(""+t.key):e.toString(36)}function tl(t,e,n,i,r){var s=typeof t;(s==="undefined"||s==="boolean")&&(t=null);var o=!1;if(t===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(t.$$typeof){case So:case ay:o=!0}}if(o)return o=t,r=r(o),t=i===""?"."+Th(o,0):i,Cm(r)?(n="",t!=null&&(n=t.replace(Rm,"$&/")+"/"),tl(r,e,n,"",function(c){return c})):r!=null&&(Rh(r)&&(r=vy(r,n+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(Rm,"$&/")+"/")+t)),e.push(r)),1;if(o=0,i=i===""?".":i+":",Cm(t))for(var a=0;a<t.length;a++){s=t[a];var l=i+Th(s,a);o+=tl(s,e,n,l,r)}else if(l=_y(t),typeof l=="function")for(t=l.call(t),a=0;!(s=t.next()).done;)s=s.value,l=i+Th(s,a++),o+=tl(s,e,n,l,r);else if(s==="object")throw e=String(t),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function el(t,e,n){if(t==null)return t;var i=[],r=0;return tl(t,i,"","",function(s){return e.call(n,s,r++)}),i}function yy(t){if(t._status===-1){var e=t._result;e=e(),e.then(function(n){(t._status===0||t._status===-1)&&(t._status=1,t._result=n)},function(n){(t._status===0||t._status===-1)&&(t._status=2,t._result=n)}),t._status===-1&&(t._status=0,t._result=e)}if(t._status===1)return t._result.default;throw t._result}var an={current:null},nl={transition:null},Sy={ReactCurrentDispatcher:an,ReactCurrentBatchConfig:nl,ReactCurrentOwner:Ch};function Om(){throw Error("act(...) is not supported in production builds of React.")}We.Children={map:el,forEach:function(t,e,n){el(t,function(){e.apply(this,arguments)},n)},count:function(t){var e=0;return el(t,function(){e++}),e},toArray:function(t){return el(t,function(e){return e})||[]},only:function(t){if(!Rh(t))throw Error("React.Children.only expected to receive a single React element child.");return t}};We.Component=_s;We.Fragment=ly;We.Profiler=uy;We.PureComponent=bh;We.StrictMode=cy;We.Suspense=py;We.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=Sy;We.act=Om;We.cloneElement=function(t,e,n){if(t==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+t+".");var i=Im({},t.props),r=t.key,s=t.ref,o=t._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=Ch.current),e.key!==void 0&&(r=""+e.key),t.type&&t.type.defaultProps)var a=t.type.defaultProps;for(l in e)Dm.call(e,l)&&!Um.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=n;else if(1<l){a=Array(l);for(var c=0;c<l;c++)a[c]=arguments[c+2];i.children=a}return{$$typeof:So,type:t.type,key:r,ref:s,props:i,_owner:o}};We.createContext=function(t){return t={$$typeof:fy,_currentValue:t,_currentValue2:t,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},t.Provider={$$typeof:hy,_context:t},t.Consumer=t};We.createElement=Fm;We.createFactory=function(t){var e=Fm.bind(null,t);return e.type=t,e};We.createRef=function(){return{current:null}};We.forwardRef=function(t){return{$$typeof:dy,render:t}};We.isValidElement=Rh;We.lazy=function(t){return{$$typeof:gy,_payload:{_status:-1,_result:t},_init:yy}};We.memo=function(t,e){return{$$typeof:my,type:t,compare:e===void 0?null:e}};We.startTransition=function(t){var e=nl.transition;nl.transition={};try{t()}finally{nl.transition=e}};We.unstable_act=Om;We.useCallback=function(t,e){return an.current.useCallback(t,e)};We.useContext=function(t){return an.current.useContext(t)};We.useDebugValue=function(){};We.useDeferredValue=function(t){return an.current.useDeferredValue(t)};We.useEffect=function(t,e){return an.current.useEffect(t,e)};We.useId=function(){return an.current.useId()};We.useImperativeHandle=function(t,e,n){return an.current.useImperativeHandle(t,e,n)};We.useInsertionEffect=function(t,e){return an.current.useInsertionEffect(t,e)};We.useLayoutEffect=function(t,e){return an.current.useLayoutEffect(t,e)};We.useMemo=function(t,e){return an.current.useMemo(t,e)};We.useReducer=function(t,e,n){return an.current.useReducer(t,e,n)};We.useRef=function(t){return an.current.useRef(t)};We.useState=function(t){return an.current.useState(t)};We.useSyncExternalStore=function(t,e,n){return an.current.useSyncExternalStore(t,e,n)};We.useTransition=function(){return an.current.useTransition()};We.version="18.3.1"});var il=Ni((aA,km)=>{"use strict";km.exports=Bm()});var $m=Ni(ht=>{"use strict";function Nh(t,e){var n=t.length;t.push(e);e:for(;0<n;){var i=n-1>>>1,r=t[i];if(0<rl(r,e))t[i]=e,t[n]=r,n=i;else break e}}function $n(t){return t.length===0?null:t[0]}function ol(t){if(t.length===0)return null;var e=t[0],n=t.pop();if(n!==e){t[0]=n;e:for(var i=0,r=t.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=t[o],l=o+1,c=t[l];if(0>rl(a,n))l<r&&0>rl(c,a)?(t[i]=c,t[l]=n,i=l):(t[i]=a,t[o]=n,i=o);else if(l<r&&0>rl(c,n))t[i]=c,t[l]=n,i=l;else break e}}return e}function rl(t,e){var n=t.sortIndex-e.sortIndex;return n!==0?n:t.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(zm=performance,ht.unstable_now=function(){return zm.now()}):(Ph=Date,Vm=Ph.now(),ht.unstable_now=function(){return Ph.now()-Vm});var zm,Ph,Vm,fi=[],ir=[],My=1,Bn=null,Jt=3,al=!1,Wr=!1,wo=!1,Wm=typeof setTimeout=="function"?setTimeout:null,Xm=typeof clearTimeout=="function"?clearTimeout:null,Gm=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function Dh(t){for(var e=$n(ir);e!==null;){if(e.callback===null)ol(ir);else if(e.startTime<=t)ol(ir),e.sortIndex=e.expirationTime,Nh(fi,e);else break;e=$n(ir)}}function Uh(t){if(wo=!1,Dh(t),!Wr)if($n(fi)!==null)Wr=!0,Oh(Fh);else{var e=$n(ir);e!==null&&Bh(Uh,e.startTime-t)}}function Fh(t,e){Wr=!1,wo&&(wo=!1,Xm(Eo),Eo=-1),al=!0;var n=Jt;try{for(Dh(e),Bn=$n(fi);Bn!==null&&(!(Bn.expirationTime>e)||t&&!Zm());){var i=Bn.callback;if(typeof i=="function"){Bn.callback=null,Jt=Bn.priorityLevel;var r=i(Bn.expirationTime<=e);e=ht.unstable_now(),typeof r=="function"?Bn.callback=r:Bn===$n(fi)&&ol(fi),Dh(e)}else ol(fi);Bn=$n(fi)}if(Bn!==null)var s=!0;else{var o=$n(ir);o!==null&&Bh(Uh,o.startTime-e),s=!1}return s}finally{Bn=null,Jt=n,al=!1}}var ll=!1,sl=null,Eo=-1,qm=5,Ym=-1;function Zm(){return!(ht.unstable_now()-Ym<qm)}function Ih(){if(sl!==null){var t=ht.unstable_now();Ym=t;var e=!0;try{e=sl(!0,t)}finally{e?Mo():(ll=!1,sl=null)}}else ll=!1}var Mo;typeof Gm=="function"?Mo=function(){Gm(Ih)}:typeof MessageChannel<"u"?(Lh=new MessageChannel,Hm=Lh.port2,Lh.port1.onmessage=Ih,Mo=function(){Hm.postMessage(null)}):Mo=function(){Wm(Ih,0)};var Lh,Hm;function Oh(t){sl=t,ll||(ll=!0,Mo())}function Bh(t,e){Eo=Wm(function(){t(ht.unstable_now())},e)}ht.unstable_IdlePriority=5;ht.unstable_ImmediatePriority=1;ht.unstable_LowPriority=4;ht.unstable_NormalPriority=3;ht.unstable_Profiling=null;ht.unstable_UserBlockingPriority=2;ht.unstable_cancelCallback=function(t){t.callback=null};ht.unstable_continueExecution=function(){Wr||al||(Wr=!0,Oh(Fh))};ht.unstable_forceFrameRate=function(t){0>t||125<t?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):qm=0<t?Math.floor(1e3/t):5};ht.unstable_getCurrentPriorityLevel=function(){return Jt};ht.unstable_getFirstCallbackNode=function(){return $n(fi)};ht.unstable_next=function(t){switch(Jt){case 1:case 2:case 3:var e=3;break;default:e=Jt}var n=Jt;Jt=e;try{return t()}finally{Jt=n}};ht.unstable_pauseExecution=function(){};ht.unstable_requestPaint=function(){};ht.unstable_runWithPriority=function(t,e){switch(t){case 1:case 2:case 3:case 4:case 5:break;default:t=3}var n=Jt;Jt=t;try{return e()}finally{Jt=n}};ht.unstable_scheduleCallback=function(t,e,n){var i=ht.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,t){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=n+r,t={id:My++,callback:e,priorityLevel:t,startTime:n,expirationTime:r,sortIndex:-1},n>i?(t.sortIndex=n,Nh(ir,t),$n(fi)===null&&t===$n(ir)&&(wo?(Xm(Eo),Eo=-1):wo=!0,Bh(Uh,n-i))):(t.sortIndex=r,Nh(fi,t),Wr||al||(Wr=!0,Oh(Fh))),t};ht.unstable_shouldYield=Zm;ht.unstable_wrapCallback=function(t){var e=Jt;return function(){var n=Jt;Jt=e;try{return t.apply(this,arguments)}finally{Jt=n}}}});var Km=Ni((cA,Jm)=>{"use strict";Jm.exports=$m()});var tv=Ni(Cn=>{"use strict";var wy=il(),bn=Km();function ie(t){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+t,n=1;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n]);return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var r0=new Set,qo={};function is(t,e){Bs(t,e),Bs(t+"Capture",e)}function Bs(t,e){for(qo[t]=e,t=0;t<e.length;t++)r0.add(e[t])}var ki=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),lf=Object.prototype.hasOwnProperty,Ey=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,jm={},Qm={};function Ty(t){return lf.call(Qm,t)?!0:lf.call(jm,t)?!1:Ey.test(t)?Qm[t]=!0:(jm[t]=!0,!1)}function by(t,e,n,i){if(n!==null&&n.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:n!==null?!n.acceptsBooleans:(t=t.toLowerCase().slice(0,5),t!=="data-"&&t!=="aria-");default:return!1}}function Ay(t,e,n,i){if(e===null||typeof e>"u"||by(t,e,n,i))return!0;if(i)return!1;if(n!==null)switch(n.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function un(t,e,n,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=n,this.propertyName=t,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var Yt={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t){Yt[t]=new un(t,0,!1,t,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(t){var e=t[0];Yt[e]=new un(e,1,!1,t[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(t){Yt[t]=new un(t,2,!1,t.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(t){Yt[t]=new un(t,2,!1,t,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t){Yt[t]=new un(t,3,!1,t.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(t){Yt[t]=new un(t,3,!0,t,null,!1,!1)});["capture","download"].forEach(function(t){Yt[t]=new un(t,4,!1,t,null,!1,!1)});["cols","rows","size","span"].forEach(function(t){Yt[t]=new un(t,6,!1,t,null,!1,!1)});["rowSpan","start"].forEach(function(t){Yt[t]=new un(t,5,!1,t.toLowerCase(),null,!1,!1)});var ed=/[\-:]([a-z])/g;function td(t){return t[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t){var e=t.replace(ed,td);Yt[e]=new un(e,1,!1,t,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t){var e=t.replace(ed,td);Yt[e]=new un(e,1,!1,t,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(t){var e=t.replace(ed,td);Yt[e]=new un(e,1,!1,t,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(t){Yt[t]=new un(t,1,!1,t.toLowerCase(),null,!1,!1)});Yt.xlinkHref=new un("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(t){Yt[t]=new un(t,1,!1,t.toLowerCase(),null,!0,!0)});function nd(t,e,n,i){var r=Yt.hasOwnProperty(e)?Yt[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(Ay(e,n,r,i)&&(n=null),i||r===null?Ty(e)&&(n===null?t.removeAttribute(e):t.setAttribute(e,""+n)):r.mustUseProperty?t[r.propertyName]=n===null?r.type===3?!1:"":n:(e=r.attributeName,i=r.attributeNamespace,n===null?t.removeAttribute(e):(r=r.type,n=r===3||r===4&&n===!0?"":""+n,i?t.setAttributeNS(i,e,n):t.setAttribute(e,n))))}var Hi=wy.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,cl=Symbol.for("react.element"),ys=Symbol.for("react.portal"),Ss=Symbol.for("react.fragment"),id=Symbol.for("react.strict_mode"),cf=Symbol.for("react.profiler"),s0=Symbol.for("react.provider"),o0=Symbol.for("react.context"),rd=Symbol.for("react.forward_ref"),uf=Symbol.for("react.suspense"),hf=Symbol.for("react.suspense_list"),sd=Symbol.for("react.memo"),sr=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var a0=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var eg=Symbol.iterator;function To(t){return t===null||typeof t!="object"?null:(t=eg&&t[eg]||t["@@iterator"],typeof t=="function"?t:null)}var Mt=Object.assign,kh;function No(t){if(kh===void 0)try{throw Error()}catch(n){var e=n.stack.trim().match(/\n( *(at )?)/);kh=e&&e[1]||""}return`
`+kh+t}var zh=!1;function Vh(t,e){if(!t||zh)return"";zh=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(c){var i=c}Reflect.construct(t,[],e)}else{try{e.call()}catch(c){i=c}t.call(e.prototype)}else{try{throw Error()}catch(c){i=c}t()}}catch(c){if(c&&i&&typeof c.stack=="string"){for(var r=c.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return t.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",t.displayName)),l}while(1<=o&&0<=a);break}}}finally{zh=!1,Error.prepareStackTrace=n}return(t=t?t.displayName||t.name:"")?No(t):""}function Cy(t){switch(t.tag){case 5:return No(t.type);case 16:return No("Lazy");case 13:return No("Suspense");case 19:return No("SuspenseList");case 0:case 2:case 15:return t=Vh(t.type,!1),t;case 11:return t=Vh(t.type.render,!1),t;case 1:return t=Vh(t.type,!0),t;default:return""}}function ff(t){if(t==null)return null;if(typeof t=="function")return t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case Ss:return"Fragment";case ys:return"Portal";case cf:return"Profiler";case id:return"StrictMode";case uf:return"Suspense";case hf:return"SuspenseList"}if(typeof t=="object")switch(t.$$typeof){case o0:return(t.displayName||"Context")+".Consumer";case s0:return(t._context.displayName||"Context")+".Provider";case rd:var e=t.render;return t=t.displayName,t||(t=e.displayName||e.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case sd:return e=t.displayName||null,e!==null?e:ff(t.type)||"Memo";case sr:e=t._payload,t=t._init;try{return ff(t(e))}catch{}}return null}function Ry(t){var e=t.type;switch(t.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return t=e.render,t=t.displayName||t.name||"",e.displayName||(t!==""?"ForwardRef("+t+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return ff(e);case 8:return e===id?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function xr(t){switch(typeof t){case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function l0(t){var e=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function Py(t){var e=l0(t)?"checked":"value",n=Object.getOwnPropertyDescriptor(t.constructor.prototype,e),i=""+t[e];if(!t.hasOwnProperty(e)&&typeof n<"u"&&typeof n.get=="function"&&typeof n.set=="function"){var r=n.get,s=n.set;return Object.defineProperty(t,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(t,e,{enumerable:n.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){t._valueTracker=null,delete t[e]}}}}function ul(t){t._valueTracker||(t._valueTracker=Py(t))}function c0(t){if(!t)return!1;var e=t._valueTracker;if(!e)return!0;var n=e.getValue(),i="";return t&&(i=l0(t)?t.checked?"true":"false":t.value),t=i,t!==n?(e.setValue(t),!0):!1}function Bl(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}function df(t,e){var n=e.checked;return Mt({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??t._wrapperState.initialChecked})}function tg(t,e){var n=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;n=xr(e.value!=null?e.value:n),t._wrapperState={initialChecked:i,initialValue:n,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function u0(t,e){e=e.checked,e!=null&&nd(t,"checked",e,!1)}function pf(t,e){u0(t,e);var n=xr(e.value),i=e.type;if(n!=null)i==="number"?(n===0&&t.value===""||t.value!=n)&&(t.value=""+n):t.value!==""+n&&(t.value=""+n);else if(i==="submit"||i==="reset"){t.removeAttribute("value");return}e.hasOwnProperty("value")?mf(t,e.type,n):e.hasOwnProperty("defaultValue")&&mf(t,e.type,xr(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(t.defaultChecked=!!e.defaultChecked)}function ng(t,e,n){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+t._wrapperState.initialValue,n||e===t.value||(t.value=e),t.defaultValue=e}n=t.name,n!==""&&(t.name=""),t.defaultChecked=!!t._wrapperState.initialChecked,n!==""&&(t.name=n)}function mf(t,e,n){(e!=="number"||Bl(t.ownerDocument)!==t)&&(n==null?t.defaultValue=""+t._wrapperState.initialValue:t.defaultValue!==""+n&&(t.defaultValue=""+n))}var Do=Array.isArray;function Ls(t,e,n,i){if(t=t.options,e){e={};for(var r=0;r<n.length;r++)e["$"+n[r]]=!0;for(n=0;n<t.length;n++)r=e.hasOwnProperty("$"+t[n].value),t[n].selected!==r&&(t[n].selected=r),r&&i&&(t[n].defaultSelected=!0)}else{for(n=""+xr(n),e=null,r=0;r<t.length;r++){if(t[r].value===n){t[r].selected=!0,i&&(t[r].defaultSelected=!0);return}e!==null||t[r].disabled||(e=t[r])}e!==null&&(e.selected=!0)}}function gf(t,e){if(e.dangerouslySetInnerHTML!=null)throw Error(ie(91));return Mt({},e,{value:void 0,defaultValue:void 0,children:""+t._wrapperState.initialValue})}function ig(t,e){var n=e.value;if(n==null){if(n=e.children,e=e.defaultValue,n!=null){if(e!=null)throw Error(ie(92));if(Do(n)){if(1<n.length)throw Error(ie(93));n=n[0]}e=n}e==null&&(e=""),n=e}t._wrapperState={initialValue:xr(n)}}function h0(t,e){var n=xr(e.value),i=xr(e.defaultValue);n!=null&&(n=""+n,n!==t.value&&(t.value=n),e.defaultValue==null&&t.defaultValue!==n&&(t.defaultValue=n)),i!=null&&(t.defaultValue=""+i)}function rg(t){var e=t.textContent;e===t._wrapperState.initialValue&&e!==""&&e!==null&&(t.value=e)}function f0(t){switch(t){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function _f(t,e){return t==null||t==="http://www.w3.org/1999/xhtml"?f0(e):t==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":t}var hl,d0=(function(t){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,n,i,r){MSApp.execUnsafeLocalFunction(function(){return t(e,n,i,r)})}:t})(function(t,e){if(t.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in t)t.innerHTML=e;else{for(hl=hl||document.createElement("div"),hl.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=hl.firstChild;t.firstChild;)t.removeChild(t.firstChild);for(;e.firstChild;)t.appendChild(e.firstChild)}});function Yo(t,e){if(e){var n=t.firstChild;if(n&&n===t.lastChild&&n.nodeType===3){n.nodeValue=e;return}}t.textContent=e}var Oo={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},Iy=["Webkit","ms","Moz","O"];Object.keys(Oo).forEach(function(t){Iy.forEach(function(e){e=e+t.charAt(0).toUpperCase()+t.substring(1),Oo[e]=Oo[t]})});function p0(t,e,n){return e==null||typeof e=="boolean"||e===""?"":n||typeof e!="number"||e===0||Oo.hasOwnProperty(t)&&Oo[t]?(""+e).trim():e+"px"}function m0(t,e){t=t.style;for(var n in e)if(e.hasOwnProperty(n)){var i=n.indexOf("--")===0,r=p0(n,e[n],i);n==="float"&&(n="cssFloat"),i?t.setProperty(n,r):t[n]=r}}var Ly=Mt({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function vf(t,e){if(e){if(Ly[t]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(ie(137,t));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(ie(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(ie(61))}if(e.style!=null&&typeof e.style!="object")throw Error(ie(62))}}function xf(t,e){if(t.indexOf("-")===-1)return typeof e.is=="string";switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var yf=null;function od(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var Sf=null,Ns=null,Ds=null;function sg(t){if(t=ha(t)){if(typeof Sf!="function")throw Error(ie(280));var e=t.stateNode;e&&(e=fc(e),Sf(t.stateNode,t.type,e))}}function g0(t){Ns?Ds?Ds.push(t):Ds=[t]:Ns=t}function _0(){if(Ns){var t=Ns,e=Ds;if(Ds=Ns=null,sg(t),e)for(t=0;t<e.length;t++)sg(e[t])}}function v0(t,e){return t(e)}function x0(){}var Gh=!1;function y0(t,e,n){if(Gh)return t(e,n);Gh=!0;try{return v0(t,e,n)}finally{Gh=!1,(Ns!==null||Ds!==null)&&(x0(),_0())}}function Zo(t,e){var n=t.stateNode;if(n===null)return null;var i=fc(n);if(i===null)return null;n=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(t=t.type,i=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!i;break e;default:t=!1}if(t)return null;if(n&&typeof n!="function")throw Error(ie(231,e,typeof n));return n}var Mf=!1;if(ki)try{vs={},Object.defineProperty(vs,"passive",{get:function(){Mf=!0}}),window.addEventListener("test",vs,vs),window.removeEventListener("test",vs,vs)}catch{Mf=!1}var vs;function Ny(t,e,n,i,r,s,o,a,l){var c=Array.prototype.slice.call(arguments,3);try{e.apply(n,c)}catch(f){this.onError(f)}}var Bo=!1,kl=null,zl=!1,wf=null,Dy={onError:function(t){Bo=!0,kl=t}};function Uy(t,e,n,i,r,s,o,a,l){Bo=!1,kl=null,Ny.apply(Dy,arguments)}function Fy(t,e,n,i,r,s,o,a,l){if(Uy.apply(this,arguments),Bo){if(Bo){var c=kl;Bo=!1,kl=null}else throw Error(ie(198));zl||(zl=!0,wf=c)}}function rs(t){var e=t,n=t;if(t.alternate)for(;e.return;)e=e.return;else{t=e;do e=t,(e.flags&4098)!==0&&(n=e.return),t=e.return;while(t)}return e.tag===3?n:null}function S0(t){if(t.tag===13){var e=t.memoizedState;if(e===null&&(t=t.alternate,t!==null&&(e=t.memoizedState)),e!==null)return e.dehydrated}return null}function og(t){if(rs(t)!==t)throw Error(ie(188))}function Oy(t){var e=t.alternate;if(!e){if(e=rs(t),e===null)throw Error(ie(188));return e!==t?null:t}for(var n=t,i=e;;){var r=n.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){n=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===n)return og(r),t;if(s===i)return og(r),e;s=s.sibling}throw Error(ie(188))}if(n.return!==i.return)n=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===n){o=!0,n=r,i=s;break}if(a===i){o=!0,i=r,n=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===n){o=!0,n=s,i=r;break}if(a===i){o=!0,i=s,n=r;break}a=a.sibling}if(!o)throw Error(ie(189))}}if(n.alternate!==i)throw Error(ie(190))}if(n.tag!==3)throw Error(ie(188));return n.stateNode.current===n?t:e}function M0(t){return t=Oy(t),t!==null?w0(t):null}function w0(t){if(t.tag===5||t.tag===6)return t;for(t=t.child;t!==null;){var e=w0(t);if(e!==null)return e;t=t.sibling}return null}var E0=bn.unstable_scheduleCallback,ag=bn.unstable_cancelCallback,By=bn.unstable_shouldYield,ky=bn.unstable_requestPaint,It=bn.unstable_now,zy=bn.unstable_getCurrentPriorityLevel,ad=bn.unstable_ImmediatePriority,T0=bn.unstable_UserBlockingPriority,Vl=bn.unstable_NormalPriority,Vy=bn.unstable_LowPriority,b0=bn.unstable_IdlePriority,lc=null,gi=null;function Gy(t){if(gi&&typeof gi.onCommitFiberRoot=="function")try{gi.onCommitFiberRoot(lc,t,void 0,(t.current.flags&128)===128)}catch{}}var ei=Math.clz32?Math.clz32:Xy,Hy=Math.log,Wy=Math.LN2;function Xy(t){return t>>>=0,t===0?32:31-(Hy(t)/Wy|0)|0}var fl=64,dl=4194304;function Uo(t){switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return t&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return t}}function Gl(t,e){var n=t.pendingLanes;if(n===0)return 0;var i=0,r=t.suspendedLanes,s=t.pingedLanes,o=n&268435455;if(o!==0){var a=o&~r;a!==0?i=Uo(a):(s&=o,s!==0&&(i=Uo(s)))}else o=n&~r,o!==0?i=Uo(o):s!==0&&(i=Uo(s));if(i===0)return 0;if(e!==0&&e!==i&&(e&r)===0&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if((i&4)!==0&&(i|=n&16),e=t.entangledLanes,e!==0)for(t=t.entanglements,e&=i;0<e;)n=31-ei(e),r=1<<n,i|=t[n],e&=~r;return i}function qy(t,e){switch(t){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function Yy(t,e){for(var n=t.suspendedLanes,i=t.pingedLanes,r=t.expirationTimes,s=t.pendingLanes;0<s;){var o=31-ei(s),a=1<<o,l=r[o];l===-1?((a&n)===0||(a&i)!==0)&&(r[o]=qy(a,e)):l<=e&&(t.expiredLanes|=a),s&=~a}}function Ef(t){return t=t.pendingLanes&-1073741825,t!==0?t:t&1073741824?1073741824:0}function A0(){var t=fl;return fl<<=1,(fl&4194240)===0&&(fl=64),t}function Hh(t){for(var e=[],n=0;31>n;n++)e.push(t);return e}function ca(t,e,n){t.pendingLanes|=e,e!==536870912&&(t.suspendedLanes=0,t.pingedLanes=0),t=t.eventTimes,e=31-ei(e),t[e]=n}function Zy(t,e){var n=t.pendingLanes&~e;t.pendingLanes=e,t.suspendedLanes=0,t.pingedLanes=0,t.expiredLanes&=e,t.mutableReadLanes&=e,t.entangledLanes&=e,e=t.entanglements;var i=t.eventTimes;for(t=t.expirationTimes;0<n;){var r=31-ei(n),s=1<<r;e[r]=0,i[r]=-1,t[r]=-1,n&=~s}}function ld(t,e){var n=t.entangledLanes|=e;for(t=t.entanglements;n;){var i=31-ei(n),r=1<<i;r&e|t[i]&e&&(t[i]|=e),n&=~r}}var nt=0;function C0(t){return t&=-t,1<t?4<t?(t&268435455)!==0?16:536870912:4:1}var R0,cd,P0,I0,L0,Tf=!1,pl=[],hr=null,fr=null,dr=null,$o=new Map,Jo=new Map,ar=[],$y="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function lg(t,e){switch(t){case"focusin":case"focusout":hr=null;break;case"dragenter":case"dragleave":fr=null;break;case"mouseover":case"mouseout":dr=null;break;case"pointerover":case"pointerout":$o.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":Jo.delete(e.pointerId)}}function bo(t,e,n,i,r,s){return t===null||t.nativeEvent!==s?(t={blockedOn:e,domEventName:n,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=ha(e),e!==null&&cd(e)),t):(t.eventSystemFlags|=i,e=t.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),t)}function Jy(t,e,n,i,r){switch(e){case"focusin":return hr=bo(hr,t,e,n,i,r),!0;case"dragenter":return fr=bo(fr,t,e,n,i,r),!0;case"mouseover":return dr=bo(dr,t,e,n,i,r),!0;case"pointerover":var s=r.pointerId;return $o.set(s,bo($o.get(s)||null,t,e,n,i,r)),!0;case"gotpointercapture":return s=r.pointerId,Jo.set(s,bo(Jo.get(s)||null,t,e,n,i,r)),!0}return!1}function N0(t){var e=Yr(t.target);if(e!==null){var n=rs(e);if(n!==null){if(e=n.tag,e===13){if(e=S0(n),e!==null){t.blockedOn=e,L0(t.priority,function(){P0(n)});return}}else if(e===3&&n.stateNode.current.memoizedState.isDehydrated){t.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}t.blockedOn=null}function Cl(t){if(t.blockedOn!==null)return!1;for(var e=t.targetContainers;0<e.length;){var n=bf(t.domEventName,t.eventSystemFlags,e[0],t.nativeEvent);if(n===null){n=t.nativeEvent;var i=new n.constructor(n.type,n);yf=i,n.target.dispatchEvent(i),yf=null}else return e=ha(n),e!==null&&cd(e),t.blockedOn=n,!1;e.shift()}return!0}function cg(t,e,n){Cl(t)&&n.delete(e)}function Ky(){Tf=!1,hr!==null&&Cl(hr)&&(hr=null),fr!==null&&Cl(fr)&&(fr=null),dr!==null&&Cl(dr)&&(dr=null),$o.forEach(cg),Jo.forEach(cg)}function Ao(t,e){t.blockedOn===e&&(t.blockedOn=null,Tf||(Tf=!0,bn.unstable_scheduleCallback(bn.unstable_NormalPriority,Ky)))}function Ko(t){function e(r){return Ao(r,t)}if(0<pl.length){Ao(pl[0],t);for(var n=1;n<pl.length;n++){var i=pl[n];i.blockedOn===t&&(i.blockedOn=null)}}for(hr!==null&&Ao(hr,t),fr!==null&&Ao(fr,t),dr!==null&&Ao(dr,t),$o.forEach(e),Jo.forEach(e),n=0;n<ar.length;n++)i=ar[n],i.blockedOn===t&&(i.blockedOn=null);for(;0<ar.length&&(n=ar[0],n.blockedOn===null);)N0(n),n.blockedOn===null&&ar.shift()}var Us=Hi.ReactCurrentBatchConfig,Hl=!0;function jy(t,e,n,i){var r=nt,s=Us.transition;Us.transition=null;try{nt=1,ud(t,e,n,i)}finally{nt=r,Us.transition=s}}function Qy(t,e,n,i){var r=nt,s=Us.transition;Us.transition=null;try{nt=4,ud(t,e,n,i)}finally{nt=r,Us.transition=s}}function ud(t,e,n,i){if(Hl){var r=bf(t,e,n,i);if(r===null)Jh(t,e,i,Wl,n),lg(t,i);else if(Jy(r,t,e,n,i))i.stopPropagation();else if(lg(t,i),e&4&&-1<$y.indexOf(t)){for(;r!==null;){var s=ha(r);if(s!==null&&R0(s),s=bf(t,e,n,i),s===null&&Jh(t,e,i,Wl,n),s===r)break;r=s}r!==null&&i.stopPropagation()}else Jh(t,e,i,null,n)}}var Wl=null;function bf(t,e,n,i){if(Wl=null,t=od(i),t=Yr(t),t!==null)if(e=rs(t),e===null)t=null;else if(n=e.tag,n===13){if(t=S0(e),t!==null)return t;t=null}else if(n===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;t=null}else e!==t&&(t=null);return Wl=t,null}function D0(t){switch(t){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(zy()){case ad:return 1;case T0:return 4;case Vl:case Vy:return 16;case b0:return 536870912;default:return 16}default:return 16}}var cr=null,hd=null,Rl=null;function U0(){if(Rl)return Rl;var t,e=hd,n=e.length,i,r="value"in cr?cr.value:cr.textContent,s=r.length;for(t=0;t<n&&e[t]===r[t];t++);var o=n-t;for(i=1;i<=o&&e[n-i]===r[s-i];i++);return Rl=r.slice(t,1<i?1-i:void 0)}function Pl(t){var e=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&e===13&&(t=13)):t=e,t===10&&(t=13),32<=t||t===13?t:0}function ml(){return!0}function ug(){return!1}function An(t){function e(n,i,r,s,o){this._reactName=n,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in t)t.hasOwnProperty(a)&&(n=t[a],this[a]=n?n(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?ml:ug,this.isPropagationStopped=ug,this}return Mt(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=ml)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=ml)},persist:function(){},isPersistent:ml}),e}var Xs={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},fd=An(Xs),ua=Mt({},Xs,{view:0,detail:0}),eS=An(ua),Wh,Xh,Co,cc=Mt({},ua,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:dd,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==Co&&(Co&&t.type==="mousemove"?(Wh=t.screenX-Co.screenX,Xh=t.screenY-Co.screenY):Xh=Wh=0,Co=t),Wh)},movementY:function(t){return"movementY"in t?t.movementY:Xh}}),hg=An(cc),tS=Mt({},cc,{dataTransfer:0}),nS=An(tS),iS=Mt({},ua,{relatedTarget:0}),qh=An(iS),rS=Mt({},Xs,{animationName:0,elapsedTime:0,pseudoElement:0}),sS=An(rS),oS=Mt({},Xs,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),aS=An(oS),lS=Mt({},Xs,{data:0}),fg=An(lS),cS={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},uS={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},hS={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function fS(t){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(t):(t=hS[t])?!!e[t]:!1}function dd(){return fS}var dS=Mt({},ua,{key:function(t){if(t.key){var e=cS[t.key]||t.key;if(e!=="Unidentified")return e}return t.type==="keypress"?(t=Pl(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?uS[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:dd,charCode:function(t){return t.type==="keypress"?Pl(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?Pl(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),pS=An(dS),mS=Mt({},cc,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),dg=An(mS),gS=Mt({},ua,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:dd}),_S=An(gS),vS=Mt({},Xs,{propertyName:0,elapsedTime:0,pseudoElement:0}),xS=An(vS),yS=Mt({},cc,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),SS=An(yS),MS=[9,13,27,32],pd=ki&&"CompositionEvent"in window,ko=null;ki&&"documentMode"in document&&(ko=document.documentMode);var wS=ki&&"TextEvent"in window&&!ko,F0=ki&&(!pd||ko&&8<ko&&11>=ko),pg=" ",mg=!1;function O0(t,e){switch(t){case"keyup":return MS.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function B0(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var Ms=!1;function ES(t,e){switch(t){case"compositionend":return B0(e);case"keypress":return e.which!==32?null:(mg=!0,pg);case"textInput":return t=e.data,t===pg&&mg?null:t;default:return null}}function TS(t,e){if(Ms)return t==="compositionend"||!pd&&O0(t,e)?(t=U0(),Rl=hd=cr=null,Ms=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return F0&&e.locale!=="ko"?null:e.data;default:return null}}var bS={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function gg(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e==="input"?!!bS[t.type]:e==="textarea"}function k0(t,e,n,i){g0(i),e=Xl(e,"onChange"),0<e.length&&(n=new fd("onChange","change",null,n,i),t.push({event:n,listeners:e}))}var zo=null,jo=null;function AS(t){J0(t,0)}function uc(t){var e=Ts(t);if(c0(e))return t}function CS(t,e){if(t==="change")return e}var z0=!1;ki&&(ki?(_l="oninput"in document,_l||(Yh=document.createElement("div"),Yh.setAttribute("oninput","return;"),_l=typeof Yh.oninput=="function"),gl=_l):gl=!1,z0=gl&&(!document.documentMode||9<document.documentMode));var gl,_l,Yh;function _g(){zo&&(zo.detachEvent("onpropertychange",V0),jo=zo=null)}function V0(t){if(t.propertyName==="value"&&uc(jo)){var e=[];k0(e,jo,t,od(t)),y0(AS,e)}}function RS(t,e,n){t==="focusin"?(_g(),zo=e,jo=n,zo.attachEvent("onpropertychange",V0)):t==="focusout"&&_g()}function PS(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return uc(jo)}function IS(t,e){if(t==="click")return uc(e)}function LS(t,e){if(t==="input"||t==="change")return uc(e)}function NS(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var ni=typeof Object.is=="function"?Object.is:NS;function Qo(t,e){if(ni(t,e))return!0;if(typeof t!="object"||t===null||typeof e!="object"||e===null)return!1;var n=Object.keys(t),i=Object.keys(e);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var r=n[i];if(!lf.call(e,r)||!ni(t[r],e[r]))return!1}return!0}function vg(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function xg(t,e){var n=vg(t);t=0;for(var i;n;){if(n.nodeType===3){if(i=t+n.textContent.length,t<=e&&i>=e)return{node:n,offset:e-t};t=i}e:{for(;n;){if(n.nextSibling){n=n.nextSibling;break e}n=n.parentNode}n=void 0}n=vg(n)}}function G0(t,e){return t&&e?t===e?!0:t&&t.nodeType===3?!1:e&&e.nodeType===3?G0(t,e.parentNode):"contains"in t?t.contains(e):t.compareDocumentPosition?!!(t.compareDocumentPosition(e)&16):!1:!1}function H0(){for(var t=window,e=Bl();e instanceof t.HTMLIFrameElement;){try{var n=typeof e.contentWindow.location.href=="string"}catch{n=!1}if(n)t=e.contentWindow;else break;e=Bl(t.document)}return e}function md(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e&&(e==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||e==="textarea"||t.contentEditable==="true")}function DS(t){var e=H0(),n=t.focusedElem,i=t.selectionRange;if(e!==n&&n&&n.ownerDocument&&G0(n.ownerDocument.documentElement,n)){if(i!==null&&md(n)){if(e=i.start,t=i.end,t===void 0&&(t=e),"selectionStart"in n)n.selectionStart=e,n.selectionEnd=Math.min(t,n.value.length);else if(t=(e=n.ownerDocument||document)&&e.defaultView||window,t.getSelection){t=t.getSelection();var r=n.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!t.extend&&s>i&&(r=i,i=s,s=r),r=xg(n,s);var o=xg(n,i);r&&o&&(t.rangeCount!==1||t.anchorNode!==r.node||t.anchorOffset!==r.offset||t.focusNode!==o.node||t.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),t.removeAllRanges(),s>i?(t.addRange(e),t.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),t.addRange(e)))}}for(e=[],t=n;t=t.parentNode;)t.nodeType===1&&e.push({element:t,left:t.scrollLeft,top:t.scrollTop});for(typeof n.focus=="function"&&n.focus(),n=0;n<e.length;n++)t=e[n],t.element.scrollLeft=t.left,t.element.scrollTop=t.top}}var US=ki&&"documentMode"in document&&11>=document.documentMode,ws=null,Af=null,Vo=null,Cf=!1;function yg(t,e,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;Cf||ws==null||ws!==Bl(i)||(i=ws,"selectionStart"in i&&md(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),Vo&&Qo(Vo,i)||(Vo=i,i=Xl(Af,"onSelect"),0<i.length&&(e=new fd("onSelect","select",null,e,n),t.push({event:e,listeners:i}),e.target=ws)))}function vl(t,e){var n={};return n[t.toLowerCase()]=e.toLowerCase(),n["Webkit"+t]="webkit"+e,n["Moz"+t]="moz"+e,n}var Es={animationend:vl("Animation","AnimationEnd"),animationiteration:vl("Animation","AnimationIteration"),animationstart:vl("Animation","AnimationStart"),transitionend:vl("Transition","TransitionEnd")},Zh={},W0={};ki&&(W0=document.createElement("div").style,"AnimationEvent"in window||(delete Es.animationend.animation,delete Es.animationiteration.animation,delete Es.animationstart.animation),"TransitionEvent"in window||delete Es.transitionend.transition);function hc(t){if(Zh[t])return Zh[t];if(!Es[t])return t;var e=Es[t],n;for(n in e)if(e.hasOwnProperty(n)&&n in W0)return Zh[t]=e[n];return t}var X0=hc("animationend"),q0=hc("animationiteration"),Y0=hc("animationstart"),Z0=hc("transitionend"),$0=new Map,Sg="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function Sr(t,e){$0.set(t,e),is(e,[t])}for(xl=0;xl<Sg.length;xl++)yl=Sg[xl],Mg=yl.toLowerCase(),wg=yl[0].toUpperCase()+yl.slice(1),Sr(Mg,"on"+wg);var yl,Mg,wg,xl;Sr(X0,"onAnimationEnd");Sr(q0,"onAnimationIteration");Sr(Y0,"onAnimationStart");Sr("dblclick","onDoubleClick");Sr("focusin","onFocus");Sr("focusout","onBlur");Sr(Z0,"onTransitionEnd");Bs("onMouseEnter",["mouseout","mouseover"]);Bs("onMouseLeave",["mouseout","mouseover"]);Bs("onPointerEnter",["pointerout","pointerover"]);Bs("onPointerLeave",["pointerout","pointerover"]);is("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));is("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));is("onBeforeInput",["compositionend","keypress","textInput","paste"]);is("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));is("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));is("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var Fo="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),FS=new Set("cancel close invalid load scroll toggle".split(" ").concat(Fo));function Eg(t,e,n){var i=t.type||"unknown-event";t.currentTarget=n,Fy(i,e,void 0,t),t.currentTarget=null}function J0(t,e){e=(e&4)!==0;for(var n=0;n<t.length;n++){var i=t[n],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,c=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;Eg(r,a,c),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,c=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;Eg(r,a,c),s=l}}}if(zl)throw t=wf,zl=!1,wf=null,t}function pt(t,e){var n=e[Nf];n===void 0&&(n=e[Nf]=new Set);var i=t+"__bubble";n.has(i)||(K0(e,t,2,!1),n.add(i))}function $h(t,e,n){var i=0;e&&(i|=4),K0(n,t,i,e)}var Sl="_reactListening"+Math.random().toString(36).slice(2);function ea(t){if(!t[Sl]){t[Sl]=!0,r0.forEach(function(n){n!=="selectionchange"&&(FS.has(n)||$h(n,!1,t),$h(n,!0,t))});var e=t.nodeType===9?t:t.ownerDocument;e===null||e[Sl]||(e[Sl]=!0,$h("selectionchange",!1,e))}}function K0(t,e,n,i){switch(D0(e)){case 1:var r=jy;break;case 4:r=Qy;break;default:r=ud}n=r.bind(null,e,n,t),r=void 0,!Mf||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?t.addEventListener(e,n,{capture:!0,passive:r}):t.addEventListener(e,n,!0):r!==void 0?t.addEventListener(e,n,{passive:r}):t.addEventListener(e,n,!1)}function Jh(t,e,n,i,r){var s=i;if((e&1)===0&&(e&2)===0&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=Yr(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}y0(function(){var c=s,f=od(n),d=[];e:{var h=$0.get(t);if(h!==void 0){var p=fd,v=t;switch(t){case"keypress":if(Pl(n)===0)break e;case"keydown":case"keyup":p=pS;break;case"focusin":v="focus",p=qh;break;case"focusout":v="blur",p=qh;break;case"beforeblur":case"afterblur":p=qh;break;case"click":if(n.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":p=hg;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":p=nS;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":p=_S;break;case X0:case q0:case Y0:p=sS;break;case Z0:p=xS;break;case"scroll":p=eS;break;case"wheel":p=SS;break;case"copy":case"cut":case"paste":p=aS;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":p=dg}var S=(e&4)!==0,_=!S&&t==="scroll",u=S?h!==null?h+"Capture":null:h;S=[];for(var m=c,x;m!==null;){x=m;var w=x.stateNode;if(x.tag===5&&w!==null&&(x=w,u!==null&&(w=Zo(m,u),w!=null&&S.push(ta(m,w,x)))),_)break;m=m.return}0<S.length&&(h=new p(h,v,null,n,f),d.push({event:h,listeners:S}))}}if((e&7)===0){e:{if(h=t==="mouseover"||t==="pointerover",p=t==="mouseout"||t==="pointerout",h&&n!==yf&&(v=n.relatedTarget||n.fromElement)&&(Yr(v)||v[zi]))break e;if((p||h)&&(h=f.window===f?f:(h=f.ownerDocument)?h.defaultView||h.parentWindow:window,p?(v=n.relatedTarget||n.toElement,p=c,v=v?Yr(v):null,v!==null&&(_=rs(v),v!==_||v.tag!==5&&v.tag!==6)&&(v=null)):(p=null,v=c),p!==v)){if(S=hg,w="onMouseLeave",u="onMouseEnter",m="mouse",(t==="pointerout"||t==="pointerover")&&(S=dg,w="onPointerLeave",u="onPointerEnter",m="pointer"),_=p==null?h:Ts(p),x=v==null?h:Ts(v),h=new S(w,m+"leave",p,n,f),h.target=_,h.relatedTarget=x,w=null,Yr(f)===c&&(S=new S(u,m+"enter",v,n,f),S.target=x,S.relatedTarget=_,w=S),_=w,p&&v)t:{for(S=p,u=v,m=0,x=S;x;x=xs(x))m++;for(x=0,w=u;w;w=xs(w))x++;for(;0<m-x;)S=xs(S),m--;for(;0<x-m;)u=xs(u),x--;for(;m--;){if(S===u||u!==null&&S===u.alternate)break t;S=xs(S),u=xs(u)}S=null}else S=null;p!==null&&Tg(d,h,p,S,!1),v!==null&&_!==null&&Tg(d,_,v,S,!0)}}e:{if(h=c?Ts(c):window,p=h.nodeName&&h.nodeName.toLowerCase(),p==="select"||p==="input"&&h.type==="file")var A=CS;else if(gg(h))if(z0)A=LS;else{A=PS;var E=RS}else(p=h.nodeName)&&p.toLowerCase()==="input"&&(h.type==="checkbox"||h.type==="radio")&&(A=IS);if(A&&(A=A(t,c))){k0(d,A,n,f);break e}E&&E(t,h,c),t==="focusout"&&(E=h._wrapperState)&&E.controlled&&h.type==="number"&&mf(h,"number",h.value)}switch(E=c?Ts(c):window,t){case"focusin":(gg(E)||E.contentEditable==="true")&&(ws=E,Af=c,Vo=null);break;case"focusout":Vo=Af=ws=null;break;case"mousedown":Cf=!0;break;case"contextmenu":case"mouseup":case"dragend":Cf=!1,yg(d,n,f);break;case"selectionchange":if(US)break;case"keydown":case"keyup":yg(d,n,f)}var C;if(pd)e:{switch(t){case"compositionstart":var g="onCompositionStart";break e;case"compositionend":g="onCompositionEnd";break e;case"compositionupdate":g="onCompositionUpdate";break e}g=void 0}else Ms?O0(t,n)&&(g="onCompositionEnd"):t==="keydown"&&n.keyCode===229&&(g="onCompositionStart");g&&(F0&&n.locale!=="ko"&&(Ms||g!=="onCompositionStart"?g==="onCompositionEnd"&&Ms&&(C=U0()):(cr=f,hd="value"in cr?cr.value:cr.textContent,Ms=!0)),E=Xl(c,g),0<E.length&&(g=new fg(g,t,null,n,f),d.push({event:g,listeners:E}),C?g.data=C:(C=B0(n),C!==null&&(g.data=C)))),(C=wS?ES(t,n):TS(t,n))&&(c=Xl(c,"onBeforeInput"),0<c.length&&(f=new fg("onBeforeInput","beforeinput",null,n,f),d.push({event:f,listeners:c}),f.data=C))}J0(d,e)})}function ta(t,e,n){return{instance:t,listener:e,currentTarget:n}}function Xl(t,e){for(var n=e+"Capture",i=[];t!==null;){var r=t,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=Zo(t,n),s!=null&&i.unshift(ta(t,s,r)),s=Zo(t,e),s!=null&&i.push(ta(t,s,r))),t=t.return}return i}function xs(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5);return t||null}function Tg(t,e,n,i,r){for(var s=e._reactName,o=[];n!==null&&n!==i;){var a=n,l=a.alternate,c=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&c!==null&&(a=c,r?(l=Zo(n,s),l!=null&&o.unshift(ta(n,l,a))):r||(l=Zo(n,s),l!=null&&o.push(ta(n,l,a)))),n=n.return}o.length!==0&&t.push({event:e,listeners:o})}var OS=/\r\n?/g,BS=/\u0000|\uFFFD/g;function bg(t){return(typeof t=="string"?t:""+t).replace(OS,`
`).replace(BS,"")}function Ml(t,e,n){if(e=bg(e),bg(t)!==e&&n)throw Error(ie(425))}function ql(){}var Rf=null,Pf=null;function If(t,e){return t==="textarea"||t==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var Lf=typeof setTimeout=="function"?setTimeout:void 0,kS=typeof clearTimeout=="function"?clearTimeout:void 0,Ag=typeof Promise=="function"?Promise:void 0,zS=typeof queueMicrotask=="function"?queueMicrotask:typeof Ag<"u"?function(t){return Ag.resolve(null).then(t).catch(VS)}:Lf;function VS(t){setTimeout(function(){throw t})}function Kh(t,e){var n=e,i=0;do{var r=n.nextSibling;if(t.removeChild(n),r&&r.nodeType===8)if(n=r.data,n==="/$"){if(i===0){t.removeChild(r),Ko(e);return}i--}else n!=="$"&&n!=="$?"&&n!=="$!"||i++;n=r}while(n);Ko(e)}function pr(t){for(;t!=null;t=t.nextSibling){var e=t.nodeType;if(e===1||e===3)break;if(e===8){if(e=t.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return t}function Cg(t){t=t.previousSibling;for(var e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="$"||n==="$!"||n==="$?"){if(e===0)return t;e--}else n==="/$"&&e++}t=t.previousSibling}return null}var qs=Math.random().toString(36).slice(2),mi="__reactFiber$"+qs,na="__reactProps$"+qs,zi="__reactContainer$"+qs,Nf="__reactEvents$"+qs,GS="__reactListeners$"+qs,HS="__reactHandles$"+qs;function Yr(t){var e=t[mi];if(e)return e;for(var n=t.parentNode;n;){if(e=n[zi]||n[mi]){if(n=e.alternate,e.child!==null||n!==null&&n.child!==null)for(t=Cg(t);t!==null;){if(n=t[mi])return n;t=Cg(t)}return e}t=n,n=t.parentNode}return null}function ha(t){return t=t[mi]||t[zi],!t||t.tag!==5&&t.tag!==6&&t.tag!==13&&t.tag!==3?null:t}function Ts(t){if(t.tag===5||t.tag===6)return t.stateNode;throw Error(ie(33))}function fc(t){return t[na]||null}var Df=[],bs=-1;function Mr(t){return{current:t}}function mt(t){0>bs||(t.current=Df[bs],Df[bs]=null,bs--)}function ft(t,e){bs++,Df[bs]=t.current,t.current=e}var yr={},en=Mr(yr),mn=Mr(!1),jr=yr;function ks(t,e){var n=t.type.contextTypes;if(!n)return yr;var i=t.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in n)r[s]=e[s];return i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=e,t.__reactInternalMemoizedMaskedChildContext=r),r}function gn(t){return t=t.childContextTypes,t!=null}function Yl(){mt(mn),mt(en)}function Rg(t,e,n){if(en.current!==yr)throw Error(ie(168));ft(en,e),ft(mn,n)}function j0(t,e,n){var i=t.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return n;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(ie(108,Ry(t)||"Unknown",r));return Mt({},n,i)}function Zl(t){return t=(t=t.stateNode)&&t.__reactInternalMemoizedMergedChildContext||yr,jr=en.current,ft(en,t),ft(mn,mn.current),!0}function Pg(t,e,n){var i=t.stateNode;if(!i)throw Error(ie(169));n?(t=j0(t,e,jr),i.__reactInternalMemoizedMergedChildContext=t,mt(mn),mt(en),ft(en,t)):mt(mn),ft(mn,n)}var Ui=null,dc=!1,jh=!1;function Q0(t){Ui===null?Ui=[t]:Ui.push(t)}function WS(t){dc=!0,Q0(t)}function wr(){if(!jh&&Ui!==null){jh=!0;var t=0,e=nt;try{var n=Ui;for(nt=1;t<n.length;t++){var i=n[t];do i=i(!0);while(i!==null)}Ui=null,dc=!1}catch(r){throw Ui!==null&&(Ui=Ui.slice(t+1)),E0(ad,wr),r}finally{nt=e,jh=!1}}return null}var As=[],Cs=0,$l=null,Jl=0,kn=[],zn=0,Qr=null,Fi=1,Oi="";function Xr(t,e){As[Cs++]=Jl,As[Cs++]=$l,$l=t,Jl=e}function e_(t,e,n){kn[zn++]=Fi,kn[zn++]=Oi,kn[zn++]=Qr,Qr=t;var i=Fi;t=Oi;var r=32-ei(i)-1;i&=~(1<<r),n+=1;var s=32-ei(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,Fi=1<<32-ei(e)+r|n<<r|i,Oi=s+t}else Fi=1<<s|n<<r|i,Oi=t}function gd(t){t.return!==null&&(Xr(t,1),e_(t,1,0))}function _d(t){for(;t===$l;)$l=As[--Cs],As[Cs]=null,Jl=As[--Cs],As[Cs]=null;for(;t===Qr;)Qr=kn[--zn],kn[zn]=null,Oi=kn[--zn],kn[zn]=null,Fi=kn[--zn],kn[zn]=null}var Tn=null,En=null,vt=!1,Qn=null;function t_(t,e){var n=Vn(5,null,null,0);n.elementType="DELETED",n.stateNode=e,n.return=t,e=t.deletions,e===null?(t.deletions=[n],t.flags|=16):e.push(n)}function Ig(t,e){switch(t.tag){case 5:var n=t.type;return e=e.nodeType!==1||n.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(t.stateNode=e,Tn=t,En=pr(e.firstChild),!0):!1;case 6:return e=t.pendingProps===""||e.nodeType!==3?null:e,e!==null?(t.stateNode=e,Tn=t,En=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(n=Qr!==null?{id:Fi,overflow:Oi}:null,t.memoizedState={dehydrated:e,treeContext:n,retryLane:1073741824},n=Vn(18,null,null,0),n.stateNode=e,n.return=t,t.child=n,Tn=t,En=null,!0):!1;default:return!1}}function Uf(t){return(t.mode&1)!==0&&(t.flags&128)===0}function Ff(t){if(vt){var e=En;if(e){var n=e;if(!Ig(t,e)){if(Uf(t))throw Error(ie(418));e=pr(n.nextSibling);var i=Tn;e&&Ig(t,e)?t_(i,n):(t.flags=t.flags&-4097|2,vt=!1,Tn=t)}}else{if(Uf(t))throw Error(ie(418));t.flags=t.flags&-4097|2,vt=!1,Tn=t}}}function Lg(t){for(t=t.return;t!==null&&t.tag!==5&&t.tag!==3&&t.tag!==13;)t=t.return;Tn=t}function wl(t){if(t!==Tn)return!1;if(!vt)return Lg(t),vt=!0,!1;var e;if((e=t.tag!==3)&&!(e=t.tag!==5)&&(e=t.type,e=e!=="head"&&e!=="body"&&!If(t.type,t.memoizedProps)),e&&(e=En)){if(Uf(t))throw n_(),Error(ie(418));for(;e;)t_(t,e),e=pr(e.nextSibling)}if(Lg(t),t.tag===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(ie(317));e:{for(t=t.nextSibling,e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="/$"){if(e===0){En=pr(t.nextSibling);break e}e--}else n!=="$"&&n!=="$!"&&n!=="$?"||e++}t=t.nextSibling}En=null}}else En=Tn?pr(t.stateNode.nextSibling):null;return!0}function n_(){for(var t=En;t;)t=pr(t.nextSibling)}function zs(){En=Tn=null,vt=!1}function vd(t){Qn===null?Qn=[t]:Qn.push(t)}var XS=Hi.ReactCurrentBatchConfig;function Ro(t,e,n){if(t=n.ref,t!==null&&typeof t!="function"&&typeof t!="object"){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(ie(309));var i=n.stateNode}if(!i)throw Error(ie(147,t));var r=i,s=""+t;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof t!="string")throw Error(ie(284));if(!n._owner)throw Error(ie(290,t))}return t}function El(t,e){throw t=Object.prototype.toString.call(e),Error(ie(31,t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t))}function Ng(t){var e=t._init;return e(t._payload)}function i_(t){function e(u,m){if(t){var x=u.deletions;x===null?(u.deletions=[m],u.flags|=16):x.push(m)}}function n(u,m){if(!t)return null;for(;m!==null;)e(u,m),m=m.sibling;return null}function i(u,m){for(u=new Map;m!==null;)m.key!==null?u.set(m.key,m):u.set(m.index,m),m=m.sibling;return u}function r(u,m){return u=vr(u,m),u.index=0,u.sibling=null,u}function s(u,m,x){return u.index=x,t?(x=u.alternate,x!==null?(x=x.index,x<m?(u.flags|=2,m):x):(u.flags|=2,m)):(u.flags|=1048576,m)}function o(u){return t&&u.alternate===null&&(u.flags|=2),u}function a(u,m,x,w){return m===null||m.tag!==6?(m=of(x,u.mode,w),m.return=u,m):(m=r(m,x),m.return=u,m)}function l(u,m,x,w){var A=x.type;return A===Ss?f(u,m,x.props.children,w,x.key):m!==null&&(m.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===sr&&Ng(A)===m.type)?(w=r(m,x.props),w.ref=Ro(u,m,x),w.return=u,w):(w=Ol(x.type,x.key,x.props,null,u.mode,w),w.ref=Ro(u,m,x),w.return=u,w)}function c(u,m,x,w){return m===null||m.tag!==4||m.stateNode.containerInfo!==x.containerInfo||m.stateNode.implementation!==x.implementation?(m=af(x,u.mode,w),m.return=u,m):(m=r(m,x.children||[]),m.return=u,m)}function f(u,m,x,w,A){return m===null||m.tag!==7?(m=Kr(x,u.mode,w,A),m.return=u,m):(m=r(m,x),m.return=u,m)}function d(u,m,x){if(typeof m=="string"&&m!==""||typeof m=="number")return m=of(""+m,u.mode,x),m.return=u,m;if(typeof m=="object"&&m!==null){switch(m.$$typeof){case cl:return x=Ol(m.type,m.key,m.props,null,u.mode,x),x.ref=Ro(u,null,m),x.return=u,x;case ys:return m=af(m,u.mode,x),m.return=u,m;case sr:var w=m._init;return d(u,w(m._payload),x)}if(Do(m)||To(m))return m=Kr(m,u.mode,x,null),m.return=u,m;El(u,m)}return null}function h(u,m,x,w){var A=m!==null?m.key:null;if(typeof x=="string"&&x!==""||typeof x=="number")return A!==null?null:a(u,m,""+x,w);if(typeof x=="object"&&x!==null){switch(x.$$typeof){case cl:return x.key===A?l(u,m,x,w):null;case ys:return x.key===A?c(u,m,x,w):null;case sr:return A=x._init,h(u,m,A(x._payload),w)}if(Do(x)||To(x))return A!==null?null:f(u,m,x,w,null);El(u,x)}return null}function p(u,m,x,w,A){if(typeof w=="string"&&w!==""||typeof w=="number")return u=u.get(x)||null,a(m,u,""+w,A);if(typeof w=="object"&&w!==null){switch(w.$$typeof){case cl:return u=u.get(w.key===null?x:w.key)||null,l(m,u,w,A);case ys:return u=u.get(w.key===null?x:w.key)||null,c(m,u,w,A);case sr:var E=w._init;return p(u,m,x,E(w._payload),A)}if(Do(w)||To(w))return u=u.get(x)||null,f(m,u,w,A,null);El(m,w)}return null}function v(u,m,x,w){for(var A=null,E=null,C=m,g=m=0,T=null;C!==null&&g<x.length;g++){C.index>g?(T=C,C=null):T=C.sibling;var P=h(u,C,x[g],w);if(P===null){C===null&&(C=T);break}t&&C&&P.alternate===null&&e(u,C),m=s(P,m,g),E===null?A=P:E.sibling=P,E=P,C=T}if(g===x.length)return n(u,C),vt&&Xr(u,g),A;if(C===null){for(;g<x.length;g++)C=d(u,x[g],w),C!==null&&(m=s(C,m,g),E===null?A=C:E.sibling=C,E=C);return vt&&Xr(u,g),A}for(C=i(u,C);g<x.length;g++)T=p(C,u,g,x[g],w),T!==null&&(t&&T.alternate!==null&&C.delete(T.key===null?g:T.key),m=s(T,m,g),E===null?A=T:E.sibling=T,E=T);return t&&C.forEach(function(R){return e(u,R)}),vt&&Xr(u,g),A}function S(u,m,x,w){var A=To(x);if(typeof A!="function")throw Error(ie(150));if(x=A.call(x),x==null)throw Error(ie(151));for(var E=A=null,C=m,g=m=0,T=null,P=x.next();C!==null&&!P.done;g++,P=x.next()){C.index>g?(T=C,C=null):T=C.sibling;var R=h(u,C,P.value,w);if(R===null){C===null&&(C=T);break}t&&C&&R.alternate===null&&e(u,C),m=s(R,m,g),E===null?A=R:E.sibling=R,E=R,C=T}if(P.done)return n(u,C),vt&&Xr(u,g),A;if(C===null){for(;!P.done;g++,P=x.next())P=d(u,P.value,w),P!==null&&(m=s(P,m,g),E===null?A=P:E.sibling=P,E=P);return vt&&Xr(u,g),A}for(C=i(u,C);!P.done;g++,P=x.next())P=p(C,u,g,P.value,w),P!==null&&(t&&P.alternate!==null&&C.delete(P.key===null?g:P.key),m=s(P,m,g),E===null?A=P:E.sibling=P,E=P);return t&&C.forEach(function(D){return e(u,D)}),vt&&Xr(u,g),A}function _(u,m,x,w){if(typeof x=="object"&&x!==null&&x.type===Ss&&x.key===null&&(x=x.props.children),typeof x=="object"&&x!==null){switch(x.$$typeof){case cl:e:{for(var A=x.key,E=m;E!==null;){if(E.key===A){if(A=x.type,A===Ss){if(E.tag===7){n(u,E.sibling),m=r(E,x.props.children),m.return=u,u=m;break e}}else if(E.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===sr&&Ng(A)===E.type){n(u,E.sibling),m=r(E,x.props),m.ref=Ro(u,E,x),m.return=u,u=m;break e}n(u,E);break}else e(u,E);E=E.sibling}x.type===Ss?(m=Kr(x.props.children,u.mode,w,x.key),m.return=u,u=m):(w=Ol(x.type,x.key,x.props,null,u.mode,w),w.ref=Ro(u,m,x),w.return=u,u=w)}return o(u);case ys:e:{for(E=x.key;m!==null;){if(m.key===E)if(m.tag===4&&m.stateNode.containerInfo===x.containerInfo&&m.stateNode.implementation===x.implementation){n(u,m.sibling),m=r(m,x.children||[]),m.return=u,u=m;break e}else{n(u,m);break}else e(u,m);m=m.sibling}m=af(x,u.mode,w),m.return=u,u=m}return o(u);case sr:return E=x._init,_(u,m,E(x._payload),w)}if(Do(x))return v(u,m,x,w);if(To(x))return S(u,m,x,w);El(u,x)}return typeof x=="string"&&x!==""||typeof x=="number"?(x=""+x,m!==null&&m.tag===6?(n(u,m.sibling),m=r(m,x),m.return=u,u=m):(n(u,m),m=of(x,u.mode,w),m.return=u,u=m),o(u)):n(u,m)}return _}var Vs=i_(!0),r_=i_(!1),Kl=Mr(null),jl=null,Rs=null,xd=null;function yd(){xd=Rs=jl=null}function Sd(t){var e=Kl.current;mt(Kl),t._currentValue=e}function Of(t,e,n){for(;t!==null;){var i=t.alternate;if((t.childLanes&e)!==e?(t.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),t===n)break;t=t.return}}function Fs(t,e){jl=t,xd=Rs=null,t=t.dependencies,t!==null&&t.firstContext!==null&&((t.lanes&e)!==0&&(pn=!0),t.firstContext=null)}function Hn(t){var e=t._currentValue;if(xd!==t)if(t={context:t,memoizedValue:e,next:null},Rs===null){if(jl===null)throw Error(ie(308));Rs=t,jl.dependencies={lanes:0,firstContext:t}}else Rs=Rs.next=t;return e}var Zr=null;function Md(t){Zr===null?Zr=[t]:Zr.push(t)}function s_(t,e,n,i){var r=e.interleaved;return r===null?(n.next=n,Md(e)):(n.next=r.next,r.next=n),e.interleaved=n,Vi(t,i)}function Vi(t,e){t.lanes|=e;var n=t.alternate;for(n!==null&&(n.lanes|=e),n=t,t=t.return;t!==null;)t.childLanes|=e,n=t.alternate,n!==null&&(n.childLanes|=e),n=t,t=t.return;return n.tag===3?n.stateNode:null}var or=!1;function wd(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function o_(t,e){t=t.updateQueue,e.updateQueue===t&&(e.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,effects:t.effects})}function Bi(t,e){return{eventTime:t,lane:e,tag:0,payload:null,callback:null,next:null}}function mr(t,e,n){var i=t.updateQueue;if(i===null)return null;if(i=i.shared,(Je&2)!==0){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,Vi(t,n)}return r=i.interleaved,r===null?(e.next=e,Md(i)):(e.next=r.next,r.next=e),i.interleaved=e,Vi(t,n)}function Il(t,e,n){if(e=e.updateQueue,e!==null&&(e=e.shared,(n&4194240)!==0)){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,ld(t,n)}}function Dg(t,e){var n=t.updateQueue,i=t.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var r=null,s=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};s===null?r=s=o:s=s.next=o,n=n.next}while(n!==null);s===null?r=s=e:s=s.next=e}else r=s=e;n={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},t.updateQueue=n;return}t=n.lastBaseUpdate,t===null?n.firstBaseUpdate=e:t.next=e,n.lastBaseUpdate=e}function Ql(t,e,n,i){var r=t.updateQueue;or=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,c=l.next;l.next=null,o===null?s=c:o.next=c,o=l;var f=t.alternate;f!==null&&(f=f.updateQueue,a=f.lastBaseUpdate,a!==o&&(a===null?f.firstBaseUpdate=c:a.next=c,f.lastBaseUpdate=l))}if(s!==null){var d=r.baseState;o=0,f=c=l=null,a=s;do{var h=a.lane,p=a.eventTime;if((i&h)===h){f!==null&&(f=f.next={eventTime:p,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var v=t,S=a;switch(h=e,p=n,S.tag){case 1:if(v=S.payload,typeof v=="function"){d=v.call(p,d,h);break e}d=v;break e;case 3:v.flags=v.flags&-65537|128;case 0:if(v=S.payload,h=typeof v=="function"?v.call(p,d,h):v,h==null)break e;d=Mt({},d,h);break e;case 2:or=!0}}a.callback!==null&&a.lane!==0&&(t.flags|=64,h=r.effects,h===null?r.effects=[a]:h.push(a))}else p={eventTime:p,lane:h,tag:a.tag,payload:a.payload,callback:a.callback,next:null},f===null?(c=f=p,l=d):f=f.next=p,o|=h;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;h=a,a=h.next,h.next=null,r.lastBaseUpdate=h,r.shared.pending=null}}while(!0);if(f===null&&(l=d),r.baseState=l,r.firstBaseUpdate=c,r.lastBaseUpdate=f,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);ts|=o,t.lanes=o,t.memoizedState=d}}function Ug(t,e,n){if(t=e.effects,e.effects=null,t!==null)for(e=0;e<t.length;e++){var i=t[e],r=i.callback;if(r!==null){if(i.callback=null,i=n,typeof r!="function")throw Error(ie(191,r));r.call(i)}}}var fa={},_i=Mr(fa),ia=Mr(fa),ra=Mr(fa);function $r(t){if(t===fa)throw Error(ie(174));return t}function Ed(t,e){switch(ft(ra,e),ft(ia,t),ft(_i,fa),t=e.nodeType,t){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:_f(null,"");break;default:t=t===8?e.parentNode:e,e=t.namespaceURI||null,t=t.tagName,e=_f(e,t)}mt(_i),ft(_i,e)}function Gs(){mt(_i),mt(ia),mt(ra)}function a_(t){$r(ra.current);var e=$r(_i.current),n=_f(e,t.type);e!==n&&(ft(ia,t),ft(_i,n))}function Td(t){ia.current===t&&(mt(_i),mt(ia))}var yt=Mr(0);function ec(t){for(var e=t;e!==null;){if(e.tag===13){var n=e.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data==="$?"||n.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if((e.flags&128)!==0)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var Qh=[];function bd(){for(var t=0;t<Qh.length;t++)Qh[t]._workInProgressVersionPrimary=null;Qh.length=0}var Ll=Hi.ReactCurrentDispatcher,ef=Hi.ReactCurrentBatchConfig,es=0,St=null,Ut=null,kt=null,tc=!1,Go=!1,sa=0,qS=0;function Kt(){throw Error(ie(321))}function Ad(t,e){if(e===null)return!1;for(var n=0;n<e.length&&n<t.length;n++)if(!ni(t[n],e[n]))return!1;return!0}function Cd(t,e,n,i,r,s){if(es=s,St=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,Ll.current=t===null||t.memoizedState===null?JS:KS,t=n(i,r),Go){s=0;do{if(Go=!1,sa=0,25<=s)throw Error(ie(301));s+=1,kt=Ut=null,e.updateQueue=null,Ll.current=jS,t=n(i,r)}while(Go)}if(Ll.current=nc,e=Ut!==null&&Ut.next!==null,es=0,kt=Ut=St=null,tc=!1,e)throw Error(ie(300));return t}function Rd(){var t=sa!==0;return sa=0,t}function pi(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return kt===null?St.memoizedState=kt=t:kt=kt.next=t,kt}function Wn(){if(Ut===null){var t=St.alternate;t=t!==null?t.memoizedState:null}else t=Ut.next;var e=kt===null?St.memoizedState:kt.next;if(e!==null)kt=e,Ut=t;else{if(t===null)throw Error(ie(310));Ut=t,t={memoizedState:Ut.memoizedState,baseState:Ut.baseState,baseQueue:Ut.baseQueue,queue:Ut.queue,next:null},kt===null?St.memoizedState=kt=t:kt=kt.next=t}return kt}function oa(t,e){return typeof e=="function"?e(t):e}function tf(t){var e=Wn(),n=e.queue;if(n===null)throw Error(ie(311));n.lastRenderedReducer=t;var i=Ut,r=i.baseQueue,s=n.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,n.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,c=s;do{var f=c.lane;if((es&f)===f)l!==null&&(l=l.next={lane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),i=c.hasEagerState?c.eagerState:t(i,c.action);else{var d={lane:f,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null};l===null?(a=l=d,o=i):l=l.next=d,St.lanes|=f,ts|=f}c=c.next}while(c!==null&&c!==s);l===null?o=i:l.next=a,ni(i,e.memoizedState)||(pn=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,n.lastRenderedState=i}if(t=n.interleaved,t!==null){r=t;do s=r.lane,St.lanes|=s,ts|=s,r=r.next;while(r!==t)}else r===null&&(n.lanes=0);return[e.memoizedState,n.dispatch]}function nf(t){var e=Wn(),n=e.queue;if(n===null)throw Error(ie(311));n.lastRenderedReducer=t;var i=n.dispatch,r=n.pending,s=e.memoizedState;if(r!==null){n.pending=null;var o=r=r.next;do s=t(s,o.action),o=o.next;while(o!==r);ni(s,e.memoizedState)||(pn=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),n.lastRenderedState=s}return[s,i]}function l_(){}function c_(t,e){var n=St,i=Wn(),r=e(),s=!ni(i.memoizedState,r);if(s&&(i.memoizedState=r,pn=!0),i=i.queue,Pd(f_.bind(null,n,i,t),[t]),i.getSnapshot!==e||s||kt!==null&&kt.memoizedState.tag&1){if(n.flags|=2048,aa(9,h_.bind(null,n,i,r,e),void 0,null),zt===null)throw Error(ie(349));(es&30)!==0||u_(n,e,r)}return r}function u_(t,e,n){t.flags|=16384,t={getSnapshot:e,value:n},e=St.updateQueue,e===null?(e={lastEffect:null,stores:null},St.updateQueue=e,e.stores=[t]):(n=e.stores,n===null?e.stores=[t]:n.push(t))}function h_(t,e,n,i){e.value=n,e.getSnapshot=i,d_(e)&&p_(t)}function f_(t,e,n){return n(function(){d_(e)&&p_(t)})}function d_(t){var e=t.getSnapshot;t=t.value;try{var n=e();return!ni(t,n)}catch{return!0}}function p_(t){var e=Vi(t,1);e!==null&&ti(e,t,1,-1)}function Fg(t){var e=pi();return typeof t=="function"&&(t=t()),e.memoizedState=e.baseState=t,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:oa,lastRenderedState:t},e.queue=t,t=t.dispatch=$S.bind(null,St,t),[e.memoizedState,t]}function aa(t,e,n,i){return t={tag:t,create:e,destroy:n,deps:i,next:null},e=St.updateQueue,e===null?(e={lastEffect:null,stores:null},St.updateQueue=e,e.lastEffect=t.next=t):(n=e.lastEffect,n===null?e.lastEffect=t.next=t:(i=n.next,n.next=t,t.next=i,e.lastEffect=t)),t}function m_(){return Wn().memoizedState}function Nl(t,e,n,i){var r=pi();St.flags|=t,r.memoizedState=aa(1|e,n,void 0,i===void 0?null:i)}function pc(t,e,n,i){var r=Wn();i=i===void 0?null:i;var s=void 0;if(Ut!==null){var o=Ut.memoizedState;if(s=o.destroy,i!==null&&Ad(i,o.deps)){r.memoizedState=aa(e,n,s,i);return}}St.flags|=t,r.memoizedState=aa(1|e,n,s,i)}function Og(t,e){return Nl(8390656,8,t,e)}function Pd(t,e){return pc(2048,8,t,e)}function g_(t,e){return pc(4,2,t,e)}function __(t,e){return pc(4,4,t,e)}function v_(t,e){if(typeof e=="function")return t=t(),e(t),function(){e(null)};if(e!=null)return t=t(),e.current=t,function(){e.current=null}}function x_(t,e,n){return n=n!=null?n.concat([t]):null,pc(4,4,v_.bind(null,e,t),n)}function Id(){}function y_(t,e){var n=Wn();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&Ad(e,i[1])?i[0]:(n.memoizedState=[t,e],t)}function S_(t,e){var n=Wn();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&Ad(e,i[1])?i[0]:(t=t(),n.memoizedState=[t,e],t)}function M_(t,e,n){return(es&21)===0?(t.baseState&&(t.baseState=!1,pn=!0),t.memoizedState=n):(ni(n,e)||(n=A0(),St.lanes|=n,ts|=n,t.baseState=!0),e)}function YS(t,e){var n=nt;nt=n!==0&&4>n?n:4,t(!0);var i=ef.transition;ef.transition={};try{t(!1),e()}finally{nt=n,ef.transition=i}}function w_(){return Wn().memoizedState}function ZS(t,e,n){var i=_r(t);if(n={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null},E_(t))T_(e,n);else if(n=s_(t,e,n,i),n!==null){var r=cn();ti(n,t,i,r),b_(n,e,i)}}function $S(t,e,n){var i=_r(t),r={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null};if(E_(t))T_(e,r);else{var s=t.alternate;if(t.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,n);if(r.hasEagerState=!0,r.eagerState=a,ni(a,o)){var l=e.interleaved;l===null?(r.next=r,Md(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}n=s_(t,e,r,i),n!==null&&(r=cn(),ti(n,t,i,r),b_(n,e,i))}}function E_(t){var e=t.alternate;return t===St||e!==null&&e===St}function T_(t,e){Go=tc=!0;var n=t.pending;n===null?e.next=e:(e.next=n.next,n.next=e),t.pending=e}function b_(t,e,n){if((n&4194240)!==0){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,ld(t,n)}}var nc={readContext:Hn,useCallback:Kt,useContext:Kt,useEffect:Kt,useImperativeHandle:Kt,useInsertionEffect:Kt,useLayoutEffect:Kt,useMemo:Kt,useReducer:Kt,useRef:Kt,useState:Kt,useDebugValue:Kt,useDeferredValue:Kt,useTransition:Kt,useMutableSource:Kt,useSyncExternalStore:Kt,useId:Kt,unstable_isNewReconciler:!1},JS={readContext:Hn,useCallback:function(t,e){return pi().memoizedState=[t,e===void 0?null:e],t},useContext:Hn,useEffect:Og,useImperativeHandle:function(t,e,n){return n=n!=null?n.concat([t]):null,Nl(4194308,4,v_.bind(null,e,t),n)},useLayoutEffect:function(t,e){return Nl(4194308,4,t,e)},useInsertionEffect:function(t,e){return Nl(4,2,t,e)},useMemo:function(t,e){var n=pi();return e=e===void 0?null:e,t=t(),n.memoizedState=[t,e],t},useReducer:function(t,e,n){var i=pi();return e=n!==void 0?n(e):e,i.memoizedState=i.baseState=e,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:e},i.queue=t,t=t.dispatch=ZS.bind(null,St,t),[i.memoizedState,t]},useRef:function(t){var e=pi();return t={current:t},e.memoizedState=t},useState:Fg,useDebugValue:Id,useDeferredValue:function(t){return pi().memoizedState=t},useTransition:function(){var t=Fg(!1),e=t[0];return t=YS.bind(null,t[1]),pi().memoizedState=t,[e,t]},useMutableSource:function(){},useSyncExternalStore:function(t,e,n){var i=St,r=pi();if(vt){if(n===void 0)throw Error(ie(407));n=n()}else{if(n=e(),zt===null)throw Error(ie(349));(es&30)!==0||u_(i,e,n)}r.memoizedState=n;var s={value:n,getSnapshot:e};return r.queue=s,Og(f_.bind(null,i,s,t),[t]),i.flags|=2048,aa(9,h_.bind(null,i,s,n,e),void 0,null),n},useId:function(){var t=pi(),e=zt.identifierPrefix;if(vt){var n=Oi,i=Fi;n=(i&~(1<<32-ei(i)-1)).toString(32)+n,e=":"+e+"R"+n,n=sa++,0<n&&(e+="H"+n.toString(32)),e+=":"}else n=qS++,e=":"+e+"r"+n.toString(32)+":";return t.memoizedState=e},unstable_isNewReconciler:!1},KS={readContext:Hn,useCallback:y_,useContext:Hn,useEffect:Pd,useImperativeHandle:x_,useInsertionEffect:g_,useLayoutEffect:__,useMemo:S_,useReducer:tf,useRef:m_,useState:function(){return tf(oa)},useDebugValue:Id,useDeferredValue:function(t){var e=Wn();return M_(e,Ut.memoizedState,t)},useTransition:function(){var t=tf(oa)[0],e=Wn().memoizedState;return[t,e]},useMutableSource:l_,useSyncExternalStore:c_,useId:w_,unstable_isNewReconciler:!1},jS={readContext:Hn,useCallback:y_,useContext:Hn,useEffect:Pd,useImperativeHandle:x_,useInsertionEffect:g_,useLayoutEffect:__,useMemo:S_,useReducer:nf,useRef:m_,useState:function(){return nf(oa)},useDebugValue:Id,useDeferredValue:function(t){var e=Wn();return Ut===null?e.memoizedState=t:M_(e,Ut.memoizedState,t)},useTransition:function(){var t=nf(oa)[0],e=Wn().memoizedState;return[t,e]},useMutableSource:l_,useSyncExternalStore:c_,useId:w_,unstable_isNewReconciler:!1};function Kn(t,e){if(t&&t.defaultProps){e=Mt({},e),t=t.defaultProps;for(var n in t)e[n]===void 0&&(e[n]=t[n]);return e}return e}function Bf(t,e,n,i){e=t.memoizedState,n=n(i,e),n=n==null?e:Mt({},e,n),t.memoizedState=n,t.lanes===0&&(t.updateQueue.baseState=n)}var mc={isMounted:function(t){return(t=t._reactInternals)?rs(t)===t:!1},enqueueSetState:function(t,e,n){t=t._reactInternals;var i=cn(),r=_r(t),s=Bi(i,r);s.payload=e,n!=null&&(s.callback=n),e=mr(t,s,r),e!==null&&(ti(e,t,r,i),Il(e,t,r))},enqueueReplaceState:function(t,e,n){t=t._reactInternals;var i=cn(),r=_r(t),s=Bi(i,r);s.tag=1,s.payload=e,n!=null&&(s.callback=n),e=mr(t,s,r),e!==null&&(ti(e,t,r,i),Il(e,t,r))},enqueueForceUpdate:function(t,e){t=t._reactInternals;var n=cn(),i=_r(t),r=Bi(n,i);r.tag=2,e!=null&&(r.callback=e),e=mr(t,r,i),e!==null&&(ti(e,t,i,n),Il(e,t,i))}};function Bg(t,e,n,i,r,s,o){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!Qo(n,i)||!Qo(r,s):!0}function A_(t,e,n){var i=!1,r=yr,s=e.contextType;return typeof s=="object"&&s!==null?s=Hn(s):(r=gn(e)?jr:en.current,i=e.contextTypes,s=(i=i!=null)?ks(t,r):yr),e=new e(n,s),t.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=mc,t.stateNode=e,e._reactInternals=t,i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=r,t.__reactInternalMemoizedMaskedChildContext=s),e}function kg(t,e,n,i){t=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(n,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(n,i),e.state!==t&&mc.enqueueReplaceState(e,e.state,null)}function kf(t,e,n,i){var r=t.stateNode;r.props=n,r.state=t.memoizedState,r.refs={},wd(t);var s=e.contextType;typeof s=="object"&&s!==null?r.context=Hn(s):(s=gn(e)?jr:en.current,r.context=ks(t,s)),r.state=t.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(Bf(t,e,s,n),r.state=t.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&mc.enqueueReplaceState(r,r.state,null),Ql(t,n,r,i),r.state=t.memoizedState),typeof r.componentDidMount=="function"&&(t.flags|=4194308)}function Hs(t,e){try{var n="",i=e;do n+=Cy(i),i=i.return;while(i);var r=n}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:t,source:e,stack:r,digest:null}}function rf(t,e,n){return{value:t,source:null,stack:n??null,digest:e??null}}function zf(t,e){try{console.error(e.value)}catch(n){setTimeout(function(){throw n})}}var QS=typeof WeakMap=="function"?WeakMap:Map;function C_(t,e,n){n=Bi(-1,n),n.tag=3,n.payload={element:null};var i=e.value;return n.callback=function(){rc||(rc=!0,Jf=i),zf(t,e)},n}function R_(t,e,n){n=Bi(-1,n),n.tag=3;var i=t.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;n.payload=function(){return i(r)},n.callback=function(){zf(t,e)}}var s=t.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(n.callback=function(){zf(t,e),typeof i!="function"&&(gr===null?gr=new Set([this]):gr.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),n}function zg(t,e,n){var i=t.pingCache;if(i===null){i=t.pingCache=new QS;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(n)||(r.add(n),t=dM.bind(null,t,e,n),e.then(t,t))}function Vg(t){do{var e;if((e=t.tag===13)&&(e=t.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return t;t=t.return}while(t!==null);return null}function Gg(t,e,n,i,r){return(t.mode&1)===0?(t===e?t.flags|=65536:(t.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(e=Bi(-1,1),e.tag=2,mr(n,e,1))),n.lanes|=1),t):(t.flags|=65536,t.lanes=r,t)}var eM=Hi.ReactCurrentOwner,pn=!1;function ln(t,e,n,i){e.child=t===null?r_(e,null,n,i):Vs(e,t.child,n,i)}function Hg(t,e,n,i,r){n=n.render;var s=e.ref;return Fs(e,r),i=Cd(t,e,n,i,s,r),n=Rd(),t!==null&&!pn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,Gi(t,e,r)):(vt&&n&&gd(e),e.flags|=1,ln(t,e,i,r),e.child)}function Wg(t,e,n,i,r){if(t===null){var s=n.type;return typeof s=="function"&&!kd(s)&&s.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(e.tag=15,e.type=s,P_(t,e,s,i,r)):(t=Ol(n.type,null,i,e,e.mode,r),t.ref=e.ref,t.return=e,e.child=t)}if(s=t.child,(t.lanes&r)===0){var o=s.memoizedProps;if(n=n.compare,n=n!==null?n:Qo,n(o,i)&&t.ref===e.ref)return Gi(t,e,r)}return e.flags|=1,t=vr(s,i),t.ref=e.ref,t.return=e,e.child=t}function P_(t,e,n,i,r){if(t!==null){var s=t.memoizedProps;if(Qo(s,i)&&t.ref===e.ref)if(pn=!1,e.pendingProps=i=s,(t.lanes&r)!==0)(t.flags&131072)!==0&&(pn=!0);else return e.lanes=t.lanes,Gi(t,e,r)}return Vf(t,e,n,i,r)}function I_(t,e,n){var i=e.pendingProps,r=i.children,s=t!==null?t.memoizedState:null;if(i.mode==="hidden")if((e.mode&1)===0)e.memoizedState={baseLanes:0,cachePool:null,transitions:null},ft(Is,wn),wn|=n;else{if((n&1073741824)===0)return t=s!==null?s.baseLanes|n:n,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:t,cachePool:null,transitions:null},e.updateQueue=null,ft(Is,wn),wn|=t,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:n,ft(Is,wn),wn|=i}else s!==null?(i=s.baseLanes|n,e.memoizedState=null):i=n,ft(Is,wn),wn|=i;return ln(t,e,r,n),e.child}function L_(t,e){var n=e.ref;(t===null&&n!==null||t!==null&&t.ref!==n)&&(e.flags|=512,e.flags|=2097152)}function Vf(t,e,n,i,r){var s=gn(n)?jr:en.current;return s=ks(e,s),Fs(e,r),n=Cd(t,e,n,i,s,r),i=Rd(),t!==null&&!pn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,Gi(t,e,r)):(vt&&i&&gd(e),e.flags|=1,ln(t,e,n,r),e.child)}function Xg(t,e,n,i,r){if(gn(n)){var s=!0;Zl(e)}else s=!1;if(Fs(e,r),e.stateNode===null)Dl(t,e),A_(e,n,i),kf(e,n,i,r),i=!0;else if(t===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,c=n.contextType;typeof c=="object"&&c!==null?c=Hn(c):(c=gn(n)?jr:en.current,c=ks(e,c));var f=n.getDerivedStateFromProps,d=typeof f=="function"||typeof o.getSnapshotBeforeUpdate=="function";d||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==c)&&kg(e,o,i,c),or=!1;var h=e.memoizedState;o.state=h,Ql(e,i,o,r),l=e.memoizedState,a!==i||h!==l||mn.current||or?(typeof f=="function"&&(Bf(e,n,f,i),l=e.memoizedState),(a=or||Bg(e,n,a,i,h,l,c))?(d||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=c,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,o_(t,e),a=e.memoizedProps,c=e.type===e.elementType?a:Kn(e.type,a),o.props=c,d=e.pendingProps,h=o.context,l=n.contextType,typeof l=="object"&&l!==null?l=Hn(l):(l=gn(n)?jr:en.current,l=ks(e,l));var p=n.getDerivedStateFromProps;(f=typeof p=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==d||h!==l)&&kg(e,o,i,l),or=!1,h=e.memoizedState,o.state=h,Ql(e,i,o,r);var v=e.memoizedState;a!==d||h!==v||mn.current||or?(typeof p=="function"&&(Bf(e,n,p,i),v=e.memoizedState),(c=or||Bg(e,n,c,i,h,v,l)||!1)?(f||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,v,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,v,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=v),o.props=i,o.state=v,o.context=l,i=c):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),i=!1)}return Gf(t,e,n,i,s,r)}function Gf(t,e,n,i,r,s){L_(t,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&Pg(e,n,!1),Gi(t,e,s);i=e.stateNode,eM.current=e;var a=o&&typeof n.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,t!==null&&o?(e.child=Vs(e,t.child,null,s),e.child=Vs(e,null,a,s)):ln(t,e,a,s),e.memoizedState=i.state,r&&Pg(e,n,!0),e.child}function N_(t){var e=t.stateNode;e.pendingContext?Rg(t,e.pendingContext,e.pendingContext!==e.context):e.context&&Rg(t,e.context,!1),Ed(t,e.containerInfo)}function qg(t,e,n,i,r){return zs(),vd(r),e.flags|=256,ln(t,e,n,i),e.child}var Hf={dehydrated:null,treeContext:null,retryLane:0};function Wf(t){return{baseLanes:t,cachePool:null,transitions:null}}function D_(t,e,n){var i=e.pendingProps,r=yt.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=t!==null&&t.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(t===null||t.memoizedState!==null)&&(r|=1),ft(yt,r&1),t===null)return Ff(e),t=e.memoizedState,t!==null&&(t=t.dehydrated,t!==null)?((e.mode&1)===0?e.lanes=1:t.data==="$!"?e.lanes=8:e.lanes=1073741824,null):(o=i.children,t=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},(i&1)===0&&s!==null?(s.childLanes=0,s.pendingProps=o):s=vc(o,i,0,null),t=Kr(t,i,n,null),s.return=e,t.return=e,s.sibling=t,e.child=s,e.child.memoizedState=Wf(n),e.memoizedState=Hf,t):Ld(e,o));if(r=t.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return tM(t,e,o,i,a,r,n);if(s){s=i.fallback,o=e.mode,r=t.child,a=r.sibling;var l={mode:"hidden",children:i.children};return(o&1)===0&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=vr(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=vr(a,s):(s=Kr(s,o,n,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=t.child.memoizedState,o=o===null?Wf(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=t.childLanes&~n,e.memoizedState=Hf,i}return s=t.child,t=s.sibling,i=vr(s,{mode:"visible",children:i.children}),(e.mode&1)===0&&(i.lanes=n),i.return=e,i.sibling=null,t!==null&&(n=e.deletions,n===null?(e.deletions=[t],e.flags|=16):n.push(t)),e.child=i,e.memoizedState=null,i}function Ld(t,e){return e=vc({mode:"visible",children:e},t.mode,0,null),e.return=t,t.child=e}function Tl(t,e,n,i){return i!==null&&vd(i),Vs(e,t.child,null,n),t=Ld(e,e.pendingProps.children),t.flags|=2,e.memoizedState=null,t}function tM(t,e,n,i,r,s,o){if(n)return e.flags&256?(e.flags&=-257,i=rf(Error(ie(422))),Tl(t,e,o,i)):e.memoizedState!==null?(e.child=t.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=vc({mode:"visible",children:i.children},r,0,null),s=Kr(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,(e.mode&1)!==0&&Vs(e,t.child,null,o),e.child.memoizedState=Wf(o),e.memoizedState=Hf,s);if((e.mode&1)===0)return Tl(t,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(ie(419)),i=rf(s,i,void 0),Tl(t,e,o,i)}if(a=(o&t.childLanes)!==0,pn||a){if(i=zt,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=(r&(i.suspendedLanes|o))!==0?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,Vi(t,r),ti(i,t,r,-1))}return Bd(),i=rf(Error(ie(421))),Tl(t,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=t.child,e=pM.bind(null,t),r._reactRetry=e,null):(t=s.treeContext,En=pr(r.nextSibling),Tn=e,vt=!0,Qn=null,t!==null&&(kn[zn++]=Fi,kn[zn++]=Oi,kn[zn++]=Qr,Fi=t.id,Oi=t.overflow,Qr=e),e=Ld(e,i.children),e.flags|=4096,e)}function Yg(t,e,n){t.lanes|=e;var i=t.alternate;i!==null&&(i.lanes|=e),Of(t.return,e,n)}function sf(t,e,n,i,r){var s=t.memoizedState;s===null?t.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=n,s.tailMode=r)}function U_(t,e,n){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(ln(t,e,i.children,n),i=yt.current,(i&2)!==0)i=i&1|2,e.flags|=128;else{if(t!==null&&(t.flags&128)!==0)e:for(t=e.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&Yg(t,n,e);else if(t.tag===19)Yg(t,n,e);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break e;for(;t.sibling===null;){if(t.return===null||t.return===e)break e;t=t.return}t.sibling.return=t.return,t=t.sibling}i&=1}if(ft(yt,i),(e.mode&1)===0)e.memoizedState=null;else switch(r){case"forwards":for(n=e.child,r=null;n!==null;)t=n.alternate,t!==null&&ec(t)===null&&(r=n),n=n.sibling;n=r,n===null?(r=e.child,e.child=null):(r=n.sibling,n.sibling=null),sf(e,!1,r,n,s);break;case"backwards":for(n=null,r=e.child,e.child=null;r!==null;){if(t=r.alternate,t!==null&&ec(t)===null){e.child=r;break}t=r.sibling,r.sibling=n,n=r,r=t}sf(e,!0,n,null,s);break;case"together":sf(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function Dl(t,e){(e.mode&1)===0&&t!==null&&(t.alternate=null,e.alternate=null,e.flags|=2)}function Gi(t,e,n){if(t!==null&&(e.dependencies=t.dependencies),ts|=e.lanes,(n&e.childLanes)===0)return null;if(t!==null&&e.child!==t.child)throw Error(ie(153));if(e.child!==null){for(t=e.child,n=vr(t,t.pendingProps),e.child=n,n.return=e;t.sibling!==null;)t=t.sibling,n=n.sibling=vr(t,t.pendingProps),n.return=e;n.sibling=null}return e.child}function nM(t,e,n){switch(e.tag){case 3:N_(e),zs();break;case 5:a_(e);break;case 1:gn(e.type)&&Zl(e);break;case 4:Ed(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;ft(Kl,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(ft(yt,yt.current&1),e.flags|=128,null):(n&e.child.childLanes)!==0?D_(t,e,n):(ft(yt,yt.current&1),t=Gi(t,e,n),t!==null?t.sibling:null);ft(yt,yt.current&1);break;case 19:if(i=(n&e.childLanes)!==0,(t.flags&128)!==0){if(i)return U_(t,e,n);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),ft(yt,yt.current),i)break;return null;case 22:case 23:return e.lanes=0,I_(t,e,n)}return Gi(t,e,n)}var F_,Xf,O_,B_;F_=function(t,e){for(var n=e.child;n!==null;){if(n.tag===5||n.tag===6)t.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return;n=n.return}n.sibling.return=n.return,n=n.sibling}};Xf=function(){};O_=function(t,e,n,i){var r=t.memoizedProps;if(r!==i){t=e.stateNode,$r(_i.current);var s=null;switch(n){case"input":r=df(t,r),i=df(t,i),s=[];break;case"select":r=Mt({},r,{value:void 0}),i=Mt({},i,{value:void 0}),s=[];break;case"textarea":r=gf(t,r),i=gf(t,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(t.onclick=ql)}vf(n,i);var o;n=null;for(c in r)if(!i.hasOwnProperty(c)&&r.hasOwnProperty(c)&&r[c]!=null)if(c==="style"){var a=r[c];for(o in a)a.hasOwnProperty(o)&&(n||(n={}),n[o]="")}else c!=="dangerouslySetInnerHTML"&&c!=="children"&&c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&c!=="autoFocus"&&(qo.hasOwnProperty(c)?s||(s=[]):(s=s||[]).push(c,null));for(c in i){var l=i[c];if(a=r!=null?r[c]:void 0,i.hasOwnProperty(c)&&l!==a&&(l!=null||a!=null))if(c==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(n||(n={}),n[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(n||(n={}),n[o]=l[o])}else n||(s||(s=[]),s.push(c,n)),n=l;else c==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(c,l)):c==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(c,""+l):c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&(qo.hasOwnProperty(c)?(l!=null&&c==="onScroll"&&pt("scroll",t),s||a===l||(s=[])):(s=s||[]).push(c,l))}n&&(s=s||[]).push("style",n);var c=s;(e.updateQueue=c)&&(e.flags|=4)}};B_=function(t,e,n,i){n!==i&&(e.flags|=4)};function Po(t,e){if(!vt)switch(t.tailMode){case"hidden":e=t.tail;for(var n=null;e!==null;)e.alternate!==null&&(n=e),e=e.sibling;n===null?t.tail=null:n.sibling=null;break;case"collapsed":n=t.tail;for(var i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?e||t.tail===null?t.tail=null:t.tail.sibling=null:i.sibling=null}}function jt(t){var e=t.alternate!==null&&t.alternate.child===t.child,n=0,i=0;if(e)for(var r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=t,r=r.sibling;else for(r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=t,r=r.sibling;return t.subtreeFlags|=i,t.childLanes=n,e}function iM(t,e,n){var i=e.pendingProps;switch(_d(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return jt(e),null;case 1:return gn(e.type)&&Yl(),jt(e),null;case 3:return i=e.stateNode,Gs(),mt(mn),mt(en),bd(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(t===null||t.child===null)&&(wl(e)?e.flags|=4:t===null||t.memoizedState.isDehydrated&&(e.flags&256)===0||(e.flags|=1024,Qn!==null&&(Qf(Qn),Qn=null))),Xf(t,e),jt(e),null;case 5:Td(e);var r=$r(ra.current);if(n=e.type,t!==null&&e.stateNode!=null)O_(t,e,n,i,r),t.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(ie(166));return jt(e),null}if(t=$r(_i.current),wl(e)){i=e.stateNode,n=e.type;var s=e.memoizedProps;switch(i[mi]=e,i[na]=s,t=(e.mode&1)!==0,n){case"dialog":pt("cancel",i),pt("close",i);break;case"iframe":case"object":case"embed":pt("load",i);break;case"video":case"audio":for(r=0;r<Fo.length;r++)pt(Fo[r],i);break;case"source":pt("error",i);break;case"img":case"image":case"link":pt("error",i),pt("load",i);break;case"details":pt("toggle",i);break;case"input":tg(i,s),pt("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},pt("invalid",i);break;case"textarea":ig(i,s),pt("invalid",i)}vf(n,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&Ml(i.textContent,a,t),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&Ml(i.textContent,a,t),r=["children",""+a]):qo.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&pt("scroll",i)}switch(n){case"input":ul(i),ng(i,s,!0);break;case"textarea":ul(i),rg(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=ql)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,t==="http://www.w3.org/1999/xhtml"&&(t=f0(n)),t==="http://www.w3.org/1999/xhtml"?n==="script"?(t=o.createElement("div"),t.innerHTML="<script><\/script>",t=t.removeChild(t.firstChild)):typeof i.is=="string"?t=o.createElement(n,{is:i.is}):(t=o.createElement(n),n==="select"&&(o=t,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):t=o.createElementNS(t,n),t[mi]=e,t[na]=i,F_(t,e,!1,!1),e.stateNode=t;e:{switch(o=xf(n,i),n){case"dialog":pt("cancel",t),pt("close",t),r=i;break;case"iframe":case"object":case"embed":pt("load",t),r=i;break;case"video":case"audio":for(r=0;r<Fo.length;r++)pt(Fo[r],t);r=i;break;case"source":pt("error",t),r=i;break;case"img":case"image":case"link":pt("error",t),pt("load",t),r=i;break;case"details":pt("toggle",t),r=i;break;case"input":tg(t,i),r=df(t,i),pt("invalid",t);break;case"option":r=i;break;case"select":t._wrapperState={wasMultiple:!!i.multiple},r=Mt({},i,{value:void 0}),pt("invalid",t);break;case"textarea":ig(t,i),r=gf(t,i),pt("invalid",t);break;default:r=i}vf(n,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?m0(t,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&d0(t,l)):s==="children"?typeof l=="string"?(n!=="textarea"||l!=="")&&Yo(t,l):typeof l=="number"&&Yo(t,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(qo.hasOwnProperty(s)?l!=null&&s==="onScroll"&&pt("scroll",t):l!=null&&nd(t,s,l,o))}switch(n){case"input":ul(t),ng(t,i,!1);break;case"textarea":ul(t),rg(t);break;case"option":i.value!=null&&t.setAttribute("value",""+xr(i.value));break;case"select":t.multiple=!!i.multiple,s=i.value,s!=null?Ls(t,!!i.multiple,s,!1):i.defaultValue!=null&&Ls(t,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(t.onclick=ql)}switch(n){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return jt(e),null;case 6:if(t&&e.stateNode!=null)B_(t,e,t.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(ie(166));if(n=$r(ra.current),$r(_i.current),wl(e)){if(i=e.stateNode,n=e.memoizedProps,i[mi]=e,(s=i.nodeValue!==n)&&(t=Tn,t!==null))switch(t.tag){case 3:Ml(i.nodeValue,n,(t.mode&1)!==0);break;case 5:t.memoizedProps.suppressHydrationWarning!==!0&&Ml(i.nodeValue,n,(t.mode&1)!==0)}s&&(e.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[mi]=e,e.stateNode=i}return jt(e),null;case 13:if(mt(yt),i=e.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(vt&&En!==null&&(e.mode&1)!==0&&(e.flags&128)===0)n_(),zs(),e.flags|=98560,s=!1;else if(s=wl(e),i!==null&&i.dehydrated!==null){if(t===null){if(!s)throw Error(ie(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(ie(317));s[mi]=e}else zs(),(e.flags&128)===0&&(e.memoizedState=null),e.flags|=4;jt(e),s=!1}else Qn!==null&&(Qf(Qn),Qn=null),s=!0;if(!s)return e.flags&65536?e:null}return(e.flags&128)!==0?(e.lanes=n,e):(i=i!==null,i!==(t!==null&&t.memoizedState!==null)&&i&&(e.child.flags|=8192,(e.mode&1)!==0&&(t===null||(yt.current&1)!==0?Ft===0&&(Ft=3):Bd())),e.updateQueue!==null&&(e.flags|=4),jt(e),null);case 4:return Gs(),Xf(t,e),t===null&&ea(e.stateNode.containerInfo),jt(e),null;case 10:return Sd(e.type._context),jt(e),null;case 17:return gn(e.type)&&Yl(),jt(e),null;case 19:if(mt(yt),s=e.memoizedState,s===null)return jt(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)Po(s,!1);else{if(Ft!==0||t!==null&&(t.flags&128)!==0)for(t=e.child;t!==null;){if(o=ec(t),o!==null){for(e.flags|=128,Po(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=n,n=e.child;n!==null;)s=n,t=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=t,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,t=o.dependencies,s.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext}),n=n.sibling;return ft(yt,yt.current&1|2),e.child}t=t.sibling}s.tail!==null&&It()>Ws&&(e.flags|=128,i=!0,Po(s,!1),e.lanes=4194304)}else{if(!i)if(t=ec(o),t!==null){if(e.flags|=128,i=!0,n=t.updateQueue,n!==null&&(e.updateQueue=n,e.flags|=4),Po(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!vt)return jt(e),null}else 2*It()-s.renderingStartTime>Ws&&n!==1073741824&&(e.flags|=128,i=!0,Po(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(n=s.last,n!==null?n.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=It(),e.sibling=null,n=yt.current,ft(yt,i?n&1|2:n&1),e):(jt(e),null);case 22:case 23:return Od(),i=e.memoizedState!==null,t!==null&&t.memoizedState!==null!==i&&(e.flags|=8192),i&&(e.mode&1)!==0?(wn&1073741824)!==0&&(jt(e),e.subtreeFlags&6&&(e.flags|=8192)):jt(e),null;case 24:return null;case 25:return null}throw Error(ie(156,e.tag))}function rM(t,e){switch(_d(e),e.tag){case 1:return gn(e.type)&&Yl(),t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 3:return Gs(),mt(mn),mt(en),bd(),t=e.flags,(t&65536)!==0&&(t&128)===0?(e.flags=t&-65537|128,e):null;case 5:return Td(e),null;case 13:if(mt(yt),t=e.memoizedState,t!==null&&t.dehydrated!==null){if(e.alternate===null)throw Error(ie(340));zs()}return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 19:return mt(yt),null;case 4:return Gs(),null;case 10:return Sd(e.type._context),null;case 22:case 23:return Od(),null;case 24:return null;default:return null}}var bl=!1,Qt=!1,sM=typeof WeakSet=="function"?WeakSet:Set,ye=null;function Ps(t,e){var n=t.ref;if(n!==null)if(typeof n=="function")try{n(null)}catch(i){bt(t,e,i)}else n.current=null}function qf(t,e,n){try{n()}catch(i){bt(t,e,i)}}var Zg=!1;function oM(t,e){if(Rf=Hl,t=H0(),md(t)){if("selectionStart"in t)var n={start:t.selectionStart,end:t.selectionEnd};else e:{n=(n=t.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{n.nodeType,s.nodeType}catch{n=null;break e}var o=0,a=-1,l=-1,c=0,f=0,d=t,h=null;t:for(;;){for(var p;d!==n||r!==0&&d.nodeType!==3||(a=o+r),d!==s||i!==0&&d.nodeType!==3||(l=o+i),d.nodeType===3&&(o+=d.nodeValue.length),(p=d.firstChild)!==null;)h=d,d=p;for(;;){if(d===t)break t;if(h===n&&++c===r&&(a=o),h===s&&++f===i&&(l=o),(p=d.nextSibling)!==null)break;d=h,h=d.parentNode}d=p}n=a===-1||l===-1?null:{start:a,end:l}}else n=null}n=n||{start:0,end:0}}else n=null;for(Pf={focusedElem:t,selectionRange:n},Hl=!1,ye=e;ye!==null;)if(e=ye,t=e.child,(e.subtreeFlags&1028)!==0&&t!==null)t.return=e,ye=t;else for(;ye!==null;){e=ye;try{var v=e.alternate;if((e.flags&1024)!==0)switch(e.tag){case 0:case 11:case 15:break;case 1:if(v!==null){var S=v.memoizedProps,_=v.memoizedState,u=e.stateNode,m=u.getSnapshotBeforeUpdate(e.elementType===e.type?S:Kn(e.type,S),_);u.__reactInternalSnapshotBeforeUpdate=m}break;case 3:var x=e.stateNode.containerInfo;x.nodeType===1?x.textContent="":x.nodeType===9&&x.documentElement&&x.removeChild(x.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(ie(163))}}catch(w){bt(e,e.return,w)}if(t=e.sibling,t!==null){t.return=e.return,ye=t;break}ye=e.return}return v=Zg,Zg=!1,v}function Ho(t,e,n){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&t)===t){var s=r.destroy;r.destroy=void 0,s!==void 0&&qf(e,n,s)}r=r.next}while(r!==i)}}function gc(t,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var n=e=e.next;do{if((n.tag&t)===t){var i=n.create;n.destroy=i()}n=n.next}while(n!==e)}}function Yf(t){var e=t.ref;if(e!==null){var n=t.stateNode;switch(t.tag){case 5:t=n;break;default:t=n}typeof e=="function"?e(t):e.current=t}}function k_(t){var e=t.alternate;e!==null&&(t.alternate=null,k_(e)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(e=t.stateNode,e!==null&&(delete e[mi],delete e[na],delete e[Nf],delete e[GS],delete e[HS])),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}function z_(t){return t.tag===5||t.tag===3||t.tag===4}function $g(t){e:for(;;){for(;t.sibling===null;){if(t.return===null||z_(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.flags&2||t.child===null||t.tag===4)continue e;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function Zf(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.nodeType===8?n.parentNode.insertBefore(t,e):n.insertBefore(t,e):(n.nodeType===8?(e=n.parentNode,e.insertBefore(t,n)):(e=n,e.appendChild(t)),n=n._reactRootContainer,n!=null||e.onclick!==null||(e.onclick=ql));else if(i!==4&&(t=t.child,t!==null))for(Zf(t,e,n),t=t.sibling;t!==null;)Zf(t,e,n),t=t.sibling}function $f(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.insertBefore(t,e):n.appendChild(t);else if(i!==4&&(t=t.child,t!==null))for($f(t,e,n),t=t.sibling;t!==null;)$f(t,e,n),t=t.sibling}var Xt=null,jn=!1;function rr(t,e,n){for(n=n.child;n!==null;)V_(t,e,n),n=n.sibling}function V_(t,e,n){if(gi&&typeof gi.onCommitFiberUnmount=="function")try{gi.onCommitFiberUnmount(lc,n)}catch{}switch(n.tag){case 5:Qt||Ps(n,e);case 6:var i=Xt,r=jn;Xt=null,rr(t,e,n),Xt=i,jn=r,Xt!==null&&(jn?(t=Xt,n=n.stateNode,t.nodeType===8?t.parentNode.removeChild(n):t.removeChild(n)):Xt.removeChild(n.stateNode));break;case 18:Xt!==null&&(jn?(t=Xt,n=n.stateNode,t.nodeType===8?Kh(t.parentNode,n):t.nodeType===1&&Kh(t,n),Ko(t)):Kh(Xt,n.stateNode));break;case 4:i=Xt,r=jn,Xt=n.stateNode.containerInfo,jn=!0,rr(t,e,n),Xt=i,jn=r;break;case 0:case 11:case 14:case 15:if(!Qt&&(i=n.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&((s&2)!==0||(s&4)!==0)&&qf(n,e,o),r=r.next}while(r!==i)}rr(t,e,n);break;case 1:if(!Qt&&(Ps(n,e),i=n.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=n.memoizedProps,i.state=n.memoizedState,i.componentWillUnmount()}catch(a){bt(n,e,a)}rr(t,e,n);break;case 21:rr(t,e,n);break;case 22:n.mode&1?(Qt=(i=Qt)||n.memoizedState!==null,rr(t,e,n),Qt=i):rr(t,e,n);break;default:rr(t,e,n)}}function Jg(t){var e=t.updateQueue;if(e!==null){t.updateQueue=null;var n=t.stateNode;n===null&&(n=t.stateNode=new sM),e.forEach(function(i){var r=mM.bind(null,t,i);n.has(i)||(n.add(i),i.then(r,r))})}}function Jn(t,e){var n=e.deletions;if(n!==null)for(var i=0;i<n.length;i++){var r=n[i];try{var s=t,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:Xt=a.stateNode,jn=!1;break e;case 3:Xt=a.stateNode.containerInfo,jn=!0;break e;case 4:Xt=a.stateNode.containerInfo,jn=!0;break e}a=a.return}if(Xt===null)throw Error(ie(160));V_(s,o,r),Xt=null,jn=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(c){bt(r,e,c)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)G_(e,t),e=e.sibling}function G_(t,e){var n=t.alternate,i=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:if(Jn(e,t),di(t),i&4){try{Ho(3,t,t.return),gc(3,t)}catch(S){bt(t,t.return,S)}try{Ho(5,t,t.return)}catch(S){bt(t,t.return,S)}}break;case 1:Jn(e,t),di(t),i&512&&n!==null&&Ps(n,n.return);break;case 5:if(Jn(e,t),di(t),i&512&&n!==null&&Ps(n,n.return),t.flags&32){var r=t.stateNode;try{Yo(r,"")}catch(S){bt(t,t.return,S)}}if(i&4&&(r=t.stateNode,r!=null)){var s=t.memoizedProps,o=n!==null?n.memoizedProps:s,a=t.type,l=t.updateQueue;if(t.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&u0(r,s),xf(a,o);var c=xf(a,s);for(o=0;o<l.length;o+=2){var f=l[o],d=l[o+1];f==="style"?m0(r,d):f==="dangerouslySetInnerHTML"?d0(r,d):f==="children"?Yo(r,d):nd(r,f,d,c)}switch(a){case"input":pf(r,s);break;case"textarea":h0(r,s);break;case"select":var h=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var p=s.value;p!=null?Ls(r,!!s.multiple,p,!1):h!==!!s.multiple&&(s.defaultValue!=null?Ls(r,!!s.multiple,s.defaultValue,!0):Ls(r,!!s.multiple,s.multiple?[]:"",!1))}r[na]=s}catch(S){bt(t,t.return,S)}}break;case 6:if(Jn(e,t),di(t),i&4){if(t.stateNode===null)throw Error(ie(162));r=t.stateNode,s=t.memoizedProps;try{r.nodeValue=s}catch(S){bt(t,t.return,S)}}break;case 3:if(Jn(e,t),di(t),i&4&&n!==null&&n.memoizedState.isDehydrated)try{Ko(e.containerInfo)}catch(S){bt(t,t.return,S)}break;case 4:Jn(e,t),di(t);break;case 13:Jn(e,t),di(t),r=t.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(Ud=It())),i&4&&Jg(t);break;case 22:if(f=n!==null&&n.memoizedState!==null,t.mode&1?(Qt=(c=Qt)||f,Jn(e,t),Qt=c):Jn(e,t),di(t),i&8192){if(c=t.memoizedState!==null,(t.stateNode.isHidden=c)&&!f&&(t.mode&1)!==0)for(ye=t,f=t.child;f!==null;){for(d=ye=f;ye!==null;){switch(h=ye,p=h.child,h.tag){case 0:case 11:case 14:case 15:Ho(4,h,h.return);break;case 1:Ps(h,h.return);var v=h.stateNode;if(typeof v.componentWillUnmount=="function"){i=h,n=h.return;try{e=i,v.props=e.memoizedProps,v.state=e.memoizedState,v.componentWillUnmount()}catch(S){bt(i,n,S)}}break;case 5:Ps(h,h.return);break;case 22:if(h.memoizedState!==null){jg(d);continue}}p!==null?(p.return=h,ye=p):jg(d)}f=f.sibling}e:for(f=null,d=t;;){if(d.tag===5){if(f===null){f=d;try{r=d.stateNode,c?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=d.stateNode,l=d.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=p0("display",o))}catch(S){bt(t,t.return,S)}}}else if(d.tag===6){if(f===null)try{d.stateNode.nodeValue=c?"":d.memoizedProps}catch(S){bt(t,t.return,S)}}else if((d.tag!==22&&d.tag!==23||d.memoizedState===null||d===t)&&d.child!==null){d.child.return=d,d=d.child;continue}if(d===t)break e;for(;d.sibling===null;){if(d.return===null||d.return===t)break e;f===d&&(f=null),d=d.return}f===d&&(f=null),d.sibling.return=d.return,d=d.sibling}}break;case 19:Jn(e,t),di(t),i&4&&Jg(t);break;case 21:break;default:Jn(e,t),di(t)}}function di(t){var e=t.flags;if(e&2){try{e:{for(var n=t.return;n!==null;){if(z_(n)){var i=n;break e}n=n.return}throw Error(ie(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(Yo(r,""),i.flags&=-33);var s=$g(t);$f(t,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=$g(t);Zf(t,a,o);break;default:throw Error(ie(161))}}catch(l){bt(t,t.return,l)}t.flags&=-3}e&4096&&(t.flags&=-4097)}function aM(t,e,n){ye=t,H_(t,e,n)}function H_(t,e,n){for(var i=(t.mode&1)!==0;ye!==null;){var r=ye,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||bl;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||Qt;a=bl;var c=Qt;if(bl=o,(Qt=l)&&!c)for(ye=r;ye!==null;)o=ye,l=o.child,o.tag===22&&o.memoizedState!==null?Qg(r):l!==null?(l.return=o,ye=l):Qg(r);for(;s!==null;)ye=s,H_(s,e,n),s=s.sibling;ye=r,bl=a,Qt=c}Kg(t,e,n)}else(r.subtreeFlags&8772)!==0&&s!==null?(s.return=r,ye=s):Kg(t,e,n)}}function Kg(t){for(;ye!==null;){var e=ye;if((e.flags&8772)!==0){var n=e.alternate;try{if((e.flags&8772)!==0)switch(e.tag){case 0:case 11:case 15:Qt||gc(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!Qt)if(n===null)i.componentDidMount();else{var r=e.elementType===e.type?n.memoizedProps:Kn(e.type,n.memoizedProps);i.componentDidUpdate(r,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&Ug(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(n=null,e.child!==null)switch(e.child.tag){case 5:n=e.child.stateNode;break;case 1:n=e.child.stateNode}Ug(e,o,n)}break;case 5:var a=e.stateNode;if(n===null&&e.flags&4){n=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&n.focus();break;case"img":l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var c=e.alternate;if(c!==null){var f=c.memoizedState;if(f!==null){var d=f.dehydrated;d!==null&&Ko(d)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(ie(163))}Qt||e.flags&512&&Yf(e)}catch(h){bt(e,e.return,h)}}if(e===t){ye=null;break}if(n=e.sibling,n!==null){n.return=e.return,ye=n;break}ye=e.return}}function jg(t){for(;ye!==null;){var e=ye;if(e===t){ye=null;break}var n=e.sibling;if(n!==null){n.return=e.return,ye=n;break}ye=e.return}}function Qg(t){for(;ye!==null;){var e=ye;try{switch(e.tag){case 0:case 11:case 15:var n=e.return;try{gc(4,e)}catch(l){bt(e,n,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){bt(e,r,l)}}var s=e.return;try{Yf(e)}catch(l){bt(e,s,l)}break;case 5:var o=e.return;try{Yf(e)}catch(l){bt(e,o,l)}}}catch(l){bt(e,e.return,l)}if(e===t){ye=null;break}var a=e.sibling;if(a!==null){a.return=e.return,ye=a;break}ye=e.return}}var lM=Math.ceil,ic=Hi.ReactCurrentDispatcher,Nd=Hi.ReactCurrentOwner,Gn=Hi.ReactCurrentBatchConfig,Je=0,zt=null,Lt=null,qt=0,wn=0,Is=Mr(0),Ft=0,la=null,ts=0,_c=0,Dd=0,Wo=null,dn=null,Ud=0,Ws=1/0,Di=null,rc=!1,Jf=null,gr=null,Al=!1,ur=null,sc=0,Xo=0,Kf=null,Ul=-1,Fl=0;function cn(){return(Je&6)!==0?It():Ul!==-1?Ul:Ul=It()}function _r(t){return(t.mode&1)===0?1:(Je&2)!==0&&qt!==0?qt&-qt:XS.transition!==null?(Fl===0&&(Fl=A0()),Fl):(t=nt,t!==0||(t=window.event,t=t===void 0?16:D0(t.type)),t)}function ti(t,e,n,i){if(50<Xo)throw Xo=0,Kf=null,Error(ie(185));ca(t,n,i),((Je&2)===0||t!==zt)&&(t===zt&&((Je&2)===0&&(_c|=n),Ft===4&&lr(t,qt)),_n(t,i),n===1&&Je===0&&(e.mode&1)===0&&(Ws=It()+500,dc&&wr()))}function _n(t,e){var n=t.callbackNode;Yy(t,e);var i=Gl(t,t===zt?qt:0);if(i===0)n!==null&&ag(n),t.callbackNode=null,t.callbackPriority=0;else if(e=i&-i,t.callbackPriority!==e){if(n!=null&&ag(n),e===1)t.tag===0?WS(e0.bind(null,t)):Q0(e0.bind(null,t)),zS(function(){(Je&6)===0&&wr()}),n=null;else{switch(C0(i)){case 1:n=ad;break;case 4:n=T0;break;case 16:n=Vl;break;case 536870912:n=b0;break;default:n=Vl}n=K_(n,W_.bind(null,t))}t.callbackPriority=e,t.callbackNode=n}}function W_(t,e){if(Ul=-1,Fl=0,(Je&6)!==0)throw Error(ie(327));var n=t.callbackNode;if(Os()&&t.callbackNode!==n)return null;var i=Gl(t,t===zt?qt:0);if(i===0)return null;if((i&30)!==0||(i&t.expiredLanes)!==0||e)e=oc(t,i);else{e=i;var r=Je;Je|=2;var s=q_();(zt!==t||qt!==e)&&(Di=null,Ws=It()+500,Jr(t,e));do try{hM();break}catch(a){X_(t,a)}while(!0);yd(),ic.current=s,Je=r,Lt!==null?e=0:(zt=null,qt=0,e=Ft)}if(e!==0){if(e===2&&(r=Ef(t),r!==0&&(i=r,e=jf(t,r))),e===1)throw n=la,Jr(t,0),lr(t,i),_n(t,It()),n;if(e===6)lr(t,i);else{if(r=t.current.alternate,(i&30)===0&&!cM(r)&&(e=oc(t,i),e===2&&(s=Ef(t),s!==0&&(i=s,e=jf(t,s))),e===1))throw n=la,Jr(t,0),lr(t,i),_n(t,It()),n;switch(t.finishedWork=r,t.finishedLanes=i,e){case 0:case 1:throw Error(ie(345));case 2:qr(t,dn,Di);break;case 3:if(lr(t,i),(i&130023424)===i&&(e=Ud+500-It(),10<e)){if(Gl(t,0)!==0)break;if(r=t.suspendedLanes,(r&i)!==i){cn(),t.pingedLanes|=t.suspendedLanes&r;break}t.timeoutHandle=Lf(qr.bind(null,t,dn,Di),e);break}qr(t,dn,Di);break;case 4:if(lr(t,i),(i&4194240)===i)break;for(e=t.eventTimes,r=-1;0<i;){var o=31-ei(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=It()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*lM(i/1960))-i,10<i){t.timeoutHandle=Lf(qr.bind(null,t,dn,Di),i);break}qr(t,dn,Di);break;case 5:qr(t,dn,Di);break;default:throw Error(ie(329))}}}return _n(t,It()),t.callbackNode===n?W_.bind(null,t):null}function jf(t,e){var n=Wo;return t.current.memoizedState.isDehydrated&&(Jr(t,e).flags|=256),t=oc(t,e),t!==2&&(e=dn,dn=n,e!==null&&Qf(e)),t}function Qf(t){dn===null?dn=t:dn.push.apply(dn,t)}function cM(t){for(var e=t;;){if(e.flags&16384){var n=e.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var i=0;i<n.length;i++){var r=n[i],s=r.getSnapshot;r=r.value;try{if(!ni(s(),r))return!1}catch{return!1}}}if(n=e.child,e.subtreeFlags&16384&&n!==null)n.return=e,e=n;else{if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function lr(t,e){for(e&=~Dd,e&=~_c,t.suspendedLanes|=e,t.pingedLanes&=~e,t=t.expirationTimes;0<e;){var n=31-ei(e),i=1<<n;t[n]=-1,e&=~i}}function e0(t){if((Je&6)!==0)throw Error(ie(327));Os();var e=Gl(t,0);if((e&1)===0)return _n(t,It()),null;var n=oc(t,e);if(t.tag!==0&&n===2){var i=Ef(t);i!==0&&(e=i,n=jf(t,i))}if(n===1)throw n=la,Jr(t,0),lr(t,e),_n(t,It()),n;if(n===6)throw Error(ie(345));return t.finishedWork=t.current.alternate,t.finishedLanes=e,qr(t,dn,Di),_n(t,It()),null}function Fd(t,e){var n=Je;Je|=1;try{return t(e)}finally{Je=n,Je===0&&(Ws=It()+500,dc&&wr())}}function ns(t){ur!==null&&ur.tag===0&&(Je&6)===0&&Os();var e=Je;Je|=1;var n=Gn.transition,i=nt;try{if(Gn.transition=null,nt=1,t)return t()}finally{nt=i,Gn.transition=n,Je=e,(Je&6)===0&&wr()}}function Od(){wn=Is.current,mt(Is)}function Jr(t,e){t.finishedWork=null,t.finishedLanes=0;var n=t.timeoutHandle;if(n!==-1&&(t.timeoutHandle=-1,kS(n)),Lt!==null)for(n=Lt.return;n!==null;){var i=n;switch(_d(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&Yl();break;case 3:Gs(),mt(mn),mt(en),bd();break;case 5:Td(i);break;case 4:Gs();break;case 13:mt(yt);break;case 19:mt(yt);break;case 10:Sd(i.type._context);break;case 22:case 23:Od()}n=n.return}if(zt=t,Lt=t=vr(t.current,null),qt=wn=e,Ft=0,la=null,Dd=_c=ts=0,dn=Wo=null,Zr!==null){for(e=0;e<Zr.length;e++)if(n=Zr[e],i=n.interleaved,i!==null){n.interleaved=null;var r=i.next,s=n.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}n.pending=i}Zr=null}return t}function X_(t,e){do{var n=Lt;try{if(yd(),Ll.current=nc,tc){for(var i=St.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}tc=!1}if(es=0,kt=Ut=St=null,Go=!1,sa=0,Nd.current=null,n===null||n.return===null){Ft=1,la=e,Lt=null;break}e:{var s=t,o=n.return,a=n,l=e;if(e=qt,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var c=l,f=a,d=f.tag;if((f.mode&1)===0&&(d===0||d===11||d===15)){var h=f.alternate;h?(f.updateQueue=h.updateQueue,f.memoizedState=h.memoizedState,f.lanes=h.lanes):(f.updateQueue=null,f.memoizedState=null)}var p=Vg(o);if(p!==null){p.flags&=-257,Gg(p,o,a,s,e),p.mode&1&&zg(s,c,e),e=p,l=c;var v=e.updateQueue;if(v===null){var S=new Set;S.add(l),e.updateQueue=S}else v.add(l);break e}else{if((e&1)===0){zg(s,c,e),Bd();break e}l=Error(ie(426))}}else if(vt&&a.mode&1){var _=Vg(o);if(_!==null){(_.flags&65536)===0&&(_.flags|=256),Gg(_,o,a,s,e),vd(Hs(l,a));break e}}s=l=Hs(l,a),Ft!==4&&(Ft=2),Wo===null?Wo=[s]:Wo.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var u=C_(s,l,e);Dg(s,u);break e;case 1:a=l;var m=s.type,x=s.stateNode;if((s.flags&128)===0&&(typeof m.getDerivedStateFromError=="function"||x!==null&&typeof x.componentDidCatch=="function"&&(gr===null||!gr.has(x)))){s.flags|=65536,e&=-e,s.lanes|=e;var w=R_(s,a,e);Dg(s,w);break e}}s=s.return}while(s!==null)}Z_(n)}catch(A){e=A,Lt===n&&n!==null&&(Lt=n=n.return);continue}break}while(!0)}function q_(){var t=ic.current;return ic.current=nc,t===null?nc:t}function Bd(){(Ft===0||Ft===3||Ft===2)&&(Ft=4),zt===null||(ts&268435455)===0&&(_c&268435455)===0||lr(zt,qt)}function oc(t,e){var n=Je;Je|=2;var i=q_();(zt!==t||qt!==e)&&(Di=null,Jr(t,e));do try{uM();break}catch(r){X_(t,r)}while(!0);if(yd(),Je=n,ic.current=i,Lt!==null)throw Error(ie(261));return zt=null,qt=0,Ft}function uM(){for(;Lt!==null;)Y_(Lt)}function hM(){for(;Lt!==null&&!By();)Y_(Lt)}function Y_(t){var e=J_(t.alternate,t,wn);t.memoizedProps=t.pendingProps,e===null?Z_(t):Lt=e,Nd.current=null}function Z_(t){var e=t;do{var n=e.alternate;if(t=e.return,(e.flags&32768)===0){if(n=iM(n,e,wn),n!==null){Lt=n;return}}else{if(n=rM(n,e),n!==null){n.flags&=32767,Lt=n;return}if(t!==null)t.flags|=32768,t.subtreeFlags=0,t.deletions=null;else{Ft=6,Lt=null;return}}if(e=e.sibling,e!==null){Lt=e;return}Lt=e=t}while(e!==null);Ft===0&&(Ft=5)}function qr(t,e,n){var i=nt,r=Gn.transition;try{Gn.transition=null,nt=1,fM(t,e,n,i)}finally{Gn.transition=r,nt=i}return null}function fM(t,e,n,i){do Os();while(ur!==null);if((Je&6)!==0)throw Error(ie(327));n=t.finishedWork;var r=t.finishedLanes;if(n===null)return null;if(t.finishedWork=null,t.finishedLanes=0,n===t.current)throw Error(ie(177));t.callbackNode=null,t.callbackPriority=0;var s=n.lanes|n.childLanes;if(Zy(t,s),t===zt&&(Lt=zt=null,qt=0),(n.subtreeFlags&2064)===0&&(n.flags&2064)===0||Al||(Al=!0,K_(Vl,function(){return Os(),null})),s=(n.flags&15990)!==0,(n.subtreeFlags&15990)!==0||s){s=Gn.transition,Gn.transition=null;var o=nt;nt=1;var a=Je;Je|=4,Nd.current=null,oM(t,n),G_(n,t),DS(Pf),Hl=!!Rf,Pf=Rf=null,t.current=n,aM(n,t,r),ky(),Je=a,nt=o,Gn.transition=s}else t.current=n;if(Al&&(Al=!1,ur=t,sc=r),s=t.pendingLanes,s===0&&(gr=null),Gy(n.stateNode,i),_n(t,It()),e!==null)for(i=t.onRecoverableError,n=0;n<e.length;n++)r=e[n],i(r.value,{componentStack:r.stack,digest:r.digest});if(rc)throw rc=!1,t=Jf,Jf=null,t;return(sc&1)!==0&&t.tag!==0&&Os(),s=t.pendingLanes,(s&1)!==0?t===Kf?Xo++:(Xo=0,Kf=t):Xo=0,wr(),null}function Os(){if(ur!==null){var t=C0(sc),e=Gn.transition,n=nt;try{if(Gn.transition=null,nt=16>t?16:t,ur===null)var i=!1;else{if(t=ur,ur=null,sc=0,(Je&6)!==0)throw Error(ie(331));var r=Je;for(Je|=4,ye=t.current;ye!==null;){var s=ye,o=s.child;if((ye.flags&16)!==0){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var c=a[l];for(ye=c;ye!==null;){var f=ye;switch(f.tag){case 0:case 11:case 15:Ho(8,f,s)}var d=f.child;if(d!==null)d.return=f,ye=d;else for(;ye!==null;){f=ye;var h=f.sibling,p=f.return;if(k_(f),f===c){ye=null;break}if(h!==null){h.return=p,ye=h;break}ye=p}}}var v=s.alternate;if(v!==null){var S=v.child;if(S!==null){v.child=null;do{var _=S.sibling;S.sibling=null,S=_}while(S!==null)}}ye=s}}if((s.subtreeFlags&2064)!==0&&o!==null)o.return=s,ye=o;else e:for(;ye!==null;){if(s=ye,(s.flags&2048)!==0)switch(s.tag){case 0:case 11:case 15:Ho(9,s,s.return)}var u=s.sibling;if(u!==null){u.return=s.return,ye=u;break e}ye=s.return}}var m=t.current;for(ye=m;ye!==null;){o=ye;var x=o.child;if((o.subtreeFlags&2064)!==0&&x!==null)x.return=o,ye=x;else e:for(o=m;ye!==null;){if(a=ye,(a.flags&2048)!==0)try{switch(a.tag){case 0:case 11:case 15:gc(9,a)}}catch(A){bt(a,a.return,A)}if(a===o){ye=null;break e}var w=a.sibling;if(w!==null){w.return=a.return,ye=w;break e}ye=a.return}}if(Je=r,wr(),gi&&typeof gi.onPostCommitFiberRoot=="function")try{gi.onPostCommitFiberRoot(lc,t)}catch{}i=!0}return i}finally{nt=n,Gn.transition=e}}return!1}function t0(t,e,n){e=Hs(n,e),e=C_(t,e,1),t=mr(t,e,1),e=cn(),t!==null&&(ca(t,1,e),_n(t,e))}function bt(t,e,n){if(t.tag===3)t0(t,t,n);else for(;e!==null;){if(e.tag===3){t0(e,t,n);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(gr===null||!gr.has(i))){t=Hs(n,t),t=R_(e,t,1),e=mr(e,t,1),t=cn(),e!==null&&(ca(e,1,t),_n(e,t));break}}e=e.return}}function dM(t,e,n){var i=t.pingCache;i!==null&&i.delete(e),e=cn(),t.pingedLanes|=t.suspendedLanes&n,zt===t&&(qt&n)===n&&(Ft===4||Ft===3&&(qt&130023424)===qt&&500>It()-Ud?Jr(t,0):Dd|=n),_n(t,e)}function $_(t,e){e===0&&((t.mode&1)===0?e=1:(e=dl,dl<<=1,(dl&130023424)===0&&(dl=4194304)));var n=cn();t=Vi(t,e),t!==null&&(ca(t,e,n),_n(t,n))}function pM(t){var e=t.memoizedState,n=0;e!==null&&(n=e.retryLane),$_(t,n)}function mM(t,e){var n=0;switch(t.tag){case 13:var i=t.stateNode,r=t.memoizedState;r!==null&&(n=r.retryLane);break;case 19:i=t.stateNode;break;default:throw Error(ie(314))}i!==null&&i.delete(e),$_(t,n)}var J_;J_=function(t,e,n){if(t!==null)if(t.memoizedProps!==e.pendingProps||mn.current)pn=!0;else{if((t.lanes&n)===0&&(e.flags&128)===0)return pn=!1,nM(t,e,n);pn=(t.flags&131072)!==0}else pn=!1,vt&&(e.flags&1048576)!==0&&e_(e,Jl,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;Dl(t,e),t=e.pendingProps;var r=ks(e,en.current);Fs(e,n),r=Cd(null,e,i,t,r,n);var s=Rd();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,gn(i)?(s=!0,Zl(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,wd(e),r.updater=mc,e.stateNode=r,r._reactInternals=e,kf(e,i,t,n),e=Gf(null,e,i,!0,s,n)):(e.tag=0,vt&&s&&gd(e),ln(null,e,r,n),e=e.child),e;case 16:i=e.elementType;e:{switch(Dl(t,e),t=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=_M(i),t=Kn(i,t),r){case 0:e=Vf(null,e,i,t,n);break e;case 1:e=Xg(null,e,i,t,n);break e;case 11:e=Hg(null,e,i,t,n);break e;case 14:e=Wg(null,e,i,Kn(i.type,t),n);break e}throw Error(ie(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Kn(i,r),Vf(t,e,i,r,n);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Kn(i,r),Xg(t,e,i,r,n);case 3:e:{if(N_(e),t===null)throw Error(ie(387));i=e.pendingProps,s=e.memoizedState,r=s.element,o_(t,e),Ql(e,i,null,n);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=Hs(Error(ie(423)),e),e=qg(t,e,i,n,r);break e}else if(i!==r){r=Hs(Error(ie(424)),e),e=qg(t,e,i,n,r);break e}else for(En=pr(e.stateNode.containerInfo.firstChild),Tn=e,vt=!0,Qn=null,n=r_(e,null,i,n),e.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if(zs(),i===r){e=Gi(t,e,n);break e}ln(t,e,i,n)}e=e.child}return e;case 5:return a_(e),t===null&&Ff(e),i=e.type,r=e.pendingProps,s=t!==null?t.memoizedProps:null,o=r.children,If(i,r)?o=null:s!==null&&If(i,s)&&(e.flags|=32),L_(t,e),ln(t,e,o,n),e.child;case 6:return t===null&&Ff(e),null;case 13:return D_(t,e,n);case 4:return Ed(e,e.stateNode.containerInfo),i=e.pendingProps,t===null?e.child=Vs(e,null,i,n):ln(t,e,i,n),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Kn(i,r),Hg(t,e,i,r,n);case 7:return ln(t,e,e.pendingProps,n),e.child;case 8:return ln(t,e,e.pendingProps.children,n),e.child;case 12:return ln(t,e,e.pendingProps.children,n),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,ft(Kl,i._currentValue),i._currentValue=o,s!==null)if(ni(s.value,o)){if(s.children===r.children&&!mn.current){e=Gi(t,e,n);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=Bi(-1,n&-n),l.tag=2;var c=s.updateQueue;if(c!==null){c=c.shared;var f=c.pending;f===null?l.next=l:(l.next=f.next,f.next=l),c.pending=l}}s.lanes|=n,l=s.alternate,l!==null&&(l.lanes|=n),Of(s.return,n,e),a.lanes|=n;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(ie(341));o.lanes|=n,a=o.alternate,a!==null&&(a.lanes|=n),Of(o,n,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}ln(t,e,r.children,n),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,Fs(e,n),r=Hn(r),i=i(r),e.flags|=1,ln(t,e,i,n),e.child;case 14:return i=e.type,r=Kn(i,e.pendingProps),r=Kn(i.type,r),Wg(t,e,i,r,n);case 15:return P_(t,e,e.type,e.pendingProps,n);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Kn(i,r),Dl(t,e),e.tag=1,gn(i)?(t=!0,Zl(e)):t=!1,Fs(e,n),A_(e,i,r),kf(e,i,r,n),Gf(null,e,i,!0,t,n);case 19:return U_(t,e,n);case 22:return I_(t,e,n)}throw Error(ie(156,e.tag))};function K_(t,e){return E0(t,e)}function gM(t,e,n,i){this.tag=t,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Vn(t,e,n,i){return new gM(t,e,n,i)}function kd(t){return t=t.prototype,!(!t||!t.isReactComponent)}function _M(t){if(typeof t=="function")return kd(t)?1:0;if(t!=null){if(t=t.$$typeof,t===rd)return 11;if(t===sd)return 14}return 2}function vr(t,e){var n=t.alternate;return n===null?(n=Vn(t.tag,e,t.key,t.mode),n.elementType=t.elementType,n.type=t.type,n.stateNode=t.stateNode,n.alternate=t,t.alternate=n):(n.pendingProps=e,n.type=t.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=t.flags&14680064,n.childLanes=t.childLanes,n.lanes=t.lanes,n.child=t.child,n.memoizedProps=t.memoizedProps,n.memoizedState=t.memoizedState,n.updateQueue=t.updateQueue,e=t.dependencies,n.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},n.sibling=t.sibling,n.index=t.index,n.ref=t.ref,n}function Ol(t,e,n,i,r,s){var o=2;if(i=t,typeof t=="function")kd(t)&&(o=1);else if(typeof t=="string")o=5;else e:switch(t){case Ss:return Kr(n.children,r,s,e);case id:o=8,r|=8;break;case cf:return t=Vn(12,n,e,r|2),t.elementType=cf,t.lanes=s,t;case uf:return t=Vn(13,n,e,r),t.elementType=uf,t.lanes=s,t;case hf:return t=Vn(19,n,e,r),t.elementType=hf,t.lanes=s,t;case a0:return vc(n,r,s,e);default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case s0:o=10;break e;case o0:o=9;break e;case rd:o=11;break e;case sd:o=14;break e;case sr:o=16,i=null;break e}throw Error(ie(130,t==null?t:typeof t,""))}return e=Vn(o,n,e,r),e.elementType=t,e.type=i,e.lanes=s,e}function Kr(t,e,n,i){return t=Vn(7,t,i,e),t.lanes=n,t}function vc(t,e,n,i){return t=Vn(22,t,i,e),t.elementType=a0,t.lanes=n,t.stateNode={isHidden:!1},t}function of(t,e,n){return t=Vn(6,t,null,e),t.lanes=n,t}function af(t,e,n){return e=Vn(4,t.children!==null?t.children:[],t.key,e),e.lanes=n,e.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},e}function vM(t,e,n,i,r){this.tag=e,this.containerInfo=t,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=Hh(0),this.expirationTimes=Hh(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=Hh(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function zd(t,e,n,i,r,s,o,a,l){return t=new vM(t,e,n,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=Vn(3,null,null,e),t.current=s,s.stateNode=t,s.memoizedState={element:i,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},wd(s),t}function xM(t,e,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:ys,key:i==null?null:""+i,children:t,containerInfo:e,implementation:n}}function j_(t){if(!t)return yr;t=t._reactInternals;e:{if(rs(t)!==t||t.tag!==1)throw Error(ie(170));var e=t;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(gn(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(ie(171))}if(t.tag===1){var n=t.type;if(gn(n))return j0(t,n,e)}return e}function Q_(t,e,n,i,r,s,o,a,l){return t=zd(n,i,!0,t,r,s,o,a,l),t.context=j_(null),n=t.current,i=cn(),r=_r(n),s=Bi(i,r),s.callback=e??null,mr(n,s,r),t.current.lanes=r,ca(t,r,i),_n(t,i),t}function xc(t,e,n,i){var r=e.current,s=cn(),o=_r(r);return n=j_(n),e.context===null?e.context=n:e.pendingContext=n,e=Bi(s,o),e.payload={element:t},i=i===void 0?null:i,i!==null&&(e.callback=i),t=mr(r,e,o),t!==null&&(ti(t,r,o,s),Il(t,r,o)),o}function ac(t){if(t=t.current,!t.child)return null;switch(t.child.tag){case 5:return t.child.stateNode;default:return t.child.stateNode}}function n0(t,e){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var n=t.retryLane;t.retryLane=n!==0&&n<e?n:e}}function Vd(t,e){n0(t,e),(t=t.alternate)&&n0(t,e)}function yM(){return null}var ev=typeof reportError=="function"?reportError:function(t){console.error(t)};function Gd(t){this._internalRoot=t}yc.prototype.render=Gd.prototype.render=function(t){var e=this._internalRoot;if(e===null)throw Error(ie(409));xc(t,e,null,null)};yc.prototype.unmount=Gd.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var e=t.containerInfo;ns(function(){xc(null,t,null,null)}),e[zi]=null}};function yc(t){this._internalRoot=t}yc.prototype.unstable_scheduleHydration=function(t){if(t){var e=I0();t={blockedOn:null,target:t,priority:e};for(var n=0;n<ar.length&&e!==0&&e<ar[n].priority;n++);ar.splice(n,0,t),n===0&&N0(t)}};function Hd(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function Sc(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11&&(t.nodeType!==8||t.nodeValue!==" react-mount-point-unstable "))}function i0(){}function SM(t,e,n,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var c=ac(o);s.call(c)}}var o=Q_(e,i,t,0,null,!1,!1,"",i0);return t._reactRootContainer=o,t[zi]=o.current,ea(t.nodeType===8?t.parentNode:t),ns(),o}for(;r=t.lastChild;)t.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var c=ac(l);a.call(c)}}var l=zd(t,0,!1,null,null,!1,!1,"",i0);return t._reactRootContainer=l,t[zi]=l.current,ea(t.nodeType===8?t.parentNode:t),ns(function(){xc(e,l,n,i)}),l}function Mc(t,e,n,i,r){var s=n._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=ac(o);a.call(l)}}xc(e,o,t,r)}else o=SM(n,e,t,r,i);return ac(o)}R0=function(t){switch(t.tag){case 3:var e=t.stateNode;if(e.current.memoizedState.isDehydrated){var n=Uo(e.pendingLanes);n!==0&&(ld(e,n|1),_n(e,It()),(Je&6)===0&&(Ws=It()+500,wr()))}break;case 13:ns(function(){var i=Vi(t,1);if(i!==null){var r=cn();ti(i,t,1,r)}}),Vd(t,1)}};cd=function(t){if(t.tag===13){var e=Vi(t,134217728);if(e!==null){var n=cn();ti(e,t,134217728,n)}Vd(t,134217728)}};P0=function(t){if(t.tag===13){var e=_r(t),n=Vi(t,e);if(n!==null){var i=cn();ti(n,t,e,i)}Vd(t,e)}};I0=function(){return nt};L0=function(t,e){var n=nt;try{return nt=t,e()}finally{nt=n}};Sf=function(t,e,n){switch(e){case"input":if(pf(t,n),e=n.name,n.type==="radio"&&e!=null){for(n=t;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<n.length;e++){var i=n[e];if(i!==t&&i.form===t.form){var r=fc(i);if(!r)throw Error(ie(90));c0(i),pf(i,r)}}}break;case"textarea":h0(t,n);break;case"select":e=n.value,e!=null&&Ls(t,!!n.multiple,e,!1)}};v0=Fd;x0=ns;var MM={usingClientEntryPoint:!1,Events:[ha,Ts,fc,g0,_0,Fd]},Io={findFiberByHostInstance:Yr,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},wM={bundleType:Io.bundleType,version:Io.version,rendererPackageName:Io.rendererPackageName,rendererConfig:Io.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:Hi.ReactCurrentDispatcher,findHostInstanceByFiber:function(t){return t=M0(t),t===null?null:t.stateNode},findFiberByHostInstance:Io.findFiberByHostInstance||yM,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(Lo=__REACT_DEVTOOLS_GLOBAL_HOOK__,!Lo.isDisabled&&Lo.supportsFiber))try{lc=Lo.inject(wM),gi=Lo}catch{}var Lo;Cn.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=MM;Cn.createPortal=function(t,e){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!Hd(e))throw Error(ie(200));return xM(t,e,null,n)};Cn.createRoot=function(t,e){if(!Hd(t))throw Error(ie(299));var n=!1,i="",r=ev;return e!=null&&(e.unstable_strictMode===!0&&(n=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=zd(t,1,!1,null,null,n,!1,i,r),t[zi]=e.current,ea(t.nodeType===8?t.parentNode:t),new Gd(e)};Cn.findDOMNode=function(t){if(t==null)return null;if(t.nodeType===1)return t;var e=t._reactInternals;if(e===void 0)throw typeof t.render=="function"?Error(ie(188)):(t=Object.keys(t).join(","),Error(ie(268,t)));return t=M0(e),t=t===null?null:t.stateNode,t};Cn.flushSync=function(t){return ns(t)};Cn.hydrate=function(t,e,n){if(!Sc(e))throw Error(ie(200));return Mc(null,t,e,!0,n)};Cn.hydrateRoot=function(t,e,n){if(!Hd(t))throw Error(ie(405));var i=n!=null&&n.hydratedSources||null,r=!1,s="",o=ev;if(n!=null&&(n.unstable_strictMode===!0&&(r=!0),n.identifierPrefix!==void 0&&(s=n.identifierPrefix),n.onRecoverableError!==void 0&&(o=n.onRecoverableError)),e=Q_(e,null,t,1,n??null,r,!1,s,o),t[zi]=e.current,ea(t),i)for(t=0;t<i.length;t++)n=i[t],r=n._getVersion,r=r(n._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[n,r]:e.mutableSourceEagerHydrationData.push(n,r);return new yc(e)};Cn.render=function(t,e,n){if(!Sc(e))throw Error(ie(200));return Mc(null,t,e,!1,n)};Cn.unmountComponentAtNode=function(t){if(!Sc(t))throw Error(ie(40));return t._reactRootContainer?(ns(function(){Mc(null,null,t,!1,function(){t._reactRootContainer=null,t[zi]=null})}),!0):!1};Cn.unstable_batchedUpdates=Fd;Cn.unstable_renderSubtreeIntoContainer=function(t,e,n,i){if(!Sc(n))throw Error(ie(200));if(t==null||t._reactInternals===void 0)throw Error(ie(38));return Mc(t,e,n,!1,i)};Cn.version="18.3.1-next-f1338f8080-20240426"});var rv=Ni((hA,iv)=>{"use strict";function nv(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(nv)}catch(t){console.error(t)}}nv(),iv.exports=tv()});var ov=Ni(Wd=>{"use strict";var sv=rv();Wd.createRoot=sv.createRoot,Wd.hydrateRoot=sv.hydrateRoot;var fA});var Gx=Ni(Mh=>{"use strict";var qb=il(),Yb=Symbol.for("react.element"),Zb=Symbol.for("react.fragment"),$b=Object.prototype.hasOwnProperty,Jb=qb.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,Kb={key:!0,ref:!0,__self:!0,__source:!0};function Vx(t,e,n){var i,r={},s=null,o=null;n!==void 0&&(s=""+n),e.key!==void 0&&(s=""+e.key),e.ref!==void 0&&(o=e.ref);for(i in e)$b.call(e,i)&&!Kb.hasOwnProperty(i)&&(r[i]=e[i]);if(t&&t.defaultProps)for(i in e=t.defaultProps,e)r[i]===void 0&&(r[i]=e[i]);return{$$typeof:Yb,type:t,key:s,ref:o,props:r,_owner:Jb.current}}Mh.Fragment=Zb;Mh.jsx=Vx;Mh.jsxs=Vx});var gm=Ni(($P,Hx)=>{"use strict";Hx.exports=Gx()});var Dt=Qa(il()),qx=Qa(ov());var Av=0,Tp=1,Cv=2;var Ba=1,Rv=2,po=3,Ji=0,fn=1,Yn=2,Ai=0,us=1,bp=2,Ap=3,Cp=4,Pv=5;var Ir=100,Iv=101,Lv=102,Nv=103,Dv=104,Uv=200,Fv=201,Ov=202,Bv=203,Wc=204,Xc=205,kv=206,zv=207,Vv=208,Gv=209,Hv=210,Wv=211,Xv=212,qv=213,Yv=214,qc=0,Yc=1,Zc=2,hs=3,$c=4,Jc=5,Kc=6,jc=7,bu=0,Zv=1,$v=2,ai=0,Rp=1,Pp=2,Ip=3,Lp=4,Np=5,Dp=6,Up=7;var Fp=300,Br=301,fs=302,Au=303,Cu=304,ka=306,Qc=1e3,yi=1001,eu=1002,Ht=1003,Jv=1004;var za=1005;var Zt=1006,Ru=1007;var kr=1008;var Sn=1009,Op=1010,Bp=1011,mo=1012,Pu=1013,li=1014,ci=1015,Ci=1016,Iu=1017,Lu=1018,go=1020,kp=35902,zp=35899,Vp=1021,Gp=1022,Zn=1023,Si=1026,zr=1027,Hp=1028,Nu=1029,Vr=1030,Du=1031;var Uu=1033,Va=33776,Ga=33777,Ha=33778,Wa=33779,Fu=35840,Ou=35841,Bu=35842,ku=35843,zu=36196,Vu=37492,Gu=37496,Hu=37488,Wu=37489,Xa=37490,Xu=37491,qu=37808,Yu=37809,Zu=37810,$u=37811,Ju=37812,Ku=37813,ju=37814,Qu=37815,eh=37816,th=37817,nh=37818,ih=37819,rh=37820,sh=37821,oh=36492,ah=36494,lh=36495,ch=36283,uh=36284,qa=36285,hh=36286;var va=2300,tu=2301,Hc=2302,mp=2303,gp=2400,_p=2401,vp=2402;var Kv=3200;var fh=0,jv=1,Qi="",hn="srgb",xa="srgb-linear",ya="linear",et="srgb";var cs=7680;var xp=519,Qv=512,ex=513,tx=514,dh=515,nx=516,ix=517,ph=518,rx=519,yp=35044;var Wp="300 es",oi=2e3,oo=2001;function EM(t){for(let e=t.length-1;e>=0;--e)if(t[e]>=65535)return!0;return!1}function TM(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function Sa(t){return document.createElementNS("http://www.w3.org/1999/xhtml",t)}function sx(){let t=Sa("canvas");return t.style.display="block",t}var av={},ao=null;function Xp(...t){let e="THREE."+t.shift();ao?ao("log",e,...t):console.log(e,...t)}function ox(t){let e=t[0];if(typeof e=="string"&&e.startsWith("TSL:")){let n=t[1];n&&n.isStackTrace?t[0]+=" "+n.getLocation():t[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return t}function Re(...t){t=ox(t);let e="THREE."+t.shift();if(ao)ao("warn",e,...t);else{let n=t[0];n&&n.isStackTrace?console.warn(n.getError(e)):console.warn(e,...t)}}function Pe(...t){t=ox(t);let e="THREE."+t.shift();if(ao)ao("error",e,...t);else{let n=t[0];n&&n.isStackTrace?console.error(n.getError(e)):console.error(e,...t)}}function nu(...t){let e=t.join(" ");e in av||(av[e]=!0,Re(...t))}function ax(t,e,n){return new Promise(function(i,r){function s(){switch(t.clientWaitSync(e,t.SYNC_FLUSH_COMMANDS_BIT,0)){case t.WAIT_FAILED:r();break;case t.TIMEOUT_EXPIRED:setTimeout(s,n);break;default:i()}}setTimeout(s,n)})}var lx={[qc]:Yc,[Zc]:Kc,[$c]:jc,[hs]:Jc,[Yc]:qc,[Kc]:Zc,[jc]:$c,[Jc]:hs},Mi=class{addEventListener(e,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(n)===-1&&i[e].push(n)}hasEventListener(e,n){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(n)!==-1}removeEventListener(e,n){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(n);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let n=this._listeners;if(n===void 0)return;let i=n[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},tn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var Xd=Math.PI/180,iu=180/Math.PI;function Ya(){let t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(tn[t&255]+tn[t>>8&255]+tn[t>>16&255]+tn[t>>24&255]+"-"+tn[e&255]+tn[e>>8&255]+"-"+tn[e>>16&15|64]+tn[e>>24&255]+"-"+tn[n&63|128]+tn[n>>8&255]+"-"+tn[n>>16&255]+tn[n>>24&255]+tn[i&255]+tn[i>>8&255]+tn[i>>16&255]+tn[i>>24&255]).toLowerCase()}function Ze(t,e,n){return Math.max(e,Math.min(n,t))}function bM(t,e){return(t%e+e)%e}function qd(t,e,n){return(1-n)*t+n*e}function da(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return t/4294967295;case Uint16Array:return t/65535;case Uint8Array:return t/255;case Int32Array:return Math.max(t/2147483647,-1);case Int16Array:return Math.max(t/32767,-1);case Int8Array:return Math.max(t/127,-1);default:throw new Error("Invalid component type.")}}function vn(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return Math.round(t*4294967295);case Uint16Array:return Math.round(t*65535);case Uint8Array:return Math.round(t*255);case Int32Array:return Math.round(t*2147483647);case Int16Array:return Math.round(t*32767);case Int8Array:return Math.round(t*127);default:throw new Error("Invalid component type.")}}var Jp=class Jp{constructor(e=0,n=0){this.x=e,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,n){return this.x=e,this.y=n,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let n=this.x,i=this.y,r=e.elements;return this.x=r[0]*n+r[3]*i+r[6],this.y=r[1]*n+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,n){return this.x=Ze(this.x,e.x,n.x),this.y=Ze(this.y,e.y,n.y),this}clampScalar(e,n){return this.x=Ze(this.x,e,n),this.y=Ze(this.y,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ze(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Ze(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y;return n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this}rotateAround(e,n){let i=Math.cos(n),r=Math.sin(n),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};Jp.prototype.isVector2=!0;var Ke=Jp,wi=class{constructor(e=0,n=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=n,this._z=i,this._w=r}static slerpFlat(e,n,i,r,s,o,a){let l=i[r+0],c=i[r+1],f=i[r+2],d=i[r+3],h=s[o+0],p=s[o+1],v=s[o+2],S=s[o+3];if(d!==S||l!==h||c!==p||f!==v){let _=l*h+c*p+f*v+d*S;_<0&&(h=-h,p=-p,v=-v,S=-S,_=-_);let u=1-a;if(_<.9995){let m=Math.acos(_),x=Math.sin(m);u=Math.sin(u*m)/x,a=Math.sin(a*m)/x,l=l*u+h*a,c=c*u+p*a,f=f*u+v*a,d=d*u+S*a}else{l=l*u+h*a,c=c*u+p*a,f=f*u+v*a,d=d*u+S*a;let m=1/Math.sqrt(l*l+c*c+f*f+d*d);l*=m,c*=m,f*=m,d*=m}}e[n]=l,e[n+1]=c,e[n+2]=f,e[n+3]=d}static multiplyQuaternionsFlat(e,n,i,r,s,o){let a=i[r],l=i[r+1],c=i[r+2],f=i[r+3],d=s[o],h=s[o+1],p=s[o+2],v=s[o+3];return e[n]=a*v+f*d+l*p-c*h,e[n+1]=l*v+f*h+c*d-a*p,e[n+2]=c*v+f*p+a*h-l*d,e[n+3]=f*v-a*d-l*h-c*p,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,n,i,r){return this._x=e,this._y=n,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,n=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(i/2),f=a(r/2),d=a(s/2),h=l(i/2),p=l(r/2),v=l(s/2);switch(o){case"XYZ":this._x=h*f*d+c*p*v,this._y=c*p*d-h*f*v,this._z=c*f*v+h*p*d,this._w=c*f*d-h*p*v;break;case"YXZ":this._x=h*f*d+c*p*v,this._y=c*p*d-h*f*v,this._z=c*f*v-h*p*d,this._w=c*f*d+h*p*v;break;case"ZXY":this._x=h*f*d-c*p*v,this._y=c*p*d+h*f*v,this._z=c*f*v+h*p*d,this._w=c*f*d-h*p*v;break;case"ZYX":this._x=h*f*d-c*p*v,this._y=c*p*d+h*f*v,this._z=c*f*v-h*p*d,this._w=c*f*d+h*p*v;break;case"YZX":this._x=h*f*d+c*p*v,this._y=c*p*d+h*f*v,this._z=c*f*v-h*p*d,this._w=c*f*d-h*p*v;break;case"XZY":this._x=h*f*d-c*p*v,this._y=c*p*d-h*f*v,this._z=c*f*v+h*p*d,this._w=c*f*d+h*p*v;break;default:Re("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,n){let i=n/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let n=e.elements,i=n[0],r=n[4],s=n[8],o=n[1],a=n[5],l=n[9],c=n[2],f=n[6],d=n[10],h=i+a+d;if(h>0){let p=.5/Math.sqrt(h+1);this._w=.25/p,this._x=(f-l)*p,this._y=(s-c)*p,this._z=(o-r)*p}else if(i>a&&i>d){let p=2*Math.sqrt(1+i-a-d);this._w=(f-l)/p,this._x=.25*p,this._y=(r+o)/p,this._z=(s+c)/p}else if(a>d){let p=2*Math.sqrt(1+a-i-d);this._w=(s-c)/p,this._x=(r+o)/p,this._y=.25*p,this._z=(l+f)/p}else{let p=2*Math.sqrt(1+d-i-a);this._w=(o-r)/p,this._x=(s+c)/p,this._y=(l+f)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(e,n){let i=e.dot(n)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*n.z-e.z*n.y,this._y=e.z*n.x-e.x*n.z,this._z=e.x*n.y-e.y*n.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ze(this.dot(e),-1,1)))}rotateTowards(e,n){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,n/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=n._x,l=n._y,c=n._z,f=n._w;return this._x=i*f+o*a+r*c-s*l,this._y=r*f+o*l+s*a-i*c,this._z=s*f+o*c+i*l-r*a,this._w=o*f-i*a-r*l-s*c,this._onChangeCallback(),this}slerp(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=this.dot(e);a<0&&(i=-i,r=-r,s=-s,o=-o,a=-a);let l=1-n;if(a<.9995){let c=Math.acos(a),f=Math.sin(c);l=Math.sin(l*c)/f,n=Math.sin(n*c)/f,this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this._onChangeCallback()}else this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this.normalize();return this}slerpQuaternions(e,n,i){return this.copy(e).slerp(n,i)}random(){let e=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(n),s*Math.cos(n))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,n=0){return this._x=e[n],this._y=e[n+1],this._z=e[n+2],this._w=e[n+3],this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._w,e}fromBufferAttribute(e,n){return this._x=e.getX(n),this._y=e.getY(n),this._z=e.getZ(n),this._w=e.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},Kp=class Kp{constructor(e=0,n=0,i=0){this.x=e,this.y=n,this.z=i}set(e,n,i){return i===void 0&&(i=this.z),this.x=e,this.y=n,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,n){return this.x=e.x*n.x,this.y=e.y*n.y,this.z=e.z*n.z,this}applyEuler(e){return this.applyQuaternion(lv.setFromEuler(e))}applyAxisAngle(e,n){return this.applyQuaternion(lv.setFromAxisAngle(e,n))}applyMatrix3(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[3]*i+s[6]*r,this.y=s[1]*n+s[4]*i+s[7]*r,this.z=s[2]*n+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*n+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*n+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*n+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*n+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let n=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*r-a*i),f=2*(a*n-s*r),d=2*(s*i-o*n);return this.x=n+l*c+o*d-a*f,this.y=i+l*f+a*c-s*d,this.z=r+l*d+s*f-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[4]*i+s[8]*r,this.y=s[1]*n+s[5]*i+s[9]*r,this.z=s[2]*n+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,n){return this.x=Ze(this.x,e.x,n.x),this.y=Ze(this.y,e.y,n.y),this.z=Ze(this.z,e.z,n.z),this}clampScalar(e,n){return this.x=Ze(this.x,e,n),this.y=Ze(this.y,e,n),this.z=Ze(this.z,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ze(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,n){let i=e.x,r=e.y,s=e.z,o=n.x,a=n.y,l=n.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let n=e.lengthSq();if(n===0)return this.set(0,0,0);let i=e.dot(this)/n;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return Yd.copy(this).projectOnVector(e),this.sub(Yd)}reflect(e){return this.sub(Yd.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Ze(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return n*n+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,n,i){let r=Math.sin(n)*e;return this.x=r*Math.sin(i),this.y=Math.cos(n)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,n,i){return this.x=e*Math.sin(n),this.y=i,this.z=e*Math.cos(n),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(e){let n=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=n,this.y=i,this.z=r,this}setFromMatrixColumn(e,n){return this.fromArray(e.elements,n*4)}setFromMatrix3Column(e,n){return this.fromArray(e.elements,n*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(e),this.y=n,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};Kp.prototype.isVector3=!0;var k=Kp,Yd=new k,lv=new wi,jp=class jp{constructor(e,n,i,r,s,o,a,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c)}set(e,n,i,r,s,o,a,l,c){let f=this.elements;return f[0]=e,f[1]=r,f[2]=a,f[3]=n,f[4]=s,f[5]=l,f[6]=i,f[7]=o,f[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(e,n,i){return e.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let n=e.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[3],l=i[6],c=i[1],f=i[4],d=i[7],h=i[2],p=i[5],v=i[8],S=r[0],_=r[3],u=r[6],m=r[1],x=r[4],w=r[7],A=r[2],E=r[5],C=r[8];return s[0]=o*S+a*m+l*A,s[3]=o*_+a*x+l*E,s[6]=o*u+a*w+l*C,s[1]=c*S+f*m+d*A,s[4]=c*_+f*x+d*E,s[7]=c*u+f*w+d*C,s[2]=h*S+p*m+v*A,s[5]=h*_+p*x+v*E,s[8]=h*u+p*w+v*C,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[3]*=e,n[6]*=e,n[1]*=e,n[4]*=e,n[7]*=e,n[2]*=e,n[5]*=e,n[8]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],f=e[8];return n*o*f-n*a*c-i*s*f+i*a*l+r*s*c-r*o*l}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],f=e[8],d=f*o-a*c,h=a*l-f*s,p=c*s-o*l,v=n*d+i*h+r*p;if(v===0)return this.set(0,0,0,0,0,0,0,0,0);let S=1/v;return e[0]=d*S,e[1]=(r*c-f*i)*S,e[2]=(a*i-r*o)*S,e[3]=h*S,e[4]=(f*n-r*l)*S,e[5]=(r*s-a*n)*S,e[6]=p*S,e[7]=(i*l-c*n)*S,e[8]=(o*n-i*s)*S,this}transpose(){let e,n=this.elements;return e=n[1],n[1]=n[3],n[3]=e,e=n[2],n[2]=n[6],n[6]=e,e=n[5],n[5]=n[7],n[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let n=this.elements;return e[0]=n[0],e[1]=n[3],e[2]=n[6],e[3]=n[1],e[4]=n[4],e[5]=n[7],e[6]=n[2],e[7]=n[5],e[8]=n[8],this}setUvTransform(e,n,i,r,s,o,a){let l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*o+c*a)+o+e,-r*c,r*l,-r*(-c*o+l*a)+a+n,0,0,1),this}scale(e,n){return this.premultiply(Zd.makeScale(e,n)),this}rotate(e){return this.premultiply(Zd.makeRotation(-e)),this}translate(e,n){return this.premultiply(Zd.makeTranslation(e,n)),this}makeTranslation(e,n){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,n,0,0,1),this}makeRotation(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(e,n){return this.set(e,0,0,0,n,0,0,0,1),this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<9;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<9;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}};jp.prototype.isMatrix3=!0;var De=jp,Zd=new De,cv=new De().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),uv=new De().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function AM(){let t={enabled:!0,workingColorSpace:xa,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===et&&(r.r=$i(r.r),r.g=$i(r.g),r.b=$i(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===et&&(r.r=so(r.r),r.g=so(r.g),r.b=so(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===Qi?ya:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return nu("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),t.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return nu("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),t.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return t.define({[xa]:{primaries:e,whitePoint:i,transfer:ya,toXYZ:cv,fromXYZ:uv,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:hn},outputColorSpaceConfig:{drawingBufferColorSpace:hn}},[hn]:{primaries:e,whitePoint:i,transfer:et,toXYZ:cv,fromXYZ:uv,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:hn}}}),t}var Xe=AM();function $i(t){return t<.04045?t*.0773993808:Math.pow(t*.9478672986+.0521327014,2.4)}function so(t){return t<.0031308?t*12.92:1.055*Math.pow(t,.41666)-.055}var Ys,ru=class{static getDataURL(e,n="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{Ys===void 0&&(Ys=Sa("canvas")),Ys.width=e.width,Ys.height=e.height;let r=Ys.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=Ys}return i.toDataURL(n)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let n=Sa("canvas");n.width=e.width,n.height=e.height;let i=n.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=$i(s[o]/255)*255;return i.putImageData(r,0,0),n}else if(e.data){let n=e.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor($i(n[i]/255)*255):n[i]=$i(n[i]);return{data:n,width:e.width,height:e.height}}else return Re("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},CM=0,lo=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:CM++}),this.uuid=Ya(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?e.set(n.videoWidth,n.videoHeight,0):typeof VideoFrame<"u"&&n instanceof VideoFrame?e.set(n.displayWidth,n.displayHeight,0):n!==null?e.set(n.width,n.height,n.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push($d(r[o].image)):s.push($d(r[o]))}else s=$d(r);i.url=s}return n||(e.images[this.uuid]=i),i}};function $d(t){return typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap?ru.getDataURL(t):t.data?{data:Array.from(t.data),width:t.width,height:t.height,type:t.data.constructor.name}:(Re("Texture: Unable to serialize Texture."),{})}var RM=0,Jd=new k,xn=class t extends Mi{constructor(e=t.DEFAULT_IMAGE,n=t.DEFAULT_MAPPING,i=yi,r=yi,s=Zt,o=kr,a=Zn,l=Sn,c=t.DEFAULT_ANISOTROPY,f=Qi){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:RM++}),this.uuid=Ya(),this.name="",this.source=new lo(e),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Ke(0,0),this.repeat=new Ke(1,1),this.center=new Ke(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new De,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=f,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Jd).x}get height(){return this.source.getSize(Jd).y}get depth(){return this.source.getSize(Jd).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let n in e){let i=e[n];if(i===void 0){Re(`Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Re(`Texture.setValues(): property '${n}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Fp)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Qc:e.x=e.x-Math.floor(e.x);break;case yi:e.x=e.x<0?0:1;break;case eu:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Qc:e.y=e.y-Math.floor(e.y);break;case yi:e.y=e.y<0?0:1;break;case eu:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};xn.DEFAULT_IMAGE=null;xn.DEFAULT_MAPPING=Fp;xn.DEFAULT_ANISOTROPY=1;var Qp=class Qp{constructor(e=0,n=0,i=0,r=1){this.x=e,this.y=n,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,n,i,r){return this.x=e,this.y=n,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this.w=e.w+n.w,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this.w+=e.w*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this.w=e.w-n.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*n+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*n+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*n+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*n+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let n=Math.sqrt(1-e.w*e.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/n,this.y=e.y/n,this.z=e.z/n),this}setAxisAngleFromRotationMatrix(e){let n,i,r,s,l=e.elements,c=l[0],f=l[4],d=l[8],h=l[1],p=l[5],v=l[9],S=l[2],_=l[6],u=l[10];if(Math.abs(f-h)<.01&&Math.abs(d-S)<.01&&Math.abs(v-_)<.01){if(Math.abs(f+h)<.1&&Math.abs(d+S)<.1&&Math.abs(v+_)<.1&&Math.abs(c+p+u-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let x=(c+1)/2,w=(p+1)/2,A=(u+1)/2,E=(f+h)/4,C=(d+S)/4,g=(v+_)/4;return x>w&&x>A?x<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(x),r=E/i,s=C/i):w>A?w<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(w),i=E/r,s=g/r):A<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(A),i=C/s,r=g/s),this.set(i,r,s,n),this}let m=Math.sqrt((_-v)*(_-v)+(d-S)*(d-S)+(h-f)*(h-f));return Math.abs(m)<.001&&(m=1),this.x=(_-v)/m,this.y=(d-S)/m,this.z=(h-f)/m,this.w=Math.acos((c+p+u-1)/2),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,n){return this.x=Ze(this.x,e.x,n.x),this.y=Ze(this.y,e.y,n.y),this.z=Ze(this.z,e.z,n.z),this.w=Ze(this.w,e.w,n.w),this}clampScalar(e,n){return this.x=Ze(this.x,e,n),this.y=Ze(this.y,e,n),this.z=Ze(this.z,e,n),this.w=Ze(this.w,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ze(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this.w+=(e.w-this.w)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this.w=e.w+(n.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this.w=e[n+3],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e[n+3]=this.w,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this.w=e.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};Qp.prototype.isVector4=!0;var wt=Qp,su=class extends Mi{constructor(e=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Zt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=n,this.depth=i.depth,this.scissor=new wt(0,0,e,n),this.scissorTest=!1,this.viewport=new wt(0,0,e,n),this.textures=[];let r={width:e,height:n,depth:i.depth},s=new xn(r),o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let n={minFilter:Zt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(n.mapping=e.mapping),e.wrapS!==void 0&&(n.wrapS=e.wrapS),e.wrapT!==void 0&&(n.wrapT=e.wrapT),e.wrapR!==void 0&&(n.wrapR=e.wrapR),e.magFilter!==void 0&&(n.magFilter=e.magFilter),e.minFilter!==void 0&&(n.minFilter=e.minFilter),e.format!==void 0&&(n.format=e.format),e.type!==void 0&&(n.type=e.type),e.anisotropy!==void 0&&(n.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(n.colorSpace=e.colorSpace),e.flipY!==void 0&&(n.flipY=e.flipY),e.generateMipmaps!==void 0&&(n.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(n.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,n,i=1){if(this.width!==e||this.height!==n||this.depth!==i){this.width=e,this.height=n,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=n,this.textures[r].image.depth=i,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,n),this.scissor.set(0,0,e,n)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++){this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let r=Object.assign({},e.textures[n].image);this.textures[n].source=new lo(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},Nn=class extends su{constructor(e=1,n=1,i={}){super(e,n,i),this.isWebGLRenderTarget=!0}},Ma=class extends xn{constructor(e=null,n=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=Ht,this.minFilter=Ht,this.wrapR=yi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var ou=class extends xn{constructor(e=null,n=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=Ht,this.minFilter=Ht,this.wrapR=yi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Tu=class Tu{constructor(e,n,i,r,s,o,a,l,c,f,d,h,p,v,S,_){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c,f,d,h,p,v,S,_)}set(e,n,i,r,s,o,a,l,c,f,d,h,p,v,S,_){let u=this.elements;return u[0]=e,u[4]=n,u[8]=i,u[12]=r,u[1]=s,u[5]=o,u[9]=a,u[13]=l,u[2]=c,u[6]=f,u[10]=d,u[14]=h,u[3]=p,u[7]=v,u[11]=S,u[15]=_,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Tu().fromArray(this.elements)}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(e){let n=this.elements,i=e.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(e){let n=e.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(e,n,i){return this.determinant()===0?(e.set(1,0,0),n.set(0,1,0),i.set(0,0,1),this):(e.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(e,n,i){return this.set(e.x,n.x,i.x,0,e.y,n.y,i.y,0,e.z,n.z,i.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let n=this.elements,i=e.elements,r=1/Zs.setFromMatrixColumn(e,0).length(),s=1/Zs.setFromMatrixColumn(e,1).length(),o=1/Zs.setFromMatrixColumn(e,2).length();return n[0]=i[0]*r,n[1]=i[1]*r,n[2]=i[2]*r,n[3]=0,n[4]=i[4]*s,n[5]=i[5]*s,n[6]=i[6]*s,n[7]=0,n[8]=i[8]*o,n[9]=i[9]*o,n[10]=i[10]*o,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(e){let n=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),c=Math.sin(r),f=Math.cos(s),d=Math.sin(s);if(e.order==="XYZ"){let h=o*f,p=o*d,v=a*f,S=a*d;n[0]=l*f,n[4]=-l*d,n[8]=c,n[1]=p+v*c,n[5]=h-S*c,n[9]=-a*l,n[2]=S-h*c,n[6]=v+p*c,n[10]=o*l}else if(e.order==="YXZ"){let h=l*f,p=l*d,v=c*f,S=c*d;n[0]=h+S*a,n[4]=v*a-p,n[8]=o*c,n[1]=o*d,n[5]=o*f,n[9]=-a,n[2]=p*a-v,n[6]=S+h*a,n[10]=o*l}else if(e.order==="ZXY"){let h=l*f,p=l*d,v=c*f,S=c*d;n[0]=h-S*a,n[4]=-o*d,n[8]=v+p*a,n[1]=p+v*a,n[5]=o*f,n[9]=S-h*a,n[2]=-o*c,n[6]=a,n[10]=o*l}else if(e.order==="ZYX"){let h=o*f,p=o*d,v=a*f,S=a*d;n[0]=l*f,n[4]=v*c-p,n[8]=h*c+S,n[1]=l*d,n[5]=S*c+h,n[9]=p*c-v,n[2]=-c,n[6]=a*l,n[10]=o*l}else if(e.order==="YZX"){let h=o*l,p=o*c,v=a*l,S=a*c;n[0]=l*f,n[4]=S-h*d,n[8]=v*d+p,n[1]=d,n[5]=o*f,n[9]=-a*f,n[2]=-c*f,n[6]=p*d+v,n[10]=h-S*d}else if(e.order==="XZY"){let h=o*l,p=o*c,v=a*l,S=a*c;n[0]=l*f,n[4]=-d,n[8]=c*f,n[1]=h*d+S,n[5]=o*f,n[9]=p*d-v,n[2]=v*d-p,n[6]=a*f,n[10]=S*d+h}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(e){return this.compose(PM,e,IM)}lookAt(e,n,i){let r=this.elements;return Rn.subVectors(e,n),Rn.lengthSq()===0&&(Rn.z=1),Rn.normalize(),Er.crossVectors(i,Rn),Er.lengthSq()===0&&(Math.abs(i.z)===1?Rn.x+=1e-4:Rn.z+=1e-4,Rn.normalize(),Er.crossVectors(i,Rn)),Er.normalize(),wc.crossVectors(Rn,Er),r[0]=Er.x,r[4]=wc.x,r[8]=Rn.x,r[1]=Er.y,r[5]=wc.y,r[9]=Rn.y,r[2]=Er.z,r[6]=wc.z,r[10]=Rn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[4],l=i[8],c=i[12],f=i[1],d=i[5],h=i[9],p=i[13],v=i[2],S=i[6],_=i[10],u=i[14],m=i[3],x=i[7],w=i[11],A=i[15],E=r[0],C=r[4],g=r[8],T=r[12],P=r[1],R=r[5],D=r[9],Y=r[13],H=r[2],O=r[6],z=r[10],X=r[14],ee=r[3],te=r[7],ue=r[11],ce=r[15];return s[0]=o*E+a*P+l*H+c*ee,s[4]=o*C+a*R+l*O+c*te,s[8]=o*g+a*D+l*z+c*ue,s[12]=o*T+a*Y+l*X+c*ce,s[1]=f*E+d*P+h*H+p*ee,s[5]=f*C+d*R+h*O+p*te,s[9]=f*g+d*D+h*z+p*ue,s[13]=f*T+d*Y+h*X+p*ce,s[2]=v*E+S*P+_*H+u*ee,s[6]=v*C+S*R+_*O+u*te,s[10]=v*g+S*D+_*z+u*ue,s[14]=v*T+S*Y+_*X+u*ce,s[3]=m*E+x*P+w*H+A*ee,s[7]=m*C+x*R+w*O+A*te,s[11]=m*g+x*D+w*z+A*ue,s[15]=m*T+x*Y+w*X+A*ce,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[4]*=e,n[8]*=e,n[12]*=e,n[1]*=e,n[5]*=e,n[9]*=e,n[13]*=e,n[2]*=e,n[6]*=e,n[10]*=e,n[14]*=e,n[3]*=e,n[7]*=e,n[11]*=e,n[15]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],c=e[13],f=e[2],d=e[6],h=e[10],p=e[14],v=e[3],S=e[7],_=e[11],u=e[15],m=l*p-c*h,x=a*p-c*d,w=a*h-l*d,A=o*p-c*f,E=o*h-l*f,C=o*d-a*f;return n*(S*m-_*x+u*w)-i*(v*m-_*A+u*E)+r*(v*x-S*A+u*C)-s*(v*w-S*E+_*C)}transpose(){let e=this.elements,n;return n=e[1],e[1]=e[4],e[4]=n,n=e[2],e[2]=e[8],e[8]=n,n=e[6],e[6]=e[9],e[9]=n,n=e[3],e[3]=e[12],e[12]=n,n=e[7],e[7]=e[13],e[13]=n,n=e[11],e[11]=e[14],e[14]=n,this}setPosition(e,n,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=n,r[14]=i),this}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],f=e[8],d=e[9],h=e[10],p=e[11],v=e[12],S=e[13],_=e[14],u=e[15],m=n*a-i*o,x=n*l-r*o,w=n*c-s*o,A=i*l-r*a,E=i*c-s*a,C=r*c-s*l,g=f*S-d*v,T=f*_-h*v,P=f*u-p*v,R=d*_-h*S,D=d*u-p*S,Y=h*u-p*_,H=m*Y-x*D+w*R+A*P-E*T+C*g;if(H===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let O=1/H;return e[0]=(a*Y-l*D+c*R)*O,e[1]=(r*D-i*Y-s*R)*O,e[2]=(S*C-_*E+u*A)*O,e[3]=(h*E-d*C-p*A)*O,e[4]=(l*P-o*Y-c*T)*O,e[5]=(n*Y-r*P+s*T)*O,e[6]=(_*w-v*C-u*x)*O,e[7]=(f*C-h*w+p*x)*O,e[8]=(o*D-a*P+c*g)*O,e[9]=(i*P-n*D-s*g)*O,e[10]=(v*E-S*w+u*m)*O,e[11]=(d*w-f*E-p*m)*O,e[12]=(a*T-o*R-l*g)*O,e[13]=(n*R-i*T+r*g)*O,e[14]=(S*x-v*A-_*m)*O,e[15]=(f*A-d*x+h*m)*O,this}scale(e){let n=this.elements,i=e.x,r=e.y,s=e.z;return n[0]*=i,n[4]*=r,n[8]*=s,n[1]*=i,n[5]*=r,n[9]*=s,n[2]*=i,n[6]*=r,n[10]*=s,n[3]*=i,n[7]*=r,n[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,n=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(n,i,r))}makeTranslation(e,n,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(e){let n=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,n){let i=Math.cos(n),r=Math.sin(n),s=1-i,o=e.x,a=e.y,l=e.z,c=s*o,f=s*a;return this.set(c*o+i,c*a-r*l,c*l+r*a,0,c*a+r*l,f*a+i,f*l-r*o,0,c*l-r*a,f*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,n,i){return this.set(e,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,n,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,n,r,1,0,0,0,0,1),this}compose(e,n,i){let r=this.elements,s=n._x,o=n._y,a=n._z,l=n._w,c=s+s,f=o+o,d=a+a,h=s*c,p=s*f,v=s*d,S=o*f,_=o*d,u=a*d,m=l*c,x=l*f,w=l*d,A=i.x,E=i.y,C=i.z;return r[0]=(1-(S+u))*A,r[1]=(p+w)*A,r[2]=(v-x)*A,r[3]=0,r[4]=(p-w)*E,r[5]=(1-(h+u))*E,r[6]=(_+m)*E,r[7]=0,r[8]=(v+x)*C,r[9]=(_-m)*C,r[10]=(1-(h+S))*C,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,n,i){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinant();if(s===0)return i.set(1,1,1),n.identity(),this;let o=Zs.set(r[0],r[1],r[2]).length(),a=Zs.set(r[4],r[5],r[6]).length(),l=Zs.set(r[8],r[9],r[10]).length();s<0&&(o=-o),ii.copy(this);let c=1/o,f=1/a,d=1/l;return ii.elements[0]*=c,ii.elements[1]*=c,ii.elements[2]*=c,ii.elements[4]*=f,ii.elements[5]*=f,ii.elements[6]*=f,ii.elements[8]*=d,ii.elements[9]*=d,ii.elements[10]*=d,n.setFromRotationMatrix(ii),i.x=o,i.y=a,i.z=l,this}makePerspective(e,n,i,r,s,o,a=oi,l=!1){let c=this.elements,f=2*s/(n-e),d=2*s/(i-r),h=(n+e)/(n-e),p=(i+r)/(i-r),v,S;if(l)v=s/(o-s),S=o*s/(o-s);else if(a===oi)v=-(o+s)/(o-s),S=-2*o*s/(o-s);else if(a===oo)v=-o/(o-s),S=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=f,c[4]=0,c[8]=h,c[12]=0,c[1]=0,c[5]=d,c[9]=p,c[13]=0,c[2]=0,c[6]=0,c[10]=v,c[14]=S,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,n,i,r,s,o,a=oi,l=!1){let c=this.elements,f=2/(n-e),d=2/(i-r),h=-(n+e)/(n-e),p=-(i+r)/(i-r),v,S;if(l)v=1/(o-s),S=o/(o-s);else if(a===oi)v=-2/(o-s),S=-(o+s)/(o-s);else if(a===oo)v=-1/(o-s),S=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=f,c[4]=0,c[8]=0,c[12]=h,c[1]=0,c[5]=d,c[9]=0,c[13]=p,c[2]=0,c[6]=0,c[10]=v,c[14]=S,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<16;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<16;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e[n+9]=i[9],e[n+10]=i[10],e[n+11]=i[11],e[n+12]=i[12],e[n+13]=i[13],e[n+14]=i[14],e[n+15]=i[15],e}};Tu.prototype.isMatrix4=!0;var At=Tu,Zs=new k,ii=new At,PM=new k(0,0,0),IM=new k(1,1,1),Er=new k,wc=new k,Rn=new k,hv=new At,fv=new wi,Ki=class t{constructor(e=0,n=0,i=0,r=t.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=n,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,n,i,r=this._order){return this._x=e,this._y=n,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,n=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],f=r[9],d=r[2],h=r[6],p=r[10];switch(n){case"XYZ":this._y=Math.asin(Ze(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-f,p),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(h,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Ze(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(Ze(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-d,p),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Ze(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(h,p),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Ze(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-f,c),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-Ze(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(h,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-f,p),this._y=0);break;default:Re("Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,n,i){return hv.makeRotationFromQuaternion(e),this.setFromRotationMatrix(hv,n,i)}setFromVector3(e,n=this._order){return this.set(e.x,e.y,e.z,n)}reorder(e){return fv.setFromEuler(this),this.setFromQuaternion(fv,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Ki.DEFAULT_ORDER="XYZ";var wa=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},LM=0,dv=new k,$s=new wi,Wi=new At,Ec=new k,pa=new k,NM=new k,DM=new wi,pv=new k(1,0,0),mv=new k(0,1,0),gv=new k(0,0,1),_v={type:"added"},UM={type:"removed"},Js={type:"childadded",child:null},Kd={type:"childremoved",child:null},sn=class t extends Mi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:LM++}),this.uuid=Ya(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=t.DEFAULT_UP.clone();let e=new k,n=new Ki,i=new wi,r=new k(1,1,1);function s(){i.setFromEuler(n,!1)}function o(){n.setFromQuaternion(i,void 0,!1)}n._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new At},normalMatrix:{value:new De}}),this.matrix=new At,this.matrixWorld=new At,this.matrixAutoUpdate=t.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new wa,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,n){this.quaternion.setFromAxisAngle(e,n)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,n){return $s.setFromAxisAngle(e,n),this.quaternion.multiply($s),this}rotateOnWorldAxis(e,n){return $s.setFromAxisAngle(e,n),this.quaternion.premultiply($s),this}rotateX(e){return this.rotateOnAxis(pv,e)}rotateY(e){return this.rotateOnAxis(mv,e)}rotateZ(e){return this.rotateOnAxis(gv,e)}translateOnAxis(e,n){return dv.copy(e).applyQuaternion(this.quaternion),this.position.add(dv.multiplyScalar(n)),this}translateX(e){return this.translateOnAxis(pv,e)}translateY(e){return this.translateOnAxis(mv,e)}translateZ(e){return this.translateOnAxis(gv,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Wi.copy(this.matrixWorld).invert())}lookAt(e,n,i){e.isVector3?Ec.copy(e):Ec.set(e,n,i);let r=this.parent;this.updateWorldMatrix(!0,!1),pa.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Wi.lookAt(pa,Ec,this.up):Wi.lookAt(Ec,pa,this.up),this.quaternion.setFromRotationMatrix(Wi),r&&(Wi.extractRotation(r.matrixWorld),$s.setFromRotationMatrix(Wi),this.quaternion.premultiply($s.invert()))}add(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return e===this?(Pe("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(_v),Js.child=e,this.dispatchEvent(Js),Js.child=null):Pe("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(e);return n!==-1&&(e.parent=null,this.children.splice(n,1),e.dispatchEvent(UM),Kd.child=e,this.dispatchEvent(Kd),Kd.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Wi.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Wi.multiply(e.parent.matrixWorld)),e.applyMatrix4(Wi),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(_v),Js.child=e,this.dispatchEvent(Js),Js.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,n){if(this[e]===n)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,n);if(o!==void 0)return o}}getObjectsByProperty(e,n,i=[]){this[e]===n&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,n,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(pa,e,NM),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(pa,DM,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return e.set(n[8],n[9],n[10]).normalize()}raycast(){}traverse(e){e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverseVisible(e)}traverseAncestors(e){let n=this.parent;n!==null&&(e(n),n.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let n=e.x,i=e.y,r=e.z,s=this.matrix.elements;s[12]+=n-s[0]*n-s[4]*i-s[8]*r,s[13]+=i-s[1]*n-s[5]*i-s[9]*r,s[14]+=r-s[2]*n-s[6]*i-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].updateMatrixWorld(e)}updateWorldMatrix(e,n){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),n===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let n=e===void 0||typeof e=="string",i={};n&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,f=l.length;c<f;c++){let d=l[c];s(e.shapes,d)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(n){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),f=o(e.images),d=o(e.shapes),h=o(e.skeletons),p=o(e.animations),v=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),f.length>0&&(i.images=f),d.length>0&&(i.shapes=d),h.length>0&&(i.skeletons=h),p.length>0&&(i.animations=p),v.length>0&&(i.nodes=v)}return i.object=r,i;function o(a){let l=[];for(let c in a){let f=a[c];delete f.metadata,l.push(f)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,n=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),n===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};sn.DEFAULT_UP=new k(0,1,0);sn.DEFAULT_MATRIX_AUTO_UPDATE=!0;sn.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var In=class extends sn{constructor(){super(),this.isGroup=!0,this.type="Group"}},FM={type:"move"},co=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new In,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new In,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new k,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new k),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new In,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new k,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new k,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let n=this._hand;if(n)for(let i of e.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,n,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&n.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let S of e.hand.values()){let _=n.getJointPose(S,i),u=this._getHandJoint(c,S);_!==null&&(u.matrix.fromArray(_.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=_.radius),u.visible=_!==null}let f=c.joints["index-finger-tip"],d=c.joints["thumb-tip"],h=f.position.distanceTo(d.position),p=.02,v=.005;c.inputState.pinching&&h>p+v?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&h<=p-v&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=n.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));a!==null&&(r=n.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(FM)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,n){if(e.joints[n.jointName]===void 0){let i=new In;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[n.jointName]=i,e.add(i)}return e.joints[n.jointName]}},cx={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Tr={h:0,s:0,l:0},Tc={h:0,s:0,l:0};function jd(t,e,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?t+(e-t)*6*n:n<1/2?e:n<2/3?t+(e-t)*6*(2/3-n):t}var qe=class{constructor(e,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,n,i)}set(e,n,i){if(n===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,n,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,n=hn){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Xe.colorSpaceToWorking(this,n),this}setRGB(e,n,i,r=Xe.workingColorSpace){return this.r=e,this.g=n,this.b=i,Xe.colorSpaceToWorking(this,r),this}setHSL(e,n,i,r=Xe.workingColorSpace){if(e=bM(e,1),n=Ze(n,0,1),i=Ze(i,0,1),n===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+n):i+n-i*n,o=2*i-s;this.r=jd(o,s,e+1/3),this.g=jd(o,s,e),this.b=jd(o,s,e-1/3)}return Xe.colorSpaceToWorking(this,r),this}setStyle(e,n=hn){function i(s){s!==void 0&&parseFloat(s)<1&&Re("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,n);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,n);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,n);break;default:Re("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,n);if(o===6)return this.setHex(parseInt(s,16),n);Re("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,n);return this}setColorName(e,n=hn){let i=cx[e.toLowerCase()];return i!==void 0?this.setHex(i,n):Re("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=$i(e.r),this.g=$i(e.g),this.b=$i(e.b),this}copyLinearToSRGB(e){return this.r=so(e.r),this.g=so(e.g),this.b=so(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=hn){return Xe.workingToColorSpace(nn.copy(this),e),Math.round(Ze(nn.r*255,0,255))*65536+Math.round(Ze(nn.g*255,0,255))*256+Math.round(Ze(nn.b*255,0,255))}getHexString(e=hn){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,n=Xe.workingColorSpace){Xe.workingToColorSpace(nn.copy(this),n);let i=nn.r,r=nn.g,s=nn.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,c,f=(a+o)/2;if(a===o)l=0,c=0;else{let d=o-a;switch(c=f<=.5?d/(o+a):d/(2-o-a),o){case i:l=(r-s)/d+(r<s?6:0);break;case r:l=(s-i)/d+2;break;case s:l=(i-r)/d+4;break}l/=6}return e.h=l,e.s=c,e.l=f,e}getRGB(e,n=Xe.workingColorSpace){return Xe.workingToColorSpace(nn.copy(this),n),e.r=nn.r,e.g=nn.g,e.b=nn.b,e}getStyle(e=hn){Xe.workingToColorSpace(nn.copy(this),e);let n=nn.r,i=nn.g,r=nn.b;return e!==hn?`color(${e} ${n.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,n,i){return this.getHSL(Tr),this.setHSL(Tr.h+e,Tr.s+n,Tr.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,n){return this.r=e.r+n.r,this.g=e.g+n.g,this.b=e.b+n.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,n){return this.r+=(e.r-this.r)*n,this.g+=(e.g-this.g)*n,this.b+=(e.b-this.b)*n,this}lerpColors(e,n,i){return this.r=e.r+(n.r-e.r)*i,this.g=e.g+(n.g-e.g)*i,this.b=e.b+(n.b-e.b)*i,this}lerpHSL(e,n){this.getHSL(Tr),e.getHSL(Tc);let i=qd(Tr.h,Tc.h,n),r=qd(Tr.s,Tc.s,n),s=qd(Tr.l,Tc.l,n);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let n=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*n+s[3]*i+s[6]*r,this.g=s[1]*n+s[4]*i+s[7]*r,this.b=s[2]*n+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,n=0){return this.r=e[n],this.g=e[n+1],this.b=e[n+2],this}toArray(e=[],n=0){return e[n]=this.r,e[n+1]=this.g,e[n+2]=this.b,e}fromBufferAttribute(e,n){return this.r=e.getX(n),this.g=e.getY(n),this.b=e.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},nn=new qe;qe.NAMES=cx;var Ea=class t{constructor(e,n=1,i=1e3){this.isFog=!0,this.name="",this.color=new qe(e),this.near=n,this.far=i}clone(){return new t(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}},Ta=class extends sn{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Ki,this.environmentIntensity=1,this.environmentRotation=new Ki,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,n){return super.copy(e,n),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let n=super.toJSON(e);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(n.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(n.object.backgroundIntensity=this.backgroundIntensity),n.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(n.object.environmentIntensity=this.environmentIntensity),n.object.environmentRotation=this.environmentRotation.toArray(),n}},ri=new k,Xi=new k,Qd=new k,qi=new k,Ks=new k,js=new k,vv=new k,ep=new k,tp=new k,np=new k,ip=new wt,rp=new wt,sp=new wt,Pr=class t{constructor(e=new k,n=new k,i=new k){this.a=e,this.b=n,this.c=i}static getNormal(e,n,i,r){r.subVectors(i,n),ri.subVectors(e,n),r.cross(ri);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,n,i,r,s){ri.subVectors(r,n),Xi.subVectors(i,n),Qd.subVectors(e,n);let o=ri.dot(ri),a=ri.dot(Xi),l=ri.dot(Qd),c=Xi.dot(Xi),f=Xi.dot(Qd),d=o*c-a*a;if(d===0)return s.set(0,0,0),null;let h=1/d,p=(c*l-a*f)*h,v=(o*f-a*l)*h;return s.set(1-p-v,v,p)}static containsPoint(e,n,i,r){return this.getBarycoord(e,n,i,r,qi)===null?!1:qi.x>=0&&qi.y>=0&&qi.x+qi.y<=1}static getInterpolation(e,n,i,r,s,o,a,l){return this.getBarycoord(e,n,i,r,qi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,qi.x),l.addScaledVector(o,qi.y),l.addScaledVector(a,qi.z),l)}static getInterpolatedAttribute(e,n,i,r,s,o){return ip.setScalar(0),rp.setScalar(0),sp.setScalar(0),ip.fromBufferAttribute(e,n),rp.fromBufferAttribute(e,i),sp.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(ip,s.x),o.addScaledVector(rp,s.y),o.addScaledVector(sp,s.z),o}static isFrontFacing(e,n,i,r){return ri.subVectors(i,n),Xi.subVectors(e,n),ri.cross(Xi).dot(r)<0}set(e,n,i){return this.a.copy(e),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(e,n,i,r){return this.a.copy(e[n]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,n,i,r){return this.a.fromBufferAttribute(e,n),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return ri.subVectors(this.c,this.b),Xi.subVectors(this.a,this.b),ri.cross(Xi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return t.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,n){return t.getBarycoord(e,this.a,this.b,this.c,n)}getInterpolation(e,n,i,r,s){return t.getInterpolation(e,this.a,this.b,this.c,n,i,r,s)}containsPoint(e){return t.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return t.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,n){let i=this.a,r=this.b,s=this.c,o,a;Ks.subVectors(r,i),js.subVectors(s,i),ep.subVectors(e,i);let l=Ks.dot(ep),c=js.dot(ep);if(l<=0&&c<=0)return n.copy(i);tp.subVectors(e,r);let f=Ks.dot(tp),d=js.dot(tp);if(f>=0&&d<=f)return n.copy(r);let h=l*d-f*c;if(h<=0&&l>=0&&f<=0)return o=l/(l-f),n.copy(i).addScaledVector(Ks,o);np.subVectors(e,s);let p=Ks.dot(np),v=js.dot(np);if(v>=0&&p<=v)return n.copy(s);let S=p*c-l*v;if(S<=0&&c>=0&&v<=0)return a=c/(c-v),n.copy(i).addScaledVector(js,a);let _=f*v-p*d;if(_<=0&&d-f>=0&&p-v>=0)return vv.subVectors(s,r),a=(d-f)/(d-f+(p-v)),n.copy(r).addScaledVector(vv,a);let u=1/(_+S+h);return o=S*u,a=h*u,n.copy(i).addScaledVector(Ks,o).addScaledVector(js,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Lr=class{constructor(e=new k(1/0,1/0,1/0),n=new k(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=n}set(e,n){return this.min.copy(e),this.max.copy(n),this}setFromArray(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n+=3)this.expandByPoint(si.fromArray(e,n));return this}setFromBufferAttribute(e){this.makeEmpty();for(let n=0,i=e.count;n<i;n++)this.expandByPoint(si.fromBufferAttribute(e,n));return this}setFromPoints(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n++)this.expandByPoint(e[n]);return this}setFromCenterAndSize(e,n){let i=si.copy(n).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,n=!1){return this.makeEmpty(),this.expandByObject(e,n)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,n=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(n===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,si):si.fromBufferAttribute(s,o),si.applyMatrix4(e.matrixWorld),this.expandByPoint(si);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),bc.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),bc.copy(i.boundingBox)),bc.applyMatrix4(e.matrixWorld),this.union(bc)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],n);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,n){return n.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,si),si.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let n,i;return e.normal.x>0?(n=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(n=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(n+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(n+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(n+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(n+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),n<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(ma),Ac.subVectors(this.max,ma),Qs.subVectors(e.a,ma),eo.subVectors(e.b,ma),to.subVectors(e.c,ma),br.subVectors(eo,Qs),Ar.subVectors(to,eo),ss.subVectors(Qs,to);let n=[0,-br.z,br.y,0,-Ar.z,Ar.y,0,-ss.z,ss.y,br.z,0,-br.x,Ar.z,0,-Ar.x,ss.z,0,-ss.x,-br.y,br.x,0,-Ar.y,Ar.x,0,-ss.y,ss.x,0];return!op(n,Qs,eo,to,Ac)||(n=[1,0,0,0,1,0,0,0,1],!op(n,Qs,eo,to,Ac))?!1:(Cc.crossVectors(br,Ar),n=[Cc.x,Cc.y,Cc.z],op(n,Qs,eo,to,Ac))}clampPoint(e,n){return n.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,si).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(si).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Yi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Yi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Yi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Yi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Yi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Yi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Yi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Yi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Yi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Yi=[new k,new k,new k,new k,new k,new k,new k,new k],si=new k,bc=new Lr,Qs=new k,eo=new k,to=new k,br=new k,Ar=new k,ss=new k,ma=new k,Ac=new k,Cc=new k,os=new k;function op(t,e,n,i,r){for(let s=0,o=t.length-3;s<=o;s+=3){os.fromArray(t,s);let a=r.x*Math.abs(os.x)+r.y*Math.abs(os.y)+r.z*Math.abs(os.z),l=e.dot(os),c=n.dot(os),f=i.dot(os);if(Math.max(-Math.max(l,c,f),Math.min(l,c,f))>a)return!1}return!0}var Nt=new k,Rc=new Ke,OM=0,Ln=class extends Mi{constructor(e,n,i=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:OM++}),this.name="",this.array=e,this.itemSize=n,this.count=e!==void 0?e.length/n:0,this.normalized=i,this.usage=yp,this.updateRanges=[],this.gpuType=ci,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,n,i){e*=this.itemSize,i*=n.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=n.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)Rc.fromBufferAttribute(this,n),Rc.applyMatrix3(e),this.setXY(n,Rc.x,Rc.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)Nt.fromBufferAttribute(this,n),Nt.applyMatrix3(e),this.setXYZ(n,Nt.x,Nt.y,Nt.z);return this}applyMatrix4(e){for(let n=0,i=this.count;n<i;n++)Nt.fromBufferAttribute(this,n),Nt.applyMatrix4(e),this.setXYZ(n,Nt.x,Nt.y,Nt.z);return this}applyNormalMatrix(e){for(let n=0,i=this.count;n<i;n++)Nt.fromBufferAttribute(this,n),Nt.applyNormalMatrix(e),this.setXYZ(n,Nt.x,Nt.y,Nt.z);return this}transformDirection(e){for(let n=0,i=this.count;n<i;n++)Nt.fromBufferAttribute(this,n),Nt.transformDirection(e),this.setXYZ(n,Nt.x,Nt.y,Nt.z);return this}set(e,n=0){return this.array.set(e,n),this}getComponent(e,n){let i=this.array[e*this.itemSize+n];return this.normalized&&(i=da(i,this.array)),i}setComponent(e,n,i){return this.normalized&&(i=vn(i,this.array)),this.array[e*this.itemSize+n]=i,this}getX(e){let n=this.array[e*this.itemSize];return this.normalized&&(n=da(n,this.array)),n}setX(e,n){return this.normalized&&(n=vn(n,this.array)),this.array[e*this.itemSize]=n,this}getY(e){let n=this.array[e*this.itemSize+1];return this.normalized&&(n=da(n,this.array)),n}setY(e,n){return this.normalized&&(n=vn(n,this.array)),this.array[e*this.itemSize+1]=n,this}getZ(e){let n=this.array[e*this.itemSize+2];return this.normalized&&(n=da(n,this.array)),n}setZ(e,n){return this.normalized&&(n=vn(n,this.array)),this.array[e*this.itemSize+2]=n,this}getW(e){let n=this.array[e*this.itemSize+3];return this.normalized&&(n=da(n,this.array)),n}setW(e,n){return this.normalized&&(n=vn(n,this.array)),this.array[e*this.itemSize+3]=n,this}setXY(e,n,i){return e*=this.itemSize,this.normalized&&(n=vn(n,this.array),i=vn(i,this.array)),this.array[e+0]=n,this.array[e+1]=i,this}setXYZ(e,n,i,r){return e*=this.itemSize,this.normalized&&(n=vn(n,this.array),i=vn(i,this.array),r=vn(r,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,n,i,r,s){return e*=this.itemSize,this.normalized&&(n=vn(n,this.array),i=vn(i,this.array),r=vn(r,this.array),s=vn(s,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==yp&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var ba=class extends Ln{constructor(e,n,i){super(new Uint16Array(e),n,i)}};var Aa=class extends Ln{constructor(e,n,i){super(new Uint32Array(e),n,i)}};var Gt=class extends Ln{constructor(e,n,i){super(new Float32Array(e),n,i)}},BM=new Lr,ga=new k,ap=new k,uo=class{constructor(e=new k,n=-1){this.isSphere=!0,this.center=e,this.radius=n}set(e,n){return this.center.copy(e),this.radius=n,this}setFromPoints(e,n){let i=this.center;n!==void 0?i.copy(n):BM.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let n=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=n*n}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,n){let i=this.center.distanceToSquared(e);return n.copy(e),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;ga.subVectors(e,this.center);let n=ga.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),r=(i-this.radius)*.5;this.center.addScaledVector(ga,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(ap.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(ga.copy(e.center).add(ap)),this.expandByPoint(ga.copy(e.center).sub(ap))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},kM=0,Xn=new At,lp=new sn,no=new k,Pn=new Lr,_a=new Lr,Vt=new k,qn=class t extends Mi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:kM++}),this.uuid=Ya(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(EM(e)?Aa:ba)(e,1):this.index=e,this}setIndirect(e,n=0){return this.indirect=e,this.indirectOffset=n,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,n){return this.attributes[e]=n,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,n,i=0){this.groups.push({start:e,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,n){this.drawRange.start=e,this.drawRange.count=n}applyMatrix4(e){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(e),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new De().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Xn.makeRotationFromQuaternion(e),this.applyMatrix4(Xn),this}rotateX(e){return Xn.makeRotationX(e),this.applyMatrix4(Xn),this}rotateY(e){return Xn.makeRotationY(e),this.applyMatrix4(Xn),this}rotateZ(e){return Xn.makeRotationZ(e),this.applyMatrix4(Xn),this}translate(e,n,i){return Xn.makeTranslation(e,n,i),this.applyMatrix4(Xn),this}scale(e,n,i){return Xn.makeScale(e,n,i),this.applyMatrix4(Xn),this}lookAt(e){return lp.lookAt(e),lp.updateMatrix(),this.applyMatrix4(lp.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(no).negate(),this.translate(no.x,no.y,no.z),this}setFromPoints(e){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new Gt(i,3))}else{let i=Math.min(e.length,n.count);for(let r=0;r<i;r++){let s=e[r];n.setXYZ(r,s.x,s.y,s.z||0)}e.length>n.count&&Re("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Lr);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Pe("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new k(-1/0,-1/0,-1/0),new k(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),n)for(let i=0,r=n.length;i<r;i++){let s=n[i];Pn.setFromBufferAttribute(s),this.morphTargetsRelative?(Vt.addVectors(this.boundingBox.min,Pn.min),this.boundingBox.expandByPoint(Vt),Vt.addVectors(this.boundingBox.max,Pn.max),this.boundingBox.expandByPoint(Vt)):(this.boundingBox.expandByPoint(Pn.min),this.boundingBox.expandByPoint(Pn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Pe('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new uo);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Pe("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new k,1/0);return}if(e){let i=this.boundingSphere.center;if(Pn.setFromBufferAttribute(e),n)for(let s=0,o=n.length;s<o;s++){let a=n[s];_a.setFromBufferAttribute(a),this.morphTargetsRelative?(Vt.addVectors(Pn.min,_a.min),Pn.expandByPoint(Vt),Vt.addVectors(Pn.max,_a.max),Pn.expandByPoint(Vt)):(Pn.expandByPoint(_a.min),Pn.expandByPoint(_a.max))}Pn.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)Vt.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(Vt));if(n)for(let s=0,o=n.length;s<o;s++){let a=n[s],l=this.morphTargetsRelative;for(let c=0,f=a.count;c<f;c++)Vt.fromBufferAttribute(a,c),l&&(no.fromBufferAttribute(e,c),Vt.add(no)),r=Math.max(r,i.distanceToSquared(Vt))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&Pe('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,n=this.attributes;if(e===null||n.position===void 0||n.normal===void 0||n.uv===void 0){Pe("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,r=n.normal,s=n.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Ln(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let g=0;g<i.count;g++)a[g]=new k,l[g]=new k;let c=new k,f=new k,d=new k,h=new Ke,p=new Ke,v=new Ke,S=new k,_=new k;function u(g,T,P){c.fromBufferAttribute(i,g),f.fromBufferAttribute(i,T),d.fromBufferAttribute(i,P),h.fromBufferAttribute(s,g),p.fromBufferAttribute(s,T),v.fromBufferAttribute(s,P),f.sub(c),d.sub(c),p.sub(h),v.sub(h);let R=1/(p.x*v.y-v.x*p.y);isFinite(R)&&(S.copy(f).multiplyScalar(v.y).addScaledVector(d,-p.y).multiplyScalar(R),_.copy(d).multiplyScalar(p.x).addScaledVector(f,-v.x).multiplyScalar(R),a[g].add(S),a[T].add(S),a[P].add(S),l[g].add(_),l[T].add(_),l[P].add(_))}let m=this.groups;m.length===0&&(m=[{start:0,count:e.count}]);for(let g=0,T=m.length;g<T;++g){let P=m[g],R=P.start,D=P.count;for(let Y=R,H=R+D;Y<H;Y+=3)u(e.getX(Y+0),e.getX(Y+1),e.getX(Y+2))}let x=new k,w=new k,A=new k,E=new k;function C(g){A.fromBufferAttribute(r,g),E.copy(A);let T=a[g];x.copy(T),x.sub(A.multiplyScalar(A.dot(T))).normalize(),w.crossVectors(E,T);let R=w.dot(l[g])<0?-1:1;o.setXYZW(g,x.x,x.y,x.z,R)}for(let g=0,T=m.length;g<T;++g){let P=m[g],R=P.start,D=P.count;for(let Y=R,H=R+D;Y<H;Y+=3)C(e.getX(Y+0)),C(e.getX(Y+1)),C(e.getX(Y+2))}}computeVertexNormals(){let e=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Ln(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let h=0,p=i.count;h<p;h++)i.setXYZ(h,0,0,0);let r=new k,s=new k,o=new k,a=new k,l=new k,c=new k,f=new k,d=new k;if(e)for(let h=0,p=e.count;h<p;h+=3){let v=e.getX(h+0),S=e.getX(h+1),_=e.getX(h+2);r.fromBufferAttribute(n,v),s.fromBufferAttribute(n,S),o.fromBufferAttribute(n,_),f.subVectors(o,s),d.subVectors(r,s),f.cross(d),a.fromBufferAttribute(i,v),l.fromBufferAttribute(i,S),c.fromBufferAttribute(i,_),a.add(f),l.add(f),c.add(f),i.setXYZ(v,a.x,a.y,a.z),i.setXYZ(S,l.x,l.y,l.z),i.setXYZ(_,c.x,c.y,c.z)}else for(let h=0,p=n.count;h<p;h+=3)r.fromBufferAttribute(n,h+0),s.fromBufferAttribute(n,h+1),o.fromBufferAttribute(n,h+2),f.subVectors(o,s),d.subVectors(r,s),f.cross(d),i.setXYZ(h+0,f.x,f.y,f.z),i.setXYZ(h+1,f.x,f.y,f.z),i.setXYZ(h+2,f.x,f.y,f.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let n=0,i=e.count;n<i;n++)Vt.fromBufferAttribute(e,n),Vt.normalize(),e.setXYZ(n,Vt.x,Vt.y,Vt.z)}toNonIndexed(){function e(a,l){let c=a.array,f=a.itemSize,d=a.normalized,h=new c.constructor(l.length*f),p=0,v=0;for(let S=0,_=l.length;S<_;S++){a.isInterleavedBufferAttribute?p=l[S]*a.data.stride+a.offset:p=l[S]*f;for(let u=0;u<f;u++)h[v++]=c[p++]}return new Ln(h,f,d)}if(this.index===null)return Re("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new t,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],c=e(l,i);n.setAttribute(a,c)}let s=this.morphAttributes;for(let a in s){let l=[],c=s[a];for(let f=0,d=c.length;f<d;f++){let h=c[f],p=e(h,i);l.push(p)}n.morphAttributes[a]=l}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let n=this.index;n!==null&&(e.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];e.data.attributes[l]=c.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],f=[];for(let d=0,h=c.length;d<h;d++){let p=c[d];f.push(p.toJSON(e.data))}f.length>0&&(r[l]=f,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let c in r){let f=r[c];this.setAttribute(c,f.clone(n))}let s=e.morphAttributes;for(let c in s){let f=[],d=s[c];for(let h=0,p=d.length;h<p;h++)f.push(d[h].clone(n));this.morphAttributes[c]=f}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,f=o.length;c<f;c++){let d=o[c];this.addGroup(d.start,d.count,d.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var zM=0,Nr=class extends Mi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:zM++}),this.uuid=Ya(),this.name="",this.type="Material",this.blending=us,this.side=Ji,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Wc,this.blendDst=Xc,this.blendEquation=Ir,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new qe(0,0,0),this.blendAlpha=0,this.depthFunc=hs,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=xp,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=cs,this.stencilZFail=cs,this.stencilZPass=cs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let n in e){let i=e[n];if(i===void 0){Re(`Material: parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Re(`Material: '${n}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";n&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==us&&(i.blending=this.blending),this.side!==Ji&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==Wc&&(i.blendSrc=this.blendSrc),this.blendDst!==Xc&&(i.blendDst=this.blendDst),this.blendEquation!==Ir&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==hs&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==xp&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==cs&&(i.stencilFail=this.stencilFail),this.stencilZFail!==cs&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==cs&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(n){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let n=e.clippingPlanes,i=null;if(n!==null){let r=n.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=n[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var Zi=new k,cp=new k,Pc=new k,Cr=new k,up=new k,Ic=new k,hp=new k,au=class{constructor(e=new k,n=new k(0,0,-1)){this.origin=e,this.direction=n}set(e,n){return this.origin.copy(e),this.direction.copy(n),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,n){return n.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Zi)),this}closestPointToPoint(e,n){n.subVectors(e,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let n=Zi.subVectors(e,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(e):(Zi.copy(this.origin).addScaledVector(this.direction,n),Zi.distanceToSquared(e))}distanceSqToSegment(e,n,i,r){cp.copy(e).add(n).multiplyScalar(.5),Pc.copy(n).sub(e).normalize(),Cr.copy(this.origin).sub(cp);let s=e.distanceTo(n)*.5,o=-this.direction.dot(Pc),a=Cr.dot(this.direction),l=-Cr.dot(Pc),c=Cr.lengthSq(),f=Math.abs(1-o*o),d,h,p,v;if(f>0)if(d=o*l-a,h=o*a-l,v=s*f,d>=0)if(h>=-v)if(h<=v){let S=1/f;d*=S,h*=S,p=d*(d+o*h+2*a)+h*(o*d+h+2*l)+c}else h=s,d=Math.max(0,-(o*h+a)),p=-d*d+h*(h+2*l)+c;else h=-s,d=Math.max(0,-(o*h+a)),p=-d*d+h*(h+2*l)+c;else h<=-v?(d=Math.max(0,-(-o*s+a)),h=d>0?-s:Math.min(Math.max(-s,-l),s),p=-d*d+h*(h+2*l)+c):h<=v?(d=0,h=Math.min(Math.max(-s,-l),s),p=h*(h+2*l)+c):(d=Math.max(0,-(o*s+a)),h=d>0?s:Math.min(Math.max(-s,-l),s),p=-d*d+h*(h+2*l)+c);else h=o>0?-s:s,d=Math.max(0,-(o*h+a)),p=-d*d+h*(h+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,d),r&&r.copy(cp).addScaledVector(Pc,h),p}intersectSphere(e,n){Zi.subVectors(e.center,this.origin);let i=Zi.dot(this.direction),r=Zi.dot(Zi)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,n):this.at(a,n)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let n=e.normal.dot(this.direction);if(n===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/n;return i>=0?i:null}intersectPlane(e,n){let i=this.distanceToPlane(e);return i===null?null:this.at(i,n)}intersectsPlane(e){let n=e.distanceToPoint(this.origin);return n===0||e.normal.dot(this.direction)*n<0}intersectBox(e,n){let i,r,s,o,a,l,c=1/this.direction.x,f=1/this.direction.y,d=1/this.direction.z,h=this.origin;return c>=0?(i=(e.min.x-h.x)*c,r=(e.max.x-h.x)*c):(i=(e.max.x-h.x)*c,r=(e.min.x-h.x)*c),f>=0?(s=(e.min.y-h.y)*f,o=(e.max.y-h.y)*f):(s=(e.max.y-h.y)*f,o=(e.min.y-h.y)*f),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),d>=0?(a=(e.min.z-h.z)*d,l=(e.max.z-h.z)*d):(a=(e.max.z-h.z)*d,l=(e.min.z-h.z)*d),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,n)}intersectsBox(e){return this.intersectBox(e,Zi)!==null}intersectTriangle(e,n,i,r,s){up.subVectors(n,e),Ic.subVectors(i,e),hp.crossVectors(up,Ic);let o=this.direction.dot(hp),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Cr.subVectors(this.origin,e);let l=a*this.direction.dot(Ic.crossVectors(Cr,Ic));if(l<0)return null;let c=a*this.direction.dot(up.cross(Cr));if(c<0||l+c>o)return null;let f=-a*Cr.dot(hp);return f<0?null:this.at(f/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Ca=class extends Nr{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new qe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ki,this.combine=bu,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},xv=new At,as=new au,Lc=new uo,yv=new k,Nc=new k,Dc=new k,Uc=new k,fp=new k,Fc=new k,Sv=new k,Oc=new k,yn=class extends sn{constructor(e=new qn,n=new Ca){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,n){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;n.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){Fc.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let f=a[l],d=s[l];f!==0&&(fp.fromBufferAttribute(d,e),o?Fc.addScaledVector(fp,f):Fc.addScaledVector(fp.sub(n),f))}n.add(Fc)}return n}raycast(e,n){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Lc.copy(i.boundingSphere),Lc.applyMatrix4(s),as.copy(e.ray).recast(e.near),!(Lc.containsPoint(as.origin)===!1&&(as.intersectSphere(Lc,yv)===null||as.origin.distanceToSquared(yv)>(e.far-e.near)**2))&&(xv.copy(s).invert(),as.copy(e.ray).applyMatrix4(xv),!(i.boundingBox!==null&&as.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,n,as)))}_computeIntersections(e,n,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,f=s.attributes.uv1,d=s.attributes.normal,h=s.groups,p=s.drawRange;if(a!==null)if(Array.isArray(o))for(let v=0,S=h.length;v<S;v++){let _=h[v],u=o[_.materialIndex],m=Math.max(_.start,p.start),x=Math.min(a.count,Math.min(_.start+_.count,p.start+p.count));for(let w=m,A=x;w<A;w+=3){let E=a.getX(w),C=a.getX(w+1),g=a.getX(w+2);r=Bc(this,u,e,i,c,f,d,E,C,g),r&&(r.faceIndex=Math.floor(w/3),r.face.materialIndex=_.materialIndex,n.push(r))}}else{let v=Math.max(0,p.start),S=Math.min(a.count,p.start+p.count);for(let _=v,u=S;_<u;_+=3){let m=a.getX(_),x=a.getX(_+1),w=a.getX(_+2);r=Bc(this,o,e,i,c,f,d,m,x,w),r&&(r.faceIndex=Math.floor(_/3),n.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let v=0,S=h.length;v<S;v++){let _=h[v],u=o[_.materialIndex],m=Math.max(_.start,p.start),x=Math.min(l.count,Math.min(_.start+_.count,p.start+p.count));for(let w=m,A=x;w<A;w+=3){let E=w,C=w+1,g=w+2;r=Bc(this,u,e,i,c,f,d,E,C,g),r&&(r.faceIndex=Math.floor(w/3),r.face.materialIndex=_.materialIndex,n.push(r))}}else{let v=Math.max(0,p.start),S=Math.min(l.count,p.start+p.count);for(let _=v,u=S;_<u;_+=3){let m=_,x=_+1,w=_+2;r=Bc(this,o,e,i,c,f,d,m,x,w),r&&(r.faceIndex=Math.floor(_/3),n.push(r))}}}};function VM(t,e,n,i,r,s,o,a){let l;if(e.side===fn?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===Ji,a),l===null)return null;Oc.copy(a),Oc.applyMatrix4(t.matrixWorld);let c=n.ray.origin.distanceTo(Oc);return c<n.near||c>n.far?null:{distance:c,point:Oc.clone(),object:t}}function Bc(t,e,n,i,r,s,o,a,l,c){t.getVertexPosition(a,Nc),t.getVertexPosition(l,Dc),t.getVertexPosition(c,Uc);let f=VM(t,e,n,i,Nc,Dc,Uc,Sv);if(f){let d=new k;Pr.getBarycoord(Sv,Nc,Dc,Uc,d),r&&(f.uv=Pr.getInterpolatedAttribute(r,a,l,c,d,new Ke)),s&&(f.uv1=Pr.getInterpolatedAttribute(s,a,l,c,d,new Ke)),o&&(f.normal=Pr.getInterpolatedAttribute(o,a,l,c,d,new k),f.normal.dot(i.direction)>0&&f.normal.multiplyScalar(-1));let h={a,b:l,c,normal:new k,materialIndex:0};Pr.getNormal(Nc,Dc,Uc,h.normal),f.face=h,f.barycoord=d}return f}var lu=class extends xn{constructor(e=null,n=1,i=1,r,s,o,a,l,c=Ht,f=Ht,d,h){super(null,o,a,l,c,f,r,s,d,h),this.isDataTexture=!0,this.image={data:e,width:n,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var dp=new k,GM=new k,HM=new De,xi=class{constructor(e=new k(1,0,0),n=0){this.isPlane=!0,this.normal=e,this.constant=n}set(e,n){return this.normal.copy(e),this.constant=n,this}setComponents(e,n,i,r){return this.normal.set(e,n,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,n){return this.normal.copy(e),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(e,n,i){let r=dp.subVectors(i,n).cross(GM.subVectors(e,n)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,n){return n.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,n,i=!0){let r=e.delta(dp),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?n.copy(e.start):null;let o=-(e.start.dot(this.normal)+this.constant)/s;return i===!0&&(o<0||o>1)?null:n.copy(e.start).addScaledVector(r,o)}intersectsLine(e){let n=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return n<0&&i>0||i<0&&n>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,n){let i=n||HM.getNormalMatrix(e),r=this.coplanarPoint(dp).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},ls=new uo,WM=new Ke(.5,.5),kc=new k,ho=class{constructor(e=new xi,n=new xi,i=new xi,r=new xi,s=new xi,o=new xi){this.planes=[e,n,i,r,s,o]}set(e,n,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(n),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,n=oi,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],c=s[3],f=s[4],d=s[5],h=s[6],p=s[7],v=s[8],S=s[9],_=s[10],u=s[11],m=s[12],x=s[13],w=s[14],A=s[15];if(r[0].setComponents(c-o,p-f,u-v,A-m).normalize(),r[1].setComponents(c+o,p+f,u+v,A+m).normalize(),r[2].setComponents(c+a,p+d,u+S,A+x).normalize(),r[3].setComponents(c-a,p-d,u-S,A-x).normalize(),i)r[4].setComponents(l,h,_,w).normalize(),r[5].setComponents(c-l,p-h,u-_,A-w).normalize();else if(r[4].setComponents(c-l,p-h,u-_,A-w).normalize(),n===oi)r[5].setComponents(c+l,p+h,u+_,A+w).normalize();else if(n===oo)r[5].setComponents(l,h,_,w).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ls.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let n=e.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),ls.copy(n.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ls)}intersectsSprite(e){ls.center.set(0,0,0);let n=WM.distanceTo(e.center);return ls.radius=.7071067811865476+n,ls.applyMatrix4(e.matrixWorld),this.intersectsSphere(ls)}intersectsSphere(e){let n=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(n[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let n=this.planes;for(let i=0;i<6;i++){let r=n[i];if(kc.x=r.normal.x>0?e.max.x:e.min.x,kc.y=r.normal.y>0?e.max.y:e.min.y,kc.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(kc)<0)return!1}return!0}containsPoint(e){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var Ra=class extends xn{constructor(e=[],n=Br,i,r,s,o,a,l,c,f){super(e,n,i,r,s,o,a,l,c,f),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}};var ji=class extends xn{constructor(e,n,i=li,r,s,o,a=Ht,l=Ht,c,f=Si,d=1){if(f!==Si&&f!==zr)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:n,depth:d};super(h,r,s,o,a,l,f,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new lo(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let n=super.toJSON(e);return this.compareFunction!==null&&(n.compareFunction=this.compareFunction),n}},cu=class extends ji{constructor(e,n=li,i=Br,r,s,o=Ht,a=Ht,l,c=Si){let f={width:e,height:e,depth:1},d=[f,f,f,f,f,f];super(e,e,n,i,r,s,o,a,l,c),this.image=d,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Pa=class extends xn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Ei=class t extends qn{constructor(e=1,n=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:n,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],c=[],f=[],d=[],h=0,p=0;v("z","y","x",-1,-1,i,n,e,o,s,0),v("z","y","x",1,-1,i,n,-e,o,s,1),v("x","z","y",1,1,e,i,n,r,o,2),v("x","z","y",1,-1,e,i,-n,r,o,3),v("x","y","z",1,-1,e,n,i,r,s,4),v("x","y","z",-1,-1,e,n,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new Gt(c,3)),this.setAttribute("normal",new Gt(f,3)),this.setAttribute("uv",new Gt(d,2));function v(S,_,u,m,x,w,A,E,C,g,T){let P=w/C,R=A/g,D=w/2,Y=A/2,H=E/2,O=C+1,z=g+1,X=0,ee=0,te=new k;for(let ue=0;ue<z;ue++){let ce=ue*R-Y;for(let Se=0;Se<O;Se++){let Ye=Se*P-D;te[S]=Ye*m,te[_]=ce*x,te[u]=H,c.push(te.x,te.y,te.z),te[S]=0,te[_]=0,te[u]=E>0?1:-1,f.push(te.x,te.y,te.z),d.push(Se/C),d.push(1-ue/g),X+=1}}for(let ue=0;ue<g;ue++)for(let ce=0;ce<C;ce++){let Se=h+ce+O*ue,Ye=h+ce+O*(ue+1),Qe=h+(ce+1)+O*(ue+1),Ie=h+(ce+1)+O*ue;l.push(Se,Ye,Ie),l.push(Ye,Qe,Ie),ee+=6}a.addGroup(p,ee,T),p+=ee,h+=X}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var Ti=class t extends qn{constructor(e=1,n=1,i=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:n,height:i,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};let c=this;r=Math.floor(r),s=Math.floor(s);let f=[],d=[],h=[],p=[],v=0,S=[],_=i/2,u=0;m(),o===!1&&(e>0&&x(!0),n>0&&x(!1)),this.setIndex(f),this.setAttribute("position",new Gt(d,3)),this.setAttribute("normal",new Gt(h,3)),this.setAttribute("uv",new Gt(p,2));function m(){let w=new k,A=new k,E=0,C=(n-e)/i;for(let g=0;g<=s;g++){let T=[],P=g/s,R=P*(n-e)+e;for(let D=0;D<=r;D++){let Y=D/r,H=Y*l+a,O=Math.sin(H),z=Math.cos(H);A.x=R*O,A.y=-P*i+_,A.z=R*z,d.push(A.x,A.y,A.z),w.set(O,C,z).normalize(),h.push(w.x,w.y,w.z),p.push(Y,1-P),T.push(v++)}S.push(T)}for(let g=0;g<r;g++)for(let T=0;T<s;T++){let P=S[T][g],R=S[T+1][g],D=S[T+1][g+1],Y=S[T][g+1];(e>0||T!==0)&&(f.push(P,R,Y),E+=3),(n>0||T!==s-1)&&(f.push(R,D,Y),E+=3)}c.addGroup(u,E,0),u+=E}function x(w){let A=v,E=new Ke,C=new k,g=0,T=w===!0?e:n,P=w===!0?1:-1;for(let D=1;D<=r;D++)d.push(0,_*P,0),h.push(0,P,0),p.push(.5,.5),v++;let R=v;for(let D=0;D<=r;D++){let H=D/r*l+a,O=Math.cos(H),z=Math.sin(H);C.x=T*z,C.y=_*P,C.z=T*O,d.push(C.x,C.y,C.z),h.push(0,P,0),E.x=O*.5+.5,E.y=z*.5*P+.5,p.push(E.x,E.y),v++}for(let D=0;D<r;D++){let Y=A+D,H=R+D;w===!0?f.push(H,H+1,Y):f.push(H+1,H,Y),g+=3}c.addGroup(u,g,w===!0?1:2),u+=g}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},Dr=class t extends Ti{constructor(e=1,n=1,i=32,r=1,s=!1,o=0,a=Math.PI*2){super(0,e,n,i,r,s,o,a),this.type="ConeGeometry",this.parameters={radius:e,height:n,radialSegments:i,heightSegments:r,openEnded:s,thetaStart:o,thetaLength:a}}static fromJSON(e){return new t(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var bi=class t extends qn{constructor(e=1,n=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:n,widthSegments:i,heightSegments:r};let s=e/2,o=n/2,a=Math.floor(i),l=Math.floor(r),c=a+1,f=l+1,d=e/a,h=n/l,p=[],v=[],S=[],_=[];for(let u=0;u<f;u++){let m=u*h-o;for(let x=0;x<c;x++){let w=x*d-s;v.push(w,-m,0),S.push(0,0,1),_.push(x/a),_.push(1-u/l)}}for(let u=0;u<l;u++)for(let m=0;m<a;m++){let x=m+c*u,w=m+c*(u+1),A=m+1+c*(u+1),E=m+1+c*u;p.push(x,w,E),p.push(w,A,E)}this.setIndex(p),this.setAttribute("position",new Gt(v,3)),this.setAttribute("normal",new Gt(S,3)),this.setAttribute("uv",new Gt(_,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.widthSegments,e.heightSegments)}};var Ia=class t extends qn{constructor(e=1,n=32,i=16,r=0,s=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:n,heightSegments:i,phiStart:r,phiLength:s,thetaStart:o,thetaLength:a},n=Math.max(3,Math.floor(n)),i=Math.max(2,Math.floor(i));let l=Math.min(o+a,Math.PI),c=0,f=[],d=new k,h=new k,p=[],v=[],S=[],_=[];for(let u=0;u<=i;u++){let m=[],x=u/i,w=0;u===0&&o===0?w=.5/n:u===i&&l===Math.PI&&(w=-.5/n);for(let A=0;A<=n;A++){let E=A/n;d.x=-e*Math.cos(r+E*s)*Math.sin(o+x*a),d.y=e*Math.cos(o+x*a),d.z=e*Math.sin(r+E*s)*Math.sin(o+x*a),v.push(d.x,d.y,d.z),h.copy(d).normalize(),S.push(h.x,h.y,h.z),_.push(E+w,1-x),m.push(c++)}f.push(m)}for(let u=0;u<i;u++)for(let m=0;m<n;m++){let x=f[u][m+1],w=f[u][m],A=f[u+1][m],E=f[u+1][m+1];(u!==0||o>0)&&p.push(x,w,E),(u!==i-1||l<Math.PI)&&p.push(w,A,E)}this.setIndex(p),this.setAttribute("position",new Gt(v,3)),this.setAttribute("normal",new Gt(S,3)),this.setAttribute("uv",new Gt(_,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};function ds(t){let e={};for(let n in t){e[n]={};for(let i in t[n]){let r=t[n][i];if(Mv(r))r.isRenderTargetTexture?(Re("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[n][i]=null):e[n][i]=r.clone();else if(Array.isArray(r))if(Mv(r[0])){let s=[];for(let o=0,a=r.length;o<a;o++)s[o]=r[o].clone();e[n][i]=s}else e[n][i]=r.slice();else e[n][i]=r}}return e}function on(t){let e={};for(let n=0;n<t.length;n++){let i=ds(t[n]);for(let r in i)e[r]=i[r]}return e}function Mv(t){return t&&(t.isColor||t.isMatrix3||t.isMatrix4||t.isVector2||t.isVector3||t.isVector4||t.isTexture||t.isQuaternion)}function XM(t){let e=[];for(let n=0;n<t.length;n++)e.push(t[n].clone());return e}function qp(t){let e=t.getRenderTarget();return e===null?t.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:Xe.workingColorSpace}var ux={clone:ds,merge:on},qM=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,YM=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Dn=class extends Nr{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=qM,this.fragmentShader=YM,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=ds(e.uniforms),this.uniformsGroups=XM(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let n=super.toJSON(e);n.glslVersion=this.glslVersion,n.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?n.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?n.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?n.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?n.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?n.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?n.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?n.uniforms[r]={type:"m4",value:o.toArray()}:n.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}},uu=class extends Dn{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}};var La=class extends Nr{constructor(e){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new qe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new qe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=fh,this.normalScale=new Ke(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ki,this.combine=bu,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.envMapIntensity=e.envMapIntensity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},hu=class extends Nr{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Kv,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},fu=class extends Nr{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function zc(t,e){return!t||t.constructor===e?t:typeof e.BYTES_PER_ELEMENT=="number"?new e(t):Array.prototype.slice.call(t)}var Ur=class{constructor(e,n,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let n=this.parameterPositions,i=this._cachedIndex,r=n[i],s=n[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=n[++i],e<r)break t}o=n.length;break n}if(!(e>=s)){let a=n[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=n[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<n[a]?o=a:i=a+1}if(r=n[i],s=n[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let n=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)n[o]=i[s+o];return n}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},du=class extends Ur{constructor(e,n,i,r){super(e,n,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:gp,endingEnd:gp}}intervalChanged_(e,n,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case _p:s=e,a=2*n-i;break;case vp:s=r.length-2,a=n+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case _p:o=e,l=2*i-n;break;case vp:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=n}let c=(i-n)*.5,f=this.valueSize;this._weightPrev=c/(n-a),this._weightNext=c/(l-i),this._offsetPrev=s*f,this._offsetNext=o*f}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,f=this._offsetPrev,d=this._offsetNext,h=this._weightPrev,p=this._weightNext,v=(i-n)/(r-n),S=v*v,_=S*v,u=-h*_+2*h*S-h*v,m=(1+h)*_+(-1.5-2*h)*S+(-.5+h)*v+1,x=(-1-p)*_+(1.5+p)*S+.5*v,w=p*_-p*S;for(let A=0;A!==a;++A)s[A]=u*o[f+A]+m*o[c+A]+x*o[l+A]+w*o[d+A];return s}},pu=class extends Ur{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,f=(i-n)/(r-n),d=1-f;for(let h=0;h!==a;++h)s[h]=o[c+h]*d+o[l+h]*f;return s}},mu=class extends Ur{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},gu=class extends Ur{interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,f=this.settings||this.DefaultSettings_,d=f.inTangents,h=f.outTangents;if(!d||!h){let S=(i-n)/(r-n),_=1-S;for(let u=0;u!==a;++u)s[u]=o[c+u]*_+o[l+u]*S;return s}let p=a*2,v=e-1;for(let S=0;S!==a;++S){let _=o[c+S],u=o[l+S],m=v*p+S*2,x=h[m],w=h[m+1],A=e*p+S*2,E=d[A],C=d[A+1],g=(i-n)/(r-n),T,P,R,D,Y;for(let H=0;H<8;H++){T=g*g,P=T*g,R=1-g,D=R*R,Y=D*R;let z=Y*n+3*D*g*x+3*R*T*E+P*r-i;if(Math.abs(z)<1e-10)break;let X=3*D*(x-n)+6*R*g*(E-x)+3*T*(r-E);if(Math.abs(X)<1e-10)break;g=g-z/X,g=Math.max(0,Math.min(1,g))}s[S]=Y*_+3*D*g*w+3*R*T*C+P*u}return s}},Un=class{constructor(e,n,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=zc(n,this.TimeBufferType),this.values=zc(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let n=e.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(e);else{i={name:e.name,times:zc(e.times,Array),values:zc(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new mu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new pu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new du(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let n=new gu(this.times,this.values,this.getValueSize(),e);return this.settings&&(n.settings=this.settings),n}setInterpolation(e){let n;switch(e){case va:n=this.InterpolantFactoryMethodDiscrete;break;case tu:n=this.InterpolantFactoryMethodLinear;break;case Hc:n=this.InterpolantFactoryMethodSmooth;break;case mp:n=this.InterpolantFactoryMethodBezier;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return Re("KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return va;case this.InterpolantFactoryMethodLinear:return tu;case this.InterpolantFactoryMethodSmooth:return Hc;case this.InterpolantFactoryMethodBezier:return mp}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]+=e}return this}scale(e){if(e!==1){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]*=e}return this}trim(e,n){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>n;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(Pe("KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(Pe("KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){Pe("KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){Pe("KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&TM(r))for(let a=0,l=r.length;a!==l;++a){let c=r[a];if(isNaN(c)){Pe("KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===Hc,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,c=e[a],f=e[a+1];if(c!==f&&(a!==1||c!==e[0]))if(r)l=!0;else{let d=a*i,h=d-i,p=d+i;for(let v=0;v!==i;++v){let S=n[d+v];if(S!==n[h+v]||S!==n[p+v]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let d=a*i,h=o*i;for(let p=0;p!==i;++p)n[h+p]=n[d+p]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,c=0;c!==i;++c)n[l+c]=n[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=n.slice(0,o*i)):(this.times=e,this.values=n),this}clone(){let e=this.times.slice(),n=this.values.slice(),i=this.constructor,r=new i(this.name,e,n);return r.createInterpolant=this.createInterpolant,r}};Un.prototype.ValueTypeName="";Un.prototype.TimeBufferType=Float32Array;Un.prototype.ValueBufferType=Float32Array;Un.prototype.DefaultInterpolation=tu;var Fr=class extends Un{constructor(e,n,i){super(e,n,i)}};Fr.prototype.ValueTypeName="bool";Fr.prototype.ValueBufferType=Array;Fr.prototype.DefaultInterpolation=va;Fr.prototype.InterpolantFactoryMethodLinear=void 0;Fr.prototype.InterpolantFactoryMethodSmooth=void 0;var _u=class extends Un{constructor(e,n,i,r){super(e,n,i,r)}};_u.prototype.ValueTypeName="color";var vu=class extends Un{constructor(e,n,i,r){super(e,n,i,r)}};vu.prototype.ValueTypeName="number";var xu=class extends Ur{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-n)/(r-n),c=e*a;for(let f=c+a;c!==f;c+=4)wi.slerpFlat(s,0,o,c-a,o,c,l);return s}},Na=class extends Un{constructor(e,n,i,r){super(e,n,i,r)}InterpolantFactoryMethodLinear(e){return new xu(this.times,this.values,this.getValueSize(),e)}};Na.prototype.ValueTypeName="quaternion";Na.prototype.InterpolantFactoryMethodSmooth=void 0;var Or=class extends Un{constructor(e,n,i){super(e,n,i)}};Or.prototype.ValueTypeName="string";Or.prototype.ValueBufferType=Array;Or.prototype.DefaultInterpolation=va;Or.prototype.InterpolantFactoryMethodLinear=void 0;Or.prototype.InterpolantFactoryMethodSmooth=void 0;var yu=class extends Un{constructor(e,n,i,r){super(e,n,i,r)}};yu.prototype.ValueTypeName="vector";var Su=class{constructor(e,n,i){let r=this,s=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=n,this.onError=i,this._abortController=null,this.itemStart=function(f){a++,s===!1&&r.onStart!==void 0&&r.onStart(f,o,a),s=!0},this.itemEnd=function(f){o++,r.onProgress!==void 0&&r.onProgress(f,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(f){r.onError!==void 0&&r.onError(f)},this.resolveURL=function(f){return l?l(f):f},this.setURLModifier=function(f){return l=f,this},this.addHandler=function(f,d){return c.push(f,d),this},this.removeHandler=function(f){let d=c.indexOf(f);return d!==-1&&c.splice(d,2),this},this.getHandler=function(f){for(let d=0,h=c.length;d<h;d+=2){let p=c[d],v=c[d+1];if(p.global&&(p.lastIndex=0),p.test(f))return v}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},hx=new Su,Mu=class{constructor(e){this.manager=e!==void 0?e:hx,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,n){let i=this;return new Promise(function(r,s){i.load(e,r,n,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Mu.DEFAULT_MATERIAL_NAME="__DEFAULT";var Da=class extends sn{constructor(e,n=1){super(),this.isLight=!0,this.type="Light",this.color=new qe(e),this.intensity=n}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,n){return super.copy(e,n),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let n=super.toJSON(e);return n.object.color=this.color.getHex(),n.object.intensity=this.intensity,n}},Ua=class extends Da{constructor(e,n,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(sn.DEFAULT_UP),this.updateMatrix(),this.groundColor=new qe(n)}copy(e,n){return super.copy(e,n),this.groundColor.copy(e.groundColor),this}toJSON(e){let n=super.toJSON(e);return n.object.groundColor=this.groundColor.getHex(),n}},pp=new At,wv=new k,Ev=new k,Sp=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ke(512,512),this.mapType=Sn,this.map=null,this.mapPass=null,this.matrix=new At,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ho,this._frameExtents=new Ke(1,1),this._viewportCount=1,this._viewports=[new wt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let n=this.camera,i=this.matrix;wv.setFromMatrixPosition(e.matrixWorld),n.position.copy(wv),Ev.setFromMatrixPosition(e.target.matrixWorld),n.lookAt(Ev),n.updateMatrixWorld(),pp.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(pp,n.coordinateSystem,n.reversedDepth),n.coordinateSystem===oo||n.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(pp)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},Vc=new k,Gc=new wi,vi=new k,Fa=class extends sn{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new At,this.projectionMatrix=new At,this.projectionMatrixInverse=new At,this.coordinateSystem=oi,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,n){return super.copy(e,n),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(Vc,Gc,vi),vi.x===1&&vi.y===1&&vi.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Vc,Gc,vi.set(1,1,1)).invert()}updateWorldMatrix(e,n){super.updateWorldMatrix(e,n),this.matrixWorld.decompose(Vc,Gc,vi),vi.x===1&&vi.y===1&&vi.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Vc,Gc,vi.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Rr=new k,Tv=new Ke,bv=new Ke,rn=class extends Fa{constructor(e=50,n=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let n=.5*this.getFilmHeight()/e;this.fov=iu*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Xd*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return iu*2*Math.atan(Math.tan(Xd*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,n,i){Rr.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Rr.x,Rr.y).multiplyScalar(-e/Rr.z),Rr.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Rr.x,Rr.y).multiplyScalar(-e/Rr.z)}getViewSize(e,n){return this.getViewBounds(e,Tv,bv),n.subVectors(bv,Tv)}setViewOffset(e,n,i,r,s,o){this.aspect=e/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,n=e*Math.tan(Xd*.5*this.fov)/this.zoom,i=2*n,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,n-=o.offsetY*i/c,r*=o.width/l,i*=o.height/c}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,n,n-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}};var fo=class extends Fa{constructor(e=-1,n=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=n,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,n,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+n,l=r-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,f=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=f*this.view.offsetY,l=a-f*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}},Mp=class extends Sp{constructor(){super(new fo(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Oa=class extends Da{constructor(e,n){super(e,n),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(sn.DEFAULT_UP),this.updateMatrix(),this.target=new sn,this.shadow=new Mp}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let n=super.toJSON(e);return n.object.shadow=this.shadow.toJSON(),n.object.target=this.target.uuid,n}};var io=-90,ro=1,wu=class extends sn{constructor(e,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new rn(io,ro,e,n);r.layers=this.layers,this.add(r);let s=new rn(io,ro,e,n);s.layers=this.layers,this.add(s);let o=new rn(io,ro,e,n);o.layers=this.layers,this.add(o);let a=new rn(io,ro,e,n);a.layers=this.layers,this.add(a);let l=new rn(io,ro,e,n);l.layers=this.layers,this.add(l);let c=new rn(io,ro,e,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,n=this.children.concat(),[i,r,s,o,a,l]=n;for(let c of n)this.remove(c);if(e===oi)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===oo)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of n)this.add(c),c.updateMatrixWorld()}update(e,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,c,f]=this.children,d=e.getRenderTarget(),h=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),v=e.xr.enabled;e.xr.enabled=!1;let S=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let _=!1;e.isWebGLRenderer===!0?_=e.state.buffers.depth.getReversed():_=e.reversedDepthBuffer,e.setRenderTarget(i,0,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,s),e.setRenderTarget(i,1,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,o),e.setRenderTarget(i,2,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,a),e.setRenderTarget(i,3,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,l),e.setRenderTarget(i,4,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,c),i.texture.generateMipmaps=S,e.setRenderTarget(i,5,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,f),e.setRenderTarget(d,h,p),e.xr.enabled=v,i.texture.needsPMREMUpdate=!0}},Eu=class extends rn{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Yp="\\[\\]\\.:\\/",ZM=new RegExp("["+Yp+"]","g"),Zp="[^"+Yp+"]",$M="[^"+Yp.replace("\\.","")+"]",JM=/((?:WC+[\/:])*)/.source.replace("WC",Zp),KM=/(WCOD+)?/.source.replace("WCOD",$M),jM=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Zp),QM=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Zp),e1=new RegExp("^"+JM+KM+jM+QM+"$"),t1=["material","materials","bones","map"],wp=class{constructor(e,n,i){let r=i||gt.parseTrackName(n);this._targetGroup=e,this._bindings=e.subscribe_(n,r)}getValue(e,n){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,n)}setValue(e,n){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,n)}bind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].bind()}unbind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].unbind()}},gt=class t{constructor(e,n,i){this.path=n,this.parsedPath=i||t.parseTrackName(n),this.node=t.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,n,i){return e&&e.isAnimationObjectGroup?new t.Composite(e,n,i):new t(e,n,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(ZM,"")}static parseTrackName(e){let n=e1.exec(e);if(n===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);t1.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,n){if(n===void 0||n===""||n==="."||n===-1||n===e.name||n===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(n);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===n||a.uuid===n)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,n){e[n]=this.targetObject[this.propertyName]}_getValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[n++]=i[r]}_getValue_arrayElement(e,n){e[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,n){this.resolvedProperty.toArray(e,n)}_setValue_direct(e,n){this.targetObject[this.propertyName]=e[n]}_setValue_direct_setNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++]}_setValue_array_setNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,n){this.resolvedProperty[this.propertyIndex]=e[n]}_setValue_arrayElement_setNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,n){this.resolvedProperty.fromArray(e,n)}_setValue_fromArray_setNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,n){this.bind(),this.getValue(e,n)}_setValue_unbound(e,n){this.bind(),this.setValue(e,n)}bind(){let e=this.node,n=this.parsedPath,i=n.objectName,r=n.propertyName,s=n.propertyIndex;if(e||(e=t.findNode(this.rootNode,n.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Re("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!e.material){Pe("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Pe("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Pe("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let f=0;f<e.length;f++)if(e[f].name===c){c=f;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Pe("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Pe("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){Pe("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){Pe("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[r];if(o===void 0){let c=n.nodeName;Pe("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){Pe("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Pe("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};gt.Composite=wp;gt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};gt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};gt.prototype.GetterByBindingType=[gt.prototype._getValue_direct,gt.prototype._getValue_array,gt.prototype._getValue_arrayElement,gt.prototype._getValue_toArray];gt.prototype.SetterByBindingTypeAndVersioning=[[gt.prototype._setValue_direct,gt.prototype._setValue_direct_setNeedsUpdate,gt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[gt.prototype._setValue_array,gt.prototype._setValue_array_setNeedsUpdate,gt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[gt.prototype._setValue_arrayElement,gt.prototype._setValue_arrayElement_setNeedsUpdate,gt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[gt.prototype._setValue_fromArray,gt.prototype._setValue_fromArray_setNeedsUpdate,gt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var pA=new Float32Array(1);var em=class em{constructor(e,n,i,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,n,i,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,n=0){for(let i=0;i<4;i++)this.elements[i]=e[i+n];return this}set(e,n,i,r){let s=this.elements;return s[0]=e,s[2]=n,s[1]=i,s[3]=r,this}};em.prototype.isMatrix2=!0;var Ep=em;function $p(t,e,n,i){let r=n1(i);switch(n){case Vp:return t*e;case Hp:return t*e/r.components*r.byteLength;case Nu:return t*e/r.components*r.byteLength;case Vr:return t*e*2/r.components*r.byteLength;case Du:return t*e*2/r.components*r.byteLength;case Gp:return t*e*3/r.components*r.byteLength;case Zn:return t*e*4/r.components*r.byteLength;case Uu:return t*e*4/r.components*r.byteLength;case Va:case Ga:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case Ha:case Wa:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Ou:case ku:return Math.max(t,16)*Math.max(e,8)/4;case Fu:case Bu:return Math.max(t,8)*Math.max(e,8)/2;case zu:case Vu:case Hu:case Wu:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case Gu:case Xa:case Xu:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case qu:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Yu:return Math.floor((t+4)/5)*Math.floor((e+3)/4)*16;case Zu:return Math.floor((t+4)/5)*Math.floor((e+4)/5)*16;case $u:return Math.floor((t+5)/6)*Math.floor((e+4)/5)*16;case Ju:return Math.floor((t+5)/6)*Math.floor((e+5)/6)*16;case Ku:return Math.floor((t+7)/8)*Math.floor((e+4)/5)*16;case ju:return Math.floor((t+7)/8)*Math.floor((e+5)/6)*16;case Qu:return Math.floor((t+7)/8)*Math.floor((e+7)/8)*16;case eh:return Math.floor((t+9)/10)*Math.floor((e+4)/5)*16;case th:return Math.floor((t+9)/10)*Math.floor((e+5)/6)*16;case nh:return Math.floor((t+9)/10)*Math.floor((e+7)/8)*16;case ih:return Math.floor((t+9)/10)*Math.floor((e+9)/10)*16;case rh:return Math.floor((t+11)/12)*Math.floor((e+9)/10)*16;case sh:return Math.floor((t+11)/12)*Math.floor((e+11)/12)*16;case oh:case ah:case lh:return Math.ceil(t/4)*Math.ceil(e/4)*16;case ch:case uh:return Math.ceil(t/4)*Math.ceil(e/4)*8;case qa:case hh:return Math.ceil(t/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function n1(t){switch(t){case Sn:case Op:return{byteLength:1,components:1};case mo:case Bp:case Ci:return{byteLength:2,components:1};case Iu:case Lu:return{byteLength:2,components:4};case li:case Pu:case ci:return{byteLength:4,components:1};case kp:case zp:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${t}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"184"}}));typeof window<"u"&&(window.__THREE__?Re("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="184");function Dx(){let t=null,e=!1,n=null,i=null;function r(s,o){n(s,o),i=t.requestAnimationFrame(r)}return{start:function(){e!==!0&&n!==null&&t!==null&&(i=t.requestAnimationFrame(r),e=!0)},stop:function(){t!==null&&t.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){n=s},setContext:function(s){t=s}}}function r1(t){let e=new WeakMap;function n(a,l){let c=a.array,f=a.usage,d=c.byteLength,h=t.createBuffer();t.bindBuffer(l,h),t.bufferData(l,c,f),a.onUploadCallback();let p;if(c instanceof Float32Array)p=t.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)p=t.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?p=t.HALF_FLOAT:p=t.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=t.SHORT;else if(c instanceof Uint32Array)p=t.UNSIGNED_INT;else if(c instanceof Int32Array)p=t.INT;else if(c instanceof Int8Array)p=t.BYTE;else if(c instanceof Uint8Array)p=t.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=t.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:h,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:d}}function i(a,l,c){let f=l.array,d=l.updateRanges;if(t.bindBuffer(c,a),d.length===0)t.bufferSubData(c,0,f);else{d.sort((p,v)=>p.start-v.start);let h=0;for(let p=1;p<d.length;p++){let v=d[h],S=d[p];S.start<=v.start+v.count+1?v.count=Math.max(v.count,S.start+S.count-v.start):(++h,d[h]=S)}d.length=h+1;for(let p=0,v=d.length;p<v;p++){let S=d[p];t.bufferSubData(c,S.start*f.BYTES_PER_ELEMENT,f,S.start,S.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(t.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let f=e.get(a);(!f||f.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=e.get(a);if(c===void 0)e.set(a,n(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}var s1=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,o1=`#ifdef USE_ALPHAHASH
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
#endif`,a1=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,l1=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,c1=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,u1=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,h1=`#ifdef USE_AOMAP
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
#endif`,f1=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,d1=`#ifdef USE_BATCHING
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
#endif`,p1=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,m1=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,g1=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,_1=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,v1=`#ifdef USE_IRIDESCENCE
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
#endif`,x1=`#ifdef USE_BUMPMAP
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
#endif`,y1=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,S1=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,M1=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,w1=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,E1=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,T1=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,b1=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,A1=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,C1=`#define PI 3.141592653589793
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
} // validated`,R1=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,P1=`vec3 transformedNormal = objectNormal;
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
#endif`,I1=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,L1=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,N1=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,D1=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,U1="gl_FragColor = linearToOutputTexel( gl_FragColor );",F1=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,O1=`#ifdef USE_ENVMAP
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
#endif`,B1=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,k1=`#ifdef USE_ENVMAP
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
#endif`,z1=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,V1=`#ifdef USE_ENVMAP
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
#endif`,G1=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,H1=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,W1=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,X1=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,q1=`#ifdef USE_GRADIENTMAP
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
}`,Y1=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Z1=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,$1=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,J1=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,K1=`#ifdef USE_ENVMAP
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
#endif`,j1=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Q1=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,ew=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,tw=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,nw=`PhysicalMaterial material;
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
#endif`,iw=`uniform sampler2D dfgLUT;
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
}`,rw=`
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
#endif`,sw=`#if defined( RE_IndirectDiffuse )
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
#endif`,ow=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,aw=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,lw=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,cw=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,uw=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,hw=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,fw=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,dw=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,pw=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,mw=`#if defined( USE_POINTS_UV )
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
#endif`,gw=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,_w=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,vw=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,xw=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,yw=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Sw=`#ifdef USE_MORPHTARGETS
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
#endif`,Mw=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,ww=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,Ew=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,Tw=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,bw=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Aw=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Cw=`#ifdef USE_NORMALMAP
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
#endif`,Rw=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Pw=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Iw=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Lw=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Nw=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Dw=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,Uw=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Fw=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Ow=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Bw=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,kw=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,zw=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Vw=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Gw=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Hw=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,Ww=`float getShadowMask() {
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
}`,Xw=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,qw=`#ifdef USE_SKINNING
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
#endif`,Yw=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Zw=`#ifdef USE_SKINNING
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
#endif`,$w=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Jw=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Kw=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,jw=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Qw=`#ifdef USE_TRANSMISSION
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
#endif`,eE=`#ifdef USE_TRANSMISSION
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
#endif`,tE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,nE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,iE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,rE=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,sE=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,oE=`uniform sampler2D t2D;
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
}`,aE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,lE=`#ifdef ENVMAP_TYPE_CUBE
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
}`,cE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,uE=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,hE=`#include <common>
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
}`,fE=`#if DEPTH_PACKING == 3200
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
}`,dE=`#define DISTANCE
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
}`,pE=`#define DISTANCE
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
}`,mE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,gE=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,_E=`uniform float scale;
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
}`,vE=`uniform vec3 diffuse;
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
}`,xE=`#include <common>
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
}`,yE=`uniform vec3 diffuse;
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
}`,SE=`#define LAMBERT
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
}`,ME=`#define LAMBERT
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
}`,wE=`#define MATCAP
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
}`,EE=`#define MATCAP
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
}`,TE=`#define NORMAL
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
}`,bE=`#define NORMAL
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
}`,AE=`#define PHONG
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
}`,CE=`#define PHONG
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
}`,RE=`#define STANDARD
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
}`,PE=`#define STANDARD
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
}`,IE=`#define TOON
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
}`,LE=`#define TOON
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
}`,NE=`uniform float size;
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
}`,DE=`uniform vec3 diffuse;
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
}`,UE=`#include <common>
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
}`,FE=`uniform vec3 color;
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
}`,OE=`uniform float rotation;
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
}`,BE=`uniform vec3 diffuse;
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
}`,Ve={alphahash_fragment:s1,alphahash_pars_fragment:o1,alphamap_fragment:a1,alphamap_pars_fragment:l1,alphatest_fragment:c1,alphatest_pars_fragment:u1,aomap_fragment:h1,aomap_pars_fragment:f1,batching_pars_vertex:d1,batching_vertex:p1,begin_vertex:m1,beginnormal_vertex:g1,bsdfs:_1,iridescence_fragment:v1,bumpmap_pars_fragment:x1,clipping_planes_fragment:y1,clipping_planes_pars_fragment:S1,clipping_planes_pars_vertex:M1,clipping_planes_vertex:w1,color_fragment:E1,color_pars_fragment:T1,color_pars_vertex:b1,color_vertex:A1,common:C1,cube_uv_reflection_fragment:R1,defaultnormal_vertex:P1,displacementmap_pars_vertex:I1,displacementmap_vertex:L1,emissivemap_fragment:N1,emissivemap_pars_fragment:D1,colorspace_fragment:U1,colorspace_pars_fragment:F1,envmap_fragment:O1,envmap_common_pars_fragment:B1,envmap_pars_fragment:k1,envmap_pars_vertex:z1,envmap_physical_pars_fragment:K1,envmap_vertex:V1,fog_vertex:G1,fog_pars_vertex:H1,fog_fragment:W1,fog_pars_fragment:X1,gradientmap_pars_fragment:q1,lightmap_pars_fragment:Y1,lights_lambert_fragment:Z1,lights_lambert_pars_fragment:$1,lights_pars_begin:J1,lights_toon_fragment:j1,lights_toon_pars_fragment:Q1,lights_phong_fragment:ew,lights_phong_pars_fragment:tw,lights_physical_fragment:nw,lights_physical_pars_fragment:iw,lights_fragment_begin:rw,lights_fragment_maps:sw,lights_fragment_end:ow,lightprobes_pars_fragment:aw,logdepthbuf_fragment:lw,logdepthbuf_pars_fragment:cw,logdepthbuf_pars_vertex:uw,logdepthbuf_vertex:hw,map_fragment:fw,map_pars_fragment:dw,map_particle_fragment:pw,map_particle_pars_fragment:mw,metalnessmap_fragment:gw,metalnessmap_pars_fragment:_w,morphinstance_vertex:vw,morphcolor_vertex:xw,morphnormal_vertex:yw,morphtarget_pars_vertex:Sw,morphtarget_vertex:Mw,normal_fragment_begin:ww,normal_fragment_maps:Ew,normal_pars_fragment:Tw,normal_pars_vertex:bw,normal_vertex:Aw,normalmap_pars_fragment:Cw,clearcoat_normal_fragment_begin:Rw,clearcoat_normal_fragment_maps:Pw,clearcoat_pars_fragment:Iw,iridescence_pars_fragment:Lw,opaque_fragment:Nw,packing:Dw,premultiplied_alpha_fragment:Uw,project_vertex:Fw,dithering_fragment:Ow,dithering_pars_fragment:Bw,roughnessmap_fragment:kw,roughnessmap_pars_fragment:zw,shadowmap_pars_fragment:Vw,shadowmap_pars_vertex:Gw,shadowmap_vertex:Hw,shadowmask_pars_fragment:Ww,skinbase_vertex:Xw,skinning_pars_vertex:qw,skinning_vertex:Yw,skinnormal_vertex:Zw,specularmap_fragment:$w,specularmap_pars_fragment:Jw,tonemapping_fragment:Kw,tonemapping_pars_fragment:jw,transmission_fragment:Qw,transmission_pars_fragment:eE,uv_pars_fragment:tE,uv_pars_vertex:nE,uv_vertex:iE,worldpos_vertex:rE,background_vert:sE,background_frag:oE,backgroundCube_vert:aE,backgroundCube_frag:lE,cube_vert:cE,cube_frag:uE,depth_vert:hE,depth_frag:fE,distance_vert:dE,distance_frag:pE,equirect_vert:mE,equirect_frag:gE,linedashed_vert:_E,linedashed_frag:vE,meshbasic_vert:xE,meshbasic_frag:yE,meshlambert_vert:SE,meshlambert_frag:ME,meshmatcap_vert:wE,meshmatcap_frag:EE,meshnormal_vert:TE,meshnormal_frag:bE,meshphong_vert:AE,meshphong_frag:CE,meshphysical_vert:RE,meshphysical_frag:PE,meshtoon_vert:IE,meshtoon_frag:LE,points_vert:NE,points_frag:DE,shadow_vert:UE,shadow_frag:FE,sprite_vert:OE,sprite_frag:BE},de={common:{diffuse:{value:new qe(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new De},alphaMap:{value:null},alphaMapTransform:{value:new De},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new De}},envmap:{envMap:{value:null},envMapRotation:{value:new De},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new De}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new De}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new De},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new De},normalScale:{value:new Ke(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new De},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new De}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new De}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new De}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new qe(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new k},probesMax:{value:new k},probesResolution:{value:new k}},points:{diffuse:{value:new qe(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new De},alphaTest:{value:0},uvTransform:{value:new De}},sprite:{diffuse:{value:new qe(16777215)},opacity:{value:1},center:{value:new Ke(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new De},alphaMap:{value:null},alphaMapTransform:{value:new De},alphaTest:{value:0}}},Pi={basic:{uniforms:on([de.common,de.specularmap,de.envmap,de.aomap,de.lightmap,de.fog]),vertexShader:Ve.meshbasic_vert,fragmentShader:Ve.meshbasic_frag},lambert:{uniforms:on([de.common,de.specularmap,de.envmap,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.fog,de.lights,{emissive:{value:new qe(0)},envMapIntensity:{value:1}}]),vertexShader:Ve.meshlambert_vert,fragmentShader:Ve.meshlambert_frag},phong:{uniforms:on([de.common,de.specularmap,de.envmap,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.fog,de.lights,{emissive:{value:new qe(0)},specular:{value:new qe(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Ve.meshphong_vert,fragmentShader:Ve.meshphong_frag},standard:{uniforms:on([de.common,de.envmap,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.roughnessmap,de.metalnessmap,de.fog,de.lights,{emissive:{value:new qe(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ve.meshphysical_vert,fragmentShader:Ve.meshphysical_frag},toon:{uniforms:on([de.common,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.gradientmap,de.fog,de.lights,{emissive:{value:new qe(0)}}]),vertexShader:Ve.meshtoon_vert,fragmentShader:Ve.meshtoon_frag},matcap:{uniforms:on([de.common,de.bumpmap,de.normalmap,de.displacementmap,de.fog,{matcap:{value:null}}]),vertexShader:Ve.meshmatcap_vert,fragmentShader:Ve.meshmatcap_frag},points:{uniforms:on([de.points,de.fog]),vertexShader:Ve.points_vert,fragmentShader:Ve.points_frag},dashed:{uniforms:on([de.common,de.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ve.linedashed_vert,fragmentShader:Ve.linedashed_frag},depth:{uniforms:on([de.common,de.displacementmap]),vertexShader:Ve.depth_vert,fragmentShader:Ve.depth_frag},normal:{uniforms:on([de.common,de.bumpmap,de.normalmap,de.displacementmap,{opacity:{value:1}}]),vertexShader:Ve.meshnormal_vert,fragmentShader:Ve.meshnormal_frag},sprite:{uniforms:on([de.sprite,de.fog]),vertexShader:Ve.sprite_vert,fragmentShader:Ve.sprite_frag},background:{uniforms:{uvTransform:{value:new De},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ve.background_vert,fragmentShader:Ve.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new De}},vertexShader:Ve.backgroundCube_vert,fragmentShader:Ve.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ve.cube_vert,fragmentShader:Ve.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ve.equirect_vert,fragmentShader:Ve.equirect_frag},distance:{uniforms:on([de.common,de.displacementmap,{referencePosition:{value:new k},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ve.distance_vert,fragmentShader:Ve.distance_frag},shadow:{uniforms:on([de.lights,de.fog,{color:{value:new qe(0)},opacity:{value:1}}]),vertexShader:Ve.shadow_vert,fragmentShader:Ve.shadow_frag}};Pi.physical={uniforms:on([Pi.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new De},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new De},clearcoatNormalScale:{value:new Ke(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new De},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new De},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new De},sheen:{value:0},sheenColor:{value:new qe(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new De},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new De},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new De},transmissionSamplerSize:{value:new Ke},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new De},attenuationDistance:{value:0},attenuationColor:{value:new qe(0)},specularColor:{value:new qe(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new De},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new De},anisotropyVector:{value:new Ke},anisotropyMap:{value:null},anisotropyMapTransform:{value:new De}}]),vertexShader:Ve.meshphysical_vert,fragmentShader:Ve.meshphysical_frag};var mh={r:0,b:0,g:0},kE=new At,Ux=new De;Ux.set(-1,0,0,0,1,0,0,0,1);function zE(t,e,n,i,r,s){let o=new qe(0),a=r===!0?0:1,l,c,f=null,d=0,h=null;function p(m){let x=m.isScene===!0?m.background:null;if(x&&x.isTexture){let w=m.backgroundBlurriness>0;x=e.get(x,w)}return x}function v(m){let x=!1,w=p(m);w===null?_(o,a):w&&w.isColor&&(_(w,1),x=!0);let A=t.xr.getEnvironmentBlendMode();A==="additive"?n.buffers.color.setClear(0,0,0,1,s):A==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,s),(t.autoClear||x)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),t.clear(t.autoClearColor,t.autoClearDepth,t.autoClearStencil))}function S(m,x){let w=p(x);w&&(w.isCubeTexture||w.mapping===ka)?(c===void 0&&(c=new yn(new Ei(1,1,1),new Dn({name:"BackgroundCubeMaterial",uniforms:ds(Pi.backgroundCube.uniforms),vertexShader:Pi.backgroundCube.vertexShader,fragmentShader:Pi.backgroundCube.fragmentShader,side:fn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(A,E,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(c)),c.material.uniforms.envMap.value=w,c.material.uniforms.backgroundBlurriness.value=x.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(kE.makeRotationFromEuler(x.backgroundRotation)).transpose(),w.isCubeTexture&&w.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(Ux),c.material.toneMapped=Xe.getTransfer(w.colorSpace)!==et,(f!==w||d!==w.version||h!==t.toneMapping)&&(c.material.needsUpdate=!0,f=w,d=w.version,h=t.toneMapping),c.layers.enableAll(),m.unshift(c,c.geometry,c.material,0,0,null)):w&&w.isTexture&&(l===void 0&&(l=new yn(new bi(2,2),new Dn({name:"BackgroundMaterial",uniforms:ds(Pi.background.uniforms),vertexShader:Pi.background.vertexShader,fragmentShader:Pi.background.fragmentShader,side:Ji,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=w,l.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,l.material.toneMapped=Xe.getTransfer(w.colorSpace)!==et,w.matrixAutoUpdate===!0&&w.updateMatrix(),l.material.uniforms.uvTransform.value.copy(w.matrix),(f!==w||d!==w.version||h!==t.toneMapping)&&(l.material.needsUpdate=!0,f=w,d=w.version,h=t.toneMapping),l.layers.enableAll(),m.unshift(l,l.geometry,l.material,0,0,null))}function _(m,x){m.getRGB(mh,qp(t)),n.buffers.color.setClear(mh.r,mh.g,mh.b,x,s)}function u(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(m,x=1){o.set(m),a=x,_(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(m){a=m,_(o,a)},render:v,addToRenderList:S,dispose:u}}function VE(t,e){let n=t.getParameter(t.MAX_VERTEX_ATTRIBS),i={},r=h(null),s=r,o=!1;function a(R,D,Y,H,O){let z=!1,X=d(R,H,Y,D);s!==X&&(s=X,c(s.object)),z=p(R,H,Y,O),z&&v(R,H,Y,O),O!==null&&e.update(O,t.ELEMENT_ARRAY_BUFFER),(z||o)&&(o=!1,w(R,D,Y,H),O!==null&&t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,e.get(O).buffer))}function l(){return t.createVertexArray()}function c(R){return t.bindVertexArray(R)}function f(R){return t.deleteVertexArray(R)}function d(R,D,Y,H){let O=H.wireframe===!0,z=i[D.id];z===void 0&&(z={},i[D.id]=z);let X=R.isInstancedMesh===!0?R.id:0,ee=z[X];ee===void 0&&(ee={},z[X]=ee);let te=ee[Y.id];te===void 0&&(te={},ee[Y.id]=te);let ue=te[O];return ue===void 0&&(ue=h(l()),te[O]=ue),ue}function h(R){let D=[],Y=[],H=[];for(let O=0;O<n;O++)D[O]=0,Y[O]=0,H[O]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:D,enabledAttributes:Y,attributeDivisors:H,object:R,attributes:{},index:null}}function p(R,D,Y,H){let O=s.attributes,z=D.attributes,X=0,ee=Y.getAttributes();for(let te in ee)if(ee[te].location>=0){let ce=O[te],Se=z[te];if(Se===void 0&&(te==="instanceMatrix"&&R.instanceMatrix&&(Se=R.instanceMatrix),te==="instanceColor"&&R.instanceColor&&(Se=R.instanceColor)),ce===void 0||ce.attribute!==Se||Se&&ce.data!==Se.data)return!0;X++}return s.attributesNum!==X||s.index!==H}function v(R,D,Y,H){let O={},z=D.attributes,X=0,ee=Y.getAttributes();for(let te in ee)if(ee[te].location>=0){let ce=z[te];ce===void 0&&(te==="instanceMatrix"&&R.instanceMatrix&&(ce=R.instanceMatrix),te==="instanceColor"&&R.instanceColor&&(ce=R.instanceColor));let Se={};Se.attribute=ce,ce&&ce.data&&(Se.data=ce.data),O[te]=Se,X++}s.attributes=O,s.attributesNum=X,s.index=H}function S(){let R=s.newAttributes;for(let D=0,Y=R.length;D<Y;D++)R[D]=0}function _(R){u(R,0)}function u(R,D){let Y=s.newAttributes,H=s.enabledAttributes,O=s.attributeDivisors;Y[R]=1,H[R]===0&&(t.enableVertexAttribArray(R),H[R]=1),O[R]!==D&&(t.vertexAttribDivisor(R,D),O[R]=D)}function m(){let R=s.newAttributes,D=s.enabledAttributes;for(let Y=0,H=D.length;Y<H;Y++)D[Y]!==R[Y]&&(t.disableVertexAttribArray(Y),D[Y]=0)}function x(R,D,Y,H,O,z,X){X===!0?t.vertexAttribIPointer(R,D,Y,O,z):t.vertexAttribPointer(R,D,Y,H,O,z)}function w(R,D,Y,H){S();let O=H.attributes,z=Y.getAttributes(),X=D.defaultAttributeValues;for(let ee in z){let te=z[ee];if(te.location>=0){let ue=O[ee];if(ue===void 0&&(ee==="instanceMatrix"&&R.instanceMatrix&&(ue=R.instanceMatrix),ee==="instanceColor"&&R.instanceColor&&(ue=R.instanceColor)),ue!==void 0){let ce=ue.normalized,Se=ue.itemSize,Ye=e.get(ue);if(Ye===void 0)continue;let Qe=Ye.buffer,Ie=Ye.type,K=Ye.bytesPerElement,fe=Ie===t.INT||Ie===t.UNSIGNED_INT||ue.gpuType===Pu;if(ue.isInterleavedBufferAttribute){let ne=ue.data,we=ne.stride,Ne=ue.offset;if(ne.isInstancedInterleavedBuffer){for(let Ce=0;Ce<te.locationSize;Ce++)u(te.location+Ce,ne.meshPerAttribute);R.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=ne.meshPerAttribute*ne.count)}else for(let Ce=0;Ce<te.locationSize;Ce++)_(te.location+Ce);t.bindBuffer(t.ARRAY_BUFFER,Qe);for(let Ce=0;Ce<te.locationSize;Ce++)x(te.location+Ce,Se/te.locationSize,Ie,ce,we*K,(Ne+Se/te.locationSize*Ce)*K,fe)}else{if(ue.isInstancedBufferAttribute){for(let ne=0;ne<te.locationSize;ne++)u(te.location+ne,ue.meshPerAttribute);R.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=ue.meshPerAttribute*ue.count)}else for(let ne=0;ne<te.locationSize;ne++)_(te.location+ne);t.bindBuffer(t.ARRAY_BUFFER,Qe);for(let ne=0;ne<te.locationSize;ne++)x(te.location+ne,Se/te.locationSize,Ie,ce,Se*K,Se/te.locationSize*ne*K,fe)}}else if(X!==void 0){let ce=X[ee];if(ce!==void 0)switch(ce.length){case 2:t.vertexAttrib2fv(te.location,ce);break;case 3:t.vertexAttrib3fv(te.location,ce);break;case 4:t.vertexAttrib4fv(te.location,ce);break;default:t.vertexAttrib1fv(te.location,ce)}}}}m()}function A(){T();for(let R in i){let D=i[R];for(let Y in D){let H=D[Y];for(let O in H){let z=H[O];for(let X in z)f(z[X].object),delete z[X];delete H[O]}}delete i[R]}}function E(R){if(i[R.id]===void 0)return;let D=i[R.id];for(let Y in D){let H=D[Y];for(let O in H){let z=H[O];for(let X in z)f(z[X].object),delete z[X];delete H[O]}}delete i[R.id]}function C(R){for(let D in i){let Y=i[D];for(let H in Y){let O=Y[H];if(O[R.id]===void 0)continue;let z=O[R.id];for(let X in z)f(z[X].object),delete z[X];delete O[R.id]}}}function g(R){for(let D in i){let Y=i[D],H=R.isInstancedMesh===!0?R.id:0,O=Y[H];if(O!==void 0){for(let z in O){let X=O[z];for(let ee in X)f(X[ee].object),delete X[ee];delete O[z]}delete Y[H],Object.keys(Y).length===0&&delete i[D]}}}function T(){P(),o=!0,s!==r&&(s=r,c(s.object))}function P(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:T,resetDefaultState:P,dispose:A,releaseStatesOfGeometry:E,releaseStatesOfObject:g,releaseStatesOfProgram:C,initAttributes:S,enableAttribute:_,disableUnusedAttributes:m}}function GE(t,e,n){let i;function r(l){i=l}function s(l,c){t.drawArrays(i,l,c),n.update(c,i,1)}function o(l,c,f){f!==0&&(t.drawArraysInstanced(i,l,c,f),n.update(c,i,f))}function a(l,c,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,c,0,f);let h=0;for(let p=0;p<f;p++)h+=c[p];n.update(h,i,1)}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a}function HE(t,e,n,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let C=e.get("EXT_texture_filter_anisotropic");r=t.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(C){return!(C!==Zn&&i.convert(C)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(C){let g=C===Ci&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==Sn&&i.convert(C)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==ci&&!g)}function l(C){if(C==="highp"){if(t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.HIGH_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.MEDIUM_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",f=l(c);f!==c&&(Re("WebGLRenderer:",c,"not supported, using",f,"instead."),c=f);let d=n.logarithmicDepthBuffer===!0,h=n.reversedDepthBuffer===!0&&e.has("EXT_clip_control");n.reversedDepthBuffer===!0&&h===!1&&Re("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let p=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),v=t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),S=t.getParameter(t.MAX_TEXTURE_SIZE),_=t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),u=t.getParameter(t.MAX_VERTEX_ATTRIBS),m=t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),x=t.getParameter(t.MAX_VARYING_VECTORS),w=t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),A=t.getParameter(t.MAX_SAMPLES),E=t.getParameter(t.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:d,reversedDepthBuffer:h,maxTextures:p,maxVertexTextures:v,maxTextureSize:S,maxCubemapSize:_,maxAttributes:u,maxVertexUniforms:m,maxVaryings:x,maxFragmentUniforms:w,maxSamples:A,samples:E}}function WE(t){let e=this,n=null,i=0,r=!1,s=!1,o=new xi,a=new De,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,h){let p=d.length!==0||h||i!==0||r;return r=h,i=d.length,p},this.beginShadows=function(){s=!0,f(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(d,h){n=f(d,h,0)},this.setState=function(d,h,p){let v=d.clippingPlanes,S=d.clipIntersection,_=d.clipShadows,u=t.get(d);if(!r||v===null||v.length===0||s&&!_)s?f(null):c();else{let m=s?0:i,x=m*4,w=u.clippingState||null;l.value=w,w=f(v,h,x,p);for(let A=0;A!==x;++A)w[A]=n[A];u.clippingState=w,this.numIntersection=S?this.numPlanes:0,this.numPlanes+=m}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function f(d,h,p,v){let S=d!==null?d.length:0,_=null;if(S!==0){if(_=l.value,v!==!0||_===null){let u=p+S*4,m=h.matrixWorldInverse;a.getNormalMatrix(m),(_===null||_.length<u)&&(_=new Float32Array(u));for(let x=0,w=p;x!==S;++x,w+=4)o.copy(d[x]).applyMatrix4(m,a),o.normal.toArray(_,w),_[w+3]=o.constant}l.value=_,l.needsUpdate=!0}return e.numPlanes=S,e.numIntersection=0,_}}var Gr=4,fx=[.125,.215,.35,.446,.526,.582],ps=20,XE=256,Za=new fo,dx=new qe,tm=null,nm=0,im=0,rm=!1,qE=new k,_h=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,n=0,i=.1,r=100,s={}){let{size:o=256,position:a=qE}=s;tm=this._renderer.getRenderTarget(),nm=this._renderer.getActiveCubeFace(),im=this._renderer.getActiveMipmapLevel(),rm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,n=null){return this._fromTexture(e,n)}fromCubemap(e,n=null){return this._fromTexture(e,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=gx(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=mx(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(tm,nm,im),this._renderer.xr.enabled=rm,e.scissorTest=!1,_o(e,0,0,e.width,e.height)}_fromTexture(e,n){e.mapping===Br||e.mapping===fs?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),tm=this._renderer.getRenderTarget(),nm=this._renderer.getActiveCubeFace(),im=this._renderer.getActiveMipmapLevel(),rm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:Zt,minFilter:Zt,generateMipmaps:!1,type:Ci,format:Zn,colorSpace:xa,depthBuffer:!1},r=px(e,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=px(e,n,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=YE(s)),this._blurMaterial=$E(s,e,n),this._ggxMaterial=ZE(s,e,n)}return r}_compileMaterial(e){let n=new yn(new qn,e);this._renderer.compile(n,Za)}_sceneToCubeUV(e,n,i,r,s){let l=new rn(90,1,n,i),c=[1,-1,1,1,1,1],f=[1,1,1,-1,-1,-1],d=this._renderer,h=d.autoClear,p=d.toneMapping;d.getClearColor(dx),d.toneMapping=ai,d.autoClear=!1,d.state.buffers.depth.getReversed()&&(d.setRenderTarget(r),d.clearDepth(),d.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new yn(new Ei,new Ca({name:"PMREM.Background",side:fn,depthWrite:!1,depthTest:!1})));let S=this._backgroundBox,_=S.material,u=!1,m=e.background;m?m.isColor&&(_.color.copy(m),e.background=null,u=!0):(_.color.copy(dx),u=!0);for(let x=0;x<6;x++){let w=x%3;w===0?(l.up.set(0,c[x],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+f[x],s.y,s.z)):w===1?(l.up.set(0,0,c[x]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+f[x],s.z)):(l.up.set(0,c[x],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+f[x]));let A=this._cubeSize;_o(r,w*A,x>2?A:0,A,A),d.setRenderTarget(r),u&&d.render(S,l),d.render(e,l)}d.toneMapping=p,d.autoClear=h,e.background=m}_textureToCubeUV(e,n){let i=this._renderer,r=e.mapping===Br||e.mapping===fs;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=gx()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=mx());let s=r?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=s;let a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;_o(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(o,Za)}_applyPMREM(e){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);n.autoClear=i}_applyGGXFilter(e,n,i){let r=this._renderer,s=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[i];a.material=o;let l=o.uniforms,c=i/(this._lodMeshes.length-1),f=n/(this._lodMeshes.length-1),d=Math.sqrt(c*c-f*f),h=0+c*1.25,p=d*h,{_lodMax:v}=this,S=this._sizeLods[i],_=3*S*(i>v-Gr?i-v+Gr:0),u=4*(this._cubeSize-S);l.envMap.value=e.texture,l.roughness.value=p,l.mipInt.value=v-n,_o(s,_,u,3*S,2*S),r.setRenderTarget(s),r.render(a,Za),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=v-i,_o(e,_,u,3*S,2*S),r.setRenderTarget(e),r.render(a,Za)}_blur(e,n,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,n,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,n,i,r,s,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&Pe("blur direction must be either latitudinal or longitudinal!");let f=3,d=this._lodMeshes[r];d.material=c;let h=c.uniforms,p=this._sizeLods[i]-1,v=isFinite(s)?Math.PI/(2*p):2*Math.PI/(2*ps-1),S=s/v,_=isFinite(s)?1+Math.floor(f*S):ps;_>ps&&Re(`sigmaRadians, ${s}, is too large and will clip, as it requested ${_} samples when the maximum is set to ${ps}`);let u=[],m=0;for(let C=0;C<ps;++C){let g=C/S,T=Math.exp(-g*g/2);u.push(T),C===0?m+=T:C<_&&(m+=2*T)}for(let C=0;C<u.length;C++)u[C]=u[C]/m;h.envMap.value=e.texture,h.samples.value=_,h.weights.value=u,h.latitudinal.value=o==="latitudinal",a&&(h.poleAxis.value=a);let{_lodMax:x}=this;h.dTheta.value=v,h.mipInt.value=x-i;let w=this._sizeLods[r],A=3*w*(r>x-Gr?r-x+Gr:0),E=4*(this._cubeSize-w);_o(n,A,E,3*w,2*w),l.setRenderTarget(n),l.render(d,Za)}};function YE(t){let e=[],n=[],i=[],r=t,s=t-Gr+1+fx.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);e.push(a);let l=1/a;o>t-Gr?l=fx[o-t+Gr-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),f=-c,d=1+c,h=[f,f,d,f,d,d,f,f,d,d,f,d],p=6,v=6,S=3,_=2,u=1,m=new Float32Array(S*v*p),x=new Float32Array(_*v*p),w=new Float32Array(u*v*p);for(let E=0;E<p;E++){let C=E%3*2/3-1,g=E>2?0:-1,T=[C,g,0,C+2/3,g,0,C+2/3,g+1,0,C,g,0,C+2/3,g+1,0,C,g+1,0];m.set(T,S*v*E),x.set(h,_*v*E);let P=[E,E,E,E,E,E];w.set(P,u*v*E)}let A=new qn;A.setAttribute("position",new Ln(m,S)),A.setAttribute("uv",new Ln(x,_)),A.setAttribute("faceIndex",new Ln(w,u)),i.push(new yn(A,null)),r>Gr&&r--}return{lodMeshes:i,sizeLods:e,sigmas:n}}function px(t,e,n){let i=new Nn(t,e,n);return i.texture.mapping=ka,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function _o(t,e,n,i,r){t.viewport.set(e,n,i,r),t.scissor.set(e,n,i,r)}function ZE(t,e,n){return new Dn({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:XE,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:yh(),fragmentShader:`

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
		`,blending:Ai,depthTest:!1,depthWrite:!1})}function $E(t,e,n){let i=new Float32Array(ps),r=new k(0,1,0);return new Dn({name:"SphericalGaussianBlur",defines:{n:ps,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:yh(),fragmentShader:`

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
		`,blending:Ai,depthTest:!1,depthWrite:!1})}function mx(){return new Dn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:yh(),fragmentShader:`

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
		`,blending:Ai,depthTest:!1,depthWrite:!1})}function gx(){return new Dn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:yh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Ai,depthTest:!1,depthWrite:!1})}function yh(){return`

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
	`}var vh=class extends Nn{constructor(e=1,n={}){super(e,e,n),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new Ra(r),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new Ei(5,5,5),s=new Dn({name:"CubemapFromEquirect",uniforms:ds(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:fn,blending:Ai});s.uniforms.tEquirect.value=n;let o=new yn(r,s),a=n.minFilter;return n.minFilter===kr&&(n.minFilter=Zt),new wu(1,10,this).update(e,o),n.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,n=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(n,i,r);e.setRenderTarget(s)}};function JE(t){let e=new WeakMap,n=new WeakMap,i=null;function r(h,p=!1){return h==null?null:p?o(h):s(h)}function s(h){if(h&&h.isTexture){let p=h.mapping;if(p===Au||p===Cu)if(e.has(h)){let v=e.get(h).texture;return a(v,h.mapping)}else{let v=h.image;if(v&&v.height>0){let S=new vh(v.height);return S.fromEquirectangularTexture(t,h),e.set(h,S),h.addEventListener("dispose",c),a(S.texture,h.mapping)}else return null}}return h}function o(h){if(h&&h.isTexture){let p=h.mapping,v=p===Au||p===Cu,S=p===Br||p===fs;if(v||S){let _=n.get(h),u=_!==void 0?_.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==u)return i===null&&(i=new _h(t)),_=v?i.fromEquirectangular(h,_):i.fromCubemap(h,_),_.texture.pmremVersion=h.pmremVersion,n.set(h,_),_.texture;if(_!==void 0)return _.texture;{let m=h.image;return v&&m&&m.height>0||S&&m&&l(m)?(i===null&&(i=new _h(t)),_=v?i.fromEquirectangular(h):i.fromCubemap(h),_.texture.pmremVersion=h.pmremVersion,n.set(h,_),h.addEventListener("dispose",f),_.texture):null}}}return h}function a(h,p){return p===Au?h.mapping=Br:p===Cu&&(h.mapping=fs),h}function l(h){let p=0,v=6;for(let S=0;S<v;S++)h[S]!==void 0&&p++;return p===v}function c(h){let p=h.target;p.removeEventListener("dispose",c);let v=e.get(p);v!==void 0&&(e.delete(p),v.dispose())}function f(h){let p=h.target;p.removeEventListener("dispose",f);let v=n.get(p);v!==void 0&&(n.delete(p),v.dispose())}function d(){e=new WeakMap,n=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:d}}function KE(t){let e={};function n(i){if(e[i]!==void 0)return e[i];let r=t.getExtension(i);return e[i]=r,r}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let r=n(i);return r===null&&nu("WebGLRenderer: "+i+" extension not supported."),r}}}function jE(t,e,n,i){let r={},s=new WeakMap;function o(d){let h=d.target;h.index!==null&&e.remove(h.index);for(let v in h.attributes)e.remove(h.attributes[v]);h.removeEventListener("dispose",o),delete r[h.id];let p=s.get(h);p&&(e.remove(p),s.delete(h)),i.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,n.memory.geometries--}function a(d,h){return r[h.id]===!0||(h.addEventListener("dispose",o),r[h.id]=!0,n.memory.geometries++),h}function l(d){let h=d.attributes;for(let p in h)e.update(h[p],t.ARRAY_BUFFER)}function c(d){let h=[],p=d.index,v=d.attributes.position,S=0;if(v===void 0)return;if(p!==null){let m=p.array;S=p.version;for(let x=0,w=m.length;x<w;x+=3){let A=m[x+0],E=m[x+1],C=m[x+2];h.push(A,E,E,C,C,A)}}else{let m=v.array;S=v.version;for(let x=0,w=m.length/3-1;x<w;x+=3){let A=x+0,E=x+1,C=x+2;h.push(A,E,E,C,C,A)}}let _=new(v.count>=65535?Aa:ba)(h,1);_.version=S;let u=s.get(d);u&&e.remove(u),s.set(d,_)}function f(d){let h=s.get(d);if(h){let p=d.index;p!==null&&h.version<p.version&&c(d)}else c(d);return s.get(d)}return{get:a,update:l,getWireframeAttribute:f}}function QE(t,e,n){let i;function r(d){i=d}let s,o;function a(d){s=d.type,o=d.bytesPerElement}function l(d,h){t.drawElements(i,h,s,d*o),n.update(h,i,1)}function c(d,h,p){p!==0&&(t.drawElementsInstanced(i,h,s,d*o,p),n.update(h,i,p))}function f(d,h,p){if(p===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,h,0,s,d,0,p);let S=0;for(let _=0;_<p;_++)S+=h[_];n.update(S,i,1)}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=f}function eT(t){let e={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(n.calls++,o){case t.TRIANGLES:n.triangles+=a*(s/3);break;case t.LINES:n.lines+=a*(s/2);break;case t.LINE_STRIP:n.lines+=a*(s-1);break;case t.LINE_LOOP:n.lines+=a*s;break;case t.POINTS:n.points+=a*s;break;default:Pe("WebGLInfo: Unknown draw mode:",o);break}}function r(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:e,render:n,programs:null,autoReset:!0,reset:r,update:i}}function tT(t,e,n){let i=new WeakMap,r=new wt;function s(o,a,l){let c=o.morphTargetInfluences,f=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,d=f!==void 0?f.length:0,h=i.get(a);if(h===void 0||h.count!==d){let T=function(){C.dispose(),i.delete(a),a.removeEventListener("dispose",T)};h!==void 0&&h.texture.dispose();let p=a.morphAttributes.position!==void 0,v=a.morphAttributes.normal!==void 0,S=a.morphAttributes.color!==void 0,_=a.morphAttributes.position||[],u=a.morphAttributes.normal||[],m=a.morphAttributes.color||[],x=0;p===!0&&(x=1),v===!0&&(x=2),S===!0&&(x=3);let w=a.attributes.position.count*x,A=1;w>e.maxTextureSize&&(A=Math.ceil(w/e.maxTextureSize),w=e.maxTextureSize);let E=new Float32Array(w*A*4*d),C=new Ma(E,w,A,d);C.type=ci,C.needsUpdate=!0;let g=x*4;for(let P=0;P<d;P++){let R=_[P],D=u[P],Y=m[P],H=w*A*4*P;for(let O=0;O<R.count;O++){let z=O*g;p===!0&&(r.fromBufferAttribute(R,O),E[H+z+0]=r.x,E[H+z+1]=r.y,E[H+z+2]=r.z,E[H+z+3]=0),v===!0&&(r.fromBufferAttribute(D,O),E[H+z+4]=r.x,E[H+z+5]=r.y,E[H+z+6]=r.z,E[H+z+7]=0),S===!0&&(r.fromBufferAttribute(Y,O),E[H+z+8]=r.x,E[H+z+9]=r.y,E[H+z+10]=r.z,E[H+z+11]=Y.itemSize===4?r.w:1)}}h={count:d,texture:C,size:new Ke(w,A)},i.set(a,h),a.addEventListener("dispose",T)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(t,"morphTexture",o.morphTexture,n);else{let p=0;for(let S=0;S<c.length;S++)p+=c[S];let v=a.morphTargetsRelative?1:1-p;l.getUniforms().setValue(t,"morphTargetBaseInfluence",v),l.getUniforms().setValue(t,"morphTargetInfluences",c)}l.getUniforms().setValue(t,"morphTargetsTexture",h.texture,n),l.getUniforms().setValue(t,"morphTargetsTextureSize",h.size)}return{update:s}}function nT(t,e,n,i,r){let s=new WeakMap;function o(c){let f=r.render.frame,d=c.geometry,h=e.get(c,d);if(s.get(h)!==f&&(e.update(h),s.set(h,f)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==f&&(n.update(c.instanceMatrix,t.ARRAY_BUFFER),c.instanceColor!==null&&n.update(c.instanceColor,t.ARRAY_BUFFER),s.set(c,f))),c.isSkinnedMesh){let p=c.skeleton;s.get(p)!==f&&(p.update(),s.set(p,f))}return h}function a(){s=new WeakMap}function l(c){let f=c.target;f.removeEventListener("dispose",l),i.releaseStatesOfObject(f),n.remove(f.instanceMatrix),f.instanceColor!==null&&n.remove(f.instanceColor)}return{update:o,dispose:a}}var iT={[Rp]:"LINEAR_TONE_MAPPING",[Pp]:"REINHARD_TONE_MAPPING",[Ip]:"CINEON_TONE_MAPPING",[Lp]:"ACES_FILMIC_TONE_MAPPING",[Dp]:"AGX_TONE_MAPPING",[Up]:"NEUTRAL_TONE_MAPPING",[Np]:"CUSTOM_TONE_MAPPING"};function rT(t,e,n,i,r){let s=new Nn(e,n,{type:t,depthBuffer:i,stencilBuffer:r,depthTexture:i?new ji(e,n):void 0}),o=new Nn(e,n,{type:Ci,depthBuffer:!1,stencilBuffer:!1}),a=new qn;a.setAttribute("position",new Gt([-1,3,0,-1,-1,0,3,-1,0],3)),a.setAttribute("uv",new Gt([0,2,0,0,2,0],2));let l=new uu({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),c=new yn(a,l),f=new fo(-1,1,1,-1,0,1),d=null,h=null,p=!1,v,S=null,_=[],u=!1;this.setSize=function(m,x){s.setSize(m,x),o.setSize(m,x);for(let w=0;w<_.length;w++){let A=_[w];A.setSize&&A.setSize(m,x)}},this.setEffects=function(m){_=m,u=_.length>0&&_[0].isRenderPass===!0;let x=s.width,w=s.height;for(let A=0;A<_.length;A++){let E=_[A];E.setSize&&E.setSize(x,w)}},this.begin=function(m,x){if(p||m.toneMapping===ai&&_.length===0)return!1;if(S=x,x!==null){let w=x.width,A=x.height;(s.width!==w||s.height!==A)&&this.setSize(w,A)}return u===!1&&m.setRenderTarget(s),v=m.toneMapping,m.toneMapping=ai,!0},this.hasRenderPass=function(){return u},this.end=function(m,x){m.toneMapping=v,p=!0;let w=s,A=o;for(let E=0;E<_.length;E++){let C=_[E];if(C.enabled!==!1&&(C.render(m,A,w,x),C.needsSwap!==!1)){let g=w;w=A,A=g}}if(d!==m.outputColorSpace||h!==m.toneMapping){d=m.outputColorSpace,h=m.toneMapping,l.defines={},Xe.getTransfer(d)===et&&(l.defines.SRGB_TRANSFER="");let E=iT[h];E&&(l.defines[E]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=w.texture,m.setRenderTarget(S),m.render(c,f),S=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){s.depthTexture&&s.depthTexture.dispose(),s.dispose(),o.dispose(),a.dispose(),l.dispose()}}var Fx=new xn,am=new ji(1,1),Ox=new Ma,Bx=new ou,kx=new Ra,_x=[],vx=[],xx=new Float32Array(16),yx=new Float32Array(9),Sx=new Float32Array(4);function xo(t,e,n){let i=t[0];if(i<=0||i>0)return t;let r=e*n,s=_x[r];if(s===void 0&&(s=new Float32Array(r),_x[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=n,t[o].toArray(s,a)}return s}function Ot(t,e){if(t.length!==e.length)return!1;for(let n=0,i=t.length;n<i;n++)if(t[n]!==e[n])return!1;return!0}function Bt(t,e){for(let n=0,i=e.length;n<i;n++)t[n]=e[n]}function Sh(t,e){let n=vx[e];n===void 0&&(n=new Int32Array(e),vx[e]=n);for(let i=0;i!==e;++i)n[i]=t.allocateTextureUnit();return n}function sT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1f(this.addr,e),n[0]=e)}function oT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2f(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Ot(n,e))return;t.uniform2fv(this.addr,e),Bt(n,e)}}function aT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3f(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else if(e.r!==void 0)(n[0]!==e.r||n[1]!==e.g||n[2]!==e.b)&&(t.uniform3f(this.addr,e.r,e.g,e.b),n[0]=e.r,n[1]=e.g,n[2]=e.b);else{if(Ot(n,e))return;t.uniform3fv(this.addr,e),Bt(n,e)}}function lT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4f(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Ot(n,e))return;t.uniform4fv(this.addr,e),Bt(n,e)}}function cT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Ot(n,e))return;t.uniformMatrix2fv(this.addr,!1,e),Bt(n,e)}else{if(Ot(n,i))return;Sx.set(i),t.uniformMatrix2fv(this.addr,!1,Sx),Bt(n,i)}}function uT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Ot(n,e))return;t.uniformMatrix3fv(this.addr,!1,e),Bt(n,e)}else{if(Ot(n,i))return;yx.set(i),t.uniformMatrix3fv(this.addr,!1,yx),Bt(n,i)}}function hT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Ot(n,e))return;t.uniformMatrix4fv(this.addr,!1,e),Bt(n,e)}else{if(Ot(n,i))return;xx.set(i),t.uniformMatrix4fv(this.addr,!1,xx),Bt(n,i)}}function fT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1i(this.addr,e),n[0]=e)}function dT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2i(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Ot(n,e))return;t.uniform2iv(this.addr,e),Bt(n,e)}}function pT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3i(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Ot(n,e))return;t.uniform3iv(this.addr,e),Bt(n,e)}}function mT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4i(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Ot(n,e))return;t.uniform4iv(this.addr,e),Bt(n,e)}}function gT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1ui(this.addr,e),n[0]=e)}function _T(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2ui(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Ot(n,e))return;t.uniform2uiv(this.addr,e),Bt(n,e)}}function vT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3ui(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Ot(n,e))return;t.uniform3uiv(this.addr,e),Bt(n,e)}}function xT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4ui(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Ot(n,e))return;t.uniform4uiv(this.addr,e),Bt(n,e)}}function yT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r);let s;this.type===t.SAMPLER_2D_SHADOW?(am.compareFunction=n.isReversedDepthBuffer()?ph:dh,s=am):s=Fx,n.setTexture2D(e||s,r)}function ST(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture3D(e||Bx,r)}function MT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTextureCube(e||kx,r)}function wT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture2DArray(e||Ox,r)}function ET(t){switch(t){case 5126:return sT;case 35664:return oT;case 35665:return aT;case 35666:return lT;case 35674:return cT;case 35675:return uT;case 35676:return hT;case 5124:case 35670:return fT;case 35667:case 35671:return dT;case 35668:case 35672:return pT;case 35669:case 35673:return mT;case 5125:return gT;case 36294:return _T;case 36295:return vT;case 36296:return xT;case 35678:case 36198:case 36298:case 36306:case 35682:return yT;case 35679:case 36299:case 36307:return ST;case 35680:case 36300:case 36308:case 36293:return MT;case 36289:case 36303:case 36311:case 36292:return wT}}function TT(t,e){t.uniform1fv(this.addr,e)}function bT(t,e){let n=xo(e,this.size,2);t.uniform2fv(this.addr,n)}function AT(t,e){let n=xo(e,this.size,3);t.uniform3fv(this.addr,n)}function CT(t,e){let n=xo(e,this.size,4);t.uniform4fv(this.addr,n)}function RT(t,e){let n=xo(e,this.size,4);t.uniformMatrix2fv(this.addr,!1,n)}function PT(t,e){let n=xo(e,this.size,9);t.uniformMatrix3fv(this.addr,!1,n)}function IT(t,e){let n=xo(e,this.size,16);t.uniformMatrix4fv(this.addr,!1,n)}function LT(t,e){t.uniform1iv(this.addr,e)}function NT(t,e){t.uniform2iv(this.addr,e)}function DT(t,e){t.uniform3iv(this.addr,e)}function UT(t,e){t.uniform4iv(this.addr,e)}function FT(t,e){t.uniform1uiv(this.addr,e)}function OT(t,e){t.uniform2uiv(this.addr,e)}function BT(t,e){t.uniform3uiv(this.addr,e)}function kT(t,e){t.uniform4uiv(this.addr,e)}function zT(t,e,n){let i=this.cache,r=e.length,s=Sh(n,r);Ot(i,s)||(t.uniform1iv(this.addr,s),Bt(i,s));let o;this.type===t.SAMPLER_2D_SHADOW?o=am:o=Fx;for(let a=0;a!==r;++a)n.setTexture2D(e[a]||o,s[a])}function VT(t,e,n){let i=this.cache,r=e.length,s=Sh(n,r);Ot(i,s)||(t.uniform1iv(this.addr,s),Bt(i,s));for(let o=0;o!==r;++o)n.setTexture3D(e[o]||Bx,s[o])}function GT(t,e,n){let i=this.cache,r=e.length,s=Sh(n,r);Ot(i,s)||(t.uniform1iv(this.addr,s),Bt(i,s));for(let o=0;o!==r;++o)n.setTextureCube(e[o]||kx,s[o])}function HT(t,e,n){let i=this.cache,r=e.length,s=Sh(n,r);Ot(i,s)||(t.uniform1iv(this.addr,s),Bt(i,s));for(let o=0;o!==r;++o)n.setTexture2DArray(e[o]||Ox,s[o])}function WT(t){switch(t){case 5126:return TT;case 35664:return bT;case 35665:return AT;case 35666:return CT;case 35674:return RT;case 35675:return PT;case 35676:return IT;case 5124:case 35670:return LT;case 35667:case 35671:return NT;case 35668:case 35672:return DT;case 35669:case 35673:return UT;case 5125:return FT;case 36294:return OT;case 36295:return BT;case 36296:return kT;case 35678:case 36198:case 36298:case 36306:case 35682:return zT;case 35679:case 36299:case 36307:return VT;case 35680:case 36300:case 36308:case 36293:return GT;case 36289:case 36303:case 36311:case 36292:return HT}}var lm=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.setValue=ET(n.type)}},cm=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=WT(n.type)}},um=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,n,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,n[a.id],i)}}},sm=/(\w+)(\])?(\[|\.)?/g;function Mx(t,e){t.seq.push(e),t.map[e.id]=e}function XT(t,e,n){let i=t.name,r=i.length;for(sm.lastIndex=0;;){let s=sm.exec(i),o=sm.lastIndex,a=s[1],l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){Mx(n,c===void 0?new lm(a,t,e):new cm(a,t,e));break}else{let d=n.map[a];d===void 0&&(d=new um(a),Mx(n,d)),n=d}}}var vo=class{constructor(e,n){this.seq=[],this.map={};let i=e.getProgramParameter(n,e.ACTIVE_UNIFORMS);for(let o=0;o<i;++o){let a=e.getActiveUniform(n,o),l=e.getUniformLocation(n,a.name);XT(a,l,this)}let r=[],s=[];for(let o of this.seq)o.type===e.SAMPLER_2D_SHADOW||o.type===e.SAMPLER_CUBE_SHADOW||o.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(o):s.push(o);r.length>0&&(this.seq=r.concat(s))}setValue(e,n,i,r){let s=this.map[n];s!==void 0&&s.setValue(e,i,r)}setOptional(e,n,i){let r=n[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,n,i,r){for(let s=0,o=n.length;s!==o;++s){let a=n[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,n){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in n&&i.push(o)}return i}};function wx(t,e,n){let i=t.createShader(e);return t.shaderSource(i,n),t.compileShader(i),i}var qT=37297,YT=0;function ZT(t,e){let n=t.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,n.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${n[o]}`)}return i.join(`
`)}var Ex=new De;function $T(t){Xe._getMatrix(Ex,Xe.workingColorSpace,t);let e=`mat3( ${Ex.elements.map(n=>n.toFixed(4))} )`;switch(Xe.getTransfer(t)){case ya:return[e,"LinearTransferOETF"];case et:return[e,"sRGBTransferOETF"];default:return Re("WebGLProgram: Unsupported color space: ",t),[e,"LinearTransferOETF"]}}function Tx(t,e,n){let i=t.getShaderParameter(e,t.COMPILE_STATUS),s=(t.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return n.toUpperCase()+`

`+s+`

`+ZT(t.getShaderSource(e),a)}else return s}function JT(t,e){let n=$T(e);return[`vec4 ${t}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}var KT={[Rp]:"Linear",[Pp]:"Reinhard",[Ip]:"Cineon",[Lp]:"ACESFilmic",[Dp]:"AgX",[Up]:"Neutral",[Np]:"Custom"};function jT(t,e){let n=KT[e];return n===void 0?(Re("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+t+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+t+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var gh=new k;function QT(){Xe.getLuminanceCoefficients(gh);let t=gh.x.toFixed(4),e=gh.y.toFixed(4),n=gh.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${t}, ${e}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function eb(t){return[t.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",t.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Ja).join(`
`)}function tb(t){let e=[];for(let n in t){let i=t[n];i!==!1&&e.push("#define "+n+" "+i)}return e.join(`
`)}function nb(t,e){let n={},i=t.getProgramParameter(e,t.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=t.getActiveAttrib(e,r),o=s.name,a=1;s.type===t.FLOAT_MAT2&&(a=2),s.type===t.FLOAT_MAT3&&(a=3),s.type===t.FLOAT_MAT4&&(a=4),n[o]={type:s.type,location:t.getAttribLocation(e,o),locationSize:a}}return n}function Ja(t){return t!==""}function bx(t,e){let n=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return t.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function Ax(t,e){return t.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var ib=/^[ \t]*#include +<([\w\d./]+)>/gm;function hm(t){return t.replace(ib,sb)}var rb=new Map;function sb(t,e){let n=Ve[e];if(n===void 0){let i=rb.get(e);if(i!==void 0)n=Ve[i],Re('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return hm(n)}var ob=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Cx(t){return t.replace(ob,ab)}function ab(t,e,n,i){let r="";for(let s=parseInt(e);s<parseInt(n);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function Rx(t){let e=`precision ${t.precision} float;
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
#define LOW_PRECISION`),e}var lb={[Ba]:"SHADOWMAP_TYPE_PCF",[po]:"SHADOWMAP_TYPE_VSM"};function cb(t){return lb[t.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var ub={[Br]:"ENVMAP_TYPE_CUBE",[fs]:"ENVMAP_TYPE_CUBE",[ka]:"ENVMAP_TYPE_CUBE_UV"};function hb(t){return t.envMap===!1?"ENVMAP_TYPE_CUBE":ub[t.envMapMode]||"ENVMAP_TYPE_CUBE"}var fb={[fs]:"ENVMAP_MODE_REFRACTION"};function db(t){return t.envMap===!1?"ENVMAP_MODE_REFLECTION":fb[t.envMapMode]||"ENVMAP_MODE_REFLECTION"}var pb={[bu]:"ENVMAP_BLENDING_MULTIPLY",[Zv]:"ENVMAP_BLENDING_MIX",[$v]:"ENVMAP_BLENDING_ADD"};function mb(t){return t.envMap===!1?"ENVMAP_BLENDING_NONE":pb[t.combine]||"ENVMAP_BLENDING_NONE"}function gb(t){let e=t.envMapCubeUVHeight;if(e===null)return null;let n=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,n),112)),texelHeight:i,maxMip:n}}function _b(t,e,n,i){let r=t.getContext(),s=n.defines,o=n.vertexShader,a=n.fragmentShader,l=cb(n),c=hb(n),f=db(n),d=mb(n),h=gb(n),p=eb(n),v=tb(s),S=r.createProgram(),_,u,m=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(_=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,v].filter(Ja).join(`
`),_.length>0&&(_+=`
`),u=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,v].filter(Ja).join(`
`),u.length>0&&(u+=`
`)):(_=[Rx(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,v,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+f:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexNormals?"#define HAS_NORMAL":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Ja).join(`
`),u=[Rx(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,v,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+f:"",n.envMap?"#define "+d:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor?"#define USE_COLOR":"",n.vertexAlphas||n.batchingColor?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==ai?"#define TONE_MAPPING":"",n.toneMapping!==ai?Ve.tonemapping_pars_fragment:"",n.toneMapping!==ai?jT("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",Ve.colorspace_pars_fragment,JT("linearToOutputTexel",n.outputColorSpace),QT(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(Ja).join(`
`)),o=hm(o),o=bx(o,n),o=Ax(o,n),a=hm(a),a=bx(a,n),a=Ax(a,n),o=Cx(o),a=Cx(a),n.isRawShaderMaterial!==!0&&(m=`#version 300 es
`,_=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+_,u=["#define varying in",n.glslVersion===Wp?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===Wp?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+u);let x=m+_+o,w=m+u+a,A=wx(r,r.VERTEX_SHADER,x),E=wx(r,r.FRAGMENT_SHADER,w);r.attachShader(S,A),r.attachShader(S,E),n.index0AttributeName!==void 0?r.bindAttribLocation(S,0,n.index0AttributeName):n.morphTargets===!0&&r.bindAttribLocation(S,0,"position"),r.linkProgram(S);function C(R){if(t.debug.checkShaderErrors){let D=r.getProgramInfoLog(S)||"",Y=r.getShaderInfoLog(A)||"",H=r.getShaderInfoLog(E)||"",O=D.trim(),z=Y.trim(),X=H.trim(),ee=!0,te=!0;if(r.getProgramParameter(S,r.LINK_STATUS)===!1)if(ee=!1,typeof t.debug.onShaderError=="function")t.debug.onShaderError(r,S,A,E);else{let ue=Tx(r,A,"vertex"),ce=Tx(r,E,"fragment");Pe("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(S,r.VALIDATE_STATUS)+`

Material Name: `+R.name+`
Material Type: `+R.type+`

Program Info Log: `+O+`
`+ue+`
`+ce)}else O!==""?Re("WebGLProgram: Program Info Log:",O):(z===""||X==="")&&(te=!1);te&&(R.diagnostics={runnable:ee,programLog:O,vertexShader:{log:z,prefix:_},fragmentShader:{log:X,prefix:u}})}r.deleteShader(A),r.deleteShader(E),g=new vo(r,S),T=nb(r,S)}let g;this.getUniforms=function(){return g===void 0&&C(this),g};let T;this.getAttributes=function(){return T===void 0&&C(this),T};let P=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return P===!1&&(P=r.getProgramParameter(S,qT)),P},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(S),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=YT++,this.cacheKey=e,this.usedTimes=1,this.program=S,this.vertexShader=A,this.fragmentShader=E,this}var vb=0,fm=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let n=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(n),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let n=this.materialCache.get(e);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let n=this.materialCache,i=n.get(e);return i===void 0&&(i=new Set,n.set(e,i)),i}_getShaderStage(e){let n=this.shaderCache,i=n.get(e);return i===void 0&&(i=new dm(e),n.set(e,i)),i}},dm=class{constructor(e){this.id=vb++,this.code=e,this.usedTimes=0}};function xb(t){return t===Vr||t===Xa||t===qa}function yb(t,e,n,i,r,s){let o=new wa,a=new fm,l=new Set,c=[],f=new Map,d=i.logarithmicDepthBuffer,h=i.precision,p={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function v(g){return l.add(g),g===0?"uv":`uv${g}`}function S(g,T,P,R,D,Y){let H=R.fog,O=D.geometry,z=g.isMeshStandardMaterial||g.isMeshLambertMaterial||g.isMeshPhongMaterial?R.environment:null,X=g.isMeshStandardMaterial||g.isMeshLambertMaterial&&!g.envMap||g.isMeshPhongMaterial&&!g.envMap,ee=e.get(g.envMap||z,X),te=ee&&ee.mapping===ka?ee.image.height:null,ue=p[g.type];g.precision!==null&&(h=i.getMaxPrecision(g.precision),h!==g.precision&&Re("WebGLProgram.getParameters:",g.precision,"not supported, using",h,"instead."));let ce=O.morphAttributes.position||O.morphAttributes.normal||O.morphAttributes.color,Se=ce!==void 0?ce.length:0,Ye=0;O.morphAttributes.position!==void 0&&(Ye=1),O.morphAttributes.normal!==void 0&&(Ye=2),O.morphAttributes.color!==void 0&&(Ye=3);let Qe,Ie,K,fe;if(ue){let Oe=Pi[ue];Qe=Oe.vertexShader,Ie=Oe.fragmentShader}else Qe=g.vertexShader,Ie=g.fragmentShader,a.update(g),K=a.getVertexShaderID(g),fe=a.getFragmentShaderID(g);let ne=t.getRenderTarget(),we=t.state.buffers.depth.getReversed(),Ne=D.isInstancedMesh===!0,Ce=D.isBatchedMesh===!0,dt=!!g.map,ke=!!g.matcap,je=!!ee,it=!!g.aoMap,Ue=!!g.lightMap,Et=!!g.bumpMap,at=!!g.normalMap,Wt=!!g.displacementMap,N=!!g.emissiveMap,xt=!!g.metalnessMap,ze=!!g.roughnessMap,rt=g.anisotropy>0,he=g.clearcoat>0,_t=g.dispersion>0,b=g.iridescence>0,y=g.sheen>0,I=g.transmission>0,B=rt&&!!g.anisotropyMap,U=he&&!!g.clearcoatMap,$=he&&!!g.clearcoatNormalMap,j=he&&!!g.clearcoatRoughnessMap,W=b&&!!g.iridescenceMap,Z=b&&!!g.iridescenceThicknessMap,re=y&&!!g.sheenColorMap,ge=y&&!!g.sheenRoughnessMap,oe=!!g.specularMap,se=!!g.specularColorMap,Le=!!g.specularIntensityMap,Fe=I&&!!g.transmissionMap,He=I&&!!g.thicknessMap,L=!!g.gradientMap,ae=!!g.alphaMap,J=g.alphaTest>0,_e=!!g.alphaHash,le=!!g.extensions,Q=ai;g.toneMapped&&(ne===null||ne.isXRRenderTarget===!0)&&(Q=t.toneMapping);let Ee={shaderID:ue,shaderType:g.type,shaderName:g.name,vertexShader:Qe,fragmentShader:Ie,defines:g.defines,customVertexShaderID:K,customFragmentShaderID:fe,isRawShaderMaterial:g.isRawShaderMaterial===!0,glslVersion:g.glslVersion,precision:h,batching:Ce,batchingColor:Ce&&D._colorsTexture!==null,instancing:Ne,instancingColor:Ne&&D.instanceColor!==null,instancingMorph:Ne&&D.morphTexture!==null,outputColorSpace:ne===null?t.outputColorSpace:ne.isXRRenderTarget===!0?ne.texture.colorSpace:Xe.workingColorSpace,alphaToCoverage:!!g.alphaToCoverage,map:dt,matcap:ke,envMap:je,envMapMode:je&&ee.mapping,envMapCubeUVHeight:te,aoMap:it,lightMap:Ue,bumpMap:Et,normalMap:at,displacementMap:Wt,emissiveMap:N,normalMapObjectSpace:at&&g.normalMapType===jv,normalMapTangentSpace:at&&g.normalMapType===fh,packedNormalMap:at&&g.normalMapType===fh&&xb(g.normalMap.format),metalnessMap:xt,roughnessMap:ze,anisotropy:rt,anisotropyMap:B,clearcoat:he,clearcoatMap:U,clearcoatNormalMap:$,clearcoatRoughnessMap:j,dispersion:_t,iridescence:b,iridescenceMap:W,iridescenceThicknessMap:Z,sheen:y,sheenColorMap:re,sheenRoughnessMap:ge,specularMap:oe,specularColorMap:se,specularIntensityMap:Le,transmission:I,transmissionMap:Fe,thicknessMap:He,gradientMap:L,opaque:g.transparent===!1&&g.blending===us&&g.alphaToCoverage===!1,alphaMap:ae,alphaTest:J,alphaHash:_e,combine:g.combine,mapUv:dt&&v(g.map.channel),aoMapUv:it&&v(g.aoMap.channel),lightMapUv:Ue&&v(g.lightMap.channel),bumpMapUv:Et&&v(g.bumpMap.channel),normalMapUv:at&&v(g.normalMap.channel),displacementMapUv:Wt&&v(g.displacementMap.channel),emissiveMapUv:N&&v(g.emissiveMap.channel),metalnessMapUv:xt&&v(g.metalnessMap.channel),roughnessMapUv:ze&&v(g.roughnessMap.channel),anisotropyMapUv:B&&v(g.anisotropyMap.channel),clearcoatMapUv:U&&v(g.clearcoatMap.channel),clearcoatNormalMapUv:$&&v(g.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:j&&v(g.clearcoatRoughnessMap.channel),iridescenceMapUv:W&&v(g.iridescenceMap.channel),iridescenceThicknessMapUv:Z&&v(g.iridescenceThicknessMap.channel),sheenColorMapUv:re&&v(g.sheenColorMap.channel),sheenRoughnessMapUv:ge&&v(g.sheenRoughnessMap.channel),specularMapUv:oe&&v(g.specularMap.channel),specularColorMapUv:se&&v(g.specularColorMap.channel),specularIntensityMapUv:Le&&v(g.specularIntensityMap.channel),transmissionMapUv:Fe&&v(g.transmissionMap.channel),thicknessMapUv:He&&v(g.thicknessMap.channel),alphaMapUv:ae&&v(g.alphaMap.channel),vertexTangents:!!O.attributes.tangent&&(at||rt),vertexNormals:!!O.attributes.normal,vertexColors:g.vertexColors,vertexAlphas:g.vertexColors===!0&&!!O.attributes.color&&O.attributes.color.itemSize===4,pointsUvs:D.isPoints===!0&&!!O.attributes.uv&&(dt||ae),fog:!!H,useFog:g.fog===!0,fogExp2:!!H&&H.isFogExp2,flatShading:g.wireframe===!1&&(g.flatShading===!0||O.attributes.normal===void 0&&at===!1&&(g.isMeshLambertMaterial||g.isMeshPhongMaterial||g.isMeshStandardMaterial||g.isMeshPhysicalMaterial)),sizeAttenuation:g.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:we,skinning:D.isSkinnedMesh===!0,morphTargets:O.morphAttributes.position!==void 0,morphNormals:O.morphAttributes.normal!==void 0,morphColors:O.morphAttributes.color!==void 0,morphTargetsCount:Se,morphTextureStride:Ye,numDirLights:T.directional.length,numPointLights:T.point.length,numSpotLights:T.spot.length,numSpotLightMaps:T.spotLightMap.length,numRectAreaLights:T.rectArea.length,numHemiLights:T.hemi.length,numDirLightShadows:T.directionalShadowMap.length,numPointLightShadows:T.pointShadowMap.length,numSpotLightShadows:T.spotShadowMap.length,numSpotLightShadowsWithMaps:T.numSpotLightShadowsWithMaps,numLightProbes:T.numLightProbes,numLightProbeGrids:Y.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:g.dithering,shadowMapEnabled:t.shadowMap.enabled&&P.length>0,shadowMapType:t.shadowMap.type,toneMapping:Q,decodeVideoTexture:dt&&g.map.isVideoTexture===!0&&Xe.getTransfer(g.map.colorSpace)===et,decodeVideoTextureEmissive:N&&g.emissiveMap.isVideoTexture===!0&&Xe.getTransfer(g.emissiveMap.colorSpace)===et,premultipliedAlpha:g.premultipliedAlpha,doubleSided:g.side===Yn,flipSided:g.side===fn,useDepthPacking:g.depthPacking>=0,depthPacking:g.depthPacking||0,index0AttributeName:g.index0AttributeName,extensionClipCullDistance:le&&g.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(le&&g.extensions.multiDraw===!0||Ce)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:g.customProgramCacheKey()};return Ee.vertexUv1s=l.has(1),Ee.vertexUv2s=l.has(2),Ee.vertexUv3s=l.has(3),l.clear(),Ee}function _(g){let T=[];if(g.shaderID?T.push(g.shaderID):(T.push(g.customVertexShaderID),T.push(g.customFragmentShaderID)),g.defines!==void 0)for(let P in g.defines)T.push(P),T.push(g.defines[P]);return g.isRawShaderMaterial===!1&&(u(T,g),m(T,g),T.push(t.outputColorSpace)),T.push(g.customProgramCacheKey),T.join()}function u(g,T){g.push(T.precision),g.push(T.outputColorSpace),g.push(T.envMapMode),g.push(T.envMapCubeUVHeight),g.push(T.mapUv),g.push(T.alphaMapUv),g.push(T.lightMapUv),g.push(T.aoMapUv),g.push(T.bumpMapUv),g.push(T.normalMapUv),g.push(T.displacementMapUv),g.push(T.emissiveMapUv),g.push(T.metalnessMapUv),g.push(T.roughnessMapUv),g.push(T.anisotropyMapUv),g.push(T.clearcoatMapUv),g.push(T.clearcoatNormalMapUv),g.push(T.clearcoatRoughnessMapUv),g.push(T.iridescenceMapUv),g.push(T.iridescenceThicknessMapUv),g.push(T.sheenColorMapUv),g.push(T.sheenRoughnessMapUv),g.push(T.specularMapUv),g.push(T.specularColorMapUv),g.push(T.specularIntensityMapUv),g.push(T.transmissionMapUv),g.push(T.thicknessMapUv),g.push(T.combine),g.push(T.fogExp2),g.push(T.sizeAttenuation),g.push(T.morphTargetsCount),g.push(T.morphAttributeCount),g.push(T.numDirLights),g.push(T.numPointLights),g.push(T.numSpotLights),g.push(T.numSpotLightMaps),g.push(T.numHemiLights),g.push(T.numRectAreaLights),g.push(T.numDirLightShadows),g.push(T.numPointLightShadows),g.push(T.numSpotLightShadows),g.push(T.numSpotLightShadowsWithMaps),g.push(T.numLightProbes),g.push(T.shadowMapType),g.push(T.toneMapping),g.push(T.numClippingPlanes),g.push(T.numClipIntersection),g.push(T.depthPacking)}function m(g,T){o.disableAll(),T.instancing&&o.enable(0),T.instancingColor&&o.enable(1),T.instancingMorph&&o.enable(2),T.matcap&&o.enable(3),T.envMap&&o.enable(4),T.normalMapObjectSpace&&o.enable(5),T.normalMapTangentSpace&&o.enable(6),T.clearcoat&&o.enable(7),T.iridescence&&o.enable(8),T.alphaTest&&o.enable(9),T.vertexColors&&o.enable(10),T.vertexAlphas&&o.enable(11),T.vertexUv1s&&o.enable(12),T.vertexUv2s&&o.enable(13),T.vertexUv3s&&o.enable(14),T.vertexTangents&&o.enable(15),T.anisotropy&&o.enable(16),T.alphaHash&&o.enable(17),T.batching&&o.enable(18),T.dispersion&&o.enable(19),T.batchingColor&&o.enable(20),T.gradientMap&&o.enable(21),T.packedNormalMap&&o.enable(22),T.vertexNormals&&o.enable(23),g.push(o.mask),o.disableAll(),T.fog&&o.enable(0),T.useFog&&o.enable(1),T.flatShading&&o.enable(2),T.logarithmicDepthBuffer&&o.enable(3),T.reversedDepthBuffer&&o.enable(4),T.skinning&&o.enable(5),T.morphTargets&&o.enable(6),T.morphNormals&&o.enable(7),T.morphColors&&o.enable(8),T.premultipliedAlpha&&o.enable(9),T.shadowMapEnabled&&o.enable(10),T.doubleSided&&o.enable(11),T.flipSided&&o.enable(12),T.useDepthPacking&&o.enable(13),T.dithering&&o.enable(14),T.transmission&&o.enable(15),T.sheen&&o.enable(16),T.opaque&&o.enable(17),T.pointsUvs&&o.enable(18),T.decodeVideoTexture&&o.enable(19),T.decodeVideoTextureEmissive&&o.enable(20),T.alphaToCoverage&&o.enable(21),T.numLightProbeGrids>0&&o.enable(22),g.push(o.mask)}function x(g){let T=p[g.type],P;if(T){let R=Pi[T];P=ux.clone(R.uniforms)}else P=g.uniforms;return P}function w(g,T){let P=f.get(T);return P!==void 0?++P.usedTimes:(P=new _b(t,T,g,r),c.push(P),f.set(T,P)),P}function A(g){if(--g.usedTimes===0){let T=c.indexOf(g);c[T]=c[c.length-1],c.pop(),f.delete(g.cacheKey),g.destroy()}}function E(g){a.remove(g)}function C(){a.dispose()}return{getParameters:S,getProgramCacheKey:_,getUniforms:x,acquireProgram:w,releaseProgram:A,releaseShaderCache:E,programs:c,dispose:C}}function Sb(){let t=new WeakMap;function e(o){return t.has(o)}function n(o){let a=t.get(o);return a===void 0&&(a={},t.set(o,a)),a}function i(o){t.delete(o)}function r(o,a,l){t.get(o)[a]=l}function s(){t=new WeakMap}return{has:e,get:n,remove:i,update:r,dispose:s}}function Mb(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.material.id!==e.material.id?t.material.id-e.material.id:t.materialVariant!==e.materialVariant?t.materialVariant-e.materialVariant:t.z!==e.z?t.z-e.z:t.id-e.id}function Px(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.z!==e.z?e.z-t.z:t.id-e.id}function Ix(){let t=[],e=0,n=[],i=[],r=[];function s(){e=0,n.length=0,i.length=0,r.length=0}function o(h){let p=0;return h.isInstancedMesh&&(p+=2),h.isSkinnedMesh&&(p+=1),p}function a(h,p,v,S,_,u){let m=t[e];return m===void 0?(m={id:h.id,object:h,geometry:p,material:v,materialVariant:o(h),groupOrder:S,renderOrder:h.renderOrder,z:_,group:u},t[e]=m):(m.id=h.id,m.object=h,m.geometry=p,m.material=v,m.materialVariant=o(h),m.groupOrder=S,m.renderOrder=h.renderOrder,m.z=_,m.group=u),e++,m}function l(h,p,v,S,_,u){let m=a(h,p,v,S,_,u);v.transmission>0?i.push(m):v.transparent===!0?r.push(m):n.push(m)}function c(h,p,v,S,_,u){let m=a(h,p,v,S,_,u);v.transmission>0?i.unshift(m):v.transparent===!0?r.unshift(m):n.unshift(m)}function f(h,p){n.length>1&&n.sort(h||Mb),i.length>1&&i.sort(p||Px),r.length>1&&r.sort(p||Px)}function d(){for(let h=e,p=t.length;h<p;h++){let v=t[h];if(v.id===null)break;v.id=null,v.object=null,v.geometry=null,v.material=null,v.group=null}}return{opaque:n,transmissive:i,transparent:r,init:s,push:l,unshift:c,finish:d,sort:f}}function wb(){let t=new WeakMap;function e(i,r){let s=t.get(i),o;return s===void 0?(o=new Ix,t.set(i,[o])):r>=s.length?(o=new Ix,s.push(o)):o=s[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}function Eb(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={direction:new k,color:new qe};break;case"SpotLight":n={position:new k,direction:new k,color:new qe,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new k,color:new qe,distance:0,decay:0};break;case"HemisphereLight":n={direction:new k,skyColor:new qe,groundColor:new qe};break;case"RectAreaLight":n={color:new qe,position:new k,halfWidth:new k,halfHeight:new k};break}return t[e.id]=n,n}}}function Tb(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ke};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ke};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ke,shadowCameraNear:1,shadowCameraFar:1e3};break}return t[e.id]=n,n}}}var bb=0;function Ab(t,e){return(e.castShadow?2:0)-(t.castShadow?2:0)+(e.map?1:0)-(t.map?1:0)}function Cb(t){let e=new Eb,n=Tb(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new k);let r=new k,s=new At,o=new At;function a(c){let f=0,d=0,h=0;for(let T=0;T<9;T++)i.probe[T].set(0,0,0);let p=0,v=0,S=0,_=0,u=0,m=0,x=0,w=0,A=0,E=0,C=0;c.sort(Ab);for(let T=0,P=c.length;T<P;T++){let R=c[T],D=R.color,Y=R.intensity,H=R.distance,O=null;if(R.shadow&&R.shadow.map&&(R.shadow.map.texture.format===Vr?O=R.shadow.map.texture:O=R.shadow.map.depthTexture||R.shadow.map.texture),R.isAmbientLight)f+=D.r*Y,d+=D.g*Y,h+=D.b*Y;else if(R.isLightProbe){for(let z=0;z<9;z++)i.probe[z].addScaledVector(R.sh.coefficients[z],Y);C++}else if(R.isDirectionalLight){let z=e.get(R);if(z.color.copy(R.color).multiplyScalar(R.intensity),R.castShadow){let X=R.shadow,ee=n.get(R);ee.shadowIntensity=X.intensity,ee.shadowBias=X.bias,ee.shadowNormalBias=X.normalBias,ee.shadowRadius=X.radius,ee.shadowMapSize=X.mapSize,i.directionalShadow[p]=ee,i.directionalShadowMap[p]=O,i.directionalShadowMatrix[p]=R.shadow.matrix,m++}i.directional[p]=z,p++}else if(R.isSpotLight){let z=e.get(R);z.position.setFromMatrixPosition(R.matrixWorld),z.color.copy(D).multiplyScalar(Y),z.distance=H,z.coneCos=Math.cos(R.angle),z.penumbraCos=Math.cos(R.angle*(1-R.penumbra)),z.decay=R.decay,i.spot[S]=z;let X=R.shadow;if(R.map&&(i.spotLightMap[A]=R.map,A++,X.updateMatrices(R),R.castShadow&&E++),i.spotLightMatrix[S]=X.matrix,R.castShadow){let ee=n.get(R);ee.shadowIntensity=X.intensity,ee.shadowBias=X.bias,ee.shadowNormalBias=X.normalBias,ee.shadowRadius=X.radius,ee.shadowMapSize=X.mapSize,i.spotShadow[S]=ee,i.spotShadowMap[S]=O,w++}S++}else if(R.isRectAreaLight){let z=e.get(R);z.color.copy(D).multiplyScalar(Y),z.halfWidth.set(R.width*.5,0,0),z.halfHeight.set(0,R.height*.5,0),i.rectArea[_]=z,_++}else if(R.isPointLight){let z=e.get(R);if(z.color.copy(R.color).multiplyScalar(R.intensity),z.distance=R.distance,z.decay=R.decay,R.castShadow){let X=R.shadow,ee=n.get(R);ee.shadowIntensity=X.intensity,ee.shadowBias=X.bias,ee.shadowNormalBias=X.normalBias,ee.shadowRadius=X.radius,ee.shadowMapSize=X.mapSize,ee.shadowCameraNear=X.camera.near,ee.shadowCameraFar=X.camera.far,i.pointShadow[v]=ee,i.pointShadowMap[v]=O,i.pointShadowMatrix[v]=R.shadow.matrix,x++}i.point[v]=z,v++}else if(R.isHemisphereLight){let z=e.get(R);z.skyColor.copy(R.color).multiplyScalar(Y),z.groundColor.copy(R.groundColor).multiplyScalar(Y),i.hemi[u]=z,u++}}_>0&&(t.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=de.LTC_FLOAT_1,i.rectAreaLTC2=de.LTC_FLOAT_2):(i.rectAreaLTC1=de.LTC_HALF_1,i.rectAreaLTC2=de.LTC_HALF_2)),i.ambient[0]=f,i.ambient[1]=d,i.ambient[2]=h;let g=i.hash;(g.directionalLength!==p||g.pointLength!==v||g.spotLength!==S||g.rectAreaLength!==_||g.hemiLength!==u||g.numDirectionalShadows!==m||g.numPointShadows!==x||g.numSpotShadows!==w||g.numSpotMaps!==A||g.numLightProbes!==C)&&(i.directional.length=p,i.spot.length=S,i.rectArea.length=_,i.point.length=v,i.hemi.length=u,i.directionalShadow.length=m,i.directionalShadowMap.length=m,i.pointShadow.length=x,i.pointShadowMap.length=x,i.spotShadow.length=w,i.spotShadowMap.length=w,i.directionalShadowMatrix.length=m,i.pointShadowMatrix.length=x,i.spotLightMatrix.length=w+A-E,i.spotLightMap.length=A,i.numSpotLightShadowsWithMaps=E,i.numLightProbes=C,g.directionalLength=p,g.pointLength=v,g.spotLength=S,g.rectAreaLength=_,g.hemiLength=u,g.numDirectionalShadows=m,g.numPointShadows=x,g.numSpotShadows=w,g.numSpotMaps=A,g.numLightProbes=C,i.version=bb++)}function l(c,f){let d=0,h=0,p=0,v=0,S=0,_=f.matrixWorldInverse;for(let u=0,m=c.length;u<m;u++){let x=c[u];if(x.isDirectionalLight){let w=i.directional[d];w.direction.setFromMatrixPosition(x.matrixWorld),r.setFromMatrixPosition(x.target.matrixWorld),w.direction.sub(r),w.direction.transformDirection(_),d++}else if(x.isSpotLight){let w=i.spot[p];w.position.setFromMatrixPosition(x.matrixWorld),w.position.applyMatrix4(_),w.direction.setFromMatrixPosition(x.matrixWorld),r.setFromMatrixPosition(x.target.matrixWorld),w.direction.sub(r),w.direction.transformDirection(_),p++}else if(x.isRectAreaLight){let w=i.rectArea[v];w.position.setFromMatrixPosition(x.matrixWorld),w.position.applyMatrix4(_),o.identity(),s.copy(x.matrixWorld),s.premultiply(_),o.extractRotation(s),w.halfWidth.set(x.width*.5,0,0),w.halfHeight.set(0,x.height*.5,0),w.halfWidth.applyMatrix4(o),w.halfHeight.applyMatrix4(o),v++}else if(x.isPointLight){let w=i.point[h];w.position.setFromMatrixPosition(x.matrixWorld),w.position.applyMatrix4(_),h++}else if(x.isHemisphereLight){let w=i.hemi[S];w.direction.setFromMatrixPosition(x.matrixWorld),w.direction.transformDirection(_),S++}}}return{setup:a,setupView:l,state:i}}function Lx(t){let e=new Cb(t),n=[],i=[],r=[];function s(h){d.camera=h,n.length=0,i.length=0,r.length=0}function o(h){n.push(h)}function a(h){i.push(h)}function l(h){r.push(h)}function c(){e.setup(n)}function f(h){e.setupView(n,h)}let d={lightsArray:n,shadowsArray:i,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:d,setupLights:c,setupLightsView:f,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function Rb(t){let e=new WeakMap;function n(r,s=0){let o=e.get(r),a;return o===void 0?(a=new Lx(t),e.set(r,[a])):s>=o.length?(a=new Lx(t),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:n,dispose:i}}var Pb=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Ib=`uniform sampler2D shadow_pass;
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
}`,Lb=[new k(1,0,0),new k(-1,0,0),new k(0,1,0),new k(0,-1,0),new k(0,0,1),new k(0,0,-1)],Nb=[new k(0,-1,0),new k(0,-1,0),new k(0,0,1),new k(0,0,-1),new k(0,-1,0),new k(0,-1,0)],Nx=new At,$a=new k,om=new k;function Db(t,e,n){let i=new ho,r=new Ke,s=new Ke,o=new wt,a=new hu,l=new fu,c={},f=n.maxTextureSize,d={[Ji]:fn,[fn]:Ji,[Yn]:Yn},h=new Dn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ke},radius:{value:4}},vertexShader:Pb,fragmentShader:Ib}),p=h.clone();p.defines.HORIZONTAL_PASS=1;let v=new qn;v.setAttribute("position",new Ln(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let S=new yn(v,h),_=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Ba;let u=this.type;this.render=function(E,C,g){if(_.enabled===!1||_.autoUpdate===!1&&_.needsUpdate===!1||E.length===0)return;this.type===Rv&&(Re("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=Ba);let T=t.getRenderTarget(),P=t.getActiveCubeFace(),R=t.getActiveMipmapLevel(),D=t.state;D.setBlending(Ai),D.buffers.depth.getReversed()===!0?D.buffers.color.setClear(0,0,0,0):D.buffers.color.setClear(1,1,1,1),D.buffers.depth.setTest(!0),D.setScissorTest(!1);let Y=u!==this.type;Y&&C.traverse(function(H){H.material&&(Array.isArray(H.material)?H.material.forEach(O=>O.needsUpdate=!0):H.material.needsUpdate=!0)});for(let H=0,O=E.length;H<O;H++){let z=E[H],X=z.shadow;if(X===void 0){Re("WebGLShadowMap:",z,"has no shadow.");continue}if(X.autoUpdate===!1&&X.needsUpdate===!1)continue;r.copy(X.mapSize);let ee=X.getFrameExtents();r.multiply(ee),s.copy(X.mapSize),(r.x>f||r.y>f)&&(r.x>f&&(s.x=Math.floor(f/ee.x),r.x=s.x*ee.x,X.mapSize.x=s.x),r.y>f&&(s.y=Math.floor(f/ee.y),r.y=s.y*ee.y,X.mapSize.y=s.y));let te=t.state.buffers.depth.getReversed();if(X.camera._reversedDepth=te,X.map===null||Y===!0){if(X.map!==null&&(X.map.depthTexture!==null&&(X.map.depthTexture.dispose(),X.map.depthTexture=null),X.map.dispose()),this.type===po){if(z.isPointLight){Re("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}X.map=new Nn(r.x,r.y,{format:Vr,type:Ci,minFilter:Zt,magFilter:Zt,generateMipmaps:!1}),X.map.texture.name=z.name+".shadowMap",X.map.depthTexture=new ji(r.x,r.y,ci),X.map.depthTexture.name=z.name+".shadowMapDepth",X.map.depthTexture.format=Si,X.map.depthTexture.compareFunction=null,X.map.depthTexture.minFilter=Ht,X.map.depthTexture.magFilter=Ht}else z.isPointLight?(X.map=new vh(r.x),X.map.depthTexture=new cu(r.x,li)):(X.map=new Nn(r.x,r.y),X.map.depthTexture=new ji(r.x,r.y,li)),X.map.depthTexture.name=z.name+".shadowMap",X.map.depthTexture.format=Si,this.type===Ba?(X.map.depthTexture.compareFunction=te?ph:dh,X.map.depthTexture.minFilter=Zt,X.map.depthTexture.magFilter=Zt):(X.map.depthTexture.compareFunction=null,X.map.depthTexture.minFilter=Ht,X.map.depthTexture.magFilter=Ht);X.camera.updateProjectionMatrix()}let ue=X.map.isWebGLCubeRenderTarget?6:1;for(let ce=0;ce<ue;ce++){if(X.map.isWebGLCubeRenderTarget)t.setRenderTarget(X.map,ce),t.clear();else{ce===0&&(t.setRenderTarget(X.map),t.clear());let Se=X.getViewport(ce);o.set(s.x*Se.x,s.y*Se.y,s.x*Se.z,s.y*Se.w),D.viewport(o)}if(z.isPointLight){let Se=X.camera,Ye=X.matrix,Qe=z.distance||Se.far;Qe!==Se.far&&(Se.far=Qe,Se.updateProjectionMatrix()),$a.setFromMatrixPosition(z.matrixWorld),Se.position.copy($a),om.copy(Se.position),om.add(Lb[ce]),Se.up.copy(Nb[ce]),Se.lookAt(om),Se.updateMatrixWorld(),Ye.makeTranslation(-$a.x,-$a.y,-$a.z),Nx.multiplyMatrices(Se.projectionMatrix,Se.matrixWorldInverse),X._frustum.setFromProjectionMatrix(Nx,Se.coordinateSystem,Se.reversedDepth)}else X.updateMatrices(z);i=X.getFrustum(),w(C,g,X.camera,z,this.type)}X.isPointLightShadow!==!0&&this.type===po&&m(X,g),X.needsUpdate=!1}u=this.type,_.needsUpdate=!1,t.setRenderTarget(T,P,R)};function m(E,C){let g=e.update(S);h.defines.VSM_SAMPLES!==E.blurSamples&&(h.defines.VSM_SAMPLES=E.blurSamples,p.defines.VSM_SAMPLES=E.blurSamples,h.needsUpdate=!0,p.needsUpdate=!0),E.mapPass===null&&(E.mapPass=new Nn(r.x,r.y,{format:Vr,type:Ci})),h.uniforms.shadow_pass.value=E.map.depthTexture,h.uniforms.resolution.value=E.mapSize,h.uniforms.radius.value=E.radius,t.setRenderTarget(E.mapPass),t.clear(),t.renderBufferDirect(C,null,g,h,S,null),p.uniforms.shadow_pass.value=E.mapPass.texture,p.uniforms.resolution.value=E.mapSize,p.uniforms.radius.value=E.radius,t.setRenderTarget(E.map),t.clear(),t.renderBufferDirect(C,null,g,p,S,null)}function x(E,C,g,T){let P=null,R=g.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(R!==void 0)P=R;else if(P=g.isPointLight===!0?l:a,t.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){let D=P.uuid,Y=C.uuid,H=c[D];H===void 0&&(H={},c[D]=H);let O=H[Y];O===void 0&&(O=P.clone(),H[Y]=O,C.addEventListener("dispose",A)),P=O}if(P.visible=C.visible,P.wireframe=C.wireframe,T===po?P.side=C.shadowSide!==null?C.shadowSide:C.side:P.side=C.shadowSide!==null?C.shadowSide:d[C.side],P.alphaMap=C.alphaMap,P.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,P.map=C.map,P.clipShadows=C.clipShadows,P.clippingPlanes=C.clippingPlanes,P.clipIntersection=C.clipIntersection,P.displacementMap=C.displacementMap,P.displacementScale=C.displacementScale,P.displacementBias=C.displacementBias,P.wireframeLinewidth=C.wireframeLinewidth,P.linewidth=C.linewidth,g.isPointLight===!0&&P.isMeshDistanceMaterial===!0){let D=t.properties.get(P);D.light=g}return P}function w(E,C,g,T,P){if(E.visible===!1)return;if(E.layers.test(C.layers)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&P===po)&&(!E.frustumCulled||i.intersectsObject(E))){E.modelViewMatrix.multiplyMatrices(g.matrixWorldInverse,E.matrixWorld);let Y=e.update(E),H=E.material;if(Array.isArray(H)){let O=Y.groups;for(let z=0,X=O.length;z<X;z++){let ee=O[z],te=H[ee.materialIndex];if(te&&te.visible){let ue=x(E,te,T,P);E.onBeforeShadow(t,E,C,g,Y,ue,ee),t.renderBufferDirect(g,null,Y,ue,E,ee),E.onAfterShadow(t,E,C,g,Y,ue,ee)}}}else if(H.visible){let O=x(E,H,T,P);E.onBeforeShadow(t,E,C,g,Y,O,null),t.renderBufferDirect(g,null,Y,O,E,null),E.onAfterShadow(t,E,C,g,Y,O,null)}}let D=E.children;for(let Y=0,H=D.length;Y<H;Y++)w(D[Y],C,g,T,P)}function A(E){E.target.removeEventListener("dispose",A);for(let g in c){let T=c[g],P=E.target.uuid;P in T&&(T[P].dispose(),delete T[P])}}}function Ub(t,e){function n(){let L=!1,ae=new wt,J=null,_e=new wt(0,0,0,0);return{setMask:function(le){J!==le&&!L&&(t.colorMask(le,le,le,le),J=le)},setLocked:function(le){L=le},setClear:function(le,Q,Ee,Oe,Ct){Ct===!0&&(le*=Oe,Q*=Oe,Ee*=Oe),ae.set(le,Q,Ee,Oe),_e.equals(ae)===!1&&(t.clearColor(le,Q,Ee,Oe),_e.copy(ae))},reset:function(){L=!1,J=null,_e.set(-1,0,0,0)}}}function i(){let L=!1,ae=!1,J=null,_e=null,le=null;return{setReversed:function(Q){if(ae!==Q){let Ee=e.get("EXT_clip_control");Q?Ee.clipControlEXT(Ee.LOWER_LEFT_EXT,Ee.ZERO_TO_ONE_EXT):Ee.clipControlEXT(Ee.LOWER_LEFT_EXT,Ee.NEGATIVE_ONE_TO_ONE_EXT),ae=Q;let Oe=le;le=null,this.setClear(Oe)}},getReversed:function(){return ae},setTest:function(Q){Q?ne(t.DEPTH_TEST):we(t.DEPTH_TEST)},setMask:function(Q){J!==Q&&!L&&(t.depthMask(Q),J=Q)},setFunc:function(Q){if(ae&&(Q=lx[Q]),_e!==Q){switch(Q){case qc:t.depthFunc(t.NEVER);break;case Yc:t.depthFunc(t.ALWAYS);break;case Zc:t.depthFunc(t.LESS);break;case hs:t.depthFunc(t.LEQUAL);break;case $c:t.depthFunc(t.EQUAL);break;case Jc:t.depthFunc(t.GEQUAL);break;case Kc:t.depthFunc(t.GREATER);break;case jc:t.depthFunc(t.NOTEQUAL);break;default:t.depthFunc(t.LEQUAL)}_e=Q}},setLocked:function(Q){L=Q},setClear:function(Q){le!==Q&&(le=Q,ae&&(Q=1-Q),t.clearDepth(Q))},reset:function(){L=!1,J=null,_e=null,le=null,ae=!1}}}function r(){let L=!1,ae=null,J=null,_e=null,le=null,Q=null,Ee=null,Oe=null,Ct=null;return{setTest:function(st){L||(st?ne(t.STENCIL_TEST):we(t.STENCIL_TEST))},setMask:function(st){ae!==st&&!L&&(t.stencilMask(st),ae=st)},setFunc:function(st,Li,ui){(J!==st||_e!==Li||le!==ui)&&(t.stencilFunc(st,Li,ui),J=st,_e=Li,le=ui)},setOp:function(st,Li,ui){(Q!==st||Ee!==Li||Oe!==ui)&&(t.stencilOp(st,Li,ui),Q=st,Ee=Li,Oe=ui)},setLocked:function(st){L=st},setClear:function(st){Ct!==st&&(t.clearStencil(st),Ct=st)},reset:function(){L=!1,ae=null,J=null,_e=null,le=null,Q=null,Ee=null,Oe=null,Ct=null}}}let s=new n,o=new i,a=new r,l=new WeakMap,c=new WeakMap,f={},d={},h={},p=new WeakMap,v=[],S=null,_=!1,u=null,m=null,x=null,w=null,A=null,E=null,C=null,g=new qe(0,0,0),T=0,P=!1,R=null,D=null,Y=null,H=null,O=null,z=t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS),X=!1,ee=0,te=t.getParameter(t.VERSION);te.indexOf("WebGL")!==-1?(ee=parseFloat(/^WebGL (\d)/.exec(te)[1]),X=ee>=1):te.indexOf("OpenGL ES")!==-1&&(ee=parseFloat(/^OpenGL ES (\d)/.exec(te)[1]),X=ee>=2);let ue=null,ce={},Se=t.getParameter(t.SCISSOR_BOX),Ye=t.getParameter(t.VIEWPORT),Qe=new wt().fromArray(Se),Ie=new wt().fromArray(Ye);function K(L,ae,J,_e){let le=new Uint8Array(4),Q=t.createTexture();t.bindTexture(L,Q),t.texParameteri(L,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(L,t.TEXTURE_MAG_FILTER,t.NEAREST);for(let Ee=0;Ee<J;Ee++)L===t.TEXTURE_3D||L===t.TEXTURE_2D_ARRAY?t.texImage3D(ae,0,t.RGBA,1,1,_e,0,t.RGBA,t.UNSIGNED_BYTE,le):t.texImage2D(ae+Ee,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,le);return Q}let fe={};fe[t.TEXTURE_2D]=K(t.TEXTURE_2D,t.TEXTURE_2D,1),fe[t.TEXTURE_CUBE_MAP]=K(t.TEXTURE_CUBE_MAP,t.TEXTURE_CUBE_MAP_POSITIVE_X,6),fe[t.TEXTURE_2D_ARRAY]=K(t.TEXTURE_2D_ARRAY,t.TEXTURE_2D_ARRAY,1,1),fe[t.TEXTURE_3D]=K(t.TEXTURE_3D,t.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),ne(t.DEPTH_TEST),o.setFunc(hs),Et(!1),at(Tp),ne(t.CULL_FACE),it(Ai);function ne(L){f[L]!==!0&&(t.enable(L),f[L]=!0)}function we(L){f[L]!==!1&&(t.disable(L),f[L]=!1)}function Ne(L,ae){return h[L]!==ae?(t.bindFramebuffer(L,ae),h[L]=ae,L===t.DRAW_FRAMEBUFFER&&(h[t.FRAMEBUFFER]=ae),L===t.FRAMEBUFFER&&(h[t.DRAW_FRAMEBUFFER]=ae),!0):!1}function Ce(L,ae){let J=v,_e=!1;if(L){J=p.get(ae),J===void 0&&(J=[],p.set(ae,J));let le=L.textures;if(J.length!==le.length||J[0]!==t.COLOR_ATTACHMENT0){for(let Q=0,Ee=le.length;Q<Ee;Q++)J[Q]=t.COLOR_ATTACHMENT0+Q;J.length=le.length,_e=!0}}else J[0]!==t.BACK&&(J[0]=t.BACK,_e=!0);_e&&t.drawBuffers(J)}function dt(L){return S!==L?(t.useProgram(L),S=L,!0):!1}let ke={[Ir]:t.FUNC_ADD,[Iv]:t.FUNC_SUBTRACT,[Lv]:t.FUNC_REVERSE_SUBTRACT};ke[Nv]=t.MIN,ke[Dv]=t.MAX;let je={[Uv]:t.ZERO,[Fv]:t.ONE,[Ov]:t.SRC_COLOR,[Wc]:t.SRC_ALPHA,[Hv]:t.SRC_ALPHA_SATURATE,[Vv]:t.DST_COLOR,[kv]:t.DST_ALPHA,[Bv]:t.ONE_MINUS_SRC_COLOR,[Xc]:t.ONE_MINUS_SRC_ALPHA,[Gv]:t.ONE_MINUS_DST_COLOR,[zv]:t.ONE_MINUS_DST_ALPHA,[Wv]:t.CONSTANT_COLOR,[Xv]:t.ONE_MINUS_CONSTANT_COLOR,[qv]:t.CONSTANT_ALPHA,[Yv]:t.ONE_MINUS_CONSTANT_ALPHA};function it(L,ae,J,_e,le,Q,Ee,Oe,Ct,st){if(L===Ai){_===!0&&(we(t.BLEND),_=!1);return}if(_===!1&&(ne(t.BLEND),_=!0),L!==Pv){if(L!==u||st!==P){if((m!==Ir||A!==Ir)&&(t.blendEquation(t.FUNC_ADD),m=Ir,A=Ir),st)switch(L){case us:t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case bp:t.blendFunc(t.ONE,t.ONE);break;case Ap:t.blendFuncSeparate(t.ZERO,t.ONE_MINUS_SRC_COLOR,t.ZERO,t.ONE);break;case Cp:t.blendFuncSeparate(t.DST_COLOR,t.ONE_MINUS_SRC_ALPHA,t.ZERO,t.ONE);break;default:Pe("WebGLState: Invalid blending: ",L);break}else switch(L){case us:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case bp:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE,t.ONE,t.ONE);break;case Ap:Pe("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Cp:Pe("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Pe("WebGLState: Invalid blending: ",L);break}x=null,w=null,E=null,C=null,g.set(0,0,0),T=0,u=L,P=st}return}le=le||ae,Q=Q||J,Ee=Ee||_e,(ae!==m||le!==A)&&(t.blendEquationSeparate(ke[ae],ke[le]),m=ae,A=le),(J!==x||_e!==w||Q!==E||Ee!==C)&&(t.blendFuncSeparate(je[J],je[_e],je[Q],je[Ee]),x=J,w=_e,E=Q,C=Ee),(Oe.equals(g)===!1||Ct!==T)&&(t.blendColor(Oe.r,Oe.g,Oe.b,Ct),g.copy(Oe),T=Ct),u=L,P=!1}function Ue(L,ae){L.side===Yn?we(t.CULL_FACE):ne(t.CULL_FACE);let J=L.side===fn;ae&&(J=!J),Et(J),L.blending===us&&L.transparent===!1?it(Ai):it(L.blending,L.blendEquation,L.blendSrc,L.blendDst,L.blendEquationAlpha,L.blendSrcAlpha,L.blendDstAlpha,L.blendColor,L.blendAlpha,L.premultipliedAlpha),o.setFunc(L.depthFunc),o.setTest(L.depthTest),o.setMask(L.depthWrite),s.setMask(L.colorWrite);let _e=L.stencilWrite;a.setTest(_e),_e&&(a.setMask(L.stencilWriteMask),a.setFunc(L.stencilFunc,L.stencilRef,L.stencilFuncMask),a.setOp(L.stencilFail,L.stencilZFail,L.stencilZPass)),N(L.polygonOffset,L.polygonOffsetFactor,L.polygonOffsetUnits),L.alphaToCoverage===!0?ne(t.SAMPLE_ALPHA_TO_COVERAGE):we(t.SAMPLE_ALPHA_TO_COVERAGE)}function Et(L){R!==L&&(L?t.frontFace(t.CW):t.frontFace(t.CCW),R=L)}function at(L){L!==Av?(ne(t.CULL_FACE),L!==D&&(L===Tp?t.cullFace(t.BACK):L===Cv?t.cullFace(t.FRONT):t.cullFace(t.FRONT_AND_BACK))):we(t.CULL_FACE),D=L}function Wt(L){L!==Y&&(X&&t.lineWidth(L),Y=L)}function N(L,ae,J){L?(ne(t.POLYGON_OFFSET_FILL),(H!==ae||O!==J)&&(H=ae,O=J,o.getReversed()&&(ae=-ae),t.polygonOffset(ae,J))):we(t.POLYGON_OFFSET_FILL)}function xt(L){L?ne(t.SCISSOR_TEST):we(t.SCISSOR_TEST)}function ze(L){L===void 0&&(L=t.TEXTURE0+z-1),ue!==L&&(t.activeTexture(L),ue=L)}function rt(L,ae,J){J===void 0&&(ue===null?J=t.TEXTURE0+z-1:J=ue);let _e=ce[J];_e===void 0&&(_e={type:void 0,texture:void 0},ce[J]=_e),(_e.type!==L||_e.texture!==ae)&&(ue!==J&&(t.activeTexture(J),ue=J),t.bindTexture(L,ae||fe[L]),_e.type=L,_e.texture=ae)}function he(){let L=ce[ue];L!==void 0&&L.type!==void 0&&(t.bindTexture(L.type,null),L.type=void 0,L.texture=void 0)}function _t(){try{t.compressedTexImage2D(...arguments)}catch(L){Pe("WebGLState:",L)}}function b(){try{t.compressedTexImage3D(...arguments)}catch(L){Pe("WebGLState:",L)}}function y(){try{t.texSubImage2D(...arguments)}catch(L){Pe("WebGLState:",L)}}function I(){try{t.texSubImage3D(...arguments)}catch(L){Pe("WebGLState:",L)}}function B(){try{t.compressedTexSubImage2D(...arguments)}catch(L){Pe("WebGLState:",L)}}function U(){try{t.compressedTexSubImage3D(...arguments)}catch(L){Pe("WebGLState:",L)}}function $(){try{t.texStorage2D(...arguments)}catch(L){Pe("WebGLState:",L)}}function j(){try{t.texStorage3D(...arguments)}catch(L){Pe("WebGLState:",L)}}function W(){try{t.texImage2D(...arguments)}catch(L){Pe("WebGLState:",L)}}function Z(){try{t.texImage3D(...arguments)}catch(L){Pe("WebGLState:",L)}}function re(L){return d[L]!==void 0?d[L]:t.getParameter(L)}function ge(L,ae){d[L]!==ae&&(t.pixelStorei(L,ae),d[L]=ae)}function oe(L){Qe.equals(L)===!1&&(t.scissor(L.x,L.y,L.z,L.w),Qe.copy(L))}function se(L){Ie.equals(L)===!1&&(t.viewport(L.x,L.y,L.z,L.w),Ie.copy(L))}function Le(L,ae){let J=c.get(ae);J===void 0&&(J=new WeakMap,c.set(ae,J));let _e=J.get(L);_e===void 0&&(_e=t.getUniformBlockIndex(ae,L.name),J.set(L,_e))}function Fe(L,ae){let _e=c.get(ae).get(L);l.get(ae)!==_e&&(t.uniformBlockBinding(ae,_e,L.__bindingPointIndex),l.set(ae,_e))}function He(){t.disable(t.BLEND),t.disable(t.CULL_FACE),t.disable(t.DEPTH_TEST),t.disable(t.POLYGON_OFFSET_FILL),t.disable(t.SCISSOR_TEST),t.disable(t.STENCIL_TEST),t.disable(t.SAMPLE_ALPHA_TO_COVERAGE),t.blendEquation(t.FUNC_ADD),t.blendFunc(t.ONE,t.ZERO),t.blendFuncSeparate(t.ONE,t.ZERO,t.ONE,t.ZERO),t.blendColor(0,0,0,0),t.colorMask(!0,!0,!0,!0),t.clearColor(0,0,0,0),t.depthMask(!0),t.depthFunc(t.LESS),o.setReversed(!1),t.clearDepth(1),t.stencilMask(4294967295),t.stencilFunc(t.ALWAYS,0,4294967295),t.stencilOp(t.KEEP,t.KEEP,t.KEEP),t.clearStencil(0),t.cullFace(t.BACK),t.frontFace(t.CCW),t.polygonOffset(0,0),t.activeTexture(t.TEXTURE0),t.bindFramebuffer(t.FRAMEBUFFER,null),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),t.bindFramebuffer(t.READ_FRAMEBUFFER,null),t.useProgram(null),t.lineWidth(1),t.scissor(0,0,t.canvas.width,t.canvas.height),t.viewport(0,0,t.canvas.width,t.canvas.height),t.pixelStorei(t.PACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.BROWSER_DEFAULT_WEBGL),t.pixelStorei(t.PACK_ROW_LENGTH,0),t.pixelStorei(t.PACK_SKIP_PIXELS,0),t.pixelStorei(t.PACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_ROW_LENGTH,0),t.pixelStorei(t.UNPACK_IMAGE_HEIGHT,0),t.pixelStorei(t.UNPACK_SKIP_PIXELS,0),t.pixelStorei(t.UNPACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_SKIP_IMAGES,0),f={},d={},ue=null,ce={},h={},p=new WeakMap,v=[],S=null,_=!1,u=null,m=null,x=null,w=null,A=null,E=null,C=null,g=new qe(0,0,0),T=0,P=!1,R=null,D=null,Y=null,H=null,O=null,Qe.set(0,0,t.canvas.width,t.canvas.height),Ie.set(0,0,t.canvas.width,t.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:ne,disable:we,bindFramebuffer:Ne,drawBuffers:Ce,useProgram:dt,setBlending:it,setMaterial:Ue,setFlipSided:Et,setCullFace:at,setLineWidth:Wt,setPolygonOffset:N,setScissorTest:xt,activeTexture:ze,bindTexture:rt,unbindTexture:he,compressedTexImage2D:_t,compressedTexImage3D:b,texImage2D:W,texImage3D:Z,pixelStorei:ge,getParameter:re,updateUBOMapping:Le,uniformBlockBinding:Fe,texStorage2D:$,texStorage3D:j,texSubImage2D:y,texSubImage3D:I,compressedTexSubImage2D:B,compressedTexSubImage3D:U,scissor:oe,viewport:se,reset:He}}function Fb(t,e,n,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Ke,f=new WeakMap,d=new Set,h,p=new WeakMap,v=!1;try{v=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function S(b,y){return v?new OffscreenCanvas(b,y):Sa("canvas")}function _(b,y,I){let B=1,U=_t(b);if((U.width>I||U.height>I)&&(B=I/Math.max(U.width,U.height)),B<1)if(typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&b instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&b instanceof ImageBitmap||typeof VideoFrame<"u"&&b instanceof VideoFrame){let $=Math.floor(B*U.width),j=Math.floor(B*U.height);h===void 0&&(h=S($,j));let W=y?S($,j):h;return W.width=$,W.height=j,W.getContext("2d").drawImage(b,0,0,$,j),Re("WebGLRenderer: Texture has been resized from ("+U.width+"x"+U.height+") to ("+$+"x"+j+")."),W}else return"data"in b&&Re("WebGLRenderer: Image in DataTexture is too big ("+U.width+"x"+U.height+")."),b;return b}function u(b){return b.generateMipmaps}function m(b){t.generateMipmap(b)}function x(b){return b.isWebGLCubeRenderTarget?t.TEXTURE_CUBE_MAP:b.isWebGL3DRenderTarget?t.TEXTURE_3D:b.isWebGLArrayRenderTarget||b.isCompressedArrayTexture?t.TEXTURE_2D_ARRAY:t.TEXTURE_2D}function w(b,y,I,B,U,$=!1){if(b!==null){if(t[b]!==void 0)return t[b];Re("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+b+"'")}let j;B&&(j=e.get("EXT_texture_norm16"),j||Re("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let W=y;if(y===t.RED&&(I===t.FLOAT&&(W=t.R32F),I===t.HALF_FLOAT&&(W=t.R16F),I===t.UNSIGNED_BYTE&&(W=t.R8),I===t.UNSIGNED_SHORT&&j&&(W=j.R16_EXT),I===t.SHORT&&j&&(W=j.R16_SNORM_EXT)),y===t.RED_INTEGER&&(I===t.UNSIGNED_BYTE&&(W=t.R8UI),I===t.UNSIGNED_SHORT&&(W=t.R16UI),I===t.UNSIGNED_INT&&(W=t.R32UI),I===t.BYTE&&(W=t.R8I),I===t.SHORT&&(W=t.R16I),I===t.INT&&(W=t.R32I)),y===t.RG&&(I===t.FLOAT&&(W=t.RG32F),I===t.HALF_FLOAT&&(W=t.RG16F),I===t.UNSIGNED_BYTE&&(W=t.RG8),I===t.UNSIGNED_SHORT&&j&&(W=j.RG16_EXT),I===t.SHORT&&j&&(W=j.RG16_SNORM_EXT)),y===t.RG_INTEGER&&(I===t.UNSIGNED_BYTE&&(W=t.RG8UI),I===t.UNSIGNED_SHORT&&(W=t.RG16UI),I===t.UNSIGNED_INT&&(W=t.RG32UI),I===t.BYTE&&(W=t.RG8I),I===t.SHORT&&(W=t.RG16I),I===t.INT&&(W=t.RG32I)),y===t.RGB_INTEGER&&(I===t.UNSIGNED_BYTE&&(W=t.RGB8UI),I===t.UNSIGNED_SHORT&&(W=t.RGB16UI),I===t.UNSIGNED_INT&&(W=t.RGB32UI),I===t.BYTE&&(W=t.RGB8I),I===t.SHORT&&(W=t.RGB16I),I===t.INT&&(W=t.RGB32I)),y===t.RGBA_INTEGER&&(I===t.UNSIGNED_BYTE&&(W=t.RGBA8UI),I===t.UNSIGNED_SHORT&&(W=t.RGBA16UI),I===t.UNSIGNED_INT&&(W=t.RGBA32UI),I===t.BYTE&&(W=t.RGBA8I),I===t.SHORT&&(W=t.RGBA16I),I===t.INT&&(W=t.RGBA32I)),y===t.RGB&&(I===t.UNSIGNED_SHORT&&j&&(W=j.RGB16_EXT),I===t.SHORT&&j&&(W=j.RGB16_SNORM_EXT),I===t.UNSIGNED_INT_5_9_9_9_REV&&(W=t.RGB9_E5),I===t.UNSIGNED_INT_10F_11F_11F_REV&&(W=t.R11F_G11F_B10F)),y===t.RGBA){let Z=$?ya:Xe.getTransfer(U);I===t.FLOAT&&(W=t.RGBA32F),I===t.HALF_FLOAT&&(W=t.RGBA16F),I===t.UNSIGNED_BYTE&&(W=Z===et?t.SRGB8_ALPHA8:t.RGBA8),I===t.UNSIGNED_SHORT&&j&&(W=j.RGBA16_EXT),I===t.SHORT&&j&&(W=j.RGBA16_SNORM_EXT),I===t.UNSIGNED_SHORT_4_4_4_4&&(W=t.RGBA4),I===t.UNSIGNED_SHORT_5_5_5_1&&(W=t.RGB5_A1)}return(W===t.R16F||W===t.R32F||W===t.RG16F||W===t.RG32F||W===t.RGBA16F||W===t.RGBA32F)&&e.get("EXT_color_buffer_float"),W}function A(b,y){let I;return b?y===null||y===li||y===go?I=t.DEPTH24_STENCIL8:y===ci?I=t.DEPTH32F_STENCIL8:y===mo&&(I=t.DEPTH24_STENCIL8,Re("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):y===null||y===li||y===go?I=t.DEPTH_COMPONENT24:y===ci?I=t.DEPTH_COMPONENT32F:y===mo&&(I=t.DEPTH_COMPONENT16),I}function E(b,y){return u(b)===!0||b.isFramebufferTexture&&b.minFilter!==Ht&&b.minFilter!==Zt?Math.log2(Math.max(y.width,y.height))+1:b.mipmaps!==void 0&&b.mipmaps.length>0?b.mipmaps.length:b.isCompressedTexture&&Array.isArray(b.image)?y.mipmaps.length:1}function C(b){let y=b.target;y.removeEventListener("dispose",C),T(y),y.isVideoTexture&&f.delete(y),y.isHTMLTexture&&d.delete(y)}function g(b){let y=b.target;y.removeEventListener("dispose",g),R(y)}function T(b){let y=i.get(b);if(y.__webglInit===void 0)return;let I=b.source,B=p.get(I);if(B){let U=B[y.__cacheKey];U.usedTimes--,U.usedTimes===0&&P(b),Object.keys(B).length===0&&p.delete(I)}i.remove(b)}function P(b){let y=i.get(b);t.deleteTexture(y.__webglTexture);let I=b.source,B=p.get(I);delete B[y.__cacheKey],o.memory.textures--}function R(b){let y=i.get(b);if(b.depthTexture&&(b.depthTexture.dispose(),i.remove(b.depthTexture)),b.isWebGLCubeRenderTarget)for(let B=0;B<6;B++){if(Array.isArray(y.__webglFramebuffer[B]))for(let U=0;U<y.__webglFramebuffer[B].length;U++)t.deleteFramebuffer(y.__webglFramebuffer[B][U]);else t.deleteFramebuffer(y.__webglFramebuffer[B]);y.__webglDepthbuffer&&t.deleteRenderbuffer(y.__webglDepthbuffer[B])}else{if(Array.isArray(y.__webglFramebuffer))for(let B=0;B<y.__webglFramebuffer.length;B++)t.deleteFramebuffer(y.__webglFramebuffer[B]);else t.deleteFramebuffer(y.__webglFramebuffer);if(y.__webglDepthbuffer&&t.deleteRenderbuffer(y.__webglDepthbuffer),y.__webglMultisampledFramebuffer&&t.deleteFramebuffer(y.__webglMultisampledFramebuffer),y.__webglColorRenderbuffer)for(let B=0;B<y.__webglColorRenderbuffer.length;B++)y.__webglColorRenderbuffer[B]&&t.deleteRenderbuffer(y.__webglColorRenderbuffer[B]);y.__webglDepthRenderbuffer&&t.deleteRenderbuffer(y.__webglDepthRenderbuffer)}let I=b.textures;for(let B=0,U=I.length;B<U;B++){let $=i.get(I[B]);$.__webglTexture&&(t.deleteTexture($.__webglTexture),o.memory.textures--),i.remove(I[B])}i.remove(b)}let D=0;function Y(){D=0}function H(){return D}function O(b){D=b}function z(){let b=D;return b>=r.maxTextures&&Re("WebGLTextures: Trying to use "+b+" texture units while this GPU supports only "+r.maxTextures),D+=1,b}function X(b){let y=[];return y.push(b.wrapS),y.push(b.wrapT),y.push(b.wrapR||0),y.push(b.magFilter),y.push(b.minFilter),y.push(b.anisotropy),y.push(b.internalFormat),y.push(b.format),y.push(b.type),y.push(b.generateMipmaps),y.push(b.premultiplyAlpha),y.push(b.flipY),y.push(b.unpackAlignment),y.push(b.colorSpace),y.join()}function ee(b,y){let I=i.get(b);if(b.isVideoTexture&&rt(b),b.isRenderTargetTexture===!1&&b.isExternalTexture!==!0&&b.version>0&&I.__version!==b.version){let B=b.image;if(B===null)Re("WebGLRenderer: Texture marked for update but no image data found.");else if(B.complete===!1)Re("WebGLRenderer: Texture marked for update but image is incomplete");else{we(I,b,y);return}}else b.isExternalTexture&&(I.__webglTexture=b.sourceTexture?b.sourceTexture:null);n.bindTexture(t.TEXTURE_2D,I.__webglTexture,t.TEXTURE0+y)}function te(b,y){let I=i.get(b);if(b.isRenderTargetTexture===!1&&b.version>0&&I.__version!==b.version){we(I,b,y);return}else b.isExternalTexture&&(I.__webglTexture=b.sourceTexture?b.sourceTexture:null);n.bindTexture(t.TEXTURE_2D_ARRAY,I.__webglTexture,t.TEXTURE0+y)}function ue(b,y){let I=i.get(b);if(b.isRenderTargetTexture===!1&&b.version>0&&I.__version!==b.version){we(I,b,y);return}n.bindTexture(t.TEXTURE_3D,I.__webglTexture,t.TEXTURE0+y)}function ce(b,y){let I=i.get(b);if(b.isCubeDepthTexture!==!0&&b.version>0&&I.__version!==b.version){Ne(I,b,y);return}n.bindTexture(t.TEXTURE_CUBE_MAP,I.__webglTexture,t.TEXTURE0+y)}let Se={[Qc]:t.REPEAT,[yi]:t.CLAMP_TO_EDGE,[eu]:t.MIRRORED_REPEAT},Ye={[Ht]:t.NEAREST,[Jv]:t.NEAREST_MIPMAP_NEAREST,[za]:t.NEAREST_MIPMAP_LINEAR,[Zt]:t.LINEAR,[Ru]:t.LINEAR_MIPMAP_NEAREST,[kr]:t.LINEAR_MIPMAP_LINEAR},Qe={[Qv]:t.NEVER,[rx]:t.ALWAYS,[ex]:t.LESS,[dh]:t.LEQUAL,[tx]:t.EQUAL,[ph]:t.GEQUAL,[nx]:t.GREATER,[ix]:t.NOTEQUAL};function Ie(b,y){if(y.type===ci&&e.has("OES_texture_float_linear")===!1&&(y.magFilter===Zt||y.magFilter===Ru||y.magFilter===za||y.magFilter===kr||y.minFilter===Zt||y.minFilter===Ru||y.minFilter===za||y.minFilter===kr)&&Re("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),t.texParameteri(b,t.TEXTURE_WRAP_S,Se[y.wrapS]),t.texParameteri(b,t.TEXTURE_WRAP_T,Se[y.wrapT]),(b===t.TEXTURE_3D||b===t.TEXTURE_2D_ARRAY)&&t.texParameteri(b,t.TEXTURE_WRAP_R,Se[y.wrapR]),t.texParameteri(b,t.TEXTURE_MAG_FILTER,Ye[y.magFilter]),t.texParameteri(b,t.TEXTURE_MIN_FILTER,Ye[y.minFilter]),y.compareFunction&&(t.texParameteri(b,t.TEXTURE_COMPARE_MODE,t.COMPARE_REF_TO_TEXTURE),t.texParameteri(b,t.TEXTURE_COMPARE_FUNC,Qe[y.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(y.magFilter===Ht||y.minFilter!==za&&y.minFilter!==kr||y.type===ci&&e.has("OES_texture_float_linear")===!1)return;if(y.anisotropy>1||i.get(y).__currentAnisotropy){let I=e.get("EXT_texture_filter_anisotropic");t.texParameterf(b,I.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(y.anisotropy,r.getMaxAnisotropy())),i.get(y).__currentAnisotropy=y.anisotropy}}}function K(b,y){let I=!1;b.__webglInit===void 0&&(b.__webglInit=!0,y.addEventListener("dispose",C));let B=y.source,U=p.get(B);U===void 0&&(U={},p.set(B,U));let $=X(y);if($!==b.__cacheKey){U[$]===void 0&&(U[$]={texture:t.createTexture(),usedTimes:0},o.memory.textures++,I=!0),U[$].usedTimes++;let j=U[b.__cacheKey];j!==void 0&&(U[b.__cacheKey].usedTimes--,j.usedTimes===0&&P(y)),b.__cacheKey=$,b.__webglTexture=U[$].texture}return I}function fe(b,y,I){return Math.floor(Math.floor(b/I)/y)}function ne(b,y,I,B){let $=b.updateRanges;if($.length===0)n.texSubImage2D(t.TEXTURE_2D,0,0,0,y.width,y.height,I,B,y.data);else{$.sort((ge,oe)=>ge.start-oe.start);let j=0;for(let ge=1;ge<$.length;ge++){let oe=$[j],se=$[ge],Le=oe.start+oe.count,Fe=fe(se.start,y.width,4),He=fe(oe.start,y.width,4);se.start<=Le+1&&Fe===He&&fe(se.start+se.count-1,y.width,4)===Fe?oe.count=Math.max(oe.count,se.start+se.count-oe.start):(++j,$[j]=se)}$.length=j+1;let W=n.getParameter(t.UNPACK_ROW_LENGTH),Z=n.getParameter(t.UNPACK_SKIP_PIXELS),re=n.getParameter(t.UNPACK_SKIP_ROWS);n.pixelStorei(t.UNPACK_ROW_LENGTH,y.width);for(let ge=0,oe=$.length;ge<oe;ge++){let se=$[ge],Le=Math.floor(se.start/4),Fe=Math.ceil(se.count/4),He=Le%y.width,L=Math.floor(Le/y.width),ae=Fe,J=1;n.pixelStorei(t.UNPACK_SKIP_PIXELS,He),n.pixelStorei(t.UNPACK_SKIP_ROWS,L),n.texSubImage2D(t.TEXTURE_2D,0,He,L,ae,J,I,B,y.data)}b.clearUpdateRanges(),n.pixelStorei(t.UNPACK_ROW_LENGTH,W),n.pixelStorei(t.UNPACK_SKIP_PIXELS,Z),n.pixelStorei(t.UNPACK_SKIP_ROWS,re)}}function we(b,y,I){let B=t.TEXTURE_2D;(y.isDataArrayTexture||y.isCompressedArrayTexture)&&(B=t.TEXTURE_2D_ARRAY),y.isData3DTexture&&(B=t.TEXTURE_3D);let U=K(b,y),$=y.source;n.bindTexture(B,b.__webglTexture,t.TEXTURE0+I);let j=i.get($);if($.version!==j.__version||U===!0){if(n.activeTexture(t.TEXTURE0+I),(typeof ImageBitmap<"u"&&y.image instanceof ImageBitmap)===!1){let J=Xe.getPrimaries(Xe.workingColorSpace),_e=y.colorSpace===Qi?null:Xe.getPrimaries(y.colorSpace),le=y.colorSpace===Qi||J===_e?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,y.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,le)}n.pixelStorei(t.UNPACK_ALIGNMENT,y.unpackAlignment);let Z=_(y.image,!1,r.maxTextureSize);Z=he(y,Z);let re=s.convert(y.format,y.colorSpace),ge=s.convert(y.type),oe=w(y.internalFormat,re,ge,y.normalized,y.colorSpace,y.isVideoTexture);Ie(B,y);let se,Le=y.mipmaps,Fe=y.isVideoTexture!==!0,He=j.__version===void 0||U===!0,L=$.dataReady,ae=E(y,Z);if(y.isDepthTexture)oe=A(y.format===zr,y.type),He&&(Fe?n.texStorage2D(t.TEXTURE_2D,1,oe,Z.width,Z.height):n.texImage2D(t.TEXTURE_2D,0,oe,Z.width,Z.height,0,re,ge,null));else if(y.isDataTexture)if(Le.length>0){Fe&&He&&n.texStorage2D(t.TEXTURE_2D,ae,oe,Le[0].width,Le[0].height);for(let J=0,_e=Le.length;J<_e;J++)se=Le[J],Fe?L&&n.texSubImage2D(t.TEXTURE_2D,J,0,0,se.width,se.height,re,ge,se.data):n.texImage2D(t.TEXTURE_2D,J,oe,se.width,se.height,0,re,ge,se.data);y.generateMipmaps=!1}else Fe?(He&&n.texStorage2D(t.TEXTURE_2D,ae,oe,Z.width,Z.height),L&&ne(y,Z,re,ge)):n.texImage2D(t.TEXTURE_2D,0,oe,Z.width,Z.height,0,re,ge,Z.data);else if(y.isCompressedTexture)if(y.isCompressedArrayTexture){Fe&&He&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ae,oe,Le[0].width,Le[0].height,Z.depth);for(let J=0,_e=Le.length;J<_e;J++)if(se=Le[J],y.format!==Zn)if(re!==null)if(Fe){if(L)if(y.layerUpdates.size>0){let le=$p(se.width,se.height,y.format,y.type);for(let Q of y.layerUpdates){let Ee=se.data.subarray(Q*le/se.data.BYTES_PER_ELEMENT,(Q+1)*le/se.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,J,0,0,Q,se.width,se.height,1,re,Ee)}y.clearLayerUpdates()}else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,J,0,0,0,se.width,se.height,Z.depth,re,se.data)}else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY,J,oe,se.width,se.height,Z.depth,0,se.data,0,0);else Re("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Fe?L&&n.texSubImage3D(t.TEXTURE_2D_ARRAY,J,0,0,0,se.width,se.height,Z.depth,re,ge,se.data):n.texImage3D(t.TEXTURE_2D_ARRAY,J,oe,se.width,se.height,Z.depth,0,re,ge,se.data)}else{Fe&&He&&n.texStorage2D(t.TEXTURE_2D,ae,oe,Le[0].width,Le[0].height);for(let J=0,_e=Le.length;J<_e;J++)se=Le[J],y.format!==Zn?re!==null?Fe?L&&n.compressedTexSubImage2D(t.TEXTURE_2D,J,0,0,se.width,se.height,re,se.data):n.compressedTexImage2D(t.TEXTURE_2D,J,oe,se.width,se.height,0,se.data):Re("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Fe?L&&n.texSubImage2D(t.TEXTURE_2D,J,0,0,se.width,se.height,re,ge,se.data):n.texImage2D(t.TEXTURE_2D,J,oe,se.width,se.height,0,re,ge,se.data)}else if(y.isDataArrayTexture)if(Fe){if(He&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ae,oe,Z.width,Z.height,Z.depth),L)if(y.layerUpdates.size>0){let J=$p(Z.width,Z.height,y.format,y.type);for(let _e of y.layerUpdates){let le=Z.data.subarray(_e*J/Z.data.BYTES_PER_ELEMENT,(_e+1)*J/Z.data.BYTES_PER_ELEMENT);n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,_e,Z.width,Z.height,1,re,ge,le)}y.clearLayerUpdates()}else n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,0,Z.width,Z.height,Z.depth,re,ge,Z.data)}else n.texImage3D(t.TEXTURE_2D_ARRAY,0,oe,Z.width,Z.height,Z.depth,0,re,ge,Z.data);else if(y.isData3DTexture)Fe?(He&&n.texStorage3D(t.TEXTURE_3D,ae,oe,Z.width,Z.height,Z.depth),L&&n.texSubImage3D(t.TEXTURE_3D,0,0,0,0,Z.width,Z.height,Z.depth,re,ge,Z.data)):n.texImage3D(t.TEXTURE_3D,0,oe,Z.width,Z.height,Z.depth,0,re,ge,Z.data);else if(y.isFramebufferTexture){if(He)if(Fe)n.texStorage2D(t.TEXTURE_2D,ae,oe,Z.width,Z.height);else{let J=Z.width,_e=Z.height;for(let le=0;le<ae;le++)n.texImage2D(t.TEXTURE_2D,le,oe,J,_e,0,re,ge,null),J>>=1,_e>>=1}}else if(y.isHTMLTexture){if("texElementImage2D"in t){let J=t.canvas;if(J.hasAttribute("layoutsubtree")||J.setAttribute("layoutsubtree","true"),Z.parentNode!==J){J.appendChild(Z),d.add(y),J.onpaint=Oe=>{let Ct=Oe.changedElements;for(let st of d)Ct.includes(st.image)&&(st.needsUpdate=!0)},J.requestPaint();return}let _e=0,le=t.RGBA,Q=t.RGBA,Ee=t.UNSIGNED_BYTE;t.texElementImage2D(t.TEXTURE_2D,_e,le,Q,Ee,Z),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE)}}else if(Le.length>0){if(Fe&&He){let J=_t(Le[0]);n.texStorage2D(t.TEXTURE_2D,ae,oe,J.width,J.height)}for(let J=0,_e=Le.length;J<_e;J++)se=Le[J],Fe?L&&n.texSubImage2D(t.TEXTURE_2D,J,0,0,re,ge,se):n.texImage2D(t.TEXTURE_2D,J,oe,re,ge,se);y.generateMipmaps=!1}else if(Fe){if(He){let J=_t(Z);n.texStorage2D(t.TEXTURE_2D,ae,oe,J.width,J.height)}L&&n.texSubImage2D(t.TEXTURE_2D,0,0,0,re,ge,Z)}else n.texImage2D(t.TEXTURE_2D,0,oe,re,ge,Z);u(y)&&m(B),j.__version=$.version,y.onUpdate&&y.onUpdate(y)}b.__version=y.version}function Ne(b,y,I){if(y.image.length!==6)return;let B=K(b,y),U=y.source;n.bindTexture(t.TEXTURE_CUBE_MAP,b.__webglTexture,t.TEXTURE0+I);let $=i.get(U);if(U.version!==$.__version||B===!0){n.activeTexture(t.TEXTURE0+I);let j=Xe.getPrimaries(Xe.workingColorSpace),W=y.colorSpace===Qi?null:Xe.getPrimaries(y.colorSpace),Z=y.colorSpace===Qi||j===W?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,y.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),n.pixelStorei(t.UNPACK_ALIGNMENT,y.unpackAlignment),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,Z);let re=y.isCompressedTexture||y.image[0].isCompressedTexture,ge=y.image[0]&&y.image[0].isDataTexture,oe=[];for(let Q=0;Q<6;Q++)!re&&!ge?oe[Q]=_(y.image[Q],!0,r.maxCubemapSize):oe[Q]=ge?y.image[Q].image:y.image[Q],oe[Q]=he(y,oe[Q]);let se=oe[0],Le=s.convert(y.format,y.colorSpace),Fe=s.convert(y.type),He=w(y.internalFormat,Le,Fe,y.normalized,y.colorSpace),L=y.isVideoTexture!==!0,ae=$.__version===void 0||B===!0,J=U.dataReady,_e=E(y,se);Ie(t.TEXTURE_CUBE_MAP,y);let le;if(re){L&&ae&&n.texStorage2D(t.TEXTURE_CUBE_MAP,_e,He,se.width,se.height);for(let Q=0;Q<6;Q++){le=oe[Q].mipmaps;for(let Ee=0;Ee<le.length;Ee++){let Oe=le[Ee];y.format!==Zn?Le!==null?L?J&&n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ee,0,0,Oe.width,Oe.height,Le,Oe.data):n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ee,He,Oe.width,Oe.height,0,Oe.data):Re("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ee,0,0,Oe.width,Oe.height,Le,Fe,Oe.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ee,He,Oe.width,Oe.height,0,Le,Fe,Oe.data)}}}else{if(le=y.mipmaps,L&&ae){le.length>0&&_e++;let Q=_t(oe[0]);n.texStorage2D(t.TEXTURE_CUBE_MAP,_e,He,Q.width,Q.height)}for(let Q=0;Q<6;Q++)if(ge){L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,oe[Q].width,oe[Q].height,Le,Fe,oe[Q].data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,He,oe[Q].width,oe[Q].height,0,Le,Fe,oe[Q].data);for(let Ee=0;Ee<le.length;Ee++){let Ct=le[Ee].image[Q].image;L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ee+1,0,0,Ct.width,Ct.height,Le,Fe,Ct.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ee+1,He,Ct.width,Ct.height,0,Le,Fe,Ct.data)}}else{L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,0,0,Le,Fe,oe[Q]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0,He,Le,Fe,oe[Q]);for(let Ee=0;Ee<le.length;Ee++){let Oe=le[Ee];L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ee+1,0,0,Le,Fe,Oe.image[Q]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ee+1,He,Le,Fe,Oe.image[Q])}}}u(y)&&m(t.TEXTURE_CUBE_MAP),$.__version=U.version,y.onUpdate&&y.onUpdate(y)}b.__version=y.version}function Ce(b,y,I,B,U,$){let j=s.convert(I.format,I.colorSpace),W=s.convert(I.type),Z=w(I.internalFormat,j,W,I.normalized,I.colorSpace),re=i.get(y),ge=i.get(I);if(ge.__renderTarget=y,!re.__hasExternalTextures){let oe=Math.max(1,y.width>>$),se=Math.max(1,y.height>>$);U===t.TEXTURE_3D||U===t.TEXTURE_2D_ARRAY?n.texImage3D(U,$,Z,oe,se,y.depth,0,j,W,null):n.texImage2D(U,$,Z,oe,se,0,j,W,null)}n.bindFramebuffer(t.FRAMEBUFFER,b),ze(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,B,U,ge.__webglTexture,0,xt(y)):(U===t.TEXTURE_2D||U>=t.TEXTURE_CUBE_MAP_POSITIVE_X&&U<=t.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&t.framebufferTexture2D(t.FRAMEBUFFER,B,U,ge.__webglTexture,$),n.bindFramebuffer(t.FRAMEBUFFER,null)}function dt(b,y,I){if(t.bindRenderbuffer(t.RENDERBUFFER,b),y.depthBuffer){let B=y.depthTexture,U=B&&B.isDepthTexture?B.type:null,$=A(y.stencilBuffer,U),j=y.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;ze(y)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,xt(y),$,y.width,y.height):I?t.renderbufferStorageMultisample(t.RENDERBUFFER,xt(y),$,y.width,y.height):t.renderbufferStorage(t.RENDERBUFFER,$,y.width,y.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,j,t.RENDERBUFFER,b)}else{let B=y.textures;for(let U=0;U<B.length;U++){let $=B[U],j=s.convert($.format,$.colorSpace),W=s.convert($.type),Z=w($.internalFormat,j,W,$.normalized,$.colorSpace);ze(y)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,xt(y),Z,y.width,y.height):I?t.renderbufferStorageMultisample(t.RENDERBUFFER,xt(y),Z,y.width,y.height):t.renderbufferStorage(t.RENDERBUFFER,Z,y.width,y.height)}}t.bindRenderbuffer(t.RENDERBUFFER,null)}function ke(b,y,I){let B=y.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(t.FRAMEBUFFER,b),!(y.depthTexture&&y.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let U=i.get(y.depthTexture);if(U.__renderTarget=y,(!U.__webglTexture||y.depthTexture.image.width!==y.width||y.depthTexture.image.height!==y.height)&&(y.depthTexture.image.width=y.width,y.depthTexture.image.height=y.height,y.depthTexture.needsUpdate=!0),B){if(U.__webglInit===void 0&&(U.__webglInit=!0,y.depthTexture.addEventListener("dispose",C)),U.__webglTexture===void 0){U.__webglTexture=t.createTexture(),n.bindTexture(t.TEXTURE_CUBE_MAP,U.__webglTexture),Ie(t.TEXTURE_CUBE_MAP,y.depthTexture);let re=s.convert(y.depthTexture.format),ge=s.convert(y.depthTexture.type),oe;y.depthTexture.format===Si?oe=t.DEPTH_COMPONENT24:y.depthTexture.format===zr&&(oe=t.DEPTH24_STENCIL8);for(let se=0;se<6;se++)t.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+se,0,oe,y.width,y.height,0,re,ge,null)}}else ee(y.depthTexture,0);let $=U.__webglTexture,j=xt(y),W=B?t.TEXTURE_CUBE_MAP_POSITIVE_X+I:t.TEXTURE_2D,Z=y.depthTexture.format===zr?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;if(y.depthTexture.format===Si)ze(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,Z,W,$,0,j):t.framebufferTexture2D(t.FRAMEBUFFER,Z,W,$,0);else if(y.depthTexture.format===zr)ze(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,Z,W,$,0,j):t.framebufferTexture2D(t.FRAMEBUFFER,Z,W,$,0);else throw new Error("Unknown depthTexture format")}function je(b){let y=i.get(b),I=b.isWebGLCubeRenderTarget===!0;if(y.__boundDepthTexture!==b.depthTexture){let B=b.depthTexture;if(y.__depthDisposeCallback&&y.__depthDisposeCallback(),B){let U=()=>{delete y.__boundDepthTexture,delete y.__depthDisposeCallback,B.removeEventListener("dispose",U)};B.addEventListener("dispose",U),y.__depthDisposeCallback=U}y.__boundDepthTexture=B}if(b.depthTexture&&!y.__autoAllocateDepthBuffer)if(I)for(let B=0;B<6;B++)ke(y.__webglFramebuffer[B],b,B);else{let B=b.texture.mipmaps;B&&B.length>0?ke(y.__webglFramebuffer[0],b,0):ke(y.__webglFramebuffer,b,0)}else if(I){y.__webglDepthbuffer=[];for(let B=0;B<6;B++)if(n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer[B]),y.__webglDepthbuffer[B]===void 0)y.__webglDepthbuffer[B]=t.createRenderbuffer(),dt(y.__webglDepthbuffer[B],b,!1);else{let U=b.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,$=y.__webglDepthbuffer[B];t.bindRenderbuffer(t.RENDERBUFFER,$),t.framebufferRenderbuffer(t.FRAMEBUFFER,U,t.RENDERBUFFER,$)}}else{let B=b.texture.mipmaps;if(B&&B.length>0?n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer[0]):n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer),y.__webglDepthbuffer===void 0)y.__webglDepthbuffer=t.createRenderbuffer(),dt(y.__webglDepthbuffer,b,!1);else{let U=b.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,$=y.__webglDepthbuffer;t.bindRenderbuffer(t.RENDERBUFFER,$),t.framebufferRenderbuffer(t.FRAMEBUFFER,U,t.RENDERBUFFER,$)}}n.bindFramebuffer(t.FRAMEBUFFER,null)}function it(b,y,I){let B=i.get(b);y!==void 0&&Ce(B.__webglFramebuffer,b,b.texture,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,0),I!==void 0&&je(b)}function Ue(b){let y=b.texture,I=i.get(b),B=i.get(y);b.addEventListener("dispose",g);let U=b.textures,$=b.isWebGLCubeRenderTarget===!0,j=U.length>1;if(j||(B.__webglTexture===void 0&&(B.__webglTexture=t.createTexture()),B.__version=y.version,o.memory.textures++),$){I.__webglFramebuffer=[];for(let W=0;W<6;W++)if(y.mipmaps&&y.mipmaps.length>0){I.__webglFramebuffer[W]=[];for(let Z=0;Z<y.mipmaps.length;Z++)I.__webglFramebuffer[W][Z]=t.createFramebuffer()}else I.__webglFramebuffer[W]=t.createFramebuffer()}else{if(y.mipmaps&&y.mipmaps.length>0){I.__webglFramebuffer=[];for(let W=0;W<y.mipmaps.length;W++)I.__webglFramebuffer[W]=t.createFramebuffer()}else I.__webglFramebuffer=t.createFramebuffer();if(j)for(let W=0,Z=U.length;W<Z;W++){let re=i.get(U[W]);re.__webglTexture===void 0&&(re.__webglTexture=t.createTexture(),o.memory.textures++)}if(b.samples>0&&ze(b)===!1){I.__webglMultisampledFramebuffer=t.createFramebuffer(),I.__webglColorRenderbuffer=[],n.bindFramebuffer(t.FRAMEBUFFER,I.__webglMultisampledFramebuffer);for(let W=0;W<U.length;W++){let Z=U[W];I.__webglColorRenderbuffer[W]=t.createRenderbuffer(),t.bindRenderbuffer(t.RENDERBUFFER,I.__webglColorRenderbuffer[W]);let re=s.convert(Z.format,Z.colorSpace),ge=s.convert(Z.type),oe=w(Z.internalFormat,re,ge,Z.normalized,Z.colorSpace,b.isXRRenderTarget===!0),se=xt(b);t.renderbufferStorageMultisample(t.RENDERBUFFER,se,oe,b.width,b.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+W,t.RENDERBUFFER,I.__webglColorRenderbuffer[W])}t.bindRenderbuffer(t.RENDERBUFFER,null),b.depthBuffer&&(I.__webglDepthRenderbuffer=t.createRenderbuffer(),dt(I.__webglDepthRenderbuffer,b,!0)),n.bindFramebuffer(t.FRAMEBUFFER,null)}}if($){n.bindTexture(t.TEXTURE_CUBE_MAP,B.__webglTexture),Ie(t.TEXTURE_CUBE_MAP,y);for(let W=0;W<6;W++)if(y.mipmaps&&y.mipmaps.length>0)for(let Z=0;Z<y.mipmaps.length;Z++)Ce(I.__webglFramebuffer[W][Z],b,y,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+W,Z);else Ce(I.__webglFramebuffer[W],b,y,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+W,0);u(y)&&m(t.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(j){for(let W=0,Z=U.length;W<Z;W++){let re=U[W],ge=i.get(re),oe=t.TEXTURE_2D;(b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(oe=b.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(oe,ge.__webglTexture),Ie(oe,re),Ce(I.__webglFramebuffer,b,re,t.COLOR_ATTACHMENT0+W,oe,0),u(re)&&m(oe)}n.unbindTexture()}else{let W=t.TEXTURE_2D;if((b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(W=b.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(W,B.__webglTexture),Ie(W,y),y.mipmaps&&y.mipmaps.length>0)for(let Z=0;Z<y.mipmaps.length;Z++)Ce(I.__webglFramebuffer[Z],b,y,t.COLOR_ATTACHMENT0,W,Z);else Ce(I.__webglFramebuffer,b,y,t.COLOR_ATTACHMENT0,W,0);u(y)&&m(W),n.unbindTexture()}b.depthBuffer&&je(b)}function Et(b){let y=b.textures;for(let I=0,B=y.length;I<B;I++){let U=y[I];if(u(U)){let $=x(b),j=i.get(U).__webglTexture;n.bindTexture($,j),m($),n.unbindTexture()}}}let at=[],Wt=[];function N(b){if(b.samples>0){if(ze(b)===!1){let y=b.textures,I=b.width,B=b.height,U=t.COLOR_BUFFER_BIT,$=b.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,j=i.get(b),W=y.length>1;if(W)for(let re=0;re<y.length;re++)n.bindFramebuffer(t.FRAMEBUFFER,j.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+re,t.RENDERBUFFER,null),n.bindFramebuffer(t.FRAMEBUFFER,j.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+re,t.TEXTURE_2D,null,0);n.bindFramebuffer(t.READ_FRAMEBUFFER,j.__webglMultisampledFramebuffer);let Z=b.texture.mipmaps;Z&&Z.length>0?n.bindFramebuffer(t.DRAW_FRAMEBUFFER,j.__webglFramebuffer[0]):n.bindFramebuffer(t.DRAW_FRAMEBUFFER,j.__webglFramebuffer);for(let re=0;re<y.length;re++){if(b.resolveDepthBuffer&&(b.depthBuffer&&(U|=t.DEPTH_BUFFER_BIT),b.stencilBuffer&&b.resolveStencilBuffer&&(U|=t.STENCIL_BUFFER_BIT)),W){t.framebufferRenderbuffer(t.READ_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.RENDERBUFFER,j.__webglColorRenderbuffer[re]);let ge=i.get(y[re]).__webglTexture;t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,ge,0)}t.blitFramebuffer(0,0,I,B,0,0,I,B,U,t.NEAREST),l===!0&&(at.length=0,Wt.length=0,at.push(t.COLOR_ATTACHMENT0+re),b.depthBuffer&&b.resolveDepthBuffer===!1&&(at.push($),Wt.push($),t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,Wt)),t.invalidateFramebuffer(t.READ_FRAMEBUFFER,at))}if(n.bindFramebuffer(t.READ_FRAMEBUFFER,null),n.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),W)for(let re=0;re<y.length;re++){n.bindFramebuffer(t.FRAMEBUFFER,j.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+re,t.RENDERBUFFER,j.__webglColorRenderbuffer[re]);let ge=i.get(y[re]).__webglTexture;n.bindFramebuffer(t.FRAMEBUFFER,j.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+re,t.TEXTURE_2D,ge,0)}n.bindFramebuffer(t.DRAW_FRAMEBUFFER,j.__webglMultisampledFramebuffer)}else if(b.depthBuffer&&b.resolveDepthBuffer===!1&&l){let y=b.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,[y])}}}function xt(b){return Math.min(r.maxSamples,b.samples)}function ze(b){let y=i.get(b);return b.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&y.__useRenderToTexture!==!1}function rt(b){let y=o.render.frame;f.get(b)!==y&&(f.set(b,y),b.update())}function he(b,y){let I=b.colorSpace,B=b.format,U=b.type;return b.isCompressedTexture===!0||b.isVideoTexture===!0||I!==xa&&I!==Qi&&(Xe.getTransfer(I)===et?(B!==Zn||U!==Sn)&&Re("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Pe("WebGLTextures: Unsupported texture color space:",I)),y}function _t(b){return typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement?(c.width=b.naturalWidth||b.width,c.height=b.naturalHeight||b.height):typeof VideoFrame<"u"&&b instanceof VideoFrame?(c.width=b.displayWidth,c.height=b.displayHeight):(c.width=b.width,c.height=b.height),c}this.allocateTextureUnit=z,this.resetTextureUnits=Y,this.getTextureUnits=H,this.setTextureUnits=O,this.setTexture2D=ee,this.setTexture2DArray=te,this.setTexture3D=ue,this.setTextureCube=ce,this.rebindTextures=it,this.setupRenderTarget=Ue,this.updateRenderTargetMipmap=Et,this.updateMultisampleRenderTarget=N,this.setupDepthRenderbuffer=je,this.setupFrameBufferTexture=Ce,this.useMultisampledRTT=ze,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function Ob(t,e){function n(i,r=Qi){let s,o=Xe.getTransfer(r);if(i===Sn)return t.UNSIGNED_BYTE;if(i===Iu)return t.UNSIGNED_SHORT_4_4_4_4;if(i===Lu)return t.UNSIGNED_SHORT_5_5_5_1;if(i===kp)return t.UNSIGNED_INT_5_9_9_9_REV;if(i===zp)return t.UNSIGNED_INT_10F_11F_11F_REV;if(i===Op)return t.BYTE;if(i===Bp)return t.SHORT;if(i===mo)return t.UNSIGNED_SHORT;if(i===Pu)return t.INT;if(i===li)return t.UNSIGNED_INT;if(i===ci)return t.FLOAT;if(i===Ci)return t.HALF_FLOAT;if(i===Vp)return t.ALPHA;if(i===Gp)return t.RGB;if(i===Zn)return t.RGBA;if(i===Si)return t.DEPTH_COMPONENT;if(i===zr)return t.DEPTH_STENCIL;if(i===Hp)return t.RED;if(i===Nu)return t.RED_INTEGER;if(i===Vr)return t.RG;if(i===Du)return t.RG_INTEGER;if(i===Uu)return t.RGBA_INTEGER;if(i===Va||i===Ga||i===Ha||i===Wa)if(o===et)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===Va)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===Ga)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===Ha)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===Wa)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===Va)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===Ga)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===Ha)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===Wa)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Fu||i===Ou||i===Bu||i===ku)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===Fu)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Ou)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===Bu)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===ku)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===zu||i===Vu||i===Gu||i===Hu||i===Wu||i===Xa||i===Xu)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===zu||i===Vu)return o===et?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===Gu)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===Hu)return s.COMPRESSED_R11_EAC;if(i===Wu)return s.COMPRESSED_SIGNED_R11_EAC;if(i===Xa)return s.COMPRESSED_RG11_EAC;if(i===Xu)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===qu||i===Yu||i===Zu||i===$u||i===Ju||i===Ku||i===ju||i===Qu||i===eh||i===th||i===nh||i===ih||i===rh||i===sh)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===qu)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===Yu)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Zu)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===$u)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Ju)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===Ku)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===ju)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Qu)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===eh)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===th)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===nh)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===ih)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===rh)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===sh)return o===et?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===oh||i===ah||i===lh)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===oh)return o===et?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===ah)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===lh)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===ch||i===uh||i===qa||i===hh)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===ch)return s.COMPRESSED_RED_RGTC1_EXT;if(i===uh)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===qa)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===hh)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===go?t.UNSIGNED_INT_24_8:t[i]!==void 0?t[i]:null}return{convert:n}}var Bb=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,kb=`
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

}`,pm=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,n){if(this.texture===null){let i=new Pa(e.texture);(e.depthNear!==n.depthNear||e.depthFar!==n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let n=e.cameras[0].viewport,i=new Dn({vertexShader:Bb,fragmentShader:kb,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new yn(new bi(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},mm=class extends Mi{constructor(e,n){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,c=null,f=null,d=null,h=null,p=null,v=null,S=typeof XRWebGLBinding<"u",_=new pm,u={},m=n.getContextAttributes(),x=null,w=null,A=[],E=[],C=new Ke,g=null,T=new rn;T.viewport=new wt;let P=new rn;P.viewport=new wt;let R=[T,P],D=new Eu,Y=null,H=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(K){let fe=A[K];return fe===void 0&&(fe=new co,A[K]=fe),fe.getTargetRaySpace()},this.getControllerGrip=function(K){let fe=A[K];return fe===void 0&&(fe=new co,A[K]=fe),fe.getGripSpace()},this.getHand=function(K){let fe=A[K];return fe===void 0&&(fe=new co,A[K]=fe),fe.getHandSpace()};function O(K){let fe=E.indexOf(K.inputSource);if(fe===-1)return;let ne=A[fe];ne!==void 0&&(ne.update(K.inputSource,K.frame,c||o),ne.dispatchEvent({type:K.type,data:K.inputSource}))}function z(){r.removeEventListener("select",O),r.removeEventListener("selectstart",O),r.removeEventListener("selectend",O),r.removeEventListener("squeeze",O),r.removeEventListener("squeezestart",O),r.removeEventListener("squeezeend",O),r.removeEventListener("end",z),r.removeEventListener("inputsourceschange",X);for(let K=0;K<A.length;K++){let fe=E[K];fe!==null&&(E[K]=null,A[K].disconnect(fe))}Y=null,H=null,_.reset();for(let K in u)delete u[K];e.setRenderTarget(x),p=null,h=null,d=null,r=null,w=null,Ie.stop(),i.isPresenting=!1,e.setPixelRatio(g),e.setSize(C.width,C.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(K){s=K,i.isPresenting===!0&&Re("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(K){a=K,i.isPresenting===!0&&Re("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(K){c=K},this.getBaseLayer=function(){return h!==null?h:p},this.getBinding=function(){return d===null&&S&&(d=new XRWebGLBinding(r,n)),d},this.getFrame=function(){return v},this.getSession=function(){return r},this.setSession=async function(K){if(r=K,r!==null){if(x=e.getRenderTarget(),r.addEventListener("select",O),r.addEventListener("selectstart",O),r.addEventListener("selectend",O),r.addEventListener("squeeze",O),r.addEventListener("squeezestart",O),r.addEventListener("squeezeend",O),r.addEventListener("end",z),r.addEventListener("inputsourceschange",X),m.xrCompatible!==!0&&await n.makeXRCompatible(),g=e.getPixelRatio(),e.getSize(C),S&&"createProjectionLayer"in XRWebGLBinding.prototype){let ne=null,we=null,Ne=null;m.depth&&(Ne=m.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,ne=m.stencil?zr:Si,we=m.stencil?go:li);let Ce={colorFormat:n.RGBA8,depthFormat:Ne,scaleFactor:s};d=this.getBinding(),h=d.createProjectionLayer(Ce),r.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),w=new Nn(h.textureWidth,h.textureHeight,{format:Zn,type:Sn,depthTexture:new ji(h.textureWidth,h.textureHeight,we,void 0,void 0,void 0,void 0,void 0,void 0,ne),stencilBuffer:m.stencil,colorSpace:e.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1})}else{let ne={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:s};p=new XRWebGLLayer(r,n,ne),r.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),w=new Nn(p.framebufferWidth,p.framebufferHeight,{format:Zn,type:Sn,colorSpace:e.outputColorSpace,stencilBuffer:m.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}w.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),Ie.setContext(r),Ie.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function X(K){for(let fe=0;fe<K.removed.length;fe++){let ne=K.removed[fe],we=E.indexOf(ne);we>=0&&(E[we]=null,A[we].disconnect(ne))}for(let fe=0;fe<K.added.length;fe++){let ne=K.added[fe],we=E.indexOf(ne);if(we===-1){for(let Ce=0;Ce<A.length;Ce++)if(Ce>=E.length){E.push(ne),we=Ce;break}else if(E[Ce]===null){E[Ce]=ne,we=Ce;break}if(we===-1)break}let Ne=A[we];Ne&&Ne.connect(ne)}}let ee=new k,te=new k;function ue(K,fe,ne){ee.setFromMatrixPosition(fe.matrixWorld),te.setFromMatrixPosition(ne.matrixWorld);let we=ee.distanceTo(te),Ne=fe.projectionMatrix.elements,Ce=ne.projectionMatrix.elements,dt=Ne[14]/(Ne[10]-1),ke=Ne[14]/(Ne[10]+1),je=(Ne[9]+1)/Ne[5],it=(Ne[9]-1)/Ne[5],Ue=(Ne[8]-1)/Ne[0],Et=(Ce[8]+1)/Ce[0],at=dt*Ue,Wt=dt*Et,N=we/(-Ue+Et),xt=N*-Ue;if(fe.matrixWorld.decompose(K.position,K.quaternion,K.scale),K.translateX(xt),K.translateZ(N),K.matrixWorld.compose(K.position,K.quaternion,K.scale),K.matrixWorldInverse.copy(K.matrixWorld).invert(),Ne[10]===-1)K.projectionMatrix.copy(fe.projectionMatrix),K.projectionMatrixInverse.copy(fe.projectionMatrixInverse);else{let ze=dt+N,rt=ke+N,he=at-xt,_t=Wt+(we-xt),b=je*ke/rt*ze,y=it*ke/rt*ze;K.projectionMatrix.makePerspective(he,_t,b,y,ze,rt),K.projectionMatrixInverse.copy(K.projectionMatrix).invert()}}function ce(K,fe){fe===null?K.matrixWorld.copy(K.matrix):K.matrixWorld.multiplyMatrices(fe.matrixWorld,K.matrix),K.matrixWorldInverse.copy(K.matrixWorld).invert()}this.updateCamera=function(K){if(r===null)return;let fe=K.near,ne=K.far;_.texture!==null&&(_.depthNear>0&&(fe=_.depthNear),_.depthFar>0&&(ne=_.depthFar)),D.near=P.near=T.near=fe,D.far=P.far=T.far=ne,(Y!==D.near||H!==D.far)&&(r.updateRenderState({depthNear:D.near,depthFar:D.far}),Y=D.near,H=D.far),D.layers.mask=K.layers.mask|6,T.layers.mask=D.layers.mask&-5,P.layers.mask=D.layers.mask&-3;let we=K.parent,Ne=D.cameras;ce(D,we);for(let Ce=0;Ce<Ne.length;Ce++)ce(Ne[Ce],we);Ne.length===2?ue(D,T,P):D.projectionMatrix.copy(T.projectionMatrix),Se(K,D,we)};function Se(K,fe,ne){ne===null?K.matrix.copy(fe.matrixWorld):(K.matrix.copy(ne.matrixWorld),K.matrix.invert(),K.matrix.multiply(fe.matrixWorld)),K.matrix.decompose(K.position,K.quaternion,K.scale),K.updateMatrixWorld(!0),K.projectionMatrix.copy(fe.projectionMatrix),K.projectionMatrixInverse.copy(fe.projectionMatrixInverse),K.isPerspectiveCamera&&(K.fov=iu*2*Math.atan(1/K.projectionMatrix.elements[5]),K.zoom=1)}this.getCamera=function(){return D},this.getFoveation=function(){if(!(h===null&&p===null))return l},this.setFoveation=function(K){l=K,h!==null&&(h.fixedFoveation=K),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=K)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(D)},this.getCameraTexture=function(K){return u[K]};let Ye=null;function Qe(K,fe){if(f=fe.getViewerPose(c||o),v=fe,f!==null){let ne=f.views;p!==null&&(e.setRenderTargetFramebuffer(w,p.framebuffer),e.setRenderTarget(w));let we=!1;ne.length!==D.cameras.length&&(D.cameras.length=0,we=!0);for(let ke=0;ke<ne.length;ke++){let je=ne[ke],it=null;if(p!==null)it=p.getViewport(je);else{let Et=d.getViewSubImage(h,je);it=Et.viewport,ke===0&&(e.setRenderTargetTextures(w,Et.colorTexture,Et.depthStencilTexture),e.setRenderTarget(w))}let Ue=R[ke];Ue===void 0&&(Ue=new rn,Ue.layers.enable(ke),Ue.viewport=new wt,R[ke]=Ue),Ue.matrix.fromArray(je.transform.matrix),Ue.matrix.decompose(Ue.position,Ue.quaternion,Ue.scale),Ue.projectionMatrix.fromArray(je.projectionMatrix),Ue.projectionMatrixInverse.copy(Ue.projectionMatrix).invert(),Ue.viewport.set(it.x,it.y,it.width,it.height),ke===0&&(D.matrix.copy(Ue.matrix),D.matrix.decompose(D.position,D.quaternion,D.scale)),we===!0&&D.cameras.push(Ue)}let Ne=r.enabledFeatures;if(Ne&&Ne.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&S){d=i.getBinding();let ke=d.getDepthInformation(ne[0]);ke&&ke.isValid&&ke.texture&&_.init(ke,r.renderState)}if(Ne&&Ne.includes("camera-access")&&S){e.state.unbindTexture(),d=i.getBinding();for(let ke=0;ke<ne.length;ke++){let je=ne[ke].camera;if(je){let it=u[je];it||(it=new Pa,u[je]=it);let Ue=d.getCameraImage(je);it.sourceTexture=Ue}}}}for(let ne=0;ne<A.length;ne++){let we=E[ne],Ne=A[ne];we!==null&&Ne!==void 0&&Ne.update(we,fe,c||o)}Ye&&Ye(K,fe),fe.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:fe}),v=null}let Ie=new Dx;Ie.setAnimationLoop(Qe),this.setAnimationLoop=function(K){Ye=K},this.dispose=function(){}}},zb=new At,zx=new De;zx.set(-1,0,0,0,1,0,0,0,1);function Vb(t,e){function n(_,u){_.matrixAutoUpdate===!0&&_.updateMatrix(),u.value.copy(_.matrix)}function i(_,u){u.color.getRGB(_.fogColor.value,qp(t)),u.isFog?(_.fogNear.value=u.near,_.fogFar.value=u.far):u.isFogExp2&&(_.fogDensity.value=u.density)}function r(_,u,m,x,w){u.isNodeMaterial?u.uniformsNeedUpdate=!1:u.isMeshBasicMaterial?s(_,u):u.isMeshLambertMaterial?(s(_,u),u.envMap&&(_.envMapIntensity.value=u.envMapIntensity)):u.isMeshToonMaterial?(s(_,u),d(_,u)):u.isMeshPhongMaterial?(s(_,u),f(_,u),u.envMap&&(_.envMapIntensity.value=u.envMapIntensity)):u.isMeshStandardMaterial?(s(_,u),h(_,u),u.isMeshPhysicalMaterial&&p(_,u,w)):u.isMeshMatcapMaterial?(s(_,u),v(_,u)):u.isMeshDepthMaterial?s(_,u):u.isMeshDistanceMaterial?(s(_,u),S(_,u)):u.isMeshNormalMaterial?s(_,u):u.isLineBasicMaterial?(o(_,u),u.isLineDashedMaterial&&a(_,u)):u.isPointsMaterial?l(_,u,m,x):u.isSpriteMaterial?c(_,u):u.isShadowMaterial?(_.color.value.copy(u.color),_.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function s(_,u){_.opacity.value=u.opacity,u.color&&_.diffuse.value.copy(u.color),u.emissive&&_.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(_.map.value=u.map,n(u.map,_.mapTransform)),u.alphaMap&&(_.alphaMap.value=u.alphaMap,n(u.alphaMap,_.alphaMapTransform)),u.bumpMap&&(_.bumpMap.value=u.bumpMap,n(u.bumpMap,_.bumpMapTransform),_.bumpScale.value=u.bumpScale,u.side===fn&&(_.bumpScale.value*=-1)),u.normalMap&&(_.normalMap.value=u.normalMap,n(u.normalMap,_.normalMapTransform),_.normalScale.value.copy(u.normalScale),u.side===fn&&_.normalScale.value.negate()),u.displacementMap&&(_.displacementMap.value=u.displacementMap,n(u.displacementMap,_.displacementMapTransform),_.displacementScale.value=u.displacementScale,_.displacementBias.value=u.displacementBias),u.emissiveMap&&(_.emissiveMap.value=u.emissiveMap,n(u.emissiveMap,_.emissiveMapTransform)),u.specularMap&&(_.specularMap.value=u.specularMap,n(u.specularMap,_.specularMapTransform)),u.alphaTest>0&&(_.alphaTest.value=u.alphaTest);let m=e.get(u),x=m.envMap,w=m.envMapRotation;x&&(_.envMap.value=x,_.envMapRotation.value.setFromMatrix4(zb.makeRotationFromEuler(w)).transpose(),x.isCubeTexture&&x.isRenderTargetTexture===!1&&_.envMapRotation.value.premultiply(zx),_.reflectivity.value=u.reflectivity,_.ior.value=u.ior,_.refractionRatio.value=u.refractionRatio),u.lightMap&&(_.lightMap.value=u.lightMap,_.lightMapIntensity.value=u.lightMapIntensity,n(u.lightMap,_.lightMapTransform)),u.aoMap&&(_.aoMap.value=u.aoMap,_.aoMapIntensity.value=u.aoMapIntensity,n(u.aoMap,_.aoMapTransform))}function o(_,u){_.diffuse.value.copy(u.color),_.opacity.value=u.opacity,u.map&&(_.map.value=u.map,n(u.map,_.mapTransform))}function a(_,u){_.dashSize.value=u.dashSize,_.totalSize.value=u.dashSize+u.gapSize,_.scale.value=u.scale}function l(_,u,m,x){_.diffuse.value.copy(u.color),_.opacity.value=u.opacity,_.size.value=u.size*m,_.scale.value=x*.5,u.map&&(_.map.value=u.map,n(u.map,_.uvTransform)),u.alphaMap&&(_.alphaMap.value=u.alphaMap,n(u.alphaMap,_.alphaMapTransform)),u.alphaTest>0&&(_.alphaTest.value=u.alphaTest)}function c(_,u){_.diffuse.value.copy(u.color),_.opacity.value=u.opacity,_.rotation.value=u.rotation,u.map&&(_.map.value=u.map,n(u.map,_.mapTransform)),u.alphaMap&&(_.alphaMap.value=u.alphaMap,n(u.alphaMap,_.alphaMapTransform)),u.alphaTest>0&&(_.alphaTest.value=u.alphaTest)}function f(_,u){_.specular.value.copy(u.specular),_.shininess.value=Math.max(u.shininess,1e-4)}function d(_,u){u.gradientMap&&(_.gradientMap.value=u.gradientMap)}function h(_,u){_.metalness.value=u.metalness,u.metalnessMap&&(_.metalnessMap.value=u.metalnessMap,n(u.metalnessMap,_.metalnessMapTransform)),_.roughness.value=u.roughness,u.roughnessMap&&(_.roughnessMap.value=u.roughnessMap,n(u.roughnessMap,_.roughnessMapTransform)),u.envMap&&(_.envMapIntensity.value=u.envMapIntensity)}function p(_,u,m){_.ior.value=u.ior,u.sheen>0&&(_.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),_.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(_.sheenColorMap.value=u.sheenColorMap,n(u.sheenColorMap,_.sheenColorMapTransform)),u.sheenRoughnessMap&&(_.sheenRoughnessMap.value=u.sheenRoughnessMap,n(u.sheenRoughnessMap,_.sheenRoughnessMapTransform))),u.clearcoat>0&&(_.clearcoat.value=u.clearcoat,_.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(_.clearcoatMap.value=u.clearcoatMap,n(u.clearcoatMap,_.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(_.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,n(u.clearcoatRoughnessMap,_.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(_.clearcoatNormalMap.value=u.clearcoatNormalMap,n(u.clearcoatNormalMap,_.clearcoatNormalMapTransform),_.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===fn&&_.clearcoatNormalScale.value.negate())),u.dispersion>0&&(_.dispersion.value=u.dispersion),u.iridescence>0&&(_.iridescence.value=u.iridescence,_.iridescenceIOR.value=u.iridescenceIOR,_.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],_.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(_.iridescenceMap.value=u.iridescenceMap,n(u.iridescenceMap,_.iridescenceMapTransform)),u.iridescenceThicknessMap&&(_.iridescenceThicknessMap.value=u.iridescenceThicknessMap,n(u.iridescenceThicknessMap,_.iridescenceThicknessMapTransform))),u.transmission>0&&(_.transmission.value=u.transmission,_.transmissionSamplerMap.value=m.texture,_.transmissionSamplerSize.value.set(m.width,m.height),u.transmissionMap&&(_.transmissionMap.value=u.transmissionMap,n(u.transmissionMap,_.transmissionMapTransform)),_.thickness.value=u.thickness,u.thicknessMap&&(_.thicknessMap.value=u.thicknessMap,n(u.thicknessMap,_.thicknessMapTransform)),_.attenuationDistance.value=u.attenuationDistance,_.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(_.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(_.anisotropyMap.value=u.anisotropyMap,n(u.anisotropyMap,_.anisotropyMapTransform))),_.specularIntensity.value=u.specularIntensity,_.specularColor.value.copy(u.specularColor),u.specularColorMap&&(_.specularColorMap.value=u.specularColorMap,n(u.specularColorMap,_.specularColorMapTransform)),u.specularIntensityMap&&(_.specularIntensityMap.value=u.specularIntensityMap,n(u.specularIntensityMap,_.specularIntensityMapTransform))}function v(_,u){u.matcap&&(_.matcap.value=u.matcap)}function S(_,u){let m=e.get(u).light;_.referencePosition.value.setFromMatrixPosition(m.matrixWorld),_.nearDistance.value=m.shadow.camera.near,_.farDistance.value=m.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function Gb(t,e,n,i){let r={},s={},o=[],a=t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);function l(m,x){let w=x.program;i.uniformBlockBinding(m,w)}function c(m,x){let w=r[m.id];w===void 0&&(v(m),w=f(m),r[m.id]=w,m.addEventListener("dispose",_));let A=x.program;i.updateUBOMapping(m,A);let E=e.render.frame;s[m.id]!==E&&(h(m),s[m.id]=E)}function f(m){let x=d();m.__bindingPointIndex=x;let w=t.createBuffer(),A=m.__size,E=m.usage;return t.bindBuffer(t.UNIFORM_BUFFER,w),t.bufferData(t.UNIFORM_BUFFER,A,E),t.bindBuffer(t.UNIFORM_BUFFER,null),t.bindBufferBase(t.UNIFORM_BUFFER,x,w),w}function d(){for(let m=0;m<a;m++)if(o.indexOf(m)===-1)return o.push(m),m;return Pe("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(m){let x=r[m.id],w=m.uniforms,A=m.__cache;t.bindBuffer(t.UNIFORM_BUFFER,x);for(let E=0,C=w.length;E<C;E++){let g=Array.isArray(w[E])?w[E]:[w[E]];for(let T=0,P=g.length;T<P;T++){let R=g[T];if(p(R,E,T,A)===!0){let D=R.__offset,Y=Array.isArray(R.value)?R.value:[R.value],H=0;for(let O=0;O<Y.length;O++){let z=Y[O],X=S(z);typeof z=="number"||typeof z=="boolean"?(R.__data[0]=z,t.bufferSubData(t.UNIFORM_BUFFER,D+H,R.__data)):z.isMatrix3?(R.__data[0]=z.elements[0],R.__data[1]=z.elements[1],R.__data[2]=z.elements[2],R.__data[3]=0,R.__data[4]=z.elements[3],R.__data[5]=z.elements[4],R.__data[6]=z.elements[5],R.__data[7]=0,R.__data[8]=z.elements[6],R.__data[9]=z.elements[7],R.__data[10]=z.elements[8],R.__data[11]=0):ArrayBuffer.isView(z)?R.__data.set(new z.constructor(z.buffer,z.byteOffset,R.__data.length)):(z.toArray(R.__data,H),H+=X.storage/Float32Array.BYTES_PER_ELEMENT)}t.bufferSubData(t.UNIFORM_BUFFER,D,R.__data)}}}t.bindBuffer(t.UNIFORM_BUFFER,null)}function p(m,x,w,A){let E=m.value,C=x+"_"+w;if(A[C]===void 0)return typeof E=="number"||typeof E=="boolean"?A[C]=E:ArrayBuffer.isView(E)?A[C]=E.slice():A[C]=E.clone(),!0;{let g=A[C];if(typeof E=="number"||typeof E=="boolean"){if(g!==E)return A[C]=E,!0}else{if(ArrayBuffer.isView(E))return!0;if(g.equals(E)===!1)return g.copy(E),!0}}return!1}function v(m){let x=m.uniforms,w=0,A=16;for(let C=0,g=x.length;C<g;C++){let T=Array.isArray(x[C])?x[C]:[x[C]];for(let P=0,R=T.length;P<R;P++){let D=T[P],Y=Array.isArray(D.value)?D.value:[D.value];for(let H=0,O=Y.length;H<O;H++){let z=Y[H],X=S(z),ee=w%A,te=ee%X.boundary,ue=ee+te;w+=te,ue!==0&&A-ue<X.storage&&(w+=A-ue),D.__data=new Float32Array(X.storage/Float32Array.BYTES_PER_ELEMENT),D.__offset=w,w+=X.storage}}}let E=w%A;return E>0&&(w+=A-E),m.__size=w,m.__cache={},this}function S(m){let x={boundary:0,storage:0};return typeof m=="number"||typeof m=="boolean"?(x.boundary=4,x.storage=4):m.isVector2?(x.boundary=8,x.storage=8):m.isVector3||m.isColor?(x.boundary=16,x.storage=12):m.isVector4?(x.boundary=16,x.storage=16):m.isMatrix3?(x.boundary=48,x.storage=48):m.isMatrix4?(x.boundary=64,x.storage=64):m.isTexture?Re("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(m)?(x.boundary=16,x.storage=m.byteLength):Re("WebGLRenderer: Unsupported uniform value type.",m),x}function _(m){let x=m.target;x.removeEventListener("dispose",_);let w=o.indexOf(x.__bindingPointIndex);o.splice(w,1),t.deleteBuffer(r[x.id]),delete r[x.id],delete s[x.id]}function u(){for(let m in r)t.deleteBuffer(r[m]);o=[],r={},s={}}return{bind:l,update:c,dispose:u}}var Hb=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Ri=null;function Wb(){return Ri===null&&(Ri=new lu(Hb,16,16,Vr,Ci),Ri.name="DFG_LUT",Ri.minFilter=Zt,Ri.magFilter=Zt,Ri.wrapS=yi,Ri.wrapT=yi,Ri.generateMipmaps=!1,Ri.needsUpdate=!0),Ri}var xh=class{constructor(e={}){let{canvas:n=sx(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:f="default",failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:h=!1,outputBufferType:p=Sn}=e;this.isWebGLRenderer=!0;let v;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");v=i.getContextAttributes().alpha}else v=o;let S=p,_=new Set([Uu,Du,Nu]),u=new Set([Sn,li,mo,go,Iu,Lu]),m=new Uint32Array(4),x=new Int32Array(4),w=new k,A=null,E=null,C=[],g=[],T=null;this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=ai,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let P=this,R=!1,D=null;this._outputColorSpace=hn;let Y=0,H=0,O=null,z=-1,X=null,ee=new wt,te=new wt,ue=null,ce=new qe(0),Se=0,Ye=n.width,Qe=n.height,Ie=1,K=null,fe=null,ne=new wt(0,0,Ye,Qe),we=new wt(0,0,Ye,Qe),Ne=!1,Ce=new ho,dt=!1,ke=!1,je=new At,it=new k,Ue=new wt,Et={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},at=!1;function Wt(){return O===null?Ie:1}let N=i;function xt(M,F){return n.getContext(M,F)}try{let M={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:f,failIfMajorPerformanceCaveat:d};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${"184"}`),n.addEventListener("webglcontextlost",Q,!1),n.addEventListener("webglcontextrestored",Ee,!1),n.addEventListener("webglcontextcreationerror",Oe,!1),N===null){let F="webgl2";if(N=xt(F,M),N===null)throw xt(F)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(M){throw Pe("WebGLRenderer: "+M.message),M}let ze,rt,he,_t,b,y,I,B,U,$,j,W,Z,re,ge,oe,se,Le,Fe,He,L,ae,J;function _e(){ze=new KE(N),ze.init(),L=new Ob(N,ze),rt=new HE(N,ze,e,L),he=new Ub(N,ze),rt.reversedDepthBuffer&&h&&he.buffers.depth.setReversed(!0),_t=new eT(N),b=new Sb,y=new Fb(N,ze,he,b,rt,L,_t),I=new JE(P),B=new r1(N),ae=new VE(N,B),U=new jE(N,B,_t,ae),$=new nT(N,U,B,ae,_t),Le=new tT(N,rt,y),ge=new WE(b),j=new yb(P,I,ze,rt,ae,ge),W=new Vb(P,b),Z=new wb,re=new Rb(ze),se=new zE(P,I,he,$,v,l),oe=new Db(P,$,rt),J=new Gb(N,_t,rt,he),Fe=new GE(N,ze,_t),He=new QE(N,ze,_t),_t.programs=j.programs,P.capabilities=rt,P.extensions=ze,P.properties=b,P.renderLists=Z,P.shadowMap=oe,P.state=he,P.info=_t}_e(),S!==Sn&&(T=new rT(S,n.width,n.height,r,s));let le=new mm(P,N);this.xr=le,this.getContext=function(){return N},this.getContextAttributes=function(){return N.getContextAttributes()},this.forceContextLoss=function(){let M=ze.get("WEBGL_lose_context");M&&M.loseContext()},this.forceContextRestore=function(){let M=ze.get("WEBGL_lose_context");M&&M.restoreContext()},this.getPixelRatio=function(){return Ie},this.setPixelRatio=function(M){M!==void 0&&(Ie=M,this.setSize(Ye,Qe,!1))},this.getSize=function(M){return M.set(Ye,Qe)},this.setSize=function(M,F,q=!0){if(le.isPresenting){Re("WebGLRenderer: Can't change size while VR device is presenting.");return}Ye=M,Qe=F,n.width=Math.floor(M*Ie),n.height=Math.floor(F*Ie),q===!0&&(n.style.width=M+"px",n.style.height=F+"px"),T!==null&&T.setSize(n.width,n.height),this.setViewport(0,0,M,F)},this.getDrawingBufferSize=function(M){return M.set(Ye*Ie,Qe*Ie).floor()},this.setDrawingBufferSize=function(M,F,q){Ye=M,Qe=F,Ie=q,n.width=Math.floor(M*q),n.height=Math.floor(F*q),this.setViewport(0,0,M,F)},this.setEffects=function(M){if(S===Sn){Pe("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(M){for(let F=0;F<M.length;F++)if(M[F].isOutputPass===!0){Re("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}T.setEffects(M||[])},this.getCurrentViewport=function(M){return M.copy(ee)},this.getViewport=function(M){return M.copy(ne)},this.setViewport=function(M,F,q,V){M.isVector4?ne.set(M.x,M.y,M.z,M.w):ne.set(M,F,q,V),he.viewport(ee.copy(ne).multiplyScalar(Ie).round())},this.getScissor=function(M){return M.copy(we)},this.setScissor=function(M,F,q,V){M.isVector4?we.set(M.x,M.y,M.z,M.w):we.set(M,F,q,V),he.scissor(te.copy(we).multiplyScalar(Ie).round())},this.getScissorTest=function(){return Ne},this.setScissorTest=function(M){he.setScissorTest(Ne=M)},this.setOpaqueSort=function(M){K=M},this.setTransparentSort=function(M){fe=M},this.getClearColor=function(M){return M.copy(se.getClearColor())},this.setClearColor=function(){se.setClearColor(...arguments)},this.getClearAlpha=function(){return se.getClearAlpha()},this.setClearAlpha=function(){se.setClearAlpha(...arguments)},this.clear=function(M=!0,F=!0,q=!0){let V=0;if(M){let G=!1;if(O!==null){let me=O.texture.format;G=_.has(me)}if(G){let me=O.texture.type,xe=u.has(me),pe=se.getClearColor(),Me=se.getClearAlpha(),Te=pe.r,Be=pe.g,Ge=pe.b;xe?(m[0]=Te,m[1]=Be,m[2]=Ge,m[3]=Me,N.clearBufferuiv(N.COLOR,0,m)):(x[0]=Te,x[1]=Be,x[2]=Ge,x[3]=Me,N.clearBufferiv(N.COLOR,0,x))}else V|=N.COLOR_BUFFER_BIT}F&&(V|=N.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),q&&(V|=N.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),V!==0&&N.clear(V)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(M){M.setRenderer(this),D=M},this.dispose=function(){n.removeEventListener("webglcontextlost",Q,!1),n.removeEventListener("webglcontextrestored",Ee,!1),n.removeEventListener("webglcontextcreationerror",Oe,!1),se.dispose(),Z.dispose(),re.dispose(),b.dispose(),I.dispose(),$.dispose(),ae.dispose(),J.dispose(),j.dispose(),le.dispose(),le.removeEventListener("sessionstart",vm),le.removeEventListener("sessionend",xm),Hr.stop()};function Q(M){M.preventDefault(),Xp("WebGLRenderer: Context Lost."),R=!0}function Ee(){Xp("WebGLRenderer: Context Restored."),R=!1;let M=_t.autoReset,F=oe.enabled,q=oe.autoUpdate,V=oe.needsUpdate,G=oe.type;_e(),_t.autoReset=M,oe.enabled=F,oe.autoUpdate=q,oe.needsUpdate=V,oe.type=G}function Oe(M){Pe("WebGLRenderer: A WebGL context could not be created. Reason: ",M.statusMessage)}function Ct(M){let F=M.target;F.removeEventListener("dispose",Ct),st(F)}function st(M){Li(M),b.remove(M)}function Li(M){let F=b.get(M).programs;F!==void 0&&(F.forEach(function(q){j.releaseProgram(q)}),M.isShaderMaterial&&j.releaseShaderCache(M))}this.renderBufferDirect=function(M,F,q,V,G,me){F===null&&(F=Et);let xe=G.isMesh&&G.matrixWorld.determinant()<0,pe=$x(M,F,q,V,G);he.setMaterial(V,xe);let Me=q.index,Te=1;if(V.wireframe===!0){if(Me=U.getWireframeAttribute(q),Me===void 0)return;Te=2}let Be=q.drawRange,Ge=q.attributes.position,be=Be.start*Te,ot=(Be.start+Be.count)*Te;me!==null&&(be=Math.max(be,me.start*Te),ot=Math.min(ot,(me.start+me.count)*Te)),Me!==null?(be=Math.max(be,0),ot=Math.min(ot,Me.count)):Ge!=null&&(be=Math.max(be,0),ot=Math.min(ot,Ge.count));let Rt=ot-be;if(Rt<0||Rt===1/0)return;ae.setup(G,V,pe,q,Me);let Tt,lt=Fe;if(Me!==null&&(Tt=B.get(Me),lt=He,lt.setIndex(Tt)),G.isMesh)V.wireframe===!0?(he.setLineWidth(V.wireframeLinewidth*Wt()),lt.setMode(N.LINES)):lt.setMode(N.TRIANGLES);else if(G.isLine){let $t=V.linewidth;$t===void 0&&($t=1),he.setLineWidth($t*Wt()),G.isLineSegments?lt.setMode(N.LINES):G.isLineLoop?lt.setMode(N.LINE_LOOP):lt.setMode(N.LINE_STRIP)}else G.isPoints?lt.setMode(N.POINTS):G.isSprite&&lt.setMode(N.TRIANGLES);if(G.isBatchedMesh)if(ze.get("WEBGL_multi_draw"))lt.renderMultiDraw(G._multiDrawStarts,G._multiDrawCounts,G._multiDrawCount);else{let $t=G._multiDrawStarts,ve=G._multiDrawCounts,Mn=G._multiDrawCount,$e=Me?B.get(Me).bytesPerElement:1,On=b.get(V).currentProgram.getUniforms();for(let hi=0;hi<Mn;hi++)On.setValue(N,"_gl_DrawID",hi),lt.render($t[hi]/$e,ve[hi])}else if(G.isInstancedMesh)lt.renderInstances(be,Rt,G.count);else if(q.isInstancedBufferGeometry){let $t=q._maxInstanceCount!==void 0?q._maxInstanceCount:1/0,ve=Math.min(q.instanceCount,$t);lt.renderInstances(be,Rt,ve)}else lt.render(be,Rt)};function ui(M,F,q){M.transparent===!0&&M.side===Yn&&M.forceSinglePass===!1?(M.side=fn,M.needsUpdate=!0,ja(M,F,q),M.side=Ji,M.needsUpdate=!0,ja(M,F,q),M.side=Yn):ja(M,F,q)}this.compile=function(M,F,q=null){q===null&&(q=M),E=re.get(q),E.init(F),g.push(E),q.traverseVisible(function(G){G.isLight&&G.layers.test(F.layers)&&(E.pushLight(G),G.castShadow&&E.pushShadow(G))}),M!==q&&M.traverseVisible(function(G){G.isLight&&G.layers.test(F.layers)&&(E.pushLight(G),G.castShadow&&E.pushShadow(G))}),E.setupLights();let V=new Set;return M.traverse(function(G){if(!(G.isMesh||G.isPoints||G.isLine||G.isSprite))return;let me=G.material;if(me)if(Array.isArray(me))for(let xe=0;xe<me.length;xe++){let pe=me[xe];ui(pe,q,G),V.add(pe)}else ui(me,q,G),V.add(me)}),E=g.pop(),V},this.compileAsync=function(M,F,q=null){let V=this.compile(M,F,q);return new Promise(G=>{function me(){if(V.forEach(function(xe){b.get(xe).currentProgram.isReady()&&V.delete(xe)}),V.size===0){G(M);return}setTimeout(me,10)}ze.get("KHR_parallel_shader_compile")!==null?me():setTimeout(me,10)})};let wh=null;function Yx(M){wh&&wh(M)}function vm(){Hr.stop()}function xm(){Hr.start()}let Hr=new Dx;Hr.setAnimationLoop(Yx),typeof self<"u"&&Hr.setContext(self),this.setAnimationLoop=function(M){wh=M,le.setAnimationLoop(M),M===null?Hr.stop():Hr.start()},le.addEventListener("sessionstart",vm),le.addEventListener("sessionend",xm),this.render=function(M,F){if(F!==void 0&&F.isCamera!==!0){Pe("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(R===!0)return;D!==null&&D.renderStart(M,F);let q=le.enabled===!0&&le.isPresenting===!0,V=T!==null&&(O===null||q)&&T.begin(P,O);if(M.matrixWorldAutoUpdate===!0&&M.updateMatrixWorld(),F.parent===null&&F.matrixWorldAutoUpdate===!0&&F.updateMatrixWorld(),le.enabled===!0&&le.isPresenting===!0&&(T===null||T.isCompositing()===!1)&&(le.cameraAutoUpdate===!0&&le.updateCamera(F),F=le.getCamera()),M.isScene===!0&&M.onBeforeRender(P,M,F,O),E=re.get(M,g.length),E.init(F),E.state.textureUnits=y.getTextureUnits(),g.push(E),je.multiplyMatrices(F.projectionMatrix,F.matrixWorldInverse),Ce.setFromProjectionMatrix(je,oi,F.reversedDepth),ke=this.localClippingEnabled,dt=ge.init(this.clippingPlanes,ke),A=Z.get(M,C.length),A.init(),C.push(A),le.enabled===!0&&le.isPresenting===!0){let xe=P.xr.getDepthSensingMesh();xe!==null&&Eh(xe,F,-1/0,P.sortObjects)}Eh(M,F,0,P.sortObjects),A.finish(),P.sortObjects===!0&&A.sort(K,fe),at=le.enabled===!1||le.isPresenting===!1||le.hasDepthSensing()===!1,at&&se.addToRenderList(A,M),this.info.render.frame++,dt===!0&&ge.beginShadows();let G=E.state.shadowsArray;if(oe.render(G,M,F),dt===!0&&ge.endShadows(),this.info.autoReset===!0&&this.info.reset(),(V&&T.hasRenderPass())===!1){let xe=A.opaque,pe=A.transmissive;if(E.setupLights(),F.isArrayCamera){let Me=F.cameras;if(pe.length>0)for(let Te=0,Be=Me.length;Te<Be;Te++){let Ge=Me[Te];Sm(xe,pe,M,Ge)}at&&se.render(M);for(let Te=0,Be=Me.length;Te<Be;Te++){let Ge=Me[Te];ym(A,M,Ge,Ge.viewport)}}else pe.length>0&&Sm(xe,pe,M,F),at&&se.render(M),ym(A,M,F)}O!==null&&H===0&&(y.updateMultisampleRenderTarget(O),y.updateRenderTargetMipmap(O)),V&&T.end(P),M.isScene===!0&&M.onAfterRender(P,M,F),ae.resetDefaultState(),z=-1,X=null,g.pop(),g.length>0?(E=g[g.length-1],y.setTextureUnits(E.state.textureUnits),dt===!0&&ge.setGlobalState(P.clippingPlanes,E.state.camera)):E=null,C.pop(),C.length>0?A=C[C.length-1]:A=null,D!==null&&D.renderEnd()};function Eh(M,F,q,V){if(M.visible===!1)return;if(M.layers.test(F.layers)){if(M.isGroup)q=M.renderOrder;else if(M.isLOD)M.autoUpdate===!0&&M.update(F);else if(M.isLightProbeGrid)E.pushLightProbeGrid(M);else if(M.isLight)E.pushLight(M),M.castShadow&&E.pushShadow(M);else if(M.isSprite){if(!M.frustumCulled||Ce.intersectsSprite(M)){V&&Ue.setFromMatrixPosition(M.matrixWorld).applyMatrix4(je);let xe=$.update(M),pe=M.material;pe.visible&&A.push(M,xe,pe,q,Ue.z,null)}}else if((M.isMesh||M.isLine||M.isPoints)&&(!M.frustumCulled||Ce.intersectsObject(M))){let xe=$.update(M),pe=M.material;if(V&&(M.boundingSphere!==void 0?(M.boundingSphere===null&&M.computeBoundingSphere(),Ue.copy(M.boundingSphere.center)):(xe.boundingSphere===null&&xe.computeBoundingSphere(),Ue.copy(xe.boundingSphere.center)),Ue.applyMatrix4(M.matrixWorld).applyMatrix4(je)),Array.isArray(pe)){let Me=xe.groups;for(let Te=0,Be=Me.length;Te<Be;Te++){let Ge=Me[Te],be=pe[Ge.materialIndex];be&&be.visible&&A.push(M,xe,be,q,Ue.z,Ge)}}else pe.visible&&A.push(M,xe,pe,q,Ue.z,null)}}let me=M.children;for(let xe=0,pe=me.length;xe<pe;xe++)Eh(me[xe],F,q,V)}function ym(M,F,q,V){let{opaque:G,transmissive:me,transparent:xe}=M;E.setupLightsView(q),dt===!0&&ge.setGlobalState(P.clippingPlanes,q),V&&he.viewport(ee.copy(V)),G.length>0&&Ka(G,F,q),me.length>0&&Ka(me,F,q),xe.length>0&&Ka(xe,F,q),he.buffers.depth.setTest(!0),he.buffers.depth.setMask(!0),he.buffers.color.setMask(!0),he.setPolygonOffset(!1)}function Sm(M,F,q,V){if((q.isScene===!0?q.overrideMaterial:null)!==null)return;if(E.state.transmissionRenderTarget[V.id]===void 0){let be=ze.has("EXT_color_buffer_half_float")||ze.has("EXT_color_buffer_float");E.state.transmissionRenderTarget[V.id]=new Nn(1,1,{generateMipmaps:!0,type:be?Ci:Sn,minFilter:kr,samples:Math.max(4,rt.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Xe.workingColorSpace})}let me=E.state.transmissionRenderTarget[V.id],xe=V.viewport||ee;me.setSize(xe.z*P.transmissionResolutionScale,xe.w*P.transmissionResolutionScale);let pe=P.getRenderTarget(),Me=P.getActiveCubeFace(),Te=P.getActiveMipmapLevel();P.setRenderTarget(me),P.getClearColor(ce),Se=P.getClearAlpha(),Se<1&&P.setClearColor(16777215,.5),P.clear(),at&&se.render(q);let Be=P.toneMapping;P.toneMapping=ai;let Ge=V.viewport;if(V.viewport!==void 0&&(V.viewport=void 0),E.setupLightsView(V),dt===!0&&ge.setGlobalState(P.clippingPlanes,V),Ka(M,q,V),y.updateMultisampleRenderTarget(me),y.updateRenderTargetMipmap(me),ze.has("WEBGL_multisampled_render_to_texture")===!1){let be=!1;for(let ot=0,Rt=F.length;ot<Rt;ot++){let Tt=F[ot],{object:lt,geometry:$t,material:ve,group:Mn}=Tt;if(ve.side===Yn&&lt.layers.test(V.layers)){let $e=ve.side;ve.side=fn,ve.needsUpdate=!0,Mm(lt,q,V,$t,ve,Mn),ve.side=$e,ve.needsUpdate=!0,be=!0}}be===!0&&(y.updateMultisampleRenderTarget(me),y.updateRenderTargetMipmap(me))}P.setRenderTarget(pe,Me,Te),P.setClearColor(ce,Se),Ge!==void 0&&(V.viewport=Ge),P.toneMapping=Be}function Ka(M,F,q){let V=F.isScene===!0?F.overrideMaterial:null;for(let G=0,me=M.length;G<me;G++){let xe=M[G],{object:pe,geometry:Me,group:Te}=xe,Be=xe.material;Be.allowOverride===!0&&V!==null&&(Be=V),pe.layers.test(q.layers)&&Mm(pe,F,q,Me,Be,Te)}}function Mm(M,F,q,V,G,me){M.onBeforeRender(P,F,q,V,G,me),M.modelViewMatrix.multiplyMatrices(q.matrixWorldInverse,M.matrixWorld),M.normalMatrix.getNormalMatrix(M.modelViewMatrix),G.onBeforeRender(P,F,q,V,M,me),G.transparent===!0&&G.side===Yn&&G.forceSinglePass===!1?(G.side=fn,G.needsUpdate=!0,P.renderBufferDirect(q,F,V,G,M,me),G.side=Ji,G.needsUpdate=!0,P.renderBufferDirect(q,F,V,G,M,me),G.side=Yn):P.renderBufferDirect(q,F,V,G,M,me),M.onAfterRender(P,F,q,V,G,me)}function ja(M,F,q){F.isScene!==!0&&(F=Et);let V=b.get(M),G=E.state.lights,me=E.state.shadowsArray,xe=G.state.version,pe=j.getParameters(M,G.state,me,F,q,E.state.lightProbeGridArray),Me=j.getProgramCacheKey(pe),Te=V.programs;V.environment=M.isMeshStandardMaterial||M.isMeshLambertMaterial||M.isMeshPhongMaterial?F.environment:null,V.fog=F.fog;let Be=M.isMeshStandardMaterial||M.isMeshLambertMaterial&&!M.envMap||M.isMeshPhongMaterial&&!M.envMap;V.envMap=I.get(M.envMap||V.environment,Be),V.envMapRotation=V.environment!==null&&M.envMap===null?F.environmentRotation:M.envMapRotation,Te===void 0&&(M.addEventListener("dispose",Ct),Te=new Map,V.programs=Te);let Ge=Te.get(Me);if(Ge!==void 0){if(V.currentProgram===Ge&&V.lightsStateVersion===xe)return Em(M,pe),Ge}else pe.uniforms=j.getUniforms(M),D!==null&&M.isNodeMaterial&&D.build(M,q,pe),M.onBeforeCompile(pe,P),Ge=j.acquireProgram(pe,Me),Te.set(Me,Ge),V.uniforms=pe.uniforms;let be=V.uniforms;return(!M.isShaderMaterial&&!M.isRawShaderMaterial||M.clipping===!0)&&(be.clippingPlanes=ge.uniform),Em(M,pe),V.needsLights=Kx(M),V.lightsStateVersion=xe,V.needsLights&&(be.ambientLightColor.value=G.state.ambient,be.lightProbe.value=G.state.probe,be.directionalLights.value=G.state.directional,be.directionalLightShadows.value=G.state.directionalShadow,be.spotLights.value=G.state.spot,be.spotLightShadows.value=G.state.spotShadow,be.rectAreaLights.value=G.state.rectArea,be.ltc_1.value=G.state.rectAreaLTC1,be.ltc_2.value=G.state.rectAreaLTC2,be.pointLights.value=G.state.point,be.pointLightShadows.value=G.state.pointShadow,be.hemisphereLights.value=G.state.hemi,be.directionalShadowMatrix.value=G.state.directionalShadowMatrix,be.spotLightMatrix.value=G.state.spotLightMatrix,be.spotLightMap.value=G.state.spotLightMap,be.pointShadowMatrix.value=G.state.pointShadowMatrix),V.lightProbeGrid=E.state.lightProbeGridArray.length>0,V.currentProgram=Ge,V.uniformsList=null,Ge}function wm(M){if(M.uniformsList===null){let F=M.currentProgram.getUniforms();M.uniformsList=vo.seqWithValue(F.seq,M.uniforms)}return M.uniformsList}function Em(M,F){let q=b.get(M);q.outputColorSpace=F.outputColorSpace,q.batching=F.batching,q.batchingColor=F.batchingColor,q.instancing=F.instancing,q.instancingColor=F.instancingColor,q.instancingMorph=F.instancingMorph,q.skinning=F.skinning,q.morphTargets=F.morphTargets,q.morphNormals=F.morphNormals,q.morphColors=F.morphColors,q.morphTargetsCount=F.morphTargetsCount,q.numClippingPlanes=F.numClippingPlanes,q.numIntersection=F.numClipIntersection,q.vertexAlphas=F.vertexAlphas,q.vertexTangents=F.vertexTangents,q.toneMapping=F.toneMapping}function Zx(M,F){if(M.length===0)return null;if(M.length===1)return M[0].texture!==null?M[0]:null;w.setFromMatrixPosition(F.matrixWorld);for(let q=0,V=M.length;q<V;q++){let G=M[q];if(G.texture!==null&&G.boundingBox.containsPoint(w))return G}return null}function $x(M,F,q,V,G){F.isScene!==!0&&(F=Et),y.resetTextureUnits();let me=F.fog,xe=V.isMeshStandardMaterial||V.isMeshLambertMaterial||V.isMeshPhongMaterial?F.environment:null,pe=O===null?P.outputColorSpace:O.isXRRenderTarget===!0?O.texture.colorSpace:Xe.workingColorSpace,Me=V.isMeshStandardMaterial||V.isMeshLambertMaterial&&!V.envMap||V.isMeshPhongMaterial&&!V.envMap,Te=I.get(V.envMap||xe,Me),Be=V.vertexColors===!0&&!!q.attributes.color&&q.attributes.color.itemSize===4,Ge=!!q.attributes.tangent&&(!!V.normalMap||V.anisotropy>0),be=!!q.morphAttributes.position,ot=!!q.morphAttributes.normal,Rt=!!q.morphAttributes.color,Tt=ai;V.toneMapped&&(O===null||O.isXRRenderTarget===!0)&&(Tt=P.toneMapping);let lt=q.morphAttributes.position||q.morphAttributes.normal||q.morphAttributes.color,$t=lt!==void 0?lt.length:0,ve=b.get(V),Mn=E.state.lights;if(dt===!0&&(ke===!0||M!==X)){let ut=M===X&&V.id===z;ge.setState(V,M,ut)}let $e=!1;V.version===ve.__version?(ve.needsLights&&ve.lightsStateVersion!==Mn.state.version||ve.outputColorSpace!==pe||G.isBatchedMesh&&ve.batching===!1||!G.isBatchedMesh&&ve.batching===!0||G.isBatchedMesh&&ve.batchingColor===!0&&G.colorTexture===null||G.isBatchedMesh&&ve.batchingColor===!1&&G.colorTexture!==null||G.isInstancedMesh&&ve.instancing===!1||!G.isInstancedMesh&&ve.instancing===!0||G.isSkinnedMesh&&ve.skinning===!1||!G.isSkinnedMesh&&ve.skinning===!0||G.isInstancedMesh&&ve.instancingColor===!0&&G.instanceColor===null||G.isInstancedMesh&&ve.instancingColor===!1&&G.instanceColor!==null||G.isInstancedMesh&&ve.instancingMorph===!0&&G.morphTexture===null||G.isInstancedMesh&&ve.instancingMorph===!1&&G.morphTexture!==null||ve.envMap!==Te||V.fog===!0&&ve.fog!==me||ve.numClippingPlanes!==void 0&&(ve.numClippingPlanes!==ge.numPlanes||ve.numIntersection!==ge.numIntersection)||ve.vertexAlphas!==Be||ve.vertexTangents!==Ge||ve.morphTargets!==be||ve.morphNormals!==ot||ve.morphColors!==Rt||ve.toneMapping!==Tt||ve.morphTargetsCount!==$t||!!ve.lightProbeGrid!=E.state.lightProbeGridArray.length>0)&&($e=!0):($e=!0,ve.__version=V.version);let On=ve.currentProgram;$e===!0&&(On=ja(V,F,G),D&&V.isNodeMaterial&&D.onUpdateProgram(V,On,ve));let hi=!1,er=!1,ms=!1,ct=On.getUniforms(),Pt=ve.uniforms;if(he.useProgram(On.program)&&(hi=!0,er=!0,ms=!0),V.id!==z&&(z=V.id,er=!0),ve.needsLights){let ut=Zx(E.state.lightProbeGridArray,G);ve.lightProbeGrid!==ut&&(ve.lightProbeGrid=ut,er=!0)}if(hi||X!==M){he.buffers.depth.getReversed()&&M.reversedDepth!==!0&&(M._reversedDepth=!0,M.updateProjectionMatrix()),ct.setValue(N,"projectionMatrix",M.projectionMatrix),ct.setValue(N,"viewMatrix",M.matrixWorldInverse);let nr=ct.map.cameraPosition;nr!==void 0&&nr.setValue(N,it.setFromMatrixPosition(M.matrixWorld)),rt.logarithmicDepthBuffer&&ct.setValue(N,"logDepthBufFC",2/(Math.log(M.far+1)/Math.LN2)),(V.isMeshPhongMaterial||V.isMeshToonMaterial||V.isMeshLambertMaterial||V.isMeshBasicMaterial||V.isMeshStandardMaterial||V.isShaderMaterial)&&ct.setValue(N,"isOrthographic",M.isOrthographicCamera===!0),X!==M&&(X=M,er=!0,ms=!0)}if(ve.needsLights&&(Mn.state.directionalShadowMap.length>0&&ct.setValue(N,"directionalShadowMap",Mn.state.directionalShadowMap,y),Mn.state.spotShadowMap.length>0&&ct.setValue(N,"spotShadowMap",Mn.state.spotShadowMap,y),Mn.state.pointShadowMap.length>0&&ct.setValue(N,"pointShadowMap",Mn.state.pointShadowMap,y)),G.isSkinnedMesh){ct.setOptional(N,G,"bindMatrix"),ct.setOptional(N,G,"bindMatrixInverse");let ut=G.skeleton;ut&&(ut.boneTexture===null&&ut.computeBoneTexture(),ct.setValue(N,"boneTexture",ut.boneTexture,y))}G.isBatchedMesh&&(ct.setOptional(N,G,"batchingTexture"),ct.setValue(N,"batchingTexture",G._matricesTexture,y),ct.setOptional(N,G,"batchingIdTexture"),ct.setValue(N,"batchingIdTexture",G._indirectTexture,y),ct.setOptional(N,G,"batchingColorTexture"),G._colorsTexture!==null&&ct.setValue(N,"batchingColorTexture",G._colorsTexture,y));let tr=q.morphAttributes;if((tr.position!==void 0||tr.normal!==void 0||tr.color!==void 0)&&Le.update(G,q,On),(er||ve.receiveShadow!==G.receiveShadow)&&(ve.receiveShadow=G.receiveShadow,ct.setValue(N,"receiveShadow",G.receiveShadow)),(V.isMeshStandardMaterial||V.isMeshLambertMaterial||V.isMeshPhongMaterial)&&V.envMap===null&&F.environment!==null&&(Pt.envMapIntensity.value=F.environmentIntensity),Pt.dfgLUT!==void 0&&(Pt.dfgLUT.value=Wb()),er){if(ct.setValue(N,"toneMappingExposure",P.toneMappingExposure),ve.needsLights&&Jx(Pt,ms),me&&V.fog===!0&&W.refreshFogUniforms(Pt,me),W.refreshMaterialUniforms(Pt,V,Ie,Qe,E.state.transmissionRenderTarget[M.id]),ve.needsLights&&ve.lightProbeGrid){let ut=ve.lightProbeGrid;Pt.probesSH.value=ut.texture,Pt.probesMin.value.copy(ut.boundingBox.min),Pt.probesMax.value.copy(ut.boundingBox.max),Pt.probesResolution.value.copy(ut.resolution)}vo.upload(N,wm(ve),Pt,y)}if(V.isShaderMaterial&&V.uniformsNeedUpdate===!0&&(vo.upload(N,wm(ve),Pt,y),V.uniformsNeedUpdate=!1),V.isSpriteMaterial&&ct.setValue(N,"center",G.center),ct.setValue(N,"modelViewMatrix",G.modelViewMatrix),ct.setValue(N,"normalMatrix",G.normalMatrix),ct.setValue(N,"modelMatrix",G.matrixWorld),V.uniformsGroups!==void 0){let ut=V.uniformsGroups;for(let nr=0,gs=ut.length;nr<gs;nr++){let Tm=ut[nr];J.update(Tm,On),J.bind(Tm,On)}}return On}function Jx(M,F){M.ambientLightColor.needsUpdate=F,M.lightProbe.needsUpdate=F,M.directionalLights.needsUpdate=F,M.directionalLightShadows.needsUpdate=F,M.pointLights.needsUpdate=F,M.pointLightShadows.needsUpdate=F,M.spotLights.needsUpdate=F,M.spotLightShadows.needsUpdate=F,M.rectAreaLights.needsUpdate=F,M.hemisphereLights.needsUpdate=F}function Kx(M){return M.isMeshLambertMaterial||M.isMeshToonMaterial||M.isMeshPhongMaterial||M.isMeshStandardMaterial||M.isShadowMaterial||M.isShaderMaterial&&M.lights===!0}this.getActiveCubeFace=function(){return Y},this.getActiveMipmapLevel=function(){return H},this.getRenderTarget=function(){return O},this.setRenderTargetTextures=function(M,F,q){let V=b.get(M);V.__autoAllocateDepthBuffer=M.resolveDepthBuffer===!1,V.__autoAllocateDepthBuffer===!1&&(V.__useRenderToTexture=!1),b.get(M.texture).__webglTexture=F,b.get(M.depthTexture).__webglTexture=V.__autoAllocateDepthBuffer?void 0:q,V.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(M,F){let q=b.get(M);q.__webglFramebuffer=F,q.__useDefaultFramebuffer=F===void 0};let jx=N.createFramebuffer();this.setRenderTarget=function(M,F=0,q=0){O=M,Y=F,H=q;let V=null,G=!1,me=!1;if(M){let pe=b.get(M);if(pe.__useDefaultFramebuffer!==void 0){he.bindFramebuffer(N.FRAMEBUFFER,pe.__webglFramebuffer),ee.copy(M.viewport),te.copy(M.scissor),ue=M.scissorTest,he.viewport(ee),he.scissor(te),he.setScissorTest(ue),z=-1;return}else if(pe.__webglFramebuffer===void 0)y.setupRenderTarget(M);else if(pe.__hasExternalTextures)y.rebindTextures(M,b.get(M.texture).__webglTexture,b.get(M.depthTexture).__webglTexture);else if(M.depthBuffer){let Be=M.depthTexture;if(pe.__boundDepthTexture!==Be){if(Be!==null&&b.has(Be)&&(M.width!==Be.image.width||M.height!==Be.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");y.setupDepthRenderbuffer(M)}}let Me=M.texture;(Me.isData3DTexture||Me.isDataArrayTexture||Me.isCompressedArrayTexture)&&(me=!0);let Te=b.get(M).__webglFramebuffer;M.isWebGLCubeRenderTarget?(Array.isArray(Te[F])?V=Te[F][q]:V=Te[F],G=!0):M.samples>0&&y.useMultisampledRTT(M)===!1?V=b.get(M).__webglMultisampledFramebuffer:Array.isArray(Te)?V=Te[q]:V=Te,ee.copy(M.viewport),te.copy(M.scissor),ue=M.scissorTest}else ee.copy(ne).multiplyScalar(Ie).floor(),te.copy(we).multiplyScalar(Ie).floor(),ue=Ne;if(q!==0&&(V=jx),he.bindFramebuffer(N.FRAMEBUFFER,V)&&he.drawBuffers(M,V),he.viewport(ee),he.scissor(te),he.setScissorTest(ue),G){let pe=b.get(M.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_CUBE_MAP_POSITIVE_X+F,pe.__webglTexture,q)}else if(me){let pe=F;for(let Me=0;Me<M.textures.length;Me++){let Te=b.get(M.textures[Me]);N.framebufferTextureLayer(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0+Me,Te.__webglTexture,q,pe)}}else if(M!==null&&q!==0){let pe=b.get(M.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,pe.__webglTexture,q)}z=-1},this.readRenderTargetPixels=function(M,F,q,V,G,me,xe,pe=0){if(!(M&&M.isWebGLRenderTarget)){Pe("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Me=b.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&xe!==void 0&&(Me=Me[xe]),Me){he.bindFramebuffer(N.FRAMEBUFFER,Me);try{let Te=M.textures[pe],Be=Te.format,Ge=Te.type;if(M.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+pe),!rt.textureFormatReadable(Be)){Pe("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!rt.textureTypeReadable(Ge)){Pe("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}F>=0&&F<=M.width-V&&q>=0&&q<=M.height-G&&N.readPixels(F,q,V,G,L.convert(Be),L.convert(Ge),me)}finally{let Te=O!==null?b.get(O).__webglFramebuffer:null;he.bindFramebuffer(N.FRAMEBUFFER,Te)}}},this.readRenderTargetPixelsAsync=async function(M,F,q,V,G,me,xe,pe=0){if(!(M&&M.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Me=b.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&xe!==void 0&&(Me=Me[xe]),Me)if(F>=0&&F<=M.width-V&&q>=0&&q<=M.height-G){he.bindFramebuffer(N.FRAMEBUFFER,Me);let Te=M.textures[pe],Be=Te.format,Ge=Te.type;if(M.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+pe),!rt.textureFormatReadable(Be))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!rt.textureTypeReadable(Ge))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let be=N.createBuffer();N.bindBuffer(N.PIXEL_PACK_BUFFER,be),N.bufferData(N.PIXEL_PACK_BUFFER,me.byteLength,N.STREAM_READ),N.readPixels(F,q,V,G,L.convert(Be),L.convert(Ge),0);let ot=O!==null?b.get(O).__webglFramebuffer:null;he.bindFramebuffer(N.FRAMEBUFFER,ot);let Rt=N.fenceSync(N.SYNC_GPU_COMMANDS_COMPLETE,0);return N.flush(),await ax(N,Rt,4),N.bindBuffer(N.PIXEL_PACK_BUFFER,be),N.getBufferSubData(N.PIXEL_PACK_BUFFER,0,me),N.deleteBuffer(be),N.deleteSync(Rt),me}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(M,F=null,q=0){let V=Math.pow(2,-q),G=Math.floor(M.image.width*V),me=Math.floor(M.image.height*V),xe=F!==null?F.x:0,pe=F!==null?F.y:0;y.setTexture2D(M,0),N.copyTexSubImage2D(N.TEXTURE_2D,q,0,0,xe,pe,G,me),he.unbindTexture()};let Qx=N.createFramebuffer(),ey=N.createFramebuffer();this.copyTextureToTexture=function(M,F,q=null,V=null,G=0,me=0){let xe,pe,Me,Te,Be,Ge,be,ot,Rt,Tt=M.isCompressedTexture?M.mipmaps[me]:M.image;if(q!==null)xe=q.max.x-q.min.x,pe=q.max.y-q.min.y,Me=q.isBox3?q.max.z-q.min.z:1,Te=q.min.x,Be=q.min.y,Ge=q.isBox3?q.min.z:0;else{let Pt=Math.pow(2,-G);xe=Math.floor(Tt.width*Pt),pe=Math.floor(Tt.height*Pt),M.isDataArrayTexture?Me=Tt.depth:M.isData3DTexture?Me=Math.floor(Tt.depth*Pt):Me=1,Te=0,Be=0,Ge=0}V!==null?(be=V.x,ot=V.y,Rt=V.z):(be=0,ot=0,Rt=0);let lt=L.convert(F.format),$t=L.convert(F.type),ve;F.isData3DTexture?(y.setTexture3D(F,0),ve=N.TEXTURE_3D):F.isDataArrayTexture||F.isCompressedArrayTexture?(y.setTexture2DArray(F,0),ve=N.TEXTURE_2D_ARRAY):(y.setTexture2D(F,0),ve=N.TEXTURE_2D),he.activeTexture(N.TEXTURE0),he.pixelStorei(N.UNPACK_FLIP_Y_WEBGL,F.flipY),he.pixelStorei(N.UNPACK_PREMULTIPLY_ALPHA_WEBGL,F.premultiplyAlpha),he.pixelStorei(N.UNPACK_ALIGNMENT,F.unpackAlignment);let Mn=he.getParameter(N.UNPACK_ROW_LENGTH),$e=he.getParameter(N.UNPACK_IMAGE_HEIGHT),On=he.getParameter(N.UNPACK_SKIP_PIXELS),hi=he.getParameter(N.UNPACK_SKIP_ROWS),er=he.getParameter(N.UNPACK_SKIP_IMAGES);he.pixelStorei(N.UNPACK_ROW_LENGTH,Tt.width),he.pixelStorei(N.UNPACK_IMAGE_HEIGHT,Tt.height),he.pixelStorei(N.UNPACK_SKIP_PIXELS,Te),he.pixelStorei(N.UNPACK_SKIP_ROWS,Be),he.pixelStorei(N.UNPACK_SKIP_IMAGES,Ge);let ms=M.isDataArrayTexture||M.isData3DTexture,ct=F.isDataArrayTexture||F.isData3DTexture;if(M.isDepthTexture){let Pt=b.get(M),tr=b.get(F),ut=b.get(Pt.__renderTarget),nr=b.get(tr.__renderTarget);he.bindFramebuffer(N.READ_FRAMEBUFFER,ut.__webglFramebuffer),he.bindFramebuffer(N.DRAW_FRAMEBUFFER,nr.__webglFramebuffer);for(let gs=0;gs<Me;gs++)ms&&(N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,b.get(M).__webglTexture,G,Ge+gs),N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,b.get(F).__webglTexture,me,Rt+gs)),N.blitFramebuffer(Te,Be,xe,pe,be,ot,xe,pe,N.DEPTH_BUFFER_BIT,N.NEAREST);he.bindFramebuffer(N.READ_FRAMEBUFFER,null),he.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else if(G!==0||M.isRenderTargetTexture||b.has(M)){let Pt=b.get(M),tr=b.get(F);he.bindFramebuffer(N.READ_FRAMEBUFFER,Qx),he.bindFramebuffer(N.DRAW_FRAMEBUFFER,ey);for(let ut=0;ut<Me;ut++)ms?N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,Pt.__webglTexture,G,Ge+ut):N.framebufferTexture2D(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,Pt.__webglTexture,G),ct?N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,tr.__webglTexture,me,Rt+ut):N.framebufferTexture2D(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,tr.__webglTexture,me),G!==0?N.blitFramebuffer(Te,Be,xe,pe,be,ot,xe,pe,N.COLOR_BUFFER_BIT,N.NEAREST):ct?N.copyTexSubImage3D(ve,me,be,ot,Rt+ut,Te,Be,xe,pe):N.copyTexSubImage2D(ve,me,be,ot,Te,Be,xe,pe);he.bindFramebuffer(N.READ_FRAMEBUFFER,null),he.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else ct?M.isDataTexture||M.isData3DTexture?N.texSubImage3D(ve,me,be,ot,Rt,xe,pe,Me,lt,$t,Tt.data):F.isCompressedArrayTexture?N.compressedTexSubImage3D(ve,me,be,ot,Rt,xe,pe,Me,lt,Tt.data):N.texSubImage3D(ve,me,be,ot,Rt,xe,pe,Me,lt,$t,Tt):M.isDataTexture?N.texSubImage2D(N.TEXTURE_2D,me,be,ot,xe,pe,lt,$t,Tt.data):M.isCompressedTexture?N.compressedTexSubImage2D(N.TEXTURE_2D,me,be,ot,Tt.width,Tt.height,lt,Tt.data):N.texSubImage2D(N.TEXTURE_2D,me,be,ot,xe,pe,lt,$t,Tt);he.pixelStorei(N.UNPACK_ROW_LENGTH,Mn),he.pixelStorei(N.UNPACK_IMAGE_HEIGHT,$e),he.pixelStorei(N.UNPACK_SKIP_PIXELS,On),he.pixelStorei(N.UNPACK_SKIP_ROWS,hi),he.pixelStorei(N.UNPACK_SKIP_IMAGES,er),me===0&&F.generateMipmaps&&N.generateMipmap(ve),he.unbindTexture()},this.initRenderTarget=function(M){b.get(M).__webglFramebuffer===void 0&&y.setupRenderTarget(M)},this.initTexture=function(M){M.isCubeTexture?y.setTextureCube(M,0):M.isData3DTexture?y.setTexture3D(M,0):M.isDataArrayTexture||M.isCompressedArrayTexture?y.setTexture2DArray(M,0):y.setTexture2D(M,0),he.unbindTexture()},this.resetState=function(){Y=0,H=0,O=null,he.reset(),ae.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return oi}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let n=this.getContext();n.drawingBufferColorSpace=Xe._getDrawingBufferColorSpace(e),n.unpackColorSpace=Xe._getUnpackColorSpace()}};var Ae=Qa(gm());async function jb(){let t=typeof AbortController=="function"?new AbortController:null,e;try{let n=fetch("./game.config.json",{signal:t==null?void 0:t.signal}).then(s=>{if(!s.ok)throw new Error(`HTTP ${s.status}`);return s.json()}),i=new Promise((s,o)=>{e=setTimeout(()=>o(new Error("timed out")),1200)}),r=await Promise.race([n,i]);if(!r||typeof r!="object"||Array.isArray(r)||["tweaks","texts","images"].some(s=>r[s]!=null&&!Array.isArray(r[s])))throw new Error("invalid config");return r}catch(n){return console.warn("[playable] Using packaged defaults:",n.message),null}finally{clearTimeout(e),t==null||t.abort()}}function Qb(t,e){if(e(),typeof ResizeObserver=="function"){let n=new ResizeObserver(e);return n.observe(t),()=>n.disconnect()}return window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}var yo=window.parent!==window&&new URLSearchParams(location.search).get("feedReview")==="1";yo&&(document.documentElement.dataset.feedCover="true",window.addEventListener("message",t=>{var e;t.source!==window.parent||t.origin!==location.origin||((e=t.data)==null?void 0:e.type)!=="playable-active"||(yo=t.data.active!==!0,document.documentElement.dataset.feedCover=String(yo))}));var eA=`
@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Poppins';
  src: url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: "Poppins", "PingFang SC", system-ui, sans-serif;
  --font-body:    "Poppins", "PingFang SC", system-ui, sans-serif;
  --font-mono:    ui-monospace, Menlo, monospace;
}
`,Wx={RUN_LENGTH:435,CRUISE_SPEED:22,BRAKE_SPEED:9,GATE_POINTS:100,MISS_PENALTY:30,GUIDE:"Drag to carve",BRAKE:"Brake",FINISH:"Run complete",TIME:"Time",POINTS:"Points",BEST:"Personal best",REPLAY:"Run again",BLUE:"Blue Run",BLACK:"Black Run",CLEAN:"Clean!",MISSED:"Missed"},Ii=(t,e=!1)=>{try{window.SFX&&(e?window.SFX.playOnce(t):window.SFX.play(t))}catch{}},tA=()=>{try{return JSON.parse(localStorage.getItem("alpine-best-v3")||"{}")}catch{return{}}},Xx=(t="blue")=>({phase:"ready",route:t,z:0,x:0,speed:0,elapsed:0,score:0,steering:0,drag:0,keys:{},braking:!1,gateIndex:0,feedback:"",feedbackUntil:0,lastCarve:0,lastBump:0,pointer:null,completed:!1,spray:0}),Fn=t=>t*.14+1.2*Math.sin(t/13)+.65*Math.sin(t/7),_m=t=>(Fn(t+1)-Fn(t-1))/2,nA=(t,e)=>{let n=t==="black",i=n?[4.6,-4.6,5,-5,4,-4]:[3.5,-3.3,3.6,-3.4,2.8,-3.1],r=Math.max(2,Math.round((e-31)/19)+1);return Array.from({length:r},(s,o)=>({x:o===0||o===r-1?0:i[(o-1)%i.length],z:-(16+o*((e-31)/(r-1))),width:n?4.6:5.8}))};function iA(){let[t,e]=(0,Dt.useState)(!1),n=(0,Dt.useRef)(!1),i=typeof tt<"u"&&typeof tt.playableRecordingSubmission=="function";return(0,Dt.useEffect)(()=>{let s=()=>{n.current=!1,e(!1)},o=()=>{document.visibilityState==="visible"&&s()};return document.addEventListener("visibilitychange",o),window.addEventListener("pageshow",s),()=>{document.removeEventListener("visibilitychange",o),window.removeEventListener("pageshow",s)}},[]),{can:i,submitting:t,submit:()=>{if(!(n.current||!i)){n.current=!0,e(!0),Ii("click");try{tt.playableRecordingSubmission({success(){},fail(s){console.error("[post_my_play] submission failed",s&&(s.errMsg||s.message)),n.current=!1,e(!1)},complete(){}})}catch(s){console.error("[post_my_play] submission failed",s),n.current=!1,e(!1)}}}}}function rA(){let[t,e]=(0,Dt.useState)(null),[n,i]=(0,Dt.useState)({phase:"ready",route:"blue",speed:0,time:0,score:0,feedback:"",x:0,z:0}),[r,s]=(0,Dt.useState)(!0),[o,a]=(0,Dt.useState)(tA),[l,c]=(0,Dt.useState)(!1),f=(0,Dt.useRef)(null),d=(0,Dt.useRef)(null),h=(0,Dt.useRef)(Xx()),p=(0,Dt.useRef)(Wx),v=(0,Dt.useRef)(o),S=iA();(0,Dt.useEffect)(()=>{window.SFX&&window.SFX.register({carve:"buzzer",brake:"buzzer",gate:"buzzer",miss:"buzzer",bump:"./assets/sfx_bump.mp3",click:"./assets/sfx_click.mp3",finish:"./assets/sfx_finish.mp3"}),jb().then(g=>{let T=g||{},P={...Wx};for(let R of[...T.tweaks||[],...T.texts||[]])P[R.id]=R.value;for(let R of T.images||[])P[R.id]=R.path;p.current=P,e(P)})},[]),(0,Dt.useEffect)(()=>{v.current=o},[o]),(0,Dt.useEffect)(()=>{if(!t||!f.current)return;let g=f.current,T;try{T=new xh({antialias:!0,alpha:!0})}catch(I){console.error("WebGL unavailable",I);return}T.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),T.outputColorSpace=hn,g.appendChild(T.domElement);let P=new Ta;P.fog=new Ea(13231343,65,205);let R=new rn(58,1,.1,500),D=new Ua(16777215,9550028,1.15);P.add(D);let Y=new Oa(16777215,1.15);Y.position.set(-30,80,30),P.add(Y);let H=I=>new La({color:I}),O=H(15398648),z=H(12967914),X=H(2645605),ee=H(3962744),te=H(16055292),ue=H(6125435);function ce(I,B,U,$,j,W=P){let Z=new yn(I,B);return Z.position.set(U,$,j),W.add(Z),Z}function Se(I,B,U,$){let j=t.RUN_LENGTH+120,W=new bi(I,j,1,Math.ceil(j/2));W.rotateX(-Math.PI/2),W.translate(B,0,30-j/2);let Z=W.attributes.position;for(let re=0;re<Z.count;re++)Z.setY(re,Fn(Z.getZ(re))+U);W.computeVertexNormals(),ce(W,$,0,0,0)}Se(110,0,0,z),Se(22,0,.015,O);let Ye=H(13953521);for(let I=-5;I<=5;I++)Se(.12,I*2,.03,Ye);for(let I=0;I<Math.ceil((t.RUN_LENGTH+60)/9);I++){let B=I%2?1:-1,U=-8-I*9,$=B*(15+I%4*3),j=new In;j.position.set($,Fn(U),U),P.add(j),ce(new Ti(.16,.22,1.4,6),ue,0,.7,0,j);for(let W=0;W<3;W++){let Z=ce(new Dr(1.65-W*.28,2.6,6),W%2?ee:X,0,1.8+W*.95,0,j);Z.rotation.y=.4;let re=ce(new Dr(1.05-W*.18,1.15,6),te,0,2.65+W*.95,0,j);re.rotation.y=.4}j.scale.setScalar(.8+I%3*.22)}let Qe=[H(10403278),H(12113121),H(14150640)],Ie=new In;P.add(Ie);let K=228;for(let I=0;I<9;I++){let B=(I-4)*37,U=42+I%3*10,$=ce(new Dr(33,U,4),Qe[I%3],B,U/2,0,Ie);$.rotation.y=Math.PI/4;let j=ce(new Dr(16.5,U/2,4),te,B,U*.75,-.08,Ie);j.scale.set(1.005,1.005,1.005),j.rotation.y=Math.PI/4}let fe=ce(new Ti(.035,.035,95,5),H(6652298),-32,Fn(-85)+18,-85);fe.rotation.z=Math.PI/2,fe.rotation.x=.14;for(let I=0;I<4;I++){let B=new In;B.position.set(-61+I*20,Fn(-85)+16,-85),P.add(B),ce(new Ei(1.6,1.3,.8),H(5467768),0,0,0,B),ce(new Ei(1.25,.55,.85),H(10931417),0,.15,0,B),ce(new Ti(.04,.04,1.4,5),H(5467768),0,1.3,0,B)}let ne=new In;P.add(ne);let we=new In;P.add(we);let Ne=H(15817556),Ce=H(2987466),dt=H(16383999),ke=H(1654613),je=new bi(.09,1.4),it=H(10799575),Ue=[];function Et(I){for(;ne.children.length;)ne.remove(ne.children[0]);for(;we.children.length;)we.remove(we.children[0]);Ue=nA(I,p.current.RUN_LENGTH),Ue.forEach(($,j)=>{let W=j%2?Ne:Ce,Z=Fn($.z);for(let re of[-1,1]){let ge=$.x+re*$.width/2;ce(new Ti(.055,.055,2.9,6),dt,ge,Z+1.45,$.z,ne);let oe=ce(new bi(1.05,.8),W,ge+re*.53,Z+2.2,$.z,ne);oe.material.side=Yn}});let B=-p.current.RUN_LENGTH,U=Fn(B);for(let $ of[-1,1]){let j=$*7;ce(new Ti(.1,.1,4,7),ke,j,U+2,B,ne)}for(let $=0;$<14;$++){let j=ce(new Ei(1,.65,.1),$%2?te:ke,-6.5+$,U+3.8,B,ne)}for(let $=0;$<14;$++){let j=ce(new bi(1,.9),$%2?te:ke,-6.5+$,U+.04,B,ne);j.rotation.x=-Math.PI/2-Math.atan(_m(B))}for(let $=0;$<Math.ceil((p.current.RUN_LENGTH+30)/11);$++){let j=$%2?1:-1,W=-12-$*11;ce(new Ia(1.25,7,4),z,j*(11+$%3*1.2),Fn(W)+.1,W,ne).scale.set(1.5,.42,1)}}Et(h.current.route);let at=0,Wt=0,N=0,xt=0,ze=0,rt=window.matchMedia("(prefers-reduced-motion: reduce)"),_t=Qb(g,()=>{let I=g.clientWidth,B=g.clientHeight;!I||!B||(T.setSize(I,B,!1),R.aspect=I/B,R.updateProjectionMatrix())});function b(I){if(I.completed)return;I.completed=!0,I.phase="result",I.braking=!1,c(!1),Ii("finish",!0);let B={...v.current};(!B[I.route]||I.elapsed<B[I.route])&&(B[I.route]=I.elapsed),v.current=B,a(B);try{localStorage.setItem("alpine-best-v3",JSON.stringify(B))}catch{}console.log("[ski] finish",I.route,I.elapsed.toFixed(2),I.score)}function y(I){xt=requestAnimationFrame(y);let B=Wt?Math.min((I-Wt)/1e3,.032):.016;Wt=I;let U=h.current,$=p.current;if(document.hidden)return;if(U.phase==="playing"&&!yo){U.elapsed+=B;let se=(U.keys.ArrowRight?1:0)-(U.keys.ArrowLeft?1:0)||U.drag;U.steering+=(se-U.steering)*Math.min(1,B*7.5);let Le=U.braking?$.BRAKE_SPEED:$.CRUISE_SPEED*(U.route==="black"?1.12:1)*(.83+Math.max(0,_m(U.z))*1.15);U.speed+=(Le-U.speed)*Math.min(1,B*(U.braking?2.5:.6));let Fe=12.2/(.55+U.speed/18);for(U.x+=U.steering*Fe*B,U.x=Math.max(-13,Math.min(13,U.x)),U.z-=U.speed*B,Math.abs(U.x)>9.8&&I-U.lastBump>1300&&(U.speed*=.72,U.x=Math.sign(U.x)*9.5,U.lastBump=I,U.spray=1,Ii("bump"));U.gateIndex<Ue.length&&-U.z>=-Ue[U.gateIndex].z;){let He=Ue[U.gateIndex++],L=Math.abs(U.x-He.x)<He.width/2;L?(U.score+=$.GATE_POINTS+(U.speed<19?20:0),U.feedback=$.CLEAN,Ii("gate")):(U.score-=$.MISS_PENALTY,U.feedback=$.MISSED,Ii("miss")),U.feedbackUntil=I+900,console.log("[ski] gate",U.gateIndex,L,U.score)}if(I>U.feedbackUntil&&(U.feedback=""),-U.z>=$.RUN_LENGTH&&b(U),Math.abs(U.z-at)>1.2){at=U.z;for(let He of[-.28,.28]){let L=ce(je,it,U.x+He,Fn(U.z+1)+.05,U.z+1,we);L.rotation.x=-Math.PI/2-Math.atan(_m(U.z+1))}for(;we.children.length>100;)we.remove(we.children[0])}U.spray=Math.max(0,U.spray-B*2)}let j=yo&&U.phase==="ready"&&!rt.matches;j&&(ze+=B);let W=j?Math.sin(ze*1.9):0,Z=U.x+W*.7,re=U.z-(j?(1-Math.cos(ze*1.9))*1.4:0),ge=re-K;Ie.position.set(0,Fn(ge)-6,ge),R.position.set(Z,Fn(re+4)+2.3,re+4),R.lookAt(Z+U.steering*1.2+W*.9,Fn(re-24)+1.25,re-24),R.rotateZ(-U.steering*.065-W*.035),g.parentElement.style.setProperty("--cover-lean",`${W*5}deg`),T.render(P,R),I-N>120&&(N=I,i({phase:U.phase,route:U.route,speed:Math.round(U.speed*2.2),time:U.elapsed,score:U.score,feedback:U.feedback,x:U.x,z:U.z,spray:U.spray,steering:U.steering,gateIndex:U.gateIndex}))}return xt=requestAnimationFrame(y),d.current={makeRoute:Et,resetTracks:()=>{at=0}},()=>{cancelAnimationFrame(xt),_t(),d.current=null,je.dispose(),it.dispose(),T.dispose(),g.removeChild(T.domElement),P.traverse(I=>{I.geometry&&I.geometry.dispose(),I.material&&(Array.isArray(I.material)?I.material.forEach(B=>B.dispose()):I.material.dispose())})}},[t]);function _(){let g=h.current;g.phase==="ready"&&(g.phase="playing",g.speed=8,s(!1),console.log("[ski] started",g.route))}function u(g){if(yo||g.isPrimary===!1||g.button>0||g.target.closest("button")||h.current.phase==="result")return;let T=h.current;T.pointer={id:g.pointerId,x:g.clientX};try{g.currentTarget.setPointerCapture(g.pointerId)}catch{}}function m(g){let T=h.current;if(!T.pointer||T.pointer.id!==g.pointerId)return;let P=g.clientX-T.pointer.x;Math.abs(P)>4&&(_(),T.drag=Math.max(-1,Math.min(1,P/85)),Math.abs(T.drag)>.55&&performance.now()-T.lastCarve>850&&(T.lastCarve=performance.now(),T.spray=1,Ii("carve")))}function x(g){let T=h.current;T.pointer&&T.pointer.id===g.pointerId&&(T.pointer=null,T.drag=0)}(0,Dt.useEffect)(()=>{let g=R=>{if(["ArrowLeft","ArrowRight","Space"].includes(R.code)){R.preventDefault();let D=h.current;if(D.phase==="result")return;R.code==="Space"?D.phase==="playing"&&!D.braking&&(D.braking=!0,D.spray=1,c(!0),Ii("brake")):(D.keys[R.code]||(_(),Ii("carve")),D.keys[R.code]=!0)}},T=R=>{let D=h.current;R.code==="Space"?(D.braking=!1,c(!1)):D.keys[R.code]=!1};window.addEventListener("keydown",g),window.addEventListener("keyup",T);let P=()=>{document.visibilityState!=="visible"&&(h.current.braking=!1,h.current.keys={},h.current.drag=0,c(!1))};return document.addEventListener("visibilitychange",P),()=>{window.removeEventListener("keydown",g),window.removeEventListener("keyup",T),document.removeEventListener("visibilitychange",P)}},[]);function w(g){g.stopPropagation();let T=h.current;if(!(T.phase!=="playing"||T.braking)){T.braking=!0,T.spray=1,c(!0),Ii("brake");try{g.currentTarget.setPointerCapture(g.pointerId)}catch{}}}function A(g){g.stopPropagation(),h.current.braking=!1,c(!1)}function E(g){var T,P;Ii("click"),window.SFX&&window.SFX.reset(),h.current=Xx(g),s(!0),c(!1),(T=d.current)==null||T.makeRoute(g),(P=d.current)==null||P.resetTracks(),i({phase:"ready",route:g,speed:0,time:0,score:0,feedback:"",x:0,z:0}),console.log("[ski] reset",g)}let C=g=>typeof g=="number"?g.toFixed(1)+"s":"\u2014";return(0,Ae.jsxs)("div",{className:"app",onPointerDown:u,onPointerMove:m,onPointerUp:x,onPointerCancel:x,onLostPointerCapture:x,"data-phase":n.phase,"data-route":n.route,"data-x":n.x.toFixed(2),"data-z":n.z.toFixed(2),"data-gates":n.gateIndex||0,"data-score":n.score,children:[(0,Ae.jsx)("style",{children:eA+`
      *{box-sizing:border-box} .app{position:relative;width:100%;height:100%;overflow:clip;touch-action:none;background:linear-gradient(180deg,#77b9db 0%,#c6e6f1 47%,#edf8fa 70%);font-family:var(--font-body);color:#163f53;user-select:none} .scene{position:absolute;inset:0}.scene canvas{display:block;width:100%;height:100%}
      .guide{position:absolute;top:24%;left:30px;right:30px;text-align:center;pointer-events:none;color:#173f56;font-family:var(--font-display);font-size:18px;font-weight:700;text-shadow:0 2px 9px #fff,0 1px 2px #fff;animation:breathe 2.4s ease-in-out infinite}
      [data-feed-cover="true"] .skis{bottom:18%;height:25%;width:min(53%,220px);transform:translateX(-50%) rotate(var(--cover-lean,0deg))}
      @keyframes breathe{0%,100%{opacity:.78}50%{opacity:1}} @media(prefers-reduced-motion:reduce){.guide{animation:none}}
      .hud{position:absolute;top:30px;left:30px;right:30px;display:flex;justify-content:space-between;align-items:flex-start;color:#173f56;font-family:var(--font-display);font-size:22px;font-weight:700;line-height:1;text-shadow:0 1px 6px #fff}.hud small{font-size:12px;font-weight:700;margin-left:3px}.feedback{position:absolute;top:24%;left:50%;transform:translateX(-50%);font-family:var(--font-display);font-size:20px;font-weight:700;white-space:nowrap;color:#174961;text-shadow:0 2px 6px #fff}
      .skis{position:absolute;bottom:-3%;left:50%;transform:translateX(-50%) rotate(var(--lean));width:min(66%,280px);height:28%;pointer-events:none;transition:transform .15s ease-out;filter:drop-shadow(0 4px 4px #477d8b55)}.skis svg{width:100%;height:100%;overflow:visible}.spray{position:absolute;bottom:7%;left:50%;transform:translateX(-50%);width:80%;height:25%;pointer-events:none;opacity:var(--spray);transition:opacity .2s}
      .brake{position:absolute;bottom:50px;right:30px;border:1px solid #ffffffb8;background:#f4fbfbd9;color:#1a5068;border-radius:50%;width:72px;height:72px;box-shadow:0 5px 18px #164c6640;font-family:var(--font-display);font-size:14px;font-weight:700;touch-action:none}.brake.active{background:#2d87a8;color:white;transform:scale(.96)}
      .result-shade{position:absolute;inset:0;background:linear-gradient(180deg,#163b4bb8,#174859c9);display:flex;align-items:center;justify-content:center;padding:24px}.result{width:min(100%,330px);text-align:center;color:white}.result h1{font-family:var(--font-display);font-size:24px;line-height:1.2;margin:0 0 5px}.route-name{font-size:14px;color:#b7e6f4;margin-bottom:22px}.stats{display:flex;justify-content:center;gap:40px;margin-bottom:20px}.stat span{display:block;font-size:12px;color:#c4e7ef}.stat strong{font-family:var(--font-display);font-size:28px}.best{border-top:1px solid #ffffff55;padding-top:14px;margin-bottom:20px;font-size:12px}.best-head{font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#a9d6e2;margin-bottom:8px}.best-row{display:flex;justify-content:space-between;padding:3px 15px}.actions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}.action{min-height:46px;border:0;border-radius:24px;padding:0 18px;font-family:var(--font-display);font-weight:700;font-size:13px;color:#174b60;background:#fff}.action.secondary{background:#82cbe2}.action:disabled{opacity:.55;pointer-events:none}
    `}),(0,Ae.jsx)("div",{className:"scene",ref:f}),r&&n.phase==="ready"&&t&&(0,Ae.jsx)("div",{className:"guide",children:t.GUIDE}),n.phase!=="result"&&(0,Ae.jsxs)(Ae.Fragment,{children:[(0,Ae.jsx)("div",{className:"skis",style:{"--lean":`${(n.steering||0)*-5}deg`},children:(0,Ae.jsxs)("svg",{viewBox:"0 0 220 180",preserveAspectRatio:"none",children:[(0,Ae.jsx)("path",{d:"M45 190 L64 50 Q68 17 80 18 Q92 19 91 49 L88 190Z",fill:"#173e54",stroke:"#d5f1f6",strokeWidth:"3"}),(0,Ae.jsx)("path",{d:"M63 150 L73 42 Q76 27 80 28 Q84 29 83 43 L78 150Z",fill:"#f66c4f"}),(0,Ae.jsx)("path",{d:"M132 190 L129 49 Q128 19 140 18 Q152 17 156 50 L175 190Z",fill:"#173e54",stroke:"#d5f1f6",strokeWidth:"3"}),(0,Ae.jsx)("path",{d:"M142 150 L137 43 Q136 29 140 28 Q144 27 147 42 L157 150Z",fill:"#f66c4f"})]})}),(0,Ae.jsx)("svg",{className:"spray",style:{"--spray":n.spray||0},viewBox:"0 0 300 150",children:(0,Ae.jsxs)("g",{fill:"#fff",opacity:".9",children:[(0,Ae.jsx)("circle",{cx:"27",cy:"110",r:"4"}),(0,Ae.jsx)("circle",{cx:"55",cy:"76",r:"3"}),(0,Ae.jsx)("circle",{cx:"86",cy:"115",r:"6"}),(0,Ae.jsx)("circle",{cx:"250",cy:"90",r:"5"}),(0,Ae.jsx)("circle",{cx:"275",cy:"120",r:"3"}),(0,Ae.jsx)("circle",{cx:"220",cy:"68",r:"3"}),(0,Ae.jsx)("circle",{cx:"190",cy:"120",r:"5"})]})})]}),n.phase==="playing"&&(0,Ae.jsxs)(Ae.Fragment,{children:[(0,Ae.jsxs)("div",{className:"hud",children:[(0,Ae.jsxs)("div",{children:[n.speed,(0,Ae.jsx)("small",{children:"km/h"})]}),(0,Ae.jsx)("div",{children:C(n.time)})]}),n.feedback&&(0,Ae.jsx)("div",{className:"feedback",children:n.feedback}),(0,Ae.jsx)("button",{className:"brake "+(l?"active":""),onPointerDown:w,onPointerUp:A,onPointerCancel:A,onLostPointerCapture:A,children:t.BRAKE})]}),n.phase==="result"&&(0,Ae.jsx)("div",{className:"result-shade",children:(0,Ae.jsxs)("div",{className:"result",children:[(0,Ae.jsx)("h1",{children:t.FINISH}),(0,Ae.jsx)("div",{className:"route-name",children:n.route==="blue"?t.BLUE:t.BLACK}),(0,Ae.jsxs)("div",{className:"stats",children:[(0,Ae.jsxs)("div",{className:"stat",children:[(0,Ae.jsx)("span",{children:t.TIME}),(0,Ae.jsx)("strong",{children:C(n.time)})]}),(0,Ae.jsxs)("div",{className:"stat",children:[(0,Ae.jsx)("span",{children:t.POINTS}),(0,Ae.jsx)("strong",{children:n.score})]})]}),(0,Ae.jsxs)("div",{className:"best",children:[(0,Ae.jsx)("div",{className:"best-head",children:t.BEST}),(0,Ae.jsxs)("div",{className:"best-row",children:[(0,Ae.jsx)("span",{children:t.BLUE}),(0,Ae.jsx)("b",{children:C(o.blue)})]}),(0,Ae.jsxs)("div",{className:"best-row",children:[(0,Ae.jsx)("span",{children:t.BLACK}),(0,Ae.jsx)("b",{children:C(o.black)})]})]}),(0,Ae.jsxs)("div",{className:"actions",children:[(0,Ae.jsx)("button",{className:"action",onClick:()=>E(n.route),children:t.REPLAY}),(0,Ae.jsx)("button",{className:"action secondary",onClick:()=>E(n.route==="blue"?"black":"blue"),children:n.route==="blue"?t.BLACK:t.BLUE}),S.can&&(0,Ae.jsx)("button",{className:"action",disabled:S.submitting,style:{opacity:S.submitting?.55:1,pointerEvents:S.submitting?"none":"auto"},onClick:S.submit,children:"Post my play"})]})]})})]})}(0,qx.createRoot)(document.getElementById("root")).render((0,Ae.jsx)(rA,{}));})();
