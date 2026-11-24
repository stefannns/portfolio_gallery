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

(()=>{var ES=Object.create;var Wg=Object.defineProperty;var TS=Object.getOwnPropertyDescriptor;var bS=Object.getOwnPropertyNames;var AS=Object.getPrototypeOf,CS=Object.prototype.hasOwnProperty;var lr=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var RS=(t,e,n,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of bS(e))!CS.call(t,r)&&r!==n&&Wg(t,r,{get:()=>e[r],enumerable:!(i=TS(e,r))||i.enumerable});return t};var ac=(t,e,n)=>(n=t!=null?ES(AS(t)):{},RS(e||!t||!t.__esModule?Wg(n,"default",{value:t,enumerable:!0}):n,t));var n0=lr(_t=>{"use strict";var da=Symbol.for("react.element"),PS=Symbol.for("react.portal"),IS=Symbol.for("react.fragment"),LS=Symbol.for("react.strict_mode"),NS=Symbol.for("react.profiler"),DS=Symbol.for("react.provider"),US=Symbol.for("react.context"),FS=Symbol.for("react.forward_ref"),OS=Symbol.for("react.suspense"),BS=Symbol.for("react.memo"),kS=Symbol.for("react.lazy"),Xg=Symbol.iterator;function zS(t){return t===null||typeof t!="object"?null:(t=Xg&&t[Xg]||t["@@iterator"],typeof t=="function"?t:null)}var Zg={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},$g=Object.assign,Kg={};function Qs(t,e,n){this.props=t,this.context=e,this.refs=Kg,this.updater=n||Zg}Qs.prototype.isReactComponent={};Qs.prototype.setState=function(t,e){if(typeof t!="object"&&typeof t!="function"&&t!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,t,e,"setState")};Qs.prototype.forceUpdate=function(t){this.updater.enqueueForceUpdate(this,t,"forceUpdate")};function Jg(){}Jg.prototype=Qs.prototype;function Hf(t,e,n){this.props=t,this.context=e,this.refs=Kg,this.updater=n||Zg}var Gf=Hf.prototype=new Jg;Gf.constructor=Hf;$g(Gf,Qs.prototype);Gf.isPureReactComponent=!0;var qg=Array.isArray,jg=Object.prototype.hasOwnProperty,Wf={current:null},Qg={key:!0,ref:!0,__self:!0,__source:!0};function e0(t,e,n){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)jg.call(e,i)&&!Qg.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=n;else if(1<a){for(var l=Array(a),c=0;c<a;c++)l[c]=arguments[c+2];r.children=l}if(t&&t.defaultProps)for(i in a=t.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:da,type:t,key:s,ref:o,props:r,_owner:Wf.current}}function VS(t,e){return{$$typeof:da,type:t.type,key:e,ref:t.ref,props:t.props,_owner:t._owner}}function Xf(t){return typeof t=="object"&&t!==null&&t.$$typeof===da}function HS(t){var e={"=":"=0",":":"=2"};return"$"+t.replace(/[=:]/g,function(n){return e[n]})}var Yg=/\/+/g;function Vf(t,e){return typeof t=="object"&&t!==null&&t.key!=null?HS(""+t.key):e.toString(36)}function cc(t,e,n,i,r){var s=typeof t;(s==="undefined"||s==="boolean")&&(t=null);var o=!1;if(t===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(t.$$typeof){case da:case PS:o=!0}}if(o)return o=t,r=r(o),t=i===""?"."+Vf(o,0):i,qg(r)?(n="",t!=null&&(n=t.replace(Yg,"$&/")+"/"),cc(r,e,n,"",function(c){return c})):r!=null&&(Xf(r)&&(r=VS(r,n+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(Yg,"$&/")+"/")+t)),e.push(r)),1;if(o=0,i=i===""?".":i+":",qg(t))for(var a=0;a<t.length;a++){s=t[a];var l=i+Vf(s,a);o+=cc(s,e,n,l,r)}else if(l=zS(t),typeof l=="function")for(t=l.call(t),a=0;!(s=t.next()).done;)s=s.value,l=i+Vf(s,a++),o+=cc(s,e,n,l,r);else if(s==="object")throw e=String(t),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function lc(t,e,n){if(t==null)return t;var i=[],r=0;return cc(t,i,"","",function(s){return e.call(n,s,r++)}),i}function GS(t){if(t._status===-1){var e=t._result;e=e(),e.then(function(n){(t._status===0||t._status===-1)&&(t._status=1,t._result=n)},function(n){(t._status===0||t._status===-1)&&(t._status=2,t._result=n)}),t._status===-1&&(t._status=0,t._result=e)}if(t._status===1)return t._result.default;throw t._result}var Pn={current:null},uc={transition:null},WS={ReactCurrentDispatcher:Pn,ReactCurrentBatchConfig:uc,ReactCurrentOwner:Wf};function t0(){throw Error("act(...) is not supported in production builds of React.")}_t.Children={map:lc,forEach:function(t,e,n){lc(t,function(){e.apply(this,arguments)},n)},count:function(t){var e=0;return lc(t,function(){e++}),e},toArray:function(t){return lc(t,function(e){return e})||[]},only:function(t){if(!Xf(t))throw Error("React.Children.only expected to receive a single React element child.");return t}};_t.Component=Qs;_t.Fragment=IS;_t.Profiler=NS;_t.PureComponent=Hf;_t.StrictMode=LS;_t.Suspense=OS;_t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=WS;_t.act=t0;_t.cloneElement=function(t,e,n){if(t==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+t+".");var i=$g({},t.props),r=t.key,s=t.ref,o=t._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=Wf.current),e.key!==void 0&&(r=""+e.key),t.type&&t.type.defaultProps)var a=t.type.defaultProps;for(l in e)jg.call(e,l)&&!Qg.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=n;else if(1<l){a=Array(l);for(var c=0;c<l;c++)a[c]=arguments[c+2];i.children=a}return{$$typeof:da,type:t.type,key:r,ref:s,props:i,_owner:o}};_t.createContext=function(t){return t={$$typeof:US,_currentValue:t,_currentValue2:t,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},t.Provider={$$typeof:DS,_context:t},t.Consumer=t};_t.createElement=e0;_t.createFactory=function(t){var e=e0.bind(null,t);return e.type=t,e};_t.createRef=function(){return{current:null}};_t.forwardRef=function(t){return{$$typeof:FS,render:t}};_t.isValidElement=Xf;_t.lazy=function(t){return{$$typeof:kS,_payload:{_status:-1,_result:t},_init:GS}};_t.memo=function(t,e){return{$$typeof:BS,type:t,compare:e===void 0?null:e}};_t.startTransition=function(t){var e=uc.transition;uc.transition={};try{t()}finally{uc.transition=e}};_t.unstable_act=t0;_t.useCallback=function(t,e){return Pn.current.useCallback(t,e)};_t.useContext=function(t){return Pn.current.useContext(t)};_t.useDebugValue=function(){};_t.useDeferredValue=function(t){return Pn.current.useDeferredValue(t)};_t.useEffect=function(t,e){return Pn.current.useEffect(t,e)};_t.useId=function(){return Pn.current.useId()};_t.useImperativeHandle=function(t,e,n){return Pn.current.useImperativeHandle(t,e,n)};_t.useInsertionEffect=function(t,e){return Pn.current.useInsertionEffect(t,e)};_t.useLayoutEffect=function(t,e){return Pn.current.useLayoutEffect(t,e)};_t.useMemo=function(t,e){return Pn.current.useMemo(t,e)};_t.useReducer=function(t,e,n){return Pn.current.useReducer(t,e,n)};_t.useRef=function(t){return Pn.current.useRef(t)};_t.useState=function(t){return Pn.current.useState(t)};_t.useSyncExternalStore=function(t,e,n){return Pn.current.useSyncExternalStore(t,e,n)};_t.useTransition=function(){return Pn.current.useTransition()};_t.version="18.3.1"});var hc=lr((pR,i0)=>{"use strict";i0.exports=n0()});var d0=lr(It=>{"use strict";function $f(t,e){var n=t.length;t.push(e);e:for(;0<n;){var i=n-1>>>1,r=t[i];if(0<fc(r,e))t[i]=e,t[n]=r,n=i;else break e}}function Si(t){return t.length===0?null:t[0]}function pc(t){if(t.length===0)return null;var e=t[0],n=t.pop();if(n!==e){t[0]=n;e:for(var i=0,r=t.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=t[o],l=o+1,c=t[l];if(0>fc(a,n))l<r&&0>fc(c,a)?(t[i]=c,t[l]=n,i=l):(t[i]=a,t[o]=n,i=o);else if(l<r&&0>fc(c,n))t[i]=c,t[l]=n,i=l;else break e}}return e}function fc(t,e){var n=t.sortIndex-e.sortIndex;return n!==0?n:t.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(r0=performance,It.unstable_now=function(){return r0.now()}):(qf=Date,s0=qf.now(),It.unstable_now=function(){return qf.now()-s0});var r0,qf,s0,ki=[],Ir=[],XS=1,li=null,vn=3,mc=!1,Ss=!1,ma=!1,l0=typeof setTimeout=="function"?setTimeout:null,c0=typeof clearTimeout=="function"?clearTimeout:null,o0=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function Kf(t){for(var e=Si(Ir);e!==null;){if(e.callback===null)pc(Ir);else if(e.startTime<=t)pc(Ir),e.sortIndex=e.expirationTime,$f(ki,e);else break;e=Si(Ir)}}function Jf(t){if(ma=!1,Kf(t),!Ss)if(Si(ki)!==null)Ss=!0,Qf(jf);else{var e=Si(Ir);e!==null&&ed(Jf,e.startTime-t)}}function jf(t,e){Ss=!1,ma&&(ma=!1,c0(ga),ga=-1),mc=!0;var n=vn;try{for(Kf(e),li=Si(ki);li!==null&&(!(li.expirationTime>e)||t&&!f0());){var i=li.callback;if(typeof i=="function"){li.callback=null,vn=li.priorityLevel;var r=i(li.expirationTime<=e);e=It.unstable_now(),typeof r=="function"?li.callback=r:li===Si(ki)&&pc(ki),Kf(e)}else pc(ki);li=Si(ki)}if(li!==null)var s=!0;else{var o=Si(Ir);o!==null&&ed(Jf,o.startTime-e),s=!1}return s}finally{li=null,vn=n,mc=!1}}var gc=!1,dc=null,ga=-1,u0=5,h0=-1;function f0(){return!(It.unstable_now()-h0<u0)}function Yf(){if(dc!==null){var t=It.unstable_now();h0=t;var e=!0;try{e=dc(!0,t)}finally{e?pa():(gc=!1,dc=null)}}else gc=!1}var pa;typeof o0=="function"?pa=function(){o0(Yf)}:typeof MessageChannel<"u"?(Zf=new MessageChannel,a0=Zf.port2,Zf.port1.onmessage=Yf,pa=function(){a0.postMessage(null)}):pa=function(){l0(Yf,0)};var Zf,a0;function Qf(t){dc=t,gc||(gc=!0,pa())}function ed(t,e){ga=l0(function(){t(It.unstable_now())},e)}It.unstable_IdlePriority=5;It.unstable_ImmediatePriority=1;It.unstable_LowPriority=4;It.unstable_NormalPriority=3;It.unstable_Profiling=null;It.unstable_UserBlockingPriority=2;It.unstable_cancelCallback=function(t){t.callback=null};It.unstable_continueExecution=function(){Ss||mc||(Ss=!0,Qf(jf))};It.unstable_forceFrameRate=function(t){0>t||125<t?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):u0=0<t?Math.floor(1e3/t):5};It.unstable_getCurrentPriorityLevel=function(){return vn};It.unstable_getFirstCallbackNode=function(){return Si(ki)};It.unstable_next=function(t){switch(vn){case 1:case 2:case 3:var e=3;break;default:e=vn}var n=vn;vn=e;try{return t()}finally{vn=n}};It.unstable_pauseExecution=function(){};It.unstable_requestPaint=function(){};It.unstable_runWithPriority=function(t,e){switch(t){case 1:case 2:case 3:case 4:case 5:break;default:t=3}var n=vn;vn=t;try{return e()}finally{vn=n}};It.unstable_scheduleCallback=function(t,e,n){var i=It.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,t){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=n+r,t={id:XS++,callback:e,priorityLevel:t,startTime:n,expirationTime:r,sortIndex:-1},n>i?(t.sortIndex=n,$f(Ir,t),Si(ki)===null&&t===Si(Ir)&&(ma?(c0(ga),ga=-1):ma=!0,ed(Jf,n-i))):(t.sortIndex=r,$f(ki,t),Ss||mc||(Ss=!0,Qf(jf))),t};It.unstable_shouldYield=f0;It.unstable_wrapCallback=function(t){var e=vn;return function(){var n=vn;vn=e;try{return t.apply(this,arguments)}finally{vn=n}}}});var m0=lr((gR,p0)=>{"use strict";p0.exports=d0()});var xx=lr(Qn=>{"use strict";var qS=hc(),Jn=m0();function ue(t){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+t,n=1;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n]);return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var M_=new Set,Ba={};function Ds(t,e){So(t,e),So(t+"Capture",e)}function So(t,e){for(Ba[t]=e,t=0;t<e.length;t++)M_.add(e[t])}var pr=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),wd=Object.prototype.hasOwnProperty,YS=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,g0={},_0={};function ZS(t){return wd.call(_0,t)?!0:wd.call(g0,t)?!1:YS.test(t)?_0[t]=!0:(g0[t]=!0,!1)}function $S(t,e,n,i){if(n!==null&&n.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:n!==null?!n.acceptsBooleans:(t=t.toLowerCase().slice(0,5),t!=="data-"&&t!=="aria-");default:return!1}}function KS(t,e,n,i){if(e===null||typeof e>"u"||$S(t,e,n,i))return!0;if(i)return!1;if(n!==null)switch(n.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function Nn(t,e,n,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=n,this.propertyName=t,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var mn={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t){mn[t]=new Nn(t,0,!1,t,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(t){var e=t[0];mn[e]=new Nn(e,1,!1,t[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(t){mn[t]=new Nn(t,2,!1,t.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(t){mn[t]=new Nn(t,2,!1,t,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t){mn[t]=new Nn(t,3,!1,t.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(t){mn[t]=new Nn(t,3,!0,t,null,!1,!1)});["capture","download"].forEach(function(t){mn[t]=new Nn(t,4,!1,t,null,!1,!1)});["cols","rows","size","span"].forEach(function(t){mn[t]=new Nn(t,6,!1,t,null,!1,!1)});["rowSpan","start"].forEach(function(t){mn[t]=new Nn(t,5,!1,t.toLowerCase(),null,!1,!1)});var mp=/[\-:]([a-z])/g;function gp(t){return t[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t){var e=t.replace(mp,gp);mn[e]=new Nn(e,1,!1,t,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t){var e=t.replace(mp,gp);mn[e]=new Nn(e,1,!1,t,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(t){var e=t.replace(mp,gp);mn[e]=new Nn(e,1,!1,t,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(t){mn[t]=new Nn(t,1,!1,t.toLowerCase(),null,!1,!1)});mn.xlinkHref=new Nn("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(t){mn[t]=new Nn(t,1,!1,t.toLowerCase(),null,!0,!0)});function _p(t,e,n,i){var r=mn.hasOwnProperty(e)?mn[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(KS(e,n,r,i)&&(n=null),i||r===null?ZS(e)&&(n===null?t.removeAttribute(e):t.setAttribute(e,""+n)):r.mustUseProperty?t[r.propertyName]=n===null?r.type===3?!1:"":n:(e=r.attributeName,i=r.attributeNamespace,n===null?t.removeAttribute(e):(r=r.type,n=r===3||r===4&&n===!0?"":""+n,i?t.setAttributeNS(i,e,n):t.setAttribute(e,n))))}var vr=qS.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,_c=Symbol.for("react.element"),no=Symbol.for("react.portal"),io=Symbol.for("react.fragment"),vp=Symbol.for("react.strict_mode"),Ed=Symbol.for("react.profiler"),w_=Symbol.for("react.provider"),E_=Symbol.for("react.context"),xp=Symbol.for("react.forward_ref"),Td=Symbol.for("react.suspense"),bd=Symbol.for("react.suspense_list"),yp=Symbol.for("react.memo"),Nr=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var T_=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var v0=Symbol.iterator;function _a(t){return t===null||typeof t!="object"?null:(t=v0&&t[v0]||t["@@iterator"],typeof t=="function"?t:null)}var Wt=Object.assign,td;function Ta(t){if(td===void 0)try{throw Error()}catch(n){var e=n.stack.trim().match(/\n( *(at )?)/);td=e&&e[1]||""}return`
`+td+t}var nd=!1;function id(t,e){if(!t||nd)return"";nd=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(c){var i=c}Reflect.construct(t,[],e)}else{try{e.call()}catch(c){i=c}t.call(e.prototype)}else{try{throw Error()}catch(c){i=c}t()}}catch(c){if(c&&i&&typeof c.stack=="string"){for(var r=c.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return t.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",t.displayName)),l}while(1<=o&&0<=a);break}}}finally{nd=!1,Error.prepareStackTrace=n}return(t=t?t.displayName||t.name:"")?Ta(t):""}function JS(t){switch(t.tag){case 5:return Ta(t.type);case 16:return Ta("Lazy");case 13:return Ta("Suspense");case 19:return Ta("SuspenseList");case 0:case 2:case 15:return t=id(t.type,!1),t;case 11:return t=id(t.type.render,!1),t;case 1:return t=id(t.type,!0),t;default:return""}}function Ad(t){if(t==null)return null;if(typeof t=="function")return t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case io:return"Fragment";case no:return"Portal";case Ed:return"Profiler";case vp:return"StrictMode";case Td:return"Suspense";case bd:return"SuspenseList"}if(typeof t=="object")switch(t.$$typeof){case E_:return(t.displayName||"Context")+".Consumer";case w_:return(t._context.displayName||"Context")+".Provider";case xp:var e=t.render;return t=t.displayName,t||(t=e.displayName||e.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case yp:return e=t.displayName||null,e!==null?e:Ad(t.type)||"Memo";case Nr:e=t._payload,t=t._init;try{return Ad(t(e))}catch{}}return null}function jS(t){var e=t.type;switch(t.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return t=e.render,t=t.displayName||t.name||"",e.displayName||(t!==""?"ForwardRef("+t+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return Ad(e);case 8:return e===vp?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function Yr(t){switch(typeof t){case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function b_(t){var e=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function QS(t){var e=b_(t)?"checked":"value",n=Object.getOwnPropertyDescriptor(t.constructor.prototype,e),i=""+t[e];if(!t.hasOwnProperty(e)&&typeof n<"u"&&typeof n.get=="function"&&typeof n.set=="function"){var r=n.get,s=n.set;return Object.defineProperty(t,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(t,e,{enumerable:n.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){t._valueTracker=null,delete t[e]}}}}function vc(t){t._valueTracker||(t._valueTracker=QS(t))}function A_(t){if(!t)return!1;var e=t._valueTracker;if(!e)return!0;var n=e.getValue(),i="";return t&&(i=b_(t)?t.checked?"true":"false":t.value),t=i,t!==n?(e.setValue(t),!0):!1}function qc(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}function Cd(t,e){var n=e.checked;return Wt({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??t._wrapperState.initialChecked})}function x0(t,e){var n=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;n=Yr(e.value!=null?e.value:n),t._wrapperState={initialChecked:i,initialValue:n,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function C_(t,e){e=e.checked,e!=null&&_p(t,"checked",e,!1)}function Rd(t,e){C_(t,e);var n=Yr(e.value),i=e.type;if(n!=null)i==="number"?(n===0&&t.value===""||t.value!=n)&&(t.value=""+n):t.value!==""+n&&(t.value=""+n);else if(i==="submit"||i==="reset"){t.removeAttribute("value");return}e.hasOwnProperty("value")?Pd(t,e.type,n):e.hasOwnProperty("defaultValue")&&Pd(t,e.type,Yr(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(t.defaultChecked=!!e.defaultChecked)}function y0(t,e,n){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+t._wrapperState.initialValue,n||e===t.value||(t.value=e),t.defaultValue=e}n=t.name,n!==""&&(t.name=""),t.defaultChecked=!!t._wrapperState.initialChecked,n!==""&&(t.name=n)}function Pd(t,e,n){(e!=="number"||qc(t.ownerDocument)!==t)&&(n==null?t.defaultValue=""+t._wrapperState.initialValue:t.defaultValue!==""+n&&(t.defaultValue=""+n))}var ba=Array.isArray;function mo(t,e,n,i){if(t=t.options,e){e={};for(var r=0;r<n.length;r++)e["$"+n[r]]=!0;for(n=0;n<t.length;n++)r=e.hasOwnProperty("$"+t[n].value),t[n].selected!==r&&(t[n].selected=r),r&&i&&(t[n].defaultSelected=!0)}else{for(n=""+Yr(n),e=null,r=0;r<t.length;r++){if(t[r].value===n){t[r].selected=!0,i&&(t[r].defaultSelected=!0);return}e!==null||t[r].disabled||(e=t[r])}e!==null&&(e.selected=!0)}}function Id(t,e){if(e.dangerouslySetInnerHTML!=null)throw Error(ue(91));return Wt({},e,{value:void 0,defaultValue:void 0,children:""+t._wrapperState.initialValue})}function S0(t,e){var n=e.value;if(n==null){if(n=e.children,e=e.defaultValue,n!=null){if(e!=null)throw Error(ue(92));if(ba(n)){if(1<n.length)throw Error(ue(93));n=n[0]}e=n}e==null&&(e=""),n=e}t._wrapperState={initialValue:Yr(n)}}function R_(t,e){var n=Yr(e.value),i=Yr(e.defaultValue);n!=null&&(n=""+n,n!==t.value&&(t.value=n),e.defaultValue==null&&t.defaultValue!==n&&(t.defaultValue=n)),i!=null&&(t.defaultValue=""+i)}function M0(t){var e=t.textContent;e===t._wrapperState.initialValue&&e!==""&&e!==null&&(t.value=e)}function P_(t){switch(t){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function Ld(t,e){return t==null||t==="http://www.w3.org/1999/xhtml"?P_(e):t==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":t}var xc,I_=function(t){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,n,i,r){MSApp.execUnsafeLocalFunction(function(){return t(e,n,i,r)})}:t}(function(t,e){if(t.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in t)t.innerHTML=e;else{for(xc=xc||document.createElement("div"),xc.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=xc.firstChild;t.firstChild;)t.removeChild(t.firstChild);for(;e.firstChild;)t.appendChild(e.firstChild)}});function ka(t,e){if(e){var n=t.firstChild;if(n&&n===t.lastChild&&n.nodeType===3){n.nodeValue=e;return}}t.textContent=e}var Ra={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},eM=["Webkit","ms","Moz","O"];Object.keys(Ra).forEach(function(t){eM.forEach(function(e){e=e+t.charAt(0).toUpperCase()+t.substring(1),Ra[e]=Ra[t]})});function L_(t,e,n){return e==null||typeof e=="boolean"||e===""?"":n||typeof e!="number"||e===0||Ra.hasOwnProperty(t)&&Ra[t]?(""+e).trim():e+"px"}function N_(t,e){t=t.style;for(var n in e)if(e.hasOwnProperty(n)){var i=n.indexOf("--")===0,r=L_(n,e[n],i);n==="float"&&(n="cssFloat"),i?t.setProperty(n,r):t[n]=r}}var tM=Wt({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function Nd(t,e){if(e){if(tM[t]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(ue(137,t));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(ue(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(ue(61))}if(e.style!=null&&typeof e.style!="object")throw Error(ue(62))}}function Dd(t,e){if(t.indexOf("-")===-1)return typeof e.is=="string";switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var Ud=null;function Sp(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var Fd=null,go=null,_o=null;function w0(t){if(t=il(t)){if(typeof Fd!="function")throw Error(ue(280));var e=t.stateNode;e&&(e=yu(e),Fd(t.stateNode,t.type,e))}}function D_(t){go?_o?_o.push(t):_o=[t]:go=t}function U_(){if(go){var t=go,e=_o;if(_o=go=null,w0(t),e)for(t=0;t<e.length;t++)w0(e[t])}}function F_(t,e){return t(e)}function O_(){}var rd=!1;function B_(t,e,n){if(rd)return t(e,n);rd=!0;try{return F_(t,e,n)}finally{rd=!1,(go!==null||_o!==null)&&(O_(),U_())}}function za(t,e){var n=t.stateNode;if(n===null)return null;var i=yu(n);if(i===null)return null;n=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(t=t.type,i=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!i;break e;default:t=!1}if(t)return null;if(n&&typeof n!="function")throw Error(ue(231,e,typeof n));return n}var Od=!1;if(pr)try{eo={},Object.defineProperty(eo,"passive",{get:function(){Od=!0}}),window.addEventListener("test",eo,eo),window.removeEventListener("test",eo,eo)}catch{Od=!1}var eo;function nM(t,e,n,i,r,s,o,a,l){var c=Array.prototype.slice.call(arguments,3);try{e.apply(n,c)}catch(f){this.onError(f)}}var Pa=!1,Yc=null,Zc=!1,Bd=null,iM={onError:function(t){Pa=!0,Yc=t}};function rM(t,e,n,i,r,s,o,a,l){Pa=!1,Yc=null,nM.apply(iM,arguments)}function sM(t,e,n,i,r,s,o,a,l){if(rM.apply(this,arguments),Pa){if(Pa){var c=Yc;Pa=!1,Yc=null}else throw Error(ue(198));Zc||(Zc=!0,Bd=c)}}function Us(t){var e=t,n=t;if(t.alternate)for(;e.return;)e=e.return;else{t=e;do e=t,e.flags&4098&&(n=e.return),t=e.return;while(t)}return e.tag===3?n:null}function k_(t){if(t.tag===13){var e=t.memoizedState;if(e===null&&(t=t.alternate,t!==null&&(e=t.memoizedState)),e!==null)return e.dehydrated}return null}function E0(t){if(Us(t)!==t)throw Error(ue(188))}function oM(t){var e=t.alternate;if(!e){if(e=Us(t),e===null)throw Error(ue(188));return e!==t?null:t}for(var n=t,i=e;;){var r=n.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){n=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===n)return E0(r),t;if(s===i)return E0(r),e;s=s.sibling}throw Error(ue(188))}if(n.return!==i.return)n=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===n){o=!0,n=r,i=s;break}if(a===i){o=!0,i=r,n=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===n){o=!0,n=s,i=r;break}if(a===i){o=!0,i=s,n=r;break}a=a.sibling}if(!o)throw Error(ue(189))}}if(n.alternate!==i)throw Error(ue(190))}if(n.tag!==3)throw Error(ue(188));return n.stateNode.current===n?t:e}function z_(t){return t=oM(t),t!==null?V_(t):null}function V_(t){if(t.tag===5||t.tag===6)return t;for(t=t.child;t!==null;){var e=V_(t);if(e!==null)return e;t=t.sibling}return null}var H_=Jn.unstable_scheduleCallback,T0=Jn.unstable_cancelCallback,aM=Jn.unstable_shouldYield,lM=Jn.unstable_requestPaint,$t=Jn.unstable_now,cM=Jn.unstable_getCurrentPriorityLevel,Mp=Jn.unstable_ImmediatePriority,G_=Jn.unstable_UserBlockingPriority,$c=Jn.unstable_NormalPriority,uM=Jn.unstable_LowPriority,W_=Jn.unstable_IdlePriority,gu=null,Gi=null;function hM(t){if(Gi&&typeof Gi.onCommitFiberRoot=="function")try{Gi.onCommitFiberRoot(gu,t,void 0,(t.current.flags&128)===128)}catch{}}var bi=Math.clz32?Math.clz32:pM,fM=Math.log,dM=Math.LN2;function pM(t){return t>>>=0,t===0?32:31-(fM(t)/dM|0)|0}var yc=64,Sc=4194304;function Aa(t){switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return t&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return t}}function Kc(t,e){var n=t.pendingLanes;if(n===0)return 0;var i=0,r=t.suspendedLanes,s=t.pingedLanes,o=n&268435455;if(o!==0){var a=o&~r;a!==0?i=Aa(a):(s&=o,s!==0&&(i=Aa(s)))}else o=n&~r,o!==0?i=Aa(o):s!==0&&(i=Aa(s));if(i===0)return 0;if(e!==0&&e!==i&&!(e&r)&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if(i&4&&(i|=n&16),e=t.entangledLanes,e!==0)for(t=t.entanglements,e&=i;0<e;)n=31-bi(e),r=1<<n,i|=t[n],e&=~r;return i}function mM(t,e){switch(t){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function gM(t,e){for(var n=t.suspendedLanes,i=t.pingedLanes,r=t.expirationTimes,s=t.pendingLanes;0<s;){var o=31-bi(s),a=1<<o,l=r[o];l===-1?(!(a&n)||a&i)&&(r[o]=mM(a,e)):l<=e&&(t.expiredLanes|=a),s&=~a}}function kd(t){return t=t.pendingLanes&-1073741825,t!==0?t:t&1073741824?1073741824:0}function X_(){var t=yc;return yc<<=1,!(yc&4194240)&&(yc=64),t}function sd(t){for(var e=[],n=0;31>n;n++)e.push(t);return e}function tl(t,e,n){t.pendingLanes|=e,e!==536870912&&(t.suspendedLanes=0,t.pingedLanes=0),t=t.eventTimes,e=31-bi(e),t[e]=n}function _M(t,e){var n=t.pendingLanes&~e;t.pendingLanes=e,t.suspendedLanes=0,t.pingedLanes=0,t.expiredLanes&=e,t.mutableReadLanes&=e,t.entangledLanes&=e,e=t.entanglements;var i=t.eventTimes;for(t=t.expirationTimes;0<n;){var r=31-bi(n),s=1<<r;e[r]=0,i[r]=-1,t[r]=-1,n&=~s}}function wp(t,e){var n=t.entangledLanes|=e;for(t=t.entanglements;n;){var i=31-bi(n),r=1<<i;r&e|t[i]&e&&(t[i]|=e),n&=~r}}var Ct=0;function q_(t){return t&=-t,1<t?4<t?t&268435455?16:536870912:4:1}var Y_,Ep,Z_,$_,K_,zd=!1,Mc=[],kr=null,zr=null,Vr=null,Va=new Map,Ha=new Map,Ur=[],vM="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function b0(t,e){switch(t){case"focusin":case"focusout":kr=null;break;case"dragenter":case"dragleave":zr=null;break;case"mouseover":case"mouseout":Vr=null;break;case"pointerover":case"pointerout":Va.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":Ha.delete(e.pointerId)}}function va(t,e,n,i,r,s){return t===null||t.nativeEvent!==s?(t={blockedOn:e,domEventName:n,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=il(e),e!==null&&Ep(e)),t):(t.eventSystemFlags|=i,e=t.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),t)}function xM(t,e,n,i,r){switch(e){case"focusin":return kr=va(kr,t,e,n,i,r),!0;case"dragenter":return zr=va(zr,t,e,n,i,r),!0;case"mouseover":return Vr=va(Vr,t,e,n,i,r),!0;case"pointerover":var s=r.pointerId;return Va.set(s,va(Va.get(s)||null,t,e,n,i,r)),!0;case"gotpointercapture":return s=r.pointerId,Ha.set(s,va(Ha.get(s)||null,t,e,n,i,r)),!0}return!1}function J_(t){var e=Es(t.target);if(e!==null){var n=Us(e);if(n!==null){if(e=n.tag,e===13){if(e=k_(n),e!==null){t.blockedOn=e,K_(t.priority,function(){Z_(n)});return}}else if(e===3&&n.stateNode.current.memoizedState.isDehydrated){t.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}t.blockedOn=null}function Fc(t){if(t.blockedOn!==null)return!1;for(var e=t.targetContainers;0<e.length;){var n=Vd(t.domEventName,t.eventSystemFlags,e[0],t.nativeEvent);if(n===null){n=t.nativeEvent;var i=new n.constructor(n.type,n);Ud=i,n.target.dispatchEvent(i),Ud=null}else return e=il(n),e!==null&&Ep(e),t.blockedOn=n,!1;e.shift()}return!0}function A0(t,e,n){Fc(t)&&n.delete(e)}function yM(){zd=!1,kr!==null&&Fc(kr)&&(kr=null),zr!==null&&Fc(zr)&&(zr=null),Vr!==null&&Fc(Vr)&&(Vr=null),Va.forEach(A0),Ha.forEach(A0)}function xa(t,e){t.blockedOn===e&&(t.blockedOn=null,zd||(zd=!0,Jn.unstable_scheduleCallback(Jn.unstable_NormalPriority,yM)))}function Ga(t){function e(r){return xa(r,t)}if(0<Mc.length){xa(Mc[0],t);for(var n=1;n<Mc.length;n++){var i=Mc[n];i.blockedOn===t&&(i.blockedOn=null)}}for(kr!==null&&xa(kr,t),zr!==null&&xa(zr,t),Vr!==null&&xa(Vr,t),Va.forEach(e),Ha.forEach(e),n=0;n<Ur.length;n++)i=Ur[n],i.blockedOn===t&&(i.blockedOn=null);for(;0<Ur.length&&(n=Ur[0],n.blockedOn===null);)J_(n),n.blockedOn===null&&Ur.shift()}var vo=vr.ReactCurrentBatchConfig,Jc=!0;function SM(t,e,n,i){var r=Ct,s=vo.transition;vo.transition=null;try{Ct=1,Tp(t,e,n,i)}finally{Ct=r,vo.transition=s}}function MM(t,e,n,i){var r=Ct,s=vo.transition;vo.transition=null;try{Ct=4,Tp(t,e,n,i)}finally{Ct=r,vo.transition=s}}function Tp(t,e,n,i){if(Jc){var r=Vd(t,e,n,i);if(r===null)fd(t,e,i,jc,n),b0(t,i);else if(xM(r,t,e,n,i))i.stopPropagation();else if(b0(t,i),e&4&&-1<vM.indexOf(t)){for(;r!==null;){var s=il(r);if(s!==null&&Y_(s),s=Vd(t,e,n,i),s===null&&fd(t,e,i,jc,n),s===r)break;r=s}r!==null&&i.stopPropagation()}else fd(t,e,i,null,n)}}var jc=null;function Vd(t,e,n,i){if(jc=null,t=Sp(i),t=Es(t),t!==null)if(e=Us(t),e===null)t=null;else if(n=e.tag,n===13){if(t=k_(e),t!==null)return t;t=null}else if(n===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;t=null}else e!==t&&(t=null);return jc=t,null}function j_(t){switch(t){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(cM()){case Mp:return 1;case G_:return 4;case $c:case uM:return 16;case W_:return 536870912;default:return 16}default:return 16}}var Or=null,bp=null,Oc=null;function Q_(){if(Oc)return Oc;var t,e=bp,n=e.length,i,r="value"in Or?Or.value:Or.textContent,s=r.length;for(t=0;t<n&&e[t]===r[t];t++);var o=n-t;for(i=1;i<=o&&e[n-i]===r[s-i];i++);return Oc=r.slice(t,1<i?1-i:void 0)}function Bc(t){var e=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&e===13&&(t=13)):t=e,t===10&&(t=13),32<=t||t===13?t:0}function wc(){return!0}function C0(){return!1}function jn(t){function e(n,i,r,s,o){this._reactName=n,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in t)t.hasOwnProperty(a)&&(n=t[a],this[a]=n?n(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?wc:C0,this.isPropagationStopped=C0,this}return Wt(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=wc)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=wc)},persist:function(){},isPersistent:wc}),e}var Co={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},Ap=jn(Co),nl=Wt({},Co,{view:0,detail:0}),wM=jn(nl),od,ad,ya,_u=Wt({},nl,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:Cp,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==ya&&(ya&&t.type==="mousemove"?(od=t.screenX-ya.screenX,ad=t.screenY-ya.screenY):ad=od=0,ya=t),od)},movementY:function(t){return"movementY"in t?t.movementY:ad}}),R0=jn(_u),EM=Wt({},_u,{dataTransfer:0}),TM=jn(EM),bM=Wt({},nl,{relatedTarget:0}),ld=jn(bM),AM=Wt({},Co,{animationName:0,elapsedTime:0,pseudoElement:0}),CM=jn(AM),RM=Wt({},Co,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),PM=jn(RM),IM=Wt({},Co,{data:0}),P0=jn(IM),LM={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},NM={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},DM={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function UM(t){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(t):(t=DM[t])?!!e[t]:!1}function Cp(){return UM}var FM=Wt({},nl,{key:function(t){if(t.key){var e=LM[t.key]||t.key;if(e!=="Unidentified")return e}return t.type==="keypress"?(t=Bc(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?NM[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:Cp,charCode:function(t){return t.type==="keypress"?Bc(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?Bc(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),OM=jn(FM),BM=Wt({},_u,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),I0=jn(BM),kM=Wt({},nl,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:Cp}),zM=jn(kM),VM=Wt({},Co,{propertyName:0,elapsedTime:0,pseudoElement:0}),HM=jn(VM),GM=Wt({},_u,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),WM=jn(GM),XM=[9,13,27,32],Rp=pr&&"CompositionEvent"in window,Ia=null;pr&&"documentMode"in document&&(Ia=document.documentMode);var qM=pr&&"TextEvent"in window&&!Ia,ev=pr&&(!Rp||Ia&&8<Ia&&11>=Ia),L0=" ",N0=!1;function tv(t,e){switch(t){case"keyup":return XM.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function nv(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var ro=!1;function YM(t,e){switch(t){case"compositionend":return nv(e);case"keypress":return e.which!==32?null:(N0=!0,L0);case"textInput":return t=e.data,t===L0&&N0?null:t;default:return null}}function ZM(t,e){if(ro)return t==="compositionend"||!Rp&&tv(t,e)?(t=Q_(),Oc=bp=Or=null,ro=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return ev&&e.locale!=="ko"?null:e.data;default:return null}}var $M={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function D0(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e==="input"?!!$M[t.type]:e==="textarea"}function iv(t,e,n,i){D_(i),e=Qc(e,"onChange"),0<e.length&&(n=new Ap("onChange","change",null,n,i),t.push({event:n,listeners:e}))}var La=null,Wa=null;function KM(t){pv(t,0)}function vu(t){var e=ao(t);if(A_(e))return t}function JM(t,e){if(t==="change")return e}var rv=!1;pr&&(pr?(Tc="oninput"in document,Tc||(cd=document.createElement("div"),cd.setAttribute("oninput","return;"),Tc=typeof cd.oninput=="function"),Ec=Tc):Ec=!1,rv=Ec&&(!document.documentMode||9<document.documentMode));var Ec,Tc,cd;function U0(){La&&(La.detachEvent("onpropertychange",sv),Wa=La=null)}function sv(t){if(t.propertyName==="value"&&vu(Wa)){var e=[];iv(e,Wa,t,Sp(t)),B_(KM,e)}}function jM(t,e,n){t==="focusin"?(U0(),La=e,Wa=n,La.attachEvent("onpropertychange",sv)):t==="focusout"&&U0()}function QM(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return vu(Wa)}function e1(t,e){if(t==="click")return vu(e)}function t1(t,e){if(t==="input"||t==="change")return vu(e)}function n1(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var Ci=typeof Object.is=="function"?Object.is:n1;function Xa(t,e){if(Ci(t,e))return!0;if(typeof t!="object"||t===null||typeof e!="object"||e===null)return!1;var n=Object.keys(t),i=Object.keys(e);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var r=n[i];if(!wd.call(e,r)||!Ci(t[r],e[r]))return!1}return!0}function F0(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function O0(t,e){var n=F0(t);t=0;for(var i;n;){if(n.nodeType===3){if(i=t+n.textContent.length,t<=e&&i>=e)return{node:n,offset:e-t};t=i}e:{for(;n;){if(n.nextSibling){n=n.nextSibling;break e}n=n.parentNode}n=void 0}n=F0(n)}}function ov(t,e){return t&&e?t===e?!0:t&&t.nodeType===3?!1:e&&e.nodeType===3?ov(t,e.parentNode):"contains"in t?t.contains(e):t.compareDocumentPosition?!!(t.compareDocumentPosition(e)&16):!1:!1}function av(){for(var t=window,e=qc();e instanceof t.HTMLIFrameElement;){try{var n=typeof e.contentWindow.location.href=="string"}catch{n=!1}if(n)t=e.contentWindow;else break;e=qc(t.document)}return e}function Pp(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e&&(e==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||e==="textarea"||t.contentEditable==="true")}function i1(t){var e=av(),n=t.focusedElem,i=t.selectionRange;if(e!==n&&n&&n.ownerDocument&&ov(n.ownerDocument.documentElement,n)){if(i!==null&&Pp(n)){if(e=i.start,t=i.end,t===void 0&&(t=e),"selectionStart"in n)n.selectionStart=e,n.selectionEnd=Math.min(t,n.value.length);else if(t=(e=n.ownerDocument||document)&&e.defaultView||window,t.getSelection){t=t.getSelection();var r=n.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!t.extend&&s>i&&(r=i,i=s,s=r),r=O0(n,s);var o=O0(n,i);r&&o&&(t.rangeCount!==1||t.anchorNode!==r.node||t.anchorOffset!==r.offset||t.focusNode!==o.node||t.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),t.removeAllRanges(),s>i?(t.addRange(e),t.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),t.addRange(e)))}}for(e=[],t=n;t=t.parentNode;)t.nodeType===1&&e.push({element:t,left:t.scrollLeft,top:t.scrollTop});for(typeof n.focus=="function"&&n.focus(),n=0;n<e.length;n++)t=e[n],t.element.scrollLeft=t.left,t.element.scrollTop=t.top}}var r1=pr&&"documentMode"in document&&11>=document.documentMode,so=null,Hd=null,Na=null,Gd=!1;function B0(t,e,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;Gd||so==null||so!==qc(i)||(i=so,"selectionStart"in i&&Pp(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),Na&&Xa(Na,i)||(Na=i,i=Qc(Hd,"onSelect"),0<i.length&&(e=new Ap("onSelect","select",null,e,n),t.push({event:e,listeners:i}),e.target=so)))}function bc(t,e){var n={};return n[t.toLowerCase()]=e.toLowerCase(),n["Webkit"+t]="webkit"+e,n["Moz"+t]="moz"+e,n}var oo={animationend:bc("Animation","AnimationEnd"),animationiteration:bc("Animation","AnimationIteration"),animationstart:bc("Animation","AnimationStart"),transitionend:bc("Transition","TransitionEnd")},ud={},lv={};pr&&(lv=document.createElement("div").style,"AnimationEvent"in window||(delete oo.animationend.animation,delete oo.animationiteration.animation,delete oo.animationstart.animation),"TransitionEvent"in window||delete oo.transitionend.transition);function xu(t){if(ud[t])return ud[t];if(!oo[t])return t;var e=oo[t],n;for(n in e)if(e.hasOwnProperty(n)&&n in lv)return ud[t]=e[n];return t}var cv=xu("animationend"),uv=xu("animationiteration"),hv=xu("animationstart"),fv=xu("transitionend"),dv=new Map,k0="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function $r(t,e){dv.set(t,e),Ds(e,[t])}for(Ac=0;Ac<k0.length;Ac++)Cc=k0[Ac],z0=Cc.toLowerCase(),V0=Cc[0].toUpperCase()+Cc.slice(1),$r(z0,"on"+V0);var Cc,z0,V0,Ac;$r(cv,"onAnimationEnd");$r(uv,"onAnimationIteration");$r(hv,"onAnimationStart");$r("dblclick","onDoubleClick");$r("focusin","onFocus");$r("focusout","onBlur");$r(fv,"onTransitionEnd");So("onMouseEnter",["mouseout","mouseover"]);So("onMouseLeave",["mouseout","mouseover"]);So("onPointerEnter",["pointerout","pointerover"]);So("onPointerLeave",["pointerout","pointerover"]);Ds("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));Ds("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));Ds("onBeforeInput",["compositionend","keypress","textInput","paste"]);Ds("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));Ds("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));Ds("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var Ca="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),s1=new Set("cancel close invalid load scroll toggle".split(" ").concat(Ca));function H0(t,e,n){var i=t.type||"unknown-event";t.currentTarget=n,sM(i,e,void 0,t),t.currentTarget=null}function pv(t,e){e=(e&4)!==0;for(var n=0;n<t.length;n++){var i=t[n],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,c=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;H0(r,a,c),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,c=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;H0(r,a,c),s=l}}}if(Zc)throw t=Bd,Zc=!1,Bd=null,t}function Dt(t,e){var n=e[Zd];n===void 0&&(n=e[Zd]=new Set);var i=t+"__bubble";n.has(i)||(mv(e,t,2,!1),n.add(i))}function hd(t,e,n){var i=0;e&&(i|=4),mv(n,t,i,e)}var Rc="_reactListening"+Math.random().toString(36).slice(2);function qa(t){if(!t[Rc]){t[Rc]=!0,M_.forEach(function(n){n!=="selectionchange"&&(s1.has(n)||hd(n,!1,t),hd(n,!0,t))});var e=t.nodeType===9?t:t.ownerDocument;e===null||e[Rc]||(e[Rc]=!0,hd("selectionchange",!1,e))}}function mv(t,e,n,i){switch(j_(e)){case 1:var r=SM;break;case 4:r=MM;break;default:r=Tp}n=r.bind(null,e,n,t),r=void 0,!Od||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?t.addEventListener(e,n,{capture:!0,passive:r}):t.addEventListener(e,n,!0):r!==void 0?t.addEventListener(e,n,{passive:r}):t.addEventListener(e,n,!1)}function fd(t,e,n,i,r){var s=i;if(!(e&1)&&!(e&2)&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=Es(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}B_(function(){var c=s,f=Sp(n),d=[];e:{var h=dv.get(t);if(h!==void 0){var p=Ap,_=t;switch(t){case"keypress":if(Bc(n)===0)break e;case"keydown":case"keyup":p=OM;break;case"focusin":_="focus",p=ld;break;case"focusout":_="blur",p=ld;break;case"beforeblur":case"afterblur":p=ld;break;case"click":if(n.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":p=R0;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":p=TM;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":p=zM;break;case cv:case uv:case hv:p=CM;break;case fv:p=HM;break;case"scroll":p=wM;break;case"wheel":p=WM;break;case"copy":case"cut":case"paste":p=PM;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":p=I0}var S=(e&4)!==0,m=!S&&t==="scroll",u=S?h!==null?h+"Capture":null:h;S=[];for(var g=c,v;g!==null;){v=g;var y=v.stateNode;if(v.tag===5&&y!==null&&(v=y,u!==null&&(y=za(g,u),y!=null&&S.push(Ya(g,y,v)))),m)break;g=g.return}0<S.length&&(h=new p(h,_,null,n,f),d.push({event:h,listeners:S}))}}if(!(e&7)){e:{if(h=t==="mouseover"||t==="pointerover",p=t==="mouseout"||t==="pointerout",h&&n!==Ud&&(_=n.relatedTarget||n.fromElement)&&(Es(_)||_[mr]))break e;if((p||h)&&(h=f.window===f?f:(h=f.ownerDocument)?h.defaultView||h.parentWindow:window,p?(_=n.relatedTarget||n.toElement,p=c,_=_?Es(_):null,_!==null&&(m=Us(_),_!==m||_.tag!==5&&_.tag!==6)&&(_=null)):(p=null,_=c),p!==_)){if(S=R0,y="onMouseLeave",u="onMouseEnter",g="mouse",(t==="pointerout"||t==="pointerover")&&(S=I0,y="onPointerLeave",u="onPointerEnter",g="pointer"),m=p==null?h:ao(p),v=_==null?h:ao(_),h=new S(y,g+"leave",p,n,f),h.target=m,h.relatedTarget=v,y=null,Es(f)===c&&(S=new S(u,g+"enter",_,n,f),S.target=v,S.relatedTarget=m,y=S),m=y,p&&_)t:{for(S=p,u=_,g=0,v=S;v;v=to(v))g++;for(v=0,y=u;y;y=to(y))v++;for(;0<g-v;)S=to(S),g--;for(;0<v-g;)u=to(u),v--;for(;g--;){if(S===u||u!==null&&S===u.alternate)break t;S=to(S),u=to(u)}S=null}else S=null;p!==null&&G0(d,h,p,S,!1),_!==null&&m!==null&&G0(d,m,_,S,!0)}}e:{if(h=c?ao(c):window,p=h.nodeName&&h.nodeName.toLowerCase(),p==="select"||p==="input"&&h.type==="file")var A=JM;else if(D0(h))if(rv)A=t1;else{A=QM;var w=jM}else(p=h.nodeName)&&p.toLowerCase()==="input"&&(h.type==="checkbox"||h.type==="radio")&&(A=e1);if(A&&(A=A(t,c))){iv(d,A,n,f);break e}w&&w(t,h,c),t==="focusout"&&(w=h._wrapperState)&&w.controlled&&h.type==="number"&&Pd(h,"number",h.value)}switch(w=c?ao(c):window,t){case"focusin":(D0(w)||w.contentEditable==="true")&&(so=w,Hd=c,Na=null);break;case"focusout":Na=Hd=so=null;break;case"mousedown":Gd=!0;break;case"contextmenu":case"mouseup":case"dragend":Gd=!1,B0(d,n,f);break;case"selectionchange":if(r1)break;case"keydown":case"keyup":B0(d,n,f)}var C;if(Rp)e:{switch(t){case"compositionstart":var x="onCompositionStart";break e;case"compositionend":x="onCompositionEnd";break e;case"compositionupdate":x="onCompositionUpdate";break e}x=void 0}else ro?tv(t,n)&&(x="onCompositionEnd"):t==="keydown"&&n.keyCode===229&&(x="onCompositionStart");x&&(ev&&n.locale!=="ko"&&(ro||x!=="onCompositionStart"?x==="onCompositionEnd"&&ro&&(C=Q_()):(Or=f,bp="value"in Or?Or.value:Or.textContent,ro=!0)),w=Qc(c,x),0<w.length&&(x=new P0(x,t,null,n,f),d.push({event:x,listeners:w}),C?x.data=C:(C=nv(n),C!==null&&(x.data=C)))),(C=qM?YM(t,n):ZM(t,n))&&(c=Qc(c,"onBeforeInput"),0<c.length&&(f=new P0("onBeforeInput","beforeinput",null,n,f),d.push({event:f,listeners:c}),f.data=C))}pv(d,e)})}function Ya(t,e,n){return{instance:t,listener:e,currentTarget:n}}function Qc(t,e){for(var n=e+"Capture",i=[];t!==null;){var r=t,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=za(t,n),s!=null&&i.unshift(Ya(t,s,r)),s=za(t,e),s!=null&&i.push(Ya(t,s,r))),t=t.return}return i}function to(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5);return t||null}function G0(t,e,n,i,r){for(var s=e._reactName,o=[];n!==null&&n!==i;){var a=n,l=a.alternate,c=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&c!==null&&(a=c,r?(l=za(n,s),l!=null&&o.unshift(Ya(n,l,a))):r||(l=za(n,s),l!=null&&o.push(Ya(n,l,a)))),n=n.return}o.length!==0&&t.push({event:e,listeners:o})}var o1=/\r\n?/g,a1=/\u0000|\uFFFD/g;function W0(t){return(typeof t=="string"?t:""+t).replace(o1,`
`).replace(a1,"")}function Pc(t,e,n){if(e=W0(e),W0(t)!==e&&n)throw Error(ue(425))}function eu(){}var Wd=null,Xd=null;function qd(t,e){return t==="textarea"||t==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var Yd=typeof setTimeout=="function"?setTimeout:void 0,l1=typeof clearTimeout=="function"?clearTimeout:void 0,X0=typeof Promise=="function"?Promise:void 0,c1=typeof queueMicrotask=="function"?queueMicrotask:typeof X0<"u"?function(t){return X0.resolve(null).then(t).catch(u1)}:Yd;function u1(t){setTimeout(function(){throw t})}function dd(t,e){var n=e,i=0;do{var r=n.nextSibling;if(t.removeChild(n),r&&r.nodeType===8)if(n=r.data,n==="/$"){if(i===0){t.removeChild(r),Ga(e);return}i--}else n!=="$"&&n!=="$?"&&n!=="$!"||i++;n=r}while(n);Ga(e)}function Hr(t){for(;t!=null;t=t.nextSibling){var e=t.nodeType;if(e===1||e===3)break;if(e===8){if(e=t.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return t}function q0(t){t=t.previousSibling;for(var e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="$"||n==="$!"||n==="$?"){if(e===0)return t;e--}else n==="/$"&&e++}t=t.previousSibling}return null}var Ro=Math.random().toString(36).slice(2),Hi="__reactFiber$"+Ro,Za="__reactProps$"+Ro,mr="__reactContainer$"+Ro,Zd="__reactEvents$"+Ro,h1="__reactListeners$"+Ro,f1="__reactHandles$"+Ro;function Es(t){var e=t[Hi];if(e)return e;for(var n=t.parentNode;n;){if(e=n[mr]||n[Hi]){if(n=e.alternate,e.child!==null||n!==null&&n.child!==null)for(t=q0(t);t!==null;){if(n=t[Hi])return n;t=q0(t)}return e}t=n,n=t.parentNode}return null}function il(t){return t=t[Hi]||t[mr],!t||t.tag!==5&&t.tag!==6&&t.tag!==13&&t.tag!==3?null:t}function ao(t){if(t.tag===5||t.tag===6)return t.stateNode;throw Error(ue(33))}function yu(t){return t[Za]||null}var $d=[],lo=-1;function Kr(t){return{current:t}}function Ut(t){0>lo||(t.current=$d[lo],$d[lo]=null,lo--)}function Lt(t,e){lo++,$d[lo]=t.current,t.current=e}var Zr={},Mn=Kr(Zr),Hn=Kr(!1),Rs=Zr;function Mo(t,e){var n=t.type.contextTypes;if(!n)return Zr;var i=t.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in n)r[s]=e[s];return i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=e,t.__reactInternalMemoizedMaskedChildContext=r),r}function Gn(t){return t=t.childContextTypes,t!=null}function tu(){Ut(Hn),Ut(Mn)}function Y0(t,e,n){if(Mn.current!==Zr)throw Error(ue(168));Lt(Mn,e),Lt(Hn,n)}function gv(t,e,n){var i=t.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return n;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(ue(108,jS(t)||"Unknown",r));return Wt({},n,i)}function nu(t){return t=(t=t.stateNode)&&t.__reactInternalMemoizedMergedChildContext||Zr,Rs=Mn.current,Lt(Mn,t),Lt(Hn,Hn.current),!0}function Z0(t,e,n){var i=t.stateNode;if(!i)throw Error(ue(169));n?(t=gv(t,e,Rs),i.__reactInternalMemoizedMergedChildContext=t,Ut(Hn),Ut(Mn),Lt(Mn,t)):Ut(Hn),Lt(Hn,n)}var ur=null,Su=!1,pd=!1;function _v(t){ur===null?ur=[t]:ur.push(t)}function d1(t){Su=!0,_v(t)}function Jr(){if(!pd&&ur!==null){pd=!0;var t=0,e=Ct;try{var n=ur;for(Ct=1;t<n.length;t++){var i=n[t];do i=i(!0);while(i!==null)}ur=null,Su=!1}catch(r){throw ur!==null&&(ur=ur.slice(t+1)),H_(Mp,Jr),r}finally{Ct=e,pd=!1}}return null}var co=[],uo=0,iu=null,ru=0,ci=[],ui=0,Ps=null,hr=1,fr="";function Ms(t,e){co[uo++]=ru,co[uo++]=iu,iu=t,ru=e}function vv(t,e,n){ci[ui++]=hr,ci[ui++]=fr,ci[ui++]=Ps,Ps=t;var i=hr;t=fr;var r=32-bi(i)-1;i&=~(1<<r),n+=1;var s=32-bi(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,hr=1<<32-bi(e)+r|n<<r|i,fr=s+t}else hr=1<<s|n<<r|i,fr=t}function Ip(t){t.return!==null&&(Ms(t,1),vv(t,1,0))}function Lp(t){for(;t===iu;)iu=co[--uo],co[uo]=null,ru=co[--uo],co[uo]=null;for(;t===Ps;)Ps=ci[--ui],ci[ui]=null,fr=ci[--ui],ci[ui]=null,hr=ci[--ui],ci[ui]=null}var Kn=null,$n=null,kt=!1,Ti=null;function xv(t,e){var n=hi(5,null,null,0);n.elementType="DELETED",n.stateNode=e,n.return=t,e=t.deletions,e===null?(t.deletions=[n],t.flags|=16):e.push(n)}function $0(t,e){switch(t.tag){case 5:var n=t.type;return e=e.nodeType!==1||n.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(t.stateNode=e,Kn=t,$n=Hr(e.firstChild),!0):!1;case 6:return e=t.pendingProps===""||e.nodeType!==3?null:e,e!==null?(t.stateNode=e,Kn=t,$n=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(n=Ps!==null?{id:hr,overflow:fr}:null,t.memoizedState={dehydrated:e,treeContext:n,retryLane:1073741824},n=hi(18,null,null,0),n.stateNode=e,n.return=t,t.child=n,Kn=t,$n=null,!0):!1;default:return!1}}function Kd(t){return(t.mode&1)!==0&&(t.flags&128)===0}function Jd(t){if(kt){var e=$n;if(e){var n=e;if(!$0(t,e)){if(Kd(t))throw Error(ue(418));e=Hr(n.nextSibling);var i=Kn;e&&$0(t,e)?xv(i,n):(t.flags=t.flags&-4097|2,kt=!1,Kn=t)}}else{if(Kd(t))throw Error(ue(418));t.flags=t.flags&-4097|2,kt=!1,Kn=t}}}function K0(t){for(t=t.return;t!==null&&t.tag!==5&&t.tag!==3&&t.tag!==13;)t=t.return;Kn=t}function Ic(t){if(t!==Kn)return!1;if(!kt)return K0(t),kt=!0,!1;var e;if((e=t.tag!==3)&&!(e=t.tag!==5)&&(e=t.type,e=e!=="head"&&e!=="body"&&!qd(t.type,t.memoizedProps)),e&&(e=$n)){if(Kd(t))throw yv(),Error(ue(418));for(;e;)xv(t,e),e=Hr(e.nextSibling)}if(K0(t),t.tag===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(ue(317));e:{for(t=t.nextSibling,e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="/$"){if(e===0){$n=Hr(t.nextSibling);break e}e--}else n!=="$"&&n!=="$!"&&n!=="$?"||e++}t=t.nextSibling}$n=null}}else $n=Kn?Hr(t.stateNode.nextSibling):null;return!0}function yv(){for(var t=$n;t;)t=Hr(t.nextSibling)}function wo(){$n=Kn=null,kt=!1}function Np(t){Ti===null?Ti=[t]:Ti.push(t)}var p1=vr.ReactCurrentBatchConfig;function Sa(t,e,n){if(t=n.ref,t!==null&&typeof t!="function"&&typeof t!="object"){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(ue(309));var i=n.stateNode}if(!i)throw Error(ue(147,t));var r=i,s=""+t;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof t!="string")throw Error(ue(284));if(!n._owner)throw Error(ue(290,t))}return t}function Lc(t,e){throw t=Object.prototype.toString.call(e),Error(ue(31,t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t))}function J0(t){var e=t._init;return e(t._payload)}function Sv(t){function e(u,g){if(t){var v=u.deletions;v===null?(u.deletions=[g],u.flags|=16):v.push(g)}}function n(u,g){if(!t)return null;for(;g!==null;)e(u,g),g=g.sibling;return null}function i(u,g){for(u=new Map;g!==null;)g.key!==null?u.set(g.key,g):u.set(g.index,g),g=g.sibling;return u}function r(u,g){return u=qr(u,g),u.index=0,u.sibling=null,u}function s(u,g,v){return u.index=v,t?(v=u.alternate,v!==null?(v=v.index,v<g?(u.flags|=2,g):v):(u.flags|=2,g)):(u.flags|=1048576,g)}function o(u){return t&&u.alternate===null&&(u.flags|=2),u}function a(u,g,v,y){return g===null||g.tag!==6?(g=Sd(v,u.mode,y),g.return=u,g):(g=r(g,v),g.return=u,g)}function l(u,g,v,y){var A=v.type;return A===io?f(u,g,v.props.children,y,v.key):g!==null&&(g.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===Nr&&J0(A)===g.type)?(y=r(g,v.props),y.ref=Sa(u,g,v),y.return=u,y):(y=Xc(v.type,v.key,v.props,null,u.mode,y),y.ref=Sa(u,g,v),y.return=u,y)}function c(u,g,v,y){return g===null||g.tag!==4||g.stateNode.containerInfo!==v.containerInfo||g.stateNode.implementation!==v.implementation?(g=Md(v,u.mode,y),g.return=u,g):(g=r(g,v.children||[]),g.return=u,g)}function f(u,g,v,y,A){return g===null||g.tag!==7?(g=Cs(v,u.mode,y,A),g.return=u,g):(g=r(g,v),g.return=u,g)}function d(u,g,v){if(typeof g=="string"&&g!==""||typeof g=="number")return g=Sd(""+g,u.mode,v),g.return=u,g;if(typeof g=="object"&&g!==null){switch(g.$$typeof){case _c:return v=Xc(g.type,g.key,g.props,null,u.mode,v),v.ref=Sa(u,null,g),v.return=u,v;case no:return g=Md(g,u.mode,v),g.return=u,g;case Nr:var y=g._init;return d(u,y(g._payload),v)}if(ba(g)||_a(g))return g=Cs(g,u.mode,v,null),g.return=u,g;Lc(u,g)}return null}function h(u,g,v,y){var A=g!==null?g.key:null;if(typeof v=="string"&&v!==""||typeof v=="number")return A!==null?null:a(u,g,""+v,y);if(typeof v=="object"&&v!==null){switch(v.$$typeof){case _c:return v.key===A?l(u,g,v,y):null;case no:return v.key===A?c(u,g,v,y):null;case Nr:return A=v._init,h(u,g,A(v._payload),y)}if(ba(v)||_a(v))return A!==null?null:f(u,g,v,y,null);Lc(u,v)}return null}function p(u,g,v,y,A){if(typeof y=="string"&&y!==""||typeof y=="number")return u=u.get(v)||null,a(g,u,""+y,A);if(typeof y=="object"&&y!==null){switch(y.$$typeof){case _c:return u=u.get(y.key===null?v:y.key)||null,l(g,u,y,A);case no:return u=u.get(y.key===null?v:y.key)||null,c(g,u,y,A);case Nr:var w=y._init;return p(u,g,v,w(y._payload),A)}if(ba(y)||_a(y))return u=u.get(v)||null,f(g,u,y,A,null);Lc(g,y)}return null}function _(u,g,v,y){for(var A=null,w=null,C=g,x=g=0,b=null;C!==null&&x<v.length;x++){C.index>x?(b=C,C=null):b=C.sibling;var P=h(u,C,v[x],y);if(P===null){C===null&&(C=b);break}t&&C&&P.alternate===null&&e(u,C),g=s(P,g,x),w===null?A=P:w.sibling=P,w=P,C=b}if(x===v.length)return n(u,C),kt&&Ms(u,x),A;if(C===null){for(;x<v.length;x++)C=d(u,v[x],y),C!==null&&(g=s(C,g,x),w===null?A=C:w.sibling=C,w=C);return kt&&Ms(u,x),A}for(C=i(u,C);x<v.length;x++)b=p(C,u,x,v[x],y),b!==null&&(t&&b.alternate!==null&&C.delete(b.key===null?x:b.key),g=s(b,g,x),w===null?A=b:w.sibling=b,w=b);return t&&C.forEach(function(R){return e(u,R)}),kt&&Ms(u,x),A}function S(u,g,v,y){var A=_a(v);if(typeof A!="function")throw Error(ue(150));if(v=A.call(v),v==null)throw Error(ue(151));for(var w=A=null,C=g,x=g=0,b=null,P=v.next();C!==null&&!P.done;x++,P=v.next()){C.index>x?(b=C,C=null):b=C.sibling;var R=h(u,C,P.value,y);if(R===null){C===null&&(C=b);break}t&&C&&R.alternate===null&&e(u,C),g=s(R,g,x),w===null?A=R:w.sibling=R,w=R,C=b}if(P.done)return n(u,C),kt&&Ms(u,x),A;if(C===null){for(;!P.done;x++,P=v.next())P=d(u,P.value,y),P!==null&&(g=s(P,g,x),w===null?A=P:w.sibling=P,w=P);return kt&&Ms(u,x),A}for(C=i(u,C);!P.done;x++,P=v.next())P=p(C,u,x,P.value,y),P!==null&&(t&&P.alternate!==null&&C.delete(P.key===null?x:P.key),g=s(P,g,x),w===null?A=P:w.sibling=P,w=P);return t&&C.forEach(function(F){return e(u,F)}),kt&&Ms(u,x),A}function m(u,g,v,y){if(typeof v=="object"&&v!==null&&v.type===io&&v.key===null&&(v=v.props.children),typeof v=="object"&&v!==null){switch(v.$$typeof){case _c:e:{for(var A=v.key,w=g;w!==null;){if(w.key===A){if(A=v.type,A===io){if(w.tag===7){n(u,w.sibling),g=r(w,v.props.children),g.return=u,u=g;break e}}else if(w.elementType===A||typeof A=="object"&&A!==null&&A.$$typeof===Nr&&J0(A)===w.type){n(u,w.sibling),g=r(w,v.props),g.ref=Sa(u,w,v),g.return=u,u=g;break e}n(u,w);break}else e(u,w);w=w.sibling}v.type===io?(g=Cs(v.props.children,u.mode,y,v.key),g.return=u,u=g):(y=Xc(v.type,v.key,v.props,null,u.mode,y),y.ref=Sa(u,g,v),y.return=u,u=y)}return o(u);case no:e:{for(w=v.key;g!==null;){if(g.key===w)if(g.tag===4&&g.stateNode.containerInfo===v.containerInfo&&g.stateNode.implementation===v.implementation){n(u,g.sibling),g=r(g,v.children||[]),g.return=u,u=g;break e}else{n(u,g);break}else e(u,g);g=g.sibling}g=Md(v,u.mode,y),g.return=u,u=g}return o(u);case Nr:return w=v._init,m(u,g,w(v._payload),y)}if(ba(v))return _(u,g,v,y);if(_a(v))return S(u,g,v,y);Lc(u,v)}return typeof v=="string"&&v!==""||typeof v=="number"?(v=""+v,g!==null&&g.tag===6?(n(u,g.sibling),g=r(g,v),g.return=u,u=g):(n(u,g),g=Sd(v,u.mode,y),g.return=u,u=g),o(u)):n(u,g)}return m}var Eo=Sv(!0),Mv=Sv(!1),su=Kr(null),ou=null,ho=null,Dp=null;function Up(){Dp=ho=ou=null}function Fp(t){var e=su.current;Ut(su),t._currentValue=e}function jd(t,e,n){for(;t!==null;){var i=t.alternate;if((t.childLanes&e)!==e?(t.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),t===n)break;t=t.return}}function xo(t,e){ou=t,Dp=ho=null,t=t.dependencies,t!==null&&t.firstContext!==null&&(t.lanes&e&&(Vn=!0),t.firstContext=null)}function di(t){var e=t._currentValue;if(Dp!==t)if(t={context:t,memoizedValue:e,next:null},ho===null){if(ou===null)throw Error(ue(308));ho=t,ou.dependencies={lanes:0,firstContext:t}}else ho=ho.next=t;return e}var Ts=null;function Op(t){Ts===null?Ts=[t]:Ts.push(t)}function wv(t,e,n,i){var r=e.interleaved;return r===null?(n.next=n,Op(e)):(n.next=r.next,r.next=n),e.interleaved=n,gr(t,i)}function gr(t,e){t.lanes|=e;var n=t.alternate;for(n!==null&&(n.lanes|=e),n=t,t=t.return;t!==null;)t.childLanes|=e,n=t.alternate,n!==null&&(n.childLanes|=e),n=t,t=t.return;return n.tag===3?n.stateNode:null}var Dr=!1;function Bp(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function Ev(t,e){t=t.updateQueue,e.updateQueue===t&&(e.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,effects:t.effects})}function dr(t,e){return{eventTime:t,lane:e,tag:0,payload:null,callback:null,next:null}}function Gr(t,e,n){var i=t.updateQueue;if(i===null)return null;if(i=i.shared,wt&2){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,gr(t,n)}return r=i.interleaved,r===null?(e.next=e,Op(i)):(e.next=r.next,r.next=e),i.interleaved=e,gr(t,n)}function kc(t,e,n){if(e=e.updateQueue,e!==null&&(e=e.shared,(n&4194240)!==0)){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,wp(t,n)}}function j0(t,e){var n=t.updateQueue,i=t.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var r=null,s=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};s===null?r=s=o:s=s.next=o,n=n.next}while(n!==null);s===null?r=s=e:s=s.next=e}else r=s=e;n={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},t.updateQueue=n;return}t=n.lastBaseUpdate,t===null?n.firstBaseUpdate=e:t.next=e,n.lastBaseUpdate=e}function au(t,e,n,i){var r=t.updateQueue;Dr=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,c=l.next;l.next=null,o===null?s=c:o.next=c,o=l;var f=t.alternate;f!==null&&(f=f.updateQueue,a=f.lastBaseUpdate,a!==o&&(a===null?f.firstBaseUpdate=c:a.next=c,f.lastBaseUpdate=l))}if(s!==null){var d=r.baseState;o=0,f=c=l=null,a=s;do{var h=a.lane,p=a.eventTime;if((i&h)===h){f!==null&&(f=f.next={eventTime:p,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var _=t,S=a;switch(h=e,p=n,S.tag){case 1:if(_=S.payload,typeof _=="function"){d=_.call(p,d,h);break e}d=_;break e;case 3:_.flags=_.flags&-65537|128;case 0:if(_=S.payload,h=typeof _=="function"?_.call(p,d,h):_,h==null)break e;d=Wt({},d,h);break e;case 2:Dr=!0}}a.callback!==null&&a.lane!==0&&(t.flags|=64,h=r.effects,h===null?r.effects=[a]:h.push(a))}else p={eventTime:p,lane:h,tag:a.tag,payload:a.payload,callback:a.callback,next:null},f===null?(c=f=p,l=d):f=f.next=p,o|=h;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;h=a,a=h.next,h.next=null,r.lastBaseUpdate=h,r.shared.pending=null}}while(!0);if(f===null&&(l=d),r.baseState=l,r.firstBaseUpdate=c,r.lastBaseUpdate=f,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);Ls|=o,t.lanes=o,t.memoizedState=d}}function Q0(t,e,n){if(t=e.effects,e.effects=null,t!==null)for(e=0;e<t.length;e++){var i=t[e],r=i.callback;if(r!==null){if(i.callback=null,i=n,typeof r!="function")throw Error(ue(191,r));r.call(i)}}}var rl={},Wi=Kr(rl),$a=Kr(rl),Ka=Kr(rl);function bs(t){if(t===rl)throw Error(ue(174));return t}function kp(t,e){switch(Lt(Ka,e),Lt($a,t),Lt(Wi,rl),t=e.nodeType,t){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:Ld(null,"");break;default:t=t===8?e.parentNode:e,e=t.namespaceURI||null,t=t.tagName,e=Ld(e,t)}Ut(Wi),Lt(Wi,e)}function To(){Ut(Wi),Ut($a),Ut(Ka)}function Tv(t){bs(Ka.current);var e=bs(Wi.current),n=Ld(e,t.type);e!==n&&(Lt($a,t),Lt(Wi,n))}function zp(t){$a.current===t&&(Ut(Wi),Ut($a))}var Ht=Kr(0);function lu(t){for(var e=t;e!==null;){if(e.tag===13){var n=e.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data==="$?"||n.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if(e.flags&128)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var md=[];function Vp(){for(var t=0;t<md.length;t++)md[t]._workInProgressVersionPrimary=null;md.length=0}var zc=vr.ReactCurrentDispatcher,gd=vr.ReactCurrentBatchConfig,Is=0,Gt=null,nn=null,ln=null,cu=!1,Da=!1,Ja=0,m1=0;function xn(){throw Error(ue(321))}function Hp(t,e){if(e===null)return!1;for(var n=0;n<e.length&&n<t.length;n++)if(!Ci(t[n],e[n]))return!1;return!0}function Gp(t,e,n,i,r,s){if(Is=s,Gt=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,zc.current=t===null||t.memoizedState===null?x1:y1,t=n(i,r),Da){s=0;do{if(Da=!1,Ja=0,25<=s)throw Error(ue(301));s+=1,ln=nn=null,e.updateQueue=null,zc.current=S1,t=n(i,r)}while(Da)}if(zc.current=uu,e=nn!==null&&nn.next!==null,Is=0,ln=nn=Gt=null,cu=!1,e)throw Error(ue(300));return t}function Wp(){var t=Ja!==0;return Ja=0,t}function Vi(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return ln===null?Gt.memoizedState=ln=t:ln=ln.next=t,ln}function pi(){if(nn===null){var t=Gt.alternate;t=t!==null?t.memoizedState:null}else t=nn.next;var e=ln===null?Gt.memoizedState:ln.next;if(e!==null)ln=e,nn=t;else{if(t===null)throw Error(ue(310));nn=t,t={memoizedState:nn.memoizedState,baseState:nn.baseState,baseQueue:nn.baseQueue,queue:nn.queue,next:null},ln===null?Gt.memoizedState=ln=t:ln=ln.next=t}return ln}function ja(t,e){return typeof e=="function"?e(t):e}function _d(t){var e=pi(),n=e.queue;if(n===null)throw Error(ue(311));n.lastRenderedReducer=t;var i=nn,r=i.baseQueue,s=n.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,n.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,c=s;do{var f=c.lane;if((Is&f)===f)l!==null&&(l=l.next={lane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),i=c.hasEagerState?c.eagerState:t(i,c.action);else{var d={lane:f,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null};l===null?(a=l=d,o=i):l=l.next=d,Gt.lanes|=f,Ls|=f}c=c.next}while(c!==null&&c!==s);l===null?o=i:l.next=a,Ci(i,e.memoizedState)||(Vn=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,n.lastRenderedState=i}if(t=n.interleaved,t!==null){r=t;do s=r.lane,Gt.lanes|=s,Ls|=s,r=r.next;while(r!==t)}else r===null&&(n.lanes=0);return[e.memoizedState,n.dispatch]}function vd(t){var e=pi(),n=e.queue;if(n===null)throw Error(ue(311));n.lastRenderedReducer=t;var i=n.dispatch,r=n.pending,s=e.memoizedState;if(r!==null){n.pending=null;var o=r=r.next;do s=t(s,o.action),o=o.next;while(o!==r);Ci(s,e.memoizedState)||(Vn=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),n.lastRenderedState=s}return[s,i]}function bv(){}function Av(t,e){var n=Gt,i=pi(),r=e(),s=!Ci(i.memoizedState,r);if(s&&(i.memoizedState=r,Vn=!0),i=i.queue,Xp(Pv.bind(null,n,i,t),[t]),i.getSnapshot!==e||s||ln!==null&&ln.memoizedState.tag&1){if(n.flags|=2048,Qa(9,Rv.bind(null,n,i,r,e),void 0,null),cn===null)throw Error(ue(349));Is&30||Cv(n,e,r)}return r}function Cv(t,e,n){t.flags|=16384,t={getSnapshot:e,value:n},e=Gt.updateQueue,e===null?(e={lastEffect:null,stores:null},Gt.updateQueue=e,e.stores=[t]):(n=e.stores,n===null?e.stores=[t]:n.push(t))}function Rv(t,e,n,i){e.value=n,e.getSnapshot=i,Iv(e)&&Lv(t)}function Pv(t,e,n){return n(function(){Iv(e)&&Lv(t)})}function Iv(t){var e=t.getSnapshot;t=t.value;try{var n=e();return!Ci(t,n)}catch{return!0}}function Lv(t){var e=gr(t,1);e!==null&&Ai(e,t,1,-1)}function e_(t){var e=Vi();return typeof t=="function"&&(t=t()),e.memoizedState=e.baseState=t,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:ja,lastRenderedState:t},e.queue=t,t=t.dispatch=v1.bind(null,Gt,t),[e.memoizedState,t]}function Qa(t,e,n,i){return t={tag:t,create:e,destroy:n,deps:i,next:null},e=Gt.updateQueue,e===null?(e={lastEffect:null,stores:null},Gt.updateQueue=e,e.lastEffect=t.next=t):(n=e.lastEffect,n===null?e.lastEffect=t.next=t:(i=n.next,n.next=t,t.next=i,e.lastEffect=t)),t}function Nv(){return pi().memoizedState}function Vc(t,e,n,i){var r=Vi();Gt.flags|=t,r.memoizedState=Qa(1|e,n,void 0,i===void 0?null:i)}function Mu(t,e,n,i){var r=pi();i=i===void 0?null:i;var s=void 0;if(nn!==null){var o=nn.memoizedState;if(s=o.destroy,i!==null&&Hp(i,o.deps)){r.memoizedState=Qa(e,n,s,i);return}}Gt.flags|=t,r.memoizedState=Qa(1|e,n,s,i)}function t_(t,e){return Vc(8390656,8,t,e)}function Xp(t,e){return Mu(2048,8,t,e)}function Dv(t,e){return Mu(4,2,t,e)}function Uv(t,e){return Mu(4,4,t,e)}function Fv(t,e){if(typeof e=="function")return t=t(),e(t),function(){e(null)};if(e!=null)return t=t(),e.current=t,function(){e.current=null}}function Ov(t,e,n){return n=n!=null?n.concat([t]):null,Mu(4,4,Fv.bind(null,e,t),n)}function qp(){}function Bv(t,e){var n=pi();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&Hp(e,i[1])?i[0]:(n.memoizedState=[t,e],t)}function kv(t,e){var n=pi();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&Hp(e,i[1])?i[0]:(t=t(),n.memoizedState=[t,e],t)}function zv(t,e,n){return Is&21?(Ci(n,e)||(n=X_(),Gt.lanes|=n,Ls|=n,t.baseState=!0),e):(t.baseState&&(t.baseState=!1,Vn=!0),t.memoizedState=n)}function g1(t,e){var n=Ct;Ct=n!==0&&4>n?n:4,t(!0);var i=gd.transition;gd.transition={};try{t(!1),e()}finally{Ct=n,gd.transition=i}}function Vv(){return pi().memoizedState}function _1(t,e,n){var i=Xr(t);if(n={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null},Hv(t))Gv(e,n);else if(n=wv(t,e,n,i),n!==null){var r=Ln();Ai(n,t,i,r),Wv(n,e,i)}}function v1(t,e,n){var i=Xr(t),r={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null};if(Hv(t))Gv(e,r);else{var s=t.alternate;if(t.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,n);if(r.hasEagerState=!0,r.eagerState=a,Ci(a,o)){var l=e.interleaved;l===null?(r.next=r,Op(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}n=wv(t,e,r,i),n!==null&&(r=Ln(),Ai(n,t,i,r),Wv(n,e,i))}}function Hv(t){var e=t.alternate;return t===Gt||e!==null&&e===Gt}function Gv(t,e){Da=cu=!0;var n=t.pending;n===null?e.next=e:(e.next=n.next,n.next=e),t.pending=e}function Wv(t,e,n){if(n&4194240){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,wp(t,n)}}var uu={readContext:di,useCallback:xn,useContext:xn,useEffect:xn,useImperativeHandle:xn,useInsertionEffect:xn,useLayoutEffect:xn,useMemo:xn,useReducer:xn,useRef:xn,useState:xn,useDebugValue:xn,useDeferredValue:xn,useTransition:xn,useMutableSource:xn,useSyncExternalStore:xn,useId:xn,unstable_isNewReconciler:!1},x1={readContext:di,useCallback:function(t,e){return Vi().memoizedState=[t,e===void 0?null:e],t},useContext:di,useEffect:t_,useImperativeHandle:function(t,e,n){return n=n!=null?n.concat([t]):null,Vc(4194308,4,Fv.bind(null,e,t),n)},useLayoutEffect:function(t,e){return Vc(4194308,4,t,e)},useInsertionEffect:function(t,e){return Vc(4,2,t,e)},useMemo:function(t,e){var n=Vi();return e=e===void 0?null:e,t=t(),n.memoizedState=[t,e],t},useReducer:function(t,e,n){var i=Vi();return e=n!==void 0?n(e):e,i.memoizedState=i.baseState=e,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:e},i.queue=t,t=t.dispatch=_1.bind(null,Gt,t),[i.memoizedState,t]},useRef:function(t){var e=Vi();return t={current:t},e.memoizedState=t},useState:e_,useDebugValue:qp,useDeferredValue:function(t){return Vi().memoizedState=t},useTransition:function(){var t=e_(!1),e=t[0];return t=g1.bind(null,t[1]),Vi().memoizedState=t,[e,t]},useMutableSource:function(){},useSyncExternalStore:function(t,e,n){var i=Gt,r=Vi();if(kt){if(n===void 0)throw Error(ue(407));n=n()}else{if(n=e(),cn===null)throw Error(ue(349));Is&30||Cv(i,e,n)}r.memoizedState=n;var s={value:n,getSnapshot:e};return r.queue=s,t_(Pv.bind(null,i,s,t),[t]),i.flags|=2048,Qa(9,Rv.bind(null,i,s,n,e),void 0,null),n},useId:function(){var t=Vi(),e=cn.identifierPrefix;if(kt){var n=fr,i=hr;n=(i&~(1<<32-bi(i)-1)).toString(32)+n,e=":"+e+"R"+n,n=Ja++,0<n&&(e+="H"+n.toString(32)),e+=":"}else n=m1++,e=":"+e+"r"+n.toString(32)+":";return t.memoizedState=e},unstable_isNewReconciler:!1},y1={readContext:di,useCallback:Bv,useContext:di,useEffect:Xp,useImperativeHandle:Ov,useInsertionEffect:Dv,useLayoutEffect:Uv,useMemo:kv,useReducer:_d,useRef:Nv,useState:function(){return _d(ja)},useDebugValue:qp,useDeferredValue:function(t){var e=pi();return zv(e,nn.memoizedState,t)},useTransition:function(){var t=_d(ja)[0],e=pi().memoizedState;return[t,e]},useMutableSource:bv,useSyncExternalStore:Av,useId:Vv,unstable_isNewReconciler:!1},S1={readContext:di,useCallback:Bv,useContext:di,useEffect:Xp,useImperativeHandle:Ov,useInsertionEffect:Dv,useLayoutEffect:Uv,useMemo:kv,useReducer:vd,useRef:Nv,useState:function(){return vd(ja)},useDebugValue:qp,useDeferredValue:function(t){var e=pi();return nn===null?e.memoizedState=t:zv(e,nn.memoizedState,t)},useTransition:function(){var t=vd(ja)[0],e=pi().memoizedState;return[t,e]},useMutableSource:bv,useSyncExternalStore:Av,useId:Vv,unstable_isNewReconciler:!1};function wi(t,e){if(t&&t.defaultProps){e=Wt({},e),t=t.defaultProps;for(var n in t)e[n]===void 0&&(e[n]=t[n]);return e}return e}function Qd(t,e,n,i){e=t.memoizedState,n=n(i,e),n=n==null?e:Wt({},e,n),t.memoizedState=n,t.lanes===0&&(t.updateQueue.baseState=n)}var wu={isMounted:function(t){return(t=t._reactInternals)?Us(t)===t:!1},enqueueSetState:function(t,e,n){t=t._reactInternals;var i=Ln(),r=Xr(t),s=dr(i,r);s.payload=e,n!=null&&(s.callback=n),e=Gr(t,s,r),e!==null&&(Ai(e,t,r,i),kc(e,t,r))},enqueueReplaceState:function(t,e,n){t=t._reactInternals;var i=Ln(),r=Xr(t),s=dr(i,r);s.tag=1,s.payload=e,n!=null&&(s.callback=n),e=Gr(t,s,r),e!==null&&(Ai(e,t,r,i),kc(e,t,r))},enqueueForceUpdate:function(t,e){t=t._reactInternals;var n=Ln(),i=Xr(t),r=dr(n,i);r.tag=2,e!=null&&(r.callback=e),e=Gr(t,r,i),e!==null&&(Ai(e,t,i,n),kc(e,t,i))}};function n_(t,e,n,i,r,s,o){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!Xa(n,i)||!Xa(r,s):!0}function Xv(t,e,n){var i=!1,r=Zr,s=e.contextType;return typeof s=="object"&&s!==null?s=di(s):(r=Gn(e)?Rs:Mn.current,i=e.contextTypes,s=(i=i!=null)?Mo(t,r):Zr),e=new e(n,s),t.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=wu,t.stateNode=e,e._reactInternals=t,i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=r,t.__reactInternalMemoizedMaskedChildContext=s),e}function i_(t,e,n,i){t=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(n,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(n,i),e.state!==t&&wu.enqueueReplaceState(e,e.state,null)}function ep(t,e,n,i){var r=t.stateNode;r.props=n,r.state=t.memoizedState,r.refs={},Bp(t);var s=e.contextType;typeof s=="object"&&s!==null?r.context=di(s):(s=Gn(e)?Rs:Mn.current,r.context=Mo(t,s)),r.state=t.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(Qd(t,e,s,n),r.state=t.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&wu.enqueueReplaceState(r,r.state,null),au(t,n,r,i),r.state=t.memoizedState),typeof r.componentDidMount=="function"&&(t.flags|=4194308)}function bo(t,e){try{var n="",i=e;do n+=JS(i),i=i.return;while(i);var r=n}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:t,source:e,stack:r,digest:null}}function xd(t,e,n){return{value:t,source:null,stack:n??null,digest:e??null}}function tp(t,e){try{console.error(e.value)}catch(n){setTimeout(function(){throw n})}}var M1=typeof WeakMap=="function"?WeakMap:Map;function qv(t,e,n){n=dr(-1,n),n.tag=3,n.payload={element:null};var i=e.value;return n.callback=function(){fu||(fu=!0,hp=i),tp(t,e)},n}function Yv(t,e,n){n=dr(-1,n),n.tag=3;var i=t.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;n.payload=function(){return i(r)},n.callback=function(){tp(t,e)}}var s=t.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(n.callback=function(){tp(t,e),typeof i!="function"&&(Wr===null?Wr=new Set([this]):Wr.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),n}function r_(t,e,n){var i=t.pingCache;if(i===null){i=t.pingCache=new M1;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(n)||(r.add(n),t=F1.bind(null,t,e,n),e.then(t,t))}function s_(t){do{var e;if((e=t.tag===13)&&(e=t.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return t;t=t.return}while(t!==null);return null}function o_(t,e,n,i,r){return t.mode&1?(t.flags|=65536,t.lanes=r,t):(t===e?t.flags|=65536:(t.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(e=dr(-1,1),e.tag=2,Gr(n,e,1))),n.lanes|=1),t)}var w1=vr.ReactCurrentOwner,Vn=!1;function In(t,e,n,i){e.child=t===null?Mv(e,null,n,i):Eo(e,t.child,n,i)}function a_(t,e,n,i,r){n=n.render;var s=e.ref;return xo(e,r),i=Gp(t,e,n,i,s,r),n=Wp(),t!==null&&!Vn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,_r(t,e,r)):(kt&&n&&Ip(e),e.flags|=1,In(t,e,i,r),e.child)}function l_(t,e,n,i,r){if(t===null){var s=n.type;return typeof s=="function"&&!em(s)&&s.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(e.tag=15,e.type=s,Zv(t,e,s,i,r)):(t=Xc(n.type,null,i,e,e.mode,r),t.ref=e.ref,t.return=e,e.child=t)}if(s=t.child,!(t.lanes&r)){var o=s.memoizedProps;if(n=n.compare,n=n!==null?n:Xa,n(o,i)&&t.ref===e.ref)return _r(t,e,r)}return e.flags|=1,t=qr(s,i),t.ref=e.ref,t.return=e,e.child=t}function Zv(t,e,n,i,r){if(t!==null){var s=t.memoizedProps;if(Xa(s,i)&&t.ref===e.ref)if(Vn=!1,e.pendingProps=i=s,(t.lanes&r)!==0)t.flags&131072&&(Vn=!0);else return e.lanes=t.lanes,_r(t,e,r)}return np(t,e,n,i,r)}function $v(t,e,n){var i=e.pendingProps,r=i.children,s=t!==null?t.memoizedState:null;if(i.mode==="hidden")if(!(e.mode&1))e.memoizedState={baseLanes:0,cachePool:null,transitions:null},Lt(po,Zn),Zn|=n;else{if(!(n&1073741824))return t=s!==null?s.baseLanes|n:n,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:t,cachePool:null,transitions:null},e.updateQueue=null,Lt(po,Zn),Zn|=t,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:n,Lt(po,Zn),Zn|=i}else s!==null?(i=s.baseLanes|n,e.memoizedState=null):i=n,Lt(po,Zn),Zn|=i;return In(t,e,r,n),e.child}function Kv(t,e){var n=e.ref;(t===null&&n!==null||t!==null&&t.ref!==n)&&(e.flags|=512,e.flags|=2097152)}function np(t,e,n,i,r){var s=Gn(n)?Rs:Mn.current;return s=Mo(e,s),xo(e,r),n=Gp(t,e,n,i,s,r),i=Wp(),t!==null&&!Vn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,_r(t,e,r)):(kt&&i&&Ip(e),e.flags|=1,In(t,e,n,r),e.child)}function c_(t,e,n,i,r){if(Gn(n)){var s=!0;nu(e)}else s=!1;if(xo(e,r),e.stateNode===null)Hc(t,e),Xv(e,n,i),ep(e,n,i,r),i=!0;else if(t===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,c=n.contextType;typeof c=="object"&&c!==null?c=di(c):(c=Gn(n)?Rs:Mn.current,c=Mo(e,c));var f=n.getDerivedStateFromProps,d=typeof f=="function"||typeof o.getSnapshotBeforeUpdate=="function";d||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==c)&&i_(e,o,i,c),Dr=!1;var h=e.memoizedState;o.state=h,au(e,i,o,r),l=e.memoizedState,a!==i||h!==l||Hn.current||Dr?(typeof f=="function"&&(Qd(e,n,f,i),l=e.memoizedState),(a=Dr||n_(e,n,a,i,h,l,c))?(d||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=c,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,Ev(t,e),a=e.memoizedProps,c=e.type===e.elementType?a:wi(e.type,a),o.props=c,d=e.pendingProps,h=o.context,l=n.contextType,typeof l=="object"&&l!==null?l=di(l):(l=Gn(n)?Rs:Mn.current,l=Mo(e,l));var p=n.getDerivedStateFromProps;(f=typeof p=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==d||h!==l)&&i_(e,o,i,l),Dr=!1,h=e.memoizedState,o.state=h,au(e,i,o,r);var _=e.memoizedState;a!==d||h!==_||Hn.current||Dr?(typeof p=="function"&&(Qd(e,n,p,i),_=e.memoizedState),(c=Dr||n_(e,n,c,i,h,_,l)||!1)?(f||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,_,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,_,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=_),o.props=i,o.state=_,o.context=l,i=c):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&h===t.memoizedState||(e.flags|=1024),i=!1)}return ip(t,e,n,i,s,r)}function ip(t,e,n,i,r,s){Kv(t,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&Z0(e,n,!1),_r(t,e,s);i=e.stateNode,w1.current=e;var a=o&&typeof n.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,t!==null&&o?(e.child=Eo(e,t.child,null,s),e.child=Eo(e,null,a,s)):In(t,e,a,s),e.memoizedState=i.state,r&&Z0(e,n,!0),e.child}function Jv(t){var e=t.stateNode;e.pendingContext?Y0(t,e.pendingContext,e.pendingContext!==e.context):e.context&&Y0(t,e.context,!1),kp(t,e.containerInfo)}function u_(t,e,n,i,r){return wo(),Np(r),e.flags|=256,In(t,e,n,i),e.child}var rp={dehydrated:null,treeContext:null,retryLane:0};function sp(t){return{baseLanes:t,cachePool:null,transitions:null}}function jv(t,e,n){var i=e.pendingProps,r=Ht.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=t!==null&&t.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(t===null||t.memoizedState!==null)&&(r|=1),Lt(Ht,r&1),t===null)return Jd(e),t=e.memoizedState,t!==null&&(t=t.dehydrated,t!==null)?(e.mode&1?t.data==="$!"?e.lanes=8:e.lanes=1073741824:e.lanes=1,null):(o=i.children,t=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},!(i&1)&&s!==null?(s.childLanes=0,s.pendingProps=o):s=bu(o,i,0,null),t=Cs(t,i,n,null),s.return=e,t.return=e,s.sibling=t,e.child=s,e.child.memoizedState=sp(n),e.memoizedState=rp,t):Yp(e,o));if(r=t.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return E1(t,e,o,i,a,r,n);if(s){s=i.fallback,o=e.mode,r=t.child,a=r.sibling;var l={mode:"hidden",children:i.children};return!(o&1)&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=qr(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=qr(a,s):(s=Cs(s,o,n,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=t.child.memoizedState,o=o===null?sp(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=t.childLanes&~n,e.memoizedState=rp,i}return s=t.child,t=s.sibling,i=qr(s,{mode:"visible",children:i.children}),!(e.mode&1)&&(i.lanes=n),i.return=e,i.sibling=null,t!==null&&(n=e.deletions,n===null?(e.deletions=[t],e.flags|=16):n.push(t)),e.child=i,e.memoizedState=null,i}function Yp(t,e){return e=bu({mode:"visible",children:e},t.mode,0,null),e.return=t,t.child=e}function Nc(t,e,n,i){return i!==null&&Np(i),Eo(e,t.child,null,n),t=Yp(e,e.pendingProps.children),t.flags|=2,e.memoizedState=null,t}function E1(t,e,n,i,r,s,o){if(n)return e.flags&256?(e.flags&=-257,i=xd(Error(ue(422))),Nc(t,e,o,i)):e.memoizedState!==null?(e.child=t.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=bu({mode:"visible",children:i.children},r,0,null),s=Cs(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,e.mode&1&&Eo(e,t.child,null,o),e.child.memoizedState=sp(o),e.memoizedState=rp,s);if(!(e.mode&1))return Nc(t,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(ue(419)),i=xd(s,i,void 0),Nc(t,e,o,i)}if(a=(o&t.childLanes)!==0,Vn||a){if(i=cn,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=r&(i.suspendedLanes|o)?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,gr(t,r),Ai(i,t,r,-1))}return Qp(),i=xd(Error(ue(421))),Nc(t,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=t.child,e=O1.bind(null,t),r._reactRetry=e,null):(t=s.treeContext,$n=Hr(r.nextSibling),Kn=e,kt=!0,Ti=null,t!==null&&(ci[ui++]=hr,ci[ui++]=fr,ci[ui++]=Ps,hr=t.id,fr=t.overflow,Ps=e),e=Yp(e,i.children),e.flags|=4096,e)}function h_(t,e,n){t.lanes|=e;var i=t.alternate;i!==null&&(i.lanes|=e),jd(t.return,e,n)}function yd(t,e,n,i,r){var s=t.memoizedState;s===null?t.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=n,s.tailMode=r)}function Qv(t,e,n){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(In(t,e,i.children,n),i=Ht.current,i&2)i=i&1|2,e.flags|=128;else{if(t!==null&&t.flags&128)e:for(t=e.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&h_(t,n,e);else if(t.tag===19)h_(t,n,e);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break e;for(;t.sibling===null;){if(t.return===null||t.return===e)break e;t=t.return}t.sibling.return=t.return,t=t.sibling}i&=1}if(Lt(Ht,i),!(e.mode&1))e.memoizedState=null;else switch(r){case"forwards":for(n=e.child,r=null;n!==null;)t=n.alternate,t!==null&&lu(t)===null&&(r=n),n=n.sibling;n=r,n===null?(r=e.child,e.child=null):(r=n.sibling,n.sibling=null),yd(e,!1,r,n,s);break;case"backwards":for(n=null,r=e.child,e.child=null;r!==null;){if(t=r.alternate,t!==null&&lu(t)===null){e.child=r;break}t=r.sibling,r.sibling=n,n=r,r=t}yd(e,!0,n,null,s);break;case"together":yd(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function Hc(t,e){!(e.mode&1)&&t!==null&&(t.alternate=null,e.alternate=null,e.flags|=2)}function _r(t,e,n){if(t!==null&&(e.dependencies=t.dependencies),Ls|=e.lanes,!(n&e.childLanes))return null;if(t!==null&&e.child!==t.child)throw Error(ue(153));if(e.child!==null){for(t=e.child,n=qr(t,t.pendingProps),e.child=n,n.return=e;t.sibling!==null;)t=t.sibling,n=n.sibling=qr(t,t.pendingProps),n.return=e;n.sibling=null}return e.child}function T1(t,e,n){switch(e.tag){case 3:Jv(e),wo();break;case 5:Tv(e);break;case 1:Gn(e.type)&&nu(e);break;case 4:kp(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;Lt(su,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(Lt(Ht,Ht.current&1),e.flags|=128,null):n&e.child.childLanes?jv(t,e,n):(Lt(Ht,Ht.current&1),t=_r(t,e,n),t!==null?t.sibling:null);Lt(Ht,Ht.current&1);break;case 19:if(i=(n&e.childLanes)!==0,t.flags&128){if(i)return Qv(t,e,n);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),Lt(Ht,Ht.current),i)break;return null;case 22:case 23:return e.lanes=0,$v(t,e,n)}return _r(t,e,n)}var ex,op,tx,nx;ex=function(t,e){for(var n=e.child;n!==null;){if(n.tag===5||n.tag===6)t.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return;n=n.return}n.sibling.return=n.return,n=n.sibling}};op=function(){};tx=function(t,e,n,i){var r=t.memoizedProps;if(r!==i){t=e.stateNode,bs(Wi.current);var s=null;switch(n){case"input":r=Cd(t,r),i=Cd(t,i),s=[];break;case"select":r=Wt({},r,{value:void 0}),i=Wt({},i,{value:void 0}),s=[];break;case"textarea":r=Id(t,r),i=Id(t,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(t.onclick=eu)}Nd(n,i);var o;n=null;for(c in r)if(!i.hasOwnProperty(c)&&r.hasOwnProperty(c)&&r[c]!=null)if(c==="style"){var a=r[c];for(o in a)a.hasOwnProperty(o)&&(n||(n={}),n[o]="")}else c!=="dangerouslySetInnerHTML"&&c!=="children"&&c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&c!=="autoFocus"&&(Ba.hasOwnProperty(c)?s||(s=[]):(s=s||[]).push(c,null));for(c in i){var l=i[c];if(a=r!=null?r[c]:void 0,i.hasOwnProperty(c)&&l!==a&&(l!=null||a!=null))if(c==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(n||(n={}),n[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(n||(n={}),n[o]=l[o])}else n||(s||(s=[]),s.push(c,n)),n=l;else c==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(c,l)):c==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(c,""+l):c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&(Ba.hasOwnProperty(c)?(l!=null&&c==="onScroll"&&Dt("scroll",t),s||a===l||(s=[])):(s=s||[]).push(c,l))}n&&(s=s||[]).push("style",n);var c=s;(e.updateQueue=c)&&(e.flags|=4)}};nx=function(t,e,n,i){n!==i&&(e.flags|=4)};function Ma(t,e){if(!kt)switch(t.tailMode){case"hidden":e=t.tail;for(var n=null;e!==null;)e.alternate!==null&&(n=e),e=e.sibling;n===null?t.tail=null:n.sibling=null;break;case"collapsed":n=t.tail;for(var i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?e||t.tail===null?t.tail=null:t.tail.sibling=null:i.sibling=null}}function yn(t){var e=t.alternate!==null&&t.alternate.child===t.child,n=0,i=0;if(e)for(var r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=t,r=r.sibling;else for(r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=t,r=r.sibling;return t.subtreeFlags|=i,t.childLanes=n,e}function b1(t,e,n){var i=e.pendingProps;switch(Lp(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return yn(e),null;case 1:return Gn(e.type)&&tu(),yn(e),null;case 3:return i=e.stateNode,To(),Ut(Hn),Ut(Mn),Vp(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(t===null||t.child===null)&&(Ic(e)?e.flags|=4:t===null||t.memoizedState.isDehydrated&&!(e.flags&256)||(e.flags|=1024,Ti!==null&&(pp(Ti),Ti=null))),op(t,e),yn(e),null;case 5:zp(e);var r=bs(Ka.current);if(n=e.type,t!==null&&e.stateNode!=null)tx(t,e,n,i,r),t.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(ue(166));return yn(e),null}if(t=bs(Wi.current),Ic(e)){i=e.stateNode,n=e.type;var s=e.memoizedProps;switch(i[Hi]=e,i[Za]=s,t=(e.mode&1)!==0,n){case"dialog":Dt("cancel",i),Dt("close",i);break;case"iframe":case"object":case"embed":Dt("load",i);break;case"video":case"audio":for(r=0;r<Ca.length;r++)Dt(Ca[r],i);break;case"source":Dt("error",i);break;case"img":case"image":case"link":Dt("error",i),Dt("load",i);break;case"details":Dt("toggle",i);break;case"input":x0(i,s),Dt("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},Dt("invalid",i);break;case"textarea":S0(i,s),Dt("invalid",i)}Nd(n,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&Pc(i.textContent,a,t),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&Pc(i.textContent,a,t),r=["children",""+a]):Ba.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&Dt("scroll",i)}switch(n){case"input":vc(i),y0(i,s,!0);break;case"textarea":vc(i),M0(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=eu)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,t==="http://www.w3.org/1999/xhtml"&&(t=P_(n)),t==="http://www.w3.org/1999/xhtml"?n==="script"?(t=o.createElement("div"),t.innerHTML="<script><\/script>",t=t.removeChild(t.firstChild)):typeof i.is=="string"?t=o.createElement(n,{is:i.is}):(t=o.createElement(n),n==="select"&&(o=t,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):t=o.createElementNS(t,n),t[Hi]=e,t[Za]=i,ex(t,e,!1,!1),e.stateNode=t;e:{switch(o=Dd(n,i),n){case"dialog":Dt("cancel",t),Dt("close",t),r=i;break;case"iframe":case"object":case"embed":Dt("load",t),r=i;break;case"video":case"audio":for(r=0;r<Ca.length;r++)Dt(Ca[r],t);r=i;break;case"source":Dt("error",t),r=i;break;case"img":case"image":case"link":Dt("error",t),Dt("load",t),r=i;break;case"details":Dt("toggle",t),r=i;break;case"input":x0(t,i),r=Cd(t,i),Dt("invalid",t);break;case"option":r=i;break;case"select":t._wrapperState={wasMultiple:!!i.multiple},r=Wt({},i,{value:void 0}),Dt("invalid",t);break;case"textarea":S0(t,i),r=Id(t,i),Dt("invalid",t);break;default:r=i}Nd(n,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?N_(t,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&I_(t,l)):s==="children"?typeof l=="string"?(n!=="textarea"||l!=="")&&ka(t,l):typeof l=="number"&&ka(t,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(Ba.hasOwnProperty(s)?l!=null&&s==="onScroll"&&Dt("scroll",t):l!=null&&_p(t,s,l,o))}switch(n){case"input":vc(t),y0(t,i,!1);break;case"textarea":vc(t),M0(t);break;case"option":i.value!=null&&t.setAttribute("value",""+Yr(i.value));break;case"select":t.multiple=!!i.multiple,s=i.value,s!=null?mo(t,!!i.multiple,s,!1):i.defaultValue!=null&&mo(t,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(t.onclick=eu)}switch(n){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return yn(e),null;case 6:if(t&&e.stateNode!=null)nx(t,e,t.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(ue(166));if(n=bs(Ka.current),bs(Wi.current),Ic(e)){if(i=e.stateNode,n=e.memoizedProps,i[Hi]=e,(s=i.nodeValue!==n)&&(t=Kn,t!==null))switch(t.tag){case 3:Pc(i.nodeValue,n,(t.mode&1)!==0);break;case 5:t.memoizedProps.suppressHydrationWarning!==!0&&Pc(i.nodeValue,n,(t.mode&1)!==0)}s&&(e.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[Hi]=e,e.stateNode=i}return yn(e),null;case 13:if(Ut(Ht),i=e.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(kt&&$n!==null&&e.mode&1&&!(e.flags&128))yv(),wo(),e.flags|=98560,s=!1;else if(s=Ic(e),i!==null&&i.dehydrated!==null){if(t===null){if(!s)throw Error(ue(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(ue(317));s[Hi]=e}else wo(),!(e.flags&128)&&(e.memoizedState=null),e.flags|=4;yn(e),s=!1}else Ti!==null&&(pp(Ti),Ti=null),s=!0;if(!s)return e.flags&65536?e:null}return e.flags&128?(e.lanes=n,e):(i=i!==null,i!==(t!==null&&t.memoizedState!==null)&&i&&(e.child.flags|=8192,e.mode&1&&(t===null||Ht.current&1?rn===0&&(rn=3):Qp())),e.updateQueue!==null&&(e.flags|=4),yn(e),null);case 4:return To(),op(t,e),t===null&&qa(e.stateNode.containerInfo),yn(e),null;case 10:return Fp(e.type._context),yn(e),null;case 17:return Gn(e.type)&&tu(),yn(e),null;case 19:if(Ut(Ht),s=e.memoizedState,s===null)return yn(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)Ma(s,!1);else{if(rn!==0||t!==null&&t.flags&128)for(t=e.child;t!==null;){if(o=lu(t),o!==null){for(e.flags|=128,Ma(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=n,n=e.child;n!==null;)s=n,t=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=t,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,t=o.dependencies,s.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext}),n=n.sibling;return Lt(Ht,Ht.current&1|2),e.child}t=t.sibling}s.tail!==null&&$t()>Ao&&(e.flags|=128,i=!0,Ma(s,!1),e.lanes=4194304)}else{if(!i)if(t=lu(o),t!==null){if(e.flags|=128,i=!0,n=t.updateQueue,n!==null&&(e.updateQueue=n,e.flags|=4),Ma(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!kt)return yn(e),null}else 2*$t()-s.renderingStartTime>Ao&&n!==1073741824&&(e.flags|=128,i=!0,Ma(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(n=s.last,n!==null?n.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=$t(),e.sibling=null,n=Ht.current,Lt(Ht,i?n&1|2:n&1),e):(yn(e),null);case 22:case 23:return jp(),i=e.memoizedState!==null,t!==null&&t.memoizedState!==null!==i&&(e.flags|=8192),i&&e.mode&1?Zn&1073741824&&(yn(e),e.subtreeFlags&6&&(e.flags|=8192)):yn(e),null;case 24:return null;case 25:return null}throw Error(ue(156,e.tag))}function A1(t,e){switch(Lp(e),e.tag){case 1:return Gn(e.type)&&tu(),t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 3:return To(),Ut(Hn),Ut(Mn),Vp(),t=e.flags,t&65536&&!(t&128)?(e.flags=t&-65537|128,e):null;case 5:return zp(e),null;case 13:if(Ut(Ht),t=e.memoizedState,t!==null&&t.dehydrated!==null){if(e.alternate===null)throw Error(ue(340));wo()}return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 19:return Ut(Ht),null;case 4:return To(),null;case 10:return Fp(e.type._context),null;case 22:case 23:return jp(),null;case 24:return null;default:return null}}var Dc=!1,Sn=!1,C1=typeof WeakSet=="function"?WeakSet:Set,Ue=null;function fo(t,e){var n=t.ref;if(n!==null)if(typeof n=="function")try{n(null)}catch(i){Yt(t,e,i)}else n.current=null}function ap(t,e,n){try{n()}catch(i){Yt(t,e,i)}}var f_=!1;function R1(t,e){if(Wd=Jc,t=av(),Pp(t)){if("selectionStart"in t)var n={start:t.selectionStart,end:t.selectionEnd};else e:{n=(n=t.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{n.nodeType,s.nodeType}catch{n=null;break e}var o=0,a=-1,l=-1,c=0,f=0,d=t,h=null;t:for(;;){for(var p;d!==n||r!==0&&d.nodeType!==3||(a=o+r),d!==s||i!==0&&d.nodeType!==3||(l=o+i),d.nodeType===3&&(o+=d.nodeValue.length),(p=d.firstChild)!==null;)h=d,d=p;for(;;){if(d===t)break t;if(h===n&&++c===r&&(a=o),h===s&&++f===i&&(l=o),(p=d.nextSibling)!==null)break;d=h,h=d.parentNode}d=p}n=a===-1||l===-1?null:{start:a,end:l}}else n=null}n=n||{start:0,end:0}}else n=null;for(Xd={focusedElem:t,selectionRange:n},Jc=!1,Ue=e;Ue!==null;)if(e=Ue,t=e.child,(e.subtreeFlags&1028)!==0&&t!==null)t.return=e,Ue=t;else for(;Ue!==null;){e=Ue;try{var _=e.alternate;if(e.flags&1024)switch(e.tag){case 0:case 11:case 15:break;case 1:if(_!==null){var S=_.memoizedProps,m=_.memoizedState,u=e.stateNode,g=u.getSnapshotBeforeUpdate(e.elementType===e.type?S:wi(e.type,S),m);u.__reactInternalSnapshotBeforeUpdate=g}break;case 3:var v=e.stateNode.containerInfo;v.nodeType===1?v.textContent="":v.nodeType===9&&v.documentElement&&v.removeChild(v.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(ue(163))}}catch(y){Yt(e,e.return,y)}if(t=e.sibling,t!==null){t.return=e.return,Ue=t;break}Ue=e.return}return _=f_,f_=!1,_}function Ua(t,e,n){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&t)===t){var s=r.destroy;r.destroy=void 0,s!==void 0&&ap(e,n,s)}r=r.next}while(r!==i)}}function Eu(t,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var n=e=e.next;do{if((n.tag&t)===t){var i=n.create;n.destroy=i()}n=n.next}while(n!==e)}}function lp(t){var e=t.ref;if(e!==null){var n=t.stateNode;switch(t.tag){case 5:t=n;break;default:t=n}typeof e=="function"?e(t):e.current=t}}function ix(t){var e=t.alternate;e!==null&&(t.alternate=null,ix(e)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(e=t.stateNode,e!==null&&(delete e[Hi],delete e[Za],delete e[Zd],delete e[h1],delete e[f1])),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}function rx(t){return t.tag===5||t.tag===3||t.tag===4}function d_(t){e:for(;;){for(;t.sibling===null;){if(t.return===null||rx(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.flags&2||t.child===null||t.tag===4)continue e;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function cp(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.nodeType===8?n.parentNode.insertBefore(t,e):n.insertBefore(t,e):(n.nodeType===8?(e=n.parentNode,e.insertBefore(t,n)):(e=n,e.appendChild(t)),n=n._reactRootContainer,n!=null||e.onclick!==null||(e.onclick=eu));else if(i!==4&&(t=t.child,t!==null))for(cp(t,e,n),t=t.sibling;t!==null;)cp(t,e,n),t=t.sibling}function up(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.insertBefore(t,e):n.appendChild(t);else if(i!==4&&(t=t.child,t!==null))for(up(t,e,n),t=t.sibling;t!==null;)up(t,e,n),t=t.sibling}var dn=null,Ei=!1;function Lr(t,e,n){for(n=n.child;n!==null;)sx(t,e,n),n=n.sibling}function sx(t,e,n){if(Gi&&typeof Gi.onCommitFiberUnmount=="function")try{Gi.onCommitFiberUnmount(gu,n)}catch{}switch(n.tag){case 5:Sn||fo(n,e);case 6:var i=dn,r=Ei;dn=null,Lr(t,e,n),dn=i,Ei=r,dn!==null&&(Ei?(t=dn,n=n.stateNode,t.nodeType===8?t.parentNode.removeChild(n):t.removeChild(n)):dn.removeChild(n.stateNode));break;case 18:dn!==null&&(Ei?(t=dn,n=n.stateNode,t.nodeType===8?dd(t.parentNode,n):t.nodeType===1&&dd(t,n),Ga(t)):dd(dn,n.stateNode));break;case 4:i=dn,r=Ei,dn=n.stateNode.containerInfo,Ei=!0,Lr(t,e,n),dn=i,Ei=r;break;case 0:case 11:case 14:case 15:if(!Sn&&(i=n.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&(s&2||s&4)&&ap(n,e,o),r=r.next}while(r!==i)}Lr(t,e,n);break;case 1:if(!Sn&&(fo(n,e),i=n.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=n.memoizedProps,i.state=n.memoizedState,i.componentWillUnmount()}catch(a){Yt(n,e,a)}Lr(t,e,n);break;case 21:Lr(t,e,n);break;case 22:n.mode&1?(Sn=(i=Sn)||n.memoizedState!==null,Lr(t,e,n),Sn=i):Lr(t,e,n);break;default:Lr(t,e,n)}}function p_(t){var e=t.updateQueue;if(e!==null){t.updateQueue=null;var n=t.stateNode;n===null&&(n=t.stateNode=new C1),e.forEach(function(i){var r=B1.bind(null,t,i);n.has(i)||(n.add(i),i.then(r,r))})}}function Mi(t,e){var n=e.deletions;if(n!==null)for(var i=0;i<n.length;i++){var r=n[i];try{var s=t,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:dn=a.stateNode,Ei=!1;break e;case 3:dn=a.stateNode.containerInfo,Ei=!0;break e;case 4:dn=a.stateNode.containerInfo,Ei=!0;break e}a=a.return}if(dn===null)throw Error(ue(160));sx(s,o,r),dn=null,Ei=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(c){Yt(r,e,c)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)ox(e,t),e=e.sibling}function ox(t,e){var n=t.alternate,i=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:if(Mi(e,t),zi(t),i&4){try{Ua(3,t,t.return),Eu(3,t)}catch(S){Yt(t,t.return,S)}try{Ua(5,t,t.return)}catch(S){Yt(t,t.return,S)}}break;case 1:Mi(e,t),zi(t),i&512&&n!==null&&fo(n,n.return);break;case 5:if(Mi(e,t),zi(t),i&512&&n!==null&&fo(n,n.return),t.flags&32){var r=t.stateNode;try{ka(r,"")}catch(S){Yt(t,t.return,S)}}if(i&4&&(r=t.stateNode,r!=null)){var s=t.memoizedProps,o=n!==null?n.memoizedProps:s,a=t.type,l=t.updateQueue;if(t.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&C_(r,s),Dd(a,o);var c=Dd(a,s);for(o=0;o<l.length;o+=2){var f=l[o],d=l[o+1];f==="style"?N_(r,d):f==="dangerouslySetInnerHTML"?I_(r,d):f==="children"?ka(r,d):_p(r,f,d,c)}switch(a){case"input":Rd(r,s);break;case"textarea":R_(r,s);break;case"select":var h=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var p=s.value;p!=null?mo(r,!!s.multiple,p,!1):h!==!!s.multiple&&(s.defaultValue!=null?mo(r,!!s.multiple,s.defaultValue,!0):mo(r,!!s.multiple,s.multiple?[]:"",!1))}r[Za]=s}catch(S){Yt(t,t.return,S)}}break;case 6:if(Mi(e,t),zi(t),i&4){if(t.stateNode===null)throw Error(ue(162));r=t.stateNode,s=t.memoizedProps;try{r.nodeValue=s}catch(S){Yt(t,t.return,S)}}break;case 3:if(Mi(e,t),zi(t),i&4&&n!==null&&n.memoizedState.isDehydrated)try{Ga(e.containerInfo)}catch(S){Yt(t,t.return,S)}break;case 4:Mi(e,t),zi(t);break;case 13:Mi(e,t),zi(t),r=t.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(Kp=$t())),i&4&&p_(t);break;case 22:if(f=n!==null&&n.memoizedState!==null,t.mode&1?(Sn=(c=Sn)||f,Mi(e,t),Sn=c):Mi(e,t),zi(t),i&8192){if(c=t.memoizedState!==null,(t.stateNode.isHidden=c)&&!f&&t.mode&1)for(Ue=t,f=t.child;f!==null;){for(d=Ue=f;Ue!==null;){switch(h=Ue,p=h.child,h.tag){case 0:case 11:case 14:case 15:Ua(4,h,h.return);break;case 1:fo(h,h.return);var _=h.stateNode;if(typeof _.componentWillUnmount=="function"){i=h,n=h.return;try{e=i,_.props=e.memoizedProps,_.state=e.memoizedState,_.componentWillUnmount()}catch(S){Yt(i,n,S)}}break;case 5:fo(h,h.return);break;case 22:if(h.memoizedState!==null){g_(d);continue}}p!==null?(p.return=h,Ue=p):g_(d)}f=f.sibling}e:for(f=null,d=t;;){if(d.tag===5){if(f===null){f=d;try{r=d.stateNode,c?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=d.stateNode,l=d.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=L_("display",o))}catch(S){Yt(t,t.return,S)}}}else if(d.tag===6){if(f===null)try{d.stateNode.nodeValue=c?"":d.memoizedProps}catch(S){Yt(t,t.return,S)}}else if((d.tag!==22&&d.tag!==23||d.memoizedState===null||d===t)&&d.child!==null){d.child.return=d,d=d.child;continue}if(d===t)break e;for(;d.sibling===null;){if(d.return===null||d.return===t)break e;f===d&&(f=null),d=d.return}f===d&&(f=null),d.sibling.return=d.return,d=d.sibling}}break;case 19:Mi(e,t),zi(t),i&4&&p_(t);break;case 21:break;default:Mi(e,t),zi(t)}}function zi(t){var e=t.flags;if(e&2){try{e:{for(var n=t.return;n!==null;){if(rx(n)){var i=n;break e}n=n.return}throw Error(ue(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(ka(r,""),i.flags&=-33);var s=d_(t);up(t,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=d_(t);cp(t,a,o);break;default:throw Error(ue(161))}}catch(l){Yt(t,t.return,l)}t.flags&=-3}e&4096&&(t.flags&=-4097)}function P1(t,e,n){Ue=t,ax(t,e,n)}function ax(t,e,n){for(var i=(t.mode&1)!==0;Ue!==null;){var r=Ue,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||Dc;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||Sn;a=Dc;var c=Sn;if(Dc=o,(Sn=l)&&!c)for(Ue=r;Ue!==null;)o=Ue,l=o.child,o.tag===22&&o.memoizedState!==null?__(r):l!==null?(l.return=o,Ue=l):__(r);for(;s!==null;)Ue=s,ax(s,e,n),s=s.sibling;Ue=r,Dc=a,Sn=c}m_(t,e,n)}else r.subtreeFlags&8772&&s!==null?(s.return=r,Ue=s):m_(t,e,n)}}function m_(t){for(;Ue!==null;){var e=Ue;if(e.flags&8772){var n=e.alternate;try{if(e.flags&8772)switch(e.tag){case 0:case 11:case 15:Sn||Eu(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!Sn)if(n===null)i.componentDidMount();else{var r=e.elementType===e.type?n.memoizedProps:wi(e.type,n.memoizedProps);i.componentDidUpdate(r,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&Q0(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(n=null,e.child!==null)switch(e.child.tag){case 5:n=e.child.stateNode;break;case 1:n=e.child.stateNode}Q0(e,o,n)}break;case 5:var a=e.stateNode;if(n===null&&e.flags&4){n=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&n.focus();break;case"img":l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var c=e.alternate;if(c!==null){var f=c.memoizedState;if(f!==null){var d=f.dehydrated;d!==null&&Ga(d)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(ue(163))}Sn||e.flags&512&&lp(e)}catch(h){Yt(e,e.return,h)}}if(e===t){Ue=null;break}if(n=e.sibling,n!==null){n.return=e.return,Ue=n;break}Ue=e.return}}function g_(t){for(;Ue!==null;){var e=Ue;if(e===t){Ue=null;break}var n=e.sibling;if(n!==null){n.return=e.return,Ue=n;break}Ue=e.return}}function __(t){for(;Ue!==null;){var e=Ue;try{switch(e.tag){case 0:case 11:case 15:var n=e.return;try{Eu(4,e)}catch(l){Yt(e,n,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){Yt(e,r,l)}}var s=e.return;try{lp(e)}catch(l){Yt(e,s,l)}break;case 5:var o=e.return;try{lp(e)}catch(l){Yt(e,o,l)}}}catch(l){Yt(e,e.return,l)}if(e===t){Ue=null;break}var a=e.sibling;if(a!==null){a.return=e.return,Ue=a;break}Ue=e.return}}var I1=Math.ceil,hu=vr.ReactCurrentDispatcher,Zp=vr.ReactCurrentOwner,fi=vr.ReactCurrentBatchConfig,wt=0,cn=null,Kt=null,pn=0,Zn=0,po=Kr(0),rn=0,el=null,Ls=0,Tu=0,$p=0,Fa=null,zn=null,Kp=0,Ao=1/0,cr=null,fu=!1,hp=null,Wr=null,Uc=!1,Br=null,du=0,Oa=0,fp=null,Gc=-1,Wc=0;function Ln(){return wt&6?$t():Gc!==-1?Gc:Gc=$t()}function Xr(t){return t.mode&1?wt&2&&pn!==0?pn&-pn:p1.transition!==null?(Wc===0&&(Wc=X_()),Wc):(t=Ct,t!==0||(t=window.event,t=t===void 0?16:j_(t.type)),t):1}function Ai(t,e,n,i){if(50<Oa)throw Oa=0,fp=null,Error(ue(185));tl(t,n,i),(!(wt&2)||t!==cn)&&(t===cn&&(!(wt&2)&&(Tu|=n),rn===4&&Fr(t,pn)),Wn(t,i),n===1&&wt===0&&!(e.mode&1)&&(Ao=$t()+500,Su&&Jr()))}function Wn(t,e){var n=t.callbackNode;gM(t,e);var i=Kc(t,t===cn?pn:0);if(i===0)n!==null&&T0(n),t.callbackNode=null,t.callbackPriority=0;else if(e=i&-i,t.callbackPriority!==e){if(n!=null&&T0(n),e===1)t.tag===0?d1(v_.bind(null,t)):_v(v_.bind(null,t)),c1(function(){!(wt&6)&&Jr()}),n=null;else{switch(q_(i)){case 1:n=Mp;break;case 4:n=G_;break;case 16:n=$c;break;case 536870912:n=W_;break;default:n=$c}n=mx(n,lx.bind(null,t))}t.callbackPriority=e,t.callbackNode=n}}function lx(t,e){if(Gc=-1,Wc=0,wt&6)throw Error(ue(327));var n=t.callbackNode;if(yo()&&t.callbackNode!==n)return null;var i=Kc(t,t===cn?pn:0);if(i===0)return null;if(i&30||i&t.expiredLanes||e)e=pu(t,i);else{e=i;var r=wt;wt|=2;var s=ux();(cn!==t||pn!==e)&&(cr=null,Ao=$t()+500,As(t,e));do try{D1();break}catch(a){cx(t,a)}while(!0);Up(),hu.current=s,wt=r,Kt!==null?e=0:(cn=null,pn=0,e=rn)}if(e!==0){if(e===2&&(r=kd(t),r!==0&&(i=r,e=dp(t,r))),e===1)throw n=el,As(t,0),Fr(t,i),Wn(t,$t()),n;if(e===6)Fr(t,i);else{if(r=t.current.alternate,!(i&30)&&!L1(r)&&(e=pu(t,i),e===2&&(s=kd(t),s!==0&&(i=s,e=dp(t,s))),e===1))throw n=el,As(t,0),Fr(t,i),Wn(t,$t()),n;switch(t.finishedWork=r,t.finishedLanes=i,e){case 0:case 1:throw Error(ue(345));case 2:ws(t,zn,cr);break;case 3:if(Fr(t,i),(i&130023424)===i&&(e=Kp+500-$t(),10<e)){if(Kc(t,0)!==0)break;if(r=t.suspendedLanes,(r&i)!==i){Ln(),t.pingedLanes|=t.suspendedLanes&r;break}t.timeoutHandle=Yd(ws.bind(null,t,zn,cr),e);break}ws(t,zn,cr);break;case 4:if(Fr(t,i),(i&4194240)===i)break;for(e=t.eventTimes,r=-1;0<i;){var o=31-bi(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=$t()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*I1(i/1960))-i,10<i){t.timeoutHandle=Yd(ws.bind(null,t,zn,cr),i);break}ws(t,zn,cr);break;case 5:ws(t,zn,cr);break;default:throw Error(ue(329))}}}return Wn(t,$t()),t.callbackNode===n?lx.bind(null,t):null}function dp(t,e){var n=Fa;return t.current.memoizedState.isDehydrated&&(As(t,e).flags|=256),t=pu(t,e),t!==2&&(e=zn,zn=n,e!==null&&pp(e)),t}function pp(t){zn===null?zn=t:zn.push.apply(zn,t)}function L1(t){for(var e=t;;){if(e.flags&16384){var n=e.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var i=0;i<n.length;i++){var r=n[i],s=r.getSnapshot;r=r.value;try{if(!Ci(s(),r))return!1}catch{return!1}}}if(n=e.child,e.subtreeFlags&16384&&n!==null)n.return=e,e=n;else{if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function Fr(t,e){for(e&=~$p,e&=~Tu,t.suspendedLanes|=e,t.pingedLanes&=~e,t=t.expirationTimes;0<e;){var n=31-bi(e),i=1<<n;t[n]=-1,e&=~i}}function v_(t){if(wt&6)throw Error(ue(327));yo();var e=Kc(t,0);if(!(e&1))return Wn(t,$t()),null;var n=pu(t,e);if(t.tag!==0&&n===2){var i=kd(t);i!==0&&(e=i,n=dp(t,i))}if(n===1)throw n=el,As(t,0),Fr(t,e),Wn(t,$t()),n;if(n===6)throw Error(ue(345));return t.finishedWork=t.current.alternate,t.finishedLanes=e,ws(t,zn,cr),Wn(t,$t()),null}function Jp(t,e){var n=wt;wt|=1;try{return t(e)}finally{wt=n,wt===0&&(Ao=$t()+500,Su&&Jr())}}function Ns(t){Br!==null&&Br.tag===0&&!(wt&6)&&yo();var e=wt;wt|=1;var n=fi.transition,i=Ct;try{if(fi.transition=null,Ct=1,t)return t()}finally{Ct=i,fi.transition=n,wt=e,!(wt&6)&&Jr()}}function jp(){Zn=po.current,Ut(po)}function As(t,e){t.finishedWork=null,t.finishedLanes=0;var n=t.timeoutHandle;if(n!==-1&&(t.timeoutHandle=-1,l1(n)),Kt!==null)for(n=Kt.return;n!==null;){var i=n;switch(Lp(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&tu();break;case 3:To(),Ut(Hn),Ut(Mn),Vp();break;case 5:zp(i);break;case 4:To();break;case 13:Ut(Ht);break;case 19:Ut(Ht);break;case 10:Fp(i.type._context);break;case 22:case 23:jp()}n=n.return}if(cn=t,Kt=t=qr(t.current,null),pn=Zn=e,rn=0,el=null,$p=Tu=Ls=0,zn=Fa=null,Ts!==null){for(e=0;e<Ts.length;e++)if(n=Ts[e],i=n.interleaved,i!==null){n.interleaved=null;var r=i.next,s=n.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}n.pending=i}Ts=null}return t}function cx(t,e){do{var n=Kt;try{if(Up(),zc.current=uu,cu){for(var i=Gt.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}cu=!1}if(Is=0,ln=nn=Gt=null,Da=!1,Ja=0,Zp.current=null,n===null||n.return===null){rn=1,el=e,Kt=null;break}e:{var s=t,o=n.return,a=n,l=e;if(e=pn,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var c=l,f=a,d=f.tag;if(!(f.mode&1)&&(d===0||d===11||d===15)){var h=f.alternate;h?(f.updateQueue=h.updateQueue,f.memoizedState=h.memoizedState,f.lanes=h.lanes):(f.updateQueue=null,f.memoizedState=null)}var p=s_(o);if(p!==null){p.flags&=-257,o_(p,o,a,s,e),p.mode&1&&r_(s,c,e),e=p,l=c;var _=e.updateQueue;if(_===null){var S=new Set;S.add(l),e.updateQueue=S}else _.add(l);break e}else{if(!(e&1)){r_(s,c,e),Qp();break e}l=Error(ue(426))}}else if(kt&&a.mode&1){var m=s_(o);if(m!==null){!(m.flags&65536)&&(m.flags|=256),o_(m,o,a,s,e),Np(bo(l,a));break e}}s=l=bo(l,a),rn!==4&&(rn=2),Fa===null?Fa=[s]:Fa.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var u=qv(s,l,e);j0(s,u);break e;case 1:a=l;var g=s.type,v=s.stateNode;if(!(s.flags&128)&&(typeof g.getDerivedStateFromError=="function"||v!==null&&typeof v.componentDidCatch=="function"&&(Wr===null||!Wr.has(v)))){s.flags|=65536,e&=-e,s.lanes|=e;var y=Yv(s,a,e);j0(s,y);break e}}s=s.return}while(s!==null)}fx(n)}catch(A){e=A,Kt===n&&n!==null&&(Kt=n=n.return);continue}break}while(!0)}function ux(){var t=hu.current;return hu.current=uu,t===null?uu:t}function Qp(){(rn===0||rn===3||rn===2)&&(rn=4),cn===null||!(Ls&268435455)&&!(Tu&268435455)||Fr(cn,pn)}function pu(t,e){var n=wt;wt|=2;var i=ux();(cn!==t||pn!==e)&&(cr=null,As(t,e));do try{N1();break}catch(r){cx(t,r)}while(!0);if(Up(),wt=n,hu.current=i,Kt!==null)throw Error(ue(261));return cn=null,pn=0,rn}function N1(){for(;Kt!==null;)hx(Kt)}function D1(){for(;Kt!==null&&!aM();)hx(Kt)}function hx(t){var e=px(t.alternate,t,Zn);t.memoizedProps=t.pendingProps,e===null?fx(t):Kt=e,Zp.current=null}function fx(t){var e=t;do{var n=e.alternate;if(t=e.return,e.flags&32768){if(n=A1(n,e),n!==null){n.flags&=32767,Kt=n;return}if(t!==null)t.flags|=32768,t.subtreeFlags=0,t.deletions=null;else{rn=6,Kt=null;return}}else if(n=b1(n,e,Zn),n!==null){Kt=n;return}if(e=e.sibling,e!==null){Kt=e;return}Kt=e=t}while(e!==null);rn===0&&(rn=5)}function ws(t,e,n){var i=Ct,r=fi.transition;try{fi.transition=null,Ct=1,U1(t,e,n,i)}finally{fi.transition=r,Ct=i}return null}function U1(t,e,n,i){do yo();while(Br!==null);if(wt&6)throw Error(ue(327));n=t.finishedWork;var r=t.finishedLanes;if(n===null)return null;if(t.finishedWork=null,t.finishedLanes=0,n===t.current)throw Error(ue(177));t.callbackNode=null,t.callbackPriority=0;var s=n.lanes|n.childLanes;if(_M(t,s),t===cn&&(Kt=cn=null,pn=0),!(n.subtreeFlags&2064)&&!(n.flags&2064)||Uc||(Uc=!0,mx($c,function(){return yo(),null})),s=(n.flags&15990)!==0,n.subtreeFlags&15990||s){s=fi.transition,fi.transition=null;var o=Ct;Ct=1;var a=wt;wt|=4,Zp.current=null,R1(t,n),ox(n,t),i1(Xd),Jc=!!Wd,Xd=Wd=null,t.current=n,P1(n,t,r),lM(),wt=a,Ct=o,fi.transition=s}else t.current=n;if(Uc&&(Uc=!1,Br=t,du=r),s=t.pendingLanes,s===0&&(Wr=null),hM(n.stateNode,i),Wn(t,$t()),e!==null)for(i=t.onRecoverableError,n=0;n<e.length;n++)r=e[n],i(r.value,{componentStack:r.stack,digest:r.digest});if(fu)throw fu=!1,t=hp,hp=null,t;return du&1&&t.tag!==0&&yo(),s=t.pendingLanes,s&1?t===fp?Oa++:(Oa=0,fp=t):Oa=0,Jr(),null}function yo(){if(Br!==null){var t=q_(du),e=fi.transition,n=Ct;try{if(fi.transition=null,Ct=16>t?16:t,Br===null)var i=!1;else{if(t=Br,Br=null,du=0,wt&6)throw Error(ue(331));var r=wt;for(wt|=4,Ue=t.current;Ue!==null;){var s=Ue,o=s.child;if(Ue.flags&16){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var c=a[l];for(Ue=c;Ue!==null;){var f=Ue;switch(f.tag){case 0:case 11:case 15:Ua(8,f,s)}var d=f.child;if(d!==null)d.return=f,Ue=d;else for(;Ue!==null;){f=Ue;var h=f.sibling,p=f.return;if(ix(f),f===c){Ue=null;break}if(h!==null){h.return=p,Ue=h;break}Ue=p}}}var _=s.alternate;if(_!==null){var S=_.child;if(S!==null){_.child=null;do{var m=S.sibling;S.sibling=null,S=m}while(S!==null)}}Ue=s}}if(s.subtreeFlags&2064&&o!==null)o.return=s,Ue=o;else e:for(;Ue!==null;){if(s=Ue,s.flags&2048)switch(s.tag){case 0:case 11:case 15:Ua(9,s,s.return)}var u=s.sibling;if(u!==null){u.return=s.return,Ue=u;break e}Ue=s.return}}var g=t.current;for(Ue=g;Ue!==null;){o=Ue;var v=o.child;if(o.subtreeFlags&2064&&v!==null)v.return=o,Ue=v;else e:for(o=g;Ue!==null;){if(a=Ue,a.flags&2048)try{switch(a.tag){case 0:case 11:case 15:Eu(9,a)}}catch(A){Yt(a,a.return,A)}if(a===o){Ue=null;break e}var y=a.sibling;if(y!==null){y.return=a.return,Ue=y;break e}Ue=a.return}}if(wt=r,Jr(),Gi&&typeof Gi.onPostCommitFiberRoot=="function")try{Gi.onPostCommitFiberRoot(gu,t)}catch{}i=!0}return i}finally{Ct=n,fi.transition=e}}return!1}function x_(t,e,n){e=bo(n,e),e=qv(t,e,1),t=Gr(t,e,1),e=Ln(),t!==null&&(tl(t,1,e),Wn(t,e))}function Yt(t,e,n){if(t.tag===3)x_(t,t,n);else for(;e!==null;){if(e.tag===3){x_(e,t,n);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(Wr===null||!Wr.has(i))){t=bo(n,t),t=Yv(e,t,1),e=Gr(e,t,1),t=Ln(),e!==null&&(tl(e,1,t),Wn(e,t));break}}e=e.return}}function F1(t,e,n){var i=t.pingCache;i!==null&&i.delete(e),e=Ln(),t.pingedLanes|=t.suspendedLanes&n,cn===t&&(pn&n)===n&&(rn===4||rn===3&&(pn&130023424)===pn&&500>$t()-Kp?As(t,0):$p|=n),Wn(t,e)}function dx(t,e){e===0&&(t.mode&1?(e=Sc,Sc<<=1,!(Sc&130023424)&&(Sc=4194304)):e=1);var n=Ln();t=gr(t,e),t!==null&&(tl(t,e,n),Wn(t,n))}function O1(t){var e=t.memoizedState,n=0;e!==null&&(n=e.retryLane),dx(t,n)}function B1(t,e){var n=0;switch(t.tag){case 13:var i=t.stateNode,r=t.memoizedState;r!==null&&(n=r.retryLane);break;case 19:i=t.stateNode;break;default:throw Error(ue(314))}i!==null&&i.delete(e),dx(t,n)}var px;px=function(t,e,n){if(t!==null)if(t.memoizedProps!==e.pendingProps||Hn.current)Vn=!0;else{if(!(t.lanes&n)&&!(e.flags&128))return Vn=!1,T1(t,e,n);Vn=!!(t.flags&131072)}else Vn=!1,kt&&e.flags&1048576&&vv(e,ru,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;Hc(t,e),t=e.pendingProps;var r=Mo(e,Mn.current);xo(e,n),r=Gp(null,e,i,t,r,n);var s=Wp();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,Gn(i)?(s=!0,nu(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,Bp(e),r.updater=wu,e.stateNode=r,r._reactInternals=e,ep(e,i,t,n),e=ip(null,e,i,!0,s,n)):(e.tag=0,kt&&s&&Ip(e),In(null,e,r,n),e=e.child),e;case 16:i=e.elementType;e:{switch(Hc(t,e),t=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=z1(i),t=wi(i,t),r){case 0:e=np(null,e,i,t,n);break e;case 1:e=c_(null,e,i,t,n);break e;case 11:e=a_(null,e,i,t,n);break e;case 14:e=l_(null,e,i,wi(i.type,t),n);break e}throw Error(ue(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:wi(i,r),np(t,e,i,r,n);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:wi(i,r),c_(t,e,i,r,n);case 3:e:{if(Jv(e),t===null)throw Error(ue(387));i=e.pendingProps,s=e.memoizedState,r=s.element,Ev(t,e),au(e,i,null,n);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=bo(Error(ue(423)),e),e=u_(t,e,i,n,r);break e}else if(i!==r){r=bo(Error(ue(424)),e),e=u_(t,e,i,n,r);break e}else for($n=Hr(e.stateNode.containerInfo.firstChild),Kn=e,kt=!0,Ti=null,n=Mv(e,null,i,n),e.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if(wo(),i===r){e=_r(t,e,n);break e}In(t,e,i,n)}e=e.child}return e;case 5:return Tv(e),t===null&&Jd(e),i=e.type,r=e.pendingProps,s=t!==null?t.memoizedProps:null,o=r.children,qd(i,r)?o=null:s!==null&&qd(i,s)&&(e.flags|=32),Kv(t,e),In(t,e,o,n),e.child;case 6:return t===null&&Jd(e),null;case 13:return jv(t,e,n);case 4:return kp(e,e.stateNode.containerInfo),i=e.pendingProps,t===null?e.child=Eo(e,null,i,n):In(t,e,i,n),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:wi(i,r),a_(t,e,i,r,n);case 7:return In(t,e,e.pendingProps,n),e.child;case 8:return In(t,e,e.pendingProps.children,n),e.child;case 12:return In(t,e,e.pendingProps.children,n),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,Lt(su,i._currentValue),i._currentValue=o,s!==null)if(Ci(s.value,o)){if(s.children===r.children&&!Hn.current){e=_r(t,e,n);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=dr(-1,n&-n),l.tag=2;var c=s.updateQueue;if(c!==null){c=c.shared;var f=c.pending;f===null?l.next=l:(l.next=f.next,f.next=l),c.pending=l}}s.lanes|=n,l=s.alternate,l!==null&&(l.lanes|=n),jd(s.return,n,e),a.lanes|=n;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(ue(341));o.lanes|=n,a=o.alternate,a!==null&&(a.lanes|=n),jd(o,n,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}In(t,e,r.children,n),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,xo(e,n),r=di(r),i=i(r),e.flags|=1,In(t,e,i,n),e.child;case 14:return i=e.type,r=wi(i,e.pendingProps),r=wi(i.type,r),l_(t,e,i,r,n);case 15:return Zv(t,e,e.type,e.pendingProps,n);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:wi(i,r),Hc(t,e),e.tag=1,Gn(i)?(t=!0,nu(e)):t=!1,xo(e,n),Xv(e,i,r),ep(e,i,r,n),ip(null,e,i,!0,t,n);case 19:return Qv(t,e,n);case 22:return $v(t,e,n)}throw Error(ue(156,e.tag))};function mx(t,e){return H_(t,e)}function k1(t,e,n,i){this.tag=t,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function hi(t,e,n,i){return new k1(t,e,n,i)}function em(t){return t=t.prototype,!(!t||!t.isReactComponent)}function z1(t){if(typeof t=="function")return em(t)?1:0;if(t!=null){if(t=t.$$typeof,t===xp)return 11;if(t===yp)return 14}return 2}function qr(t,e){var n=t.alternate;return n===null?(n=hi(t.tag,e,t.key,t.mode),n.elementType=t.elementType,n.type=t.type,n.stateNode=t.stateNode,n.alternate=t,t.alternate=n):(n.pendingProps=e,n.type=t.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=t.flags&14680064,n.childLanes=t.childLanes,n.lanes=t.lanes,n.child=t.child,n.memoizedProps=t.memoizedProps,n.memoizedState=t.memoizedState,n.updateQueue=t.updateQueue,e=t.dependencies,n.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},n.sibling=t.sibling,n.index=t.index,n.ref=t.ref,n}function Xc(t,e,n,i,r,s){var o=2;if(i=t,typeof t=="function")em(t)&&(o=1);else if(typeof t=="string")o=5;else e:switch(t){case io:return Cs(n.children,r,s,e);case vp:o=8,r|=8;break;case Ed:return t=hi(12,n,e,r|2),t.elementType=Ed,t.lanes=s,t;case Td:return t=hi(13,n,e,r),t.elementType=Td,t.lanes=s,t;case bd:return t=hi(19,n,e,r),t.elementType=bd,t.lanes=s,t;case T_:return bu(n,r,s,e);default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case w_:o=10;break e;case E_:o=9;break e;case xp:o=11;break e;case yp:o=14;break e;case Nr:o=16,i=null;break e}throw Error(ue(130,t==null?t:typeof t,""))}return e=hi(o,n,e,r),e.elementType=t,e.type=i,e.lanes=s,e}function Cs(t,e,n,i){return t=hi(7,t,i,e),t.lanes=n,t}function bu(t,e,n,i){return t=hi(22,t,i,e),t.elementType=T_,t.lanes=n,t.stateNode={isHidden:!1},t}function Sd(t,e,n){return t=hi(6,t,null,e),t.lanes=n,t}function Md(t,e,n){return e=hi(4,t.children!==null?t.children:[],t.key,e),e.lanes=n,e.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},e}function V1(t,e,n,i,r){this.tag=e,this.containerInfo=t,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=sd(0),this.expirationTimes=sd(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=sd(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function tm(t,e,n,i,r,s,o,a,l){return t=new V1(t,e,n,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=hi(3,null,null,e),t.current=s,s.stateNode=t,s.memoizedState={element:i,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},Bp(s),t}function H1(t,e,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:no,key:i==null?null:""+i,children:t,containerInfo:e,implementation:n}}function gx(t){if(!t)return Zr;t=t._reactInternals;e:{if(Us(t)!==t||t.tag!==1)throw Error(ue(170));var e=t;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(Gn(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(ue(171))}if(t.tag===1){var n=t.type;if(Gn(n))return gv(t,n,e)}return e}function _x(t,e,n,i,r,s,o,a,l){return t=tm(n,i,!0,t,r,s,o,a,l),t.context=gx(null),n=t.current,i=Ln(),r=Xr(n),s=dr(i,r),s.callback=e??null,Gr(n,s,r),t.current.lanes=r,tl(t,r,i),Wn(t,i),t}function Au(t,e,n,i){var r=e.current,s=Ln(),o=Xr(r);return n=gx(n),e.context===null?e.context=n:e.pendingContext=n,e=dr(s,o),e.payload={element:t},i=i===void 0?null:i,i!==null&&(e.callback=i),t=Gr(r,e,o),t!==null&&(Ai(t,r,o,s),kc(t,r,o)),o}function mu(t){if(t=t.current,!t.child)return null;switch(t.child.tag){case 5:return t.child.stateNode;default:return t.child.stateNode}}function y_(t,e){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var n=t.retryLane;t.retryLane=n!==0&&n<e?n:e}}function nm(t,e){y_(t,e),(t=t.alternate)&&y_(t,e)}function G1(){return null}var vx=typeof reportError=="function"?reportError:function(t){console.error(t)};function im(t){this._internalRoot=t}Cu.prototype.render=im.prototype.render=function(t){var e=this._internalRoot;if(e===null)throw Error(ue(409));Au(t,e,null,null)};Cu.prototype.unmount=im.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var e=t.containerInfo;Ns(function(){Au(null,t,null,null)}),e[mr]=null}};function Cu(t){this._internalRoot=t}Cu.prototype.unstable_scheduleHydration=function(t){if(t){var e=$_();t={blockedOn:null,target:t,priority:e};for(var n=0;n<Ur.length&&e!==0&&e<Ur[n].priority;n++);Ur.splice(n,0,t),n===0&&J_(t)}};function rm(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function Ru(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11&&(t.nodeType!==8||t.nodeValue!==" react-mount-point-unstable "))}function S_(){}function W1(t,e,n,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var c=mu(o);s.call(c)}}var o=_x(e,i,t,0,null,!1,!1,"",S_);return t._reactRootContainer=o,t[mr]=o.current,qa(t.nodeType===8?t.parentNode:t),Ns(),o}for(;r=t.lastChild;)t.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var c=mu(l);a.call(c)}}var l=tm(t,0,!1,null,null,!1,!1,"",S_);return t._reactRootContainer=l,t[mr]=l.current,qa(t.nodeType===8?t.parentNode:t),Ns(function(){Au(e,l,n,i)}),l}function Pu(t,e,n,i,r){var s=n._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=mu(o);a.call(l)}}Au(e,o,t,r)}else o=W1(n,e,t,r,i);return mu(o)}Y_=function(t){switch(t.tag){case 3:var e=t.stateNode;if(e.current.memoizedState.isDehydrated){var n=Aa(e.pendingLanes);n!==0&&(wp(e,n|1),Wn(e,$t()),!(wt&6)&&(Ao=$t()+500,Jr()))}break;case 13:Ns(function(){var i=gr(t,1);if(i!==null){var r=Ln();Ai(i,t,1,r)}}),nm(t,1)}};Ep=function(t){if(t.tag===13){var e=gr(t,134217728);if(e!==null){var n=Ln();Ai(e,t,134217728,n)}nm(t,134217728)}};Z_=function(t){if(t.tag===13){var e=Xr(t),n=gr(t,e);if(n!==null){var i=Ln();Ai(n,t,e,i)}nm(t,e)}};$_=function(){return Ct};K_=function(t,e){var n=Ct;try{return Ct=t,e()}finally{Ct=n}};Fd=function(t,e,n){switch(e){case"input":if(Rd(t,n),e=n.name,n.type==="radio"&&e!=null){for(n=t;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<n.length;e++){var i=n[e];if(i!==t&&i.form===t.form){var r=yu(i);if(!r)throw Error(ue(90));A_(i),Rd(i,r)}}}break;case"textarea":R_(t,n);break;case"select":e=n.value,e!=null&&mo(t,!!n.multiple,e,!1)}};F_=Jp;O_=Ns;var X1={usingClientEntryPoint:!1,Events:[il,ao,yu,D_,U_,Jp]},wa={findFiberByHostInstance:Es,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},q1={bundleType:wa.bundleType,version:wa.version,rendererPackageName:wa.rendererPackageName,rendererConfig:wa.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:vr.ReactCurrentDispatcher,findHostInstanceByFiber:function(t){return t=z_(t),t===null?null:t.stateNode},findFiberByHostInstance:wa.findFiberByHostInstance||G1,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(Ea=__REACT_DEVTOOLS_GLOBAL_HOOK__,!Ea.isDisabled&&Ea.supportsFiber))try{gu=Ea.inject(q1),Gi=Ea}catch{}var Ea;Qn.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=X1;Qn.createPortal=function(t,e){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!rm(e))throw Error(ue(200));return H1(t,e,null,n)};Qn.createRoot=function(t,e){if(!rm(t))throw Error(ue(299));var n=!1,i="",r=vx;return e!=null&&(e.unstable_strictMode===!0&&(n=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=tm(t,1,!1,null,null,n,!1,i,r),t[mr]=e.current,qa(t.nodeType===8?t.parentNode:t),new im(e)};Qn.findDOMNode=function(t){if(t==null)return null;if(t.nodeType===1)return t;var e=t._reactInternals;if(e===void 0)throw typeof t.render=="function"?Error(ue(188)):(t=Object.keys(t).join(","),Error(ue(268,t)));return t=z_(e),t=t===null?null:t.stateNode,t};Qn.flushSync=function(t){return Ns(t)};Qn.hydrate=function(t,e,n){if(!Ru(e))throw Error(ue(200));return Pu(null,t,e,!0,n)};Qn.hydrateRoot=function(t,e,n){if(!rm(t))throw Error(ue(405));var i=n!=null&&n.hydratedSources||null,r=!1,s="",o=vx;if(n!=null&&(n.unstable_strictMode===!0&&(r=!0),n.identifierPrefix!==void 0&&(s=n.identifierPrefix),n.onRecoverableError!==void 0&&(o=n.onRecoverableError)),e=_x(e,null,t,1,n??null,r,!1,s,o),t[mr]=e.current,qa(t),i)for(t=0;t<i.length;t++)n=i[t],r=n._getVersion,r=r(n._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[n,r]:e.mutableSourceEagerHydrationData.push(n,r);return new Cu(e)};Qn.render=function(t,e,n){if(!Ru(e))throw Error(ue(200));return Pu(null,t,e,!1,n)};Qn.unmountComponentAtNode=function(t){if(!Ru(t))throw Error(ue(40));return t._reactRootContainer?(Ns(function(){Pu(null,null,t,!1,function(){t._reactRootContainer=null,t[mr]=null})}),!0):!1};Qn.unstable_batchedUpdates=Jp;Qn.unstable_renderSubtreeIntoContainer=function(t,e,n,i){if(!Ru(n))throw Error(ue(200));if(t==null||t._reactInternals===void 0)throw Error(ue(38));return Pu(t,e,n,!1,i)};Qn.version="18.3.1-next-f1338f8080-20240426"});var Mx=lr((vR,Sx)=>{"use strict";function yx(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(yx)}catch(t){console.error(t)}}yx(),Sx.exports=xx()});var Ex=lr(sm=>{"use strict";var wx=Mx();sm.createRoot=wx.createRoot,sm.hydrateRoot=wx.hydrateRoot;var xR});var vS=lr(Bf=>{"use strict";var tR=hc(),nR=Symbol.for("react.element"),iR=Symbol.for("react.fragment"),rR=Object.prototype.hasOwnProperty,sR=tR.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,oR={key:!0,ref:!0,__self:!0,__source:!0};function _S(t,e,n){var i,r={},s=null,o=null;n!==void 0&&(s=""+n),e.key!==void 0&&(s=""+e.key),e.ref!==void 0&&(o=e.ref);for(i in e)rR.call(e,i)&&!oR.hasOwnProperty(i)&&(r[i]=e[i]);if(t&&t.defaultProps)for(i in e=t.defaultProps,e)r[i]===void 0&&(r[i]=e[i]);return{$$typeof:nR,type:t,key:s,ref:o,props:r,_owner:sR.current}}Bf.Fragment=iR;Bf.jsx=_S;Bf.jsxs=_S});var kg=lr((OP,xS)=>{"use strict";xS.exports=vS()});var Oi=ac(hc()),SS=ac(Ex());var kh="184";var ey=0,qm=1,ty=2;var Wl=1,zh=2,ra=3,Tr=0,On=1,er=2,tr=0,Hs=1,Ym=2,Zm=3,$m=4,ny=5;var ss=100,iy=101,ry=102,sy=103,oy=104,ay=200,ly=201,cy=202,uy=203,eh=204,th=205,hy=206,fy=207,dy=208,py=209,my=210,gy=211,_y=212,vy=213,xy=214,nh=0,ih=1,rh=2,Gs=3,sh=4,oh=5,ah=6,lh=7,Km=0,yy=1,Sy=2,Di=0,Jm=1,jm=2,Qm=3,Xl=4,eg=5,tg=6,ng=7;var ig=300,fs=301,Ys=302,Vh=303,Hh=304,ql=306,Ws=1e3,Yi=1001,ch=1002,hn=1003,My=1004;var Yl=1005;var _n=1006,Gh=1007;var ds=1008;var Xn=1009,rg=1010,sg=1011,sa=1012,Wh=1013,Ui=1014,Fi=1015,nr=1016,Xh=1017,qh=1018,oa=1020,og=35902,ag=35899,lg=1021,cg=1022,gi=1023,Zi=1026,ps=1027,ug=1028,Yh=1029,ms=1030,Zh=1031;var $h=1033,Zl=33776,$l=33777,Kl=33778,Jl=33779,Kh=35840,Jh=35841,jh=35842,Qh=35843,ef=36196,tf=37492,nf=37496,rf=37488,sf=37489,jl=37490,of=37491,af=37808,lf=37809,cf=37810,uf=37811,hf=37812,ff=37813,df=37814,pf=37815,mf=37816,gf=37817,_f=37818,vf=37819,xf=37820,yf=37821,Sf=36492,Mf=36494,wf=36495,Ef=36283,Tf=36284,Ql=36285,bf=36286;var pl=2300,uh=2301,Qu=2302,Im=2303,Lm=2400,Nm=2401,Dm=2402;var wy=3200;var Af=0,Ey=1,Ar="",Un="srgb",ml="srgb-linear",gl="linear",Tt="srgb";var zs=7680;var Um=519,Ty=512,by=513,Ay=514,Cf=515,Cy=516,Ry=517,Rf=518,Py=519,Fm=35044;var hg="300 es",Li=2e3,Wo=2001;function Y1(t){for(let e=t.length-1;e>=0;--e)if(t[e]>=65535)return!0;return!1}function Z1(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function _l(t){return document.createElementNS("http://www.w3.org/1999/xhtml",t)}function Iy(){let t=_l("canvas");return t.style.display="block",t}var Tx={},Xo=null;function fg(...t){let e="THREE."+t.shift();Xo?Xo("log",e,...t):console.log(e,...t)}function Ly(t){let e=t[0];if(typeof e=="string"&&e.startsWith("TSL:")){let n=t[1];n&&n.isStackTrace?t[0]+=" "+n.getLocation():t[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return t}function $e(...t){t=Ly(t);let e="THREE."+t.shift();if(Xo)Xo("warn",e,...t);else{let n=t[0];n&&n.isStackTrace?console.warn(n.getError(e)):console.warn(e,...t)}}function Je(...t){t=Ly(t);let e="THREE."+t.shift();if(Xo)Xo("error",e,...t);else{let n=t[0];n&&n.isStackTrace?console.error(n.getError(e)):console.error(e,...t)}}function hh(...t){let e=t.join(" ");e in Tx||(Tx[e]=!0,$e(...t))}function Ny(t,e,n){return new Promise(function(i,r){function s(){switch(t.clientWaitSync(e,t.SYNC_FLUSH_COMMANDS_BIT,0)){case t.WAIT_FAILED:r();break;case t.TIMEOUT_EXPIRED:setTimeout(s,n);break;default:i()}}setTimeout(s,n)})}var Dy={[nh]:ih,[rh]:ah,[sh]:lh,[Gs]:oh,[ih]:nh,[ah]:rh,[lh]:sh,[oh]:Gs},$i=class{addEventListener(e,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(n)===-1&&i[e].push(n)}hasEventListener(e,n){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(n)!==-1}removeEventListener(e,n){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(n);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let n=this._listeners;if(n===void 0)return;let i=n[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},wn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],bx=1234567,ul=Math.PI/180,qo=180/Math.PI;function Zs(){let t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(wn[t&255]+wn[t>>8&255]+wn[t>>16&255]+wn[t>>24&255]+"-"+wn[e&255]+wn[e>>8&255]+"-"+wn[e>>16&15|64]+wn[e>>24&255]+"-"+wn[n&63|128]+wn[n>>8&255]+"-"+wn[n>>16&255]+wn[n>>24&255]+wn[i&255]+wn[i>>8&255]+wn[i>>16&255]+wn[i>>24&255]).toLowerCase()}function dt(t,e,n){return Math.max(e,Math.min(n,t))}function dg(t,e){return(t%e+e)%e}function $1(t,e,n,i,r){return i+(t-e)*(r-i)/(n-e)}function K1(t,e,n){return t!==e?(n-t)/(e-t):0}function hl(t,e,n){return(1-n)*t+n*e}function J1(t,e,n,i){return hl(t,e,1-Math.exp(-n*i))}function j1(t,e=1){return e-Math.abs(dg(t,e*2)-e)}function Q1(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*(3-2*t))}function ew(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*t*(t*(t*6-15)+10))}function tw(t,e){return t+Math.floor(Math.random()*(e-t+1))}function nw(t,e){return t+Math.random()*(e-t)}function iw(t){return t*(.5-Math.random())}function rw(t){t!==void 0&&(bx=t);let e=bx+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function sw(t){return t*ul}function ow(t){return t*qo}function aw(t){return(t&t-1)===0&&t!==0}function lw(t){return Math.pow(2,Math.ceil(Math.log(t)/Math.LN2))}function cw(t){return Math.pow(2,Math.floor(Math.log(t)/Math.LN2))}function uw(t,e,n,i,r){let s=Math.cos,o=Math.sin,a=s(n/2),l=o(n/2),c=s((e+i)/2),f=o((e+i)/2),d=s((e-i)/2),h=o((e-i)/2),p=s((i-e)/2),_=o((i-e)/2);switch(r){case"XYX":t.set(a*f,l*d,l*h,a*c);break;case"YZY":t.set(l*h,a*f,l*d,a*c);break;case"ZXZ":t.set(l*d,l*h,a*f,a*c);break;case"XZX":t.set(a*f,l*_,l*p,a*c);break;case"YXY":t.set(l*p,a*f,l*_,a*c);break;case"ZYZ":t.set(l*_,l*p,a*f,a*c);break;default:$e("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+r)}}function Ho(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return t/4294967295;case Uint16Array:return t/65535;case Uint8Array:return t/255;case Int32Array:return Math.max(t/2147483647,-1);case Int16Array:return Math.max(t/32767,-1);case Int8Array:return Math.max(t/127,-1);default:throw new Error("Invalid component type.")}}function Dn(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return Math.round(t*4294967295);case Uint16Array:return Math.round(t*65535);case Uint8Array:return Math.round(t*255);case Int32Array:return Math.round(t*2147483647);case Int16Array:return Math.round(t*32767);case Int8Array:return Math.round(t*127);default:throw new Error("Invalid component type.")}}var $s={DEG2RAD:ul,RAD2DEG:qo,generateUUID:Zs,clamp:dt,euclideanModulo:dg,mapLinear:$1,inverseLerp:K1,lerp:hl,damp:J1,pingpong:j1,smoothstep:Q1,smootherstep:ew,randInt:tw,randFloat:nw,randFloatSpread:iw,seededRandom:rw,degToRad:sw,radToDeg:ow,isPowerOfTwo:aw,ceilPowerOfTwo:lw,floorPowerOfTwo:cw,setQuaternionFromProperEuler:uw,normalize:Dn,denormalize:Ho},xg=class xg{constructor(e=0,n=0){this.x=e,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,n){return this.x=e,this.y=n,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let n=this.x,i=this.y,r=e.elements;return this.x=r[0]*n+r[3]*i+r[6],this.y=r[1]*n+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,n){return this.x=dt(this.x,e.x,n.x),this.y=dt(this.y,e.y,n.y),this}clampScalar(e,n){return this.x=dt(this.x,e,n),this.y=dt(this.y,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(dt(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(dt(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y;return n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this}rotateAround(e,n){let i=Math.cos(n),r=Math.sin(n),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};xg.prototype.isVector2=!0;var we=xg,Ki=class{constructor(e=0,n=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=n,this._z=i,this._w=r}static slerpFlat(e,n,i,r,s,o,a){let l=i[r+0],c=i[r+1],f=i[r+2],d=i[r+3],h=s[o+0],p=s[o+1],_=s[o+2],S=s[o+3];if(d!==S||l!==h||c!==p||f!==_){let m=l*h+c*p+f*_+d*S;m<0&&(h=-h,p=-p,_=-_,S=-S,m=-m);let u=1-a;if(m<.9995){let g=Math.acos(m),v=Math.sin(g);u=Math.sin(u*g)/v,a=Math.sin(a*g)/v,l=l*u+h*a,c=c*u+p*a,f=f*u+_*a,d=d*u+S*a}else{l=l*u+h*a,c=c*u+p*a,f=f*u+_*a,d=d*u+S*a;let g=1/Math.sqrt(l*l+c*c+f*f+d*d);l*=g,c*=g,f*=g,d*=g}}e[n]=l,e[n+1]=c,e[n+2]=f,e[n+3]=d}static multiplyQuaternionsFlat(e,n,i,r,s,o){let a=i[r],l=i[r+1],c=i[r+2],f=i[r+3],d=s[o],h=s[o+1],p=s[o+2],_=s[o+3];return e[n]=a*_+f*d+l*p-c*h,e[n+1]=l*_+f*h+c*d-a*p,e[n+2]=c*_+f*p+a*h-l*d,e[n+3]=f*_-a*d-l*h-c*p,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,n,i,r){return this._x=e,this._y=n,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,n=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(i/2),f=a(r/2),d=a(s/2),h=l(i/2),p=l(r/2),_=l(s/2);switch(o){case"XYZ":this._x=h*f*d+c*p*_,this._y=c*p*d-h*f*_,this._z=c*f*_+h*p*d,this._w=c*f*d-h*p*_;break;case"YXZ":this._x=h*f*d+c*p*_,this._y=c*p*d-h*f*_,this._z=c*f*_-h*p*d,this._w=c*f*d+h*p*_;break;case"ZXY":this._x=h*f*d-c*p*_,this._y=c*p*d+h*f*_,this._z=c*f*_+h*p*d,this._w=c*f*d-h*p*_;break;case"ZYX":this._x=h*f*d-c*p*_,this._y=c*p*d+h*f*_,this._z=c*f*_-h*p*d,this._w=c*f*d+h*p*_;break;case"YZX":this._x=h*f*d+c*p*_,this._y=c*p*d+h*f*_,this._z=c*f*_-h*p*d,this._w=c*f*d-h*p*_;break;case"XZY":this._x=h*f*d-c*p*_,this._y=c*p*d-h*f*_,this._z=c*f*_+h*p*d,this._w=c*f*d+h*p*_;break;default:$e("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,n){let i=n/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let n=e.elements,i=n[0],r=n[4],s=n[8],o=n[1],a=n[5],l=n[9],c=n[2],f=n[6],d=n[10],h=i+a+d;if(h>0){let p=.5/Math.sqrt(h+1);this._w=.25/p,this._x=(f-l)*p,this._y=(s-c)*p,this._z=(o-r)*p}else if(i>a&&i>d){let p=2*Math.sqrt(1+i-a-d);this._w=(f-l)/p,this._x=.25*p,this._y=(r+o)/p,this._z=(s+c)/p}else if(a>d){let p=2*Math.sqrt(1+a-i-d);this._w=(s-c)/p,this._x=(r+o)/p,this._y=.25*p,this._z=(l+f)/p}else{let p=2*Math.sqrt(1+d-i-a);this._w=(o-r)/p,this._x=(s+c)/p,this._y=(l+f)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(e,n){let i=e.dot(n)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*n.z-e.z*n.y,this._y=e.z*n.x-e.x*n.z,this._z=e.x*n.y-e.y*n.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(dt(this.dot(e),-1,1)))}rotateTowards(e,n){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,n/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=n._x,l=n._y,c=n._z,f=n._w;return this._x=i*f+o*a+r*c-s*l,this._y=r*f+o*l+s*a-i*c,this._z=s*f+o*c+i*l-r*a,this._w=o*f-i*a-r*l-s*c,this._onChangeCallback(),this}slerp(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=this.dot(e);a<0&&(i=-i,r=-r,s=-s,o=-o,a=-a);let l=1-n;if(a<.9995){let c=Math.acos(a),f=Math.sin(c);l=Math.sin(l*c)/f,n=Math.sin(n*c)/f,this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this._onChangeCallback()}else this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this.normalize();return this}slerpQuaternions(e,n,i){return this.copy(e).slerp(n,i)}random(){let e=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(n),s*Math.cos(n))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,n=0){return this._x=e[n],this._y=e[n+1],this._z=e[n+2],this._w=e[n+3],this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._w,e}fromBufferAttribute(e,n){return this._x=e.getX(n),this._y=e.getY(n),this._z=e.getZ(n),this._w=e.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},yg=class yg{constructor(e=0,n=0,i=0){this.x=e,this.y=n,this.z=i}set(e,n,i){return i===void 0&&(i=this.z),this.x=e,this.y=n,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,n){return this.x=e.x*n.x,this.y=e.y*n.y,this.z=e.z*n.z,this}applyEuler(e){return this.applyQuaternion(Ax.setFromEuler(e))}applyAxisAngle(e,n){return this.applyQuaternion(Ax.setFromAxisAngle(e,n))}applyMatrix3(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[3]*i+s[6]*r,this.y=s[1]*n+s[4]*i+s[7]*r,this.z=s[2]*n+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*n+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*n+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*n+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*n+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let n=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*r-a*i),f=2*(a*n-s*r),d=2*(s*i-o*n);return this.x=n+l*c+o*d-a*f,this.y=i+l*f+a*c-s*d,this.z=r+l*d+s*f-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[4]*i+s[8]*r,this.y=s[1]*n+s[5]*i+s[9]*r,this.z=s[2]*n+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,n){return this.x=dt(this.x,e.x,n.x),this.y=dt(this.y,e.y,n.y),this.z=dt(this.z,e.z,n.z),this}clampScalar(e,n){return this.x=dt(this.x,e,n),this.y=dt(this.y,e,n),this.z=dt(this.z,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(dt(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,n){let i=e.x,r=e.y,s=e.z,o=n.x,a=n.y,l=n.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let n=e.lengthSq();if(n===0)return this.set(0,0,0);let i=e.dot(this)/n;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return om.copy(this).projectOnVector(e),this.sub(om)}reflect(e){return this.sub(om.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(dt(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return n*n+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,n,i){let r=Math.sin(n)*e;return this.x=r*Math.sin(i),this.y=Math.cos(n)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,n,i){return this.x=e*Math.sin(n),this.y=i,this.z=e*Math.cos(n),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(e){let n=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=n,this.y=i,this.z=r,this}setFromMatrixColumn(e,n){return this.fromArray(e.elements,n*4)}setFromMatrix3Column(e,n){return this.fromArray(e.elements,n*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(e),this.y=n,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};yg.prototype.isVector3=!0;var N=yg,om=new N,Ax=new Ki,Sg=class Sg{constructor(e,n,i,r,s,o,a,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c)}set(e,n,i,r,s,o,a,l,c){let f=this.elements;return f[0]=e,f[1]=r,f[2]=a,f[3]=n,f[4]=s,f[5]=l,f[6]=i,f[7]=o,f[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(e,n,i){return e.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let n=e.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[3],l=i[6],c=i[1],f=i[4],d=i[7],h=i[2],p=i[5],_=i[8],S=r[0],m=r[3],u=r[6],g=r[1],v=r[4],y=r[7],A=r[2],w=r[5],C=r[8];return s[0]=o*S+a*g+l*A,s[3]=o*m+a*v+l*w,s[6]=o*u+a*y+l*C,s[1]=c*S+f*g+d*A,s[4]=c*m+f*v+d*w,s[7]=c*u+f*y+d*C,s[2]=h*S+p*g+_*A,s[5]=h*m+p*v+_*w,s[8]=h*u+p*y+_*C,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[3]*=e,n[6]*=e,n[1]*=e,n[4]*=e,n[7]*=e,n[2]*=e,n[5]*=e,n[8]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],f=e[8];return n*o*f-n*a*c-i*s*f+i*a*l+r*s*c-r*o*l}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],f=e[8],d=f*o-a*c,h=a*l-f*s,p=c*s-o*l,_=n*d+i*h+r*p;if(_===0)return this.set(0,0,0,0,0,0,0,0,0);let S=1/_;return e[0]=d*S,e[1]=(r*c-f*i)*S,e[2]=(a*i-r*o)*S,e[3]=h*S,e[4]=(f*n-r*l)*S,e[5]=(r*s-a*n)*S,e[6]=p*S,e[7]=(i*l-c*n)*S,e[8]=(o*n-i*s)*S,this}transpose(){let e,n=this.elements;return e=n[1],n[1]=n[3],n[3]=e,e=n[2],n[2]=n[6],n[6]=e,e=n[5],n[5]=n[7],n[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let n=this.elements;return e[0]=n[0],e[1]=n[3],e[2]=n[6],e[3]=n[1],e[4]=n[4],e[5]=n[7],e[6]=n[2],e[7]=n[5],e[8]=n[8],this}setUvTransform(e,n,i,r,s,o,a){let l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*o+c*a)+o+e,-r*c,r*l,-r*(-c*o+l*a)+a+n,0,0,1),this}scale(e,n){return this.premultiply(am.makeScale(e,n)),this}rotate(e){return this.premultiply(am.makeRotation(-e)),this}translate(e,n){return this.premultiply(am.makeTranslation(e,n)),this}makeTranslation(e,n){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,n,0,0,1),this}makeRotation(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(e,n){return this.set(e,0,0,0,n,0,0,0,1),this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<9;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<9;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}};Sg.prototype.isMatrix3=!0;var it=Sg,am=new it,Cx=new it().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Rx=new it().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function hw(){let t={enabled:!0,workingColorSpace:ml,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===Tt&&(r.r=Er(r.r),r.g=Er(r.g),r.b=Er(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===Tt&&(r.r=Go(r.r),r.g=Go(r.g),r.b=Go(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===Ar?gl:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return hh("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),t.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return hh("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),t.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return t.define({[ml]:{primaries:e,whitePoint:i,transfer:gl,toXYZ:Cx,fromXYZ:Rx,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:Un},outputColorSpaceConfig:{drawingBufferColorSpace:Un}},[Un]:{primaries:e,whitePoint:i,transfer:Tt,toXYZ:Cx,fromXYZ:Rx,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:Un}}}),t}var xt=hw();function Er(t){return t<.04045?t*.0773993808:Math.pow(t*.9478672986+.0521327014,2.4)}function Go(t){return t<.0031308?t*12.92:1.055*Math.pow(t,.41666)-.055}var Po,fh=class{static getDataURL(e,n="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{Po===void 0&&(Po=_l("canvas")),Po.width=e.width,Po.height=e.height;let r=Po.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=Po}return i.toDataURL(n)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let n=_l("canvas");n.width=e.width,n.height=e.height;let i=n.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=Er(s[o]/255)*255;return i.putImageData(r,0,0),n}else if(e.data){let n=e.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor(Er(n[i]/255)*255):n[i]=Er(n[i]);return{data:n,width:e.width,height:e.height}}else return $e("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},fw=0,Yo=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:fw++}),this.uuid=Zs(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?e.set(n.videoWidth,n.videoHeight,0):typeof VideoFrame<"u"&&n instanceof VideoFrame?e.set(n.displayWidth,n.displayHeight,0):n!==null?e.set(n.width,n.height,n.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(lm(r[o].image)):s.push(lm(r[o]))}else s=lm(r);i.url=s}return n||(e.images[this.uuid]=i),i}};function lm(t){return typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap?fh.getDataURL(t):t.data?{data:Array.from(t.data),width:t.width,height:t.height,type:t.data.constructor.name}:($e("Texture: Unable to serialize Texture."),{})}var dw=0,cm=new N,Fn=class t extends $i{constructor(e=t.DEFAULT_IMAGE,n=t.DEFAULT_MAPPING,i=Yi,r=Yi,s=_n,o=ds,a=gi,l=Xn,c=t.DEFAULT_ANISOTROPY,f=Ar){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:dw++}),this.uuid=Zs(),this.name="",this.source=new Yo(e),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new we(0,0),this.repeat=new we(1,1),this.center=new we(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new it,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=f,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(cm).x}get height(){return this.source.getSize(cm).y}get depth(){return this.source.getSize(cm).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let n in e){let i=e[n];if(i===void 0){$e(`Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){$e(`Texture.setValues(): property '${n}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==ig)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Ws:e.x=e.x-Math.floor(e.x);break;case Yi:e.x=e.x<0?0:1;break;case ch:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Ws:e.y=e.y-Math.floor(e.y);break;case Yi:e.y=e.y<0?0:1;break;case ch:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Fn.DEFAULT_IMAGE=null;Fn.DEFAULT_MAPPING=ig;Fn.DEFAULT_ANISOTROPY=1;var Mg=class Mg{constructor(e=0,n=0,i=0,r=1){this.x=e,this.y=n,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,n,i,r){return this.x=e,this.y=n,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this.w=e.w+n.w,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this.w+=e.w*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this.w=e.w-n.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*n+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*n+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*n+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*n+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let n=Math.sqrt(1-e.w*e.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/n,this.y=e.y/n,this.z=e.z/n),this}setAxisAngleFromRotationMatrix(e){let n,i,r,s,l=e.elements,c=l[0],f=l[4],d=l[8],h=l[1],p=l[5],_=l[9],S=l[2],m=l[6],u=l[10];if(Math.abs(f-h)<.01&&Math.abs(d-S)<.01&&Math.abs(_-m)<.01){if(Math.abs(f+h)<.1&&Math.abs(d+S)<.1&&Math.abs(_+m)<.1&&Math.abs(c+p+u-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let v=(c+1)/2,y=(p+1)/2,A=(u+1)/2,w=(f+h)/4,C=(d+S)/4,x=(_+m)/4;return v>y&&v>A?v<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(v),r=w/i,s=C/i):y>A?y<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(y),i=w/r,s=x/r):A<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(A),i=C/s,r=x/s),this.set(i,r,s,n),this}let g=Math.sqrt((m-_)*(m-_)+(d-S)*(d-S)+(h-f)*(h-f));return Math.abs(g)<.001&&(g=1),this.x=(m-_)/g,this.y=(d-S)/g,this.z=(h-f)/g,this.w=Math.acos((c+p+u-1)/2),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,n){return this.x=dt(this.x,e.x,n.x),this.y=dt(this.y,e.y,n.y),this.z=dt(this.z,e.z,n.z),this.w=dt(this.w,e.w,n.w),this}clampScalar(e,n){return this.x=dt(this.x,e,n),this.y=dt(this.y,e,n),this.z=dt(this.z,e,n),this.w=dt(this.w,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(dt(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this.w+=(e.w-this.w)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this.w=e.w+(n.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this.w=e[n+3],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e[n+3]=this.w,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this.w=e.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};Mg.prototype.isVector4=!0;var qt=Mg,dh=class extends $i{constructor(e=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:_n,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=n,this.depth=i.depth,this.scissor=new qt(0,0,e,n),this.scissorTest=!1,this.viewport=new qt(0,0,e,n),this.textures=[];let r={width:e,height:n,depth:i.depth},s=new Fn(r),o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let n={minFilter:_n,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(n.mapping=e.mapping),e.wrapS!==void 0&&(n.wrapS=e.wrapS),e.wrapT!==void 0&&(n.wrapT=e.wrapT),e.wrapR!==void 0&&(n.wrapR=e.wrapR),e.magFilter!==void 0&&(n.magFilter=e.magFilter),e.minFilter!==void 0&&(n.minFilter=e.minFilter),e.format!==void 0&&(n.format=e.format),e.type!==void 0&&(n.type=e.type),e.anisotropy!==void 0&&(n.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(n.colorSpace=e.colorSpace),e.flipY!==void 0&&(n.flipY=e.flipY),e.generateMipmaps!==void 0&&(n.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(n.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,n,i=1){if(this.width!==e||this.height!==n||this.depth!==i){this.width=e,this.height=n,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=n,this.textures[r].image.depth=i,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,n),this.scissor.set(0,0,e,n)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++){this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let r=Object.assign({},e.textures[n].image);this.textures[n].source=new Yo(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},ii=class extends dh{constructor(e=1,n=1,i={}){super(e,n,i),this.isWebGLRenderTarget=!0}},vl=class extends Fn{constructor(e=null,n=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=hn,this.minFilter=hn,this.wrapR=Yi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var ph=class extends Fn{constructor(e=null,n=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=hn,this.minFilter=hn,this.wrapR=Yi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Bh=class Bh{constructor(e,n,i,r,s,o,a,l,c,f,d,h,p,_,S,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c,f,d,h,p,_,S,m)}set(e,n,i,r,s,o,a,l,c,f,d,h,p,_,S,m){let u=this.elements;return u[0]=e,u[4]=n,u[8]=i,u[12]=r,u[1]=s,u[5]=o,u[9]=a,u[13]=l,u[2]=c,u[6]=f,u[10]=d,u[14]=h,u[3]=p,u[7]=_,u[11]=S,u[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Bh().fromArray(this.elements)}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(e){let n=this.elements,i=e.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(e){let n=e.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(e,n,i){return this.determinant()===0?(e.set(1,0,0),n.set(0,1,0),i.set(0,0,1),this):(e.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(e,n,i){return this.set(e.x,n.x,i.x,0,e.y,n.y,i.y,0,e.z,n.z,i.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let n=this.elements,i=e.elements,r=1/Io.setFromMatrixColumn(e,0).length(),s=1/Io.setFromMatrixColumn(e,1).length(),o=1/Io.setFromMatrixColumn(e,2).length();return n[0]=i[0]*r,n[1]=i[1]*r,n[2]=i[2]*r,n[3]=0,n[4]=i[4]*s,n[5]=i[5]*s,n[6]=i[6]*s,n[7]=0,n[8]=i[8]*o,n[9]=i[9]*o,n[10]=i[10]*o,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(e){let n=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),c=Math.sin(r),f=Math.cos(s),d=Math.sin(s);if(e.order==="XYZ"){let h=o*f,p=o*d,_=a*f,S=a*d;n[0]=l*f,n[4]=-l*d,n[8]=c,n[1]=p+_*c,n[5]=h-S*c,n[9]=-a*l,n[2]=S-h*c,n[6]=_+p*c,n[10]=o*l}else if(e.order==="YXZ"){let h=l*f,p=l*d,_=c*f,S=c*d;n[0]=h+S*a,n[4]=_*a-p,n[8]=o*c,n[1]=o*d,n[5]=o*f,n[9]=-a,n[2]=p*a-_,n[6]=S+h*a,n[10]=o*l}else if(e.order==="ZXY"){let h=l*f,p=l*d,_=c*f,S=c*d;n[0]=h-S*a,n[4]=-o*d,n[8]=_+p*a,n[1]=p+_*a,n[5]=o*f,n[9]=S-h*a,n[2]=-o*c,n[6]=a,n[10]=o*l}else if(e.order==="ZYX"){let h=o*f,p=o*d,_=a*f,S=a*d;n[0]=l*f,n[4]=_*c-p,n[8]=h*c+S,n[1]=l*d,n[5]=S*c+h,n[9]=p*c-_,n[2]=-c,n[6]=a*l,n[10]=o*l}else if(e.order==="YZX"){let h=o*l,p=o*c,_=a*l,S=a*c;n[0]=l*f,n[4]=S-h*d,n[8]=_*d+p,n[1]=d,n[5]=o*f,n[9]=-a*f,n[2]=-c*f,n[6]=p*d+_,n[10]=h-S*d}else if(e.order==="XZY"){let h=o*l,p=o*c,_=a*l,S=a*c;n[0]=l*f,n[4]=-d,n[8]=c*f,n[1]=h*d+S,n[5]=o*f,n[9]=p*d-_,n[2]=_*d-p,n[6]=a*f,n[10]=S*d+h}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(e){return this.compose(pw,e,mw)}lookAt(e,n,i){let r=this.elements;return ei.subVectors(e,n),ei.lengthSq()===0&&(ei.z=1),ei.normalize(),jr.crossVectors(i,ei),jr.lengthSq()===0&&(Math.abs(i.z)===1?ei.x+=1e-4:ei.z+=1e-4,ei.normalize(),jr.crossVectors(i,ei)),jr.normalize(),Iu.crossVectors(ei,jr),r[0]=jr.x,r[4]=Iu.x,r[8]=ei.x,r[1]=jr.y,r[5]=Iu.y,r[9]=ei.y,r[2]=jr.z,r[6]=Iu.z,r[10]=ei.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[4],l=i[8],c=i[12],f=i[1],d=i[5],h=i[9],p=i[13],_=i[2],S=i[6],m=i[10],u=i[14],g=i[3],v=i[7],y=i[11],A=i[15],w=r[0],C=r[4],x=r[8],b=r[12],P=r[1],R=r[5],F=r[9],G=r[13],X=r[2],U=r[6],k=r[10],V=r[14],ne=r[3],le=r[7],me=r[11],Ae=r[15];return s[0]=o*w+a*P+l*X+c*ne,s[4]=o*C+a*R+l*U+c*le,s[8]=o*x+a*F+l*k+c*me,s[12]=o*b+a*G+l*V+c*Ae,s[1]=f*w+d*P+h*X+p*ne,s[5]=f*C+d*R+h*U+p*le,s[9]=f*x+d*F+h*k+p*me,s[13]=f*b+d*G+h*V+p*Ae,s[2]=_*w+S*P+m*X+u*ne,s[6]=_*C+S*R+m*U+u*le,s[10]=_*x+S*F+m*k+u*me,s[14]=_*b+S*G+m*V+u*Ae,s[3]=g*w+v*P+y*X+A*ne,s[7]=g*C+v*R+y*U+A*le,s[11]=g*x+v*F+y*k+A*me,s[15]=g*b+v*G+y*V+A*Ae,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[4]*=e,n[8]*=e,n[12]*=e,n[1]*=e,n[5]*=e,n[9]*=e,n[13]*=e,n[2]*=e,n[6]*=e,n[10]*=e,n[14]*=e,n[3]*=e,n[7]*=e,n[11]*=e,n[15]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],c=e[13],f=e[2],d=e[6],h=e[10],p=e[14],_=e[3],S=e[7],m=e[11],u=e[15],g=l*p-c*h,v=a*p-c*d,y=a*h-l*d,A=o*p-c*f,w=o*h-l*f,C=o*d-a*f;return n*(S*g-m*v+u*y)-i*(_*g-m*A+u*w)+r*(_*v-S*A+u*C)-s*(_*y-S*w+m*C)}transpose(){let e=this.elements,n;return n=e[1],e[1]=e[4],e[4]=n,n=e[2],e[2]=e[8],e[8]=n,n=e[6],e[6]=e[9],e[9]=n,n=e[3],e[3]=e[12],e[12]=n,n=e[7],e[7]=e[13],e[13]=n,n=e[11],e[11]=e[14],e[14]=n,this}setPosition(e,n,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=n,r[14]=i),this}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],f=e[8],d=e[9],h=e[10],p=e[11],_=e[12],S=e[13],m=e[14],u=e[15],g=n*a-i*o,v=n*l-r*o,y=n*c-s*o,A=i*l-r*a,w=i*c-s*a,C=r*c-s*l,x=f*S-d*_,b=f*m-h*_,P=f*u-p*_,R=d*m-h*S,F=d*u-p*S,G=h*u-p*m,X=g*G-v*F+y*R+A*P-w*b+C*x;if(X===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let U=1/X;return e[0]=(a*G-l*F+c*R)*U,e[1]=(r*F-i*G-s*R)*U,e[2]=(S*C-m*w+u*A)*U,e[3]=(h*w-d*C-p*A)*U,e[4]=(l*P-o*G-c*b)*U,e[5]=(n*G-r*P+s*b)*U,e[6]=(m*y-_*C-u*v)*U,e[7]=(f*C-h*y+p*v)*U,e[8]=(o*F-a*P+c*x)*U,e[9]=(i*P-n*F-s*x)*U,e[10]=(_*w-S*y+u*g)*U,e[11]=(d*y-f*w-p*g)*U,e[12]=(a*b-o*R-l*x)*U,e[13]=(n*R-i*b+r*x)*U,e[14]=(S*v-_*A-m*g)*U,e[15]=(f*A-d*v+h*g)*U,this}scale(e){let n=this.elements,i=e.x,r=e.y,s=e.z;return n[0]*=i,n[4]*=r,n[8]*=s,n[1]*=i,n[5]*=r,n[9]*=s,n[2]*=i,n[6]*=r,n[10]*=s,n[3]*=i,n[7]*=r,n[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,n=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(n,i,r))}makeTranslation(e,n,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(e){let n=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,n){let i=Math.cos(n),r=Math.sin(n),s=1-i,o=e.x,a=e.y,l=e.z,c=s*o,f=s*a;return this.set(c*o+i,c*a-r*l,c*l+r*a,0,c*a+r*l,f*a+i,f*l-r*o,0,c*l-r*a,f*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,n,i){return this.set(e,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,n,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,n,r,1,0,0,0,0,1),this}compose(e,n,i){let r=this.elements,s=n._x,o=n._y,a=n._z,l=n._w,c=s+s,f=o+o,d=a+a,h=s*c,p=s*f,_=s*d,S=o*f,m=o*d,u=a*d,g=l*c,v=l*f,y=l*d,A=i.x,w=i.y,C=i.z;return r[0]=(1-(S+u))*A,r[1]=(p+y)*A,r[2]=(_-v)*A,r[3]=0,r[4]=(p-y)*w,r[5]=(1-(h+u))*w,r[6]=(m+g)*w,r[7]=0,r[8]=(_+v)*C,r[9]=(m-g)*C,r[10]=(1-(h+S))*C,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,n,i){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinant();if(s===0)return i.set(1,1,1),n.identity(),this;let o=Io.set(r[0],r[1],r[2]).length(),a=Io.set(r[4],r[5],r[6]).length(),l=Io.set(r[8],r[9],r[10]).length();s<0&&(o=-o),Ri.copy(this);let c=1/o,f=1/a,d=1/l;return Ri.elements[0]*=c,Ri.elements[1]*=c,Ri.elements[2]*=c,Ri.elements[4]*=f,Ri.elements[5]*=f,Ri.elements[6]*=f,Ri.elements[8]*=d,Ri.elements[9]*=d,Ri.elements[10]*=d,n.setFromRotationMatrix(Ri),i.x=o,i.y=a,i.z=l,this}makePerspective(e,n,i,r,s,o,a=Li,l=!1){let c=this.elements,f=2*s/(n-e),d=2*s/(i-r),h=(n+e)/(n-e),p=(i+r)/(i-r),_,S;if(l)_=s/(o-s),S=o*s/(o-s);else if(a===Li)_=-(o+s)/(o-s),S=-2*o*s/(o-s);else if(a===Wo)_=-o/(o-s),S=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=f,c[4]=0,c[8]=h,c[12]=0,c[1]=0,c[5]=d,c[9]=p,c[13]=0,c[2]=0,c[6]=0,c[10]=_,c[14]=S,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,n,i,r,s,o,a=Li,l=!1){let c=this.elements,f=2/(n-e),d=2/(i-r),h=-(n+e)/(n-e),p=-(i+r)/(i-r),_,S;if(l)_=1/(o-s),S=o/(o-s);else if(a===Li)_=-2/(o-s),S=-(o+s)/(o-s);else if(a===Wo)_=-1/(o-s),S=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=f,c[4]=0,c[8]=0,c[12]=h,c[1]=0,c[5]=d,c[9]=0,c[13]=p,c[2]=0,c[6]=0,c[10]=_,c[14]=S,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<16;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<16;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e[n+9]=i[9],e[n+10]=i[10],e[n+11]=i[11],e[n+12]=i[12],e[n+13]=i[13],e[n+14]=i[14],e[n+15]=i[15],e}};Bh.prototype.isMatrix4=!0;var bt=Bh,Io=new N,Ri=new bt,pw=new N(0,0,0),mw=new N(1,1,1),jr=new N,Iu=new N,ei=new N,Px=new bt,Ix=new Ki,Ni=class t{constructor(e=0,n=0,i=0,r=t.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=n,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,n,i,r=this._order){return this._x=e,this._y=n,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,n=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],f=r[9],d=r[2],h=r[6],p=r[10];switch(n){case"XYZ":this._y=Math.asin(dt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-f,p),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(h,c),this._z=0);break;case"YXZ":this._x=Math.asin(-dt(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(dt(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-d,p),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-dt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(h,p),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(dt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-f,c),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-dt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(h,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-f,p),this._y=0);break;default:$e("Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,n,i){return Px.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Px,n,i)}setFromVector3(e,n=this._order){return this.set(e.x,e.y,e.z,n)}reorder(e){return Ix.setFromEuler(this),this.setFromQuaternion(Ix,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Ni.DEFAULT_ORDER="XYZ";var Zo=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},gw=0,Lx=new N,Lo=new Ki,xr=new bt,Lu=new N,sl=new N,_w=new N,vw=new Ki,Nx=new N(1,0,0),Dx=new N(0,1,0),Ux=new N(0,0,1),Fx={type:"added"},xw={type:"removed"},No={type:"childadded",child:null},um={type:"childremoved",child:null},fn=class t extends $i{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:gw++}),this.uuid=Zs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=t.DEFAULT_UP.clone();let e=new N,n=new Ni,i=new Ki,r=new N(1,1,1);function s(){i.setFromEuler(n,!1)}function o(){n.setFromQuaternion(i,void 0,!1)}n._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new bt},normalMatrix:{value:new it}}),this.matrix=new bt,this.matrixWorld=new bt,this.matrixAutoUpdate=t.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Zo,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,n){this.quaternion.setFromAxisAngle(e,n)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,n){return Lo.setFromAxisAngle(e,n),this.quaternion.multiply(Lo),this}rotateOnWorldAxis(e,n){return Lo.setFromAxisAngle(e,n),this.quaternion.premultiply(Lo),this}rotateX(e){return this.rotateOnAxis(Nx,e)}rotateY(e){return this.rotateOnAxis(Dx,e)}rotateZ(e){return this.rotateOnAxis(Ux,e)}translateOnAxis(e,n){return Lx.copy(e).applyQuaternion(this.quaternion),this.position.add(Lx.multiplyScalar(n)),this}translateX(e){return this.translateOnAxis(Nx,e)}translateY(e){return this.translateOnAxis(Dx,e)}translateZ(e){return this.translateOnAxis(Ux,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(xr.copy(this.matrixWorld).invert())}lookAt(e,n,i){e.isVector3?Lu.copy(e):Lu.set(e,n,i);let r=this.parent;this.updateWorldMatrix(!0,!1),sl.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?xr.lookAt(sl,Lu,this.up):xr.lookAt(Lu,sl,this.up),this.quaternion.setFromRotationMatrix(xr),r&&(xr.extractRotation(r.matrixWorld),Lo.setFromRotationMatrix(xr),this.quaternion.premultiply(Lo.invert()))}add(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return e===this?(Je("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Fx),No.child=e,this.dispatchEvent(No),No.child=null):Je("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(e);return n!==-1&&(e.parent=null,this.children.splice(n,1),e.dispatchEvent(xw),um.child=e,this.dispatchEvent(um),um.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),xr.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),xr.multiply(e.parent.matrixWorld)),e.applyMatrix4(xr),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Fx),No.child=e,this.dispatchEvent(No),No.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,n){if(this[e]===n)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,n);if(o!==void 0)return o}}getObjectsByProperty(e,n,i=[]){this[e]===n&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,n,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(sl,e,_w),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(sl,vw,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return e.set(n[8],n[9],n[10]).normalize()}raycast(){}traverse(e){e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverseVisible(e)}traverseAncestors(e){let n=this.parent;n!==null&&(e(n),n.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let n=e.x,i=e.y,r=e.z,s=this.matrix.elements;s[12]+=n-s[0]*n-s[4]*i-s[8]*r,s[13]+=i-s[1]*n-s[5]*i-s[9]*r,s[14]+=r-s[2]*n-s[6]*i-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].updateMatrixWorld(e)}updateWorldMatrix(e,n){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),n===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let n=e===void 0||typeof e=="string",i={};n&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,f=l.length;c<f;c++){let d=l[c];s(e.shapes,d)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(n){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),f=o(e.images),d=o(e.shapes),h=o(e.skeletons),p=o(e.animations),_=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),f.length>0&&(i.images=f),d.length>0&&(i.shapes=d),h.length>0&&(i.skeletons=h),p.length>0&&(i.animations=p),_.length>0&&(i.nodes=_)}return i.object=r,i;function o(a){let l=[];for(let c in a){let f=a[c];delete f.metadata,l.push(f)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,n=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),n===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};fn.DEFAULT_UP=new N(0,1,0);fn.DEFAULT_MATRIX_AUTO_UPDATE=!0;fn.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var gn=class extends fn{constructor(){super(),this.isGroup=!0,this.type="Group"}},yw={type:"move"},$o=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new gn,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new gn,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new N,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new N),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new gn,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new N,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new N,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let n=this._hand;if(n)for(let i of e.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,n,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&n.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let S of e.hand.values()){let m=n.getJointPose(S,i),u=this._getHandJoint(c,S);m!==null&&(u.matrix.fromArray(m.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=m.radius),u.visible=m!==null}let f=c.joints["index-finger-tip"],d=c.joints["thumb-tip"],h=f.position.distanceTo(d.position),p=.02,_=.005;c.inputState.pinching&&h>p+_?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&h<=p-_&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=n.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));a!==null&&(r=n.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(yw)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,n){if(e.joints[n.jointName]===void 0){let i=new gn;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[n.jointName]=i,e.add(i)}return e.joints[n.jointName]}},Uy={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Qr={h:0,s:0,l:0},Nu={h:0,s:0,l:0};function hm(t,e,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?t+(e-t)*6*n:n<1/2?e:n<2/3?t+(e-t)*6*(2/3-n):t}var pt=class{constructor(e,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,n,i)}set(e,n,i){if(n===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,n,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,n=Un){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,xt.colorSpaceToWorking(this,n),this}setRGB(e,n,i,r=xt.workingColorSpace){return this.r=e,this.g=n,this.b=i,xt.colorSpaceToWorking(this,r),this}setHSL(e,n,i,r=xt.workingColorSpace){if(e=dg(e,1),n=dt(n,0,1),i=dt(i,0,1),n===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+n):i+n-i*n,o=2*i-s;this.r=hm(o,s,e+1/3),this.g=hm(o,s,e),this.b=hm(o,s,e-1/3)}return xt.colorSpaceToWorking(this,r),this}setStyle(e,n=Un){function i(s){s!==void 0&&parseFloat(s)<1&&$e("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,n);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,n);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,n);break;default:$e("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,n);if(o===6)return this.setHex(parseInt(s,16),n);$e("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,n);return this}setColorName(e,n=Un){let i=Uy[e.toLowerCase()];return i!==void 0?this.setHex(i,n):$e("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Er(e.r),this.g=Er(e.g),this.b=Er(e.b),this}copyLinearToSRGB(e){return this.r=Go(e.r),this.g=Go(e.g),this.b=Go(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Un){return xt.workingToColorSpace(En.copy(this),e),Math.round(dt(En.r*255,0,255))*65536+Math.round(dt(En.g*255,0,255))*256+Math.round(dt(En.b*255,0,255))}getHexString(e=Un){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,n=xt.workingColorSpace){xt.workingToColorSpace(En.copy(this),n);let i=En.r,r=En.g,s=En.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,c,f=(a+o)/2;if(a===o)l=0,c=0;else{let d=o-a;switch(c=f<=.5?d/(o+a):d/(2-o-a),o){case i:l=(r-s)/d+(r<s?6:0);break;case r:l=(s-i)/d+2;break;case s:l=(i-r)/d+4;break}l/=6}return e.h=l,e.s=c,e.l=f,e}getRGB(e,n=xt.workingColorSpace){return xt.workingToColorSpace(En.copy(this),n),e.r=En.r,e.g=En.g,e.b=En.b,e}getStyle(e=Un){xt.workingToColorSpace(En.copy(this),e);let n=En.r,i=En.g,r=En.b;return e!==Un?`color(${e} ${n.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,n,i){return this.getHSL(Qr),this.setHSL(Qr.h+e,Qr.s+n,Qr.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,n){return this.r=e.r+n.r,this.g=e.g+n.g,this.b=e.b+n.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,n){return this.r+=(e.r-this.r)*n,this.g+=(e.g-this.g)*n,this.b+=(e.b-this.b)*n,this}lerpColors(e,n,i){return this.r=e.r+(n.r-e.r)*i,this.g=e.g+(n.g-e.g)*i,this.b=e.b+(n.b-e.b)*i,this}lerpHSL(e,n){this.getHSL(Qr),e.getHSL(Nu);let i=hl(Qr.h,Nu.h,n),r=hl(Qr.s,Nu.s,n),s=hl(Qr.l,Nu.l,n);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let n=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*n+s[3]*i+s[6]*r,this.g=s[1]*n+s[4]*i+s[7]*r,this.b=s[2]*n+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,n=0){return this.r=e[n],this.g=e[n+1],this.b=e[n+2],this}toArray(e=[],n=0){return e[n]=this.r,e[n+1]=this.g,e[n+2]=this.b,e}fromBufferAttribute(e,n){return this.r=e.getX(n),this.g=e.getY(n),this.b=e.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},En=new pt;pt.NAMES=Uy;var xl=class t{constructor(e,n=1,i=1e3){this.isFog=!0,this.name="",this.color=new pt(e),this.near=n,this.far=i}clone(){return new t(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}},yl=class extends fn{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Ni,this.environmentIntensity=1,this.environmentRotation=new Ni,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,n){return super.copy(e,n),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let n=super.toJSON(e);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(n.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(n.object.backgroundIntensity=this.backgroundIntensity),n.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(n.object.environmentIntensity=this.environmentIntensity),n.object.environmentRotation=this.environmentRotation.toArray(),n}},Pi=new N,yr=new N,fm=new N,Sr=new N,Do=new N,Uo=new N,Ox=new N,dm=new N,pm=new N,mm=new N,gm=new qt,_m=new qt,vm=new qt,rs=class t{constructor(e=new N,n=new N,i=new N){this.a=e,this.b=n,this.c=i}static getNormal(e,n,i,r){r.subVectors(i,n),Pi.subVectors(e,n),r.cross(Pi);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,n,i,r,s){Pi.subVectors(r,n),yr.subVectors(i,n),fm.subVectors(e,n);let o=Pi.dot(Pi),a=Pi.dot(yr),l=Pi.dot(fm),c=yr.dot(yr),f=yr.dot(fm),d=o*c-a*a;if(d===0)return s.set(0,0,0),null;let h=1/d,p=(c*l-a*f)*h,_=(o*f-a*l)*h;return s.set(1-p-_,_,p)}static containsPoint(e,n,i,r){return this.getBarycoord(e,n,i,r,Sr)===null?!1:Sr.x>=0&&Sr.y>=0&&Sr.x+Sr.y<=1}static getInterpolation(e,n,i,r,s,o,a,l){return this.getBarycoord(e,n,i,r,Sr)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Sr.x),l.addScaledVector(o,Sr.y),l.addScaledVector(a,Sr.z),l)}static getInterpolatedAttribute(e,n,i,r,s,o){return gm.setScalar(0),_m.setScalar(0),vm.setScalar(0),gm.fromBufferAttribute(e,n),_m.fromBufferAttribute(e,i),vm.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(gm,s.x),o.addScaledVector(_m,s.y),o.addScaledVector(vm,s.z),o}static isFrontFacing(e,n,i,r){return Pi.subVectors(i,n),yr.subVectors(e,n),Pi.cross(yr).dot(r)<0}set(e,n,i){return this.a.copy(e),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(e,n,i,r){return this.a.copy(e[n]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,n,i,r){return this.a.fromBufferAttribute(e,n),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Pi.subVectors(this.c,this.b),yr.subVectors(this.a,this.b),Pi.cross(yr).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return t.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,n){return t.getBarycoord(e,this.a,this.b,this.c,n)}getInterpolation(e,n,i,r,s){return t.getInterpolation(e,this.a,this.b,this.c,n,i,r,s)}containsPoint(e){return t.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return t.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,n){let i=this.a,r=this.b,s=this.c,o,a;Do.subVectors(r,i),Uo.subVectors(s,i),dm.subVectors(e,i);let l=Do.dot(dm),c=Uo.dot(dm);if(l<=0&&c<=0)return n.copy(i);pm.subVectors(e,r);let f=Do.dot(pm),d=Uo.dot(pm);if(f>=0&&d<=f)return n.copy(r);let h=l*d-f*c;if(h<=0&&l>=0&&f<=0)return o=l/(l-f),n.copy(i).addScaledVector(Do,o);mm.subVectors(e,s);let p=Do.dot(mm),_=Uo.dot(mm);if(_>=0&&p<=_)return n.copy(s);let S=p*c-l*_;if(S<=0&&c>=0&&_<=0)return a=c/(c-_),n.copy(i).addScaledVector(Uo,a);let m=f*_-p*d;if(m<=0&&d-f>=0&&p-_>=0)return Ox.subVectors(s,r),a=(d-f)/(d-f+(p-_)),n.copy(r).addScaledVector(Ox,a);let u=1/(m+S+h);return o=S*u,a=h*u,n.copy(i).addScaledVector(Do,o).addScaledVector(Uo,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},os=class{constructor(e=new N(1/0,1/0,1/0),n=new N(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=n}set(e,n){return this.min.copy(e),this.max.copy(n),this}setFromArray(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n+=3)this.expandByPoint(Ii.fromArray(e,n));return this}setFromBufferAttribute(e){this.makeEmpty();for(let n=0,i=e.count;n<i;n++)this.expandByPoint(Ii.fromBufferAttribute(e,n));return this}setFromPoints(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n++)this.expandByPoint(e[n]);return this}setFromCenterAndSize(e,n){let i=Ii.copy(n).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,n=!1){return this.makeEmpty(),this.expandByObject(e,n)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,n=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(n===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,Ii):Ii.fromBufferAttribute(s,o),Ii.applyMatrix4(e.matrixWorld),this.expandByPoint(Ii);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Du.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Du.copy(i.boundingBox)),Du.applyMatrix4(e.matrixWorld),this.union(Du)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],n);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,n){return n.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,Ii),Ii.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let n,i;return e.normal.x>0?(n=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(n=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(n+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(n+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(n+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(n+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),n<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(ol),Uu.subVectors(this.max,ol),Fo.subVectors(e.a,ol),Oo.subVectors(e.b,ol),Bo.subVectors(e.c,ol),es.subVectors(Oo,Fo),ts.subVectors(Bo,Oo),Fs.subVectors(Fo,Bo);let n=[0,-es.z,es.y,0,-ts.z,ts.y,0,-Fs.z,Fs.y,es.z,0,-es.x,ts.z,0,-ts.x,Fs.z,0,-Fs.x,-es.y,es.x,0,-ts.y,ts.x,0,-Fs.y,Fs.x,0];return!xm(n,Fo,Oo,Bo,Uu)||(n=[1,0,0,0,1,0,0,0,1],!xm(n,Fo,Oo,Bo,Uu))?!1:(Fu.crossVectors(es,ts),n=[Fu.x,Fu.y,Fu.z],xm(n,Fo,Oo,Bo,Uu))}clampPoint(e,n){return n.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Ii).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Ii).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Mr[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Mr[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Mr[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Mr[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Mr[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Mr[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Mr[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Mr[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Mr),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Mr=[new N,new N,new N,new N,new N,new N,new N,new N],Ii=new N,Du=new os,Fo=new N,Oo=new N,Bo=new N,es=new N,ts=new N,Fs=new N,ol=new N,Uu=new N,Fu=new N,Os=new N;function xm(t,e,n,i,r){for(let s=0,o=t.length-3;s<=o;s+=3){Os.fromArray(t,s);let a=r.x*Math.abs(Os.x)+r.y*Math.abs(Os.y)+r.z*Math.abs(Os.z),l=e.dot(Os),c=n.dot(Os),f=i.dot(Os);if(Math.max(-Math.max(l,c,f),Math.min(l,c,f))>a)return!1}return!0}var Jt=new N,Ou=new we,Sw=0,ni=class extends $i{constructor(e,n,i=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Sw++}),this.name="",this.array=e,this.itemSize=n,this.count=e!==void 0?e.length/n:0,this.normalized=i,this.usage=Fm,this.updateRanges=[],this.gpuType=Fi,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,n,i){e*=this.itemSize,i*=n.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=n.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)Ou.fromBufferAttribute(this,n),Ou.applyMatrix3(e),this.setXY(n,Ou.x,Ou.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)Jt.fromBufferAttribute(this,n),Jt.applyMatrix3(e),this.setXYZ(n,Jt.x,Jt.y,Jt.z);return this}applyMatrix4(e){for(let n=0,i=this.count;n<i;n++)Jt.fromBufferAttribute(this,n),Jt.applyMatrix4(e),this.setXYZ(n,Jt.x,Jt.y,Jt.z);return this}applyNormalMatrix(e){for(let n=0,i=this.count;n<i;n++)Jt.fromBufferAttribute(this,n),Jt.applyNormalMatrix(e),this.setXYZ(n,Jt.x,Jt.y,Jt.z);return this}transformDirection(e){for(let n=0,i=this.count;n<i;n++)Jt.fromBufferAttribute(this,n),Jt.transformDirection(e),this.setXYZ(n,Jt.x,Jt.y,Jt.z);return this}set(e,n=0){return this.array.set(e,n),this}getComponent(e,n){let i=this.array[e*this.itemSize+n];return this.normalized&&(i=Ho(i,this.array)),i}setComponent(e,n,i){return this.normalized&&(i=Dn(i,this.array)),this.array[e*this.itemSize+n]=i,this}getX(e){let n=this.array[e*this.itemSize];return this.normalized&&(n=Ho(n,this.array)),n}setX(e,n){return this.normalized&&(n=Dn(n,this.array)),this.array[e*this.itemSize]=n,this}getY(e){let n=this.array[e*this.itemSize+1];return this.normalized&&(n=Ho(n,this.array)),n}setY(e,n){return this.normalized&&(n=Dn(n,this.array)),this.array[e*this.itemSize+1]=n,this}getZ(e){let n=this.array[e*this.itemSize+2];return this.normalized&&(n=Ho(n,this.array)),n}setZ(e,n){return this.normalized&&(n=Dn(n,this.array)),this.array[e*this.itemSize+2]=n,this}getW(e){let n=this.array[e*this.itemSize+3];return this.normalized&&(n=Ho(n,this.array)),n}setW(e,n){return this.normalized&&(n=Dn(n,this.array)),this.array[e*this.itemSize+3]=n,this}setXY(e,n,i){return e*=this.itemSize,this.normalized&&(n=Dn(n,this.array),i=Dn(i,this.array)),this.array[e+0]=n,this.array[e+1]=i,this}setXYZ(e,n,i,r){return e*=this.itemSize,this.normalized&&(n=Dn(n,this.array),i=Dn(i,this.array),r=Dn(r,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,n,i,r,s){return e*=this.itemSize,this.normalized&&(n=Dn(n,this.array),i=Dn(i,this.array),r=Dn(r,this.array),s=Dn(s,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Fm&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var Sl=class extends ni{constructor(e,n,i){super(new Uint16Array(e),n,i)}};var Ml=class extends ni{constructor(e,n,i){super(new Uint32Array(e),n,i)}};var St=class extends ni{constructor(e,n,i){super(new Float32Array(e),n,i)}},Mw=new os,al=new N,ym=new N,Ko=class{constructor(e=new N,n=-1){this.isSphere=!0,this.center=e,this.radius=n}set(e,n){return this.center.copy(e),this.radius=n,this}setFromPoints(e,n){let i=this.center;n!==void 0?i.copy(n):Mw.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let n=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=n*n}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,n){let i=this.center.distanceToSquared(e);return n.copy(e),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;al.subVectors(e,this.center);let n=al.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),r=(i-this.radius)*.5;this.center.addScaledVector(al,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(ym.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(al.copy(e.center).add(ym)),this.expandByPoint(al.copy(e.center).sub(ym))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},ww=0,mi=new bt,Sm=new fn,ko=new N,ti=new os,ll=new os,un=new N,jt=class t extends $i{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:ww++}),this.uuid=Zs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Y1(e)?Ml:Sl)(e,1):this.index=e,this}setIndirect(e,n=0){return this.indirect=e,this.indirectOffset=n,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,n){return this.attributes[e]=n,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,n,i=0){this.groups.push({start:e,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,n){this.drawRange.start=e,this.drawRange.count=n}applyMatrix4(e){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(e),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new it().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return mi.makeRotationFromQuaternion(e),this.applyMatrix4(mi),this}rotateX(e){return mi.makeRotationX(e),this.applyMatrix4(mi),this}rotateY(e){return mi.makeRotationY(e),this.applyMatrix4(mi),this}rotateZ(e){return mi.makeRotationZ(e),this.applyMatrix4(mi),this}translate(e,n,i){return mi.makeTranslation(e,n,i),this.applyMatrix4(mi),this}scale(e,n,i){return mi.makeScale(e,n,i),this.applyMatrix4(mi),this}lookAt(e){return Sm.lookAt(e),Sm.updateMatrix(),this.applyMatrix4(Sm.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(ko).negate(),this.translate(ko.x,ko.y,ko.z),this}setFromPoints(e){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new St(i,3))}else{let i=Math.min(e.length,n.count);for(let r=0;r<i;r++){let s=e[r];n.setXYZ(r,s.x,s.y,s.z||0)}e.length>n.count&&$e("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new os);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Je("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new N(-1/0,-1/0,-1/0),new N(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),n)for(let i=0,r=n.length;i<r;i++){let s=n[i];ti.setFromBufferAttribute(s),this.morphTargetsRelative?(un.addVectors(this.boundingBox.min,ti.min),this.boundingBox.expandByPoint(un),un.addVectors(this.boundingBox.max,ti.max),this.boundingBox.expandByPoint(un)):(this.boundingBox.expandByPoint(ti.min),this.boundingBox.expandByPoint(ti.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Je('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Ko);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Je("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new N,1/0);return}if(e){let i=this.boundingSphere.center;if(ti.setFromBufferAttribute(e),n)for(let s=0,o=n.length;s<o;s++){let a=n[s];ll.setFromBufferAttribute(a),this.morphTargetsRelative?(un.addVectors(ti.min,ll.min),ti.expandByPoint(un),un.addVectors(ti.max,ll.max),ti.expandByPoint(un)):(ti.expandByPoint(ll.min),ti.expandByPoint(ll.max))}ti.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)un.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(un));if(n)for(let s=0,o=n.length;s<o;s++){let a=n[s],l=this.morphTargetsRelative;for(let c=0,f=a.count;c<f;c++)un.fromBufferAttribute(a,c),l&&(ko.fromBufferAttribute(e,c),un.add(ko)),r=Math.max(r,i.distanceToSquared(un))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&Je('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,n=this.attributes;if(e===null||n.position===void 0||n.normal===void 0||n.uv===void 0){Je("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,r=n.normal,s=n.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new ni(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let x=0;x<i.count;x++)a[x]=new N,l[x]=new N;let c=new N,f=new N,d=new N,h=new we,p=new we,_=new we,S=new N,m=new N;function u(x,b,P){c.fromBufferAttribute(i,x),f.fromBufferAttribute(i,b),d.fromBufferAttribute(i,P),h.fromBufferAttribute(s,x),p.fromBufferAttribute(s,b),_.fromBufferAttribute(s,P),f.sub(c),d.sub(c),p.sub(h),_.sub(h);let R=1/(p.x*_.y-_.x*p.y);isFinite(R)&&(S.copy(f).multiplyScalar(_.y).addScaledVector(d,-p.y).multiplyScalar(R),m.copy(d).multiplyScalar(p.x).addScaledVector(f,-_.x).multiplyScalar(R),a[x].add(S),a[b].add(S),a[P].add(S),l[x].add(m),l[b].add(m),l[P].add(m))}let g=this.groups;g.length===0&&(g=[{start:0,count:e.count}]);for(let x=0,b=g.length;x<b;++x){let P=g[x],R=P.start,F=P.count;for(let G=R,X=R+F;G<X;G+=3)u(e.getX(G+0),e.getX(G+1),e.getX(G+2))}let v=new N,y=new N,A=new N,w=new N;function C(x){A.fromBufferAttribute(r,x),w.copy(A);let b=a[x];v.copy(b),v.sub(A.multiplyScalar(A.dot(b))).normalize(),y.crossVectors(w,b);let R=y.dot(l[x])<0?-1:1;o.setXYZW(x,v.x,v.y,v.z,R)}for(let x=0,b=g.length;x<b;++x){let P=g[x],R=P.start,F=P.count;for(let G=R,X=R+F;G<X;G+=3)C(e.getX(G+0)),C(e.getX(G+1)),C(e.getX(G+2))}}computeVertexNormals(){let e=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new ni(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let h=0,p=i.count;h<p;h++)i.setXYZ(h,0,0,0);let r=new N,s=new N,o=new N,a=new N,l=new N,c=new N,f=new N,d=new N;if(e)for(let h=0,p=e.count;h<p;h+=3){let _=e.getX(h+0),S=e.getX(h+1),m=e.getX(h+2);r.fromBufferAttribute(n,_),s.fromBufferAttribute(n,S),o.fromBufferAttribute(n,m),f.subVectors(o,s),d.subVectors(r,s),f.cross(d),a.fromBufferAttribute(i,_),l.fromBufferAttribute(i,S),c.fromBufferAttribute(i,m),a.add(f),l.add(f),c.add(f),i.setXYZ(_,a.x,a.y,a.z),i.setXYZ(S,l.x,l.y,l.z),i.setXYZ(m,c.x,c.y,c.z)}else for(let h=0,p=n.count;h<p;h+=3)r.fromBufferAttribute(n,h+0),s.fromBufferAttribute(n,h+1),o.fromBufferAttribute(n,h+2),f.subVectors(o,s),d.subVectors(r,s),f.cross(d),i.setXYZ(h+0,f.x,f.y,f.z),i.setXYZ(h+1,f.x,f.y,f.z),i.setXYZ(h+2,f.x,f.y,f.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let n=0,i=e.count;n<i;n++)un.fromBufferAttribute(e,n),un.normalize(),e.setXYZ(n,un.x,un.y,un.z)}toNonIndexed(){function e(a,l){let c=a.array,f=a.itemSize,d=a.normalized,h=new c.constructor(l.length*f),p=0,_=0;for(let S=0,m=l.length;S<m;S++){a.isInterleavedBufferAttribute?p=l[S]*a.data.stride+a.offset:p=l[S]*f;for(let u=0;u<f;u++)h[_++]=c[p++]}return new ni(h,f,d)}if(this.index===null)return $e("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new t,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],c=e(l,i);n.setAttribute(a,c)}let s=this.morphAttributes;for(let a in s){let l=[],c=s[a];for(let f=0,d=c.length;f<d;f++){let h=c[f],p=e(h,i);l.push(p)}n.morphAttributes[a]=l}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let n=this.index;n!==null&&(e.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];e.data.attributes[l]=c.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],f=[];for(let d=0,h=c.length;d<h;d++){let p=c[d];f.push(p.toJSON(e.data))}f.length>0&&(r[l]=f,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let c in r){let f=r[c];this.setAttribute(c,f.clone(n))}let s=e.morphAttributes;for(let c in s){let f=[],d=s[c];for(let h=0,p=d.length;h<p;h++)f.push(d[h].clone(n));this.morphAttributes[c]=f}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,f=o.length;c<f;c++){let d=o[c];this.addGroup(d.start,d.count,d.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var Ew=0,as=class extends $i{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Ew++}),this.uuid=Zs(),this.name="",this.type="Material",this.blending=Hs,this.side=Tr,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=eh,this.blendDst=th,this.blendEquation=ss,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new pt(0,0,0),this.blendAlpha=0,this.depthFunc=Gs,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Um,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=zs,this.stencilZFail=zs,this.stencilZPass=zs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let n in e){let i=e[n];if(i===void 0){$e(`Material: parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){$e(`Material: '${n}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";n&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==Hs&&(i.blending=this.blending),this.side!==Tr&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==eh&&(i.blendSrc=this.blendSrc),this.blendDst!==th&&(i.blendDst=this.blendDst),this.blendEquation!==ss&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==Gs&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Um&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==zs&&(i.stencilFail=this.stencilFail),this.stencilZFail!==zs&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==zs&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(n){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let n=e.clippingPlanes,i=null;if(n!==null){let r=n.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=n[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var wr=new N,Mm=new N,Bu=new N,ns=new N,wm=new N,ku=new N,Em=new N,wl=class{constructor(e=new N,n=new N(0,0,-1)){this.origin=e,this.direction=n}set(e,n){return this.origin.copy(e),this.direction.copy(n),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,n){return n.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,wr)),this}closestPointToPoint(e,n){n.subVectors(e,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let n=wr.subVectors(e,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(e):(wr.copy(this.origin).addScaledVector(this.direction,n),wr.distanceToSquared(e))}distanceSqToSegment(e,n,i,r){Mm.copy(e).add(n).multiplyScalar(.5),Bu.copy(n).sub(e).normalize(),ns.copy(this.origin).sub(Mm);let s=e.distanceTo(n)*.5,o=-this.direction.dot(Bu),a=ns.dot(this.direction),l=-ns.dot(Bu),c=ns.lengthSq(),f=Math.abs(1-o*o),d,h,p,_;if(f>0)if(d=o*l-a,h=o*a-l,_=s*f,d>=0)if(h>=-_)if(h<=_){let S=1/f;d*=S,h*=S,p=d*(d+o*h+2*a)+h*(o*d+h+2*l)+c}else h=s,d=Math.max(0,-(o*h+a)),p=-d*d+h*(h+2*l)+c;else h=-s,d=Math.max(0,-(o*h+a)),p=-d*d+h*(h+2*l)+c;else h<=-_?(d=Math.max(0,-(-o*s+a)),h=d>0?-s:Math.min(Math.max(-s,-l),s),p=-d*d+h*(h+2*l)+c):h<=_?(d=0,h=Math.min(Math.max(-s,-l),s),p=h*(h+2*l)+c):(d=Math.max(0,-(o*s+a)),h=d>0?s:Math.min(Math.max(-s,-l),s),p=-d*d+h*(h+2*l)+c);else h=o>0?-s:s,d=Math.max(0,-(o*h+a)),p=-d*d+h*(h+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,d),r&&r.copy(Mm).addScaledVector(Bu,h),p}intersectSphere(e,n){wr.subVectors(e.center,this.origin);let i=wr.dot(this.direction),r=wr.dot(wr)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,n):this.at(a,n)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let n=e.normal.dot(this.direction);if(n===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/n;return i>=0?i:null}intersectPlane(e,n){let i=this.distanceToPlane(e);return i===null?null:this.at(i,n)}intersectsPlane(e){let n=e.distanceToPoint(this.origin);return n===0||e.normal.dot(this.direction)*n<0}intersectBox(e,n){let i,r,s,o,a,l,c=1/this.direction.x,f=1/this.direction.y,d=1/this.direction.z,h=this.origin;return c>=0?(i=(e.min.x-h.x)*c,r=(e.max.x-h.x)*c):(i=(e.max.x-h.x)*c,r=(e.min.x-h.x)*c),f>=0?(s=(e.min.y-h.y)*f,o=(e.max.y-h.y)*f):(s=(e.max.y-h.y)*f,o=(e.min.y-h.y)*f),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),d>=0?(a=(e.min.z-h.z)*d,l=(e.max.z-h.z)*d):(a=(e.max.z-h.z)*d,l=(e.min.z-h.z)*d),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,n)}intersectsBox(e){return this.intersectBox(e,wr)!==null}intersectTriangle(e,n,i,r,s){wm.subVectors(n,e),ku.subVectors(i,e),Em.crossVectors(wm,ku);let o=this.direction.dot(Em),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;ns.subVectors(this.origin,e);let l=a*this.direction.dot(ku.crossVectors(ns,ku));if(l<0)return null;let c=a*this.direction.dot(wm.cross(ns));if(c<0||l+c>o)return null;let f=-a*ns.dot(Em);return f<0?null:this.at(f/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Ji=class extends as{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new pt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ni,this.combine=Km,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},Bx=new bt,Bs=new wl,zu=new Ko,kx=new N,Vu=new N,Hu=new N,Gu=new N,Tm=new N,Wu=new N,zx=new N,Xu=new N,zt=class extends fn{constructor(e=new jt,n=new Ji){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,n){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;n.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){Wu.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let f=a[l],d=s[l];f!==0&&(Tm.fromBufferAttribute(d,e),o?Wu.addScaledVector(Tm,f):Wu.addScaledVector(Tm.sub(n),f))}n.add(Wu)}return n}raycast(e,n){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),zu.copy(i.boundingSphere),zu.applyMatrix4(s),Bs.copy(e.ray).recast(e.near),!(zu.containsPoint(Bs.origin)===!1&&(Bs.intersectSphere(zu,kx)===null||Bs.origin.distanceToSquared(kx)>(e.far-e.near)**2))&&(Bx.copy(s).invert(),Bs.copy(e.ray).applyMatrix4(Bx),!(i.boundingBox!==null&&Bs.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,n,Bs)))}_computeIntersections(e,n,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,f=s.attributes.uv1,d=s.attributes.normal,h=s.groups,p=s.drawRange;if(a!==null)if(Array.isArray(o))for(let _=0,S=h.length;_<S;_++){let m=h[_],u=o[m.materialIndex],g=Math.max(m.start,p.start),v=Math.min(a.count,Math.min(m.start+m.count,p.start+p.count));for(let y=g,A=v;y<A;y+=3){let w=a.getX(y),C=a.getX(y+1),x=a.getX(y+2);r=qu(this,u,e,i,c,f,d,w,C,x),r&&(r.faceIndex=Math.floor(y/3),r.face.materialIndex=m.materialIndex,n.push(r))}}else{let _=Math.max(0,p.start),S=Math.min(a.count,p.start+p.count);for(let m=_,u=S;m<u;m+=3){let g=a.getX(m),v=a.getX(m+1),y=a.getX(m+2);r=qu(this,o,e,i,c,f,d,g,v,y),r&&(r.faceIndex=Math.floor(m/3),n.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let _=0,S=h.length;_<S;_++){let m=h[_],u=o[m.materialIndex],g=Math.max(m.start,p.start),v=Math.min(l.count,Math.min(m.start+m.count,p.start+p.count));for(let y=g,A=v;y<A;y+=3){let w=y,C=y+1,x=y+2;r=qu(this,u,e,i,c,f,d,w,C,x),r&&(r.faceIndex=Math.floor(y/3),r.face.materialIndex=m.materialIndex,n.push(r))}}else{let _=Math.max(0,p.start),S=Math.min(l.count,p.start+p.count);for(let m=_,u=S;m<u;m+=3){let g=m,v=m+1,y=m+2;r=qu(this,o,e,i,c,f,d,g,v,y),r&&(r.faceIndex=Math.floor(m/3),n.push(r))}}}};function Tw(t,e,n,i,r,s,o,a){let l;if(e.side===On?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===Tr,a),l===null)return null;Xu.copy(a),Xu.applyMatrix4(t.matrixWorld);let c=n.ray.origin.distanceTo(Xu);return c<n.near||c>n.far?null:{distance:c,point:Xu.clone(),object:t}}function qu(t,e,n,i,r,s,o,a,l,c){t.getVertexPosition(a,Vu),t.getVertexPosition(l,Hu),t.getVertexPosition(c,Gu);let f=Tw(t,e,n,i,Vu,Hu,Gu,zx);if(f){let d=new N;rs.getBarycoord(zx,Vu,Hu,Gu,d),r&&(f.uv=rs.getInterpolatedAttribute(r,a,l,c,d,new we)),s&&(f.uv1=rs.getInterpolatedAttribute(s,a,l,c,d,new we)),o&&(f.normal=rs.getInterpolatedAttribute(o,a,l,c,d,new N),f.normal.dot(i.direction)>0&&f.normal.multiplyScalar(-1));let h={a,b:l,c,normal:new N,materialIndex:0};rs.getNormal(Vu,Hu,Gu,h.normal),f.face=h,f.barycoord=d}return f}var mh=class extends Fn{constructor(e=null,n=1,i=1,r,s,o,a,l,c=hn,f=hn,d,h){super(null,o,a,l,c,f,r,s,d,h),this.isDataTexture=!0,this.image={data:e,width:n,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var bm=new N,bw=new N,Aw=new it,qi=class{constructor(e=new N(1,0,0),n=0){this.isPlane=!0,this.normal=e,this.constant=n}set(e,n){return this.normal.copy(e),this.constant=n,this}setComponents(e,n,i,r){return this.normal.set(e,n,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,n){return this.normal.copy(e),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(e,n,i){let r=bm.subVectors(i,n).cross(bw.subVectors(e,n)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,n){return n.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,n,i=!0){let r=e.delta(bm),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?n.copy(e.start):null;let o=-(e.start.dot(this.normal)+this.constant)/s;return i===!0&&(o<0||o>1)?null:n.copy(e.start).addScaledVector(r,o)}intersectsLine(e){let n=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return n<0&&i>0||i<0&&n>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,n){let i=n||Aw.getNormalMatrix(e),r=this.coplanarPoint(bm).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},ks=new Ko,Cw=new we(.5,.5),Yu=new N,Jo=class{constructor(e=new qi,n=new qi,i=new qi,r=new qi,s=new qi,o=new qi){this.planes=[e,n,i,r,s,o]}set(e,n,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(n),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,n=Li,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],c=s[3],f=s[4],d=s[5],h=s[6],p=s[7],_=s[8],S=s[9],m=s[10],u=s[11],g=s[12],v=s[13],y=s[14],A=s[15];if(r[0].setComponents(c-o,p-f,u-_,A-g).normalize(),r[1].setComponents(c+o,p+f,u+_,A+g).normalize(),r[2].setComponents(c+a,p+d,u+S,A+v).normalize(),r[3].setComponents(c-a,p-d,u-S,A-v).normalize(),i)r[4].setComponents(l,h,m,y).normalize(),r[5].setComponents(c-l,p-h,u-m,A-y).normalize();else if(r[4].setComponents(c-l,p-h,u-m,A-y).normalize(),n===Li)r[5].setComponents(c+l,p+h,u+m,A+y).normalize();else if(n===Wo)r[5].setComponents(l,h,m,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ks.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let n=e.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),ks.copy(n.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ks)}intersectsSprite(e){ks.center.set(0,0,0);let n=Cw.distanceTo(e.center);return ks.radius=.7071067811865476+n,ks.applyMatrix4(e.matrixWorld),this.intersectsSphere(ks)}intersectsSphere(e){let n=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(n[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let n=this.planes;for(let i=0;i<6;i++){let r=n[i];if(Yu.x=r.normal.x>0?e.max.x:e.min.x,Yu.y=r.normal.y>0?e.max.y:e.min.y,Yu.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(Yu)<0)return!1}return!0}containsPoint(e){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var El=class extends Fn{constructor(e=[],n=fs,i,r,s,o,a,l,c,f){super(e,n,i,r,s,o,a,l,c,f),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},Tl=class extends Fn{constructor(e,n,i,r,s,o,a,l,c){super(e,n,i,r,s,o,a,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}};var br=class extends Fn{constructor(e,n,i=Ui,r,s,o,a=hn,l=hn,c,f=Zi,d=1){if(f!==Zi&&f!==ps)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:n,depth:d};super(h,r,s,o,a,l,f,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new Yo(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let n=super.toJSON(e);return this.compareFunction!==null&&(n.compareFunction=this.compareFunction),n}},gh=class extends br{constructor(e,n=Ui,i=fs,r,s,o=hn,a=hn,l,c=Zi){let f={width:e,height:e,depth:1},d=[f,f,f,f,f,f];super(e,e,n,i,r,s,o,a,l,c),this.image=d,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},bl=class extends Fn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},ls=class t extends jt{constructor(e=1,n=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:n,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],c=[],f=[],d=[],h=0,p=0;_("z","y","x",-1,-1,i,n,e,o,s,0),_("z","y","x",1,-1,i,n,-e,o,s,1),_("x","z","y",1,1,e,i,n,r,o,2),_("x","z","y",1,-1,e,i,-n,r,o,3),_("x","y","z",1,-1,e,n,i,r,s,4),_("x","y","z",-1,-1,e,n,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new St(c,3)),this.setAttribute("normal",new St(f,3)),this.setAttribute("uv",new St(d,2));function _(S,m,u,g,v,y,A,w,C,x,b){let P=y/C,R=A/x,F=y/2,G=A/2,X=w/2,U=C+1,k=x+1,V=0,ne=0,le=new N;for(let me=0;me<k;me++){let Ae=me*R-G;for(let Fe=0;Fe<U;Fe++){let Qe=Fe*P-F;le[S]=Qe*g,le[m]=Ae*v,le[u]=X,c.push(le.x,le.y,le.z),le[S]=0,le[m]=0,le[u]=w>0?1:-1,f.push(le.x,le.y,le.z),d.push(Fe/C),d.push(1-me/x),V+=1}}for(let me=0;me<x;me++)for(let Ae=0;Ae<C;Ae++){let Fe=h+Ae+U*me,Qe=h+Ae+U*(me+1),vt=h+(Ae+1)+U*(me+1),et=h+(Ae+1)+U*me;l.push(Fe,Qe,et),l.push(Qe,vt,et),ne+=6}a.addGroup(p,ne,b),p+=ne,h+=V}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}},Al=class t extends jt{constructor(e=1,n=1,i=4,r=8,s=1){super(),this.type="CapsuleGeometry",this.parameters={radius:e,height:n,capSegments:i,radialSegments:r,heightSegments:s},n=Math.max(0,n),i=Math.max(1,Math.floor(i)),r=Math.max(3,Math.floor(r)),s=Math.max(1,Math.floor(s));let o=[],a=[],l=[],c=[],f=n/2,d=Math.PI/2*e,h=n,p=2*d+h,_=i*2+s,S=r+1,m=new N,u=new N;for(let g=0;g<=_;g++){let v=0,y=0,A=0,w=0;if(g<=i){let b=g/i,P=b*Math.PI/2;y=-f-e*Math.cos(P),A=e*Math.sin(P),w=-e*Math.cos(P),v=b*d}else if(g<=i+s){let b=(g-i)/s;y=-f+b*n,A=e,w=0,v=d+b*h}else{let b=(g-i-s)/i,P=b*Math.PI/2;y=f+e*Math.sin(P),A=e*Math.cos(P),w=e*Math.sin(P),v=d+h+b*d}let C=Math.max(0,Math.min(1,v/p)),x=0;g===0?x=.5/r:g===_&&(x=-.5/r);for(let b=0;b<=r;b++){let P=b/r,R=P*Math.PI*2,F=Math.sin(R),G=Math.cos(R);u.x=-A*G,u.y=y,u.z=A*F,a.push(u.x,u.y,u.z),m.set(-A*G,w,A*F),m.normalize(),l.push(m.x,m.y,m.z),c.push(P+x,C)}if(g>0){let b=(g-1)*S;for(let P=0;P<r;P++){let R=b+P,F=b+P+1,G=g*S+P,X=g*S+P+1;o.push(R,F,G),o.push(F,X,G)}}}this.setIndex(o),this.setAttribute("position",new St(a,3)),this.setAttribute("normal",new St(l,3)),this.setAttribute("uv",new St(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.height,e.capSegments,e.radialSegments,e.heightSegments)}},Cl=class t extends jt{constructor(e=1,n=32,i=0,r=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:n,thetaStart:i,thetaLength:r},n=Math.max(3,n);let s=[],o=[],a=[],l=[],c=new N,f=new we;o.push(0,0,0),a.push(0,0,1),l.push(.5,.5);for(let d=0,h=3;d<=n;d++,h+=3){let p=i+d/n*r;c.x=e*Math.cos(p),c.y=e*Math.sin(p),o.push(c.x,c.y,c.z),a.push(0,0,1),f.x=(o[h]/e+1)/2,f.y=(o[h+1]/e+1)/2,l.push(f.x,f.y)}for(let d=1;d<=n;d++)s.push(d,d+1,0);this.setIndex(s),this.setAttribute("position",new St(o,3)),this.setAttribute("normal",new St(a,3)),this.setAttribute("uv",new St(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.segments,e.thetaStart,e.thetaLength)}},ji=class t extends jt{constructor(e=1,n=1,i=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:n,height:i,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};let c=this;r=Math.floor(r),s=Math.floor(s);let f=[],d=[],h=[],p=[],_=0,S=[],m=i/2,u=0;g(),o===!1&&(e>0&&v(!0),n>0&&v(!1)),this.setIndex(f),this.setAttribute("position",new St(d,3)),this.setAttribute("normal",new St(h,3)),this.setAttribute("uv",new St(p,2));function g(){let y=new N,A=new N,w=0,C=(n-e)/i;for(let x=0;x<=s;x++){let b=[],P=x/s,R=P*(n-e)+e;for(let F=0;F<=r;F++){let G=F/r,X=G*l+a,U=Math.sin(X),k=Math.cos(X);A.x=R*U,A.y=-P*i+m,A.z=R*k,d.push(A.x,A.y,A.z),y.set(U,C,k).normalize(),h.push(y.x,y.y,y.z),p.push(G,1-P),b.push(_++)}S.push(b)}for(let x=0;x<r;x++)for(let b=0;b<s;b++){let P=S[b][x],R=S[b+1][x],F=S[b+1][x+1],G=S[b][x+1];(e>0||b!==0)&&(f.push(P,R,G),w+=3),(n>0||b!==s-1)&&(f.push(R,F,G),w+=3)}c.addGroup(u,w,0),u+=w}function v(y){let A=_,w=new we,C=new N,x=0,b=y===!0?e:n,P=y===!0?1:-1;for(let F=1;F<=r;F++)d.push(0,m*P,0),h.push(0,P,0),p.push(.5,.5),_++;let R=_;for(let F=0;F<=r;F++){let X=F/r*l+a,U=Math.cos(X),k=Math.sin(X);C.x=b*k,C.y=m*P,C.z=b*U,d.push(C.x,C.y,C.z),h.push(0,P,0),w.x=U*.5+.5,w.y=k*.5*P+.5,p.push(w.x,w.y),_++}for(let F=0;F<r;F++){let G=A+F,X=R+F;y===!0?f.push(X,X+1,G):f.push(X+1,X,G),x+=3}c.addGroup(u,x,y===!0?1:2),u+=x}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var ri=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){$e("Curve: .getPoint() not implemented.")}getPointAt(e,n){let i=this.getUtoTmapping(e);return this.getPoint(i,n)}getPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPoint(i/e));return n}getSpacedPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPointAt(i/e));return n}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let n=[],i,r=this.getPoint(0),s=0;n.push(0);for(let o=1;o<=e;o++)i=this.getPoint(o/e),s+=i.distanceTo(r),n.push(s),r=i;return this.cacheArcLengths=n,n}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,n=null){let i=this.getLengths(),r=0,s=i.length,o;n?o=n:o=e*i[s-1];let a=0,l=s-1,c;for(;a<=l;)if(r=Math.floor(a+(l-a)/2),c=i[r]-o,c<0)a=r+1;else if(c>0)l=r-1;else{l=r;break}if(r=l,i[r]===o)return r/(s-1);let f=i[r],h=i[r+1]-f,p=(o-f)/h;return(r+p)/(s-1)}getTangent(e,n){let r=e-1e-4,s=e+1e-4;r<0&&(r=0),s>1&&(s=1);let o=this.getPoint(r),a=this.getPoint(s),l=n||(o.isVector2?new we:new N);return l.copy(a).sub(o).normalize(),l}getTangentAt(e,n){let i=this.getUtoTmapping(e);return this.getTangent(i,n)}computeFrenetFrames(e,n=!1){let i=new N,r=[],s=[],o=[],a=new N,l=new bt;for(let p=0;p<=e;p++){let _=p/e;r[p]=this.getTangentAt(_,new N)}s[0]=new N,o[0]=new N;let c=Number.MAX_VALUE,f=Math.abs(r[0].x),d=Math.abs(r[0].y),h=Math.abs(r[0].z);f<=c&&(c=f,i.set(1,0,0)),d<=c&&(c=d,i.set(0,1,0)),h<=c&&i.set(0,0,1),a.crossVectors(r[0],i).normalize(),s[0].crossVectors(r[0],a),o[0].crossVectors(r[0],s[0]);for(let p=1;p<=e;p++){if(s[p]=s[p-1].clone(),o[p]=o[p-1].clone(),a.crossVectors(r[p-1],r[p]),a.length()>Number.EPSILON){a.normalize();let _=Math.acos(dt(r[p-1].dot(r[p]),-1,1));s[p].applyMatrix4(l.makeRotationAxis(a,_))}o[p].crossVectors(r[p],s[p])}if(n===!0){let p=Math.acos(dt(s[0].dot(s[e]),-1,1));p/=e,r[0].dot(a.crossVectors(s[0],s[e]))>0&&(p=-p);for(let _=1;_<=e;_++)s[_].applyMatrix4(l.makeRotationAxis(r[_],p*_)),o[_].crossVectors(r[_],s[_])}return{tangents:r,normals:s,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},jo=class extends ri{constructor(e=0,n=0,i=1,r=1,s=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=n,this.xRadius=i,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(e,n=new we){let i=n,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,o=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(o?s=0:s=r),this.aClockwise===!0&&!o&&(s===r?s=-r:s=s-r);let a=this.aStartAngle+e*s,l=this.aX+this.xRadius*Math.cos(a),c=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let f=Math.cos(this.aRotation),d=Math.sin(this.aRotation),h=l-this.aX,p=c-this.aY;l=h*f-p*d+this.aX,c=h*d+p*f+this.aY}return i.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},_h=class extends jo{constructor(e,n,i,r,s,o){super(e,n,i,i,r,s,o),this.isArcCurve=!0,this.type="ArcCurve"}};function pg(){let t=0,e=0,n=0,i=0;function r(s,o,a,l){t=s,e=a,n=-3*s+3*o-2*a-l,i=2*s-2*o+a+l}return{initCatmullRom:function(s,o,a,l,c){r(o,a,c*(a-s),c*(l-o))},initNonuniformCatmullRom:function(s,o,a,l,c,f,d){let h=(o-s)/c-(a-s)/(c+f)+(a-o)/f,p=(a-o)/f-(l-o)/(f+d)+(l-a)/d;h*=f,p*=f,r(o,a,h,p)},calc:function(s){let o=s*s,a=o*s;return t+e*s+n*o+i*a}}}var Vx=new N,Hx=new N,Am=new pg,Cm=new pg,Rm=new pg,vh=class extends ri{constructor(e=[],n=!1,i="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=n,this.curveType=i,this.tension=r}getPoint(e,n=new N){let i=n,r=this.points,s=r.length,o=(s-(this.closed?0:1))*e,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/s)+1)*s:l===0&&a===s-1&&(a=s-2,l=1);let c,f;this.closed||a>0?c=r[(a-1)%s]:(Hx.subVectors(r[0],r[1]).add(r[0]),c=Hx);let d=r[a%s],h=r[(a+1)%s];if(this.closed||a+2<s?f=r[(a+2)%s]:(Vx.subVectors(r[s-1],r[s-2]).add(r[s-1]),f=Vx),this.curveType==="centripetal"||this.curveType==="chordal"){let p=this.curveType==="chordal"?.5:.25,_=Math.pow(c.distanceToSquared(d),p),S=Math.pow(d.distanceToSquared(h),p),m=Math.pow(h.distanceToSquared(f),p);S<1e-4&&(S=1),_<1e-4&&(_=S),m<1e-4&&(m=S),Am.initNonuniformCatmullRom(c.x,d.x,h.x,f.x,_,S,m),Cm.initNonuniformCatmullRom(c.y,d.y,h.y,f.y,_,S,m),Rm.initNonuniformCatmullRom(c.z,d.z,h.z,f.z,_,S,m)}else this.curveType==="catmullrom"&&(Am.initCatmullRom(c.x,d.x,h.x,f.x,this.tension),Cm.initCatmullRom(c.y,d.y,h.y,f.y,this.tension),Rm.initCatmullRom(c.z,d.z,h.z,f.z,this.tension));return i.set(Am.calc(l),Cm.calc(l),Rm.calc(l)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new N().fromArray(r))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function Gx(t,e,n,i,r){let s=(i-e)*.5,o=(r-n)*.5,a=t*t,l=t*a;return(2*n-2*i+s+o)*l+(-3*n+3*i-2*s-o)*a+s*t+n}function Rw(t,e){let n=1-t;return n*n*e}function Pw(t,e){return 2*(1-t)*t*e}function Iw(t,e){return t*t*e}function fl(t,e,n,i){return Rw(t,e)+Pw(t,n)+Iw(t,i)}function Lw(t,e){let n=1-t;return n*n*n*e}function Nw(t,e){let n=1-t;return 3*n*n*t*e}function Dw(t,e){return 3*(1-t)*t*t*e}function Uw(t,e){return t*t*t*e}function dl(t,e,n,i,r){return Lw(t,e)+Nw(t,n)+Dw(t,i)+Uw(t,r)}var Rl=class extends ri{constructor(e=new we,n=new we,i=new we,r=new we){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new we){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(dl(e,r.x,s.x,o.x,a.x),dl(e,r.y,s.y,o.y,a.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},xh=class extends ri{constructor(e=new N,n=new N,i=new N,r=new N){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new N){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(dl(e,r.x,s.x,o.x,a.x),dl(e,r.y,s.y,o.y,a.y),dl(e,r.z,s.z,o.z,a.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Pl=class extends ri{constructor(e=new we,n=new we){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=n}getPoint(e,n=new we){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new we){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},yh=class extends ri{constructor(e=new N,n=new N){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=n}getPoint(e,n=new N){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new N){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Il=class extends ri{constructor(e=new we,n=new we,i=new we){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new we){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(fl(e,r.x,s.x,o.x),fl(e,r.y,s.y,o.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Sh=class extends ri{constructor(e=new N,n=new N,i=new N){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new N){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(fl(e,r.x,s.x,o.x),fl(e,r.y,s.y,o.y),fl(e,r.z,s.z,o.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ll=class extends ri{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,n=new we){let i=n,r=this.points,s=(r.length-1)*e,o=Math.floor(s),a=s-o,l=r[o===0?o:o-1],c=r[o],f=r[o>r.length-2?r.length-1:o+1],d=r[o>r.length-3?r.length-1:o+2];return i.set(Gx(a,l.x,c.x,f.x,d.x),Gx(a,l.y,c.y,f.y,d.y)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new we().fromArray(r))}return this}},Om=Object.freeze({__proto__:null,ArcCurve:_h,CatmullRomCurve3:vh,CubicBezierCurve:Rl,CubicBezierCurve3:xh,EllipseCurve:jo,LineCurve:Pl,LineCurve3:yh,QuadraticBezierCurve:Il,QuadraticBezierCurve3:Sh,SplineCurve:Ll}),Mh=class extends ri{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),n=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(n)){let i=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new Om[i](n,e))}return this}getPoint(e,n){let i=e*this.getLength(),r=this.getCurveLengths(),s=0;for(;s<r.length;){if(r[s]>=i){let o=r[s]-i,a=this.curves[s],l=a.getLength(),c=l===0?0:1-o/l;return a.getPointAt(c,n)}s++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],n=0;for(let i=0,r=this.curves.length;i<r;i++)n+=this.curves[i].getLength(),e.push(n);return this.cacheLengths=e,e}getSpacedPoints(e=40){let n=[];for(let i=0;i<=e;i++)n.push(this.getPoint(i/e));return this.autoClose&&n.push(n[0]),n}getPoints(e=12){let n=[],i;for(let r=0,s=this.curves;r<s.length;r++){let o=s[r],a=o.isEllipseCurve?e*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?e*o.points.length:e,l=o.getPoints(a);for(let c=0;c<l.length;c++){let f=l[c];i&&i.equals(f)||(n.push(f),i=f)}}return this.autoClose&&n.length>1&&!n[n.length-1].equals(n[0])&&n.push(n[0]),n}copy(e){super.copy(e),this.curves=[];for(let n=0,i=e.curves.length;n<i;n++){let r=e.curves[n];this.curves.push(r.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let n=0,i=this.curves.length;n<i;n++){let r=this.curves[n];e.curves.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let n=0,i=e.curves.length;n<i;n++){let r=e.curves[n];this.curves.push(new Om[r.type]().fromJSON(r))}return this}},Xs=class extends Mh{constructor(e){super(),this.type="Path",this.currentPoint=new we,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let n=1,i=e.length;n<i;n++)this.lineTo(e[n].x,e[n].y);return this}moveTo(e,n){return this.currentPoint.set(e,n),this}lineTo(e,n){let i=new Pl(this.currentPoint.clone(),new we(e,n));return this.curves.push(i),this.currentPoint.set(e,n),this}quadraticCurveTo(e,n,i,r){let s=new Il(this.currentPoint.clone(),new we(e,n),new we(i,r));return this.curves.push(s),this.currentPoint.set(i,r),this}bezierCurveTo(e,n,i,r,s,o){let a=new Rl(this.currentPoint.clone(),new we(e,n),new we(i,r),new we(s,o));return this.curves.push(a),this.currentPoint.set(s,o),this}splineThru(e){let n=[this.currentPoint.clone()].concat(e),i=new Ll(n);return this.curves.push(i),this.currentPoint.copy(e[e.length-1]),this}arc(e,n,i,r,s,o){let a=this.currentPoint.x,l=this.currentPoint.y;return this.absarc(e+a,n+l,i,r,s,o),this}absarc(e,n,i,r,s,o){return this.absellipse(e,n,i,i,r,s,o),this}ellipse(e,n,i,r,s,o,a,l){let c=this.currentPoint.x,f=this.currentPoint.y;return this.absellipse(e+c,n+f,i,r,s,o,a,l),this}absellipse(e,n,i,r,s,o,a,l){let c=new jo(e,n,i,r,s,o,a,l);if(this.curves.length>0){let d=c.getPoint(0);d.equals(this.currentPoint)||this.lineTo(d.x,d.y)}this.curves.push(c);let f=c.getPoint(1);return this.currentPoint.copy(f),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}},Qo=class extends Xs{constructor(e){super(e),this.uuid=Zs(),this.type="Shape",this.holes=[]}getPointsHoles(e){let n=[];for(let i=0,r=this.holes.length;i<r;i++)n[i]=this.holes[i].getPoints(e);return n}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let n=0,i=e.holes.length;n<i;n++){let r=e.holes[n];this.holes.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let n=0,i=this.holes.length;n<i;n++){let r=this.holes[n];e.holes.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let n=0,i=e.holes.length;n<i;n++){let r=e.holes[n];this.holes.push(new Xs().fromJSON(r))}return this}};function Fw(t,e,n=2){let i=e&&e.length,r=i?e[0]*n:t.length,s=Fy(t,0,r,n,!0),o=[];if(!s||s.next===s.prev)return o;let a,l,c;if(i&&(s=Vw(t,e,s,n)),t.length>80*n){a=t[0],l=t[1];let f=a,d=l;for(let h=n;h<r;h+=n){let p=t[h],_=t[h+1];p<a&&(a=p),_<l&&(l=_),p>f&&(f=p),_>d&&(d=_)}c=Math.max(f-a,d-l),c=c!==0?32767/c:0}return Nl(s,o,n,a,l,c,0),o}function Fy(t,e,n,i,r){let s;if(r===jw(t,e,n,i)>0)for(let o=e;o<n;o+=i)s=Wx(o/i|0,t[o],t[o+1],s);else for(let o=n-i;o>=e;o-=i)s=Wx(o/i|0,t[o],t[o+1],s);return s&&ea(s,s.next)&&(Ul(s),s=s.next),s}function qs(t,e){if(!t)return t;e||(e=t);let n=t,i;do if(i=!1,!n.steiner&&(ea(n,n.next)||Xt(n.prev,n,n.next)===0)){if(Ul(n),n=e=n.prev,n===n.next)break;i=!0}else n=n.next;while(i||n!==e);return e}function Nl(t,e,n,i,r,s,o){if(!t)return;!o&&s&&qw(t,i,r,s);let a=t;for(;t.prev!==t.next;){let l=t.prev,c=t.next;if(s?Bw(t,i,r,s):Ow(t)){e.push(l.i,t.i,c.i),Ul(t),t=c.next,a=c.next;continue}if(t=c,t===a){o?o===1?(t=kw(qs(t),e),Nl(t,e,n,i,r,s,2)):o===2&&zw(t,e,n,i,r,s):Nl(qs(t),e,n,i,r,s,1);break}}}function Ow(t){let e=t.prev,n=t,i=t.next;if(Xt(e,n,i)>=0)return!1;let r=e.x,s=n.x,o=i.x,a=e.y,l=n.y,c=i.y,f=Math.min(r,s,o),d=Math.min(a,l,c),h=Math.max(r,s,o),p=Math.max(a,l,c),_=i.next;for(;_!==e;){if(_.x>=f&&_.x<=h&&_.y>=d&&_.y<=p&&cl(r,a,s,l,o,c,_.x,_.y)&&Xt(_.prev,_,_.next)>=0)return!1;_=_.next}return!0}function Bw(t,e,n,i){let r=t.prev,s=t,o=t.next;if(Xt(r,s,o)>=0)return!1;let a=r.x,l=s.x,c=o.x,f=r.y,d=s.y,h=o.y,p=Math.min(a,l,c),_=Math.min(f,d,h),S=Math.max(a,l,c),m=Math.max(f,d,h),u=Bm(p,_,e,n,i),g=Bm(S,m,e,n,i),v=t.prevZ,y=t.nextZ;for(;v&&v.z>=u&&y&&y.z<=g;){if(v.x>=p&&v.x<=S&&v.y>=_&&v.y<=m&&v!==r&&v!==o&&cl(a,f,l,d,c,h,v.x,v.y)&&Xt(v.prev,v,v.next)>=0||(v=v.prevZ,y.x>=p&&y.x<=S&&y.y>=_&&y.y<=m&&y!==r&&y!==o&&cl(a,f,l,d,c,h,y.x,y.y)&&Xt(y.prev,y,y.next)>=0))return!1;y=y.nextZ}for(;v&&v.z>=u;){if(v.x>=p&&v.x<=S&&v.y>=_&&v.y<=m&&v!==r&&v!==o&&cl(a,f,l,d,c,h,v.x,v.y)&&Xt(v.prev,v,v.next)>=0)return!1;v=v.prevZ}for(;y&&y.z<=g;){if(y.x>=p&&y.x<=S&&y.y>=_&&y.y<=m&&y!==r&&y!==o&&cl(a,f,l,d,c,h,y.x,y.y)&&Xt(y.prev,y,y.next)>=0)return!1;y=y.nextZ}return!0}function kw(t,e){let n=t;do{let i=n.prev,r=n.next.next;!ea(i,r)&&By(i,n,n.next,r)&&Dl(i,r)&&Dl(r,i)&&(e.push(i.i,n.i,r.i),Ul(n),Ul(n.next),n=t=r),n=n.next}while(n!==t);return qs(n)}function zw(t,e,n,i,r,s){let o=t;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&$w(o,a)){let l=ky(o,a);o=qs(o,o.next),l=qs(l,l.next),Nl(o,e,n,i,r,s,0),Nl(l,e,n,i,r,s,0);return}a=a.next}o=o.next}while(o!==t)}function Vw(t,e,n,i){let r=[];for(let s=0,o=e.length;s<o;s++){let a=e[s]*i,l=s<o-1?e[s+1]*i:t.length,c=Fy(t,a,l,i,!1);c===c.next&&(c.steiner=!0),r.push(Zw(c))}r.sort(Hw);for(let s=0;s<r.length;s++)n=Gw(r[s],n);return n}function Hw(t,e){let n=t.x-e.x;if(n===0&&(n=t.y-e.y,n===0)){let i=(t.next.y-t.y)/(t.next.x-t.x),r=(e.next.y-e.y)/(e.next.x-e.x);n=i-r}return n}function Gw(t,e){let n=Ww(t,e);if(!n)return e;let i=ky(n,t);return qs(i,i.next),qs(n,n.next)}function Ww(t,e){let n=e,i=t.x,r=t.y,s=-1/0,o;if(ea(t,n))return n;do{if(ea(t,n.next))return n.next;if(r<=n.y&&r>=n.next.y&&n.next.y!==n.y){let d=n.x+(r-n.y)*(n.next.x-n.x)/(n.next.y-n.y);if(d<=i&&d>s&&(s=d,o=n.x<n.next.x?n:n.next,d===i))return o}n=n.next}while(n!==e);if(!o)return null;let a=o,l=o.x,c=o.y,f=1/0;n=o;do{if(i>=n.x&&n.x>=l&&i!==n.x&&Oy(r<c?i:s,r,l,c,r<c?s:i,r,n.x,n.y)){let d=Math.abs(r-n.y)/(i-n.x);Dl(n,t)&&(d<f||d===f&&(n.x>o.x||n.x===o.x&&Xw(o,n)))&&(o=n,f=d)}n=n.next}while(n!==a);return o}function Xw(t,e){return Xt(t.prev,t,e.prev)<0&&Xt(e.next,t,t.next)<0}function qw(t,e,n,i){let r=t;do r.z===0&&(r.z=Bm(r.x,r.y,e,n,i)),r.prevZ=r.prev,r.nextZ=r.next,r=r.next;while(r!==t);r.prevZ.nextZ=null,r.prevZ=null,Yw(r)}function Yw(t){let e,n=1;do{let i=t,r;t=null;let s=null;for(e=0;i;){e++;let o=i,a=0;for(let c=0;c<n&&(a++,o=o.nextZ,!!o);c++);let l=n;for(;a>0||l>0&&o;)a!==0&&(l===0||!o||i.z<=o.z)?(r=i,i=i.nextZ,a--):(r=o,o=o.nextZ,l--),s?s.nextZ=r:t=r,r.prevZ=s,s=r;i=o}s.nextZ=null,n*=2}while(e>1);return t}function Bm(t,e,n,i,r){return t=(t-n)*r|0,e=(e-i)*r|0,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,t|e<<1}function Zw(t){let e=t,n=t;do(e.x<n.x||e.x===n.x&&e.y<n.y)&&(n=e),e=e.next;while(e!==t);return n}function Oy(t,e,n,i,r,s,o,a){return(r-o)*(e-a)>=(t-o)*(s-a)&&(t-o)*(i-a)>=(n-o)*(e-a)&&(n-o)*(s-a)>=(r-o)*(i-a)}function cl(t,e,n,i,r,s,o,a){return!(t===o&&e===a)&&Oy(t,e,n,i,r,s,o,a)}function $w(t,e){return t.next.i!==e.i&&t.prev.i!==e.i&&!Kw(t,e)&&(Dl(t,e)&&Dl(e,t)&&Jw(t,e)&&(Xt(t.prev,t,e.prev)||Xt(t,e.prev,e))||ea(t,e)&&Xt(t.prev,t,t.next)>0&&Xt(e.prev,e,e.next)>0)}function Xt(t,e,n){return(e.y-t.y)*(n.x-e.x)-(e.x-t.x)*(n.y-e.y)}function ea(t,e){return t.x===e.x&&t.y===e.y}function By(t,e,n,i){let r=$u(Xt(t,e,n)),s=$u(Xt(t,e,i)),o=$u(Xt(n,i,t)),a=$u(Xt(n,i,e));return!!(r!==s&&o!==a||r===0&&Zu(t,n,e)||s===0&&Zu(t,i,e)||o===0&&Zu(n,t,i)||a===0&&Zu(n,e,i))}function Zu(t,e,n){return e.x<=Math.max(t.x,n.x)&&e.x>=Math.min(t.x,n.x)&&e.y<=Math.max(t.y,n.y)&&e.y>=Math.min(t.y,n.y)}function $u(t){return t>0?1:t<0?-1:0}function Kw(t,e){let n=t;do{if(n.i!==t.i&&n.next.i!==t.i&&n.i!==e.i&&n.next.i!==e.i&&By(n,n.next,t,e))return!0;n=n.next}while(n!==t);return!1}function Dl(t,e){return Xt(t.prev,t,t.next)<0?Xt(t,e,t.next)>=0&&Xt(t,t.prev,e)>=0:Xt(t,e,t.prev)<0||Xt(t,t.next,e)<0}function Jw(t,e){let n=t,i=!1,r=(t.x+e.x)/2,s=(t.y+e.y)/2;do n.y>s!=n.next.y>s&&n.next.y!==n.y&&r<(n.next.x-n.x)*(s-n.y)/(n.next.y-n.y)+n.x&&(i=!i),n=n.next;while(n!==t);return i}function ky(t,e){let n=km(t.i,t.x,t.y),i=km(e.i,e.x,e.y),r=t.next,s=e.prev;return t.next=e,e.prev=t,n.next=r,r.prev=n,i.next=n,n.prev=i,s.next=i,i.prev=s,i}function Wx(t,e,n,i){let r=km(t,e,n);return i?(r.next=i.next,r.prev=i,i.next.prev=r,i.next=r):(r.prev=r,r.next=r),r}function Ul(t){t.next.prev=t.prev,t.prev.next=t.next,t.prevZ&&(t.prevZ.nextZ=t.nextZ),t.nextZ&&(t.nextZ.prevZ=t.prevZ)}function km(t,e,n){return{i:t,x:e,y:n,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function jw(t,e,n,i){let r=0;for(let s=e,o=n-i;s<n;s+=i)r+=(t[o]-t[s])*(t[s+1]+t[o+1]),o=s;return r}var zm=class{static triangulate(e,n,i=2){return Fw(e,n,i)}},Vs=class t{static area(e){let n=e.length,i=0;for(let r=n-1,s=0;s<n;r=s++)i+=e[r].x*e[s].y-e[s].x*e[r].y;return i*.5}static isClockWise(e){return t.area(e)<0}static triangulateShape(e,n){let i=[],r=[],s=[];Xx(e),qx(i,e);let o=e.length;n.forEach(Xx);for(let l=0;l<n.length;l++)r.push(o),o+=n[l].length,qx(i,n[l]);let a=zm.triangulate(i,r);for(let l=0;l<a.length;l+=3)s.push(a.slice(l,l+3));return s}};function Xx(t){let e=t.length;e>2&&t[e-1].equals(t[0])&&t.pop()}function qx(t,e){for(let n=0;n<e.length;n++)t.push(e[n].x),t.push(e[n].y)}var Fl=class t extends jt{constructor(e=new Qo([new we(.5,.5),new we(-.5,.5),new we(-.5,-.5),new we(.5,-.5)]),n={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:e,options:n},e=Array.isArray(e)?e:[e];let i=this,r=[],s=[];for(let a=0,l=e.length;a<l;a++){let c=e[a];o(c)}this.setAttribute("position",new St(r,3)),this.setAttribute("uv",new St(s,2)),this.computeVertexNormals();function o(a){let l=[],c=n.curveSegments!==void 0?n.curveSegments:12,f=n.steps!==void 0?n.steps:1,d=n.depth!==void 0?n.depth:1,h=n.bevelEnabled!==void 0?n.bevelEnabled:!0,p=n.bevelThickness!==void 0?n.bevelThickness:.2,_=n.bevelSize!==void 0?n.bevelSize:p-.1,S=n.bevelOffset!==void 0?n.bevelOffset:0,m=n.bevelSegments!==void 0?n.bevelSegments:3,u=n.extrudePath,g=n.UVGenerator!==void 0?n.UVGenerator:Qw,v,y=!1,A,w,C,x;if(u){v=u.getSpacedPoints(f),y=!0,h=!1;let ie=u.isCatmullRomCurve3?u.closed:!1;A=u.computeFrenetFrames(f,ie),w=new N,C=new N,x=new N}h||(m=0,p=0,_=0,S=0);let b=a.extractPoints(c),P=b.shape,R=b.holes;if(!Vs.isClockWise(P)){P=P.reverse();for(let ie=0,re=R.length;ie<re;ie++){let J=R[ie];Vs.isClockWise(J)&&(R[ie]=J.reverse())}}function G(ie){let J=10000000000000001e-36,ye=ie[0];for(let ve=1;ve<=ie.length;ve++){let Xe=ve%ie.length,L=ie[Xe],je=L.x-ye.x,Oe=L.y-ye.y,Ke=je*je+Oe*Oe,he=Math.max(Math.abs(L.x),Math.abs(L.y),Math.abs(ye.x),Math.abs(ye.y)),yt=J*he*he;if(Ke<=yt){ie.splice(Xe,1),ve--;continue}ye=L}}G(P),R.forEach(G);let X=R.length,U=P;for(let ie=0;ie<X;ie++){let re=R[ie];P=P.concat(re)}function k(ie,re,J){return re||Je("ExtrudeGeometry: vec does not exist"),ie.clone().addScaledVector(re,J)}let V=P.length;function ne(ie,re,J){let ye,ve,Xe,L=ie.x-re.x,je=ie.y-re.y,Oe=J.x-ie.x,Ke=J.y-ie.y,he=L*L+je*je,yt=L*Ke-je*Oe;if(Math.abs(yt)>Number.EPSILON){let T=Math.sqrt(he),M=Math.sqrt(Oe*Oe+Ke*Ke),B=re.x-je/T,$=re.y+L/T,se=J.x-Ke/M,de=J.y+Oe/M,pe=((se-B)*Ke-(de-$)*Oe)/(L*Ke-je*Oe);ye=B+L*pe-ie.x,ve=$+je*pe-ie.y;let Y=ye*ye+ve*ve;if(Y<=2)return new we(ye,ve);Xe=Math.sqrt(Y/2)}else{let T=!1;L>Number.EPSILON?Oe>Number.EPSILON&&(T=!0):L<-Number.EPSILON?Oe<-Number.EPSILON&&(T=!0):Math.sign(je)===Math.sign(Ke)&&(T=!0),T?(ye=-je,ve=L,Xe=Math.sqrt(he)):(ye=L,ve=je,Xe=Math.sqrt(he/2))}return new we(ye/Xe,ve/Xe)}let le=[];for(let ie=0,re=U.length,J=re-1,ye=ie+1;ie<re;ie++,J++,ye++)J===re&&(J=0),ye===re&&(ye=0),le[ie]=ne(U[ie],U[J],U[ye]);let me=[],Ae,Fe=le.concat();for(let ie=0,re=X;ie<re;ie++){let J=R[ie];Ae=[];for(let ye=0,ve=J.length,Xe=ve-1,L=ye+1;ye<ve;ye++,Xe++,L++)Xe===ve&&(Xe=0),L===ve&&(L=0),Ae[ye]=ne(J[ye],J[Xe],J[L]);me.push(Ae),Fe=Fe.concat(Ae)}let Qe;if(m===0)Qe=Vs.triangulateShape(U,R);else{let ie=[],re=[];for(let J=0;J<m;J++){let ye=J/m,ve=p*Math.cos(ye*Math.PI/2),Xe=_*Math.sin(ye*Math.PI/2)+S;for(let L=0,je=U.length;L<je;L++){let Oe=k(U[L],le[L],Xe);Be(Oe.x,Oe.y,-ve),ye===0&&ie.push(Oe)}for(let L=0,je=X;L<je;L++){let Oe=R[L];Ae=me[L];let Ke=[];for(let he=0,yt=Oe.length;he<yt;he++){let T=k(Oe[he],Ae[he],Xe);Be(T.x,T.y,-ve),ye===0&&Ke.push(T)}ye===0&&re.push(Ke)}}Qe=Vs.triangulateShape(ie,re)}let vt=Qe.length,et=_+S;for(let ie=0;ie<V;ie++){let re=h?k(P[ie],Fe[ie],et):P[ie];y?(C.copy(A.normals[0]).multiplyScalar(re.x),w.copy(A.binormals[0]).multiplyScalar(re.y),x.copy(v[0]).add(C).add(w),Be(x.x,x.y,x.z)):Be(re.x,re.y,0)}for(let ie=1;ie<=f;ie++)for(let re=0;re<V;re++){let J=h?k(P[re],Fe[re],et):P[re];y?(C.copy(A.normals[ie]).multiplyScalar(J.x),w.copy(A.binormals[ie]).multiplyScalar(J.y),x.copy(v[ie]).add(C).add(w),Be(x.x,x.y,x.z)):Be(J.x,J.y,d/f*ie)}for(let ie=m-1;ie>=0;ie--){let re=ie/m,J=p*Math.cos(re*Math.PI/2),ye=_*Math.sin(re*Math.PI/2)+S;for(let ve=0,Xe=U.length;ve<Xe;ve++){let L=k(U[ve],le[ve],ye);Be(L.x,L.y,d+J)}for(let ve=0,Xe=R.length;ve<Xe;ve++){let L=R[ve];Ae=me[ve];for(let je=0,Oe=L.length;je<Oe;je++){let Ke=k(L[je],Ae[je],ye);y?Be(Ke.x,Ke.y+v[f-1].y,v[f-1].x+J):Be(Ke.x,Ke.y,d+J)}}}Q(),xe();function Q(){let ie=r.length/3;if(h){let re=0,J=V*re;for(let ye=0;ye<vt;ye++){let ve=Qe[ye];qe(ve[2]+J,ve[1]+J,ve[0]+J)}re=f+m*2,J=V*re;for(let ye=0;ye<vt;ye++){let ve=Qe[ye];qe(ve[0]+J,ve[1]+J,ve[2]+J)}}else{for(let re=0;re<vt;re++){let J=Qe[re];qe(J[2],J[1],J[0])}for(let re=0;re<vt;re++){let J=Qe[re];qe(J[0]+V*f,J[1]+V*f,J[2]+V*f)}}i.addGroup(ie,r.length/3-ie,0)}function xe(){let ie=r.length/3,re=0;ce(U,re),re+=U.length;for(let J=0,ye=R.length;J<ye;J++){let ve=R[J];ce(ve,re),re+=ve.length}i.addGroup(ie,r.length/3-ie,1)}function ce(ie,re){let J=ie.length;for(;--J>=0;){let ye=J,ve=J-1;ve<0&&(ve=ie.length-1);for(let Xe=0,L=f+m*2;Xe<L;Xe++){let je=V*Xe,Oe=V*(Xe+1),Ke=re+ye+je,he=re+ve+je,yt=re+ve+Oe,T=re+ye+Oe;Ye(Ke,he,yt,T)}}}function Be(ie,re,J){l.push(ie),l.push(re),l.push(J)}function qe(ie,re,J){ht(ie),ht(re),ht(J);let ye=r.length/3,ve=g.generateTopUV(i,r,ye-3,ye-2,ye-1);Le(ve[0]),Le(ve[1]),Le(ve[2])}function Ye(ie,re,J,ye){ht(ie),ht(re),ht(ye),ht(re),ht(J),ht(ye);let ve=r.length/3,Xe=g.generateSideWallUV(i,r,ve-6,ve-3,ve-2,ve-1);Le(Xe[0]),Le(Xe[1]),Le(Xe[3]),Le(Xe[1]),Le(Xe[2]),Le(Xe[3])}function ht(ie){r.push(l[ie*3+0]),r.push(l[ie*3+1]),r.push(l[ie*3+2])}function Le(ie){s.push(ie.x),s.push(ie.y)}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),n=this.parameters.shapes,i=this.parameters.options;return eE(n,i,e)}static fromJSON(e,n){let i=[];for(let s=0,o=e.shapes.length;s<o;s++){let a=n[e.shapes[s]];i.push(a)}let r=e.options.extrudePath;return r!==void 0&&(e.options.extrudePath=new Om[r.type]().fromJSON(r)),new t(i,e.options)}},Qw={generateTopUV:function(t,e,n,i,r){let s=e[n*3],o=e[n*3+1],a=e[i*3],l=e[i*3+1],c=e[r*3],f=e[r*3+1];return[new we(s,o),new we(a,l),new we(c,f)]},generateSideWallUV:function(t,e,n,i,r,s){let o=e[n*3],a=e[n*3+1],l=e[n*3+2],c=e[i*3],f=e[i*3+1],d=e[i*3+2],h=e[r*3],p=e[r*3+1],_=e[r*3+2],S=e[s*3],m=e[s*3+1],u=e[s*3+2];return Math.abs(a-f)<Math.abs(o-c)?[new we(o,1-l),new we(c,1-d),new we(h,1-_),new we(S,1-u)]:[new we(a,1-l),new we(f,1-d),new we(p,1-_),new we(m,1-u)]}};function eE(t,e,n){if(n.shapes=[],Array.isArray(t))for(let i=0,r=t.length;i<r;i++){let s=t[i];n.shapes.push(s.uuid)}else n.shapes.push(t.uuid);return n.options=Object.assign({},e),e.extrudePath!==void 0&&(n.options.extrudePath=e.extrudePath.toJSON()),n}var Qi=class t extends jt{constructor(e=1,n=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:n,widthSegments:i,heightSegments:r};let s=e/2,o=n/2,a=Math.floor(i),l=Math.floor(r),c=a+1,f=l+1,d=e/a,h=n/l,p=[],_=[],S=[],m=[];for(let u=0;u<f;u++){let g=u*h-o;for(let v=0;v<c;v++){let y=v*d-s;_.push(y,-g,0),S.push(0,0,1),m.push(v/a),m.push(1-u/l)}}for(let u=0;u<l;u++)for(let g=0;g<a;g++){let v=g+c*u,y=g+c*(u+1),A=g+1+c*(u+1),w=g+1+c*u;p.push(v,y,w),p.push(y,A,w)}this.setIndex(p),this.setAttribute("position",new St(_,3)),this.setAttribute("normal",new St(S,3)),this.setAttribute("uv",new St(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.widthSegments,e.heightSegments)}};var ta=class t extends jt{constructor(e=1,n=32,i=16,r=0,s=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:n,heightSegments:i,phiStart:r,phiLength:s,thetaStart:o,thetaLength:a},n=Math.max(3,Math.floor(n)),i=Math.max(2,Math.floor(i));let l=Math.min(o+a,Math.PI),c=0,f=[],d=new N,h=new N,p=[],_=[],S=[],m=[];for(let u=0;u<=i;u++){let g=[],v=u/i,y=0;u===0&&o===0?y=.5/n:u===i&&l===Math.PI&&(y=-.5/n);for(let A=0;A<=n;A++){let w=A/n;d.x=-e*Math.cos(r+w*s)*Math.sin(o+v*a),d.y=e*Math.cos(o+v*a),d.z=e*Math.sin(r+w*s)*Math.sin(o+v*a),_.push(d.x,d.y,d.z),h.copy(d).normalize(),S.push(h.x,h.y,h.z),m.push(w+y,1-v),g.push(c++)}f.push(g)}for(let u=0;u<i;u++)for(let g=0;g<n;g++){let v=f[u][g+1],y=f[u][g],A=f[u+1][g],w=f[u+1][g+1];(u!==0||o>0)&&p.push(v,y,w),(u!==i-1||l<Math.PI)&&p.push(y,A,w)}this.setIndex(p),this.setAttribute("position",new St(_,3)),this.setAttribute("normal",new St(S,3)),this.setAttribute("uv",new St(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var Ol=class t extends jt{constructor(e=1,n=.4,i=12,r=48,s=Math.PI*2,o=0,a=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:n,radialSegments:i,tubularSegments:r,arc:s,thetaStart:o,thetaLength:a},i=Math.floor(i),r=Math.floor(r);let l=[],c=[],f=[],d=[],h=new N,p=new N,_=new N;for(let S=0;S<=i;S++){let m=o+S/i*a;for(let u=0;u<=r;u++){let g=u/r*s;p.x=(e+n*Math.cos(m))*Math.cos(g),p.y=(e+n*Math.cos(m))*Math.sin(g),p.z=n*Math.sin(m),c.push(p.x,p.y,p.z),h.x=e*Math.cos(g),h.y=e*Math.sin(g),_.subVectors(p,h).normalize(),f.push(_.x,_.y,_.z),d.push(u/r),d.push(S/i)}}for(let S=1;S<=i;S++)for(let m=1;m<=r;m++){let u=(r+1)*S+m-1,g=(r+1)*(S-1)+m-1,v=(r+1)*(S-1)+m,y=(r+1)*S+m;l.push(u,g,y),l.push(g,v,y)}this.setIndex(l),this.setAttribute("position",new St(c,3)),this.setAttribute("normal",new St(f,3)),this.setAttribute("uv",new St(d,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}};function Ks(t){let e={};for(let n in t){e[n]={};for(let i in t[n]){let r=t[n][i];if(Yx(r))r.isRenderTargetTexture?($e("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[n][i]=null):e[n][i]=r.clone();else if(Array.isArray(r))if(Yx(r[0])){let s=[];for(let o=0,a=r.length;o<a;o++)s[o]=r[o].clone();e[n][i]=s}else e[n][i]=r.slice();else e[n][i]=r}}return e}function bn(t){let e={};for(let n=0;n<t.length;n++){let i=Ks(t[n]);for(let r in i)e[r]=i[r]}return e}function Yx(t){return t&&(t.isColor||t.isMatrix3||t.isMatrix4||t.isVector2||t.isVector3||t.isVector4||t.isTexture||t.isQuaternion)}function tE(t){let e=[];for(let n=0;n<t.length;n++)e.push(t[n].clone());return e}function mg(t){let e=t.getRenderTarget();return e===null?t.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:xt.workingColorSpace}var zy={clone:Ks,merge:bn},nE=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,iE=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,si=class extends as{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=nE,this.fragmentShader=iE,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Ks(e.uniforms),this.uniformsGroups=tE(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let n=super.toJSON(e);n.glslVersion=this.glslVersion,n.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?n.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?n.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?n.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?n.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?n.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?n.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?n.uniforms[r]={type:"m4",value:o.toArray()}:n.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}},wh=class extends si{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},Bl=class extends as{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new pt(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new pt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Af,this.normalScale=new we(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ni,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var Eh=class extends as{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=wy,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Th=class extends as{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function Ku(t,e){return!t||t.constructor===e?t:typeof e.BYTES_PER_ELEMENT=="number"?new e(t):Array.prototype.slice.call(t)}var cs=class{constructor(e,n,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let n=this.parameterPositions,i=this._cachedIndex,r=n[i],s=n[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=n[++i],e<r)break t}o=n.length;break n}if(!(e>=s)){let a=n[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=n[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<n[a]?o=a:i=a+1}if(r=n[i],s=n[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let n=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)n[o]=i[s+o];return n}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},bh=class extends cs{constructor(e,n,i,r){super(e,n,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Lm,endingEnd:Lm}}intervalChanged_(e,n,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case Nm:s=e,a=2*n-i;break;case Dm:s=r.length-2,a=n+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case Nm:o=e,l=2*i-n;break;case Dm:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=n}let c=(i-n)*.5,f=this.valueSize;this._weightPrev=c/(n-a),this._weightNext=c/(l-i),this._offsetPrev=s*f,this._offsetNext=o*f}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,f=this._offsetPrev,d=this._offsetNext,h=this._weightPrev,p=this._weightNext,_=(i-n)/(r-n),S=_*_,m=S*_,u=-h*m+2*h*S-h*_,g=(1+h)*m+(-1.5-2*h)*S+(-.5+h)*_+1,v=(-1-p)*m+(1.5+p)*S+.5*_,y=p*m-p*S;for(let A=0;A!==a;++A)s[A]=u*o[f+A]+g*o[c+A]+v*o[l+A]+y*o[d+A];return s}},Ah=class extends cs{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,f=(i-n)/(r-n),d=1-f;for(let h=0;h!==a;++h)s[h]=o[c+h]*d+o[l+h]*f;return s}},Ch=class extends cs{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},Rh=class extends cs{interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,f=this.settings||this.DefaultSettings_,d=f.inTangents,h=f.outTangents;if(!d||!h){let S=(i-n)/(r-n),m=1-S;for(let u=0;u!==a;++u)s[u]=o[c+u]*m+o[l+u]*S;return s}let p=a*2,_=e-1;for(let S=0;S!==a;++S){let m=o[c+S],u=o[l+S],g=_*p+S*2,v=h[g],y=h[g+1],A=e*p+S*2,w=d[A],C=d[A+1],x=(i-n)/(r-n),b,P,R,F,G;for(let X=0;X<8;X++){b=x*x,P=b*x,R=1-x,F=R*R,G=F*R;let k=G*n+3*F*x*v+3*R*b*w+P*r-i;if(Math.abs(k)<1e-10)break;let V=3*F*(v-n)+6*R*x*(w-v)+3*b*(r-w);if(Math.abs(V)<1e-10)break;x=x-k/V,x=Math.max(0,Math.min(1,x))}s[S]=G*m+3*F*x*y+3*R*b*C+P*u}return s}},oi=class{constructor(e,n,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Ku(n,this.TimeBufferType),this.values=Ku(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let n=e.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(e);else{i={name:e.name,times:Ku(e.times,Array),values:Ku(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new Ch(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Ah(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new bh(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let n=new Rh(this.times,this.values,this.getValueSize(),e);return this.settings&&(n.settings=this.settings),n}setInterpolation(e){let n;switch(e){case pl:n=this.InterpolantFactoryMethodDiscrete;break;case uh:n=this.InterpolantFactoryMethodLinear;break;case Qu:n=this.InterpolantFactoryMethodSmooth;break;case Im:n=this.InterpolantFactoryMethodBezier;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return $e("KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return pl;case this.InterpolantFactoryMethodLinear:return uh;case this.InterpolantFactoryMethodSmooth:return Qu;case this.InterpolantFactoryMethodBezier:return Im}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]+=e}return this}scale(e){if(e!==1){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]*=e}return this}trim(e,n){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>n;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(Je("KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(Je("KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){Je("KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){Je("KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&Z1(r))for(let a=0,l=r.length;a!==l;++a){let c=r[a];if(isNaN(c)){Je("KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===Qu,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,c=e[a],f=e[a+1];if(c!==f&&(a!==1||c!==e[0]))if(r)l=!0;else{let d=a*i,h=d-i,p=d+i;for(let _=0;_!==i;++_){let S=n[d+_];if(S!==n[h+_]||S!==n[p+_]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let d=a*i,h=o*i;for(let p=0;p!==i;++p)n[h+p]=n[d+p]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,c=0;c!==i;++c)n[l+c]=n[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=n.slice(0,o*i)):(this.times=e,this.values=n),this}clone(){let e=this.times.slice(),n=this.values.slice(),i=this.constructor,r=new i(this.name,e,n);return r.createInterpolant=this.createInterpolant,r}};oi.prototype.ValueTypeName="";oi.prototype.TimeBufferType=Float32Array;oi.prototype.ValueBufferType=Float32Array;oi.prototype.DefaultInterpolation=uh;var us=class extends oi{constructor(e,n,i){super(e,n,i)}};us.prototype.ValueTypeName="bool";us.prototype.ValueBufferType=Array;us.prototype.DefaultInterpolation=pl;us.prototype.InterpolantFactoryMethodLinear=void 0;us.prototype.InterpolantFactoryMethodSmooth=void 0;var Ph=class extends oi{constructor(e,n,i,r){super(e,n,i,r)}};Ph.prototype.ValueTypeName="color";var Ih=class extends oi{constructor(e,n,i,r){super(e,n,i,r)}};Ih.prototype.ValueTypeName="number";var Lh=class extends cs{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-n)/(r-n),c=e*a;for(let f=c+a;c!==f;c+=4)Ki.slerpFlat(s,0,o,c-a,o,c,l);return s}},kl=class extends oi{constructor(e,n,i,r){super(e,n,i,r)}InterpolantFactoryMethodLinear(e){return new Lh(this.times,this.values,this.getValueSize(),e)}};kl.prototype.ValueTypeName="quaternion";kl.prototype.InterpolantFactoryMethodSmooth=void 0;var hs=class extends oi{constructor(e,n,i){super(e,n,i)}};hs.prototype.ValueTypeName="string";hs.prototype.ValueBufferType=Array;hs.prototype.DefaultInterpolation=pl;hs.prototype.InterpolantFactoryMethodLinear=void 0;hs.prototype.InterpolantFactoryMethodSmooth=void 0;var Nh=class extends oi{constructor(e,n,i,r){super(e,n,i,r)}};Nh.prototype.ValueTypeName="vector";var Dh=class{constructor(e,n,i){let r=this,s=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=n,this.onError=i,this._abortController=null,this.itemStart=function(f){a++,s===!1&&r.onStart!==void 0&&r.onStart(f,o,a),s=!0},this.itemEnd=function(f){o++,r.onProgress!==void 0&&r.onProgress(f,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(f){r.onError!==void 0&&r.onError(f)},this.resolveURL=function(f){return l?l(f):f},this.setURLModifier=function(f){return l=f,this},this.addHandler=function(f,d){return c.push(f,d),this},this.removeHandler=function(f){let d=c.indexOf(f);return d!==-1&&c.splice(d,2),this},this.getHandler=function(f){for(let d=0,h=c.length;d<h;d+=2){let p=c[d],_=c[d+1];if(p.global&&(p.lastIndex=0),p.test(f))return _}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Vy=new Dh,Uh=class{constructor(e){this.manager=e!==void 0?e:Vy,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,n){let i=this;return new Promise(function(r,s){i.load(e,r,n,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Uh.DEFAULT_MATERIAL_NAME="__DEFAULT";var zl=class extends fn{constructor(e,n=1){super(),this.isLight=!0,this.type="Light",this.color=new pt(e),this.intensity=n}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,n){return super.copy(e,n),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let n=super.toJSON(e);return n.object.color=this.color.getHex(),n.object.intensity=this.intensity,n}},Vl=class extends zl{constructor(e,n,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(fn.DEFAULT_UP),this.updateMatrix(),this.groundColor=new pt(n)}copy(e,n){return super.copy(e,n),this.groundColor.copy(e.groundColor),this}toJSON(e){let n=super.toJSON(e);return n.object.groundColor=this.groundColor.getHex(),n}},Pm=new bt,Zx=new N,$x=new N,Vm=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new we(512,512),this.mapType=Xn,this.map=null,this.mapPass=null,this.matrix=new bt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Jo,this._frameExtents=new we(1,1),this._viewportCount=1,this._viewports=[new qt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let n=this.camera,i=this.matrix;Zx.setFromMatrixPosition(e.matrixWorld),n.position.copy(Zx),$x.setFromMatrixPosition(e.target.matrixWorld),n.lookAt($x),n.updateMatrixWorld(),Pm.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Pm,n.coordinateSystem,n.reversedDepth),n.coordinateSystem===Wo||n.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(Pm)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},Ju=new N,ju=new Ki,Xi=new N,Hl=class extends fn{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new bt,this.projectionMatrix=new bt,this.projectionMatrixInverse=new bt,this.coordinateSystem=Li,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,n){return super.copy(e,n),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(Ju,ju,Xi),Xi.x===1&&Xi.y===1&&Xi.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Ju,ju,Xi.set(1,1,1)).invert()}updateWorldMatrix(e,n){super.updateWorldMatrix(e,n),this.matrixWorld.decompose(Ju,ju,Xi),Xi.x===1&&Xi.y===1&&Xi.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Ju,ju,Xi.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},is=new N,Kx=new we,Jx=new we,Tn=class extends Hl{constructor(e=50,n=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let n=.5*this.getFilmHeight()/e;this.fov=qo*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(ul*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return qo*2*Math.atan(Math.tan(ul*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,n,i){is.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(is.x,is.y).multiplyScalar(-e/is.z),is.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(is.x,is.y).multiplyScalar(-e/is.z)}getViewSize(e,n){return this.getViewBounds(e,Kx,Jx),n.subVectors(Jx,Kx)}setViewOffset(e,n,i,r,s,o){this.aspect=e/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,n=e*Math.tan(ul*.5*this.fov)/this.zoom,i=2*n,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,n-=o.offsetY*i/c,r*=o.width/l,i*=o.height/c}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,n,n-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}};var na=class extends Hl{constructor(e=-1,n=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=n,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,n,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+n,l=r-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,f=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=f*this.view.offsetY,l=a-f*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}},Hm=class extends Vm{constructor(){super(new na(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Gl=class extends zl{constructor(e,n){super(e,n),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(fn.DEFAULT_UP),this.updateMatrix(),this.target=new fn,this.shadow=new Hm}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let n=super.toJSON(e);return n.object.shadow=this.shadow.toJSON(),n.object.target=this.target.uuid,n}};var zo=-90,Vo=1,Fh=class extends fn{constructor(e,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new Tn(zo,Vo,e,n);r.layers=this.layers,this.add(r);let s=new Tn(zo,Vo,e,n);s.layers=this.layers,this.add(s);let o=new Tn(zo,Vo,e,n);o.layers=this.layers,this.add(o);let a=new Tn(zo,Vo,e,n);a.layers=this.layers,this.add(a);let l=new Tn(zo,Vo,e,n);l.layers=this.layers,this.add(l);let c=new Tn(zo,Vo,e,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,n=this.children.concat(),[i,r,s,o,a,l]=n;for(let c of n)this.remove(c);if(e===Li)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Wo)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of n)this.add(c),c.updateMatrixWorld()}update(e,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,c,f]=this.children,d=e.getRenderTarget(),h=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),_=e.xr.enabled;e.xr.enabled=!1;let S=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let m=!1;e.isWebGLRenderer===!0?m=e.state.buffers.depth.getReversed():m=e.reversedDepthBuffer,e.setRenderTarget(i,0,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,s),e.setRenderTarget(i,1,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,o),e.setRenderTarget(i,2,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,a),e.setRenderTarget(i,3,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,l),e.setRenderTarget(i,4,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,c),i.texture.generateMipmaps=S,e.setRenderTarget(i,5,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(n,f),e.setRenderTarget(d,h,p),e.xr.enabled=_,i.texture.needsPMREMUpdate=!0}},Oh=class extends Tn{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var gg="\\[\\]\\.:\\/",rE=new RegExp("["+gg+"]","g"),_g="[^"+gg+"]",sE="[^"+gg.replace("\\.","")+"]",oE=/((?:WC+[\/:])*)/.source.replace("WC",_g),aE=/(WCOD+)?/.source.replace("WCOD",sE),lE=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",_g),cE=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",_g),uE=new RegExp("^"+oE+aE+lE+cE+"$"),hE=["material","materials","bones","map"],Gm=class{constructor(e,n,i){let r=i||Ft.parseTrackName(n);this._targetGroup=e,this._bindings=e.subscribe_(n,r)}getValue(e,n){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,n)}setValue(e,n){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,n)}bind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].bind()}unbind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].unbind()}},Ft=class t{constructor(e,n,i){this.path=n,this.parsedPath=i||t.parseTrackName(n),this.node=t.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,n,i){return e&&e.isAnimationObjectGroup?new t.Composite(e,n,i):new t(e,n,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(rE,"")}static parseTrackName(e){let n=uE.exec(e);if(n===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);hE.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,n){if(n===void 0||n===""||n==="."||n===-1||n===e.name||n===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(n);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===n||a.uuid===n)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,n){e[n]=this.targetObject[this.propertyName]}_getValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[n++]=i[r]}_getValue_arrayElement(e,n){e[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,n){this.resolvedProperty.toArray(e,n)}_setValue_direct(e,n){this.targetObject[this.propertyName]=e[n]}_setValue_direct_setNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++]}_setValue_array_setNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,n){this.resolvedProperty[this.propertyIndex]=e[n]}_setValue_arrayElement_setNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,n){this.resolvedProperty.fromArray(e,n)}_setValue_fromArray_setNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,n){this.bind(),this.getValue(e,n)}_setValue_unbound(e,n){this.bind(),this.setValue(e,n)}bind(){let e=this.node,n=this.parsedPath,i=n.objectName,r=n.propertyName,s=n.propertyIndex;if(e||(e=t.findNode(this.rootNode,n.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){$e("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!e.material){Je("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Je("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Je("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let f=0;f<e.length;f++)if(e[f].name===c){c=f;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Je("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Je("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){Je("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){Je("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[r];if(o===void 0){let c=n.nodeName;Je("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){Je("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Je("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};Ft.Composite=Gm;Ft.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};Ft.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};Ft.prototype.GetterByBindingType=[Ft.prototype._getValue_direct,Ft.prototype._getValue_array,Ft.prototype._getValue_arrayElement,Ft.prototype._getValue_toArray];Ft.prototype.SetterByBindingTypeAndVersioning=[[Ft.prototype._setValue_direct,Ft.prototype._setValue_direct_setNeedsUpdate,Ft.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Ft.prototype._setValue_array,Ft.prototype._setValue_array_setNeedsUpdate,Ft.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Ft.prototype._setValue_arrayElement,Ft.prototype._setValue_arrayElement_setNeedsUpdate,Ft.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Ft.prototype._setValue_fromArray,Ft.prototype._setValue_fromArray_setNeedsUpdate,Ft.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var SR=new Float32Array(1);var jx=new bt,ia=class{constructor(e,n,i=0,r=1/0){this.ray=new wl(e,n),this.near=i,this.far=r,this.camera=null,this.layers=new Zo,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,n){this.ray.set(e,n)}setFromCamera(e,n){n.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(n.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(n).sub(this.ray.origin).normalize(),this.camera=n):n.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(n.near+n.far)/(n.near-n.far)).unproject(n),this.ray.direction.set(0,0,-1).transformDirection(n.matrixWorld),this.camera=n):Je("Raycaster: Unsupported camera type: "+n.type)}setFromXRController(e){return jx.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(jx),this}intersectObject(e,n=!0,i=[]){return Wm(e,this,i,n),i.sort(Qx),i}intersectObjects(e,n=!0,i=[]){for(let r=0,s=e.length;r<s;r++)Wm(e[r],this,i,n);return i.sort(Qx),i}};function Qx(t,e){return t.distance-e.distance}function Wm(t,e,n,i){let r=!0;if(t.layers.test(e.layers)&&t.raycast(e,n)===!1&&(r=!1),r===!0&&i===!0){let s=t.children;for(let o=0,a=s.length;o<a;o++)Wm(s[o],e,n,!0)}}var wg=class wg{constructor(e,n,i,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,n,i,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,n=0){for(let i=0;i<4;i++)this.elements[i]=e[i+n];return this}set(e,n,i,r){let s=this.elements;return s[0]=e,s[2]=n,s[1]=i,s[3]=r,this}};wg.prototype.isMatrix2=!0;var Xm=wg;function vg(t,e,n,i){let r=fE(i);switch(n){case lg:return t*e;case ug:return t*e/r.components*r.byteLength;case Yh:return t*e/r.components*r.byteLength;case ms:return t*e*2/r.components*r.byteLength;case Zh:return t*e*2/r.components*r.byteLength;case cg:return t*e*3/r.components*r.byteLength;case gi:return t*e*4/r.components*r.byteLength;case $h:return t*e*4/r.components*r.byteLength;case Zl:case $l:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case Kl:case Jl:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Jh:case Qh:return Math.max(t,16)*Math.max(e,8)/4;case Kh:case jh:return Math.max(t,8)*Math.max(e,8)/2;case ef:case tf:case rf:case sf:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case nf:case jl:case of:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case af:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case lf:return Math.floor((t+4)/5)*Math.floor((e+3)/4)*16;case cf:return Math.floor((t+4)/5)*Math.floor((e+4)/5)*16;case uf:return Math.floor((t+5)/6)*Math.floor((e+4)/5)*16;case hf:return Math.floor((t+5)/6)*Math.floor((e+5)/6)*16;case ff:return Math.floor((t+7)/8)*Math.floor((e+4)/5)*16;case df:return Math.floor((t+7)/8)*Math.floor((e+5)/6)*16;case pf:return Math.floor((t+7)/8)*Math.floor((e+7)/8)*16;case mf:return Math.floor((t+9)/10)*Math.floor((e+4)/5)*16;case gf:return Math.floor((t+9)/10)*Math.floor((e+5)/6)*16;case _f:return Math.floor((t+9)/10)*Math.floor((e+7)/8)*16;case vf:return Math.floor((t+9)/10)*Math.floor((e+9)/10)*16;case xf:return Math.floor((t+11)/12)*Math.floor((e+9)/10)*16;case yf:return Math.floor((t+11)/12)*Math.floor((e+11)/12)*16;case Sf:case Mf:case wf:return Math.ceil(t/4)*Math.ceil(e/4)*16;case Ef:case Tf:return Math.ceil(t/4)*Math.ceil(e/4)*8;case Ql:case bf:return Math.ceil(t/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function fE(t){switch(t){case Xn:case rg:return{byteLength:1,components:1};case sa:case sg:case nr:return{byteLength:2,components:1};case Xh:case qh:return{byteLength:2,components:4};case Ui:case Wh:case Fi:return{byteLength:4,components:1};case og:case ag:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${t}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:kh}}));typeof window<"u"&&(window.__THREE__?$e("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=kh);function uS(){let t=null,e=!1,n=null,i=null;function r(s,o){n(s,o),i=t.requestAnimationFrame(r)}return{start:function(){e!==!0&&n!==null&&t!==null&&(i=t.requestAnimationFrame(r),e=!0)},stop:function(){t!==null&&t.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){n=s},setContext:function(s){t=s}}}function dE(t){let e=new WeakMap;function n(a,l){let c=a.array,f=a.usage,d=c.byteLength,h=t.createBuffer();t.bindBuffer(l,h),t.bufferData(l,c,f),a.onUploadCallback();let p;if(c instanceof Float32Array)p=t.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)p=t.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?p=t.HALF_FLOAT:p=t.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=t.SHORT;else if(c instanceof Uint32Array)p=t.UNSIGNED_INT;else if(c instanceof Int32Array)p=t.INT;else if(c instanceof Int8Array)p=t.BYTE;else if(c instanceof Uint8Array)p=t.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=t.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:h,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:d}}function i(a,l,c){let f=l.array,d=l.updateRanges;if(t.bindBuffer(c,a),d.length===0)t.bufferSubData(c,0,f);else{d.sort((p,_)=>p.start-_.start);let h=0;for(let p=1;p<d.length;p++){let _=d[h],S=d[p];S.start<=_.start+_.count+1?_.count=Math.max(_.count,S.start+S.count-_.start):(++h,d[h]=S)}d.length=h+1;for(let p=0,_=d.length;p<_;p++){let S=d[p];t.bufferSubData(c,S.start*f.BYTES_PER_ELEMENT,f,S.start,S.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(t.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let f=e.get(a);(!f||f.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=e.get(a);if(c===void 0)e.set(a,n(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}var pE=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,mE=`#ifdef USE_ALPHAHASH
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
#endif`,gE=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,_E=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,vE=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,xE=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,yE=`#ifdef USE_AOMAP
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
#endif`,SE=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,ME=`#ifdef USE_BATCHING
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
#endif`,wE=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,EE=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,TE=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bE=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,AE=`#ifdef USE_IRIDESCENCE
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
#endif`,CE=`#ifdef USE_BUMPMAP
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
#endif`,RE=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,PE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,IE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,LE=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,NE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,DE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,UE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,FE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,OE=`#define PI 3.141592653589793
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
} // validated`,BE=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,kE=`vec3 transformedNormal = objectNormal;
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
#endif`,zE=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,VE=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,HE=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,GE=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,WE="gl_FragColor = linearToOutputTexel( gl_FragColor );",XE=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,qE=`#ifdef USE_ENVMAP
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
#endif`,YE=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,ZE=`#ifdef USE_ENVMAP
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
#endif`,$E=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,KE=`#ifdef USE_ENVMAP
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
#endif`,JE=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,jE=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,QE=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,eT=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,tT=`#ifdef USE_GRADIENTMAP
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
}`,nT=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,iT=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,rT=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,sT=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,oT=`#ifdef USE_ENVMAP
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
#endif`,aT=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lT=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,cT=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,uT=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,hT=`PhysicalMaterial material;
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
#endif`,fT=`uniform sampler2D dfgLUT;
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
}`,dT=`
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
#endif`,pT=`#if defined( RE_IndirectDiffuse )
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
#endif`,mT=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,gT=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,_T=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,vT=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,xT=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,yT=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,ST=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,MT=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,wT=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,ET=`#if defined( USE_POINTS_UV )
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
#endif`,TT=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,bT=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,AT=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,CT=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,RT=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,PT=`#ifdef USE_MORPHTARGETS
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
#endif`,IT=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,LT=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,NT=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,DT=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,UT=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,FT=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,OT=`#ifdef USE_NORMALMAP
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
#endif`,BT=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,kT=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,zT=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,VT=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,HT=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,GT=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,WT=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,XT=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,qT=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,YT=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,ZT=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,$T=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,KT=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,JT=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,jT=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,QT=`float getShadowMask() {
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
}`,eb=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,tb=`#ifdef USE_SKINNING
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
#endif`,nb=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,ib=`#ifdef USE_SKINNING
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
#endif`,rb=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,sb=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,ob=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,ab=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,lb=`#ifdef USE_TRANSMISSION
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
#endif`,cb=`#ifdef USE_TRANSMISSION
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
#endif`,ub=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,hb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,fb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,db=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,pb=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,mb=`uniform sampler2D t2D;
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
}`,gb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,_b=`#ifdef ENVMAP_TYPE_CUBE
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
}`,vb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,xb=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,yb=`#include <common>
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
}`,Sb=`#if DEPTH_PACKING == 3200
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
}`,Mb=`#define DISTANCE
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
}`,wb=`#define DISTANCE
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
}`,Eb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Tb=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,bb=`uniform float scale;
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
}`,Ab=`uniform vec3 diffuse;
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
}`,Cb=`#include <common>
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
}`,Rb=`uniform vec3 diffuse;
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
}`,Pb=`#define LAMBERT
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
}`,Ib=`#define LAMBERT
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
}`,Lb=`#define MATCAP
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
}`,Nb=`#define MATCAP
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
}`,Db=`#define NORMAL
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
}`,Ub=`#define NORMAL
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
}`,Fb=`#define PHONG
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
}`,Ob=`#define PHONG
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
}`,Bb=`#define STANDARD
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
}`,kb=`#define STANDARD
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
}`,zb=`#define TOON
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
}`,Vb=`#define TOON
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
}`,Hb=`uniform float size;
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
}`,Gb=`uniform vec3 diffuse;
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
}`,Wb=`#include <common>
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
}`,Xb=`uniform vec3 color;
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
}`,qb=`uniform float rotation;
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
}`,Yb=`uniform vec3 diffuse;
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
}`,ut={alphahash_fragment:pE,alphahash_pars_fragment:mE,alphamap_fragment:gE,alphamap_pars_fragment:_E,alphatest_fragment:vE,alphatest_pars_fragment:xE,aomap_fragment:yE,aomap_pars_fragment:SE,batching_pars_vertex:ME,batching_vertex:wE,begin_vertex:EE,beginnormal_vertex:TE,bsdfs:bE,iridescence_fragment:AE,bumpmap_pars_fragment:CE,clipping_planes_fragment:RE,clipping_planes_pars_fragment:PE,clipping_planes_pars_vertex:IE,clipping_planes_vertex:LE,color_fragment:NE,color_pars_fragment:DE,color_pars_vertex:UE,color_vertex:FE,common:OE,cube_uv_reflection_fragment:BE,defaultnormal_vertex:kE,displacementmap_pars_vertex:zE,displacementmap_vertex:VE,emissivemap_fragment:HE,emissivemap_pars_fragment:GE,colorspace_fragment:WE,colorspace_pars_fragment:XE,envmap_fragment:qE,envmap_common_pars_fragment:YE,envmap_pars_fragment:ZE,envmap_pars_vertex:$E,envmap_physical_pars_fragment:oT,envmap_vertex:KE,fog_vertex:JE,fog_pars_vertex:jE,fog_fragment:QE,fog_pars_fragment:eT,gradientmap_pars_fragment:tT,lightmap_pars_fragment:nT,lights_lambert_fragment:iT,lights_lambert_pars_fragment:rT,lights_pars_begin:sT,lights_toon_fragment:aT,lights_toon_pars_fragment:lT,lights_phong_fragment:cT,lights_phong_pars_fragment:uT,lights_physical_fragment:hT,lights_physical_pars_fragment:fT,lights_fragment_begin:dT,lights_fragment_maps:pT,lights_fragment_end:mT,lightprobes_pars_fragment:gT,logdepthbuf_fragment:_T,logdepthbuf_pars_fragment:vT,logdepthbuf_pars_vertex:xT,logdepthbuf_vertex:yT,map_fragment:ST,map_pars_fragment:MT,map_particle_fragment:wT,map_particle_pars_fragment:ET,metalnessmap_fragment:TT,metalnessmap_pars_fragment:bT,morphinstance_vertex:AT,morphcolor_vertex:CT,morphnormal_vertex:RT,morphtarget_pars_vertex:PT,morphtarget_vertex:IT,normal_fragment_begin:LT,normal_fragment_maps:NT,normal_pars_fragment:DT,normal_pars_vertex:UT,normal_vertex:FT,normalmap_pars_fragment:OT,clearcoat_normal_fragment_begin:BT,clearcoat_normal_fragment_maps:kT,clearcoat_pars_fragment:zT,iridescence_pars_fragment:VT,opaque_fragment:HT,packing:GT,premultiplied_alpha_fragment:WT,project_vertex:XT,dithering_fragment:qT,dithering_pars_fragment:YT,roughnessmap_fragment:ZT,roughnessmap_pars_fragment:$T,shadowmap_pars_fragment:KT,shadowmap_pars_vertex:JT,shadowmap_vertex:jT,shadowmask_pars_fragment:QT,skinbase_vertex:eb,skinning_pars_vertex:tb,skinning_vertex:nb,skinnormal_vertex:ib,specularmap_fragment:rb,specularmap_pars_fragment:sb,tonemapping_fragment:ob,tonemapping_pars_fragment:ab,transmission_fragment:lb,transmission_pars_fragment:cb,uv_pars_fragment:ub,uv_pars_vertex:hb,uv_vertex:fb,worldpos_vertex:db,background_vert:pb,background_frag:mb,backgroundCube_vert:gb,backgroundCube_frag:_b,cube_vert:vb,cube_frag:xb,depth_vert:yb,depth_frag:Sb,distance_vert:Mb,distance_frag:wb,equirect_vert:Eb,equirect_frag:Tb,linedashed_vert:bb,linedashed_frag:Ab,meshbasic_vert:Cb,meshbasic_frag:Rb,meshlambert_vert:Pb,meshlambert_frag:Ib,meshmatcap_vert:Lb,meshmatcap_frag:Nb,meshnormal_vert:Db,meshnormal_frag:Ub,meshphong_vert:Fb,meshphong_frag:Ob,meshphysical_vert:Bb,meshphysical_frag:kb,meshtoon_vert:zb,meshtoon_frag:Vb,points_vert:Hb,points_frag:Gb,shadow_vert:Wb,shadow_frag:Xb,sprite_vert:qb,sprite_frag:Yb},Ee={common:{diffuse:{value:new pt(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new it},alphaMap:{value:null},alphaMapTransform:{value:new it},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new it}},envmap:{envMap:{value:null},envMapRotation:{value:new it},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new it}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new it}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new it},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new it},normalScale:{value:new we(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new it},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new it}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new it}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new it}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new pt(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new N},probesMax:{value:new N},probesResolution:{value:new N}},points:{diffuse:{value:new pt(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new it},alphaTest:{value:0},uvTransform:{value:new it}},sprite:{diffuse:{value:new pt(16777215)},opacity:{value:1},center:{value:new we(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new it},alphaMap:{value:null},alphaMapTransform:{value:new it},alphaTest:{value:0}}},rr={basic:{uniforms:bn([Ee.common,Ee.specularmap,Ee.envmap,Ee.aomap,Ee.lightmap,Ee.fog]),vertexShader:ut.meshbasic_vert,fragmentShader:ut.meshbasic_frag},lambert:{uniforms:bn([Ee.common,Ee.specularmap,Ee.envmap,Ee.aomap,Ee.lightmap,Ee.emissivemap,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.fog,Ee.lights,{emissive:{value:new pt(0)},envMapIntensity:{value:1}}]),vertexShader:ut.meshlambert_vert,fragmentShader:ut.meshlambert_frag},phong:{uniforms:bn([Ee.common,Ee.specularmap,Ee.envmap,Ee.aomap,Ee.lightmap,Ee.emissivemap,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.fog,Ee.lights,{emissive:{value:new pt(0)},specular:{value:new pt(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:ut.meshphong_vert,fragmentShader:ut.meshphong_frag},standard:{uniforms:bn([Ee.common,Ee.envmap,Ee.aomap,Ee.lightmap,Ee.emissivemap,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.roughnessmap,Ee.metalnessmap,Ee.fog,Ee.lights,{emissive:{value:new pt(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:ut.meshphysical_vert,fragmentShader:ut.meshphysical_frag},toon:{uniforms:bn([Ee.common,Ee.aomap,Ee.lightmap,Ee.emissivemap,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.gradientmap,Ee.fog,Ee.lights,{emissive:{value:new pt(0)}}]),vertexShader:ut.meshtoon_vert,fragmentShader:ut.meshtoon_frag},matcap:{uniforms:bn([Ee.common,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.fog,{matcap:{value:null}}]),vertexShader:ut.meshmatcap_vert,fragmentShader:ut.meshmatcap_frag},points:{uniforms:bn([Ee.points,Ee.fog]),vertexShader:ut.points_vert,fragmentShader:ut.points_frag},dashed:{uniforms:bn([Ee.common,Ee.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:ut.linedashed_vert,fragmentShader:ut.linedashed_frag},depth:{uniforms:bn([Ee.common,Ee.displacementmap]),vertexShader:ut.depth_vert,fragmentShader:ut.depth_frag},normal:{uniforms:bn([Ee.common,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,{opacity:{value:1}}]),vertexShader:ut.meshnormal_vert,fragmentShader:ut.meshnormal_frag},sprite:{uniforms:bn([Ee.sprite,Ee.fog]),vertexShader:ut.sprite_vert,fragmentShader:ut.sprite_frag},background:{uniforms:{uvTransform:{value:new it},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:ut.background_vert,fragmentShader:ut.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new it}},vertexShader:ut.backgroundCube_vert,fragmentShader:ut.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:ut.cube_vert,fragmentShader:ut.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:ut.equirect_vert,fragmentShader:ut.equirect_frag},distance:{uniforms:bn([Ee.common,Ee.displacementmap,{referencePosition:{value:new N},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:ut.distance_vert,fragmentShader:ut.distance_frag},shadow:{uniforms:bn([Ee.lights,Ee.fog,{color:{value:new pt(0)},opacity:{value:1}}]),vertexShader:ut.shadow_vert,fragmentShader:ut.shadow_frag}};rr.physical={uniforms:bn([rr.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new it},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new it},clearcoatNormalScale:{value:new we(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new it},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new it},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new it},sheen:{value:0},sheenColor:{value:new pt(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new it},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new it},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new it},transmissionSamplerSize:{value:new we},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new it},attenuationDistance:{value:0},attenuationColor:{value:new pt(0)},specularColor:{value:new pt(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new it},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new it},anisotropyVector:{value:new we},anisotropyMap:{value:null},anisotropyMapTransform:{value:new it}}]),vertexShader:ut.meshphysical_vert,fragmentShader:ut.meshphysical_frag};var Pf={r:0,b:0,g:0},Zb=new bt,hS=new it;hS.set(-1,0,0,0,1,0,0,0,1);function $b(t,e,n,i,r,s){let o=new pt(0),a=r===!0?0:1,l,c,f=null,d=0,h=null;function p(g){let v=g.isScene===!0?g.background:null;if(v&&v.isTexture){let y=g.backgroundBlurriness>0;v=e.get(v,y)}return v}function _(g){let v=!1,y=p(g);y===null?m(o,a):y&&y.isColor&&(m(y,1),v=!0);let A=t.xr.getEnvironmentBlendMode();A==="additive"?n.buffers.color.setClear(0,0,0,1,s):A==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,s),(t.autoClear||v)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),t.clear(t.autoClearColor,t.autoClearDepth,t.autoClearStencil))}function S(g,v){let y=p(v);y&&(y.isCubeTexture||y.mapping===ql)?(c===void 0&&(c=new zt(new ls(1,1,1),new si({name:"BackgroundCubeMaterial",uniforms:Ks(rr.backgroundCube.uniforms),vertexShader:rr.backgroundCube.vertexShader,fragmentShader:rr.backgroundCube.fragmentShader,side:On,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(A,w,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(c)),c.material.uniforms.envMap.value=y,c.material.uniforms.backgroundBlurriness.value=v.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(Zb.makeRotationFromEuler(v.backgroundRotation)).transpose(),y.isCubeTexture&&y.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(hS),c.material.toneMapped=xt.getTransfer(y.colorSpace)!==Tt,(f!==y||d!==y.version||h!==t.toneMapping)&&(c.material.needsUpdate=!0,f=y,d=y.version,h=t.toneMapping),c.layers.enableAll(),g.unshift(c,c.geometry,c.material,0,0,null)):y&&y.isTexture&&(l===void 0&&(l=new zt(new Qi(2,2),new si({name:"BackgroundMaterial",uniforms:Ks(rr.background.uniforms),vertexShader:rr.background.vertexShader,fragmentShader:rr.background.fragmentShader,side:Tr,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=y,l.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,l.material.toneMapped=xt.getTransfer(y.colorSpace)!==Tt,y.matrixAutoUpdate===!0&&y.updateMatrix(),l.material.uniforms.uvTransform.value.copy(y.matrix),(f!==y||d!==y.version||h!==t.toneMapping)&&(l.material.needsUpdate=!0,f=y,d=y.version,h=t.toneMapping),l.layers.enableAll(),g.unshift(l,l.geometry,l.material,0,0,null))}function m(g,v){g.getRGB(Pf,mg(t)),n.buffers.color.setClear(Pf.r,Pf.g,Pf.b,v,s)}function u(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(g,v=1){o.set(g),a=v,m(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(g){a=g,m(o,a)},render:_,addToRenderList:S,dispose:u}}function Kb(t,e){let n=t.getParameter(t.MAX_VERTEX_ATTRIBS),i={},r=h(null),s=r,o=!1;function a(R,F,G,X,U){let k=!1,V=d(R,X,G,F);s!==V&&(s=V,c(s.object)),k=p(R,X,G,U),k&&_(R,X,G,U),U!==null&&e.update(U,t.ELEMENT_ARRAY_BUFFER),(k||o)&&(o=!1,y(R,F,G,X),U!==null&&t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,e.get(U).buffer))}function l(){return t.createVertexArray()}function c(R){return t.bindVertexArray(R)}function f(R){return t.deleteVertexArray(R)}function d(R,F,G,X){let U=X.wireframe===!0,k=i[F.id];k===void 0&&(k={},i[F.id]=k);let V=R.isInstancedMesh===!0?R.id:0,ne=k[V];ne===void 0&&(ne={},k[V]=ne);let le=ne[G.id];le===void 0&&(le={},ne[G.id]=le);let me=le[U];return me===void 0&&(me=h(l()),le[U]=me),me}function h(R){let F=[],G=[],X=[];for(let U=0;U<n;U++)F[U]=0,G[U]=0,X[U]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:F,enabledAttributes:G,attributeDivisors:X,object:R,attributes:{},index:null}}function p(R,F,G,X){let U=s.attributes,k=F.attributes,V=0,ne=G.getAttributes();for(let le in ne)if(ne[le].location>=0){let Ae=U[le],Fe=k[le];if(Fe===void 0&&(le==="instanceMatrix"&&R.instanceMatrix&&(Fe=R.instanceMatrix),le==="instanceColor"&&R.instanceColor&&(Fe=R.instanceColor)),Ae===void 0||Ae.attribute!==Fe||Fe&&Ae.data!==Fe.data)return!0;V++}return s.attributesNum!==V||s.index!==X}function _(R,F,G,X){let U={},k=F.attributes,V=0,ne=G.getAttributes();for(let le in ne)if(ne[le].location>=0){let Ae=k[le];Ae===void 0&&(le==="instanceMatrix"&&R.instanceMatrix&&(Ae=R.instanceMatrix),le==="instanceColor"&&R.instanceColor&&(Ae=R.instanceColor));let Fe={};Fe.attribute=Ae,Ae&&Ae.data&&(Fe.data=Ae.data),U[le]=Fe,V++}s.attributes=U,s.attributesNum=V,s.index=X}function S(){let R=s.newAttributes;for(let F=0,G=R.length;F<G;F++)R[F]=0}function m(R){u(R,0)}function u(R,F){let G=s.newAttributes,X=s.enabledAttributes,U=s.attributeDivisors;G[R]=1,X[R]===0&&(t.enableVertexAttribArray(R),X[R]=1),U[R]!==F&&(t.vertexAttribDivisor(R,F),U[R]=F)}function g(){let R=s.newAttributes,F=s.enabledAttributes;for(let G=0,X=F.length;G<X;G++)F[G]!==R[G]&&(t.disableVertexAttribArray(G),F[G]=0)}function v(R,F,G,X,U,k,V){V===!0?t.vertexAttribIPointer(R,F,G,U,k):t.vertexAttribPointer(R,F,G,X,U,k)}function y(R,F,G,X){S();let U=X.attributes,k=G.getAttributes(),V=F.defaultAttributeValues;for(let ne in k){let le=k[ne];if(le.location>=0){let me=U[ne];if(me===void 0&&(ne==="instanceMatrix"&&R.instanceMatrix&&(me=R.instanceMatrix),ne==="instanceColor"&&R.instanceColor&&(me=R.instanceColor)),me!==void 0){let Ae=me.normalized,Fe=me.itemSize,Qe=e.get(me);if(Qe===void 0)continue;let vt=Qe.buffer,et=Qe.type,Q=Qe.bytesPerElement,xe=et===t.INT||et===t.UNSIGNED_INT||me.gpuType===Wh;if(me.isInterleavedBufferAttribute){let ce=me.data,Be=ce.stride,qe=me.offset;if(ce.isInstancedInterleavedBuffer){for(let Ye=0;Ye<le.locationSize;Ye++)u(le.location+Ye,ce.meshPerAttribute);R.isInstancedMesh!==!0&&X._maxInstanceCount===void 0&&(X._maxInstanceCount=ce.meshPerAttribute*ce.count)}else for(let Ye=0;Ye<le.locationSize;Ye++)m(le.location+Ye);t.bindBuffer(t.ARRAY_BUFFER,vt);for(let Ye=0;Ye<le.locationSize;Ye++)v(le.location+Ye,Fe/le.locationSize,et,Ae,Be*Q,(qe+Fe/le.locationSize*Ye)*Q,xe)}else{if(me.isInstancedBufferAttribute){for(let ce=0;ce<le.locationSize;ce++)u(le.location+ce,me.meshPerAttribute);R.isInstancedMesh!==!0&&X._maxInstanceCount===void 0&&(X._maxInstanceCount=me.meshPerAttribute*me.count)}else for(let ce=0;ce<le.locationSize;ce++)m(le.location+ce);t.bindBuffer(t.ARRAY_BUFFER,vt);for(let ce=0;ce<le.locationSize;ce++)v(le.location+ce,Fe/le.locationSize,et,Ae,Fe*Q,Fe/le.locationSize*ce*Q,xe)}}else if(V!==void 0){let Ae=V[ne];if(Ae!==void 0)switch(Ae.length){case 2:t.vertexAttrib2fv(le.location,Ae);break;case 3:t.vertexAttrib3fv(le.location,Ae);break;case 4:t.vertexAttrib4fv(le.location,Ae);break;default:t.vertexAttrib1fv(le.location,Ae)}}}}g()}function A(){b();for(let R in i){let F=i[R];for(let G in F){let X=F[G];for(let U in X){let k=X[U];for(let V in k)f(k[V].object),delete k[V];delete X[U]}}delete i[R]}}function w(R){if(i[R.id]===void 0)return;let F=i[R.id];for(let G in F){let X=F[G];for(let U in X){let k=X[U];for(let V in k)f(k[V].object),delete k[V];delete X[U]}}delete i[R.id]}function C(R){for(let F in i){let G=i[F];for(let X in G){let U=G[X];if(U[R.id]===void 0)continue;let k=U[R.id];for(let V in k)f(k[V].object),delete k[V];delete U[R.id]}}}function x(R){for(let F in i){let G=i[F],X=R.isInstancedMesh===!0?R.id:0,U=G[X];if(U!==void 0){for(let k in U){let V=U[k];for(let ne in V)f(V[ne].object),delete V[ne];delete U[k]}delete G[X],Object.keys(G).length===0&&delete i[F]}}}function b(){P(),o=!0,s!==r&&(s=r,c(s.object))}function P(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:b,resetDefaultState:P,dispose:A,releaseStatesOfGeometry:w,releaseStatesOfObject:x,releaseStatesOfProgram:C,initAttributes:S,enableAttribute:m,disableUnusedAttributes:g}}function Jb(t,e,n){let i;function r(l){i=l}function s(l,c){t.drawArrays(i,l,c),n.update(c,i,1)}function o(l,c,f){f!==0&&(t.drawArraysInstanced(i,l,c,f),n.update(c,i,f))}function a(l,c,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,c,0,f);let h=0;for(let p=0;p<f;p++)h+=c[p];n.update(h,i,1)}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a}function jb(t,e,n,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let C=e.get("EXT_texture_filter_anisotropic");r=t.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(C){return!(C!==gi&&i.convert(C)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(C){let x=C===nr&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==Xn&&i.convert(C)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==Fi&&!x)}function l(C){if(C==="highp"){if(t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.HIGH_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.MEDIUM_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",f=l(c);f!==c&&($e("WebGLRenderer:",c,"not supported, using",f,"instead."),c=f);let d=n.logarithmicDepthBuffer===!0,h=n.reversedDepthBuffer===!0&&e.has("EXT_clip_control");n.reversedDepthBuffer===!0&&h===!1&&$e("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let p=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),_=t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),S=t.getParameter(t.MAX_TEXTURE_SIZE),m=t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),u=t.getParameter(t.MAX_VERTEX_ATTRIBS),g=t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),v=t.getParameter(t.MAX_VARYING_VECTORS),y=t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),A=t.getParameter(t.MAX_SAMPLES),w=t.getParameter(t.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:d,reversedDepthBuffer:h,maxTextures:p,maxVertexTextures:_,maxTextureSize:S,maxCubemapSize:m,maxAttributes:u,maxVertexUniforms:g,maxVaryings:v,maxFragmentUniforms:y,maxSamples:A,samples:w}}function Qb(t){let e=this,n=null,i=0,r=!1,s=!1,o=new qi,a=new it,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,h){let p=d.length!==0||h||i!==0||r;return r=h,i=d.length,p},this.beginShadows=function(){s=!0,f(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(d,h){n=f(d,h,0)},this.setState=function(d,h,p){let _=d.clippingPlanes,S=d.clipIntersection,m=d.clipShadows,u=t.get(d);if(!r||_===null||_.length===0||s&&!m)s?f(null):c();else{let g=s?0:i,v=g*4,y=u.clippingState||null;l.value=y,y=f(_,h,v,p);for(let A=0;A!==v;++A)y[A]=n[A];u.clippingState=y,this.numIntersection=S?this.numPlanes:0,this.numPlanes+=g}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function f(d,h,p,_){let S=d!==null?d.length:0,m=null;if(S!==0){if(m=l.value,_!==!0||m===null){let u=p+S*4,g=h.matrixWorldInverse;a.getNormalMatrix(g),(m===null||m.length<u)&&(m=new Float32Array(u));for(let v=0,y=p;v!==S;++v,y+=4)o.copy(d[v]).applyMatrix4(g,a),o.normal.toArray(m,y),m[y+3]=o.constant}l.value=m,l.needsUpdate=!0}return e.numPlanes=S,e.numIntersection=0,m}}var gs=4,Hy=[.125,.215,.35,.446,.526,.582],Js=20,eA=256,ec=new na,Gy=new pt,Eg=null,Tg=0,bg=0,Ag=!1,tA=new N,Lf=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,n=0,i=.1,r=100,s={}){let{size:o=256,position:a=tA}=s;Eg=this._renderer.getRenderTarget(),Tg=this._renderer.getActiveCubeFace(),bg=this._renderer.getActiveMipmapLevel(),Ag=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,n=null){return this._fromTexture(e,n)}fromCubemap(e,n=null){return this._fromTexture(e,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=qy(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Xy(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(Eg,Tg,bg),this._renderer.xr.enabled=Ag,e.scissorTest=!1,aa(e,0,0,e.width,e.height)}_fromTexture(e,n){e.mapping===fs||e.mapping===Ys?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Eg=this._renderer.getRenderTarget(),Tg=this._renderer.getActiveCubeFace(),bg=this._renderer.getActiveMipmapLevel(),Ag=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:_n,minFilter:_n,generateMipmaps:!1,type:nr,format:gi,colorSpace:ml,depthBuffer:!1},r=Wy(e,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Wy(e,n,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=nA(s)),this._blurMaterial=rA(s,e,n),this._ggxMaterial=iA(s,e,n)}return r}_compileMaterial(e){let n=new zt(new jt,e);this._renderer.compile(n,ec)}_sceneToCubeUV(e,n,i,r,s){let l=new Tn(90,1,n,i),c=[1,-1,1,1,1,1],f=[1,1,1,-1,-1,-1],d=this._renderer,h=d.autoClear,p=d.toneMapping;d.getClearColor(Gy),d.toneMapping=Di,d.autoClear=!1,d.state.buffers.depth.getReversed()&&(d.setRenderTarget(r),d.clearDepth(),d.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new zt(new ls,new Ji({name:"PMREM.Background",side:On,depthWrite:!1,depthTest:!1})));let S=this._backgroundBox,m=S.material,u=!1,g=e.background;g?g.isColor&&(m.color.copy(g),e.background=null,u=!0):(m.color.copy(Gy),u=!0);for(let v=0;v<6;v++){let y=v%3;y===0?(l.up.set(0,c[v],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+f[v],s.y,s.z)):y===1?(l.up.set(0,0,c[v]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+f[v],s.z)):(l.up.set(0,c[v],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+f[v]));let A=this._cubeSize;aa(r,y*A,v>2?A:0,A,A),d.setRenderTarget(r),u&&d.render(S,l),d.render(e,l)}d.toneMapping=p,d.autoClear=h,e.background=g}_textureToCubeUV(e,n){let i=this._renderer,r=e.mapping===fs||e.mapping===Ys;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=qy()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Xy());let s=r?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=s;let a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;aa(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(o,ec)}_applyPMREM(e){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);n.autoClear=i}_applyGGXFilter(e,n,i){let r=this._renderer,s=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[i];a.material=o;let l=o.uniforms,c=i/(this._lodMeshes.length-1),f=n/(this._lodMeshes.length-1),d=Math.sqrt(c*c-f*f),h=0+c*1.25,p=d*h,{_lodMax:_}=this,S=this._sizeLods[i],m=3*S*(i>_-gs?i-_+gs:0),u=4*(this._cubeSize-S);l.envMap.value=e.texture,l.roughness.value=p,l.mipInt.value=_-n,aa(s,m,u,3*S,2*S),r.setRenderTarget(s),r.render(a,ec),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=_-i,aa(e,m,u,3*S,2*S),r.setRenderTarget(e),r.render(a,ec)}_blur(e,n,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,n,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,n,i,r,s,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&Je("blur direction must be either latitudinal or longitudinal!");let f=3,d=this._lodMeshes[r];d.material=c;let h=c.uniforms,p=this._sizeLods[i]-1,_=isFinite(s)?Math.PI/(2*p):2*Math.PI/(2*Js-1),S=s/_,m=isFinite(s)?1+Math.floor(f*S):Js;m>Js&&$e(`sigmaRadians, ${s}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${Js}`);let u=[],g=0;for(let C=0;C<Js;++C){let x=C/S,b=Math.exp(-x*x/2);u.push(b),C===0?g+=b:C<m&&(g+=2*b)}for(let C=0;C<u.length;C++)u[C]=u[C]/g;h.envMap.value=e.texture,h.samples.value=m,h.weights.value=u,h.latitudinal.value=o==="latitudinal",a&&(h.poleAxis.value=a);let{_lodMax:v}=this;h.dTheta.value=_,h.mipInt.value=v-i;let y=this._sizeLods[r],A=3*y*(r>v-gs?r-v+gs:0),w=4*(this._cubeSize-y);aa(n,A,w,3*y,2*y),l.setRenderTarget(n),l.render(d,ec)}};function nA(t){let e=[],n=[],i=[],r=t,s=t-gs+1+Hy.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);e.push(a);let l=1/a;o>t-gs?l=Hy[o-t+gs-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),f=-c,d=1+c,h=[f,f,d,f,d,d,f,f,d,d,f,d],p=6,_=6,S=3,m=2,u=1,g=new Float32Array(S*_*p),v=new Float32Array(m*_*p),y=new Float32Array(u*_*p);for(let w=0;w<p;w++){let C=w%3*2/3-1,x=w>2?0:-1,b=[C,x,0,C+2/3,x,0,C+2/3,x+1,0,C,x,0,C+2/3,x+1,0,C,x+1,0];g.set(b,S*_*w),v.set(h,m*_*w);let P=[w,w,w,w,w,w];y.set(P,u*_*w)}let A=new jt;A.setAttribute("position",new ni(g,S)),A.setAttribute("uv",new ni(v,m)),A.setAttribute("faceIndex",new ni(y,u)),i.push(new zt(A,null)),r>gs&&r--}return{lodMeshes:i,sizeLods:e,sigmas:n}}function Wy(t,e,n){let i=new ii(t,e,n);return i.texture.mapping=ql,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function aa(t,e,n,i,r){t.viewport.set(e,n,i,r),t.scissor.set(e,n,i,r)}function iA(t,e,n){return new si({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:eA,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Uf(),fragmentShader:`

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
		`,blending:tr,depthTest:!1,depthWrite:!1})}function rA(t,e,n){let i=new Float32Array(Js),r=new N(0,1,0);return new si({name:"SphericalGaussianBlur",defines:{n:Js,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:Uf(),fragmentShader:`

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
		`,blending:tr,depthTest:!1,depthWrite:!1})}function Xy(){return new si({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Uf(),fragmentShader:`

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
		`,blending:tr,depthTest:!1,depthWrite:!1})}function qy(){return new si({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Uf(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:tr,depthTest:!1,depthWrite:!1})}function Uf(){return`

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
	`}var Nf=class extends ii{constructor(e=1,n={}){super(e,e,n),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new El(r),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new ls(5,5,5),s=new si({name:"CubemapFromEquirect",uniforms:Ks(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:On,blending:tr});s.uniforms.tEquirect.value=n;let o=new zt(r,s),a=n.minFilter;return n.minFilter===ds&&(n.minFilter=_n),new Fh(1,10,this).update(e,o),n.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,n=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(n,i,r);e.setRenderTarget(s)}};function sA(t){let e=new WeakMap,n=new WeakMap,i=null;function r(h,p=!1){return h==null?null:p?o(h):s(h)}function s(h){if(h&&h.isTexture){let p=h.mapping;if(p===Vh||p===Hh)if(e.has(h)){let _=e.get(h).texture;return a(_,h.mapping)}else{let _=h.image;if(_&&_.height>0){let S=new Nf(_.height);return S.fromEquirectangularTexture(t,h),e.set(h,S),h.addEventListener("dispose",c),a(S.texture,h.mapping)}else return null}}return h}function o(h){if(h&&h.isTexture){let p=h.mapping,_=p===Vh||p===Hh,S=p===fs||p===Ys;if(_||S){let m=n.get(h),u=m!==void 0?m.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==u)return i===null&&(i=new Lf(t)),m=_?i.fromEquirectangular(h,m):i.fromCubemap(h,m),m.texture.pmremVersion=h.pmremVersion,n.set(h,m),m.texture;if(m!==void 0)return m.texture;{let g=h.image;return _&&g&&g.height>0||S&&g&&l(g)?(i===null&&(i=new Lf(t)),m=_?i.fromEquirectangular(h):i.fromCubemap(h),m.texture.pmremVersion=h.pmremVersion,n.set(h,m),h.addEventListener("dispose",f),m.texture):null}}}return h}function a(h,p){return p===Vh?h.mapping=fs:p===Hh&&(h.mapping=Ys),h}function l(h){let p=0,_=6;for(let S=0;S<_;S++)h[S]!==void 0&&p++;return p===_}function c(h){let p=h.target;p.removeEventListener("dispose",c);let _=e.get(p);_!==void 0&&(e.delete(p),_.dispose())}function f(h){let p=h.target;p.removeEventListener("dispose",f);let _=n.get(p);_!==void 0&&(n.delete(p),_.dispose())}function d(){e=new WeakMap,n=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:d}}function oA(t){let e={};function n(i){if(e[i]!==void 0)return e[i];let r=t.getExtension(i);return e[i]=r,r}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let r=n(i);return r===null&&hh("WebGLRenderer: "+i+" extension not supported."),r}}}function aA(t,e,n,i){let r={},s=new WeakMap;function o(d){let h=d.target;h.index!==null&&e.remove(h.index);for(let _ in h.attributes)e.remove(h.attributes[_]);h.removeEventListener("dispose",o),delete r[h.id];let p=s.get(h);p&&(e.remove(p),s.delete(h)),i.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,n.memory.geometries--}function a(d,h){return r[h.id]===!0||(h.addEventListener("dispose",o),r[h.id]=!0,n.memory.geometries++),h}function l(d){let h=d.attributes;for(let p in h)e.update(h[p],t.ARRAY_BUFFER)}function c(d){let h=[],p=d.index,_=d.attributes.position,S=0;if(_===void 0)return;if(p!==null){let g=p.array;S=p.version;for(let v=0,y=g.length;v<y;v+=3){let A=g[v+0],w=g[v+1],C=g[v+2];h.push(A,w,w,C,C,A)}}else{let g=_.array;S=_.version;for(let v=0,y=g.length/3-1;v<y;v+=3){let A=v+0,w=v+1,C=v+2;h.push(A,w,w,C,C,A)}}let m=new(_.count>=65535?Ml:Sl)(h,1);m.version=S;let u=s.get(d);u&&e.remove(u),s.set(d,m)}function f(d){let h=s.get(d);if(h){let p=d.index;p!==null&&h.version<p.version&&c(d)}else c(d);return s.get(d)}return{get:a,update:l,getWireframeAttribute:f}}function lA(t,e,n){let i;function r(d){i=d}let s,o;function a(d){s=d.type,o=d.bytesPerElement}function l(d,h){t.drawElements(i,h,s,d*o),n.update(h,i,1)}function c(d,h,p){p!==0&&(t.drawElementsInstanced(i,h,s,d*o,p),n.update(h,i,p))}function f(d,h,p){if(p===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,h,0,s,d,0,p);let S=0;for(let m=0;m<p;m++)S+=h[m];n.update(S,i,1)}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=f}function cA(t){let e={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(n.calls++,o){case t.TRIANGLES:n.triangles+=a*(s/3);break;case t.LINES:n.lines+=a*(s/2);break;case t.LINE_STRIP:n.lines+=a*(s-1);break;case t.LINE_LOOP:n.lines+=a*s;break;case t.POINTS:n.points+=a*s;break;default:Je("WebGLInfo: Unknown draw mode:",o);break}}function r(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:e,render:n,programs:null,autoReset:!0,reset:r,update:i}}function uA(t,e,n){let i=new WeakMap,r=new qt;function s(o,a,l){let c=o.morphTargetInfluences,f=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,d=f!==void 0?f.length:0,h=i.get(a);if(h===void 0||h.count!==d){let b=function(){C.dispose(),i.delete(a),a.removeEventListener("dispose",b)};h!==void 0&&h.texture.dispose();let p=a.morphAttributes.position!==void 0,_=a.morphAttributes.normal!==void 0,S=a.morphAttributes.color!==void 0,m=a.morphAttributes.position||[],u=a.morphAttributes.normal||[],g=a.morphAttributes.color||[],v=0;p===!0&&(v=1),_===!0&&(v=2),S===!0&&(v=3);let y=a.attributes.position.count*v,A=1;y>e.maxTextureSize&&(A=Math.ceil(y/e.maxTextureSize),y=e.maxTextureSize);let w=new Float32Array(y*A*4*d),C=new vl(w,y,A,d);C.type=Fi,C.needsUpdate=!0;let x=v*4;for(let P=0;P<d;P++){let R=m[P],F=u[P],G=g[P],X=y*A*4*P;for(let U=0;U<R.count;U++){let k=U*x;p===!0&&(r.fromBufferAttribute(R,U),w[X+k+0]=r.x,w[X+k+1]=r.y,w[X+k+2]=r.z,w[X+k+3]=0),_===!0&&(r.fromBufferAttribute(F,U),w[X+k+4]=r.x,w[X+k+5]=r.y,w[X+k+6]=r.z,w[X+k+7]=0),S===!0&&(r.fromBufferAttribute(G,U),w[X+k+8]=r.x,w[X+k+9]=r.y,w[X+k+10]=r.z,w[X+k+11]=G.itemSize===4?r.w:1)}}h={count:d,texture:C,size:new we(y,A)},i.set(a,h),a.addEventListener("dispose",b)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(t,"morphTexture",o.morphTexture,n);else{let p=0;for(let S=0;S<c.length;S++)p+=c[S];let _=a.morphTargetsRelative?1:1-p;l.getUniforms().setValue(t,"morphTargetBaseInfluence",_),l.getUniforms().setValue(t,"morphTargetInfluences",c)}l.getUniforms().setValue(t,"morphTargetsTexture",h.texture,n),l.getUniforms().setValue(t,"morphTargetsTextureSize",h.size)}return{update:s}}function hA(t,e,n,i,r){let s=new WeakMap;function o(c){let f=r.render.frame,d=c.geometry,h=e.get(c,d);if(s.get(h)!==f&&(e.update(h),s.set(h,f)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==f&&(n.update(c.instanceMatrix,t.ARRAY_BUFFER),c.instanceColor!==null&&n.update(c.instanceColor,t.ARRAY_BUFFER),s.set(c,f))),c.isSkinnedMesh){let p=c.skeleton;s.get(p)!==f&&(p.update(),s.set(p,f))}return h}function a(){s=new WeakMap}function l(c){let f=c.target;f.removeEventListener("dispose",l),i.releaseStatesOfObject(f),n.remove(f.instanceMatrix),f.instanceColor!==null&&n.remove(f.instanceColor)}return{update:o,dispose:a}}var fA={[Jm]:"LINEAR_TONE_MAPPING",[jm]:"REINHARD_TONE_MAPPING",[Qm]:"CINEON_TONE_MAPPING",[Xl]:"ACES_FILMIC_TONE_MAPPING",[tg]:"AGX_TONE_MAPPING",[ng]:"NEUTRAL_TONE_MAPPING",[eg]:"CUSTOM_TONE_MAPPING"};function dA(t,e,n,i,r){let s=new ii(e,n,{type:t,depthBuffer:i,stencilBuffer:r,depthTexture:i?new br(e,n):void 0}),o=new ii(e,n,{type:nr,depthBuffer:!1,stencilBuffer:!1}),a=new jt;a.setAttribute("position",new St([-1,3,0,-1,-1,0,3,-1,0],3)),a.setAttribute("uv",new St([0,2,0,0,2,0],2));let l=new wh({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),c=new zt(a,l),f=new na(-1,1,1,-1,0,1),d=null,h=null,p=!1,_,S=null,m=[],u=!1;this.setSize=function(g,v){s.setSize(g,v),o.setSize(g,v);for(let y=0;y<m.length;y++){let A=m[y];A.setSize&&A.setSize(g,v)}},this.setEffects=function(g){m=g,u=m.length>0&&m[0].isRenderPass===!0;let v=s.width,y=s.height;for(let A=0;A<m.length;A++){let w=m[A];w.setSize&&w.setSize(v,y)}},this.begin=function(g,v){if(p||g.toneMapping===Di&&m.length===0)return!1;if(S=v,v!==null){let y=v.width,A=v.height;(s.width!==y||s.height!==A)&&this.setSize(y,A)}return u===!1&&g.setRenderTarget(s),_=g.toneMapping,g.toneMapping=Di,!0},this.hasRenderPass=function(){return u},this.end=function(g,v){g.toneMapping=_,p=!0;let y=s,A=o;for(let w=0;w<m.length;w++){let C=m[w];if(C.enabled!==!1&&(C.render(g,A,y,v),C.needsSwap!==!1)){let x=y;y=A,A=x}}if(d!==g.outputColorSpace||h!==g.toneMapping){d=g.outputColorSpace,h=g.toneMapping,l.defines={},xt.getTransfer(d)===Tt&&(l.defines.SRGB_TRANSFER="");let w=fA[h];w&&(l.defines[w]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=y.texture,g.setRenderTarget(S),g.render(c,f),S=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){s.depthTexture&&s.depthTexture.dispose(),s.dispose(),o.dispose(),a.dispose(),l.dispose()}}var fS=new Fn,Pg=new br(1,1),dS=new vl,pS=new ph,mS=new El,Yy=[],Zy=[],$y=new Float32Array(16),Ky=new Float32Array(9),Jy=new Float32Array(4);function ca(t,e,n){let i=t[0];if(i<=0||i>0)return t;let r=e*n,s=Yy[r];if(s===void 0&&(s=new Float32Array(r),Yy[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=n,t[o].toArray(s,a)}return s}function sn(t,e){if(t.length!==e.length)return!1;for(let n=0,i=t.length;n<i;n++)if(t[n]!==e[n])return!1;return!0}function on(t,e){for(let n=0,i=e.length;n<i;n++)t[n]=e[n]}function Ff(t,e){let n=Zy[e];n===void 0&&(n=new Int32Array(e),Zy[e]=n);for(let i=0;i!==e;++i)n[i]=t.allocateTextureUnit();return n}function pA(t,e){let n=this.cache;n[0]!==e&&(t.uniform1f(this.addr,e),n[0]=e)}function mA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2f(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(sn(n,e))return;t.uniform2fv(this.addr,e),on(n,e)}}function gA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3f(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else if(e.r!==void 0)(n[0]!==e.r||n[1]!==e.g||n[2]!==e.b)&&(t.uniform3f(this.addr,e.r,e.g,e.b),n[0]=e.r,n[1]=e.g,n[2]=e.b);else{if(sn(n,e))return;t.uniform3fv(this.addr,e),on(n,e)}}function _A(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4f(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(sn(n,e))return;t.uniform4fv(this.addr,e),on(n,e)}}function vA(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(sn(n,e))return;t.uniformMatrix2fv(this.addr,!1,e),on(n,e)}else{if(sn(n,i))return;Jy.set(i),t.uniformMatrix2fv(this.addr,!1,Jy),on(n,i)}}function xA(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(sn(n,e))return;t.uniformMatrix3fv(this.addr,!1,e),on(n,e)}else{if(sn(n,i))return;Ky.set(i),t.uniformMatrix3fv(this.addr,!1,Ky),on(n,i)}}function yA(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(sn(n,e))return;t.uniformMatrix4fv(this.addr,!1,e),on(n,e)}else{if(sn(n,i))return;$y.set(i),t.uniformMatrix4fv(this.addr,!1,$y),on(n,i)}}function SA(t,e){let n=this.cache;n[0]!==e&&(t.uniform1i(this.addr,e),n[0]=e)}function MA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2i(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(sn(n,e))return;t.uniform2iv(this.addr,e),on(n,e)}}function wA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3i(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(sn(n,e))return;t.uniform3iv(this.addr,e),on(n,e)}}function EA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4i(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(sn(n,e))return;t.uniform4iv(this.addr,e),on(n,e)}}function TA(t,e){let n=this.cache;n[0]!==e&&(t.uniform1ui(this.addr,e),n[0]=e)}function bA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2ui(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(sn(n,e))return;t.uniform2uiv(this.addr,e),on(n,e)}}function AA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3ui(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(sn(n,e))return;t.uniform3uiv(this.addr,e),on(n,e)}}function CA(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4ui(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(sn(n,e))return;t.uniform4uiv(this.addr,e),on(n,e)}}function RA(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r);let s;this.type===t.SAMPLER_2D_SHADOW?(Pg.compareFunction=n.isReversedDepthBuffer()?Rf:Cf,s=Pg):s=fS,n.setTexture2D(e||s,r)}function PA(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture3D(e||pS,r)}function IA(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTextureCube(e||mS,r)}function LA(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture2DArray(e||dS,r)}function NA(t){switch(t){case 5126:return pA;case 35664:return mA;case 35665:return gA;case 35666:return _A;case 35674:return vA;case 35675:return xA;case 35676:return yA;case 5124:case 35670:return SA;case 35667:case 35671:return MA;case 35668:case 35672:return wA;case 35669:case 35673:return EA;case 5125:return TA;case 36294:return bA;case 36295:return AA;case 36296:return CA;case 35678:case 36198:case 36298:case 36306:case 35682:return RA;case 35679:case 36299:case 36307:return PA;case 35680:case 36300:case 36308:case 36293:return IA;case 36289:case 36303:case 36311:case 36292:return LA}}function DA(t,e){t.uniform1fv(this.addr,e)}function UA(t,e){let n=ca(e,this.size,2);t.uniform2fv(this.addr,n)}function FA(t,e){let n=ca(e,this.size,3);t.uniform3fv(this.addr,n)}function OA(t,e){let n=ca(e,this.size,4);t.uniform4fv(this.addr,n)}function BA(t,e){let n=ca(e,this.size,4);t.uniformMatrix2fv(this.addr,!1,n)}function kA(t,e){let n=ca(e,this.size,9);t.uniformMatrix3fv(this.addr,!1,n)}function zA(t,e){let n=ca(e,this.size,16);t.uniformMatrix4fv(this.addr,!1,n)}function VA(t,e){t.uniform1iv(this.addr,e)}function HA(t,e){t.uniform2iv(this.addr,e)}function GA(t,e){t.uniform3iv(this.addr,e)}function WA(t,e){t.uniform4iv(this.addr,e)}function XA(t,e){t.uniform1uiv(this.addr,e)}function qA(t,e){t.uniform2uiv(this.addr,e)}function YA(t,e){t.uniform3uiv(this.addr,e)}function ZA(t,e){t.uniform4uiv(this.addr,e)}function $A(t,e,n){let i=this.cache,r=e.length,s=Ff(n,r);sn(i,s)||(t.uniform1iv(this.addr,s),on(i,s));let o;this.type===t.SAMPLER_2D_SHADOW?o=Pg:o=fS;for(let a=0;a!==r;++a)n.setTexture2D(e[a]||o,s[a])}function KA(t,e,n){let i=this.cache,r=e.length,s=Ff(n,r);sn(i,s)||(t.uniform1iv(this.addr,s),on(i,s));for(let o=0;o!==r;++o)n.setTexture3D(e[o]||pS,s[o])}function JA(t,e,n){let i=this.cache,r=e.length,s=Ff(n,r);sn(i,s)||(t.uniform1iv(this.addr,s),on(i,s));for(let o=0;o!==r;++o)n.setTextureCube(e[o]||mS,s[o])}function jA(t,e,n){let i=this.cache,r=e.length,s=Ff(n,r);sn(i,s)||(t.uniform1iv(this.addr,s),on(i,s));for(let o=0;o!==r;++o)n.setTexture2DArray(e[o]||dS,s[o])}function QA(t){switch(t){case 5126:return DA;case 35664:return UA;case 35665:return FA;case 35666:return OA;case 35674:return BA;case 35675:return kA;case 35676:return zA;case 5124:case 35670:return VA;case 35667:case 35671:return HA;case 35668:case 35672:return GA;case 35669:case 35673:return WA;case 5125:return XA;case 36294:return qA;case 36295:return YA;case 36296:return ZA;case 35678:case 36198:case 36298:case 36306:case 35682:return $A;case 35679:case 36299:case 36307:return KA;case 35680:case 36300:case 36308:case 36293:return JA;case 36289:case 36303:case 36311:case 36292:return jA}}var Ig=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.setValue=NA(n.type)}},Lg=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=QA(n.type)}},Ng=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,n,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,n[a.id],i)}}},Cg=/(\w+)(\])?(\[|\.)?/g;function jy(t,e){t.seq.push(e),t.map[e.id]=e}function eC(t,e,n){let i=t.name,r=i.length;for(Cg.lastIndex=0;;){let s=Cg.exec(i),o=Cg.lastIndex,a=s[1],l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){jy(n,c===void 0?new Ig(a,t,e):new Lg(a,t,e));break}else{let d=n.map[a];d===void 0&&(d=new Ng(a),jy(n,d)),n=d}}}var la=class{constructor(e,n){this.seq=[],this.map={};let i=e.getProgramParameter(n,e.ACTIVE_UNIFORMS);for(let o=0;o<i;++o){let a=e.getActiveUniform(n,o),l=e.getUniformLocation(n,a.name);eC(a,l,this)}let r=[],s=[];for(let o of this.seq)o.type===e.SAMPLER_2D_SHADOW||o.type===e.SAMPLER_CUBE_SHADOW||o.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(o):s.push(o);r.length>0&&(this.seq=r.concat(s))}setValue(e,n,i,r){let s=this.map[n];s!==void 0&&s.setValue(e,i,r)}setOptional(e,n,i){let r=n[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,n,i,r){for(let s=0,o=n.length;s!==o;++s){let a=n[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,n){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in n&&i.push(o)}return i}};function Qy(t,e,n){let i=t.createShader(e);return t.shaderSource(i,n),t.compileShader(i),i}var tC=37297,nC=0;function iC(t,e){let n=t.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,n.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${n[o]}`)}return i.join(`
`)}var eS=new it;function rC(t){xt._getMatrix(eS,xt.workingColorSpace,t);let e=`mat3( ${eS.elements.map(n=>n.toFixed(4))} )`;switch(xt.getTransfer(t)){case gl:return[e,"LinearTransferOETF"];case Tt:return[e,"sRGBTransferOETF"];default:return $e("WebGLProgram: Unsupported color space: ",t),[e,"LinearTransferOETF"]}}function tS(t,e,n){let i=t.getShaderParameter(e,t.COMPILE_STATUS),s=(t.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return n.toUpperCase()+`

`+s+`

`+iC(t.getShaderSource(e),a)}else return s}function sC(t,e){let n=rC(e);return[`vec4 ${t}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}var oC={[Jm]:"Linear",[jm]:"Reinhard",[Qm]:"Cineon",[Xl]:"ACESFilmic",[tg]:"AgX",[ng]:"Neutral",[eg]:"Custom"};function aC(t,e){let n=oC[e];return n===void 0?($e("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+t+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+t+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var If=new N;function lC(){xt.getLuminanceCoefficients(If);let t=If.x.toFixed(4),e=If.y.toFixed(4),n=If.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${t}, ${e}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function cC(t){return[t.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",t.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(nc).join(`
`)}function uC(t){let e=[];for(let n in t){let i=t[n];i!==!1&&e.push("#define "+n+" "+i)}return e.join(`
`)}function hC(t,e){let n={},i=t.getProgramParameter(e,t.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=t.getActiveAttrib(e,r),o=s.name,a=1;s.type===t.FLOAT_MAT2&&(a=2),s.type===t.FLOAT_MAT3&&(a=3),s.type===t.FLOAT_MAT4&&(a=4),n[o]={type:s.type,location:t.getAttribLocation(e,o),locationSize:a}}return n}function nc(t){return t!==""}function nS(t,e){let n=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return t.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function iS(t,e){return t.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var fC=/^[ \t]*#include +<([\w\d./]+)>/gm;function Dg(t){return t.replace(fC,pC)}var dC=new Map;function pC(t,e){let n=ut[e];if(n===void 0){let i=dC.get(e);if(i!==void 0)n=ut[i],$e('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return Dg(n)}var mC=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function rS(t){return t.replace(mC,gC)}function gC(t,e,n,i){let r="";for(let s=parseInt(e);s<parseInt(n);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function sS(t){let e=`precision ${t.precision} float;
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
#define LOW_PRECISION`),e}var _C={[Wl]:"SHADOWMAP_TYPE_PCF",[ra]:"SHADOWMAP_TYPE_VSM"};function vC(t){return _C[t.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var xC={[fs]:"ENVMAP_TYPE_CUBE",[Ys]:"ENVMAP_TYPE_CUBE",[ql]:"ENVMAP_TYPE_CUBE_UV"};function yC(t){return t.envMap===!1?"ENVMAP_TYPE_CUBE":xC[t.envMapMode]||"ENVMAP_TYPE_CUBE"}var SC={[Ys]:"ENVMAP_MODE_REFRACTION"};function MC(t){return t.envMap===!1?"ENVMAP_MODE_REFLECTION":SC[t.envMapMode]||"ENVMAP_MODE_REFLECTION"}var wC={[Km]:"ENVMAP_BLENDING_MULTIPLY",[yy]:"ENVMAP_BLENDING_MIX",[Sy]:"ENVMAP_BLENDING_ADD"};function EC(t){return t.envMap===!1?"ENVMAP_BLENDING_NONE":wC[t.combine]||"ENVMAP_BLENDING_NONE"}function TC(t){let e=t.envMapCubeUVHeight;if(e===null)return null;let n=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,n),7*16)),texelHeight:i,maxMip:n}}function bC(t,e,n,i){let r=t.getContext(),s=n.defines,o=n.vertexShader,a=n.fragmentShader,l=vC(n),c=yC(n),f=MC(n),d=EC(n),h=TC(n),p=cC(n),_=uC(s),S=r.createProgram(),m,u,g=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(m=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_].filter(nc).join(`
`),m.length>0&&(m+=`
`),u=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_].filter(nc).join(`
`),u.length>0&&(u+=`
`)):(m=[sS(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+f:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexNormals?"#define HAS_NORMAL":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(nc).join(`
`),u=[sS(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+f:"",n.envMap?"#define "+d:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor?"#define USE_COLOR":"",n.vertexAlphas||n.batchingColor?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==Di?"#define TONE_MAPPING":"",n.toneMapping!==Di?ut.tonemapping_pars_fragment:"",n.toneMapping!==Di?aC("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",ut.colorspace_pars_fragment,sC("linearToOutputTexel",n.outputColorSpace),lC(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(nc).join(`
`)),o=Dg(o),o=nS(o,n),o=iS(o,n),a=Dg(a),a=nS(a,n),a=iS(a,n),o=rS(o),a=rS(a),n.isRawShaderMaterial!==!0&&(g=`#version 300 es
`,m=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,u=["#define varying in",n.glslVersion===hg?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===hg?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+u);let v=g+m+o,y=g+u+a,A=Qy(r,r.VERTEX_SHADER,v),w=Qy(r,r.FRAGMENT_SHADER,y);r.attachShader(S,A),r.attachShader(S,w),n.index0AttributeName!==void 0?r.bindAttribLocation(S,0,n.index0AttributeName):n.morphTargets===!0&&r.bindAttribLocation(S,0,"position"),r.linkProgram(S);function C(R){if(t.debug.checkShaderErrors){let F=r.getProgramInfoLog(S)||"",G=r.getShaderInfoLog(A)||"",X=r.getShaderInfoLog(w)||"",U=F.trim(),k=G.trim(),V=X.trim(),ne=!0,le=!0;if(r.getProgramParameter(S,r.LINK_STATUS)===!1)if(ne=!1,typeof t.debug.onShaderError=="function")t.debug.onShaderError(r,S,A,w);else{let me=tS(r,A,"vertex"),Ae=tS(r,w,"fragment");Je("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(S,r.VALIDATE_STATUS)+`

Material Name: `+R.name+`
Material Type: `+R.type+`

Program Info Log: `+U+`
`+me+`
`+Ae)}else U!==""?$e("WebGLProgram: Program Info Log:",U):(k===""||V==="")&&(le=!1);le&&(R.diagnostics={runnable:ne,programLog:U,vertexShader:{log:k,prefix:m},fragmentShader:{log:V,prefix:u}})}r.deleteShader(A),r.deleteShader(w),x=new la(r,S),b=hC(r,S)}let x;this.getUniforms=function(){return x===void 0&&C(this),x};let b;this.getAttributes=function(){return b===void 0&&C(this),b};let P=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return P===!1&&(P=r.getProgramParameter(S,tC)),P},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(S),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=nC++,this.cacheKey=e,this.usedTimes=1,this.program=S,this.vertexShader=A,this.fragmentShader=w,this}var AC=0,Ug=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let n=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(n),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let n=this.materialCache.get(e);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let n=this.materialCache,i=n.get(e);return i===void 0&&(i=new Set,n.set(e,i)),i}_getShaderStage(e){let n=this.shaderCache,i=n.get(e);return i===void 0&&(i=new Fg(e),n.set(e,i)),i}},Fg=class{constructor(e){this.id=AC++,this.code=e,this.usedTimes=0}};function CC(t){return t===ms||t===jl||t===Ql}function RC(t,e,n,i,r,s){let o=new Zo,a=new Ug,l=new Set,c=[],f=new Map,d=i.logarithmicDepthBuffer,h=i.precision,p={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(x){return l.add(x),x===0?"uv":`uv${x}`}function S(x,b,P,R,F,G){let X=R.fog,U=F.geometry,k=x.isMeshStandardMaterial||x.isMeshLambertMaterial||x.isMeshPhongMaterial?R.environment:null,V=x.isMeshStandardMaterial||x.isMeshLambertMaterial&&!x.envMap||x.isMeshPhongMaterial&&!x.envMap,ne=e.get(x.envMap||k,V),le=ne&&ne.mapping===ql?ne.image.height:null,me=p[x.type];x.precision!==null&&(h=i.getMaxPrecision(x.precision),h!==x.precision&&$e("WebGLProgram.getParameters:",x.precision,"not supported, using",h,"instead."));let Ae=U.morphAttributes.position||U.morphAttributes.normal||U.morphAttributes.color,Fe=Ae!==void 0?Ae.length:0,Qe=0;U.morphAttributes.position!==void 0&&(Qe=1),U.morphAttributes.normal!==void 0&&(Qe=2),U.morphAttributes.color!==void 0&&(Qe=3);let vt,et,Q,xe;if(me){let We=rr[me];vt=We.vertexShader,et=We.fragmentShader}else vt=x.vertexShader,et=x.fragmentShader,a.update(x),Q=a.getVertexShaderID(x),xe=a.getFragmentShaderID(x);let ce=t.getRenderTarget(),Be=t.state.buffers.depth.getReversed(),qe=F.isInstancedMesh===!0,Ye=F.isBatchedMesh===!0,ht=!!x.map,Le=!!x.matcap,ie=!!ne,re=!!x.aoMap,J=!!x.lightMap,ye=!!x.bumpMap,ve=!!x.normalMap,Xe=!!x.displacementMap,L=!!x.emissiveMap,je=!!x.metalnessMap,Oe=!!x.roughnessMap,Ke=x.anisotropy>0,he=x.clearcoat>0,yt=x.dispersion>0,T=x.iridescence>0,M=x.sheen>0,B=x.transmission>0,$=Ke&&!!x.anisotropyMap,se=he&&!!x.clearcoatMap,de=he&&!!x.clearcoatNormalMap,pe=he&&!!x.clearcoatRoughnessMap,Y=T&&!!x.iridescenceMap,j=T&&!!x.iridescenceThicknessMap,Te=M&&!!x.sheenColorMap,Pe=M&&!!x.sheenRoughnessMap,_e=!!x.specularMap,fe=!!x.specularColorMap,nt=!!x.specularIntensityMap,st=B&&!!x.transmissionMap,ct=B&&!!x.thicknessMap,D=!!x.gradientMap,ge=!!x.alphaMap,K=x.alphaTest>0,Re=!!x.alphaHash,ae=!!x.extensions,oe=Di;x.toneMapped&&(ce===null||ce.isXRRenderTarget===!0)&&(oe=t.toneMapping);let ke={shaderID:me,shaderType:x.type,shaderName:x.name,vertexShader:vt,fragmentShader:et,defines:x.defines,customVertexShaderID:Q,customFragmentShaderID:xe,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:h,batching:Ye,batchingColor:Ye&&F._colorsTexture!==null,instancing:qe,instancingColor:qe&&F.instanceColor!==null,instancingMorph:qe&&F.morphTexture!==null,outputColorSpace:ce===null?t.outputColorSpace:ce.isXRRenderTarget===!0?ce.texture.colorSpace:xt.workingColorSpace,alphaToCoverage:!!x.alphaToCoverage,map:ht,matcap:Le,envMap:ie,envMapMode:ie&&ne.mapping,envMapCubeUVHeight:le,aoMap:re,lightMap:J,bumpMap:ye,normalMap:ve,displacementMap:Xe,emissiveMap:L,normalMapObjectSpace:ve&&x.normalMapType===Ey,normalMapTangentSpace:ve&&x.normalMapType===Af,packedNormalMap:ve&&x.normalMapType===Af&&CC(x.normalMap.format),metalnessMap:je,roughnessMap:Oe,anisotropy:Ke,anisotropyMap:$,clearcoat:he,clearcoatMap:se,clearcoatNormalMap:de,clearcoatRoughnessMap:pe,dispersion:yt,iridescence:T,iridescenceMap:Y,iridescenceThicknessMap:j,sheen:M,sheenColorMap:Te,sheenRoughnessMap:Pe,specularMap:_e,specularColorMap:fe,specularIntensityMap:nt,transmission:B,transmissionMap:st,thicknessMap:ct,gradientMap:D,opaque:x.transparent===!1&&x.blending===Hs&&x.alphaToCoverage===!1,alphaMap:ge,alphaTest:K,alphaHash:Re,combine:x.combine,mapUv:ht&&_(x.map.channel),aoMapUv:re&&_(x.aoMap.channel),lightMapUv:J&&_(x.lightMap.channel),bumpMapUv:ye&&_(x.bumpMap.channel),normalMapUv:ve&&_(x.normalMap.channel),displacementMapUv:Xe&&_(x.displacementMap.channel),emissiveMapUv:L&&_(x.emissiveMap.channel),metalnessMapUv:je&&_(x.metalnessMap.channel),roughnessMapUv:Oe&&_(x.roughnessMap.channel),anisotropyMapUv:$&&_(x.anisotropyMap.channel),clearcoatMapUv:se&&_(x.clearcoatMap.channel),clearcoatNormalMapUv:de&&_(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:pe&&_(x.clearcoatRoughnessMap.channel),iridescenceMapUv:Y&&_(x.iridescenceMap.channel),iridescenceThicknessMapUv:j&&_(x.iridescenceThicknessMap.channel),sheenColorMapUv:Te&&_(x.sheenColorMap.channel),sheenRoughnessMapUv:Pe&&_(x.sheenRoughnessMap.channel),specularMapUv:_e&&_(x.specularMap.channel),specularColorMapUv:fe&&_(x.specularColorMap.channel),specularIntensityMapUv:nt&&_(x.specularIntensityMap.channel),transmissionMapUv:st&&_(x.transmissionMap.channel),thicknessMapUv:ct&&_(x.thicknessMap.channel),alphaMapUv:ge&&_(x.alphaMap.channel),vertexTangents:!!U.attributes.tangent&&(ve||Ke),vertexNormals:!!U.attributes.normal,vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!U.attributes.color&&U.attributes.color.itemSize===4,pointsUvs:F.isPoints===!0&&!!U.attributes.uv&&(ht||ge),fog:!!X,useFog:x.fog===!0,fogExp2:!!X&&X.isFogExp2,flatShading:x.wireframe===!1&&(x.flatShading===!0||U.attributes.normal===void 0&&ve===!1&&(x.isMeshLambertMaterial||x.isMeshPhongMaterial||x.isMeshStandardMaterial||x.isMeshPhysicalMaterial)),sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:Be,skinning:F.isSkinnedMesh===!0,morphTargets:U.morphAttributes.position!==void 0,morphNormals:U.morphAttributes.normal!==void 0,morphColors:U.morphAttributes.color!==void 0,morphTargetsCount:Fe,morphTextureStride:Qe,numDirLights:b.directional.length,numPointLights:b.point.length,numSpotLights:b.spot.length,numSpotLightMaps:b.spotLightMap.length,numRectAreaLights:b.rectArea.length,numHemiLights:b.hemi.length,numDirLightShadows:b.directionalShadowMap.length,numPointLightShadows:b.pointShadowMap.length,numSpotLightShadows:b.spotShadowMap.length,numSpotLightShadowsWithMaps:b.numSpotLightShadowsWithMaps,numLightProbes:b.numLightProbes,numLightProbeGrids:G.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:x.dithering,shadowMapEnabled:t.shadowMap.enabled&&P.length>0,shadowMapType:t.shadowMap.type,toneMapping:oe,decodeVideoTexture:ht&&x.map.isVideoTexture===!0&&xt.getTransfer(x.map.colorSpace)===Tt,decodeVideoTextureEmissive:L&&x.emissiveMap.isVideoTexture===!0&&xt.getTransfer(x.emissiveMap.colorSpace)===Tt,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===er,flipSided:x.side===On,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:ae&&x.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(ae&&x.extensions.multiDraw===!0||Ye)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return ke.vertexUv1s=l.has(1),ke.vertexUv2s=l.has(2),ke.vertexUv3s=l.has(3),l.clear(),ke}function m(x){let b=[];if(x.shaderID?b.push(x.shaderID):(b.push(x.customVertexShaderID),b.push(x.customFragmentShaderID)),x.defines!==void 0)for(let P in x.defines)b.push(P),b.push(x.defines[P]);return x.isRawShaderMaterial===!1&&(u(b,x),g(b,x),b.push(t.outputColorSpace)),b.push(x.customProgramCacheKey),b.join()}function u(x,b){x.push(b.precision),x.push(b.outputColorSpace),x.push(b.envMapMode),x.push(b.envMapCubeUVHeight),x.push(b.mapUv),x.push(b.alphaMapUv),x.push(b.lightMapUv),x.push(b.aoMapUv),x.push(b.bumpMapUv),x.push(b.normalMapUv),x.push(b.displacementMapUv),x.push(b.emissiveMapUv),x.push(b.metalnessMapUv),x.push(b.roughnessMapUv),x.push(b.anisotropyMapUv),x.push(b.clearcoatMapUv),x.push(b.clearcoatNormalMapUv),x.push(b.clearcoatRoughnessMapUv),x.push(b.iridescenceMapUv),x.push(b.iridescenceThicknessMapUv),x.push(b.sheenColorMapUv),x.push(b.sheenRoughnessMapUv),x.push(b.specularMapUv),x.push(b.specularColorMapUv),x.push(b.specularIntensityMapUv),x.push(b.transmissionMapUv),x.push(b.thicknessMapUv),x.push(b.combine),x.push(b.fogExp2),x.push(b.sizeAttenuation),x.push(b.morphTargetsCount),x.push(b.morphAttributeCount),x.push(b.numDirLights),x.push(b.numPointLights),x.push(b.numSpotLights),x.push(b.numSpotLightMaps),x.push(b.numHemiLights),x.push(b.numRectAreaLights),x.push(b.numDirLightShadows),x.push(b.numPointLightShadows),x.push(b.numSpotLightShadows),x.push(b.numSpotLightShadowsWithMaps),x.push(b.numLightProbes),x.push(b.shadowMapType),x.push(b.toneMapping),x.push(b.numClippingPlanes),x.push(b.numClipIntersection),x.push(b.depthPacking)}function g(x,b){o.disableAll(),b.instancing&&o.enable(0),b.instancingColor&&o.enable(1),b.instancingMorph&&o.enable(2),b.matcap&&o.enable(3),b.envMap&&o.enable(4),b.normalMapObjectSpace&&o.enable(5),b.normalMapTangentSpace&&o.enable(6),b.clearcoat&&o.enable(7),b.iridescence&&o.enable(8),b.alphaTest&&o.enable(9),b.vertexColors&&o.enable(10),b.vertexAlphas&&o.enable(11),b.vertexUv1s&&o.enable(12),b.vertexUv2s&&o.enable(13),b.vertexUv3s&&o.enable(14),b.vertexTangents&&o.enable(15),b.anisotropy&&o.enable(16),b.alphaHash&&o.enable(17),b.batching&&o.enable(18),b.dispersion&&o.enable(19),b.batchingColor&&o.enable(20),b.gradientMap&&o.enable(21),b.packedNormalMap&&o.enable(22),b.vertexNormals&&o.enable(23),x.push(o.mask),o.disableAll(),b.fog&&o.enable(0),b.useFog&&o.enable(1),b.flatShading&&o.enable(2),b.logarithmicDepthBuffer&&o.enable(3),b.reversedDepthBuffer&&o.enable(4),b.skinning&&o.enable(5),b.morphTargets&&o.enable(6),b.morphNormals&&o.enable(7),b.morphColors&&o.enable(8),b.premultipliedAlpha&&o.enable(9),b.shadowMapEnabled&&o.enable(10),b.doubleSided&&o.enable(11),b.flipSided&&o.enable(12),b.useDepthPacking&&o.enable(13),b.dithering&&o.enable(14),b.transmission&&o.enable(15),b.sheen&&o.enable(16),b.opaque&&o.enable(17),b.pointsUvs&&o.enable(18),b.decodeVideoTexture&&o.enable(19),b.decodeVideoTextureEmissive&&o.enable(20),b.alphaToCoverage&&o.enable(21),b.numLightProbeGrids>0&&o.enable(22),x.push(o.mask)}function v(x){let b=p[x.type],P;if(b){let R=rr[b];P=zy.clone(R.uniforms)}else P=x.uniforms;return P}function y(x,b){let P=f.get(b);return P!==void 0?++P.usedTimes:(P=new bC(t,b,x,r),c.push(P),f.set(b,P)),P}function A(x){if(--x.usedTimes===0){let b=c.indexOf(x);c[b]=c[c.length-1],c.pop(),f.delete(x.cacheKey),x.destroy()}}function w(x){a.remove(x)}function C(){a.dispose()}return{getParameters:S,getProgramCacheKey:m,getUniforms:v,acquireProgram:y,releaseProgram:A,releaseShaderCache:w,programs:c,dispose:C}}function PC(){let t=new WeakMap;function e(o){return t.has(o)}function n(o){let a=t.get(o);return a===void 0&&(a={},t.set(o,a)),a}function i(o){t.delete(o)}function r(o,a,l){t.get(o)[a]=l}function s(){t=new WeakMap}return{has:e,get:n,remove:i,update:r,dispose:s}}function IC(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.material.id!==e.material.id?t.material.id-e.material.id:t.materialVariant!==e.materialVariant?t.materialVariant-e.materialVariant:t.z!==e.z?t.z-e.z:t.id-e.id}function oS(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.z!==e.z?e.z-t.z:t.id-e.id}function aS(){let t=[],e=0,n=[],i=[],r=[];function s(){e=0,n.length=0,i.length=0,r.length=0}function o(h){let p=0;return h.isInstancedMesh&&(p+=2),h.isSkinnedMesh&&(p+=1),p}function a(h,p,_,S,m,u){let g=t[e];return g===void 0?(g={id:h.id,object:h,geometry:p,material:_,materialVariant:o(h),groupOrder:S,renderOrder:h.renderOrder,z:m,group:u},t[e]=g):(g.id=h.id,g.object=h,g.geometry=p,g.material=_,g.materialVariant=o(h),g.groupOrder=S,g.renderOrder=h.renderOrder,g.z=m,g.group=u),e++,g}function l(h,p,_,S,m,u){let g=a(h,p,_,S,m,u);_.transmission>0?i.push(g):_.transparent===!0?r.push(g):n.push(g)}function c(h,p,_,S,m,u){let g=a(h,p,_,S,m,u);_.transmission>0?i.unshift(g):_.transparent===!0?r.unshift(g):n.unshift(g)}function f(h,p){n.length>1&&n.sort(h||IC),i.length>1&&i.sort(p||oS),r.length>1&&r.sort(p||oS)}function d(){for(let h=e,p=t.length;h<p;h++){let _=t[h];if(_.id===null)break;_.id=null,_.object=null,_.geometry=null,_.material=null,_.group=null}}return{opaque:n,transmissive:i,transparent:r,init:s,push:l,unshift:c,finish:d,sort:f}}function LC(){let t=new WeakMap;function e(i,r){let s=t.get(i),o;return s===void 0?(o=new aS,t.set(i,[o])):r>=s.length?(o=new aS,s.push(o)):o=s[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}function NC(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={direction:new N,color:new pt};break;case"SpotLight":n={position:new N,direction:new N,color:new pt,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new N,color:new pt,distance:0,decay:0};break;case"HemisphereLight":n={direction:new N,skyColor:new pt,groundColor:new pt};break;case"RectAreaLight":n={color:new pt,position:new N,halfWidth:new N,halfHeight:new N};break}return t[e.id]=n,n}}}function DC(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new we};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new we};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new we,shadowCameraNear:1,shadowCameraFar:1e3};break}return t[e.id]=n,n}}}var UC=0;function FC(t,e){return(e.castShadow?2:0)-(t.castShadow?2:0)+(e.map?1:0)-(t.map?1:0)}function OC(t){let e=new NC,n=DC(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new N);let r=new N,s=new bt,o=new bt;function a(c){let f=0,d=0,h=0;for(let b=0;b<9;b++)i.probe[b].set(0,0,0);let p=0,_=0,S=0,m=0,u=0,g=0,v=0,y=0,A=0,w=0,C=0;c.sort(FC);for(let b=0,P=c.length;b<P;b++){let R=c[b],F=R.color,G=R.intensity,X=R.distance,U=null;if(R.shadow&&R.shadow.map&&(R.shadow.map.texture.format===ms?U=R.shadow.map.texture:U=R.shadow.map.depthTexture||R.shadow.map.texture),R.isAmbientLight)f+=F.r*G,d+=F.g*G,h+=F.b*G;else if(R.isLightProbe){for(let k=0;k<9;k++)i.probe[k].addScaledVector(R.sh.coefficients[k],G);C++}else if(R.isDirectionalLight){let k=e.get(R);if(k.color.copy(R.color).multiplyScalar(R.intensity),R.castShadow){let V=R.shadow,ne=n.get(R);ne.shadowIntensity=V.intensity,ne.shadowBias=V.bias,ne.shadowNormalBias=V.normalBias,ne.shadowRadius=V.radius,ne.shadowMapSize=V.mapSize,i.directionalShadow[p]=ne,i.directionalShadowMap[p]=U,i.directionalShadowMatrix[p]=R.shadow.matrix,g++}i.directional[p]=k,p++}else if(R.isSpotLight){let k=e.get(R);k.position.setFromMatrixPosition(R.matrixWorld),k.color.copy(F).multiplyScalar(G),k.distance=X,k.coneCos=Math.cos(R.angle),k.penumbraCos=Math.cos(R.angle*(1-R.penumbra)),k.decay=R.decay,i.spot[S]=k;let V=R.shadow;if(R.map&&(i.spotLightMap[A]=R.map,A++,V.updateMatrices(R),R.castShadow&&w++),i.spotLightMatrix[S]=V.matrix,R.castShadow){let ne=n.get(R);ne.shadowIntensity=V.intensity,ne.shadowBias=V.bias,ne.shadowNormalBias=V.normalBias,ne.shadowRadius=V.radius,ne.shadowMapSize=V.mapSize,i.spotShadow[S]=ne,i.spotShadowMap[S]=U,y++}S++}else if(R.isRectAreaLight){let k=e.get(R);k.color.copy(F).multiplyScalar(G),k.halfWidth.set(R.width*.5,0,0),k.halfHeight.set(0,R.height*.5,0),i.rectArea[m]=k,m++}else if(R.isPointLight){let k=e.get(R);if(k.color.copy(R.color).multiplyScalar(R.intensity),k.distance=R.distance,k.decay=R.decay,R.castShadow){let V=R.shadow,ne=n.get(R);ne.shadowIntensity=V.intensity,ne.shadowBias=V.bias,ne.shadowNormalBias=V.normalBias,ne.shadowRadius=V.radius,ne.shadowMapSize=V.mapSize,ne.shadowCameraNear=V.camera.near,ne.shadowCameraFar=V.camera.far,i.pointShadow[_]=ne,i.pointShadowMap[_]=U,i.pointShadowMatrix[_]=R.shadow.matrix,v++}i.point[_]=k,_++}else if(R.isHemisphereLight){let k=e.get(R);k.skyColor.copy(R.color).multiplyScalar(G),k.groundColor.copy(R.groundColor).multiplyScalar(G),i.hemi[u]=k,u++}}m>0&&(t.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=Ee.LTC_FLOAT_1,i.rectAreaLTC2=Ee.LTC_FLOAT_2):(i.rectAreaLTC1=Ee.LTC_HALF_1,i.rectAreaLTC2=Ee.LTC_HALF_2)),i.ambient[0]=f,i.ambient[1]=d,i.ambient[2]=h;let x=i.hash;(x.directionalLength!==p||x.pointLength!==_||x.spotLength!==S||x.rectAreaLength!==m||x.hemiLength!==u||x.numDirectionalShadows!==g||x.numPointShadows!==v||x.numSpotShadows!==y||x.numSpotMaps!==A||x.numLightProbes!==C)&&(i.directional.length=p,i.spot.length=S,i.rectArea.length=m,i.point.length=_,i.hemi.length=u,i.directionalShadow.length=g,i.directionalShadowMap.length=g,i.pointShadow.length=v,i.pointShadowMap.length=v,i.spotShadow.length=y,i.spotShadowMap.length=y,i.directionalShadowMatrix.length=g,i.pointShadowMatrix.length=v,i.spotLightMatrix.length=y+A-w,i.spotLightMap.length=A,i.numSpotLightShadowsWithMaps=w,i.numLightProbes=C,x.directionalLength=p,x.pointLength=_,x.spotLength=S,x.rectAreaLength=m,x.hemiLength=u,x.numDirectionalShadows=g,x.numPointShadows=v,x.numSpotShadows=y,x.numSpotMaps=A,x.numLightProbes=C,i.version=UC++)}function l(c,f){let d=0,h=0,p=0,_=0,S=0,m=f.matrixWorldInverse;for(let u=0,g=c.length;u<g;u++){let v=c[u];if(v.isDirectionalLight){let y=i.directional[d];y.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),y.direction.sub(r),y.direction.transformDirection(m),d++}else if(v.isSpotLight){let y=i.spot[p];y.position.setFromMatrixPosition(v.matrixWorld),y.position.applyMatrix4(m),y.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),y.direction.sub(r),y.direction.transformDirection(m),p++}else if(v.isRectAreaLight){let y=i.rectArea[_];y.position.setFromMatrixPosition(v.matrixWorld),y.position.applyMatrix4(m),o.identity(),s.copy(v.matrixWorld),s.premultiply(m),o.extractRotation(s),y.halfWidth.set(v.width*.5,0,0),y.halfHeight.set(0,v.height*.5,0),y.halfWidth.applyMatrix4(o),y.halfHeight.applyMatrix4(o),_++}else if(v.isPointLight){let y=i.point[h];y.position.setFromMatrixPosition(v.matrixWorld),y.position.applyMatrix4(m),h++}else if(v.isHemisphereLight){let y=i.hemi[S];y.direction.setFromMatrixPosition(v.matrixWorld),y.direction.transformDirection(m),S++}}}return{setup:a,setupView:l,state:i}}function lS(t){let e=new OC(t),n=[],i=[],r=[];function s(h){d.camera=h,n.length=0,i.length=0,r.length=0}function o(h){n.push(h)}function a(h){i.push(h)}function l(h){r.push(h)}function c(){e.setup(n)}function f(h){e.setupView(n,h)}let d={lightsArray:n,shadowsArray:i,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:d,setupLights:c,setupLightsView:f,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function BC(t){let e=new WeakMap;function n(r,s=0){let o=e.get(r),a;return o===void 0?(a=new lS(t),e.set(r,[a])):s>=o.length?(a=new lS(t),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:n,dispose:i}}var kC=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,zC=`uniform sampler2D shadow_pass;
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
}`,VC=[new N(1,0,0),new N(-1,0,0),new N(0,1,0),new N(0,-1,0),new N(0,0,1),new N(0,0,-1)],HC=[new N(0,-1,0),new N(0,-1,0),new N(0,0,1),new N(0,0,-1),new N(0,-1,0),new N(0,-1,0)],cS=new bt,tc=new N,Rg=new N;function GC(t,e,n){let i=new Jo,r=new we,s=new we,o=new qt,a=new Eh,l=new Th,c={},f=n.maxTextureSize,d={[Tr]:On,[On]:Tr,[er]:er},h=new si({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new we},radius:{value:4}},vertexShader:kC,fragmentShader:zC}),p=h.clone();p.defines.HORIZONTAL_PASS=1;let _=new jt;_.setAttribute("position",new ni(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let S=new zt(_,h),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Wl;let u=this.type;this.render=function(w,C,x){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||w.length===0)return;this.type===zh&&($e("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=Wl);let b=t.getRenderTarget(),P=t.getActiveCubeFace(),R=t.getActiveMipmapLevel(),F=t.state;F.setBlending(tr),F.buffers.depth.getReversed()===!0?F.buffers.color.setClear(0,0,0,0):F.buffers.color.setClear(1,1,1,1),F.buffers.depth.setTest(!0),F.setScissorTest(!1);let G=u!==this.type;G&&C.traverse(function(X){X.material&&(Array.isArray(X.material)?X.material.forEach(U=>U.needsUpdate=!0):X.material.needsUpdate=!0)});for(let X=0,U=w.length;X<U;X++){let k=w[X],V=k.shadow;if(V===void 0){$e("WebGLShadowMap:",k,"has no shadow.");continue}if(V.autoUpdate===!1&&V.needsUpdate===!1)continue;r.copy(V.mapSize);let ne=V.getFrameExtents();r.multiply(ne),s.copy(V.mapSize),(r.x>f||r.y>f)&&(r.x>f&&(s.x=Math.floor(f/ne.x),r.x=s.x*ne.x,V.mapSize.x=s.x),r.y>f&&(s.y=Math.floor(f/ne.y),r.y=s.y*ne.y,V.mapSize.y=s.y));let le=t.state.buffers.depth.getReversed();if(V.camera._reversedDepth=le,V.map===null||G===!0){if(V.map!==null&&(V.map.depthTexture!==null&&(V.map.depthTexture.dispose(),V.map.depthTexture=null),V.map.dispose()),this.type===ra){if(k.isPointLight){$e("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}V.map=new ii(r.x,r.y,{format:ms,type:nr,minFilter:_n,magFilter:_n,generateMipmaps:!1}),V.map.texture.name=k.name+".shadowMap",V.map.depthTexture=new br(r.x,r.y,Fi),V.map.depthTexture.name=k.name+".shadowMapDepth",V.map.depthTexture.format=Zi,V.map.depthTexture.compareFunction=null,V.map.depthTexture.minFilter=hn,V.map.depthTexture.magFilter=hn}else k.isPointLight?(V.map=new Nf(r.x),V.map.depthTexture=new gh(r.x,Ui)):(V.map=new ii(r.x,r.y),V.map.depthTexture=new br(r.x,r.y,Ui)),V.map.depthTexture.name=k.name+".shadowMap",V.map.depthTexture.format=Zi,this.type===Wl?(V.map.depthTexture.compareFunction=le?Rf:Cf,V.map.depthTexture.minFilter=_n,V.map.depthTexture.magFilter=_n):(V.map.depthTexture.compareFunction=null,V.map.depthTexture.minFilter=hn,V.map.depthTexture.magFilter=hn);V.camera.updateProjectionMatrix()}let me=V.map.isWebGLCubeRenderTarget?6:1;for(let Ae=0;Ae<me;Ae++){if(V.map.isWebGLCubeRenderTarget)t.setRenderTarget(V.map,Ae),t.clear();else{Ae===0&&(t.setRenderTarget(V.map),t.clear());let Fe=V.getViewport(Ae);o.set(s.x*Fe.x,s.y*Fe.y,s.x*Fe.z,s.y*Fe.w),F.viewport(o)}if(k.isPointLight){let Fe=V.camera,Qe=V.matrix,vt=k.distance||Fe.far;vt!==Fe.far&&(Fe.far=vt,Fe.updateProjectionMatrix()),tc.setFromMatrixPosition(k.matrixWorld),Fe.position.copy(tc),Rg.copy(Fe.position),Rg.add(VC[Ae]),Fe.up.copy(HC[Ae]),Fe.lookAt(Rg),Fe.updateMatrixWorld(),Qe.makeTranslation(-tc.x,-tc.y,-tc.z),cS.multiplyMatrices(Fe.projectionMatrix,Fe.matrixWorldInverse),V._frustum.setFromProjectionMatrix(cS,Fe.coordinateSystem,Fe.reversedDepth)}else V.updateMatrices(k);i=V.getFrustum(),y(C,x,V.camera,k,this.type)}V.isPointLightShadow!==!0&&this.type===ra&&g(V,x),V.needsUpdate=!1}u=this.type,m.needsUpdate=!1,t.setRenderTarget(b,P,R)};function g(w,C){let x=e.update(S);h.defines.VSM_SAMPLES!==w.blurSamples&&(h.defines.VSM_SAMPLES=w.blurSamples,p.defines.VSM_SAMPLES=w.blurSamples,h.needsUpdate=!0,p.needsUpdate=!0),w.mapPass===null&&(w.mapPass=new ii(r.x,r.y,{format:ms,type:nr})),h.uniforms.shadow_pass.value=w.map.depthTexture,h.uniforms.resolution.value=w.mapSize,h.uniforms.radius.value=w.radius,t.setRenderTarget(w.mapPass),t.clear(),t.renderBufferDirect(C,null,x,h,S,null),p.uniforms.shadow_pass.value=w.mapPass.texture,p.uniforms.resolution.value=w.mapSize,p.uniforms.radius.value=w.radius,t.setRenderTarget(w.map),t.clear(),t.renderBufferDirect(C,null,x,p,S,null)}function v(w,C,x,b){let P=null,R=x.isPointLight===!0?w.customDistanceMaterial:w.customDepthMaterial;if(R!==void 0)P=R;else if(P=x.isPointLight===!0?l:a,t.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){let F=P.uuid,G=C.uuid,X=c[F];X===void 0&&(X={},c[F]=X);let U=X[G];U===void 0&&(U=P.clone(),X[G]=U,C.addEventListener("dispose",A)),P=U}if(P.visible=C.visible,P.wireframe=C.wireframe,b===ra?P.side=C.shadowSide!==null?C.shadowSide:C.side:P.side=C.shadowSide!==null?C.shadowSide:d[C.side],P.alphaMap=C.alphaMap,P.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,P.map=C.map,P.clipShadows=C.clipShadows,P.clippingPlanes=C.clippingPlanes,P.clipIntersection=C.clipIntersection,P.displacementMap=C.displacementMap,P.displacementScale=C.displacementScale,P.displacementBias=C.displacementBias,P.wireframeLinewidth=C.wireframeLinewidth,P.linewidth=C.linewidth,x.isPointLight===!0&&P.isMeshDistanceMaterial===!0){let F=t.properties.get(P);F.light=x}return P}function y(w,C,x,b,P){if(w.visible===!1)return;if(w.layers.test(C.layers)&&(w.isMesh||w.isLine||w.isPoints)&&(w.castShadow||w.receiveShadow&&P===ra)&&(!w.frustumCulled||i.intersectsObject(w))){w.modelViewMatrix.multiplyMatrices(x.matrixWorldInverse,w.matrixWorld);let G=e.update(w),X=w.material;if(Array.isArray(X)){let U=G.groups;for(let k=0,V=U.length;k<V;k++){let ne=U[k],le=X[ne.materialIndex];if(le&&le.visible){let me=v(w,le,b,P);w.onBeforeShadow(t,w,C,x,G,me,ne),t.renderBufferDirect(x,null,G,me,w,ne),w.onAfterShadow(t,w,C,x,G,me,ne)}}}else if(X.visible){let U=v(w,X,b,P);w.onBeforeShadow(t,w,C,x,G,U,null),t.renderBufferDirect(x,null,G,U,w,null),w.onAfterShadow(t,w,C,x,G,U,null)}}let F=w.children;for(let G=0,X=F.length;G<X;G++)y(F[G],C,x,b,P)}function A(w){w.target.removeEventListener("dispose",A);for(let x in c){let b=c[x],P=w.target.uuid;P in b&&(b[P].dispose(),delete b[P])}}}function WC(t,e){function n(){let D=!1,ge=new qt,K=null,Re=new qt(0,0,0,0);return{setMask:function(ae){K!==ae&&!D&&(t.colorMask(ae,ae,ae,ae),K=ae)},setLocked:function(ae){D=ae},setClear:function(ae,oe,ke,We,Rt){Rt===!0&&(ae*=We,oe*=We,ke*=We),ge.set(ae,oe,ke,We),Re.equals(ge)===!1&&(t.clearColor(ae,oe,ke,We),Re.copy(ge))},reset:function(){D=!1,K=null,Re.set(-1,0,0,0)}}}function i(){let D=!1,ge=!1,K=null,Re=null,ae=null;return{setReversed:function(oe){if(ge!==oe){let ke=e.get("EXT_clip_control");oe?ke.clipControlEXT(ke.LOWER_LEFT_EXT,ke.ZERO_TO_ONE_EXT):ke.clipControlEXT(ke.LOWER_LEFT_EXT,ke.NEGATIVE_ONE_TO_ONE_EXT),ge=oe;let We=ae;ae=null,this.setClear(We)}},getReversed:function(){return ge},setTest:function(oe){oe?ce(t.DEPTH_TEST):Be(t.DEPTH_TEST)},setMask:function(oe){K!==oe&&!D&&(t.depthMask(oe),K=oe)},setFunc:function(oe){if(ge&&(oe=Dy[oe]),Re!==oe){switch(oe){case nh:t.depthFunc(t.NEVER);break;case ih:t.depthFunc(t.ALWAYS);break;case rh:t.depthFunc(t.LESS);break;case Gs:t.depthFunc(t.LEQUAL);break;case sh:t.depthFunc(t.EQUAL);break;case oh:t.depthFunc(t.GEQUAL);break;case ah:t.depthFunc(t.GREATER);break;case lh:t.depthFunc(t.NOTEQUAL);break;default:t.depthFunc(t.LEQUAL)}Re=oe}},setLocked:function(oe){D=oe},setClear:function(oe){ae!==oe&&(ae=oe,ge&&(oe=1-oe),t.clearDepth(oe))},reset:function(){D=!1,K=null,Re=null,ae=null,ge=!1}}}function r(){let D=!1,ge=null,K=null,Re=null,ae=null,oe=null,ke=null,We=null,Rt=null;return{setTest:function(Mt){D||(Mt?ce(t.STENCIL_TEST):Be(t.STENCIL_TEST))},setMask:function(Mt){ge!==Mt&&!D&&(t.stencilMask(Mt),ge=Mt)},setFunc:function(Mt,Vt,An){(K!==Mt||Re!==Vt||ae!==An)&&(t.stencilFunc(Mt,Vt,An),K=Mt,Re=Vt,ae=An)},setOp:function(Mt,Vt,An){(oe!==Mt||ke!==Vt||We!==An)&&(t.stencilOp(Mt,Vt,An),oe=Mt,ke=Vt,We=An)},setLocked:function(Mt){D=Mt},setClear:function(Mt){Rt!==Mt&&(t.clearStencil(Mt),Rt=Mt)},reset:function(){D=!1,ge=null,K=null,Re=null,ae=null,oe=null,ke=null,We=null,Rt=null}}}let s=new n,o=new i,a=new r,l=new WeakMap,c=new WeakMap,f={},d={},h={},p=new WeakMap,_=[],S=null,m=!1,u=null,g=null,v=null,y=null,A=null,w=null,C=null,x=new pt(0,0,0),b=0,P=!1,R=null,F=null,G=null,X=null,U=null,k=t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS),V=!1,ne=0,le=t.getParameter(t.VERSION);le.indexOf("WebGL")!==-1?(ne=parseFloat(/^WebGL (\d)/.exec(le)[1]),V=ne>=1):le.indexOf("OpenGL ES")!==-1&&(ne=parseFloat(/^OpenGL ES (\d)/.exec(le)[1]),V=ne>=2);let me=null,Ae={},Fe=t.getParameter(t.SCISSOR_BOX),Qe=t.getParameter(t.VIEWPORT),vt=new qt().fromArray(Fe),et=new qt().fromArray(Qe);function Q(D,ge,K,Re){let ae=new Uint8Array(4),oe=t.createTexture();t.bindTexture(D,oe),t.texParameteri(D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(D,t.TEXTURE_MAG_FILTER,t.NEAREST);for(let ke=0;ke<K;ke++)D===t.TEXTURE_3D||D===t.TEXTURE_2D_ARRAY?t.texImage3D(ge,0,t.RGBA,1,1,Re,0,t.RGBA,t.UNSIGNED_BYTE,ae):t.texImage2D(ge+ke,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,ae);return oe}let xe={};xe[t.TEXTURE_2D]=Q(t.TEXTURE_2D,t.TEXTURE_2D,1),xe[t.TEXTURE_CUBE_MAP]=Q(t.TEXTURE_CUBE_MAP,t.TEXTURE_CUBE_MAP_POSITIVE_X,6),xe[t.TEXTURE_2D_ARRAY]=Q(t.TEXTURE_2D_ARRAY,t.TEXTURE_2D_ARRAY,1,1),xe[t.TEXTURE_3D]=Q(t.TEXTURE_3D,t.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),ce(t.DEPTH_TEST),o.setFunc(Gs),ye(!1),ve(qm),ce(t.CULL_FACE),re(tr);function ce(D){f[D]!==!0&&(t.enable(D),f[D]=!0)}function Be(D){f[D]!==!1&&(t.disable(D),f[D]=!1)}function qe(D,ge){return h[D]!==ge?(t.bindFramebuffer(D,ge),h[D]=ge,D===t.DRAW_FRAMEBUFFER&&(h[t.FRAMEBUFFER]=ge),D===t.FRAMEBUFFER&&(h[t.DRAW_FRAMEBUFFER]=ge),!0):!1}function Ye(D,ge){let K=_,Re=!1;if(D){K=p.get(ge),K===void 0&&(K=[],p.set(ge,K));let ae=D.textures;if(K.length!==ae.length||K[0]!==t.COLOR_ATTACHMENT0){for(let oe=0,ke=ae.length;oe<ke;oe++)K[oe]=t.COLOR_ATTACHMENT0+oe;K.length=ae.length,Re=!0}}else K[0]!==t.BACK&&(K[0]=t.BACK,Re=!0);Re&&t.drawBuffers(K)}function ht(D){return S!==D?(t.useProgram(D),S=D,!0):!1}let Le={[ss]:t.FUNC_ADD,[iy]:t.FUNC_SUBTRACT,[ry]:t.FUNC_REVERSE_SUBTRACT};Le[sy]=t.MIN,Le[oy]=t.MAX;let ie={[ay]:t.ZERO,[ly]:t.ONE,[cy]:t.SRC_COLOR,[eh]:t.SRC_ALPHA,[my]:t.SRC_ALPHA_SATURATE,[dy]:t.DST_COLOR,[hy]:t.DST_ALPHA,[uy]:t.ONE_MINUS_SRC_COLOR,[th]:t.ONE_MINUS_SRC_ALPHA,[py]:t.ONE_MINUS_DST_COLOR,[fy]:t.ONE_MINUS_DST_ALPHA,[gy]:t.CONSTANT_COLOR,[_y]:t.ONE_MINUS_CONSTANT_COLOR,[vy]:t.CONSTANT_ALPHA,[xy]:t.ONE_MINUS_CONSTANT_ALPHA};function re(D,ge,K,Re,ae,oe,ke,We,Rt,Mt){if(D===tr){m===!0&&(Be(t.BLEND),m=!1);return}if(m===!1&&(ce(t.BLEND),m=!0),D!==ny){if(D!==u||Mt!==P){if((g!==ss||A!==ss)&&(t.blendEquation(t.FUNC_ADD),g=ss,A=ss),Mt)switch(D){case Hs:t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case Ym:t.blendFunc(t.ONE,t.ONE);break;case Zm:t.blendFuncSeparate(t.ZERO,t.ONE_MINUS_SRC_COLOR,t.ZERO,t.ONE);break;case $m:t.blendFuncSeparate(t.DST_COLOR,t.ONE_MINUS_SRC_ALPHA,t.ZERO,t.ONE);break;default:Je("WebGLState: Invalid blending: ",D);break}else switch(D){case Hs:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case Ym:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE,t.ONE,t.ONE);break;case Zm:Je("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case $m:Je("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Je("WebGLState: Invalid blending: ",D);break}v=null,y=null,w=null,C=null,x.set(0,0,0),b=0,u=D,P=Mt}return}ae=ae||ge,oe=oe||K,ke=ke||Re,(ge!==g||ae!==A)&&(t.blendEquationSeparate(Le[ge],Le[ae]),g=ge,A=ae),(K!==v||Re!==y||oe!==w||ke!==C)&&(t.blendFuncSeparate(ie[K],ie[Re],ie[oe],ie[ke]),v=K,y=Re,w=oe,C=ke),(We.equals(x)===!1||Rt!==b)&&(t.blendColor(We.r,We.g,We.b,Rt),x.copy(We),b=Rt),u=D,P=!1}function J(D,ge){D.side===er?Be(t.CULL_FACE):ce(t.CULL_FACE);let K=D.side===On;ge&&(K=!K),ye(K),D.blending===Hs&&D.transparent===!1?re(tr):re(D.blending,D.blendEquation,D.blendSrc,D.blendDst,D.blendEquationAlpha,D.blendSrcAlpha,D.blendDstAlpha,D.blendColor,D.blendAlpha,D.premultipliedAlpha),o.setFunc(D.depthFunc),o.setTest(D.depthTest),o.setMask(D.depthWrite),s.setMask(D.colorWrite);let Re=D.stencilWrite;a.setTest(Re),Re&&(a.setMask(D.stencilWriteMask),a.setFunc(D.stencilFunc,D.stencilRef,D.stencilFuncMask),a.setOp(D.stencilFail,D.stencilZFail,D.stencilZPass)),L(D.polygonOffset,D.polygonOffsetFactor,D.polygonOffsetUnits),D.alphaToCoverage===!0?ce(t.SAMPLE_ALPHA_TO_COVERAGE):Be(t.SAMPLE_ALPHA_TO_COVERAGE)}function ye(D){R!==D&&(D?t.frontFace(t.CW):t.frontFace(t.CCW),R=D)}function ve(D){D!==ey?(ce(t.CULL_FACE),D!==F&&(D===qm?t.cullFace(t.BACK):D===ty?t.cullFace(t.FRONT):t.cullFace(t.FRONT_AND_BACK))):Be(t.CULL_FACE),F=D}function Xe(D){D!==G&&(V&&t.lineWidth(D),G=D)}function L(D,ge,K){D?(ce(t.POLYGON_OFFSET_FILL),(X!==ge||U!==K)&&(X=ge,U=K,o.getReversed()&&(ge=-ge),t.polygonOffset(ge,K))):Be(t.POLYGON_OFFSET_FILL)}function je(D){D?ce(t.SCISSOR_TEST):Be(t.SCISSOR_TEST)}function Oe(D){D===void 0&&(D=t.TEXTURE0+k-1),me!==D&&(t.activeTexture(D),me=D)}function Ke(D,ge,K){K===void 0&&(me===null?K=t.TEXTURE0+k-1:K=me);let Re=Ae[K];Re===void 0&&(Re={type:void 0,texture:void 0},Ae[K]=Re),(Re.type!==D||Re.texture!==ge)&&(me!==K&&(t.activeTexture(K),me=K),t.bindTexture(D,ge||xe[D]),Re.type=D,Re.texture=ge)}function he(){let D=Ae[me];D!==void 0&&D.type!==void 0&&(t.bindTexture(D.type,null),D.type=void 0,D.texture=void 0)}function yt(){try{t.compressedTexImage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function T(){try{t.compressedTexImage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function M(){try{t.texSubImage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function B(){try{t.texSubImage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function $(){try{t.compressedTexSubImage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function se(){try{t.compressedTexSubImage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function de(){try{t.texStorage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function pe(){try{t.texStorage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function Y(){try{t.texImage2D(...arguments)}catch(D){Je("WebGLState:",D)}}function j(){try{t.texImage3D(...arguments)}catch(D){Je("WebGLState:",D)}}function Te(D){return d[D]!==void 0?d[D]:t.getParameter(D)}function Pe(D,ge){d[D]!==ge&&(t.pixelStorei(D,ge),d[D]=ge)}function _e(D){vt.equals(D)===!1&&(t.scissor(D.x,D.y,D.z,D.w),vt.copy(D))}function fe(D){et.equals(D)===!1&&(t.viewport(D.x,D.y,D.z,D.w),et.copy(D))}function nt(D,ge){let K=c.get(ge);K===void 0&&(K=new WeakMap,c.set(ge,K));let Re=K.get(D);Re===void 0&&(Re=t.getUniformBlockIndex(ge,D.name),K.set(D,Re))}function st(D,ge){let Re=c.get(ge).get(D);l.get(ge)!==Re&&(t.uniformBlockBinding(ge,Re,D.__bindingPointIndex),l.set(ge,Re))}function ct(){t.disable(t.BLEND),t.disable(t.CULL_FACE),t.disable(t.DEPTH_TEST),t.disable(t.POLYGON_OFFSET_FILL),t.disable(t.SCISSOR_TEST),t.disable(t.STENCIL_TEST),t.disable(t.SAMPLE_ALPHA_TO_COVERAGE),t.blendEquation(t.FUNC_ADD),t.blendFunc(t.ONE,t.ZERO),t.blendFuncSeparate(t.ONE,t.ZERO,t.ONE,t.ZERO),t.blendColor(0,0,0,0),t.colorMask(!0,!0,!0,!0),t.clearColor(0,0,0,0),t.depthMask(!0),t.depthFunc(t.LESS),o.setReversed(!1),t.clearDepth(1),t.stencilMask(4294967295),t.stencilFunc(t.ALWAYS,0,4294967295),t.stencilOp(t.KEEP,t.KEEP,t.KEEP),t.clearStencil(0),t.cullFace(t.BACK),t.frontFace(t.CCW),t.polygonOffset(0,0),t.activeTexture(t.TEXTURE0),t.bindFramebuffer(t.FRAMEBUFFER,null),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),t.bindFramebuffer(t.READ_FRAMEBUFFER,null),t.useProgram(null),t.lineWidth(1),t.scissor(0,0,t.canvas.width,t.canvas.height),t.viewport(0,0,t.canvas.width,t.canvas.height),t.pixelStorei(t.PACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.BROWSER_DEFAULT_WEBGL),t.pixelStorei(t.PACK_ROW_LENGTH,0),t.pixelStorei(t.PACK_SKIP_PIXELS,0),t.pixelStorei(t.PACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_ROW_LENGTH,0),t.pixelStorei(t.UNPACK_IMAGE_HEIGHT,0),t.pixelStorei(t.UNPACK_SKIP_PIXELS,0),t.pixelStorei(t.UNPACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_SKIP_IMAGES,0),f={},d={},me=null,Ae={},h={},p=new WeakMap,_=[],S=null,m=!1,u=null,g=null,v=null,y=null,A=null,w=null,C=null,x=new pt(0,0,0),b=0,P=!1,R=null,F=null,G=null,X=null,U=null,vt.set(0,0,t.canvas.width,t.canvas.height),et.set(0,0,t.canvas.width,t.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:ce,disable:Be,bindFramebuffer:qe,drawBuffers:Ye,useProgram:ht,setBlending:re,setMaterial:J,setFlipSided:ye,setCullFace:ve,setLineWidth:Xe,setPolygonOffset:L,setScissorTest:je,activeTexture:Oe,bindTexture:Ke,unbindTexture:he,compressedTexImage2D:yt,compressedTexImage3D:T,texImage2D:Y,texImage3D:j,pixelStorei:Pe,getParameter:Te,updateUBOMapping:nt,uniformBlockBinding:st,texStorage2D:de,texStorage3D:pe,texSubImage2D:M,texSubImage3D:B,compressedTexSubImage2D:$,compressedTexSubImage3D:se,scissor:_e,viewport:fe,reset:ct}}function XC(t,e,n,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new we,f=new WeakMap,d=new Set,h,p=new WeakMap,_=!1;try{_=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function S(T,M){return _?new OffscreenCanvas(T,M):_l("canvas")}function m(T,M,B){let $=1,se=yt(T);if((se.width>B||se.height>B)&&($=B/Math.max(se.width,se.height)),$<1)if(typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&T instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&T instanceof ImageBitmap||typeof VideoFrame<"u"&&T instanceof VideoFrame){let de=Math.floor($*se.width),pe=Math.floor($*se.height);h===void 0&&(h=S(de,pe));let Y=M?S(de,pe):h;return Y.width=de,Y.height=pe,Y.getContext("2d").drawImage(T,0,0,de,pe),$e("WebGLRenderer: Texture has been resized from ("+se.width+"x"+se.height+") to ("+de+"x"+pe+")."),Y}else return"data"in T&&$e("WebGLRenderer: Image in DataTexture is too big ("+se.width+"x"+se.height+")."),T;return T}function u(T){return T.generateMipmaps}function g(T){t.generateMipmap(T)}function v(T){return T.isWebGLCubeRenderTarget?t.TEXTURE_CUBE_MAP:T.isWebGL3DRenderTarget?t.TEXTURE_3D:T.isWebGLArrayRenderTarget||T.isCompressedArrayTexture?t.TEXTURE_2D_ARRAY:t.TEXTURE_2D}function y(T,M,B,$,se,de=!1){if(T!==null){if(t[T]!==void 0)return t[T];$e("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+T+"'")}let pe;$&&(pe=e.get("EXT_texture_norm16"),pe||$e("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let Y=M;if(M===t.RED&&(B===t.FLOAT&&(Y=t.R32F),B===t.HALF_FLOAT&&(Y=t.R16F),B===t.UNSIGNED_BYTE&&(Y=t.R8),B===t.UNSIGNED_SHORT&&pe&&(Y=pe.R16_EXT),B===t.SHORT&&pe&&(Y=pe.R16_SNORM_EXT)),M===t.RED_INTEGER&&(B===t.UNSIGNED_BYTE&&(Y=t.R8UI),B===t.UNSIGNED_SHORT&&(Y=t.R16UI),B===t.UNSIGNED_INT&&(Y=t.R32UI),B===t.BYTE&&(Y=t.R8I),B===t.SHORT&&(Y=t.R16I),B===t.INT&&(Y=t.R32I)),M===t.RG&&(B===t.FLOAT&&(Y=t.RG32F),B===t.HALF_FLOAT&&(Y=t.RG16F),B===t.UNSIGNED_BYTE&&(Y=t.RG8),B===t.UNSIGNED_SHORT&&pe&&(Y=pe.RG16_EXT),B===t.SHORT&&pe&&(Y=pe.RG16_SNORM_EXT)),M===t.RG_INTEGER&&(B===t.UNSIGNED_BYTE&&(Y=t.RG8UI),B===t.UNSIGNED_SHORT&&(Y=t.RG16UI),B===t.UNSIGNED_INT&&(Y=t.RG32UI),B===t.BYTE&&(Y=t.RG8I),B===t.SHORT&&(Y=t.RG16I),B===t.INT&&(Y=t.RG32I)),M===t.RGB_INTEGER&&(B===t.UNSIGNED_BYTE&&(Y=t.RGB8UI),B===t.UNSIGNED_SHORT&&(Y=t.RGB16UI),B===t.UNSIGNED_INT&&(Y=t.RGB32UI),B===t.BYTE&&(Y=t.RGB8I),B===t.SHORT&&(Y=t.RGB16I),B===t.INT&&(Y=t.RGB32I)),M===t.RGBA_INTEGER&&(B===t.UNSIGNED_BYTE&&(Y=t.RGBA8UI),B===t.UNSIGNED_SHORT&&(Y=t.RGBA16UI),B===t.UNSIGNED_INT&&(Y=t.RGBA32UI),B===t.BYTE&&(Y=t.RGBA8I),B===t.SHORT&&(Y=t.RGBA16I),B===t.INT&&(Y=t.RGBA32I)),M===t.RGB&&(B===t.UNSIGNED_SHORT&&pe&&(Y=pe.RGB16_EXT),B===t.SHORT&&pe&&(Y=pe.RGB16_SNORM_EXT),B===t.UNSIGNED_INT_5_9_9_9_REV&&(Y=t.RGB9_E5),B===t.UNSIGNED_INT_10F_11F_11F_REV&&(Y=t.R11F_G11F_B10F)),M===t.RGBA){let j=de?gl:xt.getTransfer(se);B===t.FLOAT&&(Y=t.RGBA32F),B===t.HALF_FLOAT&&(Y=t.RGBA16F),B===t.UNSIGNED_BYTE&&(Y=j===Tt?t.SRGB8_ALPHA8:t.RGBA8),B===t.UNSIGNED_SHORT&&pe&&(Y=pe.RGBA16_EXT),B===t.SHORT&&pe&&(Y=pe.RGBA16_SNORM_EXT),B===t.UNSIGNED_SHORT_4_4_4_4&&(Y=t.RGBA4),B===t.UNSIGNED_SHORT_5_5_5_1&&(Y=t.RGB5_A1)}return(Y===t.R16F||Y===t.R32F||Y===t.RG16F||Y===t.RG32F||Y===t.RGBA16F||Y===t.RGBA32F)&&e.get("EXT_color_buffer_float"),Y}function A(T,M){let B;return T?M===null||M===Ui||M===oa?B=t.DEPTH24_STENCIL8:M===Fi?B=t.DEPTH32F_STENCIL8:M===sa&&(B=t.DEPTH24_STENCIL8,$e("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):M===null||M===Ui||M===oa?B=t.DEPTH_COMPONENT24:M===Fi?B=t.DEPTH_COMPONENT32F:M===sa&&(B=t.DEPTH_COMPONENT16),B}function w(T,M){return u(T)===!0||T.isFramebufferTexture&&T.minFilter!==hn&&T.minFilter!==_n?Math.log2(Math.max(M.width,M.height))+1:T.mipmaps!==void 0&&T.mipmaps.length>0?T.mipmaps.length:T.isCompressedTexture&&Array.isArray(T.image)?M.mipmaps.length:1}function C(T){let M=T.target;M.removeEventListener("dispose",C),b(M),M.isVideoTexture&&f.delete(M),M.isHTMLTexture&&d.delete(M)}function x(T){let M=T.target;M.removeEventListener("dispose",x),R(M)}function b(T){let M=i.get(T);if(M.__webglInit===void 0)return;let B=T.source,$=p.get(B);if($){let se=$[M.__cacheKey];se.usedTimes--,se.usedTimes===0&&P(T),Object.keys($).length===0&&p.delete(B)}i.remove(T)}function P(T){let M=i.get(T);t.deleteTexture(M.__webglTexture);let B=T.source,$=p.get(B);delete $[M.__cacheKey],o.memory.textures--}function R(T){let M=i.get(T);if(T.depthTexture&&(T.depthTexture.dispose(),i.remove(T.depthTexture)),T.isWebGLCubeRenderTarget)for(let $=0;$<6;$++){if(Array.isArray(M.__webglFramebuffer[$]))for(let se=0;se<M.__webglFramebuffer[$].length;se++)t.deleteFramebuffer(M.__webglFramebuffer[$][se]);else t.deleteFramebuffer(M.__webglFramebuffer[$]);M.__webglDepthbuffer&&t.deleteRenderbuffer(M.__webglDepthbuffer[$])}else{if(Array.isArray(M.__webglFramebuffer))for(let $=0;$<M.__webglFramebuffer.length;$++)t.deleteFramebuffer(M.__webglFramebuffer[$]);else t.deleteFramebuffer(M.__webglFramebuffer);if(M.__webglDepthbuffer&&t.deleteRenderbuffer(M.__webglDepthbuffer),M.__webglMultisampledFramebuffer&&t.deleteFramebuffer(M.__webglMultisampledFramebuffer),M.__webglColorRenderbuffer)for(let $=0;$<M.__webglColorRenderbuffer.length;$++)M.__webglColorRenderbuffer[$]&&t.deleteRenderbuffer(M.__webglColorRenderbuffer[$]);M.__webglDepthRenderbuffer&&t.deleteRenderbuffer(M.__webglDepthRenderbuffer)}let B=T.textures;for(let $=0,se=B.length;$<se;$++){let de=i.get(B[$]);de.__webglTexture&&(t.deleteTexture(de.__webglTexture),o.memory.textures--),i.remove(B[$])}i.remove(T)}let F=0;function G(){F=0}function X(){return F}function U(T){F=T}function k(){let T=F;return T>=r.maxTextures&&$e("WebGLTextures: Trying to use "+T+" texture units while this GPU supports only "+r.maxTextures),F+=1,T}function V(T){let M=[];return M.push(T.wrapS),M.push(T.wrapT),M.push(T.wrapR||0),M.push(T.magFilter),M.push(T.minFilter),M.push(T.anisotropy),M.push(T.internalFormat),M.push(T.format),M.push(T.type),M.push(T.generateMipmaps),M.push(T.premultiplyAlpha),M.push(T.flipY),M.push(T.unpackAlignment),M.push(T.colorSpace),M.join()}function ne(T,M){let B=i.get(T);if(T.isVideoTexture&&Ke(T),T.isRenderTargetTexture===!1&&T.isExternalTexture!==!0&&T.version>0&&B.__version!==T.version){let $=T.image;if($===null)$e("WebGLRenderer: Texture marked for update but no image data found.");else if($.complete===!1)$e("WebGLRenderer: Texture marked for update but image is incomplete");else{Be(B,T,M);return}}else T.isExternalTexture&&(B.__webglTexture=T.sourceTexture?T.sourceTexture:null);n.bindTexture(t.TEXTURE_2D,B.__webglTexture,t.TEXTURE0+M)}function le(T,M){let B=i.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&B.__version!==T.version){Be(B,T,M);return}else T.isExternalTexture&&(B.__webglTexture=T.sourceTexture?T.sourceTexture:null);n.bindTexture(t.TEXTURE_2D_ARRAY,B.__webglTexture,t.TEXTURE0+M)}function me(T,M){let B=i.get(T);if(T.isRenderTargetTexture===!1&&T.version>0&&B.__version!==T.version){Be(B,T,M);return}n.bindTexture(t.TEXTURE_3D,B.__webglTexture,t.TEXTURE0+M)}function Ae(T,M){let B=i.get(T);if(T.isCubeDepthTexture!==!0&&T.version>0&&B.__version!==T.version){qe(B,T,M);return}n.bindTexture(t.TEXTURE_CUBE_MAP,B.__webglTexture,t.TEXTURE0+M)}let Fe={[Ws]:t.REPEAT,[Yi]:t.CLAMP_TO_EDGE,[ch]:t.MIRRORED_REPEAT},Qe={[hn]:t.NEAREST,[My]:t.NEAREST_MIPMAP_NEAREST,[Yl]:t.NEAREST_MIPMAP_LINEAR,[_n]:t.LINEAR,[Gh]:t.LINEAR_MIPMAP_NEAREST,[ds]:t.LINEAR_MIPMAP_LINEAR},vt={[Ty]:t.NEVER,[Py]:t.ALWAYS,[by]:t.LESS,[Cf]:t.LEQUAL,[Ay]:t.EQUAL,[Rf]:t.GEQUAL,[Cy]:t.GREATER,[Ry]:t.NOTEQUAL};function et(T,M){if(M.type===Fi&&e.has("OES_texture_float_linear")===!1&&(M.magFilter===_n||M.magFilter===Gh||M.magFilter===Yl||M.magFilter===ds||M.minFilter===_n||M.minFilter===Gh||M.minFilter===Yl||M.minFilter===ds)&&$e("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),t.texParameteri(T,t.TEXTURE_WRAP_S,Fe[M.wrapS]),t.texParameteri(T,t.TEXTURE_WRAP_T,Fe[M.wrapT]),(T===t.TEXTURE_3D||T===t.TEXTURE_2D_ARRAY)&&t.texParameteri(T,t.TEXTURE_WRAP_R,Fe[M.wrapR]),t.texParameteri(T,t.TEXTURE_MAG_FILTER,Qe[M.magFilter]),t.texParameteri(T,t.TEXTURE_MIN_FILTER,Qe[M.minFilter]),M.compareFunction&&(t.texParameteri(T,t.TEXTURE_COMPARE_MODE,t.COMPARE_REF_TO_TEXTURE),t.texParameteri(T,t.TEXTURE_COMPARE_FUNC,vt[M.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(M.magFilter===hn||M.minFilter!==Yl&&M.minFilter!==ds||M.type===Fi&&e.has("OES_texture_float_linear")===!1)return;if(M.anisotropy>1||i.get(M).__currentAnisotropy){let B=e.get("EXT_texture_filter_anisotropic");t.texParameterf(T,B.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(M.anisotropy,r.getMaxAnisotropy())),i.get(M).__currentAnisotropy=M.anisotropy}}}function Q(T,M){let B=!1;T.__webglInit===void 0&&(T.__webglInit=!0,M.addEventListener("dispose",C));let $=M.source,se=p.get($);se===void 0&&(se={},p.set($,se));let de=V(M);if(de!==T.__cacheKey){se[de]===void 0&&(se[de]={texture:t.createTexture(),usedTimes:0},o.memory.textures++,B=!0),se[de].usedTimes++;let pe=se[T.__cacheKey];pe!==void 0&&(se[T.__cacheKey].usedTimes--,pe.usedTimes===0&&P(M)),T.__cacheKey=de,T.__webglTexture=se[de].texture}return B}function xe(T,M,B){return Math.floor(Math.floor(T/B)/M)}function ce(T,M,B,$){let de=T.updateRanges;if(de.length===0)n.texSubImage2D(t.TEXTURE_2D,0,0,0,M.width,M.height,B,$,M.data);else{de.sort((Pe,_e)=>Pe.start-_e.start);let pe=0;for(let Pe=1;Pe<de.length;Pe++){let _e=de[pe],fe=de[Pe],nt=_e.start+_e.count,st=xe(fe.start,M.width,4),ct=xe(_e.start,M.width,4);fe.start<=nt+1&&st===ct&&xe(fe.start+fe.count-1,M.width,4)===st?_e.count=Math.max(_e.count,fe.start+fe.count-_e.start):(++pe,de[pe]=fe)}de.length=pe+1;let Y=n.getParameter(t.UNPACK_ROW_LENGTH),j=n.getParameter(t.UNPACK_SKIP_PIXELS),Te=n.getParameter(t.UNPACK_SKIP_ROWS);n.pixelStorei(t.UNPACK_ROW_LENGTH,M.width);for(let Pe=0,_e=de.length;Pe<_e;Pe++){let fe=de[Pe],nt=Math.floor(fe.start/4),st=Math.ceil(fe.count/4),ct=nt%M.width,D=Math.floor(nt/M.width),ge=st,K=1;n.pixelStorei(t.UNPACK_SKIP_PIXELS,ct),n.pixelStorei(t.UNPACK_SKIP_ROWS,D),n.texSubImage2D(t.TEXTURE_2D,0,ct,D,ge,K,B,$,M.data)}T.clearUpdateRanges(),n.pixelStorei(t.UNPACK_ROW_LENGTH,Y),n.pixelStorei(t.UNPACK_SKIP_PIXELS,j),n.pixelStorei(t.UNPACK_SKIP_ROWS,Te)}}function Be(T,M,B){let $=t.TEXTURE_2D;(M.isDataArrayTexture||M.isCompressedArrayTexture)&&($=t.TEXTURE_2D_ARRAY),M.isData3DTexture&&($=t.TEXTURE_3D);let se=Q(T,M),de=M.source;n.bindTexture($,T.__webglTexture,t.TEXTURE0+B);let pe=i.get(de);if(de.version!==pe.__version||se===!0){if(n.activeTexture(t.TEXTURE0+B),(typeof ImageBitmap<"u"&&M.image instanceof ImageBitmap)===!1){let K=xt.getPrimaries(xt.workingColorSpace),Re=M.colorSpace===Ar?null:xt.getPrimaries(M.colorSpace),ae=M.colorSpace===Ar||K===Re?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,M.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,M.premultiplyAlpha),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,ae)}n.pixelStorei(t.UNPACK_ALIGNMENT,M.unpackAlignment);let j=m(M.image,!1,r.maxTextureSize);j=he(M,j);let Te=s.convert(M.format,M.colorSpace),Pe=s.convert(M.type),_e=y(M.internalFormat,Te,Pe,M.normalized,M.colorSpace,M.isVideoTexture);et($,M);let fe,nt=M.mipmaps,st=M.isVideoTexture!==!0,ct=pe.__version===void 0||se===!0,D=de.dataReady,ge=w(M,j);if(M.isDepthTexture)_e=A(M.format===ps,M.type),ct&&(st?n.texStorage2D(t.TEXTURE_2D,1,_e,j.width,j.height):n.texImage2D(t.TEXTURE_2D,0,_e,j.width,j.height,0,Te,Pe,null));else if(M.isDataTexture)if(nt.length>0){st&&ct&&n.texStorage2D(t.TEXTURE_2D,ge,_e,nt[0].width,nt[0].height);for(let K=0,Re=nt.length;K<Re;K++)fe=nt[K],st?D&&n.texSubImage2D(t.TEXTURE_2D,K,0,0,fe.width,fe.height,Te,Pe,fe.data):n.texImage2D(t.TEXTURE_2D,K,_e,fe.width,fe.height,0,Te,Pe,fe.data);M.generateMipmaps=!1}else st?(ct&&n.texStorage2D(t.TEXTURE_2D,ge,_e,j.width,j.height),D&&ce(M,j,Te,Pe)):n.texImage2D(t.TEXTURE_2D,0,_e,j.width,j.height,0,Te,Pe,j.data);else if(M.isCompressedTexture)if(M.isCompressedArrayTexture){st&&ct&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ge,_e,nt[0].width,nt[0].height,j.depth);for(let K=0,Re=nt.length;K<Re;K++)if(fe=nt[K],M.format!==gi)if(Te!==null)if(st){if(D)if(M.layerUpdates.size>0){let ae=vg(fe.width,fe.height,M.format,M.type);for(let oe of M.layerUpdates){let ke=fe.data.subarray(oe*ae/fe.data.BYTES_PER_ELEMENT,(oe+1)*ae/fe.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,K,0,0,oe,fe.width,fe.height,1,Te,ke)}M.clearLayerUpdates()}else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,K,0,0,0,fe.width,fe.height,j.depth,Te,fe.data)}else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY,K,_e,fe.width,fe.height,j.depth,0,fe.data,0,0);else $e("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else st?D&&n.texSubImage3D(t.TEXTURE_2D_ARRAY,K,0,0,0,fe.width,fe.height,j.depth,Te,Pe,fe.data):n.texImage3D(t.TEXTURE_2D_ARRAY,K,_e,fe.width,fe.height,j.depth,0,Te,Pe,fe.data)}else{st&&ct&&n.texStorage2D(t.TEXTURE_2D,ge,_e,nt[0].width,nt[0].height);for(let K=0,Re=nt.length;K<Re;K++)fe=nt[K],M.format!==gi?Te!==null?st?D&&n.compressedTexSubImage2D(t.TEXTURE_2D,K,0,0,fe.width,fe.height,Te,fe.data):n.compressedTexImage2D(t.TEXTURE_2D,K,_e,fe.width,fe.height,0,fe.data):$e("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):st?D&&n.texSubImage2D(t.TEXTURE_2D,K,0,0,fe.width,fe.height,Te,Pe,fe.data):n.texImage2D(t.TEXTURE_2D,K,_e,fe.width,fe.height,0,Te,Pe,fe.data)}else if(M.isDataArrayTexture)if(st){if(ct&&n.texStorage3D(t.TEXTURE_2D_ARRAY,ge,_e,j.width,j.height,j.depth),D)if(M.layerUpdates.size>0){let K=vg(j.width,j.height,M.format,M.type);for(let Re of M.layerUpdates){let ae=j.data.subarray(Re*K/j.data.BYTES_PER_ELEMENT,(Re+1)*K/j.data.BYTES_PER_ELEMENT);n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,Re,j.width,j.height,1,Te,Pe,ae)}M.clearLayerUpdates()}else n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,0,j.width,j.height,j.depth,Te,Pe,j.data)}else n.texImage3D(t.TEXTURE_2D_ARRAY,0,_e,j.width,j.height,j.depth,0,Te,Pe,j.data);else if(M.isData3DTexture)st?(ct&&n.texStorage3D(t.TEXTURE_3D,ge,_e,j.width,j.height,j.depth),D&&n.texSubImage3D(t.TEXTURE_3D,0,0,0,0,j.width,j.height,j.depth,Te,Pe,j.data)):n.texImage3D(t.TEXTURE_3D,0,_e,j.width,j.height,j.depth,0,Te,Pe,j.data);else if(M.isFramebufferTexture){if(ct)if(st)n.texStorage2D(t.TEXTURE_2D,ge,_e,j.width,j.height);else{let K=j.width,Re=j.height;for(let ae=0;ae<ge;ae++)n.texImage2D(t.TEXTURE_2D,ae,_e,K,Re,0,Te,Pe,null),K>>=1,Re>>=1}}else if(M.isHTMLTexture){if("texElementImage2D"in t){let K=t.canvas;if(K.hasAttribute("layoutsubtree")||K.setAttribute("layoutsubtree","true"),j.parentNode!==K){K.appendChild(j),d.add(M),K.onpaint=We=>{let Rt=We.changedElements;for(let Mt of d)Rt.includes(Mt.image)&&(Mt.needsUpdate=!0)},K.requestPaint();return}let Re=0,ae=t.RGBA,oe=t.RGBA,ke=t.UNSIGNED_BYTE;t.texElementImage2D(t.TEXTURE_2D,Re,ae,oe,ke,j),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE)}}else if(nt.length>0){if(st&&ct){let K=yt(nt[0]);n.texStorage2D(t.TEXTURE_2D,ge,_e,K.width,K.height)}for(let K=0,Re=nt.length;K<Re;K++)fe=nt[K],st?D&&n.texSubImage2D(t.TEXTURE_2D,K,0,0,Te,Pe,fe):n.texImage2D(t.TEXTURE_2D,K,_e,Te,Pe,fe);M.generateMipmaps=!1}else if(st){if(ct){let K=yt(j);n.texStorage2D(t.TEXTURE_2D,ge,_e,K.width,K.height)}D&&n.texSubImage2D(t.TEXTURE_2D,0,0,0,Te,Pe,j)}else n.texImage2D(t.TEXTURE_2D,0,_e,Te,Pe,j);u(M)&&g($),pe.__version=de.version,M.onUpdate&&M.onUpdate(M)}T.__version=M.version}function qe(T,M,B){if(M.image.length!==6)return;let $=Q(T,M),se=M.source;n.bindTexture(t.TEXTURE_CUBE_MAP,T.__webglTexture,t.TEXTURE0+B);let de=i.get(se);if(se.version!==de.__version||$===!0){n.activeTexture(t.TEXTURE0+B);let pe=xt.getPrimaries(xt.workingColorSpace),Y=M.colorSpace===Ar?null:xt.getPrimaries(M.colorSpace),j=M.colorSpace===Ar||pe===Y?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,M.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,M.premultiplyAlpha),n.pixelStorei(t.UNPACK_ALIGNMENT,M.unpackAlignment),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,j);let Te=M.isCompressedTexture||M.image[0].isCompressedTexture,Pe=M.image[0]&&M.image[0].isDataTexture,_e=[];for(let oe=0;oe<6;oe++)!Te&&!Pe?_e[oe]=m(M.image[oe],!0,r.maxCubemapSize):_e[oe]=Pe?M.image[oe].image:M.image[oe],_e[oe]=he(M,_e[oe]);let fe=_e[0],nt=s.convert(M.format,M.colorSpace),st=s.convert(M.type),ct=y(M.internalFormat,nt,st,M.normalized,M.colorSpace),D=M.isVideoTexture!==!0,ge=de.__version===void 0||$===!0,K=se.dataReady,Re=w(M,fe);et(t.TEXTURE_CUBE_MAP,M);let ae;if(Te){D&&ge&&n.texStorage2D(t.TEXTURE_CUBE_MAP,Re,ct,fe.width,fe.height);for(let oe=0;oe<6;oe++){ae=_e[oe].mipmaps;for(let ke=0;ke<ae.length;ke++){let We=ae[ke];M.format!==gi?nt!==null?D?K&&n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,ke,0,0,We.width,We.height,nt,We.data):n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,ke,ct,We.width,We.height,0,We.data):$e("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):D?K&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,ke,0,0,We.width,We.height,nt,st,We.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,ke,ct,We.width,We.height,0,nt,st,We.data)}}}else{if(ae=M.mipmaps,D&&ge){ae.length>0&&Re++;let oe=yt(_e[0]);n.texStorage2D(t.TEXTURE_CUBE_MAP,Re,ct,oe.width,oe.height)}for(let oe=0;oe<6;oe++)if(Pe){D?K&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,_e[oe].width,_e[oe].height,nt,st,_e[oe].data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,ct,_e[oe].width,_e[oe].height,0,nt,st,_e[oe].data);for(let ke=0;ke<ae.length;ke++){let Rt=ae[ke].image[oe].image;D?K&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,ke+1,0,0,Rt.width,Rt.height,nt,st,Rt.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,ke+1,ct,Rt.width,Rt.height,0,nt,st,Rt.data)}}else{D?K&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,nt,st,_e[oe]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,ct,nt,st,_e[oe]);for(let ke=0;ke<ae.length;ke++){let We=ae[ke];D?K&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,ke+1,0,0,nt,st,We.image[oe]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+oe,ke+1,ct,nt,st,We.image[oe])}}}u(M)&&g(t.TEXTURE_CUBE_MAP),de.__version=se.version,M.onUpdate&&M.onUpdate(M)}T.__version=M.version}function Ye(T,M,B,$,se,de){let pe=s.convert(B.format,B.colorSpace),Y=s.convert(B.type),j=y(B.internalFormat,pe,Y,B.normalized,B.colorSpace),Te=i.get(M),Pe=i.get(B);if(Pe.__renderTarget=M,!Te.__hasExternalTextures){let _e=Math.max(1,M.width>>de),fe=Math.max(1,M.height>>de);se===t.TEXTURE_3D||se===t.TEXTURE_2D_ARRAY?n.texImage3D(se,de,j,_e,fe,M.depth,0,pe,Y,null):n.texImage2D(se,de,j,_e,fe,0,pe,Y,null)}n.bindFramebuffer(t.FRAMEBUFFER,T),Oe(M)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,$,se,Pe.__webglTexture,0,je(M)):(se===t.TEXTURE_2D||se>=t.TEXTURE_CUBE_MAP_POSITIVE_X&&se<=t.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&t.framebufferTexture2D(t.FRAMEBUFFER,$,se,Pe.__webglTexture,de),n.bindFramebuffer(t.FRAMEBUFFER,null)}function ht(T,M,B){if(t.bindRenderbuffer(t.RENDERBUFFER,T),M.depthBuffer){let $=M.depthTexture,se=$&&$.isDepthTexture?$.type:null,de=A(M.stencilBuffer,se),pe=M.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;Oe(M)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,je(M),de,M.width,M.height):B?t.renderbufferStorageMultisample(t.RENDERBUFFER,je(M),de,M.width,M.height):t.renderbufferStorage(t.RENDERBUFFER,de,M.width,M.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,pe,t.RENDERBUFFER,T)}else{let $=M.textures;for(let se=0;se<$.length;se++){let de=$[se],pe=s.convert(de.format,de.colorSpace),Y=s.convert(de.type),j=y(de.internalFormat,pe,Y,de.normalized,de.colorSpace);Oe(M)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,je(M),j,M.width,M.height):B?t.renderbufferStorageMultisample(t.RENDERBUFFER,je(M),j,M.width,M.height):t.renderbufferStorage(t.RENDERBUFFER,j,M.width,M.height)}}t.bindRenderbuffer(t.RENDERBUFFER,null)}function Le(T,M,B){let $=M.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(t.FRAMEBUFFER,T),!(M.depthTexture&&M.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let se=i.get(M.depthTexture);if(se.__renderTarget=M,(!se.__webglTexture||M.depthTexture.image.width!==M.width||M.depthTexture.image.height!==M.height)&&(M.depthTexture.image.width=M.width,M.depthTexture.image.height=M.height,M.depthTexture.needsUpdate=!0),$){if(se.__webglInit===void 0&&(se.__webglInit=!0,M.depthTexture.addEventListener("dispose",C)),se.__webglTexture===void 0){se.__webglTexture=t.createTexture(),n.bindTexture(t.TEXTURE_CUBE_MAP,se.__webglTexture),et(t.TEXTURE_CUBE_MAP,M.depthTexture);let Te=s.convert(M.depthTexture.format),Pe=s.convert(M.depthTexture.type),_e;M.depthTexture.format===Zi?_e=t.DEPTH_COMPONENT24:M.depthTexture.format===ps&&(_e=t.DEPTH24_STENCIL8);for(let fe=0;fe<6;fe++)t.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+fe,0,_e,M.width,M.height,0,Te,Pe,null)}}else ne(M.depthTexture,0);let de=se.__webglTexture,pe=je(M),Y=$?t.TEXTURE_CUBE_MAP_POSITIVE_X+B:t.TEXTURE_2D,j=M.depthTexture.format===ps?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;if(M.depthTexture.format===Zi)Oe(M)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,j,Y,de,0,pe):t.framebufferTexture2D(t.FRAMEBUFFER,j,Y,de,0);else if(M.depthTexture.format===ps)Oe(M)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,j,Y,de,0,pe):t.framebufferTexture2D(t.FRAMEBUFFER,j,Y,de,0);else throw new Error("Unknown depthTexture format")}function ie(T){let M=i.get(T),B=T.isWebGLCubeRenderTarget===!0;if(M.__boundDepthTexture!==T.depthTexture){let $=T.depthTexture;if(M.__depthDisposeCallback&&M.__depthDisposeCallback(),$){let se=()=>{delete M.__boundDepthTexture,delete M.__depthDisposeCallback,$.removeEventListener("dispose",se)};$.addEventListener("dispose",se),M.__depthDisposeCallback=se}M.__boundDepthTexture=$}if(T.depthTexture&&!M.__autoAllocateDepthBuffer)if(B)for(let $=0;$<6;$++)Le(M.__webglFramebuffer[$],T,$);else{let $=T.texture.mipmaps;$&&$.length>0?Le(M.__webglFramebuffer[0],T,0):Le(M.__webglFramebuffer,T,0)}else if(B){M.__webglDepthbuffer=[];for(let $=0;$<6;$++)if(n.bindFramebuffer(t.FRAMEBUFFER,M.__webglFramebuffer[$]),M.__webglDepthbuffer[$]===void 0)M.__webglDepthbuffer[$]=t.createRenderbuffer(),ht(M.__webglDepthbuffer[$],T,!1);else{let se=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,de=M.__webglDepthbuffer[$];t.bindRenderbuffer(t.RENDERBUFFER,de),t.framebufferRenderbuffer(t.FRAMEBUFFER,se,t.RENDERBUFFER,de)}}else{let $=T.texture.mipmaps;if($&&$.length>0?n.bindFramebuffer(t.FRAMEBUFFER,M.__webglFramebuffer[0]):n.bindFramebuffer(t.FRAMEBUFFER,M.__webglFramebuffer),M.__webglDepthbuffer===void 0)M.__webglDepthbuffer=t.createRenderbuffer(),ht(M.__webglDepthbuffer,T,!1);else{let se=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,de=M.__webglDepthbuffer;t.bindRenderbuffer(t.RENDERBUFFER,de),t.framebufferRenderbuffer(t.FRAMEBUFFER,se,t.RENDERBUFFER,de)}}n.bindFramebuffer(t.FRAMEBUFFER,null)}function re(T,M,B){let $=i.get(T);M!==void 0&&Ye($.__webglFramebuffer,T,T.texture,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,0),B!==void 0&&ie(T)}function J(T){let M=T.texture,B=i.get(T),$=i.get(M);T.addEventListener("dispose",x);let se=T.textures,de=T.isWebGLCubeRenderTarget===!0,pe=se.length>1;if(pe||($.__webglTexture===void 0&&($.__webglTexture=t.createTexture()),$.__version=M.version,o.memory.textures++),de){B.__webglFramebuffer=[];for(let Y=0;Y<6;Y++)if(M.mipmaps&&M.mipmaps.length>0){B.__webglFramebuffer[Y]=[];for(let j=0;j<M.mipmaps.length;j++)B.__webglFramebuffer[Y][j]=t.createFramebuffer()}else B.__webglFramebuffer[Y]=t.createFramebuffer()}else{if(M.mipmaps&&M.mipmaps.length>0){B.__webglFramebuffer=[];for(let Y=0;Y<M.mipmaps.length;Y++)B.__webglFramebuffer[Y]=t.createFramebuffer()}else B.__webglFramebuffer=t.createFramebuffer();if(pe)for(let Y=0,j=se.length;Y<j;Y++){let Te=i.get(se[Y]);Te.__webglTexture===void 0&&(Te.__webglTexture=t.createTexture(),o.memory.textures++)}if(T.samples>0&&Oe(T)===!1){B.__webglMultisampledFramebuffer=t.createFramebuffer(),B.__webglColorRenderbuffer=[],n.bindFramebuffer(t.FRAMEBUFFER,B.__webglMultisampledFramebuffer);for(let Y=0;Y<se.length;Y++){let j=se[Y];B.__webglColorRenderbuffer[Y]=t.createRenderbuffer(),t.bindRenderbuffer(t.RENDERBUFFER,B.__webglColorRenderbuffer[Y]);let Te=s.convert(j.format,j.colorSpace),Pe=s.convert(j.type),_e=y(j.internalFormat,Te,Pe,j.normalized,j.colorSpace,T.isXRRenderTarget===!0),fe=je(T);t.renderbufferStorageMultisample(t.RENDERBUFFER,fe,_e,T.width,T.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Y,t.RENDERBUFFER,B.__webglColorRenderbuffer[Y])}t.bindRenderbuffer(t.RENDERBUFFER,null),T.depthBuffer&&(B.__webglDepthRenderbuffer=t.createRenderbuffer(),ht(B.__webglDepthRenderbuffer,T,!0)),n.bindFramebuffer(t.FRAMEBUFFER,null)}}if(de){n.bindTexture(t.TEXTURE_CUBE_MAP,$.__webglTexture),et(t.TEXTURE_CUBE_MAP,M);for(let Y=0;Y<6;Y++)if(M.mipmaps&&M.mipmaps.length>0)for(let j=0;j<M.mipmaps.length;j++)Ye(B.__webglFramebuffer[Y][j],T,M,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Y,j);else Ye(B.__webglFramebuffer[Y],T,M,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Y,0);u(M)&&g(t.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(pe){for(let Y=0,j=se.length;Y<j;Y++){let Te=se[Y],Pe=i.get(Te),_e=t.TEXTURE_2D;(T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(_e=T.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(_e,Pe.__webglTexture),et(_e,Te),Ye(B.__webglFramebuffer,T,Te,t.COLOR_ATTACHMENT0+Y,_e,0),u(Te)&&g(_e)}n.unbindTexture()}else{let Y=t.TEXTURE_2D;if((T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(Y=T.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(Y,$.__webglTexture),et(Y,M),M.mipmaps&&M.mipmaps.length>0)for(let j=0;j<M.mipmaps.length;j++)Ye(B.__webglFramebuffer[j],T,M,t.COLOR_ATTACHMENT0,Y,j);else Ye(B.__webglFramebuffer,T,M,t.COLOR_ATTACHMENT0,Y,0);u(M)&&g(Y),n.unbindTexture()}T.depthBuffer&&ie(T)}function ye(T){let M=T.textures;for(let B=0,$=M.length;B<$;B++){let se=M[B];if(u(se)){let de=v(T),pe=i.get(se).__webglTexture;n.bindTexture(de,pe),g(de),n.unbindTexture()}}}let ve=[],Xe=[];function L(T){if(T.samples>0){if(Oe(T)===!1){let M=T.textures,B=T.width,$=T.height,se=t.COLOR_BUFFER_BIT,de=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,pe=i.get(T),Y=M.length>1;if(Y)for(let Te=0;Te<M.length;Te++)n.bindFramebuffer(t.FRAMEBUFFER,pe.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Te,t.RENDERBUFFER,null),n.bindFramebuffer(t.FRAMEBUFFER,pe.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Te,t.TEXTURE_2D,null,0);n.bindFramebuffer(t.READ_FRAMEBUFFER,pe.__webglMultisampledFramebuffer);let j=T.texture.mipmaps;j&&j.length>0?n.bindFramebuffer(t.DRAW_FRAMEBUFFER,pe.__webglFramebuffer[0]):n.bindFramebuffer(t.DRAW_FRAMEBUFFER,pe.__webglFramebuffer);for(let Te=0;Te<M.length;Te++){if(T.resolveDepthBuffer&&(T.depthBuffer&&(se|=t.DEPTH_BUFFER_BIT),T.stencilBuffer&&T.resolveStencilBuffer&&(se|=t.STENCIL_BUFFER_BIT)),Y){t.framebufferRenderbuffer(t.READ_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.RENDERBUFFER,pe.__webglColorRenderbuffer[Te]);let Pe=i.get(M[Te]).__webglTexture;t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,Pe,0)}t.blitFramebuffer(0,0,B,$,0,0,B,$,se,t.NEAREST),l===!0&&(ve.length=0,Xe.length=0,ve.push(t.COLOR_ATTACHMENT0+Te),T.depthBuffer&&T.resolveDepthBuffer===!1&&(ve.push(de),Xe.push(de),t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,Xe)),t.invalidateFramebuffer(t.READ_FRAMEBUFFER,ve))}if(n.bindFramebuffer(t.READ_FRAMEBUFFER,null),n.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),Y)for(let Te=0;Te<M.length;Te++){n.bindFramebuffer(t.FRAMEBUFFER,pe.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Te,t.RENDERBUFFER,pe.__webglColorRenderbuffer[Te]);let Pe=i.get(M[Te]).__webglTexture;n.bindFramebuffer(t.FRAMEBUFFER,pe.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+Te,t.TEXTURE_2D,Pe,0)}n.bindFramebuffer(t.DRAW_FRAMEBUFFER,pe.__webglMultisampledFramebuffer)}else if(T.depthBuffer&&T.resolveDepthBuffer===!1&&l){let M=T.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,[M])}}}function je(T){return Math.min(r.maxSamples,T.samples)}function Oe(T){let M=i.get(T);return T.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&M.__useRenderToTexture!==!1}function Ke(T){let M=o.render.frame;f.get(T)!==M&&(f.set(T,M),T.update())}function he(T,M){let B=T.colorSpace,$=T.format,se=T.type;return T.isCompressedTexture===!0||T.isVideoTexture===!0||B!==ml&&B!==Ar&&(xt.getTransfer(B)===Tt?($!==gi||se!==Xn)&&$e("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Je("WebGLTextures: Unsupported texture color space:",B)),M}function yt(T){return typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement?(c.width=T.naturalWidth||T.width,c.height=T.naturalHeight||T.height):typeof VideoFrame<"u"&&T instanceof VideoFrame?(c.width=T.displayWidth,c.height=T.displayHeight):(c.width=T.width,c.height=T.height),c}this.allocateTextureUnit=k,this.resetTextureUnits=G,this.getTextureUnits=X,this.setTextureUnits=U,this.setTexture2D=ne,this.setTexture2DArray=le,this.setTexture3D=me,this.setTextureCube=Ae,this.rebindTextures=re,this.setupRenderTarget=J,this.updateRenderTargetMipmap=ye,this.updateMultisampleRenderTarget=L,this.setupDepthRenderbuffer=ie,this.setupFrameBufferTexture=Ye,this.useMultisampledRTT=Oe,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function qC(t,e){function n(i,r=Ar){let s,o=xt.getTransfer(r);if(i===Xn)return t.UNSIGNED_BYTE;if(i===Xh)return t.UNSIGNED_SHORT_4_4_4_4;if(i===qh)return t.UNSIGNED_SHORT_5_5_5_1;if(i===og)return t.UNSIGNED_INT_5_9_9_9_REV;if(i===ag)return t.UNSIGNED_INT_10F_11F_11F_REV;if(i===rg)return t.BYTE;if(i===sg)return t.SHORT;if(i===sa)return t.UNSIGNED_SHORT;if(i===Wh)return t.INT;if(i===Ui)return t.UNSIGNED_INT;if(i===Fi)return t.FLOAT;if(i===nr)return t.HALF_FLOAT;if(i===lg)return t.ALPHA;if(i===cg)return t.RGB;if(i===gi)return t.RGBA;if(i===Zi)return t.DEPTH_COMPONENT;if(i===ps)return t.DEPTH_STENCIL;if(i===ug)return t.RED;if(i===Yh)return t.RED_INTEGER;if(i===ms)return t.RG;if(i===Zh)return t.RG_INTEGER;if(i===$h)return t.RGBA_INTEGER;if(i===Zl||i===$l||i===Kl||i===Jl)if(o===Tt)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===Zl)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===$l)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===Kl)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===Jl)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===Zl)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===$l)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===Kl)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===Jl)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Kh||i===Jh||i===jh||i===Qh)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===Kh)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Jh)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===jh)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===Qh)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===ef||i===tf||i===nf||i===rf||i===sf||i===jl||i===of)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===ef||i===tf)return o===Tt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===nf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===rf)return s.COMPRESSED_R11_EAC;if(i===sf)return s.COMPRESSED_SIGNED_R11_EAC;if(i===jl)return s.COMPRESSED_RG11_EAC;if(i===of)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===af||i===lf||i===cf||i===uf||i===hf||i===ff||i===df||i===pf||i===mf||i===gf||i===_f||i===vf||i===xf||i===yf)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===af)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===lf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===cf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===uf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===hf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===ff)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===df)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===pf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===mf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===gf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===_f)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===vf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===xf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===yf)return o===Tt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Sf||i===Mf||i===wf)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===Sf)return o===Tt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===Mf)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===wf)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===Ef||i===Tf||i===Ql||i===bf)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===Ef)return s.COMPRESSED_RED_RGTC1_EXT;if(i===Tf)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===Ql)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===bf)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===oa?t.UNSIGNED_INT_24_8:t[i]!==void 0?t[i]:null}return{convert:n}}var YC=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,ZC=`
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

}`,Og=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,n){if(this.texture===null){let i=new bl(e.texture);(e.depthNear!==n.depthNear||e.depthFar!==n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let n=e.cameras[0].viewport,i=new si({vertexShader:YC,fragmentShader:ZC,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new zt(new Qi(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Bg=class extends $i{constructor(e,n){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,c=null,f=null,d=null,h=null,p=null,_=null,S=typeof XRWebGLBinding<"u",m=new Og,u={},g=n.getContextAttributes(),v=null,y=null,A=[],w=[],C=new we,x=null,b=new Tn;b.viewport=new qt;let P=new Tn;P.viewport=new qt;let R=[b,P],F=new Oh,G=null,X=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(Q){let xe=A[Q];return xe===void 0&&(xe=new $o,A[Q]=xe),xe.getTargetRaySpace()},this.getControllerGrip=function(Q){let xe=A[Q];return xe===void 0&&(xe=new $o,A[Q]=xe),xe.getGripSpace()},this.getHand=function(Q){let xe=A[Q];return xe===void 0&&(xe=new $o,A[Q]=xe),xe.getHandSpace()};function U(Q){let xe=w.indexOf(Q.inputSource);if(xe===-1)return;let ce=A[xe];ce!==void 0&&(ce.update(Q.inputSource,Q.frame,c||o),ce.dispatchEvent({type:Q.type,data:Q.inputSource}))}function k(){r.removeEventListener("select",U),r.removeEventListener("selectstart",U),r.removeEventListener("selectend",U),r.removeEventListener("squeeze",U),r.removeEventListener("squeezestart",U),r.removeEventListener("squeezeend",U),r.removeEventListener("end",k),r.removeEventListener("inputsourceschange",V);for(let Q=0;Q<A.length;Q++){let xe=w[Q];xe!==null&&(w[Q]=null,A[Q].disconnect(xe))}G=null,X=null,m.reset();for(let Q in u)delete u[Q];e.setRenderTarget(v),p=null,h=null,d=null,r=null,y=null,et.stop(),i.isPresenting=!1,e.setPixelRatio(x),e.setSize(C.width,C.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(Q){s=Q,i.isPresenting===!0&&$e("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(Q){a=Q,i.isPresenting===!0&&$e("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(Q){c=Q},this.getBaseLayer=function(){return h!==null?h:p},this.getBinding=function(){return d===null&&S&&(d=new XRWebGLBinding(r,n)),d},this.getFrame=function(){return _},this.getSession=function(){return r},this.setSession=async function(Q){if(r=Q,r!==null){if(v=e.getRenderTarget(),r.addEventListener("select",U),r.addEventListener("selectstart",U),r.addEventListener("selectend",U),r.addEventListener("squeeze",U),r.addEventListener("squeezestart",U),r.addEventListener("squeezeend",U),r.addEventListener("end",k),r.addEventListener("inputsourceschange",V),g.xrCompatible!==!0&&await n.makeXRCompatible(),x=e.getPixelRatio(),e.getSize(C),S&&"createProjectionLayer"in XRWebGLBinding.prototype){let ce=null,Be=null,qe=null;g.depth&&(qe=g.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,ce=g.stencil?ps:Zi,Be=g.stencil?oa:Ui);let Ye={colorFormat:n.RGBA8,depthFormat:qe,scaleFactor:s};d=this.getBinding(),h=d.createProjectionLayer(Ye),r.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),y=new ii(h.textureWidth,h.textureHeight,{format:gi,type:Xn,depthTexture:new br(h.textureWidth,h.textureHeight,Be,void 0,void 0,void 0,void 0,void 0,void 0,ce),stencilBuffer:g.stencil,colorSpace:e.outputColorSpace,samples:g.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1})}else{let ce={antialias:g.antialias,alpha:!0,depth:g.depth,stencil:g.stencil,framebufferScaleFactor:s};p=new XRWebGLLayer(r,n,ce),r.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),y=new ii(p.framebufferWidth,p.framebufferHeight,{format:gi,type:Xn,colorSpace:e.outputColorSpace,stencilBuffer:g.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),et.setContext(r),et.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function V(Q){for(let xe=0;xe<Q.removed.length;xe++){let ce=Q.removed[xe],Be=w.indexOf(ce);Be>=0&&(w[Be]=null,A[Be].disconnect(ce))}for(let xe=0;xe<Q.added.length;xe++){let ce=Q.added[xe],Be=w.indexOf(ce);if(Be===-1){for(let Ye=0;Ye<A.length;Ye++)if(Ye>=w.length){w.push(ce),Be=Ye;break}else if(w[Ye]===null){w[Ye]=ce,Be=Ye;break}if(Be===-1)break}let qe=A[Be];qe&&qe.connect(ce)}}let ne=new N,le=new N;function me(Q,xe,ce){ne.setFromMatrixPosition(xe.matrixWorld),le.setFromMatrixPosition(ce.matrixWorld);let Be=ne.distanceTo(le),qe=xe.projectionMatrix.elements,Ye=ce.projectionMatrix.elements,ht=qe[14]/(qe[10]-1),Le=qe[14]/(qe[10]+1),ie=(qe[9]+1)/qe[5],re=(qe[9]-1)/qe[5],J=(qe[8]-1)/qe[0],ye=(Ye[8]+1)/Ye[0],ve=ht*J,Xe=ht*ye,L=Be/(-J+ye),je=L*-J;if(xe.matrixWorld.decompose(Q.position,Q.quaternion,Q.scale),Q.translateX(je),Q.translateZ(L),Q.matrixWorld.compose(Q.position,Q.quaternion,Q.scale),Q.matrixWorldInverse.copy(Q.matrixWorld).invert(),qe[10]===-1)Q.projectionMatrix.copy(xe.projectionMatrix),Q.projectionMatrixInverse.copy(xe.projectionMatrixInverse);else{let Oe=ht+L,Ke=Le+L,he=ve-je,yt=Xe+(Be-je),T=ie*Le/Ke*Oe,M=re*Le/Ke*Oe;Q.projectionMatrix.makePerspective(he,yt,T,M,Oe,Ke),Q.projectionMatrixInverse.copy(Q.projectionMatrix).invert()}}function Ae(Q,xe){xe===null?Q.matrixWorld.copy(Q.matrix):Q.matrixWorld.multiplyMatrices(xe.matrixWorld,Q.matrix),Q.matrixWorldInverse.copy(Q.matrixWorld).invert()}this.updateCamera=function(Q){if(r===null)return;let xe=Q.near,ce=Q.far;m.texture!==null&&(m.depthNear>0&&(xe=m.depthNear),m.depthFar>0&&(ce=m.depthFar)),F.near=P.near=b.near=xe,F.far=P.far=b.far=ce,(G!==F.near||X!==F.far)&&(r.updateRenderState({depthNear:F.near,depthFar:F.far}),G=F.near,X=F.far),F.layers.mask=Q.layers.mask|6,b.layers.mask=F.layers.mask&-5,P.layers.mask=F.layers.mask&-3;let Be=Q.parent,qe=F.cameras;Ae(F,Be);for(let Ye=0;Ye<qe.length;Ye++)Ae(qe[Ye],Be);qe.length===2?me(F,b,P):F.projectionMatrix.copy(b.projectionMatrix),Fe(Q,F,Be)};function Fe(Q,xe,ce){ce===null?Q.matrix.copy(xe.matrixWorld):(Q.matrix.copy(ce.matrixWorld),Q.matrix.invert(),Q.matrix.multiply(xe.matrixWorld)),Q.matrix.decompose(Q.position,Q.quaternion,Q.scale),Q.updateMatrixWorld(!0),Q.projectionMatrix.copy(xe.projectionMatrix),Q.projectionMatrixInverse.copy(xe.projectionMatrixInverse),Q.isPerspectiveCamera&&(Q.fov=qo*2*Math.atan(1/Q.projectionMatrix.elements[5]),Q.zoom=1)}this.getCamera=function(){return F},this.getFoveation=function(){if(!(h===null&&p===null))return l},this.setFoveation=function(Q){l=Q,h!==null&&(h.fixedFoveation=Q),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=Q)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(F)},this.getCameraTexture=function(Q){return u[Q]};let Qe=null;function vt(Q,xe){if(f=xe.getViewerPose(c||o),_=xe,f!==null){let ce=f.views;p!==null&&(e.setRenderTargetFramebuffer(y,p.framebuffer),e.setRenderTarget(y));let Be=!1;ce.length!==F.cameras.length&&(F.cameras.length=0,Be=!0);for(let Le=0;Le<ce.length;Le++){let ie=ce[Le],re=null;if(p!==null)re=p.getViewport(ie);else{let ye=d.getViewSubImage(h,ie);re=ye.viewport,Le===0&&(e.setRenderTargetTextures(y,ye.colorTexture,ye.depthStencilTexture),e.setRenderTarget(y))}let J=R[Le];J===void 0&&(J=new Tn,J.layers.enable(Le),J.viewport=new qt,R[Le]=J),J.matrix.fromArray(ie.transform.matrix),J.matrix.decompose(J.position,J.quaternion,J.scale),J.projectionMatrix.fromArray(ie.projectionMatrix),J.projectionMatrixInverse.copy(J.projectionMatrix).invert(),J.viewport.set(re.x,re.y,re.width,re.height),Le===0&&(F.matrix.copy(J.matrix),F.matrix.decompose(F.position,F.quaternion,F.scale)),Be===!0&&F.cameras.push(J)}let qe=r.enabledFeatures;if(qe&&qe.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&S){d=i.getBinding();let Le=d.getDepthInformation(ce[0]);Le&&Le.isValid&&Le.texture&&m.init(Le,r.renderState)}if(qe&&qe.includes("camera-access")&&S){e.state.unbindTexture(),d=i.getBinding();for(let Le=0;Le<ce.length;Le++){let ie=ce[Le].camera;if(ie){let re=u[ie];re||(re=new bl,u[ie]=re);let J=d.getCameraImage(ie);re.sourceTexture=J}}}}for(let ce=0;ce<A.length;ce++){let Be=w[ce],qe=A[ce];Be!==null&&qe!==void 0&&qe.update(Be,xe,c||o)}Qe&&Qe(Q,xe),xe.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:xe}),_=null}let et=new uS;et.setAnimationLoop(vt),this.setAnimationLoop=function(Q){Qe=Q},this.dispose=function(){}}},$C=new bt,gS=new it;gS.set(-1,0,0,0,1,0,0,0,1);function KC(t,e){function n(m,u){m.matrixAutoUpdate===!0&&m.updateMatrix(),u.value.copy(m.matrix)}function i(m,u){u.color.getRGB(m.fogColor.value,mg(t)),u.isFog?(m.fogNear.value=u.near,m.fogFar.value=u.far):u.isFogExp2&&(m.fogDensity.value=u.density)}function r(m,u,g,v,y){u.isNodeMaterial?u.uniformsNeedUpdate=!1:u.isMeshBasicMaterial?s(m,u):u.isMeshLambertMaterial?(s(m,u),u.envMap&&(m.envMapIntensity.value=u.envMapIntensity)):u.isMeshToonMaterial?(s(m,u),d(m,u)):u.isMeshPhongMaterial?(s(m,u),f(m,u),u.envMap&&(m.envMapIntensity.value=u.envMapIntensity)):u.isMeshStandardMaterial?(s(m,u),h(m,u),u.isMeshPhysicalMaterial&&p(m,u,y)):u.isMeshMatcapMaterial?(s(m,u),_(m,u)):u.isMeshDepthMaterial?s(m,u):u.isMeshDistanceMaterial?(s(m,u),S(m,u)):u.isMeshNormalMaterial?s(m,u):u.isLineBasicMaterial?(o(m,u),u.isLineDashedMaterial&&a(m,u)):u.isPointsMaterial?l(m,u,g,v):u.isSpriteMaterial?c(m,u):u.isShadowMaterial?(m.color.value.copy(u.color),m.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function s(m,u){m.opacity.value=u.opacity,u.color&&m.diffuse.value.copy(u.color),u.emissive&&m.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(m.map.value=u.map,n(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,n(u.alphaMap,m.alphaMapTransform)),u.bumpMap&&(m.bumpMap.value=u.bumpMap,n(u.bumpMap,m.bumpMapTransform),m.bumpScale.value=u.bumpScale,u.side===On&&(m.bumpScale.value*=-1)),u.normalMap&&(m.normalMap.value=u.normalMap,n(u.normalMap,m.normalMapTransform),m.normalScale.value.copy(u.normalScale),u.side===On&&m.normalScale.value.negate()),u.displacementMap&&(m.displacementMap.value=u.displacementMap,n(u.displacementMap,m.displacementMapTransform),m.displacementScale.value=u.displacementScale,m.displacementBias.value=u.displacementBias),u.emissiveMap&&(m.emissiveMap.value=u.emissiveMap,n(u.emissiveMap,m.emissiveMapTransform)),u.specularMap&&(m.specularMap.value=u.specularMap,n(u.specularMap,m.specularMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest);let g=e.get(u),v=g.envMap,y=g.envMapRotation;v&&(m.envMap.value=v,m.envMapRotation.value.setFromMatrix4($C.makeRotationFromEuler(y)).transpose(),v.isCubeTexture&&v.isRenderTargetTexture===!1&&m.envMapRotation.value.premultiply(gS),m.reflectivity.value=u.reflectivity,m.ior.value=u.ior,m.refractionRatio.value=u.refractionRatio),u.lightMap&&(m.lightMap.value=u.lightMap,m.lightMapIntensity.value=u.lightMapIntensity,n(u.lightMap,m.lightMapTransform)),u.aoMap&&(m.aoMap.value=u.aoMap,m.aoMapIntensity.value=u.aoMapIntensity,n(u.aoMap,m.aoMapTransform))}function o(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,u.map&&(m.map.value=u.map,n(u.map,m.mapTransform))}function a(m,u){m.dashSize.value=u.dashSize,m.totalSize.value=u.dashSize+u.gapSize,m.scale.value=u.scale}function l(m,u,g,v){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.size.value=u.size*g,m.scale.value=v*.5,u.map&&(m.map.value=u.map,n(u.map,m.uvTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,n(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function c(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.rotation.value=u.rotation,u.map&&(m.map.value=u.map,n(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,n(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function f(m,u){m.specular.value.copy(u.specular),m.shininess.value=Math.max(u.shininess,1e-4)}function d(m,u){u.gradientMap&&(m.gradientMap.value=u.gradientMap)}function h(m,u){m.metalness.value=u.metalness,u.metalnessMap&&(m.metalnessMap.value=u.metalnessMap,n(u.metalnessMap,m.metalnessMapTransform)),m.roughness.value=u.roughness,u.roughnessMap&&(m.roughnessMap.value=u.roughnessMap,n(u.roughnessMap,m.roughnessMapTransform)),u.envMap&&(m.envMapIntensity.value=u.envMapIntensity)}function p(m,u,g){m.ior.value=u.ior,u.sheen>0&&(m.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),m.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(m.sheenColorMap.value=u.sheenColorMap,n(u.sheenColorMap,m.sheenColorMapTransform)),u.sheenRoughnessMap&&(m.sheenRoughnessMap.value=u.sheenRoughnessMap,n(u.sheenRoughnessMap,m.sheenRoughnessMapTransform))),u.clearcoat>0&&(m.clearcoat.value=u.clearcoat,m.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(m.clearcoatMap.value=u.clearcoatMap,n(u.clearcoatMap,m.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,n(u.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(m.clearcoatNormalMap.value=u.clearcoatNormalMap,n(u.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===On&&m.clearcoatNormalScale.value.negate())),u.dispersion>0&&(m.dispersion.value=u.dispersion),u.iridescence>0&&(m.iridescence.value=u.iridescence,m.iridescenceIOR.value=u.iridescenceIOR,m.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(m.iridescenceMap.value=u.iridescenceMap,n(u.iridescenceMap,m.iridescenceMapTransform)),u.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=u.iridescenceThicknessMap,n(u.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),u.transmission>0&&(m.transmission.value=u.transmission,m.transmissionSamplerMap.value=g.texture,m.transmissionSamplerSize.value.set(g.width,g.height),u.transmissionMap&&(m.transmissionMap.value=u.transmissionMap,n(u.transmissionMap,m.transmissionMapTransform)),m.thickness.value=u.thickness,u.thicknessMap&&(m.thicknessMap.value=u.thicknessMap,n(u.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=u.attenuationDistance,m.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(m.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(m.anisotropyMap.value=u.anisotropyMap,n(u.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=u.specularIntensity,m.specularColor.value.copy(u.specularColor),u.specularColorMap&&(m.specularColorMap.value=u.specularColorMap,n(u.specularColorMap,m.specularColorMapTransform)),u.specularIntensityMap&&(m.specularIntensityMap.value=u.specularIntensityMap,n(u.specularIntensityMap,m.specularIntensityMapTransform))}function _(m,u){u.matcap&&(m.matcap.value=u.matcap)}function S(m,u){let g=e.get(u).light;m.referencePosition.value.setFromMatrixPosition(g.matrixWorld),m.nearDistance.value=g.shadow.camera.near,m.farDistance.value=g.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function JC(t,e,n,i){let r={},s={},o=[],a=t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);function l(g,v){let y=v.program;i.uniformBlockBinding(g,y)}function c(g,v){let y=r[g.id];y===void 0&&(_(g),y=f(g),r[g.id]=y,g.addEventListener("dispose",m));let A=v.program;i.updateUBOMapping(g,A);let w=e.render.frame;s[g.id]!==w&&(h(g),s[g.id]=w)}function f(g){let v=d();g.__bindingPointIndex=v;let y=t.createBuffer(),A=g.__size,w=g.usage;return t.bindBuffer(t.UNIFORM_BUFFER,y),t.bufferData(t.UNIFORM_BUFFER,A,w),t.bindBuffer(t.UNIFORM_BUFFER,null),t.bindBufferBase(t.UNIFORM_BUFFER,v,y),y}function d(){for(let g=0;g<a;g++)if(o.indexOf(g)===-1)return o.push(g),g;return Je("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(g){let v=r[g.id],y=g.uniforms,A=g.__cache;t.bindBuffer(t.UNIFORM_BUFFER,v);for(let w=0,C=y.length;w<C;w++){let x=Array.isArray(y[w])?y[w]:[y[w]];for(let b=0,P=x.length;b<P;b++){let R=x[b];if(p(R,w,b,A)===!0){let F=R.__offset,G=Array.isArray(R.value)?R.value:[R.value],X=0;for(let U=0;U<G.length;U++){let k=G[U],V=S(k);typeof k=="number"||typeof k=="boolean"?(R.__data[0]=k,t.bufferSubData(t.UNIFORM_BUFFER,F+X,R.__data)):k.isMatrix3?(R.__data[0]=k.elements[0],R.__data[1]=k.elements[1],R.__data[2]=k.elements[2],R.__data[3]=0,R.__data[4]=k.elements[3],R.__data[5]=k.elements[4],R.__data[6]=k.elements[5],R.__data[7]=0,R.__data[8]=k.elements[6],R.__data[9]=k.elements[7],R.__data[10]=k.elements[8],R.__data[11]=0):ArrayBuffer.isView(k)?R.__data.set(new k.constructor(k.buffer,k.byteOffset,R.__data.length)):(k.toArray(R.__data,X),X+=V.storage/Float32Array.BYTES_PER_ELEMENT)}t.bufferSubData(t.UNIFORM_BUFFER,F,R.__data)}}}t.bindBuffer(t.UNIFORM_BUFFER,null)}function p(g,v,y,A){let w=g.value,C=v+"_"+y;if(A[C]===void 0)return typeof w=="number"||typeof w=="boolean"?A[C]=w:ArrayBuffer.isView(w)?A[C]=w.slice():A[C]=w.clone(),!0;{let x=A[C];if(typeof w=="number"||typeof w=="boolean"){if(x!==w)return A[C]=w,!0}else{if(ArrayBuffer.isView(w))return!0;if(x.equals(w)===!1)return x.copy(w),!0}}return!1}function _(g){let v=g.uniforms,y=0,A=16;for(let C=0,x=v.length;C<x;C++){let b=Array.isArray(v[C])?v[C]:[v[C]];for(let P=0,R=b.length;P<R;P++){let F=b[P],G=Array.isArray(F.value)?F.value:[F.value];for(let X=0,U=G.length;X<U;X++){let k=G[X],V=S(k),ne=y%A,le=ne%V.boundary,me=ne+le;y+=le,me!==0&&A-me<V.storage&&(y+=A-me),F.__data=new Float32Array(V.storage/Float32Array.BYTES_PER_ELEMENT),F.__offset=y,y+=V.storage}}}let w=y%A;return w>0&&(y+=A-w),g.__size=y,g.__cache={},this}function S(g){let v={boundary:0,storage:0};return typeof g=="number"||typeof g=="boolean"?(v.boundary=4,v.storage=4):g.isVector2?(v.boundary=8,v.storage=8):g.isVector3||g.isColor?(v.boundary=16,v.storage=12):g.isVector4?(v.boundary=16,v.storage=16):g.isMatrix3?(v.boundary=48,v.storage=48):g.isMatrix4?(v.boundary=64,v.storage=64):g.isTexture?$e("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(g)?(v.boundary=16,v.storage=g.byteLength):$e("WebGLRenderer: Unsupported uniform value type.",g),v}function m(g){let v=g.target;v.removeEventListener("dispose",m);let y=o.indexOf(v.__bindingPointIndex);o.splice(y,1),t.deleteBuffer(r[v.id]),delete r[v.id],delete s[v.id]}function u(){for(let g in r)t.deleteBuffer(r[g]);o=[],r={},s={}}return{bind:l,update:c,dispose:u}}var jC=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),ir=null;function QC(){return ir===null&&(ir=new mh(jC,16,16,ms,nr),ir.name="DFG_LUT",ir.minFilter=_n,ir.magFilter=_n,ir.wrapS=Yi,ir.wrapT=Yi,ir.generateMipmaps=!1,ir.needsUpdate=!0),ir}var Df=class{constructor(e={}){let{canvas:n=Iy(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:f="default",failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:h=!1,outputBufferType:p=Xn}=e;this.isWebGLRenderer=!0;let _;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");_=i.getContextAttributes().alpha}else _=o;let S=p,m=new Set([$h,Zh,Yh]),u=new Set([Xn,Ui,sa,oa,Xh,qh]),g=new Uint32Array(4),v=new Int32Array(4),y=new N,A=null,w=null,C=[],x=[],b=null;this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Di,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let P=this,R=!1,F=null;this._outputColorSpace=Un;let G=0,X=0,U=null,k=-1,V=null,ne=new qt,le=new qt,me=null,Ae=new pt(0),Fe=0,Qe=n.width,vt=n.height,et=1,Q=null,xe=null,ce=new qt(0,0,Qe,vt),Be=new qt(0,0,Qe,vt),qe=!1,Ye=new Jo,ht=!1,Le=!1,ie=new bt,re=new N,J=new qt,ye={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},ve=!1;function Xe(){return U===null?et:1}let L=i;function je(E,O){return n.getContext(E,O)}try{let E={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:f,failIfMajorPerformanceCaveat:d};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${kh}`),n.addEventListener("webglcontextlost",oe,!1),n.addEventListener("webglcontextrestored",ke,!1),n.addEventListener("webglcontextcreationerror",We,!1),L===null){let O="webgl2";if(L=je(O,E),L===null)throw je(O)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(E){throw Je("WebGLRenderer: "+E.message),E}let Oe,Ke,he,yt,T,M,B,$,se,de,pe,Y,j,Te,Pe,_e,fe,nt,st,ct,D,ge,K;function Re(){Oe=new oA(L),Oe.init(),D=new qC(L,Oe),Ke=new jb(L,Oe,e,D),he=new WC(L,Oe),Ke.reversedDepthBuffer&&h&&he.buffers.depth.setReversed(!0),yt=new cA(L),T=new PC,M=new XC(L,Oe,he,T,Ke,D,yt),B=new sA(P),$=new dE(L),ge=new Kb(L,$),se=new aA(L,$,yt,ge),de=new hA(L,se,$,ge,yt),nt=new uA(L,Ke,M),Pe=new Qb(T),pe=new RC(P,B,Oe,Ke,ge,Pe),Y=new KC(P,T),j=new LC,Te=new BC(Oe),fe=new $b(P,B,he,de,_,l),_e=new GC(P,de,Ke),K=new JC(L,yt,Ke,he),st=new Jb(L,Oe,yt),ct=new lA(L,Oe,yt),yt.programs=pe.programs,P.capabilities=Ke,P.extensions=Oe,P.properties=T,P.renderLists=j,P.shadowMap=_e,P.state=he,P.info=yt}Re(),S!==Xn&&(b=new dA(S,n.width,n.height,r,s));let ae=new Bg(P,L);this.xr=ae,this.getContext=function(){return L},this.getContextAttributes=function(){return L.getContextAttributes()},this.forceContextLoss=function(){let E=Oe.get("WEBGL_lose_context");E&&E.loseContext()},this.forceContextRestore=function(){let E=Oe.get("WEBGL_lose_context");E&&E.restoreContext()},this.getPixelRatio=function(){return et},this.setPixelRatio=function(E){E!==void 0&&(et=E,this.setSize(Qe,vt,!1))},this.getSize=function(E){return E.set(Qe,vt)},this.setSize=function(E,O,W=!0){if(ae.isPresenting){$e("WebGLRenderer: Can't change size while VR device is presenting.");return}Qe=E,vt=O,n.width=Math.floor(E*et),n.height=Math.floor(O*et),W===!0&&(n.style.width=E+"px",n.style.height=O+"px"),b!==null&&b.setSize(n.width,n.height),this.setViewport(0,0,E,O)},this.getDrawingBufferSize=function(E){return E.set(Qe*et,vt*et).floor()},this.setDrawingBufferSize=function(E,O,W){Qe=E,vt=O,et=W,n.width=Math.floor(E*W),n.height=Math.floor(O*W),this.setViewport(0,0,E,O)},this.setEffects=function(E){if(S===Xn){Je("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(E){for(let O=0;O<E.length;O++)if(E[O].isOutputPass===!0){$e("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}b.setEffects(E||[])},this.getCurrentViewport=function(E){return E.copy(ne)},this.getViewport=function(E){return E.copy(ce)},this.setViewport=function(E,O,W,z){E.isVector4?ce.set(E.x,E.y,E.z,E.w):ce.set(E,O,W,z),he.viewport(ne.copy(ce).multiplyScalar(et).round())},this.getScissor=function(E){return E.copy(Be)},this.setScissor=function(E,O,W,z){E.isVector4?Be.set(E.x,E.y,E.z,E.w):Be.set(E,O,W,z),he.scissor(le.copy(Be).multiplyScalar(et).round())},this.getScissorTest=function(){return qe},this.setScissorTest=function(E){he.setScissorTest(qe=E)},this.setOpaqueSort=function(E){Q=E},this.setTransparentSort=function(E){xe=E},this.getClearColor=function(E){return E.copy(fe.getClearColor())},this.setClearColor=function(){fe.setClearColor(...arguments)},this.getClearAlpha=function(){return fe.getClearAlpha()},this.setClearAlpha=function(){fe.setClearAlpha(...arguments)},this.clear=function(E=!0,O=!0,W=!0){let z=0;if(E){let H=!1;if(U!==null){let Se=U.texture.format;H=m.has(Se)}if(H){let Se=U.texture.type,be=u.has(Se),Me=fe.getClearColor(),ze=fe.getClearAlpha(),Ve=Me.r,rt=Me.g,ot=Me.b;be?(g[0]=Ve,g[1]=rt,g[2]=ot,g[3]=ze,L.clearBufferuiv(L.COLOR,0,g)):(v[0]=Ve,v[1]=rt,v[2]=ot,v[3]=ze,L.clearBufferiv(L.COLOR,0,v))}else z|=L.COLOR_BUFFER_BIT}O&&(z|=L.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),W&&(z|=L.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),z!==0&&L.clear(z)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(E){E.setRenderer(this),F=E},this.dispose=function(){n.removeEventListener("webglcontextlost",oe,!1),n.removeEventListener("webglcontextrestored",ke,!1),n.removeEventListener("webglcontextcreationerror",We,!1),fe.dispose(),j.dispose(),Te.dispose(),T.dispose(),B.dispose(),de.dispose(),ge.dispose(),K.dispose(),pe.dispose(),ae.dispose(),ae.removeEventListener("sessionstart",vs),ae.removeEventListener("sessionend",xs),Qt.stop()};function oe(E){E.preventDefault(),fg("WebGLRenderer: Context Lost."),R=!0}function ke(){fg("WebGLRenderer: Context Restored."),R=!1;let E=yt.autoReset,O=_e.enabled,W=_e.autoUpdate,z=_e.needsUpdate,H=_e.type;Re(),yt.autoReset=E,_e.enabled=O,_e.autoUpdate=W,_e.needsUpdate=z,_e.type=H}function We(E){Je("WebGLRenderer: A WebGL context could not be created. Reason: ",E.statusMessage)}function Rt(E){let O=E.target;O.removeEventListener("dispose",Rt),Mt(O)}function Mt(E){Vt(E),T.remove(E)}function Vt(E){let O=T.get(E).programs;O!==void 0&&(O.forEach(function(W){pe.releaseProgram(W)}),E.isShaderMaterial&&pe.releaseShaderCache(E))}this.renderBufferDirect=function(E,O,W,z,H,Se){O===null&&(O=ye);let be=H.isMesh&&H.matrixWorld.determinant()<0,Me=qn(E,O,W,z,H);he.setMaterial(z,be);let ze=W.index,Ve=1;if(z.wireframe===!0){if(ze=se.getWireframeAttribute(W),ze===void 0)return;Ve=2}let rt=W.drawRange,ot=W.attributes.position,Ge=rt.start*Ve,at=(rt.start+rt.count)*Ve;Se!==null&&(Ge=Math.max(Ge,Se.start*Ve),at=Math.min(at,(Se.start+Se.count)*Ve)),ze!==null?(Ge=Math.max(Ge,0),at=Math.min(at,ze.count)):ot!=null&&(Ge=Math.max(Ge,0),at=Math.min(at,ot.count));let Bt=at-Ge;if(Bt<0||Bt===1/0)return;ge.setup(H,z,Me,W,ze);let Nt,mt=st;if(ze!==null&&(Nt=$.get(ze),mt=ct,mt.setIndex(Nt)),H.isMesh)z.wireframe===!0?(he.setLineWidth(z.wireframeLinewidth*Xe()),mt.setMode(L.LINES)):mt.setMode(L.TRIANGLES);else if(H.isLine){let en=z.linewidth;en===void 0&&(en=1),he.setLineWidth(en*Xe()),H.isLineSegments?mt.setMode(L.LINES):H.isLineLoop?mt.setMode(L.LINE_LOOP):mt.setMode(L.LINE_STRIP)}else H.isPoints?mt.setMode(L.POINTS):H.isSprite&&mt.setMode(L.TRIANGLES);if(H.isBatchedMesh)if(Oe.get("WEBGL_multi_draw"))mt.renderMultiDraw(H._multiDrawStarts,H._multiDrawCounts,H._multiDrawCount);else{let en=H._multiDrawStarts,Ce=H._multiDrawCounts,Cn=H._multiDrawCount,ft=ze?$.get(ze).bytesPerElement:1,tn=T.get(z).currentProgram.getUniforms();for(let Bn=0;Bn<Cn;Bn++)tn.setValue(L,"_gl_DrawID",Bn),mt.render(en[Bn]/ft,Ce[Bn])}else if(H.isInstancedMesh)mt.renderInstances(Ge,Bt,H.count);else if(W.isInstancedBufferGeometry){let en=W._maxInstanceCount!==void 0?W._maxInstanceCount:1/0,Ce=Math.min(W.instanceCount,en);mt.renderInstances(Ge,Bt,Ce)}else mt.render(Ge,Bt)};function An(E,O,W){E.transparent===!0&&E.side===er&&E.forceSinglePass===!1?(E.side=On,E.needsUpdate=!0,vi(E,O,W),E.side=Tr,E.needsUpdate=!0,vi(E,O,W),E.side=er):vi(E,O,W)}this.compile=function(E,O,W=null){W===null&&(W=E),w=Te.get(W),w.init(O),x.push(w),W.traverseVisible(function(H){H.isLight&&H.layers.test(O.layers)&&(w.pushLight(H),H.castShadow&&w.pushShadow(H))}),E!==W&&E.traverseVisible(function(H){H.isLight&&H.layers.test(O.layers)&&(w.pushLight(H),H.castShadow&&w.pushShadow(H))}),w.setupLights();let z=new Set;return E.traverse(function(H){if(!(H.isMesh||H.isPoints||H.isLine||H.isSprite))return;let Se=H.material;if(Se)if(Array.isArray(Se))for(let be=0;be<Se.length;be++){let Me=Se[be];An(Me,W,H),z.add(Me)}else An(Se,W,H),z.add(Se)}),w=x.pop(),z},this.compileAsync=function(E,O,W=null){let z=this.compile(E,O,W);return new Promise(H=>{function Se(){if(z.forEach(function(be){T.get(be).currentProgram.isReady()&&z.delete(be)}),z.size===0){H(E);return}setTimeout(Se,10)}Oe.get("KHR_parallel_shader_compile")!==null?Se():setTimeout(Se,10)})};let _s=null;function sr(E){_s&&_s(E)}function vs(){Qt.stop()}function xs(){Qt.start()}let Qt=new uS;Qt.setAnimationLoop(sr),typeof self<"u"&&Qt.setContext(self),this.setAnimationLoop=function(E){_s=E,ae.setAnimationLoop(E),E===null?Qt.stop():Qt.start()},ae.addEventListener("sessionstart",vs),ae.addEventListener("sessionend",xs),this.render=function(E,O){if(O!==void 0&&O.isCamera!==!0){Je("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(R===!0)return;F!==null&&F.renderStart(E,O);let W=ae.enabled===!0&&ae.isPresenting===!0,z=b!==null&&(U===null||W)&&b.begin(P,U);if(E.matrixWorldAutoUpdate===!0&&E.updateMatrixWorld(),O.parent===null&&O.matrixWorldAutoUpdate===!0&&O.updateMatrixWorld(),ae.enabled===!0&&ae.isPresenting===!0&&(b===null||b.isCompositing()===!1)&&(ae.cameraAutoUpdate===!0&&ae.updateCamera(O),O=ae.getCamera()),E.isScene===!0&&E.onBeforeRender(P,E,O,U),w=Te.get(E,x.length),w.init(O),w.state.textureUnits=M.getTextureUnits(),x.push(w),ie.multiplyMatrices(O.projectionMatrix,O.matrixWorldInverse),Ye.setFromProjectionMatrix(ie,Li,O.reversedDepth),Le=this.localClippingEnabled,ht=Pe.init(this.clippingPlanes,Le),A=j.get(E,C.length),A.init(),C.push(A),ae.enabled===!0&&ae.isPresenting===!0){let be=P.xr.getDepthSensingMesh();be!==null&&Cr(be,O,-1/0,P.sortObjects)}Cr(E,O,0,P.sortObjects),A.finish(),P.sortObjects===!0&&A.sort(Q,xe),ve=ae.enabled===!1||ae.isPresenting===!1||ae.hasDepthSensing()===!1,ve&&fe.addToRenderList(A,E),this.info.render.frame++,ht===!0&&Pe.beginShadows();let H=w.state.shadowsArray;if(_e.render(H,E,O),ht===!0&&Pe.endShadows(),this.info.autoReset===!0&&this.info.reset(),(z&&b.hasRenderPass())===!1){let be=A.opaque,Me=A.transmissive;if(w.setupLights(),O.isArrayCamera){let ze=O.cameras;if(Me.length>0)for(let Ve=0,rt=ze.length;Ve<rt;Ve++){let ot=ze[Ve];Rr(be,Me,E,ot)}ve&&fe.render(E);for(let Ve=0,rt=ze.length;Ve<rt;Ve++){let ot=ze[Ve];ys(A,E,ot,ot.viewport)}}else Me.length>0&&Rr(be,Me,E,O),ve&&fe.render(E),ys(A,E,O)}U!==null&&X===0&&(M.updateMultisampleRenderTarget(U),M.updateRenderTargetMipmap(U)),z&&b.end(P),E.isScene===!0&&E.onAfterRender(P,E,O),ge.resetDefaultState(),k=-1,V=null,x.pop(),x.length>0?(w=x[x.length-1],M.setTextureUnits(w.state.textureUnits),ht===!0&&Pe.setGlobalState(P.clippingPlanes,w.state.camera)):w=null,C.pop(),C.length>0?A=C[C.length-1]:A=null,F!==null&&F.renderEnd()};function Cr(E,O,W,z){if(E.visible===!1)return;if(E.layers.test(O.layers)){if(E.isGroup)W=E.renderOrder;else if(E.isLOD)E.autoUpdate===!0&&E.update(O);else if(E.isLightProbeGrid)w.pushLightProbeGrid(E);else if(E.isLight)w.pushLight(E),E.castShadow&&w.pushShadow(E);else if(E.isSprite){if(!E.frustumCulled||Ye.intersectsSprite(E)){z&&J.setFromMatrixPosition(E.matrixWorld).applyMatrix4(ie);let be=de.update(E),Me=E.material;Me.visible&&A.push(E,be,Me,W,J.z,null)}}else if((E.isMesh||E.isLine||E.isPoints)&&(!E.frustumCulled||Ye.intersectsObject(E))){let be=de.update(E),Me=E.material;if(z&&(E.boundingSphere!==void 0?(E.boundingSphere===null&&E.computeBoundingSphere(),J.copy(E.boundingSphere.center)):(be.boundingSphere===null&&be.computeBoundingSphere(),J.copy(be.boundingSphere.center)),J.applyMatrix4(E.matrixWorld).applyMatrix4(ie)),Array.isArray(Me)){let ze=be.groups;for(let Ve=0,rt=ze.length;Ve<rt;Ve++){let ot=ze[Ve],Ge=Me[ot.materialIndex];Ge&&Ge.visible&&A.push(E,be,Ge,W,J.z,ot)}}else Me.visible&&A.push(E,be,Me,W,J.z,null)}}let Se=E.children;for(let be=0,Me=Se.length;be<Me;be++)Cr(Se[be],O,W,z)}function ys(E,O,W,z){let{opaque:H,transmissive:Se,transparent:be}=E;w.setupLightsView(W),ht===!0&&Pe.setGlobalState(P.clippingPlanes,W),z&&he.viewport(ne.copy(z)),H.length>0&&ai(H,O,W),Se.length>0&&ai(Se,O,W),be.length>0&&ai(be,O,W),he.buffers.depth.setTest(!0),he.buffers.depth.setMask(!0),he.buffers.color.setMask(!0),he.setPolygonOffset(!1)}function Rr(E,O,W,z){if((W.isScene===!0?W.overrideMaterial:null)!==null)return;if(w.state.transmissionRenderTarget[z.id]===void 0){let Ge=Oe.has("EXT_color_buffer_half_float")||Oe.has("EXT_color_buffer_float");w.state.transmissionRenderTarget[z.id]=new ii(1,1,{generateMipmaps:!0,type:Ge?nr:Xn,minFilter:ds,samples:Math.max(4,Ke.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:xt.workingColorSpace})}let Se=w.state.transmissionRenderTarget[z.id],be=z.viewport||ne;Se.setSize(be.z*P.transmissionResolutionScale,be.w*P.transmissionResolutionScale);let Me=P.getRenderTarget(),ze=P.getActiveCubeFace(),Ve=P.getActiveMipmapLevel();P.setRenderTarget(Se),P.getClearColor(Ae),Fe=P.getClearAlpha(),Fe<1&&P.setClearColor(16777215,.5),P.clear(),ve&&fe.render(W);let rt=P.toneMapping;P.toneMapping=Di;let ot=z.viewport;if(z.viewport!==void 0&&(z.viewport=void 0),w.setupLightsView(z),ht===!0&&Pe.setGlobalState(P.clippingPlanes,z),ai(E,W,z),M.updateMultisampleRenderTarget(Se),M.updateRenderTargetMipmap(Se),Oe.has("WEBGL_multisampled_render_to_texture")===!1){let Ge=!1;for(let at=0,Bt=O.length;at<Bt;at++){let Nt=O[at],{object:mt,geometry:en,material:Ce,group:Cn}=Nt;if(Ce.side===er&&mt.layers.test(z.layers)){let ft=Ce.side;Ce.side=On,Ce.needsUpdate=!0,Ot(mt,W,z,en,Ce,Cn),Ce.side=ft,Ce.needsUpdate=!0,Ge=!0}}Ge===!0&&(M.updateMultisampleRenderTarget(Se),M.updateRenderTargetMipmap(Se))}P.setRenderTarget(Me,ze,Ve),P.setClearColor(Ae,Fe),ot!==void 0&&(z.viewport=ot),P.toneMapping=rt}function ai(E,O,W){let z=O.isScene===!0?O.overrideMaterial:null;for(let H=0,Se=E.length;H<Se;H++){let be=E[H],{object:Me,geometry:ze,group:Ve}=be,rt=be.material;rt.allowOverride===!0&&z!==null&&(rt=z),Me.layers.test(W.layers)&&Ot(Me,O,W,ze,rt,Ve)}}function Ot(E,O,W,z,H,Se){E.onBeforeRender(P,O,W,z,H,Se),E.modelViewMatrix.multiplyMatrices(W.matrixWorldInverse,E.matrixWorld),E.normalMatrix.getNormalMatrix(E.modelViewMatrix),H.onBeforeRender(P,O,W,z,E,Se),H.transparent===!0&&H.side===er&&H.forceSinglePass===!1?(H.side=On,H.needsUpdate=!0,P.renderBufferDirect(W,O,z,H,E,Se),H.side=Tr,H.needsUpdate=!0,P.renderBufferDirect(W,O,z,H,E,Se),H.side=er):P.renderBufferDirect(W,O,z,H,E,Se),E.onAfterRender(P,O,W,z,H,Se)}function vi(E,O,W){O.isScene!==!0&&(O=ye);let z=T.get(E),H=w.state.lights,Se=w.state.shadowsArray,be=H.state.version,Me=pe.getParameters(E,H.state,Se,O,W,w.state.lightProbeGridArray),ze=pe.getProgramCacheKey(Me),Ve=z.programs;z.environment=E.isMeshStandardMaterial||E.isMeshLambertMaterial||E.isMeshPhongMaterial?O.environment:null,z.fog=O.fog;let rt=E.isMeshStandardMaterial||E.isMeshLambertMaterial&&!E.envMap||E.isMeshPhongMaterial&&!E.envMap;z.envMap=B.get(E.envMap||z.environment,rt),z.envMapRotation=z.environment!==null&&E.envMap===null?O.environmentRotation:E.envMapRotation,Ve===void 0&&(E.addEventListener("dispose",Rt),Ve=new Map,z.programs=Ve);let ot=Ve.get(ze);if(ot!==void 0){if(z.currentProgram===ot&&z.lightsStateVersion===be)return rc(E,Me),ot}else Me.uniforms=pe.getUniforms(E),F!==null&&E.isNodeMaterial&&F.build(E,W,Me),E.onBeforeCompile(Me,P),ot=pe.acquireProgram(Me,ze),Ve.set(ze,ot),z.uniforms=Me.uniforms;let Ge=z.uniforms;return(!E.isShaderMaterial&&!E.isRawShaderMaterial||E.clipping===!0)&&(Ge.clippingPlanes=Pe.uniform),rc(E,Me),z.needsLights=Zt(E),z.lightsStateVersion=be,z.needsLights&&(Ge.ambientLightColor.value=H.state.ambient,Ge.lightProbe.value=H.state.probe,Ge.directionalLights.value=H.state.directional,Ge.directionalLightShadows.value=H.state.directionalShadow,Ge.spotLights.value=H.state.spot,Ge.spotLightShadows.value=H.state.spotShadow,Ge.rectAreaLights.value=H.state.rectArea,Ge.ltc_1.value=H.state.rectAreaLTC1,Ge.ltc_2.value=H.state.rectAreaLTC2,Ge.pointLights.value=H.state.point,Ge.pointLightShadows.value=H.state.pointShadow,Ge.hemisphereLights.value=H.state.hemi,Ge.directionalShadowMatrix.value=H.state.directionalShadowMatrix,Ge.spotLightMatrix.value=H.state.spotLightMatrix,Ge.spotLightMap.value=H.state.spotLightMap,Ge.pointShadowMatrix.value=H.state.pointShadowMatrix),z.lightProbeGrid=w.state.lightProbeGridArray.length>0,z.currentProgram=ot,z.uniformsList=null,ot}function js(E){if(E.uniformsList===null){let O=E.currentProgram.getUniforms();E.uniformsList=la.seqWithValue(O.seq,E.uniforms)}return E.uniformsList}function rc(E,O){let W=T.get(E);W.outputColorSpace=O.outputColorSpace,W.batching=O.batching,W.batchingColor=O.batchingColor,W.instancing=O.instancing,W.instancingColor=O.instancingColor,W.instancingMorph=O.instancingMorph,W.skinning=O.skinning,W.morphTargets=O.morphTargets,W.morphNormals=O.morphNormals,W.morphColors=O.morphColors,W.morphTargetsCount=O.morphTargetsCount,W.numClippingPlanes=O.numClippingPlanes,W.numIntersection=O.numClipIntersection,W.vertexAlphas=O.vertexAlphas,W.vertexTangents=O.vertexTangents,W.toneMapping=O.toneMapping}function kf(E,O){if(E.length===0)return null;if(E.length===1)return E[0].texture!==null?E[0]:null;y.setFromMatrixPosition(O.matrixWorld);for(let W=0,z=E.length;W<z;W++){let H=E[W];if(H.texture!==null&&H.boundingBox.containsPoint(y))return H}return null}function qn(E,O,W,z,H){O.isScene!==!0&&(O=ye),M.resetTextureUnits();let Se=O.fog,be=z.isMeshStandardMaterial||z.isMeshLambertMaterial||z.isMeshPhongMaterial?O.environment:null,Me=U===null?P.outputColorSpace:U.isXRRenderTarget===!0?U.texture.colorSpace:xt.workingColorSpace,ze=z.isMeshStandardMaterial||z.isMeshLambertMaterial&&!z.envMap||z.isMeshPhongMaterial&&!z.envMap,Ve=B.get(z.envMap||be,ze),rt=z.vertexColors===!0&&!!W.attributes.color&&W.attributes.color.itemSize===4,ot=!!W.attributes.tangent&&(!!z.normalMap||z.anisotropy>0),Ge=!!W.morphAttributes.position,at=!!W.morphAttributes.normal,Bt=!!W.morphAttributes.color,Nt=Di;z.toneMapped&&(U===null||U.isXRRenderTarget===!0)&&(Nt=P.toneMapping);let mt=W.morphAttributes.position||W.morphAttributes.normal||W.morphAttributes.color,en=mt!==void 0?mt.length:0,Ce=T.get(z),Cn=w.state.lights;if(ht===!0&&(Le===!0||E!==V)){let At=E===V&&z.id===k;Pe.setState(z,E,At)}let ft=!1;z.version===Ce.__version?(Ce.needsLights&&Ce.lightsStateVersion!==Cn.state.version||Ce.outputColorSpace!==Me||H.isBatchedMesh&&Ce.batching===!1||!H.isBatchedMesh&&Ce.batching===!0||H.isBatchedMesh&&Ce.batchingColor===!0&&H.colorTexture===null||H.isBatchedMesh&&Ce.batchingColor===!1&&H.colorTexture!==null||H.isInstancedMesh&&Ce.instancing===!1||!H.isInstancedMesh&&Ce.instancing===!0||H.isSkinnedMesh&&Ce.skinning===!1||!H.isSkinnedMesh&&Ce.skinning===!0||H.isInstancedMesh&&Ce.instancingColor===!0&&H.instanceColor===null||H.isInstancedMesh&&Ce.instancingColor===!1&&H.instanceColor!==null||H.isInstancedMesh&&Ce.instancingMorph===!0&&H.morphTexture===null||H.isInstancedMesh&&Ce.instancingMorph===!1&&H.morphTexture!==null||Ce.envMap!==Ve||z.fog===!0&&Ce.fog!==Se||Ce.numClippingPlanes!==void 0&&(Ce.numClippingPlanes!==Pe.numPlanes||Ce.numIntersection!==Pe.numIntersection)||Ce.vertexAlphas!==rt||Ce.vertexTangents!==ot||Ce.morphTargets!==Ge||Ce.morphNormals!==at||Ce.morphColors!==Bt||Ce.toneMapping!==Nt||Ce.morphTargetsCount!==en||!!Ce.lightProbeGrid!=w.state.lightProbeGridArray.length>0)&&(ft=!0):(ft=!0,Ce.__version=z.version);let tn=Ce.currentProgram;ft===!0&&(tn=vi(z,O,H),F&&z.isNodeMaterial&&F.onUpdateProgram(z,tn,Ce));let Bn=!1,kn=!1,ar=!1,Et=tn.getUniforms(),Pt=Ce.uniforms;if(he.useProgram(tn.program)&&(Bn=!0,kn=!0,ar=!0),z.id!==k&&(k=z.id,kn=!0),Ce.needsLights){let At=kf(w.state.lightProbeGridArray,H);Ce.lightProbeGrid!==At&&(Ce.lightProbeGrid=At,kn=!0)}if(Bn||V!==E){he.buffers.depth.getReversed()&&E.reversedDepth!==!0&&(E._reversedDepth=!0,E.updateProjectionMatrix()),Et.setValue(L,"projectionMatrix",E.projectionMatrix),Et.setValue(L,"viewMatrix",E.matrixWorldInverse);let yi=Et.map.cameraPosition;yi!==void 0&&yi.setValue(L,re.setFromMatrixPosition(E.matrixWorld)),Ke.logarithmicDepthBuffer&&Et.setValue(L,"logDepthBufFC",2/(Math.log(E.far+1)/Math.LN2)),(z.isMeshPhongMaterial||z.isMeshToonMaterial||z.isMeshLambertMaterial||z.isMeshBasicMaterial||z.isMeshStandardMaterial||z.isShaderMaterial)&&Et.setValue(L,"isOrthographic",E.isOrthographicCamera===!0),V!==E&&(V=E,kn=!0,ar=!0)}if(Ce.needsLights&&(Cn.state.directionalShadowMap.length>0&&Et.setValue(L,"directionalShadowMap",Cn.state.directionalShadowMap,M),Cn.state.spotShadowMap.length>0&&Et.setValue(L,"spotShadowMap",Cn.state.spotShadowMap,M),Cn.state.pointShadowMap.length>0&&Et.setValue(L,"pointShadowMap",Cn.state.pointShadowMap,M)),H.isSkinnedMesh){Et.setOptional(L,H,"bindMatrix"),Et.setOptional(L,H,"bindMatrixInverse");let At=H.skeleton;At&&(At.boneTexture===null&&At.computeBoneTexture(),Et.setValue(L,"boneTexture",At.boneTexture,M))}H.isBatchedMesh&&(Et.setOptional(L,H,"batchingTexture"),Et.setValue(L,"batchingTexture",H._matricesTexture,M),Et.setOptional(L,H,"batchingIdTexture"),Et.setValue(L,"batchingIdTexture",H._indirectTexture,M),Et.setOptional(L,H,"batchingColorTexture"),H._colorsTexture!==null&&Et.setValue(L,"batchingColorTexture",H._colorsTexture,M));let Bi=W.morphAttributes;if((Bi.position!==void 0||Bi.normal!==void 0||Bi.color!==void 0)&&nt.update(H,W,tn),(kn||Ce.receiveShadow!==H.receiveShadow)&&(Ce.receiveShadow=H.receiveShadow,Et.setValue(L,"receiveShadow",H.receiveShadow)),(z.isMeshStandardMaterial||z.isMeshLambertMaterial||z.isMeshPhongMaterial)&&z.envMap===null&&O.environment!==null&&(Pt.envMapIntensity.value=O.environmentIntensity),Pt.dfgLUT!==void 0&&(Pt.dfgLUT.value=QC()),kn){if(Et.setValue(L,"toneMappingExposure",P.toneMappingExposure),Ce.needsLights&&xi(Pt,ar),Se&&z.fog===!0&&Y.refreshFogUniforms(Pt,Se),Y.refreshMaterialUniforms(Pt,z,et,vt,w.state.transmissionRenderTarget[E.id]),Ce.needsLights&&Ce.lightProbeGrid){let At=Ce.lightProbeGrid;Pt.probesSH.value=At.texture,Pt.probesMin.value.copy(At.boundingBox.min),Pt.probesMax.value.copy(At.boundingBox.max),Pt.probesResolution.value.copy(At.resolution)}la.upload(L,js(Ce),Pt,M)}if(z.isShaderMaterial&&z.uniformsNeedUpdate===!0&&(la.upload(L,js(Ce),Pt,M),z.uniformsNeedUpdate=!1),z.isSpriteMaterial&&Et.setValue(L,"center",H.center),Et.setValue(L,"modelViewMatrix",H.modelViewMatrix),Et.setValue(L,"normalMatrix",H.normalMatrix),Et.setValue(L,"modelMatrix",H.matrixWorld),z.uniformsGroups!==void 0){let At=z.uniformsGroups;for(let yi=0,Yn=At.length;yi<Yn;yi++){let ha=At[yi];K.update(ha,tn),K.bind(ha,tn)}}return tn}function xi(E,O){E.ambientLightColor.needsUpdate=O,E.lightProbe.needsUpdate=O,E.directionalLights.needsUpdate=O,E.directionalLightShadows.needsUpdate=O,E.pointLights.needsUpdate=O,E.pointLightShadows.needsUpdate=O,E.spotLights.needsUpdate=O,E.spotLightShadows.needsUpdate=O,E.rectAreaLights.needsUpdate=O,E.hemisphereLights.needsUpdate=O}function Zt(E){return E.isMeshLambertMaterial||E.isMeshToonMaterial||E.isMeshPhongMaterial||E.isMeshStandardMaterial||E.isShadowMaterial||E.isShaderMaterial&&E.lights===!0}this.getActiveCubeFace=function(){return G},this.getActiveMipmapLevel=function(){return X},this.getRenderTarget=function(){return U},this.setRenderTargetTextures=function(E,O,W){let z=T.get(E);z.__autoAllocateDepthBuffer=E.resolveDepthBuffer===!1,z.__autoAllocateDepthBuffer===!1&&(z.__useRenderToTexture=!1),T.get(E.texture).__webglTexture=O,T.get(E.depthTexture).__webglTexture=z.__autoAllocateDepthBuffer?void 0:W,z.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(E,O){let W=T.get(E);W.__webglFramebuffer=O,W.__useDefaultFramebuffer=O===void 0};let sc=L.createFramebuffer();this.setRenderTarget=function(E,O=0,W=0){U=E,G=O,X=W;let z=null,H=!1,Se=!1;if(E){let Me=T.get(E);if(Me.__useDefaultFramebuffer!==void 0){he.bindFramebuffer(L.FRAMEBUFFER,Me.__webglFramebuffer),ne.copy(E.viewport),le.copy(E.scissor),me=E.scissorTest,he.viewport(ne),he.scissor(le),he.setScissorTest(me),k=-1;return}else if(Me.__webglFramebuffer===void 0)M.setupRenderTarget(E);else if(Me.__hasExternalTextures)M.rebindTextures(E,T.get(E.texture).__webglTexture,T.get(E.depthTexture).__webglTexture);else if(E.depthBuffer){let rt=E.depthTexture;if(Me.__boundDepthTexture!==rt){if(rt!==null&&T.has(rt)&&(E.width!==rt.image.width||E.height!==rt.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");M.setupDepthRenderbuffer(E)}}let ze=E.texture;(ze.isData3DTexture||ze.isDataArrayTexture||ze.isCompressedArrayTexture)&&(Se=!0);let Ve=T.get(E).__webglFramebuffer;E.isWebGLCubeRenderTarget?(Array.isArray(Ve[O])?z=Ve[O][W]:z=Ve[O],H=!0):E.samples>0&&M.useMultisampledRTT(E)===!1?z=T.get(E).__webglMultisampledFramebuffer:Array.isArray(Ve)?z=Ve[W]:z=Ve,ne.copy(E.viewport),le.copy(E.scissor),me=E.scissorTest}else ne.copy(ce).multiplyScalar(et).floor(),le.copy(Be).multiplyScalar(et).floor(),me=qe;if(W!==0&&(z=sc),he.bindFramebuffer(L.FRAMEBUFFER,z)&&he.drawBuffers(E,z),he.viewport(ne),he.scissor(le),he.setScissorTest(me),H){let Me=T.get(E.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_CUBE_MAP_POSITIVE_X+O,Me.__webglTexture,W)}else if(Se){let Me=O;for(let ze=0;ze<E.textures.length;ze++){let Ve=T.get(E.textures[ze]);L.framebufferTextureLayer(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0+ze,Ve.__webglTexture,W,Me)}}else if(E!==null&&W!==0){let Me=T.get(E.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,Me.__webglTexture,W)}k=-1},this.readRenderTargetPixels=function(E,O,W,z,H,Se,be,Me=0){if(!(E&&E.isWebGLRenderTarget)){Je("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let ze=T.get(E).__webglFramebuffer;if(E.isWebGLCubeRenderTarget&&be!==void 0&&(ze=ze[be]),ze){he.bindFramebuffer(L.FRAMEBUFFER,ze);try{let Ve=E.textures[Me],rt=Ve.format,ot=Ve.type;if(E.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+Me),!Ke.textureFormatReadable(rt)){Je("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Ke.textureTypeReadable(ot)){Je("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}O>=0&&O<=E.width-z&&W>=0&&W<=E.height-H&&L.readPixels(O,W,z,H,D.convert(rt),D.convert(ot),Se)}finally{let Ve=U!==null?T.get(U).__webglFramebuffer:null;he.bindFramebuffer(L.FRAMEBUFFER,Ve)}}},this.readRenderTargetPixelsAsync=async function(E,O,W,z,H,Se,be,Me=0){if(!(E&&E.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let ze=T.get(E).__webglFramebuffer;if(E.isWebGLCubeRenderTarget&&be!==void 0&&(ze=ze[be]),ze)if(O>=0&&O<=E.width-z&&W>=0&&W<=E.height-H){he.bindFramebuffer(L.FRAMEBUFFER,ze);let Ve=E.textures[Me],rt=Ve.format,ot=Ve.type;if(E.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+Me),!Ke.textureFormatReadable(rt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Ke.textureTypeReadable(ot))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Ge=L.createBuffer();L.bindBuffer(L.PIXEL_PACK_BUFFER,Ge),L.bufferData(L.PIXEL_PACK_BUFFER,Se.byteLength,L.STREAM_READ),L.readPixels(O,W,z,H,D.convert(rt),D.convert(ot),0);let at=U!==null?T.get(U).__webglFramebuffer:null;he.bindFramebuffer(L.FRAMEBUFFER,at);let Bt=L.fenceSync(L.SYNC_GPU_COMMANDS_COMPLETE,0);return L.flush(),await Ny(L,Bt,4),L.bindBuffer(L.PIXEL_PACK_BUFFER,Ge),L.getBufferSubData(L.PIXEL_PACK_BUFFER,0,Se),L.deleteBuffer(Ge),L.deleteSync(Bt),Se}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(E,O=null,W=0){let z=Math.pow(2,-W),H=Math.floor(E.image.width*z),Se=Math.floor(E.image.height*z),be=O!==null?O.x:0,Me=O!==null?O.y:0;M.setTexture2D(E,0),L.copyTexSubImage2D(L.TEXTURE_2D,W,0,0,be,Me,H,Se),he.unbindTexture()};let or=L.createFramebuffer(),oc=L.createFramebuffer();this.copyTextureToTexture=function(E,O,W=null,z=null,H=0,Se=0){let be,Me,ze,Ve,rt,ot,Ge,at,Bt,Nt=E.isCompressedTexture?E.mipmaps[Se]:E.image;if(W!==null)be=W.max.x-W.min.x,Me=W.max.y-W.min.y,ze=W.isBox3?W.max.z-W.min.z:1,Ve=W.min.x,rt=W.min.y,ot=W.isBox3?W.min.z:0;else{let Pt=Math.pow(2,-H);be=Math.floor(Nt.width*Pt),Me=Math.floor(Nt.height*Pt),E.isDataArrayTexture?ze=Nt.depth:E.isData3DTexture?ze=Math.floor(Nt.depth*Pt):ze=1,Ve=0,rt=0,ot=0}z!==null?(Ge=z.x,at=z.y,Bt=z.z):(Ge=0,at=0,Bt=0);let mt=D.convert(O.format),en=D.convert(O.type),Ce;O.isData3DTexture?(M.setTexture3D(O,0),Ce=L.TEXTURE_3D):O.isDataArrayTexture||O.isCompressedArrayTexture?(M.setTexture2DArray(O,0),Ce=L.TEXTURE_2D_ARRAY):(M.setTexture2D(O,0),Ce=L.TEXTURE_2D),he.activeTexture(L.TEXTURE0),he.pixelStorei(L.UNPACK_FLIP_Y_WEBGL,O.flipY),he.pixelStorei(L.UNPACK_PREMULTIPLY_ALPHA_WEBGL,O.premultiplyAlpha),he.pixelStorei(L.UNPACK_ALIGNMENT,O.unpackAlignment);let Cn=he.getParameter(L.UNPACK_ROW_LENGTH),ft=he.getParameter(L.UNPACK_IMAGE_HEIGHT),tn=he.getParameter(L.UNPACK_SKIP_PIXELS),Bn=he.getParameter(L.UNPACK_SKIP_ROWS),kn=he.getParameter(L.UNPACK_SKIP_IMAGES);he.pixelStorei(L.UNPACK_ROW_LENGTH,Nt.width),he.pixelStorei(L.UNPACK_IMAGE_HEIGHT,Nt.height),he.pixelStorei(L.UNPACK_SKIP_PIXELS,Ve),he.pixelStorei(L.UNPACK_SKIP_ROWS,rt),he.pixelStorei(L.UNPACK_SKIP_IMAGES,ot);let ar=E.isDataArrayTexture||E.isData3DTexture,Et=O.isDataArrayTexture||O.isData3DTexture;if(E.isDepthTexture){let Pt=T.get(E),Bi=T.get(O),At=T.get(Pt.__renderTarget),yi=T.get(Bi.__renderTarget);he.bindFramebuffer(L.READ_FRAMEBUFFER,At.__webglFramebuffer),he.bindFramebuffer(L.DRAW_FRAMEBUFFER,yi.__webglFramebuffer);for(let Yn=0;Yn<ze;Yn++)ar&&(L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,T.get(E).__webglTexture,H,ot+Yn),L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,T.get(O).__webglTexture,Se,Bt+Yn)),L.blitFramebuffer(Ve,rt,be,Me,Ge,at,be,Me,L.DEPTH_BUFFER_BIT,L.NEAREST);he.bindFramebuffer(L.READ_FRAMEBUFFER,null),he.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else if(H!==0||E.isRenderTargetTexture||T.has(E)){let Pt=T.get(E),Bi=T.get(O);he.bindFramebuffer(L.READ_FRAMEBUFFER,or),he.bindFramebuffer(L.DRAW_FRAMEBUFFER,oc);for(let At=0;At<ze;At++)ar?L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,Pt.__webglTexture,H,ot+At):L.framebufferTexture2D(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,Pt.__webglTexture,H),Et?L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,Bi.__webglTexture,Se,Bt+At):L.framebufferTexture2D(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,Bi.__webglTexture,Se),H!==0?L.blitFramebuffer(Ve,rt,be,Me,Ge,at,be,Me,L.COLOR_BUFFER_BIT,L.NEAREST):Et?L.copyTexSubImage3D(Ce,Se,Ge,at,Bt+At,Ve,rt,be,Me):L.copyTexSubImage2D(Ce,Se,Ge,at,Ve,rt,be,Me);he.bindFramebuffer(L.READ_FRAMEBUFFER,null),he.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else Et?E.isDataTexture||E.isData3DTexture?L.texSubImage3D(Ce,Se,Ge,at,Bt,be,Me,ze,mt,en,Nt.data):O.isCompressedArrayTexture?L.compressedTexSubImage3D(Ce,Se,Ge,at,Bt,be,Me,ze,mt,Nt.data):L.texSubImage3D(Ce,Se,Ge,at,Bt,be,Me,ze,mt,en,Nt):E.isDataTexture?L.texSubImage2D(L.TEXTURE_2D,Se,Ge,at,be,Me,mt,en,Nt.data):E.isCompressedTexture?L.compressedTexSubImage2D(L.TEXTURE_2D,Se,Ge,at,Nt.width,Nt.height,mt,Nt.data):L.texSubImage2D(L.TEXTURE_2D,Se,Ge,at,be,Me,mt,en,Nt);he.pixelStorei(L.UNPACK_ROW_LENGTH,Cn),he.pixelStorei(L.UNPACK_IMAGE_HEIGHT,ft),he.pixelStorei(L.UNPACK_SKIP_PIXELS,tn),he.pixelStorei(L.UNPACK_SKIP_ROWS,Bn),he.pixelStorei(L.UNPACK_SKIP_IMAGES,kn),Se===0&&O.generateMipmaps&&L.generateMipmap(Ce),he.unbindTexture()},this.initRenderTarget=function(E){T.get(E).__webglFramebuffer===void 0&&M.setupRenderTarget(E)},this.initTexture=function(E){E.isCubeTexture?M.setTextureCube(E,0):E.isData3DTexture?M.setTexture3D(E,0):E.isDataArrayTexture||E.isCompressedArrayTexture?M.setTexture2DArray(E,0):M.setTexture2D(E,0),he.unbindTexture()},this.resetState=function(){G=0,X=0,U=null,he.reset(),ge.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Li}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let n=this.getContext();n.drawingBufferColorSpace=xt._getDrawingBufferColorSpace(e),n.unpackColorSpace=xt._getUnpackColorSpace()}};var Of=class extends jt{constructor(e=new zt,n=new N,i=new Ni,r=new N(1,1,1)){super();let s=[],o=[],a=[],l=new N,c=new it().getNormalMatrix(e.matrixWorld),f=new bt;f.makeRotationFromEuler(i),f.setPosition(n);let d=new bt;d.copy(f).invert(),h(),this.setAttribute("position",new St(s,3)),this.setAttribute("uv",new St(a,2)),o.length>0&&this.setAttribute("normal",new St(o,3));function h(){let m=[],u=new N,g=new N,v=e.geometry,y=v.attributes.position,A=v.attributes.normal;if(v.index!==null){let w=v.index;for(let C=0;C<w.count;C++)u.fromBufferAttribute(y,w.getX(C)),A?(g.fromBufferAttribute(A,w.getX(C)),p(m,u,g)):p(m,u)}else{if(y===void 0)return;for(let w=0;w<y.count;w++)u.fromBufferAttribute(y,w),A?(g.fromBufferAttribute(A,w),p(m,u,g)):p(m,u)}m=_(m,l.set(1,0,0)),m=_(m,l.set(-1,0,0)),m=_(m,l.set(0,1,0)),m=_(m,l.set(0,-1,0)),m=_(m,l.set(0,0,1)),m=_(m,l.set(0,0,-1));for(let w=0;w<m.length;w++){let C=m[w];a.push(.5+C.position.x/r.x,.5+C.position.y/r.y),C.position.applyMatrix4(f),s.push(C.position.x,C.position.y,C.position.z),C.normal!==null&&o.push(C.normal.x,C.normal.y,C.normal.z)}}function p(m,u,g=null){u.applyMatrix4(e.matrixWorld),u.applyMatrix4(d),g?(g.applyNormalMatrix(c),m.push(new ic(u.clone(),g.clone()))):m.push(new ic(u.clone()))}function _(m,u){let g=[],v=.5*Math.abs(r.dot(u));for(let y=0;y<m.length;y+=3){let A=0,w,C,x,b,P=m[y+0].position.dot(u)-v,R=m[y+1].position.dot(u)-v,F=m[y+2].position.dot(u)-v,G=P>0,X=R>0,U=F>0;switch(A=(G?1:0)+(X?1:0)+(U?1:0),A){case 0:{g.push(m[y]),g.push(m[y+1]),g.push(m[y+2]);break}case 1:{if(G&&(w=m[y+1],C=m[y+2],x=S(m[y],w,u,v),b=S(m[y],C,u,v)),X){w=m[y],C=m[y+2],x=S(m[y+1],w,u,v),b=S(m[y+1],C,u,v),g.push(x),g.push(C.clone()),g.push(w.clone()),g.push(C.clone()),g.push(x.clone()),g.push(b);break}U&&(w=m[y],C=m[y+1],x=S(m[y+2],w,u,v),b=S(m[y+2],C,u,v)),g.push(w.clone()),g.push(C.clone()),g.push(x),g.push(b),g.push(x.clone()),g.push(C.clone());break}case 2:{G||(w=m[y].clone(),C=S(w,m[y+1],u,v),x=S(w,m[y+2],u,v),g.push(w),g.push(C),g.push(x)),X||(w=m[y+1].clone(),C=S(w,m[y+2],u,v),x=S(w,m[y],u,v),g.push(w),g.push(C),g.push(x)),U||(w=m[y+2].clone(),C=S(w,m[y],u,v),x=S(w,m[y+1],u,v),g.push(w),g.push(C),g.push(x));break}case 3:break}}return g}function S(m,u,g,v){let y=m.position.dot(g)-v,A=u.position.dot(g)-v,w=y/(y-A),C=new N(m.position.x+w*(u.position.x-m.position.x),m.position.y+w*(u.position.y-m.position.y),m.position.z+w*(u.position.z-m.position.z)),x=null;return m.normal!==null&&u.normal!==null&&(x=new N(m.normal.x+w*(u.normal.x-m.normal.x),m.normal.y+w*(u.normal.y-m.normal.y),m.normal.z+w*(u.normal.z-m.normal.z))),new ic(C,x)}}},ic=class{constructor(e,n=null){this.position=e,this.normal=n}clone(){let e=this.position.clone(),n=this.normal!==null?this.normal.clone():null;return new this.constructor(e,n)}};var _i=ac(kg());document.documentElement.lang="it";var zg=null;function MS(t){var e;t.source!==window.parent||t.origin!==window.location.origin||((e=t.data)==null?void 0:e.type)!=="playable-active"||typeof t.data.active!="boolean"||(zg=t.data.active)}window.addEventListener("message",MS);window.addEventListener("pagehide",()=>window.removeEventListener("message",MS),{once:!0});var yS={FRIEND_NAME:"Amico",FRIEND_AVATAR:"assets/friend-avatar.webp",HINT:"Scorri verso l\u2019alto per lanciare",AGAIN:"Gioca ancora",TARGET_RADIUS:.085},aR=`
@font-face{font-family:Poppins;src:url('assets/fonts/Poppins-Regular.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:Poppins;src:url('assets/fonts/Poppins-Bold.woff2') format('woff2');font-style:normal;font-weight:700;font-display:swap}
*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{background:#e9dcc6}
.game{position:relative;width:100%;height:100%;overflow:hidden;color:#493625;--font-ui:Poppins,sans-serif;font-family:var(--font-ui);user-select:none;-webkit-user-select:none}
.stage{position:absolute;inset:0}.stage canvas{display:block;width:100%;height:100%;touch-action:none}
.score{position:absolute;top:30px;left:50%;transform:translateX(-50%);font-size:28px;font-weight:700;line-height:42px;min-width:64px;text-align:center;color:#493625;background:#fff8eadd;border-radius:18px;padding:0 12px;pointer-events:none;font-variant-numeric:tabular-nums}
.tries{position:absolute;top:78px;left:50%;transform:translateX(-50%);background:#fff8eadd;border-radius:12px;padding:2px 10px;font-size:14px;font-weight:700;line-height:22px;pointer-events:none;white-space:nowrap;font-variant-numeric:tabular-nums}
.throw-feedback{position:absolute;bottom:50px;left:30px;right:30px;text-align:center;pointer-events:none;font:700 18px/1.4 var(--font-ui);color:#493625;background:#fff8ede8;border-radius:16px;padding:10px 14px;z-index:3}.error{position:absolute;inset:30px;display:grid;place-items:center;text-align:center;font-size:18px}.hint{position:absolute;left:30px;right:30px;top:32%;text-align:center;pointer-events:none;font-size:18px;line-height:27px;color:#493625;animation:breathe 2.3s ease-in-out infinite}
.hint span{display:inline-block;max-width:100%;overflow-wrap:anywhere;background:#fff8eae8;padding:7px 13px;border-radius:24px;box-shadow:0 2px 8px #785a2220}
@keyframes breathe{50%{opacity:.66;transform:scale(.98)}}
@media(prefers-reduced-motion:reduce){.hint{animation:none!important}}
.game[data-paused=true] .hint{animation-play-state:paused}
`,ua=5;function lR(t,e,n,i,r,s,o){let a=Math.max(1,o);if((n-r)/a<.045)return null;let l=t.find(h=>h.t>=s-170);if(!l)return null;let c=Math.max(.035,(s-l.t)/1e3),f=(i-l.x)/a,d=(l.y-r)/a;return d<.025||d/c<.2||Math.abs(f)>d*1.6?null:{dx:f,length:d,seconds:c}}function cR(t,e){return t==="bliss"||e>=ua}function uR(){let t=(0,Oi.useRef)(null),e=(0,Oi.useRef)(null),[n,i]=(0,Oi.useState)(yS),[r,s]=(0,Oi.useState)(!1),[o,a]=(0,Oi.useState)({state:"ready",score:0,outcome:null,paused:!0,showHint:!0,attempts:0,spotAttempts:0,spotId:1,targetX:0,targetZ:0,lastOutcome:null}),[l,c]=(0,Oi.useState)("");return(0,Oi.useEffect)(()=>{let f=!1,d=new AbortController,h=setTimeout(()=>d.abort(),1500);return fetch("game.config.json",{signal:d.signal}).then(p=>p.ok?p.json():Promise.reject(new Error("Configurazione non disponibile"))).then(p=>{if(f)return;let _={...yS};for(let u of p.texts||[])u.id in _&&typeof u.value=="string"&&(_[u.id]=u.value);let S=(p.images||[]).find(u=>u.id==="FRIEND_AVATAR");S!=null&&S.path&&!/^(https?:|\/\/)/i.test(S.path)&&(_.FRIEND_AVATAR=S.path);let m=(p.tweaks||[]).find(u=>u.id==="TARGET_RADIUS");Number.isFinite(m==null?void 0:m.value)&&(_.TARGET_RADIUS=$s.clamp(m.value,.065,.11)),i(_)}).catch(()=>{}).finally(()=>{clearTimeout(h),f||s(!0)}),()=>{f=!0,d.abort(),clearTimeout(h)}},[]),(0,Oi.useEffect)(()=>{if(r){try{e.current=hR(t.current,n,a)}catch{c("Grafica 3D non disponibile su questo dispositivo.")}return()=>{var f;(f=e.current)==null||f.dispose(),e.current=null}}},[r,n]),(0,_i.jsxs)("main",{className:"game","data-testid":"game","data-state":o.state,"data-score":o.score,"data-outcome":o.outcome||"","data-attempts":o.attempts,"data-spot-attempts":o.spotAttempts,"data-spot-id":o.spotId,"data-target-x":o.targetX,"data-target-z":o.targetZ,"data-max-tries":ua,"data-last-outcome":o.lastOutcome||"","data-paused":o.paused,children:[(0,_i.jsx)("style",{children:aR}),(0,_i.jsx)("div",{className:"stage",ref:t,"data-testid":"throw-surface"}),(0,_i.jsx)("output",{className:"score","aria-label":"Punteggio","data-testid":"score",children:o.score}),(0,_i.jsxs)("output",{className:"tries","aria-live":"polite","data-testid":"tries",children:[Math.max(0,ua-o.spotAttempts)," / ",ua," tentativi"]}),o.state==="ready"&&o.showHint&&(0,_i.jsx)("div",{className:"hint","data-testid":"hint",children:(0,_i.jsx)("span",{children:n.HINT})}),o.outcome&&(0,_i.jsx)("div",{className:"throw-feedback",role:"status","data-testid":"throw-feedback",children:o.outcome!=="bliss"&&o.spotAttempts>=ua?"Nuovo punto":o.outcome==="bliss"?"Che sollievo!":o.outcome==="ouch"?"Mira al punto arancione":"Mancato! Riprova."}),l&&(0,_i.jsx)("div",{className:"error",role:"alert",children:l})]})}function hR(t,e,n){var ha;let i=new Df({antialias:!0});i.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),i.shadowMap.enabled=!0,i.shadowMap.type=zh,i.toneMapping=Xl,i.toneMappingExposure=1.1,t.appendChild(i.domElement),i.domElement.setAttribute("aria-label","Scorri verso l\u2019alto per lanciare");let r=new yl;r.background=new pt("#e9dcc6"),r.fog=new xl("#e9dcc6",7,16);let s=new Tn(40,1,.05,60);r.add(new Vl("#dfefff","#8a6a48",1.1));let o=new Gl("#fff0d8",2.3);o.position.set(-2.5,5,2.5),o.castShadow=!0,o.shadow.mapSize.set(1024,1024),o.shadow.radius=4,o.shadow.bias=-6e-4,Object.assign(o.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.5,far:14}),r.add(o);let a=(I,q,ee)=>{let Z=document.createElement("canvas");Z.width=I,Z.height=q,ee(Z.getContext("2d"),I,q);let te=new Tl(Z);return te.colorSpace=Un,te},l=(I,q=.75,ee={})=>new Bl({color:I,roughness:q,...ee}),c=I=>(I.traverse(q=>{q.isMesh&&(q.castShadow=!0,q.receiveShadow=!0)}),I),f=new ta(1,32,20),d=new ji(1,1,1,24),h=new ls(1,1,1),p=(I,q,ee,Z,te,Ie,He=Ie,Ze=Ie,lt=r)=>{let Ne=new zt(I,q);return Ne.position.set(ee,Z,te),Ne.scale.set(Ie,He,Ze),lt.add(Ne),Ne},_=(I,q)=>I+Math.random()*(q-I),S=(I,q,ee)=>new N(I,q,ee),m=[],u=[],g=(I,q,ee)=>(I.wrapS=I.wrapT=Ws,I.repeat.set(q,ee),u.push(I),I),v=g(a(512,512,(I,q,ee)=>{for(let Z=0;Z<8;Z++){I.fillStyle=`hsl(${_(28,34)},${_(42,52)}%,${_(46,56)}%)`,I.fillRect(Z*q/8,0,q/8,ee);for(let te=0;te<14;te++){I.strokeStyle=`rgba(70,35,10,${_(.08,.23)})`,I.lineWidth=_(1,2.5);let Ie=Z*q/8+_(0,q/8);I.beginPath(),I.moveTo(Ie,0),I.bezierCurveTo(Ie+_(-4,4),ee*.3,Ie+_(-4,4),ee*.6,Ie,ee),I.stroke()}I.fillStyle="rgba(40,20,5,.45)",I.fillRect(Z*q/8,0,2,ee),I.fillRect(Z*q/8,Z*.37%1*ee,q/8,2)}}),2.5,2.5),y=new zt(new Qi(12,12),l("#ffffff",.6,{map:v}));y.rotation.x=-Math.PI/2,y.receiveShadow=!0,r.add(y),m.push(y);let A=g(a(256,256,(I,q,ee)=>{I.fillStyle="#f3ead9",I.fillRect(0,0,q,ee);for(let Z=0;Z<3e3;Z++)I.fillStyle=`rgba(120,90,60,${_(0,.06)})`,I.fillRect(_(0,q),_(0,ee),2,2)}),3,2),w=l("#ffffff",.95,{map:A}),C=l("#a87a4e",.7);for(let[I,q,ee,Z]of[[8,0,-1.85,0],[9,-2.4,2,Math.PI/2],[9,2.4,2,-Math.PI/2]]){let te=new gn;te.position.set(q,0,ee),te.rotation.y=Z,r.add(te);let Ie=p(new Qi(1,1),w,0,1.5,0,I,3,1,te);Ie.receiveShadow=!0,m.push(Ie),p(h,C,0,.45,.02,I,.9,.04,te),p(h,l("#7a5232",.6),0,.92,.05,I,.05,.06,te)}let x=new gn;x.position.set(2.38,1.65,-.4),x.rotation.y=-Math.PI/2,r.add(x);let b=a(4,128,(I,q,ee)=>{let Z=I.createLinearGradient(0,0,0,ee);Z.addColorStop(0,"#7cc0f0"),Z.addColorStop(1,"#e8f6ff"),I.fillStyle=Z,I.fillRect(0,0,q,ee)});u.push(b),p(new Qi(1,1),new Ji({map:b,fog:!1}),0,0,.01,1.1,.9,1,x);let P=l("#f6f1e8",.5);for(let[I,q,ee,Z]of[[0,.47,1.2,.06],[0,-.47,1.2,.06],[-.57,0,.06,1],[.57,0,.06,1],[0,0,.04,.9],[0,0,1.1,.04]])p(h,P,I,q,.03,ee,Z,.05,x);let R=new gn;R.position.set(.15,1.45,-1.83),R.rotation.z=.03,r.add(R),p(h,l("#5a3a22",.5),0,0,0,.78,.98,.03,R),p(new Qi(1,1),l("#fbf6ea"),0,0,.017,.7,.9,1,R);for(let I of[-1,1]){p(h,l("#bf9875"),I*.11,0,.021,.003,.56,.002,R);for(let q=0;q<5;q++)p(new Cl(.017,16),new Ji({color:"#dd8d3b"}),I*.11,-.22+.11*q,.023,1,1,1,R)}let F=new gn;F.position.set(-1.5,0,-1.4),r.add(F);let G=p(new ji(.22,.17,.42,24),l("#c9744a"),0,.21,0,1,1,1,F);p(new ji(.2,.2,.02,24),l("#4a3020"),0,.42,0,1,1,1,F);let X=l("#3f8f4a",.55),U=l("#5a7a3a");for(let I=0;I<9;I++){let q=I*2.4,ee=_(.5,1.1),Z=_(.12,.3);p(d,U,Math.cos(q)*Z/2,.42+ee/2,Math.sin(q)*Z/2,.012,ee,.012,F).rotation.set(Math.sin(q)*.35,0,-Math.cos(q)*.35),p(f,X,Math.cos(q)*Z,.42+ee,Math.sin(q)*Z,.16,.025,.09,F).rotation.set(_(-.4,.4),-q,_(-.5,.5))}c(F),m.push(G);let k=new gn;k.position.set(1.3,0,-1.2),r.add(k);let V=l("#d8dde2",.3,{metalness:.6});for(let I of[.3,.75])m.push(p(h,l("#f4f6f8",.45),0,I,0,.6,.03,.42,k));for(let I of[-.27,.27])for(let q of[-.18,.18])p(d,V,I,.4,q,.015,.8,.015,k);p(h,l("#e04a5a",.6),-.1,.8,0,.18,.07,.12,k),p(new ji(.06,.06,.16,16),l("#fff",.3),.15,.85,.05,1,1,1,k),p(h,l("#fff"),.12,.33,0,.36,.05,.3,k),c(k);let ne=.62,le=-1.08,me=new gn;r.add(me);let Ae=g(a(128,128,(I,q,ee)=>{I.fillStyle="#3a8f86",I.fillRect(0,0,q,ee);for(let Z=0;Z<1200;Z++)I.fillStyle=`rgba(0,30,30,${_(0,.07)})`,I.beginPath(),I.arc(_(0,q),_(0,ee),_(1,2.5),0,7),I.fill()}),2,4),Fe=l("#ffffff",.45,{map:Ae}),Qe=new Qo;Qe.moveTo(-.41,1.3),Qe.lineTo(.41,1.3),Qe.lineTo(.41,-1),Qe.lineTo(-.41,-1),Qe.lineTo(-.41,1.3);let vt=new Xs;vt.absellipse(0,-le,.08,.1,0,Math.PI*2,!0),Qe.holes.push(vt);let et=new Fl(Qe,{depth:.14,bevelEnabled:!1,curveSegments:32});et.rotateX(-Math.PI/2),et.translate(0,ne-.13,0);let Q=new zt(et,Fe);me.add(Q),m.push(Q);for(let I of[-1.3,1]){let q=p(new Al(.07,.68,6,16),Fe,0,ne-.06,I,1,1,1,me);q.rotation.z=Math.PI/2,m.push(q)}p(h,V,0,ne-.17,-.02,.74,.06,1.94,me),p(h,V,0,ne-.17,-1.22,.74,.06,.06,me);for(let I of[-.32,.32])for(let q of[-1.1,.8])p(d,V,I,(ne-.17)/2,q,.03,ne-.17,.03,me);let xe=new zt(new Ol(.145,.05,14,32),l("#f6f2ea",.85));xe.rotation.x=Math.PI/2,xe.scale.set(1.05,1.15,1),xe.position.set(0,ne+.03,le),me.add(xe),m.push(xe),c(me);let ce=I=>q=>{let ee=0;for(;ee<I.length-2&&q>I[ee+1][0];)ee++;let[Z,te]=I[ee],[Ie,He]=I[ee+1],Ze=$s.clamp((q-Z)/(Ie-Z),0,1);return te+(He-te)*(1-Math.cos(Ze*Math.PI))/2};function Be(I,q,ee,Z,te,Ie){let lt=[],Ne=[];for(let tt=0;tt<=64;tt++){let gt=tt/64,an=I+(q-I)*gt,Rn=ee(gt),Pr=Z(gt),wS=te(gt);for(let zf=0;zf<=48;zf++){let Vg=-Math.PI+2*Math.PI*zf/48,fa=Math.cos(Vg),Hg=Rn*Math.sin(Vg),Gg=fa>0?Pr*Math.pow(fa,.8):wS*fa;fa>0&&(Gg+=Ie(Hg,gt)*fa),lt.push(Hg,Gg,an)}}for(let tt=0;tt<64;tt++)for(let gt=0;gt<48;gt++){let an=tt*49+gt,Rn=an+48+1;Ne.push(an,Rn,an+1,Rn,Rn+1,an+1)}let De=new jt;return De.setAttribute("position",new St(lt,3)),De.setIndex(Ne),De.computeVertexNormals(),De}let qe=(I,q)=>Math.exp(-((I/q)**2)),Ye=S(0,1,0);function ht(I,q,ee,Z,te,Ie){let He=new N().subVectors(q,I),Ze=He.length(),lt=new zt(new ji(Z,ee,Ze,18),te);lt.position.copy(I).addScaledVector(He,.5),lt.quaternion.setFromUnitVectors(Ye,He.normalize()),Ie.add(lt),p(f,te,I.x,I.y,I.z,ee,ee,ee,Ie),p(f,te,q.x,q.y,q.z,Z,Z,Z,Ie)}let Le=new gn;r.add(Le);let ie=["torso","pelvis","head","uaL","faL","uaR","faR","legL","legR"],re={},J={},ye=[],ve,Xe=null,L,je=new N,Oe=new N,Ke=e.TARGET_RADIUS,he=a(256,256,(I,q,ee)=>{let Z=I.createRadialGradient(128,128,0,128,128,128);Z.addColorStop(0,"rgba(255,230,140,1)"),Z.addColorStop(.45,"rgba(255,170,60,.5)"),Z.addColorStop(1,"rgba(255,140,40,0)"),I.fillStyle=Z,I.fillRect(0,0,q,ee);let te=128/1.6;I.strokeStyle="#ff7a2a",I.lineWidth=6;for(let Ie of[te*.965,te*.63])I.beginPath(),I.arc(128,128,Ie,0,7),I.stroke();I.fillStyle="#ff7a2a",I.beginPath(),I.arc(128,128,te*.2,0,7),I.fill()});u.push(he);let yt=new Ji({map:he,transparent:!0,depthWrite:!1,polygonOffset:!0,polygonOffsetFactor:-4,toneMapped:!1}),T=new Set([f,d,h]);function M(){let I=new Set,q=new Set,ee=new Set;Le.traverse(Z=>{Z.isMesh&&Z!==ae&&(T.has(Z.geometry)||I.add(Z.geometry),Z.material!==yt&&(q.add(Z.material),Z.material.map&&ee.add(Z.material.map)))});for(let Z of I)Z.dispose();for(let Z of q)Z.dispose();for(let Z of ee)Z.dispose();Le.clear()}function B(){M(),Xe=null,re={};for(let Ne of ie){let De=new gn;De.matrixAutoUpdate=!1,De.userData.seg=Ne,Le.add(De),re[Ne]=De}let I=l("#e5b088",.55),q=l("#3a2414",.8),ee=a(128,128,(Ne,De,tt)=>{Ne.fillStyle="#f4d8a8",Ne.fillRect(0,0,De,tt),Ne.fillStyle="rgba(0,0,0,.08)";for(let gt=0;gt<tt;gt+=16)Ne.fillRect(0,gt,De,6);for(let gt=0;gt<1500;gt++)Ne.fillStyle=`rgba(255,255,255,${_(0,.25)})`,Ne.fillRect(_(0,De),_(0,tt),1,2)});ee.wrapS=ee.wrapT=Ws,ee.repeat.set(2,3);let Z=l("#ffffff",1,{map:ee}),te=ne+.005,Ie=1.03;J={N:S(0,te+.1,-.88),H:S(0,te+.11,-1.1),P:S(0,te+.1,0),SL:S(-.23*Ie,te+.08,-.79),SR:S(.23*Ie,te+.08,-.79),HL:S(-.15*Ie,te+.09,.02),HR:S(.15*Ie,te+.09,.02),EL:S(-.37,te+.05,-1.03),ER:S(.37,te+.05,-1.03),WL:S(-.1,te+.05,-1.24),WR:S(.1,te+.05,-1.24),KL:S(-.1,te+.06,.55),KR:S(.1,te+.06,.55),AL:S(-.095,te+.05,.93),AR:S(.095,te+.05,.93)},ve=new zt(Be(-.9,.08,Ne=>Ie*ce([[0,.07],[.1,.2],[.2,.245],[.36,.215],[.68,.165],[1,.19]])(Ne),ce([[0,.05],[.12,.095],[.3,.115],[.55,.095],[.75,.075],[1,.1]]),ce([[0,.05],[.15,.075],[1,.07]]),(Ne,De)=>{let tt=-.9+.98*De,gt=-.012*qe(Ne,.022)*ce([[0,0],[.2,1],[.9,1],[1,.3]])(De);for(let an of[-1,1])gt+=.02*qe(Ne-an*.095,.055)*qe(tt+.66,.09);return gt}),I),ve.position.y=te+.07,re.torso.add(ve);for(let Ne of[-1,1])p(f,I,Ne*.215*Ie,te+.085,-.79,.075,.07,.085,re.torso);ht(S(0,te+.1,-.86),S(0,te+.1,-.98),.06,.052,I,re.head),p(f,I,0,te+.11,-1.08,.08,.1,.11,re.head),p(f,q,0,te+.14,-1.102,.086,.09,.108,re.head);for(let Ne of[-1,1]){let De=Ne<0?"L":"R",tt=re["ua"+De],gt=re["fa"+De],an=J["S"+De],Rn=J["E"+De],Pr=J["W"+De];ht(an,Rn,.058,.045,I,tt),p(f,I,Ne*.29,te+.075,-.9,.06,.05,.075,tt).rotation.y=Ne*.6,ht(Rn,Pr,.044,.034,I,gt),p(f,I,Pr.x-Ne*.04,te+.035,-1.27,.06,.022,.045,gt).rotation.y=Ne*.5,p(f,I,Pr.x-Ne*.02,te+.035,-1.22,.025,.017,.012,gt).rotation.y=Ne*1.1}let He=new zt(Be(-.06,.62,Ne=>Ie*ce([[0,.205],[.25,.22],[.6,.2],[1,.17]])(Ne),ce([[0,.1],[.22,.13],[.45,.1],[1,.075]]),()=>.075,(Ne,De)=>-.02*qe(Ne,.03)*ce([[0,.2],[.3,1],[1,.6]])(De)),Z);He.position.y=te+.075,He.scale.set(1.04,1.04,1),re.pelvis.add(He);for(let Ne of[-1,1]){let De=Ne<0?"L":"R",tt=re["leg"+De];ht(J["K"+De],J["A"+De],.058,.032,I,tt),p(f,I,Ne*.1,te+.075,.68,.058,.05,.1,tt),p(f,I,Ne*.1,te+.035,.98,.038,.035,.065,tt).rotation.x=1,p(f,I,Ne*.1,te+.075,.955,.033,.03,.03,tt)}c(Le),ye=[],Le.traverse(Ne=>{Ne.isMesh&&ye.push(Ne)}),Le.updateMatrixWorld(!0);let Ze=new ia;Ze.set(S(_(-.09,.09),2,_(-.63,-.25)),S(0,-1,0));let lt=Ze.intersectObject(ve,!1)[0];if(lt){let Ne=lt.face.normal.clone().transformDirection(lt.object.matrixWorld),De=new fn;De.position.copy(lt.point),De.lookAt(lt.point.clone().add(Ne)),L=new zt(new Of(ve,lt.point,De.rotation,S(Ke*3.2,Ke*3.2,.12)),yt),L.renderOrder=2,re.torso.add(L),je.copy(Le.worldToLocal(lt.point.clone()))}}let $={torso:["N","P","SL","SR"],pelvis:["P","KM","HL","HR"],head:["N","H","SL","SR"],uaL:["SL","EL","SL","SR"],faL:["EL","WL","SL","SR"],uaR:["SR","ER","SL","SR"],faR:["ER","WR","SL","SR"],legL:["KL","AL","HL","HR"],legR:["KR","AR","HL","HR"]},se=[["N","H"],["H","SL"],["H","SR"],["SL","EL"],["EL","WL"],["SR","ER"],["ER","WR"],["HL","KL"],["HR","KR"],["KL","AL"],["KR","AR"],["KL","KR"]],de=[["WL","SL"],["WR","SR"],["AL","HL"],["AR","HR"],["H","P"]],pe={N:.07,P:.08,SL:.07,SR:.07,HL:.08,HR:.08,H:.1,EL:.045,ER:.045,WL:.04,WR:.04,KL:.055,KR:.055,AL:.035,AR:.035},Y=new N,j=new N,Te=new N,Pe=(I,q,ee,Z,te)=>{let Ie=Y.subVectors(q,I).normalize(),He=j.subVectors(Z,ee);He.addScaledVector(Ie,-He.dot(Ie)).normalize();let Ze=Te.crossVectors(He,Ie);return te.makeBasis(He,Ie,Ze)},_e=I=>I.KM.copy(I.KL).add(I.KR).multiplyScalar(.5),fe=1/120,nt=9.8;function st(I){Le.position.set(0,0,0),Le.scale.set(1,1,1),Le.updateMatrixWorld(!0);let q={},ee={},Z={},te={};for(let De in J)q[De]=J[De].clone(),ee[De]=J[De].clone(),te[De]=J[De].clone();q.KM=new N,te.KM=new N,_e(q),_e(te);for(let De of ie){let tt=$[De];Z[De]=Pe(te[tt[0]],te[tt[1]],te[tt[2]],te[tt[3]],new bt).transpose()}let Ie=[],He=(De,tt,gt)=>Ie.push([De,tt,J[De].distanceTo(J[tt]),gt]),Ze=["N","SL","SR","P","HL","HR"];for(let De=0;De<Ze.length;De++)for(let tt=De+1;tt<Ze.length;tt++)He(Ze[De],Ze[tt],0);for(let[De,tt]of se)He(De,tt,0);for(let[De,tt]of de)He(De,tt,1);let lt=Math.sign(I.x||Math.random()-.5),Ne=_(1.2,1.8);for(let De in J){let tt=J[De].distanceTo(I),gt=S(lt*_(.2,.45),1.9+1.6*Math.max(0,.7-tt),_(-.2,.2));/^[EWKA]/.test(De)&&gt.add(S(_(-1.6,1.6),_(0,1.8),_(-.8,.8))),gt.x+=(J[De].z-I.z)*Ne*.5*lt,ee[De].addScaledVector(gt,-fe*.18)}Xe={p:q,q:ee,cons:Ie,restB:Z,rp:te,M:new bt}}let ct=new N;function D(I,q,ee,Z){let te=.42+Z-Math.abs(I),Ie=ne+Z-q,He=q-(ne-.22-Z),Ze=ee-(-1.4-Z),lt=1.08+Z-ee;if(Math.min(te,Ie,He,Ze,lt)<=0)return null;let Ne=Math.min(te,Ie,He,Ze,lt);return ct.set(0,0,0),Ne===Ie?ct.y=Ie:Ne===te?ct.x=Math.sign(I||1)*te:Ne===He?ct.y=-He:Ne===Ze?ct.z=-Ze:ct.z=lt,ct}let ge=[...se,["N","P"],["SL","HL"],["SR","HR"],["SL","SR"],["HL","HR"]];function K(I){let{p:q,q:ee,cons:Z}=Xe;for(let Ie in J){let He=q[Ie],Ze=ee[Ie],lt=(He.x-Ze.x)*.999,Ne=(He.y-Ze.y)*.999,De=(He.z-Ze.z)*.999;Ze.copy(He),He.x+=lt,He.y+=Ne-nt*I*I,He.z+=De}let te=new Set;for(let Ie=0;Ie<12;Ie++){for(let[He,Ze,lt,Ne]of Z){let De=q[He],tt=q[Ze],gt=Y.subVectors(tt,De),an=gt.length()||1e-6;if(Ne===1&&an>lt*.7)continue;let Rn=(an-(Ne===1?lt*.7:lt))/an*.5;De.addScaledVector(gt,Rn),tt.addScaledVector(gt,-Rn)}for(let[He,Ze]of ge){let lt=q[He],Ne=q[Ze],De=Math.min(pe[He],pe[Ze]);for(let tt of[.25,.5,.75]){let gt=D(lt.x+(Ne.x-lt.x)*tt,lt.y+(Ne.y-lt.y)*tt,lt.z+(Ne.z-lt.z)*tt,De);if(!gt)continue;let an=1-tt,Rn=tt,Pr=1/(an*an+Rn*Rn);lt.addScaledVector(gt,an*Pr),Ne.addScaledVector(gt,Rn*Pr),te.add(He),te.add(Ze)}}for(let He in J){let Ze=q[He],lt=pe[He],Ne=D(Ze.x,Ze.y,Ze.z,lt);Ne&&(Ze.add(Ne),te.add(He)),Ze.y<lt&&(Ze.y=lt,te.add(He)),Ze.x=$s.clamp(Ze.x,-2.3,2.3),Ze.z=Math.max(Ze.z,-1.75)}}for(let Ie of te){let He=q[Ie],Ze=ee[Ie];Ze.x+=(He.x-Ze.x)*.15,Ze.z+=(He.z-Ze.z)*.15}}function Re(){let{p:I,restB:q,rp:ee,M:Z}=Xe;_e(I);for(let te of ie){let Ie=$[te],He=re[te];Pe(I[Ie[0]],I[Ie[1]],I[Ie[2]],I[Ie[3]],Z).multiply(q[te]),He.matrix.copy(Z).setPosition(0,0,0);let Ze=ee[Ie[0]].clone().applyMatrix4(He.matrix);He.matrix.setPosition(I[Ie[0]].x-Ze.x,I[Ie[0]].y-Ze.y,I[Ie[0]].z-Ze.z),He.matrixWorldNeedsUpdate=!0}}let ae=new gn,oe=l("#f4f7fa",.2,{metalness:.42});p(new ji(.0028,.001,.22,10),oe,0,0,-.11,1,1,1,ae).rotation.x=Math.PI/2,c(ae),ae.scale.setScalar(1.95),r.add(ae);let ke=S(0,1.32,1.75),We=new N,Rt=new N,Mt=new N,Vt="ready",An=0,_s=0,sr=0,vs=0,xs=null,Qt=null,Cr=0,ys=0,Rr=0,ai=0,Ot=null,vi=!1,js=!1,rc=window.parent!==window,kf=rc&&new URLSearchParams(window.location.search).get("feedReview")==="1",qn=typeof zg=="boolean"?zg:!kf,xi=!document.hidden,Zt=null,sc=(ha=window.matchMedia)==null?void 0:ha.call(window,"(prefers-reduced-motion: reduce)").matches,or=()=>n({state:Vt,score:An,outcome:Qt,paused:!qn||!xi,showHint:!vi,attempts:_s,spotAttempts:sr,spotId:vs,targetX:je.x.toFixed(6),targetZ:je.z.toFixed(6),lastOutcome:xs});function oc(){if(!(!qn||!xi))try{Zt||(Zt=new(window.AudioContext||window.webkitAudioContext)),Zt.state!=="running"&&Zt.resume().catch(()=>{})}catch{Zt=null}}function E(I,q,ee,Z=.08){if(!qn||!xi||!Zt||Zt.state!=="running")return;let te=Zt.createOscillator(),Ie=Zt.createGain(),He=Zt.currentTime;te.type="sine",te.frequency.setValueAtTime(I,He),te.frequency.exponentialRampToValueAtTime(q,He+ee),Ie.gain.setValueAtTime(Z,He),Ie.gain.exponentialRampToValueAtTime(.001,He+ee),te.connect(Ie).connect(Zt.destination),te.onended=()=>{te.disconnect(),Ie.disconnect()},te.start(),te.stop(He+ee+.02)}let O=[],W=new ta(1,8,6);function z(I,q,ee){for(let Z=0;Z<q;Z++){let te=new zt(W,new Ji({color:ee,transparent:!0,depthWrite:!1}));te.position.copy(I),te.scale.setScalar(.012),r.add(te);let Ie=_(0,Math.PI*2);O.push({m:te,v:S(Math.cos(Ie)*.3,_(.15,.4),Math.sin(Ie)*.3),t:0})}}function H(){for(let I of O)r.remove(I.m),I.m.material.dispose();O.length=0}let Se=new ia,be=new N,Me=new N;function ze(I){let q=ye.includes(I.object);if(be.copy(Mt).normalize(),We.copy(I.point).addScaledVector(be,q?.035:.02),ae.position.copy(We),ae.lookAt(We.clone().sub(be)),Vt="stuck",Rr=0,q){Le.updateMatrixWorld(!0),Oe.copy(Le.localToWorld(je.clone()));let ee=I.point.distanceTo(Oe),Z=ee<Ke?Math.max(1,Math.round(100*(1-ee/Ke)**.8)):0;if(Z>0)An+=Z,Qt="bliss",Le.attach(ae),ai=.001,z(I.point,20,"#ffd36a"),E(420,720,.35);else{Qt="ouch";let te=I.object;for(;te&&!te.userData.seg;)te=te.parent;st(I.point),(te||Le).attach(ae),z(I.point,8,"#ff5a4a"),E(260,90,.22)}}else Qt="miss",E(140,70,.15),z(I.point,6,"#c8b090");xs=Qt,or()}function Ve(I=!1,q=!1){if(!js){if(mt(),ae.parent!==r&&r.attach(ae),H(),Le.position.set(0,0,0),Le.scale.set(1,1,1),I||(An=0,_s=0,sr=0,vs=0,xs=null,vi=!1),q&&L){Xe=null;for(let ee of Object.values(re))ee.matrix.identity(),ee.matrixWorldNeedsUpdate=!0}else B(),vs++,sr=0;Le.updateMatrixWorld(!0),Vt="ready",Qt=null,ai=0,Cr=0,ys=0,Rr=0,yt.opacity=.95,We.copy(ke),Rt.copy(We),or(),I||(ft(0),Pt())}}function rt(I,q,ee,Z){let te=$s.clamp(2.7+ee*5.2+(ee/Z-1.5)*.26,2.75,6.5);return I.set($s.clamp(q/Math.max(ee,.08)*te*.58,-3.3,3.3),.35*te,-te)}function ot(I){return I.copy(ke)}function Ge(I,q,ee){Vt!=="ready"||sr>=ua||(rt(Mt,I,q,ee),ot(We),Rt.copy(We),vi=!0,_s++,sr++,Vt="fly",ys=0,E(540,210,.16,.045),or(),Pt())}let at=i.domElement;function Bt(I){var q;if(!(!qn||!xi||Vt!=="ready"||Ot||I.button!==void 0&&I.button!==0)){I.preventDefault(),Ot={id:I.pointerId,x:I.clientX,y:I.clientY,currentX:I.clientX,currentY:I.clientY,t:performance.now(),samples:[{x:I.clientX,y:I.clientY,t:performance.now()}]};try{(q=at.setPointerCapture)==null||q.call(at,I.pointerId)}catch{}oc()}}function Nt(I){if(!Ot||I.pointerId!==Ot.id||!qn||!xi)return;let q=Math.max(1,t.clientHeight);I.preventDefault(),Ot.currentX=I.clientX,Ot.currentY=I.clientY;let ee=performance.now();for(Ot.samples.push({x:I.clientX,y:I.clientY,t:ee});Ot.samples.length>2&&Ot.samples[1].t<ee-220;)Ot.samples.shift();!vi&&Math.hypot(I.clientX-Ot.x,I.clientY-Ot.y)>=q*.012?(vi=!0,or(),Pt()):vi||ft(0)}function mt(I){var ee;if((I==null?void 0:I.pointerId)!==void 0&&Ot&&I.pointerId!==Ot.id)return;let q=Ot==null?void 0:Ot.id;Ot=null;try{q!==void 0&&((ee=at.hasPointerCapture)!=null&&ee.call(at,q))&&at.releasePointerCapture(q)}catch{}}function en(I){if(!Ot||I.pointerId!==Ot.id)return;let q=Ot,ee=performance.now(),Z=lR(q.samples,q.x,q.y,I.clientX,I.clientY,ee,t.clientHeight);mt(I),!(!qn||!xi||Vt!=="ready"||!Z)&&(I.preventDefault(),oc(),Ge(Z.dx,Z.length,Z.seconds))}at.addEventListener("pointerdown",Bt,{passive:!1}),window.addEventListener("pointermove",Nt,{capture:!0,passive:!1}),window.addEventListener("pointerup",en,{capture:!0,passive:!1}),window.addEventListener("pointercancel",mt,!0),at.addEventListener("lostpointercapture",mt);function Ce(){let I=Math.max(1,t.clientWidth),q=Math.max(1,t.clientHeight);i.setSize(I,q,!1),s.aspect=I/q,s.clearViewOffset();let ee=S(0,.75,.05),Z=S(0,1.05,1).normalize(),te=Math.max(4.3,4.65*Math.max(1,q/I/(598/390)));s.position.copy(ee).addScaledVector(Z,te),s.lookAt(ee),s.updateProjectionMatrix(),s.updateMatrixWorld(),ft(0)}function Cn(I,q=!1){if(Cr+=I,Xe)q||K(I);else{let ee=sc?0:Math.sin(Cr*1.7);Le.scale.y=1-ai*.12,Le.position.y=ee*.008+ne*ai*.12}if(ai>0&&!q&&(ai=Math.min(1,ai+I*1.5)),yt.opacity=sc?.9:.8+Math.sin(Cr*5)*.15,!q){for(let ee=O.length-1;ee>=0;ee--){let Z=O[ee];Z.t+=I,Z.v.y-=I*1.5,Z.m.position.addScaledVector(Z.v,I),Z.m.material.opacity=Math.max(0,1-Z.t),Z.t>=1&&(r.remove(Z.m),Z.m.material.dispose(),O.splice(ee,1))}if(Vt==="fly"){ys+=I,Rt.copy(We),Mt.y-=nt*I,We.addScaledVector(Mt,I),be.subVectors(We,Rt);let ee=be.length();if(ee>0){Se.set(Rt,be.normalize()),Se.far=ee+.001,r.updateMatrixWorld(!0);let Z=Se.intersectObjects(ye.concat(m),!1)[0];if(Z){ze(Z);return}}(We.y<-.5||ys>4||Math.abs(We.x)>6||We.z<-6)&&(Vt="stuck",Qt="miss",xs=Qt,Rr=0,or())}else Vt==="stuck"&&(Rr+=I,Rr>(Qt==="bliss"?1.4:1.05)&&Ve(!0,!cR(Qt,sr)))}}function ft(I){ae.visible=Vt!=="ready",Vt==="fly"&&(ae.position.lerpVectors(Rt,We,I),ae.lookAt(Me.copy(ae.position).sub(Mt))),Xe&&Re(),i.render(r,s)}let tn=0,Bn=performance.now(),kn=0;function ar(){return xi&&qn}function Et(I){if(tn=0,js||!ar())return;let q=Math.min(.05,(I-Bn)/1e3);for(Bn=I,kn+=q;kn>=fe;)Cn(fe,!qn),kn-=fe;ft(kn/fe),tn=requestAnimationFrame(Et)}function Pt(){cancelAnimationFrame(tn),tn=0,Bn=performance.now(),kn=0,ar()&&(tn=requestAnimationFrame(Et))}function Bi(I){qn=I,qn||(mt(),Zt==null||Zt.suspend().catch(()=>{})),or(),Pt()}function At(I){var q;I.source!==window.parent||I.origin!==window.location.origin||((q=I.data)==null?void 0:q.type)!=="playable-active"||typeof I.data.active!="boolean"||Bi(I.data.active)}function yi(){xi=!document.hidden,xi||(mt(),Zt==null||Zt.suspend().catch(()=>{})),or(),Pt()}window.addEventListener("message",At),document.addEventListener("visibilitychange",yi),window.addEventListener("resize",Ce);let Yn=typeof ResizeObserver<"u"?new ResizeObserver(Ce):null;return Yn==null||Yn.observe(t),Ve(),Ce(),i.compile(r,s),Pt(),window.__acupuncture={get state(){return Vt},get score(){return An},get spotAttempts(){return sr},get spotId(){return vs},get outcome(){return Qt},get active(){return qn},get targetScreen(){let I=Le.localToWorld(je.clone()).project(s);return{x:(I.x+1)*t.clientWidth/2,y:(1-I.y)*t.clientHeight/2}},get startScreen(){let I=ke.clone().project(s);return{x:(I.x+1)*t.clientWidth/2,y:(1-I.y)*t.clientHeight/2}}},{reset:Ve,dispose(){js=!0,mt(),cancelAnimationFrame(tn),Yn==null||Yn.disconnect(),window.removeEventListener("resize",Ce),window.removeEventListener("message",At),document.removeEventListener("visibilitychange",yi),at.removeEventListener("pointerdown",Bt),window.removeEventListener("pointermove",Nt,!0),window.removeEventListener("pointerup",en,!0),window.removeEventListener("pointercancel",mt,!0),at.removeEventListener("lostpointercapture",mt),Zt==null||Zt.close().catch(()=>{}),H();let I=new Set,q=new Set,ee=new Set(u);r.traverse(Z=>{if(Z.isMesh){I.add(Z.geometry);for(let te of Array.isArray(Z.material)?Z.material:[Z.material])q.add(te),te.map&&ee.add(te.map)}}),I.add(W);for(let Z of I)Z.dispose();for(let Z of q)Z.dispose();for(let Z of ee)Z.dispose();i.dispose(),at.remove(),delete window.__acupuncture}}}(0,SS.createRoot)(document.getElementById("root")).render((0,_i.jsx)(uR,{}));})();
