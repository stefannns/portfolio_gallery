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

(()=>{(()=>{"use strict";let p=document.getElementById("root"),D=document.createElement("style");D.textContent="*{box-sizing:border-box}html,body,#root{height:100%;width:100%;margin:0;overflow:hidden;background:#09090b;color:white;font-family:system-ui,sans-serif}button{font:700 13px system-ui;color:white;background:#111;border:2px solid #eee;border-radius:30px;padding:8px 11px;touch-action:manipulation}.scene{height:100%;position:relative;overflow:hidden}canvas{position:absolute;width:100%;height:100%;touch-action:none}.guide{position:absolute;top:15%;width:100%;text-align:center;font-weight:800;font-size:19px;pointer-events:none}.top{position:absolute;top:3%;left:4%;right:4%;display:flex;justify-content:space-between;gap:5px}.reset{border-color:#ff5559;color:#ff6a6c}.tools{position:absolute;bottom:4%;left:3%;right:3%;display:flex;justify-content:center;flex-wrap:wrap;gap:5px}.tools button.active{background:#fff;color:#111}.hold-tool{position:relative;display:flex}.drop{position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);z-index:3;min-height:36px;white-space:nowrap}.palette{position:absolute;z-index:5;top:11%;left:5%;width:min(245px,65%);background:#101010;border:2px solid #eee;border-radius:10px;padding:12px;box-shadow:0 4px 20px #0008}.palette-head{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700}.palette .done{font-size:12px;padding:4px 9px}.color-wheel{width:145px;height:145px;max-width:90%;aspect-ratio:1;border-radius:50%;margin:14px auto;touch-action:none;background:radial-gradient(circle,white,transparent 70%),conic-gradient(red,#ff0,lime,cyan,blue,magenta,red);border:2px solid white}.brightness-label{display:flex;justify-content:space-between;font-size:11px;color:#ddd}.brightness{width:100%;accent-color:white;margin:7px 0}.color-preview{height:25px;border:2px solid white;border-radius:5px}.hidden{display:none}",document.head.append(D),p.innerHTML='<div class="scene"><canvas aria-label="Hair styling area"></canvas><div class="guide">Choose a tool to style</div><div class="top"><button class="reset">Reset</button><button class="brush">Brush: S</button><button class="pause">Pause</button></div><div class="palette hidden"></div><div class="tools"></div></div>';let c=p.querySelector("canvas"),i=c.getContext("2d"),G=p.querySelector(".guide"),k=p.querySelector(".palette");D.textContent+=".tools{left:30px;right:30px;bottom:calc(50px + env(safe-area-inset-bottom,0px));flex-direction:column;gap:8px;align-items:center}.tool-row{display:flex;justify-content:center;gap:6px;width:100%}.tools button{min-height:42px;padding:8px 12px;font-size:clamp(12px,3.3vw,15px)}@media(max-height:520px){.tools{bottom:18px;gap:5px}.tools button{min-height:36px;padding:6px 10px}}";let at=[["Hand","Hold","Scissors","Regrow"],["Colors","Wash","Blow"]],d="Hand",$="#fafafa",C=0,P=!1,S=!1,h=null,I=new URLSearchParams(location.search).get("feedReview")!=="1",b=[],L=[],v=[],y=[],R=null;k.innerHTML='<div class="palette-head"><span>Color Picker</span><button class="done">Done</button></div><div class="color-wheel" role="slider" aria-label="Choose hair color" tabindex="0"></div><div class="brightness-label"><span>Dark</span><span>Light</span></div><input class="brightness" aria-label="Color brightness" type="range" min="0" max="100" value="100"><div class="color-preview"></div>';let T=50,N=1,F=1,B=k.querySelector(".color-wheel"),Q=k.querySelector(".brightness"),lt=k.querySelector(".color-preview");function V(){let t=F*N,e=t*(1-Math.abs(T/60%2-1)),n=F-t;$=`rgb(${(T<60?[t,e,0]:T<120?[e,t,0]:T<180?[0,t,e]:T<240?[0,e,t]:T<300?[e,0,t]:[t,0,e]).map(a=>Math.round((a+n)*255)).join(",")})`,lt.style.background=$}function _(t){let e=B.getBoundingClientRect(),n=(t.clientX-e.left-e.width/2)/(e.width/2),o=(t.clientY-e.top-e.height/2)/(e.height/2);T=(Math.atan2(n,-o)*180/Math.PI+360)%360,N=Math.min(1,Math.hypot(n,o)),V()}B.addEventListener("pointerdown",t=>{B.setPointerCapture(t.pointerId),_(t)}),B.addEventListener("pointermove",t=>{B.hasPointerCapture(t.pointerId)&&_(t)}),Q.addEventListener("input",()=>{F=Number(Q.value)/100,V()}),k.querySelector(".done").onclick=()=>k.classList.add("hidden"),V(),p.querySelector(".tools").innerHTML=at.map(t=>'<div class="tool-row">'+t.map(e=>{let n=`<button data-tool="${e}" class="${e===d?"active":""}">${e}</button>`;return e==="Hold"?`<span class="hold-tool">${n}<button class="drop hidden" data-action="drop">Drop</button></span>`:n}).join("")+"</div>").join("");let A=p.querySelector(".drop");function H(t,e,n){let o=Math.min(e*.22,n*.16);t.x=.5+t.u*o/e,t.top=.48-Math.sqrt(Math.max(0,1-t.u*t.u))*o/n}function K(){let t=c.clientWidth||390,e=c.clientHeight||598;v=[],y=[],A.classList.add("hidden"),b=Array.from({length:170},(n,o)=>{let a={u:2*o/169-1,dx:0,dy:0,v:0,vy:0,held:!1,curveSpan:1,dye:[],growRemaining:0,wet:0};return H(a,t,e),a.len=.73-a.top+Math.random()*.015,a})}function rt(){let t=Math.min(devicePixelRatio||1,2),e=c.clientWidth,n=c.clientHeight;return(c.width!==e*t||c.height!==n*t)&&(c.width=e*t,c.height=n*t),i.setTransform(t,0,0,t,0,0),[e,n]}let O=t=>3*(1-t)*(1-t)*t*.1+3*(1-t)*t*t*.65+t*t*t;function X(t,e){let n=t.curveSpan||1;return O(e*n)/O(n)}function W(t,e,n,o){let a=X(t,e);return[(t.x+t.dx*a)*n,(t.top+t.len*e+t.dy*a)*o]}function J(t,e,n,o,a){let l=Math.max(2,Math.ceil((n-e)*48));i.beginPath();for(let s=0;s<=l;s++){let r=W(t,e+(n-e)*s/l,o,a);s?i.lineTo(...r):i.moveTo(...r)}i.stroke()}function st(t,e){let n=t.dye.find(o=>e>=o.from&&e<=o.to);return n?n.color:"#fafafa"}function dt(t,e,n,o){if(e=Math.max(0,e),n=Math.min(t.len,n),n<=e)return;let a=[];for(let l of t.dye)l.to<=e||l.from>=n?a.push(l):(l.from<e&&a.push({...l,to:e}),l.to>n&&a.push({...l,from:n}));a.push({from:e,to:n,color:o}),a.sort((l,s)=>l.from-s.from),t.dye=[];for(let l of a){let s=t.dye[t.dye.length-1];s&&s.color===l.color&&l.from<=s.to+1e-5?s.to=Math.max(s.to,l.to):t.dye.push(l)}}function ct(t,e){if(!(e<=0)){t.len+=e;for(let n of t.dye)n.from+=e,n.to+=e}}function ht(t=.14){for(let e of b)e.growRemaining+=t}function q(){let[t,e]=rt();i.clearRect(0,0,t,e),i.strokeStyle="#f8f8f8",i.lineWidth=Math.max(2,t*.006),i.lineCap="round",i.lineJoin="round",i.beginPath(),i.arc(t*.5,e*.48,Math.min(t*.22,e*.16),0,Math.PI*2),i.stroke(),i.beginPath(),i.moveTo(t*.16,e*.79),i.lineTo(t*.5,e*.7),i.lineTo(t*.84,e*.79),i.stroke();for(let n of v){i.save(),i.translate((n.cx+n.x)*t,(n.cy+n.y)*e),i.rotate(n.angle),i.globalAlpha=Math.min(1,Math.max(0,(2.5-n.age)*2)),i.lineWidth=Math.max(2.7,t*.0061);for(let o=1;o<n.points.length;o++){let a=n.points[o-1],l=n.points[o];i.strokeStyle=l.color,i.beginPath(),i.moveTo((a.x-n.cx)*t,(a.y-n.cy)*e),i.lineTo((l.x-n.cx)*t,(l.y-n.cy)*e),i.stroke()}i.restore()}for(let n of b){H(n,t,e),i.lineWidth=Math.max(2.9,t*.0065),i.strokeStyle="#fafafa",J(n,0,1,t,e);for(let o of n.dye)i.strokeStyle=o.color,J(n,o.from/n.len,Math.min(1,o.to/n.len),t,e);n.wet>.01&&(i.save(),i.globalAlpha=n.wet*.32,i.strokeStyle="#70c8f0",J(n,0,1,t,e),i.restore())}for(let n of y)i.save(),i.globalAlpha=Math.max(0,1-n.age/n.life),i.lineWidth=1.4,i.strokeStyle=n.kind==="air"?"#f7ebd4":"#b4eaff",n.kind==="drop"?(i.beginPath(),i.moveTo(n.x*t,n.y*e),i.lineTo((n.x-n.vx*.035)*t,(n.y-n.vy*.035)*e),i.stroke()):n.kind==="bubble"?(i.fillStyle="#dff6ff",i.globalAlpha*=.75,i.beginPath(),i.arc(n.x*t,n.y*e,n.r*t,0,Math.PI*2),i.fill(),i.globalAlpha*=1.2,i.stroke()):(i.beginPath(),i.moveTo(n.x*t,n.y*e),i.quadraticCurveTo((n.x+.025)*t,(n.y+.003)*e,(n.x+.06)*t,(n.y+.015)*e),i.stroke()),i.restore();S&&h&&(d==="Wash"||d==="Blow")&&ft(h,t,e)}function ft(t,e,n){if(i.save(),i.translate(t.x*e,t.y*n),i.lineCap="round",i.lineJoin="round",d==="Wash"){i.translate(23,-52),i.rotate(.35),i.lineWidth=7,i.strokeStyle="#a8b9c6",i.beginPath(),i.moveTo(0,-24),i.lineTo(0,-3),i.stroke(),i.fillStyle="#e6f3ff",i.strokeStyle="#7fa9c3",i.lineWidth=2,i.beginPath(),i.roundRect(-18,-7,36,13,6),i.fill(),i.stroke(),i.fillStyle="#4d7b9a";for(let o=-12;o<=12;o+=6)i.fillRect(o-1,2,2,2)}else{i.translate(43,19),i.rotate(.35),i.fillStyle="#ffd59a",i.strokeStyle="#f5f2ec",i.lineWidth=2,i.beginPath(),i.roundRect(-12,-14,42,28,12),i.fill(),i.stroke(),i.fillStyle="#eeeeee",i.fillRect(-26,-9,17,18),i.fillStyle="#efab77",i.beginPath(),i.roundRect(8,7,12,29,5),i.fill(),i.stroke(),i.strokeStyle="#8e633e";for(let o=14;o<=24;o+=4)i.beginPath(),i.moveTo(o,-7),i.lineTo(o,7),i.stroke()}i.restore()}let E=0;function pt(t,e){let n=c.clientWidth||390,o=c.clientHeight||598,a=([.055,.085,.12][C]+(d==="Blow"?.035:0))*n,l=e*60,s=!1;for(let r of b){let x=Y(r,t,n,o);if(x.closest>a)continue;s=!0;let g=1-x.closest/a;d==="Wash"?(r.wet=Math.min(1,r.wet+e*1.8*(.3+g)),r.held||(r.v*=Math.pow(.94,l),r.vy+=1e-4*g*l)):(r.wet=Math.max(0,r.wet-e*1.6*(.3+g)),r.held||(r.v=Math.max(-.016,r.v-.0016*g*l),r.vy=Math.max(-.012,r.vy-5e-4*g*l)))}for(E+=e*(d==="Wash"?65:25);E>=1;)E-=1,d==="Wash"?(y.push({kind:"drop",x:t.x+.055+(Math.random()-.5)*.06,y:t.y-.08,vx:-.06+(Math.random()-.5)*.08,vy:.38+Math.random()*.2,age:0,life:.55+Math.random()*.2}),s&&Math.random()<.34&&y.push({kind:"bubble",x:t.x+(Math.random()-.5)*a*2/n,y:t.y+(Math.random()-.5)*a/o,vx:(Math.random()-.5)*.014,vy:-.025,age:0,life:.8+Math.random()*.7,r:.003+Math.random()*.006})):y.push({kind:"air",x:t.x+.03,y:t.y+(Math.random()-.5)*.09,vx:-.45,vy:-.04,age:0,life:.32+Math.random()*.12});y.length>200&&y.splice(0,y.length-200)}let u=null,U=null,j=null;function ut(){if(!(d!=="Wash"&&d!=="Blow"))try{if(u??(u=new(window.AudioContext||window.webkitAudioContext)),u.resume().catch(()=>{}),!j){j=u.createBuffer(1,u.sampleRate*2,u.sampleRate);let o=j.getChannelData(0);for(let a=0;a<o.length;a++)o[a]=Math.random()*2-1}Z();let t=u.createBufferSource(),e=u.createBiquadFilter(),n=u.createGain();t.buffer=j,t.loop=!0,e.type=d==="Wash"?"bandpass":"lowpass",e.frequency.value=d==="Wash"?2800:680,e.Q.value=.6,n.gain.setValueAtTime(0,u.currentTime),n.gain.linearRampToValueAtTime(d==="Wash"?.055:.075,u.currentTime+.12),t.connect(e).connect(n).connect(u.destination),t.start(),U={source:t,gain:n}}catch{}}function Z(){if(!U||!u)return;let{source:t,gain:e}=U;U=null,e.gain.cancelScheduledValues(u.currentTime),e.gain.setTargetAtTime(0,u.currentTime,.025);try{t.stop(u.currentTime+.15)}catch{}}let tt=0;function et(t){let e=Math.min(.034,Math.max(0,(t-(tt||t))/1e3));if(tt=t,I&&!P&&!document.hidden){let n=e*60;S&&h&&(d==="Wash"||d==="Blow")&&pt(h,e);for(let o of b){if(S&&d==="Regrow"&&(o.growRemaining=Math.max(o.growRemaining,.02)),o.growRemaining>0){let a=Math.min(o.growRemaining,.14*e);ct(o,a),o.growRemaining-=a}o.wet=Math.max(0,o.wet-e*.008),!o.held&&(o.v+=-o.dx*.018*n,o.v*=Math.pow(.91,n),o.dx+=o.v*n,o.vy+=-o.dy*.018*n,o.vy*=Math.pow(.91,n),o.dy+=o.vy*n)}for(let o of v)o.age+=e,o.vy+=.9*e,o.x+=o.vx*e,o.y+=o.vy*e,o.angle+=o.spin*e;v=v.filter(o=>o.age<2.5&&o.cy+o.y<1.7);for(let o of y)o.age+=e,o.kind==="drop"&&(o.vy+=.6*e),o.x+=o.vx*e,o.y+=o.vy*e;y=y.filter(o=>o.age<o.life),q()}requestAnimationFrame(et)}function nt(t){let e=c.getBoundingClientRect();return{x:(t.clientX-e.left)/e.width,y:(t.clientY-e.top)/e.height}}function Y(t,e,n,o){let a=1/0,l=0,s=W(t,0,n,o);for(let r=1;r<=48;r++){let x=W(t,r/48,n,o),g=x[0]-s[0],m=x[1]-s[1],f=Math.max(0,Math.min(1,((e.x*n-s[0])*g+(e.y*o-s[1])*m)/(g*g+m*m||1))),M=Math.hypot(s[0]+g*f-e.x*n,s[1]+m*f-e.y*o);M<a&&(a=M,l=(r-1+f)/48),s=x}return{closest:a,t:l}}function xt(t,e,n,o){let a=t.len,l=Math.max(.012,a*e);if(a-l<.003)return;let s=l/a,r=[];for(let f=0;f<=20;f++){let M=s+(1-s)*f/20,it=W(t,M,n,o);r.push({x:it[0]/n,y:it[1]/o,color:st(t,a*M)})}let x=r.reduce((f,M)=>f+M.x,0)/r.length,g=r.reduce((f,M)=>f+M.y,0)/r.length;v.push({points:r,cx:x,cy:g,x:0,y:0,vx:(Math.random()-.5)*.055,vy:.025,angle:0,spin:(Math.random()-.5)*.8,age:0}),v.length>420&&v.splice(0,v.length-420);let m=X(t,s);t.dx*=m,t.dy*=m,t.curveSpan=(t.curveSpan||1)*s,t.len=l,t.dye=t.dye.filter(f=>f.from<l).map(f=>({...f,to:Math.min(f.to,l)})),t.v=0,t.vy=0,t.growRemaining=0}function ot(t,e){if(d==="Regrow"||d==="Wash"||d==="Blow")return;let n=c.clientWidth||390,o=c.clientHeight||598,a=[.045,.075,.115][C]*n;for(let l of b){H(l,n,o);let s=Y(l,t,n,o);if(!(s.closest>a)){if(d==="Scissors")xt(l,s.t,n,o);else if(d==="Colors"){let r=null;for(let x=0;x<=96;x++){let g=W(l,x/96,n,o),m=Math.hypot(g[0]-t.x*n,g[1]-t.y*o)<=a;m&&r===null&&(r=Math.max(0,(x-.5)/96*l.len)),r!==null&&(!m||x===96)&&(dt(l,r,Math.min(l.len,(x+.5)/96*l.len),$),r=null)}}else if(d==="Hand"){l.held=!1;let r=(t.x-((e==null?void 0:e.x)??t.x))*1.4;l.v+=Math.max(-.025,Math.min(.025,r))*(1-s.closest/a)}}}}function gt(t){L=[];let e=c.clientWidth||390,n=c.clientHeight||598,o=[.045,.075,.115][C]*e;for(let a of b){H(a,e,n);let l=Y(a,t,e,n);if(l.closest<=o){let s=Math.max(.08,X(a,l.t));a.held=!0,a.v=0,a.vy=0,L.push({strand:a,dx:a.dx,dy:a.dy,k:s})}}L.length&&A.classList.remove("hidden")}function yt(t){if(z)for(let e of L)e.strand.dx=e.dx+(t.x-z.x)/e.k,e.strand.dy=e.dy+(t.y-z.y)/e.k}let z=null;function w(){S=!1,R=null,z=null,E=0,Z();for(let t of L)t.strand.v=0,t.strand.vy=0;L=[]}c.addEventListener("pointerdown",t=>{!I||P||S||t.isPrimary===!1||(S=!0,R=t.pointerId,c.setPointerCapture(t.pointerId),h=nt(t),G.classList.add("hidden"),ut(),d==="Hold"?(z=h,gt(h)):ot(h,h))}),c.addEventListener("pointermove",t=>{if(!S||t.pointerId!==R)return;let e=nt(t);if(d==="Hold")yt(e);else{let n=Math.max(1,Math.ceil(Math.hypot(e.x-h.x,e.y-h.y)/.012));for(let o=1;o<=n;o++)ot({x:h.x+(e.x-h.x)*o/n,y:h.y+(e.y-h.y)*o/n},h)}h=e}),c.addEventListener("pointerup",t=>{t.pointerId===R&&w()}),c.addEventListener("pointercancel",t=>{t.pointerId===R&&w()}),c.addEventListener("lostpointercapture",t=>{t.pointerId===R&&w()}),p.querySelector(".tools").addEventListener("click",t=>{let e=t.target.closest("button");if(e){if(w(),e.dataset.action==="drop"){for(let n of b)n.held=!1,n.v=0,n.vy=0;A.classList.add("hidden"),q();return}d=e.dataset.tool,A.classList.toggle("hidden",d!=="Hold"&&!b.some(n=>n.held)),p.querySelectorAll("[data-tool]").forEach(n=>n.classList.toggle("active",n===e)),k.classList.toggle("hidden",d!=="Colors"),G.classList.add("hidden"),d==="Regrow"&&ht()}}),p.querySelector(".reset").onclick=()=>{w(),K(),k.classList.add("hidden"),q()},p.querySelector(".brush").onclick=t=>{C=(C+1)%3,t.currentTarget.textContent="Brush: "+["S","M","L"][C]},p.querySelector(".pause").onclick=t=>{P=!P,P&&w(),t.currentTarget.textContent=P?"Resume":"Pause"},document.addEventListener("visibilitychange",()=>{document.hidden&&w()}),window.addEventListener("pagehide",w),window.addEventListener("message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&(I=!!t.data.active,I||w(),q())}),K(),q(),requestAnimationFrame(et)})();(()=>{let p=document.createElement("style");p.dataset.batch3Ui="20261116",p.textContent=`
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
