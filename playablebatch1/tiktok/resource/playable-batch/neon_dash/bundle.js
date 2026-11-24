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

(()=>{function Me(h,Q){if(!h)throw new Error("Game mount target is missing");let f=String(Q??""),R=z=>z.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(L,T)=>{if(T[0]==="#"){let S=T[1].toLowerCase()==="x",u=parseInt(T.slice(S?2:1),S?16:10);return u>0&&u<=1114111?String.fromCodePoint(u):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[T.toLowerCase()]||L});for(;h.firstChild;)h.removeChild(h.firstChild);let e=[{element:h,tag:"",svg:h.namespaceURI==="http://www.w3.org/2000/svg"}],oe=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,y=0;for(;y<f.length;){if(f.startsWith("<!--",y)){let a=f.indexOf("-->",y+4);y=a<0?f.length:a+3;continue}if(f[y]!=="<"){let a=f.indexOf("<",y),j=a<0?f.length:a;e[e.length-1].element.appendChild(document.createTextNode(R(f.slice(y,j)))),y=j;continue}let z=y+1,L="";for(;z<f.length;z++){let a=f[z];if(L)a===L&&(L="");else if(a==='"'||a==="'")L=a;else if(a===">")break}if(z>=f.length)throw new Error("Incomplete game markup");let T=f.slice(y+1,z);if(y=z+1,/^\s*!/.test(T))continue;let S=/^\s*\/\s*([\w:-]+)/.exec(T);if(S){for(let a=e.length-1;a>0;a--)if(e[a].tag.toLowerCase()===S[1].toLowerCase()){e.length=a;break}continue}let u=/^\s*([\w:-]+)/.exec(T);if(!u)throw new Error("Invalid game markup");let E=u[1],N=e[e.length-1],b=E.toLowerCase()==="svg"||N.svg&&N.tag.toLowerCase()!=="foreignobject",g=b?document.createElementNS("http://www.w3.org/2000/svg",E):document.createElement(E),C=T.slice(u[0].length).replace(/\/\s*$/,""),c=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,w;for(;w=c.exec(C);){let a=w[1],j=R(w[2]??w[3]??w[4]??"");g.setAttribute(a,j)}N.element.appendChild(g),!oe.test(E)&&!/\/\s*$/.test(T)&&e.push({element:g,tag:E,svg:b})}return f}document.documentElement.lang="it";(()=>{"use strict";let h=document.getElementById("root"),Q=document.createElement("style");Q.textContent=`
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
  `,document.head.append(Q),Me(h,'<div class="dash"><canvas aria-label="Campo di Scatto neon"></canvas><div class="hud"><div class="stats"><span class="best">RECORD 0%</span><span class="progress-label">0%</span></div><div class="track"><div class="fill"></div></div></div><div class="levels" aria-label="Scegli il livello"></div><div class="guide">Tocca per saltare</div><div class="result hidden"><div class="card"><h1>Riprova</h1><p>0%</p><button>Riprova</button></div></div></div>');let f=h.querySelector(".dash"),R=h.querySelector("canvas"),e=R.getContext("2d"),oe=h.querySelector(".progress-label"),y=h.querySelector(".best"),z=h.querySelector(".fill"),L=h.querySelector(".guide"),T=h.querySelector(".levels"),S=h.querySelector(".result"),u=[{speed:285,length:8600,spacing:1,loopFrom:8,patterns:["single","double","short-pair","platforms","tall","low-ceiling","saw","double","platforms","high-saw","triple","jump-duck","spike-ledge","saw-platform","duck-jump","short-pair","stairs-up","low-ceiling"]},{speed:320,length:10300,spacing:.97,loopFrom:6,patterns:["double","saw-spike","platforms","triple","duck-jump","spike-ledge","saw-ceiling","stairs-up","high-saw","quad","jump-duck","steps-down","high-ledge","saw-platform","duck-jump","tall","spike-ledge","stairs-up"]},{speed:355,length:12e3,spacing:.94,loopFrom:4,patterns:["triple","spike-ledge","saw-ceiling","quad","jump-duck","stairs-up","duck-jump","high-ledge","saw-spike","steps-down","quad","jump-duck","platforms","saw-platform","high-saw","high-ledge","stairs-up","duck-jump"]}],E={single:{advance:280,objects:[{x:0,w:28,h:40,kind:"spike"}]},double:{advance:300,objects:[{x:0,w:28,h:40,kind:"spike"},{x:29,w:28,h:40,kind:"spike"}]},triple:{advance:330,objects:[{x:0,w:28,h:40,kind:"spike"},{x:29,w:28,h:40,kind:"spike"},{x:58,w:28,h:40,kind:"spike"}]},quad:{advance:360,objects:[{x:0,w:28,h:40,kind:"spike"},{x:29,w:28,h:40,kind:"spike"},{x:58,w:28,h:40,kind:"spike"},{x:87,w:28,h:40,kind:"spike"}]},"short-pair":{advance:280,objects:[{x:0,w:26,h:24,kind:"spike"},{x:68,w:26,h:24,kind:"spike"}]},tall:{advance:300,objects:[{x:0,w:30,h:58,kind:"spike"}]},saw:{advance:315,objects:[{x:0,w:48,r:24,lift:24,kind:"saw"}]},"high-saw":{advance:300,objects:[{x:0,w:48,r:24,lift:78,kind:"saw"}]},platforms:{advance:480,objects:[{x:0,w:90,h:28,kind:"block"},{x:130,w:100,h:52,kind:"block"}]},"stairs-up":{advance:580,objects:[{x:0,w:76,h:24,kind:"block"},{x:112,w:86,h:48,kind:"block"},{x:242,w:96,h:72,kind:"block"}]},"steps-down":{advance:500,objects:[{x:0,w:112,h:60,kind:"block"},{x:160,w:106,h:30,kind:"block"}]},"low-ceiling":{advance:320,objects:[{x:0,w:152,h:76,lift:146,kind:"ceiling"}]},"saw-ceiling":{advance:510,objects:[{x:0,w:48,r:24,lift:24,kind:"saw"},{x:210,w:150,h:76,lift:146,kind:"ceiling"}]},"saw-platform":{advance:440,objects:[{x:0,w:48,r:24,lift:24,kind:"saw"},{x:155,w:112,h:44,kind:"block"}]},"spike-ledge":{advance:430,objects:[{x:0,w:190,h:34,kind:"block"},{x:90,w:26,h:26,kind:"spike",lift:34}]},"high-ledge":{advance:490,objects:[{x:0,w:192,h:52,kind:"block"},{x:86,w:26,h:24,kind:"spike",lift:52}]},"jump-duck":{advance:490,objects:[{x:0,w:28,h:40,kind:"spike"},{x:29,w:28,h:40,kind:"spike"},{x:58,w:28,h:40,kind:"spike"},{x:226,w:138,h:74,lift:140,kind:"ceiling"}]},"duck-jump":{advance:500,objects:[{x:0,w:128,h:78,lift:160,kind:"ceiling"},{x:224,w:28,h:40,kind:"spike"},{x:253,w:28,h:40,kind:"spike"}]},"saw-spike":{advance:390,objects:[{x:0,w:48,r:24,lift:24,kind:"saw"},{x:112,w:28,h:28,kind:"spike"}]}},N="neon-dash-progress-v1",b={best:u.map(()=>0),unlocked:1};try{let t=JSON.parse(localStorage.getItem(N)||"null");if(t&&Array.isArray(t.best)){b.best=u.map((n,o)=>Math.max(0,Math.min(100,Number(t.best[o])||0))),b.unlocked=Math.max(1,Math.min(u.length,Math.floor(Number(t.unlocked)||1)));for(let n=0;n<u.length-1;n++)b.best[n]===100&&(b.unlocked=Math.max(b.unlocked,n+2))}}catch{}we();let g=390,C=598,c=450,w=0,a="ready",j=!0,M=0,q=0,v=0,U=0,B=!0,V=!1,$=0,X=0,G=0,F=[],O=[],se=-1,D=0,ae=0,p={x:112,size:29},K=[],_=9e3,le=285,re=1,d=null,m=null,H=null,I=0,Z=0;function ue(){return d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{}),d}function ge(t){try{ue();let n=d.currentTime,o=d.createOscillator(),i=d.createGain();o.connect(i),i.connect(d.destination);let s=t==="jump"?410:t==="crash"?160:660,l=t==="jump"?590:t==="crash"?48:990,r=t==="crash"?.19:.1;o.type=t==="crash"?"triangle":"sine",o.frequency.setValueAtTime(s,n),o.frequency.exponentialRampToValueAtTime(l,n+r),i.gain.setValueAtTime(1e-4,n),i.gain.exponentialRampToValueAtTime(t==="jump"?.09:.15,n+.008),i.gain.exponentialRampToValueAtTime(1e-4,n+r),o.start(n),o.stop(n+r+.02),o.onended=()=>{o.disconnect(),i.disconnect()}}catch{}}let me=60/128,je=me/4,ce=t=>440*Math.pow(2,(t-69)/12);function J(t,n,o,i,s="triangle",l=2200,r=0,k=.006){let x=d.createOscillator(),A=d.createGain(),P=d.createBiquadFilter();x.type=s,x.frequency.setValueAtTime(t,n),r&&x.frequency.exponentialRampToValueAtTime(r,n+o*.8),P.type="lowpass",P.frequency.value=l,P.Q.value=.6,A.gain.setValueAtTime(1e-4,n),A.gain.exponentialRampToValueAtTime(i,n+k),A.gain.exponentialRampToValueAtTime(1e-4,n+o),x.connect(P),P.connect(A),A.connect(m.bus),m.voices.add(x),x.onended=()=>{m.voices.delete(x),x.disconnect(),P.disconnect(),A.disconnect()},x.start(n),x.stop(n+o+.02)}function xe(t,n,o,i){let s=d.createBufferSource(),l=d.createGain(),r=d.createBiquadFilter();s.buffer=m.noise,r.type="highpass",r.frequency.value=i,l.gain.setValueAtTime(1e-4,t),l.gain.exponentialRampToValueAtTime(o,t+.002),l.gain.exponentialRampToValueAtTime(1e-4,t+n),s.connect(r),r.connect(l),l.connect(m.bus),m.voices.add(s),s.onended=()=>{m.voices.delete(s),s.disconnect(),r.disconnect(),l.disconnect()},s.start(t),s.stop(t+n+.01)}function be(){if(!j||document.hidden||a!=="playing"){W();return}for(;I<d.currentTime+.13;){let t=Z%16,n=Math.floor(Z/16)%4,o=[45,41,48,43][n],i=n===0?[0,3,7,12]:[0,4,7,12];if(t%4===0&&J(145,I,.19,.36,"sine",1200,44),(t===4||t===12)&&(xe(I,.12,.12,1300),J(180,I,.085,.075,"triangle",1600,105)),t%2===0&&xe(I,t===14?.1:.037,t%4===2?.047:.029,6500),(t%4===0||t===7||t===14)&&J(ce(o),I,.2,.13,"sawtooth",650),t%2===0){let s=[0,2,1,3,2,1,2,0][t/2];J(ce(o+24+i[s]),I,.18,.09,"sawtooth",2100)}if(t===0)for(let s of i.slice(0,3))J(ce(o+12+s),I,me*3.8,.018,"triangle",1100,0,.06);Z++,I+=je}}function ee(){if(!(!j||document.hidden||a!=="playing"||H))try{if(ue(),!m){let n=d.createGain();n.gain.value=0,n.connect(d.destination);let o=d.createBuffer(1,Math.ceil(d.sampleRate*.25),d.sampleRate),i=o.getChannelData(0);for(let s=0;s<i.length;s++)i[s]=Math.random()*2-1;m={bus:n,noise:o,voices:new Set}}let t=d.currentTime;m.bus.gain.cancelScheduledValues(t),m.bus.gain.setValueAtTime(0,t),m.bus.gain.linearRampToValueAtTime(.36,t+.16),Z=0,I=t+.025,H=setInterval(be,25),be(),f.dataset.music="playing"}catch{W()}}function W(){if(H&&(clearInterval(H),H=null),m&&d){let t=d.currentTime;m.bus.gain.cancelScheduledValues(t),m.bus.gain.setValueAtTime(m.bus.gain.value,t),m.bus.gain.linearRampToValueAtTime(0,t+.045);for(let n of m.voices)try{n.stop(t+.05)}catch{}}f.dataset.music="stopped"}function we(){try{localStorage.setItem(N,JSON.stringify(b))}catch{}}function de(){return Math.min(100,Math.floor(M/_*100))}function te(){let t=de();t!==se&&(oe.textContent=t+"%",z.style.width=t+"%",se=t),y.textContent="RECORD "+(b.best[w]||0)+"%",f.dataset.progress=String(t),f.dataset.phase=a}function ie(){Me(T,u.map((t,n)=>`<button aria-label="Livello ${n+1}${n>=b.unlocked?" bloccato":""}" ${n>=b.unlocked?"disabled":""} class="${n===w?"selected":""}" data-level="${n}">${n<b.unlocked?n+1:'<span class="lock" aria-hidden="true"></span>'}</button>`).join(""))}function Ae(){let t=u[w];K=[],le=t.speed,_=t.length;let n=600;for(let o=0;n<_-500;o++){let i=t.loopFrom||0,s=o<t.patterns.length?o:i+(o-i)%(t.patterns.length-i),l=E[t.patterns[s]];for(let r of l.objects)K.push({...r,x:n+r.x});n+=Math.round(l.advance*t.spacing)}f.dataset.level=String(w+1),f.dataset.levelCount=String(u.length)}function fe(t=!1){M=0,v=0,q=0,U=0,B=!0,V=!1,$=0,F=[],O=[],X=0,se=-1,a=t?"playing":"ready",S.classList.add("hidden"),L.classList.toggle("hidden",t),Ae(),te(),t?ee():W(),he()}function pe(t,n,o,i=18){for(let s=0;s<i;s++){let l=s/i*Math.PI*2,r=65+Math.random()*180;F.push({x:t,y:n,vx:Math.cos(l)*r,vy:Math.sin(l)*r,color:o,life:.55+Math.random()*.25,size:2+Math.random()*5})}}function ke(){B&&(q=-625,B=!1,$=0,ge("jump"),pe(p.x,c+v,"#64dce8",5))}function ve(){!j||a==="crashed"||a==="complete"||(a==="ready"&&(a="playing",L.classList.add("hidden"),te(),ee()),$=.13,V=!0,B&&ke())}function ne(){V=!1}function Y(t){a==="playing"&&(a=t?"complete":"crashed",V=!1,X=t?.2:.45,W(),b.best[w]=Math.max(b.best[w]||0,t?100:de()),t&&(b.unlocked=Math.max(b.unlocked,Math.min(u.length,w+2))),we(),te(),ie(),ge(t?"win":"crash"),t||(D=.2,pe(p.x+p.size/2,c+v-p.size/2,"#75f2ff",28)))}function ze(){S.classList.remove("hidden"),S.querySelector("h1").textContent=a==="complete"?"Livello completato":"Riprova",S.querySelector("p").textContent=a==="complete"?"100%":de()+"%",S.querySelector("button").textContent=a==="complete"&&w<u.length-1?"Livello successivo":"Riprova"}function ye(){let t=R.getBoundingClientRect(),n=Math.min(devicePixelRatio||1,2);R.width=Math.max(1,Math.round(t.width*n)),R.height=Math.max(1,Math.round(t.height*n)),C=g*(t.height/Math.max(1,t.width)),c=C*.76,e.setTransform(R.width/g,0,0,R.height/C,0,0),he()}function Ce(t){let n=p.x+4,o=p.x+p.size-4,i=c+v-p.size+4,s=c+v-3,l=t.x-M,r=c-(t.lift||0);if(o<=l||n>=l+t.w||s<=r-t.h)return!1;let k=Math.max(l+2,Math.min(l+t.w-2,(n+o)/2)),x=r-t.h*(1-Math.abs((k-(l+t.w/2))/(t.w/2)));return s>x&&i<r}function Ie(t){if(a==="playing"){let n=v;M+=le*t,$=Math.max(0,$-t),q+=2e3*t,v+=q*t,B=!1,v>=0&&(q>0&&n<0&&pe(p.x,c,"#75f2ff",5),v=0,q=0,B=!0,U=Math.round(U/(Math.PI/2))*Math.PI/2);for(let o of K){let i=o.x-M;if(i>g+100||i+o.w<p.x-100)continue;let s=p.x+4,l=p.x+p.size-4,r=v-p.size+4,k=v-3;if(o.kind==="spike")Ce(o)&&Y(!1);else if(o.kind==="saw"){let x=i+o.r,A=-o.lift,P=Math.max(s,Math.min(l,x)),Re=Math.max(r,Math.min(k,A));Math.hypot(x-P,A-Re)<o.r-1&&Y(!1)}else o.kind==="ceiling"?l>i+2&&s<i+o.w-2&&k>-o.lift+2&&r<-o.lift+o.h-2&&Y(!1):l>i&&s<i+o.w&&(n<=-o.h+2&&v>=-o.h&&q>=0?(v=-o.h,q=0,B=!0,U=Math.round(U/(Math.PI/2))*Math.PI/2):k>-o.h&&r<0&&Y(!1))}B&&(V||$>0)&&a==="playing"&&ke(),B||(U+=t*5.5),ae+=t,ae>.025&&(ae=0,O.push({x:p.x+2,y:c+v-p.size/2,life:.25})),M>=_&&Y(!0),te()}else(a==="crashed"||a==="complete")&&S.classList.contains("hidden")&&(X-=t,X<=0&&ze());for(let n of F)n.life-=t,n.x+=n.vx*t,n.y+=n.vy*t,n.vy+=350*t;F=F.filter(n=>n.life>0);for(let n of O)n.life-=t,n.x-=le*t;O=O.filter(n=>n.life>0),D=Math.max(0,D-t)}function Te(t,n,o,i,s){e.beginPath(),e.roundRect(t,n,o,i,s)}function he(){let t=e.createLinearGradient(0,0,0,C);t.addColorStop(0,"#0a1226"),t.addColorStop(1,"#17102a"),e.fillStyle=t,e.fillRect(0,0,g,C),e.save(),D&&e.translate((Math.random()-.5)*D*22,(Math.random()-.5)*D*22);let n=40,o=M*.12%n;e.strokeStyle="#4d8aaf",e.lineWidth=1,e.globalAlpha=.27,e.beginPath();for(let i=-o;i<g;i+=n)e.moveTo(i,0),e.lineTo(i,c);for(let i=0;i<c;i+=n)e.moveTo(0,i),e.lineTo(g,i);e.stroke(),e.strokeStyle="#78b2cf",e.globalAlpha=.1,e.beginPath();for(let i=-(M*.12%(n*4));i<g;i+=n*4)e.moveTo(i,0),e.lineTo(i,c);for(let i=0;i<c;i+=n*4)e.moveTo(0,i),e.lineTo(g,i);e.stroke(),e.globalAlpha=1,e.fillStyle="#0b1525",e.fillRect(0,c,g,C-c),e.strokeStyle="#346b83",e.globalAlpha=.35,e.lineWidth=1,e.beginPath();for(let i=-(M%n);i<g;i+=n)e.moveTo(i,c),e.lineTo(i,C);for(let i=c+32;i<C;i+=32)e.moveTo(0,i),e.lineTo(g,i);e.stroke(),e.globalAlpha=1,e.strokeStyle="#75f2ff",e.lineWidth=2,e.shadowColor="#35d8eb",e.shadowBlur=7,e.beginPath(),e.moveTo(0,c),e.lineTo(g,c),e.stroke(),e.shadowBlur=0;for(let i of K){let s=i.x-M;if(!(s+i.w<-50||s>g+80)){if(e.save(),e.lineWidth=2.5,i.kind==="saw"){e.translate(s+i.r,c-i.lift),e.rotate(M*.018),e.strokeStyle="#ffa766",e.fillStyle="#49253c",e.shadowColor="#f69858",e.shadowBlur=7,e.beginPath();for(let l=0;l<24;l++){let r=l*Math.PI/12,k=l%2?i.r*.72:i.r,x=Math.cos(r)*k,A=Math.sin(r)*k;l?e.lineTo(x,A):e.moveTo(x,A)}e.closePath(),e.fill(),e.stroke(),e.shadowBlur=0,e.beginPath(),e.arc(0,0,7,0,Math.PI*2),e.fillStyle="#111b30",e.fill(),e.stroke()}else if(i.kind==="ceiling"){let l=c-i.lift,r=l+i.h;e.strokeStyle="#ffad79",e.fillStyle="#3d2340",e.shadowColor="#f08b76",e.shadowBlur=6,e.fillRect(s,l,i.w,i.h),e.strokeRect(s,l,i.w,i.h),e.shadowBlur=0,e.strokeStyle="#f6b38b",e.lineWidth=2;for(let k=s+23;k<s+i.w-10;k+=35)e.beginPath(),e.moveTo(k-7,r-20),e.lineTo(k,r-13),e.lineTo(k+7,r-20),e.stroke()}else{if(e.strokeStyle=i.kind==="spike"?"#f478ee":"#6addeb",e.fillStyle=i.kind==="spike"?"#401b4b":"#163644",e.shadowColor=e.strokeStyle,e.shadowBlur=7,e.beginPath(),i.kind==="spike"){let l=c-(i.lift||0);e.moveTo(s,l),e.lineTo(s+i.w/2,l-i.h),e.lineTo(s+i.w,l),e.closePath()}else e.rect(s,c-i.h,i.w,i.h);e.fill(),e.stroke(),e.shadowBlur=0,i.kind==="block"&&(e.strokeStyle="#c2fbff",e.lineWidth=3,e.beginPath(),e.moveTo(s+3,c-i.h),e.lineTo(s+i.w-3,c-i.h),e.stroke())}e.restore()}}if(_-M<g){let i=_-M;e.strokeStyle="#80ffd0",e.setLineDash([7,5]),e.lineWidth=2,e.beginPath(),e.moveTo(i,c-145),e.lineTo(i,c),e.stroke(),e.setLineDash([])}for(let i of O)e.globalAlpha=i.life*1.6,e.fillStyle="#75f2ff",e.fillRect(i.x,i.y,4,4);e.globalAlpha=1,a!=="crashed"&&(e.save(),e.translate(p.x+p.size/2,c+v-p.size/2),e.rotate(U),e.shadowColor="#50f3ff",e.shadowBlur=18,e.fillStyle="#32c6d8",Te(-p.size/2,-p.size/2,p.size,p.size,5),e.fill(),e.strokeStyle="#9cffff",e.lineWidth=2,e.stroke(),e.shadowBlur=0,e.strokeStyle="#e5ffff",e.lineWidth=2,Te(-8,-8,16,16,2),e.stroke(),e.fillStyle="#b3ffff",e.fillRect(-3,-3,6,6),e.restore());for(let i of F)e.globalAlpha=Math.min(1,i.life*2),e.fillStyle=i.color,e.fillRect(i.x,i.y,i.size,i.size);e.globalAlpha=1,e.restore()}f.addEventListener("pointerdown",t=>{t.target.closest("button,.result,.levels")||(t.preventDefault(),f.setPointerCapture(t.pointerId),ve())}),f.addEventListener("pointerup",ne),f.addEventListener("pointercancel",ne),f.addEventListener("lostpointercapture",ne),window.addEventListener("keydown",t=>{(t.code==="Space"||t.code==="ArrowUp")&&(t.preventDefault(),t.repeat||ve())}),window.addEventListener("keyup",t=>{(t.code==="Space"||t.code==="ArrowUp")&&ne()}),T.addEventListener("click",t=>{let n=t.target.closest("[data-level]");!n||n.disabled||(w=Number(n.dataset.level),re=1,ie(),fe())}),S.querySelector("button").addEventListener("click",()=>{a==="complete"&&w<u.length-1?(w++,re=1,ie()):re++,fe(!0)}),window.addEventListener("message",t=>{var n;t.source===parent&&((n=t.data)==null?void 0:n.type)==="playable-active"&&(j=!!t.data.active,j?a==="playing"&&d&&ee():(V=!1,W()),G=0)}),document.addEventListener("visibilitychange",()=>{G=0,V=!1,document.hidden?W():j&&a==="playing"&&d&&ee()}),window.addEventListener("pagehide",W),window.addEventListener("resize",ye);function Se(t){let n=G?Math.min((t-G)/1e3,.035):0;if(G=t,j&&!document.hidden){let o=n;for(;o>0;){let i=Math.min(o,.008333333333333333);Ie(i),o-=i}he()}requestAnimationFrame(Se)}ie(),fe(),ye(),requestAnimationFrame(Se)})();(()=>{let h=document.createElement("style");h.dataset.batch3Ui="20261116",h.textContent=`
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
`,document.head.append(h)})();})();
