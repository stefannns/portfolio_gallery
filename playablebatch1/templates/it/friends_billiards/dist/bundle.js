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

(()=>{function Qt(c,z){if(!c)throw new Error("Game mount target is missing");let x=String(z??""),st=k=>k.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(b,g)=>{if(g[0]==="#"){let d=g[1].toLowerCase()==="x",h=parseInt(g.slice(d?2:1),d?16:10);return h>0&&h<=1114111?String.fromCodePoint(h):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[g.toLowerCase()]||b});for(;c.firstChild;)c.removeChild(c.firstChild);let T=[{element:c,tag:"",svg:c.namespaceURI==="http://www.w3.org/2000/svg"}],ht=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,v=0;for(;v<x.length;){if(x.startsWith("<!--",v)){let u=x.indexOf("-->",v+4);v=u<0?x.length:u+3;continue}if(x[v]!=="<"){let u=x.indexOf("<",v),L=u<0?x.length:u;T[T.length-1].element.appendChild(document.createTextNode(st(x.slice(v,L)))),v=L;continue}let k=v+1,b="";for(;k<x.length;k++){let u=x[k];if(b)u===b&&(b="");else if(u==='"'||u==="'")b=u;else if(u===">")break}if(k>=x.length)throw new Error("Incomplete game markup");let g=x.slice(v+1,k);if(v=k+1,/^\s*!/.test(g))continue;let d=/^\s*\/\s*([\w:-]+)/.exec(g);if(d){for(let u=T.length-1;u>0;u--)if(T[u].tag.toLowerCase()===d[1].toLowerCase()){T.length=u;break}continue}let h=/^\s*([\w:-]+)/.exec(g);if(!h)throw new Error("Invalid game markup");let E=h[1],m=T[T.length-1],X=E.toLowerCase()==="svg"||m.svg&&m.tag.toLowerCase()!=="foreignobject",_=X?document.createElementNS("http://www.w3.org/2000/svg",E):document.createElement(E),q=g.slice(h[0].length).replace(/\/\s*$/,""),rt=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,M;for(;M=rt.exec(q);){let u=M[1],L=st(M[2]??M[3]??M[4]??"");_.setAttribute(u,L)}m.element.appendChild(_),!ht.test(E)&&!/\/\s*$/.test(g)&&T.push({element:_,tag:E,svg:X})}return x}document.documentElement.lang="it";(()=>{"use strict";let c=document.getElementById("root"),z=(t,e,n)=>Math.max(e,Math.min(n,t)),x=(t,e)=>t+Math.random()*(e-t),st=t=>t[Math.floor(Math.random()*t.length)],T=t=>t[t.length-1],ht=t=>{for(let e=t.length-1;e>0;e--){let n=Math.floor(Math.random()*(e+1));[t[e],t[n]]=[t[n],t[e]]}return t},v=[],k=[],b=!0,g=!1,d;function h(t,e,n,o){t.addEventListener(e,n,o),v.push(()=>t.removeEventListener(e,n,o))}function E(t,e,n="#faf8f1"){let o=document.createElement("style");o.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(o),c.style.background=n,Qt(c,'<div class="fit">'+e+"</div>");let a=c.querySelector(".fit");function i(){let r=c.getBoundingClientRect(),s=Math.min(r.width/390,r.height/598);a.style.transform=`translate(${(r.width-390*s)/2}px,${(r.height-598*s)/2}px) scale(${s})`,c.dataset.layout=`${Math.round(r.width)}x${Math.round(r.height)}`}i(),h(window,"resize",i)}function m(t){return c.querySelector(t)}function X(){var t;(t=m(".guide"))==null||t.classList.add("gone")}function _(t){c.dataset.phase=t}function q(){rt(),X()}function rt(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function M(t=450,e=.08,n=.18,o="sine",a=0){if(!(!d||!b))try{let i=d.createOscillator(),r=d.createGain(),s=d.currentTime;i.type=o,i.frequency.setValueAtTime(t,s),a&&i.frequency.exponentialRampToValueAtTime(Math.max(30,a),s+e),r.gain.setValueAtTime(.001,s),r.gain.exponentialRampToValueAtTime(n,s+.006),r.gain.exponentialRampToValueAtTime(.001,s+e),i.connect(r),r.connect(d.destination),i.start(s),i.stop(s+e+.02),i.onended=()=>{i.disconnect(),r.disconnect()}}catch{}}function u(){M(523,.12,.18),setTimeout(()=>M(784,.17,.16),100)}function L(){M(180,.22,.18,"triangle",65)}function Et(t){let e=0;function n(o){if(g)return;let a=Math.min(.035,(o-(e||o))/1e3);e=o,document.hidden||t(b?a:0,o/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function _t(){let t=m("canvas.stage"),e=t.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return t.width=390*n,t.height=598*n,e.scale(n,n),{canvas:t,ctx:e}}function Rt(t,e=m("canvas.stage")){let n=e.getBoundingClientRect();return{x:(t.clientX-n.left)*390/n.width,y:(t.clientY-n.top)*598/n.height}}function Ut(t,e,n,o,a,i){i=Math.min(Math.abs(o)/2,Math.abs(a)/2,i),t.moveTo(e+i,n),t.lineTo(e+o-i,n),t.quadraticCurveTo(e+o,n,e+o,n+i),t.lineTo(e+o,n+a-i),t.quadraticCurveTo(e+o,n+a,e+o-i,n+a),t.lineTo(e+i,n+a),t.quadraticCurveTo(e,n+a,e,n+a-i),t.lineTo(e,n+i),t.quadraticCurveTo(e,n,e+i,n),t.closePath()}function lt(t,e,n,o,a,i,r,s){t.beginPath(),Ut(t,e,n,o,a,i),r&&(t.fillStyle=r,t.fill()),s&&(t.strokeStyle=s,t.stroke())}function R(t,e,n,o,a,i){t.beginPath(),t.arc(e,n,Math.max(.01,o),0,Math.PI*2),a&&(t.fillStyle=a,t.fill()),i&&(t.strokeStyle=i,t.stroke())}function Z(t,e,n,o,a,i,r=2){t.beginPath(),t.moveTo(e,n),t.lineTo(o,a),t.strokeStyle=i,t.lineWidth=r,t.stroke()}function mt(t,e,n,o,a=18,i="#25252a",r="UIBody",s="center"){t.font=`700 ${a}px ${r}`,t.fillStyle=i,t.textAlign=s,t.textBaseline="middle",t.fillText(e,n,o)}let gt=[];function ct(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(vt(e,t))}function te(t){let e=new Image;return e.onerror=()=>{c.dataset.assetIssue="image"},e.src=ct(t),gt.push({im:e,path:t}),e}function Bt(t,e,n,o,a,i){if(!e||!e.width)return;let r=e.videoWidth||e.width,s=e.videoHeight||e.height;if(!r||!s)return;let f=Math.max(a/r,i/s);t.save(),t.beginPath(),t.rect(n,o,a,i),t.clip(),t.drawImage(e,n+(a-r*f)/2,o+(i-s*f)/2,r*f,s*f),t.restore()}function qt(t,e,n,o,a){t.save(),t.beginPath(),t.arc(n,o,a,0,Math.PI*2),t.clip(),Bt(t,e,n-a,o-a,a*2,a*2),t.restore()}function Lt(t,e,n,o){let a=m(".modal");if(!a)return;a.hidden=!1,a.querySelector("h2").textContent=t,a.querySelector(".value").textContent=e,a.querySelector("p").textContent=n;let i=a.querySelector("button");i.onclick=()=>{a.hidden=!0,q(),o()},_("result")}function $t(t="Gioca ancora"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function ee(){let t=m(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let yt=[];function xt(t){b=t,t||d==null||d.suspend().catch(()=>{});for(let e of yt)e(t)}h(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&xt(t.data.active===!0)}),h(document,"visibilitychange",()=>{xt(!document.hidden)}),h(window,"pagehide",()=>{g=!0,v.splice(0).forEach(t=>t()),k.splice(0).forEach(t=>t()),d==null||d.close().catch(()=>{})});let bt={};function vt(t,e){return bt[t]??e}async function Ot(t=()=>{}){let e=new AbortController,n=setTimeout(()=>e.abort(),1600);try{let o=await fetch("./game.config.json",{signal:e.signal});if(!o.ok)throw Error("Configurazione non disponibile");let a=await o.json();for(let i of["texts","tweaks","images"])for(let r of a[i]||[])bt[r.id]=i==="images"?r.path:r.value;for(let i of gt){let r=ct(i.path);i.im.getAttribute("src")!==r&&(i.im.src=r)}for(let i of c.querySelectorAll('img[src^="./assets/"]'))i.src=ct(i.getAttribute("src"));t(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(n)}}let I=[{nickname:"Bean",avatar:"./assets/friend-bean.webp"},{nickname:"Kitty",avatar:"./assets/friend-kitty.webp"},{nickname:"Cloudy",avatar:"./assets/friend-cloudy.webp"},{nickname:"Starry",avatar:"./assets/friend-starry.webp"}],wt=()=>{};function Ft(){var e;function t(n){I=n.slice(0,24).map(o=>({nickname:String(o.nickname||"Amico"),avatar:o.avatar,image:null}));for(let o of I){let a;try{a=new Image,a.onload=()=>{o.image=a,wt()},a.onerror=()=>{o.image=null},a.src=o.avatar}catch{o.image=null}}wt()}t(I),c.dataset.friends="sample",typeof((e=window.tt)==null?void 0:e.getFriendsInfo)=="function"&&window.tt.getFriendsInfo({success(n){let o=Array.isArray(n==null?void 0:n.friends)?n.friends.filter(a=>a&&typeof a.avatar=="string"):[];o.length&&(t(o),c.dataset.friends="host")},fail(){c.dataset.friends="sample"}})}function Nt(t,e,n,o,a,i="#fff"){let r=I[(e%I.length+I.length)%I.length];t.save(),t.shadowColor="#25212d20",t.shadowBlur=6,R(t,n,o,a,i),t.shadowBlur=0,r!=null&&r.image?qt(t,r.image,n,o,Math.max(1,a-2)):(R(t,n,o,Math.max(1,a-2),["#efb5a9","#b3d6ce","#e3cb8f","#c6b8df"][e%4]),mt(t,Array.from((r==null?void 0:r.nickname)||"?")[0],n,o,a*.7,"#fff")),t.restore()}function jt(t){var e;return((e=I[(t%I.length+I.length)%I.length])==null?void 0:e.nickname)||"Amico"}function ne(t,e,n,o,a=13){mt(t,Array.from(jt(e)).slice(0,15).join(""),n,o,a)}Ft(),E(".shot-power{position:absolute;top:0;left:0;width:30px;height:96px;display:grid;place-items:center;z-index:7;pointer-events:none}.power-track{position:relative;width:9px;height:56px;border:1px solid #e0d4b550;border-radius:5px;background:#d9ceb025;overflow:hidden}.power-fill{position:absolute;inset:0;background:linear-gradient(to top,#62d879 0%,#e6dc59 46%,#f5a340 72%,#f15b4f 100%);clip-path:inset(100% 0 0)}.shot-power.at-max .power-track{border-color:#f8ac9a}.fit{background:#252b26;color:#e0d4b5}.hud{font-size:18px;top:34px;font-family:Georgia,serif}.guide{top:75px;font-size:14px;color:#d2c8ac;font-weight:500}.result{background:#eee4c9;color:#363729;border:5px solid #63513a;border-radius:8px}.pill{background:#355d4d}.bottom{bottom:18px}.reset{background:transparent;color:#cdbd9b;border:1px solid #b8a47a55;border-radius:50%;width:35px;min-height:35px;font-size:21px}",`<canvas class="stage" aria-label="Tavolo da biliardo con gli amici"></canvas><div class="hud"><span class="pocketed">0 / 6</span><span class="shots">0 / 10</span></div><div class="shot-power" role="meter" aria-label="Potenza del tiro" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="power-track"><div class="power-fill"></div></div></div><div class="guide">Trascina indietro e rilascia</div><div class="bottom"><button class="reset" aria-label="Ricomincia la partita">\u21BB</button></div>${$t()}`,"#252b26");let{canvas:U,ctx:l}=_t(),y=[],$=0,O=0,A="ready",w=null,P=!1,ft=0,H=[],B=null,K=null,J=!1,Q=8,Ct=70,Mt=104,kt=806,Dt=1050,It=26.2,Gt=It*Math.sqrt(3)/2,Tt=t=>z((t-Q)/(Ct-Q),0,1),Ht=t=>Mt+(kt-Mt)*t+(Dt-kt)*t**3,F=m(".shot-power"),At=m(".power-fill");function Kt(t){let o=[];for(let a of[37,-37,57,-57,77,-77])for(let i of[0,-30,30]){let r=z(t.x+a-15,52,308),s=z(t.y-96/2+i,132,404),f=Math.abs(a)*.03+Math.abs(i)*.05;for(let p of y){let C=z(p.x,r,r+30),D=z(p.y,s,s+96),G=Math.hypot(p.x-C,p.y-D)-p.r-5;G<0&&(f+=(p.cue?1e4:100)+G*G)}o.push({x:r,y:s,score:f})}return o.reduce((a,i)=>i.score<a.score?i:a)}function N(){let t=j(),e=!!t&&b&&!P&&A!=="result";F.hidden=!e;let n=e&&w?Tt(Math.hypot(t.x-w.x,t.y-w.y)):0,o="inset("+((1-n)*100).toFixed(1)+"% 0 0)",a=String(Math.round(n*100));if(At.style.clipPath!==o&&(At.style.clipPath=o),F.getAttribute("aria-valuenow")!==a&&F.setAttribute("aria-valuenow",a),F.classList.toggle("at-max",n>=.999),e){let i=Kt(t),r=`translate(${i.x.toFixed(1)}px,${i.y.toFixed(1)}px)`;F.style.transform!==r&&(F.style.transform=r)}}function S(){let t=B;w=null,B=null,K=null,J=!1,N();try{t!==null&&U.hasPointerCapture(t)&&U.releasePointerCapture(t)}catch{}}let Pt=18,Vt=14,Yt=29,Wt=20,Xt=t=>t.cue?Wt:Yt,St=[[47,126],[343,126],[47,315],[343,315],[47,504],[343,504]],tt=document.createElement("canvas");tt.width=300,tt.height=380;let et=tt.getContext("2d");et.fillStyle="#1e5144",et.fillRect(0,0,300,380);for(let t=0;t<18e3;t++)et.fillStyle=Math.random()<.5?"#37655128":"#112b2325",et.fillRect(x(0,300),x(0,380),1,1);function dt(){y=[{x:195,y:420,vx:0,vy:0,cue:!0,r:13}];let t=0;for(let e=0;e<3;e++)for(let n=0;n<=e;n++)y.push({x:195+(n-e/2)*It,y:266-e*Gt,vx:0,vy:0,r:13,type:t++});$=0,O=0,A="ready",P=!1,S(),H=[],m(".pocketed").textContent="0 / 6",m(".shots").textContent="0 / 10",_("ready")}function zt(t){A="result",S(),N(),t?u():L(),Lt(t?"Tavolo completato":"Bei tiri!",O+" / 6",`${$} tiri \xB7 ${O===6?"Tutti gli amici sono in buca.":"Un\u2019altra partita?"}`,dt)}function j(){return y.find(t=>t.cue)}function Zt(){return y.some(t=>Math.hypot(t.vx,t.vy)>4)}function ut(t){if(!Number.isFinite(t.clientX)||!Number.isFinite(t.clientY))return null;let e=Rt(t);return Number.isFinite(e.x)&&Number.isFinite(e.y)?e:null}function Jt(t){if(t.pointerId!==B||!w)return;if(!b||g||document.hidden||P||A==="result"){S();return}if(t.pointerType==="mouse"&&t.buttons===0){nt(t,!0);return}let e=ut(t);if(!e)return;w=e;let n=j();n&&K&&Math.hypot(e.x-K.x,e.y-K.y)>=3&&Math.hypot(n.x-e.x,n.y-e.y)>=Q&&(J=!0),t.preventDefault(),N()}function nt(t,e=!1){if(t.pointerId!==B||!w)return;if(!b||g||document.hidden||P||A==="result"){S();return}let n=j(),o=e?w:ut(t)||w,a=J;if(!n){S();return}let i=n.x-o.x,r=n.y-o.y,s=Math.hypot(i,r);if(S(),s<Q||e&&!a)return;t.preventDefault(),q();let f=Ht(Tt(s));n.vx=i/s*f,n.vy=r/s*f,$++,m(".shots").textContent=$+" / 10",P=!0,ft=0,A="playing",_("playing"),N(),M(170,.06,.19,"triangle",80),c.dataset.shots=$}h(U,"pointerdown",t=>{if(!b||g||document.hidden||P||A==="result"||B!==null||t.button!==0)return;let e=ut(t),n=j();if(!(!e||!n||Math.hypot(e.x-n.x,e.y-n.y)>65)){w=e,K=e,J=!1,B=t.pointerId;try{U.setPointerCapture(t.pointerId)}catch{}t.preventDefault(),q(),N()}}),h(window,"pointermove",Jt,{capture:!0,passive:!1}),h(window,"pointerup",t=>nt(t),{capture:!0,passive:!1}),h(window,"pointercancel",t=>nt(t,!0),{capture:!0,passive:!1}),h(U,"lostpointercapture",t=>{if(!(t.pointerId!==B||!w)){if(!b||g||document.hidden||P||A==="result"){S();return}try{if(U.setPointerCapture(t.pointerId),U.hasPointerCapture(t.pointerId))return}catch{}nt(t,!0)}}),yt.push(t=>{t||S()}),k.push(S),h(m(".reset"),"click",()=>{q(),dt()}),dt();let ot=0;Et(t=>{if(ot=Math.max(0,ot-t),P&&A!=="result"){ft+=t;let o=y.reduce((i,r)=>Math.max(i,Math.hypot(r.vx,r.vy)),0),a=Math.max(4,Math.ceil(o*t/4));for(let i=0;i<a;i++){let r=t/a;for(let s of[...y]){s.x+=s.vx*r,s.y+=s.vy*r;let f=Math.exp(-1.05*r);s.vx*=f,s.vy*=f;let p=St.find(([C,D])=>Math.hypot(s.x-C,s.y-D)<Xt(s));if(p){H.push({x:p[0],y:p[1],life:.35}),y=y.filter(C=>C!==s),s.cue||(O++,m(".pocketed").textContent=O+" / 6",M(220,.1,.13,"sine",90));continue}s.x<60&&(s.x=60,s.vx=Math.abs(s.vx)*.85),s.x>330&&(s.x=330,s.vx=-Math.abs(s.vx)*.85),s.y<138&&(s.y=138,s.vy=Math.abs(s.vy)*.85),s.y>492&&(s.y=492,s.vy=-Math.abs(s.vy)*.85)}for(let s=0;s<y.length;s++)for(let f=s+1;f<y.length;f++){let p=y[s],C=y[f],D=C.x-p.x,G=C.y-p.y,V=Math.hypot(D,G);if(V>=26||V<.001)continue;let Y=D/V,W=G/V,it=(26-V)/2+.01;p.x-=Y*it,p.y-=W*it,C.x+=Y*it,C.y+=W*it;let pt=(C.vx-p.vx)*Y+(C.vy-p.vy)*W;if(pt<0){let at=-pt*.96;p.vx-=at*Y,p.vy-=at*W,C.vx+=at*Y,C.vy+=at*W,ot===0&&Math.abs(pt)>35&&(M(1100,.025,.08,"triangle"),ot=.05)}}}if(ft>.3&&!Zt()){P=!1;for(let i of y)i.vx=0,i.vy=0;if(O===6)zt(!0);else if($>=10)zt(!1);else if(!j()){let i={x:195,y:420,vx:0,vy:0,r:13,cue:!0};for(;y.some(r=>Math.hypot(r.x-i.x,r.y-i.y)<30)&&i.y<480;)i.y+=15;y.push(i)}}}N(),l.fillStyle="#252b26",l.fillRect(0,0,390,598),l.shadowColor="#0009",l.shadowBlur=16,l.shadowOffsetY=7,lt(l,23,104,344,422,17,"#4c3827","#8f7952"),l.shadowBlur=0,l.shadowOffsetY=0;let e=l.createLinearGradient(25,0,365,0);e.addColorStop(0,"#8a6842"),e.addColorStop(.3,"#4d3929"),e.addColorStop(.7,"#59422b"),e.addColorStop(1,"#9c8056"),lt(l,28,109,334,412,14,e),lt(l,40,119,310,390,9,"#315a49"),l.drawImage(tt,48,127,294,378),Z(l,195,137,195,497,"#aac0a609",1);for(let o of[170,222,274,356,408,460])for(let a of[32,357])l.save(),l.translate(a,o),l.rotate(Math.PI/4),l.fillStyle="#c9bd9a",l.fillRect(-2,-2,4,4),l.restore();for(let[o,a]of St)R(l,o,a,Pt,"#171a15","#5a5139"),R(l,o,a,Vt,"#0b1210");for(let o of y)l.save(),l.shadowColor="#06130c88",l.shadowBlur=5,l.shadowOffsetY=3,o.cue?R(l,o.x,o.y,13,"#e9e8da","#e1e1d2"):Nt(l,o.type,o.x,o.y,13,"#e5e1d1"),l.restore(),R(l,o.x-3,o.y-4,3,"#ffffff44");let n=j();if(w&&n){let o=n.x-w.x,a=n.y-w.y,i=Math.max(1,Math.hypot(o,a)),r=o/i,s=a/i,f=Math.min(i,Ct);l.save(),l.setLineDash([3,6]),Z(l,n.x+r*18,n.y+s*18,n.x+r*150,n.y+s*150,"#e9e7c680",1),l.restore(),Z(l,n.x-r*(18+f*.3),n.y-s*(18+f*.3),n.x-r*(130+f*.3),n.y-s*(130+f*.3),"#bfac74",4),Z(l,n.x-r*(18+f*.3),n.y-s*(18+f*.3),n.x-r*(30+f*.3),n.y-s*(30+f*.3),"#e8e4d6",3)}for(let o of H)o.life-=t,l.globalAlpha=o.life/.35,R(l,o.x,o.y,Pt+1-o.life*5,null,"#b9cda5"),l.globalAlpha=1;H=H.filter(o=>o.life>0)}),Ot(()=>{m(".guide")&&(m(".guide").textContent=String(vt("GUIDE","Trascina indietro dalla battente e rilascia")))})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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

.hud{font:700 28px/1.2 Georgia,serif;top:30px}
.guide{top:150px;font:400 18px/1.4 UIBody,system-ui,sans-serif;color:#eee2c6}
.bottom{top:30px;bottom:auto;justify-content:center;pointer-events:none}
.bottom .reset{pointer-events:auto;width:44px;height:44px;min-height:44px;padding:0;font-size:24px;border-color:#d0bd8b99}
.result h2{font-family:Georgia,serif}
`,document.head.append(c)})();})();
