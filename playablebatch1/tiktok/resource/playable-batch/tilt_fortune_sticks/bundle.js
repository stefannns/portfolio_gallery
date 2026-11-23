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

(()=>{document.documentElement.lang="it";(()=>{"use strict";let f=document.getElementById("root"),y=(e,i,c)=>Math.max(i,Math.min(c,e)),X=!0,fe=!1,pe=[];function z(e,i,c,t){e.addEventListener(i,c,t),pe.push(()=>e.removeEventListener(i,c,t))}function Ae(e){let i=document.createElement("style");i.textContent="*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}"+e,document.head.append(i)}function Ce(){var e;(e=f.querySelector(".guide"))==null||e.classList.add("gone")}let w;function ee(){try{w||(w=new(window.AudioContext||window.webkitAudioContext)),w.state==="suspended"&&w.resume().catch(()=>{})}catch{}}function de(e=400,i=.1,c=.15,t="sine",n=0){if(!(!w||!X))try{let s=w.currentTime,r=w.createOscillator(),u=w.createGain();r.type=t,r.frequency.setValueAtTime(e,s),n&&r.frequency.exponentialRampToValueAtTime(Math.max(20,n),s+i),u.gain.setValueAtTime(1e-4,s),u.gain.exponentialRampToValueAtTime(c,s+.008),u.gain.exponentialRampToValueAtTime(1e-4,s+i),r.connect(u),u.connect(w.destination),r.start(s),r.stop(s+i+.02),r.onended=()=>{r.disconnect(),u.disconnect()}}catch{}}function Ie({gyro:e=!1,shake:i=!1,onTilt:c=()=>{},onShake:t=()=>{}}={}){let n=window.tt,s=!1,r=!1,u=!1,h=null,m=null,C=0,A=0,I=-2e3,P=-2e3,g={x:0,y:0,yaw:0,pitch:0,roll:0,received:!1},T=(p,d)=>Math.atan2(Math.sin(p-d),Math.cos(p-d));function E(p){if(!X||!p||p.result===-1)return;let d=Number(p.pitch??p.x)||0,b=Number(p.yaw??p.y)||0,l=Number(p.roll??p.z)||0;h||(h={pitch:d,yaw:b,roll:l}),g.pitch=d,g.yaw=b,g.roll=l,g.x=y(T(l,h.roll)/.42,-1,1),g.y=y(T(d,h.pitch)/.42,-1,1),Math.abs(g.x)<.025&&(g.x=0),Math.abs(g.y)<.025&&(g.y=0),g.received=!0,c(g)}function q(p){if(!X||!p)return;let d={x:Number(p.x)||0,y:Number(p.y)||0,z:Number(p.z)||0};m||(m={...d});let b=Math.max(.1,Math.hypot(m.x,m.y,m.z)),l=Math.hypot(d.x-m.x,d.y-m.y,d.z-m.z)/b;for(let S of["x","y","z"])m[S]=m[S]*.82+d[S]*.18;if(C++<5)return;let x=performance.now();x-P<1300||(x-I>1400&&(A=0),l>.55&&x-I>200&&(I=x,A++,A>=2&&(A=0,P=x,t())))}function G(p,d=!1){let b=f.querySelector(".sensor");b&&(b.textContent=p,b.hidden=d)}function $(){if(!(s||!X)){if(s=!0,h=null,m=null,C=0,e&&(n!=null&&n.startGyroscope)&&(n!=null&&n.onGyroscopeChange)&&(r=!0,n.onGyroscopeChange(E),n.startGyroscope({interval:50,fail:()=>{r=!1,s=!1,G("Attiva inclinazione")}})),i&&(n!=null&&n.startAccelerometer)&&(n!=null&&n.onAccelerometerChange)&&n.startAccelerometer({success:()=>{u=!0,n.onAccelerometerChange(q)},fail:()=>{s=!1,G("Attiva movimento")}}),e&&!r||!e&&i&&!(n!=null&&n.startAccelerometer)){s=!1,G("Movimento non disponibile");return}G("Movimento attivo",!0)}}function L(){var p,d,b,l;s=!1,r&&((p=n==null?void 0:n.offGyroscopeChange)==null||p.call(n,E),(d=n==null?void 0:n.stopGyroscope)==null||d.call(n,{}),r=!1),u&&((b=n==null?void 0:n.offAccelerometerChange)==null||b.call(n,q),(l=n==null?void 0:n.stopAccelerometer)==null||l.call(n),u=!1),g.x=0,g.y=0,h=null,m=null}let J=f.querySelector(".sensor");return J&&z(J,"click",p=>{p.stopPropagation(),ee(),$()}),z(window,"pagehide",L),z(document,"visibilitychange",()=>{document.hidden&&L()}),z(window,"message",p=>{var d;p.source!==parent||((d=p.data)==null?void 0:d.type)!=="playable-active"||(X=p.data.active===!0,X||(L(),w==null||w.suspend().catch(()=>{})))}),{state:g,start:$,stop:L,recenter(){h=null}}}function qe(e){let i=390,c=598,t=e.getContext("2d");function n(){let s=e.getBoundingClientRect();i=Math.max(1,s.width),c=Math.max(1,s.height);let r=Math.min(2,window.devicePixelRatio||1);e.width=Math.round(i*r),e.height=Math.round(c*r),t.setTransform(r,0,0,r,0,0)}return n(),z(window,"resize",n),{ctx:t,get W(){return i},get H(){return c}}}function Pe(e){let i=0;function c(t){if(fe)return;let n=Math.min(.034,(t-(i||t))/1e3);i=t,document.hidden||e(X?n:0,t/1e3),requestAnimationFrame(c)}requestAnimationFrame(c)}z(window,"pagehide",()=>{fe=!0,pe.splice(0).forEach(e=>e()),w==null||w.close().catch(()=>{})});let ue={};function N(e,i){return ue[e]??i}async function Xe(e=()=>{}){let i,c=new AbortController;try{i=setTimeout(()=>c.abort(),1800);let t=await fetch("./game.config.json",{signal:c.signal});if(!t.ok)throw new Error("Configurazione non disponibile");let n=await t.json();for(let s of["texts","tweaks","images"])for(let r of Array.isArray(n[s])?n[s]:[])r&&typeof r.id=="string"&&(ue[r.id]=s==="images"?r.path:r.value);e(),f.dataset.config="loaded"}catch{f.dataset.config="defaults"}finally{clearTimeout(i)}}Ae(`
body{background:#170b08;color:#efddac;font-family:Georgia,serif}
.fortune{height:100%;width:100%;position:relative;overflow:hidden;touch-action:none;background:linear-gradient(#16070520,#13060245),url('./assets/shrine.webp') center/cover}
.object{position:absolute;left:50%;top:49%;height:47.6%;width:15.967vh;max-width:35.7%;transform:translate(-50%,-50%);transform-origin:50% 95%;filter:drop-shadow(6px 11px 9px #0009);touch-action:none}
.tube{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;z-index:1;pointer-events:none;user-select:none;-webkit-user-drag:none}
.tube-front{z-index:4;clip-path:polygon(0 4.8%,7% 4.8%,15% 7%,30% 9%,50% 9.6%,70% 9%,85% 7%,94% 4.8%,100% 4.8%,100% 100%,0 100%)}
.sticks{position:absolute;inset:0;z-index:2;pointer-events:none}
.stick{position:absolute;display:block;max-width:none;transform-origin:50% 100%;pointer-events:none;user-select:none;-webkit-user-drag:none;will-change:transform}
.stick.chosen{z-index:6;transform-origin:50% 50%}
.fortune .guide{top:78%;color:#eed9ac;text-shadow:0 2px 4px #000;font-weight:400;font-family:Georgia,serif;font-size:18px}
.fortune .sensor{bottom:50px;background:#2e140ebb;border-color:#947345;color:#ebd9b0}
.result{position:absolute;inset:0;z-index:20;display:grid;place-items:center;background:#0c06045e}.result[hidden]{display:none}
.paper{position:relative;width:calc(100% - 60px);max-width:330px;min-height:280px;border:2px solid #d5b76d;outline:1px solid #594620;outline-offset:-10px;padding:38px 25px 28px;text-align:center;color:#553917;background:radial-gradient(ellipse at 50% 25%,#faedbd,#d5b66e);box-shadow:0 15px 40px #0008}
.seal{position:absolute;top:-18px;left:calc(50% - 17px);width:34px;height:34px;border-radius:50%;background:#791b24;border:2px solid #b99a5e;color:#f1d291;display:grid;place-items:center;font-size:18px}
.eyebrow{font:12px UIBody,Arial,sans-serif;letter-spacing:2px}.paper h1{font:24px Georgia,serif;margin:25px 0 12px}.paper p{font:16px/1.6 Georgia,serif;margin:0 0 24px}
.paper button{background:#7a1822;color:#f1deb2;border:1px solid #b58b52;padding:11px 22px;box-shadow:0 3px 6px #523a2140;font:16px Georgia,serif;min-height:44px}
.meter{position:absolute;left:calc(50% - 42px);bottom:100px;width:84px;height:2px;background:#dfbd6333;overflow:hidden}.meter i{display:block;height:100%;width:0;background:#d8b66f}
`),f.innerHTML=`<div class="fortune">
 <div class="object" role="img" aria-label="Scuoti il cilindro con i bastoncini della fortuna">
  <img class="tube" src="./assets/physical-v2/cylinder.webp" alt="">
  <div class="sticks"></div>
  <img class="tube tube-front" src="./assets/physical-v2/cylinder.webp" alt="" aria-hidden="true">
 </div>
 <div class="guide">Scuoti e scopri il tuo destino</div><div class="meter"><i></i></div><button class="sensor">Attiva movimento</button>
 <div class="result" hidden><div class="paper"><span class="seal">\u2726</span><div class="eyebrow">IL TUO RESPONSO</div><h1></h1><p></p><button>Estrai ancora</button></div></div>
</div>`;let H=[["Fortuna duratura","Prosegui con calma. Ci\xF2 che costruisci ora durer\xE0."],["Un nuovo inizio","Un piccolo passo oggi aprir\xE0 una porta domani."],["Buona compagnia","Una persona affine \xE8 pi\xF9 vicina di quanto pensi."],["Fortuna discreta","La risposta arriva quando le lasci spazio."],["Un futuro luminoso","La tua pazienza sta per dare i suoi frutti."],["Una bella sorpresa","Lascia un po\u2019 di spazio agli imprevisti."],["Fidati del tuo cammino","Hai pi\xF9 coraggio di quanto immagini."],["Il momento giusto","Quando arriva l\u2019occasione, fai il primo passo."]],v=f.querySelector(".object"),he=f.querySelector(".sticks"),ge=f.querySelector(".result"),me=f.querySelector(".meter i"),xe=[1,2,3].map(e=>"./assets/physical-v2/stick"+e+".webp"),V=[32/850,35/850,42/850],Y=[],o={angle:0,av:0,x:0,vx:0,targetX:0,frameX:0,frameY:0,thrustY:0,zoom:1},U=0,M="ready",k=0,te=!1,O=null,ne=0,ye=0,be=0,we=-1,D=1,a=null,ie=0,oe=-1/0,B=0,W=0,ae=0,K=0,re=0,Ye=2.8,Te=-.28,R=e=>(e=y(e,0,1),e*e*(3-2*e));for(let e=0;e<3;e++)for(let i=0;i<7;i++){let c=e*7+i,t=(i+e)%3,n=document.createElement("img");n.className="stick",n.src=xe[t],n.alt="",n.setAttribute("aria-hidden","true"),n.draggable=!1,n.style.zIndex=String(e+1),n.style.filter="brightness("+(.87+e*.065)+")";let s=.3+i*.066+(Math.random()-.5)*.012,r=.74+e*.018,u=.21+i*.095+(Math.random()-.5)*.012,h=Math.atan((u-s)*(369/1100)/(r-.065)),m={el:n,variant:t,row:e,col:i,rootX:s,rootY:r,length:.95+Math.random()*.11,rest:h,angle:h,av:0,bob:0,bv:0,lift:0};Y.push(m),he.append(n),n.onload=()=>{n.naturalHeight&&(V[t]=n.naturalWidth/n.naturalHeight)}}f.dataset.stickCount=String(Y.length);let ve=Ie({shake:!0,onShake:()=>{D*=-1,se(.48,D)}});function se(e,i=1){if(!X||M!=="ready")return;if(!a){let s=Y.filter(r=>r.col===6);a=s[Math.floor(Math.random()*s.length)],a.el.dataset.emerging="true"}let c=y(Number(N("SHAKE_EFFORT",2.45)),1,6);ee(),Ce(),U=y(U+e/c,0,1);let t=Math.min(1,e*5);o.av=y(o.av+i*(20+t*80),-180,180);for(let s of Y)s.av-=i*t*(.9+Math.random()*1.2),s.bv-=t*(.06+Math.random()*.12);let n=performance.now();oe=n,n-be>140&&(de(460+Math.random()*250,.05,.08,"triangle",210),be=n)}z(v,"pointerdown",e=>{!X||M!=="ready"||O!==null||e.isPrimary===!1||(ee(),ve.start(),v.setPointerCapture(e.pointerId),O=e.pointerId,te=!0,ye=ne=e.clientX)}),z(v,"pointermove",e=>{if(!te||e.pointerId!==O||M!=="ready")return;let i=e.clientX-ne;ne=e.clientX,o.targetX=y((e.clientX-ye)*.3,-22,22),Math.abs(i)>1&&se(Math.abs(i)/180,Math.sign(i))});function F(){let e=O;te=!1,O=null,o.targetX=0,e!==null&&v.hasPointerCapture(e)&&v.releasePointerCapture(e)}for(let e of["pointerup","pointercancel","lostpointercapture"])z(v,e,F);z(window,"keydown",e=>{e.code==="Space"&&!e.repeat&&(e.preventDefault(),ve.start(),D*=-1,se(.37,D))}),z(document,"visibilitychange",()=>{document.hidden&&F()}),z(window,"message",e=>{var i;e.source===parent&&((i=e.data)==null?void 0:i.type)==="playable-active"&&!e.data.active&&F()});function Me(){F(),a!=null&&a.outside&&he.append(a.el),M="ready",U=0,k=0,a=null,ie=0,oe=-1/0,B=0,W=0,ae=0,K=0,re=0,ge.hidden=!0,me.style.width="0%",Object.assign(o,{angle:0,av:0,x:0,vx:0,targetX:0,frameX:0,frameY:0,thrustY:0,zoom:1});for(let e of Y)e.angle=e.rest,e.av=0,e.bob=0,e.bv=0,e.lift=0,e.outside=!1,e.freePose=null,e.outsideStart=null,e.outsideProgress=0,e.el.style.visibility="visible",e.el.style.zIndex=String(e.row+1),delete e.el.dataset.emerging;ze(0,v.clientWidth,v.clientHeight),Se(v.clientWidth,v.clientHeight),f.dataset.phase=M}z(f.querySelector(".paper button"),"click",Me);function Ee(){let e=Math.floor(Math.random()*H.length);e===we&&(e=(e+1)%H.length),we=e,f.querySelector(".paper h1").textContent=H[e][0],f.querySelector(".paper p").textContent=H[e][1],ge.hidden=!1,M="revealed",f.dataset.phase=M,de(660,.5,.07,"sine",880)}function ke(e,i){e.pose=i,e.el.style.left=i.x-i.width/2+"px",e.el.style.top=i.y-i.length+"px",e.el.style.width=i.width+"px",e.el.style.height=i.length+"px",e.el.style.transform="rotate("+i.angle*180/Math.PI+"deg)"}function ze(e,i,c){for(let t of Y){if(t===a&&t.freePose){let P=t.length*c,g=y(P*V[t.variant],7,16);t.angle=t.freePose.angle,ke(t,{x:t.freePose.x*i,y:t.freePose.y*c,length:P,width:g,angle:t.angle});continue}let n=t===a,s=Math.max(.01,t.rootY-.03),r=n?y(t.lift/s,0,1):0,u=n?t.rest*(1-r)+Te*r:t.rest,h=n?58:38+t.row*5+t.col%3*3;t.av+=(-(t.angle-u)*h-t.av*(n?10:6.5)-o.av*Math.PI/180*.11)*e,t.angle+=t.av*e,t.bv+=(-t.bob*86-t.bv*8)*e,t.bob=y(t.bob+t.bv*e,-.065,.012);let m=(t.rootY+t.bob-t.lift)*c,C=t.rootX*i;if(m>c*.065){let P=Math.max(2,m-c*.065),g=y(t.length*c*V[t.variant],7,16)/2,T=Math.atan((i*.13+g-C)/P),E=Math.atan((i*.87-g-C)/P);t.angle<T&&(t.angle=T,t.av=n?Math.max(0,t.av):Math.abs(t.av)*.3,n||(t.bv-=.01)),t.angle>E&&(t.angle=E,t.av=n?Math.min(0,t.av):-Math.abs(t.av)*.3,n||(t.bv-=.01))}let A=t.length*c,I=y(A*V[t.variant],7,16);ke(t,{x:C,y:m,length:A,width:I,angle:t.angle})}}function Se(e,i,c=0){if(o.frameX=0,o.frameY=0,o.zoom=1,a){let t=o.angle*Math.PI/180,n=Math.cos(t),s=Math.sin(t),r=e*.5,u=i*.95,h=f.clientWidth*.5-e*.5+o.x,m=f.clientHeight*.49-i*.5+o.thrustY,C=(l,x,S=o.zoom)=>({x:h+r+S*((l-r)*n-(x-u)*s),y:m+u+S*((l-r)*s+(x-u)*n)}),A=[{x:0,y:0},{x:e,y:0},{x:e,y:i},{x:0,y:i}];for(let l of Y){let x=l.pose;if(!x)continue;let S=Math.cos(x.angle),Q=Math.sin(x.angle),Z=x.width/2;for(let j of[0,x.length])for(let _ of[-1,1])A.push({x:x.x+Q*j+_*S*Z,y:x.y-S*j+_*Q*Z})}let I=A.map(l=>C(l.x,l.y,1)),P=Math.max(...I.map(l=>l.x))-Math.min(...I.map(l=>l.x)),g=Math.max(...I.map(l=>l.y))-Math.min(...I.map(l=>l.y)),T=a.outside?1-a.outsideProgress:y((a.lift-.1)/(a.rootY+.045-.1),0,1),E=1-.18*R(T);o.zoom=Math.min(E,Math.max(1,f.clientWidth-60)/Math.max(1,P),Math.max(1,f.clientHeight-150)/Math.max(1,g));let q=A.map(l=>C(l.x,l.y)),G=Math.min(...q.map(l=>l.x)),$=Math.max(...q.map(l=>l.x)),L=Math.min(...q.map(l=>l.y)),J=Math.max(...q.map(l=>l.y)),p=(l,x,S,Q=30,Z=30)=>{let j=Q-l,_=S-Z-x;if(j<=_+.01)return y(0,j,Math.max(j,_));let le=8-l,ce=S-8-x;return le<=ce?y(0,le,ce):(le+ce)/2};o.frameX=p(G,$,f.clientWidth),o.frameY=p(L,J,f.clientHeight,30,120);let d=a.pose,b=C(d.x+Math.sin(d.angle)*d.length/2,d.y-Math.cos(d.angle)*d.length/2);b.x+=o.frameX,b.y+=o.frameY,a.worldCenter&&c>0&&(a.velocity={x:(b.x-a.worldCenter.x)/c,y:(b.y-a.worldCenter.y)/c}),a.worldCenter=b}v.style.transform=`translate(-50%,-50%) translate(${o.x+o.frameX}px,${o.frameY+o.thrustY}px) rotate(${o.angle}deg) scale(${o.zoom})`}Pe(e=>{let i=v.clientHeight,c=v.clientWidth;if(o.av+=(-o.angle*70-o.av*10)*e,o.angle=y(o.angle+o.av*e,-11,11),o.vx+=((o.targetX-o.x)*80-o.vx*10)*e,o.x+=o.vx*e,M==="ready"&&(U=Math.max(0,U-e*.025),a)){performance.now()-oe<650&&(ie+=e),B=Math.min(U,y(ie/Ye,0,1));let t=(a.rootY-.03)*.18*B;a.lift+=(t-a.lift)*Math.min(1,e*3.5),B>=.999&&(M="picking",k=0,W=a.lift,ae=o.angle,K=o.angle,re=o.thrustY,F(),f.dataset.phase=M)}if(M==="picking"){k+=e;let t=y(k/.4,0,1),n=1-R(t),s=Math.sin(t*Math.PI*4)*Math.sin(t*Math.PI)*(1-.3*t);o.angle=ae*n+6*s,o.thrustY=re*n+3*s,e>0&&(o.av=(o.angle-K)/e),K=o.angle;let r=a.rootY+.045;if(k<1.35)a.lift=W+(r-W)*R((k-.25)/1.1);else if(k<1.85)a.lift=r+.008*Math.sin((k-1.35)/.5*Math.PI);else if(!a.outsideStart)a.lift=r;else if(k<2.45){let u=R((k-1.85)/.6),h=a.outsideStart;a.freePose={x:h.x+(-.8-h.x)*u,y:h.y+(-.055-h.y)*u,angle:h.angle+(.08-h.angle)*u}}else{let u=R((k-2.45)/1);a.freePose={x:-.8,y:-.055+.995*u,angle:.08},a.outsideProgress=u}}if(ze(e,c,i),Se(c,i,e),me.style.width=B*100+"%",f.dataset.shakeProgress=B.toFixed(3),M==="picking"&&k>=1.35&&!a.outside){let t=a.pose;t.y+Math.abs(Math.sin(t.angle))*t.width/2<=i*.035&&(v.append(a.el),a.el.style.zIndex="6",a.outside=!0,a.outsideProgress=0)}if(M==="picking"&&k>=1.85&&a.outside&&!a.outsideStart){let t=a.pose;a.outsideStart={x:t.x/c,y:t.y/i,angle:t.angle}}M==="picking"&&k>=3.55&&(o.thrustY=0,o.angle=0,Ee())}),Me(),Xe(()=>{f.querySelector(".guide").textContent=String(N("GUIDE","Scuoti e scopri il tuo destino")),f.querySelector(".fortune").style.backgroundImage="linear-gradient(#16070520,#13060245),url("+JSON.stringify(String(N("BACKGROUND","./assets/shrine.webp")))+")",f.querySelectorAll(".tube").forEach(e=>{e.src=String(N("TUBE","./assets/physical-v2/cylinder.webp"))});for(let e of Y)e.el.src=String(N("STICK_"+(e.variant+1),xe[e.variant]))})})();(()=>{let f=document.createElement("style");f.dataset.batch3Ui="20261116",f.textContent=`
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

.fortune .guide{font:400 18px/1.4 Georgia,serif;top:78%;left:30px;right:30px}
.fortune .sensor{bottom:50px;min-height:44px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
.fortune .result{padding:30px 30px 50px;overflow:auto;display:grid}
.paper{width:100%;max-width:330px;padding:36px 25px 28px}
.paper h1{font-size:24px;line-height:1.3}.paper p{font-size:16px;line-height:1.6}
.paper button{font-size:16px;min-height:44px}.eyebrow{font:400 12px/1.4 UIBody,system-ui,sans-serif;letter-spacing:2px}
.fortune .meter{bottom:100px}
`,document.head.append(f)})();})();
