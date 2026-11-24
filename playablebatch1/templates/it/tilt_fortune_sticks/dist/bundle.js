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

(()=>{function Le(l,y){if(!l)throw new Error("Game mount target is missing");let h=String(y??""),J=Y=>Y.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(g,z)=>{if(z[0]==="#"){let B=z[1].toLowerCase()==="x",U=parseInt(z.slice(B?2:1),B?16:10);return U>0&&U<=1114111?String.fromCodePoint(U):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[z.toLowerCase()]||g});for(;l.firstChild;)l.removeChild(l.firstChild);let E=[{element:l,tag:"",svg:l.namespaceURI==="http://www.w3.org/2000/svg"}],S=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,I=0;for(;I<h.length;){if(h.startsWith("<!--",I)){let m=h.indexOf("-->",I+4);I=m<0?h.length:m+3;continue}if(h[I]!=="<"){let m=h.indexOf("<",I),j=m<0?h.length:m;E[E.length-1].element.appendChild(document.createTextNode(J(h.slice(I,j)))),I=j;continue}let Y=I+1,g="";for(;Y<h.length;Y++){let m=h[Y];if(g)m===g&&(g="");else if(m==='"'||m==="'")g=m;else if(m===">")break}if(Y>=h.length)throw new Error("Incomplete game markup");let z=h.slice(I+1,Y);if(I=Y+1,/^\s*!/.test(z))continue;let B=/^\s*\/\s*([\w:-]+)/.exec(z);if(B){for(let m=E.length-1;m>0;m--)if(E[m].tag.toLowerCase()===B[1].toLowerCase()){E.length=m;break}continue}let U=/^\s*([\w:-]+)/.exec(z);if(!U)throw new Error("Invalid game markup");let _=U[1],Q=E[E.length-1],Z=_.toLowerCase()==="svg"||Q.svg&&Q.tag.toLowerCase()!=="foreignobject",G=Z?document.createElementNS("http://www.w3.org/2000/svg",_):document.createElement(_),de=z.slice(U[0].length).replace(/\/\s*$/,""),$=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,w;for(;w=$.exec(de);){let m=w[1],j=J(w[2]??w[3]??w[4]??"");G.setAttribute(m,j)}Q.element.appendChild(G),!S.test(_)&&!/\/\s*$/.test(z)&&E.push({element:G,tag:_,svg:Z})}return h}document.documentElement.lang="it";(()=>{"use strict";let l=document.getElementById("root"),y=(e,o,f)=>Math.max(o,Math.min(f,e)),h=!0,J=!1,E=[];function S(e,o,f,t){e.addEventListener(o,f,t),E.push(()=>e.removeEventListener(o,f,t))}function I(e){let o=document.createElement("style");o.textContent="*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent}body{font-family:Arial,sans-serif}button{font:inherit;cursor:pointer;touch-action:manipulation}button:focus-visible{outline:3px solid #8ec5ff;outline-offset:4px}.guide{position:absolute;z-index:8;left:25px;right:25px;top:33%;text-align:center;font-size:18px;font-weight:700;line-height:1.35;pointer-events:none;animation:guide-breathe 2s ease-in-out infinite;transition:opacity .25s}.guide.gone{opacity:0;visibility:hidden}@keyframes guide-breathe{50%{opacity:.65;transform:scale(.975)}}.sensor{position:absolute;z-index:10;bottom:25px;left:50%;transform:translateX(-50%);border:1px solid currentColor;border-radius:24px;background:#ffffff10;color:inherit;padding:10px 19px;font-size:13px;white-space:nowrap;min-height:40px}.sensor[hidden]{display:none}@media(prefers-reduced-motion:reduce){.guide{animation:none!important}}"+e,document.head.append(o)}function Y(){var e;(e=l.querySelector(".guide"))==null||e.classList.add("gone")}let g;function z(){try{g||(g=new(window.AudioContext||window.webkitAudioContext)),g.state==="suspended"&&g.resume().catch(()=>{})}catch{}}function B(e=400,o=.1,f=.15,t="sine",n=0){if(!(!g||!h))try{let r=g.currentTime,s=g.createOscillator(),u=g.createGain();s.type=t,s.frequency.setValueAtTime(e,r),n&&s.frequency.exponentialRampToValueAtTime(Math.max(20,n),r+o),u.gain.setValueAtTime(1e-4,r),u.gain.exponentialRampToValueAtTime(f,r+.008),u.gain.exponentialRampToValueAtTime(1e-4,r+o),s.connect(u),u.connect(g.destination),s.start(r),s.stop(r+o+.02),s.onended=()=>{s.disconnect(),u.disconnect()}}catch{}}function U({gyro:e=!1,shake:o=!1,onTilt:f=()=>{},onShake:t=()=>{}}={}){let n=window.tt,r=!1,s=!1,u=!1,x=null,v=null,q=0,X=0,T=-2e3,L=-2e3,b={x:0,y:0,yaw:0,pitch:0,roll:0,received:!1},O=(p,d)=>Math.atan2(Math.sin(p-d),Math.cos(p-d));function R(p){if(!h||!p||p.result===-1)return;let d=Number(p.pitch??p.x)||0,k=Number(p.yaw??p.y)||0,c=Number(p.roll??p.z)||0;x||(x={pitch:d,yaw:k,roll:c}),b.pitch=d,b.yaw=k,b.roll=c,b.x=y(O(c,x.roll)/.42,-1,1),b.y=y(O(d,x.pitch)/.42,-1,1),Math.abs(b.x)<.025&&(b.x=0),Math.abs(b.y)<.025&&(b.y=0),b.received=!0,f(b)}function F(p){if(!h||!p)return;let d={x:Number(p.x)||0,y:Number(p.y)||0,z:Number(p.z)||0};v||(v={...d});let k=Math.max(.1,Math.hypot(v.x,v.y,v.z)),c=Math.hypot(d.x-v.x,d.y-v.y,d.z-v.z)/k;for(let P of["x","y","z"])v[P]=v[P]*.82+d[P]*.18;if(q++<5)return;let M=performance.now();M-L<1300||(M-T>1400&&(X=0),c>.55&&M-T>200&&(T=M,X++,X>=2&&(X=0,L=M,t())))}function W(p,d=!1){let k=l.querySelector(".sensor");k&&(k.textContent=p,k.hidden=d)}function le(){if(!(r||!h)){if(r=!0,x=null,v=null,q=0,e&&(n!=null&&n.startGyroscope)&&(n!=null&&n.onGyroscopeChange)&&(s=!0,n.onGyroscopeChange(R),n.startGyroscope({interval:50,fail:()=>{s=!1,r=!1,W("Attiva inclinazione")}})),o&&(n!=null&&n.startAccelerometer)&&(n!=null&&n.onAccelerometerChange)&&n.startAccelerometer({success:()=>{u=!0,n.onAccelerometerChange(F)},fail:()=>{r=!1,W("Attiva movimento")}}),e&&!s||!e&&o&&!(n!=null&&n.startAccelerometer)){r=!1,W("Movimento non disponibile");return}W("Movimento attivo",!0)}}function D(){var p,d,k,c;r=!1,s&&((p=n==null?void 0:n.offGyroscopeChange)==null||p.call(n,R),(d=n==null?void 0:n.stopGyroscope)==null||d.call(n,{}),s=!1),u&&((k=n==null?void 0:n.offAccelerometerChange)==null||k.call(n,F),(c=n==null?void 0:n.stopAccelerometer)==null||c.call(n),u=!1),b.x=0,b.y=0,x=null,v=null}let ce=l.querySelector(".sensor");return ce&&S(ce,"click",p=>{p.stopPropagation(),z(),le()}),S(window,"pagehide",D),S(document,"visibilitychange",()=>{document.hidden&&D()}),S(window,"message",p=>{var d;p.source!==parent||((d=p.data)==null?void 0:d.type)!=="playable-active"||(h=p.data.active===!0,h||(D(),g==null||g.suspend().catch(()=>{})))}),{state:b,start:le,stop:D,recenter(){x=null}}}function _(e){let o=390,f=598,t=e.getContext("2d");function n(){let r=e.getBoundingClientRect();o=Math.max(1,r.width),f=Math.max(1,r.height);let s=Math.min(2,window.devicePixelRatio||1);e.width=Math.round(o*s),e.height=Math.round(f*s),t.setTransform(s,0,0,s,0,0)}return n(),S(window,"resize",n),{ctx:t,get W(){return o},get H(){return f}}}function Q(e){let o=0;function f(t){if(J)return;let n=Math.min(.034,(t-(o||t))/1e3);o=t,document.hidden||e(h?n:0,t/1e3),requestAnimationFrame(f)}requestAnimationFrame(f)}S(window,"pagehide",()=>{J=!0,E.splice(0).forEach(e=>e()),g==null||g.close().catch(()=>{})});let Z={};function G(e,o){return Z[e]??o}async function de(e=()=>{}){let o,f=new AbortController;try{o=setTimeout(()=>f.abort(),1800);let t=await fetch("./game.config.json",{signal:f.signal});if(!t.ok)throw new Error("Configurazione non disponibile");let n=await t.json();for(let r of["texts","tweaks","images"])for(let s of Array.isArray(n[r])?n[r]:[])s&&typeof s.id=="string"&&(Z[s.id]=r==="images"?s.path:s.value);e(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(o)}}I(`
body{background:#170b08;color:#efddac;font-family:Georgia,serif}
.fortune{height:100%;width:100%;position:relative;overflow:hidden;touch-action:none;background:linear-gradient(#16070520,#13060245),url('./assets/shrine.webp') center/cover}
.object{position:absolute;left:50%;top:49%;height:47.6%;width:15.967vh;max-width:35.7%;transform:translate(-50%,-50%);transform-origin:50% 95%;filter:drop-shadow(6px 11px 9px #0009);touch-action:none}
.tube{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;z-index:1;pointer-events:none;user-select:none;-webkit-user-drag:none}
.tube-front{z-index:4;clip-path:polygon(0 4.8%,7% 4.8%,15% 7%,30% 9%,50% 9.6%,70% 9%,85% 7%,94% 4.8%,100% 4.8%,100% 100%,0 100%)}
.sticks{position:absolute;inset:0;z-index:2;pointer-events:none}
.stick{position:absolute;display:block;max-width:none;transform-origin:50% 100%;pointer-events:none;user-select:none;-webkit-user-drag:none;will-change:transform}
.stick.chosen{z-index:6;transform-origin:50% 50%}
.fortune .guide{top:78%;color:#eed9ac;text-shadow:0 2px 4px #000;font-weight:400;font-family:Georgia,serif;font-size:18px}
.fortune .sensor{bottom:50px;background:#2e140ebb;border-color:#947345;color:#ebd9b0}
.result{position:absolute;inset:0;z-index:20;display:grid;place-items:center;background:#0c06045e}.result[hidden]{display:none}
.paper{position:relative;width:calc(100% - 60px);max-width:330px;min-height:280px;border:2px solid #d5b76d;outline:1px solid #594620;outline-offset:-10px;padding:38px 25px 28px;text-align:center;color:#553917;background:radial-gradient(ellipse at 50% 25%,#faedbd,#d5b66e);box-shadow:0 15px 40px #0008}
.seal{position:absolute;top:-18px;left:calc(50% - 17px);width:34px;height:34px;border-radius:50%;background:#791b24;border:2px solid #b99a5e;color:#f1d291;display:grid;place-items:center;font-size:18px}
.eyebrow{font:12px UIBody,Arial,sans-serif;letter-spacing:2px}.paper h1{font:24px Georgia,serif;margin:25px 0 12px}.paper p{font:16px/1.6 Georgia,serif;margin:0 0 24px}
.paper button{background:#7a1822;color:#f1deb2;border:1px solid #b58b52;padding:11px 22px;box-shadow:0 3px 6px #523a2140;font:16px Georgia,serif;min-height:44px}
.meter{position:absolute;left:calc(50% - 42px);bottom:100px;width:84px;height:2px;background:#dfbd6333;overflow:hidden}.meter i{display:block;height:100%;width:0;background:#d8b66f}
`),Le(l,`<div class="fortune">
 <div class="object" role="img" aria-label="Scuoti il cilindro con i bastoncini della fortuna">
  <img class="tube" src="./assets/physical-v2/cylinder.webp" alt="">
  <div class="sticks"></div>
  <img class="tube tube-front" src="./assets/physical-v2/cylinder.webp" alt="" aria-hidden="true">
 </div>
 <div class="guide">Scuoti e scopri il tuo destino</div><div class="meter"><i></i></div><button class="sensor">Attiva movimento</button>
 <div class="result" hidden><div class="paper"><span class="seal">\u2726</span><div class="eyebrow">IL TUO RESPONSO</div><h1></h1><p></p><button>Estrai ancora</button></div></div>
</div>`);let $=[["Fortuna duratura","Prosegui con calma. Ci\xF2 che costruisci ora durer\xE0."],["Un nuovo inizio","Un piccolo passo oggi aprir\xE0 una porta domani."],["Buona compagnia","Una persona affine \xE8 pi\xF9 vicina di quanto pensi."],["Fortuna discreta","La risposta arriva quando le lasci spazio."],["Un futuro luminoso","La tua pazienza sta per dare i suoi frutti."],["Una bella sorpresa","Lascia un po\u2019 di spazio agli imprevisti."],["Fidati del tuo cammino","Hai pi\xF9 coraggio di quanto immagini."],["Il momento giusto","Quando arriva l\u2019occasione, fai il primo passo."]],w=l.querySelector(".object"),m=l.querySelector(".sticks"),j=l.querySelector(".result"),Me=l.querySelector(".meter i"),ke=[1,2,3].map(e=>"./assets/physical-v2/stick"+e+".webp"),ie=[32/850,35/850,42/850],N=[],i={angle:0,av:0,x:0,vx:0,targetX:0,frameX:0,frameY:0,thrustY:0,zoom:1},H=0,C="ready",A=0,ue=!1,ee=null,he=0,Se=0,ze=0,Ce=-1,ae=1,a=null,ge=0,me=-1/0,V=0,se=0,xe=0,re=0,be=0,Ye=2.8,qe=-.28,te=e=>(e=y(e,0,1),e*e*(3-2*e));for(let e=0;e<3;e++)for(let o=0;o<7;o++){let f=e*7+o,t=(o+e)%3,n=document.createElement("img");n.className="stick",n.src=ke[t],n.alt="",n.setAttribute("aria-hidden","true"),n.draggable=!1,n.style.zIndex=String(e+1),n.style.filter="brightness("+(.87+e*.065)+")";let r=.3+o*.066+(Math.random()-.5)*.012,s=.74+e*.018,u=.21+o*.095+(Math.random()-.5)*.012,x=Math.atan((u-r)*(369/1100)/(s-.065)),v={el:n,variant:t,row:e,col:o,rootX:r,rootY:s,length:.95+Math.random()*.11,rest:x,angle:x,av:0,bob:0,bv:0,lift:0};N.push(v),m.append(n),n.onload=()=>{n.naturalHeight&&(ie[t]=n.naturalWidth/n.naturalHeight)}}l.dataset.stickCount=String(N.length);let Ae=U({shake:!0,onShake:()=>{ae*=-1,ye(.48,ae)}});function ye(e,o=1){if(!h||C!=="ready")return;if(!a){let r=N.filter(s=>s.col===6);a=r[Math.floor(Math.random()*r.length)],a.el.dataset.emerging="true"}let f=y(Number(G("SHAKE_EFFORT",2.45)),1,6);z(),Y(),H=y(H+e/f,0,1);let t=Math.min(1,e*5);i.av=y(i.av+o*(20+t*80),-180,180);for(let r of N)r.av-=o*t*(.9+Math.random()*1.2),r.bv-=t*(.06+Math.random()*.12);let n=performance.now();me=n,n-ze>140&&(B(460+Math.random()*250,.05,.08,"triangle",210),ze=n)}S(w,"pointerdown",e=>{!h||C!=="ready"||ee!==null||e.isPrimary===!1||(z(),Ae.start(),w.setPointerCapture(e.pointerId),ee=e.pointerId,ue=!0,Se=he=e.clientX)}),S(w,"pointermove",e=>{if(!ue||e.pointerId!==ee||C!=="ready")return;let o=e.clientX-he;he=e.clientX,i.targetX=y((e.clientX-Se)*.3,-22,22),Math.abs(o)>1&&ye(Math.abs(o)/180,Math.sign(o))});function ne(){let e=ee;ue=!1,ee=null,i.targetX=0,e!==null&&w.hasPointerCapture(e)&&w.releasePointerCapture(e)}for(let e of["pointerup","pointercancel","lostpointercapture"])S(w,e,ne);S(window,"keydown",e=>{e.code==="Space"&&!e.repeat&&(e.preventDefault(),Ae.start(),ae*=-1,ye(.37,ae))}),S(document,"visibilitychange",()=>{document.hidden&&ne()}),S(window,"message",e=>{var o;e.source===parent&&((o=e.data)==null?void 0:o.type)==="playable-active"&&!e.data.active&&ne()});function Ie(){ne(),a!=null&&a.outside&&m.append(a.el),C="ready",H=0,A=0,a=null,ge=0,me=-1/0,V=0,se=0,xe=0,re=0,be=0,j.hidden=!0,Me.style.width="0%",Object.assign(i,{angle:0,av:0,x:0,vx:0,targetX:0,frameX:0,frameY:0,thrustY:0,zoom:1});for(let e of N)e.angle=e.rest,e.av=0,e.bob=0,e.bv=0,e.lift=0,e.outside=!1,e.freePose=null,e.outsideStart=null,e.outsideProgress=0,e.el.style.visibility="visible",e.el.style.zIndex=String(e.row+1),delete e.el.dataset.emerging;Ee(0,w.clientWidth,w.clientHeight),Xe(w.clientWidth,w.clientHeight),l.dataset.phase=C}S(l.querySelector(".paper button"),"click",Ie);function Te(){let e=Math.floor(Math.random()*$.length);e===Ce&&(e=(e+1)%$.length),Ce=e,l.querySelector(".paper h1").textContent=$[e][0],l.querySelector(".paper p").textContent=$[e][1],j.hidden=!1,C="revealed",l.dataset.phase=C,B(660,.5,.07,"sine",880)}function Pe(e,o){e.pose=o,e.el.style.left=o.x-o.width/2+"px",e.el.style.top=o.y-o.length+"px",e.el.style.width=o.width+"px",e.el.style.height=o.length+"px",e.el.style.transform="rotate("+o.angle*180/Math.PI+"deg)"}function Ee(e,o,f){for(let t of N){if(t===a&&t.freePose){let L=t.length*f,b=y(L*ie[t.variant],7,16);t.angle=t.freePose.angle,Pe(t,{x:t.freePose.x*o,y:t.freePose.y*f,length:L,width:b,angle:t.angle});continue}let n=t===a,r=Math.max(.01,t.rootY-.03),s=n?y(t.lift/r,0,1):0,u=n?t.rest*(1-s)+qe*s:t.rest,x=n?58:38+t.row*5+t.col%3*3;t.av+=(-(t.angle-u)*x-t.av*(n?10:6.5)-i.av*Math.PI/180*.11)*e,t.angle+=t.av*e,t.bv+=(-t.bob*86-t.bv*8)*e,t.bob=y(t.bob+t.bv*e,-.065,.012);let v=(t.rootY+t.bob-t.lift)*f,q=t.rootX*o;if(v>f*.065){let L=Math.max(2,v-f*.065),b=y(t.length*f*ie[t.variant],7,16)/2,O=Math.atan((o*.13+b-q)/L),R=Math.atan((o*.87-b-q)/L);t.angle<O&&(t.angle=O,t.av=n?Math.max(0,t.av):Math.abs(t.av)*.3,n||(t.bv-=.01)),t.angle>R&&(t.angle=R,t.av=n?Math.min(0,t.av):-Math.abs(t.av)*.3,n||(t.bv-=.01))}let X=t.length*f,T=y(X*ie[t.variant],7,16);Pe(t,{x:q,y:v,length:X,width:T,angle:t.angle})}}function Xe(e,o,f=0){if(i.frameX=0,i.frameY=0,i.zoom=1,a){let t=i.angle*Math.PI/180,n=Math.cos(t),r=Math.sin(t),s=e*.5,u=o*.95,x=l.clientWidth*.5-e*.5+i.x,v=l.clientHeight*.49-o*.5+i.thrustY,q=(c,M,P=i.zoom)=>({x:x+s+P*((c-s)*n-(M-u)*r),y:v+u+P*((c-s)*r+(M-u)*n)}),X=[{x:0,y:0},{x:e,y:0},{x:e,y:o},{x:0,y:o}];for(let c of N){let M=c.pose;if(!M)continue;let P=Math.cos(M.angle),fe=Math.sin(M.angle),pe=M.width/2;for(let K of[0,M.length])for(let oe of[-1,1])X.push({x:M.x+fe*K+oe*P*pe,y:M.y-P*K+oe*fe*pe})}let T=X.map(c=>q(c.x,c.y,1)),L=Math.max(...T.map(c=>c.x))-Math.min(...T.map(c=>c.x)),b=Math.max(...T.map(c=>c.y))-Math.min(...T.map(c=>c.y)),O=a.outside?1-a.outsideProgress:y((a.lift-.1)/(a.rootY+.045-.1),0,1),R=1-.18*te(O);i.zoom=Math.min(R,Math.max(1,l.clientWidth-60)/Math.max(1,L),Math.max(1,l.clientHeight-150)/Math.max(1,b));let F=X.map(c=>q(c.x,c.y)),W=Math.min(...F.map(c=>c.x)),le=Math.max(...F.map(c=>c.x)),D=Math.min(...F.map(c=>c.y)),ce=Math.max(...F.map(c=>c.y)),p=(c,M,P,fe=30,pe=30)=>{let K=fe-c,oe=P-pe-M;if(K<=oe+.01)return y(0,K,Math.max(K,oe));let we=8-c,ve=P-8-M;return we<=ve?y(0,we,ve):(we+ve)/2};i.frameX=p(W,le,l.clientWidth),i.frameY=p(D,ce,l.clientHeight,30,120);let d=a.pose,k=q(d.x+Math.sin(d.angle)*d.length/2,d.y-Math.cos(d.angle)*d.length/2);k.x+=i.frameX,k.y+=i.frameY,a.worldCenter&&f>0&&(a.velocity={x:(k.x-a.worldCenter.x)/f,y:(k.y-a.worldCenter.y)/f}),a.worldCenter=k}w.style.transform=`translate(-50%,-50%) translate(${i.x+i.frameX}px,${i.frameY+i.thrustY}px) rotate(${i.angle}deg) scale(${i.zoom})`}Q(e=>{let o=w.clientHeight,f=w.clientWidth;if(i.av+=(-i.angle*70-i.av*10)*e,i.angle=y(i.angle+i.av*e,-11,11),i.vx+=((i.targetX-i.x)*80-i.vx*10)*e,i.x+=i.vx*e,C==="ready"&&(H=Math.max(0,H-e*.025),a)){performance.now()-me<650&&(ge+=e),V=Math.min(H,y(ge/Ye,0,1));let t=(a.rootY-.03)*.18*V;a.lift+=(t-a.lift)*Math.min(1,e*3.5),V>=.999&&(C="picking",A=0,se=a.lift,xe=i.angle,re=i.angle,be=i.thrustY,ne(),l.dataset.phase=C)}if(C==="picking"){A+=e;let t=y(A/.4,0,1),n=1-te(t),r=Math.sin(t*Math.PI*4)*Math.sin(t*Math.PI)*(1-.3*t);i.angle=xe*n+6*r,i.thrustY=be*n+3*r,e>0&&(i.av=(i.angle-re)/e),re=i.angle;let s=a.rootY+.045;if(A<1.35)a.lift=se+(s-se)*te((A-.25)/1.1);else if(A<1.85)a.lift=s+.008*Math.sin((A-1.35)/.5*Math.PI);else if(!a.outsideStart)a.lift=s;else if(A<2.45){let u=te((A-1.85)/.6),x=a.outsideStart;a.freePose={x:x.x+(-.8-x.x)*u,y:x.y+(-.055-x.y)*u,angle:x.angle+(.08-x.angle)*u}}else{let u=te((A-2.45)/1);a.freePose={x:-.8,y:-.055+.995*u,angle:.08},a.outsideProgress=u}}if(Ee(e,f,o),Xe(f,o,e),Me.style.width=V*100+"%",l.dataset.shakeProgress=V.toFixed(3),C==="picking"&&A>=1.35&&!a.outside){let t=a.pose;t.y+Math.abs(Math.sin(t.angle))*t.width/2<=o*.035&&(w.append(a.el),a.el.style.zIndex="6",a.outside=!0,a.outsideProgress=0)}if(C==="picking"&&A>=1.85&&a.outside&&!a.outsideStart){let t=a.pose;a.outsideStart={x:t.x/f,y:t.y/o,angle:t.angle}}C==="picking"&&A>=3.55&&(i.thrustY=0,i.angle=0,Te())}),Ie(),de(()=>{l.querySelector(".guide").textContent=String(G("GUIDE","Scuoti e scopri il tuo destino")),l.querySelector(".fortune").style.backgroundImage="linear-gradient(#16070520,#13060245),url("+JSON.stringify(String(G("BACKGROUND","./assets/shrine.webp")))+")",l.querySelectorAll(".tube").forEach(e=>{e.src=String(G("TUBE","./assets/physical-v2/cylinder.webp"))});for(let e of N)e.el.src=String(G("STICK_"+(e.variant+1),ke[e.variant]))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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

.fortune .guide{font:400 18px/1.4 Georgia,serif;top:78%;left:30px;right:30px}
.fortune .sensor{bottom:50px;min-height:44px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
.fortune .result{padding:30px 30px 50px;overflow:auto;display:grid}
.paper{width:100%;max-width:330px;padding:36px 25px 28px}
.paper h1{font-size:24px;line-height:1.3}.paper p{font-size:16px;line-height:1.6}
.paper button{font-size:16px;min-height:44px}.eyebrow{font:400 12px/1.4 UIBody,system-ui,sans-serif;letter-spacing:2px}
.fortune .meter{bottom:100px}
`,document.head.append(l)})();})();
