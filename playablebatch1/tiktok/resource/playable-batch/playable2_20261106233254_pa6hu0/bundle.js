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
(()=>{var SS=Object.create;var Rg=Object.defineProperty;var MS=Object.getOwnPropertyDescriptor;var wS=Object.getOwnPropertyNames;var ES=Object.getPrototypeOf,TS=Object.prototype.hasOwnProperty;var Li=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var bS=(t,e,n,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of wS(e))!TS.call(t,r)&&r!==n&&Rg(t,r,{get:()=>e[r],enumerable:!(i=MS(e,r))||i.enumerable});return t};var Pl=(t,e,n)=>(n=t!=null?SS(ES(t)):{},bS(e||!t||!t.__esModule?Rg(n,"default",{value:t,enumerable:!0}):n,t));var Vg=Li(nt=>{"use strict";var ko=Symbol.for("react.element"),AS=Symbol.for("react.portal"),CS=Symbol.for("react.fragment"),RS=Symbol.for("react.strict_mode"),PS=Symbol.for("react.profiler"),IS=Symbol.for("react.provider"),LS=Symbol.for("react.context"),NS=Symbol.for("react.forward_ref"),DS=Symbol.for("react.suspense"),US=Symbol.for("react.memo"),FS=Symbol.for("react.lazy"),Pg=Symbol.iterator;function OS(t){return t===null||typeof t!="object"?null:(t=Pg&&t[Pg]||t["@@iterator"],typeof t=="function"?t:null)}var Ng={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},Dg=Object.assign,Ug={};function Es(t,e,n){this.props=t,this.context=e,this.refs=Ug,this.updater=n||Ng}Es.prototype.isReactComponent={};Es.prototype.setState=function(t,e){if(typeof t!="object"&&typeof t!="function"&&t!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,t,e,"setState")};Es.prototype.forceUpdate=function(t){this.updater.enqueueForceUpdate(this,t,"forceUpdate")};function Fg(){}Fg.prototype=Es.prototype;function vd(t,e,n){this.props=t,this.context=e,this.refs=Ug,this.updater=n||Ng}var xd=vd.prototype=new Fg;xd.constructor=vd;Dg(xd,Es.prototype);xd.isPureReactComponent=!0;var Ig=Array.isArray,Og=Object.prototype.hasOwnProperty,yd={current:null},Bg={key:!0,ref:!0,__self:!0,__source:!0};function kg(t,e,n){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)Og.call(e,i)&&!Bg.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=n;else if(1<a){for(var l=Array(a),c=0;c<a;c++)l[c]=arguments[c+2];r.children=l}if(t&&t.defaultProps)for(i in a=t.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:ko,type:t,key:s,ref:o,props:r,_owner:yd.current}}function BS(t,e){return{$$typeof:ko,type:t.type,key:e,ref:t.ref,props:t.props,_owner:t._owner}}function Sd(t){return typeof t=="object"&&t!==null&&t.$$typeof===ko}function kS(t){var e={"=":"=0",":":"=2"};return"$"+t.replace(/[=:]/g,function(n){return e[n]})}var Lg=/\/+/g;function _d(t,e){return typeof t=="object"&&t!==null&&t.key!=null?kS(""+t.key):e.toString(36)}function Ll(t,e,n,i,r){var s=typeof t;(s==="undefined"||s==="boolean")&&(t=null);var o=!1;if(t===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(t.$$typeof){case ko:case AS:o=!0}}if(o)return o=t,r=r(o),t=i===""?"."+_d(o,0):i,Ig(r)?(n="",t!=null&&(n=t.replace(Lg,"$&/")+"/"),Ll(r,e,n,"",function(c){return c})):r!=null&&(Sd(r)&&(r=BS(r,n+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(Lg,"$&/")+"/")+t)),e.push(r)),1;if(o=0,i=i===""?".":i+":",Ig(t))for(var a=0;a<t.length;a++){s=t[a];var l=i+_d(s,a);o+=Ll(s,e,n,l,r)}else if(l=OS(t),typeof l=="function")for(t=l.call(t),a=0;!(s=t.next()).done;)s=s.value,l=i+_d(s,a++),o+=Ll(s,e,n,l,r);else if(s==="object")throw e=String(t),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function Il(t,e,n){if(t==null)return t;var i=[],r=0;return Ll(t,i,"","",function(s){return e.call(n,s,r++)}),i}function zS(t){if(t._status===-1){var e=t._result;e=e(),e.then(function(n){(t._status===0||t._status===-1)&&(t._status=1,t._result=n)},function(n){(t._status===0||t._status===-1)&&(t._status=2,t._result=n)}),t._status===-1&&(t._status=0,t._result=e)}if(t._status===1)return t._result.default;throw t._result}var dn={current:null},Nl={transition:null},VS={ReactCurrentDispatcher:dn,ReactCurrentBatchConfig:Nl,ReactCurrentOwner:yd};function zg(){throw Error("act(...) is not supported in production builds of React.")}nt.Children={map:Il,forEach:function(t,e,n){Il(t,function(){e.apply(this,arguments)},n)},count:function(t){var e=0;return Il(t,function(){e++}),e},toArray:function(t){return Il(t,function(e){return e})||[]},only:function(t){if(!Sd(t))throw Error("React.Children.only expected to receive a single React element child.");return t}};nt.Component=Es;nt.Fragment=CS;nt.Profiler=PS;nt.PureComponent=vd;nt.StrictMode=RS;nt.Suspense=DS;nt.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=VS;nt.act=zg;nt.cloneElement=function(t,e,n){if(t==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+t+".");var i=Dg({},t.props),r=t.key,s=t.ref,o=t._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=yd.current),e.key!==void 0&&(r=""+e.key),t.type&&t.type.defaultProps)var a=t.type.defaultProps;for(l in e)Og.call(e,l)&&!Bg.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=n;else if(1<l){a=Array(l);for(var c=0;c<l;c++)a[c]=arguments[c+2];i.children=a}return{$$typeof:ko,type:t.type,key:r,ref:s,props:i,_owner:o}};nt.createContext=function(t){return t={$$typeof:LS,_currentValue:t,_currentValue2:t,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},t.Provider={$$typeof:IS,_context:t},t.Consumer=t};nt.createElement=kg;nt.createFactory=function(t){var e=kg.bind(null,t);return e.type=t,e};nt.createRef=function(){return{current:null}};nt.forwardRef=function(t){return{$$typeof:NS,render:t}};nt.isValidElement=Sd;nt.lazy=function(t){return{$$typeof:FS,_payload:{_status:-1,_result:t},_init:zS}};nt.memo=function(t,e){return{$$typeof:US,type:t,compare:e===void 0?null:e}};nt.startTransition=function(t){var e=Nl.transition;Nl.transition={};try{t()}finally{Nl.transition=e}};nt.unstable_act=zg;nt.useCallback=function(t,e){return dn.current.useCallback(t,e)};nt.useContext=function(t){return dn.current.useContext(t)};nt.useDebugValue=function(){};nt.useDeferredValue=function(t){return dn.current.useDeferredValue(t)};nt.useEffect=function(t,e){return dn.current.useEffect(t,e)};nt.useId=function(){return dn.current.useId()};nt.useImperativeHandle=function(t,e,n){return dn.current.useImperativeHandle(t,e,n)};nt.useInsertionEffect=function(t,e){return dn.current.useInsertionEffect(t,e)};nt.useLayoutEffect=function(t,e){return dn.current.useLayoutEffect(t,e)};nt.useMemo=function(t,e){return dn.current.useMemo(t,e)};nt.useReducer=function(t,e,n){return dn.current.useReducer(t,e,n)};nt.useRef=function(t){return dn.current.useRef(t)};nt.useState=function(t){return dn.current.useState(t)};nt.useSyncExternalStore=function(t,e,n){return dn.current.useSyncExternalStore(t,e,n)};nt.useTransition=function(){return dn.current.useTransition()};nt.version="18.3.1"});var Dl=Li((pR,Gg)=>{"use strict";Gg.exports=Vg()});var jg=Li(gt=>{"use strict";function Td(t,e){var n=t.length;t.push(e);e:for(;0<n;){var i=n-1>>>1,r=t[i];if(0<Ul(r,e))t[i]=e,t[n]=r,n=i;else break e}}function ei(t){return t.length===0?null:t[0]}function Ol(t){if(t.length===0)return null;var e=t[0],n=t.pop();if(n!==e){t[0]=n;e:for(var i=0,r=t.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=t[o],l=o+1,c=t[l];if(0>Ul(a,n))l<r&&0>Ul(c,a)?(t[i]=c,t[l]=n,i=l):(t[i]=a,t[o]=n,i=o);else if(l<r&&0>Ul(c,n))t[i]=c,t[l]=n,i=l;else break e}}return e}function Ul(t,e){var n=t.sortIndex-e.sortIndex;return n!==0?n:t.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(Hg=performance,gt.unstable_now=function(){return Hg.now()}):(Md=Date,Wg=Md.now(),gt.unstable_now=function(){return Md.now()-Wg});var Hg,Md,Wg,_i=[],sr=[],GS=1,Hn=null,rn=3,Bl=!1,qr=!1,Vo=!1,Yg=typeof setTimeout=="function"?setTimeout:null,Zg=typeof clearTimeout=="function"?clearTimeout:null,Xg=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function bd(t){for(var e=ei(sr);e!==null;){if(e.callback===null)Ol(sr);else if(e.startTime<=t)Ol(sr),e.sortIndex=e.expirationTime,Td(_i,e);else break;e=ei(sr)}}function Ad(t){if(Vo=!1,bd(t),!qr)if(ei(_i)!==null)qr=!0,Rd(Cd);else{var e=ei(sr);e!==null&&Pd(Ad,e.startTime-t)}}function Cd(t,e){qr=!1,Vo&&(Vo=!1,Zg(Go),Go=-1),Bl=!0;var n=rn;try{for(bd(e),Hn=ei(_i);Hn!==null&&(!(Hn.expirationTime>e)||t&&!Kg());){var i=Hn.callback;if(typeof i=="function"){Hn.callback=null,rn=Hn.priorityLevel;var r=i(Hn.expirationTime<=e);e=gt.unstable_now(),typeof r=="function"?Hn.callback=r:Hn===ei(_i)&&Ol(_i),bd(e)}else Ol(_i);Hn=ei(_i)}if(Hn!==null)var s=!0;else{var o=ei(sr);o!==null&&Pd(Ad,o.startTime-e),s=!1}return s}finally{Hn=null,rn=n,Bl=!1}}var kl=!1,Fl=null,Go=-1,$g=5,Jg=-1;function Kg(){return!(gt.unstable_now()-Jg<$g)}function wd(){if(Fl!==null){var t=gt.unstable_now();Jg=t;var e=!0;try{e=Fl(!0,t)}finally{e?zo():(kl=!1,Fl=null)}}else kl=!1}var zo;typeof Xg=="function"?zo=function(){Xg(wd)}:typeof MessageChannel<"u"?(Ed=new MessageChannel,qg=Ed.port2,Ed.port1.onmessage=wd,zo=function(){qg.postMessage(null)}):zo=function(){Yg(wd,0)};var Ed,qg;function Rd(t){Fl=t,kl||(kl=!0,zo())}function Pd(t,e){Go=Yg(function(){t(gt.unstable_now())},e)}gt.unstable_IdlePriority=5;gt.unstable_ImmediatePriority=1;gt.unstable_LowPriority=4;gt.unstable_NormalPriority=3;gt.unstable_Profiling=null;gt.unstable_UserBlockingPriority=2;gt.unstable_cancelCallback=function(t){t.callback=null};gt.unstable_continueExecution=function(){qr||Bl||(qr=!0,Rd(Cd))};gt.unstable_forceFrameRate=function(t){0>t||125<t?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):$g=0<t?Math.floor(1e3/t):5};gt.unstable_getCurrentPriorityLevel=function(){return rn};gt.unstable_getFirstCallbackNode=function(){return ei(_i)};gt.unstable_next=function(t){switch(rn){case 1:case 2:case 3:var e=3;break;default:e=rn}var n=rn;rn=e;try{return t()}finally{rn=n}};gt.unstable_pauseExecution=function(){};gt.unstable_requestPaint=function(){};gt.unstable_runWithPriority=function(t,e){switch(t){case 1:case 2:case 3:case 4:case 5:break;default:t=3}var n=rn;rn=t;try{return e()}finally{rn=n}};gt.unstable_scheduleCallback=function(t,e,n){var i=gt.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,t){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=n+r,t={id:GS++,callback:e,priorityLevel:t,startTime:n,expirationTime:r,sortIndex:-1},n>i?(t.sortIndex=n,Td(sr,t),ei(_i)===null&&t===ei(sr)&&(Vo?(Zg(Go),Go=-1):Vo=!0,Pd(Ad,n-i))):(t.sortIndex=r,Td(_i,t),qr||Bl||(qr=!0,Rd(Cd))),t};gt.unstable_shouldYield=Kg;gt.unstable_wrapCallback=function(t){var e=rn;return function(){var n=rn;rn=e;try{return t.apply(this,arguments)}finally{rn=n}}}});var e0=Li((gR,Qg)=>{"use strict";Qg.exports=jg()});var rx=Li(Nn=>{"use strict";var HS=Dl(),In=e0();function me(t){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+t,n=1;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n]);return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var a_=new Set,ua={};function ss(t,e){Xs(t,e),Xs(t+"Capture",e)}function Xs(t,e){for(ua[t]=e,t=0;t<e.length;t++)a_.add(e[t])}var Bi=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),Qd=Object.prototype.hasOwnProperty,WS=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,t0={},n0={};function XS(t){return Qd.call(n0,t)?!0:Qd.call(t0,t)?!1:WS.test(t)?n0[t]=!0:(t0[t]=!0,!1)}function qS(t,e,n,i){if(n!==null&&n.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:n!==null?!n.acceptsBooleans:(t=t.toLowerCase().slice(0,5),t!=="data-"&&t!=="aria-");default:return!1}}function YS(t,e,n,i){if(e===null||typeof e>"u"||qS(t,e,n,i))return!0;if(i)return!1;if(n!==null)switch(n.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function mn(t,e,n,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=n,this.propertyName=t,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var $t={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t){$t[t]=new mn(t,0,!1,t,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(t){var e=t[0];$t[e]=new mn(e,1,!1,t[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(t){$t[t]=new mn(t,2,!1,t.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(t){$t[t]=new mn(t,2,!1,t,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t){$t[t]=new mn(t,3,!1,t.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(t){$t[t]=new mn(t,3,!0,t,null,!1,!1)});["capture","download"].forEach(function(t){$t[t]=new mn(t,4,!1,t,null,!1,!1)});["cols","rows","size","span"].forEach(function(t){$t[t]=new mn(t,6,!1,t,null,!1,!1)});["rowSpan","start"].forEach(function(t){$t[t]=new mn(t,5,!1,t.toLowerCase(),null,!1,!1)});var qf=/[\-:]([a-z])/g;function Yf(t){return t[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t){var e=t.replace(qf,Yf);$t[e]=new mn(e,1,!1,t,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t){var e=t.replace(qf,Yf);$t[e]=new mn(e,1,!1,t,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(t){var e=t.replace(qf,Yf);$t[e]=new mn(e,1,!1,t,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(t){$t[t]=new mn(t,1,!1,t.toLowerCase(),null,!1,!1)});$t.xlinkHref=new mn("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(t){$t[t]=new mn(t,1,!1,t.toLowerCase(),null,!0,!0)});function Zf(t,e,n,i){var r=$t.hasOwnProperty(e)?$t[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(YS(e,n,r,i)&&(n=null),i||r===null?XS(e)&&(n===null?t.removeAttribute(e):t.setAttribute(e,""+n)):r.mustUseProperty?t[r.propertyName]=n===null?r.type===3?!1:"":n:(e=r.attributeName,i=r.attributeNamespace,n===null?t.removeAttribute(e):(r=r.type,n=r===3||r===4&&n===!0?"":""+n,i?t.setAttributeNS(i,e,n):t.setAttribute(e,n))))}var Gi=HS.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,zl=Symbol.for("react.element"),As=Symbol.for("react.portal"),Cs=Symbol.for("react.fragment"),$f=Symbol.for("react.strict_mode"),ef=Symbol.for("react.profiler"),l_=Symbol.for("react.provider"),c_=Symbol.for("react.context"),Jf=Symbol.for("react.forward_ref"),tf=Symbol.for("react.suspense"),nf=Symbol.for("react.suspense_list"),Kf=Symbol.for("react.memo"),ar=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var u_=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var i0=Symbol.iterator;function Ho(t){return t===null||typeof t!="object"?null:(t=i0&&t[i0]||t["@@iterator"],typeof t=="function"?t:null)}var bt=Object.assign,Id;function Ko(t){if(Id===void 0)try{throw Error()}catch(n){var e=n.stack.trim().match(/\n( *(at )?)/);Id=e&&e[1]||""}return`
`+Id+t}var Ld=!1;function Nd(t,e){if(!t||Ld)return"";Ld=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(c){var i=c}Reflect.construct(t,[],e)}else{try{e.call()}catch(c){i=c}t.call(e.prototype)}else{try{throw Error()}catch(c){i=c}t()}}catch(c){if(c&&i&&typeof c.stack=="string"){for(var r=c.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return t.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",t.displayName)),l}while(1<=o&&0<=a);break}}}finally{Ld=!1,Error.prepareStackTrace=n}return(t=t?t.displayName||t.name:"")?Ko(t):""}function ZS(t){switch(t.tag){case 5:return Ko(t.type);case 16:return Ko("Lazy");case 13:return Ko("Suspense");case 19:return Ko("SuspenseList");case 0:case 2:case 15:return t=Nd(t.type,!1),t;case 11:return t=Nd(t.type.render,!1),t;case 1:return t=Nd(t.type,!0),t;default:return""}}function rf(t){if(t==null)return null;if(typeof t=="function")return t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case Cs:return"Fragment";case As:return"Portal";case ef:return"Profiler";case $f:return"StrictMode";case tf:return"Suspense";case nf:return"SuspenseList"}if(typeof t=="object")switch(t.$$typeof){case c_:return(t.displayName||"Context")+".Consumer";case l_:return(t._context.displayName||"Context")+".Provider";case Jf:var e=t.render;return t=t.displayName,t||(t=e.displayName||e.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case Kf:return e=t.displayName||null,e!==null?e:rf(t.type)||"Memo";case ar:e=t._payload,t=t._init;try{return rf(t(e))}catch{}}return null}function $S(t){var e=t.type;switch(t.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return t=e.render,t=t.displayName||t.name||"",e.displayName||(t!==""?"ForwardRef("+t+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return rf(e);case 8:return e===$f?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function Sr(t){switch(typeof t){case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function h_(t){var e=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function JS(t){var e=h_(t)?"checked":"value",n=Object.getOwnPropertyDescriptor(t.constructor.prototype,e),i=""+t[e];if(!t.hasOwnProperty(e)&&typeof n<"u"&&typeof n.get=="function"&&typeof n.set=="function"){var r=n.get,s=n.set;return Object.defineProperty(t,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(t,e,{enumerable:n.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){t._valueTracker=null,delete t[e]}}}}function Vl(t){t._valueTracker||(t._valueTracker=JS(t))}function d_(t){if(!t)return!1;var e=t._valueTracker;if(!e)return!0;var n=e.getValue(),i="";return t&&(i=h_(t)?t.checked?"true":"false":t.value),t=i,t!==n?(e.setValue(t),!0):!1}function mc(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}function sf(t,e){var n=e.checked;return bt({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??t._wrapperState.initialChecked})}function r0(t,e){var n=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;n=Sr(e.value!=null?e.value:n),t._wrapperState={initialChecked:i,initialValue:n,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function f_(t,e){e=e.checked,e!=null&&Zf(t,"checked",e,!1)}function of(t,e){f_(t,e);var n=Sr(e.value),i=e.type;if(n!=null)i==="number"?(n===0&&t.value===""||t.value!=n)&&(t.value=""+n):t.value!==""+n&&(t.value=""+n);else if(i==="submit"||i==="reset"){t.removeAttribute("value");return}e.hasOwnProperty("value")?af(t,e.type,n):e.hasOwnProperty("defaultValue")&&af(t,e.type,Sr(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(t.defaultChecked=!!e.defaultChecked)}function s0(t,e,n){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+t._wrapperState.initialValue,n||e===t.value||(t.value=e),t.defaultValue=e}n=t.name,n!==""&&(t.name=""),t.defaultChecked=!!t._wrapperState.initialChecked,n!==""&&(t.name=n)}function af(t,e,n){(e!=="number"||mc(t.ownerDocument)!==t)&&(n==null?t.defaultValue=""+t._wrapperState.initialValue:t.defaultValue!==""+n&&(t.defaultValue=""+n))}var jo=Array.isArray;function ks(t,e,n,i){if(t=t.options,e){e={};for(var r=0;r<n.length;r++)e["$"+n[r]]=!0;for(n=0;n<t.length;n++)r=e.hasOwnProperty("$"+t[n].value),t[n].selected!==r&&(t[n].selected=r),r&&i&&(t[n].defaultSelected=!0)}else{for(n=""+Sr(n),e=null,r=0;r<t.length;r++){if(t[r].value===n){t[r].selected=!0,i&&(t[r].defaultSelected=!0);return}e!==null||t[r].disabled||(e=t[r])}e!==null&&(e.selected=!0)}}function lf(t,e){if(e.dangerouslySetInnerHTML!=null)throw Error(me(91));return bt({},e,{value:void 0,defaultValue:void 0,children:""+t._wrapperState.initialValue})}function o0(t,e){var n=e.value;if(n==null){if(n=e.children,e=e.defaultValue,n!=null){if(e!=null)throw Error(me(92));if(jo(n)){if(1<n.length)throw Error(me(93));n=n[0]}e=n}e==null&&(e=""),n=e}t._wrapperState={initialValue:Sr(n)}}function p_(t,e){var n=Sr(e.value),i=Sr(e.defaultValue);n!=null&&(n=""+n,n!==t.value&&(t.value=n),e.defaultValue==null&&t.defaultValue!==n&&(t.defaultValue=n)),i!=null&&(t.defaultValue=""+i)}function a0(t){var e=t.textContent;e===t._wrapperState.initialValue&&e!==""&&e!==null&&(t.value=e)}function m_(t){switch(t){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function cf(t,e){return t==null||t==="http://www.w3.org/1999/xhtml"?m_(e):t==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":t}var Gl,g_=function(t){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,n,i,r){MSApp.execUnsafeLocalFunction(function(){return t(e,n,i,r)})}:t}(function(t,e){if(t.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in t)t.innerHTML=e;else{for(Gl=Gl||document.createElement("div"),Gl.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=Gl.firstChild;t.firstChild;)t.removeChild(t.firstChild);for(;e.firstChild;)t.appendChild(e.firstChild)}});function ha(t,e){if(e){var n=t.firstChild;if(n&&n===t.lastChild&&n.nodeType===3){n.nodeValue=e;return}}t.textContent=e}var ta={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},KS=["Webkit","ms","Moz","O"];Object.keys(ta).forEach(function(t){KS.forEach(function(e){e=e+t.charAt(0).toUpperCase()+t.substring(1),ta[e]=ta[t]})});function __(t,e,n){return e==null||typeof e=="boolean"||e===""?"":n||typeof e!="number"||e===0||ta.hasOwnProperty(t)&&ta[t]?(""+e).trim():e+"px"}function v_(t,e){t=t.style;for(var n in e)if(e.hasOwnProperty(n)){var i=n.indexOf("--")===0,r=__(n,e[n],i);n==="float"&&(n="cssFloat"),i?t.setProperty(n,r):t[n]=r}}var jS=bt({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function uf(t,e){if(e){if(jS[t]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(me(137,t));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(me(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(me(61))}if(e.style!=null&&typeof e.style!="object")throw Error(me(62))}}function hf(t,e){if(t.indexOf("-")===-1)return typeof e.is=="string";switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var df=null;function jf(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var ff=null,zs=null,Vs=null;function l0(t){if(t=Ra(t)){if(typeof ff!="function")throw Error(me(280));var e=t.stateNode;e&&(e=Hc(e),ff(t.stateNode,t.type,e))}}function x_(t){zs?Vs?Vs.push(t):Vs=[t]:zs=t}function y_(){if(zs){var t=zs,e=Vs;if(Vs=zs=null,l0(t),e)for(t=0;t<e.length;t++)l0(e[t])}}function S_(t,e){return t(e)}function M_(){}var Dd=!1;function w_(t,e,n){if(Dd)return t(e,n);Dd=!0;try{return S_(t,e,n)}finally{Dd=!1,(zs!==null||Vs!==null)&&(M_(),y_())}}function da(t,e){var n=t.stateNode;if(n===null)return null;var i=Hc(n);if(i===null)return null;n=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(t=t.type,i=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!i;break e;default:t=!1}if(t)return null;if(n&&typeof n!="function")throw Error(me(231,e,typeof n));return n}var pf=!1;if(Bi)try{Ts={},Object.defineProperty(Ts,"passive",{get:function(){pf=!0}}),window.addEventListener("test",Ts,Ts),window.removeEventListener("test",Ts,Ts)}catch{pf=!1}var Ts;function QS(t,e,n,i,r,s,o,a,l){var c=Array.prototype.slice.call(arguments,3);try{e.apply(n,c)}catch(d){this.onError(d)}}var na=!1,gc=null,_c=!1,mf=null,eM={onError:function(t){na=!0,gc=t}};function tM(t,e,n,i,r,s,o,a,l){na=!1,gc=null,QS.apply(eM,arguments)}function nM(t,e,n,i,r,s,o,a,l){if(tM.apply(this,arguments),na){if(na){var c=gc;na=!1,gc=null}else throw Error(me(198));_c||(_c=!0,mf=c)}}function os(t){var e=t,n=t;if(t.alternate)for(;e.return;)e=e.return;else{t=e;do e=t,e.flags&4098&&(n=e.return),t=e.return;while(t)}return e.tag===3?n:null}function E_(t){if(t.tag===13){var e=t.memoizedState;if(e===null&&(t=t.alternate,t!==null&&(e=t.memoizedState)),e!==null)return e.dehydrated}return null}function c0(t){if(os(t)!==t)throw Error(me(188))}function iM(t){var e=t.alternate;if(!e){if(e=os(t),e===null)throw Error(me(188));return e!==t?null:t}for(var n=t,i=e;;){var r=n.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){n=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===n)return c0(r),t;if(s===i)return c0(r),e;s=s.sibling}throw Error(me(188))}if(n.return!==i.return)n=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===n){o=!0,n=r,i=s;break}if(a===i){o=!0,i=r,n=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===n){o=!0,n=s,i=r;break}if(a===i){o=!0,i=s,n=r;break}a=a.sibling}if(!o)throw Error(me(189))}}if(n.alternate!==i)throw Error(me(190))}if(n.tag!==3)throw Error(me(188));return n.stateNode.current===n?t:e}function T_(t){return t=iM(t),t!==null?b_(t):null}function b_(t){if(t.tag===5||t.tag===6)return t;for(t=t.child;t!==null;){var e=b_(t);if(e!==null)return e;t=t.sibling}return null}var A_=In.unstable_scheduleCallback,u0=In.unstable_cancelCallback,rM=In.unstable_shouldYield,sM=In.unstable_requestPaint,Dt=In.unstable_now,oM=In.unstable_getCurrentPriorityLevel,Qf=In.unstable_ImmediatePriority,C_=In.unstable_UserBlockingPriority,vc=In.unstable_NormalPriority,aM=In.unstable_LowPriority,R_=In.unstable_IdlePriority,kc=null,Si=null;function lM(t){if(Si&&typeof Si.onCommitFiberRoot=="function")try{Si.onCommitFiberRoot(kc,t,void 0,(t.current.flags&128)===128)}catch{}}var si=Math.clz32?Math.clz32:hM,cM=Math.log,uM=Math.LN2;function hM(t){return t>>>=0,t===0?32:31-(cM(t)/uM|0)|0}var Hl=64,Wl=4194304;function Qo(t){switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return t&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return t}}function xc(t,e){var n=t.pendingLanes;if(n===0)return 0;var i=0,r=t.suspendedLanes,s=t.pingedLanes,o=n&268435455;if(o!==0){var a=o&~r;a!==0?i=Qo(a):(s&=o,s!==0&&(i=Qo(s)))}else o=n&~r,o!==0?i=Qo(o):s!==0&&(i=Qo(s));if(i===0)return 0;if(e!==0&&e!==i&&!(e&r)&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if(i&4&&(i|=n&16),e=t.entangledLanes,e!==0)for(t=t.entanglements,e&=i;0<e;)n=31-si(e),r=1<<n,i|=t[n],e&=~r;return i}function dM(t,e){switch(t){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function fM(t,e){for(var n=t.suspendedLanes,i=t.pingedLanes,r=t.expirationTimes,s=t.pendingLanes;0<s;){var o=31-si(s),a=1<<o,l=r[o];l===-1?(!(a&n)||a&i)&&(r[o]=dM(a,e)):l<=e&&(t.expiredLanes|=a),s&=~a}}function gf(t){return t=t.pendingLanes&-1073741825,t!==0?t:t&1073741824?1073741824:0}function P_(){var t=Hl;return Hl<<=1,!(Hl&4194240)&&(Hl=64),t}function Ud(t){for(var e=[],n=0;31>n;n++)e.push(t);return e}function Aa(t,e,n){t.pendingLanes|=e,e!==536870912&&(t.suspendedLanes=0,t.pingedLanes=0),t=t.eventTimes,e=31-si(e),t[e]=n}function pM(t,e){var n=t.pendingLanes&~e;t.pendingLanes=e,t.suspendedLanes=0,t.pingedLanes=0,t.expiredLanes&=e,t.mutableReadLanes&=e,t.entangledLanes&=e,e=t.entanglements;var i=t.eventTimes;for(t=t.expirationTimes;0<n;){var r=31-si(n),s=1<<r;e[r]=0,i[r]=-1,t[r]=-1,n&=~s}}function ep(t,e){var n=t.entangledLanes|=e;for(t=t.entanglements;n;){var i=31-si(n),r=1<<i;r&e|t[i]&e&&(t[i]|=e),n&=~r}}var ut=0;function I_(t){return t&=-t,1<t?4<t?t&268435455?16:536870912:4:1}var L_,tp,N_,D_,U_,_f=!1,Xl=[],fr=null,pr=null,mr=null,fa=new Map,pa=new Map,cr=[],mM="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function h0(t,e){switch(t){case"focusin":case"focusout":fr=null;break;case"dragenter":case"dragleave":pr=null;break;case"mouseover":case"mouseout":mr=null;break;case"pointerover":case"pointerout":fa.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":pa.delete(e.pointerId)}}function Wo(t,e,n,i,r,s){return t===null||t.nativeEvent!==s?(t={blockedOn:e,domEventName:n,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=Ra(e),e!==null&&tp(e)),t):(t.eventSystemFlags|=i,e=t.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),t)}function gM(t,e,n,i,r){switch(e){case"focusin":return fr=Wo(fr,t,e,n,i,r),!0;case"dragenter":return pr=Wo(pr,t,e,n,i,r),!0;case"mouseover":return mr=Wo(mr,t,e,n,i,r),!0;case"pointerover":var s=r.pointerId;return fa.set(s,Wo(fa.get(s)||null,t,e,n,i,r)),!0;case"gotpointercapture":return s=r.pointerId,pa.set(s,Wo(pa.get(s)||null,t,e,n,i,r)),!0}return!1}function F_(t){var e=$r(t.target);if(e!==null){var n=os(e);if(n!==null){if(e=n.tag,e===13){if(e=E_(n),e!==null){t.blockedOn=e,U_(t.priority,function(){N_(n)});return}}else if(e===3&&n.stateNode.current.memoizedState.isDehydrated){t.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}t.blockedOn=null}function sc(t){if(t.blockedOn!==null)return!1;for(var e=t.targetContainers;0<e.length;){var n=vf(t.domEventName,t.eventSystemFlags,e[0],t.nativeEvent);if(n===null){n=t.nativeEvent;var i=new n.constructor(n.type,n);df=i,n.target.dispatchEvent(i),df=null}else return e=Ra(n),e!==null&&tp(e),t.blockedOn=n,!1;e.shift()}return!0}function d0(t,e,n){sc(t)&&n.delete(e)}function _M(){_f=!1,fr!==null&&sc(fr)&&(fr=null),pr!==null&&sc(pr)&&(pr=null),mr!==null&&sc(mr)&&(mr=null),fa.forEach(d0),pa.forEach(d0)}function Xo(t,e){t.blockedOn===e&&(t.blockedOn=null,_f||(_f=!0,In.unstable_scheduleCallback(In.unstable_NormalPriority,_M)))}function ma(t){function e(r){return Xo(r,t)}if(0<Xl.length){Xo(Xl[0],t);for(var n=1;n<Xl.length;n++){var i=Xl[n];i.blockedOn===t&&(i.blockedOn=null)}}for(fr!==null&&Xo(fr,t),pr!==null&&Xo(pr,t),mr!==null&&Xo(mr,t),fa.forEach(e),pa.forEach(e),n=0;n<cr.length;n++)i=cr[n],i.blockedOn===t&&(i.blockedOn=null);for(;0<cr.length&&(n=cr[0],n.blockedOn===null);)F_(n),n.blockedOn===null&&cr.shift()}var Gs=Gi.ReactCurrentBatchConfig,yc=!0;function vM(t,e,n,i){var r=ut,s=Gs.transition;Gs.transition=null;try{ut=1,np(t,e,n,i)}finally{ut=r,Gs.transition=s}}function xM(t,e,n,i){var r=ut,s=Gs.transition;Gs.transition=null;try{ut=4,np(t,e,n,i)}finally{ut=r,Gs.transition=s}}function np(t,e,n,i){if(yc){var r=vf(t,e,n,i);if(r===null)Gd(t,e,i,Sc,n),h0(t,i);else if(gM(r,t,e,n,i))i.stopPropagation();else if(h0(t,i),e&4&&-1<mM.indexOf(t)){for(;r!==null;){var s=Ra(r);if(s!==null&&L_(s),s=vf(t,e,n,i),s===null&&Gd(t,e,i,Sc,n),s===r)break;r=s}r!==null&&i.stopPropagation()}else Gd(t,e,i,null,n)}}var Sc=null;function vf(t,e,n,i){if(Sc=null,t=jf(i),t=$r(t),t!==null)if(e=os(t),e===null)t=null;else if(n=e.tag,n===13){if(t=E_(e),t!==null)return t;t=null}else if(n===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;t=null}else e!==t&&(t=null);return Sc=t,null}function O_(t){switch(t){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(oM()){case Qf:return 1;case C_:return 4;case vc:case aM:return 16;case R_:return 536870912;default:return 16}default:return 16}}var hr=null,ip=null,oc=null;function B_(){if(oc)return oc;var t,e=ip,n=e.length,i,r="value"in hr?hr.value:hr.textContent,s=r.length;for(t=0;t<n&&e[t]===r[t];t++);var o=n-t;for(i=1;i<=o&&e[n-i]===r[s-i];i++);return oc=r.slice(t,1<i?1-i:void 0)}function ac(t){var e=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&e===13&&(t=13)):t=e,t===10&&(t=13),32<=t||t===13?t:0}function ql(){return!0}function f0(){return!1}function Ln(t){function e(n,i,r,s,o){this._reactName=n,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in t)t.hasOwnProperty(a)&&(n=t[a],this[a]=n?n(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?ql:f0,this.isPropagationStopped=f0,this}return bt(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=ql)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=ql)},persist:function(){},isPersistent:ql}),e}var js={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},rp=Ln(js),Ca=bt({},js,{view:0,detail:0}),yM=Ln(Ca),Fd,Od,qo,zc=bt({},Ca,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:sp,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==qo&&(qo&&t.type==="mousemove"?(Fd=t.screenX-qo.screenX,Od=t.screenY-qo.screenY):Od=Fd=0,qo=t),Fd)},movementY:function(t){return"movementY"in t?t.movementY:Od}}),p0=Ln(zc),SM=bt({},zc,{dataTransfer:0}),MM=Ln(SM),wM=bt({},Ca,{relatedTarget:0}),Bd=Ln(wM),EM=bt({},js,{animationName:0,elapsedTime:0,pseudoElement:0}),TM=Ln(EM),bM=bt({},js,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),AM=Ln(bM),CM=bt({},js,{data:0}),m0=Ln(CM),RM={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},PM={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},IM={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function LM(t){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(t):(t=IM[t])?!!e[t]:!1}function sp(){return LM}var NM=bt({},Ca,{key:function(t){if(t.key){var e=RM[t.key]||t.key;if(e!=="Unidentified")return e}return t.type==="keypress"?(t=ac(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?PM[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:sp,charCode:function(t){return t.type==="keypress"?ac(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?ac(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),DM=Ln(NM),UM=bt({},zc,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),g0=Ln(UM),FM=bt({},Ca,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:sp}),OM=Ln(FM),BM=bt({},js,{propertyName:0,elapsedTime:0,pseudoElement:0}),kM=Ln(BM),zM=bt({},zc,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),VM=Ln(zM),GM=[9,13,27,32],op=Bi&&"CompositionEvent"in window,ia=null;Bi&&"documentMode"in document&&(ia=document.documentMode);var HM=Bi&&"TextEvent"in window&&!ia,k_=Bi&&(!op||ia&&8<ia&&11>=ia),_0=" ",v0=!1;function z_(t,e){switch(t){case"keyup":return GM.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function V_(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var Rs=!1;function WM(t,e){switch(t){case"compositionend":return V_(e);case"keypress":return e.which!==32?null:(v0=!0,_0);case"textInput":return t=e.data,t===_0&&v0?null:t;default:return null}}function XM(t,e){if(Rs)return t==="compositionend"||!op&&z_(t,e)?(t=B_(),oc=ip=hr=null,Rs=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return k_&&e.locale!=="ko"?null:e.data;default:return null}}var qM={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function x0(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e==="input"?!!qM[t.type]:e==="textarea"}function G_(t,e,n,i){x_(i),e=Mc(e,"onChange"),0<e.length&&(n=new rp("onChange","change",null,n,i),t.push({event:n,listeners:e}))}var ra=null,ga=null;function YM(t){Q_(t,0)}function Vc(t){var e=Ls(t);if(d_(e))return t}function ZM(t,e){if(t==="change")return e}var H_=!1;Bi&&(Bi?(Zl="oninput"in document,Zl||(kd=document.createElement("div"),kd.setAttribute("oninput","return;"),Zl=typeof kd.oninput=="function"),Yl=Zl):Yl=!1,H_=Yl&&(!document.documentMode||9<document.documentMode));var Yl,Zl,kd;function y0(){ra&&(ra.detachEvent("onpropertychange",W_),ga=ra=null)}function W_(t){if(t.propertyName==="value"&&Vc(ga)){var e=[];G_(e,ga,t,jf(t)),w_(YM,e)}}function $M(t,e,n){t==="focusin"?(y0(),ra=e,ga=n,ra.attachEvent("onpropertychange",W_)):t==="focusout"&&y0()}function JM(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return Vc(ga)}function KM(t,e){if(t==="click")return Vc(e)}function jM(t,e){if(t==="input"||t==="change")return Vc(e)}function QM(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var ai=typeof Object.is=="function"?Object.is:QM;function _a(t,e){if(ai(t,e))return!0;if(typeof t!="object"||t===null||typeof e!="object"||e===null)return!1;var n=Object.keys(t),i=Object.keys(e);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var r=n[i];if(!Qd.call(e,r)||!ai(t[r],e[r]))return!1}return!0}function S0(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function M0(t,e){var n=S0(t);t=0;for(var i;n;){if(n.nodeType===3){if(i=t+n.textContent.length,t<=e&&i>=e)return{node:n,offset:e-t};t=i}e:{for(;n;){if(n.nextSibling){n=n.nextSibling;break e}n=n.parentNode}n=void 0}n=S0(n)}}function X_(t,e){return t&&e?t===e?!0:t&&t.nodeType===3?!1:e&&e.nodeType===3?X_(t,e.parentNode):"contains"in t?t.contains(e):t.compareDocumentPosition?!!(t.compareDocumentPosition(e)&16):!1:!1}function q_(){for(var t=window,e=mc();e instanceof t.HTMLIFrameElement;){try{var n=typeof e.contentWindow.location.href=="string"}catch{n=!1}if(n)t=e.contentWindow;else break;e=mc(t.document)}return e}function ap(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e&&(e==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||e==="textarea"||t.contentEditable==="true")}function e1(t){var e=q_(),n=t.focusedElem,i=t.selectionRange;if(e!==n&&n&&n.ownerDocument&&X_(n.ownerDocument.documentElement,n)){if(i!==null&&ap(n)){if(e=i.start,t=i.end,t===void 0&&(t=e),"selectionStart"in n)n.selectionStart=e,n.selectionEnd=Math.min(t,n.value.length);else if(t=(e=n.ownerDocument||document)&&e.defaultView||window,t.getSelection){t=t.getSelection();var r=n.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!t.extend&&s>i&&(r=i,i=s,s=r),r=M0(n,s);var o=M0(n,i);r&&o&&(t.rangeCount!==1||t.anchorNode!==r.node||t.anchorOffset!==r.offset||t.focusNode!==o.node||t.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),t.removeAllRanges(),s>i?(t.addRange(e),t.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),t.addRange(e)))}}for(e=[],t=n;t=t.parentNode;)t.nodeType===1&&e.push({element:t,left:t.scrollLeft,top:t.scrollTop});for(typeof n.focus=="function"&&n.focus(),n=0;n<e.length;n++)t=e[n],t.element.scrollLeft=t.left,t.element.scrollTop=t.top}}var t1=Bi&&"documentMode"in document&&11>=document.documentMode,Ps=null,xf=null,sa=null,yf=!1;function w0(t,e,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;yf||Ps==null||Ps!==mc(i)||(i=Ps,"selectionStart"in i&&ap(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),sa&&_a(sa,i)||(sa=i,i=Mc(xf,"onSelect"),0<i.length&&(e=new rp("onSelect","select",null,e,n),t.push({event:e,listeners:i}),e.target=Ps)))}function $l(t,e){var n={};return n[t.toLowerCase()]=e.toLowerCase(),n["Webkit"+t]="webkit"+e,n["Moz"+t]="moz"+e,n}var Is={animationend:$l("Animation","AnimationEnd"),animationiteration:$l("Animation","AnimationIteration"),animationstart:$l("Animation","AnimationStart"),transitionend:$l("Transition","TransitionEnd")},zd={},Y_={};Bi&&(Y_=document.createElement("div").style,"AnimationEvent"in window||(delete Is.animationend.animation,delete Is.animationiteration.animation,delete Is.animationstart.animation),"TransitionEvent"in window||delete Is.transitionend.transition);function Gc(t){if(zd[t])return zd[t];if(!Is[t])return t;var e=Is[t],n;for(n in e)if(e.hasOwnProperty(n)&&n in Y_)return zd[t]=e[n];return t}var Z_=Gc("animationend"),$_=Gc("animationiteration"),J_=Gc("animationstart"),K_=Gc("transitionend"),j_=new Map,E0="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function wr(t,e){j_.set(t,e),ss(e,[t])}for(Jl=0;Jl<E0.length;Jl++)Kl=E0[Jl],T0=Kl.toLowerCase(),b0=Kl[0].toUpperCase()+Kl.slice(1),wr(T0,"on"+b0);var Kl,T0,b0,Jl;wr(Z_,"onAnimationEnd");wr($_,"onAnimationIteration");wr(J_,"onAnimationStart");wr("dblclick","onDoubleClick");wr("focusin","onFocus");wr("focusout","onBlur");wr(K_,"onTransitionEnd");Xs("onMouseEnter",["mouseout","mouseover"]);Xs("onMouseLeave",["mouseout","mouseover"]);Xs("onPointerEnter",["pointerout","pointerover"]);Xs("onPointerLeave",["pointerout","pointerover"]);ss("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));ss("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));ss("onBeforeInput",["compositionend","keypress","textInput","paste"]);ss("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));ss("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));ss("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var ea="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),n1=new Set("cancel close invalid load scroll toggle".split(" ").concat(ea));function A0(t,e,n){var i=t.type||"unknown-event";t.currentTarget=n,nM(i,e,void 0,t),t.currentTarget=null}function Q_(t,e){e=(e&4)!==0;for(var n=0;n<t.length;n++){var i=t[n],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,c=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;A0(r,a,c),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,c=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;A0(r,a,c),s=l}}}if(_c)throw t=mf,_c=!1,mf=null,t}function xt(t,e){var n=e[Tf];n===void 0&&(n=e[Tf]=new Set);var i=t+"__bubble";n.has(i)||(ev(e,t,2,!1),n.add(i))}function Vd(t,e,n){var i=0;e&&(i|=4),ev(n,t,i,e)}var jl="_reactListening"+Math.random().toString(36).slice(2);function va(t){if(!t[jl]){t[jl]=!0,a_.forEach(function(n){n!=="selectionchange"&&(n1.has(n)||Vd(n,!1,t),Vd(n,!0,t))});var e=t.nodeType===9?t:t.ownerDocument;e===null||e[jl]||(e[jl]=!0,Vd("selectionchange",!1,e))}}function ev(t,e,n,i){switch(O_(e)){case 1:var r=vM;break;case 4:r=xM;break;default:r=np}n=r.bind(null,e,n,t),r=void 0,!pf||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?t.addEventListener(e,n,{capture:!0,passive:r}):t.addEventListener(e,n,!0):r!==void 0?t.addEventListener(e,n,{passive:r}):t.addEventListener(e,n,!1)}function Gd(t,e,n,i,r){var s=i;if(!(e&1)&&!(e&2)&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=$r(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}w_(function(){var c=s,d=jf(n),f=[];e:{var u=j_.get(t);if(u!==void 0){var p=rp,g=t;switch(t){case"keypress":if(ac(n)===0)break e;case"keydown":case"keyup":p=DM;break;case"focusin":g="focus",p=Bd;break;case"focusout":g="blur",p=Bd;break;case"beforeblur":case"afterblur":p=Bd;break;case"click":if(n.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":p=p0;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":p=MM;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":p=OM;break;case Z_:case $_:case J_:p=TM;break;case K_:p=kM;break;case"scroll":p=yM;break;case"wheel":p=VM;break;case"copy":case"cut":case"paste":p=AM;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":p=g0}var M=(e&4)!==0,_=!M&&t==="scroll",h=M?u!==null?u+"Capture":null:u;M=[];for(var m=c,v;m!==null;){v=m;var y=v.stateNode;if(v.tag===5&&y!==null&&(v=y,h!==null&&(y=da(m,h),y!=null&&M.push(xa(m,y,v)))),_)break;m=m.return}0<M.length&&(u=new p(u,g,null,n,d),f.push({event:u,listeners:M}))}}if(!(e&7)){e:{if(u=t==="mouseover"||t==="pointerover",p=t==="mouseout"||t==="pointerout",u&&n!==df&&(g=n.relatedTarget||n.fromElement)&&($r(g)||g[ki]))break e;if((p||u)&&(u=d.window===d?d:(u=d.ownerDocument)?u.defaultView||u.parentWindow:window,p?(g=n.relatedTarget||n.toElement,p=c,g=g?$r(g):null,g!==null&&(_=os(g),g!==_||g.tag!==5&&g.tag!==6)&&(g=null)):(p=null,g=c),p!==g)){if(M=p0,y="onMouseLeave",h="onMouseEnter",m="mouse",(t==="pointerout"||t==="pointerover")&&(M=g0,y="onPointerLeave",h="onPointerEnter",m="pointer"),_=p==null?u:Ls(p),v=g==null?u:Ls(g),u=new M(y,m+"leave",p,n,d),u.target=_,u.relatedTarget=v,y=null,$r(d)===c&&(M=new M(h,m+"enter",g,n,d),M.target=v,M.relatedTarget=_,y=M),_=y,p&&g)t:{for(M=p,h=g,m=0,v=M;v;v=bs(v))m++;for(v=0,y=h;y;y=bs(y))v++;for(;0<m-v;)M=bs(M),m--;for(;0<v-m;)h=bs(h),v--;for(;m--;){if(M===h||h!==null&&M===h.alternate)break t;M=bs(M),h=bs(h)}M=null}else M=null;p!==null&&C0(f,u,p,M,!1),g!==null&&_!==null&&C0(f,_,g,M,!0)}}e:{if(u=c?Ls(c):window,p=u.nodeName&&u.nodeName.toLowerCase(),p==="select"||p==="input"&&u.type==="file")var A=ZM;else if(x0(u))if(H_)A=jM;else{A=JM;var E=$M}else(p=u.nodeName)&&p.toLowerCase()==="input"&&(u.type==="checkbox"||u.type==="radio")&&(A=KM);if(A&&(A=A(t,c))){G_(f,A,n,d);break e}E&&E(t,u,c),t==="focusout"&&(E=u._wrapperState)&&E.controlled&&u.type==="number"&&af(u,"number",u.value)}switch(E=c?Ls(c):window,t){case"focusin":(x0(E)||E.contentEditable==="true")&&(Ps=E,xf=c,sa=null);break;case"focusout":sa=xf=Ps=null;break;case"mousedown":yf=!0;break;case"contextmenu":case"mouseup":case"dragend":yf=!1,w0(f,n,d);break;case"selectionchange":if(t1)break;case"keydown":case"keyup":w0(f,n,d)}var C;if(op)e:{switch(t){case"compositionstart":var x="onCompositionStart";break e;case"compositionend":x="onCompositionEnd";break e;case"compositionupdate":x="onCompositionUpdate";break e}x=void 0}else Rs?z_(t,n)&&(x="onCompositionEnd"):t==="keydown"&&n.keyCode===229&&(x="onCompositionStart");x&&(k_&&n.locale!=="ko"&&(Rs||x!=="onCompositionStart"?x==="onCompositionEnd"&&Rs&&(C=B_()):(hr=d,ip="value"in hr?hr.value:hr.textContent,Rs=!0)),E=Mc(c,x),0<E.length&&(x=new m0(x,t,null,n,d),f.push({event:x,listeners:E}),C?x.data=C:(C=V_(n),C!==null&&(x.data=C)))),(C=HM?WM(t,n):XM(t,n))&&(c=Mc(c,"onBeforeInput"),0<c.length&&(d=new m0("onBeforeInput","beforeinput",null,n,d),f.push({event:d,listeners:c}),d.data=C))}Q_(f,e)})}function xa(t,e,n){return{instance:t,listener:e,currentTarget:n}}function Mc(t,e){for(var n=e+"Capture",i=[];t!==null;){var r=t,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=da(t,n),s!=null&&i.unshift(xa(t,s,r)),s=da(t,e),s!=null&&i.push(xa(t,s,r))),t=t.return}return i}function bs(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5);return t||null}function C0(t,e,n,i,r){for(var s=e._reactName,o=[];n!==null&&n!==i;){var a=n,l=a.alternate,c=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&c!==null&&(a=c,r?(l=da(n,s),l!=null&&o.unshift(xa(n,l,a))):r||(l=da(n,s),l!=null&&o.push(xa(n,l,a)))),n=n.return}o.length!==0&&t.push({event:e,listeners:o})}var i1=/\r\n?/g,r1=/\u0000|\uFFFD/g;function R0(t){return(typeof t=="string"?t:""+t).replace(i1,`
`).replace(r1,"")}function Ql(t,e,n){if(e=R0(e),R0(t)!==e&&n)throw Error(me(425))}function wc(){}var Sf=null,Mf=null;function wf(t,e){return t==="textarea"||t==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var Ef=typeof setTimeout=="function"?setTimeout:void 0,s1=typeof clearTimeout=="function"?clearTimeout:void 0,P0=typeof Promise=="function"?Promise:void 0,o1=typeof queueMicrotask=="function"?queueMicrotask:typeof P0<"u"?function(t){return P0.resolve(null).then(t).catch(a1)}:Ef;function a1(t){setTimeout(function(){throw t})}function Hd(t,e){var n=e,i=0;do{var r=n.nextSibling;if(t.removeChild(n),r&&r.nodeType===8)if(n=r.data,n==="/$"){if(i===0){t.removeChild(r),ma(e);return}i--}else n!=="$"&&n!=="$?"&&n!=="$!"||i++;n=r}while(n);ma(e)}function gr(t){for(;t!=null;t=t.nextSibling){var e=t.nodeType;if(e===1||e===3)break;if(e===8){if(e=t.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return t}function I0(t){t=t.previousSibling;for(var e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="$"||n==="$!"||n==="$?"){if(e===0)return t;e--}else n==="/$"&&e++}t=t.previousSibling}return null}var Qs=Math.random().toString(36).slice(2),yi="__reactFiber$"+Qs,ya="__reactProps$"+Qs,ki="__reactContainer$"+Qs,Tf="__reactEvents$"+Qs,l1="__reactListeners$"+Qs,c1="__reactHandles$"+Qs;function $r(t){var e=t[yi];if(e)return e;for(var n=t.parentNode;n;){if(e=n[ki]||n[yi]){if(n=e.alternate,e.child!==null||n!==null&&n.child!==null)for(t=I0(t);t!==null;){if(n=t[yi])return n;t=I0(t)}return e}t=n,n=t.parentNode}return null}function Ra(t){return t=t[yi]||t[ki],!t||t.tag!==5&&t.tag!==6&&t.tag!==13&&t.tag!==3?null:t}function Ls(t){if(t.tag===5||t.tag===6)return t.stateNode;throw Error(me(33))}function Hc(t){return t[ya]||null}var bf=[],Ns=-1;function Er(t){return{current:t}}function yt(t){0>Ns||(t.current=bf[Ns],bf[Ns]=null,Ns--)}function _t(t,e){Ns++,bf[Ns]=t.current,t.current=e}var Mr={},ln=Er(Mr),Sn=Er(!1),es=Mr;function qs(t,e){var n=t.type.contextTypes;if(!n)return Mr;var i=t.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in n)r[s]=e[s];return i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=e,t.__reactInternalMemoizedMaskedChildContext=r),r}function Mn(t){return t=t.childContextTypes,t!=null}function Ec(){yt(Sn),yt(ln)}function L0(t,e,n){if(ln.current!==Mr)throw Error(me(168));_t(ln,e),_t(Sn,n)}function tv(t,e,n){var i=t.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return n;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(me(108,$S(t)||"Unknown",r));return bt({},n,i)}function Tc(t){return t=(t=t.stateNode)&&t.__reactInternalMemoizedMergedChildContext||Mr,es=ln.current,_t(ln,t),_t(Sn,Sn.current),!0}function N0(t,e,n){var i=t.stateNode;if(!i)throw Error(me(169));n?(t=tv(t,e,es),i.__reactInternalMemoizedMergedChildContext=t,yt(Sn),yt(ln),_t(ln,t)):yt(Sn),_t(Sn,n)}var Di=null,Wc=!1,Wd=!1;function nv(t){Di===null?Di=[t]:Di.push(t)}function u1(t){Wc=!0,nv(t)}function Tr(){if(!Wd&&Di!==null){Wd=!0;var t=0,e=ut;try{var n=Di;for(ut=1;t<n.length;t++){var i=n[t];do i=i(!0);while(i!==null)}Di=null,Wc=!1}catch(r){throw Di!==null&&(Di=Di.slice(t+1)),A_(Qf,Tr),r}finally{ut=e,Wd=!1}}return null}var Ds=[],Us=0,bc=null,Ac=0,Wn=[],Xn=0,ts=null,Ui=1,Fi="";function Yr(t,e){Ds[Us++]=Ac,Ds[Us++]=bc,bc=t,Ac=e}function iv(t,e,n){Wn[Xn++]=Ui,Wn[Xn++]=Fi,Wn[Xn++]=ts,ts=t;var i=Ui;t=Fi;var r=32-si(i)-1;i&=~(1<<r),n+=1;var s=32-si(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,Ui=1<<32-si(e)+r|n<<r|i,Fi=s+t}else Ui=1<<s|n<<r|i,Fi=t}function lp(t){t.return!==null&&(Yr(t,1),iv(t,1,0))}function cp(t){for(;t===bc;)bc=Ds[--Us],Ds[Us]=null,Ac=Ds[--Us],Ds[Us]=null;for(;t===ts;)ts=Wn[--Xn],Wn[Xn]=null,Fi=Wn[--Xn],Wn[Xn]=null,Ui=Wn[--Xn],Wn[Xn]=null}var Pn=null,Rn=null,wt=!1,ri=null;function rv(t,e){var n=qn(5,null,null,0);n.elementType="DELETED",n.stateNode=e,n.return=t,e=t.deletions,e===null?(t.deletions=[n],t.flags|=16):e.push(n)}function D0(t,e){switch(t.tag){case 5:var n=t.type;return e=e.nodeType!==1||n.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(t.stateNode=e,Pn=t,Rn=gr(e.firstChild),!0):!1;case 6:return e=t.pendingProps===""||e.nodeType!==3?null:e,e!==null?(t.stateNode=e,Pn=t,Rn=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(n=ts!==null?{id:Ui,overflow:Fi}:null,t.memoizedState={dehydrated:e,treeContext:n,retryLane:1073741824},n=qn(18,null,null,0),n.stateNode=e,n.return=t,t.child=n,Pn=t,Rn=null,!0):!1;default:return!1}}function Af(t){return(t.mode&1)!==0&&(t.flags&128)===0}function Cf(t){if(wt){var e=Rn;if(e){var n=e;if(!D0(t,e)){if(Af(t))throw Error(me(418));e=gr(n.nextSibling);var i=Pn;e&&D0(t,e)?rv(i,n):(t.flags=t.flags&-4097|2,wt=!1,Pn=t)}}else{if(Af(t))throw Error(me(418));t.flags=t.flags&-4097|2,wt=!1,Pn=t}}}function U0(t){for(t=t.return;t!==null&&t.tag!==5&&t.tag!==3&&t.tag!==13;)t=t.return;Pn=t}function ec(t){if(t!==Pn)return!1;if(!wt)return U0(t),wt=!0,!1;var e;if((e=t.tag!==3)&&!(e=t.tag!==5)&&(e=t.type,e=e!=="head"&&e!=="body"&&!wf(t.type,t.memoizedProps)),e&&(e=Rn)){if(Af(t))throw sv(),Error(me(418));for(;e;)rv(t,e),e=gr(e.nextSibling)}if(U0(t),t.tag===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(me(317));e:{for(t=t.nextSibling,e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="/$"){if(e===0){Rn=gr(t.nextSibling);break e}e--}else n!=="$"&&n!=="$!"&&n!=="$?"||e++}t=t.nextSibling}Rn=null}}else Rn=Pn?gr(t.stateNode.nextSibling):null;return!0}function sv(){for(var t=Rn;t;)t=gr(t.nextSibling)}function Ys(){Rn=Pn=null,wt=!1}function up(t){ri===null?ri=[t]:ri.push(t)}var h1=Gi.ReactCurrentBatchConfig;function Yo(t,e,n){if(t=n.ref,t!==null&&typeof t!="function"&&typeof t!="object"){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(me(309));var i=n.stateNode}if(!i)throw Error(me(147,t));var r=i,s=""+t;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof t!="string")throw Error(me(284));if(!n._owner)throw Error(me(290,t))}return t}function tc(t,e){throw t=Object.prototype.toString.call(e),Error(me(31,t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t))}function F0(t){var e=t._init;return e(t._payload)}function ov(t){function e(h,m){if(t){var v=h.deletions;v===null?(h.deletions=[m],h.flags|=16):v.push(m)}}function n(h,m){if(!t)return null;for(;m!==null;)e(h,m),m=m.sibling;return null}function i(h,m){for(h=new Map;m!==null;)m.key!==null?h.set(m.key,m):h.set(m.index,m),m=m.sibling;return h}function r(h,m){return h=yr(h,m),h.index=0,h.sibling=null,h}function s(h,m,v){return h.index=v,t?(v=h.alternate,v!==null?(v=v.index,v<m?(h.flags|=2,m):v):(h.flags|=2,m)):(h.flags|=1048576,m)}function o(h){return t&&h.alternate===null&&(h.flags|=2),h}function a(h,m,v,y){return m===null||m.tag!==6?(m=Kd(v,h.mode,y),m.return=h,m):(m=r(m,v),m.return=h,m)}function l(h,m,v,y){var A=v.type;return A===Cs?d(h,m,v.props.children,y,v.key):m!==null&&(m.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===ar&&F0(A)===m.type)?(y=r(m,v.props),y.ref=Yo(h,m,v),y.return=h,y):(y=pc(v.type,v.key,v.props,null,h.mode,y),y.ref=Yo(h,m,v),y.return=h,y)}function c(h,m,v,y){return m===null||m.tag!==4||m.stateNode.containerInfo!==v.containerInfo||m.stateNode.implementation!==v.implementation?(m=jd(v,h.mode,y),m.return=h,m):(m=r(m,v.children||[]),m.return=h,m)}function d(h,m,v,y,A){return m===null||m.tag!==7?(m=Qr(v,h.mode,y,A),m.return=h,m):(m=r(m,v),m.return=h,m)}function f(h,m,v){if(typeof m=="string"&&m!==""||typeof m=="number")return m=Kd(""+m,h.mode,v),m.return=h,m;if(typeof m=="object"&&m!==null){switch(m.$$typeof){case zl:return v=pc(m.type,m.key,m.props,null,h.mode,v),v.ref=Yo(h,null,m),v.return=h,v;case As:return m=jd(m,h.mode,v),m.return=h,m;case ar:var y=m._init;return f(h,y(m._payload),v)}if(jo(m)||Ho(m))return m=Qr(m,h.mode,v,null),m.return=h,m;tc(h,m)}return null}function u(h,m,v,y){var A=m!==null?m.key:null;if(typeof v=="string"&&v!==""||typeof v=="number")return A!==null?null:a(h,m,""+v,y);if(typeof v=="object"&&v!==null){switch(v.$$typeof){case zl:return v.key===A?l(h,m,v,y):null;case As:return v.key===A?c(h,m,v,y):null;case ar:return A=v._init,u(h,m,A(v._payload),y)}if(jo(v)||Ho(v))return A!==null?null:d(h,m,v,y,null);tc(h,v)}return null}function p(h,m,v,y,A){if(typeof y=="string"&&y!==""||typeof y=="number")return h=h.get(v)||null,a(m,h,""+y,A);if(typeof y=="object"&&y!==null){switch(y.$$typeof){case zl:return h=h.get(y.key===null?v:y.key)||null,l(m,h,y,A);case As:return h=h.get(y.key===null?v:y.key)||null,c(m,h,y,A);case ar:var E=y._init;return p(h,m,v,E(y._payload),A)}if(jo(y)||Ho(y))return h=h.get(v)||null,d(m,h,y,A,null);tc(m,y)}return null}function g(h,m,v,y){for(var A=null,E=null,C=m,x=m=0,b=null;C!==null&&x<v.length;x++){C.index>x?(b=C,C=null):b=C.sibling;var I=u(h,C,v[x],y);if(I===null){C===null&&(C=b);break}t&&C&&I.alternate===null&&e(h,C),m=s(I,m,x),E===null?A=I:E.sibling=I,E=I,C=b}if(x===v.length)return n(h,C),wt&&Yr(h,x),A;if(C===null){for(;x<v.length;x++)C=f(h,v[x],y),C!==null&&(m=s(C,m,x),E===null?A=C:E.sibling=C,E=C);return wt&&Yr(h,x),A}for(C=i(h,C);x<v.length;x++)b=p(C,h,x,v[x],y),b!==null&&(t&&b.alternate!==null&&C.delete(b.key===null?x:b.key),m=s(b,m,x),E===null?A=b:E.sibling=b,E=b);return t&&C.forEach(function(L){return e(h,L)}),wt&&Yr(h,x),A}function M(h,m,v,y){var A=Ho(v);if(typeof A!="function")throw Error(me(150));if(v=A.call(v),v==null)throw Error(me(151));for(var E=A=null,C=m,x=m=0,b=null,I=v.next();C!==null&&!I.done;x++,I=v.next()){C.index>x?(b=C,C=null):b=C.sibling;var L=u(h,C,I.value,y);if(L===null){C===null&&(C=b);break}t&&C&&L.alternate===null&&e(h,C),m=s(L,m,x),E===null?A=L:E.sibling=L,E=L,C=b}if(I.done)return n(h,C),wt&&Yr(h,x),A;if(C===null){for(;!I.done;x++,I=v.next())I=f(h,I.value,y),I!==null&&(m=s(I,m,x),E===null?A=I:E.sibling=I,E=I);return wt&&Yr(h,x),A}for(C=i(h,C);!I.done;x++,I=v.next())I=p(C,h,x,I.value,y),I!==null&&(t&&I.alternate!==null&&C.delete(I.key===null?x:I.key),m=s(I,m,x),E===null?A=I:E.sibling=I,E=I);return t&&C.forEach(function(P){return e(h,P)}),wt&&Yr(h,x),A}function _(h,m,v,y){if(typeof v=="object"&&v!==null&&v.type===Cs&&v.key===null&&(v=v.props.children),typeof v=="object"&&v!==null){switch(v.$$typeof){case zl:e:{for(var A=v.key,E=m;E!==null;){if(E.key===A){if(A=v.type,A===Cs){if(E.tag===7){n(h,E.sibling),m=r(E,v.props.children),m.return=h,h=m;break e}}else if(E.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===ar&&F0(A)===E.type){n(h,E.sibling),m=r(E,v.props),m.ref=Yo(h,E,v),m.return=h,h=m;break e}n(h,E);break}else e(h,E);E=E.sibling}v.type===Cs?(m=Qr(v.props.children,h.mode,y,v.key),m.return=h,h=m):(y=pc(v.type,v.key,v.props,null,h.mode,y),y.ref=Yo(h,m,v),y.return=h,h=y)}return o(h);case As:e:{for(E=v.key;m!==null;){if(m.key===E)if(m.tag===4&&m.stateNode.containerInfo===v.containerInfo&&m.stateNode.implementation===v.implementation){n(h,m.sibling),m=r(m,v.children||[]),m.return=h,h=m;break e}else{n(h,m);break}else e(h,m);m=m.sibling}m=jd(v,h.mode,y),m.return=h,h=m}return o(h);case ar:return E=v._init,_(h,m,E(v._payload),y)}if(jo(v))return g(h,m,v,y);if(Ho(v))return M(h,m,v,y);tc(h,v)}return typeof v=="string"&&v!==""||typeof v=="number"?(v=""+v,m!==null&&m.tag===6?(n(h,m.sibling),m=r(m,v),m.return=h,h=m):(n(h,m),m=Kd(v,h.mode,y),m.return=h,h=m),o(h)):n(h,m)}return _}var Zs=ov(!0),av=ov(!1),Cc=Er(null),Rc=null,Fs=null,hp=null;function dp(){hp=Fs=Rc=null}function fp(t){var e=Cc.current;yt(Cc),t._currentValue=e}function Rf(t,e,n){for(;t!==null;){var i=t.alternate;if((t.childLanes&e)!==e?(t.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),t===n)break;t=t.return}}function Hs(t,e){Rc=t,hp=Fs=null,t=t.dependencies,t!==null&&t.firstContext!==null&&(t.lanes&e&&(yn=!0),t.firstContext=null)}function Zn(t){var e=t._currentValue;if(hp!==t)if(t={context:t,memoizedValue:e,next:null},Fs===null){if(Rc===null)throw Error(me(308));Fs=t,Rc.dependencies={lanes:0,firstContext:t}}else Fs=Fs.next=t;return e}var Jr=null;function pp(t){Jr===null?Jr=[t]:Jr.push(t)}function lv(t,e,n,i){var r=e.interleaved;return r===null?(n.next=n,pp(e)):(n.next=r.next,r.next=n),e.interleaved=n,zi(t,i)}function zi(t,e){t.lanes|=e;var n=t.alternate;for(n!==null&&(n.lanes|=e),n=t,t=t.return;t!==null;)t.childLanes|=e,n=t.alternate,n!==null&&(n.childLanes|=e),n=t,t=t.return;return n.tag===3?n.stateNode:null}var lr=!1;function mp(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function cv(t,e){t=t.updateQueue,e.updateQueue===t&&(e.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,effects:t.effects})}function Oi(t,e){return{eventTime:t,lane:e,tag:0,payload:null,callback:null,next:null}}function _r(t,e,n){var i=t.updateQueue;if(i===null)return null;if(i=i.shared,at&2){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,zi(t,n)}return r=i.interleaved,r===null?(e.next=e,pp(i)):(e.next=r.next,r.next=e),i.interleaved=e,zi(t,n)}function lc(t,e,n){if(e=e.updateQueue,e!==null&&(e=e.shared,(n&4194240)!==0)){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,ep(t,n)}}function O0(t,e){var n=t.updateQueue,i=t.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var r=null,s=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};s===null?r=s=o:s=s.next=o,n=n.next}while(n!==null);s===null?r=s=e:s=s.next=e}else r=s=e;n={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},t.updateQueue=n;return}t=n.lastBaseUpdate,t===null?n.firstBaseUpdate=e:t.next=e,n.lastBaseUpdate=e}function Pc(t,e,n,i){var r=t.updateQueue;lr=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,c=l.next;l.next=null,o===null?s=c:o.next=c,o=l;var d=t.alternate;d!==null&&(d=d.updateQueue,a=d.lastBaseUpdate,a!==o&&(a===null?d.firstBaseUpdate=c:a.next=c,d.lastBaseUpdate=l))}if(s!==null){var f=r.baseState;o=0,d=c=l=null,a=s;do{var u=a.lane,p=a.eventTime;if((i&u)===u){d!==null&&(d=d.next={eventTime:p,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var g=t,M=a;switch(u=e,p=n,M.tag){case 1:if(g=M.payload,typeof g=="function"){f=g.call(p,f,u);break e}f=g;break e;case 3:g.flags=g.flags&-65537|128;case 0:if(g=M.payload,u=typeof g=="function"?g.call(p,f,u):g,u==null)break e;f=bt({},f,u);break e;case 2:lr=!0}}a.callback!==null&&a.lane!==0&&(t.flags|=64,u=r.effects,u===null?r.effects=[a]:u.push(a))}else p={eventTime:p,lane:u,tag:a.tag,payload:a.payload,callback:a.callback,next:null},d===null?(c=d=p,l=f):d=d.next=p,o|=u;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;u=a,a=u.next,u.next=null,r.lastBaseUpdate=u,r.shared.pending=null}}while(!0);if(d===null&&(l=f),r.baseState=l,r.firstBaseUpdate=c,r.lastBaseUpdate=d,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);is|=o,t.lanes=o,t.memoizedState=f}}function B0(t,e,n){if(t=e.effects,e.effects=null,t!==null)for(e=0;e<t.length;e++){var i=t[e],r=i.callback;if(r!==null){if(i.callback=null,i=n,typeof r!="function")throw Error(me(191,r));r.call(i)}}}var Pa={},Mi=Er(Pa),Sa=Er(Pa),Ma=Er(Pa);function Kr(t){if(t===Pa)throw Error(me(174));return t}function gp(t,e){switch(_t(Ma,e),_t(Sa,t),_t(Mi,Pa),t=e.nodeType,t){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:cf(null,"");break;default:t=t===8?e.parentNode:e,e=t.namespaceURI||null,t=t.tagName,e=cf(e,t)}yt(Mi),_t(Mi,e)}function $s(){yt(Mi),yt(Sa),yt(Ma)}function uv(t){Kr(Ma.current);var e=Kr(Mi.current),n=cf(e,t.type);e!==n&&(_t(Sa,t),_t(Mi,n))}function _p(t){Sa.current===t&&(yt(Mi),yt(Sa))}var Et=Er(0);function Ic(t){for(var e=t;e!==null;){if(e.tag===13){var n=e.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data==="$?"||n.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if(e.flags&128)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var Xd=[];function vp(){for(var t=0;t<Xd.length;t++)Xd[t]._workInProgressVersionPrimary=null;Xd.length=0}var cc=Gi.ReactCurrentDispatcher,qd=Gi.ReactCurrentBatchConfig,ns=0,Tt=null,Ot=null,Gt=null,Lc=!1,oa=!1,wa=0,d1=0;function sn(){throw Error(me(321))}function xp(t,e){if(e===null)return!1;for(var n=0;n<e.length&&n<t.length;n++)if(!ai(t[n],e[n]))return!1;return!0}function yp(t,e,n,i,r,s){if(ns=s,Tt=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,cc.current=t===null||t.memoizedState===null?g1:_1,t=n(i,r),oa){s=0;do{if(oa=!1,wa=0,25<=s)throw Error(me(301));s+=1,Gt=Ot=null,e.updateQueue=null,cc.current=v1,t=n(i,r)}while(oa)}if(cc.current=Nc,e=Ot!==null&&Ot.next!==null,ns=0,Gt=Ot=Tt=null,Lc=!1,e)throw Error(me(300));return t}function Sp(){var t=wa!==0;return wa=0,t}function xi(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return Gt===null?Tt.memoizedState=Gt=t:Gt=Gt.next=t,Gt}function $n(){if(Ot===null){var t=Tt.alternate;t=t!==null?t.memoizedState:null}else t=Ot.next;var e=Gt===null?Tt.memoizedState:Gt.next;if(e!==null)Gt=e,Ot=t;else{if(t===null)throw Error(me(310));Ot=t,t={memoizedState:Ot.memoizedState,baseState:Ot.baseState,baseQueue:Ot.baseQueue,queue:Ot.queue,next:null},Gt===null?Tt.memoizedState=Gt=t:Gt=Gt.next=t}return Gt}function Ea(t,e){return typeof e=="function"?e(t):e}function Yd(t){var e=$n(),n=e.queue;if(n===null)throw Error(me(311));n.lastRenderedReducer=t;var i=Ot,r=i.baseQueue,s=n.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,n.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,c=s;do{var d=c.lane;if((ns&d)===d)l!==null&&(l=l.next={lane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),i=c.hasEagerState?c.eagerState:t(i,c.action);else{var f={lane:d,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null};l===null?(a=l=f,o=i):l=l.next=f,Tt.lanes|=d,is|=d}c=c.next}while(c!==null&&c!==s);l===null?o=i:l.next=a,ai(i,e.memoizedState)||(yn=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,n.lastRenderedState=i}if(t=n.interleaved,t!==null){r=t;do s=r.lane,Tt.lanes|=s,is|=s,r=r.next;while(r!==t)}else r===null&&(n.lanes=0);return[e.memoizedState,n.dispatch]}function Zd(t){var e=$n(),n=e.queue;if(n===null)throw Error(me(311));n.lastRenderedReducer=t;var i=n.dispatch,r=n.pending,s=e.memoizedState;if(r!==null){n.pending=null;var o=r=r.next;do s=t(s,o.action),o=o.next;while(o!==r);ai(s,e.memoizedState)||(yn=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),n.lastRenderedState=s}return[s,i]}function hv(){}function dv(t,e){var n=Tt,i=$n(),r=e(),s=!ai(i.memoizedState,r);if(s&&(i.memoizedState=r,yn=!0),i=i.queue,Mp(mv.bind(null,n,i,t),[t]),i.getSnapshot!==e||s||Gt!==null&&Gt.memoizedState.tag&1){if(n.flags|=2048,Ta(9,pv.bind(null,n,i,r,e),void 0,null),Ht===null)throw Error(me(349));ns&30||fv(n,e,r)}return r}function fv(t,e,n){t.flags|=16384,t={getSnapshot:e,value:n},e=Tt.updateQueue,e===null?(e={lastEffect:null,stores:null},Tt.updateQueue=e,e.stores=[t]):(n=e.stores,n===null?e.stores=[t]:n.push(t))}function pv(t,e,n,i){e.value=n,e.getSnapshot=i,gv(e)&&_v(t)}function mv(t,e,n){return n(function(){gv(e)&&_v(t)})}function gv(t){var e=t.getSnapshot;t=t.value;try{var n=e();return!ai(t,n)}catch{return!0}}function _v(t){var e=zi(t,1);e!==null&&oi(e,t,1,-1)}function k0(t){var e=xi();return typeof t=="function"&&(t=t()),e.memoizedState=e.baseState=t,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:Ea,lastRenderedState:t},e.queue=t,t=t.dispatch=m1.bind(null,Tt,t),[e.memoizedState,t]}function Ta(t,e,n,i){return t={tag:t,create:e,destroy:n,deps:i,next:null},e=Tt.updateQueue,e===null?(e={lastEffect:null,stores:null},Tt.updateQueue=e,e.lastEffect=t.next=t):(n=e.lastEffect,n===null?e.lastEffect=t.next=t:(i=n.next,n.next=t,t.next=i,e.lastEffect=t)),t}function vv(){return $n().memoizedState}function uc(t,e,n,i){var r=xi();Tt.flags|=t,r.memoizedState=Ta(1|e,n,void 0,i===void 0?null:i)}function Xc(t,e,n,i){var r=$n();i=i===void 0?null:i;var s=void 0;if(Ot!==null){var o=Ot.memoizedState;if(s=o.destroy,i!==null&&xp(i,o.deps)){r.memoizedState=Ta(e,n,s,i);return}}Tt.flags|=t,r.memoizedState=Ta(1|e,n,s,i)}function z0(t,e){return uc(8390656,8,t,e)}function Mp(t,e){return Xc(2048,8,t,e)}function xv(t,e){return Xc(4,2,t,e)}function yv(t,e){return Xc(4,4,t,e)}function Sv(t,e){if(typeof e=="function")return t=t(),e(t),function(){e(null)};if(e!=null)return t=t(),e.current=t,function(){e.current=null}}function Mv(t,e,n){return n=n!=null?n.concat([t]):null,Xc(4,4,Sv.bind(null,e,t),n)}function wp(){}function wv(t,e){var n=$n();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&xp(e,i[1])?i[0]:(n.memoizedState=[t,e],t)}function Ev(t,e){var n=$n();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&xp(e,i[1])?i[0]:(t=t(),n.memoizedState=[t,e],t)}function Tv(t,e,n){return ns&21?(ai(n,e)||(n=P_(),Tt.lanes|=n,is|=n,t.baseState=!0),e):(t.baseState&&(t.baseState=!1,yn=!0),t.memoizedState=n)}function f1(t,e){var n=ut;ut=n!==0&&4>n?n:4,t(!0);var i=qd.transition;qd.transition={};try{t(!1),e()}finally{ut=n,qd.transition=i}}function bv(){return $n().memoizedState}function p1(t,e,n){var i=xr(t);if(n={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null},Av(t))Cv(e,n);else if(n=lv(t,e,n,i),n!==null){var r=pn();oi(n,t,i,r),Rv(n,e,i)}}function m1(t,e,n){var i=xr(t),r={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null};if(Av(t))Cv(e,r);else{var s=t.alternate;if(t.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,n);if(r.hasEagerState=!0,r.eagerState=a,ai(a,o)){var l=e.interleaved;l===null?(r.next=r,pp(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}n=lv(t,e,r,i),n!==null&&(r=pn(),oi(n,t,i,r),Rv(n,e,i))}}function Av(t){var e=t.alternate;return t===Tt||e!==null&&e===Tt}function Cv(t,e){oa=Lc=!0;var n=t.pending;n===null?e.next=e:(e.next=n.next,n.next=e),t.pending=e}function Rv(t,e,n){if(n&4194240){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,ep(t,n)}}var Nc={readContext:Zn,useCallback:sn,useContext:sn,useEffect:sn,useImperativeHandle:sn,useInsertionEffect:sn,useLayoutEffect:sn,useMemo:sn,useReducer:sn,useRef:sn,useState:sn,useDebugValue:sn,useDeferredValue:sn,useTransition:sn,useMutableSource:sn,useSyncExternalStore:sn,useId:sn,unstable_isNewReconciler:!1},g1={readContext:Zn,useCallback:function(t,e){return xi().memoizedState=[t,e===void 0?null:e],t},useContext:Zn,useEffect:z0,useImperativeHandle:function(t,e,n){return n=n!=null?n.concat([t]):null,uc(4194308,4,Sv.bind(null,e,t),n)},useLayoutEffect:function(t,e){return uc(4194308,4,t,e)},useInsertionEffect:function(t,e){return uc(4,2,t,e)},useMemo:function(t,e){var n=xi();return e=e===void 0?null:e,t=t(),n.memoizedState=[t,e],t},useReducer:function(t,e,n){var i=xi();return e=n!==void 0?n(e):e,i.memoizedState=i.baseState=e,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:e},i.queue=t,t=t.dispatch=p1.bind(null,Tt,t),[i.memoizedState,t]},useRef:function(t){var e=xi();return t={current:t},e.memoizedState=t},useState:k0,useDebugValue:wp,useDeferredValue:function(t){return xi().memoizedState=t},useTransition:function(){var t=k0(!1),e=t[0];return t=f1.bind(null,t[1]),xi().memoizedState=t,[e,t]},useMutableSource:function(){},useSyncExternalStore:function(t,e,n){var i=Tt,r=xi();if(wt){if(n===void 0)throw Error(me(407));n=n()}else{if(n=e(),Ht===null)throw Error(me(349));ns&30||fv(i,e,n)}r.memoizedState=n;var s={value:n,getSnapshot:e};return r.queue=s,z0(mv.bind(null,i,s,t),[t]),i.flags|=2048,Ta(9,pv.bind(null,i,s,n,e),void 0,null),n},useId:function(){var t=xi(),e=Ht.identifierPrefix;if(wt){var n=Fi,i=Ui;n=(i&~(1<<32-si(i)-1)).toString(32)+n,e=":"+e+"R"+n,n=wa++,0<n&&(e+="H"+n.toString(32)),e+=":"}else n=d1++,e=":"+e+"r"+n.toString(32)+":";return t.memoizedState=e},unstable_isNewReconciler:!1},_1={readContext:Zn,useCallback:wv,useContext:Zn,useEffect:Mp,useImperativeHandle:Mv,useInsertionEffect:xv,useLayoutEffect:yv,useMemo:Ev,useReducer:Yd,useRef:vv,useState:function(){return Yd(Ea)},useDebugValue:wp,useDeferredValue:function(t){var e=$n();return Tv(e,Ot.memoizedState,t)},useTransition:function(){var t=Yd(Ea)[0],e=$n().memoizedState;return[t,e]},useMutableSource:hv,useSyncExternalStore:dv,useId:bv,unstable_isNewReconciler:!1},v1={readContext:Zn,useCallback:wv,useContext:Zn,useEffect:Mp,useImperativeHandle:Mv,useInsertionEffect:xv,useLayoutEffect:yv,useMemo:Ev,useReducer:Zd,useRef:vv,useState:function(){return Zd(Ea)},useDebugValue:wp,useDeferredValue:function(t){var e=$n();return Ot===null?e.memoizedState=t:Tv(e,Ot.memoizedState,t)},useTransition:function(){var t=Zd(Ea)[0],e=$n().memoizedState;return[t,e]},useMutableSource:hv,useSyncExternalStore:dv,useId:bv,unstable_isNewReconciler:!1};function ni(t,e){if(t&&t.defaultProps){e=bt({},e),t=t.defaultProps;for(var n in t)e[n]===void 0&&(e[n]=t[n]);return e}return e}function Pf(t,e,n,i){e=t.memoizedState,n=n(i,e),n=n==null?e:bt({},e,n),t.memoizedState=n,t.lanes===0&&(t.updateQueue.baseState=n)}var qc={isMounted:function(t){return(t=t._reactInternals)?os(t)===t:!1},enqueueSetState:function(t,e,n){t=t._reactInternals;var i=pn(),r=xr(t),s=Oi(i,r);s.payload=e,n!=null&&(s.callback=n),e=_r(t,s,r),e!==null&&(oi(e,t,r,i),lc(e,t,r))},enqueueReplaceState:function(t,e,n){t=t._reactInternals;var i=pn(),r=xr(t),s=Oi(i,r);s.tag=1,s.payload=e,n!=null&&(s.callback=n),e=_r(t,s,r),e!==null&&(oi(e,t,r,i),lc(e,t,r))},enqueueForceUpdate:function(t,e){t=t._reactInternals;var n=pn(),i=xr(t),r=Oi(n,i);r.tag=2,e!=null&&(r.callback=e),e=_r(t,r,i),e!==null&&(oi(e,t,i,n),lc(e,t,i))}};function V0(t,e,n,i,r,s,o){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!_a(n,i)||!_a(r,s):!0}function Pv(t,e,n){var i=!1,r=Mr,s=e.contextType;return typeof s=="object"&&s!==null?s=Zn(s):(r=Mn(e)?es:ln.current,i=e.contextTypes,s=(i=i!=null)?qs(t,r):Mr),e=new e(n,s),t.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=qc,t.stateNode=e,e._reactInternals=t,i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=r,t.__reactInternalMemoizedMaskedChildContext=s),e}function G0(t,e,n,i){t=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(n,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(n,i),e.state!==t&&qc.enqueueReplaceState(e,e.state,null)}function If(t,e,n,i){var r=t.stateNode;r.props=n,r.state=t.memoizedState,r.refs={},mp(t);var s=e.contextType;typeof s=="object"&&s!==null?r.context=Zn(s):(s=Mn(e)?es:ln.current,r.context=qs(t,s)),r.state=t.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(Pf(t,e,s,n),r.state=t.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&qc.enqueueReplaceState(r,r.state,null),Pc(t,n,r,i),r.state=t.memoizedState),typeof r.componentDidMount=="function"&&(t.flags|=4194308)}function Js(t,e){try{var n="",i=e;do n+=ZS(i),i=i.return;while(i);var r=n}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:t,source:e,stack:r,digest:null}}function $d(t,e,n){return{value:t,source:null,stack:n??null,digest:e??null}}function Lf(t,e){try{console.error(e.value)}catch(n){setTimeout(function(){throw n})}}var x1=typeof WeakMap=="function"?WeakMap:Map;function Iv(t,e,n){n=Oi(-1,n),n.tag=3,n.payload={element:null};var i=e.value;return n.callback=function(){Uc||(Uc=!0,Gf=i),Lf(t,e)},n}function Lv(t,e,n){n=Oi(-1,n),n.tag=3;var i=t.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;n.payload=function(){return i(r)},n.callback=function(){Lf(t,e)}}var s=t.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(n.callback=function(){Lf(t,e),typeof i!="function"&&(vr===null?vr=new Set([this]):vr.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),n}function H0(t,e,n){var i=t.pingCache;if(i===null){i=t.pingCache=new x1;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(n)||(r.add(n),t=N1.bind(null,t,e,n),e.then(t,t))}function W0(t){do{var e;if((e=t.tag===13)&&(e=t.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return t;t=t.return}while(t!==null);return null}function X0(t,e,n,i,r){return t.mode&1?(t.flags|=65536,t.lanes=r,t):(t===e?t.flags|=65536:(t.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(e=Oi(-1,1),e.tag=2,_r(n,e,1))),n.lanes|=1),t)}var y1=Gi.ReactCurrentOwner,yn=!1;function fn(t,e,n,i){e.child=t===null?av(e,null,n,i):Zs(e,t.child,n,i)}function q0(t,e,n,i,r){n=n.render;var s=e.ref;return Hs(e,r),i=yp(t,e,n,i,s,r),n=Sp(),t!==null&&!yn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,Vi(t,e,r)):(wt&&n&&lp(e),e.flags|=1,fn(t,e,i,r),e.child)}function Y0(t,e,n,i,r){if(t===null){var s=n.type;return typeof s=="function"&&!Ip(s)&&s.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(e.tag=15,e.type=s,Nv(t,e,s,i,r)):(t=pc(n.type,null,i,e,e.mode,r),t.ref=e.ref,t.return=e,e.child=t)}if(s=t.child,!(t.lanes&r)){var o=s.memoizedProps;if(n=n.compare,n=n!==null?n:_a,n(o,i)&&t.ref===e.ref)return Vi(t,e,r)}return e.flags|=1,t=yr(s,i),t.ref=e.ref,t.return=e,e.child=t}function Nv(t,e,n,i,r){if(t!==null){var s=t.memoizedProps;if(_a(s,i)&&t.ref===e.ref)if(yn=!1,e.pendingProps=i=s,(t.lanes&r)!==0)t.flags&131072&&(yn=!0);else return e.lanes=t.lanes,Vi(t,e,r)}return Nf(t,e,n,i,r)}function Dv(t,e,n){var i=e.pendingProps,r=i.children,s=t!==null?t.memoizedState:null;if(i.mode==="hidden")if(!(e.mode&1))e.memoizedState={baseLanes:0,cachePool:null,transitions:null},_t(Bs,Cn),Cn|=n;else{if(!(n&1073741824))return t=s!==null?s.baseLanes|n:n,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:t,cachePool:null,transitions:null},e.updateQueue=null,_t(Bs,Cn),Cn|=t,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:n,_t(Bs,Cn),Cn|=i}else s!==null?(i=s.baseLanes|n,e.memoizedState=null):i=n,_t(Bs,Cn),Cn|=i;return fn(t,e,r,n),e.child}function Uv(t,e){var n=e.ref;(t===null&&n!==null||t!==null&&t.ref!==n)&&(e.flags|=512,e.flags|=2097152)}function Nf(t,e,n,i,r){var s=Mn(n)?es:ln.current;return s=qs(e,s),Hs(e,r),n=yp(t,e,n,i,s,r),i=Sp(),t!==null&&!yn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,Vi(t,e,r)):(wt&&i&&lp(e),e.flags|=1,fn(t,e,n,r),e.child)}function Z0(t,e,n,i,r){if(Mn(n)){var s=!0;Tc(e)}else s=!1;if(Hs(e,r),e.stateNode===null)hc(t,e),Pv(e,n,i),If(e,n,i,r),i=!0;else if(t===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,c=n.contextType;typeof c=="object"&&c!==null?c=Zn(c):(c=Mn(n)?es:ln.current,c=qs(e,c));var d=n.getDerivedStateFromProps,f=typeof d=="function"||typeof o.getSnapshotBeforeUpdate=="function";f||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==c)&&G0(e,o,i,c),lr=!1;var u=e.memoizedState;o.state=u,Pc(e,i,o,r),l=e.memoizedState,a!==i||u!==l||Sn.current||lr?(typeof d=="function"&&(Pf(e,n,d,i),l=e.memoizedState),(a=lr||V0(e,n,a,i,u,l,c))?(f||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=c,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,cv(t,e),a=e.memoizedProps,c=e.type===e.elementType?a:ni(e.type,a),o.props=c,f=e.pendingProps,u=o.context,l=n.contextType,typeof l=="object"&&l!==null?l=Zn(l):(l=Mn(n)?es:ln.current,l=qs(e,l));var p=n.getDerivedStateFromProps;(d=typeof p=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==f||u!==l)&&G0(e,o,i,l),lr=!1,u=e.memoizedState,o.state=u,Pc(e,i,o,r);var g=e.memoizedState;a!==f||u!==g||Sn.current||lr?(typeof p=="function"&&(Pf(e,n,p,i),g=e.memoizedState),(c=lr||V0(e,n,c,i,u,g,l)||!1)?(d||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,g,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,g,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&u===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&u===t.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=g),o.props=i,o.state=g,o.context=l,i=c):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&u===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&u===t.memoizedState||(e.flags|=1024),i=!1)}return Df(t,e,n,i,s,r)}function Df(t,e,n,i,r,s){Uv(t,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&N0(e,n,!1),Vi(t,e,s);i=e.stateNode,y1.current=e;var a=o&&typeof n.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,t!==null&&o?(e.child=Zs(e,t.child,null,s),e.child=Zs(e,null,a,s)):fn(t,e,a,s),e.memoizedState=i.state,r&&N0(e,n,!0),e.child}function Fv(t){var e=t.stateNode;e.pendingContext?L0(t,e.pendingContext,e.pendingContext!==e.context):e.context&&L0(t,e.context,!1),gp(t,e.containerInfo)}function $0(t,e,n,i,r){return Ys(),up(r),e.flags|=256,fn(t,e,n,i),e.child}var Uf={dehydrated:null,treeContext:null,retryLane:0};function Ff(t){return{baseLanes:t,cachePool:null,transitions:null}}function Ov(t,e,n){var i=e.pendingProps,r=Et.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=t!==null&&t.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(t===null||t.memoizedState!==null)&&(r|=1),_t(Et,r&1),t===null)return Cf(e),t=e.memoizedState,t!==null&&(t=t.dehydrated,t!==null)?(e.mode&1?t.data==="$!"?e.lanes=8:e.lanes=1073741824:e.lanes=1,null):(o=i.children,t=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},!(i&1)&&s!==null?(s.childLanes=0,s.pendingProps=o):s=$c(o,i,0,null),t=Qr(t,i,n,null),s.return=e,t.return=e,s.sibling=t,e.child=s,e.child.memoizedState=Ff(n),e.memoizedState=Uf,t):Ep(e,o));if(r=t.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return S1(t,e,o,i,a,r,n);if(s){s=i.fallback,o=e.mode,r=t.child,a=r.sibling;var l={mode:"hidden",children:i.children};return!(o&1)&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=yr(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=yr(a,s):(s=Qr(s,o,n,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=t.child.memoizedState,o=o===null?Ff(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=t.childLanes&~n,e.memoizedState=Uf,i}return s=t.child,t=s.sibling,i=yr(s,{mode:"visible",children:i.children}),!(e.mode&1)&&(i.lanes=n),i.return=e,i.sibling=null,t!==null&&(n=e.deletions,n===null?(e.deletions=[t],e.flags|=16):n.push(t)),e.child=i,e.memoizedState=null,i}function Ep(t,e){return e=$c({mode:"visible",children:e},t.mode,0,null),e.return=t,t.child=e}function nc(t,e,n,i){return i!==null&&up(i),Zs(e,t.child,null,n),t=Ep(e,e.pendingProps.children),t.flags|=2,e.memoizedState=null,t}function S1(t,e,n,i,r,s,o){if(n)return e.flags&256?(e.flags&=-257,i=$d(Error(me(422))),nc(t,e,o,i)):e.memoizedState!==null?(e.child=t.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=$c({mode:"visible",children:i.children},r,0,null),s=Qr(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,e.mode&1&&Zs(e,t.child,null,o),e.child.memoizedState=Ff(o),e.memoizedState=Uf,s);if(!(e.mode&1))return nc(t,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(me(419)),i=$d(s,i,void 0),nc(t,e,o,i)}if(a=(o&t.childLanes)!==0,yn||a){if(i=Ht,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=r&(i.suspendedLanes|o)?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,zi(t,r),oi(i,t,r,-1))}return Pp(),i=$d(Error(me(421))),nc(t,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=t.child,e=D1.bind(null,t),r._reactRetry=e,null):(t=s.treeContext,Rn=gr(r.nextSibling),Pn=e,wt=!0,ri=null,t!==null&&(Wn[Xn++]=Ui,Wn[Xn++]=Fi,Wn[Xn++]=ts,Ui=t.id,Fi=t.overflow,ts=e),e=Ep(e,i.children),e.flags|=4096,e)}function J0(t,e,n){t.lanes|=e;var i=t.alternate;i!==null&&(i.lanes|=e),Rf(t.return,e,n)}function Jd(t,e,n,i,r){var s=t.memoizedState;s===null?t.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=n,s.tailMode=r)}function Bv(t,e,n){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(fn(t,e,i.children,n),i=Et.current,i&2)i=i&1|2,e.flags|=128;else{if(t!==null&&t.flags&128)e:for(t=e.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&J0(t,n,e);else if(t.tag===19)J0(t,n,e);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break e;for(;t.sibling===null;){if(t.return===null||t.return===e)break e;t=t.return}t.sibling.return=t.return,t=t.sibling}i&=1}if(_t(Et,i),!(e.mode&1))e.memoizedState=null;else switch(r){case"forwards":for(n=e.child,r=null;n!==null;)t=n.alternate,t!==null&&Ic(t)===null&&(r=n),n=n.sibling;n=r,n===null?(r=e.child,e.child=null):(r=n.sibling,n.sibling=null),Jd(e,!1,r,n,s);break;case"backwards":for(n=null,r=e.child,e.child=null;r!==null;){if(t=r.alternate,t!==null&&Ic(t)===null){e.child=r;break}t=r.sibling,r.sibling=n,n=r,r=t}Jd(e,!0,n,null,s);break;case"together":Jd(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function hc(t,e){!(e.mode&1)&&t!==null&&(t.alternate=null,e.alternate=null,e.flags|=2)}function Vi(t,e,n){if(t!==null&&(e.dependencies=t.dependencies),is|=e.lanes,!(n&e.childLanes))return null;if(t!==null&&e.child!==t.child)throw Error(me(153));if(e.child!==null){for(t=e.child,n=yr(t,t.pendingProps),e.child=n,n.return=e;t.sibling!==null;)t=t.sibling,n=n.sibling=yr(t,t.pendingProps),n.return=e;n.sibling=null}return e.child}function M1(t,e,n){switch(e.tag){case 3:Fv(e),Ys();break;case 5:uv(e);break;case 1:Mn(e.type)&&Tc(e);break;case 4:gp(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;_t(Cc,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(_t(Et,Et.current&1),e.flags|=128,null):n&e.child.childLanes?Ov(t,e,n):(_t(Et,Et.current&1),t=Vi(t,e,n),t!==null?t.sibling:null);_t(Et,Et.current&1);break;case 19:if(i=(n&e.childLanes)!==0,t.flags&128){if(i)return Bv(t,e,n);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),_t(Et,Et.current),i)break;return null;case 22:case 23:return e.lanes=0,Dv(t,e,n)}return Vi(t,e,n)}var kv,Of,zv,Vv;kv=function(t,e){for(var n=e.child;n!==null;){if(n.tag===5||n.tag===6)t.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return;n=n.return}n.sibling.return=n.return,n=n.sibling}};Of=function(){};zv=function(t,e,n,i){var r=t.memoizedProps;if(r!==i){t=e.stateNode,Kr(Mi.current);var s=null;switch(n){case"input":r=sf(t,r),i=sf(t,i),s=[];break;case"select":r=bt({},r,{value:void 0}),i=bt({},i,{value:void 0}),s=[];break;case"textarea":r=lf(t,r),i=lf(t,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(t.onclick=wc)}uf(n,i);var o;n=null;for(c in r)if(!i.hasOwnProperty(c)&&r.hasOwnProperty(c)&&r[c]!=null)if(c==="style"){var a=r[c];for(o in a)a.hasOwnProperty(o)&&(n||(n={}),n[o]="")}else c!=="dangerouslySetInnerHTML"&&c!=="children"&&c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&c!=="autoFocus"&&(ua.hasOwnProperty(c)?s||(s=[]):(s=s||[]).push(c,null));for(c in i){var l=i[c];if(a=r!=null?r[c]:void 0,i.hasOwnProperty(c)&&l!==a&&(l!=null||a!=null))if(c==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(n||(n={}),n[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(n||(n={}),n[o]=l[o])}else n||(s||(s=[]),s.push(c,n)),n=l;else c==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(c,l)):c==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(c,""+l):c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&(ua.hasOwnProperty(c)?(l!=null&&c==="onScroll"&&xt("scroll",t),s||a===l||(s=[])):(s=s||[]).push(c,l))}n&&(s=s||[]).push("style",n);var c=s;(e.updateQueue=c)&&(e.flags|=4)}};Vv=function(t,e,n,i){n!==i&&(e.flags|=4)};function Zo(t,e){if(!wt)switch(t.tailMode){case"hidden":e=t.tail;for(var n=null;e!==null;)e.alternate!==null&&(n=e),e=e.sibling;n===null?t.tail=null:n.sibling=null;break;case"collapsed":n=t.tail;for(var i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?e||t.tail===null?t.tail=null:t.tail.sibling=null:i.sibling=null}}function on(t){var e=t.alternate!==null&&t.alternate.child===t.child,n=0,i=0;if(e)for(var r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=t,r=r.sibling;else for(r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=t,r=r.sibling;return t.subtreeFlags|=i,t.childLanes=n,e}function w1(t,e,n){var i=e.pendingProps;switch(cp(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return on(e),null;case 1:return Mn(e.type)&&Ec(),on(e),null;case 3:return i=e.stateNode,$s(),yt(Sn),yt(ln),vp(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(t===null||t.child===null)&&(ec(e)?e.flags|=4:t===null||t.memoizedState.isDehydrated&&!(e.flags&256)||(e.flags|=1024,ri!==null&&(Xf(ri),ri=null))),Of(t,e),on(e),null;case 5:_p(e);var r=Kr(Ma.current);if(n=e.type,t!==null&&e.stateNode!=null)zv(t,e,n,i,r),t.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(me(166));return on(e),null}if(t=Kr(Mi.current),ec(e)){i=e.stateNode,n=e.type;var s=e.memoizedProps;switch(i[yi]=e,i[ya]=s,t=(e.mode&1)!==0,n){case"dialog":xt("cancel",i),xt("close",i);break;case"iframe":case"object":case"embed":xt("load",i);break;case"video":case"audio":for(r=0;r<ea.length;r++)xt(ea[r],i);break;case"source":xt("error",i);break;case"img":case"image":case"link":xt("error",i),xt("load",i);break;case"details":xt("toggle",i);break;case"input":r0(i,s),xt("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},xt("invalid",i);break;case"textarea":o0(i,s),xt("invalid",i)}uf(n,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&Ql(i.textContent,a,t),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&Ql(i.textContent,a,t),r=["children",""+a]):ua.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&xt("scroll",i)}switch(n){case"input":Vl(i),s0(i,s,!0);break;case"textarea":Vl(i),a0(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=wc)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,t==="http://www.w3.org/1999/xhtml"&&(t=m_(n)),t==="http://www.w3.org/1999/xhtml"?n==="script"?(t=o.createElement("div"),t.innerHTML="<script><\/script>",t=t.removeChild(t.firstChild)):typeof i.is=="string"?t=o.createElement(n,{is:i.is}):(t=o.createElement(n),n==="select"&&(o=t,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):t=o.createElementNS(t,n),t[yi]=e,t[ya]=i,kv(t,e,!1,!1),e.stateNode=t;e:{switch(o=hf(n,i),n){case"dialog":xt("cancel",t),xt("close",t),r=i;break;case"iframe":case"object":case"embed":xt("load",t),r=i;break;case"video":case"audio":for(r=0;r<ea.length;r++)xt(ea[r],t);r=i;break;case"source":xt("error",t),r=i;break;case"img":case"image":case"link":xt("error",t),xt("load",t),r=i;break;case"details":xt("toggle",t),r=i;break;case"input":r0(t,i),r=sf(t,i),xt("invalid",t);break;case"option":r=i;break;case"select":t._wrapperState={wasMultiple:!!i.multiple},r=bt({},i,{value:void 0}),xt("invalid",t);break;case"textarea":o0(t,i),r=lf(t,i),xt("invalid",t);break;default:r=i}uf(n,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?v_(t,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&g_(t,l)):s==="children"?typeof l=="string"?(n!=="textarea"||l!=="")&&ha(t,l):typeof l=="number"&&ha(t,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(ua.hasOwnProperty(s)?l!=null&&s==="onScroll"&&xt("scroll",t):l!=null&&Zf(t,s,l,o))}switch(n){case"input":Vl(t),s0(t,i,!1);break;case"textarea":Vl(t),a0(t);break;case"option":i.value!=null&&t.setAttribute("value",""+Sr(i.value));break;case"select":t.multiple=!!i.multiple,s=i.value,s!=null?ks(t,!!i.multiple,s,!1):i.defaultValue!=null&&ks(t,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(t.onclick=wc)}switch(n){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return on(e),null;case 6:if(t&&e.stateNode!=null)Vv(t,e,t.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(me(166));if(n=Kr(Ma.current),Kr(Mi.current),ec(e)){if(i=e.stateNode,n=e.memoizedProps,i[yi]=e,(s=i.nodeValue!==n)&&(t=Pn,t!==null))switch(t.tag){case 3:Ql(i.nodeValue,n,(t.mode&1)!==0);break;case 5:t.memoizedProps.suppressHydrationWarning!==!0&&Ql(i.nodeValue,n,(t.mode&1)!==0)}s&&(e.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[yi]=e,e.stateNode=i}return on(e),null;case 13:if(yt(Et),i=e.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(wt&&Rn!==null&&e.mode&1&&!(e.flags&128))sv(),Ys(),e.flags|=98560,s=!1;else if(s=ec(e),i!==null&&i.dehydrated!==null){if(t===null){if(!s)throw Error(me(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(me(317));s[yi]=e}else Ys(),!(e.flags&128)&&(e.memoizedState=null),e.flags|=4;on(e),s=!1}else ri!==null&&(Xf(ri),ri=null),s=!0;if(!s)return e.flags&65536?e:null}return e.flags&128?(e.lanes=n,e):(i=i!==null,i!==(t!==null&&t.memoizedState!==null)&&i&&(e.child.flags|=8192,e.mode&1&&(t===null||Et.current&1?Bt===0&&(Bt=3):Pp())),e.updateQueue!==null&&(e.flags|=4),on(e),null);case 4:return $s(),Of(t,e),t===null&&va(e.stateNode.containerInfo),on(e),null;case 10:return fp(e.type._context),on(e),null;case 17:return Mn(e.type)&&Ec(),on(e),null;case 19:if(yt(Et),s=e.memoizedState,s===null)return on(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)Zo(s,!1);else{if(Bt!==0||t!==null&&t.flags&128)for(t=e.child;t!==null;){if(o=Ic(t),o!==null){for(e.flags|=128,Zo(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=n,n=e.child;n!==null;)s=n,t=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=t,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,t=o.dependencies,s.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext}),n=n.sibling;return _t(Et,Et.current&1|2),e.child}t=t.sibling}s.tail!==null&&Dt()>Ks&&(e.flags|=128,i=!0,Zo(s,!1),e.lanes=4194304)}else{if(!i)if(t=Ic(o),t!==null){if(e.flags|=128,i=!0,n=t.updateQueue,n!==null&&(e.updateQueue=n,e.flags|=4),Zo(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!wt)return on(e),null}else 2*Dt()-s.renderingStartTime>Ks&&n!==1073741824&&(e.flags|=128,i=!0,Zo(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(n=s.last,n!==null?n.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=Dt(),e.sibling=null,n=Et.current,_t(Et,i?n&1|2:n&1),e):(on(e),null);case 22:case 23:return Rp(),i=e.memoizedState!==null,t!==null&&t.memoizedState!==null!==i&&(e.flags|=8192),i&&e.mode&1?Cn&1073741824&&(on(e),e.subtreeFlags&6&&(e.flags|=8192)):on(e),null;case 24:return null;case 25:return null}throw Error(me(156,e.tag))}function E1(t,e){switch(cp(e),e.tag){case 1:return Mn(e.type)&&Ec(),t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 3:return $s(),yt(Sn),yt(ln),vp(),t=e.flags,t&65536&&!(t&128)?(e.flags=t&-65537|128,e):null;case 5:return _p(e),null;case 13:if(yt(Et),t=e.memoizedState,t!==null&&t.dehydrated!==null){if(e.alternate===null)throw Error(me(340));Ys()}return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 19:return yt(Et),null;case 4:return $s(),null;case 10:return fp(e.type._context),null;case 22:case 23:return Rp(),null;case 24:return null;default:return null}}var ic=!1,an=!1,T1=typeof WeakSet=="function"?WeakSet:Set,De=null;function Os(t,e){var n=t.ref;if(n!==null)if(typeof n=="function")try{n(null)}catch(i){It(t,e,i)}else n.current=null}function Bf(t,e,n){try{n()}catch(i){It(t,e,i)}}var K0=!1;function b1(t,e){if(Sf=yc,t=q_(),ap(t)){if("selectionStart"in t)var n={start:t.selectionStart,end:t.selectionEnd};else e:{n=(n=t.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{n.nodeType,s.nodeType}catch{n=null;break e}var o=0,a=-1,l=-1,c=0,d=0,f=t,u=null;t:for(;;){for(var p;f!==n||r!==0&&f.nodeType!==3||(a=o+r),f!==s||i!==0&&f.nodeType!==3||(l=o+i),f.nodeType===3&&(o+=f.nodeValue.length),(p=f.firstChild)!==null;)u=f,f=p;for(;;){if(f===t)break t;if(u===n&&++c===r&&(a=o),u===s&&++d===i&&(l=o),(p=f.nextSibling)!==null)break;f=u,u=f.parentNode}f=p}n=a===-1||l===-1?null:{start:a,end:l}}else n=null}n=n||{start:0,end:0}}else n=null;for(Mf={focusedElem:t,selectionRange:n},yc=!1,De=e;De!==null;)if(e=De,t=e.child,(e.subtreeFlags&1028)!==0&&t!==null)t.return=e,De=t;else for(;De!==null;){e=De;try{var g=e.alternate;if(e.flags&1024)switch(e.tag){case 0:case 11:case 15:break;case 1:if(g!==null){var M=g.memoizedProps,_=g.memoizedState,h=e.stateNode,m=h.getSnapshotBeforeUpdate(e.elementType===e.type?M:ni(e.type,M),_);h.__reactInternalSnapshotBeforeUpdate=m}break;case 3:var v=e.stateNode.containerInfo;v.nodeType===1?v.textContent="":v.nodeType===9&&v.documentElement&&v.removeChild(v.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(me(163))}}catch(y){It(e,e.return,y)}if(t=e.sibling,t!==null){t.return=e.return,De=t;break}De=e.return}return g=K0,K0=!1,g}function aa(t,e,n){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&t)===t){var s=r.destroy;r.destroy=void 0,s!==void 0&&Bf(e,n,s)}r=r.next}while(r!==i)}}function Yc(t,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var n=e=e.next;do{if((n.tag&t)===t){var i=n.create;n.destroy=i()}n=n.next}while(n!==e)}}function kf(t){var e=t.ref;if(e!==null){var n=t.stateNode;switch(t.tag){case 5:t=n;break;default:t=n}typeof e=="function"?e(t):e.current=t}}function Gv(t){var e=t.alternate;e!==null&&(t.alternate=null,Gv(e)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(e=t.stateNode,e!==null&&(delete e[yi],delete e[ya],delete e[Tf],delete e[l1],delete e[c1])),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}function Hv(t){return t.tag===5||t.tag===3||t.tag===4}function j0(t){e:for(;;){for(;t.sibling===null;){if(t.return===null||Hv(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.flags&2||t.child===null||t.tag===4)continue e;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function zf(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.nodeType===8?n.parentNode.insertBefore(t,e):n.insertBefore(t,e):(n.nodeType===8?(e=n.parentNode,e.insertBefore(t,n)):(e=n,e.appendChild(t)),n=n._reactRootContainer,n!=null||e.onclick!==null||(e.onclick=wc));else if(i!==4&&(t=t.child,t!==null))for(zf(t,e,n),t=t.sibling;t!==null;)zf(t,e,n),t=t.sibling}function Vf(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.insertBefore(t,e):n.appendChild(t);else if(i!==4&&(t=t.child,t!==null))for(Vf(t,e,n),t=t.sibling;t!==null;)Vf(t,e,n),t=t.sibling}var Yt=null,ii=!1;function or(t,e,n){for(n=n.child;n!==null;)Wv(t,e,n),n=n.sibling}function Wv(t,e,n){if(Si&&typeof Si.onCommitFiberUnmount=="function")try{Si.onCommitFiberUnmount(kc,n)}catch{}switch(n.tag){case 5:an||Os(n,e);case 6:var i=Yt,r=ii;Yt=null,or(t,e,n),Yt=i,ii=r,Yt!==null&&(ii?(t=Yt,n=n.stateNode,t.nodeType===8?t.parentNode.removeChild(n):t.removeChild(n)):Yt.removeChild(n.stateNode));break;case 18:Yt!==null&&(ii?(t=Yt,n=n.stateNode,t.nodeType===8?Hd(t.parentNode,n):t.nodeType===1&&Hd(t,n),ma(t)):Hd(Yt,n.stateNode));break;case 4:i=Yt,r=ii,Yt=n.stateNode.containerInfo,ii=!0,or(t,e,n),Yt=i,ii=r;break;case 0:case 11:case 14:case 15:if(!an&&(i=n.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&(s&2||s&4)&&Bf(n,e,o),r=r.next}while(r!==i)}or(t,e,n);break;case 1:if(!an&&(Os(n,e),i=n.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=n.memoizedProps,i.state=n.memoizedState,i.componentWillUnmount()}catch(a){It(n,e,a)}or(t,e,n);break;case 21:or(t,e,n);break;case 22:n.mode&1?(an=(i=an)||n.memoizedState!==null,or(t,e,n),an=i):or(t,e,n);break;default:or(t,e,n)}}function Q0(t){var e=t.updateQueue;if(e!==null){t.updateQueue=null;var n=t.stateNode;n===null&&(n=t.stateNode=new T1),e.forEach(function(i){var r=U1.bind(null,t,i);n.has(i)||(n.add(i),i.then(r,r))})}}function ti(t,e){var n=e.deletions;if(n!==null)for(var i=0;i<n.length;i++){var r=n[i];try{var s=t,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:Yt=a.stateNode,ii=!1;break e;case 3:Yt=a.stateNode.containerInfo,ii=!0;break e;case 4:Yt=a.stateNode.containerInfo,ii=!0;break e}a=a.return}if(Yt===null)throw Error(me(160));Wv(s,o,r),Yt=null,ii=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(c){It(r,e,c)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)Xv(e,t),e=e.sibling}function Xv(t,e){var n=t.alternate,i=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:if(ti(e,t),vi(t),i&4){try{aa(3,t,t.return),Yc(3,t)}catch(M){It(t,t.return,M)}try{aa(5,t,t.return)}catch(M){It(t,t.return,M)}}break;case 1:ti(e,t),vi(t),i&512&&n!==null&&Os(n,n.return);break;case 5:if(ti(e,t),vi(t),i&512&&n!==null&&Os(n,n.return),t.flags&32){var r=t.stateNode;try{ha(r,"")}catch(M){It(t,t.return,M)}}if(i&4&&(r=t.stateNode,r!=null)){var s=t.memoizedProps,o=n!==null?n.memoizedProps:s,a=t.type,l=t.updateQueue;if(t.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&f_(r,s),hf(a,o);var c=hf(a,s);for(o=0;o<l.length;o+=2){var d=l[o],f=l[o+1];d==="style"?v_(r,f):d==="dangerouslySetInnerHTML"?g_(r,f):d==="children"?ha(r,f):Zf(r,d,f,c)}switch(a){case"input":of(r,s);break;case"textarea":p_(r,s);break;case"select":var u=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var p=s.value;p!=null?ks(r,!!s.multiple,p,!1):u!==!!s.multiple&&(s.defaultValue!=null?ks(r,!!s.multiple,s.defaultValue,!0):ks(r,!!s.multiple,s.multiple?[]:"",!1))}r[ya]=s}catch(M){It(t,t.return,M)}}break;case 6:if(ti(e,t),vi(t),i&4){if(t.stateNode===null)throw Error(me(162));r=t.stateNode,s=t.memoizedProps;try{r.nodeValue=s}catch(M){It(t,t.return,M)}}break;case 3:if(ti(e,t),vi(t),i&4&&n!==null&&n.memoizedState.isDehydrated)try{ma(e.containerInfo)}catch(M){It(t,t.return,M)}break;case 4:ti(e,t),vi(t);break;case 13:ti(e,t),vi(t),r=t.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(Ap=Dt())),i&4&&Q0(t);break;case 22:if(d=n!==null&&n.memoizedState!==null,t.mode&1?(an=(c=an)||d,ti(e,t),an=c):ti(e,t),vi(t),i&8192){if(c=t.memoizedState!==null,(t.stateNode.isHidden=c)&&!d&&t.mode&1)for(De=t,d=t.child;d!==null;){for(f=De=d;De!==null;){switch(u=De,p=u.child,u.tag){case 0:case 11:case 14:case 15:aa(4,u,u.return);break;case 1:Os(u,u.return);var g=u.stateNode;if(typeof g.componentWillUnmount=="function"){i=u,n=u.return;try{e=i,g.props=e.memoizedProps,g.state=e.memoizedState,g.componentWillUnmount()}catch(M){It(i,n,M)}}break;case 5:Os(u,u.return);break;case 22:if(u.memoizedState!==null){t_(f);continue}}p!==null?(p.return=u,De=p):t_(f)}d=d.sibling}e:for(d=null,f=t;;){if(f.tag===5){if(d===null){d=f;try{r=f.stateNode,c?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=f.stateNode,l=f.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=__("display",o))}catch(M){It(t,t.return,M)}}}else if(f.tag===6){if(d===null)try{f.stateNode.nodeValue=c?"":f.memoizedProps}catch(M){It(t,t.return,M)}}else if((f.tag!==22&&f.tag!==23||f.memoizedState===null||f===t)&&f.child!==null){f.child.return=f,f=f.child;continue}if(f===t)break e;for(;f.sibling===null;){if(f.return===null||f.return===t)break e;d===f&&(d=null),f=f.return}d===f&&(d=null),f.sibling.return=f.return,f=f.sibling}}break;case 19:ti(e,t),vi(t),i&4&&Q0(t);break;case 21:break;default:ti(e,t),vi(t)}}function vi(t){var e=t.flags;if(e&2){try{e:{for(var n=t.return;n!==null;){if(Hv(n)){var i=n;break e}n=n.return}throw Error(me(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(ha(r,""),i.flags&=-33);var s=j0(t);Vf(t,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=j0(t);zf(t,a,o);break;default:throw Error(me(161))}}catch(l){It(t,t.return,l)}t.flags&=-3}e&4096&&(t.flags&=-4097)}function A1(t,e,n){De=t,qv(t,e,n)}function qv(t,e,n){for(var i=(t.mode&1)!==0;De!==null;){var r=De,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||ic;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||an;a=ic;var c=an;if(ic=o,(an=l)&&!c)for(De=r;De!==null;)o=De,l=o.child,o.tag===22&&o.memoizedState!==null?n_(r):l!==null?(l.return=o,De=l):n_(r);for(;s!==null;)De=s,qv(s,e,n),s=s.sibling;De=r,ic=a,an=c}e_(t,e,n)}else r.subtreeFlags&8772&&s!==null?(s.return=r,De=s):e_(t,e,n)}}function e_(t){for(;De!==null;){var e=De;if(e.flags&8772){var n=e.alternate;try{if(e.flags&8772)switch(e.tag){case 0:case 11:case 15:an||Yc(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!an)if(n===null)i.componentDidMount();else{var r=e.elementType===e.type?n.memoizedProps:ni(e.type,n.memoizedProps);i.componentDidUpdate(r,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&B0(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(n=null,e.child!==null)switch(e.child.tag){case 5:n=e.child.stateNode;break;case 1:n=e.child.stateNode}B0(e,o,n)}break;case 5:var a=e.stateNode;if(n===null&&e.flags&4){n=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&n.focus();break;case"img":l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var c=e.alternate;if(c!==null){var d=c.memoizedState;if(d!==null){var f=d.dehydrated;f!==null&&ma(f)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(me(163))}an||e.flags&512&&kf(e)}catch(u){It(e,e.return,u)}}if(e===t){De=null;break}if(n=e.sibling,n!==null){n.return=e.return,De=n;break}De=e.return}}function t_(t){for(;De!==null;){var e=De;if(e===t){De=null;break}var n=e.sibling;if(n!==null){n.return=e.return,De=n;break}De=e.return}}function n_(t){for(;De!==null;){var e=De;try{switch(e.tag){case 0:case 11:case 15:var n=e.return;try{Yc(4,e)}catch(l){It(e,n,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){It(e,r,l)}}var s=e.return;try{kf(e)}catch(l){It(e,s,l)}break;case 5:var o=e.return;try{kf(e)}catch(l){It(e,o,l)}}}catch(l){It(e,e.return,l)}if(e===t){De=null;break}var a=e.sibling;if(a!==null){a.return=e.return,De=a;break}De=e.return}}var C1=Math.ceil,Dc=Gi.ReactCurrentDispatcher,Tp=Gi.ReactCurrentOwner,Yn=Gi.ReactCurrentBatchConfig,at=0,Ht=null,Ut=null,Zt=0,Cn=0,Bs=Er(0),Bt=0,ba=null,is=0,Zc=0,bp=0,la=null,xn=null,Ap=0,Ks=1/0,Ni=null,Uc=!1,Gf=null,vr=null,rc=!1,dr=null,Fc=0,ca=0,Hf=null,dc=-1,fc=0;function pn(){return at&6?Dt():dc!==-1?dc:dc=Dt()}function xr(t){return t.mode&1?at&2&&Zt!==0?Zt&-Zt:h1.transition!==null?(fc===0&&(fc=P_()),fc):(t=ut,t!==0||(t=window.event,t=t===void 0?16:O_(t.type)),t):1}function oi(t,e,n,i){if(50<ca)throw ca=0,Hf=null,Error(me(185));Aa(t,n,i),(!(at&2)||t!==Ht)&&(t===Ht&&(!(at&2)&&(Zc|=n),Bt===4&&ur(t,Zt)),wn(t,i),n===1&&at===0&&!(e.mode&1)&&(Ks=Dt()+500,Wc&&Tr()))}function wn(t,e){var n=t.callbackNode;fM(t,e);var i=xc(t,t===Ht?Zt:0);if(i===0)n!==null&&u0(n),t.callbackNode=null,t.callbackPriority=0;else if(e=i&-i,t.callbackPriority!==e){if(n!=null&&u0(n),e===1)t.tag===0?u1(i_.bind(null,t)):nv(i_.bind(null,t)),o1(function(){!(at&6)&&Tr()}),n=null;else{switch(I_(i)){case 1:n=Qf;break;case 4:n=C_;break;case 16:n=vc;break;case 536870912:n=R_;break;default:n=vc}n=ex(n,Yv.bind(null,t))}t.callbackPriority=e,t.callbackNode=n}}function Yv(t,e){if(dc=-1,fc=0,at&6)throw Error(me(327));var n=t.callbackNode;if(Ws()&&t.callbackNode!==n)return null;var i=xc(t,t===Ht?Zt:0);if(i===0)return null;if(i&30||i&t.expiredLanes||e)e=Oc(t,i);else{e=i;var r=at;at|=2;var s=$v();(Ht!==t||Zt!==e)&&(Ni=null,Ks=Dt()+500,jr(t,e));do try{I1();break}catch(a){Zv(t,a)}while(!0);dp(),Dc.current=s,at=r,Ut!==null?e=0:(Ht=null,Zt=0,e=Bt)}if(e!==0){if(e===2&&(r=gf(t),r!==0&&(i=r,e=Wf(t,r))),e===1)throw n=ba,jr(t,0),ur(t,i),wn(t,Dt()),n;if(e===6)ur(t,i);else{if(r=t.current.alternate,!(i&30)&&!R1(r)&&(e=Oc(t,i),e===2&&(s=gf(t),s!==0&&(i=s,e=Wf(t,s))),e===1))throw n=ba,jr(t,0),ur(t,i),wn(t,Dt()),n;switch(t.finishedWork=r,t.finishedLanes=i,e){case 0:case 1:throw Error(me(345));case 2:Zr(t,xn,Ni);break;case 3:if(ur(t,i),(i&130023424)===i&&(e=Ap+500-Dt(),10<e)){if(xc(t,0)!==0)break;if(r=t.suspendedLanes,(r&i)!==i){pn(),t.pingedLanes|=t.suspendedLanes&r;break}t.timeoutHandle=Ef(Zr.bind(null,t,xn,Ni),e);break}Zr(t,xn,Ni);break;case 4:if(ur(t,i),(i&4194240)===i)break;for(e=t.eventTimes,r=-1;0<i;){var o=31-si(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=Dt()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*C1(i/1960))-i,10<i){t.timeoutHandle=Ef(Zr.bind(null,t,xn,Ni),i);break}Zr(t,xn,Ni);break;case 5:Zr(t,xn,Ni);break;default:throw Error(me(329))}}}return wn(t,Dt()),t.callbackNode===n?Yv.bind(null,t):null}function Wf(t,e){var n=la;return t.current.memoizedState.isDehydrated&&(jr(t,e).flags|=256),t=Oc(t,e),t!==2&&(e=xn,xn=n,e!==null&&Xf(e)),t}function Xf(t){xn===null?xn=t:xn.push.apply(xn,t)}function R1(t){for(var e=t;;){if(e.flags&16384){var n=e.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var i=0;i<n.length;i++){var r=n[i],s=r.getSnapshot;r=r.value;try{if(!ai(s(),r))return!1}catch{return!1}}}if(n=e.child,e.subtreeFlags&16384&&n!==null)n.return=e,e=n;else{if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function ur(t,e){for(e&=~bp,e&=~Zc,t.suspendedLanes|=e,t.pingedLanes&=~e,t=t.expirationTimes;0<e;){var n=31-si(e),i=1<<n;t[n]=-1,e&=~i}}function i_(t){if(at&6)throw Error(me(327));Ws();var e=xc(t,0);if(!(e&1))return wn(t,Dt()),null;var n=Oc(t,e);if(t.tag!==0&&n===2){var i=gf(t);i!==0&&(e=i,n=Wf(t,i))}if(n===1)throw n=ba,jr(t,0),ur(t,e),wn(t,Dt()),n;if(n===6)throw Error(me(345));return t.finishedWork=t.current.alternate,t.finishedLanes=e,Zr(t,xn,Ni),wn(t,Dt()),null}function Cp(t,e){var n=at;at|=1;try{return t(e)}finally{at=n,at===0&&(Ks=Dt()+500,Wc&&Tr())}}function rs(t){dr!==null&&dr.tag===0&&!(at&6)&&Ws();var e=at;at|=1;var n=Yn.transition,i=ut;try{if(Yn.transition=null,ut=1,t)return t()}finally{ut=i,Yn.transition=n,at=e,!(at&6)&&Tr()}}function Rp(){Cn=Bs.current,yt(Bs)}function jr(t,e){t.finishedWork=null,t.finishedLanes=0;var n=t.timeoutHandle;if(n!==-1&&(t.timeoutHandle=-1,s1(n)),Ut!==null)for(n=Ut.return;n!==null;){var i=n;switch(cp(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&Ec();break;case 3:$s(),yt(Sn),yt(ln),vp();break;case 5:_p(i);break;case 4:$s();break;case 13:yt(Et);break;case 19:yt(Et);break;case 10:fp(i.type._context);break;case 22:case 23:Rp()}n=n.return}if(Ht=t,Ut=t=yr(t.current,null),Zt=Cn=e,Bt=0,ba=null,bp=Zc=is=0,xn=la=null,Jr!==null){for(e=0;e<Jr.length;e++)if(n=Jr[e],i=n.interleaved,i!==null){n.interleaved=null;var r=i.next,s=n.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}n.pending=i}Jr=null}return t}function Zv(t,e){do{var n=Ut;try{if(dp(),cc.current=Nc,Lc){for(var i=Tt.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}Lc=!1}if(ns=0,Gt=Ot=Tt=null,oa=!1,wa=0,Tp.current=null,n===null||n.return===null){Bt=1,ba=e,Ut=null;break}e:{var s=t,o=n.return,a=n,l=e;if(e=Zt,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var c=l,d=a,f=d.tag;if(!(d.mode&1)&&(f===0||f===11||f===15)){var u=d.alternate;u?(d.updateQueue=u.updateQueue,d.memoizedState=u.memoizedState,d.lanes=u.lanes):(d.updateQueue=null,d.memoizedState=null)}var p=W0(o);if(p!==null){p.flags&=-257,X0(p,o,a,s,e),p.mode&1&&H0(s,c,e),e=p,l=c;var g=e.updateQueue;if(g===null){var M=new Set;M.add(l),e.updateQueue=M}else g.add(l);break e}else{if(!(e&1)){H0(s,c,e),Pp();break e}l=Error(me(426))}}else if(wt&&a.mode&1){var _=W0(o);if(_!==null){!(_.flags&65536)&&(_.flags|=256),X0(_,o,a,s,e),up(Js(l,a));break e}}s=l=Js(l,a),Bt!==4&&(Bt=2),la===null?la=[s]:la.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var h=Iv(s,l,e);O0(s,h);break e;case 1:a=l;var m=s.type,v=s.stateNode;if(!(s.flags&128)&&(typeof m.getDerivedStateFromError=="function"||v!==null&&typeof v.componentDidCatch=="function"&&(vr===null||!vr.has(v)))){s.flags|=65536,e&=-e,s.lanes|=e;var y=Lv(s,a,e);O0(s,y);break e}}s=s.return}while(s!==null)}Kv(n)}catch(A){e=A,Ut===n&&n!==null&&(Ut=n=n.return);continue}break}while(!0)}function $v(){var t=Dc.current;return Dc.current=Nc,t===null?Nc:t}function Pp(){(Bt===0||Bt===3||Bt===2)&&(Bt=4),Ht===null||!(is&268435455)&&!(Zc&268435455)||ur(Ht,Zt)}function Oc(t,e){var n=at;at|=2;var i=$v();(Ht!==t||Zt!==e)&&(Ni=null,jr(t,e));do try{P1();break}catch(r){Zv(t,r)}while(!0);if(dp(),at=n,Dc.current=i,Ut!==null)throw Error(me(261));return Ht=null,Zt=0,Bt}function P1(){for(;Ut!==null;)Jv(Ut)}function I1(){for(;Ut!==null&&!rM();)Jv(Ut)}function Jv(t){var e=Qv(t.alternate,t,Cn);t.memoizedProps=t.pendingProps,e===null?Kv(t):Ut=e,Tp.current=null}function Kv(t){var e=t;do{var n=e.alternate;if(t=e.return,e.flags&32768){if(n=E1(n,e),n!==null){n.flags&=32767,Ut=n;return}if(t!==null)t.flags|=32768,t.subtreeFlags=0,t.deletions=null;else{Bt=6,Ut=null;return}}else if(n=w1(n,e,Cn),n!==null){Ut=n;return}if(e=e.sibling,e!==null){Ut=e;return}Ut=e=t}while(e!==null);Bt===0&&(Bt=5)}function Zr(t,e,n){var i=ut,r=Yn.transition;try{Yn.transition=null,ut=1,L1(t,e,n,i)}finally{Yn.transition=r,ut=i}return null}function L1(t,e,n,i){do Ws();while(dr!==null);if(at&6)throw Error(me(327));n=t.finishedWork;var r=t.finishedLanes;if(n===null)return null;if(t.finishedWork=null,t.finishedLanes=0,n===t.current)throw Error(me(177));t.callbackNode=null,t.callbackPriority=0;var s=n.lanes|n.childLanes;if(pM(t,s),t===Ht&&(Ut=Ht=null,Zt=0),!(n.subtreeFlags&2064)&&!(n.flags&2064)||rc||(rc=!0,ex(vc,function(){return Ws(),null})),s=(n.flags&15990)!==0,n.subtreeFlags&15990||s){s=Yn.transition,Yn.transition=null;var o=ut;ut=1;var a=at;at|=4,Tp.current=null,b1(t,n),Xv(n,t),e1(Mf),yc=!!Sf,Mf=Sf=null,t.current=n,A1(n,t,r),sM(),at=a,ut=o,Yn.transition=s}else t.current=n;if(rc&&(rc=!1,dr=t,Fc=r),s=t.pendingLanes,s===0&&(vr=null),lM(n.stateNode,i),wn(t,Dt()),e!==null)for(i=t.onRecoverableError,n=0;n<e.length;n++)r=e[n],i(r.value,{componentStack:r.stack,digest:r.digest});if(Uc)throw Uc=!1,t=Gf,Gf=null,t;return Fc&1&&t.tag!==0&&Ws(),s=t.pendingLanes,s&1?t===Hf?ca++:(ca=0,Hf=t):ca=0,Tr(),null}function Ws(){if(dr!==null){var t=I_(Fc),e=Yn.transition,n=ut;try{if(Yn.transition=null,ut=16>t?16:t,dr===null)var i=!1;else{if(t=dr,dr=null,Fc=0,at&6)throw Error(me(331));var r=at;for(at|=4,De=t.current;De!==null;){var s=De,o=s.child;if(De.flags&16){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var c=a[l];for(De=c;De!==null;){var d=De;switch(d.tag){case 0:case 11:case 15:aa(8,d,s)}var f=d.child;if(f!==null)f.return=d,De=f;else for(;De!==null;){d=De;var u=d.sibling,p=d.return;if(Gv(d),d===c){De=null;break}if(u!==null){u.return=p,De=u;break}De=p}}}var g=s.alternate;if(g!==null){var M=g.child;if(M!==null){g.child=null;do{var _=M.sibling;M.sibling=null,M=_}while(M!==null)}}De=s}}if(s.subtreeFlags&2064&&o!==null)o.return=s,De=o;else e:for(;De!==null;){if(s=De,s.flags&2048)switch(s.tag){case 0:case 11:case 15:aa(9,s,s.return)}var h=s.sibling;if(h!==null){h.return=s.return,De=h;break e}De=s.return}}var m=t.current;for(De=m;De!==null;){o=De;var v=o.child;if(o.subtreeFlags&2064&&v!==null)v.return=o,De=v;else e:for(o=m;De!==null;){if(a=De,a.flags&2048)try{switch(a.tag){case 0:case 11:case 15:Yc(9,a)}}catch(A){It(a,a.return,A)}if(a===o){De=null;break e}var y=a.sibling;if(y!==null){y.return=a.return,De=y;break e}De=a.return}}if(at=r,Tr(),Si&&typeof Si.onPostCommitFiberRoot=="function")try{Si.onPostCommitFiberRoot(kc,t)}catch{}i=!0}return i}finally{ut=n,Yn.transition=e}}return!1}function r_(t,e,n){e=Js(n,e),e=Iv(t,e,1),t=_r(t,e,1),e=pn(),t!==null&&(Aa(t,1,e),wn(t,e))}function It(t,e,n){if(t.tag===3)r_(t,t,n);else for(;e!==null;){if(e.tag===3){r_(e,t,n);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(vr===null||!vr.has(i))){t=Js(n,t),t=Lv(e,t,1),e=_r(e,t,1),t=pn(),e!==null&&(Aa(e,1,t),wn(e,t));break}}e=e.return}}function N1(t,e,n){var i=t.pingCache;i!==null&&i.delete(e),e=pn(),t.pingedLanes|=t.suspendedLanes&n,Ht===t&&(Zt&n)===n&&(Bt===4||Bt===3&&(Zt&130023424)===Zt&&500>Dt()-Ap?jr(t,0):bp|=n),wn(t,e)}function jv(t,e){e===0&&(t.mode&1?(e=Wl,Wl<<=1,!(Wl&130023424)&&(Wl=4194304)):e=1);var n=pn();t=zi(t,e),t!==null&&(Aa(t,e,n),wn(t,n))}function D1(t){var e=t.memoizedState,n=0;e!==null&&(n=e.retryLane),jv(t,n)}function U1(t,e){var n=0;switch(t.tag){case 13:var i=t.stateNode,r=t.memoizedState;r!==null&&(n=r.retryLane);break;case 19:i=t.stateNode;break;default:throw Error(me(314))}i!==null&&i.delete(e),jv(t,n)}var Qv;Qv=function(t,e,n){if(t!==null)if(t.memoizedProps!==e.pendingProps||Sn.current)yn=!0;else{if(!(t.lanes&n)&&!(e.flags&128))return yn=!1,M1(t,e,n);yn=!!(t.flags&131072)}else yn=!1,wt&&e.flags&1048576&&iv(e,Ac,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;hc(t,e),t=e.pendingProps;var r=qs(e,ln.current);Hs(e,n),r=yp(null,e,i,t,r,n);var s=Sp();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,Mn(i)?(s=!0,Tc(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,mp(e),r.updater=qc,e.stateNode=r,r._reactInternals=e,If(e,i,t,n),e=Df(null,e,i,!0,s,n)):(e.tag=0,wt&&s&&lp(e),fn(null,e,r,n),e=e.child),e;case 16:i=e.elementType;e:{switch(hc(t,e),t=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=O1(i),t=ni(i,t),r){case 0:e=Nf(null,e,i,t,n);break e;case 1:e=Z0(null,e,i,t,n);break e;case 11:e=q0(null,e,i,t,n);break e;case 14:e=Y0(null,e,i,ni(i.type,t),n);break e}throw Error(me(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:ni(i,r),Nf(t,e,i,r,n);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:ni(i,r),Z0(t,e,i,r,n);case 3:e:{if(Fv(e),t===null)throw Error(me(387));i=e.pendingProps,s=e.memoizedState,r=s.element,cv(t,e),Pc(e,i,null,n);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=Js(Error(me(423)),e),e=$0(t,e,i,n,r);break e}else if(i!==r){r=Js(Error(me(424)),e),e=$0(t,e,i,n,r);break e}else for(Rn=gr(e.stateNode.containerInfo.firstChild),Pn=e,wt=!0,ri=null,n=av(e,null,i,n),e.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if(Ys(),i===r){e=Vi(t,e,n);break e}fn(t,e,i,n)}e=e.child}return e;case 5:return uv(e),t===null&&Cf(e),i=e.type,r=e.pendingProps,s=t!==null?t.memoizedProps:null,o=r.children,wf(i,r)?o=null:s!==null&&wf(i,s)&&(e.flags|=32),Uv(t,e),fn(t,e,o,n),e.child;case 6:return t===null&&Cf(e),null;case 13:return Ov(t,e,n);case 4:return gp(e,e.stateNode.containerInfo),i=e.pendingProps,t===null?e.child=Zs(e,null,i,n):fn(t,e,i,n),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:ni(i,r),q0(t,e,i,r,n);case 7:return fn(t,e,e.pendingProps,n),e.child;case 8:return fn(t,e,e.pendingProps.children,n),e.child;case 12:return fn(t,e,e.pendingProps.children,n),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,_t(Cc,i._currentValue),i._currentValue=o,s!==null)if(ai(s.value,o)){if(s.children===r.children&&!Sn.current){e=Vi(t,e,n);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=Oi(-1,n&-n),l.tag=2;var c=s.updateQueue;if(c!==null){c=c.shared;var d=c.pending;d===null?l.next=l:(l.next=d.next,d.next=l),c.pending=l}}s.lanes|=n,l=s.alternate,l!==null&&(l.lanes|=n),Rf(s.return,n,e),a.lanes|=n;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(me(341));o.lanes|=n,a=o.alternate,a!==null&&(a.lanes|=n),Rf(o,n,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}fn(t,e,r.children,n),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,Hs(e,n),r=Zn(r),i=i(r),e.flags|=1,fn(t,e,i,n),e.child;case 14:return i=e.type,r=ni(i,e.pendingProps),r=ni(i.type,r),Y0(t,e,i,r,n);case 15:return Nv(t,e,e.type,e.pendingProps,n);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:ni(i,r),hc(t,e),e.tag=1,Mn(i)?(t=!0,Tc(e)):t=!1,Hs(e,n),Pv(e,i,r),If(e,i,r,n),Df(null,e,i,!0,t,n);case 19:return Bv(t,e,n);case 22:return Dv(t,e,n)}throw Error(me(156,e.tag))};function ex(t,e){return A_(t,e)}function F1(t,e,n,i){this.tag=t,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function qn(t,e,n,i){return new F1(t,e,n,i)}function Ip(t){return t=t.prototype,!(!t||!t.isReactComponent)}function O1(t){if(typeof t=="function")return Ip(t)?1:0;if(t!=null){if(t=t.$$typeof,t===Jf)return 11;if(t===Kf)return 14}return 2}function yr(t,e){var n=t.alternate;return n===null?(n=qn(t.tag,e,t.key,t.mode),n.elementType=t.elementType,n.type=t.type,n.stateNode=t.stateNode,n.alternate=t,t.alternate=n):(n.pendingProps=e,n.type=t.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=t.flags&14680064,n.childLanes=t.childLanes,n.lanes=t.lanes,n.child=t.child,n.memoizedProps=t.memoizedProps,n.memoizedState=t.memoizedState,n.updateQueue=t.updateQueue,e=t.dependencies,n.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},n.sibling=t.sibling,n.index=t.index,n.ref=t.ref,n}function pc(t,e,n,i,r,s){var o=2;if(i=t,typeof t=="function")Ip(t)&&(o=1);else if(typeof t=="string")o=5;else e:switch(t){case Cs:return Qr(n.children,r,s,e);case $f:o=8,r|=8;break;case ef:return t=qn(12,n,e,r|2),t.elementType=ef,t.lanes=s,t;case tf:return t=qn(13,n,e,r),t.elementType=tf,t.lanes=s,t;case nf:return t=qn(19,n,e,r),t.elementType=nf,t.lanes=s,t;case u_:return $c(n,r,s,e);default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case l_:o=10;break e;case c_:o=9;break e;case Jf:o=11;break e;case Kf:o=14;break e;case ar:o=16,i=null;break e}throw Error(me(130,t==null?t:typeof t,""))}return e=qn(o,n,e,r),e.elementType=t,e.type=i,e.lanes=s,e}function Qr(t,e,n,i){return t=qn(7,t,i,e),t.lanes=n,t}function $c(t,e,n,i){return t=qn(22,t,i,e),t.elementType=u_,t.lanes=n,t.stateNode={isHidden:!1},t}function Kd(t,e,n){return t=qn(6,t,null,e),t.lanes=n,t}function jd(t,e,n){return e=qn(4,t.children!==null?t.children:[],t.key,e),e.lanes=n,e.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},e}function B1(t,e,n,i,r){this.tag=e,this.containerInfo=t,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=Ud(0),this.expirationTimes=Ud(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=Ud(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function Lp(t,e,n,i,r,s,o,a,l){return t=new B1(t,e,n,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=qn(3,null,null,e),t.current=s,s.stateNode=t,s.memoizedState={element:i,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},mp(s),t}function k1(t,e,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:As,key:i==null?null:""+i,children:t,containerInfo:e,implementation:n}}function tx(t){if(!t)return Mr;t=t._reactInternals;e:{if(os(t)!==t||t.tag!==1)throw Error(me(170));var e=t;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(Mn(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(me(171))}if(t.tag===1){var n=t.type;if(Mn(n))return tv(t,n,e)}return e}function nx(t,e,n,i,r,s,o,a,l){return t=Lp(n,i,!0,t,r,s,o,a,l),t.context=tx(null),n=t.current,i=pn(),r=xr(n),s=Oi(i,r),s.callback=e??null,_r(n,s,r),t.current.lanes=r,Aa(t,r,i),wn(t,i),t}function Jc(t,e,n,i){var r=e.current,s=pn(),o=xr(r);return n=tx(n),e.context===null?e.context=n:e.pendingContext=n,e=Oi(s,o),e.payload={element:t},i=i===void 0?null:i,i!==null&&(e.callback=i),t=_r(r,e,o),t!==null&&(oi(t,r,o,s),lc(t,r,o)),o}function Bc(t){if(t=t.current,!t.child)return null;switch(t.child.tag){case 5:return t.child.stateNode;default:return t.child.stateNode}}function s_(t,e){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var n=t.retryLane;t.retryLane=n!==0&&n<e?n:e}}function Np(t,e){s_(t,e),(t=t.alternate)&&s_(t,e)}function z1(){return null}var ix=typeof reportError=="function"?reportError:function(t){console.error(t)};function Dp(t){this._internalRoot=t}Kc.prototype.render=Dp.prototype.render=function(t){var e=this._internalRoot;if(e===null)throw Error(me(409));Jc(t,e,null,null)};Kc.prototype.unmount=Dp.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var e=t.containerInfo;rs(function(){Jc(null,t,null,null)}),e[ki]=null}};function Kc(t){this._internalRoot=t}Kc.prototype.unstable_scheduleHydration=function(t){if(t){var e=D_();t={blockedOn:null,target:t,priority:e};for(var n=0;n<cr.length&&e!==0&&e<cr[n].priority;n++);cr.splice(n,0,t),n===0&&F_(t)}};function Up(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function jc(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11&&(t.nodeType!==8||t.nodeValue!==" react-mount-point-unstable "))}function o_(){}function V1(t,e,n,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var c=Bc(o);s.call(c)}}var o=nx(e,i,t,0,null,!1,!1,"",o_);return t._reactRootContainer=o,t[ki]=o.current,va(t.nodeType===8?t.parentNode:t),rs(),o}for(;r=t.lastChild;)t.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var c=Bc(l);a.call(c)}}var l=Lp(t,0,!1,null,null,!1,!1,"",o_);return t._reactRootContainer=l,t[ki]=l.current,va(t.nodeType===8?t.parentNode:t),rs(function(){Jc(e,l,n,i)}),l}function Qc(t,e,n,i,r){var s=n._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=Bc(o);a.call(l)}}Jc(e,o,t,r)}else o=V1(n,e,t,r,i);return Bc(o)}L_=function(t){switch(t.tag){case 3:var e=t.stateNode;if(e.current.memoizedState.isDehydrated){var n=Qo(e.pendingLanes);n!==0&&(ep(e,n|1),wn(e,Dt()),!(at&6)&&(Ks=Dt()+500,Tr()))}break;case 13:rs(function(){var i=zi(t,1);if(i!==null){var r=pn();oi(i,t,1,r)}}),Np(t,1)}};tp=function(t){if(t.tag===13){var e=zi(t,134217728);if(e!==null){var n=pn();oi(e,t,134217728,n)}Np(t,134217728)}};N_=function(t){if(t.tag===13){var e=xr(t),n=zi(t,e);if(n!==null){var i=pn();oi(n,t,e,i)}Np(t,e)}};D_=function(){return ut};U_=function(t,e){var n=ut;try{return ut=t,e()}finally{ut=n}};ff=function(t,e,n){switch(e){case"input":if(of(t,n),e=n.name,n.type==="radio"&&e!=null){for(n=t;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<n.length;e++){var i=n[e];if(i!==t&&i.form===t.form){var r=Hc(i);if(!r)throw Error(me(90));d_(i),of(i,r)}}}break;case"textarea":p_(t,n);break;case"select":e=n.value,e!=null&&ks(t,!!n.multiple,e,!1)}};S_=Cp;M_=rs;var G1={usingClientEntryPoint:!1,Events:[Ra,Ls,Hc,x_,y_,Cp]},$o={findFiberByHostInstance:$r,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},H1={bundleType:$o.bundleType,version:$o.version,rendererPackageName:$o.rendererPackageName,rendererConfig:$o.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:Gi.ReactCurrentDispatcher,findHostInstanceByFiber:function(t){return t=T_(t),t===null?null:t.stateNode},findFiberByHostInstance:$o.findFiberByHostInstance||z1,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(Jo=__REACT_DEVTOOLS_GLOBAL_HOOK__,!Jo.isDisabled&&Jo.supportsFiber))try{kc=Jo.inject(H1),Si=Jo}catch{}var Jo;Nn.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=G1;Nn.createPortal=function(t,e){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!Up(e))throw Error(me(200));return k1(t,e,null,n)};Nn.createRoot=function(t,e){if(!Up(t))throw Error(me(299));var n=!1,i="",r=ix;return e!=null&&(e.unstable_strictMode===!0&&(n=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=Lp(t,1,!1,null,null,n,!1,i,r),t[ki]=e.current,va(t.nodeType===8?t.parentNode:t),new Dp(e)};Nn.findDOMNode=function(t){if(t==null)return null;if(t.nodeType===1)return t;var e=t._reactInternals;if(e===void 0)throw typeof t.render=="function"?Error(me(188)):(t=Object.keys(t).join(","),Error(me(268,t)));return t=T_(e),t=t===null?null:t.stateNode,t};Nn.flushSync=function(t){return rs(t)};Nn.hydrate=function(t,e,n){if(!jc(e))throw Error(me(200));return Qc(null,t,e,!0,n)};Nn.hydrateRoot=function(t,e,n){if(!Up(t))throw Error(me(405));var i=n!=null&&n.hydratedSources||null,r=!1,s="",o=ix;if(n!=null&&(n.unstable_strictMode===!0&&(r=!0),n.identifierPrefix!==void 0&&(s=n.identifierPrefix),n.onRecoverableError!==void 0&&(o=n.onRecoverableError)),e=nx(e,null,t,1,n??null,r,!1,s,o),t[ki]=e.current,va(t),i)for(t=0;t<i.length;t++)n=i[t],r=n._getVersion,r=r(n._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[n,r]:e.mutableSourceEagerHydrationData.push(n,r);return new Kc(e)};Nn.render=function(t,e,n){if(!jc(e))throw Error(me(200));return Qc(null,t,e,!1,n)};Nn.unmountComponentAtNode=function(t){if(!jc(t))throw Error(me(40));return t._reactRootContainer?(rs(function(){Qc(null,null,t,!1,function(){t._reactRootContainer=null,t[ki]=null})}),!0):!1};Nn.unstable_batchedUpdates=Cp;Nn.unstable_renderSubtreeIntoContainer=function(t,e,n,i){if(!jc(n))throw Error(me(200));if(t==null||t._reactInternals===void 0)throw Error(me(38));return Qc(t,e,n,!1,i)};Nn.version="18.3.1-next-f1338f8080-20240426"});var ax=Li((vR,ox)=>{"use strict";function sx(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(sx)}catch(t){console.error(t)}}sx(),ox.exports=rx()});var cx=Li(Fp=>{"use strict";var lx=ax();Fp.createRoot=lx.createRoot,Fp.hydrateRoot=lx.hydrateRoot;var xR});var lS=Li(fd=>{"use strict";var jC=Dl(),QC=Symbol.for("react.element"),eR=Symbol.for("react.fragment"),tR=Object.prototype.hasOwnProperty,nR=jC.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,iR={key:!0,ref:!0,__self:!0,__source:!0};function aS(t,e,n){var i,r={},s=null,o=null;n!==void 0&&(s=""+n),e.key!==void 0&&(s=""+e.key),e.ref!==void 0&&(o=e.ref);for(i in e)tR.call(e,i)&&!iR.hasOwnProperty(i)&&(r[i]=e[i]);if(t&&t.defaultProps)for(i in e=t.defaultProps,e)r[i]===void 0&&(r[i]=e[i]);return{$$typeof:QC,type:t,key:s,ref:o,props:r,_owner:nR.current}}fd.Fragment=eR;fd.jsx=aS;fd.jsxs=aS});var yg=Li((LP,cS)=>{"use strict";cS.exports=lS()});var Vt=Pl(Dl()),dS=Pl(cx());var _h="184";var Hx=0,Tm=1,Wx=2;var ml=1,Xx=2,No=3,Ji=0,vn=1,jn=2,Ci=0,fs=1,bm=2,Am=3,Cm=4,qx=5;var Lr=100,Yx=101,Zx=102,$x=103,Jx=104,Kx=200,jx=201,Qx=202,ey=203,Cu=204,Ru=205,ty=206,ny=207,iy=208,ry=209,sy=210,oy=211,ay=212,ly=213,cy=214,Pu=0,Iu=1,Lu=2,ps=3,Nu=4,Du=5,Uu=6,Fu=7,Rm=0,uy=1,hy=2,di=0,Pm=1,Im=2,Lm=3,Nm=4,Dm=5,Um=6,Fm=7;var Om=300,zr=301,_s=302,vh=303,xh=304,gl=306,go=1e3,Ei=1001,Ou=1002,Xt=1003,dy=1004;var _l=1005;var jt=1006,yh=1007;var Vr=1008;var Tn=1009,Bm=1010,km=1011,Do=1012,Sh=1013,fi=1014,pi=1015,Ri=1016,Mh=1017,wh=1018,Uo=1020,zm=35902,Vm=35899,Gm=1021,Hm=1022,Qn=1023,Ti=1026,Gr=1027,Wm=1028,Eh=1029,Hr=1030,Th=1031;var bh=1033,vl=33776,xl=33777,yl=33778,Sl=33779,Ah=35840,Ch=35841,Rh=35842,Ph=35843,Ih=36196,Lh=37492,Nh=37496,Dh=37488,Uh=37489,Ml=37490,Fh=37491,Oh=37808,Bh=37809,kh=37810,zh=37811,Vh=37812,Gh=37813,Hh=37814,Wh=37815,Xh=37816,qh=37817,Yh=37818,Zh=37819,$h=37820,Jh=37821,Kh=36492,jh=36494,Qh=36495,ed=36283,td=36284,wl=36285,nd=36286;var za=2300,Bu=2301,Au=2302,um=2303,hm=2400,dm=2401,fm=2402;var fy=3200;var id=0,py=1,tr="",Jt="srgb",Va="srgb-linear",Ga="linear",ct="srgb";var hs=7680;var pm=519,my=512,gy=513,_y=514,rd=515,vy=516,xy=517,sd=518,yy=519,mm=35044;var Xm="300 es",hi=2e3,_o=2001;function W1(t){for(let e=t.length-1;e>=0;--e)if(t[e]>=65535)return!0;return!1}function X1(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function Ha(t){return document.createElementNS("http://www.w3.org/1999/xhtml",t)}function Sy(){let t=Ha("canvas");return t.style.display="block",t}var ux={},vo=null;function qm(...t){let e="THREE."+t.shift();vo?vo("log",e,...t):console.log(e,...t)}function My(t){let e=t[0];if(typeof e=="string"&&e.startsWith("TSL:")){let n=t[1];n&&n.isStackTrace?t[0]+=" "+n.getLocation():t[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return t}function Ge(...t){t=My(t);let e="THREE."+t.shift();if(vo)vo("warn",e,...t);else{let n=t[0];n&&n.isStackTrace?console.warn(n.getError(e)):console.warn(e,...t)}}function He(...t){t=My(t);let e="THREE."+t.shift();if(vo)vo("error",e,...t);else{let n=t[0];n&&n.isStackTrace?console.error(n.getError(e)):console.error(e,...t)}}function ku(...t){let e=t.join(" ");e in ux||(ux[e]=!0,Ge(...t))}function wy(t,e,n){return new Promise(function(i,r){function s(){switch(t.clientWaitSync(e,t.SYNC_FLUSH_COMMANDS_BIT,0)){case t.WAIT_FAILED:r();break;case t.TIMEOUT_EXPIRED:setTimeout(s,n);break;default:i()}}setTimeout(s,n)})}var Ey={[Pu]:Iu,[Lu]:Uu,[Nu]:Fu,[ps]:Du,[Iu]:Pu,[Uu]:Lu,[Fu]:Nu,[Du]:ps},bi=class{addEventListener(e,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(n)===-1&&i[e].push(n)}hasEventListener(e,n){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(n)!==-1}removeEventListener(e,n){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(n);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let n=this._listeners;if(n===void 0)return;let i=n[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},cn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],hx=1234567,po=Math.PI/180,xo=180/Math.PI;function vs(){let t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(cn[t&255]+cn[t>>8&255]+cn[t>>16&255]+cn[t>>24&255]+"-"+cn[e&255]+cn[e>>8&255]+"-"+cn[e>>16&15|64]+cn[e>>24&255]+"-"+cn[n&63|128]+cn[n>>8&255]+"-"+cn[n>>16&255]+cn[n>>24&255]+cn[i&255]+cn[i>>8&255]+cn[i>>16&255]+cn[i>>24&255]).toLowerCase()}function et(t,e,n){return Math.max(e,Math.min(n,t))}function Ym(t,e){return(t%e+e)%e}function q1(t,e,n,i,r){return i+(t-e)*(r-i)/(n-e)}function Y1(t,e,n){return t!==e?(n-t)/(e-t):0}function Oa(t,e,n){return(1-n)*t+n*e}function Z1(t,e,n,i){return Oa(t,e,1-Math.exp(-n*i))}function $1(t,e=1){return e-Math.abs(Ym(t,e*2)-e)}function J1(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*(3-2*t))}function K1(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*t*(t*(t*6-15)+10))}function j1(t,e){return t+Math.floor(Math.random()*(e-t+1))}function Q1(t,e){return t+Math.random()*(e-t)}function ew(t){return t*(.5-Math.random())}function tw(t){t!==void 0&&(hx=t);let e=hx+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function nw(t){return t*po}function iw(t){return t*xo}function rw(t){return(t&t-1)===0&&t!==0}function sw(t){return Math.pow(2,Math.ceil(Math.log(t)/Math.LN2))}function ow(t){return Math.pow(2,Math.floor(Math.log(t)/Math.LN2))}function aw(t,e,n,i,r){let s=Math.cos,o=Math.sin,a=s(n/2),l=o(n/2),c=s((e+i)/2),d=o((e+i)/2),f=s((e-i)/2),u=o((e-i)/2),p=s((i-e)/2),g=o((i-e)/2);switch(r){case"XYX":t.set(a*d,l*f,l*u,a*c);break;case"YZY":t.set(l*u,a*d,l*f,a*c);break;case"ZXZ":t.set(l*f,l*u,a*d,a*c);break;case"XZX":t.set(a*d,l*g,l*p,a*c);break;case"YXY":t.set(l*p,a*d,l*g,a*c);break;case"ZYZ":t.set(l*g,l*p,a*d,a*c);break;default:Ge("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+r)}}function fo(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return t/4294967295;case Uint16Array:return t/65535;case Uint8Array:return t/255;case Int32Array:return Math.max(t/2147483647,-1);case Int16Array:return Math.max(t/32767,-1);case Int8Array:return Math.max(t/127,-1);default:throw new Error("Invalid component type.")}}function gn(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return Math.round(t*4294967295);case Uint16Array:return Math.round(t*65535);case Uint8Array:return Math.round(t*255);case Int32Array:return Math.round(t*2147483647);case Int16Array:return Math.round(t*32767);case Int8Array:return Math.round(t*127);default:throw new Error("Invalid component type.")}}var Zm={DEG2RAD:po,RAD2DEG:xo,generateUUID:vs,clamp:et,euclideanModulo:Ym,mapLinear:q1,inverseLerp:Y1,lerp:Oa,damp:Z1,pingpong:$1,smoothstep:J1,smootherstep:K1,randInt:j1,randFloat:Q1,randFloatSpread:ew,seededRandom:tw,degToRad:nw,radToDeg:iw,isPowerOfTwo:rw,ceilPowerOfTwo:sw,floorPowerOfTwo:ow,setQuaternionFromProperEuler:aw,normalize:gn,denormalize:fo},eg=class eg{constructor(e=0,n=0){this.x=e,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,n){return this.x=e,this.y=n,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let n=this.x,i=this.y,r=e.elements;return this.x=r[0]*n+r[3]*i+r[6],this.y=r[1]*n+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,n){return this.x=et(this.x,e.x,n.x),this.y=et(this.y,e.y,n.y),this}clampScalar(e,n){return this.x=et(this.x,e,n),this.y=et(this.y,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(et(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(et(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y;return n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this}rotateAround(e,n){let i=Math.cos(n),r=Math.sin(n),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};eg.prototype.isVector2=!0;var Te=eg,Ai=class{constructor(e=0,n=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=n,this._z=i,this._w=r}static slerpFlat(e,n,i,r,s,o,a){let l=i[r+0],c=i[r+1],d=i[r+2],f=i[r+3],u=s[o+0],p=s[o+1],g=s[o+2],M=s[o+3];if(f!==M||l!==u||c!==p||d!==g){let _=l*u+c*p+d*g+f*M;_<0&&(u=-u,p=-p,g=-g,M=-M,_=-_);let h=1-a;if(_<.9995){let m=Math.acos(_),v=Math.sin(m);h=Math.sin(h*m)/v,a=Math.sin(a*m)/v,l=l*h+u*a,c=c*h+p*a,d=d*h+g*a,f=f*h+M*a}else{l=l*h+u*a,c=c*h+p*a,d=d*h+g*a,f=f*h+M*a;let m=1/Math.sqrt(l*l+c*c+d*d+f*f);l*=m,c*=m,d*=m,f*=m}}e[n]=l,e[n+1]=c,e[n+2]=d,e[n+3]=f}static multiplyQuaternionsFlat(e,n,i,r,s,o){let a=i[r],l=i[r+1],c=i[r+2],d=i[r+3],f=s[o],u=s[o+1],p=s[o+2],g=s[o+3];return e[n]=a*g+d*f+l*p-c*u,e[n+1]=l*g+d*u+c*f-a*p,e[n+2]=c*g+d*p+a*u-l*f,e[n+3]=d*g-a*f-l*u-c*p,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,n,i,r){return this._x=e,this._y=n,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,n=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(i/2),d=a(r/2),f=a(s/2),u=l(i/2),p=l(r/2),g=l(s/2);switch(o){case"XYZ":this._x=u*d*f+c*p*g,this._y=c*p*f-u*d*g,this._z=c*d*g+u*p*f,this._w=c*d*f-u*p*g;break;case"YXZ":this._x=u*d*f+c*p*g,this._y=c*p*f-u*d*g,this._z=c*d*g-u*p*f,this._w=c*d*f+u*p*g;break;case"ZXY":this._x=u*d*f-c*p*g,this._y=c*p*f+u*d*g,this._z=c*d*g+u*p*f,this._w=c*d*f-u*p*g;break;case"ZYX":this._x=u*d*f-c*p*g,this._y=c*p*f+u*d*g,this._z=c*d*g-u*p*f,this._w=c*d*f+u*p*g;break;case"YZX":this._x=u*d*f+c*p*g,this._y=c*p*f+u*d*g,this._z=c*d*g-u*p*f,this._w=c*d*f-u*p*g;break;case"XZY":this._x=u*d*f-c*p*g,this._y=c*p*f-u*d*g,this._z=c*d*g+u*p*f,this._w=c*d*f+u*p*g;break;default:Ge("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,n){let i=n/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let n=e.elements,i=n[0],r=n[4],s=n[8],o=n[1],a=n[5],l=n[9],c=n[2],d=n[6],f=n[10],u=i+a+f;if(u>0){let p=.5/Math.sqrt(u+1);this._w=.25/p,this._x=(d-l)*p,this._y=(s-c)*p,this._z=(o-r)*p}else if(i>a&&i>f){let p=2*Math.sqrt(1+i-a-f);this._w=(d-l)/p,this._x=.25*p,this._y=(r+o)/p,this._z=(s+c)/p}else if(a>f){let p=2*Math.sqrt(1+a-i-f);this._w=(s-c)/p,this._x=(r+o)/p,this._y=.25*p,this._z=(l+d)/p}else{let p=2*Math.sqrt(1+f-i-a);this._w=(o-r)/p,this._x=(s+c)/p,this._y=(l+d)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(e,n){let i=e.dot(n)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*n.z-e.z*n.y,this._y=e.z*n.x-e.x*n.z,this._z=e.x*n.y-e.y*n.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(et(this.dot(e),-1,1)))}rotateTowards(e,n){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,n/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=n._x,l=n._y,c=n._z,d=n._w;return this._x=i*d+o*a+r*c-s*l,this._y=r*d+o*l+s*a-i*c,this._z=s*d+o*c+i*l-r*a,this._w=o*d-i*a-r*l-s*c,this._onChangeCallback(),this}slerp(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=this.dot(e);a<0&&(i=-i,r=-r,s=-s,o=-o,a=-a);let l=1-n;if(a<.9995){let c=Math.acos(a),d=Math.sin(c);l=Math.sin(l*c)/d,n=Math.sin(n*c)/d,this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this._onChangeCallback()}else this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this.normalize();return this}slerpQuaternions(e,n,i){return this.copy(e).slerp(n,i)}random(){let e=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(n),s*Math.cos(n))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,n=0){return this._x=e[n],this._y=e[n+1],this._z=e[n+2],this._w=e[n+3],this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._w,e}fromBufferAttribute(e,n){return this._x=e.getX(n),this._y=e.getY(n),this._z=e.getZ(n),this._w=e.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},tg=class tg{constructor(e=0,n=0,i=0){this.x=e,this.y=n,this.z=i}set(e,n,i){return i===void 0&&(i=this.z),this.x=e,this.y=n,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,n){return this.x=e.x*n.x,this.y=e.y*n.y,this.z=e.z*n.z,this}applyEuler(e){return this.applyQuaternion(dx.setFromEuler(e))}applyAxisAngle(e,n){return this.applyQuaternion(dx.setFromAxisAngle(e,n))}applyMatrix3(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[3]*i+s[6]*r,this.y=s[1]*n+s[4]*i+s[7]*r,this.z=s[2]*n+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*n+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*n+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*n+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*n+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let n=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*r-a*i),d=2*(a*n-s*r),f=2*(s*i-o*n);return this.x=n+l*c+o*f-a*d,this.y=i+l*d+a*c-s*f,this.z=r+l*f+s*d-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[4]*i+s[8]*r,this.y=s[1]*n+s[5]*i+s[9]*r,this.z=s[2]*n+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,n){return this.x=et(this.x,e.x,n.x),this.y=et(this.y,e.y,n.y),this.z=et(this.z,e.z,n.z),this}clampScalar(e,n){return this.x=et(this.x,e,n),this.y=et(this.y,e,n),this.z=et(this.z,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(et(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,n){let i=e.x,r=e.y,s=e.z,o=n.x,a=n.y,l=n.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let n=e.lengthSq();if(n===0)return this.set(0,0,0);let i=e.dot(this)/n;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return Op.copy(this).projectOnVector(e),this.sub(Op)}reflect(e){return this.sub(Op.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(et(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return n*n+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,n,i){let r=Math.sin(n)*e;return this.x=r*Math.sin(i),this.y=Math.cos(n)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,n,i){return this.x=e*Math.sin(n),this.y=i,this.z=e*Math.cos(n),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(e){let n=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=n,this.y=i,this.z=r,this}setFromMatrixColumn(e,n){return this.fromArray(e.elements,n*4)}setFromMatrix3Column(e,n){return this.fromArray(e.elements,n*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(e),this.y=n,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};tg.prototype.isVector3=!0;var U=tg,Op=new U,dx=new Ai,ng=class ng{constructor(e,n,i,r,s,o,a,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c)}set(e,n,i,r,s,o,a,l,c){let d=this.elements;return d[0]=e,d[1]=r,d[2]=a,d[3]=n,d[4]=s,d[5]=l,d[6]=i,d[7]=o,d[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(e,n,i){return e.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let n=e.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[3],l=i[6],c=i[1],d=i[4],f=i[7],u=i[2],p=i[5],g=i[8],M=r[0],_=r[3],h=r[6],m=r[1],v=r[4],y=r[7],A=r[2],E=r[5],C=r[8];return s[0]=o*M+a*m+l*A,s[3]=o*_+a*v+l*E,s[6]=o*h+a*y+l*C,s[1]=c*M+d*m+f*A,s[4]=c*_+d*v+f*E,s[7]=c*h+d*y+f*C,s[2]=u*M+p*m+g*A,s[5]=u*_+p*v+g*E,s[8]=u*h+p*y+g*C,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[3]*=e,n[6]*=e,n[1]*=e,n[4]*=e,n[7]*=e,n[2]*=e,n[5]*=e,n[8]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8];return n*o*d-n*a*c-i*s*d+i*a*l+r*s*c-r*o*l}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=d*o-a*c,u=a*l-d*s,p=c*s-o*l,g=n*f+i*u+r*p;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);let M=1/g;return e[0]=f*M,e[1]=(r*c-d*i)*M,e[2]=(a*i-r*o)*M,e[3]=u*M,e[4]=(d*n-r*l)*M,e[5]=(r*s-a*n)*M,e[6]=p*M,e[7]=(i*l-c*n)*M,e[8]=(o*n-i*s)*M,this}transpose(){let e,n=this.elements;return e=n[1],n[1]=n[3],n[3]=e,e=n[2],n[2]=n[6],n[6]=e,e=n[5],n[5]=n[7],n[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let n=this.elements;return e[0]=n[0],e[1]=n[3],e[2]=n[6],e[3]=n[1],e[4]=n[4],e[5]=n[7],e[6]=n[2],e[7]=n[5],e[8]=n[8],this}setUvTransform(e,n,i,r,s,o,a){let l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*o+c*a)+o+e,-r*c,r*l,-r*(-c*o+l*a)+a+n,0,0,1),this}scale(e,n){return this.premultiply(Bp.makeScale(e,n)),this}rotate(e){return this.premultiply(Bp.makeRotation(-e)),this}translate(e,n){return this.premultiply(Bp.makeTranslation(e,n)),this}makeTranslation(e,n){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,n,0,0,1),this}makeRotation(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(e,n){return this.set(e,0,0,0,n,0,0,0,1),this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<9;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<9;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}};ng.prototype.isMatrix3=!0;var Je=ng,Bp=new Je,fx=new Je().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),px=new Je().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function lw(){let t={enabled:!0,workingColorSpace:Va,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===ct&&(r.r=$i(r.r),r.g=$i(r.g),r.b=$i(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===ct&&(r.r=mo(r.r),r.g=mo(r.g),r.b=mo(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===tr?Ga:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return ku("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),t.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return ku("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),t.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return t.define({[Va]:{primaries:e,whitePoint:i,transfer:Ga,toXYZ:fx,fromXYZ:px,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:Jt},outputColorSpaceConfig:{drawingBufferColorSpace:Jt}},[Jt]:{primaries:e,whitePoint:i,transfer:ct,toXYZ:fx,fromXYZ:px,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:Jt}}}),t}var it=lw();function $i(t){return t<.04045?t*.0773993808:Math.pow(t*.9478672986+.0521327014,2.4)}function mo(t){return t<.0031308?t*12.92:1.055*Math.pow(t,.41666)-.055}var eo,zu=class{static getDataURL(e,n="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{eo===void 0&&(eo=Ha("canvas")),eo.width=e.width,eo.height=e.height;let r=eo.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=eo}return i.toDataURL(n)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let n=Ha("canvas");n.width=e.width,n.height=e.height;let i=n.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=$i(s[o]/255)*255;return i.putImageData(r,0,0),n}else if(e.data){let n=e.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor($i(n[i]/255)*255):n[i]=$i(n[i]);return{data:n,width:e.width,height:e.height}}else return Ge("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},cw=0,yo=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:cw++}),this.uuid=vs(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?e.set(n.videoWidth,n.videoHeight,0):typeof VideoFrame<"u"&&n instanceof VideoFrame?e.set(n.displayWidth,n.displayHeight,0):n!==null?e.set(n.width,n.height,n.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(kp(r[o].image)):s.push(kp(r[o]))}else s=kp(r);i.url=s}return n||(e.images[this.uuid]=i),i}};function kp(t){return typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap?zu.getDataURL(t):t.data?{data:Array.from(t.data),width:t.width,height:t.height,type:t.data.constructor.name}:(Ge("Texture: Unable to serialize Texture."),{})}var uw=0,zp=new U,_n=class t extends bi{constructor(e=t.DEFAULT_IMAGE,n=t.DEFAULT_MAPPING,i=Ei,r=Ei,s=jt,o=Vr,a=Qn,l=Tn,c=t.DEFAULT_ANISOTROPY,d=tr){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:uw++}),this.uuid=vs(),this.name="",this.source=new yo(e),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Te(0,0),this.repeat=new Te(1,1),this.center=new Te(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Je,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=d,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(zp).x}get height(){return this.source.getSize(zp).y}get depth(){return this.source.getSize(zp).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let n in e){let i=e[n];if(i===void 0){Ge(`Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Ge(`Texture.setValues(): property '${n}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Om)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case go:e.x=e.x-Math.floor(e.x);break;case Ei:e.x=e.x<0?0:1;break;case Ou:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case go:e.y=e.y-Math.floor(e.y);break;case Ei:e.y=e.y<0?0:1;break;case Ou:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};_n.DEFAULT_IMAGE=null;_n.DEFAULT_MAPPING=Om;_n.DEFAULT_ANISOTROPY=1;var ig=class ig{constructor(e=0,n=0,i=0,r=1){this.x=e,this.y=n,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,n,i,r){return this.x=e,this.y=n,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this.w=e.w+n.w,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this.w+=e.w*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this.w=e.w-n.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*n+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*n+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*n+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*n+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let n=Math.sqrt(1-e.w*e.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/n,this.y=e.y/n,this.z=e.z/n),this}setAxisAngleFromRotationMatrix(e){let n,i,r,s,l=e.elements,c=l[0],d=l[4],f=l[8],u=l[1],p=l[5],g=l[9],M=l[2],_=l[6],h=l[10];if(Math.abs(d-u)<.01&&Math.abs(f-M)<.01&&Math.abs(g-_)<.01){if(Math.abs(d+u)<.1&&Math.abs(f+M)<.1&&Math.abs(g+_)<.1&&Math.abs(c+p+h-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let v=(c+1)/2,y=(p+1)/2,A=(h+1)/2,E=(d+u)/4,C=(f+M)/4,x=(g+_)/4;return v>y&&v>A?v<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(v),r=E/i,s=C/i):y>A?y<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(y),i=E/r,s=x/r):A<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(A),i=C/s,r=x/s),this.set(i,r,s,n),this}let m=Math.sqrt((_-g)*(_-g)+(f-M)*(f-M)+(u-d)*(u-d));return Math.abs(m)<.001&&(m=1),this.x=(_-g)/m,this.y=(f-M)/m,this.z=(u-d)/m,this.w=Math.acos((c+p+h-1)/2),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,n){return this.x=et(this.x,e.x,n.x),this.y=et(this.y,e.y,n.y),this.z=et(this.z,e.z,n.z),this.w=et(this.w,e.w,n.w),this}clampScalar(e,n){return this.x=et(this.x,e,n),this.y=et(this.y,e,n),this.z=et(this.z,e,n),this.w=et(this.w,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(et(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this.w+=(e.w-this.w)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this.w=e.w+(n.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this.w=e[n+3],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e[n+3]=this.w,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this.w=e.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};ig.prototype.isVector4=!0;var Ct=ig,Vu=class extends bi{constructor(e=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:jt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=n,this.depth=i.depth,this.scissor=new Ct(0,0,e,n),this.scissorTest=!1,this.viewport=new Ct(0,0,e,n),this.textures=[];let r={width:e,height:n,depth:i.depth},s=new _n(r),o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let n={minFilter:jt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(n.mapping=e.mapping),e.wrapS!==void 0&&(n.wrapS=e.wrapS),e.wrapT!==void 0&&(n.wrapT=e.wrapT),e.wrapR!==void 0&&(n.wrapR=e.wrapR),e.magFilter!==void 0&&(n.magFilter=e.magFilter),e.minFilter!==void 0&&(n.minFilter=e.minFilter),e.format!==void 0&&(n.format=e.format),e.type!==void 0&&(n.type=e.type),e.anisotropy!==void 0&&(n.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(n.colorSpace=e.colorSpace),e.flipY!==void 0&&(n.flipY=e.flipY),e.generateMipmaps!==void 0&&(n.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(n.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,n,i=1){if(this.width!==e||this.height!==n||this.depth!==i){this.width=e,this.height=n,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=n,this.textures[r].image.depth=i,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,n),this.scissor.set(0,0,e,n)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++){this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let r=Object.assign({},e.textures[n].image);this.textures[n].source=new yo(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},On=class extends Vu{constructor(e=1,n=1,i={}){super(e,n,i),this.isWebGLRenderTarget=!0}},Wa=class extends _n{constructor(e=null,n=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=Xt,this.minFilter=Xt,this.wrapR=Ei,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var Gu=class extends _n{constructor(e=null,n=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=Xt,this.minFilter=Xt,this.wrapR=Ei,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var gh=class gh{constructor(e,n,i,r,s,o,a,l,c,d,f,u,p,g,M,_){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c,d,f,u,p,g,M,_)}set(e,n,i,r,s,o,a,l,c,d,f,u,p,g,M,_){let h=this.elements;return h[0]=e,h[4]=n,h[8]=i,h[12]=r,h[1]=s,h[5]=o,h[9]=a,h[13]=l,h[2]=c,h[6]=d,h[10]=f,h[14]=u,h[3]=p,h[7]=g,h[11]=M,h[15]=_,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new gh().fromArray(this.elements)}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(e){let n=this.elements,i=e.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(e){let n=e.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(e,n,i){return this.determinant()===0?(e.set(1,0,0),n.set(0,1,0),i.set(0,0,1),this):(e.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(e,n,i){return this.set(e.x,n.x,i.x,0,e.y,n.y,i.y,0,e.z,n.z,i.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let n=this.elements,i=e.elements,r=1/to.setFromMatrixColumn(e,0).length(),s=1/to.setFromMatrixColumn(e,1).length(),o=1/to.setFromMatrixColumn(e,2).length();return n[0]=i[0]*r,n[1]=i[1]*r,n[2]=i[2]*r,n[3]=0,n[4]=i[4]*s,n[5]=i[5]*s,n[6]=i[6]*s,n[7]=0,n[8]=i[8]*o,n[9]=i[9]*o,n[10]=i[10]*o,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(e){let n=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),c=Math.sin(r),d=Math.cos(s),f=Math.sin(s);if(e.order==="XYZ"){let u=o*d,p=o*f,g=a*d,M=a*f;n[0]=l*d,n[4]=-l*f,n[8]=c,n[1]=p+g*c,n[5]=u-M*c,n[9]=-a*l,n[2]=M-u*c,n[6]=g+p*c,n[10]=o*l}else if(e.order==="YXZ"){let u=l*d,p=l*f,g=c*d,M=c*f;n[0]=u+M*a,n[4]=g*a-p,n[8]=o*c,n[1]=o*f,n[5]=o*d,n[9]=-a,n[2]=p*a-g,n[6]=M+u*a,n[10]=o*l}else if(e.order==="ZXY"){let u=l*d,p=l*f,g=c*d,M=c*f;n[0]=u-M*a,n[4]=-o*f,n[8]=g+p*a,n[1]=p+g*a,n[5]=o*d,n[9]=M-u*a,n[2]=-o*c,n[6]=a,n[10]=o*l}else if(e.order==="ZYX"){let u=o*d,p=o*f,g=a*d,M=a*f;n[0]=l*d,n[4]=g*c-p,n[8]=u*c+M,n[1]=l*f,n[5]=M*c+u,n[9]=p*c-g,n[2]=-c,n[6]=a*l,n[10]=o*l}else if(e.order==="YZX"){let u=o*l,p=o*c,g=a*l,M=a*c;n[0]=l*d,n[4]=M-u*f,n[8]=g*f+p,n[1]=f,n[5]=o*d,n[9]=-a*d,n[2]=-c*d,n[6]=p*f+g,n[10]=u-M*f}else if(e.order==="XZY"){let u=o*l,p=o*c,g=a*l,M=a*c;n[0]=l*d,n[4]=-f,n[8]=c*d,n[1]=u*f+M,n[5]=o*d,n[9]=p*f-g,n[2]=g*f-p,n[6]=a*d,n[10]=M*f+u}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(e){return this.compose(hw,e,dw)}lookAt(e,n,i){let r=this.elements;return Dn.subVectors(e,n),Dn.lengthSq()===0&&(Dn.z=1),Dn.normalize(),br.crossVectors(i,Dn),br.lengthSq()===0&&(Math.abs(i.z)===1?Dn.x+=1e-4:Dn.z+=1e-4,Dn.normalize(),br.crossVectors(i,Dn)),br.normalize(),eu.crossVectors(Dn,br),r[0]=br.x,r[4]=eu.x,r[8]=Dn.x,r[1]=br.y,r[5]=eu.y,r[9]=Dn.y,r[2]=br.z,r[6]=eu.z,r[10]=Dn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[4],l=i[8],c=i[12],d=i[1],f=i[5],u=i[9],p=i[13],g=i[2],M=i[6],_=i[10],h=i[14],m=i[3],v=i[7],y=i[11],A=i[15],E=r[0],C=r[4],x=r[8],b=r[12],I=r[1],L=r[5],P=r[9],B=r[13],G=r[2],D=r[6],O=r[10],k=r[14],q=r[3],J=r[7],ce=r[11],he=r[15];return s[0]=o*E+a*I+l*G+c*q,s[4]=o*C+a*L+l*D+c*J,s[8]=o*x+a*P+l*O+c*ce,s[12]=o*b+a*B+l*k+c*he,s[1]=d*E+f*I+u*G+p*q,s[5]=d*C+f*L+u*D+p*J,s[9]=d*x+f*P+u*O+p*ce,s[13]=d*b+f*B+u*k+p*he,s[2]=g*E+M*I+_*G+h*q,s[6]=g*C+M*L+_*D+h*J,s[10]=g*x+M*P+_*O+h*ce,s[14]=g*b+M*B+_*k+h*he,s[3]=m*E+v*I+y*G+A*q,s[7]=m*C+v*L+y*D+A*J,s[11]=m*x+v*P+y*O+A*ce,s[15]=m*b+v*B+y*k+A*he,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[4]*=e,n[8]*=e,n[12]*=e,n[1]*=e,n[5]*=e,n[9]*=e,n[13]*=e,n[2]*=e,n[6]*=e,n[10]*=e,n[14]*=e,n[3]*=e,n[7]*=e,n[11]*=e,n[15]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],c=e[13],d=e[2],f=e[6],u=e[10],p=e[14],g=e[3],M=e[7],_=e[11],h=e[15],m=l*p-c*u,v=a*p-c*f,y=a*u-l*f,A=o*p-c*d,E=o*u-l*d,C=o*f-a*d;return n*(M*m-_*v+h*y)-i*(g*m-_*A+h*E)+r*(g*v-M*A+h*C)-s*(g*y-M*E+_*C)}transpose(){let e=this.elements,n;return n=e[1],e[1]=e[4],e[4]=n,n=e[2],e[2]=e[8],e[8]=n,n=e[6],e[6]=e[9],e[9]=n,n=e[3],e[3]=e[12],e[12]=n,n=e[7],e[7]=e[13],e[13]=n,n=e[11],e[11]=e[14],e[14]=n,this}setPosition(e,n,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=n,r[14]=i),this}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=e[9],u=e[10],p=e[11],g=e[12],M=e[13],_=e[14],h=e[15],m=n*a-i*o,v=n*l-r*o,y=n*c-s*o,A=i*l-r*a,E=i*c-s*a,C=r*c-s*l,x=d*M-f*g,b=d*_-u*g,I=d*h-p*g,L=f*_-u*M,P=f*h-p*M,B=u*h-p*_,G=m*B-v*P+y*L+A*I-E*b+C*x;if(G===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let D=1/G;return e[0]=(a*B-l*P+c*L)*D,e[1]=(r*P-i*B-s*L)*D,e[2]=(M*C-_*E+h*A)*D,e[3]=(u*E-f*C-p*A)*D,e[4]=(l*I-o*B-c*b)*D,e[5]=(n*B-r*I+s*b)*D,e[6]=(_*y-g*C-h*v)*D,e[7]=(d*C-u*y+p*v)*D,e[8]=(o*P-a*I+c*x)*D,e[9]=(i*I-n*P-s*x)*D,e[10]=(g*E-M*y+h*m)*D,e[11]=(f*y-d*E-p*m)*D,e[12]=(a*b-o*L-l*x)*D,e[13]=(n*L-i*b+r*x)*D,e[14]=(M*v-g*A-_*m)*D,e[15]=(d*A-f*v+u*m)*D,this}scale(e){let n=this.elements,i=e.x,r=e.y,s=e.z;return n[0]*=i,n[4]*=r,n[8]*=s,n[1]*=i,n[5]*=r,n[9]*=s,n[2]*=i,n[6]*=r,n[10]*=s,n[3]*=i,n[7]*=r,n[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,n=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(n,i,r))}makeTranslation(e,n,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(e){let n=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,n){let i=Math.cos(n),r=Math.sin(n),s=1-i,o=e.x,a=e.y,l=e.z,c=s*o,d=s*a;return this.set(c*o+i,c*a-r*l,c*l+r*a,0,c*a+r*l,d*a+i,d*l-r*o,0,c*l-r*a,d*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,n,i){return this.set(e,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,n,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,n,r,1,0,0,0,0,1),this}compose(e,n,i){let r=this.elements,s=n._x,o=n._y,a=n._z,l=n._w,c=s+s,d=o+o,f=a+a,u=s*c,p=s*d,g=s*f,M=o*d,_=o*f,h=a*f,m=l*c,v=l*d,y=l*f,A=i.x,E=i.y,C=i.z;return r[0]=(1-(M+h))*A,r[1]=(p+y)*A,r[2]=(g-v)*A,r[3]=0,r[4]=(p-y)*E,r[5]=(1-(u+h))*E,r[6]=(_+m)*E,r[7]=0,r[8]=(g+v)*C,r[9]=(_-m)*C,r[10]=(1-(u+M))*C,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,n,i){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinant();if(s===0)return i.set(1,1,1),n.identity(),this;let o=to.set(r[0],r[1],r[2]).length(),a=to.set(r[4],r[5],r[6]).length(),l=to.set(r[8],r[9],r[10]).length();s<0&&(o=-o),li.copy(this);let c=1/o,d=1/a,f=1/l;return li.elements[0]*=c,li.elements[1]*=c,li.elements[2]*=c,li.elements[4]*=d,li.elements[5]*=d,li.elements[6]*=d,li.elements[8]*=f,li.elements[9]*=f,li.elements[10]*=f,n.setFromRotationMatrix(li),i.x=o,i.y=a,i.z=l,this}makePerspective(e,n,i,r,s,o,a=hi,l=!1){let c=this.elements,d=2*s/(n-e),f=2*s/(i-r),u=(n+e)/(n-e),p=(i+r)/(i-r),g,M;if(l)g=s/(o-s),M=o*s/(o-s);else if(a===hi)g=-(o+s)/(o-s),M=-2*o*s/(o-s);else if(a===_o)g=-o/(o-s),M=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=u,c[12]=0,c[1]=0,c[5]=f,c[9]=p,c[13]=0,c[2]=0,c[6]=0,c[10]=g,c[14]=M,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,n,i,r,s,o,a=hi,l=!1){let c=this.elements,d=2/(n-e),f=2/(i-r),u=-(n+e)/(n-e),p=-(i+r)/(i-r),g,M;if(l)g=1/(o-s),M=o/(o-s);else if(a===hi)g=-2/(o-s),M=-(o+s)/(o-s);else if(a===_o)g=-1/(o-s),M=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=0,c[12]=u,c[1]=0,c[5]=f,c[9]=0,c[13]=p,c[2]=0,c[6]=0,c[10]=g,c[14]=M,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<16;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<16;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e[n+9]=i[9],e[n+10]=i[10],e[n+11]=i[11],e[n+12]=i[12],e[n+13]=i[13],e[n+14]=i[14],e[n+15]=i[15],e}};gh.prototype.isMatrix4=!0;var Mt=gh,to=new U,li=new Mt,hw=new U(0,0,0),dw=new U(1,1,1),br=new U,eu=new U,Dn=new U,mx=new Mt,gx=new Ai,Ki=class t{constructor(e=0,n=0,i=0,r=t.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=n,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,n,i,r=this._order){return this._x=e,this._y=n,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,n=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],d=r[9],f=r[2],u=r[6],p=r[10];switch(n){case"XYZ":this._y=Math.asin(et(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-d,p),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(u,c),this._z=0);break;case"YXZ":this._x=Math.asin(-et(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-f,s),this._z=0);break;case"ZXY":this._x=Math.asin(et(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-f,p),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-et(f,-1,1)),Math.abs(f)<.9999999?(this._x=Math.atan2(u,p),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(et(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-d,c),this._y=Math.atan2(-f,s)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-et(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(u,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-d,p),this._y=0);break;default:Ge("Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,n,i){return mx.makeRotationFromQuaternion(e),this.setFromRotationMatrix(mx,n,i)}setFromVector3(e,n=this._order){return this.set(e.x,e.y,e.z,n)}reorder(e){return gx.setFromEuler(this),this.setFromQuaternion(gx,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Ki.DEFAULT_ORDER="XYZ";var So=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},fw=0,_x=new U,no=new Ai,Hi=new Mt,tu=new U,Ia=new U,pw=new U,mw=new Ai,vx=new U(1,0,0),xx=new U(0,1,0),yx=new U(0,0,1),Sx={type:"added"},gw={type:"removed"},io={type:"childadded",child:null},Vp={type:"childremoved",child:null},Qt=class t extends bi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:fw++}),this.uuid=vs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=t.DEFAULT_UP.clone();let e=new U,n=new Ki,i=new Ai,r=new U(1,1,1);function s(){i.setFromEuler(n,!1)}function o(){n.setFromQuaternion(i,void 0,!1)}n._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new Mt},normalMatrix:{value:new Je}}),this.matrix=new Mt,this.matrixWorld=new Mt,this.matrixAutoUpdate=t.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new So,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,n){this.quaternion.setFromAxisAngle(e,n)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,n){return no.setFromAxisAngle(e,n),this.quaternion.multiply(no),this}rotateOnWorldAxis(e,n){return no.setFromAxisAngle(e,n),this.quaternion.premultiply(no),this}rotateX(e){return this.rotateOnAxis(vx,e)}rotateY(e){return this.rotateOnAxis(xx,e)}rotateZ(e){return this.rotateOnAxis(yx,e)}translateOnAxis(e,n){return _x.copy(e).applyQuaternion(this.quaternion),this.position.add(_x.multiplyScalar(n)),this}translateX(e){return this.translateOnAxis(vx,e)}translateY(e){return this.translateOnAxis(xx,e)}translateZ(e){return this.translateOnAxis(yx,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Hi.copy(this.matrixWorld).invert())}lookAt(e,n,i){e.isVector3?tu.copy(e):tu.set(e,n,i);let r=this.parent;this.updateWorldMatrix(!0,!1),Ia.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Hi.lookAt(Ia,tu,this.up):Hi.lookAt(tu,Ia,this.up),this.quaternion.setFromRotationMatrix(Hi),r&&(Hi.extractRotation(r.matrixWorld),no.setFromRotationMatrix(Hi),this.quaternion.premultiply(no.invert()))}add(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return e===this?(He("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Sx),io.child=e,this.dispatchEvent(io),io.child=null):He("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(e);return n!==-1&&(e.parent=null,this.children.splice(n,1),e.dispatchEvent(gw),Vp.child=e,this.dispatchEvent(Vp),Vp.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Hi.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Hi.multiply(e.parent.matrixWorld)),e.applyMatrix4(Hi),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Sx),io.child=e,this.dispatchEvent(io),io.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,n){if(this[e]===n)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,n);if(o!==void 0)return o}}getObjectsByProperty(e,n,i=[]){this[e]===n&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,n,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ia,e,pw),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ia,mw,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return e.set(n[8],n[9],n[10]).normalize()}raycast(){}traverse(e){e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverseVisible(e)}traverseAncestors(e){let n=this.parent;n!==null&&(e(n),n.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let n=e.x,i=e.y,r=e.z,s=this.matrix.elements;s[12]+=n-s[0]*n-s[4]*i-s[8]*r,s[13]+=i-s[1]*n-s[5]*i-s[9]*r,s[14]+=r-s[2]*n-s[6]*i-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].updateMatrixWorld(e)}updateWorldMatrix(e,n){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),n===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let n=e===void 0||typeof e=="string",i={};n&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,d=l.length;c<d;c++){let f=l[c];s(e.shapes,f)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(n){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),d=o(e.images),f=o(e.shapes),u=o(e.skeletons),p=o(e.animations),g=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),d.length>0&&(i.images=d),f.length>0&&(i.shapes=f),u.length>0&&(i.skeletons=u),p.length>0&&(i.animations=p),g.length>0&&(i.nodes=g)}return i.object=r,i;function o(a){let l=[];for(let c in a){let d=a[c];delete d.metadata,l.push(d)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,n=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),n===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};Qt.DEFAULT_UP=new U(0,1,0);Qt.DEFAULT_MATRIX_AUTO_UPDATE=!0;Qt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Kt=class extends Qt{constructor(){super(),this.isGroup=!0,this.type="Group"}},_w={type:"move"},Mo=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Kt,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Kt,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new U,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new U),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Kt,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new U,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new U,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let n=this._hand;if(n)for(let i of e.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,n,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&n.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let M of e.hand.values()){let _=n.getJointPose(M,i),h=this._getHandJoint(c,M);_!==null&&(h.matrix.fromArray(_.transform.matrix),h.matrix.decompose(h.position,h.rotation,h.scale),h.matrixWorldNeedsUpdate=!0,h.jointRadius=_.radius),h.visible=_!==null}let d=c.joints["index-finger-tip"],f=c.joints["thumb-tip"],u=d.position.distanceTo(f.position),p=.02,g=.005;c.inputState.pinching&&u>p+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&u<=p-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=n.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));a!==null&&(r=n.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(_w)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,n){if(e.joints[n.jointName]===void 0){let i=new Kt;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[n.jointName]=i,e.add(i)}return e.joints[n.jointName]}},Ty={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Ar={h:0,s:0,l:0},nu={h:0,s:0,l:0};function Gp(t,e,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?t+(e-t)*6*n:n<1/2?e:n<2/3?t+(e-t)*6*(2/3-n):t}var Ye=class{constructor(e,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,n,i)}set(e,n,i){if(n===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,n,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,n=Jt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,it.colorSpaceToWorking(this,n),this}setRGB(e,n,i,r=it.workingColorSpace){return this.r=e,this.g=n,this.b=i,it.colorSpaceToWorking(this,r),this}setHSL(e,n,i,r=it.workingColorSpace){if(e=Ym(e,1),n=et(n,0,1),i=et(i,0,1),n===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+n):i+n-i*n,o=2*i-s;this.r=Gp(o,s,e+1/3),this.g=Gp(o,s,e),this.b=Gp(o,s,e-1/3)}return it.colorSpaceToWorking(this,r),this}setStyle(e,n=Jt){function i(s){s!==void 0&&parseFloat(s)<1&&Ge("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,n);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,n);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,n);break;default:Ge("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,n);if(o===6)return this.setHex(parseInt(s,16),n);Ge("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,n);return this}setColorName(e,n=Jt){let i=Ty[e.toLowerCase()];return i!==void 0?this.setHex(i,n):Ge("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=$i(e.r),this.g=$i(e.g),this.b=$i(e.b),this}copyLinearToSRGB(e){return this.r=mo(e.r),this.g=mo(e.g),this.b=mo(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Jt){return it.workingToColorSpace(un.copy(this),e),Math.round(et(un.r*255,0,255))*65536+Math.round(et(un.g*255,0,255))*256+Math.round(et(un.b*255,0,255))}getHexString(e=Jt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,n=it.workingColorSpace){it.workingToColorSpace(un.copy(this),n);let i=un.r,r=un.g,s=un.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,c,d=(a+o)/2;if(a===o)l=0,c=0;else{let f=o-a;switch(c=d<=.5?f/(o+a):f/(2-o-a),o){case i:l=(r-s)/f+(r<s?6:0);break;case r:l=(s-i)/f+2;break;case s:l=(i-r)/f+4;break}l/=6}return e.h=l,e.s=c,e.l=d,e}getRGB(e,n=it.workingColorSpace){return it.workingToColorSpace(un.copy(this),n),e.r=un.r,e.g=un.g,e.b=un.b,e}getStyle(e=Jt){it.workingToColorSpace(un.copy(this),e);let n=un.r,i=un.g,r=un.b;return e!==Jt?`color(${e} ${n.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,n,i){return this.getHSL(Ar),this.setHSL(Ar.h+e,Ar.s+n,Ar.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,n){return this.r=e.r+n.r,this.g=e.g+n.g,this.b=e.b+n.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,n){return this.r+=(e.r-this.r)*n,this.g+=(e.g-this.g)*n,this.b+=(e.b-this.b)*n,this}lerpColors(e,n,i){return this.r=e.r+(n.r-e.r)*i,this.g=e.g+(n.g-e.g)*i,this.b=e.b+(n.b-e.b)*i,this}lerpHSL(e,n){this.getHSL(Ar),e.getHSL(nu);let i=Oa(Ar.h,nu.h,n),r=Oa(Ar.s,nu.s,n),s=Oa(Ar.l,nu.l,n);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let n=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*n+s[3]*i+s[6]*r,this.g=s[1]*n+s[4]*i+s[7]*r,this.b=s[2]*n+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,n=0){return this.r=e[n],this.g=e[n+1],this.b=e[n+2],this}toArray(e=[],n=0){return e[n]=this.r,e[n+1]=this.g,e[n+2]=this.b,e}fromBufferAttribute(e,n){return this.r=e.getX(n),this.g=e.getY(n),this.b=e.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},un=new Ye;Ye.NAMES=Ty;var Xa=class t{constructor(e,n=1,i=1e3){this.isFog=!0,this.name="",this.color=new Ye(e),this.near=n,this.far=i}clone(){return new t(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}},qa=class extends Qt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Ki,this.environmentIntensity=1,this.environmentRotation=new Ki,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,n){return super.copy(e,n),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let n=super.toJSON(e);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(n.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(n.object.backgroundIntensity=this.backgroundIntensity),n.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(n.object.environmentIntensity=this.environmentIntensity),n.object.environmentRotation=this.environmentRotation.toArray(),n}},ci=new U,Wi=new U,Hp=new U,Xi=new U,ro=new U,so=new U,Mx=new U,Wp=new U,Xp=new U,qp=new U,Yp=new Ct,Zp=new Ct,$p=new Ct,Zi=class t{constructor(e=new U,n=new U,i=new U){this.a=e,this.b=n,this.c=i}static getNormal(e,n,i,r){r.subVectors(i,n),ci.subVectors(e,n),r.cross(ci);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,n,i,r,s){ci.subVectors(r,n),Wi.subVectors(i,n),Hp.subVectors(e,n);let o=ci.dot(ci),a=ci.dot(Wi),l=ci.dot(Hp),c=Wi.dot(Wi),d=Wi.dot(Hp),f=o*c-a*a;if(f===0)return s.set(0,0,0),null;let u=1/f,p=(c*l-a*d)*u,g=(o*d-a*l)*u;return s.set(1-p-g,g,p)}static containsPoint(e,n,i,r){return this.getBarycoord(e,n,i,r,Xi)===null?!1:Xi.x>=0&&Xi.y>=0&&Xi.x+Xi.y<=1}static getInterpolation(e,n,i,r,s,o,a,l){return this.getBarycoord(e,n,i,r,Xi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Xi.x),l.addScaledVector(o,Xi.y),l.addScaledVector(a,Xi.z),l)}static getInterpolatedAttribute(e,n,i,r,s,o){return Yp.setScalar(0),Zp.setScalar(0),$p.setScalar(0),Yp.fromBufferAttribute(e,n),Zp.fromBufferAttribute(e,i),$p.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(Yp,s.x),o.addScaledVector(Zp,s.y),o.addScaledVector($p,s.z),o}static isFrontFacing(e,n,i,r){return ci.subVectors(i,n),Wi.subVectors(e,n),ci.cross(Wi).dot(r)<0}set(e,n,i){return this.a.copy(e),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(e,n,i,r){return this.a.copy(e[n]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,n,i,r){return this.a.fromBufferAttribute(e,n),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return ci.subVectors(this.c,this.b),Wi.subVectors(this.a,this.b),ci.cross(Wi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return t.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,n){return t.getBarycoord(e,this.a,this.b,this.c,n)}getInterpolation(e,n,i,r,s){return t.getInterpolation(e,this.a,this.b,this.c,n,i,r,s)}containsPoint(e){return t.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return t.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,n){let i=this.a,r=this.b,s=this.c,o,a;ro.subVectors(r,i),so.subVectors(s,i),Wp.subVectors(e,i);let l=ro.dot(Wp),c=so.dot(Wp);if(l<=0&&c<=0)return n.copy(i);Xp.subVectors(e,r);let d=ro.dot(Xp),f=so.dot(Xp);if(d>=0&&f<=d)return n.copy(r);let u=l*f-d*c;if(u<=0&&l>=0&&d<=0)return o=l/(l-d),n.copy(i).addScaledVector(ro,o);qp.subVectors(e,s);let p=ro.dot(qp),g=so.dot(qp);if(g>=0&&p<=g)return n.copy(s);let M=p*c-l*g;if(M<=0&&c>=0&&g<=0)return a=c/(c-g),n.copy(i).addScaledVector(so,a);let _=d*g-p*f;if(_<=0&&f-d>=0&&p-g>=0)return Mx.subVectors(s,r),a=(f-d)/(f-d+(p-g)),n.copy(r).addScaledVector(Mx,a);let h=1/(_+M+u);return o=M*h,a=u*h,n.copy(i).addScaledVector(ro,o).addScaledVector(so,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Nr=class{constructor(e=new U(1/0,1/0,1/0),n=new U(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=n}set(e,n){return this.min.copy(e),this.max.copy(n),this}setFromArray(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n+=3)this.expandByPoint(ui.fromArray(e,n));return this}setFromBufferAttribute(e){this.makeEmpty();for(let n=0,i=e.count;n<i;n++)this.expandByPoint(ui.fromBufferAttribute(e,n));return this}setFromPoints(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n++)this.expandByPoint(e[n]);return this}setFromCenterAndSize(e,n){let i=ui.copy(n).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,n=!1){return this.makeEmpty(),this.expandByObject(e,n)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,n=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(n===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,ui):ui.fromBufferAttribute(s,o),ui.applyMatrix4(e.matrixWorld),this.expandByPoint(ui);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),iu.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),iu.copy(i.boundingBox)),iu.applyMatrix4(e.matrixWorld),this.union(iu)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],n);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,n){return n.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,ui),ui.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let n,i;return e.normal.x>0?(n=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(n=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(n+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(n+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(n+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(n+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),n<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(La),ru.subVectors(this.max,La),oo.subVectors(e.a,La),ao.subVectors(e.b,La),lo.subVectors(e.c,La),Cr.subVectors(ao,oo),Rr.subVectors(lo,ao),as.subVectors(oo,lo);let n=[0,-Cr.z,Cr.y,0,-Rr.z,Rr.y,0,-as.z,as.y,Cr.z,0,-Cr.x,Rr.z,0,-Rr.x,as.z,0,-as.x,-Cr.y,Cr.x,0,-Rr.y,Rr.x,0,-as.y,as.x,0];return!Jp(n,oo,ao,lo,ru)||(n=[1,0,0,0,1,0,0,0,1],!Jp(n,oo,ao,lo,ru))?!1:(su.crossVectors(Cr,Rr),n=[su.x,su.y,su.z],Jp(n,oo,ao,lo,ru))}clampPoint(e,n){return n.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,ui).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(ui).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(qi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),qi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),qi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),qi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),qi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),qi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),qi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),qi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(qi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},qi=[new U,new U,new U,new U,new U,new U,new U,new U],ui=new U,iu=new Nr,oo=new U,ao=new U,lo=new U,Cr=new U,Rr=new U,as=new U,La=new U,ru=new U,su=new U,ls=new U;function Jp(t,e,n,i,r){for(let s=0,o=t.length-3;s<=o;s+=3){ls.fromArray(t,s);let a=r.x*Math.abs(ls.x)+r.y*Math.abs(ls.y)+r.z*Math.abs(ls.z),l=e.dot(ls),c=n.dot(ls),d=i.dot(ls);if(Math.max(-Math.max(l,c,d),Math.min(l,c,d))>a)return!1}return!0}var Ft=new U,ou=new Te,vw=0,Fn=class extends bi{constructor(e,n,i=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:vw++}),this.name="",this.array=e,this.itemSize=n,this.count=e!==void 0?e.length/n:0,this.normalized=i,this.usage=mm,this.updateRanges=[],this.gpuType=pi,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,n,i){e*=this.itemSize,i*=n.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=n.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)ou.fromBufferAttribute(this,n),ou.applyMatrix3(e),this.setXY(n,ou.x,ou.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)Ft.fromBufferAttribute(this,n),Ft.applyMatrix3(e),this.setXYZ(n,Ft.x,Ft.y,Ft.z);return this}applyMatrix4(e){for(let n=0,i=this.count;n<i;n++)Ft.fromBufferAttribute(this,n),Ft.applyMatrix4(e),this.setXYZ(n,Ft.x,Ft.y,Ft.z);return this}applyNormalMatrix(e){for(let n=0,i=this.count;n<i;n++)Ft.fromBufferAttribute(this,n),Ft.applyNormalMatrix(e),this.setXYZ(n,Ft.x,Ft.y,Ft.z);return this}transformDirection(e){for(let n=0,i=this.count;n<i;n++)Ft.fromBufferAttribute(this,n),Ft.transformDirection(e),this.setXYZ(n,Ft.x,Ft.y,Ft.z);return this}set(e,n=0){return this.array.set(e,n),this}getComponent(e,n){let i=this.array[e*this.itemSize+n];return this.normalized&&(i=fo(i,this.array)),i}setComponent(e,n,i){return this.normalized&&(i=gn(i,this.array)),this.array[e*this.itemSize+n]=i,this}getX(e){let n=this.array[e*this.itemSize];return this.normalized&&(n=fo(n,this.array)),n}setX(e,n){return this.normalized&&(n=gn(n,this.array)),this.array[e*this.itemSize]=n,this}getY(e){let n=this.array[e*this.itemSize+1];return this.normalized&&(n=fo(n,this.array)),n}setY(e,n){return this.normalized&&(n=gn(n,this.array)),this.array[e*this.itemSize+1]=n,this}getZ(e){let n=this.array[e*this.itemSize+2];return this.normalized&&(n=fo(n,this.array)),n}setZ(e,n){return this.normalized&&(n=gn(n,this.array)),this.array[e*this.itemSize+2]=n,this}getW(e){let n=this.array[e*this.itemSize+3];return this.normalized&&(n=fo(n,this.array)),n}setW(e,n){return this.normalized&&(n=gn(n,this.array)),this.array[e*this.itemSize+3]=n,this}setXY(e,n,i){return e*=this.itemSize,this.normalized&&(n=gn(n,this.array),i=gn(i,this.array)),this.array[e+0]=n,this.array[e+1]=i,this}setXYZ(e,n,i,r){return e*=this.itemSize,this.normalized&&(n=gn(n,this.array),i=gn(i,this.array),r=gn(r,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,n,i,r,s){return e*=this.itemSize,this.normalized&&(n=gn(n,this.array),i=gn(i,this.array),r=gn(r,this.array),s=gn(s,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==mm&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var Ya=class extends Fn{constructor(e,n,i){super(new Uint16Array(e),n,i)}};var Za=class extends Fn{constructor(e,n,i){super(new Uint32Array(e),n,i)}};var pt=class extends Fn{constructor(e,n,i){super(new Float32Array(e),n,i)}},xw=new Nr,Na=new U,Kp=new U,ms=class{constructor(e=new U,n=-1){this.isSphere=!0,this.center=e,this.radius=n}set(e,n){return this.center.copy(e),this.radius=n,this}setFromPoints(e,n){let i=this.center;n!==void 0?i.copy(n):xw.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let n=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=n*n}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,n){let i=this.center.distanceToSquared(e);return n.copy(e),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Na.subVectors(e,this.center);let n=Na.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),r=(i-this.radius)*.5;this.center.addScaledVector(Na,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Kp.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Na.copy(e.center).add(Kp)),this.expandByPoint(Na.copy(e.center).sub(Kp))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},yw=0,Jn=new Mt,jp=new Qt,co=new U,Un=new Nr,Da=new Nr,Wt=new U,qt=class t extends bi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:yw++}),this.uuid=vs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(W1(e)?Za:Ya)(e,1):this.index=e,this}setIndirect(e,n=0){return this.indirect=e,this.indirectOffset=n,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,n){return this.attributes[e]=n,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,n,i=0){this.groups.push({start:e,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,n){this.drawRange.start=e,this.drawRange.count=n}applyMatrix4(e){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(e),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new Je().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Jn.makeRotationFromQuaternion(e),this.applyMatrix4(Jn),this}rotateX(e){return Jn.makeRotationX(e),this.applyMatrix4(Jn),this}rotateY(e){return Jn.makeRotationY(e),this.applyMatrix4(Jn),this}rotateZ(e){return Jn.makeRotationZ(e),this.applyMatrix4(Jn),this}translate(e,n,i){return Jn.makeTranslation(e,n,i),this.applyMatrix4(Jn),this}scale(e,n,i){return Jn.makeScale(e,n,i),this.applyMatrix4(Jn),this}lookAt(e){return jp.lookAt(e),jp.updateMatrix(),this.applyMatrix4(jp.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(co).negate(),this.translate(co.x,co.y,co.z),this}setFromPoints(e){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new pt(i,3))}else{let i=Math.min(e.length,n.count);for(let r=0;r<i;r++){let s=e[r];n.setXYZ(r,s.x,s.y,s.z||0)}e.length>n.count&&Ge("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Nr);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){He("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new U(-1/0,-1/0,-1/0),new U(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),n)for(let i=0,r=n.length;i<r;i++){let s=n[i];Un.setFromBufferAttribute(s),this.morphTargetsRelative?(Wt.addVectors(this.boundingBox.min,Un.min),this.boundingBox.expandByPoint(Wt),Wt.addVectors(this.boundingBox.max,Un.max),this.boundingBox.expandByPoint(Wt)):(this.boundingBox.expandByPoint(Un.min),this.boundingBox.expandByPoint(Un.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&He('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ms);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){He("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new U,1/0);return}if(e){let i=this.boundingSphere.center;if(Un.setFromBufferAttribute(e),n)for(let s=0,o=n.length;s<o;s++){let a=n[s];Da.setFromBufferAttribute(a),this.morphTargetsRelative?(Wt.addVectors(Un.min,Da.min),Un.expandByPoint(Wt),Wt.addVectors(Un.max,Da.max),Un.expandByPoint(Wt)):(Un.expandByPoint(Da.min),Un.expandByPoint(Da.max))}Un.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)Wt.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(Wt));if(n)for(let s=0,o=n.length;s<o;s++){let a=n[s],l=this.morphTargetsRelative;for(let c=0,d=a.count;c<d;c++)Wt.fromBufferAttribute(a,c),l&&(co.fromBufferAttribute(e,c),Wt.add(co)),r=Math.max(r,i.distanceToSquared(Wt))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&He('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,n=this.attributes;if(e===null||n.position===void 0||n.normal===void 0||n.uv===void 0){He("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,r=n.normal,s=n.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Fn(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let x=0;x<i.count;x++)a[x]=new U,l[x]=new U;let c=new U,d=new U,f=new U,u=new Te,p=new Te,g=new Te,M=new U,_=new U;function h(x,b,I){c.fromBufferAttribute(i,x),d.fromBufferAttribute(i,b),f.fromBufferAttribute(i,I),u.fromBufferAttribute(s,x),p.fromBufferAttribute(s,b),g.fromBufferAttribute(s,I),d.sub(c),f.sub(c),p.sub(u),g.sub(u);let L=1/(p.x*g.y-g.x*p.y);isFinite(L)&&(M.copy(d).multiplyScalar(g.y).addScaledVector(f,-p.y).multiplyScalar(L),_.copy(f).multiplyScalar(p.x).addScaledVector(d,-g.x).multiplyScalar(L),a[x].add(M),a[b].add(M),a[I].add(M),l[x].add(_),l[b].add(_),l[I].add(_))}let m=this.groups;m.length===0&&(m=[{start:0,count:e.count}]);for(let x=0,b=m.length;x<b;++x){let I=m[x],L=I.start,P=I.count;for(let B=L,G=L+P;B<G;B+=3)h(e.getX(B+0),e.getX(B+1),e.getX(B+2))}let v=new U,y=new U,A=new U,E=new U;function C(x){A.fromBufferAttribute(r,x),E.copy(A);let b=a[x];v.copy(b),v.sub(A.multiplyScalar(A.dot(b))).normalize(),y.crossVectors(E,b);let L=y.dot(l[x])<0?-1:1;o.setXYZW(x,v.x,v.y,v.z,L)}for(let x=0,b=m.length;x<b;++x){let I=m[x],L=I.start,P=I.count;for(let B=L,G=L+P;B<G;B+=3)C(e.getX(B+0)),C(e.getX(B+1)),C(e.getX(B+2))}}computeVertexNormals(){let e=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Fn(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let u=0,p=i.count;u<p;u++)i.setXYZ(u,0,0,0);let r=new U,s=new U,o=new U,a=new U,l=new U,c=new U,d=new U,f=new U;if(e)for(let u=0,p=e.count;u<p;u+=3){let g=e.getX(u+0),M=e.getX(u+1),_=e.getX(u+2);r.fromBufferAttribute(n,g),s.fromBufferAttribute(n,M),o.fromBufferAttribute(n,_),d.subVectors(o,s),f.subVectors(r,s),d.cross(f),a.fromBufferAttribute(i,g),l.fromBufferAttribute(i,M),c.fromBufferAttribute(i,_),a.add(d),l.add(d),c.add(d),i.setXYZ(g,a.x,a.y,a.z),i.setXYZ(M,l.x,l.y,l.z),i.setXYZ(_,c.x,c.y,c.z)}else for(let u=0,p=n.count;u<p;u+=3)r.fromBufferAttribute(n,u+0),s.fromBufferAttribute(n,u+1),o.fromBufferAttribute(n,u+2),d.subVectors(o,s),f.subVectors(r,s),d.cross(f),i.setXYZ(u+0,d.x,d.y,d.z),i.setXYZ(u+1,d.x,d.y,d.z),i.setXYZ(u+2,d.x,d.y,d.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let n=0,i=e.count;n<i;n++)Wt.fromBufferAttribute(e,n),Wt.normalize(),e.setXYZ(n,Wt.x,Wt.y,Wt.z)}toNonIndexed(){function e(a,l){let c=a.array,d=a.itemSize,f=a.normalized,u=new c.constructor(l.length*d),p=0,g=0;for(let M=0,_=l.length;M<_;M++){a.isInterleavedBufferAttribute?p=l[M]*a.data.stride+a.offset:p=l[M]*d;for(let h=0;h<d;h++)u[g++]=c[p++]}return new Fn(u,d,f)}if(this.index===null)return Ge("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new t,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],c=e(l,i);n.setAttribute(a,c)}let s=this.morphAttributes;for(let a in s){let l=[],c=s[a];for(let d=0,f=c.length;d<f;d++){let u=c[d],p=e(u,i);l.push(p)}n.morphAttributes[a]=l}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let n=this.index;n!==null&&(e.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];e.data.attributes[l]=c.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],d=[];for(let f=0,u=c.length;f<u;f++){let p=c[f];d.push(p.toJSON(e.data))}d.length>0&&(r[l]=d,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let c in r){let d=r[c];this.setAttribute(c,d.clone(n))}let s=e.morphAttributes;for(let c in s){let d=[],f=s[c];for(let u=0,p=f.length;u<p;u++)d.push(f[u].clone(n));this.morphAttributes[c]=d}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,d=o.length;c<d;c++){let f=o[c];this.addGroup(f.start,f.count,f.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var Sw=0,ji=class extends bi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Sw++}),this.uuid=vs(),this.name="",this.type="Material",this.blending=fs,this.side=Ji,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Cu,this.blendDst=Ru,this.blendEquation=Lr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ye(0,0,0),this.blendAlpha=0,this.depthFunc=ps,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=pm,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=hs,this.stencilZFail=hs,this.stencilZPass=hs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let n in e){let i=e[n];if(i===void 0){Ge(`Material: parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Ge(`Material: '${n}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";n&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==fs&&(i.blending=this.blending),this.side!==Ji&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==Cu&&(i.blendSrc=this.blendSrc),this.blendDst!==Ru&&(i.blendDst=this.blendDst),this.blendEquation!==Lr&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==ps&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==pm&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==hs&&(i.stencilFail=this.stencilFail),this.stencilZFail!==hs&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==hs&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(n){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let n=e.clippingPlanes,i=null;if(n!==null){let r=n.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=n[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var Yi=new U,Qp=new U,au=new U,Pr=new U,em=new U,lu=new U,tm=new U,wo=class{constructor(e=new U,n=new U(0,0,-1)){this.origin=e,this.direction=n}set(e,n){return this.origin.copy(e),this.direction.copy(n),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,n){return n.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Yi)),this}closestPointToPoint(e,n){n.subVectors(e,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let n=Yi.subVectors(e,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(e):(Yi.copy(this.origin).addScaledVector(this.direction,n),Yi.distanceToSquared(e))}distanceSqToSegment(e,n,i,r){Qp.copy(e).add(n).multiplyScalar(.5),au.copy(n).sub(e).normalize(),Pr.copy(this.origin).sub(Qp);let s=e.distanceTo(n)*.5,o=-this.direction.dot(au),a=Pr.dot(this.direction),l=-Pr.dot(au),c=Pr.lengthSq(),d=Math.abs(1-o*o),f,u,p,g;if(d>0)if(f=o*l-a,u=o*a-l,g=s*d,f>=0)if(u>=-g)if(u<=g){let M=1/d;f*=M,u*=M,p=f*(f+o*u+2*a)+u*(o*f+u+2*l)+c}else u=s,f=Math.max(0,-(o*u+a)),p=-f*f+u*(u+2*l)+c;else u=-s,f=Math.max(0,-(o*u+a)),p=-f*f+u*(u+2*l)+c;else u<=-g?(f=Math.max(0,-(-o*s+a)),u=f>0?-s:Math.min(Math.max(-s,-l),s),p=-f*f+u*(u+2*l)+c):u<=g?(f=0,u=Math.min(Math.max(-s,-l),s),p=u*(u+2*l)+c):(f=Math.max(0,-(o*s+a)),u=f>0?s:Math.min(Math.max(-s,-l),s),p=-f*f+u*(u+2*l)+c);else u=o>0?-s:s,f=Math.max(0,-(o*u+a)),p=-f*f+u*(u+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,f),r&&r.copy(Qp).addScaledVector(au,u),p}intersectSphere(e,n){Yi.subVectors(e.center,this.origin);let i=Yi.dot(this.direction),r=Yi.dot(Yi)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,n):this.at(a,n)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let n=e.normal.dot(this.direction);if(n===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/n;return i>=0?i:null}intersectPlane(e,n){let i=this.distanceToPlane(e);return i===null?null:this.at(i,n)}intersectsPlane(e){let n=e.distanceToPoint(this.origin);return n===0||e.normal.dot(this.direction)*n<0}intersectBox(e,n){let i,r,s,o,a,l,c=1/this.direction.x,d=1/this.direction.y,f=1/this.direction.z,u=this.origin;return c>=0?(i=(e.min.x-u.x)*c,r=(e.max.x-u.x)*c):(i=(e.max.x-u.x)*c,r=(e.min.x-u.x)*c),d>=0?(s=(e.min.y-u.y)*d,o=(e.max.y-u.y)*d):(s=(e.max.y-u.y)*d,o=(e.min.y-u.y)*d),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),f>=0?(a=(e.min.z-u.z)*f,l=(e.max.z-u.z)*f):(a=(e.max.z-u.z)*f,l=(e.min.z-u.z)*f),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,n)}intersectsBox(e){return this.intersectBox(e,Yi)!==null}intersectTriangle(e,n,i,r,s){em.subVectors(n,e),lu.subVectors(i,e),tm.crossVectors(em,lu);let o=this.direction.dot(tm),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Pr.subVectors(this.origin,e);let l=a*this.direction.dot(lu.crossVectors(Pr,lu));if(l<0)return null;let c=a*this.direction.dot(em.cross(Pr));if(c<0||l+c>o)return null;let d=-a*Pr.dot(tm);return d<0?null:this.at(d/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Qi=class extends ji{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ye(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ki,this.combine=Rm,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},wx=new Mt,cs=new wo,cu=new ms,Ex=new U,uu=new U,hu=new U,du=new U,nm=new U,fu=new U,Tx=new U,pu=new U,en=class extends Qt{constructor(e=new qt,n=new Qi){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,n){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;n.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){fu.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let d=a[l],f=s[l];d!==0&&(nm.fromBufferAttribute(f,e),o?fu.addScaledVector(nm,d):fu.addScaledVector(nm.sub(n),d))}n.add(fu)}return n}raycast(e,n){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),cu.copy(i.boundingSphere),cu.applyMatrix4(s),cs.copy(e.ray).recast(e.near),!(cu.containsPoint(cs.origin)===!1&&(cs.intersectSphere(cu,Ex)===null||cs.origin.distanceToSquared(Ex)>(e.far-e.near)**2))&&(wx.copy(s).invert(),cs.copy(e.ray).applyMatrix4(wx),!(i.boundingBox!==null&&cs.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,n,cs)))}_computeIntersections(e,n,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,d=s.attributes.uv1,f=s.attributes.normal,u=s.groups,p=s.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,M=u.length;g<M;g++){let _=u[g],h=o[_.materialIndex],m=Math.max(_.start,p.start),v=Math.min(a.count,Math.min(_.start+_.count,p.start+p.count));for(let y=m,A=v;y<A;y+=3){let E=a.getX(y),C=a.getX(y+1),x=a.getX(y+2);r=mu(this,h,e,i,c,d,f,E,C,x),r&&(r.faceIndex=Math.floor(y/3),r.face.materialIndex=_.materialIndex,n.push(r))}}else{let g=Math.max(0,p.start),M=Math.min(a.count,p.start+p.count);for(let _=g,h=M;_<h;_+=3){let m=a.getX(_),v=a.getX(_+1),y=a.getX(_+2);r=mu(this,o,e,i,c,d,f,m,v,y),r&&(r.faceIndex=Math.floor(_/3),n.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let g=0,M=u.length;g<M;g++){let _=u[g],h=o[_.materialIndex],m=Math.max(_.start,p.start),v=Math.min(l.count,Math.min(_.start+_.count,p.start+p.count));for(let y=m,A=v;y<A;y+=3){let E=y,C=y+1,x=y+2;r=mu(this,h,e,i,c,d,f,E,C,x),r&&(r.faceIndex=Math.floor(y/3),r.face.materialIndex=_.materialIndex,n.push(r))}}else{let g=Math.max(0,p.start),M=Math.min(l.count,p.start+p.count);for(let _=g,h=M;_<h;_+=3){let m=_,v=_+1,y=_+2;r=mu(this,o,e,i,c,d,f,m,v,y),r&&(r.faceIndex=Math.floor(_/3),n.push(r))}}}};function Mw(t,e,n,i,r,s,o,a){let l;if(e.side===vn?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===Ji,a),l===null)return null;pu.copy(a),pu.applyMatrix4(t.matrixWorld);let c=n.ray.origin.distanceTo(pu);return c<n.near||c>n.far?null:{distance:c,point:pu.clone(),object:t}}function mu(t,e,n,i,r,s,o,a,l,c){t.getVertexPosition(a,uu),t.getVertexPosition(l,hu),t.getVertexPosition(c,du);let d=Mw(t,e,n,i,uu,hu,du,Tx);if(d){let f=new U;Zi.getBarycoord(Tx,uu,hu,du,f),r&&(d.uv=Zi.getInterpolatedAttribute(r,a,l,c,f,new Te)),s&&(d.uv1=Zi.getInterpolatedAttribute(s,a,l,c,f,new Te)),o&&(d.normal=Zi.getInterpolatedAttribute(o,a,l,c,f,new U),d.normal.dot(i.direction)>0&&d.normal.multiplyScalar(-1));let u={a,b:l,c,normal:new U,materialIndex:0};Zi.getNormal(uu,hu,du,u.normal),d.face=u,d.barycoord=f}return d}var Hu=class extends _n{constructor(e=null,n=1,i=1,r,s,o,a,l,c=Xt,d=Xt,f,u){super(null,o,a,l,c,d,r,s,f,u),this.isDataTexture=!0,this.image={data:e,width:n,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var im=new U,ww=new U,Ew=new Je,Kn=class{constructor(e=new U(1,0,0),n=0){this.isPlane=!0,this.normal=e,this.constant=n}set(e,n){return this.normal.copy(e),this.constant=n,this}setComponents(e,n,i,r){return this.normal.set(e,n,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,n){return this.normal.copy(e),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(e,n,i){let r=im.subVectors(i,n).cross(ww.subVectors(e,n)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,n){return n.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,n,i=!0){let r=e.delta(im),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?n.copy(e.start):null;let o=-(e.start.dot(this.normal)+this.constant)/s;return i===!0&&(o<0||o>1)?null:n.copy(e.start).addScaledVector(r,o)}intersectsLine(e){let n=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return n<0&&i>0||i<0&&n>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,n){let i=n||Ew.getNormalMatrix(e),r=this.coplanarPoint(im).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},us=new ms,Tw=new Te(.5,.5),gu=new U,Eo=class{constructor(e=new Kn,n=new Kn,i=new Kn,r=new Kn,s=new Kn,o=new Kn){this.planes=[e,n,i,r,s,o]}set(e,n,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(n),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,n=hi,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],c=s[3],d=s[4],f=s[5],u=s[6],p=s[7],g=s[8],M=s[9],_=s[10],h=s[11],m=s[12],v=s[13],y=s[14],A=s[15];if(r[0].setComponents(c-o,p-d,h-g,A-m).normalize(),r[1].setComponents(c+o,p+d,h+g,A+m).normalize(),r[2].setComponents(c+a,p+f,h+M,A+v).normalize(),r[3].setComponents(c-a,p-f,h-M,A-v).normalize(),i)r[4].setComponents(l,u,_,y).normalize(),r[5].setComponents(c-l,p-u,h-_,A-y).normalize();else if(r[4].setComponents(c-l,p-u,h-_,A-y).normalize(),n===hi)r[5].setComponents(c+l,p+u,h+_,A+y).normalize();else if(n===_o)r[5].setComponents(l,u,_,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),us.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let n=e.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),us.copy(n.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(us)}intersectsSprite(e){us.center.set(0,0,0);let n=Tw.distanceTo(e.center);return us.radius=.7071067811865476+n,us.applyMatrix4(e.matrixWorld),this.intersectsSphere(us)}intersectsSphere(e){let n=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(n[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let n=this.planes;for(let i=0;i<6;i++){let r=n[i];if(gu.x=r.normal.x>0?e.max.x:e.min.x,gu.y=r.normal.y>0?e.max.y:e.min.y,gu.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(gu)<0)return!1}return!0}containsPoint(e){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var To=class extends ji{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Ye(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},Wu=new U,Xu=new U,bx=new Mt,Ua=new wo,_u=new ms,rm=new U,Ax=new U,qu=class extends Qt{constructor(e=new qt,n=new To){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let n=e.attributes.position,i=[0];for(let r=1,s=n.count;r<s;r++)Wu.fromBufferAttribute(n,r-1),Xu.fromBufferAttribute(n,r),i[r]=i[r-1],i[r]+=Wu.distanceTo(Xu);e.setAttribute("lineDistance",new pt(i,1))}else Ge("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,n){let i=this.geometry,r=this.matrixWorld,s=e.params.Line.threshold,o=i.drawRange;if(i.boundingSphere===null&&i.computeBoundingSphere(),_u.copy(i.boundingSphere),_u.applyMatrix4(r),_u.radius+=s,e.ray.intersectsSphere(_u)===!1)return;bx.copy(r).invert(),Ua.copy(e.ray).applyMatrix4(bx);let a=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=this.isLineSegments?2:1,d=i.index,u=i.attributes.position;if(d!==null){let p=Math.max(0,o.start),g=Math.min(d.count,o.start+o.count);for(let M=p,_=g-1;M<_;M+=c){let h=d.getX(M),m=d.getX(M+1),v=vu(this,e,Ua,l,h,m,M);v&&n.push(v)}if(this.isLineLoop){let M=d.getX(g-1),_=d.getX(p),h=vu(this,e,Ua,l,M,_,g-1);h&&n.push(h)}}else{let p=Math.max(0,o.start),g=Math.min(u.count,o.start+o.count);for(let M=p,_=g-1;M<_;M+=c){let h=vu(this,e,Ua,l,M,M+1,M);h&&n.push(h)}if(this.isLineLoop){let M=vu(this,e,Ua,l,g-1,p,g-1);M&&n.push(M)}}}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}};function vu(t,e,n,i,r,s,o){let a=t.geometry.attributes.position;if(Wu.fromBufferAttribute(a,r),Xu.fromBufferAttribute(a,s),n.distanceSqToSegment(Wu,Xu,rm,Ax)>i)return;rm.applyMatrix4(t.matrixWorld);let c=e.ray.origin.distanceTo(rm);if(!(c<e.near||c>e.far))return{distance:c,point:Ax.clone().applyMatrix4(t.matrixWorld),index:o,face:null,faceIndex:null,barycoord:null,object:t}}var Cx=new U,Rx=new U,$a=class extends qu{constructor(e,n){super(e,n),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let e=this.geometry;if(e.index===null){let n=e.attributes.position,i=[];for(let r=0,s=n.count;r<s;r+=2)Cx.fromBufferAttribute(n,r),Rx.fromBufferAttribute(n,r+1),i[r]=r===0?0:i[r-1],i[r+1]=i[r]+Cx.distanceTo(Rx);e.setAttribute("lineDistance",new pt(i,1))}else Ge("LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}};var Ja=class extends _n{constructor(e=[],n=zr,i,r,s,o,a,l,c,d){super(e,n,i,r,s,o,a,l,c,d),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},bo=class extends _n{constructor(e,n,i,r,s,o,a,l,c){super(e,n,i,r,s,o,a,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}};var er=class extends _n{constructor(e,n,i=fi,r,s,o,a=Xt,l=Xt,c,d=Ti,f=1){if(d!==Ti&&d!==Gr)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let u={width:e,height:n,depth:f};super(u,r,s,o,a,l,d,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new yo(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let n=super.toJSON(e);return this.compareFunction!==null&&(n.compareFunction=this.compareFunction),n}},Yu=class extends er{constructor(e,n=fi,i=zr,r,s,o=Xt,a=Xt,l,c=Ti){let d={width:e,height:e,depth:1},f=[d,d,d,d,d,d];super(e,e,n,i,r,s,o,a,l,c),this.image=f,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Ka=class extends _n{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Dr=class t extends qt{constructor(e=1,n=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:n,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],c=[],d=[],f=[],u=0,p=0;g("z","y","x",-1,-1,i,n,e,o,s,0),g("z","y","x",1,-1,i,n,-e,o,s,1),g("x","z","y",1,1,e,i,n,r,o,2),g("x","z","y",1,-1,e,i,-n,r,o,3),g("x","y","z",1,-1,e,n,i,r,s,4),g("x","y","z",-1,-1,e,n,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new pt(c,3)),this.setAttribute("normal",new pt(d,3)),this.setAttribute("uv",new pt(f,2));function g(M,_,h,m,v,y,A,E,C,x,b){let I=y/C,L=A/x,P=y/2,B=A/2,G=E/2,D=C+1,O=x+1,k=0,q=0,J=new U;for(let ce=0;ce<O;ce++){let he=ce*L-B;for(let Me=0;Me<D;Me++){let Fe=Me*I-P;J[M]=Fe*m,J[_]=he*v,J[h]=G,c.push(J.x,J.y,J.z),J[M]=0,J[_]=0,J[h]=E>0?1:-1,d.push(J.x,J.y,J.z),f.push(Me/C),f.push(1-ce/x),k+=1}}for(let ce=0;ce<x;ce++)for(let he=0;he<C;he++){let Me=u+he+D*ce,Fe=u+he+D*(ce+1),Ze=u+(he+1)+D*(ce+1),Be=u+(he+1)+D*ce;l.push(Me,Fe,Be),l.push(Fe,Ze,Be),q+=6}a.addGroup(p,q,b),p+=q,u+=k}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var Ao=class t extends qt{constructor(e=1,n=1,i=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:n,height:i,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};let c=this;r=Math.floor(r),s=Math.floor(s);let d=[],f=[],u=[],p=[],g=0,M=[],_=i/2,h=0;m(),o===!1&&(e>0&&v(!0),n>0&&v(!1)),this.setIndex(d),this.setAttribute("position",new pt(f,3)),this.setAttribute("normal",new pt(u,3)),this.setAttribute("uv",new pt(p,2));function m(){let y=new U,A=new U,E=0,C=(n-e)/i;for(let x=0;x<=s;x++){let b=[],I=x/s,L=I*(n-e)+e;for(let P=0;P<=r;P++){let B=P/r,G=B*l+a,D=Math.sin(G),O=Math.cos(G);A.x=L*D,A.y=-I*i+_,A.z=L*O,f.push(A.x,A.y,A.z),y.set(D,C,O).normalize(),u.push(y.x,y.y,y.z),p.push(B,1-I),b.push(g++)}M.push(b)}for(let x=0;x<r;x++)for(let b=0;b<s;b++){let I=M[b][x],L=M[b+1][x],P=M[b+1][x+1],B=M[b][x+1];(e>0||b!==0)&&(d.push(I,L,B),E+=3),(n>0||b!==s-1)&&(d.push(L,P,B),E+=3)}c.addGroup(h,E,0),h+=E}function v(y){let A=g,E=new Te,C=new U,x=0,b=y===!0?e:n,I=y===!0?1:-1;for(let P=1;P<=r;P++)f.push(0,_*I,0),u.push(0,I,0),p.push(.5,.5),g++;let L=g;for(let P=0;P<=r;P++){let G=P/r*l+a,D=Math.cos(G),O=Math.sin(G);C.x=b*O,C.y=_*I,C.z=b*D,f.push(C.x,C.y,C.z),u.push(0,I,0),E.x=D*.5+.5,E.y=O*.5*I+.5,p.push(E.x,E.y),g++}for(let P=0;P<r;P++){let B=A+P,G=L+P;y===!0?d.push(G,G+1,B):d.push(G+1,G,B),x+=3}c.addGroup(h,x,y===!0?1:2),h+=x}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},ja=class t extends Ao{constructor(e=1,n=1,i=32,r=1,s=!1,o=0,a=Math.PI*2){super(0,e,n,i,r,s,o,a),this.type="ConeGeometry",this.parameters={radius:e,height:n,radialSegments:i,heightSegments:r,openEnded:s,thetaStart:o,thetaLength:a}}static fromJSON(e){return new t(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},Zu=class t extends qt{constructor(e=[],n=[],i=1,r=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:n,radius:i,detail:r};let s=[],o=[];a(r),c(i),d(),this.setAttribute("position",new pt(s,3)),this.setAttribute("normal",new pt(s.slice(),3)),this.setAttribute("uv",new pt(o,2)),r===0?this.computeVertexNormals():this.normalizeNormals();function a(m){let v=new U,y=new U,A=new U;for(let E=0;E<n.length;E+=3)p(n[E+0],v),p(n[E+1],y),p(n[E+2],A),l(v,y,A,m)}function l(m,v,y,A){let E=A+1,C=[];for(let x=0;x<=E;x++){C[x]=[];let b=m.clone().lerp(y,x/E),I=v.clone().lerp(y,x/E),L=E-x;for(let P=0;P<=L;P++)P===0&&x===E?C[x][P]=b:C[x][P]=b.clone().lerp(I,P/L)}for(let x=0;x<E;x++)for(let b=0;b<2*(E-x)-1;b++){let I=Math.floor(b/2);b%2===0?(u(C[x][I+1]),u(C[x+1][I]),u(C[x][I])):(u(C[x][I+1]),u(C[x+1][I+1]),u(C[x+1][I]))}}function c(m){let v=new U;for(let y=0;y<s.length;y+=3)v.x=s[y+0],v.y=s[y+1],v.z=s[y+2],v.normalize().multiplyScalar(m),s[y+0]=v.x,s[y+1]=v.y,s[y+2]=v.z}function d(){let m=new U;for(let v=0;v<s.length;v+=3){m.x=s[v+0],m.y=s[v+1],m.z=s[v+2];let y=_(m)/2/Math.PI+.5,A=h(m)/Math.PI+.5;o.push(y,1-A)}g(),f()}function f(){for(let m=0;m<o.length;m+=6){let v=o[m+0],y=o[m+2],A=o[m+4],E=Math.max(v,y,A),C=Math.min(v,y,A);E>.9&&C<.1&&(v<.2&&(o[m+0]+=1),y<.2&&(o[m+2]+=1),A<.2&&(o[m+4]+=1))}}function u(m){s.push(m.x,m.y,m.z)}function p(m,v){let y=m*3;v.x=e[y+0],v.y=e[y+1],v.z=e[y+2]}function g(){let m=new U,v=new U,y=new U,A=new U,E=new Te,C=new Te,x=new Te;for(let b=0,I=0;b<s.length;b+=9,I+=6){m.set(s[b+0],s[b+1],s[b+2]),v.set(s[b+3],s[b+4],s[b+5]),y.set(s[b+6],s[b+7],s[b+8]),E.set(o[I+0],o[I+1]),C.set(o[I+2],o[I+3]),x.set(o[I+4],o[I+5]),A.copy(m).add(v).add(y).divideScalar(3);let L=_(A);M(E,I+0,m,L),M(C,I+2,v,L),M(x,I+4,y,L)}}function M(m,v,y,A){A<0&&m.x===1&&(o[v]=m.x-1),y.x===0&&y.z===0&&(o[v]=A/2/Math.PI+.5)}function _(m){return Math.atan2(m.z,-m.x)}function h(m){return Math.atan2(-m.y,Math.sqrt(m.x*m.x+m.z*m.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.vertices,e.indices,e.radius,e.detail)}};var xu=new U,yu=new U,sm=new U,Su=new Zi,Qa=class extends qt{constructor(e=null,n=1){if(super(),this.type="EdgesGeometry",this.parameters={geometry:e,thresholdAngle:n},e!==null){let r=Math.pow(10,4),s=Math.cos(po*n),o=e.getIndex(),a=e.getAttribute("position"),l=o?o.count:a.count,c=[0,0,0],d=["a","b","c"],f=new Array(3),u={},p=[];for(let g=0;g<l;g+=3){o?(c[0]=o.getX(g),c[1]=o.getX(g+1),c[2]=o.getX(g+2)):(c[0]=g,c[1]=g+1,c[2]=g+2);let{a:M,b:_,c:h}=Su;if(M.fromBufferAttribute(a,c[0]),_.fromBufferAttribute(a,c[1]),h.fromBufferAttribute(a,c[2]),Su.getNormal(sm),f[0]=`${Math.round(M.x*r)},${Math.round(M.y*r)},${Math.round(M.z*r)}`,f[1]=`${Math.round(_.x*r)},${Math.round(_.y*r)},${Math.round(_.z*r)}`,f[2]=`${Math.round(h.x*r)},${Math.round(h.y*r)},${Math.round(h.z*r)}`,!(f[0]===f[1]||f[1]===f[2]||f[2]===f[0]))for(let m=0;m<3;m++){let v=(m+1)%3,y=f[m],A=f[v],E=Su[d[m]],C=Su[d[v]],x=`${y}_${A}`,b=`${A}_${y}`;b in u&&u[b]?(sm.dot(u[b].normal)<=s&&(p.push(E.x,E.y,E.z),p.push(C.x,C.y,C.z)),u[b]=null):x in u||(u[x]={index0:c[m],index1:c[v],normal:sm.clone()})}}for(let g in u)if(u[g]){let{index0:M,index1:_}=u[g];xu.fromBufferAttribute(a,M),yu.fromBufferAttribute(a,_),p.push(xu.x,xu.y,xu.z),p.push(yu.x,yu.y,yu.z)}this.setAttribute("position",new pt(p,3))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}},Bn=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){Ge("Curve: .getPoint() not implemented.")}getPointAt(e,n){let i=this.getUtoTmapping(e);return this.getPoint(i,n)}getPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPoint(i/e));return n}getSpacedPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPointAt(i/e));return n}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let n=[],i,r=this.getPoint(0),s=0;n.push(0);for(let o=1;o<=e;o++)i=this.getPoint(o/e),s+=i.distanceTo(r),n.push(s),r=i;return this.cacheArcLengths=n,n}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,n=null){let i=this.getLengths(),r=0,s=i.length,o;n?o=n:o=e*i[s-1];let a=0,l=s-1,c;for(;a<=l;)if(r=Math.floor(a+(l-a)/2),c=i[r]-o,c<0)a=r+1;else if(c>0)l=r-1;else{l=r;break}if(r=l,i[r]===o)return r/(s-1);let d=i[r],u=i[r+1]-d,p=(o-d)/u;return(r+p)/(s-1)}getTangent(e,n){let r=e-1e-4,s=e+1e-4;r<0&&(r=0),s>1&&(s=1);let o=this.getPoint(r),a=this.getPoint(s),l=n||(o.isVector2?new Te:new U);return l.copy(a).sub(o).normalize(),l}getTangentAt(e,n){let i=this.getUtoTmapping(e);return this.getTangent(i,n)}computeFrenetFrames(e,n=!1){let i=new U,r=[],s=[],o=[],a=new U,l=new Mt;for(let p=0;p<=e;p++){let g=p/e;r[p]=this.getTangentAt(g,new U)}s[0]=new U,o[0]=new U;let c=Number.MAX_VALUE,d=Math.abs(r[0].x),f=Math.abs(r[0].y),u=Math.abs(r[0].z);d<=c&&(c=d,i.set(1,0,0)),f<=c&&(c=f,i.set(0,1,0)),u<=c&&i.set(0,0,1),a.crossVectors(r[0],i).normalize(),s[0].crossVectors(r[0],a),o[0].crossVectors(r[0],s[0]);for(let p=1;p<=e;p++){if(s[p]=s[p-1].clone(),o[p]=o[p-1].clone(),a.crossVectors(r[p-1],r[p]),a.length()>Number.EPSILON){a.normalize();let g=Math.acos(et(r[p-1].dot(r[p]),-1,1));s[p].applyMatrix4(l.makeRotationAxis(a,g))}o[p].crossVectors(r[p],s[p])}if(n===!0){let p=Math.acos(et(s[0].dot(s[e]),-1,1));p/=e,r[0].dot(a.crossVectors(s[0],s[e]))>0&&(p=-p);for(let g=1;g<=e;g++)s[g].applyMatrix4(l.makeRotationAxis(r[g],p*g)),o[g].crossVectors(r[g],s[g])}return{tangents:r,normals:s,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},Co=class extends Bn{constructor(e=0,n=0,i=1,r=1,s=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=n,this.xRadius=i,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(e,n=new Te){let i=n,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,o=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(o?s=0:s=r),this.aClockwise===!0&&!o&&(s===r?s=-r:s=s-r);let a=this.aStartAngle+e*s,l=this.aX+this.xRadius*Math.cos(a),c=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let d=Math.cos(this.aRotation),f=Math.sin(this.aRotation),u=l-this.aX,p=c-this.aY;l=u*d-p*f+this.aX,c=u*f+p*d+this.aY}return i.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},$u=class extends Co{constructor(e,n,i,r,s,o){super(e,n,i,i,r,s,o),this.isArcCurve=!0,this.type="ArcCurve"}};function $m(){let t=0,e=0,n=0,i=0;function r(s,o,a,l){t=s,e=a,n=-3*s+3*o-2*a-l,i=2*s-2*o+a+l}return{initCatmullRom:function(s,o,a,l,c){r(o,a,c*(a-s),c*(l-o))},initNonuniformCatmullRom:function(s,o,a,l,c,d,f){let u=(o-s)/c-(a-s)/(c+d)+(a-o)/d,p=(a-o)/d-(l-o)/(d+f)+(l-a)/f;u*=d,p*=d,r(o,a,u,p)},calc:function(s){let o=s*s,a=o*s;return t+e*s+n*o+i*a}}}var Px=new U,Ix=new U,om=new $m,am=new $m,lm=new $m,Ju=class extends Bn{constructor(e=[],n=!1,i="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=n,this.curveType=i,this.tension=r}getPoint(e,n=new U){let i=n,r=this.points,s=r.length,o=(s-(this.closed?0:1))*e,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/s)+1)*s:l===0&&a===s-1&&(a=s-2,l=1);let c,d;this.closed||a>0?c=r[(a-1)%s]:(Ix.subVectors(r[0],r[1]).add(r[0]),c=Ix);let f=r[a%s],u=r[(a+1)%s];if(this.closed||a+2<s?d=r[(a+2)%s]:(Px.subVectors(r[s-1],r[s-2]).add(r[s-1]),d=Px),this.curveType==="centripetal"||this.curveType==="chordal"){let p=this.curveType==="chordal"?.5:.25,g=Math.pow(c.distanceToSquared(f),p),M=Math.pow(f.distanceToSquared(u),p),_=Math.pow(u.distanceToSquared(d),p);M<1e-4&&(M=1),g<1e-4&&(g=M),_<1e-4&&(_=M),om.initNonuniformCatmullRom(c.x,f.x,u.x,d.x,g,M,_),am.initNonuniformCatmullRom(c.y,f.y,u.y,d.y,g,M,_),lm.initNonuniformCatmullRom(c.z,f.z,u.z,d.z,g,M,_)}else this.curveType==="catmullrom"&&(om.initCatmullRom(c.x,f.x,u.x,d.x,this.tension),am.initCatmullRom(c.y,f.y,u.y,d.y,this.tension),lm.initCatmullRom(c.z,f.z,u.z,d.z,this.tension));return i.set(om.calc(l),am.calc(l),lm.calc(l)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new U().fromArray(r))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function Lx(t,e,n,i,r){let s=(i-e)*.5,o=(r-n)*.5,a=t*t,l=t*a;return(2*n-2*i+s+o)*l+(-3*n+3*i-2*s-o)*a+s*t+n}function bw(t,e){let n=1-t;return n*n*e}function Aw(t,e){return 2*(1-t)*t*e}function Cw(t,e){return t*t*e}function Ba(t,e,n,i){return bw(t,e)+Aw(t,n)+Cw(t,i)}function Rw(t,e){let n=1-t;return n*n*n*e}function Pw(t,e){let n=1-t;return 3*n*n*t*e}function Iw(t,e){return 3*(1-t)*t*t*e}function Lw(t,e){return t*t*t*e}function ka(t,e,n,i,r){return Rw(t,e)+Pw(t,n)+Iw(t,i)+Lw(t,r)}var el=class extends Bn{constructor(e=new Te,n=new Te,i=new Te,r=new Te){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new Te){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(ka(e,r.x,s.x,o.x,a.x),ka(e,r.y,s.y,o.y,a.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Ku=class extends Bn{constructor(e=new U,n=new U,i=new U,r=new U){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new U){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(ka(e,r.x,s.x,o.x,a.x),ka(e,r.y,s.y,o.y,a.y),ka(e,r.z,s.z,o.z,a.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},tl=class extends Bn{constructor(e=new Te,n=new Te){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=n}getPoint(e,n=new Te){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new Te){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},ju=class extends Bn{constructor(e=new U,n=new U){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=n}getPoint(e,n=new U){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new U){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},nl=class extends Bn{constructor(e=new Te,n=new Te,i=new Te){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new Te){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(Ba(e,r.x,s.x,o.x),Ba(e,r.y,s.y,o.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Qu=class extends Bn{constructor(e=new U,n=new U,i=new U){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new U){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(Ba(e,r.x,s.x,o.x),Ba(e,r.y,s.y,o.y),Ba(e,r.z,s.z,o.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},il=class extends Bn{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,n=new Te){let i=n,r=this.points,s=(r.length-1)*e,o=Math.floor(s),a=s-o,l=r[o===0?o:o-1],c=r[o],d=r[o>r.length-2?r.length-1:o+1],f=r[o>r.length-3?r.length-1:o+2];return i.set(Lx(a,l.x,c.x,d.x,f.x),Lx(a,l.y,c.y,d.y,f.y)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new Te().fromArray(r))}return this}},gm=Object.freeze({__proto__:null,ArcCurve:$u,CatmullRomCurve3:Ju,CubicBezierCurve:el,CubicBezierCurve3:Ku,EllipseCurve:Co,LineCurve:tl,LineCurve3:ju,QuadraticBezierCurve:nl,QuadraticBezierCurve3:Qu,SplineCurve:il}),eh=class extends Bn{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),n=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(n)){let i=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new gm[i](n,e))}return this}getPoint(e,n){let i=e*this.getLength(),r=this.getCurveLengths(),s=0;for(;s<r.length;){if(r[s]>=i){let o=r[s]-i,a=this.curves[s],l=a.getLength(),c=l===0?0:1-o/l;return a.getPointAt(c,n)}s++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],n=0;for(let i=0,r=this.curves.length;i<r;i++)n+=this.curves[i].getLength(),e.push(n);return this.cacheLengths=e,e}getSpacedPoints(e=40){let n=[];for(let i=0;i<=e;i++)n.push(this.getPoint(i/e));return this.autoClose&&n.push(n[0]),n}getPoints(e=12){let n=[],i;for(let r=0,s=this.curves;r<s.length;r++){let o=s[r],a=o.isEllipseCurve?e*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?e*o.points.length:e,l=o.getPoints(a);for(let c=0;c<l.length;c++){let d=l[c];i&&i.equals(d)||(n.push(d),i=d)}}return this.autoClose&&n.length>1&&!n[n.length-1].equals(n[0])&&n.push(n[0]),n}copy(e){super.copy(e),this.curves=[];for(let n=0,i=e.curves.length;n<i;n++){let r=e.curves[n];this.curves.push(r.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let n=0,i=this.curves.length;n<i;n++){let r=this.curves[n];e.curves.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let n=0,i=e.curves.length;n<i;n++){let r=e.curves[n];this.curves.push(new gm[r.type]().fromJSON(r))}return this}},rl=class extends eh{constructor(e){super(),this.type="Path",this.currentPoint=new Te,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let n=1,i=e.length;n<i;n++)this.lineTo(e[n].x,e[n].y);return this}moveTo(e,n){return this.currentPoint.set(e,n),this}lineTo(e,n){let i=new tl(this.currentPoint.clone(),new Te(e,n));return this.curves.push(i),this.currentPoint.set(e,n),this}quadraticCurveTo(e,n,i,r){let s=new nl(this.currentPoint.clone(),new Te(e,n),new Te(i,r));return this.curves.push(s),this.currentPoint.set(i,r),this}bezierCurveTo(e,n,i,r,s,o){let a=new el(this.currentPoint.clone(),new Te(e,n),new Te(i,r),new Te(s,o));return this.curves.push(a),this.currentPoint.set(s,o),this}splineThru(e){let n=[this.currentPoint.clone()].concat(e),i=new il(n);return this.curves.push(i),this.currentPoint.copy(e[e.length-1]),this}arc(e,n,i,r,s,o){let a=this.currentPoint.x,l=this.currentPoint.y;return this.absarc(e+a,n+l,i,r,s,o),this}absarc(e,n,i,r,s,o){return this.absellipse(e,n,i,i,r,s,o),this}ellipse(e,n,i,r,s,o,a,l){let c=this.currentPoint.x,d=this.currentPoint.y;return this.absellipse(e+c,n+d,i,r,s,o,a,l),this}absellipse(e,n,i,r,s,o,a,l){let c=new Co(e,n,i,r,s,o,a,l);if(this.curves.length>0){let f=c.getPoint(0);f.equals(this.currentPoint)||this.lineTo(f.x,f.y)}this.curves.push(c);let d=c.getPoint(1);return this.currentPoint.copy(d),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}},Ro=class extends rl{constructor(e){super(e),this.uuid=vs(),this.type="Shape",this.holes=[]}getPointsHoles(e){let n=[];for(let i=0,r=this.holes.length;i<r;i++)n[i]=this.holes[i].getPoints(e);return n}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let n=0,i=e.holes.length;n<i;n++){let r=e.holes[n];this.holes.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let n=0,i=this.holes.length;n<i;n++){let r=this.holes[n];e.holes.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let n=0,i=e.holes.length;n<i;n++){let r=e.holes[n];this.holes.push(new rl().fromJSON(r))}return this}};function Nw(t,e,n=2){let i=e&&e.length,r=i?e[0]*n:t.length,s=by(t,0,r,n,!0),o=[];if(!s||s.next===s.prev)return o;let a,l,c;if(i&&(s=Bw(t,e,s,n)),t.length>80*n){a=t[0],l=t[1];let d=a,f=l;for(let u=n;u<r;u+=n){let p=t[u],g=t[u+1];p<a&&(a=p),g<l&&(l=g),p>d&&(d=p),g>f&&(f=g)}c=Math.max(d-a,f-l),c=c!==0?32767/c:0}return sl(s,o,n,a,l,c,0),o}function by(t,e,n,i,r){let s;if(r===$w(t,e,n,i)>0)for(let o=e;o<n;o+=i)s=Nx(o/i|0,t[o],t[o+1],s);else for(let o=n-i;o>=e;o-=i)s=Nx(o/i|0,t[o],t[o+1],s);return s&&Po(s,s.next)&&(al(s),s=s.next),s}function gs(t,e){if(!t)return t;e||(e=t);let n=t,i;do if(i=!1,!n.steiner&&(Po(n,n.next)||At(n.prev,n,n.next)===0)){if(al(n),n=e=n.prev,n===n.next)break;i=!0}else n=n.next;while(i||n!==e);return e}function sl(t,e,n,i,r,s,o){if(!t)return;!o&&s&&Hw(t,i,r,s);let a=t;for(;t.prev!==t.next;){let l=t.prev,c=t.next;if(s?Uw(t,i,r,s):Dw(t)){e.push(l.i,t.i,c.i),al(t),t=c.next,a=c.next;continue}if(t=c,t===a){o?o===1?(t=Fw(gs(t),e),sl(t,e,n,i,r,s,2)):o===2&&Ow(t,e,n,i,r,s):sl(gs(t),e,n,i,r,s,1);break}}}function Dw(t){let e=t.prev,n=t,i=t.next;if(At(e,n,i)>=0)return!1;let r=e.x,s=n.x,o=i.x,a=e.y,l=n.y,c=i.y,d=Math.min(r,s,o),f=Math.min(a,l,c),u=Math.max(r,s,o),p=Math.max(a,l,c),g=i.next;for(;g!==e;){if(g.x>=d&&g.x<=u&&g.y>=f&&g.y<=p&&Fa(r,a,s,l,o,c,g.x,g.y)&&At(g.prev,g,g.next)>=0)return!1;g=g.next}return!0}function Uw(t,e,n,i){let r=t.prev,s=t,o=t.next;if(At(r,s,o)>=0)return!1;let a=r.x,l=s.x,c=o.x,d=r.y,f=s.y,u=o.y,p=Math.min(a,l,c),g=Math.min(d,f,u),M=Math.max(a,l,c),_=Math.max(d,f,u),h=_m(p,g,e,n,i),m=_m(M,_,e,n,i),v=t.prevZ,y=t.nextZ;for(;v&&v.z>=h&&y&&y.z<=m;){if(v.x>=p&&v.x<=M&&v.y>=g&&v.y<=_&&v!==r&&v!==o&&Fa(a,d,l,f,c,u,v.x,v.y)&&At(v.prev,v,v.next)>=0||(v=v.prevZ,y.x>=p&&y.x<=M&&y.y>=g&&y.y<=_&&y!==r&&y!==o&&Fa(a,d,l,f,c,u,y.x,y.y)&&At(y.prev,y,y.next)>=0))return!1;y=y.nextZ}for(;v&&v.z>=h;){if(v.x>=p&&v.x<=M&&v.y>=g&&v.y<=_&&v!==r&&v!==o&&Fa(a,d,l,f,c,u,v.x,v.y)&&At(v.prev,v,v.next)>=0)return!1;v=v.prevZ}for(;y&&y.z<=m;){if(y.x>=p&&y.x<=M&&y.y>=g&&y.y<=_&&y!==r&&y!==o&&Fa(a,d,l,f,c,u,y.x,y.y)&&At(y.prev,y,y.next)>=0)return!1;y=y.nextZ}return!0}function Fw(t,e){let n=t;do{let i=n.prev,r=n.next.next;!Po(i,r)&&Cy(i,n,n.next,r)&&ol(i,r)&&ol(r,i)&&(e.push(i.i,n.i,r.i),al(n),al(n.next),n=t=r),n=n.next}while(n!==t);return gs(n)}function Ow(t,e,n,i,r,s){let o=t;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&qw(o,a)){let l=Ry(o,a);o=gs(o,o.next),l=gs(l,l.next),sl(o,e,n,i,r,s,0),sl(l,e,n,i,r,s,0);return}a=a.next}o=o.next}while(o!==t)}function Bw(t,e,n,i){let r=[];for(let s=0,o=e.length;s<o;s++){let a=e[s]*i,l=s<o-1?e[s+1]*i:t.length,c=by(t,a,l,i,!1);c===c.next&&(c.steiner=!0),r.push(Xw(c))}r.sort(kw);for(let s=0;s<r.length;s++)n=zw(r[s],n);return n}function kw(t,e){let n=t.x-e.x;if(n===0&&(n=t.y-e.y,n===0)){let i=(t.next.y-t.y)/(t.next.x-t.x),r=(e.next.y-e.y)/(e.next.x-e.x);n=i-r}return n}function zw(t,e){let n=Vw(t,e);if(!n)return e;let i=Ry(n,t);return gs(i,i.next),gs(n,n.next)}function Vw(t,e){let n=e,i=t.x,r=t.y,s=-1/0,o;if(Po(t,n))return n;do{if(Po(t,n.next))return n.next;if(r<=n.y&&r>=n.next.y&&n.next.y!==n.y){let f=n.x+(r-n.y)*(n.next.x-n.x)/(n.next.y-n.y);if(f<=i&&f>s&&(s=f,o=n.x<n.next.x?n:n.next,f===i))return o}n=n.next}while(n!==e);if(!o)return null;let a=o,l=o.x,c=o.y,d=1/0;n=o;do{if(i>=n.x&&n.x>=l&&i!==n.x&&Ay(r<c?i:s,r,l,c,r<c?s:i,r,n.x,n.y)){let f=Math.abs(r-n.y)/(i-n.x);ol(n,t)&&(f<d||f===d&&(n.x>o.x||n.x===o.x&&Gw(o,n)))&&(o=n,d=f)}n=n.next}while(n!==a);return o}function Gw(t,e){return At(t.prev,t,e.prev)<0&&At(e.next,t,t.next)<0}function Hw(t,e,n,i){let r=t;do r.z===0&&(r.z=_m(r.x,r.y,e,n,i)),r.prevZ=r.prev,r.nextZ=r.next,r=r.next;while(r!==t);r.prevZ.nextZ=null,r.prevZ=null,Ww(r)}function Ww(t){let e,n=1;do{let i=t,r;t=null;let s=null;for(e=0;i;){e++;let o=i,a=0;for(let c=0;c<n&&(a++,o=o.nextZ,!!o);c++);let l=n;for(;a>0||l>0&&o;)a!==0&&(l===0||!o||i.z<=o.z)?(r=i,i=i.nextZ,a--):(r=o,o=o.nextZ,l--),s?s.nextZ=r:t=r,r.prevZ=s,s=r;i=o}s.nextZ=null,n*=2}while(e>1);return t}function _m(t,e,n,i,r){return t=(t-n)*r|0,e=(e-i)*r|0,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,t|e<<1}function Xw(t){let e=t,n=t;do(e.x<n.x||e.x===n.x&&e.y<n.y)&&(n=e),e=e.next;while(e!==t);return n}function Ay(t,e,n,i,r,s,o,a){return(r-o)*(e-a)>=(t-o)*(s-a)&&(t-o)*(i-a)>=(n-o)*(e-a)&&(n-o)*(s-a)>=(r-o)*(i-a)}function Fa(t,e,n,i,r,s,o,a){return!(t===o&&e===a)&&Ay(t,e,n,i,r,s,o,a)}function qw(t,e){return t.next.i!==e.i&&t.prev.i!==e.i&&!Yw(t,e)&&(ol(t,e)&&ol(e,t)&&Zw(t,e)&&(At(t.prev,t,e.prev)||At(t,e.prev,e))||Po(t,e)&&At(t.prev,t,t.next)>0&&At(e.prev,e,e.next)>0)}function At(t,e,n){return(e.y-t.y)*(n.x-e.x)-(e.x-t.x)*(n.y-e.y)}function Po(t,e){return t.x===e.x&&t.y===e.y}function Cy(t,e,n,i){let r=wu(At(t,e,n)),s=wu(At(t,e,i)),o=wu(At(n,i,t)),a=wu(At(n,i,e));return!!(r!==s&&o!==a||r===0&&Mu(t,n,e)||s===0&&Mu(t,i,e)||o===0&&Mu(n,t,i)||a===0&&Mu(n,e,i))}function Mu(t,e,n){return e.x<=Math.max(t.x,n.x)&&e.x>=Math.min(t.x,n.x)&&e.y<=Math.max(t.y,n.y)&&e.y>=Math.min(t.y,n.y)}function wu(t){return t>0?1:t<0?-1:0}function Yw(t,e){let n=t;do{if(n.i!==t.i&&n.next.i!==t.i&&n.i!==e.i&&n.next.i!==e.i&&Cy(n,n.next,t,e))return!0;n=n.next}while(n!==t);return!1}function ol(t,e){return At(t.prev,t,t.next)<0?At(t,e,t.next)>=0&&At(t,t.prev,e)>=0:At(t,e,t.prev)<0||At(t,t.next,e)<0}function Zw(t,e){let n=t,i=!1,r=(t.x+e.x)/2,s=(t.y+e.y)/2;do n.y>s!=n.next.y>s&&n.next.y!==n.y&&r<(n.next.x-n.x)*(s-n.y)/(n.next.y-n.y)+n.x&&(i=!i),n=n.next;while(n!==t);return i}function Ry(t,e){let n=vm(t.i,t.x,t.y),i=vm(e.i,e.x,e.y),r=t.next,s=e.prev;return t.next=e,e.prev=t,n.next=r,r.prev=n,i.next=n,n.prev=i,s.next=i,i.prev=s,i}function Nx(t,e,n,i){let r=vm(t,e,n);return i?(r.next=i.next,r.prev=i,i.next.prev=r,i.next=r):(r.prev=r,r.next=r),r}function al(t){t.next.prev=t.prev,t.prev.next=t.next,t.prevZ&&(t.prevZ.nextZ=t.nextZ),t.nextZ&&(t.nextZ.prevZ=t.prevZ)}function vm(t,e,n){return{i:t,x:e,y:n,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function $w(t,e,n,i){let r=0;for(let s=e,o=n-i;s<n;s+=i)r+=(t[o]-t[s])*(t[s+1]+t[o+1]),o=s;return r}var xm=class{static triangulate(e,n,i=2){return Nw(e,n,i)}},ds=class t{static area(e){let n=e.length,i=0;for(let r=n-1,s=0;s<n;r=s++)i+=e[r].x*e[s].y-e[s].x*e[r].y;return i*.5}static isClockWise(e){return t.area(e)<0}static triangulateShape(e,n){let i=[],r=[],s=[];Dx(e),Ux(i,e);let o=e.length;n.forEach(Dx);for(let l=0;l<n.length;l++)r.push(o),o+=n[l].length,Ux(i,n[l]);let a=xm.triangulate(i,r);for(let l=0;l<a.length;l+=3)s.push(a.slice(l,l+3));return s}};function Dx(t){let e=t.length;e>2&&t[e-1].equals(t[0])&&t.pop()}function Ux(t,e){for(let n=0;n<e.length;n++)t.push(e[n].x),t.push(e[n].y)}var ll=class t extends qt{constructor(e=new Ro([new Te(.5,.5),new Te(-.5,.5),new Te(-.5,-.5),new Te(.5,-.5)]),n={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:e,options:n},e=Array.isArray(e)?e:[e];let i=this,r=[],s=[];for(let a=0,l=e.length;a<l;a++){let c=e[a];o(c)}this.setAttribute("position",new pt(r,3)),this.setAttribute("uv",new pt(s,2)),this.computeVertexNormals();function o(a){let l=[],c=n.curveSegments!==void 0?n.curveSegments:12,d=n.steps!==void 0?n.steps:1,f=n.depth!==void 0?n.depth:1,u=n.bevelEnabled!==void 0?n.bevelEnabled:!0,p=n.bevelThickness!==void 0?n.bevelThickness:.2,g=n.bevelSize!==void 0?n.bevelSize:p-.1,M=n.bevelOffset!==void 0?n.bevelOffset:0,_=n.bevelSegments!==void 0?n.bevelSegments:3,h=n.extrudePath,m=n.UVGenerator!==void 0?n.UVGenerator:Jw,v,y=!1,A,E,C,x;if(h){v=h.getSpacedPoints(d),y=!0,u=!1;let Y=h.isCatmullRomCurve3?h.closed:!1;A=h.computeFrenetFrames(d,Y),E=new U,C=new U,x=new U}u||(_=0,p=0,g=0,M=0);let b=a.extractPoints(c),I=b.shape,L=b.holes;if(!ds.isClockWise(I)){I=I.reverse();for(let Y=0,ee=L.length;Y<ee;Y++){let $=L[Y];ds.isClockWise($)&&(L[Y]=$.reverse())}}function B(Y){let $=10000000000000001e-36,ae=Y[0];for(let oe=1;oe<=Y.length;oe++){let Le=oe%Y.length,N=Y[Le],Ve=N.x-ae.x,Ue=N.y-ae.y,Xe=Ve*Ve+Ue*Ue,ge=Math.max(Math.abs(N.x),Math.abs(N.y),Math.abs(ae.x),Math.abs(ae.y)),st=$*ge*ge;if(Xe<=st){Y.splice(Le,1),oe--;continue}ae=N}}B(I),L.forEach(B);let G=L.length,D=I;for(let Y=0;Y<G;Y++){let ee=L[Y];I=I.concat(ee)}function O(Y,ee,$){return ee||He("ExtrudeGeometry: vec does not exist"),Y.clone().addScaledVector(ee,$)}let k=I.length;function q(Y,ee,$){let ae,oe,Le,N=Y.x-ee.x,Ve=Y.y-ee.y,Ue=$.x-Y.x,Xe=$.y-Y.y,ge=N*N+Ve*Ve,st=N*Xe-Ve*Ue;if(Math.abs(st)>Number.EPSILON){let T=Math.sqrt(ge),S=Math.sqrt(Ue*Ue+Xe*Xe),z=ee.x-Ve/T,ne=ee.y+N/T,se=$.x-Xe/S,_e=$.y+Ue/S,ye=((se-z)*Xe-(_e-ne)*Ue)/(N*Xe-Ve*Ue);ae=z+N*ye-Y.x,oe=ne+Ve*ye-Y.y;let Z=ae*ae+oe*oe;if(Z<=2)return new Te(ae,oe);Le=Math.sqrt(Z/2)}else{let T=!1;N>Number.EPSILON?Ue>Number.EPSILON&&(T=!0):N<-Number.EPSILON?Ue<-Number.EPSILON&&(T=!0):Math.sign(Ve)===Math.sign(Xe)&&(T=!0),T?(ae=-Ve,oe=N,Le=Math.sqrt(ge)):(ae=N,oe=Ve,Le=Math.sqrt(ge/2))}return new Te(ae/Le,oe/Le)}let J=[];for(let Y=0,ee=D.length,$=ee-1,ae=Y+1;Y<ee;Y++,$++,ae++)$===ee&&($=0),ae===ee&&(ae=0),J[Y]=q(D[Y],D[$],D[ae]);let ce=[],he,Me=J.concat();for(let Y=0,ee=G;Y<ee;Y++){let $=L[Y];he=[];for(let ae=0,oe=$.length,Le=oe-1,N=ae+1;ae<oe;ae++,Le++,N++)Le===oe&&(Le=0),N===oe&&(N=0),he[ae]=q($[ae],$[Le],$[N]);ce.push(he),Me=Me.concat(he)}let Fe;if(_===0)Fe=ds.triangulateShape(D,L);else{let Y=[],ee=[];for(let $=0;$<_;$++){let ae=$/_,oe=p*Math.cos(ae*Math.PI/2),Le=g*Math.sin(ae*Math.PI/2)+M;for(let N=0,Ve=D.length;N<Ve;N++){let Ue=O(D[N],J[N],Le);Ce(Ue.x,Ue.y,-oe),ae===0&&Y.push(Ue)}for(let N=0,Ve=G;N<Ve;N++){let Ue=L[N];he=ce[N];let Xe=[];for(let ge=0,st=Ue.length;ge<st;ge++){let T=O(Ue[ge],he[ge],Le);Ce(T.x,T.y,-oe),ae===0&&Xe.push(T)}ae===0&&ee.push(Xe)}}Fe=ds.triangulateShape(Y,ee)}let Ze=Fe.length,Be=g+M;for(let Y=0;Y<k;Y++){let ee=u?O(I[Y],Me[Y],Be):I[Y];y?(C.copy(A.normals[0]).multiplyScalar(ee.x),E.copy(A.binormals[0]).multiplyScalar(ee.y),x.copy(v[0]).add(C).add(E),Ce(x.x,x.y,x.z)):Ce(ee.x,ee.y,0)}for(let Y=1;Y<=d;Y++)for(let ee=0;ee<k;ee++){let $=u?O(I[ee],Me[ee],Be):I[ee];y?(C.copy(A.normals[Y]).multiplyScalar($.x),E.copy(A.binormals[Y]).multiplyScalar($.y),x.copy(v[Y]).add(C).add(E),Ce(x.x,x.y,x.z)):Ce($.x,$.y,f/d*Y)}for(let Y=_-1;Y>=0;Y--){let ee=Y/_,$=p*Math.cos(ee*Math.PI/2),ae=g*Math.sin(ee*Math.PI/2)+M;for(let oe=0,Le=D.length;oe<Le;oe++){let N=O(D[oe],J[oe],ae);Ce(N.x,N.y,f+$)}for(let oe=0,Le=L.length;oe<Le;oe++){let N=L[oe];he=ce[oe];for(let Ve=0,Ue=N.length;Ve<Ue;Ve++){let Xe=O(N[Ve],he[Ve],ae);y?Ce(Xe.x,Xe.y+v[d-1].y,v[d-1].x+$):Ce(Xe.x,Xe.y,f+$)}}}K(),ve();function K(){let Y=r.length/3;if(u){let ee=0,$=k*ee;for(let ae=0;ae<Ze;ae++){let oe=Fe[ae];Q(oe[2]+$,oe[1]+$,oe[0]+$)}ee=d+_*2,$=k*ee;for(let ae=0;ae<Ze;ae++){let oe=Fe[ae];Q(oe[0]+$,oe[1]+$,oe[2]+$)}}else{for(let ee=0;ee<Ze;ee++){let $=Fe[ee];Q($[2],$[1],$[0])}for(let ee=0;ee<Ze;ee++){let $=Fe[ee];Q($[0]+k*d,$[1]+k*d,$[2]+k*d)}}i.addGroup(Y,r.length/3-Y,0)}function ve(){let Y=r.length/3,ee=0;pe(D,ee),ee+=D.length;for(let $=0,ae=L.length;$<ae;$++){let oe=L[$];pe(oe,ee),ee+=oe.length}i.addGroup(Y,r.length/3-Y,1)}function pe(Y,ee){let $=Y.length;for(;--$>=0;){let ae=$,oe=$-1;oe<0&&(oe=Y.length-1);for(let Le=0,N=d+_*2;Le<N;Le++){let Ve=k*Le,Ue=k*(Le+1),Xe=ee+ae+Ve,ge=ee+oe+Ve,st=ee+oe+Ue,T=ee+ae+Ue;re(Xe,ge,st,T)}}}function Ce(Y,ee,$){l.push(Y),l.push(ee),l.push($)}function Q(Y,ee,$){Se(Y),Se(ee),Se($);let ae=r.length/3,oe=m.generateTopUV(i,r,ae-3,ae-2,ae-1);we(oe[0]),we(oe[1]),we(oe[2])}function re(Y,ee,$,ae){Se(Y),Se(ee),Se(ae),Se(ee),Se($),Se(ae);let oe=r.length/3,Le=m.generateSideWallUV(i,r,oe-6,oe-3,oe-2,oe-1);we(Le[0]),we(Le[1]),we(Le[3]),we(Le[1]),we(Le[2]),we(Le[3])}function Se(Y){r.push(l[Y*3+0]),r.push(l[Y*3+1]),r.push(l[Y*3+2])}function we(Y){s.push(Y.x),s.push(Y.y)}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),n=this.parameters.shapes,i=this.parameters.options;return Kw(n,i,e)}static fromJSON(e,n){let i=[];for(let s=0,o=e.shapes.length;s<o;s++){let a=n[e.shapes[s]];i.push(a)}let r=e.options.extrudePath;return r!==void 0&&(e.options.extrudePath=new gm[r.type]().fromJSON(r)),new t(i,e.options)}},Jw={generateTopUV:function(t,e,n,i,r){let s=e[n*3],o=e[n*3+1],a=e[i*3],l=e[i*3+1],c=e[r*3],d=e[r*3+1];return[new Te(s,o),new Te(a,l),new Te(c,d)]},generateSideWallUV:function(t,e,n,i,r,s){let o=e[n*3],a=e[n*3+1],l=e[n*3+2],c=e[i*3],d=e[i*3+1],f=e[i*3+2],u=e[r*3],p=e[r*3+1],g=e[r*3+2],M=e[s*3],_=e[s*3+1],h=e[s*3+2];return Math.abs(a-d)<Math.abs(o-c)?[new Te(o,1-l),new Te(c,1-f),new Te(u,1-g),new Te(M,1-h)]:[new Te(a,1-l),new Te(d,1-f),new Te(p,1-g),new Te(_,1-h)]}};function Kw(t,e,n){if(n.shapes=[],Array.isArray(t))for(let i=0,r=t.length;i<r;i++){let s=t[i];n.shapes.push(s.uuid)}else n.shapes.push(t.uuid);return n.options=Object.assign({},e),e.extrudePath!==void 0&&(n.options.extrudePath=e.extrudePath.toJSON()),n}var Io=class t extends Zu{constructor(e=1,n=0){let i=(1+Math.sqrt(5))/2,r=[-1,i,0,1,i,0,-1,-i,0,1,-i,0,0,-1,i,0,1,i,0,-1,-i,0,1,-i,i,0,-1,i,0,1,-i,0,-1,-i,0,1],s=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(r,s,e,n),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:n}}static fromJSON(e){return new t(e.radius,e.detail)}};var Ur=class t extends qt{constructor(e=1,n=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:n,widthSegments:i,heightSegments:r};let s=e/2,o=n/2,a=Math.floor(i),l=Math.floor(r),c=a+1,d=l+1,f=e/a,u=n/l,p=[],g=[],M=[],_=[];for(let h=0;h<d;h++){let m=h*u-o;for(let v=0;v<c;v++){let y=v*f-s;g.push(y,-m,0),M.push(0,0,1),_.push(v/a),_.push(1-h/l)}}for(let h=0;h<l;h++)for(let m=0;m<a;m++){let v=m+c*h,y=m+c*(h+1),A=m+1+c*(h+1),E=m+1+c*h;p.push(v,y,E),p.push(y,A,E)}this.setIndex(p),this.setAttribute("position",new pt(g,3)),this.setAttribute("normal",new pt(M,3)),this.setAttribute("uv",new pt(_,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.widthSegments,e.heightSegments)}};function xs(t){let e={};for(let n in t){e[n]={};for(let i in t[n]){let r=t[n][i];if(Fx(r))r.isRenderTargetTexture?(Ge("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[n][i]=null):e[n][i]=r.clone();else if(Array.isArray(r))if(Fx(r[0])){let s=[];for(let o=0,a=r.length;o<a;o++)s[o]=r[o].clone();e[n][i]=s}else e[n][i]=r.slice();else e[n][i]=r}}return e}function hn(t){let e={};for(let n=0;n<t.length;n++){let i=xs(t[n]);for(let r in i)e[r]=i[r]}return e}function Fx(t){return t&&(t.isColor||t.isMatrix3||t.isMatrix4||t.isVector2||t.isVector3||t.isVector4||t.isTexture||t.isQuaternion)}function jw(t){let e=[];for(let n=0;n<t.length;n++)e.push(t[n].clone());return e}function Jm(t){let e=t.getRenderTarget();return e===null?t.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:it.workingColorSpace}var Py={clone:xs,merge:hn},Qw=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,eE=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,kn=class extends ji{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Qw,this.fragmentShader=eE,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=xs(e.uniforms),this.uniformsGroups=jw(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let n=super.toJSON(e);n.glslVersion=this.glslVersion,n.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?n.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?n.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?n.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?n.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?n.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?n.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?n.uniforms[r]={type:"m4",value:o.toArray()}:n.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}},th=class extends kn{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},Lo=class extends ji{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Ye(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ye(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=id,this.normalScale=new Te(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ki,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var nh=class extends ji{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=fy,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},ih=class extends ji{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function Eu(t,e){return!t||t.constructor===e?t:typeof e.BYTES_PER_ELEMENT=="number"?new e(t):Array.prototype.slice.call(t)}var Fr=class{constructor(e,n,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let n=this.parameterPositions,i=this._cachedIndex,r=n[i],s=n[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=n[++i],e<r)break t}o=n.length;break n}if(!(e>=s)){let a=n[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=n[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<n[a]?o=a:i=a+1}if(r=n[i],s=n[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let n=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)n[o]=i[s+o];return n}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},rh=class extends Fr{constructor(e,n,i,r){super(e,n,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:hm,endingEnd:hm}}intervalChanged_(e,n,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case dm:s=e,a=2*n-i;break;case fm:s=r.length-2,a=n+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case dm:o=e,l=2*i-n;break;case fm:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=n}let c=(i-n)*.5,d=this.valueSize;this._weightPrev=c/(n-a),this._weightNext=c/(l-i),this._offsetPrev=s*d,this._offsetNext=o*d}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this._offsetPrev,f=this._offsetNext,u=this._weightPrev,p=this._weightNext,g=(i-n)/(r-n),M=g*g,_=M*g,h=-u*_+2*u*M-u*g,m=(1+u)*_+(-1.5-2*u)*M+(-.5+u)*g+1,v=(-1-p)*_+(1.5+p)*M+.5*g,y=p*_-p*M;for(let A=0;A!==a;++A)s[A]=h*o[d+A]+m*o[c+A]+v*o[l+A]+y*o[f+A];return s}},sh=class extends Fr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=(i-n)/(r-n),f=1-d;for(let u=0;u!==a;++u)s[u]=o[c+u]*f+o[l+u]*d;return s}},oh=class extends Fr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},ah=class extends Fr{interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this.settings||this.DefaultSettings_,f=d.inTangents,u=d.outTangents;if(!f||!u){let M=(i-n)/(r-n),_=1-M;for(let h=0;h!==a;++h)s[h]=o[c+h]*_+o[l+h]*M;return s}let p=a*2,g=e-1;for(let M=0;M!==a;++M){let _=o[c+M],h=o[l+M],m=g*p+M*2,v=u[m],y=u[m+1],A=e*p+M*2,E=f[A],C=f[A+1],x=(i-n)/(r-n),b,I,L,P,B;for(let G=0;G<8;G++){b=x*x,I=b*x,L=1-x,P=L*L,B=P*L;let O=B*n+3*P*x*v+3*L*b*E+I*r-i;if(Math.abs(O)<1e-10)break;let k=3*P*(v-n)+6*L*x*(E-v)+3*b*(r-E);if(Math.abs(k)<1e-10)break;x=x-O/k,x=Math.max(0,Math.min(1,x))}s[M]=B*_+3*P*x*y+3*L*b*C+I*h}return s}},zn=class{constructor(e,n,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Eu(n,this.TimeBufferType),this.values=Eu(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let n=e.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(e);else{i={name:e.name,times:Eu(e.times,Array),values:Eu(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new oh(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new sh(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new rh(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let n=new ah(this.times,this.values,this.getValueSize(),e);return this.settings&&(n.settings=this.settings),n}setInterpolation(e){let n;switch(e){case za:n=this.InterpolantFactoryMethodDiscrete;break;case Bu:n=this.InterpolantFactoryMethodLinear;break;case Au:n=this.InterpolantFactoryMethodSmooth;break;case um:n=this.InterpolantFactoryMethodBezier;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return Ge("KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return za;case this.InterpolantFactoryMethodLinear:return Bu;case this.InterpolantFactoryMethodSmooth:return Au;case this.InterpolantFactoryMethodBezier:return um}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]+=e}return this}scale(e){if(e!==1){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]*=e}return this}trim(e,n){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>n;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(He("KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(He("KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){He("KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){He("KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&X1(r))for(let a=0,l=r.length;a!==l;++a){let c=r[a];if(isNaN(c)){He("KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===Au,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,c=e[a],d=e[a+1];if(c!==d&&(a!==1||c!==e[0]))if(r)l=!0;else{let f=a*i,u=f-i,p=f+i;for(let g=0;g!==i;++g){let M=n[f+g];if(M!==n[u+g]||M!==n[p+g]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let f=a*i,u=o*i;for(let p=0;p!==i;++p)n[u+p]=n[f+p]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,c=0;c!==i;++c)n[l+c]=n[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=n.slice(0,o*i)):(this.times=e,this.values=n),this}clone(){let e=this.times.slice(),n=this.values.slice(),i=this.constructor,r=new i(this.name,e,n);return r.createInterpolant=this.createInterpolant,r}};zn.prototype.ValueTypeName="";zn.prototype.TimeBufferType=Float32Array;zn.prototype.ValueBufferType=Float32Array;zn.prototype.DefaultInterpolation=Bu;var Or=class extends zn{constructor(e,n,i){super(e,n,i)}};Or.prototype.ValueTypeName="bool";Or.prototype.ValueBufferType=Array;Or.prototype.DefaultInterpolation=za;Or.prototype.InterpolantFactoryMethodLinear=void 0;Or.prototype.InterpolantFactoryMethodSmooth=void 0;var lh=class extends zn{constructor(e,n,i,r){super(e,n,i,r)}};lh.prototype.ValueTypeName="color";var ch=class extends zn{constructor(e,n,i,r){super(e,n,i,r)}};ch.prototype.ValueTypeName="number";var uh=class extends Fr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-n)/(r-n),c=e*a;for(let d=c+a;c!==d;c+=4)Ai.slerpFlat(s,0,o,c-a,o,c,l);return s}},cl=class extends zn{constructor(e,n,i,r){super(e,n,i,r)}InterpolantFactoryMethodLinear(e){return new uh(this.times,this.values,this.getValueSize(),e)}};cl.prototype.ValueTypeName="quaternion";cl.prototype.InterpolantFactoryMethodSmooth=void 0;var Br=class extends zn{constructor(e,n,i){super(e,n,i)}};Br.prototype.ValueTypeName="string";Br.prototype.ValueBufferType=Array;Br.prototype.DefaultInterpolation=za;Br.prototype.InterpolantFactoryMethodLinear=void 0;Br.prototype.InterpolantFactoryMethodSmooth=void 0;var hh=class extends zn{constructor(e,n,i,r){super(e,n,i,r)}};hh.prototype.ValueTypeName="vector";var dh=class{constructor(e,n,i){let r=this,s=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=n,this.onError=i,this._abortController=null,this.itemStart=function(d){a++,s===!1&&r.onStart!==void 0&&r.onStart(d,o,a),s=!0},this.itemEnd=function(d){o++,r.onProgress!==void 0&&r.onProgress(d,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(d){r.onError!==void 0&&r.onError(d)},this.resolveURL=function(d){return l?l(d):d},this.setURLModifier=function(d){return l=d,this},this.addHandler=function(d,f){return c.push(d,f),this},this.removeHandler=function(d){let f=c.indexOf(d);return f!==-1&&c.splice(f,2),this},this.getHandler=function(d){for(let f=0,u=c.length;f<u;f+=2){let p=c[f],g=c[f+1];if(p.global&&(p.lastIndex=0),p.test(d))return g}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Iy=new dh,fh=class{constructor(e){this.manager=e!==void 0?e:Iy,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,n){let i=this;return new Promise(function(r,s){i.load(e,r,n,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};fh.DEFAULT_MATERIAL_NAME="__DEFAULT";var ul=class extends Qt{constructor(e,n=1){super(),this.isLight=!0,this.type="Light",this.color=new Ye(e),this.intensity=n}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,n){return super.copy(e,n),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let n=super.toJSON(e);return n.object.color=this.color.getHex(),n.object.intensity=this.intensity,n}},hl=class extends ul{constructor(e,n,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Qt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ye(n)}copy(e,n){return super.copy(e,n),this.groundColor.copy(e.groundColor),this}toJSON(e){let n=super.toJSON(e);return n.object.groundColor=this.groundColor.getHex(),n}},cm=new Mt,Ox=new U,Bx=new U,ym=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Te(512,512),this.mapType=Tn,this.map=null,this.mapPass=null,this.matrix=new Mt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Eo,this._frameExtents=new Te(1,1),this._viewportCount=1,this._viewports=[new Ct(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let n=this.camera,i=this.matrix;Ox.setFromMatrixPosition(e.matrixWorld),n.position.copy(Ox),Bx.setFromMatrixPosition(e.target.matrixWorld),n.lookAt(Bx),n.updateMatrixWorld(),cm.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(cm,n.coordinateSystem,n.reversedDepth),n.coordinateSystem===_o||n.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(cm)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},Tu=new U,bu=new Ai,wi=new U,dl=class extends Qt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Mt,this.projectionMatrix=new Mt,this.projectionMatrixInverse=new Mt,this.coordinateSystem=hi,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,n){return super.copy(e,n),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(Tu,bu,wi),wi.x===1&&wi.y===1&&wi.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Tu,bu,wi.set(1,1,1)).invert()}updateWorldMatrix(e,n){super.updateWorldMatrix(e,n),this.matrixWorld.decompose(Tu,bu,wi),wi.x===1&&wi.y===1&&wi.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Tu,bu,wi.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Ir=new U,kx=new Te,zx=new Te,En=class extends dl{constructor(e=50,n=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let n=.5*this.getFilmHeight()/e;this.fov=xo*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(po*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return xo*2*Math.atan(Math.tan(po*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,n,i){Ir.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Ir.x,Ir.y).multiplyScalar(-e/Ir.z),Ir.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Ir.x,Ir.y).multiplyScalar(-e/Ir.z)}getViewSize(e,n){return this.getViewBounds(e,kx,zx),n.subVectors(zx,kx)}setViewOffset(e,n,i,r,s,o){this.aspect=e/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,n=e*Math.tan(po*.5*this.fov)/this.zoom,i=2*n,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,n-=o.offsetY*i/c,r*=o.width/l,i*=o.height/c}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,n,n-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}};var kr=class extends dl{constructor(e=-1,n=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=n,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,n,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+n,l=r-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,d=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=d*this.view.offsetY,l=a-d*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}},Sm=class extends ym{constructor(){super(new kr(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},fl=class extends ul{constructor(e,n){super(e,n),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Qt.DEFAULT_UP),this.updateMatrix(),this.target=new Qt,this.shadow=new Sm}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let n=super.toJSON(e);return n.object.shadow=this.shadow.toJSON(),n.object.target=this.target.uuid,n}};var uo=-90,ho=1,ph=class extends Qt{constructor(e,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new En(uo,ho,e,n);r.layers=this.layers,this.add(r);let s=new En(uo,ho,e,n);s.layers=this.layers,this.add(s);let o=new En(uo,ho,e,n);o.layers=this.layers,this.add(o);let a=new En(uo,ho,e,n);a.layers=this.layers,this.add(a);let l=new En(uo,ho,e,n);l.layers=this.layers,this.add(l);let c=new En(uo,ho,e,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,n=this.children.concat(),[i,r,s,o,a,l]=n;for(let c of n)this.remove(c);if(e===hi)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===_o)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of n)this.add(c),c.updateMatrixWorld()}update(e,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,c,d]=this.children,f=e.getRenderTarget(),u=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;let M=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let _=!1;e.isWebGLRenderer===!0?_=e.state.buffers.depth.getReversed():_=e.reversedDepthBuffer,e.setRenderTarget(i,0,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,s),e.setRenderTarget(i,1,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,o),e.setRenderTarget(i,2,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,a),e.setRenderTarget(i,3,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,l),e.setRenderTarget(i,4,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,c),i.texture.generateMipmaps=M,e.setRenderTarget(i,5,r),_&&e.autoClear===!1&&e.clearDepth(),e.render(n,d),e.setRenderTarget(f,u,p),e.xr.enabled=g,i.texture.needsPMREMUpdate=!0}},mh=class extends En{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Km="\\[\\]\\.:\\/",tE=new RegExp("["+Km+"]","g"),jm="[^"+Km+"]",nE="[^"+Km.replace("\\.","")+"]",iE=/((?:WC+[\/:])*)/.source.replace("WC",jm),rE=/(WCOD+)?/.source.replace("WCOD",nE),sE=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",jm),oE=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",jm),aE=new RegExp("^"+iE+rE+sE+oE+"$"),lE=["material","materials","bones","map"],Mm=class{constructor(e,n,i){let r=i||St.parseTrackName(n);this._targetGroup=e,this._bindings=e.subscribe_(n,r)}getValue(e,n){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,n)}setValue(e,n){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,n)}bind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].bind()}unbind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].unbind()}},St=class t{constructor(e,n,i){this.path=n,this.parsedPath=i||t.parseTrackName(n),this.node=t.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,n,i){return e&&e.isAnimationObjectGroup?new t.Composite(e,n,i):new t(e,n,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(tE,"")}static parseTrackName(e){let n=aE.exec(e);if(n===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);lE.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,n){if(n===void 0||n===""||n==="."||n===-1||n===e.name||n===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(n);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===n||a.uuid===n)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,n){e[n]=this.targetObject[this.propertyName]}_getValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[n++]=i[r]}_getValue_arrayElement(e,n){e[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,n){this.resolvedProperty.toArray(e,n)}_setValue_direct(e,n){this.targetObject[this.propertyName]=e[n]}_setValue_direct_setNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++]}_setValue_array_setNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,n){this.resolvedProperty[this.propertyIndex]=e[n]}_setValue_arrayElement_setNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,n){this.resolvedProperty.fromArray(e,n)}_setValue_fromArray_setNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,n){this.bind(),this.getValue(e,n)}_setValue_unbound(e,n){this.bind(),this.setValue(e,n)}bind(){let e=this.node,n=this.parsedPath,i=n.objectName,r=n.propertyName,s=n.propertyIndex;if(e||(e=t.findNode(this.rootNode,n.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Ge("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!e.material){He("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){He("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){He("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let d=0;d<e.length;d++)if(e[d].name===c){c=d;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){He("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){He("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){He("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){He("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[r];if(o===void 0){let c=n.nodeName;He("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){He("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){He("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};St.Composite=Mm;St.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};St.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};St.prototype.GetterByBindingType=[St.prototype._getValue_direct,St.prototype._getValue_array,St.prototype._getValue_arrayElement,St.prototype._getValue_toArray];St.prototype.SetterByBindingTypeAndVersioning=[[St.prototype._setValue_direct,St.prototype._setValue_direct_setNeedsUpdate,St.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[St.prototype._setValue_array,St.prototype._setValue_array_setNeedsUpdate,St.prototype._setValue_array_setMatrixWorldNeedsUpdate],[St.prototype._setValue_arrayElement,St.prototype._setValue_arrayElement_setNeedsUpdate,St.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[St.prototype._setValue_fromArray,St.prototype._setValue_fromArray_setNeedsUpdate,St.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var SR=new Float32Array(1);var Vx=new Mt,pl=class{constructor(e,n,i=0,r=1/0){this.ray=new wo(e,n),this.near=i,this.far=r,this.camera=null,this.layers=new So,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,n){this.ray.set(e,n)}setFromCamera(e,n){n.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(n.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(n).sub(this.ray.origin).normalize(),this.camera=n):n.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(n.near+n.far)/(n.near-n.far)).unproject(n),this.ray.direction.set(0,0,-1).transformDirection(n.matrixWorld),this.camera=n):He("Raycaster: Unsupported camera type: "+n.type)}setFromXRController(e){return Vx.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Vx),this}intersectObject(e,n=!0,i=[]){return wm(e,this,i,n),i.sort(Gx),i}intersectObjects(e,n=!0,i=[]){for(let r=0,s=e.length;r<s;r++)wm(e[r],this,i,n);return i.sort(Gx),i}};function Gx(t,e){return t.distance-e.distance}function wm(t,e,n,i){let r=!0;if(t.layers.test(e.layers)&&t.raycast(e,n)===!1&&(r=!1),r===!0&&i===!0){let s=t.children;for(let o=0,a=s.length;o<a;o++)wm(s[o],e,n,!0)}}var rg=class rg{constructor(e,n,i,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,n,i,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,n=0){for(let i=0;i<4;i++)this.elements[i]=e[i+n];return this}set(e,n,i,r){let s=this.elements;return s[0]=e,s[2]=n,s[1]=i,s[3]=r,this}};rg.prototype.isMatrix2=!0;var Em=rg;function Qm(t,e,n,i){let r=cE(i);switch(n){case Gm:return t*e;case Wm:return t*e/r.components*r.byteLength;case Eh:return t*e/r.components*r.byteLength;case Hr:return t*e*2/r.components*r.byteLength;case Th:return t*e*2/r.components*r.byteLength;case Hm:return t*e*3/r.components*r.byteLength;case Qn:return t*e*4/r.components*r.byteLength;case bh:return t*e*4/r.components*r.byteLength;case vl:case xl:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case yl:case Sl:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Ch:case Ph:return Math.max(t,16)*Math.max(e,8)/4;case Ah:case Rh:return Math.max(t,8)*Math.max(e,8)/2;case Ih:case Lh:case Dh:case Uh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case Nh:case Ml:case Fh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Oh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Bh:return Math.floor((t+4)/5)*Math.floor((e+3)/4)*16;case kh:return Math.floor((t+4)/5)*Math.floor((e+4)/5)*16;case zh:return Math.floor((t+5)/6)*Math.floor((e+4)/5)*16;case Vh:return Math.floor((t+5)/6)*Math.floor((e+5)/6)*16;case Gh:return Math.floor((t+7)/8)*Math.floor((e+4)/5)*16;case Hh:return Math.floor((t+7)/8)*Math.floor((e+5)/6)*16;case Wh:return Math.floor((t+7)/8)*Math.floor((e+7)/8)*16;case Xh:return Math.floor((t+9)/10)*Math.floor((e+4)/5)*16;case qh:return Math.floor((t+9)/10)*Math.floor((e+5)/6)*16;case Yh:return Math.floor((t+9)/10)*Math.floor((e+7)/8)*16;case Zh:return Math.floor((t+9)/10)*Math.floor((e+9)/10)*16;case $h:return Math.floor((t+11)/12)*Math.floor((e+9)/10)*16;case Jh:return Math.floor((t+11)/12)*Math.floor((e+11)/12)*16;case Kh:case jh:case Qh:return Math.ceil(t/4)*Math.ceil(e/4)*16;case ed:case td:return Math.ceil(t/4)*Math.ceil(e/4)*8;case wl:case nd:return Math.ceil(t/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function cE(t){switch(t){case Tn:case Bm:return{byteLength:1,components:1};case Do:case km:case Ri:return{byteLength:2,components:1};case Mh:case wh:return{byteLength:2,components:4};case fi:case Sh:case pi:return{byteLength:4,components:1};case zm:case Vm:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${t}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:_h}}));typeof window<"u"&&(window.__THREE__?Ge("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=_h);function eS(){let t=null,e=!1,n=null,i=null;function r(s,o){n(s,o),i=t.requestAnimationFrame(r)}return{start:function(){e!==!0&&n!==null&&t!==null&&(i=t.requestAnimationFrame(r),e=!0)},stop:function(){t!==null&&t.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){n=s},setContext:function(s){t=s}}}function uE(t){let e=new WeakMap;function n(a,l){let c=a.array,d=a.usage,f=c.byteLength,u=t.createBuffer();t.bindBuffer(l,u),t.bufferData(l,c,d),a.onUploadCallback();let p;if(c instanceof Float32Array)p=t.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)p=t.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?p=t.HALF_FLOAT:p=t.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=t.SHORT;else if(c instanceof Uint32Array)p=t.UNSIGNED_INT;else if(c instanceof Int32Array)p=t.INT;else if(c instanceof Int8Array)p=t.BYTE;else if(c instanceof Uint8Array)p=t.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=t.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:u,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:f}}function i(a,l,c){let d=l.array,f=l.updateRanges;if(t.bindBuffer(c,a),f.length===0)t.bufferSubData(c,0,d);else{f.sort((p,g)=>p.start-g.start);let u=0;for(let p=1;p<f.length;p++){let g=f[u],M=f[p];M.start<=g.start+g.count+1?g.count=Math.max(g.count,M.start+M.count-g.start):(++u,f[u]=M)}f.length=u+1;for(let p=0,g=f.length;p<g;p++){let M=f[p];t.bufferSubData(c,M.start*d.BYTES_PER_ELEMENT,d,M.start,M.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(t.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let d=e.get(a);(!d||d.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=e.get(a);if(c===void 0)e.set(a,n(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}var hE=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,dE=`#ifdef USE_ALPHAHASH
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
#endif`,fE=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,pE=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,mE=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,gE=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,_E=`#ifdef USE_AOMAP
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
#endif`,vE=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,xE=`#ifdef USE_BATCHING
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
#endif`,yE=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,SE=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,ME=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,wE=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,EE=`#ifdef USE_IRIDESCENCE
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
#endif`,TE=`#ifdef USE_BUMPMAP
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
#endif`,bE=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,AE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,CE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,RE=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,PE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,IE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,LE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,NE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,DE=`#define PI 3.141592653589793
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
} // validated`,UE=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,FE=`vec3 transformedNormal = objectNormal;
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
#endif`,OE=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,BE=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,kE=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,zE=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,VE="gl_FragColor = linearToOutputTexel( gl_FragColor );",GE=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,HE=`#ifdef USE_ENVMAP
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
#endif`,WE=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,XE=`#ifdef USE_ENVMAP
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
#endif`,qE=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,YE=`#ifdef USE_ENVMAP
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
#endif`,ZE=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,$E=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,JE=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,KE=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,jE=`#ifdef USE_GRADIENTMAP
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
}`,QE=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,eT=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,tT=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,nT=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,iT=`#ifdef USE_ENVMAP
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
#endif`,rT=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,sT=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,oT=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,aT=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,lT=`PhysicalMaterial material;
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
#endif`,cT=`uniform sampler2D dfgLUT;
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
}`,uT=`
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
#endif`,hT=`#if defined( RE_IndirectDiffuse )
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
#endif`,dT=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,fT=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,pT=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,mT=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,gT=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,_T=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,vT=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,xT=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,yT=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,ST=`#if defined( USE_POINTS_UV )
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
#endif`,MT=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,wT=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,ET=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,TT=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,bT=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,AT=`#ifdef USE_MORPHTARGETS
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
#endif`,CT=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,RT=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,PT=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,IT=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,LT=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,NT=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,DT=`#ifdef USE_NORMALMAP
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
#endif`,UT=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,FT=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,OT=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,BT=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,kT=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,zT=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,VT=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,GT=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,HT=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,WT=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,XT=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,qT=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,YT=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,ZT=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,$T=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,JT=`float getShadowMask() {
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
}`,KT=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,jT=`#ifdef USE_SKINNING
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
#endif`,QT=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,eb=`#ifdef USE_SKINNING
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
#endif`,tb=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,nb=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,ib=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,rb=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,sb=`#ifdef USE_TRANSMISSION
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
#endif`,ob=`#ifdef USE_TRANSMISSION
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
#endif`,ab=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,lb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,cb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,ub=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,hb=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,db=`uniform sampler2D t2D;
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
}`,fb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,pb=`#ifdef ENVMAP_TYPE_CUBE
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
}`,mb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,gb=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,_b=`#include <common>
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
}`,vb=`#if DEPTH_PACKING == 3200
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
}`,xb=`#define DISTANCE
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
}`,yb=`#define DISTANCE
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
}`,Sb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Mb=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,wb=`uniform float scale;
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
}`,Eb=`uniform vec3 diffuse;
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
}`,Tb=`#include <common>
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
}`,bb=`uniform vec3 diffuse;
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
}`,Ab=`#define LAMBERT
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
}`,Cb=`#define LAMBERT
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
}`,Rb=`#define MATCAP
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
}`,Pb=`#define MATCAP
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
}`,Ib=`#define NORMAL
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
}`,Lb=`#define NORMAL
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
}`,Nb=`#define PHONG
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
}`,Db=`#define PHONG
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
}`,Ub=`#define STANDARD
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
}`,Fb=`#define STANDARD
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
}`,Ob=`#define TOON
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
}`,Bb=`#define TOON
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
}`,kb=`uniform float size;
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
}`,zb=`uniform vec3 diffuse;
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
}`,Vb=`#include <common>
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
}`,Gb=`uniform vec3 color;
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
}`,Hb=`uniform float rotation;
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
}`,Wb=`uniform vec3 diffuse;
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
}`,je={alphahash_fragment:hE,alphahash_pars_fragment:dE,alphamap_fragment:fE,alphamap_pars_fragment:pE,alphatest_fragment:mE,alphatest_pars_fragment:gE,aomap_fragment:_E,aomap_pars_fragment:vE,batching_pars_vertex:xE,batching_vertex:yE,begin_vertex:SE,beginnormal_vertex:ME,bsdfs:wE,iridescence_fragment:EE,bumpmap_pars_fragment:TE,clipping_planes_fragment:bE,clipping_planes_pars_fragment:AE,clipping_planes_pars_vertex:CE,clipping_planes_vertex:RE,color_fragment:PE,color_pars_fragment:IE,color_pars_vertex:LE,color_vertex:NE,common:DE,cube_uv_reflection_fragment:UE,defaultnormal_vertex:FE,displacementmap_pars_vertex:OE,displacementmap_vertex:BE,emissivemap_fragment:kE,emissivemap_pars_fragment:zE,colorspace_fragment:VE,colorspace_pars_fragment:GE,envmap_fragment:HE,envmap_common_pars_fragment:WE,envmap_pars_fragment:XE,envmap_pars_vertex:qE,envmap_physical_pars_fragment:iT,envmap_vertex:YE,fog_vertex:ZE,fog_pars_vertex:$E,fog_fragment:JE,fog_pars_fragment:KE,gradientmap_pars_fragment:jE,lightmap_pars_fragment:QE,lights_lambert_fragment:eT,lights_lambert_pars_fragment:tT,lights_pars_begin:nT,lights_toon_fragment:rT,lights_toon_pars_fragment:sT,lights_phong_fragment:oT,lights_phong_pars_fragment:aT,lights_physical_fragment:lT,lights_physical_pars_fragment:cT,lights_fragment_begin:uT,lights_fragment_maps:hT,lights_fragment_end:dT,lightprobes_pars_fragment:fT,logdepthbuf_fragment:pT,logdepthbuf_pars_fragment:mT,logdepthbuf_pars_vertex:gT,logdepthbuf_vertex:_T,map_fragment:vT,map_pars_fragment:xT,map_particle_fragment:yT,map_particle_pars_fragment:ST,metalnessmap_fragment:MT,metalnessmap_pars_fragment:wT,morphinstance_vertex:ET,morphcolor_vertex:TT,morphnormal_vertex:bT,morphtarget_pars_vertex:AT,morphtarget_vertex:CT,normal_fragment_begin:RT,normal_fragment_maps:PT,normal_pars_fragment:IT,normal_pars_vertex:LT,normal_vertex:NT,normalmap_pars_fragment:DT,clearcoat_normal_fragment_begin:UT,clearcoat_normal_fragment_maps:FT,clearcoat_pars_fragment:OT,iridescence_pars_fragment:BT,opaque_fragment:kT,packing:zT,premultiplied_alpha_fragment:VT,project_vertex:GT,dithering_fragment:HT,dithering_pars_fragment:WT,roughnessmap_fragment:XT,roughnessmap_pars_fragment:qT,shadowmap_pars_fragment:YT,shadowmap_pars_vertex:ZT,shadowmap_vertex:$T,shadowmask_pars_fragment:JT,skinbase_vertex:KT,skinning_pars_vertex:jT,skinning_vertex:QT,skinnormal_vertex:eb,specularmap_fragment:tb,specularmap_pars_fragment:nb,tonemapping_fragment:ib,tonemapping_pars_fragment:rb,transmission_fragment:sb,transmission_pars_fragment:ob,uv_pars_fragment:ab,uv_pars_vertex:lb,uv_vertex:cb,worldpos_vertex:ub,background_vert:hb,background_frag:db,backgroundCube_vert:fb,backgroundCube_frag:pb,cube_vert:mb,cube_frag:gb,depth_vert:_b,depth_frag:vb,distance_vert:xb,distance_frag:yb,equirect_vert:Sb,equirect_frag:Mb,linedashed_vert:wb,linedashed_frag:Eb,meshbasic_vert:Tb,meshbasic_frag:bb,meshlambert_vert:Ab,meshlambert_frag:Cb,meshmatcap_vert:Rb,meshmatcap_frag:Pb,meshnormal_vert:Ib,meshnormal_frag:Lb,meshphong_vert:Nb,meshphong_frag:Db,meshphysical_vert:Ub,meshphysical_frag:Fb,meshtoon_vert:Ob,meshtoon_frag:Bb,points_vert:kb,points_frag:zb,shadow_vert:Vb,shadow_frag:Gb,sprite_vert:Hb,sprite_frag:Wb},be={common:{diffuse:{value:new Ye(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Je},alphaMap:{value:null},alphaMapTransform:{value:new Je},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Je}},envmap:{envMap:{value:null},envMapRotation:{value:new Je},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Je}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Je}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Je},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Je},normalScale:{value:new Te(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Je},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Je}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Je}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Je}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ye(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new U},probesMax:{value:new U},probesResolution:{value:new U}},points:{diffuse:{value:new Ye(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Je},alphaTest:{value:0},uvTransform:{value:new Je}},sprite:{diffuse:{value:new Ye(16777215)},opacity:{value:1},center:{value:new Te(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Je},alphaMap:{value:null},alphaMapTransform:{value:new Je},alphaTest:{value:0}}},Ii={basic:{uniforms:hn([be.common,be.specularmap,be.envmap,be.aomap,be.lightmap,be.fog]),vertexShader:je.meshbasic_vert,fragmentShader:je.meshbasic_frag},lambert:{uniforms:hn([be.common,be.specularmap,be.envmap,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.fog,be.lights,{emissive:{value:new Ye(0)},envMapIntensity:{value:1}}]),vertexShader:je.meshlambert_vert,fragmentShader:je.meshlambert_frag},phong:{uniforms:hn([be.common,be.specularmap,be.envmap,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.fog,be.lights,{emissive:{value:new Ye(0)},specular:{value:new Ye(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:je.meshphong_vert,fragmentShader:je.meshphong_frag},standard:{uniforms:hn([be.common,be.envmap,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.roughnessmap,be.metalnessmap,be.fog,be.lights,{emissive:{value:new Ye(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:je.meshphysical_vert,fragmentShader:je.meshphysical_frag},toon:{uniforms:hn([be.common,be.aomap,be.lightmap,be.emissivemap,be.bumpmap,be.normalmap,be.displacementmap,be.gradientmap,be.fog,be.lights,{emissive:{value:new Ye(0)}}]),vertexShader:je.meshtoon_vert,fragmentShader:je.meshtoon_frag},matcap:{uniforms:hn([be.common,be.bumpmap,be.normalmap,be.displacementmap,be.fog,{matcap:{value:null}}]),vertexShader:je.meshmatcap_vert,fragmentShader:je.meshmatcap_frag},points:{uniforms:hn([be.points,be.fog]),vertexShader:je.points_vert,fragmentShader:je.points_frag},dashed:{uniforms:hn([be.common,be.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:je.linedashed_vert,fragmentShader:je.linedashed_frag},depth:{uniforms:hn([be.common,be.displacementmap]),vertexShader:je.depth_vert,fragmentShader:je.depth_frag},normal:{uniforms:hn([be.common,be.bumpmap,be.normalmap,be.displacementmap,{opacity:{value:1}}]),vertexShader:je.meshnormal_vert,fragmentShader:je.meshnormal_frag},sprite:{uniforms:hn([be.sprite,be.fog]),vertexShader:je.sprite_vert,fragmentShader:je.sprite_frag},background:{uniforms:{uvTransform:{value:new Je},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:je.background_vert,fragmentShader:je.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Je}},vertexShader:je.backgroundCube_vert,fragmentShader:je.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:je.cube_vert,fragmentShader:je.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:je.equirect_vert,fragmentShader:je.equirect_frag},distance:{uniforms:hn([be.common,be.displacementmap,{referencePosition:{value:new U},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:je.distance_vert,fragmentShader:je.distance_frag},shadow:{uniforms:hn([be.lights,be.fog,{color:{value:new Ye(0)},opacity:{value:1}}]),vertexShader:je.shadow_vert,fragmentShader:je.shadow_frag}};Ii.physical={uniforms:hn([Ii.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Je},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Je},clearcoatNormalScale:{value:new Te(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Je},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Je},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Je},sheen:{value:0},sheenColor:{value:new Ye(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Je},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Je},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Je},transmissionSamplerSize:{value:new Te},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Je},attenuationDistance:{value:0},attenuationColor:{value:new Ye(0)},specularColor:{value:new Ye(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Je},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Je},anisotropyVector:{value:new Te},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Je}}]),vertexShader:je.meshphysical_vert,fragmentShader:je.meshphysical_frag};var od={r:0,b:0,g:0},Xb=new Mt,tS=new Je;tS.set(-1,0,0,0,1,0,0,0,1);function qb(t,e,n,i,r,s){let o=new Ye(0),a=r===!0?0:1,l,c,d=null,f=0,u=null;function p(m){let v=m.isScene===!0?m.background:null;if(v&&v.isTexture){let y=m.backgroundBlurriness>0;v=e.get(v,y)}return v}function g(m){let v=!1,y=p(m);y===null?_(o,a):y&&y.isColor&&(_(y,1),v=!0);let A=t.xr.getEnvironmentBlendMode();A==="additive"?n.buffers.color.setClear(0,0,0,1,s):A==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,s),(t.autoClear||v)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),t.clear(t.autoClearColor,t.autoClearDepth,t.autoClearStencil))}function M(m,v){let y=p(v);y&&(y.isCubeTexture||y.mapping===gl)?(c===void 0&&(c=new en(new Dr(1,1,1),new kn({name:"BackgroundCubeMaterial",uniforms:xs(Ii.backgroundCube.uniforms),vertexShader:Ii.backgroundCube.vertexShader,fragmentShader:Ii.backgroundCube.fragmentShader,side:vn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(A,E,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(c)),c.material.uniforms.envMap.value=y,c.material.uniforms.backgroundBlurriness.value=v.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(Xb.makeRotationFromEuler(v.backgroundRotation)).transpose(),y.isCubeTexture&&y.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(tS),c.material.toneMapped=it.getTransfer(y.colorSpace)!==ct,(d!==y||f!==y.version||u!==t.toneMapping)&&(c.material.needsUpdate=!0,d=y,f=y.version,u=t.toneMapping),c.layers.enableAll(),m.unshift(c,c.geometry,c.material,0,0,null)):y&&y.isTexture&&(l===void 0&&(l=new en(new Ur(2,2),new kn({name:"BackgroundMaterial",uniforms:xs(Ii.background.uniforms),vertexShader:Ii.background.vertexShader,fragmentShader:Ii.background.fragmentShader,side:Ji,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=y,l.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,l.material.toneMapped=it.getTransfer(y.colorSpace)!==ct,y.matrixAutoUpdate===!0&&y.updateMatrix(),l.material.uniforms.uvTransform.value.copy(y.matrix),(d!==y||f!==y.version||u!==t.toneMapping)&&(l.material.needsUpdate=!0,d=y,f=y.version,u=t.toneMapping),l.layers.enableAll(),m.unshift(l,l.geometry,l.material,0,0,null))}function _(m,v){m.getRGB(od,Jm(t)),n.buffers.color.setClear(od.r,od.g,od.b,v,s)}function h(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(m,v=1){o.set(m),a=v,_(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(m){a=m,_(o,a)},render:g,addToRenderList:M,dispose:h}}function Yb(t,e){let n=t.getParameter(t.MAX_VERTEX_ATTRIBS),i={},r=u(null),s=r,o=!1;function a(L,P,B,G,D){let O=!1,k=f(L,G,B,P);s!==k&&(s=k,c(s.object)),O=p(L,G,B,D),O&&g(L,G,B,D),D!==null&&e.update(D,t.ELEMENT_ARRAY_BUFFER),(O||o)&&(o=!1,y(L,P,B,G),D!==null&&t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,e.get(D).buffer))}function l(){return t.createVertexArray()}function c(L){return t.bindVertexArray(L)}function d(L){return t.deleteVertexArray(L)}function f(L,P,B,G){let D=G.wireframe===!0,O=i[P.id];O===void 0&&(O={},i[P.id]=O);let k=L.isInstancedMesh===!0?L.id:0,q=O[k];q===void 0&&(q={},O[k]=q);let J=q[B.id];J===void 0&&(J={},q[B.id]=J);let ce=J[D];return ce===void 0&&(ce=u(l()),J[D]=ce),ce}function u(L){let P=[],B=[],G=[];for(let D=0;D<n;D++)P[D]=0,B[D]=0,G[D]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:P,enabledAttributes:B,attributeDivisors:G,object:L,attributes:{},index:null}}function p(L,P,B,G){let D=s.attributes,O=P.attributes,k=0,q=B.getAttributes();for(let J in q)if(q[J].location>=0){let he=D[J],Me=O[J];if(Me===void 0&&(J==="instanceMatrix"&&L.instanceMatrix&&(Me=L.instanceMatrix),J==="instanceColor"&&L.instanceColor&&(Me=L.instanceColor)),he===void 0||he.attribute!==Me||Me&&he.data!==Me.data)return!0;k++}return s.attributesNum!==k||s.index!==G}function g(L,P,B,G){let D={},O=P.attributes,k=0,q=B.getAttributes();for(let J in q)if(q[J].location>=0){let he=O[J];he===void 0&&(J==="instanceMatrix"&&L.instanceMatrix&&(he=L.instanceMatrix),J==="instanceColor"&&L.instanceColor&&(he=L.instanceColor));let Me={};Me.attribute=he,he&&he.data&&(Me.data=he.data),D[J]=Me,k++}s.attributes=D,s.attributesNum=k,s.index=G}function M(){let L=s.newAttributes;for(let P=0,B=L.length;P<B;P++)L[P]=0}function _(L){h(L,0)}function h(L,P){let B=s.newAttributes,G=s.enabledAttributes,D=s.attributeDivisors;B[L]=1,G[L]===0&&(t.enableVertexAttribArray(L),G[L]=1),D[L]!==P&&(t.vertexAttribDivisor(L,P),D[L]=P)}function m(){let L=s.newAttributes,P=s.enabledAttributes;for(let B=0,G=P.length;B<G;B++)P[B]!==L[B]&&(t.disableVertexAttribArray(B),P[B]=0)}function v(L,P,B,G,D,O,k){k===!0?t.vertexAttribIPointer(L,P,B,D,O):t.vertexAttribPointer(L,P,B,G,D,O)}function y(L,P,B,G){M();let D=G.attributes,O=B.getAttributes(),k=P.defaultAttributeValues;for(let q in O){let J=O[q];if(J.location>=0){let ce=D[q];if(ce===void 0&&(q==="instanceMatrix"&&L.instanceMatrix&&(ce=L.instanceMatrix),q==="instanceColor"&&L.instanceColor&&(ce=L.instanceColor)),ce!==void 0){let he=ce.normalized,Me=ce.itemSize,Fe=e.get(ce);if(Fe===void 0)continue;let Ze=Fe.buffer,Be=Fe.type,K=Fe.bytesPerElement,ve=Be===t.INT||Be===t.UNSIGNED_INT||ce.gpuType===Sh;if(ce.isInterleavedBufferAttribute){let pe=ce.data,Ce=pe.stride,Q=ce.offset;if(pe.isInstancedInterleavedBuffer){for(let re=0;re<J.locationSize;re++)h(J.location+re,pe.meshPerAttribute);L.isInstancedMesh!==!0&&G._maxInstanceCount===void 0&&(G._maxInstanceCount=pe.meshPerAttribute*pe.count)}else for(let re=0;re<J.locationSize;re++)_(J.location+re);t.bindBuffer(t.ARRAY_BUFFER,Ze);for(let re=0;re<J.locationSize;re++)v(J.location+re,Me/J.locationSize,Be,he,Ce*K,(Q+Me/J.locationSize*re)*K,ve)}else{if(ce.isInstancedBufferAttribute){for(let pe=0;pe<J.locationSize;pe++)h(J.location+pe,ce.meshPerAttribute);L.isInstancedMesh!==!0&&G._maxInstanceCount===void 0&&(G._maxInstanceCount=ce.meshPerAttribute*ce.count)}else for(let pe=0;pe<J.locationSize;pe++)_(J.location+pe);t.bindBuffer(t.ARRAY_BUFFER,Ze);for(let pe=0;pe<J.locationSize;pe++)v(J.location+pe,Me/J.locationSize,Be,he,Me*K,Me/J.locationSize*pe*K,ve)}}else if(k!==void 0){let he=k[q];if(he!==void 0)switch(he.length){case 2:t.vertexAttrib2fv(J.location,he);break;case 3:t.vertexAttrib3fv(J.location,he);break;case 4:t.vertexAttrib4fv(J.location,he);break;default:t.vertexAttrib1fv(J.location,he)}}}}m()}function A(){b();for(let L in i){let P=i[L];for(let B in P){let G=P[B];for(let D in G){let O=G[D];for(let k in O)d(O[k].object),delete O[k];delete G[D]}}delete i[L]}}function E(L){if(i[L.id]===void 0)return;let P=i[L.id];for(let B in P){let G=P[B];for(let D in G){let O=G[D];for(let k in O)d(O[k].object),delete O[k];delete G[D]}}delete i[L.id]}function C(L){for(let P in i){let B=i[P];for(let G in B){let D=B[G];if(D[L.id]===void 0)continue;let O=D[L.id];for(let k in O)d(O[k].object),delete O[k];delete D[L.id]}}}function x(L){for(let P in i){let B=i[P],G=L.isInstancedMesh===!0?L.id:0,D=B[G];if(D!==void 0){for(let O in D){let k=D[O];for(let q in k)d(k[q].object),delete k[q];delete D[O]}delete B[G],Object.keys(B).length===0&&delete i[P]}}}function b(){I(),o=!0,s!==r&&(s=r,c(s.object))}function I(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:b,resetDefaultState:I,dispose:A,releaseStatesOfGeometry:E,releaseStatesOfObject:x,releaseStatesOfProgram:C,initAttributes:M,enableAttribute:_,disableUnusedAttributes:m}}function Zb(t,e,n){let i;function r(l){i=l}function s(l,c){t.drawArrays(i,l,c),n.update(c,i,1)}function o(l,c,d){d!==0&&(t.drawArraysInstanced(i,l,c,d),n.update(c,i,d))}function a(l,c,d){if(d===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,c,0,d);let u=0;for(let p=0;p<d;p++)u+=c[p];n.update(u,i,1)}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a}function $b(t,e,n,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let C=e.get("EXT_texture_filter_anisotropic");r=t.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(C){return!(C!==Qn&&i.convert(C)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(C){let x=C===Ri&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==Tn&&i.convert(C)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==pi&&!x)}function l(C){if(C==="highp"){if(t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.HIGH_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.MEDIUM_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",d=l(c);d!==c&&(Ge("WebGLRenderer:",c,"not supported, using",d,"instead."),c=d);let f=n.logarithmicDepthBuffer===!0,u=n.reversedDepthBuffer===!0&&e.has("EXT_clip_control");n.reversedDepthBuffer===!0&&u===!1&&Ge("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let p=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),g=t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),M=t.getParameter(t.MAX_TEXTURE_SIZE),_=t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),h=t.getParameter(t.MAX_VERTEX_ATTRIBS),m=t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),v=t.getParameter(t.MAX_VARYING_VECTORS),y=t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),A=t.getParameter(t.MAX_SAMPLES),E=t.getParameter(t.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:f,reversedDepthBuffer:u,maxTextures:p,maxVertexTextures:g,maxTextureSize:M,maxCubemapSize:_,maxAttributes:h,maxVertexUniforms:m,maxVaryings:v,maxFragmentUniforms:y,maxSamples:A,samples:E}}function Jb(t){let e=this,n=null,i=0,r=!1,s=!1,o=new Kn,a=new Je,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(f,u){let p=f.length!==0||u||i!==0||r;return r=u,i=f.length,p},this.beginShadows=function(){s=!0,d(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(f,u){n=d(f,u,0)},this.setState=function(f,u,p){let g=f.clippingPlanes,M=f.clipIntersection,_=f.clipShadows,h=t.get(f);if(!r||g===null||g.length===0||s&&!_)s?d(null):c();else{let m=s?0:i,v=m*4,y=h.clippingState||null;l.value=y,y=d(g,u,v,p);for(let A=0;A!==v;++A)y[A]=n[A];h.clippingState=y,this.numIntersection=M?this.numPlanes:0,this.numPlanes+=m}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function d(f,u,p,g){let M=f!==null?f.length:0,_=null;if(M!==0){if(_=l.value,g!==!0||_===null){let h=p+M*4,m=u.matrixWorldInverse;a.getNormalMatrix(m),(_===null||_.length<h)&&(_=new Float32Array(h));for(let v=0,y=p;v!==M;++v,y+=4)o.copy(f[v]).applyMatrix4(m,a),o.normal.toArray(_,y),_[y+3]=o.constant}l.value=_,l.needsUpdate=!0}return e.numPlanes=M,e.numIntersection=0,_}}var Wr=4,Ly=[.125,.215,.35,.446,.526,.582],ys=20,Kb=256,El=new kr,Ny=new Ye,sg=null,og=0,ag=0,lg=!1,jb=new U,ld=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,n=0,i=.1,r=100,s={}){let{size:o=256,position:a=jb}=s;sg=this._renderer.getRenderTarget(),og=this._renderer.getActiveCubeFace(),ag=this._renderer.getActiveMipmapLevel(),lg=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,n=null){return this._fromTexture(e,n)}fromCubemap(e,n=null){return this._fromTexture(e,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Fy(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Uy(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(sg,og,ag),this._renderer.xr.enabled=lg,e.scissorTest=!1,Fo(e,0,0,e.width,e.height)}_fromTexture(e,n){e.mapping===zr||e.mapping===_s?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),sg=this._renderer.getRenderTarget(),og=this._renderer.getActiveCubeFace(),ag=this._renderer.getActiveMipmapLevel(),lg=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:jt,minFilter:jt,generateMipmaps:!1,type:Ri,format:Qn,colorSpace:Va,depthBuffer:!1},r=Dy(e,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Dy(e,n,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=Qb(s)),this._blurMaterial=tA(s,e,n),this._ggxMaterial=eA(s,e,n)}return r}_compileMaterial(e){let n=new en(new qt,e);this._renderer.compile(n,El)}_sceneToCubeUV(e,n,i,r,s){let l=new En(90,1,n,i),c=[1,-1,1,1,1,1],d=[1,1,1,-1,-1,-1],f=this._renderer,u=f.autoClear,p=f.toneMapping;f.getClearColor(Ny),f.toneMapping=di,f.autoClear=!1,f.state.buffers.depth.getReversed()&&(f.setRenderTarget(r),f.clearDepth(),f.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new en(new Dr,new Qi({name:"PMREM.Background",side:vn,depthWrite:!1,depthTest:!1})));let M=this._backgroundBox,_=M.material,h=!1,m=e.background;m?m.isColor&&(_.color.copy(m),e.background=null,h=!0):(_.color.copy(Ny),h=!0);for(let v=0;v<6;v++){let y=v%3;y===0?(l.up.set(0,c[v],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+d[v],s.y,s.z)):y===1?(l.up.set(0,0,c[v]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+d[v],s.z)):(l.up.set(0,c[v],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+d[v]));let A=this._cubeSize;Fo(r,y*A,v>2?A:0,A,A),f.setRenderTarget(r),h&&f.render(M,l),f.render(e,l)}f.toneMapping=p,f.autoClear=u,e.background=m}_textureToCubeUV(e,n){let i=this._renderer,r=e.mapping===zr||e.mapping===_s;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=Fy()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Uy());let s=r?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=s;let a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;Fo(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(o,El)}_applyPMREM(e){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);n.autoClear=i}_applyGGXFilter(e,n,i){let r=this._renderer,s=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[i];a.material=o;let l=o.uniforms,c=i/(this._lodMeshes.length-1),d=n/(this._lodMeshes.length-1),f=Math.sqrt(c*c-d*d),u=0+c*1.25,p=f*u,{_lodMax:g}=this,M=this._sizeLods[i],_=3*M*(i>g-Wr?i-g+Wr:0),h=4*(this._cubeSize-M);l.envMap.value=e.texture,l.roughness.value=p,l.mipInt.value=g-n,Fo(s,_,h,3*M,2*M),r.setRenderTarget(s),r.render(a,El),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=g-i,Fo(e,_,h,3*M,2*M),r.setRenderTarget(e),r.render(a,El)}_blur(e,n,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,n,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,n,i,r,s,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&He("blur direction must be either latitudinal or longitudinal!");let d=3,f=this._lodMeshes[r];f.material=c;let u=c.uniforms,p=this._sizeLods[i]-1,g=isFinite(s)?Math.PI/(2*p):2*Math.PI/(2*ys-1),M=s/g,_=isFinite(s)?1+Math.floor(d*M):ys;_>ys&&Ge(`sigmaRadians, ${s}, is too large and will clip, as it requested ${_} samples when the maximum is set to ${ys}`);let h=[],m=0;for(let C=0;C<ys;++C){let x=C/M,b=Math.exp(-x*x/2);h.push(b),C===0?m+=b:C<_&&(m+=2*b)}for(let C=0;C<h.length;C++)h[C]=h[C]/m;u.envMap.value=e.texture,u.samples.value=_,u.weights.value=h,u.latitudinal.value=o==="latitudinal",a&&(u.poleAxis.value=a);let{_lodMax:v}=this;u.dTheta.value=g,u.mipInt.value=v-i;let y=this._sizeLods[r],A=3*y*(r>v-Wr?r-v+Wr:0),E=4*(this._cubeSize-y);Fo(n,A,E,3*y,2*y),l.setRenderTarget(n),l.render(f,El)}};function Qb(t){let e=[],n=[],i=[],r=t,s=t-Wr+1+Ly.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);e.push(a);let l=1/a;o>t-Wr?l=Ly[o-t+Wr-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),d=-c,f=1+c,u=[d,d,f,d,f,f,d,d,f,f,d,f],p=6,g=6,M=3,_=2,h=1,m=new Float32Array(M*g*p),v=new Float32Array(_*g*p),y=new Float32Array(h*g*p);for(let E=0;E<p;E++){let C=E%3*2/3-1,x=E>2?0:-1,b=[C,x,0,C+2/3,x,0,C+2/3,x+1,0,C,x,0,C+2/3,x+1,0,C,x+1,0];m.set(b,M*g*E),v.set(u,_*g*E);let I=[E,E,E,E,E,E];y.set(I,h*g*E)}let A=new qt;A.setAttribute("position",new Fn(m,M)),A.setAttribute("uv",new Fn(v,_)),A.setAttribute("faceIndex",new Fn(y,h)),i.push(new en(A,null)),r>Wr&&r--}return{lodMeshes:i,sizeLods:e,sigmas:n}}function Dy(t,e,n){let i=new On(t,e,n);return i.texture.mapping=gl,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function Fo(t,e,n,i,r){t.viewport.set(e,n,i,r),t.scissor.set(e,n,i,r)}function eA(t,e,n){return new kn({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:Kb,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:hd(),fragmentShader:`

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
		`,blending:Ci,depthTest:!1,depthWrite:!1})}function tA(t,e,n){let i=new Float32Array(ys),r=new U(0,1,0);return new kn({name:"SphericalGaussianBlur",defines:{n:ys,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:hd(),fragmentShader:`

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
		`,blending:Ci,depthTest:!1,depthWrite:!1})}function Uy(){return new kn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:hd(),fragmentShader:`

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
		`,blending:Ci,depthTest:!1,depthWrite:!1})}function Fy(){return new kn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:hd(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Ci,depthTest:!1,depthWrite:!1})}function hd(){return`

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
	`}var cd=class extends On{constructor(e=1,n={}){super(e,e,n),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new Ja(r),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new Dr(5,5,5),s=new kn({name:"CubemapFromEquirect",uniforms:xs(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:vn,blending:Ci});s.uniforms.tEquirect.value=n;let o=new en(r,s),a=n.minFilter;return n.minFilter===Vr&&(n.minFilter=jt),new ph(1,10,this).update(e,o),n.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,n=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(n,i,r);e.setRenderTarget(s)}};function nA(t){let e=new WeakMap,n=new WeakMap,i=null;function r(u,p=!1){return u==null?null:p?o(u):s(u)}function s(u){if(u&&u.isTexture){let p=u.mapping;if(p===vh||p===xh)if(e.has(u)){let g=e.get(u).texture;return a(g,u.mapping)}else{let g=u.image;if(g&&g.height>0){let M=new cd(g.height);return M.fromEquirectangularTexture(t,u),e.set(u,M),u.addEventListener("dispose",c),a(M.texture,u.mapping)}else return null}}return u}function o(u){if(u&&u.isTexture){let p=u.mapping,g=p===vh||p===xh,M=p===zr||p===_s;if(g||M){let _=n.get(u),h=_!==void 0?_.texture.pmremVersion:0;if(u.isRenderTargetTexture&&u.pmremVersion!==h)return i===null&&(i=new ld(t)),_=g?i.fromEquirectangular(u,_):i.fromCubemap(u,_),_.texture.pmremVersion=u.pmremVersion,n.set(u,_),_.texture;if(_!==void 0)return _.texture;{let m=u.image;return g&&m&&m.height>0||M&&m&&l(m)?(i===null&&(i=new ld(t)),_=g?i.fromEquirectangular(u):i.fromCubemap(u),_.texture.pmremVersion=u.pmremVersion,n.set(u,_),u.addEventListener("dispose",d),_.texture):null}}}return u}function a(u,p){return p===vh?u.mapping=zr:p===xh&&(u.mapping=_s),u}function l(u){let p=0,g=6;for(let M=0;M<g;M++)u[M]!==void 0&&p++;return p===g}function c(u){let p=u.target;p.removeEventListener("dispose",c);let g=e.get(p);g!==void 0&&(e.delete(p),g.dispose())}function d(u){let p=u.target;p.removeEventListener("dispose",d);let g=n.get(p);g!==void 0&&(n.delete(p),g.dispose())}function f(){e=new WeakMap,n=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:f}}function iA(t){let e={};function n(i){if(e[i]!==void 0)return e[i];let r=t.getExtension(i);return e[i]=r,r}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let r=n(i);return r===null&&ku("WebGLRenderer: "+i+" extension not supported."),r}}}function rA(t,e,n,i){let r={},s=new WeakMap;function o(f){let u=f.target;u.index!==null&&e.remove(u.index);for(let g in u.attributes)e.remove(u.attributes[g]);u.removeEventListener("dispose",o),delete r[u.id];let p=s.get(u);p&&(e.remove(p),s.delete(u)),i.releaseStatesOfGeometry(u),u.isInstancedBufferGeometry===!0&&delete u._maxInstanceCount,n.memory.geometries--}function a(f,u){return r[u.id]===!0||(u.addEventListener("dispose",o),r[u.id]=!0,n.memory.geometries++),u}function l(f){let u=f.attributes;for(let p in u)e.update(u[p],t.ARRAY_BUFFER)}function c(f){let u=[],p=f.index,g=f.attributes.position,M=0;if(g===void 0)return;if(p!==null){let m=p.array;M=p.version;for(let v=0,y=m.length;v<y;v+=3){let A=m[v+0],E=m[v+1],C=m[v+2];u.push(A,E,E,C,C,A)}}else{let m=g.array;M=g.version;for(let v=0,y=m.length/3-1;v<y;v+=3){let A=v+0,E=v+1,C=v+2;u.push(A,E,E,C,C,A)}}let _=new(g.count>=65535?Za:Ya)(u,1);_.version=M;let h=s.get(f);h&&e.remove(h),s.set(f,_)}function d(f){let u=s.get(f);if(u){let p=f.index;p!==null&&u.version<p.version&&c(f)}else c(f);return s.get(f)}return{get:a,update:l,getWireframeAttribute:d}}function sA(t,e,n){let i;function r(f){i=f}let s,o;function a(f){s=f.type,o=f.bytesPerElement}function l(f,u){t.drawElements(i,u,s,f*o),n.update(u,i,1)}function c(f,u,p){p!==0&&(t.drawElementsInstanced(i,u,s,f*o,p),n.update(u,i,p))}function d(f,u,p){if(p===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,u,0,s,f,0,p);let M=0;for(let _=0;_<p;_++)M+=u[_];n.update(M,i,1)}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=d}function oA(t){let e={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(n.calls++,o){case t.TRIANGLES:n.triangles+=a*(s/3);break;case t.LINES:n.lines+=a*(s/2);break;case t.LINE_STRIP:n.lines+=a*(s-1);break;case t.LINE_LOOP:n.lines+=a*s;break;case t.POINTS:n.points+=a*s;break;default:He("WebGLInfo: Unknown draw mode:",o);break}}function r(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:e,render:n,programs:null,autoReset:!0,reset:r,update:i}}function aA(t,e,n){let i=new WeakMap,r=new Ct;function s(o,a,l){let c=o.morphTargetInfluences,d=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,f=d!==void 0?d.length:0,u=i.get(a);if(u===void 0||u.count!==f){let b=function(){C.dispose(),i.delete(a),a.removeEventListener("dispose",b)};u!==void 0&&u.texture.dispose();let p=a.morphAttributes.position!==void 0,g=a.morphAttributes.normal!==void 0,M=a.morphAttributes.color!==void 0,_=a.morphAttributes.position||[],h=a.morphAttributes.normal||[],m=a.morphAttributes.color||[],v=0;p===!0&&(v=1),g===!0&&(v=2),M===!0&&(v=3);let y=a.attributes.position.count*v,A=1;y>e.maxTextureSize&&(A=Math.ceil(y/e.maxTextureSize),y=e.maxTextureSize);let E=new Float32Array(y*A*4*f),C=new Wa(E,y,A,f);C.type=pi,C.needsUpdate=!0;let x=v*4;for(let I=0;I<f;I++){let L=_[I],P=h[I],B=m[I],G=y*A*4*I;for(let D=0;D<L.count;D++){let O=D*x;p===!0&&(r.fromBufferAttribute(L,D),E[G+O+0]=r.x,E[G+O+1]=r.y,E[G+O+2]=r.z,E[G+O+3]=0),g===!0&&(r.fromBufferAttribute(P,D),E[G+O+4]=r.x,E[G+O+5]=r.y,E[G+O+6]=r.z,E[G+O+7]=0),M===!0&&(r.fromBufferAttribute(B,D),E[G+O+8]=r.x,E[G+O+9]=r.y,E[G+O+10]=r.z,E[G+O+11]=B.itemSize===4?r.w:1)}}u={count:f,texture:C,size:new Te(y,A)},i.set(a,u),a.addEventListener("dispose",b)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(t,"morphTexture",o.morphTexture,n);else{let p=0;for(let M=0;M<c.length;M++)p+=c[M];let g=a.morphTargetsRelative?1:1-p;l.getUniforms().setValue(t,"morphTargetBaseInfluence",g),l.getUniforms().setValue(t,"morphTargetInfluences",c)}l.getUniforms().setValue(t,"morphTargetsTexture",u.texture,n),l.getUniforms().setValue(t,"morphTargetsTextureSize",u.size)}return{update:s}}function lA(t,e,n,i,r){let s=new WeakMap;function o(c){let d=r.render.frame,f=c.geometry,u=e.get(c,f);if(s.get(u)!==d&&(e.update(u),s.set(u,d)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==d&&(n.update(c.instanceMatrix,t.ARRAY_BUFFER),c.instanceColor!==null&&n.update(c.instanceColor,t.ARRAY_BUFFER),s.set(c,d))),c.isSkinnedMesh){let p=c.skeleton;s.get(p)!==d&&(p.update(),s.set(p,d))}return u}function a(){s=new WeakMap}function l(c){let d=c.target;d.removeEventListener("dispose",l),i.releaseStatesOfObject(d),n.remove(d.instanceMatrix),d.instanceColor!==null&&n.remove(d.instanceColor)}return{update:o,dispose:a}}var cA={[Pm]:"LINEAR_TONE_MAPPING",[Im]:"REINHARD_TONE_MAPPING",[Lm]:"CINEON_TONE_MAPPING",[Nm]:"ACES_FILMIC_TONE_MAPPING",[Um]:"AGX_TONE_MAPPING",[Fm]:"NEUTRAL_TONE_MAPPING",[Dm]:"CUSTOM_TONE_MAPPING"};function uA(t,e,n,i,r){let s=new On(e,n,{type:t,depthBuffer:i,stencilBuffer:r,depthTexture:i?new er(e,n):void 0}),o=new On(e,n,{type:Ri,depthBuffer:!1,stencilBuffer:!1}),a=new qt;a.setAttribute("position",new pt([-1,3,0,-1,-1,0,3,-1,0],3)),a.setAttribute("uv",new pt([0,2,0,0,2,0],2));let l=new th({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),c=new en(a,l),d=new kr(-1,1,1,-1,0,1),f=null,u=null,p=!1,g,M=null,_=[],h=!1;this.setSize=function(m,v){s.setSize(m,v),o.setSize(m,v);for(let y=0;y<_.length;y++){let A=_[y];A.setSize&&A.setSize(m,v)}},this.setEffects=function(m){_=m,h=_.length>0&&_[0].isRenderPass===!0;let v=s.width,y=s.height;for(let A=0;A<_.length;A++){let E=_[A];E.setSize&&E.setSize(v,y)}},this.begin=function(m,v){if(p||m.toneMapping===di&&_.length===0)return!1;if(M=v,v!==null){let y=v.width,A=v.height;(s.width!==y||s.height!==A)&&this.setSize(y,A)}return h===!1&&m.setRenderTarget(s),g=m.toneMapping,m.toneMapping=di,!0},this.hasRenderPass=function(){return h},this.end=function(m,v){m.toneMapping=g,p=!0;let y=s,A=o;for(let E=0;E<_.length;E++){let C=_[E];if(C.enabled!==!1&&(C.render(m,A,y,v),C.needsSwap!==!1)){let x=y;y=A,A=x}}if(f!==m.outputColorSpace||u!==m.toneMapping){f=m.outputColorSpace,u=m.toneMapping,l.defines={},it.getTransfer(f)===ct&&(l.defines.SRGB_TRANSFER="");let E=cA[u];E&&(l.defines[E]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=y.texture,m.setRenderTarget(M),m.render(c,d),M=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){s.depthTexture&&s.depthTexture.dispose(),s.dispose(),o.dispose(),a.dispose(),l.dispose()}}var nS=new _n,hg=new er(1,1),iS=new Wa,rS=new Gu,sS=new Ja,Oy=[],By=[],ky=new Float32Array(16),zy=new Float32Array(9),Vy=new Float32Array(4);function Bo(t,e,n){let i=t[0];if(i<=0||i>0)return t;let r=e*n,s=Oy[r];if(s===void 0&&(s=new Float32Array(r),Oy[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=n,t[o].toArray(s,a)}return s}function kt(t,e){if(t.length!==e.length)return!1;for(let n=0,i=t.length;n<i;n++)if(t[n]!==e[n])return!1;return!0}function zt(t,e){for(let n=0,i=e.length;n<i;n++)t[n]=e[n]}function dd(t,e){let n=By[e];n===void 0&&(n=new Int32Array(e),By[e]=n);for(let i=0;i!==e;++i)n[i]=t.allocateTextureUnit();return n}function hA(t,e){let n=this.cache;n[0]!==e&&(t.uniform1f(this.addr,e),n[0]=e)}function dA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2f(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(kt(n,e))return;t.uniform2fv(this.addr,e),zt(n,e)}}function fA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3f(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else if(e.r!==void 0)(n[0]!==e.r||n[1]!==e.g||n[2]!==e.b)&&(t.uniform3f(this.addr,e.r,e.g,e.b),n[0]=e.r,n[1]=e.g,n[2]=e.b);else{if(kt(n,e))return;t.uniform3fv(this.addr,e),zt(n,e)}}function pA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4f(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(kt(n,e))return;t.uniform4fv(this.addr,e),zt(n,e)}}function mA(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(kt(n,e))return;t.uniformMatrix2fv(this.addr,!1,e),zt(n,e)}else{if(kt(n,i))return;Vy.set(i),t.uniformMatrix2fv(this.addr,!1,Vy),zt(n,i)}}function gA(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(kt(n,e))return;t.uniformMatrix3fv(this.addr,!1,e),zt(n,e)}else{if(kt(n,i))return;zy.set(i),t.uniformMatrix3fv(this.addr,!1,zy),zt(n,i)}}function _A(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(kt(n,e))return;t.uniformMatrix4fv(this.addr,!1,e),zt(n,e)}else{if(kt(n,i))return;ky.set(i),t.uniformMatrix4fv(this.addr,!1,ky),zt(n,i)}}function vA(t,e){let n=this.cache;n[0]!==e&&(t.uniform1i(this.addr,e),n[0]=e)}function xA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2i(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(kt(n,e))return;t.uniform2iv(this.addr,e),zt(n,e)}}function yA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3i(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(kt(n,e))return;t.uniform3iv(this.addr,e),zt(n,e)}}function SA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4i(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(kt(n,e))return;t.uniform4iv(this.addr,e),zt(n,e)}}function MA(t,e){let n=this.cache;n[0]!==e&&(t.uniform1ui(this.addr,e),n[0]=e)}function wA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2ui(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(kt(n,e))return;t.uniform2uiv(this.addr,e),zt(n,e)}}function EA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3ui(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(kt(n,e))return;t.uniform3uiv(this.addr,e),zt(n,e)}}function TA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4ui(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(kt(n,e))return;t.uniform4uiv(this.addr,e),zt(n,e)}}function bA(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r);let s;this.type===t.SAMPLER_2D_SHADOW?(hg.compareFunction=n.isReversedDepthBuffer()?sd:rd,s=hg):s=nS,n.setTexture2D(e||s,r)}function AA(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture3D(e||rS,r)}function CA(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTextureCube(e||sS,r)}function RA(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture2DArray(e||iS,r)}function PA(t){switch(t){case 5126:return hA;case 35664:return dA;case 35665:return fA;case 35666:return pA;case 35674:return mA;case 35675:return gA;case 35676:return _A;case 5124:case 35670:return vA;case 35667:case 35671:return xA;case 35668:case 35672:return yA;case 35669:case 35673:return SA;case 5125:return MA;case 36294:return wA;case 36295:return EA;case 36296:return TA;case 35678:case 36198:case 36298:case 36306:case 35682:return bA;case 35679:case 36299:case 36307:return AA;case 35680:case 36300:case 36308:case 36293:return CA;case 36289:case 36303:case 36311:case 36292:return RA}}function IA(t,e){t.uniform1fv(this.addr,e)}function LA(t,e){let n=Bo(e,this.size,2);t.uniform2fv(this.addr,n)}function NA(t,e){let n=Bo(e,this.size,3);t.uniform3fv(this.addr,n)}function DA(t,e){let n=Bo(e,this.size,4);t.uniform4fv(this.addr,n)}function UA(t,e){let n=Bo(e,this.size,4);t.uniformMatrix2fv(this.addr,!1,n)}function FA(t,e){let n=Bo(e,this.size,9);t.uniformMatrix3fv(this.addr,!1,n)}function OA(t,e){let n=Bo(e,this.size,16);t.uniformMatrix4fv(this.addr,!1,n)}function BA(t,e){t.uniform1iv(this.addr,e)}function kA(t,e){t.uniform2iv(this.addr,e)}function zA(t,e){t.uniform3iv(this.addr,e)}function VA(t,e){t.uniform4iv(this.addr,e)}function GA(t,e){t.uniform1uiv(this.addr,e)}function HA(t,e){t.uniform2uiv(this.addr,e)}function WA(t,e){t.uniform3uiv(this.addr,e)}function XA(t,e){t.uniform4uiv(this.addr,e)}function qA(t,e,n){let i=this.cache,r=e.length,s=dd(n,r);kt(i,s)||(t.uniform1iv(this.addr,s),zt(i,s));let o;this.type===t.SAMPLER_2D_SHADOW?o=hg:o=nS;for(let a=0;a!==r;++a)n.setTexture2D(e[a]||o,s[a])}function YA(t,e,n){let i=this.cache,r=e.length,s=dd(n,r);kt(i,s)||(t.uniform1iv(this.addr,s),zt(i,s));for(let o=0;o!==r;++o)n.setTexture3D(e[o]||rS,s[o])}function ZA(t,e,n){let i=this.cache,r=e.length,s=dd(n,r);kt(i,s)||(t.uniform1iv(this.addr,s),zt(i,s));for(let o=0;o!==r;++o)n.setTextureCube(e[o]||sS,s[o])}function $A(t,e,n){let i=this.cache,r=e.length,s=dd(n,r);kt(i,s)||(t.uniform1iv(this.addr,s),zt(i,s));for(let o=0;o!==r;++o)n.setTexture2DArray(e[o]||iS,s[o])}function JA(t){switch(t){case 5126:return IA;case 35664:return LA;case 35665:return NA;case 35666:return DA;case 35674:return UA;case 35675:return FA;case 35676:return OA;case 5124:case 35670:return BA;case 35667:case 35671:return kA;case 35668:case 35672:return zA;case 35669:case 35673:return VA;case 5125:return GA;case 36294:return HA;case 36295:return WA;case 36296:return XA;case 35678:case 36198:case 36298:case 36306:case 35682:return qA;case 35679:case 36299:case 36307:return YA;case 35680:case 36300:case 36308:case 36293:return ZA;case 36289:case 36303:case 36311:case 36292:return $A}}var dg=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.setValue=PA(n.type)}},fg=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=JA(n.type)}},pg=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,n,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,n[a.id],i)}}},cg=/(\w+)(\])?(\[|\.)?/g;function Gy(t,e){t.seq.push(e),t.map[e.id]=e}function KA(t,e,n){let i=t.name,r=i.length;for(cg.lastIndex=0;;){let s=cg.exec(i),o=cg.lastIndex,a=s[1],l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){Gy(n,c===void 0?new dg(a,t,e):new fg(a,t,e));break}else{let f=n.map[a];f===void 0&&(f=new pg(a),Gy(n,f)),n=f}}}var Oo=class{constructor(e,n){this.seq=[],this.map={};let i=e.getProgramParameter(n,e.ACTIVE_UNIFORMS);for(let o=0;o<i;++o){let a=e.getActiveUniform(n,o),l=e.getUniformLocation(n,a.name);KA(a,l,this)}let r=[],s=[];for(let o of this.seq)o.type===e.SAMPLER_2D_SHADOW||o.type===e.SAMPLER_CUBE_SHADOW||o.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(o):s.push(o);r.length>0&&(this.seq=r.concat(s))}setValue(e,n,i,r){let s=this.map[n];s!==void 0&&s.setValue(e,i,r)}setOptional(e,n,i){let r=n[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,n,i,r){for(let s=0,o=n.length;s!==o;++s){let a=n[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,n){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in n&&i.push(o)}return i}};function Hy(t,e,n){let i=t.createShader(e);return t.shaderSource(i,n),t.compileShader(i),i}var jA=37297,QA=0;function eC(t,e){let n=t.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,n.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${n[o]}`)}return i.join(`
`)}var Wy=new Je;function tC(t){it._getMatrix(Wy,it.workingColorSpace,t);let e=`mat3( ${Wy.elements.map(n=>n.toFixed(4))} )`;switch(it.getTransfer(t)){case Ga:return[e,"LinearTransferOETF"];case ct:return[e,"sRGBTransferOETF"];default:return Ge("WebGLProgram: Unsupported color space: ",t),[e,"LinearTransferOETF"]}}function Xy(t,e,n){let i=t.getShaderParameter(e,t.COMPILE_STATUS),s=(t.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return n.toUpperCase()+`

`+s+`

`+eC(t.getShaderSource(e),a)}else return s}function nC(t,e){let n=tC(e);return[`vec4 ${t}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}var iC={[Pm]:"Linear",[Im]:"Reinhard",[Lm]:"Cineon",[Nm]:"ACESFilmic",[Um]:"AgX",[Fm]:"Neutral",[Dm]:"Custom"};function rC(t,e){let n=iC[e];return n===void 0?(Ge("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+t+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+t+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var ad=new U;function sC(){it.getLuminanceCoefficients(ad);let t=ad.x.toFixed(4),e=ad.y.toFixed(4),n=ad.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${t}, ${e}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function oC(t){return[t.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",t.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(bl).join(`
`)}function aC(t){let e=[];for(let n in t){let i=t[n];i!==!1&&e.push("#define "+n+" "+i)}return e.join(`
`)}function lC(t,e){let n={},i=t.getProgramParameter(e,t.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=t.getActiveAttrib(e,r),o=s.name,a=1;s.type===t.FLOAT_MAT2&&(a=2),s.type===t.FLOAT_MAT3&&(a=3),s.type===t.FLOAT_MAT4&&(a=4),n[o]={type:s.type,location:t.getAttribLocation(e,o),locationSize:a}}return n}function bl(t){return t!==""}function qy(t,e){let n=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return t.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function Yy(t,e){return t.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var cC=/^[ \t]*#include +<([\w\d./]+)>/gm;function mg(t){return t.replace(cC,hC)}var uC=new Map;function hC(t,e){let n=je[e];if(n===void 0){let i=uC.get(e);if(i!==void 0)n=je[i],Ge('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return mg(n)}var dC=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Zy(t){return t.replace(dC,fC)}function fC(t,e,n,i){let r="";for(let s=parseInt(e);s<parseInt(n);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function $y(t){let e=`precision ${t.precision} float;
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
#define LOW_PRECISION`),e}var pC={[ml]:"SHADOWMAP_TYPE_PCF",[No]:"SHADOWMAP_TYPE_VSM"};function mC(t){return pC[t.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var gC={[zr]:"ENVMAP_TYPE_CUBE",[_s]:"ENVMAP_TYPE_CUBE",[gl]:"ENVMAP_TYPE_CUBE_UV"};function _C(t){return t.envMap===!1?"ENVMAP_TYPE_CUBE":gC[t.envMapMode]||"ENVMAP_TYPE_CUBE"}var vC={[_s]:"ENVMAP_MODE_REFRACTION"};function xC(t){return t.envMap===!1?"ENVMAP_MODE_REFLECTION":vC[t.envMapMode]||"ENVMAP_MODE_REFLECTION"}var yC={[Rm]:"ENVMAP_BLENDING_MULTIPLY",[uy]:"ENVMAP_BLENDING_MIX",[hy]:"ENVMAP_BLENDING_ADD"};function SC(t){return t.envMap===!1?"ENVMAP_BLENDING_NONE":yC[t.combine]||"ENVMAP_BLENDING_NONE"}function MC(t){let e=t.envMapCubeUVHeight;if(e===null)return null;let n=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,n),7*16)),texelHeight:i,maxMip:n}}function wC(t,e,n,i){let r=t.getContext(),s=n.defines,o=n.vertexShader,a=n.fragmentShader,l=mC(n),c=_C(n),d=xC(n),f=SC(n),u=MC(n),p=oC(n),g=aC(s),M=r.createProgram(),_,h,m=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(_=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,g].filter(bl).join(`
`),_.length>0&&(_+=`
`),h=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,g].filter(bl).join(`
`),h.length>0&&(h+=`
`)):(_=[$y(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,g,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+d:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexNormals?"#define HAS_NORMAL":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(bl).join(`
`),h=[$y(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,g,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+d:"",n.envMap?"#define "+f:"",u?"#define CUBEUV_TEXEL_WIDTH "+u.texelWidth:"",u?"#define CUBEUV_TEXEL_HEIGHT "+u.texelHeight:"",u?"#define CUBEUV_MAX_MIP "+u.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor?"#define USE_COLOR":"",n.vertexAlphas||n.batchingColor?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==di?"#define TONE_MAPPING":"",n.toneMapping!==di?je.tonemapping_pars_fragment:"",n.toneMapping!==di?rC("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",je.colorspace_pars_fragment,nC("linearToOutputTexel",n.outputColorSpace),sC(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(bl).join(`
`)),o=mg(o),o=qy(o,n),o=Yy(o,n),a=mg(a),a=qy(a,n),a=Yy(a,n),o=Zy(o),a=Zy(a),n.isRawShaderMaterial!==!0&&(m=`#version 300 es
`,_=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+_,h=["#define varying in",n.glslVersion===Xm?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===Xm?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+h);let v=m+_+o,y=m+h+a,A=Hy(r,r.VERTEX_SHADER,v),E=Hy(r,r.FRAGMENT_SHADER,y);r.attachShader(M,A),r.attachShader(M,E),n.index0AttributeName!==void 0?r.bindAttribLocation(M,0,n.index0AttributeName):n.morphTargets===!0&&r.bindAttribLocation(M,0,"position"),r.linkProgram(M);function C(L){if(t.debug.checkShaderErrors){let P=r.getProgramInfoLog(M)||"",B=r.getShaderInfoLog(A)||"",G=r.getShaderInfoLog(E)||"",D=P.trim(),O=B.trim(),k=G.trim(),q=!0,J=!0;if(r.getProgramParameter(M,r.LINK_STATUS)===!1)if(q=!1,typeof t.debug.onShaderError=="function")t.debug.onShaderError(r,M,A,E);else{let ce=Xy(r,A,"vertex"),he=Xy(r,E,"fragment");He("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(M,r.VALIDATE_STATUS)+`

Material Name: `+L.name+`
Material Type: `+L.type+`

Program Info Log: `+D+`
`+ce+`
`+he)}else D!==""?Ge("WebGLProgram: Program Info Log:",D):(O===""||k==="")&&(J=!1);J&&(L.diagnostics={runnable:q,programLog:D,vertexShader:{log:O,prefix:_},fragmentShader:{log:k,prefix:h}})}r.deleteShader(A),r.deleteShader(E),x=new Oo(r,M),b=lC(r,M)}let x;this.getUniforms=function(){return x===void 0&&C(this),x};let b;this.getAttributes=function(){return b===void 0&&C(this),b};let I=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return I===!1&&(I=r.getProgramParameter(M,jA)),I},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(M),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=QA++,this.cacheKey=e,this.usedTimes=1,this.program=M,this.vertexShader=A,this.fragmentShader=E,this}var EC=0,gg=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let n=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(n),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let n=this.materialCache.get(e);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let n=this.materialCache,i=n.get(e);return i===void 0&&(i=new Set,n.set(e,i)),i}_getShaderStage(e){let n=this.shaderCache,i=n.get(e);return i===void 0&&(i=new _g(e),n.set(e,i)),i}},_g=class{constructor(e){this.id=EC++,this.code=e,this.usedTimes=0}};function TC(t){return t===Hr||t===Ml||t===wl}function bC(t,e,n,i,r,s){let o=new So,a=new gg,l=new Set,c=[],d=new Map,f=i.logarithmicDepthBuffer,u=i.precision,p={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function g(x){return l.add(x),x===0?"uv":`uv${x}`}function M(x,b,I,L,P,B){let G=L.fog,D=P.geometry,O=x.isMeshStandardMaterial||x.isMeshLambertMaterial||x.isMeshPhongMaterial?L.environment:null,k=x.isMeshStandardMaterial||x.isMeshLambertMaterial&&!x.envMap||x.isMeshPhongMaterial&&!x.envMap,q=e.get(x.envMap||O,k),J=q&&q.mapping===gl?q.image.height:null,ce=p[x.type];x.precision!==null&&(u=i.getMaxPrecision(x.precision),u!==x.precision&&Ge("WebGLProgram.getParameters:",x.precision,"not supported, using",u,"instead."));let he=D.morphAttributes.position||D.morphAttributes.normal||D.morphAttributes.color,Me=he!==void 0?he.length:0,Fe=0;D.morphAttributes.position!==void 0&&(Fe=1),D.morphAttributes.normal!==void 0&&(Fe=2),D.morphAttributes.color!==void 0&&(Fe=3);let Ze,Be,K,ve;if(ce){let We=Ii[ce];Ze=We.vertexShader,Be=We.fragmentShader}else Ze=x.vertexShader,Be=x.fragmentShader,a.update(x),K=a.getVertexShaderID(x),ve=a.getFragmentShaderID(x);let pe=t.getRenderTarget(),Ce=t.state.buffers.depth.getReversed(),Q=P.isInstancedMesh===!0,re=P.isBatchedMesh===!0,Se=!!x.map,we=!!x.matcap,Y=!!q,ee=!!x.aoMap,$=!!x.lightMap,ae=!!x.bumpMap,oe=!!x.normalMap,Le=!!x.displacementMap,N=!!x.emissiveMap,Ve=!!x.metalnessMap,Ue=!!x.roughnessMap,Xe=x.anisotropy>0,ge=x.clearcoat>0,st=x.dispersion>0,T=x.iridescence>0,S=x.sheen>0,z=x.transmission>0,ne=Xe&&!!x.anisotropyMap,se=ge&&!!x.clearcoatMap,_e=ge&&!!x.clearcoatNormalMap,ye=ge&&!!x.clearcoatRoughnessMap,Z=T&&!!x.iridescenceMap,j=T&&!!x.iridescenceThicknessMap,de=S&&!!x.sheenColorMap,Re=S&&!!x.sheenRoughnessMap,ue=!!x.specularMap,xe=!!x.specularColorMap,$e=!!x.specularIntensityMap,qe=z&&!!x.transmissionMap,rt=z&&!!x.thicknessMap,R=!!x.gradientMap,ie=!!x.alphaMap,V=x.alphaTest>0,fe=!!x.alphaHash,le=!!x.extensions,te=di;x.toneMapped&&(pe===null||pe.isXRRenderTarget===!0)&&(te=t.toneMapping);let Ee={shaderID:ce,shaderType:x.type,shaderName:x.name,vertexShader:Ze,fragmentShader:Be,defines:x.defines,customVertexShaderID:K,customFragmentShaderID:ve,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:u,batching:re,batchingColor:re&&P._colorsTexture!==null,instancing:Q,instancingColor:Q&&P.instanceColor!==null,instancingMorph:Q&&P.morphTexture!==null,outputColorSpace:pe===null?t.outputColorSpace:pe.isXRRenderTarget===!0?pe.texture.colorSpace:it.workingColorSpace,alphaToCoverage:!!x.alphaToCoverage,map:Se,matcap:we,envMap:Y,envMapMode:Y&&q.mapping,envMapCubeUVHeight:J,aoMap:ee,lightMap:$,bumpMap:ae,normalMap:oe,displacementMap:Le,emissiveMap:N,normalMapObjectSpace:oe&&x.normalMapType===py,normalMapTangentSpace:oe&&x.normalMapType===id,packedNormalMap:oe&&x.normalMapType===id&&TC(x.normalMap.format),metalnessMap:Ve,roughnessMap:Ue,anisotropy:Xe,anisotropyMap:ne,clearcoat:ge,clearcoatMap:se,clearcoatNormalMap:_e,clearcoatRoughnessMap:ye,dispersion:st,iridescence:T,iridescenceMap:Z,iridescenceThicknessMap:j,sheen:S,sheenColorMap:de,sheenRoughnessMap:Re,specularMap:ue,specularColorMap:xe,specularIntensityMap:$e,transmission:z,transmissionMap:qe,thicknessMap:rt,gradientMap:R,opaque:x.transparent===!1&&x.blending===fs&&x.alphaToCoverage===!1,alphaMap:ie,alphaTest:V,alphaHash:fe,combine:x.combine,mapUv:Se&&g(x.map.channel),aoMapUv:ee&&g(x.aoMap.channel),lightMapUv:$&&g(x.lightMap.channel),bumpMapUv:ae&&g(x.bumpMap.channel),normalMapUv:oe&&g(x.normalMap.channel),displacementMapUv:Le&&g(x.displacementMap.channel),emissiveMapUv:N&&g(x.emissiveMap.channel),metalnessMapUv:Ve&&g(x.metalnessMap.channel),roughnessMapUv:Ue&&g(x.roughnessMap.channel),anisotropyMapUv:ne&&g(x.anisotropyMap.channel),clearcoatMapUv:se&&g(x.clearcoatMap.channel),clearcoatNormalMapUv:_e&&g(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ye&&g(x.clearcoatRoughnessMap.channel),iridescenceMapUv:Z&&g(x.iridescenceMap.channel),iridescenceThicknessMapUv:j&&g(x.iridescenceThicknessMap.channel),sheenColorMapUv:de&&g(x.sheenColorMap.channel),sheenRoughnessMapUv:Re&&g(x.sheenRoughnessMap.channel),specularMapUv:ue&&g(x.specularMap.channel),specularColorMapUv:xe&&g(x.specularColorMap.channel),specularIntensityMapUv:$e&&g(x.specularIntensityMap.channel),transmissionMapUv:qe&&g(x.transmissionMap.channel),thicknessMapUv:rt&&g(x.thicknessMap.channel),alphaMapUv:ie&&g(x.alphaMap.channel),vertexTangents:!!D.attributes.tangent&&(oe||Xe),vertexNormals:!!D.attributes.normal,vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!D.attributes.color&&D.attributes.color.itemSize===4,pointsUvs:P.isPoints===!0&&!!D.attributes.uv&&(Se||ie),fog:!!G,useFog:x.fog===!0,fogExp2:!!G&&G.isFogExp2,flatShading:x.wireframe===!1&&(x.flatShading===!0||D.attributes.normal===void 0&&oe===!1&&(x.isMeshLambertMaterial||x.isMeshPhongMaterial||x.isMeshStandardMaterial||x.isMeshPhysicalMaterial)),sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:f,reversedDepthBuffer:Ce,skinning:P.isSkinnedMesh===!0,morphTargets:D.morphAttributes.position!==void 0,morphNormals:D.morphAttributes.normal!==void 0,morphColors:D.morphAttributes.color!==void 0,morphTargetsCount:Me,morphTextureStride:Fe,numDirLights:b.directional.length,numPointLights:b.point.length,numSpotLights:b.spot.length,numSpotLightMaps:b.spotLightMap.length,numRectAreaLights:b.rectArea.length,numHemiLights:b.hemi.length,numDirLightShadows:b.directionalShadowMap.length,numPointLightShadows:b.pointShadowMap.length,numSpotLightShadows:b.spotShadowMap.length,numSpotLightShadowsWithMaps:b.numSpotLightShadowsWithMaps,numLightProbes:b.numLightProbes,numLightProbeGrids:B.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:x.dithering,shadowMapEnabled:t.shadowMap.enabled&&I.length>0,shadowMapType:t.shadowMap.type,toneMapping:te,decodeVideoTexture:Se&&x.map.isVideoTexture===!0&&it.getTransfer(x.map.colorSpace)===ct,decodeVideoTextureEmissive:N&&x.emissiveMap.isVideoTexture===!0&&it.getTransfer(x.emissiveMap.colorSpace)===ct,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===jn,flipSided:x.side===vn,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:le&&x.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(le&&x.extensions.multiDraw===!0||re)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return Ee.vertexUv1s=l.has(1),Ee.vertexUv2s=l.has(2),Ee.vertexUv3s=l.has(3),l.clear(),Ee}function _(x){let b=[];if(x.shaderID?b.push(x.shaderID):(b.push(x.customVertexShaderID),b.push(x.customFragmentShaderID)),x.defines!==void 0)for(let I in x.defines)b.push(I),b.push(x.defines[I]);return x.isRawShaderMaterial===!1&&(h(b,x),m(b,x),b.push(t.outputColorSpace)),b.push(x.customProgramCacheKey),b.join()}function h(x,b){x.push(b.precision),x.push(b.outputColorSpace),x.push(b.envMapMode),x.push(b.envMapCubeUVHeight),x.push(b.mapUv),x.push(b.alphaMapUv),x.push(b.lightMapUv),x.push(b.aoMapUv),x.push(b.bumpMapUv),x.push(b.normalMapUv),x.push(b.displacementMapUv),x.push(b.emissiveMapUv),x.push(b.metalnessMapUv),x.push(b.roughnessMapUv),x.push(b.anisotropyMapUv),x.push(b.clearcoatMapUv),x.push(b.clearcoatNormalMapUv),x.push(b.clearcoatRoughnessMapUv),x.push(b.iridescenceMapUv),x.push(b.iridescenceThicknessMapUv),x.push(b.sheenColorMapUv),x.push(b.sheenRoughnessMapUv),x.push(b.specularMapUv),x.push(b.specularColorMapUv),x.push(b.specularIntensityMapUv),x.push(b.transmissionMapUv),x.push(b.thicknessMapUv),x.push(b.combine),x.push(b.fogExp2),x.push(b.sizeAttenuation),x.push(b.morphTargetsCount),x.push(b.morphAttributeCount),x.push(b.numDirLights),x.push(b.numPointLights),x.push(b.numSpotLights),x.push(b.numSpotLightMaps),x.push(b.numHemiLights),x.push(b.numRectAreaLights),x.push(b.numDirLightShadows),x.push(b.numPointLightShadows),x.push(b.numSpotLightShadows),x.push(b.numSpotLightShadowsWithMaps),x.push(b.numLightProbes),x.push(b.shadowMapType),x.push(b.toneMapping),x.push(b.numClippingPlanes),x.push(b.numClipIntersection),x.push(b.depthPacking)}function m(x,b){o.disableAll(),b.instancing&&o.enable(0),b.instancingColor&&o.enable(1),b.instancingMorph&&o.enable(2),b.matcap&&o.enable(3),b.envMap&&o.enable(4),b.normalMapObjectSpace&&o.enable(5),b.normalMapTangentSpace&&o.enable(6),b.clearcoat&&o.enable(7),b.iridescence&&o.enable(8),b.alphaTest&&o.enable(9),b.vertexColors&&o.enable(10),b.vertexAlphas&&o.enable(11),b.vertexUv1s&&o.enable(12),b.vertexUv2s&&o.enable(13),b.vertexUv3s&&o.enable(14),b.vertexTangents&&o.enable(15),b.anisotropy&&o.enable(16),b.alphaHash&&o.enable(17),b.batching&&o.enable(18),b.dispersion&&o.enable(19),b.batchingColor&&o.enable(20),b.gradientMap&&o.enable(21),b.packedNormalMap&&o.enable(22),b.vertexNormals&&o.enable(23),x.push(o.mask),o.disableAll(),b.fog&&o.enable(0),b.useFog&&o.enable(1),b.flatShading&&o.enable(2),b.logarithmicDepthBuffer&&o.enable(3),b.reversedDepthBuffer&&o.enable(4),b.skinning&&o.enable(5),b.morphTargets&&o.enable(6),b.morphNormals&&o.enable(7),b.morphColors&&o.enable(8),b.premultipliedAlpha&&o.enable(9),b.shadowMapEnabled&&o.enable(10),b.doubleSided&&o.enable(11),b.flipSided&&o.enable(12),b.useDepthPacking&&o.enable(13),b.dithering&&o.enable(14),b.transmission&&o.enable(15),b.sheen&&o.enable(16),b.opaque&&o.enable(17),b.pointsUvs&&o.enable(18),b.decodeVideoTexture&&o.enable(19),b.decodeVideoTextureEmissive&&o.enable(20),b.alphaToCoverage&&o.enable(21),b.numLightProbeGrids>0&&o.enable(22),x.push(o.mask)}function v(x){let b=p[x.type],I;if(b){let L=Ii[b];I=Py.clone(L.uniforms)}else I=x.uniforms;return I}function y(x,b){let I=d.get(b);return I!==void 0?++I.usedTimes:(I=new wC(t,b,x,r),c.push(I),d.set(b,I)),I}function A(x){if(--x.usedTimes===0){let b=c.indexOf(x);c[b]=c[c.length-1],c.pop(),d.delete(x.cacheKey),x.destroy()}}function E(x){a.remove(x)}function C(){a.dispose()}return{getParameters:M,getProgramCacheKey:_,getUniforms:v,acquireProgram:y,releaseProgram:A,releaseShaderCache:E,programs:c,dispose:C}}function AC(){let t=new WeakMap;function e(o){return t.has(o)}function n(o){let a=t.get(o);return a===void 0&&(a={},t.set(o,a)),a}function i(o){t.delete(o)}function r(o,a,l){t.get(o)[a]=l}function s(){t=new WeakMap}return{has:e,get:n,remove:i,update:r,dispose:s}}function CC(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.material.id!==e.material.id?t.material.id-e.material.id:t.materialVariant!==e.materialVariant?t.materialVariant-e.materialVariant:t.z!==e.z?t.z-e.z:t.id-e.id}function Jy(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.z!==e.z?e.z-t.z:t.id-e.id}function Ky(){let t=[],e=0,n=[],i=[],r=[];function s(){e=0,n.length=0,i.length=0,r.length=0}function o(u){let p=0;return u.isInstancedMesh&&(p+=2),u.isSkinnedMesh&&(p+=1),p}function a(u,p,g,M,_,h){let m=t[e];return m===void 0?(m={id:u.id,object:u,geometry:p,material:g,materialVariant:o(u),groupOrder:M,renderOrder:u.renderOrder,z:_,group:h},t[e]=m):(m.id=u.id,m.object=u,m.geometry=p,m.material=g,m.materialVariant=o(u),m.groupOrder=M,m.renderOrder=u.renderOrder,m.z=_,m.group=h),e++,m}function l(u,p,g,M,_,h){let m=a(u,p,g,M,_,h);g.transmission>0?i.push(m):g.transparent===!0?r.push(m):n.push(m)}function c(u,p,g,M,_,h){let m=a(u,p,g,M,_,h);g.transmission>0?i.unshift(m):g.transparent===!0?r.unshift(m):n.unshift(m)}function d(u,p){n.length>1&&n.sort(u||CC),i.length>1&&i.sort(p||Jy),r.length>1&&r.sort(p||Jy)}function f(){for(let u=e,p=t.length;u<p;u++){let g=t[u];if(g.id===null)break;g.id=null,g.object=null,g.geometry=null,g.material=null,g.group=null}}return{opaque:n,transmissive:i,transparent:r,init:s,push:l,unshift:c,finish:f,sort:d}}function RC(){let t=new WeakMap;function e(i,r){let s=t.get(i),o;return s===void 0?(o=new Ky,t.set(i,[o])):r>=s.length?(o=new Ky,s.push(o)):o=s[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}function PC(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={direction:new U,color:new Ye};break;case"SpotLight":n={position:new U,direction:new U,color:new Ye,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new U,color:new Ye,distance:0,decay:0};break;case"HemisphereLight":n={direction:new U,skyColor:new Ye,groundColor:new Ye};break;case"RectAreaLight":n={color:new Ye,position:new U,halfWidth:new U,halfHeight:new U};break}return t[e.id]=n,n}}}function IC(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Te};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Te};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Te,shadowCameraNear:1,shadowCameraFar:1e3};break}return t[e.id]=n,n}}}var LC=0;function NC(t,e){return(e.castShadow?2:0)-(t.castShadow?2:0)+(e.map?1:0)-(t.map?1:0)}function DC(t){let e=new PC,n=IC(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new U);let r=new U,s=new Mt,o=new Mt;function a(c){let d=0,f=0,u=0;for(let b=0;b<9;b++)i.probe[b].set(0,0,0);let p=0,g=0,M=0,_=0,h=0,m=0,v=0,y=0,A=0,E=0,C=0;c.sort(NC);for(let b=0,I=c.length;b<I;b++){let L=c[b],P=L.color,B=L.intensity,G=L.distance,D=null;if(L.shadow&&L.shadow.map&&(L.shadow.map.texture.format===Hr?D=L.shadow.map.texture:D=L.shadow.map.depthTexture||L.shadow.map.texture),L.isAmbientLight)d+=P.r*B,f+=P.g*B,u+=P.b*B;else if(L.isLightProbe){for(let O=0;O<9;O++)i.probe[O].addScaledVector(L.sh.coefficients[O],B);C++}else if(L.isDirectionalLight){let O=e.get(L);if(O.color.copy(L.color).multiplyScalar(L.intensity),L.castShadow){let k=L.shadow,q=n.get(L);q.shadowIntensity=k.intensity,q.shadowBias=k.bias,q.shadowNormalBias=k.normalBias,q.shadowRadius=k.radius,q.shadowMapSize=k.mapSize,i.directionalShadow[p]=q,i.directionalShadowMap[p]=D,i.directionalShadowMatrix[p]=L.shadow.matrix,m++}i.directional[p]=O,p++}else if(L.isSpotLight){let O=e.get(L);O.position.setFromMatrixPosition(L.matrixWorld),O.color.copy(P).multiplyScalar(B),O.distance=G,O.coneCos=Math.cos(L.angle),O.penumbraCos=Math.cos(L.angle*(1-L.penumbra)),O.decay=L.decay,i.spot[M]=O;let k=L.shadow;if(L.map&&(i.spotLightMap[A]=L.map,A++,k.updateMatrices(L),L.castShadow&&E++),i.spotLightMatrix[M]=k.matrix,L.castShadow){let q=n.get(L);q.shadowIntensity=k.intensity,q.shadowBias=k.bias,q.shadowNormalBias=k.normalBias,q.shadowRadius=k.radius,q.shadowMapSize=k.mapSize,i.spotShadow[M]=q,i.spotShadowMap[M]=D,y++}M++}else if(L.isRectAreaLight){let O=e.get(L);O.color.copy(P).multiplyScalar(B),O.halfWidth.set(L.width*.5,0,0),O.halfHeight.set(0,L.height*.5,0),i.rectArea[_]=O,_++}else if(L.isPointLight){let O=e.get(L);if(O.color.copy(L.color).multiplyScalar(L.intensity),O.distance=L.distance,O.decay=L.decay,L.castShadow){let k=L.shadow,q=n.get(L);q.shadowIntensity=k.intensity,q.shadowBias=k.bias,q.shadowNormalBias=k.normalBias,q.shadowRadius=k.radius,q.shadowMapSize=k.mapSize,q.shadowCameraNear=k.camera.near,q.shadowCameraFar=k.camera.far,i.pointShadow[g]=q,i.pointShadowMap[g]=D,i.pointShadowMatrix[g]=L.shadow.matrix,v++}i.point[g]=O,g++}else if(L.isHemisphereLight){let O=e.get(L);O.skyColor.copy(L.color).multiplyScalar(B),O.groundColor.copy(L.groundColor).multiplyScalar(B),i.hemi[h]=O,h++}}_>0&&(t.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=be.LTC_FLOAT_1,i.rectAreaLTC2=be.LTC_FLOAT_2):(i.rectAreaLTC1=be.LTC_HALF_1,i.rectAreaLTC2=be.LTC_HALF_2)),i.ambient[0]=d,i.ambient[1]=f,i.ambient[2]=u;let x=i.hash;(x.directionalLength!==p||x.pointLength!==g||x.spotLength!==M||x.rectAreaLength!==_||x.hemiLength!==h||x.numDirectionalShadows!==m||x.numPointShadows!==v||x.numSpotShadows!==y||x.numSpotMaps!==A||x.numLightProbes!==C)&&(i.directional.length=p,i.spot.length=M,i.rectArea.length=_,i.point.length=g,i.hemi.length=h,i.directionalShadow.length=m,i.directionalShadowMap.length=m,i.pointShadow.length=v,i.pointShadowMap.length=v,i.spotShadow.length=y,i.spotShadowMap.length=y,i.directionalShadowMatrix.length=m,i.pointShadowMatrix.length=v,i.spotLightMatrix.length=y+A-E,i.spotLightMap.length=A,i.numSpotLightShadowsWithMaps=E,i.numLightProbes=C,x.directionalLength=p,x.pointLength=g,x.spotLength=M,x.rectAreaLength=_,x.hemiLength=h,x.numDirectionalShadows=m,x.numPointShadows=v,x.numSpotShadows=y,x.numSpotMaps=A,x.numLightProbes=C,i.version=LC++)}function l(c,d){let f=0,u=0,p=0,g=0,M=0,_=d.matrixWorldInverse;for(let h=0,m=c.length;h<m;h++){let v=c[h];if(v.isDirectionalLight){let y=i.directional[f];y.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),y.direction.sub(r),y.direction.transformDirection(_),f++}else if(v.isSpotLight){let y=i.spot[p];y.position.setFromMatrixPosition(v.matrixWorld),y.position.applyMatrix4(_),y.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),y.direction.sub(r),y.direction.transformDirection(_),p++}else if(v.isRectAreaLight){let y=i.rectArea[g];y.position.setFromMatrixPosition(v.matrixWorld),y.position.applyMatrix4(_),o.identity(),s.copy(v.matrixWorld),s.premultiply(_),o.extractRotation(s),y.halfWidth.set(v.width*.5,0,0),y.halfHeight.set(0,v.height*.5,0),y.halfWidth.applyMatrix4(o),y.halfHeight.applyMatrix4(o),g++}else if(v.isPointLight){let y=i.point[u];y.position.setFromMatrixPosition(v.matrixWorld),y.position.applyMatrix4(_),u++}else if(v.isHemisphereLight){let y=i.hemi[M];y.direction.setFromMatrixPosition(v.matrixWorld),y.direction.transformDirection(_),M++}}}return{setup:a,setupView:l,state:i}}function jy(t){let e=new DC(t),n=[],i=[],r=[];function s(u){f.camera=u,n.length=0,i.length=0,r.length=0}function o(u){n.push(u)}function a(u){i.push(u)}function l(u){r.push(u)}function c(){e.setup(n)}function d(u){e.setupView(n,u)}let f={lightsArray:n,shadowsArray:i,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:f,setupLights:c,setupLightsView:d,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function UC(t){let e=new WeakMap;function n(r,s=0){let o=e.get(r),a;return o===void 0?(a=new jy(t),e.set(r,[a])):s>=o.length?(a=new jy(t),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:n,dispose:i}}var FC=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,OC=`uniform sampler2D shadow_pass;
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
}`,BC=[new U(1,0,0),new U(-1,0,0),new U(0,1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1)],kC=[new U(0,-1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1),new U(0,-1,0),new U(0,-1,0)],Qy=new Mt,Tl=new U,ug=new U;function zC(t,e,n){let i=new Eo,r=new Te,s=new Te,o=new Ct,a=new nh,l=new ih,c={},d=n.maxTextureSize,f={[Ji]:vn,[vn]:Ji,[jn]:jn},u=new kn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Te},radius:{value:4}},vertexShader:FC,fragmentShader:OC}),p=u.clone();p.defines.HORIZONTAL_PASS=1;let g=new qt;g.setAttribute("position",new Fn(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let M=new en(g,u),_=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=ml;let h=this.type;this.render=function(E,C,x){if(_.enabled===!1||_.autoUpdate===!1&&_.needsUpdate===!1||E.length===0)return;this.type===Xx&&(Ge("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=ml);let b=t.getRenderTarget(),I=t.getActiveCubeFace(),L=t.getActiveMipmapLevel(),P=t.state;P.setBlending(Ci),P.buffers.depth.getReversed()===!0?P.buffers.color.setClear(0,0,0,0):P.buffers.color.setClear(1,1,1,1),P.buffers.depth.setTest(!0),P.setScissorTest(!1);let B=h!==this.type;B&&C.traverse(function(G){G.material&&(Array.isArray(G.material)?G.material.forEach(D=>D.needsUpdate=!0):G.material.needsUpdate=!0)});for(let G=0,D=E.length;G<D;G++){let O=E[G],k=O.shadow;if(k===void 0){Ge("WebGLShadowMap:",O,"has no shadow.");continue}if(k.autoUpdate===!1&&k.needsUpdate===!1)continue;r.copy(k.mapSize);let q=k.getFrameExtents();r.multiply(q),s.copy(k.mapSize),(r.x>d||r.y>d)&&(r.x>d&&(s.x=Math.floor(d/q.x),r.x=s.x*q.x,k.mapSize.x=s.x),r.y>d&&(s.y=Math.floor(d/q.y),r.y=s.y*q.y,k.mapSize.y=s.y));let J=t.state.buffers.depth.getReversed();if(k.camera._reversedDepth=J,k.map===null||B===!0){if(k.map!==null&&(k.map.depthTexture!==null&&(k.map.depthTexture.dispose(),k.map.depthTexture=null),k.map.dispose()),this.type===No){if(O.isPointLight){Ge("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}k.map=new On(r.x,r.y,{format:Hr,type:Ri,minFilter:jt,magFilter:jt,generateMipmaps:!1}),k.map.texture.name=O.name+".shadowMap",k.map.depthTexture=new er(r.x,r.y,pi),k.map.depthTexture.name=O.name+".shadowMapDepth",k.map.depthTexture.format=Ti,k.map.depthTexture.compareFunction=null,k.map.depthTexture.minFilter=Xt,k.map.depthTexture.magFilter=Xt}else O.isPointLight?(k.map=new cd(r.x),k.map.depthTexture=new Yu(r.x,fi)):(k.map=new On(r.x,r.y),k.map.depthTexture=new er(r.x,r.y,fi)),k.map.depthTexture.name=O.name+".shadowMap",k.map.depthTexture.format=Ti,this.type===ml?(k.map.depthTexture.compareFunction=J?sd:rd,k.map.depthTexture.minFilter=jt,k.map.depthTexture.magFilter=jt):(k.map.depthTexture.compareFunction=null,k.map.depthTexture.minFilter=Xt,k.map.depthTexture.magFilter=Xt);k.camera.updateProjectionMatrix()}let ce=k.map.isWebGLCubeRenderTarget?6:1;for(let he=0;he<ce;he++){if(k.map.isWebGLCubeRenderTarget)t.setRenderTarget(k.map,he),t.clear();else{he===0&&(t.setRenderTarget(k.map),t.clear());let Me=k.getViewport(he);o.set(s.x*Me.x,s.y*Me.y,s.x*Me.z,s.y*Me.w),P.viewport(o)}if(O.isPointLight){let Me=k.camera,Fe=k.matrix,Ze=O.distance||Me.far;Ze!==Me.far&&(Me.far=Ze,Me.updateProjectionMatrix()),Tl.setFromMatrixPosition(O.matrixWorld),Me.position.copy(Tl),ug.copy(Me.position),ug.add(BC[he]),Me.up.copy(kC[he]),Me.lookAt(ug),Me.updateMatrixWorld(),Fe.makeTranslation(-Tl.x,-Tl.y,-Tl.z),Qy.multiplyMatrices(Me.projectionMatrix,Me.matrixWorldInverse),k._frustum.setFromProjectionMatrix(Qy,Me.coordinateSystem,Me.reversedDepth)}else k.updateMatrices(O);i=k.getFrustum(),y(C,x,k.camera,O,this.type)}k.isPointLightShadow!==!0&&this.type===No&&m(k,x),k.needsUpdate=!1}h=this.type,_.needsUpdate=!1,t.setRenderTarget(b,I,L)};function m(E,C){let x=e.update(M);u.defines.VSM_SAMPLES!==E.blurSamples&&(u.defines.VSM_SAMPLES=E.blurSamples,p.defines.VSM_SAMPLES=E.blurSamples,u.needsUpdate=!0,p.needsUpdate=!0),E.mapPass===null&&(E.mapPass=new On(r.x,r.y,{format:Hr,type:Ri})),u.uniforms.shadow_pass.value=E.map.depthTexture,u.uniforms.resolution.value=E.mapSize,u.uniforms.radius.value=E.radius,t.setRenderTarget(E.mapPass),t.clear(),t.renderBufferDirect(C,null,x,u,M,null),p.uniforms.shadow_pass.value=E.mapPass.texture,p.uniforms.resolution.value=E.mapSize,p.uniforms.radius.value=E.radius,t.setRenderTarget(E.map),t.clear(),t.renderBufferDirect(C,null,x,p,M,null)}function v(E,C,x,b){let I=null,L=x.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(L!==void 0)I=L;else if(I=x.isPointLight===!0?l:a,t.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){let P=I.uuid,B=C.uuid,G=c[P];G===void 0&&(G={},c[P]=G);let D=G[B];D===void 0&&(D=I.clone(),G[B]=D,C.addEventListener("dispose",A)),I=D}if(I.visible=C.visible,I.wireframe=C.wireframe,b===No?I.side=C.shadowSide!==null?C.shadowSide:C.side:I.side=C.shadowSide!==null?C.shadowSide:f[C.side],I.alphaMap=C.alphaMap,I.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,I.map=C.map,I.clipShadows=C.clipShadows,I.clippingPlanes=C.clippingPlanes,I.clipIntersection=C.clipIntersection,I.displacementMap=C.displacementMap,I.displacementScale=C.displacementScale,I.displacementBias=C.displacementBias,I.wireframeLinewidth=C.wireframeLinewidth,I.linewidth=C.linewidth,x.isPointLight===!0&&I.isMeshDistanceMaterial===!0){let P=t.properties.get(I);P.light=x}return I}function y(E,C,x,b,I){if(E.visible===!1)return;if(E.layers.test(C.layers)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&I===No)&&(!E.frustumCulled||i.intersectsObject(E))){E.modelViewMatrix.multiplyMatrices(x.matrixWorldInverse,E.matrixWorld);let B=e.update(E),G=E.material;if(Array.isArray(G)){let D=B.groups;for(let O=0,k=D.length;O<k;O++){let q=D[O],J=G[q.materialIndex];if(J&&J.visible){let ce=v(E,J,b,I);E.onBeforeShadow(t,E,C,x,B,ce,q),t.renderBufferDirect(x,null,B,ce,E,q),E.onAfterShadow(t,E,C,x,B,ce,q)}}}else if(G.visible){let D=v(E,G,b,I);E.onBeforeShadow(t,E,C,x,B,D,null),t.renderBufferDirect(x,null,B,D,E,null),E.onAfterShadow(t,E,C,x,B,D,null)}}let P=E.children;for(let B=0,G=P.length;B<G;B++)y(P[B],C,x,b,I)}function A(E){E.target.removeEventListener("dispose",A);for(let x in c){let b=c[x],I=E.target.uuid;I in b&&(b[I].dispose(),delete b[I])}}}function VC(t,e){function n(){let R=!1,ie=new Ct,V=null,fe=new Ct(0,0,0,0);return{setMask:function(le){V!==le&&!R&&(t.colorMask(le,le,le,le),V=le)},setLocked:function(le){R=le},setClear:function(le,te,Ee,We,vt){vt===!0&&(le*=We,te*=We,Ee*=We),ie.set(le,te,Ee,We),fe.equals(ie)===!1&&(t.clearColor(le,te,Ee,We),fe.copy(ie))},reset:function(){R=!1,V=null,fe.set(-1,0,0,0)}}}function i(){let R=!1,ie=!1,V=null,fe=null,le=null;return{setReversed:function(te){if(ie!==te){let Ee=e.get("EXT_clip_control");te?Ee.clipControlEXT(Ee.LOWER_LEFT_EXT,Ee.ZERO_TO_ONE_EXT):Ee.clipControlEXT(Ee.LOWER_LEFT_EXT,Ee.NEGATIVE_ONE_TO_ONE_EXT),ie=te;let We=le;le=null,this.setClear(We)}},getReversed:function(){return ie},setTest:function(te){te?pe(t.DEPTH_TEST):Ce(t.DEPTH_TEST)},setMask:function(te){V!==te&&!R&&(t.depthMask(te),V=te)},setFunc:function(te){if(ie&&(te=Ey[te]),fe!==te){switch(te){case Pu:t.depthFunc(t.NEVER);break;case Iu:t.depthFunc(t.ALWAYS);break;case Lu:t.depthFunc(t.LESS);break;case ps:t.depthFunc(t.LEQUAL);break;case Nu:t.depthFunc(t.EQUAL);break;case Du:t.depthFunc(t.GEQUAL);break;case Uu:t.depthFunc(t.GREATER);break;case Fu:t.depthFunc(t.NOTEQUAL);break;default:t.depthFunc(t.LEQUAL)}fe=te}},setLocked:function(te){R=te},setClear:function(te){le!==te&&(le=te,ie&&(te=1-te),t.clearDepth(te))},reset:function(){R=!1,V=null,fe=null,le=null,ie=!1}}}function r(){let R=!1,ie=null,V=null,fe=null,le=null,te=null,Ee=null,We=null,vt=null;return{setTest:function(lt){R||(lt?pe(t.STENCIL_TEST):Ce(t.STENCIL_TEST))},setMask:function(lt){ie!==lt&&!R&&(t.stencilMask(lt),ie=lt)},setFunc:function(lt,tn,Rt){(V!==lt||fe!==tn||le!==Rt)&&(t.stencilFunc(lt,tn,Rt),V=lt,fe=tn,le=Rt)},setOp:function(lt,tn,Rt){(te!==lt||Ee!==tn||We!==Rt)&&(t.stencilOp(lt,tn,Rt),te=lt,Ee=tn,We=Rt)},setLocked:function(lt){R=lt},setClear:function(lt){vt!==lt&&(t.clearStencil(lt),vt=lt)},reset:function(){R=!1,ie=null,V=null,fe=null,le=null,te=null,Ee=null,We=null,vt=null}}}let s=new n,o=new i,a=new r,l=new WeakMap,c=new WeakMap,d={},f={},u={},p=new WeakMap,g=[],M=null,_=!1,h=null,m=null,v=null,y=null,A=null,E=null,C=null,x=new Ye(0,0,0),b=0,I=!1,L=null,P=null,B=null,G=null,D=null,O=t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS),k=!1,q=0,J=t.getParameter(t.VERSION);J.indexOf("WebGL")!==-1?(q=parseFloat(/^WebGL (\d)/.exec(J)[1]),k=q>=1):J.indexOf("OpenGL ES")!==-1&&(q=parseFloat(/^OpenGL ES (\d)/.exec(J)[1]),k=q>=2);let ce=null,he={},Me=t.getParameter(t.SCISSOR_BOX),Fe=t.getParameter(t.VIEWPORT),Ze=new Ct().fromArray(Me),Be=new Ct().fromArray(Fe);function K(R,ie,V,fe){let le=new Uint8Array(4),te=t.createTexture();t.bindTexture(R,te),t.texParameteri(R,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(R,t.TEXTURE_MAG_FILTER,t.NEAREST);for(let Ee=0;Ee<V;Ee++)R===t.TEXTURE_3D||R===t.TEXTURE_2D_ARRAY?t.texImage3D(ie,0,t.RGBA,1,1,fe,0,t.RGBA,t.UNSIGNED_BYTE,le):t.texImage2D(ie+Ee,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,le);return te}let ve={};ve[t.TEXTURE_2D]=K(t.TEXTURE_2D,t.TEXTURE_2D,1),ve[t.TEXTURE_CUBE_MAP]=K(t.TEXTURE_CUBE_MAP,t.TEXTURE_CUBE_MAP_POSITIVE_X,6),ve[t.TEXTURE_2D_ARRAY]=K(t.TEXTURE_2D_ARRAY,t.TEXTURE_2D_ARRAY,1,1),ve[t.TEXTURE_3D]=K(t.TEXTURE_3D,t.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),pe(t.DEPTH_TEST),o.setFunc(ps),ae(!1),oe(Tm),pe(t.CULL_FACE),ee(Ci);function pe(R){d[R]!==!0&&(t.enable(R),d[R]=!0)}function Ce(R){d[R]!==!1&&(t.disable(R),d[R]=!1)}function Q(R,ie){return u[R]!==ie?(t.bindFramebuffer(R,ie),u[R]=ie,R===t.DRAW_FRAMEBUFFER&&(u[t.FRAMEBUFFER]=ie),R===t.FRAMEBUFFER&&(u[t.DRAW_FRAMEBUFFER]=ie),!0):!1}function re(R,ie){let V=g,fe=!1;if(R){V=p.get(ie),V===void 0&&(V=[],p.set(ie,V));let le=R.textures;if(V.length!==le.length||V[0]!==t.COLOR_ATTACHMENT0){for(let te=0,Ee=le.length;te<Ee;te++)V[te]=t.COLOR_ATTACHMENT0+te;V.length=le.length,fe=!0}}else V[0]!==t.BACK&&(V[0]=t.BACK,fe=!0);fe&&t.drawBuffers(V)}function Se(R){return M!==R?(t.useProgram(R),M=R,!0):!1}let we={[Lr]:t.FUNC_ADD,[Yx]:t.FUNC_SUBTRACT,[Zx]:t.FUNC_REVERSE_SUBTRACT};we[$x]=t.MIN,we[Jx]=t.MAX;let Y={[Kx]:t.ZERO,[jx]:t.ONE,[Qx]:t.SRC_COLOR,[Cu]:t.SRC_ALPHA,[sy]:t.SRC_ALPHA_SATURATE,[iy]:t.DST_COLOR,[ty]:t.DST_ALPHA,[ey]:t.ONE_MINUS_SRC_COLOR,[Ru]:t.ONE_MINUS_SRC_ALPHA,[ry]:t.ONE_MINUS_DST_COLOR,[ny]:t.ONE_MINUS_DST_ALPHA,[oy]:t.CONSTANT_COLOR,[ay]:t.ONE_MINUS_CONSTANT_COLOR,[ly]:t.CONSTANT_ALPHA,[cy]:t.ONE_MINUS_CONSTANT_ALPHA};function ee(R,ie,V,fe,le,te,Ee,We,vt,lt){if(R===Ci){_===!0&&(Ce(t.BLEND),_=!1);return}if(_===!1&&(pe(t.BLEND),_=!0),R!==qx){if(R!==h||lt!==I){if((m!==Lr||A!==Lr)&&(t.blendEquation(t.FUNC_ADD),m=Lr,A=Lr),lt)switch(R){case fs:t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case bm:t.blendFunc(t.ONE,t.ONE);break;case Am:t.blendFuncSeparate(t.ZERO,t.ONE_MINUS_SRC_COLOR,t.ZERO,t.ONE);break;case Cm:t.blendFuncSeparate(t.DST_COLOR,t.ONE_MINUS_SRC_ALPHA,t.ZERO,t.ONE);break;default:He("WebGLState: Invalid blending: ",R);break}else switch(R){case fs:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case bm:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE,t.ONE,t.ONE);break;case Am:He("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Cm:He("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:He("WebGLState: Invalid blending: ",R);break}v=null,y=null,E=null,C=null,x.set(0,0,0),b=0,h=R,I=lt}return}le=le||ie,te=te||V,Ee=Ee||fe,(ie!==m||le!==A)&&(t.blendEquationSeparate(we[ie],we[le]),m=ie,A=le),(V!==v||fe!==y||te!==E||Ee!==C)&&(t.blendFuncSeparate(Y[V],Y[fe],Y[te],Y[Ee]),v=V,y=fe,E=te,C=Ee),(We.equals(x)===!1||vt!==b)&&(t.blendColor(We.r,We.g,We.b,vt),x.copy(We),b=vt),h=R,I=!1}function $(R,ie){R.side===jn?Ce(t.CULL_FACE):pe(t.CULL_FACE);let V=R.side===vn;ie&&(V=!V),ae(V),R.blending===fs&&R.transparent===!1?ee(Ci):ee(R.blending,R.blendEquation,R.blendSrc,R.blendDst,R.blendEquationAlpha,R.blendSrcAlpha,R.blendDstAlpha,R.blendColor,R.blendAlpha,R.premultipliedAlpha),o.setFunc(R.depthFunc),o.setTest(R.depthTest),o.setMask(R.depthWrite),s.setMask(R.colorWrite);let fe=R.stencilWrite;a.setTest(fe),fe&&(a.setMask(R.stencilWriteMask),a.setFunc(R.stencilFunc,R.stencilRef,R.stencilFuncMask),a.setOp(R.stencilFail,R.stencilZFail,R.stencilZPass)),N(R.polygonOffset,R.polygonOffsetFactor,R.polygonOffsetUnits),R.alphaToCoverage===!0?pe(t.SAMPLE_ALPHA_TO_COVERAGE):Ce(t.SAMPLE_ALPHA_TO_COVERAGE)}function ae(R){L!==R&&(R?t.frontFace(t.CW):t.frontFace(t.CCW),L=R)}function oe(R){R!==Hx?(pe(t.CULL_FACE),R!==P&&(R===Tm?t.cullFace(t.BACK):R===Wx?t.cullFace(t.FRONT):t.cullFace(t.FRONT_AND_BACK))):Ce(t.CULL_FACE),P=R}function Le(R){R!==B&&(k&&t.lineWidth(R),B=R)}function N(R,ie,V){R?(pe(t.POLYGON_OFFSET_FILL),(G!==ie||D!==V)&&(G=ie,D=V,o.getReversed()&&(ie=-ie),t.polygonOffset(ie,V))):Ce(t.POLYGON_OFFSET_FILL)}function Ve(R){R?pe(t.SCISSOR_TEST):Ce(t.SCISSOR_TEST)}function Ue(R){R===void 0&&(R=t.TEXTURE0+O-1),ce!==R&&(t.activeTexture(R),ce=R)}function Xe(R,ie,V){V===void 0&&(ce===null?V=t.TEXTURE0+O-1:V=ce);let fe=he[V];fe===void 0&&(fe={type:void 0,texture:void 0},he[V]=fe),(fe.type!==R||fe.texture!==ie)&&(ce!==V&&(t.activeTexture(V),ce=V),t.bindTexture(R,ie||ve[R]),fe.type=R,fe.texture=ie)}function ge(){let R=he[ce];R!==void 0&&R.type!==void 0&&(t.bindTexture(R.type,null),R.type=void 0,R.texture=void 0)}function st(){try{t.compressedTexImage2D(...arguments)}catch(R){He("WebGLState:",R)}}function T(){try{t.compressedTexImage3D(...arguments)}catch(R){He("WebGLState:",R)}}function S(){try{t.texSubImage2D(...arguments)}catch(R){He("WebGLState:",R)}}function z(){try{t.texSubImage3D(...arguments)}catch(R){He("WebGLState:",R)}}function ne(){try{t.compressedTexSubImage2D(...arguments)}catch(R){He("WebGLState:",R)}}function se(){try{t.compressedTexSubImage3D(...arguments)}catch(R){He("WebGLState:",R)}}function _e(){try{t.texStorage2D(...arguments)}catch(R){He("WebGLState:",R)}}function ye(){try{t.texStorage3D(...arguments)}catch(R){He("WebGLState:",R)}}function Z(){try{t.texImage2D(...arguments)}catch(R){He("WebGLState:",R)}}function j(){try{t.texImage3D(...arguments)}catch(R){He("WebGLState:",R)}}function de(R){return f[R]!==void 0?f[R]:t.getParameter(R)}function Re(R,ie){f[R]!==ie&&(t.pixelStorei(R,ie),f[R]=ie)}function ue(R){Ze.equals(R)===!1&&(t.scissor(R.x,R.y,R.z,R.w),Ze.copy(R))}function xe(R){Be.equals(R)===!1&&(t.viewport(R.x,R.y,R.z,R.w),Be.copy(R))}function $e(R,ie){let V=c.get(ie);V===void 0&&(V=new WeakMap,c.set(ie,V));let fe=V.get(R);fe===void 0&&(fe=t.getUniformBlockIndex(ie,R.name),V.set(R,fe))}function qe(R,ie){let fe=c.get(ie).get(R);l.get(ie)!==fe&&(t.uniformBlockBinding(ie,fe,R.__bindingPointIndex),l.set(ie,fe))}function rt(){t.disable(t.BLEND),t.disable(t.CULL_FACE),t.disable(t.DEPTH_TEST),t.disable(t.POLYGON_OFFSET_FILL),t.disable(t.SCISSOR_TEST),t.disable(t.STENCIL_TEST),t.disable(t.SAMPLE_ALPHA_TO_COVERAGE),t.blendEquation(t.FUNC_ADD),t.blendFunc(t.ONE,t.ZERO),t.blendFuncSeparate(t.ONE,t.ZERO,t.ONE,t.ZERO),t.blendColor(0,0,0,0),t.colorMask(!0,!0,!0,!0),t.clearColor(0,0,0,0),t.depthMask(!0),t.depthFunc(t.LESS),o.setReversed(!1),t.clearDepth(1),t.stencilMask(4294967295),t.stencilFunc(t.ALWAYS,0,4294967295),t.stencilOp(t.KEEP,t.KEEP,t.KEEP),t.clearStencil(0),t.cullFace(t.BACK),t.frontFace(t.CCW),t.polygonOffset(0,0),t.activeTexture(t.TEXTURE0),t.bindFramebuffer(t.FRAMEBUFFER,null),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),t.bindFramebuffer(t.READ_FRAMEBUFFER,null),t.useProgram(null),t.lineWidth(1),t.scissor(0,0,t.canvas.width,t.canvas.height),t.viewport(0,0,t.canvas.width,t.canvas.height),t.pixelStorei(t.PACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.BROWSER_DEFAULT_WEBGL),t.pixelStorei(t.PACK_ROW_LENGTH,0),t.pixelStorei(t.PACK_SKIP_PIXELS,0),t.pixelStorei(t.PACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_ROW_LENGTH,0),t.pixelStorei(t.UNPACK_IMAGE_HEIGHT,0),t.pixelStorei(t.UNPACK_SKIP_PIXELS,0),t.pixelStorei(t.UNPACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_SKIP_IMAGES,0),d={},f={},ce=null,he={},u={},p=new WeakMap,g=[],M=null,_=!1,h=null,m=null,v=null,y=null,A=null,E=null,C=null,x=new Ye(0,0,0),b=0,I=!1,L=null,P=null,B=null,G=null,D=null,Ze.set(0,0,t.canvas.width,t.canvas.height),Be.set(0,0,t.canvas.width,t.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:pe,disable:Ce,bindFramebuffer:Q,drawBuffers:re,useProgram:Se,setBlending:ee,setMaterial:$,setFlipSided:ae,setCullFace:oe,setLineWidth:Le,setPolygonOffset:N,setScissorTest:Ve,activeTexture:Ue,bindTexture:Xe,unbindTexture:ge,compressedTexImage2D:st,compressedTexImage3D:T,texImage2D:Z,texImage3D:j,pixelStorei:Re,getParameter:de,updateUBOMapping:$e,uniformBlockBinding:qe,texStorage2D:_e,texStorage3D:ye,texSubImage2D:S,texSubImage3D:z,compressedTexSubImage2D:ne,compressedTexSubImage3D:se,scissor:ue,viewport:xe,reset:rt}}function GC(t,e,n,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Te,d=new WeakMap,f=new Set,u,p=new WeakMap,g=!1;try{g=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function M(T,S){return g?new OffscreenCanvas(T,S):Ha("canvas")}function _(T,S,z){let ne=1,se=st(T);if((se.width>z||se.height>z)&&(ne=z/Math.max(se.width,se.height)),ne<1)if(typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&T instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&T instanceof ImageBitmap||typeof VideoFrame<"u"&&T instanceof VideoFrame){let _e=Math.floor(ne*se.width),ye=Math.floor(ne*se.height);u===void 0&&(u=M(_e,ye));let Z=S?M(_e,ye):u;return Z.width=_e,Z.height=ye,Z.getContext("2d").drawImage(T,0,0,_e,ye),Ge("WebGLRenderer: Texture has been resized from ("+se.width+"x"+se.height+") to ("+_e+"x"+ye+")."),Z}else return"data"in T&&Ge("WebGLRenderer: Image in DataTexture is too big ("+se.width+"x"+se.height+")."),T;return T}function h(T){return T.generateMipmaps}function m(T){t.generateMipmap(T)}function v(T){return T.isWebGLCubeRenderTarget?t.TEXTURE_CUBE_MAP:T.isWebGL3DRenderTarget?t.TEXTURE_3D:T.isWebGLArrayRenderTarget||T.isCompressedArrayTexture?t.TEXTURE_2D_ARRAY:t.TEXTURE_2D}function y(T,S,z,ne,se,_e=!1){if(T!==null){if(t[T]!==void 0)return t[T];Ge("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+T+"'")}let ye;ne&&(ye=e.get("EXT_texture_norm16"),ye||Ge("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let Z=S;if(S===t.RED&&(z===t.FLOAT&&(Z=t.R32F),z===t.HALF_FLOAT&&(Z=t.R16F),z===t.UNSIGNED_BYTE&&(Z=t.R8),z===t.UNSIGNED_SHORT&&ye&&(Z=ye.R16_EXT),z===t.SHORT&&ye&&(Z=ye.R16_SNORM_EXT)),S===t.RED_INTEGER&&(z===t.UNSIGNED_BYTE&&(Z=t.R8UI),z===t.UNSIGNED_SHORT&&(Z=t.R16UI),z===t.UNSIGNED_INT&&(Z=t.R32UI),z===t.BYTE&&(Z=t.R8I),z===t.SHORT&&(Z=t.R16I),z===t.INT&&(Z=t.R32I)),S===t.RG&&(z===t.FLOAT&&(Z=t.RG32F),z===t.HALF_FLOAT&&(Z=t.RG16F),z===t.UNSIGNED_BYTE&&(Z=t.RG8),z===t.UNSIGNED_SHORT&&ye&&(Z=ye.RG16_EXT),z===t.SHORT&&ye&&(Z=ye.RG16_SNORM_EXT)),S===t.RG_INTEGER&&(z===t.UNSIGNED_BYTE&&(Z=t.RG8UI),z===t.UNSIGNED_SHORT&&(Z=t.RG16UI),z===t.UNSIGNED_INT&&(Z=t.RG32UI),z===t.BYTE&&(Z=t.RG8I),z===t.SHORT&&(Z=t.RG16I),z===t.INT&&(Z=t.RG32I)),S===t.RGB_INTEGER&&(z===t.UNSIGNED_BYTE&&(Z=t.RGB8UI),z===t.UNSIGNED_SHORT&&(Z=t.RGB16UI),z===t.UNSIGNED_INT&&(Z=t.RGB32UI),z===t.BYTE&&(Z=t.RGB8I),z===t.SHORT&&(Z=t.RGB16I),z===t.INT&&(Z=t.RGB32I)),S===t.RGBA_INTEGER&&(z===t.UNSIGNED_BYTE&&(Z=t.RGBA8UI),z===t.UNSIGNED_SHORT&&(Z=t.RGBA16UI),z===t.UNSIGNED_INT&&(Z=t.RGBA32UI),z===t.BYTE&&(Z=t.RGBA8I),z===t.SHORT&&(Z=t.RGBA16I),z===t.INT&&(Z=t.RGBA32I)),S===t.RGB&&(z===t.UNSIGNED_SHORT&&ye&&(Z=ye.RGB16_EXT),z===t.SHORT&&ye&&(Z=ye.RGB16_SNORM_EXT),z===t.UNSIGNED_INT_5_9_9_9_REV&&(Z=t.RGB9_E5),z===t.UNSIGNED_INT_10F_11F_11F_REV&&(Z=t.R11F_G11F_B10F)),S===t.RGBA){let j=_e?Ga:it.getTransfer(se);z===t.FLOAT&&(Z=t.RGBA32F),z===t.HALF_FLOAT&&(Z=t.RGBA16F),z===t.UNSIGNED_BYTE&&(Z=j===ct?t.SRGB8_ALPHA8:t.RGBA8),z===t.UNSIGNED_SHORT&&ye&&(Z=ye.RGBA16_EXT),z===t.SHORT&&ye&&(Z=ye.RGBA16_SNORM_EXT),z===t.UNSIGNED_SHORT_4_4_4_4&&(Z=t.RGBA4),z===t.UNSIGNED_SHORT_5_5_5_1&&(Z=t.RGB5_A1)}return(Z===t.R16F||Z===t.R32F||Z===t.RG16F||Z===t.RG32F||Z===t.RGBA16F||Z===t.RGBA32F)&&e.get("EXT_color_buffer_float"),Z}function A(T,S){let z;return T?S===null||S===fi||S===Uo?z=t.DEPTH24_STENCIL8:S===pi?z=t.DEPTH32F_STENCIL8:S===Do&&(z=t.DEPTH24_STENCIL8,Ge("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):S===null||S===fi||S===Uo?z=t.DEPTH_COMPONENT24:S===pi?z=t.DEPTH_COMPONENT32F:S===Do&&(z=t.DEPTH_COMPONENT16),z}function E(T,S){return h(T)===!0||T.isFramebufferTexture&&T.minFilter!==Xt&&T.minFilter!==jt?Math.log2(Math.max(S.width,S.height))+1:T.mipmaps!==void 0&&T.mipmaps.length>0?T.mipmaps.length:T.isCompressedTexture&&Array.isArray(T.image)?S.mipmaps.length:1}function C(T){let S=T.target;S.removeEventListener("dispose",C),b(S),S.isVideoTexture&&d.delete(S),S.isHTMLTexture&&f.delete(S)}function x(T){let S=T.target;S.removeEventListener("dispose",x),L(S)}function b(T){let S=i.get(T);if(S.__webglInit===void 0)return;let z=T.source,ne=p.get(z);if(ne){let se=ne[S.__cacheKey];se.usedTimes--,se.usedTimes===0&&I(T),Object.keys(ne).length===0&&p.delete(z)}i.remove(T)}function I(T){let S=i.get(T);t.deleteTexture(S.__webglTexture);let z=T.source,ne=p.get(z);delete ne[S.__cacheKey],o.memory.textures--}function L(T){let S=i.get(T);if(T.depthTexture&&(T.depthTexture.dispose(),i.remove(T.depthTexture)),T.isWebGLCubeRenderTarget)for(let ne=0;ne<6;ne++){if(Array.isArray(S.__webglFramebuffer[ne]))for(let se=0;se<S.__webglFramebuffer[ne].length;se++)t.deleteFramebuffer(S.__webglFramebuffer[ne][se]);else t.deleteFramebuffer(S.__webglFramebuffer[ne]);S.__webglDepthbuffer&&t.deleteRenderbuffer(S.__webglDepthbuffer[ne])}else{if(Array.isArray(S.__webglFramebuffer))for(let ne=0;ne<S.__webglFramebuffer.length;ne++)t.deleteFramebuffer(S.__webglFramebuffer[ne]);else t.deleteFramebuffer(S.__webglFramebuffer);if(S.__webglDepthbuffer&&t.deleteRenderbuffer(S.__webglDepthbuffer),S.__webglMultisampledFramebuffer&&t.deleteFramebuffer(S.__webglMultisampledFramebuffer),S.__webglColorRenderbuffer)for(let ne=0;ne<S.__webglColorRenderbuffer.length;ne++)S.__webglColorRenderbuffer[ne]&&t.deleteRenderbuffer(S.__webglColorRenderbuffer[ne]);S.__webglDepthRenderbuffer&&t.deleteRenderbuffer(S.__webglDepthRenderbuffer)}let z=T.textures;for(let ne=0,se=z.length;ne<se;ne++){let _e=i.get(z[ne]);_e.__webglTexture&&(t.deleteTexture(_e.__webglTexture),o.memory.textures--),i.remove(z[ne])}i.remove(T)}let P=0;function B(){P=0}function G(){return P}function D(T){P=T}function O(){let T=P;return T>=r.maxTextures&&Ge("WebGLTextures: Trying to use "+T+" texture units while this GPU supports only "+r.maxTextures),P+=1,T}function k(T){let S=[];return S.push(T.wrapS),S.push(T.wrapT),S.push(T.wrapR||0),S.push(T.magFilter),S.push(T.minFilter),S.push(T.anisotropy),S.push(T.internalFormat),S.push(T.format),S.push(T.type),S.push(T.generateMipmaps),S.push(T.premultiplyAlpha),S.push(T.flipY),S.push(T.unpackAlignment),S.push(T.colorSpace),S.join()}function q(T,S){let z=i.get(T);if(T.isVideoTexture&&Xe(T),T.isRenderTargetTexture===!1&&T.isExternalTexture!==!0&&T.version>0&&z.__version!==T.version){let ne=T.image;if(ne===null)Ge("WebGLRenderer: Texture marked for update but no image data found.");else if(ne.complete===!1)Ge("WebGLRenderer: Texture marked for update but image is incomplete");else{Ce(z,T,S);return}}else T.isExternalTexture&&(z.__webglTexture=T.sourceTexture?T.sourceTexture:null);n.bindTexture(t.TEXTURE_2D,z.__webglTexture,t.TEXTURE0+S)}function J(T,S){let z=i.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&z.__version!==T.version){Ce(z,T,S);return}else T.isExternalTexture&&(z.__webglTexture=T.sourceTexture?T.sourceTexture:null);n.bindTexture(t.TEXTURE_2D_ARRAY,z.__webglTexture,t.TEXTURE0+S)}function ce(T,S){let z=i.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&z.__version!==T.version){Ce(z,T,S);return}n.bindTexture(t.TEXTURE_3D,z.__webglTexture,t.TEXTURE0+S)}function he(T,S){let z=i.get(T);if(T.isCubeDepthTexture!==!0&&T.version>0&&z.__version!==T.version){Q(z,T,S);return}n.bindTexture(t.TEXTURE_CUBE_MAP,z.__webglTexture,t.TEXTURE0+S)}let Me={[go]:t.REPEAT,[Ei]:t.CLAMP_TO_EDGE,[Ou]:t.MIRRORED_REPEAT},Fe={[Xt]:t.NEAREST,[dy]:t.NEAREST_MIPMAP_NEAREST,[_l]:t.NEAREST_MIPMAP_LINEAR,[jt]:t.LINEAR,[yh]:t.LINEAR_MIPMAP_NEAREST,[Vr]:t.LINEAR_MIPMAP_LINEAR},Ze={[my]:t.NEVER,[yy]:t.ALWAYS,[gy]:t.LESS,[rd]:t.LEQUAL,[_y]:t.EQUAL,[sd]:t.GEQUAL,[vy]:t.GREATER,[xy]:t.NOTEQUAL};function Be(T,S){if(S.type===pi&&e.has("OES_texture_float_linear")===!1&&(S.magFilter===jt||S.magFilter===yh||S.magFilter===_l||S.magFilter===Vr||S.minFilter===jt||S.minFilter===yh||S.minFilter===_l||S.minFilter===Vr)&&Ge("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),t.texParameteri(T,t.TEXTURE_WRAP_S,Me[S.wrapS]),t.texParameteri(T,t.TEXTURE_WRAP_T,Me[S.wrapT]),(T===t.TEXTURE_3D||T===t.TEXTURE_2D_ARRAY)&&t.texParameteri(T,t.TEXTURE_WRAP_R,Me[S.wrapR]),t.texParameteri(T,t.TEXTURE_MAG_FILTER,Fe[S.magFilter]),t.texParameteri(T,t.TEXTURE_MIN_FILTER,Fe[S.minFilter]),S.compareFunction&&(t.texParameteri(T,t.TEXTURE_COMPARE_MODE,t.COMPARE_REF_TO_TEXTURE),t.texParameteri(T,t.TEXTURE_COMPARE_FUNC,Ze[S.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(S.magFilter===Xt||S.minFilter!==_l&&S.minFilter!==Vr||S.type===pi&&e.has("OES_texture_float_linear")===!1)return;if(S.anisotropy>1||i.get(S).__currentAnisotropy){let z=e.get("EXT_texture_filter_anisotropic");t.texParameterf(T,z.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(S.anisotropy,r.getMaxAnisotropy())),i.get(S).__currentAnisotropy=S.anisotropy}}}function K(T,S){let z=!1;T.__webglInit===void 0&&(T.__webglInit=!0,S.addEventListener("dispose",C));let ne=S.source,se=p.get(ne);se===void 0&&(se={},p.set(ne,se));let _e=k(S);if(_e!==T.__cacheKey){se[_e]===void 0&&(se[_e]={texture:t.createTexture(),usedTimes:0},o.memory.textures++,z=!0),se[_e].usedTimes++;let ye=se[T.__cacheKey];ye!==void 0&&(se[T.__cacheKey].usedTimes--,ye.usedTimes===0&&I(S)),T.__cacheKey=_e,T.__webglTexture=se[_e].texture}return z}function ve(T,S,z){return Math.floor(Math.floor(T/z)/S)}function pe(T,S,z,ne){let _e=T.updateRanges;if(_e.length===0)n.texSubImage2D(t.TEXTURE_2D,0,0,0,S.width,S.height,z,ne,S.data);else{_e.sort((Re,ue)=>Re.start-ue.start);let ye=0;for(let Re=1;Re<_e.length;Re++){let ue=_e[ye],xe=_e[Re],$e=ue.start+ue.count,qe=ve(xe.start,S.width,4),rt=ve(ue.start,S.width,4);xe.start<=$e+1&&qe===rt&&ve(xe.start+xe.count-1,S.width,4)===qe?ue.count=Math.max(ue.count,xe.start+xe.count-ue.start):(++ye,_e[ye]=xe)}_e.length=ye+1;let Z=n.getParameter(t.UNPACK_ROW_LENGTH),j=n.getParameter(t.UNPACK_SKIP_PIXELS),de=n.getParameter(t.UNPACK_SKIP_ROWS);n.pixelStorei(t.UNPACK_ROW_LENGTH,S.width);for(let Re=0,ue=_e.length;Re<ue;Re++){let xe=_e[Re],$e=Math.floor(xe.start/4),qe=Math.ceil(xe.count/4),rt=$e%S.width,R=Math.floor($e/S.width),ie=qe,V=1;n.pixelStorei(t.UNPACK_SKIP_PIXELS,rt),n.pixelStorei(t.UNPACK_SKIP_ROWS,R),n.texSubImage2D(t.TEXTURE_2D,0,rt,R,ie,V,z,ne,S.data)}T.clearUpdateRanges(),n.pixelStorei(t.UNPACK_ROW_LENGTH,Z),n.pixelStorei(t.UNPACK_SKIP_PIXELS,j),n.pixelStorei(t.UNPACK_SKIP_ROWS,de)}}function Ce(T,S,z){let ne=t.TEXTURE_2D;(S.isDataArrayTexture||S.isCompressedArrayTexture)&&(ne=t.TEXTURE_2D_ARRAY),S.isData3DTexture&&(ne=t.TEXTURE_3D);let se=K(T,S),_e=S.source;n.bindTexture(ne,T.__webglTexture,t.TEXTURE0+z);let ye=i.get(_e);if(_e.version!==ye.__version||se===!0){if(n.activeTexture(t.TEXTURE0+z),(typeof ImageBitmap<"u"&&S.image instanceof ImageBitmap)===!1){let V=it.getPrimaries(it.workingColorSpace),fe=S.colorSpace===tr?null:it.getPrimaries(S.colorSpace),le=S.colorSpace===tr||V===fe?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,S.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,le)}n.pixelStorei(t.UNPACK_ALIGNMENT,S.unpackAlignment);let j=_(S.image,!1,r.maxTextureSize);j=ge(S,j);let de=s.convert(S.format,S.colorSpace),Re=s.convert(S.type),ue=y(S.internalFormat,de,Re,S.normalized,S.colorSpace,S.isVideoTexture);Be(ne,S);let xe,$e=S.mipmaps,qe=S.isVideoTexture!==!0,rt=ye.__version===void 0||se===!0,R=_e.dataReady,ie=E(S,j);if(S.isDepthTexture)ue=A(S.format===Gr,S.type),rt&&(qe?n.texStorage2D(t.TEXTURE_2D,1,ue,j.width,j.height):n.texImage2D(t.TEXTURE_2D,0,ue,j.width,j.height,0,de,Re,null));else if(S.isDataTexture)if($e.length>0){qe&&rt&&n.texStorage2D(t.TEXTURE_2D,ie,ue,$e[0].width,$e[0].height);for(let V=0,fe=$e.length;V<fe;V++)xe=$e[V],qe?R&&n.texSubImage2D(t.TEXTURE_2D,V,0,0,xe.width,xe.height,de,Re,xe.data):n.texImage2D(t.TEXTURE_2D,V,ue,xe.width,xe.height,0,de,Re,xe.data);S.generateMipmaps=!1}else qe?(rt&&n.texStorage2D(t.TEXTURE_2D,ie,ue,j.width,j.height),R&&pe(S,j,de,Re)):n.texImage2D(t.TEXTURE_2D,0,ue,j.width,j.height,0,de,Re,j.data);else if(S.isCompressedTexture)if(S.isCompressedArrayTexture){qe&&rt&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ie,ue,$e[0].width,$e[0].height,j.depth);for(let V=0,fe=$e.length;V<fe;V++)if(xe=$e[V],S.format!==Qn)if(de!==null)if(qe){if(R)if(S.layerUpdates.size>0){let le=Qm(xe.width,xe.height,S.format,S.type);for(let te of S.layerUpdates){let Ee=xe.data.subarray(te*le/xe.data.BYTES_PER_ELEMENT,(te+1)*le/xe.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,V,0,0,te,xe.width,xe.height,1,de,Ee)}S.clearLayerUpdates()}else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,V,0,0,0,xe.width,xe.height,j.depth,de,xe.data)}else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY,V,ue,xe.width,xe.height,j.depth,0,xe.data,0,0);else Ge("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else qe?R&&n.texSubImage3D(t.TEXTURE_2D_ARRAY,V,0,0,0,xe.width,xe.height,j.depth,de,Re,xe.data):n.texImage3D(t.TEXTURE_2D_ARRAY,V,ue,xe.width,xe.height,j.depth,0,de,Re,xe.data)}else{qe&&rt&&n.texStorage2D(t.TEXTURE_2D,ie,ue,$e[0].width,$e[0].height);for(let V=0,fe=$e.length;V<fe;V++)xe=$e[V],S.format!==Qn?de!==null?qe?R&&n.compressedTexSubImage2D(t.TEXTURE_2D,V,0,0,xe.width,xe.height,de,xe.data):n.compressedTexImage2D(t.TEXTURE_2D,V,ue,xe.width,xe.height,0,xe.data):Ge("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):qe?R&&n.texSubImage2D(t.TEXTURE_2D,V,0,0,xe.width,xe.height,de,Re,xe.data):n.texImage2D(t.TEXTURE_2D,V,ue,xe.width,xe.height,0,de,Re,xe.data)}else if(S.isDataArrayTexture)if(qe){if(rt&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ie,ue,j.width,j.height,j.depth),R)if(S.layerUpdates.size>0){let V=Qm(j.width,j.height,S.format,S.type);for(let fe of S.layerUpdates){let le=j.data.subarray(fe*V/j.data.BYTES_PER_ELEMENT,(fe+1)*V/j.data.BYTES_PER_ELEMENT);n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,fe,j.width,j.height,1,de,Re,le)}S.clearLayerUpdates()}else n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,0,j.width,j.height,j.depth,de,Re,j.data)}else n.texImage3D(t.TEXTURE_2D_ARRAY,0,ue,j.width,j.height,j.depth,0,de,Re,j.data);else if(S.isData3DTexture)qe?(rt&&n.texStorage3D(t.TEXTURE_3D,ie,ue,j.width,j.height,j.depth),R&&n.texSubImage3D(t.TEXTURE_3D,0,0,0,0,j.width,j.height,j.depth,de,Re,j.data)):n.texImage3D(t.TEXTURE_3D,0,ue,j.width,j.height,j.depth,0,de,Re,j.data);else if(S.isFramebufferTexture){if(rt)if(qe)n.texStorage2D(t.TEXTURE_2D,ie,ue,j.width,j.height);else{let V=j.width,fe=j.height;for(let le=0;le<ie;le++)n.texImage2D(t.TEXTURE_2D,le,ue,V,fe,0,de,Re,null),V>>=1,fe>>=1}}else if(S.isHTMLTexture){if("texElementImage2D"in t){let V=t.canvas;if(V.hasAttribute("layoutsubtree")||V.setAttribute("layoutsubtree","true"),j.parentNode!==V){V.appendChild(j),f.add(S),V.onpaint=We=>{let vt=We.changedElements;for(let lt of f)vt.includes(lt.image)&&(lt.needsUpdate=!0)},V.requestPaint();return}let fe=0,le=t.RGBA,te=t.RGBA,Ee=t.UNSIGNED_BYTE;t.texElementImage2D(t.TEXTURE_2D,fe,le,te,Ee,j),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE)}}else if($e.length>0){if(qe&&rt){let V=st($e[0]);n.texStorage2D(t.TEXTURE_2D,ie,ue,V.width,V.height)}for(let V=0,fe=$e.length;V<fe;V++)xe=$e[V],qe?R&&n.texSubImage2D(t.TEXTURE_2D,V,0,0,de,Re,xe):n.texImage2D(t.TEXTURE_2D,V,ue,de,Re,xe);S.generateMipmaps=!1}else if(qe){if(rt){let V=st(j);n.texStorage2D(t.TEXTURE_2D,ie,ue,V.width,V.height)}R&&n.texSubImage2D(t.TEXTURE_2D,0,0,0,de,Re,j)}else n.texImage2D(t.TEXTURE_2D,0,ue,de,Re,j);h(S)&&m(ne),ye.__version=_e.version,S.onUpdate&&S.onUpdate(S)}T.__version=S.version}function Q(T,S,z){if(S.image.length!==6)return;let ne=K(T,S),se=S.source;n.bindTexture(t.TEXTURE_CUBE_MAP,T.__webglTexture,t.TEXTURE0+z);let _e=i.get(se);if(se.version!==_e.__version||ne===!0){n.activeTexture(t.TEXTURE0+z);let ye=it.getPrimaries(it.workingColorSpace),Z=S.colorSpace===tr?null:it.getPrimaries(S.colorSpace),j=S.colorSpace===tr||ye===Z?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,S.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),n.pixelStorei(t.UNPACK_ALIGNMENT,S.unpackAlignment),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,j);let de=S.isCompressedTexture||S.image[0].isCompressedTexture,Re=S.image[0]&&S.image[0].isDataTexture,ue=[];for(let te=0;te<6;te++)!de&&!Re?ue[te]=_(S.image[te],!0,r.maxCubemapSize):ue[te]=Re?S.image[te].image:S.image[te],ue[te]=ge(S,ue[te]);let xe=ue[0],$e=s.convert(S.format,S.colorSpace),qe=s.convert(S.type),rt=y(S.internalFormat,$e,qe,S.normalized,S.colorSpace),R=S.isVideoTexture!==!0,ie=_e.__version===void 0||ne===!0,V=se.dataReady,fe=E(S,xe);Be(t.TEXTURE_CUBE_MAP,S);let le;if(de){R&&ie&&n.texStorage2D(t.TEXTURE_CUBE_MAP,fe,rt,xe.width,xe.height);for(let te=0;te<6;te++){le=ue[te].mipmaps;for(let Ee=0;Ee<le.length;Ee++){let We=le[Ee];S.format!==Qn?$e!==null?R?V&&n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ee,0,0,We.width,We.height,$e,We.data):n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ee,rt,We.width,We.height,0,We.data):Ge("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):R?V&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ee,0,0,We.width,We.height,$e,qe,We.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ee,rt,We.width,We.height,0,$e,qe,We.data)}}}else{if(le=S.mipmaps,R&&ie){le.length>0&&fe++;let te=st(ue[0]);n.texStorage2D(t.TEXTURE_CUBE_MAP,fe,rt,te.width,te.height)}for(let te=0;te<6;te++)if(Re){R?V&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,0,0,ue[te].width,ue[te].height,$e,qe,ue[te].data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,rt,ue[te].width,ue[te].height,0,$e,qe,ue[te].data);for(let Ee=0;Ee<le.length;Ee++){let vt=le[Ee].image[te].image;R?V&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ee+1,0,0,vt.width,vt.height,$e,qe,vt.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ee+1,rt,vt.width,vt.height,0,$e,qe,vt.data)}}else{R?V&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,0,0,$e,qe,ue[te]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,rt,$e,qe,ue[te]);for(let Ee=0;Ee<le.length;Ee++){let We=le[Ee];R?V&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ee+1,0,0,$e,qe,We.image[te]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ee+1,rt,$e,qe,We.image[te])}}}h(S)&&m(t.TEXTURE_CUBE_MAP),_e.__version=se.version,S.onUpdate&&S.onUpdate(S)}T.__version=S.version}function re(T,S,z,ne,se,_e){let ye=s.convert(z.format,z.colorSpace),Z=s.convert(z.type),j=y(z.internalFormat,ye,Z,z.normalized,z.colorSpace),de=i.get(S),Re=i.get(z);if(Re.__renderTarget=S,!de.__hasExternalTextures){let ue=Math.max(1,S.width>>_e),xe=Math.max(1,S.height>>_e);se===t.TEXTURE_3D||se===t.TEXTURE_2D_ARRAY?n.texImage3D(se,_e,j,ue,xe,S.depth,0,ye,Z,null):n.texImage2D(se,_e,j,ue,xe,0,ye,Z,null)}n.bindFramebuffer(t.FRAMEBUFFER,T),Ue(S)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,ne,se,Re.__webglTexture,0,Ve(S)):(se===t.TEXTURE_2D||se>=t.TEXTURE_CUBE_MAP_POSITIVE_X&&se<=t.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&t.framebufferTexture2D(t.FRAMEBUFFER,ne,se,Re.__webglTexture,_e),n.bindFramebuffer(t.FRAMEBUFFER,null)}function Se(T,S,z){if(t.bindRenderbuffer(t.RENDERBUFFER,T),S.depthBuffer){let ne=S.depthTexture,se=ne&&ne.isDepthTexture?ne.type:null,_e=A(S.stencilBuffer,se),ye=S.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;Ue(S)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,Ve(S),_e,S.width,S.height):z?t.renderbufferStorageMultisample(t.RENDERBUFFER,Ve(S),_e,S.width,S.height):t.renderbufferStorage(t.RENDERBUFFER,_e,S.width,S.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,ye,t.RENDERBUFFER,T)}else{let ne=S.textures;for(let se=0;se<ne.length;se++){let _e=ne[se],ye=s.convert(_e.format,_e.colorSpace),Z=s.convert(_e.type),j=y(_e.internalFormat,ye,Z,_e.normalized,_e.colorSpace);Ue(S)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,Ve(S),j,S.width,S.height):z?t.renderbufferStorageMultisample(t.RENDERBUFFER,Ve(S),j,S.width,S.height):t.renderbufferStorage(t.RENDERBUFFER,j,S.width,S.height)}}t.bindRenderbuffer(t.RENDERBUFFER,null)}function we(T,S,z){let ne=S.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(t.FRAMEBUFFER,T),!(S.depthTexture&&S.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let se=i.get(S.depthTexture);if(se.__renderTarget=S,(!se.__webglTexture||S.depthTexture.image.width!==S.width||S.depthTexture.image.height!==S.height)&&(S.depthTexture.image.width=S.width,S.depthTexture.image.height=S.height,S.depthTexture.needsUpdate=!0),ne){if(se.__webglInit===void 0&&(se.__webglInit=!0,S.depthTexture.addEventListener("dispose",C)),se.__webglTexture===void 0){se.__webglTexture=t.createTexture(),n.bindTexture(t.TEXTURE_CUBE_MAP,se.__webglTexture),Be(t.TEXTURE_CUBE_MAP,S.depthTexture);let de=s.convert(S.depthTexture.format),Re=s.convert(S.depthTexture.type),ue;S.depthTexture.format===Ti?ue=t.DEPTH_COMPONENT24:S.depthTexture.format===Gr&&(ue=t.DEPTH24_STENCIL8);for(let xe=0;xe<6;xe++)t.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+xe,0,ue,S.width,S.height,0,de,Re,null)}}else q(S.depthTexture,0);let _e=se.__webglTexture,ye=Ve(S),Z=ne?t.TEXTURE_CUBE_MAP_POSITIVE_X+z:t.TEXTURE_2D,j=S.depthTexture.format===Gr?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;if(S.depthTexture.format===Ti)Ue(S)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,j,Z,_e,0,ye):t.framebufferTexture2D(t.FRAMEBUFFER,j,Z,_e,0);else if(S.depthTexture.format===Gr)Ue(S)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,j,Z,_e,0,ye):t.framebufferTexture2D(t.FRAMEBUFFER,j,Z,_e,0);else throw new Error("Unknown depthTexture format")}function Y(T){let S=i.get(T),z=T.isWebGLCubeRenderTarget===!0;if(S.__boundDepthTexture!==T.depthTexture){let ne=T.depthTexture;if(S.__depthDisposeCallback&&S.__depthDisposeCallback(),ne){let se=()=>{delete S.__boundDepthTexture,delete S.__depthDisposeCallback,ne.removeEventListener("dispose",se)};ne.addEventListener("dispose",se),S.__depthDisposeCallback=se}S.__boundDepthTexture=ne}if(T.depthTexture&&!S.__autoAllocateDepthBuffer)if(z)for(let ne=0;ne<6;ne++)we(S.__webglFramebuffer[ne],T,ne);else{let ne=T.texture.mipmaps;ne&&ne.length>0?we(S.__webglFramebuffer[0],T,0):we(S.__webglFramebuffer,T,0)}else if(z){S.__webglDepthbuffer=[];for(let ne=0;ne<6;ne++)if(n.bindFramebuffer(t.FRAMEBUFFER,S.__webglFramebuffer[ne]),S.__webglDepthbuffer[ne]===void 0)S.__webglDepthbuffer[ne]=t.createRenderbuffer(),Se(S.__webglDepthbuffer[ne],T,!1);else{let se=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,_e=S.__webglDepthbuffer[ne];t.bindRenderbuffer(t.RENDERBUFFER,_e),t.framebufferRenderbuffer(t.FRAMEBUFFER,se,t.RENDERBUFFER,_e)}}else{let ne=T.texture.mipmaps;if(ne&&ne.length>0?n.bindFramebuffer(t.FRAMEBUFFER,S.__webglFramebuffer[0]):n.bindFramebuffer(t.FRAMEBUFFER,S.__webglFramebuffer),S.__webglDepthbuffer===void 0)S.__webglDepthbuffer=t.createRenderbuffer(),Se(S.__webglDepthbuffer,T,!1);else{let se=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,_e=S.__webglDepthbuffer;t.bindRenderbuffer(t.RENDERBUFFER,_e),t.framebufferRenderbuffer(t.FRAMEBUFFER,se,t.RENDERBUFFER,_e)}}n.bindFramebuffer(t.FRAMEBUFFER,null)}function ee(T,S,z){let ne=i.get(T);S!==void 0&&re(ne.__webglFramebuffer,T,T.texture,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,0),z!==void 0&&Y(T)}function $(T){let S=T.texture,z=i.get(T),ne=i.get(S);T.addEventListener("dispose",x);let se=T.textures,_e=T.isWebGLCubeRenderTarget===!0,ye=se.length>1;if(ye||(ne.__webglTexture===void 0&&(ne.__webglTexture=t.createTexture()),ne.__version=S.version,o.memory.textures++),_e){z.__webglFramebuffer=[];for(let Z=0;Z<6;Z++)if(S.mipmaps&&S.mipmaps.length>0){z.__webglFramebuffer[Z]=[];for(let j=0;j<S.mipmaps.length;j++)z.__webglFramebuffer[Z][j]=t.createFramebuffer()}else z.__webglFramebuffer[Z]=t.createFramebuffer()}else{if(S.mipmaps&&S.mipmaps.length>0){z.__webglFramebuffer=[];for(let Z=0;Z<S.mipmaps.length;Z++)z.__webglFramebuffer[Z]=t.createFramebuffer()}else z.__webglFramebuffer=t.createFramebuffer();if(ye)for(let Z=0,j=se.length;Z<j;Z++){let de=i.get(se[Z]);de.__webglTexture===void 0&&(de.__webglTexture=t.createTexture(),o.memory.textures++)}if(T.samples>0&&Ue(T)===!1){z.__webglMultisampledFramebuffer=t.createFramebuffer(),z.__webglColorRenderbuffer=[],n.bindFramebuffer(t.FRAMEBUFFER,z.__webglMultisampledFramebuffer);for(let Z=0;Z<se.length;Z++){let j=se[Z];z.__webglColorRenderbuffer[Z]=t.createRenderbuffer(),t.bindRenderbuffer(t.RENDERBUFFER,z.__webglColorRenderbuffer[Z]);let de=s.convert(j.format,j.colorSpace),Re=s.convert(j.type),ue=y(j.internalFormat,de,Re,j.normalized,j.colorSpace,T.isXRRenderTarget===!0),xe=Ve(T);t.renderbufferStorageMultisample(t.RENDERBUFFER,xe,ue,T.width,T.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Z,t.RENDERBUFFER,z.__webglColorRenderbuffer[Z])}t.bindRenderbuffer(t.RENDERBUFFER,null),T.depthBuffer&&(z.__webglDepthRenderbuffer=t.createRenderbuffer(),Se(z.__webglDepthRenderbuffer,T,!0)),n.bindFramebuffer(t.FRAMEBUFFER,null)}}if(_e){n.bindTexture(t.TEXTURE_CUBE_MAP,ne.__webglTexture),Be(t.TEXTURE_CUBE_MAP,S);for(let Z=0;Z<6;Z++)if(S.mipmaps&&S.mipmaps.length>0)for(let j=0;j<S.mipmaps.length;j++)re(z.__webglFramebuffer[Z][j],T,S,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,j);else re(z.__webglFramebuffer[Z],T,S,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Z,0);h(S)&&m(t.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(ye){for(let Z=0,j=se.length;Z<j;Z++){let de=se[Z],Re=i.get(de),ue=t.TEXTURE_2D;(T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(ue=T.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(ue,Re.__webglTexture),Be(ue,de),re(z.__webglFramebuffer,T,de,t.COLOR_ATTACHMENT0+Z,ue,0),h(de)&&m(ue)}n.unbindTexture()}else{let Z=t.TEXTURE_2D;if((T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(Z=T.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(Z,ne.__webglTexture),Be(Z,S),S.mipmaps&&S.mipmaps.length>0)for(let j=0;j<S.mipmaps.length;j++)re(z.__webglFramebuffer[j],T,S,t.COLOR_ATTACHMENT0,Z,j);else re(z.__webglFramebuffer,T,S,t.COLOR_ATTACHMENT0,Z,0);h(S)&&m(Z),n.unbindTexture()}T.depthBuffer&&Y(T)}function ae(T){let S=T.textures;for(let z=0,ne=S.length;z<ne;z++){let se=S[z];if(h(se)){let _e=v(T),ye=i.get(se).__webglTexture;n.bindTexture(_e,ye),m(_e),n.unbindTexture()}}}let oe=[],Le=[];function N(T){if(T.samples>0){if(Ue(T)===!1){let S=T.textures,z=T.width,ne=T.height,se=t.COLOR_BUFFER_BIT,_e=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,ye=i.get(T),Z=S.length>1;if(Z)for(let de=0;de<S.length;de++)n.bindFramebuffer(t.FRAMEBUFFER,ye.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+de,t.RENDERBUFFER,null),n.bindFramebuffer(t.FRAMEBUFFER,ye.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+de,t.TEXTURE_2D,null,0);n.bindFramebuffer(t.READ_FRAMEBUFFER,ye.__webglMultisampledFramebuffer);let j=T.texture.mipmaps;j&&j.length>0?n.bindFramebuffer(t.DRAW_FRAMEBUFFER,ye.__webglFramebuffer[0]):n.bindFramebuffer(t.DRAW_FRAMEBUFFER,ye.__webglFramebuffer);for(let de=0;de<S.length;de++){if(T.resolveDepthBuffer&&(T.depthBuffer&&(se|=t.DEPTH_BUFFER_BIT),T.stencilBuffer&&T.resolveStencilBuffer&&(se|=t.STENCIL_BUFFER_BIT)),Z){t.framebufferRenderbuffer(t.READ_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.RENDERBUFFER,ye.__webglColorRenderbuffer[de]);let Re=i.get(S[de]).__webglTexture;t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,Re,0)}t.blitFramebuffer(0,0,z,ne,0,0,z,ne,se,t.NEAREST),l===!0&&(oe.length=0,Le.length=0,oe.push(t.COLOR_ATTACHMENT0+de),T.depthBuffer&&T.resolveDepthBuffer===!1&&(oe.push(_e),Le.push(_e),t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,Le)),t.invalidateFramebuffer(t.READ_FRAMEBUFFER,oe))}if(n.bindFramebuffer(t.READ_FRAMEBUFFER,null),n.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),Z)for(let de=0;de<S.length;de++){n.bindFramebuffer(t.FRAMEBUFFER,ye.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+de,t.RENDERBUFFER,ye.__webglColorRenderbuffer[de]);let Re=i.get(S[de]).__webglTexture;n.bindFramebuffer(t.FRAMEBUFFER,ye.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+de,t.TEXTURE_2D,Re,0)}n.bindFramebuffer(t.DRAW_FRAMEBUFFER,ye.__webglMultisampledFramebuffer)}else if(T.depthBuffer&&T.resolveDepthBuffer===!1&&l){let S=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,[S])}}}function Ve(T){return Math.min(r.maxSamples,T.samples)}function Ue(T){let S=i.get(T);return T.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&S.__useRenderToTexture!==!1}function Xe(T){let S=o.render.frame;d.get(T)!==S&&(d.set(T,S),T.update())}function ge(T,S){let z=T.colorSpace,ne=T.format,se=T.type;return T.isCompressedTexture===!0||T.isVideoTexture===!0||z!==Va&&z!==tr&&(it.getTransfer(z)===ct?(ne!==Qn||se!==Tn)&&Ge("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):He("WebGLTextures: Unsupported texture color space:",z)),S}function st(T){return typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement?(c.width=T.naturalWidth||T.width,c.height=T.naturalHeight||T.height):typeof VideoFrame<"u"&&T instanceof VideoFrame?(c.width=T.displayWidth,c.height=T.displayHeight):(c.width=T.width,c.height=T.height),c}this.allocateTextureUnit=O,this.resetTextureUnits=B,this.getTextureUnits=G,this.setTextureUnits=D,this.setTexture2D=q,this.setTexture2DArray=J,this.setTexture3D=ce,this.setTextureCube=he,this.rebindTextures=ee,this.setupRenderTarget=$,this.updateRenderTargetMipmap=ae,this.updateMultisampleRenderTarget=N,this.setupDepthRenderbuffer=Y,this.setupFrameBufferTexture=re,this.useMultisampledRTT=Ue,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function HC(t,e){function n(i,r=tr){let s,o=it.getTransfer(r);if(i===Tn)return t.UNSIGNED_BYTE;if(i===Mh)return t.UNSIGNED_SHORT_4_4_4_4;if(i===wh)return t.UNSIGNED_SHORT_5_5_5_1;if(i===zm)return t.UNSIGNED_INT_5_9_9_9_REV;if(i===Vm)return t.UNSIGNED_INT_10F_11F_11F_REV;if(i===Bm)return t.BYTE;if(i===km)return t.SHORT;if(i===Do)return t.UNSIGNED_SHORT;if(i===Sh)return t.INT;if(i===fi)return t.UNSIGNED_INT;if(i===pi)return t.FLOAT;if(i===Ri)return t.HALF_FLOAT;if(i===Gm)return t.ALPHA;if(i===Hm)return t.RGB;if(i===Qn)return t.RGBA;if(i===Ti)return t.DEPTH_COMPONENT;if(i===Gr)return t.DEPTH_STENCIL;if(i===Wm)return t.RED;if(i===Eh)return t.RED_INTEGER;if(i===Hr)return t.RG;if(i===Th)return t.RG_INTEGER;if(i===bh)return t.RGBA_INTEGER;if(i===vl||i===xl||i===yl||i===Sl)if(o===ct)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===vl)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===xl)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===yl)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===Sl)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===vl)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===xl)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===yl)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===Sl)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Ah||i===Ch||i===Rh||i===Ph)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===Ah)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Ch)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===Rh)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===Ph)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===Ih||i===Lh||i===Nh||i===Dh||i===Uh||i===Ml||i===Fh)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===Ih||i===Lh)return o===ct?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===Nh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===Dh)return s.COMPRESSED_R11_EAC;if(i===Uh)return s.COMPRESSED_SIGNED_R11_EAC;if(i===Ml)return s.COMPRESSED_RG11_EAC;if(i===Fh)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===Oh||i===Bh||i===kh||i===zh||i===Vh||i===Gh||i===Hh||i===Wh||i===Xh||i===qh||i===Yh||i===Zh||i===$h||i===Jh)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===Oh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===Bh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===kh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===zh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Vh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===Gh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===Hh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Wh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===Xh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===qh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===Yh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===Zh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===$h)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===Jh)return o===ct?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Kh||i===jh||i===Qh)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===Kh)return o===ct?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===jh)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===Qh)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===ed||i===td||i===wl||i===nd)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===ed)return s.COMPRESSED_RED_RGTC1_EXT;if(i===td)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===wl)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===nd)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===Uo?t.UNSIGNED_INT_24_8:t[i]!==void 0?t[i]:null}return{convert:n}}var WC=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,XC=`
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

}`,vg=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,n){if(this.texture===null){let i=new Ka(e.texture);(e.depthNear!==n.depthNear||e.depthFar!==n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let n=e.cameras[0].viewport,i=new kn({vertexShader:WC,fragmentShader:XC,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new en(new Ur(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},xg=class extends bi{constructor(e,n){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,c=null,d=null,f=null,u=null,p=null,g=null,M=typeof XRWebGLBinding<"u",_=new vg,h={},m=n.getContextAttributes(),v=null,y=null,A=[],E=[],C=new Te,x=null,b=new En;b.viewport=new Ct;let I=new En;I.viewport=new Ct;let L=[b,I],P=new mh,B=null,G=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(K){let ve=A[K];return ve===void 0&&(ve=new Mo,A[K]=ve),ve.getTargetRaySpace()},this.getControllerGrip=function(K){let ve=A[K];return ve===void 0&&(ve=new Mo,A[K]=ve),ve.getGripSpace()},this.getHand=function(K){let ve=A[K];return ve===void 0&&(ve=new Mo,A[K]=ve),ve.getHandSpace()};function D(K){let ve=E.indexOf(K.inputSource);if(ve===-1)return;let pe=A[ve];pe!==void 0&&(pe.update(K.inputSource,K.frame,c||o),pe.dispatchEvent({type:K.type,data:K.inputSource}))}function O(){r.removeEventListener("select",D),r.removeEventListener("selectstart",D),r.removeEventListener("selectend",D),r.removeEventListener("squeeze",D),r.removeEventListener("squeezestart",D),r.removeEventListener("squeezeend",D),r.removeEventListener("end",O),r.removeEventListener("inputsourceschange",k);for(let K=0;K<A.length;K++){let ve=E[K];ve!==null&&(E[K]=null,A[K].disconnect(ve))}B=null,G=null,_.reset();for(let K in h)delete h[K];e.setRenderTarget(v),p=null,u=null,f=null,r=null,y=null,Be.stop(),i.isPresenting=!1,e.setPixelRatio(x),e.setSize(C.width,C.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(K){s=K,i.isPresenting===!0&&Ge("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(K){a=K,i.isPresenting===!0&&Ge("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(K){c=K},this.getBaseLayer=function(){return u!==null?u:p},this.getBinding=function(){return f===null&&M&&(f=new XRWebGLBinding(r,n)),f},this.getFrame=function(){return g},this.getSession=function(){return r},this.setSession=async function(K){if(r=K,r!==null){if(v=e.getRenderTarget(),r.addEventListener("select",D),r.addEventListener("selectstart",D),r.addEventListener("selectend",D),r.addEventListener("squeeze",D),r.addEventListener("squeezestart",D),r.addEventListener("squeezeend",D),r.addEventListener("end",O),r.addEventListener("inputsourceschange",k),m.xrCompatible!==!0&&await n.makeXRCompatible(),x=e.getPixelRatio(),e.getSize(C),M&&"createProjectionLayer"in XRWebGLBinding.prototype){let pe=null,Ce=null,Q=null;m.depth&&(Q=m.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,pe=m.stencil?Gr:Ti,Ce=m.stencil?Uo:fi);let re={colorFormat:n.RGBA8,depthFormat:Q,scaleFactor:s};f=this.getBinding(),u=f.createProjectionLayer(re),r.updateRenderState({layers:[u]}),e.setPixelRatio(1),e.setSize(u.textureWidth,u.textureHeight,!1),y=new On(u.textureWidth,u.textureHeight,{format:Qn,type:Tn,depthTexture:new er(u.textureWidth,u.textureHeight,Ce,void 0,void 0,void 0,void 0,void 0,void 0,pe),stencilBuffer:m.stencil,colorSpace:e.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1,resolveStencilBuffer:u.ignoreDepthValues===!1})}else{let pe={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:s};p=new XRWebGLLayer(r,n,pe),r.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),y=new On(p.framebufferWidth,p.framebufferHeight,{format:Qn,type:Tn,colorSpace:e.outputColorSpace,stencilBuffer:m.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),Be.setContext(r),Be.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function k(K){for(let ve=0;ve<K.removed.length;ve++){let pe=K.removed[ve],Ce=E.indexOf(pe);Ce>=0&&(E[Ce]=null,A[Ce].disconnect(pe))}for(let ve=0;ve<K.added.length;ve++){let pe=K.added[ve],Ce=E.indexOf(pe);if(Ce===-1){for(let re=0;re<A.length;re++)if(re>=E.length){E.push(pe),Ce=re;break}else if(E[re]===null){E[re]=pe,Ce=re;break}if(Ce===-1)break}let Q=A[Ce];Q&&Q.connect(pe)}}let q=new U,J=new U;function ce(K,ve,pe){q.setFromMatrixPosition(ve.matrixWorld),J.setFromMatrixPosition(pe.matrixWorld);let Ce=q.distanceTo(J),Q=ve.projectionMatrix.elements,re=pe.projectionMatrix.elements,Se=Q[14]/(Q[10]-1),we=Q[14]/(Q[10]+1),Y=(Q[9]+1)/Q[5],ee=(Q[9]-1)/Q[5],$=(Q[8]-1)/Q[0],ae=(re[8]+1)/re[0],oe=Se*$,Le=Se*ae,N=Ce/(-$+ae),Ve=N*-$;if(ve.matrixWorld.decompose(K.position,K.quaternion,K.scale),K.translateX(Ve),K.translateZ(N),K.matrixWorld.compose(K.position,K.quaternion,K.scale),K.matrixWorldInverse.copy(K.matrixWorld).invert(),Q[10]===-1)K.projectionMatrix.copy(ve.projectionMatrix),K.projectionMatrixInverse.copy(ve.projectionMatrixInverse);else{let Ue=Se+N,Xe=we+N,ge=oe-Ve,st=Le+(Ce-Ve),T=Y*we/Xe*Ue,S=ee*we/Xe*Ue;K.projectionMatrix.makePerspective(ge,st,T,S,Ue,Xe),K.projectionMatrixInverse.copy(K.projectionMatrix).invert()}}function he(K,ve){ve===null?K.matrixWorld.copy(K.matrix):K.matrixWorld.multiplyMatrices(ve.matrixWorld,K.matrix),K.matrixWorldInverse.copy(K.matrixWorld).invert()}this.updateCamera=function(K){if(r===null)return;let ve=K.near,pe=K.far;_.texture!==null&&(_.depthNear>0&&(ve=_.depthNear),_.depthFar>0&&(pe=_.depthFar)),P.near=I.near=b.near=ve,P.far=I.far=b.far=pe,(B!==P.near||G!==P.far)&&(r.updateRenderState({depthNear:P.near,depthFar:P.far}),B=P.near,G=P.far),P.layers.mask=K.layers.mask|6,b.layers.mask=P.layers.mask&-5,I.layers.mask=P.layers.mask&-3;let Ce=K.parent,Q=P.cameras;he(P,Ce);for(let re=0;re<Q.length;re++)he(Q[re],Ce);Q.length===2?ce(P,b,I):P.projectionMatrix.copy(b.projectionMatrix),Me(K,P,Ce)};function Me(K,ve,pe){pe===null?K.matrix.copy(ve.matrixWorld):(K.matrix.copy(pe.matrixWorld),K.matrix.invert(),K.matrix.multiply(ve.matrixWorld)),K.matrix.decompose(K.position,K.quaternion,K.scale),K.updateMatrixWorld(!0),K.projectionMatrix.copy(ve.projectionMatrix),K.projectionMatrixInverse.copy(ve.projectionMatrixInverse),K.isPerspectiveCamera&&(K.fov=xo*2*Math.atan(1/K.projectionMatrix.elements[5]),K.zoom=1)}this.getCamera=function(){return P},this.getFoveation=function(){if(!(u===null&&p===null))return l},this.setFoveation=function(K){l=K,u!==null&&(u.fixedFoveation=K),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=K)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(P)},this.getCameraTexture=function(K){return h[K]};let Fe=null;function Ze(K,ve){if(d=ve.getViewerPose(c||o),g=ve,d!==null){let pe=d.views;p!==null&&(e.setRenderTargetFramebuffer(y,p.framebuffer),e.setRenderTarget(y));let Ce=!1;pe.length!==P.cameras.length&&(P.cameras.length=0,Ce=!0);for(let we=0;we<pe.length;we++){let Y=pe[we],ee=null;if(p!==null)ee=p.getViewport(Y);else{let ae=f.getViewSubImage(u,Y);ee=ae.viewport,we===0&&(e.setRenderTargetTextures(y,ae.colorTexture,ae.depthStencilTexture),e.setRenderTarget(y))}let $=L[we];$===void 0&&($=new En,$.layers.enable(we),$.viewport=new Ct,L[we]=$),$.matrix.fromArray(Y.transform.matrix),$.matrix.decompose($.position,$.quaternion,$.scale),$.projectionMatrix.fromArray(Y.projectionMatrix),$.projectionMatrixInverse.copy($.projectionMatrix).invert(),$.viewport.set(ee.x,ee.y,ee.width,ee.height),we===0&&(P.matrix.copy($.matrix),P.matrix.decompose(P.position,P.quaternion,P.scale)),Ce===!0&&P.cameras.push($)}let Q=r.enabledFeatures;if(Q&&Q.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&M){f=i.getBinding();let we=f.getDepthInformation(pe[0]);we&&we.isValid&&we.texture&&_.init(we,r.renderState)}if(Q&&Q.includes("camera-access")&&M){e.state.unbindTexture(),f=i.getBinding();for(let we=0;we<pe.length;we++){let Y=pe[we].camera;if(Y){let ee=h[Y];ee||(ee=new Ka,h[Y]=ee);let $=f.getCameraImage(Y);ee.sourceTexture=$}}}}for(let pe=0;pe<A.length;pe++){let Ce=E[pe],Q=A[pe];Ce!==null&&Q!==void 0&&Q.update(Ce,ve,c||o)}Fe&&Fe(K,ve),ve.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:ve}),g=null}let Be=new eS;Be.setAnimationLoop(Ze),this.setAnimationLoop=function(K){Fe=K},this.dispose=function(){}}},qC=new Mt,oS=new Je;oS.set(-1,0,0,0,1,0,0,0,1);function YC(t,e){function n(_,h){_.matrixAutoUpdate===!0&&_.updateMatrix(),h.value.copy(_.matrix)}function i(_,h){h.color.getRGB(_.fogColor.value,Jm(t)),h.isFog?(_.fogNear.value=h.near,_.fogFar.value=h.far):h.isFogExp2&&(_.fogDensity.value=h.density)}function r(_,h,m,v,y){h.isNodeMaterial?h.uniformsNeedUpdate=!1:h.isMeshBasicMaterial?s(_,h):h.isMeshLambertMaterial?(s(_,h),h.envMap&&(_.envMapIntensity.value=h.envMapIntensity)):h.isMeshToonMaterial?(s(_,h),f(_,h)):h.isMeshPhongMaterial?(s(_,h),d(_,h),h.envMap&&(_.envMapIntensity.value=h.envMapIntensity)):h.isMeshStandardMaterial?(s(_,h),u(_,h),h.isMeshPhysicalMaterial&&p(_,h,y)):h.isMeshMatcapMaterial?(s(_,h),g(_,h)):h.isMeshDepthMaterial?s(_,h):h.isMeshDistanceMaterial?(s(_,h),M(_,h)):h.isMeshNormalMaterial?s(_,h):h.isLineBasicMaterial?(o(_,h),h.isLineDashedMaterial&&a(_,h)):h.isPointsMaterial?l(_,h,m,v):h.isSpriteMaterial?c(_,h):h.isShadowMaterial?(_.color.value.copy(h.color),_.opacity.value=h.opacity):h.isShaderMaterial&&(h.uniformsNeedUpdate=!1)}function s(_,h){_.opacity.value=h.opacity,h.color&&_.diffuse.value.copy(h.color),h.emissive&&_.emissive.value.copy(h.emissive).multiplyScalar(h.emissiveIntensity),h.map&&(_.map.value=h.map,n(h.map,_.mapTransform)),h.alphaMap&&(_.alphaMap.value=h.alphaMap,n(h.alphaMap,_.alphaMapTransform)),h.bumpMap&&(_.bumpMap.value=h.bumpMap,n(h.bumpMap,_.bumpMapTransform),_.bumpScale.value=h.bumpScale,h.side===vn&&(_.bumpScale.value*=-1)),h.normalMap&&(_.normalMap.value=h.normalMap,n(h.normalMap,_.normalMapTransform),_.normalScale.value.copy(h.normalScale),h.side===vn&&_.normalScale.value.negate()),h.displacementMap&&(_.displacementMap.value=h.displacementMap,n(h.displacementMap,_.displacementMapTransform),_.displacementScale.value=h.displacementScale,_.displacementBias.value=h.displacementBias),h.emissiveMap&&(_.emissiveMap.value=h.emissiveMap,n(h.emissiveMap,_.emissiveMapTransform)),h.specularMap&&(_.specularMap.value=h.specularMap,n(h.specularMap,_.specularMapTransform)),h.alphaTest>0&&(_.alphaTest.value=h.alphaTest);let m=e.get(h),v=m.envMap,y=m.envMapRotation;v&&(_.envMap.value=v,_.envMapRotation.value.setFromMatrix4(qC.makeRotationFromEuler(y)).transpose(),v.isCubeTexture&&v.isRenderTargetTexture===!1&&_.envMapRotation.value.premultiply(oS),_.reflectivity.value=h.reflectivity,_.ior.value=h.ior,_.refractionRatio.value=h.refractionRatio),h.lightMap&&(_.lightMap.value=h.lightMap,_.lightMapIntensity.value=h.lightMapIntensity,n(h.lightMap,_.lightMapTransform)),h.aoMap&&(_.aoMap.value=h.aoMap,_.aoMapIntensity.value=h.aoMapIntensity,n(h.aoMap,_.aoMapTransform))}function o(_,h){_.diffuse.value.copy(h.color),_.opacity.value=h.opacity,h.map&&(_.map.value=h.map,n(h.map,_.mapTransform))}function a(_,h){_.dashSize.value=h.dashSize,_.totalSize.value=h.dashSize+h.gapSize,_.scale.value=h.scale}function l(_,h,m,v){_.diffuse.value.copy(h.color),_.opacity.value=h.opacity,_.size.value=h.size*m,_.scale.value=v*.5,h.map&&(_.map.value=h.map,n(h.map,_.uvTransform)),h.alphaMap&&(_.alphaMap.value=h.alphaMap,n(h.alphaMap,_.alphaMapTransform)),h.alphaTest>0&&(_.alphaTest.value=h.alphaTest)}function c(_,h){_.diffuse.value.copy(h.color),_.opacity.value=h.opacity,_.rotation.value=h.rotation,h.map&&(_.map.value=h.map,n(h.map,_.mapTransform)),h.alphaMap&&(_.alphaMap.value=h.alphaMap,n(h.alphaMap,_.alphaMapTransform)),h.alphaTest>0&&(_.alphaTest.value=h.alphaTest)}function d(_,h){_.specular.value.copy(h.specular),_.shininess.value=Math.max(h.shininess,1e-4)}function f(_,h){h.gradientMap&&(_.gradientMap.value=h.gradientMap)}function u(_,h){_.metalness.value=h.metalness,h.metalnessMap&&(_.metalnessMap.value=h.metalnessMap,n(h.metalnessMap,_.metalnessMapTransform)),_.roughness.value=h.roughness,h.roughnessMap&&(_.roughnessMap.value=h.roughnessMap,n(h.roughnessMap,_.roughnessMapTransform)),h.envMap&&(_.envMapIntensity.value=h.envMapIntensity)}function p(_,h,m){_.ior.value=h.ior,h.sheen>0&&(_.sheenColor.value.copy(h.sheenColor).multiplyScalar(h.sheen),_.sheenRoughness.value=h.sheenRoughness,h.sheenColorMap&&(_.sheenColorMap.value=h.sheenColorMap,n(h.sheenColorMap,_.sheenColorMapTransform)),h.sheenRoughnessMap&&(_.sheenRoughnessMap.value=h.sheenRoughnessMap,n(h.sheenRoughnessMap,_.sheenRoughnessMapTransform))),h.clearcoat>0&&(_.clearcoat.value=h.clearcoat,_.clearcoatRoughness.value=h.clearcoatRoughness,h.clearcoatMap&&(_.clearcoatMap.value=h.clearcoatMap,n(h.clearcoatMap,_.clearcoatMapTransform)),h.clearcoatRoughnessMap&&(_.clearcoatRoughnessMap.value=h.clearcoatRoughnessMap,n(h.clearcoatRoughnessMap,_.clearcoatRoughnessMapTransform)),h.clearcoatNormalMap&&(_.clearcoatNormalMap.value=h.clearcoatNormalMap,n(h.clearcoatNormalMap,_.clearcoatNormalMapTransform),_.clearcoatNormalScale.value.copy(h.clearcoatNormalScale),h.side===vn&&_.clearcoatNormalScale.value.negate())),h.dispersion>0&&(_.dispersion.value=h.dispersion),h.iridescence>0&&(_.iridescence.value=h.iridescence,_.iridescenceIOR.value=h.iridescenceIOR,_.iridescenceThicknessMinimum.value=h.iridescenceThicknessRange[0],_.iridescenceThicknessMaximum.value=h.iridescenceThicknessRange[1],h.iridescenceMap&&(_.iridescenceMap.value=h.iridescenceMap,n(h.iridescenceMap,_.iridescenceMapTransform)),h.iridescenceThicknessMap&&(_.iridescenceThicknessMap.value=h.iridescenceThicknessMap,n(h.iridescenceThicknessMap,_.iridescenceThicknessMapTransform))),h.transmission>0&&(_.transmission.value=h.transmission,_.transmissionSamplerMap.value=m.texture,_.transmissionSamplerSize.value.set(m.width,m.height),h.transmissionMap&&(_.transmissionMap.value=h.transmissionMap,n(h.transmissionMap,_.transmissionMapTransform)),_.thickness.value=h.thickness,h.thicknessMap&&(_.thicknessMap.value=h.thicknessMap,n(h.thicknessMap,_.thicknessMapTransform)),_.attenuationDistance.value=h.attenuationDistance,_.attenuationColor.value.copy(h.attenuationColor)),h.anisotropy>0&&(_.anisotropyVector.value.set(h.anisotropy*Math.cos(h.anisotropyRotation),h.anisotropy*Math.sin(h.anisotropyRotation)),h.anisotropyMap&&(_.anisotropyMap.value=h.anisotropyMap,n(h.anisotropyMap,_.anisotropyMapTransform))),_.specularIntensity.value=h.specularIntensity,_.specularColor.value.copy(h.specularColor),h.specularColorMap&&(_.specularColorMap.value=h.specularColorMap,n(h.specularColorMap,_.specularColorMapTransform)),h.specularIntensityMap&&(_.specularIntensityMap.value=h.specularIntensityMap,n(h.specularIntensityMap,_.specularIntensityMapTransform))}function g(_,h){h.matcap&&(_.matcap.value=h.matcap)}function M(_,h){let m=e.get(h).light;_.referencePosition.value.setFromMatrixPosition(m.matrixWorld),_.nearDistance.value=m.shadow.camera.near,_.farDistance.value=m.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function ZC(t,e,n,i){let r={},s={},o=[],a=t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);function l(m,v){let y=v.program;i.uniformBlockBinding(m,y)}function c(m,v){let y=r[m.id];y===void 0&&(g(m),y=d(m),r[m.id]=y,m.addEventListener("dispose",_));let A=v.program;i.updateUBOMapping(m,A);let E=e.render.frame;s[m.id]!==E&&(u(m),s[m.id]=E)}function d(m){let v=f();m.__bindingPointIndex=v;let y=t.createBuffer(),A=m.__size,E=m.usage;return t.bindBuffer(t.UNIFORM_BUFFER,y),t.bufferData(t.UNIFORM_BUFFER,A,E),t.bindBuffer(t.UNIFORM_BUFFER,null),t.bindBufferBase(t.UNIFORM_BUFFER,v,y),y}function f(){for(let m=0;m<a;m++)if(o.indexOf(m)===-1)return o.push(m),m;return He("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function u(m){let v=r[m.id],y=m.uniforms,A=m.__cache;t.bindBuffer(t.UNIFORM_BUFFER,v);for(let E=0,C=y.length;E<C;E++){let x=Array.isArray(y[E])?y[E]:[y[E]];for(let b=0,I=x.length;b<I;b++){let L=x[b];if(p(L,E,b,A)===!0){let P=L.__offset,B=Array.isArray(L.value)?L.value:[L.value],G=0;for(let D=0;D<B.length;D++){let O=B[D],k=M(O);typeof O=="number"||typeof O=="boolean"?(L.__data[0]=O,t.bufferSubData(t.UNIFORM_BUFFER,P+G,L.__data)):O.isMatrix3?(L.__data[0]=O.elements[0],L.__data[1]=O.elements[1],L.__data[2]=O.elements[2],L.__data[3]=0,L.__data[4]=O.elements[3],L.__data[5]=O.elements[4],L.__data[6]=O.elements[5],L.__data[7]=0,L.__data[8]=O.elements[6],L.__data[9]=O.elements[7],L.__data[10]=O.elements[8],L.__data[11]=0):ArrayBuffer.isView(O)?L.__data.set(new O.constructor(O.buffer,O.byteOffset,L.__data.length)):(O.toArray(L.__data,G),G+=k.storage/Float32Array.BYTES_PER_ELEMENT)}t.bufferSubData(t.UNIFORM_BUFFER,P,L.__data)}}}t.bindBuffer(t.UNIFORM_BUFFER,null)}function p(m,v,y,A){let E=m.value,C=v+"_"+y;if(A[C]===void 0)return typeof E=="number"||typeof E=="boolean"?A[C]=E:ArrayBuffer.isView(E)?A[C]=E.slice():A[C]=E.clone(),!0;{let x=A[C];if(typeof E=="number"||typeof E=="boolean"){if(x!==E)return A[C]=E,!0}else{if(ArrayBuffer.isView(E))return!0;if(x.equals(E)===!1)return x.copy(E),!0}}return!1}function g(m){let v=m.uniforms,y=0,A=16;for(let C=0,x=v.length;C<x;C++){let b=Array.isArray(v[C])?v[C]:[v[C]];for(let I=0,L=b.length;I<L;I++){let P=b[I],B=Array.isArray(P.value)?P.value:[P.value];for(let G=0,D=B.length;G<D;G++){let O=B[G],k=M(O),q=y%A,J=q%k.boundary,ce=q+J;y+=J,ce!==0&&A-ce<k.storage&&(y+=A-ce),P.__data=new Float32Array(k.storage/Float32Array.BYTES_PER_ELEMENT),P.__offset=y,y+=k.storage}}}let E=y%A;return E>0&&(y+=A-E),m.__size=y,m.__cache={},this}function M(m){let v={boundary:0,storage:0};return typeof m=="number"||typeof m=="boolean"?(v.boundary=4,v.storage=4):m.isVector2?(v.boundary=8,v.storage=8):m.isVector3||m.isColor?(v.boundary=16,v.storage=12):m.isVector4?(v.boundary=16,v.storage=16):m.isMatrix3?(v.boundary=48,v.storage=48):m.isMatrix4?(v.boundary=64,v.storage=64):m.isTexture?Ge("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(m)?(v.boundary=16,v.storage=m.byteLength):Ge("WebGLRenderer: Unsupported uniform value type.",m),v}function _(m){let v=m.target;v.removeEventListener("dispose",_);let y=o.indexOf(v.__bindingPointIndex);o.splice(y,1),t.deleteBuffer(r[v.id]),delete r[v.id],delete s[v.id]}function h(){for(let m in r)t.deleteBuffer(r[m]);o=[],r={},s={}}return{bind:l,update:c,dispose:h}}var $C=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Pi=null;function JC(){return Pi===null&&(Pi=new Hu($C,16,16,Hr,Ri),Pi.name="DFG_LUT",Pi.minFilter=jt,Pi.magFilter=jt,Pi.wrapS=Ei,Pi.wrapT=Ei,Pi.generateMipmaps=!1,Pi.needsUpdate=!0),Pi}var ud=class{constructor(e={}){let{canvas:n=Sy(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:d="default",failIfMajorPerformanceCaveat:f=!1,reversedDepthBuffer:u=!1,outputBufferType:p=Tn}=e;this.isWebGLRenderer=!0;let g;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");g=i.getContextAttributes().alpha}else g=o;let M=p,_=new Set([bh,Th,Eh]),h=new Set([Tn,fi,Do,Uo,Mh,wh]),m=new Uint32Array(4),v=new Int32Array(4),y=new U,A=null,E=null,C=[],x=[],b=null;this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=di,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let I=this,L=!1,P=null;this._outputColorSpace=Jt;let B=0,G=0,D=null,O=-1,k=null,q=new Ct,J=new Ct,ce=null,he=new Ye(0),Me=0,Fe=n.width,Ze=n.height,Be=1,K=null,ve=null,pe=new Ct(0,0,Fe,Ze),Ce=new Ct(0,0,Fe,Ze),Q=!1,re=new Eo,Se=!1,we=!1,Y=new Mt,ee=new U,$=new Ct,ae={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},oe=!1;function Le(){return D===null?Be:1}let N=i;function Ve(w,F){return n.getContext(w,F)}try{let w={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:d,failIfMajorPerformanceCaveat:f};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${_h}`),n.addEventListener("webglcontextlost",te,!1),n.addEventListener("webglcontextrestored",Ee,!1),n.addEventListener("webglcontextcreationerror",We,!1),N===null){let F="webgl2";if(N=Ve(F,w),N===null)throw Ve(F)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(w){throw He("WebGLRenderer: "+w.message),w}let Ue,Xe,ge,st,T,S,z,ne,se,_e,ye,Z,j,de,Re,ue,xe,$e,qe,rt,R,ie,V;function fe(){Ue=new iA(N),Ue.init(),R=new HC(N,Ue),Xe=new $b(N,Ue,e,R),ge=new VC(N,Ue),Xe.reversedDepthBuffer&&u&&ge.buffers.depth.setReversed(!0),st=new oA(N),T=new AC,S=new GC(N,Ue,ge,T,Xe,R,st),z=new nA(I),ne=new uE(N),ie=new Yb(N,ne),se=new rA(N,ne,st,ie),_e=new lA(N,se,ne,ie,st),$e=new aA(N,Xe,S),Re=new Jb(T),ye=new bC(I,z,Ue,Xe,ie,Re),Z=new YC(I,T),j=new RC,de=new UC(Ue),xe=new qb(I,z,ge,_e,g,l),ue=new zC(I,_e,Xe),V=new ZC(N,st,Xe,ge),qe=new Zb(N,Ue,st),rt=new sA(N,Ue,st),st.programs=ye.programs,I.capabilities=Xe,I.extensions=Ue,I.properties=T,I.renderLists=j,I.shadowMap=ue,I.state=ge,I.info=st}fe(),M!==Tn&&(b=new uA(M,n.width,n.height,r,s));let le=new xg(I,N);this.xr=le,this.getContext=function(){return N},this.getContextAttributes=function(){return N.getContextAttributes()},this.forceContextLoss=function(){let w=Ue.get("WEBGL_lose_context");w&&w.loseContext()},this.forceContextRestore=function(){let w=Ue.get("WEBGL_lose_context");w&&w.restoreContext()},this.getPixelRatio=function(){return Be},this.setPixelRatio=function(w){w!==void 0&&(Be=w,this.setSize(Fe,Ze,!1))},this.getSize=function(w){return w.set(Fe,Ze)},this.setSize=function(w,F,X=!0){if(le.isPresenting){Ge("WebGLRenderer: Can't change size while VR device is presenting.");return}Fe=w,Ze=F,n.width=Math.floor(w*Be),n.height=Math.floor(F*Be),X===!0&&(n.style.width=w+"px",n.style.height=F+"px"),b!==null&&b.setSize(n.width,n.height),this.setViewport(0,0,w,F)},this.getDrawingBufferSize=function(w){return w.set(Fe*Be,Ze*Be).floor()},this.setDrawingBufferSize=function(w,F,X){Fe=w,Ze=F,Be=X,n.width=Math.floor(w*X),n.height=Math.floor(F*X),this.setViewport(0,0,w,F)},this.setEffects=function(w){if(M===Tn){He("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(w){for(let F=0;F<w.length;F++)if(w[F].isOutputPass===!0){Ge("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}b.setEffects(w||[])},this.getCurrentViewport=function(w){return w.copy(q)},this.getViewport=function(w){return w.copy(pe)},this.setViewport=function(w,F,X,H){w.isVector4?pe.set(w.x,w.y,w.z,w.w):pe.set(w,F,X,H),ge.viewport(q.copy(pe).multiplyScalar(Be).round())},this.getScissor=function(w){return w.copy(Ce)},this.setScissor=function(w,F,X,H){w.isVector4?Ce.set(w.x,w.y,w.z,w.w):Ce.set(w,F,X,H),ge.scissor(J.copy(Ce).multiplyScalar(Be).round())},this.getScissorTest=function(){return Q},this.setScissorTest=function(w){ge.setScissorTest(Q=w)},this.setOpaqueSort=function(w){K=w},this.setTransparentSort=function(w){ve=w},this.getClearColor=function(w){return w.copy(xe.getClearColor())},this.setClearColor=function(){xe.setClearColor(...arguments)},this.getClearAlpha=function(){return xe.getClearAlpha()},this.setClearAlpha=function(){xe.setClearAlpha(...arguments)},this.clear=function(w=!0,F=!0,X=!0){let H=0;if(w){let W=!1;if(D!==null){let Pe=D.texture.format;W=_.has(Pe)}if(W){let Pe=D.texture.type,Ne=h.has(Pe),Ae=xe.getClearColor(),Oe=xe.getClearAlpha(),ke=Ae.r,Ke=Ae.g,Qe=Ae.b;Ne?(m[0]=ke,m[1]=Ke,m[2]=Qe,m[3]=Oe,N.clearBufferuiv(N.COLOR,0,m)):(v[0]=ke,v[1]=Ke,v[2]=Qe,v[3]=Oe,N.clearBufferiv(N.COLOR,0,v))}else H|=N.COLOR_BUFFER_BIT}F&&(H|=N.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),X&&(H|=N.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),H!==0&&N.clear(H)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(w){w.setRenderer(this),P=w},this.dispose=function(){n.removeEventListener("webglcontextlost",te,!1),n.removeEventListener("webglcontextrestored",Ee,!1),n.removeEventListener("webglcontextcreationerror",We,!1),xe.dispose(),j.dispose(),de.dispose(),T.dispose(),z.dispose(),_e.dispose(),ie.dispose(),V.dispose(),ye.dispose(),le.dispose(),le.removeEventListener("sessionstart",Sg),le.removeEventListener("sessionend",Mg),Xr.stop()};function te(w){w.preventDefault(),qm("WebGLRenderer: Context Lost."),L=!0}function Ee(){qm("WebGLRenderer: Context Restored."),L=!1;let w=st.autoReset,F=ue.enabled,X=ue.autoUpdate,H=ue.needsUpdate,W=ue.type;fe(),st.autoReset=w,ue.enabled=F,ue.autoUpdate=X,ue.needsUpdate=H,ue.type=W}function We(w){He("WebGLRenderer: A WebGL context could not be created. Reason: ",w.statusMessage)}function vt(w){let F=w.target;F.removeEventListener("dispose",vt),lt(F)}function lt(w){tn(w),T.remove(w)}function tn(w){let F=T.get(w).programs;F!==void 0&&(F.forEach(function(X){ye.releaseProgram(X)}),w.isShaderMaterial&&ye.releaseShaderCache(w))}this.renderBufferDirect=function(w,F,X,H,W,Pe){F===null&&(F=ae);let Ne=W.isMesh&&W.matrixWorld.determinant()<0,Ae=mS(w,F,X,H,W);ge.setMaterial(H,Ne);let Oe=X.index,ke=1;if(H.wireframe===!0){if(Oe=se.getWireframeAttribute(X),Oe===void 0)return;ke=2}let Ke=X.drawRange,Qe=X.attributes.position,ze=Ke.start*ke,ht=(Ke.start+Ke.count)*ke;Pe!==null&&(ze=Math.max(ze,Pe.start*ke),ht=Math.min(ht,(Pe.start+Pe.count)*ke)),Oe!==null?(ze=Math.max(ze,0),ht=Math.min(ht,Oe.count)):Qe!=null&&(ze=Math.max(ze,0),ht=Math.min(ht,Qe.count));let Lt=ht-ze;if(Lt<0||Lt===1/0)return;ie.setup(W,H,Ae,X,Oe);let Pt,dt=qe;if(Oe!==null&&(Pt=ne.get(Oe),dt=rt,dt.setIndex(Pt)),W.isMesh)H.wireframe===!0?(ge.setLineWidth(H.wireframeLinewidth*Le()),dt.setMode(N.LINES)):dt.setMode(N.TRIANGLES);else if(W.isLine){let nn=H.linewidth;nn===void 0&&(nn=1),ge.setLineWidth(nn*Le()),W.isLineSegments?dt.setMode(N.LINES):W.isLineLoop?dt.setMode(N.LINE_LOOP):dt.setMode(N.LINE_STRIP)}else W.isPoints?dt.setMode(N.POINTS):W.isSprite&&dt.setMode(N.TRIANGLES);if(W.isBatchedMesh)if(Ue.get("WEBGL_multi_draw"))dt.renderMultiDraw(W._multiDrawStarts,W._multiDrawCounts,W._multiDrawCount);else{let nn=W._multiDrawStarts,Ie=W._multiDrawCounts,An=W._multiDrawCount,ot=Oe?ne.get(Oe).bytesPerElement:1,Gn=T.get(H).currentProgram.getUniforms();for(let gi=0;gi<An;gi++)Gn.setValue(N,"_gl_DrawID",gi),dt.render(nn[gi]/ot,Ie[gi])}else if(W.isInstancedMesh)dt.renderInstances(ze,Lt,W.count);else if(X.isInstancedBufferGeometry){let nn=X._maxInstanceCount!==void 0?X._maxInstanceCount:1/0,Ie=Math.min(X.instanceCount,nn);dt.renderInstances(ze,Lt,Ie)}else dt.render(ze,Lt)};function Rt(w,F,X){w.transparent===!0&&w.side===jn&&w.forceSinglePass===!1?(w.side=vn,w.needsUpdate=!0,Rl(w,F,X),w.side=Ji,w.needsUpdate=!0,Rl(w,F,X),w.side=jn):Rl(w,F,X)}this.compile=function(w,F,X=null){X===null&&(X=w),E=de.get(X),E.init(F),x.push(E),X.traverseVisible(function(W){W.isLight&&W.layers.test(F.layers)&&(E.pushLight(W),W.castShadow&&E.pushShadow(W))}),w!==X&&w.traverseVisible(function(W){W.isLight&&W.layers.test(F.layers)&&(E.pushLight(W),W.castShadow&&E.pushShadow(W))}),E.setupLights();let H=new Set;return w.traverse(function(W){if(!(W.isMesh||W.isPoints||W.isLine||W.isSprite))return;let Pe=W.material;if(Pe)if(Array.isArray(Pe))for(let Ne=0;Ne<Pe.length;Ne++){let Ae=Pe[Ne];Rt(Ae,X,W),H.add(Ae)}else Rt(Pe,X,W),H.add(Pe)}),E=x.pop(),H},this.compileAsync=function(w,F,X=null){let H=this.compile(w,F,X);return new Promise(W=>{function Pe(){if(H.forEach(function(Ne){T.get(Ne).currentProgram.isReady()&&H.delete(Ne)}),H.size===0){W(w);return}setTimeout(Pe,10)}Ue.get("KHR_parallel_shader_compile")!==null?Pe():setTimeout(Pe,10)})};let md=null;function fS(w){md&&md(w)}function Sg(){Xr.stop()}function Mg(){Xr.start()}let Xr=new eS;Xr.setAnimationLoop(fS),typeof self<"u"&&Xr.setContext(self),this.setAnimationLoop=function(w){md=w,le.setAnimationLoop(w),w===null?Xr.stop():Xr.start()},le.addEventListener("sessionstart",Sg),le.addEventListener("sessionend",Mg),this.render=function(w,F){if(F!==void 0&&F.isCamera!==!0){He("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(L===!0)return;P!==null&&P.renderStart(w,F);let X=le.enabled===!0&&le.isPresenting===!0,H=b!==null&&(D===null||X)&&b.begin(I,D);if(w.matrixWorldAutoUpdate===!0&&w.updateMatrixWorld(),F.parent===null&&F.matrixWorldAutoUpdate===!0&&F.updateMatrixWorld(),le.enabled===!0&&le.isPresenting===!0&&(b===null||b.isCompositing()===!1)&&(le.cameraAutoUpdate===!0&&le.updateCamera(F),F=le.getCamera()),w.isScene===!0&&w.onBeforeRender(I,w,F,D),E=de.get(w,x.length),E.init(F),E.state.textureUnits=S.getTextureUnits(),x.push(E),Y.multiplyMatrices(F.projectionMatrix,F.matrixWorldInverse),re.setFromProjectionMatrix(Y,hi,F.reversedDepth),we=this.localClippingEnabled,Se=Re.init(this.clippingPlanes,we),A=j.get(w,C.length),A.init(),C.push(A),le.enabled===!0&&le.isPresenting===!0){let Ne=I.xr.getDepthSensingMesh();Ne!==null&&gd(Ne,F,-1/0,I.sortObjects)}gd(w,F,0,I.sortObjects),A.finish(),I.sortObjects===!0&&A.sort(K,ve),oe=le.enabled===!1||le.isPresenting===!1||le.hasDepthSensing()===!1,oe&&xe.addToRenderList(A,w),this.info.render.frame++,Se===!0&&Re.beginShadows();let W=E.state.shadowsArray;if(ue.render(W,w,F),Se===!0&&Re.endShadows(),this.info.autoReset===!0&&this.info.reset(),(H&&b.hasRenderPass())===!1){let Ne=A.opaque,Ae=A.transmissive;if(E.setupLights(),F.isArrayCamera){let Oe=F.cameras;if(Ae.length>0)for(let ke=0,Ke=Oe.length;ke<Ke;ke++){let Qe=Oe[ke];Eg(Ne,Ae,w,Qe)}oe&&xe.render(w);for(let ke=0,Ke=Oe.length;ke<Ke;ke++){let Qe=Oe[ke];wg(A,w,Qe,Qe.viewport)}}else Ae.length>0&&Eg(Ne,Ae,w,F),oe&&xe.render(w),wg(A,w,F)}D!==null&&G===0&&(S.updateMultisampleRenderTarget(D),S.updateRenderTargetMipmap(D)),H&&b.end(I),w.isScene===!0&&w.onAfterRender(I,w,F),ie.resetDefaultState(),O=-1,k=null,x.pop(),x.length>0?(E=x[x.length-1],S.setTextureUnits(E.state.textureUnits),Se===!0&&Re.setGlobalState(I.clippingPlanes,E.state.camera)):E=null,C.pop(),C.length>0?A=C[C.length-1]:A=null,P!==null&&P.renderEnd()};function gd(w,F,X,H){if(w.visible===!1)return;if(w.layers.test(F.layers)){if(w.isGroup)X=w.renderOrder;else if(w.isLOD)w.autoUpdate===!0&&w.update(F);else if(w.isLightProbeGrid)E.pushLightProbeGrid(w);else if(w.isLight)E.pushLight(w),w.castShadow&&E.pushShadow(w);else if(w.isSprite){if(!w.frustumCulled||re.intersectsSprite(w)){H&&$.setFromMatrixPosition(w.matrixWorld).applyMatrix4(Y);let Ne=_e.update(w),Ae=w.material;Ae.visible&&A.push(w,Ne,Ae,X,$.z,null)}}else if((w.isMesh||w.isLine||w.isPoints)&&(!w.frustumCulled||re.intersectsObject(w))){let Ne=_e.update(w),Ae=w.material;if(H&&(w.boundingSphere!==void 0?(w.boundingSphere===null&&w.computeBoundingSphere(),$.copy(w.boundingSphere.center)):(Ne.boundingSphere===null&&Ne.computeBoundingSphere(),$.copy(Ne.boundingSphere.center)),$.applyMatrix4(w.matrixWorld).applyMatrix4(Y)),Array.isArray(Ae)){let Oe=Ne.groups;for(let ke=0,Ke=Oe.length;ke<Ke;ke++){let Qe=Oe[ke],ze=Ae[Qe.materialIndex];ze&&ze.visible&&A.push(w,Ne,ze,X,$.z,Qe)}}else Ae.visible&&A.push(w,Ne,Ae,X,$.z,null)}}let Pe=w.children;for(let Ne=0,Ae=Pe.length;Ne<Ae;Ne++)gd(Pe[Ne],F,X,H)}function wg(w,F,X,H){let{opaque:W,transmissive:Pe,transparent:Ne}=w;E.setupLightsView(X),Se===!0&&Re.setGlobalState(I.clippingPlanes,X),H&&ge.viewport(q.copy(H)),W.length>0&&Cl(W,F,X),Pe.length>0&&Cl(Pe,F,X),Ne.length>0&&Cl(Ne,F,X),ge.buffers.depth.setTest(!0),ge.buffers.depth.setMask(!0),ge.buffers.color.setMask(!0),ge.setPolygonOffset(!1)}function Eg(w,F,X,H){if((X.isScene===!0?X.overrideMaterial:null)!==null)return;if(E.state.transmissionRenderTarget[H.id]===void 0){let ze=Ue.has("EXT_color_buffer_half_float")||Ue.has("EXT_color_buffer_float");E.state.transmissionRenderTarget[H.id]=new On(1,1,{generateMipmaps:!0,type:ze?Ri:Tn,minFilter:Vr,samples:Math.max(4,Xe.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:it.workingColorSpace})}let Pe=E.state.transmissionRenderTarget[H.id],Ne=H.viewport||q;Pe.setSize(Ne.z*I.transmissionResolutionScale,Ne.w*I.transmissionResolutionScale);let Ae=I.getRenderTarget(),Oe=I.getActiveCubeFace(),ke=I.getActiveMipmapLevel();I.setRenderTarget(Pe),I.getClearColor(he),Me=I.getClearAlpha(),Me<1&&I.setClearColor(16777215,.5),I.clear(),oe&&xe.render(X);let Ke=I.toneMapping;I.toneMapping=di;let Qe=H.viewport;if(H.viewport!==void 0&&(H.viewport=void 0),E.setupLightsView(H),Se===!0&&Re.setGlobalState(I.clippingPlanes,H),Cl(w,X,H),S.updateMultisampleRenderTarget(Pe),S.updateRenderTargetMipmap(Pe),Ue.has("WEBGL_multisampled_render_to_texture")===!1){let ze=!1;for(let ht=0,Lt=F.length;ht<Lt;ht++){let Pt=F[ht],{object:dt,geometry:nn,material:Ie,group:An}=Pt;if(Ie.side===jn&&dt.layers.test(H.layers)){let ot=Ie.side;Ie.side=vn,Ie.needsUpdate=!0,Tg(dt,X,H,nn,Ie,An),Ie.side=ot,Ie.needsUpdate=!0,ze=!0}}ze===!0&&(S.updateMultisampleRenderTarget(Pe),S.updateRenderTargetMipmap(Pe))}I.setRenderTarget(Ae,Oe,ke),I.setClearColor(he,Me),Qe!==void 0&&(H.viewport=Qe),I.toneMapping=Ke}function Cl(w,F,X){let H=F.isScene===!0?F.overrideMaterial:null;for(let W=0,Pe=w.length;W<Pe;W++){let Ne=w[W],{object:Ae,geometry:Oe,group:ke}=Ne,Ke=Ne.material;Ke.allowOverride===!0&&H!==null&&(Ke=H),Ae.layers.test(X.layers)&&Tg(Ae,F,X,Oe,Ke,ke)}}function Tg(w,F,X,H,W,Pe){w.onBeforeRender(I,F,X,H,W,Pe),w.modelViewMatrix.multiplyMatrices(X.matrixWorldInverse,w.matrixWorld),w.normalMatrix.getNormalMatrix(w.modelViewMatrix),W.onBeforeRender(I,F,X,H,w,Pe),W.transparent===!0&&W.side===jn&&W.forceSinglePass===!1?(W.side=vn,W.needsUpdate=!0,I.renderBufferDirect(X,F,H,W,w,Pe),W.side=Ji,W.needsUpdate=!0,I.renderBufferDirect(X,F,H,W,w,Pe),W.side=jn):I.renderBufferDirect(X,F,H,W,w,Pe),w.onAfterRender(I,F,X,H,W,Pe)}function Rl(w,F,X){F.isScene!==!0&&(F=ae);let H=T.get(w),W=E.state.lights,Pe=E.state.shadowsArray,Ne=W.state.version,Ae=ye.getParameters(w,W.state,Pe,F,X,E.state.lightProbeGridArray),Oe=ye.getProgramCacheKey(Ae),ke=H.programs;H.environment=w.isMeshStandardMaterial||w.isMeshLambertMaterial||w.isMeshPhongMaterial?F.environment:null,H.fog=F.fog;let Ke=w.isMeshStandardMaterial||w.isMeshLambertMaterial&&!w.envMap||w.isMeshPhongMaterial&&!w.envMap;H.envMap=z.get(w.envMap||H.environment,Ke),H.envMapRotation=H.environment!==null&&w.envMap===null?F.environmentRotation:w.envMapRotation,ke===void 0&&(w.addEventListener("dispose",vt),ke=new Map,H.programs=ke);let Qe=ke.get(Oe);if(Qe!==void 0){if(H.currentProgram===Qe&&H.lightsStateVersion===Ne)return Ag(w,Ae),Qe}else Ae.uniforms=ye.getUniforms(w),P!==null&&w.isNodeMaterial&&P.build(w,X,Ae),w.onBeforeCompile(Ae,I),Qe=ye.acquireProgram(Ae,Oe),ke.set(Oe,Qe),H.uniforms=Ae.uniforms;let ze=H.uniforms;return(!w.isShaderMaterial&&!w.isRawShaderMaterial||w.clipping===!0)&&(ze.clippingPlanes=Re.uniform),Ag(w,Ae),H.needsLights=_S(w),H.lightsStateVersion=Ne,H.needsLights&&(ze.ambientLightColor.value=W.state.ambient,ze.lightProbe.value=W.state.probe,ze.directionalLights.value=W.state.directional,ze.directionalLightShadows.value=W.state.directionalShadow,ze.spotLights.value=W.state.spot,ze.spotLightShadows.value=W.state.spotShadow,ze.rectAreaLights.value=W.state.rectArea,ze.ltc_1.value=W.state.rectAreaLTC1,ze.ltc_2.value=W.state.rectAreaLTC2,ze.pointLights.value=W.state.point,ze.pointLightShadows.value=W.state.pointShadow,ze.hemisphereLights.value=W.state.hemi,ze.directionalShadowMatrix.value=W.state.directionalShadowMatrix,ze.spotLightMatrix.value=W.state.spotLightMatrix,ze.spotLightMap.value=W.state.spotLightMap,ze.pointShadowMatrix.value=W.state.pointShadowMatrix),H.lightProbeGrid=E.state.lightProbeGridArray.length>0,H.currentProgram=Qe,H.uniformsList=null,Qe}function bg(w){if(w.uniformsList===null){let F=w.currentProgram.getUniforms();w.uniformsList=Oo.seqWithValue(F.seq,w.uniforms)}return w.uniformsList}function Ag(w,F){let X=T.get(w);X.outputColorSpace=F.outputColorSpace,X.batching=F.batching,X.batchingColor=F.batchingColor,X.instancing=F.instancing,X.instancingColor=F.instancingColor,X.instancingMorph=F.instancingMorph,X.skinning=F.skinning,X.morphTargets=F.morphTargets,X.morphNormals=F.morphNormals,X.morphColors=F.morphColors,X.morphTargetsCount=F.morphTargetsCount,X.numClippingPlanes=F.numClippingPlanes,X.numIntersection=F.numClipIntersection,X.vertexAlphas=F.vertexAlphas,X.vertexTangents=F.vertexTangents,X.toneMapping=F.toneMapping}function pS(w,F){if(w.length===0)return null;if(w.length===1)return w[0].texture!==null?w[0]:null;y.setFromMatrixPosition(F.matrixWorld);for(let X=0,H=w.length;X<H;X++){let W=w[X];if(W.texture!==null&&W.boundingBox.containsPoint(y))return W}return null}function mS(w,F,X,H,W){F.isScene!==!0&&(F=ae),S.resetTextureUnits();let Pe=F.fog,Ne=H.isMeshStandardMaterial||H.isMeshLambertMaterial||H.isMeshPhongMaterial?F.environment:null,Ae=D===null?I.outputColorSpace:D.isXRRenderTarget===!0?D.texture.colorSpace:it.workingColorSpace,Oe=H.isMeshStandardMaterial||H.isMeshLambertMaterial&&!H.envMap||H.isMeshPhongMaterial&&!H.envMap,ke=z.get(H.envMap||Ne,Oe),Ke=H.vertexColors===!0&&!!X.attributes.color&&X.attributes.color.itemSize===4,Qe=!!X.attributes.tangent&&(!!H.normalMap||H.anisotropy>0),ze=!!X.morphAttributes.position,ht=!!X.morphAttributes.normal,Lt=!!X.morphAttributes.color,Pt=di;H.toneMapped&&(D===null||D.isXRRenderTarget===!0)&&(Pt=I.toneMapping);let dt=X.morphAttributes.position||X.morphAttributes.normal||X.morphAttributes.color,nn=dt!==void 0?dt.length:0,Ie=T.get(H),An=E.state.lights;if(Se===!0&&(we===!0||w!==k)){let mt=w===k&&H.id===O;Re.setState(H,w,mt)}let ot=!1;H.version===Ie.__version?(Ie.needsLights&&Ie.lightsStateVersion!==An.state.version||Ie.outputColorSpace!==Ae||W.isBatchedMesh&&Ie.batching===!1||!W.isBatchedMesh&&Ie.batching===!0||W.isBatchedMesh&&Ie.batchingColor===!0&&W.colorTexture===null||W.isBatchedMesh&&Ie.batchingColor===!1&&W.colorTexture!==null||W.isInstancedMesh&&Ie.instancing===!1||!W.isInstancedMesh&&Ie.instancing===!0||W.isSkinnedMesh&&Ie.skinning===!1||!W.isSkinnedMesh&&Ie.skinning===!0||W.isInstancedMesh&&Ie.instancingColor===!0&&W.instanceColor===null||W.isInstancedMesh&&Ie.instancingColor===!1&&W.instanceColor!==null||W.isInstancedMesh&&Ie.instancingMorph===!0&&W.morphTexture===null||W.isInstancedMesh&&Ie.instancingMorph===!1&&W.morphTexture!==null||Ie.envMap!==ke||H.fog===!0&&Ie.fog!==Pe||Ie.numClippingPlanes!==void 0&&(Ie.numClippingPlanes!==Re.numPlanes||Ie.numIntersection!==Re.numIntersection)||Ie.vertexAlphas!==Ke||Ie.vertexTangents!==Qe||Ie.morphTargets!==ze||Ie.morphNormals!==ht||Ie.morphColors!==Lt||Ie.toneMapping!==Pt||Ie.morphTargetsCount!==nn||!!Ie.lightProbeGrid!=E.state.lightProbeGridArray.length>0)&&(ot=!0):(ot=!0,Ie.__version=H.version);let Gn=Ie.currentProgram;ot===!0&&(Gn=Rl(H,F,W),P&&H.isNodeMaterial&&P.onUpdateProgram(H,Gn,Ie));let gi=!1,nr=!1,Ms=!1,ft=Gn.getUniforms(),Nt=Ie.uniforms;if(ge.useProgram(Gn.program)&&(gi=!0,nr=!0,Ms=!0),H.id!==O&&(O=H.id,nr=!0),Ie.needsLights){let mt=pS(E.state.lightProbeGridArray,W);Ie.lightProbeGrid!==mt&&(Ie.lightProbeGrid=mt,nr=!0)}if(gi||k!==w){ge.buffers.depth.getReversed()&&w.reversedDepth!==!0&&(w._reversedDepth=!0,w.updateProjectionMatrix()),ft.setValue(N,"projectionMatrix",w.projectionMatrix),ft.setValue(N,"viewMatrix",w.matrixWorldInverse);let rr=ft.map.cameraPosition;rr!==void 0&&rr.setValue(N,ee.setFromMatrixPosition(w.matrixWorld)),Xe.logarithmicDepthBuffer&&ft.setValue(N,"logDepthBufFC",2/(Math.log(w.far+1)/Math.LN2)),(H.isMeshPhongMaterial||H.isMeshToonMaterial||H.isMeshLambertMaterial||H.isMeshBasicMaterial||H.isMeshStandardMaterial||H.isShaderMaterial)&&ft.setValue(N,"isOrthographic",w.isOrthographicCamera===!0),k!==w&&(k=w,nr=!0,Ms=!0)}if(Ie.needsLights&&(An.state.directionalShadowMap.length>0&&ft.setValue(N,"directionalShadowMap",An.state.directionalShadowMap,S),An.state.spotShadowMap.length>0&&ft.setValue(N,"spotShadowMap",An.state.spotShadowMap,S),An.state.pointShadowMap.length>0&&ft.setValue(N,"pointShadowMap",An.state.pointShadowMap,S)),W.isSkinnedMesh){ft.setOptional(N,W,"bindMatrix"),ft.setOptional(N,W,"bindMatrixInverse");let mt=W.skeleton;mt&&(mt.boneTexture===null&&mt.computeBoneTexture(),ft.setValue(N,"boneTexture",mt.boneTexture,S))}W.isBatchedMesh&&(ft.setOptional(N,W,"batchingTexture"),ft.setValue(N,"batchingTexture",W._matricesTexture,S),ft.setOptional(N,W,"batchingIdTexture"),ft.setValue(N,"batchingIdTexture",W._indirectTexture,S),ft.setOptional(N,W,"batchingColorTexture"),W._colorsTexture!==null&&ft.setValue(N,"batchingColorTexture",W._colorsTexture,S));let ir=X.morphAttributes;if((ir.position!==void 0||ir.normal!==void 0||ir.color!==void 0)&&$e.update(W,X,Gn),(nr||Ie.receiveShadow!==W.receiveShadow)&&(Ie.receiveShadow=W.receiveShadow,ft.setValue(N,"receiveShadow",W.receiveShadow)),(H.isMeshStandardMaterial||H.isMeshLambertMaterial||H.isMeshPhongMaterial)&&H.envMap===null&&F.environment!==null&&(Nt.envMapIntensity.value=F.environmentIntensity),Nt.dfgLUT!==void 0&&(Nt.dfgLUT.value=JC()),nr){if(ft.setValue(N,"toneMappingExposure",I.toneMappingExposure),Ie.needsLights&&gS(Nt,Ms),Pe&&H.fog===!0&&Z.refreshFogUniforms(Nt,Pe),Z.refreshMaterialUniforms(Nt,H,Be,Ze,E.state.transmissionRenderTarget[w.id]),Ie.needsLights&&Ie.lightProbeGrid){let mt=Ie.lightProbeGrid;Nt.probesSH.value=mt.texture,Nt.probesMin.value.copy(mt.boundingBox.min),Nt.probesMax.value.copy(mt.boundingBox.max),Nt.probesResolution.value.copy(mt.resolution)}Oo.upload(N,bg(Ie),Nt,S)}if(H.isShaderMaterial&&H.uniformsNeedUpdate===!0&&(Oo.upload(N,bg(Ie),Nt,S),H.uniformsNeedUpdate=!1),H.isSpriteMaterial&&ft.setValue(N,"center",W.center),ft.setValue(N,"modelViewMatrix",W.modelViewMatrix),ft.setValue(N,"normalMatrix",W.normalMatrix),ft.setValue(N,"modelMatrix",W.matrixWorld),H.uniformsGroups!==void 0){let mt=H.uniformsGroups;for(let rr=0,ws=mt.length;rr<ws;rr++){let Cg=mt[rr];V.update(Cg,Gn),V.bind(Cg,Gn)}}return Gn}function gS(w,F){w.ambientLightColor.needsUpdate=F,w.lightProbe.needsUpdate=F,w.directionalLights.needsUpdate=F,w.directionalLightShadows.needsUpdate=F,w.pointLights.needsUpdate=F,w.pointLightShadows.needsUpdate=F,w.spotLights.needsUpdate=F,w.spotLightShadows.needsUpdate=F,w.rectAreaLights.needsUpdate=F,w.hemisphereLights.needsUpdate=F}function _S(w){return w.isMeshLambertMaterial||w.isMeshToonMaterial||w.isMeshPhongMaterial||w.isMeshStandardMaterial||w.isShadowMaterial||w.isShaderMaterial&&w.lights===!0}this.getActiveCubeFace=function(){return B},this.getActiveMipmapLevel=function(){return G},this.getRenderTarget=function(){return D},this.setRenderTargetTextures=function(w,F,X){let H=T.get(w);H.__autoAllocateDepthBuffer=w.resolveDepthBuffer===!1,H.__autoAllocateDepthBuffer===!1&&(H.__useRenderToTexture=!1),T.get(w.texture).__webglTexture=F,T.get(w.depthTexture).__webglTexture=H.__autoAllocateDepthBuffer?void 0:X,H.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(w,F){let X=T.get(w);X.__webglFramebuffer=F,X.__useDefaultFramebuffer=F===void 0};let vS=N.createFramebuffer();this.setRenderTarget=function(w,F=0,X=0){D=w,B=F,G=X;let H=null,W=!1,Pe=!1;if(w){let Ae=T.get(w);if(Ae.__useDefaultFramebuffer!==void 0){ge.bindFramebuffer(N.FRAMEBUFFER,Ae.__webglFramebuffer),q.copy(w.viewport),J.copy(w.scissor),ce=w.scissorTest,ge.viewport(q),ge.scissor(J),ge.setScissorTest(ce),O=-1;return}else if(Ae.__webglFramebuffer===void 0)S.setupRenderTarget(w);else if(Ae.__hasExternalTextures)S.rebindTextures(w,T.get(w.texture).__webglTexture,T.get(w.depthTexture).__webglTexture);else if(w.depthBuffer){let Ke=w.depthTexture;if(Ae.__boundDepthTexture!==Ke){if(Ke!==null&&T.has(Ke)&&(w.width!==Ke.image.width||w.height!==Ke.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");S.setupDepthRenderbuffer(w)}}let Oe=w.texture;(Oe.isData3DTexture||Oe.isDataArrayTexture||Oe.isCompressedArrayTexture)&&(Pe=!0);let ke=T.get(w).__webglFramebuffer;w.isWebGLCubeRenderTarget?(Array.isArray(ke[F])?H=ke[F][X]:H=ke[F],W=!0):w.samples>0&&S.useMultisampledRTT(w)===!1?H=T.get(w).__webglMultisampledFramebuffer:Array.isArray(ke)?H=ke[X]:H=ke,q.copy(w.viewport),J.copy(w.scissor),ce=w.scissorTest}else q.copy(pe).multiplyScalar(Be).floor(),J.copy(Ce).multiplyScalar(Be).floor(),ce=Q;if(X!==0&&(H=vS),ge.bindFramebuffer(N.FRAMEBUFFER,H)&&ge.drawBuffers(w,H),ge.viewport(q),ge.scissor(J),ge.setScissorTest(ce),W){let Ae=T.get(w.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_CUBE_MAP_POSITIVE_X+F,Ae.__webglTexture,X)}else if(Pe){let Ae=F;for(let Oe=0;Oe<w.textures.length;Oe++){let ke=T.get(w.textures[Oe]);N.framebufferTextureLayer(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0+Oe,ke.__webglTexture,X,Ae)}}else if(w!==null&&X!==0){let Ae=T.get(w.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,Ae.__webglTexture,X)}O=-1},this.readRenderTargetPixels=function(w,F,X,H,W,Pe,Ne,Ae=0){if(!(w&&w.isWebGLRenderTarget)){He("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Oe=T.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&Ne!==void 0&&(Oe=Oe[Ne]),Oe){ge.bindFramebuffer(N.FRAMEBUFFER,Oe);try{let ke=w.textures[Ae],Ke=ke.format,Qe=ke.type;if(w.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+Ae),!Xe.textureFormatReadable(Ke)){He("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Xe.textureTypeReadable(Qe)){He("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}F>=0&&F<=w.width-H&&X>=0&&X<=w.height-W&&N.readPixels(F,X,H,W,R.convert(Ke),R.convert(Qe),Pe)}finally{let ke=D!==null?T.get(D).__webglFramebuffer:null;ge.bindFramebuffer(N.FRAMEBUFFER,ke)}}},this.readRenderTargetPixelsAsync=async function(w,F,X,H,W,Pe,Ne,Ae=0){if(!(w&&w.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Oe=T.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&Ne!==void 0&&(Oe=Oe[Ne]),Oe)if(F>=0&&F<=w.width-H&&X>=0&&X<=w.height-W){ge.bindFramebuffer(N.FRAMEBUFFER,Oe);let ke=w.textures[Ae],Ke=ke.format,Qe=ke.type;if(w.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+Ae),!Xe.textureFormatReadable(Ke))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Xe.textureTypeReadable(Qe))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let ze=N.createBuffer();N.bindBuffer(N.PIXEL_PACK_BUFFER,ze),N.bufferData(N.PIXEL_PACK_BUFFER,Pe.byteLength,N.STREAM_READ),N.readPixels(F,X,H,W,R.convert(Ke),R.convert(Qe),0);let ht=D!==null?T.get(D).__webglFramebuffer:null;ge.bindFramebuffer(N.FRAMEBUFFER,ht);let Lt=N.fenceSync(N.SYNC_GPU_COMMANDS_COMPLETE,0);return N.flush(),await wy(N,Lt,4),N.bindBuffer(N.PIXEL_PACK_BUFFER,ze),N.getBufferSubData(N.PIXEL_PACK_BUFFER,0,Pe),N.deleteBuffer(ze),N.deleteSync(Lt),Pe}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(w,F=null,X=0){let H=Math.pow(2,-X),W=Math.floor(w.image.width*H),Pe=Math.floor(w.image.height*H),Ne=F!==null?F.x:0,Ae=F!==null?F.y:0;S.setTexture2D(w,0),N.copyTexSubImage2D(N.TEXTURE_2D,X,0,0,Ne,Ae,W,Pe),ge.unbindTexture()};let xS=N.createFramebuffer(),yS=N.createFramebuffer();this.copyTextureToTexture=function(w,F,X=null,H=null,W=0,Pe=0){let Ne,Ae,Oe,ke,Ke,Qe,ze,ht,Lt,Pt=w.isCompressedTexture?w.mipmaps[Pe]:w.image;if(X!==null)Ne=X.max.x-X.min.x,Ae=X.max.y-X.min.y,Oe=X.isBox3?X.max.z-X.min.z:1,ke=X.min.x,Ke=X.min.y,Qe=X.isBox3?X.min.z:0;else{let Nt=Math.pow(2,-W);Ne=Math.floor(Pt.width*Nt),Ae=Math.floor(Pt.height*Nt),w.isDataArrayTexture?Oe=Pt.depth:w.isData3DTexture?Oe=Math.floor(Pt.depth*Nt):Oe=1,ke=0,Ke=0,Qe=0}H!==null?(ze=H.x,ht=H.y,Lt=H.z):(ze=0,ht=0,Lt=0);let dt=R.convert(F.format),nn=R.convert(F.type),Ie;F.isData3DTexture?(S.setTexture3D(F,0),Ie=N.TEXTURE_3D):F.isDataArrayTexture||F.isCompressedArrayTexture?(S.setTexture2DArray(F,0),Ie=N.TEXTURE_2D_ARRAY):(S.setTexture2D(F,0),Ie=N.TEXTURE_2D),ge.activeTexture(N.TEXTURE0),ge.pixelStorei(N.UNPACK_FLIP_Y_WEBGL,F.flipY),ge.pixelStorei(N.UNPACK_PREMULTIPLY_ALPHA_WEBGL,F.premultiplyAlpha),ge.pixelStorei(N.UNPACK_ALIGNMENT,F.unpackAlignment);let An=ge.getParameter(N.UNPACK_ROW_LENGTH),ot=ge.getParameter(N.UNPACK_IMAGE_HEIGHT),Gn=ge.getParameter(N.UNPACK_SKIP_PIXELS),gi=ge.getParameter(N.UNPACK_SKIP_ROWS),nr=ge.getParameter(N.UNPACK_SKIP_IMAGES);ge.pixelStorei(N.UNPACK_ROW_LENGTH,Pt.width),ge.pixelStorei(N.UNPACK_IMAGE_HEIGHT,Pt.height),ge.pixelStorei(N.UNPACK_SKIP_PIXELS,ke),ge.pixelStorei(N.UNPACK_SKIP_ROWS,Ke),ge.pixelStorei(N.UNPACK_SKIP_IMAGES,Qe);let Ms=w.isDataArrayTexture||w.isData3DTexture,ft=F.isDataArrayTexture||F.isData3DTexture;if(w.isDepthTexture){let Nt=T.get(w),ir=T.get(F),mt=T.get(Nt.__renderTarget),rr=T.get(ir.__renderTarget);ge.bindFramebuffer(N.READ_FRAMEBUFFER,mt.__webglFramebuffer),ge.bindFramebuffer(N.DRAW_FRAMEBUFFER,rr.__webglFramebuffer);for(let ws=0;ws<Oe;ws++)Ms&&(N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,T.get(w).__webglTexture,W,Qe+ws),N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,T.get(F).__webglTexture,Pe,Lt+ws)),N.blitFramebuffer(ke,Ke,Ne,Ae,ze,ht,Ne,Ae,N.DEPTH_BUFFER_BIT,N.NEAREST);ge.bindFramebuffer(N.READ_FRAMEBUFFER,null),ge.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else if(W!==0||w.isRenderTargetTexture||T.has(w)){let Nt=T.get(w),ir=T.get(F);ge.bindFramebuffer(N.READ_FRAMEBUFFER,xS),ge.bindFramebuffer(N.DRAW_FRAMEBUFFER,yS);for(let mt=0;mt<Oe;mt++)Ms?N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,Nt.__webglTexture,W,Qe+mt):N.framebufferTexture2D(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,Nt.__webglTexture,W),ft?N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,ir.__webglTexture,Pe,Lt+mt):N.framebufferTexture2D(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,ir.__webglTexture,Pe),W!==0?N.blitFramebuffer(ke,Ke,Ne,Ae,ze,ht,Ne,Ae,N.COLOR_BUFFER_BIT,N.NEAREST):ft?N.copyTexSubImage3D(Ie,Pe,ze,ht,Lt+mt,ke,Ke,Ne,Ae):N.copyTexSubImage2D(Ie,Pe,ze,ht,ke,Ke,Ne,Ae);ge.bindFramebuffer(N.READ_FRAMEBUFFER,null),ge.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else ft?w.isDataTexture||w.isData3DTexture?N.texSubImage3D(Ie,Pe,ze,ht,Lt,Ne,Ae,Oe,dt,nn,Pt.data):F.isCompressedArrayTexture?N.compressedTexSubImage3D(Ie,Pe,ze,ht,Lt,Ne,Ae,Oe,dt,Pt.data):N.texSubImage3D(Ie,Pe,ze,ht,Lt,Ne,Ae,Oe,dt,nn,Pt):w.isDataTexture?N.texSubImage2D(N.TEXTURE_2D,Pe,ze,ht,Ne,Ae,dt,nn,Pt.data):w.isCompressedTexture?N.compressedTexSubImage2D(N.TEXTURE_2D,Pe,ze,ht,Pt.width,Pt.height,dt,Pt.data):N.texSubImage2D(N.TEXTURE_2D,Pe,ze,ht,Ne,Ae,dt,nn,Pt);ge.pixelStorei(N.UNPACK_ROW_LENGTH,An),ge.pixelStorei(N.UNPACK_IMAGE_HEIGHT,ot),ge.pixelStorei(N.UNPACK_SKIP_PIXELS,Gn),ge.pixelStorei(N.UNPACK_SKIP_ROWS,gi),ge.pixelStorei(N.UNPACK_SKIP_IMAGES,nr),Pe===0&&F.generateMipmaps&&N.generateMipmap(Ie),ge.unbindTexture()},this.initRenderTarget=function(w){T.get(w).__webglFramebuffer===void 0&&S.setupRenderTarget(w)},this.initTexture=function(w){w.isCubeTexture?S.setTextureCube(w,0):w.isData3DTexture?S.setTexture3D(w,0):w.isDataArrayTexture||w.isCompressedArrayTexture?S.setTexture2DArray(w,0):S.setTexture2D(w,0),ge.unbindTexture()},this.resetState=function(){B=0,G=0,D=null,ge.reset(),ie.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return hi}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let n=this.getContext();n.drawingBufferColorSpace=it._getDrawingBufferColorSpace(e),n.unpackColorSpace=it._getUnpackColorSpace()}};var tt=Pl(yg());async function rR(){let t=typeof AbortController=="function"?new AbortController:null,e;try{let n=fetch("./game.config.json",{signal:t==null?void 0:t.signal}).then(s=>{if(!s.ok)throw new Error(`HTTP ${s.status}`);return s.json()}),i=new Promise((s,o)=>{e=setTimeout(()=>o(new Error("timed out")),1200)}),r=await Promise.race([n,i]);if(!r||typeof r!="object"||Array.isArray(r)||["tweaks","texts","images"].some(s=>r[s]!=null&&!Array.isArray(r[s])))throw new Error("invalid config");return r}catch(n){return console.warn("[playable] Using packaged defaults:",n.message),null}finally{clearTimeout(e),t==null||t.abort()}}function sR(t,e){if(e(),typeof ResizeObserver=="function"){let n=new ResizeObserver(e);return n.observe(t),()=>n.disconnect()}return window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}var Al=window.parent!==window&&new URLSearchParams(location.search).get("feedReview")==="1";Al&&(document.documentElement.dataset.feedCover="true",window.addEventListener("message",t=>{var e;t.source!==window.parent||t.origin!==location.origin||((e=t.data)==null?void 0:e.type)!=="playable-active"||(Al=t.data.active!==!0,document.documentElement.dataset.feedCover=String(Al))}));var oR=`
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
*{box-sizing:border-box} button{font-family:var(--font-body);cursor:pointer;-webkit-tap-highlight-color:transparent} .app{position:relative;width:100%;height:100%;overflow:clip;background:#3d99af;color:#375f56;font-family:var(--font-body);touch-action:none} canvas{display:block;width:100%;height:100%;touch-action:none} .hint{position:absolute;top:22%;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;color:#f3f4e8;pointer-events:none;animation:breathe 3s ease-in-out infinite;text-shadow:0 2px 5px #102f44} @keyframes breathe{50%{opacity:.65}} @media(prefers-reduced-motion:reduce){.hint{animation:none}} .right{position:absolute;right:30px;top:43%;transform:translateY(-30%);display:flex;flex-direction:column;border-radius:22px;background:#f4f3e5f2;box-shadow:0 4px 12px #10394e44;overflow:hidden} .round{border:0;background:transparent;color:#3e5b50;width:44px;height:44px;display:grid;place-items:center} .round:nth-child(3){border-top:1px solid #c8d3c6} .round:disabled{opacity:.4;cursor:default}.round .tool-icon{width:24px;height:24px}.toolbar{position:absolute;bottom:50px;left:50%;transform:translateX(-50%);width:calc(100% - 60px);max-width:440px;background:#fbf8ec;border:1px solid #fffaf0;border-radius:23px;box-shadow:0 9px 28px #397f7650,0 2px 3px #fff inset;display:flex;padding:7px;gap:3px}.tool{min-width:0;flex:1;border:0;border-radius:16px;background:transparent;color:#4b5e50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:44px;padding:8px 1px 7px;font-size:10px;font-weight:700;line-height:1.2}.tool-icon{width:31px;height:31px;display:block;flex:none;background-image:url('./assets/icons/island-toolkit-mono-v2.png');background-size:400% 400%;background-repeat:no-repeat;pointer-events:none}
.tool.active{background:#dce7d3;color:#2d4839;box-shadow:inset 0 0 0 1px #adc1a1}.tray{position:absolute;bottom:134px;left:50%;transform:translateX(-50%);display:flex;gap:6px;background:#fbf8ec;padding:6px;border-radius:18px;box-shadow:0 5px 20px #397f7640}.choice{border:0;border-radius:12px;background:transparent;color:#769689;width:45px;height:42px;display:grid;place-items:center}.choice.active{background:#dbe9d9;color:#477966}.choice .tool-icon{width:32px;height:32px}.menu{position:absolute;bottom:134px;right:30px;z-index:1;width:204px;padding:14px;background:#fbf8ec;border-radius:18px;box-shadow:0 7px 22px #397f7640;color:#55786c;font-size:12px}.menu-title{font-weight:700;margin-bottom:8px}.sizes{display:flex;gap:7px}.sizes button{flex:1;height:34px;border:0;border-radius:10px;color:#66897a;background:#ecf2e7;font-weight:700}.sizes button.active{background:#c8ddc8;color:#416b5b}.reset{border:0;border-top:1px solid #dfe8d9;margin-top:12px;padding:11px 0 0;width:100%;text-align:left;background:none;color:#a56b61;font-size:12px;font-weight:700}.confirm{position:absolute;inset:0;z-index:2;background:#234e4b60;display:flex;align-items:center;justify-content:center}.dialog{width:min(280px, calc(100% - 50px));padding:22px;border-radius:22px;background:#fbf8ec;text-align:center;box-shadow:0 12px 40px #214f4a44}.dialog h2{font-size:17px;margin:0 0 6px}.dialog p{font-size:12px;margin:0 0 18px;color:#789487}.dialog div{display:flex;gap:8px}.dialog button{flex:1;border:0;border-radius:12px;padding:11px;background:#e6eee1;color:#55786c;font-weight:700}.dialog .danger{background:#b97c6d;color:white}
[data-feed-cover="true"] .right,[data-feed-cover="true"] .toolbar,[data-feed-cover="true"] .tray{visibility:hidden}
@media(max-width:350px){.toolbar{width:calc(100% - 44px);padding:5px;gap:1px}.tool{font-size:9px}.tool .tool-icon{width:27px;height:27px}}
`,aR=["Build","Lower","Plant","Decorate","Look","more","undo","redo","plus","minus","tree","bush","flower","rock","shell","star"];function Ss({name:t}){let e=aR.indexOf(t);return(0,tt.jsx)("span",{className:"tool-icon","aria-hidden":"true",style:{backgroundPosition:`${e%4*100/3}% ${Math.floor(e/4)*100/3}%`}})}var bn=t=>{var e;try{(e=window.SFX)==null||e.play(t)}catch{}},lR=4,uS=t=>JSON.parse(JSON.stringify(t)),pd=(t,e)=>`${t},${e}`;function cR(){let t=document.createElement("canvas");t.width=t.height=256;let e=t.getContext("2d"),n=e.createImageData(256,256);for(let r=0;r<256;r++)for(let s=0;s<256;s++){let o=s*Math.PI/128,a=r*Math.PI/128,l=Math.sin(o+2*a+Math.sin(a))*4+Math.sin(3*o-a)*2.5,c=(r*256+s)*4;n.data.set([61+l,153+l,175+l,255],c)}e.putImageData(n,0,0),e.fillStyle="#fff9c958";for(let r=0;r<166;r++){let s=(r*97.91+Math.sin(r*13.1)*17+256)%256,o=(r*61.17+Math.cos(r*7.3)*12+256)%256;e.fillRect(s,o,1.2+r%4*.35,.9)}let i=new bo(t);return i.colorSpace=Jt,i.wrapS=i.wrapT=go,i.repeat.set(35,35),i.anisotropy=4,i}var mi=-.075,Vn=Zm.smoothstep;function hS(t,e,n,i,r){let s=Object.entries(t).filter(([,q])=>q.h>0);if(!s.length)return null;let o=s.map(([q])=>q.split(",").map(Number)),a=(q,J)=>{var ce;return((ce=t[pd(q,J)])==null?void 0:ce.h)||0};function l(q,J){let ce=Math.floor(q),he=Math.floor(J),Me=Vn(q-ce,0,1),Fe=Vn(J-he,0,1),Ze=a(ce,he),Be=a(ce+1,he),K=a(ce,he+1),ve=a(ce+1,he+1),pe=(1-Me)*(1-Fe),Ce=Me*(1-Fe),Q=(1-Me)*Fe,re=Me*Fe,Se=(Ze?pe:0)+(Be?Ce:0)+(K?Q:0)+(ve?re:0),we=Ze*pe+Be*Ce+K*Q+ve*re,Y=Vn(Se,.09,.9),ee=Math.sin(q*16.1+J*13.4)*Math.cos(J*21.2-q*7.7);return{y:-.19+(.24*(Se>0?we/Se:0)+.17)*Y+ee*.013*Y,coverage:Se,grain:ee}}let c=Math.min(...o.map(([q])=>q))-1,d=Math.max(...o.map(([q])=>q))+1,f=Math.min(...o.map(([,q])=>q))-1,u=Math.max(...o.map(([,q])=>q))+1,p=5,g=(d-c)*p+1,M=(u-f)*p+1,_=[],h=[],m=[],v=[],y=[],A=new Ye("#efd9a8"),E=new Ye("#b1bd8e"),C=new Ye("#76ba60"),x=new Ye("#a2d17a"),b=new Ye("#a9a79a"),I=new Ye("#74cebd"),L=new Ye("#d2e6c5"),P=new Ye,B=new Ye,G=Array.from({length:M*g},(q,J)=>l(c+J%g/p,f+Math.floor(J/g)/p)),D=e/p;for(let q=0;q<M;q++)for(let J=0;J<g;J++){let ce=c+J/p,he=f+q/p,Me=q*g+J,{y:Fe,coverage:Ze,grain:Be}=G[Me],K=(ce-n)*e,ve=(he-n)*e,pe=J>0?G[Me-1].y:Fe,Ce=J<g-1?G[Me+1].y:Fe,Q=q>0?G[Me-g].y:Fe,re=q<M-1?G[Me+g].y:Fe,Se=Math.max(Math.abs(Ce-pe),Math.abs(re-Q))/(2*D);P.copy(E).lerp(A,Vn(Fe,mi,.15));let we=Vn(Fe,.23,.55)*Vn(Ze,.59,.98);B.copy(C).lerp(x,.47+.3*Math.sin(ce*4.3+he*2.7)),P.lerp(B,we),P.lerp(b,Vn(Se,.55,1.8)*Vn(Fe,.17,.49)*.82),P.multiplyScalar(1+.045*Be+.04*Math.sin(ce*7.1-he*6.3)),_.push(K,Fe,ve),m.push(P.r,P.g,P.b);let Y=1-Vn(Math.abs(Fe-mi),.015,.1),ee=Vn(Ze,.015,.25)*(1-Vn(Fe,mi,mi+.035));if(B.copy(I).lerp(L,Y*.74),h.push(K,mi+.006,ve),v.push(B.r,B.g,B.b,ee*(.21+.3*Y)),q===M-1||J===g-1)continue;let $=q*g+J,ae=$+1,oe=$+g,Le=oe+1;y.push($,oe,ae,ae,oe,Le)}function O(q,J,ce){let he=new qt;return he.setAttribute("position",new pt(q,3)),he.setAttribute("color",new pt(J,ce)),he.setIndex(y),he}let k=O(_,m,3);return k.computeVertexNormals(),{land:new en(k,i),shallows:new en(O(h,v,4),r),heightAt:(q,J)=>l(q,J).y}}function uR(){let t={},e=[],n=[],i=[],r=[];function s(Q,re={}){let Se=new Lo({color:Q,roughness:.92,flatShading:!0,...re});return e.push(Se),Se}function o(Q){return n.push(Q),Q}function a(Q,re){let Se=new Io(1,Q),we=Se.attributes.position;for(let Y=0;Y<we.count;Y++){let ee=we.getX(Y),$=we.getY(Y),ae=we.getZ(Y),oe=1+Math.sin(ee*9+ae*6+re)*Math.cos($*8-ae*4)*.105;we.setXYZ(Y,ee*oe,$*oe,ae*oe)}return Se.computeVertexNormals(),o(Se)}let l=a(1,2.3),c=a(1,5.1),d=a(1,9.2),f=o(new Ao(.7,1,1,7)),u=o(new Io(1,0)),p=s("#9a6b42"),g=s("#4c9c53"),M=s("#80c968"),_=s("#6ea85d"),h=s("#65ae66"),m=s("#a6cf76"),v=s("#a8a99e",{flatShading:!0}),y=s("#d8cbb4",{flatShading:!0}),A=s("#fff3c9"),E=s("#e7ad45"),C=s("#f5d8bc",{side:jn}),x=s("#f1a5a8"),b=s("#bca7df"),I=s("#ffcf62"),L=s("#b46854");function P(Q,re,Se,we,Y,ee,$,ae,oe){let Le=new en(re,Se);return Le.position.set(we,Y,ee),Le.scale.set($,ae,oe),Q.add(Le),Le}function B(Q,re,Se,we,Y){let ee=new U(...re),$=new U(...Se),ae=$.clone().sub(ee),oe=ee.clone().lerp($,.5),Le=P(Q,f,Y,oe.x,oe.y,oe.z,we,ae.length(),we);return Le.quaternion.setFromUnitVectors(new U(0,1,0),ae.normalize()),Le}let G=o(new ja(1,1,7));for(let Q=0;Q<3;Q++){let re=new Kt;if(B(re,[0,0,0],[0,.78,0],.055,p),Q===2)for(let Se=0;Se<3;Se++){let we=.34-Se*.075;P(re,G,Se===1?M:g,0,.48+Se*.205,0,we,.43,we)}else B(re,[0,.4,0],[-.17,.69,.02],.025,p),B(re,[0,.45,0],[.16,.73,-.04],.025,p),P(re,l,g,0,.72,0,.27,.27,.25),P(re,l,M,-.16,.72,.03,.2,.2,.19),P(re,l,h,.16,.76,-.035,.19,.21,.19),P(re,l,M,.025,.91,.025,.18,.19,.18),Q===1&&(P(re,l,h,.02,.68,-.18,.2,.18,.18),re.scale.set(1.05,.9,1.05));i.push(re)}t.tree=i[0];let D=t.bush=new Kt;for(let Q=0;Q<7;Q++){let re=Q*2.4,Se=Q===0?0:.11+Q*.015;P(D,c,Q%3===0?m:h,Math.cos(re)*Se,.12+Q%3*.024,Math.sin(re)*Se,.12+Q%2*.032,.1+Q%3*.025,.11)}let O=t.rock=new Kt;P(O,d,v,-.048,.103,.02,.19,.13,.14).rotation.set(.15,.7,-.21),P(O,d,y,.12,.054,-.05,.11,.073,.09).rotation.y=1.2,P(O,d,v,.11,.041,.12,.068,.052,.06).rotation.y=-.65;for(let Q=0;Q<4;Q++){let re=new Kt,Se=[A,x,b,I][Q],we=Q===2?6:5;for(let Y=0;Y<3;Y++){let ee=(Y-1)*.107,$=.19+Y%2*.076,ae=Y===1?-.088:.061;B(re,[ee*.58,0,ae*.55],[ee,$,ae],.011,_);let oe=P(re,u,m,ee-.029,$*.48,ae,.054,.016,.026);oe.rotation.z=.46;for(let Le=0;Le<we;Le++){let N=Le*Math.PI*2/we,Ve=Q===3?.035:.043,Ue=P(re,u,Se,ee+Math.cos(N)*Ve,$,ae+Math.sin(N)*Ve,Q===2?.031:.04,.015,Q===1?.034:.026);Ue.rotation.y=-N}P(re,u,E,ee,$+.014,ae,.029,.019,.029)}r.push(re)}t.flower=r[0];let k=t.shell=new Kt,q=[],J=[];for(let Q=0;Q<=6;Q++){let re=Q/6;for(let Se=0;Se<=16;Se++){let we=Se/16,Y=(we-.5)*2.33,ee=Math.cos(we*Math.PI*16),$=.217+re*re*.008*ee;if(q.push(Math.sin(Y)*re*$,.021+.088*Math.sin(Math.PI*re)*(.74+.22*Math.cos(Y))+.011*re*(1+ee),.125-Math.cos(Y)*re*$*1.37),Q===6||Se===16)continue;let ae=Q*17+Se;J.push(ae,ae+17,ae+1,ae+1,ae+17,ae+18)}}let ce=o(new qt);ce.setAttribute("position",new pt(q,3)),ce.setIndex(J),ce.computeVertexNormals(),P(k,ce,C,0,0,0,1,1,1),k.scale.setScalar(.55);let he=t.star=new Kt,Me=new Ro;for(let Q=0;Q<10;Q++){let re=Q*Math.PI/5+Math.PI/2,Se=Q%2?.083:.184+Q%3*.011;Q===0?Me.moveTo(Math.cos(re)*Se,Math.sin(re)*Se):Me.lineTo(Math.cos(re)*Se,Math.sin(re)*Se)}Me.closePath();let Fe=o(new ll(Me,{depth:.021,bevelEnabled:!0,bevelSize:.016,bevelThickness:.012,bevelSegments:2}));Fe.rotateX(-Math.PI/2),P(he,Fe,L,0,.014,0,1,1,1);for(let Q=0;Q<5;Q++){let re=Q*Math.PI*2/5+Math.PI/2;for(let Se=0;Se<2;Se++){let we=.051+Se*.049;P(he,u,E,Math.cos(re)*we,.052,-Math.sin(re)*we,.012,.006,.012)}}he.scale.setScalar(.58);let Ze=document.createElement("canvas");Ze.width=Ze.height=32;let Be=Ze.getContext("2d"),K=Be.createRadialGradient(16,16,0,16,16,16);K.addColorStop(0,"#293a2f73"),K.addColorStop(.5,"#293a2f40"),K.addColorStop(1,"#293a2f00"),Be.fillStyle=K,Be.fillRect(0,0,32,32);let ve=new bo(Ze);ve.colorSpace=Jt;let pe=new Qi({map:ve,transparent:!0,depthWrite:!1,polygonOffset:!0,polygonOffsetFactor:-2});e.push(pe);let Ce=o(new Ur(.61,.61));return Ce.rotateX(-Math.PI/2),{add(Q,re,Se,we,Y,ee,$,ae){let oe=(Math.sin(ee*127.1+$*311.7)+1)/2,Le=re==="tree"&&i.length?i[Math.min(i.length-1,Math.floor(oe*i.length))]:re==="flower"?r[Number.isInteger(ae)?Math.abs(ae)%r.length:Math.min(r.length-1,Math.floor(oe*r.length))]:t[re];if(!Le)return;let N=Le.clone(!0);N.position.set(Se,we-.006,Y),N.rotation.y=oe*Math.PI*2,N.scale.multiplyScalar(.88+oe*.24),Q.add(N);let Ve=re==="shell"||re==="star"?.46:1;P(Q,Ce,pe,Se,we+.017,Y,Ve,1,Ve)},dispose(){ve.dispose(),n.forEach(Q=>Q.dispose()),e.forEach(Q=>Q.dispose())}}}function hR(){var I,L;let[t,e]=(0,Vt.useState)(null),[n,i]=(0,Vt.useState)("Build"),[r,s]=(0,Vt.useState)("tree"),[o,a]=(0,Vt.useState)(!0),[l,c]=(0,Vt.useState)(!1),[d,f]=(0,Vt.useState)(!1),[u,p]=(0,Vt.useState)(1),[g,M]=(0,Vt.useState)(0),_=(0,Vt.useRef)(null),h=(0,Vt.useRef)(null),m=(0,Vt.useRef)(null),v=(0,Vt.useRef)(n),y=(0,Vt.useRef)(r),A=(0,Vt.useRef)(u);v.current=n,y.current=r,A.current=u,(0,Vt.useEffect)(()=>{var P;(P=window.SFX)==null||P.register({click:"./assets/sfx_click.mp3",plop:"./assets/sfx_plop.mp3",earth:"buzzer",foliage:"./assets/sfx_leaves.mp3",rotate:"buzzer",history:"buzzer"}),rR().then(B=>{let G=B||{},D={GRID_SIZE:17,MAX_HEIGHT:4,BRUSH_SIZE:1,HINT:"Drag to build land"};for(let O of[...G.tweaks||[],...G.texts||[]])D[O.id]=O.value;e(D),p(D.BRUSH_SIZE)})},[]),(0,Vt.useEffect)(()=>{if(!t||!_.current)return;let P=t.GRID_SIZE,B=.64,G=(P-1)/2,D;try{D=JSON.parse(localStorage.getItem("island-sandbox-v1")||"null")}catch{}let O={};if(D!=null&&D.cells&&Number.isInteger(D.n)){let R=Math.floor((P-D.n)/2);for(let[ie,V]of Object.entries(D.cells)){let[fe,le]=ie.split(",").map(Number),te=fe+R,Ee=le+R;te>=0&&te<P&&Ee>=0&&Ee<P&&(O[pd(te,Ee)]={...V,item:V.item==="umbrella"?null:V.item})}}h.current={cells:O,undo:[],redo:[],started:!!(D!=null&&D.started)},h.current.started&&a(!1);let k=new qa;k.background=new Ye("#3d99af"),k.fog=new Xa("#3d99af",20,38);let q=new ud({antialias:!0,alpha:!0});q.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),q.outputColorSpace=Jt,_.current.appendChild(q.domElement);let J=new kr(-5,5,5,-5,.1,100),ce=.76,he=1,Me=()=>{let R=_.current.clientWidth,ie=_.current.clientHeight,V=R/ie,fe=Math.max(10.8,8.5*Math.sqrt(P/11)/V)/he;J.left=-fe*V/2,J.right=fe*V/2,J.top=fe/2,J.bottom=-fe/2,J.position.set(Math.sin(ce)*11,10,Math.cos(ce)*11),J.lookAt(0,0,0),J.updateProjectionMatrix()};k.add(new hl("#fff8e7","#b5c695",1.65));let Fe=new fl("#fff3cb",2.35);Fe.position.set(-5,10,6),k.add(Fe);let Ze=cR(),Be=new en(new Ur(200,200),new Qi({map:Ze}));Be.rotation.x=-Math.PI/2,Be.position.y=mi,k.add(Be);let K=new Lo({vertexColors:!0,roughness:.94,flatShading:!0}),ve=new Qi({vertexColors:!0,transparent:!0,depthWrite:!1}),pe=uR(),Ce=new Kt;k.add(Ce);let Q=null;function re(R,ie,V){for(let[fe,le]of Object.entries(ie)){if(!le.h||!le.item)continue;let[te,Ee]=fe.split(",").map(Number);pe.add(R,le.item,(te-G)*B,V.heightAt(te,Ee),(Ee-G)*B,te,Ee,le.flowerVariant)}}function Se(R){R&&(R.land.geometry.dispose(),R.shallows.geometry.dispose())}function we(){Se(Q),Ce.clear();let R=h.current.cells;Q=hS(R,B,G,K,ve),Q&&(Ce.add(Q.land,Q.shallows),re(Ce,R,Q),Ce.updateMatrixWorld(!0))}let Y=new Dr(B*.95,.025,B*.95),ee=new $a(new Qa(Y),new To({color:"#edf1cc",transparent:!0,opacity:.88}));Y.dispose(),ee.visible=!1,k.add(ee);let $=new Kt,ae={};for(let R=-2;R<=2;R++)for(let ie=-2;ie<=2;ie++){let V=Math.hypot(R-.24,ie+.15);if(V>2.32)continue;let fe=R===0&&ie===-1?"tree":R===1&&ie===0?"bush":R===-1&&ie===1?"rock":null;ae[pd(Math.floor(G)+R,Math.floor(G)+ie)]={h:V<.78?3:V<1.57?2:1,item:fe}}let oe=hS(ae,B,G,K,ve);$.add(oe.land);let Le=new Kt;$.add(Le),re(Le,ae,oe),k.add($,oe.shallows);let N=window.matchMedia("(prefers-reduced-motion: reduce)"),Ve,Ue=()=>{let R=_.current.clientWidth,ie=_.current.clientHeight;!R||!ie||(q.setSize(R,ie,!1),Me())},Xe=sR(_.current,Ue);we();function ge(R){if(Ve=requestAnimationFrame(ge),document.hidden)return;let ie=Al&&!h.current.started;$.visible=ie;let V=N.matches?1:.22+.78*Vn(R%5500/1e3,.2,1.45)*(1-.82*Vn(R%5500/1e3,4.25,5.42));$.scale.y=V,$.position.y=mi*(1-V),oe.shallows.visible=ie&&V>.9,q.render(k,J)}Ve=requestAnimationFrame(ge);let st=new pl,T=new Te,S=new Kn(new U(0,1,0),-mi),z=new U;function ne(R,ie){let V=q.domElement.getBoundingClientRect();T.set((R-V.left)/V.width*2-1,-(ie-V.top)/V.height*2+1),st.setFromCamera(T,J);let fe=Q&&st.intersectObject(Q.land,!1)[0],le=(fe==null?void 0:fe.point.y)>mi?fe.point:st.ray.intersectPlane(S,z);if(!le)return null;let te=Math.round(le.x/B+G),Ee=Math.round(le.z/B+G);return te>=0&&Ee>=0&&te<P&&Ee<P?[te,Ee]:null}function se(R){if(!R){ee.visible=!1;return}let[ie,V]=R;ee.position.set((ie-G)*B,Math.max(mi,(Q==null?void 0:Q.heightAt(ie,V))??mi)+.047,(V-G)*B),ee.visible=v.current!=="Look"}function _e(){try{localStorage.setItem("island-sandbox-v1",JSON.stringify({n:P,cells:h.current.cells,started:h.current.started}))}catch{}}function ye(){h.current.started=!0,a(!1)}function Z(R,ie){if(!R)return!1;let V=!1,[fe,le]=R,te=A.current-1;for(let Ee=-te;Ee<=te;Ee++)for(let We=-te;We<=te;We++){if(te&&Ee*Ee+We*We>te*te)continue;let vt=fe+Ee,lt=le+We,tn=pd(vt,lt);if(vt<0||lt<0||vt>=P||lt>=P||ie.has(tn))continue;ie.add(tn);let Rt=h.current.cells[tn]||{h:0,item:null};v.current==="Build"&&Rt.h<t.MAX_HEIGHT?(h.current.cells[tn]={...Rt,h:Rt.h+1},V=!0):v.current==="Lower"&&Rt.h>0?(h.current.cells[tn]={...Rt,h:Rt.h-1,item:Rt.h===1?null:Rt.item},V=!0):(v.current==="Plant"||v.current==="Decorate")&&Rt.h>0&&Rt.item!==y.current&&(h.current.cells[tn]={...Rt,item:y.current,flowerVariant:y.current==="flower"?Math.floor(Math.random()*lR):void 0},V=!0)}return V}let j=new Map,de=null,Re=0,ue=q.domElement;function xe(R){if(Al||R.button>0||R.isPrimary===!1&&R.pointerType!=="touch")return;if(ue.setPointerCapture(R.pointerId),j.set(R.pointerId,{x:R.clientX,y:R.clientY}),j.size===2){de!=null&&de.changed&&(h.current.cells=de.before,h.current.started=de.wasStarted,a(!de.wasStarted),we()),de=null;let V=[...j.values()];Re=Math.hypot(V[0].x-V[1].x,V[0].y-V[1].y);return}if(j.size>1)return;let ie=ne(R.clientX,R.clientY);se(ie),de={before:uS(h.current.cells),wasStarted:h.current.started,visited:new Set,last:ie,x:R.clientX,y:R.clientY,changed:!1,rotated:!1},v.current!=="Look"&&(de.changed=Z(ie,de.visited),de.changed&&(ye(),we(),se(ie)))}function $e(R){if(!j.has(R.pointerId)){se(ne(R.clientX,R.clientY));return}let ie=j.get(R.pointerId);if(j.set(R.pointerId,{x:R.clientX,y:R.clientY}),j.size>=2){let fe=[...j.values()],le=Math.hypot(fe[0].x-fe[1].x,fe[0].y-fe[1].y);Re&&(he=Math.max(.55,Math.min(1.7,he*le/Re)),Me()),Re=le;return}if(!de)return;if(v.current==="Look"){let fe=R.clientX-ie.x;Math.abs(fe)>0&&(ce-=fe*.008,Me(),de.rotated=!0);return}let V=ne(R.clientX,R.clientY);if(se(V),V){let fe=!1,le=de.last||V,te=Math.max(Math.abs(V[0]-le[0]),Math.abs(V[1]-le[1]),1);for(let Ee=1;Ee<=te;Ee++){let We=[Math.round(le[0]+(V[0]-le[0])*Ee/te),Math.round(le[1]+(V[1]-le[1])*Ee/te)];Z(We,de.visited)&&(fe=!0)}fe&&(de.changed=!0,ye(),we(),se(V)),de.last=V}}function qe(R){j.delete(R.pointerId),j.size===0&&(de!=null&&de.changed?(h.current.undo.push(de.before),h.current.undo.length>40&&h.current.undo.shift(),h.current.redo=[],_e(),M(ie=>ie+1),bn(v.current==="Build"?"plop":v.current==="Lower"?"earth":v.current==="Plant"?"foliage":"click"),console.log("island stroke",v.current,Object.keys(h.current.cells).length)):de!=null&&de.rotated?(bn("rotate"),_e()):Re&&bn("rotate"),de=null,Re=0),ee.visible=!1}function rt(R){R.preventDefault(),he=Math.max(.55,Math.min(1.7,he*(R.deltaY<0?1.1:.9))),Me(),bn("rotate")}return ue.addEventListener("pointerdown",xe),ue.addEventListener("pointermove",$e),ue.addEventListener("pointerup",qe),ue.addEventListener("pointercancel",qe),ue.addEventListener("lostpointercapture",qe),ue.addEventListener("wheel",rt,{passive:!1}),m.current={renderTerrain:we,save:_e,zoom:R=>{he=Math.max(.55,Math.min(1.7,he*R)),Me()},getZoom:()=>he},()=>{cancelAnimationFrame(Ve),Xe(),ue.removeEventListener("pointerdown",xe),ue.removeEventListener("pointermove",$e),ue.removeEventListener("pointerup",qe),ue.removeEventListener("pointercancel",qe),ue.removeEventListener("lostpointercapture",qe),ue.removeEventListener("wheel",rt),q.dispose(),Se(Q),Se(oe),K.dispose(),ve.dispose(),pe.dispose(),ee.geometry.dispose(),ee.material.dispose(),Be.geometry.dispose(),Be.material.dispose(),Ze.dispose(),ue.parentNode&&ue.parentNode.removeChild(ue),m.current=null}},[t]);function E(P){P!==n&&(i(P),P==="Plant"&&s("tree"),P==="Decorate"&&s("rock"),c(!1),bn("click"))}function C(P){let B=h.current;if(!B||!B[P].length)return;B[P==="undo"?"redo":"undo"].push(uS(B.cells)),B.cells=B[P].pop(),m.current.renderTerrain(),m.current.save(),M(D=>D+1),bn("history"),console.log("island",P)}function x(){h.current.cells={},h.current.undo=[],h.current.redo=[],h.current.started=!1,m.current.renderTerrain(),m.current.save(),a(!0),f(!1),c(!1),M(P=>P+1),bn("history"),console.log("island reset")}let b=n==="Plant"?["tree","bush","flower"]:["rock","shell","star"];return(0,tt.jsxs)("div",{className:"app",ref:_,"data-version":g,"data-mode":n,children:[(0,tt.jsx)("style",{children:oR}),o&&(0,tt.jsx)("div",{className:"hint",children:(t==null?void 0:t.HINT)||"Drag to build land"}),(0,tt.jsxs)("div",{className:"right",children:[(0,tt.jsx)("button",{className:"round","aria-label":"Undo",disabled:!((I=h.current)!=null&&I.undo.length),onClick:()=>C("undo"),children:(0,tt.jsx)(Ss,{name:"undo"})}),(0,tt.jsx)("button",{className:"round","aria-label":"Redo",disabled:!((L=h.current)!=null&&L.redo.length),onClick:()=>C("redo"),children:(0,tt.jsx)(Ss,{name:"redo"})}),(0,tt.jsx)("button",{className:"round","aria-label":"Zoom in",onClick:()=>{var P;(P=m.current)==null||P.zoom(1.15),bn("rotate")},children:(0,tt.jsx)(Ss,{name:"plus"})}),(0,tt.jsx)("button",{className:"round","aria-label":"Zoom out",onClick:()=>{var P;(P=m.current)==null||P.zoom(1/1.15),bn("rotate")},children:(0,tt.jsx)(Ss,{name:"minus"})})]}),l&&(0,tt.jsxs)("div",{className:"menu",children:[(0,tt.jsx)("div",{className:"menu-title",children:"Brush size"}),(0,tt.jsx)("div",{className:"sizes",children:[1,2,3].map(P=>(0,tt.jsx)("button",{className:u===P?"active":"",onClick:()=>{P!==u&&(p(P),bn("click"))},children:P},P))}),(0,tt.jsx)("button",{className:"reset",onClick:()=>{f(!0),bn("click")},children:"Reset island"})]}),(n==="Plant"||n==="Decorate")&&(0,tt.jsx)("div",{className:"tray",children:b.map(P=>(0,tt.jsx)("button",{"aria-label":P,className:`choice ${r===P?"active":""}`,onClick:()=>{P!==r&&(s(P),bn("click"))},children:(0,tt.jsx)(Ss,{name:P})},P))}),(0,tt.jsxs)("div",{className:"toolbar",children:[["Build","Lower","Plant","Decorate","Look"].map(P=>(0,tt.jsxs)("button",{className:`tool ${n===P?"active":""}`,"aria-label":P,onClick:()=>E(P),children:[(0,tt.jsx)(Ss,{name:P}),(0,tt.jsx)("span",{children:P})]},P)),(0,tt.jsxs)("button",{className:"tool "+(l?"active":""),"aria-label":"More","aria-expanded":l,onClick:()=>{c(!l),bn("click")},children:[(0,tt.jsx)(Ss,{name:"more"}),(0,tt.jsx)("span",{children:"More"})]})]}),d&&(0,tt.jsx)("div",{className:"confirm",children:(0,tt.jsxs)("div",{className:"dialog",children:[(0,tt.jsx)("h2",{children:"Reset island?"}),(0,tt.jsx)("p",{children:"This will clear your changes."}),(0,tt.jsxs)("div",{children:[(0,tt.jsx)("button",{onClick:()=>{f(!1),bn("click")},children:"Cancel"}),(0,tt.jsx)("button",{className:"danger",onClick:x,children:"Reset"})]})]})})]})}(0,dS.createRoot)(document.getElementById("root")).render((0,tt.jsx)(hR,{}));})();
