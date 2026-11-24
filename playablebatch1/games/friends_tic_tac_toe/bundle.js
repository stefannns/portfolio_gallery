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

(()=>{function xe(r,G){if(!r)throw new Error("Game mount target is missing");let h=String(G??""),_=x=>x.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(k,m)=>{if(m[0]==="#"){let c=m[1].toLowerCase()==="x",d=parseInt(m.slice(c?2:1),c?16:10);return d>0&&d<=1114111?String.fromCodePoint(d):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[m.toLowerCase()]||k});for(;r.firstChild;)r.removeChild(r.firstChild);let T=[{element:r,tag:"",svg:r.namespaceURI==="http://www.w3.org/2000/svg"}],O=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,g=0;for(;g<h.length;){if(h.startsWith("<!--",g)){let f=h.indexOf("-->",g+4);g=f<0?h.length:f+3;continue}if(h[g]!=="<"){let f=h.indexOf("<",g),$=f<0?h.length:f;T[T.length-1].element.appendChild(document.createTextNode(_(h.slice(g,$)))),g=$;continue}let x=g+1,k="";for(;x<h.length;x++){let f=h[x];if(k)f===k&&(k="");else if(f==='"'||f==="'")k=f;else if(f===">")break}if(x>=h.length)throw new Error("Incomplete game markup");let m=h.slice(g+1,x);if(g=x+1,/^\s*!/.test(m))continue;let c=/^\s*\/\s*([\w:-]+)/.exec(m);if(c){for(let f=T.length-1;f>0;f--)if(T[f].tag.toLowerCase()===c[1].toLowerCase()){T.length=f;break}continue}let d=/^\s*([\w:-]+)/.exec(m);if(!d)throw new Error("Invalid game markup");let I=d[1],u=T[T.length-1],L=I.toLowerCase()==="svg"||u.svg&&u.tag.toLowerCase()!=="foreignobject",M=L?document.createElementNS("http://www.w3.org/2000/svg",I):document.createElement(I),R=m.slice(d[0].length).replace(/\/\s*$/,""),j=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,C;for(;C=j.exec(R);){let f=C[1],$=_(C[2]??C[3]??C[4]??"");M.setAttribute(f,$)}u.element.appendChild(M),!O.test(I)&&!/\/\s*$/.test(m)&&T.push({element:M,tag:I,svg:L})}return h}document.documentElement.lang="it";(()=>{"use strict";let r=document.getElementById("root"),G=(e,t,n)=>Math.max(t,Math.min(n,e)),h=(e,t)=>e+Math.random()*(t-e),_=e=>e[Math.floor(Math.random()*e.length)],T=e=>e[e.length-1],O=e=>{for(let t=e.length-1;t>0;t--){let n=Math.floor(Math.random()*(t+1));[e[t],e[n]]=[e[n],e[t]]}return e},g=[],x=[],k=!0,m=!1,c;function d(e,t,n,o){e.addEventListener(t,n,o),g.push(()=>e.removeEventListener(t,n,o))}function I(e,t,n="#faf8f1"){let o=document.createElement("style");o.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(o),r.style.background=n,xe(r,'<div class="fit">'+t+"</div>");let i=r.querySelector(".fit");function a(){let s=r.getBoundingClientRect(),l=Math.min(s.width/390,s.height/598);i.style.transform=`translate(${(s.width-390*l)/2}px,${(s.height-598*l)/2}px) scale(${l})`,r.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}a(),d(window,"resize",a)}function u(e){return r.querySelector(e)}function L(){var e;(e=u(".guide"))==null||e.classList.add("gone")}function M(e){r.dataset.phase=e}function R(){j(),L()}function j(){try{c||(c=new(window.AudioContext||window.webkitAudioContext)),c.state==="suspended"&&c.resume().catch(()=>{})}catch{}}function C(e=450,t=.08,n=.18,o="sine",i=0){if(!(!c||!k))try{let a=c.createOscillator(),s=c.createGain(),l=c.currentTime;a.type=o,a.frequency.setValueAtTime(e,l),i&&a.frequency.exponentialRampToValueAtTime(Math.max(30,i),l+t),s.gain.setValueAtTime(.001,l),s.gain.exponentialRampToValueAtTime(n,l+.006),s.gain.exponentialRampToValueAtTime(.001,l+t),a.connect(s),s.connect(c.destination),a.start(l),a.stop(l+t+.02),a.onended=()=>{a.disconnect(),s.disconnect()}}catch{}}function f(){C(523,.12,.18),setTimeout(()=>C(784,.17,.16),100)}function $(){C(180,.22,.18,"triangle",65)}function oe(e){let t=0;function n(o){if(m)return;let i=Math.min(.035,(o-(t||o))/1e3);t=o,document.hidden||e(k?i:0,o/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function ae(){let e=u("canvas.stage"),t=e.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return e.width=390*n,e.height=598*n,t.scale(n,n),{canvas:e,ctx:t}}function se(e,t=u("canvas.stage")){let n=t.getBoundingClientRect();return{x:(e.clientX-n.left)*390/n.width,y:(e.clientY-n.top)*598/n.height}}function re(e,t,n,o,i,a){a=Math.min(Math.abs(o)/2,Math.abs(i)/2,a),e.moveTo(t+a,n),e.lineTo(t+o-a,n),e.quadraticCurveTo(t+o,n,t+o,n+a),e.lineTo(t+o,n+i-a),e.quadraticCurveTo(t+o,n+i,t+o-a,n+i),e.lineTo(t+a,n+i),e.quadraticCurveTo(t,n+i,t,n+i-a),e.lineTo(t,n+a),e.quadraticCurveTo(t,n,t+a,n),e.closePath()}function ye(e,t,n,o,i,a,s,l){e.beginPath(),re(e,t,n,o,i,a),s&&(e.fillStyle=s,e.fill()),l&&(e.strokeStyle=l,e.stroke())}function H(e,t,n,o,i,a){e.beginPath(),e.arc(t,n,Math.max(.01,o),0,Math.PI*2),i&&(e.fillStyle=i,e.fill()),a&&(e.strokeStyle=a,e.stroke())}function K(e,t,n,o,i,a,s=2){e.beginPath(),e.moveTo(t,n),e.lineTo(o,i),e.strokeStyle=a,e.lineWidth=s,e.stroke()}function E(e,t,n,o,i=18,a="#25252a",s="UIBody",l="center"){e.font=`700 ${i}px ${s}`,e.fillStyle=a,e.textAlign=l,e.textBaseline="middle",e.fillText(t,n,o)}let X=[];function D(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(V(t,e))}function we(e){let t=new Image;return t.onerror=()=>{r.dataset.assetIssue="image"},t.src=D(e),X.push({im:t,path:e}),t}function le(e,t,n,o,i,a){if(!t||!t.width)return;let s=t.videoWidth||t.width,l=t.videoHeight||t.height;if(!s||!l)return;let b=Math.max(i/s,a/l);e.save(),e.beginPath(),e.rect(n,o,i,a),e.clip(),e.drawImage(t,n+(i-s*b)/2,o+(a-l*b)/2,s*b,l*b),e.restore()}function ce(e,t,n,o,i){e.save(),e.beginPath(),e.arc(n,o,i,0,Math.PI*2),e.clip(),le(e,t,n-i,o-i,i*2,i*2),e.restore()}function fe(e,t,n,o){let i=u(".modal");if(!i)return;i.hidden=!1,i.querySelector("h2").textContent=e,i.querySelector(".value").textContent=t,i.querySelector("p").textContent=n;let a=i.querySelector("button");a.onclick=()=>{i.hidden=!0,R(),o()},M("result")}function ue(e="Gioca ancora"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function ve(){let e=u(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let pe=[];function Y(e){k=e,e||c==null||c.suspend().catch(()=>{});for(let t of pe)t(e)}d(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&Y(e.data.active===!0)}),d(document,"visibilitychange",()=>{Y(!document.hidden)}),d(window,"pagehide",()=>{m=!0,g.splice(0).forEach(e=>e()),x.splice(0).forEach(e=>e()),c==null||c.close().catch(()=>{})});let Z={};function V(e,t){return Z[e]??t}async function J(e=()=>{}){let t=new AbortController,n=setTimeout(()=>t.abort(),1600);try{let o=await fetch("./game.config.json",{signal:t.signal});if(!o.ok)throw Error("Configurazione non disponibile");let i=await o.json();for(let a of["texts","tweaks","images"])for(let s of i[a]||[])Z[s.id]=a==="images"?s.path:s.value;for(let a of X){let s=D(a.path);a.im.getAttribute("src")!==s&&(a.im.src=s)}for(let a of r.querySelectorAll('img[src^="./assets/"]'))a.src=D(a.getAttribute("src"));e(),r.dataset.config="loaded"}catch{r.dataset.config="defaults"}finally{clearTimeout(n)}}let y=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],q=()=>{};function de(){var n;let e="./assets/img_user_avatar_default_3x.png";function t(o){y=o.slice(0,24).map((i,a)=>({nickname:typeof i.nickname=="string"&&i.nickname.trim()?i.nickname.trim():"nickname"+(a+1),avatar:typeof i.avatar=="string"&&i.avatar.trim()?i.avatar:e,image:null}));for(let i of y){let a=function(s,l=!1){let b=new Image;b.onload=()=>{i.image=b,q()},b.onerror=()=>{!l&&s!==e?a(e,!0):(i.image=null,q())},b.src=s};a(i.avatar,i.avatar===e)}q()}t(y),r.dataset.friends="sample",typeof((n=window.tt)==null?void 0:n.getFriendsInfo)=="function"&&window.tt.getFriendsInfo({success(o){let i=Array.isArray(o==null?void 0:o.friends)?o.friends.filter(a=>a&&typeof a=="object"):[];i.length&&(t(i),r.dataset.friends="host",q())},fail(o){r.dataset.friends="sample",console.warn("Profili amici non disponibili",(o==null?void 0:o.errMsg)||(o==null?void 0:o.message)||"")}})}function F(e,t,n,o,i,a="#fff"){let s=y[(t%y.length+y.length)%y.length];e.save(),e.shadowColor="#25212d20",e.shadowBlur=6,H(e,n,o,i,a),e.shadowBlur=0,s!=null&&s.image?ce(e,s.image,n,o,Math.max(1,i-2)):(H(e,n,o,Math.max(1,i-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][t%4]),E(e,Array.from((s==null?void 0:s.nickname)||"?")[0],n,o,i*.7,"#fff")),e.restore()}function N(e){var t;return((t=y[(e%y.length+y.length)%y.length])==null?void 0:t.nickname)||"Amico"}function ke(e,t,n,o,i=13){E(e,Array.from(N(t)).slice(0,15).join(""),n,o,i)}de(),I(".fit{background:#e987b6}.guide{top:90px;font:17px Playful,Arial}.pill{border-radius:0;background:#fff;color:#111;border:3px solid #111;box-shadow:4px 4px #111}.turn{position:absolute;left:30px;right:30px;top:456px;text-align:center;font-weight:700;font-size:14px}.result{border:3px solid #111;box-shadow:6px 6px #111;border-radius:0;background:#fff}.result .value{font-size:30px}",`<canvas class="stage" aria-label="Tabellone del tris"></canvas><div class="guide">Scegli una casella e fai tris</div><div class="opponent-name" aria-label="Avversario"></div><div class="turn">Tocca a te</div><div class="bottom"><button class="pill reset">Nuova partita</button></div>${ue()}`,"#e987b6");function he(e){let t=u(".fit"),n=u(".modal");n&&(n.classList.add("host-modal"),r.append(n));let o=document.createElement("style");o.textContent="#root{position:relative;isolation:isolate}#root>.fit{z-index:1;background:transparent}#root .pill{border-color:#282723;color:#282723}#root .pill{box-shadow:3px 4px 0 #282723}#root>.host-modal{position:absolute;inset:0;z-index:30;display:block;padding:0;background:#22242c33}#root>.host-modal>.result{position:absolute;left:50%;top:calc(50% - var(--modal-shift,10px));width:320px;max-width:none;max-height:518px;overflow-y:auto;transform:translate(-50%,-50%) scale(var(--game-fit-scale,1));transform-origin:center}",document.head.append(o);function i(){let a=r.getBoundingClientRect(),s=Math.min(a.width/390,a.height/598),l=(a.width-390*s)/2,b=(a.height-598*s)/2;t.style.transform=`translate(${l}px,${b}px) scale(${s})`,r.style.setProperty("--game-fit-scale",String(s)),r.style.setProperty("--modal-shift",`${10*s}px`),e==="felt"?(r.style.backgroundImage=`radial-gradient(circle ${380*s}px at ${l+195*s}px ${b+280*s}px, #36674f88 ${50*s}px, #102e2244 ${380*s}px)`,r.style.backgroundRepeat="no-repeat",r.style.backgroundSize="auto",r.style.backgroundPosition="0 0"):(r.style.backgroundImage=`url("${String(V("PAPER_BACKDROP","./assets/paper-print-v1.svg"))}")`,r.style.backgroundRepeat="repeat",r.style.backgroundSize=`${256*s}px ${256*s}px`,r.style.backgroundPosition=`${l}px ${b}px`)}if(i(),d(window,"resize",i),typeof ResizeObserver=="function"){let a=new ResizeObserver(i);a.observe(r),x.push(()=>a.disconnect())}return i}let ge=he("paper"),{canvas:Q,ctx:p}=ae(),z=Array(9).fill(0),P=1,B="ready",U=0,w=45,v=143,A=300,S=100;function ee(){let e=N(1),t=u(".opponent-name");t&&(t.textContent=e,t.title=e,t.setAttribute("aria-label","Avversario: "+e)),Q.setAttribute("aria-label","Tris: tu contro "+e),P===2&&B!=="result"&&(u(".turn").textContent=e+" sta pensando\u2026")}q=ee,ee();let me=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];function te(e){for(let t of me)if(e[t[0]]&&t.every(n=>e[n]===e[t[0]]))return e[t[0]];return e.every(Boolean)?3:0}function ne(e,t){let n=te(e);if(n)return n===2?10:n===1?-10:0;let o=[];for(let i=0;i<9;i++)e[i]||(e[i]=t,o.push(ne(e,t===2?1:2)),e[i]=0);return t===2?Math.max(...o):Math.min(...o)}function be(){let e=te(z);return e?(B="result",e===1?f():e===2&&$(),fe(e===1?"Hai vinto!":e===2?"Hai perso":"Pareggio","","",W),!0):!1}function ie(e,t){z[e]||B==="result"||(R(),z[e]=t,B="playing",C(500-t*70,.05,.13),r.dataset.moves=z.filter(Boolean).length,!be()&&(P=t===1?2:1,u(".turn").textContent=P===1?"Tocca a te":N(1)+" sta pensando\u2026",P===2&&(U=.4),M("playing")))}function W(){z=Array(9).fill(0),P=1,B="ready",U=0,u(".turn").textContent="Tocca a te",M("ready")}d(Q,"pointerdown",e=>{let t=se(e);P!==1||t.x<w||t.x>=w+A||t.y<v||t.y>=v+A||ie(Math.floor((t.y-v)/S)*3+Math.floor((t.x-w)/S),1)}),d(u(".reset"),"click",()=>{R(),W()}),W(),oe(e=>{if(U>0&&(U-=e,U<=0&&P===2&&B!=="result")){let t=-1/0,n=-1;for(let o of O([...Array(9).keys()]))if(!z[o]){z[o]=2;let i=ne(z,1);z[o]=0,i>t&&(t=i,n=o)}n>=0&&ie(n,2)}p.clearRect(0,0,390,598),F(p,0,68,66,19,"#151515"),F(p,1,322,66,19,"#151515"),E(p,"TU",108,66,18,"#242424"),E(p,"VS",195,66,18),p.fillStyle="#191919",p.fillRect(w+5,v+6,A+3,A+3),p.fillStyle="#fff",p.fillRect(w,v,A,A),p.strokeStyle="#191919",p.lineWidth=3,p.strokeRect(w,v,A,A);for(let t=1;t<3;t++)K(p,w+t*S,v,w+t*S,v+A,"#191919",3),K(p,w,v+t*S,w+A,v+t*S,"#191919",3);z.forEach((t,n)=>{if(!t)return;let o=w+S/2+n%3*S,i=v+S/2+Math.floor(n/3)*S;F(p,t-1,o,i,29,"#161616"),E(p,t===1?"\xD7":"\u25CB",o+32,i+30,18)})}),J(()=>{u(".guide")&&(u(".guide").textContent=String(V("GUIDE","Scegli una casella e fai tris")))}),J(ge)})();(()=>{let r=document.createElement("style");r.dataset.batch3Ui="20261116",r.textContent=`
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

.guide{font-size:20px;line-height:1.25}.opponent-name{position:absolute;top:55px;left:213px;width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;font:600 18px/1.25 UIBody,system-ui,sans-serif;color:#242424;pointer-events:none}.turn{top:456px;font-size:14px;line-height:1.4}
.bottom{bottom:66px}.bottom .pill{min-height:44px;font-size:16px}
`,r.textContent+=".result,.result h2,.result .value,.result p,.result button{font-family:Playful,UIBody,sans-serif}.result .value:empty,.result p:empty{display:none}",document.head.append(r)})();})();
