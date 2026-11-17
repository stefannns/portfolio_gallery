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

(()=>{(()=>{"use strict";let p=document.getElementById("root"),E=(n,i,a)=>Math.max(i,Math.min(a,n)),k=!0,V=!1,j=[];function g(n,i,a,o){n.addEventListener(i,a,o),j.push(()=>n.removeEventListener(i,a,o))}function Z(n){let i=document.createElement("style");i.textContent="*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}"+n,document.head.append(i)}function D(){var n;(n=p.querySelector(".guide"))==null||n.classList.add("gone")}let u;function B(){try{u||(u=new(window.AudioContext||window.webkitAudioContext)),u.state==="suspended"&&u.resume().catch(()=>{})}catch{}}function $(n=400,i=.1,a=.15,o="sine",t=0){if(!(!u||!k))try{let s=u.currentTime,r=u.createOscillator(),f=u.createGain();r.type=o,r.frequency.setValueAtTime(n,s),t&&r.frequency.exponentialRampToValueAtTime(Math.max(20,t),s+i),f.gain.setValueAtTime(1e-4,s),f.gain.exponentialRampToValueAtTime(a,s+.008),f.gain.exponentialRampToValueAtTime(1e-4,s+i),r.connect(f),f.connect(u.destination),r.start(s),r.stop(s+i+.02),r.onended=()=>{r.disconnect(),f.disconnect()}}catch{}}function ee({gyro:n=!1,shake:i=!1,onTilt:a=()=>{},onShake:o=()=>{}}={}){let t=window.tt,s=!1,r=!1,f=!1,y=null,d=null,h=0,m=0,z=-2e3,X=-2e3,x={x:0,y:0,yaw:0,pitch:0,roll:0,received:!1},_=(l,c)=>Math.atan2(Math.sin(l-c),Math.cos(l-c));function F(l){if(!k||!l||l.result===-1)return;let c=Number(l.pitch??l.x)||0,w=Number(l.yaw??l.y)||0,S=Number(l.roll??l.z)||0;y||(y={pitch:c,yaw:w,roll:S}),x.pitch=c,x.yaw=w,x.roll=S,x.x=E(_(S,y.roll)/.42,-1,1),x.y=E(_(c,y.pitch)/.42,-1,1),Math.abs(x.x)<.025&&(x.x=0),Math.abs(x.y)<.025&&(x.y=0),x.received=!0,a(x)}function J(l){if(!k||!l)return;let c={x:Number(l.x)||0,y:Number(l.y)||0,z:Number(l.z)||0};d||(d={...c});let w=Math.max(.1,Math.hypot(d.x,d.y,d.z)),S=Math.hypot(c.x-d.x,c.y-d.y,c.z-d.z)/w;for(let O of["x","y","z"])d[O]=d[O]*.82+c[O]*.18;if(h++<5)return;let R=performance.now();R-X<1300||(R-z>1400&&(m=0),S>.55&&R-z>200&&(z=R,m++,m>=2&&(m=0,X=R,o())))}function U(l,c=!1){let w=p.querySelector(".sensor");w&&(w.textContent=l,w.hidden=c)}function K(){if(!(s||!k)){if(s=!0,y=null,d=null,h=0,n&&(t!=null&&t.startGyroscope)&&(t!=null&&t.onGyroscopeChange)&&(r=!0,t.onGyroscopeChange(F),t.startGyroscope({interval:50,fail:()=>{r=!1,s=!1,U("Enable tilt")}})),i&&(t!=null&&t.startAccelerometer)&&(t!=null&&t.onAccelerometerChange)&&t.startAccelerometer({success:()=>{f=!0,t.onAccelerometerChange(J)},fail:()=>{s=!1,U("Enable motion")}}),n&&!r||!n&&i&&!(t!=null&&t.startAccelerometer)){s=!1,U("Motion unavailable");return}U("Motion on",!0)}}function q(){var l,c,w,S;s=!1,r&&((l=t==null?void 0:t.offGyroscopeChange)==null||l.call(t,F),(c=t==null?void 0:t.stopGyroscope)==null||c.call(t,{}),r=!1),f&&((w=t==null?void 0:t.offAccelerometerChange)==null||w.call(t,J),(S=t==null?void 0:t.stopAccelerometer)==null||S.call(t),f=!1),x.x=0,x.y=0,y=null,d=null}let Q=p.querySelector(".sensor");return Q&&g(Q,"click",l=>{l.stopPropagation(),B(),K()}),g(window,"pagehide",q),g(document,"visibilitychange",()=>{document.hidden&&q()}),g(window,"message",l=>{var c;l.source!==parent||((c=l.data)==null?void 0:c.type)!=="playable-active"||(k=l.data.active===!0,k||(q(),u==null||u.suspend().catch(()=>{})))}),{state:x,start:K,stop:q,recenter(){y=null}}}function te(n){let i=390,a=598,o=n.getContext("2d");function t(){let s=n.getBoundingClientRect();i=Math.max(1,s.width),a=Math.max(1,s.height);let r=Math.min(2,window.devicePixelRatio||1);n.width=Math.round(i*r),n.height=Math.round(a*r),o.setTransform(r,0,0,r,0,0)}return t(),g(window,"resize",t),{ctx:o,get W(){return i},get H(){return a}}}function oe(n){let i=0;function a(o){if(V)return;let t=Math.min(.034,(o-(i||o))/1e3);i=o,document.hidden||n(k?t:0,o/1e3),requestAnimationFrame(a)}requestAnimationFrame(a)}g(window,"pagehide",()=>{V=!0,j.splice(0).forEach(n=>n()),u==null||u.close().catch(()=>{})});let Y={};function ne(n,i){return Y[n]??i}async function ie(n=()=>{}){let i,a=new AbortController;try{i=setTimeout(()=>a.abort(),1800);let o=await fetch("./game.config.json",{signal:a.signal});if(!o.ok)throw new Error("Configuration unavailable");let t=await o.json();for(let s of["texts","tweaks","images"])for(let r of Array.isArray(t[s])?t[s]:[])r&&typeof r.id=="string"&&(Y[r.id]=s==="images"?r.path:r.value);n(),p.dataset.config="loaded"}catch{p.dataset.config="defaults"}finally{clearTimeout(i)}}Z("body{background:#291416;color:#f6dbd5}.etch{width:100%;height:100%;position:relative;touch-action:none;overflow:hidden}canvas{width:100%;height:100%;display:block}.etch .guide{top:32%;white-space:pre-line;color:#790d25;text-shadow:0 1px #fff8}.etch .sensor{bottom:18px;background:#59131b;font-family:monospace;font-size:12px}.erase{position:absolute;bottom:19px;right:30px;width:38px;height:38px;border:1px solid #a95058;border-radius:50%;background:#721426;color:#fbd9c9;font-size:23px}.etch .sensor{left:30px;transform:none}"),p.innerHTML=`<div class="etch"><canvas aria-label="Etch A Sketch drawing surface"></canvas><div class="guide">Tilt to draw
Shake to erase</div><button class="sensor">Enable tilt</button><button class="erase" aria-label="Erase drawing">\u21BA</button></div>`;let C=p.querySelector("canvas"),T=te(C),{ctx:e}=T,v=[],b={x:.5,y:.5},I=!1,M=0,W=0,G=ee({gyro:!0,shake:!0,onShake:L});function L(){k&&(v=[],M=1,D(),$(120,.18,.12,"triangle",60),p.dataset.strokes="0")}g(p.querySelector(".erase"),"click",()=>{B(),L()});let A=new Set;g(window,"keydown",n=>{["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(n.key)&&(n.preventDefault(),A.add(n.key),G.start(),B()),n.key==="Backspace"&&L()}),g(window,"keyup",n=>A.delete(n.key));function H(){return{x:30,y:90,w:T.W-60,h:T.H-202}}function N(n,i){b.x=E(n,0,1),b.y=E(i,0,1),v.push([b.x,b.y]),v.length>16e3&&v.splice(0,4e3),p.dataset.strokes=String(v.length),D()}g(C,"pointerdown",n=>{B(),G.start(),C.setPointerCapture(n.pointerId);let i=C.getBoundingClientRect(),a=H(),o=n.clientX-i.left,t=n.clientY-i.top;o>a.x&&o<a.x+a.w&&t>a.y&&t<a.y+a.h&&(I=!0,v.push(null),N((o-a.x)/a.w,(t-a.y)/a.h))}),g(C,"pointermove",n=>{if(!I)return;let i=C.getBoundingClientRect(),a=H();N((n.clientX-i.left-a.x)/a.w,(n.clientY-i.top-a.y)/a.h)});for(let n of["pointerup","pointercancel","lostpointercapture"])g(C,n,()=>I=!1);function P(n,i,a,o,t,s,r){e.beginPath(),e.roundRect(n,i,a,o,t),e.fillStyle=s,e.fill(),r&&(e.strokeStyle=r,e.stroke())}oe(n=>{let i=T.W,a=T.H,o=H(),t=G.state.x+(A.has("ArrowRight")?1:0)-(A.has("ArrowLeft")?1:0),s=G.state.y+(A.has("ArrowDown")?1:0)-(A.has("ArrowUp")?1:0);!I&&Math.abs(t)+Math.abs(s)>.06&&(v.length||v.push([b.x,b.y]),N(b.x+t*n*.42,b.y+s*n*.32),W+=n*t*3),e.clearRect(0,0,i,a);let r=e.createRadialGradient(i*.45,a*.35,20,i*.5,a*.5,a*.7);r.addColorStop(0,"#4e2225"),r.addColorStop(1,"#190f11"),e.fillStyle=r,e.fillRect(0,0,i,a),e.shadowColor="#0009",e.shadowBlur=18,e.shadowOffsetY=8,P(12,27,i-24,a-41,23,"#6f0f21","#a23843"),e.shadowBlur=0,e.shadowOffsetY=0;let f=e.createLinearGradient(0,30,i,a);f.addColorStop(0,"#ee3450"),f.addColorStop(.2,"#c81735"),f.addColorStop(.75,"#9e0c29"),f.addColorStop(1,"#720e23"),e.lineWidth=2,P(20,33,i-40,a-55,18,f,"#ee62715c"),P(o.x-6,o.y-6,o.w+12,o.h+12,10,"#7b1126","#ef65704d");let y=e.createLinearGradient(o.x,0,o.x+o.w,0);y.addColorStop(0,"#cdcec1"),y.addColorStop(.5,"#d7d9cb"),y.addColorStop(1,"#c8cbbf"),P(o.x,o.y,o.w,o.h,7,y,"#9aab9b"),e.save(),e.beginPath(),e.roundRect(o.x,o.y,o.w,o.h,7),e.clip(),e.strokeStyle="#63705b08",e.lineWidth=3;for(let h=12;h<o.w;h+=23)e.beginPath(),e.moveTo(o.x+h,o.y),e.lineTo(o.x+h,o.y+o.h),e.stroke();e.strokeStyle="#850e2d",e.lineWidth=2.1,e.lineCap="round",e.lineJoin="round",e.beginPath();let d=!0;for(let h of v){if(!h){d=!0;continue}let m=o.x+h[0]*o.w,z=o.y+h[1]*o.h;d?(e.moveTo(m,z),d=!1):e.lineTo(m,z)}e.stroke(),e.beginPath(),e.arc(o.x+b.x*o.w,o.y+b.y*o.h,7,0,Math.PI*2),e.lineWidth=1.6,e.stroke(),e.restore(),e.fillStyle="#f8e0cc",e.textAlign="center",e.font="700 11px monospace",e.letterSpacing="3px",e.fillText("ETCH",i/2,56),e.font="700 8px monospace",e.fillText("A SKETCH",i/2,68),e.letterSpacing="0px";for(let h of[52,i-52]){e.save(),e.translate(h,59),e.rotate(h===52?W:-W);let m=e.createRadialGradient(-5,-7,1,0,0,18);m.addColorStop(0,"#c93c4b"),m.addColorStop(.65,"#a4122a"),m.addColorStop(1,"#680c1c"),e.fillStyle=m,e.beginPath(),e.arc(0,0,16,0,Math.PI*2),e.fill(),e.strokeStyle="#f16c6c66",e.lineWidth=2,e.stroke(),e.strokeStyle="#550d20",e.lineWidth=3,e.beginPath(),e.moveTo(-5,-5),e.lineTo(5,5),e.moveTo(-5,5),e.lineTo(5,-5),e.stroke(),e.restore()}M>0&&(e.globalAlpha=M*.6,P(o.x,o.y,o.w,o.h,7,"#e6e9d9"),e.globalAlpha=1,M=Math.max(0,M-n*2.5))}),ie(()=>{p.querySelector(".guide").textContent=String(ne("GUIDE",`Tilt to draw
Shake to erase`))})})();(()=>{let p=document.createElement("style");p.dataset.batch3Ui="20261116",p.textContent=`
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

@font-face{font-family:UIPixel;src:url('./assets/ui/Silkscreen-Regular.ttf') format('truetype');font-display:swap}
.etch .sensor{bottom:50px;font-family:UIPixel,monospace;font-size:14px;min-height:44px;padding:10px 16px}
.erase{bottom:50px;right:30px;width:44px;height:44px;min-height:44px;font-size:24px}
.etch .guide{font-family:UIPixel,monospace;font-size:18px;line-height:1.5;top:32%;font-weight:400}
`,document.head.append(p)})();})();
