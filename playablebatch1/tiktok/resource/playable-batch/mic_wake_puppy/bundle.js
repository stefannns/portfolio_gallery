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

(()=>{function re(c,_){if(!c)throw new Error("Game mount target is missing");let b=String(_??""),N=y=>y.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(v,g)=>{if(g[0]==="#"){let f=g[1].toLowerCase()==="x",d=parseInt(g.slice(f?2:1),f?16:10);return d>0&&d<=1114111?String.fromCodePoint(d):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[g.toLowerCase()]||v});for(;c.firstChild;)c.removeChild(c.firstChild);let M=[{element:c,tag:"",svg:c.namespaceURI==="http://www.w3.org/2000/svg"}],J=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,x=0;for(;x<b.length;){if(b.startsWith("<!--",x)){let h=b.indexOf("-->",x+4);x=h<0?b.length:h+3;continue}if(b[x]!=="<"){let h=b.indexOf("<",x),U=h<0?b.length:h;M[M.length-1].element.appendChild(document.createTextNode(N(b.slice(x,U)))),x=U;continue}let y=x+1,v="";for(;y<b.length;y++){let h=b[y];if(v)h===v&&(v="");else if(h==='"'||h==="'")v=h;else if(h===">")break}if(y>=b.length)throw new Error("Incomplete game markup");let g=b.slice(x+1,y);if(x=y+1,/^\s*!/.test(g))continue;let f=/^\s*\/\s*([\w:-]+)/.exec(g);if(f){for(let h=M.length-1;h>0;h--)if(M[h].tag.toLowerCase()===f[1].toLowerCase()){M.length=h;break}continue}let d=/^\s*([\w:-]+)/.exec(g);if(!d)throw new Error("Invalid game markup");let q=d[1],r=M[M.length-1],W=q.toLowerCase()==="svg"||r.svg&&r.tag.toLowerCase()!=="foreignobject",I=W?document.createElementNS("http://www.w3.org/2000/svg",q):document.createElement(q),P=g.slice(d[0].length).replace(/\/\s*$/,""),j=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,z;for(;z=j.exec(P);){let h=z[1],U=N(z[2]??z[3]??z[4]??"");I.setAttribute(h,U)}r.element.appendChild(I),!J.test(q)&&!/\/\s*$/.test(g)&&M.push({element:I,tag:q,svg:W})}return b}document.documentElement.lang="it";(()=>{"use strict";let c=document.getElementById("root"),_=(e,t,n)=>Math.max(t,Math.min(n,e)),b=(e,t)=>e+Math.random()*(t-e),N=e=>e[Math.floor(Math.random()*e.length)],M=e=>e[e.length-1],J=e=>{for(let t=e.length-1;t>0;t--){let n=Math.floor(Math.random()*(t+1));[e[t],e[n]]=[e[n],e[t]]}return e},x=[],y=[],v=!0,g=!1,f;function d(e,t,n,a){e.addEventListener(t,n,a),x.push(()=>e.removeEventListener(t,n,a))}function q(e,t,n="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(a),c.style.background=n,re(c,'<div class="fit">'+t+"</div>");let o=c.querySelector(".fit");function i(){let s=c.getBoundingClientRect(),l=Math.min(s.width/390,s.height/598);o.style.transform=`translate(${(s.width-390*l)/2}px,${(s.height-598*l)/2}px) scale(${l})`,c.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}i(),d(window,"resize",i)}function r(e){return c.querySelector(e)}function W(){var e;(e=r(".guide"))==null||e.classList.add("gone")}function I(e){c.dataset.phase=e}function P(){j(),W()}function j(){try{f||(f=new(window.AudioContext||window.webkitAudioContext)),f.state==="suspended"&&f.resume().catch(()=>{})}catch{}}function z(e=450,t=.08,n=.18,a="sine",o=0){if(!(!f||!v))try{let i=f.createOscillator(),s=f.createGain(),l=f.currentTime;i.type=a,i.frequency.setValueAtTime(e,l),o&&i.frequency.exponentialRampToValueAtTime(Math.max(30,o),l+t),s.gain.setValueAtTime(.001,l),s.gain.exponentialRampToValueAtTime(n,l+.006),s.gain.exponentialRampToValueAtTime(.001,l+t),i.connect(s),s.connect(f.destination),i.start(l),i.stop(l+t+.02),i.onended=()=>{i.disconnect(),s.disconnect()}}catch{}}function h(){z(523,.12,.18),setTimeout(()=>z(784,.17,.16),100)}function U(){z(180,.22,.18,"triangle",65)}function le(e){let t=0;function n(a){if(g)return;let o=Math.min(.035,(a-(t||a))/1e3);t=a,document.hidden||e(v?o:0,a/1e3),requestAnimationFrame(n)}requestAnimationFrame(n)}function ye(){let e=r("canvas.stage"),t=e.getContext("2d"),n=Math.min(2,window.devicePixelRatio||1);return e.width=390*n,e.height=598*n,t.scale(n,n),{canvas:e,ctx:t}}function we(e,t=r("canvas.stage")){let n=t.getBoundingClientRect();return{x:(e.clientX-n.left)*390/n.width,y:(e.clientY-n.top)*598/n.height}}function ce(e,t,n,a,o,i){i=Math.min(Math.abs(a)/2,Math.abs(o)/2,i),e.moveTo(t+i,n),e.lineTo(t+a-i,n),e.quadraticCurveTo(t+a,n,t+a,n+i),e.lineTo(t+a,n+o-i),e.quadraticCurveTo(t+a,n+o,t+a-i,n+o),e.lineTo(t+i,n+o),e.quadraticCurveTo(t,n+o,t,n+o-i),e.lineTo(t,n+i),e.quadraticCurveTo(t,n,t+i,n),e.closePath()}function ke(e,t,n,a,o,i,s,l){e.beginPath(),ce(e,t,n,a,o,i),s&&(e.fillStyle=s,e.fill()),l&&(e.strokeStyle=l,e.stroke())}function Ce(e,t,n,a,o,i){e.beginPath(),e.arc(t,n,Math.max(.01,a),0,Math.PI*2),o&&(e.fillStyle=o,e.fill()),i&&(e.strokeStyle=i,e.stroke())}function Me(e,t,n,a,o,i,s=2){e.beginPath(),e.moveTo(t,n),e.lineTo(a,o),e.strokeStyle=i,e.lineWidth=s,e.stroke()}function ze(e,t,n,a,o=18,i="#25252a",s="UIBody",l="center"){e.font=`700 ${o}px ${s}`,e.fillStyle=i,e.textAlign=l,e.textBaseline="middle",e.fillText(t,n,a)}let K=[];function R(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(te(t,e))}function Ae(e){let t=new Image;return t.onerror=()=>{c.dataset.assetIssue="image"},t.src=R(e),K.push({im:t,path:e}),t}function ue(e,t,n,a,o,i){if(!t||!t.width)return;let s=t.videoWidth||t.width,l=t.videoHeight||t.height;if(!s||!l)return;let w=Math.max(o/s,i/l);e.save(),e.beginPath(),e.rect(n,a,o,i),e.clip(),e.drawImage(t,n+(o-s*w)/2,a+(i-l*w)/2,s*w,l*w),e.restore()}function Te(e,t,n,a,o){e.save(),e.beginPath(),e.arc(n,a,o,0,Math.PI*2),e.clip(),ue(e,t,n-o,a-o,o*2,o*2),e.restore()}function Se(e,t,n,a){let o=r(".modal");if(!o)return;o.hidden=!1,o.querySelector("h2").textContent=e,o.querySelector(".value").textContent=t,o.querySelector("p").textContent=n;let i=o.querySelector("button");i.onclick=()=>{o.hidden=!0,P(),a()},I("result")}function Ie(e="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function qe(){let e=r(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let H=[];function Q(e){v=e,e||f==null||f.suspend().catch(()=>{});for(let t of H)t(e)}d(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&Q(e.data.active===!0)}),d(document,"visibilitychange",()=>{Q(!document.hidden)}),d(window,"pagehide",()=>{g=!0,x.splice(0).forEach(e=>e()),y.splice(0).forEach(e=>e()),f==null||f.close().catch(()=>{})});let ee={};function te(e,t){return ee[e]??t}async function de(e=()=>{}){let t=new AbortController,n=setTimeout(()=>t.abort(),1600);try{let a=await fetch("./game.config.json",{signal:t.signal});if(!a.ok)throw Error("Configurazione non disponibile");let o=await a.json();for(let i of["texts","tweaks","images"])for(let s of o[i]||[])ee[s.id]=i==="images"?s.path:s.value;for(let i of K){let s=R(i.path);i.im.getAttribute("src")!==s&&(i.im.src=s)}for(let i of c.querySelectorAll('img[src^="./assets/"]'))i.src=R(i.getAttribute("src"));e(),c.dataset.config="loaded"}catch{c.dataset.config="defaults"}finally{clearTimeout(n)}}let u=null,p=null,A=null,D=null,F=!1,B=!1,k="",ne=()=>{};function T(){u==null||u.getTracks().forEach(e=>e.stop()),u=null,p==null||p.close().catch(()=>{}),p=A=D=null,F=!1}async function ie(){var e;if(!F){F=!0;try{if(!((e=navigator.mediaDevices)!=null&&e.getUserMedia))throw Error("Microfono non disponibile");if(u=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!1}}),g||!v||k==="hold"){T();return}p=new(window.AudioContext||window.webkitAudioContext),await p.resume();let t=p.createMediaStreamSource(u);A=p.createAnalyser(),A.fftSize=1024,t.connect(A),D=new Float32Array(A.fftSize),r(".mic-enable").textContent="Mic attivo",r(".mic-status").textContent="In ascolto \xB7 puoi anche tenere premuto o usare Spazio",c.dataset.microphone="enabled"}catch{F=!1,r(".mic-enable").textContent="Attiva microfono",r(".mic-status").textContent="Microfono non disponibile \xB7 tieni premuto per giocare",c.dataset.microphone="unavailable"}}}function pe(){if(B)return .9;if(!A||!v)return 0;A.getFloatTimeDomainData(D);let e=0;for(let t of D)e+=t*t;return _((Math.sqrt(e/D.length)-.012)*14,0,1)}function fe(){d(r(".mic-enable"),"click",()=>{j(),ie()});let e=r(".voice-hold");d(e,"pointerdown",t=>{t.preventDefault(),P(),X("hold"),B=!0,e.setPointerCapture(t.pointerId)});for(let t of["pointerup","pointercancel","lostpointercapture"])d(e,t,()=>B=!1);d(window,"keydown",t=>{t.code==="Space"&&!t.repeat&&(t.preventDefault(),P(),X("hold"),B=!0)}),d(window,"keyup",t=>{t.code==="Space"&&(B=!1)}),H.push(t=>{if(t){if(p==null||p.resume().catch(()=>{}),u)for(let n of u.getTracks())n.enabled=!0}else if(B=!1,p==null||p.suspend().catch(()=>{}),u)for(let n of u.getTracks())n.enabled=!1}),y.push(T),ge()}function he(e="Tieni premuto"){return`<div class="status mic-status" hidden></div><div class="bottom"><button class="capability mic-enable">Attiva microfono</button><button class="capability voice-hold">${e}</button></div>`}function X(e){k=e,e==="hold"&&(u||F)&&T(),ne()}function ge(){let e=r(".mic-enable"),t=r(".voice-hold"),n=e.parentElement,a=r(".mic-status"),o=!0,i=document.createElement("style");i.textContent="#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}",document.head.append(i);function s(){g||(e.hidden=k==="hold",t.hidden=k==="voice",n.classList.toggle("voice-mode-selected",!!k),c.dataset.voiceControl=k||"choice",k==="hold"&&(a.textContent="",a.hidden=!0))}ne=s,d(e,"click",()=>X("voice"),{capture:!0});let l=new MutationObserver(()=>{let w=c.dataset.microphone;k==="voice"&&["unavailable","error","off"].includes(w)&&(k=""),k==="hold"&&u&&T(),s()});l.observe(c,{attributes:!0,attributeFilter:["data-microphone"]}),y.push(()=>l.disconnect()),s()}function me(){let e=r(".mic-enable"),t=r(".mic-status"),n=new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en",o=!0?{idle:"Attiva microfono",requesting:"Connessione\u2026",active:"Microfono attivo",paused:"Microfono in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Non disponibile \xB7 usa il pulsante"}:{idle:"Attiva microfono",requesting:"Connessione\u2026",active:"Mic attivo",paused:"Mic in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Microfono non disponibile \xB7 tieni premuto per giocare"},i=document.createElement("style");i.textContent=".bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}",document.head.append(i);let s=!1,l=!1,w="",V=null,G=null;function xe(){var $;let m=(($=u==null?void 0:u.getAudioTracks)==null?void 0:$.call(u))||[];return v&&!!A&&(p==null?void 0:p.state)==="running"&&m.some(S=>S.readyState==="live"&&S.enabled&&!S.muted)}function C(){var se;if(g)return;let m=xe(),$=!!((se=u==null?void 0:u.getAudioTracks)!=null&&se.call(u).some(Z=>Z.readyState==="live")),S=s?"requesting":m?"active":$?"paused":l?"unavailable":"idle";if(e.disabled=s,e.setAttribute("aria-pressed",String(m)),e.classList.toggle("is-listening",m),e.setAttribute("aria-label",$?o.stop:o.start),e.dataset.micState=S,c.dataset.microphone=m?"enabled":S==="idle"?"off":S,S!==w){let Z=m?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>',ve=s?o.requesting:m?o.active:$?o.paused:o.idle;re(e,Z+'<span class="mic-button-label">'+ve+"</span>"),t.textContent=m?o.listening:l?o.unavailable:o.fallback,w=S}}function Y(){if(u&&V!==u){V=u;for(let m of u.getAudioTracks())d(m,"ended",()=>{T(),l=!1,C()}),d(m,"mute",C),d(m,"unmute",C)}p&&G!==p&&(G=p,d(p,"statechange",C))}d(e,"click",async m=>{if(m.preventDefault(),m.stopImmediatePropagation(),!(s||g)){if(u){T(),l=!1,C();return}if(j(),l=!1,s=!0,C(),await ie(),s=!1,g||!v){T(),C();return}(!u||!p||!A)&&(T(),l=!0),Y(),w="",C()}},{capture:!0}),H.push(()=>{Promise.resolve().then(()=>{Y(),C()})}),Y(),C()}function be(e){let t=r(e==="camera"?".cam-status":".mic-status");if(!t)return;let n=!0;t.setAttribute("role","status"),t.setAttribute("aria-live","polite");function a(){var V;let l="";if(e==="camera")["requesting","unavailable"].includes(c.dataset.camera)&&(l=t.textContent);else{let G=((V=r(".mic-enable"))==null?void 0:V.dataset.micState)||c.dataset.microphone;G==="requesting"?l="Consenti l\u2019accesso al microfono":["unavailable","error"].includes(G)&&(l="Microfono non disponibile")}t.textContent!==l&&(t.textContent=l);let w=!l.trim();t.hidden!==w&&(t.hidden=w)}let o=new MutationObserver(a);o.observe(t,{childList:!0,characterData:!0,subtree:!0});let i=new MutationObserver(a);i.observe(c,{attributes:!0,attributeFilter:[e==="camera"?"data-camera":"data-microphone"]});let s=r(".mic-enable");s&&i.observe(s,{attributes:!0,attributeFilter:["data-mic-state"]}),a(),y.push(()=>{o.disconnect(),i.disconnect()})}q(".fit{background:#fff;color:#755f43}.puppy{position:absolute;left:35px;top:168px;width:320px;height:267px;object-fit:contain;transform-origin:50% 80%}.sleep-z{position:absolute;top:193px;right:81px;font:23px Georgia;color:#a69e8c;transform:rotate(10deg)}.guide{top:112px;font-weight:500;color:#7b725f}.hud{font-size:24px;justify-content:flex-end}.wake-meter{position:absolute;left:55px;right:55px;top:455px;height:9px;border-radius:10px;background:#ece9e2;overflow:hidden}.wake-fill{height:100%;width:0;background:#d0ac65;border-radius:10px}.wake-label{position:absolute;left:55px;top:432px;font-size:10px;letter-spacing:2px}.ending{position:absolute;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:96px 30px 50px;text-align:center;pointer-events:auto}.ending[hidden]{display:none}.ending h2{font-size:24px;margin:0;max-width:100%;overflow-wrap:anywhere}.ending button{position:static;flex:none;transform:none;background:#9e8154;white-space:nowrap;min-height:44px}.fit.puppy-result>.bottom,.fit.puppy-result>.mic-status,.fit.puppy-result>.guide{visibility:hidden;pointer-events:none}.status{color:#9c907b}.capability{color:#78674a}.bottom{bottom:22px}",`<div class="hud"><span class="time">20s</span></div><div class="guide">Fai rumore e sveglia il cucciolo!</div><img class="puppy" src="./assets/puppy-sleep.webp" alt="Un cucciolo addormentato"><div class="sleep-z">z \u1DBB</div><div class="wake-meter"><div class="wake-fill"></div></div>${he("Tieni per chiamare")}<section class="ending" role="dialog" aria-modal="true" aria-labelledby="puppy-ending-title" hidden><h2 id="puppy-ending-title"></h2><button class="pill">Riprova</button></section>`,"#fff"),be("microphone");let L="ready",E=0,O=20;function oe(){r(".fit").classList.remove("puppy-result"),L="ready",E=0,O=20,r(".time").textContent="20s",r(".puppy").src=R("./assets/puppy-sleep.webp"),r(".sleep-z").hidden=!1,r(".ending").hidden=!0,r(".wake-fill").style.width="0%",I("ready")}function ae(e){L="result",B=!1,T(),r(".fit").classList.add("puppy-result"),I(e?"awake":"failed"),r(".ending").hidden=!1,r(".ending h2").textContent=e?"Buongiorno, piccolino!":"Sta ancora sognando\u2026",r(".sleep-z").hidden=e,e?(r(".puppy").src=R("./assets/puppy-awake.webp"),h()):U(),r(".ending button").focus({preventScroll:!0})}d(r(".ending"),"keydown",e=>e.stopPropagation()),d(r(".ending"),"keyup",e=>e.stopPropagation()),d(r(".ending button"),"click",()=>{P(),oe()}),fe(),me(),le((e,t)=>{let n=pe();L==="ready"&&n>.12&&(L="playing",P(),I("playing")),L==="playing"&&(O=Math.max(0,O-e),E=_(E+e*(n>.12?n*.26:-.08),0,1),r(".time").textContent=Math.ceil(O)+"s",r(".wake-fill").style.width=E*100+"%",c.dataset.wake=String(E),E>=1?ae(!0):O<=0&&ae(!1)),r(".puppy").style.transform=L==="result"&&E>=1?"none":`scale(${1+Math.sin(t*2)*.008},${1+Math.sin(t*2)*.013})`}),oe(),de(()=>{r(".guide")&&(r(".guide").textContent=String(te("GUIDE","Fai rumore e sveglia il cucciolo!")))})})();(()=>{let c=document.createElement("style");c.dataset.batch3Ui="20261116",c.textContent=`
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

.guide{font:400 18px/1.4 UIBody,system-ui,sans-serif;top:110px;color:#655a48}
.hud{font-family:Playful,UIBody,sans-serif;font-size:28px;justify-content:center}
.wake-label{font-size:12px;letter-spacing:1.4px;color:#6a573a}
.status{color:#72634f}.capability{color:#65523b;background:#fffdf7;border-color:#9f896455}
.ending{padding-top:96px}.ending h2{font:600 24px/1.3 Playful,UIBody,sans-serif}
.ending button{font-size:16px}
`,document.head.append(c)})();})();
