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

(()=>{document.documentElement.lang="it";(()=>{"use strict";var ge,me;let c=document.getElementById("root"),b=(e,n,a)=>Math.max(n,Math.min(a,e)),B=!0,ie=!1,oe=[];function v(e,n,a,o){e.addEventListener(n,a,o),oe.push(()=>e.removeEventListener(n,a,o))}function Ce(e){let n=document.createElement("style");n.textContent="*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}"+e,document.head.append(n)}function Ie(){var e;(e=c.querySelector(".guide"))==null||e.classList.add("gone")}let d;function Z(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function re(e=400,n=.1,a=.15,o="sine",t=0){if(!(!d||!B))try{let r=d.currentTime,s=d.createOscillator(),k=d.createGain();s.type=o,s.frequency.setValueAtTime(e,r),t&&s.frequency.exponentialRampToValueAtTime(Math.max(20,t),r+n),k.gain.setValueAtTime(1e-4,r),k.gain.exponentialRampToValueAtTime(a,r+.008),k.gain.exponentialRampToValueAtTime(1e-4,r+n),s.connect(k),k.connect(d.destination),s.start(r),s.stop(r+n+.02),s.onended=()=>{s.disconnect(),k.disconnect()}}catch{}}function ze({gyro:e=!1,shake:n=!1,onTilt:a=()=>{},onShake:o=()=>{}}={}){let t=window.tt,r=!1,s=!1,k=!1,W=null,w=null,xe=0,K=0,ne=-2e3,ye=-2e3,h={x:0,y:0,yaw:0,pitch:0,roll:0,received:!1},we=(l,f)=>Math.atan2(Math.sin(l-f),Math.cos(l-f));function be(l){if(!B||!l||l.result===-1)return;let f=Number(l.pitch??l.x)||0,I=Number(l.yaw??l.y)||0,E=Number(l.roll??l.z)||0;W||(W={pitch:f,yaw:I,roll:E}),h.pitch=f,h.yaw=I,h.roll=E,h.x=b(we(E,W.roll)/.42,-1,1),h.y=b(we(f,W.pitch)/.42,-1,1),Math.abs(h.x)<.025&&(h.x=0),Math.abs(h.y)<.025&&(h.y=0),h.received=!0,a(h)}function ve(l){if(!B||!l)return;let f={x:Number(l.x)||0,y:Number(l.y)||0,z:Number(l.z)||0};w||(w={...f});let I=Math.max(.1,Math.hypot(w.x,w.y,w.z)),E=Math.hypot(f.x-w.x,f.y-w.y,f.z-w.z)/I;for(let ae of["x","y","z"])w[ae]=w[ae]*.82+f[ae]*.18;if(xe++<5)return;let Y=performance.now();Y-ye<1300||(Y-ne>1400&&(K=0),E>.55&&Y-ne>200&&(ne=Y,K++,K>=2&&(K=0,ye=Y,o())))}function J(l,f=!1){let I=c.querySelector(".sensor");I&&(I.textContent=l,I.hidden=f)}function Me(){if(!(r||!B)){if(r=!0,W=null,w=null,xe=0,e&&(t!=null&&t.startGyroscope)&&(t!=null&&t.onGyroscopeChange)&&(s=!0,t.onGyroscopeChange(be),t.startGyroscope({interval:50,fail:()=>{s=!1,r=!1,J("Attiva inclinazione")}})),n&&(t!=null&&t.startAccelerometer)&&(t!=null&&t.onAccelerometerChange)&&t.startAccelerometer({success:()=>{k=!0,t.onAccelerometerChange(ve)},fail:()=>{r=!1,J("Attiva movimento")}}),e&&!s||!e&&n&&!(t!=null&&t.startAccelerometer)){r=!1,J("Movimento non disponibile");return}J("Movimento attivo",!0)}}function Q(){var l,f,I,E;r=!1,s&&((l=t==null?void 0:t.offGyroscopeChange)==null||l.call(t,be),(f=t==null?void 0:t.stopGyroscope)==null||f.call(t,{}),s=!1),k&&((I=t==null?void 0:t.offAccelerometerChange)==null||I.call(t,ve),(E=t==null?void 0:t.stopAccelerometer)==null||E.call(t),k=!1),h.x=0,h.y=0,W=null,w=null}let Ae=c.querySelector(".sensor");return Ae&&v(Ae,"click",l=>{l.stopPropagation(),Z(),Me()}),v(window,"pagehide",Q),v(document,"visibilitychange",()=>{document.hidden&&Q()}),v(window,"message",l=>{var f;l.source!==parent||((f=l.data)==null?void 0:f.type)!=="playable-active"||(B=l.data.active===!0,B||(Q(),d==null||d.suspend().catch(()=>{})))}),{state:h,start:Me,stop:Q,recenter(){W=null}}}function Se(e){let n=390,a=598,o=e.getContext("2d");function t(){let r=e.getBoundingClientRect();n=Math.max(1,r.width),a=Math.max(1,r.height);let s=Math.min(2,window.devicePixelRatio||1);e.width=Math.round(n*s),e.height=Math.round(a*s),o.setTransform(s,0,0,s,0,0)}return t(),v(window,"resize",t),{ctx:o,get W(){return n},get H(){return a}}}function ke(e){let n=0;function a(o){if(ie)return;let t=Math.min(.034,(o-(n||o))/1e3);n=o,document.hidden||e(B?t:0,o/1e3),requestAnimationFrame(a)}requestAnimationFrame(a)}v(window,"pagehide",()=>{ie=!0,oe.splice(0).forEach(e=>e()),d==null||d.close().catch(()=>{})});let se={};function H(e,n){return se[e]??n}async function Be(e=()=>{}){let n,a=new AbortController;try{n=setTimeout(()=>a.abort(),1800);let o=await fetch("./game.config.json",{signal:a.signal});if(!o.ok)throw new Error("Configuration unavailable");let t=await o.json();for(let r of["texts","tweaks","images"])for(let s of Array.isArray(t[r])?t[r]:[])s&&typeof s.id=="string"&&(se[s.id]=r==="images"?s.path:s.value);e(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(n)}}Ce("@font-face{font-family:Bangers;src:url('./assets/Bangers-Regular.woff2')}body{background:#fbf0ce;color:#56341d}.cat-game{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none}canvas{width:100%;height:100%;display:block}.cat-game .guide{color:#69422b;text-shadow:0 1px #fff;font-family:Bangers,Arial,sans-serif;font-size:23px;top:33%}.hud{position:absolute;top:27px;left:30px;right:30px;display:flex;justify-content:space-between;font:28px Bangers,Arial,sans-serif;pointer-events:none}.cat-game .sensor{background:#fff5dfcf;border-color:#c89a6d;color:#69422b;bottom:24px}.result{position:absolute;inset:0;z-index:15;display:grid;place-items:center;background:#57341e36;backdrop-filter:blur(3px)}.result[hidden]{display:none}.card{width:calc(100% - 60px);max-width:330px;text-align:center;background:#fff4d9;border:2px solid #a16a43;border-radius:18px;padding:28px 22px;box-shadow:0 6px 0 #d8b887,0 18px 45px #44281140}.card h1{font:32px Bangers;margin:0 0 12px}.height{font:58px Bangers;color:#b96932}.card p{font-size:14px}.card button{border:2px solid #8d4d29;border-radius:12px;background:#c78b58;color:#fff5de;font:22px Bangers;padding:10px 25px;box-shadow:0 3px 0 #8b4e2c}"),c.innerHTML='<div class="cat-game"><canvas aria-label="Gatto che salta tra mensole di legno"></canvas><div class="hud"><span class="score">0m</span><span class="time">60s</span></div><div class="guide">Inclina per guidare il laser</div><button class="sensor">Attiva inclinazione</button><div class="result" hidden><div class="card"><h1>Che bella scalata!</h1><div class="height">0m</div><p>Proviamo ad arrivare pi\xF9 in alto?</p><button>Riprova</button></div></div></div>';let N=c.querySelector("canvas"),O=Se(N),{ctx:i}=O,G=new Image,M=new Image;G.src="./assets/leaping-tabby.webp",M.src="./assets/idle-tabby-v1.webp";let z=new Image,A=new Image,j=new Map;z.src="./assets/storybook-v2/cozy-wall.webp",A.src="./assets/storybook-v3/honey-shelf-front.webp",A.onload=()=>j.clear();let le=c.querySelector(".score"),$=c.querySelector(".time"),ce=c.querySelector(".result"),D=60,g="ready",L=60,m=0,F=0,x=[],C=195,p=400,P=0,q=0,U=195,T=260,V=400,R=0,S=195,u=null,X=-1,_=new Set;function y(){return O.H*390/O.W}function fe(e){let n=(e.step||0)+1,a=n%3===0,o=e.x+e.w/2,t=a?o>=195?-1:1:o>245?-1:o<145?1:Math.random()<.5?-1:1,r=a?165+Math.random()*60:45+Math.random()*75;return{x:b(o+t*r,65,325)-46,y:e.y-(a?48+Math.random()*14:69+Math.random()*12),w:92,step:n}}function de(){g="ready",X=-1,L=D,m=0,F=0,C=195,U=195,V=y()-163,p=V,P=0,q=0,R=0,S=195,x=[{x:148,y:V+35,w:94,step:0}],u=x[0],c.dataset.grounded="true";for(let e=1;e<60;e++)x.push(fe(x[x.length-1]));T=y()*.45,ce.hidden=!0,le.textContent="0m",$.textContent=D+"s",c.dataset.phase=g,c.querySelector(".guide").classList.remove("gone")}let ue=ze({gyro:!0,onTilt:e=>{S=b(195+e.x*175,30,360),T=b(y()*.35+e.y*y()*.2,95,y()*.65),g==="ready"&&(Math.abs(e.x)>.08||Math.abs(e.y)>.08)&&te()}});function Pe(){return T<p-m-6}function ee(){!u||!Pe()||(u=null,P=-540,q=b((S-C)*2.7,-440,440),R=.18,re(480+Math.random()*70,.065,.07,"sine",620))}function te(){g==="ready"&&(Z(),Ie(),g="playing",c.dataset.phase=g,ee())}function qe(){g="finished",c.dataset.phase=g,ce.hidden=!1,c.querySelector(".height").textContent=Math.floor(F/8)+"m",re(440,.3,.12,"sine",220)}v(c.querySelector(".card button"),"click",de),v(N,"pointerdown",e=>{Z(),ue.start(),N.setPointerCapture(e.pointerId),he(e),te()});function he(e){let n=N.getBoundingClientRect();S=b((e.clientX-n.left)*390/n.width,25,365),T=b((e.clientY-n.top)*390/n.width,70,y()*.8)}v(N,"pointermove",e=>{(e.buttons||e.pointerType==="touch")&&he(e)}),v(window,"keydown",e=>{["ArrowLeft","ArrowRight"].includes(e.key)&&(e.preventDefault(),_.add(e.key),te(),ue.start())}),v(window,"keyup",e=>_.delete(e.key));function Te(e){if(!A.complete||!A.naturalWidth)return null;if(j.has(e))return j.get(e);let n=document.createElement("canvas");n.width=Math.ceil(e*2),n.height=26;let a=n.getContext("2d"),o=A.naturalWidth,t=A.naturalHeight,r=o*52/1024,s=Math.min(n.width*.18,r*n.height/t);return a.drawImage(A,0,0,r,t,0,0,s,n.height),a.drawImage(A,r,0,o-r*2,t,s,0,n.width-s*2,n.height),a.drawImage(A,o-r,0,r,t,n.width-s,0,s,n.height),j.set(e,n),n}function Re(e){let n=e.y-m,a=Te(e.w);i.save(),i.shadowColor="#85593833",i.shadowBlur=5,i.shadowOffsetY=4,a?i.drawImage(a,e.x,n-13*(3/67),e.w,13):(i.fillStyle="#c18b5a",i.beginPath(),i.roundRect(e.x,n,e.w,13,4),i.fill()),i.restore()}function Ee(){let e=y();if(i.fillStyle="#fcf2d5",i.fillRect(0,0,390,e),z.complete&&z.naturalWidth){let n=Math.max(390/z.naturalWidth,e/z.naturalHeight),a=z.naturalWidth*n,o=z.naturalHeight*n;i.drawImage(z,(390-a)/2,(e-o)/2,a,o)}}de();function Ue(e){L=Math.max(0,L-e),_.has("ArrowLeft")&&(S=Math.max(25,S-260*e)),_.has("ArrowRight")&&(S=Math.min(365,S+260*e));let n=b((S-C)*5.5,-420,420);q+=(n-q)*(1-Math.exp(-(u?12:5.5)*e));let a=b(C+q*e,25,365);if((a===25||a===365)&&(q=0),C=a,u&&(C+23<=u.x||C-23>=u.x+u.w?u=null:(p=u.y-35,P=0,ee())),!u){let t=p;if(P+=1120*e,p+=P*e,P>0){for(let r of x)if(t+35<=r.y+2&&p+35>=r.y&&C+23>r.x&&C-23<r.x+r.w){p=r.y-35,P=0,u=r,R=.18,ee();break}}}p-m<y()*.43&&(m=p-y()*.43),F=Math.max(F,V-p);let o=x[x.length-1];o.y>m-250&&x.push(fe(o)),x=x.filter(t=>t.y<m+y()+150),le.textContent=Math.floor(F/8)+"m",$.textContent=Math.ceil(L)+"s",c.dataset.grounded=String(!!u),(p-m>y()+90||L<=0)&&qe()}let pe={x:293.5/570,y:451.5/454},We=((me=(ge=window.matchMedia)==null?void 0:ge.call(window,"(prefers-reduced-motion: reduce)"))==null?void 0:me.matches)||!1;function He(e){if(q>15?X=1:q<-15&&(X=-1),i.save(),u&&M.complete&&M.naturalWidth){let n=g==="playing"&&B&&!We?Math.sin(e*2.5)*.009:0,a=g==="playing"&&R>0?1-.06*(R/.18):1,o=a*(1+n),t=70/M.naturalHeight;i.translate(C,p-m+35),X>0&&i.scale(-1,1),i.scale(1/Math.sqrt(o),o),i.drawImage(M,-M.naturalWidth*pe.x*t,-M.naturalHeight*pe.y*t,M.naturalWidth*t,M.naturalHeight*t)}else{i.translate(C,p-m),X>0&&i.scale(-1,1);let n=R?.86:1+Math.min(.06,Math.abs(P)/8e3);i.scale(1/n,n),G.complete&&G.naturalWidth&&i.drawImage(G,-47,-35,94,70)}i.restore()}ke((e,n)=>{g==="playing"&&Ue(e),R=Math.max(0,R-e),U+=(S-U)*(1-Math.exp(-14*e)),i.save(),i.scale(O.W/390,O.W/390),Ee();for(let a of x)a.y-m>-15&&a.y-m<y()+15&&Re(a);i.fillStyle="#ed315b22",i.beginPath(),i.arc(U,T,17,0,Math.PI*2),i.fill(),i.fillStyle="#ff316144",i.beginPath(),i.arc(U,T,10,0,Math.PI*2),i.fill(),i.fillStyle="#d71e42",i.beginPath(),i.arc(U,T,5,0,Math.PI*2),i.fill(),i.fillStyle="#fff9",i.beginPath(),i.arc(U-1,T-1,1.4,0,Math.PI*2),i.fill(),He(n),i.restore()}),Be(()=>{c.querySelector(".guide").textContent=String(H("GUIDE","Inclina per guidare il laser"));let e=H("CAT","./assets/leaping-tabby.webp");G.getAttribute("src")!==e&&(G.src=e);let n=String(H("CAT_IDLE","./assets/idle-tabby-v1.webp"));M.getAttribute("src")!==n&&(M.src=n);let a=String(H("BACKDROP","./assets/storybook-v2/cozy-wall.webp")),o=String(H("PLATFORM","./assets/storybook-v3/honey-shelf-front.webp"));z.getAttribute("src")!==a&&(z.src=a),A.getAttribute("src")!==o&&(j.clear(),A.src=o),D=b(Number(H("ROUND_SECONDS",60))||60,20,120),g==="ready"&&(L=D,$.textContent=D+"s")})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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

.cat-game .hud{top:30px;font-size:28px}
.cat-game .guide{font-family:Bangers,UIBody,sans-serif;font-size:20px;letter-spacing:.5px;line-height:1.3}
.cat-game .sensor{bottom:50px;min-height:44px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
.cat-game .result{padding:30px 30px 50px;display:grid;overflow:auto}
.cat-game .card{width:100%;max-width:330px;padding:28px 22px}
.card h1{font:400 24px/1.3 Bangers,UIBody,sans-serif}
.height{font:400 48px/1.15 Bangers,UIBody,sans-serif}
.card p{font:400 15px/1.6 UIBody,system-ui,sans-serif}
.card button{font:400 20px/1.3 Bangers,UIBody,sans-serif;min-height:44px}
`,document.head.append(c)})();})();
