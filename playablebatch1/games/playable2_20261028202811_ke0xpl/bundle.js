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

(()=>{var iS=Object.create;var hg=Object.defineProperty;var rS=Object.getOwnPropertyDescriptor;var sS=Object.getOwnPropertyNames;var oS=Object.getPrototypeOf,aS=Object.prototype.hasOwnProperty;var di=(n,e)=>()=>(e||n((e={exports:{}}).exports,e),e.exports);var lS=(n,e,t,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of sS(e))!aS.call(n,r)&&r!==t&&hg(n,r,{get:()=>e[r],enumerable:!(i=rS(e,r))||i.enumerable});return n};var Co=(n,e,t)=>(t=n!=null?iS(oS(n)):{},lS(e||!n||!n.__esModule?hg(t,"default",{value:n,enumerable:!0}):t,n));var wg=di(je=>{"use strict";var Ro=Symbol.for("react.element"),cS=Symbol.for("react.portal"),uS=Symbol.for("react.fragment"),hS=Symbol.for("react.strict_mode"),fS=Symbol.for("react.profiler"),dS=Symbol.for("react.provider"),pS=Symbol.for("react.context"),mS=Symbol.for("react.forward_ref"),gS=Symbol.for("react.suspense"),vS=Symbol.for("react.memo"),xS=Symbol.for("react.lazy"),fg=Symbol.iterator;function yS(n){return n===null||typeof n!="object"?null:(n=fg&&n[fg]||n["@@iterator"],typeof n=="function"?n:null)}var mg={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},gg=Object.assign,vg={};function ys(n,e,t){this.props=n,this.context=e,this.refs=vg,this.updater=t||mg}ys.prototype.isReactComponent={};ys.prototype.setState=function(n,e){if(typeof n!="object"&&typeof n!="function"&&n!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,n,e,"setState")};ys.prototype.forceUpdate=function(n){this.updater.enqueueForceUpdate(this,n,"forceUpdate")};function xg(){}xg.prototype=ys.prototype;function tf(n,e,t){this.props=n,this.context=e,this.refs=vg,this.updater=t||mg}var nf=tf.prototype=new xg;nf.constructor=tf;gg(nf,ys.prototype);nf.isPureReactComponent=!0;var dg=Array.isArray,yg=Object.prototype.hasOwnProperty,rf={current:null},_g={key:!0,ref:!0,__self:!0,__source:!0};function Sg(n,e,t){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)yg.call(e,i)&&!_g.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=t;else if(1<a){for(var l=Array(a),u=0;u<a;u++)l[u]=arguments[u+2];r.children=l}if(n&&n.defaultProps)for(i in a=n.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:Ro,type:n,key:s,ref:o,props:r,_owner:rf.current}}function _S(n,e){return{$$typeof:Ro,type:n.type,key:e,ref:n.ref,props:n.props,_owner:n._owner}}function sf(n){return typeof n=="object"&&n!==null&&n.$$typeof===Ro}function SS(n){var e={"=":"=0",":":"=2"};return"$"+n.replace(/[=:]/g,function(t){return e[t]})}var pg=/\/+/g;function ef(n,e){return typeof n=="object"&&n!==null&&n.key!=null?SS(""+n.key):e.toString(36)}function _l(n,e,t,i,r){var s=typeof n;(s==="undefined"||s==="boolean")&&(n=null);var o=!1;if(n===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(n.$$typeof){case Ro:case cS:o=!0}}if(o)return o=n,r=r(o),n=i===""?"."+ef(o,0):i,dg(r)?(t="",n!=null&&(t=n.replace(pg,"$&/")+"/"),_l(r,e,t,"",function(u){return u})):r!=null&&(sf(r)&&(r=_S(r,t+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(pg,"$&/")+"/")+n)),e.push(r)),1;if(o=0,i=i===""?".":i+":",dg(n))for(var a=0;a<n.length;a++){s=n[a];var l=i+ef(s,a);o+=_l(s,e,t,l,r)}else if(l=yS(n),typeof l=="function")for(n=l.call(n),a=0;!(s=n.next()).done;)s=s.value,l=i+ef(s,a++),o+=_l(s,e,t,l,r);else if(s==="object")throw e=String(n),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(n).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function yl(n,e,t){if(n==null)return n;var i=[],r=0;return _l(n,i,"","",function(s){return e.call(t,s,r++)}),i}function MS(n){if(n._status===-1){var e=n._result;e=e(),e.then(function(t){(n._status===0||n._status===-1)&&(n._status=1,n._result=t)},function(t){(n._status===0||n._status===-1)&&(n._status=2,n._result=t)}),n._status===-1&&(n._status=0,n._result=e)}if(n._status===1)return n._result.default;throw n._result}var cn={current:null},Sl={transition:null},wS={ReactCurrentDispatcher:cn,ReactCurrentBatchConfig:Sl,ReactCurrentOwner:rf};function Mg(){throw Error("act(...) is not supported in production builds of React.")}je.Children={map:yl,forEach:function(n,e,t){yl(n,function(){e.apply(this,arguments)},t)},count:function(n){var e=0;return yl(n,function(){e++}),e},toArray:function(n){return yl(n,function(e){return e})||[]},only:function(n){if(!sf(n))throw Error("React.Children.only expected to receive a single React element child.");return n}};je.Component=ys;je.Fragment=uS;je.Profiler=fS;je.PureComponent=tf;je.StrictMode=hS;je.Suspense=gS;je.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=wS;je.act=Mg;je.cloneElement=function(n,e,t){if(n==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+n+".");var i=gg({},n.props),r=n.key,s=n.ref,o=n._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=rf.current),e.key!==void 0&&(r=""+e.key),n.type&&n.type.defaultProps)var a=n.type.defaultProps;for(l in e)yg.call(e,l)&&!_g.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=t;else if(1<l){a=Array(l);for(var u=0;u<l;u++)a[u]=arguments[u+2];i.children=a}return{$$typeof:Ro,type:n.type,key:r,ref:s,props:i,_owner:o}};je.createContext=function(n){return n={$$typeof:pS,_currentValue:n,_currentValue2:n,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},n.Provider={$$typeof:dS,_context:n},n.Consumer=n};je.createElement=Sg;je.createFactory=function(n){var e=Sg.bind(null,n);return e.type=n,e};je.createRef=function(){return{current:null}};je.forwardRef=function(n){return{$$typeof:mS,render:n}};je.isValidElement=sf;je.lazy=function(n){return{$$typeof:xS,_payload:{_status:-1,_result:n},_init:MS}};je.memo=function(n,e){return{$$typeof:vS,type:n,compare:e===void 0?null:e}};je.startTransition=function(n){var e=Sl.transition;Sl.transition={};try{n()}finally{Sl.transition=e}};je.unstable_act=Mg;je.useCallback=function(n,e){return cn.current.useCallback(n,e)};je.useContext=function(n){return cn.current.useContext(n)};je.useDebugValue=function(){};je.useDeferredValue=function(n){return cn.current.useDeferredValue(n)};je.useEffect=function(n,e){return cn.current.useEffect(n,e)};je.useId=function(){return cn.current.useId()};je.useImperativeHandle=function(n,e,t){return cn.current.useImperativeHandle(n,e,t)};je.useInsertionEffect=function(n,e){return cn.current.useInsertionEffect(n,e)};je.useLayoutEffect=function(n,e){return cn.current.useLayoutEffect(n,e)};je.useMemo=function(n,e){return cn.current.useMemo(n,e)};je.useReducer=function(n,e,t){return cn.current.useReducer(n,e,t)};je.useRef=function(n){return cn.current.useRef(n)};je.useState=function(n){return cn.current.useState(n)};je.useSyncExternalStore=function(n,e,t){return cn.current.useSyncExternalStore(n,e,t)};je.useTransition=function(){return cn.current.useTransition()};je.version="18.3.1"});var Ml=di((YC,Eg)=>{"use strict";Eg.exports=wg()});var Ng=di(gt=>{"use strict";function cf(n,e){var t=n.length;n.push(e);e:for(;0<t;){var i=t-1>>>1,r=n[i];if(0<wl(r,e))n[i]=e,n[t]=r,t=i;else break e}}function Jn(n){return n.length===0?null:n[0]}function Tl(n){if(n.length===0)return null;var e=n[0],t=n.pop();if(t!==e){n[0]=t;e:for(var i=0,r=n.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=n[o],l=o+1,u=n[l];if(0>wl(a,t))l<r&&0>wl(u,a)?(n[i]=u,n[l]=t,i=l):(n[i]=a,n[o]=t,i=o);else if(l<r&&0>wl(u,t))n[i]=u,n[l]=t,i=l;else break e}}return e}function wl(n,e){var t=n.sortIndex-e.sortIndex;return t!==0?t:n.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(Tg=performance,gt.unstable_now=function(){return Tg.now()}):(of=Date,Ag=of.now(),gt.unstable_now=function(){return of.now()-Ag});var Tg,of,Ag,pi=[],nr=[],ES=1,zn=null,jt=3,Al=!1,Gr=!1,Io=!1,Rg=typeof setTimeout=="function"?setTimeout:null,Pg=typeof clearTimeout=="function"?clearTimeout:null,bg=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function uf(n){for(var e=Jn(nr);e!==null;){if(e.callback===null)Tl(nr);else if(e.startTime<=n)Tl(nr),e.sortIndex=e.expirationTime,cf(pi,e);else break;e=Jn(nr)}}function hf(n){if(Io=!1,uf(n),!Gr)if(Jn(pi)!==null)Gr=!0,df(ff);else{var e=Jn(nr);e!==null&&pf(hf,e.startTime-n)}}function ff(n,e){Gr=!1,Io&&(Io=!1,Pg(Lo),Lo=-1),Al=!0;var t=jt;try{for(uf(e),zn=Jn(pi);zn!==null&&(!(zn.expirationTime>e)||n&&!Dg());){var i=zn.callback;if(typeof i=="function"){zn.callback=null,jt=zn.priorityLevel;var r=i(zn.expirationTime<=e);e=gt.unstable_now(),typeof r=="function"?zn.callback=r:zn===Jn(pi)&&Tl(pi),uf(e)}else Tl(pi);zn=Jn(pi)}if(zn!==null)var s=!0;else{var o=Jn(nr);o!==null&&pf(hf,o.startTime-e),s=!1}return s}finally{zn=null,jt=t,Al=!1}}var bl=!1,El=null,Lo=-1,Ig=5,Lg=-1;function Dg(){return!(gt.unstable_now()-Lg<Ig)}function af(){if(El!==null){var n=gt.unstable_now();Lg=n;var e=!0;try{e=El(!0,n)}finally{e?Po():(bl=!1,El=null)}}else bl=!1}var Po;typeof bg=="function"?Po=function(){bg(af)}:typeof MessageChannel<"u"?(lf=new MessageChannel,Cg=lf.port2,lf.port1.onmessage=af,Po=function(){Cg.postMessage(null)}):Po=function(){Rg(af,0)};var lf,Cg;function df(n){El=n,bl||(bl=!0,Po())}function pf(n,e){Lo=Rg(function(){n(gt.unstable_now())},e)}gt.unstable_IdlePriority=5;gt.unstable_ImmediatePriority=1;gt.unstable_LowPriority=4;gt.unstable_NormalPriority=3;gt.unstable_Profiling=null;gt.unstable_UserBlockingPriority=2;gt.unstable_cancelCallback=function(n){n.callback=null};gt.unstable_continueExecution=function(){Gr||Al||(Gr=!0,df(ff))};gt.unstable_forceFrameRate=function(n){0>n||125<n?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):Ig=0<n?Math.floor(1e3/n):5};gt.unstable_getCurrentPriorityLevel=function(){return jt};gt.unstable_getFirstCallbackNode=function(){return Jn(pi)};gt.unstable_next=function(n){switch(jt){case 1:case 2:case 3:var e=3;break;default:e=jt}var t=jt;jt=e;try{return n()}finally{jt=t}};gt.unstable_pauseExecution=function(){};gt.unstable_requestPaint=function(){};gt.unstable_runWithPriority=function(n,e){switch(n){case 1:case 2:case 3:case 4:case 5:break;default:n=3}var t=jt;jt=n;try{return e()}finally{jt=t}};gt.unstable_scheduleCallback=function(n,e,t){var i=gt.unstable_now();switch(typeof t=="object"&&t!==null?(t=t.delay,t=typeof t=="number"&&0<t?i+t:i):t=i,n){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=t+r,n={id:ES++,callback:e,priorityLevel:n,startTime:t,expirationTime:r,sortIndex:-1},t>i?(n.sortIndex=t,cf(nr,n),Jn(pi)===null&&n===Jn(nr)&&(Io?(Pg(Lo),Lo=-1):Io=!0,pf(hf,t-i))):(n.sortIndex=r,cf(pi,n),Gr||Al||(Gr=!0,df(ff))),n};gt.unstable_shouldYield=Dg;gt.unstable_wrapCallback=function(n){var e=jt;return function(){var t=jt;jt=e;try{return n.apply(this,arguments)}finally{jt=t}}}});var Fg=di((ZC,Ug)=>{"use strict";Ug.exports=Ng()});var zx=di(Pn=>{"use strict";var TS=Ml(),Cn=Fg();function ce(n){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+n,t=1;t<arguments.length;t++)e+="&args[]="+encodeURIComponent(arguments[t]);return"Minified React error #"+n+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var H0=new Set,ea={};function ts(n,e){zs(n,e),zs(n+"Capture",e)}function zs(n,e){for(ea[n]=e,n=0;n<e.length;n++)H0.add(e[n])}var Fi=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),Of=Object.prototype.hasOwnProperty,AS=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,Og={},Bg={};function bS(n){return Of.call(Bg,n)?!0:Of.call(Og,n)?!1:AS.test(n)?Bg[n]=!0:(Og[n]=!0,!1)}function CS(n,e,t,i){if(t!==null&&t.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:t!==null?!t.acceptsBooleans:(n=n.toLowerCase().slice(0,5),n!=="data-"&&n!=="aria-");default:return!1}}function RS(n,e,t,i){if(e===null||typeof e>"u"||CS(n,e,t,i))return!0;if(i)return!1;if(t!==null)switch(t.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function fn(n,e,t,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=t,this.propertyName=n,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var Zt={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(n){Zt[n]=new fn(n,0,!1,n,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(n){var e=n[0];Zt[e]=new fn(e,1,!1,n[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(n){Zt[n]=new fn(n,2,!1,n.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(n){Zt[n]=new fn(n,2,!1,n,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(n){Zt[n]=new fn(n,3,!1,n.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(n){Zt[n]=new fn(n,3,!0,n,null,!1,!1)});["capture","download"].forEach(function(n){Zt[n]=new fn(n,4,!1,n,null,!1,!1)});["cols","rows","size","span"].forEach(function(n){Zt[n]=new fn(n,6,!1,n,null,!1,!1)});["rowSpan","start"].forEach(function(n){Zt[n]=new fn(n,5,!1,n.toLowerCase(),null,!1,!1)});var Rd=/[\-:]([a-z])/g;function Pd(n){return n[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(n){var e=n.replace(Rd,Pd);Zt[e]=new fn(e,1,!1,n,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(n){var e=n.replace(Rd,Pd);Zt[e]=new fn(e,1,!1,n,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(n){var e=n.replace(Rd,Pd);Zt[e]=new fn(e,1,!1,n,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(n){Zt[n]=new fn(n,1,!1,n.toLowerCase(),null,!1,!1)});Zt.xlinkHref=new fn("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(n){Zt[n]=new fn(n,1,!1,n.toLowerCase(),null,!0,!0)});function Id(n,e,t,i){var r=Zt.hasOwnProperty(e)?Zt[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(RS(e,t,r,i)&&(t=null),i||r===null?bS(e)&&(t===null?n.removeAttribute(e):n.setAttribute(e,""+t)):r.mustUseProperty?n[r.propertyName]=t===null?r.type===3?!1:"":t:(e=r.attributeName,i=r.attributeNamespace,t===null?n.removeAttribute(e):(r=r.type,t=r===3||r===4&&t===!0?"":""+t,i?n.setAttributeNS(i,e,t):n.setAttribute(e,t))))}var zi=TS.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,Cl=Symbol.for("react.element"),Ms=Symbol.for("react.portal"),ws=Symbol.for("react.fragment"),Ld=Symbol.for("react.strict_mode"),Bf=Symbol.for("react.profiler"),W0=Symbol.for("react.provider"),X0=Symbol.for("react.context"),Dd=Symbol.for("react.forward_ref"),kf=Symbol.for("react.suspense"),zf=Symbol.for("react.suspense_list"),Nd=Symbol.for("react.memo"),rr=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var Y0=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var kg=Symbol.iterator;function Do(n){return n===null||typeof n!="object"?null:(n=kg&&n[kg]||n["@@iterator"],typeof n=="function"?n:null)}var Tt=Object.assign,mf;function Vo(n){if(mf===void 0)try{throw Error()}catch(t){var e=t.stack.trim().match(/\n( *(at )?)/);mf=e&&e[1]||""}return`
`+mf+n}var gf=!1;function vf(n,e){if(!n||gf)return"";gf=!0;var t=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(u){var i=u}Reflect.construct(n,[],e)}else{try{e.call()}catch(u){i=u}n.call(e.prototype)}else{try{throw Error()}catch(u){i=u}n()}}catch(u){if(u&&i&&typeof u.stack=="string"){for(var r=u.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return n.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",n.displayName)),l}while(1<=o&&0<=a);break}}}finally{gf=!1,Error.prepareStackTrace=t}return(n=n?n.displayName||n.name:"")?Vo(n):""}function PS(n){switch(n.tag){case 5:return Vo(n.type);case 16:return Vo("Lazy");case 13:return Vo("Suspense");case 19:return Vo("SuspenseList");case 0:case 2:case 15:return n=vf(n.type,!1),n;case 11:return n=vf(n.type.render,!1),n;case 1:return n=vf(n.type,!0),n;default:return""}}function Vf(n){if(n==null)return null;if(typeof n=="function")return n.displayName||n.name||null;if(typeof n=="string")return n;switch(n){case ws:return"Fragment";case Ms:return"Portal";case Bf:return"Profiler";case Ld:return"StrictMode";case kf:return"Suspense";case zf:return"SuspenseList"}if(typeof n=="object")switch(n.$$typeof){case X0:return(n.displayName||"Context")+".Consumer";case W0:return(n._context.displayName||"Context")+".Provider";case Dd:var e=n.render;return n=n.displayName,n||(n=e.displayName||e.name||"",n=n!==""?"ForwardRef("+n+")":"ForwardRef"),n;case Nd:return e=n.displayName||null,e!==null?e:Vf(n.type)||"Memo";case rr:e=n._payload,n=n._init;try{return Vf(n(e))}catch{}}return null}function IS(n){var e=n.type;switch(n.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return n=e.render,n=n.displayName||n.name||"",e.displayName||(n!==""?"ForwardRef("+n+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return Vf(e);case 8:return e===Ld?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function xr(n){switch(typeof n){case"boolean":case"number":case"string":case"undefined":return n;case"object":return n;default:return""}}function q0(n){var e=n.type;return(n=n.nodeName)&&n.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function LS(n){var e=q0(n)?"checked":"value",t=Object.getOwnPropertyDescriptor(n.constructor.prototype,e),i=""+n[e];if(!n.hasOwnProperty(e)&&typeof t<"u"&&typeof t.get=="function"&&typeof t.set=="function"){var r=t.get,s=t.set;return Object.defineProperty(n,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(n,e,{enumerable:t.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){n._valueTracker=null,delete n[e]}}}}function Rl(n){n._valueTracker||(n._valueTracker=LS(n))}function Z0(n){if(!n)return!1;var e=n._valueTracker;if(!e)return!0;var t=e.getValue(),i="";return n&&(i=q0(n)?n.checked?"true":"false":n.value),n=i,n!==t?(e.setValue(n),!0):!1}function ic(n){if(n=n||(typeof document<"u"?document:void 0),typeof n>"u")return null;try{return n.activeElement||n.body}catch{return n.body}}function Gf(n,e){var t=e.checked;return Tt({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:t??n._wrapperState.initialChecked})}function zg(n,e){var t=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;t=xr(e.value!=null?e.value:t),n._wrapperState={initialChecked:i,initialValue:t,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function $0(n,e){e=e.checked,e!=null&&Id(n,"checked",e,!1)}function Hf(n,e){$0(n,e);var t=xr(e.value),i=e.type;if(t!=null)i==="number"?(t===0&&n.value===""||n.value!=t)&&(n.value=""+t):n.value!==""+t&&(n.value=""+t);else if(i==="submit"||i==="reset"){n.removeAttribute("value");return}e.hasOwnProperty("value")?Wf(n,e.type,t):e.hasOwnProperty("defaultValue")&&Wf(n,e.type,xr(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(n.defaultChecked=!!e.defaultChecked)}function Vg(n,e,t){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+n._wrapperState.initialValue,t||e===n.value||(n.value=e),n.defaultValue=e}t=n.name,t!==""&&(n.name=""),n.defaultChecked=!!n._wrapperState.initialChecked,t!==""&&(n.name=t)}function Wf(n,e,t){(e!=="number"||ic(n.ownerDocument)!==n)&&(t==null?n.defaultValue=""+n._wrapperState.initialValue:n.defaultValue!==""+t&&(n.defaultValue=""+t))}var Go=Array.isArray;function Ns(n,e,t,i){if(n=n.options,e){e={};for(var r=0;r<t.length;r++)e["$"+t[r]]=!0;for(t=0;t<n.length;t++)r=e.hasOwnProperty("$"+n[t].value),n[t].selected!==r&&(n[t].selected=r),r&&i&&(n[t].defaultSelected=!0)}else{for(t=""+xr(t),e=null,r=0;r<n.length;r++){if(n[r].value===t){n[r].selected=!0,i&&(n[r].defaultSelected=!0);return}e!==null||n[r].disabled||(e=n[r])}e!==null&&(e.selected=!0)}}function Xf(n,e){if(e.dangerouslySetInnerHTML!=null)throw Error(ce(91));return Tt({},e,{value:void 0,defaultValue:void 0,children:""+n._wrapperState.initialValue})}function Gg(n,e){var t=e.value;if(t==null){if(t=e.children,e=e.defaultValue,t!=null){if(e!=null)throw Error(ce(92));if(Go(t)){if(1<t.length)throw Error(ce(93));t=t[0]}e=t}e==null&&(e=""),t=e}n._wrapperState={initialValue:xr(t)}}function J0(n,e){var t=xr(e.value),i=xr(e.defaultValue);t!=null&&(t=""+t,t!==n.value&&(n.value=t),e.defaultValue==null&&n.defaultValue!==t&&(n.defaultValue=t)),i!=null&&(n.defaultValue=""+i)}function Hg(n){var e=n.textContent;e===n._wrapperState.initialValue&&e!==""&&e!==null&&(n.value=e)}function K0(n){switch(n){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function Yf(n,e){return n==null||n==="http://www.w3.org/1999/xhtml"?K0(e):n==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":n}var Pl,j0=function(n){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,t,i,r){MSApp.execUnsafeLocalFunction(function(){return n(e,t,i,r)})}:n}(function(n,e){if(n.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in n)n.innerHTML=e;else{for(Pl=Pl||document.createElement("div"),Pl.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=Pl.firstChild;n.firstChild;)n.removeChild(n.firstChild);for(;e.firstChild;)n.appendChild(e.firstChild)}});function ta(n,e){if(e){var t=n.firstChild;if(t&&t===n.lastChild&&t.nodeType===3){t.nodeValue=e;return}}n.textContent=e}var Xo={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},DS=["Webkit","ms","Moz","O"];Object.keys(Xo).forEach(function(n){DS.forEach(function(e){e=e+n.charAt(0).toUpperCase()+n.substring(1),Xo[e]=Xo[n]})});function Q0(n,e,t){return e==null||typeof e=="boolean"||e===""?"":t||typeof e!="number"||e===0||Xo.hasOwnProperty(n)&&Xo[n]?(""+e).trim():e+"px"}function ev(n,e){n=n.style;for(var t in e)if(e.hasOwnProperty(t)){var i=t.indexOf("--")===0,r=Q0(t,e[t],i);t==="float"&&(t="cssFloat"),i?n.setProperty(t,r):n[t]=r}}var NS=Tt({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function qf(n,e){if(e){if(NS[n]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(ce(137,n));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(ce(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(ce(61))}if(e.style!=null&&typeof e.style!="object")throw Error(ce(62))}}function Zf(n,e){if(n.indexOf("-")===-1)return typeof e.is=="string";switch(n){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var $f=null;function Ud(n){return n=n.target||n.srcElement||window,n.correspondingUseElement&&(n=n.correspondingUseElement),n.nodeType===3?n.parentNode:n}var Jf=null,Us=null,Fs=null;function Wg(n){if(n=ya(n)){if(typeof Jf!="function")throw Error(ce(280));var e=n.stateNode;e&&(e=Ic(e),Jf(n.stateNode,n.type,e))}}function tv(n){Us?Fs?Fs.push(n):Fs=[n]:Us=n}function nv(){if(Us){var n=Us,e=Fs;if(Fs=Us=null,Wg(n),e)for(n=0;n<e.length;n++)Wg(e[n])}}function iv(n,e){return n(e)}function rv(){}var xf=!1;function sv(n,e,t){if(xf)return n(e,t);xf=!0;try{return iv(n,e,t)}finally{xf=!1,(Us!==null||Fs!==null)&&(rv(),nv())}}function na(n,e){var t=n.stateNode;if(t===null)return null;var i=Ic(t);if(i===null)return null;t=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(n=n.type,i=!(n==="button"||n==="input"||n==="select"||n==="textarea")),n=!i;break e;default:n=!1}if(n)return null;if(t&&typeof t!="function")throw Error(ce(231,e,typeof t));return t}var Kf=!1;if(Fi)try{_s={},Object.defineProperty(_s,"passive",{get:function(){Kf=!0}}),window.addEventListener("test",_s,_s),window.removeEventListener("test",_s,_s)}catch{Kf=!1}var _s;function US(n,e,t,i,r,s,o,a,l){var u=Array.prototype.slice.call(arguments,3);try{e.apply(t,u)}catch(f){this.onError(f)}}var Yo=!1,rc=null,sc=!1,jf=null,FS={onError:function(n){Yo=!0,rc=n}};function OS(n,e,t,i,r,s,o,a,l){Yo=!1,rc=null,US.apply(FS,arguments)}function BS(n,e,t,i,r,s,o,a,l){if(OS.apply(this,arguments),Yo){if(Yo){var u=rc;Yo=!1,rc=null}else throw Error(ce(198));sc||(sc=!0,jf=u)}}function ns(n){var e=n,t=n;if(n.alternate)for(;e.return;)e=e.return;else{n=e;do e=n,e.flags&4098&&(t=e.return),n=e.return;while(n)}return e.tag===3?t:null}function ov(n){if(n.tag===13){var e=n.memoizedState;if(e===null&&(n=n.alternate,n!==null&&(e=n.memoizedState)),e!==null)return e.dehydrated}return null}function Xg(n){if(ns(n)!==n)throw Error(ce(188))}function kS(n){var e=n.alternate;if(!e){if(e=ns(n),e===null)throw Error(ce(188));return e!==n?null:n}for(var t=n,i=e;;){var r=t.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){t=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===t)return Xg(r),n;if(s===i)return Xg(r),e;s=s.sibling}throw Error(ce(188))}if(t.return!==i.return)t=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===t){o=!0,t=r,i=s;break}if(a===i){o=!0,i=r,t=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===t){o=!0,t=s,i=r;break}if(a===i){o=!0,i=s,t=r;break}a=a.sibling}if(!o)throw Error(ce(189))}}if(t.alternate!==i)throw Error(ce(190))}if(t.tag!==3)throw Error(ce(188));return t.stateNode.current===t?n:e}function av(n){return n=kS(n),n!==null?lv(n):null}function lv(n){if(n.tag===5||n.tag===6)return n;for(n=n.child;n!==null;){var e=lv(n);if(e!==null)return e;n=n.sibling}return null}var cv=Cn.unstable_scheduleCallback,Yg=Cn.unstable_cancelCallback,zS=Cn.unstable_shouldYield,VS=Cn.unstable_requestPaint,Nt=Cn.unstable_now,GS=Cn.unstable_getCurrentPriorityLevel,Fd=Cn.unstable_ImmediatePriority,uv=Cn.unstable_UserBlockingPriority,oc=Cn.unstable_NormalPriority,HS=Cn.unstable_LowPriority,hv=Cn.unstable_IdlePriority,bc=null,xi=null;function WS(n){if(xi&&typeof xi.onCommitFiberRoot=="function")try{xi.onCommitFiberRoot(bc,n,void 0,(n.current.flags&128)===128)}catch{}}var ti=Math.clz32?Math.clz32:qS,XS=Math.log,YS=Math.LN2;function qS(n){return n>>>=0,n===0?32:31-(XS(n)/YS|0)|0}var Il=64,Ll=4194304;function Ho(n){switch(n&-n){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return n&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return n&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return n}}function ac(n,e){var t=n.pendingLanes;if(t===0)return 0;var i=0,r=n.suspendedLanes,s=n.pingedLanes,o=t&268435455;if(o!==0){var a=o&~r;a!==0?i=Ho(a):(s&=o,s!==0&&(i=Ho(s)))}else o=t&~r,o!==0?i=Ho(o):s!==0&&(i=Ho(s));if(i===0)return 0;if(e!==0&&e!==i&&!(e&r)&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if(i&4&&(i|=t&16),e=n.entangledLanes,e!==0)for(n=n.entanglements,e&=i;0<e;)t=31-ti(e),r=1<<t,i|=n[t],e&=~r;return i}function ZS(n,e){switch(n){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function $S(n,e){for(var t=n.suspendedLanes,i=n.pingedLanes,r=n.expirationTimes,s=n.pendingLanes;0<s;){var o=31-ti(s),a=1<<o,l=r[o];l===-1?(!(a&t)||a&i)&&(r[o]=ZS(a,e)):l<=e&&(n.expiredLanes|=a),s&=~a}}function Qf(n){return n=n.pendingLanes&-1073741825,n!==0?n:n&1073741824?1073741824:0}function fv(){var n=Il;return Il<<=1,!(Il&4194240)&&(Il=64),n}function yf(n){for(var e=[],t=0;31>t;t++)e.push(n);return e}function va(n,e,t){n.pendingLanes|=e,e!==536870912&&(n.suspendedLanes=0,n.pingedLanes=0),n=n.eventTimes,e=31-ti(e),n[e]=t}function JS(n,e){var t=n.pendingLanes&~e;n.pendingLanes=e,n.suspendedLanes=0,n.pingedLanes=0,n.expiredLanes&=e,n.mutableReadLanes&=e,n.entangledLanes&=e,e=n.entanglements;var i=n.eventTimes;for(n=n.expirationTimes;0<t;){var r=31-ti(t),s=1<<r;e[r]=0,i[r]=-1,n[r]=-1,t&=~s}}function Od(n,e){var t=n.entangledLanes|=e;for(n=n.entanglements;t;){var i=31-ti(t),r=1<<i;r&e|n[i]&e&&(n[i]|=e),t&=~r}}var ct=0;function dv(n){return n&=-n,1<n?4<n?n&268435455?16:536870912:4:1}var pv,Bd,mv,gv,vv,ed=!1,Dl=[],ur=null,hr=null,fr=null,ia=new Map,ra=new Map,or=[],KS="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function qg(n,e){switch(n){case"focusin":case"focusout":ur=null;break;case"dragenter":case"dragleave":hr=null;break;case"mouseover":case"mouseout":fr=null;break;case"pointerover":case"pointerout":ia.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":ra.delete(e.pointerId)}}function No(n,e,t,i,r,s){return n===null||n.nativeEvent!==s?(n={blockedOn:e,domEventName:t,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=ya(e),e!==null&&Bd(e)),n):(n.eventSystemFlags|=i,e=n.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),n)}function jS(n,e,t,i,r){switch(e){case"focusin":return ur=No(ur,n,e,t,i,r),!0;case"dragenter":return hr=No(hr,n,e,t,i,r),!0;case"mouseover":return fr=No(fr,n,e,t,i,r),!0;case"pointerover":var s=r.pointerId;return ia.set(s,No(ia.get(s)||null,n,e,t,i,r)),!0;case"gotpointercapture":return s=r.pointerId,ra.set(s,No(ra.get(s)||null,n,e,t,i,r)),!0}return!1}function xv(n){var e=Xr(n.target);if(e!==null){var t=ns(e);if(t!==null){if(e=t.tag,e===13){if(e=ov(t),e!==null){n.blockedOn=e,vv(n.priority,function(){mv(t)});return}}else if(e===3&&t.stateNode.current.memoizedState.isDehydrated){n.blockedOn=t.tag===3?t.stateNode.containerInfo:null;return}}}n.blockedOn=null}function ql(n){if(n.blockedOn!==null)return!1;for(var e=n.targetContainers;0<e.length;){var t=td(n.domEventName,n.eventSystemFlags,e[0],n.nativeEvent);if(t===null){t=n.nativeEvent;var i=new t.constructor(t.type,t);$f=i,t.target.dispatchEvent(i),$f=null}else return e=ya(t),e!==null&&Bd(e),n.blockedOn=t,!1;e.shift()}return!0}function Zg(n,e,t){ql(n)&&t.delete(e)}function QS(){ed=!1,ur!==null&&ql(ur)&&(ur=null),hr!==null&&ql(hr)&&(hr=null),fr!==null&&ql(fr)&&(fr=null),ia.forEach(Zg),ra.forEach(Zg)}function Uo(n,e){n.blockedOn===e&&(n.blockedOn=null,ed||(ed=!0,Cn.unstable_scheduleCallback(Cn.unstable_NormalPriority,QS)))}function sa(n){function e(r){return Uo(r,n)}if(0<Dl.length){Uo(Dl[0],n);for(var t=1;t<Dl.length;t++){var i=Dl[t];i.blockedOn===n&&(i.blockedOn=null)}}for(ur!==null&&Uo(ur,n),hr!==null&&Uo(hr,n),fr!==null&&Uo(fr,n),ia.forEach(e),ra.forEach(e),t=0;t<or.length;t++)i=or[t],i.blockedOn===n&&(i.blockedOn=null);for(;0<or.length&&(t=or[0],t.blockedOn===null);)xv(t),t.blockedOn===null&&or.shift()}var Os=zi.ReactCurrentBatchConfig,lc=!0;function e1(n,e,t,i){var r=ct,s=Os.transition;Os.transition=null;try{ct=1,kd(n,e,t,i)}finally{ct=r,Os.transition=s}}function t1(n,e,t,i){var r=ct,s=Os.transition;Os.transition=null;try{ct=4,kd(n,e,t,i)}finally{ct=r,Os.transition=s}}function kd(n,e,t,i){if(lc){var r=td(n,e,t,i);if(r===null)Af(n,e,i,cc,t),qg(n,i);else if(jS(r,n,e,t,i))i.stopPropagation();else if(qg(n,i),e&4&&-1<KS.indexOf(n)){for(;r!==null;){var s=ya(r);if(s!==null&&pv(s),s=td(n,e,t,i),s===null&&Af(n,e,i,cc,t),s===r)break;r=s}r!==null&&i.stopPropagation()}else Af(n,e,i,null,t)}}var cc=null;function td(n,e,t,i){if(cc=null,n=Ud(i),n=Xr(n),n!==null)if(e=ns(n),e===null)n=null;else if(t=e.tag,t===13){if(n=ov(e),n!==null)return n;n=null}else if(t===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;n=null}else e!==n&&(n=null);return cc=n,null}function yv(n){switch(n){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(GS()){case Fd:return 1;case uv:return 4;case oc:case HS:return 16;case hv:return 536870912;default:return 16}default:return 16}}var lr=null,zd=null,Zl=null;function _v(){if(Zl)return Zl;var n,e=zd,t=e.length,i,r="value"in lr?lr.value:lr.textContent,s=r.length;for(n=0;n<t&&e[n]===r[n];n++);var o=t-n;for(i=1;i<=o&&e[t-i]===r[s-i];i++);return Zl=r.slice(n,1<i?1-i:void 0)}function $l(n){var e=n.keyCode;return"charCode"in n?(n=n.charCode,n===0&&e===13&&(n=13)):n=e,n===10&&(n=13),32<=n||n===13?n:0}function Nl(){return!0}function $g(){return!1}function Rn(n){function e(t,i,r,s,o){this._reactName=t,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in n)n.hasOwnProperty(a)&&(t=n[a],this[a]=t?t(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?Nl:$g,this.isPropagationStopped=$g,this}return Tt(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var t=this.nativeEvent;t&&(t.preventDefault?t.preventDefault():typeof t.returnValue!="unknown"&&(t.returnValue=!1),this.isDefaultPrevented=Nl)},stopPropagation:function(){var t=this.nativeEvent;t&&(t.stopPropagation?t.stopPropagation():typeof t.cancelBubble!="unknown"&&(t.cancelBubble=!0),this.isPropagationStopped=Nl)},persist:function(){},isPersistent:Nl}),e}var qs={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(n){return n.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},Vd=Rn(qs),xa=Tt({},qs,{view:0,detail:0}),n1=Rn(xa),_f,Sf,Fo,Cc=Tt({},xa,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:Gd,button:0,buttons:0,relatedTarget:function(n){return n.relatedTarget===void 0?n.fromElement===n.srcElement?n.toElement:n.fromElement:n.relatedTarget},movementX:function(n){return"movementX"in n?n.movementX:(n!==Fo&&(Fo&&n.type==="mousemove"?(_f=n.screenX-Fo.screenX,Sf=n.screenY-Fo.screenY):Sf=_f=0,Fo=n),_f)},movementY:function(n){return"movementY"in n?n.movementY:Sf}}),Jg=Rn(Cc),i1=Tt({},Cc,{dataTransfer:0}),r1=Rn(i1),s1=Tt({},xa,{relatedTarget:0}),Mf=Rn(s1),o1=Tt({},qs,{animationName:0,elapsedTime:0,pseudoElement:0}),a1=Rn(o1),l1=Tt({},qs,{clipboardData:function(n){return"clipboardData"in n?n.clipboardData:window.clipboardData}}),c1=Rn(l1),u1=Tt({},qs,{data:0}),Kg=Rn(u1),h1={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},f1={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},d1={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function p1(n){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(n):(n=d1[n])?!!e[n]:!1}function Gd(){return p1}var m1=Tt({},xa,{key:function(n){if(n.key){var e=h1[n.key]||n.key;if(e!=="Unidentified")return e}return n.type==="keypress"?(n=$l(n),n===13?"Enter":String.fromCharCode(n)):n.type==="keydown"||n.type==="keyup"?f1[n.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:Gd,charCode:function(n){return n.type==="keypress"?$l(n):0},keyCode:function(n){return n.type==="keydown"||n.type==="keyup"?n.keyCode:0},which:function(n){return n.type==="keypress"?$l(n):n.type==="keydown"||n.type==="keyup"?n.keyCode:0}}),g1=Rn(m1),v1=Tt({},Cc,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),jg=Rn(v1),x1=Tt({},xa,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:Gd}),y1=Rn(x1),_1=Tt({},qs,{propertyName:0,elapsedTime:0,pseudoElement:0}),S1=Rn(_1),M1=Tt({},Cc,{deltaX:function(n){return"deltaX"in n?n.deltaX:"wheelDeltaX"in n?-n.wheelDeltaX:0},deltaY:function(n){return"deltaY"in n?n.deltaY:"wheelDeltaY"in n?-n.wheelDeltaY:"wheelDelta"in n?-n.wheelDelta:0},deltaZ:0,deltaMode:0}),w1=Rn(M1),E1=[9,13,27,32],Hd=Fi&&"CompositionEvent"in window,qo=null;Fi&&"documentMode"in document&&(qo=document.documentMode);var T1=Fi&&"TextEvent"in window&&!qo,Sv=Fi&&(!Hd||qo&&8<qo&&11>=qo),Qg=" ",e0=!1;function Mv(n,e){switch(n){case"keyup":return E1.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function wv(n){return n=n.detail,typeof n=="object"&&"data"in n?n.data:null}var Es=!1;function A1(n,e){switch(n){case"compositionend":return wv(e);case"keypress":return e.which!==32?null:(e0=!0,Qg);case"textInput":return n=e.data,n===Qg&&e0?null:n;default:return null}}function b1(n,e){if(Es)return n==="compositionend"||!Hd&&Mv(n,e)?(n=_v(),Zl=zd=lr=null,Es=!1,n):null;switch(n){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return Sv&&e.locale!=="ko"?null:e.data;default:return null}}var C1={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function t0(n){var e=n&&n.nodeName&&n.nodeName.toLowerCase();return e==="input"?!!C1[n.type]:e==="textarea"}function Ev(n,e,t,i){tv(i),e=uc(e,"onChange"),0<e.length&&(t=new Vd("onChange","change",null,t,i),n.push({event:t,listeners:e}))}var Zo=null,oa=null;function R1(n){Uv(n,0)}function Rc(n){var e=bs(n);if(Z0(e))return n}function P1(n,e){if(n==="change")return e}var Tv=!1;Fi&&(Fi?(Fl="oninput"in document,Fl||(wf=document.createElement("div"),wf.setAttribute("oninput","return;"),Fl=typeof wf.oninput=="function"),Ul=Fl):Ul=!1,Tv=Ul&&(!document.documentMode||9<document.documentMode));var Ul,Fl,wf;function n0(){Zo&&(Zo.detachEvent("onpropertychange",Av),oa=Zo=null)}function Av(n){if(n.propertyName==="value"&&Rc(oa)){var e=[];Ev(e,oa,n,Ud(n)),sv(R1,e)}}function I1(n,e,t){n==="focusin"?(n0(),Zo=e,oa=t,Zo.attachEvent("onpropertychange",Av)):n==="focusout"&&n0()}function L1(n){if(n==="selectionchange"||n==="keyup"||n==="keydown")return Rc(oa)}function D1(n,e){if(n==="click")return Rc(e)}function N1(n,e){if(n==="input"||n==="change")return Rc(e)}function U1(n,e){return n===e&&(n!==0||1/n===1/e)||n!==n&&e!==e}var ii=typeof Object.is=="function"?Object.is:U1;function aa(n,e){if(ii(n,e))return!0;if(typeof n!="object"||n===null||typeof e!="object"||e===null)return!1;var t=Object.keys(n),i=Object.keys(e);if(t.length!==i.length)return!1;for(i=0;i<t.length;i++){var r=t[i];if(!Of.call(e,r)||!ii(n[r],e[r]))return!1}return!0}function i0(n){for(;n&&n.firstChild;)n=n.firstChild;return n}function r0(n,e){var t=i0(n);n=0;for(var i;t;){if(t.nodeType===3){if(i=n+t.textContent.length,n<=e&&i>=e)return{node:t,offset:e-n};n=i}e:{for(;t;){if(t.nextSibling){t=t.nextSibling;break e}t=t.parentNode}t=void 0}t=i0(t)}}function bv(n,e){return n&&e?n===e?!0:n&&n.nodeType===3?!1:e&&e.nodeType===3?bv(n,e.parentNode):"contains"in n?n.contains(e):n.compareDocumentPosition?!!(n.compareDocumentPosition(e)&16):!1:!1}function Cv(){for(var n=window,e=ic();e instanceof n.HTMLIFrameElement;){try{var t=typeof e.contentWindow.location.href=="string"}catch{t=!1}if(t)n=e.contentWindow;else break;e=ic(n.document)}return e}function Wd(n){var e=n&&n.nodeName&&n.nodeName.toLowerCase();return e&&(e==="input"&&(n.type==="text"||n.type==="search"||n.type==="tel"||n.type==="url"||n.type==="password")||e==="textarea"||n.contentEditable==="true")}function F1(n){var e=Cv(),t=n.focusedElem,i=n.selectionRange;if(e!==t&&t&&t.ownerDocument&&bv(t.ownerDocument.documentElement,t)){if(i!==null&&Wd(t)){if(e=i.start,n=i.end,n===void 0&&(n=e),"selectionStart"in t)t.selectionStart=e,t.selectionEnd=Math.min(n,t.value.length);else if(n=(e=t.ownerDocument||document)&&e.defaultView||window,n.getSelection){n=n.getSelection();var r=t.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!n.extend&&s>i&&(r=i,i=s,s=r),r=r0(t,s);var o=r0(t,i);r&&o&&(n.rangeCount!==1||n.anchorNode!==r.node||n.anchorOffset!==r.offset||n.focusNode!==o.node||n.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),n.removeAllRanges(),s>i?(n.addRange(e),n.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),n.addRange(e)))}}for(e=[],n=t;n=n.parentNode;)n.nodeType===1&&e.push({element:n,left:n.scrollLeft,top:n.scrollTop});for(typeof t.focus=="function"&&t.focus(),t=0;t<e.length;t++)n=e[t],n.element.scrollLeft=n.left,n.element.scrollTop=n.top}}var O1=Fi&&"documentMode"in document&&11>=document.documentMode,Ts=null,nd=null,$o=null,id=!1;function s0(n,e,t){var i=t.window===t?t.document:t.nodeType===9?t:t.ownerDocument;id||Ts==null||Ts!==ic(i)||(i=Ts,"selectionStart"in i&&Wd(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),$o&&aa($o,i)||($o=i,i=uc(nd,"onSelect"),0<i.length&&(e=new Vd("onSelect","select",null,e,t),n.push({event:e,listeners:i}),e.target=Ts)))}function Ol(n,e){var t={};return t[n.toLowerCase()]=e.toLowerCase(),t["Webkit"+n]="webkit"+e,t["Moz"+n]="moz"+e,t}var As={animationend:Ol("Animation","AnimationEnd"),animationiteration:Ol("Animation","AnimationIteration"),animationstart:Ol("Animation","AnimationStart"),transitionend:Ol("Transition","TransitionEnd")},Ef={},Rv={};Fi&&(Rv=document.createElement("div").style,"AnimationEvent"in window||(delete As.animationend.animation,delete As.animationiteration.animation,delete As.animationstart.animation),"TransitionEvent"in window||delete As.transitionend.transition);function Pc(n){if(Ef[n])return Ef[n];if(!As[n])return n;var e=As[n],t;for(t in e)if(e.hasOwnProperty(t)&&t in Rv)return Ef[n]=e[t];return n}var Pv=Pc("animationend"),Iv=Pc("animationiteration"),Lv=Pc("animationstart"),Dv=Pc("transitionend"),Nv=new Map,o0="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function _r(n,e){Nv.set(n,e),ts(e,[n])}for(Bl=0;Bl<o0.length;Bl++)kl=o0[Bl],a0=kl.toLowerCase(),l0=kl[0].toUpperCase()+kl.slice(1),_r(a0,"on"+l0);var kl,a0,l0,Bl;_r(Pv,"onAnimationEnd");_r(Iv,"onAnimationIteration");_r(Lv,"onAnimationStart");_r("dblclick","onDoubleClick");_r("focusin","onFocus");_r("focusout","onBlur");_r(Dv,"onTransitionEnd");zs("onMouseEnter",["mouseout","mouseover"]);zs("onMouseLeave",["mouseout","mouseover"]);zs("onPointerEnter",["pointerout","pointerover"]);zs("onPointerLeave",["pointerout","pointerover"]);ts("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));ts("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));ts("onBeforeInput",["compositionend","keypress","textInput","paste"]);ts("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));ts("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));ts("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var Wo="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),B1=new Set("cancel close invalid load scroll toggle".split(" ").concat(Wo));function c0(n,e,t){var i=n.type||"unknown-event";n.currentTarget=t,BS(i,e,void 0,n),n.currentTarget=null}function Uv(n,e){e=(e&4)!==0;for(var t=0;t<n.length;t++){var i=n[t],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,u=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;c0(r,a,u),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,u=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;c0(r,a,u),s=l}}}if(sc)throw n=jf,sc=!1,jf=null,n}function xt(n,e){var t=e[ld];t===void 0&&(t=e[ld]=new Set);var i=n+"__bubble";t.has(i)||(Fv(e,n,2,!1),t.add(i))}function Tf(n,e,t){var i=0;e&&(i|=4),Fv(t,n,i,e)}var zl="_reactListening"+Math.random().toString(36).slice(2);function la(n){if(!n[zl]){n[zl]=!0,H0.forEach(function(t){t!=="selectionchange"&&(B1.has(t)||Tf(t,!1,n),Tf(t,!0,n))});var e=n.nodeType===9?n:n.ownerDocument;e===null||e[zl]||(e[zl]=!0,Tf("selectionchange",!1,e))}}function Fv(n,e,t,i){switch(yv(e)){case 1:var r=e1;break;case 4:r=t1;break;default:r=kd}t=r.bind(null,e,t,n),r=void 0,!Kf||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?n.addEventListener(e,t,{capture:!0,passive:r}):n.addEventListener(e,t,!0):r!==void 0?n.addEventListener(e,t,{passive:r}):n.addEventListener(e,t,!1)}function Af(n,e,t,i,r){var s=i;if(!(e&1)&&!(e&2)&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=Xr(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}sv(function(){var u=s,f=Ud(t),c=[];e:{var h=Nv.get(n);if(h!==void 0){var d=Vd,p=n;switch(n){case"keypress":if($l(t)===0)break e;case"keydown":case"keyup":d=g1;break;case"focusin":p="focus",d=Mf;break;case"focusout":p="blur",d=Mf;break;case"beforeblur":case"afterblur":d=Mf;break;case"click":if(t.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":d=Jg;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":d=r1;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":d=y1;break;case Pv:case Iv:case Lv:d=a1;break;case Dv:d=S1;break;case"scroll":d=n1;break;case"wheel":d=w1;break;case"copy":case"cut":case"paste":d=c1;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":d=jg}var _=(e&4)!==0,y=!_&&n==="scroll",m=_?h!==null?h+"Capture":null:h;_=[];for(var v=u,g;v!==null;){g=v;var S=g.stateNode;if(g.tag===5&&S!==null&&(g=S,m!==null&&(S=na(v,m),S!=null&&_.push(ca(v,S,g)))),y)break;v=v.return}0<_.length&&(h=new d(h,p,null,t,f),c.push({event:h,listeners:_}))}}if(!(e&7)){e:{if(h=n==="mouseover"||n==="pointerover",d=n==="mouseout"||n==="pointerout",h&&t!==$f&&(p=t.relatedTarget||t.fromElement)&&(Xr(p)||p[Oi]))break e;if((d||h)&&(h=f.window===f?f:(h=f.ownerDocument)?h.defaultView||h.parentWindow:window,d?(p=t.relatedTarget||t.toElement,d=u,p=p?Xr(p):null,p!==null&&(y=ns(p),p!==y||p.tag!==5&&p.tag!==6)&&(p=null)):(d=null,p=u),d!==p)){if(_=Jg,S="onMouseLeave",m="onMouseEnter",v="mouse",(n==="pointerout"||n==="pointerover")&&(_=jg,S="onPointerLeave",m="onPointerEnter",v="pointer"),y=d==null?h:bs(d),g=p==null?h:bs(p),h=new _(S,v+"leave",d,t,f),h.target=y,h.relatedTarget=g,S=null,Xr(f)===u&&(_=new _(m,v+"enter",p,t,f),_.target=g,_.relatedTarget=y,S=_),y=S,d&&p)t:{for(_=d,m=p,v=0,g=_;g;g=Ss(g))v++;for(g=0,S=m;S;S=Ss(S))g++;for(;0<v-g;)_=Ss(_),v--;for(;0<g-v;)m=Ss(m),g--;for(;v--;){if(_===m||m!==null&&_===m.alternate)break t;_=Ss(_),m=Ss(m)}_=null}else _=null;d!==null&&u0(c,h,d,_,!1),p!==null&&y!==null&&u0(c,y,p,_,!0)}}e:{if(h=u?bs(u):window,d=h.nodeName&&h.nodeName.toLowerCase(),d==="select"||d==="input"&&h.type==="file")var E=P1;else if(t0(h))if(Tv)E=N1;else{E=L1;var M=I1}else(d=h.nodeName)&&d.toLowerCase()==="input"&&(h.type==="checkbox"||h.type==="radio")&&(E=D1);if(E&&(E=E(n,u))){Ev(c,E,t,f);break e}M&&M(n,h,u),n==="focusout"&&(M=h._wrapperState)&&M.controlled&&h.type==="number"&&Wf(h,"number",h.value)}switch(M=u?bs(u):window,n){case"focusin":(t0(M)||M.contentEditable==="true")&&(Ts=M,nd=u,$o=null);break;case"focusout":$o=nd=Ts=null;break;case"mousedown":id=!0;break;case"contextmenu":case"mouseup":case"dragend":id=!1,s0(c,t,f);break;case"selectionchange":if(O1)break;case"keydown":case"keyup":s0(c,t,f)}var T;if(Hd)e:{switch(n){case"compositionstart":var x="onCompositionStart";break e;case"compositionend":x="onCompositionEnd";break e;case"compositionupdate":x="onCompositionUpdate";break e}x=void 0}else Es?Mv(n,t)&&(x="onCompositionEnd"):n==="keydown"&&t.keyCode===229&&(x="onCompositionStart");x&&(Sv&&t.locale!=="ko"&&(Es||x!=="onCompositionStart"?x==="onCompositionEnd"&&Es&&(T=_v()):(lr=f,zd="value"in lr?lr.value:lr.textContent,Es=!0)),M=uc(u,x),0<M.length&&(x=new Kg(x,n,null,t,f),c.push({event:x,listeners:M}),T?x.data=T:(T=wv(t),T!==null&&(x.data=T)))),(T=T1?A1(n,t):b1(n,t))&&(u=uc(u,"onBeforeInput"),0<u.length&&(f=new Kg("onBeforeInput","beforeinput",null,t,f),c.push({event:f,listeners:u}),f.data=T))}Uv(c,e)})}function ca(n,e,t){return{instance:n,listener:e,currentTarget:t}}function uc(n,e){for(var t=e+"Capture",i=[];n!==null;){var r=n,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=na(n,t),s!=null&&i.unshift(ca(n,s,r)),s=na(n,e),s!=null&&i.push(ca(n,s,r))),n=n.return}return i}function Ss(n){if(n===null)return null;do n=n.return;while(n&&n.tag!==5);return n||null}function u0(n,e,t,i,r){for(var s=e._reactName,o=[];t!==null&&t!==i;){var a=t,l=a.alternate,u=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&u!==null&&(a=u,r?(l=na(t,s),l!=null&&o.unshift(ca(t,l,a))):r||(l=na(t,s),l!=null&&o.push(ca(t,l,a)))),t=t.return}o.length!==0&&n.push({event:e,listeners:o})}var k1=/\r\n?/g,z1=/\u0000|\uFFFD/g;function h0(n){return(typeof n=="string"?n:""+n).replace(k1,`
`).replace(z1,"")}function Vl(n,e,t){if(e=h0(e),h0(n)!==e&&t)throw Error(ce(425))}function hc(){}var rd=null,sd=null;function od(n,e){return n==="textarea"||n==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var ad=typeof setTimeout=="function"?setTimeout:void 0,V1=typeof clearTimeout=="function"?clearTimeout:void 0,f0=typeof Promise=="function"?Promise:void 0,G1=typeof queueMicrotask=="function"?queueMicrotask:typeof f0<"u"?function(n){return f0.resolve(null).then(n).catch(H1)}:ad;function H1(n){setTimeout(function(){throw n})}function bf(n,e){var t=e,i=0;do{var r=t.nextSibling;if(n.removeChild(t),r&&r.nodeType===8)if(t=r.data,t==="/$"){if(i===0){n.removeChild(r),sa(e);return}i--}else t!=="$"&&t!=="$?"&&t!=="$!"||i++;t=r}while(t);sa(e)}function dr(n){for(;n!=null;n=n.nextSibling){var e=n.nodeType;if(e===1||e===3)break;if(e===8){if(e=n.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return n}function d0(n){n=n.previousSibling;for(var e=0;n;){if(n.nodeType===8){var t=n.data;if(t==="$"||t==="$!"||t==="$?"){if(e===0)return n;e--}else t==="/$"&&e++}n=n.previousSibling}return null}var Zs=Math.random().toString(36).slice(2),vi="__reactFiber$"+Zs,ua="__reactProps$"+Zs,Oi="__reactContainer$"+Zs,ld="__reactEvents$"+Zs,W1="__reactListeners$"+Zs,X1="__reactHandles$"+Zs;function Xr(n){var e=n[vi];if(e)return e;for(var t=n.parentNode;t;){if(e=t[Oi]||t[vi]){if(t=e.alternate,e.child!==null||t!==null&&t.child!==null)for(n=d0(n);n!==null;){if(t=n[vi])return t;n=d0(n)}return e}n=t,t=n.parentNode}return null}function ya(n){return n=n[vi]||n[Oi],!n||n.tag!==5&&n.tag!==6&&n.tag!==13&&n.tag!==3?null:n}function bs(n){if(n.tag===5||n.tag===6)return n.stateNode;throw Error(ce(33))}function Ic(n){return n[ua]||null}var cd=[],Cs=-1;function Sr(n){return{current:n}}function yt(n){0>Cs||(n.current=cd[Cs],cd[Cs]=null,Cs--)}function vt(n,e){Cs++,cd[Cs]=n.current,n.current=e}var yr={},nn=Sr(yr),xn=Sr(!1),Jr=yr;function Vs(n,e){var t=n.type.contextTypes;if(!t)return yr;var i=n.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in t)r[s]=e[s];return i&&(n=n.stateNode,n.__reactInternalMemoizedUnmaskedChildContext=e,n.__reactInternalMemoizedMaskedChildContext=r),r}function yn(n){return n=n.childContextTypes,n!=null}function fc(){yt(xn),yt(nn)}function p0(n,e,t){if(nn.current!==yr)throw Error(ce(168));vt(nn,e),vt(xn,t)}function Ov(n,e,t){var i=n.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return t;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(ce(108,IS(n)||"Unknown",r));return Tt({},t,i)}function dc(n){return n=(n=n.stateNode)&&n.__reactInternalMemoizedMergedChildContext||yr,Jr=nn.current,vt(nn,n),vt(xn,xn.current),!0}function m0(n,e,t){var i=n.stateNode;if(!i)throw Error(ce(169));t?(n=Ov(n,e,Jr),i.__reactInternalMemoizedMergedChildContext=n,yt(xn),yt(nn),vt(nn,n)):yt(xn),vt(xn,t)}var Li=null,Lc=!1,Cf=!1;function Bv(n){Li===null?Li=[n]:Li.push(n)}function Y1(n){Lc=!0,Bv(n)}function Mr(){if(!Cf&&Li!==null){Cf=!0;var n=0,e=ct;try{var t=Li;for(ct=1;n<t.length;n++){var i=t[n];do i=i(!0);while(i!==null)}Li=null,Lc=!1}catch(r){throw Li!==null&&(Li=Li.slice(n+1)),cv(Fd,Mr),r}finally{ct=e,Cf=!1}}return null}var Rs=[],Ps=0,pc=null,mc=0,Vn=[],Gn=0,Kr=null,Di=1,Ni="";function Hr(n,e){Rs[Ps++]=mc,Rs[Ps++]=pc,pc=n,mc=e}function kv(n,e,t){Vn[Gn++]=Di,Vn[Gn++]=Ni,Vn[Gn++]=Kr,Kr=n;var i=Di;n=Ni;var r=32-ti(i)-1;i&=~(1<<r),t+=1;var s=32-ti(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,Di=1<<32-ti(e)+r|t<<r|i,Ni=s+n}else Di=1<<s|t<<r|i,Ni=n}function Xd(n){n.return!==null&&(Hr(n,1),kv(n,1,0))}function Yd(n){for(;n===pc;)pc=Rs[--Ps],Rs[Ps]=null,mc=Rs[--Ps],Rs[Ps]=null;for(;n===Kr;)Kr=Vn[--Gn],Vn[Gn]=null,Ni=Vn[--Gn],Vn[Gn]=null,Di=Vn[--Gn],Vn[Gn]=null}var bn=null,An=null,St=!1,ei=null;function zv(n,e){var t=Hn(5,null,null,0);t.elementType="DELETED",t.stateNode=e,t.return=n,e=n.deletions,e===null?(n.deletions=[t],n.flags|=16):e.push(t)}function g0(n,e){switch(n.tag){case 5:var t=n.type;return e=e.nodeType!==1||t.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(n.stateNode=e,bn=n,An=dr(e.firstChild),!0):!1;case 6:return e=n.pendingProps===""||e.nodeType!==3?null:e,e!==null?(n.stateNode=e,bn=n,An=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(t=Kr!==null?{id:Di,overflow:Ni}:null,n.memoizedState={dehydrated:e,treeContext:t,retryLane:1073741824},t=Hn(18,null,null,0),t.stateNode=e,t.return=n,n.child=t,bn=n,An=null,!0):!1;default:return!1}}function ud(n){return(n.mode&1)!==0&&(n.flags&128)===0}function hd(n){if(St){var e=An;if(e){var t=e;if(!g0(n,e)){if(ud(n))throw Error(ce(418));e=dr(t.nextSibling);var i=bn;e&&g0(n,e)?zv(i,t):(n.flags=n.flags&-4097|2,St=!1,bn=n)}}else{if(ud(n))throw Error(ce(418));n.flags=n.flags&-4097|2,St=!1,bn=n}}}function v0(n){for(n=n.return;n!==null&&n.tag!==5&&n.tag!==3&&n.tag!==13;)n=n.return;bn=n}function Gl(n){if(n!==bn)return!1;if(!St)return v0(n),St=!0,!1;var e;if((e=n.tag!==3)&&!(e=n.tag!==5)&&(e=n.type,e=e!=="head"&&e!=="body"&&!od(n.type,n.memoizedProps)),e&&(e=An)){if(ud(n))throw Vv(),Error(ce(418));for(;e;)zv(n,e),e=dr(e.nextSibling)}if(v0(n),n.tag===13){if(n=n.memoizedState,n=n!==null?n.dehydrated:null,!n)throw Error(ce(317));e:{for(n=n.nextSibling,e=0;n;){if(n.nodeType===8){var t=n.data;if(t==="/$"){if(e===0){An=dr(n.nextSibling);break e}e--}else t!=="$"&&t!=="$!"&&t!=="$?"||e++}n=n.nextSibling}An=null}}else An=bn?dr(n.stateNode.nextSibling):null;return!0}function Vv(){for(var n=An;n;)n=dr(n.nextSibling)}function Gs(){An=bn=null,St=!1}function qd(n){ei===null?ei=[n]:ei.push(n)}var q1=zi.ReactCurrentBatchConfig;function Oo(n,e,t){if(n=t.ref,n!==null&&typeof n!="function"&&typeof n!="object"){if(t._owner){if(t=t._owner,t){if(t.tag!==1)throw Error(ce(309));var i=t.stateNode}if(!i)throw Error(ce(147,n));var r=i,s=""+n;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof n!="string")throw Error(ce(284));if(!t._owner)throw Error(ce(290,n))}return n}function Hl(n,e){throw n=Object.prototype.toString.call(e),Error(ce(31,n==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":n))}function x0(n){var e=n._init;return e(n._payload)}function Gv(n){function e(m,v){if(n){var g=m.deletions;g===null?(m.deletions=[v],m.flags|=16):g.push(v)}}function t(m,v){if(!n)return null;for(;v!==null;)e(m,v),v=v.sibling;return null}function i(m,v){for(m=new Map;v!==null;)v.key!==null?m.set(v.key,v):m.set(v.index,v),v=v.sibling;return m}function r(m,v){return m=vr(m,v),m.index=0,m.sibling=null,m}function s(m,v,g){return m.index=g,n?(g=m.alternate,g!==null?(g=g.index,g<v?(m.flags|=2,v):g):(m.flags|=2,v)):(m.flags|=1048576,v)}function o(m){return n&&m.alternate===null&&(m.flags|=2),m}function a(m,v,g,S){return v===null||v.tag!==6?(v=Uf(g,m.mode,S),v.return=m,v):(v=r(v,g),v.return=m,v)}function l(m,v,g,S){var E=g.type;return E===ws?f(m,v,g.props.children,S,g.key):v!==null&&(v.elementType===E||typeof E=="object"&&E!==null&&E.$$typeof===rr&&x0(E)===v.type)?(S=r(v,g.props),S.ref=Oo(m,v,g),S.return=m,S):(S=nc(g.type,g.key,g.props,null,m.mode,S),S.ref=Oo(m,v,g),S.return=m,S)}function u(m,v,g,S){return v===null||v.tag!==4||v.stateNode.containerInfo!==g.containerInfo||v.stateNode.implementation!==g.implementation?(v=Ff(g,m.mode,S),v.return=m,v):(v=r(v,g.children||[]),v.return=m,v)}function f(m,v,g,S,E){return v===null||v.tag!==7?(v=$r(g,m.mode,S,E),v.return=m,v):(v=r(v,g),v.return=m,v)}function c(m,v,g){if(typeof v=="string"&&v!==""||typeof v=="number")return v=Uf(""+v,m.mode,g),v.return=m,v;if(typeof v=="object"&&v!==null){switch(v.$$typeof){case Cl:return g=nc(v.type,v.key,v.props,null,m.mode,g),g.ref=Oo(m,null,v),g.return=m,g;case Ms:return v=Ff(v,m.mode,g),v.return=m,v;case rr:var S=v._init;return c(m,S(v._payload),g)}if(Go(v)||Do(v))return v=$r(v,m.mode,g,null),v.return=m,v;Hl(m,v)}return null}function h(m,v,g,S){var E=v!==null?v.key:null;if(typeof g=="string"&&g!==""||typeof g=="number")return E!==null?null:a(m,v,""+g,S);if(typeof g=="object"&&g!==null){switch(g.$$typeof){case Cl:return g.key===E?l(m,v,g,S):null;case Ms:return g.key===E?u(m,v,g,S):null;case rr:return E=g._init,h(m,v,E(g._payload),S)}if(Go(g)||Do(g))return E!==null?null:f(m,v,g,S,null);Hl(m,g)}return null}function d(m,v,g,S,E){if(typeof S=="string"&&S!==""||typeof S=="number")return m=m.get(g)||null,a(v,m,""+S,E);if(typeof S=="object"&&S!==null){switch(S.$$typeof){case Cl:return m=m.get(S.key===null?g:S.key)||null,l(v,m,S,E);case Ms:return m=m.get(S.key===null?g:S.key)||null,u(v,m,S,E);case rr:var M=S._init;return d(m,v,g,M(S._payload),E)}if(Go(S)||Do(S))return m=m.get(g)||null,f(v,m,S,E,null);Hl(v,S)}return null}function p(m,v,g,S){for(var E=null,M=null,T=v,x=v=0,w=null;T!==null&&x<g.length;x++){T.index>x?(w=T,T=null):w=T.sibling;var C=h(m,T,g[x],S);if(C===null){T===null&&(T=w);break}n&&T&&C.alternate===null&&e(m,T),v=s(C,v,x),M===null?E=C:M.sibling=C,M=C,T=w}if(x===g.length)return t(m,T),St&&Hr(m,x),E;if(T===null){for(;x<g.length;x++)T=c(m,g[x],S),T!==null&&(v=s(T,v,x),M===null?E=T:M.sibling=T,M=T);return St&&Hr(m,x),E}for(T=i(m,T);x<g.length;x++)w=d(T,m,x,g[x],S),w!==null&&(n&&w.alternate!==null&&T.delete(w.key===null?x:w.key),v=s(w,v,x),M===null?E=w:M.sibling=w,M=w);return n&&T.forEach(function(A){return e(m,A)}),St&&Hr(m,x),E}function _(m,v,g,S){var E=Do(g);if(typeof E!="function")throw Error(ce(150));if(g=E.call(g),g==null)throw Error(ce(151));for(var M=E=null,T=v,x=v=0,w=null,C=g.next();T!==null&&!C.done;x++,C=g.next()){T.index>x?(w=T,T=null):w=T.sibling;var A=h(m,T,C.value,S);if(A===null){T===null&&(T=w);break}n&&T&&A.alternate===null&&e(m,T),v=s(A,v,x),M===null?E=A:M.sibling=A,M=A,T=w}if(C.done)return t(m,T),St&&Hr(m,x),E;if(T===null){for(;!C.done;x++,C=g.next())C=c(m,C.value,S),C!==null&&(v=s(C,v,x),M===null?E=C:M.sibling=C,M=C);return St&&Hr(m,x),E}for(T=i(m,T);!C.done;x++,C=g.next())C=d(T,m,x,C.value,S),C!==null&&(n&&C.alternate!==null&&T.delete(C.key===null?x:C.key),v=s(C,v,x),M===null?E=C:M.sibling=C,M=C);return n&&T.forEach(function(I){return e(m,I)}),St&&Hr(m,x),E}function y(m,v,g,S){if(typeof g=="object"&&g!==null&&g.type===ws&&g.key===null&&(g=g.props.children),typeof g=="object"&&g!==null){switch(g.$$typeof){case Cl:e:{for(var E=g.key,M=v;M!==null;){if(M.key===E){if(E=g.type,E===ws){if(M.tag===7){t(m,M.sibling),v=r(M,g.props.children),v.return=m,m=v;break e}}else if(M.elementType===E||typeof E=="object"&&E!==null&&E.$$typeof===rr&&x0(E)===M.type){t(m,M.sibling),v=r(M,g.props),v.ref=Oo(m,M,g),v.return=m,m=v;break e}t(m,M);break}else e(m,M);M=M.sibling}g.type===ws?(v=$r(g.props.children,m.mode,S,g.key),v.return=m,m=v):(S=nc(g.type,g.key,g.props,null,m.mode,S),S.ref=Oo(m,v,g),S.return=m,m=S)}return o(m);case Ms:e:{for(M=g.key;v!==null;){if(v.key===M)if(v.tag===4&&v.stateNode.containerInfo===g.containerInfo&&v.stateNode.implementation===g.implementation){t(m,v.sibling),v=r(v,g.children||[]),v.return=m,m=v;break e}else{t(m,v);break}else e(m,v);v=v.sibling}v=Ff(g,m.mode,S),v.return=m,m=v}return o(m);case rr:return M=g._init,y(m,v,M(g._payload),S)}if(Go(g))return p(m,v,g,S);if(Do(g))return _(m,v,g,S);Hl(m,g)}return typeof g=="string"&&g!==""||typeof g=="number"?(g=""+g,v!==null&&v.tag===6?(t(m,v.sibling),v=r(v,g),v.return=m,m=v):(t(m,v),v=Uf(g,m.mode,S),v.return=m,m=v),o(m)):t(m,v)}return y}var Hs=Gv(!0),Hv=Gv(!1),gc=Sr(null),vc=null,Is=null,Zd=null;function $d(){Zd=Is=vc=null}function Jd(n){var e=gc.current;yt(gc),n._currentValue=e}function fd(n,e,t){for(;n!==null;){var i=n.alternate;if((n.childLanes&e)!==e?(n.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),n===t)break;n=n.return}}function Bs(n,e){vc=n,Zd=Is=null,n=n.dependencies,n!==null&&n.firstContext!==null&&(n.lanes&e&&(vn=!0),n.firstContext=null)}function Xn(n){var e=n._currentValue;if(Zd!==n)if(n={context:n,memoizedValue:e,next:null},Is===null){if(vc===null)throw Error(ce(308));Is=n,vc.dependencies={lanes:0,firstContext:n}}else Is=Is.next=n;return e}var Yr=null;function Kd(n){Yr===null?Yr=[n]:Yr.push(n)}function Wv(n,e,t,i){var r=e.interleaved;return r===null?(t.next=t,Kd(e)):(t.next=r.next,r.next=t),e.interleaved=t,Bi(n,i)}function Bi(n,e){n.lanes|=e;var t=n.alternate;for(t!==null&&(t.lanes|=e),t=n,n=n.return;n!==null;)n.childLanes|=e,t=n.alternate,t!==null&&(t.childLanes|=e),t=n,n=n.return;return t.tag===3?t.stateNode:null}var sr=!1;function jd(n){n.updateQueue={baseState:n.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function Xv(n,e){n=n.updateQueue,e.updateQueue===n&&(e.updateQueue={baseState:n.baseState,firstBaseUpdate:n.firstBaseUpdate,lastBaseUpdate:n.lastBaseUpdate,shared:n.shared,effects:n.effects})}function Ui(n,e){return{eventTime:n,lane:e,tag:0,payload:null,callback:null,next:null}}function pr(n,e,t){var i=n.updateQueue;if(i===null)return null;if(i=i.shared,ot&2){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,Bi(n,t)}return r=i.interleaved,r===null?(e.next=e,Kd(i)):(e.next=r.next,r.next=e),i.interleaved=e,Bi(n,t)}function Jl(n,e,t){if(e=e.updateQueue,e!==null&&(e=e.shared,(t&4194240)!==0)){var i=e.lanes;i&=n.pendingLanes,t|=i,e.lanes=t,Od(n,t)}}function y0(n,e){var t=n.updateQueue,i=n.alternate;if(i!==null&&(i=i.updateQueue,t===i)){var r=null,s=null;if(t=t.firstBaseUpdate,t!==null){do{var o={eventTime:t.eventTime,lane:t.lane,tag:t.tag,payload:t.payload,callback:t.callback,next:null};s===null?r=s=o:s=s.next=o,t=t.next}while(t!==null);s===null?r=s=e:s=s.next=e}else r=s=e;t={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},n.updateQueue=t;return}n=t.lastBaseUpdate,n===null?t.firstBaseUpdate=e:n.next=e,t.lastBaseUpdate=e}function xc(n,e,t,i){var r=n.updateQueue;sr=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,u=l.next;l.next=null,o===null?s=u:o.next=u,o=l;var f=n.alternate;f!==null&&(f=f.updateQueue,a=f.lastBaseUpdate,a!==o&&(a===null?f.firstBaseUpdate=u:a.next=u,f.lastBaseUpdate=l))}if(s!==null){var c=r.baseState;o=0,f=u=l=null,a=s;do{var h=a.lane,d=a.eventTime;if((i&h)===h){f!==null&&(f=f.next={eventTime:d,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var p=n,_=a;switch(h=e,d=t,_.tag){case 1:if(p=_.payload,typeof p=="function"){c=p.call(d,c,h);break e}c=p;break e;case 3:p.flags=p.flags&-65537|128;case 0:if(p=_.payload,h=typeof p=="function"?p.call(d,c,h):p,h==null)break e;c=Tt({},c,h);break e;case 2:sr=!0}}a.callback!==null&&a.lane!==0&&(n.flags|=64,h=r.effects,h===null?r.effects=[a]:h.push(a))}else d={eventTime:d,lane:h,tag:a.tag,payload:a.payload,callback:a.callback,next:null},f===null?(u=f=d,l=c):f=f.next=d,o|=h;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;h=a,a=h.next,h.next=null,r.lastBaseUpdate=h,r.shared.pending=null}}while(!0);if(f===null&&(l=c),r.baseState=l,r.firstBaseUpdate=u,r.lastBaseUpdate=f,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);Qr|=o,n.lanes=o,n.memoizedState=c}}function _0(n,e,t){if(n=e.effects,e.effects=null,n!==null)for(e=0;e<n.length;e++){var i=n[e],r=i.callback;if(r!==null){if(i.callback=null,i=t,typeof r!="function")throw Error(ce(191,r));r.call(i)}}}var _a={},yi=Sr(_a),ha=Sr(_a),fa=Sr(_a);function qr(n){if(n===_a)throw Error(ce(174));return n}function Qd(n,e){switch(vt(fa,e),vt(ha,n),vt(yi,_a),n=e.nodeType,n){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:Yf(null,"");break;default:n=n===8?e.parentNode:e,e=n.namespaceURI||null,n=n.tagName,e=Yf(e,n)}yt(yi),vt(yi,e)}function Ws(){yt(yi),yt(ha),yt(fa)}function Yv(n){qr(fa.current);var e=qr(yi.current),t=Yf(e,n.type);e!==t&&(vt(ha,n),vt(yi,t))}function ep(n){ha.current===n&&(yt(yi),yt(ha))}var wt=Sr(0);function yc(n){for(var e=n;e!==null;){if(e.tag===13){var t=e.memoizedState;if(t!==null&&(t=t.dehydrated,t===null||t.data==="$?"||t.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if(e.flags&128)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===n)break;for(;e.sibling===null;){if(e.return===null||e.return===n)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var Rf=[];function tp(){for(var n=0;n<Rf.length;n++)Rf[n]._workInProgressVersionPrimary=null;Rf.length=0}var Kl=zi.ReactCurrentDispatcher,Pf=zi.ReactCurrentBatchConfig,jr=0,Et=null,Ot=null,Vt=null,_c=!1,Jo=!1,da=0,Z1=0;function Qt(){throw Error(ce(321))}function np(n,e){if(e===null)return!1;for(var t=0;t<e.length&&t<n.length;t++)if(!ii(n[t],e[t]))return!1;return!0}function ip(n,e,t,i,r,s){if(jr=s,Et=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,Kl.current=n===null||n.memoizedState===null?j1:Q1,n=t(i,r),Jo){s=0;do{if(Jo=!1,da=0,25<=s)throw Error(ce(301));s+=1,Vt=Ot=null,e.updateQueue=null,Kl.current=eM,n=t(i,r)}while(Jo)}if(Kl.current=Sc,e=Ot!==null&&Ot.next!==null,jr=0,Vt=Ot=Et=null,_c=!1,e)throw Error(ce(300));return n}function rp(){var n=da!==0;return da=0,n}function gi(){var n={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return Vt===null?Et.memoizedState=Vt=n:Vt=Vt.next=n,Vt}function Yn(){if(Ot===null){var n=Et.alternate;n=n!==null?n.memoizedState:null}else n=Ot.next;var e=Vt===null?Et.memoizedState:Vt.next;if(e!==null)Vt=e,Ot=n;else{if(n===null)throw Error(ce(310));Ot=n,n={memoizedState:Ot.memoizedState,baseState:Ot.baseState,baseQueue:Ot.baseQueue,queue:Ot.queue,next:null},Vt===null?Et.memoizedState=Vt=n:Vt=Vt.next=n}return Vt}function pa(n,e){return typeof e=="function"?e(n):e}function If(n){var e=Yn(),t=e.queue;if(t===null)throw Error(ce(311));t.lastRenderedReducer=n;var i=Ot,r=i.baseQueue,s=t.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,t.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,u=s;do{var f=u.lane;if((jr&f)===f)l!==null&&(l=l.next={lane:0,action:u.action,hasEagerState:u.hasEagerState,eagerState:u.eagerState,next:null}),i=u.hasEagerState?u.eagerState:n(i,u.action);else{var c={lane:f,action:u.action,hasEagerState:u.hasEagerState,eagerState:u.eagerState,next:null};l===null?(a=l=c,o=i):l=l.next=c,Et.lanes|=f,Qr|=f}u=u.next}while(u!==null&&u!==s);l===null?o=i:l.next=a,ii(i,e.memoizedState)||(vn=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,t.lastRenderedState=i}if(n=t.interleaved,n!==null){r=n;do s=r.lane,Et.lanes|=s,Qr|=s,r=r.next;while(r!==n)}else r===null&&(t.lanes=0);return[e.memoizedState,t.dispatch]}function Lf(n){var e=Yn(),t=e.queue;if(t===null)throw Error(ce(311));t.lastRenderedReducer=n;var i=t.dispatch,r=t.pending,s=e.memoizedState;if(r!==null){t.pending=null;var o=r=r.next;do s=n(s,o.action),o=o.next;while(o!==r);ii(s,e.memoizedState)||(vn=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),t.lastRenderedState=s}return[s,i]}function qv(){}function Zv(n,e){var t=Et,i=Yn(),r=e(),s=!ii(i.memoizedState,r);if(s&&(i.memoizedState=r,vn=!0),i=i.queue,sp(Kv.bind(null,t,i,n),[n]),i.getSnapshot!==e||s||Vt!==null&&Vt.memoizedState.tag&1){if(t.flags|=2048,ma(9,Jv.bind(null,t,i,r,e),void 0,null),Gt===null)throw Error(ce(349));jr&30||$v(t,e,r)}return r}function $v(n,e,t){n.flags|=16384,n={getSnapshot:e,value:t},e=Et.updateQueue,e===null?(e={lastEffect:null,stores:null},Et.updateQueue=e,e.stores=[n]):(t=e.stores,t===null?e.stores=[n]:t.push(n))}function Jv(n,e,t,i){e.value=t,e.getSnapshot=i,jv(e)&&Qv(n)}function Kv(n,e,t){return t(function(){jv(e)&&Qv(n)})}function jv(n){var e=n.getSnapshot;n=n.value;try{var t=e();return!ii(n,t)}catch{return!0}}function Qv(n){var e=Bi(n,1);e!==null&&ni(e,n,1,-1)}function S0(n){var e=gi();return typeof n=="function"&&(n=n()),e.memoizedState=e.baseState=n,n={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:pa,lastRenderedState:n},e.queue=n,n=n.dispatch=K1.bind(null,Et,n),[e.memoizedState,n]}function ma(n,e,t,i){return n={tag:n,create:e,destroy:t,deps:i,next:null},e=Et.updateQueue,e===null?(e={lastEffect:null,stores:null},Et.updateQueue=e,e.lastEffect=n.next=n):(t=e.lastEffect,t===null?e.lastEffect=n.next=n:(i=t.next,t.next=n,n.next=i,e.lastEffect=n)),n}function ex(){return Yn().memoizedState}function jl(n,e,t,i){var r=gi();Et.flags|=n,r.memoizedState=ma(1|e,t,void 0,i===void 0?null:i)}function Dc(n,e,t,i){var r=Yn();i=i===void 0?null:i;var s=void 0;if(Ot!==null){var o=Ot.memoizedState;if(s=o.destroy,i!==null&&np(i,o.deps)){r.memoizedState=ma(e,t,s,i);return}}Et.flags|=n,r.memoizedState=ma(1|e,t,s,i)}function M0(n,e){return jl(8390656,8,n,e)}function sp(n,e){return Dc(2048,8,n,e)}function tx(n,e){return Dc(4,2,n,e)}function nx(n,e){return Dc(4,4,n,e)}function ix(n,e){if(typeof e=="function")return n=n(),e(n),function(){e(null)};if(e!=null)return n=n(),e.current=n,function(){e.current=null}}function rx(n,e,t){return t=t!=null?t.concat([n]):null,Dc(4,4,ix.bind(null,e,n),t)}function op(){}function sx(n,e){var t=Yn();e=e===void 0?null:e;var i=t.memoizedState;return i!==null&&e!==null&&np(e,i[1])?i[0]:(t.memoizedState=[n,e],n)}function ox(n,e){var t=Yn();e=e===void 0?null:e;var i=t.memoizedState;return i!==null&&e!==null&&np(e,i[1])?i[0]:(n=n(),t.memoizedState=[n,e],n)}function ax(n,e,t){return jr&21?(ii(t,e)||(t=fv(),Et.lanes|=t,Qr|=t,n.baseState=!0),e):(n.baseState&&(n.baseState=!1,vn=!0),n.memoizedState=t)}function $1(n,e){var t=ct;ct=t!==0&&4>t?t:4,n(!0);var i=Pf.transition;Pf.transition={};try{n(!1),e()}finally{ct=t,Pf.transition=i}}function lx(){return Yn().memoizedState}function J1(n,e,t){var i=gr(n);if(t={lane:i,action:t,hasEagerState:!1,eagerState:null,next:null},cx(n))ux(e,t);else if(t=Wv(n,e,t,i),t!==null){var r=hn();ni(t,n,i,r),hx(t,e,i)}}function K1(n,e,t){var i=gr(n),r={lane:i,action:t,hasEagerState:!1,eagerState:null,next:null};if(cx(n))ux(e,r);else{var s=n.alternate;if(n.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,t);if(r.hasEagerState=!0,r.eagerState=a,ii(a,o)){var l=e.interleaved;l===null?(r.next=r,Kd(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}t=Wv(n,e,r,i),t!==null&&(r=hn(),ni(t,n,i,r),hx(t,e,i))}}function cx(n){var e=n.alternate;return n===Et||e!==null&&e===Et}function ux(n,e){Jo=_c=!0;var t=n.pending;t===null?e.next=e:(e.next=t.next,t.next=e),n.pending=e}function hx(n,e,t){if(t&4194240){var i=e.lanes;i&=n.pendingLanes,t|=i,e.lanes=t,Od(n,t)}}var Sc={readContext:Xn,useCallback:Qt,useContext:Qt,useEffect:Qt,useImperativeHandle:Qt,useInsertionEffect:Qt,useLayoutEffect:Qt,useMemo:Qt,useReducer:Qt,useRef:Qt,useState:Qt,useDebugValue:Qt,useDeferredValue:Qt,useTransition:Qt,useMutableSource:Qt,useSyncExternalStore:Qt,useId:Qt,unstable_isNewReconciler:!1},j1={readContext:Xn,useCallback:function(n,e){return gi().memoizedState=[n,e===void 0?null:e],n},useContext:Xn,useEffect:M0,useImperativeHandle:function(n,e,t){return t=t!=null?t.concat([n]):null,jl(4194308,4,ix.bind(null,e,n),t)},useLayoutEffect:function(n,e){return jl(4194308,4,n,e)},useInsertionEffect:function(n,e){return jl(4,2,n,e)},useMemo:function(n,e){var t=gi();return e=e===void 0?null:e,n=n(),t.memoizedState=[n,e],n},useReducer:function(n,e,t){var i=gi();return e=t!==void 0?t(e):e,i.memoizedState=i.baseState=e,n={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:n,lastRenderedState:e},i.queue=n,n=n.dispatch=J1.bind(null,Et,n),[i.memoizedState,n]},useRef:function(n){var e=gi();return n={current:n},e.memoizedState=n},useState:S0,useDebugValue:op,useDeferredValue:function(n){return gi().memoizedState=n},useTransition:function(){var n=S0(!1),e=n[0];return n=$1.bind(null,n[1]),gi().memoizedState=n,[e,n]},useMutableSource:function(){},useSyncExternalStore:function(n,e,t){var i=Et,r=gi();if(St){if(t===void 0)throw Error(ce(407));t=t()}else{if(t=e(),Gt===null)throw Error(ce(349));jr&30||$v(i,e,t)}r.memoizedState=t;var s={value:t,getSnapshot:e};return r.queue=s,M0(Kv.bind(null,i,s,n),[n]),i.flags|=2048,ma(9,Jv.bind(null,i,s,t,e),void 0,null),t},useId:function(){var n=gi(),e=Gt.identifierPrefix;if(St){var t=Ni,i=Di;t=(i&~(1<<32-ti(i)-1)).toString(32)+t,e=":"+e+"R"+t,t=da++,0<t&&(e+="H"+t.toString(32)),e+=":"}else t=Z1++,e=":"+e+"r"+t.toString(32)+":";return n.memoizedState=e},unstable_isNewReconciler:!1},Q1={readContext:Xn,useCallback:sx,useContext:Xn,useEffect:sp,useImperativeHandle:rx,useInsertionEffect:tx,useLayoutEffect:nx,useMemo:ox,useReducer:If,useRef:ex,useState:function(){return If(pa)},useDebugValue:op,useDeferredValue:function(n){var e=Yn();return ax(e,Ot.memoizedState,n)},useTransition:function(){var n=If(pa)[0],e=Yn().memoizedState;return[n,e]},useMutableSource:qv,useSyncExternalStore:Zv,useId:lx,unstable_isNewReconciler:!1},eM={readContext:Xn,useCallback:sx,useContext:Xn,useEffect:sp,useImperativeHandle:rx,useInsertionEffect:tx,useLayoutEffect:nx,useMemo:ox,useReducer:Lf,useRef:ex,useState:function(){return Lf(pa)},useDebugValue:op,useDeferredValue:function(n){var e=Yn();return Ot===null?e.memoizedState=n:ax(e,Ot.memoizedState,n)},useTransition:function(){var n=Lf(pa)[0],e=Yn().memoizedState;return[n,e]},useMutableSource:qv,useSyncExternalStore:Zv,useId:lx,unstable_isNewReconciler:!1};function jn(n,e){if(n&&n.defaultProps){e=Tt({},e),n=n.defaultProps;for(var t in n)e[t]===void 0&&(e[t]=n[t]);return e}return e}function dd(n,e,t,i){e=n.memoizedState,t=t(i,e),t=t==null?e:Tt({},e,t),n.memoizedState=t,n.lanes===0&&(n.updateQueue.baseState=t)}var Nc={isMounted:function(n){return(n=n._reactInternals)?ns(n)===n:!1},enqueueSetState:function(n,e,t){n=n._reactInternals;var i=hn(),r=gr(n),s=Ui(i,r);s.payload=e,t!=null&&(s.callback=t),e=pr(n,s,r),e!==null&&(ni(e,n,r,i),Jl(e,n,r))},enqueueReplaceState:function(n,e,t){n=n._reactInternals;var i=hn(),r=gr(n),s=Ui(i,r);s.tag=1,s.payload=e,t!=null&&(s.callback=t),e=pr(n,s,r),e!==null&&(ni(e,n,r,i),Jl(e,n,r))},enqueueForceUpdate:function(n,e){n=n._reactInternals;var t=hn(),i=gr(n),r=Ui(t,i);r.tag=2,e!=null&&(r.callback=e),e=pr(n,r,i),e!==null&&(ni(e,n,i,t),Jl(e,n,i))}};function w0(n,e,t,i,r,s,o){return n=n.stateNode,typeof n.shouldComponentUpdate=="function"?n.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!aa(t,i)||!aa(r,s):!0}function fx(n,e,t){var i=!1,r=yr,s=e.contextType;return typeof s=="object"&&s!==null?s=Xn(s):(r=yn(e)?Jr:nn.current,i=e.contextTypes,s=(i=i!=null)?Vs(n,r):yr),e=new e(t,s),n.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=Nc,n.stateNode=e,e._reactInternals=n,i&&(n=n.stateNode,n.__reactInternalMemoizedUnmaskedChildContext=r,n.__reactInternalMemoizedMaskedChildContext=s),e}function E0(n,e,t,i){n=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(t,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(t,i),e.state!==n&&Nc.enqueueReplaceState(e,e.state,null)}function pd(n,e,t,i){var r=n.stateNode;r.props=t,r.state=n.memoizedState,r.refs={},jd(n);var s=e.contextType;typeof s=="object"&&s!==null?r.context=Xn(s):(s=yn(e)?Jr:nn.current,r.context=Vs(n,s)),r.state=n.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(dd(n,e,s,t),r.state=n.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&Nc.enqueueReplaceState(r,r.state,null),xc(n,t,r,i),r.state=n.memoizedState),typeof r.componentDidMount=="function"&&(n.flags|=4194308)}function Xs(n,e){try{var t="",i=e;do t+=PS(i),i=i.return;while(i);var r=t}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:n,source:e,stack:r,digest:null}}function Df(n,e,t){return{value:n,source:null,stack:t??null,digest:e??null}}function md(n,e){try{console.error(e.value)}catch(t){setTimeout(function(){throw t})}}var tM=typeof WeakMap=="function"?WeakMap:Map;function dx(n,e,t){t=Ui(-1,t),t.tag=3,t.payload={element:null};var i=e.value;return t.callback=function(){wc||(wc=!0,Td=i),md(n,e)},t}function px(n,e,t){t=Ui(-1,t),t.tag=3;var i=n.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;t.payload=function(){return i(r)},t.callback=function(){md(n,e)}}var s=n.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(t.callback=function(){md(n,e),typeof i!="function"&&(mr===null?mr=new Set([this]):mr.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),t}function T0(n,e,t){var i=n.pingCache;if(i===null){i=n.pingCache=new tM;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(t)||(r.add(t),n=mM.bind(null,n,e,t),e.then(n,n))}function A0(n){do{var e;if((e=n.tag===13)&&(e=n.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return n;n=n.return}while(n!==null);return null}function b0(n,e,t,i,r){return n.mode&1?(n.flags|=65536,n.lanes=r,n):(n===e?n.flags|=65536:(n.flags|=128,t.flags|=131072,t.flags&=-52805,t.tag===1&&(t.alternate===null?t.tag=17:(e=Ui(-1,1),e.tag=2,pr(t,e,1))),t.lanes|=1),n)}var nM=zi.ReactCurrentOwner,vn=!1;function un(n,e,t,i){e.child=n===null?Hv(e,null,t,i):Hs(e,n.child,t,i)}function C0(n,e,t,i,r){t=t.render;var s=e.ref;return Bs(e,r),i=ip(n,e,t,i,s,r),t=rp(),n!==null&&!vn?(e.updateQueue=n.updateQueue,e.flags&=-2053,n.lanes&=~r,ki(n,e,r)):(St&&t&&Xd(e),e.flags|=1,un(n,e,i,r),e.child)}function R0(n,e,t,i,r){if(n===null){var s=t.type;return typeof s=="function"&&!pp(s)&&s.defaultProps===void 0&&t.compare===null&&t.defaultProps===void 0?(e.tag=15,e.type=s,mx(n,e,s,i,r)):(n=nc(t.type,null,i,e,e.mode,r),n.ref=e.ref,n.return=e,e.child=n)}if(s=n.child,!(n.lanes&r)){var o=s.memoizedProps;if(t=t.compare,t=t!==null?t:aa,t(o,i)&&n.ref===e.ref)return ki(n,e,r)}return e.flags|=1,n=vr(s,i),n.ref=e.ref,n.return=e,e.child=n}function mx(n,e,t,i,r){if(n!==null){var s=n.memoizedProps;if(aa(s,i)&&n.ref===e.ref)if(vn=!1,e.pendingProps=i=s,(n.lanes&r)!==0)n.flags&131072&&(vn=!0);else return e.lanes=n.lanes,ki(n,e,r)}return gd(n,e,t,i,r)}function gx(n,e,t){var i=e.pendingProps,r=i.children,s=n!==null?n.memoizedState:null;if(i.mode==="hidden")if(!(e.mode&1))e.memoizedState={baseLanes:0,cachePool:null,transitions:null},vt(Ds,Tn),Tn|=t;else{if(!(t&1073741824))return n=s!==null?s.baseLanes|t:t,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:n,cachePool:null,transitions:null},e.updateQueue=null,vt(Ds,Tn),Tn|=n,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:t,vt(Ds,Tn),Tn|=i}else s!==null?(i=s.baseLanes|t,e.memoizedState=null):i=t,vt(Ds,Tn),Tn|=i;return un(n,e,r,t),e.child}function vx(n,e){var t=e.ref;(n===null&&t!==null||n!==null&&n.ref!==t)&&(e.flags|=512,e.flags|=2097152)}function gd(n,e,t,i,r){var s=yn(t)?Jr:nn.current;return s=Vs(e,s),Bs(e,r),t=ip(n,e,t,i,s,r),i=rp(),n!==null&&!vn?(e.updateQueue=n.updateQueue,e.flags&=-2053,n.lanes&=~r,ki(n,e,r)):(St&&i&&Xd(e),e.flags|=1,un(n,e,t,r),e.child)}function P0(n,e,t,i,r){if(yn(t)){var s=!0;dc(e)}else s=!1;if(Bs(e,r),e.stateNode===null)Ql(n,e),fx(e,t,i),pd(e,t,i,r),i=!0;else if(n===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,u=t.contextType;typeof u=="object"&&u!==null?u=Xn(u):(u=yn(t)?Jr:nn.current,u=Vs(e,u));var f=t.getDerivedStateFromProps,c=typeof f=="function"||typeof o.getSnapshotBeforeUpdate=="function";c||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==u)&&E0(e,o,i,u),sr=!1;var h=e.memoizedState;o.state=h,xc(e,i,o,r),l=e.memoizedState,a!==i||h!==l||xn.current||sr?(typeof f=="function"&&(dd(e,t,f,i),l=e.memoizedState),(a=sr||w0(e,t,a,i,h,l,u))?(c||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=u,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,Xv(n,e),a=e.memoizedProps,u=e.type===e.elementType?a:jn(e.type,a),o.props=u,c=e.pendingProps,h=o.context,l=t.contextType,typeof l=="object"&&l!==null?l=Xn(l):(l=yn(t)?Jr:nn.current,l=Vs(e,l));var d=t.getDerivedStateFromProps;(f=typeof d=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==c||h!==l)&&E0(e,o,i,l),sr=!1,h=e.memoizedState,o.state=h,xc(e,i,o,r);var p=e.memoizedState;a!==c||h!==p||xn.current||sr?(typeof d=="function"&&(dd(e,t,d,i),p=e.memoizedState),(u=sr||w0(e,t,u,i,h,p,l)||!1)?(f||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,p,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,p,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===n.memoizedProps&&h===n.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===n.memoizedProps&&h===n.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=p),o.props=i,o.state=p,o.context=l,i=u):(typeof o.componentDidUpdate!="function"||a===n.memoizedProps&&h===n.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===n.memoizedProps&&h===n.memoizedState||(e.flags|=1024),i=!1)}return vd(n,e,t,i,s,r)}function vd(n,e,t,i,r,s){vx(n,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&m0(e,t,!1),ki(n,e,s);i=e.stateNode,nM.current=e;var a=o&&typeof t.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,n!==null&&o?(e.child=Hs(e,n.child,null,s),e.child=Hs(e,null,a,s)):un(n,e,a,s),e.memoizedState=i.state,r&&m0(e,t,!0),e.child}function xx(n){var e=n.stateNode;e.pendingContext?p0(n,e.pendingContext,e.pendingContext!==e.context):e.context&&p0(n,e.context,!1),Qd(n,e.containerInfo)}function I0(n,e,t,i,r){return Gs(),qd(r),e.flags|=256,un(n,e,t,i),e.child}var xd={dehydrated:null,treeContext:null,retryLane:0};function yd(n){return{baseLanes:n,cachePool:null,transitions:null}}function yx(n,e,t){var i=e.pendingProps,r=wt.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=n!==null&&n.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(n===null||n.memoizedState!==null)&&(r|=1),vt(wt,r&1),n===null)return hd(e),n=e.memoizedState,n!==null&&(n=n.dehydrated,n!==null)?(e.mode&1?n.data==="$!"?e.lanes=8:e.lanes=1073741824:e.lanes=1,null):(o=i.children,n=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},!(i&1)&&s!==null?(s.childLanes=0,s.pendingProps=o):s=Oc(o,i,0,null),n=$r(n,i,t,null),s.return=e,n.return=e,s.sibling=n,e.child=s,e.child.memoizedState=yd(t),e.memoizedState=xd,n):ap(e,o));if(r=n.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return iM(n,e,o,i,a,r,t);if(s){s=i.fallback,o=e.mode,r=n.child,a=r.sibling;var l={mode:"hidden",children:i.children};return!(o&1)&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=vr(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=vr(a,s):(s=$r(s,o,t,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=n.child.memoizedState,o=o===null?yd(t):{baseLanes:o.baseLanes|t,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=n.childLanes&~t,e.memoizedState=xd,i}return s=n.child,n=s.sibling,i=vr(s,{mode:"visible",children:i.children}),!(e.mode&1)&&(i.lanes=t),i.return=e,i.sibling=null,n!==null&&(t=e.deletions,t===null?(e.deletions=[n],e.flags|=16):t.push(n)),e.child=i,e.memoizedState=null,i}function ap(n,e){return e=Oc({mode:"visible",children:e},n.mode,0,null),e.return=n,n.child=e}function Wl(n,e,t,i){return i!==null&&qd(i),Hs(e,n.child,null,t),n=ap(e,e.pendingProps.children),n.flags|=2,e.memoizedState=null,n}function iM(n,e,t,i,r,s,o){if(t)return e.flags&256?(e.flags&=-257,i=Df(Error(ce(422))),Wl(n,e,o,i)):e.memoizedState!==null?(e.child=n.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=Oc({mode:"visible",children:i.children},r,0,null),s=$r(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,e.mode&1&&Hs(e,n.child,null,o),e.child.memoizedState=yd(o),e.memoizedState=xd,s);if(!(e.mode&1))return Wl(n,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(ce(419)),i=Df(s,i,void 0),Wl(n,e,o,i)}if(a=(o&n.childLanes)!==0,vn||a){if(i=Gt,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=r&(i.suspendedLanes|o)?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,Bi(n,r),ni(i,n,r,-1))}return dp(),i=Df(Error(ce(421))),Wl(n,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=n.child,e=gM.bind(null,n),r._reactRetry=e,null):(n=s.treeContext,An=dr(r.nextSibling),bn=e,St=!0,ei=null,n!==null&&(Vn[Gn++]=Di,Vn[Gn++]=Ni,Vn[Gn++]=Kr,Di=n.id,Ni=n.overflow,Kr=e),e=ap(e,i.children),e.flags|=4096,e)}function L0(n,e,t){n.lanes|=e;var i=n.alternate;i!==null&&(i.lanes|=e),fd(n.return,e,t)}function Nf(n,e,t,i,r){var s=n.memoizedState;s===null?n.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:t,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=t,s.tailMode=r)}function _x(n,e,t){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(un(n,e,i.children,t),i=wt.current,i&2)i=i&1|2,e.flags|=128;else{if(n!==null&&n.flags&128)e:for(n=e.child;n!==null;){if(n.tag===13)n.memoizedState!==null&&L0(n,t,e);else if(n.tag===19)L0(n,t,e);else if(n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break e;for(;n.sibling===null;){if(n.return===null||n.return===e)break e;n=n.return}n.sibling.return=n.return,n=n.sibling}i&=1}if(vt(wt,i),!(e.mode&1))e.memoizedState=null;else switch(r){case"forwards":for(t=e.child,r=null;t!==null;)n=t.alternate,n!==null&&yc(n)===null&&(r=t),t=t.sibling;t=r,t===null?(r=e.child,e.child=null):(r=t.sibling,t.sibling=null),Nf(e,!1,r,t,s);break;case"backwards":for(t=null,r=e.child,e.child=null;r!==null;){if(n=r.alternate,n!==null&&yc(n)===null){e.child=r;break}n=r.sibling,r.sibling=t,t=r,r=n}Nf(e,!0,t,null,s);break;case"together":Nf(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function Ql(n,e){!(e.mode&1)&&n!==null&&(n.alternate=null,e.alternate=null,e.flags|=2)}function ki(n,e,t){if(n!==null&&(e.dependencies=n.dependencies),Qr|=e.lanes,!(t&e.childLanes))return null;if(n!==null&&e.child!==n.child)throw Error(ce(153));if(e.child!==null){for(n=e.child,t=vr(n,n.pendingProps),e.child=t,t.return=e;n.sibling!==null;)n=n.sibling,t=t.sibling=vr(n,n.pendingProps),t.return=e;t.sibling=null}return e.child}function rM(n,e,t){switch(e.tag){case 3:xx(e),Gs();break;case 5:Yv(e);break;case 1:yn(e.type)&&dc(e);break;case 4:Qd(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;vt(gc,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(vt(wt,wt.current&1),e.flags|=128,null):t&e.child.childLanes?yx(n,e,t):(vt(wt,wt.current&1),n=ki(n,e,t),n!==null?n.sibling:null);vt(wt,wt.current&1);break;case 19:if(i=(t&e.childLanes)!==0,n.flags&128){if(i)return _x(n,e,t);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),vt(wt,wt.current),i)break;return null;case 22:case 23:return e.lanes=0,gx(n,e,t)}return ki(n,e,t)}var Sx,_d,Mx,wx;Sx=function(n,e){for(var t=e.child;t!==null;){if(t.tag===5||t.tag===6)n.appendChild(t.stateNode);else if(t.tag!==4&&t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break;for(;t.sibling===null;){if(t.return===null||t.return===e)return;t=t.return}t.sibling.return=t.return,t=t.sibling}};_d=function(){};Mx=function(n,e,t,i){var r=n.memoizedProps;if(r!==i){n=e.stateNode,qr(yi.current);var s=null;switch(t){case"input":r=Gf(n,r),i=Gf(n,i),s=[];break;case"select":r=Tt({},r,{value:void 0}),i=Tt({},i,{value:void 0}),s=[];break;case"textarea":r=Xf(n,r),i=Xf(n,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(n.onclick=hc)}qf(t,i);var o;t=null;for(u in r)if(!i.hasOwnProperty(u)&&r.hasOwnProperty(u)&&r[u]!=null)if(u==="style"){var a=r[u];for(o in a)a.hasOwnProperty(o)&&(t||(t={}),t[o]="")}else u!=="dangerouslySetInnerHTML"&&u!=="children"&&u!=="suppressContentEditableWarning"&&u!=="suppressHydrationWarning"&&u!=="autoFocus"&&(ea.hasOwnProperty(u)?s||(s=[]):(s=s||[]).push(u,null));for(u in i){var l=i[u];if(a=r!=null?r[u]:void 0,i.hasOwnProperty(u)&&l!==a&&(l!=null||a!=null))if(u==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(t||(t={}),t[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(t||(t={}),t[o]=l[o])}else t||(s||(s=[]),s.push(u,t)),t=l;else u==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(u,l)):u==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(u,""+l):u!=="suppressContentEditableWarning"&&u!=="suppressHydrationWarning"&&(ea.hasOwnProperty(u)?(l!=null&&u==="onScroll"&&xt("scroll",n),s||a===l||(s=[])):(s=s||[]).push(u,l))}t&&(s=s||[]).push("style",t);var u=s;(e.updateQueue=u)&&(e.flags|=4)}};wx=function(n,e,t,i){t!==i&&(e.flags|=4)};function Bo(n,e){if(!St)switch(n.tailMode){case"hidden":e=n.tail;for(var t=null;e!==null;)e.alternate!==null&&(t=e),e=e.sibling;t===null?n.tail=null:t.sibling=null;break;case"collapsed":t=n.tail;for(var i=null;t!==null;)t.alternate!==null&&(i=t),t=t.sibling;i===null?e||n.tail===null?n.tail=null:n.tail.sibling=null:i.sibling=null}}function en(n){var e=n.alternate!==null&&n.alternate.child===n.child,t=0,i=0;if(e)for(var r=n.child;r!==null;)t|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=n,r=r.sibling;else for(r=n.child;r!==null;)t|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=n,r=r.sibling;return n.subtreeFlags|=i,n.childLanes=t,e}function sM(n,e,t){var i=e.pendingProps;switch(Yd(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return en(e),null;case 1:return yn(e.type)&&fc(),en(e),null;case 3:return i=e.stateNode,Ws(),yt(xn),yt(nn),tp(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(n===null||n.child===null)&&(Gl(e)?e.flags|=4:n===null||n.memoizedState.isDehydrated&&!(e.flags&256)||(e.flags|=1024,ei!==null&&(Cd(ei),ei=null))),_d(n,e),en(e),null;case 5:ep(e);var r=qr(fa.current);if(t=e.type,n!==null&&e.stateNode!=null)Mx(n,e,t,i,r),n.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(ce(166));return en(e),null}if(n=qr(yi.current),Gl(e)){i=e.stateNode,t=e.type;var s=e.memoizedProps;switch(i[vi]=e,i[ua]=s,n=(e.mode&1)!==0,t){case"dialog":xt("cancel",i),xt("close",i);break;case"iframe":case"object":case"embed":xt("load",i);break;case"video":case"audio":for(r=0;r<Wo.length;r++)xt(Wo[r],i);break;case"source":xt("error",i);break;case"img":case"image":case"link":xt("error",i),xt("load",i);break;case"details":xt("toggle",i);break;case"input":zg(i,s),xt("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},xt("invalid",i);break;case"textarea":Gg(i,s),xt("invalid",i)}qf(t,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&Vl(i.textContent,a,n),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&Vl(i.textContent,a,n),r=["children",""+a]):ea.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&xt("scroll",i)}switch(t){case"input":Rl(i),Vg(i,s,!0);break;case"textarea":Rl(i),Hg(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=hc)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,n==="http://www.w3.org/1999/xhtml"&&(n=K0(t)),n==="http://www.w3.org/1999/xhtml"?t==="script"?(n=o.createElement("div"),n.innerHTML="<script><\/script>",n=n.removeChild(n.firstChild)):typeof i.is=="string"?n=o.createElement(t,{is:i.is}):(n=o.createElement(t),t==="select"&&(o=n,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):n=o.createElementNS(n,t),n[vi]=e,n[ua]=i,Sx(n,e,!1,!1),e.stateNode=n;e:{switch(o=Zf(t,i),t){case"dialog":xt("cancel",n),xt("close",n),r=i;break;case"iframe":case"object":case"embed":xt("load",n),r=i;break;case"video":case"audio":for(r=0;r<Wo.length;r++)xt(Wo[r],n);r=i;break;case"source":xt("error",n),r=i;break;case"img":case"image":case"link":xt("error",n),xt("load",n),r=i;break;case"details":xt("toggle",n),r=i;break;case"input":zg(n,i),r=Gf(n,i),xt("invalid",n);break;case"option":r=i;break;case"select":n._wrapperState={wasMultiple:!!i.multiple},r=Tt({},i,{value:void 0}),xt("invalid",n);break;case"textarea":Gg(n,i),r=Xf(n,i),xt("invalid",n);break;default:r=i}qf(t,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?ev(n,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&j0(n,l)):s==="children"?typeof l=="string"?(t!=="textarea"||l!=="")&&ta(n,l):typeof l=="number"&&ta(n,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(ea.hasOwnProperty(s)?l!=null&&s==="onScroll"&&xt("scroll",n):l!=null&&Id(n,s,l,o))}switch(t){case"input":Rl(n),Vg(n,i,!1);break;case"textarea":Rl(n),Hg(n);break;case"option":i.value!=null&&n.setAttribute("value",""+xr(i.value));break;case"select":n.multiple=!!i.multiple,s=i.value,s!=null?Ns(n,!!i.multiple,s,!1):i.defaultValue!=null&&Ns(n,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(n.onclick=hc)}switch(t){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return en(e),null;case 6:if(n&&e.stateNode!=null)wx(n,e,n.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(ce(166));if(t=qr(fa.current),qr(yi.current),Gl(e)){if(i=e.stateNode,t=e.memoizedProps,i[vi]=e,(s=i.nodeValue!==t)&&(n=bn,n!==null))switch(n.tag){case 3:Vl(i.nodeValue,t,(n.mode&1)!==0);break;case 5:n.memoizedProps.suppressHydrationWarning!==!0&&Vl(i.nodeValue,t,(n.mode&1)!==0)}s&&(e.flags|=4)}else i=(t.nodeType===9?t:t.ownerDocument).createTextNode(i),i[vi]=e,e.stateNode=i}return en(e),null;case 13:if(yt(wt),i=e.memoizedState,n===null||n.memoizedState!==null&&n.memoizedState.dehydrated!==null){if(St&&An!==null&&e.mode&1&&!(e.flags&128))Vv(),Gs(),e.flags|=98560,s=!1;else if(s=Gl(e),i!==null&&i.dehydrated!==null){if(n===null){if(!s)throw Error(ce(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(ce(317));s[vi]=e}else Gs(),!(e.flags&128)&&(e.memoizedState=null),e.flags|=4;en(e),s=!1}else ei!==null&&(Cd(ei),ei=null),s=!0;if(!s)return e.flags&65536?e:null}return e.flags&128?(e.lanes=t,e):(i=i!==null,i!==(n!==null&&n.memoizedState!==null)&&i&&(e.child.flags|=8192,e.mode&1&&(n===null||wt.current&1?Bt===0&&(Bt=3):dp())),e.updateQueue!==null&&(e.flags|=4),en(e),null);case 4:return Ws(),_d(n,e),n===null&&la(e.stateNode.containerInfo),en(e),null;case 10:return Jd(e.type._context),en(e),null;case 17:return yn(e.type)&&fc(),en(e),null;case 19:if(yt(wt),s=e.memoizedState,s===null)return en(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)Bo(s,!1);else{if(Bt!==0||n!==null&&n.flags&128)for(n=e.child;n!==null;){if(o=yc(n),o!==null){for(e.flags|=128,Bo(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=t,t=e.child;t!==null;)s=t,n=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=n,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,n=o.dependencies,s.dependencies=n===null?null:{lanes:n.lanes,firstContext:n.firstContext}),t=t.sibling;return vt(wt,wt.current&1|2),e.child}n=n.sibling}s.tail!==null&&Nt()>Ys&&(e.flags|=128,i=!0,Bo(s,!1),e.lanes=4194304)}else{if(!i)if(n=yc(o),n!==null){if(e.flags|=128,i=!0,t=n.updateQueue,t!==null&&(e.updateQueue=t,e.flags|=4),Bo(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!St)return en(e),null}else 2*Nt()-s.renderingStartTime>Ys&&t!==1073741824&&(e.flags|=128,i=!0,Bo(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(t=s.last,t!==null?t.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=Nt(),e.sibling=null,t=wt.current,vt(wt,i?t&1|2:t&1),e):(en(e),null);case 22:case 23:return fp(),i=e.memoizedState!==null,n!==null&&n.memoizedState!==null!==i&&(e.flags|=8192),i&&e.mode&1?Tn&1073741824&&(en(e),e.subtreeFlags&6&&(e.flags|=8192)):en(e),null;case 24:return null;case 25:return null}throw Error(ce(156,e.tag))}function oM(n,e){switch(Yd(e),e.tag){case 1:return yn(e.type)&&fc(),n=e.flags,n&65536?(e.flags=n&-65537|128,e):null;case 3:return Ws(),yt(xn),yt(nn),tp(),n=e.flags,n&65536&&!(n&128)?(e.flags=n&-65537|128,e):null;case 5:return ep(e),null;case 13:if(yt(wt),n=e.memoizedState,n!==null&&n.dehydrated!==null){if(e.alternate===null)throw Error(ce(340));Gs()}return n=e.flags,n&65536?(e.flags=n&-65537|128,e):null;case 19:return yt(wt),null;case 4:return Ws(),null;case 10:return Jd(e.type._context),null;case 22:case 23:return fp(),null;case 24:return null;default:return null}}var Xl=!1,tn=!1,aM=typeof WeakSet=="function"?WeakSet:Set,Pe=null;function Ls(n,e){var t=n.ref;if(t!==null)if(typeof t=="function")try{t(null)}catch(i){Pt(n,e,i)}else t.current=null}function Sd(n,e,t){try{t()}catch(i){Pt(n,e,i)}}var D0=!1;function lM(n,e){if(rd=lc,n=Cv(),Wd(n)){if("selectionStart"in n)var t={start:n.selectionStart,end:n.selectionEnd};else e:{t=(t=n.ownerDocument)&&t.defaultView||window;var i=t.getSelection&&t.getSelection();if(i&&i.rangeCount!==0){t=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{t.nodeType,s.nodeType}catch{t=null;break e}var o=0,a=-1,l=-1,u=0,f=0,c=n,h=null;t:for(;;){for(var d;c!==t||r!==0&&c.nodeType!==3||(a=o+r),c!==s||i!==0&&c.nodeType!==3||(l=o+i),c.nodeType===3&&(o+=c.nodeValue.length),(d=c.firstChild)!==null;)h=c,c=d;for(;;){if(c===n)break t;if(h===t&&++u===r&&(a=o),h===s&&++f===i&&(l=o),(d=c.nextSibling)!==null)break;c=h,h=c.parentNode}c=d}t=a===-1||l===-1?null:{start:a,end:l}}else t=null}t=t||{start:0,end:0}}else t=null;for(sd={focusedElem:n,selectionRange:t},lc=!1,Pe=e;Pe!==null;)if(e=Pe,n=e.child,(e.subtreeFlags&1028)!==0&&n!==null)n.return=e,Pe=n;else for(;Pe!==null;){e=Pe;try{var p=e.alternate;if(e.flags&1024)switch(e.tag){case 0:case 11:case 15:break;case 1:if(p!==null){var _=p.memoizedProps,y=p.memoizedState,m=e.stateNode,v=m.getSnapshotBeforeUpdate(e.elementType===e.type?_:jn(e.type,_),y);m.__reactInternalSnapshotBeforeUpdate=v}break;case 3:var g=e.stateNode.containerInfo;g.nodeType===1?g.textContent="":g.nodeType===9&&g.documentElement&&g.removeChild(g.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(ce(163))}}catch(S){Pt(e,e.return,S)}if(n=e.sibling,n!==null){n.return=e.return,Pe=n;break}Pe=e.return}return p=D0,D0=!1,p}function Ko(n,e,t){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&n)===n){var s=r.destroy;r.destroy=void 0,s!==void 0&&Sd(e,t,s)}r=r.next}while(r!==i)}}function Uc(n,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var t=e=e.next;do{if((t.tag&n)===n){var i=t.create;t.destroy=i()}t=t.next}while(t!==e)}}function Md(n){var e=n.ref;if(e!==null){var t=n.stateNode;switch(n.tag){case 5:n=t;break;default:n=t}typeof e=="function"?e(n):e.current=n}}function Ex(n){var e=n.alternate;e!==null&&(n.alternate=null,Ex(e)),n.child=null,n.deletions=null,n.sibling=null,n.tag===5&&(e=n.stateNode,e!==null&&(delete e[vi],delete e[ua],delete e[ld],delete e[W1],delete e[X1])),n.stateNode=null,n.return=null,n.dependencies=null,n.memoizedProps=null,n.memoizedState=null,n.pendingProps=null,n.stateNode=null,n.updateQueue=null}function Tx(n){return n.tag===5||n.tag===3||n.tag===4}function N0(n){e:for(;;){for(;n.sibling===null;){if(n.return===null||Tx(n.return))return null;n=n.return}for(n.sibling.return=n.return,n=n.sibling;n.tag!==5&&n.tag!==6&&n.tag!==18;){if(n.flags&2||n.child===null||n.tag===4)continue e;n.child.return=n,n=n.child}if(!(n.flags&2))return n.stateNode}}function wd(n,e,t){var i=n.tag;if(i===5||i===6)n=n.stateNode,e?t.nodeType===8?t.parentNode.insertBefore(n,e):t.insertBefore(n,e):(t.nodeType===8?(e=t.parentNode,e.insertBefore(n,t)):(e=t,e.appendChild(n)),t=t._reactRootContainer,t!=null||e.onclick!==null||(e.onclick=hc));else if(i!==4&&(n=n.child,n!==null))for(wd(n,e,t),n=n.sibling;n!==null;)wd(n,e,t),n=n.sibling}function Ed(n,e,t){var i=n.tag;if(i===5||i===6)n=n.stateNode,e?t.insertBefore(n,e):t.appendChild(n);else if(i!==4&&(n=n.child,n!==null))for(Ed(n,e,t),n=n.sibling;n!==null;)Ed(n,e,t),n=n.sibling}var Yt=null,Qn=!1;function ir(n,e,t){for(t=t.child;t!==null;)Ax(n,e,t),t=t.sibling}function Ax(n,e,t){if(xi&&typeof xi.onCommitFiberUnmount=="function")try{xi.onCommitFiberUnmount(bc,t)}catch{}switch(t.tag){case 5:tn||Ls(t,e);case 6:var i=Yt,r=Qn;Yt=null,ir(n,e,t),Yt=i,Qn=r,Yt!==null&&(Qn?(n=Yt,t=t.stateNode,n.nodeType===8?n.parentNode.removeChild(t):n.removeChild(t)):Yt.removeChild(t.stateNode));break;case 18:Yt!==null&&(Qn?(n=Yt,t=t.stateNode,n.nodeType===8?bf(n.parentNode,t):n.nodeType===1&&bf(n,t),sa(n)):bf(Yt,t.stateNode));break;case 4:i=Yt,r=Qn,Yt=t.stateNode.containerInfo,Qn=!0,ir(n,e,t),Yt=i,Qn=r;break;case 0:case 11:case 14:case 15:if(!tn&&(i=t.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&(s&2||s&4)&&Sd(t,e,o),r=r.next}while(r!==i)}ir(n,e,t);break;case 1:if(!tn&&(Ls(t,e),i=t.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=t.memoizedProps,i.state=t.memoizedState,i.componentWillUnmount()}catch(a){Pt(t,e,a)}ir(n,e,t);break;case 21:ir(n,e,t);break;case 22:t.mode&1?(tn=(i=tn)||t.memoizedState!==null,ir(n,e,t),tn=i):ir(n,e,t);break;default:ir(n,e,t)}}function U0(n){var e=n.updateQueue;if(e!==null){n.updateQueue=null;var t=n.stateNode;t===null&&(t=n.stateNode=new aM),e.forEach(function(i){var r=vM.bind(null,n,i);t.has(i)||(t.add(i),i.then(r,r))})}}function Kn(n,e){var t=e.deletions;if(t!==null)for(var i=0;i<t.length;i++){var r=t[i];try{var s=n,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:Yt=a.stateNode,Qn=!1;break e;case 3:Yt=a.stateNode.containerInfo,Qn=!0;break e;case 4:Yt=a.stateNode.containerInfo,Qn=!0;break e}a=a.return}if(Yt===null)throw Error(ce(160));Ax(s,o,r),Yt=null,Qn=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(u){Pt(r,e,u)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)bx(e,n),e=e.sibling}function bx(n,e){var t=n.alternate,i=n.flags;switch(n.tag){case 0:case 11:case 14:case 15:if(Kn(e,n),mi(n),i&4){try{Ko(3,n,n.return),Uc(3,n)}catch(_){Pt(n,n.return,_)}try{Ko(5,n,n.return)}catch(_){Pt(n,n.return,_)}}break;case 1:Kn(e,n),mi(n),i&512&&t!==null&&Ls(t,t.return);break;case 5:if(Kn(e,n),mi(n),i&512&&t!==null&&Ls(t,t.return),n.flags&32){var r=n.stateNode;try{ta(r,"")}catch(_){Pt(n,n.return,_)}}if(i&4&&(r=n.stateNode,r!=null)){var s=n.memoizedProps,o=t!==null?t.memoizedProps:s,a=n.type,l=n.updateQueue;if(n.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&$0(r,s),Zf(a,o);var u=Zf(a,s);for(o=0;o<l.length;o+=2){var f=l[o],c=l[o+1];f==="style"?ev(r,c):f==="dangerouslySetInnerHTML"?j0(r,c):f==="children"?ta(r,c):Id(r,f,c,u)}switch(a){case"input":Hf(r,s);break;case"textarea":J0(r,s);break;case"select":var h=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var d=s.value;d!=null?Ns(r,!!s.multiple,d,!1):h!==!!s.multiple&&(s.defaultValue!=null?Ns(r,!!s.multiple,s.defaultValue,!0):Ns(r,!!s.multiple,s.multiple?[]:"",!1))}r[ua]=s}catch(_){Pt(n,n.return,_)}}break;case 6:if(Kn(e,n),mi(n),i&4){if(n.stateNode===null)throw Error(ce(162));r=n.stateNode,s=n.memoizedProps;try{r.nodeValue=s}catch(_){Pt(n,n.return,_)}}break;case 3:if(Kn(e,n),mi(n),i&4&&t!==null&&t.memoizedState.isDehydrated)try{sa(e.containerInfo)}catch(_){Pt(n,n.return,_)}break;case 4:Kn(e,n),mi(n);break;case 13:Kn(e,n),mi(n),r=n.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(up=Nt())),i&4&&U0(n);break;case 22:if(f=t!==null&&t.memoizedState!==null,n.mode&1?(tn=(u=tn)||f,Kn(e,n),tn=u):Kn(e,n),mi(n),i&8192){if(u=n.memoizedState!==null,(n.stateNode.isHidden=u)&&!f&&n.mode&1)for(Pe=n,f=n.child;f!==null;){for(c=Pe=f;Pe!==null;){switch(h=Pe,d=h.child,h.tag){case 0:case 11:case 14:case 15:Ko(4,h,h.return);break;case 1:Ls(h,h.return);var p=h.stateNode;if(typeof p.componentWillUnmount=="function"){i=h,t=h.return;try{e=i,p.props=e.memoizedProps,p.state=e.memoizedState,p.componentWillUnmount()}catch(_){Pt(i,t,_)}}break;case 5:Ls(h,h.return);break;case 22:if(h.memoizedState!==null){O0(c);continue}}d!==null?(d.return=h,Pe=d):O0(c)}f=f.sibling}e:for(f=null,c=n;;){if(c.tag===5){if(f===null){f=c;try{r=c.stateNode,u?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=c.stateNode,l=c.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=Q0("display",o))}catch(_){Pt(n,n.return,_)}}}else if(c.tag===6){if(f===null)try{c.stateNode.nodeValue=u?"":c.memoizedProps}catch(_){Pt(n,n.return,_)}}else if((c.tag!==22&&c.tag!==23||c.memoizedState===null||c===n)&&c.child!==null){c.child.return=c,c=c.child;continue}if(c===n)break e;for(;c.sibling===null;){if(c.return===null||c.return===n)break e;f===c&&(f=null),c=c.return}f===c&&(f=null),c.sibling.return=c.return,c=c.sibling}}break;case 19:Kn(e,n),mi(n),i&4&&U0(n);break;case 21:break;default:Kn(e,n),mi(n)}}function mi(n){var e=n.flags;if(e&2){try{e:{for(var t=n.return;t!==null;){if(Tx(t)){var i=t;break e}t=t.return}throw Error(ce(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(ta(r,""),i.flags&=-33);var s=N0(n);Ed(n,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=N0(n);wd(n,a,o);break;default:throw Error(ce(161))}}catch(l){Pt(n,n.return,l)}n.flags&=-3}e&4096&&(n.flags&=-4097)}function cM(n,e,t){Pe=n,Cx(n,e,t)}function Cx(n,e,t){for(var i=(n.mode&1)!==0;Pe!==null;){var r=Pe,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||Xl;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||tn;a=Xl;var u=tn;if(Xl=o,(tn=l)&&!u)for(Pe=r;Pe!==null;)o=Pe,l=o.child,o.tag===22&&o.memoizedState!==null?B0(r):l!==null?(l.return=o,Pe=l):B0(r);for(;s!==null;)Pe=s,Cx(s,e,t),s=s.sibling;Pe=r,Xl=a,tn=u}F0(n,e,t)}else r.subtreeFlags&8772&&s!==null?(s.return=r,Pe=s):F0(n,e,t)}}function F0(n){for(;Pe!==null;){var e=Pe;if(e.flags&8772){var t=e.alternate;try{if(e.flags&8772)switch(e.tag){case 0:case 11:case 15:tn||Uc(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!tn)if(t===null)i.componentDidMount();else{var r=e.elementType===e.type?t.memoizedProps:jn(e.type,t.memoizedProps);i.componentDidUpdate(r,t.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&_0(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(t=null,e.child!==null)switch(e.child.tag){case 5:t=e.child.stateNode;break;case 1:t=e.child.stateNode}_0(e,o,t)}break;case 5:var a=e.stateNode;if(t===null&&e.flags&4){t=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&t.focus();break;case"img":l.src&&(t.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var u=e.alternate;if(u!==null){var f=u.memoizedState;if(f!==null){var c=f.dehydrated;c!==null&&sa(c)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(ce(163))}tn||e.flags&512&&Md(e)}catch(h){Pt(e,e.return,h)}}if(e===n){Pe=null;break}if(t=e.sibling,t!==null){t.return=e.return,Pe=t;break}Pe=e.return}}function O0(n){for(;Pe!==null;){var e=Pe;if(e===n){Pe=null;break}var t=e.sibling;if(t!==null){t.return=e.return,Pe=t;break}Pe=e.return}}function B0(n){for(;Pe!==null;){var e=Pe;try{switch(e.tag){case 0:case 11:case 15:var t=e.return;try{Uc(4,e)}catch(l){Pt(e,t,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){Pt(e,r,l)}}var s=e.return;try{Md(e)}catch(l){Pt(e,s,l)}break;case 5:var o=e.return;try{Md(e)}catch(l){Pt(e,o,l)}}}catch(l){Pt(e,e.return,l)}if(e===n){Pe=null;break}var a=e.sibling;if(a!==null){a.return=e.return,Pe=a;break}Pe=e.return}}var uM=Math.ceil,Mc=zi.ReactCurrentDispatcher,lp=zi.ReactCurrentOwner,Wn=zi.ReactCurrentBatchConfig,ot=0,Gt=null,Ut=null,qt=0,Tn=0,Ds=Sr(0),Bt=0,ga=null,Qr=0,Fc=0,cp=0,jo=null,gn=null,up=0,Ys=1/0,Ii=null,wc=!1,Td=null,mr=null,Yl=!1,cr=null,Ec=0,Qo=0,Ad=null,ec=-1,tc=0;function hn(){return ot&6?Nt():ec!==-1?ec:ec=Nt()}function gr(n){return n.mode&1?ot&2&&qt!==0?qt&-qt:q1.transition!==null?(tc===0&&(tc=fv()),tc):(n=ct,n!==0||(n=window.event,n=n===void 0?16:yv(n.type)),n):1}function ni(n,e,t,i){if(50<Qo)throw Qo=0,Ad=null,Error(ce(185));va(n,t,i),(!(ot&2)||n!==Gt)&&(n===Gt&&(!(ot&2)&&(Fc|=t),Bt===4&&ar(n,qt)),_n(n,i),t===1&&ot===0&&!(e.mode&1)&&(Ys=Nt()+500,Lc&&Mr()))}function _n(n,e){var t=n.callbackNode;$S(n,e);var i=ac(n,n===Gt?qt:0);if(i===0)t!==null&&Yg(t),n.callbackNode=null,n.callbackPriority=0;else if(e=i&-i,n.callbackPriority!==e){if(t!=null&&Yg(t),e===1)n.tag===0?Y1(k0.bind(null,n)):Bv(k0.bind(null,n)),G1(function(){!(ot&6)&&Mr()}),t=null;else{switch(dv(i)){case 1:t=Fd;break;case 4:t=uv;break;case 16:t=oc;break;case 536870912:t=hv;break;default:t=oc}t=Fx(t,Rx.bind(null,n))}n.callbackPriority=e,n.callbackNode=t}}function Rx(n,e){if(ec=-1,tc=0,ot&6)throw Error(ce(327));var t=n.callbackNode;if(ks()&&n.callbackNode!==t)return null;var i=ac(n,n===Gt?qt:0);if(i===0)return null;if(i&30||i&n.expiredLanes||e)e=Tc(n,i);else{e=i;var r=ot;ot|=2;var s=Ix();(Gt!==n||qt!==e)&&(Ii=null,Ys=Nt()+500,Zr(n,e));do try{dM();break}catch(a){Px(n,a)}while(!0);$d(),Mc.current=s,ot=r,Ut!==null?e=0:(Gt=null,qt=0,e=Bt)}if(e!==0){if(e===2&&(r=Qf(n),r!==0&&(i=r,e=bd(n,r))),e===1)throw t=ga,Zr(n,0),ar(n,i),_n(n,Nt()),t;if(e===6)ar(n,i);else{if(r=n.current.alternate,!(i&30)&&!hM(r)&&(e=Tc(n,i),e===2&&(s=Qf(n),s!==0&&(i=s,e=bd(n,s))),e===1))throw t=ga,Zr(n,0),ar(n,i),_n(n,Nt()),t;switch(n.finishedWork=r,n.finishedLanes=i,e){case 0:case 1:throw Error(ce(345));case 2:Wr(n,gn,Ii);break;case 3:if(ar(n,i),(i&130023424)===i&&(e=up+500-Nt(),10<e)){if(ac(n,0)!==0)break;if(r=n.suspendedLanes,(r&i)!==i){hn(),n.pingedLanes|=n.suspendedLanes&r;break}n.timeoutHandle=ad(Wr.bind(null,n,gn,Ii),e);break}Wr(n,gn,Ii);break;case 4:if(ar(n,i),(i&4194240)===i)break;for(e=n.eventTimes,r=-1;0<i;){var o=31-ti(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=Nt()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*uM(i/1960))-i,10<i){n.timeoutHandle=ad(Wr.bind(null,n,gn,Ii),i);break}Wr(n,gn,Ii);break;case 5:Wr(n,gn,Ii);break;default:throw Error(ce(329))}}}return _n(n,Nt()),n.callbackNode===t?Rx.bind(null,n):null}function bd(n,e){var t=jo;return n.current.memoizedState.isDehydrated&&(Zr(n,e).flags|=256),n=Tc(n,e),n!==2&&(e=gn,gn=t,e!==null&&Cd(e)),n}function Cd(n){gn===null?gn=n:gn.push.apply(gn,n)}function hM(n){for(var e=n;;){if(e.flags&16384){var t=e.updateQueue;if(t!==null&&(t=t.stores,t!==null))for(var i=0;i<t.length;i++){var r=t[i],s=r.getSnapshot;r=r.value;try{if(!ii(s(),r))return!1}catch{return!1}}}if(t=e.child,e.subtreeFlags&16384&&t!==null)t.return=e,e=t;else{if(e===n)break;for(;e.sibling===null;){if(e.return===null||e.return===n)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function ar(n,e){for(e&=~cp,e&=~Fc,n.suspendedLanes|=e,n.pingedLanes&=~e,n=n.expirationTimes;0<e;){var t=31-ti(e),i=1<<t;n[t]=-1,e&=~i}}function k0(n){if(ot&6)throw Error(ce(327));ks();var e=ac(n,0);if(!(e&1))return _n(n,Nt()),null;var t=Tc(n,e);if(n.tag!==0&&t===2){var i=Qf(n);i!==0&&(e=i,t=bd(n,i))}if(t===1)throw t=ga,Zr(n,0),ar(n,e),_n(n,Nt()),t;if(t===6)throw Error(ce(345));return n.finishedWork=n.current.alternate,n.finishedLanes=e,Wr(n,gn,Ii),_n(n,Nt()),null}function hp(n,e){var t=ot;ot|=1;try{return n(e)}finally{ot=t,ot===0&&(Ys=Nt()+500,Lc&&Mr())}}function es(n){cr!==null&&cr.tag===0&&!(ot&6)&&ks();var e=ot;ot|=1;var t=Wn.transition,i=ct;try{if(Wn.transition=null,ct=1,n)return n()}finally{ct=i,Wn.transition=t,ot=e,!(ot&6)&&Mr()}}function fp(){Tn=Ds.current,yt(Ds)}function Zr(n,e){n.finishedWork=null,n.finishedLanes=0;var t=n.timeoutHandle;if(t!==-1&&(n.timeoutHandle=-1,V1(t)),Ut!==null)for(t=Ut.return;t!==null;){var i=t;switch(Yd(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&fc();break;case 3:Ws(),yt(xn),yt(nn),tp();break;case 5:ep(i);break;case 4:Ws();break;case 13:yt(wt);break;case 19:yt(wt);break;case 10:Jd(i.type._context);break;case 22:case 23:fp()}t=t.return}if(Gt=n,Ut=n=vr(n.current,null),qt=Tn=e,Bt=0,ga=null,cp=Fc=Qr=0,gn=jo=null,Yr!==null){for(e=0;e<Yr.length;e++)if(t=Yr[e],i=t.interleaved,i!==null){t.interleaved=null;var r=i.next,s=t.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}t.pending=i}Yr=null}return n}function Px(n,e){do{var t=Ut;try{if($d(),Kl.current=Sc,_c){for(var i=Et.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}_c=!1}if(jr=0,Vt=Ot=Et=null,Jo=!1,da=0,lp.current=null,t===null||t.return===null){Bt=1,ga=e,Ut=null;break}e:{var s=n,o=t.return,a=t,l=e;if(e=qt,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var u=l,f=a,c=f.tag;if(!(f.mode&1)&&(c===0||c===11||c===15)){var h=f.alternate;h?(f.updateQueue=h.updateQueue,f.memoizedState=h.memoizedState,f.lanes=h.lanes):(f.updateQueue=null,f.memoizedState=null)}var d=A0(o);if(d!==null){d.flags&=-257,b0(d,o,a,s,e),d.mode&1&&T0(s,u,e),e=d,l=u;var p=e.updateQueue;if(p===null){var _=new Set;_.add(l),e.updateQueue=_}else p.add(l);break e}else{if(!(e&1)){T0(s,u,e),dp();break e}l=Error(ce(426))}}else if(St&&a.mode&1){var y=A0(o);if(y!==null){!(y.flags&65536)&&(y.flags|=256),b0(y,o,a,s,e),qd(Xs(l,a));break e}}s=l=Xs(l,a),Bt!==4&&(Bt=2),jo===null?jo=[s]:jo.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var m=dx(s,l,e);y0(s,m);break e;case 1:a=l;var v=s.type,g=s.stateNode;if(!(s.flags&128)&&(typeof v.getDerivedStateFromError=="function"||g!==null&&typeof g.componentDidCatch=="function"&&(mr===null||!mr.has(g)))){s.flags|=65536,e&=-e,s.lanes|=e;var S=px(s,a,e);y0(s,S);break e}}s=s.return}while(s!==null)}Dx(t)}catch(E){e=E,Ut===t&&t!==null&&(Ut=t=t.return);continue}break}while(!0)}function Ix(){var n=Mc.current;return Mc.current=Sc,n===null?Sc:n}function dp(){(Bt===0||Bt===3||Bt===2)&&(Bt=4),Gt===null||!(Qr&268435455)&&!(Fc&268435455)||ar(Gt,qt)}function Tc(n,e){var t=ot;ot|=2;var i=Ix();(Gt!==n||qt!==e)&&(Ii=null,Zr(n,e));do try{fM();break}catch(r){Px(n,r)}while(!0);if($d(),ot=t,Mc.current=i,Ut!==null)throw Error(ce(261));return Gt=null,qt=0,Bt}function fM(){for(;Ut!==null;)Lx(Ut)}function dM(){for(;Ut!==null&&!zS();)Lx(Ut)}function Lx(n){var e=Ux(n.alternate,n,Tn);n.memoizedProps=n.pendingProps,e===null?Dx(n):Ut=e,lp.current=null}function Dx(n){var e=n;do{var t=e.alternate;if(n=e.return,e.flags&32768){if(t=oM(t,e),t!==null){t.flags&=32767,Ut=t;return}if(n!==null)n.flags|=32768,n.subtreeFlags=0,n.deletions=null;else{Bt=6,Ut=null;return}}else if(t=sM(t,e,Tn),t!==null){Ut=t;return}if(e=e.sibling,e!==null){Ut=e;return}Ut=e=n}while(e!==null);Bt===0&&(Bt=5)}function Wr(n,e,t){var i=ct,r=Wn.transition;try{Wn.transition=null,ct=1,pM(n,e,t,i)}finally{Wn.transition=r,ct=i}return null}function pM(n,e,t,i){do ks();while(cr!==null);if(ot&6)throw Error(ce(327));t=n.finishedWork;var r=n.finishedLanes;if(t===null)return null;if(n.finishedWork=null,n.finishedLanes=0,t===n.current)throw Error(ce(177));n.callbackNode=null,n.callbackPriority=0;var s=t.lanes|t.childLanes;if(JS(n,s),n===Gt&&(Ut=Gt=null,qt=0),!(t.subtreeFlags&2064)&&!(t.flags&2064)||Yl||(Yl=!0,Fx(oc,function(){return ks(),null})),s=(t.flags&15990)!==0,t.subtreeFlags&15990||s){s=Wn.transition,Wn.transition=null;var o=ct;ct=1;var a=ot;ot|=4,lp.current=null,lM(n,t),bx(t,n),F1(sd),lc=!!rd,sd=rd=null,n.current=t,cM(t,n,r),VS(),ot=a,ct=o,Wn.transition=s}else n.current=t;if(Yl&&(Yl=!1,cr=n,Ec=r),s=n.pendingLanes,s===0&&(mr=null),WS(t.stateNode,i),_n(n,Nt()),e!==null)for(i=n.onRecoverableError,t=0;t<e.length;t++)r=e[t],i(r.value,{componentStack:r.stack,digest:r.digest});if(wc)throw wc=!1,n=Td,Td=null,n;return Ec&1&&n.tag!==0&&ks(),s=n.pendingLanes,s&1?n===Ad?Qo++:(Qo=0,Ad=n):Qo=0,Mr(),null}function ks(){if(cr!==null){var n=dv(Ec),e=Wn.transition,t=ct;try{if(Wn.transition=null,ct=16>n?16:n,cr===null)var i=!1;else{if(n=cr,cr=null,Ec=0,ot&6)throw Error(ce(331));var r=ot;for(ot|=4,Pe=n.current;Pe!==null;){var s=Pe,o=s.child;if(Pe.flags&16){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var u=a[l];for(Pe=u;Pe!==null;){var f=Pe;switch(f.tag){case 0:case 11:case 15:Ko(8,f,s)}var c=f.child;if(c!==null)c.return=f,Pe=c;else for(;Pe!==null;){f=Pe;var h=f.sibling,d=f.return;if(Ex(f),f===u){Pe=null;break}if(h!==null){h.return=d,Pe=h;break}Pe=d}}}var p=s.alternate;if(p!==null){var _=p.child;if(_!==null){p.child=null;do{var y=_.sibling;_.sibling=null,_=y}while(_!==null)}}Pe=s}}if(s.subtreeFlags&2064&&o!==null)o.return=s,Pe=o;else e:for(;Pe!==null;){if(s=Pe,s.flags&2048)switch(s.tag){case 0:case 11:case 15:Ko(9,s,s.return)}var m=s.sibling;if(m!==null){m.return=s.return,Pe=m;break e}Pe=s.return}}var v=n.current;for(Pe=v;Pe!==null;){o=Pe;var g=o.child;if(o.subtreeFlags&2064&&g!==null)g.return=o,Pe=g;else e:for(o=v;Pe!==null;){if(a=Pe,a.flags&2048)try{switch(a.tag){case 0:case 11:case 15:Uc(9,a)}}catch(E){Pt(a,a.return,E)}if(a===o){Pe=null;break e}var S=a.sibling;if(S!==null){S.return=a.return,Pe=S;break e}Pe=a.return}}if(ot=r,Mr(),xi&&typeof xi.onPostCommitFiberRoot=="function")try{xi.onPostCommitFiberRoot(bc,n)}catch{}i=!0}return i}finally{ct=t,Wn.transition=e}}return!1}function z0(n,e,t){e=Xs(t,e),e=dx(n,e,1),n=pr(n,e,1),e=hn(),n!==null&&(va(n,1,e),_n(n,e))}function Pt(n,e,t){if(n.tag===3)z0(n,n,t);else for(;e!==null;){if(e.tag===3){z0(e,n,t);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(mr===null||!mr.has(i))){n=Xs(t,n),n=px(e,n,1),e=pr(e,n,1),n=hn(),e!==null&&(va(e,1,n),_n(e,n));break}}e=e.return}}function mM(n,e,t){var i=n.pingCache;i!==null&&i.delete(e),e=hn(),n.pingedLanes|=n.suspendedLanes&t,Gt===n&&(qt&t)===t&&(Bt===4||Bt===3&&(qt&130023424)===qt&&500>Nt()-up?Zr(n,0):cp|=t),_n(n,e)}function Nx(n,e){e===0&&(n.mode&1?(e=Ll,Ll<<=1,!(Ll&130023424)&&(Ll=4194304)):e=1);var t=hn();n=Bi(n,e),n!==null&&(va(n,e,t),_n(n,t))}function gM(n){var e=n.memoizedState,t=0;e!==null&&(t=e.retryLane),Nx(n,t)}function vM(n,e){var t=0;switch(n.tag){case 13:var i=n.stateNode,r=n.memoizedState;r!==null&&(t=r.retryLane);break;case 19:i=n.stateNode;break;default:throw Error(ce(314))}i!==null&&i.delete(e),Nx(n,t)}var Ux;Ux=function(n,e,t){if(n!==null)if(n.memoizedProps!==e.pendingProps||xn.current)vn=!0;else{if(!(n.lanes&t)&&!(e.flags&128))return vn=!1,rM(n,e,t);vn=!!(n.flags&131072)}else vn=!1,St&&e.flags&1048576&&kv(e,mc,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;Ql(n,e),n=e.pendingProps;var r=Vs(e,nn.current);Bs(e,t),r=ip(null,e,i,n,r,t);var s=rp();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,yn(i)?(s=!0,dc(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,jd(e),r.updater=Nc,e.stateNode=r,r._reactInternals=e,pd(e,i,n,t),e=vd(null,e,i,!0,s,t)):(e.tag=0,St&&s&&Xd(e),un(null,e,r,t),e=e.child),e;case 16:i=e.elementType;e:{switch(Ql(n,e),n=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=yM(i),n=jn(i,n),r){case 0:e=gd(null,e,i,n,t);break e;case 1:e=P0(null,e,i,n,t);break e;case 11:e=C0(null,e,i,n,t);break e;case 14:e=R0(null,e,i,jn(i.type,n),t);break e}throw Error(ce(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:jn(i,r),gd(n,e,i,r,t);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:jn(i,r),P0(n,e,i,r,t);case 3:e:{if(xx(e),n===null)throw Error(ce(387));i=e.pendingProps,s=e.memoizedState,r=s.element,Xv(n,e),xc(e,i,null,t);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=Xs(Error(ce(423)),e),e=I0(n,e,i,t,r);break e}else if(i!==r){r=Xs(Error(ce(424)),e),e=I0(n,e,i,t,r);break e}else for(An=dr(e.stateNode.containerInfo.firstChild),bn=e,St=!0,ei=null,t=Hv(e,null,i,t),e.child=t;t;)t.flags=t.flags&-3|4096,t=t.sibling;else{if(Gs(),i===r){e=ki(n,e,t);break e}un(n,e,i,t)}e=e.child}return e;case 5:return Yv(e),n===null&&hd(e),i=e.type,r=e.pendingProps,s=n!==null?n.memoizedProps:null,o=r.children,od(i,r)?o=null:s!==null&&od(i,s)&&(e.flags|=32),vx(n,e),un(n,e,o,t),e.child;case 6:return n===null&&hd(e),null;case 13:return yx(n,e,t);case 4:return Qd(e,e.stateNode.containerInfo),i=e.pendingProps,n===null?e.child=Hs(e,null,i,t):un(n,e,i,t),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:jn(i,r),C0(n,e,i,r,t);case 7:return un(n,e,e.pendingProps,t),e.child;case 8:return un(n,e,e.pendingProps.children,t),e.child;case 12:return un(n,e,e.pendingProps.children,t),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,vt(gc,i._currentValue),i._currentValue=o,s!==null)if(ii(s.value,o)){if(s.children===r.children&&!xn.current){e=ki(n,e,t);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=Ui(-1,t&-t),l.tag=2;var u=s.updateQueue;if(u!==null){u=u.shared;var f=u.pending;f===null?l.next=l:(l.next=f.next,f.next=l),u.pending=l}}s.lanes|=t,l=s.alternate,l!==null&&(l.lanes|=t),fd(s.return,t,e),a.lanes|=t;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(ce(341));o.lanes|=t,a=o.alternate,a!==null&&(a.lanes|=t),fd(o,t,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}un(n,e,r.children,t),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,Bs(e,t),r=Xn(r),i=i(r),e.flags|=1,un(n,e,i,t),e.child;case 14:return i=e.type,r=jn(i,e.pendingProps),r=jn(i.type,r),R0(n,e,i,r,t);case 15:return mx(n,e,e.type,e.pendingProps,t);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:jn(i,r),Ql(n,e),e.tag=1,yn(i)?(n=!0,dc(e)):n=!1,Bs(e,t),fx(e,i,r),pd(e,i,r,t),vd(null,e,i,!0,n,t);case 19:return _x(n,e,t);case 22:return gx(n,e,t)}throw Error(ce(156,e.tag))};function Fx(n,e){return cv(n,e)}function xM(n,e,t,i){this.tag=n,this.key=t,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Hn(n,e,t,i){return new xM(n,e,t,i)}function pp(n){return n=n.prototype,!(!n||!n.isReactComponent)}function yM(n){if(typeof n=="function")return pp(n)?1:0;if(n!=null){if(n=n.$$typeof,n===Dd)return 11;if(n===Nd)return 14}return 2}function vr(n,e){var t=n.alternate;return t===null?(t=Hn(n.tag,e,n.key,n.mode),t.elementType=n.elementType,t.type=n.type,t.stateNode=n.stateNode,t.alternate=n,n.alternate=t):(t.pendingProps=e,t.type=n.type,t.flags=0,t.subtreeFlags=0,t.deletions=null),t.flags=n.flags&14680064,t.childLanes=n.childLanes,t.lanes=n.lanes,t.child=n.child,t.memoizedProps=n.memoizedProps,t.memoizedState=n.memoizedState,t.updateQueue=n.updateQueue,e=n.dependencies,t.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},t.sibling=n.sibling,t.index=n.index,t.ref=n.ref,t}function nc(n,e,t,i,r,s){var o=2;if(i=n,typeof n=="function")pp(n)&&(o=1);else if(typeof n=="string")o=5;else e:switch(n){case ws:return $r(t.children,r,s,e);case Ld:o=8,r|=8;break;case Bf:return n=Hn(12,t,e,r|2),n.elementType=Bf,n.lanes=s,n;case kf:return n=Hn(13,t,e,r),n.elementType=kf,n.lanes=s,n;case zf:return n=Hn(19,t,e,r),n.elementType=zf,n.lanes=s,n;case Y0:return Oc(t,r,s,e);default:if(typeof n=="object"&&n!==null)switch(n.$$typeof){case W0:o=10;break e;case X0:o=9;break e;case Dd:o=11;break e;case Nd:o=14;break e;case rr:o=16,i=null;break e}throw Error(ce(130,n==null?n:typeof n,""))}return e=Hn(o,t,e,r),e.elementType=n,e.type=i,e.lanes=s,e}function $r(n,e,t,i){return n=Hn(7,n,i,e),n.lanes=t,n}function Oc(n,e,t,i){return n=Hn(22,n,i,e),n.elementType=Y0,n.lanes=t,n.stateNode={isHidden:!1},n}function Uf(n,e,t){return n=Hn(6,n,null,e),n.lanes=t,n}function Ff(n,e,t){return e=Hn(4,n.children!==null?n.children:[],n.key,e),e.lanes=t,e.stateNode={containerInfo:n.containerInfo,pendingChildren:null,implementation:n.implementation},e}function _M(n,e,t,i,r){this.tag=e,this.containerInfo=n,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=yf(0),this.expirationTimes=yf(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=yf(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function mp(n,e,t,i,r,s,o,a,l){return n=new _M(n,e,t,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=Hn(3,null,null,e),n.current=s,s.stateNode=n,s.memoizedState={element:i,isDehydrated:t,cache:null,transitions:null,pendingSuspenseBoundaries:null},jd(s),n}function SM(n,e,t){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:Ms,key:i==null?null:""+i,children:n,containerInfo:e,implementation:t}}function Ox(n){if(!n)return yr;n=n._reactInternals;e:{if(ns(n)!==n||n.tag!==1)throw Error(ce(170));var e=n;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(yn(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(ce(171))}if(n.tag===1){var t=n.type;if(yn(t))return Ov(n,t,e)}return e}function Bx(n,e,t,i,r,s,o,a,l){return n=mp(t,i,!0,n,r,s,o,a,l),n.context=Ox(null),t=n.current,i=hn(),r=gr(t),s=Ui(i,r),s.callback=e??null,pr(t,s,r),n.current.lanes=r,va(n,r,i),_n(n,i),n}function Bc(n,e,t,i){var r=e.current,s=hn(),o=gr(r);return t=Ox(t),e.context===null?e.context=t:e.pendingContext=t,e=Ui(s,o),e.payload={element:n},i=i===void 0?null:i,i!==null&&(e.callback=i),n=pr(r,e,o),n!==null&&(ni(n,r,o,s),Jl(n,r,o)),o}function Ac(n){if(n=n.current,!n.child)return null;switch(n.child.tag){case 5:return n.child.stateNode;default:return n.child.stateNode}}function V0(n,e){if(n=n.memoizedState,n!==null&&n.dehydrated!==null){var t=n.retryLane;n.retryLane=t!==0&&t<e?t:e}}function gp(n,e){V0(n,e),(n=n.alternate)&&V0(n,e)}function MM(){return null}var kx=typeof reportError=="function"?reportError:function(n){console.error(n)};function vp(n){this._internalRoot=n}kc.prototype.render=vp.prototype.render=function(n){var e=this._internalRoot;if(e===null)throw Error(ce(409));Bc(n,e,null,null)};kc.prototype.unmount=vp.prototype.unmount=function(){var n=this._internalRoot;if(n!==null){this._internalRoot=null;var e=n.containerInfo;es(function(){Bc(null,n,null,null)}),e[Oi]=null}};function kc(n){this._internalRoot=n}kc.prototype.unstable_scheduleHydration=function(n){if(n){var e=gv();n={blockedOn:null,target:n,priority:e};for(var t=0;t<or.length&&e!==0&&e<or[t].priority;t++);or.splice(t,0,n),t===0&&xv(n)}};function xp(n){return!(!n||n.nodeType!==1&&n.nodeType!==9&&n.nodeType!==11)}function zc(n){return!(!n||n.nodeType!==1&&n.nodeType!==9&&n.nodeType!==11&&(n.nodeType!==8||n.nodeValue!==" react-mount-point-unstable "))}function G0(){}function wM(n,e,t,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var u=Ac(o);s.call(u)}}var o=Bx(e,i,n,0,null,!1,!1,"",G0);return n._reactRootContainer=o,n[Oi]=o.current,la(n.nodeType===8?n.parentNode:n),es(),o}for(;r=n.lastChild;)n.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var u=Ac(l);a.call(u)}}var l=mp(n,0,!1,null,null,!1,!1,"",G0);return n._reactRootContainer=l,n[Oi]=l.current,la(n.nodeType===8?n.parentNode:n),es(function(){Bc(e,l,t,i)}),l}function Vc(n,e,t,i,r){var s=t._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=Ac(o);a.call(l)}}Bc(e,o,n,r)}else o=wM(t,e,n,r,i);return Ac(o)}pv=function(n){switch(n.tag){case 3:var e=n.stateNode;if(e.current.memoizedState.isDehydrated){var t=Ho(e.pendingLanes);t!==0&&(Od(e,t|1),_n(e,Nt()),!(ot&6)&&(Ys=Nt()+500,Mr()))}break;case 13:es(function(){var i=Bi(n,1);if(i!==null){var r=hn();ni(i,n,1,r)}}),gp(n,1)}};Bd=function(n){if(n.tag===13){var e=Bi(n,134217728);if(e!==null){var t=hn();ni(e,n,134217728,t)}gp(n,134217728)}};mv=function(n){if(n.tag===13){var e=gr(n),t=Bi(n,e);if(t!==null){var i=hn();ni(t,n,e,i)}gp(n,e)}};gv=function(){return ct};vv=function(n,e){var t=ct;try{return ct=n,e()}finally{ct=t}};Jf=function(n,e,t){switch(e){case"input":if(Hf(n,t),e=t.name,t.type==="radio"&&e!=null){for(t=n;t.parentNode;)t=t.parentNode;for(t=t.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<t.length;e++){var i=t[e];if(i!==n&&i.form===n.form){var r=Ic(i);if(!r)throw Error(ce(90));Z0(i),Hf(i,r)}}}break;case"textarea":J0(n,t);break;case"select":e=t.value,e!=null&&Ns(n,!!t.multiple,e,!1)}};iv=hp;rv=es;var EM={usingClientEntryPoint:!1,Events:[ya,bs,Ic,tv,nv,hp]},ko={findFiberByHostInstance:Xr,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},TM={bundleType:ko.bundleType,version:ko.version,rendererPackageName:ko.rendererPackageName,rendererConfig:ko.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:zi.ReactCurrentDispatcher,findHostInstanceByFiber:function(n){return n=av(n),n===null?null:n.stateNode},findFiberByHostInstance:ko.findFiberByHostInstance||MM,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(zo=__REACT_DEVTOOLS_GLOBAL_HOOK__,!zo.isDisabled&&zo.supportsFiber))try{bc=zo.inject(TM),xi=zo}catch{}var zo;Pn.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=EM;Pn.createPortal=function(n,e){var t=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!xp(e))throw Error(ce(200));return SM(n,e,null,t)};Pn.createRoot=function(n,e){if(!xp(n))throw Error(ce(299));var t=!1,i="",r=kx;return e!=null&&(e.unstable_strictMode===!0&&(t=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=mp(n,1,!1,null,null,t,!1,i,r),n[Oi]=e.current,la(n.nodeType===8?n.parentNode:n),new vp(e)};Pn.findDOMNode=function(n){if(n==null)return null;if(n.nodeType===1)return n;var e=n._reactInternals;if(e===void 0)throw typeof n.render=="function"?Error(ce(188)):(n=Object.keys(n).join(","),Error(ce(268,n)));return n=av(e),n=n===null?null:n.stateNode,n};Pn.flushSync=function(n){return es(n)};Pn.hydrate=function(n,e,t){if(!zc(e))throw Error(ce(200));return Vc(null,n,e,!0,t)};Pn.hydrateRoot=function(n,e,t){if(!xp(n))throw Error(ce(405));var i=t!=null&&t.hydratedSources||null,r=!1,s="",o=kx;if(t!=null&&(t.unstable_strictMode===!0&&(r=!0),t.identifierPrefix!==void 0&&(s=t.identifierPrefix),t.onRecoverableError!==void 0&&(o=t.onRecoverableError)),e=Bx(e,null,n,1,t??null,r,!1,s,o),n[Oi]=e.current,la(n),i)for(n=0;n<i.length;n++)t=i[n],r=t._getVersion,r=r(t._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[t,r]:e.mutableSourceEagerHydrationData.push(t,r);return new kc(e)};Pn.render=function(n,e,t){if(!zc(e))throw Error(ce(200));return Vc(null,n,e,!1,t)};Pn.unmountComponentAtNode=function(n){if(!zc(n))throw Error(ce(40));return n._reactRootContainer?(es(function(){Vc(null,null,n,!1,function(){n._reactRootContainer=null,n[Oi]=null})}),!0):!1};Pn.unstable_batchedUpdates=hp;Pn.unstable_renderSubtreeIntoContainer=function(n,e,t,i){if(!zc(t))throw Error(ce(200));if(n==null||n._reactInternals===void 0)throw Error(ce(38));return Vc(n,e,t,!1,i)};Pn.version="18.3.1-next-f1338f8080-20240426"});var Hx=di((JC,Gx)=>{"use strict";function Vx(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Vx)}catch(n){console.error(n)}}Vx(),Gx.exports=zx()});var Xx=di(yp=>{"use strict";var Wx=Hx();yp.createRoot=Wx.createRoot,yp.hydrateRoot=Wx.hydrateRoot;var KC});var Yx=di((Sa,_p)=>{(function(e,t){typeof Sa=="object"&&typeof _p=="object"?_p.exports=t():typeof define=="function"&&define.amd?define("Matter",[],t):typeof Sa=="object"?Sa.Matter=t():e.Matter=t()})(Sa,function(){return function(n){var e={};function t(i){if(e[i])return e[i].exports;var r=e[i]={i,l:!1,exports:{}};return n[i].call(r.exports,r,r.exports,t),r.l=!0,r.exports}return t.m=n,t.c=e,t.d=function(i,r,s){t.o(i,r)||Object.defineProperty(i,r,{enumerable:!0,get:s})},t.r=function(i){typeof Symbol<"u"&&Symbol.toStringTag&&Object.defineProperty(i,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(i,"__esModule",{value:!0})},t.t=function(i,r){if(r&1&&(i=t(i)),r&8||r&4&&typeof i=="object"&&i&&i.__esModule)return i;var s=Object.create(null);if(t.r(s),Object.defineProperty(s,"default",{enumerable:!0,value:i}),r&2&&typeof i!="string")for(var o in i)t.d(s,o,(function(a){return i[a]}).bind(null,o));return s},t.n=function(i){var r=i&&i.__esModule?function(){return i.default}:function(){return i};return t.d(r,"a",r),r},t.o=function(i,r){return Object.prototype.hasOwnProperty.call(i,r)},t.p="",t(t.s=20)}([function(n,e){var t={};n.exports=t,function(){t._baseDelta=1e3/60,t._nextId=0,t._seed=0,t._nowStartTime=+new Date,t._warnedOnce={},t._decomp=null,t.extend=function(r,s){var o,a,l;typeof s=="boolean"?(o=2,l=s):(o=1,l=!0);for(var u=o;u<arguments.length;u++){var f=arguments[u];if(f)for(var c in f)l&&f[c]&&f[c].constructor===Object&&(!r[c]||r[c].constructor===Object)?(r[c]=r[c]||{},t.extend(r[c],l,f[c])):r[c]=f[c]}return r},t.clone=function(r,s){return t.extend({},s,r)},t.keys=function(r){if(Object.keys)return Object.keys(r);var s=[];for(var o in r)s.push(o);return s},t.values=function(r){var s=[];if(Object.keys){for(var o=Object.keys(r),a=0;a<o.length;a++)s.push(r[o[a]]);return s}for(var l in r)s.push(r[l]);return s},t.get=function(r,s,o,a){s=s.split(".").slice(o,a);for(var l=0;l<s.length;l+=1)r=r[s[l]];return r},t.set=function(r,s,o,a,l){var u=s.split(".").slice(a,l);return t.get(r,s,0,-1)[u[u.length-1]]=o,o},t.shuffle=function(r){for(var s=r.length-1;s>0;s--){var o=Math.floor(t.random()*(s+1)),a=r[s];r[s]=r[o],r[o]=a}return r},t.choose=function(r){return r[Math.floor(t.random()*r.length)]},t.isElement=function(r){return typeof HTMLElement<"u"?r instanceof HTMLElement:!!(r&&r.nodeType&&r.nodeName)},t.isArray=function(r){return Object.prototype.toString.call(r)==="[object Array]"},t.isFunction=function(r){return typeof r=="function"},t.isPlainObject=function(r){return typeof r=="object"&&r.constructor===Object},t.isString=function(r){return toString.call(r)==="[object String]"},t.clamp=function(r,s,o){return r<s?s:r>o?o:r},t.sign=function(r){return r<0?-1:1},t.now=function(){if(typeof window<"u"&&window.performance){if(window.performance.now)return window.performance.now();if(window.performance.webkitNow)return window.performance.webkitNow()}return Date.now?Date.now():new Date-t._nowStartTime},t.random=function(r,s){return r=typeof r<"u"?r:0,s=typeof s<"u"?s:1,r+i()*(s-r)};var i=function(){return t._seed=(t._seed*9301+49297)%233280,t._seed/233280};t.colorToNumber=function(r){return r=r.replace("#",""),r.length==3&&(r=r.charAt(0)+r.charAt(0)+r.charAt(1)+r.charAt(1)+r.charAt(2)+r.charAt(2)),parseInt(r,16)},t.logLevel=1,t.log=function(){console&&t.logLevel>0&&t.logLevel<=3&&console.log.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},t.info=function(){console&&t.logLevel>0&&t.logLevel<=2&&console.info.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},t.warn=function(){console&&t.logLevel>0&&t.logLevel<=3&&console.warn.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},t.warnOnce=function(){var r=Array.prototype.slice.call(arguments).join(" ");t._warnedOnce[r]||(t.warn(r),t._warnedOnce[r]=!0)},t.deprecated=function(r,s,o){r[s]=t.chain(function(){t.warnOnce("\u{1F505} deprecated \u{1F505}",o)},r[s])},t.nextId=function(){return t._nextId++},t.indexOf=function(r,s){if(r.indexOf)return r.indexOf(s);for(var o=0;o<r.length;o++)if(r[o]===s)return o;return-1},t.map=function(r,s){if(r.map)return r.map(s);for(var o=[],a=0;a<r.length;a+=1)o.push(s(r[a]));return o},t.topologicalSort=function(r){var s=[],o=[],a=[];for(var l in r)!o[l]&&!a[l]&&t._topologicalSort(l,o,a,r,s);return s},t._topologicalSort=function(r,s,o,a,l){var u=a[r]||[];o[r]=!0;for(var f=0;f<u.length;f+=1){var c=u[f];o[c]||s[c]||t._topologicalSort(c,s,o,a,l)}o[r]=!1,s[r]=!0,l.push(r)},t.chain=function(){for(var r=[],s=0;s<arguments.length;s+=1){var o=arguments[s];o._chained?r.push.apply(r,o._chained):r.push(o)}var a=function(){for(var l,u=new Array(arguments.length),f=0,c=arguments.length;f<c;f++)u[f]=arguments[f];for(f=0;f<r.length;f+=1){var h=r[f].apply(l,u);typeof h<"u"&&(l=h)}return l};return a._chained=r,a},t.chainPathBefore=function(r,s,o){return t.set(r,s,t.chain(o,t.get(r,s)))},t.chainPathAfter=function(r,s,o){return t.set(r,s,t.chain(t.get(r,s),o))},t.setDecomp=function(r){t._decomp=r},t.getDecomp=function(){var r=t._decomp;try{!r&&typeof window<"u"&&(r=window.decomp),!r&&typeof global<"u"&&(r=global.decomp)}catch{r=null}return r}}()},function(n,e){var t={};n.exports=t,function(){t.create=function(i){var r={min:{x:0,y:0},max:{x:0,y:0}};return i&&t.update(r,i),r},t.update=function(i,r,s){i.min.x=1/0,i.max.x=-1/0,i.min.y=1/0,i.max.y=-1/0;for(var o=0;o<r.length;o++){var a=r[o];a.x>i.max.x&&(i.max.x=a.x),a.x<i.min.x&&(i.min.x=a.x),a.y>i.max.y&&(i.max.y=a.y),a.y<i.min.y&&(i.min.y=a.y)}s&&(s.x>0?i.max.x+=s.x:i.min.x+=s.x,s.y>0?i.max.y+=s.y:i.min.y+=s.y)},t.contains=function(i,r){return r.x>=i.min.x&&r.x<=i.max.x&&r.y>=i.min.y&&r.y<=i.max.y},t.overlaps=function(i,r){return i.min.x<=r.max.x&&i.max.x>=r.min.x&&i.max.y>=r.min.y&&i.min.y<=r.max.y},t.translate=function(i,r){i.min.x+=r.x,i.max.x+=r.x,i.min.y+=r.y,i.max.y+=r.y},t.shift=function(i,r){var s=i.max.x-i.min.x,o=i.max.y-i.min.y;i.min.x=r.x,i.max.x=r.x+s,i.min.y=r.y,i.max.y=r.y+o}}()},function(n,e){var t={};n.exports=t,function(){t.create=function(i,r){return{x:i||0,y:r||0}},t.clone=function(i){return{x:i.x,y:i.y}},t.magnitude=function(i){return Math.sqrt(i.x*i.x+i.y*i.y)},t.magnitudeSquared=function(i){return i.x*i.x+i.y*i.y},t.rotate=function(i,r,s){var o=Math.cos(r),a=Math.sin(r);s||(s={});var l=i.x*o-i.y*a;return s.y=i.x*a+i.y*o,s.x=l,s},t.rotateAbout=function(i,r,s,o){var a=Math.cos(r),l=Math.sin(r);o||(o={});var u=s.x+((i.x-s.x)*a-(i.y-s.y)*l);return o.y=s.y+((i.x-s.x)*l+(i.y-s.y)*a),o.x=u,o},t.normalise=function(i){var r=t.magnitude(i);return r===0?{x:0,y:0}:{x:i.x/r,y:i.y/r}},t.dot=function(i,r){return i.x*r.x+i.y*r.y},t.cross=function(i,r){return i.x*r.y-i.y*r.x},t.cross3=function(i,r,s){return(r.x-i.x)*(s.y-i.y)-(r.y-i.y)*(s.x-i.x)},t.add=function(i,r,s){return s||(s={}),s.x=i.x+r.x,s.y=i.y+r.y,s},t.sub=function(i,r,s){return s||(s={}),s.x=i.x-r.x,s.y=i.y-r.y,s},t.mult=function(i,r){return{x:i.x*r,y:i.y*r}},t.div=function(i,r){return{x:i.x/r,y:i.y/r}},t.perp=function(i,r){return r=r===!0?-1:1,{x:r*-i.y,y:r*i.x}},t.neg=function(i){return{x:-i.x,y:-i.y}},t.angle=function(i,r){return Math.atan2(r.y-i.y,r.x-i.x)},t._temp=[t.create(),t.create(),t.create(),t.create(),t.create(),t.create()]}()},function(n,e,t){var i={};n.exports=i;var r=t(2),s=t(0);(function(){i.create=function(o,a){for(var l=[],u=0;u<o.length;u++){var f=o[u],c={x:f.x,y:f.y,index:u,body:a,isInternal:!1};l.push(c)}return l},i.fromPath=function(o,a){var l=/L?\s*([-\d.e]+)[\s,]*([-\d.e]+)*/ig,u=[];return o.replace(l,function(f,c,h){u.push({x:parseFloat(c),y:parseFloat(h)})}),i.create(u,a)},i.centre=function(o){for(var a=i.area(o,!0),l={x:0,y:0},u,f,c,h=0;h<o.length;h++)c=(h+1)%o.length,u=r.cross(o[h],o[c]),f=r.mult(r.add(o[h],o[c]),u),l=r.add(l,f);return r.div(l,6*a)},i.mean=function(o){for(var a={x:0,y:0},l=0;l<o.length;l++)a.x+=o[l].x,a.y+=o[l].y;return r.div(a,o.length)},i.area=function(o,a){for(var l=0,u=o.length-1,f=0;f<o.length;f++)l+=(o[u].x-o[f].x)*(o[u].y+o[f].y),u=f;return a?l/2:Math.abs(l)/2},i.inertia=function(o,a){for(var l=0,u=0,f=o,c,h,d=0;d<f.length;d++)h=(d+1)%f.length,c=Math.abs(r.cross(f[h],f[d])),l+=c*(r.dot(f[h],f[h])+r.dot(f[h],f[d])+r.dot(f[d],f[d])),u+=c;return a/6*(l/u)},i.translate=function(o,a,l){l=typeof l<"u"?l:1;var u=o.length,f=a.x*l,c=a.y*l,h;for(h=0;h<u;h++)o[h].x+=f,o[h].y+=c;return o},i.rotate=function(o,a,l){if(a!==0){var u=Math.cos(a),f=Math.sin(a),c=l.x,h=l.y,d=o.length,p,_,y,m;for(m=0;m<d;m++)p=o[m],_=p.x-c,y=p.y-h,p.x=c+(_*u-y*f),p.y=h+(_*f+y*u);return o}},i.contains=function(o,a){for(var l=a.x,u=a.y,f=o.length,c=o[f-1],h,d=0;d<f;d++){if(h=o[d],(l-c.x)*(h.y-c.y)+(u-c.y)*(c.x-h.x)>0)return!1;c=h}return!0},i.scale=function(o,a,l,u){if(a===1&&l===1)return o;u=u||i.centre(o);for(var f,c,h=0;h<o.length;h++)f=o[h],c=r.sub(f,u),o[h].x=u.x+c.x*a,o[h].y=u.y+c.y*l;return o},i.chamfer=function(o,a,l,u,f){typeof a=="number"?a=[a]:a=a||[8],l=typeof l<"u"?l:-1,u=u||2,f=f||14;for(var c=[],h=0;h<o.length;h++){var d=o[h-1>=0?h-1:o.length-1],p=o[h],_=o[(h+1)%o.length],y=a[h<a.length?h:a.length-1];if(y===0){c.push(p);continue}var m=r.normalise({x:p.y-d.y,y:d.x-p.x}),v=r.normalise({x:_.y-p.y,y:p.x-_.x}),g=Math.sqrt(2*Math.pow(y,2)),S=r.mult(s.clone(m),y),E=r.normalise(r.mult(r.add(m,v),.5)),M=r.sub(p,r.mult(E,g)),T=l;l===-1&&(T=Math.pow(y,.32)*1.75),T=s.clamp(T,u,f),T%2===1&&(T+=1);for(var x=Math.acos(r.dot(m,v)),w=x/T,C=0;C<T;C++)c.push(r.add(r.rotate(S,w*C),M))}return c},i.clockwiseSort=function(o){var a=i.mean(o);return o.sort(function(l,u){return r.angle(a,l)-r.angle(a,u)}),o},i.isConvex=function(o){var a=0,l=o.length,u,f,c,h;if(l<3)return null;for(u=0;u<l;u++)if(f=(u+1)%l,c=(u+2)%l,h=(o[f].x-o[u].x)*(o[c].y-o[f].y),h-=(o[f].y-o[u].y)*(o[c].x-o[f].x),h<0?a|=1:h>0&&(a|=2),a===3)return!1;return a!==0?!0:null},i.hull=function(o){var a=[],l=[],u,f;for(o=o.slice(0),o.sort(function(c,h){var d=c.x-h.x;return d!==0?d:c.y-h.y}),f=0;f<o.length;f+=1){for(u=o[f];l.length>=2&&r.cross3(l[l.length-2],l[l.length-1],u)<=0;)l.pop();l.push(u)}for(f=o.length-1;f>=0;f-=1){for(u=o[f];a.length>=2&&r.cross3(a[a.length-2],a[a.length-1],u)<=0;)a.pop();a.push(u)}return a.pop(),l.pop(),a.concat(l)}})()},function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(2),o=t(7),a=t(0),l=t(1),u=t(11);(function(){i._timeCorrection=!0,i._inertiaScale=4,i._nextCollidingGroupId=1,i._nextNonCollidingGroupId=-1,i._nextCategory=1,i._baseDelta=1e3/60,i.create=function(c){var h={id:a.nextId(),type:"body",label:"Body",parts:[],plugin:{},angle:0,vertices:r.fromPath("L 0 0 L 40 0 L 40 40 L 0 40"),position:{x:0,y:0},force:{x:0,y:0},torque:0,positionImpulse:{x:0,y:0},constraintImpulse:{x:0,y:0,angle:0},totalContacts:0,speed:0,angularSpeed:0,velocity:{x:0,y:0},angularVelocity:0,isSensor:!1,isStatic:!1,isSleeping:!1,motion:0,sleepThreshold:60,density:.001,restitution:0,friction:.1,frictionStatic:.5,frictionAir:.01,collisionFilter:{category:1,mask:4294967295,group:0},slop:.05,timeScale:1,render:{visible:!0,opacity:1,strokeStyle:null,fillStyle:null,lineWidth:null,sprite:{xScale:1,yScale:1,xOffset:0,yOffset:0}},events:null,bounds:null,chamfer:null,circleRadius:0,positionPrev:null,anglePrev:0,parent:null,axes:null,area:0,mass:0,inertia:0,deltaTime:16.666666666666668,_original:null},d=a.extend(h,c);return f(d,c),d},i.nextGroup=function(c){return c?i._nextNonCollidingGroupId--:i._nextCollidingGroupId++},i.nextCategory=function(){return i._nextCategory=i._nextCategory<<1,i._nextCategory};var f=function(c,h){h=h||{},i.set(c,{bounds:c.bounds||l.create(c.vertices),positionPrev:c.positionPrev||s.clone(c.position),anglePrev:c.anglePrev||c.angle,vertices:c.vertices,parts:c.parts||[c],isStatic:c.isStatic,isSleeping:c.isSleeping,parent:c.parent||c}),r.rotate(c.vertices,c.angle,c.position),u.rotate(c.axes,c.angle),l.update(c.bounds,c.vertices,c.velocity),i.set(c,{axes:h.axes||c.axes,area:h.area||c.area,mass:h.mass||c.mass,inertia:h.inertia||c.inertia});var d=c.isStatic?"#14151f":a.choose(["#f19648","#f5d259","#f55a3c","#063e7b","#ececd1"]),p=c.isStatic?"#555":"#ccc",_=c.isStatic&&c.render.fillStyle===null?1:0;c.render.fillStyle=c.render.fillStyle||d,c.render.strokeStyle=c.render.strokeStyle||p,c.render.lineWidth=c.render.lineWidth||_,c.render.sprite.xOffset+=-(c.bounds.min.x-c.position.x)/(c.bounds.max.x-c.bounds.min.x),c.render.sprite.yOffset+=-(c.bounds.min.y-c.position.y)/(c.bounds.max.y-c.bounds.min.y)};i.set=function(c,h,d){var p;typeof h=="string"&&(p=h,h={},h[p]=d);for(p in h)if(Object.prototype.hasOwnProperty.call(h,p))switch(d=h[p],p){case"isStatic":i.setStatic(c,d);break;case"isSleeping":o.set(c,d);break;case"mass":i.setMass(c,d);break;case"density":i.setDensity(c,d);break;case"inertia":i.setInertia(c,d);break;case"vertices":i.setVertices(c,d);break;case"position":i.setPosition(c,d);break;case"angle":i.setAngle(c,d);break;case"velocity":i.setVelocity(c,d);break;case"angularVelocity":i.setAngularVelocity(c,d);break;case"speed":i.setSpeed(c,d);break;case"angularSpeed":i.setAngularSpeed(c,d);break;case"parts":i.setParts(c,d);break;case"centre":i.setCentre(c,d);break;default:c[p]=d}},i.setStatic=function(c,h){for(var d=0;d<c.parts.length;d++){var p=c.parts[d];h?(p.isStatic||(p._original={restitution:p.restitution,friction:p.friction,mass:p.mass,inertia:p.inertia,density:p.density,inverseMass:p.inverseMass,inverseInertia:p.inverseInertia}),p.restitution=0,p.friction=1,p.mass=p.inertia=p.density=1/0,p.inverseMass=p.inverseInertia=0,p.positionPrev.x=p.position.x,p.positionPrev.y=p.position.y,p.anglePrev=p.angle,p.angularVelocity=0,p.speed=0,p.angularSpeed=0,p.motion=0):p._original&&(p.restitution=p._original.restitution,p.friction=p._original.friction,p.mass=p._original.mass,p.inertia=p._original.inertia,p.density=p._original.density,p.inverseMass=p._original.inverseMass,p.inverseInertia=p._original.inverseInertia,p._original=null),p.isStatic=h}},i.setMass=function(c,h){var d=c.inertia/(c.mass/6);c.inertia=d*(h/6),c.inverseInertia=1/c.inertia,c.mass=h,c.inverseMass=1/c.mass,c.density=c.mass/c.area},i.setDensity=function(c,h){i.setMass(c,h*c.area),c.density=h},i.setInertia=function(c,h){c.inertia=h,c.inverseInertia=1/c.inertia},i.setVertices=function(c,h){h[0].body===c?c.vertices=h:c.vertices=r.create(h,c),c.axes=u.fromVertices(c.vertices),c.area=r.area(c.vertices),i.setMass(c,c.density*c.area);var d=r.centre(c.vertices);r.translate(c.vertices,d,-1),i.setInertia(c,i._inertiaScale*r.inertia(c.vertices,c.mass)),r.translate(c.vertices,c.position),l.update(c.bounds,c.vertices,c.velocity)},i.setParts=function(c,h,d){var p;for(h=h.slice(0),c.parts.length=0,c.parts.push(c),c.parent=c,p=0;p<h.length;p++){var _=h[p];_!==c&&(_.parent=c,c.parts.push(_))}if(c.parts.length!==1){if(d=typeof d<"u"?d:!0,d){var y=[];for(p=0;p<h.length;p++)y=y.concat(h[p].vertices);r.clockwiseSort(y);var m=r.hull(y),v=r.centre(m);i.setVertices(c,m),r.translate(c.vertices,v)}var g=i._totalProperties(c);c.area=g.area,c.parent=c,c.position.x=g.centre.x,c.position.y=g.centre.y,c.positionPrev.x=g.centre.x,c.positionPrev.y=g.centre.y,i.setMass(c,g.mass),i.setInertia(c,g.inertia),i.setPosition(c,g.centre)}},i.setCentre=function(c,h,d){d?(c.positionPrev.x+=h.x,c.positionPrev.y+=h.y,c.position.x+=h.x,c.position.y+=h.y):(c.positionPrev.x=h.x-(c.position.x-c.positionPrev.x),c.positionPrev.y=h.y-(c.position.y-c.positionPrev.y),c.position.x=h.x,c.position.y=h.y)},i.setPosition=function(c,h,d){var p=s.sub(h,c.position);d?(c.positionPrev.x=c.position.x,c.positionPrev.y=c.position.y,c.velocity.x=p.x,c.velocity.y=p.y,c.speed=s.magnitude(p)):(c.positionPrev.x+=p.x,c.positionPrev.y+=p.y);for(var _=0;_<c.parts.length;_++){var y=c.parts[_];y.position.x+=p.x,y.position.y+=p.y,r.translate(y.vertices,p),l.update(y.bounds,y.vertices,c.velocity)}},i.setAngle=function(c,h,d){var p=h-c.angle;d?(c.anglePrev=c.angle,c.angularVelocity=p,c.angularSpeed=Math.abs(p)):c.anglePrev+=p;for(var _=0;_<c.parts.length;_++){var y=c.parts[_];y.angle+=p,r.rotate(y.vertices,p,c.position),u.rotate(y.axes,p),l.update(y.bounds,y.vertices,c.velocity),_>0&&s.rotateAbout(y.position,p,c.position,y.position)}},i.setVelocity=function(c,h){var d=c.deltaTime/i._baseDelta;c.positionPrev.x=c.position.x-h.x*d,c.positionPrev.y=c.position.y-h.y*d,c.velocity.x=(c.position.x-c.positionPrev.x)/d,c.velocity.y=(c.position.y-c.positionPrev.y)/d,c.speed=s.magnitude(c.velocity)},i.getVelocity=function(c){var h=i._baseDelta/c.deltaTime;return{x:(c.position.x-c.positionPrev.x)*h,y:(c.position.y-c.positionPrev.y)*h}},i.getSpeed=function(c){return s.magnitude(i.getVelocity(c))},i.setSpeed=function(c,h){i.setVelocity(c,s.mult(s.normalise(i.getVelocity(c)),h))},i.setAngularVelocity=function(c,h){var d=c.deltaTime/i._baseDelta;c.anglePrev=c.angle-h*d,c.angularVelocity=(c.angle-c.anglePrev)/d,c.angularSpeed=Math.abs(c.angularVelocity)},i.getAngularVelocity=function(c){return(c.angle-c.anglePrev)*i._baseDelta/c.deltaTime},i.getAngularSpeed=function(c){return Math.abs(i.getAngularVelocity(c))},i.setAngularSpeed=function(c,h){i.setAngularVelocity(c,a.sign(i.getAngularVelocity(c))*h)},i.translate=function(c,h,d){i.setPosition(c,s.add(c.position,h),d)},i.rotate=function(c,h,d,p){if(!d)i.setAngle(c,c.angle+h,p);else{var _=Math.cos(h),y=Math.sin(h),m=c.position.x-d.x,v=c.position.y-d.y;i.setPosition(c,{x:d.x+(m*_-v*y),y:d.y+(m*y+v*_)},p),i.setAngle(c,c.angle+h,p)}},i.scale=function(c,h,d,p){var _=0,y=0;p=p||c.position;for(var m=0;m<c.parts.length;m++){var v=c.parts[m];r.scale(v.vertices,h,d,p),v.axes=u.fromVertices(v.vertices),v.area=r.area(v.vertices),i.setMass(v,c.density*v.area),r.translate(v.vertices,{x:-v.position.x,y:-v.position.y}),i.setInertia(v,i._inertiaScale*r.inertia(v.vertices,v.mass)),r.translate(v.vertices,{x:v.position.x,y:v.position.y}),m>0&&(_+=v.area,y+=v.inertia),v.position.x=p.x+(v.position.x-p.x)*h,v.position.y=p.y+(v.position.y-p.y)*d,l.update(v.bounds,v.vertices,c.velocity)}c.parts.length>1&&(c.area=_,c.isStatic||(i.setMass(c,c.density*_),i.setInertia(c,y))),c.circleRadius&&(h===d?c.circleRadius*=h:c.circleRadius=null)},i.update=function(c,h){h=(typeof h<"u"?h:1e3/60)*c.timeScale;var d=h*h,p=i._timeCorrection?h/(c.deltaTime||h):1,_=1-c.frictionAir*(h/a._baseDelta),y=(c.position.x-c.positionPrev.x)*p,m=(c.position.y-c.positionPrev.y)*p;c.velocity.x=y*_+c.force.x/c.mass*d,c.velocity.y=m*_+c.force.y/c.mass*d,c.positionPrev.x=c.position.x,c.positionPrev.y=c.position.y,c.position.x+=c.velocity.x,c.position.y+=c.velocity.y,c.deltaTime=h,c.angularVelocity=(c.angle-c.anglePrev)*_*p+c.torque/c.inertia*d,c.anglePrev=c.angle,c.angle+=c.angularVelocity;for(var v=0;v<c.parts.length;v++){var g=c.parts[v];r.translate(g.vertices,c.velocity),v>0&&(g.position.x+=c.velocity.x,g.position.y+=c.velocity.y),c.angularVelocity!==0&&(r.rotate(g.vertices,c.angularVelocity,c.position),u.rotate(g.axes,c.angularVelocity),v>0&&s.rotateAbout(g.position,c.angularVelocity,c.position,g.position)),l.update(g.bounds,g.vertices,c.velocity)}},i.updateVelocities=function(c){var h=i._baseDelta/c.deltaTime,d=c.velocity;d.x=(c.position.x-c.positionPrev.x)*h,d.y=(c.position.y-c.positionPrev.y)*h,c.speed=Math.sqrt(d.x*d.x+d.y*d.y),c.angularVelocity=(c.angle-c.anglePrev)*h,c.angularSpeed=Math.abs(c.angularVelocity)},i.applyForce=function(c,h,d){var p={x:h.x-c.position.x,y:h.y-c.position.y};c.force.x+=d.x,c.force.y+=d.y,c.torque+=p.x*d.y-p.y*d.x},i._totalProperties=function(c){for(var h={mass:0,area:0,inertia:0,centre:{x:0,y:0}},d=c.parts.length===1?0:1;d<c.parts.length;d++){var p=c.parts[d],_=p.mass!==1/0?p.mass:1;h.mass+=_,h.area+=p.area,h.inertia+=p.inertia,h.centre=s.add(h.centre,s.mult(p.position,_))}return h.centre=s.div(h.centre,h.mass),h}})()},function(n,e,t){var i={};n.exports=i;var r=t(0);(function(){i.on=function(s,o,a){for(var l=o.split(" "),u,f=0;f<l.length;f++)u=l[f],s.events=s.events||{},s.events[u]=s.events[u]||[],s.events[u].push(a);return a},i.off=function(s,o,a){if(!o){s.events={};return}typeof o=="function"&&(a=o,o=r.keys(s.events).join(" "));for(var l=o.split(" "),u=0;u<l.length;u++){var f=s.events[l[u]],c=[];if(a&&f)for(var h=0;h<f.length;h++)f[h]!==a&&c.push(f[h]);s.events[l[u]]=c}},i.trigger=function(s,o,a){var l,u,f,c,h=s.events;if(h&&r.keys(h).length>0){a||(a={}),l=o.split(" ");for(var d=0;d<l.length;d++)if(u=l[d],f=h[u],f){c=r.clone(a,!1),c.name=u,c.source=s;for(var p=0;p<f.length;p++)f[p].apply(s,[c])}}}})()},function(n,e,t){var i={};n.exports=i;var r=t(5),s=t(0),o=t(1),a=t(4);(function(){i.create=function(l){return s.extend({id:s.nextId(),type:"composite",parent:null,isModified:!1,bodies:[],constraints:[],composites:[],label:"Composite",plugin:{},cache:{allBodies:null,allConstraints:null,allComposites:null}},l)},i.setModified=function(l,u,f,c){if(l.isModified=u,u&&l.cache&&(l.cache.allBodies=null,l.cache.allConstraints=null,l.cache.allComposites=null),f&&l.parent&&i.setModified(l.parent,u,f,c),c)for(var h=0;h<l.composites.length;h++){var d=l.composites[h];i.setModified(d,u,f,c)}},i.add=function(l,u){var f=[].concat(u);r.trigger(l,"beforeAdd",{object:u});for(var c=0;c<f.length;c++){var h=f[c];switch(h.type){case"body":if(h.parent!==h){s.warn("Composite.add: skipped adding a compound body part (you must add its parent instead)");break}i.addBody(l,h);break;case"constraint":i.addConstraint(l,h);break;case"composite":i.addComposite(l,h);break;case"mouseConstraint":i.addConstraint(l,h.constraint);break}}return r.trigger(l,"afterAdd",{object:u}),l},i.remove=function(l,u,f){var c=[].concat(u);r.trigger(l,"beforeRemove",{object:u});for(var h=0;h<c.length;h++){var d=c[h];switch(d.type){case"body":i.removeBody(l,d,f);break;case"constraint":i.removeConstraint(l,d,f);break;case"composite":i.removeComposite(l,d,f);break;case"mouseConstraint":i.removeConstraint(l,d.constraint);break}}return r.trigger(l,"afterRemove",{object:u}),l},i.addComposite=function(l,u){return l.composites.push(u),u.parent=l,i.setModified(l,!0,!0,!1),l},i.removeComposite=function(l,u,f){var c=s.indexOf(l.composites,u);if(c!==-1){var h=i.allBodies(u);i.removeCompositeAt(l,c);for(var d=0;d<h.length;d++)h[d].sleepCounter=0}if(f)for(var d=0;d<l.composites.length;d++)i.removeComposite(l.composites[d],u,!0);return l},i.removeCompositeAt=function(l,u){return l.composites.splice(u,1),i.setModified(l,!0,!0,!1),l},i.addBody=function(l,u){return l.bodies.push(u),i.setModified(l,!0,!0,!1),l},i.removeBody=function(l,u,f){var c=s.indexOf(l.bodies,u);if(c!==-1&&(i.removeBodyAt(l,c),u.sleepCounter=0),f)for(var h=0;h<l.composites.length;h++)i.removeBody(l.composites[h],u,!0);return l},i.removeBodyAt=function(l,u){return l.bodies.splice(u,1),i.setModified(l,!0,!0,!1),l},i.addConstraint=function(l,u){return l.constraints.push(u),i.setModified(l,!0,!0,!1),l},i.removeConstraint=function(l,u,f){var c=s.indexOf(l.constraints,u);if(c!==-1&&i.removeConstraintAt(l,c),f)for(var h=0;h<l.composites.length;h++)i.removeConstraint(l.composites[h],u,!0);return l},i.removeConstraintAt=function(l,u){return l.constraints.splice(u,1),i.setModified(l,!0,!0,!1),l},i.clear=function(l,u,f){if(f)for(var c=0;c<l.composites.length;c++)i.clear(l.composites[c],u,!0);return u?l.bodies=l.bodies.filter(function(h){return h.isStatic}):l.bodies.length=0,l.constraints.length=0,l.composites.length=0,i.setModified(l,!0,!0,!1),l},i.allBodies=function(l){if(l.cache&&l.cache.allBodies)return l.cache.allBodies;for(var u=[].concat(l.bodies),f=0;f<l.composites.length;f++)u=u.concat(i.allBodies(l.composites[f]));return l.cache&&(l.cache.allBodies=u),u},i.allConstraints=function(l){if(l.cache&&l.cache.allConstraints)return l.cache.allConstraints;for(var u=[].concat(l.constraints),f=0;f<l.composites.length;f++)u=u.concat(i.allConstraints(l.composites[f]));return l.cache&&(l.cache.allConstraints=u),u},i.allComposites=function(l){if(l.cache&&l.cache.allComposites)return l.cache.allComposites;for(var u=[].concat(l.composites),f=0;f<l.composites.length;f++)u=u.concat(i.allComposites(l.composites[f]));return l.cache&&(l.cache.allComposites=u),u},i.get=function(l,u,f){var c,h;switch(f){case"body":c=i.allBodies(l);break;case"constraint":c=i.allConstraints(l);break;case"composite":c=i.allComposites(l).concat(l);break}return c?(h=c.filter(function(d){return d.id.toString()===u.toString()}),h.length===0?null:h[0]):null},i.move=function(l,u,f){return i.remove(l,u),i.add(f,u),l},i.rebase=function(l){for(var u=i.allBodies(l).concat(i.allConstraints(l)).concat(i.allComposites(l)),f=0;f<u.length;f++)u[f].id=s.nextId();return l},i.translate=function(l,u,f){for(var c=f?i.allBodies(l):l.bodies,h=0;h<c.length;h++)a.translate(c[h],u);return l},i.rotate=function(l,u,f,c){for(var h=Math.cos(u),d=Math.sin(u),p=c?i.allBodies(l):l.bodies,_=0;_<p.length;_++){var y=p[_],m=y.position.x-f.x,v=y.position.y-f.y;a.setPosition(y,{x:f.x+(m*h-v*d),y:f.y+(m*d+v*h)}),a.rotate(y,u)}return l},i.scale=function(l,u,f,c,h){for(var d=h?i.allBodies(l):l.bodies,p=0;p<d.length;p++){var _=d[p],y=_.position.x-c.x,m=_.position.y-c.y;a.setPosition(_,{x:c.x+y*u,y:c.y+m*f}),a.scale(_,u,f)}return l},i.bounds=function(l){for(var u=i.allBodies(l),f=[],c=0;c<u.length;c+=1){var h=u[c];f.push(h.bounds.min,h.bounds.max)}return o.create(f)}})()},function(n,e,t){var i={};n.exports=i;var r=t(4),s=t(5),o=t(0);(function(){i._motionWakeThreshold=.18,i._motionSleepThreshold=.08,i._minBias=.9,i.update=function(a,l){for(var u=l/o._baseDelta,f=i._motionSleepThreshold,c=0;c<a.length;c++){var h=a[c],d=r.getSpeed(h),p=r.getAngularSpeed(h),_=d*d+p*p;if(h.force.x!==0||h.force.y!==0){i.set(h,!1);continue}var y=Math.min(h.motion,_),m=Math.max(h.motion,_);h.motion=i._minBias*y+(1-i._minBias)*m,h.sleepThreshold>0&&h.motion<f?(h.sleepCounter+=1,h.sleepCounter>=h.sleepThreshold/u&&i.set(h,!0)):h.sleepCounter>0&&(h.sleepCounter-=1)}},i.afterCollisions=function(a){for(var l=i._motionSleepThreshold,u=0;u<a.length;u++){var f=a[u];if(f.isActive){var c=f.collision,h=c.bodyA.parent,d=c.bodyB.parent;if(!(h.isSleeping&&d.isSleeping||h.isStatic||d.isStatic)&&(h.isSleeping||d.isSleeping)){var p=h.isSleeping&&!h.isStatic?h:d,_=p===h?d:h;!p.isStatic&&_.motion>l&&i.set(p,!1)}}}},i.set=function(a,l){var u=a.isSleeping;l?(a.isSleeping=!0,a.sleepCounter=a.sleepThreshold,a.positionImpulse.x=0,a.positionImpulse.y=0,a.positionPrev.x=a.position.x,a.positionPrev.y=a.position.y,a.anglePrev=a.angle,a.speed=0,a.angularSpeed=0,a.motion=0,u||s.trigger(a,"sleepStart")):(a.isSleeping=!1,a.sleepCounter=0,u&&s.trigger(a,"sleepEnd"))}})()},function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(9);(function(){var o=[],a={overlap:0,axis:null},l={overlap:0,axis:null};i.create=function(u,f){return{pair:null,collided:!1,bodyA:u,bodyB:f,parentA:u.parent,parentB:f.parent,depth:0,normal:{x:0,y:0},tangent:{x:0,y:0},penetration:{x:0,y:0},supports:[null,null],supportCount:0}},i.collides=function(u,f,c){if(i._overlapAxes(a,u.vertices,f.vertices,u.axes),a.overlap<=0||(i._overlapAxes(l,f.vertices,u.vertices,f.axes),l.overlap<=0))return null;var h=c&&c.table[s.id(u,f)],d;h?d=h.collision:(d=i.create(u,f),d.collided=!0,d.bodyA=u.id<f.id?u:f,d.bodyB=u.id<f.id?f:u,d.parentA=d.bodyA.parent,d.parentB=d.bodyB.parent),u=d.bodyA,f=d.bodyB;var p;a.overlap<l.overlap?p=a:p=l;var _=d.normal,y=d.tangent,m=d.penetration,v=d.supports,g=p.overlap,S=p.axis,E=S.x,M=S.y,T=f.position.x-u.position.x,x=f.position.y-u.position.y;E*T+M*x>=0&&(E=-E,M=-M),_.x=E,_.y=M,y.x=-M,y.y=E,m.x=E*g,m.y=M*g,d.depth=g;var w=i._findSupports(u,f,_,1),C=0;if(r.contains(u.vertices,w[0])&&(v[C++]=w[0]),r.contains(u.vertices,w[1])&&(v[C++]=w[1]),C<2){var A=i._findSupports(f,u,_,-1);r.contains(f.vertices,A[0])&&(v[C++]=A[0]),C<2&&r.contains(f.vertices,A[1])&&(v[C++]=A[1])}return C===0&&(v[C++]=w[0]),d.supportCount=C,d},i._overlapAxes=function(u,f,c,h){var d=f.length,p=c.length,_=f[0].x,y=f[0].y,m=c[0].x,v=c[0].y,g=h.length,S=Number.MAX_VALUE,E=0,M,T,x,w,C,A;for(C=0;C<g;C++){var I=h[C],D=I.x,F=I.y,L=_*D+y*F,N=m*D+v*F,B=L,H=N;for(A=1;A<d;A+=1)w=f[A].x*D+f[A].y*F,w>B?B=w:w<L&&(L=w);for(A=1;A<p;A+=1)w=c[A].x*D+c[A].y*F,w>H?H=w:w<N&&(N=w);if(T=B-N,x=H-L,M=T<x?T:x,M<S&&(S=M,E=C,M<=0))break}u.axis=h[E],u.overlap=S},i._findSupports=function(u,f,c,h){var d=f.vertices,p=d.length,_=u.position.x,y=u.position.y,m=c.x*h,v=c.y*h,g=d[0],S=g,E=m*(_-S.x)+v*(y-S.y),M,T,x;for(x=1;x<p;x+=1)S=d[x],T=m*(_-S.x)+v*(y-S.y),T<E&&(E=T,g=S);return M=d[(p+g.index-1)%p],E=m*(_-M.x)+v*(y-M.y),S=d[(g.index+1)%p],m*(_-S.x)+v*(y-S.y)<E?(o[0]=g,o[1]=S,o):(o[0]=g,o[1]=M,o)}})()},function(n,e,t){var i={};n.exports=i;var r=t(16);(function(){i.create=function(s,o){var a=s.bodyA,l=s.bodyB,u={id:i.id(a,l),bodyA:a,bodyB:l,collision:s,contacts:[r.create(),r.create()],contactCount:0,separation:0,isActive:!0,isSensor:a.isSensor||l.isSensor,timeCreated:o,timeUpdated:o,inverseMass:0,friction:0,frictionStatic:0,restitution:0,slop:0};return i.update(u,s,o),u},i.update=function(s,o,a){var l=o.supports,u=o.supportCount,f=s.contacts,c=o.parentA,h=o.parentB;s.isActive=!0,s.timeUpdated=a,s.collision=o,s.separation=o.depth,s.inverseMass=c.inverseMass+h.inverseMass,s.friction=c.friction<h.friction?c.friction:h.friction,s.frictionStatic=c.frictionStatic>h.frictionStatic?c.frictionStatic:h.frictionStatic,s.restitution=c.restitution>h.restitution?c.restitution:h.restitution,s.slop=c.slop>h.slop?c.slop:h.slop,s.contactCount=u,o.pair=s;var d=l[0],p=f[0],_=l[1],y=f[1];(y.vertex===d||p.vertex===_)&&(f[1]=p,f[0]=p=y,y=f[1]),p.vertex=d,y.vertex=_},i.setActive=function(s,o,a){o?(s.isActive=!0,s.timeUpdated=a):(s.isActive=!1,s.contactCount=0)},i.id=function(s,o){return s.id<o.id?s.id.toString(36)+":"+o.id.toString(36):o.id.toString(36)+":"+s.id.toString(36)}})()},function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(2),o=t(7),a=t(1),l=t(11),u=t(0);(function(){i._warming=.4,i._torqueDampen=1,i._minLength=1e-6,i.create=function(f){var c=f;c.bodyA&&!c.pointA&&(c.pointA={x:0,y:0}),c.bodyB&&!c.pointB&&(c.pointB={x:0,y:0});var h=c.bodyA?s.add(c.bodyA.position,c.pointA):c.pointA,d=c.bodyB?s.add(c.bodyB.position,c.pointB):c.pointB,p=s.magnitude(s.sub(h,d));c.length=typeof c.length<"u"?c.length:p,c.id=c.id||u.nextId(),c.label=c.label||"Constraint",c.type="constraint",c.stiffness=c.stiffness||(c.length>0?1:.7),c.damping=c.damping||0,c.angularStiffness=c.angularStiffness||0,c.angleA=c.bodyA?c.bodyA.angle:c.angleA,c.angleB=c.bodyB?c.bodyB.angle:c.angleB,c.plugin={};var _={visible:!0,lineWidth:2,strokeStyle:"#ffffff",type:"line",anchors:!0};return c.length===0&&c.stiffness>.1?(_.type="pin",_.anchors=!1):c.stiffness<.9&&(_.type="spring"),c.render=u.extend(_,c.render),c},i.preSolveAll=function(f){for(var c=0;c<f.length;c+=1){var h=f[c],d=h.constraintImpulse;h.isStatic||d.x===0&&d.y===0&&d.angle===0||(h.position.x+=d.x,h.position.y+=d.y,h.angle+=d.angle)}},i.solveAll=function(f,c){for(var h=u.clamp(c/u._baseDelta,0,1),d=0;d<f.length;d+=1){var p=f[d],_=!p.bodyA||p.bodyA&&p.bodyA.isStatic,y=!p.bodyB||p.bodyB&&p.bodyB.isStatic;(_||y)&&i.solve(f[d],h)}for(d=0;d<f.length;d+=1)p=f[d],_=!p.bodyA||p.bodyA&&p.bodyA.isStatic,y=!p.bodyB||p.bodyB&&p.bodyB.isStatic,!_&&!y&&i.solve(f[d],h)},i.solve=function(f,c){var h=f.bodyA,d=f.bodyB,p=f.pointA,_=f.pointB;if(!(!h&&!d)){h&&!h.isStatic&&(s.rotate(p,h.angle-f.angleA,p),f.angleA=h.angle),d&&!d.isStatic&&(s.rotate(_,d.angle-f.angleB,_),f.angleB=d.angle);var y=p,m=_;if(h&&(y=s.add(h.position,p)),d&&(m=s.add(d.position,_)),!(!y||!m)){var v=s.sub(y,m),g=s.magnitude(v);g<i._minLength&&(g=i._minLength);var S=(g-f.length)/g,E=f.stiffness>=1||f.length===0,M=E?f.stiffness*c:f.stiffness*c*c,T=f.damping*c,x=s.mult(v,S*M),w=(h?h.inverseMass:0)+(d?d.inverseMass:0),C=(h?h.inverseInertia:0)+(d?d.inverseInertia:0),A=w+C,I,D,F,L,N;if(T>0){var B=s.create();F=s.div(v,g),N=s.sub(d&&s.sub(d.position,d.positionPrev)||B,h&&s.sub(h.position,h.positionPrev)||B),L=s.dot(F,N)}h&&!h.isStatic&&(D=h.inverseMass/w,h.constraintImpulse.x-=x.x*D,h.constraintImpulse.y-=x.y*D,h.position.x-=x.x*D,h.position.y-=x.y*D,T>0&&(h.positionPrev.x-=T*F.x*L*D,h.positionPrev.y-=T*F.y*L*D),I=s.cross(p,x)/A*i._torqueDampen*h.inverseInertia*(1-f.angularStiffness),h.constraintImpulse.angle-=I,h.angle-=I),d&&!d.isStatic&&(D=d.inverseMass/w,d.constraintImpulse.x+=x.x*D,d.constraintImpulse.y+=x.y*D,d.position.x+=x.x*D,d.position.y+=x.y*D,T>0&&(d.positionPrev.x+=T*F.x*L*D,d.positionPrev.y+=T*F.y*L*D),I=s.cross(_,x)/A*i._torqueDampen*d.inverseInertia*(1-f.angularStiffness),d.constraintImpulse.angle+=I,d.angle+=I)}}},i.postSolveAll=function(f){for(var c=0;c<f.length;c++){var h=f[c],d=h.constraintImpulse;if(!(h.isStatic||d.x===0&&d.y===0&&d.angle===0)){o.set(h,!1);for(var p=0;p<h.parts.length;p++){var _=h.parts[p];r.translate(_.vertices,d),p>0&&(_.position.x+=d.x,_.position.y+=d.y),d.angle!==0&&(r.rotate(_.vertices,d.angle,h.position),l.rotate(_.axes,d.angle),p>0&&s.rotateAbout(_.position,d.angle,h.position,_.position)),a.update(_.bounds,_.vertices,h.velocity)}d.angle*=i._warming,d.x*=i._warming,d.y*=i._warming}}},i.pointAWorld=function(f){return{x:(f.bodyA?f.bodyA.position.x:0)+(f.pointA?f.pointA.x:0),y:(f.bodyA?f.bodyA.position.y:0)+(f.pointA?f.pointA.y:0)}},i.pointBWorld=function(f){return{x:(f.bodyB?f.bodyB.position.x:0)+(f.pointB?f.pointB.x:0),y:(f.bodyB?f.bodyB.position.y:0)+(f.pointB?f.pointB.y:0)}},i.currentLength=function(f){var c=(f.bodyA?f.bodyA.position.x:0)+(f.pointA?f.pointA.x:0),h=(f.bodyA?f.bodyA.position.y:0)+(f.pointA?f.pointA.y:0),d=(f.bodyB?f.bodyB.position.x:0)+(f.pointB?f.pointB.x:0),p=(f.bodyB?f.bodyB.position.y:0)+(f.pointB?f.pointB.y:0),_=c-d,y=h-p;return Math.sqrt(_*_+y*y)}})()},function(n,e,t){var i={};n.exports=i;var r=t(2),s=t(0);(function(){i.fromVertices=function(o){for(var a={},l=0;l<o.length;l++){var u=(l+1)%o.length,f=r.normalise({x:o[u].y-o[l].y,y:o[l].x-o[u].x}),c=f.y===0?1/0:f.x/f.y;c=c.toFixed(3).toString(),a[c]=f}return s.values(a)},i.rotate=function(o,a){if(a!==0)for(var l=Math.cos(a),u=Math.sin(a),f=0;f<o.length;f++){var c=o[f],h;h=c.x*l-c.y*u,c.y=c.x*u+c.y*l,c.x=h}}})()},function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(0),o=t(4),a=t(1),l=t(2);(function(){i.rectangle=function(u,f,c,h,d){d=d||{};var p={label:"Rectangle Body",position:{x:u,y:f},vertices:r.fromPath("L 0 0 L "+c+" 0 L "+c+" "+h+" L 0 "+h)};if(d.chamfer){var _=d.chamfer;p.vertices=r.chamfer(p.vertices,_.radius,_.quality,_.qualityMin,_.qualityMax),delete d.chamfer}return o.create(s.extend({},p,d))},i.trapezoid=function(u,f,c,h,d,p){p=p||{},d>=1&&s.warn("Bodies.trapezoid: slope parameter must be < 1."),d*=.5;var _=(1-d*2)*c,y=c*d,m=y+_,v=m+y,g;d<.5?g="L 0 0 L "+y+" "+-h+" L "+m+" "+-h+" L "+v+" 0":g="L 0 0 L "+m+" "+-h+" L "+v+" 0";var S={label:"Trapezoid Body",position:{x:u,y:f},vertices:r.fromPath(g)};if(p.chamfer){var E=p.chamfer;S.vertices=r.chamfer(S.vertices,E.radius,E.quality,E.qualityMin,E.qualityMax),delete p.chamfer}return o.create(s.extend({},S,p))},i.circle=function(u,f,c,h,d){h=h||{};var p={label:"Circle Body",circleRadius:c};d=d||25;var _=Math.ceil(Math.max(10,Math.min(d,c)));return _%2===1&&(_+=1),i.polygon(u,f,_,c,s.extend({},p,h))},i.polygon=function(u,f,c,h,d){if(d=d||{},c<3)return i.circle(u,f,h,d);for(var p=2*Math.PI/c,_="",y=p*.5,m=0;m<c;m+=1){var v=y+m*p,g=Math.cos(v)*h,S=Math.sin(v)*h;_+="L "+g.toFixed(3)+" "+S.toFixed(3)+" "}var E={label:"Polygon Body",position:{x:u,y:f},vertices:r.fromPath(_)};if(d.chamfer){var M=d.chamfer;E.vertices=r.chamfer(E.vertices,M.radius,M.quality,M.qualityMin,M.qualityMax),delete d.chamfer}return o.create(s.extend({},E,d))},i.fromVertices=function(u,f,c,h,d,p,_,y){var m=s.getDecomp(),v,g,S,E,M,T,x,w,C,A,I;for(v=!!(m&&m.quickDecomp),h=h||{},S=[],d=typeof d<"u"?d:!1,p=typeof p<"u"?p:.01,_=typeof _<"u"?_:10,y=typeof y<"u"?y:.01,s.isArray(c[0])||(c=[c]),A=0;A<c.length;A+=1)if(T=c[A],E=r.isConvex(T),M=!E,M&&!v&&s.warnOnce("Bodies.fromVertices: Install the 'poly-decomp' library and use Common.setDecomp or provide 'decomp' as a global to decompose concave vertices."),E||!v)E?T=r.clockwiseSort(T):T=r.hull(T),S.push({position:{x:u,y:f},vertices:T});else{var D=T.map(function(Ie){return[Ie.x,Ie.y]});m.makeCCW(D),p!==!1&&m.removeCollinearPoints(D,p),y!==!1&&m.removeDuplicatePoints&&m.removeDuplicatePoints(D,y);var F=m.quickDecomp(D);for(x=0;x<F.length;x++){var L=F[x],N=L.map(function(Ie){return{x:Ie[0],y:Ie[1]}});_>0&&r.area(N)<_||S.push({position:r.centre(N),vertices:N})}}for(x=0;x<S.length;x++)S[x]=o.create(s.extend(S[x],h));if(d){var B=5;for(x=0;x<S.length;x++){var H=S[x];for(w=x+1;w<S.length;w++){var Z=S[w];if(a.overlaps(H.bounds,Z.bounds)){var Y=H.vertices,se=Z.vertices;for(C=0;C<H.vertices.length;C++)for(I=0;I<Z.vertices.length;I++){var ue=l.magnitudeSquared(l.sub(Y[(C+1)%Y.length],se[I])),Be=l.magnitudeSquared(l.sub(Y[C],se[(I+1)%se.length]));ue<B&&Be<B&&(Y[C].isInternal=!0,se[I].isInternal=!0)}}}}}return S.length>1?(g=o.create(s.extend({parts:S.slice(0)},h)),o.setPosition(g,{x:u,y:f}),g):S[0]}})()},function(n,e,t){var i={};n.exports=i;var r=t(0),s=t(8);(function(){i.create=function(o){var a={bodies:[],collisions:[],pairs:null};return r.extend(a,o)},i.setBodies=function(o,a){o.bodies=a.slice(0)},i.clear=function(o){o.bodies=[],o.collisions=[]},i.collisions=function(o){var a=o.pairs,l=o.bodies,u=l.length,f=i.canCollide,c=s.collides,h=o.collisions,d=0,p,_;for(l.sort(i._compareBoundsX),p=0;p<u;p++){var y=l[p],m=y.bounds,v=y.bounds.max.x,g=y.bounds.max.y,S=y.bounds.min.y,E=y.isStatic||y.isSleeping,M=y.parts.length,T=M===1;for(_=p+1;_<u;_++){var x=l[_],w=x.bounds;if(w.min.x>v)break;if(!(g<w.min.y||S>w.max.y)&&!(E&&(x.isStatic||x.isSleeping))&&f(y.collisionFilter,x.collisionFilter)){var C=x.parts.length;if(T&&C===1){var A=c(y,x,a);A&&(h[d++]=A)}else for(var I=M>1?1:0,D=C>1?1:0,F=I;F<M;F++)for(var L=y.parts[F],m=L.bounds,N=D;N<C;N++){var B=x.parts[N],w=B.bounds;if(!(m.min.x>w.max.x||m.max.x<w.min.x||m.max.y<w.min.y||m.min.y>w.max.y)){var A=c(L,B,a);A&&(h[d++]=A)}}}}}return h.length!==d&&(h.length=d),h},i.canCollide=function(o,a){return o.group===a.group&&o.group!==0?o.group>0:(o.mask&a.category)!==0&&(a.mask&o.category)!==0},i._compareBoundsX=function(o,a){return o.bounds.min.x-a.bounds.min.x}})()},function(n,e,t){var i={};n.exports=i;var r=t(0);(function(){i.create=function(s){var o={};return s||r.log("Mouse.create: element was undefined, defaulting to document.body","warn"),o.element=s||document.body,o.absolute={x:0,y:0},o.position={x:0,y:0},o.mousedownPosition={x:0,y:0},o.mouseupPosition={x:0,y:0},o.offset={x:0,y:0},o.scale={x:1,y:1},o.wheelDelta=0,o.button=-1,o.pixelRatio=parseInt(o.element.getAttribute("data-pixel-ratio"),10)||1,o.sourceEvents={mousemove:null,mousedown:null,mouseup:null,mousewheel:null},o.mousemove=function(a){var l=i._getRelativeMousePosition(a,o.element,o.pixelRatio),u=a.changedTouches;u&&(o.button=0,a.preventDefault()),o.absolute.x=l.x,o.absolute.y=l.y,o.position.x=o.absolute.x*o.scale.x+o.offset.x,o.position.y=o.absolute.y*o.scale.y+o.offset.y,o.sourceEvents.mousemove=a},o.mousedown=function(a){var l=i._getRelativeMousePosition(a,o.element,o.pixelRatio),u=a.changedTouches;u?(o.button=0,a.preventDefault()):o.button=a.button,o.absolute.x=l.x,o.absolute.y=l.y,o.position.x=o.absolute.x*o.scale.x+o.offset.x,o.position.y=o.absolute.y*o.scale.y+o.offset.y,o.mousedownPosition.x=o.position.x,o.mousedownPosition.y=o.position.y,o.sourceEvents.mousedown=a},o.mouseup=function(a){var l=i._getRelativeMousePosition(a,o.element,o.pixelRatio),u=a.changedTouches;u&&a.preventDefault(),o.button=-1,o.absolute.x=l.x,o.absolute.y=l.y,o.position.x=o.absolute.x*o.scale.x+o.offset.x,o.position.y=o.absolute.y*o.scale.y+o.offset.y,o.mouseupPosition.x=o.position.x,o.mouseupPosition.y=o.position.y,o.sourceEvents.mouseup=a},o.mousewheel=function(a){o.wheelDelta=Math.max(-1,Math.min(1,a.wheelDelta||-a.detail)),a.preventDefault(),o.sourceEvents.mousewheel=a},i.setElement(o,o.element),o},i.setElement=function(s,o){s.element=o,o.addEventListener("mousemove",s.mousemove,{passive:!0}),o.addEventListener("mousedown",s.mousedown,{passive:!0}),o.addEventListener("mouseup",s.mouseup,{passive:!0}),o.addEventListener("wheel",s.mousewheel,{passive:!1}),o.addEventListener("touchmove",s.mousemove,{passive:!1}),o.addEventListener("touchstart",s.mousedown,{passive:!1}),o.addEventListener("touchend",s.mouseup,{passive:!1})},i.clearSourceEvents=function(s){s.sourceEvents.mousemove=null,s.sourceEvents.mousedown=null,s.sourceEvents.mouseup=null,s.sourceEvents.mousewheel=null,s.wheelDelta=0},i.setOffset=function(s,o){s.offset.x=o.x,s.offset.y=o.y,s.position.x=s.absolute.x*s.scale.x+s.offset.x,s.position.y=s.absolute.y*s.scale.y+s.offset.y},i.setScale=function(s,o){s.scale.x=o.x,s.scale.y=o.y,s.position.x=s.absolute.x*s.scale.x+s.offset.x,s.position.y=s.absolute.y*s.scale.y+s.offset.y},i._getRelativeMousePosition=function(s,o,a){var l=o.getBoundingClientRect(),u=document.documentElement||document.body.parentNode||document.body,f=window.pageXOffset!==void 0?window.pageXOffset:u.scrollLeft,c=window.pageYOffset!==void 0?window.pageYOffset:u.scrollTop,h=s.changedTouches,d,p;return h?(d=h[0].pageX-l.left-f,p=h[0].pageY-l.top-c):(d=s.pageX-l.left-f,p=s.pageY-l.top-c),{x:d/(o.clientWidth/(o.width||o.clientWidth)*a),y:p/(o.clientHeight/(o.height||o.clientHeight)*a)}}})()},function(n,e,t){var i={};n.exports=i;var r=t(0);(function(){i._registry={},i.register=function(s){if(i.isPlugin(s)||r.warn("Plugin.register:",i.toString(s),"does not implement all required fields."),s.name in i._registry){var o=i._registry[s.name],a=i.versionParse(s.version).number,l=i.versionParse(o.version).number;a>l?(r.warn("Plugin.register:",i.toString(o),"was upgraded to",i.toString(s)),i._registry[s.name]=s):a<l?r.warn("Plugin.register:",i.toString(o),"can not be downgraded to",i.toString(s)):s!==o&&r.warn("Plugin.register:",i.toString(s),"is already registered to different plugin object")}else i._registry[s.name]=s;return s},i.resolve=function(s){return i._registry[i.dependencyParse(s).name]},i.toString=function(s){return typeof s=="string"?s:(s.name||"anonymous")+"@"+(s.version||s.range||"0.0.0")},i.isPlugin=function(s){return s&&s.name&&s.version&&s.install},i.isUsed=function(s,o){return s.used.indexOf(o)>-1},i.isFor=function(s,o){var a=s.for&&i.dependencyParse(s.for);return!s.for||o.name===a.name&&i.versionSatisfies(o.version,a.range)},i.use=function(s,o){if(s.uses=(s.uses||[]).concat(o||[]),s.uses.length===0){r.warn("Plugin.use:",i.toString(s),"does not specify any dependencies to install.");return}for(var a=i.dependencies(s),l=r.topologicalSort(a),u=[],f=0;f<l.length;f+=1)if(l[f]!==s.name){var c=i.resolve(l[f]);if(!c){u.push("\u274C "+l[f]);continue}i.isUsed(s,c.name)||(i.isFor(c,s)||(r.warn("Plugin.use:",i.toString(c),"is for",c.for,"but installed on",i.toString(s)+"."),c._warned=!0),c.install?c.install(s):(r.warn("Plugin.use:",i.toString(c),"does not specify an install function."),c._warned=!0),c._warned?(u.push("\u{1F536} "+i.toString(c)),delete c._warned):u.push("\u2705 "+i.toString(c)),s.used.push(c.name))}u.length>0&&r.info(u.join("  "))},i.dependencies=function(s,o){var a=i.dependencyParse(s),l=a.name;if(o=o||{},!(l in o)){s=i.resolve(s)||s,o[l]=r.map(s.uses||[],function(f){i.isPlugin(f)&&i.register(f);var c=i.dependencyParse(f),h=i.resolve(f);return h&&!i.versionSatisfies(h.version,c.range)?(r.warn("Plugin.dependencies:",i.toString(h),"does not satisfy",i.toString(c),"used by",i.toString(a)+"."),h._warned=!0,s._warned=!0):h||(r.warn("Plugin.dependencies:",i.toString(f),"used by",i.toString(a),"could not be resolved."),s._warned=!0),c.name});for(var u=0;u<o[l].length;u+=1)i.dependencies(o[l][u],o);return o}},i.dependencyParse=function(s){if(r.isString(s)){var o=/^[\w-]+(@(\*|[\^~]?\d+\.\d+\.\d+(-[0-9A-Za-z-+]+)?))?$/;return o.test(s)||r.warn("Plugin.dependencyParse:",s,"is not a valid dependency string."),{name:s.split("@")[0],range:s.split("@")[1]||"*"}}return{name:s.name,range:s.range||s.version}},i.versionParse=function(s){var o=/^(\*)|(\^|~|>=|>)?\s*((\d+)\.(\d+)\.(\d+))(-[0-9A-Za-z-+]+)?$/;o.test(s)||r.warn("Plugin.versionParse:",s,"is not a valid version or range.");var a=o.exec(s),l=Number(a[4]),u=Number(a[5]),f=Number(a[6]);return{isRange:!!(a[1]||a[2]),version:a[3],range:s,operator:a[1]||a[2]||"",major:l,minor:u,patch:f,parts:[l,u,f],prerelease:a[7],number:l*1e8+u*1e4+f}},i.versionSatisfies=function(s,o){o=o||"*";var a=i.versionParse(o),l=i.versionParse(s);if(a.isRange){if(a.operator==="*"||s==="*")return!0;if(a.operator===">")return l.number>a.number;if(a.operator===">=")return l.number>=a.number;if(a.operator==="~")return l.major===a.major&&l.minor===a.minor&&l.patch>=a.patch;if(a.operator==="^")return a.major>0?l.major===a.major&&l.number>=a.number:a.minor>0?l.minor===a.minor&&l.patch>=a.patch:l.patch===a.patch}return s===o||s==="*"}})()},function(n,e){var t={};n.exports=t,function(){t.create=function(i){return{vertex:i,normalImpulse:0,tangentImpulse:0}}}()},function(n,e,t){var i={};n.exports=i;var r=t(7),s=t(18),o=t(13),a=t(19),l=t(5),u=t(6),f=t(10),c=t(0),h=t(4);(function(){i._deltaMax=1e3/60,i.create=function(d){d=d||{};var p={positionIterations:6,velocityIterations:4,constraintIterations:2,enableSleeping:!1,events:[],plugin:{},gravity:{x:0,y:1,scale:.001},timing:{timestamp:0,timeScale:1,lastDelta:0,lastElapsed:0,lastUpdatesPerFrame:0}},_=c.extend(p,d);return _.world=d.world||u.create({label:"World"}),_.pairs=d.pairs||a.create(),_.detector=d.detector||o.create(),_.detector.pairs=_.pairs,_.grid={buckets:[]},_.world.gravity=_.gravity,_.broadphase=_.grid,_.metrics={},_},i.update=function(d,p){var _=c.now(),y=d.world,m=d.detector,v=d.pairs,g=d.timing,S=g.timestamp,E;p>i._deltaMax&&c.warnOnce("Matter.Engine.update: delta argument is recommended to be less than or equal to",i._deltaMax.toFixed(3),"ms."),p=typeof p<"u"?p:c._baseDelta,p*=g.timeScale,g.timestamp+=p,g.lastDelta=p;var M={timestamp:g.timestamp,delta:p};l.trigger(d,"beforeUpdate",M);var T=u.allBodies(y),x=u.allConstraints(y);for(y.isModified&&(o.setBodies(m,T),u.setModified(y,!1,!1,!0)),d.enableSleeping&&r.update(T,p),i._bodiesApplyGravity(T,d.gravity),p>0&&i._bodiesUpdate(T,p),l.trigger(d,"beforeSolve",M),f.preSolveAll(T),E=0;E<d.constraintIterations;E++)f.solveAll(x,p);f.postSolveAll(T);var w=o.collisions(m);a.update(v,w,S),d.enableSleeping&&r.afterCollisions(v.list),v.collisionStart.length>0&&l.trigger(d,"collisionStart",{pairs:v.collisionStart,timestamp:g.timestamp,delta:p});var C=c.clamp(20/d.positionIterations,0,1);for(s.preSolvePosition(v.list),E=0;E<d.positionIterations;E++)s.solvePosition(v.list,p,C);for(s.postSolvePosition(T),f.preSolveAll(T),E=0;E<d.constraintIterations;E++)f.solveAll(x,p);for(f.postSolveAll(T),s.preSolveVelocity(v.list),E=0;E<d.velocityIterations;E++)s.solveVelocity(v.list,p);return i._bodiesUpdateVelocities(T),v.collisionActive.length>0&&l.trigger(d,"collisionActive",{pairs:v.collisionActive,timestamp:g.timestamp,delta:p}),v.collisionEnd.length>0&&l.trigger(d,"collisionEnd",{pairs:v.collisionEnd,timestamp:g.timestamp,delta:p}),i._bodiesClearForces(T),l.trigger(d,"afterUpdate",M),d.timing.lastElapsed=c.now()-_,d},i.merge=function(d,p){if(c.extend(d,p),p.world){d.world=p.world,i.clear(d);for(var _=u.allBodies(d.world),y=0;y<_.length;y++){var m=_[y];r.set(m,!1),m.id=c.nextId()}}},i.clear=function(d){a.clear(d.pairs),o.clear(d.detector)},i._bodiesClearForces=function(d){for(var p=d.length,_=0;_<p;_++){var y=d[_];y.force.x=0,y.force.y=0,y.torque=0}},i._bodiesApplyGravity=function(d,p){var _=typeof p.scale<"u"?p.scale:.001,y=d.length;if(!(p.x===0&&p.y===0||_===0))for(var m=0;m<y;m++){var v=d[m];v.isStatic||v.isSleeping||(v.force.y+=v.mass*p.y*_,v.force.x+=v.mass*p.x*_)}},i._bodiesUpdate=function(d,p){for(var _=d.length,y=0;y<_;y++){var m=d[y];m.isStatic||m.isSleeping||h.update(m,p)}},i._bodiesUpdateVelocities=function(d){for(var p=d.length,_=0;_<p;_++)h.updateVelocities(d[_])}})()},function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(0),o=t(1);(function(){i._restingThresh=2,i._restingThreshTangent=Math.sqrt(6),i._positionDampen=.9,i._positionWarming=.8,i._frictionNormalMultiplier=5,i._frictionMaxStatic=Number.MAX_VALUE,i.preSolvePosition=function(a){var l,u,f,c=a.length;for(l=0;l<c;l++)u=a[l],u.isActive&&(f=u.contactCount,u.collision.parentA.totalContacts+=f,u.collision.parentB.totalContacts+=f)},i.solvePosition=function(a,l,u){var f,c,h,d,p,_,y,m,v=i._positionDampen*(u||1),g=s.clamp(l/s._baseDelta,0,1),S=a.length;for(f=0;f<S;f++)c=a[f],!(!c.isActive||c.isSensor)&&(h=c.collision,d=h.parentA,p=h.parentB,_=h.normal,c.separation=h.depth+_.x*(p.positionImpulse.x-d.positionImpulse.x)+_.y*(p.positionImpulse.y-d.positionImpulse.y));for(f=0;f<S;f++)c=a[f],!(!c.isActive||c.isSensor)&&(h=c.collision,d=h.parentA,p=h.parentB,_=h.normal,m=c.separation-c.slop*g,(d.isStatic||p.isStatic)&&(m*=2),d.isStatic||d.isSleeping||(y=v/d.totalContacts,d.positionImpulse.x+=_.x*m*y,d.positionImpulse.y+=_.y*m*y),p.isStatic||p.isSleeping||(y=v/p.totalContacts,p.positionImpulse.x-=_.x*m*y,p.positionImpulse.y-=_.y*m*y))},i.postSolvePosition=function(a){for(var l=i._positionWarming,u=a.length,f=r.translate,c=o.update,h=0;h<u;h++){var d=a[h],p=d.positionImpulse,_=p.x,y=p.y,m=d.velocity;if(d.totalContacts=0,_!==0||y!==0){for(var v=0;v<d.parts.length;v++){var g=d.parts[v];f(g.vertices,p),c(g.bounds,g.vertices,m),g.position.x+=_,g.position.y+=y}d.positionPrev.x+=_,d.positionPrev.y+=y,_*m.x+y*m.y<0?(p.x=0,p.y=0):(p.x*=l,p.y*=l)}}},i.preSolveVelocity=function(a){var l=a.length,u,f;for(u=0;u<l;u++){var c=a[u];if(!(!c.isActive||c.isSensor)){var h=c.contacts,d=c.contactCount,p=c.collision,_=p.parentA,y=p.parentB,m=p.normal,v=p.tangent;for(f=0;f<d;f++){var g=h[f],S=g.vertex,E=g.normalImpulse,M=g.tangentImpulse;if(E!==0||M!==0){var T=m.x*E+v.x*M,x=m.y*E+v.y*M;_.isStatic||_.isSleeping||(_.positionPrev.x+=T*_.inverseMass,_.positionPrev.y+=x*_.inverseMass,_.anglePrev+=_.inverseInertia*((S.x-_.position.x)*x-(S.y-_.position.y)*T)),y.isStatic||y.isSleeping||(y.positionPrev.x-=T*y.inverseMass,y.positionPrev.y-=x*y.inverseMass,y.anglePrev-=y.inverseInertia*((S.x-y.position.x)*x-(S.y-y.position.y)*T))}}}}},i.solveVelocity=function(a,l){var u=l/s._baseDelta,f=u*u,c=f*u,h=-i._restingThresh*u,d=i._restingThreshTangent,p=i._frictionNormalMultiplier*u,_=i._frictionMaxStatic,y=a.length,m,v,g,S;for(g=0;g<y;g++){var E=a[g];if(!(!E.isActive||E.isSensor)){var M=E.collision,T=M.parentA,x=M.parentB,w=M.normal.x,C=M.normal.y,A=M.tangent.x,I=M.tangent.y,D=E.inverseMass,F=E.friction*E.frictionStatic*p,L=E.contacts,N=E.contactCount,B=1/N,H=T.position.x-T.positionPrev.x,Z=T.position.y-T.positionPrev.y,Y=T.angle-T.anglePrev,se=x.position.x-x.positionPrev.x,ue=x.position.y-x.positionPrev.y,Be=x.angle-x.anglePrev;for(S=0;S<N;S++){var Ie=L[S],Ue=Ie.vertex,J=Ue.x-T.position.x,me=Ue.y-T.position.y,ae=Ue.x-x.position.x,Ae=Ue.y-x.position.y,be=H-me*Y,Fe=Z+J*Y,at=se-Ae*Be,qe=ue+ae*Be,et=be-at,rt=Fe-qe,G=w*et+C*rt,ne=A*et+I*rt,ie=E.separation+G,ve=Math.min(ie,1);ve=ie<0?0:ve;var U=ve*F;ne<-U||ne>U?(v=ne>0?ne:-ne,m=E.friction*(ne>0?1:-1)*c,m<-v?m=-v:m>v&&(m=v)):(m=ne,v=_);var Ne=J*C-me*w,Q=ae*C-Ae*w,xe=B/(D+T.inverseInertia*Ne*Ne+x.inverseInertia*Q*Q),re=(1+E.restitution)*G*xe;if(m*=xe,G<h)Ie.normalImpulse=0;else{var Le=Ie.normalImpulse;Ie.normalImpulse+=re,Ie.normalImpulse>0&&(Ie.normalImpulse=0),re=Ie.normalImpulse-Le}if(ne<-d||ne>d)Ie.tangentImpulse=0;else{var P=Ie.tangentImpulse;Ie.tangentImpulse+=m,Ie.tangentImpulse<-v&&(Ie.tangentImpulse=-v),Ie.tangentImpulse>v&&(Ie.tangentImpulse=v),m=Ie.tangentImpulse-P}var b=w*re+A*m,k=C*re+I*m;T.isStatic||T.isSleeping||(T.positionPrev.x+=b*T.inverseMass,T.positionPrev.y+=k*T.inverseMass,T.anglePrev+=(J*k-me*b)*T.inverseInertia),x.isStatic||x.isSleeping||(x.positionPrev.x-=b*x.inverseMass,x.positionPrev.y-=k*x.inverseMass,x.anglePrev-=(ae*k-Ae*b)*x.inverseInertia)}}}}})()},function(n,e,t){var i={};n.exports=i;var r=t(9),s=t(0);(function(){i.create=function(o){return s.extend({table:{},list:[],collisionStart:[],collisionActive:[],collisionEnd:[]},o)},i.update=function(o,a,l){var u=r.update,f=r.create,c=r.setActive,h=o.table,d=o.list,p=d.length,_=p,y=o.collisionStart,m=o.collisionEnd,v=o.collisionActive,g=a.length,S=0,E=0,M=0,T,x,w;for(w=0;w<g;w++)T=a[w],x=T.pair,x?(x.isActive&&(v[M++]=x),u(x,T,l)):(x=f(T,l),h[x.id]=x,y[S++]=x,d[_++]=x);for(_=0,p=d.length,w=0;w<p;w++)x=d[w],x.timeUpdated>=l?d[_++]=x:(c(x,!1,l),x.collision.bodyA.sleepCounter>0&&x.collision.bodyB.sleepCounter>0?d[_++]=x:(m[E++]=x,delete h[x.id]));d.length!==_&&(d.length=_),y.length!==S&&(y.length=S),m.length!==E&&(m.length=E),v.length!==M&&(v.length=M)},i.clear=function(o){return o.table={},o.list.length=0,o.collisionStart.length=0,o.collisionActive.length=0,o.collisionEnd.length=0,o}})()},function(n,e,t){var i=n.exports=t(21);i.Axes=t(11),i.Bodies=t(12),i.Body=t(4),i.Bounds=t(1),i.Collision=t(8),i.Common=t(0),i.Composite=t(6),i.Composites=t(22),i.Constraint=t(10),i.Contact=t(16),i.Detector=t(13),i.Engine=t(17),i.Events=t(5),i.Grid=t(23),i.Mouse=t(14),i.MouseConstraint=t(24),i.Pair=t(9),i.Pairs=t(19),i.Plugin=t(15),i.Query=t(25),i.Render=t(26),i.Resolver=t(18),i.Runner=t(27),i.SAT=t(28),i.Sleeping=t(7),i.Svg=t(29),i.Vector=t(2),i.Vertices=t(3),i.World=t(30),i.Engine.run=i.Runner.run,i.Common.deprecated(i.Engine,"run","Engine.run \u27A4 use Matter.Runner.run(engine) instead")},function(n,e,t){var i={};n.exports=i;var r=t(15),s=t(0);(function(){i.name="matter-js",i.version="0.20.0",i.uses=[],i.used=[],i.use=function(){r.use(i,Array.prototype.slice.call(arguments))},i.before=function(o,a){return o=o.replace(/^Matter./,""),s.chainPathBefore(i,o,a)},i.after=function(o,a){return o=o.replace(/^Matter./,""),s.chainPathAfter(i,o,a)}})()},function(n,e,t){var i={};n.exports=i;var r=t(6),s=t(10),o=t(0),a=t(4),l=t(12),u=o.deprecated;(function(){i.stack=function(f,c,h,d,p,_,y){for(var m=r.create({label:"Stack"}),v=f,g=c,S,E=0,M=0;M<d;M++){for(var T=0,x=0;x<h;x++){var w=y(v,g,x,M,S,E);if(w){var C=w.bounds.max.y-w.bounds.min.y,A=w.bounds.max.x-w.bounds.min.x;C>T&&(T=C),a.translate(w,{x:A*.5,y:C*.5}),v=w.bounds.max.x+p,r.addBody(m,w),S=w,E+=1}else v+=p}g+=T+_,v=f}return m},i.chain=function(f,c,h,d,p,_){for(var y=f.bodies,m=1;m<y.length;m++){var v=y[m-1],g=y[m],S=v.bounds.max.y-v.bounds.min.y,E=v.bounds.max.x-v.bounds.min.x,M=g.bounds.max.y-g.bounds.min.y,T=g.bounds.max.x-g.bounds.min.x,x={bodyA:v,pointA:{x:E*c,y:S*h},bodyB:g,pointB:{x:T*d,y:M*p}},w=o.extend(x,_);r.addConstraint(f,s.create(w))}return f.label+=" Chain",f},i.mesh=function(f,c,h,d,p){var _=f.bodies,y,m,v,g,S;for(y=0;y<h;y++){for(m=1;m<c;m++)v=_[m-1+y*c],g=_[m+y*c],r.addConstraint(f,s.create(o.extend({bodyA:v,bodyB:g},p)));if(y>0)for(m=0;m<c;m++)v=_[m+(y-1)*c],g=_[m+y*c],r.addConstraint(f,s.create(o.extend({bodyA:v,bodyB:g},p))),d&&m>0&&(S=_[m-1+(y-1)*c],r.addConstraint(f,s.create(o.extend({bodyA:S,bodyB:g},p)))),d&&m<c-1&&(S=_[m+1+(y-1)*c],r.addConstraint(f,s.create(o.extend({bodyA:S,bodyB:g},p))))}return f.label+=" Mesh",f},i.pyramid=function(f,c,h,d,p,_,y){return i.stack(f,c,h,d,p,_,function(m,v,g,S,E,M){var T=Math.min(d,Math.ceil(h/2)),x=E?E.bounds.max.x-E.bounds.min.x:0;if(!(S>T)){S=T-S;var w=S,C=h-1-S;if(!(g<w||g>C)){M===1&&a.translate(E,{x:(g+(h%2===1?1:-1))*x,y:0});var A=E?g*x:0;return y(f+A+g*p,v,g,S,E,M)}}})},i.newtonsCradle=function(f,c,h,d,p){for(var _=r.create({label:"Newtons Cradle"}),y=0;y<h;y++){var m=1.9,v=l.circle(f+y*(d*m),c+p,d,{inertia:1/0,restitution:1,friction:0,frictionAir:1e-4,slop:1}),g=s.create({pointA:{x:f+y*(d*m),y:c},bodyB:v});r.addBody(_,v),r.addConstraint(_,g)}return _},u(i,"newtonsCradle","Composites.newtonsCradle \u27A4 moved to newtonsCradle example"),i.car=function(f,c,h,d,p){var _=a.nextGroup(!0),y=20,m=-h*.5+y,v=h*.5-y,g=0,S=r.create({label:"Car"}),E=l.rectangle(f,c,h,d,{collisionFilter:{group:_},chamfer:{radius:d*.5},density:2e-4}),M=l.circle(f+m,c+g,p,{collisionFilter:{group:_},friction:.8}),T=l.circle(f+v,c+g,p,{collisionFilter:{group:_},friction:.8}),x=s.create({bodyB:E,pointB:{x:m,y:g},bodyA:M,stiffness:1,length:0}),w=s.create({bodyB:E,pointB:{x:v,y:g},bodyA:T,stiffness:1,length:0});return r.addBody(S,E),r.addBody(S,M),r.addBody(S,T),r.addConstraint(S,x),r.addConstraint(S,w),S},u(i,"car","Composites.car \u27A4 moved to car example"),i.softBody=function(f,c,h,d,p,_,y,m,v,g){v=o.extend({inertia:1/0},v),g=o.extend({stiffness:.2,render:{type:"line",anchors:!1}},g);var S=i.stack(f,c,h,d,p,_,function(E,M){return l.circle(E,M,m,v)});return i.mesh(S,h,d,y,g),S.label="Soft Body",S},u(i,"softBody","Composites.softBody \u27A4 moved to softBody and cloth examples")})()},function(n,e,t){var i={};n.exports=i;var r=t(9),s=t(0),o=s.deprecated;(function(){i.create=function(a){var l={buckets:{},pairs:{},pairsList:[],bucketWidth:48,bucketHeight:48};return s.extend(l,a)},i.update=function(a,l,u,f){var c,h,d,p=u.world,_=a.buckets,y,m,v=!1;for(c=0;c<l.length;c++){var g=l[c];if(!(g.isSleeping&&!f)&&!(p.bounds&&(g.bounds.max.x<p.bounds.min.x||g.bounds.min.x>p.bounds.max.x||g.bounds.max.y<p.bounds.min.y||g.bounds.min.y>p.bounds.max.y))){var S=i._getRegion(a,g);if(!g.region||S.id!==g.region.id||f){(!g.region||f)&&(g.region=S);var E=i._regionUnion(S,g.region);for(h=E.startCol;h<=E.endCol;h++)for(d=E.startRow;d<=E.endRow;d++){m=i._getBucketId(h,d),y=_[m];var M=h>=S.startCol&&h<=S.endCol&&d>=S.startRow&&d<=S.endRow,T=h>=g.region.startCol&&h<=g.region.endCol&&d>=g.region.startRow&&d<=g.region.endRow;!M&&T&&T&&y&&i._bucketRemoveBody(a,y,g),(g.region===S||M&&!T||f)&&(y||(y=i._createBucket(_,m)),i._bucketAddBody(a,y,g))}g.region=S,v=!0}}}v&&(a.pairsList=i._createActivePairsList(a))},o(i,"update","Grid.update \u27A4 replaced by Matter.Detector"),i.clear=function(a){a.buckets={},a.pairs={},a.pairsList=[]},o(i,"clear","Grid.clear \u27A4 replaced by Matter.Detector"),i._regionUnion=function(a,l){var u=Math.min(a.startCol,l.startCol),f=Math.max(a.endCol,l.endCol),c=Math.min(a.startRow,l.startRow),h=Math.max(a.endRow,l.endRow);return i._createRegion(u,f,c,h)},i._getRegion=function(a,l){var u=l.bounds,f=Math.floor(u.min.x/a.bucketWidth),c=Math.floor(u.max.x/a.bucketWidth),h=Math.floor(u.min.y/a.bucketHeight),d=Math.floor(u.max.y/a.bucketHeight);return i._createRegion(f,c,h,d)},i._createRegion=function(a,l,u,f){return{id:a+","+l+","+u+","+f,startCol:a,endCol:l,startRow:u,endRow:f}},i._getBucketId=function(a,l){return"C"+a+"R"+l},i._createBucket=function(a,l){var u=a[l]=[];return u},i._bucketAddBody=function(a,l,u){var f=a.pairs,c=r.id,h=l.length,d;for(d=0;d<h;d++){var p=l[d];if(!(u.id===p.id||u.isStatic&&p.isStatic)){var _=c(u,p),y=f[_];y?y[2]+=1:f[_]=[u,p,1]}}l.push(u)},i._bucketRemoveBody=function(a,l,u){var f=a.pairs,c=r.id,h;l.splice(s.indexOf(l,u),1);var d=l.length;for(h=0;h<d;h++){var p=f[c(u,l[h])];p&&(p[2]-=1)}},i._createActivePairsList=function(a){var l,u=a.pairs,f=s.keys(u),c=f.length,h=[],d;for(d=0;d<c;d++)l=u[f[d]],l[2]>0?h.push(l):delete u[f[d]];return h}})()},function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(7),o=t(14),a=t(5),l=t(13),u=t(10),f=t(6),c=t(0),h=t(1);(function(){i.create=function(d,p){var _=(d?d.mouse:null)||(p?p.mouse:null);_||(d&&d.render&&d.render.canvas?_=o.create(d.render.canvas):p&&p.element?_=o.create(p.element):(_=o.create(),c.warn("MouseConstraint.create: options.mouse was undefined, options.element was undefined, may not function as expected")));var y=u.create({label:"Mouse Constraint",pointA:_.position,pointB:{x:0,y:0},length:.01,stiffness:.1,angularStiffness:1,render:{strokeStyle:"#90EE90",lineWidth:3}}),m={type:"mouseConstraint",mouse:_,element:null,body:null,constraint:y,collisionFilter:{category:1,mask:4294967295,group:0}},v=c.extend(m,p);return a.on(d,"beforeUpdate",function(){var g=f.allBodies(d.world);i.update(v,g),i._triggerEvents(v)}),v},i.update=function(d,p){var _=d.mouse,y=d.constraint,m=d.body;if(_.button===0){if(y.bodyB)s.set(y.bodyB,!1),y.pointA=_.position;else for(var v=0;v<p.length;v++)if(m=p[v],h.contains(m.bounds,_.position)&&l.canCollide(m.collisionFilter,d.collisionFilter))for(var g=m.parts.length>1?1:0;g<m.parts.length;g++){var S=m.parts[g];if(r.contains(S.vertices,_.position)){y.pointA=_.position,y.bodyB=d.body=m,y.pointB={x:_.position.x-m.position.x,y:_.position.y-m.position.y},y.angleB=m.angle,s.set(m,!1),a.trigger(d,"startdrag",{mouse:_,body:m});break}}}else y.bodyB=d.body=null,y.pointB=null,m&&a.trigger(d,"enddrag",{mouse:_,body:m})},i._triggerEvents=function(d){var p=d.mouse,_=p.sourceEvents;_.mousemove&&a.trigger(d,"mousemove",{mouse:p}),_.mousedown&&a.trigger(d,"mousedown",{mouse:p}),_.mouseup&&a.trigger(d,"mouseup",{mouse:p}),o.clearSourceEvents(p)}})()},function(n,e,t){var i={};n.exports=i;var r=t(2),s=t(8),o=t(1),a=t(12),l=t(3);(function(){i.collides=function(u,f){for(var c=[],h=f.length,d=u.bounds,p=s.collides,_=o.overlaps,y=0;y<h;y++){var m=f[y],v=m.parts.length,g=v===1?0:1;if(_(m.bounds,d))for(var S=g;S<v;S++){var E=m.parts[S];if(_(E.bounds,d)){var M=p(E,u);if(M){c.push(M);break}}}}return c},i.ray=function(u,f,c,h){h=h||1e-100;for(var d=r.angle(f,c),p=r.magnitude(r.sub(f,c)),_=(c.x+f.x)*.5,y=(c.y+f.y)*.5,m=a.rectangle(_,y,p,h,{angle:d}),v=i.collides(m,u),g=0;g<v.length;g+=1){var S=v[g];S.body=S.bodyB=S.bodyA}return v},i.region=function(u,f,c){for(var h=[],d=0;d<u.length;d++){var p=u[d],_=o.overlaps(p.bounds,f);(_&&!c||!_&&c)&&h.push(p)}return h},i.point=function(u,f){for(var c=[],h=0;h<u.length;h++){var d=u[h];if(o.contains(d.bounds,f))for(var p=d.parts.length===1?0:1;p<d.parts.length;p++){var _=d.parts[p];if(o.contains(_.bounds,f)&&l.contains(_.vertices,f)){c.push(d);break}}}return c}})()},function(n,e,t){var i={};n.exports=i;var r=t(4),s=t(0),o=t(6),a=t(1),l=t(5),u=t(2),f=t(14);(function(){var c,h;typeof window<"u"&&(c=window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame||window.msRequestAnimationFrame||function(g){window.setTimeout(function(){g(s.now())},1e3/60)},h=window.cancelAnimationFrame||window.mozCancelAnimationFrame||window.webkitCancelAnimationFrame||window.msCancelAnimationFrame),i._goodFps=30,i._goodDelta=1e3/60,i.create=function(g){var S={engine:null,element:null,canvas:null,mouse:null,frameRequestId:null,timing:{historySize:60,delta:0,deltaHistory:[],lastTime:0,lastTimestamp:0,lastElapsed:0,timestampElapsed:0,timestampElapsedHistory:[],engineDeltaHistory:[],engineElapsedHistory:[],engineUpdatesHistory:[],elapsedHistory:[]},options:{width:800,height:600,pixelRatio:1,background:"#14151f",wireframeBackground:"#14151f",wireframeStrokeStyle:"#bbb",hasBounds:!!g.bounds,enabled:!0,wireframes:!0,showSleeping:!0,showDebug:!1,showStats:!1,showPerformance:!1,showBounds:!1,showVelocity:!1,showCollisions:!1,showSeparations:!1,showAxes:!1,showPositions:!1,showAngleIndicator:!1,showIds:!1,showVertexNumbers:!1,showConvexHulls:!1,showInternalEdges:!1,showMousePosition:!1}},E=s.extend(S,g);return E.canvas&&(E.canvas.width=E.options.width||E.canvas.width,E.canvas.height=E.options.height||E.canvas.height),E.mouse=g.mouse,E.engine=g.engine,E.canvas=E.canvas||_(E.options.width,E.options.height),E.context=E.canvas.getContext("2d"),E.textures={},E.bounds=E.bounds||{min:{x:0,y:0},max:{x:E.canvas.width,y:E.canvas.height}},E.controller=i,E.options.showBroadphase=!1,E.options.pixelRatio!==1&&i.setPixelRatio(E,E.options.pixelRatio),s.isElement(E.element)&&E.element.appendChild(E.canvas),E},i.run=function(g){(function S(E){g.frameRequestId=c(S),d(g,E),i.world(g,E),g.context.setTransform(g.options.pixelRatio,0,0,g.options.pixelRatio,0,0),(g.options.showStats||g.options.showDebug)&&i.stats(g,g.context,E),(g.options.showPerformance||g.options.showDebug)&&i.performance(g,g.context,E),g.context.setTransform(1,0,0,1,0,0)})()},i.stop=function(g){h(g.frameRequestId)},i.setPixelRatio=function(g,S){var E=g.options,M=g.canvas;S==="auto"&&(S=y(M)),E.pixelRatio=S,M.setAttribute("data-pixel-ratio",S),M.width=E.width*S,M.height=E.height*S,M.style.width=E.width+"px",M.style.height=E.height+"px"},i.setSize=function(g,S,E){g.options.width=S,g.options.height=E,g.bounds.max.x=g.bounds.min.x+S,g.bounds.max.y=g.bounds.min.y+E,g.options.pixelRatio!==1?i.setPixelRatio(g,g.options.pixelRatio):(g.canvas.width=S,g.canvas.height=E)},i.lookAt=function(g,S,E,M){M=typeof M<"u"?M:!0,S=s.isArray(S)?S:[S],E=E||{x:0,y:0};for(var T={min:{x:1/0,y:1/0},max:{x:-1/0,y:-1/0}},x=0;x<S.length;x+=1){var w=S[x],C=w.bounds?w.bounds.min:w.min||w.position||w,A=w.bounds?w.bounds.max:w.max||w.position||w;C&&A&&(C.x<T.min.x&&(T.min.x=C.x),A.x>T.max.x&&(T.max.x=A.x),C.y<T.min.y&&(T.min.y=C.y),A.y>T.max.y&&(T.max.y=A.y))}var I=T.max.x-T.min.x+2*E.x,D=T.max.y-T.min.y+2*E.y,F=g.canvas.height,L=g.canvas.width,N=L/F,B=I/D,H=1,Z=1;B>N?Z=B/N:H=N/B,g.options.hasBounds=!0,g.bounds.min.x=T.min.x,g.bounds.max.x=T.min.x+I*H,g.bounds.min.y=T.min.y,g.bounds.max.y=T.min.y+D*Z,M&&(g.bounds.min.x+=I*.5-I*H*.5,g.bounds.max.x+=I*.5-I*H*.5,g.bounds.min.y+=D*.5-D*Z*.5,g.bounds.max.y+=D*.5-D*Z*.5),g.bounds.min.x-=E.x,g.bounds.max.x-=E.x,g.bounds.min.y-=E.y,g.bounds.max.y-=E.y,g.mouse&&(f.setScale(g.mouse,{x:(g.bounds.max.x-g.bounds.min.x)/g.canvas.width,y:(g.bounds.max.y-g.bounds.min.y)/g.canvas.height}),f.setOffset(g.mouse,g.bounds.min))},i.startViewTransform=function(g){var S=g.bounds.max.x-g.bounds.min.x,E=g.bounds.max.y-g.bounds.min.y,M=S/g.options.width,T=E/g.options.height;g.context.setTransform(g.options.pixelRatio/M,0,0,g.options.pixelRatio/T,0,0),g.context.translate(-g.bounds.min.x,-g.bounds.min.y)},i.endViewTransform=function(g){g.context.setTransform(g.options.pixelRatio,0,0,g.options.pixelRatio,0,0)},i.world=function(g,S){var E=s.now(),M=g.engine,T=M.world,x=g.canvas,w=g.context,C=g.options,A=g.timing,I=o.allBodies(T),D=o.allConstraints(T),F=C.wireframes?C.wireframeBackground:C.background,L=[],N=[],B,H={timestamp:M.timing.timestamp};if(l.trigger(g,"beforeRender",H),g.currentBackground!==F&&v(g,F),w.globalCompositeOperation="source-in",w.fillStyle="transparent",w.fillRect(0,0,x.width,x.height),w.globalCompositeOperation="source-over",C.hasBounds){for(B=0;B<I.length;B++){var Z=I[B];a.overlaps(Z.bounds,g.bounds)&&L.push(Z)}for(B=0;B<D.length;B++){var Y=D[B],se=Y.bodyA,ue=Y.bodyB,Be=Y.pointA,Ie=Y.pointB;se&&(Be=u.add(se.position,Y.pointA)),ue&&(Ie=u.add(ue.position,Y.pointB)),!(!Be||!Ie)&&(a.contains(g.bounds,Be)||a.contains(g.bounds,Ie))&&N.push(Y)}i.startViewTransform(g),g.mouse&&(f.setScale(g.mouse,{x:(g.bounds.max.x-g.bounds.min.x)/g.options.width,y:(g.bounds.max.y-g.bounds.min.y)/g.options.height}),f.setOffset(g.mouse,g.bounds.min))}else N=D,L=I,g.options.pixelRatio!==1&&g.context.setTransform(g.options.pixelRatio,0,0,g.options.pixelRatio,0,0);!C.wireframes||M.enableSleeping&&C.showSleeping?i.bodies(g,L,w):(C.showConvexHulls&&i.bodyConvexHulls(g,L,w),i.bodyWireframes(g,L,w)),C.showBounds&&i.bodyBounds(g,L,w),(C.showAxes||C.showAngleIndicator)&&i.bodyAxes(g,L,w),C.showPositions&&i.bodyPositions(g,L,w),C.showVelocity&&i.bodyVelocity(g,L,w),C.showIds&&i.bodyIds(g,L,w),C.showSeparations&&i.separations(g,M.pairs.list,w),C.showCollisions&&i.collisions(g,M.pairs.list,w),C.showVertexNumbers&&i.vertexNumbers(g,L,w),C.showMousePosition&&i.mousePosition(g,g.mouse,w),i.constraints(N,w),C.hasBounds&&i.endViewTransform(g),l.trigger(g,"afterRender",H),A.lastElapsed=s.now()-E},i.stats=function(g,S,E){for(var M=g.engine,T=M.world,x=o.allBodies(T),w=0,C=55,A=44,I=0,D=0,F=0;F<x.length;F+=1)w+=x[F].parts.length;var L={Part:w,Body:x.length,Cons:o.allConstraints(T).length,Comp:o.allComposites(T).length,Pair:M.pairs.list.length};S.fillStyle="#0e0f19",S.fillRect(I,D,C*5.5,A),S.font="12px Arial",S.textBaseline="top",S.textAlign="right";for(var N in L){var B=L[N];S.fillStyle="#aaa",S.fillText(N,I+C,D+8),S.fillStyle="#eee",S.fillText(B,I+C,D+26),I+=C}},i.performance=function(g,S){var E=g.engine,M=g.timing,T=M.deltaHistory,x=M.elapsedHistory,w=M.timestampElapsedHistory,C=M.engineDeltaHistory,A=M.engineUpdatesHistory,I=M.engineElapsedHistory,D=E.timing.lastUpdatesPerFrame,F=E.timing.lastDelta,L=p(T),N=p(x),B=p(C),H=p(A),Z=p(I),Y=p(w),se=Y/L||0,ue=Math.round(L/F),Be=1e3/L||0,Ie=4,Ue=12,J=60,me=34,ae=10,Ae=69;S.fillStyle="#0e0f19",S.fillRect(0,50,Ue*5+J*6+22,me),i.status(S,ae,Ae,J,Ie,T.length,Math.round(Be)+" fps",Be/i._goodFps,function(be){return T[be]/L-1}),i.status(S,ae+Ue+J,Ae,J,Ie,C.length,F.toFixed(2)+" dt",i._goodDelta/F,function(be){return C[be]/B-1}),i.status(S,ae+(Ue+J)*2,Ae,J,Ie,A.length,D+" upf",Math.pow(s.clamp(H/ue||1,0,1),4),function(be){return A[be]/H-1}),i.status(S,ae+(Ue+J)*3,Ae,J,Ie,I.length,Z.toFixed(2)+" ut",1-D*Z/i._goodFps,function(be){return I[be]/Z-1}),i.status(S,ae+(Ue+J)*4,Ae,J,Ie,x.length,N.toFixed(2)+" rt",1-N/i._goodFps,function(be){return x[be]/N-1}),i.status(S,ae+(Ue+J)*5,Ae,J,Ie,w.length,se.toFixed(2)+" x",se*se*se,function(be){return(w[be]/T[be]/se||0)-1})},i.status=function(g,S,E,M,T,x,w,C,A){g.strokeStyle="#888",g.fillStyle="#444",g.lineWidth=1,g.fillRect(S,E+7,M,1),g.beginPath(),g.moveTo(S,E+7-T*s.clamp(.4*A(0),-2,2));for(var I=0;I<M;I+=1)g.lineTo(S+I,E+7-(I<x?T*s.clamp(.4*A(I),-2,2):0));g.stroke(),g.fillStyle="hsl("+s.clamp(25+95*C,0,120)+",100%,60%)",g.fillRect(S,E-7,4,4),g.font="12px Arial",g.textBaseline="middle",g.textAlign="right",g.fillStyle="#eee",g.fillText(w,S+M,E-5)},i.constraints=function(g,S){for(var E=S,M=0;M<g.length;M++){var T=g[M];if(!(!T.render.visible||!T.pointA||!T.pointB)){var x=T.bodyA,w=T.bodyB,C,A;if(x?C=u.add(x.position,T.pointA):C=T.pointA,T.render.type==="pin")E.beginPath(),E.arc(C.x,C.y,3,0,2*Math.PI),E.closePath();else{if(w?A=u.add(w.position,T.pointB):A=T.pointB,E.beginPath(),E.moveTo(C.x,C.y),T.render.type==="spring")for(var I=u.sub(A,C),D=u.perp(u.normalise(I)),F=Math.ceil(s.clamp(T.length/5,12,20)),L,N=1;N<F;N+=1)L=N%2===0?1:-1,E.lineTo(C.x+I.x*(N/F)+D.x*L*4,C.y+I.y*(N/F)+D.y*L*4);E.lineTo(A.x,A.y)}T.render.lineWidth&&(E.lineWidth=T.render.lineWidth,E.strokeStyle=T.render.strokeStyle,E.stroke()),T.render.anchors&&(E.fillStyle=T.render.strokeStyle,E.beginPath(),E.arc(C.x,C.y,3,0,2*Math.PI),E.arc(A.x,A.y,3,0,2*Math.PI),E.closePath(),E.fill())}}},i.bodies=function(g,S,E){var M=E,T=g.engine,x=g.options,w=x.showInternalEdges||!x.wireframes,C,A,I,D;for(I=0;I<S.length;I++)if(C=S[I],!!C.render.visible){for(D=C.parts.length>1?1:0;D<C.parts.length;D++)if(A=C.parts[D],!!A.render.visible){if(x.showSleeping&&C.isSleeping?M.globalAlpha=.5*A.render.opacity:A.render.opacity!==1&&(M.globalAlpha=A.render.opacity),A.render.sprite&&A.render.sprite.texture&&!x.wireframes){var F=A.render.sprite,L=m(g,F.texture);M.translate(A.position.x,A.position.y),M.rotate(A.angle),M.drawImage(L,L.width*-F.xOffset*F.xScale,L.height*-F.yOffset*F.yScale,L.width*F.xScale,L.height*F.yScale),M.rotate(-A.angle),M.translate(-A.position.x,-A.position.y)}else{if(A.circleRadius)M.beginPath(),M.arc(A.position.x,A.position.y,A.circleRadius,0,2*Math.PI);else{M.beginPath(),M.moveTo(A.vertices[0].x,A.vertices[0].y);for(var N=1;N<A.vertices.length;N++)!A.vertices[N-1].isInternal||w?M.lineTo(A.vertices[N].x,A.vertices[N].y):M.moveTo(A.vertices[N].x,A.vertices[N].y),A.vertices[N].isInternal&&!w&&M.moveTo(A.vertices[(N+1)%A.vertices.length].x,A.vertices[(N+1)%A.vertices.length].y);M.lineTo(A.vertices[0].x,A.vertices[0].y),M.closePath()}x.wireframes?(M.lineWidth=1,M.strokeStyle=g.options.wireframeStrokeStyle,M.stroke()):(M.fillStyle=A.render.fillStyle,A.render.lineWidth&&(M.lineWidth=A.render.lineWidth,M.strokeStyle=A.render.strokeStyle,M.stroke()),M.fill())}M.globalAlpha=1}}},i.bodyWireframes=function(g,S,E){var M=E,T=g.options.showInternalEdges,x,w,C,A,I;for(M.beginPath(),C=0;C<S.length;C++)if(x=S[C],!!x.render.visible)for(I=x.parts.length>1?1:0;I<x.parts.length;I++){for(w=x.parts[I],M.moveTo(w.vertices[0].x,w.vertices[0].y),A=1;A<w.vertices.length;A++)!w.vertices[A-1].isInternal||T?M.lineTo(w.vertices[A].x,w.vertices[A].y):M.moveTo(w.vertices[A].x,w.vertices[A].y),w.vertices[A].isInternal&&!T&&M.moveTo(w.vertices[(A+1)%w.vertices.length].x,w.vertices[(A+1)%w.vertices.length].y);M.lineTo(w.vertices[0].x,w.vertices[0].y)}M.lineWidth=1,M.strokeStyle=g.options.wireframeStrokeStyle,M.stroke()},i.bodyConvexHulls=function(g,S,E){var M=E,T,x,w,C,A;for(M.beginPath(),w=0;w<S.length;w++)if(T=S[w],!(!T.render.visible||T.parts.length===1)){for(M.moveTo(T.vertices[0].x,T.vertices[0].y),C=1;C<T.vertices.length;C++)M.lineTo(T.vertices[C].x,T.vertices[C].y);M.lineTo(T.vertices[0].x,T.vertices[0].y)}M.lineWidth=1,M.strokeStyle="rgba(255,255,255,0.2)",M.stroke()},i.vertexNumbers=function(g,S,E){var M=E,T,x,w;for(T=0;T<S.length;T++){var C=S[T].parts;for(w=C.length>1?1:0;w<C.length;w++){var A=C[w];for(x=0;x<A.vertices.length;x++)M.fillStyle="rgba(255,255,255,0.2)",M.fillText(T+"_"+x,A.position.x+(A.vertices[x].x-A.position.x)*.8,A.position.y+(A.vertices[x].y-A.position.y)*.8)}}},i.mousePosition=function(g,S,E){var M=E;M.fillStyle="rgba(255,255,255,0.8)",M.fillText(S.position.x+"  "+S.position.y,S.position.x+5,S.position.y-5)},i.bodyBounds=function(g,S,E){var M=E,T=g.engine,x=g.options;M.beginPath();for(var w=0;w<S.length;w++){var C=S[w];if(C.render.visible)for(var A=S[w].parts,I=A.length>1?1:0;I<A.length;I++){var D=A[I];M.rect(D.bounds.min.x,D.bounds.min.y,D.bounds.max.x-D.bounds.min.x,D.bounds.max.y-D.bounds.min.y)}}x.wireframes?M.strokeStyle="rgba(255,255,255,0.08)":M.strokeStyle="rgba(0,0,0,0.1)",M.lineWidth=1,M.stroke()},i.bodyAxes=function(g,S,E){var M=E,T=g.engine,x=g.options,w,C,A,I;for(M.beginPath(),C=0;C<S.length;C++){var D=S[C],F=D.parts;if(D.render.visible)if(x.showAxes)for(A=F.length>1?1:0;A<F.length;A++)for(w=F[A],I=0;I<w.axes.length;I++){var L=w.axes[I];M.moveTo(w.position.x,w.position.y),M.lineTo(w.position.x+L.x*20,w.position.y+L.y*20)}else for(A=F.length>1?1:0;A<F.length;A++)for(w=F[A],I=0;I<w.axes.length;I++)M.moveTo(w.position.x,w.position.y),M.lineTo((w.vertices[0].x+w.vertices[w.vertices.length-1].x)/2,(w.vertices[0].y+w.vertices[w.vertices.length-1].y)/2)}x.wireframes?(M.strokeStyle="indianred",M.lineWidth=1):(M.strokeStyle="rgba(255, 255, 255, 0.4)",M.globalCompositeOperation="overlay",M.lineWidth=2),M.stroke(),M.globalCompositeOperation="source-over"},i.bodyPositions=function(g,S,E){var M=E,T=g.engine,x=g.options,w,C,A,I;for(M.beginPath(),A=0;A<S.length;A++)if(w=S[A],!!w.render.visible)for(I=0;I<w.parts.length;I++)C=w.parts[I],M.arc(C.position.x,C.position.y,3,0,2*Math.PI,!1),M.closePath();for(x.wireframes?M.fillStyle="indianred":M.fillStyle="rgba(0,0,0,0.5)",M.fill(),M.beginPath(),A=0;A<S.length;A++)w=S[A],w.render.visible&&(M.arc(w.positionPrev.x,w.positionPrev.y,2,0,2*Math.PI,!1),M.closePath());M.fillStyle="rgba(255,165,0,0.8)",M.fill()},i.bodyVelocity=function(g,S,E){var M=E;M.beginPath();for(var T=0;T<S.length;T++){var x=S[T];if(x.render.visible){var w=r.getVelocity(x);M.moveTo(x.position.x,x.position.y),M.lineTo(x.position.x+w.x,x.position.y+w.y)}}M.lineWidth=3,M.strokeStyle="cornflowerblue",M.stroke()},i.bodyIds=function(g,S,E){var M=E,T,x;for(T=0;T<S.length;T++)if(S[T].render.visible){var w=S[T].parts;for(x=w.length>1?1:0;x<w.length;x++){var C=w[x];M.font="12px Arial",M.fillStyle="rgba(255,255,255,0.5)",M.fillText(C.id,C.position.x+10,C.position.y-10)}}},i.collisions=function(g,S,E){var M=E,T=g.options,x,w,C,A,I,D,F;for(M.beginPath(),D=0;D<S.length;D++)if(x=S[D],!!x.isActive)for(w=x.collision,F=0;F<x.contactCount;F++){var L=x.contacts[F],N=L.vertex;M.rect(N.x-1.5,N.y-1.5,3.5,3.5)}for(T.wireframes?M.fillStyle="rgba(255,255,255,0.7)":M.fillStyle="orange",M.fill(),M.beginPath(),D=0;D<S.length;D++)if(x=S[D],!!x.isActive&&(w=x.collision,x.contactCount>0)){var B=x.contacts[0].vertex.x,H=x.contacts[0].vertex.y;x.contactCount===2&&(B=(x.contacts[0].vertex.x+x.contacts[1].vertex.x)/2,H=(x.contacts[0].vertex.y+x.contacts[1].vertex.y)/2),w.bodyB===w.supports[0].body||w.bodyA.isStatic===!0?M.moveTo(B-w.normal.x*8,H-w.normal.y*8):M.moveTo(B+w.normal.x*8,H+w.normal.y*8),M.lineTo(B,H)}T.wireframes?M.strokeStyle="rgba(255,165,0,0.7)":M.strokeStyle="orange",M.lineWidth=1,M.stroke()},i.separations=function(g,S,E){var M=E,T=g.options,x,w,C,A,I,D,F;for(M.beginPath(),D=0;D<S.length;D++)if(x=S[D],!!x.isActive){w=x.collision,A=w.bodyA,I=w.bodyB;var L=1;!I.isStatic&&!A.isStatic&&(L=.5),I.isStatic&&(L=0),M.moveTo(I.position.x,I.position.y),M.lineTo(I.position.x-w.penetration.x*L,I.position.y-w.penetration.y*L),L=1,!I.isStatic&&!A.isStatic&&(L=.5),A.isStatic&&(L=0),M.moveTo(A.position.x,A.position.y),M.lineTo(A.position.x+w.penetration.x*L,A.position.y+w.penetration.y*L)}T.wireframes?M.strokeStyle="rgba(255,165,0,0.5)":M.strokeStyle="orange",M.stroke()},i.inspector=function(g,S){var E=g.engine,M=g.selected,T=g.render,x=T.options,w;if(x.hasBounds){var C=T.bounds.max.x-T.bounds.min.x,A=T.bounds.max.y-T.bounds.min.y,I=C/T.options.width,D=A/T.options.height;S.scale(1/I,1/D),S.translate(-T.bounds.min.x,-T.bounds.min.y)}for(var F=0;F<M.length;F++){var L=M[F].data;switch(S.translate(.5,.5),S.lineWidth=1,S.strokeStyle="rgba(255,165,0,0.9)",S.setLineDash([1,2]),L.type){case"body":w=L.bounds,S.beginPath(),S.rect(Math.floor(w.min.x-3),Math.floor(w.min.y-3),Math.floor(w.max.x-w.min.x+6),Math.floor(w.max.y-w.min.y+6)),S.closePath(),S.stroke();break;case"constraint":var N=L.pointA;L.bodyA&&(N=L.pointB),S.beginPath(),S.arc(N.x,N.y,10,0,2*Math.PI),S.closePath(),S.stroke();break}S.setLineDash([]),S.translate(-.5,-.5)}g.selectStart!==null&&(S.translate(.5,.5),S.lineWidth=1,S.strokeStyle="rgba(255,165,0,0.6)",S.fillStyle="rgba(255,165,0,0.1)",w=g.selectBounds,S.beginPath(),S.rect(Math.floor(w.min.x),Math.floor(w.min.y),Math.floor(w.max.x-w.min.x),Math.floor(w.max.y-w.min.y)),S.closePath(),S.stroke(),S.fill(),S.translate(-.5,-.5)),x.hasBounds&&S.setTransform(1,0,0,1,0,0)};var d=function(g,S){var E=g.engine,M=g.timing,T=M.historySize,x=E.timing.timestamp;M.delta=S-M.lastTime||i._goodDelta,M.lastTime=S,M.timestampElapsed=x-M.lastTimestamp||0,M.lastTimestamp=x,M.deltaHistory.unshift(M.delta),M.deltaHistory.length=Math.min(M.deltaHistory.length,T),M.engineDeltaHistory.unshift(E.timing.lastDelta),M.engineDeltaHistory.length=Math.min(M.engineDeltaHistory.length,T),M.timestampElapsedHistory.unshift(M.timestampElapsed),M.timestampElapsedHistory.length=Math.min(M.timestampElapsedHistory.length,T),M.engineUpdatesHistory.unshift(E.timing.lastUpdatesPerFrame),M.engineUpdatesHistory.length=Math.min(M.engineUpdatesHistory.length,T),M.engineElapsedHistory.unshift(E.timing.lastElapsed),M.engineElapsedHistory.length=Math.min(M.engineElapsedHistory.length,T),M.elapsedHistory.unshift(M.lastElapsed),M.elapsedHistory.length=Math.min(M.elapsedHistory.length,T)},p=function(g){for(var S=0,E=0;E<g.length;E+=1)S+=g[E];return S/g.length||0},_=function(g,S){var E=document.createElement("canvas");return E.width=g,E.height=S,E.oncontextmenu=function(){return!1},E.onselectstart=function(){return!1},E},y=function(g){var S=g.getContext("2d"),E=window.devicePixelRatio||1,M=S.webkitBackingStorePixelRatio||S.mozBackingStorePixelRatio||S.msBackingStorePixelRatio||S.oBackingStorePixelRatio||S.backingStorePixelRatio||1;return E/M},m=function(g,S){var E=g.textures[S];return E||(E=g.textures[S]=new Image,E.src=S,E)},v=function(g,S){var E=S;/(jpg|gif|png)$/.test(S)&&(E="url("+S+")"),g.canvas.style.background=E,g.canvas.style.backgroundSize="contain",g.currentBackground=S}})()},function(n,e,t){var i={};n.exports=i;var r=t(5),s=t(17),o=t(0);(function(){i._maxFrameDelta=1e3/15,i._frameDeltaFallback=1e3/60,i._timeBufferMargin=1.5,i._elapsedNextEstimate=1,i._smoothingLowerBound=.1,i._smoothingUpperBound=.9,i.create=function(l){var u={delta:16.666666666666668,frameDelta:null,frameDeltaSmoothing:!0,frameDeltaSnapping:!0,frameDeltaHistory:[],frameDeltaHistorySize:100,frameRequestId:null,timeBuffer:0,timeLastTick:null,maxUpdates:null,maxFrameTime:33.333333333333336,lastUpdatesDeferred:0,enabled:!0},f=o.extend(u,l);return f.fps=0,f},i.run=function(l,u){return l.timeBuffer=i._frameDeltaFallback,function f(c){l.frameRequestId=i._onNextFrame(l,f),c&&l.enabled&&i.tick(l,u,c)}(),l},i.tick=function(l,u,f){var c=o.now(),h=l.delta,d=0,p=f-l.timeLastTick;if((!p||!l.timeLastTick||p>Math.max(i._maxFrameDelta,l.maxFrameTime))&&(p=l.frameDelta||i._frameDeltaFallback),l.frameDeltaSmoothing){l.frameDeltaHistory.push(p),l.frameDeltaHistory=l.frameDeltaHistory.slice(-l.frameDeltaHistorySize);var _=l.frameDeltaHistory.slice(0).sort(),y=l.frameDeltaHistory.slice(_.length*i._smoothingLowerBound,_.length*i._smoothingUpperBound),m=a(y);p=m||p}l.frameDeltaSnapping&&(p=1e3/Math.round(1e3/p)),l.frameDelta=p,l.timeLastTick=f,l.timeBuffer+=l.frameDelta,l.timeBuffer=o.clamp(l.timeBuffer,0,l.frameDelta+h*i._timeBufferMargin),l.lastUpdatesDeferred=0;var v=l.maxUpdates||Math.ceil(l.maxFrameTime/h),g={timestamp:u.timing.timestamp};r.trigger(l,"beforeTick",g),r.trigger(l,"tick",g);for(var S=o.now();h>0&&l.timeBuffer>=h*i._timeBufferMargin;){r.trigger(l,"beforeUpdate",g),s.update(u,h),r.trigger(l,"afterUpdate",g),l.timeBuffer-=h,d+=1;var E=o.now()-c,M=o.now()-S,T=E+i._elapsedNextEstimate*M/d;if(d>=v||T>l.maxFrameTime){l.lastUpdatesDeferred=Math.round(Math.max(0,l.timeBuffer/h-i._timeBufferMargin));break}}u.timing.lastUpdatesPerFrame=d,r.trigger(l,"afterTick",g),l.frameDeltaHistory.length>=100&&(l.lastUpdatesDeferred&&Math.round(l.frameDelta/h)>v?o.warnOnce("Matter.Runner: runner reached runner.maxUpdates, see docs."):l.lastUpdatesDeferred&&o.warnOnce("Matter.Runner: runner reached runner.maxFrameTime, see docs."),typeof l.isFixed<"u"&&o.warnOnce("Matter.Runner: runner.isFixed is now redundant, see docs."),(l.deltaMin||l.deltaMax)&&o.warnOnce("Matter.Runner: runner.deltaMin and runner.deltaMax were removed, see docs."),l.fps!==0&&o.warnOnce("Matter.Runner: runner.fps was replaced by runner.delta, see docs."))},i.stop=function(l){i._cancelNextFrame(l)},i._onNextFrame=function(l,u){if(typeof window<"u"&&window.requestAnimationFrame)l.frameRequestId=window.requestAnimationFrame(u);else throw new Error("Matter.Runner: missing required global window.requestAnimationFrame.");return l.frameRequestId},i._cancelNextFrame=function(l){if(typeof window<"u"&&window.cancelAnimationFrame)window.cancelAnimationFrame(l.frameRequestId);else throw new Error("Matter.Runner: missing required global window.cancelAnimationFrame.")};var a=function(l){for(var u=0,f=l.length,c=0;c<f;c+=1)u+=l[c];return u/f||0}})()},function(n,e,t){var i={};n.exports=i;var r=t(8),s=t(0),o=s.deprecated;(function(){i.collides=function(a,l){return r.collides(a,l)},o(i,"collides","SAT.collides \u27A4 replaced by Collision.collides")})()},function(n,e,t){var i={};n.exports=i;var r=t(1),s=t(0);(function(){i.pathToVertices=function(o,a){typeof window<"u"&&!("SVGPathSeg"in window)&&s.warn("Svg.pathToVertices: SVGPathSeg not defined, a polyfill is required.");var l,u,f,c,h,d,p,_,y,m,v=[],g,S,E=0,M=0,T=0;a=a||15;var x=function(C,A,I){var D=I%2===1&&I>1;if(!y||C!=y.x||A!=y.y){y&&D?(g=y.x,S=y.y):(g=0,S=0);var F={x:g+C,y:S+A};(D||!y)&&(y=F),v.push(F),M=g+C,T=S+A}},w=function(C){var A=C.pathSegTypeAsLetter.toUpperCase();if(A!=="Z"){switch(A){case"M":case"L":case"T":case"C":case"S":case"Q":M=C.x,T=C.y;break;case"H":M=C.x;break;case"V":T=C.y;break}x(M,T,C.pathSegType)}};for(i._svgPathToAbsolute(o),f=o.getTotalLength(),d=[],l=0;l<o.pathSegList.numberOfItems;l+=1)d.push(o.pathSegList.getItem(l));for(p=d.concat();E<f;){if(m=o.getPathSegAtLength(E),h=d[m],h!=_){for(;p.length&&p[0]!=h;)w(p.shift());_=h}switch(h.pathSegTypeAsLetter.toUpperCase()){case"C":case"T":case"S":case"Q":case"A":c=o.getPointAtLength(E),x(c.x,c.y,0);break}E+=a}for(l=0,u=p.length;l<u;++l)w(p[l]);return v},i._svgPathToAbsolute=function(o){for(var a,l,u,f,c,h,d=o.pathSegList,p=0,_=0,y=d.numberOfItems,m=0;m<y;++m){var v=d.getItem(m),g=v.pathSegTypeAsLetter;if(/[MLHVCSQTA]/.test(g))"x"in v&&(p=v.x),"y"in v&&(_=v.y);else switch("x1"in v&&(u=p+v.x1),"x2"in v&&(c=p+v.x2),"y1"in v&&(f=_+v.y1),"y2"in v&&(h=_+v.y2),"x"in v&&(p+=v.x),"y"in v&&(_+=v.y),g){case"m":d.replaceItem(o.createSVGPathSegMovetoAbs(p,_),m);break;case"l":d.replaceItem(o.createSVGPathSegLinetoAbs(p,_),m);break;case"h":d.replaceItem(o.createSVGPathSegLinetoHorizontalAbs(p),m);break;case"v":d.replaceItem(o.createSVGPathSegLinetoVerticalAbs(_),m);break;case"c":d.replaceItem(o.createSVGPathSegCurvetoCubicAbs(p,_,u,f,c,h),m);break;case"s":d.replaceItem(o.createSVGPathSegCurvetoCubicSmoothAbs(p,_,c,h),m);break;case"q":d.replaceItem(o.createSVGPathSegCurvetoQuadraticAbs(p,_,u,f),m);break;case"t":d.replaceItem(o.createSVGPathSegCurvetoQuadraticSmoothAbs(p,_),m);break;case"a":d.replaceItem(o.createSVGPathSegArcAbs(p,_,v.r1,v.r2,v.angle,v.largeArcFlag,v.sweepFlag),m);break;case"z":case"Z":p=a,_=l;break}(g=="M"||g=="m")&&(a=p,l=_)}}})()},function(n,e,t){var i={};n.exports=i;var r=t(6),s=t(0);(function(){i.create=r.create,i.add=r.add,i.remove=r.remove,i.clear=r.clear,i.addComposite=r.addComposite,i.addBody=r.addBody,i.addConstraint=r.addConstraint})()}])})});var V_=di($h=>{"use strict";var xC=Ml(),yC=Symbol.for("react.element"),_C=Symbol.for("react.fragment"),SC=Object.prototype.hasOwnProperty,MC=xC.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,wC={key:!0,ref:!0,__self:!0,__source:!0};function z_(n,e,t){var i,r={},s=null,o=null;t!==void 0&&(s=""+t),e.key!==void 0&&(s=""+e.key),e.ref!==void 0&&(o=e.ref);for(i in e)SC.call(e,i)&&!wC.hasOwnProperty(i)&&(r[i]=e[i]);if(n&&n.defaultProps)for(i in e=n.defaultProps,e)r[i]===void 0&&(r[i]=e[i]);return{$$typeof:yC,type:n,key:s,ref:o,props:r,_owner:MC.current}}$h.Fragment=_C;$h.jsx=z_;$h.jsxs=z_});var tg=di((_3,G_)=>{"use strict";G_.exports=V_()});var it=Co(Ml()),Y_=Co(Xx()),Jt=Co(Yx());var ju="184";var My=0,lm=1,wy=2;var rl=1,Qu=2,So=3,Zi=0,mn=1,Ti=2,Ai=0,ls=1,cm=2,um=3,hm=4,Ey=5;var Pr=100,Ty=101,Ay=102,by=103,Cy=104,Ry=200,Py=201,Iy=202,Ly=203,hu=204,fu=205,Dy=206,Ny=207,Uy=208,Fy=209,Oy=210,By=211,ky=212,zy=213,Vy=214,du=0,pu=1,mu=2,cs=3,gu=4,vu=5,xu=6,yu=7,fm=0,Gy=1,Hy=2,li=0,dm=1,pm=2,mm=3,gm=4,vm=5,xm=6,ym=7;var _m=300,Fr=301,ps=302,eh=303,th=304,sl=306,_u=1e3,Si=1001,Su=1002,Xt=1003,Wy=1004;var ol=1005;var $t=1006,nh=1007;var Or=1008;var wn=1009,Sm=1010,Mm=1011,Mo=1012,ih=1013,ci=1014,ui=1015,bi=1016,rh=1017,sh=1018,wo=1020,wm=35902,Em=35899,Tm=1021,Am=1022,$n=1023,Mi=1026,Br=1027,bm=1028,oh=1029,kr=1030,ah=1031;var lh=1033,al=33776,ll=33777,cl=33778,ul=33779,ch=35840,uh=35841,hh=35842,fh=35843,dh=36196,ph=37492,mh=37496,gh=37488,vh=37489,hl=37490,xh=37491,yh=37808,_h=37809,Sh=37810,Mh=37811,wh=37812,Eh=37813,Th=37814,Ah=37815,bh=37816,Ch=37817,Rh=37818,Ph=37819,Ih=37820,Lh=37821,Dh=36492,Nh=36494,Uh=36495,Fh=36283,Oh=36284,fl=36285,Bh=36286;var Pa=2300,Mu=2301,uu=2302,Zp=2303,$p=2400,Jp=2401,Kp=2402;var Xy=3200;var kh=0,Yy=1,ji="",on="srgb",Ia="srgb-linear",La="linear",lt="srgb";var as=7680;var jp=519,qy=512,Zy=513,$y=514,zh=515,Jy=516,Ky=517,Vh=518,jy=519,Qp=35044;var Cm="300 es",ai=2e3,co=2001;function AM(n){for(let e=n.length-1;e>=0;--e)if(n[e]>=65535)return!0;return!1}function bM(n){return ArrayBuffer.isView(n)&&!(n instanceof DataView)}function Da(n){return document.createElementNS("http://www.w3.org/1999/xhtml",n)}function Qy(){let n=Da("canvas");return n.style.display="block",n}var qx={},uo=null;function Rm(...n){let e="THREE."+n.shift();uo?uo("log",e,...n):console.log(e,...n)}function e_(n){let e=n[0];if(typeof e=="string"&&e.startsWith("TSL:")){let t=n[1];t&&t.isStackTrace?n[0]+=" "+t.getLocation():n[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return n}function Ge(...n){n=e_(n);let e="THREE."+n.shift();if(uo)uo("warn",e,...n);else{let t=n[0];t&&t.isStackTrace?console.warn(t.getError(e)):console.warn(e,...n)}}function We(...n){n=e_(n);let e="THREE."+n.shift();if(uo)uo("error",e,...n);else{let t=n[0];t&&t.isStackTrace?console.error(t.getError(e)):console.error(e,...n)}}function wu(...n){let e=n.join(" ");e in qx||(qx[e]=!0,Ge(...n))}function t_(n,e,t){return new Promise(function(i,r){function s(){switch(n.clientWaitSync(e,n.SYNC_FLUSH_COMMANDS_BIT,0)){case n.WAIT_FAILED:r();break;case n.TIMEOUT_EXPIRED:setTimeout(s,t);break;default:i()}}setTimeout(s,t)})}var n_={[du]:pu,[mu]:xu,[gu]:yu,[cs]:vu,[pu]:du,[xu]:mu,[yu]:gu,[vu]:cs},wi=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(t)===-1&&i[e].push(t)}hasEventListener(e,t){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(t)!==-1}removeEventListener(e,t){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(t);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let i=t[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},rn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var Sp=Math.PI/180,Eu=180/Math.PI;function Eo(){let n=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(rn[n&255]+rn[n>>8&255]+rn[n>>16&255]+rn[n>>24&255]+"-"+rn[e&255]+rn[e>>8&255]+"-"+rn[e>>16&15|64]+rn[e>>24&255]+"-"+rn[t&63|128]+rn[t>>8&255]+"-"+rn[t>>16&255]+rn[t>>24&255]+rn[i&255]+rn[i>>8&255]+rn[i>>16&255]+rn[i>>24&255]).toLowerCase()}function Qe(n,e,t){return Math.max(e,Math.min(t,n))}function CM(n,e){return(n%e+e)%e}function Mp(n,e,t){return(1-t)*n+t*e}function Ma(n,e){switch(e.constructor){case Float32Array:return n;case Uint32Array:return n/4294967295;case Uint16Array:return n/65535;case Uint8Array:return n/255;case Int32Array:return Math.max(n/2147483647,-1);case Int16Array:return Math.max(n/32767,-1);case Int8Array:return Math.max(n/127,-1);default:throw new Error("Invalid component type.")}}function Sn(n,e){switch(e.constructor){case Float32Array:return n;case Uint32Array:return Math.round(n*4294967295);case Uint16Array:return Math.round(n*65535);case Uint8Array:return Math.round(n*255);case Int32Array:return Math.round(n*2147483647);case Int16Array:return Math.round(n*32767);case Int8Array:return Math.round(n*127);default:throw new Error("Invalid component type.")}}var Um=class Um{constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,i=this.y,r=e.elements;return this.x=r[0]*t+r[3]*i+r[6],this.y=r[1]*t+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Qe(this.x,e.x,t.x),this.y=Qe(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=Qe(this.x,e,t),this.y=Qe(this.y,e,t),this}clampLength(e,t){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Qe(i,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let i=this.dot(e)/t;return Math.acos(Qe(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,i=this.y-e.y;return t*t+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,i){return this.x=e.x+(t.x-e.x)*i,this.y=e.y+(t.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let i=Math.cos(t),r=Math.sin(t),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};Um.prototype.isVector2=!0;var Ee=Um,Ei=class{constructor(e=0,t=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=i,this._w=r}static slerpFlat(e,t,i,r,s,o,a){let l=i[r+0],u=i[r+1],f=i[r+2],c=i[r+3],h=s[o+0],d=s[o+1],p=s[o+2],_=s[o+3];if(c!==_||l!==h||u!==d||f!==p){let y=l*h+u*d+f*p+c*_;y<0&&(h=-h,d=-d,p=-p,_=-_,y=-y);let m=1-a;if(y<.9995){let v=Math.acos(y),g=Math.sin(v);m=Math.sin(m*v)/g,a=Math.sin(a*v)/g,l=l*m+h*a,u=u*m+d*a,f=f*m+p*a,c=c*m+_*a}else{l=l*m+h*a,u=u*m+d*a,f=f*m+p*a,c=c*m+_*a;let v=1/Math.sqrt(l*l+u*u+f*f+c*c);l*=v,u*=v,f*=v,c*=v}}e[t]=l,e[t+1]=u,e[t+2]=f,e[t+3]=c}static multiplyQuaternionsFlat(e,t,i,r,s,o){let a=i[r],l=i[r+1],u=i[r+2],f=i[r+3],c=s[o],h=s[o+1],d=s[o+2],p=s[o+3];return e[t]=a*p+f*c+l*d-u*h,e[t+1]=l*p+f*h+u*c-a*d,e[t+2]=u*p+f*d+a*h-l*c,e[t+3]=f*p-a*c-l*h-u*d,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,i,r){return this._x=e,this._y=t,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,u=a(i/2),f=a(r/2),c=a(s/2),h=l(i/2),d=l(r/2),p=l(s/2);switch(o){case"XYZ":this._x=h*f*c+u*d*p,this._y=u*d*c-h*f*p,this._z=u*f*p+h*d*c,this._w=u*f*c-h*d*p;break;case"YXZ":this._x=h*f*c+u*d*p,this._y=u*d*c-h*f*p,this._z=u*f*p-h*d*c,this._w=u*f*c+h*d*p;break;case"ZXY":this._x=h*f*c-u*d*p,this._y=u*d*c+h*f*p,this._z=u*f*p+h*d*c,this._w=u*f*c-h*d*p;break;case"ZYX":this._x=h*f*c-u*d*p,this._y=u*d*c+h*f*p,this._z=u*f*p-h*d*c,this._w=u*f*c+h*d*p;break;case"YZX":this._x=h*f*c+u*d*p,this._y=u*d*c+h*f*p,this._z=u*f*p-h*d*c,this._w=u*f*c-h*d*p;break;case"XZY":this._x=h*f*c-u*d*p,this._y=u*d*c-h*f*p,this._z=u*f*p+h*d*c,this._w=u*f*c+h*d*p;break;default:Ge("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let i=t/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,i=t[0],r=t[4],s=t[8],o=t[1],a=t[5],l=t[9],u=t[2],f=t[6],c=t[10],h=i+a+c;if(h>0){let d=.5/Math.sqrt(h+1);this._w=.25/d,this._x=(f-l)*d,this._y=(s-u)*d,this._z=(o-r)*d}else if(i>a&&i>c){let d=2*Math.sqrt(1+i-a-c);this._w=(f-l)/d,this._x=.25*d,this._y=(r+o)/d,this._z=(s+u)/d}else if(a>c){let d=2*Math.sqrt(1+a-i-c);this._w=(s-u)/d,this._x=(r+o)/d,this._y=.25*d,this._z=(l+f)/d}else{let d=2*Math.sqrt(1+c-i-a);this._w=(o-r)/d,this._x=(s+u)/d,this._y=(l+f)/d,this._z=.25*d}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let i=e.dot(t)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Qe(this.dot(e),-1,1)))}rotateTowards(e,t){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,t/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let i=e._x,r=e._y,s=e._z,o=e._w,a=t._x,l=t._y,u=t._z,f=t._w;return this._x=i*f+o*a+r*u-s*l,this._y=r*f+o*l+s*a-i*u,this._z=s*f+o*u+i*l-r*a,this._w=o*f-i*a-r*l-s*u,this._onChangeCallback(),this}slerp(e,t){let i=e._x,r=e._y,s=e._z,o=e._w,a=this.dot(e);a<0&&(i=-i,r=-r,s=-s,o=-o,a=-a);let l=1-t;if(a<.9995){let u=Math.acos(a),f=Math.sin(u);l=Math.sin(l*u)/f,t=Math.sin(t*u)/f,this._x=this._x*l+i*t,this._y=this._y*l+r*t,this._z=this._z*l+s*t,this._w=this._w*l+o*t,this._onChangeCallback()}else this._x=this._x*l+i*t,this._y=this._y*l+r*t,this._z=this._z*l+s*t,this._w=this._w*l+o*t,this.normalize();return this}slerpQuaternions(e,t,i){return this.copy(e).slerp(t,i)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(t),s*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},Fm=class Fm{constructor(e=0,t=0,i=0){this.x=e,this.y=t,this.z=i}set(e,t,i){return i===void 0&&(i=this.z),this.x=e,this.y=t,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Zx.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Zx.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*t+s[3]*i+s[6]*r,this.y=s[1]*t+s[4]*i+s[7]*r,this.z=s[2]*t+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*t+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*t+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*t+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*t+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let t=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,u=2*(o*r-a*i),f=2*(a*t-s*r),c=2*(s*i-o*t);return this.x=t+l*u+o*c-a*f,this.y=i+l*f+a*u-s*c,this.z=r+l*c+s*f-o*u,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*t+s[4]*i+s[8]*r,this.y=s[1]*t+s[5]*i+s[9]*r,this.z=s[2]*t+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Qe(this.x,e.x,t.x),this.y=Qe(this.y,e.y,t.y),this.z=Qe(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=Qe(this.x,e,t),this.y=Qe(this.y,e,t),this.z=Qe(this.z,e,t),this}clampLength(e,t){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Qe(i,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,i){return this.x=e.x+(t.x-e.x)*i,this.y=e.y+(t.y-e.y)*i,this.z=e.z+(t.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let i=e.x,r=e.y,s=e.z,o=t.x,a=t.y,l=t.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let i=e.dot(this)/t;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return wp.copy(this).projectOnVector(e),this.sub(wp)}reflect(e){return this.sub(wp.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let i=this.dot(e)/t;return Math.acos(Qe(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return t*t+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,i){let r=Math.sin(t)*e;return this.x=r*Math.sin(i),this.y=Math.cos(t)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,i){return this.x=e*Math.sin(t),this.y=i,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=i,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,i=Math.sqrt(1-t*t);return this.x=i*Math.cos(e),this.y=t,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};Fm.prototype.isVector3=!0;var V=Fm,wp=new V,Zx=new Ei,Om=class Om{constructor(e,t,i,r,s,o,a,l,u){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,i,r,s,o,a,l,u)}set(e,t,i,r,s,o,a,l,u){let f=this.elements;return f[0]=e,f[1]=r,f[2]=a,f[3]=t,f[4]=s,f[5]=l,f[6]=i,f[7]=o,f[8]=u,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,i=e.elements;return t[0]=i[0],t[1]=i[1],t[2]=i[2],t[3]=i[3],t[4]=i[4],t[5]=i[5],t[6]=i[6],t[7]=i[7],t[8]=i[8],this}extractBasis(e,t,i){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let i=e.elements,r=t.elements,s=this.elements,o=i[0],a=i[3],l=i[6],u=i[1],f=i[4],c=i[7],h=i[2],d=i[5],p=i[8],_=r[0],y=r[3],m=r[6],v=r[1],g=r[4],S=r[7],E=r[2],M=r[5],T=r[8];return s[0]=o*_+a*v+l*E,s[3]=o*y+a*g+l*M,s[6]=o*m+a*S+l*T,s[1]=u*_+f*v+c*E,s[4]=u*y+f*g+c*M,s[7]=u*m+f*S+c*T,s[2]=h*_+d*v+p*E,s[5]=h*y+d*g+p*M,s[8]=h*m+d*S+p*T,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],u=e[7],f=e[8];return t*o*f-t*a*u-i*s*f+i*a*l+r*s*u-r*o*l}invert(){let e=this.elements,t=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],u=e[7],f=e[8],c=f*o-a*u,h=a*l-f*s,d=u*s-o*l,p=t*c+i*h+r*d;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let _=1/p;return e[0]=c*_,e[1]=(r*u-f*i)*_,e[2]=(a*i-r*o)*_,e[3]=h*_,e[4]=(f*t-r*l)*_,e[5]=(r*s-a*t)*_,e[6]=d*_,e[7]=(i*l-u*t)*_,e[8]=(o*t-i*s)*_,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,i,r,s,o,a){let l=Math.cos(s),u=Math.sin(s);return this.set(i*l,i*u,-i*(l*o+u*a)+o+e,-r*u,r*l,-r*(-u*o+l*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(Ep.makeScale(e,t)),this}rotate(e){return this.premultiply(Ep.makeRotation(-e)),this}translate(e,t){return this.premultiply(Ep.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),i=Math.sin(e);return this.set(t,-i,0,i,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,i=e.elements;for(let r=0;r<9;r++)if(t[r]!==i[r])return!1;return!0}fromArray(e,t=0){for(let i=0;i<9;i++)this.elements[i]=e[i+t];return this}toArray(e=[],t=0){let i=this.elements;return e[t]=i[0],e[t+1]=i[1],e[t+2]=i[2],e[t+3]=i[3],e[t+4]=i[4],e[t+5]=i[5],e[t+6]=i[6],e[t+7]=i[7],e[t+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}};Om.prototype.isMatrix3=!0;var Ye=Om,Ep=new Ye,$x=new Ye().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Jx=new Ye().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function RM(){let n={enabled:!0,workingColorSpace:Ia,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===lt&&(r.r=qi(r.r),r.g=qi(r.g),r.b=qi(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===lt&&(r.r=ao(r.r),r.g=ao(r.g),r.b=ao(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===ji?La:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return wu("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),n.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return wu("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),n.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],i=[.3127,.329];return n.define({[Ia]:{primaries:e,whitePoint:i,transfer:La,toXYZ:$x,fromXYZ:Jx,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:on},outputColorSpaceConfig:{drawingBufferColorSpace:on}},[on]:{primaries:e,whitePoint:i,transfer:lt,toXYZ:$x,fromXYZ:Jx,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:on}}}),n}var tt=RM();function qi(n){return n<.04045?n*.0773993808:Math.pow(n*.9478672986+.0521327014,2.4)}function ao(n){return n<.0031308?n*12.92:1.055*Math.pow(n,.41666)-.055}var $s,Tu=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{$s===void 0&&($s=Da("canvas")),$s.width=e.width,$s.height=e.height;let r=$s.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=$s}return i.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=Da("canvas");t.width=e.width,t.height=e.height;let i=t.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=qi(s[o]/255)*255;return i.putImageData(r,0,0),t}else if(e.data){let t=e.data.slice(0);for(let i=0;i<t.length;i++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[i]=Math.floor(qi(t[i]/255)*255):t[i]=qi(t[i]);return{data:t,width:e.width,height:e.height}}else return Ge("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},PM=0,ho=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:PM++}),this.uuid=Eo(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<"u"&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(Tp(r[o].image)):s.push(Tp(r[o]))}else s=Tp(r);i.url=s}return t||(e.images[this.uuid]=i),i}};function Tp(n){return typeof HTMLImageElement<"u"&&n instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&n instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&n instanceof ImageBitmap?Tu.getDataURL(n):n.data?{data:Array.from(n.data),width:n.width,height:n.height,type:n.data.constructor.name}:(Ge("Texture: Unable to serialize Texture."),{})}var IM=0,Ap=new V,dn=class n extends wi{constructor(e=n.DEFAULT_IMAGE,t=n.DEFAULT_MAPPING,i=Si,r=Si,s=$t,o=Or,a=$n,l=wn,u=n.DEFAULT_ANISOTROPY,f=ji){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:IM++}),this.uuid=Eo(),this.name="",this.source=new ho(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=u,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Ee(0,0),this.repeat=new Ee(1,1),this.center=new Ee(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ye,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=f,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Ap).x}get height(){return this.source.getSize(Ap).y}get depth(){return this.source.getSize(Ap).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let i=e[t];if(i===void 0){Ge(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){Ge(`Texture.setValues(): property '${t}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[t]=i}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),t||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==_m)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case _u:e.x=e.x-Math.floor(e.x);break;case Si:e.x=e.x<0?0:1;break;case Su:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case _u:e.y=e.y-Math.floor(e.y);break;case Si:e.y=e.y<0?0:1;break;case Su:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};dn.DEFAULT_IMAGE=null;dn.DEFAULT_MAPPING=_m;dn.DEFAULT_ANISOTROPY=1;var Bm=class Bm{constructor(e=0,t=0,i=0,r=1){this.x=e,this.y=t,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,i,r){return this.x=e,this.y=t,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*t+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*t+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*t+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*t+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,i,r,s,l=e.elements,u=l[0],f=l[4],c=l[8],h=l[1],d=l[5],p=l[9],_=l[2],y=l[6],m=l[10];if(Math.abs(f-h)<.01&&Math.abs(c-_)<.01&&Math.abs(p-y)<.01){if(Math.abs(f+h)<.1&&Math.abs(c+_)<.1&&Math.abs(p+y)<.1&&Math.abs(u+d+m-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let g=(u+1)/2,S=(d+1)/2,E=(m+1)/2,M=(f+h)/4,T=(c+_)/4,x=(p+y)/4;return g>S&&g>E?g<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(g),r=M/i,s=T/i):S>E?S<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(S),i=M/r,s=x/r):E<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(E),i=T/s,r=x/s),this.set(i,r,s,t),this}let v=Math.sqrt((y-p)*(y-p)+(c-_)*(c-_)+(h-f)*(h-f));return Math.abs(v)<.001&&(v=1),this.x=(y-p)/v,this.y=(c-_)/v,this.z=(h-f)/v,this.w=Math.acos((u+d+m-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Qe(this.x,e.x,t.x),this.y=Qe(this.y,e.y,t.y),this.z=Qe(this.z,e.z,t.z),this.w=Qe(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=Qe(this.x,e,t),this.y=Qe(this.y,e,t),this.z=Qe(this.z,e,t),this.w=Qe(this.w,e,t),this}clampLength(e,t){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Qe(i,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,i){return this.x=e.x+(t.x-e.x)*i,this.y=e.y+(t.y-e.y)*i,this.z=e.z+(t.z-e.z)*i,this.w=e.w+(t.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};Bm.prototype.isVector4=!0;var bt=Bm,Au=class extends wi{constructor(e=1,t=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:$t,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=i.depth,this.scissor=new bt(0,0,e,t),this.scissorTest=!1,this.viewport=new bt(0,0,e,t),this.textures=[];let r={width:e,height:t,depth:i.depth},s=new dn(r),o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let t={minFilter:$t,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,i=1){if(this.width!==e||this.height!==t||this.depth!==i){this.width=e,this.height=t,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=t,this.textures[r].image.depth=i,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,i=e.textures.length;t<i;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let r=Object.assign({},e.textures[t].image);this.textures[t].source=new ho(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this}dispose(){this.dispatchEvent({type:"dispose"})}},Nn=class extends Au{constructor(e=1,t=1,i={}){super(e,t,i),this.isWebGLRenderTarget=!0}},Na=class extends dn{constructor(e=null,t=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:i,depth:r},this.magFilter=Xt,this.minFilter=Xt,this.wrapR=Si,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var bu=class extends dn{constructor(e=null,t=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:i,depth:r},this.magFilter=Xt,this.minFilter=Xt,this.wrapR=Si,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Ku=class Ku{constructor(e,t,i,r,s,o,a,l,u,f,c,h,d,p,_,y){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,i,r,s,o,a,l,u,f,c,h,d,p,_,y)}set(e,t,i,r,s,o,a,l,u,f,c,h,d,p,_,y){let m=this.elements;return m[0]=e,m[4]=t,m[8]=i,m[12]=r,m[1]=s,m[5]=o,m[9]=a,m[13]=l,m[2]=u,m[6]=f,m[10]=c,m[14]=h,m[3]=d,m[7]=p,m[11]=_,m[15]=y,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Ku().fromArray(this.elements)}copy(e){let t=this.elements,i=e.elements;return t[0]=i[0],t[1]=i[1],t[2]=i[2],t[3]=i[3],t[4]=i[4],t[5]=i[5],t[6]=i[6],t[7]=i[7],t[8]=i[8],t[9]=i[9],t[10]=i[10],t[11]=i[11],t[12]=i[12],t[13]=i[13],t[14]=i[14],t[15]=i[15],this}copyPosition(e){let t=this.elements,i=e.elements;return t[12]=i[12],t[13]=i[13],t[14]=i[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,i){return this.determinant()===0?(e.set(1,0,0),t.set(0,1,0),i.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(e,t,i){return this.set(e.x,t.x,i.x,0,e.y,t.y,i.y,0,e.z,t.z,i.z,0,0,0,0,1),this}extractRotation(e){if(e.determinant()===0)return this.identity();let t=this.elements,i=e.elements,r=1/Js.setFromMatrixColumn(e,0).length(),s=1/Js.setFromMatrixColumn(e,1).length(),o=1/Js.setFromMatrixColumn(e,2).length();return t[0]=i[0]*r,t[1]=i[1]*r,t[2]=i[2]*r,t[3]=0,t[4]=i[4]*s,t[5]=i[5]*s,t[6]=i[6]*s,t[7]=0,t[8]=i[8]*o,t[9]=i[9]*o,t[10]=i[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),u=Math.sin(r),f=Math.cos(s),c=Math.sin(s);if(e.order==="XYZ"){let h=o*f,d=o*c,p=a*f,_=a*c;t[0]=l*f,t[4]=-l*c,t[8]=u,t[1]=d+p*u,t[5]=h-_*u,t[9]=-a*l,t[2]=_-h*u,t[6]=p+d*u,t[10]=o*l}else if(e.order==="YXZ"){let h=l*f,d=l*c,p=u*f,_=u*c;t[0]=h+_*a,t[4]=p*a-d,t[8]=o*u,t[1]=o*c,t[5]=o*f,t[9]=-a,t[2]=d*a-p,t[6]=_+h*a,t[10]=o*l}else if(e.order==="ZXY"){let h=l*f,d=l*c,p=u*f,_=u*c;t[0]=h-_*a,t[4]=-o*c,t[8]=p+d*a,t[1]=d+p*a,t[5]=o*f,t[9]=_-h*a,t[2]=-o*u,t[6]=a,t[10]=o*l}else if(e.order==="ZYX"){let h=o*f,d=o*c,p=a*f,_=a*c;t[0]=l*f,t[4]=p*u-d,t[8]=h*u+_,t[1]=l*c,t[5]=_*u+h,t[9]=d*u-p,t[2]=-u,t[6]=a*l,t[10]=o*l}else if(e.order==="YZX"){let h=o*l,d=o*u,p=a*l,_=a*u;t[0]=l*f,t[4]=_-h*c,t[8]=p*c+d,t[1]=c,t[5]=o*f,t[9]=-a*f,t[2]=-u*f,t[6]=d*c+p,t[10]=h-_*c}else if(e.order==="XZY"){let h=o*l,d=o*u,p=a*l,_=a*u;t[0]=l*f,t[4]=-c,t[8]=u*f,t[1]=h*c+_,t[5]=o*f,t[9]=d*c-p,t[2]=p*c-d,t[6]=a*f,t[10]=_*c+h}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(LM,e,DM)}lookAt(e,t,i){let r=this.elements;return In.subVectors(e,t),In.lengthSq()===0&&(In.z=1),In.normalize(),wr.crossVectors(i,In),wr.lengthSq()===0&&(Math.abs(i.z)===1?In.x+=1e-4:In.z+=1e-4,In.normalize(),wr.crossVectors(i,In)),wr.normalize(),Gc.crossVectors(In,wr),r[0]=wr.x,r[4]=Gc.x,r[8]=In.x,r[1]=wr.y,r[5]=Gc.y,r[9]=In.y,r[2]=wr.z,r[6]=Gc.z,r[10]=In.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let i=e.elements,r=t.elements,s=this.elements,o=i[0],a=i[4],l=i[8],u=i[12],f=i[1],c=i[5],h=i[9],d=i[13],p=i[2],_=i[6],y=i[10],m=i[14],v=i[3],g=i[7],S=i[11],E=i[15],M=r[0],T=r[4],x=r[8],w=r[12],C=r[1],A=r[5],I=r[9],D=r[13],F=r[2],L=r[6],N=r[10],B=r[14],H=r[3],Z=r[7],Y=r[11],se=r[15];return s[0]=o*M+a*C+l*F+u*H,s[4]=o*T+a*A+l*L+u*Z,s[8]=o*x+a*I+l*N+u*Y,s[12]=o*w+a*D+l*B+u*se,s[1]=f*M+c*C+h*F+d*H,s[5]=f*T+c*A+h*L+d*Z,s[9]=f*x+c*I+h*N+d*Y,s[13]=f*w+c*D+h*B+d*se,s[2]=p*M+_*C+y*F+m*H,s[6]=p*T+_*A+y*L+m*Z,s[10]=p*x+_*I+y*N+m*Y,s[14]=p*w+_*D+y*B+m*se,s[3]=v*M+g*C+S*F+E*H,s[7]=v*T+g*A+S*L+E*Z,s[11]=v*x+g*I+S*N+E*Y,s[15]=v*w+g*D+S*B+E*se,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],u=e[13],f=e[2],c=e[6],h=e[10],d=e[14],p=e[3],_=e[7],y=e[11],m=e[15],v=l*d-u*h,g=a*d-u*c,S=a*h-l*c,E=o*d-u*f,M=o*h-l*f,T=o*c-a*f;return t*(_*v-y*g+m*S)-i*(p*v-y*E+m*M)+r*(p*g-_*E+m*T)-s*(p*S-_*M+y*T)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=i),this}invert(){let e=this.elements,t=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],u=e[7],f=e[8],c=e[9],h=e[10],d=e[11],p=e[12],_=e[13],y=e[14],m=e[15],v=t*a-i*o,g=t*l-r*o,S=t*u-s*o,E=i*l-r*a,M=i*u-s*a,T=r*u-s*l,x=f*_-c*p,w=f*y-h*p,C=f*m-d*p,A=c*y-h*_,I=c*m-d*_,D=h*m-d*y,F=v*D-g*I+S*A+E*C-M*w+T*x;if(F===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let L=1/F;return e[0]=(a*D-l*I+u*A)*L,e[1]=(r*I-i*D-s*A)*L,e[2]=(_*T-y*M+m*E)*L,e[3]=(h*M-c*T-d*E)*L,e[4]=(l*C-o*D-u*w)*L,e[5]=(t*D-r*C+s*w)*L,e[6]=(y*S-p*T-m*g)*L,e[7]=(f*T-h*S+d*g)*L,e[8]=(o*I-a*C+u*x)*L,e[9]=(i*C-t*I-s*x)*L,e[10]=(p*M-_*S+m*v)*L,e[11]=(c*S-f*M-d*v)*L,e[12]=(a*w-o*A-l*x)*L,e[13]=(t*A-i*w+r*x)*L,e[14]=(_*g-p*E-y*v)*L,e[15]=(f*E-c*g+h*v)*L,this}scale(e){let t=this.elements,i=e.x,r=e.y,s=e.z;return t[0]*=i,t[4]*=r,t[8]*=s,t[1]*=i,t[5]*=r,t[9]*=s,t[2]*=i,t[6]*=r,t[10]*=s,t[3]*=i,t[7]*=r,t[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,i,r))}makeTranslation(e,t,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,i,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,t,-i,0,0,i,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),i=Math.sin(e);return this.set(t,0,i,0,0,1,0,0,-i,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),i=Math.sin(e);return this.set(t,-i,0,0,i,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let i=Math.cos(t),r=Math.sin(t),s=1-i,o=e.x,a=e.y,l=e.z,u=s*o,f=s*a;return this.set(u*o+i,u*a-r*l,u*l+r*a,0,u*a+r*l,f*a+i,f*l-r*o,0,u*l-r*a,f*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,t,i){return this.set(e,0,0,0,0,t,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,t,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,t,r,1,0,0,0,0,1),this}compose(e,t,i){let r=this.elements,s=t._x,o=t._y,a=t._z,l=t._w,u=s+s,f=o+o,c=a+a,h=s*u,d=s*f,p=s*c,_=o*f,y=o*c,m=a*c,v=l*u,g=l*f,S=l*c,E=i.x,M=i.y,T=i.z;return r[0]=(1-(_+m))*E,r[1]=(d+S)*E,r[2]=(p-g)*E,r[3]=0,r[4]=(d-S)*M,r[5]=(1-(h+m))*M,r[6]=(y+v)*M,r[7]=0,r[8]=(p+g)*T,r[9]=(y-v)*T,r[10]=(1-(h+_))*T,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,i){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinant();if(s===0)return i.set(1,1,1),t.identity(),this;let o=Js.set(r[0],r[1],r[2]).length(),a=Js.set(r[4],r[5],r[6]).length(),l=Js.set(r[8],r[9],r[10]).length();s<0&&(o=-o),ri.copy(this);let u=1/o,f=1/a,c=1/l;return ri.elements[0]*=u,ri.elements[1]*=u,ri.elements[2]*=u,ri.elements[4]*=f,ri.elements[5]*=f,ri.elements[6]*=f,ri.elements[8]*=c,ri.elements[9]*=c,ri.elements[10]*=c,t.setFromRotationMatrix(ri),i.x=o,i.y=a,i.z=l,this}makePerspective(e,t,i,r,s,o,a=ai,l=!1){let u=this.elements,f=2*s/(t-e),c=2*s/(i-r),h=(t+e)/(t-e),d=(i+r)/(i-r),p,_;if(l)p=s/(o-s),_=o*s/(o-s);else if(a===ai)p=-(o+s)/(o-s),_=-2*o*s/(o-s);else if(a===co)p=-o/(o-s),_=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return u[0]=f,u[4]=0,u[8]=h,u[12]=0,u[1]=0,u[5]=c,u[9]=d,u[13]=0,u[2]=0,u[6]=0,u[10]=p,u[14]=_,u[3]=0,u[7]=0,u[11]=-1,u[15]=0,this}makeOrthographic(e,t,i,r,s,o,a=ai,l=!1){let u=this.elements,f=2/(t-e),c=2/(i-r),h=-(t+e)/(t-e),d=-(i+r)/(i-r),p,_;if(l)p=1/(o-s),_=o/(o-s);else if(a===ai)p=-2/(o-s),_=-(o+s)/(o-s);else if(a===co)p=-1/(o-s),_=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return u[0]=f,u[4]=0,u[8]=0,u[12]=h,u[1]=0,u[5]=c,u[9]=0,u[13]=d,u[2]=0,u[6]=0,u[10]=p,u[14]=_,u[3]=0,u[7]=0,u[11]=0,u[15]=1,this}equals(e){let t=this.elements,i=e.elements;for(let r=0;r<16;r++)if(t[r]!==i[r])return!1;return!0}fromArray(e,t=0){for(let i=0;i<16;i++)this.elements[i]=e[i+t];return this}toArray(e=[],t=0){let i=this.elements;return e[t]=i[0],e[t+1]=i[1],e[t+2]=i[2],e[t+3]=i[3],e[t+4]=i[4],e[t+5]=i[5],e[t+6]=i[6],e[t+7]=i[7],e[t+8]=i[8],e[t+9]=i[9],e[t+10]=i[10],e[t+11]=i[11],e[t+12]=i[12],e[t+13]=i[13],e[t+14]=i[14],e[t+15]=i[15],e}};Ku.prototype.isMatrix4=!0;var Mt=Ku,Js=new V,ri=new Mt,LM=new V(0,0,0),DM=new V(1,1,1),wr=new V,Gc=new V,In=new V,Kx=new Mt,jx=new Ei,$i=class n{constructor(e=0,t=0,i=0,r=n.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,i,r=this._order){return this._x=e,this._y=t,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],u=r[5],f=r[9],c=r[2],h=r[6],d=r[10];switch(t){case"XYZ":this._y=Math.asin(Qe(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-f,d),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(h,u),this._z=0);break;case"YXZ":this._x=Math.asin(-Qe(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(a,d),this._z=Math.atan2(l,u)):(this._y=Math.atan2(-c,s),this._z=0);break;case"ZXY":this._x=Math.asin(Qe(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-c,d),this._z=Math.atan2(-o,u)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Qe(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(h,d),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,u));break;case"YZX":this._z=Math.asin(Qe(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-f,u),this._y=Math.atan2(-c,s)):(this._x=0,this._y=Math.atan2(a,d));break;case"XZY":this._z=Math.asin(-Qe(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(h,u),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-f,d),this._y=0);break;default:Ge("Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,i){return Kx.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Kx,t,i)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return jx.setFromEuler(this),this.setFromQuaternion(jx,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};$i.DEFAULT_ORDER="XYZ";var fo=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},NM=0,Qx=new V,Ks=new Ei,Vi=new Mt,Hc=new V,wa=new V,UM=new V,FM=new Ei,ey=new V(1,0,0),ty=new V(0,1,0),ny=new V(0,0,1),iy={type:"added"},OM={type:"removed"},js={type:"childadded",child:null},bp={type:"childremoved",child:null},an=class n extends wi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:NM++}),this.uuid=Eo(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=n.DEFAULT_UP.clone();let e=new V,t=new $i,i=new Ei,r=new V(1,1,1);function s(){i.setFromEuler(t,!1)}function o(){t.setFromQuaternion(i,void 0,!1)}t._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new Mt},normalMatrix:{value:new Ye}}),this.matrix=new Mt,this.matrixWorld=new Mt,this.matrixAutoUpdate=n.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=n.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new fo,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Ks.setFromAxisAngle(e,t),this.quaternion.multiply(Ks),this}rotateOnWorldAxis(e,t){return Ks.setFromAxisAngle(e,t),this.quaternion.premultiply(Ks),this}rotateX(e){return this.rotateOnAxis(ey,e)}rotateY(e){return this.rotateOnAxis(ty,e)}rotateZ(e){return this.rotateOnAxis(ny,e)}translateOnAxis(e,t){return Qx.copy(e).applyQuaternion(this.quaternion),this.position.add(Qx.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(ey,e)}translateY(e){return this.translateOnAxis(ty,e)}translateZ(e){return this.translateOnAxis(ny,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Vi.copy(this.matrixWorld).invert())}lookAt(e,t,i){e.isVector3?Hc.copy(e):Hc.set(e,t,i);let r=this.parent;this.updateWorldMatrix(!0,!1),wa.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Vi.lookAt(wa,Hc,this.up):Vi.lookAt(Hc,wa,this.up),this.quaternion.setFromRotationMatrix(Vi),r&&(Vi.extractRotation(r.matrixWorld),Ks.setFromRotationMatrix(Vi),this.quaternion.premultiply(Ks.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(We("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(iy),js.child=e,this.dispatchEvent(js),js.child=null):We("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(OM),bp.child=e,this.dispatchEvent(bp),bp.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Vi.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Vi.multiply(e.parent.matrixWorld)),e.applyMatrix4(Vi),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(iy),js.child=e,this.dispatchEvent(js),js.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,i=[]){this[e]===t&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,t,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(wa,e,UM),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(wa,FM,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let i=0,r=t.length;i<r;i++)t[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let i=0,r=t.length;i<r;i++)t[i].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,i=e.y,r=e.z,s=this.matrix.elements;s[12]+=t-s[0]*t-s[4]*i-s[8]*r,s[13]+=i-s[1]*t-s[5]*i-s[9]*r,s[14]+=r-s[2]*t-s[6]*i-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let i=0,r=t.length;i<r;i++)t[i].updateMatrixWorld(e)}updateWorldMatrix(e,t){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let t=e===void 0||typeof e=="string",i={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let u=0,f=l.length;u<f;u++){let c=l[u];s(e.shapes,c)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,u=this.material.length;l<u;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(t){let a=o(e.geometries),l=o(e.materials),u=o(e.textures),f=o(e.images),c=o(e.shapes),h=o(e.skeletons),d=o(e.animations),p=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),u.length>0&&(i.textures=u),f.length>0&&(i.images=f),c.length>0&&(i.shapes=c),h.length>0&&(i.skeletons=h),d.length>0&&(i.animations=d),p.length>0&&(i.nodes=p)}return i.object=r,i;function o(a){let l=[];for(let u in a){let f=a[u];delete f.metadata,l.push(f)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};an.DEFAULT_UP=new V(0,1,0);an.DEFAULT_MATRIX_AUTO_UPDATE=!0;an.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Yi=class extends an{constructor(){super(),this.isGroup=!0,this.type="Group"}},BM={type:"move"},po=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Yi,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Yi,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new V,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new V),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Yi,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new V,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new V,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let i of e.hand.values())this._getHandJoint(t,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,u=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(u&&e.hand){o=!0;for(let _ of e.hand.values()){let y=t.getJointPose(_,i),m=this._getHandJoint(u,_);y!==null&&(m.matrix.fromArray(y.transform.matrix),m.matrix.decompose(m.position,m.rotation,m.scale),m.matrixWorldNeedsUpdate=!0,m.jointRadius=y.radius),m.visible=y!==null}let f=u.joints["index-finger-tip"],c=u.joints["thumb-tip"],h=f.position.distanceTo(c.position),d=.02,p=.005;u.inputState.pinching&&h>d+p?(u.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!u.inputState.pinching&&h<=d-p&&(u.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=t.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));a!==null&&(r=t.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(BM)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),u!==null&&(u.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let i=new Yi;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[t.jointName]=i,e.add(i)}return e.joints[t.jointName]}},i_={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Er={h:0,s:0,l:0},Wc={h:0,s:0,l:0};function Cp(n,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?n+(e-n)*6*t:t<1/2?e:t<2/3?n+(e-n)*6*(2/3-t):n}var nt=class{constructor(e,t,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,i)}set(e,t,i){if(t===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,t,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=on){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,tt.colorSpaceToWorking(this,t),this}setRGB(e,t,i,r=tt.workingColorSpace){return this.r=e,this.g=t,this.b=i,tt.colorSpaceToWorking(this,r),this}setHSL(e,t,i,r=tt.workingColorSpace){if(e=CM(e,1),t=Qe(t,0,1),i=Qe(i,0,1),t===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+t):i+t-i*t,o=2*i-s;this.r=Cp(o,s,e+1/3),this.g=Cp(o,s,e),this.b=Cp(o,s,e-1/3)}return tt.colorSpaceToWorking(this,r),this}setStyle(e,t=on){function i(s){s!==void 0&&parseFloat(s)<1&&Ge("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,t);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,t);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,t);break;default:Ge("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(s,16),t);Ge("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=on){let i=i_[e.toLowerCase()];return i!==void 0?this.setHex(i,t):Ge("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=qi(e.r),this.g=qi(e.g),this.b=qi(e.b),this}copyLinearToSRGB(e){return this.r=ao(e.r),this.g=ao(e.g),this.b=ao(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=on){return tt.workingToColorSpace(sn.copy(this),e),Math.round(Qe(sn.r*255,0,255))*65536+Math.round(Qe(sn.g*255,0,255))*256+Math.round(Qe(sn.b*255,0,255))}getHexString(e=on){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=tt.workingColorSpace){tt.workingToColorSpace(sn.copy(this),t);let i=sn.r,r=sn.g,s=sn.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,u,f=(a+o)/2;if(a===o)l=0,u=0;else{let c=o-a;switch(u=f<=.5?c/(o+a):c/(2-o-a),o){case i:l=(r-s)/c+(r<s?6:0);break;case r:l=(s-i)/c+2;break;case s:l=(i-r)/c+4;break}l/=6}return e.h=l,e.s=u,e.l=f,e}getRGB(e,t=tt.workingColorSpace){return tt.workingToColorSpace(sn.copy(this),t),e.r=sn.r,e.g=sn.g,e.b=sn.b,e}getStyle(e=on){tt.workingToColorSpace(sn.copy(this),e);let t=sn.r,i=sn.g,r=sn.b;return e!==on?`color(${e} ${t.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,t,i){return this.getHSL(Er),this.setHSL(Er.h+e,Er.s+t,Er.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,i){return this.r=e.r+(t.r-e.r)*i,this.g=e.g+(t.g-e.g)*i,this.b=e.b+(t.b-e.b)*i,this}lerpHSL(e,t){this.getHSL(Er),e.getHSL(Wc);let i=Mp(Er.h,Wc.h,t),r=Mp(Er.s,Wc.s,t),s=Mp(Er.l,Wc.l,t);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*t+s[3]*i+s[6]*r,this.g=s[1]*t+s[4]*i+s[7]*r,this.b=s[2]*t+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},sn=new nt;nt.NAMES=i_;var Ua=class extends an{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new $i,this.environmentIntensity=1,this.environmentRotation=new $i,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}},si=new V,Gi=new V,Rp=new V,Hi=new V,Qs=new V,eo=new V,ry=new V,Pp=new V,Ip=new V,Lp=new V,Dp=new bt,Np=new bt,Up=new bt,Rr=class n{constructor(e=new V,t=new V,i=new V){this.a=e,this.b=t,this.c=i}static getNormal(e,t,i,r){r.subVectors(i,t),si.subVectors(e,t),r.cross(si);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,t,i,r,s){si.subVectors(r,t),Gi.subVectors(i,t),Rp.subVectors(e,t);let o=si.dot(si),a=si.dot(Gi),l=si.dot(Rp),u=Gi.dot(Gi),f=Gi.dot(Rp),c=o*u-a*a;if(c===0)return s.set(0,0,0),null;let h=1/c,d=(u*l-a*f)*h,p=(o*f-a*l)*h;return s.set(1-d-p,p,d)}static containsPoint(e,t,i,r){return this.getBarycoord(e,t,i,r,Hi)===null?!1:Hi.x>=0&&Hi.y>=0&&Hi.x+Hi.y<=1}static getInterpolation(e,t,i,r,s,o,a,l){return this.getBarycoord(e,t,i,r,Hi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Hi.x),l.addScaledVector(o,Hi.y),l.addScaledVector(a,Hi.z),l)}static getInterpolatedAttribute(e,t,i,r,s,o){return Dp.setScalar(0),Np.setScalar(0),Up.setScalar(0),Dp.fromBufferAttribute(e,t),Np.fromBufferAttribute(e,i),Up.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(Dp,s.x),o.addScaledVector(Np,s.y),o.addScaledVector(Up,s.z),o}static isFrontFacing(e,t,i,r){return si.subVectors(i,t),Gi.subVectors(e,t),si.cross(Gi).dot(r)<0}set(e,t,i){return this.a.copy(e),this.b.copy(t),this.c.copy(i),this}setFromPointsAndIndices(e,t,i,r){return this.a.copy(e[t]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,t,i,r){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return si.subVectors(this.c,this.b),Gi.subVectors(this.a,this.b),si.cross(Gi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return n.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return n.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,i,r,s){return n.getInterpolation(e,this.a,this.b,this.c,t,i,r,s)}containsPoint(e){return n.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return n.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let i=this.a,r=this.b,s=this.c,o,a;Qs.subVectors(r,i),eo.subVectors(s,i),Pp.subVectors(e,i);let l=Qs.dot(Pp),u=eo.dot(Pp);if(l<=0&&u<=0)return t.copy(i);Ip.subVectors(e,r);let f=Qs.dot(Ip),c=eo.dot(Ip);if(f>=0&&c<=f)return t.copy(r);let h=l*c-f*u;if(h<=0&&l>=0&&f<=0)return o=l/(l-f),t.copy(i).addScaledVector(Qs,o);Lp.subVectors(e,s);let d=Qs.dot(Lp),p=eo.dot(Lp);if(p>=0&&d<=p)return t.copy(s);let _=d*u-l*p;if(_<=0&&u>=0&&p<=0)return a=u/(u-p),t.copy(i).addScaledVector(eo,a);let y=f*p-d*c;if(y<=0&&c-f>=0&&d-p>=0)return ry.subVectors(s,r),a=(c-f)/(c-f+(d-p)),t.copy(r).addScaledVector(ry,a);let m=1/(y+_+h);return o=_*m,a=h*m,t.copy(i).addScaledVector(Qs,o).addScaledVector(eo,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Ir=class{constructor(e=new V(1/0,1/0,1/0),t=new V(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,i=e.length;t<i;t+=3)this.expandByPoint(oi.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,i=e.count;t<i;t++)this.expandByPoint(oi.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,i=e.length;t<i;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let i=oi.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(t===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,oi):oi.fromBufferAttribute(s,o),oi.applyMatrix4(e.matrixWorld),this.expandByPoint(oi);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Xc.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Xc.copy(i.boundingBox)),Xc.applyMatrix4(e.matrixWorld),this.union(Xc)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,oi),oi.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,i;return e.normal.x>0?(t=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),t<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Ea),Yc.subVectors(this.max,Ea),to.subVectors(e.a,Ea),no.subVectors(e.b,Ea),io.subVectors(e.c,Ea),Tr.subVectors(no,to),Ar.subVectors(io,no),is.subVectors(to,io);let t=[0,-Tr.z,Tr.y,0,-Ar.z,Ar.y,0,-is.z,is.y,Tr.z,0,-Tr.x,Ar.z,0,-Ar.x,is.z,0,-is.x,-Tr.y,Tr.x,0,-Ar.y,Ar.x,0,-is.y,is.x,0];return!Fp(t,to,no,io,Yc)||(t=[1,0,0,0,1,0,0,0,1],!Fp(t,to,no,io,Yc))?!1:(qc.crossVectors(Tr,Ar),t=[qc.x,qc.y,qc.z],Fp(t,to,no,io,Yc))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,oi).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(oi).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Wi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Wi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Wi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Wi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Wi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Wi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Wi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Wi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Wi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Wi=[new V,new V,new V,new V,new V,new V,new V,new V],oi=new V,Xc=new Ir,to=new V,no=new V,io=new V,Tr=new V,Ar=new V,is=new V,Ea=new V,Yc=new V,qc=new V,rs=new V;function Fp(n,e,t,i,r){for(let s=0,o=n.length-3;s<=o;s+=3){rs.fromArray(n,s);let a=r.x*Math.abs(rs.x)+r.y*Math.abs(rs.y)+r.z*Math.abs(rs.z),l=e.dot(rs),u=t.dot(rs),f=i.dot(rs);if(Math.max(-Math.max(l,u,f),Math.min(l,u,f))>a)return!1}return!0}var Ft=new V,Zc=new Ee,kM=0,Dn=class extends wi{constructor(e,t,i=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:kM++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=i,this.usage=Qp,this.updateRanges=[],this.gpuType=ui,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,i){e*=this.itemSize,i*=t.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=t.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,i=this.count;t<i;t++)Zc.fromBufferAttribute(this,t),Zc.applyMatrix3(e),this.setXY(t,Zc.x,Zc.y);else if(this.itemSize===3)for(let t=0,i=this.count;t<i;t++)Ft.fromBufferAttribute(this,t),Ft.applyMatrix3(e),this.setXYZ(t,Ft.x,Ft.y,Ft.z);return this}applyMatrix4(e){for(let t=0,i=this.count;t<i;t++)Ft.fromBufferAttribute(this,t),Ft.applyMatrix4(e),this.setXYZ(t,Ft.x,Ft.y,Ft.z);return this}applyNormalMatrix(e){for(let t=0,i=this.count;t<i;t++)Ft.fromBufferAttribute(this,t),Ft.applyNormalMatrix(e),this.setXYZ(t,Ft.x,Ft.y,Ft.z);return this}transformDirection(e){for(let t=0,i=this.count;t<i;t++)Ft.fromBufferAttribute(this,t),Ft.transformDirection(e),this.setXYZ(t,Ft.x,Ft.y,Ft.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let i=this.array[e*this.itemSize+t];return this.normalized&&(i=Ma(i,this.array)),i}setComponent(e,t,i){return this.normalized&&(i=Sn(i,this.array)),this.array[e*this.itemSize+t]=i,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Ma(t,this.array)),t}setX(e,t){return this.normalized&&(t=Sn(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Ma(t,this.array)),t}setY(e,t){return this.normalized&&(t=Sn(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Ma(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Sn(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Ma(t,this.array)),t}setW(e,t){return this.normalized&&(t=Sn(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,i){return e*=this.itemSize,this.normalized&&(t=Sn(t,this.array),i=Sn(i,this.array)),this.array[e+0]=t,this.array[e+1]=i,this}setXYZ(e,t,i,r){return e*=this.itemSize,this.normalized&&(t=Sn(t,this.array),i=Sn(i,this.array),r=Sn(r,this.array)),this.array[e+0]=t,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,t,i,r,s){return e*=this.itemSize,this.normalized&&(t=Sn(t,this.array),i=Sn(i,this.array),r=Sn(r,this.array),s=Sn(s,this.array)),this.array[e+0]=t,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Qp&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:"dispose"})}};var Fa=class extends Dn{constructor(e,t,i){super(new Uint16Array(e),t,i)}};var Oa=class extends Dn{constructor(e,t,i){super(new Uint32Array(e),t,i)}};var Wt=class extends Dn{constructor(e,t,i){super(new Float32Array(e),t,i)}},zM=new Ir,Ta=new V,Op=new V,mo=class{constructor(e=new V,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let i=this.center;t!==void 0?i.copy(t):zM.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let i=this.center.distanceToSquared(e);return t.copy(e),i>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Ta.subVectors(e,this.center);let t=Ta.lengthSq();if(t>this.radius*this.radius){let i=Math.sqrt(t),r=(i-this.radius)*.5;this.center.addScaledVector(Ta,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Op.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Ta.copy(e.center).add(Op)),this.expandByPoint(Ta.copy(e.center).sub(Op))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},VM=0,qn=new Mt,Bp=new an,ro=new V,Ln=new Ir,Aa=new Ir,Ht=new V,Un=class n extends wi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:VM++}),this.uuid=Eo(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(AM(e)?Oa:Fa)(e,1):this.index=e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,i=0){this.groups.push({start:e,count:t,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new Ye().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return qn.makeRotationFromQuaternion(e),this.applyMatrix4(qn),this}rotateX(e){return qn.makeRotationX(e),this.applyMatrix4(qn),this}rotateY(e){return qn.makeRotationY(e),this.applyMatrix4(qn),this}rotateZ(e){return qn.makeRotationZ(e),this.applyMatrix4(qn),this}translate(e,t,i){return qn.makeTranslation(e,t,i),this.applyMatrix4(qn),this}scale(e,t,i){return qn.makeScale(e,t,i),this.applyMatrix4(qn),this}lookAt(e){return Bp.lookAt(e),Bp.updateMatrix(),this.applyMatrix4(Bp.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(ro).negate(),this.translate(ro.x,ro.y,ro.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new Wt(i,3))}else{let i=Math.min(e.length,t.count);for(let r=0;r<i;r++){let s=e[r];t.setXYZ(r,s.x,s.y,s.z||0)}e.length>t.count&&Ge("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ir);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){We("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new V(-1/0,-1/0,-1/0),new V(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let i=0,r=t.length;i<r;i++){let s=t[i];Ln.setFromBufferAttribute(s),this.morphTargetsRelative?(Ht.addVectors(this.boundingBox.min,Ln.min),this.boundingBox.expandByPoint(Ht),Ht.addVectors(this.boundingBox.max,Ln.max),this.boundingBox.expandByPoint(Ht)):(this.boundingBox.expandByPoint(Ln.min),this.boundingBox.expandByPoint(Ln.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&We('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new mo);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){We("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new V,1/0);return}if(e){let i=this.boundingSphere.center;if(Ln.setFromBufferAttribute(e),t)for(let s=0,o=t.length;s<o;s++){let a=t[s];Aa.setFromBufferAttribute(a),this.morphTargetsRelative?(Ht.addVectors(Ln.min,Aa.min),Ln.expandByPoint(Ht),Ht.addVectors(Ln.max,Aa.max),Ln.expandByPoint(Ht)):(Ln.expandByPoint(Aa.min),Ln.expandByPoint(Aa.max))}Ln.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)Ht.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(Ht));if(t)for(let s=0,o=t.length;s<o;s++){let a=t[s],l=this.morphTargetsRelative;for(let u=0,f=a.count;u<f;u++)Ht.fromBufferAttribute(a,u),l&&(ro.fromBufferAttribute(e,u),Ht.add(ro)),r=Math.max(r,i.distanceToSquared(Ht))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&We('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){We("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=t.position,r=t.normal,s=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Dn(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let x=0;x<i.count;x++)a[x]=new V,l[x]=new V;let u=new V,f=new V,c=new V,h=new Ee,d=new Ee,p=new Ee,_=new V,y=new V;function m(x,w,C){u.fromBufferAttribute(i,x),f.fromBufferAttribute(i,w),c.fromBufferAttribute(i,C),h.fromBufferAttribute(s,x),d.fromBufferAttribute(s,w),p.fromBufferAttribute(s,C),f.sub(u),c.sub(u),d.sub(h),p.sub(h);let A=1/(d.x*p.y-p.x*d.y);isFinite(A)&&(_.copy(f).multiplyScalar(p.y).addScaledVector(c,-d.y).multiplyScalar(A),y.copy(c).multiplyScalar(d.x).addScaledVector(f,-p.x).multiplyScalar(A),a[x].add(_),a[w].add(_),a[C].add(_),l[x].add(y),l[w].add(y),l[C].add(y))}let v=this.groups;v.length===0&&(v=[{start:0,count:e.count}]);for(let x=0,w=v.length;x<w;++x){let C=v[x],A=C.start,I=C.count;for(let D=A,F=A+I;D<F;D+=3)m(e.getX(D+0),e.getX(D+1),e.getX(D+2))}let g=new V,S=new V,E=new V,M=new V;function T(x){E.fromBufferAttribute(r,x),M.copy(E);let w=a[x];g.copy(w),g.sub(E.multiplyScalar(E.dot(w))).normalize(),S.crossVectors(M,w);let A=S.dot(l[x])<0?-1:1;o.setXYZW(x,g.x,g.y,g.z,A)}for(let x=0,w=v.length;x<w;++x){let C=v[x],A=C.start,I=C.count;for(let D=A,F=A+I;D<F;D+=3)T(e.getX(D+0)),T(e.getX(D+1)),T(e.getX(D+2))}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Dn(new Float32Array(t.count*3),3),this.setAttribute("normal",i);else for(let h=0,d=i.count;h<d;h++)i.setXYZ(h,0,0,0);let r=new V,s=new V,o=new V,a=new V,l=new V,u=new V,f=new V,c=new V;if(e)for(let h=0,d=e.count;h<d;h+=3){let p=e.getX(h+0),_=e.getX(h+1),y=e.getX(h+2);r.fromBufferAttribute(t,p),s.fromBufferAttribute(t,_),o.fromBufferAttribute(t,y),f.subVectors(o,s),c.subVectors(r,s),f.cross(c),a.fromBufferAttribute(i,p),l.fromBufferAttribute(i,_),u.fromBufferAttribute(i,y),a.add(f),l.add(f),u.add(f),i.setXYZ(p,a.x,a.y,a.z),i.setXYZ(_,l.x,l.y,l.z),i.setXYZ(y,u.x,u.y,u.z)}else for(let h=0,d=t.count;h<d;h+=3)r.fromBufferAttribute(t,h+0),s.fromBufferAttribute(t,h+1),o.fromBufferAttribute(t,h+2),f.subVectors(o,s),c.subVectors(r,s),f.cross(c),i.setXYZ(h+0,f.x,f.y,f.z),i.setXYZ(h+1,f.x,f.y,f.z),i.setXYZ(h+2,f.x,f.y,f.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,i=e.count;t<i;t++)Ht.fromBufferAttribute(e,t),Ht.normalize(),e.setXYZ(t,Ht.x,Ht.y,Ht.z)}toNonIndexed(){function e(a,l){let u=a.array,f=a.itemSize,c=a.normalized,h=new u.constructor(l.length*f),d=0,p=0;for(let _=0,y=l.length;_<y;_++){a.isInterleavedBufferAttribute?d=l[_]*a.data.stride+a.offset:d=l[_]*f;for(let m=0;m<f;m++)h[p++]=u[d++]}return new Dn(h,f,c)}if(this.index===null)return Ge("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new n,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],u=e(l,i);t.setAttribute(a,u)}let s=this.morphAttributes;for(let a in s){let l=[],u=s[a];for(let f=0,c=u.length;f<c;f++){let h=u[f],d=e(h,i);l.push(d)}t.morphAttributes[a]=l}t.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let u=o[a];t.addGroup(u.start,u.count,u.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let u in l)l[u]!==void 0&&(e[u]=l[u]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let i=this.attributes;for(let l in i){let u=i[l];e.data.attributes[l]=u.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let u=this.morphAttributes[l],f=[];for(let c=0,h=u.length;c<h;c++){let d=u[c];f.push(d.toJSON(e.data))}f.length>0&&(r[l]=f,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let u in r){let f=r[u];this.setAttribute(u,f.clone(t))}let s=e.morphAttributes;for(let u in s){let f=[],c=s[u];for(let h=0,d=c.length;h<d;h++)f.push(c[h].clone(t));this.morphAttributes[u]=f}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let u=0,f=o.length;u<f;u++){let c=o[u];this.addGroup(c.start,c.count,c.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}};var GM=0,Ji=class extends wi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:GM++}),this.uuid=Eo(),this.name="",this.type="Material",this.blending=ls,this.side=Zi,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=hu,this.blendDst=fu,this.blendEquation=Pr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new nt(0,0,0),this.blendAlpha=0,this.depthFunc=cs,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=jp,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=as,this.stencilZFail=as,this.stencilZPass=as,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let i=e[t];if(i===void 0){Ge(`Material: parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){Ge(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[t]=i}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==ls&&(i.blending=this.blending),this.side!==Zi&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==hu&&(i.blendSrc=this.blendSrc),this.blendDst!==fu&&(i.blendDst=this.blendDst),this.blendEquation!==Pr&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==cs&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==jp&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==as&&(i.stencilFail=this.stencilFail),this.stencilZFail!==as&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==as&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(t){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,i=null;if(t!==null){let r=t.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=t[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var Xi=new V,kp=new V,$c=new V,br=new V,zp=new V,Jc=new V,Vp=new V,Ba=class{constructor(e=new V,t=new V(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Xi)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let i=t.dot(this.direction);return i<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=Xi.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(Xi.copy(this.origin).addScaledVector(this.direction,t),Xi.distanceToSquared(e))}distanceSqToSegment(e,t,i,r){kp.copy(e).add(t).multiplyScalar(.5),$c.copy(t).sub(e).normalize(),br.copy(this.origin).sub(kp);let s=e.distanceTo(t)*.5,o=-this.direction.dot($c),a=br.dot(this.direction),l=-br.dot($c),u=br.lengthSq(),f=Math.abs(1-o*o),c,h,d,p;if(f>0)if(c=o*l-a,h=o*a-l,p=s*f,c>=0)if(h>=-p)if(h<=p){let _=1/f;c*=_,h*=_,d=c*(c+o*h+2*a)+h*(o*c+h+2*l)+u}else h=s,c=Math.max(0,-(o*h+a)),d=-c*c+h*(h+2*l)+u;else h=-s,c=Math.max(0,-(o*h+a)),d=-c*c+h*(h+2*l)+u;else h<=-p?(c=Math.max(0,-(-o*s+a)),h=c>0?-s:Math.min(Math.max(-s,-l),s),d=-c*c+h*(h+2*l)+u):h<=p?(c=0,h=Math.min(Math.max(-s,-l),s),d=h*(h+2*l)+u):(c=Math.max(0,-(o*s+a)),h=c>0?s:Math.min(Math.max(-s,-l),s),d=-c*c+h*(h+2*l)+u);else h=o>0?-s:s,c=Math.max(0,-(o*h+a)),d=-c*c+h*(h+2*l)+u;return i&&i.copy(this.origin).addScaledVector(this.direction,c),r&&r.copy(kp).addScaledVector($c,h),d}intersectSphere(e,t){Xi.subVectors(e.center,this.origin);let i=Xi.dot(this.direction),r=Xi.dot(Xi)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,t):this.at(a,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/t;return i>=0?i:null}intersectPlane(e,t){let i=this.distanceToPlane(e);return i===null?null:this.at(i,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let i,r,s,o,a,l,u=1/this.direction.x,f=1/this.direction.y,c=1/this.direction.z,h=this.origin;return u>=0?(i=(e.min.x-h.x)*u,r=(e.max.x-h.x)*u):(i=(e.max.x-h.x)*u,r=(e.min.x-h.x)*u),f>=0?(s=(e.min.y-h.y)*f,o=(e.max.y-h.y)*f):(s=(e.max.y-h.y)*f,o=(e.min.y-h.y)*f),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),c>=0?(a=(e.min.z-h.z)*c,l=(e.max.z-h.z)*c):(a=(e.max.z-h.z)*c,l=(e.min.z-h.z)*c),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,t)}intersectsBox(e){return this.intersectBox(e,Xi)!==null}intersectTriangle(e,t,i,r,s){zp.subVectors(t,e),Jc.subVectors(i,e),Vp.crossVectors(zp,Jc);let o=this.direction.dot(Vp),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;br.subVectors(this.origin,e);let l=a*this.direction.dot(Jc.crossVectors(br,Jc));if(l<0)return null;let u=a*this.direction.dot(zp.cross(br));if(u<0||l+u>o)return null;let f=-a*br.dot(Vp);return f<0?null:this.at(f/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},ka=class extends Ji{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new nt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new $i,this.combine=fm,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},sy=new Mt,ss=new Ba,Kc=new mo,oy=new V,jc=new V,Qc=new V,eu=new V,Gp=new V,tu=new V,ay=new V,nu=new V,pn=class extends an{constructor(e=new Un,t=new ka){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,i=Object.keys(t);if(i.length>0){let r=t[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,t){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;t.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){tu.set(0,0,0);for(let l=0,u=s.length;l<u;l++){let f=a[l],c=s[l];f!==0&&(Gp.fromBufferAttribute(c,e),o?tu.addScaledVector(Gp,f):tu.addScaledVector(Gp.sub(t),f))}t.add(tu)}return t}raycast(e,t){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Kc.copy(i.boundingSphere),Kc.applyMatrix4(s),ss.copy(e.ray).recast(e.near),!(Kc.containsPoint(ss.origin)===!1&&(ss.intersectSphere(Kc,oy)===null||ss.origin.distanceToSquared(oy)>(e.far-e.near)**2))&&(sy.copy(s).invert(),ss.copy(e.ray).applyMatrix4(sy),!(i.boundingBox!==null&&ss.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,t,ss)))}_computeIntersections(e,t,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,u=s.attributes.uv,f=s.attributes.uv1,c=s.attributes.normal,h=s.groups,d=s.drawRange;if(a!==null)if(Array.isArray(o))for(let p=0,_=h.length;p<_;p++){let y=h[p],m=o[y.materialIndex],v=Math.max(y.start,d.start),g=Math.min(a.count,Math.min(y.start+y.count,d.start+d.count));for(let S=v,E=g;S<E;S+=3){let M=a.getX(S),T=a.getX(S+1),x=a.getX(S+2);r=iu(this,m,e,i,u,f,c,M,T,x),r&&(r.faceIndex=Math.floor(S/3),r.face.materialIndex=y.materialIndex,t.push(r))}}else{let p=Math.max(0,d.start),_=Math.min(a.count,d.start+d.count);for(let y=p,m=_;y<m;y+=3){let v=a.getX(y),g=a.getX(y+1),S=a.getX(y+2);r=iu(this,o,e,i,u,f,c,v,g,S),r&&(r.faceIndex=Math.floor(y/3),t.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let p=0,_=h.length;p<_;p++){let y=h[p],m=o[y.materialIndex],v=Math.max(y.start,d.start),g=Math.min(l.count,Math.min(y.start+y.count,d.start+d.count));for(let S=v,E=g;S<E;S+=3){let M=S,T=S+1,x=S+2;r=iu(this,m,e,i,u,f,c,M,T,x),r&&(r.faceIndex=Math.floor(S/3),r.face.materialIndex=y.materialIndex,t.push(r))}}else{let p=Math.max(0,d.start),_=Math.min(l.count,d.start+d.count);for(let y=p,m=_;y<m;y+=3){let v=y,g=y+1,S=y+2;r=iu(this,o,e,i,u,f,c,v,g,S),r&&(r.faceIndex=Math.floor(y/3),t.push(r))}}}};function HM(n,e,t,i,r,s,o,a){let l;if(e.side===mn?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===Zi,a),l===null)return null;nu.copy(a),nu.applyMatrix4(n.matrixWorld);let u=t.ray.origin.distanceTo(nu);return u<t.near||u>t.far?null:{distance:u,point:nu.clone(),object:n}}function iu(n,e,t,i,r,s,o,a,l,u){n.getVertexPosition(a,jc),n.getVertexPosition(l,Qc),n.getVertexPosition(u,eu);let f=HM(n,e,t,i,jc,Qc,eu,ay);if(f){let c=new V;Rr.getBarycoord(ay,jc,Qc,eu,c),r&&(f.uv=Rr.getInterpolatedAttribute(r,a,l,u,c,new Ee)),s&&(f.uv1=Rr.getInterpolatedAttribute(s,a,l,u,c,new Ee)),o&&(f.normal=Rr.getInterpolatedAttribute(o,a,l,u,c,new V),f.normal.dot(i.direction)>0&&f.normal.multiplyScalar(-1));let h={a,b:l,c:u,normal:new V,materialIndex:0};Rr.getNormal(jc,Qc,eu,h.normal),f.face=h,f.barycoord=c}return f}var Cu=class extends dn{constructor(e=null,t=1,i=1,r,s,o,a,l,u=Xt,f=Xt,c,h){super(null,o,a,l,u,f,r,s,c,h),this.isDataTexture=!0,this.image={data:e,width:t,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Hp=new V,WM=new V,XM=new Ye,Zn=class{constructor(e=new V(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,i,r){return this.normal.set(e,t,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,i){let r=Hp.subVectors(i,t).cross(WM.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,i=!0){let r=e.delta(Hp),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let o=-(e.start.dot(this.normal)+this.constant)/s;return i===!0&&(o<0||o>1)?null:t.copy(e.start).addScaledVector(r,o)}intersectsLine(e){let t=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return t<0&&i>0||i<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let i=t||XM.getNormalMatrix(e),r=this.coplanarPoint(Hp).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},os=new mo,YM=new Ee(.5,.5),ru=new V,go=class{constructor(e=new Zn,t=new Zn,i=new Zn,r=new Zn,s=new Zn,o=new Zn){this.planes=[e,t,i,r,s,o]}set(e,t,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let t=this.planes;for(let i=0;i<6;i++)t[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,t=ai,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],u=s[3],f=s[4],c=s[5],h=s[6],d=s[7],p=s[8],_=s[9],y=s[10],m=s[11],v=s[12],g=s[13],S=s[14],E=s[15];if(r[0].setComponents(u-o,d-f,m-p,E-v).normalize(),r[1].setComponents(u+o,d+f,m+p,E+v).normalize(),r[2].setComponents(u+a,d+c,m+_,E+g).normalize(),r[3].setComponents(u-a,d-c,m-_,E-g).normalize(),i)r[4].setComponents(l,h,y,S).normalize(),r[5].setComponents(u-l,d-h,m-y,E-S).normalize();else if(r[4].setComponents(u-l,d-h,m-y,E-S).normalize(),t===ai)r[5].setComponents(u+l,d+h,m+y,E+S).normalize();else if(t===co)r[5].setComponents(l,h,y,S).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),os.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),os.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(os)}intersectsSprite(e){os.center.set(0,0,0);let t=YM.distanceTo(e.center);return os.radius=.7071067811865476+t,os.applyMatrix4(e.matrixWorld),this.intersectsSphere(os)}intersectsSphere(e){let t=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(t[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let t=this.planes;for(let i=0;i<6;i++){let r=t[i];if(ru.x=r.normal.x>0?e.max.x:e.min.x,ru.y=r.normal.y>0?e.max.y:e.min.y,ru.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(ru)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let i=0;i<6;i++)if(t[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var za=class extends dn{constructor(e=[],t=Fr,i,r,s,o,a,l,u,f){super(e,t,i,r,s,o,a,l,u,f),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},Va=class extends dn{constructor(e,t,i,r,s,o,a,l,u){super(e,t,i,r,s,o,a,l,u),this.isCanvasTexture=!0,this.needsUpdate=!0}};var Ki=class extends dn{constructor(e,t,i=ci,r,s,o,a=Xt,l=Xt,u,f=Mi,c=1){if(f!==Mi&&f!==Br)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:t,depth:c};super(h,r,s,o,a,l,f,i,u),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new ho(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},Ru=class extends Ki{constructor(e,t=ci,i=Fr,r,s,o=Xt,a=Xt,l,u=Mi){let f={width:e,height:e,depth:1},c=[f,f,f,f,f,f];super(e,e,t,i,r,s,o,a,l,u),this.image=c,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Ga=class extends dn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},vo=class n extends Un{constructor(e=1,t=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],u=[],f=[],c=[],h=0,d=0;p("z","y","x",-1,-1,i,t,e,o,s,0),p("z","y","x",1,-1,i,t,-e,o,s,1),p("x","z","y",1,1,e,i,t,r,o,2),p("x","z","y",1,-1,e,i,-t,r,o,3),p("x","y","z",1,-1,e,t,i,r,s,4),p("x","y","z",-1,-1,e,t,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new Wt(u,3)),this.setAttribute("normal",new Wt(f,3)),this.setAttribute("uv",new Wt(c,2));function p(_,y,m,v,g,S,E,M,T,x,w){let C=S/T,A=E/x,I=S/2,D=E/2,F=M/2,L=T+1,N=x+1,B=0,H=0,Z=new V;for(let Y=0;Y<N;Y++){let se=Y*A-D;for(let ue=0;ue<L;ue++){let Be=ue*C-I;Z[_]=Be*v,Z[y]=se*g,Z[m]=F,u.push(Z.x,Z.y,Z.z),Z[_]=0,Z[y]=0,Z[m]=M>0?1:-1,f.push(Z.x,Z.y,Z.z),c.push(ue/T),c.push(1-Y/x),B+=1}}for(let Y=0;Y<x;Y++)for(let se=0;se<T;se++){let ue=h+se+L*Y,Be=h+se+L*(Y+1),Ie=h+(se+1)+L*(Y+1),Ue=h+(se+1)+L*Y;l.push(ue,Be,Ue),l.push(Be,Ie,Ue),H+=6}a.addGroup(d,H,w),d+=H,h+=B}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new n(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var Fn=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){Ge("Curve: .getPoint() not implemented.")}getPointAt(e,t){let i=this.getUtoTmapping(e);return this.getPoint(i,t)}getPoints(e=5){let t=[];for(let i=0;i<=e;i++)t.push(this.getPoint(i/e));return t}getSpacedPoints(e=5){let t=[];for(let i=0;i<=e;i++)t.push(this.getPointAt(i/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],i,r=this.getPoint(0),s=0;t.push(0);for(let o=1;o<=e;o++)i=this.getPoint(o/e),s+=i.distanceTo(r),t.push(s),r=i;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){let i=this.getLengths(),r=0,s=i.length,o;t?o=t:o=e*i[s-1];let a=0,l=s-1,u;for(;a<=l;)if(r=Math.floor(a+(l-a)/2),u=i[r]-o,u<0)a=r+1;else if(u>0)l=r-1;else{l=r;break}if(r=l,i[r]===o)return r/(s-1);let f=i[r],h=i[r+1]-f,d=(o-f)/h;return(r+d)/(s-1)}getTangent(e,t){let r=e-1e-4,s=e+1e-4;r<0&&(r=0),s>1&&(s=1);let o=this.getPoint(r),a=this.getPoint(s),l=t||(o.isVector2?new Ee:new V);return l.copy(a).sub(o).normalize(),l}getTangentAt(e,t){let i=this.getUtoTmapping(e);return this.getTangent(i,t)}computeFrenetFrames(e,t=!1){let i=new V,r=[],s=[],o=[],a=new V,l=new Mt;for(let d=0;d<=e;d++){let p=d/e;r[d]=this.getTangentAt(p,new V)}s[0]=new V,o[0]=new V;let u=Number.MAX_VALUE,f=Math.abs(r[0].x),c=Math.abs(r[0].y),h=Math.abs(r[0].z);f<=u&&(u=f,i.set(1,0,0)),c<=u&&(u=c,i.set(0,1,0)),h<=u&&i.set(0,0,1),a.crossVectors(r[0],i).normalize(),s[0].crossVectors(r[0],a),o[0].crossVectors(r[0],s[0]);for(let d=1;d<=e;d++){if(s[d]=s[d-1].clone(),o[d]=o[d-1].clone(),a.crossVectors(r[d-1],r[d]),a.length()>Number.EPSILON){a.normalize();let p=Math.acos(Qe(r[d-1].dot(r[d]),-1,1));s[d].applyMatrix4(l.makeRotationAxis(a,p))}o[d].crossVectors(r[d],s[d])}if(t===!0){let d=Math.acos(Qe(s[0].dot(s[e]),-1,1));d/=e,r[0].dot(a.crossVectors(s[0],s[e]))>0&&(d=-d);for(let p=1;p<=e;p++)s[p].applyMatrix4(l.makeRotationAxis(r[p],d*p)),o[p].crossVectors(r[p],s[p])}return{tangents:r,normals:s,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},xo=class extends Fn{constructor(e=0,t=0,i=1,r=1,s=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=i,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(e,t=new Ee){let i=t,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,o=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(o?s=0:s=r),this.aClockwise===!0&&!o&&(s===r?s=-r:s=s-r);let a=this.aStartAngle+e*s,l=this.aX+this.xRadius*Math.cos(a),u=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let f=Math.cos(this.aRotation),c=Math.sin(this.aRotation),h=l-this.aX,d=u-this.aY;l=h*f-d*c+this.aX,u=h*c+d*f+this.aY}return i.set(l,u)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},Pu=class extends xo{constructor(e,t,i,r,s,o){super(e,t,i,i,r,s,o),this.isArcCurve=!0,this.type="ArcCurve"}};function Pm(){let n=0,e=0,t=0,i=0;function r(s,o,a,l){n=s,e=a,t=-3*s+3*o-2*a-l,i=2*s-2*o+a+l}return{initCatmullRom:function(s,o,a,l,u){r(o,a,u*(a-s),u*(l-o))},initNonuniformCatmullRom:function(s,o,a,l,u,f,c){let h=(o-s)/u-(a-s)/(u+f)+(a-o)/f,d=(a-o)/f-(l-o)/(f+c)+(l-a)/c;h*=f,d*=f,r(o,a,h,d)},calc:function(s){let o=s*s,a=o*s;return n+e*s+t*o+i*a}}}var ly=new V,cy=new V,Wp=new Pm,Xp=new Pm,Yp=new Pm,Iu=class extends Fn{constructor(e=[],t=!1,i="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=i,this.tension=r}getPoint(e,t=new V){let i=t,r=this.points,s=r.length,o=(s-(this.closed?0:1))*e,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/s)+1)*s:l===0&&a===s-1&&(a=s-2,l=1);let u,f;this.closed||a>0?u=r[(a-1)%s]:(cy.subVectors(r[0],r[1]).add(r[0]),u=cy);let c=r[a%s],h=r[(a+1)%s];if(this.closed||a+2<s?f=r[(a+2)%s]:(ly.subVectors(r[s-1],r[s-2]).add(r[s-1]),f=ly),this.curveType==="centripetal"||this.curveType==="chordal"){let d=this.curveType==="chordal"?.5:.25,p=Math.pow(u.distanceToSquared(c),d),_=Math.pow(c.distanceToSquared(h),d),y=Math.pow(h.distanceToSquared(f),d);_<1e-4&&(_=1),p<1e-4&&(p=_),y<1e-4&&(y=_),Wp.initNonuniformCatmullRom(u.x,c.x,h.x,f.x,p,_,y),Xp.initNonuniformCatmullRom(u.y,c.y,h.y,f.y,p,_,y),Yp.initNonuniformCatmullRom(u.z,c.z,h.z,f.z,p,_,y)}else this.curveType==="catmullrom"&&(Wp.initCatmullRom(u.x,c.x,h.x,f.x,this.tension),Xp.initCatmullRom(u.y,c.y,h.y,f.y,this.tension),Yp.initCatmullRom(u.z,c.z,h.z,f.z,this.tension));return i.set(Wp.calc(l),Xp.calc(l),Yp.calc(l)),i}copy(e){super.copy(e),this.points=[];for(let t=0,i=e.points.length;t<i;t++){let r=e.points[t];this.points.push(r.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,i=this.points.length;t<i;t++){let r=this.points[t];e.points.push(r.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,i=e.points.length;t<i;t++){let r=e.points[t];this.points.push(new V().fromArray(r))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function uy(n,e,t,i,r){let s=(i-e)*.5,o=(r-t)*.5,a=n*n,l=n*a;return(2*t-2*i+s+o)*l+(-3*t+3*i-2*s-o)*a+s*n+t}function qM(n,e){let t=1-n;return t*t*e}function ZM(n,e){return 2*(1-n)*n*e}function $M(n,e){return n*n*e}function Ca(n,e,t,i){return qM(n,e)+ZM(n,t)+$M(n,i)}function JM(n,e){let t=1-n;return t*t*t*e}function KM(n,e){let t=1-n;return 3*t*t*n*e}function jM(n,e){return 3*(1-n)*n*n*e}function QM(n,e){return n*n*n*e}function Ra(n,e,t,i,r){return JM(n,e)+KM(n,t)+jM(n,i)+QM(n,r)}var Ha=class extends Fn{constructor(e=new Ee,t=new Ee,i=new Ee,r=new Ee){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=i,this.v3=r}getPoint(e,t=new Ee){let i=t,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(Ra(e,r.x,s.x,o.x,a.x),Ra(e,r.y,s.y,o.y,a.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Lu=class extends Fn{constructor(e=new V,t=new V,i=new V,r=new V){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=i,this.v3=r}getPoint(e,t=new V){let i=t,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(Ra(e,r.x,s.x,o.x,a.x),Ra(e,r.y,s.y,o.y,a.y),Ra(e,r.z,s.z,o.z,a.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Wa=class extends Fn{constructor(e=new Ee,t=new Ee){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new Ee){let i=t;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new Ee){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Du=class extends Fn{constructor(e=new V,t=new V){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new V){let i=t;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new V){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Xa=class extends Fn{constructor(e=new Ee,t=new Ee,i=new Ee){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=i}getPoint(e,t=new Ee){let i=t,r=this.v0,s=this.v1,o=this.v2;return i.set(Ca(e,r.x,s.x,o.x),Ca(e,r.y,s.y,o.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Nu=class extends Fn{constructor(e=new V,t=new V,i=new V){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=i}getPoint(e,t=new V){let i=t,r=this.v0,s=this.v1,o=this.v2;return i.set(Ca(e,r.x,s.x,o.x),Ca(e,r.y,s.y,o.y),Ca(e,r.z,s.z,o.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ya=class extends Fn{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new Ee){let i=t,r=this.points,s=(r.length-1)*e,o=Math.floor(s),a=s-o,l=r[o===0?o:o-1],u=r[o],f=r[o>r.length-2?r.length-1:o+1],c=r[o>r.length-3?r.length-1:o+2];return i.set(uy(a,l.x,u.x,f.x,c.x),uy(a,l.y,u.y,f.y,c.y)),i}copy(e){super.copy(e),this.points=[];for(let t=0,i=e.points.length;t<i;t++){let r=e.points[t];this.points.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,i=this.points.length;t<i;t++){let r=this.points[t];e.points.push(r.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,i=e.points.length;t<i;t++){let r=e.points[t];this.points.push(new Ee().fromArray(r))}return this}},hy=Object.freeze({__proto__:null,ArcCurve:Pu,CatmullRomCurve3:Iu,CubicBezierCurve:Ha,CubicBezierCurve3:Lu,EllipseCurve:xo,LineCurve:Wa,LineCurve3:Du,QuadraticBezierCurve:Xa,QuadraticBezierCurve3:Nu,SplineCurve:Ya}),Uu=class extends Fn{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),t=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(t)){let i=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new hy[i](t,e))}return this}getPoint(e,t){let i=e*this.getLength(),r=this.getCurveLengths(),s=0;for(;s<r.length;){if(r[s]>=i){let o=r[s]-i,a=this.curves[s],l=a.getLength(),u=l===0?0:1-o/l;return a.getPointAt(u,t)}s++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],t=0;for(let i=0,r=this.curves.length;i<r;i++)t+=this.curves[i].getLength(),e.push(t);return this.cacheLengths=e,e}getSpacedPoints(e=40){let t=[];for(let i=0;i<=e;i++)t.push(this.getPoint(i/e));return this.autoClose&&t.push(t[0]),t}getPoints(e=12){let t=[],i;for(let r=0,s=this.curves;r<s.length;r++){let o=s[r],a=o.isEllipseCurve?e*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?e*o.points.length:e,l=o.getPoints(a);for(let u=0;u<l.length;u++){let f=l[u];i&&i.equals(f)||(t.push(f),i=f)}}return this.autoClose&&t.length>1&&!t[t.length-1].equals(t[0])&&t.push(t[0]),t}copy(e){super.copy(e),this.curves=[];for(let t=0,i=e.curves.length;t<i;t++){let r=e.curves[t];this.curves.push(r.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let t=0,i=this.curves.length;t<i;t++){let r=this.curves[t];e.curves.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let t=0,i=e.curves.length;t<i;t++){let r=e.curves[t];this.curves.push(new hy[r.type]().fromJSON(r))}return this}},us=class extends Uu{constructor(e){super(),this.type="Path",this.currentPoint=new Ee,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let t=1,i=e.length;t<i;t++)this.lineTo(e[t].x,e[t].y);return this}moveTo(e,t){return this.currentPoint.set(e,t),this}lineTo(e,t){let i=new Wa(this.currentPoint.clone(),new Ee(e,t));return this.curves.push(i),this.currentPoint.set(e,t),this}quadraticCurveTo(e,t,i,r){let s=new Xa(this.currentPoint.clone(),new Ee(e,t),new Ee(i,r));return this.curves.push(s),this.currentPoint.set(i,r),this}bezierCurveTo(e,t,i,r,s,o){let a=new Ha(this.currentPoint.clone(),new Ee(e,t),new Ee(i,r),new Ee(s,o));return this.curves.push(a),this.currentPoint.set(s,o),this}splineThru(e){let t=[this.currentPoint.clone()].concat(e),i=new Ya(t);return this.curves.push(i),this.currentPoint.copy(e[e.length-1]),this}arc(e,t,i,r,s,o){let a=this.currentPoint.x,l=this.currentPoint.y;return this.absarc(e+a,t+l,i,r,s,o),this}absarc(e,t,i,r,s,o){return this.absellipse(e,t,i,i,r,s,o),this}ellipse(e,t,i,r,s,o,a,l){let u=this.currentPoint.x,f=this.currentPoint.y;return this.absellipse(e+u,t+f,i,r,s,o,a,l),this}absellipse(e,t,i,r,s,o,a,l){let u=new xo(e,t,i,r,s,o,a,l);if(this.curves.length>0){let c=u.getPoint(0);c.equals(this.currentPoint)||this.lineTo(c.x,c.y)}this.curves.push(u);let f=u.getPoint(1);return this.currentPoint.copy(f),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}},hs=class extends us{constructor(e){super(e),this.uuid=Eo(),this.type="Shape",this.holes=[]}getPointsHoles(e){let t=[];for(let i=0,r=this.holes.length;i<r;i++)t[i]=this.holes[i].getPoints(e);return t}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let t=0,i=e.holes.length;t<i;t++){let r=e.holes[t];this.holes.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let t=0,i=this.holes.length;t<i;t++){let r=this.holes[t];e.holes.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let t=0,i=e.holes.length;t<i;t++){let r=e.holes[t];this.holes.push(new us().fromJSON(r))}return this}};function ew(n,e,t=2){let i=e&&e.length,r=i?e[0]*t:n.length,s=r_(n,0,r,t,!0),o=[];if(!s||s.next===s.prev)return o;let a,l,u;if(i&&(s=sw(n,e,s,t)),n.length>80*t){a=n[0],l=n[1];let f=a,c=l;for(let h=t;h<r;h+=t){let d=n[h],p=n[h+1];d<a&&(a=d),p<l&&(l=p),d>f&&(f=d),p>c&&(c=p)}u=Math.max(f-a,c-l),u=u!==0?32767/u:0}return qa(s,o,t,a,l,u,0),o}function r_(n,e,t,i,r){let s;if(r===gw(n,e,t,i)>0)for(let o=e;o<t;o+=i)s=fy(o/i|0,n[o],n[o+1],s);else for(let o=t-i;o>=e;o-=i)s=fy(o/i|0,n[o],n[o+1],s);return s&&yo(s,s.next)&&($a(s),s=s.next),s}function fs(n,e){if(!n)return n;e||(e=n);let t=n,i;do if(i=!1,!t.steiner&&(yo(t,t.next)||At(t.prev,t,t.next)===0)){if($a(t),t=e=t.prev,t===t.next)break;i=!0}else t=t.next;while(i||t!==e);return e}function qa(n,e,t,i,r,s,o){if(!n)return;!o&&s&&uw(n,i,r,s);let a=n;for(;n.prev!==n.next;){let l=n.prev,u=n.next;if(s?nw(n,i,r,s):tw(n)){e.push(l.i,n.i,u.i),$a(n),n=u.next,a=u.next;continue}if(n=u,n===a){o?o===1?(n=iw(fs(n),e),qa(n,e,t,i,r,s,2)):o===2&&rw(n,e,t,i,r,s):qa(fs(n),e,t,i,r,s,1);break}}}function tw(n){let e=n.prev,t=n,i=n.next;if(At(e,t,i)>=0)return!1;let r=e.x,s=t.x,o=i.x,a=e.y,l=t.y,u=i.y,f=Math.min(r,s,o),c=Math.min(a,l,u),h=Math.max(r,s,o),d=Math.max(a,l,u),p=i.next;for(;p!==e;){if(p.x>=f&&p.x<=h&&p.y>=c&&p.y<=d&&ba(r,a,s,l,o,u,p.x,p.y)&&At(p.prev,p,p.next)>=0)return!1;p=p.next}return!0}function nw(n,e,t,i){let r=n.prev,s=n,o=n.next;if(At(r,s,o)>=0)return!1;let a=r.x,l=s.x,u=o.x,f=r.y,c=s.y,h=o.y,d=Math.min(a,l,u),p=Math.min(f,c,h),_=Math.max(a,l,u),y=Math.max(f,c,h),m=em(d,p,e,t,i),v=em(_,y,e,t,i),g=n.prevZ,S=n.nextZ;for(;g&&g.z>=m&&S&&S.z<=v;){if(g.x>=d&&g.x<=_&&g.y>=p&&g.y<=y&&g!==r&&g!==o&&ba(a,f,l,c,u,h,g.x,g.y)&&At(g.prev,g,g.next)>=0||(g=g.prevZ,S.x>=d&&S.x<=_&&S.y>=p&&S.y<=y&&S!==r&&S!==o&&ba(a,f,l,c,u,h,S.x,S.y)&&At(S.prev,S,S.next)>=0))return!1;S=S.nextZ}for(;g&&g.z>=m;){if(g.x>=d&&g.x<=_&&g.y>=p&&g.y<=y&&g!==r&&g!==o&&ba(a,f,l,c,u,h,g.x,g.y)&&At(g.prev,g,g.next)>=0)return!1;g=g.prevZ}for(;S&&S.z<=v;){if(S.x>=d&&S.x<=_&&S.y>=p&&S.y<=y&&S!==r&&S!==o&&ba(a,f,l,c,u,h,S.x,S.y)&&At(S.prev,S,S.next)>=0)return!1;S=S.nextZ}return!0}function iw(n,e){let t=n;do{let i=t.prev,r=t.next.next;!yo(i,r)&&o_(i,t,t.next,r)&&Za(i,r)&&Za(r,i)&&(e.push(i.i,t.i,r.i),$a(t),$a(t.next),t=n=r),t=t.next}while(t!==n);return fs(t)}function rw(n,e,t,i,r,s){let o=n;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&dw(o,a)){let l=a_(o,a);o=fs(o,o.next),l=fs(l,l.next),qa(o,e,t,i,r,s,0),qa(l,e,t,i,r,s,0);return}a=a.next}o=o.next}while(o!==n)}function sw(n,e,t,i){let r=[];for(let s=0,o=e.length;s<o;s++){let a=e[s]*i,l=s<o-1?e[s+1]*i:n.length,u=r_(n,a,l,i,!1);u===u.next&&(u.steiner=!0),r.push(fw(u))}r.sort(ow);for(let s=0;s<r.length;s++)t=aw(r[s],t);return t}function ow(n,e){let t=n.x-e.x;if(t===0&&(t=n.y-e.y,t===0)){let i=(n.next.y-n.y)/(n.next.x-n.x),r=(e.next.y-e.y)/(e.next.x-e.x);t=i-r}return t}function aw(n,e){let t=lw(n,e);if(!t)return e;let i=a_(t,n);return fs(i,i.next),fs(t,t.next)}function lw(n,e){let t=e,i=n.x,r=n.y,s=-1/0,o;if(yo(n,t))return t;do{if(yo(n,t.next))return t.next;if(r<=t.y&&r>=t.next.y&&t.next.y!==t.y){let c=t.x+(r-t.y)*(t.next.x-t.x)/(t.next.y-t.y);if(c<=i&&c>s&&(s=c,o=t.x<t.next.x?t:t.next,c===i))return o}t=t.next}while(t!==e);if(!o)return null;let a=o,l=o.x,u=o.y,f=1/0;t=o;do{if(i>=t.x&&t.x>=l&&i!==t.x&&s_(r<u?i:s,r,l,u,r<u?s:i,r,t.x,t.y)){let c=Math.abs(r-t.y)/(i-t.x);Za(t,n)&&(c<f||c===f&&(t.x>o.x||t.x===o.x&&cw(o,t)))&&(o=t,f=c)}t=t.next}while(t!==a);return o}function cw(n,e){return At(n.prev,n,e.prev)<0&&At(e.next,n,n.next)<0}function uw(n,e,t,i){let r=n;do r.z===0&&(r.z=em(r.x,r.y,e,t,i)),r.prevZ=r.prev,r.nextZ=r.next,r=r.next;while(r!==n);r.prevZ.nextZ=null,r.prevZ=null,hw(r)}function hw(n){let e,t=1;do{let i=n,r;n=null;let s=null;for(e=0;i;){e++;let o=i,a=0;for(let u=0;u<t&&(a++,o=o.nextZ,!!o);u++);let l=t;for(;a>0||l>0&&o;)a!==0&&(l===0||!o||i.z<=o.z)?(r=i,i=i.nextZ,a--):(r=o,o=o.nextZ,l--),s?s.nextZ=r:n=r,r.prevZ=s,s=r;i=o}s.nextZ=null,t*=2}while(e>1);return n}function em(n,e,t,i,r){return n=(n-t)*r|0,e=(e-i)*r|0,n=(n|n<<8)&16711935,n=(n|n<<4)&252645135,n=(n|n<<2)&858993459,n=(n|n<<1)&1431655765,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,n|e<<1}function fw(n){let e=n,t=n;do(e.x<t.x||e.x===t.x&&e.y<t.y)&&(t=e),e=e.next;while(e!==n);return t}function s_(n,e,t,i,r,s,o,a){return(r-o)*(e-a)>=(n-o)*(s-a)&&(n-o)*(i-a)>=(t-o)*(e-a)&&(t-o)*(s-a)>=(r-o)*(i-a)}function ba(n,e,t,i,r,s,o,a){return!(n===o&&e===a)&&s_(n,e,t,i,r,s,o,a)}function dw(n,e){return n.next.i!==e.i&&n.prev.i!==e.i&&!pw(n,e)&&(Za(n,e)&&Za(e,n)&&mw(n,e)&&(At(n.prev,n,e.prev)||At(n,e.prev,e))||yo(n,e)&&At(n.prev,n,n.next)>0&&At(e.prev,e,e.next)>0)}function At(n,e,t){return(e.y-n.y)*(t.x-e.x)-(e.x-n.x)*(t.y-e.y)}function yo(n,e){return n.x===e.x&&n.y===e.y}function o_(n,e,t,i){let r=ou(At(n,e,t)),s=ou(At(n,e,i)),o=ou(At(t,i,n)),a=ou(At(t,i,e));return!!(r!==s&&o!==a||r===0&&su(n,t,e)||s===0&&su(n,i,e)||o===0&&su(t,n,i)||a===0&&su(t,e,i))}function su(n,e,t){return e.x<=Math.max(n.x,t.x)&&e.x>=Math.min(n.x,t.x)&&e.y<=Math.max(n.y,t.y)&&e.y>=Math.min(n.y,t.y)}function ou(n){return n>0?1:n<0?-1:0}function pw(n,e){let t=n;do{if(t.i!==n.i&&t.next.i!==n.i&&t.i!==e.i&&t.next.i!==e.i&&o_(t,t.next,n,e))return!0;t=t.next}while(t!==n);return!1}function Za(n,e){return At(n.prev,n,n.next)<0?At(n,e,n.next)>=0&&At(n,n.prev,e)>=0:At(n,e,n.prev)<0||At(n,n.next,e)<0}function mw(n,e){let t=n,i=!1,r=(n.x+e.x)/2,s=(n.y+e.y)/2;do t.y>s!=t.next.y>s&&t.next.y!==t.y&&r<(t.next.x-t.x)*(s-t.y)/(t.next.y-t.y)+t.x&&(i=!i),t=t.next;while(t!==n);return i}function a_(n,e){let t=tm(n.i,n.x,n.y),i=tm(e.i,e.x,e.y),r=n.next,s=e.prev;return n.next=e,e.prev=n,t.next=r,r.prev=t,i.next=t,t.prev=i,s.next=i,i.prev=s,i}function fy(n,e,t,i){let r=tm(n,e,t);return i?(r.next=i.next,r.prev=i,i.next.prev=r,i.next=r):(r.prev=r,r.next=r),r}function $a(n){n.next.prev=n.prev,n.prev.next=n.next,n.prevZ&&(n.prevZ.nextZ=n.nextZ),n.nextZ&&(n.nextZ.prevZ=n.prevZ)}function tm(n,e,t){return{i:n,x:e,y:t,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function gw(n,e,t,i){let r=0;for(let s=e,o=t-i;s<t;s+=i)r+=(n[o]-n[s])*(n[s+1]+n[o+1]),o=s;return r}var nm=class{static triangulate(e,t,i=2){return ew(e,t,i)}},lo=class n{static area(e){let t=e.length,i=0;for(let r=t-1,s=0;s<t;r=s++)i+=e[r].x*e[s].y-e[s].x*e[r].y;return i*.5}static isClockWise(e){return n.area(e)<0}static triangulateShape(e,t){let i=[],r=[],s=[];dy(e),py(i,e);let o=e.length;t.forEach(dy);for(let l=0;l<t.length;l++)r.push(o),o+=t[l].length,py(i,t[l]);let a=nm.triangulate(i,r);for(let l=0;l<a.length;l+=3)s.push(a.slice(l,l+3));return s}};function dy(n){let e=n.length;e>2&&n[e-1].equals(n[0])&&n.pop()}function py(n,e){for(let t=0;t<e.length;t++)n.push(e[t].x),n.push(e[t].y)}var ds=class n extends Un{constructor(e=1,t=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:i,heightSegments:r};let s=e/2,o=t/2,a=Math.floor(i),l=Math.floor(r),u=a+1,f=l+1,c=e/a,h=t/l,d=[],p=[],_=[],y=[];for(let m=0;m<f;m++){let v=m*h-o;for(let g=0;g<u;g++){let S=g*c-s;p.push(S,-v,0),_.push(0,0,1),y.push(g/a),y.push(1-m/l)}}for(let m=0;m<l;m++)for(let v=0;v<a;v++){let g=v+u*m,S=v+u*(m+1),E=v+1+u*(m+1),M=v+1+u*m;d.push(g,S,M),d.push(S,E,M)}this.setIndex(d),this.setAttribute("position",new Wt(p,3)),this.setAttribute("normal",new Wt(_,3)),this.setAttribute("uv",new Wt(y,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new n(e.width,e.height,e.widthSegments,e.heightSegments)}};var Ja=class n extends Un{constructor(e=new hs([new Ee(0,.5),new Ee(-.5,-.5),new Ee(.5,-.5)]),t=12){super(),this.type="ShapeGeometry",this.parameters={shapes:e,curveSegments:t};let i=[],r=[],s=[],o=[],a=0,l=0;if(Array.isArray(e)===!1)u(e);else for(let f=0;f<e.length;f++)u(e[f]),this.addGroup(a,l,f),a+=l,l=0;this.setIndex(i),this.setAttribute("position",new Wt(r,3)),this.setAttribute("normal",new Wt(s,3)),this.setAttribute("uv",new Wt(o,2));function u(f){let c=r.length/3,h=f.extractPoints(t),d=h.shape,p=h.holes;lo.isClockWise(d)===!1&&(d=d.reverse());for(let y=0,m=p.length;y<m;y++){let v=p[y];lo.isClockWise(v)===!0&&(p[y]=v.reverse())}let _=lo.triangulateShape(d,p);for(let y=0,m=p.length;y<m;y++){let v=p[y];d=d.concat(v)}for(let y=0,m=d.length;y<m;y++){let v=d[y];r.push(v.x,v.y,0),s.push(0,0,1),o.push(v.x,v.y)}for(let y=0,m=_.length;y<m;y++){let v=_[y],g=v[0]+c,S=v[1]+c,E=v[2]+c;i.push(g,S,E),l+=3}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),t=this.parameters.shapes;return vw(t,e)}static fromJSON(e,t){let i=[];for(let r=0,s=e.shapes.length;r<s;r++){let o=t[e.shapes[r]];i.push(o)}return new n(i,e.curveSegments)}};function vw(n,e){if(e.shapes=[],Array.isArray(n))for(let t=0,i=n.length;t<i;t++){let r=n[t];e.shapes.push(r.uuid)}else e.shapes.push(n.uuid);return e}var Ka=class extends Ji{constructor(e){super(),this.isShadowMaterial=!0,this.type="ShadowMaterial",this.color=new nt(0),this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.fog=e.fog,this}};function ms(n){let e={};for(let t in n){e[t]={};for(let i in n[t]){let r=n[t][i];if(my(r))r.isRenderTargetTexture?(Ge("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][i]=null):e[t][i]=r.clone();else if(Array.isArray(r))if(my(r[0])){let s=[];for(let o=0,a=r.length;o<a;o++)s[o]=r[o].clone();e[t][i]=s}else e[t][i]=r.slice();else e[t][i]=r}}return e}function ln(n){let e={};for(let t=0;t<n.length;t++){let i=ms(n[t]);for(let r in i)e[r]=i[r]}return e}function my(n){return n&&(n.isColor||n.isMatrix3||n.isMatrix4||n.isVector2||n.isVector3||n.isVector4||n.isTexture||n.isQuaternion)}function xw(n){let e=[];for(let t=0;t<n.length;t++)e.push(n[t].clone());return e}function Im(n){let e=n.getRenderTarget();return e===null?n.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:tt.workingColorSpace}var l_={clone:ms,merge:ln},yw=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,_w=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,On=class extends Ji{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=yw,this.fragmentShader=_w,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=ms(e.uniforms),this.uniformsGroups=xw(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?t.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[r]={type:"m4",value:o.toArray()}:t.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(t.extensions=i),t}},Fu=class extends On{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},ja=class extends Ji{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new nt(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new nt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=kh,this.normalScale=new Ee(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new $i,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var Ou=class extends Ji{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Xy,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Bu=class extends Ji{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function au(n,e){return!n||n.constructor===e?n:typeof e.BYTES_PER_ELEMENT=="number"?new e(n):Array.prototype.slice.call(n)}var Lr=class{constructor(e,t,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new t.constructor(i),this.sampleValues=t,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,i=this._cachedIndex,r=t[i],s=t[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=t.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=t[++i],e<r)break t}o=t.length;break n}if(!(e>=s)){let a=t[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=t[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<t[a]?o=a:i=a+1}if(r=t[i],s=t[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=t.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)t[o]=i[s+o];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},ku=class extends Lr{constructor(e,t,i,r){super(e,t,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:$p,endingEnd:$p}}intervalChanged_(e,t,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case Jp:s=e,a=2*t-i;break;case Kp:s=r.length-2,a=t+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case Jp:o=e,l=2*i-t;break;case Kp:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=t}let u=(i-t)*.5,f=this.valueSize;this._weightPrev=u/(t-a),this._weightNext=u/(l-i),this._offsetPrev=s*f,this._offsetNext=o*f}interpolate_(e,t,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,u=l-a,f=this._offsetPrev,c=this._offsetNext,h=this._weightPrev,d=this._weightNext,p=(i-t)/(r-t),_=p*p,y=_*p,m=-h*y+2*h*_-h*p,v=(1+h)*y+(-1.5-2*h)*_+(-.5+h)*p+1,g=(-1-d)*y+(1.5+d)*_+.5*p,S=d*y-d*_;for(let E=0;E!==a;++E)s[E]=m*o[f+E]+v*o[u+E]+g*o[l+E]+S*o[c+E];return s}},zu=class extends Lr{constructor(e,t,i,r){super(e,t,i,r)}interpolate_(e,t,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,u=l-a,f=(i-t)/(r-t),c=1-f;for(let h=0;h!==a;++h)s[h]=o[u+h]*c+o[l+h]*f;return s}},Vu=class extends Lr{constructor(e,t,i,r){super(e,t,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},Gu=class extends Lr{interpolate_(e,t,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,u=l-a,f=this.settings||this.DefaultSettings_,c=f.inTangents,h=f.outTangents;if(!c||!h){let _=(i-t)/(r-t),y=1-_;for(let m=0;m!==a;++m)s[m]=o[u+m]*y+o[l+m]*_;return s}let d=a*2,p=e-1;for(let _=0;_!==a;++_){let y=o[u+_],m=o[l+_],v=p*d+_*2,g=h[v],S=h[v+1],E=e*d+_*2,M=c[E],T=c[E+1],x=(i-t)/(r-t),w,C,A,I,D;for(let F=0;F<8;F++){w=x*x,C=w*x,A=1-x,I=A*A,D=I*A;let N=D*t+3*I*x*g+3*A*w*M+C*r-i;if(Math.abs(N)<1e-10)break;let B=3*I*(g-t)+6*A*x*(M-g)+3*w*(r-M);if(Math.abs(B)<1e-10)break;x=x-N/B,x=Math.max(0,Math.min(1,x))}s[_]=D*y+3*I*x*S+3*A*w*T+C*m}return s}},Bn=class{constructor(e,t,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=au(t,this.TimeBufferType),this.values=au(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,i;if(t.toJSON!==this.toJSON)i=t.toJSON(e);else{i={name:e.name,times:au(e.times,Array),values:au(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new Vu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new zu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new ku(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new Gu(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.settings=this.settings),t}setInterpolation(e){let t;switch(e){case Pa:t=this.InterpolantFactoryMethodDiscrete;break;case Mu:t=this.InterpolantFactoryMethodLinear;break;case uu:t=this.InterpolantFactoryMethodSmooth;break;case Zp:t=this.InterpolantFactoryMethodBezier;break}if(t===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return Ge("KeyframeTrack:",i),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Pa;case this.InterpolantFactoryMethodLinear:return Mu;case this.InterpolantFactoryMethodSmooth:return uu;case this.InterpolantFactoryMethodBezier:return Zp}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let i=0,r=t.length;i!==r;++i)t[i]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let i=0,r=t.length;i!==r;++i)t[i]*=e}return this}trim(e,t){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>t;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(We("KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(We("KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){We("KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){We("KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&bM(r))for(let a=0,l=r.length;a!==l;++a){let u=r[a];if(isNaN(u)){We("KeyframeTrack: Value is not a valid number.",this,a,u),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===uu,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,u=e[a],f=e[a+1];if(u!==f&&(a!==1||u!==e[0]))if(r)l=!0;else{let c=a*i,h=c-i,d=c+i;for(let p=0;p!==i;++p){let _=t[c+p];if(_!==t[h+p]||_!==t[d+p]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let c=a*i,h=o*i;for(let d=0;d!==i;++d)t[h+d]=t[c+d]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,u=0;u!==i;++u)t[l+u]=t[a+u];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=t.slice(0,o*i)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),i=this.constructor,r=new i(this.name,e,t);return r.createInterpolant=this.createInterpolant,r}};Bn.prototype.ValueTypeName="";Bn.prototype.TimeBufferType=Float32Array;Bn.prototype.ValueBufferType=Float32Array;Bn.prototype.DefaultInterpolation=Mu;var Dr=class extends Bn{constructor(e,t,i){super(e,t,i)}};Dr.prototype.ValueTypeName="bool";Dr.prototype.ValueBufferType=Array;Dr.prototype.DefaultInterpolation=Pa;Dr.prototype.InterpolantFactoryMethodLinear=void 0;Dr.prototype.InterpolantFactoryMethodSmooth=void 0;var Hu=class extends Bn{constructor(e,t,i,r){super(e,t,i,r)}};Hu.prototype.ValueTypeName="color";var Wu=class extends Bn{constructor(e,t,i,r){super(e,t,i,r)}};Wu.prototype.ValueTypeName="number";var Xu=class extends Lr{constructor(e,t,i,r){super(e,t,i,r)}interpolate_(e,t,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-t)/(r-t),u=e*a;for(let f=u+a;u!==f;u+=4)Ei.slerpFlat(s,0,o,u-a,o,u,l);return s}},Qa=class extends Bn{constructor(e,t,i,r){super(e,t,i,r)}InterpolantFactoryMethodLinear(e){return new Xu(this.times,this.values,this.getValueSize(),e)}};Qa.prototype.ValueTypeName="quaternion";Qa.prototype.InterpolantFactoryMethodSmooth=void 0;var Nr=class extends Bn{constructor(e,t,i){super(e,t,i)}};Nr.prototype.ValueTypeName="string";Nr.prototype.ValueBufferType=Array;Nr.prototype.DefaultInterpolation=Pa;Nr.prototype.InterpolantFactoryMethodLinear=void 0;Nr.prototype.InterpolantFactoryMethodSmooth=void 0;var Yu=class extends Bn{constructor(e,t,i,r){super(e,t,i,r)}};Yu.prototype.ValueTypeName="vector";var qu=class{constructor(e,t,i){let r=this,s=!1,o=0,a=0,l,u=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=i,this._abortController=null,this.itemStart=function(f){a++,s===!1&&r.onStart!==void 0&&r.onStart(f,o,a),s=!0},this.itemEnd=function(f){o++,r.onProgress!==void 0&&r.onProgress(f,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(f){r.onError!==void 0&&r.onError(f)},this.resolveURL=function(f){return l?l(f):f},this.setURLModifier=function(f){return l=f,this},this.addHandler=function(f,c){return u.push(f,c),this},this.removeHandler=function(f){let c=u.indexOf(f);return c!==-1&&u.splice(c,2),this},this.getHandler=function(f){for(let c=0,h=u.length;c<h;c+=2){let d=u[c],p=u[c+1];if(d.global&&(d.lastIndex=0),d.test(f))return p}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},c_=new qu,Zu=class{constructor(e){this.manager=e!==void 0?e:c_,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,t){let i=this;return new Promise(function(r,s){i.load(e,r,t,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Zu.DEFAULT_MATERIAL_NAME="__DEFAULT";var el=class extends an{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new nt(e),this.intensity=t}dispose(){this.dispatchEvent({type:"dispose"})}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},tl=class extends el{constructor(e,t,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(an.DEFAULT_UP),this.updateMatrix(),this.groundColor=new nt(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},qp=new Mt,gy=new V,vy=new V,im=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ee(512,512),this.mapType=wn,this.map=null,this.mapPass=null,this.matrix=new Mt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new go,this._frameExtents=new Ee(1,1),this._viewportCount=1,this._viewports=[new bt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,i=this.matrix;gy.setFromMatrixPosition(e.matrixWorld),t.position.copy(gy),vy.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(vy),t.updateMatrixWorld(),qp.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(qp,t.coordinateSystem,t.reversedDepth),t.coordinateSystem===co||t.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(qp)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},lu=new V,cu=new Ei,_i=new V,nl=class extends an{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Mt,this.projectionMatrix=new Mt,this.projectionMatrixInverse=new Mt,this.coordinateSystem=ai,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(lu,cu,_i),_i.x===1&&_i.y===1&&_i.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(lu,cu,_i.set(1,1,1)).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorld.decompose(lu,cu,_i),_i.x===1&&_i.y===1&&_i.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(lu,cu,_i.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Cr=new V,xy=new Ee,yy=new Ee,Mn=class extends nl{constructor(e=50,t=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=Eu*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Sp*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Eu*2*Math.atan(Math.tan(Sp*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,i){Cr.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Cr.x,Cr.y).multiplyScalar(-e/Cr.z),Cr.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(Cr.x,Cr.y).multiplyScalar(-e/Cr.z)}getViewSize(e,t){return this.getViewBounds(e,xy,yy),t.subVectors(yy,xy)}setViewOffset(e,t,i,r,s,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(Sp*.5*this.fov)/this.zoom,i=2*t,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,u=o.fullHeight;s+=o.offsetX*r/l,t-=o.offsetY*i/u,r*=o.width/l,i*=o.height/u}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,t,t-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}};var Ur=class extends nl{constructor(e=-1,t=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+t,l=r-t;if(this.view!==null&&this.view.enabled){let u=(this.right-this.left)/this.view.fullWidth/this.zoom,f=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=u*this.view.offsetX,o=s+u*this.view.width,a-=f*this.view.offsetY,l=a-f*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},rm=class extends im{constructor(){super(new Ur(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},_o=class extends el{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(an.DEFAULT_UP),this.updateMatrix(),this.target=new an,this.shadow=new rm}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}};var so=-90,oo=1,$u=class extends an{constructor(e,t,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new Mn(so,oo,e,t);r.layers=this.layers,this.add(r);let s=new Mn(so,oo,e,t);s.layers=this.layers,this.add(s);let o=new Mn(so,oo,e,t);o.layers=this.layers,this.add(o);let a=new Mn(so,oo,e,t);a.layers=this.layers,this.add(a);let l=new Mn(so,oo,e,t);l.layers=this.layers,this.add(l);let u=new Mn(so,oo,e,t);u.layers=this.layers,this.add(u)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[i,r,s,o,a,l]=t;for(let u of t)this.remove(u);if(e===ai)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===co)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let u of t)this.add(u),u.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,u,f]=this.children,c=e.getRenderTarget(),h=e.getActiveCubeFace(),d=e.getActiveMipmapLevel(),p=e.xr.enabled;e.xr.enabled=!1;let _=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let y=!1;e.isWebGLRenderer===!0?y=e.state.buffers.depth.getReversed():y=e.reversedDepthBuffer,e.setRenderTarget(i,0,r),y&&e.autoClear===!1&&e.clearDepth(),e.render(t,s),e.setRenderTarget(i,1,r),y&&e.autoClear===!1&&e.clearDepth(),e.render(t,o),e.setRenderTarget(i,2,r),y&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(i,3,r),y&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),e.setRenderTarget(i,4,r),y&&e.autoClear===!1&&e.clearDepth(),e.render(t,u),i.texture.generateMipmaps=_,e.setRenderTarget(i,5,r),y&&e.autoClear===!1&&e.clearDepth(),e.render(t,f),e.setRenderTarget(c,h,d),e.xr.enabled=p,i.texture.needsPMREMUpdate=!0}},Ju=class extends Mn{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Lm="\\[\\]\\.:\\/",Sw=new RegExp("["+Lm+"]","g"),Dm="[^"+Lm+"]",Mw="[^"+Lm.replace("\\.","")+"]",ww=/((?:WC+[\/:])*)/.source.replace("WC",Dm),Ew=/(WCOD+)?/.source.replace("WCOD",Mw),Tw=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Dm),Aw=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Dm),bw=new RegExp("^"+ww+Ew+Tw+Aw+"$"),Cw=["material","materials","bones","map"],sm=class{constructor(e,t,i){let r=i||_t.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,r)}getValue(e,t){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,t)}setValue(e,t){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,i=e.length;t!==i;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,i=e.length;t!==i;++t)e[t].unbind()}},_t=class n{constructor(e,t,i){this.path=t,this.parsedPath=i||n.parseTrackName(t),this.node=n.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,i){return e&&e.isAnimationObjectGroup?new n.Composite(e,t,i):new n(e,t,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(Sw,"")}static parseTrackName(e){let t=bw.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);Cw.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(t);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===t||a.uuid===t)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[t++]=i[r]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,i=t.objectName,r=t.propertyName,s=t.propertyIndex;if(e||(e=n.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Ge("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let u=t.objectIndex;switch(i){case"materials":if(!e.material){We("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){We("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){We("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let f=0;f<e.length;f++)if(e[f].name===u){u=f;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){We("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){We("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){We("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(u!==void 0){if(e[u]===void 0){We("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[u]}}let o=e[r];if(o===void 0){let u=t.nodeName;We("PropertyBinding: Trying to update property for track: "+u+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){We("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){We("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};_t.Composite=sm;_t.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};_t.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};_t.prototype.GetterByBindingType=[_t.prototype._getValue_direct,_t.prototype._getValue_array,_t.prototype._getValue_arrayElement,_t.prototype._getValue_toArray];_t.prototype.SetterByBindingTypeAndVersioning=[[_t.prototype._setValue_direct,_t.prototype._setValue_direct_setNeedsUpdate,_t.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[_t.prototype._setValue_array,_t.prototype._setValue_array_setNeedsUpdate,_t.prototype._setValue_array_setMatrixWorldNeedsUpdate],[_t.prototype._setValue_arrayElement,_t.prototype._setValue_arrayElement_setNeedsUpdate,_t.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[_t.prototype._setValue_fromArray,_t.prototype._setValue_fromArray_setNeedsUpdate,_t.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var QC=new Float32Array(1);var _y=new Mt,il=class{constructor(e,t,i=0,r=1/0){this.ray=new Ba(e,t),this.near=i,this.far=r,this.camera=null,this.layers=new fo,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):We("Raycaster: Unsupported camera type: "+t.type)}setFromXRController(e){return _y.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(_y),this}intersectObject(e,t=!0,i=[]){return om(e,this,i,t),i.sort(Sy),i}intersectObjects(e,t=!0,i=[]){for(let r=0,s=e.length;r<s;r++)om(e[r],this,i,t);return i.sort(Sy),i}};function Sy(n,e){return n.distance-e.distance}function om(n,e,t,i){let r=!0;if(n.layers.test(e.layers)&&n.raycast(e,t)===!1&&(r=!1),r===!0&&i===!0){let s=n.children;for(let o=0,a=s.length;o<a;o++)om(s[o],e,t,!0)}}var km=class km{constructor(e,t,i,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,i,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let i=0;i<4;i++)this.elements[i]=e[i+t];return this}set(e,t,i,r){let s=this.elements;return s[0]=e,s[2]=t,s[1]=i,s[3]=r,this}};km.prototype.isMatrix2=!0;var am=km;function Nm(n,e,t,i){let r=Rw(i);switch(t){case Tm:return n*e;case bm:return n*e/r.components*r.byteLength;case oh:return n*e/r.components*r.byteLength;case kr:return n*e*2/r.components*r.byteLength;case ah:return n*e*2/r.components*r.byteLength;case Am:return n*e*3/r.components*r.byteLength;case $n:return n*e*4/r.components*r.byteLength;case lh:return n*e*4/r.components*r.byteLength;case al:case ll:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*8;case cl:case ul:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*16;case uh:case fh:return Math.max(n,16)*Math.max(e,8)/4;case ch:case hh:return Math.max(n,8)*Math.max(e,8)/2;case dh:case ph:case gh:case vh:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*8;case mh:case hl:case xh:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*16;case yh:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*16;case _h:return Math.floor((n+4)/5)*Math.floor((e+3)/4)*16;case Sh:return Math.floor((n+4)/5)*Math.floor((e+4)/5)*16;case Mh:return Math.floor((n+5)/6)*Math.floor((e+4)/5)*16;case wh:return Math.floor((n+5)/6)*Math.floor((e+5)/6)*16;case Eh:return Math.floor((n+7)/8)*Math.floor((e+4)/5)*16;case Th:return Math.floor((n+7)/8)*Math.floor((e+5)/6)*16;case Ah:return Math.floor((n+7)/8)*Math.floor((e+7)/8)*16;case bh:return Math.floor((n+9)/10)*Math.floor((e+4)/5)*16;case Ch:return Math.floor((n+9)/10)*Math.floor((e+5)/6)*16;case Rh:return Math.floor((n+9)/10)*Math.floor((e+7)/8)*16;case Ph:return Math.floor((n+9)/10)*Math.floor((e+9)/10)*16;case Ih:return Math.floor((n+11)/12)*Math.floor((e+9)/10)*16;case Lh:return Math.floor((n+11)/12)*Math.floor((e+11)/12)*16;case Dh:case Nh:case Uh:return Math.ceil(n/4)*Math.ceil(e/4)*16;case Fh:case Oh:return Math.ceil(n/4)*Math.ceil(e/4)*8;case fl:case Bh:return Math.ceil(n/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function Rw(n){switch(n){case wn:case Sm:return{byteLength:1,components:1};case Mo:case Mm:case bi:return{byteLength:2,components:1};case rh:case sh:return{byteLength:2,components:4};case ci:case ih:case ui:return{byteLength:4,components:1};case wm:case Em:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${n}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:ju}}));typeof window<"u"&&(window.__THREE__?Ge("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=ju);function L_(){let n=null,e=!1,t=null,i=null;function r(s,o){t(s,o),i=n.requestAnimationFrame(r)}return{start:function(){e!==!0&&t!==null&&n!==null&&(i=n.requestAnimationFrame(r),e=!0)},stop:function(){n!==null&&n.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){t=s},setContext:function(s){n=s}}}function Pw(n){let e=new WeakMap;function t(a,l){let u=a.array,f=a.usage,c=u.byteLength,h=n.createBuffer();n.bindBuffer(l,h),n.bufferData(l,u,f),a.onUploadCallback();let d;if(u instanceof Float32Array)d=n.FLOAT;else if(typeof Float16Array<"u"&&u instanceof Float16Array)d=n.HALF_FLOAT;else if(u instanceof Uint16Array)a.isFloat16BufferAttribute?d=n.HALF_FLOAT:d=n.UNSIGNED_SHORT;else if(u instanceof Int16Array)d=n.SHORT;else if(u instanceof Uint32Array)d=n.UNSIGNED_INT;else if(u instanceof Int32Array)d=n.INT;else if(u instanceof Int8Array)d=n.BYTE;else if(u instanceof Uint8Array)d=n.UNSIGNED_BYTE;else if(u instanceof Uint8ClampedArray)d=n.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+u);return{buffer:h,type:d,bytesPerElement:u.BYTES_PER_ELEMENT,version:a.version,size:c}}function i(a,l,u){let f=l.array,c=l.updateRanges;if(n.bindBuffer(u,a),c.length===0)n.bufferSubData(u,0,f);else{c.sort((d,p)=>d.start-p.start);let h=0;for(let d=1;d<c.length;d++){let p=c[h],_=c[d];_.start<=p.start+p.count+1?p.count=Math.max(p.count,_.start+_.count-p.start):(++h,c[h]=_)}c.length=h+1;for(let d=0,p=c.length;d<p;d++){let _=c[d];n.bufferSubData(u,_.start*f.BYTES_PER_ELEMENT,f,_.start,_.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(n.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let f=e.get(a);(!f||f.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let u=e.get(a);if(u===void 0)e.set(a,t(a,l));else if(u.version<a.version){if(u.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(u.buffer,a,l),u.version=a.version}}return{get:r,remove:s,update:o}}var Iw=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Lw=`#ifdef USE_ALPHAHASH
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
#endif`,Dw=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Nw=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Uw=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Fw=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Ow=`#ifdef USE_AOMAP
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
#endif`,Bw=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,kw=`#ifdef USE_BATCHING
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
#endif`,zw=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Vw=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Gw=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Hw=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,Ww=`#ifdef USE_IRIDESCENCE
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
#endif`,Xw=`#ifdef USE_BUMPMAP
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
#endif`,Yw=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,qw=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Zw=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,$w=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Jw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,Kw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,jw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,Qw=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,eE=`#define PI 3.141592653589793
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
} // validated`,tE=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,nE=`vec3 transformedNormal = objectNormal;
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
#endif`,iE=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,rE=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,sE=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,oE=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,aE="gl_FragColor = linearToOutputTexel( gl_FragColor );",lE=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,cE=`#ifdef USE_ENVMAP
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
#endif`,uE=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,hE=`#ifdef USE_ENVMAP
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
#endif`,fE=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,dE=`#ifdef USE_ENVMAP
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
#endif`,pE=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,mE=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,gE=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,vE=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,xE=`#ifdef USE_GRADIENTMAP
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
}`,yE=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,_E=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,SE=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,ME=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,wE=`#ifdef USE_ENVMAP
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
#endif`,EE=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,TE=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,AE=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,bE=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,CE=`PhysicalMaterial material;
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
#endif`,RE=`uniform sampler2D dfgLUT;
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
}`,PE=`
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
#endif`,IE=`#if defined( RE_IndirectDiffuse )
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
#endif`,LE=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,DE=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,NE=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,UE=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,FE=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,OE=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,BE=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,kE=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,zE=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,VE=`#if defined( USE_POINTS_UV )
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
#endif`,GE=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,HE=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,WE=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,XE=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,YE=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,qE=`#ifdef USE_MORPHTARGETS
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
#endif`,ZE=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,$E=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,JE=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,KE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,jE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,QE=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,eT=`#ifdef USE_NORMALMAP
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
#endif`,tT=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,nT=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,iT=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,rT=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,sT=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,oT=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,aT=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,lT=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,cT=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,uT=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,hT=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,fT=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,dT=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,pT=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,mT=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,gT=`float getShadowMask() {
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
}`,vT=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,xT=`#ifdef USE_SKINNING
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
#endif`,yT=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,_T=`#ifdef USE_SKINNING
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
#endif`,ST=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,MT=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,wT=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,ET=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,TT=`#ifdef USE_TRANSMISSION
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
#endif`,AT=`#ifdef USE_TRANSMISSION
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
#endif`,bT=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,CT=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,RT=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,PT=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,IT=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,LT=`uniform sampler2D t2D;
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
}`,DT=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,NT=`#ifdef ENVMAP_TYPE_CUBE
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
}`,UT=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,FT=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,OT=`#include <common>
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
}`,BT=`#if DEPTH_PACKING == 3200
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
}`,kT=`#define DISTANCE
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
}`,zT=`#define DISTANCE
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
}`,VT=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,GT=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,HT=`uniform float scale;
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
}`,WT=`uniform vec3 diffuse;
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
}`,XT=`#include <common>
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
}`,YT=`uniform vec3 diffuse;
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
}`,qT=`#define LAMBERT
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
}`,ZT=`#define LAMBERT
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
}`,$T=`#define MATCAP
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
}`,JT=`#define MATCAP
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
}`,KT=`#define NORMAL
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
}`,jT=`#define NORMAL
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
}`,QT=`#define PHONG
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
}`,eA=`#define PHONG
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
}`,tA=`#define STANDARD
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
}`,nA=`#define STANDARD
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
}`,iA=`#define TOON
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
}`,rA=`#define TOON
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
}`,sA=`uniform float size;
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
}`,oA=`uniform vec3 diffuse;
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
}`,aA=`#include <common>
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
}`,lA=`uniform vec3 color;
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
}`,cA=`uniform float rotation;
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
}`,uA=`uniform vec3 diffuse;
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
}`,Je={alphahash_fragment:Iw,alphahash_pars_fragment:Lw,alphamap_fragment:Dw,alphamap_pars_fragment:Nw,alphatest_fragment:Uw,alphatest_pars_fragment:Fw,aomap_fragment:Ow,aomap_pars_fragment:Bw,batching_pars_vertex:kw,batching_vertex:zw,begin_vertex:Vw,beginnormal_vertex:Gw,bsdfs:Hw,iridescence_fragment:Ww,bumpmap_pars_fragment:Xw,clipping_planes_fragment:Yw,clipping_planes_pars_fragment:qw,clipping_planes_pars_vertex:Zw,clipping_planes_vertex:$w,color_fragment:Jw,color_pars_fragment:Kw,color_pars_vertex:jw,color_vertex:Qw,common:eE,cube_uv_reflection_fragment:tE,defaultnormal_vertex:nE,displacementmap_pars_vertex:iE,displacementmap_vertex:rE,emissivemap_fragment:sE,emissivemap_pars_fragment:oE,colorspace_fragment:aE,colorspace_pars_fragment:lE,envmap_fragment:cE,envmap_common_pars_fragment:uE,envmap_pars_fragment:hE,envmap_pars_vertex:fE,envmap_physical_pars_fragment:wE,envmap_vertex:dE,fog_vertex:pE,fog_pars_vertex:mE,fog_fragment:gE,fog_pars_fragment:vE,gradientmap_pars_fragment:xE,lightmap_pars_fragment:yE,lights_lambert_fragment:_E,lights_lambert_pars_fragment:SE,lights_pars_begin:ME,lights_toon_fragment:EE,lights_toon_pars_fragment:TE,lights_phong_fragment:AE,lights_phong_pars_fragment:bE,lights_physical_fragment:CE,lights_physical_pars_fragment:RE,lights_fragment_begin:PE,lights_fragment_maps:IE,lights_fragment_end:LE,lightprobes_pars_fragment:DE,logdepthbuf_fragment:NE,logdepthbuf_pars_fragment:UE,logdepthbuf_pars_vertex:FE,logdepthbuf_vertex:OE,map_fragment:BE,map_pars_fragment:kE,map_particle_fragment:zE,map_particle_pars_fragment:VE,metalnessmap_fragment:GE,metalnessmap_pars_fragment:HE,morphinstance_vertex:WE,morphcolor_vertex:XE,morphnormal_vertex:YE,morphtarget_pars_vertex:qE,morphtarget_vertex:ZE,normal_fragment_begin:$E,normal_fragment_maps:JE,normal_pars_fragment:KE,normal_pars_vertex:jE,normal_vertex:QE,normalmap_pars_fragment:eT,clearcoat_normal_fragment_begin:tT,clearcoat_normal_fragment_maps:nT,clearcoat_pars_fragment:iT,iridescence_pars_fragment:rT,opaque_fragment:sT,packing:oT,premultiplied_alpha_fragment:aT,project_vertex:lT,dithering_fragment:cT,dithering_pars_fragment:uT,roughnessmap_fragment:hT,roughnessmap_pars_fragment:fT,shadowmap_pars_fragment:dT,shadowmap_pars_vertex:pT,shadowmap_vertex:mT,shadowmask_pars_fragment:gT,skinbase_vertex:vT,skinning_pars_vertex:xT,skinning_vertex:yT,skinnormal_vertex:_T,specularmap_fragment:ST,specularmap_pars_fragment:MT,tonemapping_fragment:wT,tonemapping_pars_fragment:ET,transmission_fragment:TT,transmission_pars_fragment:AT,uv_pars_fragment:bT,uv_pars_vertex:CT,uv_vertex:RT,worldpos_vertex:PT,background_vert:IT,background_frag:LT,backgroundCube_vert:DT,backgroundCube_frag:NT,cube_vert:UT,cube_frag:FT,depth_vert:OT,depth_frag:BT,distance_vert:kT,distance_frag:zT,equirect_vert:VT,equirect_frag:GT,linedashed_vert:HT,linedashed_frag:WT,meshbasic_vert:XT,meshbasic_frag:YT,meshlambert_vert:qT,meshlambert_frag:ZT,meshmatcap_vert:$T,meshmatcap_frag:JT,meshnormal_vert:KT,meshnormal_frag:jT,meshphong_vert:QT,meshphong_frag:eA,meshphysical_vert:tA,meshphysical_frag:nA,meshtoon_vert:iA,meshtoon_frag:rA,points_vert:sA,points_frag:oA,shadow_vert:aA,shadow_frag:lA,sprite_vert:cA,sprite_frag:uA},_e={common:{diffuse:{value:new nt(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ye},alphaMap:{value:null},alphaMapTransform:{value:new Ye},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ye}},envmap:{envMap:{value:null},envMapRotation:{value:new Ye},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ye}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ye}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ye},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ye},normalScale:{value:new Ee(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ye},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ye}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ye}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ye}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new nt(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new V},probesMax:{value:new V},probesResolution:{value:new V}},points:{diffuse:{value:new nt(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ye},alphaTest:{value:0},uvTransform:{value:new Ye}},sprite:{diffuse:{value:new nt(16777215)},opacity:{value:1},center:{value:new Ee(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ye},alphaMap:{value:null},alphaMapTransform:{value:new Ye},alphaTest:{value:0}}},Ri={basic:{uniforms:ln([_e.common,_e.specularmap,_e.envmap,_e.aomap,_e.lightmap,_e.fog]),vertexShader:Je.meshbasic_vert,fragmentShader:Je.meshbasic_frag},lambert:{uniforms:ln([_e.common,_e.specularmap,_e.envmap,_e.aomap,_e.lightmap,_e.emissivemap,_e.bumpmap,_e.normalmap,_e.displacementmap,_e.fog,_e.lights,{emissive:{value:new nt(0)},envMapIntensity:{value:1}}]),vertexShader:Je.meshlambert_vert,fragmentShader:Je.meshlambert_frag},phong:{uniforms:ln([_e.common,_e.specularmap,_e.envmap,_e.aomap,_e.lightmap,_e.emissivemap,_e.bumpmap,_e.normalmap,_e.displacementmap,_e.fog,_e.lights,{emissive:{value:new nt(0)},specular:{value:new nt(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Je.meshphong_vert,fragmentShader:Je.meshphong_frag},standard:{uniforms:ln([_e.common,_e.envmap,_e.aomap,_e.lightmap,_e.emissivemap,_e.bumpmap,_e.normalmap,_e.displacementmap,_e.roughnessmap,_e.metalnessmap,_e.fog,_e.lights,{emissive:{value:new nt(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Je.meshphysical_vert,fragmentShader:Je.meshphysical_frag},toon:{uniforms:ln([_e.common,_e.aomap,_e.lightmap,_e.emissivemap,_e.bumpmap,_e.normalmap,_e.displacementmap,_e.gradientmap,_e.fog,_e.lights,{emissive:{value:new nt(0)}}]),vertexShader:Je.meshtoon_vert,fragmentShader:Je.meshtoon_frag},matcap:{uniforms:ln([_e.common,_e.bumpmap,_e.normalmap,_e.displacementmap,_e.fog,{matcap:{value:null}}]),vertexShader:Je.meshmatcap_vert,fragmentShader:Je.meshmatcap_frag},points:{uniforms:ln([_e.points,_e.fog]),vertexShader:Je.points_vert,fragmentShader:Je.points_frag},dashed:{uniforms:ln([_e.common,_e.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Je.linedashed_vert,fragmentShader:Je.linedashed_frag},depth:{uniforms:ln([_e.common,_e.displacementmap]),vertexShader:Je.depth_vert,fragmentShader:Je.depth_frag},normal:{uniforms:ln([_e.common,_e.bumpmap,_e.normalmap,_e.displacementmap,{opacity:{value:1}}]),vertexShader:Je.meshnormal_vert,fragmentShader:Je.meshnormal_frag},sprite:{uniforms:ln([_e.sprite,_e.fog]),vertexShader:Je.sprite_vert,fragmentShader:Je.sprite_frag},background:{uniforms:{uvTransform:{value:new Ye},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Je.background_vert,fragmentShader:Je.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ye}},vertexShader:Je.backgroundCube_vert,fragmentShader:Je.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Je.cube_vert,fragmentShader:Je.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Je.equirect_vert,fragmentShader:Je.equirect_frag},distance:{uniforms:ln([_e.common,_e.displacementmap,{referencePosition:{value:new V},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Je.distance_vert,fragmentShader:Je.distance_frag},shadow:{uniforms:ln([_e.lights,_e.fog,{color:{value:new nt(0)},opacity:{value:1}}]),vertexShader:Je.shadow_vert,fragmentShader:Je.shadow_frag}};Ri.physical={uniforms:ln([Ri.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ye},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ye},clearcoatNormalScale:{value:new Ee(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ye},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ye},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ye},sheen:{value:0},sheenColor:{value:new nt(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ye},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ye},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ye},transmissionSamplerSize:{value:new Ee},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ye},attenuationDistance:{value:0},attenuationColor:{value:new nt(0)},specularColor:{value:new nt(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ye},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ye},anisotropyVector:{value:new Ee},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ye}}]),vertexShader:Je.meshphysical_vert,fragmentShader:Je.meshphysical_frag};var Gh={r:0,b:0,g:0},hA=new Mt,D_=new Ye;D_.set(-1,0,0,0,1,0,0,0,1);function fA(n,e,t,i,r,s){let o=new nt(0),a=r===!0?0:1,l,u,f=null,c=0,h=null;function d(v){let g=v.isScene===!0?v.background:null;if(g&&g.isTexture){let S=v.backgroundBlurriness>0;g=e.get(g,S)}return g}function p(v){let g=!1,S=d(v);S===null?y(o,a):S&&S.isColor&&(y(S,1),g=!0);let E=n.xr.getEnvironmentBlendMode();E==="additive"?t.buffers.color.setClear(0,0,0,1,s):E==="alpha-blend"&&t.buffers.color.setClear(0,0,0,0,s),(n.autoClear||g)&&(t.buffers.depth.setTest(!0),t.buffers.depth.setMask(!0),t.buffers.color.setMask(!0),n.clear(n.autoClearColor,n.autoClearDepth,n.autoClearStencil))}function _(v,g){let S=d(g);S&&(S.isCubeTexture||S.mapping===sl)?(u===void 0&&(u=new pn(new vo(1,1,1),new On({name:"BackgroundCubeMaterial",uniforms:ms(Ri.backgroundCube.uniforms),vertexShader:Ri.backgroundCube.vertexShader,fragmentShader:Ri.backgroundCube.fragmentShader,side:mn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),u.geometry.deleteAttribute("normal"),u.geometry.deleteAttribute("uv"),u.onBeforeRender=function(E,M,T){this.matrixWorld.copyPosition(T.matrixWorld)},Object.defineProperty(u.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(u)),u.material.uniforms.envMap.value=S,u.material.uniforms.backgroundBlurriness.value=g.backgroundBlurriness,u.material.uniforms.backgroundIntensity.value=g.backgroundIntensity,u.material.uniforms.backgroundRotation.value.setFromMatrix4(hA.makeRotationFromEuler(g.backgroundRotation)).transpose(),S.isCubeTexture&&S.isRenderTargetTexture===!1&&u.material.uniforms.backgroundRotation.value.premultiply(D_),u.material.toneMapped=tt.getTransfer(S.colorSpace)!==lt,(f!==S||c!==S.version||h!==n.toneMapping)&&(u.material.needsUpdate=!0,f=S,c=S.version,h=n.toneMapping),u.layers.enableAll(),v.unshift(u,u.geometry,u.material,0,0,null)):S&&S.isTexture&&(l===void 0&&(l=new pn(new ds(2,2),new On({name:"BackgroundMaterial",uniforms:ms(Ri.background.uniforms),vertexShader:Ri.background.vertexShader,fragmentShader:Ri.background.fragmentShader,side:Zi,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=S,l.material.uniforms.backgroundIntensity.value=g.backgroundIntensity,l.material.toneMapped=tt.getTransfer(S.colorSpace)!==lt,S.matrixAutoUpdate===!0&&S.updateMatrix(),l.material.uniforms.uvTransform.value.copy(S.matrix),(f!==S||c!==S.version||h!==n.toneMapping)&&(l.material.needsUpdate=!0,f=S,c=S.version,h=n.toneMapping),l.layers.enableAll(),v.unshift(l,l.geometry,l.material,0,0,null))}function y(v,g){v.getRGB(Gh,Im(n)),t.buffers.color.setClear(Gh.r,Gh.g,Gh.b,g,s)}function m(){u!==void 0&&(u.geometry.dispose(),u.material.dispose(),u=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(v,g=1){o.set(v),a=g,y(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(v){a=v,y(o,a)},render:p,addToRenderList:_,dispose:m}}function dA(n,e){let t=n.getParameter(n.MAX_VERTEX_ATTRIBS),i={},r=h(null),s=r,o=!1;function a(A,I,D,F,L){let N=!1,B=c(A,F,D,I);s!==B&&(s=B,u(s.object)),N=d(A,F,D,L),N&&p(A,F,D,L),L!==null&&e.update(L,n.ELEMENT_ARRAY_BUFFER),(N||o)&&(o=!1,S(A,I,D,F),L!==null&&n.bindBuffer(n.ELEMENT_ARRAY_BUFFER,e.get(L).buffer))}function l(){return n.createVertexArray()}function u(A){return n.bindVertexArray(A)}function f(A){return n.deleteVertexArray(A)}function c(A,I,D,F){let L=F.wireframe===!0,N=i[I.id];N===void 0&&(N={},i[I.id]=N);let B=A.isInstancedMesh===!0?A.id:0,H=N[B];H===void 0&&(H={},N[B]=H);let Z=H[D.id];Z===void 0&&(Z={},H[D.id]=Z);let Y=Z[L];return Y===void 0&&(Y=h(l()),Z[L]=Y),Y}function h(A){let I=[],D=[],F=[];for(let L=0;L<t;L++)I[L]=0,D[L]=0,F[L]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:I,enabledAttributes:D,attributeDivisors:F,object:A,attributes:{},index:null}}function d(A,I,D,F){let L=s.attributes,N=I.attributes,B=0,H=D.getAttributes();for(let Z in H)if(H[Z].location>=0){let se=L[Z],ue=N[Z];if(ue===void 0&&(Z==="instanceMatrix"&&A.instanceMatrix&&(ue=A.instanceMatrix),Z==="instanceColor"&&A.instanceColor&&(ue=A.instanceColor)),se===void 0||se.attribute!==ue||ue&&se.data!==ue.data)return!0;B++}return s.attributesNum!==B||s.index!==F}function p(A,I,D,F){let L={},N=I.attributes,B=0,H=D.getAttributes();for(let Z in H)if(H[Z].location>=0){let se=N[Z];se===void 0&&(Z==="instanceMatrix"&&A.instanceMatrix&&(se=A.instanceMatrix),Z==="instanceColor"&&A.instanceColor&&(se=A.instanceColor));let ue={};ue.attribute=se,se&&se.data&&(ue.data=se.data),L[Z]=ue,B++}s.attributes=L,s.attributesNum=B,s.index=F}function _(){let A=s.newAttributes;for(let I=0,D=A.length;I<D;I++)A[I]=0}function y(A){m(A,0)}function m(A,I){let D=s.newAttributes,F=s.enabledAttributes,L=s.attributeDivisors;D[A]=1,F[A]===0&&(n.enableVertexAttribArray(A),F[A]=1),L[A]!==I&&(n.vertexAttribDivisor(A,I),L[A]=I)}function v(){let A=s.newAttributes,I=s.enabledAttributes;for(let D=0,F=I.length;D<F;D++)I[D]!==A[D]&&(n.disableVertexAttribArray(D),I[D]=0)}function g(A,I,D,F,L,N,B){B===!0?n.vertexAttribIPointer(A,I,D,L,N):n.vertexAttribPointer(A,I,D,F,L,N)}function S(A,I,D,F){_();let L=F.attributes,N=D.getAttributes(),B=I.defaultAttributeValues;for(let H in N){let Z=N[H];if(Z.location>=0){let Y=L[H];if(Y===void 0&&(H==="instanceMatrix"&&A.instanceMatrix&&(Y=A.instanceMatrix),H==="instanceColor"&&A.instanceColor&&(Y=A.instanceColor)),Y!==void 0){let se=Y.normalized,ue=Y.itemSize,Be=e.get(Y);if(Be===void 0)continue;let Ie=Be.buffer,Ue=Be.type,J=Be.bytesPerElement,me=Ue===n.INT||Ue===n.UNSIGNED_INT||Y.gpuType===ih;if(Y.isInterleavedBufferAttribute){let ae=Y.data,Ae=ae.stride,be=Y.offset;if(ae.isInstancedInterleavedBuffer){for(let Fe=0;Fe<Z.locationSize;Fe++)m(Z.location+Fe,ae.meshPerAttribute);A.isInstancedMesh!==!0&&F._maxInstanceCount===void 0&&(F._maxInstanceCount=ae.meshPerAttribute*ae.count)}else for(let Fe=0;Fe<Z.locationSize;Fe++)y(Z.location+Fe);n.bindBuffer(n.ARRAY_BUFFER,Ie);for(let Fe=0;Fe<Z.locationSize;Fe++)g(Z.location+Fe,ue/Z.locationSize,Ue,se,Ae*J,(be+ue/Z.locationSize*Fe)*J,me)}else{if(Y.isInstancedBufferAttribute){for(let ae=0;ae<Z.locationSize;ae++)m(Z.location+ae,Y.meshPerAttribute);A.isInstancedMesh!==!0&&F._maxInstanceCount===void 0&&(F._maxInstanceCount=Y.meshPerAttribute*Y.count)}else for(let ae=0;ae<Z.locationSize;ae++)y(Z.location+ae);n.bindBuffer(n.ARRAY_BUFFER,Ie);for(let ae=0;ae<Z.locationSize;ae++)g(Z.location+ae,ue/Z.locationSize,Ue,se,ue*J,ue/Z.locationSize*ae*J,me)}}else if(B!==void 0){let se=B[H];if(se!==void 0)switch(se.length){case 2:n.vertexAttrib2fv(Z.location,se);break;case 3:n.vertexAttrib3fv(Z.location,se);break;case 4:n.vertexAttrib4fv(Z.location,se);break;default:n.vertexAttrib1fv(Z.location,se)}}}}v()}function E(){w();for(let A in i){let I=i[A];for(let D in I){let F=I[D];for(let L in F){let N=F[L];for(let B in N)f(N[B].object),delete N[B];delete F[L]}}delete i[A]}}function M(A){if(i[A.id]===void 0)return;let I=i[A.id];for(let D in I){let F=I[D];for(let L in F){let N=F[L];for(let B in N)f(N[B].object),delete N[B];delete F[L]}}delete i[A.id]}function T(A){for(let I in i){let D=i[I];for(let F in D){let L=D[F];if(L[A.id]===void 0)continue;let N=L[A.id];for(let B in N)f(N[B].object),delete N[B];delete L[A.id]}}}function x(A){for(let I in i){let D=i[I],F=A.isInstancedMesh===!0?A.id:0,L=D[F];if(L!==void 0){for(let N in L){let B=L[N];for(let H in B)f(B[H].object),delete B[H];delete L[N]}delete D[F],Object.keys(D).length===0&&delete i[I]}}}function w(){C(),o=!0,s!==r&&(s=r,u(s.object))}function C(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:w,resetDefaultState:C,dispose:E,releaseStatesOfGeometry:M,releaseStatesOfObject:x,releaseStatesOfProgram:T,initAttributes:_,enableAttribute:y,disableUnusedAttributes:v}}function pA(n,e,t){let i;function r(l){i=l}function s(l,u){n.drawArrays(i,l,u),t.update(u,i,1)}function o(l,u,f){f!==0&&(n.drawArraysInstanced(i,l,u,f),t.update(u,i,f))}function a(l,u,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,u,0,f);let h=0;for(let d=0;d<f;d++)h+=u[d];t.update(h,i,1)}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a}function mA(n,e,t,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let T=e.get("EXT_texture_filter_anisotropic");r=n.getParameter(T.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(T){return!(T!==$n&&i.convert(T)!==n.getParameter(n.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(T){let x=T===bi&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(T!==wn&&i.convert(T)!==n.getParameter(n.IMPLEMENTATION_COLOR_READ_TYPE)&&T!==ui&&!x)}function l(T){if(T==="highp"){if(n.getShaderPrecisionFormat(n.VERTEX_SHADER,n.HIGH_FLOAT).precision>0&&n.getShaderPrecisionFormat(n.FRAGMENT_SHADER,n.HIGH_FLOAT).precision>0)return"highp";T="mediump"}return T==="mediump"&&n.getShaderPrecisionFormat(n.VERTEX_SHADER,n.MEDIUM_FLOAT).precision>0&&n.getShaderPrecisionFormat(n.FRAGMENT_SHADER,n.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let u=t.precision!==void 0?t.precision:"highp",f=l(u);f!==u&&(Ge("WebGLRenderer:",u,"not supported, using",f,"instead."),u=f);let c=t.logarithmicDepthBuffer===!0,h=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control");t.reversedDepthBuffer===!0&&h===!1&&Ge("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let d=n.getParameter(n.MAX_TEXTURE_IMAGE_UNITS),p=n.getParameter(n.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=n.getParameter(n.MAX_TEXTURE_SIZE),y=n.getParameter(n.MAX_CUBE_MAP_TEXTURE_SIZE),m=n.getParameter(n.MAX_VERTEX_ATTRIBS),v=n.getParameter(n.MAX_VERTEX_UNIFORM_VECTORS),g=n.getParameter(n.MAX_VARYING_VECTORS),S=n.getParameter(n.MAX_FRAGMENT_UNIFORM_VECTORS),E=n.getParameter(n.MAX_SAMPLES),M=n.getParameter(n.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:u,logarithmicDepthBuffer:c,reversedDepthBuffer:h,maxTextures:d,maxVertexTextures:p,maxTextureSize:_,maxCubemapSize:y,maxAttributes:m,maxVertexUniforms:v,maxVaryings:g,maxFragmentUniforms:S,maxSamples:E,samples:M}}function gA(n){let e=this,t=null,i=0,r=!1,s=!1,o=new Zn,a=new Ye,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(c,h){let d=c.length!==0||h||i!==0||r;return r=h,i=c.length,d},this.beginShadows=function(){s=!0,f(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(c,h){t=f(c,h,0)},this.setState=function(c,h,d){let p=c.clippingPlanes,_=c.clipIntersection,y=c.clipShadows,m=n.get(c);if(!r||p===null||p.length===0||s&&!y)s?f(null):u();else{let v=s?0:i,g=v*4,S=m.clippingState||null;l.value=S,S=f(p,h,g,d);for(let E=0;E!==g;++E)S[E]=t[E];m.clippingState=S,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=v}};function u(){l.value!==t&&(l.value=t,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function f(c,h,d,p){let _=c!==null?c.length:0,y=null;if(_!==0){if(y=l.value,p!==!0||y===null){let m=d+_*4,v=h.matrixWorldInverse;a.getNormalMatrix(v),(y===null||y.length<m)&&(y=new Float32Array(m));for(let g=0,S=d;g!==_;++g,S+=4)o.copy(c[g]).applyMatrix4(v,a),o.normal.toArray(y,S),y[S+3]=o.constant}l.value=y,l.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,y}}var zr=4,u_=[.125,.215,.35,.446,.526,.582],gs=20,vA=256,dl=new Ur,h_=new nt,zm=null,Vm=0,Gm=0,Hm=!1,xA=new V,Wh=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,i=.1,r=100,s={}){let{size:o=256,position:a=xA}=s;zm=this._renderer.getRenderTarget(),Vm=this._renderer.getActiveCubeFace(),Gm=this._renderer.getActiveMipmapLevel(),Hm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),t>0&&this._blur(l,0,0,t),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=p_(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=d_(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(zm,Vm,Gm),this._renderer.xr.enabled=Hm,e.scissorTest=!1,To(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Fr||e.mapping===ps?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),zm=this._renderer.getRenderTarget(),Vm=this._renderer.getActiveCubeFace(),Gm=this._renderer.getActiveMipmapLevel(),Hm=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=t||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,i={magFilter:$t,minFilter:$t,generateMipmaps:!1,type:bi,format:$n,colorSpace:Ia,depthBuffer:!1},r=f_(e,t,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=f_(e,t,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=yA(s)),this._blurMaterial=SA(s,e,t),this._ggxMaterial=_A(s,e,t)}return r}_compileMaterial(e){let t=new pn(new Un,e);this._renderer.compile(t,dl)}_sceneToCubeUV(e,t,i,r,s){let l=new Mn(90,1,t,i),u=[1,-1,1,1,1,1],f=[1,1,1,-1,-1,-1],c=this._renderer,h=c.autoClear,d=c.toneMapping;c.getClearColor(h_),c.toneMapping=li,c.autoClear=!1,c.state.buffers.depth.getReversed()&&(c.setRenderTarget(r),c.clearDepth(),c.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new pn(new vo,new ka({name:"PMREM.Background",side:mn,depthWrite:!1,depthTest:!1})));let _=this._backgroundBox,y=_.material,m=!1,v=e.background;v?v.isColor&&(y.color.copy(v),e.background=null,m=!0):(y.color.copy(h_),m=!0);for(let g=0;g<6;g++){let S=g%3;S===0?(l.up.set(0,u[g],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+f[g],s.y,s.z)):S===1?(l.up.set(0,0,u[g]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+f[g],s.z)):(l.up.set(0,u[g],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+f[g]));let E=this._cubeSize;To(r,S*E,g>2?E:0,E,E),c.setRenderTarget(r),m&&c.render(_,l),c.render(e,l)}c.toneMapping=d,c.autoClear=h,e.background=v}_textureToCubeUV(e,t){let i=this._renderer,r=e.mapping===Fr||e.mapping===ps;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=p_()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=d_());let s=r?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=s;let a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;To(t,0,0,3*l,2*l),i.setRenderTarget(t),i.render(o,dl)}_applyPMREM(e){let t=this._renderer,i=t.autoClear;t.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);t.autoClear=i}_applyGGXFilter(e,t,i){let r=this._renderer,s=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[i];a.material=o;let l=o.uniforms,u=i/(this._lodMeshes.length-1),f=t/(this._lodMeshes.length-1),c=Math.sqrt(u*u-f*f),h=0+u*1.25,d=c*h,{_lodMax:p}=this,_=this._sizeLods[i],y=3*_*(i>p-zr?i-p+zr:0),m=4*(this._cubeSize-_);l.envMap.value=e.texture,l.roughness.value=d,l.mipInt.value=p-t,To(s,y,m,3*_,2*_),r.setRenderTarget(s),r.render(a,dl),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=p-i,To(e,y,m,3*_,2*_),r.setRenderTarget(e),r.render(a,dl)}_blur(e,t,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,t,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,t,i,r,s,o,a){let l=this._renderer,u=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&We("blur direction must be either latitudinal or longitudinal!");let f=3,c=this._lodMeshes[r];c.material=u;let h=u.uniforms,d=this._sizeLods[i]-1,p=isFinite(s)?Math.PI/(2*d):2*Math.PI/(2*gs-1),_=s/p,y=isFinite(s)?1+Math.floor(f*_):gs;y>gs&&Ge(`sigmaRadians, ${s}, is too large and will clip, as it requested ${y} samples when the maximum is set to ${gs}`);let m=[],v=0;for(let T=0;T<gs;++T){let x=T/_,w=Math.exp(-x*x/2);m.push(w),T===0?v+=w:T<y&&(v+=2*w)}for(let T=0;T<m.length;T++)m[T]=m[T]/v;h.envMap.value=e.texture,h.samples.value=y,h.weights.value=m,h.latitudinal.value=o==="latitudinal",a&&(h.poleAxis.value=a);let{_lodMax:g}=this;h.dTheta.value=p,h.mipInt.value=g-i;let S=this._sizeLods[r],E=3*S*(r>g-zr?r-g+zr:0),M=4*(this._cubeSize-S);To(t,E,M,3*S,2*S),l.setRenderTarget(t),l.render(c,dl)}};function yA(n){let e=[],t=[],i=[],r=n,s=n-zr+1+u_.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);e.push(a);let l=1/a;o>n-zr?l=u_[o-n+zr-1]:o===0&&(l=0),t.push(l);let u=1/(a-2),f=-u,c=1+u,h=[f,f,c,f,c,c,f,f,c,c,f,c],d=6,p=6,_=3,y=2,m=1,v=new Float32Array(_*p*d),g=new Float32Array(y*p*d),S=new Float32Array(m*p*d);for(let M=0;M<d;M++){let T=M%3*2/3-1,x=M>2?0:-1,w=[T,x,0,T+2/3,x,0,T+2/3,x+1,0,T,x,0,T+2/3,x+1,0,T,x+1,0];v.set(w,_*p*M),g.set(h,y*p*M);let C=[M,M,M,M,M,M];S.set(C,m*p*M)}let E=new Un;E.setAttribute("position",new Dn(v,_)),E.setAttribute("uv",new Dn(g,y)),E.setAttribute("faceIndex",new Dn(S,m)),i.push(new pn(E,null)),r>zr&&r--}return{lodMeshes:i,sizeLods:e,sigmas:t}}function f_(n,e,t){let i=new Nn(n,e,t);return i.texture.mapping=sl,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function To(n,e,t,i,r){n.viewport.set(e,t,i,r),n.scissor.set(e,t,i,r)}function _A(n,e,t){return new On({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:vA,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${n}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:qh(),fragmentShader:`

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
		`,blending:Ai,depthTest:!1,depthWrite:!1})}function SA(n,e,t){let i=new Float32Array(gs),r=new V(0,1,0);return new On({name:"SphericalGaussianBlur",defines:{n:gs,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${n}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:qh(),fragmentShader:`

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
		`,blending:Ai,depthTest:!1,depthWrite:!1})}function d_(){return new On({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:qh(),fragmentShader:`

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
		`,blending:Ai,depthTest:!1,depthWrite:!1})}function p_(){return new On({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:qh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Ai,depthTest:!1,depthWrite:!1})}function qh(){return`

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
	`}var Xh=class extends Nn{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new za(r),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new vo(5,5,5),s=new On({name:"CubemapFromEquirect",uniforms:ms(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:mn,blending:Ai});s.uniforms.tEquirect.value=t;let o=new pn(r,s),a=t.minFilter;return t.minFilter===Or&&(t.minFilter=$t),new $u(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,i,r);e.setRenderTarget(s)}};function MA(n){let e=new WeakMap,t=new WeakMap,i=null;function r(h,d=!1){return h==null?null:d?o(h):s(h)}function s(h){if(h&&h.isTexture){let d=h.mapping;if(d===eh||d===th)if(e.has(h)){let p=e.get(h).texture;return a(p,h.mapping)}else{let p=h.image;if(p&&p.height>0){let _=new Xh(p.height);return _.fromEquirectangularTexture(n,h),e.set(h,_),h.addEventListener("dispose",u),a(_.texture,h.mapping)}else return null}}return h}function o(h){if(h&&h.isTexture){let d=h.mapping,p=d===eh||d===th,_=d===Fr||d===ps;if(p||_){let y=t.get(h),m=y!==void 0?y.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==m)return i===null&&(i=new Wh(n)),y=p?i.fromEquirectangular(h,y):i.fromCubemap(h,y),y.texture.pmremVersion=h.pmremVersion,t.set(h,y),y.texture;if(y!==void 0)return y.texture;{let v=h.image;return p&&v&&v.height>0||_&&v&&l(v)?(i===null&&(i=new Wh(n)),y=p?i.fromEquirectangular(h):i.fromCubemap(h),y.texture.pmremVersion=h.pmremVersion,t.set(h,y),h.addEventListener("dispose",f),y.texture):null}}}return h}function a(h,d){return d===eh?h.mapping=Fr:d===th&&(h.mapping=ps),h}function l(h){let d=0,p=6;for(let _=0;_<p;_++)h[_]!==void 0&&d++;return d===p}function u(h){let d=h.target;d.removeEventListener("dispose",u);let p=e.get(d);p!==void 0&&(e.delete(d),p.dispose())}function f(h){let d=h.target;d.removeEventListener("dispose",f);let p=t.get(d);p!==void 0&&(t.delete(d),p.dispose())}function c(){e=new WeakMap,t=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:r,dispose:c}}function wA(n){let e={};function t(i){if(e[i]!==void 0)return e[i];let r=n.getExtension(i);return e[i]=r,r}return{has:function(i){return t(i)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(i){let r=t(i);return r===null&&wu("WebGLRenderer: "+i+" extension not supported."),r}}}function EA(n,e,t,i){let r={},s=new WeakMap;function o(c){let h=c.target;h.index!==null&&e.remove(h.index);for(let p in h.attributes)e.remove(h.attributes[p]);h.removeEventListener("dispose",o),delete r[h.id];let d=s.get(h);d&&(e.remove(d),s.delete(h)),i.releaseStatesOfGeometry(h),h.isInstancedBufferGeometry===!0&&delete h._maxInstanceCount,t.memory.geometries--}function a(c,h){return r[h.id]===!0||(h.addEventListener("dispose",o),r[h.id]=!0,t.memory.geometries++),h}function l(c){let h=c.attributes;for(let d in h)e.update(h[d],n.ARRAY_BUFFER)}function u(c){let h=[],d=c.index,p=c.attributes.position,_=0;if(p===void 0)return;if(d!==null){let v=d.array;_=d.version;for(let g=0,S=v.length;g<S;g+=3){let E=v[g+0],M=v[g+1],T=v[g+2];h.push(E,M,M,T,T,E)}}else{let v=p.array;_=p.version;for(let g=0,S=v.length/3-1;g<S;g+=3){let E=g+0,M=g+1,T=g+2;h.push(E,M,M,T,T,E)}}let y=new(p.count>=65535?Oa:Fa)(h,1);y.version=_;let m=s.get(c);m&&e.remove(m),s.set(c,y)}function f(c){let h=s.get(c);if(h){let d=c.index;d!==null&&h.version<d.version&&u(c)}else u(c);return s.get(c)}return{get:a,update:l,getWireframeAttribute:f}}function TA(n,e,t){let i;function r(c){i=c}let s,o;function a(c){s=c.type,o=c.bytesPerElement}function l(c,h){n.drawElements(i,h,s,c*o),t.update(h,i,1)}function u(c,h,d){d!==0&&(n.drawElementsInstanced(i,h,s,c*o,d),t.update(h,i,d))}function f(c,h,d){if(d===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,h,0,s,c,0,d);let _=0;for(let y=0;y<d;y++)_+=h[y];t.update(_,i,1)}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=u,this.renderMultiDraw=f}function AA(n){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(t.calls++,o){case n.TRIANGLES:t.triangles+=a*(s/3);break;case n.LINES:t.lines+=a*(s/2);break;case n.LINE_STRIP:t.lines+=a*(s-1);break;case n.LINE_LOOP:t.lines+=a*s;break;case n.POINTS:t.points+=a*s;break;default:We("WebGLInfo: Unknown draw mode:",o);break}}function r(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:r,update:i}}function bA(n,e,t){let i=new WeakMap,r=new bt;function s(o,a,l){let u=o.morphTargetInfluences,f=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,c=f!==void 0?f.length:0,h=i.get(a);if(h===void 0||h.count!==c){let w=function(){T.dispose(),i.delete(a),a.removeEventListener("dispose",w)};h!==void 0&&h.texture.dispose();let d=a.morphAttributes.position!==void 0,p=a.morphAttributes.normal!==void 0,_=a.morphAttributes.color!==void 0,y=a.morphAttributes.position||[],m=a.morphAttributes.normal||[],v=a.morphAttributes.color||[],g=0;d===!0&&(g=1),p===!0&&(g=2),_===!0&&(g=3);let S=a.attributes.position.count*g,E=1;S>e.maxTextureSize&&(E=Math.ceil(S/e.maxTextureSize),S=e.maxTextureSize);let M=new Float32Array(S*E*4*c),T=new Na(M,S,E,c);T.type=ui,T.needsUpdate=!0;let x=g*4;for(let C=0;C<c;C++){let A=y[C],I=m[C],D=v[C],F=S*E*4*C;for(let L=0;L<A.count;L++){let N=L*x;d===!0&&(r.fromBufferAttribute(A,L),M[F+N+0]=r.x,M[F+N+1]=r.y,M[F+N+2]=r.z,M[F+N+3]=0),p===!0&&(r.fromBufferAttribute(I,L),M[F+N+4]=r.x,M[F+N+5]=r.y,M[F+N+6]=r.z,M[F+N+7]=0),_===!0&&(r.fromBufferAttribute(D,L),M[F+N+8]=r.x,M[F+N+9]=r.y,M[F+N+10]=r.z,M[F+N+11]=D.itemSize===4?r.w:1)}}h={count:c,texture:T,size:new Ee(S,E)},i.set(a,h),a.addEventListener("dispose",w)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(n,"morphTexture",o.morphTexture,t);else{let d=0;for(let _=0;_<u.length;_++)d+=u[_];let p=a.morphTargetsRelative?1:1-d;l.getUniforms().setValue(n,"morphTargetBaseInfluence",p),l.getUniforms().setValue(n,"morphTargetInfluences",u)}l.getUniforms().setValue(n,"morphTargetsTexture",h.texture,t),l.getUniforms().setValue(n,"morphTargetsTextureSize",h.size)}return{update:s}}function CA(n,e,t,i,r){let s=new WeakMap;function o(u){let f=r.render.frame,c=u.geometry,h=e.get(u,c);if(s.get(h)!==f&&(e.update(h),s.set(h,f)),u.isInstancedMesh&&(u.hasEventListener("dispose",l)===!1&&u.addEventListener("dispose",l),s.get(u)!==f&&(t.update(u.instanceMatrix,n.ARRAY_BUFFER),u.instanceColor!==null&&t.update(u.instanceColor,n.ARRAY_BUFFER),s.set(u,f))),u.isSkinnedMesh){let d=u.skeleton;s.get(d)!==f&&(d.update(),s.set(d,f))}return h}function a(){s=new WeakMap}function l(u){let f=u.target;f.removeEventListener("dispose",l),i.releaseStatesOfObject(f),t.remove(f.instanceMatrix),f.instanceColor!==null&&t.remove(f.instanceColor)}return{update:o,dispose:a}}var RA={[dm]:"LINEAR_TONE_MAPPING",[pm]:"REINHARD_TONE_MAPPING",[mm]:"CINEON_TONE_MAPPING",[gm]:"ACES_FILMIC_TONE_MAPPING",[xm]:"AGX_TONE_MAPPING",[ym]:"NEUTRAL_TONE_MAPPING",[vm]:"CUSTOM_TONE_MAPPING"};function PA(n,e,t,i,r){let s=new Nn(e,t,{type:n,depthBuffer:i,stencilBuffer:r,depthTexture:i?new Ki(e,t):void 0}),o=new Nn(e,t,{type:bi,depthBuffer:!1,stencilBuffer:!1}),a=new Un;a.setAttribute("position",new Wt([-1,3,0,-1,-1,0,3,-1,0],3)),a.setAttribute("uv",new Wt([0,2,0,0,2,0],2));let l=new Fu({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),u=new pn(a,l),f=new Ur(-1,1,1,-1,0,1),c=null,h=null,d=!1,p,_=null,y=[],m=!1;this.setSize=function(v,g){s.setSize(v,g),o.setSize(v,g);for(let S=0;S<y.length;S++){let E=y[S];E.setSize&&E.setSize(v,g)}},this.setEffects=function(v){y=v,m=y.length>0&&y[0].isRenderPass===!0;let g=s.width,S=s.height;for(let E=0;E<y.length;E++){let M=y[E];M.setSize&&M.setSize(g,S)}},this.begin=function(v,g){if(d||v.toneMapping===li&&y.length===0)return!1;if(_=g,g!==null){let S=g.width,E=g.height;(s.width!==S||s.height!==E)&&this.setSize(S,E)}return m===!1&&v.setRenderTarget(s),p=v.toneMapping,v.toneMapping=li,!0},this.hasRenderPass=function(){return m},this.end=function(v,g){v.toneMapping=p,d=!0;let S=s,E=o;for(let M=0;M<y.length;M++){let T=y[M];if(T.enabled!==!1&&(T.render(v,E,S,g),T.needsSwap!==!1)){let x=S;S=E,E=x}}if(c!==v.outputColorSpace||h!==v.toneMapping){c=v.outputColorSpace,h=v.toneMapping,l.defines={},tt.getTransfer(c)===lt&&(l.defines.SRGB_TRANSFER="");let M=RA[h];M&&(l.defines[M]=""),l.needsUpdate=!0}l.uniforms.tDiffuse.value=S.texture,v.setRenderTarget(_),v.render(u,f),_=null,d=!1},this.isCompositing=function(){return d},this.dispose=function(){s.depthTexture&&s.depthTexture.dispose(),s.dispose(),o.dispose(),a.dispose(),l.dispose()}}var N_=new dn,Ym=new Ki(1,1),U_=new Na,F_=new bu,O_=new za,m_=[],g_=[],v_=new Float32Array(16),x_=new Float32Array(9),y_=new Float32Array(4);function bo(n,e,t){let i=n[0];if(i<=0||i>0)return n;let r=e*t,s=m_[r];if(s===void 0&&(s=new Float32Array(r),m_[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=t,n[o].toArray(s,a)}return s}function kt(n,e){if(n.length!==e.length)return!1;for(let t=0,i=n.length;t<i;t++)if(n[t]!==e[t])return!1;return!0}function zt(n,e){for(let t=0,i=e.length;t<i;t++)n[t]=e[t]}function Zh(n,e){let t=g_[e];t===void 0&&(t=new Int32Array(e),g_[e]=t);for(let i=0;i!==e;++i)t[i]=n.allocateTextureUnit();return t}function IA(n,e){let t=this.cache;t[0]!==e&&(n.uniform1f(this.addr,e),t[0]=e)}function LA(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(n.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(kt(t,e))return;n.uniform2fv(this.addr,e),zt(t,e)}}function DA(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(n.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(n.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(kt(t,e))return;n.uniform3fv(this.addr,e),zt(t,e)}}function NA(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(n.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(kt(t,e))return;n.uniform4fv(this.addr,e),zt(t,e)}}function UA(n,e){let t=this.cache,i=e.elements;if(i===void 0){if(kt(t,e))return;n.uniformMatrix2fv(this.addr,!1,e),zt(t,e)}else{if(kt(t,i))return;y_.set(i),n.uniformMatrix2fv(this.addr,!1,y_),zt(t,i)}}function FA(n,e){let t=this.cache,i=e.elements;if(i===void 0){if(kt(t,e))return;n.uniformMatrix3fv(this.addr,!1,e),zt(t,e)}else{if(kt(t,i))return;x_.set(i),n.uniformMatrix3fv(this.addr,!1,x_),zt(t,i)}}function OA(n,e){let t=this.cache,i=e.elements;if(i===void 0){if(kt(t,e))return;n.uniformMatrix4fv(this.addr,!1,e),zt(t,e)}else{if(kt(t,i))return;v_.set(i),n.uniformMatrix4fv(this.addr,!1,v_),zt(t,i)}}function BA(n,e){let t=this.cache;t[0]!==e&&(n.uniform1i(this.addr,e),t[0]=e)}function kA(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(n.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(kt(t,e))return;n.uniform2iv(this.addr,e),zt(t,e)}}function zA(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(n.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(kt(t,e))return;n.uniform3iv(this.addr,e),zt(t,e)}}function VA(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(n.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(kt(t,e))return;n.uniform4iv(this.addr,e),zt(t,e)}}function GA(n,e){let t=this.cache;t[0]!==e&&(n.uniform1ui(this.addr,e),t[0]=e)}function HA(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(n.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(kt(t,e))return;n.uniform2uiv(this.addr,e),zt(t,e)}}function WA(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(n.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(kt(t,e))return;n.uniform3uiv(this.addr,e),zt(t,e)}}function XA(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(n.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(kt(t,e))return;n.uniform4uiv(this.addr,e),zt(t,e)}}function YA(n,e,t){let i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r);let s;this.type===n.SAMPLER_2D_SHADOW?(Ym.compareFunction=t.isReversedDepthBuffer()?Vh:zh,s=Ym):s=N_,t.setTexture2D(e||s,r)}function qA(n,e,t){let i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r),t.setTexture3D(e||F_,r)}function ZA(n,e,t){let i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r),t.setTextureCube(e||O_,r)}function $A(n,e,t){let i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r),t.setTexture2DArray(e||U_,r)}function JA(n){switch(n){case 5126:return IA;case 35664:return LA;case 35665:return DA;case 35666:return NA;case 35674:return UA;case 35675:return FA;case 35676:return OA;case 5124:case 35670:return BA;case 35667:case 35671:return kA;case 35668:case 35672:return zA;case 35669:case 35673:return VA;case 5125:return GA;case 36294:return HA;case 36295:return WA;case 36296:return XA;case 35678:case 36198:case 36298:case 36306:case 35682:return YA;case 35679:case 36299:case 36307:return qA;case 35680:case 36300:case 36308:case 36293:return ZA;case 36289:case 36303:case 36311:case 36292:return $A}}function KA(n,e){n.uniform1fv(this.addr,e)}function jA(n,e){let t=bo(e,this.size,2);n.uniform2fv(this.addr,t)}function QA(n,e){let t=bo(e,this.size,3);n.uniform3fv(this.addr,t)}function eb(n,e){let t=bo(e,this.size,4);n.uniform4fv(this.addr,t)}function tb(n,e){let t=bo(e,this.size,4);n.uniformMatrix2fv(this.addr,!1,t)}function nb(n,e){let t=bo(e,this.size,9);n.uniformMatrix3fv(this.addr,!1,t)}function ib(n,e){let t=bo(e,this.size,16);n.uniformMatrix4fv(this.addr,!1,t)}function rb(n,e){n.uniform1iv(this.addr,e)}function sb(n,e){n.uniform2iv(this.addr,e)}function ob(n,e){n.uniform3iv(this.addr,e)}function ab(n,e){n.uniform4iv(this.addr,e)}function lb(n,e){n.uniform1uiv(this.addr,e)}function cb(n,e){n.uniform2uiv(this.addr,e)}function ub(n,e){n.uniform3uiv(this.addr,e)}function hb(n,e){n.uniform4uiv(this.addr,e)}function fb(n,e,t){let i=this.cache,r=e.length,s=Zh(t,r);kt(i,s)||(n.uniform1iv(this.addr,s),zt(i,s));let o;this.type===n.SAMPLER_2D_SHADOW?o=Ym:o=N_;for(let a=0;a!==r;++a)t.setTexture2D(e[a]||o,s[a])}function db(n,e,t){let i=this.cache,r=e.length,s=Zh(t,r);kt(i,s)||(n.uniform1iv(this.addr,s),zt(i,s));for(let o=0;o!==r;++o)t.setTexture3D(e[o]||F_,s[o])}function pb(n,e,t){let i=this.cache,r=e.length,s=Zh(t,r);kt(i,s)||(n.uniform1iv(this.addr,s),zt(i,s));for(let o=0;o!==r;++o)t.setTextureCube(e[o]||O_,s[o])}function mb(n,e,t){let i=this.cache,r=e.length,s=Zh(t,r);kt(i,s)||(n.uniform1iv(this.addr,s),zt(i,s));for(let o=0;o!==r;++o)t.setTexture2DArray(e[o]||U_,s[o])}function gb(n){switch(n){case 5126:return KA;case 35664:return jA;case 35665:return QA;case 35666:return eb;case 35674:return tb;case 35675:return nb;case 35676:return ib;case 5124:case 35670:return rb;case 35667:case 35671:return sb;case 35668:case 35672:return ob;case 35669:case 35673:return ab;case 5125:return lb;case 36294:return cb;case 36295:return ub;case 36296:return hb;case 35678:case 36198:case 36298:case 36306:case 35682:return fb;case 35679:case 36299:case 36307:return db;case 35680:case 36300:case 36308:case 36293:return pb;case 36289:case 36303:case 36311:case 36292:return mb}}var qm=class{constructor(e,t,i){this.id=e,this.addr=i,this.cache=[],this.type=t.type,this.setValue=JA(t.type)}},Zm=class{constructor(e,t,i){this.id=e,this.addr=i,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=gb(t.type)}},$m=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,t[a.id],i)}}},Wm=/(\w+)(\])?(\[|\.)?/g;function __(n,e){n.seq.push(e),n.map[e.id]=e}function vb(n,e,t){let i=n.name,r=i.length;for(Wm.lastIndex=0;;){let s=Wm.exec(i),o=Wm.lastIndex,a=s[1],l=s[2]==="]",u=s[3];if(l&&(a=a|0),u===void 0||u==="["&&o+2===r){__(t,u===void 0?new qm(a,n,e):new Zm(a,n,e));break}else{let c=t.map[a];c===void 0&&(c=new $m(a),__(t,c)),t=c}}}var Ao=class{constructor(e,t){this.seq=[],this.map={};let i=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let o=0;o<i;++o){let a=e.getActiveUniform(t,o),l=e.getUniformLocation(t,a.name);vb(a,l,this)}let r=[],s=[];for(let o of this.seq)o.type===e.SAMPLER_2D_SHADOW||o.type===e.SAMPLER_CUBE_SHADOW||o.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(o):s.push(o);r.length>0&&(this.seq=r.concat(s))}setValue(e,t,i,r){let s=this.map[t];s!==void 0&&s.setValue(e,i,r)}setOptional(e,t,i){let r=t[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,t,i,r){for(let s=0,o=t.length;s!==o;++s){let a=t[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,t){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in t&&i.push(o)}return i}};function S_(n,e,t){let i=n.createShader(e);return n.shaderSource(i,t),n.compileShader(i),i}var xb=37297,yb=0;function _b(n,e){let t=n.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,t.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return i.join(`
`)}var M_=new Ye;function Sb(n){tt._getMatrix(M_,tt.workingColorSpace,n);let e=`mat3( ${M_.elements.map(t=>t.toFixed(4))} )`;switch(tt.getTransfer(n)){case La:return[e,"LinearTransferOETF"];case lt:return[e,"sRGBTransferOETF"];default:return Ge("WebGLProgram: Unsupported color space: ",n),[e,"LinearTransferOETF"]}}function w_(n,e,t){let i=n.getShaderParameter(e,n.COMPILE_STATUS),s=(n.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return t.toUpperCase()+`

`+s+`

`+_b(n.getShaderSource(e),a)}else return s}function Mb(n,e){let t=Sb(e);return[`vec4 ${n}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}var wb={[dm]:"Linear",[pm]:"Reinhard",[mm]:"Cineon",[gm]:"ACESFilmic",[xm]:"AgX",[ym]:"Neutral",[vm]:"Custom"};function Eb(n,e){let t=wb[e];return t===void 0?(Ge("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+n+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+n+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}var Hh=new V;function Tb(){tt.getLuminanceCoefficients(Hh);let n=Hh.x.toFixed(4),e=Hh.y.toFixed(4),t=Hh.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${n}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Ab(n){return[n.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",n.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(ml).join(`
`)}function bb(n){let e=[];for(let t in n){let i=n[t];i!==!1&&e.push("#define "+t+" "+i)}return e.join(`
`)}function Cb(n,e){let t={},i=n.getProgramParameter(e,n.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=n.getActiveAttrib(e,r),o=s.name,a=1;s.type===n.FLOAT_MAT2&&(a=2),s.type===n.FLOAT_MAT3&&(a=3),s.type===n.FLOAT_MAT4&&(a=4),t[o]={type:s.type,location:n.getAttribLocation(e,o),locationSize:a}}return t}function ml(n){return n!==""}function E_(n,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return n.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function T_(n,e){return n.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var Rb=/^[ \t]*#include +<([\w\d./]+)>/gm;function Jm(n){return n.replace(Rb,Ib)}var Pb=new Map;function Ib(n,e){let t=Je[e];if(t===void 0){let i=Pb.get(e);if(i!==void 0)t=Je[i],Ge('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return Jm(t)}var Lb=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function A_(n){return n.replace(Lb,Db)}function Db(n,e,t,i){let r="";for(let s=parseInt(e);s<parseInt(t);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function b_(n){let e=`precision ${n.precision} float;
	precision ${n.precision} int;
	precision ${n.precision} sampler2D;
	precision ${n.precision} samplerCube;
	precision ${n.precision} sampler3D;
	precision ${n.precision} sampler2DArray;
	precision ${n.precision} sampler2DShadow;
	precision ${n.precision} samplerCubeShadow;
	precision ${n.precision} sampler2DArrayShadow;
	precision ${n.precision} isampler2D;
	precision ${n.precision} isampler3D;
	precision ${n.precision} isamplerCube;
	precision ${n.precision} isampler2DArray;
	precision ${n.precision} usampler2D;
	precision ${n.precision} usampler3D;
	precision ${n.precision} usamplerCube;
	precision ${n.precision} usampler2DArray;
	`;return n.precision==="highp"?e+=`
#define HIGH_PRECISION`:n.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:n.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}var Nb={[rl]:"SHADOWMAP_TYPE_PCF",[So]:"SHADOWMAP_TYPE_VSM"};function Ub(n){return Nb[n.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var Fb={[Fr]:"ENVMAP_TYPE_CUBE",[ps]:"ENVMAP_TYPE_CUBE",[sl]:"ENVMAP_TYPE_CUBE_UV"};function Ob(n){return n.envMap===!1?"ENVMAP_TYPE_CUBE":Fb[n.envMapMode]||"ENVMAP_TYPE_CUBE"}var Bb={[ps]:"ENVMAP_MODE_REFRACTION"};function kb(n){return n.envMap===!1?"ENVMAP_MODE_REFLECTION":Bb[n.envMapMode]||"ENVMAP_MODE_REFLECTION"}var zb={[fm]:"ENVMAP_BLENDING_MULTIPLY",[Gy]:"ENVMAP_BLENDING_MIX",[Hy]:"ENVMAP_BLENDING_ADD"};function Vb(n){return n.envMap===!1?"ENVMAP_BLENDING_NONE":zb[n.combine]||"ENVMAP_BLENDING_NONE"}function Gb(n){let e=n.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:i,maxMip:t}}function Hb(n,e,t,i){let r=n.getContext(),s=t.defines,o=t.vertexShader,a=t.fragmentShader,l=Ub(t),u=Ob(t),f=kb(t),c=Vb(t),h=Gb(t),d=Ab(t),p=bb(s),_=r.createProgram(),y,m,v=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(y=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,p].filter(ml).join(`
`),y.length>0&&(y+=`
`),m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,p].filter(ml).join(`
`),m.length>0&&(m+=`
`)):(y=[b_(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,p,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+f:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexNormals?"#define HAS_NORMAL":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(ml).join(`
`),m=[b_(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,p,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+u:"",t.envMap?"#define "+f:"",t.envMap?"#define "+c:"",h?"#define CUBEUV_TEXEL_WIDTH "+h.texelWidth:"",h?"#define CUBEUV_TEXEL_HEIGHT "+h.texelHeight:"",h?"#define CUBEUV_MAX_MIP "+h.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas||t.batchingColor?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==li?"#define TONE_MAPPING":"",t.toneMapping!==li?Je.tonemapping_pars_fragment:"",t.toneMapping!==li?Eb("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Je.colorspace_pars_fragment,Mb("linearToOutputTexel",t.outputColorSpace),Tb(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(ml).join(`
`)),o=Jm(o),o=E_(o,t),o=T_(o,t),a=Jm(a),a=E_(a,t),a=T_(a,t),o=A_(o),a=A_(a),t.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,y=[d,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+y,m=["#define varying in",t.glslVersion===Cm?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Cm?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+m);let g=v+y+o,S=v+m+a,E=S_(r,r.VERTEX_SHADER,g),M=S_(r,r.FRAGMENT_SHADER,S);r.attachShader(_,E),r.attachShader(_,M),t.index0AttributeName!==void 0?r.bindAttribLocation(_,0,t.index0AttributeName):t.morphTargets===!0&&r.bindAttribLocation(_,0,"position"),r.linkProgram(_);function T(A){if(n.debug.checkShaderErrors){let I=r.getProgramInfoLog(_)||"",D=r.getShaderInfoLog(E)||"",F=r.getShaderInfoLog(M)||"",L=I.trim(),N=D.trim(),B=F.trim(),H=!0,Z=!0;if(r.getProgramParameter(_,r.LINK_STATUS)===!1)if(H=!1,typeof n.debug.onShaderError=="function")n.debug.onShaderError(r,_,E,M);else{let Y=w_(r,E,"vertex"),se=w_(r,M,"fragment");We("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(_,r.VALIDATE_STATUS)+`

Material Name: `+A.name+`
Material Type: `+A.type+`

Program Info Log: `+L+`
`+Y+`
`+se)}else L!==""?Ge("WebGLProgram: Program Info Log:",L):(N===""||B==="")&&(Z=!1);Z&&(A.diagnostics={runnable:H,programLog:L,vertexShader:{log:N,prefix:y},fragmentShader:{log:B,prefix:m}})}r.deleteShader(E),r.deleteShader(M),x=new Ao(r,_),w=Cb(r,_)}let x;this.getUniforms=function(){return x===void 0&&T(this),x};let w;this.getAttributes=function(){return w===void 0&&T(this),w};let C=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return C===!1&&(C=r.getProgramParameter(_,xb)),C},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(_),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=yb++,this.cacheKey=e,this.usedTimes=1,this.program=_,this.vertexShader=E,this.fragmentShader=M,this}var Wb=0,Km=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(t),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let i of t)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,i=t.get(e);return i===void 0&&(i=new Set,t.set(e,i)),i}_getShaderStage(e){let t=this.shaderCache,i=t.get(e);return i===void 0&&(i=new jm(e),t.set(e,i)),i}},jm=class{constructor(e){this.id=Wb++,this.code=e,this.usedTimes=0}};function Xb(n){return n===kr||n===hl||n===fl}function Yb(n,e,t,i,r,s){let o=new fo,a=new Km,l=new Set,u=[],f=new Map,c=i.logarithmicDepthBuffer,h=i.precision,d={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function p(x){return l.add(x),x===0?"uv":`uv${x}`}function _(x,w,C,A,I,D){let F=A.fog,L=I.geometry,N=x.isMeshStandardMaterial||x.isMeshLambertMaterial||x.isMeshPhongMaterial?A.environment:null,B=x.isMeshStandardMaterial||x.isMeshLambertMaterial&&!x.envMap||x.isMeshPhongMaterial&&!x.envMap,H=e.get(x.envMap||N,B),Z=H&&H.mapping===sl?H.image.height:null,Y=d[x.type];x.precision!==null&&(h=i.getMaxPrecision(x.precision),h!==x.precision&&Ge("WebGLProgram.getParameters:",x.precision,"not supported, using",h,"instead."));let se=L.morphAttributes.position||L.morphAttributes.normal||L.morphAttributes.color,ue=se!==void 0?se.length:0,Be=0;L.morphAttributes.position!==void 0&&(Be=1),L.morphAttributes.normal!==void 0&&(Be=2),L.morphAttributes.color!==void 0&&(Be=3);let Ie,Ue,J,me;if(Y){let Ze=Ri[Y];Ie=Ze.vertexShader,Ue=Ze.fragmentShader}else Ie=x.vertexShader,Ue=x.fragmentShader,a.update(x),J=a.getVertexShaderID(x),me=a.getFragmentShaderID(x);let ae=n.getRenderTarget(),Ae=n.state.buffers.depth.getReversed(),be=I.isInstancedMesh===!0,Fe=I.isBatchedMesh===!0,at=!!x.map,qe=!!x.matcap,et=!!H,rt=!!x.aoMap,G=!!x.lightMap,ne=!!x.bumpMap,ie=!!x.normalMap,ve=!!x.displacementMap,U=!!x.emissiveMap,Ne=!!x.metalnessMap,Q=!!x.roughnessMap,xe=x.anisotropy>0,re=x.clearcoat>0,Le=x.dispersion>0,P=x.iridescence>0,b=x.sheen>0,k=x.transmission>0,j=xe&&!!x.anisotropyMap,te=re&&!!x.clearcoatMap,le=re&&!!x.clearcoatNormalMap,ge=re&&!!x.clearcoatRoughnessMap,$=P&&!!x.iridescenceMap,K=P&&!!x.iridescenceThicknessMap,ye=b&&!!x.sheenColorMap,Te=b&&!!x.sheenRoughnessMap,de=!!x.specularMap,fe=!!x.specularColorMap,Xe=!!x.specularIntensityMap,ze=k&&!!x.transmissionMap,He=k&&!!x.thicknessMap,O=!!x.gradientMap,he=!!x.alphaMap,ee=x.alphaTest>0,we=!!x.alphaHash,pe=!!x.extensions,oe=li;x.toneMapped&&(ae===null||ae.isXRRenderTarget===!0)&&(oe=n.toneMapping);let Oe={shaderID:Y,shaderType:x.type,shaderName:x.name,vertexShader:Ie,fragmentShader:Ue,defines:x.defines,customVertexShaderID:J,customFragmentShaderID:me,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:h,batching:Fe,batchingColor:Fe&&I._colorsTexture!==null,instancing:be,instancingColor:be&&I.instanceColor!==null,instancingMorph:be&&I.morphTexture!==null,outputColorSpace:ae===null?n.outputColorSpace:ae.isXRRenderTarget===!0?ae.texture.colorSpace:tt.workingColorSpace,alphaToCoverage:!!x.alphaToCoverage,map:at,matcap:qe,envMap:et,envMapMode:et&&H.mapping,envMapCubeUVHeight:Z,aoMap:rt,lightMap:G,bumpMap:ne,normalMap:ie,displacementMap:ve,emissiveMap:U,normalMapObjectSpace:ie&&x.normalMapType===Yy,normalMapTangentSpace:ie&&x.normalMapType===kh,packedNormalMap:ie&&x.normalMapType===kh&&Xb(x.normalMap.format),metalnessMap:Ne,roughnessMap:Q,anisotropy:xe,anisotropyMap:j,clearcoat:re,clearcoatMap:te,clearcoatNormalMap:le,clearcoatRoughnessMap:ge,dispersion:Le,iridescence:P,iridescenceMap:$,iridescenceThicknessMap:K,sheen:b,sheenColorMap:ye,sheenRoughnessMap:Te,specularMap:de,specularColorMap:fe,specularIntensityMap:Xe,transmission:k,transmissionMap:ze,thicknessMap:He,gradientMap:O,opaque:x.transparent===!1&&x.blending===ls&&x.alphaToCoverage===!1,alphaMap:he,alphaTest:ee,alphaHash:we,combine:x.combine,mapUv:at&&p(x.map.channel),aoMapUv:rt&&p(x.aoMap.channel),lightMapUv:G&&p(x.lightMap.channel),bumpMapUv:ne&&p(x.bumpMap.channel),normalMapUv:ie&&p(x.normalMap.channel),displacementMapUv:ve&&p(x.displacementMap.channel),emissiveMapUv:U&&p(x.emissiveMap.channel),metalnessMapUv:Ne&&p(x.metalnessMap.channel),roughnessMapUv:Q&&p(x.roughnessMap.channel),anisotropyMapUv:j&&p(x.anisotropyMap.channel),clearcoatMapUv:te&&p(x.clearcoatMap.channel),clearcoatNormalMapUv:le&&p(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ge&&p(x.clearcoatRoughnessMap.channel),iridescenceMapUv:$&&p(x.iridescenceMap.channel),iridescenceThicknessMapUv:K&&p(x.iridescenceThicknessMap.channel),sheenColorMapUv:ye&&p(x.sheenColorMap.channel),sheenRoughnessMapUv:Te&&p(x.sheenRoughnessMap.channel),specularMapUv:de&&p(x.specularMap.channel),specularColorMapUv:fe&&p(x.specularColorMap.channel),specularIntensityMapUv:Xe&&p(x.specularIntensityMap.channel),transmissionMapUv:ze&&p(x.transmissionMap.channel),thicknessMapUv:He&&p(x.thicknessMap.channel),alphaMapUv:he&&p(x.alphaMap.channel),vertexTangents:!!L.attributes.tangent&&(ie||xe),vertexNormals:!!L.attributes.normal,vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!L.attributes.color&&L.attributes.color.itemSize===4,pointsUvs:I.isPoints===!0&&!!L.attributes.uv&&(at||he),fog:!!F,useFog:x.fog===!0,fogExp2:!!F&&F.isFogExp2,flatShading:x.wireframe===!1&&(x.flatShading===!0||L.attributes.normal===void 0&&ie===!1&&(x.isMeshLambertMaterial||x.isMeshPhongMaterial||x.isMeshStandardMaterial||x.isMeshPhysicalMaterial)),sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:c,reversedDepthBuffer:Ae,skinning:I.isSkinnedMesh===!0,morphTargets:L.morphAttributes.position!==void 0,morphNormals:L.morphAttributes.normal!==void 0,morphColors:L.morphAttributes.color!==void 0,morphTargetsCount:ue,morphTextureStride:Be,numDirLights:w.directional.length,numPointLights:w.point.length,numSpotLights:w.spot.length,numSpotLightMaps:w.spotLightMap.length,numRectAreaLights:w.rectArea.length,numHemiLights:w.hemi.length,numDirLightShadows:w.directionalShadowMap.length,numPointLightShadows:w.pointShadowMap.length,numSpotLightShadows:w.spotShadowMap.length,numSpotLightShadowsWithMaps:w.numSpotLightShadowsWithMaps,numLightProbes:w.numLightProbes,numLightProbeGrids:D.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:x.dithering,shadowMapEnabled:n.shadowMap.enabled&&C.length>0,shadowMapType:n.shadowMap.type,toneMapping:oe,decodeVideoTexture:at&&x.map.isVideoTexture===!0&&tt.getTransfer(x.map.colorSpace)===lt,decodeVideoTextureEmissive:U&&x.emissiveMap.isVideoTexture===!0&&tt.getTransfer(x.emissiveMap.colorSpace)===lt,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===Ti,flipSided:x.side===mn,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:pe&&x.extensions.clipCullDistance===!0&&t.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(pe&&x.extensions.multiDraw===!0||Fe)&&t.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:t.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return Oe.vertexUv1s=l.has(1),Oe.vertexUv2s=l.has(2),Oe.vertexUv3s=l.has(3),l.clear(),Oe}function y(x){let w=[];if(x.shaderID?w.push(x.shaderID):(w.push(x.customVertexShaderID),w.push(x.customFragmentShaderID)),x.defines!==void 0)for(let C in x.defines)w.push(C),w.push(x.defines[C]);return x.isRawShaderMaterial===!1&&(m(w,x),v(w,x),w.push(n.outputColorSpace)),w.push(x.customProgramCacheKey),w.join()}function m(x,w){x.push(w.precision),x.push(w.outputColorSpace),x.push(w.envMapMode),x.push(w.envMapCubeUVHeight),x.push(w.mapUv),x.push(w.alphaMapUv),x.push(w.lightMapUv),x.push(w.aoMapUv),x.push(w.bumpMapUv),x.push(w.normalMapUv),x.push(w.displacementMapUv),x.push(w.emissiveMapUv),x.push(w.metalnessMapUv),x.push(w.roughnessMapUv),x.push(w.anisotropyMapUv),x.push(w.clearcoatMapUv),x.push(w.clearcoatNormalMapUv),x.push(w.clearcoatRoughnessMapUv),x.push(w.iridescenceMapUv),x.push(w.iridescenceThicknessMapUv),x.push(w.sheenColorMapUv),x.push(w.sheenRoughnessMapUv),x.push(w.specularMapUv),x.push(w.specularColorMapUv),x.push(w.specularIntensityMapUv),x.push(w.transmissionMapUv),x.push(w.thicknessMapUv),x.push(w.combine),x.push(w.fogExp2),x.push(w.sizeAttenuation),x.push(w.morphTargetsCount),x.push(w.morphAttributeCount),x.push(w.numDirLights),x.push(w.numPointLights),x.push(w.numSpotLights),x.push(w.numSpotLightMaps),x.push(w.numHemiLights),x.push(w.numRectAreaLights),x.push(w.numDirLightShadows),x.push(w.numPointLightShadows),x.push(w.numSpotLightShadows),x.push(w.numSpotLightShadowsWithMaps),x.push(w.numLightProbes),x.push(w.shadowMapType),x.push(w.toneMapping),x.push(w.numClippingPlanes),x.push(w.numClipIntersection),x.push(w.depthPacking)}function v(x,w){o.disableAll(),w.instancing&&o.enable(0),w.instancingColor&&o.enable(1),w.instancingMorph&&o.enable(2),w.matcap&&o.enable(3),w.envMap&&o.enable(4),w.normalMapObjectSpace&&o.enable(5),w.normalMapTangentSpace&&o.enable(6),w.clearcoat&&o.enable(7),w.iridescence&&o.enable(8),w.alphaTest&&o.enable(9),w.vertexColors&&o.enable(10),w.vertexAlphas&&o.enable(11),w.vertexUv1s&&o.enable(12),w.vertexUv2s&&o.enable(13),w.vertexUv3s&&o.enable(14),w.vertexTangents&&o.enable(15),w.anisotropy&&o.enable(16),w.alphaHash&&o.enable(17),w.batching&&o.enable(18),w.dispersion&&o.enable(19),w.batchingColor&&o.enable(20),w.gradientMap&&o.enable(21),w.packedNormalMap&&o.enable(22),w.vertexNormals&&o.enable(23),x.push(o.mask),o.disableAll(),w.fog&&o.enable(0),w.useFog&&o.enable(1),w.flatShading&&o.enable(2),w.logarithmicDepthBuffer&&o.enable(3),w.reversedDepthBuffer&&o.enable(4),w.skinning&&o.enable(5),w.morphTargets&&o.enable(6),w.morphNormals&&o.enable(7),w.morphColors&&o.enable(8),w.premultipliedAlpha&&o.enable(9),w.shadowMapEnabled&&o.enable(10),w.doubleSided&&o.enable(11),w.flipSided&&o.enable(12),w.useDepthPacking&&o.enable(13),w.dithering&&o.enable(14),w.transmission&&o.enable(15),w.sheen&&o.enable(16),w.opaque&&o.enable(17),w.pointsUvs&&o.enable(18),w.decodeVideoTexture&&o.enable(19),w.decodeVideoTextureEmissive&&o.enable(20),w.alphaToCoverage&&o.enable(21),w.numLightProbeGrids>0&&o.enable(22),x.push(o.mask)}function g(x){let w=d[x.type],C;if(w){let A=Ri[w];C=l_.clone(A.uniforms)}else C=x.uniforms;return C}function S(x,w){let C=f.get(w);return C!==void 0?++C.usedTimes:(C=new Hb(n,w,x,r),u.push(C),f.set(w,C)),C}function E(x){if(--x.usedTimes===0){let w=u.indexOf(x);u[w]=u[u.length-1],u.pop(),f.delete(x.cacheKey),x.destroy()}}function M(x){a.remove(x)}function T(){a.dispose()}return{getParameters:_,getProgramCacheKey:y,getUniforms:g,acquireProgram:S,releaseProgram:E,releaseShaderCache:M,programs:u,dispose:T}}function qb(){let n=new WeakMap;function e(o){return n.has(o)}function t(o){let a=n.get(o);return a===void 0&&(a={},n.set(o,a)),a}function i(o){n.delete(o)}function r(o,a,l){n.get(o)[a]=l}function s(){n=new WeakMap}return{has:e,get:t,remove:i,update:r,dispose:s}}function Zb(n,e){return n.groupOrder!==e.groupOrder?n.groupOrder-e.groupOrder:n.renderOrder!==e.renderOrder?n.renderOrder-e.renderOrder:n.material.id!==e.material.id?n.material.id-e.material.id:n.materialVariant!==e.materialVariant?n.materialVariant-e.materialVariant:n.z!==e.z?n.z-e.z:n.id-e.id}function C_(n,e){return n.groupOrder!==e.groupOrder?n.groupOrder-e.groupOrder:n.renderOrder!==e.renderOrder?n.renderOrder-e.renderOrder:n.z!==e.z?e.z-n.z:n.id-e.id}function R_(){let n=[],e=0,t=[],i=[],r=[];function s(){e=0,t.length=0,i.length=0,r.length=0}function o(h){let d=0;return h.isInstancedMesh&&(d+=2),h.isSkinnedMesh&&(d+=1),d}function a(h,d,p,_,y,m){let v=n[e];return v===void 0?(v={id:h.id,object:h,geometry:d,material:p,materialVariant:o(h),groupOrder:_,renderOrder:h.renderOrder,z:y,group:m},n[e]=v):(v.id=h.id,v.object=h,v.geometry=d,v.material=p,v.materialVariant=o(h),v.groupOrder=_,v.renderOrder=h.renderOrder,v.z=y,v.group=m),e++,v}function l(h,d,p,_,y,m){let v=a(h,d,p,_,y,m);p.transmission>0?i.push(v):p.transparent===!0?r.push(v):t.push(v)}function u(h,d,p,_,y,m){let v=a(h,d,p,_,y,m);p.transmission>0?i.unshift(v):p.transparent===!0?r.unshift(v):t.unshift(v)}function f(h,d){t.length>1&&t.sort(h||Zb),i.length>1&&i.sort(d||C_),r.length>1&&r.sort(d||C_)}function c(){for(let h=e,d=n.length;h<d;h++){let p=n[h];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:t,transmissive:i,transparent:r,init:s,push:l,unshift:u,finish:c,sort:f}}function $b(){let n=new WeakMap;function e(i,r){let s=n.get(i),o;return s===void 0?(o=new R_,n.set(i,[o])):r>=s.length?(o=new R_,s.push(o)):o=s[r],o}function t(){n=new WeakMap}return{get:e,dispose:t}}function Jb(){let n={};return{get:function(e){if(n[e.id]!==void 0)return n[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new V,color:new nt};break;case"SpotLight":t={position:new V,direction:new V,color:new nt,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new V,color:new nt,distance:0,decay:0};break;case"HemisphereLight":t={direction:new V,skyColor:new nt,groundColor:new nt};break;case"RectAreaLight":t={color:new nt,position:new V,halfWidth:new V,halfHeight:new V};break}return n[e.id]=t,t}}}function Kb(){let n={};return{get:function(e){if(n[e.id]!==void 0)return n[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ee};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ee};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ee,shadowCameraNear:1,shadowCameraFar:1e3};break}return n[e.id]=t,t}}}var jb=0;function Qb(n,e){return(e.castShadow?2:0)-(n.castShadow?2:0)+(e.map?1:0)-(n.map?1:0)}function eC(n){let e=new Jb,t=Kb(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let u=0;u<9;u++)i.probe.push(new V);let r=new V,s=new Mt,o=new Mt;function a(u){let f=0,c=0,h=0;for(let w=0;w<9;w++)i.probe[w].set(0,0,0);let d=0,p=0,_=0,y=0,m=0,v=0,g=0,S=0,E=0,M=0,T=0;u.sort(Qb);for(let w=0,C=u.length;w<C;w++){let A=u[w],I=A.color,D=A.intensity,F=A.distance,L=null;if(A.shadow&&A.shadow.map&&(A.shadow.map.texture.format===kr?L=A.shadow.map.texture:L=A.shadow.map.depthTexture||A.shadow.map.texture),A.isAmbientLight)f+=I.r*D,c+=I.g*D,h+=I.b*D;else if(A.isLightProbe){for(let N=0;N<9;N++)i.probe[N].addScaledVector(A.sh.coefficients[N],D);T++}else if(A.isDirectionalLight){let N=e.get(A);if(N.color.copy(A.color).multiplyScalar(A.intensity),A.castShadow){let B=A.shadow,H=t.get(A);H.shadowIntensity=B.intensity,H.shadowBias=B.bias,H.shadowNormalBias=B.normalBias,H.shadowRadius=B.radius,H.shadowMapSize=B.mapSize,i.directionalShadow[d]=H,i.directionalShadowMap[d]=L,i.directionalShadowMatrix[d]=A.shadow.matrix,v++}i.directional[d]=N,d++}else if(A.isSpotLight){let N=e.get(A);N.position.setFromMatrixPosition(A.matrixWorld),N.color.copy(I).multiplyScalar(D),N.distance=F,N.coneCos=Math.cos(A.angle),N.penumbraCos=Math.cos(A.angle*(1-A.penumbra)),N.decay=A.decay,i.spot[_]=N;let B=A.shadow;if(A.map&&(i.spotLightMap[E]=A.map,E++,B.updateMatrices(A),A.castShadow&&M++),i.spotLightMatrix[_]=B.matrix,A.castShadow){let H=t.get(A);H.shadowIntensity=B.intensity,H.shadowBias=B.bias,H.shadowNormalBias=B.normalBias,H.shadowRadius=B.radius,H.shadowMapSize=B.mapSize,i.spotShadow[_]=H,i.spotShadowMap[_]=L,S++}_++}else if(A.isRectAreaLight){let N=e.get(A);N.color.copy(I).multiplyScalar(D),N.halfWidth.set(A.width*.5,0,0),N.halfHeight.set(0,A.height*.5,0),i.rectArea[y]=N,y++}else if(A.isPointLight){let N=e.get(A);if(N.color.copy(A.color).multiplyScalar(A.intensity),N.distance=A.distance,N.decay=A.decay,A.castShadow){let B=A.shadow,H=t.get(A);H.shadowIntensity=B.intensity,H.shadowBias=B.bias,H.shadowNormalBias=B.normalBias,H.shadowRadius=B.radius,H.shadowMapSize=B.mapSize,H.shadowCameraNear=B.camera.near,H.shadowCameraFar=B.camera.far,i.pointShadow[p]=H,i.pointShadowMap[p]=L,i.pointShadowMatrix[p]=A.shadow.matrix,g++}i.point[p]=N,p++}else if(A.isHemisphereLight){let N=e.get(A);N.skyColor.copy(A.color).multiplyScalar(D),N.groundColor.copy(A.groundColor).multiplyScalar(D),i.hemi[m]=N,m++}}y>0&&(n.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=_e.LTC_FLOAT_1,i.rectAreaLTC2=_e.LTC_FLOAT_2):(i.rectAreaLTC1=_e.LTC_HALF_1,i.rectAreaLTC2=_e.LTC_HALF_2)),i.ambient[0]=f,i.ambient[1]=c,i.ambient[2]=h;let x=i.hash;(x.directionalLength!==d||x.pointLength!==p||x.spotLength!==_||x.rectAreaLength!==y||x.hemiLength!==m||x.numDirectionalShadows!==v||x.numPointShadows!==g||x.numSpotShadows!==S||x.numSpotMaps!==E||x.numLightProbes!==T)&&(i.directional.length=d,i.spot.length=_,i.rectArea.length=y,i.point.length=p,i.hemi.length=m,i.directionalShadow.length=v,i.directionalShadowMap.length=v,i.pointShadow.length=g,i.pointShadowMap.length=g,i.spotShadow.length=S,i.spotShadowMap.length=S,i.directionalShadowMatrix.length=v,i.pointShadowMatrix.length=g,i.spotLightMatrix.length=S+E-M,i.spotLightMap.length=E,i.numSpotLightShadowsWithMaps=M,i.numLightProbes=T,x.directionalLength=d,x.pointLength=p,x.spotLength=_,x.rectAreaLength=y,x.hemiLength=m,x.numDirectionalShadows=v,x.numPointShadows=g,x.numSpotShadows=S,x.numSpotMaps=E,x.numLightProbes=T,i.version=jb++)}function l(u,f){let c=0,h=0,d=0,p=0,_=0,y=f.matrixWorldInverse;for(let m=0,v=u.length;m<v;m++){let g=u[m];if(g.isDirectionalLight){let S=i.directional[c];S.direction.setFromMatrixPosition(g.matrixWorld),r.setFromMatrixPosition(g.target.matrixWorld),S.direction.sub(r),S.direction.transformDirection(y),c++}else if(g.isSpotLight){let S=i.spot[d];S.position.setFromMatrixPosition(g.matrixWorld),S.position.applyMatrix4(y),S.direction.setFromMatrixPosition(g.matrixWorld),r.setFromMatrixPosition(g.target.matrixWorld),S.direction.sub(r),S.direction.transformDirection(y),d++}else if(g.isRectAreaLight){let S=i.rectArea[p];S.position.setFromMatrixPosition(g.matrixWorld),S.position.applyMatrix4(y),o.identity(),s.copy(g.matrixWorld),s.premultiply(y),o.extractRotation(s),S.halfWidth.set(g.width*.5,0,0),S.halfHeight.set(0,g.height*.5,0),S.halfWidth.applyMatrix4(o),S.halfHeight.applyMatrix4(o),p++}else if(g.isPointLight){let S=i.point[h];S.position.setFromMatrixPosition(g.matrixWorld),S.position.applyMatrix4(y),h++}else if(g.isHemisphereLight){let S=i.hemi[_];S.direction.setFromMatrixPosition(g.matrixWorld),S.direction.transformDirection(y),_++}}}return{setup:a,setupView:l,state:i}}function P_(n){let e=new eC(n),t=[],i=[],r=[];function s(h){c.camera=h,t.length=0,i.length=0,r.length=0}function o(h){t.push(h)}function a(h){i.push(h)}function l(h){r.push(h)}function u(){e.setup(t)}function f(h){e.setupView(t,h)}let c={lightsArray:t,shadowsArray:i,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:c,setupLights:u,setupLightsView:f,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function tC(n){let e=new WeakMap;function t(r,s=0){let o=e.get(r),a;return o===void 0?(a=new P_(n),e.set(r,[a])):s>=o.length?(a=new P_(n),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:t,dispose:i}}var nC=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,iC=`uniform sampler2D shadow_pass;
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
}`,rC=[new V(1,0,0),new V(-1,0,0),new V(0,1,0),new V(0,-1,0),new V(0,0,1),new V(0,0,-1)],sC=[new V(0,-1,0),new V(0,-1,0),new V(0,0,1),new V(0,0,-1),new V(0,-1,0),new V(0,-1,0)],I_=new Mt,pl=new V,Xm=new V;function oC(n,e,t){let i=new go,r=new Ee,s=new Ee,o=new bt,a=new Ou,l=new Bu,u={},f=t.maxTextureSize,c={[Zi]:mn,[mn]:Zi,[Ti]:Ti},h=new On({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ee},radius:{value:4}},vertexShader:nC,fragmentShader:iC}),d=h.clone();d.defines.HORIZONTAL_PASS=1;let p=new Un;p.setAttribute("position",new Dn(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let _=new pn(p,h),y=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=rl;let m=this.type;this.render=function(M,T,x){if(y.enabled===!1||y.autoUpdate===!1&&y.needsUpdate===!1||M.length===0)return;this.type===Qu&&(Ge("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=rl);let w=n.getRenderTarget(),C=n.getActiveCubeFace(),A=n.getActiveMipmapLevel(),I=n.state;I.setBlending(Ai),I.buffers.depth.getReversed()===!0?I.buffers.color.setClear(0,0,0,0):I.buffers.color.setClear(1,1,1,1),I.buffers.depth.setTest(!0),I.setScissorTest(!1);let D=m!==this.type;D&&T.traverse(function(F){F.material&&(Array.isArray(F.material)?F.material.forEach(L=>L.needsUpdate=!0):F.material.needsUpdate=!0)});for(let F=0,L=M.length;F<L;F++){let N=M[F],B=N.shadow;if(B===void 0){Ge("WebGLShadowMap:",N,"has no shadow.");continue}if(B.autoUpdate===!1&&B.needsUpdate===!1)continue;r.copy(B.mapSize);let H=B.getFrameExtents();r.multiply(H),s.copy(B.mapSize),(r.x>f||r.y>f)&&(r.x>f&&(s.x=Math.floor(f/H.x),r.x=s.x*H.x,B.mapSize.x=s.x),r.y>f&&(s.y=Math.floor(f/H.y),r.y=s.y*H.y,B.mapSize.y=s.y));let Z=n.state.buffers.depth.getReversed();if(B.camera._reversedDepth=Z,B.map===null||D===!0){if(B.map!==null&&(B.map.depthTexture!==null&&(B.map.depthTexture.dispose(),B.map.depthTexture=null),B.map.dispose()),this.type===So){if(N.isPointLight){Ge("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}B.map=new Nn(r.x,r.y,{format:kr,type:bi,minFilter:$t,magFilter:$t,generateMipmaps:!1}),B.map.texture.name=N.name+".shadowMap",B.map.depthTexture=new Ki(r.x,r.y,ui),B.map.depthTexture.name=N.name+".shadowMapDepth",B.map.depthTexture.format=Mi,B.map.depthTexture.compareFunction=null,B.map.depthTexture.minFilter=Xt,B.map.depthTexture.magFilter=Xt}else N.isPointLight?(B.map=new Xh(r.x),B.map.depthTexture=new Ru(r.x,ci)):(B.map=new Nn(r.x,r.y),B.map.depthTexture=new Ki(r.x,r.y,ci)),B.map.depthTexture.name=N.name+".shadowMap",B.map.depthTexture.format=Mi,this.type===rl?(B.map.depthTexture.compareFunction=Z?Vh:zh,B.map.depthTexture.minFilter=$t,B.map.depthTexture.magFilter=$t):(B.map.depthTexture.compareFunction=null,B.map.depthTexture.minFilter=Xt,B.map.depthTexture.magFilter=Xt);B.camera.updateProjectionMatrix()}let Y=B.map.isWebGLCubeRenderTarget?6:1;for(let se=0;se<Y;se++){if(B.map.isWebGLCubeRenderTarget)n.setRenderTarget(B.map,se),n.clear();else{se===0&&(n.setRenderTarget(B.map),n.clear());let ue=B.getViewport(se);o.set(s.x*ue.x,s.y*ue.y,s.x*ue.z,s.y*ue.w),I.viewport(o)}if(N.isPointLight){let ue=B.camera,Be=B.matrix,Ie=N.distance||ue.far;Ie!==ue.far&&(ue.far=Ie,ue.updateProjectionMatrix()),pl.setFromMatrixPosition(N.matrixWorld),ue.position.copy(pl),Xm.copy(ue.position),Xm.add(rC[se]),ue.up.copy(sC[se]),ue.lookAt(Xm),ue.updateMatrixWorld(),Be.makeTranslation(-pl.x,-pl.y,-pl.z),I_.multiplyMatrices(ue.projectionMatrix,ue.matrixWorldInverse),B._frustum.setFromProjectionMatrix(I_,ue.coordinateSystem,ue.reversedDepth)}else B.updateMatrices(N);i=B.getFrustum(),S(T,x,B.camera,N,this.type)}B.isPointLightShadow!==!0&&this.type===So&&v(B,x),B.needsUpdate=!1}m=this.type,y.needsUpdate=!1,n.setRenderTarget(w,C,A)};function v(M,T){let x=e.update(_);h.defines.VSM_SAMPLES!==M.blurSamples&&(h.defines.VSM_SAMPLES=M.blurSamples,d.defines.VSM_SAMPLES=M.blurSamples,h.needsUpdate=!0,d.needsUpdate=!0),M.mapPass===null&&(M.mapPass=new Nn(r.x,r.y,{format:kr,type:bi})),h.uniforms.shadow_pass.value=M.map.depthTexture,h.uniforms.resolution.value=M.mapSize,h.uniforms.radius.value=M.radius,n.setRenderTarget(M.mapPass),n.clear(),n.renderBufferDirect(T,null,x,h,_,null),d.uniforms.shadow_pass.value=M.mapPass.texture,d.uniforms.resolution.value=M.mapSize,d.uniforms.radius.value=M.radius,n.setRenderTarget(M.map),n.clear(),n.renderBufferDirect(T,null,x,d,_,null)}function g(M,T,x,w){let C=null,A=x.isPointLight===!0?M.customDistanceMaterial:M.customDepthMaterial;if(A!==void 0)C=A;else if(C=x.isPointLight===!0?l:a,n.localClippingEnabled&&T.clipShadows===!0&&Array.isArray(T.clippingPlanes)&&T.clippingPlanes.length!==0||T.displacementMap&&T.displacementScale!==0||T.alphaMap&&T.alphaTest>0||T.map&&T.alphaTest>0||T.alphaToCoverage===!0){let I=C.uuid,D=T.uuid,F=u[I];F===void 0&&(F={},u[I]=F);let L=F[D];L===void 0&&(L=C.clone(),F[D]=L,T.addEventListener("dispose",E)),C=L}if(C.visible=T.visible,C.wireframe=T.wireframe,w===So?C.side=T.shadowSide!==null?T.shadowSide:T.side:C.side=T.shadowSide!==null?T.shadowSide:c[T.side],C.alphaMap=T.alphaMap,C.alphaTest=T.alphaToCoverage===!0?.5:T.alphaTest,C.map=T.map,C.clipShadows=T.clipShadows,C.clippingPlanes=T.clippingPlanes,C.clipIntersection=T.clipIntersection,C.displacementMap=T.displacementMap,C.displacementScale=T.displacementScale,C.displacementBias=T.displacementBias,C.wireframeLinewidth=T.wireframeLinewidth,C.linewidth=T.linewidth,x.isPointLight===!0&&C.isMeshDistanceMaterial===!0){let I=n.properties.get(C);I.light=x}return C}function S(M,T,x,w,C){if(M.visible===!1)return;if(M.layers.test(T.layers)&&(M.isMesh||M.isLine||M.isPoints)&&(M.castShadow||M.receiveShadow&&C===So)&&(!M.frustumCulled||i.intersectsObject(M))){M.modelViewMatrix.multiplyMatrices(x.matrixWorldInverse,M.matrixWorld);let D=e.update(M),F=M.material;if(Array.isArray(F)){let L=D.groups;for(let N=0,B=L.length;N<B;N++){let H=L[N],Z=F[H.materialIndex];if(Z&&Z.visible){let Y=g(M,Z,w,C);M.onBeforeShadow(n,M,T,x,D,Y,H),n.renderBufferDirect(x,null,D,Y,M,H),M.onAfterShadow(n,M,T,x,D,Y,H)}}}else if(F.visible){let L=g(M,F,w,C);M.onBeforeShadow(n,M,T,x,D,L,null),n.renderBufferDirect(x,null,D,L,M,null),M.onAfterShadow(n,M,T,x,D,L,null)}}let I=M.children;for(let D=0,F=I.length;D<F;D++)S(I[D],T,x,w,C)}function E(M){M.target.removeEventListener("dispose",E);for(let x in u){let w=u[x],C=M.target.uuid;C in w&&(w[C].dispose(),delete w[C])}}}function aC(n,e){function t(){let O=!1,he=new bt,ee=null,we=new bt(0,0,0,0);return{setMask:function(pe){ee!==pe&&!O&&(n.colorMask(pe,pe,pe,pe),ee=pe)},setLocked:function(pe){O=pe},setClear:function(pe,oe,Oe,Ze,It){It===!0&&(pe*=Ze,oe*=Ze,Oe*=Ze),he.set(pe,oe,Oe,Ze),we.equals(he)===!1&&(n.clearColor(pe,oe,Oe,Ze),we.copy(he))},reset:function(){O=!1,ee=null,we.set(-1,0,0,0)}}}function i(){let O=!1,he=!1,ee=null,we=null,pe=null;return{setReversed:function(oe){if(he!==oe){let Oe=e.get("EXT_clip_control");oe?Oe.clipControlEXT(Oe.LOWER_LEFT_EXT,Oe.ZERO_TO_ONE_EXT):Oe.clipControlEXT(Oe.LOWER_LEFT_EXT,Oe.NEGATIVE_ONE_TO_ONE_EXT),he=oe;let Ze=pe;pe=null,this.setClear(Ze)}},getReversed:function(){return he},setTest:function(oe){oe?ae(n.DEPTH_TEST):Ae(n.DEPTH_TEST)},setMask:function(oe){ee!==oe&&!O&&(n.depthMask(oe),ee=oe)},setFunc:function(oe){if(he&&(oe=n_[oe]),we!==oe){switch(oe){case du:n.depthFunc(n.NEVER);break;case pu:n.depthFunc(n.ALWAYS);break;case mu:n.depthFunc(n.LESS);break;case cs:n.depthFunc(n.LEQUAL);break;case gu:n.depthFunc(n.EQUAL);break;case vu:n.depthFunc(n.GEQUAL);break;case xu:n.depthFunc(n.GREATER);break;case yu:n.depthFunc(n.NOTEQUAL);break;default:n.depthFunc(n.LEQUAL)}we=oe}},setLocked:function(oe){O=oe},setClear:function(oe){pe!==oe&&(pe=oe,he&&(oe=1-oe),n.clearDepth(oe))},reset:function(){O=!1,ee=null,we=null,pe=null,he=!1}}}function r(){let O=!1,he=null,ee=null,we=null,pe=null,oe=null,Oe=null,Ze=null,It=null;return{setTest:function(ut){O||(ut?ae(n.STENCIL_TEST):Ae(n.STENCIL_TEST))},setMask:function(ut){he!==ut&&!O&&(n.stencilMask(ut),he=ut)},setFunc:function(ut,Pi,hi){(ee!==ut||we!==Pi||pe!==hi)&&(n.stencilFunc(ut,Pi,hi),ee=ut,we=Pi,pe=hi)},setOp:function(ut,Pi,hi){(oe!==ut||Oe!==Pi||Ze!==hi)&&(n.stencilOp(ut,Pi,hi),oe=ut,Oe=Pi,Ze=hi)},setLocked:function(ut){O=ut},setClear:function(ut){It!==ut&&(n.clearStencil(ut),It=ut)},reset:function(){O=!1,he=null,ee=null,we=null,pe=null,oe=null,Oe=null,Ze=null,It=null}}}let s=new t,o=new i,a=new r,l=new WeakMap,u=new WeakMap,f={},c={},h={},d=new WeakMap,p=[],_=null,y=!1,m=null,v=null,g=null,S=null,E=null,M=null,T=null,x=new nt(0,0,0),w=0,C=!1,A=null,I=null,D=null,F=null,L=null,N=n.getParameter(n.MAX_COMBINED_TEXTURE_IMAGE_UNITS),B=!1,H=0,Z=n.getParameter(n.VERSION);Z.indexOf("WebGL")!==-1?(H=parseFloat(/^WebGL (\d)/.exec(Z)[1]),B=H>=1):Z.indexOf("OpenGL ES")!==-1&&(H=parseFloat(/^OpenGL ES (\d)/.exec(Z)[1]),B=H>=2);let Y=null,se={},ue=n.getParameter(n.SCISSOR_BOX),Be=n.getParameter(n.VIEWPORT),Ie=new bt().fromArray(ue),Ue=new bt().fromArray(Be);function J(O,he,ee,we){let pe=new Uint8Array(4),oe=n.createTexture();n.bindTexture(O,oe),n.texParameteri(O,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(O,n.TEXTURE_MAG_FILTER,n.NEAREST);for(let Oe=0;Oe<ee;Oe++)O===n.TEXTURE_3D||O===n.TEXTURE_2D_ARRAY?n.texImage3D(he,0,n.RGBA,1,1,we,0,n.RGBA,n.UNSIGNED_BYTE,pe):n.texImage2D(he+Oe,0,n.RGBA,1,1,0,n.RGBA,n.UNSIGNED_BYTE,pe);return oe}let me={};me[n.TEXTURE_2D]=J(n.TEXTURE_2D,n.TEXTURE_2D,1),me[n.TEXTURE_CUBE_MAP]=J(n.TEXTURE_CUBE_MAP,n.TEXTURE_CUBE_MAP_POSITIVE_X,6),me[n.TEXTURE_2D_ARRAY]=J(n.TEXTURE_2D_ARRAY,n.TEXTURE_2D_ARRAY,1,1),me[n.TEXTURE_3D]=J(n.TEXTURE_3D,n.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),ae(n.DEPTH_TEST),o.setFunc(cs),ne(!1),ie(lm),ae(n.CULL_FACE),rt(Ai);function ae(O){f[O]!==!0&&(n.enable(O),f[O]=!0)}function Ae(O){f[O]!==!1&&(n.disable(O),f[O]=!1)}function be(O,he){return h[O]!==he?(n.bindFramebuffer(O,he),h[O]=he,O===n.DRAW_FRAMEBUFFER&&(h[n.FRAMEBUFFER]=he),O===n.FRAMEBUFFER&&(h[n.DRAW_FRAMEBUFFER]=he),!0):!1}function Fe(O,he){let ee=p,we=!1;if(O){ee=d.get(he),ee===void 0&&(ee=[],d.set(he,ee));let pe=O.textures;if(ee.length!==pe.length||ee[0]!==n.COLOR_ATTACHMENT0){for(let oe=0,Oe=pe.length;oe<Oe;oe++)ee[oe]=n.COLOR_ATTACHMENT0+oe;ee.length=pe.length,we=!0}}else ee[0]!==n.BACK&&(ee[0]=n.BACK,we=!0);we&&n.drawBuffers(ee)}function at(O){return _!==O?(n.useProgram(O),_=O,!0):!1}let qe={[Pr]:n.FUNC_ADD,[Ty]:n.FUNC_SUBTRACT,[Ay]:n.FUNC_REVERSE_SUBTRACT};qe[by]=n.MIN,qe[Cy]=n.MAX;let et={[Ry]:n.ZERO,[Py]:n.ONE,[Iy]:n.SRC_COLOR,[hu]:n.SRC_ALPHA,[Oy]:n.SRC_ALPHA_SATURATE,[Uy]:n.DST_COLOR,[Dy]:n.DST_ALPHA,[Ly]:n.ONE_MINUS_SRC_COLOR,[fu]:n.ONE_MINUS_SRC_ALPHA,[Fy]:n.ONE_MINUS_DST_COLOR,[Ny]:n.ONE_MINUS_DST_ALPHA,[By]:n.CONSTANT_COLOR,[ky]:n.ONE_MINUS_CONSTANT_COLOR,[zy]:n.CONSTANT_ALPHA,[Vy]:n.ONE_MINUS_CONSTANT_ALPHA};function rt(O,he,ee,we,pe,oe,Oe,Ze,It,ut){if(O===Ai){y===!0&&(Ae(n.BLEND),y=!1);return}if(y===!1&&(ae(n.BLEND),y=!0),O!==Ey){if(O!==m||ut!==C){if((v!==Pr||E!==Pr)&&(n.blendEquation(n.FUNC_ADD),v=Pr,E=Pr),ut)switch(O){case ls:n.blendFuncSeparate(n.ONE,n.ONE_MINUS_SRC_ALPHA,n.ONE,n.ONE_MINUS_SRC_ALPHA);break;case cm:n.blendFunc(n.ONE,n.ONE);break;case um:n.blendFuncSeparate(n.ZERO,n.ONE_MINUS_SRC_COLOR,n.ZERO,n.ONE);break;case hm:n.blendFuncSeparate(n.DST_COLOR,n.ONE_MINUS_SRC_ALPHA,n.ZERO,n.ONE);break;default:We("WebGLState: Invalid blending: ",O);break}else switch(O){case ls:n.blendFuncSeparate(n.SRC_ALPHA,n.ONE_MINUS_SRC_ALPHA,n.ONE,n.ONE_MINUS_SRC_ALPHA);break;case cm:n.blendFuncSeparate(n.SRC_ALPHA,n.ONE,n.ONE,n.ONE);break;case um:We("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case hm:We("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:We("WebGLState: Invalid blending: ",O);break}g=null,S=null,M=null,T=null,x.set(0,0,0),w=0,m=O,C=ut}return}pe=pe||he,oe=oe||ee,Oe=Oe||we,(he!==v||pe!==E)&&(n.blendEquationSeparate(qe[he],qe[pe]),v=he,E=pe),(ee!==g||we!==S||oe!==M||Oe!==T)&&(n.blendFuncSeparate(et[ee],et[we],et[oe],et[Oe]),g=ee,S=we,M=oe,T=Oe),(Ze.equals(x)===!1||It!==w)&&(n.blendColor(Ze.r,Ze.g,Ze.b,It),x.copy(Ze),w=It),m=O,C=!1}function G(O,he){O.side===Ti?Ae(n.CULL_FACE):ae(n.CULL_FACE);let ee=O.side===mn;he&&(ee=!ee),ne(ee),O.blending===ls&&O.transparent===!1?rt(Ai):rt(O.blending,O.blendEquation,O.blendSrc,O.blendDst,O.blendEquationAlpha,O.blendSrcAlpha,O.blendDstAlpha,O.blendColor,O.blendAlpha,O.premultipliedAlpha),o.setFunc(O.depthFunc),o.setTest(O.depthTest),o.setMask(O.depthWrite),s.setMask(O.colorWrite);let we=O.stencilWrite;a.setTest(we),we&&(a.setMask(O.stencilWriteMask),a.setFunc(O.stencilFunc,O.stencilRef,O.stencilFuncMask),a.setOp(O.stencilFail,O.stencilZFail,O.stencilZPass)),U(O.polygonOffset,O.polygonOffsetFactor,O.polygonOffsetUnits),O.alphaToCoverage===!0?ae(n.SAMPLE_ALPHA_TO_COVERAGE):Ae(n.SAMPLE_ALPHA_TO_COVERAGE)}function ne(O){A!==O&&(O?n.frontFace(n.CW):n.frontFace(n.CCW),A=O)}function ie(O){O!==My?(ae(n.CULL_FACE),O!==I&&(O===lm?n.cullFace(n.BACK):O===wy?n.cullFace(n.FRONT):n.cullFace(n.FRONT_AND_BACK))):Ae(n.CULL_FACE),I=O}function ve(O){O!==D&&(B&&n.lineWidth(O),D=O)}function U(O,he,ee){O?(ae(n.POLYGON_OFFSET_FILL),(F!==he||L!==ee)&&(F=he,L=ee,o.getReversed()&&(he=-he),n.polygonOffset(he,ee))):Ae(n.POLYGON_OFFSET_FILL)}function Ne(O){O?ae(n.SCISSOR_TEST):Ae(n.SCISSOR_TEST)}function Q(O){O===void 0&&(O=n.TEXTURE0+N-1),Y!==O&&(n.activeTexture(O),Y=O)}function xe(O,he,ee){ee===void 0&&(Y===null?ee=n.TEXTURE0+N-1:ee=Y);let we=se[ee];we===void 0&&(we={type:void 0,texture:void 0},se[ee]=we),(we.type!==O||we.texture!==he)&&(Y!==ee&&(n.activeTexture(ee),Y=ee),n.bindTexture(O,he||me[O]),we.type=O,we.texture=he)}function re(){let O=se[Y];O!==void 0&&O.type!==void 0&&(n.bindTexture(O.type,null),O.type=void 0,O.texture=void 0)}function Le(){try{n.compressedTexImage2D(...arguments)}catch(O){We("WebGLState:",O)}}function P(){try{n.compressedTexImage3D(...arguments)}catch(O){We("WebGLState:",O)}}function b(){try{n.texSubImage2D(...arguments)}catch(O){We("WebGLState:",O)}}function k(){try{n.texSubImage3D(...arguments)}catch(O){We("WebGLState:",O)}}function j(){try{n.compressedTexSubImage2D(...arguments)}catch(O){We("WebGLState:",O)}}function te(){try{n.compressedTexSubImage3D(...arguments)}catch(O){We("WebGLState:",O)}}function le(){try{n.texStorage2D(...arguments)}catch(O){We("WebGLState:",O)}}function ge(){try{n.texStorage3D(...arguments)}catch(O){We("WebGLState:",O)}}function $(){try{n.texImage2D(...arguments)}catch(O){We("WebGLState:",O)}}function K(){try{n.texImage3D(...arguments)}catch(O){We("WebGLState:",O)}}function ye(O){return c[O]!==void 0?c[O]:n.getParameter(O)}function Te(O,he){c[O]!==he&&(n.pixelStorei(O,he),c[O]=he)}function de(O){Ie.equals(O)===!1&&(n.scissor(O.x,O.y,O.z,O.w),Ie.copy(O))}function fe(O){Ue.equals(O)===!1&&(n.viewport(O.x,O.y,O.z,O.w),Ue.copy(O))}function Xe(O,he){let ee=u.get(he);ee===void 0&&(ee=new WeakMap,u.set(he,ee));let we=ee.get(O);we===void 0&&(we=n.getUniformBlockIndex(he,O.name),ee.set(O,we))}function ze(O,he){let we=u.get(he).get(O);l.get(he)!==we&&(n.uniformBlockBinding(he,we,O.__bindingPointIndex),l.set(he,we))}function He(){n.disable(n.BLEND),n.disable(n.CULL_FACE),n.disable(n.DEPTH_TEST),n.disable(n.POLYGON_OFFSET_FILL),n.disable(n.SCISSOR_TEST),n.disable(n.STENCIL_TEST),n.disable(n.SAMPLE_ALPHA_TO_COVERAGE),n.blendEquation(n.FUNC_ADD),n.blendFunc(n.ONE,n.ZERO),n.blendFuncSeparate(n.ONE,n.ZERO,n.ONE,n.ZERO),n.blendColor(0,0,0,0),n.colorMask(!0,!0,!0,!0),n.clearColor(0,0,0,0),n.depthMask(!0),n.depthFunc(n.LESS),o.setReversed(!1),n.clearDepth(1),n.stencilMask(4294967295),n.stencilFunc(n.ALWAYS,0,4294967295),n.stencilOp(n.KEEP,n.KEEP,n.KEEP),n.clearStencil(0),n.cullFace(n.BACK),n.frontFace(n.CCW),n.polygonOffset(0,0),n.activeTexture(n.TEXTURE0),n.bindFramebuffer(n.FRAMEBUFFER,null),n.bindFramebuffer(n.DRAW_FRAMEBUFFER,null),n.bindFramebuffer(n.READ_FRAMEBUFFER,null),n.useProgram(null),n.lineWidth(1),n.scissor(0,0,n.canvas.width,n.canvas.height),n.viewport(0,0,n.canvas.width,n.canvas.height),n.pixelStorei(n.PACK_ALIGNMENT,4),n.pixelStorei(n.UNPACK_ALIGNMENT,4),n.pixelStorei(n.UNPACK_FLIP_Y_WEBGL,!1),n.pixelStorei(n.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),n.pixelStorei(n.UNPACK_COLORSPACE_CONVERSION_WEBGL,n.BROWSER_DEFAULT_WEBGL),n.pixelStorei(n.PACK_ROW_LENGTH,0),n.pixelStorei(n.PACK_SKIP_PIXELS,0),n.pixelStorei(n.PACK_SKIP_ROWS,0),n.pixelStorei(n.UNPACK_ROW_LENGTH,0),n.pixelStorei(n.UNPACK_IMAGE_HEIGHT,0),n.pixelStorei(n.UNPACK_SKIP_PIXELS,0),n.pixelStorei(n.UNPACK_SKIP_ROWS,0),n.pixelStorei(n.UNPACK_SKIP_IMAGES,0),f={},c={},Y=null,se={},h={},d=new WeakMap,p=[],_=null,y=!1,m=null,v=null,g=null,S=null,E=null,M=null,T=null,x=new nt(0,0,0),w=0,C=!1,A=null,I=null,D=null,F=null,L=null,Ie.set(0,0,n.canvas.width,n.canvas.height),Ue.set(0,0,n.canvas.width,n.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:ae,disable:Ae,bindFramebuffer:be,drawBuffers:Fe,useProgram:at,setBlending:rt,setMaterial:G,setFlipSided:ne,setCullFace:ie,setLineWidth:ve,setPolygonOffset:U,setScissorTest:Ne,activeTexture:Q,bindTexture:xe,unbindTexture:re,compressedTexImage2D:Le,compressedTexImage3D:P,texImage2D:$,texImage3D:K,pixelStorei:Te,getParameter:ye,updateUBOMapping:Xe,uniformBlockBinding:ze,texStorage2D:le,texStorage3D:ge,texSubImage2D:b,texSubImage3D:k,compressedTexSubImage2D:j,compressedTexSubImage3D:te,scissor:de,viewport:fe,reset:He}}function lC(n,e,t,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),u=new Ee,f=new WeakMap,c=new Set,h,d=new WeakMap,p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function _(P,b){return p?new OffscreenCanvas(P,b):Da("canvas")}function y(P,b,k){let j=1,te=Le(P);if((te.width>k||te.height>k)&&(j=k/Math.max(te.width,te.height)),j<1)if(typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&P instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&P instanceof ImageBitmap||typeof VideoFrame<"u"&&P instanceof VideoFrame){let le=Math.floor(j*te.width),ge=Math.floor(j*te.height);h===void 0&&(h=_(le,ge));let $=b?_(le,ge):h;return $.width=le,$.height=ge,$.getContext("2d").drawImage(P,0,0,le,ge),Ge("WebGLRenderer: Texture has been resized from ("+te.width+"x"+te.height+") to ("+le+"x"+ge+")."),$}else return"data"in P&&Ge("WebGLRenderer: Image in DataTexture is too big ("+te.width+"x"+te.height+")."),P;return P}function m(P){return P.generateMipmaps}function v(P){n.generateMipmap(P)}function g(P){return P.isWebGLCubeRenderTarget?n.TEXTURE_CUBE_MAP:P.isWebGL3DRenderTarget?n.TEXTURE_3D:P.isWebGLArrayRenderTarget||P.isCompressedArrayTexture?n.TEXTURE_2D_ARRAY:n.TEXTURE_2D}function S(P,b,k,j,te,le=!1){if(P!==null){if(n[P]!==void 0)return n[P];Ge("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+P+"'")}let ge;j&&(ge=e.get("EXT_texture_norm16"),ge||Ge("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let $=b;if(b===n.RED&&(k===n.FLOAT&&($=n.R32F),k===n.HALF_FLOAT&&($=n.R16F),k===n.UNSIGNED_BYTE&&($=n.R8),k===n.UNSIGNED_SHORT&&ge&&($=ge.R16_EXT),k===n.SHORT&&ge&&($=ge.R16_SNORM_EXT)),b===n.RED_INTEGER&&(k===n.UNSIGNED_BYTE&&($=n.R8UI),k===n.UNSIGNED_SHORT&&($=n.R16UI),k===n.UNSIGNED_INT&&($=n.R32UI),k===n.BYTE&&($=n.R8I),k===n.SHORT&&($=n.R16I),k===n.INT&&($=n.R32I)),b===n.RG&&(k===n.FLOAT&&($=n.RG32F),k===n.HALF_FLOAT&&($=n.RG16F),k===n.UNSIGNED_BYTE&&($=n.RG8),k===n.UNSIGNED_SHORT&&ge&&($=ge.RG16_EXT),k===n.SHORT&&ge&&($=ge.RG16_SNORM_EXT)),b===n.RG_INTEGER&&(k===n.UNSIGNED_BYTE&&($=n.RG8UI),k===n.UNSIGNED_SHORT&&($=n.RG16UI),k===n.UNSIGNED_INT&&($=n.RG32UI),k===n.BYTE&&($=n.RG8I),k===n.SHORT&&($=n.RG16I),k===n.INT&&($=n.RG32I)),b===n.RGB_INTEGER&&(k===n.UNSIGNED_BYTE&&($=n.RGB8UI),k===n.UNSIGNED_SHORT&&($=n.RGB16UI),k===n.UNSIGNED_INT&&($=n.RGB32UI),k===n.BYTE&&($=n.RGB8I),k===n.SHORT&&($=n.RGB16I),k===n.INT&&($=n.RGB32I)),b===n.RGBA_INTEGER&&(k===n.UNSIGNED_BYTE&&($=n.RGBA8UI),k===n.UNSIGNED_SHORT&&($=n.RGBA16UI),k===n.UNSIGNED_INT&&($=n.RGBA32UI),k===n.BYTE&&($=n.RGBA8I),k===n.SHORT&&($=n.RGBA16I),k===n.INT&&($=n.RGBA32I)),b===n.RGB&&(k===n.UNSIGNED_SHORT&&ge&&($=ge.RGB16_EXT),k===n.SHORT&&ge&&($=ge.RGB16_SNORM_EXT),k===n.UNSIGNED_INT_5_9_9_9_REV&&($=n.RGB9_E5),k===n.UNSIGNED_INT_10F_11F_11F_REV&&($=n.R11F_G11F_B10F)),b===n.RGBA){let K=le?La:tt.getTransfer(te);k===n.FLOAT&&($=n.RGBA32F),k===n.HALF_FLOAT&&($=n.RGBA16F),k===n.UNSIGNED_BYTE&&($=K===lt?n.SRGB8_ALPHA8:n.RGBA8),k===n.UNSIGNED_SHORT&&ge&&($=ge.RGBA16_EXT),k===n.SHORT&&ge&&($=ge.RGBA16_SNORM_EXT),k===n.UNSIGNED_SHORT_4_4_4_4&&($=n.RGBA4),k===n.UNSIGNED_SHORT_5_5_5_1&&($=n.RGB5_A1)}return($===n.R16F||$===n.R32F||$===n.RG16F||$===n.RG32F||$===n.RGBA16F||$===n.RGBA32F)&&e.get("EXT_color_buffer_float"),$}function E(P,b){let k;return P?b===null||b===ci||b===wo?k=n.DEPTH24_STENCIL8:b===ui?k=n.DEPTH32F_STENCIL8:b===Mo&&(k=n.DEPTH24_STENCIL8,Ge("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):b===null||b===ci||b===wo?k=n.DEPTH_COMPONENT24:b===ui?k=n.DEPTH_COMPONENT32F:b===Mo&&(k=n.DEPTH_COMPONENT16),k}function M(P,b){return m(P)===!0||P.isFramebufferTexture&&P.minFilter!==Xt&&P.minFilter!==$t?Math.log2(Math.max(b.width,b.height))+1:P.mipmaps!==void 0&&P.mipmaps.length>0?P.mipmaps.length:P.isCompressedTexture&&Array.isArray(P.image)?b.mipmaps.length:1}function T(P){let b=P.target;b.removeEventListener("dispose",T),w(b),b.isVideoTexture&&f.delete(b),b.isHTMLTexture&&c.delete(b)}function x(P){let b=P.target;b.removeEventListener("dispose",x),A(b)}function w(P){let b=i.get(P);if(b.__webglInit===void 0)return;let k=P.source,j=d.get(k);if(j){let te=j[b.__cacheKey];te.usedTimes--,te.usedTimes===0&&C(P),Object.keys(j).length===0&&d.delete(k)}i.remove(P)}function C(P){let b=i.get(P);n.deleteTexture(b.__webglTexture);let k=P.source,j=d.get(k);delete j[b.__cacheKey],o.memory.textures--}function A(P){let b=i.get(P);if(P.depthTexture&&(P.depthTexture.dispose(),i.remove(P.depthTexture)),P.isWebGLCubeRenderTarget)for(let j=0;j<6;j++){if(Array.isArray(b.__webglFramebuffer[j]))for(let te=0;te<b.__webglFramebuffer[j].length;te++)n.deleteFramebuffer(b.__webglFramebuffer[j][te]);else n.deleteFramebuffer(b.__webglFramebuffer[j]);b.__webglDepthbuffer&&n.deleteRenderbuffer(b.__webglDepthbuffer[j])}else{if(Array.isArray(b.__webglFramebuffer))for(let j=0;j<b.__webglFramebuffer.length;j++)n.deleteFramebuffer(b.__webglFramebuffer[j]);else n.deleteFramebuffer(b.__webglFramebuffer);if(b.__webglDepthbuffer&&n.deleteRenderbuffer(b.__webglDepthbuffer),b.__webglMultisampledFramebuffer&&n.deleteFramebuffer(b.__webglMultisampledFramebuffer),b.__webglColorRenderbuffer)for(let j=0;j<b.__webglColorRenderbuffer.length;j++)b.__webglColorRenderbuffer[j]&&n.deleteRenderbuffer(b.__webglColorRenderbuffer[j]);b.__webglDepthRenderbuffer&&n.deleteRenderbuffer(b.__webglDepthRenderbuffer)}let k=P.textures;for(let j=0,te=k.length;j<te;j++){let le=i.get(k[j]);le.__webglTexture&&(n.deleteTexture(le.__webglTexture),o.memory.textures--),i.remove(k[j])}i.remove(P)}let I=0;function D(){I=0}function F(){return I}function L(P){I=P}function N(){let P=I;return P>=r.maxTextures&&Ge("WebGLTextures: Trying to use "+P+" texture units while this GPU supports only "+r.maxTextures),I+=1,P}function B(P){let b=[];return b.push(P.wrapS),b.push(P.wrapT),b.push(P.wrapR||0),b.push(P.magFilter),b.push(P.minFilter),b.push(P.anisotropy),b.push(P.internalFormat),b.push(P.format),b.push(P.type),b.push(P.generateMipmaps),b.push(P.premultiplyAlpha),b.push(P.flipY),b.push(P.unpackAlignment),b.push(P.colorSpace),b.join()}function H(P,b){let k=i.get(P);if(P.isVideoTexture&&xe(P),P.isRenderTargetTexture===!1&&P.isExternalTexture!==!0&&P.version>0&&k.__version!==P.version){let j=P.image;if(j===null)Ge("WebGLRenderer: Texture marked for update but no image data found.");else if(j.complete===!1)Ge("WebGLRenderer: Texture marked for update but image is incomplete");else{Ae(k,P,b);return}}else P.isExternalTexture&&(k.__webglTexture=P.sourceTexture?P.sourceTexture:null);t.bindTexture(n.TEXTURE_2D,k.__webglTexture,n.TEXTURE0+b)}function Z(P,b){let k=i.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&k.__version!==P.version){Ae(k,P,b);return}else P.isExternalTexture&&(k.__webglTexture=P.sourceTexture?P.sourceTexture:null);t.bindTexture(n.TEXTURE_2D_ARRAY,k.__webglTexture,n.TEXTURE0+b)}function Y(P,b){let k=i.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&k.__version!==P.version){Ae(k,P,b);return}t.bindTexture(n.TEXTURE_3D,k.__webglTexture,n.TEXTURE0+b)}function se(P,b){let k=i.get(P);if(P.isCubeDepthTexture!==!0&&P.version>0&&k.__version!==P.version){be(k,P,b);return}t.bindTexture(n.TEXTURE_CUBE_MAP,k.__webglTexture,n.TEXTURE0+b)}let ue={[_u]:n.REPEAT,[Si]:n.CLAMP_TO_EDGE,[Su]:n.MIRRORED_REPEAT},Be={[Xt]:n.NEAREST,[Wy]:n.NEAREST_MIPMAP_NEAREST,[ol]:n.NEAREST_MIPMAP_LINEAR,[$t]:n.LINEAR,[nh]:n.LINEAR_MIPMAP_NEAREST,[Or]:n.LINEAR_MIPMAP_LINEAR},Ie={[qy]:n.NEVER,[jy]:n.ALWAYS,[Zy]:n.LESS,[zh]:n.LEQUAL,[$y]:n.EQUAL,[Vh]:n.GEQUAL,[Jy]:n.GREATER,[Ky]:n.NOTEQUAL};function Ue(P,b){if(b.type===ui&&e.has("OES_texture_float_linear")===!1&&(b.magFilter===$t||b.magFilter===nh||b.magFilter===ol||b.magFilter===Or||b.minFilter===$t||b.minFilter===nh||b.minFilter===ol||b.minFilter===Or)&&Ge("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),n.texParameteri(P,n.TEXTURE_WRAP_S,ue[b.wrapS]),n.texParameteri(P,n.TEXTURE_WRAP_T,ue[b.wrapT]),(P===n.TEXTURE_3D||P===n.TEXTURE_2D_ARRAY)&&n.texParameteri(P,n.TEXTURE_WRAP_R,ue[b.wrapR]),n.texParameteri(P,n.TEXTURE_MAG_FILTER,Be[b.magFilter]),n.texParameteri(P,n.TEXTURE_MIN_FILTER,Be[b.minFilter]),b.compareFunction&&(n.texParameteri(P,n.TEXTURE_COMPARE_MODE,n.COMPARE_REF_TO_TEXTURE),n.texParameteri(P,n.TEXTURE_COMPARE_FUNC,Ie[b.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(b.magFilter===Xt||b.minFilter!==ol&&b.minFilter!==Or||b.type===ui&&e.has("OES_texture_float_linear")===!1)return;if(b.anisotropy>1||i.get(b).__currentAnisotropy){let k=e.get("EXT_texture_filter_anisotropic");n.texParameterf(P,k.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(b.anisotropy,r.getMaxAnisotropy())),i.get(b).__currentAnisotropy=b.anisotropy}}}function J(P,b){let k=!1;P.__webglInit===void 0&&(P.__webglInit=!0,b.addEventListener("dispose",T));let j=b.source,te=d.get(j);te===void 0&&(te={},d.set(j,te));let le=B(b);if(le!==P.__cacheKey){te[le]===void 0&&(te[le]={texture:n.createTexture(),usedTimes:0},o.memory.textures++,k=!0),te[le].usedTimes++;let ge=te[P.__cacheKey];ge!==void 0&&(te[P.__cacheKey].usedTimes--,ge.usedTimes===0&&C(b)),P.__cacheKey=le,P.__webglTexture=te[le].texture}return k}function me(P,b,k){return Math.floor(Math.floor(P/k)/b)}function ae(P,b,k,j){let le=P.updateRanges;if(le.length===0)t.texSubImage2D(n.TEXTURE_2D,0,0,0,b.width,b.height,k,j,b.data);else{le.sort((Te,de)=>Te.start-de.start);let ge=0;for(let Te=1;Te<le.length;Te++){let de=le[ge],fe=le[Te],Xe=de.start+de.count,ze=me(fe.start,b.width,4),He=me(de.start,b.width,4);fe.start<=Xe+1&&ze===He&&me(fe.start+fe.count-1,b.width,4)===ze?de.count=Math.max(de.count,fe.start+fe.count-de.start):(++ge,le[ge]=fe)}le.length=ge+1;let $=t.getParameter(n.UNPACK_ROW_LENGTH),K=t.getParameter(n.UNPACK_SKIP_PIXELS),ye=t.getParameter(n.UNPACK_SKIP_ROWS);t.pixelStorei(n.UNPACK_ROW_LENGTH,b.width);for(let Te=0,de=le.length;Te<de;Te++){let fe=le[Te],Xe=Math.floor(fe.start/4),ze=Math.ceil(fe.count/4),He=Xe%b.width,O=Math.floor(Xe/b.width),he=ze,ee=1;t.pixelStorei(n.UNPACK_SKIP_PIXELS,He),t.pixelStorei(n.UNPACK_SKIP_ROWS,O),t.texSubImage2D(n.TEXTURE_2D,0,He,O,he,ee,k,j,b.data)}P.clearUpdateRanges(),t.pixelStorei(n.UNPACK_ROW_LENGTH,$),t.pixelStorei(n.UNPACK_SKIP_PIXELS,K),t.pixelStorei(n.UNPACK_SKIP_ROWS,ye)}}function Ae(P,b,k){let j=n.TEXTURE_2D;(b.isDataArrayTexture||b.isCompressedArrayTexture)&&(j=n.TEXTURE_2D_ARRAY),b.isData3DTexture&&(j=n.TEXTURE_3D);let te=J(P,b),le=b.source;t.bindTexture(j,P.__webglTexture,n.TEXTURE0+k);let ge=i.get(le);if(le.version!==ge.__version||te===!0){if(t.activeTexture(n.TEXTURE0+k),(typeof ImageBitmap<"u"&&b.image instanceof ImageBitmap)===!1){let ee=tt.getPrimaries(tt.workingColorSpace),we=b.colorSpace===ji?null:tt.getPrimaries(b.colorSpace),pe=b.colorSpace===ji||ee===we?n.NONE:n.BROWSER_DEFAULT_WEBGL;t.pixelStorei(n.UNPACK_FLIP_Y_WEBGL,b.flipY),t.pixelStorei(n.UNPACK_PREMULTIPLY_ALPHA_WEBGL,b.premultiplyAlpha),t.pixelStorei(n.UNPACK_COLORSPACE_CONVERSION_WEBGL,pe)}t.pixelStorei(n.UNPACK_ALIGNMENT,b.unpackAlignment);let K=y(b.image,!1,r.maxTextureSize);K=re(b,K);let ye=s.convert(b.format,b.colorSpace),Te=s.convert(b.type),de=S(b.internalFormat,ye,Te,b.normalized,b.colorSpace,b.isVideoTexture);Ue(j,b);let fe,Xe=b.mipmaps,ze=b.isVideoTexture!==!0,He=ge.__version===void 0||te===!0,O=le.dataReady,he=M(b,K);if(b.isDepthTexture)de=E(b.format===Br,b.type),He&&(ze?t.texStorage2D(n.TEXTURE_2D,1,de,K.width,K.height):t.texImage2D(n.TEXTURE_2D,0,de,K.width,K.height,0,ye,Te,null));else if(b.isDataTexture)if(Xe.length>0){ze&&He&&t.texStorage2D(n.TEXTURE_2D,he,de,Xe[0].width,Xe[0].height);for(let ee=0,we=Xe.length;ee<we;ee++)fe=Xe[ee],ze?O&&t.texSubImage2D(n.TEXTURE_2D,ee,0,0,fe.width,fe.height,ye,Te,fe.data):t.texImage2D(n.TEXTURE_2D,ee,de,fe.width,fe.height,0,ye,Te,fe.data);b.generateMipmaps=!1}else ze?(He&&t.texStorage2D(n.TEXTURE_2D,he,de,K.width,K.height),O&&ae(b,K,ye,Te)):t.texImage2D(n.TEXTURE_2D,0,de,K.width,K.height,0,ye,Te,K.data);else if(b.isCompressedTexture)if(b.isCompressedArrayTexture){ze&&He&&t.texStorage3D(n.TEXTURE_2D_ARRAY,he,de,Xe[0].width,Xe[0].height,K.depth);for(let ee=0,we=Xe.length;ee<we;ee++)if(fe=Xe[ee],b.format!==$n)if(ye!==null)if(ze){if(O)if(b.layerUpdates.size>0){let pe=Nm(fe.width,fe.height,b.format,b.type);for(let oe of b.layerUpdates){let Oe=fe.data.subarray(oe*pe/fe.data.BYTES_PER_ELEMENT,(oe+1)*pe/fe.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(n.TEXTURE_2D_ARRAY,ee,0,0,oe,fe.width,fe.height,1,ye,Oe)}b.clearLayerUpdates()}else t.compressedTexSubImage3D(n.TEXTURE_2D_ARRAY,ee,0,0,0,fe.width,fe.height,K.depth,ye,fe.data)}else t.compressedTexImage3D(n.TEXTURE_2D_ARRAY,ee,de,fe.width,fe.height,K.depth,0,fe.data,0,0);else Ge("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else ze?O&&t.texSubImage3D(n.TEXTURE_2D_ARRAY,ee,0,0,0,fe.width,fe.height,K.depth,ye,Te,fe.data):t.texImage3D(n.TEXTURE_2D_ARRAY,ee,de,fe.width,fe.height,K.depth,0,ye,Te,fe.data)}else{ze&&He&&t.texStorage2D(n.TEXTURE_2D,he,de,Xe[0].width,Xe[0].height);for(let ee=0,we=Xe.length;ee<we;ee++)fe=Xe[ee],b.format!==$n?ye!==null?ze?O&&t.compressedTexSubImage2D(n.TEXTURE_2D,ee,0,0,fe.width,fe.height,ye,fe.data):t.compressedTexImage2D(n.TEXTURE_2D,ee,de,fe.width,fe.height,0,fe.data):Ge("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):ze?O&&t.texSubImage2D(n.TEXTURE_2D,ee,0,0,fe.width,fe.height,ye,Te,fe.data):t.texImage2D(n.TEXTURE_2D,ee,de,fe.width,fe.height,0,ye,Te,fe.data)}else if(b.isDataArrayTexture)if(ze){if(He&&t.texStorage3D(n.TEXTURE_2D_ARRAY,he,de,K.width,K.height,K.depth),O)if(b.layerUpdates.size>0){let ee=Nm(K.width,K.height,b.format,b.type);for(let we of b.layerUpdates){let pe=K.data.subarray(we*ee/K.data.BYTES_PER_ELEMENT,(we+1)*ee/K.data.BYTES_PER_ELEMENT);t.texSubImage3D(n.TEXTURE_2D_ARRAY,0,0,0,we,K.width,K.height,1,ye,Te,pe)}b.clearLayerUpdates()}else t.texSubImage3D(n.TEXTURE_2D_ARRAY,0,0,0,0,K.width,K.height,K.depth,ye,Te,K.data)}else t.texImage3D(n.TEXTURE_2D_ARRAY,0,de,K.width,K.height,K.depth,0,ye,Te,K.data);else if(b.isData3DTexture)ze?(He&&t.texStorage3D(n.TEXTURE_3D,he,de,K.width,K.height,K.depth),O&&t.texSubImage3D(n.TEXTURE_3D,0,0,0,0,K.width,K.height,K.depth,ye,Te,K.data)):t.texImage3D(n.TEXTURE_3D,0,de,K.width,K.height,K.depth,0,ye,Te,K.data);else if(b.isFramebufferTexture){if(He)if(ze)t.texStorage2D(n.TEXTURE_2D,he,de,K.width,K.height);else{let ee=K.width,we=K.height;for(let pe=0;pe<he;pe++)t.texImage2D(n.TEXTURE_2D,pe,de,ee,we,0,ye,Te,null),ee>>=1,we>>=1}}else if(b.isHTMLTexture){if("texElementImage2D"in n){let ee=n.canvas;if(ee.hasAttribute("layoutsubtree")||ee.setAttribute("layoutsubtree","true"),K.parentNode!==ee){ee.appendChild(K),c.add(b),ee.onpaint=Ze=>{let It=Ze.changedElements;for(let ut of c)It.includes(ut.image)&&(ut.needsUpdate=!0)},ee.requestPaint();return}let we=0,pe=n.RGBA,oe=n.RGBA,Oe=n.UNSIGNED_BYTE;n.texElementImage2D(n.TEXTURE_2D,we,pe,oe,Oe,K),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}}else if(Xe.length>0){if(ze&&He){let ee=Le(Xe[0]);t.texStorage2D(n.TEXTURE_2D,he,de,ee.width,ee.height)}for(let ee=0,we=Xe.length;ee<we;ee++)fe=Xe[ee],ze?O&&t.texSubImage2D(n.TEXTURE_2D,ee,0,0,ye,Te,fe):t.texImage2D(n.TEXTURE_2D,ee,de,ye,Te,fe);b.generateMipmaps=!1}else if(ze){if(He){let ee=Le(K);t.texStorage2D(n.TEXTURE_2D,he,de,ee.width,ee.height)}O&&t.texSubImage2D(n.TEXTURE_2D,0,0,0,ye,Te,K)}else t.texImage2D(n.TEXTURE_2D,0,de,ye,Te,K);m(b)&&v(j),ge.__version=le.version,b.onUpdate&&b.onUpdate(b)}P.__version=b.version}function be(P,b,k){if(b.image.length!==6)return;let j=J(P,b),te=b.source;t.bindTexture(n.TEXTURE_CUBE_MAP,P.__webglTexture,n.TEXTURE0+k);let le=i.get(te);if(te.version!==le.__version||j===!0){t.activeTexture(n.TEXTURE0+k);let ge=tt.getPrimaries(tt.workingColorSpace),$=b.colorSpace===ji?null:tt.getPrimaries(b.colorSpace),K=b.colorSpace===ji||ge===$?n.NONE:n.BROWSER_DEFAULT_WEBGL;t.pixelStorei(n.UNPACK_FLIP_Y_WEBGL,b.flipY),t.pixelStorei(n.UNPACK_PREMULTIPLY_ALPHA_WEBGL,b.premultiplyAlpha),t.pixelStorei(n.UNPACK_ALIGNMENT,b.unpackAlignment),t.pixelStorei(n.UNPACK_COLORSPACE_CONVERSION_WEBGL,K);let ye=b.isCompressedTexture||b.image[0].isCompressedTexture,Te=b.image[0]&&b.image[0].isDataTexture,de=[];for(let oe=0;oe<6;oe++)!ye&&!Te?de[oe]=y(b.image[oe],!0,r.maxCubemapSize):de[oe]=Te?b.image[oe].image:b.image[oe],de[oe]=re(b,de[oe]);let fe=de[0],Xe=s.convert(b.format,b.colorSpace),ze=s.convert(b.type),He=S(b.internalFormat,Xe,ze,b.normalized,b.colorSpace),O=b.isVideoTexture!==!0,he=le.__version===void 0||j===!0,ee=te.dataReady,we=M(b,fe);Ue(n.TEXTURE_CUBE_MAP,b);let pe;if(ye){O&&he&&t.texStorage2D(n.TEXTURE_CUBE_MAP,we,He,fe.width,fe.height);for(let oe=0;oe<6;oe++){pe=de[oe].mipmaps;for(let Oe=0;Oe<pe.length;Oe++){let Ze=pe[Oe];b.format!==$n?Xe!==null?O?ee&&t.compressedTexSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Oe,0,0,Ze.width,Ze.height,Xe,Ze.data):t.compressedTexImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Oe,He,Ze.width,Ze.height,0,Ze.data):Ge("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):O?ee&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Oe,0,0,Ze.width,Ze.height,Xe,ze,Ze.data):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Oe,He,Ze.width,Ze.height,0,Xe,ze,Ze.data)}}}else{if(pe=b.mipmaps,O&&he){pe.length>0&&we++;let oe=Le(de[0]);t.texStorage2D(n.TEXTURE_CUBE_MAP,we,He,oe.width,oe.height)}for(let oe=0;oe<6;oe++)if(Te){O?ee&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,de[oe].width,de[oe].height,Xe,ze,de[oe].data):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,He,de[oe].width,de[oe].height,0,Xe,ze,de[oe].data);for(let Oe=0;Oe<pe.length;Oe++){let It=pe[Oe].image[oe].image;O?ee&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Oe+1,0,0,It.width,It.height,Xe,ze,It.data):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Oe+1,He,It.width,It.height,0,Xe,ze,It.data)}}else{O?ee&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,Xe,ze,de[oe]):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,He,Xe,ze,de[oe]);for(let Oe=0;Oe<pe.length;Oe++){let Ze=pe[Oe];O?ee&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Oe+1,0,0,Xe,ze,Ze.image[oe]):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+oe,Oe+1,He,Xe,ze,Ze.image[oe])}}}m(b)&&v(n.TEXTURE_CUBE_MAP),le.__version=te.version,b.onUpdate&&b.onUpdate(b)}P.__version=b.version}function Fe(P,b,k,j,te,le){let ge=s.convert(k.format,k.colorSpace),$=s.convert(k.type),K=S(k.internalFormat,ge,$,k.normalized,k.colorSpace),ye=i.get(b),Te=i.get(k);if(Te.__renderTarget=b,!ye.__hasExternalTextures){let de=Math.max(1,b.width>>le),fe=Math.max(1,b.height>>le);te===n.TEXTURE_3D||te===n.TEXTURE_2D_ARRAY?t.texImage3D(te,le,K,de,fe,b.depth,0,ge,$,null):t.texImage2D(te,le,K,de,fe,0,ge,$,null)}t.bindFramebuffer(n.FRAMEBUFFER,P),Q(b)?a.framebufferTexture2DMultisampleEXT(n.FRAMEBUFFER,j,te,Te.__webglTexture,0,Ne(b)):(te===n.TEXTURE_2D||te>=n.TEXTURE_CUBE_MAP_POSITIVE_X&&te<=n.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&n.framebufferTexture2D(n.FRAMEBUFFER,j,te,Te.__webglTexture,le),t.bindFramebuffer(n.FRAMEBUFFER,null)}function at(P,b,k){if(n.bindRenderbuffer(n.RENDERBUFFER,P),b.depthBuffer){let j=b.depthTexture,te=j&&j.isDepthTexture?j.type:null,le=E(b.stencilBuffer,te),ge=b.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT;Q(b)?a.renderbufferStorageMultisampleEXT(n.RENDERBUFFER,Ne(b),le,b.width,b.height):k?n.renderbufferStorageMultisample(n.RENDERBUFFER,Ne(b),le,b.width,b.height):n.renderbufferStorage(n.RENDERBUFFER,le,b.width,b.height),n.framebufferRenderbuffer(n.FRAMEBUFFER,ge,n.RENDERBUFFER,P)}else{let j=b.textures;for(let te=0;te<j.length;te++){let le=j[te],ge=s.convert(le.format,le.colorSpace),$=s.convert(le.type),K=S(le.internalFormat,ge,$,le.normalized,le.colorSpace);Q(b)?a.renderbufferStorageMultisampleEXT(n.RENDERBUFFER,Ne(b),K,b.width,b.height):k?n.renderbufferStorageMultisample(n.RENDERBUFFER,Ne(b),K,b.width,b.height):n.renderbufferStorage(n.RENDERBUFFER,K,b.width,b.height)}}n.bindRenderbuffer(n.RENDERBUFFER,null)}function qe(P,b,k){let j=b.isWebGLCubeRenderTarget===!0;if(t.bindFramebuffer(n.FRAMEBUFFER,P),!(b.depthTexture&&b.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let te=i.get(b.depthTexture);if(te.__renderTarget=b,(!te.__webglTexture||b.depthTexture.image.width!==b.width||b.depthTexture.image.height!==b.height)&&(b.depthTexture.image.width=b.width,b.depthTexture.image.height=b.height,b.depthTexture.needsUpdate=!0),j){if(te.__webglInit===void 0&&(te.__webglInit=!0,b.depthTexture.addEventListener("dispose",T)),te.__webglTexture===void 0){te.__webglTexture=n.createTexture(),t.bindTexture(n.TEXTURE_CUBE_MAP,te.__webglTexture),Ue(n.TEXTURE_CUBE_MAP,b.depthTexture);let ye=s.convert(b.depthTexture.format),Te=s.convert(b.depthTexture.type),de;b.depthTexture.format===Mi?de=n.DEPTH_COMPONENT24:b.depthTexture.format===Br&&(de=n.DEPTH24_STENCIL8);for(let fe=0;fe<6;fe++)n.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+fe,0,de,b.width,b.height,0,ye,Te,null)}}else H(b.depthTexture,0);let le=te.__webglTexture,ge=Ne(b),$=j?n.TEXTURE_CUBE_MAP_POSITIVE_X+k:n.TEXTURE_2D,K=b.depthTexture.format===Br?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT;if(b.depthTexture.format===Mi)Q(b)?a.framebufferTexture2DMultisampleEXT(n.FRAMEBUFFER,K,$,le,0,ge):n.framebufferTexture2D(n.FRAMEBUFFER,K,$,le,0);else if(b.depthTexture.format===Br)Q(b)?a.framebufferTexture2DMultisampleEXT(n.FRAMEBUFFER,K,$,le,0,ge):n.framebufferTexture2D(n.FRAMEBUFFER,K,$,le,0);else throw new Error("Unknown depthTexture format")}function et(P){let b=i.get(P),k=P.isWebGLCubeRenderTarget===!0;if(b.__boundDepthTexture!==P.depthTexture){let j=P.depthTexture;if(b.__depthDisposeCallback&&b.__depthDisposeCallback(),j){let te=()=>{delete b.__boundDepthTexture,delete b.__depthDisposeCallback,j.removeEventListener("dispose",te)};j.addEventListener("dispose",te),b.__depthDisposeCallback=te}b.__boundDepthTexture=j}if(P.depthTexture&&!b.__autoAllocateDepthBuffer)if(k)for(let j=0;j<6;j++)qe(b.__webglFramebuffer[j],P,j);else{let j=P.texture.mipmaps;j&&j.length>0?qe(b.__webglFramebuffer[0],P,0):qe(b.__webglFramebuffer,P,0)}else if(k){b.__webglDepthbuffer=[];for(let j=0;j<6;j++)if(t.bindFramebuffer(n.FRAMEBUFFER,b.__webglFramebuffer[j]),b.__webglDepthbuffer[j]===void 0)b.__webglDepthbuffer[j]=n.createRenderbuffer(),at(b.__webglDepthbuffer[j],P,!1);else{let te=P.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,le=b.__webglDepthbuffer[j];n.bindRenderbuffer(n.RENDERBUFFER,le),n.framebufferRenderbuffer(n.FRAMEBUFFER,te,n.RENDERBUFFER,le)}}else{let j=P.texture.mipmaps;if(j&&j.length>0?t.bindFramebuffer(n.FRAMEBUFFER,b.__webglFramebuffer[0]):t.bindFramebuffer(n.FRAMEBUFFER,b.__webglFramebuffer),b.__webglDepthbuffer===void 0)b.__webglDepthbuffer=n.createRenderbuffer(),at(b.__webglDepthbuffer,P,!1);else{let te=P.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,le=b.__webglDepthbuffer;n.bindRenderbuffer(n.RENDERBUFFER,le),n.framebufferRenderbuffer(n.FRAMEBUFFER,te,n.RENDERBUFFER,le)}}t.bindFramebuffer(n.FRAMEBUFFER,null)}function rt(P,b,k){let j=i.get(P);b!==void 0&&Fe(j.__webglFramebuffer,P,P.texture,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,0),k!==void 0&&et(P)}function G(P){let b=P.texture,k=i.get(P),j=i.get(b);P.addEventListener("dispose",x);let te=P.textures,le=P.isWebGLCubeRenderTarget===!0,ge=te.length>1;if(ge||(j.__webglTexture===void 0&&(j.__webglTexture=n.createTexture()),j.__version=b.version,o.memory.textures++),le){k.__webglFramebuffer=[];for(let $=0;$<6;$++)if(b.mipmaps&&b.mipmaps.length>0){k.__webglFramebuffer[$]=[];for(let K=0;K<b.mipmaps.length;K++)k.__webglFramebuffer[$][K]=n.createFramebuffer()}else k.__webglFramebuffer[$]=n.createFramebuffer()}else{if(b.mipmaps&&b.mipmaps.length>0){k.__webglFramebuffer=[];for(let $=0;$<b.mipmaps.length;$++)k.__webglFramebuffer[$]=n.createFramebuffer()}else k.__webglFramebuffer=n.createFramebuffer();if(ge)for(let $=0,K=te.length;$<K;$++){let ye=i.get(te[$]);ye.__webglTexture===void 0&&(ye.__webglTexture=n.createTexture(),o.memory.textures++)}if(P.samples>0&&Q(P)===!1){k.__webglMultisampledFramebuffer=n.createFramebuffer(),k.__webglColorRenderbuffer=[],t.bindFramebuffer(n.FRAMEBUFFER,k.__webglMultisampledFramebuffer);for(let $=0;$<te.length;$++){let K=te[$];k.__webglColorRenderbuffer[$]=n.createRenderbuffer(),n.bindRenderbuffer(n.RENDERBUFFER,k.__webglColorRenderbuffer[$]);let ye=s.convert(K.format,K.colorSpace),Te=s.convert(K.type),de=S(K.internalFormat,ye,Te,K.normalized,K.colorSpace,P.isXRRenderTarget===!0),fe=Ne(P);n.renderbufferStorageMultisample(n.RENDERBUFFER,fe,de,P.width,P.height),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0+$,n.RENDERBUFFER,k.__webglColorRenderbuffer[$])}n.bindRenderbuffer(n.RENDERBUFFER,null),P.depthBuffer&&(k.__webglDepthRenderbuffer=n.createRenderbuffer(),at(k.__webglDepthRenderbuffer,P,!0)),t.bindFramebuffer(n.FRAMEBUFFER,null)}}if(le){t.bindTexture(n.TEXTURE_CUBE_MAP,j.__webglTexture),Ue(n.TEXTURE_CUBE_MAP,b);for(let $=0;$<6;$++)if(b.mipmaps&&b.mipmaps.length>0)for(let K=0;K<b.mipmaps.length;K++)Fe(k.__webglFramebuffer[$][K],P,b,n.COLOR_ATTACHMENT0,n.TEXTURE_CUBE_MAP_POSITIVE_X+$,K);else Fe(k.__webglFramebuffer[$],P,b,n.COLOR_ATTACHMENT0,n.TEXTURE_CUBE_MAP_POSITIVE_X+$,0);m(b)&&v(n.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(ge){for(let $=0,K=te.length;$<K;$++){let ye=te[$],Te=i.get(ye),de=n.TEXTURE_2D;(P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&(de=P.isWebGL3DRenderTarget?n.TEXTURE_3D:n.TEXTURE_2D_ARRAY),t.bindTexture(de,Te.__webglTexture),Ue(de,ye),Fe(k.__webglFramebuffer,P,ye,n.COLOR_ATTACHMENT0+$,de,0),m(ye)&&v(de)}t.unbindTexture()}else{let $=n.TEXTURE_2D;if((P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&($=P.isWebGL3DRenderTarget?n.TEXTURE_3D:n.TEXTURE_2D_ARRAY),t.bindTexture($,j.__webglTexture),Ue($,b),b.mipmaps&&b.mipmaps.length>0)for(let K=0;K<b.mipmaps.length;K++)Fe(k.__webglFramebuffer[K],P,b,n.COLOR_ATTACHMENT0,$,K);else Fe(k.__webglFramebuffer,P,b,n.COLOR_ATTACHMENT0,$,0);m(b)&&v($),t.unbindTexture()}P.depthBuffer&&et(P)}function ne(P){let b=P.textures;for(let k=0,j=b.length;k<j;k++){let te=b[k];if(m(te)){let le=g(P),ge=i.get(te).__webglTexture;t.bindTexture(le,ge),v(le),t.unbindTexture()}}}let ie=[],ve=[];function U(P){if(P.samples>0){if(Q(P)===!1){let b=P.textures,k=P.width,j=P.height,te=n.COLOR_BUFFER_BIT,le=P.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,ge=i.get(P),$=b.length>1;if($)for(let ye=0;ye<b.length;ye++)t.bindFramebuffer(n.FRAMEBUFFER,ge.__webglMultisampledFramebuffer),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0+ye,n.RENDERBUFFER,null),t.bindFramebuffer(n.FRAMEBUFFER,ge.__webglFramebuffer),n.framebufferTexture2D(n.DRAW_FRAMEBUFFER,n.COLOR_ATTACHMENT0+ye,n.TEXTURE_2D,null,0);t.bindFramebuffer(n.READ_FRAMEBUFFER,ge.__webglMultisampledFramebuffer);let K=P.texture.mipmaps;K&&K.length>0?t.bindFramebuffer(n.DRAW_FRAMEBUFFER,ge.__webglFramebuffer[0]):t.bindFramebuffer(n.DRAW_FRAMEBUFFER,ge.__webglFramebuffer);for(let ye=0;ye<b.length;ye++){if(P.resolveDepthBuffer&&(P.depthBuffer&&(te|=n.DEPTH_BUFFER_BIT),P.stencilBuffer&&P.resolveStencilBuffer&&(te|=n.STENCIL_BUFFER_BIT)),$){n.framebufferRenderbuffer(n.READ_FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.RENDERBUFFER,ge.__webglColorRenderbuffer[ye]);let Te=i.get(b[ye]).__webglTexture;n.framebufferTexture2D(n.DRAW_FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,Te,0)}n.blitFramebuffer(0,0,k,j,0,0,k,j,te,n.NEAREST),l===!0&&(ie.length=0,ve.length=0,ie.push(n.COLOR_ATTACHMENT0+ye),P.depthBuffer&&P.resolveDepthBuffer===!1&&(ie.push(le),ve.push(le),n.invalidateFramebuffer(n.DRAW_FRAMEBUFFER,ve)),n.invalidateFramebuffer(n.READ_FRAMEBUFFER,ie))}if(t.bindFramebuffer(n.READ_FRAMEBUFFER,null),t.bindFramebuffer(n.DRAW_FRAMEBUFFER,null),$)for(let ye=0;ye<b.length;ye++){t.bindFramebuffer(n.FRAMEBUFFER,ge.__webglMultisampledFramebuffer),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0+ye,n.RENDERBUFFER,ge.__webglColorRenderbuffer[ye]);let Te=i.get(b[ye]).__webglTexture;t.bindFramebuffer(n.FRAMEBUFFER,ge.__webglFramebuffer),n.framebufferTexture2D(n.DRAW_FRAMEBUFFER,n.COLOR_ATTACHMENT0+ye,n.TEXTURE_2D,Te,0)}t.bindFramebuffer(n.DRAW_FRAMEBUFFER,ge.__webglMultisampledFramebuffer)}else if(P.depthBuffer&&P.resolveDepthBuffer===!1&&l){let b=P.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT;n.invalidateFramebuffer(n.DRAW_FRAMEBUFFER,[b])}}}function Ne(P){return Math.min(r.maxSamples,P.samples)}function Q(P){let b=i.get(P);return P.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&b.__useRenderToTexture!==!1}function xe(P){let b=o.render.frame;f.get(P)!==b&&(f.set(P,b),P.update())}function re(P,b){let k=P.colorSpace,j=P.format,te=P.type;return P.isCompressedTexture===!0||P.isVideoTexture===!0||k!==Ia&&k!==ji&&(tt.getTransfer(k)===lt?(j!==$n||te!==wn)&&Ge("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):We("WebGLTextures: Unsupported texture color space:",k)),b}function Le(P){return typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement?(u.width=P.naturalWidth||P.width,u.height=P.naturalHeight||P.height):typeof VideoFrame<"u"&&P instanceof VideoFrame?(u.width=P.displayWidth,u.height=P.displayHeight):(u.width=P.width,u.height=P.height),u}this.allocateTextureUnit=N,this.resetTextureUnits=D,this.getTextureUnits=F,this.setTextureUnits=L,this.setTexture2D=H,this.setTexture2DArray=Z,this.setTexture3D=Y,this.setTextureCube=se,this.rebindTextures=rt,this.setupRenderTarget=G,this.updateRenderTargetMipmap=ne,this.updateMultisampleRenderTarget=U,this.setupDepthRenderbuffer=et,this.setupFrameBufferTexture=Fe,this.useMultisampledRTT=Q,this.isReversedDepthBuffer=function(){return t.buffers.depth.getReversed()}}function cC(n,e){function t(i,r=ji){let s,o=tt.getTransfer(r);if(i===wn)return n.UNSIGNED_BYTE;if(i===rh)return n.UNSIGNED_SHORT_4_4_4_4;if(i===sh)return n.UNSIGNED_SHORT_5_5_5_1;if(i===wm)return n.UNSIGNED_INT_5_9_9_9_REV;if(i===Em)return n.UNSIGNED_INT_10F_11F_11F_REV;if(i===Sm)return n.BYTE;if(i===Mm)return n.SHORT;if(i===Mo)return n.UNSIGNED_SHORT;if(i===ih)return n.INT;if(i===ci)return n.UNSIGNED_INT;if(i===ui)return n.FLOAT;if(i===bi)return n.HALF_FLOAT;if(i===Tm)return n.ALPHA;if(i===Am)return n.RGB;if(i===$n)return n.RGBA;if(i===Mi)return n.DEPTH_COMPONENT;if(i===Br)return n.DEPTH_STENCIL;if(i===bm)return n.RED;if(i===oh)return n.RED_INTEGER;if(i===kr)return n.RG;if(i===ah)return n.RG_INTEGER;if(i===lh)return n.RGBA_INTEGER;if(i===al||i===ll||i===cl||i===ul)if(o===lt)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===al)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===ll)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===cl)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===ul)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===al)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===ll)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===cl)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===ul)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===ch||i===uh||i===hh||i===fh)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===ch)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===uh)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===hh)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===fh)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===dh||i===ph||i===mh||i===gh||i===vh||i===hl||i===xh)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===dh||i===ph)return o===lt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===mh)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===gh)return s.COMPRESSED_R11_EAC;if(i===vh)return s.COMPRESSED_SIGNED_R11_EAC;if(i===hl)return s.COMPRESSED_RG11_EAC;if(i===xh)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===yh||i===_h||i===Sh||i===Mh||i===wh||i===Eh||i===Th||i===Ah||i===bh||i===Ch||i===Rh||i===Ph||i===Ih||i===Lh)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===yh)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===_h)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Sh)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Mh)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===wh)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===Eh)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===Th)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Ah)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===bh)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===Ch)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===Rh)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===Ph)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===Ih)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===Lh)return o===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Dh||i===Nh||i===Uh)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===Dh)return o===lt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===Nh)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===Uh)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===Fh||i===Oh||i===fl||i===Bh)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===Fh)return s.COMPRESSED_RED_RGTC1_EXT;if(i===Oh)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===fl)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===Bh)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===wo?n.UNSIGNED_INT_24_8:n[i]!==void 0?n[i]:null}return{convert:t}}var uC=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,hC=`
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

}`,Qm=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let i=new Ga(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,i=new On({vertexShader:uC,fragmentShader:hC,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new pn(new ds(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},eg=class extends wi{constructor(e,t){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,u=null,f=null,c=null,h=null,d=null,p=null,_=typeof XRWebGLBinding<"u",y=new Qm,m={},v=t.getContextAttributes(),g=null,S=null,E=[],M=[],T=new Ee,x=null,w=new Mn;w.viewport=new bt;let C=new Mn;C.viewport=new bt;let A=[w,C],I=new Ju,D=null,F=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(J){let me=E[J];return me===void 0&&(me=new po,E[J]=me),me.getTargetRaySpace()},this.getControllerGrip=function(J){let me=E[J];return me===void 0&&(me=new po,E[J]=me),me.getGripSpace()},this.getHand=function(J){let me=E[J];return me===void 0&&(me=new po,E[J]=me),me.getHandSpace()};function L(J){let me=M.indexOf(J.inputSource);if(me===-1)return;let ae=E[me];ae!==void 0&&(ae.update(J.inputSource,J.frame,u||o),ae.dispatchEvent({type:J.type,data:J.inputSource}))}function N(){r.removeEventListener("select",L),r.removeEventListener("selectstart",L),r.removeEventListener("selectend",L),r.removeEventListener("squeeze",L),r.removeEventListener("squeezestart",L),r.removeEventListener("squeezeend",L),r.removeEventListener("end",N),r.removeEventListener("inputsourceschange",B);for(let J=0;J<E.length;J++){let me=M[J];me!==null&&(M[J]=null,E[J].disconnect(me))}D=null,F=null,y.reset();for(let J in m)delete m[J];e.setRenderTarget(g),d=null,h=null,c=null,r=null,S=null,Ue.stop(),i.isPresenting=!1,e.setPixelRatio(x),e.setSize(T.width,T.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(J){s=J,i.isPresenting===!0&&Ge("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(J){a=J,i.isPresenting===!0&&Ge("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return u||o},this.setReferenceSpace=function(J){u=J},this.getBaseLayer=function(){return h!==null?h:d},this.getBinding=function(){return c===null&&_&&(c=new XRWebGLBinding(r,t)),c},this.getFrame=function(){return p},this.getSession=function(){return r},this.setSession=async function(J){if(r=J,r!==null){if(g=e.getRenderTarget(),r.addEventListener("select",L),r.addEventListener("selectstart",L),r.addEventListener("selectend",L),r.addEventListener("squeeze",L),r.addEventListener("squeezestart",L),r.addEventListener("squeezeend",L),r.addEventListener("end",N),r.addEventListener("inputsourceschange",B),v.xrCompatible!==!0&&await t.makeXRCompatible(),x=e.getPixelRatio(),e.getSize(T),_&&"createProjectionLayer"in XRWebGLBinding.prototype){let ae=null,Ae=null,be=null;v.depth&&(be=v.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,ae=v.stencil?Br:Mi,Ae=v.stencil?wo:ci);let Fe={colorFormat:t.RGBA8,depthFormat:be,scaleFactor:s};c=this.getBinding(),h=c.createProjectionLayer(Fe),r.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),S=new Nn(h.textureWidth,h.textureHeight,{format:$n,type:wn,depthTexture:new Ki(h.textureWidth,h.textureHeight,Ae,void 0,void 0,void 0,void 0,void 0,void 0,ae),stencilBuffer:v.stencil,colorSpace:e.outputColorSpace,samples:v.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1})}else{let ae={antialias:v.antialias,alpha:!0,depth:v.depth,stencil:v.stencil,framebufferScaleFactor:s};d=new XRWebGLLayer(r,t,ae),r.updateRenderState({baseLayer:d}),e.setPixelRatio(1),e.setSize(d.framebufferWidth,d.framebufferHeight,!1),S=new Nn(d.framebufferWidth,d.framebufferHeight,{format:$n,type:wn,colorSpace:e.outputColorSpace,stencilBuffer:v.stencil,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}S.isXRRenderTarget=!0,this.setFoveation(l),u=null,o=await r.requestReferenceSpace(a),Ue.setContext(r),Ue.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return y.getDepthTexture()};function B(J){for(let me=0;me<J.removed.length;me++){let ae=J.removed[me],Ae=M.indexOf(ae);Ae>=0&&(M[Ae]=null,E[Ae].disconnect(ae))}for(let me=0;me<J.added.length;me++){let ae=J.added[me],Ae=M.indexOf(ae);if(Ae===-1){for(let Fe=0;Fe<E.length;Fe++)if(Fe>=M.length){M.push(ae),Ae=Fe;break}else if(M[Fe]===null){M[Fe]=ae,Ae=Fe;break}if(Ae===-1)break}let be=E[Ae];be&&be.connect(ae)}}let H=new V,Z=new V;function Y(J,me,ae){H.setFromMatrixPosition(me.matrixWorld),Z.setFromMatrixPosition(ae.matrixWorld);let Ae=H.distanceTo(Z),be=me.projectionMatrix.elements,Fe=ae.projectionMatrix.elements,at=be[14]/(be[10]-1),qe=be[14]/(be[10]+1),et=(be[9]+1)/be[5],rt=(be[9]-1)/be[5],G=(be[8]-1)/be[0],ne=(Fe[8]+1)/Fe[0],ie=at*G,ve=at*ne,U=Ae/(-G+ne),Ne=U*-G;if(me.matrixWorld.decompose(J.position,J.quaternion,J.scale),J.translateX(Ne),J.translateZ(U),J.matrixWorld.compose(J.position,J.quaternion,J.scale),J.matrixWorldInverse.copy(J.matrixWorld).invert(),be[10]===-1)J.projectionMatrix.copy(me.projectionMatrix),J.projectionMatrixInverse.copy(me.projectionMatrixInverse);else{let Q=at+U,xe=qe+U,re=ie-Ne,Le=ve+(Ae-Ne),P=et*qe/xe*Q,b=rt*qe/xe*Q;J.projectionMatrix.makePerspective(re,Le,P,b,Q,xe),J.projectionMatrixInverse.copy(J.projectionMatrix).invert()}}function se(J,me){me===null?J.matrixWorld.copy(J.matrix):J.matrixWorld.multiplyMatrices(me.matrixWorld,J.matrix),J.matrixWorldInverse.copy(J.matrixWorld).invert()}this.updateCamera=function(J){if(r===null)return;let me=J.near,ae=J.far;y.texture!==null&&(y.depthNear>0&&(me=y.depthNear),y.depthFar>0&&(ae=y.depthFar)),I.near=C.near=w.near=me,I.far=C.far=w.far=ae,(D!==I.near||F!==I.far)&&(r.updateRenderState({depthNear:I.near,depthFar:I.far}),D=I.near,F=I.far),I.layers.mask=J.layers.mask|6,w.layers.mask=I.layers.mask&-5,C.layers.mask=I.layers.mask&-3;let Ae=J.parent,be=I.cameras;se(I,Ae);for(let Fe=0;Fe<be.length;Fe++)se(be[Fe],Ae);be.length===2?Y(I,w,C):I.projectionMatrix.copy(w.projectionMatrix),ue(J,I,Ae)};function ue(J,me,ae){ae===null?J.matrix.copy(me.matrixWorld):(J.matrix.copy(ae.matrixWorld),J.matrix.invert(),J.matrix.multiply(me.matrixWorld)),J.matrix.decompose(J.position,J.quaternion,J.scale),J.updateMatrixWorld(!0),J.projectionMatrix.copy(me.projectionMatrix),J.projectionMatrixInverse.copy(me.projectionMatrixInverse),J.isPerspectiveCamera&&(J.fov=Eu*2*Math.atan(1/J.projectionMatrix.elements[5]),J.zoom=1)}this.getCamera=function(){return I},this.getFoveation=function(){if(!(h===null&&d===null))return l},this.setFoveation=function(J){l=J,h!==null&&(h.fixedFoveation=J),d!==null&&d.fixedFoveation!==void 0&&(d.fixedFoveation=J)},this.hasDepthSensing=function(){return y.texture!==null},this.getDepthSensingMesh=function(){return y.getMesh(I)},this.getCameraTexture=function(J){return m[J]};let Be=null;function Ie(J,me){if(f=me.getViewerPose(u||o),p=me,f!==null){let ae=f.views;d!==null&&(e.setRenderTargetFramebuffer(S,d.framebuffer),e.setRenderTarget(S));let Ae=!1;ae.length!==I.cameras.length&&(I.cameras.length=0,Ae=!0);for(let qe=0;qe<ae.length;qe++){let et=ae[qe],rt=null;if(d!==null)rt=d.getViewport(et);else{let ne=c.getViewSubImage(h,et);rt=ne.viewport,qe===0&&(e.setRenderTargetTextures(S,ne.colorTexture,ne.depthStencilTexture),e.setRenderTarget(S))}let G=A[qe];G===void 0&&(G=new Mn,G.layers.enable(qe),G.viewport=new bt,A[qe]=G),G.matrix.fromArray(et.transform.matrix),G.matrix.decompose(G.position,G.quaternion,G.scale),G.projectionMatrix.fromArray(et.projectionMatrix),G.projectionMatrixInverse.copy(G.projectionMatrix).invert(),G.viewport.set(rt.x,rt.y,rt.width,rt.height),qe===0&&(I.matrix.copy(G.matrix),I.matrix.decompose(I.position,I.quaternion,I.scale)),Ae===!0&&I.cameras.push(G)}let be=r.enabledFeatures;if(be&&be.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&_){c=i.getBinding();let qe=c.getDepthInformation(ae[0]);qe&&qe.isValid&&qe.texture&&y.init(qe,r.renderState)}if(be&&be.includes("camera-access")&&_){e.state.unbindTexture(),c=i.getBinding();for(let qe=0;qe<ae.length;qe++){let et=ae[qe].camera;if(et){let rt=m[et];rt||(rt=new Ga,m[et]=rt);let G=c.getCameraImage(et);rt.sourceTexture=G}}}}for(let ae=0;ae<E.length;ae++){let Ae=M[ae],be=E[ae];Ae!==null&&be!==void 0&&be.update(Ae,me,u||o)}Be&&Be(J,me),me.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:me}),p=null}let Ue=new L_;Ue.setAnimationLoop(Ie),this.setAnimationLoop=function(J){Be=J},this.dispose=function(){}}},fC=new Mt,B_=new Ye;B_.set(-1,0,0,0,1,0,0,0,1);function dC(n,e){function t(y,m){y.matrixAutoUpdate===!0&&y.updateMatrix(),m.value.copy(y.matrix)}function i(y,m){m.color.getRGB(y.fogColor.value,Im(n)),m.isFog?(y.fogNear.value=m.near,y.fogFar.value=m.far):m.isFogExp2&&(y.fogDensity.value=m.density)}function r(y,m,v,g,S){m.isNodeMaterial?m.uniformsNeedUpdate=!1:m.isMeshBasicMaterial?s(y,m):m.isMeshLambertMaterial?(s(y,m),m.envMap&&(y.envMapIntensity.value=m.envMapIntensity)):m.isMeshToonMaterial?(s(y,m),c(y,m)):m.isMeshPhongMaterial?(s(y,m),f(y,m),m.envMap&&(y.envMapIntensity.value=m.envMapIntensity)):m.isMeshStandardMaterial?(s(y,m),h(y,m),m.isMeshPhysicalMaterial&&d(y,m,S)):m.isMeshMatcapMaterial?(s(y,m),p(y,m)):m.isMeshDepthMaterial?s(y,m):m.isMeshDistanceMaterial?(s(y,m),_(y,m)):m.isMeshNormalMaterial?s(y,m):m.isLineBasicMaterial?(o(y,m),m.isLineDashedMaterial&&a(y,m)):m.isPointsMaterial?l(y,m,v,g):m.isSpriteMaterial?u(y,m):m.isShadowMaterial?(y.color.value.copy(m.color),y.opacity.value=m.opacity):m.isShaderMaterial&&(m.uniformsNeedUpdate=!1)}function s(y,m){y.opacity.value=m.opacity,m.color&&y.diffuse.value.copy(m.color),m.emissive&&y.emissive.value.copy(m.emissive).multiplyScalar(m.emissiveIntensity),m.map&&(y.map.value=m.map,t(m.map,y.mapTransform)),m.alphaMap&&(y.alphaMap.value=m.alphaMap,t(m.alphaMap,y.alphaMapTransform)),m.bumpMap&&(y.bumpMap.value=m.bumpMap,t(m.bumpMap,y.bumpMapTransform),y.bumpScale.value=m.bumpScale,m.side===mn&&(y.bumpScale.value*=-1)),m.normalMap&&(y.normalMap.value=m.normalMap,t(m.normalMap,y.normalMapTransform),y.normalScale.value.copy(m.normalScale),m.side===mn&&y.normalScale.value.negate()),m.displacementMap&&(y.displacementMap.value=m.displacementMap,t(m.displacementMap,y.displacementMapTransform),y.displacementScale.value=m.displacementScale,y.displacementBias.value=m.displacementBias),m.emissiveMap&&(y.emissiveMap.value=m.emissiveMap,t(m.emissiveMap,y.emissiveMapTransform)),m.specularMap&&(y.specularMap.value=m.specularMap,t(m.specularMap,y.specularMapTransform)),m.alphaTest>0&&(y.alphaTest.value=m.alphaTest);let v=e.get(m),g=v.envMap,S=v.envMapRotation;g&&(y.envMap.value=g,y.envMapRotation.value.setFromMatrix4(fC.makeRotationFromEuler(S)).transpose(),g.isCubeTexture&&g.isRenderTargetTexture===!1&&y.envMapRotation.value.premultiply(B_),y.reflectivity.value=m.reflectivity,y.ior.value=m.ior,y.refractionRatio.value=m.refractionRatio),m.lightMap&&(y.lightMap.value=m.lightMap,y.lightMapIntensity.value=m.lightMapIntensity,t(m.lightMap,y.lightMapTransform)),m.aoMap&&(y.aoMap.value=m.aoMap,y.aoMapIntensity.value=m.aoMapIntensity,t(m.aoMap,y.aoMapTransform))}function o(y,m){y.diffuse.value.copy(m.color),y.opacity.value=m.opacity,m.map&&(y.map.value=m.map,t(m.map,y.mapTransform))}function a(y,m){y.dashSize.value=m.dashSize,y.totalSize.value=m.dashSize+m.gapSize,y.scale.value=m.scale}function l(y,m,v,g){y.diffuse.value.copy(m.color),y.opacity.value=m.opacity,y.size.value=m.size*v,y.scale.value=g*.5,m.map&&(y.map.value=m.map,t(m.map,y.uvTransform)),m.alphaMap&&(y.alphaMap.value=m.alphaMap,t(m.alphaMap,y.alphaMapTransform)),m.alphaTest>0&&(y.alphaTest.value=m.alphaTest)}function u(y,m){y.diffuse.value.copy(m.color),y.opacity.value=m.opacity,y.rotation.value=m.rotation,m.map&&(y.map.value=m.map,t(m.map,y.mapTransform)),m.alphaMap&&(y.alphaMap.value=m.alphaMap,t(m.alphaMap,y.alphaMapTransform)),m.alphaTest>0&&(y.alphaTest.value=m.alphaTest)}function f(y,m){y.specular.value.copy(m.specular),y.shininess.value=Math.max(m.shininess,1e-4)}function c(y,m){m.gradientMap&&(y.gradientMap.value=m.gradientMap)}function h(y,m){y.metalness.value=m.metalness,m.metalnessMap&&(y.metalnessMap.value=m.metalnessMap,t(m.metalnessMap,y.metalnessMapTransform)),y.roughness.value=m.roughness,m.roughnessMap&&(y.roughnessMap.value=m.roughnessMap,t(m.roughnessMap,y.roughnessMapTransform)),m.envMap&&(y.envMapIntensity.value=m.envMapIntensity)}function d(y,m,v){y.ior.value=m.ior,m.sheen>0&&(y.sheenColor.value.copy(m.sheenColor).multiplyScalar(m.sheen),y.sheenRoughness.value=m.sheenRoughness,m.sheenColorMap&&(y.sheenColorMap.value=m.sheenColorMap,t(m.sheenColorMap,y.sheenColorMapTransform)),m.sheenRoughnessMap&&(y.sheenRoughnessMap.value=m.sheenRoughnessMap,t(m.sheenRoughnessMap,y.sheenRoughnessMapTransform))),m.clearcoat>0&&(y.clearcoat.value=m.clearcoat,y.clearcoatRoughness.value=m.clearcoatRoughness,m.clearcoatMap&&(y.clearcoatMap.value=m.clearcoatMap,t(m.clearcoatMap,y.clearcoatMapTransform)),m.clearcoatRoughnessMap&&(y.clearcoatRoughnessMap.value=m.clearcoatRoughnessMap,t(m.clearcoatRoughnessMap,y.clearcoatRoughnessMapTransform)),m.clearcoatNormalMap&&(y.clearcoatNormalMap.value=m.clearcoatNormalMap,t(m.clearcoatNormalMap,y.clearcoatNormalMapTransform),y.clearcoatNormalScale.value.copy(m.clearcoatNormalScale),m.side===mn&&y.clearcoatNormalScale.value.negate())),m.dispersion>0&&(y.dispersion.value=m.dispersion),m.iridescence>0&&(y.iridescence.value=m.iridescence,y.iridescenceIOR.value=m.iridescenceIOR,y.iridescenceThicknessMinimum.value=m.iridescenceThicknessRange[0],y.iridescenceThicknessMaximum.value=m.iridescenceThicknessRange[1],m.iridescenceMap&&(y.iridescenceMap.value=m.iridescenceMap,t(m.iridescenceMap,y.iridescenceMapTransform)),m.iridescenceThicknessMap&&(y.iridescenceThicknessMap.value=m.iridescenceThicknessMap,t(m.iridescenceThicknessMap,y.iridescenceThicknessMapTransform))),m.transmission>0&&(y.transmission.value=m.transmission,y.transmissionSamplerMap.value=v.texture,y.transmissionSamplerSize.value.set(v.width,v.height),m.transmissionMap&&(y.transmissionMap.value=m.transmissionMap,t(m.transmissionMap,y.transmissionMapTransform)),y.thickness.value=m.thickness,m.thicknessMap&&(y.thicknessMap.value=m.thicknessMap,t(m.thicknessMap,y.thicknessMapTransform)),y.attenuationDistance.value=m.attenuationDistance,y.attenuationColor.value.copy(m.attenuationColor)),m.anisotropy>0&&(y.anisotropyVector.value.set(m.anisotropy*Math.cos(m.anisotropyRotation),m.anisotropy*Math.sin(m.anisotropyRotation)),m.anisotropyMap&&(y.anisotropyMap.value=m.anisotropyMap,t(m.anisotropyMap,y.anisotropyMapTransform))),y.specularIntensity.value=m.specularIntensity,y.specularColor.value.copy(m.specularColor),m.specularColorMap&&(y.specularColorMap.value=m.specularColorMap,t(m.specularColorMap,y.specularColorMapTransform)),m.specularIntensityMap&&(y.specularIntensityMap.value=m.specularIntensityMap,t(m.specularIntensityMap,y.specularIntensityMapTransform))}function p(y,m){m.matcap&&(y.matcap.value=m.matcap)}function _(y,m){let v=e.get(m).light;y.referencePosition.value.setFromMatrixPosition(v.matrixWorld),y.nearDistance.value=v.shadow.camera.near,y.farDistance.value=v.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function pC(n,e,t,i){let r={},s={},o=[],a=n.getParameter(n.MAX_UNIFORM_BUFFER_BINDINGS);function l(v,g){let S=g.program;i.uniformBlockBinding(v,S)}function u(v,g){let S=r[v.id];S===void 0&&(p(v),S=f(v),r[v.id]=S,v.addEventListener("dispose",y));let E=g.program;i.updateUBOMapping(v,E);let M=e.render.frame;s[v.id]!==M&&(h(v),s[v.id]=M)}function f(v){let g=c();v.__bindingPointIndex=g;let S=n.createBuffer(),E=v.__size,M=v.usage;return n.bindBuffer(n.UNIFORM_BUFFER,S),n.bufferData(n.UNIFORM_BUFFER,E,M),n.bindBuffer(n.UNIFORM_BUFFER,null),n.bindBufferBase(n.UNIFORM_BUFFER,g,S),S}function c(){for(let v=0;v<a;v++)if(o.indexOf(v)===-1)return o.push(v),v;return We("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function h(v){let g=r[v.id],S=v.uniforms,E=v.__cache;n.bindBuffer(n.UNIFORM_BUFFER,g);for(let M=0,T=S.length;M<T;M++){let x=Array.isArray(S[M])?S[M]:[S[M]];for(let w=0,C=x.length;w<C;w++){let A=x[w];if(d(A,M,w,E)===!0){let I=A.__offset,D=Array.isArray(A.value)?A.value:[A.value],F=0;for(let L=0;L<D.length;L++){let N=D[L],B=_(N);typeof N=="number"||typeof N=="boolean"?(A.__data[0]=N,n.bufferSubData(n.UNIFORM_BUFFER,I+F,A.__data)):N.isMatrix3?(A.__data[0]=N.elements[0],A.__data[1]=N.elements[1],A.__data[2]=N.elements[2],A.__data[3]=0,A.__data[4]=N.elements[3],A.__data[5]=N.elements[4],A.__data[6]=N.elements[5],A.__data[7]=0,A.__data[8]=N.elements[6],A.__data[9]=N.elements[7],A.__data[10]=N.elements[8],A.__data[11]=0):ArrayBuffer.isView(N)?A.__data.set(new N.constructor(N.buffer,N.byteOffset,A.__data.length)):(N.toArray(A.__data,F),F+=B.storage/Float32Array.BYTES_PER_ELEMENT)}n.bufferSubData(n.UNIFORM_BUFFER,I,A.__data)}}}n.bindBuffer(n.UNIFORM_BUFFER,null)}function d(v,g,S,E){let M=v.value,T=g+"_"+S;if(E[T]===void 0)return typeof M=="number"||typeof M=="boolean"?E[T]=M:ArrayBuffer.isView(M)?E[T]=M.slice():E[T]=M.clone(),!0;{let x=E[T];if(typeof M=="number"||typeof M=="boolean"){if(x!==M)return E[T]=M,!0}else{if(ArrayBuffer.isView(M))return!0;if(x.equals(M)===!1)return x.copy(M),!0}}return!1}function p(v){let g=v.uniforms,S=0,E=16;for(let T=0,x=g.length;T<x;T++){let w=Array.isArray(g[T])?g[T]:[g[T]];for(let C=0,A=w.length;C<A;C++){let I=w[C],D=Array.isArray(I.value)?I.value:[I.value];for(let F=0,L=D.length;F<L;F++){let N=D[F],B=_(N),H=S%E,Z=H%B.boundary,Y=H+Z;S+=Z,Y!==0&&E-Y<B.storage&&(S+=E-Y),I.__data=new Float32Array(B.storage/Float32Array.BYTES_PER_ELEMENT),I.__offset=S,S+=B.storage}}}let M=S%E;return M>0&&(S+=E-M),v.__size=S,v.__cache={},this}function _(v){let g={boundary:0,storage:0};return typeof v=="number"||typeof v=="boolean"?(g.boundary=4,g.storage=4):v.isVector2?(g.boundary=8,g.storage=8):v.isVector3||v.isColor?(g.boundary=16,g.storage=12):v.isVector4?(g.boundary=16,g.storage=16):v.isMatrix3?(g.boundary=48,g.storage=48):v.isMatrix4?(g.boundary=64,g.storage=64):v.isTexture?Ge("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(v)?(g.boundary=16,g.storage=v.byteLength):Ge("WebGLRenderer: Unsupported uniform value type.",v),g}function y(v){let g=v.target;g.removeEventListener("dispose",y);let S=o.indexOf(g.__bindingPointIndex);o.splice(S,1),n.deleteBuffer(r[g.id]),delete r[g.id],delete s[g.id]}function m(){for(let v in r)n.deleteBuffer(r[v]);o=[],r={},s={}}return{bind:l,update:u,dispose:m}}var mC=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Ci=null;function gC(){return Ci===null&&(Ci=new Cu(mC,16,16,kr,bi),Ci.name="DFG_LUT",Ci.minFilter=$t,Ci.magFilter=$t,Ci.wrapS=Si,Ci.wrapT=Si,Ci.generateMipmaps=!1,Ci.needsUpdate=!0),Ci}var Yh=class{constructor(e={}){let{canvas:t=Qy(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:u=!1,powerPreference:f="default",failIfMajorPerformanceCaveat:c=!1,reversedDepthBuffer:h=!1,outputBufferType:d=wn}=e;this.isWebGLRenderer=!0;let p;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=i.getContextAttributes().alpha}else p=o;let _=d,y=new Set([lh,ah,oh]),m=new Set([wn,ci,Mo,wo,rh,sh]),v=new Uint32Array(4),g=new Int32Array(4),S=new V,E=null,M=null,T=[],x=[],w=null;this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=li,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let C=this,A=!1,I=null;this._outputColorSpace=on;let D=0,F=0,L=null,N=-1,B=null,H=new bt,Z=new bt,Y=null,se=new nt(0),ue=0,Be=t.width,Ie=t.height,Ue=1,J=null,me=null,ae=new bt(0,0,Be,Ie),Ae=new bt(0,0,Be,Ie),be=!1,Fe=new go,at=!1,qe=!1,et=new Mt,rt=new V,G=new bt,ne={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},ie=!1;function ve(){return L===null?Ue:1}let U=i;function Ne(R,z){return t.getContext(R,z)}try{let R={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:u,powerPreference:f,failIfMajorPerformanceCaveat:c};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${ju}`),t.addEventListener("webglcontextlost",oe,!1),t.addEventListener("webglcontextrestored",Oe,!1),t.addEventListener("webglcontextcreationerror",Ze,!1),U===null){let z="webgl2";if(U=Ne(z,R),U===null)throw Ne(z)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(R){throw We("WebGLRenderer: "+R.message),R}let Q,xe,re,Le,P,b,k,j,te,le,ge,$,K,ye,Te,de,fe,Xe,ze,He,O,he,ee;function we(){Q=new wA(U),Q.init(),O=new cC(U,Q),xe=new mA(U,Q,e,O),re=new aC(U,Q),xe.reversedDepthBuffer&&h&&re.buffers.depth.setReversed(!0),Le=new AA(U),P=new qb,b=new lC(U,Q,re,P,xe,O,Le),k=new MA(C),j=new Pw(U),he=new dA(U,j),te=new EA(U,j,Le,he),le=new CA(U,te,j,he,Le),Xe=new bA(U,xe,b),Te=new gA(P),ge=new Yb(C,k,Q,xe,he,Te),$=new dC(C,P),K=new $b,ye=new tC(Q),fe=new fA(C,k,re,le,p,l),de=new oC(C,le,xe),ee=new pC(U,Le,xe,re),ze=new pA(U,Q,Le),He=new TA(U,Q,Le),Le.programs=ge.programs,C.capabilities=xe,C.extensions=Q,C.properties=P,C.renderLists=K,C.shadowMap=de,C.state=re,C.info=Le}we(),_!==wn&&(w=new PA(_,t.width,t.height,r,s));let pe=new eg(C,U);this.xr=pe,this.getContext=function(){return U},this.getContextAttributes=function(){return U.getContextAttributes()},this.forceContextLoss=function(){let R=Q.get("WEBGL_lose_context");R&&R.loseContext()},this.forceContextRestore=function(){let R=Q.get("WEBGL_lose_context");R&&R.restoreContext()},this.getPixelRatio=function(){return Ue},this.setPixelRatio=function(R){R!==void 0&&(Ue=R,this.setSize(Be,Ie,!1))},this.getSize=function(R){return R.set(Be,Ie)},this.setSize=function(R,z,q=!0){if(pe.isPresenting){Ge("WebGLRenderer: Can't change size while VR device is presenting.");return}Be=R,Ie=z,t.width=Math.floor(R*Ue),t.height=Math.floor(z*Ue),q===!0&&(t.style.width=R+"px",t.style.height=z+"px"),w!==null&&w.setSize(t.width,t.height),this.setViewport(0,0,R,z)},this.getDrawingBufferSize=function(R){return R.set(Be*Ue,Ie*Ue).floor()},this.setDrawingBufferSize=function(R,z,q){Be=R,Ie=z,Ue=q,t.width=Math.floor(R*q),t.height=Math.floor(z*q),this.setViewport(0,0,R,z)},this.setEffects=function(R){if(_===wn){We("THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(R){for(let z=0;z<R.length;z++)if(R[z].isOutputPass===!0){Ge("THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}w.setEffects(R||[])},this.getCurrentViewport=function(R){return R.copy(H)},this.getViewport=function(R){return R.copy(ae)},this.setViewport=function(R,z,q,W){R.isVector4?ae.set(R.x,R.y,R.z,R.w):ae.set(R,z,q,W),re.viewport(H.copy(ae).multiplyScalar(Ue).round())},this.getScissor=function(R){return R.copy(Ae)},this.setScissor=function(R,z,q,W){R.isVector4?Ae.set(R.x,R.y,R.z,R.w):Ae.set(R,z,q,W),re.scissor(Z.copy(Ae).multiplyScalar(Ue).round())},this.getScissorTest=function(){return be},this.setScissorTest=function(R){re.setScissorTest(be=R)},this.setOpaqueSort=function(R){J=R},this.setTransparentSort=function(R){me=R},this.getClearColor=function(R){return R.copy(fe.getClearColor())},this.setClearColor=function(){fe.setClearColor(...arguments)},this.getClearAlpha=function(){return fe.getClearAlpha()},this.setClearAlpha=function(){fe.setClearAlpha(...arguments)},this.clear=function(R=!0,z=!0,q=!0){let W=0;if(R){let X=!1;if(L!==null){let Me=L.texture.format;X=y.has(Me)}if(X){let Me=L.texture.type,Re=m.has(Me),Se=fe.getClearColor(),De=fe.getClearAlpha(),ke=Se.r,$e=Se.g,Ke=Se.b;Re?(v[0]=ke,v[1]=$e,v[2]=Ke,v[3]=De,U.clearBufferuiv(U.COLOR,0,v)):(g[0]=ke,g[1]=$e,g[2]=Ke,g[3]=De,U.clearBufferiv(U.COLOR,0,g))}else W|=U.COLOR_BUFFER_BIT}z&&(W|=U.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),q&&(W|=U.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),W!==0&&U.clear(W)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(R){R.setRenderer(this),I=R},this.dispose=function(){t.removeEventListener("webglcontextlost",oe,!1),t.removeEventListener("webglcontextrestored",Oe,!1),t.removeEventListener("webglcontextcreationerror",Ze,!1),fe.dispose(),K.dispose(),ye.dispose(),P.dispose(),k.dispose(),le.dispose(),he.dispose(),ee.dispose(),ge.dispose(),pe.dispose(),pe.removeEventListener("sessionstart",ig),pe.removeEventListener("sessionend",rg),Vr.stop()};function oe(R){R.preventDefault(),Rm("WebGLRenderer: Context Lost."),A=!0}function Oe(){Rm("WebGLRenderer: Context Restored."),A=!1;let R=Le.autoReset,z=de.enabled,q=de.autoUpdate,W=de.needsUpdate,X=de.type;we(),Le.autoReset=R,de.enabled=z,de.autoUpdate=q,de.needsUpdate=W,de.type=X}function Ze(R){We("WebGLRenderer: A WebGL context could not be created. Reason: ",R.statusMessage)}function It(R){let z=R.target;z.removeEventListener("dispose",It),ut(z)}function ut(R){Pi(R),P.remove(R)}function Pi(R){let z=P.get(R).programs;z!==void 0&&(z.forEach(function(q){ge.releaseProgram(q)}),R.isShaderMaterial&&ge.releaseShaderCache(R))}this.renderBufferDirect=function(R,z,q,W,X,Me){z===null&&(z=ne);let Re=X.isMesh&&X.matrixWorld.determinant()<0,Se=K_(R,z,q,W,X);re.setMaterial(W,Re);let De=q.index,ke=1;if(W.wireframe===!0){if(De=te.getWireframeAttribute(q),De===void 0)return;ke=2}let $e=q.drawRange,Ke=q.attributes.position,Ve=$e.start*ke,ht=($e.start+$e.count)*ke;Me!==null&&(Ve=Math.max(Ve,Me.start*ke),ht=Math.min(ht,(Me.start+Me.count)*ke)),De!==null?(Ve=Math.max(Ve,0),ht=Math.min(ht,De.count)):Ke!=null&&(Ve=Math.max(Ve,0),ht=Math.min(ht,Ke.count));let Lt=ht-Ve;if(Lt<0||Lt===1/0)return;he.setup(X,W,Se,q,De);let Rt,ft=ze;if(De!==null&&(Rt=j.get(De),ft=He,ft.setIndex(Rt)),X.isMesh)W.wireframe===!0?(re.setLineWidth(W.wireframeLinewidth*ve()),ft.setMode(U.LINES)):ft.setMode(U.TRIANGLES);else if(X.isLine){let Kt=W.linewidth;Kt===void 0&&(Kt=1),re.setLineWidth(Kt*ve()),X.isLineSegments?ft.setMode(U.LINES):X.isLineLoop?ft.setMode(U.LINE_LOOP):ft.setMode(U.LINE_STRIP)}else X.isPoints?ft.setMode(U.POINTS):X.isSprite&&ft.setMode(U.TRIANGLES);if(X.isBatchedMesh)if(Q.get("WEBGL_multi_draw"))ft.renderMultiDraw(X._multiDrawStarts,X._multiDrawCounts,X._multiDrawCount);else{let Kt=X._multiDrawStarts,Ce=X._multiDrawCounts,En=X._multiDrawCount,st=De?j.get(De).bytesPerElement:1,kn=P.get(W).currentProgram.getUniforms();for(let fi=0;fi<En;fi++)kn.setValue(U,"_gl_DrawID",fi),ft.render(Kt[fi]/st,Ce[fi])}else if(X.isInstancedMesh)ft.renderInstances(Ve,Lt,X.count);else if(q.isInstancedBufferGeometry){let Kt=q._maxInstanceCount!==void 0?q._maxInstanceCount:1/0,Ce=Math.min(q.instanceCount,Kt);ft.renderInstances(Ve,Lt,Ce)}else ft.render(Ve,Lt)};function hi(R,z,q){R.transparent===!0&&R.side===Ti&&R.forceSinglePass===!1?(R.side=mn,R.needsUpdate=!0,xl(R,z,q),R.side=Zi,R.needsUpdate=!0,xl(R,z,q),R.side=Ti):xl(R,z,q)}this.compile=function(R,z,q=null){q===null&&(q=R),M=ye.get(q),M.init(z),x.push(M),q.traverseVisible(function(X){X.isLight&&X.layers.test(z.layers)&&(M.pushLight(X),X.castShadow&&M.pushShadow(X))}),R!==q&&R.traverseVisible(function(X){X.isLight&&X.layers.test(z.layers)&&(M.pushLight(X),X.castShadow&&M.pushShadow(X))}),M.setupLights();let W=new Set;return R.traverse(function(X){if(!(X.isMesh||X.isPoints||X.isLine||X.isSprite))return;let Me=X.material;if(Me)if(Array.isArray(Me))for(let Re=0;Re<Me.length;Re++){let Se=Me[Re];hi(Se,q,X),W.add(Se)}else hi(Me,q,X),W.add(Me)}),M=x.pop(),W},this.compileAsync=function(R,z,q=null){let W=this.compile(R,z,q);return new Promise(X=>{function Me(){if(W.forEach(function(Re){P.get(Re).currentProgram.isReady()&&W.delete(Re)}),W.size===0){X(R);return}setTimeout(Me,10)}Q.get("KHR_parallel_shader_compile")!==null?Me():setTimeout(Me,10)})};let jh=null;function $_(R){jh&&jh(R)}function ig(){Vr.stop()}function rg(){Vr.start()}let Vr=new L_;Vr.setAnimationLoop($_),typeof self<"u"&&Vr.setContext(self),this.setAnimationLoop=function(R){jh=R,pe.setAnimationLoop(R),R===null?Vr.stop():Vr.start()},pe.addEventListener("sessionstart",ig),pe.addEventListener("sessionend",rg),this.render=function(R,z){if(z!==void 0&&z.isCamera!==!0){We("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(A===!0)return;I!==null&&I.renderStart(R,z);let q=pe.enabled===!0&&pe.isPresenting===!0,W=w!==null&&(L===null||q)&&w.begin(C,L);if(R.matrixWorldAutoUpdate===!0&&R.updateMatrixWorld(),z.parent===null&&z.matrixWorldAutoUpdate===!0&&z.updateMatrixWorld(),pe.enabled===!0&&pe.isPresenting===!0&&(w===null||w.isCompositing()===!1)&&(pe.cameraAutoUpdate===!0&&pe.updateCamera(z),z=pe.getCamera()),R.isScene===!0&&R.onBeforeRender(C,R,z,L),M=ye.get(R,x.length),M.init(z),M.state.textureUnits=b.getTextureUnits(),x.push(M),et.multiplyMatrices(z.projectionMatrix,z.matrixWorldInverse),Fe.setFromProjectionMatrix(et,ai,z.reversedDepth),qe=this.localClippingEnabled,at=Te.init(this.clippingPlanes,qe),E=K.get(R,T.length),E.init(),T.push(E),pe.enabled===!0&&pe.isPresenting===!0){let Re=C.xr.getDepthSensingMesh();Re!==null&&Qh(Re,z,-1/0,C.sortObjects)}Qh(R,z,0,C.sortObjects),E.finish(),C.sortObjects===!0&&E.sort(J,me),ie=pe.enabled===!1||pe.isPresenting===!1||pe.hasDepthSensing()===!1,ie&&fe.addToRenderList(E,R),this.info.render.frame++,at===!0&&Te.beginShadows();let X=M.state.shadowsArray;if(de.render(X,R,z),at===!0&&Te.endShadows(),this.info.autoReset===!0&&this.info.reset(),(W&&w.hasRenderPass())===!1){let Re=E.opaque,Se=E.transmissive;if(M.setupLights(),z.isArrayCamera){let De=z.cameras;if(Se.length>0)for(let ke=0,$e=De.length;ke<$e;ke++){let Ke=De[ke];og(Re,Se,R,Ke)}ie&&fe.render(R);for(let ke=0,$e=De.length;ke<$e;ke++){let Ke=De[ke];sg(E,R,Ke,Ke.viewport)}}else Se.length>0&&og(Re,Se,R,z),ie&&fe.render(R),sg(E,R,z)}L!==null&&F===0&&(b.updateMultisampleRenderTarget(L),b.updateRenderTargetMipmap(L)),W&&w.end(C),R.isScene===!0&&R.onAfterRender(C,R,z),he.resetDefaultState(),N=-1,B=null,x.pop(),x.length>0?(M=x[x.length-1],b.setTextureUnits(M.state.textureUnits),at===!0&&Te.setGlobalState(C.clippingPlanes,M.state.camera)):M=null,T.pop(),T.length>0?E=T[T.length-1]:E=null,I!==null&&I.renderEnd()};function Qh(R,z,q,W){if(R.visible===!1)return;if(R.layers.test(z.layers)){if(R.isGroup)q=R.renderOrder;else if(R.isLOD)R.autoUpdate===!0&&R.update(z);else if(R.isLightProbeGrid)M.pushLightProbeGrid(R);else if(R.isLight)M.pushLight(R),R.castShadow&&M.pushShadow(R);else if(R.isSprite){if(!R.frustumCulled||Fe.intersectsSprite(R)){W&&G.setFromMatrixPosition(R.matrixWorld).applyMatrix4(et);let Re=le.update(R),Se=R.material;Se.visible&&E.push(R,Re,Se,q,G.z,null)}}else if((R.isMesh||R.isLine||R.isPoints)&&(!R.frustumCulled||Fe.intersectsObject(R))){let Re=le.update(R),Se=R.material;if(W&&(R.boundingSphere!==void 0?(R.boundingSphere===null&&R.computeBoundingSphere(),G.copy(R.boundingSphere.center)):(Re.boundingSphere===null&&Re.computeBoundingSphere(),G.copy(Re.boundingSphere.center)),G.applyMatrix4(R.matrixWorld).applyMatrix4(et)),Array.isArray(Se)){let De=Re.groups;for(let ke=0,$e=De.length;ke<$e;ke++){let Ke=De[ke],Ve=Se[Ke.materialIndex];Ve&&Ve.visible&&E.push(R,Re,Ve,q,G.z,Ke)}}else Se.visible&&E.push(R,Re,Se,q,G.z,null)}}let Me=R.children;for(let Re=0,Se=Me.length;Re<Se;Re++)Qh(Me[Re],z,q,W)}function sg(R,z,q,W){let{opaque:X,transmissive:Me,transparent:Re}=R;M.setupLightsView(q),at===!0&&Te.setGlobalState(C.clippingPlanes,q),W&&re.viewport(H.copy(W)),X.length>0&&vl(X,z,q),Me.length>0&&vl(Me,z,q),Re.length>0&&vl(Re,z,q),re.buffers.depth.setTest(!0),re.buffers.depth.setMask(!0),re.buffers.color.setMask(!0),re.setPolygonOffset(!1)}function og(R,z,q,W){if((q.isScene===!0?q.overrideMaterial:null)!==null)return;if(M.state.transmissionRenderTarget[W.id]===void 0){let Ve=Q.has("EXT_color_buffer_half_float")||Q.has("EXT_color_buffer_float");M.state.transmissionRenderTarget[W.id]=new Nn(1,1,{generateMipmaps:!0,type:Ve?bi:wn,minFilter:Or,samples:Math.max(4,xe.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:tt.workingColorSpace})}let Me=M.state.transmissionRenderTarget[W.id],Re=W.viewport||H;Me.setSize(Re.z*C.transmissionResolutionScale,Re.w*C.transmissionResolutionScale);let Se=C.getRenderTarget(),De=C.getActiveCubeFace(),ke=C.getActiveMipmapLevel();C.setRenderTarget(Me),C.getClearColor(se),ue=C.getClearAlpha(),ue<1&&C.setClearColor(16777215,.5),C.clear(),ie&&fe.render(q);let $e=C.toneMapping;C.toneMapping=li;let Ke=W.viewport;if(W.viewport!==void 0&&(W.viewport=void 0),M.setupLightsView(W),at===!0&&Te.setGlobalState(C.clippingPlanes,W),vl(R,q,W),b.updateMultisampleRenderTarget(Me),b.updateRenderTargetMipmap(Me),Q.has("WEBGL_multisampled_render_to_texture")===!1){let Ve=!1;for(let ht=0,Lt=z.length;ht<Lt;ht++){let Rt=z[ht],{object:ft,geometry:Kt,material:Ce,group:En}=Rt;if(Ce.side===Ti&&ft.layers.test(W.layers)){let st=Ce.side;Ce.side=mn,Ce.needsUpdate=!0,ag(ft,q,W,Kt,Ce,En),Ce.side=st,Ce.needsUpdate=!0,Ve=!0}}Ve===!0&&(b.updateMultisampleRenderTarget(Me),b.updateRenderTargetMipmap(Me))}C.setRenderTarget(Se,De,ke),C.setClearColor(se,ue),Ke!==void 0&&(W.viewport=Ke),C.toneMapping=$e}function vl(R,z,q){let W=z.isScene===!0?z.overrideMaterial:null;for(let X=0,Me=R.length;X<Me;X++){let Re=R[X],{object:Se,geometry:De,group:ke}=Re,$e=Re.material;$e.allowOverride===!0&&W!==null&&($e=W),Se.layers.test(q.layers)&&ag(Se,z,q,De,$e,ke)}}function ag(R,z,q,W,X,Me){R.onBeforeRender(C,z,q,W,X,Me),R.modelViewMatrix.multiplyMatrices(q.matrixWorldInverse,R.matrixWorld),R.normalMatrix.getNormalMatrix(R.modelViewMatrix),X.onBeforeRender(C,z,q,W,R,Me),X.transparent===!0&&X.side===Ti&&X.forceSinglePass===!1?(X.side=mn,X.needsUpdate=!0,C.renderBufferDirect(q,z,W,X,R,Me),X.side=Zi,X.needsUpdate=!0,C.renderBufferDirect(q,z,W,X,R,Me),X.side=Ti):C.renderBufferDirect(q,z,W,X,R,Me),R.onAfterRender(C,z,q,W,X,Me)}function xl(R,z,q){z.isScene!==!0&&(z=ne);let W=P.get(R),X=M.state.lights,Me=M.state.shadowsArray,Re=X.state.version,Se=ge.getParameters(R,X.state,Me,z,q,M.state.lightProbeGridArray),De=ge.getProgramCacheKey(Se),ke=W.programs;W.environment=R.isMeshStandardMaterial||R.isMeshLambertMaterial||R.isMeshPhongMaterial?z.environment:null,W.fog=z.fog;let $e=R.isMeshStandardMaterial||R.isMeshLambertMaterial&&!R.envMap||R.isMeshPhongMaterial&&!R.envMap;W.envMap=k.get(R.envMap||W.environment,$e),W.envMapRotation=W.environment!==null&&R.envMap===null?z.environmentRotation:R.envMapRotation,ke===void 0&&(R.addEventListener("dispose",It),ke=new Map,W.programs=ke);let Ke=ke.get(De);if(Ke!==void 0){if(W.currentProgram===Ke&&W.lightsStateVersion===Re)return cg(R,Se),Ke}else Se.uniforms=ge.getUniforms(R),I!==null&&R.isNodeMaterial&&I.build(R,q,Se),R.onBeforeCompile(Se,C),Ke=ge.acquireProgram(Se,De),ke.set(De,Ke),W.uniforms=Se.uniforms;let Ve=W.uniforms;return(!R.isShaderMaterial&&!R.isRawShaderMaterial||R.clipping===!0)&&(Ve.clippingPlanes=Te.uniform),cg(R,Se),W.needsLights=Q_(R),W.lightsStateVersion=Re,W.needsLights&&(Ve.ambientLightColor.value=X.state.ambient,Ve.lightProbe.value=X.state.probe,Ve.directionalLights.value=X.state.directional,Ve.directionalLightShadows.value=X.state.directionalShadow,Ve.spotLights.value=X.state.spot,Ve.spotLightShadows.value=X.state.spotShadow,Ve.rectAreaLights.value=X.state.rectArea,Ve.ltc_1.value=X.state.rectAreaLTC1,Ve.ltc_2.value=X.state.rectAreaLTC2,Ve.pointLights.value=X.state.point,Ve.pointLightShadows.value=X.state.pointShadow,Ve.hemisphereLights.value=X.state.hemi,Ve.directionalShadowMatrix.value=X.state.directionalShadowMatrix,Ve.spotLightMatrix.value=X.state.spotLightMatrix,Ve.spotLightMap.value=X.state.spotLightMap,Ve.pointShadowMatrix.value=X.state.pointShadowMatrix),W.lightProbeGrid=M.state.lightProbeGridArray.length>0,W.currentProgram=Ke,W.uniformsList=null,Ke}function lg(R){if(R.uniformsList===null){let z=R.currentProgram.getUniforms();R.uniformsList=Ao.seqWithValue(z.seq,R.uniforms)}return R.uniformsList}function cg(R,z){let q=P.get(R);q.outputColorSpace=z.outputColorSpace,q.batching=z.batching,q.batchingColor=z.batchingColor,q.instancing=z.instancing,q.instancingColor=z.instancingColor,q.instancingMorph=z.instancingMorph,q.skinning=z.skinning,q.morphTargets=z.morphTargets,q.morphNormals=z.morphNormals,q.morphColors=z.morphColors,q.morphTargetsCount=z.morphTargetsCount,q.numClippingPlanes=z.numClippingPlanes,q.numIntersection=z.numClipIntersection,q.vertexAlphas=z.vertexAlphas,q.vertexTangents=z.vertexTangents,q.toneMapping=z.toneMapping}function J_(R,z){if(R.length===0)return null;if(R.length===1)return R[0].texture!==null?R[0]:null;S.setFromMatrixPosition(z.matrixWorld);for(let q=0,W=R.length;q<W;q++){let X=R[q];if(X.texture!==null&&X.boundingBox.containsPoint(S))return X}return null}function K_(R,z,q,W,X){z.isScene!==!0&&(z=ne),b.resetTextureUnits();let Me=z.fog,Re=W.isMeshStandardMaterial||W.isMeshLambertMaterial||W.isMeshPhongMaterial?z.environment:null,Se=L===null?C.outputColorSpace:L.isXRRenderTarget===!0?L.texture.colorSpace:tt.workingColorSpace,De=W.isMeshStandardMaterial||W.isMeshLambertMaterial&&!W.envMap||W.isMeshPhongMaterial&&!W.envMap,ke=k.get(W.envMap||Re,De),$e=W.vertexColors===!0&&!!q.attributes.color&&q.attributes.color.itemSize===4,Ke=!!q.attributes.tangent&&(!!W.normalMap||W.anisotropy>0),Ve=!!q.morphAttributes.position,ht=!!q.morphAttributes.normal,Lt=!!q.morphAttributes.color,Rt=li;W.toneMapped&&(L===null||L.isXRRenderTarget===!0)&&(Rt=C.toneMapping);let ft=q.morphAttributes.position||q.morphAttributes.normal||q.morphAttributes.color,Kt=ft!==void 0?ft.length:0,Ce=P.get(W),En=M.state.lights;if(at===!0&&(qe===!0||R!==B)){let mt=R===B&&W.id===N;Te.setState(W,R,mt)}let st=!1;W.version===Ce.__version?(Ce.needsLights&&Ce.lightsStateVersion!==En.state.version||Ce.outputColorSpace!==Se||X.isBatchedMesh&&Ce.batching===!1||!X.isBatchedMesh&&Ce.batching===!0||X.isBatchedMesh&&Ce.batchingColor===!0&&X.colorTexture===null||X.isBatchedMesh&&Ce.batchingColor===!1&&X.colorTexture!==null||X.isInstancedMesh&&Ce.instancing===!1||!X.isInstancedMesh&&Ce.instancing===!0||X.isSkinnedMesh&&Ce.skinning===!1||!X.isSkinnedMesh&&Ce.skinning===!0||X.isInstancedMesh&&Ce.instancingColor===!0&&X.instanceColor===null||X.isInstancedMesh&&Ce.instancingColor===!1&&X.instanceColor!==null||X.isInstancedMesh&&Ce.instancingMorph===!0&&X.morphTexture===null||X.isInstancedMesh&&Ce.instancingMorph===!1&&X.morphTexture!==null||Ce.envMap!==ke||W.fog===!0&&Ce.fog!==Me||Ce.numClippingPlanes!==void 0&&(Ce.numClippingPlanes!==Te.numPlanes||Ce.numIntersection!==Te.numIntersection)||Ce.vertexAlphas!==$e||Ce.vertexTangents!==Ke||Ce.morphTargets!==Ve||Ce.morphNormals!==ht||Ce.morphColors!==Lt||Ce.toneMapping!==Rt||Ce.morphTargetsCount!==Kt||!!Ce.lightProbeGrid!=M.state.lightProbeGridArray.length>0)&&(st=!0):(st=!0,Ce.__version=W.version);let kn=Ce.currentProgram;st===!0&&(kn=xl(W,z,X),I&&W.isNodeMaterial&&I.onUpdateProgram(W,kn,Ce));let fi=!1,Qi=!1,vs=!1,dt=kn.getUniforms(),Dt=Ce.uniforms;if(re.useProgram(kn.program)&&(fi=!0,Qi=!0,vs=!0),W.id!==N&&(N=W.id,Qi=!0),Ce.needsLights){let mt=J_(M.state.lightProbeGridArray,X);Ce.lightProbeGrid!==mt&&(Ce.lightProbeGrid=mt,Qi=!0)}if(fi||B!==R){re.buffers.depth.getReversed()&&R.reversedDepth!==!0&&(R._reversedDepth=!0,R.updateProjectionMatrix()),dt.setValue(U,"projectionMatrix",R.projectionMatrix),dt.setValue(U,"viewMatrix",R.matrixWorldInverse);let tr=dt.map.cameraPosition;tr!==void 0&&tr.setValue(U,rt.setFromMatrixPosition(R.matrixWorld)),xe.logarithmicDepthBuffer&&dt.setValue(U,"logDepthBufFC",2/(Math.log(R.far+1)/Math.LN2)),(W.isMeshPhongMaterial||W.isMeshToonMaterial||W.isMeshLambertMaterial||W.isMeshBasicMaterial||W.isMeshStandardMaterial||W.isShaderMaterial)&&dt.setValue(U,"isOrthographic",R.isOrthographicCamera===!0),B!==R&&(B=R,Qi=!0,vs=!0)}if(Ce.needsLights&&(En.state.directionalShadowMap.length>0&&dt.setValue(U,"directionalShadowMap",En.state.directionalShadowMap,b),En.state.spotShadowMap.length>0&&dt.setValue(U,"spotShadowMap",En.state.spotShadowMap,b),En.state.pointShadowMap.length>0&&dt.setValue(U,"pointShadowMap",En.state.pointShadowMap,b)),X.isSkinnedMesh){dt.setOptional(U,X,"bindMatrix"),dt.setOptional(U,X,"bindMatrixInverse");let mt=X.skeleton;mt&&(mt.boneTexture===null&&mt.computeBoneTexture(),dt.setValue(U,"boneTexture",mt.boneTexture,b))}X.isBatchedMesh&&(dt.setOptional(U,X,"batchingTexture"),dt.setValue(U,"batchingTexture",X._matricesTexture,b),dt.setOptional(U,X,"batchingIdTexture"),dt.setValue(U,"batchingIdTexture",X._indirectTexture,b),dt.setOptional(U,X,"batchingColorTexture"),X._colorsTexture!==null&&dt.setValue(U,"batchingColorTexture",X._colorsTexture,b));let er=q.morphAttributes;if((er.position!==void 0||er.normal!==void 0||er.color!==void 0)&&Xe.update(X,q,kn),(Qi||Ce.receiveShadow!==X.receiveShadow)&&(Ce.receiveShadow=X.receiveShadow,dt.setValue(U,"receiveShadow",X.receiveShadow)),(W.isMeshStandardMaterial||W.isMeshLambertMaterial||W.isMeshPhongMaterial)&&W.envMap===null&&z.environment!==null&&(Dt.envMapIntensity.value=z.environmentIntensity),Dt.dfgLUT!==void 0&&(Dt.dfgLUT.value=gC()),Qi){if(dt.setValue(U,"toneMappingExposure",C.toneMappingExposure),Ce.needsLights&&j_(Dt,vs),Me&&W.fog===!0&&$.refreshFogUniforms(Dt,Me),$.refreshMaterialUniforms(Dt,W,Ue,Ie,M.state.transmissionRenderTarget[R.id]),Ce.needsLights&&Ce.lightProbeGrid){let mt=Ce.lightProbeGrid;Dt.probesSH.value=mt.texture,Dt.probesMin.value.copy(mt.boundingBox.min),Dt.probesMax.value.copy(mt.boundingBox.max),Dt.probesResolution.value.copy(mt.resolution)}Ao.upload(U,lg(Ce),Dt,b)}if(W.isShaderMaterial&&W.uniformsNeedUpdate===!0&&(Ao.upload(U,lg(Ce),Dt,b),W.uniformsNeedUpdate=!1),W.isSpriteMaterial&&dt.setValue(U,"center",X.center),dt.setValue(U,"modelViewMatrix",X.modelViewMatrix),dt.setValue(U,"normalMatrix",X.normalMatrix),dt.setValue(U,"modelMatrix",X.matrixWorld),W.uniformsGroups!==void 0){let mt=W.uniformsGroups;for(let tr=0,xs=mt.length;tr<xs;tr++){let ug=mt[tr];ee.update(ug,kn),ee.bind(ug,kn)}}return kn}function j_(R,z){R.ambientLightColor.needsUpdate=z,R.lightProbe.needsUpdate=z,R.directionalLights.needsUpdate=z,R.directionalLightShadows.needsUpdate=z,R.pointLights.needsUpdate=z,R.pointLightShadows.needsUpdate=z,R.spotLights.needsUpdate=z,R.spotLightShadows.needsUpdate=z,R.rectAreaLights.needsUpdate=z,R.hemisphereLights.needsUpdate=z}function Q_(R){return R.isMeshLambertMaterial||R.isMeshToonMaterial||R.isMeshPhongMaterial||R.isMeshStandardMaterial||R.isShadowMaterial||R.isShaderMaterial&&R.lights===!0}this.getActiveCubeFace=function(){return D},this.getActiveMipmapLevel=function(){return F},this.getRenderTarget=function(){return L},this.setRenderTargetTextures=function(R,z,q){let W=P.get(R);W.__autoAllocateDepthBuffer=R.resolveDepthBuffer===!1,W.__autoAllocateDepthBuffer===!1&&(W.__useRenderToTexture=!1),P.get(R.texture).__webglTexture=z,P.get(R.depthTexture).__webglTexture=W.__autoAllocateDepthBuffer?void 0:q,W.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(R,z){let q=P.get(R);q.__webglFramebuffer=z,q.__useDefaultFramebuffer=z===void 0};let eS=U.createFramebuffer();this.setRenderTarget=function(R,z=0,q=0){L=R,D=z,F=q;let W=null,X=!1,Me=!1;if(R){let Se=P.get(R);if(Se.__useDefaultFramebuffer!==void 0){re.bindFramebuffer(U.FRAMEBUFFER,Se.__webglFramebuffer),H.copy(R.viewport),Z.copy(R.scissor),Y=R.scissorTest,re.viewport(H),re.scissor(Z),re.setScissorTest(Y),N=-1;return}else if(Se.__webglFramebuffer===void 0)b.setupRenderTarget(R);else if(Se.__hasExternalTextures)b.rebindTextures(R,P.get(R.texture).__webglTexture,P.get(R.depthTexture).__webglTexture);else if(R.depthBuffer){let $e=R.depthTexture;if(Se.__boundDepthTexture!==$e){if($e!==null&&P.has($e)&&(R.width!==$e.image.width||R.height!==$e.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");b.setupDepthRenderbuffer(R)}}let De=R.texture;(De.isData3DTexture||De.isDataArrayTexture||De.isCompressedArrayTexture)&&(Me=!0);let ke=P.get(R).__webglFramebuffer;R.isWebGLCubeRenderTarget?(Array.isArray(ke[z])?W=ke[z][q]:W=ke[z],X=!0):R.samples>0&&b.useMultisampledRTT(R)===!1?W=P.get(R).__webglMultisampledFramebuffer:Array.isArray(ke)?W=ke[q]:W=ke,H.copy(R.viewport),Z.copy(R.scissor),Y=R.scissorTest}else H.copy(ae).multiplyScalar(Ue).floor(),Z.copy(Ae).multiplyScalar(Ue).floor(),Y=be;if(q!==0&&(W=eS),re.bindFramebuffer(U.FRAMEBUFFER,W)&&re.drawBuffers(R,W),re.viewport(H),re.scissor(Z),re.setScissorTest(Y),X){let Se=P.get(R.texture);U.framebufferTexture2D(U.FRAMEBUFFER,U.COLOR_ATTACHMENT0,U.TEXTURE_CUBE_MAP_POSITIVE_X+z,Se.__webglTexture,q)}else if(Me){let Se=z;for(let De=0;De<R.textures.length;De++){let ke=P.get(R.textures[De]);U.framebufferTextureLayer(U.FRAMEBUFFER,U.COLOR_ATTACHMENT0+De,ke.__webglTexture,q,Se)}}else if(R!==null&&q!==0){let Se=P.get(R.texture);U.framebufferTexture2D(U.FRAMEBUFFER,U.COLOR_ATTACHMENT0,U.TEXTURE_2D,Se.__webglTexture,q)}N=-1},this.readRenderTargetPixels=function(R,z,q,W,X,Me,Re,Se=0){if(!(R&&R.isWebGLRenderTarget)){We("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let De=P.get(R).__webglFramebuffer;if(R.isWebGLCubeRenderTarget&&Re!==void 0&&(De=De[Re]),De){re.bindFramebuffer(U.FRAMEBUFFER,De);try{let ke=R.textures[Se],$e=ke.format,Ke=ke.type;if(R.textures.length>1&&U.readBuffer(U.COLOR_ATTACHMENT0+Se),!xe.textureFormatReadable($e)){We("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!xe.textureTypeReadable(Ke)){We("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}z>=0&&z<=R.width-W&&q>=0&&q<=R.height-X&&U.readPixels(z,q,W,X,O.convert($e),O.convert(Ke),Me)}finally{let ke=L!==null?P.get(L).__webglFramebuffer:null;re.bindFramebuffer(U.FRAMEBUFFER,ke)}}},this.readRenderTargetPixelsAsync=async function(R,z,q,W,X,Me,Re,Se=0){if(!(R&&R.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let De=P.get(R).__webglFramebuffer;if(R.isWebGLCubeRenderTarget&&Re!==void 0&&(De=De[Re]),De)if(z>=0&&z<=R.width-W&&q>=0&&q<=R.height-X){re.bindFramebuffer(U.FRAMEBUFFER,De);let ke=R.textures[Se],$e=ke.format,Ke=ke.type;if(R.textures.length>1&&U.readBuffer(U.COLOR_ATTACHMENT0+Se),!xe.textureFormatReadable($e))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!xe.textureTypeReadable(Ke))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Ve=U.createBuffer();U.bindBuffer(U.PIXEL_PACK_BUFFER,Ve),U.bufferData(U.PIXEL_PACK_BUFFER,Me.byteLength,U.STREAM_READ),U.readPixels(z,q,W,X,O.convert($e),O.convert(Ke),0);let ht=L!==null?P.get(L).__webglFramebuffer:null;re.bindFramebuffer(U.FRAMEBUFFER,ht);let Lt=U.fenceSync(U.SYNC_GPU_COMMANDS_COMPLETE,0);return U.flush(),await t_(U,Lt,4),U.bindBuffer(U.PIXEL_PACK_BUFFER,Ve),U.getBufferSubData(U.PIXEL_PACK_BUFFER,0,Me),U.deleteBuffer(Ve),U.deleteSync(Lt),Me}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(R,z=null,q=0){let W=Math.pow(2,-q),X=Math.floor(R.image.width*W),Me=Math.floor(R.image.height*W),Re=z!==null?z.x:0,Se=z!==null?z.y:0;b.setTexture2D(R,0),U.copyTexSubImage2D(U.TEXTURE_2D,q,0,0,Re,Se,X,Me),re.unbindTexture()};let tS=U.createFramebuffer(),nS=U.createFramebuffer();this.copyTextureToTexture=function(R,z,q=null,W=null,X=0,Me=0){let Re,Se,De,ke,$e,Ke,Ve,ht,Lt,Rt=R.isCompressedTexture?R.mipmaps[Me]:R.image;if(q!==null)Re=q.max.x-q.min.x,Se=q.max.y-q.min.y,De=q.isBox3?q.max.z-q.min.z:1,ke=q.min.x,$e=q.min.y,Ke=q.isBox3?q.min.z:0;else{let Dt=Math.pow(2,-X);Re=Math.floor(Rt.width*Dt),Se=Math.floor(Rt.height*Dt),R.isDataArrayTexture?De=Rt.depth:R.isData3DTexture?De=Math.floor(Rt.depth*Dt):De=1,ke=0,$e=0,Ke=0}W!==null?(Ve=W.x,ht=W.y,Lt=W.z):(Ve=0,ht=0,Lt=0);let ft=O.convert(z.format),Kt=O.convert(z.type),Ce;z.isData3DTexture?(b.setTexture3D(z,0),Ce=U.TEXTURE_3D):z.isDataArrayTexture||z.isCompressedArrayTexture?(b.setTexture2DArray(z,0),Ce=U.TEXTURE_2D_ARRAY):(b.setTexture2D(z,0),Ce=U.TEXTURE_2D),re.activeTexture(U.TEXTURE0),re.pixelStorei(U.UNPACK_FLIP_Y_WEBGL,z.flipY),re.pixelStorei(U.UNPACK_PREMULTIPLY_ALPHA_WEBGL,z.premultiplyAlpha),re.pixelStorei(U.UNPACK_ALIGNMENT,z.unpackAlignment);let En=re.getParameter(U.UNPACK_ROW_LENGTH),st=re.getParameter(U.UNPACK_IMAGE_HEIGHT),kn=re.getParameter(U.UNPACK_SKIP_PIXELS),fi=re.getParameter(U.UNPACK_SKIP_ROWS),Qi=re.getParameter(U.UNPACK_SKIP_IMAGES);re.pixelStorei(U.UNPACK_ROW_LENGTH,Rt.width),re.pixelStorei(U.UNPACK_IMAGE_HEIGHT,Rt.height),re.pixelStorei(U.UNPACK_SKIP_PIXELS,ke),re.pixelStorei(U.UNPACK_SKIP_ROWS,$e),re.pixelStorei(U.UNPACK_SKIP_IMAGES,Ke);let vs=R.isDataArrayTexture||R.isData3DTexture,dt=z.isDataArrayTexture||z.isData3DTexture;if(R.isDepthTexture){let Dt=P.get(R),er=P.get(z),mt=P.get(Dt.__renderTarget),tr=P.get(er.__renderTarget);re.bindFramebuffer(U.READ_FRAMEBUFFER,mt.__webglFramebuffer),re.bindFramebuffer(U.DRAW_FRAMEBUFFER,tr.__webglFramebuffer);for(let xs=0;xs<De;xs++)vs&&(U.framebufferTextureLayer(U.READ_FRAMEBUFFER,U.COLOR_ATTACHMENT0,P.get(R).__webglTexture,X,Ke+xs),U.framebufferTextureLayer(U.DRAW_FRAMEBUFFER,U.COLOR_ATTACHMENT0,P.get(z).__webglTexture,Me,Lt+xs)),U.blitFramebuffer(ke,$e,Re,Se,Ve,ht,Re,Se,U.DEPTH_BUFFER_BIT,U.NEAREST);re.bindFramebuffer(U.READ_FRAMEBUFFER,null),re.bindFramebuffer(U.DRAW_FRAMEBUFFER,null)}else if(X!==0||R.isRenderTargetTexture||P.has(R)){let Dt=P.get(R),er=P.get(z);re.bindFramebuffer(U.READ_FRAMEBUFFER,tS),re.bindFramebuffer(U.DRAW_FRAMEBUFFER,nS);for(let mt=0;mt<De;mt++)vs?U.framebufferTextureLayer(U.READ_FRAMEBUFFER,U.COLOR_ATTACHMENT0,Dt.__webglTexture,X,Ke+mt):U.framebufferTexture2D(U.READ_FRAMEBUFFER,U.COLOR_ATTACHMENT0,U.TEXTURE_2D,Dt.__webglTexture,X),dt?U.framebufferTextureLayer(U.DRAW_FRAMEBUFFER,U.COLOR_ATTACHMENT0,er.__webglTexture,Me,Lt+mt):U.framebufferTexture2D(U.DRAW_FRAMEBUFFER,U.COLOR_ATTACHMENT0,U.TEXTURE_2D,er.__webglTexture,Me),X!==0?U.blitFramebuffer(ke,$e,Re,Se,Ve,ht,Re,Se,U.COLOR_BUFFER_BIT,U.NEAREST):dt?U.copyTexSubImage3D(Ce,Me,Ve,ht,Lt+mt,ke,$e,Re,Se):U.copyTexSubImage2D(Ce,Me,Ve,ht,ke,$e,Re,Se);re.bindFramebuffer(U.READ_FRAMEBUFFER,null),re.bindFramebuffer(U.DRAW_FRAMEBUFFER,null)}else dt?R.isDataTexture||R.isData3DTexture?U.texSubImage3D(Ce,Me,Ve,ht,Lt,Re,Se,De,ft,Kt,Rt.data):z.isCompressedArrayTexture?U.compressedTexSubImage3D(Ce,Me,Ve,ht,Lt,Re,Se,De,ft,Rt.data):U.texSubImage3D(Ce,Me,Ve,ht,Lt,Re,Se,De,ft,Kt,Rt):R.isDataTexture?U.texSubImage2D(U.TEXTURE_2D,Me,Ve,ht,Re,Se,ft,Kt,Rt.data):R.isCompressedTexture?U.compressedTexSubImage2D(U.TEXTURE_2D,Me,Ve,ht,Rt.width,Rt.height,ft,Rt.data):U.texSubImage2D(U.TEXTURE_2D,Me,Ve,ht,Re,Se,ft,Kt,Rt);re.pixelStorei(U.UNPACK_ROW_LENGTH,En),re.pixelStorei(U.UNPACK_IMAGE_HEIGHT,st),re.pixelStorei(U.UNPACK_SKIP_PIXELS,kn),re.pixelStorei(U.UNPACK_SKIP_ROWS,fi),re.pixelStorei(U.UNPACK_SKIP_IMAGES,Qi),Me===0&&z.generateMipmaps&&U.generateMipmap(Ce),re.unbindTexture()},this.initRenderTarget=function(R){P.get(R).__webglFramebuffer===void 0&&b.setupRenderTarget(R)},this.initTexture=function(R){R.isCubeTexture?b.setTextureCube(R,0):R.isData3DTexture?b.setTexture3D(R,0):R.isDataArrayTexture||R.isCompressedArrayTexture?b.setTexture2DArray(R,0):b.setTexture2D(R,0),re.unbindTexture()},this.resetState=function(){D=0,F=0,L=null,re.reset(),he.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return ai}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=tt._getDrawingBufferColorSpace(e),t.unpackColorSpace=tt._getUnpackColorSpace()}};function k_(n,e=1e-4){e=Math.max(e,Number.EPSILON);let t={},i=n.getIndex(),r=n.getAttribute("position"),s=i?i.count:r.count,o=0,a=Object.keys(n.attributes),l={},u={},f=[],c=["getX","getY","getZ","getW"],h=["setX","setY","setZ","setW"];for(let v=0,g=a.length;v<g;v++){let S=a[v],E=n.attributes[S];l[S]=new E.constructor(new E.array.constructor(E.count*E.itemSize),E.itemSize,E.normalized);let M=n.morphAttributes[S];M&&(u[S]||(u[S]=[]),M.forEach((T,x)=>{let w=new T.array.constructor(T.count*T.itemSize);u[S][x]=new T.constructor(w,T.itemSize,T.normalized)}))}let d=e*.5,p=Math.log10(1/e),_=Math.pow(10,p),y=d*_;for(let v=0;v<s;v++){let g=i?i.getX(v):v,S="";for(let E=0,M=a.length;E<M;E++){let T=a[E],x=n.getAttribute(T),w=x.itemSize;for(let C=0;C<w;C++)S+=`${~~(x[c[C]](g)*_+y)},`}if(S in t)f.push(t[S]);else{for(let E=0,M=a.length;E<M;E++){let T=a[E],x=n.getAttribute(T),w=n.morphAttributes[T],C=x.itemSize,A=l[T],I=u[T];for(let D=0;D<C;D++){let F=c[D],L=h[D];if(A[L](o,x[F](g)),w)for(let N=0,B=w.length;N<B;N++)I[N][L](o,w[N][F](g))}}t[S]=o,f.push(o),o++}}let m=n.clone();for(let v in n.attributes){let g=l[v];if(m.setAttribute(v,new g.constructor(g.array.slice(0,o*g.itemSize),g.itemSize,g.normalized)),v in u)for(let S=0;S<u[v].length;S++){let E=u[v][S];m.morphAttributes[v][S]=new E.constructor(E.array.slice(0,o*E.itemSize),E.itemSize,E.normalized)}}return m.setIndex(f),m}var pt=Co(tg());document.documentElement.lang="it";var EC="html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{background:#050607}";(()=>{"use strict";var T;if(window.PlayableIdlePreview)return;let n=new URLSearchParams(location.search),e=n.get("feedReview")==="1"||n.get("host")==="fyp",t=matchMedia("(prefers-reduced-motion: reduce)"),i=e,r=0,s=performance.now(),o=new Set,a=()=>{let x=document.documentElement;if(x.dataset.batch2Idle=String(i),x.dataset.batch2IdlePaused=String(document.hidden),x.dataset.batch2IdleReduced=String(t.matches),!i)for(let w of document.querySelectorAll("[data-idle-preview]"))w.dataset.idlePreview="off";s=performance.now();for(let w of o)w(i&&!document.hidden)},l=()=>{let x=performance.now();return i&&!document.hidden&&!t.matches&&(r+=Math.min(64,Math.max(0,x-s))),s=x,t.matches?1600:r},u=(x,w=0,C=1)=>Math.max(w,Math.min(C,x)),f=x=>(x=u(x),x*x*(3-2*x)),c=(x,w,C=1)=>{if(!w.length)return;let A=w.slice(1).map((D,F)=>Math.hypot(D.x-w[F].x,D.y-w[F].y)),I=A.reduce((D,F)=>D+F,0)*u(C);x.beginPath(),x.moveTo(w[0].x,w[0].y);for(let D=1;D<w.length;D++){let F=w[D-1],L=w[D],N=A[D-1],B=Math.min(1,I/Math.max(.01,N));if(x.lineTo(F.x+(L.x-F.x)*B,F.y+(L.y-F.y)*B),I-=N,I<=0)break}x.stroke()},h=(x,w)=>{let C=x.slice(1).map((I,D)=>Math.hypot(I.x-x[D].x,I.y-x[D].y)),A=C.reduce((I,D)=>I+D,0)*u(w);for(let I=1;I<x.length;I++){let D=x[I-1],F=x[I],L=C[I-1];if(A<=L||I===x.length-1){let N=u(A/Math.max(.01,L));return{x:D.x+(F.x-D.x)*N,y:D.y+(F.y-D.y)*N}}A-=L}return x[0]},d=(x,w,C=l())=>{x&&(x.dataset.idlePreview=i?w:"off",x.dataset.idlePhase=String(Math.round(C)))};function p(x,w,C,A){let I=l()/1e3,D=I%5.4/5.4,F=w*.5,L=C*.51,N=Math.min(w*.29,105),B=Math.min(C*.16,78),H=Array.from({length:81},(se,ue)=>({x:F+Math.cos(ue/80*Math.PI*2)*N,y:L+Math.sin(ue/80*Math.PI*2)*B}));x.save(),x.lineWidth=5,x.lineCap="round",x.lineJoin="round",x.strokeStyle="#242322",x.globalAlpha=D>.88?(1-D)/.12:1,c(x,H,f(D/.48));let Z=F+Math.sin(I*2.1)*N*.63,Y=L+Math.sin(I*2.8)*B*.59;if(x.translate(Z,Y),x.rotate(Math.atan2(Math.cos(I*2.8)*B,Math.cos(I*2.1)*N)+Math.PI/2),A!=null&&A.complete&&A.naturalWidth)x.drawImage(A,-17,-17,34,34);else{x.fillStyle="#242322";for(let[se,ue]of[[-7,5],[0,4],[7,6]])x.beginPath(),x.ellipse(0,se,ue,ue*1.2,0,0,Math.PI*2),x.fill()}x.restore(),d(x.canvas,"ant-loop")}function _(x,w,C){let A=l()/1e3,I=x.entities.filter(L=>L.team==="player"),D=I.reduce((L,N)=>L+N.x,0)/Math.max(1,I.length),F=I.reduce((L,N)=>L+N.y,0)/Math.max(1,I.length);return{...x,particles:[],playerTarget:{x:w*(.5+Math.sin(A*.8)*.18),y:C*(.43+Math.cos(A*.8)*.04)},entities:x.entities.map((L,N)=>({...L,x:L.team==="player"?w*(.5+Math.sin(A*.8)*.14)+(L.x-D)*.7:L.x+Math.sin(A*1.5+N*.7)*8,y:L.team==="player"?C*(.57+Math.cos(A*.8)*.04)+(L.y-F)*.7:L.y+Math.cos(A*1.5+N*.7)*8}))}}function y(x,w,C,A,I){let D=l()/1e3,F=D%5.8/5.8,L=w/2,N=(A+I)/2,B=[[-.22,.16],[-.11,.02],[.04,.04],[.17,-.17],[.24,-.11]].map(([H,Z])=>({x:L+H*w,y:N+Z*(I-A)}));x.save(),x.strokeStyle="#303936",x.lineWidth=6,x.lineCap="round",x.lineJoin="round",x.globalAlpha=F>.9?(1-F)/.1:1,F<.5?c(x,B,f(F/.45)):(x.translate(L,N),x.rotate((F-.5)*Math.PI*3.4),c(x,B.map(H=>({x:H.x-L,y:H.y-N}))),x.fillStyle="#303936",x.beginPath(),x.arc(0,0,11,0,Math.PI*2),x.fill()),x.restore(),d(x.canvas,"draw-and-spin-blade")}function m(x){let w=l()/1e3,C=x==="player"?0:x==="copL"?1.3:2.2,A=w*.75-C,I=375+Math.sin(A)*130,D=x==="player"?800:1040+(x==="copR"?60:0);return{x:I+(x==="copL"?-85:x==="copR"?85:0),y:D+Math.cos(A)*28,angle:-Math.PI/2+Math.cos(A)*.18}}function v(x){let w=m("player");x.save(),x.strokeStyle="#ffffff88",x.setLineDash([11,12]),x.lineWidth=5,x.beginPath(),x.moveTo(w.x,w.y),x.bezierCurveTo(w.x+100,w.y-100,340,w.y-220,420,w.y-340),x.stroke(),x.restore(),d(x.canvas,"escape-route")}function g(x,w,C,A){let I=[x,w];for(let H of C)for(let Z=0;Z<12;Z++){let Y=Z*Math.PI/6,se=H.circleRadius+16,ue={x:H.position.x+Math.cos(Y)*se,y:H.position.y+Math.sin(Y)*se};ue.x>15&&ue.x<A-15&&I.push(ue)}let D=I.map(()=>1/0),F=I.map(()=>-1),L=new Set;D[0]=0;let N=(H,Z)=>C.every(Y=>{let se=Z.x-H.x,ue=Z.y-H.y,Be=u(((Y.position.x-H.x)*se+(Y.position.y-H.y)*ue)/Math.max(.01,se*se+ue*ue));return Math.hypot(H.x+se*Be-Y.position.x,H.y+ue*Be-Y.position.y)>Y.circleRadius+7});for(let H=0;H<I.length;H++){let Z=-1;for(let Y=0;Y<I.length;Y++)!L.has(Y)&&(Z<0||D[Y]<D[Z])&&(Z=Y);if(Z<0||!Number.isFinite(D[Z])||Z===1)break;L.add(Z);for(let Y=0;Y<I.length;Y++){if(L.has(Y)||!N(I[Z],I[Y]))continue;let se=D[Z]+Math.hypot(I[Z].x-I[Y].x,I[Z].y-I[Y].y);se<D[Y]&&(D[Y]=se,F[Y]=Z)}}if(F[1]<0)return[x,{x:20,y:x.y+24},{x:20,y:w.y-28},w];let B=[];for(let H=1;H>=0&&(B.unshift(I[H]),H!==0);H=F[H]);return B}let S=null;function E(x,w,C,A,I,D,F){if(!w||!C)return;let L=l()/1e3,N=L%5.6,B=D.filter(Y=>Y.label==="obstacle"),H=JSON.stringify([w,C,F,B.map(Y=>[Y.position.x,Y.position.y,Y.circleRadius])]);(S==null?void 0:S.key)!==H&&(S={key:H,points:g({x:w.x,y:w.y+21},{x:C.x,y:C.y-I*.42},B,F)});let Z=S.points;if(x.save(),x.strokeStyle="#242322",x.lineWidth=5,x.lineCap="round",x.lineJoin="round",x.globalAlpha=N>5?(5.6-N)/.6:1,c(x,Z,f(N/1.7)),N>1.4&&N<5)for(let Y=0;Y<15;Y++){let se=(N-1.4)*.65-Y*.067;if(se<0||se>1)continue;let ue=h(Z,se);x.fillStyle="#59c6b1",x.strokeStyle="#242322",x.lineWidth=1,x.beginPath(),x.arc(ue.x,ue.y,4,0,Math.PI*2),x.fill(),x.stroke()}x.restore(),d(x.canvas,"guided-soda-route")}let M=document.createElement("style");M.dataset.batch2IdleStyle="",M.textContent=`
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
  `,document.head.append(M),window.PlayableIdlePreview=Object.freeze({get active(){return i&&!document.hidden},get preview(){return i},get reduced(){return t.matches},get seconds(){return l()/1e3},clock:l,ease:f,clamp:u,stamp:d,trace:c,onPath:h,ant:p,army:_,blade:y,road:v,roadPose:m,soda:E,subscribe(x){return o.add(x),()=>o.delete(x)}}),addEventListener("message",x=>{var C;if(parent===window||x.source!==parent||x.origin!==location.origin||((C=x.data)==null?void 0:C.type)!=="playable-active")return;let w=x.data.active!==!0;w!==i&&(i=w,r=0),a()}),document.addEventListener("visibilitychange",a),(T=t.addEventListener)==null||T.call(t,"change",a),addEventListener("pagehide",()=>{i=!1,a(),o.clear()},{once:!0}),a()})();var H_=(()=>{let n=window.parent!==window&&new URLSearchParams(location.search).get("feedReview")==="1",e=!n,t=new Set,i=()=>{document.documentElement.dataset.feedPreview=String(!e);for(let r of t)r(e&&!document.hidden)};return window.addEventListener("message",r=>{var s;!n||r.source!==parent||r.origin!==location.origin||((s=r.data)==null?void 0:s.type)!=="playable-active"||(e=r.data.active===!0,i())}),document.addEventListener("visibilitychange",i),i(),{get active(){return e&&!document.hidden},subscribe(r){return t.add(r),()=>t.delete(r)}}})(),M3=window.matchMedia("(prefers-reduced-motion: reduce)");function TC(){let[n,e]=it.default.useState(H_.active);return it.default.useEffect(()=>H_.subscribe(e),[]),n}var AC=`
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
`;var W_={TRACE_CLOSE_GAP:28,TRACE_MIN_LENGTH:90,SOFT_BODY_COLUMNS:9,SOFT_BODY_ROWS:9,GRAVITY:.7,BODY_WIDTH_RATIO:.8,GUIDE_TEXT:"Ricalca il contorno del gatto",RESET_LABEL:"Ricomincia",CONFIRM_LABEL:"Crea lo squishy",RESET_SHAPE_LABEL:"Rifai la forma",CHOOSE_LABEL:"Scegli foto",PICKER_TITLE:"Scegli una foto",BACK_LABEL:"Indietro",HAMSTER_HONEY:"./assets/cat-phone-rug.webp",HAMSTER_CARAMEL:"./assets/cat-phone-sofa.webp",HAMSTER_SILVER:"./assets/cat-phone-window.webp"},Ct=(n,e,t)=>Math.max(e,Math.min(t,n)),bC=(n,e)=>Math.hypot(n.x-e.x,n.y-e.y),Kh=n=>Math.abs(n.reduce((e,t,i)=>{let r=n[(i+1)%n.length];return e+t.u*r.v-r.u*t.v},0))/2;function ng(n,e,t,i=.5){let r=Math.max(n/t.width,e/t.height),s=t.width*r,o=t.height*r;return{x:Ct(n/2-s*i,n-s,0),y:(e-o)/2,width:s,height:o}}var CC=[[.363,.055],[.358,.104],[.36,.153],[.347,.196],[.325,.236],[.31,.28],[.305,.321],[.272,.367],[.24,.431],[.218,.51],[.215,.602],[.23,.674],[.269,.736],[.3,.771],[.293,.793],[.295,.818],[.309,.835],[.337,.839],[.357,.833],[.369,.813],[.381,.79],[.43,.802],[.482,.807],[.519,.811],[.516,.839],[.53,.855],[.557,.858],[.575,.844],[.584,.816],[.609,.798],[.637,.795],[.659,.776],[.679,.749],[.735,.715],[.769,.67],[.806,.664],[.853,.675],[.885,.682],[.907,.681],[.924,.67],[.928,.652],[.917,.631],[.891,.614],[.852,.603],[.813,.597],[.779,.598],[.777,.529],[.762,.46],[.737,.392],[.702,.341],[.655,.31],[.633,.288],[.644,.242],[.645,.202],[.642,.172],[.657,.127],[.655,.108],[.645,.097],[.625,.103],[.596,.121],[.567,.147],[.53,.137],[.491,.126],[.455,.131],[.427,.118],[.399,.082],[.377,.062],[.363,.055]],RC=n=>CC.map(([e,t])=>({x:n.x+e*n.width,y:n.y+t*n.height}));function Jh(n){let e=n.filter((t,i)=>!i||Math.hypot(t.u-n[i-1].u,t.v-n[i-1].v)>.0015).map(t=>({...t}));return e.length>2&&Math.hypot(e[0].u-e.at(-1).u,e[0].v-e.at(-1).v)<.003&&e.pop(),e.length>180?Array.from({length:180},(t,i)=>e[Math.floor(i*e.length/180)]):e}function PC(n,e,t,i){let r=e.u-n.u,s=e.v-n.v,o=i.u-t.u,a=i.v-t.v,l=t.u-n.u,u=t.v-n.v,f=r*a-s*o,c=1e-10;if(Math.abs(f)<c){if(Math.abs(l*s-u*r)>c)return null;let p=r*r+s*s;if(p<c)return null;let _=(l*r+u*s)/p,y=((i.u-n.u)*r+(i.v-n.v)*s)/p,m=Math.max(0,Math.min(_,y)),v=Math.min(1,Math.max(_,y));return m>v+c?null:{u:n.u+r*m,v:n.v+s*m}}let h=(l*a-u*o)/f,d=(l*s-u*r)/f;return h<-c||h>1+c||d<-c||d>1+c?null:{u:n.u+r*Ct(h,0,1),v:n.v+s*Ct(h,0,1)}}function q_(n){for(let e=0;e<n.length;e++)for(let t=e+2;t<n.length;t++){if(e===0&&t===n.length-1)continue;let i=PC(n[e],n[(e+1)%n.length],n[t],n[(t+1)%n.length]);if(i)return{i:e,j:t,point:i}}return null}function Z_(n){return!!q_(n)}function IC(n){let e=Jh(n);for(let t=0;t<180&&e.length>2;t++){let i=q_(e);if(!i)break;let{i:r,j:s,point:o}=i,a=Jh([o,...e.slice(r+1,s+1)]),l=Jh([o,...e.slice(s+1),...e.slice(0,r+1)]),u=Kh(a)>=Kh(l)?a:l;if(u.length>=e.length)return[];e=u}return Z_(e)?[]:e}function LC(n,e){let t=Math.max(0,Math.floor(Math.min(...e.map(S=>S.u))*n.width)),i=Math.max(0,Math.floor(Math.min(...e.map(S=>S.v))*n.height)),r=Math.min(n.width,Math.ceil(Math.max(...e.map(S=>S.u))*n.width)),s=Math.min(n.height,Math.ceil(Math.max(...e.map(S=>S.v))*n.height)),o=r-t,a=s-i,l=Math.min(1,1024/Math.max(o,a));if(o<8||a<8)throw Error("Ricalca un'area pi\xF9 grande della foto.");let u=document.createElement("canvas");u.width=Math.max(1,Math.round(o*l)),u.height=Math.max(1,Math.round(a*l));let f=u.getContext("2d");f.save(),f.scale(l,l),f.translate(-t,-i),f.beginPath(),e.forEach((S,E)=>E?f.lineTo(S.u*n.width,S.v*n.height):f.moveTo(S.u*n.width,S.v*n.height)),f.closePath(),f.clip(),f.drawImage(n,0,0),f.restore();let c=f.getImageData(0,0,u.width,u.height).data,h=0,d=0,p=0,_=0;for(let S=0;S<c.length;S+=4)c[S+3]>100&&(h++,d+=c[S],p+=c[S+1],_+=c[S+2]);if(h<100)throw Error("Mantieni il contorno all'interno della foto.");let y=3/Math.max(o,a),m=e.map(S=>new Ee((S.u*n.width-t-o/2)*y,(a/2-(S.v*n.height-i))*y)),v=document.createElement("canvas");v.width=u.width,v.height=u.height;let g=v.getContext("2d");return g.fillStyle=`rgb(${Math.round(d/h)},${Math.round(p/h)},${Math.round(_/h)})`,g.fillRect(0,0,v.width,v.height),g.drawImage(n,t,i,o,a,0,0,v.width,v.height),{texture:u,wrapTexture:v,contour:m,width:o*y,height:a*y,opaque:h,sourceWidth:n.width,sourceHeight:n.height}}function DC(n,e,t){let i=1/0;for(let r=0;r<t.length;r++){let s=t[r],o=t[(r+1)%t.length],a=o.x-s.x,l=o.y-s.y,u=Ct(((n-s.x)*a+(e-s.y)*l)/(a*a+l*l||1),0,1);i=Math.min(i,Math.hypot(n-s.x-u*a,e-s.y-u*l))}return i}function NC(n){let e=n.map(a=>a.clone());for(let a=0;a<3;a++){let l=[];e.forEach((u,f)=>{let c=e[(f+1)%e.length];l.push(u.clone().lerp(c,.2),u.clone().lerp(c,.8))}),e=l}let t=e.map((a,l)=>a.distanceTo(e[(l+1)%e.length])),i=t.reduce((a,l)=>a+l,0),r=[],s=0,o=0;for(let a=0;a<128;a++){let l=a/128*i;for(;s<e.length-1&&o+t[s]<l;)o+=t[s],s++;r.push(e[s].clone().lerp(e[(s+1)%e.length],(l-o)/(t[s]||1)))}return r.filter((a,l)=>{let u=r[(l+r.length-1)%r.length],f=r[(l+1)%r.length];return Math.abs((a.x-u.x)*(f.y-a.y)-(a.y-u.y)*(f.x-a.x))>1e-8})}function X_(n){let e=new Ja(n),t=e.toNonIndexed(),i=t.getAttribute("position"),r=[],s=(o,a,l,u)=>{if(u){let f=o.clone().add(a).multiplyScalar(.5),c=a.clone().add(l).multiplyScalar(.5),h=l.clone().add(o).multiplyScalar(.5);s(o,f,h,u-1),s(f,a,c,u-1),s(h,c,l,u-1),s(f,c,h,u-1)}else r.push(o,a,l)};for(let o=0;o<i.count;o+=3){let a=new Ee(i.getX(o),i.getY(o)),l=new Ee(i.getX(o+1),i.getY(o+1)),u=new Ee(i.getX(o+2),i.getY(o+2)),f=a.clone().add(l).multiplyScalar(.5),c=l.clone().add(u).multiplyScalar(.5),h=u.clone().add(a).multiplyScalar(.5),d=a.clone().add(l).add(u).multiplyScalar(1/3);s(a,f,d,2),s(f,l,d,2),s(l,c,d,2),s(c,u,d,2),s(u,h,d,2),s(h,a,d,2)}return e.dispose(),t.dispose(),r}function UC(n){let e=NC(n.contour).map(_=>new Ee(Math.fround(_.x),Math.fround(_.y))),t=X_(new hs(e)),i=t.map(_=>DC(_.x,_.y,e)),r=Math.max(...i,.001),s=Math.min(n.width,n.height)*.37,o=[],a=[],l=(_,y)=>{let m=t[_],v=i[_]<1e-10?0:Ct(i[_]/r,0,1),g=y*s*Math.sqrt(v*(2-v));o.push(m.x,m.y,g),a.push(Ct(m.x/n.width+.5,0,1),Ct(m.y/n.height+.5,0,1))};for(let _=0;_<t.length;_+=3)l(_,1),l(_+1,1),l(_+2,1),l(_+2,-1),l(_+1,-1),l(_,-1);let u=new Un;u.setAttribute("position",new Wt(o,3)),u.setAttribute("uv",new Wt(a,2));let f=k_(u,3e-5);u.dispose(),f.computeVertexNormals(),f.addGroup(0,f.index.count,0);let c=n.width/2+.1,h=n.height/2+.1,d=new hs([new Ee(-c,-h),new Ee(c,-h),new Ee(c,h),new Ee(-c,h)]);d.holes.push(new us(e));let p=t.concat(X_(d));return f.userData.safetyPlane=new Float32Array(p.flatMap(_=>[_.x,_.y])),f}function gl(n,e,t=300){let i=Math.hypot(n,e);if(i<1e-8)return{x:0,y:0};let r=t*.6,o=(i<=r?i:r+(t-r)*Math.tanh((i-r)/(t-r)))/i;return{x:n*o,y:e*o}}function FC(n,e,t,i){let r=1-Math.exp(-t/4);e.offset.x+=(e.target.x-e.offset.x)*r,e.offset.y+=(e.target.y-e.offset.y)*r;let s=gl(e.offset.x,e.offset.y,Math.min(n.width,n.height)*(i?.08:.16));e.joints.forEach((o,a)=>{let l=e.starts[a];o.pointA.x=l.x+s.x+(e.anchor.x-l.x)*.24,o.pointA.y=l.y+s.y+(e.anchor.y-l.y)*.24})}function OC(n,e,t){let i=0,r=0,s=0,o=0,a=e.size===2;for(let{offset:h,anchor:d}of e.values()){if(s+=h.x,o+=h.y,a)continue;let p=Math.hypot(h.x,h.y);if(p<1e-6)continue;let _=h.x/p,y=-h.y/p,m=d.x*2/n.width,v=-d.y*2/n.height,g=Ct((Math.hypot(m,v)-.28)/.46,0,1),S=Ct(-(_*m+y*v)/.55,0,1)*g,E=.35*Math.tanh(p/(Math.max(n.width,n.height)*.28))*(1-2*S);i+=E*(_*_-y*y),r+=E*(2*_*y)}let l=Math.max(1,e.size);if(a){let[h,d]=e.values(),p=d.position.x-h.position.x,_=h.position.y-d.position.y,y=Math.hypot(p,_),{x:m,y:v}=d.pinchStart,g=Math.hypot(m,v),S=Math.max(g,Math.min(n.width,n.height)*.38),E=.35*Math.tanh((y-g)/(S*.65)),M=y>n.unit*.08?Math.atan2(_,p):Math.atan2(v,m);i=E*Math.cos(2*M),r=E*Math.sin(2*M)}let u=n.dragShape,f=gl(s*.55/l,o*.55/l,Math.min(n.width,n.height)*.43),c=1-Math.exp(-32*t);u.moveX+=(f.x-u.moveX)*c,u.moveY+=(f.y-u.moveY)*c,u.velocityXX+=(480*(i-u.xx)-24*u.velocityXX)*t,u.velocityXY+=(480*(r-u.xy)-24*u.velocityXY)*t,u.xx+=u.velocityXX*t,u.xy+=u.velocityXY*t}function BC(n,e){let t=8.333333333333334;for(let i of e.values())FC(n,i,t,e.size===2);OC(n,e,t/1e3),n.bodies.forEach((i,r)=>{let s=n.rest[r],o=s.x-i.position.x,a=s.y-i.position.y,l=Math.hypot(o,a),u=52e-6*(1+Math.max(0,l-160)**2/1e4);Jt.default.Body.applyForce(i,i.position,{x:o*i.mass*u,y:a*i.mass*u})}),Jt.default.Engine.update(n.engine,t)}function kC(n,e){let t=Ct(Math.round(e.SOFT_BODY_COLUMNS),7,17),i=Ct(Math.round(e.SOFT_BODY_ROWS),7,17),r=90,s=(n.width+.2)*r,o=(n.height+.2)*r,a=-s/2,l=-o/2,u=Jt.default.Engine.create({positionIterations:6,constraintIterations:4});u.gravity.y=e.GRAVITY,u.gravity.scale=1e-5;let f=[],c=[];for(let p=0;p<i;p++)for(let _=0;_<t;_++)f.push(Jt.default.Bodies.circle(a+_*s/(t-1),l+p*o/(i-1),2,{frictionAir:.014,collisionFilter:{group:-1},inertia:1/0}));let h=(p,_,y)=>c.push(Jt.default.Constraint.create({bodyA:f[p],bodyB:f[_],stiffness:y,damping:.035}));for(let p=0;p<i;p++)for(let _=0;_<t;_++){let y=p*t+_;_<t-1&&h(y,y+1,.26),p<i-1&&h(y,y+t,.26),_<t-1&&p<i-1&&(h(y,y+t+1,.16),h(y+1,y+t,.16))}Jt.default.Composite.add(u.world,[...f,...c]);let d={xx:0,xy:0,velocityXX:0,velocityXY:0,moveX:0,moveY:0};return{engine:u,bodies:f,rest:f.map(p=>({...p.position})),columns:t,rows:i,width:s,height:o,left:a,top:l,unit:r,dragShape:d}}function zC(n,e){let t=n.attributes.position,i=new Float32Array(t.array),r=[],s=new Map,o=[],a=(m,v)=>{m=Math.fround(m),v=Math.fround(v);let g=m+":"+v;if(s.has(g))return s.get(g);let S=r.length/2;return r.push(m,v),s.set(g,S),S},l=n.userData.safetyPlane;for(let m=0;m<l.length;m+=6){let v=a(l[m],l[m+1]),g=a(l[m+2],l[m+3]),S=a(l[m+4],l[m+5]),E=r[v*2],M=r[v*2+1],T=r[g*2]-E,x=r[g*2+1]-M,w=r[S*2]-E,C=r[S*2+1]-M,A=T*C-x*w;Math.abs(A)>1e-14&&o.push(v,g,S,C/A,-w/A,-x/A,T/A)}let u=Array.from({length:t.count},(m,v)=>a(i[v*3],i[v*3+1])),f=r.filter((m,v)=>v%2===0).map((m,v)=>{let g=r[v*2+1],S=Ct((m*e.unit-e.left)/e.width*(e.columns-1),0,e.columns-1-1e-5),E=Ct((-g*e.unit-e.top)/e.height*(e.rows-1),0,e.rows-1-1e-5),M=Math.floor(S),T=Math.floor(E),x=S-M,w=E-T;return{ids:[T*e.columns+M,T*e.columns+M+1,(T+1)*e.columns+M,(T+1)*e.columns+M+1],weights:[(1-x)*(1-w),x*(1-w),(1-x)*w,x*w]}}),c=new Float64Array(r.length),h=new Float64Array(r.length),d=e.rest.reduce((m,v)=>m+v.x*v.x,0),p=e.rest.reduce((m,v)=>m+v.y*v.y,0),_=e.bodies.map(m=>({...m.position}));return{rest:i,reset:()=>{e.bodies.forEach((m,v)=>{_[v].x=m.position.x,_[v].y=m.position.y}),Object.assign(e.dragShape,{xx:0,xy:0,velocityXX:0,velocityXY:0,moveX:0,moveY:0})},apply(m=1/0){let v=Number.isFinite(m)?1-Math.exp(-Math.max(0,m)/6):1;e.bodies.forEach((Q,xe)=>{_[xe].x+=(Q.position.x-_[xe].x)*v,_[xe].y+=(Q.position.y-_[xe].y)*v});let g=0,S=0;for(let Q of _)g+=Q.x,S+=Q.y;g/=e.bodies.length,S/=e.bodies.length;let E=0,M=0,T=0,x=0;_.forEach((Q,xe)=>{let re=e.rest[xe];E+=(Q.x-g)*re.x/d,M+=(Q.x-g)*re.y/p,T+=(Q.y-S)*re.x/d,x+=(Q.y-S)*re.y/p});let w=Ct(Math.atan2(T-M,E+x),-.28,.28),C=Math.cos(w),A=Math.sin(w),I=C*E+A*T,D=-A*M+C*x,F=(C*M+A*x-A*E+C*T)/2,L=.5*Math.atan2(2*F,I-D),N=Math.cos(L),B=Math.sin(L),H=Math.hypot(I-D,2*F),Z=Ct((I+D+H)/2,.68,1.35),Y=Ct((I+D-H)/2,.68,1.35),se=N*N*Z+B*B*Y,ue=B*B*Z+N*N*Y,Be=N*B*(Z-Y);E=C*se-A*Be,M=C*Be-A*ue,T=A*se+C*Be,x=A*Be+C*ue;let Ie=Math.min(e.width,e.height)*.6,Ue=gl(g,S,Ie);g=Ue.x,S=Ue.y,f.forEach((Q,xe)=>{let re=0,Le=0;Q.ids.forEach((te,le)=>{re+=_[te].x*Q.weights[le],Le+=_[te].y*Q.weights[le]});let P=r[xe*2]*e.unit,b=-r[xe*2+1]*e.unit,k=(E*P+M*b+g)/e.unit,j=-(T*P+x*b+S)/e.unit;h[xe*2]=k,h[xe*2+1]=j,c[xe*2]=re/e.unit-k,c[xe*2+1]=-Le/e.unit-j});let J=0;for(let Q=0;Q<o.length;Q+=7){let xe=o[Q]*2,re=o[Q+1]*2,Le=o[Q+2]*2,P=c[re]-c[xe],b=c[Le]-c[xe],k=c[re+1]-c[xe+1],j=c[Le+1]-c[xe+1];J=Math.max(J,Math.hypot(P*o[Q+3]+b*o[Q+5],P*o[Q+4]+b*o[Q+6],k*o[Q+3]+j*o[Q+5],k*o[Q+4]+j*o[Q+6]))}let me=Math.min(Z,Y),ae=.48*me,Ae=Math.min(1,ae/Math.max(J,1e-12)),be=e.dragShape,Fe=Math.hypot(be.xx,be.xy),at=Math.min(.38,Fe),qe=Fe>0?at/Fe:0,et=be.xx*qe,rt=be.xy*qe,G=g/e.unit,ne=-S/e.unit,ie=be.moveX/e.unit,ve=-be.moveY/e.unit,U=Ct(1/(Z*Y*(1-at*at)),.85,1.55),Ne=0;return u.forEach((Q,xe)=>{let re=h[Q*2]+c[Q*2]*Ae,Le=h[Q*2+1]+c[Q*2+1]*Ae,P=re-G,b=Le-ne,k=re+et*P+rt*b+ie,j=Le+rt*P-et*b+ve;Ne=Math.max(Ne,Math.hypot(k-i[xe*3],j-i[xe*3+1])),t.setXYZ(xe,k,j,i[xe*3+2]*U)}),t.needsUpdate=!0,{maximum:Ne,blend:Ae,gradientBound:J*Ae,minStretch:me,depthScale:U}}}}function VC(){let n=TC(),[e,t]=(0,it.useState)(W_),[i,r]=(0,it.useState)("trace"),[s,o]=(0,it.useState)(0),[a,l]=(0,it.useState)(!1),[u,f]=(0,it.useState)(!0),[c,h]=(0,it.useState)(!1),[d,p]=(0,it.useState)(""),[_,y]=(0,it.useState)(!1),[m,v]=(0,it.useState)(null),g=(0,it.useRef)(null),S=(0,it.useRef)(null),E=(0,it.useRef)(null),M=(0,it.useRef)(null),T=(0,it.useRef)([]),x=(0,it.useRef)(!1),w=(0,it.useRef)(null),C=(0,it.useRef)(null),A=(0,it.useRef)(0),I=(0,it.useRef)(n),D=(0,it.useRef)(null),F=(0,it.useRef)(new Map);I.current=n,(0,it.useEffect)(()=>{fetch("./game.config.json").then(G=>G.json()).then(G=>t({...W_,...Object.fromEntries([...G.tweaks,...G.texts].map(ne=>[ne.id,ne.value])),...Object.fromEntries(G.images.map(ne=>[ne.id,ne.path]))})).catch(()=>{})},[]);let L=G=>{I.current&&HC("photo-"+G,G==="squish"?"./assets/sfx_squish.mp3":"./assets/sfx_click_soft.mp3")},N=()=>{T.current=[],x.current=!1,w.current=null,l(!1),f(!0),p("")},B=(0,it.useCallback)(async(G,ne)=>{let ie=++A.current;y(!0),p("");try{let ve=new Image;if(ve.src=G,await ve.decode(),ie!==A.current)return;let U=Math.min(1,1600/Math.max(ve.naturalWidth,ve.naturalHeight)),Ne=document.createElement("canvas");Ne.width=Math.max(1,Math.round(ve.naturalWidth*U)),Ne.height=Math.max(1,Math.round(ve.naturalHeight*U)),Ne.getContext("2d").drawImage(ve,0,0,Ne.width,Ne.height),S.current=Ne,T.current=[],x.current=!1,w.current=null,l(!1),f(!0),h(ne),v(null),r("trace"),o(Q=>Q+1)}catch{ie===A.current&&p("Prova una foto JPG, PNG o WebP.")}finally{ie===A.current&&y(!1)}},[]);(0,it.useEffect)(()=>{S.current||B(e.HAMSTER_HONEY,!1)},[e.HAMSTER_HONEY,B]),(0,it.useEffect)(()=>()=>{var G;A.current++;try{(G=D.current)==null||G.close()}catch{}},[]);let H=()=>{_||(L("tap"),g.current.value="",g.current.click())},Z=async G=>{var ve;let ne=(ve=G.target.files)==null?void 0:ve[0];if(!ne)return;if(!ne.type.startsWith("image/")){p("Scegli un file immagine.");return}if(ne.size>25*1024*1024){p("Scegli una foto inferiore a 25 MB.");return}let ie=URL.createObjectURL(ne);try{await B(ie,!0)}finally{URL.revokeObjectURL(ie)}},Y=(0,it.useCallback)(()=>{let G=E.current,ne=S.current;if(!G||!ne)return;let ie=G.getBoundingClientRect(),ve=Math.min(devicePixelRatio||1,2),U=ie.width,Ne=ie.height;G.width=Math.max(1,Math.round(U*ve)),G.height=Math.max(1,Math.round(Ne*ve));let Q=G.getContext("2d");Q.setTransform(ve,0,0,ve,0,0),Q.clearRect(0,0,U,Ne);let xe=ng(U,Ne,ne,c?.5:.57);if(Q.drawImage(ne,xe.x,xe.y,xe.width,xe.height),window.PlayableIdlePreview.active){let P=window.PlayableIdlePreview,b=P.seconds%5.3,k=RC(xe);Q.save(),Q.strokeStyle="#d5f8ba",Q.lineWidth=3,Q.lineCap="round",Q.lineJoin="round",Q.shadowColor="#0008",Q.shadowBlur=4,Q.globalAlpha=b>4.5?(5.3-b)/.8:1,P.trace(Q,k,P.ease(b/3.1)),Q.restore(),P.stamp(G,"trace-cat-silhouette");return}let re=T.current;if(G.dataset.traceClosed=String(x.current),G.dataset.tracePoints=String(re.length),G.dataset.traceArea=Kh(re).toFixed(5),G.dataset.traceCrossings=String(Z_(re)),!re.length)return;let Le=re.map(P=>({x:xe.x+P.u*xe.width,y:xe.y+P.v*xe.height}));Q.save(),Q.lineCap="round",Q.lineJoin="round",Q.lineWidth=3,Q.strokeStyle=x.current?"#d5f8ba":"#f3d292",Q.shadowColor="#0009",Q.shadowBlur=5,Q.beginPath(),Le.forEach((P,b)=>b?Q.lineTo(P.x,P.y):Q.moveTo(P.x,P.y)),x.current&&Q.closePath(),Q.stroke(),Le.length>2&&(Q.closePath(),Q.fillStyle="#f3d29222",Q.fill()),Q.shadowBlur=0,Q.fillStyle=x.current?"#d5f8ba":"#f3d292",Q.beginPath(),Q.arc(Le[0].x,Le[0].y,5,0,Math.PI*2),Q.fill(),Q.restore()},[s,c]);(0,it.useEffect)(()=>{if(i!=="trace"||!E.current)return;let G=new ResizeObserver(Y);return G.observe(E.current),Y(),()=>G.disconnect()},[i,Y]),(0,it.useEffect)(()=>{if(i!=="trace"||n)return;let G,ne=0,ie=ve=>{window.PlayableIdlePreview.active&&ve-ne>=33&&(Y(),ne=ve),G=requestAnimationFrame(ie)};return G=requestAnimationFrame(ie),()=>{cancelAnimationFrame(G),Y()}},[i,n,Y]);let se=G=>{let ne=E.current,ie=S.current;if(!ne||!ie)return null;let ve=ne.getBoundingClientRect(),U=ng(ve.width,ve.height,ie,c?.5:.57),Ne=G.clientX-ve.left,Q=G.clientY-ve.top;return{u:Ct((Ct(Ne,0,ve.width)-U.x)/U.width,0,1),v:Ct((Ct(Q,0,ve.height)-U.y)/U.height,0,1),inside:Ne>=0&&Ne<=ve.width&&Q>=0&&Q<=ve.height,fit:U}},ue=(G=T.current)=>{var Q;let ne=Jh(G);if(ne.length<3||Kh(ne)<.004)return!1;let ie=(Q=E.current)==null?void 0:Q.getBoundingClientRect(),ve=S.current;if(!ie||!ve)return!1;let U=ng(ie.width,ie.height,ve,c?.5:.57);return ne.slice(1).reduce((xe,re,Le)=>xe+Math.hypot((re.u-ne[Le].u)*U.width,(re.v-ne[Le].v)*U.height),0)>=e.TRACE_MIN_LENGTH},Be=()=>{let G=IC(T.current);return ue(G)?(T.current=G,x.current=!0,l(!0),p(""),Y(),!0):!1},Ie=G=>{if(!I.current||_||G.isPrimary===!1||G.pointerType==="mouse"&&G.button!==0)return;let ne=se(G);if(ne!=null&&ne.inside){if(x.current&&(T.current=[],x.current=!1),T.current.length>2&&Math.hypot((ne.u-T.current[0].u)*ne.fit.width,(ne.v-T.current[0].v)*ne.fit.height)<=e.TRACE_CLOSE_GAP&&ue()){Be(),f(!1);return}T.current.push({u:ne.u,v:ne.v}),w.current={id:G.pointerId,start:{x:G.clientX,y:G.clientY},moved:!1},f(!1),p(""),G.currentTarget.setPointerCapture(G.pointerId),Y(),l(ue())}},Ue=G=>{let ne=w.current;if(!ne||ne.id!==G.pointerId)return;let ie=se(G);if(!ie)return;let ve=T.current.at(-1);Math.hypot((ve.u-ie.u)*ie.fit.width,(ve.v-ie.v)*ie.fit.height)<2||(ne.moved=!0,T.current.push({u:ie.u,v:ie.v}),Y(),l(ue()))},J=G=>{let ne=w.current;if(!(!ne||ne.id!==G.pointerId)){if(w.current=null,G.type==="pointerup"&&ne.moved){let ie=se(G),ve=T.current.at(-1);ie&&ve&&Math.hypot((ie.u-ve.u)*ie.fit.width,(ie.v-ve.v)*ie.fit.height)>=2&&T.current.push({u:ie.u,v:ie.v}),Be()}try{G.currentTarget.hasPointerCapture(G.pointerId)&&G.currentTarget.releasePointerCapture(G.pointerId)}catch{}l(ue()),Y()}},me=()=>{if(!Be())return;let G=T.current;try{let ne=LC(S.current,G);v(ne),p(""),f(!0),r("active"),L("tap")}catch(ne){p(ne.message||"Prova a ricalcare di nuovo la forma.")}};(0,it.useEffect)(()=>{if(i!=="active"||!m||!M.current)return;let G=M.current,ne;try{ne=new Yh({canvas:G,alpha:!0,antialias:!0,powerPreference:"high-performance"})}catch{p("Questo browser non riesce ad aprire la vista 3D.");return}ne.setPixelRatio(Math.min(devicePixelRatio||1,2)),ne.outputColorSpace=on,ne.shadowMap.enabled=!0,ne.shadowMap.type=Qu,ne.setClearColor(0,0);let ie=new Ua,ve=new Ur(-2,2,2,-2,.1,40);ve.position.set(0,.15,8),ve.lookAt(0,0,0);let U=new tl(16777215,6974322,2.2);ie.add(U);let Ne=new _o(16777215,2.6);Ne.position.set(-3,5,7),Ne.castShadow=!0,Ne.shadow.mapSize.set(1024,1024),Ne.shadow.camera.left=-5,Ne.shadow.camera.right=5,Ne.shadow.camera.top=5,Ne.shadow.camera.bottom=-5,Ne.shadow.normalBias=.03,ie.add(Ne);let Q=new _o(13162751,1.2);Q.position.set(4,1,-2),ie.add(Q);let xe=new Va(m.wrapTexture);xe.colorSpace=on,xe.anisotropy=Math.min(4,ne.capabilities.getMaxAnisotropy());let re=new ja({map:xe,roughness:.64,metalness:0}),Le=UC(m);Le.computeBoundingBox();let P=Le.boundingBox.max.z-Le.boundingBox.min.z;Le.boundingBox=null,Le.computeBoundingSphere(),Le.boundingSphere.radius*=3;let b=new pn(Le,re);b.castShadow=!0,b.receiveShadow=!0,b.frustumCulled=!1;let k=new Yi;k.add(b),k.rotation.set(-.08,.22,-.015),ie.add(k);let j=new pn(new ds(30,30),new Ka({opacity:.3}));j.rotation.x=-Math.PI/2,j.position.y=-m.height/2-.22,j.receiveShadow=!0,ie.add(j);let te=kC(m,e),le=zC(Le,te),ge=le.rest,$=new Map,K={scene:ie,camera:ve,renderer:ne,mesh:b,group:k,cage:te,rest:ge,drags:$,cut:m,lastTime:performance.now(),accumulator:0,normalsElapsed:1/0,rendered:!1,maxDisplacement:0,peakDisplacement:0,dragCount:0,reset(){let ze=[...$.keys()];for(let He of $.values())He.joints.forEach(O=>Jt.default.Composite.remove(te.engine.world,O));$.clear();for(let He of ze)try{G.hasPointerCapture(He)&&G.releasePointerCapture(He)}catch{}te.bodies.forEach((He,O)=>{Jt.default.Body.setPosition(He,te.rest[O]),Jt.default.Body.setVelocity(He,{x:0,y:0}),He.force.x=0,He.force.y=0}),le.reset(),this.peakDisplacement=0,this.dragCount=0,this.accumulator=0,this.lastTime=performance.now(),this.normalsElapsed=1/0}};C.current=K;let ye=()=>{let ze=G.getBoundingClientRect();ne.setSize(ze.width,ze.height,!1);let He=ze.width/Math.max(1,ze.height),O=Math.max(ze.height*.5,ze.height-196),he=Math.max((m.height+1)*ze.height/O,(m.width+.2)/(He*Ct(e.BODY_WIDTH_RATIO,.55,.86)));ve.left=-he*He/2,ve.right=he*He/2,ve.top=he/2,ve.bottom=-he/2,ve.updateProjectionMatrix()},Te=new ResizeObserver(ye);Te.observe(G),ye();let de=0,fe=ze=>{de=requestAnimationFrame(fe);let He=Ct(ze-K.lastTime,0,50);if(K.lastTime=ze,!I.current||document.hidden){if($.size){for(let we of $.values())we.joints.forEach(pe=>Jt.default.Composite.remove(te.engine.world,pe));$.clear()}if(K.accumulator=0,K.rendered)return}else for(K.accumulator=Math.min(K.accumulator+He,50);K.accumulator+1e-6>=1e3/120;)BC(te,$),K.accumulator=Math.max(0,K.accumulator-1e3/120);let O=le.apply(He),he=Le.attributes.position,ee=O.maximum;K.normalsElapsed+=He,K.normalsElapsed>=1e3/30&&(Le.computeVertexNormals(),K.normalsElapsed=0),K.maxDisplacement=ee,K.peakDisplacement=Math.max(K.peakDisplacement,ee),ne.render(ie,ve),K.rendered=!0,G.dataset.deformation=ee.toFixed(3),G.dataset.vertices=String(he.count),G.dataset.depth=(P*O.depthScale).toFixed(3),G.dataset.safeGradient=O.gradientBound.toFixed(3),G.dataset.minStretch=O.minStretch.toFixed(3),G.dataset.activeDrags=String($.size),G.dataset.peakDeformation=K.peakDisplacement.toFixed(3),G.dataset.completedDrags=String(K.dragCount)};de=requestAnimationFrame(fe);let Xe=ze=>{ze.preventDefault(),p("La vista 3D si \xE8 interrotta. Tocca Ricalca di nuovo per ricrearla.")};return G.addEventListener("webglcontextlost",Xe),()=>{cancelAnimationFrame(de),Te.disconnect(),G.removeEventListener("webglcontextlost",Xe),K.reset(),Jt.default.Composite.clear(te.engine.world,!1),Jt.default.Engine.clear(te.engine),Le.dispose(),re.dispose(),xe.dispose(),j.geometry.dispose(),j.material.dispose(),ne.dispose(),C.current===K&&(C.current=null)}},[i,m,e]);let ae=G=>{let ne=C.current;if(!ne)return null;let ie=M.current.getBoundingClientRect(),ve=new Ee((G.clientX-ie.left)/ie.width*2-1,-(G.clientY-ie.top)/ie.height*2+1),U=new il;return U.setFromCamera(ve,ne.camera),{w:ne,ray:U}},Ae=G=>{var j;if(!I.current||G.pointerType==="mouse"&&G.button!==0)return;let ne=ae(G);if(!ne)return;let{w:ie,ray:ve}=ne;if(ie.drags.has(G.pointerId)||ie.drags.size>=2)return;let U=ie.drags.values().next().value;if(U&&(G.pointerType!=="touch"||U.pointerType!=="touch"))return;let Ne=(j=ve.intersectObject(ie.mesh)[0])==null?void 0:j.point;if(!Ne&&!U)return;let Q=(U==null?void 0:U.plane)??new Zn().setFromNormalAndCoplanarPoint(ie.camera.getWorldDirection(new V),Ne),xe=ve.ray.intersectPlane(Q,new V);if(!xe)return;G.preventDefault(),G.stopPropagation(),ie.group.updateMatrixWorld(!0);let re=ie.group.matrixWorld.clone().invert();xe.applyMatrix4(re);let Le={x:xe.x*ie.cage.unit,y:-xe.y*ie.cage.unit},P={x:Le.x-ie.cage.dragShape.moveX,y:Le.y-ie.cage.dragShape.moveY},b=Ne?ie.cage.bodies.map(te=>({body:te,d:bC(te.position,P)})).sort((te,le)=>te.d-le.d).slice(0,4):[],k=b.map(({body:te})=>Jt.default.Constraint.create({bodyB:te,pointA:{...te.position},stiffness:.42,damping:.1}));Jt.default.Composite.add(ie.cage.engine.world,k),ie.drags.set(G.pointerId,{joints:k,anchor:P,origin:Le,plane:Q,inverse:re,pointerType:G.pointerType,position:Le,pinchStart:U?{x:Le.x-U.position.x,y:U.position.y-Le.y}:null,starts:b.map(({body:te})=>({...te.position})),target:{x:0,y:0},offset:{x:0,y:0},start:{x:G.clientX,y:G.clientY},moved:!1});try{G.currentTarget.setPointerCapture(G.pointerId)}catch{}f(!1),p("")},be=G=>{let ne=ae(G),ie=ne==null?void 0:ne.w.drags.get(G.pointerId);if(!ie)return;let ve=ne.ray.ray.intersectPlane(ie.plane,new V);ve&&(G.preventDefault(),G.stopPropagation(),ve.applyMatrix4(ie.inverse),ie.position={x:ve.x*ne.w.cage.unit,y:-ve.y*ne.w.cage.unit},ie.target=gl(ie.position.x-ie.origin.x,ie.position.y-ie.origin.y),Math.hypot(G.clientX-ie.start.x,G.clientY-ie.start.y)>6&&(ie.moved=!0))},Fe=G=>{let ne=C.current,ie=ne==null?void 0:ne.drags.get(G.pointerId);if(!ie)return;let ve=G.type==="pointerup",U=gl(-ie.offset.x*.09,-ie.offset.y*.09,10);for(let Ne of ie.joints)if(Jt.default.Composite.remove(ne.cage.engine.world,Ne),ve&&ie.moved){let Q=Ne.bodyB;Jt.default.Body.setVelocity(Q,{x:U.x+Q.velocity.x*.25,y:U.y+Q.velocity.y*.25})}ne.drags.delete(G.pointerId),G.preventDefault(),G.stopPropagation(),G.currentTarget.hasPointerCapture(G.pointerId)&&G.currentTarget.releasePointerCapture(G.pointerId),ve&&(ne.dragCount++,ne.drags.size||L("squish"))},at=()=>{var G;L("tap"),i==="active"?(G=C.current)==null||G.reset():(N(),Y())},qe=()=>{L("tap"),r("trace"),N()},et=(0,pt.jsx)("svg",{viewBox:"0 0 24 24","aria-hidden":"true",children:(0,pt.jsx)("path",{d:"M5 8a7 7 0 1 1-1 7M5 4v4h4"})}),rt=(0,pt.jsx)("svg",{viewBox:"0 0 24 24","aria-hidden":"true",children:(0,pt.jsx)("path",{d:"M5 15v5h14v-5M12 16V4m-4 4 4-4 4 4"})});return(0,pt.jsxs)("main",{className:"photo-toy phase-"+i,"data-stage":i,"data-photo-source":c?"uploaded":"sample",children:[(0,pt.jsx)("input",{ref:g,className:"file-input",tabIndex:-1,"aria-hidden":"true",type:"file",accept:"image/*","aria-label":"Carica una foto",onChange:Z}),u&&(0,pt.jsx)("div",{className:"toy-guide",children:i==="active"?"Trascina o pizzica per deformare":c?"Ricalca il contorno del soggetto":e.GUIDE_TEXT}),(0,pt.jsxs)("div",{className:"photo-zone",children:[i==="trace"?(0,pt.jsx)("canvas",{ref:E,"aria-label":"Disegna o tocca per tracciare il contorno del soggetto",onPointerDown:Ie,onPointerMove:Ue,onPointerUp:J,onPointerCancel:J,onLostPointerCapture:J},"trace"):(0,pt.jsx)("canvas",{ref:M,"aria-label":"Squishy fotografico in 3D. Trascina, pizzica o allarga due dita per deformarlo.",onPointerDown:Ae,onPointerMove:be,onPointerUp:Fe,onPointerCancel:Fe,onLostPointerCapture:Fe},"3d"),_&&(0,pt.jsx)("span",{className:"load-state",role:"status",children:"Apertura della foto\u2026"})]}),d&&(0,pt.jsx)("div",{className:"toy-error",role:"alert",children:d}),(0,pt.jsxs)("div",{className:"toy-controls",children:[(0,pt.jsxs)("button",{className:"utility","aria-label":i==="active"?e.RESET_SHAPE_LABEL:e.RESET_LABEL,onClick:at,children:[et,(0,pt.jsx)("span",{children:i==="active"?e.RESET_SHAPE_LABEL:e.RESET_LABEL})]}),(0,pt.jsxs)("button",{className:"utility","aria-label":e.CHOOSE_LABEL,onClick:H,disabled:_,children:[rt,(0,pt.jsx)("span",{children:e.CHOOSE_LABEL})]}),i==="trace"?(0,pt.jsx)("button",{className:"make-button",disabled:!a||_,onClick:me,children:e.CONFIRM_LABEL}):(0,pt.jsx)("button",{className:"make-button",onClick:qe,children:"Ricalca di nuovo"})]}),(0,pt.jsx)("style",{children:AC+GC})]})}var GC=`
@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');font-weight:700;font-display:swap}
*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{background:#050607;color:#faf7ef;font-family:Poppins,system-ui,sans-serif;-webkit-tap-highlight-color:transparent}button{font:inherit;cursor:pointer;border:0;touch-action:manipulation}button:disabled{cursor:default}
.photo-toy{position:relative;width:100%;height:100%;overflow:hidden;background:#050607;container-type:size}.file-input{display:none}
.toy-guide{position:absolute;z-index:3;left:30px;right:30px;top:12%;transform:translateY(-50%);text-align:center;font-size:18px;line-height:1.3;font-weight:700;pointer-events:none;animation:batchBreathe 2.6s ease-in-out infinite}.photo-zone{position:absolute;inset:0}.photo-zone canvas{display:block;width:100%;height:100%;touch-action:none;user-select:none}.phase-active .photo-zone{inset:0;background:radial-gradient(ellipse at 50% 70%,#1e2026 0%,#0d0f13 45%,#050607 76%)}.phase-trace .toy-guide{color:#fff;text-shadow:0 1px 3px #000,0 2px 12px #000}.phase-active .toy-guide{top:62px}
.toy-controls{position:absolute;z-index:4;display:flex;align-items:center;justify-content:center;gap:8px;left:30px;right:30px;bottom:50px;min-height:46px}.utility{display:flex;align-items:center;justify-content:center;gap:5px;min-height:46px;padding:0 10px;border-radius:24px;background:#191b1f;color:#eeeae2;border:1px solid #37383c;font-size:12px;white-space:nowrap}.utility svg{width:18px;height:18px;stroke:#f4d292;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.make-button{min-height:46px;min-width:94px;padding:0 17px;border-radius:24px;background:#f3d292;color:#27231c;font-size:14px;font-weight:700;white-space:nowrap}.make-button:disabled{opacity:.35}.phase-active .utility{width:46px;min-width:46px;padding:0}.phase-active .utility span{display:none}.phase-active .make-button{flex:1;min-width:120px}.utility:active,.make-button:not(:disabled):active{transform:scale(.96)}.toy-error{position:absolute;z-index:4;left:30px;right:30px;bottom:106px;text-align:center;color:#ffd9b0;font-size:14px;line-height:1.35;background:#101216e8;padding:8px 10px;border-radius:10px}.load-state{position:absolute;inset:0;display:grid;place-items:center;background:#080a0de8;font-size:15px}
[data-feed-preview=true] .toy-controls{visibility:hidden}[data-feed-preview=true] .toy-guide{top:17%}@media(max-width:440px){.utility{width:46px;min-width:46px;padding:0}.utility span{display:none}.toy-controls{gap:12px}.make-button{flex:1;min-width:90px}}@media(max-height:520px){.phase-active .photo-zone{inset:0}.phase-active .toy-guide{top:53px}}`;(0,Y_.createRoot)(document.getElementById("root")).render((0,pt.jsxs)(pt.Fragment,{children:[(0,pt.jsx)("style",{children:EC}),(0,pt.jsx)(VC,{})]}));(()=>{var h;let n=[".toy-guide"],e=new Set(["Ricalca il contorno del gatto"].map(d=>d.replace(/\s+/g," ").trim().toLowerCase())),t=window.matchMedia("(prefers-reduced-motion: reduce)"),i=new Map,r=!1,s=!0,o=/^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;function a(){r=!1;for(let[p,_]of i)p.isConnected||(_.cancel(),i.delete(p));if(t.matches){for(let p of i.values())p.cancel();i.clear();return}let d=new Set;for(let p of n)try{document.querySelectorAll(p).forEach(_=>d.add(_))}catch{}for(let p of document.querySelectorAll("p,span,div,label,text")){if(p.children.length||p.closest('button,a,input,select,textarea,[role="button"]'))continue;let _=(p.textContent||"").replace(/\s+/g," ").trim();_.length>=5&&_.length<=140&&(e.has(_.toLowerCase())||!n.length&&o.test(_))&&d.add(p)}for(let p of d){if(i.has(p)||typeof p.animate!="function"||[...d].some(g=>g!==p&&p.contains(g)))continue;let _=getComputedStyle(p);if(/breath/i.test(_.animationName))continue;let y=_.filter.replace(/opacity\([^)]*\)/g,"").replace(/^none$/,"").trim(),m=g=>(y?y+" ":"")+"opacity("+g+")",v=p.animate([{filter:m(1)},{filter:m(.65)},{filter:m(1)}],{duration:2400,iterations:1/0,easing:"ease-in-out"});i.set(p,v),(document.hidden||!s)&&v.pause()}}let l=()=>{r||(r=!0,requestAnimationFrame(a))},u=()=>{for(let d of i.values())document.hidden||!s?d.pause():d.play()},f=new MutationObserver(l);f.observe(document.documentElement,{childList:!0,subtree:!0,characterData:!0});let c=typeof IntersectionObserver=="function"?new IntersectionObserver(d=>{s=d.some(p=>p.isIntersecting),u()}):null;document.body?c==null||c.observe(document.body):document.addEventListener("DOMContentLoaded",()=>c==null?void 0:c.observe(document.body),{once:!0}),document.addEventListener("visibilitychange",u),(h=t.addEventListener)==null||h.call(t,"change",l),l(),window.addEventListener("pagehide",()=>{f.disconnect(),c==null||c.disconnect();for(let d of i.values())d.cancel();i.clear()},{once:!0})})();function HC(n,e,t=90){!e||document.hidden||!window.SFX||(window.SFX.register({[n]:e}),window.SFX.unlock(),window.SFX.play(n,{minGapMs:t}))}})();
