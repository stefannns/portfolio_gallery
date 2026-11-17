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

(()=>{(()=>{"use strict";var J;let x=document.getElementById("root"),W=(n,t,o)=>Math.max(t,Math.min(o,n)),z=!0,D=!1,H=[];function k(n,t,o,a){n.addEventListener(t,o,a),H.push(()=>n.removeEventListener(t,o,a))}function V(n){let t=document.createElement("style");t.textContent="*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}"+n,document.head.append(t)}function ee(){var n;(n=x.querySelector(".guide"))==null||n.classList.add("gone")}let y;function F(){try{y||(y=new(window.AudioContext||window.webkitAudioContext)),y.state==="suspended"&&y.resume().catch(()=>{})}catch{}}function K(n=400,t=.1,o=.15,a="sine",e=0){if(!(!y||!z))try{let l=y.currentTime,i=y.createOscillator(),m=y.createGain();i.type=a,i.frequency.setValueAtTime(n,l),e&&i.frequency.exponentialRampToValueAtTime(Math.max(20,e),l+t),m.gain.setValueAtTime(1e-4,l),m.gain.exponentialRampToValueAtTime(o,l+.008),m.gain.exponentialRampToValueAtTime(1e-4,l+t),i.connect(m),m.connect(y.destination),i.start(l),i.stop(l+t+.02),i.onended=()=>{i.disconnect(),m.disconnect()}}catch{}}function te({gyro:n=!1,shake:t=!1,onTilt:o=()=>{},onShake:a=()=>{}}={}){let e=window.tt,l=!1,i=!1,m=!1,r=null,c=null,u=0,p=0,T=-2e3,M=-2e3,h={x:0,y:0,yaw:0,pitch:0,roll:0,received:!1},A=(s,d)=>Math.atan2(Math.sin(s-d),Math.cos(s-d));function f(s){if(!z||!s||s.result===-1)return;let d=Number(s.pitch??s.x)||0,g=Number(s.yaw??s.y)||0,w=Number(s.roll??s.z)||0;r||(r={pitch:d,yaw:g,roll:w}),h.pitch=d,h.yaw=g,h.roll=w,h.x=W(A(w,r.roll)/.42,-1,1),h.y=W(A(d,r.pitch)/.42,-1,1),Math.abs(h.x)<.025&&(h.x=0),Math.abs(h.y)<.025&&(h.y=0),h.received=!0,o(h)}function S(s){if(!z||!s)return;let d={x:Number(s.x)||0,y:Number(s.y)||0,z:Number(s.z)||0};c||(c={...d});let g=Math.max(.1,Math.hypot(c.x,c.y,c.z)),w=Math.hypot(d.x-c.x,d.y-c.y,d.z-c.z)/g;for(let B of["x","y","z"])c[B]=c[B]*.82+d[B]*.18;if(u++<5)return;let E=performance.now();E-M<1300||(E-T>1400&&(p=0),w>.55&&E-T>200&&(T=E,p++,p>=2&&(p=0,M=E,a())))}function b(s,d=!1){let g=x.querySelector(".sensor");g&&(g.textContent=s,g.hidden=d)}function N(){if(!(l||!z)){if(l=!0,r=null,c=null,u=0,n&&(e!=null&&e.startGyroscope)&&(e!=null&&e.onGyroscopeChange)&&(i=!0,e.onGyroscopeChange(f),e.startGyroscope({interval:50,fail:()=>{i=!1,l=!1,b("Enable tilt")}})),t&&(e!=null&&e.startAccelerometer)&&(e!=null&&e.onAccelerometerChange)&&e.startAccelerometer({success:()=>{m=!0,e.onAccelerometerChange(S)},fail:()=>{l=!1,b("Enable motion")}}),n&&!i||!n&&t&&!(e!=null&&e.startAccelerometer)){l=!1,b("Motion unavailable");return}b("Motion on",!0)}}function O(){var s,d,g,w;l=!1,i&&((s=e==null?void 0:e.offGyroscopeChange)==null||s.call(e,f),(d=e==null?void 0:e.stopGyroscope)==null||d.call(e,{}),i=!1),m&&((g=e==null?void 0:e.offAccelerometerChange)==null||g.call(e,S),(w=e==null?void 0:e.stopAccelerometer)==null||w.call(e),m=!1),h.x=0,h.y=0,r=null,c=null}let Y=x.querySelector(".sensor");return Y&&k(Y,"click",s=>{s.stopPropagation(),F(),N()}),k(window,"pagehide",O),k(document,"visibilitychange",()=>{document.hidden&&O()}),k(window,"message",s=>{var d;s.source!==parent||((d=s.data)==null?void 0:d.type)!=="playable-active"||(z=s.data.active===!0,z||(O(),y==null||y.suspend().catch(()=>{})))}),{state:h,start:N,stop:O,recenter(){r=null}}}function le(n){let t=390,o=598,a=n.getContext("2d");function e(){let l=n.getBoundingClientRect();t=Math.max(1,l.width),o=Math.max(1,l.height);let i=Math.min(2,window.devicePixelRatio||1);n.width=Math.round(t*i),n.height=Math.round(o*i),a.setTransform(i,0,0,i,0,0)}return e(),k(window,"resize",e),{ctx:a,get W(){return t},get H(){return o}}}function ne(n){let t=0;function o(a){if(D)return;let e=Math.min(.034,(a-(t||a))/1e3);t=a,document.hidden||n(z?e:0,a/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}k(window,"pagehide",()=>{D=!0,H.splice(0).forEach(n=>n()),y==null||y.close().catch(()=>{})});let $={};function ie(n,t){return $[n]??t}async function oe(n=()=>{}){let t,o=new AbortController;try{t=setTimeout(()=>o.abort(),1800);let a=await fetch("./game.config.json",{signal:o.signal});if(!a.ok)throw new Error("Configuration unavailable");let e=await a.json();for(let l of["texts","tweaks","images"])for(let i of Array.isArray(e[l])?e[l]:[])i&&typeof i.id=="string"&&($[i.id]=l==="images"?i.path:i.value);n(),x.dataset.config="loaded"}catch{x.dataset.config="defaults"}finally{clearTimeout(t)}}V("body{color:#c9cce2;background:#080d1d}.magic{width:100%;height:100%;position:relative;overflow:hidden;background:radial-gradient(ellipse at 50% 42%,#1a2144 0,#10142c 37%,#080c17 80%)}.stars{position:absolute;inset:0;background-image:radial-gradient(#a9b8e54d .8px,transparent .9px);background-size:91px 83px;opacity:.35}.orb{position:absolute;top:42%;left:50%;width:87%;max-width:440px;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;border:0;background:radial-gradient(ellipse at 48% 7%,#4e5653 0,transparent 27%),radial-gradient(ellipse at 50% 30%,#1e2527,#080e11 65%,#1a2225 85%,#05080a 100%);box-shadow:inset 3px 1px 4px #afbfbe5c,inset -2px -1px 4px #d1efff3b,0 12px 24px #0009}.orb:before{content:'';position:absolute;inset:2%;border-radius:50%;background:radial-gradient(ellipse at 50% -8%,#edf6e4d9 0,transparent 24%);clip-path:polygon(21% 0,80% 0,72% 11%,28% 11%);filter:blur(1px)}.orb:after{content:'';position:absolute;inset:0;border-radius:50%;box-shadow:inset 7px -1px 7px -5px #399aff,inset -7px -1px 7px -5px #6091ff;pointer-events:none}.seam{position:absolute;top:49%;left:0;right:0;height:2px;background:linear-gradient(90deg,#707c7766,transparent 25%,transparent 75%,#707c7766);box-shadow:0 2px 2px #000}.rim{position:absolute;width:64%;height:64%;left:18%;top:19%;border-radius:50%;padding:8px;background:conic-gradient(from 20deg,#5e696e,#b6c6d2,#596b74,#dce5e9,#4f626b,#d9e8ea,#697578);box-shadow:0 0 0 3px #373f43,0 4px 9px #0008}.window{display:block;height:100%;width:100%;position:relative;border-radius:50%;background:radial-gradient(ellipse at 50% 55%,#111e3d,#080e18 74%);box-shadow:inset 0 3px 10px #000;overflow:hidden}.triangle{position:absolute;left:14%;top:24%;width:72%;height:64%;clip-path:polygon(0 0,100% 0,50% 100%);background:linear-gradient(150deg,#86aaff,#557af5 35%,#263bba);filter:drop-shadow(0 0 3px #527aff);transition:opacity .4s,transform .7s}.triangle:before{content:'';position:absolute;inset:2px;clip-path:polygon(0 0,100% 0,50% 100%);background:linear-gradient(150deg,#7297ff,#4564e0 45%,#253091)}.answer{position:absolute;top:9%;left:13%;width:74%;color:#edf6ff;text-align:center;font:800 clamp(9px,2.8vw,14px)/1.35 Arial,sans-serif;letter-spacing:.5px;text-shadow:0 1px 4px #b3d7ff}.answer.initial{font-size:30px}.magic.thinking .triangle{opacity:.08;transform:translateY(15px) rotate(-20deg)}.magic.thinking .orb{animation:orb-shake .55s ease-in-out 2}.magic .guide{top:75%;font-weight:500;font-size:15px}.magic .sensor{bottom:35px;color:#b3b8d4}.status{position:absolute;top:76%;left:30px;right:30px;text-align:center;font-size:14px;color:#8994b5;pointer-events:none}@keyframes orb-shake{25%{transform:translate(-53%,-52%) rotate(-5deg)}75%{transform:translate(-47%,-48%) rotate(5deg)}}"),x.innerHTML='<div class="magic"><div class="stars"></div><button class="orb" aria-label="Shake the Magic 8 Ball"><span class="seam"></span><span class="rim"><span class="window"><span class="triangle"><span class="answer initial">?</span></span></span></span></button><div class="guide">Shake or tap for an answer</div><div class="status" aria-live="polite"></div><button class="sensor">Enable shake</button></div>';let q=["IT IS CERTAIN","WITHOUT A DOUBT","YES, DEFINITELY","YOU MAY RELY ON IT","AS I SEE IT, YES","MOST LIKELY","OUTLOOK GOOD","YES","SIGNS POINT TO YES","ASK AGAIN LATER","BETTER NOT TELL YOU NOW","CANNOT PREDICT NOW","CONCENTRATE AND ASK AGAIN","DON\u2019T COUNT ON IT","MY REPLY IS NO","MY SOURCES SAY NO","OUTLOOK NOT SO GOOD","VERY DOUBTFUL","REPLY HAZY, TRY AGAIN","IT IS DECIDEDLY SO"],ae=x.querySelector(".orb"),_=x.querySelector(".magic"),C=x.querySelector(".answer"),X=x.querySelector(".status");function se(n,t,o,a){let e=String(n).trim().split(/\s+/),l=Math.max(4,t*.028),i=Math.max(3,o*.065),m=null;for(let r=Math.floor(Math.min(t*.66,o*.72));r>=8;r--){let c=a("\xC1\xC9\xCC\xD4\xD9gj",r),u=c.ascent,p=c.descent,T=r*1.12,M=new Map,h=(f,S)=>{let b=f+":"+S;return M.has(b)||M.set(b,a(e.slice(f,S).join(" "),r).width),M.get(b)},A=null;for(let f=1;f<=Math.min(6,e.length);f++){let S=function(N,O){let Y=i+u+O*T,s=Y+p+1,d=t*(1-s/o)-l*2,g=null;for(let w=N+1;w<=e.length-(f-O-1);w++){let E=h(N,w);if(E>d)break;let B={text:e.slice(N,w).join(" "),x:t/2,y:Y,width:E,available:d};if(O===f-1){if(w!==e.length)continue;let L={lines:[B],score:E/Math.max(1,d)};(!g||L.score>g.score)&&(g=L)}else{let L=S(w,O+1);if(!L)continue;let Q={lines:[B,...L.lines],score:E/Math.max(1,d)+L.score};(!g||Q.score>g.score)&&(g=Q)}}return g};if(i+u+p+(f-1)*T>o*.88)continue;let b=S(0,0);b&&(!A||b.score/b.lines.length>A.score/A.lines.length)&&(A=b)}if(A){let f={size:r,ascent:u,descent:p,lines:A.lines};if(r>=12)return f;m||(m=f)}}for(let r=Math.floor(Math.min(t*.35,o*.5));r>=8;r--){let c=a("\xC1\xC9\xCC\xD4\xD9gj",r),u=[],p=String(n).trim(),T=0;for(;p&&T<10;){let M=i+c.ascent+T*r*1.12,h=M+c.descent+1;if(h>o*.88)break;let A=t*(1-h/o)-l*2,f=0;for(;f<p.length&&a(p.slice(0,f+1),r).width<=A;)f++;if(!f)break;let S=p.lastIndexOf(" ",f);f<p.length&&S>=Math.floor(f*.65)&&(f=S);let b=p.slice(0,f).trimEnd();u.push({text:b,x:t/2,y:M,width:a(b,r).width,available:A}),p=p.slice(f).trimStart(),T++}if(!p)return{size:r,ascent:c.ascent,descent:c.descent,lines:u}}return m||{size:8,ascent:8,descent:2,lines:[{text:String(n),x:t/2,y:i+8,width:a(String(n),8).width}]}}let R="?",P=document.createElement("canvas").getContext("2d");function U(n=R){R=String(n);let t=C.parentElement,o=t.clientWidth,a=t.clientHeight;if(!o||!a||!P)return;let e=getComputedStyle(C).fontFamily;function l(c,u){P.font=`700 ${u}px ${e}`;let p=P.measureText(c);return{width:Math.max(p.width,(p.actualBoundingBoxLeft||0)+(p.actualBoundingBoxRight||0)),ascent:p.actualBoundingBoxAscent||u*.85,descent:Math.max(1,p.actualBoundingBoxDescent||u*.2)}}let i=se(R,o,a,l),m="http://www.w3.org/2000/svg",r=document.createElementNS(m,"svg");r.setAttribute("viewBox",`0 0 ${o} ${a}`),r.setAttribute("aria-hidden","true");for(let c of i.lines){let u=document.createElementNS(m,"text");u.setAttribute("x",String(c.x)),u.setAttribute("y",String(c.y)),u.setAttribute("text-anchor","middle"),u.setAttribute("font-size",String(i.size)),u.setAttribute("font-family",e),u.setAttribute("font-weight","700"),u.textContent=c.text,r.append(u)}C.replaceChildren(r),C.setAttribute("aria-label",R),C.dataset.fontSize=String(i.size),C.dataset.lines=String(i.lines.length)}V("#root .triangle .answer{inset:0;width:100%;height:100%;font-family:UIBody,Arial,sans-serif;font-weight:700;letter-spacing:0;line-height:1;text-wrap:initial;pointer-events:none}#root .triangle .answer svg{display:block;width:100%;height:100%;overflow:visible;fill:currentColor}"),U(),k(window,"resize",()=>U());let I=typeof ResizeObserver=="function"?new ResizeObserver(()=>U()):null;I==null||I.observe(C.parentElement),k(window,"pagehide",()=>I==null?void 0:I.disconnect()),(J=document.fonts)==null||J.ready.then(()=>{D||U()});let v="ready",G=0,Z=-1,re=te({shake:!0,onShake:j});function j(){v==="thinking"||v==="settling"||!z||(F(),re.start(),ee(),v="thinking",G=0,_.classList.add("thinking"),X.textContent="",x.dataset.phase=v,K(140,.35,.09,"sine",70))}k(ae,"click",j),k(window,"keydown",n=>{n.code==="Space"&&(n.preventDefault(),j())}),ne(n=>{if(!(v==="ready"||v==="answered")){if(G+=n,v==="thinking"&&G>1.15){let t=Math.floor(Math.random()*q.length);t===Z&&(t=(t+1)%q.length),Z=t,C.classList.remove("initial"),U(q[t]),_.classList.remove("thinking"),v="settling",x.dataset.phase=v,K(520,.4,.08,"sine",780)}v==="settling"&&G>2.1&&(v="answered",x.dataset.phase=v,X.textContent="Shake again")}}),oe(()=>{x.querySelector(".guide").textContent=String(ie("GUIDE","Shake or tap for an answer"))})})();(()=>{let x=document.createElement("style");x.dataset.batch3Ui="20261116",x.textContent=`
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

.magic .guide{font:700 18px/1.4 UIBody,system-ui,sans-serif;top:75%;color:#d7e0ff}
.magic .sensor{bottom:50px;min-height:44px;padding:10px 20px;font-size:14px;background:#ffffff0e;border-color:#9cafd566}
.magic .status{top:80%;bottom:auto;font-size:14px;line-height:1.4;color:#aebadd}
.answer{font-family:UIBody,system-ui,sans-serif;font-size:clamp(12px,3vw,14px);line-height:1.3;letter-spacing:0;left:8%;width:84%;text-wrap:balance}
.answer.initial{font-size:28px}
`,document.head.append(x)})();})();
