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

(()=>{function Ge(l,m){if(!l)throw new Error("Game mount target is missing");let f=String(m??""),$=E=>E.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(d,h)=>{if(h[0]==="#"){let G=h[1].toLowerCase()==="x",W=parseInt(h.slice(G?2:1),G?16:10);return W>0&&W<=1114111?String.fromCodePoint(W):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[h.toLowerCase()]||d});for(;l.firstChild;)l.removeChild(l.firstChild);let k=[{element:l,tag:"",svg:l.namespaceURI==="http://www.w3.org/2000/svg"}],x=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,y=0;for(;y<f.length;){if(f.startsWith("<!--",y)){let o=f.indexOf("-->",y+4);y=o<0?f.length:o+3;continue}if(f[y]!=="<"){let o=f.indexOf("<",y),S=o<0?f.length:o;k[k.length-1].element.appendChild(document.createTextNode($(f.slice(y,S)))),y=S;continue}let E=y+1,d="";for(;E<f.length;E++){let o=f[E];if(d)o===d&&(d="");else if(o==='"'||o==="'")d=o;else if(o===">")break}if(E>=f.length)throw new Error("Incomplete game markup");let h=f.slice(y+1,E);if(y=E+1,/^\s*!/.test(h))continue;let G=/^\s*\/\s*([\w:-]+)/.exec(h);if(G){for(let o=k.length-1;o>0;o--)if(k[o].tag.toLowerCase()===G[1].toLowerCase()){k.length=o;break}continue}let W=/^\s*([\w:-]+)/.exec(h);if(!W)throw new Error("Invalid game markup");let F=W[1],K=k[k.length-1],J=F.toLowerCase()==="svg"||K.svg&&K.tag.toLowerCase()!=="foreignobject",T=J?document.createElementNS("http://www.w3.org/2000/svg",F):document.createElement(F),le=h.slice(W[0].length).replace(/\/\s*$/,""),X=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,I;for(;I=X.exec(le);){let o=I[1],S=$(I[2]??I[3]??I[4]??"");T.setAttribute(o,S)}K.element.appendChild(T),!x.test(F)&&!/\/\s*$/.test(h)&&k.push({element:T,tag:F,svg:J})}return f}document.documentElement.lang="it";(()=>{"use strict";var ve,Me;let l=document.getElementById("root"),m=(e,n,a)=>Math.max(n,Math.min(a,e)),f=!0,$=!1,k=[];function x(e,n,a,i){e.addEventListener(n,a,i),k.push(()=>e.removeEventListener(n,a,i))}function y(e){let n=document.createElement("style");n.textContent="*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}"+e,document.head.append(n)}function E(){var e;(e=l.querySelector(".guide"))==null||e.classList.add("gone")}let d;function h(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function G(e=400,n=.1,a=.15,i="sine",t=0){if(!(!d||!f))try{let s=d.currentTime,r=d.createOscillator(),U=d.createGain();r.type=i,r.frequency.setValueAtTime(e,s),t&&r.frequency.exponentialRampToValueAtTime(Math.max(20,t),s+n),U.gain.setValueAtTime(1e-4,s),U.gain.exponentialRampToValueAtTime(a,s+.008),U.gain.exponentialRampToValueAtTime(1e-4,s+n),r.connect(U),U.connect(d.destination),r.start(s),r.stop(s+n+.02),r.onended=()=>{r.disconnect(),U.disconnect()}}catch{}}function W({gyro:e=!1,shake:n=!1,onTilt:a=()=>{},onShake:i=()=>{}}={}){let t=window.tt,s=!1,r=!1,U=!1,V=null,A=null,Ce=0,ie=0,ue=-2e3,Ae=-2e3,g={x:0,y:0,yaw:0,pitch:0,roll:0,received:!1},ke=(c,u)=>Math.atan2(Math.sin(c-u),Math.cos(c-u));function Ie(c){if(!f||!c||c.result===-1)return;let u=Number(c.pitch??c.x)||0,q=Number(c.yaw??c.y)||0,D=Number(c.roll??c.z)||0;V||(V={pitch:u,yaw:q,roll:D}),g.pitch=u,g.yaw=q,g.roll=D,g.x=m(ke(D,V.roll)/.42,-1,1),g.y=m(ke(u,V.pitch)/.42,-1,1),Math.abs(g.x)<.025&&(g.x=0),Math.abs(g.y)<.025&&(g.y=0),g.received=!0,a(g)}function Se(c){if(!f||!c)return;let u={x:Number(c.x)||0,y:Number(c.y)||0,z:Number(c.z)||0};A||(A={...u});let q=Math.max(.1,Math.hypot(A.x,A.y,A.z)),D=Math.hypot(u.x-A.x,u.y-A.y,u.z-A.z)/q;for(let he of["x","y","z"])A[he]=A[he]*.82+u[he]*.18;if(Ce++<5)return;let ne=performance.now();ne-Ae<1300||(ne-ue>1400&&(ie=0),D>.55&&ne-ue>200&&(ue=ne,ie++,ie>=2&&(ie=0,Ae=ne,i())))}function se(c,u=!1){let q=l.querySelector(".sensor");q&&(q.textContent=c,q.hidden=u)}function ze(){if(!(s||!f)){if(s=!0,V=null,A=null,Ce=0,e&&(t!=null&&t.startGyroscope)&&(t!=null&&t.onGyroscopeChange)&&(r=!0,t.onGyroscopeChange(Ie),t.startGyroscope({interval:50,fail:()=>{r=!1,s=!1,se("Attiva inclinazione")}})),n&&(t!=null&&t.startAccelerometer)&&(t!=null&&t.onAccelerometerChange)&&t.startAccelerometer({success:()=>{U=!0,t.onAccelerometerChange(Se)},fail:()=>{s=!1,se("Attiva movimento")}}),e&&!r||!e&&n&&!(t!=null&&t.startAccelerometer)){s=!1,se("Movimento non disponibile");return}se("Movimento attivo",!0)}}function re(){var c,u,q,D;s=!1,r&&((c=t==null?void 0:t.offGyroscopeChange)==null||c.call(t,Ie),(u=t==null?void 0:t.stopGyroscope)==null||u.call(t,{}),r=!1),U&&((q=t==null?void 0:t.offAccelerometerChange)==null||q.call(t,Se),(D=t==null?void 0:t.stopAccelerometer)==null||D.call(t),U=!1),g.x=0,g.y=0,V=null,A=null}let Be=l.querySelector(".sensor");return Be&&x(Be,"click",c=>{c.stopPropagation(),h(),ze()}),x(window,"pagehide",re),x(document,"visibilitychange",()=>{document.hidden&&re()}),x(window,"message",c=>{var u;c.source!==parent||((u=c.data)==null?void 0:u.type)!=="playable-active"||(f=c.data.active===!0,f||(re(),d==null||d.suspend().catch(()=>{})))}),{state:g,start:ze,stop:re,recenter(){V=null}}}function F(e){let n=390,a=598,i=e.getContext("2d");function t(){let s=e.getBoundingClientRect();n=Math.max(1,s.width),a=Math.max(1,s.height);let r=Math.min(2,window.devicePixelRatio||1);e.width=Math.round(n*r),e.height=Math.round(a*r),i.setTransform(r,0,0,r,0,0)}return t(),x(window,"resize",t),{ctx:i,get W(){return n},get H(){return a}}}function K(e){let n=0;function a(i){if($)return;let t=Math.min(.034,(i-(n||i))/1e3);n=i,document.hidden||e(f?t:0,i/1e3),requestAnimationFrame(a)}requestAnimationFrame(a)}x(window,"pagehide",()=>{$=!0,k.splice(0).forEach(e=>e()),d==null||d.close().catch(()=>{})});let J={};function T(e,n){return J[e]??n}async function le(e=()=>{}){let n,a=new AbortController;try{n=setTimeout(()=>a.abort(),1800);let i=await fetch("./game.config.json",{signal:a.signal});if(!i.ok)throw new Error("Configuration unavailable");let t=await i.json();for(let s of["texts","tweaks","images"])for(let r of Array.isArray(t[s])?t[s]:[])r&&typeof r.id=="string"&&(J[r.id]=s==="images"?r.path:r.value);e(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(n)}}y("@font-face{font-family:Bangers;src:url('./assets/Bangers-Regular.woff2')}body{background:#fbf0ce;color:#56341d}.cat-game{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none}canvas{width:100%;height:100%;display:block}.cat-game .guide{color:#69422b;text-shadow:0 1px #fff;font-family:Bangers,Arial,sans-serif;font-size:23px;top:33%}.hud{position:absolute;top:27px;left:30px;right:30px;display:flex;justify-content:space-between;font:28px Bangers,Arial,sans-serif;pointer-events:none}.cat-game .sensor{background:#fff5dfcf;border-color:#c89a6d;color:#69422b;bottom:24px}.result{position:absolute;inset:0;z-index:15;display:grid;place-items:center;background:#57341e36;backdrop-filter:blur(3px)}.result[hidden]{display:none}.card{width:calc(100% - 60px);max-width:330px;text-align:center;background:#fff4d9;border:2px solid #a16a43;border-radius:18px;padding:28px 22px;box-shadow:0 6px 0 #d8b887,0 18px 45px #44281140}.card h1{font:32px Bangers;margin:0 0 12px}.height{font:58px Bangers;color:#b96932}.card p{font-size:14px}.card button{border:2px solid #8d4d29;border-radius:12px;background:#c78b58;color:#fff5de;font:22px Bangers;padding:10px 25px;box-shadow:0 3px 0 #8b4e2c}"),Ge(l,'<div class="cat-game"><canvas aria-label="Gatto che salta tra mensole di legno"></canvas><div class="hud"><span class="score">0m</span><span class="time">60s</span></div><div class="guide">Inclina per guidare il laser</div><button class="sensor">Attiva inclinazione</button><div class="result" hidden><div class="card"><h1>Che bella scalata!</h1><div class="height">0m</div><p>Proviamo ad arrivare pi\xF9 in alto?</p><button>Riprova</button></div></div></div>');let X=l.querySelector("canvas"),I=F(X),{ctx:o}=I,S=new Image,z=new Image;S.src="./assets/leaping-tabby.webp",z.src="./assets/idle-tabby-v1.webp";let R=new Image,B=new Image,Q=new Map;R.src="./assets/storybook-v2/cozy-wall.webp",B.src="./assets/storybook-v3/honey-shelf-front.webp",B.onload=()=>Q.clear();let pe=l.querySelector(".score"),ce=l.querySelector(".time"),ge=l.querySelector(".result"),Z=60,b="ready",_=60,v=0,ee=0,M=[],P=195,w=400,H=0,N=0,Y=195,O=260,oe=400,j=0,L=195,p=null,te=-1,ae=new Set;function C(){return I.H*390/I.W}function me(e){let n=(e.step||0)+1,a=n%3===0,i=e.x+e.w/2,t=a?i>=195?-1:1:i>245?-1:i<145?1:Math.random()<.5?-1:1,s=a?165+Math.random()*60:45+Math.random()*75;return{x:m(i+t*s,65,325)-46,y:e.y-(a?48+Math.random()*14:69+Math.random()*12),w:92,step:n}}function xe(){b="ready",te=-1,_=Z,v=0,ee=0,P=195,Y=195,oe=C()-163,w=oe,H=0,N=0,j=0,L=195,M=[{x:148,y:oe+35,w:94,step:0}],p=M[0],l.dataset.grounded="true";for(let e=1;e<60;e++)M.push(me(M[M.length-1]));O=C()*.45,ge.hidden=!0,pe.textContent="0m",ce.textContent=Z+"s",l.dataset.phase=b,l.querySelector(".guide").classList.remove("gone")}let ye=W({gyro:!0,onTilt:e=>{L=m(195+e.x*175,30,360),O=m(C()*.35+e.y*C()*.2,95,C()*.65),b==="ready"&&(Math.abs(e.x)>.08||Math.abs(e.y)>.08)&&de()}});function Pe(){return O<w-v-6}function fe(){!p||!Pe()||(p=null,H=-540,N=m((L-P)*2.7,-440,440),j=.18,G(480+Math.random()*70,.065,.07,"sine",620))}function de(){b==="ready"&&(h(),E(),b="playing",l.dataset.phase=b,fe())}function qe(){b="finished",l.dataset.phase=b,ge.hidden=!1,l.querySelector(".height").textContent=Math.floor(ee/8)+"m",G(440,.3,.12,"sine",220)}x(l.querySelector(".card button"),"click",xe),x(X,"pointerdown",e=>{h(),ye.start(),X.setPointerCapture(e.pointerId),we(e),de()});function we(e){let n=X.getBoundingClientRect();L=m((e.clientX-n.left)*390/n.width,25,365),O=m((e.clientY-n.top)*390/n.width,70,C()*.8)}x(X,"pointermove",e=>{(e.buttons||e.pointerType==="touch")&&we(e)}),x(window,"keydown",e=>{["ArrowLeft","ArrowRight"].includes(e.key)&&(e.preventDefault(),ae.add(e.key),de(),ye.start())}),x(window,"keyup",e=>ae.delete(e.key));function Ee(e){if(!B.complete||!B.naturalWidth)return null;if(Q.has(e))return Q.get(e);let n=document.createElement("canvas");n.width=Math.ceil(e*2),n.height=26;let a=n.getContext("2d"),i=B.naturalWidth,t=B.naturalHeight,s=i*52/1024,r=Math.min(n.width*.18,s*n.height/t);return a.drawImage(B,0,0,s,t,0,0,r,n.height),a.drawImage(B,s,0,i-s*2,t,r,0,n.width-r*2,n.height),a.drawImage(B,i-s,0,s,t,n.width-r,0,r,n.height),Q.set(e,n),n}function Te(e){let n=e.y-v,a=Ee(e.w);o.save(),o.shadowColor="#85593833",o.shadowBlur=5,o.shadowOffsetY=4,a?o.drawImage(a,e.x,n-13*(3/67),e.w,13):(o.fillStyle="#c18b5a",o.beginPath(),o.roundRect(e.x,n,e.w,13,4),o.fill()),o.restore()}function Re(){let e=C();if(o.fillStyle="#fcf2d5",o.fillRect(0,0,390,e),R.complete&&R.naturalWidth){let n=Math.max(390/R.naturalWidth,e/R.naturalHeight),a=R.naturalWidth*n,i=R.naturalHeight*n;o.drawImage(R,(390-a)/2,(e-i)/2,a,i)}}xe();function Le(e){_=Math.max(0,_-e),ae.has("ArrowLeft")&&(L=Math.max(25,L-260*e)),ae.has("ArrowRight")&&(L=Math.min(365,L+260*e));let n=m((L-P)*5.5,-420,420);N+=(n-N)*(1-Math.exp(-(p?12:5.5)*e));let a=m(P+N*e,25,365);if((a===25||a===365)&&(N=0),P=a,p&&(P+23<=p.x||P-23>=p.x+p.w?p=null:(w=p.y-35,H=0,fe())),!p){let t=w;if(H+=1120*e,w+=H*e,H>0){for(let s of M)if(t+35<=s.y+2&&w+35>=s.y&&P+23>s.x&&P-23<s.x+s.w){w=s.y-35,H=0,p=s,j=.18,fe();break}}}w-v<C()*.43&&(v=w-C()*.43),ee=Math.max(ee,oe-w);let i=M[M.length-1];i.y>v-250&&M.push(me(i)),M=M.filter(t=>t.y<v+C()+150),pe.textContent=Math.floor(ee/8)+"m",ce.textContent=Math.ceil(_)+"s",l.dataset.grounded=String(!!p),(w-v>C()+90||_<=0)&&qe()}let be={x:293.5/570,y:451.5/454},Ue=((Me=(ve=window.matchMedia)==null?void 0:ve.call(window,"(prefers-reduced-motion: reduce)"))==null?void 0:Me.matches)||!1;function We(e){if(N>15?te=1:N<-15&&(te=-1),o.save(),p&&z.complete&&z.naturalWidth){let n=b==="playing"&&f&&!Ue?Math.sin(e*2.5)*.009:0,a=b==="playing"&&j>0?1-.06*(j/.18):1,i=a*(1+n),t=70/z.naturalHeight;o.translate(P,w-v+35),te>0&&o.scale(-1,1),o.scale(1/Math.sqrt(i),i),o.drawImage(z,-z.naturalWidth*be.x*t,-z.naturalHeight*be.y*t,z.naturalWidth*t,z.naturalHeight*t)}else{o.translate(P,w-v),te>0&&o.scale(-1,1);let n=j?.86:1+Math.min(.06,Math.abs(H)/8e3);o.scale(1/n,n),S.complete&&S.naturalWidth&&o.drawImage(S,-47,-35,94,70)}o.restore()}K((e,n)=>{b==="playing"&&Le(e),j=Math.max(0,j-e),Y+=(L-Y)*(1-Math.exp(-14*e)),o.save(),o.scale(I.W/390,I.W/390),Re();for(let a of M)a.y-v>-15&&a.y-v<C()+15&&Te(a);o.fillStyle="#ed315b22",o.beginPath(),o.arc(Y,O,17,0,Math.PI*2),o.fill(),o.fillStyle="#ff316144",o.beginPath(),o.arc(Y,O,10,0,Math.PI*2),o.fill(),o.fillStyle="#d71e42",o.beginPath(),o.arc(Y,O,5,0,Math.PI*2),o.fill(),o.fillStyle="#fff9",o.beginPath(),o.arc(Y-1,O-1,1.4,0,Math.PI*2),o.fill(),We(n),o.restore()}),le(()=>{l.querySelector(".guide").textContent=String(T("GUIDE","Inclina per guidare il laser"));let e=T("CAT","./assets/leaping-tabby.webp");S.getAttribute("src")!==e&&(S.src=e);let n=String(T("CAT_IDLE","./assets/idle-tabby-v1.webp"));z.getAttribute("src")!==n&&(z.src=n);let a=String(T("BACKDROP","./assets/storybook-v2/cozy-wall.webp")),i=String(T("PLATFORM","./assets/storybook-v3/honey-shelf-front.webp"));R.getAttribute("src")!==a&&(R.src=a),B.getAttribute("src")!==i&&(Q.clear(),B.src=i),Z=m(Number(T("ROUND_SECONDS",60))||60,20,120),b==="ready"&&(_=Z,ce.textContent=Z+"s")})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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

.cat-game .hud{top:30px;font-size:28px}
.cat-game .guide{font-family:Bangers,UIBody,sans-serif;font-size:20px;letter-spacing:.5px;line-height:1.3}
.cat-game .sensor{bottom:50px;min-height:44px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
.cat-game .result{padding:30px 30px 50px;display:grid;overflow:auto}
.cat-game .card{width:100%;max-width:330px;padding:28px 22px}
.card h1{font:400 24px/1.3 Bangers,UIBody,sans-serif}
.height{font:400 48px/1.15 Bangers,UIBody,sans-serif}
.card p{font:400 15px/1.6 UIBody,system-ui,sans-serif}
.card button{font:400 20px/1.3 Bangers,UIBody,sans-serif;min-height:44px}
`,document.head.append(l)})();})();
