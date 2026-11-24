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

(()=>{function pe(s,j){if(!s)throw new Error("Game mount target is missing");let f=String(j??""),T=b=>b.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(x,g)=>{if(g[0]==="#"){let p=g[1].toLowerCase()==="x",u=parseInt(g.slice(p?2:1),p?16:10);return u>0&&u<=1114111?String.fromCodePoint(u):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[g.toLowerCase()]||x});for(;s.firstChild;)s.removeChild(s.firstChild);let y=[{element:s,tag:"",svg:s.namespaceURI==="http://www.w3.org/2000/svg"}],O=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,h=0;for(;h<f.length;){if(f.startsWith("<!--",h)){let c=f.indexOf("-->",h+4);h=c<0?f.length:c+3;continue}if(f[h]!=="<"){let c=f.indexOf("<",h),I=c<0?f.length:c;y[y.length-1].element.appendChild(document.createTextNode(T(f.slice(h,I)))),h=I;continue}let b=h+1,x="";for(;b<f.length;b++){let c=f[b];if(x)c===x&&(x="");else if(c==='"'||c==="'")x=c;else if(c===">")break}if(b>=f.length)throw new Error("Incomplete game markup");let g=f.slice(h+1,b);if(h=b+1,/^\s*!/.test(g))continue;let p=/^\s*\/\s*([\w:-]+)/.exec(g);if(p){for(let c=y.length-1;c>0;c--)if(y[c].tag.toLowerCase()===p[1].toLowerCase()){y.length=c;break}continue}let u=/^\s*([\w:-]+)/.exec(g);if(!u)throw new Error("Invalid game markup");let z=u[1],d=y[y.length-1],A=z.toLowerCase()==="svg"||d.svg&&d.tag.toLowerCase()!=="foreignobject",v=A?document.createElementNS("http://www.w3.org/2000/svg",z):document.createElement(z),P=g.slice(u[0].length).replace(/\/\s*$/,""),$=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,w;for(;w=$.exec(P);){let c=w[1],I=T(w[2]??w[3]??w[4]??"");v.setAttribute(c,I)}d.element.appendChild(v),!O.test(z)&&!/\/\s*$/.test(g)&&y.push({element:v,tag:z,svg:A})}return f}document.documentElement.lang="it";(()=>{"use strict";let s=document.getElementById("root"),j=(e,t,n)=>Math.max(t,Math.min(n,e)),f=(e,t)=>e+Math.random()*(t-e),T=e=>e[Math.floor(Math.random()*e.length)],y=e=>e[e.length-1],O=e=>{for(let t=e.length-1;t>0;t--){let n=Math.floor(Math.random()*(t+1));[e[t],e[n]]=[e[n],e[t]]}return e},h=[],b=[],x=!0,g=!1,p;function u(e,t,n,o){e.addEventListener(t,n,o),h.push(()=>e.removeEventListener(t,n,o))}function z(e,t,n="#faf8f1"){let o=document.createElement("style");o.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(o),s.style.background=n,pe(s,'<div class="fit">'+t+"</div>");let i=s.querySelector(".fit");function a(){let r=s.getBoundingClientRect(),l=Math.min(r.width/390,r.height/598);i.style.transform=`translate(${(r.width-390*l)/2}px,${(r.height-598*l)/2}px) scale(${l})`,s.dataset.layout=`${Math.round(r.width)}x${Math.round(r.height)}`}a(),u(window,"resize",a)}function d(e){return s.querySelector(e)}function A(){var e;(e=d(".guide"))==null||e.classList.add("gone")}function v(e){s.dataset.phase=e}function P(){$(),A()}function $(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function w(e=450,t=.08,n=.18,o="sine",i=0){if(!(!p||!x))try{let a=p.createOscillator(),r=p.createGain(),l=p.currentTime;a.type=o,a.frequency.setValueAtTime(e,l),i&&a.frequency.exponentialRampToValueAtTime(Math.max(30,i),l+t),r.gain.setValueAtTime(.001,l),r.gain.exponentialRampToValueAtTime(n,l+.006),r.gain.exponentialRampToValueAtTime(.001,l+t),a.connect(r),r.connect(p.destination),a.start(l),a.stop(l+t+.02),a.onended=()=>{a.disconnect(),r.disconnect()}}catch{}}function c(){w(523,.12,.18),setTimeout(()=>w(784,.17,.16),100)}function I(){w(180,.22,.18,"triangle",65)}function D(e){let t=0;function n(o){if(g)return;let i=Math.min(.035,(o-(t||o))/1e3);t=o,document.hidden||e(x?i:0,o/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function K(){let e=d("canvas.stage"),t=e.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return e.width=390*n,e.height=598*n,t.scale(n,n),{canvas:e,ctx:t}}function ce(e,t=d("canvas.stage")){let n=t.getBoundingClientRect();return{x:(e.clientX-n.left)*390/n.width,y:(e.clientY-n.top)*598/n.height}}function H(e,t,n,o,i,a){a=Math.min(Math.abs(o)/2,Math.abs(i)/2,a),e.moveTo(t+a,n),e.lineTo(t+o-a,n),e.quadraticCurveTo(t+o,n,t+o,n+a),e.lineTo(t+o,n+i-a),e.quadraticCurveTo(t+o,n+i,t+o-a,n+i),e.lineTo(t+a,n+i),e.quadraticCurveTo(t,n+i,t,n+i-a),e.lineTo(t,n+a),e.quadraticCurveTo(t,n,t+a,n),e.closePath()}function de(e,t,n,o,i,a,r,l){e.beginPath(),H(e,t,n,o,i,a),r&&(e.fillStyle=r,e.fill()),l&&(e.strokeStyle=l,e.stroke())}function F(e,t,n,o,i,a){e.beginPath(),e.arc(t,n,Math.max(.01,o),0,Math.PI*2),i&&(e.fillStyle=i,e.fill()),a&&(e.strokeStyle=a,e.stroke())}function ue(e,t,n,o,i,a,r=2){e.beginPath(),e.moveTo(t,n),e.lineTo(o,i),e.strokeStyle=a,e.lineWidth=r,e.stroke()}function N(e,t,n,o,i=18,a="#25252a",r="UIBody",l="center"){e.font=`700 ${i}px ${r}`,e.fillStyle=a,e.textAlign=l,e.textBaseline="middle",e.fillText(t,n,o)}let V=[];function B(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(U(t,e))}function fe(e){let t=new Image;return t.onerror=()=>{s.dataset.assetIssue="image"},t.src=B(e),V.push({im:t,path:e}),t}function X(e,t,n,o,i,a){if(!t||!t.width)return;let r=t.videoWidth||t.width,l=t.videoHeight||t.height;if(!r||!l)return;let q=Math.max(i/r,a/l);e.save(),e.beginPath(),e.rect(n,o,i,a),e.clip(),e.drawImage(t,n+(i-r*q)/2,o+(a-l*q)/2,r*q,l*q),e.restore()}function Y(e,t,n,o,i){e.save(),e.beginPath(),e.arc(n,o,i,0,Math.PI*2),e.clip(),X(e,t,n-i,o-i,i*2,i*2),e.restore()}function Z(e,t,n,o){let i=d(".modal");if(!i)return;i.hidden=!1,i.querySelector("h2").textContent=e,i.querySelector(".value").textContent=t,i.querySelector("p").textContent=n;let a=i.querySelector("button");a.onclick=()=>{i.hidden=!0,P(),o()},v("result")}function J(e="Gioca ancora"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function he(){let e=d(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let ee=[];function _(e){x=e,e||p==null||p.suspend().catch(()=>{});for(let t of ee)t(e)}u(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&_(e.data.active===!0)}),u(document,"visibilitychange",()=>{_(!document.hidden)}),u(window,"pagehide",()=>{g=!0,h.splice(0).forEach(e=>e()),b.splice(0).forEach(e=>e()),p==null||p.close().catch(()=>{})});let G={};function U(e,t){return G[e]??t}async function te(e=()=>{}){let t=new AbortController,n=setTimeout(()=>t.abort(),1600);try{let o=await fetch("./game.config.json",{signal:t.signal});if(!o.ok)throw Error("Configurazione non disponibile");let i=await o.json();for(let a of["texts","tweaks","images"])for(let r of i[a]||[])G[r.id]=a==="images"?r.path:r.value;for(let a of V){let r=B(a.path);a.im.getAttribute("src")!==r&&(a.im.src=r)}for(let a of s.querySelectorAll('img[src^="./assets/"]'))a.src=B(a.getAttribute("src"));e(),s.dataset.config="loaded"}catch{s.dataset.config="defaults"}finally{clearTimeout(n)}}let m=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],W=()=>{};function ne(){var t;function e(n){m=n.slice(0,24).map(o=>({nickname:String(o.nickname||"Amico"),avatar:o.avatar,image:null}));for(let o of m){let i;try{i=new Image,i.onload=()=>{o.image=i,W()},i.onerror=()=>{o.image=null},i.src=o.avatar}catch{o.image=null}}W()}e(m),s.dataset.friends="sample",typeof((t=window.tt)==null?void 0:t.getFriendsInfo)=="function"&&window.tt.getFriendsInfo({success(n){let o=Array.isArray(n==null?void 0:n.friends)?n.friends.filter(i=>i&&typeof i.avatar=="string"):[];o.length&&(e(o),s.dataset.friends="host")},fail(){s.dataset.friends="sample"}})}function oe(e,t,n,o,i,a="#fff"){let r=m[(t%m.length+m.length)%m.length];e.save(),e.shadowColor="#25212d20",e.shadowBlur=6,F(e,n,o,i,a),e.shadowBlur=0,r!=null&&r.image?Y(e,r.image,n,o,Math.max(1,i-2)):(F(e,n,o,Math.max(1,i-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][t%4]),N(e,Array.from((r==null?void 0:r.nickname)||"?")[0],n,o,i*.7,"#fff")),e.restore()}function Q(e){var t;return((t=m[(e%m.length+m.length)%m.length])==null?void 0:t.nickname)||"Amico"}function ie(e,t,n,o,i=13){N(e,Array.from(Q(t)).slice(0,15).join(""),n,o,i)}ne();function ae(){let e=d(".fit"),t=d(".modal"),n="#e5ddef";s.classList.add("printed-paper"),s.style.position="relative",s.style.isolation="isolate",document.body.style.backgroundColor=n,s.style.backgroundColor=n,e.style.background="transparent",e.style.zIndex="1",t&&s.append(t);let o=document.createElement("style");o.textContent=`#root.printed-paper{color:#282723}
 #root.printed-paper .fit{background:transparent}
 #root.printed-paper .guide,#root.printed-paper .hud,#root.printed-paper .count,#root.printed-paper .question,#root.printed-paper .next,#root.printed-paper .round{color:#282723}
 #root.printed-paper .pill,#root.printed-paper .tilt-enable{background:#fffbee;color:#282723;border:2px solid #282723;border-radius:10px;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper .bottom .reset{background:#fffbee;color:#282723;border:2px solid #282723;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper>.modal{z-index:30;background:#28272345}
 #root.printed-paper>.modal>.result{width:320px;max-width:320px;max-height:var(--paper-result-height);transform:scale(var(--paper-scale));background:#fffbee;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272333}
 #root.printed-paper .result h2,#root.printed-paper .result .value{color:#282723}
 #root.printed-paper .answers button{background:#fffbee;color:#282723;border:2px solid #282723;border-radius:10px;box-shadow:2px 3px 0 #28272326}
 #root.printed-paper .card{border:2px solid #282723;box-shadow:3px 4px 0 #28272326}
 #root.printed-paper .award-label,#root.printed-paper .award-title,#root.printed-paper .award-sub{color:#51463c}`,document.head.append(o),b.push(()=>o.remove());function i(){let a=s.getBoundingClientRect();if(!a.width||!a.height)return;let r=Math.min(a.width/390,a.height/598),l=(a.width-390*r)/2,q=(a.height-598*r)/2;e.style.transform=`translate(${l}px,${q}px) scale(${r})`;let le=String(U("PAPER_BACKDROP","./assets/paper-print-v1.svg"));s.style.backgroundImage=`url("${le.replace(/"/g,"%22")}")`,s.style.backgroundRepeat="repeat",s.style.backgroundSize=`${256*r}px ${256*r}px`,s.style.setProperty("--paper-scale",String(r)),s.style.setProperty("--paper-result-height",`${Math.max(220,a.height/r-80)}px`),t&&(t.style.padding=`${30*r}px ${30*r}px ${50*r}px`)}if(i(),u(window,"resize",i),typeof ResizeObserver<"u"){let a=new ResizeObserver(i);a.observe(s),b.push(()=>a.disconnect())}return i}z(".fit{background:transparent}.guide{top:60px;font-size:16px;color:#68627b}.subject{position:absolute;left:125px;top:110px;width:140px;height:113px;cursor:pointer}.question{position:absolute;top:263px;left:34px;right:34px;text-align:center;font-size:20px;font-weight:700;line-height:1.4}.answers{position:absolute;top:348px;left:35px;right:35px;display:grid;gap:14px}.answers button{min-height:62px;background:#fff;border-radius:17px;box-shadow:0 3px #d2cadd;font-size:15px;font-weight:700;padding:12px 20px}.count{position:absolute;top:32px;right:30px;font-size:13px;color:#8c849e}.result{background:#fff;border-radius:22px}.result .value{font-size:28px;color:#74649a}.traits{display:grid;gap:7px;text-align:left;font-size:12px}.traits div{display:grid;grid-template-columns:90px 1fr;align-items:center;gap:10px}.traits i{height:7px;background:#b5a2d8;border-radius:10px}",`<canvas class="stage" aria-label="Quiz sulla personalit\xE0 degli amici"></canvas><div class="count">1 / 6</div><div class="guide">Quanto conosci questa persona?</div><button class="subject" aria-label="Scegli un altro amico di esempio" style="background:transparent"></button><div class="question"></div><div class="answers"><button data-answer="0"></button><button data-answer="1"></button></div>${J("Prova con un altro amico")}`,"#e5ddef");let re=ae(),{ctx:E}=K(),C=0,k=0,S=[0,0,0,0],M=[["Com\u2019\xE8 il suo weekend ideale?","Un\u2019avventura improvvisata","Una giornata tranquilla in casa",0,1],["Il suo superpotere nella chat?","Fa ridere tutti","Organizza i programmi",2,3],["Un giorno libero inatteso. Che fa?","Prova un posto nuovo","Si dedica al suo hobby preferito",0,1],["A una festa, cosa fa?","Racconta la storia migliore","Fa sentire tutti a proprio agio",2,3],["La sua galleria \xE8 piena di\u2026","Luoghi da esplorare","Piccole cose che fanno sorridere",0,1],["Un amico \xE8 gi\xF9. Come reagisce?","Invia un meme esilarante","Organizza qualcosa di speciale",2,3]],L=[["L\u2019avventuriero","Uno spirito curioso che trasforma ogni \xABperch\xE9 no?\xBB in un piano.","Spontaneit\xE0 \xB7 curiosit\xE0 \xB7 generosit\xE0"],["Il sognatore","Nota i piccoli dettagli e rende speciali i giorni normali.","Riflessione \xB7 fantasia \xB7 dolcezza"],["La scintilla","La battuta pronta e l\u2019energia che accende la stanza.","Gioco \xB7 espressivit\xE0 \xB7 carisma"],["Il punto fermo","Affidabile e premuroso, c\u2019\xE8 sempre quando serve.","Affidabilit\xE0 \xB7 cura \xB7 determinazione"]];function R(){let e=M[k];d(".question").textContent=e[0],s.querySelectorAll(".answers button").forEach((t,n)=>t.textContent=e[n+1]),d(".count").textContent=k+1+" / "+M.length,s.dataset.question=k+1}function se(){C=(C+1)%m.length,k=0,S=[0,0,0,0],v("ready"),R()}u(d(".subject"),"click",()=>{k||(C=(C+1)%m.length)}),s.querySelectorAll(".answers button").forEach(e=>u(e,"click",()=>{P();let t=Number(e.dataset.answer);if(S[M[k][t+3]]++,w(560,.06,.12),k++,k===M.length){let n=Math.max(...S),o=S.indexOf(n);Z(Q(C),L[o][0],L[o][1]+" "+L[o][2],se),c()}else v("playing"),R()})),R(),v("ready"),D(()=>{E.clearRect(0,0,390,598),oe(E,C,195,170,37,"#8874b0"),ie(E,C,195,227,14)}),te(()=>{re(),d(".guide")&&(d(".guide").textContent=String(U("GUIDE","Quanto conosci questa persona?")))})})();(()=>{let s=document.createElement("style");s.dataset.batch3Ui="20261116",s.textContent=`
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

.count{top:30px;left:30px;right:30px;text-align:center;font:600 28px/1.2 Playful,UIBody,sans-serif;color:#6c5c87}
.guide{top:90px;font-size:18px;color:#5e5276}
.subject{top:130px}.question{font:600 24px/1.35 Playful,UIBody,sans-serif;top:263px}
.answers button{font-size:16px;line-height:1.4;min-height:64px;padding:12px 18px}
.traits{font-size:14px;line-height:1.4}.traits div{grid-template-columns:110px 1fr}
`,document.head.append(s)})();})();
