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

(()=>{var tS=Object.create;var hg=Object.defineProperty;var nS=Object.getOwnPropertyDescriptor;var iS=Object.getOwnPropertyNames;var rS=Object.getPrototypeOf,sS=Object.prototype.hasOwnProperty;var ki=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var oS=(t,e,n,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of iS(e))!sS.call(t,r)&&r!==n&&hg(t,r,{get:()=>e[r],enumerable:!(i=nS(e,r))||i.enumerable});return t};var Al=(t,e,n)=>(n=t!=null?tS(rS(t)):{},oS(e||!t||!t.__esModule?hg(n,"default",{value:t,enumerable:!0}):n,t));var Eg=ki(Je=>{"use strict";var Oo=Symbol.for("react.element"),aS=Symbol.for("react.portal"),lS=Symbol.for("react.fragment"),cS=Symbol.for("react.strict_mode"),uS=Symbol.for("react.profiler"),hS=Symbol.for("react.provider"),dS=Symbol.for("react.context"),fS=Symbol.for("react.forward_ref"),pS=Symbol.for("react.suspense"),mS=Symbol.for("react.memo"),gS=Symbol.for("react.lazy"),dg=Symbol.iterator;function vS(t){return t===null||typeof t!="object"?null:(t=dg&&t[dg]||t["@@iterator"],typeof t=="function"?t:null)}var mg={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},gg=Object.assign,vg={};function Cs(t,e,n){this.props=t,this.context=e,this.refs=vg,this.updater=n||mg}Cs.prototype.isReactComponent={};Cs.prototype.setState=function(t,e){if(typeof t!="object"&&typeof t!="function"&&t!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,t,e,"setState")};Cs.prototype.forceUpdate=function(t){this.updater.enqueueForceUpdate(this,t,"forceUpdate")};function xg(){}xg.prototype=Cs.prototype;function hd(t,e,n){this.props=t,this.context=e,this.refs=vg,this.updater=n||mg}var dd=hd.prototype=new xg;dd.constructor=hd;gg(dd,Cs.prototype);dd.isPureReactComponent=!0;var fg=Array.isArray,_g=Object.prototype.hasOwnProperty,fd={current:null},yg={key:!0,ref:!0,__self:!0,__source:!0};function Sg(t,e,n){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)_g.call(e,i)&&!yg.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=n;else if(1<a){for(var l=Array(a),c=0;c<a;c++)l[c]=arguments[c+2];r.children=l}if(t&&t.defaultProps)for(i in a=t.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:Oo,type:t,key:s,ref:o,props:r,_owner:fd.current}}function xS(t,e){return{$$typeof:Oo,type:t.type,key:e,ref:t.ref,props:t.props,_owner:t._owner}}function pd(t){return typeof t=="object"&&t!==null&&t.$$typeof===Oo}function _S(t){var e={"=":"=0",":":"=2"};return"$"+t.replace(/[=:]/g,function(n){return e[n]})}var pg=/\/+/g;function ud(t,e){return typeof t=="object"&&t!==null&&t.key!=null?_S(""+t.key):e.toString(36)}function Rl(t,e,n,i,r){var s=typeof t;(s==="undefined"||s==="boolean")&&(t=null);var o=!1;if(t===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(t.$$typeof){case Oo:case aS:o=!0}}if(o)return o=t,r=r(o),t=i===""?"."+ud(o,0):i,fg(r)?(n="",t!=null&&(n=t.replace(pg,"$&/")+"/"),Rl(r,e,n,"",function(c){return c})):r!=null&&(pd(r)&&(r=xS(r,n+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(pg,"$&/")+"/")+t)),e.push(r)),1;if(o=0,i=i===""?".":i+":",fg(t))for(var a=0;a<t.length;a++){s=t[a];var l=i+ud(s,a);o+=Rl(s,e,n,l,r)}else if(l=vS(t),typeof l=="function")for(t=l.call(t),a=0;!(s=t.next()).done;)s=s.value,l=i+ud(s,a++),o+=Rl(s,e,n,l,r);else if(s==="object")throw e=String(t),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function Cl(t,e,n){if(t==null)return t;var i=[],r=0;return Rl(t,i,"","",function(s){return e.call(n,s,r++)}),i}function yS(t){if(t._status===-1){var e=t._result;e=e(),e.then(function(n){(t._status===0||t._status===-1)&&(t._status=1,t._result=n)},function(n){(t._status===0||t._status===-1)&&(t._status=2,t._result=n)}),t._status===-1&&(t._status=0,t._result=e)}if(t._status===1)return t._result.default;throw t._result}var mn={current:null},Pl={transition:null},SS={ReactCurrentDispatcher:mn,ReactCurrentBatchConfig:Pl,ReactCurrentOwner:fd};function Mg(){throw Error("act(...) is not supported in production builds of React.")}Je.Children={map:Cl,forEach:function(t,e,n){Cl(t,function(){e.apply(this,arguments)},n)},count:function(t){var e=0;return Cl(t,function(){e++}),e},toArray:function(t){return Cl(t,function(e){return e})||[]},only:function(t){if(!pd(t))throw Error("React.Children.only expected to receive a single React element child.");return t}};Je.Component=Cs;Je.Fragment=lS;Je.Profiler=uS;Je.PureComponent=hd;Je.StrictMode=cS;Je.Suspense=pS;Je.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=SS;Je.act=Mg;Je.cloneElement=function(t,e,n){if(t==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+t+".");var i=gg({},t.props),r=t.key,s=t.ref,o=t._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=fd.current),e.key!==void 0&&(r=""+e.key),t.type&&t.type.defaultProps)var a=t.type.defaultProps;for(l in e)_g.call(e,l)&&!yg.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=n;else if(1<l){a=Array(l);for(var c=0;c<l;c++)a[c]=arguments[c+2];i.children=a}return{$$typeof:Oo,type:t.type,key:r,ref:s,props:i,_owner:o}};Je.createContext=function(t){return t={$$typeof:dS,_currentValue:t,_currentValue2:t,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},t.Provider={$$typeof:hS,_context:t},t.Consumer=t};Je.createElement=Sg;Je.createFactory=function(t){var e=Sg.bind(null,t);return e.type=t,e};Je.createRef=function(){return{current:null}};Je.forwardRef=function(t){return{$$typeof:fS,render:t}};Je.isValidElement=pd;Je.lazy=function(t){return{$$typeof:gS,_payload:{_status:-1,_result:t},_init:yS}};Je.memo=function(t,e){return{$$typeof:mS,type:t,compare:e===void 0?null:e}};Je.startTransition=function(t){var e=Pl.transition;Pl.transition={};try{t()}finally{Pl.transition=e}};Je.unstable_act=Mg;Je.useCallback=function(t,e){return mn.current.useCallback(t,e)};Je.useContext=function(t){return mn.current.useContext(t)};Je.useDebugValue=function(){};Je.useDeferredValue=function(t){return mn.current.useDeferredValue(t)};Je.useEffect=function(t,e){return mn.current.useEffect(t,e)};Je.useId=function(){return mn.current.useId()};Je.useImperativeHandle=function(t,e,n){return mn.current.useImperativeHandle(t,e,n)};Je.useInsertionEffect=function(t,e){return mn.current.useInsertionEffect(t,e)};Je.useLayoutEffect=function(t,e){return mn.current.useLayoutEffect(t,e)};Je.useMemo=function(t,e){return mn.current.useMemo(t,e)};Je.useReducer=function(t,e,n){return mn.current.useReducer(t,e,n)};Je.useRef=function(t){return mn.current.useRef(t)};Je.useState=function(t){return mn.current.useState(t)};Je.useSyncExternalStore=function(t,e,n){return mn.current.useSyncExternalStore(t,e,n)};Je.useTransition=function(){return mn.current.useTransition()};Je.version="18.3.1"});var Il=ki((BC,wg)=>{"use strict";wg.exports=Eg()});var Dg=ki(xt=>{"use strict";function xd(t,e){var n=t.length;t.push(e);e:for(;0<n;){var i=n-1>>>1,r=t[i];if(0<Ll(r,e))t[i]=e,t[n]=r,n=i;else break e}}function ri(t){return t.length===0?null:t[0]}function Dl(t){if(t.length===0)return null;var e=t[0],n=t.pop();if(n!==e){t[0]=n;e:for(var i=0,r=t.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=t[o],l=o+1,c=t[l];if(0>Ll(a,n))l<r&&0>Ll(c,a)?(t[i]=c,t[l]=n,i=l):(t[i]=a,t[o]=n,i=o);else if(l<r&&0>Ll(c,n))t[i]=c,t[l]=n,i=l;else break e}}return e}function Ll(t,e){var n=t.sortIndex-e.sortIndex;return n!==0?n:t.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(bg=performance,xt.unstable_now=function(){return bg.now()}):(md=Date,Tg=md.now(),xt.unstable_now=function(){return md.now()-Tg});var bg,md,Tg,yi=[],ur=[],MS=1,Xn=null,on=3,Ul=!1,Kr=!1,ko=!1,Rg=typeof setTimeout=="function"?setTimeout:null,Pg=typeof clearTimeout=="function"?clearTimeout:null,Ag=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function _d(t){for(var e=ri(ur);e!==null;){if(e.callback===null)Dl(ur);else if(e.startTime<=t)Dl(ur),e.sortIndex=e.expirationTime,xd(yi,e);else break;e=ri(ur)}}function yd(t){if(ko=!1,_d(t),!Kr)if(ri(yi)!==null)Kr=!0,Md(Sd);else{var e=ri(ur);e!==null&&Ed(yd,e.startTime-t)}}function Sd(t,e){Kr=!1,ko&&(ko=!1,Pg(zo),zo=-1),Ul=!0;var n=on;try{for(_d(e),Xn=ri(yi);Xn!==null&&(!(Xn.expirationTime>e)||t&&!Ng());){var i=Xn.callback;if(typeof i=="function"){Xn.callback=null,on=Xn.priorityLevel;var r=i(Xn.expirationTime<=e);e=xt.unstable_now(),typeof r=="function"?Xn.callback=r:Xn===ri(yi)&&Dl(yi),_d(e)}else Dl(yi);Xn=ri(yi)}if(Xn!==null)var s=!0;else{var o=ri(ur);o!==null&&Ed(yd,o.startTime-e),s=!1}return s}finally{Xn=null,on=n,Ul=!1}}var Fl=!1,Nl=null,zo=-1,Ig=5,Lg=-1;function Ng(){return!(xt.unstable_now()-Lg<Ig)}function gd(){if(Nl!==null){var t=xt.unstable_now();Lg=t;var e=!0;try{e=Nl(!0,t)}finally{e?Bo():(Fl=!1,Nl=null)}}else Fl=!1}var Bo;typeof Ag=="function"?Bo=function(){Ag(gd)}:typeof MessageChannel<"u"?(vd=new MessageChannel,Cg=vd.port2,vd.port1.onmessage=gd,Bo=function(){Cg.postMessage(null)}):Bo=function(){Rg(gd,0)};var vd,Cg;function Md(t){Nl=t,Fl||(Fl=!0,Bo())}function Ed(t,e){zo=Rg(function(){t(xt.unstable_now())},e)}xt.unstable_IdlePriority=5;xt.unstable_ImmediatePriority=1;xt.unstable_LowPriority=4;xt.unstable_NormalPriority=3;xt.unstable_Profiling=null;xt.unstable_UserBlockingPriority=2;xt.unstable_cancelCallback=function(t){t.callback=null};xt.unstable_continueExecution=function(){Kr||Ul||(Kr=!0,Md(Sd))};xt.unstable_forceFrameRate=function(t){0>t||125<t?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):Ig=0<t?Math.floor(1e3/t):5};xt.unstable_getCurrentPriorityLevel=function(){return on};xt.unstable_getFirstCallbackNode=function(){return ri(yi)};xt.unstable_next=function(t){switch(on){case 1:case 2:case 3:var e=3;break;default:e=on}var n=on;on=e;try{return t()}finally{on=n}};xt.unstable_pauseExecution=function(){};xt.unstable_requestPaint=function(){};xt.unstable_runWithPriority=function(t,e){switch(t){case 1:case 2:case 3:case 4:case 5:break;default:t=3}var n=on;on=t;try{return e()}finally{on=n}};xt.unstable_scheduleCallback=function(t,e,n){var i=xt.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,t){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=n+r,t={id:MS++,callback:e,priorityLevel:t,startTime:n,expirationTime:r,sortIndex:-1},n>i?(t.sortIndex=n,xd(ur,t),ri(yi)===null&&t===ri(ur)&&(ko?(Pg(zo),zo=-1):ko=!0,Ed(yd,n-i))):(t.sortIndex=r,xd(yi,t),Kr||Ul||(Kr=!0,Md(Sd))),t};xt.unstable_shouldYield=Ng;xt.unstable_wrapCallback=function(t){var e=on;return function(){var n=on;on=e;try{return t.apply(this,arguments)}finally{on=n}}}});var Fg=ki((zC,Ug)=>{"use strict";Ug.exports=Dg()});var zx=ki(On=>{"use strict";var ES=Il(),Un=Fg();function re(t){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+t,n=1;n<arguments.length;n++)e+="&args[]="+encodeURIComponent(arguments[n]);return"Minified React error #"+t+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var H0=new Set,la={};function us(t,e){$s(t,e),$s(t+"Capture",e)}function $s(t,e){for(la[t]=e,t=0;t<e.length;t++)H0.add(e[t])}var Xi=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),qd=Object.prototype.hasOwnProperty,wS=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,Og={},Bg={};function bS(t){return qd.call(Bg,t)?!0:qd.call(Og,t)?!1:wS.test(t)?Bg[t]=!0:(Og[t]=!0,!1)}function TS(t,e,n,i){if(n!==null&&n.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:n!==null?!n.acceptsBooleans:(t=t.toLowerCase().slice(0,5),t!=="data-"&&t!=="aria-");default:return!1}}function AS(t,e,n,i){if(e===null||typeof e>"u"||TS(t,e,n,i))return!0;if(i)return!1;if(n!==null)switch(n.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function xn(t,e,n,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=n,this.propertyName=t,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var nn={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t){nn[t]=new xn(t,0,!1,t,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(t){var e=t[0];nn[e]=new xn(e,1,!1,t[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(t){nn[t]=new xn(t,2,!1,t.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(t){nn[t]=new xn(t,2,!1,t,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t){nn[t]=new xn(t,3,!1,t.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(t){nn[t]=new xn(t,3,!0,t,null,!1,!1)});["capture","download"].forEach(function(t){nn[t]=new xn(t,4,!1,t,null,!1,!1)});["cols","rows","size","span"].forEach(function(t){nn[t]=new xn(t,6,!1,t,null,!1,!1)});["rowSpan","start"].forEach(function(t){nn[t]=new xn(t,5,!1,t.toLowerCase(),null,!1,!1)});var kf=/[\-:]([a-z])/g;function zf(t){return t[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t){var e=t.replace(kf,zf);nn[e]=new xn(e,1,!1,t,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t){var e=t.replace(kf,zf);nn[e]=new xn(e,1,!1,t,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(t){var e=t.replace(kf,zf);nn[e]=new xn(e,1,!1,t,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(t){nn[t]=new xn(t,1,!1,t.toLowerCase(),null,!1,!1)});nn.xlinkHref=new xn("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(t){nn[t]=new xn(t,1,!1,t.toLowerCase(),null,!0,!0)});function Vf(t,e,n,i){var r=nn.hasOwnProperty(e)?nn[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(AS(e,n,r,i)&&(n=null),i||r===null?bS(e)&&(n===null?t.removeAttribute(e):t.setAttribute(e,""+n)):r.mustUseProperty?t[r.propertyName]=n===null?r.type===3?!1:"":n:(e=r.attributeName,i=r.attributeNamespace,n===null?t.removeAttribute(e):(r=r.type,n=r===3||r===4&&n===!0?"":""+n,i?t.setAttributeNS(i,e,n):t.setAttribute(e,n))))}var $i=ES.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,Ol=Symbol.for("react.element"),Is=Symbol.for("react.portal"),Ls=Symbol.for("react.fragment"),Gf=Symbol.for("react.strict_mode"),Yd=Symbol.for("react.profiler"),W0=Symbol.for("react.provider"),X0=Symbol.for("react.context"),Hf=Symbol.for("react.forward_ref"),Zd=Symbol.for("react.suspense"),$d=Symbol.for("react.suspense_list"),Wf=Symbol.for("react.memo"),dr=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var q0=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var kg=Symbol.iterator;function Vo(t){return t===null||typeof t!="object"?null:(t=kg&&t[kg]||t["@@iterator"],typeof t=="function"?t:null)}var Pt=Object.assign,wd;function $o(t){if(wd===void 0)try{throw Error()}catch(n){var e=n.stack.trim().match(/\n( *(at )?)/);wd=e&&e[1]||""}return`
`+wd+t}var bd=!1;function Td(t,e){if(!t||bd)return"";bd=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(c){var i=c}Reflect.construct(t,[],e)}else{try{e.call()}catch(c){i=c}t.call(e.prototype)}else{try{throw Error()}catch(c){i=c}t()}}catch(c){if(c&&i&&typeof c.stack=="string"){for(var r=c.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return t.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",t.displayName)),l}while(1<=o&&0<=a);break}}}finally{bd=!1,Error.prepareStackTrace=n}return(t=t?t.displayName||t.name:"")?$o(t):""}function CS(t){switch(t.tag){case 5:return $o(t.type);case 16:return $o("Lazy");case 13:return $o("Suspense");case 19:return $o("SuspenseList");case 0:case 2:case 15:return t=Td(t.type,!1),t;case 11:return t=Td(t.type.render,!1),t;case 1:return t=Td(t.type,!0),t;default:return""}}function Jd(t){if(t==null)return null;if(typeof t=="function")return t.displayName||t.name||null;if(typeof t=="string")return t;switch(t){case Ls:return"Fragment";case Is:return"Portal";case Yd:return"Profiler";case Gf:return"StrictMode";case Zd:return"Suspense";case $d:return"SuspenseList"}if(typeof t=="object")switch(t.$$typeof){case X0:return(t.displayName||"Context")+".Consumer";case W0:return(t._context.displayName||"Context")+".Provider";case Hf:var e=t.render;return t=t.displayName,t||(t=e.displayName||e.name||"",t=t!==""?"ForwardRef("+t+")":"ForwardRef"),t;case Wf:return e=t.displayName||null,e!==null?e:Jd(t.type)||"Memo";case dr:e=t._payload,t=t._init;try{return Jd(t(e))}catch{}}return null}function RS(t){var e=t.type;switch(t.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return t=e.render,t=t.displayName||t.name||"",e.displayName||(t!==""?"ForwardRef("+t+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return Jd(e);case 8:return e===Gf?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function Tr(t){switch(typeof t){case"boolean":case"number":case"string":case"undefined":return t;case"object":return t;default:return""}}function Y0(t){var e=t.type;return(t=t.nodeName)&&t.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function PS(t){var e=Y0(t)?"checked":"value",n=Object.getOwnPropertyDescriptor(t.constructor.prototype,e),i=""+t[e];if(!t.hasOwnProperty(e)&&typeof n<"u"&&typeof n.get=="function"&&typeof n.set=="function"){var r=n.get,s=n.set;return Object.defineProperty(t,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(t,e,{enumerable:n.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){t._valueTracker=null,delete t[e]}}}}function Bl(t){t._valueTracker||(t._valueTracker=PS(t))}function Z0(t){if(!t)return!1;var e=t._valueTracker;if(!e)return!0;var n=e.getValue(),i="";return t&&(i=Y0(t)?t.checked?"true":"false":t.value),t=i,t!==n?(e.setValue(t),!0):!1}function dc(t){if(t=t||(typeof document<"u"?document:void 0),typeof t>"u")return null;try{return t.activeElement||t.body}catch{return t.body}}function Kd(t,e){var n=e.checked;return Pt({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:n??t._wrapperState.initialChecked})}function zg(t,e){var n=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;n=Tr(e.value!=null?e.value:n),t._wrapperState={initialChecked:i,initialValue:n,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function $0(t,e){e=e.checked,e!=null&&Vf(t,"checked",e,!1)}function jd(t,e){$0(t,e);var n=Tr(e.value),i=e.type;if(n!=null)i==="number"?(n===0&&t.value===""||t.value!=n)&&(t.value=""+n):t.value!==""+n&&(t.value=""+n);else if(i==="submit"||i==="reset"){t.removeAttribute("value");return}e.hasOwnProperty("value")?Qd(t,e.type,n):e.hasOwnProperty("defaultValue")&&Qd(t,e.type,Tr(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(t.defaultChecked=!!e.defaultChecked)}function Vg(t,e,n){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+t._wrapperState.initialValue,n||e===t.value||(t.value=e),t.defaultValue=e}n=t.name,n!==""&&(t.name=""),t.defaultChecked=!!t._wrapperState.initialChecked,n!==""&&(t.name=n)}function Qd(t,e,n){(e!=="number"||dc(t.ownerDocument)!==t)&&(n==null?t.defaultValue=""+t._wrapperState.initialValue:t.defaultValue!==""+n&&(t.defaultValue=""+n))}var Jo=Array.isArray;function Hs(t,e,n,i){if(t=t.options,e){e={};for(var r=0;r<n.length;r++)e["$"+n[r]]=!0;for(n=0;n<t.length;n++)r=e.hasOwnProperty("$"+t[n].value),t[n].selected!==r&&(t[n].selected=r),r&&i&&(t[n].defaultSelected=!0)}else{for(n=""+Tr(n),e=null,r=0;r<t.length;r++){if(t[r].value===n){t[r].selected=!0,i&&(t[r].defaultSelected=!0);return}e!==null||t[r].disabled||(e=t[r])}e!==null&&(e.selected=!0)}}function ef(t,e){if(e.dangerouslySetInnerHTML!=null)throw Error(re(91));return Pt({},e,{value:void 0,defaultValue:void 0,children:""+t._wrapperState.initialValue})}function Gg(t,e){var n=e.value;if(n==null){if(n=e.children,e=e.defaultValue,n!=null){if(e!=null)throw Error(re(92));if(Jo(n)){if(1<n.length)throw Error(re(93));n=n[0]}e=n}e==null&&(e=""),n=e}t._wrapperState={initialValue:Tr(n)}}function J0(t,e){var n=Tr(e.value),i=Tr(e.defaultValue);n!=null&&(n=""+n,n!==t.value&&(t.value=n),e.defaultValue==null&&t.defaultValue!==n&&(t.defaultValue=n)),i!=null&&(t.defaultValue=""+i)}function Hg(t){var e=t.textContent;e===t._wrapperState.initialValue&&e!==""&&e!==null&&(t.value=e)}function K0(t){switch(t){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function tf(t,e){return t==null||t==="http://www.w3.org/1999/xhtml"?K0(e):t==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":t}var kl,j0=function(t){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,n,i,r){MSApp.execUnsafeLocalFunction(function(){return t(e,n,i,r)})}:t}(function(t,e){if(t.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in t)t.innerHTML=e;else{for(kl=kl||document.createElement("div"),kl.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=kl.firstChild;t.firstChild;)t.removeChild(t.firstChild);for(;e.firstChild;)t.appendChild(e.firstChild)}});function ca(t,e){if(e){var n=t.firstChild;if(n&&n===t.lastChild&&n.nodeType===3){n.nodeValue=e;return}}t.textContent=e}var Qo={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},IS=["Webkit","ms","Moz","O"];Object.keys(Qo).forEach(function(t){IS.forEach(function(e){e=e+t.charAt(0).toUpperCase()+t.substring(1),Qo[e]=Qo[t]})});function Q0(t,e,n){return e==null||typeof e=="boolean"||e===""?"":n||typeof e!="number"||e===0||Qo.hasOwnProperty(t)&&Qo[t]?(""+e).trim():e+"px"}function ev(t,e){t=t.style;for(var n in e)if(e.hasOwnProperty(n)){var i=n.indexOf("--")===0,r=Q0(n,e[n],i);n==="float"&&(n="cssFloat"),i?t.setProperty(n,r):t[n]=r}}var LS=Pt({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function nf(t,e){if(e){if(LS[t]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(re(137,t));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(re(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(re(61))}if(e.style!=null&&typeof e.style!="object")throw Error(re(62))}}function rf(t,e){if(t.indexOf("-")===-1)return typeof e.is=="string";switch(t){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var sf=null;function Xf(t){return t=t.target||t.srcElement||window,t.correspondingUseElement&&(t=t.correspondingUseElement),t.nodeType===3?t.parentNode:t}var of=null,Ws=null,Xs=null;function Wg(t){if(t=Aa(t)){if(typeof of!="function")throw Error(re(280));var e=t.stateNode;e&&(e=zc(e),of(t.stateNode,t.type,e))}}function tv(t){Ws?Xs?Xs.push(t):Xs=[t]:Ws=t}function nv(){if(Ws){var t=Ws,e=Xs;if(Xs=Ws=null,Wg(t),e)for(t=0;t<e.length;t++)Wg(e[t])}}function iv(t,e){return t(e)}function rv(){}var Ad=!1;function sv(t,e,n){if(Ad)return t(e,n);Ad=!0;try{return iv(t,e,n)}finally{Ad=!1,(Ws!==null||Xs!==null)&&(rv(),nv())}}function ua(t,e){var n=t.stateNode;if(n===null)return null;var i=zc(n);if(i===null)return null;n=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(t=t.type,i=!(t==="button"||t==="input"||t==="select"||t==="textarea")),t=!i;break e;default:t=!1}if(t)return null;if(n&&typeof n!="function")throw Error(re(231,e,typeof n));return n}var af=!1;if(Xi)try{Rs={},Object.defineProperty(Rs,"passive",{get:function(){af=!0}}),window.addEventListener("test",Rs,Rs),window.removeEventListener("test",Rs,Rs)}catch{af=!1}var Rs;function NS(t,e,n,i,r,s,o,a,l){var c=Array.prototype.slice.call(arguments,3);try{e.apply(n,c)}catch(d){this.onError(d)}}var ea=!1,fc=null,pc=!1,lf=null,DS={onError:function(t){ea=!0,fc=t}};function US(t,e,n,i,r,s,o,a,l){ea=!1,fc=null,NS.apply(DS,arguments)}function FS(t,e,n,i,r,s,o,a,l){if(US.apply(this,arguments),ea){if(ea){var c=fc;ea=!1,fc=null}else throw Error(re(198));pc||(pc=!0,lf=c)}}function hs(t){var e=t,n=t;if(t.alternate)for(;e.return;)e=e.return;else{t=e;do e=t,e.flags&4098&&(n=e.return),t=e.return;while(t)}return e.tag===3?n:null}function ov(t){if(t.tag===13){var e=t.memoizedState;if(e===null&&(t=t.alternate,t!==null&&(e=t.memoizedState)),e!==null)return e.dehydrated}return null}function Xg(t){if(hs(t)!==t)throw Error(re(188))}function OS(t){var e=t.alternate;if(!e){if(e=hs(t),e===null)throw Error(re(188));return e!==t?null:t}for(var n=t,i=e;;){var r=n.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){n=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===n)return Xg(r),t;if(s===i)return Xg(r),e;s=s.sibling}throw Error(re(188))}if(n.return!==i.return)n=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===n){o=!0,n=r,i=s;break}if(a===i){o=!0,i=r,n=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===n){o=!0,n=s,i=r;break}if(a===i){o=!0,i=s,n=r;break}a=a.sibling}if(!o)throw Error(re(189))}}if(n.alternate!==i)throw Error(re(190))}if(n.tag!==3)throw Error(re(188));return n.stateNode.current===n?t:e}function av(t){return t=OS(t),t!==null?lv(t):null}function lv(t){if(t.tag===5||t.tag===6)return t;for(t=t.child;t!==null;){var e=lv(t);if(e!==null)return e;t=t.sibling}return null}var cv=Un.unstable_scheduleCallback,qg=Un.unstable_cancelCallback,BS=Un.unstable_shouldYield,kS=Un.unstable_requestPaint,Ot=Un.unstable_now,zS=Un.unstable_getCurrentPriorityLevel,qf=Un.unstable_ImmediatePriority,uv=Un.unstable_UserBlockingPriority,mc=Un.unstable_NormalPriority,VS=Un.unstable_LowPriority,hv=Un.unstable_IdlePriority,Fc=null,wi=null;function GS(t){if(wi&&typeof wi.onCommitFiberRoot=="function")try{wi.onCommitFiberRoot(Fc,t,void 0,(t.current.flags&128)===128)}catch{}}var ci=Math.clz32?Math.clz32:XS,HS=Math.log,WS=Math.LN2;function XS(t){return t>>>=0,t===0?32:31-(HS(t)/WS|0)|0}var zl=64,Vl=4194304;function Ko(t){switch(t&-t){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return t&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return t}}function gc(t,e){var n=t.pendingLanes;if(n===0)return 0;var i=0,r=t.suspendedLanes,s=t.pingedLanes,o=n&268435455;if(o!==0){var a=o&~r;a!==0?i=Ko(a):(s&=o,s!==0&&(i=Ko(s)))}else o=n&~r,o!==0?i=Ko(o):s!==0&&(i=Ko(s));if(i===0)return 0;if(e!==0&&e!==i&&!(e&r)&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if(i&4&&(i|=n&16),e=t.entangledLanes,e!==0)for(t=t.entanglements,e&=i;0<e;)n=31-ci(e),r=1<<n,i|=t[n],e&=~r;return i}function qS(t,e){switch(t){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function YS(t,e){for(var n=t.suspendedLanes,i=t.pingedLanes,r=t.expirationTimes,s=t.pendingLanes;0<s;){var o=31-ci(s),a=1<<o,l=r[o];l===-1?(!(a&n)||a&i)&&(r[o]=qS(a,e)):l<=e&&(t.expiredLanes|=a),s&=~a}}function cf(t){return t=t.pendingLanes&-1073741825,t!==0?t:t&1073741824?1073741824:0}function dv(){var t=zl;return zl<<=1,!(zl&4194240)&&(zl=64),t}function Cd(t){for(var e=[],n=0;31>n;n++)e.push(t);return e}function ba(t,e,n){t.pendingLanes|=e,e!==536870912&&(t.suspendedLanes=0,t.pingedLanes=0),t=t.eventTimes,e=31-ci(e),t[e]=n}function ZS(t,e){var n=t.pendingLanes&~e;t.pendingLanes=e,t.suspendedLanes=0,t.pingedLanes=0,t.expiredLanes&=e,t.mutableReadLanes&=e,t.entangledLanes&=e,e=t.entanglements;var i=t.eventTimes;for(t=t.expirationTimes;0<n;){var r=31-ci(n),s=1<<r;e[r]=0,i[r]=-1,t[r]=-1,n&=~s}}function Yf(t,e){var n=t.entangledLanes|=e;for(t=t.entanglements;n;){var i=31-ci(n),r=1<<i;r&e|t[i]&e&&(t[i]|=e),n&=~r}}var ht=0;function fv(t){return t&=-t,1<t?4<t?t&268435455?16:536870912:4:1}var pv,Zf,mv,gv,vv,uf=!1,Gl=[],xr=null,_r=null,yr=null,ha=new Map,da=new Map,pr=[],$S="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function Yg(t,e){switch(t){case"focusin":case"focusout":xr=null;break;case"dragenter":case"dragleave":_r=null;break;case"mouseover":case"mouseout":yr=null;break;case"pointerover":case"pointerout":ha.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":da.delete(e.pointerId)}}function Go(t,e,n,i,r,s){return t===null||t.nativeEvent!==s?(t={blockedOn:e,domEventName:n,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=Aa(e),e!==null&&Zf(e)),t):(t.eventSystemFlags|=i,e=t.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),t)}function JS(t,e,n,i,r){switch(e){case"focusin":return xr=Go(xr,t,e,n,i,r),!0;case"dragenter":return _r=Go(_r,t,e,n,i,r),!0;case"mouseover":return yr=Go(yr,t,e,n,i,r),!0;case"pointerover":var s=r.pointerId;return ha.set(s,Go(ha.get(s)||null,t,e,n,i,r)),!0;case"gotpointercapture":return s=r.pointerId,da.set(s,Go(da.get(s)||null,t,e,n,i,r)),!0}return!1}function xv(t){var e=es(t.target);if(e!==null){var n=hs(e);if(n!==null){if(e=n.tag,e===13){if(e=ov(n),e!==null){t.blockedOn=e,vv(t.priority,function(){mv(n)});return}}else if(e===3&&n.stateNode.current.memoizedState.isDehydrated){t.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}t.blockedOn=null}function nc(t){if(t.blockedOn!==null)return!1;for(var e=t.targetContainers;0<e.length;){var n=hf(t.domEventName,t.eventSystemFlags,e[0],t.nativeEvent);if(n===null){n=t.nativeEvent;var i=new n.constructor(n.type,n);sf=i,n.target.dispatchEvent(i),sf=null}else return e=Aa(n),e!==null&&Zf(e),t.blockedOn=n,!1;e.shift()}return!0}function Zg(t,e,n){nc(t)&&n.delete(e)}function KS(){uf=!1,xr!==null&&nc(xr)&&(xr=null),_r!==null&&nc(_r)&&(_r=null),yr!==null&&nc(yr)&&(yr=null),ha.forEach(Zg),da.forEach(Zg)}function Ho(t,e){t.blockedOn===e&&(t.blockedOn=null,uf||(uf=!0,Un.unstable_scheduleCallback(Un.unstable_NormalPriority,KS)))}function fa(t){function e(r){return Ho(r,t)}if(0<Gl.length){Ho(Gl[0],t);for(var n=1;n<Gl.length;n++){var i=Gl[n];i.blockedOn===t&&(i.blockedOn=null)}}for(xr!==null&&Ho(xr,t),_r!==null&&Ho(_r,t),yr!==null&&Ho(yr,t),ha.forEach(e),da.forEach(e),n=0;n<pr.length;n++)i=pr[n],i.blockedOn===t&&(i.blockedOn=null);for(;0<pr.length&&(n=pr[0],n.blockedOn===null);)xv(n),n.blockedOn===null&&pr.shift()}var qs=$i.ReactCurrentBatchConfig,vc=!0;function jS(t,e,n,i){var r=ht,s=qs.transition;qs.transition=null;try{ht=1,$f(t,e,n,i)}finally{ht=r,qs.transition=s}}function QS(t,e,n,i){var r=ht,s=qs.transition;qs.transition=null;try{ht=4,$f(t,e,n,i)}finally{ht=r,qs.transition=s}}function $f(t,e,n,i){if(vc){var r=hf(t,e,n,i);if(r===null)Ud(t,e,i,xc,n),Yg(t,i);else if(JS(r,t,e,n,i))i.stopPropagation();else if(Yg(t,i),e&4&&-1<$S.indexOf(t)){for(;r!==null;){var s=Aa(r);if(s!==null&&pv(s),s=hf(t,e,n,i),s===null&&Ud(t,e,i,xc,n),s===r)break;r=s}r!==null&&i.stopPropagation()}else Ud(t,e,i,null,n)}}var xc=null;function hf(t,e,n,i){if(xc=null,t=Xf(i),t=es(t),t!==null)if(e=hs(t),e===null)t=null;else if(n=e.tag,n===13){if(t=ov(e),t!==null)return t;t=null}else if(n===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;t=null}else e!==t&&(t=null);return xc=t,null}function _v(t){switch(t){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(zS()){case qf:return 1;case uv:return 4;case mc:case VS:return 16;case hv:return 536870912;default:return 16}default:return 16}}var gr=null,Jf=null,ic=null;function yv(){if(ic)return ic;var t,e=Jf,n=e.length,i,r="value"in gr?gr.value:gr.textContent,s=r.length;for(t=0;t<n&&e[t]===r[t];t++);var o=n-t;for(i=1;i<=o&&e[n-i]===r[s-i];i++);return ic=r.slice(t,1<i?1-i:void 0)}function rc(t){var e=t.keyCode;return"charCode"in t?(t=t.charCode,t===0&&e===13&&(t=13)):t=e,t===10&&(t=13),32<=t||t===13?t:0}function Hl(){return!0}function $g(){return!1}function Fn(t){function e(n,i,r,s,o){this._reactName=n,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in t)t.hasOwnProperty(a)&&(n=t[a],this[a]=n?n(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?Hl:$g,this.isPropagationStopped=$g,this}return Pt(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=Hl)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=Hl)},persist:function(){},isPersistent:Hl}),e}var no={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(t){return t.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},Kf=Fn(no),Ta=Pt({},no,{view:0,detail:0}),eM=Fn(Ta),Rd,Pd,Wo,Oc=Pt({},Ta,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:jf,button:0,buttons:0,relatedTarget:function(t){return t.relatedTarget===void 0?t.fromElement===t.srcElement?t.toElement:t.fromElement:t.relatedTarget},movementX:function(t){return"movementX"in t?t.movementX:(t!==Wo&&(Wo&&t.type==="mousemove"?(Rd=t.screenX-Wo.screenX,Pd=t.screenY-Wo.screenY):Pd=Rd=0,Wo=t),Rd)},movementY:function(t){return"movementY"in t?t.movementY:Pd}}),Jg=Fn(Oc),tM=Pt({},Oc,{dataTransfer:0}),nM=Fn(tM),iM=Pt({},Ta,{relatedTarget:0}),Id=Fn(iM),rM=Pt({},no,{animationName:0,elapsedTime:0,pseudoElement:0}),sM=Fn(rM),oM=Pt({},no,{clipboardData:function(t){return"clipboardData"in t?t.clipboardData:window.clipboardData}}),aM=Fn(oM),lM=Pt({},no,{data:0}),Kg=Fn(lM),cM={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},uM={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},hM={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function dM(t){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(t):(t=hM[t])?!!e[t]:!1}function jf(){return dM}var fM=Pt({},Ta,{key:function(t){if(t.key){var e=cM[t.key]||t.key;if(e!=="Unidentified")return e}return t.type==="keypress"?(t=rc(t),t===13?"Enter":String.fromCharCode(t)):t.type==="keydown"||t.type==="keyup"?uM[t.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:jf,charCode:function(t){return t.type==="keypress"?rc(t):0},keyCode:function(t){return t.type==="keydown"||t.type==="keyup"?t.keyCode:0},which:function(t){return t.type==="keypress"?rc(t):t.type==="keydown"||t.type==="keyup"?t.keyCode:0}}),pM=Fn(fM),mM=Pt({},Oc,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),jg=Fn(mM),gM=Pt({},Ta,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:jf}),vM=Fn(gM),xM=Pt({},no,{propertyName:0,elapsedTime:0,pseudoElement:0}),_M=Fn(xM),yM=Pt({},Oc,{deltaX:function(t){return"deltaX"in t?t.deltaX:"wheelDeltaX"in t?-t.wheelDeltaX:0},deltaY:function(t){return"deltaY"in t?t.deltaY:"wheelDeltaY"in t?-t.wheelDeltaY:"wheelDelta"in t?-t.wheelDelta:0},deltaZ:0,deltaMode:0}),SM=Fn(yM),MM=[9,13,27,32],Qf=Xi&&"CompositionEvent"in window,ta=null;Xi&&"documentMode"in document&&(ta=document.documentMode);var EM=Xi&&"TextEvent"in window&&!ta,Sv=Xi&&(!Qf||ta&&8<ta&&11>=ta),Qg=" ",e0=!1;function Mv(t,e){switch(t){case"keyup":return MM.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function Ev(t){return t=t.detail,typeof t=="object"&&"data"in t?t.data:null}var Ns=!1;function wM(t,e){switch(t){case"compositionend":return Ev(e);case"keypress":return e.which!==32?null:(e0=!0,Qg);case"textInput":return t=e.data,t===Qg&&e0?null:t;default:return null}}function bM(t,e){if(Ns)return t==="compositionend"||!Qf&&Mv(t,e)?(t=yv(),ic=Jf=gr=null,Ns=!1,t):null;switch(t){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return Sv&&e.locale!=="ko"?null:e.data;default:return null}}var TM={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function t0(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e==="input"?!!TM[t.type]:e==="textarea"}function wv(t,e,n,i){tv(i),e=_c(e,"onChange"),0<e.length&&(n=new Kf("onChange","change",null,n,i),t.push({event:n,listeners:e}))}var na=null,pa=null;function AM(t){Uv(t,0)}function Bc(t){var e=Fs(t);if(Z0(e))return t}function CM(t,e){if(t==="change")return e}var bv=!1;Xi&&(Xi?(Xl="oninput"in document,Xl||(Ld=document.createElement("div"),Ld.setAttribute("oninput","return;"),Xl=typeof Ld.oninput=="function"),Wl=Xl):Wl=!1,bv=Wl&&(!document.documentMode||9<document.documentMode));var Wl,Xl,Ld;function n0(){na&&(na.detachEvent("onpropertychange",Tv),pa=na=null)}function Tv(t){if(t.propertyName==="value"&&Bc(pa)){var e=[];wv(e,pa,t,Xf(t)),sv(AM,e)}}function RM(t,e,n){t==="focusin"?(n0(),na=e,pa=n,na.attachEvent("onpropertychange",Tv)):t==="focusout"&&n0()}function PM(t){if(t==="selectionchange"||t==="keyup"||t==="keydown")return Bc(pa)}function IM(t,e){if(t==="click")return Bc(e)}function LM(t,e){if(t==="input"||t==="change")return Bc(e)}function NM(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var hi=typeof Object.is=="function"?Object.is:NM;function ma(t,e){if(hi(t,e))return!0;if(typeof t!="object"||t===null||typeof e!="object"||e===null)return!1;var n=Object.keys(t),i=Object.keys(e);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var r=n[i];if(!qd.call(e,r)||!hi(t[r],e[r]))return!1}return!0}function i0(t){for(;t&&t.firstChild;)t=t.firstChild;return t}function r0(t,e){var n=i0(t);t=0;for(var i;n;){if(n.nodeType===3){if(i=t+n.textContent.length,t<=e&&i>=e)return{node:n,offset:e-t};t=i}e:{for(;n;){if(n.nextSibling){n=n.nextSibling;break e}n=n.parentNode}n=void 0}n=i0(n)}}function Av(t,e){return t&&e?t===e?!0:t&&t.nodeType===3?!1:e&&e.nodeType===3?Av(t,e.parentNode):"contains"in t?t.contains(e):t.compareDocumentPosition?!!(t.compareDocumentPosition(e)&16):!1:!1}function Cv(){for(var t=window,e=dc();e instanceof t.HTMLIFrameElement;){try{var n=typeof e.contentWindow.location.href=="string"}catch{n=!1}if(n)t=e.contentWindow;else break;e=dc(t.document)}return e}function ep(t){var e=t&&t.nodeName&&t.nodeName.toLowerCase();return e&&(e==="input"&&(t.type==="text"||t.type==="search"||t.type==="tel"||t.type==="url"||t.type==="password")||e==="textarea"||t.contentEditable==="true")}function DM(t){var e=Cv(),n=t.focusedElem,i=t.selectionRange;if(e!==n&&n&&n.ownerDocument&&Av(n.ownerDocument.documentElement,n)){if(i!==null&&ep(n)){if(e=i.start,t=i.end,t===void 0&&(t=e),"selectionStart"in n)n.selectionStart=e,n.selectionEnd=Math.min(t,n.value.length);else if(t=(e=n.ownerDocument||document)&&e.defaultView||window,t.getSelection){t=t.getSelection();var r=n.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!t.extend&&s>i&&(r=i,i=s,s=r),r=r0(n,s);var o=r0(n,i);r&&o&&(t.rangeCount!==1||t.anchorNode!==r.node||t.anchorOffset!==r.offset||t.focusNode!==o.node||t.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),t.removeAllRanges(),s>i?(t.addRange(e),t.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),t.addRange(e)))}}for(e=[],t=n;t=t.parentNode;)t.nodeType===1&&e.push({element:t,left:t.scrollLeft,top:t.scrollTop});for(typeof n.focus=="function"&&n.focus(),n=0;n<e.length;n++)t=e[n],t.element.scrollLeft=t.left,t.element.scrollTop=t.top}}var UM=Xi&&"documentMode"in document&&11>=document.documentMode,Ds=null,df=null,ia=null,ff=!1;function s0(t,e,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;ff||Ds==null||Ds!==dc(i)||(i=Ds,"selectionStart"in i&&ep(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),ia&&ma(ia,i)||(ia=i,i=_c(df,"onSelect"),0<i.length&&(e=new Kf("onSelect","select",null,e,n),t.push({event:e,listeners:i}),e.target=Ds)))}function ql(t,e){var n={};return n[t.toLowerCase()]=e.toLowerCase(),n["Webkit"+t]="webkit"+e,n["Moz"+t]="moz"+e,n}var Us={animationend:ql("Animation","AnimationEnd"),animationiteration:ql("Animation","AnimationIteration"),animationstart:ql("Animation","AnimationStart"),transitionend:ql("Transition","TransitionEnd")},Nd={},Rv={};Xi&&(Rv=document.createElement("div").style,"AnimationEvent"in window||(delete Us.animationend.animation,delete Us.animationiteration.animation,delete Us.animationstart.animation),"TransitionEvent"in window||delete Us.transitionend.transition);function kc(t){if(Nd[t])return Nd[t];if(!Us[t])return t;var e=Us[t],n;for(n in e)if(e.hasOwnProperty(n)&&n in Rv)return Nd[t]=e[n];return t}var Pv=kc("animationend"),Iv=kc("animationiteration"),Lv=kc("animationstart"),Nv=kc("transitionend"),Dv=new Map,o0="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function Cr(t,e){Dv.set(t,e),us(e,[t])}for(Yl=0;Yl<o0.length;Yl++)Zl=o0[Yl],a0=Zl.toLowerCase(),l0=Zl[0].toUpperCase()+Zl.slice(1),Cr(a0,"on"+l0);var Zl,a0,l0,Yl;Cr(Pv,"onAnimationEnd");Cr(Iv,"onAnimationIteration");Cr(Lv,"onAnimationStart");Cr("dblclick","onDoubleClick");Cr("focusin","onFocus");Cr("focusout","onBlur");Cr(Nv,"onTransitionEnd");$s("onMouseEnter",["mouseout","mouseover"]);$s("onMouseLeave",["mouseout","mouseover"]);$s("onPointerEnter",["pointerout","pointerover"]);$s("onPointerLeave",["pointerout","pointerover"]);us("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));us("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));us("onBeforeInput",["compositionend","keypress","textInput","paste"]);us("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));us("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));us("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var jo="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),FM=new Set("cancel close invalid load scroll toggle".split(" ").concat(jo));function c0(t,e,n){var i=t.type||"unknown-event";t.currentTarget=n,FS(i,e,void 0,t),t.currentTarget=null}function Uv(t,e){e=(e&4)!==0;for(var n=0;n<t.length;n++){var i=t[n],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,c=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;c0(r,a,c),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,c=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;c0(r,a,c),s=l}}}if(pc)throw t=lf,pc=!1,lf=null,t}function Mt(t,e){var n=e[xf];n===void 0&&(n=e[xf]=new Set);var i=t+"__bubble";n.has(i)||(Fv(e,t,2,!1),n.add(i))}function Dd(t,e,n){var i=0;e&&(i|=4),Fv(n,t,i,e)}var $l="_reactListening"+Math.random().toString(36).slice(2);function ga(t){if(!t[$l]){t[$l]=!0,H0.forEach(function(n){n!=="selectionchange"&&(FM.has(n)||Dd(n,!1,t),Dd(n,!0,t))});var e=t.nodeType===9?t:t.ownerDocument;e===null||e[$l]||(e[$l]=!0,Dd("selectionchange",!1,e))}}function Fv(t,e,n,i){switch(_v(e)){case 1:var r=jS;break;case 4:r=QS;break;default:r=$f}n=r.bind(null,e,n,t),r=void 0,!af||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?t.addEventListener(e,n,{capture:!0,passive:r}):t.addEventListener(e,n,!0):r!==void 0?t.addEventListener(e,n,{passive:r}):t.addEventListener(e,n,!1)}function Ud(t,e,n,i,r){var s=i;if(!(e&1)&&!(e&2)&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=es(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}sv(function(){var c=s,d=Xf(n),f=[];e:{var u=Dv.get(t);if(u!==void 0){var p=Kf,x=t;switch(t){case"keypress":if(rc(n)===0)break e;case"keydown":case"keyup":p=pM;break;case"focusin":x="focus",p=Id;break;case"focusout":x="blur",p=Id;break;case"beforeblur":case"afterblur":p=Id;break;case"click":if(n.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":p=Jg;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":p=nM;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":p=vM;break;case Pv:case Iv:case Lv:p=sM;break;case Nv:p=_M;break;case"scroll":p=eM;break;case"wheel":p=SM;break;case"copy":case"cut":case"paste":p=aM;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":p=jg}var S=(e&4)!==0,v=!S&&t==="scroll",h=S?u!==null?u+"Capture":null:u;S=[];for(var g=c,_;g!==null;){_=g;var M=_.stateNode;if(_.tag===5&&M!==null&&(_=M,h!==null&&(M=ua(g,h),M!=null&&S.push(va(g,M,_)))),v)break;g=g.return}0<S.length&&(u=new p(u,x,null,n,d),f.push({event:u,listeners:S}))}}if(!(e&7)){e:{if(u=t==="mouseover"||t==="pointerover",p=t==="mouseout"||t==="pointerout",u&&n!==sf&&(x=n.relatedTarget||n.fromElement)&&(es(x)||x[qi]))break e;if((p||u)&&(u=d.window===d?d:(u=d.ownerDocument)?u.defaultView||u.parentWindow:window,p?(x=n.relatedTarget||n.toElement,p=c,x=x?es(x):null,x!==null&&(v=hs(x),x!==v||x.tag!==5&&x.tag!==6)&&(x=null)):(p=null,x=c),p!==x)){if(S=Jg,M="onMouseLeave",h="onMouseEnter",g="mouse",(t==="pointerout"||t==="pointerover")&&(S=jg,M="onPointerLeave",h="onPointerEnter",g="pointer"),v=p==null?u:Fs(p),_=x==null?u:Fs(x),u=new S(M,g+"leave",p,n,d),u.target=v,u.relatedTarget=_,M=null,es(d)===c&&(S=new S(h,g+"enter",x,n,d),S.target=_,S.relatedTarget=v,M=S),v=M,p&&x)t:{for(S=p,h=x,g=0,_=S;_;_=Ps(_))g++;for(_=0,M=h;M;M=Ps(M))_++;for(;0<g-_;)S=Ps(S),g--;for(;0<_-g;)h=Ps(h),_--;for(;g--;){if(S===h||h!==null&&S===h.alternate)break t;S=Ps(S),h=Ps(h)}S=null}else S=null;p!==null&&u0(f,u,p,S,!1),x!==null&&v!==null&&u0(f,v,x,S,!0)}}e:{if(u=c?Fs(c):window,p=u.nodeName&&u.nodeName.toLowerCase(),p==="select"||p==="input"&&u.type==="file")var C=CM;else if(t0(u))if(bv)C=LM;else{C=PM;var b=RM}else(p=u.nodeName)&&p.toLowerCase()==="input"&&(u.type==="checkbox"||u.type==="radio")&&(C=IM);if(C&&(C=C(t,c))){wv(f,C,n,d);break e}b&&b(t,u,c),t==="focusout"&&(b=u._wrapperState)&&b.controlled&&u.type==="number"&&Qd(u,"number",u.value)}switch(b=c?Fs(c):window,t){case"focusin":(t0(b)||b.contentEditable==="true")&&(Ds=b,df=c,ia=null);break;case"focusout":ia=df=Ds=null;break;case"mousedown":ff=!0;break;case"contextmenu":case"mouseup":case"dragend":ff=!1,s0(f,n,d);break;case"selectionchange":if(UM)break;case"keydown":case"keyup":s0(f,n,d)}var R;if(Qf)e:{switch(t){case"compositionstart":var m="onCompositionStart";break e;case"compositionend":m="onCompositionEnd";break e;case"compositionupdate":m="onCompositionUpdate";break e}m=void 0}else Ns?Mv(t,n)&&(m="onCompositionEnd"):t==="keydown"&&n.keyCode===229&&(m="onCompositionStart");m&&(Sv&&n.locale!=="ko"&&(Ns||m!=="onCompositionStart"?m==="onCompositionEnd"&&Ns&&(R=yv()):(gr=d,Jf="value"in gr?gr.value:gr.textContent,Ns=!0)),b=_c(c,m),0<b.length&&(m=new Kg(m,t,null,n,d),f.push({event:m,listeners:b}),R?m.data=R:(R=Ev(n),R!==null&&(m.data=R)))),(R=EM?wM(t,n):bM(t,n))&&(c=_c(c,"onBeforeInput"),0<c.length&&(d=new Kg("onBeforeInput","beforeinput",null,n,d),f.push({event:d,listeners:c}),d.data=R))}Uv(f,e)})}function va(t,e,n){return{instance:t,listener:e,currentTarget:n}}function _c(t,e){for(var n=e+"Capture",i=[];t!==null;){var r=t,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=ua(t,n),s!=null&&i.unshift(va(t,s,r)),s=ua(t,e),s!=null&&i.push(va(t,s,r))),t=t.return}return i}function Ps(t){if(t===null)return null;do t=t.return;while(t&&t.tag!==5);return t||null}function u0(t,e,n,i,r){for(var s=e._reactName,o=[];n!==null&&n!==i;){var a=n,l=a.alternate,c=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&c!==null&&(a=c,r?(l=ua(n,s),l!=null&&o.unshift(va(n,l,a))):r||(l=ua(n,s),l!=null&&o.push(va(n,l,a)))),n=n.return}o.length!==0&&t.push({event:e,listeners:o})}var OM=/\r\n?/g,BM=/\u0000|\uFFFD/g;function h0(t){return(typeof t=="string"?t:""+t).replace(OM,`
`).replace(BM,"")}function Jl(t,e,n){if(e=h0(e),h0(t)!==e&&n)throw Error(re(425))}function yc(){}var pf=null,mf=null;function gf(t,e){return t==="textarea"||t==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var vf=typeof setTimeout=="function"?setTimeout:void 0,kM=typeof clearTimeout=="function"?clearTimeout:void 0,d0=typeof Promise=="function"?Promise:void 0,zM=typeof queueMicrotask=="function"?queueMicrotask:typeof d0<"u"?function(t){return d0.resolve(null).then(t).catch(VM)}:vf;function VM(t){setTimeout(function(){throw t})}function Fd(t,e){var n=e,i=0;do{var r=n.nextSibling;if(t.removeChild(n),r&&r.nodeType===8)if(n=r.data,n==="/$"){if(i===0){t.removeChild(r),fa(e);return}i--}else n!=="$"&&n!=="$?"&&n!=="$!"||i++;n=r}while(n);fa(e)}function Sr(t){for(;t!=null;t=t.nextSibling){var e=t.nodeType;if(e===1||e===3)break;if(e===8){if(e=t.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return t}function f0(t){t=t.previousSibling;for(var e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="$"||n==="$!"||n==="$?"){if(e===0)return t;e--}else n==="/$"&&e++}t=t.previousSibling}return null}var io=Math.random().toString(36).slice(2),Ei="__reactFiber$"+io,xa="__reactProps$"+io,qi="__reactContainer$"+io,xf="__reactEvents$"+io,GM="__reactListeners$"+io,HM="__reactHandles$"+io;function es(t){var e=t[Ei];if(e)return e;for(var n=t.parentNode;n;){if(e=n[qi]||n[Ei]){if(n=e.alternate,e.child!==null||n!==null&&n.child!==null)for(t=f0(t);t!==null;){if(n=t[Ei])return n;t=f0(t)}return e}t=n,n=t.parentNode}return null}function Aa(t){return t=t[Ei]||t[qi],!t||t.tag!==5&&t.tag!==6&&t.tag!==13&&t.tag!==3?null:t}function Fs(t){if(t.tag===5||t.tag===6)return t.stateNode;throw Error(re(33))}function zc(t){return t[xa]||null}var _f=[],Os=-1;function Rr(t){return{current:t}}function Et(t){0>Os||(t.current=_f[Os],_f[Os]=null,Os--)}function _t(t,e){Os++,_f[Os]=t.current,t.current=e}var Ar={},un=Rr(Ar),bn=Rr(!1),ss=Ar;function Js(t,e){var n=t.type.contextTypes;if(!n)return Ar;var i=t.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in n)r[s]=e[s];return i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=e,t.__reactInternalMemoizedMaskedChildContext=r),r}function Tn(t){return t=t.childContextTypes,t!=null}function Sc(){Et(bn),Et(un)}function p0(t,e,n){if(un.current!==Ar)throw Error(re(168));_t(un,e),_t(bn,n)}function Ov(t,e,n){var i=t.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return n;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(re(108,RS(t)||"Unknown",r));return Pt({},n,i)}function Mc(t){return t=(t=t.stateNode)&&t.__reactInternalMemoizedMergedChildContext||Ar,ss=un.current,_t(un,t),_t(bn,bn.current),!0}function m0(t,e,n){var i=t.stateNode;if(!i)throw Error(re(169));n?(t=Ov(t,e,ss),i.__reactInternalMemoizedMergedChildContext=t,Et(bn),Et(un),_t(un,t)):Et(bn),_t(bn,n)}var Vi=null,Vc=!1,Od=!1;function Bv(t){Vi===null?Vi=[t]:Vi.push(t)}function WM(t){Vc=!0,Bv(t)}function Pr(){if(!Od&&Vi!==null){Od=!0;var t=0,e=ht;try{var n=Vi;for(ht=1;t<n.length;t++){var i=n[t];do i=i(!0);while(i!==null)}Vi=null,Vc=!1}catch(r){throw Vi!==null&&(Vi=Vi.slice(t+1)),cv(qf,Pr),r}finally{ht=e,Od=!1}}return null}var Bs=[],ks=0,Ec=null,wc=0,qn=[],Yn=0,os=null,Gi=1,Hi="";function jr(t,e){Bs[ks++]=wc,Bs[ks++]=Ec,Ec=t,wc=e}function kv(t,e,n){qn[Yn++]=Gi,qn[Yn++]=Hi,qn[Yn++]=os,os=t;var i=Gi;t=Hi;var r=32-ci(i)-1;i&=~(1<<r),n+=1;var s=32-ci(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,Gi=1<<32-ci(e)+r|n<<r|i,Hi=s+t}else Gi=1<<s|n<<r|i,Hi=t}function tp(t){t.return!==null&&(jr(t,1),kv(t,1,0))}function np(t){for(;t===Ec;)Ec=Bs[--ks],Bs[ks]=null,wc=Bs[--ks],Bs[ks]=null;for(;t===os;)os=qn[--Yn],qn[Yn]=null,Hi=qn[--Yn],qn[Yn]=null,Gi=qn[--Yn],qn[Yn]=null}var Dn=null,Nn=null,bt=!1,li=null;function zv(t,e){var n=Zn(5,null,null,0);n.elementType="DELETED",n.stateNode=e,n.return=t,e=t.deletions,e===null?(t.deletions=[n],t.flags|=16):e.push(n)}function g0(t,e){switch(t.tag){case 5:var n=t.type;return e=e.nodeType!==1||n.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(t.stateNode=e,Dn=t,Nn=Sr(e.firstChild),!0):!1;case 6:return e=t.pendingProps===""||e.nodeType!==3?null:e,e!==null?(t.stateNode=e,Dn=t,Nn=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(n=os!==null?{id:Gi,overflow:Hi}:null,t.memoizedState={dehydrated:e,treeContext:n,retryLane:1073741824},n=Zn(18,null,null,0),n.stateNode=e,n.return=t,t.child=n,Dn=t,Nn=null,!0):!1;default:return!1}}function yf(t){return(t.mode&1)!==0&&(t.flags&128)===0}function Sf(t){if(bt){var e=Nn;if(e){var n=e;if(!g0(t,e)){if(yf(t))throw Error(re(418));e=Sr(n.nextSibling);var i=Dn;e&&g0(t,e)?zv(i,n):(t.flags=t.flags&-4097|2,bt=!1,Dn=t)}}else{if(yf(t))throw Error(re(418));t.flags=t.flags&-4097|2,bt=!1,Dn=t}}}function v0(t){for(t=t.return;t!==null&&t.tag!==5&&t.tag!==3&&t.tag!==13;)t=t.return;Dn=t}function Kl(t){if(t!==Dn)return!1;if(!bt)return v0(t),bt=!0,!1;var e;if((e=t.tag!==3)&&!(e=t.tag!==5)&&(e=t.type,e=e!=="head"&&e!=="body"&&!gf(t.type,t.memoizedProps)),e&&(e=Nn)){if(yf(t))throw Vv(),Error(re(418));for(;e;)zv(t,e),e=Sr(e.nextSibling)}if(v0(t),t.tag===13){if(t=t.memoizedState,t=t!==null?t.dehydrated:null,!t)throw Error(re(317));e:{for(t=t.nextSibling,e=0;t;){if(t.nodeType===8){var n=t.data;if(n==="/$"){if(e===0){Nn=Sr(t.nextSibling);break e}e--}else n!=="$"&&n!=="$!"&&n!=="$?"||e++}t=t.nextSibling}Nn=null}}else Nn=Dn?Sr(t.stateNode.nextSibling):null;return!0}function Vv(){for(var t=Nn;t;)t=Sr(t.nextSibling)}function Ks(){Nn=Dn=null,bt=!1}function ip(t){li===null?li=[t]:li.push(t)}var XM=$i.ReactCurrentBatchConfig;function Xo(t,e,n){if(t=n.ref,t!==null&&typeof t!="function"&&typeof t!="object"){if(n._owner){if(n=n._owner,n){if(n.tag!==1)throw Error(re(309));var i=n.stateNode}if(!i)throw Error(re(147,t));var r=i,s=""+t;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof t!="string")throw Error(re(284));if(!n._owner)throw Error(re(290,t))}return t}function jl(t,e){throw t=Object.prototype.toString.call(e),Error(re(31,t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t))}function x0(t){var e=t._init;return e(t._payload)}function Gv(t){function e(h,g){if(t){var _=h.deletions;_===null?(h.deletions=[g],h.flags|=16):_.push(g)}}function n(h,g){if(!t)return null;for(;g!==null;)e(h,g),g=g.sibling;return null}function i(h,g){for(h=new Map;g!==null;)g.key!==null?h.set(g.key,g):h.set(g.index,g),g=g.sibling;return h}function r(h,g){return h=br(h,g),h.index=0,h.sibling=null,h}function s(h,g,_){return h.index=_,t?(_=h.alternate,_!==null?(_=_.index,_<g?(h.flags|=2,g):_):(h.flags|=2,g)):(h.flags|=1048576,g)}function o(h){return t&&h.alternate===null&&(h.flags|=2),h}function a(h,g,_,M){return g===null||g.tag!==6?(g=Wd(_,h.mode,M),g.return=h,g):(g=r(g,_),g.return=h,g)}function l(h,g,_,M){var C=_.type;return C===Ls?d(h,g,_.props.children,M,_.key):g!==null&&(g.elementType===C||typeof C=="object"&&C!==null&&C.$$typeof===dr&&x0(C)===g.type)?(M=r(g,_.props),M.ref=Xo(h,g,_),M.return=h,M):(M=hc(_.type,_.key,_.props,null,h.mode,M),M.ref=Xo(h,g,_),M.return=h,M)}function c(h,g,_,M){return g===null||g.tag!==4||g.stateNode.containerInfo!==_.containerInfo||g.stateNode.implementation!==_.implementation?(g=Xd(_,h.mode,M),g.return=h,g):(g=r(g,_.children||[]),g.return=h,g)}function d(h,g,_,M,C){return g===null||g.tag!==7?(g=rs(_,h.mode,M,C),g.return=h,g):(g=r(g,_),g.return=h,g)}function f(h,g,_){if(typeof g=="string"&&g!==""||typeof g=="number")return g=Wd(""+g,h.mode,_),g.return=h,g;if(typeof g=="object"&&g!==null){switch(g.$$typeof){case Ol:return _=hc(g.type,g.key,g.props,null,h.mode,_),_.ref=Xo(h,null,g),_.return=h,_;case Is:return g=Xd(g,h.mode,_),g.return=h,g;case dr:var M=g._init;return f(h,M(g._payload),_)}if(Jo(g)||Vo(g))return g=rs(g,h.mode,_,null),g.return=h,g;jl(h,g)}return null}function u(h,g,_,M){var C=g!==null?g.key:null;if(typeof _=="string"&&_!==""||typeof _=="number")return C!==null?null:a(h,g,""+_,M);if(typeof _=="object"&&_!==null){switch(_.$$typeof){case Ol:return _.key===C?l(h,g,_,M):null;case Is:return _.key===C?c(h,g,_,M):null;case dr:return C=_._init,u(h,g,C(_._payload),M)}if(Jo(_)||Vo(_))return C!==null?null:d(h,g,_,M,null);jl(h,_)}return null}function p(h,g,_,M,C){if(typeof M=="string"&&M!==""||typeof M=="number")return h=h.get(_)||null,a(g,h,""+M,C);if(typeof M=="object"&&M!==null){switch(M.$$typeof){case Ol:return h=h.get(M.key===null?_:M.key)||null,l(g,h,M,C);case Is:return h=h.get(M.key===null?_:M.key)||null,c(g,h,M,C);case dr:var b=M._init;return p(h,g,_,b(M._payload),C)}if(Jo(M)||Vo(M))return h=h.get(_)||null,d(g,h,M,C,null);jl(g,M)}return null}function x(h,g,_,M){for(var C=null,b=null,R=g,m=g=0,T=null;R!==null&&m<_.length;m++){R.index>m?(T=R,R=null):T=R.sibling;var I=u(h,R,_[m],M);if(I===null){R===null&&(R=T);break}t&&R&&I.alternate===null&&e(h,R),g=s(I,g,m),b===null?C=I:b.sibling=I,b=I,R=T}if(m===_.length)return n(h,R),bt&&jr(h,m),C;if(R===null){for(;m<_.length;m++)R=f(h,_[m],M),R!==null&&(g=s(R,g,m),b===null?C=R:b.sibling=R,b=R);return bt&&jr(h,m),C}for(R=i(h,R);m<_.length;m++)T=p(R,h,m,_[m],M),T!==null&&(t&&T.alternate!==null&&R.delete(T.key===null?m:T.key),g=s(T,g,m),b===null?C=T:b.sibling=T,b=T);return t&&R.forEach(function(A){return e(h,A)}),bt&&jr(h,m),C}function S(h,g,_,M){var C=Vo(_);if(typeof C!="function")throw Error(re(150));if(_=C.call(_),_==null)throw Error(re(151));for(var b=C=null,R=g,m=g=0,T=null,I=_.next();R!==null&&!I.done;m++,I=_.next()){R.index>m?(T=R,R=null):T=R.sibling;var A=u(h,R,I.value,M);if(A===null){R===null&&(R=T);break}t&&R&&A.alternate===null&&e(h,R),g=s(A,g,m),b===null?C=A:b.sibling=A,b=A,R=T}if(I.done)return n(h,R),bt&&jr(h,m),C;if(R===null){for(;!I.done;m++,I=_.next())I=f(h,I.value,M),I!==null&&(g=s(I,g,m),b===null?C=I:b.sibling=I,b=I);return bt&&jr(h,m),C}for(R=i(h,R);!I.done;m++,I=_.next())I=p(R,h,m,I.value,M),I!==null&&(t&&I.alternate!==null&&R.delete(I.key===null?m:I.key),g=s(I,g,m),b===null?C=I:b.sibling=I,b=I);return t&&R.forEach(function(P){return e(h,P)}),bt&&jr(h,m),C}function v(h,g,_,M){if(typeof _=="object"&&_!==null&&_.type===Ls&&_.key===null&&(_=_.props.children),typeof _=="object"&&_!==null){switch(_.$$typeof){case Ol:e:{for(var C=_.key,b=g;b!==null;){if(b.key===C){if(C=_.type,C===Ls){if(b.tag===7){n(h,b.sibling),g=r(b,_.props.children),g.return=h,h=g;break e}}else if(b.elementType===C||typeof C=="object"&&C!==null&&C.$$typeof===dr&&x0(C)===b.type){n(h,b.sibling),g=r(b,_.props),g.ref=Xo(h,b,_),g.return=h,h=g;break e}n(h,b);break}else e(h,b);b=b.sibling}_.type===Ls?(g=rs(_.props.children,h.mode,M,_.key),g.return=h,h=g):(M=hc(_.type,_.key,_.props,null,h.mode,M),M.ref=Xo(h,g,_),M.return=h,h=M)}return o(h);case Is:e:{for(b=_.key;g!==null;){if(g.key===b)if(g.tag===4&&g.stateNode.containerInfo===_.containerInfo&&g.stateNode.implementation===_.implementation){n(h,g.sibling),g=r(g,_.children||[]),g.return=h,h=g;break e}else{n(h,g);break}else e(h,g);g=g.sibling}g=Xd(_,h.mode,M),g.return=h,h=g}return o(h);case dr:return b=_._init,v(h,g,b(_._payload),M)}if(Jo(_))return x(h,g,_,M);if(Vo(_))return S(h,g,_,M);jl(h,_)}return typeof _=="string"&&_!==""||typeof _=="number"?(_=""+_,g!==null&&g.tag===6?(n(h,g.sibling),g=r(g,_),g.return=h,h=g):(n(h,g),g=Wd(_,h.mode,M),g.return=h,h=g),o(h)):n(h,g)}return v}var js=Gv(!0),Hv=Gv(!1),bc=Rr(null),Tc=null,zs=null,rp=null;function sp(){rp=zs=Tc=null}function op(t){var e=bc.current;Et(bc),t._currentValue=e}function Mf(t,e,n){for(;t!==null;){var i=t.alternate;if((t.childLanes&e)!==e?(t.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),t===n)break;t=t.return}}function Ys(t,e){Tc=t,rp=zs=null,t=t.dependencies,t!==null&&t.firstContext!==null&&(t.lanes&e&&(wn=!0),t.firstContext=null)}function Jn(t){var e=t._currentValue;if(rp!==t)if(t={context:t,memoizedValue:e,next:null},zs===null){if(Tc===null)throw Error(re(308));zs=t,Tc.dependencies={lanes:0,firstContext:t}}else zs=zs.next=t;return e}var ts=null;function ap(t){ts===null?ts=[t]:ts.push(t)}function Wv(t,e,n,i){var r=e.interleaved;return r===null?(n.next=n,ap(e)):(n.next=r.next,r.next=n),e.interleaved=n,Yi(t,i)}function Yi(t,e){t.lanes|=e;var n=t.alternate;for(n!==null&&(n.lanes|=e),n=t,t=t.return;t!==null;)t.childLanes|=e,n=t.alternate,n!==null&&(n.childLanes|=e),n=t,t=t.return;return n.tag===3?n.stateNode:null}var fr=!1;function lp(t){t.updateQueue={baseState:t.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function Xv(t,e){t=t.updateQueue,e.updateQueue===t&&(e.updateQueue={baseState:t.baseState,firstBaseUpdate:t.firstBaseUpdate,lastBaseUpdate:t.lastBaseUpdate,shared:t.shared,effects:t.effects})}function Wi(t,e){return{eventTime:t,lane:e,tag:0,payload:null,callback:null,next:null}}function Mr(t,e,n){var i=t.updateQueue;if(i===null)return null;if(i=i.shared,nt&2){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,Yi(t,n)}return r=i.interleaved,r===null?(e.next=e,ap(i)):(e.next=r.next,r.next=e),i.interleaved=e,Yi(t,n)}function sc(t,e,n){if(e=e.updateQueue,e!==null&&(e=e.shared,(n&4194240)!==0)){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,Yf(t,n)}}function _0(t,e){var n=t.updateQueue,i=t.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var r=null,s=null;if(n=n.firstBaseUpdate,n!==null){do{var o={eventTime:n.eventTime,lane:n.lane,tag:n.tag,payload:n.payload,callback:n.callback,next:null};s===null?r=s=o:s=s.next=o,n=n.next}while(n!==null);s===null?r=s=e:s=s.next=e}else r=s=e;n={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},t.updateQueue=n;return}t=n.lastBaseUpdate,t===null?n.firstBaseUpdate=e:t.next=e,n.lastBaseUpdate=e}function Ac(t,e,n,i){var r=t.updateQueue;fr=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,c=l.next;l.next=null,o===null?s=c:o.next=c,o=l;var d=t.alternate;d!==null&&(d=d.updateQueue,a=d.lastBaseUpdate,a!==o&&(a===null?d.firstBaseUpdate=c:a.next=c,d.lastBaseUpdate=l))}if(s!==null){var f=r.baseState;o=0,d=c=l=null,a=s;do{var u=a.lane,p=a.eventTime;if((i&u)===u){d!==null&&(d=d.next={eventTime:p,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var x=t,S=a;switch(u=e,p=n,S.tag){case 1:if(x=S.payload,typeof x=="function"){f=x.call(p,f,u);break e}f=x;break e;case 3:x.flags=x.flags&-65537|128;case 0:if(x=S.payload,u=typeof x=="function"?x.call(p,f,u):x,u==null)break e;f=Pt({},f,u);break e;case 2:fr=!0}}a.callback!==null&&a.lane!==0&&(t.flags|=64,u=r.effects,u===null?r.effects=[a]:u.push(a))}else p={eventTime:p,lane:u,tag:a.tag,payload:a.payload,callback:a.callback,next:null},d===null?(c=d=p,l=f):d=d.next=p,o|=u;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;u=a,a=u.next,u.next=null,r.lastBaseUpdate=u,r.shared.pending=null}}while(!0);if(d===null&&(l=f),r.baseState=l,r.firstBaseUpdate=c,r.lastBaseUpdate=d,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);ls|=o,t.lanes=o,t.memoizedState=f}}function y0(t,e,n){if(t=e.effects,e.effects=null,t!==null)for(e=0;e<t.length;e++){var i=t[e],r=i.callback;if(r!==null){if(i.callback=null,i=n,typeof r!="function")throw Error(re(191,r));r.call(i)}}}var Ca={},bi=Rr(Ca),_a=Rr(Ca),ya=Rr(Ca);function ns(t){if(t===Ca)throw Error(re(174));return t}function cp(t,e){switch(_t(ya,e),_t(_a,t),_t(bi,Ca),t=e.nodeType,t){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:tf(null,"");break;default:t=t===8?e.parentNode:e,e=t.namespaceURI||null,t=t.tagName,e=tf(e,t)}Et(bi),_t(bi,e)}function Qs(){Et(bi),Et(_a),Et(ya)}function qv(t){ns(ya.current);var e=ns(bi.current),n=tf(e,t.type);e!==n&&(_t(_a,t),_t(bi,n))}function up(t){_a.current===t&&(Et(bi),Et(_a))}var Ct=Rr(0);function Cc(t){for(var e=t;e!==null;){if(e.tag===13){var n=e.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||n.data==="$?"||n.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if(e.flags&128)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var Bd=[];function hp(){for(var t=0;t<Bd.length;t++)Bd[t]._workInProgressVersionPrimary=null;Bd.length=0}var oc=$i.ReactCurrentDispatcher,kd=$i.ReactCurrentBatchConfig,as=0,Rt=null,Gt=null,Yt=null,Rc=!1,ra=!1,Sa=0,qM=0;function an(){throw Error(re(321))}function dp(t,e){if(e===null)return!1;for(var n=0;n<e.length&&n<t.length;n++)if(!hi(t[n],e[n]))return!1;return!0}function fp(t,e,n,i,r,s){if(as=s,Rt=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,oc.current=t===null||t.memoizedState===null?JM:KM,t=n(i,r),ra){s=0;do{if(ra=!1,Sa=0,25<=s)throw Error(re(301));s+=1,Yt=Gt=null,e.updateQueue=null,oc.current=jM,t=n(i,r)}while(ra)}if(oc.current=Pc,e=Gt!==null&&Gt.next!==null,as=0,Yt=Gt=Rt=null,Rc=!1,e)throw Error(re(300));return t}function pp(){var t=Sa!==0;return Sa=0,t}function Mi(){var t={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return Yt===null?Rt.memoizedState=Yt=t:Yt=Yt.next=t,Yt}function Kn(){if(Gt===null){var t=Rt.alternate;t=t!==null?t.memoizedState:null}else t=Gt.next;var e=Yt===null?Rt.memoizedState:Yt.next;if(e!==null)Yt=e,Gt=t;else{if(t===null)throw Error(re(310));Gt=t,t={memoizedState:Gt.memoizedState,baseState:Gt.baseState,baseQueue:Gt.baseQueue,queue:Gt.queue,next:null},Yt===null?Rt.memoizedState=Yt=t:Yt=Yt.next=t}return Yt}function Ma(t,e){return typeof e=="function"?e(t):e}function zd(t){var e=Kn(),n=e.queue;if(n===null)throw Error(re(311));n.lastRenderedReducer=t;var i=Gt,r=i.baseQueue,s=n.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,n.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,c=s;do{var d=c.lane;if((as&d)===d)l!==null&&(l=l.next={lane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),i=c.hasEagerState?c.eagerState:t(i,c.action);else{var f={lane:d,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null};l===null?(a=l=f,o=i):l=l.next=f,Rt.lanes|=d,ls|=d}c=c.next}while(c!==null&&c!==s);l===null?o=i:l.next=a,hi(i,e.memoizedState)||(wn=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,n.lastRenderedState=i}if(t=n.interleaved,t!==null){r=t;do s=r.lane,Rt.lanes|=s,ls|=s,r=r.next;while(r!==t)}else r===null&&(n.lanes=0);return[e.memoizedState,n.dispatch]}function Vd(t){var e=Kn(),n=e.queue;if(n===null)throw Error(re(311));n.lastRenderedReducer=t;var i=n.dispatch,r=n.pending,s=e.memoizedState;if(r!==null){n.pending=null;var o=r=r.next;do s=t(s,o.action),o=o.next;while(o!==r);hi(s,e.memoizedState)||(wn=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),n.lastRenderedState=s}return[s,i]}function Yv(){}function Zv(t,e){var n=Rt,i=Kn(),r=e(),s=!hi(i.memoizedState,r);if(s&&(i.memoizedState=r,wn=!0),i=i.queue,mp(Kv.bind(null,n,i,t),[t]),i.getSnapshot!==e||s||Yt!==null&&Yt.memoizedState.tag&1){if(n.flags|=2048,Ea(9,Jv.bind(null,n,i,r,e),void 0,null),Zt===null)throw Error(re(349));as&30||$v(n,e,r)}return r}function $v(t,e,n){t.flags|=16384,t={getSnapshot:e,value:n},e=Rt.updateQueue,e===null?(e={lastEffect:null,stores:null},Rt.updateQueue=e,e.stores=[t]):(n=e.stores,n===null?e.stores=[t]:n.push(t))}function Jv(t,e,n,i){e.value=n,e.getSnapshot=i,jv(e)&&Qv(t)}function Kv(t,e,n){return n(function(){jv(e)&&Qv(t)})}function jv(t){var e=t.getSnapshot;t=t.value;try{var n=e();return!hi(t,n)}catch{return!0}}function Qv(t){var e=Yi(t,1);e!==null&&ui(e,t,1,-1)}function S0(t){var e=Mi();return typeof t=="function"&&(t=t()),e.memoizedState=e.baseState=t,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:Ma,lastRenderedState:t},e.queue=t,t=t.dispatch=$M.bind(null,Rt,t),[e.memoizedState,t]}function Ea(t,e,n,i){return t={tag:t,create:e,destroy:n,deps:i,next:null},e=Rt.updateQueue,e===null?(e={lastEffect:null,stores:null},Rt.updateQueue=e,e.lastEffect=t.next=t):(n=e.lastEffect,n===null?e.lastEffect=t.next=t:(i=n.next,n.next=t,t.next=i,e.lastEffect=t)),t}function ex(){return Kn().memoizedState}function ac(t,e,n,i){var r=Mi();Rt.flags|=t,r.memoizedState=Ea(1|e,n,void 0,i===void 0?null:i)}function Gc(t,e,n,i){var r=Kn();i=i===void 0?null:i;var s=void 0;if(Gt!==null){var o=Gt.memoizedState;if(s=o.destroy,i!==null&&dp(i,o.deps)){r.memoizedState=Ea(e,n,s,i);return}}Rt.flags|=t,r.memoizedState=Ea(1|e,n,s,i)}function M0(t,e){return ac(8390656,8,t,e)}function mp(t,e){return Gc(2048,8,t,e)}function tx(t,e){return Gc(4,2,t,e)}function nx(t,e){return Gc(4,4,t,e)}function ix(t,e){if(typeof e=="function")return t=t(),e(t),function(){e(null)};if(e!=null)return t=t(),e.current=t,function(){e.current=null}}function rx(t,e,n){return n=n!=null?n.concat([t]):null,Gc(4,4,ix.bind(null,e,t),n)}function gp(){}function sx(t,e){var n=Kn();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&dp(e,i[1])?i[0]:(n.memoizedState=[t,e],t)}function ox(t,e){var n=Kn();e=e===void 0?null:e;var i=n.memoizedState;return i!==null&&e!==null&&dp(e,i[1])?i[0]:(t=t(),n.memoizedState=[t,e],t)}function ax(t,e,n){return as&21?(hi(n,e)||(n=dv(),Rt.lanes|=n,ls|=n,t.baseState=!0),e):(t.baseState&&(t.baseState=!1,wn=!0),t.memoizedState=n)}function YM(t,e){var n=ht;ht=n!==0&&4>n?n:4,t(!0);var i=kd.transition;kd.transition={};try{t(!1),e()}finally{ht=n,kd.transition=i}}function lx(){return Kn().memoizedState}function ZM(t,e,n){var i=wr(t);if(n={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null},cx(t))ux(e,n);else if(n=Wv(t,e,n,i),n!==null){var r=vn();ui(n,t,i,r),hx(n,e,i)}}function $M(t,e,n){var i=wr(t),r={lane:i,action:n,hasEagerState:!1,eagerState:null,next:null};if(cx(t))ux(e,r);else{var s=t.alternate;if(t.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,n);if(r.hasEagerState=!0,r.eagerState=a,hi(a,o)){var l=e.interleaved;l===null?(r.next=r,ap(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}n=Wv(t,e,r,i),n!==null&&(r=vn(),ui(n,t,i,r),hx(n,e,i))}}function cx(t){var e=t.alternate;return t===Rt||e!==null&&e===Rt}function ux(t,e){ra=Rc=!0;var n=t.pending;n===null?e.next=e:(e.next=n.next,n.next=e),t.pending=e}function hx(t,e,n){if(n&4194240){var i=e.lanes;i&=t.pendingLanes,n|=i,e.lanes=n,Yf(t,n)}}var Pc={readContext:Jn,useCallback:an,useContext:an,useEffect:an,useImperativeHandle:an,useInsertionEffect:an,useLayoutEffect:an,useMemo:an,useReducer:an,useRef:an,useState:an,useDebugValue:an,useDeferredValue:an,useTransition:an,useMutableSource:an,useSyncExternalStore:an,useId:an,unstable_isNewReconciler:!1},JM={readContext:Jn,useCallback:function(t,e){return Mi().memoizedState=[t,e===void 0?null:e],t},useContext:Jn,useEffect:M0,useImperativeHandle:function(t,e,n){return n=n!=null?n.concat([t]):null,ac(4194308,4,ix.bind(null,e,t),n)},useLayoutEffect:function(t,e){return ac(4194308,4,t,e)},useInsertionEffect:function(t,e){return ac(4,2,t,e)},useMemo:function(t,e){var n=Mi();return e=e===void 0?null:e,t=t(),n.memoizedState=[t,e],t},useReducer:function(t,e,n){var i=Mi();return e=n!==void 0?n(e):e,i.memoizedState=i.baseState=e,t={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:t,lastRenderedState:e},i.queue=t,t=t.dispatch=ZM.bind(null,Rt,t),[i.memoizedState,t]},useRef:function(t){var e=Mi();return t={current:t},e.memoizedState=t},useState:S0,useDebugValue:gp,useDeferredValue:function(t){return Mi().memoizedState=t},useTransition:function(){var t=S0(!1),e=t[0];return t=YM.bind(null,t[1]),Mi().memoizedState=t,[e,t]},useMutableSource:function(){},useSyncExternalStore:function(t,e,n){var i=Rt,r=Mi();if(bt){if(n===void 0)throw Error(re(407));n=n()}else{if(n=e(),Zt===null)throw Error(re(349));as&30||$v(i,e,n)}r.memoizedState=n;var s={value:n,getSnapshot:e};return r.queue=s,M0(Kv.bind(null,i,s,t),[t]),i.flags|=2048,Ea(9,Jv.bind(null,i,s,n,e),void 0,null),n},useId:function(){var t=Mi(),e=Zt.identifierPrefix;if(bt){var n=Hi,i=Gi;n=(i&~(1<<32-ci(i)-1)).toString(32)+n,e=":"+e+"R"+n,n=Sa++,0<n&&(e+="H"+n.toString(32)),e+=":"}else n=qM++,e=":"+e+"r"+n.toString(32)+":";return t.memoizedState=e},unstable_isNewReconciler:!1},KM={readContext:Jn,useCallback:sx,useContext:Jn,useEffect:mp,useImperativeHandle:rx,useInsertionEffect:tx,useLayoutEffect:nx,useMemo:ox,useReducer:zd,useRef:ex,useState:function(){return zd(Ma)},useDebugValue:gp,useDeferredValue:function(t){var e=Kn();return ax(e,Gt.memoizedState,t)},useTransition:function(){var t=zd(Ma)[0],e=Kn().memoizedState;return[t,e]},useMutableSource:Yv,useSyncExternalStore:Zv,useId:lx,unstable_isNewReconciler:!1},jM={readContext:Jn,useCallback:sx,useContext:Jn,useEffect:mp,useImperativeHandle:rx,useInsertionEffect:tx,useLayoutEffect:nx,useMemo:ox,useReducer:Vd,useRef:ex,useState:function(){return Vd(Ma)},useDebugValue:gp,useDeferredValue:function(t){var e=Kn();return Gt===null?e.memoizedState=t:ax(e,Gt.memoizedState,t)},useTransition:function(){var t=Vd(Ma)[0],e=Kn().memoizedState;return[t,e]},useMutableSource:Yv,useSyncExternalStore:Zv,useId:lx,unstable_isNewReconciler:!1};function oi(t,e){if(t&&t.defaultProps){e=Pt({},e),t=t.defaultProps;for(var n in t)e[n]===void 0&&(e[n]=t[n]);return e}return e}function Ef(t,e,n,i){e=t.memoizedState,n=n(i,e),n=n==null?e:Pt({},e,n),t.memoizedState=n,t.lanes===0&&(t.updateQueue.baseState=n)}var Hc={isMounted:function(t){return(t=t._reactInternals)?hs(t)===t:!1},enqueueSetState:function(t,e,n){t=t._reactInternals;var i=vn(),r=wr(t),s=Wi(i,r);s.payload=e,n!=null&&(s.callback=n),e=Mr(t,s,r),e!==null&&(ui(e,t,r,i),sc(e,t,r))},enqueueReplaceState:function(t,e,n){t=t._reactInternals;var i=vn(),r=wr(t),s=Wi(i,r);s.tag=1,s.payload=e,n!=null&&(s.callback=n),e=Mr(t,s,r),e!==null&&(ui(e,t,r,i),sc(e,t,r))},enqueueForceUpdate:function(t,e){t=t._reactInternals;var n=vn(),i=wr(t),r=Wi(n,i);r.tag=2,e!=null&&(r.callback=e),e=Mr(t,r,i),e!==null&&(ui(e,t,i,n),sc(e,t,i))}};function E0(t,e,n,i,r,s,o){return t=t.stateNode,typeof t.shouldComponentUpdate=="function"?t.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!ma(n,i)||!ma(r,s):!0}function dx(t,e,n){var i=!1,r=Ar,s=e.contextType;return typeof s=="object"&&s!==null?s=Jn(s):(r=Tn(e)?ss:un.current,i=e.contextTypes,s=(i=i!=null)?Js(t,r):Ar),e=new e(n,s),t.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=Hc,t.stateNode=e,e._reactInternals=t,i&&(t=t.stateNode,t.__reactInternalMemoizedUnmaskedChildContext=r,t.__reactInternalMemoizedMaskedChildContext=s),e}function w0(t,e,n,i){t=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(n,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(n,i),e.state!==t&&Hc.enqueueReplaceState(e,e.state,null)}function wf(t,e,n,i){var r=t.stateNode;r.props=n,r.state=t.memoizedState,r.refs={},lp(t);var s=e.contextType;typeof s=="object"&&s!==null?r.context=Jn(s):(s=Tn(e)?ss:un.current,r.context=Js(t,s)),r.state=t.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(Ef(t,e,s,n),r.state=t.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&Hc.enqueueReplaceState(r,r.state,null),Ac(t,n,r,i),r.state=t.memoizedState),typeof r.componentDidMount=="function"&&(t.flags|=4194308)}function eo(t,e){try{var n="",i=e;do n+=CS(i),i=i.return;while(i);var r=n}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:t,source:e,stack:r,digest:null}}function Gd(t,e,n){return{value:t,source:null,stack:n??null,digest:e??null}}function bf(t,e){try{console.error(e.value)}catch(n){setTimeout(function(){throw n})}}var QM=typeof WeakMap=="function"?WeakMap:Map;function fx(t,e,n){n=Wi(-1,n),n.tag=3,n.payload={element:null};var i=e.value;return n.callback=function(){Lc||(Lc=!0,Uf=i),bf(t,e)},n}function px(t,e,n){n=Wi(-1,n),n.tag=3;var i=t.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;n.payload=function(){return i(r)},n.callback=function(){bf(t,e)}}var s=t.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(n.callback=function(){bf(t,e),typeof i!="function"&&(Er===null?Er=new Set([this]):Er.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),n}function b0(t,e,n){var i=t.pingCache;if(i===null){i=t.pingCache=new QM;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(n)||(r.add(n),t=f1.bind(null,t,e,n),e.then(t,t))}function T0(t){do{var e;if((e=t.tag===13)&&(e=t.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return t;t=t.return}while(t!==null);return null}function A0(t,e,n,i,r){return t.mode&1?(t.flags|=65536,t.lanes=r,t):(t===e?t.flags|=65536:(t.flags|=128,n.flags|=131072,n.flags&=-52805,n.tag===1&&(n.alternate===null?n.tag=17:(e=Wi(-1,1),e.tag=2,Mr(n,e,1))),n.lanes|=1),t)}var e1=$i.ReactCurrentOwner,wn=!1;function gn(t,e,n,i){e.child=t===null?Hv(e,null,n,i):js(e,t.child,n,i)}function C0(t,e,n,i,r){n=n.render;var s=e.ref;return Ys(e,r),i=fp(t,e,n,i,s,r),n=pp(),t!==null&&!wn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,Zi(t,e,r)):(bt&&n&&tp(e),e.flags|=1,gn(t,e,i,r),e.child)}function R0(t,e,n,i,r){if(t===null){var s=n.type;return typeof s=="function"&&!wp(s)&&s.defaultProps===void 0&&n.compare===null&&n.defaultProps===void 0?(e.tag=15,e.type=s,mx(t,e,s,i,r)):(t=hc(n.type,null,i,e,e.mode,r),t.ref=e.ref,t.return=e,e.child=t)}if(s=t.child,!(t.lanes&r)){var o=s.memoizedProps;if(n=n.compare,n=n!==null?n:ma,n(o,i)&&t.ref===e.ref)return Zi(t,e,r)}return e.flags|=1,t=br(s,i),t.ref=e.ref,t.return=e,e.child=t}function mx(t,e,n,i,r){if(t!==null){var s=t.memoizedProps;if(ma(s,i)&&t.ref===e.ref)if(wn=!1,e.pendingProps=i=s,(t.lanes&r)!==0)t.flags&131072&&(wn=!0);else return e.lanes=t.lanes,Zi(t,e,r)}return Tf(t,e,n,i,r)}function gx(t,e,n){var i=e.pendingProps,r=i.children,s=t!==null?t.memoizedState:null;if(i.mode==="hidden")if(!(e.mode&1))e.memoizedState={baseLanes:0,cachePool:null,transitions:null},_t(Gs,Ln),Ln|=n;else{if(!(n&1073741824))return t=s!==null?s.baseLanes|n:n,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:t,cachePool:null,transitions:null},e.updateQueue=null,_t(Gs,Ln),Ln|=t,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:n,_t(Gs,Ln),Ln|=i}else s!==null?(i=s.baseLanes|n,e.memoizedState=null):i=n,_t(Gs,Ln),Ln|=i;return gn(t,e,r,n),e.child}function vx(t,e){var n=e.ref;(t===null&&n!==null||t!==null&&t.ref!==n)&&(e.flags|=512,e.flags|=2097152)}function Tf(t,e,n,i,r){var s=Tn(n)?ss:un.current;return s=Js(e,s),Ys(e,r),n=fp(t,e,n,i,s,r),i=pp(),t!==null&&!wn?(e.updateQueue=t.updateQueue,e.flags&=-2053,t.lanes&=~r,Zi(t,e,r)):(bt&&i&&tp(e),e.flags|=1,gn(t,e,n,r),e.child)}function P0(t,e,n,i,r){if(Tn(n)){var s=!0;Mc(e)}else s=!1;if(Ys(e,r),e.stateNode===null)lc(t,e),dx(e,n,i),wf(e,n,i,r),i=!0;else if(t===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,c=n.contextType;typeof c=="object"&&c!==null?c=Jn(c):(c=Tn(n)?ss:un.current,c=Js(e,c));var d=n.getDerivedStateFromProps,f=typeof d=="function"||typeof o.getSnapshotBeforeUpdate=="function";f||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==c)&&w0(e,o,i,c),fr=!1;var u=e.memoizedState;o.state=u,Ac(e,i,o,r),l=e.memoizedState,a!==i||u!==l||bn.current||fr?(typeof d=="function"&&(Ef(e,n,d,i),l=e.memoizedState),(a=fr||E0(e,n,a,i,u,l,c))?(f||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=c,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,Xv(t,e),a=e.memoizedProps,c=e.type===e.elementType?a:oi(e.type,a),o.props=c,f=e.pendingProps,u=o.context,l=n.contextType,typeof l=="object"&&l!==null?l=Jn(l):(l=Tn(n)?ss:un.current,l=Js(e,l));var p=n.getDerivedStateFromProps;(d=typeof p=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==f||u!==l)&&w0(e,o,i,l),fr=!1,u=e.memoizedState,o.state=u,Ac(e,i,o,r);var x=e.memoizedState;a!==f||u!==x||bn.current||fr?(typeof p=="function"&&(Ef(e,n,p,i),x=e.memoizedState),(c=fr||E0(e,n,c,i,u,x,l)||!1)?(d||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,x,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,x,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&u===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&u===t.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=x),o.props=i,o.state=x,o.context=l,i=c):(typeof o.componentDidUpdate!="function"||a===t.memoizedProps&&u===t.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===t.memoizedProps&&u===t.memoizedState||(e.flags|=1024),i=!1)}return Af(t,e,n,i,s,r)}function Af(t,e,n,i,r,s){vx(t,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&m0(e,n,!1),Zi(t,e,s);i=e.stateNode,e1.current=e;var a=o&&typeof n.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,t!==null&&o?(e.child=js(e,t.child,null,s),e.child=js(e,null,a,s)):gn(t,e,a,s),e.memoizedState=i.state,r&&m0(e,n,!0),e.child}function xx(t){var e=t.stateNode;e.pendingContext?p0(t,e.pendingContext,e.pendingContext!==e.context):e.context&&p0(t,e.context,!1),cp(t,e.containerInfo)}function I0(t,e,n,i,r){return Ks(),ip(r),e.flags|=256,gn(t,e,n,i),e.child}var Cf={dehydrated:null,treeContext:null,retryLane:0};function Rf(t){return{baseLanes:t,cachePool:null,transitions:null}}function _x(t,e,n){var i=e.pendingProps,r=Ct.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=t!==null&&t.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(t===null||t.memoizedState!==null)&&(r|=1),_t(Ct,r&1),t===null)return Sf(e),t=e.memoizedState,t!==null&&(t=t.dehydrated,t!==null)?(e.mode&1?t.data==="$!"?e.lanes=8:e.lanes=1073741824:e.lanes=1,null):(o=i.children,t=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},!(i&1)&&s!==null?(s.childLanes=0,s.pendingProps=o):s=qc(o,i,0,null),t=rs(t,i,n,null),s.return=e,t.return=e,s.sibling=t,e.child=s,e.child.memoizedState=Rf(n),e.memoizedState=Cf,t):vp(e,o));if(r=t.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return t1(t,e,o,i,a,r,n);if(s){s=i.fallback,o=e.mode,r=t.child,a=r.sibling;var l={mode:"hidden",children:i.children};return!(o&1)&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=br(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=br(a,s):(s=rs(s,o,n,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=t.child.memoizedState,o=o===null?Rf(n):{baseLanes:o.baseLanes|n,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=t.childLanes&~n,e.memoizedState=Cf,i}return s=t.child,t=s.sibling,i=br(s,{mode:"visible",children:i.children}),!(e.mode&1)&&(i.lanes=n),i.return=e,i.sibling=null,t!==null&&(n=e.deletions,n===null?(e.deletions=[t],e.flags|=16):n.push(t)),e.child=i,e.memoizedState=null,i}function vp(t,e){return e=qc({mode:"visible",children:e},t.mode,0,null),e.return=t,t.child=e}function Ql(t,e,n,i){return i!==null&&ip(i),js(e,t.child,null,n),t=vp(e,e.pendingProps.children),t.flags|=2,e.memoizedState=null,t}function t1(t,e,n,i,r,s,o){if(n)return e.flags&256?(e.flags&=-257,i=Gd(Error(re(422))),Ql(t,e,o,i)):e.memoizedState!==null?(e.child=t.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=qc({mode:"visible",children:i.children},r,0,null),s=rs(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,e.mode&1&&js(e,t.child,null,o),e.child.memoizedState=Rf(o),e.memoizedState=Cf,s);if(!(e.mode&1))return Ql(t,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(re(419)),i=Gd(s,i,void 0),Ql(t,e,o,i)}if(a=(o&t.childLanes)!==0,wn||a){if(i=Zt,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=r&(i.suspendedLanes|o)?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,Yi(t,r),ui(i,t,r,-1))}return Ep(),i=Gd(Error(re(421))),Ql(t,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=t.child,e=p1.bind(null,t),r._reactRetry=e,null):(t=s.treeContext,Nn=Sr(r.nextSibling),Dn=e,bt=!0,li=null,t!==null&&(qn[Yn++]=Gi,qn[Yn++]=Hi,qn[Yn++]=os,Gi=t.id,Hi=t.overflow,os=e),e=vp(e,i.children),e.flags|=4096,e)}function L0(t,e,n){t.lanes|=e;var i=t.alternate;i!==null&&(i.lanes|=e),Mf(t.return,e,n)}function Hd(t,e,n,i,r){var s=t.memoizedState;s===null?t.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=n,s.tailMode=r)}function yx(t,e,n){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(gn(t,e,i.children,n),i=Ct.current,i&2)i=i&1|2,e.flags|=128;else{if(t!==null&&t.flags&128)e:for(t=e.child;t!==null;){if(t.tag===13)t.memoizedState!==null&&L0(t,n,e);else if(t.tag===19)L0(t,n,e);else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break e;for(;t.sibling===null;){if(t.return===null||t.return===e)break e;t=t.return}t.sibling.return=t.return,t=t.sibling}i&=1}if(_t(Ct,i),!(e.mode&1))e.memoizedState=null;else switch(r){case"forwards":for(n=e.child,r=null;n!==null;)t=n.alternate,t!==null&&Cc(t)===null&&(r=n),n=n.sibling;n=r,n===null?(r=e.child,e.child=null):(r=n.sibling,n.sibling=null),Hd(e,!1,r,n,s);break;case"backwards":for(n=null,r=e.child,e.child=null;r!==null;){if(t=r.alternate,t!==null&&Cc(t)===null){e.child=r;break}t=r.sibling,r.sibling=n,n=r,r=t}Hd(e,!0,n,null,s);break;case"together":Hd(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function lc(t,e){!(e.mode&1)&&t!==null&&(t.alternate=null,e.alternate=null,e.flags|=2)}function Zi(t,e,n){if(t!==null&&(e.dependencies=t.dependencies),ls|=e.lanes,!(n&e.childLanes))return null;if(t!==null&&e.child!==t.child)throw Error(re(153));if(e.child!==null){for(t=e.child,n=br(t,t.pendingProps),e.child=n,n.return=e;t.sibling!==null;)t=t.sibling,n=n.sibling=br(t,t.pendingProps),n.return=e;n.sibling=null}return e.child}function n1(t,e,n){switch(e.tag){case 3:xx(e),Ks();break;case 5:qv(e);break;case 1:Tn(e.type)&&Mc(e);break;case 4:cp(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;_t(bc,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(_t(Ct,Ct.current&1),e.flags|=128,null):n&e.child.childLanes?_x(t,e,n):(_t(Ct,Ct.current&1),t=Zi(t,e,n),t!==null?t.sibling:null);_t(Ct,Ct.current&1);break;case 19:if(i=(n&e.childLanes)!==0,t.flags&128){if(i)return yx(t,e,n);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),_t(Ct,Ct.current),i)break;return null;case 22:case 23:return e.lanes=0,gx(t,e,n)}return Zi(t,e,n)}var Sx,Pf,Mx,Ex;Sx=function(t,e){for(var n=e.child;n!==null;){if(n.tag===5||n.tag===6)t.appendChild(n.stateNode);else if(n.tag!==4&&n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return;n=n.return}n.sibling.return=n.return,n=n.sibling}};Pf=function(){};Mx=function(t,e,n,i){var r=t.memoizedProps;if(r!==i){t=e.stateNode,ns(bi.current);var s=null;switch(n){case"input":r=Kd(t,r),i=Kd(t,i),s=[];break;case"select":r=Pt({},r,{value:void 0}),i=Pt({},i,{value:void 0}),s=[];break;case"textarea":r=ef(t,r),i=ef(t,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(t.onclick=yc)}nf(n,i);var o;n=null;for(c in r)if(!i.hasOwnProperty(c)&&r.hasOwnProperty(c)&&r[c]!=null)if(c==="style"){var a=r[c];for(o in a)a.hasOwnProperty(o)&&(n||(n={}),n[o]="")}else c!=="dangerouslySetInnerHTML"&&c!=="children"&&c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&c!=="autoFocus"&&(la.hasOwnProperty(c)?s||(s=[]):(s=s||[]).push(c,null));for(c in i){var l=i[c];if(a=r!=null?r[c]:void 0,i.hasOwnProperty(c)&&l!==a&&(l!=null||a!=null))if(c==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(n||(n={}),n[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(n||(n={}),n[o]=l[o])}else n||(s||(s=[]),s.push(c,n)),n=l;else c==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(c,l)):c==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(c,""+l):c!=="suppressContentEditableWarning"&&c!=="suppressHydrationWarning"&&(la.hasOwnProperty(c)?(l!=null&&c==="onScroll"&&Mt("scroll",t),s||a===l||(s=[])):(s=s||[]).push(c,l))}n&&(s=s||[]).push("style",n);var c=s;(e.updateQueue=c)&&(e.flags|=4)}};Ex=function(t,e,n,i){n!==i&&(e.flags|=4)};function qo(t,e){if(!bt)switch(t.tailMode){case"hidden":e=t.tail;for(var n=null;e!==null;)e.alternate!==null&&(n=e),e=e.sibling;n===null?t.tail=null:n.sibling=null;break;case"collapsed":n=t.tail;for(var i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?e||t.tail===null?t.tail=null:t.tail.sibling=null:i.sibling=null}}function ln(t){var e=t.alternate!==null&&t.alternate.child===t.child,n=0,i=0;if(e)for(var r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=t,r=r.sibling;else for(r=t.child;r!==null;)n|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=t,r=r.sibling;return t.subtreeFlags|=i,t.childLanes=n,e}function i1(t,e,n){var i=e.pendingProps;switch(np(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return ln(e),null;case 1:return Tn(e.type)&&Sc(),ln(e),null;case 3:return i=e.stateNode,Qs(),Et(bn),Et(un),hp(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(t===null||t.child===null)&&(Kl(e)?e.flags|=4:t===null||t.memoizedState.isDehydrated&&!(e.flags&256)||(e.flags|=1024,li!==null&&(Bf(li),li=null))),Pf(t,e),ln(e),null;case 5:up(e);var r=ns(ya.current);if(n=e.type,t!==null&&e.stateNode!=null)Mx(t,e,n,i,r),t.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(re(166));return ln(e),null}if(t=ns(bi.current),Kl(e)){i=e.stateNode,n=e.type;var s=e.memoizedProps;switch(i[Ei]=e,i[xa]=s,t=(e.mode&1)!==0,n){case"dialog":Mt("cancel",i),Mt("close",i);break;case"iframe":case"object":case"embed":Mt("load",i);break;case"video":case"audio":for(r=0;r<jo.length;r++)Mt(jo[r],i);break;case"source":Mt("error",i);break;case"img":case"image":case"link":Mt("error",i),Mt("load",i);break;case"details":Mt("toggle",i);break;case"input":zg(i,s),Mt("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},Mt("invalid",i);break;case"textarea":Gg(i,s),Mt("invalid",i)}nf(n,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&Jl(i.textContent,a,t),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&Jl(i.textContent,a,t),r=["children",""+a]):la.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&Mt("scroll",i)}switch(n){case"input":Bl(i),Vg(i,s,!0);break;case"textarea":Bl(i),Hg(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=yc)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,t==="http://www.w3.org/1999/xhtml"&&(t=K0(n)),t==="http://www.w3.org/1999/xhtml"?n==="script"?(t=o.createElement("div"),t.innerHTML="<script><\/script>",t=t.removeChild(t.firstChild)):typeof i.is=="string"?t=o.createElement(n,{is:i.is}):(t=o.createElement(n),n==="select"&&(o=t,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):t=o.createElementNS(t,n),t[Ei]=e,t[xa]=i,Sx(t,e,!1,!1),e.stateNode=t;e:{switch(o=rf(n,i),n){case"dialog":Mt("cancel",t),Mt("close",t),r=i;break;case"iframe":case"object":case"embed":Mt("load",t),r=i;break;case"video":case"audio":for(r=0;r<jo.length;r++)Mt(jo[r],t);r=i;break;case"source":Mt("error",t),r=i;break;case"img":case"image":case"link":Mt("error",t),Mt("load",t),r=i;break;case"details":Mt("toggle",t),r=i;break;case"input":zg(t,i),r=Kd(t,i),Mt("invalid",t);break;case"option":r=i;break;case"select":t._wrapperState={wasMultiple:!!i.multiple},r=Pt({},i,{value:void 0}),Mt("invalid",t);break;case"textarea":Gg(t,i),r=ef(t,i),Mt("invalid",t);break;default:r=i}nf(n,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?ev(t,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&j0(t,l)):s==="children"?typeof l=="string"?(n!=="textarea"||l!=="")&&ca(t,l):typeof l=="number"&&ca(t,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(la.hasOwnProperty(s)?l!=null&&s==="onScroll"&&Mt("scroll",t):l!=null&&Vf(t,s,l,o))}switch(n){case"input":Bl(t),Vg(t,i,!1);break;case"textarea":Bl(t),Hg(t);break;case"option":i.value!=null&&t.setAttribute("value",""+Tr(i.value));break;case"select":t.multiple=!!i.multiple,s=i.value,s!=null?Hs(t,!!i.multiple,s,!1):i.defaultValue!=null&&Hs(t,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(t.onclick=yc)}switch(n){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return ln(e),null;case 6:if(t&&e.stateNode!=null)Ex(t,e,t.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(re(166));if(n=ns(ya.current),ns(bi.current),Kl(e)){if(i=e.stateNode,n=e.memoizedProps,i[Ei]=e,(s=i.nodeValue!==n)&&(t=Dn,t!==null))switch(t.tag){case 3:Jl(i.nodeValue,n,(t.mode&1)!==0);break;case 5:t.memoizedProps.suppressHydrationWarning!==!0&&Jl(i.nodeValue,n,(t.mode&1)!==0)}s&&(e.flags|=4)}else i=(n.nodeType===9?n:n.ownerDocument).createTextNode(i),i[Ei]=e,e.stateNode=i}return ln(e),null;case 13:if(Et(Ct),i=e.memoizedState,t===null||t.memoizedState!==null&&t.memoizedState.dehydrated!==null){if(bt&&Nn!==null&&e.mode&1&&!(e.flags&128))Vv(),Ks(),e.flags|=98560,s=!1;else if(s=Kl(e),i!==null&&i.dehydrated!==null){if(t===null){if(!s)throw Error(re(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(re(317));s[Ei]=e}else Ks(),!(e.flags&128)&&(e.memoizedState=null),e.flags|=4;ln(e),s=!1}else li!==null&&(Bf(li),li=null),s=!0;if(!s)return e.flags&65536?e:null}return e.flags&128?(e.lanes=n,e):(i=i!==null,i!==(t!==null&&t.memoizedState!==null)&&i&&(e.child.flags|=8192,e.mode&1&&(t===null||Ct.current&1?Ht===0&&(Ht=3):Ep())),e.updateQueue!==null&&(e.flags|=4),ln(e),null);case 4:return Qs(),Pf(t,e),t===null&&ga(e.stateNode.containerInfo),ln(e),null;case 10:return op(e.type._context),ln(e),null;case 17:return Tn(e.type)&&Sc(),ln(e),null;case 19:if(Et(Ct),s=e.memoizedState,s===null)return ln(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)qo(s,!1);else{if(Ht!==0||t!==null&&t.flags&128)for(t=e.child;t!==null;){if(o=Cc(t),o!==null){for(e.flags|=128,qo(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=n,n=e.child;n!==null;)s=n,t=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=t,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,t=o.dependencies,s.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext}),n=n.sibling;return _t(Ct,Ct.current&1|2),e.child}t=t.sibling}s.tail!==null&&Ot()>to&&(e.flags|=128,i=!0,qo(s,!1),e.lanes=4194304)}else{if(!i)if(t=Cc(o),t!==null){if(e.flags|=128,i=!0,n=t.updateQueue,n!==null&&(e.updateQueue=n,e.flags|=4),qo(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!bt)return ln(e),null}else 2*Ot()-s.renderingStartTime>to&&n!==1073741824&&(e.flags|=128,i=!0,qo(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(n=s.last,n!==null?n.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=Ot(),e.sibling=null,n=Ct.current,_t(Ct,i?n&1|2:n&1),e):(ln(e),null);case 22:case 23:return Mp(),i=e.memoizedState!==null,t!==null&&t.memoizedState!==null!==i&&(e.flags|=8192),i&&e.mode&1?Ln&1073741824&&(ln(e),e.subtreeFlags&6&&(e.flags|=8192)):ln(e),null;case 24:return null;case 25:return null}throw Error(re(156,e.tag))}function r1(t,e){switch(np(e),e.tag){case 1:return Tn(e.type)&&Sc(),t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 3:return Qs(),Et(bn),Et(un),hp(),t=e.flags,t&65536&&!(t&128)?(e.flags=t&-65537|128,e):null;case 5:return up(e),null;case 13:if(Et(Ct),t=e.memoizedState,t!==null&&t.dehydrated!==null){if(e.alternate===null)throw Error(re(340));Ks()}return t=e.flags,t&65536?(e.flags=t&-65537|128,e):null;case 19:return Et(Ct),null;case 4:return Qs(),null;case 10:return op(e.type._context),null;case 22:case 23:return Mp(),null;case 24:return null;default:return null}}var ec=!1,cn=!1,s1=typeof WeakSet=="function"?WeakSet:Set,be=null;function Vs(t,e){var n=t.ref;if(n!==null)if(typeof n=="function")try{n(null)}catch(i){Dt(t,e,i)}else n.current=null}function If(t,e,n){try{n()}catch(i){Dt(t,e,i)}}var N0=!1;function o1(t,e){if(pf=vc,t=Cv(),ep(t)){if("selectionStart"in t)var n={start:t.selectionStart,end:t.selectionEnd};else e:{n=(n=t.ownerDocument)&&n.defaultView||window;var i=n.getSelection&&n.getSelection();if(i&&i.rangeCount!==0){n=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{n.nodeType,s.nodeType}catch{n=null;break e}var o=0,a=-1,l=-1,c=0,d=0,f=t,u=null;t:for(;;){for(var p;f!==n||r!==0&&f.nodeType!==3||(a=o+r),f!==s||i!==0&&f.nodeType!==3||(l=o+i),f.nodeType===3&&(o+=f.nodeValue.length),(p=f.firstChild)!==null;)u=f,f=p;for(;;){if(f===t)break t;if(u===n&&++c===r&&(a=o),u===s&&++d===i&&(l=o),(p=f.nextSibling)!==null)break;f=u,u=f.parentNode}f=p}n=a===-1||l===-1?null:{start:a,end:l}}else n=null}n=n||{start:0,end:0}}else n=null;for(mf={focusedElem:t,selectionRange:n},vc=!1,be=e;be!==null;)if(e=be,t=e.child,(e.subtreeFlags&1028)!==0&&t!==null)t.return=e,be=t;else for(;be!==null;){e=be;try{var x=e.alternate;if(e.flags&1024)switch(e.tag){case 0:case 11:case 15:break;case 1:if(x!==null){var S=x.memoizedProps,v=x.memoizedState,h=e.stateNode,g=h.getSnapshotBeforeUpdate(e.elementType===e.type?S:oi(e.type,S),v);h.__reactInternalSnapshotBeforeUpdate=g}break;case 3:var _=e.stateNode.containerInfo;_.nodeType===1?_.textContent="":_.nodeType===9&&_.documentElement&&_.removeChild(_.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(re(163))}}catch(M){Dt(e,e.return,M)}if(t=e.sibling,t!==null){t.return=e.return,be=t;break}be=e.return}return x=N0,N0=!1,x}function sa(t,e,n){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&t)===t){var s=r.destroy;r.destroy=void 0,s!==void 0&&If(e,n,s)}r=r.next}while(r!==i)}}function Wc(t,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var n=e=e.next;do{if((n.tag&t)===t){var i=n.create;n.destroy=i()}n=n.next}while(n!==e)}}function Lf(t){var e=t.ref;if(e!==null){var n=t.stateNode;switch(t.tag){case 5:t=n;break;default:t=n}typeof e=="function"?e(t):e.current=t}}function wx(t){var e=t.alternate;e!==null&&(t.alternate=null,wx(e)),t.child=null,t.deletions=null,t.sibling=null,t.tag===5&&(e=t.stateNode,e!==null&&(delete e[Ei],delete e[xa],delete e[xf],delete e[GM],delete e[HM])),t.stateNode=null,t.return=null,t.dependencies=null,t.memoizedProps=null,t.memoizedState=null,t.pendingProps=null,t.stateNode=null,t.updateQueue=null}function bx(t){return t.tag===5||t.tag===3||t.tag===4}function D0(t){e:for(;;){for(;t.sibling===null;){if(t.return===null||bx(t.return))return null;t=t.return}for(t.sibling.return=t.return,t=t.sibling;t.tag!==5&&t.tag!==6&&t.tag!==18;){if(t.flags&2||t.child===null||t.tag===4)continue e;t.child.return=t,t=t.child}if(!(t.flags&2))return t.stateNode}}function Nf(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.nodeType===8?n.parentNode.insertBefore(t,e):n.insertBefore(t,e):(n.nodeType===8?(e=n.parentNode,e.insertBefore(t,n)):(e=n,e.appendChild(t)),n=n._reactRootContainer,n!=null||e.onclick!==null||(e.onclick=yc));else if(i!==4&&(t=t.child,t!==null))for(Nf(t,e,n),t=t.sibling;t!==null;)Nf(t,e,n),t=t.sibling}function Df(t,e,n){var i=t.tag;if(i===5||i===6)t=t.stateNode,e?n.insertBefore(t,e):n.appendChild(t);else if(i!==4&&(t=t.child,t!==null))for(Df(t,e,n),t=t.sibling;t!==null;)Df(t,e,n),t=t.sibling}var en=null,ai=!1;function hr(t,e,n){for(n=n.child;n!==null;)Tx(t,e,n),n=n.sibling}function Tx(t,e,n){if(wi&&typeof wi.onCommitFiberUnmount=="function")try{wi.onCommitFiberUnmount(Fc,n)}catch{}switch(n.tag){case 5:cn||Vs(n,e);case 6:var i=en,r=ai;en=null,hr(t,e,n),en=i,ai=r,en!==null&&(ai?(t=en,n=n.stateNode,t.nodeType===8?t.parentNode.removeChild(n):t.removeChild(n)):en.removeChild(n.stateNode));break;case 18:en!==null&&(ai?(t=en,n=n.stateNode,t.nodeType===8?Fd(t.parentNode,n):t.nodeType===1&&Fd(t,n),fa(t)):Fd(en,n.stateNode));break;case 4:i=en,r=ai,en=n.stateNode.containerInfo,ai=!0,hr(t,e,n),en=i,ai=r;break;case 0:case 11:case 14:case 15:if(!cn&&(i=n.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&(s&2||s&4)&&If(n,e,o),r=r.next}while(r!==i)}hr(t,e,n);break;case 1:if(!cn&&(Vs(n,e),i=n.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=n.memoizedProps,i.state=n.memoizedState,i.componentWillUnmount()}catch(a){Dt(n,e,a)}hr(t,e,n);break;case 21:hr(t,e,n);break;case 22:n.mode&1?(cn=(i=cn)||n.memoizedState!==null,hr(t,e,n),cn=i):hr(t,e,n);break;default:hr(t,e,n)}}function U0(t){var e=t.updateQueue;if(e!==null){t.updateQueue=null;var n=t.stateNode;n===null&&(n=t.stateNode=new s1),e.forEach(function(i){var r=m1.bind(null,t,i);n.has(i)||(n.add(i),i.then(r,r))})}}function si(t,e){var n=e.deletions;if(n!==null)for(var i=0;i<n.length;i++){var r=n[i];try{var s=t,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:en=a.stateNode,ai=!1;break e;case 3:en=a.stateNode.containerInfo,ai=!0;break e;case 4:en=a.stateNode.containerInfo,ai=!0;break e}a=a.return}if(en===null)throw Error(re(160));Tx(s,o,r),en=null,ai=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(c){Dt(r,e,c)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)Ax(e,t),e=e.sibling}function Ax(t,e){var n=t.alternate,i=t.flags;switch(t.tag){case 0:case 11:case 14:case 15:if(si(e,t),Si(t),i&4){try{sa(3,t,t.return),Wc(3,t)}catch(S){Dt(t,t.return,S)}try{sa(5,t,t.return)}catch(S){Dt(t,t.return,S)}}break;case 1:si(e,t),Si(t),i&512&&n!==null&&Vs(n,n.return);break;case 5:if(si(e,t),Si(t),i&512&&n!==null&&Vs(n,n.return),t.flags&32){var r=t.stateNode;try{ca(r,"")}catch(S){Dt(t,t.return,S)}}if(i&4&&(r=t.stateNode,r!=null)){var s=t.memoizedProps,o=n!==null?n.memoizedProps:s,a=t.type,l=t.updateQueue;if(t.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&$0(r,s),rf(a,o);var c=rf(a,s);for(o=0;o<l.length;o+=2){var d=l[o],f=l[o+1];d==="style"?ev(r,f):d==="dangerouslySetInnerHTML"?j0(r,f):d==="children"?ca(r,f):Vf(r,d,f,c)}switch(a){case"input":jd(r,s);break;case"textarea":J0(r,s);break;case"select":var u=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var p=s.value;p!=null?Hs(r,!!s.multiple,p,!1):u!==!!s.multiple&&(s.defaultValue!=null?Hs(r,!!s.multiple,s.defaultValue,!0):Hs(r,!!s.multiple,s.multiple?[]:"",!1))}r[xa]=s}catch(S){Dt(t,t.return,S)}}break;case 6:if(si(e,t),Si(t),i&4){if(t.stateNode===null)throw Error(re(162));r=t.stateNode,s=t.memoizedProps;try{r.nodeValue=s}catch(S){Dt(t,t.return,S)}}break;case 3:if(si(e,t),Si(t),i&4&&n!==null&&n.memoizedState.isDehydrated)try{fa(e.containerInfo)}catch(S){Dt(t,t.return,S)}break;case 4:si(e,t),Si(t);break;case 13:si(e,t),Si(t),r=t.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(yp=Ot())),i&4&&U0(t);break;case 22:if(d=n!==null&&n.memoizedState!==null,t.mode&1?(cn=(c=cn)||d,si(e,t),cn=c):si(e,t),Si(t),i&8192){if(c=t.memoizedState!==null,(t.stateNode.isHidden=c)&&!d&&t.mode&1)for(be=t,d=t.child;d!==null;){for(f=be=d;be!==null;){switch(u=be,p=u.child,u.tag){case 0:case 11:case 14:case 15:sa(4,u,u.return);break;case 1:Vs(u,u.return);var x=u.stateNode;if(typeof x.componentWillUnmount=="function"){i=u,n=u.return;try{e=i,x.props=e.memoizedProps,x.state=e.memoizedState,x.componentWillUnmount()}catch(S){Dt(i,n,S)}}break;case 5:Vs(u,u.return);break;case 22:if(u.memoizedState!==null){O0(f);continue}}p!==null?(p.return=u,be=p):O0(f)}d=d.sibling}e:for(d=null,f=t;;){if(f.tag===5){if(d===null){d=f;try{r=f.stateNode,c?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=f.stateNode,l=f.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=Q0("display",o))}catch(S){Dt(t,t.return,S)}}}else if(f.tag===6){if(d===null)try{f.stateNode.nodeValue=c?"":f.memoizedProps}catch(S){Dt(t,t.return,S)}}else if((f.tag!==22&&f.tag!==23||f.memoizedState===null||f===t)&&f.child!==null){f.child.return=f,f=f.child;continue}if(f===t)break e;for(;f.sibling===null;){if(f.return===null||f.return===t)break e;d===f&&(d=null),f=f.return}d===f&&(d=null),f.sibling.return=f.return,f=f.sibling}}break;case 19:si(e,t),Si(t),i&4&&U0(t);break;case 21:break;default:si(e,t),Si(t)}}function Si(t){var e=t.flags;if(e&2){try{e:{for(var n=t.return;n!==null;){if(bx(n)){var i=n;break e}n=n.return}throw Error(re(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(ca(r,""),i.flags&=-33);var s=D0(t);Df(t,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=D0(t);Nf(t,a,o);break;default:throw Error(re(161))}}catch(l){Dt(t,t.return,l)}t.flags&=-3}e&4096&&(t.flags&=-4097)}function a1(t,e,n){be=t,Cx(t,e,n)}function Cx(t,e,n){for(var i=(t.mode&1)!==0;be!==null;){var r=be,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||ec;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||cn;a=ec;var c=cn;if(ec=o,(cn=l)&&!c)for(be=r;be!==null;)o=be,l=o.child,o.tag===22&&o.memoizedState!==null?B0(r):l!==null?(l.return=o,be=l):B0(r);for(;s!==null;)be=s,Cx(s,e,n),s=s.sibling;be=r,ec=a,cn=c}F0(t,e,n)}else r.subtreeFlags&8772&&s!==null?(s.return=r,be=s):F0(t,e,n)}}function F0(t){for(;be!==null;){var e=be;if(e.flags&8772){var n=e.alternate;try{if(e.flags&8772)switch(e.tag){case 0:case 11:case 15:cn||Wc(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!cn)if(n===null)i.componentDidMount();else{var r=e.elementType===e.type?n.memoizedProps:oi(e.type,n.memoizedProps);i.componentDidUpdate(r,n.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&y0(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(n=null,e.child!==null)switch(e.child.tag){case 5:n=e.child.stateNode;break;case 1:n=e.child.stateNode}y0(e,o,n)}break;case 5:var a=e.stateNode;if(n===null&&e.flags&4){n=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&n.focus();break;case"img":l.src&&(n.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var c=e.alternate;if(c!==null){var d=c.memoizedState;if(d!==null){var f=d.dehydrated;f!==null&&fa(f)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(re(163))}cn||e.flags&512&&Lf(e)}catch(u){Dt(e,e.return,u)}}if(e===t){be=null;break}if(n=e.sibling,n!==null){n.return=e.return,be=n;break}be=e.return}}function O0(t){for(;be!==null;){var e=be;if(e===t){be=null;break}var n=e.sibling;if(n!==null){n.return=e.return,be=n;break}be=e.return}}function B0(t){for(;be!==null;){var e=be;try{switch(e.tag){case 0:case 11:case 15:var n=e.return;try{Wc(4,e)}catch(l){Dt(e,n,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){Dt(e,r,l)}}var s=e.return;try{Lf(e)}catch(l){Dt(e,s,l)}break;case 5:var o=e.return;try{Lf(e)}catch(l){Dt(e,o,l)}}}catch(l){Dt(e,e.return,l)}if(e===t){be=null;break}var a=e.sibling;if(a!==null){a.return=e.return,be=a;break}be=e.return}}var l1=Math.ceil,Ic=$i.ReactCurrentDispatcher,xp=$i.ReactCurrentOwner,$n=$i.ReactCurrentBatchConfig,nt=0,Zt=null,kt=null,tn=0,Ln=0,Gs=Rr(0),Ht=0,wa=null,ls=0,Xc=0,_p=0,oa=null,En=null,yp=0,to=1/0,zi=null,Lc=!1,Uf=null,Er=null,tc=!1,vr=null,Nc=0,aa=0,Ff=null,cc=-1,uc=0;function vn(){return nt&6?Ot():cc!==-1?cc:cc=Ot()}function wr(t){return t.mode&1?nt&2&&tn!==0?tn&-tn:XM.transition!==null?(uc===0&&(uc=dv()),uc):(t=ht,t!==0||(t=window.event,t=t===void 0?16:_v(t.type)),t):1}function ui(t,e,n,i){if(50<aa)throw aa=0,Ff=null,Error(re(185));ba(t,n,i),(!(nt&2)||t!==Zt)&&(t===Zt&&(!(nt&2)&&(Xc|=n),Ht===4&&mr(t,tn)),An(t,i),n===1&&nt===0&&!(e.mode&1)&&(to=Ot()+500,Vc&&Pr()))}function An(t,e){var n=t.callbackNode;YS(t,e);var i=gc(t,t===Zt?tn:0);if(i===0)n!==null&&qg(n),t.callbackNode=null,t.callbackPriority=0;else if(e=i&-i,t.callbackPriority!==e){if(n!=null&&qg(n),e===1)t.tag===0?WM(k0.bind(null,t)):Bv(k0.bind(null,t)),zM(function(){!(nt&6)&&Pr()}),n=null;else{switch(fv(i)){case 1:n=qf;break;case 4:n=uv;break;case 16:n=mc;break;case 536870912:n=hv;break;default:n=mc}n=Fx(n,Rx.bind(null,t))}t.callbackPriority=e,t.callbackNode=n}}function Rx(t,e){if(cc=-1,uc=0,nt&6)throw Error(re(327));var n=t.callbackNode;if(Zs()&&t.callbackNode!==n)return null;var i=gc(t,t===Zt?tn:0);if(i===0)return null;if(i&30||i&t.expiredLanes||e)e=Dc(t,i);else{e=i;var r=nt;nt|=2;var s=Ix();(Zt!==t||tn!==e)&&(zi=null,to=Ot()+500,is(t,e));do try{h1();break}catch(a){Px(t,a)}while(!0);sp(),Ic.current=s,nt=r,kt!==null?e=0:(Zt=null,tn=0,e=Ht)}if(e!==0){if(e===2&&(r=cf(t),r!==0&&(i=r,e=Of(t,r))),e===1)throw n=wa,is(t,0),mr(t,i),An(t,Ot()),n;if(e===6)mr(t,i);else{if(r=t.current.alternate,!(i&30)&&!c1(r)&&(e=Dc(t,i),e===2&&(s=cf(t),s!==0&&(i=s,e=Of(t,s))),e===1))throw n=wa,is(t,0),mr(t,i),An(t,Ot()),n;switch(t.finishedWork=r,t.finishedLanes=i,e){case 0:case 1:throw Error(re(345));case 2:Qr(t,En,zi);break;case 3:if(mr(t,i),(i&130023424)===i&&(e=yp+500-Ot(),10<e)){if(gc(t,0)!==0)break;if(r=t.suspendedLanes,(r&i)!==i){vn(),t.pingedLanes|=t.suspendedLanes&r;break}t.timeoutHandle=vf(Qr.bind(null,t,En,zi),e);break}Qr(t,En,zi);break;case 4:if(mr(t,i),(i&4194240)===i)break;for(e=t.eventTimes,r=-1;0<i;){var o=31-ci(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=Ot()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*l1(i/1960))-i,10<i){t.timeoutHandle=vf(Qr.bind(null,t,En,zi),i);break}Qr(t,En,zi);break;case 5:Qr(t,En,zi);break;default:throw Error(re(329))}}}return An(t,Ot()),t.callbackNode===n?Rx.bind(null,t):null}function Of(t,e){var n=oa;return t.current.memoizedState.isDehydrated&&(is(t,e).flags|=256),t=Dc(t,e),t!==2&&(e=En,En=n,e!==null&&Bf(e)),t}function Bf(t){En===null?En=t:En.push.apply(En,t)}function c1(t){for(var e=t;;){if(e.flags&16384){var n=e.updateQueue;if(n!==null&&(n=n.stores,n!==null))for(var i=0;i<n.length;i++){var r=n[i],s=r.getSnapshot;r=r.value;try{if(!hi(s(),r))return!1}catch{return!1}}}if(n=e.child,e.subtreeFlags&16384&&n!==null)n.return=e,e=n;else{if(e===t)break;for(;e.sibling===null;){if(e.return===null||e.return===t)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function mr(t,e){for(e&=~_p,e&=~Xc,t.suspendedLanes|=e,t.pingedLanes&=~e,t=t.expirationTimes;0<e;){var n=31-ci(e),i=1<<n;t[n]=-1,e&=~i}}function k0(t){if(nt&6)throw Error(re(327));Zs();var e=gc(t,0);if(!(e&1))return An(t,Ot()),null;var n=Dc(t,e);if(t.tag!==0&&n===2){var i=cf(t);i!==0&&(e=i,n=Of(t,i))}if(n===1)throw n=wa,is(t,0),mr(t,e),An(t,Ot()),n;if(n===6)throw Error(re(345));return t.finishedWork=t.current.alternate,t.finishedLanes=e,Qr(t,En,zi),An(t,Ot()),null}function Sp(t,e){var n=nt;nt|=1;try{return t(e)}finally{nt=n,nt===0&&(to=Ot()+500,Vc&&Pr())}}function cs(t){vr!==null&&vr.tag===0&&!(nt&6)&&Zs();var e=nt;nt|=1;var n=$n.transition,i=ht;try{if($n.transition=null,ht=1,t)return t()}finally{ht=i,$n.transition=n,nt=e,!(nt&6)&&Pr()}}function Mp(){Ln=Gs.current,Et(Gs)}function is(t,e){t.finishedWork=null,t.finishedLanes=0;var n=t.timeoutHandle;if(n!==-1&&(t.timeoutHandle=-1,kM(n)),kt!==null)for(n=kt.return;n!==null;){var i=n;switch(np(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&Sc();break;case 3:Qs(),Et(bn),Et(un),hp();break;case 5:up(i);break;case 4:Qs();break;case 13:Et(Ct);break;case 19:Et(Ct);break;case 10:op(i.type._context);break;case 22:case 23:Mp()}n=n.return}if(Zt=t,kt=t=br(t.current,null),tn=Ln=e,Ht=0,wa=null,_p=Xc=ls=0,En=oa=null,ts!==null){for(e=0;e<ts.length;e++)if(n=ts[e],i=n.interleaved,i!==null){n.interleaved=null;var r=i.next,s=n.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}n.pending=i}ts=null}return t}function Px(t,e){do{var n=kt;try{if(sp(),oc.current=Pc,Rc){for(var i=Rt.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}Rc=!1}if(as=0,Yt=Gt=Rt=null,ra=!1,Sa=0,xp.current=null,n===null||n.return===null){Ht=1,wa=e,kt=null;break}e:{var s=t,o=n.return,a=n,l=e;if(e=tn,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var c=l,d=a,f=d.tag;if(!(d.mode&1)&&(f===0||f===11||f===15)){var u=d.alternate;u?(d.updateQueue=u.updateQueue,d.memoizedState=u.memoizedState,d.lanes=u.lanes):(d.updateQueue=null,d.memoizedState=null)}var p=T0(o);if(p!==null){p.flags&=-257,A0(p,o,a,s,e),p.mode&1&&b0(s,c,e),e=p,l=c;var x=e.updateQueue;if(x===null){var S=new Set;S.add(l),e.updateQueue=S}else x.add(l);break e}else{if(!(e&1)){b0(s,c,e),Ep();break e}l=Error(re(426))}}else if(bt&&a.mode&1){var v=T0(o);if(v!==null){!(v.flags&65536)&&(v.flags|=256),A0(v,o,a,s,e),ip(eo(l,a));break e}}s=l=eo(l,a),Ht!==4&&(Ht=2),oa===null?oa=[s]:oa.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var h=fx(s,l,e);_0(s,h);break e;case 1:a=l;var g=s.type,_=s.stateNode;if(!(s.flags&128)&&(typeof g.getDerivedStateFromError=="function"||_!==null&&typeof _.componentDidCatch=="function"&&(Er===null||!Er.has(_)))){s.flags|=65536,e&=-e,s.lanes|=e;var M=px(s,a,e);_0(s,M);break e}}s=s.return}while(s!==null)}Nx(n)}catch(C){e=C,kt===n&&n!==null&&(kt=n=n.return);continue}break}while(!0)}function Ix(){var t=Ic.current;return Ic.current=Pc,t===null?Pc:t}function Ep(){(Ht===0||Ht===3||Ht===2)&&(Ht=4),Zt===null||!(ls&268435455)&&!(Xc&268435455)||mr(Zt,tn)}function Dc(t,e){var n=nt;nt|=2;var i=Ix();(Zt!==t||tn!==e)&&(zi=null,is(t,e));do try{u1();break}catch(r){Px(t,r)}while(!0);if(sp(),nt=n,Ic.current=i,kt!==null)throw Error(re(261));return Zt=null,tn=0,Ht}function u1(){for(;kt!==null;)Lx(kt)}function h1(){for(;kt!==null&&!BS();)Lx(kt)}function Lx(t){var e=Ux(t.alternate,t,Ln);t.memoizedProps=t.pendingProps,e===null?Nx(t):kt=e,xp.current=null}function Nx(t){var e=t;do{var n=e.alternate;if(t=e.return,e.flags&32768){if(n=r1(n,e),n!==null){n.flags&=32767,kt=n;return}if(t!==null)t.flags|=32768,t.subtreeFlags=0,t.deletions=null;else{Ht=6,kt=null;return}}else if(n=i1(n,e,Ln),n!==null){kt=n;return}if(e=e.sibling,e!==null){kt=e;return}kt=e=t}while(e!==null);Ht===0&&(Ht=5)}function Qr(t,e,n){var i=ht,r=$n.transition;try{$n.transition=null,ht=1,d1(t,e,n,i)}finally{$n.transition=r,ht=i}return null}function d1(t,e,n,i){do Zs();while(vr!==null);if(nt&6)throw Error(re(327));n=t.finishedWork;var r=t.finishedLanes;if(n===null)return null;if(t.finishedWork=null,t.finishedLanes=0,n===t.current)throw Error(re(177));t.callbackNode=null,t.callbackPriority=0;var s=n.lanes|n.childLanes;if(ZS(t,s),t===Zt&&(kt=Zt=null,tn=0),!(n.subtreeFlags&2064)&&!(n.flags&2064)||tc||(tc=!0,Fx(mc,function(){return Zs(),null})),s=(n.flags&15990)!==0,n.subtreeFlags&15990||s){s=$n.transition,$n.transition=null;var o=ht;ht=1;var a=nt;nt|=4,xp.current=null,o1(t,n),Ax(n,t),DM(mf),vc=!!pf,mf=pf=null,t.current=n,a1(n,t,r),kS(),nt=a,ht=o,$n.transition=s}else t.current=n;if(tc&&(tc=!1,vr=t,Nc=r),s=t.pendingLanes,s===0&&(Er=null),GS(n.stateNode,i),An(t,Ot()),e!==null)for(i=t.onRecoverableError,n=0;n<e.length;n++)r=e[n],i(r.value,{componentStack:r.stack,digest:r.digest});if(Lc)throw Lc=!1,t=Uf,Uf=null,t;return Nc&1&&t.tag!==0&&Zs(),s=t.pendingLanes,s&1?t===Ff?aa++:(aa=0,Ff=t):aa=0,Pr(),null}function Zs(){if(vr!==null){var t=fv(Nc),e=$n.transition,n=ht;try{if($n.transition=null,ht=16>t?16:t,vr===null)var i=!1;else{if(t=vr,vr=null,Nc=0,nt&6)throw Error(re(331));var r=nt;for(nt|=4,be=t.current;be!==null;){var s=be,o=s.child;if(be.flags&16){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var c=a[l];for(be=c;be!==null;){var d=be;switch(d.tag){case 0:case 11:case 15:sa(8,d,s)}var f=d.child;if(f!==null)f.return=d,be=f;else for(;be!==null;){d=be;var u=d.sibling,p=d.return;if(wx(d),d===c){be=null;break}if(u!==null){u.return=p,be=u;break}be=p}}}var x=s.alternate;if(x!==null){var S=x.child;if(S!==null){x.child=null;do{var v=S.sibling;S.sibling=null,S=v}while(S!==null)}}be=s}}if(s.subtreeFlags&2064&&o!==null)o.return=s,be=o;else e:for(;be!==null;){if(s=be,s.flags&2048)switch(s.tag){case 0:case 11:case 15:sa(9,s,s.return)}var h=s.sibling;if(h!==null){h.return=s.return,be=h;break e}be=s.return}}var g=t.current;for(be=g;be!==null;){o=be;var _=o.child;if(o.subtreeFlags&2064&&_!==null)_.return=o,be=_;else e:for(o=g;be!==null;){if(a=be,a.flags&2048)try{switch(a.tag){case 0:case 11:case 15:Wc(9,a)}}catch(C){Dt(a,a.return,C)}if(a===o){be=null;break e}var M=a.sibling;if(M!==null){M.return=a.return,be=M;break e}be=a.return}}if(nt=r,Pr(),wi&&typeof wi.onPostCommitFiberRoot=="function")try{wi.onPostCommitFiberRoot(Fc,t)}catch{}i=!0}return i}finally{ht=n,$n.transition=e}}return!1}function z0(t,e,n){e=eo(n,e),e=fx(t,e,1),t=Mr(t,e,1),e=vn(),t!==null&&(ba(t,1,e),An(t,e))}function Dt(t,e,n){if(t.tag===3)z0(t,t,n);else for(;e!==null;){if(e.tag===3){z0(e,t,n);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(Er===null||!Er.has(i))){t=eo(n,t),t=px(e,t,1),e=Mr(e,t,1),t=vn(),e!==null&&(ba(e,1,t),An(e,t));break}}e=e.return}}function f1(t,e,n){var i=t.pingCache;i!==null&&i.delete(e),e=vn(),t.pingedLanes|=t.suspendedLanes&n,Zt===t&&(tn&n)===n&&(Ht===4||Ht===3&&(tn&130023424)===tn&&500>Ot()-yp?is(t,0):_p|=n),An(t,e)}function Dx(t,e){e===0&&(t.mode&1?(e=Vl,Vl<<=1,!(Vl&130023424)&&(Vl=4194304)):e=1);var n=vn();t=Yi(t,e),t!==null&&(ba(t,e,n),An(t,n))}function p1(t){var e=t.memoizedState,n=0;e!==null&&(n=e.retryLane),Dx(t,n)}function m1(t,e){var n=0;switch(t.tag){case 13:var i=t.stateNode,r=t.memoizedState;r!==null&&(n=r.retryLane);break;case 19:i=t.stateNode;break;default:throw Error(re(314))}i!==null&&i.delete(e),Dx(t,n)}var Ux;Ux=function(t,e,n){if(t!==null)if(t.memoizedProps!==e.pendingProps||bn.current)wn=!0;else{if(!(t.lanes&n)&&!(e.flags&128))return wn=!1,n1(t,e,n);wn=!!(t.flags&131072)}else wn=!1,bt&&e.flags&1048576&&kv(e,wc,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;lc(t,e),t=e.pendingProps;var r=Js(e,un.current);Ys(e,n),r=fp(null,e,i,t,r,n);var s=pp();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,Tn(i)?(s=!0,Mc(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,lp(e),r.updater=Hc,e.stateNode=r,r._reactInternals=e,wf(e,i,t,n),e=Af(null,e,i,!0,s,n)):(e.tag=0,bt&&s&&tp(e),gn(null,e,r,n),e=e.child),e;case 16:i=e.elementType;e:{switch(lc(t,e),t=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=v1(i),t=oi(i,t),r){case 0:e=Tf(null,e,i,t,n);break e;case 1:e=P0(null,e,i,t,n);break e;case 11:e=C0(null,e,i,t,n);break e;case 14:e=R0(null,e,i,oi(i.type,t),n);break e}throw Error(re(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:oi(i,r),Tf(t,e,i,r,n);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:oi(i,r),P0(t,e,i,r,n);case 3:e:{if(xx(e),t===null)throw Error(re(387));i=e.pendingProps,s=e.memoizedState,r=s.element,Xv(t,e),Ac(e,i,null,n);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=eo(Error(re(423)),e),e=I0(t,e,i,n,r);break e}else if(i!==r){r=eo(Error(re(424)),e),e=I0(t,e,i,n,r);break e}else for(Nn=Sr(e.stateNode.containerInfo.firstChild),Dn=e,bt=!0,li=null,n=Hv(e,null,i,n),e.child=n;n;)n.flags=n.flags&-3|4096,n=n.sibling;else{if(Ks(),i===r){e=Zi(t,e,n);break e}gn(t,e,i,n)}e=e.child}return e;case 5:return qv(e),t===null&&Sf(e),i=e.type,r=e.pendingProps,s=t!==null?t.memoizedProps:null,o=r.children,gf(i,r)?o=null:s!==null&&gf(i,s)&&(e.flags|=32),vx(t,e),gn(t,e,o,n),e.child;case 6:return t===null&&Sf(e),null;case 13:return _x(t,e,n);case 4:return cp(e,e.stateNode.containerInfo),i=e.pendingProps,t===null?e.child=js(e,null,i,n):gn(t,e,i,n),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:oi(i,r),C0(t,e,i,r,n);case 7:return gn(t,e,e.pendingProps,n),e.child;case 8:return gn(t,e,e.pendingProps.children,n),e.child;case 12:return gn(t,e,e.pendingProps.children,n),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,_t(bc,i._currentValue),i._currentValue=o,s!==null)if(hi(s.value,o)){if(s.children===r.children&&!bn.current){e=Zi(t,e,n);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=Wi(-1,n&-n),l.tag=2;var c=s.updateQueue;if(c!==null){c=c.shared;var d=c.pending;d===null?l.next=l:(l.next=d.next,d.next=l),c.pending=l}}s.lanes|=n,l=s.alternate,l!==null&&(l.lanes|=n),Mf(s.return,n,e),a.lanes|=n;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(re(341));o.lanes|=n,a=o.alternate,a!==null&&(a.lanes|=n),Mf(o,n,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}gn(t,e,r.children,n),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,Ys(e,n),r=Jn(r),i=i(r),e.flags|=1,gn(t,e,i,n),e.child;case 14:return i=e.type,r=oi(i,e.pendingProps),r=oi(i.type,r),R0(t,e,i,r,n);case 15:return mx(t,e,e.type,e.pendingProps,n);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:oi(i,r),lc(t,e),e.tag=1,Tn(i)?(t=!0,Mc(e)):t=!1,Ys(e,n),dx(e,i,r),wf(e,i,r,n),Af(null,e,i,!0,t,n);case 19:return yx(t,e,n);case 22:return gx(t,e,n)}throw Error(re(156,e.tag))};function Fx(t,e){return cv(t,e)}function g1(t,e,n,i){this.tag=t,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Zn(t,e,n,i){return new g1(t,e,n,i)}function wp(t){return t=t.prototype,!(!t||!t.isReactComponent)}function v1(t){if(typeof t=="function")return wp(t)?1:0;if(t!=null){if(t=t.$$typeof,t===Hf)return 11;if(t===Wf)return 14}return 2}function br(t,e){var n=t.alternate;return n===null?(n=Zn(t.tag,e,t.key,t.mode),n.elementType=t.elementType,n.type=t.type,n.stateNode=t.stateNode,n.alternate=t,t.alternate=n):(n.pendingProps=e,n.type=t.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=t.flags&14680064,n.childLanes=t.childLanes,n.lanes=t.lanes,n.child=t.child,n.memoizedProps=t.memoizedProps,n.memoizedState=t.memoizedState,n.updateQueue=t.updateQueue,e=t.dependencies,n.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},n.sibling=t.sibling,n.index=t.index,n.ref=t.ref,n}function hc(t,e,n,i,r,s){var o=2;if(i=t,typeof t=="function")wp(t)&&(o=1);else if(typeof t=="string")o=5;else e:switch(t){case Ls:return rs(n.children,r,s,e);case Gf:o=8,r|=8;break;case Yd:return t=Zn(12,n,e,r|2),t.elementType=Yd,t.lanes=s,t;case Zd:return t=Zn(13,n,e,r),t.elementType=Zd,t.lanes=s,t;case $d:return t=Zn(19,n,e,r),t.elementType=$d,t.lanes=s,t;case q0:return qc(n,r,s,e);default:if(typeof t=="object"&&t!==null)switch(t.$$typeof){case W0:o=10;break e;case X0:o=9;break e;case Hf:o=11;break e;case Wf:o=14;break e;case dr:o=16,i=null;break e}throw Error(re(130,t==null?t:typeof t,""))}return e=Zn(o,n,e,r),e.elementType=t,e.type=i,e.lanes=s,e}function rs(t,e,n,i){return t=Zn(7,t,i,e),t.lanes=n,t}function qc(t,e,n,i){return t=Zn(22,t,i,e),t.elementType=q0,t.lanes=n,t.stateNode={isHidden:!1},t}function Wd(t,e,n){return t=Zn(6,t,null,e),t.lanes=n,t}function Xd(t,e,n){return e=Zn(4,t.children!==null?t.children:[],t.key,e),e.lanes=n,e.stateNode={containerInfo:t.containerInfo,pendingChildren:null,implementation:t.implementation},e}function x1(t,e,n,i,r){this.tag=e,this.containerInfo=t,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=Cd(0),this.expirationTimes=Cd(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=Cd(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function bp(t,e,n,i,r,s,o,a,l){return t=new x1(t,e,n,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=Zn(3,null,null,e),t.current=s,s.stateNode=t,s.memoizedState={element:i,isDehydrated:n,cache:null,transitions:null,pendingSuspenseBoundaries:null},lp(s),t}function _1(t,e,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:Is,key:i==null?null:""+i,children:t,containerInfo:e,implementation:n}}function Ox(t){if(!t)return Ar;t=t._reactInternals;e:{if(hs(t)!==t||t.tag!==1)throw Error(re(170));var e=t;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(Tn(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(re(171))}if(t.tag===1){var n=t.type;if(Tn(n))return Ov(t,n,e)}return e}function Bx(t,e,n,i,r,s,o,a,l){return t=bp(n,i,!0,t,r,s,o,a,l),t.context=Ox(null),n=t.current,i=vn(),r=wr(n),s=Wi(i,r),s.callback=e??null,Mr(n,s,r),t.current.lanes=r,ba(t,r,i),An(t,i),t}function Yc(t,e,n,i){var r=e.current,s=vn(),o=wr(r);return n=Ox(n),e.context===null?e.context=n:e.pendingContext=n,e=Wi(s,o),e.payload={element:t},i=i===void 0?null:i,i!==null&&(e.callback=i),t=Mr(r,e,o),t!==null&&(ui(t,r,o,s),sc(t,r,o)),o}function Uc(t){if(t=t.current,!t.child)return null;switch(t.child.tag){case 5:return t.child.stateNode;default:return t.child.stateNode}}function V0(t,e){if(t=t.memoizedState,t!==null&&t.dehydrated!==null){var n=t.retryLane;t.retryLane=n!==0&&n<e?n:e}}function Tp(t,e){V0(t,e),(t=t.alternate)&&V0(t,e)}function y1(){return null}var kx=typeof reportError=="function"?reportError:function(t){console.error(t)};function Ap(t){this._internalRoot=t}Zc.prototype.render=Ap.prototype.render=function(t){var e=this._internalRoot;if(e===null)throw Error(re(409));Yc(t,e,null,null)};Zc.prototype.unmount=Ap.prototype.unmount=function(){var t=this._internalRoot;if(t!==null){this._internalRoot=null;var e=t.containerInfo;cs(function(){Yc(null,t,null,null)}),e[qi]=null}};function Zc(t){this._internalRoot=t}Zc.prototype.unstable_scheduleHydration=function(t){if(t){var e=gv();t={blockedOn:null,target:t,priority:e};for(var n=0;n<pr.length&&e!==0&&e<pr[n].priority;n++);pr.splice(n,0,t),n===0&&xv(t)}};function Cp(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)}function $c(t){return!(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11&&(t.nodeType!==8||t.nodeValue!==" react-mount-point-unstable "))}function G0(){}function S1(t,e,n,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var c=Uc(o);s.call(c)}}var o=Bx(e,i,t,0,null,!1,!1,"",G0);return t._reactRootContainer=o,t[qi]=o.current,ga(t.nodeType===8?t.parentNode:t),cs(),o}for(;r=t.lastChild;)t.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var c=Uc(l);a.call(c)}}var l=bp(t,0,!1,null,null,!1,!1,"",G0);return t._reactRootContainer=l,t[qi]=l.current,ga(t.nodeType===8?t.parentNode:t),cs(function(){Yc(e,l,n,i)}),l}function Jc(t,e,n,i,r){var s=n._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=Uc(o);a.call(l)}}Yc(e,o,t,r)}else o=S1(n,e,t,r,i);return Uc(o)}pv=function(t){switch(t.tag){case 3:var e=t.stateNode;if(e.current.memoizedState.isDehydrated){var n=Ko(e.pendingLanes);n!==0&&(Yf(e,n|1),An(e,Ot()),!(nt&6)&&(to=Ot()+500,Pr()))}break;case 13:cs(function(){var i=Yi(t,1);if(i!==null){var r=vn();ui(i,t,1,r)}}),Tp(t,1)}};Zf=function(t){if(t.tag===13){var e=Yi(t,134217728);if(e!==null){var n=vn();ui(e,t,134217728,n)}Tp(t,134217728)}};mv=function(t){if(t.tag===13){var e=wr(t),n=Yi(t,e);if(n!==null){var i=vn();ui(n,t,e,i)}Tp(t,e)}};gv=function(){return ht};vv=function(t,e){var n=ht;try{return ht=t,e()}finally{ht=n}};of=function(t,e,n){switch(e){case"input":if(jd(t,n),e=n.name,n.type==="radio"&&e!=null){for(n=t;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<n.length;e++){var i=n[e];if(i!==t&&i.form===t.form){var r=zc(i);if(!r)throw Error(re(90));Z0(i),jd(i,r)}}}break;case"textarea":J0(t,n);break;case"select":e=n.value,e!=null&&Hs(t,!!n.multiple,e,!1)}};iv=Sp;rv=cs;var M1={usingClientEntryPoint:!1,Events:[Aa,Fs,zc,tv,nv,Sp]},Yo={findFiberByHostInstance:es,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},E1={bundleType:Yo.bundleType,version:Yo.version,rendererPackageName:Yo.rendererPackageName,rendererConfig:Yo.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:$i.ReactCurrentDispatcher,findHostInstanceByFiber:function(t){return t=av(t),t===null?null:t.stateNode},findFiberByHostInstance:Yo.findFiberByHostInstance||y1,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(Zo=__REACT_DEVTOOLS_GLOBAL_HOOK__,!Zo.isDisabled&&Zo.supportsFiber))try{Fc=Zo.inject(E1),wi=Zo}catch{}var Zo;On.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=M1;On.createPortal=function(t,e){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!Cp(e))throw Error(re(200));return _1(t,e,null,n)};On.createRoot=function(t,e){if(!Cp(t))throw Error(re(299));var n=!1,i="",r=kx;return e!=null&&(e.unstable_strictMode===!0&&(n=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=bp(t,1,!1,null,null,n,!1,i,r),t[qi]=e.current,ga(t.nodeType===8?t.parentNode:t),new Ap(e)};On.findDOMNode=function(t){if(t==null)return null;if(t.nodeType===1)return t;var e=t._reactInternals;if(e===void 0)throw typeof t.render=="function"?Error(re(188)):(t=Object.keys(t).join(","),Error(re(268,t)));return t=av(e),t=t===null?null:t.stateNode,t};On.flushSync=function(t){return cs(t)};On.hydrate=function(t,e,n){if(!$c(e))throw Error(re(200));return Jc(null,t,e,!0,n)};On.hydrateRoot=function(t,e,n){if(!Cp(t))throw Error(re(405));var i=n!=null&&n.hydratedSources||null,r=!1,s="",o=kx;if(n!=null&&(n.unstable_strictMode===!0&&(r=!0),n.identifierPrefix!==void 0&&(s=n.identifierPrefix),n.onRecoverableError!==void 0&&(o=n.onRecoverableError)),e=Bx(e,null,t,1,n??null,r,!1,s,o),t[qi]=e.current,ga(t),i)for(t=0;t<i.length;t++)n=i[t],r=n._getVersion,r=r(n._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[n,r]:e.mutableSourceEagerHydrationData.push(n,r);return new Zc(e)};On.render=function(t,e,n){if(!$c(e))throw Error(re(200));return Jc(null,t,e,!1,n)};On.unmountComponentAtNode=function(t){if(!$c(t))throw Error(re(40));return t._reactRootContainer?(cs(function(){Jc(null,null,t,!1,function(){t._reactRootContainer=null,t[qi]=null})}),!0):!1};On.unstable_batchedUpdates=Sp;On.unstable_renderSubtreeIntoContainer=function(t,e,n,i){if(!$c(n))throw Error(re(200));if(t==null||t._reactInternals===void 0)throw Error(re(38));return Jc(t,e,n,!1,i)};On.version="18.3.1-next-f1338f8080-20240426"});var Hx=ki((GC,Gx)=>{"use strict";function Vx(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Vx)}catch(t){console.error(t)}}Vx(),Gx.exports=zx()});var Xx=ki(Rp=>{"use strict";var Wx=Hx();Rp.createRoot=Wx.createRoot,Rp.hydrateRoot=Wx.hydrateRoot;var HC});var Ly=ki(sd=>{"use strict";var mC=Il(),gC=Symbol.for("react.element"),vC=Symbol.for("react.fragment"),xC=Object.prototype.hasOwnProperty,_C=mC.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,yC={key:!0,ref:!0,__self:!0,__source:!0};function Iy(t,e,n){var i,r={},s=null,o=null;n!==void 0&&(s=""+n),e.key!==void 0&&(s=""+e.key),e.ref!==void 0&&(o=e.ref);for(i in e)xC.call(e,i)&&!yC.hasOwnProperty(i)&&(r[i]=e[i]);if(t&&t.defaultProps)for(i in e=t.defaultProps,e)r[i]===void 0&&(r[i]=e[i]);return{$$typeof:gC,type:t,key:s,ref:o,props:r,_owner:_C.current}}sd.Fragment=vC;sd.jsx=Iy;sd.jsxs=Iy});var ig=ki((dP,Ny)=>{"use strict";Ny.exports=Ly()});var rt=Al(Il()),By=Al(Xx());var ah="184";var x_=0,hm=1,__=2;var ul=1,lh=2,Co=3,nr=0,Wt=1,Di=2,Ui=0,vs=1,dm=2,fm=3,pm=4,y_=5;var Br=100,S_=101,M_=102,E_=103,w_=104,b_=200,T_=201,A_=202,C_=203,_u=204,yu=205,R_=206,P_=207,I_=208,L_=209,N_=210,D_=211,U_=212,F_=213,O_=214,Su=0,Mu=1,Eu=2,xs=3,wu=4,bu=5,Tu=6,Au=7,ch=0,B_=1,k_=2,gi=0,mm=1,gm=2,vm=3,hl=4,xm=5,_m=6,ym=7;var Sm=300,Xr=301,Ss=302,uh=303,hh=304,dl=306,Cu=1e3,Ci=1001,Ru=1002,Kt=1003,z_=1004;var fl=1005;var rn=1006,dh=1007;var qr=1008;var Pn=1009,Mm=1010,Em=1011,Ro=1012,fh=1013,vi=1014,ti=1015,Fi=1016,ph=1017,mh=1018,Po=1020,wm=35902,bm=35899,Tm=1021,Am=1022,ni=1023,Ri=1026,Yr=1027,gh=1028,vh=1029,Zr=1030,xh=1031;var _h=1033,pl=33776,ml=33777,gl=33778,vl=33779,yh=35840,Sh=35841,Mh=35842,Eh=35843,wh=36196,bh=37492,Th=37496,Ah=37488,Ch=37489,xl=37490,Rh=37491,Ph=37808,Ih=37809,Lh=37810,Nh=37811,Dh=37812,Uh=37813,Fh=37814,Oh=37815,Bh=37816,kh=37817,zh=37818,Vh=37819,Gh=37820,Hh=37821,Wh=36492,Xh=36494,qh=36495,Yh=36283,Zh=36284,_l=36285,$h=36286;var ka=2300,Pu=2301,xu=2302,tm=2303,nm=2400,im=2401,rm=2402;var V_=3200;var yl=0,G_=1,or="",yn="srgb",za="srgb-linear",Va="linear",ut="srgb";var gs=7680;var sm=519,H_=512,W_=513,X_=514,Jh=515,q_=516,Y_=517,Kh=518,Z_=519,om=35044;var Cm="300 es",mi=2e3,yo=2001;function w1(t){for(let e=t.length-1;e>=0;--e)if(t[e]>=65535)return!0;return!1}function b1(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function Ga(t){return document.createElementNS("http://www.w3.org/1999/xhtml",t)}function $_(){let t=Ga("canvas");return t.style.display="block",t}var qx={},So=null;function Rm(...t){let e="THREE."+t.shift();So?So("log",e,...t):console.log(e,...t)}function J_(t){let e=t[0];if(typeof e=="string"&&e.startsWith("TSL:")){let n=t[1];n&&n.isStackTrace?t[0]+=" "+n.getLocation():t[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return t}function Fe(...t){t=J_(t);let e="THREE."+t.shift();if(So)So("warn",e,...t);else{let n=t[0];n&&n.isStackTrace?console.warn(n.getError(e)):console.warn(e,...t)}}function Be(...t){t=J_(t);let e="THREE."+t.shift();if(So)So("error",e,...t);else{let n=t[0];n&&n.isStackTrace?console.error(n.getError(e)):console.error(e,...t)}}function Iu(...t){let e=t.join(" ");e in qx||(qx[e]=!0,Fe(...t))}function K_(t,e,n){return new Promise(function(i,r){function s(){switch(t.clientWaitSync(e,t.SYNC_FLUSH_COMMANDS_BIT,0)){case t.WAIT_FAILED:r();break;case t.TIMEOUT_EXPIRED:setTimeout(s,n);break;default:i()}}setTimeout(s,n)})}var j_={[Su]:Mu,[Eu]:Tu,[wu]:Au,[xs]:bu,[Mu]:Su,[Tu]:Eu,[Au]:wu,[bu]:xs},Pi=class{addEventListener(e,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(n)===-1&&i[e].push(n)}hasEventListener(e,n){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(n)!==-1}removeEventListener(e,n){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(n);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let n=this._listeners;if(n===void 0)return;let i=n[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},hn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Yx=1234567,Ua=Math.PI/180,Mo=180/Math.PI;function Io(){let t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(hn[t&255]+hn[t>>8&255]+hn[t>>16&255]+hn[t>>24&255]+"-"+hn[e&255]+hn[e>>8&255]+"-"+hn[e>>16&15|64]+hn[e>>24&255]+"-"+hn[n&63|128]+hn[n>>8&255]+"-"+hn[n>>16&255]+hn[n>>24&255]+hn[i&255]+hn[i>>8&255]+hn[i>>16&255]+hn[i>>24&255]).toLowerCase()}function Ze(t,e,n){return Math.max(e,Math.min(n,t))}function Pm(t,e){return(t%e+e)%e}function T1(t,e,n,i,r){return i+(t-e)*(r-i)/(n-e)}function A1(t,e,n){return t!==e?(n-t)/(e-t):0}function Fa(t,e,n){return(1-n)*t+n*e}function C1(t,e,n,i){return Fa(t,e,1-Math.exp(-n*i))}function R1(t,e=1){return e-Math.abs(Pm(t,e*2)-e)}function P1(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*(3-2*t))}function I1(t,e,n){return t<=e?0:t>=n?1:(t=(t-e)/(n-e),t*t*t*(t*(t*6-15)+10))}function L1(t,e){return t+Math.floor(Math.random()*(e-t+1))}function N1(t,e){return t+Math.random()*(e-t)}function D1(t){return t*(.5-Math.random())}function U1(t){t!==void 0&&(Yx=t);let e=Yx+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function F1(t){return t*Ua}function O1(t){return t*Mo}function B1(t){return(t&t-1)===0&&t!==0}function k1(t){return Math.pow(2,Math.ceil(Math.log(t)/Math.LN2))}function z1(t){return Math.pow(2,Math.floor(Math.log(t)/Math.LN2))}function V1(t,e,n,i,r){let s=Math.cos,o=Math.sin,a=s(n/2),l=o(n/2),c=s((e+i)/2),d=o((e+i)/2),f=s((e-i)/2),u=o((e-i)/2),p=s((i-e)/2),x=o((i-e)/2);switch(r){case"XYX":t.set(a*d,l*f,l*u,a*c);break;case"YZY":t.set(l*u,a*d,l*f,a*c);break;case"ZXZ":t.set(l*f,l*u,a*d,a*c);break;case"XZX":t.set(a*d,l*x,l*p,a*c);break;case"YXY":t.set(l*p,a*d,l*x,a*c);break;case"ZYZ":t.set(l*x,l*p,a*d,a*c);break;default:Fe("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+r)}}function xo(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return t/4294967295;case Uint16Array:return t/65535;case Uint8Array:return t/255;case Int32Array:return Math.max(t/2147483647,-1);case Int16Array:return Math.max(t/32767,-1);case Int8Array:return Math.max(t/127,-1);default:throw new Error("Invalid component type.")}}function _n(t,e){switch(e.constructor){case Float32Array:return t;case Uint32Array:return Math.round(t*4294967295);case Uint16Array:return Math.round(t*65535);case Uint8Array:return Math.round(t*255);case Int32Array:return Math.round(t*2147483647);case Int16Array:return Math.round(t*32767);case Int8Array:return Math.round(t*127);default:throw new Error("Invalid component type.")}}var Im={DEG2RAD:Ua,RAD2DEG:Mo,generateUUID:Io,clamp:Ze,euclideanModulo:Pm,mapLinear:T1,inverseLerp:A1,lerp:Fa,damp:C1,pingpong:R1,smoothstep:P1,smootherstep:I1,randInt:L1,randFloat:N1,randFloatSpread:D1,seededRandom:U1,degToRad:F1,radToDeg:O1,isPowerOfTwo:B1,ceilPowerOfTwo:k1,floorPowerOfTwo:z1,setQuaternionFromProperEuler:V1,normalize:_n,denormalize:xo},Om=class Om{constructor(e=0,n=0){this.x=e,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,n){return this.x=e,this.y=n,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let n=this.x,i=this.y,r=e.elements;return this.x=r[0]*n+r[3]*i+r[6],this.y=r[1]*n+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,n){return this.x=Ze(this.x,e.x,n.x),this.y=Ze(this.y,e.y,n.y),this}clampScalar(e,n){return this.x=Ze(this.x,e,n),this.y=Ze(this.y,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ze(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Ze(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y;return n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this}rotateAround(e,n){let i=Math.cos(n),r=Math.sin(n),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};Om.prototype.isVector2=!0;var Ue=Om,Ii=class{constructor(e=0,n=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=n,this._z=i,this._w=r}static slerpFlat(e,n,i,r,s,o,a){let l=i[r+0],c=i[r+1],d=i[r+2],f=i[r+3],u=s[o+0],p=s[o+1],x=s[o+2],S=s[o+3];if(f!==S||l!==u||c!==p||d!==x){let v=l*u+c*p+d*x+f*S;v<0&&(u=-u,p=-p,x=-x,S=-S,v=-v);let h=1-a;if(v<.9995){let g=Math.acos(v),_=Math.sin(g);h=Math.sin(h*g)/_,a=Math.sin(a*g)/_,l=l*h+u*a,c=c*h+p*a,d=d*h+x*a,f=f*h+S*a}else{l=l*h+u*a,c=c*h+p*a,d=d*h+x*a,f=f*h+S*a;let g=1/Math.sqrt(l*l+c*c+d*d+f*f);l*=g,c*=g,d*=g,f*=g}}e[n]=l,e[n+1]=c,e[n+2]=d,e[n+3]=f}static multiplyQuaternionsFlat(e,n,i,r,s,o){let a=i[r],l=i[r+1],c=i[r+2],d=i[r+3],f=s[o],u=s[o+1],p=s[o+2],x=s[o+3];return e[n]=a*x+d*f+l*p-c*u,e[n+1]=l*x+d*u+c*f-a*p,e[n+2]=c*x+d*p+a*u-l*f,e[n+3]=d*x-a*f-l*u-c*p,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,n,i,r){return this._x=e,this._y=n,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,n=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(i/2),d=a(r/2),f=a(s/2),u=l(i/2),p=l(r/2),x=l(s/2);switch(o){case"XYZ":this._x=u*d*f+c*p*x,this._y=c*p*f-u*d*x,this._z=c*d*x+u*p*f,this._w=c*d*f-u*p*x;break;case"YXZ":this._x=u*d*f+c*p*x,this._y=c*p*f-u*d*x,this._z=c*d*x-u*p*f,this._w=c*d*f+u*p*x;break;case"ZXY":this._x=u*d*f-c*p*x,this._y=c*p*f+u*d*x,this._z=c*d*x+u*p*f,this._w=c*d*f-u*p*x;break;case"ZYX":this._x=u*d*f-c*p*x,this._y=c*p*f+u*d*x,this._z=c*d*x-u*p*f,this._w=c*d*f+u*p*x;break;case"YZX":this._x=u*d*f+c*p*x,this._y=c*p*f+u*d*x,this._z=c*d*x-u*p*f,this._w=c*d*f-u*p*x;break;case"XZY":this._x=u*d*f-c*p*x,this._y=c*p*f-u*d*x,this._z=c*d*x+u*p*f,this._w=c*d*f+u*p*x;break;default:Fe("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,n){let i=n/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let n=e.elements,i=n[0],r=n[4],s=n[8],o=n[1],a=n[5],l=n[9],c=n[2],d=n[6],f=n[10],u=i+a+f;if(u>0){let p=.5/Math.sqrt(u+1);this._w=.25/p,this._x=(d-l)*p,this._y=(s-c)*p,this._z=(o-r)*p}else if(i>a&&i>f){let p=2*Math.sqrt(1+i-a-f);this._w=(d-l)/p,this._x=.25*p,this._y=(r+o)/p,this._z=(s+c)/p}else if(a>f){let p=2*Math.sqrt(1+a-i-f);this._w=(s-c)/p,this._x=(r+o)/p,this._y=.25*p,this._z=(l+d)/p}else{let p=2*Math.sqrt(1+f-i-a);this._w=(o-r)/p,this._x=(s+c)/p,this._y=(l+d)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(e,n){let i=e.dot(n)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*n.z-e.z*n.y,this._y=e.z*n.x-e.x*n.z,this._z=e.x*n.y-e.y*n.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ze(this.dot(e),-1,1)))}rotateTowards(e,n){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,n/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=n._x,l=n._y,c=n._z,d=n._w;return this._x=i*d+o*a+r*c-s*l,this._y=r*d+o*l+s*a-i*c,this._z=s*d+o*c+i*l-r*a,this._w=o*d-i*a-r*l-s*c,this._onChangeCallback(),this}slerp(e,n){let i=e._x,r=e._y,s=e._z,o=e._w,a=this.dot(e);a<0&&(i=-i,r=-r,s=-s,o=-o,a=-a);let l=1-n;if(a<.9995){let c=Math.acos(a),d=Math.sin(c);l=Math.sin(l*c)/d,n=Math.sin(n*c)/d,this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this._onChangeCallback()}else this._x=this._x*l+i*n,this._y=this._y*l+r*n,this._z=this._z*l+s*n,this._w=this._w*l+o*n,this.normalize();return this}slerpQuaternions(e,n,i){return this.copy(e).slerp(n,i)}random(){let e=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(n),s*Math.cos(n))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,n=0){return this._x=e[n],this._y=e[n+1],this._z=e[n+2],this._w=e[n+3],this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._w,e}fromBufferAttribute(e,n){return this._x=e.getX(n),this._y=e.getY(n),this._z=e.getZ(n),this._w=e.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},Bm=class Bm{constructor(e=0,n=0,i=0){this.x=e,this.y=n,this.z=i}set(e,n,i){return i===void 0&&(i=this.z),this.x=e,this.y=n,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,n){return this.x=e.x*n.x,this.y=e.y*n.y,this.z=e.z*n.z,this}applyEuler(e){return this.applyQuaternion(Zx.setFromEuler(e))}applyAxisAngle(e,n){return this.applyQuaternion(Zx.setFromAxisAngle(e,n))}applyMatrix3(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[3]*i+s[6]*r,this.y=s[1]*n+s[4]*i+s[7]*r,this.z=s[2]*n+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*n+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*n+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*n+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*n+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let n=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*r-a*i),d=2*(a*n-s*r),f=2*(s*i-o*n);return this.x=n+l*c+o*f-a*d,this.y=i+l*d+a*c-s*f,this.z=r+l*f+s*d-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let n=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*n+s[4]*i+s[8]*r,this.y=s[1]*n+s[5]*i+s[9]*r,this.z=s[2]*n+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,n){return this.x=Ze(this.x,e.x,n.x),this.y=Ze(this.y,e.y,n.y),this.z=Ze(this.z,e.z,n.z),this}clampScalar(e,n){return this.x=Ze(this.x,e,n),this.y=Ze(this.y,e,n),this.z=Ze(this.z,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ze(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,n){let i=e.x,r=e.y,s=e.z,o=n.x,a=n.y,l=n.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let n=e.lengthSq();if(n===0)return this.set(0,0,0);let i=e.dot(this)/n;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return Pp.copy(this).projectOnVector(e),this.sub(Pp)}reflect(e){return this.sub(Pp.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let n=Math.sqrt(this.lengthSq()*e.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(e)/n;return Math.acos(Ze(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let n=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return n*n+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,n,i){let r=Math.sin(n)*e;return this.x=r*Math.sin(i),this.y=Math.cos(n)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,n,i){return this.x=e*Math.sin(n),this.y=i,this.z=e*Math.cos(n),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(e){let n=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=n,this.y=i,this.z=r,this}setFromMatrixColumn(e,n){return this.fromArray(e.elements,n*4)}setFromMatrix3Column(e,n){return this.fromArray(e.elements,n*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(e),this.y=n,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};Bm.prototype.isVector3=!0;var D=Bm,Pp=new D,Zx=new Ii,km=class km{constructor(e,n,i,r,s,o,a,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c)}set(e,n,i,r,s,o,a,l,c){let d=this.elements;return d[0]=e,d[1]=r,d[2]=a,d[3]=n,d[4]=s,d[5]=l,d[6]=i,d[7]=o,d[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(e,n,i){return e.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let n=e.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[3],l=i[6],c=i[1],d=i[4],f=i[7],u=i[2],p=i[5],x=i[8],S=r[0],v=r[3],h=r[6],g=r[1],_=r[4],M=r[7],C=r[2],b=r[5],R=r[8];return s[0]=o*S+a*g+l*C,s[3]=o*v+a*_+l*b,s[6]=o*h+a*M+l*R,s[1]=c*S+d*g+f*C,s[4]=c*v+d*_+f*b,s[7]=c*h+d*M+f*R,s[2]=u*S+p*g+x*C,s[5]=u*v+p*_+x*b,s[8]=u*h+p*M+x*R,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[3]*=e,n[6]*=e,n[1]*=e,n[4]*=e,n[7]*=e,n[2]*=e,n[5]*=e,n[8]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8];return n*o*d-n*a*c-i*s*d+i*a*l+r*s*c-r*o*l}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=d*o-a*c,u=a*l-d*s,p=c*s-o*l,x=n*f+i*u+r*p;if(x===0)return this.set(0,0,0,0,0,0,0,0,0);let S=1/x;return e[0]=f*S,e[1]=(r*c-d*i)*S,e[2]=(a*i-r*o)*S,e[3]=u*S,e[4]=(d*n-r*l)*S,e[5]=(r*s-a*n)*S,e[6]=p*S,e[7]=(i*l-c*n)*S,e[8]=(o*n-i*s)*S,this}transpose(){let e,n=this.elements;return e=n[1],n[1]=n[3],n[3]=e,e=n[2],n[2]=n[6],n[6]=e,e=n[5],n[5]=n[7],n[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let n=this.elements;return e[0]=n[0],e[1]=n[3],e[2]=n[6],e[3]=n[1],e[4]=n[4],e[5]=n[7],e[6]=n[2],e[7]=n[5],e[8]=n[8],this}setUvTransform(e,n,i,r,s,o,a){let l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*o+c*a)+o+e,-r*c,r*l,-r*(-c*o+l*a)+a+n,0,0,1),this}scale(e,n){return this.premultiply(Ip.makeScale(e,n)),this}rotate(e){return this.premultiply(Ip.makeRotation(-e)),this}translate(e,n){return this.premultiply(Ip.makeTranslation(e,n)),this}makeTranslation(e,n){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,n,0,0,1),this}makeRotation(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(e,n){return this.set(e,0,0,0,n,0,0,0,1),this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<9;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<9;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}};km.prototype.isMatrix3=!0;var ze=km,Ip=new ze,$x=new ze().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Jx=new ze().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function G1(){let t={enabled:!0,workingColorSpace:za,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===ut&&(r.r=tr(r.r),r.g=tr(r.g),r.b=tr(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===ut&&(r.r=_o(r.r),r.g=_o(r.g),r.b=_o(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===or?Va:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return Iu("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),t.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return Iu("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),t.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return t.define({[za]:{primaries:e,whitePoint:i,transfer:Va,toXYZ:$x,fromXYZ:Jx,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:yn},outputColorSpaceConfig:{drawingBufferColorSpace:yn}},[yn]:{primaries:e,whitePoint:i,transfer:ut,toXYZ:$x,fromXYZ:Jx,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:yn}}}),t}var je=G1();function tr(t){return t<.04045?t*.0773993808:Math.pow(t*.9478672986+.0521327014,2.4)}function _o(t){return t<.0031308?t*12.92:1.055*Math.pow(t,.41666)-.055}var ro,Lu=class{static getDataURL(e,n="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{ro===void 0&&(ro=Ga("canvas")),ro.width=e.width,ro.height=e.height;let r=ro.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=ro}return i.toDataURL(n)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let n=Ga("canvas");n.width=e.width,n.height=e.height;let i=n.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=tr(s[o]/255)*255;return i.putImageData(r,0,0),n}else if(e.data){let n=e.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor(tr(n[i]/255)*255):n[i]=tr(n[i]);return{data:n,width:e.width,height:e.height}}else return Fe("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},H1=0,Eo=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:H1++}),this.uuid=Io(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?e.set(n.videoWidth,n.videoHeight,0):typeof VideoFrame<"u"&&n instanceof VideoFrame?e.set(n.displayWidth,n.displayHeight,0):n!==null?e.set(n.width,n.height,n.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(Lp(r[o].image)):s.push(Lp(r[o]))}else s=Lp(r);i.url=s}return n||(e.images[this.uuid]=i),i}};function Lp(t){return typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap?Lu.getDataURL(t):t.data?{data:Array.from(t.data),width:t.width,height:t.height,type:t.data.constructor.name}:(Fe("Texture: Unable to serialize Texture."),{})}var W1=0,Np=new D,Cn=class t extends Pi{constructor(e=t.DEFAULT_IMAGE,n=t.DEFAULT_MAPPING,i=Ci,r=Ci,s=rn,o=qr,a=ni,l=Pn,c=t.DEFAULT_ANISOTROPY,d=or){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:W1++}),this.uuid=Io(),this.name="",this.source=new Eo(e),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Ue(0,0),this.repeat=new Ue(1,1),this.center=new Ue(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new ze,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=d,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Np).x}get height(){return this.source.getSize(Np).y}get depth(){return this.source.getSize(Np).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let n in e){let i=e[n];if(i===void 0){Fe(`Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Fe(`Texture.setValues(): property '${n}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";if(!n&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Sm)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Cu:e.x=e.x-Math.floor(e.x);break;case Ci:e.x=e.x<0?0:1;break;case Ru:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Cu:e.y=e.y-Math.floor(e.y);break;case Ci:e.y=e.y<0?0:1;break;case Ru:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Cn.DEFAULT_IMAGE=null;Cn.DEFAULT_MAPPING=Sm;Cn.DEFAULT_ANISOTROPY=1;var zm=class zm{constructor(e=0,n=0,i=0,r=1){this.x=e,this.y=n,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,n,i,r){return this.x=e,this.y=n,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,n){switch(e){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,n){return this.x=e.x+n.x,this.y=e.y+n.y,this.z=e.z+n.z,this.w=e.w+n.w,this}addScaledVector(e,n){return this.x+=e.x*n,this.y+=e.y*n,this.z+=e.z*n,this.w+=e.w*n,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,n){return this.x=e.x-n.x,this.y=e.y-n.y,this.z=e.z-n.z,this.w=e.w-n.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let n=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*n+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*n+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*n+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*n+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let n=Math.sqrt(1-e.w*e.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/n,this.y=e.y/n,this.z=e.z/n),this}setAxisAngleFromRotationMatrix(e){let n,i,r,s,l=e.elements,c=l[0],d=l[4],f=l[8],u=l[1],p=l[5],x=l[9],S=l[2],v=l[6],h=l[10];if(Math.abs(d-u)<.01&&Math.abs(f-S)<.01&&Math.abs(x-v)<.01){if(Math.abs(d+u)<.1&&Math.abs(f+S)<.1&&Math.abs(x+v)<.1&&Math.abs(c+p+h-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let _=(c+1)/2,M=(p+1)/2,C=(h+1)/2,b=(d+u)/4,R=(f+S)/4,m=(x+v)/4;return _>M&&_>C?_<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(_),r=b/i,s=R/i):M>C?M<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(M),i=b/r,s=m/r):C<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(C),i=R/s,r=m/s),this.set(i,r,s,n),this}let g=Math.sqrt((v-x)*(v-x)+(f-S)*(f-S)+(u-d)*(u-d));return Math.abs(g)<.001&&(g=1),this.x=(v-x)/g,this.y=(f-S)/g,this.z=(u-d)/g,this.w=Math.acos((c+p+h-1)/2),this}setFromMatrixPosition(e){let n=e.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,n){return this.x=Ze(this.x,e.x,n.x),this.y=Ze(this.y,e.y,n.y),this.z=Ze(this.z,e.z,n.z),this.w=Ze(this.w,e.w,n.w),this}clampScalar(e,n){return this.x=Ze(this.x,e,n),this.y=Ze(this.y,e,n),this.z=Ze(this.z,e,n),this.w=Ze(this.w,e,n),this}clampLength(e,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ze(i,e,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,n){return this.x+=(e.x-this.x)*n,this.y+=(e.y-this.y)*n,this.z+=(e.z-this.z)*n,this.w+=(e.w-this.w)*n,this}lerpVectors(e,n,i){return this.x=e.x+(n.x-e.x)*i,this.y=e.y+(n.y-e.y)*i,this.z=e.z+(n.z-e.z)*i,this.w=e.w+(n.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,n=0){return this.x=e[n],this.y=e[n+1],this.z=e[n+2],this.w=e[n+3],this}toArray(e=[],n=0){return e[n]=this.x,e[n+1]=this.y,e[n+2]=this.z,e[n+3]=this.w,e}fromBufferAttribute(e,n){return this.x=e.getX(n),this.y=e.getY(n),this.z=e.getZ(n),this.w=e.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};zm.prototype.isVector4=!0;var It=zm,Nu=class extends Pi{constructor(e=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:rn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=n,this.depth=i.depth,this.scissor=new It(0,0,e,n),this.scissorTest=!1,this.viewport=new It(0,0,e,n),this.textures=[];let r={width:e,height:n,depth:i.depth},s=new Cn(r),o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let n={minFilter:rn,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(n.mapping=e.mapping),e.wrapS!==void 0&&(n.wrapS=e.wrapS),e.wrapT!==void 0&&(n.wrapT=e.wrapT),e.wrapR!==void 0&&(n.wrapR=e.wrapR),e.magFilter!==void 0&&(n.magFilter=e.magFilter),e.minFilter!==void 0&&(n.minFilter=e.minFilter),e.format!==void 0&&(n.format=e.format),e.type!==void 0&&(n.type=e.type),e.anisotropy!==void 0&&(n.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(n.colorSpace=e.colorSpace),e.flipY!==void 0&&(n.flipY=e.flipY),e.generateMipmaps!==void 0&&(n.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(n.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,n,i=1){if(this.width!==e||this.height!==n||this.depth!==i){this.width=e,this.height=n,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=n,this.textures[r].image.depth=i,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,n),this.scissor.set(0,0,e,n)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++){this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let r=Object.assign({},e.textures[n].image);this.textures[n].source=new Eo(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},zn=class extends Nu{constructor(e=1,n=1,i={}){super(e,n,i),this.isWebGLRenderTarget=!0}},Ha=class extends Cn{constructor(e=null,n=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=Kt,this.minFilter=Kt,this.wrapR=Ci,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var Du=class extends Cn{constructor(e=null,n=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:n,height:i,depth:r},this.magFilter=Kt,this.minFilter=Kt,this.wrapR=Ci,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var oh=class oh{constructor(e,n,i,r,s,o,a,l,c,d,f,u,p,x,S,v){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,n,i,r,s,o,a,l,c,d,f,u,p,x,S,v)}set(e,n,i,r,s,o,a,l,c,d,f,u,p,x,S,v){let h=this.elements;return h[0]=e,h[4]=n,h[8]=i,h[12]=r,h[1]=s,h[5]=o,h[9]=a,h[13]=l,h[2]=c,h[6]=d,h[10]=f,h[14]=u,h[3]=p,h[7]=x,h[11]=S,h[15]=v,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new oh().fromArray(this.elements)}copy(e){let n=this.elements,i=e.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(e){let n=this.elements,i=e.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(e){let n=e.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(e,n,i){return this.determinant()===0?(e.set(1,0,0),n.set(0,1,0),i.set(0,0,1),this):(e.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(e,n,i){return this.set(e.x,n.x,i.x,0,e.y,n.y,i.y,0,e.z,n.z,i.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let n=this.elements,i=e.elements,r=1/so.setFromMatrixColumn(e,0).length(),s=1/so.setFromMatrixColumn(e,1).length(),o=1/so.setFromMatrixColumn(e,2).length();return n[0]=i[0]*r,n[1]=i[1]*r,n[2]=i[2]*r,n[3]=0,n[4]=i[4]*s,n[5]=i[5]*s,n[6]=i[6]*s,n[7]=0,n[8]=i[8]*o,n[9]=i[9]*o,n[10]=i[10]*o,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(e){let n=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),c=Math.sin(r),d=Math.cos(s),f=Math.sin(s);if(e.order==="XYZ"){let u=o*d,p=o*f,x=a*d,S=a*f;n[0]=l*d,n[4]=-l*f,n[8]=c,n[1]=p+x*c,n[5]=u-S*c,n[9]=-a*l,n[2]=S-u*c,n[6]=x+p*c,n[10]=o*l}else if(e.order==="YXZ"){let u=l*d,p=l*f,x=c*d,S=c*f;n[0]=u+S*a,n[4]=x*a-p,n[8]=o*c,n[1]=o*f,n[5]=o*d,n[9]=-a,n[2]=p*a-x,n[6]=S+u*a,n[10]=o*l}else if(e.order==="ZXY"){let u=l*d,p=l*f,x=c*d,S=c*f;n[0]=u-S*a,n[4]=-o*f,n[8]=x+p*a,n[1]=p+x*a,n[5]=o*d,n[9]=S-u*a,n[2]=-o*c,n[6]=a,n[10]=o*l}else if(e.order==="ZYX"){let u=o*d,p=o*f,x=a*d,S=a*f;n[0]=l*d,n[4]=x*c-p,n[8]=u*c+S,n[1]=l*f,n[5]=S*c+u,n[9]=p*c-x,n[2]=-c,n[6]=a*l,n[10]=o*l}else if(e.order==="YZX"){let u=o*l,p=o*c,x=a*l,S=a*c;n[0]=l*d,n[4]=S-u*f,n[8]=x*f+p,n[1]=f,n[5]=o*d,n[9]=-a*d,n[2]=-c*d,n[6]=p*f+x,n[10]=u-S*f}else if(e.order==="XZY"){let u=o*l,p=o*c,x=a*l,S=a*c;n[0]=l*d,n[4]=-f,n[8]=c*d,n[1]=u*f+S,n[5]=o*d,n[9]=p*f-x,n[2]=x*f-p,n[6]=a*d,n[10]=S*f+u}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(e){return this.compose(X1,e,q1)}lookAt(e,n,i){let r=this.elements;return Bn.subVectors(e,n),Bn.lengthSq()===0&&(Bn.z=1),Bn.normalize(),Ir.crossVectors(i,Bn),Ir.lengthSq()===0&&(Math.abs(i.z)===1?Bn.x+=1e-4:Bn.z+=1e-4,Bn.normalize(),Ir.crossVectors(i,Bn)),Ir.normalize(),Kc.crossVectors(Bn,Ir),r[0]=Ir.x,r[4]=Kc.x,r[8]=Bn.x,r[1]=Ir.y,r[5]=Kc.y,r[9]=Bn.y,r[2]=Ir.z,r[6]=Kc.z,r[10]=Bn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,n){let i=e.elements,r=n.elements,s=this.elements,o=i[0],a=i[4],l=i[8],c=i[12],d=i[1],f=i[5],u=i[9],p=i[13],x=i[2],S=i[6],v=i[10],h=i[14],g=i[3],_=i[7],M=i[11],C=i[15],b=r[0],R=r[4],m=r[8],T=r[12],I=r[1],A=r[5],P=r[9],O=r[13],z=r[2],L=r[6],B=r[10],G=r[14],q=r[3],J=r[7],j=r[11],ue=r[15];return s[0]=o*b+a*I+l*z+c*q,s[4]=o*R+a*A+l*L+c*J,s[8]=o*m+a*P+l*B+c*j,s[12]=o*T+a*O+l*G+c*ue,s[1]=d*b+f*I+u*z+p*q,s[5]=d*R+f*A+u*L+p*J,s[9]=d*m+f*P+u*B+p*j,s[13]=d*T+f*O+u*G+p*ue,s[2]=x*b+S*I+v*z+h*q,s[6]=x*R+S*A+v*L+h*J,s[10]=x*m+S*P+v*B+h*j,s[14]=x*T+S*O+v*G+h*ue,s[3]=g*b+_*I+M*z+C*q,s[7]=g*R+_*A+M*L+C*J,s[11]=g*m+_*P+M*B+C*j,s[15]=g*T+_*O+M*G+C*ue,this}multiplyScalar(e){let n=this.elements;return n[0]*=e,n[4]*=e,n[8]*=e,n[12]*=e,n[1]*=e,n[5]*=e,n[9]*=e,n[13]*=e,n[2]*=e,n[6]*=e,n[10]*=e,n[14]*=e,n[3]*=e,n[7]*=e,n[11]*=e,n[15]*=e,this}determinant(){let e=this.elements,n=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],c=e[13],d=e[2],f=e[6],u=e[10],p=e[14],x=e[3],S=e[7],v=e[11],h=e[15],g=l*p-c*u,_=a*p-c*f,M=a*u-l*f,C=o*p-c*d,b=o*u-l*d,R=o*f-a*d;return n*(S*g-v*_+h*M)-i*(x*g-v*C+h*b)+r*(x*_-S*C+h*R)-s*(x*M-S*b+v*R)}transpose(){let e=this.elements,n;return n=e[1],e[1]=e[4],e[4]=n,n=e[2],e[2]=e[8],e[8]=n,n=e[6],e[6]=e[9],e[9]=n,n=e[3],e[3]=e[12],e[12]=n,n=e[7],e[7]=e[13],e[13]=n,n=e[11],e[11]=e[14],e[14]=n,this}setPosition(e,n,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=n,r[14]=i),this}invert(){let e=this.elements,n=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=e[9],u=e[10],p=e[11],x=e[12],S=e[13],v=e[14],h=e[15],g=n*a-i*o,_=n*l-r*o,M=n*c-s*o,C=i*l-r*a,b=i*c-s*a,R=r*c-s*l,m=d*S-f*x,T=d*v-u*x,I=d*h-p*x,A=f*v-u*S,P=f*h-p*S,O=u*h-p*v,z=g*O-_*P+M*A+C*I-b*T+R*m;if(z===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let L=1/z;return e[0]=(a*O-l*P+c*A)*L,e[1]=(r*P-i*O-s*A)*L,e[2]=(S*R-v*b+h*C)*L,e[3]=(u*b-f*R-p*C)*L,e[4]=(l*I-o*O-c*T)*L,e[5]=(n*O-r*I+s*T)*L,e[6]=(v*M-x*R-h*_)*L,e[7]=(d*R-u*M+p*_)*L,e[8]=(o*P-a*I+c*m)*L,e[9]=(i*I-n*P-s*m)*L,e[10]=(x*b-S*M+h*g)*L,e[11]=(f*M-d*b-p*g)*L,e[12]=(a*T-o*A-l*m)*L,e[13]=(n*A-i*T+r*m)*L,e[14]=(S*_-x*C-v*g)*L,e[15]=(d*C-f*_+u*g)*L,this}scale(e){let n=this.elements,i=e.x,r=e.y,s=e.z;return n[0]*=i,n[4]*=r,n[8]*=s,n[1]*=i,n[5]*=r,n[9]*=s,n[2]*=i,n[6]*=r,n[10]*=s,n[3]*=i,n[7]*=r,n[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,n=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(n,i,r))}makeTranslation(e,n,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(e){let n=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(e){let n=Math.cos(e),i=Math.sin(e);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,n){let i=Math.cos(n),r=Math.sin(n),s=1-i,o=e.x,a=e.y,l=e.z,c=s*o,d=s*a;return this.set(c*o+i,c*a-r*l,c*l+r*a,0,c*a+r*l,d*a+i,d*l-r*o,0,c*l-r*a,d*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,n,i){return this.set(e,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,n,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,n,r,1,0,0,0,0,1),this}compose(e,n,i){let r=this.elements,s=n._x,o=n._y,a=n._z,l=n._w,c=s+s,d=o+o,f=a+a,u=s*c,p=s*d,x=s*f,S=o*d,v=o*f,h=a*f,g=l*c,_=l*d,M=l*f,C=i.x,b=i.y,R=i.z;return r[0]=(1-(S+h))*C,r[1]=(p+M)*C,r[2]=(x-_)*C,r[3]=0,r[4]=(p-M)*b,r[5]=(1-(u+h))*b,r[6]=(v+g)*b,r[7]=0,r[8]=(x+_)*R,r[9]=(v-g)*R,r[10]=(1-(u+S))*R,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,n,i){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinant();if(s===0)return i.set(1,1,1),n.identity(),this;let o=so.set(r[0],r[1],r[2]).length(),a=so.set(r[4],r[5],r[6]).length(),l=so.set(r[8],r[9],r[10]).length();s<0&&(o=-o),di.copy(this);let c=1/o,d=1/a,f=1/l;return di.elements[0]*=c,di.elements[1]*=c,di.elements[2]*=c,di.elements[4]*=d,di.elements[5]*=d,di.elements[6]*=d,di.elements[8]*=f,di.elements[9]*=f,di.elements[10]*=f,n.setFromRotationMatrix(di),i.x=o,i.y=a,i.z=l,this}makePerspective(e,n,i,r,s,o,a=mi,l=!1){let c=this.elements,d=2*s/(n-e),f=2*s/(i-r),u=(n+e)/(n-e),p=(i+r)/(i-r),x,S;if(l)x=s/(o-s),S=o*s/(o-s);else if(a===mi)x=-(o+s)/(o-s),S=-2*o*s/(o-s);else if(a===yo)x=-o/(o-s),S=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=u,c[12]=0,c[1]=0,c[5]=f,c[9]=p,c[13]=0,c[2]=0,c[6]=0,c[10]=x,c[14]=S,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,n,i,r,s,o,a=mi,l=!1){let c=this.elements,d=2/(n-e),f=2/(i-r),u=-(n+e)/(n-e),p=-(i+r)/(i-r),x,S;if(l)x=1/(o-s),S=o/(o-s);else if(a===mi)x=-2/(o-s),S=-(o+s)/(o-s);else if(a===yo)x=-1/(o-s),S=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=d,c[4]=0,c[8]=0,c[12]=u,c[1]=0,c[5]=f,c[9]=0,c[13]=p,c[2]=0,c[6]=0,c[10]=x,c[14]=S,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let n=this.elements,i=e.elements;for(let r=0;r<16;r++)if(n[r]!==i[r])return!1;return!0}fromArray(e,n=0){for(let i=0;i<16;i++)this.elements[i]=e[i+n];return this}toArray(e=[],n=0){let i=this.elements;return e[n]=i[0],e[n+1]=i[1],e[n+2]=i[2],e[n+3]=i[3],e[n+4]=i[4],e[n+5]=i[5],e[n+6]=i[6],e[n+7]=i[7],e[n+8]=i[8],e[n+9]=i[9],e[n+10]=i[10],e[n+11]=i[11],e[n+12]=i[12],e[n+13]=i[13],e[n+14]=i[14],e[n+15]=i[15],e}};oh.prototype.isMatrix4=!0;var yt=oh,so=new D,di=new yt,X1=new D(0,0,0),q1=new D(1,1,1),Ir=new D,Kc=new D,Bn=new D,Kx=new yt,jx=new Ii,Li=class t{constructor(e=0,n=0,i=0,r=t.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=n,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,n,i,r=this._order){return this._x=e,this._y=n,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,n=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],d=r[9],f=r[2],u=r[6],p=r[10];switch(n){case"XYZ":this._y=Math.asin(Ze(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-d,p),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(u,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Ze(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-f,s),this._z=0);break;case"ZXY":this._x=Math.asin(Ze(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-f,p),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Ze(f,-1,1)),Math.abs(f)<.9999999?(this._x=Math.atan2(u,p),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Ze(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-d,c),this._y=Math.atan2(-f,s)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-Ze(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(u,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-d,p),this._y=0);break;default:Fe("Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,n,i){return Kx.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Kx,n,i)}setFromVector3(e,n=this._order){return this.set(e.x,e.y,e.z,n)}reorder(e){return jx.setFromEuler(this),this.setFromQuaternion(jx,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],n=0){return e[n]=this._x,e[n+1]=this._y,e[n+2]=this._z,e[n+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Li.DEFAULT_ORDER="XYZ";var Wa=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},Y1=0,Qx=new D,oo=new Ii,Ji=new yt,jc=new D,Ra=new D,Z1=new D,$1=new Ii,e_=new D(1,0,0),t_=new D(0,1,0),n_=new D(0,0,1),i_={type:"added"},J1={type:"removed"},ao={type:"childadded",child:null},Dp={type:"childremoved",child:null},jt=class t extends Pi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Y1++}),this.uuid=Io(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=t.DEFAULT_UP.clone();let e=new D,n=new Li,i=new Ii,r=new D(1,1,1);function s(){i.setFromEuler(n,!1)}function o(){n.setFromQuaternion(i,void 0,!1)}n._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new yt},normalMatrix:{value:new ze}}),this.matrix=new yt,this.matrixWorld=new yt,this.matrixAutoUpdate=t.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Wa,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,n){this.quaternion.setFromAxisAngle(e,n)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,n){return oo.setFromAxisAngle(e,n),this.quaternion.multiply(oo),this}rotateOnWorldAxis(e,n){return oo.setFromAxisAngle(e,n),this.quaternion.premultiply(oo),this}rotateX(e){return this.rotateOnAxis(e_,e)}rotateY(e){return this.rotateOnAxis(t_,e)}rotateZ(e){return this.rotateOnAxis(n_,e)}translateOnAxis(e,n){return Qx.copy(e).applyQuaternion(this.quaternion),this.position.add(Qx.multiplyScalar(n)),this}translateX(e){return this.translateOnAxis(e_,e)}translateY(e){return this.translateOnAxis(t_,e)}translateZ(e){return this.translateOnAxis(n_,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Ji.copy(this.matrixWorld).invert())}lookAt(e,n,i){e.isVector3?jc.copy(e):jc.set(e,n,i);let r=this.parent;this.updateWorldMatrix(!0,!1),Ra.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Ji.lookAt(Ra,jc,this.up):Ji.lookAt(jc,Ra,this.up),this.quaternion.setFromRotationMatrix(Ji),r&&(Ji.extractRotation(r.matrixWorld),oo.setFromRotationMatrix(Ji),this.quaternion.premultiply(oo.invert()))}add(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return e===this?(Be("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(i_),ao.child=e,this.dispatchEvent(ao),ao.child=null):Be("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(e);return n!==-1&&(e.parent=null,this.children.splice(n,1),e.dispatchEvent(J1),Dp.child=e,this.dispatchEvent(Dp),Dp.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Ji.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Ji.multiply(e.parent.matrixWorld)),e.applyMatrix4(Ji),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(i_),ao.child=e,this.dispatchEvent(ao),ao.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,n){if(this[e]===n)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,n);if(o!==void 0)return o}}getObjectsByProperty(e,n,i=[]){this[e]===n&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,n,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ra,e,Z1),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ra,$1,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return e.set(n[8],n[9],n[10]).normalize()}raycast(){}traverse(e){e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].traverseVisible(e)}traverseAncestors(e){let n=this.parent;n!==null&&(e(n),n.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let n=e.x,i=e.y,r=e.z,s=this.matrix.elements;s[12]+=n-s[0]*n-s[4]*i-s[8]*r,s[13]+=i-s[1]*n-s[5]*i-s[9]*r,s[14]+=r-s[2]*n-s[6]*i-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let n=this.children;for(let i=0,r=n.length;i<r;i++)n[i].updateMatrixWorld(e)}updateWorldMatrix(e,n){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),n===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let n=e===void 0||typeof e=="string",i={};n&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,d=l.length;c<d;c++){let f=l[c];s(e.shapes,f)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(n){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),d=o(e.images),f=o(e.shapes),u=o(e.skeletons),p=o(e.animations),x=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),d.length>0&&(i.images=d),f.length>0&&(i.shapes=f),u.length>0&&(i.skeletons=u),p.length>0&&(i.animations=p),x.length>0&&(i.nodes=x)}return i.object=r,i;function o(a){let l=[];for(let c in a){let d=a[c];delete d.metadata,l.push(d)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,n=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),n===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};jt.DEFAULT_UP=new D(0,1,0);jt.DEFAULT_MATRIX_AUTO_UPDATE=!0;jt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Qn=class extends jt{constructor(){super(),this.isGroup=!0,this.type="Group"}},K1={type:"move"},wo=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Qn,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Qn,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new D,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new D),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Qn,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new D,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new D,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let n=this._hand;if(n)for(let i of e.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,n,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&n.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let S of e.hand.values()){let v=n.getJointPose(S,i),h=this._getHandJoint(c,S);v!==null&&(h.matrix.fromArray(v.transform.matrix),h.matrix.decompose(h.position,h.rotation,h.scale),h.matrixWorldNeedsUpdate=!0,h.jointRadius=v.radius),h.visible=v!==null}let d=c.joints["index-finger-tip"],f=c.joints["thumb-tip"],u=d.position.distanceTo(f.position),p=.02,x=.005;c.inputState.pinching&&u>p+x?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&u<=p-x&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=n.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));a!==null&&(r=n.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(K1)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,n){if(e.joints[n.jointName]===void 0){let i=new Qn;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[n.jointName]=i,e.add(i)}return e.joints[n.jointName]}},Q_={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Lr={h:0,s:0,l:0},Qc={h:0,s:0,l:0};function Up(t,e,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?t+(e-t)*6*n:n<1/2?e:n<2/3?t+(e-t)*6*(2/3-n):t}var Ke=class{constructor(e,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,n,i)}set(e,n,i){if(n===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,n,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,n=yn){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,je.colorSpaceToWorking(this,n),this}setRGB(e,n,i,r=je.workingColorSpace){return this.r=e,this.g=n,this.b=i,je.colorSpaceToWorking(this,r),this}setHSL(e,n,i,r=je.workingColorSpace){if(e=Pm(e,1),n=Ze(n,0,1),i=Ze(i,0,1),n===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+n):i+n-i*n,o=2*i-s;this.r=Up(o,s,e+1/3),this.g=Up(o,s,e),this.b=Up(o,s,e-1/3)}return je.colorSpaceToWorking(this,r),this}setStyle(e,n=yn){function i(s){s!==void 0&&parseFloat(s)<1&&Fe("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,n);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,n);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,n);break;default:Fe("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,n);if(o===6)return this.setHex(parseInt(s,16),n);Fe("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,n);return this}setColorName(e,n=yn){let i=Q_[e.toLowerCase()];return i!==void 0?this.setHex(i,n):Fe("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=tr(e.r),this.g=tr(e.g),this.b=tr(e.b),this}copyLinearToSRGB(e){return this.r=_o(e.r),this.g=_o(e.g),this.b=_o(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=yn){return je.workingToColorSpace(dn.copy(this),e),Math.round(Ze(dn.r*255,0,255))*65536+Math.round(Ze(dn.g*255,0,255))*256+Math.round(Ze(dn.b*255,0,255))}getHexString(e=yn){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,n=je.workingColorSpace){je.workingToColorSpace(dn.copy(this),n);let i=dn.r,r=dn.g,s=dn.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,c,d=(a+o)/2;if(a===o)l=0,c=0;else{let f=o-a;switch(c=d<=.5?f/(o+a):f/(2-o-a),o){case i:l=(r-s)/f+(r<s?6:0);break;case r:l=(s-i)/f+2;break;case s:l=(i-r)/f+4;break}l/=6}return e.h=l,e.s=c,e.l=d,e}getRGB(e,n=je.workingColorSpace){return je.workingToColorSpace(dn.copy(this),n),e.r=dn.r,e.g=dn.g,e.b=dn.b,e}getStyle(e=yn){je.workingToColorSpace(dn.copy(this),e);let n=dn.r,i=dn.g,r=dn.b;return e!==yn?`color(${e} ${n.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,n,i){return this.getHSL(Lr),this.setHSL(Lr.h+e,Lr.s+n,Lr.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,n){return this.r=e.r+n.r,this.g=e.g+n.g,this.b=e.b+n.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,n){return this.r+=(e.r-this.r)*n,this.g+=(e.g-this.g)*n,this.b+=(e.b-this.b)*n,this}lerpColors(e,n,i){return this.r=e.r+(n.r-e.r)*i,this.g=e.g+(n.g-e.g)*i,this.b=e.b+(n.b-e.b)*i,this}lerpHSL(e,n){this.getHSL(Lr),e.getHSL(Qc);let i=Fa(Lr.h,Qc.h,n),r=Fa(Lr.s,Qc.s,n),s=Fa(Lr.l,Qc.l,n);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let n=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*n+s[3]*i+s[6]*r,this.g=s[1]*n+s[4]*i+s[7]*r,this.b=s[2]*n+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,n=0){return this.r=e[n],this.g=e[n+1],this.b=e[n+2],this}toArray(e=[],n=0){return e[n]=this.r,e[n+1]=this.g,e[n+2]=this.b,e}fromBufferAttribute(e,n){return this.r=e.getX(n),this.g=e.getY(n),this.b=e.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},dn=new Ke;Ke.NAMES=Q_;var _s=class extends jt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Li,this.environmentIntensity=1,this.environmentRotation=new Li,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,n){return super.copy(e,n),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let n=super.toJSON(e);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(n.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(n.object.backgroundIntensity=this.backgroundIntensity),n.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(n.object.environmentIntensity=this.environmentIntensity),n.object.environmentRotation=this.environmentRotation.toArray(),n}},fi=new D,Ki=new D,Fp=new D,ji=new D,lo=new D,co=new D,r_=new D,Op=new D,Bp=new D,kp=new D,zp=new It,Vp=new It,Gp=new It,Or=class t{constructor(e=new D,n=new D,i=new D){this.a=e,this.b=n,this.c=i}static getNormal(e,n,i,r){r.subVectors(i,n),fi.subVectors(e,n),r.cross(fi);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,n,i,r,s){fi.subVectors(r,n),Ki.subVectors(i,n),Fp.subVectors(e,n);let o=fi.dot(fi),a=fi.dot(Ki),l=fi.dot(Fp),c=Ki.dot(Ki),d=Ki.dot(Fp),f=o*c-a*a;if(f===0)return s.set(0,0,0),null;let u=1/f,p=(c*l-a*d)*u,x=(o*d-a*l)*u;return s.set(1-p-x,x,p)}static containsPoint(e,n,i,r){return this.getBarycoord(e,n,i,r,ji)===null?!1:ji.x>=0&&ji.y>=0&&ji.x+ji.y<=1}static getInterpolation(e,n,i,r,s,o,a,l){return this.getBarycoord(e,n,i,r,ji)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,ji.x),l.addScaledVector(o,ji.y),l.addScaledVector(a,ji.z),l)}static getInterpolatedAttribute(e,n,i,r,s,o){return zp.setScalar(0),Vp.setScalar(0),Gp.setScalar(0),zp.fromBufferAttribute(e,n),Vp.fromBufferAttribute(e,i),Gp.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(zp,s.x),o.addScaledVector(Vp,s.y),o.addScaledVector(Gp,s.z),o}static isFrontFacing(e,n,i,r){return fi.subVectors(i,n),Ki.subVectors(e,n),fi.cross(Ki).dot(r)<0}set(e,n,i){return this.a.copy(e),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(e,n,i,r){return this.a.copy(e[n]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,n,i,r){return this.a.fromBufferAttribute(e,n),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return fi.subVectors(this.c,this.b),Ki.subVectors(this.a,this.b),fi.cross(Ki).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return t.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,n){return t.getBarycoord(e,this.a,this.b,this.c,n)}getInterpolation(e,n,i,r,s){return t.getInterpolation(e,this.a,this.b,this.c,n,i,r,s)}containsPoint(e){return t.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return t.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,n){let i=this.a,r=this.b,s=this.c,o,a;lo.subVectors(r,i),co.subVectors(s,i),Op.subVectors(e,i);let l=lo.dot(Op),c=co.dot(Op);if(l<=0&&c<=0)return n.copy(i);Bp.subVectors(e,r);let d=lo.dot(Bp),f=co.dot(Bp);if(d>=0&&f<=d)return n.copy(r);let u=l*f-d*c;if(u<=0&&l>=0&&d<=0)return o=l/(l-d),n.copy(i).addScaledVector(lo,o);kp.subVectors(e,s);let p=lo.dot(kp),x=co.dot(kp);if(x>=0&&p<=x)return n.copy(s);let S=p*c-l*x;if(S<=0&&c>=0&&x<=0)return a=c/(c-x),n.copy(i).addScaledVector(co,a);let v=d*x-p*f;if(v<=0&&f-d>=0&&p-x>=0)return r_.subVectors(s,r),a=(f-d)/(f-d+(p-x)),n.copy(r).addScaledVector(r_,a);let h=1/(v+S+u);return o=S*h,a=u*h,n.copy(i).addScaledVector(lo,o).addScaledVector(co,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Ni=class{constructor(e=new D(1/0,1/0,1/0),n=new D(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=n}set(e,n){return this.min.copy(e),this.max.copy(n),this}setFromArray(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n+=3)this.expandByPoint(pi.fromArray(e,n));return this}setFromBufferAttribute(e){this.makeEmpty();for(let n=0,i=e.count;n<i;n++)this.expandByPoint(pi.fromBufferAttribute(e,n));return this}setFromPoints(e){this.makeEmpty();for(let n=0,i=e.length;n<i;n++)this.expandByPoint(e[n]);return this}setFromCenterAndSize(e,n){let i=pi.copy(n).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,n=!1){return this.makeEmpty(),this.expandByObject(e,n)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,n=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(n===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,pi):pi.fromBufferAttribute(s,o),pi.applyMatrix4(e.matrixWorld),this.expandByPoint(pi);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),eu.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),eu.copy(i.boundingBox)),eu.applyMatrix4(e.matrixWorld),this.union(eu)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],n);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,n){return n.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,pi),pi.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let n,i;return e.normal.x>0?(n=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(n=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(n+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(n+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(n+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(n+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),n<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Pa),tu.subVectors(this.max,Pa),uo.subVectors(e.a,Pa),ho.subVectors(e.b,Pa),fo.subVectors(e.c,Pa),Nr.subVectors(ho,uo),Dr.subVectors(fo,ho),ds.subVectors(uo,fo);let n=[0,-Nr.z,Nr.y,0,-Dr.z,Dr.y,0,-ds.z,ds.y,Nr.z,0,-Nr.x,Dr.z,0,-Dr.x,ds.z,0,-ds.x,-Nr.y,Nr.x,0,-Dr.y,Dr.x,0,-ds.y,ds.x,0];return!Hp(n,uo,ho,fo,tu)||(n=[1,0,0,0,1,0,0,0,1],!Hp(n,uo,ho,fo,tu))?!1:(nu.crossVectors(Nr,Dr),n=[nu.x,nu.y,nu.z],Hp(n,uo,ho,fo,tu))}clampPoint(e,n){return n.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,pi).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(pi).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Qi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Qi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Qi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Qi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Qi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Qi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Qi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Qi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Qi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Qi=[new D,new D,new D,new D,new D,new D,new D,new D],pi=new D,eu=new Ni,uo=new D,ho=new D,fo=new D,Nr=new D,Dr=new D,ds=new D,Pa=new D,tu=new D,nu=new D,fs=new D;function Hp(t,e,n,i,r){for(let s=0,o=t.length-3;s<=o;s+=3){fs.fromArray(t,s);let a=r.x*Math.abs(fs.x)+r.y*Math.abs(fs.y)+r.z*Math.abs(fs.z),l=e.dot(fs),c=n.dot(fs),d=i.dot(fs);if(Math.max(-Math.max(l,c,d),Math.min(l,c,d))>a)return!1}return!0}var zt=new D,iu=new Ue,j1=0,Jt=class extends Pi{constructor(e,n,i=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:j1++}),this.name="",this.array=e,this.itemSize=n,this.count=e!==void 0?e.length/n:0,this.normalized=i,this.usage=om,this.updateRanges=[],this.gpuType=ti,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,n){this.updateRanges.push({start:e,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,n,i){e*=this.itemSize,i*=n.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=n.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)iu.fromBufferAttribute(this,n),iu.applyMatrix3(e),this.setXY(n,iu.x,iu.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)zt.fromBufferAttribute(this,n),zt.applyMatrix3(e),this.setXYZ(n,zt.x,zt.y,zt.z);return this}applyMatrix4(e){for(let n=0,i=this.count;n<i;n++)zt.fromBufferAttribute(this,n),zt.applyMatrix4(e),this.setXYZ(n,zt.x,zt.y,zt.z);return this}applyNormalMatrix(e){for(let n=0,i=this.count;n<i;n++)zt.fromBufferAttribute(this,n),zt.applyNormalMatrix(e),this.setXYZ(n,zt.x,zt.y,zt.z);return this}transformDirection(e){for(let n=0,i=this.count;n<i;n++)zt.fromBufferAttribute(this,n),zt.transformDirection(e),this.setXYZ(n,zt.x,zt.y,zt.z);return this}set(e,n=0){return this.array.set(e,n),this}getComponent(e,n){let i=this.array[e*this.itemSize+n];return this.normalized&&(i=xo(i,this.array)),i}setComponent(e,n,i){return this.normalized&&(i=_n(i,this.array)),this.array[e*this.itemSize+n]=i,this}getX(e){let n=this.array[e*this.itemSize];return this.normalized&&(n=xo(n,this.array)),n}setX(e,n){return this.normalized&&(n=_n(n,this.array)),this.array[e*this.itemSize]=n,this}getY(e){let n=this.array[e*this.itemSize+1];return this.normalized&&(n=xo(n,this.array)),n}setY(e,n){return this.normalized&&(n=_n(n,this.array)),this.array[e*this.itemSize+1]=n,this}getZ(e){let n=this.array[e*this.itemSize+2];return this.normalized&&(n=xo(n,this.array)),n}setZ(e,n){return this.normalized&&(n=_n(n,this.array)),this.array[e*this.itemSize+2]=n,this}getW(e){let n=this.array[e*this.itemSize+3];return this.normalized&&(n=xo(n,this.array)),n}setW(e,n){return this.normalized&&(n=_n(n,this.array)),this.array[e*this.itemSize+3]=n,this}setXY(e,n,i){return e*=this.itemSize,this.normalized&&(n=_n(n,this.array),i=_n(i,this.array)),this.array[e+0]=n,this.array[e+1]=i,this}setXYZ(e,n,i,r){return e*=this.itemSize,this.normalized&&(n=_n(n,this.array),i=_n(i,this.array),r=_n(r,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,n,i,r,s){return e*=this.itemSize,this.normalized&&(n=_n(n,this.array),i=_n(i,this.array),r=_n(r,this.array),s=_n(s,this.array)),this.array[e+0]=n,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==om&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var Xa=class extends Jt{constructor(e,n,i){super(new Uint16Array(e),n,i)}};var qa=class extends Jt{constructor(e,n,i){super(new Uint32Array(e),n,i)}};var Tt=class extends Jt{constructor(e,n,i){super(new Float32Array(e),n,i)}},Q1=new Ni,Ia=new D,Wp=new D,kr=class{constructor(e=new D,n=-1){this.isSphere=!0,this.center=e,this.radius=n}set(e,n){return this.center.copy(e),this.radius=n,this}setFromPoints(e,n){let i=this.center;n!==void 0?i.copy(n):Q1.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let n=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=n*n}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,n){let i=this.center.distanceToSquared(e);return n.copy(e),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Ia.subVectors(e,this.center);let n=Ia.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),r=(i-this.radius)*.5;this.center.addScaledVector(Ia,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Wp.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Ia.copy(e.center).add(Wp)),this.expandByPoint(Ia.copy(e.center).sub(Wp))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},eE=0,jn=new yt,Xp=new jt,po=new D,kn=new Ni,La=new Ni,$t=new D,fn=class t extends Pi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:eE++}),this.uuid=Io(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(w1(e)?qa:Xa)(e,1):this.index=e,this}setIndirect(e,n=0){return this.indirect=e,this.indirectOffset=n,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,n){return this.attributes[e]=n,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,n,i=0){this.groups.push({start:e,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,n){this.drawRange.start=e,this.drawRange.count=n}applyMatrix4(e){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(e),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new ze().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return jn.makeRotationFromQuaternion(e),this.applyMatrix4(jn),this}rotateX(e){return jn.makeRotationX(e),this.applyMatrix4(jn),this}rotateY(e){return jn.makeRotationY(e),this.applyMatrix4(jn),this}rotateZ(e){return jn.makeRotationZ(e),this.applyMatrix4(jn),this}translate(e,n,i){return jn.makeTranslation(e,n,i),this.applyMatrix4(jn),this}scale(e,n,i){return jn.makeScale(e,n,i),this.applyMatrix4(jn),this}lookAt(e){return Xp.lookAt(e),Xp.updateMatrix(),this.applyMatrix4(Xp.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(po).negate(),this.translate(po.x,po.y,po.z),this}setFromPoints(e){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new Tt(i,3))}else{let i=Math.min(e.length,n.count);for(let r=0;r<i;r++){let s=e[r];n.setXYZ(r,s.x,s.y,s.z||0)}e.length>n.count&&Fe("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ni);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Be("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new D(-1/0,-1/0,-1/0),new D(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),n)for(let i=0,r=n.length;i<r;i++){let s=n[i];kn.setFromBufferAttribute(s),this.morphTargetsRelative?($t.addVectors(this.boundingBox.min,kn.min),this.boundingBox.expandByPoint($t),$t.addVectors(this.boundingBox.max,kn.max),this.boundingBox.expandByPoint($t)):(this.boundingBox.expandByPoint(kn.min),this.boundingBox.expandByPoint(kn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Be('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new kr);let e=this.attributes.position,n=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Be("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new D,1/0);return}if(e){let i=this.boundingSphere.center;if(kn.setFromBufferAttribute(e),n)for(let s=0,o=n.length;s<o;s++){let a=n[s];La.setFromBufferAttribute(a),this.morphTargetsRelative?($t.addVectors(kn.min,La.min),kn.expandByPoint($t),$t.addVectors(kn.max,La.max),kn.expandByPoint($t)):(kn.expandByPoint(La.min),kn.expandByPoint(La.max))}kn.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)$t.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared($t));if(n)for(let s=0,o=n.length;s<o;s++){let a=n[s],l=this.morphTargetsRelative;for(let c=0,d=a.count;c<d;c++)$t.fromBufferAttribute(a,c),l&&(po.fromBufferAttribute(e,c),$t.add(po)),r=Math.max(r,i.distanceToSquared($t))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&Be('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,n=this.attributes;if(e===null||n.position===void 0||n.normal===void 0||n.uv===void 0){Be("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,r=n.normal,s=n.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Jt(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let m=0;m<i.count;m++)a[m]=new D,l[m]=new D;let c=new D,d=new D,f=new D,u=new Ue,p=new Ue,x=new Ue,S=new D,v=new D;function h(m,T,I){c.fromBufferAttribute(i,m),d.fromBufferAttribute(i,T),f.fromBufferAttribute(i,I),u.fromBufferAttribute(s,m),p.fromBufferAttribute(s,T),x.fromBufferAttribute(s,I),d.sub(c),f.sub(c),p.sub(u),x.sub(u);let A=1/(p.x*x.y-x.x*p.y);isFinite(A)&&(S.copy(d).multiplyScalar(x.y).addScaledVector(f,-p.y).multiplyScalar(A),v.copy(f).multiplyScalar(p.x).addScaledVector(d,-x.x).multiplyScalar(A),a[m].add(S),a[T].add(S),a[I].add(S),l[m].add(v),l[T].add(v),l[I].add(v))}let g=this.groups;g.length===0&&(g=[{start:0,count:e.count}]);for(let m=0,T=g.length;m<T;++m){let I=g[m],A=I.start,P=I.count;for(let O=A,z=A+P;O<z;O+=3)h(e.getX(O+0),e.getX(O+1),e.getX(O+2))}let _=new D,M=new D,C=new D,b=new D;function R(m){C.fromBufferAttribute(r,m),b.copy(C);let T=a[m];_.copy(T),_.sub(C.multiplyScalar(C.dot(T))).normalize(),M.crossVectors(b,T);let A=M.dot(l[m])<0?-1:1;o.setXYZW(m,_.x,_.y,_.z,A)}for(let m=0,T=g.length;m<T;++m){let I=g[m],A=I.start,P=I.count;for(let O=A,z=A+P;O<z;O+=3)R(e.getX(O+0)),R(e.getX(O+1)),R(e.getX(O+2))}}computeVertexNormals(){let e=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Jt(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let u=0,p=i.count;u<p;u++)i.setXYZ(u,0,0,0);let r=new D,s=new D,o=new D,a=new D,l=new D,c=new D,d=new D,f=new D;if(e)for(let u=0,p=e.count;u<p;u+=3){let x=e.getX(u+0),S=e.getX(u+1),v=e.getX(u+2);r.fromBufferAttribute(n,x),s.fromBufferAttribute(n,S),o.fromBufferAttribute(n,v),d.subVectors(o,s),f.subVectors(r,s),d.cross(f),a.fromBufferAttribute(i,x),l.fromBufferAttribute(i,S),c.fromBufferAttribute(i,v),a.add(d),l.add(d),c.add(d),i.setXYZ(x,a.x,a.y,a.z),i.setXYZ(S,l.x,l.y,l.z),i.setXYZ(v,c.x,c.y,c.z)}else for(let u=0,p=n.count;u<p;u+=3)r.fromBufferAttribute(n,u+0),s.fromBufferAttribute(n,u+1),o.fromBufferAttribute(n,u+2),d.subVectors(o,s),f.subVectors(r,s),d.cross(f),i.setXYZ(u+0,d.x,d.y,d.z),i.setXYZ(u+1,d.x,d.y,d.z),i.setXYZ(u+2,d.x,d.y,d.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let n=0,i=e.count;n<i;n++)$t.fromBufferAttribute(e,n),$t.normalize(),e.setXYZ(n,$t.x,$t.y,$t.z)}toNonIndexed(){function e(a,l){let c=a.array,d=a.itemSize,f=a.normalized,u=new c.constructor(l.length*d),p=0,x=0;for(let S=0,v=l.length;S<v;S++){a.isInterleavedBufferAttribute?p=l[S]*a.data.stride+a.offset:p=l[S]*d;for(let h=0;h<d;h++)u[x++]=c[p++]}return new Jt(u,d,f)}if(this.index===null)return Fe("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new t,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],c=e(l,i);n.setAttribute(a,c)}let s=this.morphAttributes;for(let a in s){let l=[],c=s[a];for(let d=0,f=c.length;d<f;d++){let u=c[d],p=e(u,i);l.push(p)}n.morphAttributes[a]=l}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let n=this.index;n!==null&&(e.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];e.data.attributes[l]=c.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],d=[];for(let f=0,u=c.length;f<u;f++){let p=c[f];d.push(p.toJSON(e.data))}d.length>0&&(r[l]=d,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let c in r){let d=r[c];this.setAttribute(c,d.clone(n))}let s=e.morphAttributes;for(let c in s){let d=[],f=s[c];for(let u=0,p=f.length;u<p;u++)d.push(f[u].clone(n));this.morphAttributes[c]=d}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,d=o.length;c<d;c++){let f=o[c];this.addGroup(f.start,f.count,f.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var tE=0,ir=class extends Pi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:tE++}),this.uuid=Io(),this.name="",this.type="Material",this.blending=vs,this.side=nr,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=_u,this.blendDst=yu,this.blendEquation=Br,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ke(0,0,0),this.blendAlpha=0,this.depthFunc=xs,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=sm,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=gs,this.stencilZFail=gs,this.stencilZPass=gs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let n in e){let i=e[n];if(i===void 0){Fe(`Material: parameter '${n}' has value of undefined.`);continue}let r=this[n];if(r===void 0){Fe(`Material: '${n}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[n]=i}}toJSON(e){let n=e===void 0||typeof e=="string";n&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==vs&&(i.blending=this.blending),this.side!==nr&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==_u&&(i.blendSrc=this.blendSrc),this.blendDst!==yu&&(i.blendDst=this.blendDst),this.blendEquation!==Br&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==xs&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==sm&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==gs&&(i.stencilFail=this.stencilFail),this.stencilZFail!==gs&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==gs&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(n){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let n=e.clippingPlanes,i=null;if(n!==null){let r=n.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=n[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var er=new D,qp=new D,ru=new D,Ur=new D,Yp=new D,su=new D,Zp=new D,Uu=class{constructor(e=new D,n=new D(0,0,-1)){this.origin=e,this.direction=n}set(e,n){return this.origin.copy(e),this.direction.copy(n),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,n){return n.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,er)),this}closestPointToPoint(e,n){n.subVectors(e,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let n=er.subVectors(e,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(e):(er.copy(this.origin).addScaledVector(this.direction,n),er.distanceToSquared(e))}distanceSqToSegment(e,n,i,r){qp.copy(e).add(n).multiplyScalar(.5),ru.copy(n).sub(e).normalize(),Ur.copy(this.origin).sub(qp);let s=e.distanceTo(n)*.5,o=-this.direction.dot(ru),a=Ur.dot(this.direction),l=-Ur.dot(ru),c=Ur.lengthSq(),d=Math.abs(1-o*o),f,u,p,x;if(d>0)if(f=o*l-a,u=o*a-l,x=s*d,f>=0)if(u>=-x)if(u<=x){let S=1/d;f*=S,u*=S,p=f*(f+o*u+2*a)+u*(o*f+u+2*l)+c}else u=s,f=Math.max(0,-(o*u+a)),p=-f*f+u*(u+2*l)+c;else u=-s,f=Math.max(0,-(o*u+a)),p=-f*f+u*(u+2*l)+c;else u<=-x?(f=Math.max(0,-(-o*s+a)),u=f>0?-s:Math.min(Math.max(-s,-l),s),p=-f*f+u*(u+2*l)+c):u<=x?(f=0,u=Math.min(Math.max(-s,-l),s),p=u*(u+2*l)+c):(f=Math.max(0,-(o*s+a)),u=f>0?s:Math.min(Math.max(-s,-l),s),p=-f*f+u*(u+2*l)+c);else u=o>0?-s:s,f=Math.max(0,-(o*u+a)),p=-f*f+u*(u+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,f),r&&r.copy(qp).addScaledVector(ru,u),p}intersectSphere(e,n){er.subVectors(e.center,this.origin);let i=er.dot(this.direction),r=er.dot(er)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,n):this.at(a,n)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let n=e.normal.dot(this.direction);if(n===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/n;return i>=0?i:null}intersectPlane(e,n){let i=this.distanceToPlane(e);return i===null?null:this.at(i,n)}intersectsPlane(e){let n=e.distanceToPoint(this.origin);return n===0||e.normal.dot(this.direction)*n<0}intersectBox(e,n){let i,r,s,o,a,l,c=1/this.direction.x,d=1/this.direction.y,f=1/this.direction.z,u=this.origin;return c>=0?(i=(e.min.x-u.x)*c,r=(e.max.x-u.x)*c):(i=(e.max.x-u.x)*c,r=(e.min.x-u.x)*c),d>=0?(s=(e.min.y-u.y)*d,o=(e.max.y-u.y)*d):(s=(e.max.y-u.y)*d,o=(e.min.y-u.y)*d),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),f>=0?(a=(e.min.z-u.z)*f,l=(e.max.z-u.z)*f):(a=(e.max.z-u.z)*f,l=(e.min.z-u.z)*f),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,n)}intersectsBox(e){return this.intersectBox(e,er)!==null}intersectTriangle(e,n,i,r,s){Yp.subVectors(n,e),su.subVectors(i,e),Zp.crossVectors(Yp,su);let o=this.direction.dot(Zp),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Ur.subVectors(this.origin,e);let l=a*this.direction.dot(su.crossVectors(Ur,su));if(l<0)return null;let c=a*this.direction.dot(Yp.cross(Ur));if(c<0||l+c>o)return null;let d=-a*Ur.dot(Zp);return d<0?null:this.at(d/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Ya=class extends ir{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ke(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Li,this.combine=ch,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},s_=new yt,ps=new Uu,ou=new kr,o_=new D,au=new D,lu=new D,cu=new D,$p=new D,uu=new D,a_=new D,hu=new D,Qe=class extends jt{constructor(e=new fn,n=new Ya){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,n){return super.copy(e,n),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let r=n[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,n){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;n.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){uu.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let d=a[l],f=s[l];d!==0&&($p.fromBufferAttribute(f,e),o?uu.addScaledVector($p,d):uu.addScaledVector($p.sub(n),d))}n.add(uu)}return n}raycast(e,n){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),ou.copy(i.boundingSphere),ou.applyMatrix4(s),ps.copy(e.ray).recast(e.near),!(ou.containsPoint(ps.origin)===!1&&(ps.intersectSphere(ou,o_)===null||ps.origin.distanceToSquared(o_)>(e.far-e.near)**2))&&(s_.copy(s).invert(),ps.copy(e.ray).applyMatrix4(s_),!(i.boundingBox!==null&&ps.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,n,ps)))}_computeIntersections(e,n,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,d=s.attributes.uv1,f=s.attributes.normal,u=s.groups,p=s.drawRange;if(a!==null)if(Array.isArray(o))for(let x=0,S=u.length;x<S;x++){let v=u[x],h=o[v.materialIndex],g=Math.max(v.start,p.start),_=Math.min(a.count,Math.min(v.start+v.count,p.start+p.count));for(let M=g,C=_;M<C;M+=3){let b=a.getX(M),R=a.getX(M+1),m=a.getX(M+2);r=du(this,h,e,i,c,d,f,b,R,m),r&&(r.faceIndex=Math.floor(M/3),r.face.materialIndex=v.materialIndex,n.push(r))}}else{let x=Math.max(0,p.start),S=Math.min(a.count,p.start+p.count);for(let v=x,h=S;v<h;v+=3){let g=a.getX(v),_=a.getX(v+1),M=a.getX(v+2);r=du(this,o,e,i,c,d,f,g,_,M),r&&(r.faceIndex=Math.floor(v/3),n.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let x=0,S=u.length;x<S;x++){let v=u[x],h=o[v.materialIndex],g=Math.max(v.start,p.start),_=Math.min(l.count,Math.min(v.start+v.count,p.start+p.count));for(let M=g,C=_;M<C;M+=3){let b=M,R=M+1,m=M+2;r=du(this,h,e,i,c,d,f,b,R,m),r&&(r.faceIndex=Math.floor(M/3),r.face.materialIndex=v.materialIndex,n.push(r))}}else{let x=Math.max(0,p.start),S=Math.min(l.count,p.start+p.count);for(let v=x,h=S;v<h;v+=3){let g=v,_=v+1,M=v+2;r=du(this,o,e,i,c,d,f,g,_,M),r&&(r.faceIndex=Math.floor(v/3),n.push(r))}}}};function nE(t,e,n,i,r,s,o,a){let l;if(e.side===Wt?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===nr,a),l===null)return null;hu.copy(a),hu.applyMatrix4(t.matrixWorld);let c=n.ray.origin.distanceTo(hu);return c<n.near||c>n.far?null:{distance:c,point:hu.clone(),object:t}}function du(t,e,n,i,r,s,o,a,l,c){t.getVertexPosition(a,au),t.getVertexPosition(l,lu),t.getVertexPosition(c,cu);let d=nE(t,e,n,i,au,lu,cu,a_);if(d){let f=new D;Or.getBarycoord(a_,au,lu,cu,f),r&&(d.uv=Or.getInterpolatedAttribute(r,a,l,c,f,new Ue)),s&&(d.uv1=Or.getInterpolatedAttribute(s,a,l,c,f,new Ue)),o&&(d.normal=Or.getInterpolatedAttribute(o,a,l,c,f,new D),d.normal.dot(i.direction)>0&&d.normal.multiplyScalar(-1));let u={a,b:l,c,normal:new D,materialIndex:0};Or.getNormal(au,lu,cu,u.normal),d.face=u,d.barycoord=f}return d}var Za=class extends Cn{constructor(e=null,n=1,i=1,r,s,o,a,l,c=Kt,d=Kt,f,u){super(null,o,a,l,c,d,r,s,f,u),this.isDataTexture=!0,this.image={data:e,width:n,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var $a=class extends Jt{constructor(e,n,i,r=1){super(e,n,i),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=r}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},mo=new yt,l_=new yt,fu=[],c_=new Ni,iE=new yt,Na=new Qe,Da=new kr,Ja=class extends Qe{constructor(e,n,i){super(e,n),this.isInstancedMesh=!0,this.instanceMatrix=new $a(new Float32Array(i*16),16),this.previousInstanceMatrix=null,this.instanceColor=null,this.morphTexture=null,this.count=i,this.boundingBox=null,this.boundingSphere=null;for(let r=0;r<i;r++)this.setMatrixAt(r,iE)}computeBoundingBox(){let e=this.geometry,n=this.count;this.boundingBox===null&&(this.boundingBox=new Ni),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let i=0;i<n;i++)this.getMatrixAt(i,mo),c_.copy(e.boundingBox).applyMatrix4(mo),this.boundingBox.union(c_)}computeBoundingSphere(){let e=this.geometry,n=this.count;this.boundingSphere===null&&(this.boundingSphere=new kr),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let i=0;i<n;i++)this.getMatrixAt(i,mo),Da.copy(e.boundingSphere).applyMatrix4(mo),this.boundingSphere.union(Da)}copy(e,n){return super.copy(e,n),this.instanceMatrix.copy(e.instanceMatrix),e.previousInstanceMatrix!==null&&(this.previousInstanceMatrix=e.previousInstanceMatrix.clone()),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,n){return this.instanceColor===null?n.setRGB(1,1,1):n.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,n){return n.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,n){let i=n.morphTargetInfluences,r=this.morphTexture.source.data.data,s=i.length+1,o=e*s+1;for(let a=0;a<i.length;a++)i[a]=r[o+a]}raycast(e,n){let i=this.matrixWorld,r=this.count;if(Na.geometry=this.geometry,Na.material=this.material,Na.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Da.copy(this.boundingSphere),Da.applyMatrix4(i),e.ray.intersectsSphere(Da)!==!1))for(let s=0;s<r;s++){this.getMatrixAt(s,mo),l_.multiplyMatrices(i,mo),Na.matrixWorld=l_,Na.raycast(e,fu);for(let o=0,a=fu.length;o<a;o++){let l=fu[o];l.instanceId=s,l.object=this,n.push(l)}fu.length=0}}setColorAt(e,n){return this.instanceColor===null&&(this.instanceColor=new $a(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),n.toArray(this.instanceColor.array,e*3),this}setMatrixAt(e,n){return n.toArray(this.instanceMatrix.array,e*16),this}setMorphAt(e,n){let i=n.morphTargetInfluences,r=i.length+1;this.morphTexture===null&&(this.morphTexture=new Za(new Float32Array(r*this.count),r,this.count,gh,ti));let s=this.morphTexture.source.data.data,o=0;for(let c=0;c<i.length;c++)o+=i[c];let a=this.geometry.morphTargetsRelative?1:1-o,l=r*e;return s[l]=a,s.set(i,l+1),this}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},Jp=new D,rE=new D,sE=new ze,Ai=class{constructor(e=new D(1,0,0),n=0){this.isPlane=!0,this.normal=e,this.constant=n}set(e,n){return this.normal.copy(e),this.constant=n,this}setComponents(e,n,i,r){return this.normal.set(e,n,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,n){return this.normal.copy(e),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(e,n,i){let r=Jp.subVectors(i,n).cross(rE.subVectors(e,n)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,n){return n.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,n,i=!0){let r=e.delta(Jp),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?n.copy(e.start):null;let o=-(e.start.dot(this.normal)+this.constant)/s;return i===!0&&(o<0||o>1)?null:n.copy(e.start).addScaledVector(r,o)}intersectsLine(e){let n=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return n<0&&i>0||i<0&&n>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,n){let i=n||sE.getNormalMatrix(e),r=this.coplanarPoint(Jp).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},ms=new kr,oE=new Ue(.5,.5),pu=new D,bo=class{constructor(e=new Ai,n=new Ai,i=new Ai,r=new Ai,s=new Ai,o=new Ai){this.planes=[e,n,i,r,s,o]}set(e,n,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(n),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,n=mi,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],c=s[3],d=s[4],f=s[5],u=s[6],p=s[7],x=s[8],S=s[9],v=s[10],h=s[11],g=s[12],_=s[13],M=s[14],C=s[15];if(r[0].setComponents(c-o,p-d,h-x,C-g).normalize(),r[1].setComponents(c+o,p+d,h+x,C+g).normalize(),r[2].setComponents(c+a,p+f,h+S,C+_).normalize(),r[3].setComponents(c-a,p-f,h-S,C-_).normalize(),i)r[4].setComponents(l,u,v,M).normalize(),r[5].setComponents(c-l,p-u,h-v,C-M).normalize();else if(r[4].setComponents(c-l,p-u,h-v,C-M).normalize(),n===mi)r[5].setComponents(c+l,p+u,h+v,C+M).normalize();else if(n===yo)r[5].setComponents(l,u,v,M).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ms.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let n=e.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),ms.copy(n.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ms)}intersectsSprite(e){ms.center.set(0,0,0);let n=oE.distanceTo(e.center);return ms.radius=.7071067811865476+n,ms.applyMatrix4(e.matrixWorld),this.intersectsSphere(ms)}intersectsSphere(e){let n=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(n[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let n=this.planes;for(let i=0;i<6;i++){let r=n[i];if(pu.x=r.normal.x>0?e.max.x:e.min.x,pu.y=r.normal.y>0?e.max.y:e.min.y,pu.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(pu)<0)return!1}return!0}containsPoint(e){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var Ka=class extends Cn{constructor(e=[],n=Xr,i,r,s,o,a,l,c,d){super(e,n,i,r,s,o,a,l,c,d),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}};var rr=class extends Cn{constructor(e,n,i=vi,r,s,o,a=Kt,l=Kt,c,d=Ri,f=1){if(d!==Ri&&d!==Yr)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let u={width:e,height:n,depth:f};super(u,r,s,o,a,l,d,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new Eo(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let n=super.toJSON(e);return this.compareFunction!==null&&(n.compareFunction=this.compareFunction),n}},Fu=class extends rr{constructor(e,n=vi,i=Xr,r,s,o=Kt,a=Kt,l,c=Ri){let d={width:e,height:e,depth:1},f=[d,d,d,d,d,d];super(e,e,n,i,r,s,o,a,l,c),this.image=f,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},ja=class extends Cn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},zr=class t extends fn{constructor(e=1,n=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:n,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],c=[],d=[],f=[],u=0,p=0;x("z","y","x",-1,-1,i,n,e,o,s,0),x("z","y","x",1,-1,i,n,-e,o,s,1),x("x","z","y",1,1,e,i,n,r,o,2),x("x","z","y",1,-1,e,i,-n,r,o,3),x("x","y","z",1,-1,e,n,i,r,s,4),x("x","y","z",-1,-1,e,n,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new Tt(c,3)),this.setAttribute("normal",new Tt(d,3)),this.setAttribute("uv",new Tt(f,2));function x(S,v,h,g,_,M,C,b,R,m,T){let I=M/R,A=C/m,P=M/2,O=C/2,z=b/2,L=R+1,B=m+1,G=0,q=0,J=new D;for(let j=0;j<B;j++){let ue=j*A-O;for(let U=0;U<L;U++){let ne=U*I-P;J[S]=ne*g,J[v]=ue*_,J[h]=z,c.push(J.x,J.y,J.z),J[S]=0,J[v]=0,J[h]=b>0?1:-1,d.push(J.x,J.y,J.z),f.push(U/R),f.push(1-j/m),G+=1}}for(let j=0;j<m;j++)for(let ue=0;ue<R;ue++){let U=u+ue+L*j,ne=u+ue+L*(j+1),Ne=u+(ue+1)+L*(j+1),he=u+(ue+1)+L*j;l.push(U,ne,he),l.push(ne,Ne,he),q+=6}a.addGroup(p,q,T),p+=q,u+=G}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var sr=class t extends fn{constructor(e=1,n=1,i=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:n,height:i,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};let c=this;r=Math.floor(r),s=Math.floor(s);let d=[],f=[],u=[],p=[],x=0,S=[],v=i/2,h=0;g(),o===!1&&(e>0&&_(!0),n>0&&_(!1)),this.setIndex(d),this.setAttribute("position",new Tt(f,3)),this.setAttribute("normal",new Tt(u,3)),this.setAttribute("uv",new Tt(p,2));function g(){let M=new D,C=new D,b=0,R=(n-e)/i;for(let m=0;m<=s;m++){let T=[],I=m/s,A=I*(n-e)+e;for(let P=0;P<=r;P++){let O=P/r,z=O*l+a,L=Math.sin(z),B=Math.cos(z);C.x=A*L,C.y=-I*i+v,C.z=A*B,f.push(C.x,C.y,C.z),M.set(L,R,B).normalize(),u.push(M.x,M.y,M.z),p.push(O,1-I),T.push(x++)}S.push(T)}for(let m=0;m<r;m++)for(let T=0;T<s;T++){let I=S[T][m],A=S[T+1][m],P=S[T+1][m+1],O=S[T][m+1];(e>0||T!==0)&&(d.push(I,A,O),b+=3),(n>0||T!==s-1)&&(d.push(A,P,O),b+=3)}c.addGroup(h,b,0),h+=b}function _(M){let C=x,b=new Ue,R=new D,m=0,T=M===!0?e:n,I=M===!0?1:-1;for(let P=1;P<=r;P++)f.push(0,v*I,0),u.push(0,I,0),p.push(.5,.5),x++;let A=x;for(let P=0;P<=r;P++){let z=P/r*l+a,L=Math.cos(z),B=Math.sin(z);R.x=T*B,R.y=v*I,R.z=T*L,f.push(R.x,R.y,R.z),u.push(0,I,0),b.x=L*.5+.5,b.y=B*.5*I+.5,p.push(b.x,b.y),x++}for(let P=0;P<r;P++){let O=C+P,z=A+P;M===!0?d.push(z,z+1,O):d.push(z+1,z,O),m+=3}c.addGroup(h,m,M===!0?1:2),h+=m}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var ei=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){Fe("Curve: .getPoint() not implemented.")}getPointAt(e,n){let i=this.getUtoTmapping(e);return this.getPoint(i,n)}getPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPoint(i/e));return n}getSpacedPoints(e=5){let n=[];for(let i=0;i<=e;i++)n.push(this.getPointAt(i/e));return n}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let n=[],i,r=this.getPoint(0),s=0;n.push(0);for(let o=1;o<=e;o++)i=this.getPoint(o/e),s+=i.distanceTo(r),n.push(s),r=i;return this.cacheArcLengths=n,n}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,n=null){let i=this.getLengths(),r=0,s=i.length,o;n?o=n:o=e*i[s-1];let a=0,l=s-1,c;for(;a<=l;)if(r=Math.floor(a+(l-a)/2),c=i[r]-o,c<0)a=r+1;else if(c>0)l=r-1;else{l=r;break}if(r=l,i[r]===o)return r/(s-1);let d=i[r],u=i[r+1]-d,p=(o-d)/u;return(r+p)/(s-1)}getTangent(e,n){let r=e-1e-4,s=e+1e-4;r<0&&(r=0),s>1&&(s=1);let o=this.getPoint(r),a=this.getPoint(s),l=n||(o.isVector2?new Ue:new D);return l.copy(a).sub(o).normalize(),l}getTangentAt(e,n){let i=this.getUtoTmapping(e);return this.getTangent(i,n)}computeFrenetFrames(e,n=!1){let i=new D,r=[],s=[],o=[],a=new D,l=new yt;for(let p=0;p<=e;p++){let x=p/e;r[p]=this.getTangentAt(x,new D)}s[0]=new D,o[0]=new D;let c=Number.MAX_VALUE,d=Math.abs(r[0].x),f=Math.abs(r[0].y),u=Math.abs(r[0].z);d<=c&&(c=d,i.set(1,0,0)),f<=c&&(c=f,i.set(0,1,0)),u<=c&&i.set(0,0,1),a.crossVectors(r[0],i).normalize(),s[0].crossVectors(r[0],a),o[0].crossVectors(r[0],s[0]);for(let p=1;p<=e;p++){if(s[p]=s[p-1].clone(),o[p]=o[p-1].clone(),a.crossVectors(r[p-1],r[p]),a.length()>Number.EPSILON){a.normalize();let x=Math.acos(Ze(r[p-1].dot(r[p]),-1,1));s[p].applyMatrix4(l.makeRotationAxis(a,x))}o[p].crossVectors(r[p],s[p])}if(n===!0){let p=Math.acos(Ze(s[0].dot(s[e]),-1,1));p/=e,r[0].dot(a.crossVectors(s[0],s[e]))>0&&(p=-p);for(let x=1;x<=e;x++)s[x].applyMatrix4(l.makeRotationAxis(r[x],p*x)),o[x].crossVectors(r[x],s[x])}return{tangents:r,normals:s,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},Qa=class extends ei{constructor(e=0,n=0,i=1,r=1,s=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=n,this.xRadius=i,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(e,n=new Ue){let i=n,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,o=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(o?s=0:s=r),this.aClockwise===!0&&!o&&(s===r?s=-r:s=s-r);let a=this.aStartAngle+e*s,l=this.aX+this.xRadius*Math.cos(a),c=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let d=Math.cos(this.aRotation),f=Math.sin(this.aRotation),u=l-this.aX,p=c-this.aY;l=u*d-p*f+this.aX,c=u*f+p*d+this.aY}return i.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},Ou=class extends Qa{constructor(e,n,i,r,s,o){super(e,n,i,i,r,s,o),this.isArcCurve=!0,this.type="ArcCurve"}};function Lm(){let t=0,e=0,n=0,i=0;function r(s,o,a,l){t=s,e=a,n=-3*s+3*o-2*a-l,i=2*s-2*o+a+l}return{initCatmullRom:function(s,o,a,l,c){r(o,a,c*(a-s),c*(l-o))},initNonuniformCatmullRom:function(s,o,a,l,c,d,f){let u=(o-s)/c-(a-s)/(c+d)+(a-o)/d,p=(a-o)/d-(l-o)/(d+f)+(l-a)/f;u*=d,p*=d,r(o,a,u,p)},calc:function(s){let o=s*s,a=o*s;return t+e*s+n*o+i*a}}}var u_=new D,h_=new D,Kp=new Lm,jp=new Lm,Qp=new Lm,ys=class extends ei{constructor(e=[],n=!1,i="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=n,this.curveType=i,this.tension=r}getPoint(e,n=new D){let i=n,r=this.points,s=r.length,o=(s-(this.closed?0:1))*e,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/s)+1)*s:l===0&&a===s-1&&(a=s-2,l=1);let c,d;this.closed||a>0?c=r[(a-1)%s]:(h_.subVectors(r[0],r[1]).add(r[0]),c=h_);let f=r[a%s],u=r[(a+1)%s];if(this.closed||a+2<s?d=r[(a+2)%s]:(u_.subVectors(r[s-1],r[s-2]).add(r[s-1]),d=u_),this.curveType==="centripetal"||this.curveType==="chordal"){let p=this.curveType==="chordal"?.5:.25,x=Math.pow(c.distanceToSquared(f),p),S=Math.pow(f.distanceToSquared(u),p),v=Math.pow(u.distanceToSquared(d),p);S<1e-4&&(S=1),x<1e-4&&(x=S),v<1e-4&&(v=S),Kp.initNonuniformCatmullRom(c.x,f.x,u.x,d.x,x,S,v),jp.initNonuniformCatmullRom(c.y,f.y,u.y,d.y,x,S,v),Qp.initNonuniformCatmullRom(c.z,f.z,u.z,d.z,x,S,v)}else this.curveType==="catmullrom"&&(Kp.initCatmullRom(c.x,f.x,u.x,d.x,this.tension),jp.initCatmullRom(c.y,f.y,u.y,d.y,this.tension),Qp.initCatmullRom(c.z,f.z,u.z,d.z,this.tension));return i.set(Kp.calc(l),jp.calc(l),Qp.calc(l)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new D().fromArray(r))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function d_(t,e,n,i,r){let s=(i-e)*.5,o=(r-n)*.5,a=t*t,l=t*a;return(2*n-2*i+s+o)*l+(-3*n+3*i-2*s-o)*a+s*t+n}function aE(t,e){let n=1-t;return n*n*e}function lE(t,e){return 2*(1-t)*t*e}function cE(t,e){return t*t*e}function Oa(t,e,n,i){return aE(t,e)+lE(t,n)+cE(t,i)}function uE(t,e){let n=1-t;return n*n*n*e}function hE(t,e){let n=1-t;return 3*n*n*t*e}function dE(t,e){return 3*(1-t)*t*t*e}function fE(t,e){return t*t*t*e}function Ba(t,e,n,i,r){return uE(t,e)+hE(t,n)+dE(t,i)+fE(t,r)}var Bu=class extends ei{constructor(e=new Ue,n=new Ue,i=new Ue,r=new Ue){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new Ue){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(Ba(e,r.x,s.x,o.x,a.x),Ba(e,r.y,s.y,o.y,a.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},ku=class extends ei{constructor(e=new D,n=new D,i=new D,r=new D){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=n,this.v2=i,this.v3=r}getPoint(e,n=new D){let i=n,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(Ba(e,r.x,s.x,o.x,a.x),Ba(e,r.y,s.y,o.y,a.y),Ba(e,r.z,s.z,o.z,a.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},zu=class extends ei{constructor(e=new Ue,n=new Ue){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=n}getPoint(e,n=new Ue){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new Ue){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Vu=class extends ei{constructor(e=new D,n=new D){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=n}getPoint(e,n=new D){let i=n;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,n){return this.getPoint(e,n)}getTangent(e,n=new D){return n.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,n){return this.getTangent(e,n)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Gu=class extends ei{constructor(e=new Ue,n=new Ue,i=new Ue){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new Ue){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(Oa(e,r.x,s.x,o.x),Oa(e,r.y,s.y,o.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},el=class extends ei{constructor(e=new D,n=new D,i=new D){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=n,this.v2=i}getPoint(e,n=new D){let i=n,r=this.v0,s=this.v1,o=this.v2;return i.set(Oa(e,r.x,s.x,o.x),Oa(e,r.y,s.y,o.y),Oa(e,r.z,s.z,o.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Hu=class extends ei{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,n=new Ue){let i=n,r=this.points,s=(r.length-1)*e,o=Math.floor(s),a=s-o,l=r[o===0?o:o-1],c=r[o],d=r[o>r.length-2?r.length-1:o+1],f=r[o>r.length-3?r.length-1:o+2];return i.set(d_(a,l.x,c.x,d.x,f.x),d_(a,l.y,c.y,d.y,f.y)),i}copy(e){super.copy(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let n=0,i=this.points.length;n<i;n++){let r=this.points[n];e.points.push(r.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let n=0,i=e.points.length;n<i;n++){let r=e.points[n];this.points.push(new Ue().fromArray(r))}return this}},pE=Object.freeze({__proto__:null,ArcCurve:Ou,CatmullRomCurve3:ys,CubicBezierCurve:Bu,CubicBezierCurve3:ku,EllipseCurve:Qa,LineCurve:zu,LineCurve3:Vu,QuadraticBezierCurve:Gu,QuadraticBezierCurve3:el,SplineCurve:Hu});var tl=class t extends fn{constructor(e=1,n=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:n,widthSegments:i,heightSegments:r};let s=e/2,o=n/2,a=Math.floor(i),l=Math.floor(r),c=a+1,d=l+1,f=e/a,u=n/l,p=[],x=[],S=[],v=[];for(let h=0;h<d;h++){let g=h*u-o;for(let _=0;_<c;_++){let M=_*f-s;x.push(M,-g,0),S.push(0,0,1),v.push(_/a),v.push(1-h/l)}}for(let h=0;h<l;h++)for(let g=0;g<a;g++){let _=g+c*h,M=g+c*(h+1),C=g+1+c*(h+1),b=g+1+c*h;p.push(_,M,b),p.push(M,C,b)}this.setIndex(p),this.setAttribute("position",new Tt(x,3)),this.setAttribute("normal",new Tt(S,3)),this.setAttribute("uv",new Tt(v,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.width,e.height,e.widthSegments,e.heightSegments)}};var nl=class t extends fn{constructor(e=1,n=32,i=16,r=0,s=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:n,heightSegments:i,phiStart:r,phiLength:s,thetaStart:o,thetaLength:a},n=Math.max(3,Math.floor(n)),i=Math.max(2,Math.floor(i));let l=Math.min(o+a,Math.PI),c=0,d=[],f=new D,u=new D,p=[],x=[],S=[],v=[];for(let h=0;h<=i;h++){let g=[],_=h/i,M=0;h===0&&o===0?M=.5/n:h===i&&l===Math.PI&&(M=-.5/n);for(let C=0;C<=n;C++){let b=C/n;f.x=-e*Math.cos(r+b*s)*Math.sin(o+_*a),f.y=e*Math.cos(o+_*a),f.z=e*Math.sin(r+b*s)*Math.sin(o+_*a),x.push(f.x,f.y,f.z),u.copy(f).normalize(),S.push(u.x,u.y,u.z),v.push(b+M,1-_),g.push(c++)}d.push(g)}for(let h=0;h<i;h++)for(let g=0;g<n;g++){let _=d[h][g+1],M=d[h][g],C=d[h+1][g],b=d[h+1][g+1];(h!==0||o>0)&&p.push(_,M,b),(h!==i-1||l<Math.PI)&&p.push(M,C,b)}this.setIndex(p),this.setAttribute("position",new Tt(x,3)),this.setAttribute("normal",new Tt(S,3)),this.setAttribute("uv",new Tt(v,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var To=class t extends fn{constructor(e=1,n=.4,i=12,r=48,s=Math.PI*2,o=0,a=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:n,radialSegments:i,tubularSegments:r,arc:s,thetaStart:o,thetaLength:a},i=Math.floor(i),r=Math.floor(r);let l=[],c=[],d=[],f=[],u=new D,p=new D,x=new D;for(let S=0;S<=i;S++){let v=o+S/i*a;for(let h=0;h<=r;h++){let g=h/r*s;p.x=(e+n*Math.cos(v))*Math.cos(g),p.y=(e+n*Math.cos(v))*Math.sin(g),p.z=n*Math.sin(v),c.push(p.x,p.y,p.z),u.x=e*Math.cos(g),u.y=e*Math.sin(g),x.subVectors(p,u).normalize(),d.push(x.x,x.y,x.z),f.push(h/r),f.push(S/i)}}for(let S=1;S<=i;S++)for(let v=1;v<=r;v++){let h=(r+1)*S+v-1,g=(r+1)*(S-1)+v-1,_=(r+1)*(S-1)+v,M=(r+1)*S+v;l.push(h,g,M),l.push(g,_,M)}this.setIndex(l),this.setAttribute("position",new Tt(c,3)),this.setAttribute("normal",new Tt(d,3)),this.setAttribute("uv",new Tt(f,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new t(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}};var il=class t extends fn{constructor(e=new el(new D(-1,-1,0),new D(-1,1,0),new D(1,1,0)),n=64,i=1,r=8,s=!1){super(),this.type="TubeGeometry",this.parameters={path:e,tubularSegments:n,radius:i,radialSegments:r,closed:s};let o=e.computeFrenetFrames(n,s);this.tangents=o.tangents,this.normals=o.normals,this.binormals=o.binormals;let a=new D,l=new D,c=new Ue,d=new D,f=[],u=[],p=[],x=[];S(),this.setIndex(x),this.setAttribute("position",new Tt(f,3)),this.setAttribute("normal",new Tt(u,3)),this.setAttribute("uv",new Tt(p,2));function S(){for(let _=0;_<n;_++)v(_);v(s===!1?n:0),g(),h()}function v(_){d=e.getPointAt(_/n,d);let M=o.normals[_],C=o.binormals[_];for(let b=0;b<=r;b++){let R=b/r*Math.PI*2,m=Math.sin(R),T=-Math.cos(R);l.x=T*M.x+m*C.x,l.y=T*M.y+m*C.y,l.z=T*M.z+m*C.z,l.normalize(),u.push(l.x,l.y,l.z),a.x=d.x+i*l.x,a.y=d.y+i*l.y,a.z=d.z+i*l.z,f.push(a.x,a.y,a.z)}}function h(){for(let _=1;_<=n;_++)for(let M=1;M<=r;M++){let C=(r+1)*(_-1)+(M-1),b=(r+1)*_+(M-1),R=(r+1)*_+M,m=(r+1)*(_-1)+M;x.push(C,b,m),x.push(b,R,m)}}function g(){for(let _=0;_<=n;_++)for(let M=0;M<=r;M++)c.x=_/n,c.y=M/r,p.push(c.x,c.y)}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON();return e.path=this.parameters.path.toJSON(),e}static fromJSON(e){return new t(new pE[e.path.type]().fromJSON(e.path),e.tubularSegments,e.radius,e.radialSegments,e.closed)}};function Ms(t){let e={};for(let n in t){e[n]={};for(let i in t[n]){let r=t[n][i];if(f_(r))r.isRenderTargetTexture?(Fe("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[n][i]=null):e[n][i]=r.clone();else if(Array.isArray(r))if(f_(r[0])){let s=[];for(let o=0,a=r.length;o<a;o++)s[o]=r[o].clone();e[n][i]=s}else e[n][i]=r.slice();else e[n][i]=r}}return e}function pn(t){let e={};for(let n=0;n<t.length;n++){let i=Ms(t[n]);for(let r in i)e[r]=i[r]}return e}function f_(t){return t&&(t.isColor||t.isMatrix3||t.isMatrix4||t.isVector2||t.isVector3||t.isVector4||t.isTexture||t.isQuaternion)}function mE(t){let e=[];for(let n=0;n<t.length;n++)e.push(t[n].clone());return e}function Nm(t){let e=t.getRenderTarget();return e===null?t.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:je.workingColorSpace}var ey={clone:Ms,merge:pn},gE=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,vE=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Vn=class extends ir{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=gE,this.fragmentShader=vE,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Ms(e.uniforms),this.uniformsGroups=mE(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let n=super.toJSON(e);n.glslVersion=this.glslVersion,n.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?n.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?n.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?n.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?n.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?n.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?n.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?n.uniforms[r]={type:"m4",value:o.toArray()}:n.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}},Wu=class extends Vn{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},Rn=class extends ir{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Ke(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ke(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=yl,this.normalScale=new Ue(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Li,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var rl=class extends ir{constructor(e){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new Ke(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ke(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=yl,this.normalScale=new Ue(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Li,this.combine=ch,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.envMapIntensity=e.envMapIntensity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},Xu=class extends ir{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=V_,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},qu=class extends ir{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function mu(t,e){return!t||t.constructor===e?t:typeof e.BYTES_PER_ELEMENT=="number"?new e(t):Array.prototype.slice.call(t)}var Vr=class{constructor(e,n,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let n=this.parameterPositions,i=this._cachedIndex,r=n[i],s=n[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=n[++i],e<r)break t}o=n.length;break n}if(!(e>=s)){let a=n[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=n[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<n[a]?o=a:i=a+1}if(r=n[i],s=n[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let n=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)n[o]=i[s+o];return n}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Yu=class extends Vr{constructor(e,n,i,r){super(e,n,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:nm,endingEnd:nm}}intervalChanged_(e,n,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case im:s=e,a=2*n-i;break;case rm:s=r.length-2,a=n+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case im:o=e,l=2*i-n;break;case rm:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=n}let c=(i-n)*.5,d=this.valueSize;this._weightPrev=c/(n-a),this._weightNext=c/(l-i),this._offsetPrev=s*d,this._offsetNext=o*d}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this._offsetPrev,f=this._offsetNext,u=this._weightPrev,p=this._weightNext,x=(i-n)/(r-n),S=x*x,v=S*x,h=-u*v+2*u*S-u*x,g=(1+u)*v+(-1.5-2*u)*S+(-.5+u)*x+1,_=(-1-p)*v+(1.5+p)*S+.5*x,M=p*v-p*S;for(let C=0;C!==a;++C)s[C]=h*o[d+C]+g*o[c+C]+_*o[l+C]+M*o[f+C];return s}},Zu=class extends Vr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=(i-n)/(r-n),f=1-d;for(let u=0;u!==a;++u)s[u]=o[c+u]*f+o[l+u]*d;return s}},$u=class extends Vr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},Ju=class extends Vr{interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,d=this.settings||this.DefaultSettings_,f=d.inTangents,u=d.outTangents;if(!f||!u){let S=(i-n)/(r-n),v=1-S;for(let h=0;h!==a;++h)s[h]=o[c+h]*v+o[l+h]*S;return s}let p=a*2,x=e-1;for(let S=0;S!==a;++S){let v=o[c+S],h=o[l+S],g=x*p+S*2,_=u[g],M=u[g+1],C=e*p+S*2,b=f[C],R=f[C+1],m=(i-n)/(r-n),T,I,A,P,O;for(let z=0;z<8;z++){T=m*m,I=T*m,A=1-m,P=A*A,O=P*A;let B=O*n+3*P*m*_+3*A*T*b+I*r-i;if(Math.abs(B)<1e-10)break;let G=3*P*(_-n)+6*A*m*(b-_)+3*T*(r-b);if(Math.abs(G)<1e-10)break;m=m-B/G,m=Math.max(0,Math.min(1,m))}s[S]=O*v+3*P*m*M+3*A*T*R+I*h}return s}},Gn=class{constructor(e,n,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=mu(n,this.TimeBufferType),this.values=mu(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let n=e.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(e);else{i={name:e.name,times:mu(e.times,Array),values:mu(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new $u(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Zu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Yu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let n=new Ju(this.times,this.values,this.getValueSize(),e);return this.settings&&(n.settings=this.settings),n}setInterpolation(e){let n;switch(e){case ka:n=this.InterpolantFactoryMethodDiscrete;break;case Pu:n=this.InterpolantFactoryMethodLinear;break;case xu:n=this.InterpolantFactoryMethodSmooth;break;case tm:n=this.InterpolantFactoryMethodBezier;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return Fe("KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return ka;case this.InterpolantFactoryMethodLinear:return Pu;case this.InterpolantFactoryMethodSmooth:return xu;case this.InterpolantFactoryMethodBezier:return tm}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]+=e}return this}scale(e){if(e!==1){let n=this.times;for(let i=0,r=n.length;i!==r;++i)n[i]*=e}return this}trim(e,n){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>n;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(Be("KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(Be("KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){Be("KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){Be("KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&b1(r))for(let a=0,l=r.length;a!==l;++a){let c=r[a];if(isNaN(c)){Be("KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===xu,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,c=e[a],d=e[a+1];if(c!==d&&(a!==1||c!==e[0]))if(r)l=!0;else{let f=a*i,u=f-i,p=f+i;for(let x=0;x!==i;++x){let S=n[f+x];if(S!==n[u+x]||S!==n[p+x]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let f=a*i,u=o*i;for(let p=0;p!==i;++p)n[u+p]=n[f+p]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,c=0;c!==i;++c)n[l+c]=n[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=n.slice(0,o*i)):(this.times=e,this.values=n),this}clone(){let e=this.times.slice(),n=this.values.slice(),i=this.constructor,r=new i(this.name,e,n);return r.createInterpolant=this.createInterpolant,r}};Gn.prototype.ValueTypeName="";Gn.prototype.TimeBufferType=Float32Array;Gn.prototype.ValueBufferType=Float32Array;Gn.prototype.DefaultInterpolation=Pu;var Gr=class extends Gn{constructor(e,n,i){super(e,n,i)}};Gr.prototype.ValueTypeName="bool";Gr.prototype.ValueBufferType=Array;Gr.prototype.DefaultInterpolation=ka;Gr.prototype.InterpolantFactoryMethodLinear=void 0;Gr.prototype.InterpolantFactoryMethodSmooth=void 0;var Ku=class extends Gn{constructor(e,n,i,r){super(e,n,i,r)}};Ku.prototype.ValueTypeName="color";var ju=class extends Gn{constructor(e,n,i,r){super(e,n,i,r)}};ju.prototype.ValueTypeName="number";var Qu=class extends Vr{constructor(e,n,i,r){super(e,n,i,r)}interpolate_(e,n,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-n)/(r-n),c=e*a;for(let d=c+a;c!==d;c+=4)Ii.slerpFlat(s,0,o,c-a,o,c,l);return s}},sl=class extends Gn{constructor(e,n,i,r){super(e,n,i,r)}InterpolantFactoryMethodLinear(e){return new Qu(this.times,this.values,this.getValueSize(),e)}};sl.prototype.ValueTypeName="quaternion";sl.prototype.InterpolantFactoryMethodSmooth=void 0;var Hr=class extends Gn{constructor(e,n,i){super(e,n,i)}};Hr.prototype.ValueTypeName="string";Hr.prototype.ValueBufferType=Array;Hr.prototype.DefaultInterpolation=ka;Hr.prototype.InterpolantFactoryMethodLinear=void 0;Hr.prototype.InterpolantFactoryMethodSmooth=void 0;var eh=class extends Gn{constructor(e,n,i,r){super(e,n,i,r)}};eh.prototype.ValueTypeName="vector";var th=class{constructor(e,n,i){let r=this,s=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=n,this.onError=i,this._abortController=null,this.itemStart=function(d){a++,s===!1&&r.onStart!==void 0&&r.onStart(d,o,a),s=!0},this.itemEnd=function(d){o++,r.onProgress!==void 0&&r.onProgress(d,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(d){r.onError!==void 0&&r.onError(d)},this.resolveURL=function(d){return l?l(d):d},this.setURLModifier=function(d){return l=d,this},this.addHandler=function(d,f){return c.push(d,f),this},this.removeHandler=function(d){let f=c.indexOf(d);return f!==-1&&c.splice(f,2),this},this.getHandler=function(d){for(let f=0,u=c.length;f<u;f+=2){let p=c[f],x=c[f+1];if(p.global&&(p.lastIndex=0),p.test(d))return x}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},ty=new th,nh=class{constructor(e){this.manager=e!==void 0?e:ty,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,n){let i=this;return new Promise(function(r,s){i.load(e,r,n,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};nh.DEFAULT_MATERIAL_NAME="__DEFAULT";var Ao=class extends jt{constructor(e,n=1){super(),this.isLight=!0,this.type="Light",this.color=new Ke(e),this.intensity=n}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,n){return super.copy(e,n),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let n=super.toJSON(e);return n.object.color=this.color.getHex(),n.object.intensity=this.intensity,n}},ol=class extends Ao{constructor(e,n,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(jt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ke(n)}copy(e,n){return super.copy(e,n),this.groundColor.copy(e.groundColor),this}toJSON(e){let n=super.toJSON(e);return n.object.groundColor=this.groundColor.getHex(),n}},em=new yt,p_=new D,m_=new D,ih=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ue(512,512),this.mapType=Pn,this.map=null,this.mapPass=null,this.matrix=new yt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new bo,this._frameExtents=new Ue(1,1),this._viewportCount=1,this._viewports=[new It(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let n=this.camera,i=this.matrix;p_.setFromMatrixPosition(e.matrixWorld),n.position.copy(p_),m_.setFromMatrixPosition(e.target.matrixWorld),n.lookAt(m_),n.updateMatrixWorld(),em.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(em,n.coordinateSystem,n.reversedDepth),n.coordinateSystem===yo||n.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(em)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},gu=new D,vu=new Ii,Ti=new D,al=class extends jt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new yt,this.projectionMatrix=new yt,this.projectionMatrixInverse=new yt,this.coordinateSystem=mi,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,n){return super.copy(e,n),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(gu,vu,Ti),Ti.x===1&&Ti.y===1&&Ti.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(gu,vu,Ti.set(1,1,1)).invert()}updateWorldMatrix(e,n){super.updateWorldMatrix(e,n),this.matrixWorld.decompose(gu,vu,Ti),Ti.x===1&&Ti.y===1&&Ti.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(gu,vu,Ti.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Fr=new D,g_=new Ue,v_=new Ue,Sn=class extends al{constructor(e=50,n=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let n=.5*this.getFilmHeight()/e;this.fov=Mo*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Ua*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Mo*2*Math.atan(Math.tan(Ua*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,n,i){Fr.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Fr.x,Fr.y).multiplyScalar(-e/Fr.z),Fr.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Fr.x,Fr.y).multiplyScalar(-e/Fr.z)}getViewSize(e,n){return this.getViewBounds(e,g_,v_),n.subVectors(v_,g_)}setViewOffset(e,n,i,r,s,o){this.aspect=e/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,n=e*Math.tan(Ua*.5*this.fov)/this.zoom,i=2*n,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,n-=o.offsetY*i/c,r*=o.width/l,i*=o.height/c}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,n,n-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}};var am=class extends ih{constructor(){super(new Sn(90,1,.5,500)),this.isPointLightShadow=!0}},ll=class extends Ao{constructor(e,n,i=0,r=2){super(e,n),this.isPointLight=!0,this.type="PointLight",this.distance=i,this.decay=r,this.shadow=new am}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(e,n){return super.copy(e,n),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}toJSON(e){let n=super.toJSON(e);return n.object.distance=this.distance,n.object.decay=this.decay,n.object.shadow=this.shadow.toJSON(),n}},Wr=class extends al{constructor(e=-1,n=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=n,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,n){return super.copy(e,n),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,n,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+n,l=r-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,d=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=d*this.view.offsetY,l=a-d*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let n=super.toJSON(e);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}},lm=class extends ih{constructor(){super(new Wr(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},cl=class extends Ao{constructor(e,n){super(e,n),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(jt.DEFAULT_UP),this.updateMatrix(),this.target=new jt,this.shadow=new lm}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let n=super.toJSON(e);return n.object.shadow=this.shadow.toJSON(),n.object.target=this.target.uuid,n}};var go=-90,vo=1,rh=class extends jt{constructor(e,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new Sn(go,vo,e,n);r.layers=this.layers,this.add(r);let s=new Sn(go,vo,e,n);s.layers=this.layers,this.add(s);let o=new Sn(go,vo,e,n);o.layers=this.layers,this.add(o);let a=new Sn(go,vo,e,n);a.layers=this.layers,this.add(a);let l=new Sn(go,vo,e,n);l.layers=this.layers,this.add(l);let c=new Sn(go,vo,e,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,n=this.children.concat(),[i,r,s,o,a,l]=n;for(let c of n)this.remove(c);if(e===mi)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===yo)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of n)this.add(c),c.updateMatrixWorld()}update(e,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,c,d]=this.children,f=e.getRenderTarget(),u=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),x=e.xr.enabled;e.xr.enabled=!1;let S=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let v=!1;e.isWebGLRenderer===!0?v=e.state.buffers.depth.getReversed():v=e.reversedDepthBuffer,e.setRenderTarget(i,0,r),v&&e.autoClear===!1&&e.clearDepth(),e.render(n,s),e.setRenderTarget(i,1,r),v&&e.autoClear===!1&&e.clearDepth(),e.render(n,o),e.setRenderTarget(i,2,r),v&&e.autoClear===!1&&e.clearDepth(),e.render(n,a),e.setRenderTarget(i,3,r),v&&e.autoClear===!1&&e.clearDepth(),e.render(n,l),e.setRenderTarget(i,4,r),v&&e.autoClear===!1&&e.clearDepth(),e.render(n,c),i.texture.generateMipmaps=S,e.setRenderTarget(i,5,r),v&&e.autoClear===!1&&e.clearDepth(),e.render(n,d),e.setRenderTarget(f,u,p),e.xr.enabled=x,i.texture.needsPMREMUpdate=!0}},sh=class extends Sn{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Dm="\\[\\]\\.:\\/",xE=new RegExp("["+Dm+"]","g"),Um="[^"+Dm+"]",_E="[^"+Dm.replace("\\.","")+"]",yE=/((?:WC+[\/:])*)/.source.replace("WC",Um),SE=/(WCOD+)?/.source.replace("WCOD",_E),ME=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Um),EE=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Um),wE=new RegExp("^"+yE+SE+ME+EE+"$"),bE=["material","materials","bones","map"],cm=class{constructor(e,n,i){let r=i||wt.parseTrackName(n);this._targetGroup=e,this._bindings=e.subscribe_(n,r)}getValue(e,n){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,n)}setValue(e,n){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,n)}bind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].bind()}unbind(){let e=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=e.length;n!==i;++n)e[n].unbind()}},wt=class t{constructor(e,n,i){this.path=n,this.parsedPath=i||t.parseTrackName(n),this.node=t.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,n,i){return e&&e.isAnimationObjectGroup?new t.Composite(e,n,i):new t(e,n,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(xE,"")}static parseTrackName(e){let n=wE.exec(e);if(n===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);bE.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,n){if(n===void 0||n===""||n==="."||n===-1||n===e.name||n===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(n);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===n||a.uuid===n)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,n){e[n]=this.targetObject[this.propertyName]}_getValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[n++]=i[r]}_getValue_arrayElement(e,n){e[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,n){this.resolvedProperty.toArray(e,n)}_setValue_direct(e,n){this.targetObject[this.propertyName]=e[n]}_setValue_direct_setNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,n){this.targetObject[this.propertyName]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++]}_setValue_array_setNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,n){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,n){this.resolvedProperty[this.propertyIndex]=e[n]}_setValue_arrayElement_setNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty[this.propertyIndex]=e[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,n){this.resolvedProperty.fromArray(e,n)}_setValue_fromArray_setNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,n){this.resolvedProperty.fromArray(e,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,n){this.bind(),this.getValue(e,n)}_setValue_unbound(e,n){this.bind(),this.setValue(e,n)}bind(){let e=this.node,n=this.parsedPath,i=n.objectName,r=n.propertyName,s=n.propertyIndex;if(e||(e=t.findNode(this.rootNode,n.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Fe("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!e.material){Be("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Be("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Be("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let d=0;d<e.length;d++)if(e[d].name===c){c=d;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Be("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Be("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){Be("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(c!==void 0){if(e[c]===void 0){Be("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[r];if(o===void 0){let c=n.nodeName;Be("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){Be("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Be("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};wt.Composite=cm;wt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};wt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};wt.prototype.GetterByBindingType=[wt.prototype._getValue_direct,wt.prototype._getValue_array,wt.prototype._getValue_arrayElement,wt.prototype._getValue_toArray];wt.prototype.SetterByBindingTypeAndVersioning=[[wt.prototype._setValue_direct,wt.prototype._setValue_direct_setNeedsUpdate,wt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[wt.prototype._setValue_array,wt.prototype._setValue_array_setNeedsUpdate,wt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[wt.prototype._setValue_arrayElement,wt.prototype._setValue_arrayElement_setNeedsUpdate,wt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[wt.prototype._setValue_fromArray,wt.prototype._setValue_fromArray_setNeedsUpdate,wt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var XC=new Float32Array(1);var Vm=class Vm{constructor(e,n,i,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,n,i,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,n=0){for(let i=0;i<4;i++)this.elements[i]=e[i+n];return this}set(e,n,i,r){let s=this.elements;return s[0]=e,s[2]=n,s[1]=i,s[3]=r,this}};Vm.prototype.isMatrix2=!0;var um=Vm;function Fm(t,e,n,i){let r=TE(i);switch(n){case Tm:return t*e;case gh:return t*e/r.components*r.byteLength;case vh:return t*e/r.components*r.byteLength;case Zr:return t*e*2/r.components*r.byteLength;case xh:return t*e*2/r.components*r.byteLength;case Am:return t*e*3/r.components*r.byteLength;case ni:return t*e*4/r.components*r.byteLength;case _h:return t*e*4/r.components*r.byteLength;case pl:case ml:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case gl:case vl:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Sh:case Eh:return Math.max(t,16)*Math.max(e,8)/4;case yh:case Mh:return Math.max(t,8)*Math.max(e,8)/2;case wh:case bh:case Ah:case Ch:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*8;case Th:case xl:case Rh:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Ph:return Math.floor((t+3)/4)*Math.floor((e+3)/4)*16;case Ih:return Math.floor((t+4)/5)*Math.floor((e+3)/4)*16;case Lh:return Math.floor((t+4)/5)*Math.floor((e+4)/5)*16;case Nh:return Math.floor((t+5)/6)*Math.floor((e+4)/5)*16;case Dh:return Math.floor((t+5)/6)*Math.floor((e+5)/6)*16;case Uh:return Math.floor((t+7)/8)*Math.floor((e+4)/5)*16;case Fh:return Math.floor((t+7)/8)*Math.floor((e+5)/6)*16;case Oh:return Math.floor((t+7)/8)*Math.floor((e+7)/8)*16;case Bh:return Math.floor((t+9)/10)*Math.floor((e+4)/5)*16;case kh:return Math.floor((t+9)/10)*Math.floor((e+5)/6)*16;case zh:return Math.floor((t+9)/10)*Math.floor((e+7)/8)*16;case Vh:return Math.floor((t+9)/10)*Math.floor((e+9)/10)*16;case Gh:return Math.floor((t+11)/12)*Math.floor((e+9)/10)*16;case Hh:return Math.floor((t+11)/12)*Math.floor((e+11)/12)*16;case Wh:case Xh:case qh:return Math.ceil(t/4)*Math.ceil(e/4)*16;case Yh:case Zh:return Math.ceil(t/4)*Math.ceil(e/4)*8;case _l:case $h:return Math.ceil(t/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function TE(t){switch(t){case Pn:case Mm:return{byteLength:1,components:1};case Ro:case Em:case Fi:return{byteLength:2,components:1};case ph:case mh:return{byteLength:2,components:4};case vi:case fh:case ti:return{byteLength:4,components:1};case wm:case bm:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${t}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:ah}}));typeof window<"u"&&(window.__THREE__?Fe("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=ah);function wy(){let t=null,e=!1,n=null,i=null;function r(s,o){n(s,o),i=t.requestAnimationFrame(r)}return{start:function(){e!==!0&&n!==null&&t!==null&&(i=t.requestAnimationFrame(r),e=!0)},stop:function(){t!==null&&t.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){n=s},setContext:function(s){t=s}}}function AE(t){let e=new WeakMap;function n(a,l){let c=a.array,d=a.usage,f=c.byteLength,u=t.createBuffer();t.bindBuffer(l,u),t.bufferData(l,c,d),a.onUploadCallback();let p;if(c instanceof Float32Array)p=t.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)p=t.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?p=t.HALF_FLOAT:p=t.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=t.SHORT;else if(c instanceof Uint32Array)p=t.UNSIGNED_INT;else if(c instanceof Int32Array)p=t.INT;else if(c instanceof Int8Array)p=t.BYTE;else if(c instanceof Uint8Array)p=t.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=t.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:u,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:f}}function i(a,l,c){let d=l.array,f=l.updateRanges;if(t.bindBuffer(c,a),f.length===0)t.bufferSubData(c,0,d);else{f.sort((p,x)=>p.start-x.start);let u=0;for(let p=1;p<f.length;p++){let x=f[u],S=f[p];S.start<=x.start+x.count+1?x.count=Math.max(x.count,S.start+S.count-x.start):(++u,f[u]=S)}f.length=u+1;for(let p=0,x=f.length;p<x;p++){let S=f[p];t.bufferSubData(c,S.start*d.BYTES_PER_ELEMENT,d,S.start,S.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(t.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let d=e.get(a);(!d||d.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=e.get(a);if(c===void 0)e.set(a,n(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}var CE=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,RE=`#ifdef USE_ALPHAHASH
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
#endif`,PE=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,IE=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,LE=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,NE=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,DE=`#ifdef USE_AOMAP
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
#endif`,UE=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,FE=`#ifdef USE_BATCHING
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
#endif`,OE=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,BE=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,kE=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,zE=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,VE=`#ifdef USE_IRIDESCENCE
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
#endif`,GE=`#ifdef USE_BUMPMAP
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
#endif`,HE=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,WE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,XE=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,qE=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,YE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,ZE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,$E=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,JE=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,KE=`#define PI 3.141592653589793
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
} // validated`,jE=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,QE=`vec3 transformedNormal = objectNormal;
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
#endif`,ew=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,tw=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,nw=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,iw=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,rw="gl_FragColor = linearToOutputTexel( gl_FragColor );",sw=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,ow=`#ifdef USE_ENVMAP
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
#endif`,aw=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,lw=`#ifdef USE_ENVMAP
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
#endif`,cw=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,uw=`#ifdef USE_ENVMAP
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
#endif`,hw=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,dw=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,fw=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,pw=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,mw=`#ifdef USE_GRADIENTMAP
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
}`,gw=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,vw=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,xw=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,_w=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,yw=`#ifdef USE_ENVMAP
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
#endif`,Sw=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Mw=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Ew=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,ww=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,bw=`PhysicalMaterial material;
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
#endif`,Tw=`uniform sampler2D dfgLUT;
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
}`,Aw=`
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
#endif`,Cw=`#if defined( RE_IndirectDiffuse )
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
#endif`,Rw=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Pw=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,Iw=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Lw=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Nw=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Dw=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Uw=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Fw=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Ow=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,Bw=`#if defined( USE_POINTS_UV )
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
#endif`,kw=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,zw=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Vw=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Gw=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Hw=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Ww=`#ifdef USE_MORPHTARGETS
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
#endif`,Xw=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,qw=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,Yw=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,Zw=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,$w=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Jw=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Kw=`#ifdef USE_NORMALMAP
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
#endif`,jw=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Qw=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,eb=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,tb=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,nb=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,ib=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,rb=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,sb=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,ob=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,ab=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,lb=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,cb=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,ub=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,hb=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,db=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,fb=`float getShadowMask() {
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
}`,pb=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,mb=`#ifdef USE_SKINNING
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
#endif`,gb=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,vb=`#ifdef USE_SKINNING
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
#endif`,xb=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,_b=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,yb=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Sb=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Mb=`#ifdef USE_TRANSMISSION
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
#endif`,Eb=`#ifdef USE_TRANSMISSION
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
#endif`,wb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,bb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Tb=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Ab=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,Cb=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Rb=`uniform sampler2D t2D;
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
}`,Pb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Ib=`#ifdef ENVMAP_TYPE_CUBE
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
}`,Lb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Nb=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Db=`#include <common>
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
}`,Ub=`#if DEPTH_PACKING == 3200
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
}`,Fb=`#define DISTANCE
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
}`,Ob=`#define DISTANCE
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
}`,Bb=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,kb=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,zb=`uniform float scale;
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
}`,Vb=`uniform vec3 diffuse;
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
}`,Gb=`#include <common>
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
}`,Hb=`uniform vec3 diffuse;
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
}`,Wb=`#define LAMBERT
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
}`,Xb=`#define LAMBERT
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
}`,qb=`#define MATCAP
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
}`,Yb=`#define MATCAP
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
}`,Zb=`#define NORMAL
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
}`,$b=`#define NORMAL
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
}`,Jb=`#define PHONG
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
}`,Kb=`#define PHONG
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
}`,jb=`#define STANDARD
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
}`,Qb=`#define STANDARD
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
}`,eT=`#define TOON
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
}`,tT=`#define TOON
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
}`,nT=`uniform float size;
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
}`,iT=`uniform vec3 diffuse;
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
}`,rT=`#include <common>
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
}`,sT=`uniform vec3 color;
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
}`,oT=`uniform float rotation;
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
}`,aT=`uniform vec3 diffuse;
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
}`,He={alphahash_fragment:CE,alphahash_pars_fragment:RE,alphamap_fragment:PE,alphamap_pars_fragment:IE,alphatest_fragment:LE,alphatest_pars_fragment:NE,aomap_fragment:DE,aomap_pars_fragment:UE,batching_pars_vertex:FE,batching_vertex:OE,begin_vertex:BE,beginnormal_vertex:kE,bsdfs:zE,iridescence_fragment:VE,bumpmap_pars_fragment:GE,clipping_planes_fragment:HE,clipping_planes_pars_fragment:WE,clipping_planes_pars_vertex:XE,clipping_planes_vertex:qE,color_fragment:YE,color_pars_fragment:ZE,color_pars_vertex:$E,color_vertex:JE,common:KE,cube_uv_reflection_fragment:jE,defaultnormal_vertex:QE,displacementmap_pars_vertex:ew,displacementmap_vertex:tw,emissivemap_fragment:nw,emissivemap_pars_fragment:iw,colorspace_fragment:rw,colorspace_pars_fragment:sw,envmap_fragment:ow,envmap_common_pars_fragment:aw,envmap_pars_fragment:lw,envmap_pars_vertex:cw,envmap_physical_pars_fragment:yw,envmap_vertex:uw,fog_vertex:hw,fog_pars_vertex:dw,fog_fragment:fw,fog_pars_fragment:pw,gradientmap_pars_fragment:mw,lightmap_pars_fragment:gw,lights_lambert_fragment:vw,lights_lambert_pars_fragment:xw,lights_pars_begin:_w,lights_toon_fragment:Sw,lights_toon_pars_fragment:Mw,lights_phong_fragment:Ew,lights_phong_pars_fragment:ww,lights_physical_fragment:bw,lights_physical_pars_fragment:Tw,lights_fragment_begin:Aw,lights_fragment_maps:Cw,lights_fragment_end:Rw,lightprobes_pars_fragment:Pw,logdepthbuf_fragment:Iw,logdepthbuf_pars_fragment:Lw,logdepthbuf_pars_vertex:Nw,logdepthbuf_vertex:Dw,map_fragment:Uw,map_pars_fragment:Fw,map_particle_fragment:Ow,map_particle_pars_fragment:Bw,metalnessmap_fragment:kw,metalnessmap_pars_fragment:zw,morphinstance_vertex:Vw,morphcolor_vertex:Gw,morphnormal_vertex:Hw,morphtarget_pars_vertex:Ww,morphtarget_vertex:Xw,normal_fragment_begin:qw,normal_fragment_maps:Yw,normal_pars_fragment:Zw,normal_pars_vertex:$w,normal_vertex:Jw,normalmap_pars_fragment:Kw,clearcoat_normal_fragment_begin:jw,clearcoat_normal_fragment_maps:Qw,clearcoat_pars_fragment:eb,iridescence_pars_fragment:tb,opaque_fragment:nb,packing:ib,premultiplied_alpha_fragment:rb,project_vertex:sb,dithering_fragment:ob,dithering_pars_fragment:ab,roughnessmap_fragment:lb,roughnessmap_pars_fragment:cb,shadowmap_pars_fragment:ub,shadowmap_pars_vertex:hb,shadowmap_vertex:db,shadowmask_pars_fragment:fb,skinbase_vertex:pb,skinning_pars_vertex:mb,skinning_vertex:gb,skinnormal_vertex:vb,specularmap_fragment:xb,specularmap_pars_fragment:_b,tonemapping_fragment:yb,tonemapping_pars_fragment:Sb,transmission_fragment:Mb,transmission_pars_fragment:Eb,uv_pars_fragment:wb,uv_pars_vertex:bb,uv_vertex:Tb,worldpos_vertex:Ab,background_vert:Cb,background_frag:Rb,backgroundCube_vert:Pb,backgroundCube_frag:Ib,cube_vert:Lb,cube_frag:Nb,depth_vert:Db,depth_frag:Ub,distance_vert:Fb,distance_frag:Ob,equirect_vert:Bb,equirect_frag:kb,linedashed_vert:zb,linedashed_frag:Vb,meshbasic_vert:Gb,meshbasic_frag:Hb,meshlambert_vert:Wb,meshlambert_frag:Xb,meshmatcap_vert:qb,meshmatcap_frag:Yb,meshnormal_vert:Zb,meshnormal_frag:$b,meshphong_vert:Jb,meshphong_frag:Kb,meshphysical_vert:jb,meshphysical_frag:Qb,meshtoon_vert:eT,meshtoon_frag:tT,points_vert:nT,points_frag:iT,shadow_vert:rT,shadow_frag:sT,sprite_vert:oT,sprite_frag:aT},ve={common:{diffuse:{value:new Ke(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new ze},alphaMap:{value:null},alphaMapTransform:{value:new ze},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new ze}},envmap:{envMap:{value:null},envMapRotation:{value:new ze},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new ze}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new ze}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new ze},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new ze},normalScale:{value:new Ue(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new ze},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new ze}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new ze}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new ze}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ke(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new D},probesMax:{value:new D},probesResolution:{value:new D}},points:{diffuse:{value:new Ke(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new ze},alphaTest:{value:0},uvTransform:{value:new ze}},sprite:{diffuse:{value:new Ke(16777215)},opacity:{value:1},center:{value:new Ue(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new ze},alphaMap:{value:null},alphaMapTransform:{value:new ze},alphaTest:{value:0}}},Bi={basic:{uniforms:pn([ve.common,ve.specularmap,ve.envmap,ve.aomap,ve.lightmap,ve.fog]),vertexShader:He.meshbasic_vert,fragmentShader:He.meshbasic_frag},lambert:{uniforms:pn([ve.common,ve.specularmap,ve.envmap,ve.aomap,ve.lightmap,ve.emissivemap,ve.bumpmap,ve.normalmap,ve.displacementmap,ve.fog,ve.lights,{emissive:{value:new Ke(0)},envMapIntensity:{value:1}}]),vertexShader:He.meshlambert_vert,fragmentShader:He.meshlambert_frag},phong:{uniforms:pn([ve.common,ve.specularmap,ve.envmap,ve.aomap,ve.lightmap,ve.emissivemap,ve.bumpmap,ve.normalmap,ve.displacementmap,ve.fog,ve.lights,{emissive:{value:new Ke(0)},specular:{value:new Ke(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:He.meshphong_vert,fragmentShader:He.meshphong_frag},standard:{uniforms:pn([ve.common,ve.envmap,ve.aomap,ve.lightmap,ve.emissivemap,ve.bumpmap,ve.normalmap,ve.displacementmap,ve.roughnessmap,ve.metalnessmap,ve.fog,ve.lights,{emissive:{value:new Ke(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag},toon:{uniforms:pn([ve.common,ve.aomap,ve.lightmap,ve.emissivemap,ve.bumpmap,ve.normalmap,ve.displacementmap,ve.gradientmap,ve.fog,ve.lights,{emissive:{value:new Ke(0)}}]),vertexShader:He.meshtoon_vert,fragmentShader:He.meshtoon_frag},matcap:{uniforms:pn([ve.common,ve.bumpmap,ve.normalmap,ve.displacementmap,ve.fog,{matcap:{value:null}}]),vertexShader:He.meshmatcap_vert,fragmentShader:He.meshmatcap_frag},points:{uniforms:pn([ve.points,ve.fog]),vertexShader:He.points_vert,fragmentShader:He.points_frag},dashed:{uniforms:pn([ve.common,ve.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:He.linedashed_vert,fragmentShader:He.linedashed_frag},depth:{uniforms:pn([ve.common,ve.displacementmap]),vertexShader:He.depth_vert,fragmentShader:He.depth_frag},normal:{uniforms:pn([ve.common,ve.bumpmap,ve.normalmap,ve.displacementmap,{opacity:{value:1}}]),vertexShader:He.meshnormal_vert,fragmentShader:He.meshnormal_frag},sprite:{uniforms:pn([ve.sprite,ve.fog]),vertexShader:He.sprite_vert,fragmentShader:He.sprite_frag},background:{uniforms:{uvTransform:{value:new ze},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:He.background_vert,fragmentShader:He.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new ze}},vertexShader:He.backgroundCube_vert,fragmentShader:He.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:He.cube_vert,fragmentShader:He.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:He.equirect_vert,fragmentShader:He.equirect_frag},distance:{uniforms:pn([ve.common,ve.displacementmap,{referencePosition:{value:new D},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:He.distance_vert,fragmentShader:He.distance_frag},shadow:{uniforms:pn([ve.lights,ve.fog,{color:{value:new Ke(0)},opacity:{value:1}}]),vertexShader:He.shadow_vert,fragmentShader:He.shadow_frag}};Bi.physical={uniforms:pn([Bi.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new ze},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new ze},clearcoatNormalScale:{value:new Ue(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new ze},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new ze},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new ze},sheen:{value:0},sheenColor:{value:new Ke(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new ze},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new ze},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new ze},transmissionSamplerSize:{value:new Ue},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new ze},attenuationDistance:{value:0},attenuationColor:{value:new Ke(0)},specularColor:{value:new Ke(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new ze},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new ze},anisotropyVector:{value:new Ue},anisotropyMap:{value:null},anisotropyMapTransform:{value:new ze}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag};var jh={r:0,b:0,g:0},lT=new yt,by=new ze;by.set(-1,0,0,0,1,0,0,0,1);function cT(t,e,n,i,r,s){let o=new Ke(0),a=r===!0?0:1,l,c,d=null,f=0,u=null;function p(g){let _=g.isScene===!0?g.background:null;if(_&&_.isTexture){let M=g.backgroundBlurriness>0;_=e.get(_,M)}return _}function x(g){let _=!1,M=p(g);M===null?v(o,a):M&&M.isColor&&(v(M,1),_=!0);let C=t.xr.getEnvironmentBlendMode();C==="additive"?n.buffers.color.setClear(0,0,0,1,s):C==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,s),(t.autoClear||_)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),t.clear(t.autoClearColor,t.autoClearDepth,t.autoClearStencil))}function S(g,_){let M=p(_);M&&(M.isCubeTexture||M.mapping===dl)?(c===void 0&&(c=new Qe(new zr(1,1,1),new Vn({name:"BackgroundCubeMaterial",uniforms:Ms(Bi.backgroundCube.uniforms),vertexShader:Bi.backgroundCube.vertexShader,fragmentShader:Bi.backgroundCube.fragmentShader,side:Wt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(C,b,R){this.matrixWorld.copyPosition(R.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(c)),c.material.uniforms.envMap.value=M,c.material.uniforms.backgroundBlurriness.value=_.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=_.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(lT.makeRotationFromEuler(_.backgroundRotation)).transpose(),M.isCubeTexture&&M.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(by),c.material.toneMapped=je.getTransfer(M.colorSpace)!==ut,(d!==M||f!==M.version||u!==t.toneMapping)&&(c.material.needsUpdate=!0,d=M,f=M.version,u=t.toneMapping),c.layers.enableAll(),g.unshift(c,c.geometry,c.material,0,0,null)):M&&M.isTexture&&(l===void 0&&(l=new Qe(new tl(2,2),new Vn({name:"BackgroundMaterial",uniforms:Ms(Bi.background.uniforms),vertexShader:Bi.background.vertexShader,fragmentShader:Bi.background.fragmentShader,side:nr,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=M,l.material.uniforms.backgroundIntensity.value=_.backgroundIntensity,l.material.toneMapped=je.getTransfer(M.colorSpace)!==ut,M.matrixAutoUpdate===!0&&M.updateMatrix(),l.material.uniforms.uvTransform.value.copy(M.matrix),(d!==M||f!==M.version||u!==t.toneMapping)&&(l.material.needsUpdate=!0,d=M,f=M.version,u=t.toneMapping),l.layers.enableAll(),g.unshift(l,l.geometry,l.material,0,0,null))}function v(g,_){g.getRGB(jh,Nm(t)),n.buffers.color.setClear(jh.r,jh.g,jh.b,_,s)}function h(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(g,_=1){o.set(g),a=_,v(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(g){a=g,v(o,a)},render:x,addToRenderList:S,dispose:h}}function uT(t,e){let n=t.getParameter(t.MAX_VERTEX_ATTRIBS),i={},r=u(null),s=r,o=!1;function a(A,P,O,z,L){let B=!1,G=f(A,z,O,P);s!==G&&(s=G,c(s.object)),B=p(A,z,O,L),B&&x(A,z,O,L),L!==null&&e.update(L,t.ELEMENT_ARRAY_BUFFER),(B||o)&&(o=!1,M(A,P,O,z),L!==null&&t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,e.get(L).buffer))}function l(){return t.createVertexArray()}function c(A){return t.bindVertexArray(A)}function d(A){return t.deleteVertexArray(A)}function f(A,P,O,z){let L=z.wireframe===!0,B=i[P.id];B===void 0&&(B={},i[P.id]=B);let G=A.isInstancedMesh===!0?A.id:0,q=B[G];q===void 0&&(q={},B[G]=q);let J=q[O.id];J===void 0&&(J={},q[O.id]=J);let j=J[L];return j===void 0&&(j=u(l()),J[L]=j),j}function u(A){let P=[],O=[],z=[];for(let L=0;L<n;L++)P[L]=0,O[L]=0,z[L]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:P,enabledAttributes:O,attributeDivisors:z,object:A,attributes:{},index:null}}function p(A,P,O,z){let L=s.attributes,B=P.attributes,G=0,q=O.getAttributes();for(let J in q)if(q[J].location>=0){let ue=L[J],U=B[J];if(U===void 0&&(J==="instanceMatrix"&&A.instanceMatrix&&(U=A.instanceMatrix),J==="instanceColor"&&A.instanceColor&&(U=A.instanceColor)),ue===void 0||ue.attribute!==U||U&&ue.data!==U.data)return!0;G++}return s.attributesNum!==G||s.index!==z}function x(A,P,O,z){let L={},B=P.attributes,G=0,q=O.getAttributes();for(let J in q)if(q[J].location>=0){let ue=B[J];ue===void 0&&(J==="instanceMatrix"&&A.instanceMatrix&&(ue=A.instanceMatrix),J==="instanceColor"&&A.instanceColor&&(ue=A.instanceColor));let U={};U.attribute=ue,ue&&ue.data&&(U.data=ue.data),L[J]=U,G++}s.attributes=L,s.attributesNum=G,s.index=z}function S(){let A=s.newAttributes;for(let P=0,O=A.length;P<O;P++)A[P]=0}function v(A){h(A,0)}function h(A,P){let O=s.newAttributes,z=s.enabledAttributes,L=s.attributeDivisors;O[A]=1,z[A]===0&&(t.enableVertexAttribArray(A),z[A]=1),L[A]!==P&&(t.vertexAttribDivisor(A,P),L[A]=P)}function g(){let A=s.newAttributes,P=s.enabledAttributes;for(let O=0,z=P.length;O<z;O++)P[O]!==A[O]&&(t.disableVertexAttribArray(O),P[O]=0)}function _(A,P,O,z,L,B,G){G===!0?t.vertexAttribIPointer(A,P,O,L,B):t.vertexAttribPointer(A,P,O,z,L,B)}function M(A,P,O,z){S();let L=z.attributes,B=O.getAttributes(),G=P.defaultAttributeValues;for(let q in B){let J=B[q];if(J.location>=0){let j=L[q];if(j===void 0&&(q==="instanceMatrix"&&A.instanceMatrix&&(j=A.instanceMatrix),q==="instanceColor"&&A.instanceColor&&(j=A.instanceColor)),j!==void 0){let ue=j.normalized,U=j.itemSize,ne=e.get(j);if(ne===void 0)continue;let Ne=ne.buffer,he=ne.type,Q=ne.bytesPerElement,me=he===t.INT||he===t.UNSIGNED_INT||j.gpuType===fh;if(j.isInterleavedBufferAttribute){let le=j.data,Ae=le.stride,Ie=j.offset;if(le.isInstancedInterleavedBuffer){for(let Te=0;Te<J.locationSize;Te++)h(J.location+Te,le.meshPerAttribute);A.isInstancedMesh!==!0&&z._maxInstanceCount===void 0&&(z._maxInstanceCount=le.meshPerAttribute*le.count)}else for(let Te=0;Te<J.locationSize;Te++)v(J.location+Te);t.bindBuffer(t.ARRAY_BUFFER,Ne);for(let Te=0;Te<J.locationSize;Te++)_(J.location+Te,U/J.locationSize,he,ue,Ae*Q,(Ie+U/J.locationSize*Te)*Q,me)}else{if(j.isInstancedBufferAttribute){for(let le=0;le<J.locationSize;le++)h(J.location+le,j.meshPerAttribute);A.isInstancedMesh!==!0&&z._maxInstanceCount===void 0&&(z._maxInstanceCount=j.meshPerAttribute*j.count)}else for(let le=0;le<J.locationSize;le++)v(J.location+le);t.bindBuffer(t.ARRAY_BUFFER,Ne);for(let le=0;le<J.locationSize;le++)_(J.location+le,U/J.locationSize,he,ue,U*Q,U/J.locationSize*le*Q,me)}}else if(G!==void 0){let ue=G[q];if(ue!==void 0)switch(ue.length){case 2:t.vertexAttrib2fv(J.location,ue);break;case 3:t.vertexAttrib3fv(J.location,ue);break;case 4:t.vertexAttrib4fv(J.location,ue);break;default:t.vertexAttrib1fv(J.location,ue)}}}}g()}function C(){T();for(let A in i){let P=i[A];for(let O in P){let z=P[O];for(let L in z){let B=z[L];for(let G in B)d(B[G].object),delete B[G];delete z[L]}}delete i[A]}}function b(A){if(i[A.id]===void 0)return;let P=i[A.id];for(let O in P){let z=P[O];for(let L in z){let B=z[L];for(let G in B)d(B[G].object),delete B[G];delete z[L]}}delete i[A.id]}function R(A){for(let P in i){let O=i[P];for(let z in O){let L=O[z];if(L[A.id]===void 0)continue;let B=L[A.id];for(let G in B)d(B[G].object),delete B[G];delete L[A.id]}}}function m(A){for(let P in i){let O=i[P],z=A.isInstancedMesh===!0?A.id:0,L=O[z];if(L!==void 0){for(let B in L){let G=L[B];for(let q in G)d(G[q].object),delete G[q];delete L[B]}delete O[z],Object.keys(O).length===0&&delete i[P]}}}function T(){I(),o=!0,s!==r&&(s=r,c(s.object))}function I(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:T,resetDefaultState:I,dispose:C,releaseStatesOfGeometry:b,releaseStatesOfObject:m,releaseStatesOfProgram:R,initAttributes:S,enableAttribute:v,disableUnusedAttributes:g}}function hT(t,e,n){let i;function r(l){i=l}function s(l,c){t.drawArrays(i,l,c),n.update(c,i,1)}function o(l,c,d){d!==0&&(t.drawArraysInstanced(i,l,c,d),n.update(c,i,d))}function a(l,c,d){if(d===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,c,0,d);let u=0;for(let p=0;p<d;p++)u+=c[p];n.update(u,i,1)}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a}function dT(t,e,n,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let R=e.get("EXT_texture_filter_anisotropic");r=t.getParameter(R.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(R){return!(R!==ni&&i.convert(R)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(R){let m=R===Fi&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(R!==Pn&&i.convert(R)!==t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE)&&R!==ti&&!m)}function l(R){if(R==="highp"){if(t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.HIGH_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.HIGH_FLOAT).precision>0)return"highp";R="mediump"}return R==="mediump"&&t.getShaderPrecisionFormat(t.VERTEX_SHADER,t.MEDIUM_FLOAT).precision>0&&t.getShaderPrecisionFormat(t.FRAGMENT_SHADER,t.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",d=l(c);d!==c&&(Fe("WebGLRenderer:",c,"not supported, using",d,"instead."),c=d);let f=n.logarithmicDepthBuffer===!0,u=n.reversedDepthBuffer===!0&&e.has("EXT_clip_control");n.reversedDepthBuffer===!0&&u===!1&&Fe("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let p=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),x=t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),S=t.getParameter(t.MAX_TEXTURE_SIZE),v=t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),h=t.getParameter(t.MAX_VERTEX_ATTRIBS),g=t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),_=t.getParameter(t.MAX_VARYING_VECTORS),M=t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),C=t.getParameter(t.MAX_SAMPLES),b=t.getParameter(t.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:f,reversedDepthBuffer:u,maxTextures:p,maxVertexTextures:x,maxTextureSize:S,maxCubemapSize:v,maxAttributes:h,maxVertexUniforms:g,maxVaryings:_,maxFragmentUniforms:M,maxSamples:C,samples:b}}function fT(t){let e=this,n=null,i=0,r=!1,s=!1,o=new Ai,a=new ze,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(f,u){let p=f.length!==0||u||i!==0||r;return r=u,i=f.length,p},this.beginShadows=function(){s=!0,d(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(f,u){n=d(f,u,0)},this.setState=function(f,u,p){let x=f.clippingPlanes,S=f.clipIntersection,v=f.clipShadows,h=t.get(f);if(!r||x===null||x.length===0||s&&!v)s?d(null):c();else{let g=s?0:i,_=g*4,M=h.clippingState||null;l.value=M,M=d(x,u,_,p);for(let C=0;C!==_;++C)M[C]=n[C];h.clippingState=M,this.numIntersection=S?this.numPlanes:0,this.numPlanes+=g}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function d(f,u,p,x){let S=f!==null?f.length:0,v=null;if(S!==0){if(v=l.value,x!==!0||v===null){let h=p+S*4,g=u.matrixWorldInverse;a.getNormalMatrix(g),(v===null||v.length<h)&&(v=new Float32Array(h));for(let _=0,M=p;_!==S;++_,M+=4)o.copy(f[_]).applyMatrix4(g,a),o.normal.toArray(v,M),v[M+3]=o.constant}l.value=v,l.needsUpdate=!0}return e.numPlanes=S,e.numIntersection=0,v}}var $r=4,ny=[.125,.215,.35,.446,.526,.582],Es=20,pT=256,Sl=new Wr,iy=new Ke,Gm=null,Hm=0,Wm=0,Xm=!1,mT=new D,Do=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,n=0,i=.1,r=100,s={}){let{size:o=256,position:a=mT}=s;Gm=this._renderer.getRenderTarget(),Hm=this._renderer.getActiveCubeFace(),Wm=this._renderer.getActiveMipmapLevel(),Xm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,n=null){return this._fromTexture(e,n)}fromCubemap(e,n=null){return this._fromTexture(e,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=oy(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=sy(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(Gm,Hm,Wm),this._renderer.xr.enabled=Xm,e.scissorTest=!1,Lo(e,0,0,e.width,e.height)}_fromTexture(e,n){e.mapping===Xr||e.mapping===Ss?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Gm=this._renderer.getRenderTarget(),Hm=this._renderer.getActiveCubeFace(),Wm=this._renderer.getActiveMipmapLevel(),Xm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:rn,minFilter:rn,generateMipmaps:!1,type:Fi,format:ni,colorSpace:za,depthBuffer:!1},r=ry(e,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=ry(e,n,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=gT(s)),this._blurMaterial=xT(s,e,n),this._ggxMaterial=vT(s,e,n)}return r}_compileMaterial(e){let n=new Qe(new fn,e);this._renderer.compile(n,Sl)}_sceneToCubeUV(e,n,i,r,s){let l=new Sn(90,1,n,i),c=[1,-1,1,1,1,1],d=[1,1,1,-1,-1,-1],f=this._renderer,u=f.autoClear,p=f.toneMapping;f.getClearColor(iy),f.toneMapping=gi,f.autoClear=!1,f.state.buffers.depth.getReversed()&&(f.setRenderTarget(r),f.clearDepth(),f.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Qe(new zr,new Ya({name:"PMREM.Background",side:Wt,depthWrite:!1,depthTest:!1})));let S=this._backgroundBox,v=S.material,h=!1,g=e.background;g?g.isColor&&(v.color.copy(g),e.background=null,h=!0):(v.color.copy(iy),h=!0);for(let _=0;_<6;_++){let M=_%3;M===0?(l.up.set(0,c[_],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+d[_],s.y,s.z)):M===1?(l.up.set(0,0,c[_]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+d[_],s.z)):(l.up.set(0,c[_],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+d[_]));let C=this._cubeSize;Lo(r,M*C,_>2?C:0,C,C),f.setRenderTarget(r),h&&f.render(S,l),f.render(e,l)}f.toneMapping=p,f.autoClear=u,e.background=g}_textureToCubeUV(e,n){let i=this._renderer,r=e.mapping===Xr||e.mapping===Ss;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=oy()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=sy());let s=r?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=s;let a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;Lo(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(o,Sl)}_applyPMREM(e){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);n.autoClear=i}_applyGGXFilter(e,n,i){let r=this._renderer,s=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[i];a.material=o;let l=o.uniforms,c=i/(this._lodMeshes.length-1),d=n/(this._lodMeshes.length-1),f=Math.sqrt(c*c-d*d),u=0+c*1.25,p=f*u,{_lodMax:x}=this,S=this._sizeLods[i],v=3*S*(i>x-$r?i-x+$r:0),h=4*(this._cubeSize-S);l.envMap.value=e.texture,l.roughness.value=p,l.mipInt.value=x-n,Lo(s,v,h,3*S,2*S),r.setRenderTarget(s),r.render(a,Sl),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=x-i,Lo(e,v,h,3*S,2*S),r.setRenderTarget(e),r.render(a,Sl)}_blur(e,n,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,n,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,n,i,r,s,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&Be("blur direction must be either latitudinal or longitudinal!");let d=3,f=this._lodMeshes[r];f.material=c;let u=c.uniforms,p=this._sizeLods[i]-1,x=isFinite(s)?Math.PI/(2*p):2*Math.PI/(2*Es-1),S=s/x,v=isFinite(s)?1+Math.floor(d*S):Es;v>Es&&Fe(`sigmaRadians, ${s}, is too large and will clip, as it requested ${v} samples when the maximum is set to ${Es}`);let h=[],g=0;for(let R=0;R<Es;++R){let m=R/S,T=Math.exp(-m*m/2);h.push(T),R===0?g+=T:R<v&&(g+=2*T)}for(let R=0;R<h.length;R++)h[R]=h[R]/g;u.envMap.value=e.texture,u.samples.value=v,u.weights.value=h,u.latitudinal.value=o==="latitudinal",a&&(u.poleAxis.value=a);let{_lodMax:_}=this;u.dTheta.value=x,u.mipInt.value=_-i;let M=this._sizeLods[r],C=3*M*(r>_-$r?r-_+$r:0),b=4*(this._cubeSize-M);Lo(n,C,b,3*M,2*M),l.setRenderTarget(n),l.render(f,Sl)}};function gT(t){let e=[],n=[],i=[],r=t,s=t-$r+1+ny.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);e.push(a);let l=1/a;o>t-$r?l=ny[o-t+$r-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),d=-c,f=1+c,u=[d,d,f,d,f,f,d,d,f,f,d,f],p=6,x=6,S=3,v=2,h=1,g=new Float32Array(S*x*p),_=new Float32Array(v*x*p),M=new Float32Array(h*x*p);for(let b=0;b<p;b++){let R=b%3*2/3-1,m=b>2?0:-1,T=[R,m,0,R+2/3,m,0,R+2/3,m+1,0,R,m,0,R+2/3,m+1,0,R,m+1,0];g.set(T,S*x*b),_.set(u,v*x*b);let I=[b,b,b,b,b,b];M.set(I,h*x*b)}let C=new fn;C.setAttribute("position",new Jt(g,S)),C.setAttribute("uv",new Jt(_,v)),C.setAttribute("faceIndex",new Jt(M,h)),i.push(new Qe(C,null)),r>$r&&r--}return{lodMeshes:i,sizeLods:e,sigmas:n}}function ry(t,e,n){let i=new zn(t,e,n);return i.texture.mapping=dl,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function Lo(t,e,n,i,r){t.viewport.set(e,n,i,r),t.scissor.set(e,n,i,r)}function vT(t,e,n){return new Vn({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:pT,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:nd(),fragmentShader:`

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
		`,blending:Ui,depthTest:!1,depthWrite:!1})}function xT(t,e,n){let i=new Float32Array(Es),r=new D(0,1,0);return new Vn({name:"SphericalGaussianBlur",defines:{n:Es,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${t}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:nd(),fragmentShader:`

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
		`,blending:Ui,depthTest:!1,depthWrite:!1})}function sy(){return new Vn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:nd(),fragmentShader:`

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
		`,blending:Ui,depthTest:!1,depthWrite:!1})}function oy(){return new Vn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:nd(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Ui,depthTest:!1,depthWrite:!1})}function nd(){return`

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
	`}var ed=class extends zn{constructor(e=1,n={}){super(e,e,n),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new Ka(r),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new zr(5,5,5),s=new Vn({name:"CubemapFromEquirect",uniforms:Ms(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:Wt,blending:Ui});s.uniforms.tEquirect.value=n;let o=new Qe(r,s),a=n.minFilter;return n.minFilter===qr&&(n.minFilter=rn),new rh(1,10,this).update(e,o),n.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,n=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(n,i,r);e.setRenderTarget(s)}};function _T(t){let e=new WeakMap,n=new WeakMap,i=null;function r(u,p=!1){return u==null?null:p?o(u):s(u)}function s(u){if(u&&u.isTexture){let p=u.mapping;if(p===uh||p===hh)if(e.has(u)){let x=e.get(u).texture;return a(x,u.mapping)}else{let x=u.image;if(x&&x.height>0){let S=new ed(x.height);return S.fromEquirectangularTexture(t,u),e.set(u,S),u.addEventListener("dispose",c),a(S.texture,u.mapping)}else return null}}return u}function o(u){if(u&&u.isTexture){let p=u.mapping,x=p===uh||p===hh,S=p===Xr||p===Ss;if(x||S){let v=n.get(u),h=v!==void 0?v.texture.pmremVersion:0;if(u.isRenderTargetTexture&&u.pmremVersion!==h)return i===null&&(i=new Do(t)),v=x?i.fromEquirectangular(u,v):i.fromCubemap(u,v),v.texture.pmremVersion=u.pmremVersion,n.set(u,v),v.texture;if(v!==void 0)return v.texture;{let g=u.image;return x&&g&&g.height>0||S&&g&&l(g)?(i===null&&(i=new Do(t)),v=x?i.fromEquirectangular(u):i.fromCubemap(u),v.texture.pmremVersion=u.pmremVersion,n.set(u,v),u.addEventListener("dispose",d),v.texture):null}}}return u}function a(u,p){return p===uh?u.mapping=Xr:p===hh&&(u.mapping=Ss),u}function l(u){let p=0,x=6;for(let S=0;S<x;S++)u[S]!==void 0&&p++;return p===x}function c(u){let p=u.target;p.removeEventListener("dispose",c);let x=e.get(p);x!==void 0&&(e.delete(p),x.dispose())}function d(u){let p=u.target;p.removeEventListener("dispose",d);let x=n.get(p);x!==void 0&&(n.delete(p),x.dispose())}function f(){e=new WeakMap,n=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:f}}function yT(t){let e={};function n(i){if(e[i]!==void 0)return e[i];let r=t.getExtension(i);return e[i]=r,r}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let r=n(i);return r===null&&Iu("WebGLRenderer: "+i+" extension not supported."),r}}}function ST(t,e,n,i){let r={},s=new WeakMap;function o(f){let u=f.target;u.index!==null&&e.remove(u.index);for(let x in u.attributes)e.remove(u.attributes[x]);u.removeEventListener("dispose",o),delete r[u.id];let p=s.get(u);p&&(e.remove(p),s.delete(u)),i.releaseStatesOfGeometry(u),u.isInstancedBufferGeometry===!0&&delete u._maxInstanceCount,n.memory.geometries--}function a(f,u){return r[u.id]===!0||(u.addEventListener("dispose",o),r[u.id]=!0,n.memory.geometries++),u}function l(f){let u=f.attributes;for(let p in u)e.update(u[p],t.ARRAY_BUFFER)}function c(f){let u=[],p=f.index,x=f.attributes.position,S=0;if(x===void 0)return;if(p!==null){let g=p.array;S=p.version;for(let _=0,M=g.length;_<M;_+=3){let C=g[_+0],b=g[_+1],R=g[_+2];u.push(C,b,b,R,R,C)}}else{let g=x.array;S=x.version;for(let _=0,M=g.length/3-1;_<M;_+=3){let C=_+0,b=_+1,R=_+2;u.push(C,b,b,R,R,C)}}let v=new(x.count>=65535?qa:Xa)(u,1);v.version=S;let h=s.get(f);h&&e.remove(h),s.set(f,v)}function d(f){let u=s.get(f);if(u){let p=f.index;p!==null&&u.version<p.version&&c(f)}else c(f);return s.get(f)}return{get:a,update:l,getWireframeAttribute:d}}function MT(t,e,n){let i;function r(f){i=f}let s,o;function a(f){s=f.type,o=f.bytesPerElement}function l(f,u){t.drawElements(i,u,s,f*o),n.update(u,i,1)}function c(f,u,p){p!==0&&(t.drawElementsInstanced(i,u,s,f*o,p),n.update(u,i,p))}function d(f,u,p){if(p===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,u,0,s,f,0,p);let S=0;for(let v=0;v<p;v++)S+=u[v];n.update(S,i,1)}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=d}function ET(t){let e={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(n.calls++,o){case t.TRIANGLES:n.triangles+=a*(s/3);break;case t.LINES:n.lines+=a*(s/2);break;case t.LINE_STRIP:n.lines+=a*(s-1);break;case t.LINE_LOOP:n.lines+=a*s;break;case t.POINTS:n.points+=a*s;break;default:Be("WebGLInfo: Unknown draw mode:",o);break}}function r(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:e,render:n,programs:null,autoReset:!0,reset:r,update:i}}function wT(t,e,n){let i=new WeakMap,r=new It;function s(o,a,l){let c=o.morphTargetInfluences,d=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,f=d!==void 0?d.length:0,u=i.get(a);if(u===void 0||u.count!==f){let T=function(){R.dispose(),i.delete(a),a.removeEventListener("dispose",T)};u!==void 0&&u.texture.dispose();let p=a.morphAttributes.position!==void 0,x=a.morphAttributes.normal!==void 0,S=a.morphAttributes.color!==void 0,v=a.morphAttributes.position||[],h=a.morphAttributes.normal||[],g=a.morphAttributes.color||[],_=0;p===!0&&(_=1),x===!0&&(_=2),S===!0&&(_=3);let M=a.attributes.position.count*_,C=1;M>e.maxTextureSize&&(C=Math.ceil(M/e.maxTextureSize),M=e.maxTextureSize);let b=new Float32Array(M*C*4*f),R=new Ha(b,M,C,f);R.type=ti,R.needsUpdate=!0;let m=_*4;for(let I=0;I<f;I++){let A=v[I],P=h[I],O=g[I],z=M*C*4*I;for(let L=0;L<A.count;L++){let B=L*m;p===!0&&(r.fromBufferAttribute(A,L),b[z+B+0]=r.x,b[z+B+1]=r.y,b[z+B+2]=r.z,b[z+B+3]=0),x===!0&&(r.fromBufferAttribute(P,L),b[z+B+4]=r.x,b[z+B+5]=r.y,b[z+B+6]=r.z,b[z+B+7]=0),S===!0&&(r.fromBufferAttribute(O,L),b[z+B+8]=r.x,b[z+B+9]=r.y,b[z+B+10]=r.z,b[z+B+11]=O.itemSize===4?r.w:1)}}u={count:f,texture:R,size:new Ue(M,C)},i.set(a,u),a.addEventListener("dispose",T)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(t,"morphTexture",o.morphTexture,n);else{let p=0;for(let S=0;S<c.length;S++)p+=c[S];let x=a.morphTargetsRelative?1:1-p;l.getUniforms().setValue(t,"morphTargetBaseInfluence",x),l.getUniforms().setValue(t,"morphTargetInfluences",c)}l.getUniforms().setValue(t,"morphTargetsTexture",u.texture,n),l.getUniforms().setValue(t,"morphTargetsTextureSize",u.size)}return{update:s}}function bT(t,e,n,i,r){let s=new WeakMap;function o(c){let d=r.render.frame,f=c.geometry,u=e.get(c,f);if(s.get(u)!==d&&(e.update(u),s.set(u,d)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==d&&(n.update(c.instanceMatrix,t.ARRAY_BUFFER),c.instanceColor!==null&&n.update(c.instanceColor,t.ARRAY_BUFFER),s.set(c,d))),c.isSkinnedMesh){let p=c.skeleton;s.get(p)!==d&&(p.update(),s.set(p,d))}return u}function a(){s=new WeakMap}function l(c){let d=c.target;d.removeEventListener("dispose",l),i.releaseStatesOfObject(d),n.remove(d.instanceMatrix),d.instanceColor!==null&&n.remove(d.instanceColor)}return{update:o,dispose:a}}var TT={[mm]:"LINEAR_TONE_MAPPING",[gm]:"REINHARD_TONE_MAPPING",[vm]:"CINEON_TONE_MAPPING",[hl]:"ACES_FILMIC_TONE_MAPPING",[_m]:"AGX_TONE_MAPPING",[ym]:"NEUTRAL_TONE_MAPPING",[xm]:"CUSTOM_TONE_MAPPING"};function AT(t,e,n,i,r){let s=new zn(e,n,{type:t,depthBuffer:i,stencilBuffer:r,depthTexture:i?new rr(e,n):void 0}),o=new zn(e,n,{type:Fi,depthBuffer:!1,stencilBuffer:!1}),a=new fn;a.setAttribute("position",new Tt([-1,3,0,-1,-1,0,3,-1,0],3)),a.setAttribute("uv",new Tt([0,2,0,0,2,0],2));let l=new Wu({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),c=new Qe(a,l),d=new Wr(-1,1,1,-1,0,1),f=null,u=null,p=!1,x,S=null,v=[],h=!1;this.setSize=function(g,_){s.setSize(g,_),o.setSize(g,_);for(let M=0;M<v.length;M++){let C=v[M];C.setSize&&C.setSize(g,_)}},this.setEffects=function(g){v=g,h=v.length>0&&v[0].isRenderPass===!0;let _=s.width,M=s.height;for(let C=0;C<v.length;C++){let b=v[C];b.setSize&&b.setSize(_,M)}},this.begin=function(g,_){if(p||g.toneMapping===gi&&v.length===0)return!1;if(S=_,_!==null){let M=_.width,C=_.height;(s.width!==M||s.height!==C)&&this.setSize(M,C)}return h===!1&&g.setRenderTarget(s),x=g.toneMapping,g.toneMapping=gi,!0},this.hasRenderPass=function(){return h},this.end=function(g,_){g.toneMapping=x,p=!0;let M=s,C=o;for(let b=0;b<v.length;b++){let R=v[b];if(R.enabled!==!1&&(R.render(g,C,M,_),R.needsSwap!==!1)){let m=M;M=C,C=m}}if(f!==g.outputColorSpace||u!==g.toneMapping){f=g.outputColorSpace,u=g.toneMapping,l.defines={},je.getTransfer(f)===ut&&(l.defines.SRGB_TRANSFER="");let b=TT[u];b&&(l.defines[b]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=M.texture,g.setRenderTarget(S),g.render(c,d),S=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){s.depthTexture&&s.depthTexture.dispose(),s.dispose(),o.dispose(),a.dispose(),l.dispose()}}var Ty=new Cn,Zm=new rr(1,1),Ay=new Ha,Cy=new Du,Ry=new Ka,ay=[],ly=[],cy=new Float32Array(16),uy=new Float32Array(9),hy=new Float32Array(4);function Uo(t,e,n){let i=t[0];if(i<=0||i>0)return t;let r=e*n,s=ay[r];if(s===void 0&&(s=new Float32Array(r),ay[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=n,t[o].toArray(s,a)}return s}function Xt(t,e){if(t.length!==e.length)return!1;for(let n=0,i=t.length;n<i;n++)if(t[n]!==e[n])return!1;return!0}function qt(t,e){for(let n=0,i=e.length;n<i;n++)t[n]=e[n]}function id(t,e){let n=ly[e];n===void 0&&(n=new Int32Array(e),ly[e]=n);for(let i=0;i!==e;++i)n[i]=t.allocateTextureUnit();return n}function CT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1f(this.addr,e),n[0]=e)}function RT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2f(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Xt(n,e))return;t.uniform2fv(this.addr,e),qt(n,e)}}function PT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3f(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else if(e.r!==void 0)(n[0]!==e.r||n[1]!==e.g||n[2]!==e.b)&&(t.uniform3f(this.addr,e.r,e.g,e.b),n[0]=e.r,n[1]=e.g,n[2]=e.b);else{if(Xt(n,e))return;t.uniform3fv(this.addr,e),qt(n,e)}}function IT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4f(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Xt(n,e))return;t.uniform4fv(this.addr,e),qt(n,e)}}function LT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Xt(n,e))return;t.uniformMatrix2fv(this.addr,!1,e),qt(n,e)}else{if(Xt(n,i))return;hy.set(i),t.uniformMatrix2fv(this.addr,!1,hy),qt(n,i)}}function NT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Xt(n,e))return;t.uniformMatrix3fv(this.addr,!1,e),qt(n,e)}else{if(Xt(n,i))return;uy.set(i),t.uniformMatrix3fv(this.addr,!1,uy),qt(n,i)}}function DT(t,e){let n=this.cache,i=e.elements;if(i===void 0){if(Xt(n,e))return;t.uniformMatrix4fv(this.addr,!1,e),qt(n,e)}else{if(Xt(n,i))return;cy.set(i),t.uniformMatrix4fv(this.addr,!1,cy),qt(n,i)}}function UT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1i(this.addr,e),n[0]=e)}function FT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2i(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Xt(n,e))return;t.uniform2iv(this.addr,e),qt(n,e)}}function OT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3i(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Xt(n,e))return;t.uniform3iv(this.addr,e),qt(n,e)}}function BT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4i(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Xt(n,e))return;t.uniform4iv(this.addr,e),qt(n,e)}}function kT(t,e){let n=this.cache;n[0]!==e&&(t.uniform1ui(this.addr,e),n[0]=e)}function zT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y)&&(t.uniform2ui(this.addr,e.x,e.y),n[0]=e.x,n[1]=e.y);else{if(Xt(n,e))return;t.uniform2uiv(this.addr,e),qt(n,e)}}function VT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z)&&(t.uniform3ui(this.addr,e.x,e.y,e.z),n[0]=e.x,n[1]=e.y,n[2]=e.z);else{if(Xt(n,e))return;t.uniform3uiv(this.addr,e),qt(n,e)}}function GT(t,e){let n=this.cache;if(e.x!==void 0)(n[0]!==e.x||n[1]!==e.y||n[2]!==e.z||n[3]!==e.w)&&(t.uniform4ui(this.addr,e.x,e.y,e.z,e.w),n[0]=e.x,n[1]=e.y,n[2]=e.z,n[3]=e.w);else{if(Xt(n,e))return;t.uniform4uiv(this.addr,e),qt(n,e)}}function HT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r);let s;this.type===t.SAMPLER_2D_SHADOW?(Zm.compareFunction=n.isReversedDepthBuffer()?Kh:Jh,s=Zm):s=Ty,n.setTexture2D(e||s,r)}function WT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture3D(e||Cy,r)}function XT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTextureCube(e||Ry,r)}function qT(t,e,n){let i=this.cache,r=n.allocateTextureUnit();i[0]!==r&&(t.uniform1i(this.addr,r),i[0]=r),n.setTexture2DArray(e||Ay,r)}function YT(t){switch(t){case 5126:return CT;case 35664:return RT;case 35665:return PT;case 35666:return IT;case 35674:return LT;case 35675:return NT;case 35676:return DT;case 5124:case 35670:return UT;case 35667:case 35671:return FT;case 35668:case 35672:return OT;case 35669:case 35673:return BT;case 5125:return kT;case 36294:return zT;case 36295:return VT;case 36296:return GT;case 35678:case 36198:case 36298:case 36306:case 35682:return HT;case 35679:case 36299:case 36307:return WT;case 35680:case 36300:case 36308:case 36293:return XT;case 36289:case 36303:case 36311:case 36292:return qT}}function ZT(t,e){t.uniform1fv(this.addr,e)}function $T(t,e){let n=Uo(e,this.size,2);t.uniform2fv(this.addr,n)}function JT(t,e){let n=Uo(e,this.size,3);t.uniform3fv(this.addr,n)}function KT(t,e){let n=Uo(e,this.size,4);t.uniform4fv(this.addr,n)}function jT(t,e){let n=Uo(e,this.size,4);t.uniformMatrix2fv(this.addr,!1,n)}function QT(t,e){let n=Uo(e,this.size,9);t.uniformMatrix3fv(this.addr,!1,n)}function eA(t,e){let n=Uo(e,this.size,16);t.uniformMatrix4fv(this.addr,!1,n)}function tA(t,e){t.uniform1iv(this.addr,e)}function nA(t,e){t.uniform2iv(this.addr,e)}function iA(t,e){t.uniform3iv(this.addr,e)}function rA(t,e){t.uniform4iv(this.addr,e)}function sA(t,e){t.uniform1uiv(this.addr,e)}function oA(t,e){t.uniform2uiv(this.addr,e)}function aA(t,e){t.uniform3uiv(this.addr,e)}function lA(t,e){t.uniform4uiv(this.addr,e)}function cA(t,e,n){let i=this.cache,r=e.length,s=id(n,r);Xt(i,s)||(t.uniform1iv(this.addr,s),qt(i,s));let o;this.type===t.SAMPLER_2D_SHADOW?o=Zm:o=Ty;for(let a=0;a!==r;++a)n.setTexture2D(e[a]||o,s[a])}function uA(t,e,n){let i=this.cache,r=e.length,s=id(n,r);Xt(i,s)||(t.uniform1iv(this.addr,s),qt(i,s));for(let o=0;o!==r;++o)n.setTexture3D(e[o]||Cy,s[o])}function hA(t,e,n){let i=this.cache,r=e.length,s=id(n,r);Xt(i,s)||(t.uniform1iv(this.addr,s),qt(i,s));for(let o=0;o!==r;++o)n.setTextureCube(e[o]||Ry,s[o])}function dA(t,e,n){let i=this.cache,r=e.length,s=id(n,r);Xt(i,s)||(t.uniform1iv(this.addr,s),qt(i,s));for(let o=0;o!==r;++o)n.setTexture2DArray(e[o]||Ay,s[o])}function fA(t){switch(t){case 5126:return ZT;case 35664:return $T;case 35665:return JT;case 35666:return KT;case 35674:return jT;case 35675:return QT;case 35676:return eA;case 5124:case 35670:return tA;case 35667:case 35671:return nA;case 35668:case 35672:return iA;case 35669:case 35673:return rA;case 5125:return sA;case 36294:return oA;case 36295:return aA;case 36296:return lA;case 35678:case 36198:case 36298:case 36306:case 35682:return cA;case 35679:case 36299:case 36307:return uA;case 35680:case 36300:case 36308:case 36293:return hA;case 36289:case 36303:case 36311:case 36292:return dA}}var $m=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.setValue=YT(n.type)}},Jm=class{constructor(e,n,i){this.id=e,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=fA(n.type)}},Km=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,n,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,n[a.id],i)}}},qm=/(\w+)(\])?(\[|\.)?/g;function dy(t,e){t.seq.push(e),t.map[e.id]=e}function pA(t,e,n){let i=t.name,r=i.length;for(qm.lastIndex=0;;){let s=qm.exec(i),o=qm.lastIndex,a=s[1],l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){dy(n,c===void 0?new $m(a,t,e):new Jm(a,t,e));break}else{let f=n.map[a];f===void 0&&(f=new Km(a),dy(n,f)),n=f}}}var No=class{constructor(e,n){this.seq=[],this.map={};let i=e.getProgramParameter(n,e.ACTIVE_UNIFORMS);for(let o=0;o<i;++o){let a=e.getActiveUniform(n,o),l=e.getUniformLocation(n,a.name);pA(a,l,this)}let r=[],s=[];for(let o of this.seq)o.type===e.SAMPLER_2D_SHADOW||o.type===e.SAMPLER_CUBE_SHADOW||o.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(o):s.push(o);r.length>0&&(this.seq=r.concat(s))}setValue(e,n,i,r){let s=this.map[n];s!==void 0&&s.setValue(e,i,r)}setOptional(e,n,i){let r=n[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,n,i,r){for(let s=0,o=n.length;s!==o;++s){let a=n[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,n){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in n&&i.push(o)}return i}};function fy(t,e,n){let i=t.createShader(e);return t.shaderSource(i,n),t.compileShader(i),i}var mA=37297,gA=0;function vA(t,e){let n=t.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,n.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${n[o]}`)}return i.join(`
`)}var py=new ze;function xA(t){je._getMatrix(py,je.workingColorSpace,t);let e=`mat3( ${py.elements.map(n=>n.toFixed(4))} )`;switch(je.getTransfer(t)){case Va:return[e,"LinearTransferOETF"];case ut:return[e,"sRGBTransferOETF"];default:return Fe("WebGLProgram: Unsupported color space: ",t),[e,"LinearTransferOETF"]}}function my(t,e,n){let i=t.getShaderParameter(e,t.COMPILE_STATUS),s=(t.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return n.toUpperCase()+`

`+s+`

`+vA(t.getShaderSource(e),a)}else return s}function _A(t,e){let n=xA(e);return[`vec4 ${t}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}var yA={[mm]:"Linear",[gm]:"Reinhard",[vm]:"Cineon",[hl]:"ACESFilmic",[_m]:"AgX",[ym]:"Neutral",[xm]:"Custom"};function SA(t,e){let n=yA[e];return n===void 0?(Fe("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+t+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+t+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var Qh=new D;function MA(){je.getLuminanceCoefficients(Qh);let t=Qh.x.toFixed(4),e=Qh.y.toFixed(4),n=Qh.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${t}, ${e}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function EA(t){return[t.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",t.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(El).join(`
`)}function wA(t){let e=[];for(let n in t){let i=t[n];i!==!1&&e.push("#define "+n+" "+i)}return e.join(`
`)}function bA(t,e){let n={},i=t.getProgramParameter(e,t.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=t.getActiveAttrib(e,r),o=s.name,a=1;s.type===t.FLOAT_MAT2&&(a=2),s.type===t.FLOAT_MAT3&&(a=3),s.type===t.FLOAT_MAT4&&(a=4),n[o]={type:s.type,location:t.getAttribLocation(e,o),locationSize:a}}return n}function El(t){return t!==""}function gy(t,e){let n=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return t.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function vy(t,e){return t.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var TA=/^[ \t]*#include +<([\w\d./]+)>/gm;function jm(t){return t.replace(TA,CA)}var AA=new Map;function CA(t,e){let n=He[e];if(n===void 0){let i=AA.get(e);if(i!==void 0)n=He[i],Fe('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return jm(n)}var RA=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function xy(t){return t.replace(RA,PA)}function PA(t,e,n,i){let r="";for(let s=parseInt(e);s<parseInt(n);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function _y(t){let e=`precision ${t.precision} float;
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
#define LOW_PRECISION`),e}var IA={[ul]:"SHADOWMAP_TYPE_PCF",[Co]:"SHADOWMAP_TYPE_VSM"};function LA(t){return IA[t.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var NA={[Xr]:"ENVMAP_TYPE_CUBE",[Ss]:"ENVMAP_TYPE_CUBE",[dl]:"ENVMAP_TYPE_CUBE_UV"};function DA(t){return t.envMap===!1?"ENVMAP_TYPE_CUBE":NA[t.envMapMode]||"ENVMAP_TYPE_CUBE"}var UA={[Ss]:"ENVMAP_MODE_REFRACTION"};function FA(t){return t.envMap===!1?"ENVMAP_MODE_REFLECTION":UA[t.envMapMode]||"ENVMAP_MODE_REFLECTION"}var OA={[ch]:"ENVMAP_BLENDING_MULTIPLY",[B_]:"ENVMAP_BLENDING_MIX",[k_]:"ENVMAP_BLENDING_ADD"};function BA(t){return t.envMap===!1?"ENVMAP_BLENDING_NONE":OA[t.combine]||"ENVMAP_BLENDING_NONE"}function kA(t){let e=t.envMapCubeUVHeight;if(e===null)return null;let n=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,n),7*16)),texelHeight:i,maxMip:n}}function zA(t,e,n,i){let r=t.getContext(),s=n.defines,o=n.vertexShader,a=n.fragmentShader,l=LA(n),c=DA(n),d=FA(n),f=BA(n),u=kA(n),p=EA(n),x=wA(s),S=r.createProgram(),v,h,g=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(v=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,x].filter(El).join(`
`),v.length>0&&(v+=`
`),h=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,x].filter(El).join(`
`),h.length>0&&(h+=`
`)):(v=[_y(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,x,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+d:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexNormals?"#define HAS_NORMAL":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(El).join(`
`),h=[_y(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,x,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+d:"",n.envMap?"#define "+f:"",u?"#define CUBEUV_TEXEL_WIDTH "+u.texelWidth:"",u?"#define CUBEUV_TEXEL_HEIGHT "+u.texelHeight:"",u?"#define CUBEUV_MAX_MIP "+u.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor?"#define USE_COLOR":"",n.vertexAlphas||n.batchingColor?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==gi?"#define TONE_MAPPING":"",n.toneMapping!==gi?He.tonemapping_pars_fragment:"",n.toneMapping!==gi?SA("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",He.colorspace_pars_fragment,_A("linearToOutputTexel",n.outputColorSpace),MA(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(El).join(`
`)),o=jm(o),o=gy(o,n),o=vy(o,n),a=jm(a),a=gy(a,n),a=vy(a,n),o=xy(o),a=xy(a),n.isRawShaderMaterial!==!0&&(g=`#version 300 es
`,v=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+v,h=["#define varying in",n.glslVersion===Cm?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===Cm?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+h);let _=g+v+o,M=g+h+a,C=fy(r,r.VERTEX_SHADER,_),b=fy(r,r.FRAGMENT_SHADER,M);r.attachShader(S,C),r.attachShader(S,b),n.index0AttributeName!==void 0?r.bindAttribLocation(S,0,n.index0AttributeName):n.morphTargets===!0&&r.bindAttribLocation(S,0,"position"),r.linkProgram(S);function R(A){if(t.debug.checkShaderErrors){let P=r.getProgramInfoLog(S)||"",O=r.getShaderInfoLog(C)||"",z=r.getShaderInfoLog(b)||"",L=P.trim(),B=O.trim(),G=z.trim(),q=!0,J=!0;if(r.getProgramParameter(S,r.LINK_STATUS)===!1)if(q=!1,typeof t.debug.onShaderError=="function")t.debug.onShaderError(r,S,C,b);else{let j=my(r,C,"vertex"),ue=my(r,b,"fragment");Be("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(S,r.VALIDATE_STATUS)+`

Material Name: `+A.name+`
Material Type: `+A.type+`

Program Info Log: `+L+`
`+j+`
`+ue)}else L!==""?Fe("WebGLProgram: Program Info Log:",L):(B===""||G==="")&&(J=!1);J&&(A.diagnostics={runnable:q,programLog:L,vertexShader:{log:B,prefix:v},fragmentShader:{log:G,prefix:h}})}r.deleteShader(C),r.deleteShader(b),m=new No(r,S),T=bA(r,S)}let m;this.getUniforms=function(){return m===void 0&&R(this),m};let T;this.getAttributes=function(){return T===void 0&&R(this),T};let I=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return I===!1&&(I=r.getProgramParameter(S,mA)),I},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(S),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=gA++,this.cacheKey=e,this.usedTimes=1,this.program=S,this.vertexShader=C,this.fragmentShader=b,this}var VA=0,Qm=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let n=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(n),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let n=this.materialCache.get(e);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let n=this.materialCache,i=n.get(e);return i===void 0&&(i=new Set,n.set(e,i)),i}_getShaderStage(e){let n=this.shaderCache,i=n.get(e);return i===void 0&&(i=new eg(e),n.set(e,i)),i}},eg=class{constructor(e){this.id=VA++,this.code=e,this.usedTimes=0}};function GA(t){return t===Zr||t===xl||t===_l}function HA(t,e,n,i,r,s){let o=new Wa,a=new Qm,l=new Set,c=[],d=new Map,f=i.logarithmicDepthBuffer,u=i.precision,p={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function x(m){return l.add(m),m===0?"uv":`uv${m}`}function S(m,T,I,A,P,O){let z=A.fog,L=P.geometry,B=m.isMeshStandardMaterial||m.isMeshLambertMaterial||m.isMeshPhongMaterial?A.environment:null,G=m.isMeshStandardMaterial||m.isMeshLambertMaterial&&!m.envMap||m.isMeshPhongMaterial&&!m.envMap,q=e.get(m.envMap||B,G),J=q&&q.mapping===dl?q.image.height:null,j=p[m.type];m.precision!==null&&(u=i.getMaxPrecision(m.precision),u!==m.precision&&Fe("WebGLProgram.getParameters:",m.precision,"not supported, using",u,"instead."));let ue=L.morphAttributes.position||L.morphAttributes.normal||L.morphAttributes.color,U=ue!==void 0?ue.length:0,ne=0;L.morphAttributes.position!==void 0&&(ne=1),L.morphAttributes.normal!==void 0&&(ne=2),L.morphAttributes.color!==void 0&&(ne=3);let Ne,he,Q,me;if(j){let Se=Bi[j];Ne=Se.vertexShader,he=Se.fragmentShader}else Ne=m.vertexShader,he=m.fragmentShader,a.update(m),Q=a.getVertexShaderID(m),me=a.getFragmentShaderID(m);let le=t.getRenderTarget(),Ae=t.state.buffers.depth.getReversed(),Ie=P.isInstancedMesh===!0,Te=P.isBatchedMesh===!0,ft=!!m.map,ke=!!m.matcap,it=!!q,st=!!m.aoMap,We=!!m.lightMap,St=!!m.bumpMap,pt=!!m.normalMap,Bt=!!m.displacementMap,F=!!m.emissiveMap,Lt=!!m.metalnessMap,Xe=!!m.roughnessMap,ot=m.anisotropy>0,pe=m.clearcoat>0,at=m.dispersion>0,E=m.iridescence>0,y=m.sheen>0,V=m.transmission>0,K=ot&&!!m.anisotropyMap,ee=pe&&!!m.clearcoatMap,oe=pe&&!!m.clearcoatNormalMap,de=pe&&!!m.clearcoatRoughnessMap,Y=E&&!!m.iridescenceMap,Z=E&&!!m.iridescenceThicknessMap,ae=y&&!!m.sheenColorMap,ge=y&&!!m.sheenRoughnessMap,ce=!!m.specularMap,ie=!!m.specularColorMap,De=!!m.specularIntensityMap,Oe=V&&!!m.transmissionMap,Ve=V&&!!m.thicknessMap,N=!!m.gradientMap,se=!!m.alphaMap,$=m.alphaTest>0,ye=!!m.alphaHash,fe=!!m.extensions,te=gi;m.toneMapped&&(le===null||le.isXRRenderTarget===!0)&&(te=t.toneMapping);let Ce={shaderID:j,shaderType:m.type,shaderName:m.name,vertexShader:Ne,fragmentShader:he,defines:m.defines,customVertexShaderID:Q,customFragmentShaderID:me,isRawShaderMaterial:m.isRawShaderMaterial===!0,glslVersion:m.glslVersion,precision:u,batching:Te,batchingColor:Te&&P._colorsTexture!==null,instancing:Ie,instancingColor:Ie&&P.instanceColor!==null,instancingMorph:Ie&&P.morphTexture!==null,outputColorSpace:le===null?t.outputColorSpace:le.isXRRenderTarget===!0?le.texture.colorSpace:je.workingColorSpace,alphaToCoverage:!!m.alphaToCoverage,map:ft,matcap:ke,envMap:it,envMapMode:it&&q.mapping,envMapCubeUVHeight:J,aoMap:st,lightMap:We,bumpMap:St,normalMap:pt,displacementMap:Bt,emissiveMap:F,normalMapObjectSpace:pt&&m.normalMapType===G_,normalMapTangentSpace:pt&&m.normalMapType===yl,packedNormalMap:pt&&m.normalMapType===yl&&GA(m.normalMap.format),metalnessMap:Lt,roughnessMap:Xe,anisotropy:ot,anisotropyMap:K,clearcoat:pe,clearcoatMap:ee,clearcoatNormalMap:oe,clearcoatRoughnessMap:de,dispersion:at,iridescence:E,iridescenceMap:Y,iridescenceThicknessMap:Z,sheen:y,sheenColorMap:ae,sheenRoughnessMap:ge,specularMap:ce,specularColorMap:ie,specularIntensityMap:De,transmission:V,transmissionMap:Oe,thicknessMap:Ve,gradientMap:N,opaque:m.transparent===!1&&m.blending===vs&&m.alphaToCoverage===!1,alphaMap:se,alphaTest:$,alphaHash:ye,combine:m.combine,mapUv:ft&&x(m.map.channel),aoMapUv:st&&x(m.aoMap.channel),lightMapUv:We&&x(m.lightMap.channel),bumpMapUv:St&&x(m.bumpMap.channel),normalMapUv:pt&&x(m.normalMap.channel),displacementMapUv:Bt&&x(m.displacementMap.channel),emissiveMapUv:F&&x(m.emissiveMap.channel),metalnessMapUv:Lt&&x(m.metalnessMap.channel),roughnessMapUv:Xe&&x(m.roughnessMap.channel),anisotropyMapUv:K&&x(m.anisotropyMap.channel),clearcoatMapUv:ee&&x(m.clearcoatMap.channel),clearcoatNormalMapUv:oe&&x(m.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:de&&x(m.clearcoatRoughnessMap.channel),iridescenceMapUv:Y&&x(m.iridescenceMap.channel),iridescenceThicknessMapUv:Z&&x(m.iridescenceThicknessMap.channel),sheenColorMapUv:ae&&x(m.sheenColorMap.channel),sheenRoughnessMapUv:ge&&x(m.sheenRoughnessMap.channel),specularMapUv:ce&&x(m.specularMap.channel),specularColorMapUv:ie&&x(m.specularColorMap.channel),specularIntensityMapUv:De&&x(m.specularIntensityMap.channel),transmissionMapUv:Oe&&x(m.transmissionMap.channel),thicknessMapUv:Ve&&x(m.thicknessMap.channel),alphaMapUv:se&&x(m.alphaMap.channel),vertexTangents:!!L.attributes.tangent&&(pt||ot),vertexNormals:!!L.attributes.normal,vertexColors:m.vertexColors,vertexAlphas:m.vertexColors===!0&&!!L.attributes.color&&L.attributes.color.itemSize===4,pointsUvs:P.isPoints===!0&&!!L.attributes.uv&&(ft||se),fog:!!z,useFog:m.fog===!0,fogExp2:!!z&&z.isFogExp2,flatShading:m.wireframe===!1&&(m.flatShading===!0||L.attributes.normal===void 0&&pt===!1&&(m.isMeshLambertMaterial||m.isMeshPhongMaterial||m.isMeshStandardMaterial||m.isMeshPhysicalMaterial)),sizeAttenuation:m.sizeAttenuation===!0,logarithmicDepthBuffer:f,reversedDepthBuffer:Ae,skinning:P.isSkinnedMesh===!0,morphTargets:L.morphAttributes.position!==void 0,morphNormals:L.morphAttributes.normal!==void 0,morphColors:L.morphAttributes.color!==void 0,morphTargetsCount:U,morphTextureStride:ne,numDirLights:T.directional.length,numPointLights:T.point.length,numSpotLights:T.spot.length,numSpotLightMaps:T.spotLightMap.length,numRectAreaLights:T.rectArea.length,numHemiLights:T.hemi.length,numDirLightShadows:T.directionalShadowMap.length,numPointLightShadows:T.pointShadowMap.length,numSpotLightShadows:T.spotShadowMap.length,numSpotLightShadowsWithMaps:T.numSpotLightShadowsWithMaps,numLightProbes:T.numLightProbes,numLightProbeGrids:O.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:m.dithering,shadowMapEnabled:t.shadowMap.enabled&&I.length>0,shadowMapType:t.shadowMap.type,toneMapping:te,decodeVideoTexture:ft&&m.map.isVideoTexture===!0&&je.getTransfer(m.map.colorSpace)===ut,decodeVideoTextureEmissive:F&&m.emissiveMap.isVideoTexture===!0&&je.getTransfer(m.emissiveMap.colorSpace)===ut,premultipliedAlpha:m.premultipliedAlpha,doubleSided:m.side===Di,flipSided:m.side===Wt,useDepthPacking:m.depthPacking>=0,depthPacking:m.depthPacking||0,index0AttributeName:m.index0AttributeName,extensionClipCullDistance:fe&&m.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(fe&&m.extensions.multiDraw===!0||Te)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:m.customProgramCacheKey()};return Ce.vertexUv1s=l.has(1),Ce.vertexUv2s=l.has(2),Ce.vertexUv3s=l.has(3),l.clear(),Ce}function v(m){let T=[];if(m.shaderID?T.push(m.shaderID):(T.push(m.customVertexShaderID),T.push(m.customFragmentShaderID)),m.defines!==void 0)for(let I in m.defines)T.push(I),T.push(m.defines[I]);return m.isRawShaderMaterial===!1&&(h(T,m),g(T,m),T.push(t.outputColorSpace)),T.push(m.customProgramCacheKey),T.join()}function h(m,T){m.push(T.precision),m.push(T.outputColorSpace),m.push(T.envMapMode),m.push(T.envMapCubeUVHeight),m.push(T.mapUv),m.push(T.alphaMapUv),m.push(T.lightMapUv),m.push(T.aoMapUv),m.push(T.bumpMapUv),m.push(T.normalMapUv),m.push(T.displacementMapUv),m.push(T.emissiveMapUv),m.push(T.metalnessMapUv),m.push(T.roughnessMapUv),m.push(T.anisotropyMapUv),m.push(T.clearcoatMapUv),m.push(T.clearcoatNormalMapUv),m.push(T.clearcoatRoughnessMapUv),m.push(T.iridescenceMapUv),m.push(T.iridescenceThicknessMapUv),m.push(T.sheenColorMapUv),m.push(T.sheenRoughnessMapUv),m.push(T.specularMapUv),m.push(T.specularColorMapUv),m.push(T.specularIntensityMapUv),m.push(T.transmissionMapUv),m.push(T.thicknessMapUv),m.push(T.combine),m.push(T.fogExp2),m.push(T.sizeAttenuation),m.push(T.morphTargetsCount),m.push(T.morphAttributeCount),m.push(T.numDirLights),m.push(T.numPointLights),m.push(T.numSpotLights),m.push(T.numSpotLightMaps),m.push(T.numHemiLights),m.push(T.numRectAreaLights),m.push(T.numDirLightShadows),m.push(T.numPointLightShadows),m.push(T.numSpotLightShadows),m.push(T.numSpotLightShadowsWithMaps),m.push(T.numLightProbes),m.push(T.shadowMapType),m.push(T.toneMapping),m.push(T.numClippingPlanes),m.push(T.numClipIntersection),m.push(T.depthPacking)}function g(m,T){o.disableAll(),T.instancing&&o.enable(0),T.instancingColor&&o.enable(1),T.instancingMorph&&o.enable(2),T.matcap&&o.enable(3),T.envMap&&o.enable(4),T.normalMapObjectSpace&&o.enable(5),T.normalMapTangentSpace&&o.enable(6),T.clearcoat&&o.enable(7),T.iridescence&&o.enable(8),T.alphaTest&&o.enable(9),T.vertexColors&&o.enable(10),T.vertexAlphas&&o.enable(11),T.vertexUv1s&&o.enable(12),T.vertexUv2s&&o.enable(13),T.vertexUv3s&&o.enable(14),T.vertexTangents&&o.enable(15),T.anisotropy&&o.enable(16),T.alphaHash&&o.enable(17),T.batching&&o.enable(18),T.dispersion&&o.enable(19),T.batchingColor&&o.enable(20),T.gradientMap&&o.enable(21),T.packedNormalMap&&o.enable(22),T.vertexNormals&&o.enable(23),m.push(o.mask),o.disableAll(),T.fog&&o.enable(0),T.useFog&&o.enable(1),T.flatShading&&o.enable(2),T.logarithmicDepthBuffer&&o.enable(3),T.reversedDepthBuffer&&o.enable(4),T.skinning&&o.enable(5),T.morphTargets&&o.enable(6),T.morphNormals&&o.enable(7),T.morphColors&&o.enable(8),T.premultipliedAlpha&&o.enable(9),T.shadowMapEnabled&&o.enable(10),T.doubleSided&&o.enable(11),T.flipSided&&o.enable(12),T.useDepthPacking&&o.enable(13),T.dithering&&o.enable(14),T.transmission&&o.enable(15),T.sheen&&o.enable(16),T.opaque&&o.enable(17),T.pointsUvs&&o.enable(18),T.decodeVideoTexture&&o.enable(19),T.decodeVideoTextureEmissive&&o.enable(20),T.alphaToCoverage&&o.enable(21),T.numLightProbeGrids>0&&o.enable(22),m.push(o.mask)}function _(m){let T=p[m.type],I;if(T){let A=Bi[T];I=ey.clone(A.uniforms)}else I=m.uniforms;return I}function M(m,T){let I=d.get(T);return I!==void 0?++I.usedTimes:(I=new zA(t,T,m,r),c.push(I),d.set(T,I)),I}function C(m){if(--m.usedTimes===0){let T=c.indexOf(m);c[T]=c[c.length-1],c.pop(),d.delete(m.cacheKey),m.destroy()}}function b(m){a.remove(m)}function R(){a.dispose()}return{getParameters:S,getProgramCacheKey:v,getUniforms:_,acquireProgram:M,releaseProgram:C,releaseShaderCache:b,programs:c,dispose:R}}function WA(){let t=new WeakMap;function e(o){return t.has(o)}function n(o){let a=t.get(o);return a===void 0&&(a={},t.set(o,a)),a}function i(o){t.delete(o)}function r(o,a,l){t.get(o)[a]=l}function s(){t=new WeakMap}return{has:e,get:n,remove:i,update:r,dispose:s}}function XA(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.material.id!==e.material.id?t.material.id-e.material.id:t.materialVariant!==e.materialVariant?t.materialVariant-e.materialVariant:t.z!==e.z?t.z-e.z:t.id-e.id}function yy(t,e){return t.groupOrder!==e.groupOrder?t.groupOrder-e.groupOrder:t.renderOrder!==e.renderOrder?t.renderOrder-e.renderOrder:t.z!==e.z?e.z-t.z:t.id-e.id}function Sy(){let t=[],e=0,n=[],i=[],r=[];function s(){e=0,n.length=0,i.length=0,r.length=0}function o(u){let p=0;return u.isInstancedMesh&&(p+=2),u.isSkinnedMesh&&(p+=1),p}function a(u,p,x,S,v,h){let g=t[e];return g===void 0?(g={id:u.id,object:u,geometry:p,material:x,materialVariant:o(u),groupOrder:S,renderOrder:u.renderOrder,z:v,group:h},t[e]=g):(g.id=u.id,g.object=u,g.geometry=p,g.material=x,g.materialVariant=o(u),g.groupOrder=S,g.renderOrder=u.renderOrder,g.z=v,g.group=h),e++,g}function l(u,p,x,S,v,h){let g=a(u,p,x,S,v,h);x.transmission>0?i.push(g):x.transparent===!0?r.push(g):n.push(g)}function c(u,p,x,S,v,h){let g=a(u,p,x,S,v,h);x.transmission>0?i.unshift(g):x.transparent===!0?r.unshift(g):n.unshift(g)}function d(u,p){n.length>1&&n.sort(u||XA),i.length>1&&i.sort(p||yy),r.length>1&&r.sort(p||yy)}function f(){for(let u=e,p=t.length;u<p;u++){let x=t[u];if(x.id===null)break;x.id=null,x.object=null,x.geometry=null,x.material=null,x.group=null}}return{opaque:n,transmissive:i,transparent:r,init:s,push:l,unshift:c,finish:f,sort:d}}function qA(){let t=new WeakMap;function e(i,r){let s=t.get(i),o;return s===void 0?(o=new Sy,t.set(i,[o])):r>=s.length?(o=new Sy,s.push(o)):o=s[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}function YA(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={direction:new D,color:new Ke};break;case"SpotLight":n={position:new D,direction:new D,color:new Ke,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new D,color:new Ke,distance:0,decay:0};break;case"HemisphereLight":n={direction:new D,skyColor:new Ke,groundColor:new Ke};break;case"RectAreaLight":n={color:new Ke,position:new D,halfWidth:new D,halfHeight:new D};break}return t[e.id]=n,n}}}function ZA(){let t={};return{get:function(e){if(t[e.id]!==void 0)return t[e.id];let n;switch(e.type){case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ue};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ue};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ue,shadowCameraNear:1,shadowCameraFar:1e3};break}return t[e.id]=n,n}}}var $A=0;function JA(t,e){return(e.castShadow?2:0)-(t.castShadow?2:0)+(e.map?1:0)-(t.map?1:0)}function KA(t){let e=new YA,n=ZA(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new D);let r=new D,s=new yt,o=new yt;function a(c){let d=0,f=0,u=0;for(let T=0;T<9;T++)i.probe[T].set(0,0,0);let p=0,x=0,S=0,v=0,h=0,g=0,_=0,M=0,C=0,b=0,R=0;c.sort(JA);for(let T=0,I=c.length;T<I;T++){let A=c[T],P=A.color,O=A.intensity,z=A.distance,L=null;if(A.shadow&&A.shadow.map&&(A.shadow.map.texture.format===Zr?L=A.shadow.map.texture:L=A.shadow.map.depthTexture||A.shadow.map.texture),A.isAmbientLight)d+=P.r*O,f+=P.g*O,u+=P.b*O;else if(A.isLightProbe){for(let B=0;B<9;B++)i.probe[B].addScaledVector(A.sh.coefficients[B],O);R++}else if(A.isDirectionalLight){let B=e.get(A);if(B.color.copy(A.color).multiplyScalar(A.intensity),A.castShadow){let G=A.shadow,q=n.get(A);q.shadowIntensity=G.intensity,q.shadowBias=G.bias,q.shadowNormalBias=G.normalBias,q.shadowRadius=G.radius,q.shadowMapSize=G.mapSize,i.directionalShadow[p]=q,i.directionalShadowMap[p]=L,i.directionalShadowMatrix[p]=A.shadow.matrix,g++}i.directional[p]=B,p++}else if(A.isSpotLight){let B=e.get(A);B.position.setFromMatrixPosition(A.matrixWorld),B.color.copy(P).multiplyScalar(O),B.distance=z,B.coneCos=Math.cos(A.angle),B.penumbraCos=Math.cos(A.angle*(1-A.penumbra)),B.decay=A.decay,i.spot[S]=B;let G=A.shadow;if(A.map&&(i.spotLightMap[C]=A.map,C++,G.updateMatrices(A),A.castShadow&&b++),i.spotLightMatrix[S]=G.matrix,A.castShadow){let q=n.get(A);q.shadowIntensity=G.intensity,q.shadowBias=G.bias,q.shadowNormalBias=G.normalBias,q.shadowRadius=G.radius,q.shadowMapSize=G.mapSize,i.spotShadow[S]=q,i.spotShadowMap[S]=L,M++}S++}else if(A.isRectAreaLight){let B=e.get(A);B.color.copy(P).multiplyScalar(O),B.halfWidth.set(A.width*.5,0,0),B.halfHeight.set(0,A.height*.5,0),i.rectArea[v]=B,v++}else if(A.isPointLight){let B=e.get(A);if(B.color.copy(A.color).multiplyScalar(A.intensity),B.distance=A.distance,B.decay=A.decay,A.castShadow){let G=A.shadow,q=n.get(A);q.shadowIntensity=G.intensity,q.shadowBias=G.bias,q.shadowNormalBias=G.normalBias,q.shadowRadius=G.radius,q.shadowMapSize=G.mapSize,q.shadowCameraNear=G.camera.near,q.shadowCameraFar=G.camera.far,i.pointShadow[x]=q,i.pointShadowMap[x]=L,i.pointShadowMatrix[x]=A.shadow.matrix,_++}i.point[x]=B,x++}else if(A.isHemisphereLight){let B=e.get(A);B.skyColor.copy(A.color).multiplyScalar(O),B.groundColor.copy(A.groundColor).multiplyScalar(O),i.hemi[h]=B,h++}}v>0&&(t.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=ve.LTC_FLOAT_1,i.rectAreaLTC2=ve.LTC_FLOAT_2):(i.rectAreaLTC1=ve.LTC_HALF_1,i.rectAreaLTC2=ve.LTC_HALF_2)),i.ambient[0]=d,i.ambient[1]=f,i.ambient[2]=u;let m=i.hash;(m.directionalLength!==p||m.pointLength!==x||m.spotLength!==S||m.rectAreaLength!==v||m.hemiLength!==h||m.numDirectionalShadows!==g||m.numPointShadows!==_||m.numSpotShadows!==M||m.numSpotMaps!==C||m.numLightProbes!==R)&&(i.directional.length=p,i.spot.length=S,i.rectArea.length=v,i.point.length=x,i.hemi.length=h,i.directionalShadow.length=g,i.directionalShadowMap.length=g,i.pointShadow.length=_,i.pointShadowMap.length=_,i.spotShadow.length=M,i.spotShadowMap.length=M,i.directionalShadowMatrix.length=g,i.pointShadowMatrix.length=_,i.spotLightMatrix.length=M+C-b,i.spotLightMap.length=C,i.numSpotLightShadowsWithMaps=b,i.numLightProbes=R,m.directionalLength=p,m.pointLength=x,m.spotLength=S,m.rectAreaLength=v,m.hemiLength=h,m.numDirectionalShadows=g,m.numPointShadows=_,m.numSpotShadows=M,m.numSpotMaps=C,m.numLightProbes=R,i.version=$A++)}function l(c,d){let f=0,u=0,p=0,x=0,S=0,v=d.matrixWorldInverse;for(let h=0,g=c.length;h<g;h++){let _=c[h];if(_.isDirectionalLight){let M=i.directional[f];M.direction.setFromMatrixPosition(_.matrixWorld),r.setFromMatrixPosition(_.target.matrixWorld),M.direction.sub(r),M.direction.transformDirection(v),f++}else if(_.isSpotLight){let M=i.spot[p];M.position.setFromMatrixPosition(_.matrixWorld),M.position.applyMatrix4(v),M.direction.setFromMatrixPosition(_.matrixWorld),r.setFromMatrixPosition(_.target.matrixWorld),M.direction.sub(r),M.direction.transformDirection(v),p++}else if(_.isRectAreaLight){let M=i.rectArea[x];M.position.setFromMatrixPosition(_.matrixWorld),M.position.applyMatrix4(v),o.identity(),s.copy(_.matrixWorld),s.premultiply(v),o.extractRotation(s),M.halfWidth.set(_.width*.5,0,0),M.halfHeight.set(0,_.height*.5,0),M.halfWidth.applyMatrix4(o),M.halfHeight.applyMatrix4(o),x++}else if(_.isPointLight){let M=i.point[u];M.position.setFromMatrixPosition(_.matrixWorld),M.position.applyMatrix4(v),u++}else if(_.isHemisphereLight){let M=i.hemi[S];M.direction.setFromMatrixPosition(_.matrixWorld),M.direction.transformDirection(v),S++}}}return{setup:a,setupView:l,state:i}}function My(t){let e=new KA(t),n=[],i=[],r=[];function s(u){f.camera=u,n.length=0,i.length=0,r.length=0}function o(u){n.push(u)}function a(u){i.push(u)}function l(u){r.push(u)}function c(){e.setup(n)}function d(u){e.setupView(n,u)}let f={lightsArray:n,shadowsArray:i,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:f,setupLights:c,setupLightsView:d,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function jA(t){let e=new WeakMap;function n(r,s=0){let o=e.get(r),a;return o===void 0?(a=new My(t),e.set(r,[a])):s>=o.length?(a=new My(t),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:n,dispose:i}}var QA=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,eC=`uniform sampler2D shadow_pass;
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
}`,tC=[new D(1,0,0),new D(-1,0,0),new D(0,1,0),new D(0,-1,0),new D(0,0,1),new D(0,0,-1)],nC=[new D(0,-1,0),new D(0,-1,0),new D(0,0,1),new D(0,0,-1),new D(0,-1,0),new D(0,-1,0)],Ey=new yt,Ml=new D,Ym=new D;function iC(t,e,n){let i=new bo,r=new Ue,s=new Ue,o=new It,a=new Xu,l=new qu,c={},d=n.maxTextureSize,f={[nr]:Wt,[Wt]:nr,[Di]:Di},u=new Vn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ue},radius:{value:4}},vertexShader:QA,fragmentShader:eC}),p=u.clone();p.defines.HORIZONTAL_PASS=1;let x=new fn;x.setAttribute("position",new Jt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let S=new Qe(x,u),v=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=ul;let h=this.type;this.render=function(b,R,m){if(v.enabled===!1||v.autoUpdate===!1&&v.needsUpdate===!1||b.length===0)return;this.type===lh&&(Fe("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=ul);let T=t.getRenderTarget(),I=t.getActiveCubeFace(),A=t.getActiveMipmapLevel(),P=t.state;P.setBlending(Ui),P.buffers.depth.getReversed()===!0?P.buffers.color.setClear(0,0,0,0):P.buffers.color.setClear(1,1,1,1),P.buffers.depth.setTest(!0),P.setScissorTest(!1);let O=h!==this.type;O&&R.traverse(function(z){z.material&&(Array.isArray(z.material)?z.material.forEach(L=>L.needsUpdate=!0):z.material.needsUpdate=!0)});for(let z=0,L=b.length;z<L;z++){let B=b[z],G=B.shadow;if(G===void 0){Fe("WebGLShadowMap:",B,"has no shadow.");continue}if(G.autoUpdate===!1&&G.needsUpdate===!1)continue;r.copy(G.mapSize);let q=G.getFrameExtents();r.multiply(q),s.copy(G.mapSize),(r.x>d||r.y>d)&&(r.x>d&&(s.x=Math.floor(d/q.x),r.x=s.x*q.x,G.mapSize.x=s.x),r.y>d&&(s.y=Math.floor(d/q.y),r.y=s.y*q.y,G.mapSize.y=s.y));let J=t.state.buffers.depth.getReversed();if(G.camera._reversedDepth=J,G.map===null||O===!0){if(G.map!==null&&(G.map.depthTexture!==null&&(G.map.depthTexture.dispose(),G.map.depthTexture=null),G.map.dispose()),this.type===Co){if(B.isPointLight){Fe("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}G.map=new zn(r.x,r.y,{format:Zr,type:Fi,minFilter:rn,magFilter:rn,generateMipmaps:!1}),G.map.texture.name=B.name+".shadowMap",G.map.depthTexture=new rr(r.x,r.y,ti),G.map.depthTexture.name=B.name+".shadowMapDepth",G.map.depthTexture.format=Ri,G.map.depthTexture.compareFunction=null,G.map.depthTexture.minFilter=Kt,G.map.depthTexture.magFilter=Kt}else B.isPointLight?(G.map=new ed(r.x),G.map.depthTexture=new Fu(r.x,vi)):(G.map=new zn(r.x,r.y),G.map.depthTexture=new rr(r.x,r.y,vi)),G.map.depthTexture.name=B.name+".shadowMap",G.map.depthTexture.format=Ri,this.type===ul?(G.map.depthTexture.compareFunction=J?Kh:Jh,G.map.depthTexture.minFilter=rn,G.map.depthTexture.magFilter=rn):(G.map.depthTexture.compareFunction=null,G.map.depthTexture.minFilter=Kt,G.map.depthTexture.magFilter=Kt);G.camera.updateProjectionMatrix()}let j=G.map.isWebGLCubeRenderTarget?6:1;for(let ue=0;ue<j;ue++){if(G.map.isWebGLCubeRenderTarget)t.setRenderTarget(G.map,ue),t.clear();else{ue===0&&(t.setRenderTarget(G.map),t.clear());let U=G.getViewport(ue);o.set(s.x*U.x,s.y*U.y,s.x*U.z,s.y*U.w),P.viewport(o)}if(B.isPointLight){let U=G.camera,ne=G.matrix,Ne=B.distance||U.far;Ne!==U.far&&(U.far=Ne,U.updateProjectionMatrix()),Ml.setFromMatrixPosition(B.matrixWorld),U.position.copy(Ml),Ym.copy(U.position),Ym.add(tC[ue]),U.up.copy(nC[ue]),U.lookAt(Ym),U.updateMatrixWorld(),ne.makeTranslation(-Ml.x,-Ml.y,-Ml.z),Ey.multiplyMatrices(U.projectionMatrix,U.matrixWorldInverse),G._frustum.setFromProjectionMatrix(Ey,U.coordinateSystem,U.reversedDepth)}else G.updateMatrices(B);i=G.getFrustum(),M(R,m,G.camera,B,this.type)}G.isPointLightShadow!==!0&&this.type===Co&&g(G,m),G.needsUpdate=!1}h=this.type,v.needsUpdate=!1,t.setRenderTarget(T,I,A)};function g(b,R){let m=e.update(S);u.defines.VSM_SAMPLES!==b.blurSamples&&(u.defines.VSM_SAMPLES=b.blurSamples,p.defines.VSM_SAMPLES=b.blurSamples,u.needsUpdate=!0,p.needsUpdate=!0),b.mapPass===null&&(b.mapPass=new zn(r.x,r.y,{format:Zr,type:Fi})),u.uniforms.shadow_pass.value=b.map.depthTexture,u.uniforms.resolution.value=b.mapSize,u.uniforms.radius.value=b.radius,t.setRenderTarget(b.mapPass),t.clear(),t.renderBufferDirect(R,null,m,u,S,null),p.uniforms.shadow_pass.value=b.mapPass.texture,p.uniforms.resolution.value=b.mapSize,p.uniforms.radius.value=b.radius,t.setRenderTarget(b.map),t.clear(),t.renderBufferDirect(R,null,m,p,S,null)}function _(b,R,m,T){let I=null,A=m.isPointLight===!0?b.customDistanceMaterial:b.customDepthMaterial;if(A!==void 0)I=A;else if(I=m.isPointLight===!0?l:a,t.localClippingEnabled&&R.clipShadows===!0&&Array.isArray(R.clippingPlanes)&&R.clippingPlanes.length!==0||R.displacementMap&&R.displacementScale!==0||R.alphaMap&&R.alphaTest>0||R.map&&R.alphaTest>0||R.alphaToCoverage===!0){let P=I.uuid,O=R.uuid,z=c[P];z===void 0&&(z={},c[P]=z);let L=z[O];L===void 0&&(L=I.clone(),z[O]=L,R.addEventListener("dispose",C)),I=L}if(I.visible=R.visible,I.wireframe=R.wireframe,T===Co?I.side=R.shadowSide!==null?R.shadowSide:R.side:I.side=R.shadowSide!==null?R.shadowSide:f[R.side],I.alphaMap=R.alphaMap,I.alphaTest=R.alphaToCoverage===!0?.5:R.alphaTest,I.map=R.map,I.clipShadows=R.clipShadows,I.clippingPlanes=R.clippingPlanes,I.clipIntersection=R.clipIntersection,I.displacementMap=R.displacementMap,I.displacementScale=R.displacementScale,I.displacementBias=R.displacementBias,I.wireframeLinewidth=R.wireframeLinewidth,I.linewidth=R.linewidth,m.isPointLight===!0&&I.isMeshDistanceMaterial===!0){let P=t.properties.get(I);P.light=m}return I}function M(b,R,m,T,I){if(b.visible===!1)return;if(b.layers.test(R.layers)&&(b.isMesh||b.isLine||b.isPoints)&&(b.castShadow||b.receiveShadow&&I===Co)&&(!b.frustumCulled||i.intersectsObject(b))){b.modelViewMatrix.multiplyMatrices(m.matrixWorldInverse,b.matrixWorld);let O=e.update(b),z=b.material;if(Array.isArray(z)){let L=O.groups;for(let B=0,G=L.length;B<G;B++){let q=L[B],J=z[q.materialIndex];if(J&&J.visible){let j=_(b,J,T,I);b.onBeforeShadow(t,b,R,m,O,j,q),t.renderBufferDirect(m,null,O,j,b,q),b.onAfterShadow(t,b,R,m,O,j,q)}}}else if(z.visible){let L=_(b,z,T,I);b.onBeforeShadow(t,b,R,m,O,L,null),t.renderBufferDirect(m,null,O,L,b,null),b.onAfterShadow(t,b,R,m,O,L,null)}}let P=b.children;for(let O=0,z=P.length;O<z;O++)M(P[O],R,m,T,I)}function C(b){b.target.removeEventListener("dispose",C);for(let m in c){let T=c[m],I=b.target.uuid;I in T&&(T[I].dispose(),delete T[I])}}}function rC(t,e){function n(){let N=!1,se=new It,$=null,ye=new It(0,0,0,0);return{setMask:function(fe){$!==fe&&!N&&(t.colorMask(fe,fe,fe,fe),$=fe)},setLocked:function(fe){N=fe},setClear:function(fe,te,Ce,Se,$e){$e===!0&&(fe*=Se,te*=Se,Ce*=Se),se.set(fe,te,Ce,Se),ye.equals(se)===!1&&(t.clearColor(fe,te,Ce,Se),ye.copy(se))},reset:function(){N=!1,$=null,ye.set(-1,0,0,0)}}}function i(){let N=!1,se=!1,$=null,ye=null,fe=null;return{setReversed:function(te){if(se!==te){let Ce=e.get("EXT_clip_control");te?Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.ZERO_TO_ONE_EXT):Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.NEGATIVE_ONE_TO_ONE_EXT),se=te;let Se=fe;fe=null,this.setClear(Se)}},getReversed:function(){return se},setTest:function(te){te?le(t.DEPTH_TEST):Ae(t.DEPTH_TEST)},setMask:function(te){$!==te&&!N&&(t.depthMask(te),$=te)},setFunc:function(te){if(se&&(te=j_[te]),ye!==te){switch(te){case Su:t.depthFunc(t.NEVER);break;case Mu:t.depthFunc(t.ALWAYS);break;case Eu:t.depthFunc(t.LESS);break;case xs:t.depthFunc(t.LEQUAL);break;case wu:t.depthFunc(t.EQUAL);break;case bu:t.depthFunc(t.GEQUAL);break;case Tu:t.depthFunc(t.GREATER);break;case Au:t.depthFunc(t.NOTEQUAL);break;default:t.depthFunc(t.LEQUAL)}ye=te}},setLocked:function(te){N=te},setClear:function(te){fe!==te&&(fe=te,se&&(te=1-te),t.clearDepth(te))},reset:function(){N=!1,$=null,ye=null,fe=null,se=!1}}}function r(){let N=!1,se=null,$=null,ye=null,fe=null,te=null,Ce=null,Se=null,$e=null;return{setTest:function(qe){N||(qe?le(t.STENCIL_TEST):Ae(t.STENCIL_TEST))},setMask:function(qe){se!==qe&&!N&&(t.stencilMask(qe),se=qe)},setFunc:function(qe,lt,Vt){($!==qe||ye!==lt||fe!==Vt)&&(t.stencilFunc(qe,lt,Vt),$=qe,ye=lt,fe=Vt)},setOp:function(qe,lt,Vt){(te!==qe||Ce!==lt||Se!==Vt)&&(t.stencilOp(qe,lt,Vt),te=qe,Ce=lt,Se=Vt)},setLocked:function(qe){N=qe},setClear:function(qe){$e!==qe&&(t.clearStencil(qe),$e=qe)},reset:function(){N=!1,se=null,$=null,ye=null,fe=null,te=null,Ce=null,Se=null,$e=null}}}let s=new n,o=new i,a=new r,l=new WeakMap,c=new WeakMap,d={},f={},u={},p=new WeakMap,x=[],S=null,v=!1,h=null,g=null,_=null,M=null,C=null,b=null,R=null,m=new Ke(0,0,0),T=0,I=!1,A=null,P=null,O=null,z=null,L=null,B=t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS),G=!1,q=0,J=t.getParameter(t.VERSION);J.indexOf("WebGL")!==-1?(q=parseFloat(/^WebGL (\d)/.exec(J)[1]),G=q>=1):J.indexOf("OpenGL ES")!==-1&&(q=parseFloat(/^OpenGL ES (\d)/.exec(J)[1]),G=q>=2);let j=null,ue={},U=t.getParameter(t.SCISSOR_BOX),ne=t.getParameter(t.VIEWPORT),Ne=new It().fromArray(U),he=new It().fromArray(ne);function Q(N,se,$,ye){let fe=new Uint8Array(4),te=t.createTexture();t.bindTexture(N,te),t.texParameteri(N,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(N,t.TEXTURE_MAG_FILTER,t.NEAREST);for(let Ce=0;Ce<$;Ce++)N===t.TEXTURE_3D||N===t.TEXTURE_2D_ARRAY?t.texImage3D(se,0,t.RGBA,1,1,ye,0,t.RGBA,t.UNSIGNED_BYTE,fe):t.texImage2D(se+Ce,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,fe);return te}let me={};me[t.TEXTURE_2D]=Q(t.TEXTURE_2D,t.TEXTURE_2D,1),me[t.TEXTURE_CUBE_MAP]=Q(t.TEXTURE_CUBE_MAP,t.TEXTURE_CUBE_MAP_POSITIVE_X,6),me[t.TEXTURE_2D_ARRAY]=Q(t.TEXTURE_2D_ARRAY,t.TEXTURE_2D_ARRAY,1,1),me[t.TEXTURE_3D]=Q(t.TEXTURE_3D,t.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),le(t.DEPTH_TEST),o.setFunc(xs),St(!1),pt(hm),le(t.CULL_FACE),st(Ui);function le(N){d[N]!==!0&&(t.enable(N),d[N]=!0)}function Ae(N){d[N]!==!1&&(t.disable(N),d[N]=!1)}function Ie(N,se){return u[N]!==se?(t.bindFramebuffer(N,se),u[N]=se,N===t.DRAW_FRAMEBUFFER&&(u[t.FRAMEBUFFER]=se),N===t.FRAMEBUFFER&&(u[t.DRAW_FRAMEBUFFER]=se),!0):!1}function Te(N,se){let $=x,ye=!1;if(N){$=p.get(se),$===void 0&&($=[],p.set(se,$));let fe=N.textures;if($.length!==fe.length||$[0]!==t.COLOR_ATTACHMENT0){for(let te=0,Ce=fe.length;te<Ce;te++)$[te]=t.COLOR_ATTACHMENT0+te;$.length=fe.length,ye=!0}}else $[0]!==t.BACK&&($[0]=t.BACK,ye=!0);ye&&t.drawBuffers($)}function ft(N){return S!==N?(t.useProgram(N),S=N,!0):!1}let ke={[Br]:t.FUNC_ADD,[S_]:t.FUNC_SUBTRACT,[M_]:t.FUNC_REVERSE_SUBTRACT};ke[E_]=t.MIN,ke[w_]=t.MAX;let it={[b_]:t.ZERO,[T_]:t.ONE,[A_]:t.SRC_COLOR,[_u]:t.SRC_ALPHA,[N_]:t.SRC_ALPHA_SATURATE,[I_]:t.DST_COLOR,[R_]:t.DST_ALPHA,[C_]:t.ONE_MINUS_SRC_COLOR,[yu]:t.ONE_MINUS_SRC_ALPHA,[L_]:t.ONE_MINUS_DST_COLOR,[P_]:t.ONE_MINUS_DST_ALPHA,[D_]:t.CONSTANT_COLOR,[U_]:t.ONE_MINUS_CONSTANT_COLOR,[F_]:t.CONSTANT_ALPHA,[O_]:t.ONE_MINUS_CONSTANT_ALPHA};function st(N,se,$,ye,fe,te,Ce,Se,$e,qe){if(N===Ui){v===!0&&(Ae(t.BLEND),v=!1);return}if(v===!1&&(le(t.BLEND),v=!0),N!==y_){if(N!==h||qe!==I){if((g!==Br||C!==Br)&&(t.blendEquation(t.FUNC_ADD),g=Br,C=Br),qe)switch(N){case vs:t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case dm:t.blendFunc(t.ONE,t.ONE);break;case fm:t.blendFuncSeparate(t.ZERO,t.ONE_MINUS_SRC_COLOR,t.ZERO,t.ONE);break;case pm:t.blendFuncSeparate(t.DST_COLOR,t.ONE_MINUS_SRC_ALPHA,t.ZERO,t.ONE);break;default:Be("WebGLState: Invalid blending: ",N);break}else switch(N){case vs:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA);break;case dm:t.blendFuncSeparate(t.SRC_ALPHA,t.ONE,t.ONE,t.ONE);break;case fm:Be("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case pm:Be("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Be("WebGLState: Invalid blending: ",N);break}_=null,M=null,b=null,R=null,m.set(0,0,0),T=0,h=N,I=qe}return}fe=fe||se,te=te||$,Ce=Ce||ye,(se!==g||fe!==C)&&(t.blendEquationSeparate(ke[se],ke[fe]),g=se,C=fe),($!==_||ye!==M||te!==b||Ce!==R)&&(t.blendFuncSeparate(it[$],it[ye],it[te],it[Ce]),_=$,M=ye,b=te,R=Ce),(Se.equals(m)===!1||$e!==T)&&(t.blendColor(Se.r,Se.g,Se.b,$e),m.copy(Se),T=$e),h=N,I=!1}function We(N,se){N.side===Di?Ae(t.CULL_FACE):le(t.CULL_FACE);let $=N.side===Wt;se&&($=!$),St($),N.blending===vs&&N.transparent===!1?st(Ui):st(N.blending,N.blendEquation,N.blendSrc,N.blendDst,N.blendEquationAlpha,N.blendSrcAlpha,N.blendDstAlpha,N.blendColor,N.blendAlpha,N.premultipliedAlpha),o.setFunc(N.depthFunc),o.setTest(N.depthTest),o.setMask(N.depthWrite),s.setMask(N.colorWrite);let ye=N.stencilWrite;a.setTest(ye),ye&&(a.setMask(N.stencilWriteMask),a.setFunc(N.stencilFunc,N.stencilRef,N.stencilFuncMask),a.setOp(N.stencilFail,N.stencilZFail,N.stencilZPass)),F(N.polygonOffset,N.polygonOffsetFactor,N.polygonOffsetUnits),N.alphaToCoverage===!0?le(t.SAMPLE_ALPHA_TO_COVERAGE):Ae(t.SAMPLE_ALPHA_TO_COVERAGE)}function St(N){A!==N&&(N?t.frontFace(t.CW):t.frontFace(t.CCW),A=N)}function pt(N){N!==x_?(le(t.CULL_FACE),N!==P&&(N===hm?t.cullFace(t.BACK):N===__?t.cullFace(t.FRONT):t.cullFace(t.FRONT_AND_BACK))):Ae(t.CULL_FACE),P=N}function Bt(N){N!==O&&(G&&t.lineWidth(N),O=N)}function F(N,se,$){N?(le(t.POLYGON_OFFSET_FILL),(z!==se||L!==$)&&(z=se,L=$,o.getReversed()&&(se=-se),t.polygonOffset(se,$))):Ae(t.POLYGON_OFFSET_FILL)}function Lt(N){N?le(t.SCISSOR_TEST):Ae(t.SCISSOR_TEST)}function Xe(N){N===void 0&&(N=t.TEXTURE0+B-1),j!==N&&(t.activeTexture(N),j=N)}function ot(N,se,$){$===void 0&&(j===null?$=t.TEXTURE0+B-1:$=j);let ye=ue[$];ye===void 0&&(ye={type:void 0,texture:void 0},ue[$]=ye),(ye.type!==N||ye.texture!==se)&&(j!==$&&(t.activeTexture($),j=$),t.bindTexture(N,se||me[N]),ye.type=N,ye.texture=se)}function pe(){let N=ue[j];N!==void 0&&N.type!==void 0&&(t.bindTexture(N.type,null),N.type=void 0,N.texture=void 0)}function at(){try{t.compressedTexImage2D(...arguments)}catch(N){Be("WebGLState:",N)}}function E(){try{t.compressedTexImage3D(...arguments)}catch(N){Be("WebGLState:",N)}}function y(){try{t.texSubImage2D(...arguments)}catch(N){Be("WebGLState:",N)}}function V(){try{t.texSubImage3D(...arguments)}catch(N){Be("WebGLState:",N)}}function K(){try{t.compressedTexSubImage2D(...arguments)}catch(N){Be("WebGLState:",N)}}function ee(){try{t.compressedTexSubImage3D(...arguments)}catch(N){Be("WebGLState:",N)}}function oe(){try{t.texStorage2D(...arguments)}catch(N){Be("WebGLState:",N)}}function de(){try{t.texStorage3D(...arguments)}catch(N){Be("WebGLState:",N)}}function Y(){try{t.texImage2D(...arguments)}catch(N){Be("WebGLState:",N)}}function Z(){try{t.texImage3D(...arguments)}catch(N){Be("WebGLState:",N)}}function ae(N){return f[N]!==void 0?f[N]:t.getParameter(N)}function ge(N,se){f[N]!==se&&(t.pixelStorei(N,se),f[N]=se)}function ce(N){Ne.equals(N)===!1&&(t.scissor(N.x,N.y,N.z,N.w),Ne.copy(N))}function ie(N){he.equals(N)===!1&&(t.viewport(N.x,N.y,N.z,N.w),he.copy(N))}function De(N,se){let $=c.get(se);$===void 0&&($=new WeakMap,c.set(se,$));let ye=$.get(N);ye===void 0&&(ye=t.getUniformBlockIndex(se,N.name),$.set(N,ye))}function Oe(N,se){let ye=c.get(se).get(N);l.get(se)!==ye&&(t.uniformBlockBinding(se,ye,N.__bindingPointIndex),l.set(se,ye))}function Ve(){t.disable(t.BLEND),t.disable(t.CULL_FACE),t.disable(t.DEPTH_TEST),t.disable(t.POLYGON_OFFSET_FILL),t.disable(t.SCISSOR_TEST),t.disable(t.STENCIL_TEST),t.disable(t.SAMPLE_ALPHA_TO_COVERAGE),t.blendEquation(t.FUNC_ADD),t.blendFunc(t.ONE,t.ZERO),t.blendFuncSeparate(t.ONE,t.ZERO,t.ONE,t.ZERO),t.blendColor(0,0,0,0),t.colorMask(!0,!0,!0,!0),t.clearColor(0,0,0,0),t.depthMask(!0),t.depthFunc(t.LESS),o.setReversed(!1),t.clearDepth(1),t.stencilMask(4294967295),t.stencilFunc(t.ALWAYS,0,4294967295),t.stencilOp(t.KEEP,t.KEEP,t.KEEP),t.clearStencil(0),t.cullFace(t.BACK),t.frontFace(t.CCW),t.polygonOffset(0,0),t.activeTexture(t.TEXTURE0),t.bindFramebuffer(t.FRAMEBUFFER,null),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),t.bindFramebuffer(t.READ_FRAMEBUFFER,null),t.useProgram(null),t.lineWidth(1),t.scissor(0,0,t.canvas.width,t.canvas.height),t.viewport(0,0,t.canvas.width,t.canvas.height),t.pixelStorei(t.PACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_ALIGNMENT,4),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,t.BROWSER_DEFAULT_WEBGL),t.pixelStorei(t.PACK_ROW_LENGTH,0),t.pixelStorei(t.PACK_SKIP_PIXELS,0),t.pixelStorei(t.PACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_ROW_LENGTH,0),t.pixelStorei(t.UNPACK_IMAGE_HEIGHT,0),t.pixelStorei(t.UNPACK_SKIP_PIXELS,0),t.pixelStorei(t.UNPACK_SKIP_ROWS,0),t.pixelStorei(t.UNPACK_SKIP_IMAGES,0),d={},f={},j=null,ue={},u={},p=new WeakMap,x=[],S=null,v=!1,h=null,g=null,_=null,M=null,C=null,b=null,R=null,m=new Ke(0,0,0),T=0,I=!1,A=null,P=null,O=null,z=null,L=null,Ne.set(0,0,t.canvas.width,t.canvas.height),he.set(0,0,t.canvas.width,t.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:le,disable:Ae,bindFramebuffer:Ie,drawBuffers:Te,useProgram:ft,setBlending:st,setMaterial:We,setFlipSided:St,setCullFace:pt,setLineWidth:Bt,setPolygonOffset:F,setScissorTest:Lt,activeTexture:Xe,bindTexture:ot,unbindTexture:pe,compressedTexImage2D:at,compressedTexImage3D:E,texImage2D:Y,texImage3D:Z,pixelStorei:ge,getParameter:ae,updateUBOMapping:De,uniformBlockBinding:Oe,texStorage2D:oe,texStorage3D:de,texSubImage2D:y,texSubImage3D:V,compressedTexSubImage2D:K,compressedTexSubImage3D:ee,scissor:ce,viewport:ie,reset:Ve}}function sC(t,e,n,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Ue,d=new WeakMap,f=new Set,u,p=new WeakMap,x=!1;try{x=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function S(E,y){return x?new OffscreenCanvas(E,y):Ga("canvas")}function v(E,y,V){let K=1,ee=at(E);if((ee.width>V||ee.height>V)&&(K=V/Math.max(ee.width,ee.height)),K<1)if(typeof HTMLImageElement<"u"&&E instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&E instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&E instanceof ImageBitmap||typeof VideoFrame<"u"&&E instanceof VideoFrame){let oe=Math.floor(K*ee.width),de=Math.floor(K*ee.height);u===void 0&&(u=S(oe,de));let Y=y?S(oe,de):u;return Y.width=oe,Y.height=de,Y.getContext("2d").drawImage(E,0,0,oe,de),Fe("WebGLRenderer: Texture has been resized from ("+ee.width+"x"+ee.height+") to ("+oe+"x"+de+")."),Y}else return"data"in E&&Fe("WebGLRenderer: Image in DataTexture is too big ("+ee.width+"x"+ee.height+")."),E;return E}function h(E){return E.generateMipmaps}function g(E){t.generateMipmap(E)}function _(E){return E.isWebGLCubeRenderTarget?t.TEXTURE_CUBE_MAP:E.isWebGL3DRenderTarget?t.TEXTURE_3D:E.isWebGLArrayRenderTarget||E.isCompressedArrayTexture?t.TEXTURE_2D_ARRAY:t.TEXTURE_2D}function M(E,y,V,K,ee,oe=!1){if(E!==null){if(t[E]!==void 0)return t[E];Fe("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+E+"'")}let de;K&&(de=e.get("EXT_texture_norm16"),de||Fe("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let Y=y;if(y===t.RED&&(V===t.FLOAT&&(Y=t.R32F),V===t.HALF_FLOAT&&(Y=t.R16F),V===t.UNSIGNED_BYTE&&(Y=t.R8),V===t.UNSIGNED_SHORT&&de&&(Y=de.R16_EXT),V===t.SHORT&&de&&(Y=de.R16_SNORM_EXT)),y===t.RED_INTEGER&&(V===t.UNSIGNED_BYTE&&(Y=t.R8UI),V===t.UNSIGNED_SHORT&&(Y=t.R16UI),V===t.UNSIGNED_INT&&(Y=t.R32UI),V===t.BYTE&&(Y=t.R8I),V===t.SHORT&&(Y=t.R16I),V===t.INT&&(Y=t.R32I)),y===t.RG&&(V===t.FLOAT&&(Y=t.RG32F),V===t.HALF_FLOAT&&(Y=t.RG16F),V===t.UNSIGNED_BYTE&&(Y=t.RG8),V===t.UNSIGNED_SHORT&&de&&(Y=de.RG16_EXT),V===t.SHORT&&de&&(Y=de.RG16_SNORM_EXT)),y===t.RG_INTEGER&&(V===t.UNSIGNED_BYTE&&(Y=t.RG8UI),V===t.UNSIGNED_SHORT&&(Y=t.RG16UI),V===t.UNSIGNED_INT&&(Y=t.RG32UI),V===t.BYTE&&(Y=t.RG8I),V===t.SHORT&&(Y=t.RG16I),V===t.INT&&(Y=t.RG32I)),y===t.RGB_INTEGER&&(V===t.UNSIGNED_BYTE&&(Y=t.RGB8UI),V===t.UNSIGNED_SHORT&&(Y=t.RGB16UI),V===t.UNSIGNED_INT&&(Y=t.RGB32UI),V===t.BYTE&&(Y=t.RGB8I),V===t.SHORT&&(Y=t.RGB16I),V===t.INT&&(Y=t.RGB32I)),y===t.RGBA_INTEGER&&(V===t.UNSIGNED_BYTE&&(Y=t.RGBA8UI),V===t.UNSIGNED_SHORT&&(Y=t.RGBA16UI),V===t.UNSIGNED_INT&&(Y=t.RGBA32UI),V===t.BYTE&&(Y=t.RGBA8I),V===t.SHORT&&(Y=t.RGBA16I),V===t.INT&&(Y=t.RGBA32I)),y===t.RGB&&(V===t.UNSIGNED_SHORT&&de&&(Y=de.RGB16_EXT),V===t.SHORT&&de&&(Y=de.RGB16_SNORM_EXT),V===t.UNSIGNED_INT_5_9_9_9_REV&&(Y=t.RGB9_E5),V===t.UNSIGNED_INT_10F_11F_11F_REV&&(Y=t.R11F_G11F_B10F)),y===t.RGBA){let Z=oe?Va:je.getTransfer(ee);V===t.FLOAT&&(Y=t.RGBA32F),V===t.HALF_FLOAT&&(Y=t.RGBA16F),V===t.UNSIGNED_BYTE&&(Y=Z===ut?t.SRGB8_ALPHA8:t.RGBA8),V===t.UNSIGNED_SHORT&&de&&(Y=de.RGBA16_EXT),V===t.SHORT&&de&&(Y=de.RGBA16_SNORM_EXT),V===t.UNSIGNED_SHORT_4_4_4_4&&(Y=t.RGBA4),V===t.UNSIGNED_SHORT_5_5_5_1&&(Y=t.RGB5_A1)}return(Y===t.R16F||Y===t.R32F||Y===t.RG16F||Y===t.RG32F||Y===t.RGBA16F||Y===t.RGBA32F)&&e.get("EXT_color_buffer_float"),Y}function C(E,y){let V;return E?y===null||y===vi||y===Po?V=t.DEPTH24_STENCIL8:y===ti?V=t.DEPTH32F_STENCIL8:y===Ro&&(V=t.DEPTH24_STENCIL8,Fe("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):y===null||y===vi||y===Po?V=t.DEPTH_COMPONENT24:y===ti?V=t.DEPTH_COMPONENT32F:y===Ro&&(V=t.DEPTH_COMPONENT16),V}function b(E,y){return h(E)===!0||E.isFramebufferTexture&&E.minFilter!==Kt&&E.minFilter!==rn?Math.log2(Math.max(y.width,y.height))+1:E.mipmaps!==void 0&&E.mipmaps.length>0?E.mipmaps.length:E.isCompressedTexture&&Array.isArray(E.image)?y.mipmaps.length:1}function R(E){let y=E.target;y.removeEventListener("dispose",R),T(y),y.isVideoTexture&&d.delete(y),y.isHTMLTexture&&f.delete(y)}function m(E){let y=E.target;y.removeEventListener("dispose",m),A(y)}function T(E){let y=i.get(E);if(y.__webglInit===void 0)return;let V=E.source,K=p.get(V);if(K){let ee=K[y.__cacheKey];ee.usedTimes--,ee.usedTimes===0&&I(E),Object.keys(K).length===0&&p.delete(V)}i.remove(E)}function I(E){let y=i.get(E);t.deleteTexture(y.__webglTexture);let V=E.source,K=p.get(V);delete K[y.__cacheKey],o.memory.textures--}function A(E){let y=i.get(E);if(E.depthTexture&&(E.depthTexture.dispose(),i.remove(E.depthTexture)),E.isWebGLCubeRenderTarget)for(let K=0;K<6;K++){if(Array.isArray(y.__webglFramebuffer[K]))for(let ee=0;ee<y.__webglFramebuffer[K].length;ee++)t.deleteFramebuffer(y.__webglFramebuffer[K][ee]);else t.deleteFramebuffer(y.__webglFramebuffer[K]);y.__webglDepthbuffer&&t.deleteRenderbuffer(y.__webglDepthbuffer[K])}else{if(Array.isArray(y.__webglFramebuffer))for(let K=0;K<y.__webglFramebuffer.length;K++)t.deleteFramebuffer(y.__webglFramebuffer[K]);else t.deleteFramebuffer(y.__webglFramebuffer);if(y.__webglDepthbuffer&&t.deleteRenderbuffer(y.__webglDepthbuffer),y.__webglMultisampledFramebuffer&&t.deleteFramebuffer(y.__webglMultisampledFramebuffer),y.__webglColorRenderbuffer)for(let K=0;K<y.__webglColorRenderbuffer.length;K++)y.__webglColorRenderbuffer[K]&&t.deleteRenderbuffer(y.__webglColorRenderbuffer[K]);y.__webglDepthRenderbuffer&&t.deleteRenderbuffer(y.__webglDepthRenderbuffer)}let V=E.textures;for(let K=0,ee=V.length;K<ee;K++){let oe=i.get(V[K]);oe.__webglTexture&&(t.deleteTexture(oe.__webglTexture),o.memory.textures--),i.remove(V[K])}i.remove(E)}let P=0;function O(){P=0}function z(){return P}function L(E){P=E}function B(){let E=P;return E>=r.maxTextures&&Fe("WebGLTextures: Trying to use "+E+" texture units while this GPU supports only "+r.maxTextures),P+=1,E}function G(E){let y=[];return y.push(E.wrapS),y.push(E.wrapT),y.push(E.wrapR||0),y.push(E.magFilter),y.push(E.minFilter),y.push(E.anisotropy),y.push(E.internalFormat),y.push(E.format),y.push(E.type),y.push(E.generateMipmaps),y.push(E.premultiplyAlpha),y.push(E.flipY),y.push(E.unpackAlignment),y.push(E.colorSpace),y.join()}function q(E,y){let V=i.get(E);if(E.isVideoTexture&&ot(E),E.isRenderTargetTexture===!1&&E.isExternalTexture!==!0&&E.version>0&&V.__version!==E.version){let K=E.image;if(K===null)Fe("WebGLRenderer: Texture marked for update but no image data found.");else if(K.complete===!1)Fe("WebGLRenderer: Texture marked for update but image is incomplete");else{Ae(V,E,y);return}}else E.isExternalTexture&&(V.__webglTexture=E.sourceTexture?E.sourceTexture:null);n.bindTexture(t.TEXTURE_2D,V.__webglTexture,t.TEXTURE0+y)}function J(E,y){let V=i.get(E);if(E.isRenderTargetTexture===!1&&E.version>0&&V.__version!==E.version){Ae(V,E,y);return}else E.isExternalTexture&&(V.__webglTexture=E.sourceTexture?E.sourceTexture:null);n.bindTexture(t.TEXTURE_2D_ARRAY,V.__webglTexture,t.TEXTURE0+y)}function j(E,y){let V=i.get(E);if(E.isRenderTargetTexture===!1&&E.version>0&&V.__version!==E.version){Ae(V,E,y);return}n.bindTexture(t.TEXTURE_3D,V.__webglTexture,t.TEXTURE0+y)}function ue(E,y){let V=i.get(E);if(E.isCubeDepthTexture!==!0&&E.version>0&&V.__version!==E.version){Ie(V,E,y);return}n.bindTexture(t.TEXTURE_CUBE_MAP,V.__webglTexture,t.TEXTURE0+y)}let U={[Cu]:t.REPEAT,[Ci]:t.CLAMP_TO_EDGE,[Ru]:t.MIRRORED_REPEAT},ne={[Kt]:t.NEAREST,[z_]:t.NEAREST_MIPMAP_NEAREST,[fl]:t.NEAREST_MIPMAP_LINEAR,[rn]:t.LINEAR,[dh]:t.LINEAR_MIPMAP_NEAREST,[qr]:t.LINEAR_MIPMAP_LINEAR},Ne={[H_]:t.NEVER,[Z_]:t.ALWAYS,[W_]:t.LESS,[Jh]:t.LEQUAL,[X_]:t.EQUAL,[Kh]:t.GEQUAL,[q_]:t.GREATER,[Y_]:t.NOTEQUAL};function he(E,y){if(y.type===ti&&e.has("OES_texture_float_linear")===!1&&(y.magFilter===rn||y.magFilter===dh||y.magFilter===fl||y.magFilter===qr||y.minFilter===rn||y.minFilter===dh||y.minFilter===fl||y.minFilter===qr)&&Fe("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),t.texParameteri(E,t.TEXTURE_WRAP_S,U[y.wrapS]),t.texParameteri(E,t.TEXTURE_WRAP_T,U[y.wrapT]),(E===t.TEXTURE_3D||E===t.TEXTURE_2D_ARRAY)&&t.texParameteri(E,t.TEXTURE_WRAP_R,U[y.wrapR]),t.texParameteri(E,t.TEXTURE_MAG_FILTER,ne[y.magFilter]),t.texParameteri(E,t.TEXTURE_MIN_FILTER,ne[y.minFilter]),y.compareFunction&&(t.texParameteri(E,t.TEXTURE_COMPARE_MODE,t.COMPARE_REF_TO_TEXTURE),t.texParameteri(E,t.TEXTURE_COMPARE_FUNC,Ne[y.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(y.magFilter===Kt||y.minFilter!==fl&&y.minFilter!==qr||y.type===ti&&e.has("OES_texture_float_linear")===!1)return;if(y.anisotropy>1||i.get(y).__currentAnisotropy){let V=e.get("EXT_texture_filter_anisotropic");t.texParameterf(E,V.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(y.anisotropy,r.getMaxAnisotropy())),i.get(y).__currentAnisotropy=y.anisotropy}}}function Q(E,y){let V=!1;E.__webglInit===void 0&&(E.__webglInit=!0,y.addEventListener("dispose",R));let K=y.source,ee=p.get(K);ee===void 0&&(ee={},p.set(K,ee));let oe=G(y);if(oe!==E.__cacheKey){ee[oe]===void 0&&(ee[oe]={texture:t.createTexture(),usedTimes:0},o.memory.textures++,V=!0),ee[oe].usedTimes++;let de=ee[E.__cacheKey];de!==void 0&&(ee[E.__cacheKey].usedTimes--,de.usedTimes===0&&I(y)),E.__cacheKey=oe,E.__webglTexture=ee[oe].texture}return V}function me(E,y,V){return Math.floor(Math.floor(E/V)/y)}function le(E,y,V,K){let oe=E.updateRanges;if(oe.length===0)n.texSubImage2D(t.TEXTURE_2D,0,0,0,y.width,y.height,V,K,y.data);else{oe.sort((ge,ce)=>ge.start-ce.start);let de=0;for(let ge=1;ge<oe.length;ge++){let ce=oe[de],ie=oe[ge],De=ce.start+ce.count,Oe=me(ie.start,y.width,4),Ve=me(ce.start,y.width,4);ie.start<=De+1&&Oe===Ve&&me(ie.start+ie.count-1,y.width,4)===Oe?ce.count=Math.max(ce.count,ie.start+ie.count-ce.start):(++de,oe[de]=ie)}oe.length=de+1;let Y=n.getParameter(t.UNPACK_ROW_LENGTH),Z=n.getParameter(t.UNPACK_SKIP_PIXELS),ae=n.getParameter(t.UNPACK_SKIP_ROWS);n.pixelStorei(t.UNPACK_ROW_LENGTH,y.width);for(let ge=0,ce=oe.length;ge<ce;ge++){let ie=oe[ge],De=Math.floor(ie.start/4),Oe=Math.ceil(ie.count/4),Ve=De%y.width,N=Math.floor(De/y.width),se=Oe,$=1;n.pixelStorei(t.UNPACK_SKIP_PIXELS,Ve),n.pixelStorei(t.UNPACK_SKIP_ROWS,N),n.texSubImage2D(t.TEXTURE_2D,0,Ve,N,se,$,V,K,y.data)}E.clearUpdateRanges(),n.pixelStorei(t.UNPACK_ROW_LENGTH,Y),n.pixelStorei(t.UNPACK_SKIP_PIXELS,Z),n.pixelStorei(t.UNPACK_SKIP_ROWS,ae)}}function Ae(E,y,V){let K=t.TEXTURE_2D;(y.isDataArrayTexture||y.isCompressedArrayTexture)&&(K=t.TEXTURE_2D_ARRAY),y.isData3DTexture&&(K=t.TEXTURE_3D);let ee=Q(E,y),oe=y.source;n.bindTexture(K,E.__webglTexture,t.TEXTURE0+V);let de=i.get(oe);if(oe.version!==de.__version||ee===!0){if(n.activeTexture(t.TEXTURE0+V),(typeof ImageBitmap<"u"&&y.image instanceof ImageBitmap)===!1){let $=je.getPrimaries(je.workingColorSpace),ye=y.colorSpace===or?null:je.getPrimaries(y.colorSpace),fe=y.colorSpace===or||$===ye?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,y.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,fe)}n.pixelStorei(t.UNPACK_ALIGNMENT,y.unpackAlignment);let Z=v(y.image,!1,r.maxTextureSize);Z=pe(y,Z);let ae=s.convert(y.format,y.colorSpace),ge=s.convert(y.type),ce=M(y.internalFormat,ae,ge,y.normalized,y.colorSpace,y.isVideoTexture);he(K,y);let ie,De=y.mipmaps,Oe=y.isVideoTexture!==!0,Ve=de.__version===void 0||ee===!0,N=oe.dataReady,se=b(y,Z);if(y.isDepthTexture)ce=C(y.format===Yr,y.type),Ve&&(Oe?n.texStorage2D(t.TEXTURE_2D,1,ce,Z.width,Z.height):n.texImage2D(t.TEXTURE_2D,0,ce,Z.width,Z.height,0,ae,ge,null));else if(y.isDataTexture)if(De.length>0){Oe&&Ve&&n.texStorage2D(t.TEXTURE_2D,se,ce,De[0].width,De[0].height);for(let $=0,ye=De.length;$<ye;$++)ie=De[$],Oe?N&&n.texSubImage2D(t.TEXTURE_2D,$,0,0,ie.width,ie.height,ae,ge,ie.data):n.texImage2D(t.TEXTURE_2D,$,ce,ie.width,ie.height,0,ae,ge,ie.data);y.generateMipmaps=!1}else Oe?(Ve&&n.texStorage2D(t.TEXTURE_2D,se,ce,Z.width,Z.height),N&&le(y,Z,ae,ge)):n.texImage2D(t.TEXTURE_2D,0,ce,Z.width,Z.height,0,ae,ge,Z.data);else if(y.isCompressedTexture)if(y.isCompressedArrayTexture){Oe&&Ve&&n.texStorage3D(t.TEXTURE_2D_ARRAY,se,ce,De[0].width,De[0].height,Z.depth);for(let $=0,ye=De.length;$<ye;$++)if(ie=De[$],y.format!==ni)if(ae!==null)if(Oe){if(N)if(y.layerUpdates.size>0){let fe=Fm(ie.width,ie.height,y.format,y.type);for(let te of y.layerUpdates){let Ce=ie.data.subarray(te*fe/ie.data.BYTES_PER_ELEMENT,(te+1)*fe/ie.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,$,0,0,te,ie.width,ie.height,1,ae,Ce)}y.clearLayerUpdates()}else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY,$,0,0,0,ie.width,ie.height,Z.depth,ae,ie.data)}else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY,$,ce,ie.width,ie.height,Z.depth,0,ie.data,0,0);else Fe("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Oe?N&&n.texSubImage3D(t.TEXTURE_2D_ARRAY,$,0,0,0,ie.width,ie.height,Z.depth,ae,ge,ie.data):n.texImage3D(t.TEXTURE_2D_ARRAY,$,ce,ie.width,ie.height,Z.depth,0,ae,ge,ie.data)}else{Oe&&Ve&&n.texStorage2D(t.TEXTURE_2D,se,ce,De[0].width,De[0].height);for(let $=0,ye=De.length;$<ye;$++)ie=De[$],y.format!==ni?ae!==null?Oe?N&&n.compressedTexSubImage2D(t.TEXTURE_2D,$,0,0,ie.width,ie.height,ae,ie.data):n.compressedTexImage2D(t.TEXTURE_2D,$,ce,ie.width,ie.height,0,ie.data):Fe("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Oe?N&&n.texSubImage2D(t.TEXTURE_2D,$,0,0,ie.width,ie.height,ae,ge,ie.data):n.texImage2D(t.TEXTURE_2D,$,ce,ie.width,ie.height,0,ae,ge,ie.data)}else if(y.isDataArrayTexture)if(Oe){if(Ve&&n.texStorage3D(t.TEXTURE_2D_ARRAY,se,ce,Z.width,Z.height,Z.depth),N)if(y.layerUpdates.size>0){let $=Fm(Z.width,Z.height,y.format,y.type);for(let ye of y.layerUpdates){let fe=Z.data.subarray(ye*$/Z.data.BYTES_PER_ELEMENT,(ye+1)*$/Z.data.BYTES_PER_ELEMENT);n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,ye,Z.width,Z.height,1,ae,ge,fe)}y.clearLayerUpdates()}else n.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,0,Z.width,Z.height,Z.depth,ae,ge,Z.data)}else n.texImage3D(t.TEXTURE_2D_ARRAY,0,ce,Z.width,Z.height,Z.depth,0,ae,ge,Z.data);else if(y.isData3DTexture)Oe?(Ve&&n.texStorage3D(t.TEXTURE_3D,se,ce,Z.width,Z.height,Z.depth),N&&n.texSubImage3D(t.TEXTURE_3D,0,0,0,0,Z.width,Z.height,Z.depth,ae,ge,Z.data)):n.texImage3D(t.TEXTURE_3D,0,ce,Z.width,Z.height,Z.depth,0,ae,ge,Z.data);else if(y.isFramebufferTexture){if(Ve)if(Oe)n.texStorage2D(t.TEXTURE_2D,se,ce,Z.width,Z.height);else{let $=Z.width,ye=Z.height;for(let fe=0;fe<se;fe++)n.texImage2D(t.TEXTURE_2D,fe,ce,$,ye,0,ae,ge,null),$>>=1,ye>>=1}}else if(y.isHTMLTexture){if("texElementImage2D"in t){let $=t.canvas;if($.hasAttribute("layoutsubtree")||$.setAttribute("layoutsubtree","true"),Z.parentNode!==$){$.appendChild(Z),f.add(y),$.onpaint=Se=>{let $e=Se.changedElements;for(let qe of f)$e.includes(qe.image)&&(qe.needsUpdate=!0)},$.requestPaint();return}let ye=0,fe=t.RGBA,te=t.RGBA,Ce=t.UNSIGNED_BYTE;t.texElementImage2D(t.TEXTURE_2D,ye,fe,te,Ce,Z),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE)}}else if(De.length>0){if(Oe&&Ve){let $=at(De[0]);n.texStorage2D(t.TEXTURE_2D,se,ce,$.width,$.height)}for(let $=0,ye=De.length;$<ye;$++)ie=De[$],Oe?N&&n.texSubImage2D(t.TEXTURE_2D,$,0,0,ae,ge,ie):n.texImage2D(t.TEXTURE_2D,$,ce,ae,ge,ie);y.generateMipmaps=!1}else if(Oe){if(Ve){let $=at(Z);n.texStorage2D(t.TEXTURE_2D,se,ce,$.width,$.height)}N&&n.texSubImage2D(t.TEXTURE_2D,0,0,0,ae,ge,Z)}else n.texImage2D(t.TEXTURE_2D,0,ce,ae,ge,Z);h(y)&&g(K),de.__version=oe.version,y.onUpdate&&y.onUpdate(y)}E.__version=y.version}function Ie(E,y,V){if(y.image.length!==6)return;let K=Q(E,y),ee=y.source;n.bindTexture(t.TEXTURE_CUBE_MAP,E.__webglTexture,t.TEXTURE0+V);let oe=i.get(ee);if(ee.version!==oe.__version||K===!0){n.activeTexture(t.TEXTURE0+V);let de=je.getPrimaries(je.workingColorSpace),Y=y.colorSpace===or?null:je.getPrimaries(y.colorSpace),Z=y.colorSpace===or||de===Y?t.NONE:t.BROWSER_DEFAULT_WEBGL;n.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,y.flipY),n.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),n.pixelStorei(t.UNPACK_ALIGNMENT,y.unpackAlignment),n.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL,Z);let ae=y.isCompressedTexture||y.image[0].isCompressedTexture,ge=y.image[0]&&y.image[0].isDataTexture,ce=[];for(let te=0;te<6;te++)!ae&&!ge?ce[te]=v(y.image[te],!0,r.maxCubemapSize):ce[te]=ge?y.image[te].image:y.image[te],ce[te]=pe(y,ce[te]);let ie=ce[0],De=s.convert(y.format,y.colorSpace),Oe=s.convert(y.type),Ve=M(y.internalFormat,De,Oe,y.normalized,y.colorSpace),N=y.isVideoTexture!==!0,se=oe.__version===void 0||K===!0,$=ee.dataReady,ye=b(y,ie);he(t.TEXTURE_CUBE_MAP,y);let fe;if(ae){N&&se&&n.texStorage2D(t.TEXTURE_CUBE_MAP,ye,Ve,ie.width,ie.height);for(let te=0;te<6;te++){fe=ce[te].mipmaps;for(let Ce=0;Ce<fe.length;Ce++){let Se=fe[Ce];y.format!==ni?De!==null?N?$&&n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ce,0,0,Se.width,Se.height,De,Se.data):n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ce,Ve,Se.width,Se.height,0,Se.data):Fe("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):N?$&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ce,0,0,Se.width,Se.height,De,Oe,Se.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ce,Ve,Se.width,Se.height,0,De,Oe,Se.data)}}}else{if(fe=y.mipmaps,N&&se){fe.length>0&&ye++;let te=at(ce[0]);n.texStorage2D(t.TEXTURE_CUBE_MAP,ye,Ve,te.width,te.height)}for(let te=0;te<6;te++)if(ge){N?$&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,0,0,ce[te].width,ce[te].height,De,Oe,ce[te].data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,Ve,ce[te].width,ce[te].height,0,De,Oe,ce[te].data);for(let Ce=0;Ce<fe.length;Ce++){let $e=fe[Ce].image[te].image;N?$&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ce+1,0,0,$e.width,$e.height,De,Oe,$e.data):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ce+1,Ve,$e.width,$e.height,0,De,Oe,$e.data)}}else{N?$&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,0,0,De,Oe,ce[te]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,0,Ve,De,Oe,ce[te]);for(let Ce=0;Ce<fe.length;Ce++){let Se=fe[Ce];N?$&&n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ce+1,0,0,De,Oe,Se.image[te]):n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+te,Ce+1,Ve,De,Oe,Se.image[te])}}}h(y)&&g(t.TEXTURE_CUBE_MAP),oe.__version=ee.version,y.onUpdate&&y.onUpdate(y)}E.__version=y.version}function Te(E,y,V,K,ee,oe){let de=s.convert(V.format,V.colorSpace),Y=s.convert(V.type),Z=M(V.internalFormat,de,Y,V.normalized,V.colorSpace),ae=i.get(y),ge=i.get(V);if(ge.__renderTarget=y,!ae.__hasExternalTextures){let ce=Math.max(1,y.width>>oe),ie=Math.max(1,y.height>>oe);ee===t.TEXTURE_3D||ee===t.TEXTURE_2D_ARRAY?n.texImage3D(ee,oe,Z,ce,ie,y.depth,0,de,Y,null):n.texImage2D(ee,oe,Z,ce,ie,0,de,Y,null)}n.bindFramebuffer(t.FRAMEBUFFER,E),Xe(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,K,ee,ge.__webglTexture,0,Lt(y)):(ee===t.TEXTURE_2D||ee>=t.TEXTURE_CUBE_MAP_POSITIVE_X&&ee<=t.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&t.framebufferTexture2D(t.FRAMEBUFFER,K,ee,ge.__webglTexture,oe),n.bindFramebuffer(t.FRAMEBUFFER,null)}function ft(E,y,V){if(t.bindRenderbuffer(t.RENDERBUFFER,E),y.depthBuffer){let K=y.depthTexture,ee=K&&K.isDepthTexture?K.type:null,oe=C(y.stencilBuffer,ee),de=y.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;Xe(y)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,Lt(y),oe,y.width,y.height):V?t.renderbufferStorageMultisample(t.RENDERBUFFER,Lt(y),oe,y.width,y.height):t.renderbufferStorage(t.RENDERBUFFER,oe,y.width,y.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,de,t.RENDERBUFFER,E)}else{let K=y.textures;for(let ee=0;ee<K.length;ee++){let oe=K[ee],de=s.convert(oe.format,oe.colorSpace),Y=s.convert(oe.type),Z=M(oe.internalFormat,de,Y,oe.normalized,oe.colorSpace);Xe(y)?a.renderbufferStorageMultisampleEXT(t.RENDERBUFFER,Lt(y),Z,y.width,y.height):V?t.renderbufferStorageMultisample(t.RENDERBUFFER,Lt(y),Z,y.width,y.height):t.renderbufferStorage(t.RENDERBUFFER,Z,y.width,y.height)}}t.bindRenderbuffer(t.RENDERBUFFER,null)}function ke(E,y,V){let K=y.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(t.FRAMEBUFFER,E),!(y.depthTexture&&y.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let ee=i.get(y.depthTexture);if(ee.__renderTarget=y,(!ee.__webglTexture||y.depthTexture.image.width!==y.width||y.depthTexture.image.height!==y.height)&&(y.depthTexture.image.width=y.width,y.depthTexture.image.height=y.height,y.depthTexture.needsUpdate=!0),K){if(ee.__webglInit===void 0&&(ee.__webglInit=!0,y.depthTexture.addEventListener("dispose",R)),ee.__webglTexture===void 0){ee.__webglTexture=t.createTexture(),n.bindTexture(t.TEXTURE_CUBE_MAP,ee.__webglTexture),he(t.TEXTURE_CUBE_MAP,y.depthTexture);let ae=s.convert(y.depthTexture.format),ge=s.convert(y.depthTexture.type),ce;y.depthTexture.format===Ri?ce=t.DEPTH_COMPONENT24:y.depthTexture.format===Yr&&(ce=t.DEPTH24_STENCIL8);for(let ie=0;ie<6;ie++)t.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X+ie,0,ce,y.width,y.height,0,ae,ge,null)}}else q(y.depthTexture,0);let oe=ee.__webglTexture,de=Lt(y),Y=K?t.TEXTURE_CUBE_MAP_POSITIVE_X+V:t.TEXTURE_2D,Z=y.depthTexture.format===Yr?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;if(y.depthTexture.format===Ri)Xe(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,Z,Y,oe,0,de):t.framebufferTexture2D(t.FRAMEBUFFER,Z,Y,oe,0);else if(y.depthTexture.format===Yr)Xe(y)?a.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER,Z,Y,oe,0,de):t.framebufferTexture2D(t.FRAMEBUFFER,Z,Y,oe,0);else throw new Error("Unknown depthTexture format")}function it(E){let y=i.get(E),V=E.isWebGLCubeRenderTarget===!0;if(y.__boundDepthTexture!==E.depthTexture){let K=E.depthTexture;if(y.__depthDisposeCallback&&y.__depthDisposeCallback(),K){let ee=()=>{delete y.__boundDepthTexture,delete y.__depthDisposeCallback,K.removeEventListener("dispose",ee)};K.addEventListener("dispose",ee),y.__depthDisposeCallback=ee}y.__boundDepthTexture=K}if(E.depthTexture&&!y.__autoAllocateDepthBuffer)if(V)for(let K=0;K<6;K++)ke(y.__webglFramebuffer[K],E,K);else{let K=E.texture.mipmaps;K&&K.length>0?ke(y.__webglFramebuffer[0],E,0):ke(y.__webglFramebuffer,E,0)}else if(V){y.__webglDepthbuffer=[];for(let K=0;K<6;K++)if(n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer[K]),y.__webglDepthbuffer[K]===void 0)y.__webglDepthbuffer[K]=t.createRenderbuffer(),ft(y.__webglDepthbuffer[K],E,!1);else{let ee=E.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,oe=y.__webglDepthbuffer[K];t.bindRenderbuffer(t.RENDERBUFFER,oe),t.framebufferRenderbuffer(t.FRAMEBUFFER,ee,t.RENDERBUFFER,oe)}}else{let K=E.texture.mipmaps;if(K&&K.length>0?n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer[0]):n.bindFramebuffer(t.FRAMEBUFFER,y.__webglFramebuffer),y.__webglDepthbuffer===void 0)y.__webglDepthbuffer=t.createRenderbuffer(),ft(y.__webglDepthbuffer,E,!1);else{let ee=E.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,oe=y.__webglDepthbuffer;t.bindRenderbuffer(t.RENDERBUFFER,oe),t.framebufferRenderbuffer(t.FRAMEBUFFER,ee,t.RENDERBUFFER,oe)}}n.bindFramebuffer(t.FRAMEBUFFER,null)}function st(E,y,V){let K=i.get(E);y!==void 0&&Te(K.__webglFramebuffer,E,E.texture,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,0),V!==void 0&&it(E)}function We(E){let y=E.texture,V=i.get(E),K=i.get(y);E.addEventListener("dispose",m);let ee=E.textures,oe=E.isWebGLCubeRenderTarget===!0,de=ee.length>1;if(de||(K.__webglTexture===void 0&&(K.__webglTexture=t.createTexture()),K.__version=y.version,o.memory.textures++),oe){V.__webglFramebuffer=[];for(let Y=0;Y<6;Y++)if(y.mipmaps&&y.mipmaps.length>0){V.__webglFramebuffer[Y]=[];for(let Z=0;Z<y.mipmaps.length;Z++)V.__webglFramebuffer[Y][Z]=t.createFramebuffer()}else V.__webglFramebuffer[Y]=t.createFramebuffer()}else{if(y.mipmaps&&y.mipmaps.length>0){V.__webglFramebuffer=[];for(let Y=0;Y<y.mipmaps.length;Y++)V.__webglFramebuffer[Y]=t.createFramebuffer()}else V.__webglFramebuffer=t.createFramebuffer();if(de)for(let Y=0,Z=ee.length;Y<Z;Y++){let ae=i.get(ee[Y]);ae.__webglTexture===void 0&&(ae.__webglTexture=t.createTexture(),o.memory.textures++)}if(E.samples>0&&Xe(E)===!1){V.__webglMultisampledFramebuffer=t.createFramebuffer(),V.__webglColorRenderbuffer=[],n.bindFramebuffer(t.FRAMEBUFFER,V.__webglMultisampledFramebuffer);for(let Y=0;Y<ee.length;Y++){let Z=ee[Y];V.__webglColorRenderbuffer[Y]=t.createRenderbuffer(),t.bindRenderbuffer(t.RENDERBUFFER,V.__webglColorRenderbuffer[Y]);let ae=s.convert(Z.format,Z.colorSpace),ge=s.convert(Z.type),ce=M(Z.internalFormat,ae,ge,Z.normalized,Z.colorSpace,E.isXRRenderTarget===!0),ie=Lt(E);t.renderbufferStorageMultisample(t.RENDERBUFFER,ie,ce,E.width,E.height),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+Y,t.RENDERBUFFER,V.__webglColorRenderbuffer[Y])}t.bindRenderbuffer(t.RENDERBUFFER,null),E.depthBuffer&&(V.__webglDepthRenderbuffer=t.createRenderbuffer(),ft(V.__webglDepthRenderbuffer,E,!0)),n.bindFramebuffer(t.FRAMEBUFFER,null)}}if(oe){n.bindTexture(t.TEXTURE_CUBE_MAP,K.__webglTexture),he(t.TEXTURE_CUBE_MAP,y);for(let Y=0;Y<6;Y++)if(y.mipmaps&&y.mipmaps.length>0)for(let Z=0;Z<y.mipmaps.length;Z++)Te(V.__webglFramebuffer[Y][Z],E,y,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Y,Z);else Te(V.__webglFramebuffer[Y],E,y,t.COLOR_ATTACHMENT0,t.TEXTURE_CUBE_MAP_POSITIVE_X+Y,0);h(y)&&g(t.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(de){for(let Y=0,Z=ee.length;Y<Z;Y++){let ae=ee[Y],ge=i.get(ae),ce=t.TEXTURE_2D;(E.isWebGL3DRenderTarget||E.isWebGLArrayRenderTarget)&&(ce=E.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(ce,ge.__webglTexture),he(ce,ae),Te(V.__webglFramebuffer,E,ae,t.COLOR_ATTACHMENT0+Y,ce,0),h(ae)&&g(ce)}n.unbindTexture()}else{let Y=t.TEXTURE_2D;if((E.isWebGL3DRenderTarget||E.isWebGLArrayRenderTarget)&&(Y=E.isWebGL3DRenderTarget?t.TEXTURE_3D:t.TEXTURE_2D_ARRAY),n.bindTexture(Y,K.__webglTexture),he(Y,y),y.mipmaps&&y.mipmaps.length>0)for(let Z=0;Z<y.mipmaps.length;Z++)Te(V.__webglFramebuffer[Z],E,y,t.COLOR_ATTACHMENT0,Y,Z);else Te(V.__webglFramebuffer,E,y,t.COLOR_ATTACHMENT0,Y,0);h(y)&&g(Y),n.unbindTexture()}E.depthBuffer&&it(E)}function St(E){let y=E.textures;for(let V=0,K=y.length;V<K;V++){let ee=y[V];if(h(ee)){let oe=_(E),de=i.get(ee).__webglTexture;n.bindTexture(oe,de),g(oe),n.unbindTexture()}}}let pt=[],Bt=[];function F(E){if(E.samples>0){if(Xe(E)===!1){let y=E.textures,V=E.width,K=E.height,ee=t.COLOR_BUFFER_BIT,oe=E.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT,de=i.get(E),Y=y.length>1;if(Y)for(let ae=0;ae<y.length;ae++)n.bindFramebuffer(t.FRAMEBUFFER,de.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+ae,t.RENDERBUFFER,null),n.bindFramebuffer(t.FRAMEBUFFER,de.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+ae,t.TEXTURE_2D,null,0);n.bindFramebuffer(t.READ_FRAMEBUFFER,de.__webglMultisampledFramebuffer);let Z=E.texture.mipmaps;Z&&Z.length>0?n.bindFramebuffer(t.DRAW_FRAMEBUFFER,de.__webglFramebuffer[0]):n.bindFramebuffer(t.DRAW_FRAMEBUFFER,de.__webglFramebuffer);for(let ae=0;ae<y.length;ae++){if(E.resolveDepthBuffer&&(E.depthBuffer&&(ee|=t.DEPTH_BUFFER_BIT),E.stencilBuffer&&E.resolveStencilBuffer&&(ee|=t.STENCIL_BUFFER_BIT)),Y){t.framebufferRenderbuffer(t.READ_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.RENDERBUFFER,de.__webglColorRenderbuffer[ae]);let ge=i.get(y[ae]).__webglTexture;t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,ge,0)}t.blitFramebuffer(0,0,V,K,0,0,V,K,ee,t.NEAREST),l===!0&&(pt.length=0,Bt.length=0,pt.push(t.COLOR_ATTACHMENT0+ae),E.depthBuffer&&E.resolveDepthBuffer===!1&&(pt.push(oe),Bt.push(oe),t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,Bt)),t.invalidateFramebuffer(t.READ_FRAMEBUFFER,pt))}if(n.bindFramebuffer(t.READ_FRAMEBUFFER,null),n.bindFramebuffer(t.DRAW_FRAMEBUFFER,null),Y)for(let ae=0;ae<y.length;ae++){n.bindFramebuffer(t.FRAMEBUFFER,de.__webglMultisampledFramebuffer),t.framebufferRenderbuffer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0+ae,t.RENDERBUFFER,de.__webglColorRenderbuffer[ae]);let ge=i.get(y[ae]).__webglTexture;n.bindFramebuffer(t.FRAMEBUFFER,de.__webglFramebuffer),t.framebufferTexture2D(t.DRAW_FRAMEBUFFER,t.COLOR_ATTACHMENT0+ae,t.TEXTURE_2D,ge,0)}n.bindFramebuffer(t.DRAW_FRAMEBUFFER,de.__webglMultisampledFramebuffer)}else if(E.depthBuffer&&E.resolveDepthBuffer===!1&&l){let y=E.stencilBuffer?t.DEPTH_STENCIL_ATTACHMENT:t.DEPTH_ATTACHMENT;t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER,[y])}}}function Lt(E){return Math.min(r.maxSamples,E.samples)}function Xe(E){let y=i.get(E);return E.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&y.__useRenderToTexture!==!1}function ot(E){let y=o.render.frame;d.get(E)!==y&&(d.set(E,y),E.update())}function pe(E,y){let V=E.colorSpace,K=E.format,ee=E.type;return E.isCompressedTexture===!0||E.isVideoTexture===!0||V!==za&&V!==or&&(je.getTransfer(V)===ut?(K!==ni||ee!==Pn)&&Fe("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Be("WebGLTextures: Unsupported texture color space:",V)),y}function at(E){return typeof HTMLImageElement<"u"&&E instanceof HTMLImageElement?(c.width=E.naturalWidth||E.width,c.height=E.naturalHeight||E.height):typeof VideoFrame<"u"&&E instanceof VideoFrame?(c.width=E.displayWidth,c.height=E.displayHeight):(c.width=E.width,c.height=E.height),c}this.allocateTextureUnit=B,this.resetTextureUnits=O,this.getTextureUnits=z,this.setTextureUnits=L,this.setTexture2D=q,this.setTexture2DArray=J,this.setTexture3D=j,this.setTextureCube=ue,this.rebindTextures=st,this.setupRenderTarget=We,this.updateRenderTargetMipmap=St,this.updateMultisampleRenderTarget=F,this.setupDepthRenderbuffer=it,this.setupFrameBufferTexture=Te,this.useMultisampledRTT=Xe,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function oC(t,e){function n(i,r=or){let s,o=je.getTransfer(r);if(i===Pn)return t.UNSIGNED_BYTE;if(i===ph)return t.UNSIGNED_SHORT_4_4_4_4;if(i===mh)return t.UNSIGNED_SHORT_5_5_5_1;if(i===wm)return t.UNSIGNED_INT_5_9_9_9_REV;if(i===bm)return t.UNSIGNED_INT_10F_11F_11F_REV;if(i===Mm)return t.BYTE;if(i===Em)return t.SHORT;if(i===Ro)return t.UNSIGNED_SHORT;if(i===fh)return t.INT;if(i===vi)return t.UNSIGNED_INT;if(i===ti)return t.FLOAT;if(i===Fi)return t.HALF_FLOAT;if(i===Tm)return t.ALPHA;if(i===Am)return t.RGB;if(i===ni)return t.RGBA;if(i===Ri)return t.DEPTH_COMPONENT;if(i===Yr)return t.DEPTH_STENCIL;if(i===gh)return t.RED;if(i===vh)return t.RED_INTEGER;if(i===Zr)return t.RG;if(i===xh)return t.RG_INTEGER;if(i===_h)return t.RGBA_INTEGER;if(i===pl||i===ml||i===gl||i===vl)if(o===ut)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===pl)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===ml)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===gl)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===vl)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===pl)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===ml)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===gl)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===vl)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===yh||i===Sh||i===Mh||i===Eh)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===yh)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Sh)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===Mh)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===Eh)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===wh||i===bh||i===Th||i===Ah||i===Ch||i===xl||i===Rh)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===wh||i===bh)return o===ut?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===Th)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===Ah)return s.COMPRESSED_R11_EAC;if(i===Ch)return s.COMPRESSED_SIGNED_R11_EAC;if(i===xl)return s.COMPRESSED_RG11_EAC;if(i===Rh)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===Ph||i===Ih||i===Lh||i===Nh||i===Dh||i===Uh||i===Fh||i===Oh||i===Bh||i===kh||i===zh||i===Vh||i===Gh||i===Hh)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===Ph)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===Ih)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Lh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Nh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Dh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===Uh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===Fh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Oh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===Bh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===kh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===zh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===Vh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===Gh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===Hh)return o===ut?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Wh||i===Xh||i===qh)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===Wh)return o===ut?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===Xh)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===qh)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===Yh||i===Zh||i===_l||i===$h)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===Yh)return s.COMPRESSED_RED_RGTC1_EXT;if(i===Zh)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===_l)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===$h)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===Po?t.UNSIGNED_INT_24_8:t[i]!==void 0?t[i]:null}return{convert:n}}var aC=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,lC=`
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

}`,tg=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,n){if(this.texture===null){let i=new ja(e.texture);(e.depthNear!==n.depthNear||e.depthFar!==n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let n=e.cameras[0].viewport,i=new Vn({vertexShader:aC,fragmentShader:lC,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new Qe(new tl(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},ng=class extends Pi{constructor(e,n){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,c=null,d=null,f=null,u=null,p=null,x=null,S=typeof XRWebGLBinding<"u",v=new tg,h={},g=n.getContextAttributes(),_=null,M=null,C=[],b=[],R=new Ue,m=null,T=new Sn;T.viewport=new It;let I=new Sn;I.viewport=new It;let A=[T,I],P=new sh,O=null,z=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(Q){let me=C[Q];return me===void 0&&(me=new wo,C[Q]=me),me.getTargetRaySpace()},this.getControllerGrip=function(Q){let me=C[Q];return me===void 0&&(me=new wo,C[Q]=me),me.getGripSpace()},this.getHand=function(Q){let me=C[Q];return me===void 0&&(me=new wo,C[Q]=me),me.getHandSpace()};function L(Q){let me=b.indexOf(Q.inputSource);if(me===-1)return;let le=C[me];le!==void 0&&(le.update(Q.inputSource,Q.frame,c||o),le.dispatchEvent({type:Q.type,data:Q.inputSource}))}function B(){r.removeEventListener("select",L),r.removeEventListener("selectstart",L),r.removeEventListener("selectend",L),r.removeEventListener("squeeze",L),r.removeEventListener("squeezestart",L),r.removeEventListener("squeezeend",L),r.removeEventListener("end",B),r.removeEventListener("inputsourceschange",G);for(let Q=0;Q<C.length;Q++){let me=b[Q];me!==null&&(b[Q]=null,C[Q].disconnect(me))}O=null,z=null,v.reset();for(let Q in h)delete h[Q];e.setRenderTarget(_),p=null,u=null,f=null,r=null,M=null,he.stop(),i.isPresenting=!1,e.setPixelRatio(m),e.setSize(R.width,R.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(Q){s=Q,i.isPresenting===!0&&Fe("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(Q){a=Q,i.isPresenting===!0&&Fe("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(Q){c=Q},this.getBaseLayer=function(){return u!==null?u:p},this.getBinding=function(){return f===null&&S&&(f=new XRWebGLBinding(r,n)),f},this.getFrame=function(){return x},this.getSession=function(){return r},this.setSession=async function(Q){if(r=Q,r!==null){if(_=e.getRenderTarget(),r.addEventListener("select",L),r.addEventListener("selectstart",L),r.addEventListener("selectend",L),r.addEventListener("squeeze",L),r.addEventListener("squeezestart",L),r.addEventListener("squeezeend",L),r.addEventListener("end",B),r.addEventListener("inputsourceschange",G),g.xrCompatible!==!0&&await n.makeXRCompatible(),m=e.getPixelRatio(),e.getSize(R),S&&"createProjectionLayer"in XRWebGLBinding.prototype){let le=null,Ae=null,Ie=null;g.depth&&(Ie=g.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,le=g.stencil?Yr:Ri,Ae=g.stencil?Po:vi);let Te={colorFormat:n.RGBA8,depthFormat:Ie,scaleFactor:s};f=this.getBinding(),u=f.createProjectionLayer(Te),r.updateRenderState({layers:[u]}),e.setPixelRatio(1),e.setSize(u.textureWidth,u.textureHeight,!1),M=new zn(u.textureWidth,u.textureHeight,{format:ni,type:Pn,depthTexture:new rr(u.textureWidth,u.textureHeight,Ae,void 0,void 0,void 0,void 0,void 0,void 0,le),stencilBuffer:g.stencil,colorSpace:e.outputColorSpace,samples:g.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1,resolveStencilBuffer:u.ignoreDepthValues===!1})}else{let le={antialias:g.antialias,alpha:!0,depth:g.depth,stencil:g.stencil,framebufferScaleFactor:s};p=new XRWebGLLayer(r,n,le),r.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),M=new zn(p.framebufferWidth,p.framebufferHeight,{format:ni,type:Pn,colorSpace:e.outputColorSpace,stencilBuffer:g.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}M.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),he.setContext(r),he.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return v.getDepthTexture()};function G(Q){for(let me=0;me<Q.removed.length;me++){let le=Q.removed[me],Ae=b.indexOf(le);Ae>=0&&(b[Ae]=null,C[Ae].disconnect(le))}for(let me=0;me<Q.added.length;me++){let le=Q.added[me],Ae=b.indexOf(le);if(Ae===-1){for(let Te=0;Te<C.length;Te++)if(Te>=b.length){b.push(le),Ae=Te;break}else if(b[Te]===null){b[Te]=le,Ae=Te;break}if(Ae===-1)break}let Ie=C[Ae];Ie&&Ie.connect(le)}}let q=new D,J=new D;function j(Q,me,le){q.setFromMatrixPosition(me.matrixWorld),J.setFromMatrixPosition(le.matrixWorld);let Ae=q.distanceTo(J),Ie=me.projectionMatrix.elements,Te=le.projectionMatrix.elements,ft=Ie[14]/(Ie[10]-1),ke=Ie[14]/(Ie[10]+1),it=(Ie[9]+1)/Ie[5],st=(Ie[9]-1)/Ie[5],We=(Ie[8]-1)/Ie[0],St=(Te[8]+1)/Te[0],pt=ft*We,Bt=ft*St,F=Ae/(-We+St),Lt=F*-We;if(me.matrixWorld.decompose(Q.position,Q.quaternion,Q.scale),Q.translateX(Lt),Q.translateZ(F),Q.matrixWorld.compose(Q.position,Q.quaternion,Q.scale),Q.matrixWorldInverse.copy(Q.matrixWorld).invert(),Ie[10]===-1)Q.projectionMatrix.copy(me.projectionMatrix),Q.projectionMatrixInverse.copy(me.projectionMatrixInverse);else{let Xe=ft+F,ot=ke+F,pe=pt-Lt,at=Bt+(Ae-Lt),E=it*ke/ot*Xe,y=st*ke/ot*Xe;Q.projectionMatrix.makePerspective(pe,at,E,y,Xe,ot),Q.projectionMatrixInverse.copy(Q.projectionMatrix).invert()}}function ue(Q,me){me===null?Q.matrixWorld.copy(Q.matrix):Q.matrixWorld.multiplyMatrices(me.matrixWorld,Q.matrix),Q.matrixWorldInverse.copy(Q.matrixWorld).invert()}this.updateCamera=function(Q){if(r===null)return;let me=Q.near,le=Q.far;v.texture!==null&&(v.depthNear>0&&(me=v.depthNear),v.depthFar>0&&(le=v.depthFar)),P.near=I.near=T.near=me,P.far=I.far=T.far=le,(O!==P.near||z!==P.far)&&(r.updateRenderState({depthNear:P.near,depthFar:P.far}),O=P.near,z=P.far),P.layers.mask=Q.layers.mask|6,T.layers.mask=P.layers.mask&-5,I.layers.mask=P.layers.mask&-3;let Ae=Q.parent,Ie=P.cameras;ue(P,Ae);for(let Te=0;Te<Ie.length;Te++)ue(Ie[Te],Ae);Ie.length===2?j(P,T,I):P.projectionMatrix.copy(T.projectionMatrix),U(Q,P,Ae)};function U(Q,me,le){le===null?Q.matrix.copy(me.matrixWorld):(Q.matrix.copy(le.matrixWorld),Q.matrix.invert(),Q.matrix.multiply(me.matrixWorld)),Q.matrix.decompose(Q.position,Q.quaternion,Q.scale),Q.updateMatrixWorld(!0),Q.projectionMatrix.copy(me.projectionMatrix),Q.projectionMatrixInverse.copy(me.projectionMatrixInverse),Q.isPerspectiveCamera&&(Q.fov=Mo*2*Math.atan(1/Q.projectionMatrix.elements[5]),Q.zoom=1)}this.getCamera=function(){return P},this.getFoveation=function(){if(!(u===null&&p===null))return l},this.setFoveation=function(Q){l=Q,u!==null&&(u.fixedFoveation=Q),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=Q)},this.hasDepthSensing=function(){return v.texture!==null},this.getDepthSensingMesh=function(){return v.getMesh(P)},this.getCameraTexture=function(Q){return h[Q]};let ne=null;function Ne(Q,me){if(d=me.getViewerPose(c||o),x=me,d!==null){let le=d.views;p!==null&&(e.setRenderTargetFramebuffer(M,p.framebuffer),e.setRenderTarget(M));let Ae=!1;le.length!==P.cameras.length&&(P.cameras.length=0,Ae=!0);for(let ke=0;ke<le.length;ke++){let it=le[ke],st=null;if(p!==null)st=p.getViewport(it);else{let St=f.getViewSubImage(u,it);st=St.viewport,ke===0&&(e.setRenderTargetTextures(M,St.colorTexture,St.depthStencilTexture),e.setRenderTarget(M))}let We=A[ke];We===void 0&&(We=new Sn,We.layers.enable(ke),We.viewport=new It,A[ke]=We),We.matrix.fromArray(it.transform.matrix),We.matrix.decompose(We.position,We.quaternion,We.scale),We.projectionMatrix.fromArray(it.projectionMatrix),We.projectionMatrixInverse.copy(We.projectionMatrix).invert(),We.viewport.set(st.x,st.y,st.width,st.height),ke===0&&(P.matrix.copy(We.matrix),P.matrix.decompose(P.position,P.quaternion,P.scale)),Ae===!0&&P.cameras.push(We)}let Ie=r.enabledFeatures;if(Ie&&Ie.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&S){f=i.getBinding();let ke=f.getDepthInformation(le[0]);ke&&ke.isValid&&ke.texture&&v.init(ke,r.renderState)}if(Ie&&Ie.includes("camera-access")&&S){e.state.unbindTexture(),f=i.getBinding();for(let ke=0;ke<le.length;ke++){let it=le[ke].camera;if(it){let st=h[it];st||(st=new ja,h[it]=st);let We=f.getCameraImage(it);st.sourceTexture=We}}}}for(let le=0;le<C.length;le++){let Ae=b[le],Ie=C[le];Ae!==null&&Ie!==void 0&&Ie.update(Ae,me,c||o)}ne&&ne(Q,me),me.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:me}),x=null}let he=new wy;he.setAnimationLoop(Ne),this.setAnimationLoop=function(Q){ne=Q},this.dispose=function(){}}},cC=new yt,Py=new ze;Py.set(-1,0,0,0,1,0,0,0,1);function uC(t,e){function n(v,h){v.matrixAutoUpdate===!0&&v.updateMatrix(),h.value.copy(v.matrix)}function i(v,h){h.color.getRGB(v.fogColor.value,Nm(t)),h.isFog?(v.fogNear.value=h.near,v.fogFar.value=h.far):h.isFogExp2&&(v.fogDensity.value=h.density)}function r(v,h,g,_,M){h.isNodeMaterial?h.uniformsNeedUpdate=!1:h.isMeshBasicMaterial?s(v,h):h.isMeshLambertMaterial?(s(v,h),h.envMap&&(v.envMapIntensity.value=h.envMapIntensity)):h.isMeshToonMaterial?(s(v,h),f(v,h)):h.isMeshPhongMaterial?(s(v,h),d(v,h),h.envMap&&(v.envMapIntensity.value=h.envMapIntensity)):h.isMeshStandardMaterial?(s(v,h),u(v,h),h.isMeshPhysicalMaterial&&p(v,h,M)):h.isMeshMatcapMaterial?(s(v,h),x(v,h)):h.isMeshDepthMaterial?s(v,h):h.isMeshDistanceMaterial?(s(v,h),S(v,h)):h.isMeshNormalMaterial?s(v,h):h.isLineBasicMaterial?(o(v,h),h.isLineDashedMaterial&&a(v,h)):h.isPointsMaterial?l(v,h,g,_):h.isSpriteMaterial?c(v,h):h.isShadowMaterial?(v.color.value.copy(h.color),v.opacity.value=h.opacity):h.isShaderMaterial&&(h.uniformsNeedUpdate=!1)}function s(v,h){v.opacity.value=h.opacity,h.color&&v.diffuse.value.copy(h.color),h.emissive&&v.emissive.value.copy(h.emissive).multiplyScalar(h.emissiveIntensity),h.map&&(v.map.value=h.map,n(h.map,v.mapTransform)),h.alphaMap&&(v.alphaMap.value=h.alphaMap,n(h.alphaMap,v.alphaMapTransform)),h.bumpMap&&(v.bumpMap.value=h.bumpMap,n(h.bumpMap,v.bumpMapTransform),v.bumpScale.value=h.bumpScale,h.side===Wt&&(v.bumpScale.value*=-1)),h.normalMap&&(v.normalMap.value=h.normalMap,n(h.normalMap,v.normalMapTransform),v.normalScale.value.copy(h.normalScale),h.side===Wt&&v.normalScale.value.negate()),h.displacementMap&&(v.displacementMap.value=h.displacementMap,n(h.displacementMap,v.displacementMapTransform),v.displacementScale.value=h.displacementScale,v.displacementBias.value=h.displacementBias),h.emissiveMap&&(v.emissiveMap.value=h.emissiveMap,n(h.emissiveMap,v.emissiveMapTransform)),h.specularMap&&(v.specularMap.value=h.specularMap,n(h.specularMap,v.specularMapTransform)),h.alphaTest>0&&(v.alphaTest.value=h.alphaTest);let g=e.get(h),_=g.envMap,M=g.envMapRotation;_&&(v.envMap.value=_,v.envMapRotation.value.setFromMatrix4(cC.makeRotationFromEuler(M)).transpose(),_.isCubeTexture&&_.isRenderTargetTexture===!1&&v.envMapRotation.value.premultiply(Py),v.reflectivity.value=h.reflectivity,v.ior.value=h.ior,v.refractionRatio.value=h.refractionRatio),h.lightMap&&(v.lightMap.value=h.lightMap,v.lightMapIntensity.value=h.lightMapIntensity,n(h.lightMap,v.lightMapTransform)),h.aoMap&&(v.aoMap.value=h.aoMap,v.aoMapIntensity.value=h.aoMapIntensity,n(h.aoMap,v.aoMapTransform))}function o(v,h){v.diffuse.value.copy(h.color),v.opacity.value=h.opacity,h.map&&(v.map.value=h.map,n(h.map,v.mapTransform))}function a(v,h){v.dashSize.value=h.dashSize,v.totalSize.value=h.dashSize+h.gapSize,v.scale.value=h.scale}function l(v,h,g,_){v.diffuse.value.copy(h.color),v.opacity.value=h.opacity,v.size.value=h.size*g,v.scale.value=_*.5,h.map&&(v.map.value=h.map,n(h.map,v.uvTransform)),h.alphaMap&&(v.alphaMap.value=h.alphaMap,n(h.alphaMap,v.alphaMapTransform)),h.alphaTest>0&&(v.alphaTest.value=h.alphaTest)}function c(v,h){v.diffuse.value.copy(h.color),v.opacity.value=h.opacity,v.rotation.value=h.rotation,h.map&&(v.map.value=h.map,n(h.map,v.mapTransform)),h.alphaMap&&(v.alphaMap.value=h.alphaMap,n(h.alphaMap,v.alphaMapTransform)),h.alphaTest>0&&(v.alphaTest.value=h.alphaTest)}function d(v,h){v.specular.value.copy(h.specular),v.shininess.value=Math.max(h.shininess,1e-4)}function f(v,h){h.gradientMap&&(v.gradientMap.value=h.gradientMap)}function u(v,h){v.metalness.value=h.metalness,h.metalnessMap&&(v.metalnessMap.value=h.metalnessMap,n(h.metalnessMap,v.metalnessMapTransform)),v.roughness.value=h.roughness,h.roughnessMap&&(v.roughnessMap.value=h.roughnessMap,n(h.roughnessMap,v.roughnessMapTransform)),h.envMap&&(v.envMapIntensity.value=h.envMapIntensity)}function p(v,h,g){v.ior.value=h.ior,h.sheen>0&&(v.sheenColor.value.copy(h.sheenColor).multiplyScalar(h.sheen),v.sheenRoughness.value=h.sheenRoughness,h.sheenColorMap&&(v.sheenColorMap.value=h.sheenColorMap,n(h.sheenColorMap,v.sheenColorMapTransform)),h.sheenRoughnessMap&&(v.sheenRoughnessMap.value=h.sheenRoughnessMap,n(h.sheenRoughnessMap,v.sheenRoughnessMapTransform))),h.clearcoat>0&&(v.clearcoat.value=h.clearcoat,v.clearcoatRoughness.value=h.clearcoatRoughness,h.clearcoatMap&&(v.clearcoatMap.value=h.clearcoatMap,n(h.clearcoatMap,v.clearcoatMapTransform)),h.clearcoatRoughnessMap&&(v.clearcoatRoughnessMap.value=h.clearcoatRoughnessMap,n(h.clearcoatRoughnessMap,v.clearcoatRoughnessMapTransform)),h.clearcoatNormalMap&&(v.clearcoatNormalMap.value=h.clearcoatNormalMap,n(h.clearcoatNormalMap,v.clearcoatNormalMapTransform),v.clearcoatNormalScale.value.copy(h.clearcoatNormalScale),h.side===Wt&&v.clearcoatNormalScale.value.negate())),h.dispersion>0&&(v.dispersion.value=h.dispersion),h.iridescence>0&&(v.iridescence.value=h.iridescence,v.iridescenceIOR.value=h.iridescenceIOR,v.iridescenceThicknessMinimum.value=h.iridescenceThicknessRange[0],v.iridescenceThicknessMaximum.value=h.iridescenceThicknessRange[1],h.iridescenceMap&&(v.iridescenceMap.value=h.iridescenceMap,n(h.iridescenceMap,v.iridescenceMapTransform)),h.iridescenceThicknessMap&&(v.iridescenceThicknessMap.value=h.iridescenceThicknessMap,n(h.iridescenceThicknessMap,v.iridescenceThicknessMapTransform))),h.transmission>0&&(v.transmission.value=h.transmission,v.transmissionSamplerMap.value=g.texture,v.transmissionSamplerSize.value.set(g.width,g.height),h.transmissionMap&&(v.transmissionMap.value=h.transmissionMap,n(h.transmissionMap,v.transmissionMapTransform)),v.thickness.value=h.thickness,h.thicknessMap&&(v.thicknessMap.value=h.thicknessMap,n(h.thicknessMap,v.thicknessMapTransform)),v.attenuationDistance.value=h.attenuationDistance,v.attenuationColor.value.copy(h.attenuationColor)),h.anisotropy>0&&(v.anisotropyVector.value.set(h.anisotropy*Math.cos(h.anisotropyRotation),h.anisotropy*Math.sin(h.anisotropyRotation)),h.anisotropyMap&&(v.anisotropyMap.value=h.anisotropyMap,n(h.anisotropyMap,v.anisotropyMapTransform))),v.specularIntensity.value=h.specularIntensity,v.specularColor.value.copy(h.specularColor),h.specularColorMap&&(v.specularColorMap.value=h.specularColorMap,n(h.specularColorMap,v.specularColorMapTransform)),h.specularIntensityMap&&(v.specularIntensityMap.value=h.specularIntensityMap,n(h.specularIntensityMap,v.specularIntensityMapTransform))}function x(v,h){h.matcap&&(v.matcap.value=h.matcap)}function S(v,h){let g=e.get(h).light;v.referencePosition.value.setFromMatrixPosition(g.matrixWorld),v.nearDistance.value=g.shadow.camera.near,v.farDistance.value=g.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function hC(t,e,n,i){let r={},s={},o=[],a=t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);function l(g,_){let M=_.program;i.uniformBlockBinding(g,M)}function c(g,_){let M=r[g.id];M===void 0&&(x(g),M=d(g),r[g.id]=M,g.addEventListener("dispose",v));let C=_.program;i.updateUBOMapping(g,C);let b=e.render.frame;s[g.id]!==b&&(u(g),s[g.id]=b)}function d(g){let _=f();g.__bindingPointIndex=_;let M=t.createBuffer(),C=g.__size,b=g.usage;return t.bindBuffer(t.UNIFORM_BUFFER,M),t.bufferData(t.UNIFORM_BUFFER,C,b),t.bindBuffer(t.UNIFORM_BUFFER,null),t.bindBufferBase(t.UNIFORM_BUFFER,_,M),M}function f(){for(let g=0;g<a;g++)if(o.indexOf(g)===-1)return o.push(g),g;return Be("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function u(g){let _=r[g.id],M=g.uniforms,C=g.__cache;t.bindBuffer(t.UNIFORM_BUFFER,_);for(let b=0,R=M.length;b<R;b++){let m=Array.isArray(M[b])?M[b]:[M[b]];for(let T=0,I=m.length;T<I;T++){let A=m[T];if(p(A,b,T,C)===!0){let P=A.__offset,O=Array.isArray(A.value)?A.value:[A.value],z=0;for(let L=0;L<O.length;L++){let B=O[L],G=S(B);typeof B=="number"||typeof B=="boolean"?(A.__data[0]=B,t.bufferSubData(t.UNIFORM_BUFFER,P+z,A.__data)):B.isMatrix3?(A.__data[0]=B.elements[0],A.__data[1]=B.elements[1],A.__data[2]=B.elements[2],A.__data[3]=0,A.__data[4]=B.elements[3],A.__data[5]=B.elements[4],A.__data[6]=B.elements[5],A.__data[7]=0,A.__data[8]=B.elements[6],A.__data[9]=B.elements[7],A.__data[10]=B.elements[8],A.__data[11]=0):ArrayBuffer.isView(B)?A.__data.set(new B.constructor(B.buffer,B.byteOffset,A.__data.length)):(B.toArray(A.__data,z),z+=G.storage/Float32Array.BYTES_PER_ELEMENT)}t.bufferSubData(t.UNIFORM_BUFFER,P,A.__data)}}}t.bindBuffer(t.UNIFORM_BUFFER,null)}function p(g,_,M,C){let b=g.value,R=_+"_"+M;if(C[R]===void 0)return typeof b=="number"||typeof b=="boolean"?C[R]=b:ArrayBuffer.isView(b)?C[R]=b.slice():C[R]=b.clone(),!0;{let m=C[R];if(typeof b=="number"||typeof b=="boolean"){if(m!==b)return C[R]=b,!0}else{if(ArrayBuffer.isView(b))return!0;if(m.equals(b)===!1)return m.copy(b),!0}}return!1}function x(g){let _=g.uniforms,M=0,C=16;for(let R=0,m=_.length;R<m;R++){let T=Array.isArray(_[R])?_[R]:[_[R]];for(let I=0,A=T.length;I<A;I++){let P=T[I],O=Array.isArray(P.value)?P.value:[P.value];for(let z=0,L=O.length;z<L;z++){let B=O[z],G=S(B),q=M%C,J=q%G.boundary,j=q+J;M+=J,j!==0&&C-j<G.storage&&(M+=C-j),P.__data=new Float32Array(G.storage/Float32Array.BYTES_PER_ELEMENT),P.__offset=M,M+=G.storage}}}let b=M%C;return b>0&&(M+=C-b),g.__size=M,g.__cache={},this}function S(g){let _={boundary:0,storage:0};return typeof g=="number"||typeof g=="boolean"?(_.boundary=4,_.storage=4):g.isVector2?(_.boundary=8,_.storage=8):g.isVector3||g.isColor?(_.boundary=16,_.storage=12):g.isVector4?(_.boundary=16,_.storage=16):g.isMatrix3?(_.boundary=48,_.storage=48):g.isMatrix4?(_.boundary=64,_.storage=64):g.isTexture?Fe("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(g)?(_.boundary=16,_.storage=g.byteLength):Fe("WebGLRenderer: Unsupported uniform value type.",g),_}function v(g){let _=g.target;_.removeEventListener("dispose",v);let M=o.indexOf(_.__bindingPointIndex);o.splice(M,1),t.deleteBuffer(r[_.id]),delete r[_.id],delete s[_.id]}function h(){for(let g in r)t.deleteBuffer(r[g]);o=[],r={},s={}}return{bind:l,update:c,dispose:h}}var dC=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Oi=null;function fC(){return Oi===null&&(Oi=new Za(dC,16,16,Zr,Fi),Oi.name="DFG_LUT",Oi.minFilter=rn,Oi.magFilter=rn,Oi.wrapS=Ci,Oi.wrapT=Ci,Oi.generateMipmaps=!1,Oi.needsUpdate=!0),Oi}var td=class{constructor(e={}){let{canvas:n=$_(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:d="default",failIfMajorPerformanceCaveat:f=!1,reversedDepthBuffer:u=!1,outputBufferType:p=Pn}=e;this.isWebGLRenderer=!0;let x;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");x=i.getContextAttributes().alpha}else x=o;let S=p,v=new Set([_h,xh,vh]),h=new Set([Pn,vi,Ro,Po,ph,mh]),g=new Uint32Array(4),_=new Int32Array(4),M=new D,C=null,b=null,R=[],m=[],T=null;this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=gi,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let I=this,A=!1,P=null;this._outputColorSpace=yn;let O=0,z=0,L=null,B=-1,G=null,q=new It,J=new It,j=null,ue=new Ke(0),U=0,ne=n.width,Ne=n.height,he=1,Q=null,me=null,le=new It(0,0,ne,Ne),Ae=new It(0,0,ne,Ne),Ie=!1,Te=new bo,ft=!1,ke=!1,it=new yt,st=new D,We=new It,St={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},pt=!1;function Bt(){return L===null?he:1}let F=i;function Lt(w,k){return n.getContext(w,k)}try{let w={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:d,failIfMajorPerformanceCaveat:f};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${ah}`),n.addEventListener("webglcontextlost",te,!1),n.addEventListener("webglcontextrestored",Ce,!1),n.addEventListener("webglcontextcreationerror",Se,!1),F===null){let k="webgl2";if(F=Lt(k,w),F===null)throw Lt(k)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(w){throw Be("WebGLRenderer: "+w.message),w}let Xe,ot,pe,at,E,y,V,K,ee,oe,de,Y,Z,ae,ge,ce,ie,De,Oe,Ve,N,se,$;function ye(){Xe=new yT(F),Xe.init(),N=new oC(F,Xe),ot=new dT(F,Xe,e,N),pe=new rC(F,Xe),ot.reversedDepthBuffer&&u&&pe.buffers.depth.setReversed(!0),at=new ET(F),E=new WA,y=new sC(F,Xe,pe,E,ot,N,at),V=new _T(I),K=new AE(F),se=new uT(F,K),ee=new ST(F,K,at,se),oe=new bT(F,ee,K,se,at),De=new wT(F,ot,y),ge=new fT(E),de=new HA(I,V,Xe,ot,se,ge),Y=new uC(I,E),Z=new qA,ae=new jA(Xe),ie=new cT(I,V,pe,oe,x,l),ce=new iC(I,oe,ot),$=new hC(F,at,ot,pe),Oe=new hT(F,Xe,at),Ve=new MT(F,Xe,at),at.programs=de.programs,I.capabilities=ot,I.extensions=Xe,I.properties=E,I.renderLists=Z,I.shadowMap=ce,I.state=pe,I.info=at}ye(),S!==Pn&&(T=new AT(S,n.width,n.height,r,s));let fe=new ng(I,F);this.xr=fe,this.getContext=function(){return F},this.getContextAttributes=function(){return F.getContextAttributes()},this.forceContextLoss=function(){let w=Xe.get("WEBGL_lose_context");w&&w.loseContext()},this.forceContextRestore=function(){let w=Xe.get("WEBGL_lose_context");w&&w.restoreContext()},this.getPixelRatio=function(){return he},this.setPixelRatio=function(w){w!==void 0&&(he=w,this.setSize(ne,Ne,!1))},this.getSize=function(w){return w.set(ne,Ne)},this.setSize=function(w,k,X=!0){if(fe.isPresenting){Fe("WebGLRenderer: Can't change size while VR device is presenting.");return}ne=w,Ne=k,n.width=Math.floor(w*he),n.height=Math.floor(k*he),X===!0&&(n.style.width=w+"px",n.style.height=k+"px"),T!==null&&T.setSize(n.width,n.height),this.setViewport(0,0,w,k)},this.getDrawingBufferSize=function(w){return w.set(ne*he,Ne*he).floor()},this.setDrawingBufferSize=function(w,k,X){ne=w,Ne=k,he=X,n.width=Math.floor(w*X),n.height=Math.floor(k*X),this.setViewport(0,0,w,k)},this.setEffects=function(w){if(S===Pn){Be("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(w){for(let k=0;k<w.length;k++)if(w[k].isOutputPass===!0){Fe("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}T.setEffects(w||[])},this.getCurrentViewport=function(w){return w.copy(q)},this.getViewport=function(w){return w.copy(le)},this.setViewport=function(w,k,X,H){w.isVector4?le.set(w.x,w.y,w.z,w.w):le.set(w,k,X,H),pe.viewport(q.copy(le).multiplyScalar(he).round())},this.getScissor=function(w){return w.copy(Ae)},this.setScissor=function(w,k,X,H){w.isVector4?Ae.set(w.x,w.y,w.z,w.w):Ae.set(w,k,X,H),pe.scissor(J.copy(Ae).multiplyScalar(he).round())},this.getScissorTest=function(){return Ie},this.setScissorTest=function(w){pe.setScissorTest(Ie=w)},this.setOpaqueSort=function(w){Q=w},this.setTransparentSort=function(w){me=w},this.getClearColor=function(w){return w.copy(ie.getClearColor())},this.setClearColor=function(){ie.setClearColor(...arguments)},this.getClearAlpha=function(){return ie.getClearAlpha()},this.setClearAlpha=function(){ie.setClearAlpha(...arguments)},this.clear=function(w=!0,k=!0,X=!0){let H=0;if(w){let W=!1;if(L!==null){let _e=L.texture.format;W=v.has(_e)}if(W){let _e=L.texture.type,we=h.has(_e),xe=ie.getClearColor(),Re=ie.getClearAlpha(),Pe=xe.r,Ge=xe.g,Ye=xe.b;we?(g[0]=Pe,g[1]=Ge,g[2]=Ye,g[3]=Re,F.clearBufferuiv(F.COLOR,0,g)):(_[0]=Pe,_[1]=Ge,_[2]=Ye,_[3]=Re,F.clearBufferiv(F.COLOR,0,_))}else H|=F.COLOR_BUFFER_BIT}k&&(H|=F.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),X&&(H|=F.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),H!==0&&F.clear(H)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(w){w.setRenderer(this),P=w},this.dispose=function(){n.removeEventListener("webglcontextlost",te,!1),n.removeEventListener("webglcontextrestored",Ce,!1),n.removeEventListener("webglcontextcreationerror",Se,!1),ie.dispose(),Z.dispose(),ae.dispose(),E.dispose(),V.dispose(),oe.dispose(),se.dispose(),$.dispose(),de.dispose(),fe.dispose(),fe.removeEventListener("sessionstart",Mn),fe.removeEventListener("sessionend",Hn),ii.stop()};function te(w){w.preventDefault(),Rm("WebGLRenderer: Context Lost."),A=!0}function Ce(){Rm("WebGLRenderer: Context Restored."),A=!1;let w=at.autoReset,k=ce.enabled,X=ce.autoUpdate,H=ce.needsUpdate,W=ce.type;ye(),at.autoReset=w,ce.enabled=k,ce.autoUpdate=X,ce.needsUpdate=H,ce.type=W}function Se(w){Be("WebGLRenderer: A WebGL context could not be created. Reason: ",w.statusMessage)}function $e(w){let k=w.target;k.removeEventListener("dispose",$e),qe(k)}function qe(w){lt(w),E.remove(w)}function lt(w){let k=E.get(w).programs;k!==void 0&&(k.forEach(function(X){de.releaseProgram(X)}),w.isShaderMaterial&&de.releaseShaderCache(w))}this.renderBufferDirect=function(w,k,X,H,W,_e){k===null&&(k=St);let we=W.isMesh&&W.matrixWorld.determinant()<0,xe=$y(w,k,X,H,W);pe.setMaterial(H,we);let Re=X.index,Pe=1;if(H.wireframe===!0){if(Re=ee.getWireframeAttribute(X),Re===void 0)return;Pe=2}let Ge=X.drawRange,Ye=X.attributes.position,Le=Ge.start*Pe,dt=(Ge.start+Ge.count)*Pe;_e!==null&&(Le=Math.max(Le,_e.start*Pe),dt=Math.min(dt,(_e.start+_e.count)*Pe)),Re!==null?(Le=Math.max(Le,0),dt=Math.min(dt,Re.count)):Ye!=null&&(Le=Math.max(Le,0),dt=Math.min(dt,Ye.count));let Ut=dt-Le;if(Ut<0||Ut===1/0)return;se.setup(W,H,xe,X,Re);let Nt,mt=Oe;if(Re!==null&&(Nt=K.get(Re),mt=Ve,mt.setIndex(Nt)),W.isMesh)H.wireframe===!0?(pe.setLineWidth(H.wireframeLinewidth*Bt()),mt.setMode(F.LINES)):mt.setMode(F.TRIANGLES);else if(W.isLine){let sn=H.linewidth;sn===void 0&&(sn=1),pe.setLineWidth(sn*Bt()),W.isLineSegments?mt.setMode(F.LINES):W.isLineLoop?mt.setMode(F.LINE_LOOP):mt.setMode(F.LINE_STRIP)}else W.isPoints?mt.setMode(F.POINTS):W.isSprite&&mt.setMode(F.TRIANGLES);if(W.isBatchedMesh)if(Xe.get("WEBGL_multi_draw"))mt.renderMultiDraw(W._multiDrawStarts,W._multiDrawCounts,W._multiDrawCount);else{let sn=W._multiDrawStarts,Me=W._multiDrawCounts,In=W._multiDrawCount,et=Re?K.get(Re).bytesPerElement:1,Wn=E.get(H).currentProgram.getUniforms();for(let _i=0;_i<In;_i++)Wn.setValue(F,"_gl_DrawID",_i),mt.render(sn[_i]/et,Me[_i])}else if(W.isInstancedMesh)mt.renderInstances(Le,Ut,W.count);else if(X.isInstancedBufferGeometry){let sn=X._maxInstanceCount!==void 0?X._maxInstanceCount:1/0,Me=Math.min(X.instanceCount,sn);mt.renderInstances(Le,Ut,Me)}else mt.render(Le,Ut)};function Vt(w,k,X){w.transparent===!0&&w.side===Di&&w.forceSinglePass===!1?(w.side=Wt,w.needsUpdate=!0,Tl(w,k,X),w.side=nr,w.needsUpdate=!0,Tl(w,k,X),w.side=Di):Tl(w,k,X)}this.compile=function(w,k,X=null){X===null&&(X=w),b=ae.get(X),b.init(k),m.push(b),X.traverseVisible(function(W){W.isLight&&W.layers.test(k.layers)&&(b.pushLight(W),W.castShadow&&b.pushShadow(W))}),w!==X&&w.traverseVisible(function(W){W.isLight&&W.layers.test(k.layers)&&(b.pushLight(W),W.castShadow&&b.pushShadow(W))}),b.setupLights();let H=new Set;return w.traverse(function(W){if(!(W.isMesh||W.isPoints||W.isLine||W.isSprite))return;let _e=W.material;if(_e)if(Array.isArray(_e))for(let we=0;we<_e.length;we++){let xe=_e[we];Vt(xe,X,W),H.add(xe)}else Vt(_e,X,W),H.add(_e)}),b=m.pop(),H},this.compileAsync=function(w,k,X=null){let H=this.compile(w,k,X);return new Promise(W=>{function _e(){if(H.forEach(function(we){E.get(we).currentProgram.isReady()&&H.delete(we)}),H.size===0){W(w);return}setTimeout(_e,10)}Xe.get("KHR_parallel_shader_compile")!==null?_e():setTimeout(_e,10)})};let ct=null;function At(w){ct&&ct(w)}function Mn(){ii.stop()}function Hn(){ii.start()}let ii=new wy;ii.setAnimationLoop(At),typeof self<"u"&&ii.setContext(self),this.setAnimationLoop=function(w){ct=w,fe.setAnimationLoop(w),w===null?ii.stop():ii.start()},fe.addEventListener("sessionstart",Mn),fe.addEventListener("sessionend",Hn),this.render=function(w,k){if(k!==void 0&&k.isCamera!==!0){Be("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(A===!0)return;P!==null&&P.renderStart(w,k);let X=fe.enabled===!0&&fe.isPresenting===!0,H=T!==null&&(L===null||X)&&T.begin(I,L);if(w.matrixWorldAutoUpdate===!0&&w.updateMatrixWorld(),k.parent===null&&k.matrixWorldAutoUpdate===!0&&k.updateMatrixWorld(),fe.enabled===!0&&fe.isPresenting===!0&&(T===null||T.isCompositing()===!1)&&(fe.cameraAutoUpdate===!0&&fe.updateCamera(k),k=fe.getCamera()),w.isScene===!0&&w.onBeforeRender(I,w,k,L),b=ae.get(w,m.length),b.init(k),b.state.textureUnits=y.getTextureUnits(),m.push(b),it.multiplyMatrices(k.projectionMatrix,k.matrixWorldInverse),Te.setFromProjectionMatrix(it,mi,k.reversedDepth),ke=this.localClippingEnabled,ft=ge.init(this.clippingPlanes,ke),C=Z.get(w,R.length),C.init(),R.push(C),fe.enabled===!0&&fe.isPresenting===!0){let we=I.xr.getDepthSensingMesh();we!==null&&cd(we,k,-1/0,I.sortObjects)}cd(w,k,0,I.sortObjects),C.finish(),I.sortObjects===!0&&C.sort(Q,me),pt=fe.enabled===!1||fe.isPresenting===!1||fe.hasDepthSensing()===!1,pt&&ie.addToRenderList(C,w),this.info.render.frame++,ft===!0&&ge.beginShadows();let W=b.state.shadowsArray;if(ce.render(W,w,k),ft===!0&&ge.endShadows(),this.info.autoReset===!0&&this.info.reset(),(H&&T.hasRenderPass())===!1){let we=C.opaque,xe=C.transmissive;if(b.setupLights(),k.isArrayCamera){let Re=k.cameras;if(xe.length>0)for(let Pe=0,Ge=Re.length;Pe<Ge;Pe++){let Ye=Re[Pe];og(we,xe,w,Ye)}pt&&ie.render(w);for(let Pe=0,Ge=Re.length;Pe<Ge;Pe++){let Ye=Re[Pe];sg(C,w,Ye,Ye.viewport)}}else xe.length>0&&og(we,xe,w,k),pt&&ie.render(w),sg(C,w,k)}L!==null&&z===0&&(y.updateMultisampleRenderTarget(L),y.updateRenderTargetMipmap(L)),H&&T.end(I),w.isScene===!0&&w.onAfterRender(I,w,k),se.resetDefaultState(),B=-1,G=null,m.pop(),m.length>0?(b=m[m.length-1],y.setTextureUnits(b.state.textureUnits),ft===!0&&ge.setGlobalState(I.clippingPlanes,b.state.camera)):b=null,R.pop(),R.length>0?C=R[R.length-1]:C=null,P!==null&&P.renderEnd()};function cd(w,k,X,H){if(w.visible===!1)return;if(w.layers.test(k.layers)){if(w.isGroup)X=w.renderOrder;else if(w.isLOD)w.autoUpdate===!0&&w.update(k);else if(w.isLightProbeGrid)b.pushLightProbeGrid(w);else if(w.isLight)b.pushLight(w),w.castShadow&&b.pushShadow(w);else if(w.isSprite){if(!w.frustumCulled||Te.intersectsSprite(w)){H&&We.setFromMatrixPosition(w.matrixWorld).applyMatrix4(it);let we=oe.update(w),xe=w.material;xe.visible&&C.push(w,we,xe,X,We.z,null)}}else if((w.isMesh||w.isLine||w.isPoints)&&(!w.frustumCulled||Te.intersectsObject(w))){let we=oe.update(w),xe=w.material;if(H&&(w.boundingSphere!==void 0?(w.boundingSphere===null&&w.computeBoundingSphere(),We.copy(w.boundingSphere.center)):(we.boundingSphere===null&&we.computeBoundingSphere(),We.copy(we.boundingSphere.center)),We.applyMatrix4(w.matrixWorld).applyMatrix4(it)),Array.isArray(xe)){let Re=we.groups;for(let Pe=0,Ge=Re.length;Pe<Ge;Pe++){let Ye=Re[Pe],Le=xe[Ye.materialIndex];Le&&Le.visible&&C.push(w,we,Le,X,We.z,Ye)}}else xe.visible&&C.push(w,we,xe,X,We.z,null)}}let _e=w.children;for(let we=0,xe=_e.length;we<xe;we++)cd(_e[we],k,X,H)}function sg(w,k,X,H){let{opaque:W,transmissive:_e,transparent:we}=w;b.setupLightsView(X),ft===!0&&ge.setGlobalState(I.clippingPlanes,X),H&&pe.viewport(q.copy(H)),W.length>0&&bl(W,k,X),_e.length>0&&bl(_e,k,X),we.length>0&&bl(we,k,X),pe.buffers.depth.setTest(!0),pe.buffers.depth.setMask(!0),pe.buffers.color.setMask(!0),pe.setPolygonOffset(!1)}function og(w,k,X,H){if((X.isScene===!0?X.overrideMaterial:null)!==null)return;if(b.state.transmissionRenderTarget[H.id]===void 0){let Le=Xe.has("EXT_color_buffer_half_float")||Xe.has("EXT_color_buffer_float");b.state.transmissionRenderTarget[H.id]=new zn(1,1,{generateMipmaps:!0,type:Le?Fi:Pn,minFilter:qr,samples:Math.max(4,ot.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:je.workingColorSpace})}let _e=b.state.transmissionRenderTarget[H.id],we=H.viewport||q;_e.setSize(we.z*I.transmissionResolutionScale,we.w*I.transmissionResolutionScale);let xe=I.getRenderTarget(),Re=I.getActiveCubeFace(),Pe=I.getActiveMipmapLevel();I.setRenderTarget(_e),I.getClearColor(ue),U=I.getClearAlpha(),U<1&&I.setClearColor(16777215,.5),I.clear(),pt&&ie.render(X);let Ge=I.toneMapping;I.toneMapping=gi;let Ye=H.viewport;if(H.viewport!==void 0&&(H.viewport=void 0),b.setupLightsView(H),ft===!0&&ge.setGlobalState(I.clippingPlanes,H),bl(w,X,H),y.updateMultisampleRenderTarget(_e),y.updateRenderTargetMipmap(_e),Xe.has("WEBGL_multisampled_render_to_texture")===!1){let Le=!1;for(let dt=0,Ut=k.length;dt<Ut;dt++){let Nt=k[dt],{object:mt,geometry:sn,material:Me,group:In}=Nt;if(Me.side===Di&&mt.layers.test(H.layers)){let et=Me.side;Me.side=Wt,Me.needsUpdate=!0,ag(mt,X,H,sn,Me,In),Me.side=et,Me.needsUpdate=!0,Le=!0}}Le===!0&&(y.updateMultisampleRenderTarget(_e),y.updateRenderTargetMipmap(_e))}I.setRenderTarget(xe,Re,Pe),I.setClearColor(ue,U),Ye!==void 0&&(H.viewport=Ye),I.toneMapping=Ge}function bl(w,k,X){let H=k.isScene===!0?k.overrideMaterial:null;for(let W=0,_e=w.length;W<_e;W++){let we=w[W],{object:xe,geometry:Re,group:Pe}=we,Ge=we.material;Ge.allowOverride===!0&&H!==null&&(Ge=H),xe.layers.test(X.layers)&&ag(xe,k,X,Re,Ge,Pe)}}function ag(w,k,X,H,W,_e){w.onBeforeRender(I,k,X,H,W,_e),w.modelViewMatrix.multiplyMatrices(X.matrixWorldInverse,w.matrixWorld),w.normalMatrix.getNormalMatrix(w.modelViewMatrix),W.onBeforeRender(I,k,X,H,w,_e),W.transparent===!0&&W.side===Di&&W.forceSinglePass===!1?(W.side=Wt,W.needsUpdate=!0,I.renderBufferDirect(X,k,H,W,w,_e),W.side=nr,W.needsUpdate=!0,I.renderBufferDirect(X,k,H,W,w,_e),W.side=Di):I.renderBufferDirect(X,k,H,W,w,_e),w.onAfterRender(I,k,X,H,W,_e)}function Tl(w,k,X){k.isScene!==!0&&(k=St);let H=E.get(w),W=b.state.lights,_e=b.state.shadowsArray,we=W.state.version,xe=de.getParameters(w,W.state,_e,k,X,b.state.lightProbeGridArray),Re=de.getProgramCacheKey(xe),Pe=H.programs;H.environment=w.isMeshStandardMaterial||w.isMeshLambertMaterial||w.isMeshPhongMaterial?k.environment:null,H.fog=k.fog;let Ge=w.isMeshStandardMaterial||w.isMeshLambertMaterial&&!w.envMap||w.isMeshPhongMaterial&&!w.envMap;H.envMap=V.get(w.envMap||H.environment,Ge),H.envMapRotation=H.environment!==null&&w.envMap===null?k.environmentRotation:w.envMapRotation,Pe===void 0&&(w.addEventListener("dispose",$e),Pe=new Map,H.programs=Pe);let Ye=Pe.get(Re);if(Ye!==void 0){if(H.currentProgram===Ye&&H.lightsStateVersion===we)return cg(w,xe),Ye}else xe.uniforms=de.getUniforms(w),P!==null&&w.isNodeMaterial&&P.build(w,X,xe),w.onBeforeCompile(xe,I),Ye=de.acquireProgram(xe,Re),Pe.set(Re,Ye),H.uniforms=xe.uniforms;let Le=H.uniforms;return(!w.isShaderMaterial&&!w.isRawShaderMaterial||w.clipping===!0)&&(Le.clippingPlanes=ge.uniform),cg(w,xe),H.needsLights=Ky(w),H.lightsStateVersion=we,H.needsLights&&(Le.ambientLightColor.value=W.state.ambient,Le.lightProbe.value=W.state.probe,Le.directionalLights.value=W.state.directional,Le.directionalLightShadows.value=W.state.directionalShadow,Le.spotLights.value=W.state.spot,Le.spotLightShadows.value=W.state.spotShadow,Le.rectAreaLights.value=W.state.rectArea,Le.ltc_1.value=W.state.rectAreaLTC1,Le.ltc_2.value=W.state.rectAreaLTC2,Le.pointLights.value=W.state.point,Le.pointLightShadows.value=W.state.pointShadow,Le.hemisphereLights.value=W.state.hemi,Le.directionalShadowMatrix.value=W.state.directionalShadowMatrix,Le.spotLightMatrix.value=W.state.spotLightMatrix,Le.spotLightMap.value=W.state.spotLightMap,Le.pointShadowMatrix.value=W.state.pointShadowMatrix),H.lightProbeGrid=b.state.lightProbeGridArray.length>0,H.currentProgram=Ye,H.uniformsList=null,Ye}function lg(w){if(w.uniformsList===null){let k=w.currentProgram.getUniforms();w.uniformsList=No.seqWithValue(k.seq,w.uniforms)}return w.uniformsList}function cg(w,k){let X=E.get(w);X.outputColorSpace=k.outputColorSpace,X.batching=k.batching,X.batchingColor=k.batchingColor,X.instancing=k.instancing,X.instancingColor=k.instancingColor,X.instancingMorph=k.instancingMorph,X.skinning=k.skinning,X.morphTargets=k.morphTargets,X.morphNormals=k.morphNormals,X.morphColors=k.morphColors,X.morphTargetsCount=k.morphTargetsCount,X.numClippingPlanes=k.numClippingPlanes,X.numIntersection=k.numClipIntersection,X.vertexAlphas=k.vertexAlphas,X.vertexTangents=k.vertexTangents,X.toneMapping=k.toneMapping}function Zy(w,k){if(w.length===0)return null;if(w.length===1)return w[0].texture!==null?w[0]:null;M.setFromMatrixPosition(k.matrixWorld);for(let X=0,H=w.length;X<H;X++){let W=w[X];if(W.texture!==null&&W.boundingBox.containsPoint(M))return W}return null}function $y(w,k,X,H,W){k.isScene!==!0&&(k=St),y.resetTextureUnits();let _e=k.fog,we=H.isMeshStandardMaterial||H.isMeshLambertMaterial||H.isMeshPhongMaterial?k.environment:null,xe=L===null?I.outputColorSpace:L.isXRRenderTarget===!0?L.texture.colorSpace:je.workingColorSpace,Re=H.isMeshStandardMaterial||H.isMeshLambertMaterial&&!H.envMap||H.isMeshPhongMaterial&&!H.envMap,Pe=V.get(H.envMap||we,Re),Ge=H.vertexColors===!0&&!!X.attributes.color&&X.attributes.color.itemSize===4,Ye=!!X.attributes.tangent&&(!!H.normalMap||H.anisotropy>0),Le=!!X.morphAttributes.position,dt=!!X.morphAttributes.normal,Ut=!!X.morphAttributes.color,Nt=gi;H.toneMapped&&(L===null||L.isXRRenderTarget===!0)&&(Nt=I.toneMapping);let mt=X.morphAttributes.position||X.morphAttributes.normal||X.morphAttributes.color,sn=mt!==void 0?mt.length:0,Me=E.get(H),In=b.state.lights;if(ft===!0&&(ke===!0||w!==G)){let vt=w===G&&H.id===B;ge.setState(H,w,vt)}let et=!1;H.version===Me.__version?(Me.needsLights&&Me.lightsStateVersion!==In.state.version||Me.outputColorSpace!==xe||W.isBatchedMesh&&Me.batching===!1||!W.isBatchedMesh&&Me.batching===!0||W.isBatchedMesh&&Me.batchingColor===!0&&W.colorTexture===null||W.isBatchedMesh&&Me.batchingColor===!1&&W.colorTexture!==null||W.isInstancedMesh&&Me.instancing===!1||!W.isInstancedMesh&&Me.instancing===!0||W.isSkinnedMesh&&Me.skinning===!1||!W.isSkinnedMesh&&Me.skinning===!0||W.isInstancedMesh&&Me.instancingColor===!0&&W.instanceColor===null||W.isInstancedMesh&&Me.instancingColor===!1&&W.instanceColor!==null||W.isInstancedMesh&&Me.instancingMorph===!0&&W.morphTexture===null||W.isInstancedMesh&&Me.instancingMorph===!1&&W.morphTexture!==null||Me.envMap!==Pe||H.fog===!0&&Me.fog!==_e||Me.numClippingPlanes!==void 0&&(Me.numClippingPlanes!==ge.numPlanes||Me.numIntersection!==ge.numIntersection)||Me.vertexAlphas!==Ge||Me.vertexTangents!==Ye||Me.morphTargets!==Le||Me.morphNormals!==dt||Me.morphColors!==Ut||Me.toneMapping!==Nt||Me.morphTargetsCount!==sn||!!Me.lightProbeGrid!=b.state.lightProbeGridArray.length>0)&&(et=!0):(et=!0,Me.__version=H.version);let Wn=Me.currentProgram;et===!0&&(Wn=Tl(H,k,W),P&&H.isNodeMaterial&&P.onUpdateProgram(H,Wn,Me));let _i=!1,ar=!1,Ts=!1,gt=Wn.getUniforms(),Ft=Me.uniforms;if(pe.useProgram(Wn.program)&&(_i=!0,ar=!0,Ts=!0),H.id!==B&&(B=H.id,ar=!0),Me.needsLights){let vt=Zy(b.state.lightProbeGridArray,W);Me.lightProbeGrid!==vt&&(Me.lightProbeGrid=vt,ar=!0)}if(_i||G!==w){pe.buffers.depth.getReversed()&&w.reversedDepth!==!0&&(w._reversedDepth=!0,w.updateProjectionMatrix()),gt.setValue(F,"projectionMatrix",w.projectionMatrix),gt.setValue(F,"viewMatrix",w.matrixWorldInverse);let cr=gt.map.cameraPosition;cr!==void 0&&cr.setValue(F,st.setFromMatrixPosition(w.matrixWorld)),ot.logarithmicDepthBuffer&&gt.setValue(F,"logDepthBufFC",2/(Math.log(w.far+1)/Math.LN2)),(H.isMeshPhongMaterial||H.isMeshToonMaterial||H.isMeshLambertMaterial||H.isMeshBasicMaterial||H.isMeshStandardMaterial||H.isShaderMaterial)&&gt.setValue(F,"isOrthographic",w.isOrthographicCamera===!0),G!==w&&(G=w,ar=!0,Ts=!0)}if(Me.needsLights&&(In.state.directionalShadowMap.length>0&&gt.setValue(F,"directionalShadowMap",In.state.directionalShadowMap,y),In.state.spotShadowMap.length>0&&gt.setValue(F,"spotShadowMap",In.state.spotShadowMap,y),In.state.pointShadowMap.length>0&&gt.setValue(F,"pointShadowMap",In.state.pointShadowMap,y)),W.isSkinnedMesh){gt.setOptional(F,W,"bindMatrix"),gt.setOptional(F,W,"bindMatrixInverse");let vt=W.skeleton;vt&&(vt.boneTexture===null&&vt.computeBoneTexture(),gt.setValue(F,"boneTexture",vt.boneTexture,y))}W.isBatchedMesh&&(gt.setOptional(F,W,"batchingTexture"),gt.setValue(F,"batchingTexture",W._matricesTexture,y),gt.setOptional(F,W,"batchingIdTexture"),gt.setValue(F,"batchingIdTexture",W._indirectTexture,y),gt.setOptional(F,W,"batchingColorTexture"),W._colorsTexture!==null&&gt.setValue(F,"batchingColorTexture",W._colorsTexture,y));let lr=X.morphAttributes;if((lr.position!==void 0||lr.normal!==void 0||lr.color!==void 0)&&De.update(W,X,Wn),(ar||Me.receiveShadow!==W.receiveShadow)&&(Me.receiveShadow=W.receiveShadow,gt.setValue(F,"receiveShadow",W.receiveShadow)),(H.isMeshStandardMaterial||H.isMeshLambertMaterial||H.isMeshPhongMaterial)&&H.envMap===null&&k.environment!==null&&(Ft.envMapIntensity.value=k.environmentIntensity),Ft.dfgLUT!==void 0&&(Ft.dfgLUT.value=fC()),ar){if(gt.setValue(F,"toneMappingExposure",I.toneMappingExposure),Me.needsLights&&Jy(Ft,Ts),_e&&H.fog===!0&&Y.refreshFogUniforms(Ft,_e),Y.refreshMaterialUniforms(Ft,H,he,Ne,b.state.transmissionRenderTarget[w.id]),Me.needsLights&&Me.lightProbeGrid){let vt=Me.lightProbeGrid;Ft.probesSH.value=vt.texture,Ft.probesMin.value.copy(vt.boundingBox.min),Ft.probesMax.value.copy(vt.boundingBox.max),Ft.probesResolution.value.copy(vt.resolution)}No.upload(F,lg(Me),Ft,y)}if(H.isShaderMaterial&&H.uniformsNeedUpdate===!0&&(No.upload(F,lg(Me),Ft,y),H.uniformsNeedUpdate=!1),H.isSpriteMaterial&&gt.setValue(F,"center",W.center),gt.setValue(F,"modelViewMatrix",W.modelViewMatrix),gt.setValue(F,"normalMatrix",W.normalMatrix),gt.setValue(F,"modelMatrix",W.matrixWorld),H.uniformsGroups!==void 0){let vt=H.uniformsGroups;for(let cr=0,As=vt.length;cr<As;cr++){let ug=vt[cr];$.update(ug,Wn),$.bind(ug,Wn)}}return Wn}function Jy(w,k){w.ambientLightColor.needsUpdate=k,w.lightProbe.needsUpdate=k,w.directionalLights.needsUpdate=k,w.directionalLightShadows.needsUpdate=k,w.pointLights.needsUpdate=k,w.pointLightShadows.needsUpdate=k,w.spotLights.needsUpdate=k,w.spotLightShadows.needsUpdate=k,w.rectAreaLights.needsUpdate=k,w.hemisphereLights.needsUpdate=k}function Ky(w){return w.isMeshLambertMaterial||w.isMeshToonMaterial||w.isMeshPhongMaterial||w.isMeshStandardMaterial||w.isShadowMaterial||w.isShaderMaterial&&w.lights===!0}this.getActiveCubeFace=function(){return O},this.getActiveMipmapLevel=function(){return z},this.getRenderTarget=function(){return L},this.setRenderTargetTextures=function(w,k,X){let H=E.get(w);H.__autoAllocateDepthBuffer=w.resolveDepthBuffer===!1,H.__autoAllocateDepthBuffer===!1&&(H.__useRenderToTexture=!1),E.get(w.texture).__webglTexture=k,E.get(w.depthTexture).__webglTexture=H.__autoAllocateDepthBuffer?void 0:X,H.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(w,k){let X=E.get(w);X.__webglFramebuffer=k,X.__useDefaultFramebuffer=k===void 0};let jy=F.createFramebuffer();this.setRenderTarget=function(w,k=0,X=0){L=w,O=k,z=X;let H=null,W=!1,_e=!1;if(w){let xe=E.get(w);if(xe.__useDefaultFramebuffer!==void 0){pe.bindFramebuffer(F.FRAMEBUFFER,xe.__webglFramebuffer),q.copy(w.viewport),J.copy(w.scissor),j=w.scissorTest,pe.viewport(q),pe.scissor(J),pe.setScissorTest(j),B=-1;return}else if(xe.__webglFramebuffer===void 0)y.setupRenderTarget(w);else if(xe.__hasExternalTextures)y.rebindTextures(w,E.get(w.texture).__webglTexture,E.get(w.depthTexture).__webglTexture);else if(w.depthBuffer){let Ge=w.depthTexture;if(xe.__boundDepthTexture!==Ge){if(Ge!==null&&E.has(Ge)&&(w.width!==Ge.image.width||w.height!==Ge.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");y.setupDepthRenderbuffer(w)}}let Re=w.texture;(Re.isData3DTexture||Re.isDataArrayTexture||Re.isCompressedArrayTexture)&&(_e=!0);let Pe=E.get(w).__webglFramebuffer;w.isWebGLCubeRenderTarget?(Array.isArray(Pe[k])?H=Pe[k][X]:H=Pe[k],W=!0):w.samples>0&&y.useMultisampledRTT(w)===!1?H=E.get(w).__webglMultisampledFramebuffer:Array.isArray(Pe)?H=Pe[X]:H=Pe,q.copy(w.viewport),J.copy(w.scissor),j=w.scissorTest}else q.copy(le).multiplyScalar(he).floor(),J.copy(Ae).multiplyScalar(he).floor(),j=Ie;if(X!==0&&(H=jy),pe.bindFramebuffer(F.FRAMEBUFFER,H)&&pe.drawBuffers(w,H),pe.viewport(q),pe.scissor(J),pe.setScissorTest(j),W){let xe=E.get(w.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_CUBE_MAP_POSITIVE_X+k,xe.__webglTexture,X)}else if(_e){let xe=k;for(let Re=0;Re<w.textures.length;Re++){let Pe=E.get(w.textures[Re]);F.framebufferTextureLayer(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0+Re,Pe.__webglTexture,X,xe)}}else if(w!==null&&X!==0){let xe=E.get(w.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,xe.__webglTexture,X)}B=-1},this.readRenderTargetPixels=function(w,k,X,H,W,_e,we,xe=0){if(!(w&&w.isWebGLRenderTarget)){Be("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Re=E.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&we!==void 0&&(Re=Re[we]),Re){pe.bindFramebuffer(F.FRAMEBUFFER,Re);try{let Pe=w.textures[xe],Ge=Pe.format,Ye=Pe.type;if(w.textures.length>1&&F.readBuffer(F.COLOR_ATTACHMENT0+xe),!ot.textureFormatReadable(Ge)){Be("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!ot.textureTypeReadable(Ye)){Be("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}k>=0&&k<=w.width-H&&X>=0&&X<=w.height-W&&F.readPixels(k,X,H,W,N.convert(Ge),N.convert(Ye),_e)}finally{let Pe=L!==null?E.get(L).__webglFramebuffer:null;pe.bindFramebuffer(F.FRAMEBUFFER,Pe)}}},this.readRenderTargetPixelsAsync=async function(w,k,X,H,W,_e,we,xe=0){if(!(w&&w.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Re=E.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&we!==void 0&&(Re=Re[we]),Re)if(k>=0&&k<=w.width-H&&X>=0&&X<=w.height-W){pe.bindFramebuffer(F.FRAMEBUFFER,Re);let Pe=w.textures[xe],Ge=Pe.format,Ye=Pe.type;if(w.textures.length>1&&F.readBuffer(F.COLOR_ATTACHMENT0+xe),!ot.textureFormatReadable(Ge))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!ot.textureTypeReadable(Ye))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Le=F.createBuffer();F.bindBuffer(F.PIXEL_PACK_BUFFER,Le),F.bufferData(F.PIXEL_PACK_BUFFER,_e.byteLength,F.STREAM_READ),F.readPixels(k,X,H,W,N.convert(Ge),N.convert(Ye),0);let dt=L!==null?E.get(L).__webglFramebuffer:null;pe.bindFramebuffer(F.FRAMEBUFFER,dt);let Ut=F.fenceSync(F.SYNC_GPU_COMMANDS_COMPLETE,0);return F.flush(),await K_(F,Ut,4),F.bindBuffer(F.PIXEL_PACK_BUFFER,Le),F.getBufferSubData(F.PIXEL_PACK_BUFFER,0,_e),F.deleteBuffer(Le),F.deleteSync(Ut),_e}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(w,k=null,X=0){let H=Math.pow(2,-X),W=Math.floor(w.image.width*H),_e=Math.floor(w.image.height*H),we=k!==null?k.x:0,xe=k!==null?k.y:0;y.setTexture2D(w,0),F.copyTexSubImage2D(F.TEXTURE_2D,X,0,0,we,xe,W,_e),pe.unbindTexture()};let Qy=F.createFramebuffer(),eS=F.createFramebuffer();this.copyTextureToTexture=function(w,k,X=null,H=null,W=0,_e=0){let we,xe,Re,Pe,Ge,Ye,Le,dt,Ut,Nt=w.isCompressedTexture?w.mipmaps[_e]:w.image;if(X!==null)we=X.max.x-X.min.x,xe=X.max.y-X.min.y,Re=X.isBox3?X.max.z-X.min.z:1,Pe=X.min.x,Ge=X.min.y,Ye=X.isBox3?X.min.z:0;else{let Ft=Math.pow(2,-W);we=Math.floor(Nt.width*Ft),xe=Math.floor(Nt.height*Ft),w.isDataArrayTexture?Re=Nt.depth:w.isData3DTexture?Re=Math.floor(Nt.depth*Ft):Re=1,Pe=0,Ge=0,Ye=0}H!==null?(Le=H.x,dt=H.y,Ut=H.z):(Le=0,dt=0,Ut=0);let mt=N.convert(k.format),sn=N.convert(k.type),Me;k.isData3DTexture?(y.setTexture3D(k,0),Me=F.TEXTURE_3D):k.isDataArrayTexture||k.isCompressedArrayTexture?(y.setTexture2DArray(k,0),Me=F.TEXTURE_2D_ARRAY):(y.setTexture2D(k,0),Me=F.TEXTURE_2D),pe.activeTexture(F.TEXTURE0),pe.pixelStorei(F.UNPACK_FLIP_Y_WEBGL,k.flipY),pe.pixelStorei(F.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),pe.pixelStorei(F.UNPACK_ALIGNMENT,k.unpackAlignment);let In=pe.getParameter(F.UNPACK_ROW_LENGTH),et=pe.getParameter(F.UNPACK_IMAGE_HEIGHT),Wn=pe.getParameter(F.UNPACK_SKIP_PIXELS),_i=pe.getParameter(F.UNPACK_SKIP_ROWS),ar=pe.getParameter(F.UNPACK_SKIP_IMAGES);pe.pixelStorei(F.UNPACK_ROW_LENGTH,Nt.width),pe.pixelStorei(F.UNPACK_IMAGE_HEIGHT,Nt.height),pe.pixelStorei(F.UNPACK_SKIP_PIXELS,Pe),pe.pixelStorei(F.UNPACK_SKIP_ROWS,Ge),pe.pixelStorei(F.UNPACK_SKIP_IMAGES,Ye);let Ts=w.isDataArrayTexture||w.isData3DTexture,gt=k.isDataArrayTexture||k.isData3DTexture;if(w.isDepthTexture){let Ft=E.get(w),lr=E.get(k),vt=E.get(Ft.__renderTarget),cr=E.get(lr.__renderTarget);pe.bindFramebuffer(F.READ_FRAMEBUFFER,vt.__webglFramebuffer),pe.bindFramebuffer(F.DRAW_FRAMEBUFFER,cr.__webglFramebuffer);for(let As=0;As<Re;As++)Ts&&(F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,E.get(w).__webglTexture,W,Ye+As),F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,E.get(k).__webglTexture,_e,Ut+As)),F.blitFramebuffer(Pe,Ge,we,xe,Le,dt,we,xe,F.DEPTH_BUFFER_BIT,F.NEAREST);pe.bindFramebuffer(F.READ_FRAMEBUFFER,null),pe.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else if(W!==0||w.isRenderTargetTexture||E.has(w)){let Ft=E.get(w),lr=E.get(k);pe.bindFramebuffer(F.READ_FRAMEBUFFER,Qy),pe.bindFramebuffer(F.DRAW_FRAMEBUFFER,eS);for(let vt=0;vt<Re;vt++)Ts?F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,Ft.__webglTexture,W,Ye+vt):F.framebufferTexture2D(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,Ft.__webglTexture,W),gt?F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,lr.__webglTexture,_e,Ut+vt):F.framebufferTexture2D(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,lr.__webglTexture,_e),W!==0?F.blitFramebuffer(Pe,Ge,we,xe,Le,dt,we,xe,F.COLOR_BUFFER_BIT,F.NEAREST):gt?F.copyTexSubImage3D(Me,_e,Le,dt,Ut+vt,Pe,Ge,we,xe):F.copyTexSubImage2D(Me,_e,Le,dt,Pe,Ge,we,xe);pe.bindFramebuffer(F.READ_FRAMEBUFFER,null),pe.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else gt?w.isDataTexture||w.isData3DTexture?F.texSubImage3D(Me,_e,Le,dt,Ut,we,xe,Re,mt,sn,Nt.data):k.isCompressedArrayTexture?F.compressedTexSubImage3D(Me,_e,Le,dt,Ut,we,xe,Re,mt,Nt.data):F.texSubImage3D(Me,_e,Le,dt,Ut,we,xe,Re,mt,sn,Nt):w.isDataTexture?F.texSubImage2D(F.TEXTURE_2D,_e,Le,dt,we,xe,mt,sn,Nt.data):w.isCompressedTexture?F.compressedTexSubImage2D(F.TEXTURE_2D,_e,Le,dt,Nt.width,Nt.height,mt,Nt.data):F.texSubImage2D(F.TEXTURE_2D,_e,Le,dt,we,xe,mt,sn,Nt);pe.pixelStorei(F.UNPACK_ROW_LENGTH,In),pe.pixelStorei(F.UNPACK_IMAGE_HEIGHT,et),pe.pixelStorei(F.UNPACK_SKIP_PIXELS,Wn),pe.pixelStorei(F.UNPACK_SKIP_ROWS,_i),pe.pixelStorei(F.UNPACK_SKIP_IMAGES,ar),_e===0&&k.generateMipmaps&&F.generateMipmap(Me),pe.unbindTexture()},this.initRenderTarget=function(w){E.get(w).__webglFramebuffer===void 0&&y.setupRenderTarget(w)},this.initTexture=function(w){w.isCubeTexture?y.setTextureCube(w,0):w.isData3DTexture?y.setTexture3D(w,0):w.isDataArrayTexture||w.isCompressedArrayTexture?y.setTexture2DArray(w,0):y.setTexture2D(w,0),pe.unbindTexture()},this.resetState=function(){O=0,z=0,L=null,pe.reset(),se.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return mi}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let n=this.getContext();n.drawingBufferColorSpace=je._getDrawingBufferColorSpace(e),n.unpackColorSpace=je._getUnpackColorSpace()}};var rd=class extends _s{constructor(){super(),this.name="RoomEnvironment",this.position.y=-3.5;let e=new zr;e.deleteAttribute("uv");let n=new Rn({side:Wt}),i=new Rn,r=new ll(16777215,900,28,2);r.position.set(.418,16.199,.3),this.add(r);let s=new Qe(e,n);s.position.set(-.757,13.219,.717),s.scale.set(31.713,28.305,28.591),this.add(s);let o=new Ja(e,i,6),a=new jt;a.position.set(-10.906,2.009,1.846),a.rotation.set(0,-.195,0),a.scale.set(2.328,7.905,4.651),a.updateMatrix(),o.setMatrixAt(0,a.matrix),a.position.set(-5.607,-.754,-.758),a.rotation.set(0,.994,0),a.scale.set(1.97,1.534,3.955),a.updateMatrix(),o.setMatrixAt(1,a.matrix),a.position.set(6.167,.857,7.803),a.rotation.set(0,.561,0),a.scale.set(3.927,6.285,3.687),a.updateMatrix(),o.setMatrixAt(2,a.matrix),a.position.set(-2.017,.018,6.124),a.rotation.set(0,.333,0),a.scale.set(2.002,4.566,2.064),a.updateMatrix(),o.setMatrixAt(3,a.matrix),a.position.set(2.291,-.756,-2.621),a.rotation.set(0,-.286,0),a.scale.set(1.546,1.552,1.496),a.updateMatrix(),o.setMatrixAt(4,a.matrix),a.position.set(-2.193,-.369,-5.547),a.rotation.set(0,.516,0),a.scale.set(3.875,3.487,2.986),a.updateMatrix(),o.setMatrixAt(5,a.matrix),this.add(o);let l=new Qe(e,Fo(50));l.position.set(-16.116,14.37,8.208),l.scale.set(.1,2.428,2.739),this.add(l);let c=new Qe(e,Fo(50));c.position.set(-16.109,18.021,-8.207),c.scale.set(.1,2.425,2.751),this.add(c);let d=new Qe(e,Fo(17));d.position.set(14.904,12.198,-1.832),d.scale.set(.15,4.265,6.331),this.add(d);let f=new Qe(e,Fo(43));f.position.set(-.462,8.89,14.52),f.scale.set(4.38,5.441,.088),this.add(f);let u=new Qe(e,Fo(20));u.position.set(3.235,11.486,-12.541),u.scale.set(2.5,2,.1),this.add(u);let p=new Qe(e,Fo(100));p.position.set(0,20,0),p.scale.set(1,.1,1),this.add(p)}dispose(){let e=new Set;this.traverse(n=>{n.isMesh&&(e.add(n.geometry),e.add(n.material))});for(let n of e)n.dispose()}};function Fo(t){return new rl({color:0,emissive:16777215,emissiveIntensity:t})}var Ee=Al(ig());document.documentElement.lang="it";var SC="html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{background:#050607}";(()=>{"use strict";var R;if(window.PlayableIdlePreview)return;let t=new URLSearchParams(location.search),e=t.get("feedReview")==="1"||t.get("host")==="fyp",n=matchMedia("(prefers-reduced-motion: reduce)"),i=e,r=0,s=performance.now(),o=new Set,a=()=>{let m=document.documentElement;if(m.dataset.batch2Idle=String(i),m.dataset.batch2IdlePaused=String(document.hidden),m.dataset.batch2IdleReduced=String(n.matches),!i)for(let T of document.querySelectorAll("[data-idle-preview]"))T.dataset.idlePreview="off";s=performance.now();for(let T of o)T(i&&!document.hidden)},l=()=>{let m=performance.now();return i&&!document.hidden&&!n.matches&&(r+=Math.min(64,Math.max(0,m-s))),s=m,n.matches?1600:r},c=(m,T=0,I=1)=>Math.max(T,Math.min(I,m)),d=m=>(m=c(m),m*m*(3-2*m)),f=(m,T,I=1)=>{if(!T.length)return;let A=T.slice(1).map((O,z)=>Math.hypot(O.x-T[z].x,O.y-T[z].y)),P=A.reduce((O,z)=>O+z,0)*c(I);m.beginPath(),m.moveTo(T[0].x,T[0].y);for(let O=1;O<T.length;O++){let z=T[O-1],L=T[O],B=A[O-1],G=Math.min(1,P/Math.max(.01,B));if(m.lineTo(z.x+(L.x-z.x)*G,z.y+(L.y-z.y)*G),P-=B,P<=0)break}m.stroke()},u=(m,T)=>{let I=m.slice(1).map((P,O)=>Math.hypot(P.x-m[O].x,P.y-m[O].y)),A=I.reduce((P,O)=>P+O,0)*c(T);for(let P=1;P<m.length;P++){let O=m[P-1],z=m[P],L=I[P-1];if(A<=L||P===m.length-1){let B=c(A/Math.max(.01,L));return{x:O.x+(z.x-O.x)*B,y:O.y+(z.y-O.y)*B}}A-=L}return m[0]},p=(m,T,I=l())=>{m&&(m.dataset.idlePreview=i?T:"off",m.dataset.idlePhase=String(Math.round(I)))};function x(m,T,I,A){let P=l()/1e3,O=P%5.4/5.4,z=T*.5,L=I*.51,B=Math.min(T*.29,105),G=Math.min(I*.16,78),q=Array.from({length:81},(ue,U)=>({x:z+Math.cos(U/80*Math.PI*2)*B,y:L+Math.sin(U/80*Math.PI*2)*G}));m.save(),m.lineWidth=5,m.lineCap="round",m.lineJoin="round",m.strokeStyle="#242322",m.globalAlpha=O>.88?(1-O)/.12:1,f(m,q,d(O/.48));let J=z+Math.sin(P*2.1)*B*.63,j=L+Math.sin(P*2.8)*G*.59;if(m.translate(J,j),m.rotate(Math.atan2(Math.cos(P*2.8)*G,Math.cos(P*2.1)*B)+Math.PI/2),A!=null&&A.complete&&A.naturalWidth)m.drawImage(A,-17,-17,34,34);else{m.fillStyle="#242322";for(let[ue,U]of[[-7,5],[0,4],[7,6]])m.beginPath(),m.ellipse(0,ue,U,U*1.2,0,0,Math.PI*2),m.fill()}m.restore(),p(m.canvas,"ant-loop")}function S(m,T,I){let A=l()/1e3,P=m.entities.filter(L=>L.team==="player"),O=P.reduce((L,B)=>L+B.x,0)/Math.max(1,P.length),z=P.reduce((L,B)=>L+B.y,0)/Math.max(1,P.length);return{...m,particles:[],playerTarget:{x:T*(.5+Math.sin(A*.8)*.18),y:I*(.43+Math.cos(A*.8)*.04)},entities:m.entities.map((L,B)=>({...L,x:L.team==="player"?T*(.5+Math.sin(A*.8)*.14)+(L.x-O)*.7:L.x+Math.sin(A*1.5+B*.7)*8,y:L.team==="player"?I*(.57+Math.cos(A*.8)*.04)+(L.y-z)*.7:L.y+Math.cos(A*1.5+B*.7)*8}))}}function v(m,T,I,A,P){let O=l()/1e3,z=O%5.8/5.8,L=T/2,B=(A+P)/2,G=[[-.22,.16],[-.11,.02],[.04,.04],[.17,-.17],[.24,-.11]].map(([q,J])=>({x:L+q*T,y:B+J*(P-A)}));m.save(),m.strokeStyle="#303936",m.lineWidth=6,m.lineCap="round",m.lineJoin="round",m.globalAlpha=z>.9?(1-z)/.1:1,z<.5?f(m,G,d(z/.45)):(m.translate(L,B),m.rotate((z-.5)*Math.PI*3.4),f(m,G.map(q=>({x:q.x-L,y:q.y-B}))),m.fillStyle="#303936",m.beginPath(),m.arc(0,0,11,0,Math.PI*2),m.fill()),m.restore(),p(m.canvas,"draw-and-spin-blade")}function h(m){let T=l()/1e3,I=m==="player"?0:m==="copL"?1.3:2.2,A=T*.75-I,P=375+Math.sin(A)*130,O=m==="player"?800:1040+(m==="copR"?60:0);return{x:P+(m==="copL"?-85:m==="copR"?85:0),y:O+Math.cos(A)*28,angle:-Math.PI/2+Math.cos(A)*.18}}function g(m){let T=h("player");m.save(),m.strokeStyle="#ffffff88",m.setLineDash([11,12]),m.lineWidth=5,m.beginPath(),m.moveTo(T.x,T.y),m.bezierCurveTo(T.x+100,T.y-100,340,T.y-220,420,T.y-340),m.stroke(),m.restore(),p(m.canvas,"escape-route")}function _(m,T,I,A){let P=[m,T];for(let q of I)for(let J=0;J<12;J++){let j=J*Math.PI/6,ue=q.circleRadius+16,U={x:q.position.x+Math.cos(j)*ue,y:q.position.y+Math.sin(j)*ue};U.x>15&&U.x<A-15&&P.push(U)}let O=P.map(()=>1/0),z=P.map(()=>-1),L=new Set;O[0]=0;let B=(q,J)=>I.every(j=>{let ue=J.x-q.x,U=J.y-q.y,ne=c(((j.position.x-q.x)*ue+(j.position.y-q.y)*U)/Math.max(.01,ue*ue+U*U));return Math.hypot(q.x+ue*ne-j.position.x,q.y+U*ne-j.position.y)>j.circleRadius+7});for(let q=0;q<P.length;q++){let J=-1;for(let j=0;j<P.length;j++)!L.has(j)&&(J<0||O[j]<O[J])&&(J=j);if(J<0||!Number.isFinite(O[J])||J===1)break;L.add(J);for(let j=0;j<P.length;j++){if(L.has(j)||!B(P[J],P[j]))continue;let ue=O[J]+Math.hypot(P[J].x-P[j].x,P[J].y-P[j].y);ue<O[j]&&(O[j]=ue,z[j]=J)}}if(z[1]<0)return[m,{x:20,y:m.y+24},{x:20,y:T.y-28},T];let G=[];for(let q=1;q>=0&&(G.unshift(P[q]),q!==0);q=z[q]);return G}let M=null;function C(m,T,I,A,P,O,z){if(!T||!I)return;let L=l()/1e3,B=L%5.6,G=O.filter(j=>j.label==="obstacle"),q=JSON.stringify([T,I,z,G.map(j=>[j.position.x,j.position.y,j.circleRadius])]);(M==null?void 0:M.key)!==q&&(M={key:q,points:_({x:T.x,y:T.y+21},{x:I.x,y:I.y-P*.42},G,z)});let J=M.points;if(m.save(),m.strokeStyle="#242322",m.lineWidth=5,m.lineCap="round",m.lineJoin="round",m.globalAlpha=B>5?(5.6-B)/.6:1,f(m,J,d(B/1.7)),B>1.4&&B<5)for(let j=0;j<15;j++){let ue=(B-1.4)*.65-j*.067;if(ue<0||ue>1)continue;let U=u(J,ue);m.fillStyle="#59c6b1",m.strokeStyle="#242322",m.lineWidth=1,m.beginPath(),m.arc(U.x,U.y,4,0,Math.PI*2),m.fill(),m.stroke()}m.restore(),p(m.canvas,"guided-soda-route")}let b=document.createElement("style");b.dataset.batch2IdleStyle="",b.textContent=`
    html[data-batch2-idle=true] .idle-memory-deck{display:block}
    .idle-memory-deck{position:absolute;inset:0;display:none;overflow:hidden;pointer-events:none}
    .idle-memory-deck img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;animation:idle-memory-photo 7.2s linear infinite}
    .idle-memory-deck img:nth-child(2){animation-delay:-4.8s}.idle-memory-deck img:nth-child(3){animation-delay:-2.4s}
    .idle-clean-tool{display:none;position:absolute;z-index:5;left:var(--idle-clean-x,25%);top:var(--idle-clean-y,54%);width:76px;height:95px;pointer-events:none;transform:translate(-50%,-35%)}
    .idle-clean-tool>span{display:none;width:100%;height:100%}.idle-clean-tool img{width:100%;height:100%;object-fit:contain}
    html[data-batch2-idle=true] .idle-clean-tool{display:block}
    [data-idle-clean-tool=spray] .idle-clean-spray,[data-idle-clean-tool=brush] .idle-clean-brush,[data-idle-clean-tool=rinse] .idle-clean-rinse{display:block}
    html[data-batch2-idle=true] .video-window>img{visibility:hidden}
    @keyframes idle-memory-photo{0%,29%{opacity:1;transform:scale(1)}33%,96%{opacity:0;transform:scale(1.035)}100%{opacity:1;transform:scale(1)}}
    html[data-batch2-idle=true] .tool-swing{animation:idle-tool-hit 2.6s ease-in-out infinite!important;transform-origin:70% 75%}
    html[data-batch2-idle=true] .target-art{animation:idle-stick-react 2.6s ease-in-out infinite!important;transform-origin:50% 75%}
    @keyframes idle-tool-hit{0%,32%,100%{transform:translate(10px,5px) rotate(-25deg)}46%{transform:translate(-30px,-8px) rotate(-64deg)}55%,70%{transform:translate(6px,7px) rotate(-20deg)}}
    @keyframes idle-stick-react{0%,45%,72%,100%{transform:rotate(0) scale(1)}50%{transform:translate(-4px,2px) rotate(-3deg) scale(1.025,.97)}60%{transform:rotate(1.5deg) scale(.99,1.01)}}
    html[data-batch2-idle-paused=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation-play-state:paused!important}
    html[data-batch2-idle-reduced=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation:none!important}
    html[data-batch2-idle-reduced=true] .idle-memory-deck img:first-child{opacity:1}
  `,document.head.append(b),window.PlayableIdlePreview=Object.freeze({get active(){return i&&!document.hidden},get preview(){return i},get reduced(){return n.matches},get seconds(){return l()/1e3},clock:l,ease:d,clamp:c,stamp:p,trace:f,onPath:u,ant:x,army:S,blade:v,road:g,roadPose:h,soda:C,subscribe(m){return o.add(m),()=>o.delete(m)}}),addEventListener("message",m=>{var I;if(parent===window||m.source!==parent||m.origin!==location.origin||((I=m.data)==null?void 0:I.type)!=="playable-active")return;let T=m.data.active!==!0;T!==i&&(i=T,r=0),a()}),document.addEventListener("visibilitychange",a),(R=n.addEventListener)==null||R.call(n,"change",a),addEventListener("pagehide",()=>{i=!1,a(),o.clear()},{once:!0}),a()})();var Dy=(()=>{let t=window.parent!==window&&new URLSearchParams(location.search).get("feedReview")==="1",e=!t,n=new Set,i=()=>{document.documentElement.dataset.feedPreview=String(!e);for(let r of n)r(e&&!document.hidden)};return window.addEventListener("message",r=>{var s;!t||r.source!==parent||r.origin!==location.origin||((s=r.data)==null?void 0:s.type)!=="playable-active"||(e=r.data.active===!0,i())}),document.addEventListener("visibilitychange",i),i(),{get active(){return e&&!document.hidden},subscribe(r){return n.add(r),()=>n.delete(r)}}})(),Uy=window.matchMedia("(prefers-reduced-motion: reduce)");function ky(){let[t,e]=rt.default.useState(Dy.active);return rt.default.useEffect(()=>Dy.subscribe(e),[]),t}function MC(){let t=ky();return(0,Ee.jsxs)(Ee.Fragment,{children:[(0,Ee.jsx)("style",{children:wC}),!t&&[80,81,84].includes(wl)&&(0,Ee.jsxs)("div",{className:"preview-example example-"+wl,"aria-hidden":"true",children:[wl===80&&(0,Ee.jsxs)("svg",{viewBox:"0 0 320 220",children:[(0,Ee.jsx)("defs",{children:(0,Ee.jsxs)("radialGradient",{id:"soft-example",cx:".35",cy:".2",r:".9",children:[(0,Ee.jsx)("stop",{stopColor:"#ffe4bd"}),(0,Ee.jsx)("stop",{offset:"1",stopColor:"#f3ad97"})]})}),(0,Ee.jsx)("path",{className:"example-blob",d:"M78 61C112 16 184 23 192 66C206 88 248 75 249 113C251 162 200 176 165 166C117 195 69 166 80 124C40 101 47 78 78 61Z",fill:"url(#soft-example)",stroke:"#d99485",strokeWidth:"2"}),(0,Ee.jsxs)("g",{className:"example-eyes",children:[(0,Ee.jsx)("ellipse",{cx:"136",cy:"91",rx:"11",ry:"14",fill:"white"}),(0,Ee.jsx)("ellipse",{cx:"168",cy:"91",rx:"11",ry:"14",fill:"white"}),(0,Ee.jsx)("circle",{cx:"139",cy:"94",r:"5",fill:"#443c39"}),(0,Ee.jsx)("circle",{cx:"171",cy:"94",r:"5",fill:"#443c39"})]})]}),wl===81&&(0,Ee.jsxs)("svg",{viewBox:"0 0 320 220",children:[(0,Ee.jsx)("path",{className:"example-noodle",d:"M65 145C44 109 84 61 115 88S139 171 187 151S250 80 263 126",fill:"none",stroke:"#e4d3ed",strokeWidth:"29",strokeLinecap:"round"}),(0,Ee.jsx)("path",{className:"example-noodle",d:"M65 145C44 109 84 61 115 88S139 171 187 151S250 80 263 126",fill:"none",stroke:"#3e3b42",strokeWidth:"13",strokeLinecap:"round"}),(0,Ee.jsx)("circle",{cx:"129",cy:"103",r:"6",fill:"white"}),(0,Ee.jsx)("circle",{cx:"144",cy:"111",r:"6",fill:"white"}),(0,Ee.jsx)("circle",{cx:"130",cy:"104",r:"2.4"}),(0,Ee.jsx)("circle",{cx:"145",cy:"112",r:"2.4"}),(0,Ee.jsx)("path",{d:"M115 151q-5 17-15 11M186 160q5 18 15 9",fill:"none",stroke:"#3e3b42",strokeWidth:"3",strokeLinecap:"round"})]}),wl===84&&(0,Ee.jsxs)("div",{className:"example-poem",children:["una piccola linea diventa un pensiero",(0,Ee.jsx)("br",{}),"le parole vagano sul foglio",(0,Ee.jsx)("br",{}),(0,Ee.jsx)("em",{children:"piano"})," si apre un piccolo mondo",(0,Ee.jsx)("br",{}),"ogni segno \xE8 un momento",(0,Ee.jsx)("br",{}),"e ogni momento pu\xF2 ricominciare"]})]})]})}var EC=`
button { touch-action: manipulation; }
button:focus-visible { outline: 3px solid #3c8ddd; outline-offset: 3px; }
@keyframes batchBreathe { 0%,100% { opacity:.72; } 50% { opacity:1; } }
.preview-example { position:fixed; z-index:2; pointer-events:none; width:min(80%,340px); left:50%; top:35%; transform:translateX(-50%); }
.preview-example svg { width:100%; height:auto; overflow:visible; }
.example-blob { transform-origin:50% 60%; animation:exampleSquish 3.8s ease-in-out infinite; }
.example-noodle { transform-origin:50% 70%; animation:exampleWiggle 3.6s ease-in-out infinite; }
.example-poem { padding:20px; color:#44444c; font:15px/1.8 ui-monospace,monospace; clip-path:ellipse(49% 47% at 50% 50%); animation:exampleInk 5s ease-in-out infinite; }
.example-poem em { color:#ad7397; font-style:normal; }
@keyframes exampleSquish { 0%,100% {transform:scale(1,1) rotate(-3deg)} 40% {transform:scale(1.06,.94) rotate(2deg)} 70% {transform:scale(.96,1.04) rotate(-1deg)} }
@keyframes exampleWiggle { 0%,100% { transform:rotate(-3deg) translateY(0); } 50% { transform:rotate(3deg) translateY(-5px); } }
@keyframes exampleInk { 0%,100% {opacity:.25;clip-path:ellipse(23% 35% at 32% 50%)} 45%,70% {opacity:.9;clip-path:ellipse(49% 47% at 50% 50%)} }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }
`,wl=82,wC=EC+"",Fy={WORLD_WIDTH:360,WORLD_HEIGHT:780,GRAVITY:1,DROP_INTERVAL_MS:92,MAX_SEGMENTS:42,CONE_TOP_Y:360,GAME_HINT:"Tieni premuto e gira",HEIGHT_LABEL:"cm",VANILLA:"Vaniglia",CHOCOLATE:"Cioccolato",STRAWBERRY:"Fragola",RESULT_TITLE:"Fatto!",RESULT_HEIGHT:"Altezza finale",PLAY_AGAIN:"Rigioca",POST_PLAY:"Pubblica la partita",BEST_LABEL:"Record personale"},od={vanilla:16773587,chocolate:7752507,strawberry:15904951},Qt=.27;var ws=1e3/120,xi=.78,Jr=1.35,zy=1.04,ad=900,Vy=.24,Gy=1.12,ld=.82,bs=(xi-Qt*(.9+.24)-.02)*1.15;function Hy(t,e){let n=Math.hypot(t,e),i=n>bs?bs/n:1;return{x:t*i,z:e*i}}function bC(t,e,n){let i=Math.max(1,Math.min(n.width,n.height)/2-12),r=(t-n.left-n.width/2)/i,s=(e-n.top-n.height/2)/i,o=Math.hypot(r,s);return o>1&&(r/=o,s/=o),{u:r,v:s,travel:i,x:(r*.936+s*.351)*bs,z:(-r*.351+s*.936)*bs}}function Oy(t=.36){return{top:t,points:[],pending:[],drops:[],airborneRuns:[],lastLay:null,flightSeconds:Vy,cone:{x:0,y:0,z:0},target:{x:0,z:0},nozzle:{x:0,y:t+zy,z:0},holding:!1,started:!1,accumulator:0,emitClock:0,emitted:0,elapsed:0,pourTime:0,peak:0,finalHeight:0,flow:0,settling:0,firstLandingMs:null,pointerId:null,pointerLast:null,pointerOrigin:null,generatedVolume:0,landedVolume:0,spilledVolume:0,pathDistance:0,footprint:[],moving:!0,rest:0,idleDrift:{x:0,z:0},depositRevision:0}}function TC(t){t.holding=!0,t.started=!0,t.accumulator=0}function Wy(t,e){let n=Math.hypot(e.x-t.cone.x,e.z-t.cone.z);if(n>=xi+Qt*.12)return null;let i=Math.min(n,xi-Qt*.35),r=Jr/xi;return t.top+t.cone.y-Jr+i*r+Qt*Math.sqrt(1+r*r)}function Xy(t,e,n,i){let r=Wy(t,{x:e+t.cone.x,z:n+t.cone.z});if(r===null)return null;r-=t.cone.y;let s=Qt*2*.96;for(let o of t.points){if(i-o.stroke<Qt*2.5)continue;let a=Math.hypot(e-o.local.x,n-o.local.z);a>=s||(r=Math.max(r,o.local.y+Math.sqrt(s*s-a*a)*ld))}return r}function AC(t,e){var s;for(t.footprint.push({x:-t.cone.x,z:-t.cone.z,t:t.elapsed});((s=t.footprint[0])==null?void 0:s.t)<t.elapsed-950;)t.footprint.shift();let n=0,i=0;for(let o of t.footprint)n+=o.x,i+=o.z;n/=t.footprint.length,i/=t.footprint.length;let r=0;for(let o of t.footprint)r+=(o.x-n)**2+(o.z-i)**2;if(t.moving=t.pourTime<.95||Math.sqrt(r/t.footprint.length)>.022,t.rest+=(+!t.moving-t.rest)*(1-Math.exp(-e/.22)),t.moving)t.idleDrift.x*=Math.exp(-e/.3),t.idleDrift.z*=Math.exp(-e/.3);else{let o=Math.atan2(-t.cone.z,-t.cone.x)||.25;t.idleDrift.x+=Math.cos(o)*.075*e,t.idleDrift.z+=Math.sin(o)*.075*e}}function qy(t,e){return Hy(e.x*.55-t.cone.x*.45+t.idleDrift.x,e.z*.55-t.cone.z*.45+t.idleDrift.z)}function CC(t,e){let n=qy(t,e),i=t.lastLay??t.points.at(-1),r=1/60;if(Math.hypot(n.x,n.z)>xi+Qt*.1){t.spilledVolume+=e.volume,t.drops.push({x:n.x+t.cone.x,z:n.z+t.cone.z,y:t.top+t.cone.y,age:0});return}let s=n.x,o=n.z;if(i){let x=s-i.local.x,S=o-i.local.z,v=Math.hypot(x,S),h=Math.min(v,Gy*r*2.3),g=v?h/v:0;s=i.local.x+x*g,o=i.local.z+S*g}let a=i?Math.hypot(s-i.local.x,o-i.local.z):0,l=t.pathDistance+a,c=Xy(t,s,o,l);if(c===null){t.spilledVolume+=e.volume;return}if(i&&t.rest>.03&&(c=Math.max(c,i.local.y+.25*t.rest*r)),i){let x=Math.max(.006,a*.85);c=Math.min(c,i.local.y+x);let S=Wy(t,{x:s+t.cone.x,z:o+t.cone.z});S!==null&&(c=Math.max(c,S-t.cone.y))}let d=i&&Math.hypot(s-i.local.x,c-i.local.y,o-i.local.z)>.55,f=t.points.at(-1),u=f?Math.hypot(s-f.local.x,c-f.local.y,o-f.local.z):1/0,p={x:s,y:c,z:o};f&&u<.035&&!d?f.volume+=e.volume:t.points.push({local:p,x:s+t.cone.x,y:c+t.cone.y,z:o+t.cone.z,settled:!0,volume:e.volume,stroke:l,start:!i||!!d}),t.lastLay={local:p,stroke:l},t.pathDistance=l+(t.rest>.03?.25*t.rest*r:0),t.landedVolume+=e.volume,t.depositRevision++,t.firstLandingMs===null&&(t.firstLandingMs=t.elapsed)}function RC(t){let e=[],n=[],i=t.points.at(-1);i&&n.push({x:i.local.x+t.cone.x,y:i.local.y+t.cone.y,z:i.local.z+t.cone.z});for(let r of t.pending){let s=qy(t,r),o=Xy(t,s.x,s.z,t.pathDistance),a=Math.min(1,Math.max(0,(t.elapsed-r.born)/(t.flightSeconds*1e3))),l=a*a*(1.4-.4*a),c=o===null?t.top+t.cone.y-.2:o+t.cone.y;n.push({x:(s.x+t.cone.x)*a,y:t.nozzle.y+(c-t.nozzle.y)*l,z:(s.z+t.cone.z)*a})}t.holding&&n.push({...t.nozzle}),n.length>1&&e.push(n);for(let r of t.drops){let s=r.age,o=2.2*s+4.9*s*s;e.push([{x:r.x,y:r.y-o,z:r.z},{x:r.x+.008,y:r.y-o+.12,z:r.z}])}t.airborneRuns=e}function PC(t,e){let n=ws/1e3,i=t.cone,r=1-Math.exp(-n/.045);t.flightSeconds=Vy/Math.sqrt(Math.max(.2,Math.min(4,Number(e.GRAVITY)||1))),i.x+=(t.target.x-i.x)*r,i.z+=(t.target.z-i.z)*r,t.holding&&(i.y+=(-t.peak-i.y)*(1-Math.exp(-n/.18)));for(let s of t.points)s.x=s.local.x+i.x,s.y=s.local.y+i.y,s.z=s.local.z+i.z;if(t.holding){t.pourTime+=n,AC(t,n),t.emitClock+=ws;let s=Math.PI*Qt**2*Gy*(92/Math.max(60,Number(e.DROP_INTERVAL_MS)||92));for(;t.emitClock+1e-7>=1e3/60;){t.emitClock-=1e3/60;let o=s/60;t.pending.push({x:-i.x,z:-i.z,born:t.elapsed,volume:o}),t.generatedVolume+=o,t.emitted++}(t.pourTime>=Math.max(24,Number(e.MAX_SEGMENTS)||42)*.8||t.points.length>=Math.max(24,Number(e.MAX_SEGMENTS)||42)*8)&&(t.holding=!1,t.pointerId=null,t.settling=ad)}for(t.elapsed+=ws;t.pending.length&&t.elapsed-t.pending[0].born>=t.flightSeconds*1e3-1e-7;)CC(t,t.pending.shift());for(let s of t.drops)s.age+=n;if(t.drops=t.drops.filter(s=>s.age<.55),t.peak=Yy(t),t.flow+=(Number(t.holding)-t.flow)*(1-Math.exp(-n/.1)),RC(t),t.settling>0&&(t.settling=Math.max(0,t.settling-ws),!t.settling))if(t.pending.length||t.drops.length)t.settling=ws;else return!0;return!1}function IC(t,e,n){t.accumulator=Math.min(64,t.accumulator+Math.max(0,e));let i=!1;for(;t.accumulator+1e-7>=ws;)i=PC(t,n)||i,t.accumulator-=ws;return i}function Yy(t){let e=0;for(let n of t.points)Math.hypot(n.local.x,n.local.z)<xi+Qt*.1&&(e=Math.max(e,n.local.y+Qt*ld-t.top));return Math.max(0,e)}function LC(t){let e=[],n=[];for(let i of t)i.start&&n.length&&(e.push(n),n=[]),n.push(i);return n.length&&e.push(n),{landed:e,falling:[]}}function rg(t,e=Qt,n=!1,i,r=1){let s=t.filter((A,P)=>!P||Math.hypot(A.x-t[P-1].x,A.y-t[P-1].y,A.z-t[P-1].z)>1e-4);if(s.length<2)return null;let o=new ys(s.map(A=>new D(A.x,A.y,A.z)),!1,"centripetal"),a=i??(s.length-1)*3,l=48,c=[],d=[0],f={normals:[],binormals:[]};for(let A=0;A<=a;A++)c.push(o.getPoint(A/a)),A&&d.push(d[A-1]+c[A].distanceTo(c[A-1]));let u,p;for(let A=0;A<=a;A++){let P=c[Math.min(a,A+1)].clone().sub(c[Math.max(0,A-1)]).normalize();if(!A)p=new D(Math.abs(P.x)>.9?0:1,0,Math.abs(P.x)>.9?1:0).projectOnPlane(P).normalize();else{let O=new D().crossVectors(u,P);O.lengthSq()>1e-12&&p.applyAxisAngle(O.normalize(),Math.acos(Im.clamp(u.dot(P),-1,1))),p.projectOnPlane(P).normalize()}f.normals.push(p.clone()),f.binormals.push(new D().crossVectors(P,p).normalize()),u=P}let x=d[a],S=(a+1)*(l+1)+2,v=new Float32Array(S*3),h=new Float32Array(S*2),g=new(S>65535?Uint32Array:Uint16Array)((a*l*2+l*2)*3),_=0,M=0,C=0;for(let A=0;A<=a;A++){let P=c[A],O=f.normals[A],z=f.binormals[A],L=x-d[A],B=n?Math.max(.018,Math.min(1,L/(e*2.6))):1,G=.78+.22*Math.min(1,d[A]/(e*1.3));for(let q=0;q<=l;q++){let J=q/l*Math.PI*2,j=e*(.9+.24*Math.cos(J*6))*B*G,ue=Math.cos(J)*j,U=Math.sin(J)*j;if(v[_++]=P.x+O.x*ue+z.x*U,v[_++]=P.y+(O.y*ue+z.y*U)*r,v[_++]=P.z+O.z*ue+z.z*U,h[M++]=A/a,h[M++]=q/l,A<a&&q<l){let ne=A*(l+1)+q,Ne=ne+l+1;g[C++]=ne,g[C++]=ne+1,g[C++]=Ne,g[C++]=Ne,g[C++]=ne+1,g[C++]=Ne+1}}}let b=c[0],R=c[a],m=(a+1)*(l+1);v.set([b.x,b.y,b.z,R.x,R.y,R.z],_),h.set([0,.5,1,.5],M);for(let A=0;A<l;A++){g[C++]=m,g[C++]=A+1,g[C++]=A;let P=a*(l+1);g[C++]=m+1,g[C++]=P+A,g[C++]=P+A+1}let T=new fn;T.setAttribute("position",new Jt(v,3)),T.setAttribute("uv",new Jt(h,2)),T.setIndex(new Jt(g,1)),T.computeVertexNormals();let I=T.attributes.normal;for(let A=0;A<=a;A++){let P=A*(l+1),O=P+l,z=new D().fromBufferAttribute(I,P).add(new D().fromBufferAttribute(I,O)).normalize();I.setXYZ(P,z.x,z.y,z.z),I.setXYZ(O,z.x,z.y,z.z)}return T.computeBoundingSphere(),T}function NC(t,e){let n=[],i=Math.max(2,Math.round(145*e));for(let r=0;r<i;r++){let s=r/144,o=s*Math.PI*2*3.65-Math.PI/2,a=Math.min(.53,bs)*Math.pow(Math.max(0,1-s),.72),l=Math.max(0,(s-.88)/.12);n.push({x:Math.cos(o)*a+l*l*.09,y:t+.1+s*1.32+l*.1,z:Math.sin(o)*a})}return n}function DC(){let t=ky(),[e,n]=(0,rt.useState)(Fy),[i,r]=(0,rt.useState)("vanilla"),[s,o]=(0,rt.useState)(0),[a,l]=(0,rt.useState)("ready"),[c,d]=(0,rt.useState)(!0),[f,u]=(0,rt.useState)(""),[p,x]=(0,rt.useState)(()=>{try{return Number(localStorage.getItem("softserve81-best-v2"))||0}catch{return 0}}),[S,v]=(0,rt.useState)(!1),h=(0,rt.useRef)(null),g=(0,rt.useRef)(null),_=(0,rt.useRef)(null),M=(0,rt.useRef)(null),C=(0,rt.useRef)(t),b=(0,rt.useRef)(e),R=(0,rt.useRef)("ready"),m=(0,rt.useRef)(i),T=(0,rt.useRef)(null),I=(0,rt.useRef)(new Map),A=typeof tt<"u"&&typeof tt.playableRecordingSubmission=="function";(0,rt.useEffect)(()=>{b.current=e},[e]),(0,rt.useEffect)(()=>{var U;m.current=i,(U=g.current)==null||U.creamMaterial.color.setHex(od[i])},[i]),(0,rt.useEffect)(()=>{C.current=t;let U=g.current;U&&!t&&U.holding&&(U.holding=!1,U.pointerId=null,U.settling=ad,R.current="settling",l("settling")),U&&(U.accumulator=0)},[t]),(0,rt.useEffect)(()=>{fetch("./game.config.json").then(U=>U.json()).then(U=>n({...Fy,...Object.fromEntries([...U.tweaks,...U.texts].map(ne=>[ne.id,ne.value]))})).catch(()=>{})},[]);let P=U=>{C.current&&UC("serve-"+U,U==="finish"?"./assets/sfx_result.mp3":"./assets/sfx_reset.mp3")},O=()=>{let U=g.current;U&&(Object.assign(U,Oy(U.top)),U.renderClock=99,U.creamDirty=!0,U.landedSignature=null,U.fitZoom=null,R.current="ready",l("ready"),o(0),d(!0),M.current&&(M.current.style.transform="translate(0px,0px)"),P("tap"))};(0,rt.useEffect)(()=>{let U=h.current,ne;try{ne=new td({canvas:U,antialias:!0,powerPreference:"high-performance"})}catch{u("Impossibile aprire la vista 3D. Prova un altro browser.");return}ne.setPixelRatio(Math.min(devicePixelRatio||1,2)),ne.setClearColor(16775661),ne.outputColorSpace=yn,ne.toneMapping=hl,ne.toneMappingExposure=1.05,ne.shadowMap.enabled=!0,ne.shadowMap.type=lh;let Ne=new _s,he=new Wr(-2.3,2.3,2.3,-2.3,.1,40);he.position.set(2.8,4.2,7.5),he.lookAt(0,.7,0);let Q=new rd,me=new Do(ne),le=me.fromScene(Q,.04);Ne.environment=le.texture,Ne.environmentIntensity=.35,Q.dispose(),me.dispose(),Ne.add(new ol(16776689,10198403,2));let Ae=new cl(16774102,2.9);Ae.position.set(-3.5,6,4),Ae.castShadow=!0,Ae.shadow.mapSize.set(1024,1024),Ae.shadow.camera.left=-3,Ae.shadow.camera.right=3,Ae.shadow.camera.top=4,Ae.shadow.camera.bottom=-4,Ae.shadow.normalBias=.015,Ne.add(Ae);let Ie=.36+(360-e.CONE_TOP_Y)/300,Te=new Qn;Ne.add(Te);let ft=new Rn({color:12029002,roughness:.95}),ke=new Qe(new sr(xi,.008,Jr,64,1,!0),ft);ke.position.y=Ie-Jr/2,ke.castShadow=!0,ke.receiveShadow=!0,Te.add(ke);let it=new Qe(new sr(xi-.025,.008,Jr,64,1,!0),new Rn({color:10910780,roughness:1,side:Wt}));it.position.copy(ke.position),it.receiveShadow=!0,Te.add(it);let st=new Qe(new To(xi,.028,10,80),new Rn({color:14333300,roughness:.88}));st.rotation.x=Math.PI/2,st.position.y=Ie,st.castShadow=!0,Te.add(st);let We=new Rn({color:13871718,roughness:1});for(let Z of[-1,1])for(let ae=0;ae<24;ae++){let ge=[];for(let ie=0;ie<=30;ie++){let De=.015+ie/30*.975,Oe=.01+De*xi,Ve=ae/24*Math.PI*2+Z*De*3.2;ge.push(new D(Math.cos(Ve)*Oe,Ie-Jr+De*Jr,Math.sin(Ve)*Oe))}let ce=new Qe(new il(new ys(ge),30,.0055,4,!1),We);Te.add(ce)}let St=new Qn,pt=new Rn({color:6584946,roughness:.65,metalness:.15}),Bt=Ie+zy,F=new Qe(new sr(.17,.17,1,32),pt);F.scale.y=5.5,F.position.y=Bt+2.96;let Lt=new Qe(new sr(.35,.35,.12,48),pt);Lt.position.y=Bt+.25;let Xe=new Qe(new sr(.29,.29,.24,48),pt);Xe.position.y=Bt+.11;let ot=new Qe(new To(.294,.014,8,48),new Rn({color:8098184,roughness:.7}));ot.rotation.x=Math.PI/2,ot.position.y=Bt+.012,St.add(F,Lt,Xe,ot),Ne.add(St);let pe=new Rn({color:od[m.current],roughness:.69,metalness:0}),at=new Qe(rg(NC(Ie,1),Qt,!0),pe);at.castShadow=!0,at.receiveShadow=!0,Te.add(at);let E={...Oy(Ie),scene:Ne,camera:he,renderer:ne,coneGroup:Te,dispenser:St,creamMaterial:pe,demo:at,cream:null,lastTime:performance.now(),renderClock:99,fitZoom:null,drawCount:0};g.current=E;let y=new D(0,1,0).applyQuaternion(he.quaternion),V=new D(1,0,0).applyQuaternion(he.quaternion),K=new D,ee=()=>{let Z=U.getBoundingClientRect();ne.setSize(Math.max(1,Z.width),Math.max(1,Z.height),!1);let ae=4.6*(e.WORLD_HEIGHT/780)*(360/e.WORLD_WIDTH);he.top=ae/2,he.bottom=-ae/2,he.left=-ae*Z.width/Math.max(1,Z.height)/2,he.right=-he.left,he.updateProjectionMatrix()},oe=new ResizeObserver(ee);oe.observe(U),ee();let de,Y=Z=>{de=requestAnimationFrame(Y);let ae=Math.min(64,Math.max(0,Z-E.lastTime));if(E.lastTime=Z,document.hidden){E.accumulator=0;return}let ge=!C.current&&!E.started;if(at.visible=ge,St.visible=!ge&&R.current!=="result",ge){let Se=window.PlayableIdlePreview,$e=Se.seconds,qe=$e%6.4,lt=Se.reduced?1:.08+.92*Se.ease(qe/3.5);Te.rotation.y=Se.reduced?0:Math.sin($e*.65)*.11,at.geometry.setDrawRange(0,Math.floor(at.geometry.index.count*lt/3)*3),Se.stamp(U,"softserve-build")}else Te.rotation.y=0;if(C.current&&["playing","settling"].includes(R.current)){let Se=IC(E,ae,b.current);if(E.creamDirty=!0,!E.holding&&R.current==="playing"&&(R.current="settling",l("settling")),Se){E.finalHeight=Yy(E);let $e=E.finalHeight*10;o($e),x(qe=>{let lt=Math.max(qe,$e);try{localStorage.setItem("softserve81-best-v2",String(lt))}catch{}return lt}),R.current="result",l("result"),P("finish")}}Te.position.set(E.cone.x,E.cone.y,E.cone.z);let ce=Math.max(0,(R.current==="result"?E.finalHeight:E.peak)*10);if(E.drawCount%8===0&&R.current!=="result"&&o(ce),E.renderClock+=ae,E.creamDirty&&E.renderClock>=33){E.renderClock=0,E.creamDirty=!1;let Se=LC(E.points);Se.falling=E.airborneRuns;let $e=E.points.filter(ct=>ct.settled&&!ct.spilled).length,qe=ct=>ct.map((At,Mn)=>{if(!Mn||Mn===ct.length-1)return At;let Hn=ct[Mn-1],ii=ct[Mn+1];return{x:At.x*.7+(Hn.x+ii.x)*.15,y:At.y*.7+(Hn.y+ii.y)*.15,z:At.z*.7+(Hn.z+ii.z)*.15}}),lt=R.current==="result",Vt=E.points.map(ct=>ct.spilled?"x":ct.settled?"s":"f").join("")+":"+E.depositRevision+":"+lt;if(E.landedSignature!==Vt){E.landedSignature=Vt,E.cream&&(Te.remove(E.cream),E.cream.traverse(ct=>{var At;return(At=ct.geometry)==null?void 0:At.dispose()})),E.cream=new Qn;for(let ct of Se.landed){let At=ct[0].local,Mn=ct.length===1?new nl(Qt,24,16).scale(1,ld,1).translate(At.x,At.y,At.z):rg(qe(ct.map(Hn=>Hn.local)),Qt,lt,void 0,ld);if(Mn){let Hn=new Qe(Mn,pe);Hn.castShadow=!0,Hn.receiveShadow=!0,E.cream.add(Hn)}}Te.add(E.cream)}E.stream&&(Ne.remove(E.stream),E.stream.traverse(ct=>{var At;return(At=ct.geometry)==null?void 0:At.dispose()})),E.stream=new Qn;for(let ct of Se.falling){let At=rg(qe(ct),Qt,!E.holding);if(At){let Mn=new Qe(At,pe);Mn.castShadow=!0,Mn.receiveShadow=!0,E.stream.add(Mn)}}Ne.add(E.stream),E.landedCount=$e}Ne.updateMatrixWorld(!0);let ie=1/0,De=-1/0,Oe=1/0,Ve=-1/0,N=(Se,$e,qe,lt=0)=>{K.set(Se,$e,qe);let Vt=K.dot(V),ct=K.dot(y);ie=Math.min(ie,Vt-lt),De=Math.max(De,Vt+lt),Oe=Math.min(Oe,ct-lt),Ve=Math.max(Ve,ct+lt)};if(N(E.cone.x,Ie-Jr+E.cone.y,E.cone.z,.04),N(E.cone.x,Ie+E.cone.y,E.cone.z,xi+.08),ge)N(0,Ie+1.55,0,.24);else{for(let Se of E.points)Se.spilled||N(Se.x,Se.y,Se.z,Qt*1.15);for(let Se of E.airborneRuns)for(let $e of Se)N($e.x,$e.y,$e.z,Qt);St.visible&&N(0,Bt+.28,0,.24)}let se=U.clientWidth,$=U.clientHeight,ye=R.current==="result";if(se&&$){let Se=Math.min(ye?1.75:ge?1.3:1.12,(he.right-he.left)*(se-36)/se/Math.max(.1,2*Math.max(Math.abs(ie),Math.abs(De))),(he.top-he.bottom)*($-34)/$/Math.max(.1,Ve-Oe));he.zoom+=(Se-he.zoom)*(Uy.matches?1:1-Math.exp(-ae/220)),he.zoom=Math.min(he.zoom,Se*1.02),he.updateProjectionMatrix();let $e=(Ve+Oe)/2+(ye?0:ge?.18:.44),qe=$e-he.position.dot(y);he.position.addScaledVector(y,qe*(Uy.matches?1:1-Math.exp(-ae/180))),he.updateMatrixWorld(!0);let lt=(he.top-he.bottom)/he.zoom/2,Vt=12/$*lt*2,ct=he.position.dot(y),At=Math.max(Ve-lt+Vt,Math.min(Oe+lt-Vt,ct));he.position.addScaledVector(y,At-ct),he.updateMatrixWorld(!0),U.dataset.sceneTopPx=((lt-Ve+At)/(lt*2)*$).toFixed(1),U.dataset.sceneBottomPx=((lt-Oe+At)/(lt*2)*$).toFixed(1)}let fe=Bt+.21,te=he.position.dot(y)+he.top/he.zoom,Ce=Math.max(5.5,(te+.6)/y.y-fe);F.scale.y=Ce,F.position.y=fe+Ce/2,E.drawCount++,U.dataset.creamPoints=String(E.points.length),U.dataset.coneFill="none",U.dataset.holding=String(E.holding),U.dataset.previewSwirl=String(ge),U.dataset.coneX=E.cone.x.toFixed(4),U.dataset.coneZ=E.cone.z.toFixed(4),U.dataset.coneY=E.cone.y.toFixed(4),U.dataset.nozzleX="0",U.dataset.nozzleZ="0",U.dataset.height=ce.toFixed(2),U.dataset.interaction="move-cone",U.dataset.creamRadius=String(Qt),U.dataset.ridgeCount="6",U.dataset.settledPoints=String(E.points.filter(Se=>Se.settled).length),U.dataset.fallingPoints=String(E.pending.length+E.drops.length),U.dataset.spilledPoints=String(E.spilledVolume.toFixed(5)),U.dataset.firstLandingMs=String(E.firstLandingMs??""),U.dataset.generatedVolume=E.generatedVolume.toFixed(5),U.dataset.landedVolume=E.landedVolume.toFixed(5),U.dataset.motionState=E.moving?"moving":"still",ne.render(Ne,he)};return de=requestAnimationFrame(Y),()=>{cancelAnimationFrame(de),oe.disconnect(),Ne.traverse(Z=>{var ae;(ae=Z.geometry)==null||ae.dispose(),Z.material&&!Array.isArray(Z.material)&&Z.material.dispose()}),le.dispose(),ne.dispose(),g.current=null}},[e.WORLD_WIDTH,e.WORLD_HEIGHT,e.CONE_TOP_Y]),(0,rt.useEffect)(()=>{let U=()=>{let ne=g.current;document.hidden&&(ne!=null&&ne.holding)&&(ne.holding=!1,ne.pointerId=null,ne.settling=ad,R.current="settling",l("settling"))};return document.addEventListener("visibilitychange",U),()=>document.removeEventListener("visibilitychange",U)},[]),(0,rt.useEffect)(()=>()=>{var U;(U=T.current)==null||U.close().catch(()=>{})},[]);let z=U=>{var ke;let ne=g.current;if(!ne||ne.pointerId!==U.pointerId||!ne.pointerLast)return;let Ne=U.clientX-ne.pointerLast.x,he=U.clientY-ne.pointerLast.y,Q=3/Math.max(1,((ke=h.current)==null?void 0:ke.clientWidth)||402);ne.pointerLast={x:U.clientX,y:U.clientY};let me=ne.target.x+(Ne*.936+he*.351)*Q,le=ne.target.z+(-Ne*.351+he*.936)*Q;ne.target=Hy(me,le);let Ae=U.currentTarget.getBoundingClientRect(),Ie=Math.max(1,Math.min(Ae.width,Ae.height)/2-12),Te=(ne.target.x*.936-ne.target.z*.351)/bs,ft=(ne.target.x*.351+ne.target.z*.936)/bs;M.current&&(M.current.style.transform=`translate(${Te*Ie}px,${ft*Ie}px)`)},L=()=>{let U=g.current;return!U||!C.current||R.current!=="ready"?!1:(TC(U,b.current),R.current="playing",l("playing"),d(!1),P("tap"),!0)},B=U=>{let ne=g.current;if(!(!ne||U.isPrimary===!1||U.button>0||ne.pointerId!==null)&&(U.preventDefault(),U.stopPropagation(),!!L())){ne.pointerId=U.pointerId,ne.pointerLast=ne.pointerOrigin={x:U.clientX,y:U.clientY};try{U.currentTarget.setPointerCapture(U.pointerId)}catch{}}},G=()=>{let U=g.current;U!=null&&U.holding&&(U.holding=!1,U.pointerId=null,U.settling=ad,R.current="settling",l("settling"),M.current&&(M.current.style.transform="translate(0px,0px)"))},q=U=>{var ne;if(((ne=g.current)==null?void 0:ne.pointerId)===U.pointerId){U.preventDefault(),U.stopPropagation(),G();try{U.currentTarget.hasPointerCapture(U.pointerId)&&U.currentTarget.releasePointerCapture(U.pointerId)}catch{}}},J=U=>{if(U.code==="Space")U.preventDefault(),U.repeat||L();else if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(U.code)){U.preventDefault();let ne=g.current;if(!ne)return;let Ne=_.current.getBoundingClientRect(),he=bC(Ne.left+Ne.width/2+(U.code==="ArrowLeft"?-50:U.code==="ArrowRight"?50:0),Ne.top+Ne.height/2+(U.code==="ArrowUp"?-50:U.code==="ArrowDown"?50:0),Ne);ne.target={x:he.x,z:he.z},M.current&&(M.current.style.transform=`translate(${he.u*he.travel}px,${he.v*he.travel}px)`)}},j=s<2?1:s<5?2:s<9?3:s<14?4:5,ue=()=>{!A||S||(v(!0),tt.playableRecordingSubmission({complete(){v(!1)},fail(){v(!1)}}))};return(0,Ee.jsxs)("main",{className:"softserve-app","data-phase":a,children:[(0,Ee.jsx)("div",{className:"serve-art",children:(0,Ee.jsx)("canvas",{ref:h,className:"softserve-canvas","aria-label":"Cono cavo in 3D sotto un erogatore di gelato fisso"})}),(0,Ee.jsx)("div",{className:"serve-flavors","aria-label":"Gusto",children:Object.keys(od).map(U=>(0,Ee.jsx)("button",{"aria-label":e[U.toUpperCase()],title:e[U.toUpperCase()],"aria-pressed":i===U,className:i===U?"selected":"",onClick:()=>{r(U),P("tap")},children:(0,Ee.jsx)("i",{style:{background:"#"+od[U].toString(16)}})},U))}),(0,Ee.jsxs)("div",{className:"serve-hud","aria-label":"Altezza",children:[(0,Ee.jsx)("b",{children:s.toFixed(1)}),(0,Ee.jsx)("span",{children:e.HEIGHT_LABEL})]}),(0,Ee.jsxs)("div",{className:"serve-controls",children:[c&&(0,Ee.jsx)("p",{className:"serve-guide",children:e.GAME_HINT}),(0,Ee.jsxs)("div",{ref:_,className:"swirl-pad",role:"button",tabIndex:0,"aria-label":"Tieni premuto e muovi il cono per creare la spirale. Rilascia per finire.",onPointerDown:B,onPointerMove:U=>{var ne;(ne=g.current)!=null&&ne.holding&&z(U)},onPointerUp:q,onPointerCancel:q,onLostPointerCapture:q,onKeyDown:J,onKeyUp:U=>{U.code==="Space"&&(U.preventDefault(),G())},onBlur:G,children:[(0,Ee.jsx)("span",{className:"pad-orbit"}),(0,Ee.jsx)("i",{ref:M,className:"pad-dot"})]})]}),a==="result"&&(0,Ee.jsxs)("div",{className:"serve-result",role:"status",children:[(0,Ee.jsx)("span",{children:e.RESULT_TITLE}),(0,Ee.jsxs)("strong",{children:[s.toFixed(1),(0,Ee.jsxs)("small",{children:[" ",e.HEIGHT_LABEL]})]}),(0,Ee.jsxs)("div",{className:"serve-stars","aria-label":j+" stelle su 5",children:["\u2605".repeat(j),(0,Ee.jsx)("i",{children:"\u2606".repeat(5-j)})]}),(0,Ee.jsxs)("p",{children:[e.BEST_LABEL," ",(0,Ee.jsxs)("b",{children:[p.toFixed(1)," ",e.HEIGHT_LABEL]})]}),(0,Ee.jsxs)("div",{className:"serve-actions",children:[(0,Ee.jsxs)("button",{onClick:O,children:[e.PLAY_AGAIN,(0,Ee.jsx)("span",{"aria-hidden":"true",children:" \u21BB"})]}),A&&(0,Ee.jsx)("button",{className:"post-play",disabled:S,onClick:ue,children:e.POST_PLAY})]})]}),f&&(0,Ee.jsx)("p",{className:"serve-error",children:f}),(0,Ee.jsx)("style",{children:`
    @font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2')}@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Bold.woff2');font-weight:700}
    *{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{background:#fff9ed;color:#44574f;font-family:Poppins,system-ui,sans-serif}.softserve-app{--control-height:180px;position:relative;width:100%;height:100%;overflow:hidden;background:#fff9ed}.serve-art{position:absolute;inset:0 0 calc(var(--control-height) + 27px);overflow:hidden}.softserve-canvas{display:block;width:100%;height:100%}.serve-hud{position:absolute;right:23px;bottom:calc(var(--control-height) + 10px);display:flex;align-items:baseline;gap:5px;pointer-events:none}.serve-hud b{font-size:29px;line-height:1.2;letter-spacing:-.8px}.serve-hud span{font-size:23px;font-weight:700}.serve-controls{position:absolute;bottom:0;left:0;right:0;height:var(--control-height);background:#e9eedd;border-top:1px solid #dfe5d6;border-radius:29px 29px 0 0;display:grid;place-items:center}.swirl-pad{position:relative;width:180px;height:180px;border-radius:50%;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;outline:none;display:grid;place-items:center}.swirl-pad:focus-visible{outline:2px solid #5c7a6d;outline-offset:-5px}.softserve-app[data-phase=playing] .swirl-pad{cursor:grabbing}.pad-orbit{width:112px;height:112px;border:2px dotted #bccab7;border-radius:50%;pointer-events:none}.pad-dot{position:absolute;left:calc(50% - 7px);top:calc(50% - 7px);width:14px;height:14px;border:3px solid #9bad9c;border-radius:50%;background:#718f7b;box-shadow:0 0 0 4px #7e9b851b;pointer-events:none}.serve-guide{position:absolute;top:12px;left:12px;right:12px;text-align:center;margin:0;font-size:15px;font-weight:700;line-height:1.4;pointer-events:none;animation:batchBreathe 2.6s ease-in-out infinite}.softserve-app[data-phase=ready] .pad-orbit{animation:orbitBreathe 2.6s ease-in-out infinite}.serve-flavors{position:absolute;left:18px;top:43%;display:flex;flex-direction:column;gap:8px;z-index:2}.serve-flavors button{display:grid;place-items:center;width:36px;height:36px;border:1px solid transparent;border-radius:50%;background:#fffc;cursor:pointer}.serve-flavors button.selected{border-color:#93a38f;background:#fff}.serve-flavors i{width:21px;height:21px;border:1px solid #b7a88c;border-radius:50%;pointer-events:none}.serve-result{position:absolute;bottom:14px;left:17px;right:17px;border-radius:23px;background:#fffef5ed;border:1px solid #e6e0ce;padding:12px 16px 14px;text-align:center;display:flex;flex-direction:column;align-items:center;box-shadow:0 12px 35px #8d78581a}.serve-result>span{font-size:14px;font-weight:700;color:#7a8377}.serve-result strong{font-size:44px;line-height:1.2;font-weight:700;letter-spacing:-1.5px}.serve-result small{font-size:19px;letter-spacing:0}.serve-stars{font-size:27px;line-height:1.15;letter-spacing:1px;color:#cba64b}.serve-stars i{font-style:normal;color:#cfcfc2}.serve-result p{font-size:11px;line-height:1.5;margin:6px 0 10px}.serve-result p b{font-size:15px;margin-left:5px}.serve-actions{display:flex;gap:8px;width:100%}.serve-actions button{flex:1;min-height:44px;padding:0 12px;border:0;border-radius:13px;background:#45665b;box-shadow:0 3px 0 #314e43;color:#fff;font:700 14px Poppins,system-ui;cursor:pointer}.serve-actions button.post-play{background:#e3e8dd;box-shadow:0 3px 0 #c7cebf;color:#44574f}.serve-actions button:active{transform:translateY(2px);box-shadow:none}.serve-actions button:disabled{opacity:.6}.serve-error{position:absolute;left:24px;right:24px;top:38%;font-size:16px;text-align:center}.softserve-app[data-phase=result] .serve-art{bottom:215px}.softserve-app[data-phase=result] .serve-controls,.softserve-app[data-phase=result] .serve-hud,.softserve-app[data-phase=result] .serve-flavors{display:none}.softserve-app[data-phase=settling] .swirl-pad{opacity:0;pointer-events:none;transition:opacity .2s}.softserve-app[data-phase=settling] .serve-flavors{pointer-events:none}[data-feed-preview=true] .serve-art{top:108px;bottom:82px}[data-feed-preview=true] .serve-controls{display:contents}[data-feed-preview=true] .serve-guide{top:19%;left:20px;right:20px;font-size:20px;line-height:1.35;font-weight:700}[data-feed-preview=true] .serve-hud,[data-feed-preview=true] .serve-flavors,[data-feed-preview=true] .swirl-pad{display:none}@keyframes orbitBreathe{50%{opacity:.45;transform:scale(1.04)}}@media(max-height:540px){.softserve-app{--control-height:150px}.swirl-pad{width:150px;height:150px}.pad-orbit{width:96px;height:96px}.serve-guide{top:6px;font-size:13px}.serve-hud b{font-size:26px}.serve-hud span{font-size:20px}.serve-result{bottom:9px;padding:8px 12px 11px}.serve-result strong{font-size:38px}.softserve-app[data-phase=result] .serve-art{bottom:195px}}@media(prefers-reduced-motion:reduce){.serve-guide,.pad-orbit{animation:none!important}.swirl-pad{transition:none!important}}
    `})]})}(0,By.createRoot)(document.getElementById("root")).render((0,Ee.jsxs)(Ee.Fragment,{children:[(0,Ee.jsx)("style",{children:SC}),(0,Ee.jsxs)(Ee.Fragment,{children:[(0,Ee.jsx)(DC,{}),(0,Ee.jsx)(MC,{})]})]}));(()=>{let t=document.createElement("style");t.textContent=".serve-art{top:0;bottom:116px}.serve-hud{top:24px;right:24px;bottom:auto;z-index:3;color:#334e49}.serve-controls{left:auto;right:12px;bottom:8px;width:174px;height:174px;display:grid;place-items:center;border:0;border-radius:0;background:transparent}.swirl-pad{width:174px;height:174px;background:#e9ede14d;border:1px solid #bdcbb655;box-shadow:none}.serve-guide{position:fixed;top:36%;left:24px;right:24px;font-size:18px;color:#334e49}.serve-flavors{top:46%;left:18px}.serve-hud b{font-size:28px}.serve-hud span{font-size:19px}[data-feed-preview=true] .serve-art{top:145px;bottom:102px}[data-feed-preview=true] .serve-controls{display:contents}[data-feed-preview=true] .serve-guide{top:26%;font-size:20px}.softserve-app[data-phase=result] .serve-art{top:24px;bottom:215px}@media(max-height:540px){.serve-art{top:0;bottom:100px}.serve-controls{right:5px;bottom:2px;width:150px;height:150px}.swirl-pad{width:150px;height:150px}.serve-guide{top:36%}}",document.body.append(t)})();(()=>{var u;let t=[".serve-guide"],e=new Set(["Tieni premuto e gira"].map(p=>p.replace(/\s+/g," ").trim().toLowerCase())),n=window.matchMedia("(prefers-reduced-motion: reduce)"),i=new Map,r=!1,s=!0,o=/^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;function a(){r=!1;for(let[x,S]of i)x.isConnected||(S.cancel(),i.delete(x));if(n.matches){for(let x of i.values())x.cancel();i.clear();return}let p=new Set;for(let x of t)try{document.querySelectorAll(x).forEach(S=>p.add(S))}catch{}for(let x of document.querySelectorAll("p,span,div,label,text")){if(x.children.length||x.closest('button,a,input,select,textarea,[role="button"]'))continue;let S=(x.textContent||"").replace(/\s+/g," ").trim();S.length>=5&&S.length<=140&&(e.has(S.toLowerCase())||!t.length&&o.test(S))&&p.add(x)}for(let x of p){if(i.has(x)||typeof x.animate!="function"||[...p].some(_=>_!==x&&x.contains(_)))continue;let S=getComputedStyle(x);if(/breath/i.test(S.animationName))continue;let v=S.filter.replace(/opacity\([^)]*\)/g,"").replace(/^none$/,"").trim(),h=_=>(v?v+" ":"")+"opacity("+_+")",g=x.animate([{filter:h(1)},{filter:h(.65)},{filter:h(1)}],{duration:2400,iterations:1/0,easing:"ease-in-out"});i.set(x,g),(document.hidden||!s)&&g.pause()}}let l=()=>{r||(r=!0,requestAnimationFrame(a))},c=()=>{for(let p of i.values())document.hidden||!s?p.pause():p.play()},d=new MutationObserver(l);d.observe(document.documentElement,{childList:!0,subtree:!0,characterData:!0});let f=typeof IntersectionObserver=="function"?new IntersectionObserver(p=>{s=p.some(x=>x.isIntersecting),c()}):null;document.body?f==null||f.observe(document.body):document.addEventListener("DOMContentLoaded",()=>f==null?void 0:f.observe(document.body),{once:!0}),document.addEventListener("visibilitychange",c),(u=n.addEventListener)==null||u.call(n,"change",l),l(),window.addEventListener("pagehide",()=>{d.disconnect(),f==null||f.disconnect();for(let p of i.values())p.cancel();i.clear()},{once:!0})})();function UC(t,e,n=90){!e||document.hidden||!window.SFX||(window.SFX.register({[t]:e}),window.SFX.unlock(),window.SFX.play(t,{minGapMs:n}))}})();
