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

(()=>{function xe(r,X){if(!r)throw new Error("Game mount target is missing");let m=String(X??""),F=x=>x.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(k,y)=>{if(y[0]==="#"){let c=y[1].toLowerCase()==="x",g=parseInt(y.slice(c?2:1),c?16:10);return g>0&&g<=1114111?String.fromCodePoint(g):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[y.toLowerCase()]||k});for(;r.firstChild;)r.removeChild(r.firstChild);let C=[{element:r,tag:"",svg:r.namespaceURI==="http://www.w3.org/2000/svg"}],Y=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,b=0;for(;b<m.length;){if(m.startsWith("<!--",b)){let u=m.indexOf("-->",b+4);b=u<0?m.length:u+3;continue}if(m[b]!=="<"){let u=m.indexOf("<",b),S=u<0?m.length:u;C[C.length-1].element.appendChild(document.createTextNode(F(m.slice(b,S)))),b=S;continue}let x=b+1,k="";for(;x<m.length;x++){let u=m[x];if(k)u===k&&(k="");else if(u==='"'||u==="'")k=u;else if(u===">")break}if(x>=m.length)throw new Error("Incomplete game markup");let y=m.slice(b+1,x);if(b=x+1,/^\s*!/.test(y))continue;let c=/^\s*\/\s*([\w:-]+)/.exec(y);if(c){for(let u=C.length-1;u>0;u--)if(C[u].tag.toLowerCase()===c[1].toLowerCase()){C.length=u;break}continue}let g=/^\s*([\w:-]+)/.exec(y);if(!g)throw new Error("Invalid game markup");let P=g[1],h=C[C.length-1],U=P.toLowerCase()==="svg"||h.svg&&h.tag.toLowerCase()!=="foreignobject",T=U?document.createElementNS("http://www.w3.org/2000/svg",P):document.createElement(P),q=y.slice(g[0].length).replace(/\/\s*$/,""),W=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,z;for(;z=W.exec(q);){let u=z[1],S=F(z[2]??z[3]??z[4]??"");T.setAttribute(u,S)}h.element.appendChild(T),!Y.test(P)&&!/\/\s*$/.test(y)&&C.push({element:T,tag:P,svg:U})}return m}document.documentElement.lang="it";(()=>{"use strict";let r=document.getElementById("root"),X=(e,t,n)=>Math.max(t,Math.min(n,e)),m=(e,t)=>e+Math.random()*(t-e),F=e=>e[Math.floor(Math.random()*e.length)],C=e=>e[e.length-1],Y=e=>{for(let t=e.length-1;t>0;t--){let n=Math.floor(Math.random()*(t+1));[e[t],e[n]]=[e[n],e[t]]}return e},b=[],x=[],k=!0,y=!1,c;function g(e,t,n,o){e.addEventListener(t,n,o),b.push(()=>e.removeEventListener(t,n,o))}function P(e,t,n="#faf8f1"){let o=document.createElement("style");o.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(o),r.style.background=n,xe(r,'<div class="fit">'+t+"</div>");let i=r.querySelector(".fit");function a(){let s=r.getBoundingClientRect(),l=Math.min(s.width/390,s.height/598);i.style.transform=`translate(${(s.width-390*l)/2}px,${(s.height-598*l)/2}px) scale(${l})`,r.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}a(),g(window,"resize",a)}function h(e){return r.querySelector(e)}function U(){var e;(e=h(".guide"))==null||e.classList.add("gone")}function T(e){r.dataset.phase=e}function q(){W(),U()}function W(){try{c||(c=new(window.AudioContext||window.webkitAudioContext)),c.state==="suspended"&&c.resume().catch(()=>{})}catch{}}function z(e=450,t=.08,n=.18,o="sine",i=0){if(!(!c||!k))try{let a=c.createOscillator(),s=c.createGain(),l=c.currentTime;a.type=o,a.frequency.setValueAtTime(e,l),i&&a.frequency.exponentialRampToValueAtTime(Math.max(30,i),l+t),s.gain.setValueAtTime(.001,l),s.gain.exponentialRampToValueAtTime(n,l+.006),s.gain.exponentialRampToValueAtTime(.001,l+t),a.connect(s),s.connect(c.destination),a.start(l),a.stop(l+t+.02),a.onended=()=>{a.disconnect(),s.disconnect()}}catch{}}function u(){z(523,.12,.18),setTimeout(()=>z(784,.17,.16),100)}function S(){z(180,.22,.18,"triangle",65)}function ie(e){let t=0;function n(o){if(y)return;let i=Math.min(.035,(o-(t||o))/1e3);t=o,document.hidden||e(k?i:0,o/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function ae(){let e=h("canvas.stage"),t=e.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return e.width=390*n,e.height=598*n,t.scale(n,n),{canvas:e,ctx:t}}function se(e,t=h("canvas.stage")){let n=t.getBoundingClientRect();return{x:(e.clientX-n.left)*390/n.width,y:(e.clientY-n.top)*598/n.height}}function re(e,t,n,o,i,a){a=Math.min(Math.abs(o)/2,Math.abs(i)/2,a),e.moveTo(t+a,n),e.lineTo(t+o-a,n),e.quadraticCurveTo(t+o,n,t+o,n+a),e.lineTo(t+o,n+i-a),e.quadraticCurveTo(t+o,n+i,t+o-a,n+i),e.lineTo(t+a,n+i),e.quadraticCurveTo(t,n+i,t,n+i-a),e.lineTo(t,n+a),e.quadraticCurveTo(t,n,t+a,n),e.closePath()}function le(e,t,n,o,i,a,s,l){e.beginPath(),re(e,t,n,o,i,a),s&&(e.fillStyle=s,e.fill()),l&&(e.strokeStyle=l,e.stroke())}function $(e,t,n,o,i,a){e.beginPath(),e.arc(t,n,Math.max(.01,o),0,Math.PI*2),i&&(e.fillStyle=i,e.fill()),a&&(e.strokeStyle=a,e.stroke())}function ve(e,t,n,o,i,a,s=2){e.beginPath(),e.moveTo(t,n),e.lineTo(o,i),e.strokeStyle=a,e.lineWidth=s,e.stroke()}function L(e,t,n,o,i=18,a="#25252a",s="UIBody",l="center"){e.font=`700 ${i}px ${s}`,e.fillStyle=a,e.textAlign=l,e.textBaseline="middle",e.fillText(t,n,o)}let Z=[];function V(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(_(t,e))}function ke(e){let t=new Image;return t.onerror=()=>{r.dataset.assetIssue="image"},t.src=V(e),Z.push({im:t,path:e}),t}function fe(e,t,n,o,i,a){if(!t||!t.width)return;let s=t.videoWidth||t.width,l=t.videoHeight||t.height;if(!s||!l)return;let w=Math.max(i/s,a/l);e.save(),e.beginPath(),e.rect(n,o,i,a),e.clip(),e.drawImage(t,n+(i-s*w)/2,o+(a-l*w)/2,s*w,l*w),e.restore()}function ce(e,t,n,o,i){e.save(),e.beginPath(),e.arc(n,o,i,0,Math.PI*2),e.clip(),fe(e,t,n-i,o-i,i*2,i*2),e.restore()}function J(e,t,n,o){let i=h(".modal");if(!i)return;i.hidden=!1,i.querySelector("h2").textContent=e,i.querySelector(".value").textContent=t,i.querySelector("p").textContent=n;let a=i.querySelector("button");a.onclick=()=>{i.hidden=!0,q(),o()},T("result")}function ue(e="Gioca ancora"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function ze(){let e=h(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let de=[];function Q(e){k=e,e||c==null||c.suspend().catch(()=>{});for(let t of de)t(e)}g(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&Q(e.data.active===!0)}),g(document,"visibilitychange",()=>{Q(!document.hidden)}),g(window,"pagehide",()=>{y=!0,b.splice(0).forEach(e=>e()),x.splice(0).forEach(e=>e()),c==null||c.close().catch(()=>{})});let ee={};function _(e,t){return ee[e]??t}async function pe(e=()=>{}){let t=new AbortController,n=setTimeout(()=>t.abort(),1600);try{let o=await fetch("./game.config.json",{signal:t.signal});if(!o.ok)throw Error("Configurazione non disponibile");let i=await o.json();for(let a of["texts","tweaks","images"])for(let s of i[a]||[])ee[s.id]=a==="images"?s.path:s.value;for(let a of Z){let s=V(a.path);a.im.getAttribute("src")!==s&&(a.im.src=s)}for(let a of r.querySelectorAll('img[src^="./assets/"]'))a.src=V(a.getAttribute("src"));e(),r.dataset.config="loaded"}catch{r.dataset.config="defaults"}finally{clearTimeout(n)}}let v=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],te=()=>{};function he(){var t;function e(n){v=n.slice(0,24).map(o=>({nickname:String(o.nickname||"Amico"),avatar:o.avatar,image:null}));for(let o of v){let i;try{i=new Image,i.onload=()=>{o.image=i,te()},i.onerror=()=>{o.image=null},i.src=o.avatar}catch{o.image=null}}te()}e(v),r.dataset.friends="sample",typeof((t=window.tt)==null?void 0:t.getFriendsInfo)=="function"&&window.tt.getFriendsInfo({success(n){let o=Array.isArray(n==null?void 0:n.friends)?n.friends.filter(i=>i&&typeof i.avatar=="string"):[];o.length&&(e(o),r.dataset.friends="host")},fail(){r.dataset.friends="sample"}})}function N(e,t,n,o,i,a="#fff"){let s=v[(t%v.length+v.length)%v.length];e.save(),e.shadowColor="#25212d20",e.shadowBlur=6,$(e,n,o,i,a),e.shadowBlur=0,s!=null&&s.image?ce(e,s.image,n,o,Math.max(1,i-2)):($(e,n,o,Math.max(1,i-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][t%4]),L(e,Array.from((s==null?void 0:s.nickname)||"?")[0],n,o,i*.7,"#fff")),e.restore()}function G(e){var t;return((t=v[(e%v.length+v.length)%v.length])==null?void 0:t.nickname)||"Amico"}function Ce(e,t,n,o,i=13){L(e,Array.from(G(t)).slice(0,15).join(""),n,o,i)}he(),P(".fit{background:#94bedb}.instruction-stack{position:absolute;top:94px;left:30px;right:30px;display:flex;flex-direction:column;gap:8px;text-align:center;pointer-events:none;z-index:9}.instruction-stack .guide{position:static;margin:0;font-size:18px;line-height:1.25;font-family:Playful,Arial}.instruction-stack .turn{position:static;margin:0;font-size:14px;line-height:1.3;min-height:1.3em;font-weight:700;color:#20252a}.pill{border-radius:6px;border:2.5px solid #20252a;box-shadow:3px 4px #36556b66;background:transparent;color:#20252a}.result{border:2.5px solid #20252a;border-radius:8px;background:#fffdf7;box-shadow:5px 6px #36556b66}.result .value{font-size:28px}.result .pill{background:#94bedb}",`<canvas class="stage" aria-label="Tabellone di Forza quattro"></canvas><div class="instruction-stack"><div class="guide">Fai cadere la foto e allineane quattro</div><div class="turn">Tocca a te</div></div><div class="bottom"><button class="pill reset">Nuova partita</button></div>${ue()}`,"#94bedb");function ge(e){let t=h(".fit"),n=h(".modal");n&&(n.classList.add("host-modal"),r.append(n));let o=document.createElement("style");o.textContent="#root{position:relative;isolation:isolate;color:#20252a}#root>.fit{z-index:1;background:transparent}#root .pill,#root .palette{border-color:#20252a;color:#20252a}#root .pill{box-shadow:3px 4px 0 #36556b66;font-family:Playful,UIBody,sans-serif;font-size:18px}#root>.host-modal{position:absolute;inset:0;z-index:30;display:block;padding:0;background:#20252a38}#root>.host-modal>.result{position:absolute;left:50%;top:calc(50% - var(--modal-shift,10px));width:320px;max-width:none;max-height:518px;overflow-y:auto;transform:translate(-50%,-50%) scale(var(--game-fit-scale,1));transform-origin:center}",document.head.append(o);function i(){let a=r.getBoundingClientRect(),s=Math.min(a.width/390,a.height/598),l=(a.width-390*s)/2,w=(a.height-598*s)/2;t.style.transform=`translate(${l}px,${w}px) scale(${s})`,r.style.setProperty("--game-fit-scale",String(s)),r.style.setProperty("--modal-shift",`${10*s}px`),e==="felt"?(r.style.backgroundImage=`radial-gradient(circle ${380*s}px at ${l+195*s}px ${w+280*s}px, #36674f88 ${50*s}px, #102e2244 ${380*s}px)`,r.style.backgroundRepeat="no-repeat",r.style.backgroundSize="auto",r.style.backgroundPosition="0 0"):(r.style.backgroundImage=`url("${String(_("PAPER_BACKDROP","./assets/paper-print-v1.svg"))}")`,r.style.backgroundRepeat="repeat",r.style.backgroundSize=`${256*s}px ${256*s}px`,r.style.backgroundPosition=`${l}px ${w}px`)}if(i(),g(window,"resize",i),typeof ResizeObserver=="function"){let a=new ResizeObserver(i);a.observe(r),x.push(()=>a.disconnect())}return i}let me=ge("paper"),{canvas:be,ctx:f}=ae(),d=Array.from({length:6},()=>Array(7).fill(0)),I=1,M="ready",p=null,H=[],B=0,A=45,D=37.5,E=181;function K(e,t){for(let n=0;n<6;n++)for(let o=0;o<7;o++)for(let[i,a]of[[1,0],[0,1],[1,1],[1,-1]]){let s=[];for(let l=0;l<4;l++){let w=n+i*l,O=o+a*l;if(w<0||w>=6||O<0||O>=7||e[w][O]!==t)break;s.push([w,O])}if(s.length===4)return s}return null}function R(e,t){for(let n=5;n>=0;n--)if(!e[n][t])return n;return-1}function ye(){let e=[3,2,4,1,5,0,6].filter(o=>R(d,o)>=0);for(let o of[2,1])for(let i of e){let a=R(d,i);d[a][i]=o;let s=K(d,o);if(d[a][i]=0,s)return i}let t=-1/0,n=e[0];for(let o of e){let i=R(d,o);d[i][o]=2;let a=4-Math.abs(3-o);for(let s of e){let l=R(d,s);l<0||(d[l][s]=1,K(d,1)&&(a-=100),d[l][s]=0)}d[i][o]=0,a>t&&(t=a,n=o)}return n}function j(){d=Array.from({length:6},()=>Array(7).fill(0)),I=1,M="ready",p=null,B=0,H=[],h(".turn").textContent="Tocca a te",T("ready")}function ne(e,t){let n=R(d,e);n<0||M==="result"||p||(p={col:e,row:n,who:t,y:E-35,vy:0},q(),M="playing",T("playing"))}function we(){let e=p;d[e.row][e.col]=e.who,p=null,z(330,.07,.16,"triangle");let t=K(d,e.who);if(t){H=t,M="result",e.who===1?u():S(),J(e.who===1?"Hai fatto quattro in fila!":G(1)+" vince","4 in fila","Un\u2019altra partita?",j);return}if(d.every(n=>n.every(Boolean))){M="result",J("Pareggio perfetto","Pareggio","Ancora una?",j);return}I=e.who===1?2:1,h(".turn").textContent=I===1?"Tocca a te":G(1)+" sta pensando\u2026",I===2&&(B=.45),r.dataset.turn=I}g(be,"pointerdown",e=>{let t=se(e);if(I!==1||p||t.y<E||t.y>E+270)return;let n=Math.floor((t.x-D)/A);n>=0&&n<7&&ne(n,1)}),g(h(".reset"),"click",()=>{q(),j()}),j();function oe(e,t,n){N(f,e-1,t,n,18,e===1?"#fffdf7":"#20252a"),f.save(),f.lineWidth=1.4,$(f,t,n,18,null,"#20252a"),f.restore()}ie(e=>{if(B>0&&(B-=e,B<=0&&I===2&&M!=="result"&&ne(ye(),2)),p){p.vy+=1500*e,p.y+=p.vy*e;let t=E+p.row*A+A/2;p.y>=t&&(p.y=t,we())}f.clearRect(0,0,390,598),N(f,0,65,67,20,"#20252a"),N(f,1,325,67,20,"#20252a"),L(f,"TU",99,67,13,"#20252a","Playful","left"),L(f,"VS",195,67,15,"#20252a","Playful"),f.save(),f.lineWidth=2.5,f.shadowColor="#36556b66",f.shadowOffsetX=5,f.shadowOffsetY=6,le(f,30,174,330,284,6,"#fffdf7","#20252a"),f.restore();for(let t=0;t<6;t++)for(let n=0;n<7;n++){let o=D+n*A+A/2,i=E+t*A+A/2;f.save(),f.globalCompositeOperation="destination-out",$(f,o,i,18,"#000"),f.restore(),f.save(),f.lineWidth=1.6,$(f,o,i,18,null,"#20252a"),f.restore(),d[t][n]&&oe(d[t][n],o,i),H.some(([a,s])=>a===t&&s===n)&&(f.save(),f.lineWidth=2.8,$(f,o,i,21,null,"#20252a"),f.restore())}p&&oe(p.who,D+p.col*A+A/2,p.y)}),pe(()=>{me(),h(".guide")&&(h(".guide").textContent=String(_("GUIDE","Fai cadere la foto e allineane quattro")))})})();(()=>{let r=document.createElement("style");r.dataset.batch3Ui="20261116",r.textContent=`
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
.guide{font-size:18px}.turn{font-size:14px;line-height:1.4;top:143px}.pill{min-height:44px;font-size:16px}.bottom{bottom:54px}`,document.head.append(r)})();})();
