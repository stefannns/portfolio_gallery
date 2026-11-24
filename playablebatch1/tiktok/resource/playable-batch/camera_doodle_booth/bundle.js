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

(()=>{function Tt(l,K){if(!l)throw new Error("Game mount target is missing");let g=String(K??""),Z=v=>v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(w,m)=>{if(m[0]==="#"){let p=m[1].toLowerCase()==="x",f=parseInt(m.slice(p?2:1),p?16:10);return f>0&&f<=1114111?String.fromCodePoint(f):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[m.toLowerCase()]||w});for(;l.firstChild;)l.removeChild(l.firstChild);let C=[{element:l,tag:"",svg:l.namespaceURI==="http://www.w3.org/2000/svg"}],X=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,b=0;for(;b<g.length;){if(g.startsWith("<!--",b)){let u=g.indexOf("-->",b+4);b=u<0?g.length:u+3;continue}if(g[b]!=="<"){let u=g.indexOf("<",b),U=u<0?g.length:u;C[C.length-1].element.appendChild(document.createTextNode(Z(g.slice(b,U)))),b=U;continue}let v=b+1,w="";for(;v<g.length;v++){let u=g[v];if(w)u===w&&(w="");else if(u==='"'||u==="'")w=u;else if(u===">")break}if(v>=g.length)throw new Error("Incomplete game markup");let m=g.slice(b+1,v);if(b=v+1,/^\s*!/.test(m))continue;let p=/^\s*\/\s*([\w:-]+)/.exec(m);if(p){for(let u=C.length-1;u>0;u--)if(C[u].tag.toLowerCase()===p[1].toLowerCase()){C.length=u;break}continue}let f=/^\s*([\w:-]+)/.exec(m);if(!f)throw new Error("Invalid game markup");let I=f[1],r=C[C.length-1],F=I.toLowerCase()==="svg"||r.svg&&r.tag.toLowerCase()!=="foreignobject",y=F?document.createElementNS("http://www.w3.org/2000/svg",I):document.createElement(I),B=m.slice(f[0].length).replace(/\/\s*$/,""),j=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,k;for(;k=j.exec(B);){let u=k[1],U=Z(k[2]??k[3]??k[4]??"");y.setAttribute(u,U)}r.element.appendChild(y),!X.test(I)&&!/\/\s*$/.test(m)&&C.push({element:y,tag:I,svg:F})}return g}document.documentElement.lang="it";(()=>{"use strict";let l=document.getElementById("root"),K=(t,e,o)=>Math.max(e,Math.min(o,t)),g=(t,e)=>t+Math.random()*(e-t),Z=t=>t[Math.floor(Math.random()*t.length)],C=t=>t[t.length-1],X=t=>{for(let e=t.length-1;e>0;e--){let o=Math.floor(Math.random()*(e+1));[t[e],t[o]]=[t[o],t[e]]}return t},b=[],v=[],w=!0,m=!1,p;function f(t,e,o,i){t.addEventListener(e,o,i),b.push(()=>t.removeEventListener(e,o,i))}function I(t,e,o="#faf8f1"){let i=document.createElement("style");i.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(i),l.style.background=o,Tt(l,'<div class="fit">'+e+"</div>");let n=l.querySelector(".fit");function a(){let s=l.getBoundingClientRect(),c=Math.min(s.width/390,s.height/598);n.style.transform=`translate(${(s.width-390*c)/2}px,${(s.height-598*c)/2}px) scale(${c})`,l.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}a(),f(window,"resize",a)}function r(t){return l.querySelector(t)}function F(){var t;(t=r(".guide"))==null||t.classList.add("gone")}function y(t){l.dataset.phase=t}function B(){j(),F()}function j(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function k(t=450,e=.08,o=.18,i="sine",n=0){if(!(!p||!w))try{let a=p.createOscillator(),s=p.createGain(),c=p.currentTime;a.type=i,a.frequency.setValueAtTime(t,c),n&&a.frequency.exponentialRampToValueAtTime(Math.max(30,n),c+e),s.gain.setValueAtTime(.001,c),s.gain.exponentialRampToValueAtTime(o,c+.006),s.gain.exponentialRampToValueAtTime(.001,c+e),a.connect(s),s.connect(p.destination),a.start(c),a.stop(c+e+.02),a.onended=()=>{a.disconnect(),s.disconnect()}}catch{}}function u(){k(523,.12,.18),setTimeout(()=>k(784,.17,.16),100)}function U(){k(180,.22,.18,"triangle",65)}function bt(t){let e=0;function o(i){if(m)return;let n=Math.min(.035,(i-(e||i))/1e3);e=i,document.hidden||t(w?n:0,i/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function At(){let t=r("canvas.stage"),e=t.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return t.width=390*o,t.height=598*o,e.scale(o,o),{canvas:t,ctx:e}}function Pt(t,e=r("canvas.stage")){let o=e.getBoundingClientRect();return{x:(t.clientX-o.left)*390/o.width,y:(t.clientY-o.top)*598/o.height}}function Y(t,e,o,i,n,a){a=Math.min(Math.abs(i)/2,Math.abs(n)/2,a),t.moveTo(e+a,o),t.lineTo(e+i-a,o),t.quadraticCurveTo(e+i,o,e+i,o+a),t.lineTo(e+i,o+n-a),t.quadraticCurveTo(e+i,o+n,e+i-a,o+n),t.lineTo(e+a,o+n),t.quadraticCurveTo(e,o+n,e,o+n-a),t.lineTo(e,o+a),t.quadraticCurveTo(e,o,e+a,o),t.closePath()}function zt(t,e,o,i,n,a,s,c){t.beginPath(),Y(t,e,o,i,n,a),s&&(t.fillStyle=s,t.fill()),c&&(t.strokeStyle=c,t.stroke())}function Et(t,e,o,i,n,a){t.beginPath(),t.arc(e,o,Math.max(.01,i),0,Math.PI*2),n&&(t.fillStyle=n,t.fill()),a&&(t.strokeStyle=a,t.stroke())}function $t(t,e,o,i,n,a,s=2){t.beginPath(),t.moveTo(e,o),t.lineTo(i,n),t.strokeStyle=a,t.lineWidth=s,t.stroke()}function tt(t,e,o,i,n=18,a="#25252a",s="UIBody",c="center"){t.font=`700 ${n}px ${s}`,t.fillStyle=a,t.textAlign=c,t.textBaseline="middle",t.fillText(e,o,i)}let et=[];function V(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(H(e,t))}function qt(t){let e=new Image;return e.onerror=()=>{l.dataset.assetIssue="image"},e.src=V(t),et.push({im:e,path:t}),e}function W(t,e,o,i,n,a){if(!e)return!1;let s=e.videoWidth||e.naturalWidth||e.width,c=e.videoHeight||e.naturalHeight||e.height;if(!s||!c)return!1;let h=Math.max(n/s,a/c);return t.save(),t.beginPath(),t.rect(o,i,n,a),t.clip(),t.drawImage(e,o+(n-s*h)/2,i+(a-c*h)/2,s*h,c*h),t.restore(),!0}function Bt(t,e,o,i,n){t.save(),t.beginPath(),t.arc(o,i,n,0,Math.PI*2),t.clip(),W(t,e,o-n,i-n,n*2,n*2),t.restore()}function Ut(t,e,o,i){let n=r(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=t,n.querySelector(".value").textContent=e,n.querySelector("p").textContent=o;let a=n.querySelector("button");a.onclick=()=>{n.hidden=!0,B(),i()},y("result")}function Rt(t="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function vt(){let t=r(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let ot=[];function it(t){w=t,t||p==null||p.suspend().catch(()=>{});for(let e of ot)e(t)}f(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&it(t.data.active===!0)}),f(document,"visibilitychange",()=>{it(!document.hidden)}),f(window,"pagehide",()=>{m=!0,b.splice(0).forEach(t=>t()),v.splice(0).forEach(t=>t()),p==null||p.close().catch(()=>{})});let nt={};function H(t,e){return nt[t]??e}async function xt(t=()=>{}){let e=new AbortController,o=setTimeout(()=>e.abort(),1600);try{let i=await fetch("./game.config.json",{signal:e.signal});if(!i.ok)throw Error("Configurazione non disponibile");let n=await i.json();for(let a of["texts","tweaks","images"])for(let s of n[a]||[])nt[s.id]=a==="images"?s.path:s.value;for(let a of et){let s=V(a.path);a.im.getAttribute("src")!==s&&(a.im.src=s)}for(let a of l.querySelectorAll('img[src^="./assets/"]'))a.src=V(a.getAttribute("src"));t(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(o)}}let S=null,R="user",P=!1,L=0,_=!1,at=!0,d=(t,e)=>at?e:t;function z(){let t=r("video.preview");return _&&(S!=null&&S.getVideoTracks().some(e=>e.readyState==="live"&&e.enabled))&&(t==null?void 0:t.readyState)>=2&&t.videoWidth>0&&t.videoHeight>0?t:null}function E(t,e){l.dataset.camera=t;let o=r(".cam-status"),i=r(".cam-enable");o&&(o.textContent=e),i&&(i.disabled=!1,i.setAttribute("aria-pressed",String(t==="enabled")),i.textContent=P?d("Connessione\u2026 \xB7 Annulla","Connessione\u2026 \xB7 Annulla"):t==="enabled"?d("Fotocamera attiva \xB7 Interrompi","Fotocamera attiva \xB7 Interrompi"):d("Attiva fotocamera","Attiva fotocamera"));for(let n of l.querySelectorAll(".shutter,.cam-capture"))n.disabled=!z()}function T(){L++,_=!1,P=!1;let t=S;S=null,t==null||t.getTracks().forEach(o=>o.stop());let e=r("video.preview");e&&(e.pause(),e.srcObject=null),E("idle",d("Attiva la fotocamera per scattare una foto","Attiva la fotocamera per scattare una foto"))}async function st(){var o;if(P)return;T();let t=++L;P=!0,E("requesting",d("In attesa della fotocamera\u2026","In attesa della fotocamera\u2026"));let e;try{if(!((o=navigator.mediaDevices)!=null&&o.getUserMedia))throw Error("Fotocamera non disponibile");if(e=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:R}},audio:!1}),m||!w||t!==L){e.getTracks().forEach(a=>a.stop());return}S=e;let i=r("video.preview");i.muted=!0,i.playsInline=!0,i.srcObject=e;let n;try{await Promise.race([i.play(),new Promise((a,s)=>{n=setTimeout(()=>s(Error("La fotocamera non si \xE8 avviata")),7e3)})])}finally{clearTimeout(n)}if(await new Promise((a,s)=>{let c,h=()=>{clearTimeout(c),i.removeEventListener("loadeddata",x),i.removeEventListener("canplay",x)},x=()=>{i.readyState>=2&&i.videoWidth>0&&i.videoHeight>0&&(h(),a())};i.addEventListener("loadeddata",x),i.addEventListener("canplay",x),c=setTimeout(()=>{h(),s(Error("Nessuna immagine ricevuta dalla fotocamera"))},7e3),x()}),m||!w||t!==L){e.getTracks().forEach(a=>a.stop());return}_=!0,P=!1;for(let a of e.getVideoTracks())f(a,"ended",()=>{S===e&&(T(),E("unavailable",d("Fotocamera scollegata \xB7 riprova","Fotocamera scollegata \xB7 riprova")))});E("enabled",d("Fotocamera pronta \xB7 scatta una foto","Fotocamera pronta \xB7 scatta una foto"))}catch(i){if(e==null||e.getTracks().forEach(a=>a.stop()),t!==L)return;T();let n=(i==null?void 0:i.name)==="NotAllowedError"||(i==null?void 0:i.name)==="SecurityError";E("unavailable",n?d("Accesso alla fotocamera bloccato \xB7 consenti e riprova","Accesso alla fotocamera bloccato \xB7 consenti e riprova"):d("Nessuna immagine dalla fotocamera \xB7 riprova","Nessuna immagine dalla fotocamera \xB7 riprova"))}}function wt(t=600,e=800,o=!0){let i=z();if(!i)return null;let n=document.createElement("canvas");n.width=t,n.height=e;let a=n.getContext("2d");return o&&R==="user"&&(a.translate(t,0),a.scale(-1,1)),W(a,i,0,0,t,e)?n:null}function yt(t,e="#f0ede5"){let o=t.getContext("2d"),i=t.width,n=t.height;o.fillStyle=e,o.fillRect(0,0,i,n);let a=z();if(a){o.save(),R==="user"&&(o.translate(i,0),o.scale(-1,1)),W(o,a,0,0,i,n),o.restore();return}o.save(),o.translate(i/2,n/2-8);let s=Math.min(i,n)/160;o.scale(s,s),o.strokeStyle="#767268",o.lineWidth=3,o.lineJoin="round",o.beginPath(),Y(o,-29,-19,58,38,6),o.stroke(),o.beginPath(),o.arc(0,0,10,0,Math.PI*2),o.stroke(),o.beginPath(),o.moveTo(-17,-19),o.lineTo(-12,-27),o.lineTo(12,-27),o.lineTo(17,-19),o.stroke(),o.restore()}function kt(){var e;(e=r("video.preview"))==null||e.setAttribute("aria-hidden","true");let t=document.createElement("style");t.textContent='.preview{display:block!important;position:absolute!important;width:1px!important;height:1px!important;left:0;bottom:0;opacity:.001;pointer-events:none}.cam-enable[aria-pressed="true"]{border-color:#47754b;background:#edf5e9;color:#315b35}',document.head.append(t),f(r(".cam-enable"),"click",()=>{j(),S||P?T():st()}),r(".cam-flip")&&f(r(".cam-flip"),"click",()=>{R=R==="user"?"environment":"user",T(),st()}),ot.push(o=>{o||T()}),v.push(T),E("idle",d("Attiva la fotocamera per scattare una foto","Attiva la fotocamera per scattare una foto"))}function rt(){let t=String(H("PAPER_BACKDROP","./assets/paper-print-v1.svg"));l.style.backgroundColor="#efd77b",l.style.backgroundImage="url("+JSON.stringify(t)+")",l.style.backgroundSize="256px 256px",l.style.backgroundRepeat="repeat"}function Ct(){rt();let t=document.createElement("style");t.textContent=`#root{position:relative;isolation:isolate;color:#282723}
 #root .fit{background:transparent!important}
 #root .paper-overlay{position:absolute;inset:0;z-index:40;background:transparent;pointer-events:auto;isolation:isolate}
 #root .paper-overlay[hidden]{display:none!important}
 #root .paper-result-fit{position:absolute;width:390px;height:598px;transform-origin:0 0;font-family:UIBody,system-ui,sans-serif;pointer-events:auto}
 #root .paper-result-fit .modal{background:transparent}
 #root .result,#root .comparison{background:#fff4c7;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272322}
 #root .pill{background:#282723;color:#fff9e9;border:2px solid #282723;box-shadow:0 3px 0 #28272325}
 #root .capability,#root .stop-sugar{color:#282723;background:#fff4c7;border:2px solid #282723;box-shadow:0 2px 0 #2827231c}
 #root .capability:disabled,#root .pill:disabled{box-shadow:none}
 #root .shutter{border-color:#282723;background:#fff4c7}
 #root .eyebrow,#root .booth-label,#root .guide{color:#282723}
 #root .cam-status,#root .mic-status,#root .target-label{color:#625c4b}
 #root .live-booth{border-color:#282723;border-radius:10px;box-shadow:4px 5px 0 #28272325}#root .doodles{opacity:.72}#root .shutter{box-shadow:inset 0 0 0 5px #fff4c7,inset 0 0 0 7px #282723}#root .strip-view{padding:0}#root .strip-view canvas{filter:drop-shadow(2px 3px 0 #28272328)}`,document.head.append(t);let e=l.querySelector(".fit"),o=e.querySelector(".comparison,.strip-view,.modal");if(!o)return;let i=document.createElement("div"),n=document.createElement("div");i.className="paper-overlay",n.className="paper-result-fit",i.hidden=o.hidden,n.append(o),i.append(n),l.append(i),o.setAttribute("role","dialog"),o.setAttribute("aria-modal","true");function a(){i.hidden=o.hidden,e.inert=!o.hidden,e.style.visibility=o.hidden?"visible":"hidden"}let s=new MutationObserver(a);s.observe(o,{attributes:!0,attributeFilter:["hidden"]});function c(){let x=l.getBoundingClientRect(),q=Math.min(x.width/390,x.height/598),gt=`translate(${(x.width-390*q)/2}px,${(x.height-598*q)/2}px) scale(${q})`;n.style.transform=gt,e.style.transform=gt}a(),c(),f(window,"resize",c);let h=typeof ResizeObserver=="function"?new ResizeObserver(c):null;h==null||h.observe(l),v.push(()=>{s.disconnect(),h==null||h.disconnect()})}let lt="M-7 0C-2-10 10-10 15-1C12 9-2 9-7 0ZM-7 0-15-7-14 7ZM-1-7 2-12 6-8",ct="M0-13C17-14 18 13 1 14C-17 15-18-12 0-13ZM-7 4Q0 13 7 3";function dt(t,e,o=1){return`<g transform="translate(${t} ${e}) scale(${o})"><path d="${lt}"/><circle cx="9" cy="-2" r="1.2" fill="#282723" stroke="none"/></g>`}function pt(t,e,o=1){return`<g transform="translate(${t} ${e}) scale(${o})"><path d="${ct}"/><g fill="#282723" stroke="none"><circle cx="-5" cy="-3" r="1.25"/><circle cx="5" cy="-3" r="1.25"/></g></g>`}function ut(t,e,o=1){return`<g transform="translate(${t} ${e}) scale(${o})"><path d="M-3-6C-12-19 4-22 3-8C15-20 23-4 8-2C24 4 10 19 4 6C2 23-15 18-7 4C-23 5-24-12-9-8Q-6-8-3-6Z"/><path d="M3 5q-2 10 1 17m-1-5q10-7 11-2-4 7-11 2"/><circle r="3.7"/></g>`}function ft(t,e,o=1){return`<g transform="translate(${t} ${e}) scale(${o})"><path d="M-10 13Q-20-5 9-15Q21 4-10 13ZM-11 16 6-10M-7 9-11 0M-3 3 7 2"/></g>`}function ht(t,e,o,i,n=1){t.save(),t.translate(o,i),t.scale(n,n),t.strokeStyle="#282723",t.fillStyle="#282723",t.lineWidth=1.8,t.lineCap="round",t.lineJoin="round",t.stroke(new Path2D(e==="fish"?lt:ct));for(let[a,s]of e==="fish"?[[9,-2]]:[[-5,-3],[5,-3]])t.beginPath(),t.arc(a,s,1.25,0,Math.PI*2),t.fill();t.restore()}function St(t){let e=r(t==="camera"?".cam-status":".mic-status");if(!e)return;let o=!0;e.setAttribute("role","status"),e.setAttribute("aria-live","polite");function i(){var x;let c="";if(t==="camera")["requesting","unavailable"].includes(l.dataset.camera)&&(c=e.textContent);else{let q=((x=r(".mic-enable"))==null?void 0:x.dataset.micState)||l.dataset.microphone;q==="requesting"?c="Consenti l\u2019accesso al microfono":["unavailable","error"].includes(q)&&(c="Microfono non disponibile")}e.textContent!==c&&(e.textContent=c);let h=!c.trim();e.hidden!==h&&(e.hidden=h)}let n=new MutationObserver(i);n.observe(e,{childList:!0,characterData:!0,subtree:!0});let a=new MutationObserver(i);a.observe(l,{attributes:!0,attributeFilter:[t==="camera"?"data-camera":"data-microphone"]});let s=r(".mic-enable");s&&a.observe(s,{attributes:!0,attributeFilter:["data-mic-state"]}),i(),v.push(()=>{n.disconnect(),a.disconnect()})}I(`#root .booth-label{position:absolute;left:30px;right:30px;top:30px;text-align:center;font:24px/1.3 Playful,UIBody,sans-serif;transform:none}
#root .doodles{position:absolute;inset:0;width:100%;height:100%;z-index:10;pointer-events:none;opacity:.75}
#root .live-booth{position:absolute;left:39px;top:118px;width:312px;height:293px;background:#eee9dd;border:4px solid #282723;transform:none;border-radius:10px;overflow:hidden;box-shadow:4px 5px 0 #28272325}
#root .live-booth canvas{display:block;width:100%;height:100%;filter:grayscale(1)}
#root .guide{top:432px;left:30px;right:30px;margin:0;font:400 18px/1.35 UIBody,system-ui,sans-serif}
#root .countdown{position:absolute;left:39px;top:118px;width:312px;height:293px;display:grid;place-items:center;pointer-events:none;text-align:center;font:70px/1 Playful,UIBody,sans-serif;color:#fff;text-shadow:2px 2px #28272388}
#root .cam-status{top:77px;bottom:auto;left:30px;right:30px;font:400 12px/1.4 UIBody,system-ui,sans-serif;color:#625c4b;margin:0}
#root .bottom{left:30px;right:30px;bottom:50px;display:grid;grid-template-columns:minmax(0,1fr);gap:0;align-items:center;justify-items:center;min-height:58px}
#root .bottom .capability{grid-area:1/1;width:230px;max-width:100%;min-width:0;min-height:48px;padding:8px 14px;font-size:14px;line-height:1.3}
#root .bottom .shutter{position:relative;grid-area:1/1;left:auto;bottom:auto;display:flex;align-items:center;justify-content:center;gap:10px;width:230px;max-width:100%;height:58px;min-height:58px;padding:8px 14px;border:2px solid #282723;border-radius:24px;background:#fff4c7;color:#282723;box-shadow:0 2px 0 #28272325;font:700 16px/1.3 UIBody,system-ui,sans-serif}#root .shutter svg{width:23px;height:23px;flex:none;pointer-events:none}
#root .strip-view{position:absolute;inset:30px 30px 50px;z-index:15;display:grid;grid-template-rows:minmax(0,1fr) auto minmax(18px,auto);gap:12px;align-items:center;justify-items:center;background:transparent;border:0;border-radius:0;padding:0;box-shadow:none}
#root .strip-view[hidden]{display:none}
#root .strip-view .strip{position:relative;z-index:1;align-self:center;height:100%;max-height:100%;width:auto;max-width:100%;min-height:0;min-width:0;object-fit:contain;filter:drop-shadow(2px 3px 0 #28272328)}
#root .strip-actions{position:relative;z-index:1;display:grid;grid-template-columns:1.15fr 1fr;gap:12px;width:100%}
#root .strip-actions .pill{position:static;min-width:0;min-height:48px;margin:0;padding:10px 8px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
#root .save-status{position:relative;z-index:1;min-height:18px;margin:0;width:100%;color:#625c4b;text-align:center;font:400 12px/1.4 UIBody,system-ui,sans-serif;overflow-wrap:anywhere}
#root .strip-doodles{position:absolute;inset:0;width:100%;height:100%;z-index:2;opacity:.7;pointer-events:none}
.preview{display:none}`,`<div class="booth-label">FOTO E SCARABOCCHI</div><svg class="doodles" viewBox="0 0 390 598" fill="none" stroke="#282723" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dt(18,215)}${pt(20,342)}${ut(371,199,.65)}${ft(373,341,.68)}<path d="M4 94q10-2 11-13 2 11 12 14-11 1-13 12-1-11-10-13ZM366 94q9-2 11-13 0 12 10 14-11 1-13 12-1-10-8-13ZM24 467q8-1 9-9 2 8 9 10-8 1-10 9-1-8-8-10ZM358 464l5-8 1 10 10 3-10 3-2 8-2-9-8-4Z"/></svg><div class="live-booth"><canvas width="640" height="600" aria-label="Anteprima della fotocamera"></canvas></div><video class="preview" playsinline autoplay muted></video><div class="guide">Mettiti in posa per tre foto</div><div class="countdown" aria-live="polite"></div><div class="status cam-status" hidden></div><div class="bottom"><button class="capability cam-enable">Attiva fotocamera</button><button class="shutter" aria-label="Scatta tre foto" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5 7 7l1.6-3h6.7L17 7l3.4.4.2 12-17.2.2Z"/><path d="M16.6 12.7c.2 6.1-9.4 6.1-9.2.1-.1-6 9.3-6.2 9.2-.1Z"/></svg><span class="shutter-label">Scatta foto</span></button></div><div class="strip-view" hidden aria-label="Le tue foto"><svg class="strip-doodles" viewBox="0 0 330 518" fill="none" stroke="#282723" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dt(43,128,1.35)}${pt(285,318,1.3)}${ut(283,142,.8)}${ft(44,331,.95)}<path d="M23 224q9-1 10-12 2 10 12 13-11 1-13 12-1-10-9-13ZM286 232l5-9 2 10 10 3-10 3-2 10-2-10-9-4Z"/></svg><canvas class="strip" width="720" height="2100" role="img" aria-label="La tua striscia di tre foto"></canvas><div class="strip-actions"><button class="pill save-strip">Salva immagine</button><button class="pill retake">Riscatta</button></div><p class="save-status" role="status" aria-live="polite"></p></div><div class="flash"></div>`,"#efd77b"),St("camera"),Ct();let M="ready",$=0,A=[],O=!1,N=0,D;function G(t,e=""){let o=r(".save-strip");O=t==="saving",o.disabled=O,o.setAttribute("aria-busy",String(O)),o.textContent=O?d("Saving\u2026","Salvataggio\u2026"):d("Salva immagine","Salva immagine"),r(".save-status").textContent=e,l.dataset.save=t}function Q(){N++,clearTimeout(D),G("ready")}function Mt(){var i;if(O||M!=="result"||A.length!==3)return;let t=++N,e=!1;function o(n,a){e||t!==N||m||(e=!0,clearTimeout(D),G(n,a))}G("saving",d("Salvataggio delle tue foto\u2026","Salvataggio delle tue foto\u2026"));try{let n=r(".strip").toDataURL("image/png");if(!n.startsWith("data:image/"))throw Error("Nessuna foto da salvare");let a="doodle-booth-"+Date.now();if(typeof((i=window.tt)==null?void 0:i.saveDataURL)=="function")D=setTimeout(()=>o("error",d("Nessuna conferma. Puoi riprovare.","Nessuna conferma. Puoi riprovare.")),15e3),window.tt.saveDataURL({dataURL:n,filename:a,extension:"png",saveToAlbum:"image",success(){o("saved",d("Salvata nelle tue foto.","Salvata nelle tue foto."))},fail(s){console.warn("[photo-booth] Save failed:",(s==null?void 0:s.message)||"Non disponibile"),o("error",d("Impossibile salvare. Controlla i permessi e riprova.","Impossibile salvare. Controlla i permessi e riprova."))},complete(){e||o("error",d("Nessuna conferma. Puoi riprovare.","Nessuna conferma. Puoi riprovare."))}});else{let s=document.createElement("a");s.href=n,s.download=a+".png",s.hidden=!0,document.body.append(s),s.click(),s.remove(),o("downloaded",d("Download avviato. Controlla i download.","Download avviato. Controlla i download."))}}catch(n){console.warn("[photo-booth] Export failed:",(n==null?void 0:n.message)||"Non disponibile"),o("error",d("Impossibile salvare questa immagine. Riprova.","Impossibile salvare questa immagine. Riprova."))}}f(r(".save-strip"),"click",Mt),v.push(()=>{N++,clearTimeout(D)}),r(".retake").textContent=d("Riscatta","Riscatta"),r(".strip-view").setAttribute("aria-label",d("Le tue foto","Le tue foto")),r(".shutter").setAttribute("aria-label",d("Scatta tre foto","Scatta tre foto")),Q();let mt="";function J(){let t=!!z(),e=M==="shooting",o=String(t)+":"+String(e);if(mt===o)return;mt=o;let i=r(".cam-enable"),n=r(".shutter");i.hidden=t,n.hidden=!t,n.disabled=!t||e,n.setAttribute("aria-busy",String(e)),r(".shutter-label").textContent=e?d("Scatto in corso\u2026","Scatto in corso\u2026"):d("Scatta foto","Scatta foto")}kt(),J(),r(".guide").textContent=d("Mettiti in posa per tre foto","Mettiti in posa per tre foto"),f(r(".shutter"),"click",()=>{M!=="ready"||!z()||(B(),A=[],$=3,M="shooting",J(),y("shooting"))}),f(r(".retake"),"click",()=>{Q(),B(),r(".strip-view").hidden=!0,M="ready",y("ready")});function It(){let t=r(".strip"),e=t.getContext("2d");e.setTransform(2,0,0,2,0,0),e.fillStyle="#fffdf3",e.fillRect(0,0,360,1050),A.forEach((o,i)=>{e.save(),e.filter="grayscale(1) contrast(1.1)",e.drawImage(o,20,20+i*316,320,300),e.restore()}),e.strokeStyle="#262323",e.lineWidth=2,e.strokeRect(9,9,342,1032),tt(e,"PICCOLI MOMENTI FELICI",180,989,14,"#292724","UIBody"),tt(e,new Date().toLocaleDateString(at?"it-IT":"en-US",{month:"short",day:"numeric",year:"numeric"}),180,1015,11,"#666","UIBody"),ht(e,"fish",42,991,1.2),ht(e,"face",321,996,1.05),Q(),r(".strip-view").hidden=!1,M="result",y("result"),u()}bt(t=>{if(J(),yt(r(".live-booth canvas"),"#eee9dd"),M==="shooting"){if(!z()){M="ready",A=[],r(".countdown").textContent="",y("ready");return}if($-=t,r(".countdown").textContent=$>0?Math.ceil($):"",$<=0){let e=wt(640,600);if(!e)return;A.push(e),vt(),k(100,.08,.18,"triangle",60),l.dataset.shots=A.length,A.length===3?It():$=2.2}}}),y("ready"),xt(()=>{if(rt(),r(".guide")){let t=String(H("GUIDE","Mettiti in posa per tre foto"));r(".guide").textContent=t==="Mettiti in posa per tre foto"?d(t,"Mettiti in posa per tre foto"):t}})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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

.booth-label{top:30px;font-size:24px;line-height:1.3}
.guide{top:414px;font:400 18px/1.4 UIBody,system-ui,sans-serif}
.shutter{bottom:100px;min-height:52px}
.cam-status{top:78px;bottom:auto;font-size:12px;color:#655e50}
.strip-view{inset:30px 30px 50px;flex-direction:column;gap:14px}
.strip-view canvas{max-height:calc(100% - 68px);height:auto;max-width:100%;width:auto}
.retake{position:static;min-height:44px;flex:none;margin:0}
`,document.head.append(l)})();})();
