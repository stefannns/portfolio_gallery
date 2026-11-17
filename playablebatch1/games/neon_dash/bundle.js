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

(()=>{(()=>{"use strict";let b=document.getElementById("root"),se=document.createElement("style");se.textContent=`
    *{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:#090b1b;color:#e8fdff;font-family:Arial,sans-serif;-webkit-tap-highlight-color:transparent}
    button{font:700 16px Arial,sans-serif;touch-action:manipulation;cursor:pointer}
    .dash{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;user-select:none}
    canvas{display:block;width:100%;height:100%}
    .hud{position:absolute;left:30px;right:30px;top:28px;pointer-events:none}
    .stats{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;letter-spacing:1px;color:#9da7c5}.progress-label{font-size:20px;font-weight:800;color:#75f2ff;letter-spacing:0}
    .track{height:5px;border-radius:5px;background:#292e43;margin-top:8px;overflow:hidden}.fill{height:100%;width:0;background:#75f2ff;box-shadow:0 0 12px #39e1ff;border-radius:5px}
    .levels{position:absolute;top:93px;left:0;right:0;display:flex;justify-content:center;gap:14px}
    .levels button{position:relative;width:40px;height:40px;border:1px solid #394259;color:#bac6db;border-radius:50%;background:#15182b}
    .levels button.selected{background:#75f2ff;color:#071a23;border-color:#75f2ff;box-shadow:0 0 20px #34e9ff35}.levels button:disabled{cursor:default;opacity:.55}
    .lock{display:inline-block;width:10px;height:9px;border-radius:2px;background:#7b879e;position:relative}.lock:before{content:'';position:absolute;left:1px;top:-7px;width:8px;height:9px;border:2px solid #7b879e;border-radius:7px}
    .guide{position:absolute;top:34%;left:30px;right:30px;text-align:center;color:#e5fdff;font-size:20px;font-weight:800;line-height:1.3;text-shadow:0 2px 12px #142b42;pointer-events:none;animation:breathe 1.9s ease-in-out infinite}
    @keyframes breathe{50%{opacity:.65;transform:scale(.97)}}
    .result{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#06081796;backdrop-filter:blur(4px);z-index:5}
    .card{width:calc(100% - 60px);max-width:320px;text-align:center;border:1px solid #485b7b;background:#0e1426ee;border-radius:20px;padding:30px 24px;box-shadow:0 15px 50px #0006}
    .card h1{margin:0 0 18px;font-size:24px;letter-spacing:-.6px}.card p{margin:0 0 25px;color:#8df5ff;font-size:46px;font-weight:800;font-variant-numeric:tabular-nums}
    .card button{border:0;border-radius:30px;padding:13px 28px;background:#75f2ff;color:#08212d;box-shadow:0 5px 22px #2be4ff24}.hidden{display:none}
    @media(max-height:520px){.hud{top:20px}.levels{top:79px}.levels button{height:34px;width:34px}}
  `,document.head.append(se),b.innerHTML='<div class="dash"><canvas aria-label="Neon Dash playfield"></canvas><div class="hud"><div class="stats"><span class="best">BEST 0%</span><span class="progress-label">0%</span></div><div class="track"><div class="fill"></div></div></div><div class="levels" aria-label="Choose level"></div><div class="guide">Tap to jump</div><div class="result hidden"><div class="card"><h1>Try again</h1><p>0%</p><button>Try again</button></div></div></div>';let y=b.querySelector(".dash"),R=b.querySelector("canvas"),e=R.getContext("2d"),ye=b.querySelector(".progress-label"),ve=b.querySelector(".best"),Te=b.querySelector(".fill"),le=b.querySelector(".guide"),re=b.querySelector(".levels"),B=b.querySelector(".result"),T=[{speed:285,length:8600,spacing:1,loopFrom:8,patterns:["single","double","short-pair","platforms","tall","low-ceiling","saw","double","platforms","high-saw","triple","jump-duck","spike-ledge","saw-platform","duck-jump","short-pair","stairs-up","low-ceiling"]},{speed:320,length:10300,spacing:.97,loopFrom:6,patterns:["double","saw-spike","platforms","triple","duck-jump","spike-ledge","saw-ceiling","stairs-up","high-saw","quad","jump-duck","steps-down","high-ledge","saw-platform","duck-jump","tall","spike-ledge","stairs-up"]},{speed:355,length:12e3,spacing:.94,loopFrom:4,patterns:["triple","spike-ledge","saw-ceiling","quad","jump-duck","stairs-up","duck-jump","high-ledge","saw-spike","steps-down","quad","jump-duck","platforms","saw-platform","high-saw","high-ledge","stairs-up","duck-jump"]}],Me={single:{advance:280,objects:[{x:0,w:28,h:40,kind:"spike"}]},double:{advance:300,objects:[{x:0,w:28,h:40,kind:"spike"},{x:29,w:28,h:40,kind:"spike"}]},triple:{advance:330,objects:[{x:0,w:28,h:40,kind:"spike"},{x:29,w:28,h:40,kind:"spike"},{x:58,w:28,h:40,kind:"spike"}]},quad:{advance:360,objects:[{x:0,w:28,h:40,kind:"spike"},{x:29,w:28,h:40,kind:"spike"},{x:58,w:28,h:40,kind:"spike"},{x:87,w:28,h:40,kind:"spike"}]},"short-pair":{advance:280,objects:[{x:0,w:26,h:24,kind:"spike"},{x:68,w:26,h:24,kind:"spike"}]},tall:{advance:300,objects:[{x:0,w:30,h:58,kind:"spike"}]},saw:{advance:315,objects:[{x:0,w:48,r:24,lift:24,kind:"saw"}]},"high-saw":{advance:300,objects:[{x:0,w:48,r:24,lift:78,kind:"saw"}]},platforms:{advance:480,objects:[{x:0,w:90,h:28,kind:"block"},{x:130,w:100,h:52,kind:"block"}]},"stairs-up":{advance:580,objects:[{x:0,w:76,h:24,kind:"block"},{x:112,w:86,h:48,kind:"block"},{x:242,w:96,h:72,kind:"block"}]},"steps-down":{advance:500,objects:[{x:0,w:112,h:60,kind:"block"},{x:160,w:106,h:30,kind:"block"}]},"low-ceiling":{advance:320,objects:[{x:0,w:152,h:76,lift:146,kind:"ceiling"}]},"saw-ceiling":{advance:510,objects:[{x:0,w:48,r:24,lift:24,kind:"saw"},{x:210,w:150,h:76,lift:146,kind:"ceiling"}]},"saw-platform":{advance:440,objects:[{x:0,w:48,r:24,lift:24,kind:"saw"},{x:155,w:112,h:44,kind:"block"}]},"spike-ledge":{advance:430,objects:[{x:0,w:190,h:34,kind:"block"},{x:90,w:26,h:26,kind:"spike",lift:34}]},"high-ledge":{advance:490,objects:[{x:0,w:192,h:52,kind:"block"},{x:86,w:26,h:24,kind:"spike",lift:52}]},"jump-duck":{advance:490,objects:[{x:0,w:28,h:40,kind:"spike"},{x:29,w:28,h:40,kind:"spike"},{x:58,w:28,h:40,kind:"spike"},{x:226,w:138,h:74,lift:140,kind:"ceiling"}]},"duck-jump":{advance:500,objects:[{x:0,w:128,h:78,lift:160,kind:"ceiling"},{x:224,w:28,h:40,kind:"spike"},{x:253,w:28,h:40,kind:"spike"}]},"saw-spike":{advance:390,objects:[{x:0,w:48,r:24,lift:24,kind:"saw"},{x:112,w:28,h:28,kind:"spike"}]}},ce="neon-dash-progress-v1",g={best:T.map(()=>0),unlocked:1};try{let t=JSON.parse(localStorage.getItem(ce)||"null");if(t&&Array.isArray(t.best)){g.best=T.map((n,o)=>Math.max(0,Math.min(100,Number(t.best[o])||0))),g.unlocked=Math.max(1,Math.min(T.length,Math.floor(Number(t.unlocked)||1)));for(let n=0;n<T.length-1;n++)g.best[n]===100&&(g.unlocked=Math.max(g.unlocked,n+2))}}catch{}xe();let m=390,j=598,r=450,v=0,f="ready",I=!0,w=0,A=0,x=0,q=0,S=!0,L=!1,C=0,$=0,N=0,U=[],E=[],X=-1,V=0,K=0,d={x:112,size:29},G=[],W=9e3,Z=285,ee=1,c=null,p=null,F=null,M=0,H=0;function de(){return c||(c=new(window.AudioContext||window.webkitAudioContext)),c.state==="suspended"&&c.resume().catch(()=>{}),c}function fe(t){try{de();let n=c.currentTime,o=c.createOscillator(),i=c.createGain();o.connect(i),i.connect(c.destination);let a=t==="jump"?410:t==="crash"?160:660,s=t==="jump"?590:t==="crash"?48:990,l=t==="crash"?.19:.1;o.type=t==="crash"?"triangle":"sine",o.frequency.setValueAtTime(a,n),o.frequency.exponentialRampToValueAtTime(s,n+l),i.gain.setValueAtTime(1e-4,n),i.gain.exponentialRampToValueAtTime(t==="jump"?.09:.15,n+.008),i.gain.exponentialRampToValueAtTime(1e-4,n+l),o.start(n),o.stop(n+l+.02),o.onended=()=>{o.disconnect(),i.disconnect()}}catch{}}let pe=60/128,Se=pe/4,te=t=>440*Math.pow(2,(t-69)/12);function _(t,n,o,i,a="triangle",s=2200,l=0,u=.006){let h=c.createOscillator(),k=c.createGain(),z=c.createBiquadFilter();h.type=a,h.frequency.setValueAtTime(t,n),l&&h.frequency.exponentialRampToValueAtTime(l,n+o*.8),z.type="lowpass",z.frequency.value=s,z.Q.value=.6,k.gain.setValueAtTime(1e-4,n),k.gain.exponentialRampToValueAtTime(i,n+u),k.gain.exponentialRampToValueAtTime(1e-4,n+o),h.connect(z),z.connect(k),k.connect(p.bus),p.voices.add(h),h.onended=()=>{p.voices.delete(h),h.disconnect(),z.disconnect(),k.disconnect()},h.start(n),h.stop(n+o+.02)}function he(t,n,o,i){let a=c.createBufferSource(),s=c.createGain(),l=c.createBiquadFilter();a.buffer=p.noise,l.type="highpass",l.frequency.value=i,s.gain.setValueAtTime(1e-4,t),s.gain.exponentialRampToValueAtTime(o,t+.002),s.gain.exponentialRampToValueAtTime(1e-4,t+n),a.connect(l),l.connect(s),s.connect(p.bus),p.voices.add(a),a.onended=()=>{p.voices.delete(a),a.disconnect(),l.disconnect(),s.disconnect()},a.start(t),a.stop(t+n+.01)}function ue(){if(!I||document.hidden||f!=="playing"){P();return}for(;M<c.currentTime+.13;){let t=H%16,n=Math.floor(H/16)%4,o=[45,41,48,43][n],i=n===0?[0,3,7,12]:[0,4,7,12];if(t%4===0&&_(145,M,.19,.36,"sine",1200,44),(t===4||t===12)&&(he(M,.12,.12,1300),_(180,M,.085,.075,"triangle",1600,105)),t%2===0&&he(M,t===14?.1:.037,t%4===2?.047:.029,6500),(t%4===0||t===7||t===14)&&_(te(o),M,.2,.13,"sawtooth",650),t%2===0){let a=[0,2,1,3,2,1,2,0][t/2];_(te(o+24+i[a]),M,.18,.09,"sawtooth",2100)}if(t===0)for(let a of i.slice(0,3))_(te(o+12+a),M,pe*3.8,.018,"triangle",1100,0,.06);H++,M+=Se}}function O(){if(!(!I||document.hidden||f!=="playing"||F))try{if(de(),!p){let n=c.createGain();n.gain.value=0,n.connect(c.destination);let o=c.createBuffer(1,Math.ceil(c.sampleRate*.25),c.sampleRate),i=o.getChannelData(0);for(let a=0;a<i.length;a++)i[a]=Math.random()*2-1;p={bus:n,noise:o,voices:new Set}}let t=c.currentTime;p.bus.gain.cancelScheduledValues(t),p.bus.gain.setValueAtTime(0,t),p.bus.gain.linearRampToValueAtTime(.36,t+.16),H=0,M=t+.025,F=setInterval(ue,25),ue(),y.dataset.music="playing"}catch{P()}}function P(){if(F&&(clearInterval(F),F=null),p&&c){let t=c.currentTime;p.bus.gain.cancelScheduledValues(t),p.bus.gain.setValueAtTime(p.bus.gain.value,t),p.bus.gain.linearRampToValueAtTime(0,t+.045);for(let n of p.voices)try{n.stop(t+.05)}catch{}}y.dataset.music="stopped"}function xe(){try{localStorage.setItem(ce,JSON.stringify(g))}catch{}}function ie(){return Math.min(100,Math.floor(w/W*100))}function J(){let t=ie();t!==X&&(ye.textContent=t+"%",Te.style.width=t+"%",X=t),ve.textContent="BEST "+(g.best[v]||0)+"%",y.dataset.progress=String(t),y.dataset.phase=f}function Y(){re.innerHTML=T.map((t,n)=>`<button aria-label="Level ${n+1}${n>=g.unlocked?" locked":""}" ${n>=g.unlocked?"disabled":""} class="${n===v?"selected":""}" data-level="${n}">${n<g.unlocked?n+1:'<span class="lock" aria-hidden="true"></span>'}</button>`).join("")}function je(){let t=T[v];G=[],Z=t.speed,W=t.length;let n=600;for(let o=0;n<W-500;o++){let i=t.loopFrom||0,a=o<t.patterns.length?o:i+(o-i)%(t.patterns.length-i),s=Me[t.patterns[a]];for(let l of s.objects)G.push({...l,x:n+l.x});n+=Math.round(s.advance*t.spacing)}y.dataset.level=String(v+1),y.dataset.levelCount=String(T.length)}function ne(t=!1){w=0,x=0,A=0,q=0,S=!0,L=!1,C=0,U=[],E=[],$=0,X=-1,f=t?"playing":"ready",B.classList.add("hidden"),le.classList.toggle("hidden",t),je(),J(),t?O():P(),ae()}function oe(t,n,o,i=18){for(let a=0;a<i;a++){let s=a/i*Math.PI*2,l=65+Math.random()*180;U.push({x:t,y:n,vx:Math.cos(s)*l,vy:Math.sin(s)*l,color:o,life:.55+Math.random()*.25,size:2+Math.random()*5})}}function ge(){S&&(A=-625,S=!1,C=0,fe("jump"),oe(d.x,r+x,"#64dce8",5))}function me(){!I||f==="crashed"||f==="complete"||(f==="ready"&&(f="playing",le.classList.add("hidden"),J(),O()),C=.13,L=!0,S&&ge())}function Q(){L=!1}function D(t){f==="playing"&&(f=t?"complete":"crashed",L=!1,$=t?.2:.45,P(),g.best[v]=Math.max(g.best[v]||0,t?100:ie()),t&&(g.unlocked=Math.max(g.unlocked,Math.min(T.length,v+2))),xe(),J(),Y(),fe(t?"win":"crash"),t||(V=.2,oe(d.x+d.size/2,r+x-d.size/2,"#75f2ff",28)))}function Ae(){B.classList.remove("hidden"),B.querySelector("h1").textContent=f==="complete"?"Level complete":"Try again",B.querySelector("p").textContent=f==="complete"?"100%":ie()+"%",B.querySelector("button").textContent=f==="complete"&&v<T.length-1?"Next level":"Try again"}function be(){let t=R.getBoundingClientRect(),n=Math.min(devicePixelRatio||1,2);R.width=Math.max(1,Math.round(t.width*n)),R.height=Math.max(1,Math.round(t.height*n)),j=m*(t.height/Math.max(1,t.width)),r=j*.76,e.setTransform(R.width/m,0,0,R.height/j,0,0),ae()}function ze(t){let n=d.x+4,o=d.x+d.size-4,i=r+x-d.size+4,a=r+x-3,s=t.x-w,l=r-(t.lift||0);if(o<=s||n>=s+t.w||a<=l-t.h)return!1;let u=Math.max(s+2,Math.min(s+t.w-2,(n+o)/2)),h=l-t.h*(1-Math.abs((u-(s+t.w/2))/(t.w/2)));return a>h&&i<l}function Be(t){if(f==="playing"){let n=x;w+=Z*t,C=Math.max(0,C-t),A+=2e3*t,x+=A*t,S=!1,x>=0&&(A>0&&n<0&&oe(d.x,r,"#75f2ff",5),x=0,A=0,S=!0,q=Math.round(q/(Math.PI/2))*Math.PI/2);for(let o of G){let i=o.x-w;if(i>m+100||i+o.w<d.x-100)continue;let a=d.x+4,s=d.x+d.size-4,l=x-d.size+4,u=x-3;if(o.kind==="spike")ze(o)&&D(!1);else if(o.kind==="saw"){let h=i+o.r,k=-o.lift,z=Math.max(a,Math.min(s,h)),Ie=Math.max(l,Math.min(u,k));Math.hypot(h-z,k-Ie)<o.r-1&&D(!1)}else o.kind==="ceiling"?s>i+2&&a<i+o.w-2&&u>-o.lift+2&&l<-o.lift+o.h-2&&D(!1):s>i&&a<i+o.w&&(n<=-o.h+2&&x>=-o.h&&A>=0?(x=-o.h,A=0,S=!0,q=Math.round(q/(Math.PI/2))*Math.PI/2):u>-o.h&&l<0&&D(!1))}S&&(L||C>0)&&f==="playing"&&ge(),S||(q+=t*5.5),K+=t,K>.025&&(K=0,E.push({x:d.x+2,y:r+x-d.size/2,life:.25})),w>=W&&D(!0),J()}else(f==="crashed"||f==="complete")&&B.classList.contains("hidden")&&($-=t,$<=0&&Ae());for(let n of U)n.life-=t,n.x+=n.vx*t,n.y+=n.vy*t,n.vy+=350*t;U=U.filter(n=>n.life>0);for(let n of E)n.life-=t,n.x-=Z*t;E=E.filter(n=>n.life>0),V=Math.max(0,V-t)}function we(t,n,o,i,a){e.beginPath(),e.roundRect(t,n,o,i,a)}function ae(){let t=e.createLinearGradient(0,0,0,j);t.addColorStop(0,"#0a1226"),t.addColorStop(1,"#17102a"),e.fillStyle=t,e.fillRect(0,0,m,j),e.save(),V&&e.translate((Math.random()-.5)*V*22,(Math.random()-.5)*V*22);let n=40,o=w*.12%n;e.strokeStyle="#4d8aaf",e.lineWidth=1,e.globalAlpha=.27,e.beginPath();for(let i=-o;i<m;i+=n)e.moveTo(i,0),e.lineTo(i,r);for(let i=0;i<r;i+=n)e.moveTo(0,i),e.lineTo(m,i);e.stroke(),e.strokeStyle="#78b2cf",e.globalAlpha=.1,e.beginPath();for(let i=-(w*.12%(n*4));i<m;i+=n*4)e.moveTo(i,0),e.lineTo(i,r);for(let i=0;i<r;i+=n*4)e.moveTo(0,i),e.lineTo(m,i);e.stroke(),e.globalAlpha=1,e.fillStyle="#0b1525",e.fillRect(0,r,m,j-r),e.strokeStyle="#346b83",e.globalAlpha=.35,e.lineWidth=1,e.beginPath();for(let i=-(w%n);i<m;i+=n)e.moveTo(i,r),e.lineTo(i,j);for(let i=r+32;i<j;i+=32)e.moveTo(0,i),e.lineTo(m,i);e.stroke(),e.globalAlpha=1,e.strokeStyle="#75f2ff",e.lineWidth=2,e.shadowColor="#35d8eb",e.shadowBlur=7,e.beginPath(),e.moveTo(0,r),e.lineTo(m,r),e.stroke(),e.shadowBlur=0;for(let i of G){let a=i.x-w;if(!(a+i.w<-50||a>m+80)){if(e.save(),e.lineWidth=2.5,i.kind==="saw"){e.translate(a+i.r,r-i.lift),e.rotate(w*.018),e.strokeStyle="#ffa766",e.fillStyle="#49253c",e.shadowColor="#f69858",e.shadowBlur=7,e.beginPath();for(let s=0;s<24;s++){let l=s*Math.PI/12,u=s%2?i.r*.72:i.r,h=Math.cos(l)*u,k=Math.sin(l)*u;s?e.lineTo(h,k):e.moveTo(h,k)}e.closePath(),e.fill(),e.stroke(),e.shadowBlur=0,e.beginPath(),e.arc(0,0,7,0,Math.PI*2),e.fillStyle="#111b30",e.fill(),e.stroke()}else if(i.kind==="ceiling"){let s=r-i.lift,l=s+i.h;e.strokeStyle="#ffad79",e.fillStyle="#3d2340",e.shadowColor="#f08b76",e.shadowBlur=6,e.fillRect(a,s,i.w,i.h),e.strokeRect(a,s,i.w,i.h),e.shadowBlur=0,e.strokeStyle="#f6b38b",e.lineWidth=2;for(let u=a+23;u<a+i.w-10;u+=35)e.beginPath(),e.moveTo(u-7,l-20),e.lineTo(u,l-13),e.lineTo(u+7,l-20),e.stroke()}else{if(e.strokeStyle=i.kind==="spike"?"#f478ee":"#6addeb",e.fillStyle=i.kind==="spike"?"#401b4b":"#163644",e.shadowColor=e.strokeStyle,e.shadowBlur=7,e.beginPath(),i.kind==="spike"){let s=r-(i.lift||0);e.moveTo(a,s),e.lineTo(a+i.w/2,s-i.h),e.lineTo(a+i.w,s),e.closePath()}else e.rect(a,r-i.h,i.w,i.h);e.fill(),e.stroke(),e.shadowBlur=0,i.kind==="block"&&(e.strokeStyle="#c2fbff",e.lineWidth=3,e.beginPath(),e.moveTo(a+3,r-i.h),e.lineTo(a+i.w-3,r-i.h),e.stroke())}e.restore()}}if(W-w<m){let i=W-w;e.strokeStyle="#80ffd0",e.setLineDash([7,5]),e.lineWidth=2,e.beginPath(),e.moveTo(i,r-145),e.lineTo(i,r),e.stroke(),e.setLineDash([])}for(let i of E)e.globalAlpha=i.life*1.6,e.fillStyle="#75f2ff",e.fillRect(i.x,i.y,4,4);e.globalAlpha=1,f!=="crashed"&&(e.save(),e.translate(d.x+d.size/2,r+x-d.size/2),e.rotate(q),e.shadowColor="#50f3ff",e.shadowBlur=18,e.fillStyle="#32c6d8",we(-d.size/2,-d.size/2,d.size,d.size,5),e.fill(),e.strokeStyle="#9cffff",e.lineWidth=2,e.stroke(),e.shadowBlur=0,e.strokeStyle="#e5ffff",e.lineWidth=2,we(-8,-8,16,16,2),e.stroke(),e.fillStyle="#b3ffff",e.fillRect(-3,-3,6,6),e.restore());for(let i of U)e.globalAlpha=Math.min(1,i.life*2),e.fillStyle=i.color,e.fillRect(i.x,i.y,i.size,i.size);e.globalAlpha=1,e.restore()}y.addEventListener("pointerdown",t=>{t.target.closest("button,.result,.levels")||(t.preventDefault(),y.setPointerCapture(t.pointerId),me())}),y.addEventListener("pointerup",Q),y.addEventListener("pointercancel",Q),y.addEventListener("lostpointercapture",Q),window.addEventListener("keydown",t=>{(t.code==="Space"||t.code==="ArrowUp")&&(t.preventDefault(),t.repeat||me())}),window.addEventListener("keyup",t=>{(t.code==="Space"||t.code==="ArrowUp")&&Q()}),re.addEventListener("click",t=>{let n=t.target.closest("[data-level]");!n||n.disabled||(v=Number(n.dataset.level),ee=1,Y(),ne())}),B.querySelector("button").addEventListener("click",()=>{f==="complete"&&v<T.length-1?(v++,ee=1,Y()):ee++,ne(!0)}),window.addEventListener("message",t=>{var n;t.source===parent&&((n=t.data)==null?void 0:n.type)==="playable-active"&&(I=!!t.data.active,I?f==="playing"&&c&&O():(L=!1,P()),N=0)}),document.addEventListener("visibilitychange",()=>{N=0,L=!1,document.hidden?P():I&&f==="playing"&&c&&O()}),window.addEventListener("pagehide",P),window.addEventListener("resize",be);function ke(t){let n=N?Math.min((t-N)/1e3,.035):0;if(N=t,I&&!document.hidden){let o=n;for(;o>0;){let i=Math.min(o,.008333333333333333);Be(i),o-=i}ae()}requestAnimationFrame(ke)}Y(),ne(),be(),requestAnimationFrame(ke)})();(()=>{let b=document.createElement("style");b.dataset.batch3Ui="20261116",b.textContent=`
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

@font-face{font-family:UIArcade;src:url('./assets/ui/Audiowide-Regular.woff2') format('woff2');font-display:swap}
html,body,#root,button{font-family:UIArcade,UIBody,sans-serif}
.stats{font-family:UIBody,system-ui,sans-serif;font-size:14px;line-height:1.3;letter-spacing:.5px;align-items:center;color:#bec9dd}
.progress-label{font-family:UIArcade,UIBody,sans-serif;font-size:28px}
.levels{top:105px;left:30px;right:30px;display:flex;justify-content:center;gap:16px}.levels button{width:44px;height:44px;min-height:44px}
.guide{font:400 18px/1.4 UIArcade,UIBody,sans-serif}
.card h1{font:400 24px/1.3 UIArcade,UIBody,sans-serif;letter-spacing:0}
.card p{font-family:UIArcade,UIBody,sans-serif;font-size:44px}
.card button{font:700 16px/1.3 UIBody,system-ui,sans-serif;min-height:48px}
`,document.head.append(b)})();})();
