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

(()=>{(()=>{"use strict";let l=document.getElementById("root"),dt=(t,e,i)=>Math.max(e,Math.min(i,t)),W=(t,e)=>t+Math.random()*(e-t),Lt=t=>t[Math.floor(Math.random()*t.length)],Ut=t=>t[t.length-1],jt=t=>{for(let e=t.length-1;e>0;e--){let i=Math.floor(Math.random()*(e+1));[t[e],t[i]]=[t[i],t[e]]}return t},et=[],U=[],A=!0,T=!1,p;function g(t,e,i,a){t.addEventListener(e,i,a),et.push(()=>t.removeEventListener(e,i,a))}function ut(t,e,i="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(a),l.style.background=i,l.innerHTML='<div class="fit">'+e+"</div>";let n=l.querySelector(".fit");function o(){let s=l.getBoundingClientRect(),r=Math.min(s.width/390,s.height/598);n.style.transform=`translate(${(s.width-390*r)/2}px,${(s.height-598*r)/2}px) scale(${r})`,l.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}o(),g(window,"resize",o)}function u(t){return l.querySelector(t)}function ft(){var t;(t=u(".guide"))==null||t.classList.add("gone")}function j(t){l.dataset.phase=t}function F(){H(),ft()}function H(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function _(t=450,e=.08,i=.18,a="sine",n=0){if(!(!p||!A))try{let o=p.createOscillator(),s=p.createGain(),r=p.currentTime;o.type=a,o.frequency.setValueAtTime(t,r),n&&o.frequency.exponentialRampToValueAtTime(Math.max(30,n),r+e),s.gain.setValueAtTime(.001,r),s.gain.exponentialRampToValueAtTime(i,r+.006),s.gain.exponentialRampToValueAtTime(.001,r+e),o.connect(s),s.connect(p.destination),o.start(r),o.stop(r+e+.02),o.onended=()=>{o.disconnect(),s.disconnect()}}catch{}}function $t(){_(523,.12,.18),setTimeout(()=>_(784,.17,.16),100)}function pt(){_(180,.22,.18,"triangle",65)}function ht(t){let e=0;function i(a){if(T)return;let n=Math.min(.035,(a-(e||a))/1e3);e=a,document.hidden||t(A?n:0,a/1e3),requestAnimationFrame(i)}requestAnimationFrame(i)}function Dt(){let t=u("canvas.stage"),e=t.getContext("2d"),i=Math.min(2,window.devicePixelRatio||1);return t.width=390*i,t.height=598*i,e.scale(i,i),{canvas:t,ctx:e}}function Ot(t,e=u("canvas.stage")){let i=e.getBoundingClientRect();return{x:(t.clientX-i.left)*390/i.width,y:(t.clientY-i.top)*598/i.height}}function gt(t,e,i,a,n,o){o=Math.min(Math.abs(a)/2,Math.abs(n)/2,o),t.moveTo(e+o,i),t.lineTo(e+a-o,i),t.quadraticCurveTo(e+a,i,e+a,i+o),t.lineTo(e+a,i+n-o),t.quadraticCurveTo(e+a,i+n,e+a-o,i+n),t.lineTo(e+o,i+n),t.quadraticCurveTo(e,i+n,e,i+n-o),t.lineTo(e,i+o),t.quadraticCurveTo(e,i,e+o,i),t.closePath()}function P(t,e,i,a,n,o,s,r){t.beginPath(),gt(t,e,i,a,n,o),s&&(t.fillStyle=s,t.fill()),r&&(t.strokeStyle=r,t.stroke())}function Vt(t,e,i,a,n,o){t.beginPath(),t.arc(e,i,Math.max(.01,a),0,Math.PI*2),n&&(t.fillStyle=n,t.fill()),o&&(t.strokeStyle=o,t.stroke())}function mt(t,e,i,a,n,o,s=2){t.beginPath(),t.moveTo(e,i),t.lineTo(a,n),t.strokeStyle=o,t.lineWidth=s,t.stroke()}function bt(t,e,i,a,n=18,o="#25252a",s="UIBody",r="center"){t.font=`700 ${n}px ${s}`,t.fillStyle=o,t.textAlign=r,t.textBaseline="middle",t.fillText(e,i,a)}let nt=[];function N(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(at(e,t))}function K(t){let e=new Image;return e.onerror=()=>{l.dataset.assetIssue="image"},e.src=N(t),nt.push({im:e,path:t}),e}function yt(t,e,i,a,n,o){if(!e||!e.width)return;let s=e.videoWidth||e.width,r=e.videoHeight||e.height;if(!s||!r)return;let h=Math.max(n/s,o/r);t.save(),t.beginPath(),t.rect(i,a,n,o),t.clip(),t.drawImage(e,i+(n-s*h)/2,a+(o-r*h)/2,s*h,r*h),t.restore()}function Ft(t,e,i,a,n){t.save(),t.beginPath(),t.arc(i,a,n,0,Math.PI*2),t.clip(),yt(t,e,i-n,a-n,n*2,n*2),t.restore()}function vt(t,e,i,a){let n=u(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=t,n.querySelector(".value").textContent=e,n.querySelector("p").textContent=i;let o=n.querySelector("button");o.onclick=()=>{n.hidden=!0,F(),a()},j("result")}function xt(t="Play again"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function Gt(){let t=u(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let X=[];function it(t){A=t,t||p==null||p.suspend().catch(()=>{});for(let e of X)e(t)}g(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&it(t.data.active===!0)}),g(document,"visibilitychange",()=>{it(!document.hidden)}),g(window,"pagehide",()=>{T=!0,et.splice(0).forEach(t=>t()),U.splice(0).forEach(t=>t()),p==null||p.close().catch(()=>{})});let ot={};function at(t,e){return ot[t]??e}async function wt(t=()=>{}){let e=new AbortController,i=setTimeout(()=>e.abort(),1600);try{let a=await fetch("./game.config.json",{signal:e.signal});if(!a.ok)throw Error("Config unavailable");let n=await a.json();for(let o of["texts","tweaks","images"])for(let s of n[o]||[])ot[s.id]=o==="images"?s.path:s.value;for(let o of nt){let s=N(o.path);o.im.getAttribute("src")!==s&&(o.im.src=s)}for(let o of l.querySelectorAll('img[src^="./assets/"]'))o.src=N(o.getAttribute("src"));t(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(i)}}let c=null,f=null,w=null,$=null,D=!1,E=!1,y="",st=()=>{};function k(){c==null||c.getTracks().forEach(t=>t.stop()),c=null,f==null||f.close().catch(()=>{}),f=w=$=null,D=!1}async function rt(){var t;if(!D){D=!0;try{if(!((t=navigator.mediaDevices)!=null&&t.getUserMedia))throw Error("No microphone");if(c=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!1}}),T||!A||y==="hold"){k();return}f=new(window.AudioContext||window.webkitAudioContext),await f.resume();let e=f.createMediaStreamSource(c);w=f.createAnalyser(),w.fftSize=1024,e.connect(w),$=new Float32Array(w.fftSize),u(".mic-enable").textContent="Mic on",u(".mic-status").textContent="Listening \xB7 Space or hold also works",l.dataset.microphone="enabled"}catch{D=!1,u(".mic-enable").textContent="Enable microphone",u(".mic-status").textContent="Mic unavailable \xB7 hold the button to play",l.dataset.microphone="unavailable"}}}function Ct(){if(E)return .9;if(!w||!A)return 0;w.getFloatTimeDomainData($);let t=0;for(let e of $)t+=e*e;return dt((Math.sqrt(t/$.length)-.012)*14,0,1)}function Mt(){g(u(".mic-enable"),"click",()=>{H(),rt()});let t=u(".voice-hold");g(t,"pointerdown",e=>{e.preventDefault(),F(),Y("hold"),E=!0,t.setPointerCapture(e.pointerId)});for(let e of["pointerup","pointercancel","lostpointercapture"])g(t,e,()=>E=!1);g(window,"keydown",e=>{e.code==="Space"&&!e.repeat&&(e.preventDefault(),F(),Y("hold"),E=!0)}),g(window,"keyup",e=>{e.code==="Space"&&(E=!1)}),X.push(e=>{if(e){if(f==null||f.resume().catch(()=>{}),c)for(let i of c.getTracks())i.enabled=!0}else if(E=!1,f==null||f.suspend().catch(()=>{}),c)for(let i of c.getTracks())i.enabled=!1}),U.push(k),St()}function kt(t="Hold to try"){return`<div class="status mic-status" hidden></div><div class="bottom"><button class="capability mic-enable">Enable microphone</button><button class="capability voice-hold">${t}</button></div>`}function Y(t){y=t,t==="hold"&&(c||D)&&k(),st()}function St(){let t=u(".mic-enable"),e=u(".voice-hold"),i=t.parentElement,a=u(".mic-status"),n=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it"),o=document.createElement("style");o.textContent="#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}",document.head.append(o);function s(){T||(t.hidden=y==="hold",e.hidden=y==="voice",i.classList.toggle("voice-mode-selected",!!y),l.dataset.voiceControl=y||"choice",y==="hold"&&(a.textContent="",a.hidden=!0))}st=s,g(t,"click",()=>Y("voice"),{capture:!0});let r=new MutationObserver(()=>{let h=l.dataset.microphone;y==="voice"&&["unavailable","error","off"].includes(h)&&(y=""),y==="hold"&&c&&k(),s()});r.observe(l,{attributes:!0,attributeFilter:["data-microphone"]}),U.push(()=>r.disconnect()),s()}function zt(){let t=u(".mic-enable"),e=u(".mic-status"),n=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it")?{idle:"Attiva microfono",requesting:"Connessione\u2026",active:"Microfono attivo",paused:"Microfono in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Non disponibile \xB7 usa il pulsante"}:{idle:"Start microphone",requesting:"Connecting\u2026",active:"Mic on",paused:"Mic paused",start:"Start microphone",stop:"Stop microphone",listening:"",fallback:"",unavailable:"Mic unavailable \xB7 hold the button to play"},o=document.createElement("style");o.textContent=".bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}",document.head.append(o);let s=!1,r=!1,h="",v=null,z=null;function G(){var L;let b=((L=c==null?void 0:c.getAudioTracks)==null?void 0:L.call(c))||[];return A&&!!w&&(f==null?void 0:f.state)==="running"&&b.some(M=>M.readyState==="live"&&M.enabled&&!M.muted)}function x(){var ct;if(T)return;let b=G(),L=!!((ct=c==null?void 0:c.getAudioTracks)!=null&&ct.call(c).some(tt=>tt.readyState==="live")),M=s?"requesting":b?"active":L?"paused":r?"unavailable":"idle";if(t.disabled=s,t.setAttribute("aria-pressed",String(b)),t.classList.toggle("is-listening",b),t.setAttribute("aria-label",L?n.stop:n.start),t.dataset.micState=M,l.dataset.microphone=b?"enabled":M==="idle"?"off":M,M!==h){let tt=b?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>',Rt=s?n.requesting:b?n.active:L?n.paused:n.idle;t.innerHTML=tt+'<span class="mic-button-label">'+Rt+"</span>",e.textContent=b?n.listening:r?n.unavailable:n.fallback,h=M}}function Q(){if(c&&v!==c){v=c;for(let b of c.getAudioTracks())g(b,"ended",()=>{k(),r=!1,x()}),g(b,"mute",x),g(b,"unmute",x)}f&&z!==f&&(z=f,g(f,"statechange",x))}g(t,"click",async b=>{if(b.preventDefault(),b.stopImmediatePropagation(),!(s||T)){if(c){k(),r=!1,x();return}if(H(),r=!1,s=!0,x(),await rt(),s=!1,T||!A){k(),x();return}(!c||!f||!w)&&(k(),r=!0),Q(),h="",x()}},{capture:!0}),X.push(()=>{Promise.resolve().then(()=>{Q(),x()})}),Q(),x()}function At(){let t=u("canvas.stage"),e=t.getContext("2d"),i=u(".fit"),a={left:0,top:0,right:390,bottom:598};l.style.position="relative",l.style.isolation="isolate",l.prepend(t),i.style.background="transparent",i.style.zIndex="1",Object.assign(t.style,{position:"absolute",inset:"0",width:"100%",height:"100%",zIndex:"0",pointerEvents:"none"});function n(){let o=l.getBoundingClientRect();if(!o.width||!o.height)return;let s=Math.min(2,window.devicePixelRatio||1),r=Math.min(o.width/390,o.height/598),h=(o.width-390*r)/2,v=(o.height-598*r)/2,z=Math.round(o.width*s),G=Math.round(o.height*s);(t.width!==z||t.height!==G)&&(t.width=z,t.height=G),e.setTransform(s*r,0,0,s*r,s*h,s*v),Object.assign(a,{left:-h/r,top:-v/r,right:(o.width-h)/r,bottom:(o.height-v)/r}),i.style.transform=`translate(${h}px,${v}px) scale(${r})`}if(n(),g(window,"resize",n),typeof ResizeObserver<"u"){let o=new ResizeObserver(n);o.observe(l),U.push(()=>o.disconnect())}return{canvas:t,ctx:e,bounds:a}}function Tt(t){let e=u(t==="camera"?".cam-status":".mic-status");if(!e)return;let i=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it");e.setAttribute("role","status"),e.setAttribute("aria-live","polite");function a(){var v;let r="";if(t==="camera")["requesting","unavailable"].includes(l.dataset.camera)&&(r=e.textContent);else{let z=((v=u(".mic-enable"))==null?void 0:v.dataset.micState)||l.dataset.microphone;z==="requesting"?r=i?"Consenti l\u2019accesso al microfono":"Allow microphone access":["unavailable","error"].includes(z)&&(r=i?"Microfono non disponibile":"Microphone unavailable")}e.textContent!==r&&(e.textContent=r);let h=!r.trim();e.hidden!==h&&(e.hidden=h)}let n=new MutationObserver(a);n.observe(e,{childList:!0,characterData:!0,subtree:!0});let o=new MutationObserver(a);o.observe(l,{attributes:!0,attributeFilter:[t==="camera"?"data-camera":"data-microphone"]});let s=u(".mic-enable");s&&o.observe(s,{attributes:!0,attributeFilter:["data-mic-state"]}),a(),U.push(()=>{n.disconnect(),o.disconnect()})}ut(".fit{background:#e9e2c8}.guide{top:106px;font:17px Playful,Arial;color:#565c3d}.hud{font-size:17px;color:#5e5a3d;font-family:Playful,Arial}.capability{border-color:#8f733c55;background:#fff6da}.mic-status{color:#72583f}.result{background:#fff3d5}.result h2{font-family:Playful,Arial}.pill{background:#847443}",`<canvas class="stage" aria-label="Karate timing challenge"></canvas><div class="hud center"><span class="round-label">1 board</span></div><div class="guide">Shout at the peak</div>${kt("Hold to shout")}${xt()}`,"#e9e2c8"),Tt("microphone");let{ctx:d,bounds:m}=At(),Pt=K("./assets/karate-ready.webp"),It=K("./assets/karate-chop.webp"),I=K("./assets/dojo-interior-v1.webp");function qt(){if(d.fillStyle="#e9e2c8",d.fillRect(m.left,m.top,m.right-m.left,m.bottom-m.top),!I.width){d.fillStyle="#d0a367",d.fillRect(m.left,435,m.right-m.left,Math.max(0,m.bottom-435));return}let t=I.height*.755,e=Math.max((m.right-m.left)/I.width,(435-m.top)/t,(m.bottom-435)/(I.height-t)),i=I.width*e,a=I.height*e;d.drawImage(I,(m.left+m.right-i)/2,435-t*e,i,a)}let C=1,Z=0,q=0,J=0,B="ready",S=0,O=!0,V=0,R=[];function lt(){C=1,Z=0,q=0,J=0,B="ready",S=0,O=!0,R=[],V=0,u(".round-label").textContent="1 board",j("ready")}function Bt(){if(!p)return;let t=p.createBufferSource(),e=p.createGain(),i=p.createBuffer(1,p.sampleRate*.13,p.sampleRate),a=i.getChannelData(0);for(let n=0;n<a.length;n++)a[n]=(Math.random()*2-1)*Math.exp(-n/a.length*15);t.buffer=i,e.gain.value=.28,t.connect(e),e.connect(p.destination),t.start(),t.onended=()=>{t.disconnect(),e.disconnect()}}function Et(){if(!O||B==="result"||S>0)return;F(),O=!1,V=.43,B="playing";let t=Math.min(.92,.69+C*.025);if(q>=t){Bt(),Z+=C,S=1.05;for(let e=0;e<C*5;e++)R.push({x:275,y:360-C*8,vx:W(-160,160),vy:W(-180,-70),r:W(0,6)});j("hit")}else S=.8,B="failed",pt(),j("miss")}Mt(),zt(),lt(),ht(t=>{let e=Ct();J+=t,q=(Math.sin(J*(2.4+C*.13))+1)/2,e<.1&&(O=!0),e>.3&&O&&Et(),V=Math.max(0,V-t),S>0&&(S-=t,S<=0&&(B==="failed"?(B="result",vt("Try your timing",Z,"Boards broken",lt)):(C++,u(".round-label").textContent=C+" boards",j("playing"))));for(let n of R)n.x+=n.vx*t,n.y+=n.vy*t,n.vy+=600*t,n.r+=t*3;R=R.filter(n=>n.y<560),qt(),P(d,48,160,294,17,8,"#acb98c","#786b43");let i=d.createLinearGradient(48,0,342,0);i.addColorStop(0,"#b7d59d"),i.addColorStop(.8,"#e8ce84"),i.addColorStop(1,"#dd8a54"),P(d,50,162,290*q,13,6,i),d.fillStyle="#5e5534",d.beginPath(),d.moveTo(48+q*294,151),d.lineTo(43+q*294,144),d.lineTo(53+q*294,144),d.fill(),bt(d,"PEAK",329,195,12,"#8b6a38"),P(d,235,375,12,90,2,"#6b4b2f","#44311e"),P(d,321,375,12,90,2,"#6b4b2f","#44311e"),P(d,222,367,124,14,2,"#b27b46","#765533");for(let n=0;n<C&&n<12;n++)S>0&&B!=="failed"||(P(d,223,359-n*7,124,6,1,"#e1b37a","#946637"),mt(d,232,361-n*7,333,361-n*7,"#f6d7a155",1));let a=V>0?It:Pt;a.width&&d.drawImage(a,22,258,218,218);for(let n of R)d.save(),d.translate(n.x,n.y),d.rotate(n.r),P(d,-12,-3,24,6,1,"#d6a56d","#916332"),d.restore()}),wt(()=>{u(".guide")&&(u(".guide").textContent=String(at("GUIDE","Shout at the peak")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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

.fit{font-family:UIBody,system-ui,sans-serif}
.guide{font-family:Playful,UIBody,sans-serif;font-weight:600}
.capability,.pill{font-family:UIBody,system-ui,sans-serif}
.hud{font-family:Playful,UIBody,sans-serif;font-size:28px}.guide{font-size:18px;top:100px}.mic-status{color:#5c402a}`,document.head.append(l)})();})();
