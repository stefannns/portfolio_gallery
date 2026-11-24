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

(()=>{function le(s,K){if(!s)throw new Error("Game mount target is missing");let h=String(K??""),V=m=>m.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(w,f)=>{if(f[0]==="#"){let d=f[1].toLowerCase()==="x",c=parseInt(f.slice(d?2:1),d?16:10);return c>0&&c<=1114111?String.fromCodePoint(c):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[f.toLowerCase()]||w});for(;s.firstChild;)s.removeChild(s.firstChild);let v=[{element:s,tag:"",svg:s.namespaceURI==="http://www.w3.org/2000/svg"}],$=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,g=0;for(;g<h.length;){if(h.startsWith("<!--",g)){let u=h.indexOf("-->",g+4);g=u<0?h.length:u+3;continue}if(h[g]!=="<"){let u=h.indexOf("<",g),L=u<0?h.length:u;v[v.length-1].element.appendChild(document.createTextNode(V(h.slice(g,L)))),g=L;continue}let m=g+1,w="";for(;m<h.length;m++){let u=h[m];if(w)u===w&&(w="");else if(u==='"'||u==="'")w=u;else if(u===">")break}if(m>=h.length)throw new Error("Incomplete game markup");let f=h.slice(g+1,m);if(g=m+1,/^\s*!/.test(f))continue;let d=/^\s*\/\s*([\w:-]+)/.exec(f);if(d){for(let u=v.length-1;u>0;u--)if(v[u].tag.toLowerCase()===d[1].toLowerCase()){v.length=u;break}continue}let c=/^\s*([\w:-]+)/.exec(f);if(!c)throw new Error("Invalid game markup");let I=c[1],r=v[v.length-1],B=I.toLowerCase()==="svg"||r.svg&&r.tag.toLowerCase()!=="foreignobject",C=B?document.createElementNS("http://www.w3.org/2000/svg",I):document.createElement(I),R=f.slice(c[0].length).replace(/\/\s*$/,""),j=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,y;for(;y=j.exec(R);){let u=y[1],L=V(y[2]??y[3]??y[4]??"");C.setAttribute(u,L)}r.element.appendChild(C),!$.test(I)&&!/\/\s*$/.test(f)&&v.push({element:C,tag:I,svg:B})}return h}document.documentElement.lang="it";(()=>{"use strict";let s=document.getElementById("root"),K=(e,t,o)=>Math.max(t,Math.min(o,e)),h=(e,t)=>e+Math.random()*(t-e),V=e=>e[Math.floor(Math.random()*e.length)],v=e=>e[e.length-1],$=e=>{for(let t=e.length-1;t>0;t--){let o=Math.floor(Math.random()*(t+1));[e[t],e[o]]=[e[o],e[t]]}return e},g=[],m=[],w=!0,f=!1,d;function c(e,t,o,i){e.addEventListener(t,o,i),g.push(()=>e.removeEventListener(t,o,i))}function I(e,t,o="#faf8f1"){let i=document.createElement("style");i.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(i),s.style.background=o,le(s,'<div class="fit">'+t+"</div>");let n=s.querySelector(".fit");function a(){let l=s.getBoundingClientRect(),p=Math.min(l.width/390,l.height/598);n.style.transform=`translate(${(l.width-390*p)/2}px,${(l.height-598*p)/2}px) scale(${p})`,s.dataset.layout=`${Math.round(l.width)}x${Math.round(l.height)}`}a(),c(window,"resize",a)}function r(e){return s.querySelector(e)}function B(){var e;(e=r(".guide"))==null||e.classList.add("gone")}function C(e){s.dataset.phase=e}function R(){j(),B()}function j(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function y(e=450,t=.08,o=.18,i="sine",n=0){if(!(!d||!w))try{let a=d.createOscillator(),l=d.createGain(),p=d.currentTime;a.type=i,a.frequency.setValueAtTime(e,p),n&&a.frequency.exponentialRampToValueAtTime(Math.max(30,n),p+t),l.gain.setValueAtTime(.001,p),l.gain.exponentialRampToValueAtTime(o,p+.006),l.gain.exponentialRampToValueAtTime(.001,p+t),a.connect(l),l.connect(d.destination),a.start(p),a.stop(p+t+.02),a.onended=()=>{a.disconnect(),l.disconnect()}}catch{}}function u(){y(523,.12,.18),setTimeout(()=>y(784,.17,.16),100)}function L(){y(180,.22,.18,"triangle",65)}function pe(e){let t=0;function o(i){if(f)return;let n=Math.min(.035,(i-(t||i))/1e3);t=i,document.hidden||e(w?n:0,i/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function xe(){let e=r("canvas.stage"),t=e.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return e.width=390*o,e.height=598*o,t.scale(o,o),{canvas:e,ctx:t}}function we(e,t=r("canvas.stage")){let o=t.getBoundingClientRect();return{x:(e.clientX-o.left)*390/o.width,y:(e.clientY-o.top)*598/o.height}}function ce(e,t,o,i,n,a){a=Math.min(Math.abs(i)/2,Math.abs(n)/2,a),e.moveTo(t+a,o),e.lineTo(t+i-a,o),e.quadraticCurveTo(t+i,o,t+i,o+a),e.lineTo(t+i,o+n-a),e.quadraticCurveTo(t+i,o+n,t+i-a,o+n),e.lineTo(t+a,o+n),e.quadraticCurveTo(t,o+n,t,o+n-a),e.lineTo(t,o+a),e.quadraticCurveTo(t,o,t+a,o),e.closePath()}function ye(e,t,o,i,n,a,l,p){e.beginPath(),ce(e,t,o,i,n,a),l&&(e.fillStyle=l,e.fill()),p&&(e.strokeStyle=p,e.stroke())}function ve(e,t,o,i,n,a){e.beginPath(),e.arc(t,o,Math.max(.01,i),0,Math.PI*2),n&&(e.fillStyle=n,e.fill()),a&&(e.strokeStyle=a,e.stroke())}function ze(e,t,o,i,n,a,l=2){e.beginPath(),e.moveTo(t,o),e.lineTo(i,n),e.strokeStyle=a,e.lineWidth=l,e.stroke()}function ke(e,t,o,i,n=18,a="#25252a",l="UIBody",p="center"){e.font=`700 ${n}px ${l}`,e.fillStyle=a,e.textAlign=p,e.textBaseline="middle",e.fillText(t,o,i)}let Z=[];function X(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(Y(t,e))}function de(e){let t=new Image;return t.onerror=()=>{s.dataset.assetIssue="image"},t.src=X(e),Z.push({im:t,path:e}),t}function Q(e,t,o,i,n,a){if(!t)return!1;let l=t.videoWidth||t.naturalWidth||t.width,p=t.videoHeight||t.naturalHeight||t.height;if(!l||!p)return!1;let _=Math.max(n/l,a/p);return e.save(),e.beginPath(),e.rect(o,i,n,a),e.clip(),e.drawImage(t,o+(n-l*_)/2,i+(a-p*_)/2,l*_,p*_),e.restore(),!0}function Ce(e,t,o,i,n){e.save(),e.beginPath(),e.arc(o,i,n,0,Math.PI*2),e.clip(),Q(e,t,o-n,i-n,n*2,n*2),e.restore()}function ue(e,t,o,i){let n=r(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=e,n.querySelector(".value").textContent=t,n.querySelector("p").textContent=o;let a=n.querySelector("button");a.onclick=()=>{n.hidden=!0,R(),i()},C("result")}function fe(e="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Pe(){let e=r(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let he=[];function ee(e){w=e,e||d==null||d.suspend().catch(()=>{});for(let t of he)t(e)}c(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&ee(e.data.active===!0)}),c(document,"visibilitychange",()=>{ee(!document.hidden)}),c(window,"pagehide",()=>{f=!0,g.splice(0).forEach(e=>e()),m.splice(0).forEach(e=>e()),d==null||d.close().catch(()=>{})});let te={};function Y(e,t){return te[e]??t}async function ge(e=()=>{}){let t=new AbortController,o=setTimeout(()=>t.abort(),1600);try{let i=await fetch("./game.config.json",{signal:t.signal});if(!i.ok)throw Error("Configurazione non disponibile");let n=await i.json();for(let a of["texts","tweaks","images"])for(let l of n[a]||[])te[l.id]=a==="images"?l.path:l.value;for(let a of Z){let l=X(a.path);a.im.getAttribute("src")!==l&&(a.im.src=l)}for(let a of s.querySelectorAll('img[src^="./assets/"]'))a.src=X(a.getAttribute("src"));e(),s.dataset.config="loaded"}catch{s.dataset.config="defaults"}finally{clearTimeout(o)}}I(".fit{background:#fff}.blob{position:absolute;width:230px;height:230px;border-radius:50%;background:#f9de83;right:-85px;top:-85px}.lavender{position:absolute;width:230px;height:220px;border-radius:50%;background:#e5ddf5;left:-100px;bottom:-100px}.guide{top:85px;font-family:Playful,Arial;font-size:18px}.capability{padding:10px 12px;font-size:14px}.puzzle{position:absolute;left:55px;top:146px;width:280px;height:280px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:4px;touch-action:none}.puzzle.is-loading{pointer-events:none}.puzzle-placeholder{grid-area:1/1/4/4;display:grid;place-items:center;text-align:center;padding:24px;background:#f3f0f7;border-radius:12px;font-size:15px;line-height:1.5;color:#655d70}.tile{padding:0;position:relative;overflow:hidden;border-radius:9px;box-shadow:0 2px 2px #25252a18;background:#f0ece1;min-height:0}.tile canvas{display:block;width:100%;height:100%;pointer-events:none}.tile.selected{outline:3px solid #6464c8;z-index:2}.tile.dragging{opacity:.6;transform:scale(.96)}.hud{font-size:28px;color:#514b5b;top:30px}.photo-status{top:432px;bottom:auto;font-size:12px;color:#655d70;line-height:1.4}.bottom{bottom:50px;display:grid;grid-template-columns:1fr 1fr;gap:8px}.result{background:#f3f0fb}.result button{background:#4c497b}",`<div class="hud"><span class="moves">0 mosse</span><span class="time">0s</span></div><div class="guide">Scambia i pezzi e ricomponi la foto</div><div class="puzzle" aria-label="Puzzle fotografico"></div><div class="status photo-status" role="status" aria-live="polite" hidden></div><input id="puzzle-photo-input" type="file" accept="image/*" hidden><div class="bottom"><button class="capability photo-upload" aria-controls="puzzle-photo-input">Carica foto</button><button class="capability shuffle" aria-label="Mescola i pezzi" disabled>\u21BB Mescola</button></div>${fe()}`,"#fff");let P=null,oe=!1,z=!1,q=0,b=$([...Array(9).keys()]),M=-1,E=0,U=0,H=!1,A=!1,x=null,O=r("#puzzle-photo-input"),F=r(".photo-upload"),ne=r(".photo-status"),W=new Set,me=!0,k=(e,t)=>me?t:e;function S(e=""){ne.textContent=e,ne.hidden=!e}F.textContent=k("Carica foto","Carica foto"),r(".shuffle").textContent=k("\u21BB Mescola","\u21BB Mescola");function ie(e){let t=e.naturalWidth||e.width,o=e.naturalHeight||e.height;if(!t||!o)throw Error("L\u2019immagine \xE8 vuota");let i=document.createElement("canvas");i.width=i.height=600;let n=i.getContext("2d");if(n.fillStyle="#fff",n.fillRect(0,0,600,600),!Q(n,e,0,0,600,600))throw Error("Impossibile adattare l\u2019immagine");return i}function T(){let e=r(".puzzle");if(e.replaceChildren(),!P){let t=document.createElement("div");t.className="puzzle-placeholder",le(t,'<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="7" width="34" height="30" rx="4"/><circle cx="15" cy="17" r="4"/><path d="m7 33 11-10 6 5 6-8 8 13"/></svg>'),t.setAttribute("aria-label",k("Anteprima foto","Anteprima foto")),e.append(t);return}b.forEach((t,o)=>{let i=document.createElement("button");i.className="tile"+(o===M?" selected":""),i.dataset.slot=o,i.setAttribute("aria-label",`Pezzo del puzzle ${t+1}`);let n=document.createElement("canvas");n.width=n.height=200;let a=P.width/3;n.getContext("2d").drawImage(P,t%3*a,Math.floor(t/3)*a,a,a,0,0,200,200),i.append(n),e.append(i)}),s.dataset.moves=E,s.dataset.solved=String(A)}function G(e=P){e&&(P=e,b=$([...Array(9).keys()]),b.every((t,o)=>t===o)&&([b[0],b[1]]=[b[1],b[0]]),M=-1,E=0,U=0,H=!1,A=!1,x=null,r(".moves").textContent="0 mosse",r(".time").textContent="0s",T(),r(".shuffle").disabled=z,C("ready"))}function ae(e,t){e===t||A||z||([b[e],b[t]]=[b[t],b[e]],E++,H=!0,R(),M=-1,r(".moves").textContent=`${E} mosse`,y(500,.05,.12),A=b.every((o,i)=>o===i),T(),C("playing"),A&&(u(),ue("Foto ricomposta!",Math.max(100,1e3-E*12-Math.round(U)*2),`${E} mosse \xB7 ${Math.ceil(U)} secondi`,G)))}c(r(".puzzle"),"pointerdown",e=>{let t=e.target.closest(".tile");!t||A||z||(x={x:e.clientX,y:e.clientY,slot:Number(t.dataset.slot)},t.setPointerCapture(e.pointerId))}),c(r(".puzzle"),"pointermove",e=>{var t;x&&Math.hypot(e.clientX-x.x,e.clientY-x.y)>8&&((t=r(`.tile[data-slot="${x.slot}"]`))==null||t.classList.add("dragging"))}),c(r(".puzzle"),"pointerup",e=>{if(!x)return;let t=x;x=null;let o=r(".puzzle").getBoundingClientRect(),i=Math.floor((e.clientX-o.left)/(o.width/3)),n=Math.floor((e.clientY-o.top)/(o.height/3)),a=i+n*3;Math.hypot(e.clientX-t.x,e.clientY-t.y)>8?i>=0&&i<3&&n>=0&&n<3?ae(t.slot,a):T():M>=0&&M!==t.slot?ae(M,t.slot):(M=t.slot,T())});for(let e of["pointercancel","lostpointercapture"])c(r(".puzzle"),e,()=>{x&&(x=null,T())});async function be(e){if(!e)return;if(!(e.type.startsWith("image/")||!e.type&&/\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(e.name))||!e.size){S(k("Scegli un file immagine. Il puzzle attuale non cambia.","Scegli un file immagine. Il puzzle attuale non cambia."));return}if(e.size>30*1024*1024){S(k("La foto \xE8 troppo grande. Scegli un\u2019immagine pi\xF9 piccola.","La foto \xE8 troppo grande. Scegli un\u2019immagine pi\xF9 piccola."));return}let o=++q;z=!0,x=null,M=-1,F.disabled=!0,r(".shuffle").disabled=!0,r(".puzzle").classList.add("is-loading"),S(k("Apertura della foto\u2026","Apertura della foto\u2026"));let i=URL.createObjectURL(e);W.add(i);try{let n=new Image;if(n.decoding="async",await new Promise((l,p)=>{n.onload=l,n.onerror=()=>p(Error("Impossibile leggere l\u2019immagine")),n.src=i}),f||o!==q)return;let a=ie(n);oe=!0,z=!1,r(".modal").hidden=!0,G(a),s.dataset.photoSource="uploaded",S()}catch{!f&&o===q&&S(k("Impossibile aprire la foto. Prova un file JPG, PNG o WebP.","Impossibile aprire la foto. Prova un file JPG, PNG o WebP."))}finally{URL.revokeObjectURL(i),W.delete(i),!f&&o===q&&(z=!1,F.disabled=!1,r(".shuffle").disabled=!P,r(".puzzle").classList.remove("is-loading"),T())}}c(F,"click",()=>{j(),O.click()}),c(O,"change",()=>{var t;let e=(t=O.files)==null?void 0:t[0];O.value="",e&&be(e)}),c(r(".shuffle"),"click",()=>{!P||z||(R(),G())}),m.push(()=>{q++;for(let e of W)URL.revokeObjectURL(e);W.clear()});let J=de("./assets/sample-photo.webp");c(J,"load",()=>{if(!(f||oe||z))try{G(ie(J)),s.dataset.photoSource="default",S()}catch{S(k("Foto non disponibile","Foto non disponibile"))}}),c(J,"error",()=>{P||S(k("Foto non disponibile","Foto non disponibile"))}),T(),C("loading"),pe(e=>{H&&!A&&!z&&(U+=e,r(".time").textContent=Math.floor(U)+"s")});function D(){let e=s.getBoundingClientRect(),t=Math.min(e.width/390,e.height/598);s.style.position="relative",s.style.backgroundColor="#f4d467",s.style.backgroundImage="url("+JSON.stringify(String(Y("PAPER_BACKDROP","./assets/paper-print-v1.svg")))+")",s.style.backgroundSize=256*t+"px "+256*t+"px",s.style.backgroundRepeat="repeat",s.style.setProperty("--paper-scale",String(t)),s.dataset.backgroundTheme="graphic-paper"}let se=document.createElement("style");se.textContent="html,body{background:#f4d467}#root>.fit{background:transparent!important}#root .hud,#root .guide{color:#282723}.photo-status{color:#4b442c!important}.tile{border:1.5px solid #282723;border-radius:6px;box-shadow:none}.tile.selected{outline:3px solid #282723;outline-offset:1px}.bottom .capability{border:2px solid #282723;border-radius:6px;background:#fffbea;color:#282723;box-shadow:0 3px 0 #28272326}.bottom .capability:active{box-shadow:none}.puzzle-placeholder{background:#fffbea;color:#282723;border:2px solid #282723}#root>.modal{position:absolute;inset:0;padding:0;z-index:30;background:#28272355;display:grid;place-items:center}#root>.modal>.result{width:320px;max-width:none;max-height:calc((100vh - 80px*var(--paper-scale))/var(--paper-scale));transform:scale(var(--paper-scale));transform-origin:center;border:2px solid #282723;border-radius:10px;background:#fffbea;color:#282723;box-shadow:3px 5px 0 #28272326}#root>.modal .result button{border:2px solid #282723;border-radius:6px;background:#f4d467;color:#282723;box-shadow:0 3px 0 #28272326}",document.head.append(se);let N=r(".modal");if(N){s.append(N);let e=()=>{r(".fit").inert=!N.hidden},t=new MutationObserver(e);t.observe(N,{attributes:!0,attributeFilter:["hidden"]}),e(),m.push(()=>t.disconnect())}let re=new ResizeObserver(D);re.observe(s),m.push(()=>re.disconnect()),D(),ge(()=>{D(),r(".guide")&&(r(".guide").textContent=String(Y("GUIDE","Scambia i pezzi e ricomponi la foto")))})})();(()=>{let s=document.createElement("style");s.dataset.batch3Ui="20261116",s.textContent=`
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

.guide{top:85px;font-size:18px;line-height:1.4}
.puzzle{left:55px;top:146px;width:280px;height:280px;gap:4px}
.hud{font-size:28px;top:30px;color:#514b5b}
.bottom{display:grid;grid-template-columns:1fr 1fr;gap:8px;bottom:50px}
.bottom .capability{width:100%;font-size:14px;min-height:44px;padding:10px 12px}
.photo-status{top:432px;bottom:auto;font-size:12px;color:#655d70;line-height:1.4}
`,document.head.append(s)})();})();
