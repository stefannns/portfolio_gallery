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

(()=>{function Ae(l,Z){if(!l)throw new Error("Game mount target is missing");let k=String(Z??""),ae=A=>A.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(T,y)=>{if(y[0]==="#"){let b=y[1].toLowerCase()==="x",p=parseInt(y.slice(b?2:1),b?16:10);return p>0&&p<=1114111?String.fromCodePoint(p):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[y.toLowerCase()]||T});for(;l.firstChild;)l.removeChild(l.firstChild);let R=[{element:l,tag:"",svg:l.namespaceURI==="http://www.w3.org/2000/svg"}],de=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,z=0;for(;z<k.length;){if(k.startsWith("<!--",z)){let x=k.indexOf("-->",z+4);z=x<0?k.length:x+3;continue}if(k[z]!=="<"){let x=k.indexOf("<",z),j=x<0?k.length:x;R[R.length-1].element.appendChild(document.createTextNode(ae(k.slice(z,j)))),z=j;continue}let A=z+1,T="";for(;A<k.length;A++){let x=k[A];if(T)x===T&&(T="");else if(x==='"'||x==="'")T=x;else if(x===">")break}if(A>=k.length)throw new Error("Incomplete game markup");let y=k.slice(z+1,A);if(z=A+1,/^\s*!/.test(y))continue;let b=/^\s*\/\s*([\w:-]+)/.exec(y);if(b){for(let x=R.length-1;x>0;x--)if(R[x].tag.toLowerCase()===b[1].toLowerCase()){R.length=x;break}continue}let p=/^\s*([\w:-]+)/.exec(y);if(!p)throw new Error("Invalid game markup");let H=p[1],d=R[R.length-1],J=H.toLowerCase()==="svg"||d.svg&&d.tag.toLowerCase()!=="foreignobject",O=J?document.createElementNS("http://www.w3.org/2000/svg",H):document.createElement(H),W=y.slice(p[0].length).replace(/\/\s*$/,""),X=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,q;for(;q=X.exec(W);){let x=q[1],j=ae(q[2]??q[3]??q[4]??"");O.setAttribute(x,j)}d.element.appendChild(O),!de.test(H)&&!/\/\s*$/.test(y)&&R.push({element:O,tag:H,svg:J})}return k}document.documentElement.lang="it";(()=>{"use strict";let l=document.getElementById("root"),Z=(e,t,i)=>Math.max(t,Math.min(i,e)),k=(e,t)=>e+Math.random()*(t-e),ae=e=>e[Math.floor(Math.random()*e.length)],R=e=>e[e.length-1],de=e=>{for(let t=e.length-1;t>0;t--){let i=Math.floor(Math.random()*(t+1));[e[t],e[i]]=[e[i],e[t]]}return e},z=[],A=[],T=!0,y=!1,b;function p(e,t,i,r){e.addEventListener(t,i,r),z.push(()=>e.removeEventListener(t,i,r))}function H(e,t,i="#faf8f1"){let r=document.createElement("style");r.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(r),l.style.background=i,Ae(l,'<div class="fit">'+t+"</div>");let o=l.querySelector(".fit");function n(){let a=l.getBoundingClientRect(),s=Math.min(a.width/390,a.height/598);o.style.transform=`translate(${(a.width-390*s)/2}px,${(a.height-598*s)/2}px) scale(${s})`,l.dataset.layout=`${Math.round(a.width)}x${Math.round(a.height)}`}n(),p(window,"resize",n)}function d(e){return l.querySelector(e)}function J(){var e;(e=d(".guide"))==null||e.classList.add("gone")}function O(e){l.dataset.phase=e}function W(){X(),J()}function X(){try{b||(b=new(window.AudioContext||window.webkitAudioContext)),b.state==="suspended"&&b.resume().catch(()=>{})}catch{}}function q(e=450,t=.08,i=.18,r="sine",o=0){if(!(!b||!T))try{let n=b.createOscillator(),a=b.createGain(),s=b.currentTime;n.type=r,n.frequency.setValueAtTime(e,s),o&&n.frequency.exponentialRampToValueAtTime(Math.max(30,o),s+t),a.gain.setValueAtTime(.001,s),a.gain.exponentialRampToValueAtTime(i,s+.006),a.gain.exponentialRampToValueAtTime(.001,s+t),n.connect(a),a.connect(b.destination),n.start(s),n.stop(s+t+.02),n.onended=()=>{n.disconnect(),a.disconnect()}}catch{}}function x(){q(523,.12,.18),setTimeout(()=>q(784,.17,.16),100)}function j(){q(180,.22,.18,"triangle",65)}function Te(e){let t=0;function i(r){if(y)return;let o=Math.min(.035,(r-(t||r))/1e3);t=r,document.hidden||e(T?o:0,r/1e3),requestAnimationFrame(i)}requestAnimationFrame(i)}function je(){let e=d("canvas.stage"),t=e.getContext("2d"),i=Math.min(2,window.devicePixelRatio||1);return e.width=390*i,e.height=598*i,t.scale(i,i),{canvas:e,ctx:t}}function Ve(e,t=d("canvas.stage")){let i=t.getBoundingClientRect();return{x:(e.clientX-i.left)*390/i.width,y:(e.clientY-i.top)*598/i.height}}function Se(e,t,i,r,o,n){n=Math.min(Math.abs(r)/2,Math.abs(o)/2,n),e.moveTo(t+n,i),e.lineTo(t+r-n,i),e.quadraticCurveTo(t+r,i,t+r,i+n),e.lineTo(t+r,i+o-n),e.quadraticCurveTo(t+r,i+o,t+r-n,i+o),e.lineTo(t+n,i+o),e.quadraticCurveTo(t,i+o,t,i+o-n),e.lineTo(t,i+n),e.quadraticCurveTo(t,i,t+n,i),e.closePath()}function Ye(e,t,i,r,o,n,a,s){e.beginPath(),Se(e,t,i,r,o,n),a&&(e.fillStyle=a,e.fill()),s&&(e.strokeStyle=s,e.stroke())}function Ge(e,t,i,r,o,n){e.beginPath(),e.arc(t,i,Math.max(.01,r),0,Math.PI*2),o&&(e.fillStyle=o,e.fill()),n&&(e.strokeStyle=n,e.stroke())}function Xe(e,t,i,r,o,n,a=2){e.beginPath(),e.moveTo(t,i),e.lineTo(r,o),e.strokeStyle=n,e.lineWidth=a,e.stroke()}function _e(e,t,i,r,o=18,n="#25252a",a="UIBody",s="center"){e.font=`700 ${o}px ${a}`,e.fillStyle=n,e.textAlign=s,e.textBaseline="middle",e.fillText(t,i,r)}let ue=[];function se(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(he(t,e))}function Q(e){let t=new Image;return t.onerror=()=>{l.dataset.assetIssue="image"},t.src=se(e),ue.push({im:t,path:e}),t}function Pe(e,t,i,r,o,n){if(!t||!t.width)return;let a=t.videoWidth||t.width,s=t.videoHeight||t.height;if(!a||!s)return;let c=Math.max(o/a,n/s);e.save(),e.beginPath(),e.rect(i,r,o,n),e.clip(),e.drawImage(t,i+(o-a*c)/2,r+(n-s*c)/2,a*c,s*c),e.restore()}function Ne(e,t,i,r,o){e.save(),e.beginPath(),e.arc(i,r,o,0,Math.PI*2),e.clip(),Pe(e,t,i-o,r-o,o*2,o*2),e.restore()}function Ie(e,t,i,r){let o=d(".modal");if(!o)return;o.hidden=!1,o.querySelector("h2").textContent=e,o.querySelector(".value").textContent=t,o.querySelector("p").textContent=i;let n=o.querySelector("button");n.onclick=()=>{o.hidden=!0,W(),r()},O("result")}function Be(e="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Ke(){let e=d(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let re=[];function pe(e){T=e,e||b==null||b.suspend().catch(()=>{});for(let t of re)t(e)}p(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&pe(e.data.active===!0)}),p(document,"visibilitychange",()=>{pe(!document.hidden)}),p(window,"pagehide",()=>{y=!0,z.splice(0).forEach(e=>e()),A.splice(0).forEach(e=>e()),b==null||b.close().catch(()=>{})});let fe={};function he(e,t){return fe[e]??t}async function qe(e=()=>{}){let t=new AbortController,i=setTimeout(()=>t.abort(),1600);try{let r=await fetch("./game.config.json",{signal:t.signal});if(!r.ok)throw Error("Configurazione non disponibile");let o=await r.json();for(let n of["texts","tweaks","images"])for(let a of o[n]||[])fe[a.id]=n==="images"?a.path:a.value;for(let n of ue){let a=se(n.path);n.im.getAttribute("src")!==a&&(n.im.src=a)}for(let n of l.querySelectorAll('img[src^="./assets/"]'))n.src=se(n.getAttribute("src"));e(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(i)}}let u=null,g=null,L=null,_=null,N=!1,V=!1,E="",ge=()=>{};function F(){u==null||u.getTracks().forEach(e=>e.stop()),u=null,g==null||g.close().catch(()=>{}),g=L=_=null,N=!1}async function me(){var e;if(!N){N=!0;try{if(!((e=navigator.mediaDevices)!=null&&e.getUserMedia))throw Error("Microfono non disponibile");if(u=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!1}}),y||!T||E==="hold"){F();return}g=new(window.AudioContext||window.webkitAudioContext),await g.resume();let t=g.createMediaStreamSource(u);L=g.createAnalyser(),L.fftSize=1024,t.connect(L),_=new Float32Array(L.fftSize),d(".mic-enable").textContent="Mic attivo",d(".mic-status").textContent="In ascolto \xB7 puoi anche tenere premuto o usare Spazio",l.dataset.microphone="enabled"}catch{N=!1,d(".mic-enable").textContent="Attiva microfono",d(".mic-status").textContent="Microfono non disponibile \xB7 tieni premuto per giocare",l.dataset.microphone="unavailable"}}}function Ee(){if(V)return .9;if(!L||!T)return 0;L.getFloatTimeDomainData(_);let e=0;for(let t of _)e+=t*t;return Z((Math.sqrt(e/_.length)-.012)*14,0,1)}function Re(){p(d(".mic-enable"),"click",()=>{X(),me()});let e=d(".voice-hold");p(e,"pointerdown",t=>{t.preventDefault(),W(),le("hold"),V=!0,e.setPointerCapture(t.pointerId)});for(let t of["pointerup","pointercancel","lostpointercapture"])p(e,t,()=>V=!1);p(window,"keydown",t=>{t.code==="Space"&&!t.repeat&&(t.preventDefault(),W(),le("hold"),V=!0)}),p(window,"keyup",t=>{t.code==="Space"&&(V=!1)}),re.push(t=>{if(t){if(g==null||g.resume().catch(()=>{}),u)for(let i of u.getTracks())i.enabled=!0}else if(V=!1,g==null||g.suspend().catch(()=>{}),u)for(let i of u.getTracks())i.enabled=!1}),A.push(F),De()}function Le(e="Tieni premuto"){return`<div class="status mic-status" hidden></div><div class="bottom"><button class="capability mic-enable">Attiva microfono</button><button class="capability voice-hold">${e}</button></div>`}function le(e){E=e,e==="hold"&&(u||N)&&F(),ge()}function De(){let e=d(".mic-enable"),t=d(".voice-hold"),i=e.parentElement,r=d(".mic-status"),o=!0,n=document.createElement("style");n.textContent="#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}",document.head.append(n);function a(){y||(e.hidden=E==="hold",t.hidden=E==="voice",i.classList.toggle("voice-mode-selected",!!E),l.dataset.voiceControl=E||"choice",E==="hold"&&(r.textContent="",r.hidden=!0))}ge=a,p(e,"click",()=>le("voice"),{capture:!0});let s=new MutationObserver(()=>{let c=l.dataset.microphone;E==="voice"&&["unavailable","error","off"].includes(c)&&(E=""),E==="hold"&&u&&F(),a()});s.observe(l,{attributes:!0,attributeFilter:["data-microphone"]}),A.push(()=>s.disconnect()),a()}function Fe(){let e=d(".mic-enable"),t=d(".mic-status"),i=new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en",o=!0?{idle:"Mic spento",requesting:"Connessione\u2026",active:"Mic attivo",paused:"Mic in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Non disponibile \xB7 usa il pulsante"}:{idle:"Mic spento",requesting:"Connessione\u2026",active:"Mic attivo",paused:"Mic in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Microfono non disponibile \xB7 tieni premuto per giocare"},n=document.createElement("style");n.textContent=".bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}",document.head.append(n);let a=!1,s=!1,c="",m=null,w=null;function M(){var S;let h=((S=u==null?void 0:u.getAudioTracks)==null?void 0:S.call(u))||[];return T&&!!L&&(g==null?void 0:g.state)==="running"&&h.some(B=>B.readyState==="live"&&B.enabled&&!B.muted)}function C(){var K;if(y)return;let h=M(),S=!!((K=u==null?void 0:u.getAudioTracks)!=null&&K.call(u).some($=>$.readyState==="live")),B=a?"requesting":h?"active":S?"paused":s?"unavailable":"idle";if(e.disabled=a,e.setAttribute("aria-pressed",String(h)),e.classList.toggle("is-listening",h),e.setAttribute("aria-label",S?o.stop:o.start),e.dataset.micState=B,l.dataset.microphone=h?"enabled":B==="idle"?"off":B,B!==c){let $=h?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M6 1h4v1h1v7h-1v1H6V9H5V2h1zM3 7h1v3h1v1h6v-1h1V7h1v4h-1v1H9v2h3v1H4v-1h3v-2H4v-1H3z"/></svg>',oe=a?o.requesting:h?o.active:S?o.paused:o.idle;Ae(e,$+'<span class="mic-button-label">'+oe+"</span>"),t.textContent=h?o.listening:s?o.unavailable:o.fallback,c=B}}function D(){if(u&&m!==u){m=u;for(let h of u.getAudioTracks())p(h,"ended",()=>{F(),s=!1,C()}),p(h,"mute",C),p(h,"unmute",C)}g&&w!==g&&(w=g,p(g,"statechange",C))}p(e,"click",async h=>{if(h.preventDefault(),h.stopImmediatePropagation(),!(a||y)){if(u){F(),s=!1,C();return}if(X(),s=!1,a=!0,C(),await me(),a=!1,y||!T){F(),C();return}(!u||!g||!L)&&(F(),s=!0),D(),c="",C()}},{capture:!0}),re.push(()=>{Promise.resolve().then(()=>{D(),C()})}),D(),C()}function $e(){let e=d("canvas.stage"),t=e.getContext("2d"),i=d(".fit"),r={left:0,top:0,right:390,bottom:598};l.style.position="relative",l.style.isolation="isolate",l.prepend(e),i.style.background="transparent",i.style.zIndex="1",Object.assign(e.style,{position:"absolute",inset:"0",width:"100%",height:"100%",zIndex:"0",pointerEvents:"none"});function o(){let n=l.getBoundingClientRect();if(!n.width||!n.height)return;let a=Math.min(2,window.devicePixelRatio||1),s=Math.min(n.width/390,n.height/598),c=(n.width-390*s)/2,m=(n.height-598*s)/2,w=Math.round(n.width*a),M=Math.round(n.height*a);(e.width!==w||e.height!==M)&&(e.width=w,e.height=M),t.setTransform(a*s,0,0,a*s,a*c,a*m),t.imageSmoothingEnabled=!1,Object.assign(r,{left:-c/s,top:-m/s,right:(n.width-c)/s,bottom:(n.height-m)/s}),i.style.transform=`translate(${c}px,${m}px) scale(${s})`}if(o(),p(window,"resize",o),typeof ResizeObserver<"u"){let n=new ResizeObserver(o);n.observe(l),A.push(()=>n.disconnect())}return{canvas:e,ctx:t,bounds:r}}function He(e){let t=d(e==="camera"?".cam-status":".mic-status");if(!t)return;let i=!0;t.setAttribute("role","status"),t.setAttribute("aria-live","polite");function r(){var m;let s="";if(e==="camera")["requesting","unavailable"].includes(l.dataset.camera)&&(s=t.textContent);else{let w=((m=d(".mic-enable"))==null?void 0:m.dataset.micState)||l.dataset.microphone;w==="requesting"?s="Consenti l\u2019accesso al microfono":["unavailable","error"].includes(w)&&(s="Microfono non disponibile")}t.textContent!==s&&(t.textContent=s);let c=!s.trim();t.hidden!==c&&(t.hidden=c)}let o=new MutationObserver(r);o.observe(t,{childList:!0,characterData:!0,subtree:!0});let n=new MutationObserver(r);n.observe(l,{attributes:!0,attributeFilter:[e==="camera"?"data-camera":"data-microphone"]});let a=d(".mic-enable");a&&n.observe(a,{attributes:!0,attributeFilter:["data-mic-state"]}),r(),A.push(()=>{o.disconnect(),n.disconnect()})}H(".fit{background:#93c7c3}.guide{top:186px;font-family:Playful,Arial;color:#fff;text-shadow:0 2px #36776c80}.hud{color:#fff;font-family:Playful,Arial;text-shadow:0 3px #36776c80}.result{background:#fff0c8}.result h2{font-family:Playful,Arial}.result .value{color:#b46c38}.pill{background:#bc783e}.capability{color:#325b52;border-color:#59998d55}",`<canvas class="stage" aria-label="Volo con la voce"></canvas><div class="hud center"><span class="score">0</span></div><div class="guide">Fai un suono per salire \xB7 taci per scendere</div>${Le("Tieni per volare")}${Be()}`,"#93c7c3"),He("microphone");let{canvas:ee,ctx:v,bounds:f}=$e(),Y="ready",P={y:300,v:0},G=[],ce=0,te=0,ne=0,be=0,U={sky:Q("./assets/pixel-v2/sky-hills.webp"),ground:Q("./assets/pixel-v2/grass-ground.webp"),bird:Q("./assets/pixel-v2/bird-flap.webp"),pipe:Q("./assets/pixel-v2/garden-pipe.webp")},I={groundOpaqueY:9,groundBodyY:26,groundFill:"#c28b46",birdPanelWidth:110,birdBodyDiameter:42,birdFrames:[{eyeBox:[60,47,71,60],yellowBox:[35,38,74,76],anchorX:55.5,anchorY:58.5,bodyDiameter:42},{eyeBox:[61,47,72,60],yellowBox:[36,38,75,76],anchorX:56.5,anchorY:58.5,bodyDiameter:42}],pipeCap:{x:0,y:0,w:52,h:23},pipeBody:{x:7,y:28,w:39,h:16}},xe=0,ye="",ve=null,we=null;Object.values(U).forEach(e=>p(e,"load",()=>{xe++}));let ie=e=>e.complete&&e.naturalWidth>0;function Oe(){let e=[ee.width,ee.height,f.left,f.top,f.right,f.bottom,xe].join("/");if(e===ye)return;ye=e;let t=v.getTransform(),i=()=>{let s=document.createElement("canvas");s.width=ee.width,s.height=ee.height;let c=s.getContext("2d");return c.setTransform(t.a,t.b,t.c,t.d,t.e,t.f),c.imageSmoothingEnabled=!1,{im:s,brush:c}},r=i(),o=i();ve=r.im,we=o.im;let n=f.right-f.left;if(r.brush.fillStyle="#39c5e7",r.brush.fillRect(f.left,f.top,n,f.bottom-f.top),ie(U.sky)){let s=U.sky,c=498-f.top,m=Math.max(n/s.naturalWidth,c/s.naturalHeight),w=s.naturalWidth*m,M=s.naturalHeight*m;r.brush.drawImage(s,(f.left+f.right-w)/2,498-M,w,M)}let a=o.brush;if(a.fillStyle=I.groundFill,a.fillRect(f.left,498,n,Math.max(0,f.bottom-498)),ie(U.ground)){let s=U.ground,c=256,m=c/s.naturalWidth,w=I.groundOpaqueY,M=I.groundBodyY,C=498-w*m,D=M*m,h=C+D;a.save(),a.beginPath(),a.rect(f.left,495,n,Math.max(0,f.bottom-495)),a.clip();for(let S=Math.floor(f.left/c)*c;S<f.right;S+=c){a.drawImage(s,0,0,s.naturalWidth,M,S,C,c,D);let B=s.naturalHeight-M,K=B*m;for(let $=h;$<f.bottom;$+=K){let oe=Math.min(K,f.bottom-$);a.drawImage(s,0,M,s.naturalWidth,oe/m,S,$,c,oe)}}a.restore()}}function Ce(e){v.save(),v.setTransform(1,0,0,1,0,0),v.drawImage(e,0,0),v.restore()}function ke(e,t,i,r=!1){let o=U.pipe;if(!ie(o)||i<=0)return;let n=I.pipeCap,a=I.pipeBody;if(!n.w||!a.w)return;let s=62,c=54,m=n.h*s/n.w,w=c/a.w,M=Math.max(0,m-2),C=Math.max(0,i-M);v.save(),r?(v.translate(e+27,t+i),v.scale(1,-1),v.translate(-27,0)):v.translate(e,t);let D=a.h*w;for(let h=0;h<C;h+=D){let S=Math.min(D,C-h);v.drawImage(o,a.x,a.y,a.w,S/w,0,M+h,c,S)}v.drawImage(o,n.x,n.y,n.w,n.h,-4,0,s,m),v.restore()}function Ue(){var c;let e=U.bird;if(!ie(e)||!I.birdBodyDiameter)return;let t=I.birdPanelWidth||e.naturalWidth/2,i=Math.sin(be)>=0?0:1,r=(c=I.birdFrames)==null?void 0:c[i],n=36/((r==null?void 0:r.bodyDiameter)||I.birdBodyDiameter),a=(r==null?void 0:r.anchorX)??I.birdAnchorX,s=(r==null?void 0:r.anchorY)??I.birdAnchorY;v.save(),v.translate(100,Math.round(P.y)),v.drawImage(e,i*t,0,t,e.naturalHeight,-a*n,-s*n,t*n,e.naturalHeight*n),v.restore()}function We(){Oe(),Ce(ve);for(let e of G)ke(e.x,f.top,e.gap-82-f.top,!0),ke(e.x,e.gap+82,500-e.gap-82);Ce(we),Ue()}function Me(){Y="ready",P={y:300,v:0},G=[{x:390,gap:270,passed:!1}],te=1.8,ce=0,ne=0,d(".score").textContent="0",O("ready")}function ze(){Y==="playing"&&(Y="result",j(),Ie("Fine partita",ne,"Tubi superati",Me))}Re(),Fe(),Me(),Te((e,t)=>{let i=Ee();if(i>.12&&Y==="ready"&&(Y="playing",W(),O("playing")),Y==="playing"){ce+=e,be+=e*(i>.1?20:5),P.v+=(i>.1?-600*i:450)*e,P.v=Z(P.v,-210,280),P.y+=P.v*e,te-=e,te<=0&&(G.push({x:430,gap:k(205,335),passed:!1}),te=1.65);let r=Math.min(170,110+ce*1.3);for(let o of G)o.x-=r*e,!o.passed&&o.x+54<100&&(o.passed=!0,ne++,d(".score").textContent=ne,q(760,.07,.12)),o.x<118&&o.x+54>82&&(P.y-13<o.gap-82||P.y+13>o.gap+82)&&ze();G=G.filter(o=>o.x>-70),(P.y<70||P.y>484)&&ze()}We()}),qe(()=>{d(".guide")&&(d(".guide").textContent=String(he("GUIDE","Fai un suono per salire \xB7 taci per scendere")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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
.hud{font-family:Playful,UIBody,sans-serif;font-size:28px}.mic-status{color:#284f49}.capability{color:#284f49;background:#fffaf0}`,document.head.append(l)})();(()=>{let l=document.createElement("style");l.textContent=`
 @font-face{font-family:FlightPixel;src:url('./assets/ui/Silkscreen-Regular.ttf') format('truetype');font-weight:400;font-style:normal;font-display:swap}
 html,body,#root,.fit,.guide,.hud,.mic-status,.capability,.pill,.result,.result h2,.result p,.result .value,button{font-family:FlightPixel,monospace!important;font-weight:400!important}
 canvas{image-rendering:pixelated}
 .hud{font-size:28px;line-height:1.25;color:#fff;text-shadow:-2px -2px #172c38,2px -2px #172c38,-2px 2px #172c38,2px 2px #172c38,0 3px #172c38}
 .guide{font-size:18px;line-height:1.45;color:#fff!important;text-shadow:-2px 0 #172c38,2px 0 #172c38,0 -2px #172c38,0 2px #172c38,-2px -2px #172c38,2px -2px #172c38,-2px 2px #172c38,2px 2px #172c38}
 .mic-status{font-size:12px;line-height:1.5;color:#fff!important;text-shadow:-1px 0 #172c38,1px 0 #172c38,0 -1px #172c38,0 1px #172c38,-1px -1px #172c38,1px -1px #172c38,-1px 1px #172c38,1px 1px #172c38}
 .bottom{gap:8px;align-items:stretch}
 .bottom .capability,.pill{font-size:14px!important;line-height:1.4;min-height:44px;border:3px solid #183b3d;border-radius:0;background:#fff1c9;color:#183b3d;box-shadow:3px 3px 0 #183b3d;padding:9px 10px}
 .bottom .capability:active,.pill:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #183b3d}
 .bottom .capability.mic-enable{flex:1 1 174px;gap:6px}
 .bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#183b3d;color:#fff;box-shadow:3px 3px 0 #183b3d}
 .mic-enable .mic-icon{width:16px;height:16px;shape-rendering:crispEdges}
 .mic-enable .mic-record-dot{width:8px;height:8px;border-radius:0;clip-path:polygon(25% 0,75% 0,75% 25%,100% 25%,100% 75%,75% 75%,75% 100%,25% 100%,25% 75%,0 75%,0 25%,25% 25%)}
 .result{background:#fff1c9;border:4px solid #183b3d;border-radius:0;box-shadow:6px 6px 0 #183b3d;color:#183b3d}
 .result h2{font-size:24px;line-height:1.35}.result p{font-size:13px;line-height:1.7}
 .result .value{font-size:48px;color:#3b7d42;text-shadow:2px 2px #b3d483}
 .result .pill{font-size:14px!important;background:#b5e27c;color:#183b3d}
 button:focus-visible{outline:3px solid #fff;outline-offset:4px}
 `,document.head.append(l)})();})();
