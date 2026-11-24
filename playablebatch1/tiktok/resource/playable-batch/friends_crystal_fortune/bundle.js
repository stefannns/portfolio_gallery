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

(()=>{function Be(r,F){if(!r)throw new Error("Game mount target is missing");let g=String(F??""),$=v=>v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(w,b)=>{if(b[0]==="#"){let d=b[1].toLowerCase()==="x",h=parseInt(b.slice(d?2:1),d?16:10);return h>0&&h<=1114111?String.fromCodePoint(h):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[b.toLowerCase()]||w});for(;r.firstChild;)r.removeChild(r.firstChild);let z=[{element:r,tag:"",svg:r.namespaceURI==="http://www.w3.org/2000/svg"}],Q=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,m=0;for(;m<g.length;){if(g.startsWith("<!--",m)){let p=g.indexOf("-->",m+4);m=p<0?g.length:p+3;continue}if(g[m]!=="<"){let p=g.indexOf("<",m),U=p<0?g.length:p;z[z.length-1].element.appendChild(document.createTextNode($(g.slice(m,U)))),m=U;continue}let v=m+1,w="";for(;v<g.length;v++){let p=g[v];if(w)p===w&&(w="");else if(p==='"'||p==="'")w=p;else if(p===">")break}if(v>=g.length)throw new Error("Incomplete game markup");let b=g.slice(m+1,v);if(m=v+1,/^\s*!/.test(b))continue;let d=/^\s*\/\s*([\w:-]+)/.exec(b);if(d){for(let p=z.length-1;p>0;p--)if(z[p].tag.toLowerCase()===d[1].toLowerCase()){z.length=p;break}continue}let h=/^\s*([\w:-]+)/.exec(b);if(!h)throw new Error("Invalid game markup");let P=h[1],f=z[z.length-1],j=P.toLowerCase()==="svg"||f.svg&&f.tag.toLowerCase()!=="foreignobject",A=j?document.createElementNS("http://www.w3.org/2000/svg",P):document.createElement(P),q=b.slice(h[0].length).replace(/\/\s*$/,""),V=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,C;for(;C=V.exec(q);){let p=C[1],U=$(C[2]??C[3]??C[4]??"");A.setAttribute(p,U)}f.element.appendChild(A),!Q.test(P)&&!/\/\s*$/.test(b)&&z.push({element:A,tag:P,svg:j})}return g}document.documentElement.lang="it";(()=>{"use strict";let r=document.getElementById("root"),F=(e,t,n)=>Math.max(t,Math.min(n,e)),g=(e,t)=>e+Math.random()*(t-e),$=e=>e[Math.floor(Math.random()*e.length)],z=e=>e[e.length-1],Q=e=>{for(let t=e.length-1;t>0;t--){let n=Math.floor(Math.random()*(t+1));[e[t],e[n]]=[e[n],e[t]]}return e},m=[],v=[],w=!0,b=!1,d;function h(e,t,n,o){e.addEventListener(t,n,o),m.push(()=>e.removeEventListener(t,n,o))}function P(e,t,n="#faf8f1"){let o=document.createElement("style");o.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(o),r.style.background=n,Be(r,'<div class="fit">'+t+"</div>");let i=r.querySelector(".fit");function a(){let s=r.getBoundingClientRect(),c=Math.min(s.width/390,s.height/598);i.style.transform=`translate(${(s.width-390*c)/2}px,${(s.height-598*c)/2}px) scale(${c})`,r.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}a(),h(window,"resize",a)}function f(e){return r.querySelector(e)}function j(){var e;(e=f(".guide"))==null||e.classList.add("gone")}function A(e){r.dataset.phase=e}function q(){V(),j()}function V(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function C(e=450,t=.08,n=.18,o="sine",i=0){if(!(!d||!w))try{let a=d.createOscillator(),s=d.createGain(),c=d.currentTime;a.type=o,a.frequency.setValueAtTime(e,c),i&&a.frequency.exponentialRampToValueAtTime(Math.max(30,i),c+t),s.gain.setValueAtTime(.001,c),s.gain.exponentialRampToValueAtTime(n,c+.006),s.gain.exponentialRampToValueAtTime(.001,c+t),a.connect(s),s.connect(d.destination),a.start(c),a.stop(c+t+.02),a.onended=()=>{a.disconnect(),s.disconnect()}}catch{}}function p(){C(523,.12,.18),setTimeout(()=>C(784,.17,.16),100)}function U(){C(180,.22,.18,"triangle",65)}function he(e){let t=0;function n(o){if(b)return;let i=Math.min(.035,(o-(t||o))/1e3);t=o,document.hidden||e(w?i:0,o/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function ge(){let e=f("canvas.stage"),t=e.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return e.width=390*n,e.height=598*n,t.scale(n,n),{canvas:e,ctx:t}}function Ee(e,t=f("canvas.stage")){let n=t.getBoundingClientRect();return{x:(e.clientX-n.left)*390/n.width,y:(e.clientY-n.top)*598/n.height}}function me(e,t,n,o,i,a){a=Math.min(Math.abs(o)/2,Math.abs(i)/2,a),e.moveTo(t+a,n),e.lineTo(t+o-a,n),e.quadraticCurveTo(t+o,n,t+o,n+a),e.lineTo(t+o,n+i-a),e.quadraticCurveTo(t+o,n+i,t+o-a,n+i),e.lineTo(t+a,n+i),e.quadraticCurveTo(t,n+i,t,n+i-a),e.lineTo(t,n+a),e.quadraticCurveTo(t,n,t+a,n),e.closePath()}function qe(e,t,n,o,i,a,s,c){e.beginPath(),me(e,t,n,o,i,a),s&&(e.fillStyle=s,e.fill()),c&&(e.strokeStyle=c,e.stroke())}function G(e,t,n,o,i,a){e.beginPath(),e.arc(t,n,Math.max(.01,o),0,Math.PI*2),i&&(e.fillStyle=i,e.fill()),a&&(e.strokeStyle=a,e.stroke())}function Ue(e,t,n,o,i,a,s=2){e.beginPath(),e.moveTo(t,n),e.lineTo(o,i),e.strokeStyle=a,e.lineWidth=s,e.stroke()}function D(e,t,n,o,i=18,a="#25252a",s="UIBody",c="center"){e.font=`700 ${i}px ${s}`,e.fillStyle=a,e.textAlign=c,e.textBaseline="middle",e.fillText(t,n,o)}let ee=[];function W(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(ae(t,e))}function Re(e){let t=new Image;return t.onerror=()=>{r.dataset.assetIssue="image"},t.src=W(e),ee.push({im:t,path:e}),t}function xe(e,t,n,o,i,a){if(!t||!t.width)return;let s=t.videoWidth||t.width,c=t.videoHeight||t.height;if(!s||!c)return;let I=Math.max(i/s,a/c);e.save(),e.beginPath(),e.rect(n,o,i,a),e.clip(),e.drawImage(t,n+(i-s*I)/2,o+(a-c*I)/2,s*I,c*I),e.restore()}function te(e,t,n,o,i){e.save(),e.beginPath(),e.arc(n,o,i,0,Math.PI*2),e.clip(),xe(e,t,n-i,o-i,i*2,i*2),e.restore()}function be(e,t,n,o){let i=f(".modal");if(!i)return;i.hidden=!1,i.querySelector("h2").textContent=e,i.querySelector(".value").textContent=t,i.querySelector("p").textContent=n;let a=i.querySelector("button");a.onclick=()=>{i.hidden=!0,q(),o()},A("result")}function ye(e="Gioca ancora"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Le(){let e=f(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let ne=[];function ie(e){w=e,e||d==null||d.suspend().catch(()=>{});for(let t of ne)t(e)}h(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&ie(e.data.active===!0)}),h(document,"visibilitychange",()=>{ie(!document.hidden)}),h(window,"pagehide",()=>{b=!0,m.splice(0).forEach(e=>e()),v.splice(0).forEach(e=>e()),d==null||d.close().catch(()=>{})});let oe={};function ae(e,t){return oe[e]??t}async function ve(e=()=>{}){let t=new AbortController,n=setTimeout(()=>t.abort(),1600);try{let o=await fetch("./game.config.json",{signal:t.signal});if(!o.ok)throw Error("Configurazione non disponibile");let i=await o.json();for(let a of["texts","tweaks","images"])for(let s of i[a]||[])oe[s.id]=a==="images"?s.path:s.value;for(let a of ee){let s=W(a.path);a.im.getAttribute("src")!==s&&(a.im.src=s)}for(let a of r.querySelectorAll('img[src^="./assets/"]'))a.src=W(a.getAttribute("src"));e(),r.dataset.config="loaded"}catch{r.dataset.config="defaults"}finally{clearTimeout(n)}}let y=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],se=()=>{};function we(){var t;function e(n){y=n.slice(0,24).map(o=>({nickname:String(o.nickname||"Amico"),avatar:o.avatar,image:null}));for(let o of y){let i;try{i=new Image,i.onload=()=>{o.image=i,se()},i.onerror=()=>{o.image=null},i.src=o.avatar}catch{o.image=null}}se()}e(y),r.dataset.friends="sample",typeof((t=window.tt)==null?void 0:t.getFriendsInfo)=="function"&&window.tt.getFriendsInfo({success(n){let o=Array.isArray(n==null?void 0:n.friends)?n.friends.filter(i=>i&&typeof i.avatar=="string"):[];o.length&&(e(o),r.dataset.friends="host")},fail(){r.dataset.friends="sample"}})}function Ce(e,t,n,o,i,a="#fff"){let s=y[(t%y.length+y.length)%y.length];e.save(),e.shadowColor="#25212d20",e.shadowBlur=6,G(e,n,o,i,a),e.shadowBlur=0,s!=null&&s.image?te(e,s.image,n,o,Math.max(1,i-2)):(G(e,n,o,Math.max(1,i-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][t%4]),D(e,Array.from((s==null?void 0:s.nickname)||"?")[0],n,o,i*.7,"#fff")),e.restore()}function ke(e){var t;return((t=y[(e%y.length+y.length)%y.length])==null?void 0:t.nickname)||"Amico"}function ze(e,t,n,o,i=13){D(e,Array.from(ke(t)).slice(0,15).join(""),n,o,i)}we(),P(".fit{background:#fff}canvas.stage{position:absolute;z-index:3;pointer-events:none}.vision-copy{position:absolute;left:30px;right:30px;top:90px;z-index:6;display:flex;flex-direction:column;align-items:center;gap:24px;text-align:center;pointer-events:none}.question{position:static;margin:0;font-size:20px;line-height:1.4;font-weight:700;color:#55465c}.guide{top:160px;font-size:15px;font-weight:500;color:#aaa0ac}.orb{position:absolute;left:65px;top:218px;width:260px;height:260px;object-fit:contain;pointer-events:none}.fog{position:absolute;left:65px;top:218px;width:260px;height:260px;touch-action:none;z-index:5;opacity:1;transition:opacity .5s ease-out}.fog.revealed{opacity:0;pointer-events:none}.prediction{position:static;margin:0;font-size:14px;line-height:1.4;color:#5d4969;overflow-wrap:anywhere}.prediction:empty{display:none}.next-vision{position:absolute;left:50%;transform:translateX(-50%);bottom:24px;white-space:nowrap;background:#4b4355}.count{position:absolute;right:30px;top:33px;color:#8e8696;font-size:14px}.result{background:#faf7ff}.result .value{font-size:28px}.result p{white-space:pre-line}",`<canvas class="stage" aria-label="La sfera del futuro"></canvas><div class="count">1 / 3</div><div class="vision-copy"><div class="question">Chi avr\xE0 fortuna oggi?</div><div class="prediction" aria-live="polite"></div></div><div class="guide">Strofina e scopri chi c\u2019\xE8</div><img class="orb" src="./assets/crystal.webp" alt="Sfera di cristallo"><canvas class="fog" width="436" height="436" aria-label="Rimuovi la nebbia"></canvas><button class="pill next-vision" disabled>Prossima visione</button>${ye()}`,"#fff");function Se(){let e=f(".modal"),t=f(".result"),n=document.createElement("div");n.className="fortune-result-fit",n.append(t),e.append(n),e.classList.add("fortune-overlay"),r.append(e),r.style.position="relative";let o=document.createElement("style");o.textContent="#root>.modal.fortune-overlay{position:absolute;inset:0;width:100%;height:100%;padding:0;overflow:hidden}#root .fortune-result-fit{width:390px;height:598px;display:grid;place-items:center;padding:30px 30px 50px;transform:scale(var(--fortune-result-scale,1));transform-origin:center;pointer-events:auto}",document.head.append(o);function i(){let a=r.getBoundingClientRect();r.style.setProperty("--fortune-result-scale",String(Math.min(a.width/390,a.height/598)))}if(i(),h(window,"resize",i),typeof ResizeObserver<"u"){let a=new ResizeObserver(i);a.observe(r),v.push(()=>a.disconnect())}}Se();let{ctx:_}=ge(),x=f(".fog"),l=x.getContext("2d"),u=x.width,M=0,R=0,X="",T=!1,B=!1,k=null,H=[],N=0,L=!1,Y=-1,S={cx:317.54,cy:254.28,radius:238,feather:4,artSize:640};function Z(e){let t=u/S.artSize;e.beginPath(),e.arc(S.cx*t,S.cy*t,S.radius*t,0,Math.PI*2),e.closePath()}let K=document.createElement("canvas");K.width=K.height=u;let O=K.getContext("2d");Z(O),O.fillStyle="#fff",O.fill();let J=O.getImageData(0,0,u,u).data,E=[];for(let e=3;e<J.length;e+=4)J[e]>=128&&E.push(e);let re=new Uint8Array(E.length);function Ie(){l.globalCompositeOperation="source-over",l.clearRect(0,0,u,u),l.save(),Z(l),l.clip();let e=u/S.artSize,t=S.cx*e,n=S.cy*e,o=S.radius*e,i=l.createRadialGradient(t-o*.35,n-o*.4,o*.05,t,n,o*1.12);i.addColorStop(0,"#eee8f0"),i.addColorStop(.6,"#d8d0e3"),i.addColorStop(1,"#b5a8c9"),l.fillStyle=i,l.fillRect(0,0,u,u);let a=l.createRadialGradient(t,n,o-S.feather*e,t,n,o);a.addColorStop(0,"#fff"),a.addColorStop(1,"#fff0"),l.globalCompositeOperation="destination-in",l.fillStyle=a,l.fillRect(0,0,u,u),l.restore();let s=l.getImageData(0,0,u,u).data;E.forEach((c,I)=>{re[I]=s[c]}),N=0,L=!1,Y=-1,r.dataset.mistCoverage="0.0000"}function le(e){let t=x.getBoundingClientRect();return{x:(e.clientX-t.left)*u/t.width,y:(e.clientY-t.top)*u/t.height}}function ce(e){let t=Math.floor(e.x),n=Math.floor(e.y);return t>=0&&t<u&&n>=0&&n<u&&J[(n*u+t)*4+3]>=128}function Ae(){T||(T=!0,B=!1,k=null,x.classList.add("revealed"),x.setAttribute("aria-hidden","true"),f(".prediction").textContent=X,f(".next-vision").disabled=!1,H.push({friend:y[R],prediction:X,index:R}),C(640,.3,.1,"sine",900),A("revealed"))}function fe(){if(!L||T)return;L=!1;let e=l.getImageData(0,0,u,u).data,t=0;for(let n=0;n<E.length;n++){let o=re[n];o&&(t+=F(1-e[E[n]]/o,0,1))}N=t/E.length,r.dataset.mistCoverage=N.toFixed(4),N>=.6&&Ae()}function de(e){let t=le(e);if(!ce(t)){k=null;return}l.save(),Z(l),l.clip(),l.globalCompositeOperation="destination-out",l.strokeStyle="#000",l.fillStyle="#000",l.lineCap="round",l.lineWidth=58,k?(l.beginPath(),l.moveTo(k.x,k.y),l.lineTo(t.x,t.y),l.stroke()):(l.beginPath(),l.arc(t.x,t.y,29,0,Math.PI*2),l.fill()),l.restore(),k=t,L=!0}let Pe=["Chi avr\xE0 fortuna oggi?","Chi ricever\xE0 una sorpresa?","Chi inizier\xE0 un\u2019avventura?"],Me=["\xC8 in arrivo una piccola coincidenza felice.","Un messaggio inatteso porter\xE0 un sorriso.","Un desiderio si avvicina alla realt\xE0.","Una buona idea arriver\xE0 al momento giusto.","Un volto noto porter\xE0 una buona notizia."];function pe(){R=Math.floor(Math.random()*y.length),X=$(Me),T=!1,B=!1,k=null,x.style.transition="none",x.classList.remove("revealed"),x.removeAttribute("aria-hidden"),f(".count").textContent=M+1+" / 3",f(".question").textContent=Pe[M],f(".prediction").textContent="",f(".next-vision").disabled=!0,f(".next-vision").textContent=M===2?"Vedi le visioni":"Prossima visione",Ie(),x.offsetWidth,x.style.removeProperty("transition"),A("ready")}function ue(){M=0,H=[],pe()}h(x,"pointerdown",e=>{T||!ce(le(e))||(q(),A("wiping"),B=!0,k=null,x.setPointerCapture(e.pointerId),de(e))}),h(x,"pointermove",e=>{B&&!T&&de(e)});for(let e of["pointerup","pointercancel","lostpointercapture"])h(x,e,()=>{fe(),B=!1,k=null});ne.push(e=>{e||(B=!1,k=null)});function Te(){be("Le tue visioni","","",ue);let e=f(".result");e.classList.add("fortune-summary");let t=e.querySelector(".fortune-list");t||(t=document.createElement("ol"),t.className="fortune-list",e.querySelector("button").before(t)),t.replaceChildren();for(let n of H){let o=document.createElement("li");o.className="fortune-row";let i=document.createElement("canvas");i.className="fortune-avatar",i.width=96,i.height=96,i.setAttribute("role","img"),i.setAttribute("aria-label",n.friend.nickname);let a=i.getContext("2d");G(a,48,48,47,"#e5daed"),n.friend.image?te(a,n.friend.image,48,48,44):(G(a,48,48,44,["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][n.index%4]),D(a,Array.from(n.friend.nickname||"?")[0],48,48,32,"#fff"));let s=document.createElement("div");s.className="fortune-copy";let c=document.createElement("strong");c.className="fortune-name",c.textContent=n.friend.nickname;let I=document.createElement("p");I.textContent=n.prediction,s.append(c,I),o.append(i,s),t.append(o)}}h(f(".next-vision"),"click",()=>{q(),M===2?(Te(),p()):(M++,pe())}),ue(),he((e,t)=>{L&&t-Y>=.05&&(Y=t,fe()),_.clearRect(0,0,390,598),Ce(_,R,195,304,30,"#fff"),ze(_,R,195,351,14)}),ve(()=>{f(".guide")&&(f(".guide").textContent=String(ae("GUIDE","Strofina e scopri chi c\u2019\xE8")))})})();(()=>{let r=document.createElement("style");r.dataset.batch3Ui="20261116",r.textContent=`
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

.count{top:30px;left:30px;right:30px;text-align:center;font:600 28px/1.2 Playful,UIBody,sans-serif;color:#6e5c7c}
.question{position:static;font:700 20px/1.4 UIBody,system-ui,sans-serif;color:#55465c}
.guide{top:157px;font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#746778}
.orb{left:65px;top:218px;width:260px;height:260px}
.fog{left:65px;top:218px;width:260px;height:260px}
.prediction{position:static;font-size:14px;line-height:1.4;color:#5d4969}
.next-vision{bottom:50px;min-height:44px;font-size:16px}
`,document.head.append(r)})();(()=>{let r=document.createElement("style");r.textContent=`
/* A readable three-row keepsake instead of the generic numeric result. */
.result.fortune-summary{display:flex;flex-direction:column;gap:18px;width:330px;max-width:100%;max-height:100%;padding:24px 20px;background:#faf7ff;border:2px solid #65566d;border-radius:18px;box-shadow:4px 5px 0 #65566d22;text-align:left;overflow-y:auto}
.result.fortune-summary h2{margin:0;font:700 24px/1.25 Playful,UIBody,sans-serif;text-align:center;overflow-wrap:anywhere;text-wrap:balance}
.result.fortune-summary>.value,.result.fortune-summary>p{display:none}
.fortune-list{display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none}
.fortune-row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px;align-items:start;padding:14px 0;border-bottom:1px solid #65566d26}
.fortune-row:first-child{padding-top:0}.fortune-row:last-child{padding-bottom:0;border-bottom:0}
.fortune-avatar{display:block;width:48px;height:48px;margin-top:2px}
.fortune-copy{min-width:0}.fortune-name{display:block;margin:0 0 4px;font:700 16px/1.3 UIBody,sans-serif;color:#45364e;overflow-wrap:anywhere}
.result.fortune-summary .fortune-row p{margin:0;font:400 14px/1.5 UIBody,sans-serif;color:#65566d;white-space:normal;overflow-wrap:anywhere}
.result.fortune-summary>.pill{align-self:center;margin:2px 0 0;min-height:44px;max-width:100%;padding:11px 28px;background:#4b4355;color:#fff;border-radius:10px;font:700 16px/1.3 Playful,UIBody,sans-serif;white-space:normal}
#root[data-phase="result"] .count,#root[data-phase="result"] .vision-copy,#root[data-phase="result"] .guide,#root[data-phase="result"] .next-vision{visibility:hidden}
`,document.head.append(r)})();})();
