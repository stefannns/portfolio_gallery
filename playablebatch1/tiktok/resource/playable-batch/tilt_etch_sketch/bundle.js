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

(()=>{function de(u,R){if(!u)throw new Error("Game mount target is missing");let f=String(R??""),L=T=>T.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(s,h)=>{if(h[0]==="#"){let E=h[1].toLowerCase()==="x",I=parseInt(h.slice(E?2:1),E?16:10);return I>0&&I<=1114111?String.fromCodePoint(I):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[h.toLowerCase()]||s});for(;u.firstChild;)u.removeChild(u.firstChild);let S=[{element:u,tag:"",svg:u.namespaceURI==="http://www.w3.org/2000/svg"}],p=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,x=0;for(;x<f.length;){if(f.startsWith("<!--",x)){let e=f.indexOf("-->",x+4);x=e<0?f.length:e+3;continue}if(f[x]!=="<"){let e=f.indexOf("<",x),w=e<0?f.length:e;S[S.length-1].element.appendChild(document.createTextNode(L(f.slice(x,w)))),x=w;continue}let T=x+1,s="";for(;T<f.length;T++){let e=f[T];if(s)e===s&&(s="");else if(e==='"'||e==="'")s=e;else if(e===">")break}if(T>=f.length)throw new Error("Incomplete game markup");let h=f.slice(x+1,T);if(x=T+1,/^\s*!/.test(h))continue;let E=/^\s*\/\s*([\w:-]+)/.exec(h);if(E){for(let e=S.length-1;e>0;e--)if(S[e].tag.toLowerCase()===E[1].toLowerCase()){S.length=e;break}continue}let I=/^\s*([\w:-]+)/.exec(h);if(!I)throw new Error("Invalid game markup");let B=I[1],N=S[S.length-1],V=B.toLowerCase()==="svg"||N.svg&&N.tag.toLowerCase()!=="foreignobject",F=V?document.createElementNS("http://www.w3.org/2000/svg",B):document.createElement(B),Q=h.slice(I[0].length).replace(/\/\s*$/,""),P=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,z;for(;z=P.exec(Q);){let e=z[1],w=L(z[2]??z[3]??z[4]??"");F.setAttribute(e,w)}N.element.appendChild(F),!p.test(B)&&!/\/\s*$/.test(h)&&S.push({element:F,tag:B,svg:V})}return f}document.documentElement.lang="it";(()=>{"use strict";let u=document.getElementById("root"),R=(n,o,a)=>Math.max(o,Math.min(a,n)),f=!0,L=!1,S=[];function p(n,o,a,i){n.addEventListener(o,a,i),S.push(()=>n.removeEventListener(o,a,i))}function x(n){let o=document.createElement("style");o.textContent="*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}"+n,document.head.append(o)}function T(){var n;(n=u.querySelector(".guide"))==null||n.classList.add("gone")}let s;function h(){try{s||(s=new(window.AudioContext||window.webkitAudioContext)),s.state==="suspended"&&s.resume().catch(()=>{})}catch{}}function E(n=400,o=.1,a=.15,i="sine",t=0){if(!(!s||!f))try{let r=s.currentTime,c=s.createOscillator(),g=s.createGain();c.type=i,c.frequency.setValueAtTime(n,r),t&&c.frequency.exponentialRampToValueAtTime(Math.max(20,t),r+o),g.gain.setValueAtTime(1e-4,r),g.gain.exponentialRampToValueAtTime(a,r+.008),g.gain.exponentialRampToValueAtTime(1e-4,r+o),c.connect(g),g.connect(s.destination),c.start(r),c.stop(r+o+.02),c.onended=()=>{c.disconnect(),g.disconnect()}}catch{}}function I({gyro:n=!1,shake:o=!1,onTilt:a=()=>{},onShake:i=()=>{}}={}){let t=window.tt,r=!1,c=!1,g=!1,C=null,m=null,y=0,A=0,W=-2e3,ie=-2e3,b={x:0,y:0,yaw:0,pitch:0,roll:0,received:!1},ae=(l,d)=>Math.atan2(Math.sin(l-d),Math.cos(l-d));function re(l){if(!f||!l||l.result===-1)return;let d=Number(l.pitch??l.x)||0,M=Number(l.yaw??l.y)||0,q=Number(l.roll??l.z)||0;C||(C={pitch:d,yaw:M,roll:q}),b.pitch=d,b.yaw=M,b.roll=q,b.x=R(ae(q,C.roll)/.42,-1,1),b.y=R(ae(d,C.pitch)/.42,-1,1),Math.abs(b.x)<.025&&(b.x=0),Math.abs(b.y)<.025&&(b.y=0),b.received=!0,a(b)}function se(l){if(!f||!l)return;let d={x:Number(l.x)||0,y:Number(l.y)||0,z:Number(l.z)||0};m||(m={...d});let M=Math.max(.1,Math.hypot(m.x,m.y,m.z)),q=Math.hypot(d.x-m.x,d.y-m.y,d.z-m.z)/M;for(let ne of["x","y","z"])m[ne]=m[ne]*.82+d[ne]*.18;if(y++<5)return;let H=performance.now();H-ie<1300||(H-W>1400&&(A=0),q>.55&&H-W>200&&(W=H,A++,A>=2&&(A=0,ie=H,i())))}function $(l,d=!1){let M=u.querySelector(".sensor");M&&(M.textContent=l,M.hidden=d)}function ce(){if(!(r||!f)){if(r=!0,C=null,m=null,y=0,n&&(t!=null&&t.startGyroscope)&&(t!=null&&t.onGyroscopeChange)&&(c=!0,t.onGyroscopeChange(re),t.startGyroscope({interval:50,fail:()=>{c=!1,r=!1,$("Attiva inclinazione")}})),o&&(t!=null&&t.startAccelerometer)&&(t!=null&&t.onAccelerometerChange)&&t.startAccelerometer({success:()=>{g=!0,t.onAccelerometerChange(se)},fail:()=>{r=!1,$("Attiva movimento")}}),n&&!c||!n&&o&&!(t!=null&&t.startAccelerometer)){r=!1,$("Movimento non disponibile");return}$("Movimento attivo",!0)}}function J(){var l,d,M,q;r=!1,c&&((l=t==null?void 0:t.offGyroscopeChange)==null||l.call(t,re),(d=t==null?void 0:t.stopGyroscope)==null||d.call(t,{}),c=!1),g&&((M=t==null?void 0:t.offAccelerometerChange)==null||M.call(t,se),(q=t==null?void 0:t.stopAccelerometer)==null||q.call(t),g=!1),b.x=0,b.y=0,C=null,m=null}let le=u.querySelector(".sensor");return le&&p(le,"click",l=>{l.stopPropagation(),h(),ce()}),p(window,"pagehide",J),p(document,"visibilitychange",()=>{document.hidden&&J()}),p(window,"message",l=>{var d;l.source!==parent||((d=l.data)==null?void 0:d.type)!=="playable-active"||(f=l.data.active===!0,f||(J(),s==null||s.suspend().catch(()=>{})))}),{state:b,start:ce,stop:J,recenter(){C=null}}}function B(n){let o=390,a=598,i=n.getContext("2d");function t(){let r=n.getBoundingClientRect();o=Math.max(1,r.width),a=Math.max(1,r.height);let c=Math.min(2,window.devicePixelRatio||1);n.width=Math.round(o*c),n.height=Math.round(a*c),i.setTransform(c,0,0,c,0,0)}return t(),p(window,"resize",t),{ctx:i,get W(){return o},get H(){return a}}}function N(n){let o=0;function a(i){if(L)return;let t=Math.min(.034,(i-(o||i))/1e3);o=i,document.hidden||n(f?t:0,i/1e3),requestAnimationFrame(a)}requestAnimationFrame(a)}p(window,"pagehide",()=>{L=!0,S.splice(0).forEach(n=>n()),s==null||s.close().catch(()=>{})});let V={};function F(n,o){return V[n]??o}async function Q(n=()=>{}){let o,a=new AbortController;try{o=setTimeout(()=>a.abort(),1800);let i=await fetch("./game.config.json",{signal:a.signal});if(!i.ok)throw new Error("Configuration unavailable");let t=await i.json();for(let r of["texts","tweaks","images"])for(let c of Array.isArray(t[r])?t[r]:[])c&&typeof c.id=="string"&&(V[c.id]=r==="images"?c.path:c.value);n(),u.dataset.config="loaded"}catch{u.dataset.config="defaults"}finally{clearTimeout(o)}}x("body{background:#291416;color:#f6dbd5}.etch{width:100%;height:100%;position:relative;touch-action:none;overflow:hidden}canvas{width:100%;height:100%;display:block}.etch .guide{top:32%;white-space:pre-line;color:#790d25;text-shadow:0 1px #fff8}.etch .sensor{bottom:18px;background:#59131b;font-family:monospace;font-size:12px}.erase{position:absolute;bottom:19px;right:30px;width:38px;height:38px;border:1px solid #a95058;border-radius:50%;background:#721426;color:#fbd9c9;font-size:23px}.etch .sensor{left:30px;transform:none}"),de(u,`<div class="etch"><canvas aria-label="Superficie della lavagna magica"></canvas><div class="etch-intro"><div class="guide">Inclina per disegnare
Scuoti per cancellare</div><button class="sensor">Attiva inclinazione</button></div><button class="erase" aria-label="Cancella il disegno">\u21BA</button></div>`);let P=u.querySelector("canvas"),z=B(P),{ctx:e}=z,w=[],v={x:.5,y:.5},O=!1,D=0,K=0,k=null,_=null,oe=-1/0;function U(n=!1){let o=k;if(o){k=null;try{let a=s.currentTime;o.gain.gain.cancelScheduledValues(a),n?o.gain.gain.setValueAtTime(0,a):o.gain.gain.setTargetAtTime(0,a,.015),o.source.stop(n?0:a+.06)}catch{o.source.disconnect(),o.filter.disconnect(),o.gain.disconnect()}n&&(o.source.disconnect(),o.filter.disconnect(),o.gain.disconnect())}}function fe(n,o){if(!(!s||s.state!=="running"||!f||document.hidden||L))try{if(!_){_=s.createBuffer(1,s.sampleRate,s.sampleRate);let t=_.getChannelData(0);for(let r=0;r<t.length;r++)t[r]=Math.random()*2-1}if(!k){let t=s.createBufferSource(),r=s.createBiquadFilter(),c=s.createGain();t.buffer=_,t.loop=!0,r.type="bandpass",r.Q.value=.7,c.gain.setValueAtTime(0,s.currentTime),t.connect(r).connect(c).connect(s.destination),t.start(),t.onended=()=>{t.disconnect(),r.disconnect(),c.disconnect()},k={source:t,filter:r,gain:c,quiet:!1}}let a=R(n/5,0,1),i=s.currentTime;k.filter.frequency.setTargetAtTime((o==="tilt"?520:850)+a*350,i,.035),k.gain.gain.cancelScheduledValues(i),k.gain.gain.setTargetAtTime((o==="tilt"?.025:.035)+a*(o==="tilt"?.025:.035),i,.025),k.quiet=!1,oe=performance.now()}catch{U(!0)}}function ue(){if(!k)return;if(!f||document.hidden||(s==null?void 0:s.state)!=="running"){U(!0);return}let n=performance.now()-oe;n>120&&!k.quiet&&(k.gain.gain.setTargetAtTime(0,s.currentTime,.025),k.quiet=!0),n>280&&U()}function Z(){O=!1,G.clear(),U(!0)}p(document,"visibilitychange",()=>{document.hidden&&Z()}),p(window,"message",n=>{var o;n.source===parent&&((o=n.data)==null?void 0:o.type)==="playable-active"&&n.data.active!==!0&&Z()}),p(window,"pagehide",Z,{capture:!0});let Y=I({gyro:!0,shake:!0,onShake:ee});function ee(){f&&(U(!0),w=[],D=1,T(),E(120,.18,.12,"triangle",60),u.dataset.strokes="0")}p(u.querySelector(".erase"),"click",()=>{h(),ee()});let G=new Set;p(window,"keydown",n=>{["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(n.key)&&(n.preventDefault(),G.add(n.key),Y.start(),h()),n.key==="Backspace"&&(n.preventDefault(),h(),ee())}),p(window,"keyup",n=>G.delete(n.key));function X(){return{x:30,y:90,w:z.W-60,h:z.H-202}}function te(n,o,a="pointer"){let i={...v};v.x=R(n,0,1),v.y=R(o,0,1);let t=X(),r=Math.hypot((v.x-i.x)*t.w,(v.y-i.y)*t.h);a!=="silent"&&r>.12&&fe(r,a),w.push([v.x,v.y]),w.length>16e3&&w.splice(0,4e3),u.dataset.strokes=String(w.length),T()}p(P,"pointerdown",n=>{h(),Y.start(),P.setPointerCapture(n.pointerId);let o=P.getBoundingClientRect(),a=X(),i=n.clientX-o.left,t=n.clientY-o.top;i>a.x&&i<a.x+a.w&&t>a.y&&t<a.y+a.h&&(O=!0,w.push(null),te((i-a.x)/a.w,(t-a.y)/a.h,"silent"))}),p(P,"pointermove",n=>{if(!O)return;let o=P.getBoundingClientRect(),a=X();te((n.clientX-o.left-a.x)/a.w,(n.clientY-o.top-a.y)/a.h)});for(let n of["pointerup","pointercancel","lostpointercapture"])p(P,n,()=>{O=!1,U()});function j(n,o,a,i,t,r,c){e.beginPath(),e.roundRect(n,o,a,i,t),e.fillStyle=r,e.fill(),c&&(e.strokeStyle=c,e.stroke())}N(n=>{let o=z.W,a=z.H,i=X(),t=Y.state.x+(G.has("ArrowRight")?1:0)-(G.has("ArrowLeft")?1:0),r=Y.state.y+(G.has("ArrowDown")?1:0)-(G.has("ArrowUp")?1:0);!O&&Math.abs(t)+Math.abs(r)>.06&&(w.length||w.push([v.x,v.y]),te(v.x+t*n*.42,v.y+r*n*.32,"tilt"),K+=n*t*3),ue(),e.clearRect(0,0,o,a);let c=e.createRadialGradient(o*.45,a*.35,20,o*.5,a*.5,a*.7);c.addColorStop(0,"#4e2225"),c.addColorStop(1,"#190f11"),e.fillStyle=c,e.fillRect(0,0,o,a),e.shadowColor="#0009",e.shadowBlur=18,e.shadowOffsetY=8,j(12,27,o-24,a-41,23,"#6f0f21","#a23843"),e.shadowBlur=0,e.shadowOffsetY=0;let g=e.createLinearGradient(0,30,o,a);g.addColorStop(0,"#ee3450"),g.addColorStop(.2,"#c81735"),g.addColorStop(.75,"#9e0c29"),g.addColorStop(1,"#720e23"),e.lineWidth=2,j(20,33,o-40,a-55,18,g,"#ee62715c"),j(i.x-6,i.y-6,i.w+12,i.h+12,10,"#7b1126","#ef65704d");let C=e.createLinearGradient(i.x,0,i.x+i.w,0);C.addColorStop(0,"#cdcec1"),C.addColorStop(.5,"#d7d9cb"),C.addColorStop(1,"#c8cbbf"),j(i.x,i.y,i.w,i.h,7,C,"#9aab9b"),e.save(),e.beginPath(),e.roundRect(i.x,i.y,i.w,i.h,7),e.clip(),e.strokeStyle="#63705b08",e.lineWidth=3;for(let y=12;y<i.w;y+=23)e.beginPath(),e.moveTo(i.x+y,i.y),e.lineTo(i.x+y,i.y+i.h),e.stroke();e.strokeStyle="#850e2d",e.lineWidth=2.1,e.lineCap="round",e.lineJoin="round",e.beginPath();let m=!0;for(let y of w){if(!y){m=!0;continue}let A=i.x+y[0]*i.w,W=i.y+y[1]*i.h;m?(e.moveTo(A,W),m=!1):e.lineTo(A,W)}e.stroke(),e.beginPath(),e.arc(i.x+v.x*i.w,i.y+v.y*i.h,7,0,Math.PI*2),e.lineWidth=1.6,e.stroke(),e.restore(),e.fillStyle="#f8e0cc",e.textAlign="center",e.font="700 11px monospace",e.letterSpacing="3px",e.fillText("LAVAGNA",o/2,56),e.font="700 8px monospace",e.fillText("MAGICA",o/2,68),e.letterSpacing="0px";for(let y of[52,o-52]){e.save(),e.translate(y,59),e.rotate(y===52?K:-K);let A=e.createRadialGradient(-5,-7,1,0,0,18);A.addColorStop(0,"#c93c4b"),A.addColorStop(.65,"#a4122a"),A.addColorStop(1,"#680c1c"),e.fillStyle=A,e.beginPath(),e.arc(0,0,16,0,Math.PI*2),e.fill(),e.strokeStyle="#f16c6c66",e.lineWidth=2,e.stroke(),e.strokeStyle="#550d20",e.lineWidth=3,e.beginPath(),e.moveTo(-5,-5),e.lineTo(5,5),e.moveTo(-5,5),e.lineTo(5,-5),e.stroke(),e.restore()}D>0&&(e.globalAlpha=D*.6,j(i.x,i.y,i.w,i.h,7,"#e6e9d9"),e.globalAlpha=1,D=Math.max(0,D-n*2.5))}),Q(()=>{u.querySelector(".guide").textContent=String(F("GUIDE",`Inclina per disegnare
Scuoti per cancellare`))}),x(".etch .etch-intro{position:absolute;left:42px;right:42px;top:32%;z-index:10;display:flex;flex-direction:column;align-items:center;gap:12px;pointer-events:none}.etch .etch-intro .guide{position:static;inset:auto;width:100%;margin:0}.etch .etch-intro .sensor{position:static;inset:auto;transform:none;align-self:center;max-width:100%;margin:0;white-space:normal;pointer-events:auto}")})();(()=>{let u=document.createElement("style");u.dataset.batch3Ui="20261116",u.textContent=`
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

@font-face{font-family:UIPixel;src:url('./assets/ui/Silkscreen-Regular.ttf') format('truetype');font-display:swap}
.etch .sensor{bottom:50px;font-family:UIPixel,monospace;font-size:14px;min-height:44px;padding:10px 16px}
.erase{bottom:50px;right:30px;width:44px;height:44px;min-height:44px;font-size:24px}
.etch .guide{font-family:UIPixel,monospace;font-size:18px;line-height:1.5;top:32%;font-weight:400}
`,document.head.append(u)})();})();
