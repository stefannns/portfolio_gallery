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
(()=>{var My=Object.create;var zm=Object.defineProperty;var wy=Object.getOwnPropertyDescriptor;var Ey=Object.getOwnPropertyNames;var Ty=Object.getPrototypeOf,by=Object.prototype.hasOwnProperty;var Ii=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var Ay=(t,e,n,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of Ey(e))!by.call(t,r)&&r!==n&&zm(t,r,{get:()=>e[r],enumerable:!(i=wy(e,r))||i.enumerable});return t};var ul=(t,e,n)=>(n=t!=null?My(Ty(t)):{},Ay(e||!t||!t.__esModule?zm(n,"default",{value:t,enumerable:!0}):n,t));var jm=Ii(Ye=>{"use strict";var Ao=Symbol.for("react.element"),Cy=Symbol.for("react.portal"),Ry=Symbol.for("react.fragment"),Py=Symbol.for("react.strict_mode"),Iy=Symbol.for("react.profiler"),Ly=Symbol.for("react.provider"),Ny=Symbol.for("react.context"),Dy=Symbol.for("react.forward_ref"),Uy=Symbol.for("react.suspense"),Fy=Symbol.for("react.memo"),Oy=Symbol.for("react.lazy"),Vm=Symbol.iterator;function By(t){return t===null||typeof t!="object"?null:(t=Vm&&t[Vm]||t["@@iterator"],typeof t=="function"?t:null)}var Wm={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},Xm=Object.assign,qm={};function gs(t,e,n){this.props=t,this.context=e,this.refs=qm,this.updater=n||Wm}gs.prototype.isReactComponent={};gs.prototype.setState=function(t,e){if(typeof t!="object"&&typeof t!="function"&&t!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,t,e,"setState")};gs.prototype.forceUpdate=function(t){this.updater.enqueueForceUpdate(this,t,"forceUpdate")};function Ym(){}Ym.prototype=gs.prototype;function kh(t,e,n){this.props=t,this.context=e,this.refs=qm,this.updater=n||Wm}var zh=kh.prototype=new Ym;zh.constructor=kh;Xm(zh,gs.prototype);zh.isPureReactComponent=!0;var Hm=Array.isArray,Zm=Object.prototype.hasOwnProperty,Vh={current:null},$m={key:!0,ref:!0,__self:!0,__source:!0};function Jm(t,e,n){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)Zm.call(e,i)&&!$m.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=n;else if(1<a){for(var l=Array(a),c=0;c<a;c++)l[c]=arguments[c+2];r.children=l}if(t&&t.defaultProps)for(i in a=t.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:Ao,type:t,key:s,ref:o,props:r,_owner:Vh.current}}function ky(t,e){return{$$typeof:Ao,type:t.type,key:e,ref:t.ref,props:t.props,_owner:t._owner}}function Hh(t){return typeof t=="object"&&t!==null&&t.$$typeof===Ao}function zy(t){var e={"=":"=0",":":"=2"};return"$"+t.replace(/[=:]/g,function(n){return e[n]})}var Gm=/\/+/g;function Bh(t,e){return typeof t=="object"&&t!==null&&t.key!=null?zy(""+t.key):e.toString(36)}function dl(t,e,n,i,r){var s=typeof t;(s==="undefined"||s==="boolean")&&(t=null);var o=!1;if(t===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(t.$$typeof){case Ao:case Cy:o=!0}}if(o)return o=t,r=r(o),t=i===""?"."+Bh(o,0):i,Hm(r)?(n="",t!=null&&(n=t.replace(Gm,"$&/")+"/"),dl(r,e,n,"",function(c){return c})):r!=null&&(Hh(r)&&(r=ky(r,n+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(Gm,"$&/")+"/")+t)),e.push(r)),1;if(o=0,i=i===""?".":i+":",Hm(t))for(var a=0;a<t.length;a++){s=t[a];var l=i+Bh(s,a);o+=dl(s,e,n,l,r)}else if(l=By(t),typeof l=="function")for(t=l.call(t),a=0;!(s=t.next()).done;)s=s.value,l=i+Bh(s,a++),o+=dl(s,e,n,l,r);else if(s==="object")throw e=String(t),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function hl(t,e,n){if(t==null)return t;var i=[],r=0;return dl(t,i,"","",function(s){return e.call(n,s,r++)}),i}function Vy(t){if(t._status===-1){var e=t._result;e=e(),e.then(function(n){(t._status===0||t._status===-1)&&(t._status=1,t._result=n)},function(n){(t._status===0||t._status===-1)&&(t._status=2,t._result=n)}),t._status===-1&&(t._status=0,t._result=e)}if(t._status===1)return t._result.default;throw t._result}var hn={current:null},fl={transition:null},Hy={ReactCurrentDispatcher:hn,ReactCurrentBatchConfig:fl,ReactCurrentOwner:Vh};function Km(){throw Error("act(...) is not supported in production builds of React.")}Ye.Children={map:hl,forEach:function(t,e,n){hl(t,function(){e.apply(this,arguments)},n)},count:function(t){var e=0;return hl(t,function(){e++}),e},toArray:function(t){return hl(t,function(e){return e})||[]},only:function(t){if(!Hh(t))throw Error("React.Children.only expected to receive a single React element child.");return t}};Ye.Component=gs;Ye.Fragment=Ry;Ye.Profiler=Iy;Ye.PureComponent=kh;Ye.StrictMode=Py;Ye.Suspense=Uy;Ye.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=Hy;Ye.act=Km;Ye.cloneElement=function(t,e,n){if(t==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+t+".");var i=Xm({},t.props),r=t.key,s=t.ref,o=t._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=Vh.current),e.key!==void 0&&(r=""+e.key),t.type&&t.type.defaultProps)var a=t.type.defaultProps;for(l in e)Zm.call(e,l)&&!$m.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=n;else if(1<l){a=Array(l);for(var c=0;c<l;c++)a[c]=arguments[c+2];i.children=a}return{$$typeof:Ao,type:t.type,key:r,ref:s,props:i,_owner:o}};Ye.createContext=function(t){return t={$$typeof:Ny,_currentValue:t,_currentValue2:t,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},t.Provider={$$typeof:Ly,_context:t},t.Consumer=t};Ye.createElement=Jm;Ye.createFactory=function(t){var e=Jm.bind(null,t);return e.type=t,e};Ye.createRef=function(){return{current:null}};Ye.forwardRef=function(t){return{$$typeof:Dy,render:t}};Ye.isValidElement=Hh;Ye.lazy=function(t){return{$$typeof:Oy,_payload:{_status:-1,_result:t},_init:Vy}};Ye.memo=function(t,e){return{$$typeof:Fy,type:t,compare:e===void 0?null:e}};Ye.startTransition=function(t){var e=fl.transition;fl.transition={};try{t()}finally{fl.transition=e}};Ye.unstable_act=Km;Ye.useCallback=function(t,e){return hn.current.useCallback(t,e)};Ye.useContext=function(t){return hn.current.useContext(t)};Ye.useDebugValue=function(){};Ye.useDeferredValue=function(t){return hn.current.useDeferredValue(t)};Ye.useEffect=function(t,e){return hn.current.useEffect(t,e)};Ye.useId=function(){return hn.current.useId()};Ye.useImperativeHandle=function(t,e,n){return hn.current.useImperativeHandle(t,e,n)};Ye.useInsertionEffect=function(t,e){return hn.current.useInsertionEffect(t,e)};Ye.useLayoutEffect=function(t,e){return hn.current.useLayoutEffect(t,e)};Ye.useMemo=function(t,e){return hn.current.useMemo(t,e)};Ye.useReducer=function(t,e,n){return hn.current.useReducer(t,e,n)};Ye.useRef=function(t){return hn.current.useRef(t)};Ye.useState=function(t){return hn.current.useState(t)};Ye.useSyncExternalStore=function(t,e,n){return hn.current.useSyncExternalStore(t,e,n)};Ye.useTransition=function(){return hn.current.useTransition()};Ye.version="18.3.1"});var pl=Ii((HA,Qm)=>{"use strict";Qm.exports=jm()});var cg=Ii(gt=>{"use strict";function qh(t,e){var n=t.length;t.push(e);e:for(;0<n;){var i=n-1>>>1,r=t[i];if(0<ml(r,e))t[i]=e,t[n]=r,n=i;else break e}}function Zn(t){return t.length===0?null:t[0]}function _l(t){if(t.length===0)return null;var e=t[0],n=t.pop();if(n!==e){t[0]=n;e:for(var i=0,r=t.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=t[o],l=o+1,c=t[l];if(0>ml(a,n))l<r&&0>ml(c,a)?(t[i]=c,t[l]=n,i=l):(t[i]=a,t[o]=n,i=o);else if(l<r&&0>ml(c,n))t[i]=c,t[l]=n,i=l;else break e}}return e}function ml(t,e){var n=t.sortIndex-e.sortIndex;return n!==0?n:t.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(eg=performance,gt.unstable_now=function(){return eg.now()}):(Gh=Date,tg=Gh.now(),gt.unstable_now=function(){return Gh.now()-tg});var eg,Gh,tg,hi=[],nr=[],Gy=1,On=null,tn=3,vl=!1,Hr=!1,Ro=!1,rg=typeof setTimeout=="function"?setTimeout:null,sg=typeof clearTimeout=="function"?clearTimeout:null,ng=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function Yh(t){for(var e=Zn(nr);e!==null;){if(e.callback===null)_l(nr);else if(e.startTime<=t)_l(nr),e.sortIndex=e.expirationTime,qh(hi,e);else break;e=Zn(nr)}}function Zh(t){if(Ro=!1,Yh(t),!Hr)if(Zn(hi)!==null)Hr=!0,Jh($h);else{var e=Zn(nr);e!==null&&Kh(Zh,e.startTime-t)}}function $h(t,e){Hr=!1,Ro&&(Ro=!1,sg(Po),Po=-1),vl=!0;var n=tn;try{for(Yh(e),On=Zn(hi);On!==null&&(!(On.expirationTime>e)||t&&!lg());){var i=On.callback;if(typeof i=="function"){On.callback=null,tn=On.priorityLevel;var r=i(On.expirationTime<=e);e=gt.unstable_now(),typeof r=="function"?On.callback=r:On===Zn(hi)&&_l(hi),Yh(e)}else _l(hi);On=Zn(hi)}if(On!==null)var s=!0;else{var o=Zn(nr);o!==null&&Kh(Zh,o.startTime-e),s=!1}return s}finally{On=null,tn=n,vl=!1}}var xl=!1,gl=null,Po=-1,og=5,ag=-1;function lg(){return!(gt.unstable_now()-ag<og)}function Wh(){if(gl!==null){var t=gt.unstable_now();ag=t;var e=!0;try{e=gl(!0,t)}finally{e?Co():(xl=!1,gl=null)}}else xl=!1}var Co;typeof ng=="function"?Co=function(){ng(Wh)}:typeof MessageChannel<"u"?(Xh=new MessageChannel,ig=Xh.port2,Xh.port1.onmessage=Wh,Co=function(){ig.postMessage(null)}):Co=function(){rg(Wh,0)};var Xh,ig;function Jh(t){gl=t,xl||(xl=!0,Co())}function Kh(t,e){Po=rg(function(){t(gt.unstable_now())},e)}gt.unstable_IdlePriority=5;gt.unstable_ImmediatePriority=1;gt.unstable_LowPriority=4;gt.unstable_NormalPriority=3;gt.unstable_Profiling=null;gt.unstable_UserBlockingPriority=2;gt.unstable_cancelCallback=function(t){t.callback=null};gt.unstable_continueExecution=function(){Hr||vl||(Hr=!0,Jh($h))};gt.unstable_forceFrameRate=function(t){0>t||125<t?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):og=0<t?Math.floor(1e3/t):5};gt.unstable_getCurrentPriorityLevel=function(){return tn};gt.unstable_getFirstCallbackNode=function(){return Zn(hi)};gt.unstable_next=function(t){switch(tn){case 1:case 2:case 3:var e=3;break;default:e=tn}var n=tn;tn=e;try{return t()}finally{tn=n}};gt.unstable_pauseExecution=function(){};gt.unstable_requestPaint=function(){};gt.unstable_runWithPriority=function(t,e){switch(t){case 1:case 2:case 3:case 4:case 5:break;default:t=3}var n=tn;tn=t;try{return e()}finally{tn=n}};gt.unstable_scheduleCallback=function(t,e,n){var i=gt.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,t){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=n+r,t={id:Gy++,callback:e,priorityLevel:t,startTime:n,expirationTime:r,sortIndex:-1},n>i?(t.sortIndex=n,qh(nr,t),Zn(hi)===null&&t===Zn(nr)&&(Ro?(sg(Po),Po=-1):Ro=!0,Kh(Zh,n-i))):(t.sortIndex=r,qh(hi,t),Hr||vl||(Hr=!0,Jh($h))),t};gt.unstable_shouldYield=lg;gt.unstable_wrapCallback=function(t){var e=tn;return function(){var n=tn;tn=e;try{return t.apply(this,arguments)}finally{tn=n}}}});var hg=Ii((WA,ug)=>{"use strict";ug.exports=cg()});var mv=Ii(Rn=>{"use strict";var Wy=pl(),An=hg();function oe(t){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+t,n=1;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n]);return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var v0=new Set,jo={};function ts(t,e){Os(t,e),Os(t+"Capture",e)}function Os(t,e){for(jo[t]=e,t=0;t<e.length;t++)v0.add(e[t])}var Oi=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),yd=Object.prototype.hasOwnProperty,Xy=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,dg={},fg={};function qy(t){return yd.call(fg,t)?!0:yd.call(dg,t)?!1:Xy.test(t)?fg[t]=!0:(dg[t]=!0,!1)}function Yy(t,e,n,i){if(n!==null&&n.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:n!==null?!n.acceptsBooleans:(t=t.toLowerCase().slice(0,5),t!=="data-"&&t!=="aria-");default:return!1}}function Zy(t,e,n,i){if(e===null||typeof e>"u"||Yy(t,e,n,i))return!0;if(i)return!1;if(n!==null)switch(n.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function pn(t,e,n,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=n,this.propertyName=t,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var $t={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t){$t[t]=new pn(t,0,!1,t,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(t){var e=t[0];$t[e]=new pn(e,1,!1,t[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(t){$t[t]=new pn(t,2,!1,t.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(t){$t[t]=new pn(t,2,!1,t,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t){$t[t]=new pn(t,3,!1,t.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(t){$t[t]=new pn(t,3,!0,t,null,!1,!1)});["capture","download"].forEach(function(t){$t[t]=new pn(t,4,!1,t,null,!1,!1)});["cols","rows","size","span"].forEach(function(t){$t[t]=new pn(t,6,!1,t,null,!1,!1)});["rowSpan","start"].forEach(function(t){$t[t]=new pn(t,5,!1,t.toLowerCase(),null,!1,!1)});var ff=/[\-:]([a-z])/g;function pf(t){return t[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t){var e=t.replace(ff,pf);$t[e]=new pn(e,1,!1,t,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t){var e=t.replace(ff,pf);$t[e]=new pn(e,1,!1,t,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(t){var e=t.replace(ff,pf);$t[e]=new pn(e,1,!1,t,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(t){$t[t]=new pn(t,1,!1,t.toLowerCase(),null,!1,!1)});$t.xlinkHref=new pn("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(t){$t[t]=new pn(t,1,!1,t.toLowerCase(),null,!0,!0)});function mf(t,e,n,i){var r=$t.hasOwnProperty(e)?$t[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(Zy(e,n,r,i)&&(n=null),i||r===null?qy(e)&&(n===null?t.removeAttribute(e):t.setAttribute(e,""+n)):r.mustUseProperty?t[r.propertyName]=n===null?r.type===3?!1:"":n:(e=r.attributeName,i=r.attributeNamespace,n===null?t.removeAttribute(e):(r=r.type,n=r===3||r===4&&n===!0?"":""+n,i?t.setAttributeNS(i,e,n):t.setAttribute(e,n))))}var Vi=Wy.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,yl=Symbol.for("react.element"),xs=Symbol.for("react.portal"),ys=Symbol.for("react.fragment"),gf=Symbol.for("react.strict_mode"),Sd=Symbol.for("react.profiler"),x0=Symbol.for("react.provider"),y0=Symbol.for("react.context"),_f=Symbol.for("react.forward_ref"),Md=Symbol.for("react.suspense"),wd=Symbol.for("react.suspense_list"),vf=Symbol.for("react.memo"),rr=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var S0=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var pg=Symbol.iterator;function Io(t){return t===null||typeof t!="object"?null:(t=pg&&t[pg]||t["@@iterator"],typeof t=="function"?t:null)}var Et=Object.assign,jh;function ko(t){if(jh===void 0)try{throw Error()}catch(n){var e=n.stack.trim().match(/\n( *(at )?)/);jh=e&&e[1]||""}return`
`+jh+t}var Qh=!1;function ed(t,e){if(!t||Qh)return"";Qh=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(c){var i=c}Reflect.construct(t,[],e)}else{try{e.call()}catch(c){i=c}t.call(e.prototype)}else{try{throw Error()}catch(c){i=c}t()}}catch(c){if(c&&i&&typeof c.stack=="string"){for(var r=c.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return t.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",t.displayName)),l}while(1<=o&&0<=a);break}}}finally{Qh=!1,Error.prepareStackTrace=n}return(t=t?t.displayName||t.name:"")?ko(t):""}function $y(t){switch(t.tag){case 5:return ko(t.type);case 16:return ko("Lazy");case 13:return ko("Suspense");case 19:return ko("SuspenseList");case 0:case 2:case 15:return t=ed(t.type,!1),t;case 11:return t=ed(t.type.render,!1),t;case 1:return t=ed(t.type,!0),t;default:return""}}function Ed(t){if(t==null)return null;if(typeof t=="function")return t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case ys:return"Fragment";case xs:return"Portal";case Sd:return"Profiler";case gf:return"StrictMode";case Md:return"Suspense";case wd:return"SuspenseList"}if(typeof t=="object")switch(t.$$typeof){case y0:return(t.displayName||"Context")+".Consumer";case x0:return(t._context.displayName||"Context")+".Provider";case _f:var e=t.render;return t=t.displayName,t||(t=e.displayName||e.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case vf:return e=t.displayName||null,e!==null?e:Ed(t.type)||"Memo";case rr:e=t._payload,t=t._init;try{return Ed(t(e))}catch{}}return null}function Jy(t){var e=t.type;switch(t.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return t=e.render,t=t.displayName||t.name||"",e.displayName||(t!==""?"ForwardRef("+t+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return Ed(e);case 8:return e===gf?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function vr(t){switch(typeof t){case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function M0(t){var e=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function Ky(t){var e=M0(t)?"checked":"value",n=Object.getOwnPropertyDescriptor(t.constructor.prototype,e),i=""+t[e];if(!t.hasOwnProperty(e)&&typeof n<"u"&&typeof n.get=="function"&&typeof n.set=="function"){var r=n.get,s=n.set;return Object.defineProperty(t,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(t,e,{enumerable:n.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){t._valueTracker=null,delete t[e]}}}}function Sl(t){t._valueTracker||(t._valueTracker=Ky(t))}function w0(t){if(!t)return!1;var e=t._valueTracker;if(!e)return!0;var n=e.getValue(),i="";return t&&(i=M0(t)?t.checked?"true":"false":t.value),t=i,t!==n?(e.setValue(t),!0):!1}function $l(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}function Td(t,e){var n=e.checked;return Et({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??t._wrapperState.initialChecked})}function mg(t,e){var n=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;n=vr(e.value!=null?e.value:n),t._wrapperState={initialChecked:i,initialValue:n,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function E0(t,e){e=e.checked,e!=null&&mf(t,"checked",e,!1)}function bd(t,e){E0(t,e);var n=vr(e.value),i=e.type;if(n!=null)i==="number"?(n===0&&t.value===""||t.value!=n)&&(t.value=""+n):t.value!==""+n&&(t.value=""+n);else if(i==="submit"||i==="reset"){t.removeAttribute("value");return}e.hasOwnProperty("value")?Ad(t,e.type,n):e.hasOwnProperty("defaultValue")&&Ad(t,e.type,vr(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(t.defaultChecked=!!e.defaultChecked)}function gg(t,e,n){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+t._wrapperState.initialValue,n||e===t.value||(t.value=e),t.defaultValue=e}n=t.name,n!==""&&(t.name=""),t.defaultChecked=!!t._wrapperState.initialChecked,n!==""&&(t.name=n)}function Ad(t,e,n){(e!=="number"||$l(t.ownerDocument)!==t)&&(n==null?t.defaultValue=""+t._wrapperState.initialValue:t.defaultValue!==""+n&&(t.defaultValue=""+n))}var zo=Array.isArray;function Is(t,e,n,i){if(t=t.options,e){e={};for(var r=0;r<n.length;r++)e["$"+n[r]]=!0;for(n=0;n<t.length;n++)r=e.hasOwnProperty("$"+t[n].value),t[n].selected!==r&&(t[n].selected=r),r&&i&&(t[n].defaultSelected=!0)}else{for(n=""+vr(n),e=null,r=0;r<t.length;r++){if(t[r].value===n){t[r].selected=!0,i&&(t[r].defaultSelected=!0);return}e!==null||t[r].disabled||(e=t[r])}e!==null&&(e.selected=!0)}}function Cd(t,e){if(e.dangerouslySetInnerHTML!=null)throw Error(oe(91));return Et({},e,{value:void 0,defaultValue:void 0,children:""+t._wrapperState.initialValue})}function _g(t,e){var n=e.value;if(n==null){if(n=e.children,e=e.defaultValue,n!=null){if(e!=null)throw Error(oe(92));if(zo(n)){if(1<n.length)throw Error(oe(93));n=n[0]}e=n}e==null&&(e=""),n=e}t._wrapperState={initialValue:vr(n)}}function T0(t,e){var n=vr(e.value),i=vr(e.defaultValue);n!=null&&(n=""+n,n!==t.value&&(t.value=n),e.defaultValue==null&&t.defaultValue!==n&&(t.defaultValue=n)),i!=null&&(t.defaultValue=""+i)}function vg(t){var e=t.textContent;e===t._wrapperState.initialValue&&e!==""&&e!==null&&(t.value=e)}function b0(t){switch(t){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function Rd(t,e){return t==null||t==="http://www.w3.org/1999/xhtml"?b0(e):t==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":t}var Ml,A0=(function(t){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,n,i,r){MSApp.execUnsafeLocalFunction(function(){return t(e,n,i,r)})}:t})(function(t,e){if(t.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in t)t.innerHTML=e;else{for(Ml=Ml||document.createElement("div"),Ml.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=Ml.firstChild;t.firstChild;)t.removeChild(t.firstChild);for(;e.firstChild;)t.appendChild(e.firstChild)}});function Qo(t,e){if(e){var n=t.firstChild;if(n&&n===t.lastChild&&n.nodeType===3){n.nodeValue=e;return}}t.textContent=e}var Go={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},jy=["Webkit","ms","Moz","O"];Object.keys(Go).forEach(function(t){jy.forEach(function(e){e=e+t.charAt(0).toUpperCase()+t.substring(1),Go[e]=Go[t]})});function C0(t,e,n){return e==null||typeof e=="boolean"||e===""?"":n||typeof e!="number"||e===0||Go.hasOwnProperty(t)&&Go[t]?(""+e).trim():e+"px"}function R0(t,e){t=t.style;for(var n in e)if(e.hasOwnProperty(n)){var i=n.indexOf("--")===0,r=C0(n,e[n],i);n==="float"&&(n="cssFloat"),i?t.setProperty(n,r):t[n]=r}}var Qy=Et({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function Pd(t,e){if(e){if(Qy[t]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(oe(137,t));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(oe(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(oe(61))}if(e.style!=null&&typeof e.style!="object")throw Error(oe(62))}}function Id(t,e){if(t.indexOf("-")===-1)return typeof e.is=="string";switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var Ld=null;function xf(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var Nd=null,Ls=null,Ns=null;function xg(t){if(t=_a(t)){if(typeof Nd!="function")throw Error(oe(280));var e=t.stateNode;e&&(e=wc(e),Nd(t.stateNode,t.type,e))}}function P0(t){Ls?Ns?Ns.push(t):Ns=[t]:Ls=t}function I0(){if(Ls){var t=Ls,e=Ns;if(Ns=Ls=null,xg(t),e)for(t=0;t<e.length;t++)xg(e[t])}}function L0(t,e){return t(e)}function N0(){}var td=!1;function D0(t,e,n){if(td)return t(e,n);td=!0;try{return L0(t,e,n)}finally{td=!1,(Ls!==null||Ns!==null)&&(N0(),I0())}}function ea(t,e){var n=t.stateNode;if(n===null)return null;var i=wc(n);if(i===null)return null;n=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(t=t.type,i=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!i;break e;default:t=!1}if(t)return null;if(n&&typeof n!="function")throw Error(oe(231,e,typeof n));return n}var Dd=!1;if(Oi)try{_s={},Object.defineProperty(_s,"passive",{get:function(){Dd=!0}}),window.addEventListener("test",_s,_s),window.removeEventListener("test",_s,_s)}catch{Dd=!1}var _s;function eS(t,e,n,i,r,s,o,a,l){var c=Array.prototype.slice.call(arguments,3);try{e.apply(n,c)}catch(d){this.onError(d)}}var Wo=!1,Jl=null,Kl=!1,Ud=null,tS={onError:function(t){Wo=!0,Jl=t}};function nS(t,e,n,i,r,s,o,a,l){Wo=!1,Jl=null,eS.apply(tS,arguments)}function iS(t,e,n,i,r,s,o,a,l){if(nS.apply(this,arguments),Wo){if(Wo){var c=Jl;Wo=!1,Jl=null}else throw Error(oe(198));Kl||(Kl=!0,Ud=c)}}function ns(t){var e=t,n=t;if(t.alternate)for(;e.return;)e=e.return;else{t=e;do e=t,(e.flags&4098)!==0&&(n=e.return),t=e.return;while(t)}return e.tag===3?n:null}function U0(t){if(t.tag===13){var e=t.memoizedState;if(e===null&&(t=t.alternate,t!==null&&(e=t.memoizedState)),e!==null)return e.dehydrated}return null}function yg(t){if(ns(t)!==t)throw Error(oe(188))}function rS(t){var e=t.alternate;if(!e){if(e=ns(t),e===null)throw Error(oe(188));return e!==t?null:t}for(var n=t,i=e;;){var r=n.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){n=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===n)return yg(r),t;if(s===i)return yg(r),e;s=s.sibling}throw Error(oe(188))}if(n.return!==i.return)n=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===n){o=!0,n=r,i=s;break}if(a===i){o=!0,i=r,n=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===n){o=!0,n=s,i=r;break}if(a===i){o=!0,i=s,n=r;break}a=a.sibling}if(!o)throw Error(oe(189))}}if(n.alternate!==i)throw Error(oe(190))}if(n.tag!==3)throw Error(oe(188));return n.stateNode.current===n?t:e}function F0(t){return t=rS(t),t!==null?O0(t):null}function O0(t){if(t.tag===5||t.tag===6)return t;for(t=t.child;t!==null;){var e=O0(t);if(e!==null)return e;t=t.sibling}return null}var B0=An.unstable_scheduleCallback,Sg=An.unstable_cancelCallback,sS=An.unstable_shouldYield,oS=An.unstable_requestPaint,Nt=An.unstable_now,aS=An.unstable_getCurrentPriorityLevel,yf=An.unstable_ImmediatePriority,k0=An.unstable_UserBlockingPriority,jl=An.unstable_NormalPriority,lS=An.unstable_LowPriority,z0=An.unstable_IdlePriority,xc=null,mi=null;function cS(t){if(mi&&typeof mi.onCommitFiberRoot=="function")try{mi.onCommitFiberRoot(xc,t,void 0,(t.current.flags&128)===128)}catch{}}var Qn=Math.clz32?Math.clz32:dS,uS=Math.log,hS=Math.LN2;function dS(t){return t>>>=0,t===0?32:31-(uS(t)/hS|0)|0}var wl=64,El=4194304;function Vo(t){switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return t&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return t}}function Ql(t,e){var n=t.pendingLanes;if(n===0)return 0;var i=0,r=t.suspendedLanes,s=t.pingedLanes,o=n&268435455;if(o!==0){var a=o&~r;a!==0?i=Vo(a):(s&=o,s!==0&&(i=Vo(s)))}else o=n&~r,o!==0?i=Vo(o):s!==0&&(i=Vo(s));if(i===0)return 0;if(e!==0&&e!==i&&(e&r)===0&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if((i&4)!==0&&(i|=n&16),e=t.entangledLanes,e!==0)for(t=t.entanglements,e&=i;0<e;)n=31-Qn(e),r=1<<n,i|=t[n],e&=~r;return i}function fS(t,e){switch(t){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function pS(t,e){for(var n=t.suspendedLanes,i=t.pingedLanes,r=t.expirationTimes,s=t.pendingLanes;0<s;){var o=31-Qn(s),a=1<<o,l=r[o];l===-1?((a&n)===0||(a&i)!==0)&&(r[o]=fS(a,e)):l<=e&&(t.expiredLanes|=a),s&=~a}}function Fd(t){return t=t.pendingLanes&-1073741825,t!==0?t:t&1073741824?1073741824:0}function V0(){var t=wl;return wl<<=1,(wl&4194240)===0&&(wl=64),t}function nd(t){for(var e=[],n=0;31>n;n++)e.push(t);return e}function ma(t,e,n){t.pendingLanes|=e,e!==536870912&&(t.suspendedLanes=0,t.pingedLanes=0),t=t.eventTimes,e=31-Qn(e),t[e]=n}function mS(t,e){var n=t.pendingLanes&~e;t.pendingLanes=e,t.suspendedLanes=0,t.pingedLanes=0,t.expiredLanes&=e,t.mutableReadLanes&=e,t.entangledLanes&=e,e=t.entanglements;var i=t.eventTimes;for(t=t.expirationTimes;0<n;){var r=31-Qn(n),s=1<<r;e[r]=0,i[r]=-1,t[r]=-1,n&=~s}}function Sf(t,e){var n=t.entangledLanes|=e;for(t=t.entanglements;n;){var i=31-Qn(n),r=1<<i;r&e|t[i]&e&&(t[i]|=e),n&=~r}}var at=0;function H0(t){return t&=-t,1<t?4<t?(t&268435455)!==0?16:536870912:4:1}var G0,Mf,W0,X0,q0,Od=!1,Tl=[],ur=null,hr=null,dr=null,ta=new Map,na=new Map,or=[],gS="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function Mg(t,e){switch(t){case"focusin":case"focusout":ur=null;break;case"dragenter":case"dragleave":hr=null;break;case"mouseover":case"mouseout":dr=null;break;case"pointerover":case"pointerout":ta.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":na.delete(e.pointerId)}}function Lo(t,e,n,i,r,s){return t===null||t.nativeEvent!==s?(t={blockedOn:e,domEventName:n,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=_a(e),e!==null&&Mf(e)),t):(t.eventSystemFlags|=i,e=t.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),t)}function _S(t,e,n,i,r){switch(e){case"focusin":return ur=Lo(ur,t,e,n,i,r),!0;case"dragenter":return hr=Lo(hr,t,e,n,i,r),!0;case"mouseover":return dr=Lo(dr,t,e,n,i,r),!0;case"pointerover":var s=r.pointerId;return ta.set(s,Lo(ta.get(s)||null,t,e,n,i,r)),!0;case"gotpointercapture":return s=r.pointerId,na.set(s,Lo(na.get(s)||null,t,e,n,i,r)),!0}return!1}function Y0(t){var e=Xr(t.target);if(e!==null){var n=ns(e);if(n!==null){if(e=n.tag,e===13){if(e=U0(n),e!==null){t.blockedOn=e,q0(t.priority,function(){W0(n)});return}}else if(e===3&&n.stateNode.current.memoizedState.isDehydrated){t.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}t.blockedOn=null}function kl(t){if(t.blockedOn!==null)return!1;for(var e=t.targetContainers;0<e.length;){var n=Bd(t.domEventName,t.eventSystemFlags,e[0],t.nativeEvent);if(n===null){n=t.nativeEvent;var i=new n.constructor(n.type,n);Ld=i,n.target.dispatchEvent(i),Ld=null}else return e=_a(n),e!==null&&Mf(e),t.blockedOn=n,!1;e.shift()}return!0}function wg(t,e,n){kl(t)&&n.delete(e)}function vS(){Od=!1,ur!==null&&kl(ur)&&(ur=null),hr!==null&&kl(hr)&&(hr=null),dr!==null&&kl(dr)&&(dr=null),ta.forEach(wg),na.forEach(wg)}function No(t,e){t.blockedOn===e&&(t.blockedOn=null,Od||(Od=!0,An.unstable_scheduleCallback(An.unstable_NormalPriority,vS)))}function ia(t){function e(r){return No(r,t)}if(0<Tl.length){No(Tl[0],t);for(var n=1;n<Tl.length;n++){var i=Tl[n];i.blockedOn===t&&(i.blockedOn=null)}}for(ur!==null&&No(ur,t),hr!==null&&No(hr,t),dr!==null&&No(dr,t),ta.forEach(e),na.forEach(e),n=0;n<or.length;n++)i=or[n],i.blockedOn===t&&(i.blockedOn=null);for(;0<or.length&&(n=or[0],n.blockedOn===null);)Y0(n),n.blockedOn===null&&or.shift()}var Ds=Vi.ReactCurrentBatchConfig,ec=!0;function xS(t,e,n,i){var r=at,s=Ds.transition;Ds.transition=null;try{at=1,wf(t,e,n,i)}finally{at=r,Ds.transition=s}}function yS(t,e,n,i){var r=at,s=Ds.transition;Ds.transition=null;try{at=4,wf(t,e,n,i)}finally{at=r,Ds.transition=s}}function wf(t,e,n,i){if(ec){var r=Bd(t,e,n,i);if(r===null)cd(t,e,i,tc,n),Mg(t,i);else if(_S(r,t,e,n,i))i.stopPropagation();else if(Mg(t,i),e&4&&-1<gS.indexOf(t)){for(;r!==null;){var s=_a(r);if(s!==null&&G0(s),s=Bd(t,e,n,i),s===null&&cd(t,e,i,tc,n),s===r)break;r=s}r!==null&&i.stopPropagation()}else cd(t,e,i,null,n)}}var tc=null;function Bd(t,e,n,i){if(tc=null,t=xf(i),t=Xr(t),t!==null)if(e=ns(t),e===null)t=null;else if(n=e.tag,n===13){if(t=U0(e),t!==null)return t;t=null}else if(n===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;t=null}else e!==t&&(t=null);return tc=t,null}function Z0(t){switch(t){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(aS()){case yf:return 1;case k0:return 4;case jl:case lS:return 16;case z0:return 536870912;default:return 16}default:return 16}}var lr=null,Ef=null,zl=null;function $0(){if(zl)return zl;var t,e=Ef,n=e.length,i,r="value"in lr?lr.value:lr.textContent,s=r.length;for(t=0;t<n&&e[t]===r[t];t++);var o=n-t;for(i=1;i<=o&&e[n-i]===r[s-i];i++);return zl=r.slice(t,1<i?1-i:void 0)}function Vl(t){var e=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&e===13&&(t=13)):t=e,t===10&&(t=13),32<=t||t===13?t:0}function bl(){return!0}function Eg(){return!1}function Cn(t){function e(n,i,r,s,o){this._reactName=n,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in t)t.hasOwnProperty(a)&&(n=t[a],this[a]=n?n(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?bl:Eg,this.isPropagationStopped=Eg,this}return Et(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=bl)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=bl)},persist:function(){},isPersistent:bl}),e}var Ws={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},Tf=Cn(Ws),ga=Et({},Ws,{view:0,detail:0}),SS=Cn(ga),id,rd,Do,yc=Et({},ga,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:bf,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==Do&&(Do&&t.type==="mousemove"?(id=t.screenX-Do.screenX,rd=t.screenY-Do.screenY):rd=id=0,Do=t),id)},movementY:function(t){return"movementY"in t?t.movementY:rd}}),Tg=Cn(yc),MS=Et({},yc,{dataTransfer:0}),wS=Cn(MS),ES=Et({},ga,{relatedTarget:0}),sd=Cn(ES),TS=Et({},Ws,{animationName:0,elapsedTime:0,pseudoElement:0}),bS=Cn(TS),AS=Et({},Ws,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),CS=Cn(AS),RS=Et({},Ws,{data:0}),bg=Cn(RS),PS={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},IS={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},LS={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function NS(t){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(t):(t=LS[t])?!!e[t]:!1}function bf(){return NS}var DS=Et({},ga,{key:function(t){if(t.key){var e=PS[t.key]||t.key;if(e!=="Unidentified")return e}return t.type==="keypress"?(t=Vl(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?IS[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:bf,charCode:function(t){return t.type==="keypress"?Vl(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?Vl(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),US=Cn(DS),FS=Et({},yc,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),Ag=Cn(FS),OS=Et({},ga,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:bf}),BS=Cn(OS),kS=Et({},Ws,{propertyName:0,elapsedTime:0,pseudoElement:0}),zS=Cn(kS),VS=Et({},yc,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),HS=Cn(VS),GS=[9,13,27,32],Af=Oi&&"CompositionEvent"in window,Xo=null;Oi&&"documentMode"in document&&(Xo=document.documentMode);var WS=Oi&&"TextEvent"in window&&!Xo,J0=Oi&&(!Af||Xo&&8<Xo&&11>=Xo),Cg=" ",Rg=!1;function K0(t,e){switch(t){case"keyup":return GS.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function j0(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var Ss=!1;function XS(t,e){switch(t){case"compositionend":return j0(e);case"keypress":return e.which!==32?null:(Rg=!0,Cg);case"textInput":return t=e.data,t===Cg&&Rg?null:t;default:return null}}function qS(t,e){if(Ss)return t==="compositionend"||!Af&&K0(t,e)?(t=$0(),zl=Ef=lr=null,Ss=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return J0&&e.locale!=="ko"?null:e.data;default:return null}}var YS={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function Pg(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e==="input"?!!YS[t.type]:e==="textarea"}function Q0(t,e,n,i){P0(i),e=nc(e,"onChange"),0<e.length&&(n=new Tf("onChange","change",null,n,i),t.push({event:n,listeners:e}))}var qo=null,ra=null;function ZS(t){u_(t,0)}function Sc(t){var e=Es(t);if(w0(e))return t}function $S(t,e){if(t==="change")return e}var e_=!1;Oi&&(Oi?(Cl="oninput"in document,Cl||(od=document.createElement("div"),od.setAttribute("oninput","return;"),Cl=typeof od.oninput=="function"),Al=Cl):Al=!1,e_=Al&&(!document.documentMode||9<document.documentMode));var Al,Cl,od;function Ig(){qo&&(qo.detachEvent("onpropertychange",t_),ra=qo=null)}function t_(t){if(t.propertyName==="value"&&Sc(ra)){var e=[];Q0(e,ra,t,xf(t)),D0(ZS,e)}}function JS(t,e,n){t==="focusin"?(Ig(),qo=e,ra=n,qo.attachEvent("onpropertychange",t_)):t==="focusout"&&Ig()}function KS(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return Sc(ra)}function jS(t,e){if(t==="click")return Sc(e)}function QS(t,e){if(t==="input"||t==="change")return Sc(e)}function eM(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var ti=typeof Object.is=="function"?Object.is:eM;function sa(t,e){if(ti(t,e))return!0;if(typeof t!="object"||t===null||typeof e!="object"||e===null)return!1;var n=Object.keys(t),i=Object.keys(e);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var r=n[i];if(!yd.call(e,r)||!ti(t[r],e[r]))return!1}return!0}function Lg(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function Ng(t,e){var n=Lg(t);t=0;for(var i;n;){if(n.nodeType===3){if(i=t+n.textContent.length,t<=e&&i>=e)return{node:n,offset:e-t};t=i}e:{for(;n;){if(n.nextSibling){n=n.nextSibling;break e}n=n.parentNode}n=void 0}n=Lg(n)}}function n_(t,e){return t&&e?t===e?!0:t&&t.nodeType===3?!1:e&&e.nodeType===3?n_(t,e.parentNode):"contains"in t?t.contains(e):t.compareDocumentPosition?!!(t.compareDocumentPosition(e)&16):!1:!1}function i_(){for(var t=window,e=$l();e instanceof t.HTMLIFrameElement;){try{var n=typeof e.contentWindow.location.href=="string"}catch{n=!1}if(n)t=e.contentWindow;else break;e=$l(t.document)}return e}function Cf(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e&&(e==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||e==="textarea"||t.contentEditable==="true")}function tM(t){var e=i_(),n=t.focusedElem,i=t.selectionRange;if(e!==n&&n&&n.ownerDocument&&n_(n.ownerDocument.documentElement,n)){if(i!==null&&Cf(n)){if(e=i.start,t=i.end,t===void 0&&(t=e),"selectionStart"in n)n.selectionStart=e,n.selectionEnd=Math.min(t,n.value.length);else if(t=(e=n.ownerDocument||document)&&e.defaultView||window,t.getSelection){t=t.getSelection();var r=n.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!t.extend&&s>i&&(r=i,i=s,s=r),r=Ng(n,s);var o=Ng(n,i);r&&o&&(t.rangeCount!==1||t.anchorNode!==r.node||t.anchorOffset!==r.offset||t.focusNode!==o.node||t.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),t.removeAllRanges(),s>i?(t.addRange(e),t.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),t.addRange(e)))}}for(e=[],t=n;t=t.parentNode;)t.nodeType===1&&e.push({element:t,left:t.scrollLeft,top:t.scrollTop});for(typeof n.focus=="function"&&n.focus(),n=0;n<e.length;n++)t=e[n],t.element.scrollLeft=t.left,t.element.scrollTop=t.top}}var nM=Oi&&"documentMode"in document&&11>=document.documentMode,Ms=null,kd=null,Yo=null,zd=!1;function Dg(t,e,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;zd||Ms==null||Ms!==$l(i)||(i=Ms,"selectionStart"in i&&Cf(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),Yo&&sa(Yo,i)||(Yo=i,i=nc(kd,"onSelect"),0<i.length&&(e=new Tf("onSelect","select",null,e,n),t.push({event:e,listeners:i}),e.target=Ms)))}function Rl(t,e){var n={};return n[t.toLowerCase()]=e.toLowerCase(),n["Webkit"+t]="webkit"+e,n["Moz"+t]="moz"+e,n}var ws={animationend:Rl("Animation","AnimationEnd"),animationiteration:Rl("Animation","AnimationIteration"),animationstart:Rl("Animation","AnimationStart"),transitionend:Rl("Transition","TransitionEnd")},ad={},r_={};Oi&&(r_=document.createElement("div").style,"AnimationEvent"in window||(delete ws.animationend.animation,delete ws.animationiteration.animation,delete ws.animationstart.animation),"TransitionEvent"in window||delete ws.transitionend.transition);function Mc(t){if(ad[t])return ad[t];if(!ws[t])return t;var e=ws[t],n;for(n in e)if(e.hasOwnProperty(n)&&n in r_)return ad[t]=e[n];return t}var s_=Mc("animationend"),o_=Mc("animationiteration"),a_=Mc("animationstart"),l_=Mc("transitionend"),c_=new Map,Ug="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function yr(t,e){c_.set(t,e),ts(e,[t])}for(Pl=0;Pl<Ug.length;Pl++)Il=Ug[Pl],Fg=Il.toLowerCase(),Og=Il[0].toUpperCase()+Il.slice(1),yr(Fg,"on"+Og);var Il,Fg,Og,Pl;yr(s_,"onAnimationEnd");yr(o_,"onAnimationIteration");yr(a_,"onAnimationStart");yr("dblclick","onDoubleClick");yr("focusin","onFocus");yr("focusout","onBlur");yr(l_,"onTransitionEnd");Os("onMouseEnter",["mouseout","mouseover"]);Os("onMouseLeave",["mouseout","mouseover"]);Os("onPointerEnter",["pointerout","pointerover"]);Os("onPointerLeave",["pointerout","pointerover"]);ts("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));ts("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));ts("onBeforeInput",["compositionend","keypress","textInput","paste"]);ts("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));ts("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));ts("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var Ho="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),iM=new Set("cancel close invalid load scroll toggle".split(" ").concat(Ho));function Bg(t,e,n){var i=t.type||"unknown-event";t.currentTarget=n,iS(i,e,void 0,t),t.currentTarget=null}function u_(t,e){e=(e&4)!==0;for(var n=0;n<t.length;n++){var i=t[n],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,c=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;Bg(r,a,c),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,c=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;Bg(r,a,c),s=l}}}if(Kl)throw t=Ud,Kl=!1,Ud=null,t}function vt(t,e){var n=e[Xd];n===void 0&&(n=e[Xd]=new Set);var i=t+"__bubble";n.has(i)||(h_(e,t,2,!1),n.add(i))}function ld(t,e,n){var i=0;e&&(i|=4),h_(n,t,i,e)}var Ll="_reactListening"+Math.random().toString(36).slice(2);function oa(t){if(!t[Ll]){t[Ll]=!0,v0.forEach(function(n){n!=="selectionchange"&&(iM.has(n)||ld(n,!1,t),ld(n,!0,t))});var e=t.nodeType===9?t:t.ownerDocument;e===null||e[Ll]||(e[Ll]=!0,ld("selectionchange",!1,e))}}function h_(t,e,n,i){switch(Z0(e)){case 1:var r=xS;break;case 4:r=yS;break;default:r=wf}n=r.bind(null,e,n,t),r=void 0,!Dd||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?t.addEventListener(e,n,{capture:!0,passive:r}):t.addEventListener(e,n,!0):r!==void 0?t.addEventListener(e,n,{passive:r}):t.addEventListener(e,n,!1)}function cd(t,e,n,i,r){var s=i;if((e&1)===0&&(e&2)===0&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=Xr(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}D0(function(){var c=s,d=xf(n),f=[];e:{var h=c_.get(t);if(h!==void 0){var p=Tf,_=t;switch(t){case"keypress":if(Vl(n)===0)break e;case"keydown":case"keyup":p=US;break;case"focusin":_="focus",p=sd;break;case"focusout":_="blur",p=sd;break;case"beforeblur":case"afterblur":p=sd;break;case"click":if(n.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":p=Tg;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":p=wS;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":p=BS;break;case s_:case o_:case a_:p=bS;break;case l_:p=zS;break;case"scroll":p=SS;break;case"wheel":p=HS;break;case"copy":case"cut":case"paste":p=CS;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":p=Ag}var S=(e&4)!==0,g=!S&&t==="scroll",u=S?h!==null?h+"Capture":null:h;S=[];for(var m=c,v;m!==null;){v=m;var M=v.stateNode;if(v.tag===5&&M!==null&&(v=M,u!==null&&(M=ea(m,u),M!=null&&S.push(aa(m,M,v)))),g)break;m=m.return}0<S.length&&(h=new p(h,_,null,n,d),f.push({event:h,listeners:S}))}}if((e&7)===0){e:{if(h=t==="mouseover"||t==="pointerover",p=t==="mouseout"||t==="pointerout",h&&n!==Ld&&(_=n.relatedTarget||n.fromElement)&&(Xr(_)||_[Bi]))break e;if((p||h)&&(h=d.window===d?d:(h=d.ownerDocument)?h.defaultView||h.parentWindow:window,p?(_=n.relatedTarget||n.toElement,p=c,_=_?Xr(_):null,_!==null&&(g=ns(_),_!==g||_.tag!==5&&_.tag!==6)&&(_=null)):(p=null,_=c),p!==_)){if(S=Tg,M="onMouseLeave",u="onMouseEnter",m="mouse",(t==="pointerout"||t==="pointerover")&&(S=Ag,M="onPointerLeave",u="onPointerEnter",m="pointer"),g=p==null?h:Es(p),v=_==null?h:Es(_),h=new S(M,m+"leave",p,n,d),h.target=g,h.relatedTarget=v,M=null,Xr(d)===c&&(S=new S(u,m+"enter",_,n,d),S.target=v,S.relatedTarget=g,M=S),g=M,p&&_)t:{for(S=p,u=_,m=0,v=S;v;v=vs(v))m++;for(v=0,M=u;M;M=vs(M))v++;for(;0<m-v;)S=vs(S),m--;for(;0<v-m;)u=vs(u),v--;for(;m--;){if(S===u||u!==null&&S===u.alternate)break t;S=vs(S),u=vs(u)}S=null}else S=null;p!==null&&kg(f,h,p,S,!1),_!==null&&g!==null&&kg(f,g,_,S,!0)}}e:{if(h=c?Es(c):window,p=h.nodeName&&h.nodeName.toLowerCase(),p==="select"||p==="input"&&h.type==="file")var A=$S;else if(Pg(h))if(e_)A=QS;else{A=KS;var E=JS}else(p=h.nodeName)&&p.toLowerCase()==="input"&&(h.type==="checkbox"||h.type==="radio")&&(A=jS);if(A&&(A=A(t,c))){Q0(f,A,n,d);break e}E&&E(t,h,c),t==="focusout"&&(E=h._wrapperState)&&E.controlled&&h.type==="number"&&Ad(h,"number",h.value)}switch(E=c?Es(c):window,t){case"focusin":(Pg(E)||E.contentEditable==="true")&&(Ms=E,kd=c,Yo=null);break;case"focusout":Yo=kd=Ms=null;break;case"mousedown":zd=!0;break;case"contextmenu":case"mouseup":case"dragend":zd=!1,Dg(f,n,d);break;case"selectionchange":if(nM)break;case"keydown":case"keyup":Dg(f,n,d)}var P;if(Af)e:{switch(t){case"compositionstart":var x="onCompositionStart";break e;case"compositionend":x="onCompositionEnd";break e;case"compositionupdate":x="onCompositionUpdate";break e}x=void 0}else Ss?K0(t,n)&&(x="onCompositionEnd"):t==="keydown"&&n.keyCode===229&&(x="onCompositionStart");x&&(J0&&n.locale!=="ko"&&(Ss||x!=="onCompositionStart"?x==="onCompositionEnd"&&Ss&&(P=$0()):(lr=d,Ef="value"in lr?lr.value:lr.textContent,Ss=!0)),E=nc(c,x),0<E.length&&(x=new bg(x,t,null,n,d),f.push({event:x,listeners:E}),P?x.data=P:(P=j0(n),P!==null&&(x.data=P)))),(P=WS?XS(t,n):qS(t,n))&&(c=nc(c,"onBeforeInput"),0<c.length&&(d=new bg("onBeforeInput","beforeinput",null,n,d),f.push({event:d,listeners:c}),d.data=P))}u_(f,e)})}function aa(t,e,n){return{instance:t,listener:e,currentTarget:n}}function nc(t,e){for(var n=e+"Capture",i=[];t!==null;){var r=t,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=ea(t,n),s!=null&&i.unshift(aa(t,s,r)),s=ea(t,e),s!=null&&i.push(aa(t,s,r))),t=t.return}return i}function vs(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5);return t||null}function kg(t,e,n,i,r){for(var s=e._reactName,o=[];n!==null&&n!==i;){var a=n,l=a.alternate,c=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&c!==null&&(a=c,r?(l=ea(n,s),l!=null&&o.unshift(aa(n,l,a))):r||(l=ea(n,s),l!=null&&o.push(aa(n,l,a)))),n=n.return}o.length!==0&&t.push({event:e,listeners:o})}var rM=/\r\n?/g,sM=/\u0000|\uFFFD/g;function zg(t){return(typeof t=="string"?t:""+t).replace(rM,`
`).replace(sM,"")}function Nl(t,e,n){if(e=zg(e),zg(t)!==e&&n)throw Error(oe(425))}function ic(){}var Vd=null,Hd=null;function Gd(t,e){return t==="textarea"||t==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var Wd=typeof setTimeout=="function"?setTimeout:void 0,oM=typeof clearTimeout=="function"?clearTimeout:void 0,Vg=typeof Promise=="function"?Promise:void 0,aM=typeof queueMicrotask=="function"?queueMicrotask:typeof Vg<"u"?function(t){return Vg.resolve(null).then(t).catch(lM)}:Wd;function lM(t){setTimeout(function(){throw t})}function ud(t,e){var n=e,i=0;do{var r=n.nextSibling;if(t.removeChild(n),r&&r.nodeType===8)if(n=r.data,n==="/$"){if(i===0){t.removeChild(r),ia(e);return}i--}else n!=="$"&&n!=="$?"&&n!=="$!"||i++;n=r}while(n);ia(e)}function fr(t){for(;t!=null;t=t.nextSibling){var e=t.nodeType;if(e===1||e===3)break;if(e===8){if(e=t.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return t}function Hg(t){t=t.previousSibling;for(var e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="$"||n==="$!"||n==="$?"){if(e===0)return t;e--}else n==="/$"&&e++}t=t.previousSibling}return null}var Xs=Math.random().toString(36).slice(2),pi="__reactFiber$"+Xs,la="__reactProps$"+Xs,Bi="__reactContainer$"+Xs,Xd="__reactEvents$"+Xs,cM="__reactListeners$"+Xs,uM="__reactHandles$"+Xs;function Xr(t){var e=t[pi];if(e)return e;for(var n=t.parentNode;n;){if(e=n[Bi]||n[pi]){if(n=e.alternate,e.child!==null||n!==null&&n.child!==null)for(t=Hg(t);t!==null;){if(n=t[pi])return n;t=Hg(t)}return e}t=n,n=t.parentNode}return null}function _a(t){return t=t[pi]||t[Bi],!t||t.tag!==5&&t.tag!==6&&t.tag!==13&&t.tag!==3?null:t}function Es(t){if(t.tag===5||t.tag===6)return t.stateNode;throw Error(oe(33))}function wc(t){return t[la]||null}var qd=[],Ts=-1;function Sr(t){return{current:t}}function xt(t){0>Ts||(t.current=qd[Ts],qd[Ts]=null,Ts--)}function _t(t,e){Ts++,qd[Ts]=t.current,t.current=e}var xr={},on=Sr(xr),vn=Sr(!1),Jr=xr;function Bs(t,e){var n=t.type.contextTypes;if(!n)return xr;var i=t.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in n)r[s]=e[s];return i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=e,t.__reactInternalMemoizedMaskedChildContext=r),r}function xn(t){return t=t.childContextTypes,t!=null}function rc(){xt(vn),xt(on)}function Gg(t,e,n){if(on.current!==xr)throw Error(oe(168));_t(on,e),_t(vn,n)}function d_(t,e,n){var i=t.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return n;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(oe(108,Jy(t)||"Unknown",r));return Et({},n,i)}function sc(t){return t=(t=t.stateNode)&&t.__reactInternalMemoizedMergedChildContext||xr,Jr=on.current,_t(on,t),_t(vn,vn.current),!0}function Wg(t,e,n){var i=t.stateNode;if(!i)throw Error(oe(169));n?(t=d_(t,e,Jr),i.__reactInternalMemoizedMergedChildContext=t,xt(vn),xt(on),_t(on,t)):xt(vn),_t(vn,n)}var Ni=null,Ec=!1,hd=!1;function f_(t){Ni===null?Ni=[t]:Ni.push(t)}function hM(t){Ec=!0,f_(t)}function Mr(){if(!hd&&Ni!==null){hd=!0;var t=0,e=at;try{var n=Ni;for(at=1;t<n.length;t++){var i=n[t];do i=i(!0);while(i!==null)}Ni=null,Ec=!1}catch(r){throw Ni!==null&&(Ni=Ni.slice(t+1)),B0(yf,Mr),r}finally{at=e,hd=!1}}return null}var bs=[],As=0,oc=null,ac=0,Bn=[],kn=0,Kr=null,Di=1,Ui="";function Gr(t,e){bs[As++]=ac,bs[As++]=oc,oc=t,ac=e}function p_(t,e,n){Bn[kn++]=Di,Bn[kn++]=Ui,Bn[kn++]=Kr,Kr=t;var i=Di;t=Ui;var r=32-Qn(i)-1;i&=~(1<<r),n+=1;var s=32-Qn(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,Di=1<<32-Qn(e)+r|n<<r|i,Ui=s+t}else Di=1<<s|n<<r|i,Ui=t}function Rf(t){t.return!==null&&(Gr(t,1),p_(t,1,0))}function Pf(t){for(;t===oc;)oc=bs[--As],bs[As]=null,ac=bs[--As],bs[As]=null;for(;t===Kr;)Kr=Bn[--kn],Bn[kn]=null,Ui=Bn[--kn],Bn[kn]=null,Di=Bn[--kn],Bn[kn]=null}var bn=null,Tn=null,St=!1,jn=null;function m_(t,e){var n=zn(5,null,null,0);n.elementType="DELETED",n.stateNode=e,n.return=t,e=t.deletions,e===null?(t.deletions=[n],t.flags|=16):e.push(n)}function Xg(t,e){switch(t.tag){case 5:var n=t.type;return e=e.nodeType!==1||n.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(t.stateNode=e,bn=t,Tn=fr(e.firstChild),!0):!1;case 6:return e=t.pendingProps===""||e.nodeType!==3?null:e,e!==null?(t.stateNode=e,bn=t,Tn=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(n=Kr!==null?{id:Di,overflow:Ui}:null,t.memoizedState={dehydrated:e,treeContext:n,retryLane:1073741824},n=zn(18,null,null,0),n.stateNode=e,n.return=t,t.child=n,bn=t,Tn=null,!0):!1;default:return!1}}function Yd(t){return(t.mode&1)!==0&&(t.flags&128)===0}function Zd(t){if(St){var e=Tn;if(e){var n=e;if(!Xg(t,e)){if(Yd(t))throw Error(oe(418));e=fr(n.nextSibling);var i=bn;e&&Xg(t,e)?m_(i,n):(t.flags=t.flags&-4097|2,St=!1,bn=t)}}else{if(Yd(t))throw Error(oe(418));t.flags=t.flags&-4097|2,St=!1,bn=t}}}function qg(t){for(t=t.return;t!==null&&t.tag!==5&&t.tag!==3&&t.tag!==13;)t=t.return;bn=t}function Dl(t){if(t!==bn)return!1;if(!St)return qg(t),St=!0,!1;var e;if((e=t.tag!==3)&&!(e=t.tag!==5)&&(e=t.type,e=e!=="head"&&e!=="body"&&!Gd(t.type,t.memoizedProps)),e&&(e=Tn)){if(Yd(t))throw g_(),Error(oe(418));for(;e;)m_(t,e),e=fr(e.nextSibling)}if(qg(t),t.tag===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(oe(317));e:{for(t=t.nextSibling,e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="/$"){if(e===0){Tn=fr(t.nextSibling);break e}e--}else n!=="$"&&n!=="$!"&&n!=="$?"||e++}t=t.nextSibling}Tn=null}}else Tn=bn?fr(t.stateNode.nextSibling):null;return!0}function g_(){for(var t=Tn;t;)t=fr(t.nextSibling)}function ks(){Tn=bn=null,St=!1}function If(t){jn===null?jn=[t]:jn.push(t)}var dM=Vi.ReactCurrentBatchConfig;function Uo(t,e,n){if(t=n.ref,t!==null&&typeof t!="function"&&typeof t!="object"){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(oe(309));var i=n.stateNode}if(!i)throw Error(oe(147,t));var r=i,s=""+t;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof t!="string")throw Error(oe(284));if(!n._owner)throw Error(oe(290,t))}return t}function Ul(t,e){throw t=Object.prototype.toString.call(e),Error(oe(31,t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t))}function Yg(t){var e=t._init;return e(t._payload)}function __(t){function e(u,m){if(t){var v=u.deletions;v===null?(u.deletions=[m],u.flags|=16):v.push(m)}}function n(u,m){if(!t)return null;for(;m!==null;)e(u,m),m=m.sibling;return null}function i(u,m){for(u=new Map;m!==null;)m.key!==null?u.set(m.key,m):u.set(m.index,m),m=m.sibling;return u}function r(u,m){return u=_r(u,m),u.index=0,u.sibling=null,u}function s(u,m,v){return u.index=v,t?(v=u.alternate,v!==null?(v=v.index,v<m?(u.flags|=2,m):v):(u.flags|=2,m)):(u.flags|=1048576,m)}function o(u){return t&&u.alternate===null&&(u.flags|=2),u}function a(u,m,v,M){return m===null||m.tag!==6?(m=vd(v,u.mode,M),m.return=u,m):(m=r(m,v),m.return=u,m)}function l(u,m,v,M){var A=v.type;return A===ys?d(u,m,v.props.children,M,v.key):m!==null&&(m.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===rr&&Yg(A)===m.type)?(M=r(m,v.props),M.ref=Uo(u,m,v),M.return=u,M):(M=Zl(v.type,v.key,v.props,null,u.mode,M),M.ref=Uo(u,m,v),M.return=u,M)}function c(u,m,v,M){return m===null||m.tag!==4||m.stateNode.containerInfo!==v.containerInfo||m.stateNode.implementation!==v.implementation?(m=xd(v,u.mode,M),m.return=u,m):(m=r(m,v.children||[]),m.return=u,m)}function d(u,m,v,M,A){return m===null||m.tag!==7?(m=$r(v,u.mode,M,A),m.return=u,m):(m=r(m,v),m.return=u,m)}function f(u,m,v){if(typeof m=="string"&&m!==""||typeof m=="number")return m=vd(""+m,u.mode,v),m.return=u,m;if(typeof m=="object"&&m!==null){switch(m.$$typeof){case yl:return v=Zl(m.type,m.key,m.props,null,u.mode,v),v.ref=Uo(u,null,m),v.return=u,v;case xs:return m=xd(m,u.mode,v),m.return=u,m;case rr:var M=m._init;return f(u,M(m._payload),v)}if(zo(m)||Io(m))return m=$r(m,u.mode,v,null),m.return=u,m;Ul(u,m)}return null}function h(u,m,v,M){var A=m!==null?m.key:null;if(typeof v=="string"&&v!==""||typeof v=="number")return A!==null?null:a(u,m,""+v,M);if(typeof v=="object"&&v!==null){switch(v.$$typeof){case yl:return v.key===A?l(u,m,v,M):null;case xs:return v.key===A?c(u,m,v,M):null;case rr:return A=v._init,h(u,m,A(v._payload),M)}if(zo(v)||Io(v))return A!==null?null:d(u,m,v,M,null);Ul(u,v)}return null}function p(u,m,v,M,A){if(typeof M=="string"&&M!==""||typeof M=="number")return u=u.get(v)||null,a(m,u,""+M,A);if(typeof M=="object"&&M!==null){switch(M.$$typeof){case yl:return u=u.get(M.key===null?v:M.key)||null,l(m,u,M,A);case xs:return u=u.get(M.key===null?v:M.key)||null,c(m,u,M,A);case rr:var E=M._init;return p(u,m,v,E(M._payload),A)}if(zo(M)||Io(M))return u=u.get(v)||null,d(m,u,M,A,null);Ul(m,M)}return null}function _(u,m,v,M){for(var A=null,E=null,P=m,x=m=0,R=null;P!==null&&x<v.length;x++){P.index>x?(R=P,P=null):R=P.sibling;var C=h(u,P,v[x],M);if(C===null){P===null&&(P=R);break}t&&P&&C.alternate===null&&e(u,P),m=s(C,m,x),E===null?A=C:E.sibling=C,E=C,P=R}if(x===v.length)return n(u,P),St&&Gr(u,x),A;if(P===null){for(;x<v.length;x++)P=f(u,v[x],M),P!==null&&(m=s(P,m,x),E===null?A=P:E.sibling=P,E=P);return St&&Gr(u,x),A}for(P=i(u,P);x<v.length;x++)R=p(P,u,x,v[x],M),R!==null&&(t&&R.alternate!==null&&P.delete(R.key===null?x:R.key),m=s(R,m,x),E===null?A=R:E.sibling=R,E=R);return t&&P.forEach(function(b){return e(u,b)}),St&&Gr(u,x),A}function S(u,m,v,M){var A=Io(v);if(typeof A!="function")throw Error(oe(150));if(v=A.call(v),v==null)throw Error(oe(151));for(var E=A=null,P=m,x=m=0,R=null,C=v.next();P!==null&&!C.done;x++,C=v.next()){P.index>x?(R=P,P=null):R=P.sibling;var b=h(u,P,C.value,M);if(b===null){P===null&&(P=R);break}t&&P&&b.alternate===null&&e(u,P),m=s(b,m,x),E===null?A=b:E.sibling=b,E=b,P=R}if(C.done)return n(u,P),St&&Gr(u,x),A;if(P===null){for(;!C.done;x++,C=v.next())C=f(u,C.value,M),C!==null&&(m=s(C,m,x),E===null?A=C:E.sibling=C,E=C);return St&&Gr(u,x),A}for(P=i(u,P);!C.done;x++,C=v.next())C=p(P,u,x,C.value,M),C!==null&&(t&&C.alternate!==null&&P.delete(C.key===null?x:C.key),m=s(C,m,x),E===null?A=C:E.sibling=C,E=C);return t&&P.forEach(function(I){return e(u,I)}),St&&Gr(u,x),A}function g(u,m,v,M){if(typeof v=="object"&&v!==null&&v.type===ys&&v.key===null&&(v=v.props.children),typeof v=="object"&&v!==null){switch(v.$$typeof){case yl:e:{for(var A=v.key,E=m;E!==null;){if(E.key===A){if(A=v.type,A===ys){if(E.tag===7){n(u,E.sibling),m=r(E,v.props.children),m.return=u,u=m;break e}}else if(E.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===rr&&Yg(A)===E.type){n(u,E.sibling),m=r(E,v.props),m.ref=Uo(u,E,v),m.return=u,u=m;break e}n(u,E);break}else e(u,E);E=E.sibling}v.type===ys?(m=$r(v.props.children,u.mode,M,v.key),m.return=u,u=m):(M=Zl(v.type,v.key,v.props,null,u.mode,M),M.ref=Uo(u,m,v),M.return=u,u=M)}return o(u);case xs:e:{for(E=v.key;m!==null;){if(m.key===E)if(m.tag===4&&m.stateNode.containerInfo===v.containerInfo&&m.stateNode.implementation===v.implementation){n(u,m.sibling),m=r(m,v.children||[]),m.return=u,u=m;break e}else{n(u,m);break}else e(u,m);m=m.sibling}m=xd(v,u.mode,M),m.return=u,u=m}return o(u);case rr:return E=v._init,g(u,m,E(v._payload),M)}if(zo(v))return _(u,m,v,M);if(Io(v))return S(u,m,v,M);Ul(u,v)}return typeof v=="string"&&v!==""||typeof v=="number"?(v=""+v,m!==null&&m.tag===6?(n(u,m.sibling),m=r(m,v),m.return=u,u=m):(n(u,m),m=vd(v,u.mode,M),m.return=u,u=m),o(u)):n(u,m)}return g}var zs=__(!0),v_=__(!1),lc=Sr(null),cc=null,Cs=null,Lf=null;function Nf(){Lf=Cs=cc=null}function Df(t){var e=lc.current;xt(lc),t._currentValue=e}function $d(t,e,n){for(;t!==null;){var i=t.alternate;if((t.childLanes&e)!==e?(t.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),t===n)break;t=t.return}}function Us(t,e){cc=t,Lf=Cs=null,t=t.dependencies,t!==null&&t.firstContext!==null&&((t.lanes&e)!==0&&(_n=!0),t.firstContext=null)}function Hn(t){var e=t._currentValue;if(Lf!==t)if(t={context:t,memoizedValue:e,next:null},Cs===null){if(cc===null)throw Error(oe(308));Cs=t,cc.dependencies={lanes:0,firstContext:t}}else Cs=Cs.next=t;return e}var qr=null;function Uf(t){qr===null?qr=[t]:qr.push(t)}function x_(t,e,n,i){var r=e.interleaved;return r===null?(n.next=n,Uf(e)):(n.next=r.next,r.next=n),e.interleaved=n,ki(t,i)}function ki(t,e){t.lanes|=e;var n=t.alternate;for(n!==null&&(n.lanes|=e),n=t,t=t.return;t!==null;)t.childLanes|=e,n=t.alternate,n!==null&&(n.childLanes|=e),n=t,t=t.return;return n.tag===3?n.stateNode:null}var sr=!1;function Ff(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function y_(t,e){t=t.updateQueue,e.updateQueue===t&&(e.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,effects:t.effects})}function Fi(t,e){return{eventTime:t,lane:e,tag:0,payload:null,callback:null,next:null}}function pr(t,e,n){var i=t.updateQueue;if(i===null)return null;if(i=i.shared,(et&2)!==0){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,ki(t,n)}return r=i.interleaved,r===null?(e.next=e,Uf(i)):(e.next=r.next,r.next=e),i.interleaved=e,ki(t,n)}function Hl(t,e,n){if(e=e.updateQueue,e!==null&&(e=e.shared,(n&4194240)!==0)){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,Sf(t,n)}}function Zg(t,e){var n=t.updateQueue,i=t.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var r=null,s=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};s===null?r=s=o:s=s.next=o,n=n.next}while(n!==null);s===null?r=s=e:s=s.next=e}else r=s=e;n={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},t.updateQueue=n;return}t=n.lastBaseUpdate,t===null?n.firstBaseUpdate=e:t.next=e,n.lastBaseUpdate=e}function uc(t,e,n,i){var r=t.updateQueue;sr=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,c=l.next;l.next=null,o===null?s=c:o.next=c,o=l;var d=t.alternate;d!==null&&(d=d.updateQueue,a=d.lastBaseUpdate,a!==o&&(a===null?d.firstBaseUpdate=c:a.next=c,d.lastBaseUpdate=l))}if(s!==null){var f=r.baseState;o=0,d=c=l=null,a=s;do{var h=a.lane,p=a.eventTime;if((i&h)===h){d!==null&&(d=d.next={eventTime:p,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var _=t,S=a;switch(h=e,p=n,S.tag){case 1:if(_=S.payload,typeof _=="function"){f=_.call(p,f,h);break e}f=_;break e;case 3:_.flags=_.flags&-65537|128;case 0:if(_=S.payload,h=typeof _=="function"?_.call(p,f,h):_,h==null)break e;f=Et({},f,h);break e;case 2:sr=!0}}a.callback!==null&&a.lane!==0&&(t.flags|=64,h=r.effects,h===null?r.effects=[a]:h.push(a))}else p={eventTime:p,lane:h,tag:a.tag,payload:a.payload,callback:a.callback,next:null},d===null?(c=d=p,l=f):d=d.next=p,o|=h;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;h=a,a=h.next,h.next=null,r.lastBaseUpdate=h,r.shared.pending=null}}while(!0);if(d===null&&(l=f),r.baseState=l,r.firstBaseUpdate=c,r.lastBaseUpdate=d,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);Qr|=o,t.lanes=o,t.memoizedState=f}}function $g(t,e,n){if(t=e.effects,e.effects=null,t!==null)for(e=0;e<t.length;e++){var i=t[e],r=i.callback;if(r!==null){if(i.callback=null,i=n,typeof r!="function")throw Error(oe(191,r));r.call(i)}}}var va={},gi=Sr(va),ca=Sr(va),ua=Sr(va);function Yr(t){if(t===va)throw Error(oe(174));return t}function Of(t,e){switch(_t(ua,e),_t(ca,t),_t(gi,va),t=e.nodeType,t){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:Rd(null,"");break;default:t=t===8?e.parentNode:e,e=t.namespaceURI||null,t=t.tagName,e=Rd(e,t)}xt(gi),_t(gi,e)}function Vs(){xt(gi),xt(ca),xt(ua)}function S_(t){Yr(ua.current);var e=Yr(gi.current),n=Rd(e,t.type);e!==n&&(_t(ca,t),_t(gi,n))}function Bf(t){ca.current===t&&(xt(gi),xt(ca))}var Mt=Sr(0);function hc(t){for(var e=t;e!==null;){if(e.tag===13){var n=e.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data==="$?"||n.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if((e.flags&128)!==0)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var dd=[];function kf(){for(var t=0;t<dd.length;t++)dd[t]._workInProgressVersionPrimary=null;dd.length=0}var Gl=Vi.ReactCurrentDispatcher,fd=Vi.ReactCurrentBatchConfig,jr=0,wt=null,Bt=null,Ht=null,dc=!1,Zo=!1,ha=0,fM=0;function nn(){throw Error(oe(321))}function zf(t,e){if(e===null)return!1;for(var n=0;n<e.length&&n<t.length;n++)if(!ti(t[n],e[n]))return!1;return!0}function Vf(t,e,n,i,r,s){if(jr=s,wt=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,Gl.current=t===null||t.memoizedState===null?_M:vM,t=n(i,r),Zo){s=0;do{if(Zo=!1,ha=0,25<=s)throw Error(oe(301));s+=1,Ht=Bt=null,e.updateQueue=null,Gl.current=xM,t=n(i,r)}while(Zo)}if(Gl.current=fc,e=Bt!==null&&Bt.next!==null,jr=0,Ht=Bt=wt=null,dc=!1,e)throw Error(oe(300));return t}function Hf(){var t=ha!==0;return ha=0,t}function fi(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return Ht===null?wt.memoizedState=Ht=t:Ht=Ht.next=t,Ht}function Gn(){if(Bt===null){var t=wt.alternate;t=t!==null?t.memoizedState:null}else t=Bt.next;var e=Ht===null?wt.memoizedState:Ht.next;if(e!==null)Ht=e,Bt=t;else{if(t===null)throw Error(oe(310));Bt=t,t={memoizedState:Bt.memoizedState,baseState:Bt.baseState,baseQueue:Bt.baseQueue,queue:Bt.queue,next:null},Ht===null?wt.memoizedState=Ht=t:Ht=Ht.next=t}return Ht}function da(t,e){return typeof e=="function"?e(t):e}function pd(t){var e=Gn(),n=e.queue;if(n===null)throw Error(oe(311));n.lastRenderedReducer=t;var i=Bt,r=i.baseQueue,s=n.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,n.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,c=s;do{var d=c.lane;if((jr&d)===d)l!==null&&(l=l.next={lane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),i=c.hasEagerState?c.eagerState:t(i,c.action);else{var f={lane:d,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null};l===null?(a=l=f,o=i):l=l.next=f,wt.lanes|=d,Qr|=d}c=c.next}while(c!==null&&c!==s);l===null?o=i:l.next=a,ti(i,e.memoizedState)||(_n=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,n.lastRenderedState=i}if(t=n.interleaved,t!==null){r=t;do s=r.lane,wt.lanes|=s,Qr|=s,r=r.next;while(r!==t)}else r===null&&(n.lanes=0);return[e.memoizedState,n.dispatch]}function md(t){var e=Gn(),n=e.queue;if(n===null)throw Error(oe(311));n.lastRenderedReducer=t;var i=n.dispatch,r=n.pending,s=e.memoizedState;if(r!==null){n.pending=null;var o=r=r.next;do s=t(s,o.action),o=o.next;while(o!==r);ti(s,e.memoizedState)||(_n=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),n.lastRenderedState=s}return[s,i]}function M_(){}function w_(t,e){var n=wt,i=Gn(),r=e(),s=!ti(i.memoizedState,r);if(s&&(i.memoizedState=r,_n=!0),i=i.queue,Gf(b_.bind(null,n,i,t),[t]),i.getSnapshot!==e||s||Ht!==null&&Ht.memoizedState.tag&1){if(n.flags|=2048,fa(9,T_.bind(null,n,i,r,e),void 0,null),Gt===null)throw Error(oe(349));(jr&30)!==0||E_(n,e,r)}return r}function E_(t,e,n){t.flags|=16384,t={getSnapshot:e,value:n},e=wt.updateQueue,e===null?(e={lastEffect:null,stores:null},wt.updateQueue=e,e.stores=[t]):(n=e.stores,n===null?e.stores=[t]:n.push(t))}function T_(t,e,n,i){e.value=n,e.getSnapshot=i,A_(e)&&C_(t)}function b_(t,e,n){return n(function(){A_(e)&&C_(t)})}function A_(t){var e=t.getSnapshot;t=t.value;try{var n=e();return!ti(t,n)}catch{return!0}}function C_(t){var e=ki(t,1);e!==null&&ei(e,t,1,-1)}function Jg(t){var e=fi();return typeof t=="function"&&(t=t()),e.memoizedState=e.baseState=t,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:da,lastRenderedState:t},e.queue=t,t=t.dispatch=gM.bind(null,wt,t),[e.memoizedState,t]}function fa(t,e,n,i){return t={tag:t,create:e,destroy:n,deps:i,next:null},e=wt.updateQueue,e===null?(e={lastEffect:null,stores:null},wt.updateQueue=e,e.lastEffect=t.next=t):(n=e.lastEffect,n===null?e.lastEffect=t.next=t:(i=n.next,n.next=t,t.next=i,e.lastEffect=t)),t}function R_(){return Gn().memoizedState}function Wl(t,e,n,i){var r=fi();wt.flags|=t,r.memoizedState=fa(1|e,n,void 0,i===void 0?null:i)}function Tc(t,e,n,i){var r=Gn();i=i===void 0?null:i;var s=void 0;if(Bt!==null){var o=Bt.memoizedState;if(s=o.destroy,i!==null&&zf(i,o.deps)){r.memoizedState=fa(e,n,s,i);return}}wt.flags|=t,r.memoizedState=fa(1|e,n,s,i)}function Kg(t,e){return Wl(8390656,8,t,e)}function Gf(t,e){return Tc(2048,8,t,e)}function P_(t,e){return Tc(4,2,t,e)}function I_(t,e){return Tc(4,4,t,e)}function L_(t,e){if(typeof e=="function")return t=t(),e(t),function(){e(null)};if(e!=null)return t=t(),e.current=t,function(){e.current=null}}function N_(t,e,n){return n=n!=null?n.concat([t]):null,Tc(4,4,L_.bind(null,e,t),n)}function Wf(){}function D_(t,e){var n=Gn();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&zf(e,i[1])?i[0]:(n.memoizedState=[t,e],t)}function U_(t,e){var n=Gn();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&zf(e,i[1])?i[0]:(t=t(),n.memoizedState=[t,e],t)}function F_(t,e,n){return(jr&21)===0?(t.baseState&&(t.baseState=!1,_n=!0),t.memoizedState=n):(ti(n,e)||(n=V0(),wt.lanes|=n,Qr|=n,t.baseState=!0),e)}function pM(t,e){var n=at;at=n!==0&&4>n?n:4,t(!0);var i=fd.transition;fd.transition={};try{t(!1),e()}finally{at=n,fd.transition=i}}function O_(){return Gn().memoizedState}function mM(t,e,n){var i=gr(t);if(n={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null},B_(t))k_(e,n);else if(n=x_(t,e,n,i),n!==null){var r=fn();ei(n,t,i,r),z_(n,e,i)}}function gM(t,e,n){var i=gr(t),r={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null};if(B_(t))k_(e,r);else{var s=t.alternate;if(t.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,n);if(r.hasEagerState=!0,r.eagerState=a,ti(a,o)){var l=e.interleaved;l===null?(r.next=r,Uf(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}n=x_(t,e,r,i),n!==null&&(r=fn(),ei(n,t,i,r),z_(n,e,i))}}function B_(t){var e=t.alternate;return t===wt||e!==null&&e===wt}function k_(t,e){Zo=dc=!0;var n=t.pending;n===null?e.next=e:(e.next=n.next,n.next=e),t.pending=e}function z_(t,e,n){if((n&4194240)!==0){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,Sf(t,n)}}var fc={readContext:Hn,useCallback:nn,useContext:nn,useEffect:nn,useImperativeHandle:nn,useInsertionEffect:nn,useLayoutEffect:nn,useMemo:nn,useReducer:nn,useRef:nn,useState:nn,useDebugValue:nn,useDeferredValue:nn,useTransition:nn,useMutableSource:nn,useSyncExternalStore:nn,useId:nn,unstable_isNewReconciler:!1},_M={readContext:Hn,useCallback:function(t,e){return fi().memoizedState=[t,e===void 0?null:e],t},useContext:Hn,useEffect:Kg,useImperativeHandle:function(t,e,n){return n=n!=null?n.concat([t]):null,Wl(4194308,4,L_.bind(null,e,t),n)},useLayoutEffect:function(t,e){return Wl(4194308,4,t,e)},useInsertionEffect:function(t,e){return Wl(4,2,t,e)},useMemo:function(t,e){var n=fi();return e=e===void 0?null:e,t=t(),n.memoizedState=[t,e],t},useReducer:function(t,e,n){var i=fi();return e=n!==void 0?n(e):e,i.memoizedState=i.baseState=e,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:e},i.queue=t,t=t.dispatch=mM.bind(null,wt,t),[i.memoizedState,t]},useRef:function(t){var e=fi();return t={current:t},e.memoizedState=t},useState:Jg,useDebugValue:Wf,useDeferredValue:function(t){return fi().memoizedState=t},useTransition:function(){var t=Jg(!1),e=t[0];return t=pM.bind(null,t[1]),fi().memoizedState=t,[e,t]},useMutableSource:function(){},useSyncExternalStore:function(t,e,n){var i=wt,r=fi();if(St){if(n===void 0)throw Error(oe(407));n=n()}else{if(n=e(),Gt===null)throw Error(oe(349));(jr&30)!==0||E_(i,e,n)}r.memoizedState=n;var s={value:n,getSnapshot:e};return r.queue=s,Kg(b_.bind(null,i,s,t),[t]),i.flags|=2048,fa(9,T_.bind(null,i,s,n,e),void 0,null),n},useId:function(){var t=fi(),e=Gt.identifierPrefix;if(St){var n=Ui,i=Di;n=(i&~(1<<32-Qn(i)-1)).toString(32)+n,e=":"+e+"R"+n,n=ha++,0<n&&(e+="H"+n.toString(32)),e+=":"}else n=fM++,e=":"+e+"r"+n.toString(32)+":";return t.memoizedState=e},unstable_isNewReconciler:!1},vM={readContext:Hn,useCallback:D_,useContext:Hn,useEffect:Gf,useImperativeHandle:N_,useInsertionEffect:P_,useLayoutEffect:I_,useMemo:U_,useReducer:pd,useRef:R_,useState:function(){return pd(da)},useDebugValue:Wf,useDeferredValue:function(t){var e=Gn();return F_(e,Bt.memoizedState,t)},useTransition:function(){var t=pd(da)[0],e=Gn().memoizedState;return[t,e]},useMutableSource:M_,useSyncExternalStore:w_,useId:O_,unstable_isNewReconciler:!1},xM={readContext:Hn,useCallback:D_,useContext:Hn,useEffect:Gf,useImperativeHandle:N_,useInsertionEffect:P_,useLayoutEffect:I_,useMemo:U_,useReducer:md,useRef:R_,useState:function(){return md(da)},useDebugValue:Wf,useDeferredValue:function(t){var e=Gn();return Bt===null?e.memoizedState=t:F_(e,Bt.memoizedState,t)},useTransition:function(){var t=md(da)[0],e=Gn().memoizedState;return[t,e]},useMutableSource:M_,useSyncExternalStore:w_,useId:O_,unstable_isNewReconciler:!1};function Jn(t,e){if(t&&t.defaultProps){e=Et({},e),t=t.defaultProps;for(var n in t)e[n]===void 0&&(e[n]=t[n]);return e}return e}function Jd(t,e,n,i){e=t.memoizedState,n=n(i,e),n=n==null?e:Et({},e,n),t.memoizedState=n,t.lanes===0&&(t.updateQueue.baseState=n)}var bc={isMounted:function(t){return(t=t._reactInternals)?ns(t)===t:!1},enqueueSetState:function(t,e,n){t=t._reactInternals;var i=fn(),r=gr(t),s=Fi(i,r);s.payload=e,n!=null&&(s.callback=n),e=pr(t,s,r),e!==null&&(ei(e,t,r,i),Hl(e,t,r))},enqueueReplaceState:function(t,e,n){t=t._reactInternals;var i=fn(),r=gr(t),s=Fi(i,r);s.tag=1,s.payload=e,n!=null&&(s.callback=n),e=pr(t,s,r),e!==null&&(ei(e,t,r,i),Hl(e,t,r))},enqueueForceUpdate:function(t,e){t=t._reactInternals;var n=fn(),i=gr(t),r=Fi(n,i);r.tag=2,e!=null&&(r.callback=e),e=pr(t,r,i),e!==null&&(ei(e,t,i,n),Hl(e,t,i))}};function jg(t,e,n,i,r,s,o){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!sa(n,i)||!sa(r,s):!0}function V_(t,e,n){var i=!1,r=xr,s=e.contextType;return typeof s=="object"&&s!==null?s=Hn(s):(r=xn(e)?Jr:on.current,i=e.contextTypes,s=(i=i!=null)?Bs(t,r):xr),e=new e(n,s),t.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=bc,t.stateNode=e,e._reactInternals=t,i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=r,t.__reactInternalMemoizedMaskedChildContext=s),e}function Qg(t,e,n,i){t=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(n,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(n,i),e.state!==t&&bc.enqueueReplaceState(e,e.state,null)}function Kd(t,e,n,i){var r=t.stateNode;r.props=n,r.state=t.memoizedState,r.refs={},Ff(t);var s=e.contextType;typeof s=="object"&&s!==null?r.context=Hn(s):(s=xn(e)?Jr:on.current,r.context=Bs(t,s)),r.state=t.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(Jd(t,e,s,n),r.state=t.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&bc.enqueueReplaceState(r,r.state,null),uc(t,n,r,i),r.state=t.memoizedState),typeof r.componentDidMount=="function"&&(t.flags|=4194308)}function Hs(t,e){try{var n="",i=e;do n+=$y(i),i=i.return;while(i);var r=n}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:t,source:e,stack:r,digest:null}}function gd(t,e,n){return{value:t,source:null,stack:n??null,digest:e??null}}function jd(t,e){try{console.error(e.value)}catch(n){setTimeout(function(){throw n})}}var yM=typeof WeakMap=="function"?WeakMap:Map;function H_(t,e,n){n=Fi(-1,n),n.tag=3,n.payload={element:null};var i=e.value;return n.callback=function(){mc||(mc=!0,cf=i),jd(t,e)},n}function G_(t,e,n){n=Fi(-1,n),n.tag=3;var i=t.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;n.payload=function(){return i(r)},n.callback=function(){jd(t,e)}}var s=t.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(n.callback=function(){jd(t,e),typeof i!="function"&&(mr===null?mr=new Set([this]):mr.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),n}function e0(t,e,n){var i=t.pingCache;if(i===null){i=t.pingCache=new yM;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(n)||(r.add(n),t=DM.bind(null,t,e,n),e.then(t,t))}function t0(t){do{var e;if((e=t.tag===13)&&(e=t.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return t;t=t.return}while(t!==null);return null}function n0(t,e,n,i,r){return(t.mode&1)===0?(t===e?t.flags|=65536:(t.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(e=Fi(-1,1),e.tag=2,pr(n,e,1))),n.lanes|=1),t):(t.flags|=65536,t.lanes=r,t)}var SM=Vi.ReactCurrentOwner,_n=!1;function dn(t,e,n,i){e.child=t===null?v_(e,null,n,i):zs(e,t.child,n,i)}function i0(t,e,n,i,r){n=n.render;var s=e.ref;return Us(e,r),i=Vf(t,e,n,i,s,r),n=Hf(),t!==null&&!_n?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,zi(t,e,r)):(St&&n&&Rf(e),e.flags|=1,dn(t,e,i,r),e.child)}function r0(t,e,n,i,r){if(t===null){var s=n.type;return typeof s=="function"&&!jf(s)&&s.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(e.tag=15,e.type=s,W_(t,e,s,i,r)):(t=Zl(n.type,null,i,e,e.mode,r),t.ref=e.ref,t.return=e,e.child=t)}if(s=t.child,(t.lanes&r)===0){var o=s.memoizedProps;if(n=n.compare,n=n!==null?n:sa,n(o,i)&&t.ref===e.ref)return zi(t,e,r)}return e.flags|=1,t=_r(s,i),t.ref=e.ref,t.return=e,e.child=t}function W_(t,e,n,i,r){if(t!==null){var s=t.memoizedProps;if(sa(s,i)&&t.ref===e.ref)if(_n=!1,e.pendingProps=i=s,(t.lanes&r)!==0)(t.flags&131072)!==0&&(_n=!0);else return e.lanes=t.lanes,zi(t,e,r)}return Qd(t,e,n,i,r)}function X_(t,e,n){var i=e.pendingProps,r=i.children,s=t!==null?t.memoizedState:null;if(i.mode==="hidden")if((e.mode&1)===0)e.memoizedState={baseLanes:0,cachePool:null,transitions:null},_t(Ps,En),En|=n;else{if((n&1073741824)===0)return t=s!==null?s.baseLanes|n:n,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:t,cachePool:null,transitions:null},e.updateQueue=null,_t(Ps,En),En|=t,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:n,_t(Ps,En),En|=i}else s!==null?(i=s.baseLanes|n,e.memoizedState=null):i=n,_t(Ps,En),En|=i;return dn(t,e,r,n),e.child}function q_(t,e){var n=e.ref;(t===null&&n!==null||t!==null&&t.ref!==n)&&(e.flags|=512,e.flags|=2097152)}function Qd(t,e,n,i,r){var s=xn(n)?Jr:on.current;return s=Bs(e,s),Us(e,r),n=Vf(t,e,n,i,s,r),i=Hf(),t!==null&&!_n?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,zi(t,e,r)):(St&&i&&Rf(e),e.flags|=1,dn(t,e,n,r),e.child)}function s0(t,e,n,i,r){if(xn(n)){var s=!0;sc(e)}else s=!1;if(Us(e,r),e.stateNode===null)Xl(t,e),V_(e,n,i),Kd(e,n,i,r),i=!0;else if(t===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,c=n.contextType;typeof c=="object"&&c!==null?c=Hn(c):(c=xn(n)?Jr:on.current,c=Bs(e,c));var d=n.getDerivedStateFromProps,f=typeof d=="function"||typeof o.getSnapshotBeforeUpdate=="function";f||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==c)&&Qg(e,o,i,c),sr=!1;var h=e.memoizedState;o.state=h,uc(e,i,o,r),l=e.memoizedState,a!==i||h!==l||vn.current||sr?(typeof d=="function"&&(Jd(e,n,d,i),l=e.memoizedState),(a=sr||jg(e,n,a,i,h,l,c))?(f||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=c,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,y_(t,e),a=e.memoizedProps,c=e.type===e.elementType?a:Jn(e.type,a),o.props=c,f=e.pendingProps,h=o.context,l=n.contextType,typeof l=="object"&&l!==null?l=Hn(l):(l=xn(n)?Jr:on.current,l=Bs(e,l));var p=n.getDerivedStateFromProps;(d=typeof p=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==f||h!==l)&&Qg(e,o,i,l),sr=!1,h=e.memoizedState,o.state=h,uc(e,i,o,r);var _=e.memoizedState;a!==f||h!==_||vn.current||sr?(typeof p=="function"&&(Jd(e,n,p,i),_=e.memoizedState),(c=sr||jg(e,n,c,i,h,_,l)||!1)?(d||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,_,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,_,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=_),o.props=i,o.state=_,o.context=l,i=c):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),i=!1)}return ef(t,e,n,i,s,r)}function ef(t,e,n,i,r,s){q_(t,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&Wg(e,n,!1),zi(t,e,s);i=e.stateNode,SM.current=e;var a=o&&typeof n.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,t!==null&&o?(e.child=zs(e,t.child,null,s),e.child=zs(e,null,a,s)):dn(t,e,a,s),e.memoizedState=i.state,r&&Wg(e,n,!0),e.child}function Y_(t){var e=t.stateNode;e.pendingContext?Gg(t,e.pendingContext,e.pendingContext!==e.context):e.context&&Gg(t,e.context,!1),Of(t,e.containerInfo)}function o0(t,e,n,i,r){return ks(),If(r),e.flags|=256,dn(t,e,n,i),e.child}var tf={dehydrated:null,treeContext:null,retryLane:0};function nf(t){return{baseLanes:t,cachePool:null,transitions:null}}function Z_(t,e,n){var i=e.pendingProps,r=Mt.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=t!==null&&t.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(t===null||t.memoizedState!==null)&&(r|=1),_t(Mt,r&1),t===null)return Zd(e),t=e.memoizedState,t!==null&&(t=t.dehydrated,t!==null)?((e.mode&1)===0?e.lanes=1:t.data==="$!"?e.lanes=8:e.lanes=1073741824,null):(o=i.children,t=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},(i&1)===0&&s!==null?(s.childLanes=0,s.pendingProps=o):s=Rc(o,i,0,null),t=$r(t,i,n,null),s.return=e,t.return=e,s.sibling=t,e.child=s,e.child.memoizedState=nf(n),e.memoizedState=tf,t):Xf(e,o));if(r=t.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return MM(t,e,o,i,a,r,n);if(s){s=i.fallback,o=e.mode,r=t.child,a=r.sibling;var l={mode:"hidden",children:i.children};return(o&1)===0&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=_r(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=_r(a,s):(s=$r(s,o,n,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=t.child.memoizedState,o=o===null?nf(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=t.childLanes&~n,e.memoizedState=tf,i}return s=t.child,t=s.sibling,i=_r(s,{mode:"visible",children:i.children}),(e.mode&1)===0&&(i.lanes=n),i.return=e,i.sibling=null,t!==null&&(n=e.deletions,n===null?(e.deletions=[t],e.flags|=16):n.push(t)),e.child=i,e.memoizedState=null,i}function Xf(t,e){return e=Rc({mode:"visible",children:e},t.mode,0,null),e.return=t,t.child=e}function Fl(t,e,n,i){return i!==null&&If(i),zs(e,t.child,null,n),t=Xf(e,e.pendingProps.children),t.flags|=2,e.memoizedState=null,t}function MM(t,e,n,i,r,s,o){if(n)return e.flags&256?(e.flags&=-257,i=gd(Error(oe(422))),Fl(t,e,o,i)):e.memoizedState!==null?(e.child=t.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=Rc({mode:"visible",children:i.children},r,0,null),s=$r(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,(e.mode&1)!==0&&zs(e,t.child,null,o),e.child.memoizedState=nf(o),e.memoizedState=tf,s);if((e.mode&1)===0)return Fl(t,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(oe(419)),i=gd(s,i,void 0),Fl(t,e,o,i)}if(a=(o&t.childLanes)!==0,_n||a){if(i=Gt,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=(r&(i.suspendedLanes|o))!==0?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,ki(t,r),ei(i,t,r,-1))}return Kf(),i=gd(Error(oe(421))),Fl(t,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=t.child,e=UM.bind(null,t),r._reactRetry=e,null):(t=s.treeContext,Tn=fr(r.nextSibling),bn=e,St=!0,jn=null,t!==null&&(Bn[kn++]=Di,Bn[kn++]=Ui,Bn[kn++]=Kr,Di=t.id,Ui=t.overflow,Kr=e),e=Xf(e,i.children),e.flags|=4096,e)}function a0(t,e,n){t.lanes|=e;var i=t.alternate;i!==null&&(i.lanes|=e),$d(t.return,e,n)}function _d(t,e,n,i,r){var s=t.memoizedState;s===null?t.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=n,s.tailMode=r)}function $_(t,e,n){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(dn(t,e,i.children,n),i=Mt.current,(i&2)!==0)i=i&1|2,e.flags|=128;else{if(t!==null&&(t.flags&128)!==0)e:for(t=e.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&a0(t,n,e);else if(t.tag===19)a0(t,n,e);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break e;for(;t.sibling===null;){if(t.return===null||t.return===e)break e;t=t.return}t.sibling.return=t.return,t=t.sibling}i&=1}if(_t(Mt,i),(e.mode&1)===0)e.memoizedState=null;else switch(r){case"forwards":for(n=e.child,r=null;n!==null;)t=n.alternate,t!==null&&hc(t)===null&&(r=n),n=n.sibling;n=r,n===null?(r=e.child,e.child=null):(r=n.sibling,n.sibling=null),_d(e,!1,r,n,s);break;case"backwards":for(n=null,r=e.child,e.child=null;r!==null;){if(t=r.alternate,t!==null&&hc(t)===null){e.child=r;break}t=r.sibling,r.sibling=n,n=r,r=t}_d(e,!0,n,null,s);break;case"together":_d(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function Xl(t,e){(e.mode&1)===0&&t!==null&&(t.alternate=null,e.alternate=null,e.flags|=2)}function zi(t,e,n){if(t!==null&&(e.dependencies=t.dependencies),Qr|=e.lanes,(n&e.childLanes)===0)return null;if(t!==null&&e.child!==t.child)throw Error(oe(153));if(e.child!==null){for(t=e.child,n=_r(t,t.pendingProps),e.child=n,n.return=e;t.sibling!==null;)t=t.sibling,n=n.sibling=_r(t,t.pendingProps),n.return=e;n.sibling=null}return e.child}function wM(t,e,n){switch(e.tag){case 3:Y_(e),ks();break;case 5:S_(e);break;case 1:xn(e.type)&&sc(e);break;case 4:Of(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;_t(lc,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(_t(Mt,Mt.current&1),e.flags|=128,null):(n&e.child.childLanes)!==0?Z_(t,e,n):(_t(Mt,Mt.current&1),t=zi(t,e,n),t!==null?t.sibling:null);_t(Mt,Mt.current&1);break;case 19:if(i=(n&e.childLanes)!==0,(t.flags&128)!==0){if(i)return $_(t,e,n);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),_t(Mt,Mt.current),i)break;return null;case 22:case 23:return e.lanes=0,X_(t,e,n)}return zi(t,e,n)}var J_,rf,K_,j_;J_=function(t,e){for(var n=e.child;n!==null;){if(n.tag===5||n.tag===6)t.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return;n=n.return}n.sibling.return=n.return,n=n.sibling}};rf=function(){};K_=function(t,e,n,i){var r=t.memoizedProps;if(r!==i){t=e.stateNode,Yr(gi.current);var s=null;switch(n){case"input":r=Td(t,r),i=Td(t,i),s=[];break;case"select":r=Et({},r,{value:void 0}),i=Et({},i,{value:void 0}),s=[];break;case"textarea":r=Cd(t,r),i=Cd(t,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(t.onclick=ic)}Pd(n,i);var o;n=null;for(c in r)if(!i.hasOwnProperty(c)&&r.hasOwnProperty(c)&&r[c]!=null)if(c==="style"){var a=r[c];for(o in a)a.hasOwnProperty(o)&&(n||(n={}),n[o]="")}else c!=="dangerouslySetInnerHTML"&&c!=="children"&&c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&c!=="autoFocus"&&(jo.hasOwnProperty(c)?s||(s=[]):(s=s||[]).push(c,null));for(c in i){var l=i[c];if(a=r!=null?r[c]:void 0,i.hasOwnProperty(c)&&l!==a&&(l!=null||a!=null))if(c==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(n||(n={}),n[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(n||(n={}),n[o]=l[o])}else n||(s||(s=[]),s.push(c,n)),n=l;else c==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(c,l)):c==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(c,""+l):c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&(jo.hasOwnProperty(c)?(l!=null&&c==="onScroll"&&vt("scroll",t),s||a===l||(s=[])):(s=s||[]).push(c,l))}n&&(s=s||[]).push("style",n);var c=s;(e.updateQueue=c)&&(e.flags|=4)}};j_=function(t,e,n,i){n!==i&&(e.flags|=4)};function Fo(t,e){if(!St)switch(t.tailMode){case"hidden":e=t.tail;for(var n=null;e!==null;)e.alternate!==null&&(n=e),e=e.sibling;n===null?t.tail=null:n.sibling=null;break;case"collapsed":n=t.tail;for(var i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?e||t.tail===null?t.tail=null:t.tail.sibling=null:i.sibling=null}}function rn(t){var e=t.alternate!==null&&t.alternate.child===t.child,n=0,i=0;if(e)for(var r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=t,r=r.sibling;else for(r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=t,r=r.sibling;return t.subtreeFlags|=i,t.childLanes=n,e}function EM(t,e,n){var i=e.pendingProps;switch(Pf(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return rn(e),null;case 1:return xn(e.type)&&rc(),rn(e),null;case 3:return i=e.stateNode,Vs(),xt(vn),xt(on),kf(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(t===null||t.child===null)&&(Dl(e)?e.flags|=4:t===null||t.memoizedState.isDehydrated&&(e.flags&256)===0||(e.flags|=1024,jn!==null&&(df(jn),jn=null))),rf(t,e),rn(e),null;case 5:Bf(e);var r=Yr(ua.current);if(n=e.type,t!==null&&e.stateNode!=null)K_(t,e,n,i,r),t.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(oe(166));return rn(e),null}if(t=Yr(gi.current),Dl(e)){i=e.stateNode,n=e.type;var s=e.memoizedProps;switch(i[pi]=e,i[la]=s,t=(e.mode&1)!==0,n){case"dialog":vt("cancel",i),vt("close",i);break;case"iframe":case"object":case"embed":vt("load",i);break;case"video":case"audio":for(r=0;r<Ho.length;r++)vt(Ho[r],i);break;case"source":vt("error",i);break;case"img":case"image":case"link":vt("error",i),vt("load",i);break;case"details":vt("toggle",i);break;case"input":mg(i,s),vt("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},vt("invalid",i);break;case"textarea":_g(i,s),vt("invalid",i)}Pd(n,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&Nl(i.textContent,a,t),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&Nl(i.textContent,a,t),r=["children",""+a]):jo.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&vt("scroll",i)}switch(n){case"input":Sl(i),gg(i,s,!0);break;case"textarea":Sl(i),vg(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=ic)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,t==="http://www.w3.org/1999/xhtml"&&(t=b0(n)),t==="http://www.w3.org/1999/xhtml"?n==="script"?(t=o.createElement("div"),t.innerHTML="<script><\/script>",t=t.removeChild(t.firstChild)):typeof i.is=="string"?t=o.createElement(n,{is:i.is}):(t=o.createElement(n),n==="select"&&(o=t,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):t=o.createElementNS(t,n),t[pi]=e,t[la]=i,J_(t,e,!1,!1),e.stateNode=t;e:{switch(o=Id(n,i),n){case"dialog":vt("cancel",t),vt("close",t),r=i;break;case"iframe":case"object":case"embed":vt("load",t),r=i;break;case"video":case"audio":for(r=0;r<Ho.length;r++)vt(Ho[r],t);r=i;break;case"source":vt("error",t),r=i;break;case"img":case"image":case"link":vt("error",t),vt("load",t),r=i;break;case"details":vt("toggle",t),r=i;break;case"input":mg(t,i),r=Td(t,i),vt("invalid",t);break;case"option":r=i;break;case"select":t._wrapperState={wasMultiple:!!i.multiple},r=Et({},i,{value:void 0}),vt("invalid",t);break;case"textarea":_g(t,i),r=Cd(t,i),vt("invalid",t);break;default:r=i}Pd(n,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?R0(t,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&A0(t,l)):s==="children"?typeof l=="string"?(n!=="textarea"||l!=="")&&Qo(t,l):typeof l=="number"&&Qo(t,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(jo.hasOwnProperty(s)?l!=null&&s==="onScroll"&&vt("scroll",t):l!=null&&mf(t,s,l,o))}switch(n){case"input":Sl(t),gg(t,i,!1);break;case"textarea":Sl(t),vg(t);break;case"option":i.value!=null&&t.setAttribute("value",""+vr(i.value));break;case"select":t.multiple=!!i.multiple,s=i.value,s!=null?Is(t,!!i.multiple,s,!1):i.defaultValue!=null&&Is(t,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(t.onclick=ic)}switch(n){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return rn(e),null;case 6:if(t&&e.stateNode!=null)j_(t,e,t.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(oe(166));if(n=Yr(ua.current),Yr(gi.current),Dl(e)){if(i=e.stateNode,n=e.memoizedProps,i[pi]=e,(s=i.nodeValue!==n)&&(t=bn,t!==null))switch(t.tag){case 3:Nl(i.nodeValue,n,(t.mode&1)!==0);break;case 5:t.memoizedProps.suppressHydrationWarning!==!0&&Nl(i.nodeValue,n,(t.mode&1)!==0)}s&&(e.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[pi]=e,e.stateNode=i}return rn(e),null;case 13:if(xt(Mt),i=e.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(St&&Tn!==null&&(e.mode&1)!==0&&(e.flags&128)===0)g_(),ks(),e.flags|=98560,s=!1;else if(s=Dl(e),i!==null&&i.dehydrated!==null){if(t===null){if(!s)throw Error(oe(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(oe(317));s[pi]=e}else ks(),(e.flags&128)===0&&(e.memoizedState=null),e.flags|=4;rn(e),s=!1}else jn!==null&&(df(jn),jn=null),s=!0;if(!s)return e.flags&65536?e:null}return(e.flags&128)!==0?(e.lanes=n,e):(i=i!==null,i!==(t!==null&&t.memoizedState!==null)&&i&&(e.child.flags|=8192,(e.mode&1)!==0&&(t===null||(Mt.current&1)!==0?kt===0&&(kt=3):Kf())),e.updateQueue!==null&&(e.flags|=4),rn(e),null);case 4:return Vs(),rf(t,e),t===null&&oa(e.stateNode.containerInfo),rn(e),null;case 10:return Df(e.type._context),rn(e),null;case 17:return xn(e.type)&&rc(),rn(e),null;case 19:if(xt(Mt),s=e.memoizedState,s===null)return rn(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)Fo(s,!1);else{if(kt!==0||t!==null&&(t.flags&128)!==0)for(t=e.child;t!==null;){if(o=hc(t),o!==null){for(e.flags|=128,Fo(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=n,n=e.child;n!==null;)s=n,t=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=t,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,t=o.dependencies,s.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext}),n=n.sibling;return _t(Mt,Mt.current&1|2),e.child}t=t.sibling}s.tail!==null&&Nt()>Gs&&(e.flags|=128,i=!0,Fo(s,!1),e.lanes=4194304)}else{if(!i)if(t=hc(o),t!==null){if(e.flags|=128,i=!0,n=t.updateQueue,n!==null&&(e.updateQueue=n,e.flags|=4),Fo(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!St)return rn(e),null}else 2*Nt()-s.renderingStartTime>Gs&&n!==1073741824&&(e.flags|=128,i=!0,Fo(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(n=s.last,n!==null?n.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=Nt(),e.sibling=null,n=Mt.current,_t(Mt,i?n&1|2:n&1),e):(rn(e),null);case 22:case 23:return Jf(),i=e.memoizedState!==null,t!==null&&t.memoizedState!==null!==i&&(e.flags|=8192),i&&(e.mode&1)!==0?(En&1073741824)!==0&&(rn(e),e.subtreeFlags&6&&(e.flags|=8192)):rn(e),null;case 24:return null;case 25:return null}throw Error(oe(156,e.tag))}function TM(t,e){switch(Pf(e),e.tag){case 1:return xn(e.type)&&rc(),t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 3:return Vs(),xt(vn),xt(on),kf(),t=e.flags,(t&65536)!==0&&(t&128)===0?(e.flags=t&-65537|128,e):null;case 5:return Bf(e),null;case 13:if(xt(Mt),t=e.memoizedState,t!==null&&t.dehydrated!==null){if(e.alternate===null)throw Error(oe(340));ks()}return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 19:return xt(Mt),null;case 4:return Vs(),null;case 10:return Df(e.type._context),null;case 22:case 23:return Jf(),null;case 24:return null;default:return null}}var Ol=!1,sn=!1,bM=typeof WeakSet=="function"?WeakSet:Set,Me=null;function Rs(t,e){var n=t.ref;if(n!==null)if(typeof n=="function")try{n(null)}catch(i){Rt(t,e,i)}else n.current=null}function sf(t,e,n){try{n()}catch(i){Rt(t,e,i)}}var l0=!1;function AM(t,e){if(Vd=ec,t=i_(),Cf(t)){if("selectionStart"in t)var n={start:t.selectionStart,end:t.selectionEnd};else e:{n=(n=t.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{n.nodeType,s.nodeType}catch{n=null;break e}var o=0,a=-1,l=-1,c=0,d=0,f=t,h=null;t:for(;;){for(var p;f!==n||r!==0&&f.nodeType!==3||(a=o+r),f!==s||i!==0&&f.nodeType!==3||(l=o+i),f.nodeType===3&&(o+=f.nodeValue.length),(p=f.firstChild)!==null;)h=f,f=p;for(;;){if(f===t)break t;if(h===n&&++c===r&&(a=o),h===s&&++d===i&&(l=o),(p=f.nextSibling)!==null)break;f=h,h=f.parentNode}f=p}n=a===-1||l===-1?null:{start:a,end:l}}else n=null}n=n||{start:0,end:0}}else n=null;for(Hd={focusedElem:t,selectionRange:n},ec=!1,Me=e;Me!==null;)if(e=Me,t=e.child,(e.subtreeFlags&1028)!==0&&t!==null)t.return=e,Me=t;else for(;Me!==null;){e=Me;try{var _=e.alternate;if((e.flags&1024)!==0)switch(e.tag){case 0:case 11:case 15:break;case 1:if(_!==null){var S=_.memoizedProps,g=_.memoizedState,u=e.stateNode,m=u.getSnapshotBeforeUpdate(e.elementType===e.type?S:Jn(e.type,S),g);u.__reactInternalSnapshotBeforeUpdate=m}break;case 3:var v=e.stateNode.containerInfo;v.nodeType===1?v.textContent="":v.nodeType===9&&v.documentElement&&v.removeChild(v.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(oe(163))}}catch(M){Rt(e,e.return,M)}if(t=e.sibling,t!==null){t.return=e.return,Me=t;break}Me=e.return}return _=l0,l0=!1,_}function $o(t,e,n){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&t)===t){var s=r.destroy;r.destroy=void 0,s!==void 0&&sf(e,n,s)}r=r.next}while(r!==i)}}function Ac(t,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var n=e=e.next;do{if((n.tag&t)===t){var i=n.create;n.destroy=i()}n=n.next}while(n!==e)}}function of(t){var e=t.ref;if(e!==null){var n=t.stateNode;switch(t.tag){case 5:t=n;break;default:t=n}typeof e=="function"?e(t):e.current=t}}function Q_(t){var e=t.alternate;e!==null&&(t.alternate=null,Q_(e)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(e=t.stateNode,e!==null&&(delete e[pi],delete e[la],delete e[Xd],delete e[cM],delete e[uM])),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}function ev(t){return t.tag===5||t.tag===3||t.tag===4}function c0(t){e:for(;;){for(;t.sibling===null;){if(t.return===null||ev(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.flags&2||t.child===null||t.tag===4)continue e;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function af(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.nodeType===8?n.parentNode.insertBefore(t,e):n.insertBefore(t,e):(n.nodeType===8?(e=n.parentNode,e.insertBefore(t,n)):(e=n,e.appendChild(t)),n=n._reactRootContainer,n!=null||e.onclick!==null||(e.onclick=ic));else if(i!==4&&(t=t.child,t!==null))for(af(t,e,n),t=t.sibling;t!==null;)af(t,e,n),t=t.sibling}function lf(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.insertBefore(t,e):n.appendChild(t);else if(i!==4&&(t=t.child,t!==null))for(lf(t,e,n),t=t.sibling;t!==null;)lf(t,e,n),t=t.sibling}var Yt=null,Kn=!1;function ir(t,e,n){for(n=n.child;n!==null;)tv(t,e,n),n=n.sibling}function tv(t,e,n){if(mi&&typeof mi.onCommitFiberUnmount=="function")try{mi.onCommitFiberUnmount(xc,n)}catch{}switch(n.tag){case 5:sn||Rs(n,e);case 6:var i=Yt,r=Kn;Yt=null,ir(t,e,n),Yt=i,Kn=r,Yt!==null&&(Kn?(t=Yt,n=n.stateNode,t.nodeType===8?t.parentNode.removeChild(n):t.removeChild(n)):Yt.removeChild(n.stateNode));break;case 18:Yt!==null&&(Kn?(t=Yt,n=n.stateNode,t.nodeType===8?ud(t.parentNode,n):t.nodeType===1&&ud(t,n),ia(t)):ud(Yt,n.stateNode));break;case 4:i=Yt,r=Kn,Yt=n.stateNode.containerInfo,Kn=!0,ir(t,e,n),Yt=i,Kn=r;break;case 0:case 11:case 14:case 15:if(!sn&&(i=n.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&((s&2)!==0||(s&4)!==0)&&sf(n,e,o),r=r.next}while(r!==i)}ir(t,e,n);break;case 1:if(!sn&&(Rs(n,e),i=n.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=n.memoizedProps,i.state=n.memoizedState,i.componentWillUnmount()}catch(a){Rt(n,e,a)}ir(t,e,n);break;case 21:ir(t,e,n);break;case 22:n.mode&1?(sn=(i=sn)||n.memoizedState!==null,ir(t,e,n),sn=i):ir(t,e,n);break;default:ir(t,e,n)}}function u0(t){var e=t.updateQueue;if(e!==null){t.updateQueue=null;var n=t.stateNode;n===null&&(n=t.stateNode=new bM),e.forEach(function(i){var r=FM.bind(null,t,i);n.has(i)||(n.add(i),i.then(r,r))})}}function $n(t,e){var n=e.deletions;if(n!==null)for(var i=0;i<n.length;i++){var r=n[i];try{var s=t,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:Yt=a.stateNode,Kn=!1;break e;case 3:Yt=a.stateNode.containerInfo,Kn=!0;break e;case 4:Yt=a.stateNode.containerInfo,Kn=!0;break e}a=a.return}if(Yt===null)throw Error(oe(160));tv(s,o,r),Yt=null,Kn=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(c){Rt(r,e,c)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)nv(e,t),e=e.sibling}function nv(t,e){var n=t.alternate,i=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:if($n(e,t),di(t),i&4){try{$o(3,t,t.return),Ac(3,t)}catch(S){Rt(t,t.return,S)}try{$o(5,t,t.return)}catch(S){Rt(t,t.return,S)}}break;case 1:$n(e,t),di(t),i&512&&n!==null&&Rs(n,n.return);break;case 5:if($n(e,t),di(t),i&512&&n!==null&&Rs(n,n.return),t.flags&32){var r=t.stateNode;try{Qo(r,"")}catch(S){Rt(t,t.return,S)}}if(i&4&&(r=t.stateNode,r!=null)){var s=t.memoizedProps,o=n!==null?n.memoizedProps:s,a=t.type,l=t.updateQueue;if(t.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&E0(r,s),Id(a,o);var c=Id(a,s);for(o=0;o<l.length;o+=2){var d=l[o],f=l[o+1];d==="style"?R0(r,f):d==="dangerouslySetInnerHTML"?A0(r,f):d==="children"?Qo(r,f):mf(r,d,f,c)}switch(a){case"input":bd(r,s);break;case"textarea":T0(r,s);break;case"select":var h=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var p=s.value;p!=null?Is(r,!!s.multiple,p,!1):h!==!!s.multiple&&(s.defaultValue!=null?Is(r,!!s.multiple,s.defaultValue,!0):Is(r,!!s.multiple,s.multiple?[]:"",!1))}r[la]=s}catch(S){Rt(t,t.return,S)}}break;case 6:if($n(e,t),di(t),i&4){if(t.stateNode===null)throw Error(oe(162));r=t.stateNode,s=t.memoizedProps;try{r.nodeValue=s}catch(S){Rt(t,t.return,S)}}break;case 3:if($n(e,t),di(t),i&4&&n!==null&&n.memoizedState.isDehydrated)try{ia(e.containerInfo)}catch(S){Rt(t,t.return,S)}break;case 4:$n(e,t),di(t);break;case 13:$n(e,t),di(t),r=t.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(Zf=Nt())),i&4&&u0(t);break;case 22:if(d=n!==null&&n.memoizedState!==null,t.mode&1?(sn=(c=sn)||d,$n(e,t),sn=c):$n(e,t),di(t),i&8192){if(c=t.memoizedState!==null,(t.stateNode.isHidden=c)&&!d&&(t.mode&1)!==0)for(Me=t,d=t.child;d!==null;){for(f=Me=d;Me!==null;){switch(h=Me,p=h.child,h.tag){case 0:case 11:case 14:case 15:$o(4,h,h.return);break;case 1:Rs(h,h.return);var _=h.stateNode;if(typeof _.componentWillUnmount=="function"){i=h,n=h.return;try{e=i,_.props=e.memoizedProps,_.state=e.memoizedState,_.componentWillUnmount()}catch(S){Rt(i,n,S)}}break;case 5:Rs(h,h.return);break;case 22:if(h.memoizedState!==null){d0(f);continue}}p!==null?(p.return=h,Me=p):d0(f)}d=d.sibling}e:for(d=null,f=t;;){if(f.tag===5){if(d===null){d=f;try{r=f.stateNode,c?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=f.stateNode,l=f.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=C0("display",o))}catch(S){Rt(t,t.return,S)}}}else if(f.tag===6){if(d===null)try{f.stateNode.nodeValue=c?"":f.memoizedProps}catch(S){Rt(t,t.return,S)}}else if((f.tag!==22&&f.tag!==23||f.memoizedState===null||f===t)&&f.child!==null){f.child.return=f,f=f.child;continue}if(f===t)break e;for(;f.sibling===null;){if(f.return===null||f.return===t)break e;d===f&&(d=null),f=f.return}d===f&&(d=null),f.sibling.return=f.return,f=f.sibling}}break;case 19:$n(e,t),di(t),i&4&&u0(t);break;case 21:break;default:$n(e,t),di(t)}}function di(t){var e=t.flags;if(e&2){try{e:{for(var n=t.return;n!==null;){if(ev(n)){var i=n;break e}n=n.return}throw Error(oe(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(Qo(r,""),i.flags&=-33);var s=c0(t);lf(t,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=c0(t);af(t,a,o);break;default:throw Error(oe(161))}}catch(l){Rt(t,t.return,l)}t.flags&=-3}e&4096&&(t.flags&=-4097)}function CM(t,e,n){Me=t,iv(t,e,n)}function iv(t,e,n){for(var i=(t.mode&1)!==0;Me!==null;){var r=Me,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||Ol;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||sn;a=Ol;var c=sn;if(Ol=o,(sn=l)&&!c)for(Me=r;Me!==null;)o=Me,l=o.child,o.tag===22&&o.memoizedState!==null?f0(r):l!==null?(l.return=o,Me=l):f0(r);for(;s!==null;)Me=s,iv(s,e,n),s=s.sibling;Me=r,Ol=a,sn=c}h0(t,e,n)}else(r.subtreeFlags&8772)!==0&&s!==null?(s.return=r,Me=s):h0(t,e,n)}}function h0(t){for(;Me!==null;){var e=Me;if((e.flags&8772)!==0){var n=e.alternate;try{if((e.flags&8772)!==0)switch(e.tag){case 0:case 11:case 15:sn||Ac(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!sn)if(n===null)i.componentDidMount();else{var r=e.elementType===e.type?n.memoizedProps:Jn(e.type,n.memoizedProps);i.componentDidUpdate(r,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&$g(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(n=null,e.child!==null)switch(e.child.tag){case 5:n=e.child.stateNode;break;case 1:n=e.child.stateNode}$g(e,o,n)}break;case 5:var a=e.stateNode;if(n===null&&e.flags&4){n=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&n.focus();break;case"img":l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var c=e.alternate;if(c!==null){var d=c.memoizedState;if(d!==null){var f=d.dehydrated;f!==null&&ia(f)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(oe(163))}sn||e.flags&512&&of(e)}catch(h){Rt(e,e.return,h)}}if(e===t){Me=null;break}if(n=e.sibling,n!==null){n.return=e.return,Me=n;break}Me=e.return}}function d0(t){for(;Me!==null;){var e=Me;if(e===t){Me=null;break}var n=e.sibling;if(n!==null){n.return=e.return,Me=n;break}Me=e.return}}function f0(t){for(;Me!==null;){var e=Me;try{switch(e.tag){case 0:case 11:case 15:var n=e.return;try{Ac(4,e)}catch(l){Rt(e,n,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){Rt(e,r,l)}}var s=e.return;try{of(e)}catch(l){Rt(e,s,l)}break;case 5:var o=e.return;try{of(e)}catch(l){Rt(e,o,l)}}}catch(l){Rt(e,e.return,l)}if(e===t){Me=null;break}var a=e.sibling;if(a!==null){a.return=e.return,Me=a;break}Me=e.return}}var RM=Math.ceil,pc=Vi.ReactCurrentDispatcher,qf=Vi.ReactCurrentOwner,Vn=Vi.ReactCurrentBatchConfig,et=0,Gt=null,Dt=null,Zt=0,En=0,Ps=Sr(0),kt=0,pa=null,Qr=0,Cc=0,Yf=0,Jo=null,gn=null,Zf=0,Gs=1/0,Li=null,mc=!1,cf=null,mr=null,Bl=!1,cr=null,gc=0,Ko=0,uf=null,ql=-1,Yl=0;function fn(){return(et&6)!==0?Nt():ql!==-1?ql:ql=Nt()}function gr(t){return(t.mode&1)===0?1:(et&2)!==0&&Zt!==0?Zt&-Zt:dM.transition!==null?(Yl===0&&(Yl=V0()),Yl):(t=at,t!==0||(t=window.event,t=t===void 0?16:Z0(t.type)),t)}function ei(t,e,n,i){if(50<Ko)throw Ko=0,uf=null,Error(oe(185));ma(t,n,i),((et&2)===0||t!==Gt)&&(t===Gt&&((et&2)===0&&(Cc|=n),kt===4&&ar(t,Zt)),yn(t,i),n===1&&et===0&&(e.mode&1)===0&&(Gs=Nt()+500,Ec&&Mr()))}function yn(t,e){var n=t.callbackNode;pS(t,e);var i=Ql(t,t===Gt?Zt:0);if(i===0)n!==null&&Sg(n),t.callbackNode=null,t.callbackPriority=0;else if(e=i&-i,t.callbackPriority!==e){if(n!=null&&Sg(n),e===1)t.tag===0?hM(p0.bind(null,t)):f_(p0.bind(null,t)),aM(function(){(et&6)===0&&Mr()}),n=null;else{switch(H0(i)){case 1:n=yf;break;case 4:n=k0;break;case 16:n=jl;break;case 536870912:n=z0;break;default:n=jl}n=hv(n,rv.bind(null,t))}t.callbackPriority=e,t.callbackNode=n}}function rv(t,e){if(ql=-1,Yl=0,(et&6)!==0)throw Error(oe(327));var n=t.callbackNode;if(Fs()&&t.callbackNode!==n)return null;var i=Ql(t,t===Gt?Zt:0);if(i===0)return null;if((i&30)!==0||(i&t.expiredLanes)!==0||e)e=_c(t,i);else{e=i;var r=et;et|=2;var s=ov();(Gt!==t||Zt!==e)&&(Li=null,Gs=Nt()+500,Zr(t,e));do try{LM();break}catch(a){sv(t,a)}while(!0);Nf(),pc.current=s,et=r,Dt!==null?e=0:(Gt=null,Zt=0,e=kt)}if(e!==0){if(e===2&&(r=Fd(t),r!==0&&(i=r,e=hf(t,r))),e===1)throw n=pa,Zr(t,0),ar(t,i),yn(t,Nt()),n;if(e===6)ar(t,i);else{if(r=t.current.alternate,(i&30)===0&&!PM(r)&&(e=_c(t,i),e===2&&(s=Fd(t),s!==0&&(i=s,e=hf(t,s))),e===1))throw n=pa,Zr(t,0),ar(t,i),yn(t,Nt()),n;switch(t.finishedWork=r,t.finishedLanes=i,e){case 0:case 1:throw Error(oe(345));case 2:Wr(t,gn,Li);break;case 3:if(ar(t,i),(i&130023424)===i&&(e=Zf+500-Nt(),10<e)){if(Ql(t,0)!==0)break;if(r=t.suspendedLanes,(r&i)!==i){fn(),t.pingedLanes|=t.suspendedLanes&r;break}t.timeoutHandle=Wd(Wr.bind(null,t,gn,Li),e);break}Wr(t,gn,Li);break;case 4:if(ar(t,i),(i&4194240)===i)break;for(e=t.eventTimes,r=-1;0<i;){var o=31-Qn(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=Nt()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*RM(i/1960))-i,10<i){t.timeoutHandle=Wd(Wr.bind(null,t,gn,Li),i);break}Wr(t,gn,Li);break;case 5:Wr(t,gn,Li);break;default:throw Error(oe(329))}}}return yn(t,Nt()),t.callbackNode===n?rv.bind(null,t):null}function hf(t,e){var n=Jo;return t.current.memoizedState.isDehydrated&&(Zr(t,e).flags|=256),t=_c(t,e),t!==2&&(e=gn,gn=n,e!==null&&df(e)),t}function df(t){gn===null?gn=t:gn.push.apply(gn,t)}function PM(t){for(var e=t;;){if(e.flags&16384){var n=e.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var i=0;i<n.length;i++){var r=n[i],s=r.getSnapshot;r=r.value;try{if(!ti(s(),r))return!1}catch{return!1}}}if(n=e.child,e.subtreeFlags&16384&&n!==null)n.return=e,e=n;else{if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function ar(t,e){for(e&=~Yf,e&=~Cc,t.suspendedLanes|=e,t.pingedLanes&=~e,t=t.expirationTimes;0<e;){var n=31-Qn(e),i=1<<n;t[n]=-1,e&=~i}}function p0(t){if((et&6)!==0)throw Error(oe(327));Fs();var e=Ql(t,0);if((e&1)===0)return yn(t,Nt()),null;var n=_c(t,e);if(t.tag!==0&&n===2){var i=Fd(t);i!==0&&(e=i,n=hf(t,i))}if(n===1)throw n=pa,Zr(t,0),ar(t,e),yn(t,Nt()),n;if(n===6)throw Error(oe(345));return t.finishedWork=t.current.alternate,t.finishedLanes=e,Wr(t,gn,Li),yn(t,Nt()),null}function $f(t,e){var n=et;et|=1;try{return t(e)}finally{et=n,et===0&&(Gs=Nt()+500,Ec&&Mr())}}function es(t){cr!==null&&cr.tag===0&&(et&6)===0&&Fs();var e=et;et|=1;var n=Vn.transition,i=at;try{if(Vn.transition=null,at=1,t)return t()}finally{at=i,Vn.transition=n,et=e,(et&6)===0&&Mr()}}function Jf(){En=Ps.current,xt(Ps)}function Zr(t,e){t.finishedWork=null,t.finishedLanes=0;var n=t.timeoutHandle;if(n!==-1&&(t.timeoutHandle=-1,oM(n)),Dt!==null)for(n=Dt.return;n!==null;){var i=n;switch(Pf(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&rc();break;case 3:Vs(),xt(vn),xt(on),kf();break;case 5:Bf(i);break;case 4:Vs();break;case 13:xt(Mt);break;case 19:xt(Mt);break;case 10:Df(i.type._context);break;case 22:case 23:Jf()}n=n.return}if(Gt=t,Dt=t=_r(t.current,null),Zt=En=e,kt=0,pa=null,Yf=Cc=Qr=0,gn=Jo=null,qr!==null){for(e=0;e<qr.length;e++)if(n=qr[e],i=n.interleaved,i!==null){n.interleaved=null;var r=i.next,s=n.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}n.pending=i}qr=null}return t}function sv(t,e){do{var n=Dt;try{if(Nf(),Gl.current=fc,dc){for(var i=wt.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}dc=!1}if(jr=0,Ht=Bt=wt=null,Zo=!1,ha=0,qf.current=null,n===null||n.return===null){kt=1,pa=e,Dt=null;break}e:{var s=t,o=n.return,a=n,l=e;if(e=Zt,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var c=l,d=a,f=d.tag;if((d.mode&1)===0&&(f===0||f===11||f===15)){var h=d.alternate;h?(d.updateQueue=h.updateQueue,d.memoizedState=h.memoizedState,d.lanes=h.lanes):(d.updateQueue=null,d.memoizedState=null)}var p=t0(o);if(p!==null){p.flags&=-257,n0(p,o,a,s,e),p.mode&1&&e0(s,c,e),e=p,l=c;var _=e.updateQueue;if(_===null){var S=new Set;S.add(l),e.updateQueue=S}else _.add(l);break e}else{if((e&1)===0){e0(s,c,e),Kf();break e}l=Error(oe(426))}}else if(St&&a.mode&1){var g=t0(o);if(g!==null){(g.flags&65536)===0&&(g.flags|=256),n0(g,o,a,s,e),If(Hs(l,a));break e}}s=l=Hs(l,a),kt!==4&&(kt=2),Jo===null?Jo=[s]:Jo.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var u=H_(s,l,e);Zg(s,u);break e;case 1:a=l;var m=s.type,v=s.stateNode;if((s.flags&128)===0&&(typeof m.getDerivedStateFromError=="function"||v!==null&&typeof v.componentDidCatch=="function"&&(mr===null||!mr.has(v)))){s.flags|=65536,e&=-e,s.lanes|=e;var M=G_(s,a,e);Zg(s,M);break e}}s=s.return}while(s!==null)}lv(n)}catch(A){e=A,Dt===n&&n!==null&&(Dt=n=n.return);continue}break}while(!0)}function ov(){var t=pc.current;return pc.current=fc,t===null?fc:t}function Kf(){(kt===0||kt===3||kt===2)&&(kt=4),Gt===null||(Qr&268435455)===0&&(Cc&268435455)===0||ar(Gt,Zt)}function _c(t,e){var n=et;et|=2;var i=ov();(Gt!==t||Zt!==e)&&(Li=null,Zr(t,e));do try{IM();break}catch(r){sv(t,r)}while(!0);if(Nf(),et=n,pc.current=i,Dt!==null)throw Error(oe(261));return Gt=null,Zt=0,kt}function IM(){for(;Dt!==null;)av(Dt)}function LM(){for(;Dt!==null&&!sS();)av(Dt)}function av(t){var e=uv(t.alternate,t,En);t.memoizedProps=t.pendingProps,e===null?lv(t):Dt=e,qf.current=null}function lv(t){var e=t;do{var n=e.alternate;if(t=e.return,(e.flags&32768)===0){if(n=EM(n,e,En),n!==null){Dt=n;return}}else{if(n=TM(n,e),n!==null){n.flags&=32767,Dt=n;return}if(t!==null)t.flags|=32768,t.subtreeFlags=0,t.deletions=null;else{kt=6,Dt=null;return}}if(e=e.sibling,e!==null){Dt=e;return}Dt=e=t}while(e!==null);kt===0&&(kt=5)}function Wr(t,e,n){var i=at,r=Vn.transition;try{Vn.transition=null,at=1,NM(t,e,n,i)}finally{Vn.transition=r,at=i}return null}function NM(t,e,n,i){do Fs();while(cr!==null);if((et&6)!==0)throw Error(oe(327));n=t.finishedWork;var r=t.finishedLanes;if(n===null)return null;if(t.finishedWork=null,t.finishedLanes=0,n===t.current)throw Error(oe(177));t.callbackNode=null,t.callbackPriority=0;var s=n.lanes|n.childLanes;if(mS(t,s),t===Gt&&(Dt=Gt=null,Zt=0),(n.subtreeFlags&2064)===0&&(n.flags&2064)===0||Bl||(Bl=!0,hv(jl,function(){return Fs(),null})),s=(n.flags&15990)!==0,(n.subtreeFlags&15990)!==0||s){s=Vn.transition,Vn.transition=null;var o=at;at=1;var a=et;et|=4,qf.current=null,AM(t,n),nv(n,t),tM(Hd),ec=!!Vd,Hd=Vd=null,t.current=n,CM(n,t,r),oS(),et=a,at=o,Vn.transition=s}else t.current=n;if(Bl&&(Bl=!1,cr=t,gc=r),s=t.pendingLanes,s===0&&(mr=null),cS(n.stateNode,i),yn(t,Nt()),e!==null)for(i=t.onRecoverableError,n=0;n<e.length;n++)r=e[n],i(r.value,{componentStack:r.stack,digest:r.digest});if(mc)throw mc=!1,t=cf,cf=null,t;return(gc&1)!==0&&t.tag!==0&&Fs(),s=t.pendingLanes,(s&1)!==0?t===uf?Ko++:(Ko=0,uf=t):Ko=0,Mr(),null}function Fs(){if(cr!==null){var t=H0(gc),e=Vn.transition,n=at;try{if(Vn.transition=null,at=16>t?16:t,cr===null)var i=!1;else{if(t=cr,cr=null,gc=0,(et&6)!==0)throw Error(oe(331));var r=et;for(et|=4,Me=t.current;Me!==null;){var s=Me,o=s.child;if((Me.flags&16)!==0){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var c=a[l];for(Me=c;Me!==null;){var d=Me;switch(d.tag){case 0:case 11:case 15:$o(8,d,s)}var f=d.child;if(f!==null)f.return=d,Me=f;else for(;Me!==null;){d=Me;var h=d.sibling,p=d.return;if(Q_(d),d===c){Me=null;break}if(h!==null){h.return=p,Me=h;break}Me=p}}}var _=s.alternate;if(_!==null){var S=_.child;if(S!==null){_.child=null;do{var g=S.sibling;S.sibling=null,S=g}while(S!==null)}}Me=s}}if((s.subtreeFlags&2064)!==0&&o!==null)o.return=s,Me=o;else e:for(;Me!==null;){if(s=Me,(s.flags&2048)!==0)switch(s.tag){case 0:case 11:case 15:$o(9,s,s.return)}var u=s.sibling;if(u!==null){u.return=s.return,Me=u;break e}Me=s.return}}var m=t.current;for(Me=m;Me!==null;){o=Me;var v=o.child;if((o.subtreeFlags&2064)!==0&&v!==null)v.return=o,Me=v;else e:for(o=m;Me!==null;){if(a=Me,(a.flags&2048)!==0)try{switch(a.tag){case 0:case 11:case 15:Ac(9,a)}}catch(A){Rt(a,a.return,A)}if(a===o){Me=null;break e}var M=a.sibling;if(M!==null){M.return=a.return,Me=M;break e}Me=a.return}}if(et=r,Mr(),mi&&typeof mi.onPostCommitFiberRoot=="function")try{mi.onPostCommitFiberRoot(xc,t)}catch{}i=!0}return i}finally{at=n,Vn.transition=e}}return!1}function m0(t,e,n){e=Hs(n,e),e=H_(t,e,1),t=pr(t,e,1),e=fn(),t!==null&&(ma(t,1,e),yn(t,e))}function Rt(t,e,n){if(t.tag===3)m0(t,t,n);else for(;e!==null;){if(e.tag===3){m0(e,t,n);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(mr===null||!mr.has(i))){t=Hs(n,t),t=G_(e,t,1),e=pr(e,t,1),t=fn(),e!==null&&(ma(e,1,t),yn(e,t));break}}e=e.return}}function DM(t,e,n){var i=t.pingCache;i!==null&&i.delete(e),e=fn(),t.pingedLanes|=t.suspendedLanes&n,Gt===t&&(Zt&n)===n&&(kt===4||kt===3&&(Zt&130023424)===Zt&&500>Nt()-Zf?Zr(t,0):Yf|=n),yn(t,e)}function cv(t,e){e===0&&((t.mode&1)===0?e=1:(e=El,El<<=1,(El&130023424)===0&&(El=4194304)));var n=fn();t=ki(t,e),t!==null&&(ma(t,e,n),yn(t,n))}function UM(t){var e=t.memoizedState,n=0;e!==null&&(n=e.retryLane),cv(t,n)}function FM(t,e){var n=0;switch(t.tag){case 13:var i=t.stateNode,r=t.memoizedState;r!==null&&(n=r.retryLane);break;case 19:i=t.stateNode;break;default:throw Error(oe(314))}i!==null&&i.delete(e),cv(t,n)}var uv;uv=function(t,e,n){if(t!==null)if(t.memoizedProps!==e.pendingProps||vn.current)_n=!0;else{if((t.lanes&n)===0&&(e.flags&128)===0)return _n=!1,wM(t,e,n);_n=(t.flags&131072)!==0}else _n=!1,St&&(e.flags&1048576)!==0&&p_(e,ac,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;Xl(t,e),t=e.pendingProps;var r=Bs(e,on.current);Us(e,n),r=Vf(null,e,i,t,r,n);var s=Hf();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,xn(i)?(s=!0,sc(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,Ff(e),r.updater=bc,e.stateNode=r,r._reactInternals=e,Kd(e,i,t,n),e=ef(null,e,i,!0,s,n)):(e.tag=0,St&&s&&Rf(e),dn(null,e,r,n),e=e.child),e;case 16:i=e.elementType;e:{switch(Xl(t,e),t=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=BM(i),t=Jn(i,t),r){case 0:e=Qd(null,e,i,t,n);break e;case 1:e=s0(null,e,i,t,n);break e;case 11:e=i0(null,e,i,t,n);break e;case 14:e=r0(null,e,i,Jn(i.type,t),n);break e}throw Error(oe(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Jn(i,r),Qd(t,e,i,r,n);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Jn(i,r),s0(t,e,i,r,n);case 3:e:{if(Y_(e),t===null)throw Error(oe(387));i=e.pendingProps,s=e.memoizedState,r=s.element,y_(t,e),uc(e,i,null,n);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=Hs(Error(oe(423)),e),e=o0(t,e,i,n,r);break e}else if(i!==r){r=Hs(Error(oe(424)),e),e=o0(t,e,i,n,r);break e}else for(Tn=fr(e.stateNode.containerInfo.firstChild),bn=e,St=!0,jn=null,n=v_(e,null,i,n),e.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if(ks(),i===r){e=zi(t,e,n);break e}dn(t,e,i,n)}e=e.child}return e;case 5:return S_(e),t===null&&Zd(e),i=e.type,r=e.pendingProps,s=t!==null?t.memoizedProps:null,o=r.children,Gd(i,r)?o=null:s!==null&&Gd(i,s)&&(e.flags|=32),q_(t,e),dn(t,e,o,n),e.child;case 6:return t===null&&Zd(e),null;case 13:return Z_(t,e,n);case 4:return Of(e,e.stateNode.containerInfo),i=e.pendingProps,t===null?e.child=zs(e,null,i,n):dn(t,e,i,n),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Jn(i,r),i0(t,e,i,r,n);case 7:return dn(t,e,e.pendingProps,n),e.child;case 8:return dn(t,e,e.pendingProps.children,n),e.child;case 12:return dn(t,e,e.pendingProps.children,n),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,_t(lc,i._currentValue),i._currentValue=o,s!==null)if(ti(s.value,o)){if(s.children===r.children&&!vn.current){e=zi(t,e,n);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=Fi(-1,n&-n),l.tag=2;var c=s.updateQueue;if(c!==null){c=c.shared;var d=c.pending;d===null?l.next=l:(l.next=d.next,d.next=l),c.pending=l}}s.lanes|=n,l=s.alternate,l!==null&&(l.lanes|=n),$d(s.return,n,e),a.lanes|=n;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(oe(341));o.lanes|=n,a=o.alternate,a!==null&&(a.lanes|=n),$d(o,n,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}dn(t,e,r.children,n),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,Us(e,n),r=Hn(r),i=i(r),e.flags|=1,dn(t,e,i,n),e.child;case 14:return i=e.type,r=Jn(i,e.pendingProps),r=Jn(i.type,r),r0(t,e,i,r,n);case 15:return W_(t,e,e.type,e.pendingProps,n);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Jn(i,r),Xl(t,e),e.tag=1,xn(i)?(t=!0,sc(e)):t=!1,Us(e,n),V_(e,i,r),Kd(e,i,r,n),ef(null,e,i,!0,t,n);case 19:return $_(t,e,n);case 22:return X_(t,e,n)}throw Error(oe(156,e.tag))};function hv(t,e){return B0(t,e)}function OM(t,e,n,i){this.tag=t,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function zn(t,e,n,i){return new OM(t,e,n,i)}function jf(t){return t=t.prototype,!(!t||!t.isReactComponent)}function BM(t){if(typeof t=="function")return jf(t)?1:0;if(t!=null){if(t=t.$$typeof,t===_f)return 11;if(t===vf)return 14}return 2}function _r(t,e){var n=t.alternate;return n===null?(n=zn(t.tag,e,t.key,t.mode),n.elementType=t.elementType,n.type=t.type,n.stateNode=t.stateNode,n.alternate=t,t.alternate=n):(n.pendingProps=e,n.type=t.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=t.flags&14680064,n.childLanes=t.childLanes,n.lanes=t.lanes,n.child=t.child,n.memoizedProps=t.memoizedProps,n.memoizedState=t.memoizedState,n.updateQueue=t.updateQueue,e=t.dependencies,n.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},n.sibling=t.sibling,n.index=t.index,n.ref=t.ref,n}function Zl(t,e,n,i,r,s){var o=2;if(i=t,typeof t=="function")jf(t)&&(o=1);else if(typeof t=="string")o=5;else e:switch(t){case ys:return $r(n.children,r,s,e);case gf:o=8,r|=8;break;case Sd:return t=zn(12,n,e,r|2),t.elementType=Sd,t.lanes=s,t;case Md:return t=zn(13,n,e,r),t.elementType=Md,t.lanes=s,t;case wd:return t=zn(19,n,e,r),t.elementType=wd,t.lanes=s,t;case S0:return Rc(n,r,s,e);default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case x0:o=10;break e;case y0:o=9;break e;case _f:o=11;break e;case vf:o=14;break e;case rr:o=16,i=null;break e}throw Error(oe(130,t==null?t:typeof t,""))}return e=zn(o,n,e,r),e.elementType=t,e.type=i,e.lanes=s,e}function $r(t,e,n,i){return t=zn(7,t,i,e),t.lanes=n,t}function Rc(t,e,n,i){return t=zn(22,t,i,e),t.elementType=S0,t.lanes=n,t.stateNode={isHidden:!1},t}function vd(t,e,n){return t=zn(6,t,null,e),t.lanes=n,t}function xd(t,e,n){return e=zn(4,t.children!==null?t.children:[],t.key,e),e.lanes=n,e.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},e}function kM(t,e,n,i,r){this.tag=e,this.containerInfo=t,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=nd(0),this.expirationTimes=nd(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=nd(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function Qf(t,e,n,i,r,s,o,a,l){return t=new kM(t,e,n,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=zn(3,null,null,e),t.current=s,s.stateNode=t,s.memoizedState={element:i,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},Ff(s),t}function zM(t,e,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:xs,key:i==null?null:""+i,children:t,containerInfo:e,implementation:n}}function dv(t){if(!t)return xr;t=t._reactInternals;e:{if(ns(t)!==t||t.tag!==1)throw Error(oe(170));var e=t;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(xn(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(oe(171))}if(t.tag===1){var n=t.type;if(xn(n))return d_(t,n,e)}return e}function fv(t,e,n,i,r,s,o,a,l){return t=Qf(n,i,!0,t,r,s,o,a,l),t.context=dv(null),n=t.current,i=fn(),r=gr(n),s=Fi(i,r),s.callback=e??null,pr(n,s,r),t.current.lanes=r,ma(t,r,i),yn(t,i),t}function Pc(t,e,n,i){var r=e.current,s=fn(),o=gr(r);return n=dv(n),e.context===null?e.context=n:e.pendingContext=n,e=Fi(s,o),e.payload={element:t},i=i===void 0?null:i,i!==null&&(e.callback=i),t=pr(r,e,o),t!==null&&(ei(t,r,o,s),Hl(t,r,o)),o}function vc(t){if(t=t.current,!t.child)return null;switch(t.child.tag){case 5:return t.child.stateNode;default:return t.child.stateNode}}function g0(t,e){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var n=t.retryLane;t.retryLane=n!==0&&n<e?n:e}}function ep(t,e){g0(t,e),(t=t.alternate)&&g0(t,e)}function VM(){return null}var pv=typeof reportError=="function"?reportError:function(t){console.error(t)};function tp(t){this._internalRoot=t}Ic.prototype.render=tp.prototype.render=function(t){var e=this._internalRoot;if(e===null)throw Error(oe(409));Pc(t,e,null,null)};Ic.prototype.unmount=tp.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var e=t.containerInfo;es(function(){Pc(null,t,null,null)}),e[Bi]=null}};function Ic(t){this._internalRoot=t}Ic.prototype.unstable_scheduleHydration=function(t){if(t){var e=X0();t={blockedOn:null,target:t,priority:e};for(var n=0;n<or.length&&e!==0&&e<or[n].priority;n++);or.splice(n,0,t),n===0&&Y0(t)}};function np(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function Lc(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11&&(t.nodeType!==8||t.nodeValue!==" react-mount-point-unstable "))}function _0(){}function HM(t,e,n,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var c=vc(o);s.call(c)}}var o=fv(e,i,t,0,null,!1,!1,"",_0);return t._reactRootContainer=o,t[Bi]=o.current,oa(t.nodeType===8?t.parentNode:t),es(),o}for(;r=t.lastChild;)t.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var c=vc(l);a.call(c)}}var l=Qf(t,0,!1,null,null,!1,!1,"",_0);return t._reactRootContainer=l,t[Bi]=l.current,oa(t.nodeType===8?t.parentNode:t),es(function(){Pc(e,l,n,i)}),l}function Nc(t,e,n,i,r){var s=n._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=vc(o);a.call(l)}}Pc(e,o,t,r)}else o=HM(n,e,t,r,i);return vc(o)}G0=function(t){switch(t.tag){case 3:var e=t.stateNode;if(e.current.memoizedState.isDehydrated){var n=Vo(e.pendingLanes);n!==0&&(Sf(e,n|1),yn(e,Nt()),(et&6)===0&&(Gs=Nt()+500,Mr()))}break;case 13:es(function(){var i=ki(t,1);if(i!==null){var r=fn();ei(i,t,1,r)}}),ep(t,1)}};Mf=function(t){if(t.tag===13){var e=ki(t,134217728);if(e!==null){var n=fn();ei(e,t,134217728,n)}ep(t,134217728)}};W0=function(t){if(t.tag===13){var e=gr(t),n=ki(t,e);if(n!==null){var i=fn();ei(n,t,e,i)}ep(t,e)}};X0=function(){return at};q0=function(t,e){var n=at;try{return at=t,e()}finally{at=n}};Nd=function(t,e,n){switch(e){case"input":if(bd(t,n),e=n.name,n.type==="radio"&&e!=null){for(n=t;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<n.length;e++){var i=n[e];if(i!==t&&i.form===t.form){var r=wc(i);if(!r)throw Error(oe(90));w0(i),bd(i,r)}}}break;case"textarea":T0(t,n);break;case"select":e=n.value,e!=null&&Is(t,!!n.multiple,e,!1)}};L0=$f;N0=es;var GM={usingClientEntryPoint:!1,Events:[_a,Es,wc,P0,I0,$f]},Oo={findFiberByHostInstance:Xr,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},WM={bundleType:Oo.bundleType,version:Oo.version,rendererPackageName:Oo.rendererPackageName,rendererConfig:Oo.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:Vi.ReactCurrentDispatcher,findHostInstanceByFiber:function(t){return t=F0(t),t===null?null:t.stateNode},findFiberByHostInstance:Oo.findFiberByHostInstance||VM,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(Bo=__REACT_DEVTOOLS_GLOBAL_HOOK__,!Bo.isDisabled&&Bo.supportsFiber))try{xc=Bo.inject(WM),mi=Bo}catch{}var Bo;Rn.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=GM;Rn.createPortal=function(t,e){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!np(e))throw Error(oe(200));return zM(t,e,null,n)};Rn.createRoot=function(t,e){if(!np(t))throw Error(oe(299));var n=!1,i="",r=pv;return e!=null&&(e.unstable_strictMode===!0&&(n=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=Qf(t,1,!1,null,null,n,!1,i,r),t[Bi]=e.current,oa(t.nodeType===8?t.parentNode:t),new tp(e)};Rn.findDOMNode=function(t){if(t==null)return null;if(t.nodeType===1)return t;var e=t._reactInternals;if(e===void 0)throw typeof t.render=="function"?Error(oe(188)):(t=Object.keys(t).join(","),Error(oe(268,t)));return t=F0(e),t=t===null?null:t.stateNode,t};Rn.flushSync=function(t){return es(t)};Rn.hydrate=function(t,e,n){if(!Lc(e))throw Error(oe(200));return Nc(null,t,e,!0,n)};Rn.hydrateRoot=function(t,e,n){if(!np(t))throw Error(oe(405));var i=n!=null&&n.hydratedSources||null,r=!1,s="",o=pv;if(n!=null&&(n.unstable_strictMode===!0&&(r=!0),n.identifierPrefix!==void 0&&(s=n.identifierPrefix),n.onRecoverableError!==void 0&&(o=n.onRecoverableError)),e=fv(e,null,t,1,n??null,r,!1,s,o),t[Bi]=e.current,oa(t),i)for(t=0;t<i.length;t++)n=i[t],r=n._getVersion,r=r(n._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[n,r]:e.mutableSourceEagerHydrationData.push(n,r);return new Ic(e)};Rn.render=function(t,e,n){if(!Lc(e))throw Error(oe(200));return Nc(null,t,e,!1,n)};Rn.unmountComponentAtNode=function(t){if(!Lc(t))throw Error(oe(40));return t._reactRootContainer?(es(function(){Nc(null,null,t,!1,function(){t._reactRootContainer=null,t[Bi]=null})}),!0):!1};Rn.unstable_batchedUpdates=$f;Rn.unstable_renderSubtreeIntoContainer=function(t,e,n,i){if(!Lc(n))throw Error(oe(200));if(t==null||t._reactInternals===void 0)throw Error(oe(38));return Nc(t,e,n,!1,i)};Rn.version="18.3.1-next-f1338f8080-20240426"});var vv=Ii((qA,_v)=>{"use strict";function gv(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(gv)}catch(t){console.error(t)}}gv(),_v.exports=mv()});var yv=Ii(ip=>{"use strict";var xv=vv();ip.createRoot=xv.createRoot,ip.hydrateRoot=xv.hydrateRoot;var YA});var ay=Ii(Uh=>{"use strict";var CA=pl(),RA=Symbol.for("react.element"),PA=Symbol.for("react.fragment"),IA=Object.prototype.hasOwnProperty,LA=CA.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,NA={key:!0,ref:!0,__self:!0,__source:!0};function oy(t,e,n){var i,r={},s=null,o=null;n!==void 0&&(s=""+n),e.key!==void 0&&(s=""+e.key),e.ref!==void 0&&(o=e.ref);for(i in e)IA.call(e,i)&&!NA.hasOwnProperty(i)&&(r[i]=e[i]);if(t&&t.defaultProps)for(i in e=t.defaultProps,e)r[i]===void 0&&(r[i]=e[i]);return{$$typeof:RA,type:t,key:s,ref:o,props:r,_owner:LA.current}}Uh.Fragment=PA;Uh.jsx=oy;Uh.jsxs=oy});var Pm=Ii((E2,ly)=>{"use strict";ly.exports=ay()});var nt=ul(pl()),fy=ul(yv());var qv=0,Op=1,Yv=2;var qa=1,Zv=2,yo=3,$i=0,Qt=1,Xn=2,bi=0,ls=1,Bp=2,kp=3,zp=4,$v=5;var Pr=100,Jv=101,Kv=102,jv=103,Qv=104,ex=200,tx=201,nx=202,ix=203,iu=204,ru=205,rx=206,sx=207,ox=208,ax=209,lx=210,cx=211,ux=212,hx=213,dx=214,su=0,ou=1,au=2,cs=3,lu=4,cu=5,uu=6,hu=7,Vp=0,fx=1,px=2,oi=0,Hp=1,Gp=2,Wp=3,Xp=4,qp=5,Yp=6,Zp=7;var $p=300,Ur=301,hs=302,Vu=303,Hu=304,Ya=306,du=1e3,xi=1001,fu=1002,Xt=1003,mx=1004;var Za=1005;var Kt=1006,Gu=1007;var Fr=1008;var Mn=1009,Jp=1010,Kp=1011,So=1012,Wu=1013,ai=1014,li=1015,Ai=1016,Xu=1017,qu=1018,Mo=1020,jp=35902,Qp=35899,em=1021,tm=1022,qn=1023,yi=1026,Or=1027,nm=1028,Yu=1029,Br=1030,Zu=1031;var $u=1033,$a=33776,Ja=33777,Ka=33778,ja=33779,Ju=35840,Ku=35841,ju=35842,Qu=35843,eh=36196,th=37492,nh=37496,ih=37488,rh=37489,Qa=37490,sh=37491,oh=37808,ah=37809,lh=37810,ch=37811,uh=37812,hh=37813,dh=37814,fh=37815,ph=37816,mh=37817,gh=37818,_h=37819,vh=37820,xh=37821,yh=36492,Sh=36494,Mh=36495,wh=36283,Eh=36284,el=36285,Th=36286;var ba=2300,pu=2301,nu=2302,Ap=2303,Cp=2400,Rp=2401,Pp=2402;var gx=3200;var tl=0,_x=1,ji="",Jt="srgb",Aa="srgb-linear",Ca="linear",rt="srgb";var as=7680;var Ip=519,vx=512,xx=513,yx=514,bh=515,Sx=516,Mx=517,Ah=518,wx=519,Lp=35044;var im="300 es",si=2e3,oo=2001;function XM(t){for(let e=t.length-1;e>=0;--e)if(t[e]>=65535)return!0;return!1}function qM(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function Ra(t){return document.createElementNS("http://www.w3.org/1999/xhtml",t)}function Ex(){let t=Ra("canvas");return t.style.display="block",t}var Sv={},ao=null;function rm(...t){let e="THREE."+t.shift();ao?ao("log",e,...t):console.log(e,...t)}function Tx(t){let e=t[0];if(typeof e=="string"&&e.startsWith("TSL:")){let n=t[1];n&&n.isStackTrace?t[0]+=" "+n.getLocation():t[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return t}function Ie(...t){t=Tx(t);let e="THREE."+t.shift();if(ao)ao("warn",e,...t);else{let n=t[0];n&&n.isStackTrace?console.warn(n.getError(e)):console.warn(e,...t)}}function Ne(...t){t=Tx(t);let e="THREE."+t.shift();if(ao)ao("error",e,...t);else{let n=t[0];n&&n.isStackTrace?console.error(n.getError(e)):console.error(e,...t)}}function mu(...t){let e=t.join(" ");e in Sv||(Sv[e]=!0,Ie(...t))}function bx(t,e,n){return new Promise(function(i,r){function s(){switch(t.clientWaitSync(e,t.SYNC_FLUSH_COMMANDS_BIT,0)){case t.WAIT_FAILED:r();break;case t.TIMEOUT_EXPIRED:setTimeout(s,n);break;default:i()}}setTimeout(s,n)})}var Ax={[su]:ou,[au]:uu,[lu]:hu,[cs]:cu,[ou]:su,[uu]:au,[hu]:lu,[cu]:cs},Si=class{addEventListener(e,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(n)===-1&&i[e].push(n)}hasEventListener(e,n){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(n)!==-1}removeEventListener(e,n){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(n);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let n=this._listeners;if(n===void 0)return;let i=n[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},an=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Mv=1234567,Ea=Math.PI/180,lo=180/Math.PI;function wo(){let t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(an[t&255]+an[t>>8&255]+an[t>>16&255]+an[t>>24&255]+"-"+an[e&255]+an[e>>8&255]+"-"+an[e>>16&15|64]+an[e>>24&255]+"-"+an[n&63|128]+an[n>>8&255]+"-"+an[n>>16&255]+an[n>>24&255]+an[i&255]+an[i>>8&255]+an[i>>16&255]+an[i>>24&255]).toLowerCase()}function Je(t,e,n){return Math.max(e,Math.min(n,t))}function sm(t,e){return(t%e+e)%e}function YM(t,e,n,i,r){return i+(t-e)*(r-i)/(n-e)}function ZM(t,e,n){return t!==e?(n-t)/(e-t):0}function Ta(t,e,n){return(1-n)*t+n*e}function $M(t,e,n,i){return Ta(t,e,1-Math.exp(-n*i))}function JM(t,e=1){return e-Math.abs(sm(t,e*2)-e)}function KM(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*(3-2*t))}function jM(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*t*(t*(t*6-15)+10))}function QM(t,e){return t+Math.floor(Math.random()*(e-t+1))}function e1(t,e){return t+Math.random()*(e-t)}function t1(t){return t*(.5-Math.random())}function n1(t){t!==void 0&&(Mv=t);let e=Mv+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function i1(t){return t*Ea}function r1(t){return t*lo}function s1(t){return(t&t-1)===0&&t!==0}function o1(t){return Math.pow(2,Math.ceil(Math.log(t)/Math.LN2))}function a1(t){return Math.pow(2,Math.floor(Math.log(t)/Math.LN2))}function l1(t,e,n,i,r){let s=Math.cos,o=Math.sin,a=s(n/2),l=o(n/2),c=s((e+i)/2),d=o((e+i)/2),f=s((e-i)/2),h=o((e-i)/2),p=s((i-e)/2),_=o((i-e)/2);switch(r){case"XYX":t.set(a*d,l*f,l*h,a*c);break;case"YZY":t.set(l*h,a*d,l*f,a*c);break;case"ZXZ":t.set(l*f,l*h,a*d,a*c);break;case"XZX":t.set(a*d,l*_,l*p,a*c);break;case"YXY":t.set(l*p,a*d,l*_,a*c);break;case"ZYZ":t.set(l*_,l*p,a*d,a*c);break;default:Ie("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+r)}}function ro(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return t/4294967295;case Uint16Array:return t/65535;case Uint8Array:return t/255;case Int32Array:return Math.max(t/2147483647,-1);case Int16Array:return Math.max(t/32767,-1);case Int8Array:return Math.max(t/127,-1);default:throw new Error("Invalid component type.")}}function mn(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return Math.round(t*4294967295);case Uint16Array:return Math.round(t*65535);case Uint8Array:return Math.round(t*255);case Int32Array:return Math.round(t*2147483647);case Int16Array:return Math.round(t*32767);case Int8Array:return Math.round(t*127);default:throw new Error("Invalid component type.")}}var Ch={DEG2RAD:Ea,RAD2DEG:lo,generateUUID:wo,clamp:Je,euclideanModulo:sm,mapLinear:YM,inverseLerp:ZM,lerp:Ta,damp:$M,pingpong:JM,smoothstep:KM,smootherstep:jM,randInt:QM,randFloat:e1,randFloatSpread:t1,seededRandom:n1,degToRad:i1,radToDeg:r1,isPowerOfTwo:s1,ceilPowerOfTwo:o1,floorPowerOfTwo:a1,setQuaternionFromProperEuler:l1,normalize:mn,denormalize:ro},um=class um{constructor(e=0,n=0){this.x=e,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,n){return this.x=e,this.y=n,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let n=this.x,i=this.y,r=e.elements;return this.x=r[0]*n+r[3]*i+r[6],this.y=r[1]*n+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,n){return this.x=Je(this.x,e.x,n.x),this.y=Je(this.y,e.y,n.y),this}clampScalar(e,n){return this.x=Je(this.x,e,n),this.y=Je(this.y,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Je(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Je(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y;return n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this}rotateAround(e,n){let i=Math.cos(n),r=Math.sin(n),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};um.prototype.isVector2=!0;var Ke=um,Mi=class{constructor(e=0,n=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=n,this._z=i,this._w=r}static slerpFlat(e,n,i,r,s,o,a){let l=i[r+0],c=i[r+1],d=i[r+2],f=i[r+3],h=s[o+0],p=s[o+1],_=s[o+2],S=s[o+3];if(f!==S||l!==h||c!==p||d!==_){let g=l*h+c*p+d*_+f*S;g<0&&(h=-h,p=-p,_=-_,S=-S,g=-g);let u=1-a;if(g<.9995){let m=Math.acos(g),v=Math.sin(m);u=Math.sin(u*m)/v,a=Math.sin(a*m)/v,l=l*u+h*a,c=c*u+p*a,d=d*u+_*a,f=f*u+S*a}else{l=l*u+h*a,c=c*u+p*a,d=d*u+_*a,f=f*u+S*a;let m=1/Math.sqrt(l*l+c*c+d*d+f*f);l*=m,c*=m,d*=m,f*=m}}e[n]=l,e[n+1]=c,e[n+2]=d,e[n+3]=f}static multiplyQuaternionsFlat(e,n,i,r,s,o){let a=i[r],l=i[r+1],c=i[r+2],d=i[r+3],f=s[o],h=s[o+1],p=s[o+2],_=s[o+3];return e[n]=a*_+d*f+l*p-c*h,e[n+1]=l*_+d*h+c*f-a*p,e[n+2]=c*_+d*p+a*h-l*f,e[n+3]=d*_-a*f-l*h-c*p,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,n,i,r){return this._x=e,this._y=n,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,n=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(i/2),d=a(r/2),f=a(s/2),h=l(i/2),p=l(r/2),_=l(s/2);switch(o){case"XYZ":this._x=h*d*f+c*p*_,this._y=c*p*f-h*d*_,this._z=c*d*_+h*p*f,this._w=c*d*f-h*p*_;break;case"YXZ":this._x=h*d*f+c*p*_,this._y=c*p*f-h*d*_,this._z=c*d*_-h*p*f,this._w=c*d*f+h*p*_;break;case"ZXY":this._x=h*d*f-c*p*_,this._y=c*p*f+h*d*_,this._z=c*d*_+h*p*f,this._w=c*d*f-h*p*_;break;case"ZYX":this._x=h*d*f-c*p*_,this._y=c*p*f+h*d*_,this._z=c*d*_-h*p*f,this._w=c*d*f+h*p*_;break;case"YZX":this._x=h*d*f+c*p*_,this._y=c*p*f+h*d*_,this._z=c*d*_-h*p*f,this._w=c*d*f-h*p*_;break;case"XZY":this._x=h*d*f-c*p*_,this._y=c*p*f-h*d*_,this._z=c*d*_+h*p*f,this._w=c*d*f+h*p*_;break;default:Ie("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,n){let i=n/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let n=e.elements,i=n[0],r=n[4],s=n[8],o=n[1],a=n[5],l=n[9],c=n[2],d=n[6],f=n[10],h=i+a+f;if(h>0){let p=.5/Math.sqrt(h+1);this._w=.25/p,this._x=(d-l)*p,this._y=(s-c)*p,this._z=(o-r)*p}else if(i>a&&i>f){let p=2*Math.sqrt(1+i-a-f);this._w=(d-l)/p,this._x=.25*p,this._y=(r+o)/p,this._z=(s+c)/p}else if(a>f){let p=2*Math.sqrt(1+a-i-f);this._w=(s-c)/p,this._x=(r+o)/p,this._y=.25*p,this._z=(l+d)/p}else{let p=2*Math.sqrt(1+f-i-a);this._w=(o-r)/p,this._x=(s+c)/p,this._y=(l+d)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(e,n){let i=e.dot(n)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*n.z-e.z*n.y,this._y=e.z*n.x-e.x*n.z,this._z=e.x*n.y-e.y*n.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Je(this.dot(e),-1,1)))}rotateTowards(e,n){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,n/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=n._x,l=n._y,c=n._z,d=n._w;return this._x=i*d+o*a+r*c-s*l,this._y=r*d+o*l+s*a-i*c,this._z=s*d+o*c+i*l-r*a,this._w=o*d-i*a-r*l-s*c,this._onChangeCallback(),this}slerp(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=this.dot(e);a<0&&(i=-i,r=-r,s=-s,o=-o,a=-a);let l=1-n;if(a<.9995){let c=Math.acos(a),d=Math.sin(c);l=Math.sin(l*c)/d,n=Math.sin(n*c)/d,this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this._onChangeCallback()}else this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this.normalize();return this}slerpQuaternions(e,n,i){return this.copy(e).slerp(n,i)}random(){let e=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(n),s*Math.cos(n))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,n=0){return this._x=e[n],this._y=e[n+1],this._z=e[n+2],this._w=e[n+3],this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._w,e}fromBufferAttribute(e,n){return this._x=e.getX(n),this._y=e.getY(n),this._z=e.getZ(n),this._w=e.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},hm=class hm{constructor(e=0,n=0,i=0){this.x=e,this.y=n,this.z=i}set(e,n,i){return i===void 0&&(i=this.z),this.x=e,this.y=n,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,n){return this.x=e.x*n.x,this.y=e.y*n.y,this.z=e.z*n.z,this}applyEuler(e){return this.applyQuaternion(wv.setFromEuler(e))}applyAxisAngle(e,n){return this.applyQuaternion(wv.setFromAxisAngle(e,n))}applyMatrix3(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[3]*i+s[6]*r,this.y=s[1]*n+s[4]*i+s[7]*r,this.z=s[2]*n+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*n+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*n+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*n+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*n+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let n=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*r-a*i),d=2*(a*n-s*r),f=2*(s*i-o*n);return this.x=n+l*c+o*f-a*d,this.y=i+l*d+a*c-s*f,this.z=r+l*f+s*d-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[4]*i+s[8]*r,this.y=s[1]*n+s[5]*i+s[9]*r,this.z=s[2]*n+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,n){return this.x=Je(this.x,e.x,n.x),this.y=Je(this.y,e.y,n.y),this.z=Je(this.z,e.z,n.z),this}clampScalar(e,n){return this.x=Je(this.x,e,n),this.y=Je(this.y,e,n),this.z=Je(this.z,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Je(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,n){let i=e.x,r=e.y,s=e.z,o=n.x,a=n.y,l=n.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let n=e.lengthSq();if(n===0)return this.set(0,0,0);let i=e.dot(this)/n;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return rp.copy(this).projectOnVector(e),this.sub(rp)}reflect(e){return this.sub(rp.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Je(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return n*n+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,n,i){let r=Math.sin(n)*e;return this.x=r*Math.sin(i),this.y=Math.cos(n)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,n,i){return this.x=e*Math.sin(n),this.y=i,this.z=e*Math.cos(n),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(e){let n=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=n,this.y=i,this.z=r,this}setFromMatrixColumn(e,n){return this.fromArray(e.elements,n*4)}setFromMatrix3Column(e,n){return this.fromArray(e.elements,n*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(e),this.y=n,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};hm.prototype.isVector3=!0;var O=hm,rp=new O,wv=new Mi,dm=class dm{constructor(e,n,i,r,s,o,a,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c)}set(e,n,i,r,s,o,a,l,c){let d=this.elements;return d[0]=e,d[1]=r,d[2]=a,d[3]=n,d[4]=s,d[5]=l,d[6]=i,d[7]=o,d[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(e,n,i){return e.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let n=e.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[3],l=i[6],c=i[1],d=i[4],f=i[7],h=i[2],p=i[5],_=i[8],S=r[0],g=r[3],u=r[6],m=r[1],v=r[4],M=r[7],A=r[2],E=r[5],P=r[8];return s[0]=o*S+a*m+l*A,s[3]=o*g+a*v+l*E,s[6]=o*u+a*M+l*P,s[1]=c*S+d*m+f*A,s[4]=c*g+d*v+f*E,s[7]=c*u+d*M+f*P,s[2]=h*S+p*m+_*A,s[5]=h*g+p*v+_*E,s[8]=h*u+p*M+_*P,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[3]*=e,n[6]*=e,n[1]*=e,n[4]*=e,n[7]*=e,n[2]*=e,n[5]*=e,n[8]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8];return n*o*d-n*a*c-i*s*d+i*a*l+r*s*c-r*o*l}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=d*o-a*c,h=a*l-d*s,p=c*s-o*l,_=n*f+i*h+r*p;if(_===0)return this.set(0,0,0,0,0,0,0,0,0);let S=1/_;return e[0]=f*S,e[1]=(r*c-d*i)*S,e[2]=(a*i-r*o)*S,e[3]=h*S,e[4]=(d*n-r*l)*S,e[5]=(r*s-a*n)*S,e[6]=p*S,e[7]=(i*l-c*n)*S,e[8]=(o*n-i*s)*S,this}transpose(){let e,n=this.elements;return e=n[1],n[1]=n[3],n[3]=e,e=n[2],n[2]=n[6],n[6]=e,e=n[5],n[5]=n[7],n[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let n=this.elements;return e[0]=n[0],e[1]=n[3],e[2]=n[6],e[3]=n[1],e[4]=n[4],e[5]=n[7],e[6]=n[2],e[7]=n[5],e[8]=n[8],this}setUvTransform(e,n,i,r,s,o,a){let l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*o+c*a)+o+e,-r*c,r*l,-r*(-c*o+l*a)+a+n,0,0,1),this}scale(e,n){return this.premultiply(sp.makeScale(e,n)),this}rotate(e){return this.premultiply(sp.makeRotation(-e)),this}translate(e,n){return this.premultiply(sp.makeTranslation(e,n)),this}makeTranslation(e,n){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,n,0,0,1),this}makeRotation(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(e,n){return this.set(e,0,0,0,n,0,0,0,1),this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<9;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<9;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}};dm.prototype.isMatrix3=!0;var Fe=dm,sp=new Fe,Ev=new Fe().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Tv=new Fe().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function c1(){let t={enabled:!0,workingColorSpace:Aa,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===rt&&(r.r=Zi(r.r),r.g=Zi(r.g),r.b=Zi(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===rt&&(r.r=so(r.r),r.g=so(r.g),r.b=so(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===ji?Ca:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return mu("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),t.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return mu("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),t.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return t.define({[Aa]:{primaries:e,whitePoint:i,transfer:Ca,toXYZ:Ev,fromXYZ:Tv,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:Jt},outputColorSpaceConfig:{drawingBufferColorSpace:Jt}},[Jt]:{primaries:e,whitePoint:i,transfer:rt,toXYZ:Ev,fromXYZ:Tv,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:Jt}}}),t}var $e=c1();function Zi(t){return t<.04045?t*.0773993808:Math.pow(t*.9478672986+.0521327014,2.4)}function so(t){return t<.0031308?t*12.92:1.055*Math.pow(t,.41666)-.055}var qs,gu=class{static getDataURL(e,n="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{qs===void 0&&(qs=Ra("canvas")),qs.width=e.width,qs.height=e.height;let r=qs.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=qs}return i.toDataURL(n)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let n=Ra("canvas");n.width=e.width,n.height=e.height;let i=n.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=Zi(s[o]/255)*255;return i.putImageData(r,0,0),n}else if(e.data){let n=e.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor(Zi(n[i]/255)*255):n[i]=Zi(n[i]);return{data:n,width:e.width,height:e.height}}else return Ie("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},u1=0,co=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:u1++}),this.uuid=wo(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?e.set(n.videoWidth,n.videoHeight,0):typeof VideoFrame<"u"&&n instanceof VideoFrame?e.set(n.displayWidth,n.displayHeight,0):n!==null?e.set(n.width,n.height,n.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(op(r[o].image)):s.push(op(r[o]))}else s=op(r);i.url=s}return n||(e.images[this.uuid]=i),i}};function op(t){return typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap?gu.getDataURL(t):t.data?{data:Array.from(t.data),width:t.width,height:t.height,type:t.data.constructor.name}:(Ie("Texture: Unable to serialize Texture."),{})}var h1=0,ap=new O,Sn=class t extends Si{constructor(e=t.DEFAULT_IMAGE,n=t.DEFAULT_MAPPING,i=xi,r=xi,s=Kt,o=Fr,a=qn,l=Mn,c=t.DEFAULT_ANISOTROPY,d=ji){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:h1++}),this.uuid=wo(),this.name="",this.source=new co(e),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Ke(0,0),this.repeat=new Ke(1,1),this.center=new Ke(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Fe,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=d,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(ap).x}get height(){return this.source.getSize(ap).y}get depth(){return this.source.getSize(ap).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let n in e){let i=e[n];if(i===void 0){Ie(`Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Ie(`Texture.setValues(): property '${n}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==$p)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case du:e.x=e.x-Math.floor(e.x);break;case xi:e.x=e.x<0?0:1;break;case fu:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case du:e.y=e.y-Math.floor(e.y);break;case xi:e.y=e.y<0?0:1;break;case fu:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Sn.DEFAULT_IMAGE=null;Sn.DEFAULT_MAPPING=$p;Sn.DEFAULT_ANISOTROPY=1;var fm=class fm{constructor(e=0,n=0,i=0,r=1){this.x=e,this.y=n,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,n,i,r){return this.x=e,this.y=n,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this.w=e.w+n.w,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this.w+=e.w*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this.w=e.w-n.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*n+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*n+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*n+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*n+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let n=Math.sqrt(1-e.w*e.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/n,this.y=e.y/n,this.z=e.z/n),this}setAxisAngleFromRotationMatrix(e){let n,i,r,s,l=e.elements,c=l[0],d=l[4],f=l[8],h=l[1],p=l[5],_=l[9],S=l[2],g=l[6],u=l[10];if(Math.abs(d-h)<.01&&Math.abs(f-S)<.01&&Math.abs(_-g)<.01){if(Math.abs(d+h)<.1&&Math.abs(f+S)<.1&&Math.abs(_+g)<.1&&Math.abs(c+p+u-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let v=(c+1)/2,M=(p+1)/2,A=(u+1)/2,E=(d+h)/4,P=(f+S)/4,x=(_+g)/4;return v>M&&v>A?v<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(v),r=E/i,s=P/i):M>A?M<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(M),i=E/r,s=x/r):A<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(A),i=P/s,r=x/s),this.set(i,r,s,n),this}let m=Math.sqrt((g-_)*(g-_)+(f-S)*(f-S)+(h-d)*(h-d));return Math.abs(m)<.001&&(m=1),this.x=(g-_)/m,this.y=(f-S)/m,this.z=(h-d)/m,this.w=Math.acos((c+p+u-1)/2),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,n){return this.x=Je(this.x,e.x,n.x),this.y=Je(this.y,e.y,n.y),this.z=Je(this.z,e.z,n.z),this.w=Je(this.w,e.w,n.w),this}clampScalar(e,n){return this.x=Je(this.x,e,n),this.y=Je(this.y,e,n),this.z=Je(this.z,e,n),this.w=Je(this.w,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Je(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this.w+=(e.w-this.w)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this.w=e.w+(n.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this.w=e[n+3],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e[n+3]=this.w,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this.w=e.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};fm.prototype.isVector4=!0;var bt=fm,_u=class extends Si{constructor(e=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Kt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=n,this.depth=i.depth,this.scissor=new bt(0,0,e,n),this.scissorTest=!1,this.viewport=new bt(0,0,e,n),this.textures=[];let r={width:e,height:n,depth:i.depth},s=new Sn(r),o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let n={minFilter:Kt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(n.mapping=e.mapping),e.wrapS!==void 0&&(n.wrapS=e.wrapS),e.wrapT!==void 0&&(n.wrapT=e.wrapT),e.wrapR!==void 0&&(n.wrapR=e.wrapR),e.magFilter!==void 0&&(n.magFilter=e.magFilter),e.minFilter!==void 0&&(n.minFilter=e.minFilter),e.format!==void 0&&(n.format=e.format),e.type!==void 0&&(n.type=e.type),e.anisotropy!==void 0&&(n.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(n.colorSpace=e.colorSpace),e.flipY!==void 0&&(n.flipY=e.flipY),e.generateMipmaps!==void 0&&(n.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(n.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,n,i=1){if(this.width!==e||this.height!==n||this.depth!==i){this.width=e,this.height=n,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=n,this.textures[r].image.depth=i,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,n),this.scissor.set(0,0,e,n)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++){this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let r=Object.assign({},e.textures[n].image);this.textures[n].source=new co(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},Nn=class extends _u{constructor(e=1,n=1,i={}){super(e,n,i),this.isWebGLRenderTarget=!0}},Pa=class extends Sn{constructor(e=null,n=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=Xt,this.minFilter=Xt,this.wrapR=xi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var vu=class extends Sn{constructor(e=null,n=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=Xt,this.minFilter=Xt,this.wrapR=xi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var zu=class zu{constructor(e,n,i,r,s,o,a,l,c,d,f,h,p,_,S,g){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c,d,f,h,p,_,S,g)}set(e,n,i,r,s,o,a,l,c,d,f,h,p,_,S,g){let u=this.elements;return u[0]=e,u[4]=n,u[8]=i,u[12]=r,u[1]=s,u[5]=o,u[9]=a,u[13]=l,u[2]=c,u[6]=d,u[10]=f,u[14]=h,u[3]=p,u[7]=_,u[11]=S,u[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new zu().fromArray(this.elements)}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(e){let n=this.elements,i=e.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(e){let n=e.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(e,n,i){return this.determinant()===0?(e.set(1,0,0),n.set(0,1,0),i.set(0,0,1),this):(e.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(e,n,i){return this.set(e.x,n.x,i.x,0,e.y,n.y,i.y,0,e.z,n.z,i.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let n=this.elements,i=e.elements,r=1/Ys.setFromMatrixColumn(e,0).length(),s=1/Ys.setFromMatrixColumn(e,1).length(),o=1/Ys.setFromMatrixColumn(e,2).length();return n[0]=i[0]*r,n[1]=i[1]*r,n[2]=i[2]*r,n[3]=0,n[4]=i[4]*s,n[5]=i[5]*s,n[6]=i[6]*s,n[7]=0,n[8]=i[8]*o,n[9]=i[9]*o,n[10]=i[10]*o,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(e){let n=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),c=Math.sin(r),d=Math.cos(s),f=Math.sin(s);if(e.order==="XYZ"){let h=o*d,p=o*f,_=a*d,S=a*f;n[0]=l*d,n[4]=-l*f,n[8]=c,n[1]=p+_*c,n[5]=h-S*c,n[9]=-a*l,n[2]=S-h*c,n[6]=_+p*c,n[10]=o*l}else if(e.order==="YXZ"){let h=l*d,p=l*f,_=c*d,S=c*f;n[0]=h+S*a,n[4]=_*a-p,n[8]=o*c,n[1]=o*f,n[5]=o*d,n[9]=-a,n[2]=p*a-_,n[6]=S+h*a,n[10]=o*l}else if(e.order==="ZXY"){let h=l*d,p=l*f,_=c*d,S=c*f;n[0]=h-S*a,n[4]=-o*f,n[8]=_+p*a,n[1]=p+_*a,n[5]=o*d,n[9]=S-h*a,n[2]=-o*c,n[6]=a,n[10]=o*l}else if(e.order==="ZYX"){let h=o*d,p=o*f,_=a*d,S=a*f;n[0]=l*d,n[4]=_*c-p,n[8]=h*c+S,n[1]=l*f,n[5]=S*c+h,n[9]=p*c-_,n[2]=-c,n[6]=a*l,n[10]=o*l}else if(e.order==="YZX"){let h=o*l,p=o*c,_=a*l,S=a*c;n[0]=l*d,n[4]=S-h*f,n[8]=_*f+p,n[1]=f,n[5]=o*d,n[9]=-a*d,n[2]=-c*d,n[6]=p*f+_,n[10]=h-S*f}else if(e.order==="XZY"){let h=o*l,p=o*c,_=a*l,S=a*c;n[0]=l*d,n[4]=-f,n[8]=c*d,n[1]=h*f+S,n[5]=o*d,n[9]=p*f-_,n[2]=_*f-p,n[6]=a*d,n[10]=S*f+h}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(e){return this.compose(d1,e,f1)}lookAt(e,n,i){let r=this.elements;return Pn.subVectors(e,n),Pn.lengthSq()===0&&(Pn.z=1),Pn.normalize(),wr.crossVectors(i,Pn),wr.lengthSq()===0&&(Math.abs(i.z)===1?Pn.x+=1e-4:Pn.z+=1e-4,Pn.normalize(),wr.crossVectors(i,Pn)),wr.normalize(),Dc.crossVectors(Pn,wr),r[0]=wr.x,r[4]=Dc.x,r[8]=Pn.x,r[1]=wr.y,r[5]=Dc.y,r[9]=Pn.y,r[2]=wr.z,r[6]=Dc.z,r[10]=Pn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[4],l=i[8],c=i[12],d=i[1],f=i[5],h=i[9],p=i[13],_=i[2],S=i[6],g=i[10],u=i[14],m=i[3],v=i[7],M=i[11],A=i[15],E=r[0],P=r[4],x=r[8],R=r[12],C=r[1],b=r[5],I=r[9],W=r[13],H=r[2],D=r[6],B=r[10],k=r[14],te=r[3],se=r[7],ue=r[11],ve=r[15];return s[0]=o*E+a*C+l*H+c*te,s[4]=o*P+a*b+l*D+c*se,s[8]=o*x+a*I+l*B+c*ue,s[12]=o*R+a*W+l*k+c*ve,s[1]=d*E+f*C+h*H+p*te,s[5]=d*P+f*b+h*D+p*se,s[9]=d*x+f*I+h*B+p*ue,s[13]=d*R+f*W+h*k+p*ve,s[2]=_*E+S*C+g*H+u*te,s[6]=_*P+S*b+g*D+u*se,s[10]=_*x+S*I+g*B+u*ue,s[14]=_*R+S*W+g*k+u*ve,s[3]=m*E+v*C+M*H+A*te,s[7]=m*P+v*b+M*D+A*se,s[11]=m*x+v*I+M*B+A*ue,s[15]=m*R+v*W+M*k+A*ve,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[4]*=e,n[8]*=e,n[12]*=e,n[1]*=e,n[5]*=e,n[9]*=e,n[13]*=e,n[2]*=e,n[6]*=e,n[10]*=e,n[14]*=e,n[3]*=e,n[7]*=e,n[11]*=e,n[15]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],c=e[13],d=e[2],f=e[6],h=e[10],p=e[14],_=e[3],S=e[7],g=e[11],u=e[15],m=l*p-c*h,v=a*p-c*f,M=a*h-l*f,A=o*p-c*d,E=o*h-l*d,P=o*f-a*d;return n*(S*m-g*v+u*M)-i*(_*m-g*A+u*E)+r*(_*v-S*A+u*P)-s*(_*M-S*E+g*P)}transpose(){let e=this.elements,n;return n=e[1],e[1]=e[4],e[4]=n,n=e[2],e[2]=e[8],e[8]=n,n=e[6],e[6]=e[9],e[9]=n,n=e[3],e[3]=e[12],e[12]=n,n=e[7],e[7]=e[13],e[13]=n,n=e[11],e[11]=e[14],e[14]=n,this}setPosition(e,n,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=n,r[14]=i),this}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=e[9],h=e[10],p=e[11],_=e[12],S=e[13],g=e[14],u=e[15],m=n*a-i*o,v=n*l-r*o,M=n*c-s*o,A=i*l-r*a,E=i*c-s*a,P=r*c-s*l,x=d*S-f*_,R=d*g-h*_,C=d*u-p*_,b=f*g-h*S,I=f*u-p*S,W=h*u-p*g,H=m*W-v*I+M*b+A*C-E*R+P*x;if(H===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let D=1/H;return e[0]=(a*W-l*I+c*b)*D,e[1]=(r*I-i*W-s*b)*D,e[2]=(S*P-g*E+u*A)*D,e[3]=(h*E-f*P-p*A)*D,e[4]=(l*C-o*W-c*R)*D,e[5]=(n*W-r*C+s*R)*D,e[6]=(g*M-_*P-u*v)*D,e[7]=(d*P-h*M+p*v)*D,e[8]=(o*I-a*C+c*x)*D,e[9]=(i*C-n*I-s*x)*D,e[10]=(_*E-S*M+u*m)*D,e[11]=(f*M-d*E-p*m)*D,e[12]=(a*R-o*b-l*x)*D,e[13]=(n*b-i*R+r*x)*D,e[14]=(S*v-_*A-g*m)*D,e[15]=(d*A-f*v+h*m)*D,this}scale(e){let n=this.elements,i=e.x,r=e.y,s=e.z;return n[0]*=i,n[4]*=r,n[8]*=s,n[1]*=i,n[5]*=r,n[9]*=s,n[2]*=i,n[6]*=r,n[10]*=s,n[3]*=i,n[7]*=r,n[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,n=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(n,i,r))}makeTranslation(e,n,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(e){let n=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,n){let i=Math.cos(n),r=Math.sin(n),s=1-i,o=e.x,a=e.y,l=e.z,c=s*o,d=s*a;return this.set(c*o+i,c*a-r*l,c*l+r*a,0,c*a+r*l,d*a+i,d*l-r*o,0,c*l-r*a,d*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,n,i){return this.set(e,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,n,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,n,r,1,0,0,0,0,1),this}compose(e,n,i){let r=this.elements,s=n._x,o=n._y,a=n._z,l=n._w,c=s+s,d=o+o,f=a+a,h=s*c,p=s*d,_=s*f,S=o*d,g=o*f,u=a*f,m=l*c,v=l*d,M=l*f,A=i.x,E=i.y,P=i.z;return r[0]=(1-(S+u))*A,r[1]=(p+M)*A,r[2]=(_-v)*A,r[3]=0,r[4]=(p-M)*E,r[5]=(1-(h+u))*E,r[6]=(g+m)*E,r[7]=0,r[8]=(_+v)*P,r[9]=(g-m)*P,r[10]=(1-(h+S))*P,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,n,i){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinant();if(s===0)return i.set(1,1,1),n.identity(),this;let o=Ys.set(r[0],r[1],r[2]).length(),a=Ys.set(r[4],r[5],r[6]).length(),l=Ys.set(r[8],r[9],r[10]).length();s<0&&(o=-o),ni.copy(this);let c=1/o,d=1/a,f=1/l;return ni.elements[0]*=c,ni.elements[1]*=c,ni.elements[2]*=c,ni.elements[4]*=d,ni.elements[5]*=d,ni.elements[6]*=d,ni.elements[8]*=f,ni.elements[9]*=f,ni.elements[10]*=f,n.setFromRotationMatrix(ni),i.x=o,i.y=a,i.z=l,this}makePerspective(e,n,i,r,s,o,a=si,l=!1){let c=this.elements,d=2*s/(n-e),f=2*s/(i-r),h=(n+e)/(n-e),p=(i+r)/(i-r),_,S;if(l)_=s/(o-s),S=o*s/(o-s);else if(a===si)_=-(o+s)/(o-s),S=-2*o*s/(o-s);else if(a===oo)_=-o/(o-s),S=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=h,c[12]=0,c[1]=0,c[5]=f,c[9]=p,c[13]=0,c[2]=0,c[6]=0,c[10]=_,c[14]=S,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,n,i,r,s,o,a=si,l=!1){let c=this.elements,d=2/(n-e),f=2/(i-r),h=-(n+e)/(n-e),p=-(i+r)/(i-r),_,S;if(l)_=1/(o-s),S=o/(o-s);else if(a===si)_=-2/(o-s),S=-(o+s)/(o-s);else if(a===oo)_=-1/(o-s),S=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=0,c[12]=h,c[1]=0,c[5]=f,c[9]=0,c[13]=p,c[2]=0,c[6]=0,c[10]=_,c[14]=S,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<16;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<16;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e[n+9]=i[9],e[n+10]=i[10],e[n+11]=i[11],e[n+12]=i[12],e[n+13]=i[13],e[n+14]=i[14],e[n+15]=i[15],e}};zu.prototype.isMatrix4=!0;var Tt=zu,Ys=new O,ni=new Tt,d1=new O(0,0,0),f1=new O(1,1,1),wr=new O,Dc=new O,Pn=new O,bv=new Tt,Av=new Mi,Ji=class t{constructor(e=0,n=0,i=0,r=t.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=n,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,n,i,r=this._order){return this._x=e,this._y=n,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,n=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],d=r[9],f=r[2],h=r[6],p=r[10];switch(n){case"XYZ":this._y=Math.asin(Je(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-d,p),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(h,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Je(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-f,s),this._z=0);break;case"ZXY":this._x=Math.asin(Je(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-f,p),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Je(f,-1,1)),Math.abs(f)<.9999999?(this._x=Math.atan2(h,p),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Je(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-d,c),this._y=Math.atan2(-f,s)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-Je(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(h,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-d,p),this._y=0);break;default:Ie("Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,n,i){return bv.makeRotationFromQuaternion(e),this.setFromRotationMatrix(bv,n,i)}setFromVector3(e,n=this._order){return this.set(e.x,e.y,e.z,n)}reorder(e){return Av.setFromEuler(this),this.setFromQuaternion(Av,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Ji.DEFAULT_ORDER="XYZ";var Ia=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},p1=0,Cv=new O,Zs=new Mi,Hi=new Tt,Uc=new O,xa=new O,m1=new O,g1=new Mi,Rv=new O(1,0,0),Pv=new O(0,1,0),Iv=new O(0,0,1),Lv={type:"added"},_1={type:"removed"},$s={type:"childadded",child:null},lp={type:"childremoved",child:null},jt=class t extends Si{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:p1++}),this.uuid=wo(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=t.DEFAULT_UP.clone();let e=new O,n=new Ji,i=new Mi,r=new O(1,1,1);function s(){i.setFromEuler(n,!1)}function o(){n.setFromQuaternion(i,void 0,!1)}n._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new Tt},normalMatrix:{value:new Fe}}),this.matrix=new Tt,this.matrixWorld=new Tt,this.matrixAutoUpdate=t.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Ia,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,n){this.quaternion.setFromAxisAngle(e,n)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,n){return Zs.setFromAxisAngle(e,n),this.quaternion.multiply(Zs),this}rotateOnWorldAxis(e,n){return Zs.setFromAxisAngle(e,n),this.quaternion.premultiply(Zs),this}rotateX(e){return this.rotateOnAxis(Rv,e)}rotateY(e){return this.rotateOnAxis(Pv,e)}rotateZ(e){return this.rotateOnAxis(Iv,e)}translateOnAxis(e,n){return Cv.copy(e).applyQuaternion(this.quaternion),this.position.add(Cv.multiplyScalar(n)),this}translateX(e){return this.translateOnAxis(Rv,e)}translateY(e){return this.translateOnAxis(Pv,e)}translateZ(e){return this.translateOnAxis(Iv,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Hi.copy(this.matrixWorld).invert())}lookAt(e,n,i){e.isVector3?Uc.copy(e):Uc.set(e,n,i);let r=this.parent;this.updateWorldMatrix(!0,!1),xa.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Hi.lookAt(xa,Uc,this.up):Hi.lookAt(Uc,xa,this.up),this.quaternion.setFromRotationMatrix(Hi),r&&(Hi.extractRotation(r.matrixWorld),Zs.setFromRotationMatrix(Hi),this.quaternion.premultiply(Zs.invert()))}add(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return e===this?(Ne("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Lv),$s.child=e,this.dispatchEvent($s),$s.child=null):Ne("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(e);return n!==-1&&(e.parent=null,this.children.splice(n,1),e.dispatchEvent(_1),lp.child=e,this.dispatchEvent(lp),lp.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Hi.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Hi.multiply(e.parent.matrixWorld)),e.applyMatrix4(Hi),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Lv),$s.child=e,this.dispatchEvent($s),$s.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,n){if(this[e]===n)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,n);if(o!==void 0)return o}}getObjectsByProperty(e,n,i=[]){this[e]===n&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,n,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(xa,e,m1),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(xa,g1,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return e.set(n[8],n[9],n[10]).normalize()}raycast(){}traverse(e){e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverseVisible(e)}traverseAncestors(e){let n=this.parent;n!==null&&(e(n),n.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let n=e.x,i=e.y,r=e.z,s=this.matrix.elements;s[12]+=n-s[0]*n-s[4]*i-s[8]*r,s[13]+=i-s[1]*n-s[5]*i-s[9]*r,s[14]+=r-s[2]*n-s[6]*i-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].updateMatrixWorld(e)}updateWorldMatrix(e,n){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),n===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let n=e===void 0||typeof e=="string",i={};n&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,d=l.length;c<d;c++){let f=l[c];s(e.shapes,f)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(n){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),d=o(e.images),f=o(e.shapes),h=o(e.skeletons),p=o(e.animations),_=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),d.length>0&&(i.images=d),f.length>0&&(i.shapes=f),h.length>0&&(i.skeletons=h),p.length>0&&(i.animations=p),_.length>0&&(i.nodes=_)}return i.object=r,i;function o(a){let l=[];for(let c in a){let d=a[c];delete d.metadata,l.push(d)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,n=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),n===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};jt.DEFAULT_UP=new O(0,1,0);jt.DEFAULT_MATRIX_AUTO_UPDATE=!0;jt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Yi=class extends jt{constructor(){super(),this.isGroup=!0,this.type="Group"}},v1={type:"move"},uo=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Yi,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Yi,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new O,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new O),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Yi,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new O,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new O,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let n=this._hand;if(n)for(let i of e.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,n,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&n.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let S of e.hand.values()){let g=n.getJointPose(S,i),u=this._getHandJoint(c,S);g!==null&&(u.matrix.fromArray(g.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=g.radius),u.visible=g!==null}let d=c.joints["index-finger-tip"],f=c.joints["thumb-tip"],h=d.position.distanceTo(f.position),p=.02,_=.005;c.inputState.pinching&&h>p+_?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&h<=p-_&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=n.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));a!==null&&(r=n.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(v1)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,n){if(e.joints[n.jointName]===void 0){let i=new Yi;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[n.jointName]=i,e.add(i)}return e.joints[n.jointName]}},Cx={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Er={h:0,s:0,l:0},Fc={h:0,s:0,l:0};function cp(t,e,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?t+(e-t)*6*n:n<1/2?e:n<2/3?t+(e-t)*6*(2/3-n):t}var Ge=class{constructor(e,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,n,i)}set(e,n,i){if(n===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,n,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,n=Jt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,$e.colorSpaceToWorking(this,n),this}setRGB(e,n,i,r=$e.workingColorSpace){return this.r=e,this.g=n,this.b=i,$e.colorSpaceToWorking(this,r),this}setHSL(e,n,i,r=$e.workingColorSpace){if(e=sm(e,1),n=Je(n,0,1),i=Je(i,0,1),n===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+n):i+n-i*n,o=2*i-s;this.r=cp(o,s,e+1/3),this.g=cp(o,s,e),this.b=cp(o,s,e-1/3)}return $e.colorSpaceToWorking(this,r),this}setStyle(e,n=Jt){function i(s){s!==void 0&&parseFloat(s)<1&&Ie("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,n);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,n);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,n);break;default:Ie("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,n);if(o===6)return this.setHex(parseInt(s,16),n);Ie("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,n);return this}setColorName(e,n=Jt){let i=Cx[e.toLowerCase()];return i!==void 0?this.setHex(i,n):Ie("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Zi(e.r),this.g=Zi(e.g),this.b=Zi(e.b),this}copyLinearToSRGB(e){return this.r=so(e.r),this.g=so(e.g),this.b=so(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Jt){return $e.workingToColorSpace(ln.copy(this),e),Math.round(Je(ln.r*255,0,255))*65536+Math.round(Je(ln.g*255,0,255))*256+Math.round(Je(ln.b*255,0,255))}getHexString(e=Jt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,n=$e.workingColorSpace){$e.workingToColorSpace(ln.copy(this),n);let i=ln.r,r=ln.g,s=ln.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,c,d=(a+o)/2;if(a===o)l=0,c=0;else{let f=o-a;switch(c=d<=.5?f/(o+a):f/(2-o-a),o){case i:l=(r-s)/f+(r<s?6:0);break;case r:l=(s-i)/f+2;break;case s:l=(i-r)/f+4;break}l/=6}return e.h=l,e.s=c,e.l=d,e}getRGB(e,n=$e.workingColorSpace){return $e.workingToColorSpace(ln.copy(this),n),e.r=ln.r,e.g=ln.g,e.b=ln.b,e}getStyle(e=Jt){$e.workingToColorSpace(ln.copy(this),e);let n=ln.r,i=ln.g,r=ln.b;return e!==Jt?`color(${e} ${n.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,n,i){return this.getHSL(Er),this.setHSL(Er.h+e,Er.s+n,Er.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,n){return this.r=e.r+n.r,this.g=e.g+n.g,this.b=e.b+n.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,n){return this.r+=(e.r-this.r)*n,this.g+=(e.g-this.g)*n,this.b+=(e.b-this.b)*n,this}lerpColors(e,n,i){return this.r=e.r+(n.r-e.r)*i,this.g=e.g+(n.g-e.g)*i,this.b=e.b+(n.b-e.b)*i,this}lerpHSL(e,n){this.getHSL(Er),e.getHSL(Fc);let i=Ta(Er.h,Fc.h,n),r=Ta(Er.s,Fc.s,n),s=Ta(Er.l,Fc.l,n);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let n=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*n+s[3]*i+s[6]*r,this.g=s[1]*n+s[4]*i+s[7]*r,this.b=s[2]*n+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,n=0){return this.r=e[n],this.g=e[n+1],this.b=e[n+2],this}toArray(e=[],n=0){return e[n]=this.r,e[n+1]=this.g,e[n+2]=this.b,e}fromBufferAttribute(e,n){return this.r=e.getX(n),this.g=e.getY(n),this.b=e.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},ln=new Ge;Ge.NAMES=Cx;var ho=class extends jt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Ji,this.environmentIntensity=1,this.environmentRotation=new Ji,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,n){return super.copy(e,n),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let n=super.toJSON(e);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(n.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(n.object.backgroundIntensity=this.backgroundIntensity),n.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(n.object.environmentIntensity=this.environmentIntensity),n.object.environmentRotation=this.environmentRotation.toArray(),n}},ii=new O,Gi=new O,up=new O,Wi=new O,Js=new O,Ks=new O,Nv=new O,hp=new O,dp=new O,fp=new O,pp=new bt,mp=new bt,gp=new bt,Rr=class t{constructor(e=new O,n=new O,i=new O){this.a=e,this.b=n,this.c=i}static getNormal(e,n,i,r){r.subVectors(i,n),ii.subVectors(e,n),r.cross(ii);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,n,i,r,s){ii.subVectors(r,n),Gi.subVectors(i,n),up.subVectors(e,n);let o=ii.dot(ii),a=ii.dot(Gi),l=ii.dot(up),c=Gi.dot(Gi),d=Gi.dot(up),f=o*c-a*a;if(f===0)return s.set(0,0,0),null;let h=1/f,p=(c*l-a*d)*h,_=(o*d-a*l)*h;return s.set(1-p-_,_,p)}static containsPoint(e,n,i,r){return this.getBarycoord(e,n,i,r,Wi)===null?!1:Wi.x>=0&&Wi.y>=0&&Wi.x+Wi.y<=1}static getInterpolation(e,n,i,r,s,o,a,l){return this.getBarycoord(e,n,i,r,Wi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Wi.x),l.addScaledVector(o,Wi.y),l.addScaledVector(a,Wi.z),l)}static getInterpolatedAttribute(e,n,i,r,s,o){return pp.setScalar(0),mp.setScalar(0),gp.setScalar(0),pp.fromBufferAttribute(e,n),mp.fromBufferAttribute(e,i),gp.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(pp,s.x),o.addScaledVector(mp,s.y),o.addScaledVector(gp,s.z),o}static isFrontFacing(e,n,i,r){return ii.subVectors(i,n),Gi.subVectors(e,n),ii.cross(Gi).dot(r)<0}set(e,n,i){return this.a.copy(e),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(e,n,i,r){return this.a.copy(e[n]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,n,i,r){return this.a.fromBufferAttribute(e,n),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return ii.subVectors(this.c,this.b),Gi.subVectors(this.a,this.b),ii.cross(Gi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return t.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,n){return t.getBarycoord(e,this.a,this.b,this.c,n)}getInterpolation(e,n,i,r,s){return t.getInterpolation(e,this.a,this.b,this.c,n,i,r,s)}containsPoint(e){return t.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return t.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,n){let i=this.a,r=this.b,s=this.c,o,a;Js.subVectors(r,i),Ks.subVectors(s,i),hp.subVectors(e,i);let l=Js.dot(hp),c=Ks.dot(hp);if(l<=0&&c<=0)return n.copy(i);dp.subVectors(e,r);let d=Js.dot(dp),f=Ks.dot(dp);if(d>=0&&f<=d)return n.copy(r);let h=l*f-d*c;if(h<=0&&l>=0&&d<=0)return o=l/(l-d),n.copy(i).addScaledVector(Js,o);fp.subVectors(e,s);let p=Js.dot(fp),_=Ks.dot(fp);if(_>=0&&p<=_)return n.copy(s);let S=p*c-l*_;if(S<=0&&c>=0&&_<=0)return a=c/(c-_),n.copy(i).addScaledVector(Ks,a);let g=d*_-p*f;if(g<=0&&f-d>=0&&p-_>=0)return Nv.subVectors(s,r),a=(f-d)/(f-d+(p-_)),n.copy(r).addScaledVector(Nv,a);let u=1/(g+S+h);return o=S*u,a=h*u,n.copy(i).addScaledVector(Js,o).addScaledVector(Ks,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},wi=class{constructor(e=new O(1/0,1/0,1/0),n=new O(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=n}set(e,n){return this.min.copy(e),this.max.copy(n),this}setFromArray(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n+=3)this.expandByPoint(ri.fromArray(e,n));return this}setFromBufferAttribute(e){this.makeEmpty();for(let n=0,i=e.count;n<i;n++)this.expandByPoint(ri.fromBufferAttribute(e,n));return this}setFromPoints(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n++)this.expandByPoint(e[n]);return this}setFromCenterAndSize(e,n){let i=ri.copy(n).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,n=!1){return this.makeEmpty(),this.expandByObject(e,n)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,n=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(n===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,ri):ri.fromBufferAttribute(s,o),ri.applyMatrix4(e.matrixWorld),this.expandByPoint(ri);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Oc.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Oc.copy(i.boundingBox)),Oc.applyMatrix4(e.matrixWorld),this.union(Oc)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],n);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,n){return n.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,ri),ri.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let n,i;return e.normal.x>0?(n=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(n=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(n+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(n+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(n+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(n+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),n<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(ya),Bc.subVectors(this.max,ya),js.subVectors(e.a,ya),Qs.subVectors(e.b,ya),eo.subVectors(e.c,ya),Tr.subVectors(Qs,js),br.subVectors(eo,Qs),is.subVectors(js,eo);let n=[0,-Tr.z,Tr.y,0,-br.z,br.y,0,-is.z,is.y,Tr.z,0,-Tr.x,br.z,0,-br.x,is.z,0,-is.x,-Tr.y,Tr.x,0,-br.y,br.x,0,-is.y,is.x,0];return!_p(n,js,Qs,eo,Bc)||(n=[1,0,0,0,1,0,0,0,1],!_p(n,js,Qs,eo,Bc))?!1:(kc.crossVectors(Tr,br),n=[kc.x,kc.y,kc.z],_p(n,js,Qs,eo,Bc))}clampPoint(e,n){return n.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,ri).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(ri).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Xi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Xi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Xi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Xi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Xi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Xi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Xi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Xi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Xi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Xi=[new O,new O,new O,new O,new O,new O,new O,new O],ri=new O,Oc=new wi,js=new O,Qs=new O,eo=new O,Tr=new O,br=new O,is=new O,ya=new O,Bc=new O,kc=new O,rs=new O;function _p(t,e,n,i,r){for(let s=0,o=t.length-3;s<=o;s+=3){rs.fromArray(t,s);let a=r.x*Math.abs(rs.x)+r.y*Math.abs(rs.y)+r.z*Math.abs(rs.z),l=e.dot(rs),c=n.dot(rs),d=i.dot(rs);if(Math.max(-Math.max(l,c,d),Math.min(l,c,d))>a)return!1}return!0}var Ut=new O,zc=new Ke,x1=0,Ln=class extends Si{constructor(e,n,i=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:x1++}),this.name="",this.array=e,this.itemSize=n,this.count=e!==void 0?e.length/n:0,this.normalized=i,this.usage=Lp,this.updateRanges=[],this.gpuType=li,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,n,i){e*=this.itemSize,i*=n.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=n.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)zc.fromBufferAttribute(this,n),zc.applyMatrix3(e),this.setXY(n,zc.x,zc.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)Ut.fromBufferAttribute(this,n),Ut.applyMatrix3(e),this.setXYZ(n,Ut.x,Ut.y,Ut.z);return this}applyMatrix4(e){for(let n=0,i=this.count;n<i;n++)Ut.fromBufferAttribute(this,n),Ut.applyMatrix4(e),this.setXYZ(n,Ut.x,Ut.y,Ut.z);return this}applyNormalMatrix(e){for(let n=0,i=this.count;n<i;n++)Ut.fromBufferAttribute(this,n),Ut.applyNormalMatrix(e),this.setXYZ(n,Ut.x,Ut.y,Ut.z);return this}transformDirection(e){for(let n=0,i=this.count;n<i;n++)Ut.fromBufferAttribute(this,n),Ut.transformDirection(e),this.setXYZ(n,Ut.x,Ut.y,Ut.z);return this}set(e,n=0){return this.array.set(e,n),this}getComponent(e,n){let i=this.array[e*this.itemSize+n];return this.normalized&&(i=ro(i,this.array)),i}setComponent(e,n,i){return this.normalized&&(i=mn(i,this.array)),this.array[e*this.itemSize+n]=i,this}getX(e){let n=this.array[e*this.itemSize];return this.normalized&&(n=ro(n,this.array)),n}setX(e,n){return this.normalized&&(n=mn(n,this.array)),this.array[e*this.itemSize]=n,this}getY(e){let n=this.array[e*this.itemSize+1];return this.normalized&&(n=ro(n,this.array)),n}setY(e,n){return this.normalized&&(n=mn(n,this.array)),this.array[e*this.itemSize+1]=n,this}getZ(e){let n=this.array[e*this.itemSize+2];return this.normalized&&(n=ro(n,this.array)),n}setZ(e,n){return this.normalized&&(n=mn(n,this.array)),this.array[e*this.itemSize+2]=n,this}getW(e){let n=this.array[e*this.itemSize+3];return this.normalized&&(n=ro(n,this.array)),n}setW(e,n){return this.normalized&&(n=mn(n,this.array)),this.array[e*this.itemSize+3]=n,this}setXY(e,n,i){return e*=this.itemSize,this.normalized&&(n=mn(n,this.array),i=mn(i,this.array)),this.array[e+0]=n,this.array[e+1]=i,this}setXYZ(e,n,i,r){return e*=this.itemSize,this.normalized&&(n=mn(n,this.array),i=mn(i,this.array),r=mn(r,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,n,i,r,s){return e*=this.itemSize,this.normalized&&(n=mn(n,this.array),i=mn(i,this.array),r=mn(r,this.array),s=mn(s,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Lp&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var La=class extends Ln{constructor(e,n,i){super(new Uint16Array(e),n,i)}};var Na=class extends Ln{constructor(e,n,i){super(new Uint32Array(e),n,i)}};var st=class extends Ln{constructor(e,n,i){super(new Float32Array(e),n,i)}},y1=new wi,Sa=new O,vp=new O,us=class{constructor(e=new O,n=-1){this.isSphere=!0,this.center=e,this.radius=n}set(e,n){return this.center.copy(e),this.radius=n,this}setFromPoints(e,n){let i=this.center;n!==void 0?i.copy(n):y1.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let n=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=n*n}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,n){let i=this.center.distanceToSquared(e);return n.copy(e),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Sa.subVectors(e,this.center);let n=Sa.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),r=(i-this.radius)*.5;this.center.addScaledVector(Sa,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(vp.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Sa.copy(e.center).add(vp)),this.expandByPoint(Sa.copy(e.center).sub(vp))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},S1=0,Wn=new Tt,xp=new jt,to=new O,In=new wi,Ma=new wi,Wt=new O,qt=class t extends Si{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:S1++}),this.uuid=wo(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(XM(e)?Na:La)(e,1):this.index=e,this}setIndirect(e,n=0){return this.indirect=e,this.indirectOffset=n,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,n){return this.attributes[e]=n,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,n,i=0){this.groups.push({start:e,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,n){this.drawRange.start=e,this.drawRange.count=n}applyMatrix4(e){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(e),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new Fe().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Wn.makeRotationFromQuaternion(e),this.applyMatrix4(Wn),this}rotateX(e){return Wn.makeRotationX(e),this.applyMatrix4(Wn),this}rotateY(e){return Wn.makeRotationY(e),this.applyMatrix4(Wn),this}rotateZ(e){return Wn.makeRotationZ(e),this.applyMatrix4(Wn),this}translate(e,n,i){return Wn.makeTranslation(e,n,i),this.applyMatrix4(Wn),this}scale(e,n,i){return Wn.makeScale(e,n,i),this.applyMatrix4(Wn),this}lookAt(e){return xp.lookAt(e),xp.updateMatrix(),this.applyMatrix4(xp.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(to).negate(),this.translate(to.x,to.y,to.z),this}setFromPoints(e){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new st(i,3))}else{let i=Math.min(e.length,n.count);for(let r=0;r<i;r++){let s=e[r];n.setXYZ(r,s.x,s.y,s.z||0)}e.length>n.count&&Ie("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new wi);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Ne("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new O(-1/0,-1/0,-1/0),new O(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),n)for(let i=0,r=n.length;i<r;i++){let s=n[i];In.setFromBufferAttribute(s),this.morphTargetsRelative?(Wt.addVectors(this.boundingBox.min,In.min),this.boundingBox.expandByPoint(Wt),Wt.addVectors(this.boundingBox.max,In.max),this.boundingBox.expandByPoint(Wt)):(this.boundingBox.expandByPoint(In.min),this.boundingBox.expandByPoint(In.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Ne('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new us);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Ne("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new O,1/0);return}if(e){let i=this.boundingSphere.center;if(In.setFromBufferAttribute(e),n)for(let s=0,o=n.length;s<o;s++){let a=n[s];Ma.setFromBufferAttribute(a),this.morphTargetsRelative?(Wt.addVectors(In.min,Ma.min),In.expandByPoint(Wt),Wt.addVectors(In.max,Ma.max),In.expandByPoint(Wt)):(In.expandByPoint(Ma.min),In.expandByPoint(Ma.max))}In.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)Wt.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(Wt));if(n)for(let s=0,o=n.length;s<o;s++){let a=n[s],l=this.morphTargetsRelative;for(let c=0,d=a.count;c<d;c++)Wt.fromBufferAttribute(a,c),l&&(to.fromBufferAttribute(e,c),Wt.add(to)),r=Math.max(r,i.distanceToSquared(Wt))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&Ne('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,n=this.attributes;if(e===null||n.position===void 0||n.normal===void 0||n.uv===void 0){Ne("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,r=n.normal,s=n.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Ln(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let x=0;x<i.count;x++)a[x]=new O,l[x]=new O;let c=new O,d=new O,f=new O,h=new Ke,p=new Ke,_=new Ke,S=new O,g=new O;function u(x,R,C){c.fromBufferAttribute(i,x),d.fromBufferAttribute(i,R),f.fromBufferAttribute(i,C),h.fromBufferAttribute(s,x),p.fromBufferAttribute(s,R),_.fromBufferAttribute(s,C),d.sub(c),f.sub(c),p.sub(h),_.sub(h);let b=1/(p.x*_.y-_.x*p.y);isFinite(b)&&(S.copy(d).multiplyScalar(_.y).addScaledVector(f,-p.y).multiplyScalar(b),g.copy(f).multiplyScalar(p.x).addScaledVector(d,-_.x).multiplyScalar(b),a[x].add(S),a[R].add(S),a[C].add(S),l[x].add(g),l[R].add(g),l[C].add(g))}let m=this.groups;m.length===0&&(m=[{start:0,count:e.count}]);for(let x=0,R=m.length;x<R;++x){let C=m[x],b=C.start,I=C.count;for(let W=b,H=b+I;W<H;W+=3)u(e.getX(W+0),e.getX(W+1),e.getX(W+2))}let v=new O,M=new O,A=new O,E=new O;function P(x){A.fromBufferAttribute(r,x),E.copy(A);let R=a[x];v.copy(R),v.sub(A.multiplyScalar(A.dot(R))).normalize(),M.crossVectors(E,R);let b=M.dot(l[x])<0?-1:1;o.setXYZW(x,v.x,v.y,v.z,b)}for(let x=0,R=m.length;x<R;++x){let C=m[x],b=C.start,I=C.count;for(let W=b,H=b+I;W<H;W+=3)P(e.getX(W+0)),P(e.getX(W+1)),P(e.getX(W+2))}}computeVertexNormals(){let e=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Ln(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let h=0,p=i.count;h<p;h++)i.setXYZ(h,0,0,0);let r=new O,s=new O,o=new O,a=new O,l=new O,c=new O,d=new O,f=new O;if(e)for(let h=0,p=e.count;h<p;h+=3){let _=e.getX(h+0),S=e.getX(h+1),g=e.getX(h+2);r.fromBufferAttribute(n,_),s.fromBufferAttribute(n,S),o.fromBufferAttribute(n,g),d.subVectors(o,s),f.subVectors(r,s),d.cross(f),a.fromBufferAttribute(i,_),l.fromBufferAttribute(i,S),c.fromBufferAttribute(i,g),a.add(d),l.add(d),c.add(d),i.setXYZ(_,a.x,a.y,a.z),i.setXYZ(S,l.x,l.y,l.z),i.setXYZ(g,c.x,c.y,c.z)}else for(let h=0,p=n.count;h<p;h+=3)r.fromBufferAttribute(n,h+0),s.fromBufferAttribute(n,h+1),o.fromBufferAttribute(n,h+2),d.subVectors(o,s),f.subVectors(r,s),d.cross(f),i.setXYZ(h+0,d.x,d.y,d.z),i.setXYZ(h+1,d.x,d.y,d.z),i.setXYZ(h+2,d.x,d.y,d.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let n=0,i=e.count;n<i;n++)Wt.fromBufferAttribute(e,n),Wt.normalize(),e.setXYZ(n,Wt.x,Wt.y,Wt.z)}toNonIndexed(){function e(a,l){let c=a.array,d=a.itemSize,f=a.normalized,h=new c.constructor(l.length*d),p=0,_=0;for(let S=0,g=l.length;S<g;S++){a.isInterleavedBufferAttribute?p=l[S]*a.data.stride+a.offset:p=l[S]*d;for(let u=0;u<d;u++)h[_++]=c[p++]}return new Ln(h,d,f)}if(this.index===null)return Ie("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new t,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],c=e(l,i);n.setAttribute(a,c)}let s=this.morphAttributes;for(let a in s){let l=[],c=s[a];for(let d=0,f=c.length;d<f;d++){let h=c[d],p=e(h,i);l.push(p)}n.morphAttributes[a]=l}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let n=this.index;n!==null&&(e.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];e.data.attributes[l]=c.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],d=[];for(let f=0,h=c.length;f<h;f++){let p=c[f];d.push(p.toJSON(e.data))}d.length>0&&(r[l]=d,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let c in r){let d=r[c];this.setAttribute(c,d.clone(n))}let s=e.morphAttributes;for(let c in s){let d=[],f=s[c];for(let h=0,p=f.length;h<p;h++)d.push(f[h].clone(n));this.morphAttributes[c]=d}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,d=o.length;c<d;c++){let f=o[c];this.addGroup(f.start,f.count,f.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var M1=0,Ei=class extends Si{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:M1++}),this.uuid=wo(),this.name="",this.type="Material",this.blending=ls,this.side=$i,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=iu,this.blendDst=ru,this.blendEquation=Pr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ge(0,0,0),this.blendAlpha=0,this.depthFunc=cs,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Ip,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=as,this.stencilZFail=as,this.stencilZPass=as,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let n in e){let i=e[n];if(i===void 0){Ie(`Material: parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Ie(`Material: '${n}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";n&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==ls&&(i.blending=this.blending),this.side!==$i&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==iu&&(i.blendSrc=this.blendSrc),this.blendDst!==ru&&(i.blendDst=this.blendDst),this.blendEquation!==Pr&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==cs&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Ip&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==as&&(i.stencilFail=this.stencilFail),this.stencilZFail!==as&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==as&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(n){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let n=e.clippingPlanes,i=null;if(n!==null){let r=n.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=n[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var qi=new O,yp=new O,Vc=new O,Ar=new O,Sp=new O,Hc=new O,Mp=new O,Da=class{constructor(e=new O,n=new O(0,0,-1)){this.origin=e,this.direction=n}set(e,n){return this.origin.copy(e),this.direction.copy(n),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,n){return n.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,qi)),this}closestPointToPoint(e,n){n.subVectors(e,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let n=qi.subVectors(e,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(e):(qi.copy(this.origin).addScaledVector(this.direction,n),qi.distanceToSquared(e))}distanceSqToSegment(e,n,i,r){yp.copy(e).add(n).multiplyScalar(.5),Vc.copy(n).sub(e).normalize(),Ar.copy(this.origin).sub(yp);let s=e.distanceTo(n)*.5,o=-this.direction.dot(Vc),a=Ar.dot(this.direction),l=-Ar.dot(Vc),c=Ar.lengthSq(),d=Math.abs(1-o*o),f,h,p,_;if(d>0)if(f=o*l-a,h=o*a-l,_=s*d,f>=0)if(h>=-_)if(h<=_){let S=1/d;f*=S,h*=S,p=f*(f+o*h+2*a)+h*(o*f+h+2*l)+c}else h=s,f=Math.max(0,-(o*h+a)),p=-f*f+h*(h+2*l)+c;else h=-s,f=Math.max(0,-(o*h+a)),p=-f*f+h*(h+2*l)+c;else h<=-_?(f=Math.max(0,-(-o*s+a)),h=f>0?-s:Math.min(Math.max(-s,-l),s),p=-f*f+h*(h+2*l)+c):h<=_?(f=0,h=Math.min(Math.max(-s,-l),s),p=h*(h+2*l)+c):(f=Math.max(0,-(o*s+a)),h=f>0?s:Math.min(Math.max(-s,-l),s),p=-f*f+h*(h+2*l)+c);else h=o>0?-s:s,f=Math.max(0,-(o*h+a)),p=-f*f+h*(h+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,f),r&&r.copy(yp).addScaledVector(Vc,h),p}intersectSphere(e,n){qi.subVectors(e.center,this.origin);let i=qi.dot(this.direction),r=qi.dot(qi)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,n):this.at(a,n)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let n=e.normal.dot(this.direction);if(n===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/n;return i>=0?i:null}intersectPlane(e,n){let i=this.distanceToPlane(e);return i===null?null:this.at(i,n)}intersectsPlane(e){let n=e.distanceToPoint(this.origin);return n===0||e.normal.dot(this.direction)*n<0}intersectBox(e,n){let i,r,s,o,a,l,c=1/this.direction.x,d=1/this.direction.y,f=1/this.direction.z,h=this.origin;return c>=0?(i=(e.min.x-h.x)*c,r=(e.max.x-h.x)*c):(i=(e.max.x-h.x)*c,r=(e.min.x-h.x)*c),d>=0?(s=(e.min.y-h.y)*d,o=(e.max.y-h.y)*d):(s=(e.max.y-h.y)*d,o=(e.min.y-h.y)*d),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),f>=0?(a=(e.min.z-h.z)*f,l=(e.max.z-h.z)*f):(a=(e.max.z-h.z)*f,l=(e.min.z-h.z)*f),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,n)}intersectsBox(e){return this.intersectBox(e,qi)!==null}intersectTriangle(e,n,i,r,s){Sp.subVectors(n,e),Hc.subVectors(i,e),Mp.crossVectors(Sp,Hc);let o=this.direction.dot(Mp),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Ar.subVectors(this.origin,e);let l=a*this.direction.dot(Hc.crossVectors(Ar,Hc));if(l<0)return null;let c=a*this.direction.dot(Sp.cross(Ar));if(c<0||l+c>o)return null;let d=-a*Ar.dot(Mp);return d<0?null:this.at(d/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Ti=class extends Ei{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ge(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ji,this.combine=Vp,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},Dv=new Tt,ss=new Da,Gc=new us,Uv=new O,Wc=new O,Xc=new O,qc=new O,wp=new O,Yc=new O,Fv=new O,Zc=new O,Ft=class extends jt{constructor(e=new qt,n=new Ti){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,n){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;n.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){Yc.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let d=a[l],f=s[l];d!==0&&(wp.fromBufferAttribute(f,e),o?Yc.addScaledVector(wp,d):Yc.addScaledVector(wp.sub(n),d))}n.add(Yc)}return n}raycast(e,n){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Gc.copy(i.boundingSphere),Gc.applyMatrix4(s),ss.copy(e.ray).recast(e.near),!(Gc.containsPoint(ss.origin)===!1&&(ss.intersectSphere(Gc,Uv)===null||ss.origin.distanceToSquared(Uv)>(e.far-e.near)**2))&&(Dv.copy(s).invert(),ss.copy(e.ray).applyMatrix4(Dv),!(i.boundingBox!==null&&ss.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,n,ss)))}_computeIntersections(e,n,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,d=s.attributes.uv1,f=s.attributes.normal,h=s.groups,p=s.drawRange;if(a!==null)if(Array.isArray(o))for(let _=0,S=h.length;_<S;_++){let g=h[_],u=o[g.materialIndex],m=Math.max(g.start,p.start),v=Math.min(a.count,Math.min(g.start+g.count,p.start+p.count));for(let M=m,A=v;M<A;M+=3){let E=a.getX(M),P=a.getX(M+1),x=a.getX(M+2);r=$c(this,u,e,i,c,d,f,E,P,x),r&&(r.faceIndex=Math.floor(M/3),r.face.materialIndex=g.materialIndex,n.push(r))}}else{let _=Math.max(0,p.start),S=Math.min(a.count,p.start+p.count);for(let g=_,u=S;g<u;g+=3){let m=a.getX(g),v=a.getX(g+1),M=a.getX(g+2);r=$c(this,o,e,i,c,d,f,m,v,M),r&&(r.faceIndex=Math.floor(g/3),n.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let _=0,S=h.length;_<S;_++){let g=h[_],u=o[g.materialIndex],m=Math.max(g.start,p.start),v=Math.min(l.count,Math.min(g.start+g.count,p.start+p.count));for(let M=m,A=v;M<A;M+=3){let E=M,P=M+1,x=M+2;r=$c(this,u,e,i,c,d,f,E,P,x),r&&(r.faceIndex=Math.floor(M/3),r.face.materialIndex=g.materialIndex,n.push(r))}}else{let _=Math.max(0,p.start),S=Math.min(l.count,p.start+p.count);for(let g=_,u=S;g<u;g+=3){let m=g,v=g+1,M=g+2;r=$c(this,o,e,i,c,d,f,m,v,M),r&&(r.faceIndex=Math.floor(g/3),n.push(r))}}}};function w1(t,e,n,i,r,s,o,a){let l;if(e.side===Qt?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===$i,a),l===null)return null;Zc.copy(a),Zc.applyMatrix4(t.matrixWorld);let c=n.ray.origin.distanceTo(Zc);return c<n.near||c>n.far?null:{distance:c,point:Zc.clone(),object:t}}function $c(t,e,n,i,r,s,o,a,l,c){t.getVertexPosition(a,Wc),t.getVertexPosition(l,Xc),t.getVertexPosition(c,qc);let d=w1(t,e,n,i,Wc,Xc,qc,Fv);if(d){let f=new O;Rr.getBarycoord(Fv,Wc,Xc,qc,f),r&&(d.uv=Rr.getInterpolatedAttribute(r,a,l,c,f,new Ke)),s&&(d.uv1=Rr.getInterpolatedAttribute(s,a,l,c,f,new Ke)),o&&(d.normal=Rr.getInterpolatedAttribute(o,a,l,c,f,new O),d.normal.dot(i.direction)>0&&d.normal.multiplyScalar(-1));let h={a,b:l,c,normal:new O,materialIndex:0};Rr.getNormal(Wc,Xc,qc,h.normal),d.face=h,d.barycoord=f}return d}var xu=class extends Sn{constructor(e=null,n=1,i=1,r,s,o,a,l,c=Xt,d=Xt,f,h){super(null,o,a,l,c,d,r,s,f,h),this.isDataTexture=!0,this.image={data:e,width:n,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Ep=new O,E1=new O,T1=new Fe,vi=class{constructor(e=new O(1,0,0),n=0){this.isPlane=!0,this.normal=e,this.constant=n}set(e,n){return this.normal.copy(e),this.constant=n,this}setComponents(e,n,i,r){return this.normal.set(e,n,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,n){return this.normal.copy(e),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(e,n,i){let r=Ep.subVectors(i,n).cross(E1.subVectors(e,n)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,n){return n.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,n,i=!0){let r=e.delta(Ep),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?n.copy(e.start):null;let o=-(e.start.dot(this.normal)+this.constant)/s;return i===!0&&(o<0||o>1)?null:n.copy(e.start).addScaledVector(r,o)}intersectsLine(e){let n=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return n<0&&i>0||i<0&&n>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,n){let i=n||T1.getNormalMatrix(e),r=this.coplanarPoint(Ep).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},os=new us,b1=new Ke(.5,.5),Jc=new O,fo=class{constructor(e=new vi,n=new vi,i=new vi,r=new vi,s=new vi,o=new vi){this.planes=[e,n,i,r,s,o]}set(e,n,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(n),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,n=si,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],c=s[3],d=s[4],f=s[5],h=s[6],p=s[7],_=s[8],S=s[9],g=s[10],u=s[11],m=s[12],v=s[13],M=s[14],A=s[15];if(r[0].setComponents(c-o,p-d,u-_,A-m).normalize(),r[1].setComponents(c+o,p+d,u+_,A+m).normalize(),r[2].setComponents(c+a,p+f,u+S,A+v).normalize(),r[3].setComponents(c-a,p-f,u-S,A-v).normalize(),i)r[4].setComponents(l,h,g,M).normalize(),r[5].setComponents(c-l,p-h,u-g,A-M).normalize();else if(r[4].setComponents(c-l,p-h,u-g,A-M).normalize(),n===si)r[5].setComponents(c+l,p+h,u+g,A+M).normalize();else if(n===oo)r[5].setComponents(l,h,g,M).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),os.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let n=e.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),os.copy(n.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(os)}intersectsSprite(e){os.center.set(0,0,0);let n=b1.distanceTo(e.center);return os.radius=.7071067811865476+n,os.applyMatrix4(e.matrixWorld),this.intersectsSphere(os)}intersectsSphere(e){let n=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(n[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let n=this.planes;for(let i=0;i<6;i++){let r=n[i];if(Jc.x=r.normal.x>0?e.max.x:e.min.x,Jc.y=r.normal.y>0?e.max.y:e.min.y,Jc.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(Jc)<0)return!1}return!0}containsPoint(e){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var po=class extends Ei{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Ge(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},yu=new O,Su=new O,Ov=new Tt,wa=new Da,Kc=new us,Tp=new O,Bv=new O,Mu=class extends jt{constructor(e=new qt,n=new po){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let n=e.attributes.position,i=[0];for(let r=1,s=n.count;r<s;r++)yu.fromBufferAttribute(n,r-1),Su.fromBufferAttribute(n,r),i[r]=i[r-1],i[r]+=yu.distanceTo(Su);e.setAttribute("lineDistance",new st(i,1))}else Ie("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,n){let i=this.geometry,r=this.matrixWorld,s=e.params.Line.threshold,o=i.drawRange;if(i.boundingSphere===null&&i.computeBoundingSphere(),Kc.copy(i.boundingSphere),Kc.applyMatrix4(r),Kc.radius+=s,e.ray.intersectsSphere(Kc)===!1)return;Ov.copy(r).invert(),wa.copy(e.ray).applyMatrix4(Ov);let a=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=this.isLineSegments?2:1,d=i.index,h=i.attributes.position;if(d!==null){let p=Math.max(0,o.start),_=Math.min(d.count,o.start+o.count);for(let S=p,g=_-1;S<g;S+=c){let u=d.getX(S),m=d.getX(S+1),v=jc(this,e,wa,l,u,m,S);v&&n.push(v)}if(this.isLineLoop){let S=d.getX(_-1),g=d.getX(p),u=jc(this,e,wa,l,S,g,_-1);u&&n.push(u)}}else{let p=Math.max(0,o.start),_=Math.min(h.count,o.start+o.count);for(let S=p,g=_-1;S<g;S+=c){let u=jc(this,e,wa,l,S,S+1,S);u&&n.push(u)}if(this.isLineLoop){let S=jc(this,e,wa,l,_-1,p,_-1);S&&n.push(S)}}}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}};function jc(t,e,n,i,r,s,o){let a=t.geometry.attributes.position;if(yu.fromBufferAttribute(a,r),Su.fromBufferAttribute(a,s),n.distanceSqToSegment(yu,Su,Tp,Bv)>i)return;Tp.applyMatrix4(t.matrixWorld);let c=e.ray.origin.distanceTo(Tp);if(!(c<e.near||c>e.far))return{distance:c,point:Bv.clone().applyMatrix4(t.matrixWorld),index:o,face:null,faceIndex:null,barycoord:null,object:t}}var kv=new O,zv=new O,Ua=class extends Mu{constructor(e,n){super(e,n),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let e=this.geometry;if(e.index===null){let n=e.attributes.position,i=[];for(let r=0,s=n.count;r<s;r+=2)kv.fromBufferAttribute(n,r),zv.fromBufferAttribute(n,r+1),i[r]=r===0?0:i[r-1],i[r+1]=i[r]+kv.distanceTo(zv);e.setAttribute("lineDistance",new st(i,1))}else Ie("LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}};var Fa=class extends Sn{constructor(e=[],n=Ur,i,r,s,o,a,l,c,d){super(e,n,i,r,s,o,a,l,c,d),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}};var Ki=class extends Sn{constructor(e,n,i=ai,r,s,o,a=Xt,l=Xt,c,d=yi,f=1){if(d!==yi&&d!==Or)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:n,depth:f};super(h,r,s,o,a,l,d,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new co(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let n=super.toJSON(e);return this.compareFunction!==null&&(n.compareFunction=this.compareFunction),n}},wu=class extends Ki{constructor(e,n=ai,i=Ur,r,s,o=Xt,a=Xt,l,c=yi){let d={width:e,height:e,depth:1},f=[d,d,d,d,d,d];super(e,e,n,i,r,s,o,a,l,c),this.image=f,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Oa=class extends Sn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},mo=class t extends qt{constructor(e=1,n=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:n,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],c=[],d=[],f=[],h=0,p=0;_("z","y","x",-1,-1,i,n,e,o,s,0),_("z","y","x",1,-1,i,n,-e,o,s,1),_("x","z","y",1,1,e,i,n,r,o,2),_("x","z","y",1,-1,e,i,-n,r,o,3),_("x","y","z",1,-1,e,n,i,r,s,4),_("x","y","z",-1,-1,e,n,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new st(c,3)),this.setAttribute("normal",new st(d,3)),this.setAttribute("uv",new st(f,2));function _(S,g,u,m,v,M,A,E,P,x,R){let C=M/P,b=A/x,I=M/2,W=A/2,H=E/2,D=P+1,B=x+1,k=0,te=0,se=new O;for(let ue=0;ue<B;ue++){let ve=ue*b-W;for(let we=0;we<D;we++){let ze=we*C-I;se[S]=ze*m,se[g]=ve*v,se[u]=H,c.push(se.x,se.y,se.z),se[S]=0,se[g]=0,se[u]=E>0?1:-1,d.push(se.x,se.y,se.z),f.push(we/P),f.push(1-ue/x),k+=1}}for(let ue=0;ue<x;ue++)for(let ve=0;ve<P;ve++){let we=h+ve+D*ue,ze=h+ve+D*(ue+1),je=h+(ve+1)+D*(ue+1),De=h+(ve+1)+D*ue;l.push(we,ze,De),l.push(ze,je,De),te+=6}a.addGroup(p,te,R),p+=te,h+=k}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var go=class t extends qt{constructor(e=1,n=32,i=0,r=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:n,thetaStart:i,thetaLength:r},n=Math.max(3,n);let s=[],o=[],a=[],l=[],c=new O,d=new Ke;o.push(0,0,0),a.push(0,0,1),l.push(.5,.5);for(let f=0,h=3;f<=n;f++,h+=3){let p=i+f/n*r;c.x=e*Math.cos(p),c.y=e*Math.sin(p),o.push(c.x,c.y,c.z),a.push(0,0,1),d.x=(o[h]/e+1)/2,d.y=(o[h+1]/e+1)/2,l.push(d.x,d.y)}for(let f=1;f<=n;f++)s.push(f,f+1,0);this.setIndex(s),this.setAttribute("position",new st(o,3)),this.setAttribute("normal",new st(a,3)),this.setAttribute("uv",new st(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.segments,e.thetaStart,e.thetaLength)}},Eu=class t extends qt{constructor(e=1,n=1,i=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:n,height:i,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};let c=this;r=Math.floor(r),s=Math.floor(s);let d=[],f=[],h=[],p=[],_=0,S=[],g=i/2,u=0;m(),o===!1&&(e>0&&v(!0),n>0&&v(!1)),this.setIndex(d),this.setAttribute("position",new st(f,3)),this.setAttribute("normal",new st(h,3)),this.setAttribute("uv",new st(p,2));function m(){let M=new O,A=new O,E=0,P=(n-e)/i;for(let x=0;x<=s;x++){let R=[],C=x/s,b=C*(n-e)+e;for(let I=0;I<=r;I++){let W=I/r,H=W*l+a,D=Math.sin(H),B=Math.cos(H);A.x=b*D,A.y=-C*i+g,A.z=b*B,f.push(A.x,A.y,A.z),M.set(D,P,B).normalize(),h.push(M.x,M.y,M.z),p.push(W,1-C),R.push(_++)}S.push(R)}for(let x=0;x<r;x++)for(let R=0;R<s;R++){let C=S[R][x],b=S[R+1][x],I=S[R+1][x+1],W=S[R][x+1];(e>0||R!==0)&&(d.push(C,b,W),E+=3),(n>0||R!==s-1)&&(d.push(b,I,W),E+=3)}c.addGroup(u,E,0),u+=E}function v(M){let A=_,E=new Ke,P=new O,x=0,R=M===!0?e:n,C=M===!0?1:-1;for(let I=1;I<=r;I++)f.push(0,g*C,0),h.push(0,C,0),p.push(.5,.5),_++;let b=_;for(let I=0;I<=r;I++){let H=I/r*l+a,D=Math.cos(H),B=Math.sin(H);P.x=R*B,P.y=g*C,P.z=R*D,f.push(P.x,P.y,P.z),h.push(0,C,0),E.x=D*.5+.5,E.y=B*.5*C+.5,p.push(E.x,E.y),_++}for(let I=0;I<r;I++){let W=A+I,H=b+I;M===!0?d.push(H,H+1,W):d.push(H+1,H,W),x+=3}c.addGroup(u,x,M===!0?1:2),u+=x}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},Ba=class t extends Eu{constructor(e=1,n=1,i=32,r=1,s=!1,o=0,a=Math.PI*2){super(0,e,n,i,r,s,o,a),this.type="ConeGeometry",this.parameters={radius:e,height:n,radialSegments:i,heightSegments:r,openEnded:s,thetaStart:o,thetaLength:a}}static fromJSON(e){return new t(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var ka=class t extends qt{constructor(e=1,n=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:n,widthSegments:i,heightSegments:r};let s=e/2,o=n/2,a=Math.floor(i),l=Math.floor(r),c=a+1,d=l+1,f=e/a,h=n/l,p=[],_=[],S=[],g=[];for(let u=0;u<d;u++){let m=u*h-o;for(let v=0;v<c;v++){let M=v*f-s;_.push(M,-m,0),S.push(0,0,1),g.push(v/a),g.push(1-u/l)}}for(let u=0;u<l;u++)for(let m=0;m<a;m++){let v=m+c*u,M=m+c*(u+1),A=m+1+c*(u+1),E=m+1+c*u;p.push(v,M,E),p.push(M,A,E)}this.setIndex(p),this.setAttribute("position",new st(_,3)),this.setAttribute("normal",new st(S,3)),this.setAttribute("uv",new st(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.widthSegments,e.heightSegments)}},za=class t extends qt{constructor(e=.5,n=1,i=32,r=1,s=0,o=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:e,outerRadius:n,thetaSegments:i,phiSegments:r,thetaStart:s,thetaLength:o},i=Math.max(3,i),r=Math.max(1,r);let a=[],l=[],c=[],d=[],f=e,h=(n-e)/r,p=new O,_=new Ke;for(let S=0;S<=r;S++){for(let g=0;g<=i;g++){let u=s+g/i*o;p.x=f*Math.cos(u),p.y=f*Math.sin(u),l.push(p.x,p.y,p.z),c.push(0,0,1),_.x=(p.x/n+1)/2,_.y=(p.y/n+1)/2,d.push(_.x,_.y)}f+=h}for(let S=0;S<r;S++){let g=S*(i+1);for(let u=0;u<i;u++){let m=u+g,v=m,M=m+i+1,A=m+i+2,E=m+1;a.push(v,M,E),a.push(M,A,E)}}this.setIndex(a),this.setAttribute("position",new st(l,3)),this.setAttribute("normal",new st(c,3)),this.setAttribute("uv",new st(d,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.innerRadius,e.outerRadius,e.thetaSegments,e.phiSegments,e.thetaStart,e.thetaLength)}};var Va=class t extends qt{constructor(e=1,n=32,i=16,r=0,s=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:n,heightSegments:i,phiStart:r,phiLength:s,thetaStart:o,thetaLength:a},n=Math.max(3,Math.floor(n)),i=Math.max(2,Math.floor(i));let l=Math.min(o+a,Math.PI),c=0,d=[],f=new O,h=new O,p=[],_=[],S=[],g=[];for(let u=0;u<=i;u++){let m=[],v=u/i,M=0;u===0&&o===0?M=.5/n:u===i&&l===Math.PI&&(M=-.5/n);for(let A=0;A<=n;A++){let E=A/n;f.x=-e*Math.cos(r+E*s)*Math.sin(o+v*a),f.y=e*Math.cos(o+v*a),f.z=e*Math.sin(r+E*s)*Math.sin(o+v*a),_.push(f.x,f.y,f.z),h.copy(f).normalize(),S.push(h.x,h.y,h.z),g.push(E+M,1-v),m.push(c++)}d.push(m)}for(let u=0;u<i;u++)for(let m=0;m<n;m++){let v=d[u][m+1],M=d[u][m],A=d[u+1][m],E=d[u+1][m+1];(u!==0||o>0)&&p.push(v,M,E),(u!==i-1||l<Math.PI)&&p.push(M,A,E)}this.setIndex(p),this.setAttribute("position",new st(_,3)),this.setAttribute("normal",new st(S,3)),this.setAttribute("uv",new st(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};function ds(t){let e={};for(let n in t){e[n]={};for(let i in t[n]){let r=t[n][i];if(Vv(r))r.isRenderTargetTexture?(Ie("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[n][i]=null):e[n][i]=r.clone();else if(Array.isArray(r))if(Vv(r[0])){let s=[];for(let o=0,a=r.length;o<a;o++)s[o]=r[o].clone();e[n][i]=s}else e[n][i]=r.slice();else e[n][i]=r}}return e}function un(t){let e={};for(let n=0;n<t.length;n++){let i=ds(t[n]);for(let r in i)e[r]=i[r]}return e}function Vv(t){return t&&(t.isColor||t.isMatrix3||t.isMatrix4||t.isVector2||t.isVector3||t.isVector4||t.isTexture||t.isQuaternion)}function A1(t){let e=[];for(let n=0;n<t.length;n++)e.push(t[n].clone());return e}function om(t){let e=t.getRenderTarget();return e===null?t.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:$e.workingColorSpace}var Rx={clone:ds,merge:un},C1=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,R1=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Dn=class extends Ei{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=C1,this.fragmentShader=R1,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=ds(e.uniforms),this.uniformsGroups=A1(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let n=super.toJSON(e);n.glslVersion=this.glslVersion,n.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?n.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?n.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?n.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?n.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?n.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?n.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?n.uniforms[r]={type:"m4",value:o.toArray()}:n.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}},Tu=class extends Dn{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},Ha=class extends Ei{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Ge(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ge(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=tl,this.normalScale=new Ke(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ji,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var _o=class extends Ei{constructor(e){super(),this.isMeshToonMaterial=!0,this.defines={TOON:""},this.type="MeshToonMaterial",this.color=new Ge(16777215),this.map=null,this.gradientMap=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ge(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=tl,this.normalScale=new Ke(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.alphaMap=null,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.gradientMap=e.gradientMap,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.alphaMap=e.alphaMap,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}};var bu=class extends Ei{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=gx,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Au=class extends Ei{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function Qc(t,e){return!t||t.constructor===e?t:typeof e.BYTES_PER_ELEMENT=="number"?new e(t):Array.prototype.slice.call(t)}var Ir=class{constructor(e,n,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let n=this.parameterPositions,i=this._cachedIndex,r=n[i],s=n[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=n[++i],e<r)break t}o=n.length;break n}if(!(e>=s)){let a=n[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=n[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<n[a]?o=a:i=a+1}if(r=n[i],s=n[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let n=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)n[o]=i[s+o];return n}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Cu=class extends Ir{constructor(e,n,i,r){super(e,n,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Cp,endingEnd:Cp}}intervalChanged_(e,n,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case Rp:s=e,a=2*n-i;break;case Pp:s=r.length-2,a=n+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case Rp:o=e,l=2*i-n;break;case Pp:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=n}let c=(i-n)*.5,d=this.valueSize;this._weightPrev=c/(n-a),this._weightNext=c/(l-i),this._offsetPrev=s*d,this._offsetNext=o*d}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this._offsetPrev,f=this._offsetNext,h=this._weightPrev,p=this._weightNext,_=(i-n)/(r-n),S=_*_,g=S*_,u=-h*g+2*h*S-h*_,m=(1+h)*g+(-1.5-2*h)*S+(-.5+h)*_+1,v=(-1-p)*g+(1.5+p)*S+.5*_,M=p*g-p*S;for(let A=0;A!==a;++A)s[A]=u*o[d+A]+m*o[c+A]+v*o[l+A]+M*o[f+A];return s}},Ru=class extends Ir{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=(i-n)/(r-n),f=1-d;for(let h=0;h!==a;++h)s[h]=o[c+h]*f+o[l+h]*d;return s}},Pu=class extends Ir{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},Iu=class extends Ir{interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this.settings||this.DefaultSettings_,f=d.inTangents,h=d.outTangents;if(!f||!h){let S=(i-n)/(r-n),g=1-S;for(let u=0;u!==a;++u)s[u]=o[c+u]*g+o[l+u]*S;return s}let p=a*2,_=e-1;for(let S=0;S!==a;++S){let g=o[c+S],u=o[l+S],m=_*p+S*2,v=h[m],M=h[m+1],A=e*p+S*2,E=f[A],P=f[A+1],x=(i-n)/(r-n),R,C,b,I,W;for(let H=0;H<8;H++){R=x*x,C=R*x,b=1-x,I=b*b,W=I*b;let B=W*n+3*I*x*v+3*b*R*E+C*r-i;if(Math.abs(B)<1e-10)break;let k=3*I*(v-n)+6*b*x*(E-v)+3*R*(r-E);if(Math.abs(k)<1e-10)break;x=x-B/k,x=Math.max(0,Math.min(1,x))}s[S]=W*g+3*I*x*M+3*b*R*P+C*u}return s}},Un=class{constructor(e,n,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Qc(n,this.TimeBufferType),this.values=Qc(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let n=e.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(e);else{i={name:e.name,times:Qc(e.times,Array),values:Qc(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new Pu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Ru(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Cu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let n=new Iu(this.times,this.values,this.getValueSize(),e);return this.settings&&(n.settings=this.settings),n}setInterpolation(e){let n;switch(e){case ba:n=this.InterpolantFactoryMethodDiscrete;break;case pu:n=this.InterpolantFactoryMethodLinear;break;case nu:n=this.InterpolantFactoryMethodSmooth;break;case Ap:n=this.InterpolantFactoryMethodBezier;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return Ie("KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return ba;case this.InterpolantFactoryMethodLinear:return pu;case this.InterpolantFactoryMethodSmooth:return nu;case this.InterpolantFactoryMethodBezier:return Ap}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]+=e}return this}scale(e){if(e!==1){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]*=e}return this}trim(e,n){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>n;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(Ne("KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(Ne("KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){Ne("KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){Ne("KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&qM(r))for(let a=0,l=r.length;a!==l;++a){let c=r[a];if(isNaN(c)){Ne("KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===nu,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,c=e[a],d=e[a+1];if(c!==d&&(a!==1||c!==e[0]))if(r)l=!0;else{let f=a*i,h=f-i,p=f+i;for(let _=0;_!==i;++_){let S=n[f+_];if(S!==n[h+_]||S!==n[p+_]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let f=a*i,h=o*i;for(let p=0;p!==i;++p)n[h+p]=n[f+p]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,c=0;c!==i;++c)n[l+c]=n[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=n.slice(0,o*i)):(this.times=e,this.values=n),this}clone(){let e=this.times.slice(),n=this.values.slice(),i=this.constructor,r=new i(this.name,e,n);return r.createInterpolant=this.createInterpolant,r}};Un.prototype.ValueTypeName="";Un.prototype.TimeBufferType=Float32Array;Un.prototype.ValueBufferType=Float32Array;Un.prototype.DefaultInterpolation=pu;var Lr=class extends Un{constructor(e,n,i){super(e,n,i)}};Lr.prototype.ValueTypeName="bool";Lr.prototype.ValueBufferType=Array;Lr.prototype.DefaultInterpolation=ba;Lr.prototype.InterpolantFactoryMethodLinear=void 0;Lr.prototype.InterpolantFactoryMethodSmooth=void 0;var Lu=class extends Un{constructor(e,n,i,r){super(e,n,i,r)}};Lu.prototype.ValueTypeName="color";var Nu=class extends Un{constructor(e,n,i,r){super(e,n,i,r)}};Nu.prototype.ValueTypeName="number";var Du=class extends Ir{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-n)/(r-n),c=e*a;for(let d=c+a;c!==d;c+=4)Mi.slerpFlat(s,0,o,c-a,o,c,l);return s}},Ga=class extends Un{constructor(e,n,i,r){super(e,n,i,r)}InterpolantFactoryMethodLinear(e){return new Du(this.times,this.values,this.getValueSize(),e)}};Ga.prototype.ValueTypeName="quaternion";Ga.prototype.InterpolantFactoryMethodSmooth=void 0;var Nr=class extends Un{constructor(e,n,i){super(e,n,i)}};Nr.prototype.ValueTypeName="string";Nr.prototype.ValueBufferType=Array;Nr.prototype.DefaultInterpolation=ba;Nr.prototype.InterpolantFactoryMethodLinear=void 0;Nr.prototype.InterpolantFactoryMethodSmooth=void 0;var Uu=class extends Un{constructor(e,n,i,r){super(e,n,i,r)}};Uu.prototype.ValueTypeName="vector";var Fu=class{constructor(e,n,i){let r=this,s=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=n,this.onError=i,this._abortController=null,this.itemStart=function(d){a++,s===!1&&r.onStart!==void 0&&r.onStart(d,o,a),s=!0},this.itemEnd=function(d){o++,r.onProgress!==void 0&&r.onProgress(d,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(d){r.onError!==void 0&&r.onError(d)},this.resolveURL=function(d){return l?l(d):d},this.setURLModifier=function(d){return l=d,this},this.addHandler=function(d,f){return c.push(d,f),this},this.removeHandler=function(d){let f=c.indexOf(d);return f!==-1&&c.splice(f,2),this},this.getHandler=function(d){for(let f=0,h=c.length;f<h;f+=2){let p=c[f],_=c[f+1];if(p.global&&(p.lastIndex=0),p.test(d))return _}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Px=new Fu,Ou=class{constructor(e){this.manager=e!==void 0?e:Px,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,n){let i=this;return new Promise(function(r,s){i.load(e,r,n,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Ou.DEFAULT_MATERIAL_NAME="__DEFAULT";var Wa=class extends jt{constructor(e,n=1){super(),this.isLight=!0,this.type="Light",this.color=new Ge(e),this.intensity=n}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,n){return super.copy(e,n),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let n=super.toJSON(e);return n.object.color=this.color.getHex(),n.object.intensity=this.intensity,n}},vo=class extends Wa{constructor(e,n,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(jt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ge(n)}copy(e,n){return super.copy(e,n),this.groundColor.copy(e.groundColor),this}toJSON(e){let n=super.toJSON(e);return n.object.groundColor=this.groundColor.getHex(),n}},bp=new Tt,Hv=new O,Gv=new O,Np=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ke(512,512),this.mapType=Mn,this.map=null,this.mapPass=null,this.matrix=new Tt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new fo,this._frameExtents=new Ke(1,1),this._viewportCount=1,this._viewports=[new bt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let n=this.camera,i=this.matrix;Hv.setFromMatrixPosition(e.matrixWorld),n.position.copy(Hv),Gv.setFromMatrixPosition(e.target.matrixWorld),n.lookAt(Gv),n.updateMatrixWorld(),bp.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(bp,n.coordinateSystem,n.reversedDepth),n.coordinateSystem===oo||n.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(bp)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},eu=new O,tu=new Mi,_i=new O,Xa=class extends jt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Tt,this.projectionMatrix=new Tt,this.projectionMatrixInverse=new Tt,this.coordinateSystem=si,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,n){return super.copy(e,n),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(eu,tu,_i),_i.x===1&&_i.y===1&&_i.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(eu,tu,_i.set(1,1,1)).invert()}updateWorldMatrix(e,n){super.updateWorldMatrix(e,n),this.matrixWorld.decompose(eu,tu,_i),_i.x===1&&_i.y===1&&_i.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(eu,tu,_i.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Cr=new O,Wv=new Ke,Xv=new Ke,cn=class extends Xa{constructor(e=50,n=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let n=.5*this.getFilmHeight()/e;this.fov=lo*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Ea*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return lo*2*Math.atan(Math.tan(Ea*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,n,i){Cr.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Cr.x,Cr.y).multiplyScalar(-e/Cr.z),Cr.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Cr.x,Cr.y).multiplyScalar(-e/Cr.z)}getViewSize(e,n){return this.getViewBounds(e,Wv,Xv),n.subVectors(Xv,Wv)}setViewOffset(e,n,i,r,s,o){this.aspect=e/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,n=e*Math.tan(Ea*.5*this.fov)/this.zoom,i=2*n,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,n-=o.offsetY*i/c,r*=o.width/l,i*=o.height/c}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,n,n-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}};var Dr=class extends Xa{constructor(e=-1,n=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=n,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,n,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+n,l=r-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,d=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=d*this.view.offsetY,l=a-d*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}},Dp=class extends Np{constructor(){super(new Dr(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},xo=class extends Wa{constructor(e,n){super(e,n),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(jt.DEFAULT_UP),this.updateMatrix(),this.target=new jt,this.shadow=new Dp}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let n=super.toJSON(e);return n.object.shadow=this.shadow.toJSON(),n.object.target=this.target.uuid,n}};var no=-90,io=1,Bu=class extends jt{constructor(e,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new cn(no,io,e,n);r.layers=this.layers,this.add(r);let s=new cn(no,io,e,n);s.layers=this.layers,this.add(s);let o=new cn(no,io,e,n);o.layers=this.layers,this.add(o);let a=new cn(no,io,e,n);a.layers=this.layers,this.add(a);let l=new cn(no,io,e,n);l.layers=this.layers,this.add(l);let c=new cn(no,io,e,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,n=this.children.concat(),[i,r,s,o,a,l]=n;for(let c of n)this.remove(c);if(e===si)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===oo)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of n)this.add(c),c.updateMatrixWorld()}update(e,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,c,d]=this.children,f=e.getRenderTarget(),h=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),_=e.xr.enabled;e.xr.enabled=!1;let S=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let g=!1;e.isWebGLRenderer===!0?g=e.state.buffers.depth.getReversed():g=e.reversedDepthBuffer,e.setRenderTarget(i,0,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,s),e.setRenderTarget(i,1,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,o),e.setRenderTarget(i,2,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,a),e.setRenderTarget(i,3,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,l),e.setRenderTarget(i,4,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,c),i.texture.generateMipmaps=S,e.setRenderTarget(i,5,r),g&&e.autoClear===!1&&e.clearDepth(),e.render(n,d),e.setRenderTarget(f,h,p),e.xr.enabled=_,i.texture.needsPMREMUpdate=!0}},ku=class extends cn{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var am="\\[\\]\\.:\\/",P1=new RegExp("["+am+"]","g"),lm="[^"+am+"]",I1="[^"+am.replace("\\.","")+"]",L1=/((?:WC+[\/:])*)/.source.replace("WC",lm),N1=/(WCOD+)?/.source.replace("WCOD",I1),D1=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",lm),U1=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",lm),F1=new RegExp("^"+L1+N1+D1+U1+"$"),O1=["material","materials","bones","map"],Up=class{constructor(e,n,i){let r=i||yt.parseTrackName(n);this._targetGroup=e,this._bindings=e.subscribe_(n,r)}getValue(e,n){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,n)}setValue(e,n){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,n)}bind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].bind()}unbind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].unbind()}},yt=class t{constructor(e,n,i){this.path=n,this.parsedPath=i||t.parseTrackName(n),this.node=t.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,n,i){return e&&e.isAnimationObjectGroup?new t.Composite(e,n,i):new t(e,n,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(P1,"")}static parseTrackName(e){let n=F1.exec(e);if(n===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);O1.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,n){if(n===void 0||n===""||n==="."||n===-1||n===e.name||n===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(n);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===n||a.uuid===n)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,n){e[n]=this.targetObject[this.propertyName]}_getValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[n++]=i[r]}_getValue_arrayElement(e,n){e[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,n){this.resolvedProperty.toArray(e,n)}_setValue_direct(e,n){this.targetObject[this.propertyName]=e[n]}_setValue_direct_setNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++]}_setValue_array_setNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,n){this.resolvedProperty[this.propertyIndex]=e[n]}_setValue_arrayElement_setNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,n){this.resolvedProperty.fromArray(e,n)}_setValue_fromArray_setNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,n){this.bind(),this.getValue(e,n)}_setValue_unbound(e,n){this.bind(),this.setValue(e,n)}bind(){let e=this.node,n=this.parsedPath,i=n.objectName,r=n.propertyName,s=n.propertyIndex;if(e||(e=t.findNode(this.rootNode,n.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Ie("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!e.material){Ne("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Ne("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Ne("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let d=0;d<e.length;d++)if(e[d].name===c){c=d;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Ne("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Ne("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){Ne("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){Ne("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[r];if(o===void 0){let c=n.nodeName;Ne("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){Ne("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Ne("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};yt.Composite=Up;yt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};yt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};yt.prototype.GetterByBindingType=[yt.prototype._getValue_direct,yt.prototype._getValue_array,yt.prototype._getValue_arrayElement,yt.prototype._getValue_toArray];yt.prototype.SetterByBindingTypeAndVersioning=[[yt.prototype._setValue_direct,yt.prototype._setValue_direct_setNeedsUpdate,yt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[yt.prototype._setValue_array,yt.prototype._setValue_array_setNeedsUpdate,yt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[yt.prototype._setValue_arrayElement,yt.prototype._setValue_arrayElement_setNeedsUpdate,yt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[yt.prototype._setValue_fromArray,yt.prototype._setValue_fromArray_setNeedsUpdate,yt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var $A=new Float32Array(1);var pm=class pm{constructor(e,n,i,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,n,i,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,n=0){for(let i=0;i<4;i++)this.elements[i]=e[i+n];return this}set(e,n,i,r){let s=this.elements;return s[0]=e,s[2]=n,s[1]=i,s[3]=r,this}};pm.prototype.isMatrix2=!0;var Fp=pm;function cm(t,e,n,i){let r=B1(i);switch(n){case em:return t*e;case nm:return t*e/r.components*r.byteLength;case Yu:return t*e/r.components*r.byteLength;case Br:return t*e*2/r.components*r.byteLength;case Zu:return t*e*2/r.components*r.byteLength;case tm:return t*e*3/r.components*r.byteLength;case qn:return t*e*4/r.components*r.byteLength;case $u:return t*e*4/r.components*r.byteLength;case $a:case Ja:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case Ka:case ja:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Ku:case Qu:return Math.max(t,16)*Math.max(e,8)/4;case Ju:case ju:return Math.max(t,8)*Math.max(e,8)/2;case eh:case th:case ih:case rh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case nh:case Qa:case sh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case oh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case ah:return Math.floor((t+4)/5)*Math.floor((e+3)/4)*16;case lh:return Math.floor((t+4)/5)*Math.floor((e+4)/5)*16;case ch:return Math.floor((t+5)/6)*Math.floor((e+4)/5)*16;case uh:return Math.floor((t+5)/6)*Math.floor((e+5)/6)*16;case hh:return Math.floor((t+7)/8)*Math.floor((e+4)/5)*16;case dh:return Math.floor((t+7)/8)*Math.floor((e+5)/6)*16;case fh:return Math.floor((t+7)/8)*Math.floor((e+7)/8)*16;case ph:return Math.floor((t+9)/10)*Math.floor((e+4)/5)*16;case mh:return Math.floor((t+9)/10)*Math.floor((e+5)/6)*16;case gh:return Math.floor((t+9)/10)*Math.floor((e+7)/8)*16;case _h:return Math.floor((t+9)/10)*Math.floor((e+9)/10)*16;case vh:return Math.floor((t+11)/12)*Math.floor((e+9)/10)*16;case xh:return Math.floor((t+11)/12)*Math.floor((e+11)/12)*16;case yh:case Sh:case Mh:return Math.ceil(t/4)*Math.ceil(e/4)*16;case wh:case Eh:return Math.ceil(t/4)*Math.ceil(e/4)*8;case el:case Th:return Math.ceil(t/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function B1(t){switch(t){case Mn:case Jp:return{byteLength:1,components:1};case So:case Kp:case Ai:return{byteLength:2,components:1};case Xu:case qu:return{byteLength:2,components:4};case ai:case Wu:case li:return{byteLength:4,components:1};case jp:case Qp:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${t}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"184"}}));typeof window<"u"&&(window.__THREE__?Ie("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="184");function Qx(){let t=null,e=!1,n=null,i=null;function r(s,o){n(s,o),i=t.requestAnimationFrame(r)}return{start:function(){e!==!0&&n!==null&&t!==null&&(i=t.requestAnimationFrame(r),e=!0)},stop:function(){t!==null&&t.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){n=s},setContext:function(s){t=s}}}function z1(t){let e=new WeakMap;function n(a,l){let c=a.array,d=a.usage,f=c.byteLength,h=t.createBuffer();t.bindBuffer(l,h),t.bufferData(l,c,d),a.onUploadCallback();let p;if(c instanceof Float32Array)p=t.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)p=t.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?p=t.HALF_FLOAT:p=t.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=t.SHORT;else if(c instanceof Uint32Array)p=t.UNSIGNED_INT;else if(c instanceof Int32Array)p=t.INT;else if(c instanceof Int8Array)p=t.BYTE;else if(c instanceof Uint8Array)p=t.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=t.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:h,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:f}}function i(a,l,c){let d=l.array,f=l.updateRanges;if(t.bindBuffer(c,a),f.length===0)t.bufferSubData(c,0,d);else{f.sort((p,_)=>p.start-_.start);let h=0;for(let p=1;p<f.length;p++){let _=f[h],S=f[p];S.start<=_.start+_.count+1?_.count=Math.max(_.count,S.start+S.count-_.start):(++h,f[h]=S)}f.length=h+1;for(let p=0,_=f.length;p<_;p++){let S=f[p];t.bufferSubData(c,S.start*d.BYTES_PER_ELEMENT,d,S.start,S.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(t.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let d=e.get(a);(!d||d.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=e.get(a);if(c===void 0)e.set(a,n(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}var V1=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,H1=`#ifdef USE_ALPHAHASH
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
#endif`,G1=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,W1=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,X1=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,q1=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Y1=`#ifdef USE_AOMAP
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
#endif`,Z1=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,$1=`#ifdef USE_BATCHING
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
#endif`,J1=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,K1=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,j1=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Q1=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,ew=`#ifdef USE_IRIDESCENCE
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
#endif`,tw=`#ifdef USE_BUMPMAP
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
#endif`,nw=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,iw=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,rw=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,sw=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,ow=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,aw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,lw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,cw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,uw=`#define PI 3.141592653589793
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
} // validated`,hw=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,dw=`vec3 transformedNormal = objectNormal;
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
#endif`,fw=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,pw=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,mw=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,gw=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,_w="gl_FragColor = linearToOutputTexel( gl_FragColor );",vw=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,xw=`#ifdef USE_ENVMAP
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
#endif`,yw=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,Sw=`#ifdef USE_ENVMAP
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
#endif`,Mw=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,ww=`#ifdef USE_ENVMAP
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
#endif`,Ew=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Tw=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,bw=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Aw=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Cw=`#ifdef USE_GRADIENTMAP
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
}`,Rw=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Pw=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Iw=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Lw=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,Nw=`#ifdef USE_ENVMAP
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
#endif`,Dw=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Uw=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Fw=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Ow=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Bw=`PhysicalMaterial material;
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
#endif`,kw=`uniform sampler2D dfgLUT;
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
}`,zw=`
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
#endif`,Vw=`#if defined( RE_IndirectDiffuse )
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
#endif`,Hw=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Gw=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,Ww=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Xw=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,qw=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Yw=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Zw=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,$w=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Jw=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,Kw=`#if defined( USE_POINTS_UV )
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
#endif`,jw=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Qw=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,eE=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,tE=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,nE=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,iE=`#ifdef USE_MORPHTARGETS
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
#endif`,rE=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,sE=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,oE=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,aE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,lE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,cE=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,uE=`#ifdef USE_NORMALMAP
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
#endif`,hE=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,dE=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,fE=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,pE=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,mE=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,gE=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,_E=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,vE=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,xE=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,yE=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,SE=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,ME=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,wE=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,EE=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,TE=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,bE=`float getShadowMask() {
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
}`,AE=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,CE=`#ifdef USE_SKINNING
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
#endif`,RE=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,PE=`#ifdef USE_SKINNING
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
#endif`,IE=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,LE=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,NE=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,DE=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,UE=`#ifdef USE_TRANSMISSION
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
#endif`,FE=`#ifdef USE_TRANSMISSION
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
#endif`,OE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,BE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,kE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,zE=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,VE=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,HE=`uniform sampler2D t2D;
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
}`,GE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,WE=`#ifdef ENVMAP_TYPE_CUBE
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
}`,XE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,qE=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,YE=`#include <common>
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
}`,ZE=`#if DEPTH_PACKING == 3200
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
}`,$E=`#define DISTANCE
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
}`,JE=`#define DISTANCE
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
}`,KE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,jE=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,QE=`uniform float scale;
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
}`,eT=`uniform vec3 diffuse;
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
}`,tT=`#include <common>
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
}`,nT=`uniform vec3 diffuse;
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
}`,iT=`#define LAMBERT
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
}`,rT=`#define LAMBERT
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
}`,sT=`#define MATCAP
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
}`,oT=`#define MATCAP
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
}`,aT=`#define NORMAL
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
}`,lT=`#define NORMAL
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
}`,cT=`#define PHONG
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
}`,uT=`#define PHONG
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
}`,hT=`#define STANDARD
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
}`,dT=`#define STANDARD
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
}`,fT=`#define TOON
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
}`,pT=`#define TOON
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
}`,mT=`uniform float size;
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
}`,gT=`uniform vec3 diffuse;
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
}`,_T=`#include <common>
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
}`,vT=`uniform vec3 color;
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
}`,xT=`uniform float rotation;
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
}`,yT=`uniform vec3 diffuse;
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
}`,We={alphahash_fragment:V1,alphahash_pars_fragment:H1,alphamap_fragment:G1,alphamap_pars_fragment:W1,alphatest_fragment:X1,alphatest_pars_fragment:q1,aomap_fragment:Y1,aomap_pars_fragment:Z1,batching_pars_vertex:$1,batching_vertex:J1,begin_vertex:K1,beginnormal_vertex:j1,bsdfs:Q1,iridescence_fragment:ew,bumpmap_pars_fragment:tw,clipping_planes_fragment:nw,clipping_planes_pars_fragment:iw,clipping_planes_pars_vertex:rw,clipping_planes_vertex:sw,color_fragment:ow,color_pars_fragment:aw,color_pars_vertex:lw,color_vertex:cw,common:uw,cube_uv_reflection_fragment:hw,defaultnormal_vertex:dw,displacementmap_pars_vertex:fw,displacementmap_vertex:pw,emissivemap_fragment:mw,emissivemap_pars_fragment:gw,colorspace_fragment:_w,colorspace_pars_fragment:vw,envmap_fragment:xw,envmap_common_pars_fragment:yw,envmap_pars_fragment:Sw,envmap_pars_vertex:Mw,envmap_physical_pars_fragment:Nw,envmap_vertex:ww,fog_vertex:Ew,fog_pars_vertex:Tw,fog_fragment:bw,fog_pars_fragment:Aw,gradientmap_pars_fragment:Cw,lightmap_pars_fragment:Rw,lights_lambert_fragment:Pw,lights_lambert_pars_fragment:Iw,lights_pars_begin:Lw,lights_toon_fragment:Dw,lights_toon_pars_fragment:Uw,lights_phong_fragment:Fw,lights_phong_pars_fragment:Ow,lights_physical_fragment:Bw,lights_physical_pars_fragment:kw,lights_fragment_begin:zw,lights_fragment_maps:Vw,lights_fragment_end:Hw,lightprobes_pars_fragment:Gw,logdepthbuf_fragment:Ww,logdepthbuf_pars_fragment:Xw,logdepthbuf_pars_vertex:qw,logdepthbuf_vertex:Yw,map_fragment:Zw,map_pars_fragment:$w,map_particle_fragment:Jw,map_particle_pars_fragment:Kw,metalnessmap_fragment:jw,metalnessmap_pars_fragment:Qw,morphinstance_vertex:eE,morphcolor_vertex:tE,morphnormal_vertex:nE,morphtarget_pars_vertex:iE,morphtarget_vertex:rE,normal_fragment_begin:sE,normal_fragment_maps:oE,normal_pars_fragment:aE,normal_pars_vertex:lE,normal_vertex:cE,normalmap_pars_fragment:uE,clearcoat_normal_fragment_begin:hE,clearcoat_normal_fragment_maps:dE,clearcoat_pars_fragment:fE,iridescence_pars_fragment:pE,opaque_fragment:mE,packing:gE,premultiplied_alpha_fragment:_E,project_vertex:vE,dithering_fragment:xE,dithering_pars_fragment:yE,roughnessmap_fragment:SE,roughnessmap_pars_fragment:ME,shadowmap_pars_fragment:wE,shadowmap_pars_vertex:EE,shadowmap_vertex:TE,shadowmask_pars_fragment:bE,skinbase_vertex:AE,skinning_pars_vertex:CE,skinning_vertex:RE,skinnormal_vertex:PE,specularmap_fragment:IE,specularmap_pars_fragment:LE,tonemapping_fragment:NE,tonemapping_pars_fragment:DE,transmission_fragment:UE,transmission_pars_fragment:FE,uv_pars_fragment:OE,uv_pars_vertex:BE,uv_vertex:kE,worldpos_vertex:zE,background_vert:VE,background_frag:HE,backgroundCube_vert:GE,backgroundCube_frag:WE,cube_vert:XE,cube_frag:qE,depth_vert:YE,depth_frag:ZE,distance_vert:$E,distance_frag:JE,equirect_vert:KE,equirect_frag:jE,linedashed_vert:QE,linedashed_frag:eT,meshbasic_vert:tT,meshbasic_frag:nT,meshlambert_vert:iT,meshlambert_frag:rT,meshmatcap_vert:sT,meshmatcap_frag:oT,meshnormal_vert:aT,meshnormal_frag:lT,meshphong_vert:cT,meshphong_frag:uT,meshphysical_vert:hT,meshphysical_frag:dT,meshtoon_vert:fT,meshtoon_frag:pT,points_vert:mT,points_frag:gT,shadow_vert:_T,shadow_frag:vT,sprite_vert:xT,sprite_frag:yT},pe={common:{diffuse:{value:new Ge(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Fe},alphaMap:{value:null},alphaMapTransform:{value:new Fe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Fe}},envmap:{envMap:{value:null},envMapRotation:{value:new Fe},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Fe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Fe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Fe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Fe},normalScale:{value:new Ke(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Fe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Fe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Fe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Fe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ge(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new O},probesMax:{value:new O},probesResolution:{value:new O}},points:{diffuse:{value:new Ge(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Fe},alphaTest:{value:0},uvTransform:{value:new Fe}},sprite:{diffuse:{value:new Ge(16777215)},opacity:{value:1},center:{value:new Ke(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Fe},alphaMap:{value:null},alphaMapTransform:{value:new Fe},alphaTest:{value:0}}},Ri={basic:{uniforms:un([pe.common,pe.specularmap,pe.envmap,pe.aomap,pe.lightmap,pe.fog]),vertexShader:We.meshbasic_vert,fragmentShader:We.meshbasic_frag},lambert:{uniforms:un([pe.common,pe.specularmap,pe.envmap,pe.aomap,pe.lightmap,pe.emissivemap,pe.bumpmap,pe.normalmap,pe.displacementmap,pe.fog,pe.lights,{emissive:{value:new Ge(0)},envMapIntensity:{value:1}}]),vertexShader:We.meshlambert_vert,fragmentShader:We.meshlambert_frag},phong:{uniforms:un([pe.common,pe.specularmap,pe.envmap,pe.aomap,pe.lightmap,pe.emissivemap,pe.bumpmap,pe.normalmap,pe.displacementmap,pe.fog,pe.lights,{emissive:{value:new Ge(0)},specular:{value:new Ge(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:We.meshphong_vert,fragmentShader:We.meshphong_frag},standard:{uniforms:un([pe.common,pe.envmap,pe.aomap,pe.lightmap,pe.emissivemap,pe.bumpmap,pe.normalmap,pe.displacementmap,pe.roughnessmap,pe.metalnessmap,pe.fog,pe.lights,{emissive:{value:new Ge(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:We.meshphysical_vert,fragmentShader:We.meshphysical_frag},toon:{uniforms:un([pe.common,pe.aomap,pe.lightmap,pe.emissivemap,pe.bumpmap,pe.normalmap,pe.displacementmap,pe.gradientmap,pe.fog,pe.lights,{emissive:{value:new Ge(0)}}]),vertexShader:We.meshtoon_vert,fragmentShader:We.meshtoon_frag},matcap:{uniforms:un([pe.common,pe.bumpmap,pe.normalmap,pe.displacementmap,pe.fog,{matcap:{value:null}}]),vertexShader:We.meshmatcap_vert,fragmentShader:We.meshmatcap_frag},points:{uniforms:un([pe.points,pe.fog]),vertexShader:We.points_vert,fragmentShader:We.points_frag},dashed:{uniforms:un([pe.common,pe.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:We.linedashed_vert,fragmentShader:We.linedashed_frag},depth:{uniforms:un([pe.common,pe.displacementmap]),vertexShader:We.depth_vert,fragmentShader:We.depth_frag},normal:{uniforms:un([pe.common,pe.bumpmap,pe.normalmap,pe.displacementmap,{opacity:{value:1}}]),vertexShader:We.meshnormal_vert,fragmentShader:We.meshnormal_frag},sprite:{uniforms:un([pe.sprite,pe.fog]),vertexShader:We.sprite_vert,fragmentShader:We.sprite_frag},background:{uniforms:{uvTransform:{value:new Fe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:We.background_vert,fragmentShader:We.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Fe}},vertexShader:We.backgroundCube_vert,fragmentShader:We.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:We.cube_vert,fragmentShader:We.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:We.equirect_vert,fragmentShader:We.equirect_frag},distance:{uniforms:un([pe.common,pe.displacementmap,{referencePosition:{value:new O},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:We.distance_vert,fragmentShader:We.distance_frag},shadow:{uniforms:un([pe.lights,pe.fog,{color:{value:new Ge(0)},opacity:{value:1}}]),vertexShader:We.shadow_vert,fragmentShader:We.shadow_frag}};Ri.physical={uniforms:un([Ri.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Fe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Fe},clearcoatNormalScale:{value:new Ke(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Fe},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Fe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Fe},sheen:{value:0},sheenColor:{value:new Ge(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Fe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Fe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Fe},transmissionSamplerSize:{value:new Ke},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Fe},attenuationDistance:{value:0},attenuationColor:{value:new Ge(0)},specularColor:{value:new Ge(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Fe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Fe},anisotropyVector:{value:new Ke},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Fe}}]),vertexShader:We.meshphysical_vert,fragmentShader:We.meshphysical_frag};var Rh={r:0,b:0,g:0},ST=new Tt,ey=new Fe;ey.set(-1,0,0,0,1,0,0,0,1);function MT(t,e,n,i,r,s){let o=new Ge(0),a=r===!0?0:1,l,c,d=null,f=0,h=null;function p(m){let v=m.isScene===!0?m.background:null;if(v&&v.isTexture){let M=m.backgroundBlurriness>0;v=e.get(v,M)}return v}function _(m){let v=!1,M=p(m);M===null?g(o,a):M&&M.isColor&&(g(M,1),v=!0);let A=t.xr.getEnvironmentBlendMode();A==="additive"?n.buffers.color.setClear(0,0,0,1,s):A==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,s),(t.autoClear||v)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),t.clear(t.autoClearColor,t.autoClearDepth,t.autoClearStencil))}function S(m,v){let M=p(v);M&&(M.isCubeTexture||M.mapping===Ya)?(c===void 0&&(c=new Ft(new mo(1,1,1),new Dn({name:"BackgroundCubeMaterial",uniforms:ds(Ri.backgroundCube.uniforms),vertexShader:Ri.backgroundCube.vertexShader,fragmentShader:Ri.backgroundCube.fragmentShader,side:Qt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(A,E,P){this.matrixWorld.copyPosition(P.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(c)),c.material.uniforms.envMap.value=M,c.material.uniforms.backgroundBlurriness.value=v.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(ST.makeRotationFromEuler(v.backgroundRotation)).transpose(),M.isCubeTexture&&M.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(ey),c.material.toneMapped=$e.getTransfer(M.colorSpace)!==rt,(d!==M||f!==M.version||h!==t.toneMapping)&&(c.material.needsUpdate=!0,d=M,f=M.version,h=t.toneMapping),c.layers.enableAll(),m.unshift(c,c.geometry,c.material,0,0,null)):M&&M.isTexture&&(l===void 0&&(l=new Ft(new ka(2,2),new Dn({name:"BackgroundMaterial",uniforms:ds(Ri.background.uniforms),vertexShader:Ri.background.vertexShader,fragmentShader:Ri.background.fragmentShader,side:$i,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=M,l.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,l.material.toneMapped=$e.getTransfer(M.colorSpace)!==rt,M.matrixAutoUpdate===!0&&M.updateMatrix(),l.material.uniforms.uvTransform.value.copy(M.matrix),(d!==M||f!==M.version||h!==t.toneMapping)&&(l.material.needsUpdate=!0,d=M,f=M.version,h=t.toneMapping),l.layers.enableAll(),m.unshift(l,l.geometry,l.material,0,0,null))}function g(m,v){m.getRGB(Rh,om(t)),n.buffers.color.setClear(Rh.r,Rh.g,Rh.b,v,s)}function u(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(m,v=1){o.set(m),a=v,g(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(m){a=m,g(o,a)},render:_,addToRenderList:S,dispose:u}}function wT(t,e){let n=t.getParameter(t.MAX_VERTEX_ATTRIBS),i={},r=h(null),s=r,o=!1;function a(b,I,W,H,D){let B=!1,k=f(b,H,W,I);s!==k&&(s=k,c(s.object)),B=p(b,H,W,D),B&&_(b,H,W,D),D!==null&&e.update(D,t.ELEMENT_ARRAY_BUFFER),(B||o)&&(o=!1,M(b,I,W,H),D!==null&&t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,e.get(D).buffer))}function l(){return t.createVertexArray()}function c(b){return t.bindVertexArray(b)}function d(b){return t.deleteVertexArray(b)}function f(b,I,W,H){let D=H.wireframe===!0,B=i[I.id];B===void 0&&(B={},i[I.id]=B);let k=b.isInstancedMesh===!0?b.id:0,te=B[k];te===void 0&&(te={},B[k]=te);let se=te[W.id];se===void 0&&(se={},te[W.id]=se);let ue=se[D];return ue===void 0&&(ue=h(l()),se[D]=ue),ue}function h(b){let I=[],W=[],H=[];for(let D=0;D<n;D++)I[D]=0,W[D]=0,H[D]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:I,enabledAttributes:W,attributeDivisors:H,object:b,attributes:{},index:null}}function p(b,I,W,H){let D=s.attributes,B=I.attributes,k=0,te=W.getAttributes();for(let se in te)if(te[se].location>=0){let ve=D[se],we=B[se];if(we===void 0&&(se==="instanceMatrix"&&b.instanceMatrix&&(we=b.instanceMatrix),se==="instanceColor"&&b.instanceColor&&(we=b.instanceColor)),ve===void 0||ve.attribute!==we||we&&ve.data!==we.data)return!0;k++}return s.attributesNum!==k||s.index!==H}function _(b,I,W,H){let D={},B=I.attributes,k=0,te=W.getAttributes();for(let se in te)if(te[se].location>=0){let ve=B[se];ve===void 0&&(se==="instanceMatrix"&&b.instanceMatrix&&(ve=b.instanceMatrix),se==="instanceColor"&&b.instanceColor&&(ve=b.instanceColor));let we={};we.attribute=ve,ve&&ve.data&&(we.data=ve.data),D[se]=we,k++}s.attributes=D,s.attributesNum=k,s.index=H}function S(){let b=s.newAttributes;for(let I=0,W=b.length;I<W;I++)b[I]=0}function g(b){u(b,0)}function u(b,I){let W=s.newAttributes,H=s.enabledAttributes,D=s.attributeDivisors;W[b]=1,H[b]===0&&(t.enableVertexAttribArray(b),H[b]=1),D[b]!==I&&(t.vertexAttribDivisor(b,I),D[b]=I)}function m(){let b=s.newAttributes,I=s.enabledAttributes;for(let W=0,H=I.length;W<H;W++)I[W]!==b[W]&&(t.disableVertexAttribArray(W),I[W]=0)}function v(b,I,W,H,D,B,k){k===!0?t.vertexAttribIPointer(b,I,W,D,B):t.vertexAttribPointer(b,I,W,H,D,B)}function M(b,I,W,H){S();let D=H.attributes,B=W.getAttributes(),k=I.defaultAttributeValues;for(let te in B){let se=B[te];if(se.location>=0){let ue=D[te];if(ue===void 0&&(te==="instanceMatrix"&&b.instanceMatrix&&(ue=b.instanceMatrix),te==="instanceColor"&&b.instanceColor&&(ue=b.instanceColor)),ue!==void 0){let ve=ue.normalized,we=ue.itemSize,ze=e.get(ue);if(ze===void 0)continue;let je=ze.buffer,De=ze.type,ee=ze.bytesPerElement,G=De===t.INT||De===t.UNSIGNED_INT||ue.gpuType===Wu;if(ue.isInterleavedBufferAttribute){let Z=ue.data,me=Z.stride,be=ue.offset;if(Z.isInstancedInterleavedBuffer){for(let Ae=0;Ae<se.locationSize;Ae++)u(se.location+Ae,Z.meshPerAttribute);b.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=Z.meshPerAttribute*Z.count)}else for(let Ae=0;Ae<se.locationSize;Ae++)g(se.location+Ae);t.bindBuffer(t.ARRAY_BUFFER,je);for(let Ae=0;Ae<se.locationSize;Ae++)v(se.location+Ae,we/se.locationSize,De,ve,me*ee,(be+we/se.locationSize*Ae)*ee,G)}else{if(ue.isInstancedBufferAttribute){for(let Z=0;Z<se.locationSize;Z++)u(se.location+Z,ue.meshPerAttribute);b.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=ue.meshPerAttribute*ue.count)}else for(let Z=0;Z<se.locationSize;Z++)g(se.location+Z);t.bindBuffer(t.ARRAY_BUFFER,je);for(let Z=0;Z<se.locationSize;Z++)v(se.location+Z,we/se.locationSize,De,ve,we*ee,we/se.locationSize*Z*ee,G)}}else if(k!==void 0){let ve=k[te];if(ve!==void 0)switch(ve.length){case 2:t.vertexAttrib2fv(se.location,ve);break;case 3:t.vertexAttrib3fv(se.location,ve);break;case 4:t.vertexAttrib4fv(se.location,ve);break;default:t.vertexAttrib1fv(se.location,ve)}}}}m()}function A(){R();for(let b in i){let I=i[b];for(let W in I){let H=I[W];for(let D in H){let B=H[D];for(let k in B)d(B[k].object),delete B[k];delete H[D]}}delete i[b]}}function E(b){if(i[b.id]===void 0)return;let I=i[b.id];for(let W in I){let H=I[W];for(let D in H){let B=H[D];for(let k in B)d(B[k].object),delete B[k];delete H[D]}}delete i[b.id]}function P(b){for(let I in i){let W=i[I];for(let H in W){let D=W[H];if(D[b.id]===void 0)continue;let B=D[b.id];for(let k in B)d(B[k].object),delete B[k];delete D[b.id]}}}function x(b){for(let I in i){let W=i[I],H=b.isInstancedMesh===!0?b.id:0,D=W[H];if(D!==void 0){for(let B in D){let k=D[B];for(let te in k)d(k[te].object),delete k[te];delete D[B]}delete W[H],Object.keys(W).length===0&&delete i[I]}}}function R(){C(),o=!0,s!==r&&(s=r,c(s.object))}function C(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:R,resetDefaultState:C,dispose:A,releaseStatesOfGeometry:E,releaseStatesOfObject:x,releaseStatesOfProgram:P,initAttributes:S,enableAttribute:g,disableUnusedAttributes:m}}function ET(t,e,n){let i;function r(l){i=l}function s(l,c){t.drawArrays(i,l,c),n.update(c,i,1)}function o(l,c,d){d!==0&&(t.drawArraysInstanced(i,l,c,d),n.update(c,i,d))}function a(l,c,d){if(d===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,c,0,d);let h=0;for(let p=0;p<d;p++)h+=c[p];n.update(h,i,1)}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a}function TT(t,e,n,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let P=e.get("EXT_texture_filter_anisotropic");r=t.getParameter(P.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(P){return!(P!==qn&&i.convert(P)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(P){let x=P===Ai&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(P!==Mn&&i.convert(P)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE)&&P!==li&&!x)}function l(P){if(P==="highp"){if(t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.HIGH_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.HIGH_FLOAT).precision>0)return"highp";P="mediump"}return P==="mediump"&&t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.MEDIUM_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",d=l(c);d!==c&&(Ie("WebGLRenderer:",c,"not supported, using",d,"instead."),c=d);let f=n.logarithmicDepthBuffer===!0,h=n.reversedDepthBuffer===!0&&e.has("EXT_clip_control");n.reversedDepthBuffer===!0&&h===!1&&Ie("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let p=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),_=t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),S=t.getParameter(t.MAX_TEXTURE_SIZE),g=t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),u=t.getParameter(t.MAX_VERTEX_ATTRIBS),m=t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),v=t.getParameter(t.MAX_VARYING_VECTORS),M=t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),A=t.getParameter(t.MAX_SAMPLES),E=t.getParameter(t.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:f,reversedDepthBuffer:h,maxTextures:p,maxVertexTextures:_,maxTextureSize:S,maxCubemapSize:g,maxAttributes:u,maxVertexUniforms:m,maxVaryings:v,maxFragmentUniforms:M,maxSamples:A,samples:E}}function bT(t){let e=this,n=null,i=0,r=!1,s=!1,o=new vi,a=new Fe,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(f,h){let p=f.length!==0||h||i!==0||r;return r=h,i=f.length,p},this.beginShadows=function(){s=!0,d(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(f,h){n=d(f,h,0)},this.setState=function(f,h,p){let _=f.clippingPlanes,S=f.clipIntersection,g=f.clipShadows,u=t.get(f);if(!r||_===null||_.length===0||s&&!g)s?d(null):c();else{let m=s?0:i,v=m*4,M=u.clippingState||null;l.value=M,M=d(_,h,v,p);for(let A=0;A!==v;++A)M[A]=n[A];u.clippingState=M,this.numIntersection=S?this.numPlanes:0,this.numPlanes+=m}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function d(f,h,p,_){let S=f!==null?f.length:0,g=null;if(S!==0){if(g=l.value,_!==!0||g===null){let u=p+S*4,m=h.matrixWorldInverse;a.getNormalMatrix(m),(g===null||g.length<u)&&(g=new Float32Array(u));for(let v=0,M=p;v!==S;++v,M+=4)o.copy(f[v]).applyMatrix4(m,a),o.normal.toArray(g,M),g[M+3]=o.constant}l.value=g,l.needsUpdate=!0}return e.numPlanes=S,e.numIntersection=0,g}}var kr=4,Ix=[.125,.215,.35,.446,.526,.582],fs=20,AT=256,nl=new Dr,Lx=new Ge,mm=null,gm=0,_m=0,vm=!1,CT=new O,Ih=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,n=0,i=.1,r=100,s={}){let{size:o=256,position:a=CT}=s;mm=this._renderer.getRenderTarget(),gm=this._renderer.getActiveCubeFace(),_m=this._renderer.getActiveMipmapLevel(),vm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,n=null){return this._fromTexture(e,n)}fromCubemap(e,n=null){return this._fromTexture(e,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Ux(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Dx(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(mm,gm,_m),this._renderer.xr.enabled=vm,e.scissorTest=!1,Eo(e,0,0,e.width,e.height)}_fromTexture(e,n){e.mapping===Ur||e.mapping===hs?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),mm=this._renderer.getRenderTarget(),gm=this._renderer.getActiveCubeFace(),_m=this._renderer.getActiveMipmapLevel(),vm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:Kt,minFilter:Kt,generateMipmaps:!1,type:Ai,format:qn,colorSpace:Aa,depthBuffer:!1},r=Nx(e,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Nx(e,n,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=RT(s)),this._blurMaterial=IT(s,e,n),this._ggxMaterial=PT(s,e,n)}return r}_compileMaterial(e){let n=new Ft(new qt,e);this._renderer.compile(n,nl)}_sceneToCubeUV(e,n,i,r,s){let l=new cn(90,1,n,i),c=[1,-1,1,1,1,1],d=[1,1,1,-1,-1,-1],f=this._renderer,h=f.autoClear,p=f.toneMapping;f.getClearColor(Lx),f.toneMapping=oi,f.autoClear=!1,f.state.buffers.depth.getReversed()&&(f.setRenderTarget(r),f.clearDepth(),f.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Ft(new mo,new Ti({name:"PMREM.Background",side:Qt,depthWrite:!1,depthTest:!1})));let S=this._backgroundBox,g=S.material,u=!1,m=e.background;m?m.isColor&&(g.color.copy(m),e.background=null,u=!0):(g.color.copy(Lx),u=!0);for(let v=0;v<6;v++){let M=v%3;M===0?(l.up.set(0,c[v],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+d[v],s.y,s.z)):M===1?(l.up.set(0,0,c[v]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+d[v],s.z)):(l.up.set(0,c[v],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+d[v]));let A=this._cubeSize;Eo(r,M*A,v>2?A:0,A,A),f.setRenderTarget(r),u&&f.render(S,l),f.render(e,l)}f.toneMapping=p,f.autoClear=h,e.background=m}_textureToCubeUV(e,n){let i=this._renderer,r=e.mapping===Ur||e.mapping===hs;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=Ux()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Dx());let s=r?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=s;let a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;Eo(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(o,nl)}_applyPMREM(e){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);n.autoClear=i}_applyGGXFilter(e,n,i){let r=this._renderer,s=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[i];a.material=o;let l=o.uniforms,c=i/(this._lodMeshes.length-1),d=n/(this._lodMeshes.length-1),f=Math.sqrt(c*c-d*d),h=0+c*1.25,p=f*h,{_lodMax:_}=this,S=this._sizeLods[i],g=3*S*(i>_-kr?i-_+kr:0),u=4*(this._cubeSize-S);l.envMap.value=e.texture,l.roughness.value=p,l.mipInt.value=_-n,Eo(s,g,u,3*S,2*S),r.setRenderTarget(s),r.render(a,nl),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=_-i,Eo(e,g,u,3*S,2*S),r.setRenderTarget(e),r.render(a,nl)}_blur(e,n,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,n,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,n,i,r,s,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&Ne("blur direction must be either latitudinal or longitudinal!");let d=3,f=this._lodMeshes[r];f.material=c;let h=c.uniforms,p=this._sizeLods[i]-1,_=isFinite(s)?Math.PI/(2*p):2*Math.PI/(2*fs-1),S=s/_,g=isFinite(s)?1+Math.floor(d*S):fs;g>fs&&Ie(`sigmaRadians, ${s}, is too large and will clip, as it requested ${g} samples when the maximum is set to ${fs}`);let u=[],m=0;for(let P=0;P<fs;++P){let x=P/S,R=Math.exp(-x*x/2);u.push(R),P===0?m+=R:P<g&&(m+=2*R)}for(let P=0;P<u.length;P++)u[P]=u[P]/m;h.envMap.value=e.texture,h.samples.value=g,h.weights.value=u,h.latitudinal.value=o==="latitudinal",a&&(h.poleAxis.value=a);let{_lodMax:v}=this;h.dTheta.value=_,h.mipInt.value=v-i;let M=this._sizeLods[r],A=3*M*(r>v-kr?r-v+kr:0),E=4*(this._cubeSize-M);Eo(n,A,E,3*M,2*M),l.setRenderTarget(n),l.render(f,nl)}};function RT(t){let e=[],n=[],i=[],r=t,s=t-kr+1+Ix.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);e.push(a);let l=1/a;o>t-kr?l=Ix[o-t+kr-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),d=-c,f=1+c,h=[d,d,f,d,f,f,d,d,f,f,d,f],p=6,_=6,S=3,g=2,u=1,m=new Float32Array(S*_*p),v=new Float32Array(g*_*p),M=new Float32Array(u*_*p);for(let E=0;E<p;E++){let P=E%3*2/3-1,x=E>2?0:-1,R=[P,x,0,P+2/3,x,0,P+2/3,x+1,0,P,x,0,P+2/3,x+1,0,P,x+1,0];m.set(R,S*_*E),v.set(h,g*_*E);let C=[E,E,E,E,E,E];M.set(C,u*_*E)}let A=new qt;A.setAttribute("position",new Ln(m,S)),A.setAttribute("uv",new Ln(v,g)),A.setAttribute("faceIndex",new Ln(M,u)),i.push(new Ft(A,null)),r>kr&&r--}return{lodMeshes:i,sizeLods:e,sigmas:n}}function Nx(t,e,n){let i=new Nn(t,e,n);return i.texture.mapping=Ya,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function Eo(t,e,n,i,r){t.viewport.set(e,n,i,r),t.scissor.set(e,n,i,r)}function PT(t,e,n){return new Dn({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:AT,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Nh(),fragmentShader:`

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
		`,blending:bi,depthTest:!1,depthWrite:!1})}function IT(t,e,n){let i=new Float32Array(fs),r=new O(0,1,0);return new Dn({name:"SphericalGaussianBlur",defines:{n:fs,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:Nh(),fragmentShader:`

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
		`,blending:bi,depthTest:!1,depthWrite:!1})}function Dx(){return new Dn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Nh(),fragmentShader:`

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
		`,blending:bi,depthTest:!1,depthWrite:!1})}function Ux(){return new Dn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Nh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:bi,depthTest:!1,depthWrite:!1})}function Nh(){return`

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
	`}var Lh=class extends Nn{constructor(e=1,n={}){super(e,e,n),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new Fa(r),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new mo(5,5,5),s=new Dn({name:"CubemapFromEquirect",uniforms:ds(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:Qt,blending:bi});s.uniforms.tEquirect.value=n;let o=new Ft(r,s),a=n.minFilter;return n.minFilter===Fr&&(n.minFilter=Kt),new Bu(1,10,this).update(e,o),n.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,n=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(n,i,r);e.setRenderTarget(s)}};function LT(t){let e=new WeakMap,n=new WeakMap,i=null;function r(h,p=!1){return h==null?null:p?o(h):s(h)}function s(h){if(h&&h.isTexture){let p=h.mapping;if(p===Vu||p===Hu)if(e.has(h)){let _=e.get(h).texture;return a(_,h.mapping)}else{let _=h.image;if(_&&_.height>0){let S=new Lh(_.height);return S.fromEquirectangularTexture(t,h),e.set(h,S),h.addEventListener("dispose",c),a(S.texture,h.mapping)}else return null}}return h}function o(h){if(h&&h.isTexture){let p=h.mapping,_=p===Vu||p===Hu,S=p===Ur||p===hs;if(_||S){let g=n.get(h),u=g!==void 0?g.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==u)return i===null&&(i=new Ih(t)),g=_?i.fromEquirectangular(h,g):i.fromCubemap(h,g),g.texture.pmremVersion=h.pmremVersion,n.set(h,g),g.texture;if(g!==void 0)return g.texture;{let m=h.image;return _&&m&&m.height>0||S&&m&&l(m)?(i===null&&(i=new Ih(t)),g=_?i.fromEquirectangular(h):i.fromCubemap(h),g.texture.pmremVersion=h.pmremVersion,n.set(h,g),h.addEventListener("dispose",d),g.texture):null}}}return h}function a(h,p){return p===Vu?h.mapping=Ur:p===Hu&&(h.mapping=hs),h}function l(h){let p=0,_=6;for(let S=0;S<_;S++)h[S]!==void 0&&p++;return p===_}function c(h){let p=h.target;p.removeEventListener("dispose",c);let _=e.get(p);_!==void 0&&(e.delete(p),_.dispose())}function d(h){let p=h.target;p.removeEventListener("dispose",d);let _=n.get(p);_!==void 0&&(n.delete(p),_.dispose())}function f(){e=new WeakMap,n=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:f}}function NT(t){let e={};function n(i){if(e[i]!==void 0)return e[i];let r=t.getExtension(i);return e[i]=r,r}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let r=n(i);return r===null&&mu("WebGLRenderer: "+i+" extension not supported."),r}}}function DT(t,e,n,i){let r={},s=new WeakMap;function o(f){let h=f.target;h.index!==null&&e.remove(h.index);for(let _ in h.attributes)e.remove(h.attributes[_]);h.removeEventListener("dispose",o),delete r[h.id];let p=s.get(h);p&&(e.remove(p),s.delete(h)),i.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,n.memory.geometries--}function a(f,h){return r[h.id]===!0||(h.addEventListener("dispose",o),r[h.id]=!0,n.memory.geometries++),h}function l(f){let h=f.attributes;for(let p in h)e.update(h[p],t.ARRAY_BUFFER)}function c(f){let h=[],p=f.index,_=f.attributes.position,S=0;if(_===void 0)return;if(p!==null){let m=p.array;S=p.version;for(let v=0,M=m.length;v<M;v+=3){let A=m[v+0],E=m[v+1],P=m[v+2];h.push(A,E,E,P,P,A)}}else{let m=_.array;S=_.version;for(let v=0,M=m.length/3-1;v<M;v+=3){let A=v+0,E=v+1,P=v+2;h.push(A,E,E,P,P,A)}}let g=new(_.count>=65535?Na:La)(h,1);g.version=S;let u=s.get(f);u&&e.remove(u),s.set(f,g)}function d(f){let h=s.get(f);if(h){let p=f.index;p!==null&&h.version<p.version&&c(f)}else c(f);return s.get(f)}return{get:a,update:l,getWireframeAttribute:d}}function UT(t,e,n){let i;function r(f){i=f}let s,o;function a(f){s=f.type,o=f.bytesPerElement}function l(f,h){t.drawElements(i,h,s,f*o),n.update(h,i,1)}function c(f,h,p){p!==0&&(t.drawElementsInstanced(i,h,s,f*o,p),n.update(h,i,p))}function d(f,h,p){if(p===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,h,0,s,f,0,p);let S=0;for(let g=0;g<p;g++)S+=h[g];n.update(S,i,1)}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=d}function FT(t){let e={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(n.calls++,o){case t.TRIANGLES:n.triangles+=a*(s/3);break;case t.LINES:n.lines+=a*(s/2);break;case t.LINE_STRIP:n.lines+=a*(s-1);break;case t.LINE_LOOP:n.lines+=a*s;break;case t.POINTS:n.points+=a*s;break;default:Ne("WebGLInfo: Unknown draw mode:",o);break}}function r(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:e,render:n,programs:null,autoReset:!0,reset:r,update:i}}function OT(t,e,n){let i=new WeakMap,r=new bt;function s(o,a,l){let c=o.morphTargetInfluences,d=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,f=d!==void 0?d.length:0,h=i.get(a);if(h===void 0||h.count!==f){let R=function(){P.dispose(),i.delete(a),a.removeEventListener("dispose",R)};h!==void 0&&h.texture.dispose();let p=a.morphAttributes.position!==void 0,_=a.morphAttributes.normal!==void 0,S=a.morphAttributes.color!==void 0,g=a.morphAttributes.position||[],u=a.morphAttributes.normal||[],m=a.morphAttributes.color||[],v=0;p===!0&&(v=1),_===!0&&(v=2),S===!0&&(v=3);let M=a.attributes.position.count*v,A=1;M>e.maxTextureSize&&(A=Math.ceil(M/e.maxTextureSize),M=e.maxTextureSize);let E=new Float32Array(M*A*4*f),P=new Pa(E,M,A,f);P.type=li,P.needsUpdate=!0;let x=v*4;for(let C=0;C<f;C++){let b=g[C],I=u[C],W=m[C],H=M*A*4*C;for(let D=0;D<b.count;D++){let B=D*x;p===!0&&(r.fromBufferAttribute(b,D),E[H+B+0]=r.x,E[H+B+1]=r.y,E[H+B+2]=r.z,E[H+B+3]=0),_===!0&&(r.fromBufferAttribute(I,D),E[H+B+4]=r.x,E[H+B+5]=r.y,E[H+B+6]=r.z,E[H+B+7]=0),S===!0&&(r.fromBufferAttribute(W,D),E[H+B+8]=r.x,E[H+B+9]=r.y,E[H+B+10]=r.z,E[H+B+11]=W.itemSize===4?r.w:1)}}h={count:f,texture:P,size:new Ke(M,A)},i.set(a,h),a.addEventListener("dispose",R)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(t,"morphTexture",o.morphTexture,n);else{let p=0;for(let S=0;S<c.length;S++)p+=c[S];let _=a.morphTargetsRelative?1:1-p;l.getUniforms().setValue(t,"morphTargetBaseInfluence",_),l.getUniforms().setValue(t,"morphTargetInfluences",c)}l.getUniforms().setValue(t,"morphTargetsTexture",h.texture,n),l.getUniforms().setValue(t,"morphTargetsTextureSize",h.size)}return{update:s}}function BT(t,e,n,i,r){let s=new WeakMap;function o(c){let d=r.render.frame,f=c.geometry,h=e.get(c,f);if(s.get(h)!==d&&(e.update(h),s.set(h,d)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==d&&(n.update(c.instanceMatrix,t.ARRAY_BUFFER),c.instanceColor!==null&&n.update(c.instanceColor,t.ARRAY_BUFFER),s.set(c,d))),c.isSkinnedMesh){let p=c.skeleton;s.get(p)!==d&&(p.update(),s.set(p,d))}return h}function a(){s=new WeakMap}function l(c){let d=c.target;d.removeEventListener("dispose",l),i.releaseStatesOfObject(d),n.remove(d.instanceMatrix),d.instanceColor!==null&&n.remove(d.instanceColor)}return{update:o,dispose:a}}var kT={[Hp]:"LINEAR_TONE_MAPPING",[Gp]:"REINHARD_TONE_MAPPING",[Wp]:"CINEON_TONE_MAPPING",[Xp]:"ACES_FILMIC_TONE_MAPPING",[Yp]:"AGX_TONE_MAPPING",[Zp]:"NEUTRAL_TONE_MAPPING",[qp]:"CUSTOM_TONE_MAPPING"};function zT(t,e,n,i,r){let s=new Nn(e,n,{type:t,depthBuffer:i,stencilBuffer:r,depthTexture:i?new Ki(e,n):void 0}),o=new Nn(e,n,{type:Ai,depthBuffer:!1,stencilBuffer:!1}),a=new qt;a.setAttribute("position",new st([-1,3,0,-1,-1,0,3,-1,0],3)),a.setAttribute("uv",new st([0,2,0,0,2,0],2));let l=new Tu({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),c=new Ft(a,l),d=new Dr(-1,1,1,-1,0,1),f=null,h=null,p=!1,_,S=null,g=[],u=!1;this.setSize=function(m,v){s.setSize(m,v),o.setSize(m,v);for(let M=0;M<g.length;M++){let A=g[M];A.setSize&&A.setSize(m,v)}},this.setEffects=function(m){g=m,u=g.length>0&&g[0].isRenderPass===!0;let v=s.width,M=s.height;for(let A=0;A<g.length;A++){let E=g[A];E.setSize&&E.setSize(v,M)}},this.begin=function(m,v){if(p||m.toneMapping===oi&&g.length===0)return!1;if(S=v,v!==null){let M=v.width,A=v.height;(s.width!==M||s.height!==A)&&this.setSize(M,A)}return u===!1&&m.setRenderTarget(s),_=m.toneMapping,m.toneMapping=oi,!0},this.hasRenderPass=function(){return u},this.end=function(m,v){m.toneMapping=_,p=!0;let M=s,A=o;for(let E=0;E<g.length;E++){let P=g[E];if(P.enabled!==!1&&(P.render(m,A,M,v),P.needsSwap!==!1)){let x=M;M=A,A=x}}if(f!==m.outputColorSpace||h!==m.toneMapping){f=m.outputColorSpace,h=m.toneMapping,l.defines={},$e.getTransfer(f)===rt&&(l.defines.SRGB_TRANSFER="");let E=kT[h];E&&(l.defines[E]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=M.texture,m.setRenderTarget(S),m.render(c,d),S=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){s.depthTexture&&s.depthTexture.dispose(),s.dispose(),o.dispose(),a.dispose(),l.dispose()}}var ty=new Sn,Sm=new Ki(1,1),ny=new Pa,iy=new vu,ry=new Fa,Fx=[],Ox=[],Bx=new Float32Array(16),kx=new Float32Array(9),zx=new Float32Array(4);function bo(t,e,n){let i=t[0];if(i<=0||i>0)return t;let r=e*n,s=Fx[r];if(s===void 0&&(s=new Float32Array(r),Fx[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=n,t[o].toArray(s,a)}return s}function zt(t,e){if(t.length!==e.length)return!1;for(let n=0,i=t.length;n<i;n++)if(t[n]!==e[n])return!1;return!0}function Vt(t,e){for(let n=0,i=e.length;n<i;n++)t[n]=e[n]}function Dh(t,e){let n=Ox[e];n===void 0&&(n=new Int32Array(e),Ox[e]=n);for(let i=0;i!==e;++i)n[i]=t.allocateTextureUnit();return n}function VT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1f(this.addr,e),n[0]=e)}function HT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2f(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(zt(n,e))return;t.uniform2fv(this.addr,e),Vt(n,e)}}function GT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3f(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else if(e.r!==void 0)(n[0]!==e.r||n[1]!==e.g||n[2]!==e.b)&&(t.uniform3f(this.addr,e.r,e.g,e.b),n[0]=e.r,n[1]=e.g,n[2]=e.b);else{if(zt(n,e))return;t.uniform3fv(this.addr,e),Vt(n,e)}}function WT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4f(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(zt(n,e))return;t.uniform4fv(this.addr,e),Vt(n,e)}}function XT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(zt(n,e))return;t.uniformMatrix2fv(this.addr,!1,e),Vt(n,e)}else{if(zt(n,i))return;zx.set(i),t.uniformMatrix2fv(this.addr,!1,zx),Vt(n,i)}}function qT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(zt(n,e))return;t.uniformMatrix3fv(this.addr,!1,e),Vt(n,e)}else{if(zt(n,i))return;kx.set(i),t.uniformMatrix3fv(this.addr,!1,kx),Vt(n,i)}}function YT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(zt(n,e))return;t.uniformMatrix4fv(this.addr,!1,e),Vt(n,e)}else{if(zt(n,i))return;Bx.set(i),t.uniformMatrix4fv(this.addr,!1,Bx),Vt(n,i)}}function ZT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1i(this.addr,e),n[0]=e)}function $T(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2i(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(zt(n,e))return;t.uniform2iv(this.addr,e),Vt(n,e)}}function JT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3i(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(zt(n,e))return;t.uniform3iv(this.addr,e),Vt(n,e)}}function KT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4i(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(zt(n,e))return;t.uniform4iv(this.addr,e),Vt(n,e)}}function jT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1ui(this.addr,e),n[0]=e)}function QT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2ui(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(zt(n,e))return;t.uniform2uiv(this.addr,e),Vt(n,e)}}function eb(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3ui(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(zt(n,e))return;t.uniform3uiv(this.addr,e),Vt(n,e)}}function tb(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4ui(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(zt(n,e))return;t.uniform4uiv(this.addr,e),Vt(n,e)}}function nb(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r);let s;this.type===t.SAMPLER_2D_SHADOW?(Sm.compareFunction=n.isReversedDepthBuffer()?Ah:bh,s=Sm):s=ty,n.setTexture2D(e||s,r)}function ib(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture3D(e||iy,r)}function rb(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTextureCube(e||ry,r)}function sb(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture2DArray(e||ny,r)}function ob(t){switch(t){case 5126:return VT;case 35664:return HT;case 35665:return GT;case 35666:return WT;case 35674:return XT;case 35675:return qT;case 35676:return YT;case 5124:case 35670:return ZT;case 35667:case 35671:return $T;case 35668:case 35672:return JT;case 35669:case 35673:return KT;case 5125:return jT;case 36294:return QT;case 36295:return eb;case 36296:return tb;case 35678:case 36198:case 36298:case 36306:case 35682:return nb;case 35679:case 36299:case 36307:return ib;case 35680:case 36300:case 36308:case 36293:return rb;case 36289:case 36303:case 36311:case 36292:return sb}}function ab(t,e){t.uniform1fv(this.addr,e)}function lb(t,e){let n=bo(e,this.size,2);t.uniform2fv(this.addr,n)}function cb(t,e){let n=bo(e,this.size,3);t.uniform3fv(this.addr,n)}function ub(t,e){let n=bo(e,this.size,4);t.uniform4fv(this.addr,n)}function hb(t,e){let n=bo(e,this.size,4);t.uniformMatrix2fv(this.addr,!1,n)}function db(t,e){let n=bo(e,this.size,9);t.uniformMatrix3fv(this.addr,!1,n)}function fb(t,e){let n=bo(e,this.size,16);t.uniformMatrix4fv(this.addr,!1,n)}function pb(t,e){t.uniform1iv(this.addr,e)}function mb(t,e){t.uniform2iv(this.addr,e)}function gb(t,e){t.uniform3iv(this.addr,e)}function _b(t,e){t.uniform4iv(this.addr,e)}function vb(t,e){t.uniform1uiv(this.addr,e)}function xb(t,e){t.uniform2uiv(this.addr,e)}function yb(t,e){t.uniform3uiv(this.addr,e)}function Sb(t,e){t.uniform4uiv(this.addr,e)}function Mb(t,e,n){let i=this.cache,r=e.length,s=Dh(n,r);zt(i,s)||(t.uniform1iv(this.addr,s),Vt(i,s));let o;this.type===t.SAMPLER_2D_SHADOW?o=Sm:o=ty;for(let a=0;a!==r;++a)n.setTexture2D(e[a]||o,s[a])}function wb(t,e,n){let i=this.cache,r=e.length,s=Dh(n,r);zt(i,s)||(t.uniform1iv(this.addr,s),Vt(i,s));for(let o=0;o!==r;++o)n.setTexture3D(e[o]||iy,s[o])}function Eb(t,e,n){let i=this.cache,r=e.length,s=Dh(n,r);zt(i,s)||(t.uniform1iv(this.addr,s),Vt(i,s));for(let o=0;o!==r;++o)n.setTextureCube(e[o]||ry,s[o])}function Tb(t,e,n){let i=this.cache,r=e.length,s=Dh(n,r);zt(i,s)||(t.uniform1iv(this.addr,s),Vt(i,s));for(let o=0;o!==r;++o)n.setTexture2DArray(e[o]||ny,s[o])}function bb(t){switch(t){case 5126:return ab;case 35664:return lb;case 35665:return cb;case 35666:return ub;case 35674:return hb;case 35675:return db;case 35676:return fb;case 5124:case 35670:return pb;case 35667:case 35671:return mb;case 35668:case 35672:return gb;case 35669:case 35673:return _b;case 5125:return vb;case 36294:return xb;case 36295:return yb;case 36296:return Sb;case 35678:case 36198:case 36298:case 36306:case 35682:return Mb;case 35679:case 36299:case 36307:return wb;case 35680:case 36300:case 36308:case 36293:return Eb;case 36289:case 36303:case 36311:case 36292:return Tb}}var Mm=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.setValue=ob(n.type)}},wm=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=bb(n.type)}},Em=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,n,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,n[a.id],i)}}},xm=/(\w+)(\])?(\[|\.)?/g;function Vx(t,e){t.seq.push(e),t.map[e.id]=e}function Ab(t,e,n){let i=t.name,r=i.length;for(xm.lastIndex=0;;){let s=xm.exec(i),o=xm.lastIndex,a=s[1],l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){Vx(n,c===void 0?new Mm(a,t,e):new wm(a,t,e));break}else{let f=n.map[a];f===void 0&&(f=new Em(a),Vx(n,f)),n=f}}}var To=class{constructor(e,n){this.seq=[],this.map={};let i=e.getProgramParameter(n,e.ACTIVE_UNIFORMS);for(let o=0;o<i;++o){let a=e.getActiveUniform(n,o),l=e.getUniformLocation(n,a.name);Ab(a,l,this)}let r=[],s=[];for(let o of this.seq)o.type===e.SAMPLER_2D_SHADOW||o.type===e.SAMPLER_CUBE_SHADOW||o.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(o):s.push(o);r.length>0&&(this.seq=r.concat(s))}setValue(e,n,i,r){let s=this.map[n];s!==void 0&&s.setValue(e,i,r)}setOptional(e,n,i){let r=n[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,n,i,r){for(let s=0,o=n.length;s!==o;++s){let a=n[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,n){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in n&&i.push(o)}return i}};function Hx(t,e,n){let i=t.createShader(e);return t.shaderSource(i,n),t.compileShader(i),i}var Cb=37297,Rb=0;function Pb(t,e){let n=t.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,n.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${n[o]}`)}return i.join(`
`)}var Gx=new Fe;function Ib(t){$e._getMatrix(Gx,$e.workingColorSpace,t);let e=`mat3( ${Gx.elements.map(n=>n.toFixed(4))} )`;switch($e.getTransfer(t)){case Ca:return[e,"LinearTransferOETF"];case rt:return[e,"sRGBTransferOETF"];default:return Ie("WebGLProgram: Unsupported color space: ",t),[e,"LinearTransferOETF"]}}function Wx(t,e,n){let i=t.getShaderParameter(e,t.COMPILE_STATUS),s=(t.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return n.toUpperCase()+`

`+s+`

`+Pb(t.getShaderSource(e),a)}else return s}function Lb(t,e){let n=Ib(e);return[`vec4 ${t}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}var Nb={[Hp]:"Linear",[Gp]:"Reinhard",[Wp]:"Cineon",[Xp]:"ACESFilmic",[Yp]:"AgX",[Zp]:"Neutral",[qp]:"Custom"};function Db(t,e){let n=Nb[e];return n===void 0?(Ie("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+t+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+t+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var Ph=new O;function Ub(){$e.getLuminanceCoefficients(Ph);let t=Ph.x.toFixed(4),e=Ph.y.toFixed(4),n=Ph.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${t}, ${e}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Fb(t){return[t.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",t.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(rl).join(`
`)}function Ob(t){let e=[];for(let n in t){let i=t[n];i!==!1&&e.push("#define "+n+" "+i)}return e.join(`
`)}function Bb(t,e){let n={},i=t.getProgramParameter(e,t.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=t.getActiveAttrib(e,r),o=s.name,a=1;s.type===t.FLOAT_MAT2&&(a=2),s.type===t.FLOAT_MAT3&&(a=3),s.type===t.FLOAT_MAT4&&(a=4),n[o]={type:s.type,location:t.getAttribLocation(e,o),locationSize:a}}return n}function rl(t){return t!==""}function Xx(t,e){let n=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return t.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function qx(t,e){return t.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var kb=/^[ \t]*#include +<([\w\d./]+)>/gm;function Tm(t){return t.replace(kb,Vb)}var zb=new Map;function Vb(t,e){let n=We[e];if(n===void 0){let i=zb.get(e);if(i!==void 0)n=We[i],Ie('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return Tm(n)}var Hb=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Yx(t){return t.replace(Hb,Gb)}function Gb(t,e,n,i){let r="";for(let s=parseInt(e);s<parseInt(n);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function Zx(t){let e=`precision ${t.precision} float;
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
#define LOW_PRECISION`),e}var Wb={[qa]:"SHADOWMAP_TYPE_PCF",[yo]:"SHADOWMAP_TYPE_VSM"};function Xb(t){return Wb[t.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var qb={[Ur]:"ENVMAP_TYPE_CUBE",[hs]:"ENVMAP_TYPE_CUBE",[Ya]:"ENVMAP_TYPE_CUBE_UV"};function Yb(t){return t.envMap===!1?"ENVMAP_TYPE_CUBE":qb[t.envMapMode]||"ENVMAP_TYPE_CUBE"}var Zb={[hs]:"ENVMAP_MODE_REFRACTION"};function $b(t){return t.envMap===!1?"ENVMAP_MODE_REFLECTION":Zb[t.envMapMode]||"ENVMAP_MODE_REFLECTION"}var Jb={[Vp]:"ENVMAP_BLENDING_MULTIPLY",[fx]:"ENVMAP_BLENDING_MIX",[px]:"ENVMAP_BLENDING_ADD"};function Kb(t){return t.envMap===!1?"ENVMAP_BLENDING_NONE":Jb[t.combine]||"ENVMAP_BLENDING_NONE"}function jb(t){let e=t.envMapCubeUVHeight;if(e===null)return null;let n=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,n),112)),texelHeight:i,maxMip:n}}function Qb(t,e,n,i){let r=t.getContext(),s=n.defines,o=n.vertexShader,a=n.fragmentShader,l=Xb(n),c=Yb(n),d=$b(n),f=Kb(n),h=jb(n),p=Fb(n),_=Ob(s),S=r.createProgram(),g,u,m=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(g=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_].filter(rl).join(`
`),g.length>0&&(g+=`
`),u=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_].filter(rl).join(`
`),u.length>0&&(u+=`
`)):(g=[Zx(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+d:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexNormals?"#define HAS_NORMAL":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(rl).join(`
`),u=[Zx(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+d:"",n.envMap?"#define "+f:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor?"#define USE_COLOR":"",n.vertexAlphas||n.batchingColor?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==oi?"#define TONE_MAPPING":"",n.toneMapping!==oi?We.tonemapping_pars_fragment:"",n.toneMapping!==oi?Db("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",We.colorspace_pars_fragment,Lb("linearToOutputTexel",n.outputColorSpace),Ub(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(rl).join(`
`)),o=Tm(o),o=Xx(o,n),o=qx(o,n),a=Tm(a),a=Xx(a,n),a=qx(a,n),o=Yx(o),a=Yx(a),n.isRawShaderMaterial!==!0&&(m=`#version 300 es
`,g=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+g,u=["#define varying in",n.glslVersion===im?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===im?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+u);let v=m+g+o,M=m+u+a,A=Hx(r,r.VERTEX_SHADER,v),E=Hx(r,r.FRAGMENT_SHADER,M);r.attachShader(S,A),r.attachShader(S,E),n.index0AttributeName!==void 0?r.bindAttribLocation(S,0,n.index0AttributeName):n.morphTargets===!0&&r.bindAttribLocation(S,0,"position"),r.linkProgram(S);function P(b){if(t.debug.checkShaderErrors){let I=r.getProgramInfoLog(S)||"",W=r.getShaderInfoLog(A)||"",H=r.getShaderInfoLog(E)||"",D=I.trim(),B=W.trim(),k=H.trim(),te=!0,se=!0;if(r.getProgramParameter(S,r.LINK_STATUS)===!1)if(te=!1,typeof t.debug.onShaderError=="function")t.debug.onShaderError(r,S,A,E);else{let ue=Wx(r,A,"vertex"),ve=Wx(r,E,"fragment");Ne("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(S,r.VALIDATE_STATUS)+`

Material Name: `+b.name+`
Material Type: `+b.type+`

Program Info Log: `+D+`
`+ue+`
`+ve)}else D!==""?Ie("WebGLProgram: Program Info Log:",D):(B===""||k==="")&&(se=!1);se&&(b.diagnostics={runnable:te,programLog:D,vertexShader:{log:B,prefix:g},fragmentShader:{log:k,prefix:u}})}r.deleteShader(A),r.deleteShader(E),x=new To(r,S),R=Bb(r,S)}let x;this.getUniforms=function(){return x===void 0&&P(this),x};let R;this.getAttributes=function(){return R===void 0&&P(this),R};let C=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return C===!1&&(C=r.getProgramParameter(S,Cb)),C},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(S),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=Rb++,this.cacheKey=e,this.usedTimes=1,this.program=S,this.vertexShader=A,this.fragmentShader=E,this}var eA=0,bm=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let n=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(n),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let n=this.materialCache.get(e);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let n=this.materialCache,i=n.get(e);return i===void 0&&(i=new Set,n.set(e,i)),i}_getShaderStage(e){let n=this.shaderCache,i=n.get(e);return i===void 0&&(i=new Am(e),n.set(e,i)),i}},Am=class{constructor(e){this.id=eA++,this.code=e,this.usedTimes=0}};function tA(t){return t===Br||t===Qa||t===el}function nA(t,e,n,i,r,s){let o=new Ia,a=new bm,l=new Set,c=[],d=new Map,f=i.logarithmicDepthBuffer,h=i.precision,p={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(x){return l.add(x),x===0?"uv":`uv${x}`}function S(x,R,C,b,I,W){let H=b.fog,D=I.geometry,B=x.isMeshStandardMaterial||x.isMeshLambertMaterial||x.isMeshPhongMaterial?b.environment:null,k=x.isMeshStandardMaterial||x.isMeshLambertMaterial&&!x.envMap||x.isMeshPhongMaterial&&!x.envMap,te=e.get(x.envMap||B,k),se=te&&te.mapping===Ya?te.image.height:null,ue=p[x.type];x.precision!==null&&(h=i.getMaxPrecision(x.precision),h!==x.precision&&Ie("WebGLProgram.getParameters:",x.precision,"not supported, using",h,"instead."));let ve=D.morphAttributes.position||D.morphAttributes.normal||D.morphAttributes.color,we=ve!==void 0?ve.length:0,ze=0;D.morphAttributes.position!==void 0&&(ze=1),D.morphAttributes.normal!==void 0&&(ze=2),D.morphAttributes.color!==void 0&&(ze=3);let je,De,ee,G;if(ue){let Be=Ri[ue];je=Be.vertexShader,De=Be.fragmentShader}else je=x.vertexShader,De=x.fragmentShader,a.update(x),ee=a.getVertexShaderID(x),G=a.getFragmentShaderID(x);let Z=t.getRenderTarget(),me=t.state.buffers.depth.getReversed(),be=I.isInstancedMesh===!0,Ae=I.isBatchedMesh===!0,ht=!!x.map,Ve=!!x.matcap,qe=!!te,ot=!!x.aoMap,Ue=!!x.lightMap,lt=!!x.bumpMap,Ze=!!x.normalMap,Ot=!!x.displacementMap,N=!!x.emissiveMap,At=!!x.metalnessMap,Oe=!!x.roughnessMap,q=x.anisotropy>0,de=x.clearcoat>0,dt=x.dispersion>0,T=x.iridescence>0,y=x.sheen>0,F=x.transmission>0,K=q&&!!x.anisotropyMap,$=de&&!!x.clearcoatMap,Q=de&&!!x.clearcoatNormalMap,ne=de&&!!x.clearcoatRoughnessMap,Y=T&&!!x.iridescenceMap,j=T&&!!x.iridescenceThicknessMap,he=y&&!!x.sheenColorMap,fe=y&&!!x.sheenRoughnessMap,ie=!!x.specularMap,ae=!!x.specularColorMap,Ee=!!x.specularIntensityMap,He=F&&!!x.transmissionMap,it=F&&!!x.thicknessMap,L=!!x.gradientMap,le=!!x.alphaMap,J=x.alphaTest>0,xe=!!x.alphaHash,ce=!!x.extensions,re=oi;x.toneMapped&&(Z===null||Z.isXRRenderTarget===!0)&&(re=t.toneMapping);let Ce={shaderID:ue,shaderType:x.type,shaderName:x.name,vertexShader:je,fragmentShader:De,defines:x.defines,customVertexShaderID:ee,customFragmentShaderID:G,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:h,batching:Ae,batchingColor:Ae&&I._colorsTexture!==null,instancing:be,instancingColor:be&&I.instanceColor!==null,instancingMorph:be&&I.morphTexture!==null,outputColorSpace:Z===null?t.outputColorSpace:Z.isXRRenderTarget===!0?Z.texture.colorSpace:$e.workingColorSpace,alphaToCoverage:!!x.alphaToCoverage,map:ht,matcap:Ve,envMap:qe,envMapMode:qe&&te.mapping,envMapCubeUVHeight:se,aoMap:ot,lightMap:Ue,bumpMap:lt,normalMap:Ze,displacementMap:Ot,emissiveMap:N,normalMapObjectSpace:Ze&&x.normalMapType===_x,normalMapTangentSpace:Ze&&x.normalMapType===tl,packedNormalMap:Ze&&x.normalMapType===tl&&tA(x.normalMap.format),metalnessMap:At,roughnessMap:Oe,anisotropy:q,anisotropyMap:K,clearcoat:de,clearcoatMap:$,clearcoatNormalMap:Q,clearcoatRoughnessMap:ne,dispersion:dt,iridescence:T,iridescenceMap:Y,iridescenceThicknessMap:j,sheen:y,sheenColorMap:he,sheenRoughnessMap:fe,specularMap:ie,specularColorMap:ae,specularIntensityMap:Ee,transmission:F,transmissionMap:He,thicknessMap:it,gradientMap:L,opaque:x.transparent===!1&&x.blending===ls&&x.alphaToCoverage===!1,alphaMap:le,alphaTest:J,alphaHash:xe,combine:x.combine,mapUv:ht&&_(x.map.channel),aoMapUv:ot&&_(x.aoMap.channel),lightMapUv:Ue&&_(x.lightMap.channel),bumpMapUv:lt&&_(x.bumpMap.channel),normalMapUv:Ze&&_(x.normalMap.channel),displacementMapUv:Ot&&_(x.displacementMap.channel),emissiveMapUv:N&&_(x.emissiveMap.channel),metalnessMapUv:At&&_(x.metalnessMap.channel),roughnessMapUv:Oe&&_(x.roughnessMap.channel),anisotropyMapUv:K&&_(x.anisotropyMap.channel),clearcoatMapUv:$&&_(x.clearcoatMap.channel),clearcoatNormalMapUv:Q&&_(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ne&&_(x.clearcoatRoughnessMap.channel),iridescenceMapUv:Y&&_(x.iridescenceMap.channel),iridescenceThicknessMapUv:j&&_(x.iridescenceThicknessMap.channel),sheenColorMapUv:he&&_(x.sheenColorMap.channel),sheenRoughnessMapUv:fe&&_(x.sheenRoughnessMap.channel),specularMapUv:ie&&_(x.specularMap.channel),specularColorMapUv:ae&&_(x.specularColorMap.channel),specularIntensityMapUv:Ee&&_(x.specularIntensityMap.channel),transmissionMapUv:He&&_(x.transmissionMap.channel),thicknessMapUv:it&&_(x.thicknessMap.channel),alphaMapUv:le&&_(x.alphaMap.channel),vertexTangents:!!D.attributes.tangent&&(Ze||q),vertexNormals:!!D.attributes.normal,vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!D.attributes.color&&D.attributes.color.itemSize===4,pointsUvs:I.isPoints===!0&&!!D.attributes.uv&&(ht||le),fog:!!H,useFog:x.fog===!0,fogExp2:!!H&&H.isFogExp2,flatShading:x.wireframe===!1&&(x.flatShading===!0||D.attributes.normal===void 0&&Ze===!1&&(x.isMeshLambertMaterial||x.isMeshPhongMaterial||x.isMeshStandardMaterial||x.isMeshPhysicalMaterial)),sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:f,reversedDepthBuffer:me,skinning:I.isSkinnedMesh===!0,morphTargets:D.morphAttributes.position!==void 0,morphNormals:D.morphAttributes.normal!==void 0,morphColors:D.morphAttributes.color!==void 0,morphTargetsCount:we,morphTextureStride:ze,numDirLights:R.directional.length,numPointLights:R.point.length,numSpotLights:R.spot.length,numSpotLightMaps:R.spotLightMap.length,numRectAreaLights:R.rectArea.length,numHemiLights:R.hemi.length,numDirLightShadows:R.directionalShadowMap.length,numPointLightShadows:R.pointShadowMap.length,numSpotLightShadows:R.spotShadowMap.length,numSpotLightShadowsWithMaps:R.numSpotLightShadowsWithMaps,numLightProbes:R.numLightProbes,numLightProbeGrids:W.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:x.dithering,shadowMapEnabled:t.shadowMap.enabled&&C.length>0,shadowMapType:t.shadowMap.type,toneMapping:re,decodeVideoTexture:ht&&x.map.isVideoTexture===!0&&$e.getTransfer(x.map.colorSpace)===rt,decodeVideoTextureEmissive:N&&x.emissiveMap.isVideoTexture===!0&&$e.getTransfer(x.emissiveMap.colorSpace)===rt,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===Xn,flipSided:x.side===Qt,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:ce&&x.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(ce&&x.extensions.multiDraw===!0||Ae)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return Ce.vertexUv1s=l.has(1),Ce.vertexUv2s=l.has(2),Ce.vertexUv3s=l.has(3),l.clear(),Ce}function g(x){let R=[];if(x.shaderID?R.push(x.shaderID):(R.push(x.customVertexShaderID),R.push(x.customFragmentShaderID)),x.defines!==void 0)for(let C in x.defines)R.push(C),R.push(x.defines[C]);return x.isRawShaderMaterial===!1&&(u(R,x),m(R,x),R.push(t.outputColorSpace)),R.push(x.customProgramCacheKey),R.join()}function u(x,R){x.push(R.precision),x.push(R.outputColorSpace),x.push(R.envMapMode),x.push(R.envMapCubeUVHeight),x.push(R.mapUv),x.push(R.alphaMapUv),x.push(R.lightMapUv),x.push(R.aoMapUv),x.push(R.bumpMapUv),x.push(R.normalMapUv),x.push(R.displacementMapUv),x.push(R.emissiveMapUv),x.push(R.metalnessMapUv),x.push(R.roughnessMapUv),x.push(R.anisotropyMapUv),x.push(R.clearcoatMapUv),x.push(R.clearcoatNormalMapUv),x.push(R.clearcoatRoughnessMapUv),x.push(R.iridescenceMapUv),x.push(R.iridescenceThicknessMapUv),x.push(R.sheenColorMapUv),x.push(R.sheenRoughnessMapUv),x.push(R.specularMapUv),x.push(R.specularColorMapUv),x.push(R.specularIntensityMapUv),x.push(R.transmissionMapUv),x.push(R.thicknessMapUv),x.push(R.combine),x.push(R.fogExp2),x.push(R.sizeAttenuation),x.push(R.morphTargetsCount),x.push(R.morphAttributeCount),x.push(R.numDirLights),x.push(R.numPointLights),x.push(R.numSpotLights),x.push(R.numSpotLightMaps),x.push(R.numHemiLights),x.push(R.numRectAreaLights),x.push(R.numDirLightShadows),x.push(R.numPointLightShadows),x.push(R.numSpotLightShadows),x.push(R.numSpotLightShadowsWithMaps),x.push(R.numLightProbes),x.push(R.shadowMapType),x.push(R.toneMapping),x.push(R.numClippingPlanes),x.push(R.numClipIntersection),x.push(R.depthPacking)}function m(x,R){o.disableAll(),R.instancing&&o.enable(0),R.instancingColor&&o.enable(1),R.instancingMorph&&o.enable(2),R.matcap&&o.enable(3),R.envMap&&o.enable(4),R.normalMapObjectSpace&&o.enable(5),R.normalMapTangentSpace&&o.enable(6),R.clearcoat&&o.enable(7),R.iridescence&&o.enable(8),R.alphaTest&&o.enable(9),R.vertexColors&&o.enable(10),R.vertexAlphas&&o.enable(11),R.vertexUv1s&&o.enable(12),R.vertexUv2s&&o.enable(13),R.vertexUv3s&&o.enable(14),R.vertexTangents&&o.enable(15),R.anisotropy&&o.enable(16),R.alphaHash&&o.enable(17),R.batching&&o.enable(18),R.dispersion&&o.enable(19),R.batchingColor&&o.enable(20),R.gradientMap&&o.enable(21),R.packedNormalMap&&o.enable(22),R.vertexNormals&&o.enable(23),x.push(o.mask),o.disableAll(),R.fog&&o.enable(0),R.useFog&&o.enable(1),R.flatShading&&o.enable(2),R.logarithmicDepthBuffer&&o.enable(3),R.reversedDepthBuffer&&o.enable(4),R.skinning&&o.enable(5),R.morphTargets&&o.enable(6),R.morphNormals&&o.enable(7),R.morphColors&&o.enable(8),R.premultipliedAlpha&&o.enable(9),R.shadowMapEnabled&&o.enable(10),R.doubleSided&&o.enable(11),R.flipSided&&o.enable(12),R.useDepthPacking&&o.enable(13),R.dithering&&o.enable(14),R.transmission&&o.enable(15),R.sheen&&o.enable(16),R.opaque&&o.enable(17),R.pointsUvs&&o.enable(18),R.decodeVideoTexture&&o.enable(19),R.decodeVideoTextureEmissive&&o.enable(20),R.alphaToCoverage&&o.enable(21),R.numLightProbeGrids>0&&o.enable(22),x.push(o.mask)}function v(x){let R=p[x.type],C;if(R){let b=Ri[R];C=Rx.clone(b.uniforms)}else C=x.uniforms;return C}function M(x,R){let C=d.get(R);return C!==void 0?++C.usedTimes:(C=new Qb(t,R,x,r),c.push(C),d.set(R,C)),C}function A(x){if(--x.usedTimes===0){let R=c.indexOf(x);c[R]=c[c.length-1],c.pop(),d.delete(x.cacheKey),x.destroy()}}function E(x){a.remove(x)}function P(){a.dispose()}return{getParameters:S,getProgramCacheKey:g,getUniforms:v,acquireProgram:M,releaseProgram:A,releaseShaderCache:E,programs:c,dispose:P}}function iA(){let t=new WeakMap;function e(o){return t.has(o)}function n(o){let a=t.get(o);return a===void 0&&(a={},t.set(o,a)),a}function i(o){t.delete(o)}function r(o,a,l){t.get(o)[a]=l}function s(){t=new WeakMap}return{has:e,get:n,remove:i,update:r,dispose:s}}function rA(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.material.id!==e.material.id?t.material.id-e.material.id:t.materialVariant!==e.materialVariant?t.materialVariant-e.materialVariant:t.z!==e.z?t.z-e.z:t.id-e.id}function $x(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.z!==e.z?e.z-t.z:t.id-e.id}function Jx(){let t=[],e=0,n=[],i=[],r=[];function s(){e=0,n.length=0,i.length=0,r.length=0}function o(h){let p=0;return h.isInstancedMesh&&(p+=2),h.isSkinnedMesh&&(p+=1),p}function a(h,p,_,S,g,u){let m=t[e];return m===void 0?(m={id:h.id,object:h,geometry:p,material:_,materialVariant:o(h),groupOrder:S,renderOrder:h.renderOrder,z:g,group:u},t[e]=m):(m.id=h.id,m.object=h,m.geometry=p,m.material=_,m.materialVariant=o(h),m.groupOrder=S,m.renderOrder=h.renderOrder,m.z=g,m.group=u),e++,m}function l(h,p,_,S,g,u){let m=a(h,p,_,S,g,u);_.transmission>0?i.push(m):_.transparent===!0?r.push(m):n.push(m)}function c(h,p,_,S,g,u){let m=a(h,p,_,S,g,u);_.transmission>0?i.unshift(m):_.transparent===!0?r.unshift(m):n.unshift(m)}function d(h,p){n.length>1&&n.sort(h||rA),i.length>1&&i.sort(p||$x),r.length>1&&r.sort(p||$x)}function f(){for(let h=e,p=t.length;h<p;h++){let _=t[h];if(_.id===null)break;_.id=null,_.object=null,_.geometry=null,_.material=null,_.group=null}}return{opaque:n,transmissive:i,transparent:r,init:s,push:l,unshift:c,finish:f,sort:d}}function sA(){let t=new WeakMap;function e(i,r){let s=t.get(i),o;return s===void 0?(o=new Jx,t.set(i,[o])):r>=s.length?(o=new Jx,s.push(o)):o=s[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}function oA(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={direction:new O,color:new Ge};break;case"SpotLight":n={position:new O,direction:new O,color:new Ge,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new O,color:new Ge,distance:0,decay:0};break;case"HemisphereLight":n={direction:new O,skyColor:new Ge,groundColor:new Ge};break;case"RectAreaLight":n={color:new Ge,position:new O,halfWidth:new O,halfHeight:new O};break}return t[e.id]=n,n}}}function aA(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ke};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ke};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ke,shadowCameraNear:1,shadowCameraFar:1e3};break}return t[e.id]=n,n}}}var lA=0;function cA(t,e){return(e.castShadow?2:0)-(t.castShadow?2:0)+(e.map?1:0)-(t.map?1:0)}function uA(t){let e=new oA,n=aA(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new O);let r=new O,s=new Tt,o=new Tt;function a(c){let d=0,f=0,h=0;for(let R=0;R<9;R++)i.probe[R].set(0,0,0);let p=0,_=0,S=0,g=0,u=0,m=0,v=0,M=0,A=0,E=0,P=0;c.sort(cA);for(let R=0,C=c.length;R<C;R++){let b=c[R],I=b.color,W=b.intensity,H=b.distance,D=null;if(b.shadow&&b.shadow.map&&(b.shadow.map.texture.format===Br?D=b.shadow.map.texture:D=b.shadow.map.depthTexture||b.shadow.map.texture),b.isAmbientLight)d+=I.r*W,f+=I.g*W,h+=I.b*W;else if(b.isLightProbe){for(let B=0;B<9;B++)i.probe[B].addScaledVector(b.sh.coefficients[B],W);P++}else if(b.isDirectionalLight){let B=e.get(b);if(B.color.copy(b.color).multiplyScalar(b.intensity),b.castShadow){let k=b.shadow,te=n.get(b);te.shadowIntensity=k.intensity,te.shadowBias=k.bias,te.shadowNormalBias=k.normalBias,te.shadowRadius=k.radius,te.shadowMapSize=k.mapSize,i.directionalShadow[p]=te,i.directionalShadowMap[p]=D,i.directionalShadowMatrix[p]=b.shadow.matrix,m++}i.directional[p]=B,p++}else if(b.isSpotLight){let B=e.get(b);B.position.setFromMatrixPosition(b.matrixWorld),B.color.copy(I).multiplyScalar(W),B.distance=H,B.coneCos=Math.cos(b.angle),B.penumbraCos=Math.cos(b.angle*(1-b.penumbra)),B.decay=b.decay,i.spot[S]=B;let k=b.shadow;if(b.map&&(i.spotLightMap[A]=b.map,A++,k.updateMatrices(b),b.castShadow&&E++),i.spotLightMatrix[S]=k.matrix,b.castShadow){let te=n.get(b);te.shadowIntensity=k.intensity,te.shadowBias=k.bias,te.shadowNormalBias=k.normalBias,te.shadowRadius=k.radius,te.shadowMapSize=k.mapSize,i.spotShadow[S]=te,i.spotShadowMap[S]=D,M++}S++}else if(b.isRectAreaLight){let B=e.get(b);B.color.copy(I).multiplyScalar(W),B.halfWidth.set(b.width*.5,0,0),B.halfHeight.set(0,b.height*.5,0),i.rectArea[g]=B,g++}else if(b.isPointLight){let B=e.get(b);if(B.color.copy(b.color).multiplyScalar(b.intensity),B.distance=b.distance,B.decay=b.decay,b.castShadow){let k=b.shadow,te=n.get(b);te.shadowIntensity=k.intensity,te.shadowBias=k.bias,te.shadowNormalBias=k.normalBias,te.shadowRadius=k.radius,te.shadowMapSize=k.mapSize,te.shadowCameraNear=k.camera.near,te.shadowCameraFar=k.camera.far,i.pointShadow[_]=te,i.pointShadowMap[_]=D,i.pointShadowMatrix[_]=b.shadow.matrix,v++}i.point[_]=B,_++}else if(b.isHemisphereLight){let B=e.get(b);B.skyColor.copy(b.color).multiplyScalar(W),B.groundColor.copy(b.groundColor).multiplyScalar(W),i.hemi[u]=B,u++}}g>0&&(t.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=pe.LTC_FLOAT_1,i.rectAreaLTC2=pe.LTC_FLOAT_2):(i.rectAreaLTC1=pe.LTC_HALF_1,i.rectAreaLTC2=pe.LTC_HALF_2)),i.ambient[0]=d,i.ambient[1]=f,i.ambient[2]=h;let x=i.hash;(x.directionalLength!==p||x.pointLength!==_||x.spotLength!==S||x.rectAreaLength!==g||x.hemiLength!==u||x.numDirectionalShadows!==m||x.numPointShadows!==v||x.numSpotShadows!==M||x.numSpotMaps!==A||x.numLightProbes!==P)&&(i.directional.length=p,i.spot.length=S,i.rectArea.length=g,i.point.length=_,i.hemi.length=u,i.directionalShadow.length=m,i.directionalShadowMap.length=m,i.pointShadow.length=v,i.pointShadowMap.length=v,i.spotShadow.length=M,i.spotShadowMap.length=M,i.directionalShadowMatrix.length=m,i.pointShadowMatrix.length=v,i.spotLightMatrix.length=M+A-E,i.spotLightMap.length=A,i.numSpotLightShadowsWithMaps=E,i.numLightProbes=P,x.directionalLength=p,x.pointLength=_,x.spotLength=S,x.rectAreaLength=g,x.hemiLength=u,x.numDirectionalShadows=m,x.numPointShadows=v,x.numSpotShadows=M,x.numSpotMaps=A,x.numLightProbes=P,i.version=lA++)}function l(c,d){let f=0,h=0,p=0,_=0,S=0,g=d.matrixWorldInverse;for(let u=0,m=c.length;u<m;u++){let v=c[u];if(v.isDirectionalLight){let M=i.directional[f];M.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),M.direction.sub(r),M.direction.transformDirection(g),f++}else if(v.isSpotLight){let M=i.spot[p];M.position.setFromMatrixPosition(v.matrixWorld),M.position.applyMatrix4(g),M.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),M.direction.sub(r),M.direction.transformDirection(g),p++}else if(v.isRectAreaLight){let M=i.rectArea[_];M.position.setFromMatrixPosition(v.matrixWorld),M.position.applyMatrix4(g),o.identity(),s.copy(v.matrixWorld),s.premultiply(g),o.extractRotation(s),M.halfWidth.set(v.width*.5,0,0),M.halfHeight.set(0,v.height*.5,0),M.halfWidth.applyMatrix4(o),M.halfHeight.applyMatrix4(o),_++}else if(v.isPointLight){let M=i.point[h];M.position.setFromMatrixPosition(v.matrixWorld),M.position.applyMatrix4(g),h++}else if(v.isHemisphereLight){let M=i.hemi[S];M.direction.setFromMatrixPosition(v.matrixWorld),M.direction.transformDirection(g),S++}}}return{setup:a,setupView:l,state:i}}function Kx(t){let e=new uA(t),n=[],i=[],r=[];function s(h){f.camera=h,n.length=0,i.length=0,r.length=0}function o(h){n.push(h)}function a(h){i.push(h)}function l(h){r.push(h)}function c(){e.setup(n)}function d(h){e.setupView(n,h)}let f={lightsArray:n,shadowsArray:i,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:f,setupLights:c,setupLightsView:d,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function hA(t){let e=new WeakMap;function n(r,s=0){let o=e.get(r),a;return o===void 0?(a=new Kx(t),e.set(r,[a])):s>=o.length?(a=new Kx(t),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:n,dispose:i}}var dA=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,fA=`uniform sampler2D shadow_pass;
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
}`,pA=[new O(1,0,0),new O(-1,0,0),new O(0,1,0),new O(0,-1,0),new O(0,0,1),new O(0,0,-1)],mA=[new O(0,-1,0),new O(0,-1,0),new O(0,0,1),new O(0,0,-1),new O(0,-1,0),new O(0,-1,0)],jx=new Tt,il=new O,ym=new O;function gA(t,e,n){let i=new fo,r=new Ke,s=new Ke,o=new bt,a=new bu,l=new Au,c={},d=n.maxTextureSize,f={[$i]:Qt,[Qt]:$i,[Xn]:Xn},h=new Dn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ke},radius:{value:4}},vertexShader:dA,fragmentShader:fA}),p=h.clone();p.defines.HORIZONTAL_PASS=1;let _=new qt;_.setAttribute("position",new Ln(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let S=new Ft(_,h),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=qa;let u=this.type;this.render=function(E,P,x){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||E.length===0)return;this.type===Zv&&(Ie("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=qa);let R=t.getRenderTarget(),C=t.getActiveCubeFace(),b=t.getActiveMipmapLevel(),I=t.state;I.setBlending(bi),I.buffers.depth.getReversed()===!0?I.buffers.color.setClear(0,0,0,0):I.buffers.color.setClear(1,1,1,1),I.buffers.depth.setTest(!0),I.setScissorTest(!1);let W=u!==this.type;W&&P.traverse(function(H){H.material&&(Array.isArray(H.material)?H.material.forEach(D=>D.needsUpdate=!0):H.material.needsUpdate=!0)});for(let H=0,D=E.length;H<D;H++){let B=E[H],k=B.shadow;if(k===void 0){Ie("WebGLShadowMap:",B,"has no shadow.");continue}if(k.autoUpdate===!1&&k.needsUpdate===!1)continue;r.copy(k.mapSize);let te=k.getFrameExtents();r.multiply(te),s.copy(k.mapSize),(r.x>d||r.y>d)&&(r.x>d&&(s.x=Math.floor(d/te.x),r.x=s.x*te.x,k.mapSize.x=s.x),r.y>d&&(s.y=Math.floor(d/te.y),r.y=s.y*te.y,k.mapSize.y=s.y));let se=t.state.buffers.depth.getReversed();if(k.camera._reversedDepth=se,k.map===null||W===!0){if(k.map!==null&&(k.map.depthTexture!==null&&(k.map.depthTexture.dispose(),k.map.depthTexture=null),k.map.dispose()),this.type===yo){if(B.isPointLight){Ie("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}k.map=new Nn(r.x,r.y,{format:Br,type:Ai,minFilter:Kt,magFilter:Kt,generateMipmaps:!1}),k.map.texture.name=B.name+".shadowMap",k.map.depthTexture=new Ki(r.x,r.y,li),k.map.depthTexture.name=B.name+".shadowMapDepth",k.map.depthTexture.format=yi,k.map.depthTexture.compareFunction=null,k.map.depthTexture.minFilter=Xt,k.map.depthTexture.magFilter=Xt}else B.isPointLight?(k.map=new Lh(r.x),k.map.depthTexture=new wu(r.x,ai)):(k.map=new Nn(r.x,r.y),k.map.depthTexture=new Ki(r.x,r.y,ai)),k.map.depthTexture.name=B.name+".shadowMap",k.map.depthTexture.format=yi,this.type===qa?(k.map.depthTexture.compareFunction=se?Ah:bh,k.map.depthTexture.minFilter=Kt,k.map.depthTexture.magFilter=Kt):(k.map.depthTexture.compareFunction=null,k.map.depthTexture.minFilter=Xt,k.map.depthTexture.magFilter=Xt);k.camera.updateProjectionMatrix()}let ue=k.map.isWebGLCubeRenderTarget?6:1;for(let ve=0;ve<ue;ve++){if(k.map.isWebGLCubeRenderTarget)t.setRenderTarget(k.map,ve),t.clear();else{ve===0&&(t.setRenderTarget(k.map),t.clear());let we=k.getViewport(ve);o.set(s.x*we.x,s.y*we.y,s.x*we.z,s.y*we.w),I.viewport(o)}if(B.isPointLight){let we=k.camera,ze=k.matrix,je=B.distance||we.far;je!==we.far&&(we.far=je,we.updateProjectionMatrix()),il.setFromMatrixPosition(B.matrixWorld),we.position.copy(il),ym.copy(we.position),ym.add(pA[ve]),we.up.copy(mA[ve]),we.lookAt(ym),we.updateMatrixWorld(),ze.makeTranslation(-il.x,-il.y,-il.z),jx.multiplyMatrices(we.projectionMatrix,we.matrixWorldInverse),k._frustum.setFromProjectionMatrix(jx,we.coordinateSystem,we.reversedDepth)}else k.updateMatrices(B);i=k.getFrustum(),M(P,x,k.camera,B,this.type)}k.isPointLightShadow!==!0&&this.type===yo&&m(k,x),k.needsUpdate=!1}u=this.type,g.needsUpdate=!1,t.setRenderTarget(R,C,b)};function m(E,P){let x=e.update(S);h.defines.VSM_SAMPLES!==E.blurSamples&&(h.defines.VSM_SAMPLES=E.blurSamples,p.defines.VSM_SAMPLES=E.blurSamples,h.needsUpdate=!0,p.needsUpdate=!0),E.mapPass===null&&(E.mapPass=new Nn(r.x,r.y,{format:Br,type:Ai})),h.uniforms.shadow_pass.value=E.map.depthTexture,h.uniforms.resolution.value=E.mapSize,h.uniforms.radius.value=E.radius,t.setRenderTarget(E.mapPass),t.clear(),t.renderBufferDirect(P,null,x,h,S,null),p.uniforms.shadow_pass.value=E.mapPass.texture,p.uniforms.resolution.value=E.mapSize,p.uniforms.radius.value=E.radius,t.setRenderTarget(E.map),t.clear(),t.renderBufferDirect(P,null,x,p,S,null)}function v(E,P,x,R){let C=null,b=x.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(b!==void 0)C=b;else if(C=x.isPointLight===!0?l:a,t.localClippingEnabled&&P.clipShadows===!0&&Array.isArray(P.clippingPlanes)&&P.clippingPlanes.length!==0||P.displacementMap&&P.displacementScale!==0||P.alphaMap&&P.alphaTest>0||P.map&&P.alphaTest>0||P.alphaToCoverage===!0){let I=C.uuid,W=P.uuid,H=c[I];H===void 0&&(H={},c[I]=H);let D=H[W];D===void 0&&(D=C.clone(),H[W]=D,P.addEventListener("dispose",A)),C=D}if(C.visible=P.visible,C.wireframe=P.wireframe,R===yo?C.side=P.shadowSide!==null?P.shadowSide:P.side:C.side=P.shadowSide!==null?P.shadowSide:f[P.side],C.alphaMap=P.alphaMap,C.alphaTest=P.alphaToCoverage===!0?.5:P.alphaTest,C.map=P.map,C.clipShadows=P.clipShadows,C.clippingPlanes=P.clippingPlanes,C.clipIntersection=P.clipIntersection,C.displacementMap=P.displacementMap,C.displacementScale=P.displacementScale,C.displacementBias=P.displacementBias,C.wireframeLinewidth=P.wireframeLinewidth,C.linewidth=P.linewidth,x.isPointLight===!0&&C.isMeshDistanceMaterial===!0){let I=t.properties.get(C);I.light=x}return C}function M(E,P,x,R,C){if(E.visible===!1)return;if(E.layers.test(P.layers)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&C===yo)&&(!E.frustumCulled||i.intersectsObject(E))){E.modelViewMatrix.multiplyMatrices(x.matrixWorldInverse,E.matrixWorld);let W=e.update(E),H=E.material;if(Array.isArray(H)){let D=W.groups;for(let B=0,k=D.length;B<k;B++){let te=D[B],se=H[te.materialIndex];if(se&&se.visible){let ue=v(E,se,R,C);E.onBeforeShadow(t,E,P,x,W,ue,te),t.renderBufferDirect(x,null,W,ue,E,te),E.onAfterShadow(t,E,P,x,W,ue,te)}}}else if(H.visible){let D=v(E,H,R,C);E.onBeforeShadow(t,E,P,x,W,D,null),t.renderBufferDirect(x,null,W,D,E,null),E.onAfterShadow(t,E,P,x,W,D,null)}}let I=E.children;for(let W=0,H=I.length;W<H;W++)M(I[W],P,x,R,C)}function A(E){E.target.removeEventListener("dispose",A);for(let x in c){let R=c[x],C=E.target.uuid;C in R&&(R[C].dispose(),delete R[C])}}}function _A(t,e){function n(){let L=!1,le=new bt,J=null,xe=new bt(0,0,0,0);return{setMask:function(ce){J!==ce&&!L&&(t.colorMask(ce,ce,ce,ce),J=ce)},setLocked:function(ce){L=ce},setClear:function(ce,re,Ce,Be,Pt){Pt===!0&&(ce*=Be,re*=Be,Ce*=Be),le.set(ce,re,Ce,Be),xe.equals(le)===!1&&(t.clearColor(ce,re,Ce,Be),xe.copy(le))},reset:function(){L=!1,J=null,xe.set(-1,0,0,0)}}}function i(){let L=!1,le=!1,J=null,xe=null,ce=null;return{setReversed:function(re){if(le!==re){let Ce=e.get("EXT_clip_control");re?Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.ZERO_TO_ONE_EXT):Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.NEGATIVE_ONE_TO_ONE_EXT),le=re;let Be=ce;ce=null,this.setClear(Be)}},getReversed:function(){return le},setTest:function(re){re?Z(t.DEPTH_TEST):me(t.DEPTH_TEST)},setMask:function(re){J!==re&&!L&&(t.depthMask(re),J=re)},setFunc:function(re){if(le&&(re=Ax[re]),xe!==re){switch(re){case su:t.depthFunc(t.NEVER);break;case ou:t.depthFunc(t.ALWAYS);break;case au:t.depthFunc(t.LESS);break;case cs:t.depthFunc(t.LEQUAL);break;case lu:t.depthFunc(t.EQUAL);break;case cu:t.depthFunc(t.GEQUAL);break;case uu:t.depthFunc(t.GREATER);break;case hu:t.depthFunc(t.NOTEQUAL);break;default:t.depthFunc(t.LEQUAL)}xe=re}},setLocked:function(re){L=re},setClear:function(re){ce!==re&&(ce=re,le&&(re=1-re),t.clearDepth(re))},reset:function(){L=!1,J=null,xe=null,ce=null,le=!1}}}function r(){let L=!1,le=null,J=null,xe=null,ce=null,re=null,Ce=null,Be=null,Pt=null;return{setTest:function(ct){L||(ct?Z(t.STENCIL_TEST):me(t.STENCIL_TEST))},setMask:function(ct){le!==ct&&!L&&(t.stencilMask(ct),le=ct)},setFunc:function(ct,Pi,ci){(J!==ct||xe!==Pi||ce!==ci)&&(t.stencilFunc(ct,Pi,ci),J=ct,xe=Pi,ce=ci)},setOp:function(ct,Pi,ci){(re!==ct||Ce!==Pi||Be!==ci)&&(t.stencilOp(ct,Pi,ci),re=ct,Ce=Pi,Be=ci)},setLocked:function(ct){L=ct},setClear:function(ct){Pt!==ct&&(t.clearStencil(ct),Pt=ct)},reset:function(){L=!1,le=null,J=null,xe=null,ce=null,re=null,Ce=null,Be=null,Pt=null}}}let s=new n,o=new i,a=new r,l=new WeakMap,c=new WeakMap,d={},f={},h={},p=new WeakMap,_=[],S=null,g=!1,u=null,m=null,v=null,M=null,A=null,E=null,P=null,x=new Ge(0,0,0),R=0,C=!1,b=null,I=null,W=null,H=null,D=null,B=t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS),k=!1,te=0,se=t.getParameter(t.VERSION);se.indexOf("WebGL")!==-1?(te=parseFloat(/^WebGL (\d)/.exec(se)[1]),k=te>=1):se.indexOf("OpenGL ES")!==-1&&(te=parseFloat(/^OpenGL ES (\d)/.exec(se)[1]),k=te>=2);let ue=null,ve={},we=t.getParameter(t.SCISSOR_BOX),ze=t.getParameter(t.VIEWPORT),je=new bt().fromArray(we),De=new bt().fromArray(ze);function ee(L,le,J,xe){let ce=new Uint8Array(4),re=t.createTexture();t.bindTexture(L,re),t.texParameteri(L,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(L,t.TEXTURE_MAG_FILTER,t.NEAREST);for(let Ce=0;Ce<J;Ce++)L===t.TEXTURE_3D||L===t.TEXTURE_2D_ARRAY?t.texImage3D(le,0,t.RGBA,1,1,xe,0,t.RGBA,t.UNSIGNED_BYTE,ce):t.texImage2D(le+Ce,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,ce);return re}let G={};G[t.TEXTURE_2D]=ee(t.TEXTURE_2D,t.TEXTURE_2D,1),G[t.TEXTURE_CUBE_MAP]=ee(t.TEXTURE_CUBE_MAP,t.TEXTURE_CUBE_MAP_POSITIVE_X,6),G[t.TEXTURE_2D_ARRAY]=ee(t.TEXTURE_2D_ARRAY,t.TEXTURE_2D_ARRAY,1,1),G[t.TEXTURE_3D]=ee(t.TEXTURE_3D,t.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),Z(t.DEPTH_TEST),o.setFunc(cs),lt(!1),Ze(Op),Z(t.CULL_FACE),ot(bi);function Z(L){d[L]!==!0&&(t.enable(L),d[L]=!0)}function me(L){d[L]!==!1&&(t.disable(L),d[L]=!1)}function be(L,le){return h[L]!==le?(t.bindFramebuffer(L,le),h[L]=le,L===t.DRAW_FRAMEBUFFER&&(h[t.FRAMEBUFFER]=le),L===t.FRAMEBUFFER&&(h[t.DRAW_FRAMEBUFFER]=le),!0):!1}function Ae(L,le){let J=_,xe=!1;if(L){J=p.get(le),J===void 0&&(J=[],p.set(le,J));let ce=L.textures;if(J.length!==ce.length||J[0]!==t.COLOR_ATTACHMENT0){for(let re=0,Ce=ce.length;re<Ce;re++)J[re]=t.COLOR_ATTACHMENT0+re;J.length=ce.length,xe=!0}}else J[0]!==t.BACK&&(J[0]=t.BACK,xe=!0);xe&&t.drawBuffers(J)}function ht(L){return S!==L?(t.useProgram(L),S=L,!0):!1}let Ve={[Pr]:t.FUNC_ADD,[Jv]:t.FUNC_SUBTRACT,[Kv]:t.FUNC_REVERSE_SUBTRACT};Ve[jv]=t.MIN,Ve[Qv]=t.MAX;let qe={[ex]:t.ZERO,[tx]:t.ONE,[nx]:t.SRC_COLOR,[iu]:t.SRC_ALPHA,[lx]:t.SRC_ALPHA_SATURATE,[ox]:t.DST_COLOR,[rx]:t.DST_ALPHA,[ix]:t.ONE_MINUS_SRC_COLOR,[ru]:t.ONE_MINUS_SRC_ALPHA,[ax]:t.ONE_MINUS_DST_COLOR,[sx]:t.ONE_MINUS_DST_ALPHA,[cx]:t.CONSTANT_COLOR,[ux]:t.ONE_MINUS_CONSTANT_COLOR,[hx]:t.CONSTANT_ALPHA,[dx]:t.ONE_MINUS_CONSTANT_ALPHA};function ot(L,le,J,xe,ce,re,Ce,Be,Pt,ct){if(L===bi){g===!0&&(me(t.BLEND),g=!1);return}if(g===!1&&(Z(t.BLEND),g=!0),L!==$v){if(L!==u||ct!==C){if((m!==Pr||A!==Pr)&&(t.blendEquation(t.FUNC_ADD),m=Pr,A=Pr),ct)switch(L){case ls:t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case Bp:t.blendFunc(t.ONE,t.ONE);break;case kp:t.blendFuncSeparate(t.ZERO,t.ONE_MINUS_SRC_COLOR,t.ZERO,t.ONE);break;case zp:t.blendFuncSeparate(t.DST_COLOR,t.ONE_MINUS_SRC_ALPHA,t.ZERO,t.ONE);break;default:Ne("WebGLState: Invalid blending: ",L);break}else switch(L){case ls:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case Bp:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE,t.ONE,t.ONE);break;case kp:Ne("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case zp:Ne("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Ne("WebGLState: Invalid blending: ",L);break}v=null,M=null,E=null,P=null,x.set(0,0,0),R=0,u=L,C=ct}return}ce=ce||le,re=re||J,Ce=Ce||xe,(le!==m||ce!==A)&&(t.blendEquationSeparate(Ve[le],Ve[ce]),m=le,A=ce),(J!==v||xe!==M||re!==E||Ce!==P)&&(t.blendFuncSeparate(qe[J],qe[xe],qe[re],qe[Ce]),v=J,M=xe,E=re,P=Ce),(Be.equals(x)===!1||Pt!==R)&&(t.blendColor(Be.r,Be.g,Be.b,Pt),x.copy(Be),R=Pt),u=L,C=!1}function Ue(L,le){L.side===Xn?me(t.CULL_FACE):Z(t.CULL_FACE);let J=L.side===Qt;le&&(J=!J),lt(J),L.blending===ls&&L.transparent===!1?ot(bi):ot(L.blending,L.blendEquation,L.blendSrc,L.blendDst,L.blendEquationAlpha,L.blendSrcAlpha,L.blendDstAlpha,L.blendColor,L.blendAlpha,L.premultipliedAlpha),o.setFunc(L.depthFunc),o.setTest(L.depthTest),o.setMask(L.depthWrite),s.setMask(L.colorWrite);let xe=L.stencilWrite;a.setTest(xe),xe&&(a.setMask(L.stencilWriteMask),a.setFunc(L.stencilFunc,L.stencilRef,L.stencilFuncMask),a.setOp(L.stencilFail,L.stencilZFail,L.stencilZPass)),N(L.polygonOffset,L.polygonOffsetFactor,L.polygonOffsetUnits),L.alphaToCoverage===!0?Z(t.SAMPLE_ALPHA_TO_COVERAGE):me(t.SAMPLE_ALPHA_TO_COVERAGE)}function lt(L){b!==L&&(L?t.frontFace(t.CW):t.frontFace(t.CCW),b=L)}function Ze(L){L!==qv?(Z(t.CULL_FACE),L!==I&&(L===Op?t.cullFace(t.BACK):L===Yv?t.cullFace(t.FRONT):t.cullFace(t.FRONT_AND_BACK))):me(t.CULL_FACE),I=L}function Ot(L){L!==W&&(k&&t.lineWidth(L),W=L)}function N(L,le,J){L?(Z(t.POLYGON_OFFSET_FILL),(H!==le||D!==J)&&(H=le,D=J,o.getReversed()&&(le=-le),t.polygonOffset(le,J))):me(t.POLYGON_OFFSET_FILL)}function At(L){L?Z(t.SCISSOR_TEST):me(t.SCISSOR_TEST)}function Oe(L){L===void 0&&(L=t.TEXTURE0+B-1),ue!==L&&(t.activeTexture(L),ue=L)}function q(L,le,J){J===void 0&&(ue===null?J=t.TEXTURE0+B-1:J=ue);let xe=ve[J];xe===void 0&&(xe={type:void 0,texture:void 0},ve[J]=xe),(xe.type!==L||xe.texture!==le)&&(ue!==J&&(t.activeTexture(J),ue=J),t.bindTexture(L,le||G[L]),xe.type=L,xe.texture=le)}function de(){let L=ve[ue];L!==void 0&&L.type!==void 0&&(t.bindTexture(L.type,null),L.type=void 0,L.texture=void 0)}function dt(){try{t.compressedTexImage2D(...arguments)}catch(L){Ne("WebGLState:",L)}}function T(){try{t.compressedTexImage3D(...arguments)}catch(L){Ne("WebGLState:",L)}}function y(){try{t.texSubImage2D(...arguments)}catch(L){Ne("WebGLState:",L)}}function F(){try{t.texSubImage3D(...arguments)}catch(L){Ne("WebGLState:",L)}}function K(){try{t.compressedTexSubImage2D(...arguments)}catch(L){Ne("WebGLState:",L)}}function $(){try{t.compressedTexSubImage3D(...arguments)}catch(L){Ne("WebGLState:",L)}}function Q(){try{t.texStorage2D(...arguments)}catch(L){Ne("WebGLState:",L)}}function ne(){try{t.texStorage3D(...arguments)}catch(L){Ne("WebGLState:",L)}}function Y(){try{t.texImage2D(...arguments)}catch(L){Ne("WebGLState:",L)}}function j(){try{t.texImage3D(...arguments)}catch(L){Ne("WebGLState:",L)}}function he(L){return f[L]!==void 0?f[L]:t.getParameter(L)}function fe(L,le){f[L]!==le&&(t.pixelStorei(L,le),f[L]=le)}function ie(L){je.equals(L)===!1&&(t.scissor(L.x,L.y,L.z,L.w),je.copy(L))}function ae(L){De.equals(L)===!1&&(t.viewport(L.x,L.y,L.z,L.w),De.copy(L))}function Ee(L,le){let J=c.get(le);J===void 0&&(J=new WeakMap,c.set(le,J));let xe=J.get(L);xe===void 0&&(xe=t.getUniformBlockIndex(le,L.name),J.set(L,xe))}function He(L,le){let xe=c.get(le).get(L);l.get(le)!==xe&&(t.uniformBlockBinding(le,xe,L.__bindingPointIndex),l.set(le,xe))}function it(){t.disable(t.BLEND),t.disable(t.CULL_FACE),t.disable(t.DEPTH_TEST),t.disable(t.POLYGON_OFFSET_FILL),t.disable(t.SCISSOR_TEST),t.disable(t.STENCIL_TEST),t.disable(t.SAMPLE_ALPHA_TO_COVERAGE),t.blendEquation(t.FUNC_ADD),t.blendFunc(t.ONE,t.ZERO),t.blendFuncSeparate(t.ONE,t.ZERO,t.ONE,t.ZERO),t.blendColor(0,0,0,0),t.colorMask(!0,!0,!0,!0),t.clearColor(0,0,0,0),t.depthMask(!0),t.depthFunc(t.LESS),o.setReversed(!1),t.clearDepth(1),t.stencilMask(4294967295),t.stencilFunc(t.ALWAYS,0,4294967295),t.stencilOp(t.KEEP,t.KEEP,t.KEEP),t.clearStencil(0),t.cullFace(t.BACK),t.frontFace(t.CCW),t.polygonOffset(0,0),t.activeTexture(t.TEXTURE0),t.bindFramebuffer(t.FRAMEBUFFER,null),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),t.bindFramebuffer(t.READ_FRAMEBUFFER,null),t.useProgram(null),t.lineWidth(1),t.scissor(0,0,t.canvas.width,t.canvas.height),t.viewport(0,0,t.canvas.width,t.canvas.height),t.pixelStorei(t.PACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.BROWSER_DEFAULT_WEBGL),t.pixelStorei(t.PACK_ROW_LENGTH,0),t.pixelStorei(t.PACK_SKIP_PIXELS,0),t.pixelStorei(t.PACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_ROW_LENGTH,0),t.pixelStorei(t.UNPACK_IMAGE_HEIGHT,0),t.pixelStorei(t.UNPACK_SKIP_PIXELS,0),t.pixelStorei(t.UNPACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_SKIP_IMAGES,0),d={},f={},ue=null,ve={},h={},p=new WeakMap,_=[],S=null,g=!1,u=null,m=null,v=null,M=null,A=null,E=null,P=null,x=new Ge(0,0,0),R=0,C=!1,b=null,I=null,W=null,H=null,D=null,je.set(0,0,t.canvas.width,t.canvas.height),De.set(0,0,t.canvas.width,t.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:Z,disable:me,bindFramebuffer:be,drawBuffers:Ae,useProgram:ht,setBlending:ot,setMaterial:Ue,setFlipSided:lt,setCullFace:Ze,setLineWidth:Ot,setPolygonOffset:N,setScissorTest:At,activeTexture:Oe,bindTexture:q,unbindTexture:de,compressedTexImage2D:dt,compressedTexImage3D:T,texImage2D:Y,texImage3D:j,pixelStorei:fe,getParameter:he,updateUBOMapping:Ee,uniformBlockBinding:He,texStorage2D:Q,texStorage3D:ne,texSubImage2D:y,texSubImage3D:F,compressedTexSubImage2D:K,compressedTexSubImage3D:$,scissor:ie,viewport:ae,reset:it}}function vA(t,e,n,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Ke,d=new WeakMap,f=new Set,h,p=new WeakMap,_=!1;try{_=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function S(T,y){return _?new OffscreenCanvas(T,y):Ra("canvas")}function g(T,y,F){let K=1,$=dt(T);if(($.width>F||$.height>F)&&(K=F/Math.max($.width,$.height)),K<1)if(typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&T instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&T instanceof ImageBitmap||typeof VideoFrame<"u"&&T instanceof VideoFrame){let Q=Math.floor(K*$.width),ne=Math.floor(K*$.height);h===void 0&&(h=S(Q,ne));let Y=y?S(Q,ne):h;return Y.width=Q,Y.height=ne,Y.getContext("2d").drawImage(T,0,0,Q,ne),Ie("WebGLRenderer: Texture has been resized from ("+$.width+"x"+$.height+") to ("+Q+"x"+ne+")."),Y}else return"data"in T&&Ie("WebGLRenderer: Image in DataTexture is too big ("+$.width+"x"+$.height+")."),T;return T}function u(T){return T.generateMipmaps}function m(T){t.generateMipmap(T)}function v(T){return T.isWebGLCubeRenderTarget?t.TEXTURE_CUBE_MAP:T.isWebGL3DRenderTarget?t.TEXTURE_3D:T.isWebGLArrayRenderTarget||T.isCompressedArrayTexture?t.TEXTURE_2D_ARRAY:t.TEXTURE_2D}function M(T,y,F,K,$,Q=!1){if(T!==null){if(t[T]!==void 0)return t[T];Ie("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+T+"'")}let ne;K&&(ne=e.get("EXT_texture_norm16"),ne||Ie("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let Y=y;if(y===t.RED&&(F===t.FLOAT&&(Y=t.R32F),F===t.HALF_FLOAT&&(Y=t.R16F),F===t.UNSIGNED_BYTE&&(Y=t.R8),F===t.UNSIGNED_SHORT&&ne&&(Y=ne.R16_EXT),F===t.SHORT&&ne&&(Y=ne.R16_SNORM_EXT)),y===t.RED_INTEGER&&(F===t.UNSIGNED_BYTE&&(Y=t.R8UI),F===t.UNSIGNED_SHORT&&(Y=t.R16UI),F===t.UNSIGNED_INT&&(Y=t.R32UI),F===t.BYTE&&(Y=t.R8I),F===t.SHORT&&(Y=t.R16I),F===t.INT&&(Y=t.R32I)),y===t.RG&&(F===t.FLOAT&&(Y=t.RG32F),F===t.HALF_FLOAT&&(Y=t.RG16F),F===t.UNSIGNED_BYTE&&(Y=t.RG8),F===t.UNSIGNED_SHORT&&ne&&(Y=ne.RG16_EXT),F===t.SHORT&&ne&&(Y=ne.RG16_SNORM_EXT)),y===t.RG_INTEGER&&(F===t.UNSIGNED_BYTE&&(Y=t.RG8UI),F===t.UNSIGNED_SHORT&&(Y=t.RG16UI),F===t.UNSIGNED_INT&&(Y=t.RG32UI),F===t.BYTE&&(Y=t.RG8I),F===t.SHORT&&(Y=t.RG16I),F===t.INT&&(Y=t.RG32I)),y===t.RGB_INTEGER&&(F===t.UNSIGNED_BYTE&&(Y=t.RGB8UI),F===t.UNSIGNED_SHORT&&(Y=t.RGB16UI),F===t.UNSIGNED_INT&&(Y=t.RGB32UI),F===t.BYTE&&(Y=t.RGB8I),F===t.SHORT&&(Y=t.RGB16I),F===t.INT&&(Y=t.RGB32I)),y===t.RGBA_INTEGER&&(F===t.UNSIGNED_BYTE&&(Y=t.RGBA8UI),F===t.UNSIGNED_SHORT&&(Y=t.RGBA16UI),F===t.UNSIGNED_INT&&(Y=t.RGBA32UI),F===t.BYTE&&(Y=t.RGBA8I),F===t.SHORT&&(Y=t.RGBA16I),F===t.INT&&(Y=t.RGBA32I)),y===t.RGB&&(F===t.UNSIGNED_SHORT&&ne&&(Y=ne.RGB16_EXT),F===t.SHORT&&ne&&(Y=ne.RGB16_SNORM_EXT),F===t.UNSIGNED_INT_5_9_9_9_REV&&(Y=t.RGB9_E5),F===t.UNSIGNED_INT_10F_11F_11F_REV&&(Y=t.R11F_G11F_B10F)),y===t.RGBA){let j=Q?Ca:$e.getTransfer($);F===t.FLOAT&&(Y=t.RGBA32F),F===t.HALF_FLOAT&&(Y=t.RGBA16F),F===t.UNSIGNED_BYTE&&(Y=j===rt?t.SRGB8_ALPHA8:t.RGBA8),F===t.UNSIGNED_SHORT&&ne&&(Y=ne.RGBA16_EXT),F===t.SHORT&&ne&&(Y=ne.RGBA16_SNORM_EXT),F===t.UNSIGNED_SHORT_4_4_4_4&&(Y=t.RGBA4),F===t.UNSIGNED_SHORT_5_5_5_1&&(Y=t.RGB5_A1)}return(Y===t.R16F||Y===t.R32F||Y===t.RG16F||Y===t.RG32F||Y===t.RGBA16F||Y===t.RGBA32F)&&e.get("EXT_color_buffer_float"),Y}function A(T,y){let F;return T?y===null||y===ai||y===Mo?F=t.DEPTH24_STENCIL8:y===li?F=t.DEPTH32F_STENCIL8:y===So&&(F=t.DEPTH24_STENCIL8,Ie("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):y===null||y===ai||y===Mo?F=t.DEPTH_COMPONENT24:y===li?F=t.DEPTH_COMPONENT32F:y===So&&(F=t.DEPTH_COMPONENT16),F}function E(T,y){return u(T)===!0||T.isFramebufferTexture&&T.minFilter!==Xt&&T.minFilter!==Kt?Math.log2(Math.max(y.width,y.height))+1:T.mipmaps!==void 0&&T.mipmaps.length>0?T.mipmaps.length:T.isCompressedTexture&&Array.isArray(T.image)?y.mipmaps.length:1}function P(T){let y=T.target;y.removeEventListener("dispose",P),R(y),y.isVideoTexture&&d.delete(y),y.isHTMLTexture&&f.delete(y)}function x(T){let y=T.target;y.removeEventListener("dispose",x),b(y)}function R(T){let y=i.get(T);if(y.__webglInit===void 0)return;let F=T.source,K=p.get(F);if(K){let $=K[y.__cacheKey];$.usedTimes--,$.usedTimes===0&&C(T),Object.keys(K).length===0&&p.delete(F)}i.remove(T)}function C(T){let y=i.get(T);t.deleteTexture(y.__webglTexture);let F=T.source,K=p.get(F);delete K[y.__cacheKey],o.memory.textures--}function b(T){let y=i.get(T);if(T.depthTexture&&(T.depthTexture.dispose(),i.remove(T.depthTexture)),T.isWebGLCubeRenderTarget)for(let K=0;K<6;K++){if(Array.isArray(y.__webglFramebuffer[K]))for(let $=0;$<y.__webglFramebuffer[K].length;$++)t.deleteFramebuffer(y.__webglFramebuffer[K][$]);else t.deleteFramebuffer(y.__webglFramebuffer[K]);y.__webglDepthbuffer&&t.deleteRenderbuffer(y.__webglDepthbuffer[K])}else{if(Array.isArray(y.__webglFramebuffer))for(let K=0;K<y.__webglFramebuffer.length;K++)t.deleteFramebuffer(y.__webglFramebuffer[K]);else t.deleteFramebuffer(y.__webglFramebuffer);if(y.__webglDepthbuffer&&t.deleteRenderbuffer(y.__webglDepthbuffer),y.__webglMultisampledFramebuffer&&t.deleteFramebuffer(y.__webglMultisampledFramebuffer),y.__webglColorRenderbuffer)for(let K=0;K<y.__webglColorRenderbuffer.length;K++)y.__webglColorRenderbuffer[K]&&t.deleteRenderbuffer(y.__webglColorRenderbuffer[K]);y.__webglDepthRenderbuffer&&t.deleteRenderbuffer(y.__webglDepthRenderbuffer)}let F=T.textures;for(let K=0,$=F.length;K<$;K++){let Q=i.get(F[K]);Q.__webglTexture&&(t.deleteTexture(Q.__webglTexture),o.memory.textures--),i.remove(F[K])}i.remove(T)}let I=0;function W(){I=0}function H(){return I}function D(T){I=T}function B(){let T=I;return T>=r.maxTextures&&Ie("WebGLTextures: Trying to use "+T+" texture units while this GPU supports only "+r.maxTextures),I+=1,T}function k(T){let y=[];return y.push(T.wrapS),y.push(T.wrapT),y.push(T.wrapR||0),y.push(T.magFilter),y.push(T.minFilter),y.push(T.anisotropy),y.push(T.internalFormat),y.push(T.format),y.push(T.type),y.push(T.generateMipmaps),y.push(T.premultiplyAlpha),y.push(T.flipY),y.push(T.unpackAlignment),y.push(T.colorSpace),y.join()}function te(T,y){let F=i.get(T);if(T.isVideoTexture&&q(T),T.isRenderTargetTexture===!1&&T.isExternalTexture!==!0&&T.version>0&&F.__version!==T.version){let K=T.image;if(K===null)Ie("WebGLRenderer: Texture marked for update but no image data found.");else if(K.complete===!1)Ie("WebGLRenderer: Texture marked for update but image is incomplete");else{me(F,T,y);return}}else T.isExternalTexture&&(F.__webglTexture=T.sourceTexture?T.sourceTexture:null);n.bindTexture(t.TEXTURE_2D,F.__webglTexture,t.TEXTURE0+y)}function se(T,y){let F=i.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&F.__version!==T.version){me(F,T,y);return}else T.isExternalTexture&&(F.__webglTexture=T.sourceTexture?T.sourceTexture:null);n.bindTexture(t.TEXTURE_2D_ARRAY,F.__webglTexture,t.TEXTURE0+y)}function ue(T,y){let F=i.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&F.__version!==T.version){me(F,T,y);return}n.bindTexture(t.TEXTURE_3D,F.__webglTexture,t.TEXTURE0+y)}function ve(T,y){let F=i.get(T);if(T.isCubeDepthTexture!==!0&&T.version>0&&F.__version!==T.version){be(F,T,y);return}n.bindTexture(t.TEXTURE_CUBE_MAP,F.__webglTexture,t.TEXTURE0+y)}let we={[du]:t.REPEAT,[xi]:t.CLAMP_TO_EDGE,[fu]:t.MIRRORED_REPEAT},ze={[Xt]:t.NEAREST,[mx]:t.NEAREST_MIPMAP_NEAREST,[Za]:t.NEAREST_MIPMAP_LINEAR,[Kt]:t.LINEAR,[Gu]:t.LINEAR_MIPMAP_NEAREST,[Fr]:t.LINEAR_MIPMAP_LINEAR},je={[vx]:t.NEVER,[wx]:t.ALWAYS,[xx]:t.LESS,[bh]:t.LEQUAL,[yx]:t.EQUAL,[Ah]:t.GEQUAL,[Sx]:t.GREATER,[Mx]:t.NOTEQUAL};function De(T,y){if(y.type===li&&e.has("OES_texture_float_linear")===!1&&(y.magFilter===Kt||y.magFilter===Gu||y.magFilter===Za||y.magFilter===Fr||y.minFilter===Kt||y.minFilter===Gu||y.minFilter===Za||y.minFilter===Fr)&&Ie("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),t.texParameteri(T,t.TEXTURE_WRAP_S,we[y.wrapS]),t.texParameteri(T,t.TEXTURE_WRAP_T,we[y.wrapT]),(T===t.TEXTURE_3D||T===t.TEXTURE_2D_ARRAY)&&t.texParameteri(T,t.TEXTURE_WRAP_R,we[y.wrapR]),t.texParameteri(T,t.TEXTURE_MAG_FILTER,ze[y.magFilter]),t.texParameteri(T,t.TEXTURE_MIN_FILTER,ze[y.minFilter]),y.compareFunction&&(t.texParameteri(T,t.TEXTURE_COMPARE_MODE,t.COMPARE_REF_TO_TEXTURE),t.texParameteri(T,t.TEXTURE_COMPARE_FUNC,je[y.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(y.magFilter===Xt||y.minFilter!==Za&&y.minFilter!==Fr||y.type===li&&e.has("OES_texture_float_linear")===!1)return;if(y.anisotropy>1||i.get(y).__currentAnisotropy){let F=e.get("EXT_texture_filter_anisotropic");t.texParameterf(T,F.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(y.anisotropy,r.getMaxAnisotropy())),i.get(y).__currentAnisotropy=y.anisotropy}}}function ee(T,y){let F=!1;T.__webglInit===void 0&&(T.__webglInit=!0,y.addEventListener("dispose",P));let K=y.source,$=p.get(K);$===void 0&&($={},p.set(K,$));let Q=k(y);if(Q!==T.__cacheKey){$[Q]===void 0&&($[Q]={texture:t.createTexture(),usedTimes:0},o.memory.textures++,F=!0),$[Q].usedTimes++;let ne=$[T.__cacheKey];ne!==void 0&&($[T.__cacheKey].usedTimes--,ne.usedTimes===0&&C(y)),T.__cacheKey=Q,T.__webglTexture=$[Q].texture}return F}function G(T,y,F){return Math.floor(Math.floor(T/F)/y)}function Z(T,y,F,K){let Q=T.updateRanges;if(Q.length===0)n.texSubImage2D(t.TEXTURE_2D,0,0,0,y.width,y.height,F,K,y.data);else{Q.sort((fe,ie)=>fe.start-ie.start);let ne=0;for(let fe=1;fe<Q.length;fe++){let ie=Q[ne],ae=Q[fe],Ee=ie.start+ie.count,He=G(ae.start,y.width,4),it=G(ie.start,y.width,4);ae.start<=Ee+1&&He===it&&G(ae.start+ae.count-1,y.width,4)===He?ie.count=Math.max(ie.count,ae.start+ae.count-ie.start):(++ne,Q[ne]=ae)}Q.length=ne+1;let Y=n.getParameter(t.UNPACK_ROW_LENGTH),j=n.getParameter(t.UNPACK_SKIP_PIXELS),he=n.getParameter(t.UNPACK_SKIP_ROWS);n.pixelStorei(t.UNPACK_ROW_LENGTH,y.width);for(let fe=0,ie=Q.length;fe<ie;fe++){let ae=Q[fe],Ee=Math.floor(ae.start/4),He=Math.ceil(ae.count/4),it=Ee%y.width,L=Math.floor(Ee/y.width),le=He,J=1;n.pixelStorei(t.UNPACK_SKIP_PIXELS,it),n.pixelStorei(t.UNPACK_SKIP_ROWS,L),n.texSubImage2D(t.TEXTURE_2D,0,it,L,le,J,F,K,y.data)}T.clearUpdateRanges(),n.pixelStorei(t.UNPACK_ROW_LENGTH,Y),n.pixelStorei(t.UNPACK_SKIP_PIXELS,j),n.pixelStorei(t.UNPACK_SKIP_ROWS,he)}}function me(T,y,F){let K=t.TEXTURE_2D;(y.isDataArrayTexture||y.isCompressedArrayTexture)&&(K=t.TEXTURE_2D_ARRAY),y.isData3DTexture&&(K=t.TEXTURE_3D);let $=ee(T,y),Q=y.source;n.bindTexture(K,T.__webglTexture,t.TEXTURE0+F);let ne=i.get(Q);if(Q.version!==ne.__version||$===!0){if(n.activeTexture(t.TEXTURE0+F),(typeof ImageBitmap<"u"&&y.image instanceof ImageBitmap)===!1){let J=$e.getPrimaries($e.workingColorSpace),xe=y.colorSpace===ji?null:$e.getPrimaries(y.colorSpace),ce=y.colorSpace===ji||J===xe?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,y.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,ce)}n.pixelStorei(t.UNPACK_ALIGNMENT,y.unpackAlignment);let j=g(y.image,!1,r.maxTextureSize);j=de(y,j);let he=s.convert(y.format,y.colorSpace),fe=s.convert(y.type),ie=M(y.internalFormat,he,fe,y.normalized,y.colorSpace,y.isVideoTexture);De(K,y);let ae,Ee=y.mipmaps,He=y.isVideoTexture!==!0,it=ne.__version===void 0||$===!0,L=Q.dataReady,le=E(y,j);if(y.isDepthTexture)ie=A(y.format===Or,y.type),it&&(He?n.texStorage2D(t.TEXTURE_2D,1,ie,j.width,j.height):n.texImage2D(t.TEXTURE_2D,0,ie,j.width,j.height,0,he,fe,null));else if(y.isDataTexture)if(Ee.length>0){He&&it&&n.texStorage2D(t.TEXTURE_2D,le,ie,Ee[0].width,Ee[0].height);for(let J=0,xe=Ee.length;J<xe;J++)ae=Ee[J],He?L&&n.texSubImage2D(t.TEXTURE_2D,J,0,0,ae.width,ae.height,he,fe,ae.data):n.texImage2D(t.TEXTURE_2D,J,ie,ae.width,ae.height,0,he,fe,ae.data);y.generateMipmaps=!1}else He?(it&&n.texStorage2D(t.TEXTURE_2D,le,ie,j.width,j.height),L&&Z(y,j,he,fe)):n.texImage2D(t.TEXTURE_2D,0,ie,j.width,j.height,0,he,fe,j.data);else if(y.isCompressedTexture)if(y.isCompressedArrayTexture){He&&it&&n.texStorage3D(t.TEXTURE_2D_ARRAY,le,ie,Ee[0].width,Ee[0].height,j.depth);for(let J=0,xe=Ee.length;J<xe;J++)if(ae=Ee[J],y.format!==qn)if(he!==null)if(He){if(L)if(y.layerUpdates.size>0){let ce=cm(ae.width,ae.height,y.format,y.type);for(let re of y.layerUpdates){let Ce=ae.data.subarray(re*ce/ae.data.BYTES_PER_ELEMENT,(re+1)*ce/ae.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,J,0,0,re,ae.width,ae.height,1,he,Ce)}y.clearLayerUpdates()}else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,J,0,0,0,ae.width,ae.height,j.depth,he,ae.data)}else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY,J,ie,ae.width,ae.height,j.depth,0,ae.data,0,0);else Ie("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else He?L&&n.texSubImage3D(t.TEXTURE_2D_ARRAY,J,0,0,0,ae.width,ae.height,j.depth,he,fe,ae.data):n.texImage3D(t.TEXTURE_2D_ARRAY,J,ie,ae.width,ae.height,j.depth,0,he,fe,ae.data)}else{He&&it&&n.texStorage2D(t.TEXTURE_2D,le,ie,Ee[0].width,Ee[0].height);for(let J=0,xe=Ee.length;J<xe;J++)ae=Ee[J],y.format!==qn?he!==null?He?L&&n.compressedTexSubImage2D(t.TEXTURE_2D,J,0,0,ae.width,ae.height,he,ae.data):n.compressedTexImage2D(t.TEXTURE_2D,J,ie,ae.width,ae.height,0,ae.data):Ie("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):He?L&&n.texSubImage2D(t.TEXTURE_2D,J,0,0,ae.width,ae.height,he,fe,ae.data):n.texImage2D(t.TEXTURE_2D,J,ie,ae.width,ae.height,0,he,fe,ae.data)}else if(y.isDataArrayTexture)if(He){if(it&&n.texStorage3D(t.TEXTURE_2D_ARRAY,le,ie,j.width,j.height,j.depth),L)if(y.layerUpdates.size>0){let J=cm(j.width,j.height,y.format,y.type);for(let xe of y.layerUpdates){let ce=j.data.subarray(xe*J/j.data.BYTES_PER_ELEMENT,(xe+1)*J/j.data.BYTES_PER_ELEMENT);n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,xe,j.width,j.height,1,he,fe,ce)}y.clearLayerUpdates()}else n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,0,j.width,j.height,j.depth,he,fe,j.data)}else n.texImage3D(t.TEXTURE_2D_ARRAY,0,ie,j.width,j.height,j.depth,0,he,fe,j.data);else if(y.isData3DTexture)He?(it&&n.texStorage3D(t.TEXTURE_3D,le,ie,j.width,j.height,j.depth),L&&n.texSubImage3D(t.TEXTURE_3D,0,0,0,0,j.width,j.height,j.depth,he,fe,j.data)):n.texImage3D(t.TEXTURE_3D,0,ie,j.width,j.height,j.depth,0,he,fe,j.data);else if(y.isFramebufferTexture){if(it)if(He)n.texStorage2D(t.TEXTURE_2D,le,ie,j.width,j.height);else{let J=j.width,xe=j.height;for(let ce=0;ce<le;ce++)n.texImage2D(t.TEXTURE_2D,ce,ie,J,xe,0,he,fe,null),J>>=1,xe>>=1}}else if(y.isHTMLTexture){if("texElementImage2D"in t){let J=t.canvas;if(J.hasAttribute("layoutsubtree")||J.setAttribute("layoutsubtree","true"),j.parentNode!==J){J.appendChild(j),f.add(y),J.onpaint=Be=>{let Pt=Be.changedElements;for(let ct of f)Pt.includes(ct.image)&&(ct.needsUpdate=!0)},J.requestPaint();return}let xe=0,ce=t.RGBA,re=t.RGBA,Ce=t.UNSIGNED_BYTE;t.texElementImage2D(t.TEXTURE_2D,xe,ce,re,Ce,j),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE)}}else if(Ee.length>0){if(He&&it){let J=dt(Ee[0]);n.texStorage2D(t.TEXTURE_2D,le,ie,J.width,J.height)}for(let J=0,xe=Ee.length;J<xe;J++)ae=Ee[J],He?L&&n.texSubImage2D(t.TEXTURE_2D,J,0,0,he,fe,ae):n.texImage2D(t.TEXTURE_2D,J,ie,he,fe,ae);y.generateMipmaps=!1}else if(He){if(it){let J=dt(j);n.texStorage2D(t.TEXTURE_2D,le,ie,J.width,J.height)}L&&n.texSubImage2D(t.TEXTURE_2D,0,0,0,he,fe,j)}else n.texImage2D(t.TEXTURE_2D,0,ie,he,fe,j);u(y)&&m(K),ne.__version=Q.version,y.onUpdate&&y.onUpdate(y)}T.__version=y.version}function be(T,y,F){if(y.image.length!==6)return;let K=ee(T,y),$=y.source;n.bindTexture(t.TEXTURE_CUBE_MAP,T.__webglTexture,t.TEXTURE0+F);let Q=i.get($);if($.version!==Q.__version||K===!0){n.activeTexture(t.TEXTURE0+F);let ne=$e.getPrimaries($e.workingColorSpace),Y=y.colorSpace===ji?null:$e.getPrimaries(y.colorSpace),j=y.colorSpace===ji||ne===Y?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,y.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),n.pixelStorei(t.UNPACK_ALIGNMENT,y.unpackAlignment),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,j);let he=y.isCompressedTexture||y.image[0].isCompressedTexture,fe=y.image[0]&&y.image[0].isDataTexture,ie=[];for(let re=0;re<6;re++)!he&&!fe?ie[re]=g(y.image[re],!0,r.maxCubemapSize):ie[re]=fe?y.image[re].image:y.image[re],ie[re]=de(y,ie[re]);let ae=ie[0],Ee=s.convert(y.format,y.colorSpace),He=s.convert(y.type),it=M(y.internalFormat,Ee,He,y.normalized,y.colorSpace),L=y.isVideoTexture!==!0,le=Q.__version===void 0||K===!0,J=$.dataReady,xe=E(y,ae);De(t.TEXTURE_CUBE_MAP,y);let ce;if(he){L&&le&&n.texStorage2D(t.TEXTURE_CUBE_MAP,xe,it,ae.width,ae.height);for(let re=0;re<6;re++){ce=ie[re].mipmaps;for(let Ce=0;Ce<ce.length;Ce++){let Be=ce[Ce];y.format!==qn?Ee!==null?L?J&&n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,Ce,0,0,Be.width,Be.height,Ee,Be.data):n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,Ce,it,Be.width,Be.height,0,Be.data):Ie("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,Ce,0,0,Be.width,Be.height,Ee,He,Be.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,Ce,it,Be.width,Be.height,0,Ee,He,Be.data)}}}else{if(ce=y.mipmaps,L&&le){ce.length>0&&xe++;let re=dt(ie[0]);n.texStorage2D(t.TEXTURE_CUBE_MAP,xe,it,re.width,re.height)}for(let re=0;re<6;re++)if(fe){L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,0,0,0,ie[re].width,ie[re].height,Ee,He,ie[re].data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,0,it,ie[re].width,ie[re].height,0,Ee,He,ie[re].data);for(let Ce=0;Ce<ce.length;Ce++){let Pt=ce[Ce].image[re].image;L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,Ce+1,0,0,Pt.width,Pt.height,Ee,He,Pt.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,Ce+1,it,Pt.width,Pt.height,0,Ee,He,Pt.data)}}else{L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,0,0,0,Ee,He,ie[re]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,0,it,Ee,He,ie[re]);for(let Ce=0;Ce<ce.length;Ce++){let Be=ce[Ce];L?J&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,Ce+1,0,0,Ee,He,Be.image[re]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+re,Ce+1,it,Ee,He,Be.image[re])}}}u(y)&&m(t.TEXTURE_CUBE_MAP),Q.__version=$.version,y.onUpdate&&y.onUpdate(y)}T.__version=y.version}function Ae(T,y,F,K,$,Q){let ne=s.convert(F.format,F.colorSpace),Y=s.convert(F.type),j=M(F.internalFormat,ne,Y,F.normalized,F.colorSpace),he=i.get(y),fe=i.get(F);if(fe.__renderTarget=y,!he.__hasExternalTextures){let ie=Math.max(1,y.width>>Q),ae=Math.max(1,y.height>>Q);$===t.TEXTURE_3D||$===t.TEXTURE_2D_ARRAY?n.texImage3D($,Q,j,ie,ae,y.depth,0,ne,Y,null):n.texImage2D($,Q,j,ie,ae,0,ne,Y,null)}n.bindFramebuffer(t.FRAMEBUFFER,T),Oe(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,K,$,fe.__webglTexture,0,At(y)):($===t.TEXTURE_2D||$>=t.TEXTURE_CUBE_MAP_POSITIVE_X&&$<=t.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&t.framebufferTexture2D(t.FRAMEBUFFER,K,$,fe.__webglTexture,Q),n.bindFramebuffer(t.FRAMEBUFFER,null)}function ht(T,y,F){if(t.bindRenderbuffer(t.RENDERBUFFER,T),y.depthBuffer){let K=y.depthTexture,$=K&&K.isDepthTexture?K.type:null,Q=A(y.stencilBuffer,$),ne=y.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;Oe(y)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,At(y),Q,y.width,y.height):F?t.renderbufferStorageMultisample(t.RENDERBUFFER,At(y),Q,y.width,y.height):t.renderbufferStorage(t.RENDERBUFFER,Q,y.width,y.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,ne,t.RENDERBUFFER,T)}else{let K=y.textures;for(let $=0;$<K.length;$++){let Q=K[$],ne=s.convert(Q.format,Q.colorSpace),Y=s.convert(Q.type),j=M(Q.internalFormat,ne,Y,Q.normalized,Q.colorSpace);Oe(y)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,At(y),j,y.width,y.height):F?t.renderbufferStorageMultisample(t.RENDERBUFFER,At(y),j,y.width,y.height):t.renderbufferStorage(t.RENDERBUFFER,j,y.width,y.height)}}t.bindRenderbuffer(t.RENDERBUFFER,null)}function Ve(T,y,F){let K=y.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(t.FRAMEBUFFER,T),!(y.depthTexture&&y.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let $=i.get(y.depthTexture);if($.__renderTarget=y,(!$.__webglTexture||y.depthTexture.image.width!==y.width||y.depthTexture.image.height!==y.height)&&(y.depthTexture.image.width=y.width,y.depthTexture.image.height=y.height,y.depthTexture.needsUpdate=!0),K){if($.__webglInit===void 0&&($.__webglInit=!0,y.depthTexture.addEventListener("dispose",P)),$.__webglTexture===void 0){$.__webglTexture=t.createTexture(),n.bindTexture(t.TEXTURE_CUBE_MAP,$.__webglTexture),De(t.TEXTURE_CUBE_MAP,y.depthTexture);let he=s.convert(y.depthTexture.format),fe=s.convert(y.depthTexture.type),ie;y.depthTexture.format===yi?ie=t.DEPTH_COMPONENT24:y.depthTexture.format===Or&&(ie=t.DEPTH24_STENCIL8);for(let ae=0;ae<6;ae++)t.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+ae,0,ie,y.width,y.height,0,he,fe,null)}}else te(y.depthTexture,0);let Q=$.__webglTexture,ne=At(y),Y=K?t.TEXTURE_CUBE_MAP_POSITIVE_X+F:t.TEXTURE_2D,j=y.depthTexture.format===Or?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;if(y.depthTexture.format===yi)Oe(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,j,Y,Q,0,ne):t.framebufferTexture2D(t.FRAMEBUFFER,j,Y,Q,0);else if(y.depthTexture.format===Or)Oe(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,j,Y,Q,0,ne):t.framebufferTexture2D(t.FRAMEBUFFER,j,Y,Q,0);else throw new Error("Unknown depthTexture format")}function qe(T){let y=i.get(T),F=T.isWebGLCubeRenderTarget===!0;if(y.__boundDepthTexture!==T.depthTexture){let K=T.depthTexture;if(y.__depthDisposeCallback&&y.__depthDisposeCallback(),K){let $=()=>{delete y.__boundDepthTexture,delete y.__depthDisposeCallback,K.removeEventListener("dispose",$)};K.addEventListener("dispose",$),y.__depthDisposeCallback=$}y.__boundDepthTexture=K}if(T.depthTexture&&!y.__autoAllocateDepthBuffer)if(F)for(let K=0;K<6;K++)Ve(y.__webglFramebuffer[K],T,K);else{let K=T.texture.mipmaps;K&&K.length>0?Ve(y.__webglFramebuffer[0],T,0):Ve(y.__webglFramebuffer,T,0)}else if(F){y.__webglDepthbuffer=[];for(let K=0;K<6;K++)if(n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer[K]),y.__webglDepthbuffer[K]===void 0)y.__webglDepthbuffer[K]=t.createRenderbuffer(),ht(y.__webglDepthbuffer[K],T,!1);else{let $=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,Q=y.__webglDepthbuffer[K];t.bindRenderbuffer(t.RENDERBUFFER,Q),t.framebufferRenderbuffer(t.FRAMEBUFFER,$,t.RENDERBUFFER,Q)}}else{let K=T.texture.mipmaps;if(K&&K.length>0?n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer[0]):n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer),y.__webglDepthbuffer===void 0)y.__webglDepthbuffer=t.createRenderbuffer(),ht(y.__webglDepthbuffer,T,!1);else{let $=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,Q=y.__webglDepthbuffer;t.bindRenderbuffer(t.RENDERBUFFER,Q),t.framebufferRenderbuffer(t.FRAMEBUFFER,$,t.RENDERBUFFER,Q)}}n.bindFramebuffer(t.FRAMEBUFFER,null)}function ot(T,y,F){let K=i.get(T);y!==void 0&&Ae(K.__webglFramebuffer,T,T.texture,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,0),F!==void 0&&qe(T)}function Ue(T){let y=T.texture,F=i.get(T),K=i.get(y);T.addEventListener("dispose",x);let $=T.textures,Q=T.isWebGLCubeRenderTarget===!0,ne=$.length>1;if(ne||(K.__webglTexture===void 0&&(K.__webglTexture=t.createTexture()),K.__version=y.version,o.memory.textures++),Q){F.__webglFramebuffer=[];for(let Y=0;Y<6;Y++)if(y.mipmaps&&y.mipmaps.length>0){F.__webglFramebuffer[Y]=[];for(let j=0;j<y.mipmaps.length;j++)F.__webglFramebuffer[Y][j]=t.createFramebuffer()}else F.__webglFramebuffer[Y]=t.createFramebuffer()}else{if(y.mipmaps&&y.mipmaps.length>0){F.__webglFramebuffer=[];for(let Y=0;Y<y.mipmaps.length;Y++)F.__webglFramebuffer[Y]=t.createFramebuffer()}else F.__webglFramebuffer=t.createFramebuffer();if(ne)for(let Y=0,j=$.length;Y<j;Y++){let he=i.get($[Y]);he.__webglTexture===void 0&&(he.__webglTexture=t.createTexture(),o.memory.textures++)}if(T.samples>0&&Oe(T)===!1){F.__webglMultisampledFramebuffer=t.createFramebuffer(),F.__webglColorRenderbuffer=[],n.bindFramebuffer(t.FRAMEBUFFER,F.__webglMultisampledFramebuffer);for(let Y=0;Y<$.length;Y++){let j=$[Y];F.__webglColorRenderbuffer[Y]=t.createRenderbuffer(),t.bindRenderbuffer(t.RENDERBUFFER,F.__webglColorRenderbuffer[Y]);let he=s.convert(j.format,j.colorSpace),fe=s.convert(j.type),ie=M(j.internalFormat,he,fe,j.normalized,j.colorSpace,T.isXRRenderTarget===!0),ae=At(T);t.renderbufferStorageMultisample(t.RENDERBUFFER,ae,ie,T.width,T.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Y,t.RENDERBUFFER,F.__webglColorRenderbuffer[Y])}t.bindRenderbuffer(t.RENDERBUFFER,null),T.depthBuffer&&(F.__webglDepthRenderbuffer=t.createRenderbuffer(),ht(F.__webglDepthRenderbuffer,T,!0)),n.bindFramebuffer(t.FRAMEBUFFER,null)}}if(Q){n.bindTexture(t.TEXTURE_CUBE_MAP,K.__webglTexture),De(t.TEXTURE_CUBE_MAP,y);for(let Y=0;Y<6;Y++)if(y.mipmaps&&y.mipmaps.length>0)for(let j=0;j<y.mipmaps.length;j++)Ae(F.__webglFramebuffer[Y][j],T,y,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Y,j);else Ae(F.__webglFramebuffer[Y],T,y,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Y,0);u(y)&&m(t.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(ne){for(let Y=0,j=$.length;Y<j;Y++){let he=$[Y],fe=i.get(he),ie=t.TEXTURE_2D;(T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(ie=T.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(ie,fe.__webglTexture),De(ie,he),Ae(F.__webglFramebuffer,T,he,t.COLOR_ATTACHMENT0+Y,ie,0),u(he)&&m(ie)}n.unbindTexture()}else{let Y=t.TEXTURE_2D;if((T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(Y=T.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(Y,K.__webglTexture),De(Y,y),y.mipmaps&&y.mipmaps.length>0)for(let j=0;j<y.mipmaps.length;j++)Ae(F.__webglFramebuffer[j],T,y,t.COLOR_ATTACHMENT0,Y,j);else Ae(F.__webglFramebuffer,T,y,t.COLOR_ATTACHMENT0,Y,0);u(y)&&m(Y),n.unbindTexture()}T.depthBuffer&&qe(T)}function lt(T){let y=T.textures;for(let F=0,K=y.length;F<K;F++){let $=y[F];if(u($)){let Q=v(T),ne=i.get($).__webglTexture;n.bindTexture(Q,ne),m(Q),n.unbindTexture()}}}let Ze=[],Ot=[];function N(T){if(T.samples>0){if(Oe(T)===!1){let y=T.textures,F=T.width,K=T.height,$=t.COLOR_BUFFER_BIT,Q=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,ne=i.get(T),Y=y.length>1;if(Y)for(let he=0;he<y.length;he++)n.bindFramebuffer(t.FRAMEBUFFER,ne.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+he,t.RENDERBUFFER,null),n.bindFramebuffer(t.FRAMEBUFFER,ne.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+he,t.TEXTURE_2D,null,0);n.bindFramebuffer(t.READ_FRAMEBUFFER,ne.__webglMultisampledFramebuffer);let j=T.texture.mipmaps;j&&j.length>0?n.bindFramebuffer(t.DRAW_FRAMEBUFFER,ne.__webglFramebuffer[0]):n.bindFramebuffer(t.DRAW_FRAMEBUFFER,ne.__webglFramebuffer);for(let he=0;he<y.length;he++){if(T.resolveDepthBuffer&&(T.depthBuffer&&($|=t.DEPTH_BUFFER_BIT),T.stencilBuffer&&T.resolveStencilBuffer&&($|=t.STENCIL_BUFFER_BIT)),Y){t.framebufferRenderbuffer(t.READ_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.RENDERBUFFER,ne.__webglColorRenderbuffer[he]);let fe=i.get(y[he]).__webglTexture;t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,fe,0)}t.blitFramebuffer(0,0,F,K,0,0,F,K,$,t.NEAREST),l===!0&&(Ze.length=0,Ot.length=0,Ze.push(t.COLOR_ATTACHMENT0+he),T.depthBuffer&&T.resolveDepthBuffer===!1&&(Ze.push(Q),Ot.push(Q),t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,Ot)),t.invalidateFramebuffer(t.READ_FRAMEBUFFER,Ze))}if(n.bindFramebuffer(t.READ_FRAMEBUFFER,null),n.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),Y)for(let he=0;he<y.length;he++){n.bindFramebuffer(t.FRAMEBUFFER,ne.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+he,t.RENDERBUFFER,ne.__webglColorRenderbuffer[he]);let fe=i.get(y[he]).__webglTexture;n.bindFramebuffer(t.FRAMEBUFFER,ne.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+he,t.TEXTURE_2D,fe,0)}n.bindFramebuffer(t.DRAW_FRAMEBUFFER,ne.__webglMultisampledFramebuffer)}else if(T.depthBuffer&&T.resolveDepthBuffer===!1&&l){let y=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,[y])}}}function At(T){return Math.min(r.maxSamples,T.samples)}function Oe(T){let y=i.get(T);return T.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&y.__useRenderToTexture!==!1}function q(T){let y=o.render.frame;d.get(T)!==y&&(d.set(T,y),T.update())}function de(T,y){let F=T.colorSpace,K=T.format,$=T.type;return T.isCompressedTexture===!0||T.isVideoTexture===!0||F!==Aa&&F!==ji&&($e.getTransfer(F)===rt?(K!==qn||$!==Mn)&&Ie("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Ne("WebGLTextures: Unsupported texture color space:",F)),y}function dt(T){return typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement?(c.width=T.naturalWidth||T.width,c.height=T.naturalHeight||T.height):typeof VideoFrame<"u"&&T instanceof VideoFrame?(c.width=T.displayWidth,c.height=T.displayHeight):(c.width=T.width,c.height=T.height),c}this.allocateTextureUnit=B,this.resetTextureUnits=W,this.getTextureUnits=H,this.setTextureUnits=D,this.setTexture2D=te,this.setTexture2DArray=se,this.setTexture3D=ue,this.setTextureCube=ve,this.rebindTextures=ot,this.setupRenderTarget=Ue,this.updateRenderTargetMipmap=lt,this.updateMultisampleRenderTarget=N,this.setupDepthRenderbuffer=qe,this.setupFrameBufferTexture=Ae,this.useMultisampledRTT=Oe,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function xA(t,e){function n(i,r=ji){let s,o=$e.getTransfer(r);if(i===Mn)return t.UNSIGNED_BYTE;if(i===Xu)return t.UNSIGNED_SHORT_4_4_4_4;if(i===qu)return t.UNSIGNED_SHORT_5_5_5_1;if(i===jp)return t.UNSIGNED_INT_5_9_9_9_REV;if(i===Qp)return t.UNSIGNED_INT_10F_11F_11F_REV;if(i===Jp)return t.BYTE;if(i===Kp)return t.SHORT;if(i===So)return t.UNSIGNED_SHORT;if(i===Wu)return t.INT;if(i===ai)return t.UNSIGNED_INT;if(i===li)return t.FLOAT;if(i===Ai)return t.HALF_FLOAT;if(i===em)return t.ALPHA;if(i===tm)return t.RGB;if(i===qn)return t.RGBA;if(i===yi)return t.DEPTH_COMPONENT;if(i===Or)return t.DEPTH_STENCIL;if(i===nm)return t.RED;if(i===Yu)return t.RED_INTEGER;if(i===Br)return t.RG;if(i===Zu)return t.RG_INTEGER;if(i===$u)return t.RGBA_INTEGER;if(i===$a||i===Ja||i===Ka||i===ja)if(o===rt)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===$a)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===Ja)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===Ka)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===ja)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===$a)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===Ja)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===Ka)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===ja)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Ju||i===Ku||i===ju||i===Qu)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===Ju)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Ku)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===ju)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===Qu)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===eh||i===th||i===nh||i===ih||i===rh||i===Qa||i===sh)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===eh||i===th)return o===rt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===nh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===ih)return s.COMPRESSED_R11_EAC;if(i===rh)return s.COMPRESSED_SIGNED_R11_EAC;if(i===Qa)return s.COMPRESSED_RG11_EAC;if(i===sh)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===oh||i===ah||i===lh||i===ch||i===uh||i===hh||i===dh||i===fh||i===ph||i===mh||i===gh||i===_h||i===vh||i===xh)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===oh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===ah)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===lh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===ch)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===uh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===hh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===dh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===fh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===ph)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===mh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===gh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===_h)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===vh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===xh)return o===rt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===yh||i===Sh||i===Mh)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===yh)return o===rt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===Sh)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===Mh)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===wh||i===Eh||i===el||i===Th)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===wh)return s.COMPRESSED_RED_RGTC1_EXT;if(i===Eh)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===el)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===Th)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===Mo?t.UNSIGNED_INT_24_8:t[i]!==void 0?t[i]:null}return{convert:n}}var yA=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,SA=`
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

}`,Cm=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,n){if(this.texture===null){let i=new Oa(e.texture);(e.depthNear!==n.depthNear||e.depthFar!==n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let n=e.cameras[0].viewport,i=new Dn({vertexShader:yA,fragmentShader:SA,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new Ft(new ka(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Rm=class extends Si{constructor(e,n){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,c=null,d=null,f=null,h=null,p=null,_=null,S=typeof XRWebGLBinding<"u",g=new Cm,u={},m=n.getContextAttributes(),v=null,M=null,A=[],E=[],P=new Ke,x=null,R=new cn;R.viewport=new bt;let C=new cn;C.viewport=new bt;let b=[R,C],I=new ku,W=null,H=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(ee){let G=A[ee];return G===void 0&&(G=new uo,A[ee]=G),G.getTargetRaySpace()},this.getControllerGrip=function(ee){let G=A[ee];return G===void 0&&(G=new uo,A[ee]=G),G.getGripSpace()},this.getHand=function(ee){let G=A[ee];return G===void 0&&(G=new uo,A[ee]=G),G.getHandSpace()};function D(ee){let G=E.indexOf(ee.inputSource);if(G===-1)return;let Z=A[G];Z!==void 0&&(Z.update(ee.inputSource,ee.frame,c||o),Z.dispatchEvent({type:ee.type,data:ee.inputSource}))}function B(){r.removeEventListener("select",D),r.removeEventListener("selectstart",D),r.removeEventListener("selectend",D),r.removeEventListener("squeeze",D),r.removeEventListener("squeezestart",D),r.removeEventListener("squeezeend",D),r.removeEventListener("end",B),r.removeEventListener("inputsourceschange",k);for(let ee=0;ee<A.length;ee++){let G=E[ee];G!==null&&(E[ee]=null,A[ee].disconnect(G))}W=null,H=null,g.reset();for(let ee in u)delete u[ee];e.setRenderTarget(v),p=null,h=null,f=null,r=null,M=null,De.stop(),i.isPresenting=!1,e.setPixelRatio(x),e.setSize(P.width,P.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(ee){s=ee,i.isPresenting===!0&&Ie("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(ee){a=ee,i.isPresenting===!0&&Ie("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(ee){c=ee},this.getBaseLayer=function(){return h!==null?h:p},this.getBinding=function(){return f===null&&S&&(f=new XRWebGLBinding(r,n)),f},this.getFrame=function(){return _},this.getSession=function(){return r},this.setSession=async function(ee){if(r=ee,r!==null){if(v=e.getRenderTarget(),r.addEventListener("select",D),r.addEventListener("selectstart",D),r.addEventListener("selectend",D),r.addEventListener("squeeze",D),r.addEventListener("squeezestart",D),r.addEventListener("squeezeend",D),r.addEventListener("end",B),r.addEventListener("inputsourceschange",k),m.xrCompatible!==!0&&await n.makeXRCompatible(),x=e.getPixelRatio(),e.getSize(P),S&&"createProjectionLayer"in XRWebGLBinding.prototype){let Z=null,me=null,be=null;m.depth&&(be=m.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,Z=m.stencil?Or:yi,me=m.stencil?Mo:ai);let Ae={colorFormat:n.RGBA8,depthFormat:be,scaleFactor:s};f=this.getBinding(),h=f.createProjectionLayer(Ae),r.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),M=new Nn(h.textureWidth,h.textureHeight,{format:qn,type:Mn,depthTexture:new Ki(h.textureWidth,h.textureHeight,me,void 0,void 0,void 0,void 0,void 0,void 0,Z),stencilBuffer:m.stencil,colorSpace:e.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1})}else{let Z={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:s};p=new XRWebGLLayer(r,n,Z),r.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),M=new Nn(p.framebufferWidth,p.framebufferHeight,{format:qn,type:Mn,colorSpace:e.outputColorSpace,stencilBuffer:m.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}M.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),De.setContext(r),De.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return g.getDepthTexture()};function k(ee){for(let G=0;G<ee.removed.length;G++){let Z=ee.removed[G],me=E.indexOf(Z);me>=0&&(E[me]=null,A[me].disconnect(Z))}for(let G=0;G<ee.added.length;G++){let Z=ee.added[G],me=E.indexOf(Z);if(me===-1){for(let Ae=0;Ae<A.length;Ae++)if(Ae>=E.length){E.push(Z),me=Ae;break}else if(E[Ae]===null){E[Ae]=Z,me=Ae;break}if(me===-1)break}let be=A[me];be&&be.connect(Z)}}let te=new O,se=new O;function ue(ee,G,Z){te.setFromMatrixPosition(G.matrixWorld),se.setFromMatrixPosition(Z.matrixWorld);let me=te.distanceTo(se),be=G.projectionMatrix.elements,Ae=Z.projectionMatrix.elements,ht=be[14]/(be[10]-1),Ve=be[14]/(be[10]+1),qe=(be[9]+1)/be[5],ot=(be[9]-1)/be[5],Ue=(be[8]-1)/be[0],lt=(Ae[8]+1)/Ae[0],Ze=ht*Ue,Ot=ht*lt,N=me/(-Ue+lt),At=N*-Ue;if(G.matrixWorld.decompose(ee.position,ee.quaternion,ee.scale),ee.translateX(At),ee.translateZ(N),ee.matrixWorld.compose(ee.position,ee.quaternion,ee.scale),ee.matrixWorldInverse.copy(ee.matrixWorld).invert(),be[10]===-1)ee.projectionMatrix.copy(G.projectionMatrix),ee.projectionMatrixInverse.copy(G.projectionMatrixInverse);else{let Oe=ht+N,q=Ve+N,de=Ze-At,dt=Ot+(me-At),T=qe*Ve/q*Oe,y=ot*Ve/q*Oe;ee.projectionMatrix.makePerspective(de,dt,T,y,Oe,q),ee.projectionMatrixInverse.copy(ee.projectionMatrix).invert()}}function ve(ee,G){G===null?ee.matrixWorld.copy(ee.matrix):ee.matrixWorld.multiplyMatrices(G.matrixWorld,ee.matrix),ee.matrixWorldInverse.copy(ee.matrixWorld).invert()}this.updateCamera=function(ee){if(r===null)return;let G=ee.near,Z=ee.far;g.texture!==null&&(g.depthNear>0&&(G=g.depthNear),g.depthFar>0&&(Z=g.depthFar)),I.near=C.near=R.near=G,I.far=C.far=R.far=Z,(W!==I.near||H!==I.far)&&(r.updateRenderState({depthNear:I.near,depthFar:I.far}),W=I.near,H=I.far),I.layers.mask=ee.layers.mask|6,R.layers.mask=I.layers.mask&-5,C.layers.mask=I.layers.mask&-3;let me=ee.parent,be=I.cameras;ve(I,me);for(let Ae=0;Ae<be.length;Ae++)ve(be[Ae],me);be.length===2?ue(I,R,C):I.projectionMatrix.copy(R.projectionMatrix),we(ee,I,me)};function we(ee,G,Z){Z===null?ee.matrix.copy(G.matrixWorld):(ee.matrix.copy(Z.matrixWorld),ee.matrix.invert(),ee.matrix.multiply(G.matrixWorld)),ee.matrix.decompose(ee.position,ee.quaternion,ee.scale),ee.updateMatrixWorld(!0),ee.projectionMatrix.copy(G.projectionMatrix),ee.projectionMatrixInverse.copy(G.projectionMatrixInverse),ee.isPerspectiveCamera&&(ee.fov=lo*2*Math.atan(1/ee.projectionMatrix.elements[5]),ee.zoom=1)}this.getCamera=function(){return I},this.getFoveation=function(){if(!(h===null&&p===null))return l},this.setFoveation=function(ee){l=ee,h!==null&&(h.fixedFoveation=ee),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=ee)},this.hasDepthSensing=function(){return g.texture!==null},this.getDepthSensingMesh=function(){return g.getMesh(I)},this.getCameraTexture=function(ee){return u[ee]};let ze=null;function je(ee,G){if(d=G.getViewerPose(c||o),_=G,d!==null){let Z=d.views;p!==null&&(e.setRenderTargetFramebuffer(M,p.framebuffer),e.setRenderTarget(M));let me=!1;Z.length!==I.cameras.length&&(I.cameras.length=0,me=!0);for(let Ve=0;Ve<Z.length;Ve++){let qe=Z[Ve],ot=null;if(p!==null)ot=p.getViewport(qe);else{let lt=f.getViewSubImage(h,qe);ot=lt.viewport,Ve===0&&(e.setRenderTargetTextures(M,lt.colorTexture,lt.depthStencilTexture),e.setRenderTarget(M))}let Ue=b[Ve];Ue===void 0&&(Ue=new cn,Ue.layers.enable(Ve),Ue.viewport=new bt,b[Ve]=Ue),Ue.matrix.fromArray(qe.transform.matrix),Ue.matrix.decompose(Ue.position,Ue.quaternion,Ue.scale),Ue.projectionMatrix.fromArray(qe.projectionMatrix),Ue.projectionMatrixInverse.copy(Ue.projectionMatrix).invert(),Ue.viewport.set(ot.x,ot.y,ot.width,ot.height),Ve===0&&(I.matrix.copy(Ue.matrix),I.matrix.decompose(I.position,I.quaternion,I.scale)),me===!0&&I.cameras.push(Ue)}let be=r.enabledFeatures;if(be&&be.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&S){f=i.getBinding();let Ve=f.getDepthInformation(Z[0]);Ve&&Ve.isValid&&Ve.texture&&g.init(Ve,r.renderState)}if(be&&be.includes("camera-access")&&S){e.state.unbindTexture(),f=i.getBinding();for(let Ve=0;Ve<Z.length;Ve++){let qe=Z[Ve].camera;if(qe){let ot=u[qe];ot||(ot=new Oa,u[qe]=ot);let Ue=f.getCameraImage(qe);ot.sourceTexture=Ue}}}}for(let Z=0;Z<A.length;Z++){let me=E[Z],be=A[Z];me!==null&&be!==void 0&&be.update(me,G,c||o)}ze&&ze(ee,G),G.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:G}),_=null}let De=new Qx;De.setAnimationLoop(je),this.setAnimationLoop=function(ee){ze=ee},this.dispose=function(){}}},MA=new Tt,sy=new Fe;sy.set(-1,0,0,0,1,0,0,0,1);function wA(t,e){function n(g,u){g.matrixAutoUpdate===!0&&g.updateMatrix(),u.value.copy(g.matrix)}function i(g,u){u.color.getRGB(g.fogColor.value,om(t)),u.isFog?(g.fogNear.value=u.near,g.fogFar.value=u.far):u.isFogExp2&&(g.fogDensity.value=u.density)}function r(g,u,m,v,M){u.isNodeMaterial?u.uniformsNeedUpdate=!1:u.isMeshBasicMaterial?s(g,u):u.isMeshLambertMaterial?(s(g,u),u.envMap&&(g.envMapIntensity.value=u.envMapIntensity)):u.isMeshToonMaterial?(s(g,u),f(g,u)):u.isMeshPhongMaterial?(s(g,u),d(g,u),u.envMap&&(g.envMapIntensity.value=u.envMapIntensity)):u.isMeshStandardMaterial?(s(g,u),h(g,u),u.isMeshPhysicalMaterial&&p(g,u,M)):u.isMeshMatcapMaterial?(s(g,u),_(g,u)):u.isMeshDepthMaterial?s(g,u):u.isMeshDistanceMaterial?(s(g,u),S(g,u)):u.isMeshNormalMaterial?s(g,u):u.isLineBasicMaterial?(o(g,u),u.isLineDashedMaterial&&a(g,u)):u.isPointsMaterial?l(g,u,m,v):u.isSpriteMaterial?c(g,u):u.isShadowMaterial?(g.color.value.copy(u.color),g.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function s(g,u){g.opacity.value=u.opacity,u.color&&g.diffuse.value.copy(u.color),u.emissive&&g.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(g.map.value=u.map,n(u.map,g.mapTransform)),u.alphaMap&&(g.alphaMap.value=u.alphaMap,n(u.alphaMap,g.alphaMapTransform)),u.bumpMap&&(g.bumpMap.value=u.bumpMap,n(u.bumpMap,g.bumpMapTransform),g.bumpScale.value=u.bumpScale,u.side===Qt&&(g.bumpScale.value*=-1)),u.normalMap&&(g.normalMap.value=u.normalMap,n(u.normalMap,g.normalMapTransform),g.normalScale.value.copy(u.normalScale),u.side===Qt&&g.normalScale.value.negate()),u.displacementMap&&(g.displacementMap.value=u.displacementMap,n(u.displacementMap,g.displacementMapTransform),g.displacementScale.value=u.displacementScale,g.displacementBias.value=u.displacementBias),u.emissiveMap&&(g.emissiveMap.value=u.emissiveMap,n(u.emissiveMap,g.emissiveMapTransform)),u.specularMap&&(g.specularMap.value=u.specularMap,n(u.specularMap,g.specularMapTransform)),u.alphaTest>0&&(g.alphaTest.value=u.alphaTest);let m=e.get(u),v=m.envMap,M=m.envMapRotation;v&&(g.envMap.value=v,g.envMapRotation.value.setFromMatrix4(MA.makeRotationFromEuler(M)).transpose(),v.isCubeTexture&&v.isRenderTargetTexture===!1&&g.envMapRotation.value.premultiply(sy),g.reflectivity.value=u.reflectivity,g.ior.value=u.ior,g.refractionRatio.value=u.refractionRatio),u.lightMap&&(g.lightMap.value=u.lightMap,g.lightMapIntensity.value=u.lightMapIntensity,n(u.lightMap,g.lightMapTransform)),u.aoMap&&(g.aoMap.value=u.aoMap,g.aoMapIntensity.value=u.aoMapIntensity,n(u.aoMap,g.aoMapTransform))}function o(g,u){g.diffuse.value.copy(u.color),g.opacity.value=u.opacity,u.map&&(g.map.value=u.map,n(u.map,g.mapTransform))}function a(g,u){g.dashSize.value=u.dashSize,g.totalSize.value=u.dashSize+u.gapSize,g.scale.value=u.scale}function l(g,u,m,v){g.diffuse.value.copy(u.color),g.opacity.value=u.opacity,g.size.value=u.size*m,g.scale.value=v*.5,u.map&&(g.map.value=u.map,n(u.map,g.uvTransform)),u.alphaMap&&(g.alphaMap.value=u.alphaMap,n(u.alphaMap,g.alphaMapTransform)),u.alphaTest>0&&(g.alphaTest.value=u.alphaTest)}function c(g,u){g.diffuse.value.copy(u.color),g.opacity.value=u.opacity,g.rotation.value=u.rotation,u.map&&(g.map.value=u.map,n(u.map,g.mapTransform)),u.alphaMap&&(g.alphaMap.value=u.alphaMap,n(u.alphaMap,g.alphaMapTransform)),u.alphaTest>0&&(g.alphaTest.value=u.alphaTest)}function d(g,u){g.specular.value.copy(u.specular),g.shininess.value=Math.max(u.shininess,1e-4)}function f(g,u){u.gradientMap&&(g.gradientMap.value=u.gradientMap)}function h(g,u){g.metalness.value=u.metalness,u.metalnessMap&&(g.metalnessMap.value=u.metalnessMap,n(u.metalnessMap,g.metalnessMapTransform)),g.roughness.value=u.roughness,u.roughnessMap&&(g.roughnessMap.value=u.roughnessMap,n(u.roughnessMap,g.roughnessMapTransform)),u.envMap&&(g.envMapIntensity.value=u.envMapIntensity)}function p(g,u,m){g.ior.value=u.ior,u.sheen>0&&(g.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),g.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(g.sheenColorMap.value=u.sheenColorMap,n(u.sheenColorMap,g.sheenColorMapTransform)),u.sheenRoughnessMap&&(g.sheenRoughnessMap.value=u.sheenRoughnessMap,n(u.sheenRoughnessMap,g.sheenRoughnessMapTransform))),u.clearcoat>0&&(g.clearcoat.value=u.clearcoat,g.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(g.clearcoatMap.value=u.clearcoatMap,n(u.clearcoatMap,g.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,n(u.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(g.clearcoatNormalMap.value=u.clearcoatNormalMap,n(u.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===Qt&&g.clearcoatNormalScale.value.negate())),u.dispersion>0&&(g.dispersion.value=u.dispersion),u.iridescence>0&&(g.iridescence.value=u.iridescence,g.iridescenceIOR.value=u.iridescenceIOR,g.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],g.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(g.iridescenceMap.value=u.iridescenceMap,n(u.iridescenceMap,g.iridescenceMapTransform)),u.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=u.iridescenceThicknessMap,n(u.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),u.transmission>0&&(g.transmission.value=u.transmission,g.transmissionSamplerMap.value=m.texture,g.transmissionSamplerSize.value.set(m.width,m.height),u.transmissionMap&&(g.transmissionMap.value=u.transmissionMap,n(u.transmissionMap,g.transmissionMapTransform)),g.thickness.value=u.thickness,u.thicknessMap&&(g.thicknessMap.value=u.thicknessMap,n(u.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=u.attenuationDistance,g.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(g.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(g.anisotropyMap.value=u.anisotropyMap,n(u.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=u.specularIntensity,g.specularColor.value.copy(u.specularColor),u.specularColorMap&&(g.specularColorMap.value=u.specularColorMap,n(u.specularColorMap,g.specularColorMapTransform)),u.specularIntensityMap&&(g.specularIntensityMap.value=u.specularIntensityMap,n(u.specularIntensityMap,g.specularIntensityMapTransform))}function _(g,u){u.matcap&&(g.matcap.value=u.matcap)}function S(g,u){let m=e.get(u).light;g.referencePosition.value.setFromMatrixPosition(m.matrixWorld),g.nearDistance.value=m.shadow.camera.near,g.farDistance.value=m.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function EA(t,e,n,i){let r={},s={},o=[],a=t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);function l(m,v){let M=v.program;i.uniformBlockBinding(m,M)}function c(m,v){let M=r[m.id];M===void 0&&(_(m),M=d(m),r[m.id]=M,m.addEventListener("dispose",g));let A=v.program;i.updateUBOMapping(m,A);let E=e.render.frame;s[m.id]!==E&&(h(m),s[m.id]=E)}function d(m){let v=f();m.__bindingPointIndex=v;let M=t.createBuffer(),A=m.__size,E=m.usage;return t.bindBuffer(t.UNIFORM_BUFFER,M),t.bufferData(t.UNIFORM_BUFFER,A,E),t.bindBuffer(t.UNIFORM_BUFFER,null),t.bindBufferBase(t.UNIFORM_BUFFER,v,M),M}function f(){for(let m=0;m<a;m++)if(o.indexOf(m)===-1)return o.push(m),m;return Ne("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(m){let v=r[m.id],M=m.uniforms,A=m.__cache;t.bindBuffer(t.UNIFORM_BUFFER,v);for(let E=0,P=M.length;E<P;E++){let x=Array.isArray(M[E])?M[E]:[M[E]];for(let R=0,C=x.length;R<C;R++){let b=x[R];if(p(b,E,R,A)===!0){let I=b.__offset,W=Array.isArray(b.value)?b.value:[b.value],H=0;for(let D=0;D<W.length;D++){let B=W[D],k=S(B);typeof B=="number"||typeof B=="boolean"?(b.__data[0]=B,t.bufferSubData(t.UNIFORM_BUFFER,I+H,b.__data)):B.isMatrix3?(b.__data[0]=B.elements[0],b.__data[1]=B.elements[1],b.__data[2]=B.elements[2],b.__data[3]=0,b.__data[4]=B.elements[3],b.__data[5]=B.elements[4],b.__data[6]=B.elements[5],b.__data[7]=0,b.__data[8]=B.elements[6],b.__data[9]=B.elements[7],b.__data[10]=B.elements[8],b.__data[11]=0):ArrayBuffer.isView(B)?b.__data.set(new B.constructor(B.buffer,B.byteOffset,b.__data.length)):(B.toArray(b.__data,H),H+=k.storage/Float32Array.BYTES_PER_ELEMENT)}t.bufferSubData(t.UNIFORM_BUFFER,I,b.__data)}}}t.bindBuffer(t.UNIFORM_BUFFER,null)}function p(m,v,M,A){let E=m.value,P=v+"_"+M;if(A[P]===void 0)return typeof E=="number"||typeof E=="boolean"?A[P]=E:ArrayBuffer.isView(E)?A[P]=E.slice():A[P]=E.clone(),!0;{let x=A[P];if(typeof E=="number"||typeof E=="boolean"){if(x!==E)return A[P]=E,!0}else{if(ArrayBuffer.isView(E))return!0;if(x.equals(E)===!1)return x.copy(E),!0}}return!1}function _(m){let v=m.uniforms,M=0,A=16;for(let P=0,x=v.length;P<x;P++){let R=Array.isArray(v[P])?v[P]:[v[P]];for(let C=0,b=R.length;C<b;C++){let I=R[C],W=Array.isArray(I.value)?I.value:[I.value];for(let H=0,D=W.length;H<D;H++){let B=W[H],k=S(B),te=M%A,se=te%k.boundary,ue=te+se;M+=se,ue!==0&&A-ue<k.storage&&(M+=A-ue),I.__data=new Float32Array(k.storage/Float32Array.BYTES_PER_ELEMENT),I.__offset=M,M+=k.storage}}}let E=M%A;return E>0&&(M+=A-E),m.__size=M,m.__cache={},this}function S(m){let v={boundary:0,storage:0};return typeof m=="number"||typeof m=="boolean"?(v.boundary=4,v.storage=4):m.isVector2?(v.boundary=8,v.storage=8):m.isVector3||m.isColor?(v.boundary=16,v.storage=12):m.isVector4?(v.boundary=16,v.storage=16):m.isMatrix3?(v.boundary=48,v.storage=48):m.isMatrix4?(v.boundary=64,v.storage=64):m.isTexture?Ie("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(m)?(v.boundary=16,v.storage=m.byteLength):Ie("WebGLRenderer: Unsupported uniform value type.",m),v}function g(m){let v=m.target;v.removeEventListener("dispose",g);let M=o.indexOf(v.__bindingPointIndex);o.splice(M,1),t.deleteBuffer(r[v.id]),delete r[v.id],delete s[v.id]}function u(){for(let m in r)t.deleteBuffer(r[m]);o=[],r={},s={}}return{bind:l,update:c,dispose:u}}var TA=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Ci=null;function bA(){return Ci===null&&(Ci=new xu(TA,16,16,Br,Ai),Ci.name="DFG_LUT",Ci.minFilter=Kt,Ci.magFilter=Kt,Ci.wrapS=xi,Ci.wrapT=xi,Ci.generateMipmaps=!1,Ci.needsUpdate=!0),Ci}var sl=class{constructor(e={}){let{canvas:n=Ex(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:d="default",failIfMajorPerformanceCaveat:f=!1,reversedDepthBuffer:h=!1,outputBufferType:p=Mn}=e;this.isWebGLRenderer=!0;let _;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");_=i.getContextAttributes().alpha}else _=o;let S=p,g=new Set([$u,Zu,Yu]),u=new Set([Mn,ai,So,Mo,Xu,qu]),m=new Uint32Array(4),v=new Int32Array(4),M=new O,A=null,E=null,P=[],x=[],R=null;this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=oi,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let C=this,b=!1,I=null;this._outputColorSpace=Jt;let W=0,H=0,D=null,B=-1,k=null,te=new bt,se=new bt,ue=null,ve=new Ge(0),we=0,ze=n.width,je=n.height,De=1,ee=null,G=null,Z=new bt(0,0,ze,je),me=new bt(0,0,ze,je),be=!1,Ae=new fo,ht=!1,Ve=!1,qe=new Tt,ot=new O,Ue=new bt,lt={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},Ze=!1;function Ot(){return D===null?De:1}let N=i;function At(w,U){return n.getContext(w,U)}try{let w={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:d,failIfMajorPerformanceCaveat:f};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${"184"}`),n.addEventListener("webglcontextlost",re,!1),n.addEventListener("webglcontextrestored",Ce,!1),n.addEventListener("webglcontextcreationerror",Be,!1),N===null){let U="webgl2";if(N=At(U,w),N===null)throw At(U)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(w){throw Ne("WebGLRenderer: "+w.message),w}let Oe,q,de,dt,T,y,F,K,$,Q,ne,Y,j,he,fe,ie,ae,Ee,He,it,L,le,J;function xe(){Oe=new NT(N),Oe.init(),L=new xA(N,Oe),q=new TT(N,Oe,e,L),de=new _A(N,Oe),q.reversedDepthBuffer&&h&&de.buffers.depth.setReversed(!0),dt=new FT(N),T=new iA,y=new vA(N,Oe,de,T,q,L,dt),F=new LT(C),K=new z1(N),le=new wT(N,K),$=new DT(N,K,dt,le),Q=new BT(N,$,K,le,dt),Ee=new OT(N,q,y),fe=new bT(T),ne=new nA(C,F,Oe,q,le,fe),Y=new wA(C,T),j=new sA,he=new hA(Oe),ae=new MT(C,F,de,Q,_,l),ie=new gA(C,Q,q),J=new EA(N,dt,q,de),He=new ET(N,Oe,dt),it=new UT(N,Oe,dt),dt.programs=ne.programs,C.capabilities=q,C.extensions=Oe,C.properties=T,C.renderLists=j,C.shadowMap=ie,C.state=de,C.info=dt}xe(),S!==Mn&&(R=new zT(S,n.width,n.height,r,s));let ce=new Rm(C,N);this.xr=ce,this.getContext=function(){return N},this.getContextAttributes=function(){return N.getContextAttributes()},this.forceContextLoss=function(){let w=Oe.get("WEBGL_lose_context");w&&w.loseContext()},this.forceContextRestore=function(){let w=Oe.get("WEBGL_lose_context");w&&w.restoreContext()},this.getPixelRatio=function(){return De},this.setPixelRatio=function(w){w!==void 0&&(De=w,this.setSize(ze,je,!1))},this.getSize=function(w){return w.set(ze,je)},this.setSize=function(w,U,X=!0){if(ce.isPresenting){Ie("WebGLRenderer: Can't change size while VR device is presenting.");return}ze=w,je=U,n.width=Math.floor(w*De),n.height=Math.floor(U*De),X===!0&&(n.style.width=w+"px",n.style.height=U+"px"),R!==null&&R.setSize(n.width,n.height),this.setViewport(0,0,w,U)},this.getDrawingBufferSize=function(w){return w.set(ze*De,je*De).floor()},this.setDrawingBufferSize=function(w,U,X){ze=w,je=U,De=X,n.width=Math.floor(w*X),n.height=Math.floor(U*X),this.setViewport(0,0,w,U)},this.setEffects=function(w){if(S===Mn){Ne("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(w){for(let U=0;U<w.length;U++)if(w[U].isOutputPass===!0){Ie("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}R.setEffects(w||[])},this.getCurrentViewport=function(w){return w.copy(te)},this.getViewport=function(w){return w.copy(Z)},this.setViewport=function(w,U,X,z){w.isVector4?Z.set(w.x,w.y,w.z,w.w):Z.set(w,U,X,z),de.viewport(te.copy(Z).multiplyScalar(De).round())},this.getScissor=function(w){return w.copy(me)},this.setScissor=function(w,U,X,z){w.isVector4?me.set(w.x,w.y,w.z,w.w):me.set(w,U,X,z),de.scissor(se.copy(me).multiplyScalar(De).round())},this.getScissorTest=function(){return be},this.setScissorTest=function(w){de.setScissorTest(be=w)},this.setOpaqueSort=function(w){ee=w},this.setTransparentSort=function(w){G=w},this.getClearColor=function(w){return w.copy(ae.getClearColor())},this.setClearColor=function(){ae.setClearColor(...arguments)},this.getClearAlpha=function(){return ae.getClearAlpha()},this.setClearAlpha=function(){ae.setClearAlpha(...arguments)},this.clear=function(w=!0,U=!0,X=!0){let z=0;if(w){let V=!1;if(D!==null){let _e=D.texture.format;V=g.has(_e)}if(V){let _e=D.texture.type,Se=u.has(_e),ge=ae.getClearColor(),Te=ae.getClearAlpha(),Re=ge.r,ke=ge.g,Xe=ge.b;Se?(m[0]=Re,m[1]=ke,m[2]=Xe,m[3]=Te,N.clearBufferuiv(N.COLOR,0,m)):(v[0]=Re,v[1]=ke,v[2]=Xe,v[3]=Te,N.clearBufferiv(N.COLOR,0,v))}else z|=N.COLOR_BUFFER_BIT}U&&(z|=N.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),X&&(z|=N.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),z!==0&&N.clear(z)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(w){w.setRenderer(this),I=w},this.dispose=function(){n.removeEventListener("webglcontextlost",re,!1),n.removeEventListener("webglcontextrestored",Ce,!1),n.removeEventListener("webglcontextcreationerror",Be,!1),ae.dispose(),j.dispose(),he.dispose(),T.dispose(),F.dispose(),Q.dispose(),le.dispose(),J.dispose(),ne.dispose(),ce.dispose(),ce.removeEventListener("sessionstart",Lm),ce.removeEventListener("sessionend",Nm),Vr.stop()};function re(w){w.preventDefault(),rm("WebGLRenderer: Context Lost."),b=!0}function Ce(){rm("WebGLRenderer: Context Restored."),b=!1;let w=dt.autoReset,U=ie.enabled,X=ie.autoUpdate,z=ie.needsUpdate,V=ie.type;xe(),dt.autoReset=w,ie.enabled=U,ie.autoUpdate=X,ie.needsUpdate=z,ie.type=V}function Be(w){Ne("WebGLRenderer: A WebGL context could not be created. Reason: ",w.statusMessage)}function Pt(w){let U=w.target;U.removeEventListener("dispose",Pt),ct(U)}function ct(w){Pi(w),T.remove(w)}function Pi(w){let U=T.get(w).programs;U!==void 0&&(U.forEach(function(X){ne.releaseProgram(X)}),w.isShaderMaterial&&ne.releaseShaderCache(w))}this.renderBufferDirect=function(w,U,X,z,V,_e){U===null&&(U=lt);let Se=V.isMesh&&V.matrixWorld.determinant()<0,ge=gy(w,U,X,z,V);de.setMaterial(z,Se);let Te=X.index,Re=1;if(z.wireframe===!0){if(Te=$.getWireframeAttribute(X),Te===void 0)return;Re=2}let ke=X.drawRange,Xe=X.attributes.position,Pe=ke.start*Re,ut=(ke.start+ke.count)*Re;_e!==null&&(Pe=Math.max(Pe,_e.start*Re),ut=Math.min(ut,(_e.start+_e.count)*Re)),Te!==null?(Pe=Math.max(Pe,0),ut=Math.min(ut,Te.count)):Xe!=null&&(Pe=Math.max(Pe,0),ut=Math.min(ut,Xe.count));let It=ut-Pe;if(It<0||It===1/0)return;le.setup(V,z,ge,X,Te);let Ct,ft=He;if(Te!==null&&(Ct=K.get(Te),ft=it,ft.setIndex(Ct)),V.isMesh)z.wireframe===!0?(de.setLineWidth(z.wireframeLinewidth*Ot()),ft.setMode(N.LINES)):ft.setMode(N.TRIANGLES);else if(V.isLine){let en=z.linewidth;en===void 0&&(en=1),de.setLineWidth(en*Ot()),V.isLineSegments?ft.setMode(N.LINES):V.isLineLoop?ft.setMode(N.LINE_LOOP):ft.setMode(N.LINE_STRIP)}else V.isPoints?ft.setMode(N.POINTS):V.isSprite&&ft.setMode(N.TRIANGLES);if(V.isBatchedMesh)if(Oe.get("WEBGL_multi_draw"))ft.renderMultiDraw(V._multiDrawStarts,V._multiDrawCounts,V._multiDrawCount);else{let en=V._multiDrawStarts,ye=V._multiDrawCounts,wn=V._multiDrawCount,Qe=Te?K.get(Te).bytesPerElement:1,Fn=T.get(z).currentProgram.getUniforms();for(let ui=0;ui<wn;ui++)Fn.setValue(N,"_gl_DrawID",ui),ft.render(en[ui]/Qe,ye[ui])}else if(V.isInstancedMesh)ft.renderInstances(Pe,It,V.count);else if(X.isInstancedBufferGeometry){let en=X._maxInstanceCount!==void 0?X._maxInstanceCount:1/0,ye=Math.min(X.instanceCount,en);ft.renderInstances(Pe,It,ye)}else ft.render(Pe,It)};function ci(w,U,X){w.transparent===!0&&w.side===Xn&&w.forceSinglePass===!1?(w.side=Qt,w.needsUpdate=!0,cl(w,U,X),w.side=$i,w.needsUpdate=!0,cl(w,U,X),w.side=Xn):cl(w,U,X)}this.compile=function(w,U,X=null){X===null&&(X=w),E=he.get(X),E.init(U),x.push(E),X.traverseVisible(function(V){V.isLight&&V.layers.test(U.layers)&&(E.pushLight(V),V.castShadow&&E.pushShadow(V))}),w!==X&&w.traverseVisible(function(V){V.isLight&&V.layers.test(U.layers)&&(E.pushLight(V),V.castShadow&&E.pushShadow(V))}),E.setupLights();let z=new Set;return w.traverse(function(V){if(!(V.isMesh||V.isPoints||V.isLine||V.isSprite))return;let _e=V.material;if(_e)if(Array.isArray(_e))for(let Se=0;Se<_e.length;Se++){let ge=_e[Se];ci(ge,X,V),z.add(ge)}else ci(_e,X,V),z.add(_e)}),E=x.pop(),z},this.compileAsync=function(w,U,X=null){let z=this.compile(w,U,X);return new Promise(V=>{function _e(){if(z.forEach(function(Se){T.get(Se).currentProgram.isReady()&&z.delete(Se)}),z.size===0){V(w);return}setTimeout(_e,10)}Oe.get("KHR_parallel_shader_compile")!==null?_e():setTimeout(_e,10)})};let Fh=null;function py(w){Fh&&Fh(w)}function Lm(){Vr.stop()}function Nm(){Vr.start()}let Vr=new Qx;Vr.setAnimationLoop(py),typeof self<"u"&&Vr.setContext(self),this.setAnimationLoop=function(w){Fh=w,ce.setAnimationLoop(w),w===null?Vr.stop():Vr.start()},ce.addEventListener("sessionstart",Lm),ce.addEventListener("sessionend",Nm),this.render=function(w,U){if(U!==void 0&&U.isCamera!==!0){Ne("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(b===!0)return;I!==null&&I.renderStart(w,U);let X=ce.enabled===!0&&ce.isPresenting===!0,z=R!==null&&(D===null||X)&&R.begin(C,D);if(w.matrixWorldAutoUpdate===!0&&w.updateMatrixWorld(),U.parent===null&&U.matrixWorldAutoUpdate===!0&&U.updateMatrixWorld(),ce.enabled===!0&&ce.isPresenting===!0&&(R===null||R.isCompositing()===!1)&&(ce.cameraAutoUpdate===!0&&ce.updateCamera(U),U=ce.getCamera()),w.isScene===!0&&w.onBeforeRender(C,w,U,D),E=he.get(w,x.length),E.init(U),E.state.textureUnits=y.getTextureUnits(),x.push(E),qe.multiplyMatrices(U.projectionMatrix,U.matrixWorldInverse),Ae.setFromProjectionMatrix(qe,si,U.reversedDepth),Ve=this.localClippingEnabled,ht=fe.init(this.clippingPlanes,Ve),A=j.get(w,P.length),A.init(),P.push(A),ce.enabled===!0&&ce.isPresenting===!0){let Se=C.xr.getDepthSensingMesh();Se!==null&&Oh(Se,U,-1/0,C.sortObjects)}Oh(w,U,0,C.sortObjects),A.finish(),C.sortObjects===!0&&A.sort(ee,G),Ze=ce.enabled===!1||ce.isPresenting===!1||ce.hasDepthSensing()===!1,Ze&&ae.addToRenderList(A,w),this.info.render.frame++,ht===!0&&fe.beginShadows();let V=E.state.shadowsArray;if(ie.render(V,w,U),ht===!0&&fe.endShadows(),this.info.autoReset===!0&&this.info.reset(),(z&&R.hasRenderPass())===!1){let Se=A.opaque,ge=A.transmissive;if(E.setupLights(),U.isArrayCamera){let Te=U.cameras;if(ge.length>0)for(let Re=0,ke=Te.length;Re<ke;Re++){let Xe=Te[Re];Um(Se,ge,w,Xe)}Ze&&ae.render(w);for(let Re=0,ke=Te.length;Re<ke;Re++){let Xe=Te[Re];Dm(A,w,Xe,Xe.viewport)}}else ge.length>0&&Um(Se,ge,w,U),Ze&&ae.render(w),Dm(A,w,U)}D!==null&&H===0&&(y.updateMultisampleRenderTarget(D),y.updateRenderTargetMipmap(D)),z&&R.end(C),w.isScene===!0&&w.onAfterRender(C,w,U),le.resetDefaultState(),B=-1,k=null,x.pop(),x.length>0?(E=x[x.length-1],y.setTextureUnits(E.state.textureUnits),ht===!0&&fe.setGlobalState(C.clippingPlanes,E.state.camera)):E=null,P.pop(),P.length>0?A=P[P.length-1]:A=null,I!==null&&I.renderEnd()};function Oh(w,U,X,z){if(w.visible===!1)return;if(w.layers.test(U.layers)){if(w.isGroup)X=w.renderOrder;else if(w.isLOD)w.autoUpdate===!0&&w.update(U);else if(w.isLightProbeGrid)E.pushLightProbeGrid(w);else if(w.isLight)E.pushLight(w),w.castShadow&&E.pushShadow(w);else if(w.isSprite){if(!w.frustumCulled||Ae.intersectsSprite(w)){z&&Ue.setFromMatrixPosition(w.matrixWorld).applyMatrix4(qe);let Se=Q.update(w),ge=w.material;ge.visible&&A.push(w,Se,ge,X,Ue.z,null)}}else if((w.isMesh||w.isLine||w.isPoints)&&(!w.frustumCulled||Ae.intersectsObject(w))){let Se=Q.update(w),ge=w.material;if(z&&(w.boundingSphere!==void 0?(w.boundingSphere===null&&w.computeBoundingSphere(),Ue.copy(w.boundingSphere.center)):(Se.boundingSphere===null&&Se.computeBoundingSphere(),Ue.copy(Se.boundingSphere.center)),Ue.applyMatrix4(w.matrixWorld).applyMatrix4(qe)),Array.isArray(ge)){let Te=Se.groups;for(let Re=0,ke=Te.length;Re<ke;Re++){let Xe=Te[Re],Pe=ge[Xe.materialIndex];Pe&&Pe.visible&&A.push(w,Se,Pe,X,Ue.z,Xe)}}else ge.visible&&A.push(w,Se,ge,X,Ue.z,null)}}let _e=w.children;for(let Se=0,ge=_e.length;Se<ge;Se++)Oh(_e[Se],U,X,z)}function Dm(w,U,X,z){let{opaque:V,transmissive:_e,transparent:Se}=w;E.setupLightsView(X),ht===!0&&fe.setGlobalState(C.clippingPlanes,X),z&&de.viewport(te.copy(z)),V.length>0&&ll(V,U,X),_e.length>0&&ll(_e,U,X),Se.length>0&&ll(Se,U,X),de.buffers.depth.setTest(!0),de.buffers.depth.setMask(!0),de.buffers.color.setMask(!0),de.setPolygonOffset(!1)}function Um(w,U,X,z){if((X.isScene===!0?X.overrideMaterial:null)!==null)return;if(E.state.transmissionRenderTarget[z.id]===void 0){let Pe=Oe.has("EXT_color_buffer_half_float")||Oe.has("EXT_color_buffer_float");E.state.transmissionRenderTarget[z.id]=new Nn(1,1,{generateMipmaps:!0,type:Pe?Ai:Mn,minFilter:Fr,samples:Math.max(4,q.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:$e.workingColorSpace})}let _e=E.state.transmissionRenderTarget[z.id],Se=z.viewport||te;_e.setSize(Se.z*C.transmissionResolutionScale,Se.w*C.transmissionResolutionScale);let ge=C.getRenderTarget(),Te=C.getActiveCubeFace(),Re=C.getActiveMipmapLevel();C.setRenderTarget(_e),C.getClearColor(ve),we=C.getClearAlpha(),we<1&&C.setClearColor(16777215,.5),C.clear(),Ze&&ae.render(X);let ke=C.toneMapping;C.toneMapping=oi;let Xe=z.viewport;if(z.viewport!==void 0&&(z.viewport=void 0),E.setupLightsView(z),ht===!0&&fe.setGlobalState(C.clippingPlanes,z),ll(w,X,z),y.updateMultisampleRenderTarget(_e),y.updateRenderTargetMipmap(_e),Oe.has("WEBGL_multisampled_render_to_texture")===!1){let Pe=!1;for(let ut=0,It=U.length;ut<It;ut++){let Ct=U[ut],{object:ft,geometry:en,material:ye,group:wn}=Ct;if(ye.side===Xn&&ft.layers.test(z.layers)){let Qe=ye.side;ye.side=Qt,ye.needsUpdate=!0,Fm(ft,X,z,en,ye,wn),ye.side=Qe,ye.needsUpdate=!0,Pe=!0}}Pe===!0&&(y.updateMultisampleRenderTarget(_e),y.updateRenderTargetMipmap(_e))}C.setRenderTarget(ge,Te,Re),C.setClearColor(ve,we),Xe!==void 0&&(z.viewport=Xe),C.toneMapping=ke}function ll(w,U,X){let z=U.isScene===!0?U.overrideMaterial:null;for(let V=0,_e=w.length;V<_e;V++){let Se=w[V],{object:ge,geometry:Te,group:Re}=Se,ke=Se.material;ke.allowOverride===!0&&z!==null&&(ke=z),ge.layers.test(X.layers)&&Fm(ge,U,X,Te,ke,Re)}}function Fm(w,U,X,z,V,_e){w.onBeforeRender(C,U,X,z,V,_e),w.modelViewMatrix.multiplyMatrices(X.matrixWorldInverse,w.matrixWorld),w.normalMatrix.getNormalMatrix(w.modelViewMatrix),V.onBeforeRender(C,U,X,z,w,_e),V.transparent===!0&&V.side===Xn&&V.forceSinglePass===!1?(V.side=Qt,V.needsUpdate=!0,C.renderBufferDirect(X,U,z,V,w,_e),V.side=$i,V.needsUpdate=!0,C.renderBufferDirect(X,U,z,V,w,_e),V.side=Xn):C.renderBufferDirect(X,U,z,V,w,_e),w.onAfterRender(C,U,X,z,V,_e)}function cl(w,U,X){U.isScene!==!0&&(U=lt);let z=T.get(w),V=E.state.lights,_e=E.state.shadowsArray,Se=V.state.version,ge=ne.getParameters(w,V.state,_e,U,X,E.state.lightProbeGridArray),Te=ne.getProgramCacheKey(ge),Re=z.programs;z.environment=w.isMeshStandardMaterial||w.isMeshLambertMaterial||w.isMeshPhongMaterial?U.environment:null,z.fog=U.fog;let ke=w.isMeshStandardMaterial||w.isMeshLambertMaterial&&!w.envMap||w.isMeshPhongMaterial&&!w.envMap;z.envMap=F.get(w.envMap||z.environment,ke),z.envMapRotation=z.environment!==null&&w.envMap===null?U.environmentRotation:w.envMapRotation,Re===void 0&&(w.addEventListener("dispose",Pt),Re=new Map,z.programs=Re);let Xe=Re.get(Te);if(Xe!==void 0){if(z.currentProgram===Xe&&z.lightsStateVersion===Se)return Bm(w,ge),Xe}else ge.uniforms=ne.getUniforms(w),I!==null&&w.isNodeMaterial&&I.build(w,X,ge),w.onBeforeCompile(ge,C),Xe=ne.acquireProgram(ge,Te),Re.set(Te,Xe),z.uniforms=ge.uniforms;let Pe=z.uniforms;return(!w.isShaderMaterial&&!w.isRawShaderMaterial||w.clipping===!0)&&(Pe.clippingPlanes=fe.uniform),Bm(w,ge),z.needsLights=vy(w),z.lightsStateVersion=Se,z.needsLights&&(Pe.ambientLightColor.value=V.state.ambient,Pe.lightProbe.value=V.state.probe,Pe.directionalLights.value=V.state.directional,Pe.directionalLightShadows.value=V.state.directionalShadow,Pe.spotLights.value=V.state.spot,Pe.spotLightShadows.value=V.state.spotShadow,Pe.rectAreaLights.value=V.state.rectArea,Pe.ltc_1.value=V.state.rectAreaLTC1,Pe.ltc_2.value=V.state.rectAreaLTC2,Pe.pointLights.value=V.state.point,Pe.pointLightShadows.value=V.state.pointShadow,Pe.hemisphereLights.value=V.state.hemi,Pe.directionalShadowMatrix.value=V.state.directionalShadowMatrix,Pe.spotLightMatrix.value=V.state.spotLightMatrix,Pe.spotLightMap.value=V.state.spotLightMap,Pe.pointShadowMatrix.value=V.state.pointShadowMatrix),z.lightProbeGrid=E.state.lightProbeGridArray.length>0,z.currentProgram=Xe,z.uniformsList=null,Xe}function Om(w){if(w.uniformsList===null){let U=w.currentProgram.getUniforms();w.uniformsList=To.seqWithValue(U.seq,w.uniforms)}return w.uniformsList}function Bm(w,U){let X=T.get(w);X.outputColorSpace=U.outputColorSpace,X.batching=U.batching,X.batchingColor=U.batchingColor,X.instancing=U.instancing,X.instancingColor=U.instancingColor,X.instancingMorph=U.instancingMorph,X.skinning=U.skinning,X.morphTargets=U.morphTargets,X.morphNormals=U.morphNormals,X.morphColors=U.morphColors,X.morphTargetsCount=U.morphTargetsCount,X.numClippingPlanes=U.numClippingPlanes,X.numIntersection=U.numClipIntersection,X.vertexAlphas=U.vertexAlphas,X.vertexTangents=U.vertexTangents,X.toneMapping=U.toneMapping}function my(w,U){if(w.length===0)return null;if(w.length===1)return w[0].texture!==null?w[0]:null;M.setFromMatrixPosition(U.matrixWorld);for(let X=0,z=w.length;X<z;X++){let V=w[X];if(V.texture!==null&&V.boundingBox.containsPoint(M))return V}return null}function gy(w,U,X,z,V){U.isScene!==!0&&(U=lt),y.resetTextureUnits();let _e=U.fog,Se=z.isMeshStandardMaterial||z.isMeshLambertMaterial||z.isMeshPhongMaterial?U.environment:null,ge=D===null?C.outputColorSpace:D.isXRRenderTarget===!0?D.texture.colorSpace:$e.workingColorSpace,Te=z.isMeshStandardMaterial||z.isMeshLambertMaterial&&!z.envMap||z.isMeshPhongMaterial&&!z.envMap,Re=F.get(z.envMap||Se,Te),ke=z.vertexColors===!0&&!!X.attributes.color&&X.attributes.color.itemSize===4,Xe=!!X.attributes.tangent&&(!!z.normalMap||z.anisotropy>0),Pe=!!X.morphAttributes.position,ut=!!X.morphAttributes.normal,It=!!X.morphAttributes.color,Ct=oi;z.toneMapped&&(D===null||D.isXRRenderTarget===!0)&&(Ct=C.toneMapping);let ft=X.morphAttributes.position||X.morphAttributes.normal||X.morphAttributes.color,en=ft!==void 0?ft.length:0,ye=T.get(z),wn=E.state.lights;if(ht===!0&&(Ve===!0||w!==k)){let mt=w===k&&z.id===B;fe.setState(z,w,mt)}let Qe=!1;z.version===ye.__version?(ye.needsLights&&ye.lightsStateVersion!==wn.state.version||ye.outputColorSpace!==ge||V.isBatchedMesh&&ye.batching===!1||!V.isBatchedMesh&&ye.batching===!0||V.isBatchedMesh&&ye.batchingColor===!0&&V.colorTexture===null||V.isBatchedMesh&&ye.batchingColor===!1&&V.colorTexture!==null||V.isInstancedMesh&&ye.instancing===!1||!V.isInstancedMesh&&ye.instancing===!0||V.isSkinnedMesh&&ye.skinning===!1||!V.isSkinnedMesh&&ye.skinning===!0||V.isInstancedMesh&&ye.instancingColor===!0&&V.instanceColor===null||V.isInstancedMesh&&ye.instancingColor===!1&&V.instanceColor!==null||V.isInstancedMesh&&ye.instancingMorph===!0&&V.morphTexture===null||V.isInstancedMesh&&ye.instancingMorph===!1&&V.morphTexture!==null||ye.envMap!==Re||z.fog===!0&&ye.fog!==_e||ye.numClippingPlanes!==void 0&&(ye.numClippingPlanes!==fe.numPlanes||ye.numIntersection!==fe.numIntersection)||ye.vertexAlphas!==ke||ye.vertexTangents!==Xe||ye.morphTargets!==Pe||ye.morphNormals!==ut||ye.morphColors!==It||ye.toneMapping!==Ct||ye.morphTargetsCount!==en||!!ye.lightProbeGrid!=E.state.lightProbeGridArray.length>0)&&(Qe=!0):(Qe=!0,ye.__version=z.version);let Fn=ye.currentProgram;Qe===!0&&(Fn=cl(z,U,V),I&&z.isNodeMaterial&&I.onUpdateProgram(z,Fn,ye));let ui=!1,Qi=!1,ps=!1,pt=Fn.getUniforms(),Lt=ye.uniforms;if(de.useProgram(Fn.program)&&(ui=!0,Qi=!0,ps=!0),z.id!==B&&(B=z.id,Qi=!0),ye.needsLights){let mt=my(E.state.lightProbeGridArray,V);ye.lightProbeGrid!==mt&&(ye.lightProbeGrid=mt,Qi=!0)}if(ui||k!==w){de.buffers.depth.getReversed()&&w.reversedDepth!==!0&&(w._reversedDepth=!0,w.updateProjectionMatrix()),pt.setValue(N,"projectionMatrix",w.projectionMatrix),pt.setValue(N,"viewMatrix",w.matrixWorldInverse);let tr=pt.map.cameraPosition;tr!==void 0&&tr.setValue(N,ot.setFromMatrixPosition(w.matrixWorld)),q.logarithmicDepthBuffer&&pt.setValue(N,"logDepthBufFC",2/(Math.log(w.far+1)/Math.LN2)),(z.isMeshPhongMaterial||z.isMeshToonMaterial||z.isMeshLambertMaterial||z.isMeshBasicMaterial||z.isMeshStandardMaterial||z.isShaderMaterial)&&pt.setValue(N,"isOrthographic",w.isOrthographicCamera===!0),k!==w&&(k=w,Qi=!0,ps=!0)}if(ye.needsLights&&(wn.state.directionalShadowMap.length>0&&pt.setValue(N,"directionalShadowMap",wn.state.directionalShadowMap,y),wn.state.spotShadowMap.length>0&&pt.setValue(N,"spotShadowMap",wn.state.spotShadowMap,y),wn.state.pointShadowMap.length>0&&pt.setValue(N,"pointShadowMap",wn.state.pointShadowMap,y)),V.isSkinnedMesh){pt.setOptional(N,V,"bindMatrix"),pt.setOptional(N,V,"bindMatrixInverse");let mt=V.skeleton;mt&&(mt.boneTexture===null&&mt.computeBoneTexture(),pt.setValue(N,"boneTexture",mt.boneTexture,y))}V.isBatchedMesh&&(pt.setOptional(N,V,"batchingTexture"),pt.setValue(N,"batchingTexture",V._matricesTexture,y),pt.setOptional(N,V,"batchingIdTexture"),pt.setValue(N,"batchingIdTexture",V._indirectTexture,y),pt.setOptional(N,V,"batchingColorTexture"),V._colorsTexture!==null&&pt.setValue(N,"batchingColorTexture",V._colorsTexture,y));let er=X.morphAttributes;if((er.position!==void 0||er.normal!==void 0||er.color!==void 0)&&Ee.update(V,X,Fn),(Qi||ye.receiveShadow!==V.receiveShadow)&&(ye.receiveShadow=V.receiveShadow,pt.setValue(N,"receiveShadow",V.receiveShadow)),(z.isMeshStandardMaterial||z.isMeshLambertMaterial||z.isMeshPhongMaterial)&&z.envMap===null&&U.environment!==null&&(Lt.envMapIntensity.value=U.environmentIntensity),Lt.dfgLUT!==void 0&&(Lt.dfgLUT.value=bA()),Qi){if(pt.setValue(N,"toneMappingExposure",C.toneMappingExposure),ye.needsLights&&_y(Lt,ps),_e&&z.fog===!0&&Y.refreshFogUniforms(Lt,_e),Y.refreshMaterialUniforms(Lt,z,De,je,E.state.transmissionRenderTarget[w.id]),ye.needsLights&&ye.lightProbeGrid){let mt=ye.lightProbeGrid;Lt.probesSH.value=mt.texture,Lt.probesMin.value.copy(mt.boundingBox.min),Lt.probesMax.value.copy(mt.boundingBox.max),Lt.probesResolution.value.copy(mt.resolution)}To.upload(N,Om(ye),Lt,y)}if(z.isShaderMaterial&&z.uniformsNeedUpdate===!0&&(To.upload(N,Om(ye),Lt,y),z.uniformsNeedUpdate=!1),z.isSpriteMaterial&&pt.setValue(N,"center",V.center),pt.setValue(N,"modelViewMatrix",V.modelViewMatrix),pt.setValue(N,"normalMatrix",V.normalMatrix),pt.setValue(N,"modelMatrix",V.matrixWorld),z.uniformsGroups!==void 0){let mt=z.uniformsGroups;for(let tr=0,ms=mt.length;tr<ms;tr++){let km=mt[tr];J.update(km,Fn),J.bind(km,Fn)}}return Fn}function _y(w,U){w.ambientLightColor.needsUpdate=U,w.lightProbe.needsUpdate=U,w.directionalLights.needsUpdate=U,w.directionalLightShadows.needsUpdate=U,w.pointLights.needsUpdate=U,w.pointLightShadows.needsUpdate=U,w.spotLights.needsUpdate=U,w.spotLightShadows.needsUpdate=U,w.rectAreaLights.needsUpdate=U,w.hemisphereLights.needsUpdate=U}function vy(w){return w.isMeshLambertMaterial||w.isMeshToonMaterial||w.isMeshPhongMaterial||w.isMeshStandardMaterial||w.isShadowMaterial||w.isShaderMaterial&&w.lights===!0}this.getActiveCubeFace=function(){return W},this.getActiveMipmapLevel=function(){return H},this.getRenderTarget=function(){return D},this.setRenderTargetTextures=function(w,U,X){let z=T.get(w);z.__autoAllocateDepthBuffer=w.resolveDepthBuffer===!1,z.__autoAllocateDepthBuffer===!1&&(z.__useRenderToTexture=!1),T.get(w.texture).__webglTexture=U,T.get(w.depthTexture).__webglTexture=z.__autoAllocateDepthBuffer?void 0:X,z.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(w,U){let X=T.get(w);X.__webglFramebuffer=U,X.__useDefaultFramebuffer=U===void 0};let xy=N.createFramebuffer();this.setRenderTarget=function(w,U=0,X=0){D=w,W=U,H=X;let z=null,V=!1,_e=!1;if(w){let ge=T.get(w);if(ge.__useDefaultFramebuffer!==void 0){de.bindFramebuffer(N.FRAMEBUFFER,ge.__webglFramebuffer),te.copy(w.viewport),se.copy(w.scissor),ue=w.scissorTest,de.viewport(te),de.scissor(se),de.setScissorTest(ue),B=-1;return}else if(ge.__webglFramebuffer===void 0)y.setupRenderTarget(w);else if(ge.__hasExternalTextures)y.rebindTextures(w,T.get(w.texture).__webglTexture,T.get(w.depthTexture).__webglTexture);else if(w.depthBuffer){let ke=w.depthTexture;if(ge.__boundDepthTexture!==ke){if(ke!==null&&T.has(ke)&&(w.width!==ke.image.width||w.height!==ke.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");y.setupDepthRenderbuffer(w)}}let Te=w.texture;(Te.isData3DTexture||Te.isDataArrayTexture||Te.isCompressedArrayTexture)&&(_e=!0);let Re=T.get(w).__webglFramebuffer;w.isWebGLCubeRenderTarget?(Array.isArray(Re[U])?z=Re[U][X]:z=Re[U],V=!0):w.samples>0&&y.useMultisampledRTT(w)===!1?z=T.get(w).__webglMultisampledFramebuffer:Array.isArray(Re)?z=Re[X]:z=Re,te.copy(w.viewport),se.copy(w.scissor),ue=w.scissorTest}else te.copy(Z).multiplyScalar(De).floor(),se.copy(me).multiplyScalar(De).floor(),ue=be;if(X!==0&&(z=xy),de.bindFramebuffer(N.FRAMEBUFFER,z)&&de.drawBuffers(w,z),de.viewport(te),de.scissor(se),de.setScissorTest(ue),V){let ge=T.get(w.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_CUBE_MAP_POSITIVE_X+U,ge.__webglTexture,X)}else if(_e){let ge=U;for(let Te=0;Te<w.textures.length;Te++){let Re=T.get(w.textures[Te]);N.framebufferTextureLayer(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0+Te,Re.__webglTexture,X,ge)}}else if(w!==null&&X!==0){let ge=T.get(w.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,ge.__webglTexture,X)}B=-1},this.readRenderTargetPixels=function(w,U,X,z,V,_e,Se,ge=0){if(!(w&&w.isWebGLRenderTarget)){Ne("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Te=T.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&Se!==void 0&&(Te=Te[Se]),Te){de.bindFramebuffer(N.FRAMEBUFFER,Te);try{let Re=w.textures[ge],ke=Re.format,Xe=Re.type;if(w.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+ge),!q.textureFormatReadable(ke)){Ne("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!q.textureTypeReadable(Xe)){Ne("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}U>=0&&U<=w.width-z&&X>=0&&X<=w.height-V&&N.readPixels(U,X,z,V,L.convert(ke),L.convert(Xe),_e)}finally{let Re=D!==null?T.get(D).__webglFramebuffer:null;de.bindFramebuffer(N.FRAMEBUFFER,Re)}}},this.readRenderTargetPixelsAsync=async function(w,U,X,z,V,_e,Se,ge=0){if(!(w&&w.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Te=T.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&Se!==void 0&&(Te=Te[Se]),Te)if(U>=0&&U<=w.width-z&&X>=0&&X<=w.height-V){de.bindFramebuffer(N.FRAMEBUFFER,Te);let Re=w.textures[ge],ke=Re.format,Xe=Re.type;if(w.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+ge),!q.textureFormatReadable(ke))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!q.textureTypeReadable(Xe))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Pe=N.createBuffer();N.bindBuffer(N.PIXEL_PACK_BUFFER,Pe),N.bufferData(N.PIXEL_PACK_BUFFER,_e.byteLength,N.STREAM_READ),N.readPixels(U,X,z,V,L.convert(ke),L.convert(Xe),0);let ut=D!==null?T.get(D).__webglFramebuffer:null;de.bindFramebuffer(N.FRAMEBUFFER,ut);let It=N.fenceSync(N.SYNC_GPU_COMMANDS_COMPLETE,0);return N.flush(),await bx(N,It,4),N.bindBuffer(N.PIXEL_PACK_BUFFER,Pe),N.getBufferSubData(N.PIXEL_PACK_BUFFER,0,_e),N.deleteBuffer(Pe),N.deleteSync(It),_e}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(w,U=null,X=0){let z=Math.pow(2,-X),V=Math.floor(w.image.width*z),_e=Math.floor(w.image.height*z),Se=U!==null?U.x:0,ge=U!==null?U.y:0;y.setTexture2D(w,0),N.copyTexSubImage2D(N.TEXTURE_2D,X,0,0,Se,ge,V,_e),de.unbindTexture()};let yy=N.createFramebuffer(),Sy=N.createFramebuffer();this.copyTextureToTexture=function(w,U,X=null,z=null,V=0,_e=0){let Se,ge,Te,Re,ke,Xe,Pe,ut,It,Ct=w.isCompressedTexture?w.mipmaps[_e]:w.image;if(X!==null)Se=X.max.x-X.min.x,ge=X.max.y-X.min.y,Te=X.isBox3?X.max.z-X.min.z:1,Re=X.min.x,ke=X.min.y,Xe=X.isBox3?X.min.z:0;else{let Lt=Math.pow(2,-V);Se=Math.floor(Ct.width*Lt),ge=Math.floor(Ct.height*Lt),w.isDataArrayTexture?Te=Ct.depth:w.isData3DTexture?Te=Math.floor(Ct.depth*Lt):Te=1,Re=0,ke=0,Xe=0}z!==null?(Pe=z.x,ut=z.y,It=z.z):(Pe=0,ut=0,It=0);let ft=L.convert(U.format),en=L.convert(U.type),ye;U.isData3DTexture?(y.setTexture3D(U,0),ye=N.TEXTURE_3D):U.isDataArrayTexture||U.isCompressedArrayTexture?(y.setTexture2DArray(U,0),ye=N.TEXTURE_2D_ARRAY):(y.setTexture2D(U,0),ye=N.TEXTURE_2D),de.activeTexture(N.TEXTURE0),de.pixelStorei(N.UNPACK_FLIP_Y_WEBGL,U.flipY),de.pixelStorei(N.UNPACK_PREMULTIPLY_ALPHA_WEBGL,U.premultiplyAlpha),de.pixelStorei(N.UNPACK_ALIGNMENT,U.unpackAlignment);let wn=de.getParameter(N.UNPACK_ROW_LENGTH),Qe=de.getParameter(N.UNPACK_IMAGE_HEIGHT),Fn=de.getParameter(N.UNPACK_SKIP_PIXELS),ui=de.getParameter(N.UNPACK_SKIP_ROWS),Qi=de.getParameter(N.UNPACK_SKIP_IMAGES);de.pixelStorei(N.UNPACK_ROW_LENGTH,Ct.width),de.pixelStorei(N.UNPACK_IMAGE_HEIGHT,Ct.height),de.pixelStorei(N.UNPACK_SKIP_PIXELS,Re),de.pixelStorei(N.UNPACK_SKIP_ROWS,ke),de.pixelStorei(N.UNPACK_SKIP_IMAGES,Xe);let ps=w.isDataArrayTexture||w.isData3DTexture,pt=U.isDataArrayTexture||U.isData3DTexture;if(w.isDepthTexture){let Lt=T.get(w),er=T.get(U),mt=T.get(Lt.__renderTarget),tr=T.get(er.__renderTarget);de.bindFramebuffer(N.READ_FRAMEBUFFER,mt.__webglFramebuffer),de.bindFramebuffer(N.DRAW_FRAMEBUFFER,tr.__webglFramebuffer);for(let ms=0;ms<Te;ms++)ps&&(N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,T.get(w).__webglTexture,V,Xe+ms),N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,T.get(U).__webglTexture,_e,It+ms)),N.blitFramebuffer(Re,ke,Se,ge,Pe,ut,Se,ge,N.DEPTH_BUFFER_BIT,N.NEAREST);de.bindFramebuffer(N.READ_FRAMEBUFFER,null),de.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else if(V!==0||w.isRenderTargetTexture||T.has(w)){let Lt=T.get(w),er=T.get(U);de.bindFramebuffer(N.READ_FRAMEBUFFER,yy),de.bindFramebuffer(N.DRAW_FRAMEBUFFER,Sy);for(let mt=0;mt<Te;mt++)ps?N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,Lt.__webglTexture,V,Xe+mt):N.framebufferTexture2D(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,Lt.__webglTexture,V),pt?N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,er.__webglTexture,_e,It+mt):N.framebufferTexture2D(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,er.__webglTexture,_e),V!==0?N.blitFramebuffer(Re,ke,Se,ge,Pe,ut,Se,ge,N.COLOR_BUFFER_BIT,N.NEAREST):pt?N.copyTexSubImage3D(ye,_e,Pe,ut,It+mt,Re,ke,Se,ge):N.copyTexSubImage2D(ye,_e,Pe,ut,Re,ke,Se,ge);de.bindFramebuffer(N.READ_FRAMEBUFFER,null),de.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else pt?w.isDataTexture||w.isData3DTexture?N.texSubImage3D(ye,_e,Pe,ut,It,Se,ge,Te,ft,en,Ct.data):U.isCompressedArrayTexture?N.compressedTexSubImage3D(ye,_e,Pe,ut,It,Se,ge,Te,ft,Ct.data):N.texSubImage3D(ye,_e,Pe,ut,It,Se,ge,Te,ft,en,Ct):w.isDataTexture?N.texSubImage2D(N.TEXTURE_2D,_e,Pe,ut,Se,ge,ft,en,Ct.data):w.isCompressedTexture?N.compressedTexSubImage2D(N.TEXTURE_2D,_e,Pe,ut,Ct.width,Ct.height,ft,Ct.data):N.texSubImage2D(N.TEXTURE_2D,_e,Pe,ut,Se,ge,ft,en,Ct);de.pixelStorei(N.UNPACK_ROW_LENGTH,wn),de.pixelStorei(N.UNPACK_IMAGE_HEIGHT,Qe),de.pixelStorei(N.UNPACK_SKIP_PIXELS,Fn),de.pixelStorei(N.UNPACK_SKIP_ROWS,ui),de.pixelStorei(N.UNPACK_SKIP_IMAGES,Qi),_e===0&&U.generateMipmaps&&N.generateMipmap(ye),de.unbindTexture()},this.initRenderTarget=function(w){T.get(w).__webglFramebuffer===void 0&&y.setupRenderTarget(w)},this.initTexture=function(w){w.isCubeTexture?y.setTextureCube(w,0):w.isData3DTexture?y.setTexture3D(w,0):w.isDataArrayTexture||w.isCompressedArrayTexture?y.setTexture2DArray(w,0):y.setTexture2D(w,0),de.unbindTexture()},this.resetState=function(){W=0,H=0,D=null,de.reset(),le.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return si}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let n=this.getContext();n.drawingBufferColorSpace=$e._getDrawingBufferColorSpace(e),n.unpackColorSpace=$e._getUnpackColorSpace()}};var Le=ul(Pm());async function DA(){let t=typeof AbortController=="function"?new AbortController:null,e;try{let n=fetch("./game.config.json",{signal:t==null?void 0:t.signal}).then(s=>{if(!s.ok)throw new Error(`HTTP ${s.status}`);return s.json()}),i=new Promise((s,o)=>{e=setTimeout(()=>o(new Error("timed out")),1200)}),r=await Promise.race([n,i]);if(!r||typeof r!="object"||Array.isArray(r)||["tweaks","texts","images"].some(s=>r[s]!=null&&!Array.isArray(r[s])))throw new Error("invalid config");return r}catch(n){return console.warn("[playable] Using packaged defaults:",n.message),null}finally{clearTimeout(e),t==null||t.abort()}}function cy(t,e){if(e(),typeof ResizeObserver=="function"){let n=new ResizeObserver(e);return n.observe(t),()=>n.disconnect()}return window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}var al=window.parent!==window&&new URLSearchParams(location.search).get("feedReview")==="1";al&&(document.documentElement.dataset.feedCover="true",window.addEventListener("message",t=>{var e;t.source!==window.parent||t.origin!==location.origin||((e=t.data)==null?void 0:e.type)!=="playable-active"||(al=t.data.active!==!0,document.documentElement.dataset.feedCover=String(al))}));var uy={MAX_HEALTH:100,MAX_STAMINA:100,PLAYER_DAMAGE:25,AI_DAMAGE:25,ATTACK_RANGE:1.75,MOVE_SPEED:2.8,DRAW_HINT:"Draw your fighter",BATTLE_HINT:"Move, guard, attack",UNDO:"Undo",CLEAR:"Clear",FIGHT:"Fight",GUARD:"Guard",ATTACK:"Attack",WIN:"You win",LOSE:"Knocked out",REPLAY:"Play again",EDIT:"Edit fighter"};window.SFX&&window.SFX.register({click:"./assets/sfx_click.mp3",draw:"buzzer",swoosh:"buzzer",hit:"./assets/sfx_punch.mp3",block:"./assets/sfx_guard.mp3",footstep:"./assets/sfx_footstep.mp3",result:"./assets/sfx_result.mp3",unusedBlock:"./assets/sfx_block.mp3",unusedDraw:"./assets/sfx_draw.mp3",unusedHit:"./assets/sfx_hit.mp3",unusedStep:"./assets/sfx_step.mp3",unusedSwoosh:"./assets/sfx_swoosh.mp3"});var Yn=(t,e=!1)=>{try{document.visibilityState==="visible"&&window.SFX&&(e?window.SFX.playOnce(t):window.SFX.play(t))}catch{}},hy="#292c3c";function Im(t,e,n=9){t.clearRect(0,0,340,340),t.strokeStyle=hy,t.fillStyle=hy,t.lineCap="round",t.lineJoin="round",t.lineWidth=n;for(let{points:i}of e)if(i.length){if(i.length===1){t.beginPath(),t.arc(i[0].x,i[0].y,n/2,0,Math.PI*2),t.fill();continue}t.beginPath(),t.moveTo(i[0].x,i[0].y);for(let r of i.slice(1))t.lineTo(r.x,r.y);t.stroke()}}function UA(t){let e=t.canvas.width,n=t.canvas.height,i=t.getImageData(0,0,e,n),r=i.data,s=new Uint8Array(e*n),o=new Int32Array(e*n),a=0,l=0,c=(d,f)=>{let h=f*e+d;s[h]||r[h*4+3]>=128||(s[h]=1,o[l++]=h)};for(let d=0;d<e;d++)c(d,0),c(d,n-1);for(let d=1;d<n-1;d++)c(0,d),c(e-1,d);for(;a<l;){let d=o[a++],f=d%e,h=Math.floor(d/e);f>0&&c(f-1,h),f<e-1&&c(f+1,h),h>0&&c(f,h-1),h<n-1&&c(f,h+1)}for(let d=0;d<e*n;d++){if(s[d]||r[d*4+3]>=128)continue;let f=d*4;r[f]=41,r[f+1]=44,r[f+2]=60,r[f+3]=255}t.putImageData(i,0,0)}function dy(t){let e=document.createElement("canvas");e.width=e.height=340;let n=e.getContext("2d");Im(n,t,14),UA(n);let i=340,r=340,s=0,o=0;for(let{points:C}of t)for(let{x:b,y:I}of C)i=Math.min(i,b),s=Math.max(s,b),r=Math.min(r,I),o=Math.max(o,I);let a=88,l=document.createElement("canvas");l.width=l.height=a;let c=l.getContext("2d"),d=(a-8)/Math.max(s-i+24,o-r+24);c.drawImage(e,a/2-(i+s)/2*d,a/2-(r+o)/2*d,340*d,340*d);let f=c.getImageData(0,0,a,a).data,h=(C,b)=>C>=0&&b>=0&&C<a&&b<a&&f[(b*a+C)*4+3]>84,p=0,_=new Float32Array(a*a);for(let C=0;C<a;C++)for(let b=0;b<a;b++)h(b,C)&&(p=C+1,_[C*a+b]=a);for(let C=1;C<a-1;C++)for(let b=1;b<a-1;b++){let I=C*a+b;_[I]=Math.min(_[I],_[I-1]+1,_[I-a]+1,_[I-a-1]+1.414,_[I-a+1]+1.414)}for(let C=a-2;C>=1;C--)for(let b=a-2;b>=1;b--){let I=C*a+b;_[I]=Math.min(_[I],_[I+1]+1,_[I+a]+1,_[I+a-1]+1.414,_[I+a+1]+1.414)}let S=[],g=[],u=[],m=new Map,v=new Map,M=new Ge;function A(C,b,I){let W=(b*(a+1)+C)*2+(I>0?1:0);if(m.has(W))return m.get(W);let H=0,D=0,B=0,k=0,te=a;for(let ve=-3;ve<=2;ve++)for(let we=-3;we<=2;we++){let ze=C+we,je=b+ve;if(we>=-1&&we<=0&&ve>=-1&&ve<=0){if(te=Math.min(te,h(ze,je)?_[je*a+ze]:0),!h(ze,je))continue;let De=(je*a+ze)*4;H+=f[De],D+=f[De+1],B+=f[De+2],k++}}let se=S.length/3,ue=2.17/(a-8);return S.push((C-a/2)*ue,(p-b)*ue+.025,I*(.065+Math.min(.3,Math.max(0,te-.5)*.027))),M.setRGB(H/(k*255),D/(k*255),B/(k*255),Jt),g.push(M.r,M.g,M.b),m.set(W,se),se}function E(C,b){v.has(C)||v.set(C,[]),v.has(b)||v.set(b,[]),v.get(C).push(b),v.get(b).push(C)}function P(C,b,I,W){let H=A(C,b,1),D=A(I,W,1),B=A(C,b,-1),k=A(I,W,-1);u.push(D,H,B,D,B,k),E(H,D),E(B,k)}for(let C=0;C<a;C++)for(let b=0;b<a;b++){if(!h(b,C))continue;let I=A(b,C,1),W=A(b,C+1,1),H=A(b+1,C+1,1),D=A(b+1,C,1);u.push(I,W,H,I,H,D);let B=A(b,C,-1),k=A(b,C+1,-1),te=A(b+1,C+1,-1),se=A(b+1,C,-1);u.push(B,te,k,B,se,te),h(b-1,C)||P(b,C,b,C+1),h(b,C+1)||P(b,C+1,b+1,C+1),h(b+1,C)||P(b+1,C+1,b+1,C),h(b,C-1)||P(b+1,C,b,C)}let x=S.slice();for(let[C,b]of v){if(b.length!==2)continue;let[I,W]=b;for(let H=0;H<2;H++)x[C*3+H]=S[C*3+H]*.52+(S[I*3+H]+S[W*3+H])*.24}let R=new qt;return R.setAttribute("position",new st(x,3)),R.setAttribute("color",new st(g,3)),R.setIndex(u),R.computeVertexNormals(),new Ft(R,new Ha({vertexColors:!0,roughness:.83}))}function zr(t,e,n,i,r,s,o){let a=new Ft(new Va(1,20,14),new _o({color:t}));return a.position.set(e,n,i),a.scale.set(r,s,o),a}function ol(t){let e=new Ft(t.geometry.clone(),new Ti({color:3162706,side:Qt}));return e.scale.setScalar(1.047),t.add(e),t}function FA(){let t=new Yi;t.add(ol(zr(16317695,0,1.03,0,.58,.68,.42))),t.add(ol(zr(16383231,0,1.72,0,.55,.49,.38)));for(let e of[-1,1]){let n=new Ft(new Ba(.22,.45,4),new _o({color:12048878}));n.position.set(e*.37,2.1,0),n.rotation.z=-e*.18,t.add(ol(n)),t.add(ol(zr(11524073,e*.4,.26,.03,.26,.19,.31)));let i=zr(13101044,e*.57,1.05,.1,.21,.39,.23);i.rotation.z=e*.5,t.add(ol(i)),e===-1&&(t.userData.arm=i),t.add(zr(2108986,e*.19,1.77,.365,.045,.07,.035)),t.add(zr(15907254,e*.32,1.58,.35,.09,.045,.025))}return t.add(zr(4544101,0,1.61,.39,.065,.045,.025)),t}function OA(){let[t,e]=(0,nt.useState)(!1),n=(0,nt.useRef)(!1),i=typeof tt<"u"&&typeof tt.playableRecordingSubmission=="function";return(0,nt.useEffect)(()=>{let s=()=>{n.current=!1,e(!1)},o=()=>{document.visibilityState==="visible"&&s()};return document.addEventListener("visibilitychange",o),window.addEventListener("pageshow",s),()=>{document.removeEventListener("visibilitychange",o),window.removeEventListener("pageshow",s)}},[]),{can:i,sub:t,submit:()=>{n.current||!i||(n.current=!0,e(!0),Yn("click"),tt.playableRecordingSubmission({success(){},fail(s){console.error("[post_my_play] failed",(s==null?void 0:s.errMsg)||(s==null?void 0:s.message)),n.current=!1,e(!1)},complete(){}}))}}}function BA(){let[t,e]=(0,nt.useState)(uy),[n,i]=(0,nt.useState)("draw"),[r,s]=(0,nt.useState)([]),o=(0,nt.useRef)([]),[a,l]=(0,nt.useState)(!0),[c,d]=(0,nt.useState)(!0),[f,h]=(0,nt.useState)(""),[p,_]=(0,nt.useState)(0),S=(0,nt.useRef)(null),g=(0,nt.useRef)(null),u=(0,nt.useRef)(null),m=(0,nt.useRef)(null),v=(0,nt.useRef)(null),M=(0,nt.useRef)(null),A=(0,nt.useRef)(null),E=(0,nt.useRef)(null),P=(0,nt.useRef)(null),x=(0,nt.useRef)(null),R=(0,nt.useRef)(null),C=(0,nt.useRef)(null),b=(0,nt.useRef)(null),I=(0,nt.useRef)({x:0,z:0,guard:!1,joyId:null,guardId:null}),W=OA();(0,nt.useEffect)(()=>{DA().then(G=>{if(!G)return;let Z={...uy};for(let me of[...G.tweaks||[],...G.texts||[],...G.images||[]])Z[me.id]=me.value??me.path;e(Z)})},[]),(0,nt.useEffect)(()=>{n==="draw"&&S.current&&Im(S.current.getContext("2d"),r)},[r,n]);let H=r.length>0;(0,nt.useEffect)(()=>{if(n!=="draw"||!H||!g.current)return;let G=g.current,Z;try{Z=new sl({alpha:!0,antialias:!0})}catch{return}Z.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),Z.outputColorSpace=Jt,G.appendChild(Z.domElement);let me=new ho;me.add(new vo(16777215,10201010,1.6));let be=new xo(16777215,1.5);be.position.set(-2,4,5),me.add(be);let Ae=new Dr(-1.48,1.48,1.48,-1.48,.1,20),Ve=cy(G,()=>{let Ze=G.clientWidth,Ot=G.clientHeight;Ze&&Ot&&Z.setSize(Ze,Ot,!1)}),qe={scene:me,camera:Ae,mesh:null},ot=window.matchMedia("(prefers-reduced-motion: reduce)");u.current=qe;let Ue,lt=Ze=>{Ue=requestAnimationFrame(lt),!(document.hidden||al)&&(qe.mesh&&(qe.mesh.rotation.y=ot.matches?0:Math.sin(Ze*.0013)*.55),Z.render(me,Ae))};return Ue=requestAnimationFrame(lt),()=>{cancelAnimationFrame(Ue),Ve(),u.current=null,qe.mesh&&(qe.mesh.geometry.dispose(),qe.mesh.material.dispose()),Z.dispose(),Z.domElement.remove()}},[n,H]),(0,nt.useEffect)(()=>{let G=u.current;if(!G||!r.length)return;G.mesh&&(G.scene.remove(G.mesh),G.mesh.geometry.dispose(),G.mesh.material.dispose()),G.mesh=dy(r),G.scene.add(G.mesh);let Z=new wi().setFromObject(G.mesh),me=(Z.min.y+Z.max.y)/2;G.camera.position.set(0,me+.15,5),G.camera.lookAt(0,me,0)},[n,r]);let D=G=>{let Z=S.current.getBoundingClientRect();return{x:Math.max(0,Math.min(340,(G.clientX-Z.left)*340/Z.width)),y:Math.max(0,Math.min(340,(G.clientY-Z.top)*340/Z.height))}},B=G=>{if(al||G.isPrimary===!1||G.button>0||m.current)return;G.currentTarget.setPointerCapture(G.pointerId);let Z={points:[D(G)]};m.current={id:G.pointerId,stroke:Z},o.current=[...o.current,Z],s([...o.current]),l(!1)},k=G=>{var Z;((Z=m.current)==null?void 0:Z.id)===G.pointerId&&(m.current.stroke.points.push(D(G)),Im(S.current.getContext("2d"),o.current))},te=G=>{var Z;((Z=m.current)==null?void 0:Z.id)===G.pointerId&&(m.current=null,s([...o.current]),Yn("draw"))},se=()=>{var G;o.current.length&&(Yn("click"),(G=window.SFX)==null||G.reset(),I.current={x:0,z:0,guard:!1,joyId:null,guardId:null},h(""),d(p===0),_(Z=>Z+1),i("battle"),console.log("[fight] round started"))},ue=()=>d(!1),ve=G=>{I.current.joyId===null&&(G.currentTarget.setPointerCapture(G.pointerId),I.current.joyId=G.pointerId,I.current.moveSound=!1,we(G))},we=G=>{if(I.current.joyId!==G.pointerId)return;let Z=C.current.getBoundingClientRect(),me=(G.clientX-(Z.left+Z.width/2))/(Z.width*.35),be=(G.clientY-(Z.top+Z.height/2))/(Z.height*.35),Ae=Math.hypot(me,be);Ae>.1&&!I.current.moveSound&&(I.current.moveSound=!0,ue(),Yn("footstep")),Ae>1&&(me/=Ae,be/=Ae),I.current.x=me,I.current.z=be,b.current&&(b.current.style.transform=`translate(${me*32}px,${be*32}px)`)},ze=G=>{I.current.joyId===G.pointerId&&(I.current.joyId=null,I.current.x=0,I.current.z=0,b.current&&(b.current.style.transform="translate(0,0)"))},je=G=>{I.current.guardId!==null||!M.current||M.current.end||M.current.ps<5||(G.currentTarget.setPointerCapture(G.pointerId),I.current.guardId=G.pointerId,I.current.guard=!0,ue(),Yn("click"),G.currentTarget.classList.add("pressed"))},De=G=>{I.current.guardId===G.pointerId&&(I.current.guardId=null,I.current.guard=!1,G.currentTarget.classList.remove("pressed"))},ee=()=>{let G=M.current;!G||G.end||G.pa>0||G.ps<15||(ue(),G.started=!0,G.pa=.72,G.pHit=!1,G.ps-=15,Yn("swoosh"),console.log("[fight] player attack",G.px,G.ax))};return(0,nt.useEffect)(()=>{if(n!=="battle"||!v.current)return;let G=v.current,Z=new ho;Z.background=new Ge(16315625);let me=new cn(38,1,.1,100);me.position.set(0,5.8,10.6),me.lookAt(0,.55,0);let be=new sl({antialias:!0,alpha:!0});be.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),be.outputColorSpace=Jt,G.appendChild(be.domElement),Z.add(new vo(16317695,11117730,1.5));let Ae=new xo(16777215,1.5);Ae.position.set(-3,7,5),Z.add(Ae);let ht=new Ft(new go(3.8,80),new Ti({color:14282482}));ht.rotation.x=-Math.PI/2,Z.add(ht);let Ve=[];for(let $=-7;$<=7;$++){let Q=$*.48,ne=Math.sqrt(Math.max(0,3.8*3.8-Q*Q));Ve.push(Q,.012,-ne,Q,.012,ne,-ne,.012,Q,ne,.012,Q)}let qe=new qt;qe.setAttribute("position",new st(Ve,3));let ot=new Ua(qe,new po({color:11588830,transparent:!0,opacity:.7}));Z.add(ot);let Ue=new Ft(new za(3.78,3.84,80),new Ti({color:11457758,side:Xn}));Ue.rotation.x=-Math.PI/2,Ue.position.y=.02,Z.add(Ue);let lt=dy(o.current),Ze=FA();Z.add(lt,Ze);function Ot(){let $=new Ft(new go(.58,32),new Ti({color:8560298,transparent:!0,opacity:.18}));return $.rotation.x=-Math.PI/2,$.position.y=.025,Z.add($),$}let N=Ot(),At=Ot(),Oe=zr(16766573,0,1.2,0,.28,.28,.28);Oe.visible=!1,Z.add(Oe);let q={px:-1.32,pz:0,ax:1.32,az:0,ph:t.MAX_HEALTH,ah:t.MAX_HEALTH,ps:t.MAX_STAMINA,as:t.MAX_STAMINA,pa:0,pHit:!1,miss:0,aa:0,aHit:!1,aiCool:.7,started:!1,end:!1,flash:0,pk:0,ak:0};M.current=q;let de,dt=0,y=cy(G,()=>{let $=G.clientWidth,Q=G.clientHeight;if(!$||!Q)return;be.setSize($,Q,!1),me.aspect=$/Q;let ne=Ch.degToRad(16.5);me.fov=Math.max(38,Ch.radToDeg(2*Math.atan(Math.tan(ne)/me.aspect))),me.updateProjectionMatrix()}),F=$=>{q.end||(q.end=!0,I.current.guard=!1,I.current.x=0,I.current.z=0,h($?"win":"lose"),Yn("result",!0),console.log("[fight] result",$?"win":"lose"))},K=$=>{de=requestAnimationFrame(K),dt||(dt=$);let Q=Math.min(($-dt)/1e3,.05);if(dt=$,document.visibilityState!=="visible")return;let ne=I.current;if(!q.end&&((Math.hypot(ne.x,ne.z)>.1||ne.guard)&&(q.started=!0),q.started)){let he=q.ax-q.px,fe=q.az-q.pz,ie=Math.hypot(he,fe)||1;Math.hypot(ne.x,ne.z)>.05&&(q.px+=ne.x*t.MOVE_SPEED*Q,q.pz+=ne.z*t.MOVE_SPEED*Q),ie>1.48&&q.aa<=0&&(q.ax-=he/ie*1.35*Q,q.az-=fe/ie*1.35*Q);for(let Ee of["px","ax"])q[Ee]=Math.max(-1.75,Math.min(1.75,q[Ee]));for(let Ee of["pz","az"])q[Ee]=Math.max(-2.2,Math.min(2.2,q[Ee]));if(he=q.ax-q.px,fe=q.az-q.pz,ie=Math.hypot(he,fe)||1,ie<.95){let Ee=(.95-ie)/2;q.px-=he/ie*Ee,q.pz-=fe/ie*Ee,q.ax+=he/ie*Ee,q.az+=fe/ie*Ee}if(q.aiCool-=Q,q.aiCool<=0&&q.aa<=0&&ie<2.1&&q.as>=15&&(q.aa=1.05,q.aHit=!1,q.as-=15,q.aiCool=1.25),q.pa>0&&(q.pa=Math.max(0,q.pa-Q),q.pa<=.43&&!q.pHit&&(q.pHit=!0,ie<=t.ATTACK_RANGE?(q.ah=Math.max(0,q.ah-t.PLAYER_DAMAGE),q.ak=.26,q.ax+=he/ie*.4,q.az+=fe/ie*.4,q.flash=.18,Oe.position.set(q.ax,1.25,q.az+.5),Yn("hit"),q.ah<=0&&F(!0)):q.miss=.78)),q.aa>0&&(q.aa=Math.max(0,q.aa-Q),q.aa<=.38&&!q.aHit&&(q.aHit=!0,ie<=t.ATTACK_RANGE))){let Ee=ne.guard&&q.ps>=8;q.ph=Math.max(0,q.ph-(Ee?t.AI_DAMAGE*.2:t.AI_DAMAGE)),Ee&&(q.ps-=8),q.pk=.25,q.px-=he/ie*(Ee?.15:.38),q.pz-=fe/ie*(Ee?.15:.38),q.flash=.18,Oe.position.set(q.px,1.2,q.pz+.5),Yn(Ee?"block":"hit"),q.ph<=0&&F(!1)}q.ps=Math.min(t.MAX_STAMINA,q.ps+Q*(ne.guard?2:13)),q.as=Math.min(t.MAX_STAMINA,q.as+Q*12),q.pk=Math.max(0,q.pk-Q),q.ak=Math.max(0,q.ak-Q),q.flash=Math.max(0,q.flash-Q),q.miss=Math.max(0,q.miss-Q)}let Y=q.ax<q.px?-1:1,j=q.pa>.43?0:Math.sin(Math.PI*q.pa/.43);lt.position.set(q.px+Y*j*.24,0,q.pz),lt.rotation.z=q.pk*1.5+Y*(ne.guard?.16:q.pa>.43?.13:-j*.22),lt.rotation.y=Y*.35,lt.scale.set(1+j*.08,ne.guard?.91:1-j*.04,1),A.current&&(A.current.hidden=q.miss<=0),Ze.position.set(q.ax,0,q.az),Ze.rotation.z=-q.ak*1.5,Ze.rotation.y=q.px<q.ax?-.25:.25,Ze.userData.arm.rotation.z=q.aa>.38?-1.8:q.aa>0?1.1:-.5,Ze.scale.setScalar(q.aa>.38?1+.07*Math.sin($*.025):1),N.position.x=q.px,N.position.z=q.pz,At.position.x=q.ax,At.position.z=q.az,Oe.visible=q.flash>0,Oe.scale.setScalar(.28*(1+Math.sin($*.05)*.2)),E.current&&(E.current.style.width=q.ph/t.MAX_HEALTH*100+"%",P.current.style.width=q.ah/t.MAX_HEALTH*100+"%",x.current.style.width=q.ps/t.MAX_STAMINA*100+"%",R.current.style.width=q.as/t.MAX_STAMINA*100+"%",G.dataset.playerHp=Math.round(q.ph),G.dataset.aiHp=Math.round(q.ah),G.dataset.distance=kA(q),G.dataset.guard=String(ne.guard),G.dataset.started=String(q.started)),be.render(Z,me)};return de=requestAnimationFrame(K),()=>{cancelAnimationFrame(de),y(),M.current=null,Z.traverse($=>{var Q;(Q=$.geometry)==null||Q.dispose(),$.material&&(Array.isArray($.material)?$.material:[$.material]).forEach(ne=>{var Y;(Y=ne.map)==null||Y.dispose(),ne.dispose()})}),be.dispose(),be.domElement.remove()}},[n,p,t]),(0,Le.jsxs)("div",{className:"app",children:[(0,Le.jsx)("style",{children:`@font-face {
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
*{box-sizing:border-box} .app{position:relative;width:100%;height:100%;container-type:size;overflow:clip;background:#f8f4e9;color:#303440;font-family:var(--font-body);touch-action:none}.draw-stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10% 30px 50px}.hint{font-family:var(--font-display);font-size:18px;letter-spacing:.5px;text-align:center;color:#343946;text-shadow:0 2px #fff;line-height:1.2;max-width:100%}.draw-hint{margin-bottom:16px;animation:breathe 2.4s ease-in-out infinite}.paper-wrap{width:min(100%,340px,48cqb);aspect-ratio:1;position:relative;background:#fffdf8;border:3px solid #343946;border-radius:9px;box-shadow:6px 7px 0 #e1d9ca, 7px 8px 0 #343946;overflow:hidden}.paper{width:100%;height:100%;display:block;touch-action:none;background-image:radial-gradient(#e9e6de 1px,transparent 1px);background-size:16px 16px}.paper-mark{position:absolute;right:12px;bottom:10px;color:#d4d0c7;font-family:var(--font-display);font-size:14px;pointer-events:none}.tools{width:min(100%,340px);margin-top:22px}.fighter-preview{width:64px;height:64px;flex:none;border:2px solid #c5d9dd;border-radius:12px;background:#e6f2f3;overflow:hidden}.fighter-preview canvas{display:block;width:100%;height:100%}button{font-family:var(--font-display);letter-spacing:.5px;cursor:pointer;touch-action:none}.actions{display:flex;gap:9px;align-items:center}.btn{border:2px solid #353944;border-radius:13px;background:#fffdf8;color:#353944;box-shadow:0 3px 0 #353944;font-size:18px;padding:10px 14px;min-height:46px}.actions .btn{flex:1}.btn.primary{background:#b9dfe9}.btn:disabled{opacity:.35;box-shadow:none}.arena{position:absolute;inset:0}.arena canvas{display:block;width:100%;height:100%}.hud{position:absolute;top:max(22px,env(safe-area-inset-top));left:24px;right:24px;display:flex;gap:22px;pointer-events:none}.meter{flex:1}.bar{height:17px;background:#e1c9bd;border:2px solid #363d46;border-radius:20px;overflow:hidden;box-shadow:0 2px 0 #fff}.bar>div{height:100%;background:#7ab7d4;transition:width .12s}.meter.cat .bar>div{background:#efa574}.stamina{height:7px;margin:5px 8px 0;background:#d6e1cf;border-radius:8px;overflow:hidden}.stamina>div{height:100%;width:100%;background:#78bb82}.meter.cat .bar>div,.meter.cat .stamina>div{float:right}.battle-hint{position:absolute;top:16%;left:0;right:0;font-size:20px;pointer-events:none}.controls{position:absolute;left:24px;right:24px;bottom:50px;display:flex;justify-content:space-between;align-items:end;gap:15px}.joystick{width:120px;height:120px;border-radius:50%;border:2px solid #9db5b9;background:#e4f1f0bb;display:grid;place-items:center;touch-action:none}.knob{width:52px;height:52px;border-radius:50%;background:#a9ced8;border:2px solid #526772;box-shadow:0 3px 0 #526772;pointer-events:none}.fight-buttons{display:flex;gap:10px;align-items:end}.fight-btn{width:72px;height:72px;border-radius:50%;border:2px solid #343946;background:#f7d2aa;color:#343946;box-shadow:0 4px 0 #343946;font-size:17px;touch-action:none}.fight-btn.guard{background:#c5e0e7;width:66px;height:66px}.fight-btn:active,.fight-btn.pressed{transform:translateY(3px);box-shadow:0 1px 0 #343946}.result-layer{position:absolute;inset:0;background:#f8f4e9a8;display:flex;align-items:center;justify-content:center}.result-box{text-align:center;padding:25px}.result-title{font:400 42px var(--font-display);color:#343946;text-shadow:2px 3px #fff;margin:0 0 20px}.result-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}.result-actions .btn{min-width:120px}.edit{display:block;margin:16px auto 0;background:transparent;border:0;text-decoration:underline;color:#4d5d63;font:400 18px var(--font-display)}[data-feed-cover="true"] .draw-stage{justify-content:flex-start;padding-top:22%}
.preview-sketch{display:none;position:absolute;inset:0;width:100%;height:100%;color:#343946;pointer-events:none}
[data-feed-cover="true"] .preview-sketch{display:block}
[data-feed-cover="true"] .tools{visibility:hidden}
.preview-sketch>path{fill:none;stroke:currentColor;stroke-width:9;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;animation:sketch-outline 4.8s ease-in-out infinite}
.preview-sketch-face{fill:currentColor;animation:sketch-face 4.8s ease-in-out infinite}
.battle-hint{animation:breathe 2.4s ease-in-out infinite}.range-hint{position:absolute;top:16%;left:24px;right:24px;color:#934837;pointer-events:none}
@media(max-width:350px){.controls{gap:8px}.joystick{width:94px;height:94px}.fight-btn,.fight-btn.guard{width:57px;height:57px}.fighter-preview{width:54px;height:54px}}
@keyframes sketch-outline{0%,8%{stroke-dashoffset:1;opacity:0}12%{opacity:1}54%,82%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes sketch-face{0%,52%,100%{opacity:0}63%,82%{opacity:1}}
@media(prefers-reduced-motion:reduce){.preview-sketch>path,.preview-sketch-face,.battle-hint{animation:none}}
@keyframes breathe{50%{transform:scale(1.04);opacity:.8}}@media(prefers-reduced-motion:reduce){.draw-hint{animation:none}*{transition:none!important}}@media(max-height:500px){.draw-stage{padding-top:12px;padding-bottom:15px}.paper-wrap{width:min(100%,340px,46cqb)}.tools{margin-top:10px}.fighter-preview{height:52px;width:52px}.draw-hint{margin-bottom:8px}.joystick{width:95px;height:95px}}`}),n==="draw"?(0,Le.jsxs)("div",{className:"draw-stage",children:[(0,Le.jsx)("div",{className:"hint draw-hint",style:{visibility:a?"visible":"hidden"},children:t.DRAW_HINT}),(0,Le.jsxs)("div",{className:"paper-wrap",children:[(0,Le.jsx)("canvas",{ref:S,className:"paper",width:"340",height:"340","aria-label":"Drawing canvas",onPointerDown:B,onPointerMove:k,onPointerUp:te,onPointerCancel:te,onLostPointerCapture:te}),(0,Le.jsxs)("svg",{className:"preview-sketch",viewBox:"0 0 340 340","aria-hidden":"true",children:[(0,Le.jsx)("path",{pathLength:"1",d:"M93 171Q78 151 99 128L111 72Q115 60 128 71L157 101Q181 94 204 103L235 75Q246 68 250 84L254 140Q269 167 253 183Q267 213 251 245Q244 268 220 265L207 239Q184 250 160 239L145 264Q122 270 110 253Q96 232 104 207Q69 211 65 191Q64 172 93 171Z"}),(0,Le.jsxs)("g",{className:"preview-sketch-face",children:[(0,Le.jsx)("circle",{cx:"145",cy:"149",r:"6"}),(0,Le.jsx)("circle",{cx:"211",cy:"149",r:"6"}),(0,Le.jsx)("path",{d:"M167 169Q177 179 188 169",fill:"none",stroke:"currentColor",strokeWidth:"5",strokeLinecap:"round"})]})]})]}),(0,Le.jsx)("div",{className:"tools",children:(0,Le.jsxs)("div",{className:"actions",children:[H&&(0,Le.jsx)("div",{className:"fighter-preview",ref:g,role:"img","aria-label":"3D fighter preview"}),(0,Le.jsx)("button",{className:"btn",disabled:!r.length,onClick:()=>{o.current=o.current.slice(0,-1),s([...o.current]),Yn("click")},children:t.UNDO}),(0,Le.jsx)("button",{className:"btn",disabled:!r.length,onClick:()=>{o.current=[],s([]),Yn("click")},children:t.CLEAR}),(0,Le.jsx)("button",{className:"btn primary",disabled:!r.length,onClick:se,children:t.FIGHT})]})})]}):(0,Le.jsxs)(Le.Fragment,{children:[(0,Le.jsx)("div",{className:"arena",ref:v,"aria-label":"Fighting arena"}),(0,Le.jsx)("div",{className:"hint range-hint",ref:A,hidden:!0,role:"status",children:"Move closer"}),(0,Le.jsxs)("div",{className:"hud",children:[(0,Le.jsxs)("div",{className:"meter",children:[(0,Le.jsx)("div",{className:"bar",children:(0,Le.jsx)("div",{ref:E})}),(0,Le.jsx)("div",{className:"stamina",children:(0,Le.jsx)("div",{ref:x})})]}),(0,Le.jsxs)("div",{className:"meter cat",children:[(0,Le.jsx)("div",{className:"bar",children:(0,Le.jsx)("div",{ref:P})}),(0,Le.jsx)("div",{className:"stamina",children:(0,Le.jsx)("div",{ref:R})})]})]}),c&&!f&&(0,Le.jsx)("div",{className:"hint battle-hint",children:t.BATTLE_HINT}),(0,Le.jsxs)("div",{className:"controls",children:[(0,Le.jsx)("div",{className:"joystick",ref:C,"aria-label":"Move",onPointerDown:ve,onPointerMove:we,onPointerUp:ze,onPointerCancel:ze,children:(0,Le.jsx)("div",{className:"knob",ref:b})}),(0,Le.jsxs)("div",{className:"fight-buttons",children:[(0,Le.jsx)("button",{className:"fight-btn guard",onPointerDown:je,onPointerUp:De,onPointerCancel:De,children:t.GUARD}),(0,Le.jsx)("button",{className:"fight-btn",onClick:ee,children:t.ATTACK})]})]}),f&&(0,Le.jsx)("div",{className:"result-layer",children:(0,Le.jsxs)("div",{className:"result-box",children:[(0,Le.jsx)("h1",{className:"result-title",children:f==="win"?t.WIN:t.LOSE}),(0,Le.jsxs)("div",{className:"result-actions",children:[(0,Le.jsx)("button",{className:"btn primary",onClick:se,children:t.REPLAY}),W.can&&(0,Le.jsx)("button",{className:"btn primary",disabled:W.sub,style:{opacity:W.sub?.55:1,pointerEvents:W.sub?"none":"auto"},onClick:W.submit,children:"Post my play"})]}),(0,Le.jsx)("button",{className:"edit",onClick:()=>{Yn("click"),i("draw"),l(!1)},children:t.EDIT})]})})]})]})}function kA(t){return Math.hypot(t.ax-t.px,t.az-t.pz).toFixed(2)}(0,fy.createRoot)(document.getElementById("root")).render((0,Le.jsx)(BA,{}));})();
