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

(()=>{(()=>{"use strict";var ft,ut;let p=document.getElementById("root"),V=document.createElement("style");V.textContent="*{box-sizing:border-box}html,body,#root{height:100%;width:100%;margin:0;overflow:hidden;background:#09090b;color:white;font-family:system-ui,sans-serif}button{font:700 13px system-ui;color:white;background:#111;border:2px solid #eee;border-radius:30px;padding:8px 11px;touch-action:manipulation}.scene{height:100%;position:relative;overflow:hidden}canvas{position:absolute;width:100%;height:100%;touch-action:none}.guide{position:absolute;top:15%;width:100%;text-align:center;font-weight:800;font-size:19px;pointer-events:none}.top{position:absolute;top:3%;left:4%;right:4%;display:flex;justify-content:space-between;gap:5px}.reset{border-color:#ff5559;color:#ff6a6c}.tools{position:absolute;bottom:4%;left:3%;right:3%;display:flex;justify-content:center;flex-wrap:wrap;gap:5px}.tools button.active{background:#fff;color:#111}.hold-tool{position:relative;display:flex}.drop{position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);z-index:3;min-height:36px;white-space:nowrap}.palette{position:absolute;z-index:5;top:11%;left:5%;width:min(245px,65%);background:#101010;border:2px solid #eee;border-radius:10px;padding:12px;box-shadow:0 4px 20px #0008}.palette-head{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700}.palette .done{font-size:12px;padding:4px 9px}.color-wheel{width:145px;height:145px;max-width:90%;aspect-ratio:1;border-radius:50%;margin:14px auto;touch-action:none;background:radial-gradient(circle,white,transparent 70%),conic-gradient(red,#ff0,lime,cyan,blue,magenta,red);border:2px solid white}.brightness-label{display:flex;justify-content:space-between;font-size:11px;color:#ddd}.brightness{width:100%;accent-color:white;margin:7px 0}.color-preview{height:25px;border:2px solid white;border-radius:5px}.hidden{display:none}",document.head.append(V),p.innerHTML='<div class="scene"><canvas aria-label="Hair styling area"></canvas><div class="guide">Choose a tool to style</div><div class="top"><button class="reset">Reset</button><button class="brush">Brush: S</button><button class="pause">Pause</button></div><div class="palette hidden"></div><div class="tools"></div></div>';let c=p.querySelector("canvas"),i=c.getContext("2d"),tt=p.querySelector(".guide"),B=p.querySelector(".palette");V.textContent+=`#root .top{top:30px;left:30px;right:30px;gap:12px;align-items:center}
#root .top button{min-height:44px;padding:0 4px;border:0;border-radius:0;background:transparent;box-shadow:none;font:700 14px/1.3 UIBody,system-ui,sans-serif;color:#d3d3d9}
#root .top .reset{color:#ff777b}#root .top button:active{opacity:.65}
#root .guide{top:18%;left:30px;right:30px;width:auto;font:700 18px/1.4 UIBody,system-ui,sans-serif}
#root .tools{left:30px;right:30px;bottom:calc(50px + env(safe-area-inset-bottom,0px));display:block;overflow:visible}
#root .tool-scroll{width:100%;padding:4px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;touch-action:pan-x;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;user-select:none;-webkit-user-select:none}
#root .tool-scroll::-webkit-scrollbar{display:none}
#root .tool-row{display:flex;flex-wrap:nowrap;align-items:center;justify-content:flex-start;width:max-content;min-width:100%;gap:8px}
#root .tool-row button{flex:none;min-height:44px;padding:9px 12px;font:700 14px/1.3 UIBody,system-ui,sans-serif;white-space:nowrap;touch-action:pan-x}
#root .hold-tool{flex:none;display:flex}
#root .tool-hint{position:absolute;right:4px;bottom:calc(100% + 9px);display:flex;align-items:center;gap:7px;max-width:170px;color:#d0d0d7;font:400 13px/1.4 UIBody,system-ui,sans-serif;white-space:nowrap;pointer-events:none}
#root .tool-hint svg{width:20px;height:14px;flex:none}
#root .tool-hint[hidden]{display:none!important}
#root .tools>.drop{position:absolute;bottom:calc(100% + 7px);z-index:4;min-height:44px;padding:9px 12px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
`;let gt=[["Hand","Hold","Scissors","Regrow"],["Colors","Wash","Blow"]],d="Hand",J="#fafafa",P=0,I=!1,C=!1,h=null,j=new URLSearchParams(location.search).get("feedReview")!=="1",w=[],W=[],M=[],m=[],q=null;B.innerHTML='<div class="palette-head"><span>Color Picker</span><button class="done">Done</button></div><div class="color-wheel" role="slider" aria-label="Choose hair color" tabindex="0"></div><div class="brightness-label"><span>Dark</span><span>Light</span></div><input class="brightness" aria-label="Color brightness" type="range" min="0" max="100" value="100"><div class="color-preview"></div>';let R=50,et=1,N=1,E=B.querySelector(".color-wheel"),ot=B.querySelector(".brightness"),yt=B.querySelector(".color-preview");function G(){let t=N*et,e=t*(1-Math.abs(R/60%2-1)),o=N-t;J=`rgb(${(R<60?[t,e,0]:R<120?[e,t,0]:R<180?[0,t,e]:R<240?[0,e,t]:R<300?[e,0,t]:[t,0,e]).map(a=>Math.round((a+o)*255)).join(",")})`,yt.style.background=J}function nt(t){let e=E.getBoundingClientRect(),o=(t.clientX-e.left-e.width/2)/(e.width/2),n=(t.clientY-e.top-e.height/2)/(e.height/2);R=(Math.atan2(o,-n)*180/Math.PI+360)%360,et=Math.min(1,Math.hypot(o,n)),G()}E.addEventListener("pointerdown",t=>{E.setPointerCapture(t.pointerId),nt(t)}),E.addEventListener("pointermove",t=>{E.hasPointerCapture(t.pointerId)&&nt(t)}),ot.addEventListener("input",()=>{N=Number(ot.value)/100,G()}),B.querySelector(".done").onclick=()=>B.classList.add("hidden"),G(),p.querySelector(".tools").innerHTML='<div class="tool-scroll" role="toolbar" aria-label="Hair tools"><div class="tool-row">'+gt.flat().map(t=>{let e=`<button data-tool="${t}" class="${t===d?"active":""}">${t}</button>`;return t==="Hold"?`<span class="hold-tool">${e}<button class="drop hidden" data-action="drop">Drop</button></span>`:e}).join("")+"</div></div>";let k=p.querySelector(".drop"),Q=p.querySelector(".tools"),b=p.querySelector(".tool-scroll");b.setAttribute("aria-orientation","horizontal");let f=null,z=!1;function it(t){!f||t.pointerId!==f.id||(Math.hypot(t.clientX-f.x,t.clientY-f.y)>=8||Math.abs(b.scrollLeft-f.left)>2)&&(f.moved=!0)}b.addEventListener("pointerdown",t=>{t.button!==0||t.isPrimary===!1||(z=!1,f={id:t.pointerId,x:t.clientX,y:t.clientY,left:b.scrollLeft,moved:!1})},{passive:!0}),b.addEventListener("pointermove",it,{passive:!0}),window.addEventListener("pointerup",t=>{!f||t.pointerId!==f.id||(it(t),z=f.moved,f=null)},{passive:!0}),window.addEventListener("pointercancel",t=>{f&&t.pointerId===f.id&&(z=!0,f=null)},{passive:!0}),b.addEventListener("scroll",()=>{f&&Math.abs(b.scrollLeft-f.left)>2&&(f.moved=!0)},{passive:!0}),b.addEventListener("click",t=>{z&&t.detail!==0&&(z=!1,t.preventDefault(),t.stopPropagation())},!0),Q.append(k);let T=document.createElement("span"),at=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it");T.className="tool-hint",T.setAttribute("aria-label",at?"Scorri gli strumenti a sinistra o a destra":"Swipe tools left or right"),T.innerHTML="<span>"+(at?"Scorri gli strumenti":"Swipe tools")+'</span><svg viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h20M6 3 2 8l4 5M18 3l4 5-4 5"/></svg>',Q.append(T);function _(){if(T.hidden=b.scrollWidth<=b.clientWidth+1,!T.hidden&&!k.classList.contains("hidden")){let t=T.getBoundingClientRect(),e=k.getBoundingClientRect();t.left<e.right+8&&t.right>e.left-8&&t.top<e.bottom+4&&t.bottom>e.top-4&&(T.hidden=!0)}}requestAnimationFrame(_),(ut=(ft=document.fonts)==null?void 0:ft.ready)==null||ut.then(_);function D(){let t=Q.getBoundingClientRect(),e=p.querySelector('[data-tool="Hold"]').getBoundingClientRect(),o=(k.offsetWidth||64)/2;k.style.left=Math.max(o+4,Math.min(t.width-o-4,e.left+e.width/2-t.left))+"px",_()}b.addEventListener("scroll",D,{passive:!0}),window.addEventListener("resize",D);function X(t,e,o){let n=Math.min(e*.22,o*.16);t.x=.5+t.u*n/e,t.top=.4-Math.sqrt(Math.max(0,1-t.u*t.u))*n/o}function rt(){let t=c.clientWidth||390,e=c.clientHeight||598;M=[],m=[],k.classList.add("hidden"),w=Array.from({length:170},(o,n)=>{let a={u:2*n/169-1,dx:0,dy:0,v:0,vy:0,held:!1,curveSpan:1,dye:[],growRemaining:0,wet:0};return X(a,t,e),a.len=.65-a.top+Math.random()*.015,a})}function mt(){let t=Math.min(devicePixelRatio||1,2),e=c.clientWidth,o=c.clientHeight;return(c.width!==e*t||c.height!==o*t)&&(c.width=e*t,c.height=o*t),i.setTransform(t,0,0,t,0,0),[e,o]}let lt=t=>3*(1-t)*(1-t)*t*.1+3*(1-t)*t*t*.65+t*t*t;function K(t,e){let o=t.curveSpan||1;return lt(e*o)/lt(o)}function H(t,e,o,n){let a=K(t,e);return[(t.x+t.dx*a)*o,(t.top+t.len*e+t.dy*a)*n]}function O(t,e,o,n,a){let r=Math.max(2,Math.ceil((o-e)*48));i.beginPath();for(let s=0;s<=r;s++){let l=H(t,e+(o-e)*s/r,n,a);s?i.lineTo(...l):i.moveTo(...l)}i.stroke()}function bt(t,e){let o=t.dye.find(n=>e>=n.from&&e<=n.to);return o?o.color:"#fafafa"}function vt(t,e,o,n){if(e=Math.max(0,e),o=Math.min(t.len,o),o<=e)return;let a=[];for(let r of t.dye)r.to<=e||r.from>=o?a.push(r):(r.from<e&&a.push({...r,to:e}),r.to>o&&a.push({...r,from:o}));a.push({from:e,to:o,color:n}),a.sort((r,s)=>r.from-s.from),t.dye=[];for(let r of a){let s=t.dye[t.dye.length-1];s&&s.color===r.color&&r.from<=s.to+1e-5?s.to=Math.max(s.to,r.to):t.dye.push(r)}}function wt(t,e){if(!(e<=0)){t.len+=e;for(let o of t.dye)o.from+=e,o.to+=e}}function Mt(t=.14){for(let e of w)e.growRemaining+=t}function A(){let[t,e]=mt();i.clearRect(0,0,t,e),i.strokeStyle="#f8f8f8",i.lineWidth=Math.max(2,t*.006),i.lineCap="round",i.lineJoin="round",i.beginPath(),i.arc(t*.5,e*.4,Math.min(t*.22,e*.16),0,Math.PI*2),i.stroke(),i.beginPath(),i.moveTo(t*.16,e*.71),i.lineTo(t*.5,e*.62),i.lineTo(t*.84,e*.71),i.stroke();for(let o of M){i.save(),i.translate((o.cx+o.x)*t,(o.cy+o.y)*e),i.rotate(o.angle),i.globalAlpha=Math.min(1,Math.max(0,(2.5-o.age)*2)),i.lineWidth=Math.max(2.7,t*.0061);for(let n=1;n<o.points.length;n++){let a=o.points[n-1],r=o.points[n];i.strokeStyle=r.color,i.beginPath(),i.moveTo((a.x-o.cx)*t,(a.y-o.cy)*e),i.lineTo((r.x-o.cx)*t,(r.y-o.cy)*e),i.stroke()}i.restore()}for(let o of w){X(o,t,e),i.lineWidth=Math.max(2.9,t*.0065),i.strokeStyle="#fafafa",O(o,0,1,t,e);for(let n of o.dye)i.strokeStyle=n.color,O(o,n.from/o.len,Math.min(1,n.to/o.len),t,e);o.wet>.01&&(i.save(),i.globalAlpha=o.wet*.32,i.strokeStyle="#70c8f0",O(o,0,1,t,e),i.restore())}for(let o of m)i.save(),i.globalAlpha=Math.max(0,1-o.age/o.life),i.lineWidth=1.4,i.strokeStyle=o.kind==="air"?"#f7ebd4":"#b4eaff",o.kind==="drop"?(i.beginPath(),i.moveTo(o.x*t,o.y*e),i.lineTo((o.x-o.vx*.035)*t,(o.y-o.vy*.035)*e),i.stroke()):o.kind==="bubble"?(i.fillStyle="#dff6ff",i.globalAlpha*=.75,i.beginPath(),i.arc(o.x*t,o.y*e,o.r*t,0,Math.PI*2),i.fill(),i.globalAlpha*=1.2,i.stroke()):(i.beginPath(),i.moveTo(o.x*t,o.y*e),i.quadraticCurveTo((o.x+.025)*t,(o.y+.003)*e,(o.x+.06)*t,(o.y+.015)*e),i.stroke()),i.restore();C&&h&&(d==="Wash"||d==="Blow")&&kt(h,t,e)}function kt(t,e,o){if(i.save(),i.translate(t.x*e,t.y*o),i.lineCap="round",i.lineJoin="round",d==="Wash"){i.translate(23,-52),i.rotate(.35),i.lineWidth=7,i.strokeStyle="#a8b9c6",i.beginPath(),i.moveTo(0,-24),i.lineTo(0,-3),i.stroke(),i.fillStyle="#e6f3ff",i.strokeStyle="#7fa9c3",i.lineWidth=2,i.beginPath(),i.roundRect(-18,-7,36,13,6),i.fill(),i.stroke(),i.fillStyle="#4d7b9a";for(let n=-12;n<=12;n+=6)i.fillRect(n-1,2,2,2)}else{i.translate(43,19),i.rotate(.35),i.fillStyle="#ffd59a",i.strokeStyle="#f5f2ec",i.lineWidth=2,i.beginPath(),i.roundRect(-12,-14,42,28,12),i.fill(),i.stroke(),i.fillStyle="#eeeeee",i.fillRect(-26,-9,17,18),i.fillStyle="#efab77",i.beginPath(),i.roundRect(8,7,12,29,5),i.fill(),i.stroke(),i.strokeStyle="#8e633e";for(let n=14;n<=24;n+=4)i.beginPath(),i.moveTo(n,-7),i.lineTo(n,7),i.stroke()}i.restore()}let $=0;function St(t,e){let o=c.clientWidth||390,n=c.clientHeight||598,a=([.055,.085,.12][P]+(d==="Blow"?.035:0))*o,r=e*60,s=!1;for(let l of w){let g=Z(l,t,o,n);if(g.closest>a)continue;s=!0;let y=1-g.closest/a;d==="Wash"?(l.wet=Math.min(1,l.wet+e*1.8*(.3+y)),l.held||(l.v*=Math.pow(.94,r),l.vy+=1e-4*y*r)):(l.wet=Math.max(0,l.wet-e*1.6*(.3+y)),l.held||(l.v=Math.max(-.016,l.v-.0016*y*r),l.vy=Math.max(-.012,l.vy-5e-4*y*r)))}for($+=e*(d==="Wash"?65:25);$>=1;)$-=1,d==="Wash"?(m.push({kind:"drop",x:t.x+.055+(Math.random()-.5)*.06,y:t.y-.08,vx:-.06+(Math.random()-.5)*.08,vy:.38+Math.random()*.2,age:0,life:.55+Math.random()*.2}),s&&Math.random()<.34&&m.push({kind:"bubble",x:t.x+(Math.random()-.5)*a*2/o,y:t.y+(Math.random()-.5)*a/n,vx:(Math.random()-.5)*.014,vy:-.025,age:0,life:.8+Math.random()*.7,r:.003+Math.random()*.006})):m.push({kind:"air",x:t.x+.03,y:t.y+(Math.random()-.5)*.09,vx:-.45,vy:-.04,age:0,life:.32+Math.random()*.12});m.length>200&&m.splice(0,m.length-200)}let x=null,F=null,Y=null;function Lt(){if(!(d!=="Wash"&&d!=="Blow"))try{if(x??(x=new(window.AudioContext||window.webkitAudioContext)),x.resume().catch(()=>{}),!Y){Y=x.createBuffer(1,x.sampleRate*2,x.sampleRate);let n=Y.getChannelData(0);for(let a=0;a<n.length;a++)n[a]=Math.random()*2-1}st();let t=x.createBufferSource(),e=x.createBiquadFilter(),o=x.createGain();t.buffer=Y,t.loop=!0,e.type=d==="Wash"?"bandpass":"lowpass",e.frequency.value=d==="Wash"?2800:680,e.Q.value=.6,o.gain.setValueAtTime(0,x.currentTime),o.gain.linearRampToValueAtTime(d==="Wash"?.055:.075,x.currentTime+.12),t.connect(e).connect(o).connect(x.destination),t.start(),F={source:t,gain:o}}catch{}}function st(){if(!F||!x)return;let{source:t,gain:e}=F;F=null,e.gain.cancelScheduledValues(x.currentTime),e.gain.setTargetAtTime(0,x.currentTime,.025);try{t.stop(x.currentTime+.15)}catch{}}let dt=0;function ct(t){let e=Math.min(.034,Math.max(0,(t-(dt||t))/1e3));if(dt=t,j&&!I&&!document.hidden){let o=e*60;C&&h&&(d==="Wash"||d==="Blow")&&St(h,e);for(let n of w){if(C&&d==="Regrow"&&(n.growRemaining=Math.max(n.growRemaining,.02)),n.growRemaining>0){let a=Math.min(n.growRemaining,.14*e);wt(n,a),n.growRemaining-=a}n.wet=Math.max(0,n.wet-e*.008),!n.held&&(n.v+=-n.dx*.018*o,n.v*=Math.pow(.91,o),n.dx+=n.v*o,n.vy+=-n.dy*.018*o,n.vy*=Math.pow(.91,o),n.dy+=n.vy*o)}for(let n of M)n.age+=e,n.vy+=.9*e,n.x+=n.vx*e,n.y+=n.vy*e,n.angle+=n.spin*e;M=M.filter(n=>n.age<2.5&&n.cy+n.y<1.7);for(let n of m)n.age+=e,n.kind==="drop"&&(n.vy+=.6*e),n.x+=n.vx*e,n.y+=n.vy*e;m=m.filter(n=>n.age<n.life),A()}requestAnimationFrame(ct)}function pt(t){let e=c.getBoundingClientRect();return{x:(t.clientX-e.left)/e.width,y:(t.clientY-e.top)/e.height}}function Z(t,e,o,n){let a=1/0,r=0,s=H(t,0,o,n);for(let l=1;l<=48;l++){let g=H(t,l/48,o,n),y=g[0]-s[0],v=g[1]-s[1],u=Math.max(0,Math.min(1,((e.x*o-s[0])*y+(e.y*n-s[1])*v)/(y*y+v*v||1))),L=Math.hypot(s[0]+y*u-e.x*o,s[1]+v*u-e.y*n);L<a&&(a=L,r=(l-1+u)/48),s=g}return{closest:a,t:r}}function Bt(t,e,o,n){let a=t.len,r=Math.max(.012,a*e);if(a-r<.003)return;let s=r/a,l=[];for(let u=0;u<=20;u++){let L=s+(1-s)*u/20,xt=H(t,L,o,n);l.push({x:xt[0]/o,y:xt[1]/n,color:bt(t,a*L)})}let g=l.reduce((u,L)=>u+L.x,0)/l.length,y=l.reduce((u,L)=>u+L.y,0)/l.length;M.push({points:l,cx:g,cy:y,x:0,y:0,vx:(Math.random()-.5)*.055,vy:.025,angle:0,spin:(Math.random()-.5)*.8,age:0}),M.length>420&&M.splice(0,M.length-420);let v=K(t,s);t.dx*=v,t.dy*=v,t.curveSpan=(t.curveSpan||1)*s,t.len=r,t.dye=t.dye.filter(u=>u.from<r).map(u=>({...u,to:Math.min(u.to,r)})),t.v=0,t.vy=0,t.growRemaining=0}function ht(t,e){if(d==="Regrow"||d==="Wash"||d==="Blow")return;let o=c.clientWidth||390,n=c.clientHeight||598,a=[.045,.075,.115][P]*o;for(let r of w){X(r,o,n);let s=Z(r,t,o,n);if(!(s.closest>a)){if(d==="Scissors")Bt(r,s.t,o,n);else if(d==="Colors"){let l=null;for(let g=0;g<=96;g++){let y=H(r,g/96,o,n),v=Math.hypot(y[0]-t.x*o,y[1]-t.y*n)<=a;v&&l===null&&(l=Math.max(0,(g-.5)/96*r.len)),l!==null&&(!v||g===96)&&(vt(r,l,Math.min(r.len,(g+.5)/96*r.len),J),l=null)}}else if(d==="Hand"){r.held=!1;let l=(t.x-((e==null?void 0:e.x)??t.x))*1.4;r.v+=Math.max(-.025,Math.min(.025,l))*(1-s.closest/a)}}}}function Tt(t){W=[];let e=c.clientWidth||390,o=c.clientHeight||598,n=[.045,.075,.115][P]*e;for(let a of w){X(a,e,o);let r=Z(a,t,e,o);if(r.closest<=n){let s=Math.max(.08,K(a,r.t));a.held=!0,a.v=0,a.vy=0,W.push({strand:a,dx:a.dx,dy:a.dy,k:s})}}W.length&&(k.classList.remove("hidden"),D())}function Ct(t){if(U)for(let e of W)e.strand.dx=e.dx+(t.x-U.x)/e.k,e.strand.dy=e.dy+(t.y-U.y)/e.k}let U=null;function S(){C=!1,q=null,U=null,$=0,st();for(let t of W)t.strand.v=0,t.strand.vy=0;W=[]}c.addEventListener("pointerdown",t=>{!j||I||C||t.isPrimary===!1||(C=!0,q=t.pointerId,c.setPointerCapture(t.pointerId),h=pt(t),tt.classList.add("hidden"),Lt(),d==="Hold"?(U=h,Tt(h)):ht(h,h))}),c.addEventListener("pointermove",t=>{if(!C||t.pointerId!==q)return;let e=pt(t);if(d==="Hold")Ct(e);else{let o=Math.max(1,Math.ceil(Math.hypot(e.x-h.x,e.y-h.y)/.012));for(let n=1;n<=o;n++)ht({x:h.x+(e.x-h.x)*n/o,y:h.y+(e.y-h.y)*n/o},h)}h=e}),c.addEventListener("pointerup",t=>{t.pointerId===q&&S()}),c.addEventListener("pointercancel",t=>{t.pointerId===q&&S()}),c.addEventListener("lostpointercapture",t=>{t.pointerId===q&&S()}),p.querySelector(".tools").addEventListener("click",t=>{let e=t.target.closest("button");if(e){if(S(),e.dataset.action==="drop"){for(let o of w)o.held=!1,o.v=0,o.vy=0;k.classList.add("hidden"),A();return}d=e.dataset.tool,k.classList.toggle("hidden",d!=="Hold"&&!w.some(o=>o.held)),p.querySelectorAll("[data-tool]").forEach(o=>o.classList.toggle("active",o===e)),B.classList.toggle("hidden",d!=="Colors"),tt.classList.add("hidden"),d==="Regrow"&&Mt(),D()}}),p.querySelector(".reset").onclick=()=>{S(),rt(),B.classList.add("hidden"),A()},p.querySelector(".brush").onclick=t=>{P=(P+1)%3,t.currentTarget.textContent="Brush: "+["S","M","L"][P]},p.querySelector(".pause").onclick=t=>{I=!I,I&&S(),t.currentTarget.textContent=I?"Resume":"Pause"},document.addEventListener("visibilitychange",()=>{document.hidden&&S()}),window.addEventListener("pagehide",S),window.addEventListener("message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&(j=!!t.data.active,j||S(),A())}),rt(),A(),requestAnimationFrame(ct)})();(()=>{let p=document.createElement("style");p.dataset.batch3Ui="20261116",p.textContent=`
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

.top{top:30px;left:30px;right:30px;gap:8px}
.top button{min-height:44px;padding:9px 13px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
.guide{top:24%;left:30px;right:30px;width:auto;font:700 18px/1.4 UIBody,system-ui,sans-serif}
.tools button{font:700 14px/1.3 UIBody,system-ui,sans-serif;min-height:44px;padding:9px 11px}
.tool-row{gap:6px}
.palette{top:90px;left:30px;width:min(245px,calc(100% - 60px));font-family:UIBody,system-ui,sans-serif}
.palette-head{font-size:16px}.palette .done{font-size:14px;min-height:40px}
.brightness-label{font-size:13px}.drop{min-height:44px!important}
@media(max-width:350px){.tools{left:25px;right:25px}.tools button{padding:9px 8px}.top button{padding:9px 10px}}
`,document.head.append(p)})();})();
