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

(()=>{(()=>{"use strict";let c=document.getElementById("root"),y=(e,n,o)=>Math.max(n,Math.min(o,e)),P=!0,ne=!1,oe=[];function w(e,n,o,s){e.addEventListener(n,o,s),oe.push(()=>e.removeEventListener(n,o,s))}function we(e){let n=document.createElement("style");n.textContent="*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}"+e,document.head.append(n)}function be(){var e;(e=c.querySelector(".guide"))==null||e.classList.add("gone")}let d;function J(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function ae(e=400,n=.1,o=.15,s="sine",t=0){if(!(!d||!P))try{let a=d.currentTime,r=d.createOscillator(),k=d.createGain();r.type=s,r.frequency.setValueAtTime(e,a),t&&r.frequency.exponentialRampToValueAtTime(Math.max(20,t),a+n),k.gain.setValueAtTime(1e-4,a),k.gain.exponentialRampToValueAtTime(o,a+.008),k.gain.exponentialRampToValueAtTime(1e-4,a+n),r.connect(k),k.connect(d.destination),r.start(a),r.stop(a+n+.02),r.onended=()=>{r.disconnect(),k.disconnect()}}catch{}}function ve({gyro:e=!1,shake:n=!1,onTilt:o=()=>{},onShake:s=()=>{}}={}){let t=window.tt,a=!1,r=!1,k=!1,R=null,x=null,he=0,F=0,ee=-2e3,ue=-2e3,h={x:0,y:0,yaw:0,pitch:0,roll:0,received:!1},pe=(l,f)=>Math.atan2(Math.sin(l-f),Math.cos(l-f));function ge(l){if(!P||!l||l.result===-1)return;let f=Number(l.pitch??l.x)||0,M=Number(l.yaw??l.y)||0,T=Number(l.roll??l.z)||0;R||(R={pitch:f,yaw:M,roll:T}),h.pitch=f,h.yaw=M,h.roll=T,h.x=y(pe(T,R.roll)/.42,-1,1),h.y=y(pe(f,R.pitch)/.42,-1,1),Math.abs(h.x)<.025&&(h.x=0),Math.abs(h.y)<.025&&(h.y=0),h.received=!0,o(h)}function me(l){if(!P||!l)return;let f={x:Number(l.x)||0,y:Number(l.y)||0,z:Number(l.z)||0};x||(x={...f});let M=Math.max(.1,Math.hypot(x.x,x.y,x.z)),T=Math.hypot(f.x-x.x,f.y-x.y,f.z-x.z)/M;for(let te of["x","y","z"])x[te]=x[te]*.82+f[te]*.18;if(he++<5)return;let Y=performance.now();Y-ue<1300||(Y-ee>1400&&(F=0),T>.55&&Y-ee>200&&(ee=Y,F++,F>=2&&(F=0,ue=Y,s())))}function _(l,f=!1){let M=c.querySelector(".sensor");M&&(M.textContent=l,M.hidden=f)}function xe(){if(!(a||!P)){if(a=!0,R=null,x=null,he=0,e&&(t!=null&&t.startGyroscope)&&(t!=null&&t.onGyroscopeChange)&&(r=!0,t.onGyroscopeChange(ge),t.startGyroscope({interval:50,fail:()=>{r=!1,a=!1,_("Enable tilt")}})),n&&(t!=null&&t.startAccelerometer)&&(t!=null&&t.onAccelerometerChange)&&t.startAccelerometer({success:()=>{k=!0,t.onAccelerometerChange(me)},fail:()=>{a=!1,_("Enable motion")}}),e&&!r||!e&&n&&!(t!=null&&t.startAccelerometer)){a=!1,_("Motion unavailable");return}_("Motion on",!0)}}function K(){var l,f,M,T;a=!1,r&&((l=t==null?void 0:t.offGyroscopeChange)==null||l.call(t,ge),(f=t==null?void 0:t.stopGyroscope)==null||f.call(t,{}),r=!1),k&&((M=t==null?void 0:t.offAccelerometerChange)==null||M.call(t,me),(T=t==null?void 0:t.stopAccelerometer)==null||T.call(t),k=!1),h.x=0,h.y=0,R=null,x=null}let ye=c.querySelector(".sensor");return ye&&w(ye,"click",l=>{l.stopPropagation(),J(),xe()}),w(window,"pagehide",K),w(document,"visibilitychange",()=>{document.hidden&&K()}),w(window,"message",l=>{var f;l.source!==parent||((f=l.data)==null?void 0:f.type)!=="playable-active"||(P=l.data.active===!0,P||(K(),d==null||d.suspend().catch(()=>{})))}),{state:h,start:xe,stop:K,recenter(){R=null}}}function Me(e){let n=390,o=598,s=e.getContext("2d");function t(){let a=e.getBoundingClientRect();n=Math.max(1,a.width),o=Math.max(1,a.height);let r=Math.min(2,window.devicePixelRatio||1);e.width=Math.round(n*r),e.height=Math.round(o*r),s.setTransform(r,0,0,r,0,0)}return t(),w(window,"resize",t),{ctx:s,get W(){return n},get H(){return o}}}function Ae(e){let n=0;function o(s){if(ne)return;let t=Math.min(.034,(s-(n||s))/1e3);n=s,document.hidden||e(P?t:0,s/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}w(window,"pagehide",()=>{ne=!0,oe.splice(0).forEach(e=>e()),d==null||d.close().catch(()=>{})});let ie={};function H(e,n){return ie[e]??n}async function Ce(e=()=>{}){let n,o=new AbortController;try{n=setTimeout(()=>o.abort(),1800);let s=await fetch("./game.config.json",{signal:o.signal});if(!s.ok)throw new Error("Configuration unavailable");let t=await s.json();for(let a of["texts","tweaks","images"])for(let r of Array.isArray(t[a])?t[a]:[])r&&typeof r.id=="string"&&(ie[r.id]=a==="images"?r.path:r.value);e(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(n)}}we("@font-face{font-family:Bangers;src:url('./assets/Bangers-Regular.woff2')}body{background:#fbf0ce;color:#56341d}.cat-game{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none}canvas{width:100%;height:100%;display:block}.cat-game .guide{color:#69422b;text-shadow:0 1px #fff;font-family:Bangers,Arial,sans-serif;font-size:23px;top:33%}.hud{position:absolute;top:27px;left:30px;right:30px;display:flex;justify-content:space-between;font:28px Bangers,Arial,sans-serif;pointer-events:none}.cat-game .sensor{background:#fff5dfcf;border-color:#c89a6d;color:#69422b;bottom:24px}.result{position:absolute;inset:0;z-index:15;display:grid;place-items:center;background:#57341e36;backdrop-filter:blur(3px)}.result[hidden]{display:none}.card{width:calc(100% - 60px);max-width:330px;text-align:center;background:#fff4d9;border:2px solid #a16a43;border-radius:18px;padding:28px 22px;box-shadow:0 6px 0 #d8b887,0 18px 45px #44281140}.card h1{font:32px Bangers;margin:0 0 12px}.height{font:58px Bangers;color:#b96932}.card p{font-size:14px}.card button{border:2px solid #8d4d29;border-radius:12px;background:#c78b58;color:#fff5de;font:22px Bangers;padding:10px 25px;box-shadow:0 3px 0 #8b4e2c}"),c.innerHTML='<div class="cat-game"><canvas aria-label="Cat jumping between wooden shelves"></canvas><div class="hud"><span class="score">0m</span><span class="time">60s</span></div><div class="guide">Tilt to guide the laser</div><button class="sensor">Enable tilt</button><div class="result" hidden><div class="card"><h1>A pawsome climb!</h1><div class="height">0m</div><p>Chase a little higher?</p><button>Try again</button></div></div></div>';let L=c.querySelector("canvas"),N=Me(L),{ctx:i}=N,U=new Image;U.src="./assets/leaping-tabby.webp";let A=new Image,b=new Image,O=new Map;A.src="./assets/storybook-v2/cozy-wall.webp",b.src="./assets/storybook-v3/honey-shelf-front.webp",b.onload=()=>O.clear();let se=c.querySelector(".score"),Q=c.querySelector(".time"),re=c.querySelector(".result"),j=60,C="ready",W=60,v=0,X=0,p=[],z=195,g=400,B=0,q=0,E=195,I=260,D=400,G=0,S=195,u=null,V=new Set;function m(){return N.H*390/N.W}function le(e){let n=(e.step||0)+1,o=n%3===0,s=e.x+e.w/2,t=o?s>=195?-1:1:s>245?-1:s<145?1:Math.random()<.5?-1:1,a=o?165+Math.random()*60:45+Math.random()*75;return{x:y(s+t*a,65,325)-46,y:e.y-(o?48+Math.random()*14:69+Math.random()*12),w:92,step:n}}function ce(){C="ready",W=j,v=0,X=0,z=195,E=195,D=m()-163,g=D,B=0,q=0,G=0,S=195,p=[{x:148,y:D+35,w:94,step:0}],u=p[0],c.dataset.grounded="true";for(let e=1;e<60;e++)p.push(le(p[p.length-1]));I=m()*.45,re.hidden=!0,se.textContent="0m",Q.textContent=j+"s",c.dataset.phase=C,c.querySelector(".guide").classList.remove("gone")}let fe=ve({gyro:!0,onTilt:e=>{S=y(195+e.x*175,30,360),I=y(m()*.35+e.y*m()*.2,95,m()*.65),C==="ready"&&(Math.abs(e.x)>.08||Math.abs(e.y)>.08)&&$()}});function ze(){return I<g-v-6}function Z(){!u||!ze()||(u=null,B=-540,q=y((S-z)*2.7,-440,440),G=.18,ae(480+Math.random()*70,.065,.07,"sine",620))}function $(){C==="ready"&&(J(),be(),C="playing",c.dataset.phase=C,Z())}function Se(){C="finished",c.dataset.phase=C,re.hidden=!1,c.querySelector(".height").textContent=Math.floor(X/8)+"m",ae(440,.3,.12,"sine",220)}w(c.querySelector(".card button"),"click",ce),w(L,"pointerdown",e=>{J(),fe.start(),L.setPointerCapture(e.pointerId),de(e),$()});function de(e){let n=L.getBoundingClientRect();S=y((e.clientX-n.left)*390/n.width,25,365),I=y((e.clientY-n.top)*390/n.width,70,m()*.8)}w(L,"pointermove",e=>{(e.buttons||e.pointerType==="touch")&&de(e)}),w(window,"keydown",e=>{["ArrowLeft","ArrowRight"].includes(e.key)&&(e.preventDefault(),V.add(e.key),$(),fe.start())}),w(window,"keyup",e=>V.delete(e.key));function ke(e){if(!b.complete||!b.naturalWidth)return null;if(O.has(e))return O.get(e);let n=document.createElement("canvas");n.width=Math.ceil(e*2),n.height=26;let o=n.getContext("2d"),s=b.naturalWidth,t=b.naturalHeight,a=s*52/1024,r=Math.min(n.width*.18,a*n.height/t);return o.drawImage(b,0,0,a,t,0,0,r,n.height),o.drawImage(b,a,0,s-a*2,t,r,0,n.width-r*2,n.height),o.drawImage(b,s-a,0,a,t,n.width-r,0,r,n.height),O.set(e,n),n}function Be(e){let n=e.y-v,o=ke(e.w);i.save(),i.shadowColor="#85593833",i.shadowBlur=5,i.shadowOffsetY=4,o?i.drawImage(o,e.x,n-13*(3/67),e.w,13):(i.fillStyle="#c18b5a",i.beginPath(),i.roundRect(e.x,n,e.w,13,4),i.fill()),i.restore()}function Ie(){let e=m();if(i.fillStyle="#fcf2d5",i.fillRect(0,0,390,e),A.complete&&A.naturalWidth){let n=Math.max(390/A.naturalWidth,e/A.naturalHeight),o=A.naturalWidth*n,s=A.naturalHeight*n;i.drawImage(A,(390-o)/2,(e-s)/2,o,s)}}ce();function Te(e){W=Math.max(0,W-e),V.has("ArrowLeft")&&(S=Math.max(25,S-260*e)),V.has("ArrowRight")&&(S=Math.min(365,S+260*e));let n=y((S-z)*5.5,-420,420);q+=(n-q)*(1-Math.exp(-(u?12:5.5)*e));let o=y(z+q*e,25,365);if((o===25||o===365)&&(q=0),z=o,u&&(z+23<=u.x||z-23>=u.x+u.w?u=null:(g=u.y-35,B=0,Z())),!u){let t=g;if(B+=1120*e,g+=B*e,B>0){for(let a of p)if(t+35<=a.y+2&&g+35>=a.y&&z+23>a.x&&z-23<a.x+a.w){g=a.y-35,B=0,u=a,G=.18,Z();break}}}g-v<m()*.43&&(v=g-m()*.43),X=Math.max(X,D-g);let s=p[p.length-1];s.y>v-250&&p.push(le(s)),p=p.filter(t=>t.y<v+m()+150),se.textContent=Math.floor(X/8)+"m",Q.textContent=Math.ceil(W)+"s",c.dataset.grounded=String(!!u),(g-v>m()+90||W<=0)&&Se()}Ae((e,n)=>{C==="playing"&&Te(e),G=Math.max(0,G-e),E+=(S-E)*(1-Math.exp(-14*e)),i.save(),i.scale(N.W/390,N.W/390),Ie();for(let s of p)s.y-v>-15&&s.y-v<m()+15&&Be(s);i.fillStyle="#ed315b22",i.beginPath(),i.arc(E,I,17,0,Math.PI*2),i.fill(),i.fillStyle="#ff316144",i.beginPath(),i.arc(E,I,10,0,Math.PI*2),i.fill(),i.fillStyle="#d71e42",i.beginPath(),i.arc(E,I,5,0,Math.PI*2),i.fill(),i.fillStyle="#fff9",i.beginPath(),i.arc(E-1,I-1,1.4,0,Math.PI*2),i.fill(),i.save(),i.translate(z,g-v),q>15&&i.scale(-1,1);let o=G?.86:1+Math.min(.06,Math.abs(B)/8e3);i.scale(1/o,o),U.complete&&U.naturalWidth&&i.drawImage(U,-47,-35,94,70),i.restore(),i.restore()}),Ce(()=>{c.querySelector(".guide").textContent=String(H("GUIDE","Tilt to guide the laser"));let e=H("CAT","./assets/leaping-tabby.webp");U.getAttribute("src")!==e&&(U.src=e);let n=String(H("BACKDROP","./assets/storybook-v2/cozy-wall.webp")),o=String(H("PLATFORM","./assets/storybook-v3/honey-shelf-front.webp"));A.getAttribute("src")!==n&&(A.src=n),b.getAttribute("src")!==o&&(O.clear(),b.src=o),j=y(Number(H("ROUND_SECONDS",60))||60,20,120),C==="ready"&&(W=j,Q.textContent=j+"s")})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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
