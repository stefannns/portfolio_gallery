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

(()=>{document.documentElement.lang="it";(()=>{"use strict";let l=document.getElementById("root"),de=(e,t,i)=>Math.max(t,Math.min(i,e)),_=(e,t)=>e+Math.random()*(t-e),je=e=>e[Math.floor(Math.random()*e.length)],Ue=e=>e[e.length-1],$e=e=>{for(let t=e.length-1;t>0;t--){let i=Math.floor(Math.random()*(t+1));[e[t],e[i]]=[e[i],e[t]]}return e},te=[],U=[],T=!0,S=!1,p;function m(e,t,i,a){e.addEventListener(t,i,a),te.push(()=>e.removeEventListener(t,i,a))}function ue(e,t,i="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(a),l.style.background=i,l.innerHTML='<div class="fit">'+t+"</div>";let n=l.querySelector(".fit");function o(){let s=l.getBoundingClientRect(),r=Math.min(s.width/390,s.height/598);n.style.transform=`translate(${(s.width-390*r)/2}px,${(s.height-598*r)/2}px) scale(${r})`,l.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}o(),m(window,"resize",o)}function u(e){return l.querySelector(e)}function fe(){var e;(e=u(".guide"))==null||e.classList.add("gone")}function $(e){l.dataset.phase=e}function G(){H(),fe()}function H(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function W(e=450,t=.08,i=.18,a="sine",n=0){if(!(!p||!T))try{let o=p.createOscillator(),s=p.createGain(),r=p.currentTime;o.type=a,o.frequency.setValueAtTime(e,r),n&&o.frequency.exponentialRampToValueAtTime(Math.max(30,n),r+t),s.gain.setValueAtTime(.001,r),s.gain.exponentialRampToValueAtTime(i,r+.006),s.gain.exponentialRampToValueAtTime(.001,r+t),o.connect(s),s.connect(p.destination),o.start(r),o.stop(r+t+.02),o.onended=()=>{o.disconnect(),s.disconnect()}}catch{}}function De(){W(523,.12,.18),setTimeout(()=>W(784,.17,.16),100)}function pe(){W(180,.22,.18,"triangle",65)}function he(e){let t=0;function i(a){if(S)return;let n=Math.min(.035,(a-(t||a))/1e3);t=a,document.hidden||e(T?n:0,a/1e3),requestAnimationFrame(i)}requestAnimationFrame(i)}function Le(){let e=u("canvas.stage"),t=e.getContext("2d"),i=Math.min(2,window.devicePixelRatio||1);return e.width=390*i,e.height=598*i,t.scale(i,i),{canvas:e,ctx:t}}function Oe(e,t=u("canvas.stage")){let i=t.getBoundingClientRect();return{x:(e.clientX-i.left)*390/i.width,y:(e.clientY-i.top)*598/i.height}}function me(e,t,i,a,n,o){o=Math.min(Math.abs(a)/2,Math.abs(n)/2,o),e.moveTo(t+o,i),e.lineTo(t+a-o,i),e.quadraticCurveTo(t+a,i,t+a,i+o),e.lineTo(t+a,i+n-o),e.quadraticCurveTo(t+a,i+n,t+a-o,i+n),e.lineTo(t+o,i+n),e.quadraticCurveTo(t,i+n,t,i+n-o),e.lineTo(t,i+o),e.quadraticCurveTo(t,i,t+o,i),e.closePath()}function I(e,t,i,a,n,o,s,r){e.beginPath(),me(e,t,i,a,n,o),s&&(e.fillStyle=s,e.fill()),r&&(e.strokeStyle=r,e.stroke())}function Ve(e,t,i,a,n,o){e.beginPath(),e.arc(t,i,Math.max(.01,a),0,Math.PI*2),n&&(e.fillStyle=n,e.fill()),o&&(e.strokeStyle=o,e.stroke())}function ge(e,t,i,a,n,o,s=2){e.beginPath(),e.moveTo(t,i),e.lineTo(a,n),e.strokeStyle=o,e.lineWidth=s,e.stroke()}function be(e,t,i,a,n=18,o="#25252a",s="UIBody",r="center"){e.font=`700 ${n}px ${s}`,e.fillStyle=o,e.textAlign=r,e.textBaseline="middle",e.fillText(t,i,a)}let ne=[];function N(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(ae(t,e))}function X(e){let t=new Image;return t.onerror=()=>{l.dataset.assetIssue="image"},t.src=N(e),ne.push({im:t,path:e}),t}function ve(e,t,i,a,n,o){if(!t||!t.width)return;let s=t.videoWidth||t.width,r=t.videoHeight||t.height;if(!s||!r)return;let h=Math.max(n/s,o/r);e.save(),e.beginPath(),e.rect(i,a,n,o),e.clip(),e.drawImage(t,i+(n-s*h)/2,a+(o-r*h)/2,s*h,r*h),e.restore()}function Ge(e,t,i,a,n){e.save(),e.beginPath(),e.arc(i,a,n,0,Math.PI*2),e.clip(),ve(e,t,i-n,a-n,n*2,n*2),e.restore()}function ye(e,t,i,a){let n=u(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=e,n.querySelector(".value").textContent=t,n.querySelector("p").textContent=i;let o=n.querySelector("button");o.onclick=()=>{n.hidden=!0,G(),a()},$("result")}function xe(e="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Fe(){let e=u(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let Y=[];function ie(e){T=e,e||p==null||p.suspend().catch(()=>{});for(let t of Y)t(e)}m(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&ie(e.data.active===!0)}),m(document,"visibilitychange",()=>{ie(!document.hidden)}),m(window,"pagehide",()=>{S=!0,te.splice(0).forEach(e=>e()),U.splice(0).forEach(e=>e()),p==null||p.close().catch(()=>{})});let oe={};function ae(e,t){return oe[e]??t}async function we(e=()=>{}){let t=new AbortController,i=setTimeout(()=>t.abort(),1600);try{let a=await fetch("./game.config.json",{signal:t.signal});if(!a.ok)throw Error("Configurazione non disponibile");let n=await a.json();for(let o of["texts","tweaks","images"])for(let s of n[o]||[])oe[s.id]=o==="images"?s.path:s.value;for(let o of ne){let s=N(o.path);o.im.getAttribute("src")!==s&&(o.im.src=s)}for(let o of l.querySelectorAll('img[src^="./assets/"]'))o.src=N(o.getAttribute("src"));e(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(i)}}let c=null,f=null,w=null,D=null,L=!1,R=!1,v="",se=()=>{};function k(){c==null||c.getTracks().forEach(e=>e.stop()),c=null,f==null||f.close().catch(()=>{}),f=w=D=null,L=!1}async function re(){var e;if(!L){L=!0;try{if(!((e=navigator.mediaDevices)!=null&&e.getUserMedia))throw Error("Microfono non disponibile");if(c=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!1}}),S||!T||v==="hold"){k();return}f=new(window.AudioContext||window.webkitAudioContext),await f.resume();let t=f.createMediaStreamSource(c);w=f.createAnalyser(),w.fftSize=1024,t.connect(w),D=new Float32Array(w.fftSize),u(".mic-enable").textContent="Mic attivo",u(".mic-status").textContent="In ascolto \xB7 puoi anche tenere premuto o usare Spazio",l.dataset.microphone="enabled"}catch{L=!1,u(".mic-enable").textContent="Attiva microfono",u(".mic-status").textContent="Microfono non disponibile \xB7 tieni premuto per giocare",l.dataset.microphone="unavailable"}}}function Me(){if(R)return .9;if(!w||!T)return 0;w.getFloatTimeDomainData(D);let e=0;for(let t of D)e+=t*t;return de((Math.sqrt(e/D.length)-.012)*14,0,1)}function Ce(){m(u(".mic-enable"),"click",()=>{H(),re()});let e=u(".voice-hold");m(e,"pointerdown",t=>{t.preventDefault(),G(),Z("hold"),R=!0,e.setPointerCapture(t.pointerId)});for(let t of["pointerup","pointercancel","lostpointercapture"])m(e,t,()=>R=!1);m(window,"keydown",t=>{t.code==="Space"&&!t.repeat&&(t.preventDefault(),G(),Z("hold"),R=!0)}),m(window,"keyup",t=>{t.code==="Space"&&(R=!1)}),Y.push(t=>{if(t){if(f==null||f.resume().catch(()=>{}),c)for(let i of c.getTracks())i.enabled=!0}else if(R=!1,f==null||f.suspend().catch(()=>{}),c)for(let i of c.getTracks())i.enabled=!1}),U.push(k),ze()}function ke(e="Tieni premuto"){return`<div class="status mic-status" hidden></div><div class="bottom"><button class="capability mic-enable">Attiva microfono</button><button class="capability voice-hold">${e}</button></div>`}function Z(e){v=e,e==="hold"&&(c||L)&&k(),se()}function ze(){let e=u(".mic-enable"),t=u(".voice-hold"),i=e.parentElement,a=u(".mic-status"),n=!0,o=document.createElement("style");o.textContent="#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}",document.head.append(o);function s(){S||(e.hidden=v==="hold",t.hidden=v==="voice",i.classList.toggle("voice-mode-selected",!!v),l.dataset.voiceControl=v||"choice",v==="hold"&&(a.textContent="",a.hidden=!0))}se=s,m(e,"click",()=>Z("voice"),{capture:!0});let r=new MutationObserver(()=>{let h=l.dataset.microphone;v==="voice"&&["unavailable","error","off"].includes(h)&&(v=""),v==="hold"&&c&&k(),s()});r.observe(l,{attributes:!0,attributeFilter:["data-microphone"]}),U.push(()=>r.disconnect()),s()}function Ae(){let e=u(".mic-enable"),t=u(".mic-status"),i=new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en",n=!0?{idle:"Attiva microfono",requesting:"Connessione\u2026",active:"Microfono attivo",paused:"Microfono in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Non disponibile \xB7 usa il pulsante"}:{idle:"Attiva microfono",requesting:"Connessione\u2026",active:"Mic attivo",paused:"Mic in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Microfono non disponibile \xB7 tieni premuto per giocare"},o=document.createElement("style");o.textContent=".bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}",document.head.append(o);let s=!1,r=!1,h="",y=null,A=null;function F(){var j;let b=((j=c==null?void 0:c.getAudioTracks)==null?void 0:j.call(c))||[];return T&&!!w&&(f==null?void 0:f.state)==="running"&&b.some(C=>C.readyState==="live"&&C.enabled&&!C.muted)}function x(){var ce;if(S)return;let b=F(),j=!!((ce=c==null?void 0:c.getAudioTracks)!=null&&ce.call(c).some(ee=>ee.readyState==="live")),C=s?"requesting":b?"active":j?"paused":r?"unavailable":"idle";if(e.disabled=s,e.setAttribute("aria-pressed",String(b)),e.classList.toggle("is-listening",b),e.setAttribute("aria-label",j?n.stop:n.start),e.dataset.micState=C,l.dataset.microphone=b?"enabled":C==="idle"?"off":C,C!==h){let ee=b?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>',Ee=s?n.requesting:b?n.active:j?n.paused:n.idle;e.innerHTML=ee+'<span class="mic-button-label">'+Ee+"</span>",t.textContent=b?n.listening:r?n.unavailable:n.fallback,h=C}}function Q(){if(c&&y!==c){y=c;for(let b of c.getAudioTracks())m(b,"ended",()=>{k(),r=!1,x()}),m(b,"mute",x),m(b,"unmute",x)}f&&A!==f&&(A=f,m(f,"statechange",x))}m(e,"click",async b=>{if(b.preventDefault(),b.stopImmediatePropagation(),!(s||S)){if(c){k(),r=!1,x();return}if(H(),r=!1,s=!0,x(),await re(),s=!1,S||!T){k(),x();return}(!c||!f||!w)&&(k(),r=!0),Q(),h="",x()}},{capture:!0}),Y.push(()=>{Promise.resolve().then(()=>{Q(),x()})}),Q(),x()}function Te(){let e=u("canvas.stage"),t=e.getContext("2d"),i=u(".fit"),a={left:0,top:0,right:390,bottom:598};l.style.position="relative",l.style.isolation="isolate",l.prepend(e),i.style.background="transparent",i.style.zIndex="1",Object.assign(e.style,{position:"absolute",inset:"0",width:"100%",height:"100%",zIndex:"0",pointerEvents:"none"});function n(){let o=l.getBoundingClientRect();if(!o.width||!o.height)return;let s=Math.min(2,window.devicePixelRatio||1),r=Math.min(o.width/390,o.height/598),h=(o.width-390*r)/2,y=(o.height-598*r)/2,A=Math.round(o.width*s),F=Math.round(o.height*s);(e.width!==A||e.height!==F)&&(e.width=A,e.height=F),t.setTransform(s*r,0,0,s*r,s*h,s*y),Object.assign(a,{left:-h/r,top:-y/r,right:(o.width-h)/r,bottom:(o.height-y)/r}),i.style.transform=`translate(${h}px,${y}px) scale(${r})`}if(n(),m(window,"resize",n),typeof ResizeObserver<"u"){let o=new ResizeObserver(n);o.observe(l),U.push(()=>o.disconnect())}return{canvas:e,ctx:t,bounds:a}}function Se(e){let t=u(e==="camera"?".cam-status":".mic-status");if(!t)return;let i=!0;t.setAttribute("role","status"),t.setAttribute("aria-live","polite");function a(){var y;let r="";if(e==="camera")["requesting","unavailable"].includes(l.dataset.camera)&&(r=t.textContent);else{let A=((y=u(".mic-enable"))==null?void 0:y.dataset.micState)||l.dataset.microphone;A==="requesting"?r="Consenti l\u2019accesso al microfono":["unavailable","error"].includes(A)&&(r="Microfono non disponibile")}t.textContent!==r&&(t.textContent=r);let h=!r.trim();t.hidden!==h&&(t.hidden=h)}let n=new MutationObserver(a);n.observe(t,{childList:!0,characterData:!0,subtree:!0});let o=new MutationObserver(a);o.observe(l,{attributes:!0,attributeFilter:[e==="camera"?"data-camera":"data-microphone"]});let s=u(".mic-enable");s&&o.observe(s,{attributes:!0,attributeFilter:["data-mic-state"]}),a(),U.push(()=>{n.disconnect(),o.disconnect()})}ue(".fit{background:#e9e2c8}.guide{top:106px;font:17px Playful,Arial;color:#565c3d}.hud{font-size:17px;color:#5e5a3d;font-family:Playful,Arial}.capability{border-color:#8f733c55;background:#fff6da}.mic-status{color:#72583f}.result{background:#fff3d5}.result h2{font-family:Playful,Arial}.pill{background:#847443}",`<canvas class="stage" aria-label="Sfida di precisione del karate"></canvas><div class="hud center"><span class="round-label">1 tavola</span></div><div class="guide">Grida al momento giusto</div>${ke("Tieni per gridare")}${xe()}`,"#e9e2c8"),Se("microphone");let{ctx:d,bounds:g}=Te(),Ie=X("./assets/karate-ready.webp"),Pe=X("./assets/karate-chop.webp"),P=X("./assets/dojo-interior-v1.webp");function qe(){if(d.fillStyle="#e9e2c8",d.fillRect(g.left,g.top,g.right-g.left,g.bottom-g.top),!P.width){d.fillStyle="#d0a367",d.fillRect(g.left,435,g.right-g.left,Math.max(0,g.bottom-435));return}let e=P.height*.755,t=Math.max((g.right-g.left)/P.width,(435-g.top)/e,(g.bottom-435)/(P.height-e)),i=P.width*t,a=P.height*t;d.drawImage(P,(g.left+g.right-i)/2,435-e*t,i,a)}let M=1,J=0,q=0,K=0,B="ready",z=0,O=!0,V=0,E=[];function le(){M=1,J=0,q=0,K=0,B="ready",z=0,O=!0,E=[],V=0,u(".round-label").textContent="1 tavola",$("ready")}function Be(){if(!p)return;let e=p.createBufferSource(),t=p.createGain(),i=p.createBuffer(1,p.sampleRate*.13,p.sampleRate),a=i.getChannelData(0);for(let n=0;n<a.length;n++)a[n]=(Math.random()*2-1)*Math.exp(-n/a.length*15);e.buffer=i,t.gain.value=.28,e.connect(t),t.connect(p.destination),e.start(),e.onended=()=>{e.disconnect(),t.disconnect()}}function Re(){if(!O||B==="result"||z>0)return;G(),O=!1,V=.43,B="playing";let e=Math.min(.92,.69+M*.025);if(q>=e){Be(),J+=M,z=1.05;for(let t=0;t<M*5;t++)E.push({x:275,y:360-M*8,vx:_(-160,160),vy:_(-180,-70),r:_(0,6)});$("hit")}else z=.8,B="failed",pe(),$("miss")}Ce(),Ae(),le(),he(e=>{let t=Me();K+=e,q=(Math.sin(K*(2.4+M*.13))+1)/2,t<.1&&(O=!0),t>.3&&O&&Re(),V=Math.max(0,V-e),z>0&&(z-=e,z<=0&&(B==="failed"?(B="result",ye("Trova il momento giusto",J,"Tavole rotte",le)):(M++,u(".round-label").textContent=M+" tavole",$("playing"))));for(let n of E)n.x+=n.vx*e,n.y+=n.vy*e,n.vy+=600*e,n.r+=e*3;E=E.filter(n=>n.y<560),qe(),I(d,48,160,294,17,8,"#acb98c","#786b43");let i=d.createLinearGradient(48,0,342,0);i.addColorStop(0,"#b7d59d"),i.addColorStop(.8,"#e8ce84"),i.addColorStop(1,"#dd8a54"),I(d,50,162,290*q,13,6,i),d.fillStyle="#5e5534",d.beginPath(),d.moveTo(48+q*294,151),d.lineTo(43+q*294,144),d.lineTo(53+q*294,144),d.fill(),be(d,"ORA",329,195,12,"#8b6a38"),I(d,235,375,12,90,2,"#6b4b2f","#44311e"),I(d,321,375,12,90,2,"#6b4b2f","#44311e"),I(d,222,367,124,14,2,"#b27b46","#765533");for(let n=0;n<M&&n<12;n++)z>0&&B!=="failed"||(I(d,223,359-n*7,124,6,1,"#e1b37a","#946637"),ge(d,232,361-n*7,333,361-n*7,"#f6d7a155",1));let a=V>0?Pe:Ie;a.width&&d.drawImage(a,22,258,218,218);for(let n of E)d.save(),d.translate(n.x,n.y),d.rotate(n.r),I(d,-12,-3,24,6,1,"#d6a56d","#916332"),d.restore()}),we(()=>{u(".guide")&&(u(".guide").textContent=String(ae("GUIDE","Grida al momento giusto")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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
