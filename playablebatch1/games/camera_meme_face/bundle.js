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

(()=>{function qt(s,nt){if(!s)throw new Error("Game mount target is missing");let y=String(nt??""),X=b=>b.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(M,v)=>{if(v[0]==="#"){let d=v[1].toLowerCase()==="x",x=parseInt(v.slice(d?2:1),d?16:10);return x>0&&x<=1114111?String.fromCodePoint(x):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[v.toLowerCase()]||M});for(;s.firstChild;)s.removeChild(s.firstChild);let z=[{element:s,tag:"",svg:s.namespaceURI==="http://www.w3.org/2000/svg"}],it=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,w=0;for(;w<y.length;){if(y.startsWith("<!--",w)){let f=y.indexOf("-->",w+4);w=f<0?y.length:f+3;continue}if(y[w]!=="<"){let f=y.indexOf("<",w),$=f<0?y.length:f;z[z.length-1].element.appendChild(document.createTextNode(X(y.slice(w,$)))),w=$;continue}let b=w+1,M="";for(;b<y.length;b++){let f=y[b];if(M)f===M&&(M="");else if(f==='"'||f==="'")M=f;else if(f===">")break}if(b>=y.length)throw new Error("Incomplete game markup");let v=y.slice(w+1,b);if(w=b+1,/^\s*!/.test(v))continue;let d=/^\s*\/\s*([\w:-]+)/.exec(v);if(d){for(let f=z.length-1;f>0;f--)if(z[f].tag.toLowerCase()===d[1].toLowerCase()){z.length=f;break}continue}let x=/^\s*([\w:-]+)/.exec(v);if(!x)throw new Error("Invalid game markup");let E=x[1],l=z[z.length-1],D=E.toLowerCase()==="svg"||l.svg&&l.tag.toLowerCase()!=="foreignobject",I=D?document.createElementNS("http://www.w3.org/2000/svg",E):document.createElement(E),F=v.slice(x[0].length).replace(/\/\s*$/,""),H=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,C;for(;C=H.exec(F);){let f=C[1],$=X(C[2]??C[3]??C[4]??"");I.setAttribute(f,$)}l.element.appendChild(I),!it.test(E)&&!/\/\s*$/.test(v)&&z.push({element:I,tag:E,svg:D})}return y}document.documentElement.lang="it";(()=>{"use strict";let s=document.getElementById("root"),nt=(t,e,o)=>Math.max(e,Math.min(o,t)),y=(t,e)=>t+Math.random()*(e-t),X=t=>t[Math.floor(Math.random()*t.length)],z=t=>t[t.length-1],it=t=>{for(let e=t.length-1;e>0;e--){let o=Math.floor(Math.random()*(e+1));[t[e],t[o]]=[t[o],t[e]]}return t},w=[],b=[],M=!0,v=!1,d;function x(t,e,o,a){t.addEventListener(e,o,a),w.push(()=>t.removeEventListener(e,o,a))}function E(t,e,o="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+t,document.head.append(a),s.style.background=o,qt(s,'<div class="fit">'+e+"</div>");let n=s.querySelector(".fit");function i(){let r=s.getBoundingClientRect(),c=Math.min(r.width/390,r.height/598);n.style.transform=`translate(${(r.width-390*c)/2}px,${(r.height-598*c)/2}px) scale(${c})`,s.dataset.layout=`${Math.round(r.width)}x${Math.round(r.height)}`}i(),x(window,"resize",i)}function l(t){return s.querySelector(t)}function D(){var t;(t=l(".guide"))==null||t.classList.add("gone")}function I(t){s.dataset.phase=t}function F(){H(),D()}function H(){try{d||(d=new(window.AudioContext||window.webkitAudioContext)),d.state==="suspended"&&d.resume().catch(()=>{})}catch{}}function C(t=450,e=.08,o=.18,a="sine",n=0){if(!(!d||!M))try{let i=d.createOscillator(),r=d.createGain(),c=d.currentTime;i.type=a,i.frequency.setValueAtTime(t,c),n&&i.frequency.exponentialRampToValueAtTime(Math.max(30,n),c+e),r.gain.setValueAtTime(.001,c),r.gain.exponentialRampToValueAtTime(o,c+.006),r.gain.exponentialRampToValueAtTime(.001,c+e),i.connect(r),r.connect(d.destination),i.start(c),i.stop(c+e+.02),i.onended=()=>{i.disconnect(),r.disconnect()}}catch{}}function f(){C(523,.12,.18),setTimeout(()=>C(784,.17,.16),100)}function $(){C(180,.22,.18,"triangle",65)}function gt(t){let e=0;function o(a){if(v)return;let n=Math.min(.035,(a-(e||a))/1e3);e=a,document.hidden||t(M?n:0,a/1e3),requestAnimationFrame(o)}requestAnimationFrame(o)}function Bt(){let t=l("canvas.stage"),e=t.getContext("2d"),o=Math.min(2,window.devicePixelRatio||1);return t.width=390*o,t.height=598*o,e.scale(o,o),{canvas:t,ctx:e}}function Lt(t,e=l("canvas.stage")){let o=e.getBoundingClientRect();return{x:(t.clientX-o.left)*390/o.width,y:(t.clientY-o.top)*598/o.height}}function rt(t,e,o,a,n,i){i=Math.min(Math.abs(a)/2,Math.abs(n)/2,i),t.moveTo(e+i,o),t.lineTo(e+a-i,o),t.quadraticCurveTo(e+a,o,e+a,o+i),t.lineTo(e+a,o+n-i),t.quadraticCurveTo(e+a,o+n,e+a-i,o+n),t.lineTo(e+i,o+n),t.quadraticCurveTo(e,o+n,e,o+n-i),t.lineTo(e,o+i),t.quadraticCurveTo(e,o,e+i,o),t.closePath()}function jt(t,e,o,a,n,i,r,c){t.beginPath(),rt(t,e,o,a,n,i),r&&(t.fillStyle=r,t.fill()),c&&(t.strokeStyle=c,t.stroke())}function Rt(t,e,o,a,n,i){t.beginPath(),t.arc(e,o,Math.max(.01,a),0,Math.PI*2),n&&(t.fillStyle=n,t.fill()),i&&(t.strokeStyle=i,t.stroke())}function Ut(t,e,o,a,n,i,r=2){t.beginPath(),t.moveTo(e,o),t.lineTo(a,n),t.strokeStyle=i,t.lineWidth=r,t.stroke()}function Ft(t,e,o,a,n=18,i="#25252a",r="UIBody",c="center"){t.font=`700 ${n}px ${r}`,t.fillStyle=i,t.textAlign=c,t.textBaseline="middle",t.fillText(e,o,a)}let st=[];function Q(t){let e=t.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(tt(e,t))}function xt(t){let e=new Image;return e.onerror=()=>{s.dataset.assetIssue="image"},e.src=Q(t),st.push({im:e,path:t}),e}function _(t,e,o,a,n,i){if(!e)return!1;let r=e.videoWidth||e.naturalWidth||e.width,c=e.videoHeight||e.naturalHeight||e.height;if(!r||!c)return!1;let g=Math.max(n/r,i/c);return t.save(),t.beginPath(),t.rect(o,a,n,i),t.clip(),t.drawImage(e,o+(n-r*g)/2,a+(i-c*g)/2,r*g,c*g),t.restore(),!0}function $t(t,e,o,a,n){t.save(),t.beginPath(),t.arc(o,a,n,0,Math.PI*2),t.clip(),_(t,e,o-n,a-n,n*2,n*2),t.restore()}function Ot(t,e,o,a){let n=l(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=t,n.querySelector(".value").textContent=e,n.querySelector("p").textContent=o;let i=n.querySelector("button");i.onclick=()=>{n.hidden=!0,F(),a()},I("result")}function Wt(t="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${t}</button></section></div>`}function bt(){let t=l(".flash");t&&(t.classList.remove("fire"),t.offsetWidth,t.classList.add("fire"))}let lt=[];function ct(t){M=t,t||d==null||d.suspend().catch(()=>{});for(let e of lt)e(t)}x(window,"message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&ct(t.data.active===!0)}),x(document,"visibilitychange",()=>{ct(!document.hidden)}),x(window,"pagehide",()=>{v=!0,w.splice(0).forEach(t=>t()),b.splice(0).forEach(t=>t()),d==null||d.close().catch(()=>{})});let pt={};function tt(t,e){return pt[t]??e}async function vt(t=()=>{}){let e=new AbortController,o=setTimeout(()=>e.abort(),1600);try{let a=await fetch("./game.config.json",{signal:e.signal});if(!a.ok)throw Error("Configurazione non disponibile");let n=await a.json();for(let i of["texts","tweaks","images"])for(let r of n[i]||[])pt[r.id]=i==="images"?r.path:r.value;for(let i of st){let r=Q(i.path);i.im.getAttribute("src")!==r&&(i.im.src=r)}for(let i of s.querySelectorAll('img[src^="./assets/"]'))i.src=Q(i.getAttribute("src"));t(),s.dataset.config="loaded"}catch{s.dataset.config="defaults"}finally{clearTimeout(o)}}let A=null,O="user",T=!1,W=0,et=!1,yt=!0,h=(t,e)=>yt?e:t;function j(){let t=l("video.preview");return et&&(A!=null&&A.getVideoTracks().some(e=>e.readyState==="live"&&e.enabled))&&(t==null?void 0:t.readyState)>=2&&t.videoWidth>0&&t.videoHeight>0?t:null}function R(t,e){s.dataset.camera=t;let o=l(".cam-status"),a=l(".cam-enable");o&&(o.textContent=e),a&&(a.disabled=!1,a.setAttribute("aria-pressed",String(t==="enabled")),a.textContent=T?h("Connessione\u2026 \xB7 Annulla","Connessione\u2026 \xB7 Annulla"):t==="enabled"?h("Fotocamera attiva \xB7 Interrompi","Fotocamera attiva \xB7 Interrompi"):h("Attiva fotocamera","Attiva fotocamera"));for(let n of s.querySelectorAll(".shutter,.cam-capture"))n.disabled=!j();J()}function P(){W++,et=!1,T=!1;let t=A;A=null,t==null||t.getTracks().forEach(o=>o.stop());let e=l("video.preview");e&&(e.pause(),e.srcObject=null),R("idle",h("Attiva la fotocamera per scattare una foto","Attiva la fotocamera per scattare una foto"))}async function dt(){var o;if(T)return;P();let t=++W;T=!0,R("requesting",h("In attesa della fotocamera\u2026","In attesa della fotocamera\u2026"));let e;try{if(!((o=navigator.mediaDevices)!=null&&o.getUserMedia))throw Error("Fotocamera non disponibile");if(e=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:O}},audio:!1}),v||!M||t!==W){e.getTracks().forEach(i=>i.stop());return}A=e;let a=l("video.preview");a.muted=!0,a.playsInline=!0,a.srcObject=e;let n;try{await Promise.race([a.play(),new Promise((i,r)=>{n=setTimeout(()=>r(Error("La fotocamera non si \xE8 avviata")),7e3)})])}finally{clearTimeout(n)}if(await new Promise((i,r)=>{let c,g=()=>{clearTimeout(c),a.removeEventListener("loadeddata",m),a.removeEventListener("canplay",m)},m=()=>{a.readyState>=2&&a.videoWidth>0&&a.videoHeight>0&&(g(),i())};a.addEventListener("loadeddata",m),a.addEventListener("canplay",m),c=setTimeout(()=>{g(),r(Error("Nessuna immagine ricevuta dalla fotocamera"))},7e3),m()}),v||!M||t!==W){e.getTracks().forEach(i=>i.stop());return}et=!0,T=!1;for(let i of e.getVideoTracks())x(i,"ended",()=>{A===e&&(P(),R("unavailable",h("Fotocamera scollegata \xB7 riprova","Fotocamera scollegata \xB7 riprova")))});R("enabled",h("Fotocamera pronta \xB7 scatta una foto","Fotocamera pronta \xB7 scatta una foto"))}catch(a){if(e==null||e.getTracks().forEach(i=>i.stop()),t!==W)return;P();let n=(a==null?void 0:a.name)==="NotAllowedError"||(a==null?void 0:a.name)==="SecurityError";R("unavailable",n?h("Accesso alla fotocamera bloccato \xB7 consenti e riprova","Accesso alla fotocamera bloccato \xB7 consenti e riprova"):h("Nessuna immagine dalla fotocamera \xB7 riprova","Nessuna immagine dalla fotocamera \xB7 riprova"))}}function wt(t=600,e=800,o=!0){let a=j();if(!a)return null;let n=document.createElement("canvas");n.width=t,n.height=e;let i=n.getContext("2d");return o&&O==="user"&&(i.translate(t,0),i.scale(-1,1)),_(i,a,0,0,t,e)?n:null}function kt(t,e="#f0ede5"){let o=t.getContext("2d"),a=t.width,n=t.height;o.fillStyle=e,o.fillRect(0,0,a,n);let i=j();if(i){o.save(),O==="user"&&(o.translate(a,0),o.scale(-1,1)),_(o,i,0,0,a,n),o.restore();return}o.save(),o.translate(a/2,n/2-8);let r=Math.min(a,n)/160;o.scale(r,r),o.strokeStyle="#767268",o.lineWidth=3,o.lineJoin="round",o.beginPath(),rt(o,-29,-19,58,38,6),o.stroke(),o.beginPath(),o.arc(0,0,10,0,Math.PI*2),o.stroke(),o.beginPath(),o.moveTo(-17,-19),o.lineTo(-12,-27),o.lineTo(12,-27),o.lineTo(17,-19),o.stroke(),o.restore(),o.fillStyle="#68645b",o.font=`500 ${Math.max(15,a/23)}px UIBody,Arial`,o.textAlign="center",o.textBaseline="middle",o.fillText(T?h("Connessione\u2026","Connessione\u2026"):h("La tua fotocamera","La tua fotocamera"),a/2,n/2+Math.min(a,n)*.25)}function Mt(){var e;(e=l("video.preview"))==null||e.setAttribute("aria-hidden","true");let t=document.createElement("style");t.textContent='.preview{display:block!important;position:absolute!important;width:1px!important;height:1px!important;left:0;bottom:0;opacity:.001;pointer-events:none}.cam-enable[aria-pressed="true"]{border-color:#47754b;background:#edf5e9;color:#315b35}',document.head.append(t),x(l(".cam-enable"),"click",()=>{H(),A||T?P():dt()}),l(".cam-flip")&&x(l(".cam-flip"),"click",()=>{O=O==="user"?"environment":"user",P(),dt()}),lt.push(o=>{o||P()}),b.push(P),R("idle",h("Attiva la fotocamera per scattare una foto","Attiva la fotocamera per scattare una foto"))}function mt(){let t=String(tt("PAPER_BACKDROP","./assets/paper-print-v1.svg"));s.style.backgroundColor="#e9e0c7",s.style.backgroundImage="url("+JSON.stringify(t)+")",s.style.backgroundSize="256px 256px",s.style.backgroundRepeat="repeat"}function Ct(){mt();let t=document.createElement("style");t.textContent=`#root{position:relative;isolation:isolate;color:#282723}
 #root .fit{background:transparent!important}
 #root .paper-overlay{position:absolute;inset:0;z-index:40;background:#28272338;pointer-events:auto;isolation:isolate}
 #root .paper-overlay[hidden]{display:none!important}
 #root .paper-result-fit{position:absolute;width:390px;height:598px;transform-origin:0 0;font-family:UIBody,system-ui,sans-serif;pointer-events:auto}
 #root .paper-result-fit .modal{background:transparent}
 #root .result,#root .comparison,#root .strip-view{background:#fbf7e9;color:#282723;border:2px solid #282723;border-radius:12px;box-shadow:4px 5px 0 #28272322}
 #root .pill{background:#282723;color:#fff9e9;border:2px solid #282723;box-shadow:0 3px 0 #28272325}
 #root .capability,#root .stop-sugar{color:#282723;background:#fbf7e9;border:2px solid #282723;box-shadow:0 2px 0 #2827231c}
 #root .capability:disabled,#root .pill:disabled{box-shadow:none}
 #root .shutter{border-color:#282723;background:#fbf7e9}
 #root .eyebrow,#root .booth-label,#root .guide{color:#282723}
 #root .cam-status,#root .mic-status,#root .target-label{color:#625c4b}
 #root .pose-pair .meme-reference,#root .pose-pair .live{border:2px solid #282723;border-radius:7px;box-shadow:3px 4px 0 #2827231e}#root .shutter{box-shadow:inset 0 0 0 5px #e9e0c7}#root .pair canvas,#root .pair img{border:1px solid #28272340;border-radius:3px}`,document.head.append(t);let e=s.querySelector(".fit"),o=e.querySelector(".comparison,.strip-view,.modal");if(!o)return;let a=document.createElement("div"),n=document.createElement("div");a.className="paper-overlay",n.className="paper-result-fit",a.hidden=o.hidden,n.append(o),a.append(n),s.append(a),o.setAttribute("role","dialog"),o.setAttribute("aria-modal","true");function i(){a.hidden=o.hidden,e.inert=!o.hidden}let r=new MutationObserver(i);r.observe(o,{attributes:!0,attributeFilter:["hidden"]});function c(){let m=s.getBoundingClientRect(),u=Math.min(m.width/390,m.height/598),Z=`translate(${(m.width-390*u)/2}px,${(m.height-598*u)/2}px) scale(${u})`;n.style.transform=Z,e.style.transform=Z}i(),c(),x(window,"resize",c);let g=typeof ResizeObserver=="function"?new ResizeObserver(c):null;g==null||g.observe(s),b.push(()=>{r.disconnect(),g==null||g.disconnect()})}E("body{color:#292922}.fit{background:#e6e4dc}.eyebrow{position:absolute;top:58px;width:100%;text-align:center;letter-spacing:2.5px;font-size:10px}.meme-reference{position:absolute;left:78px;top:95px;width:234px;height:165px;object-fit:cover;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(-3deg)}.live{position:absolute;left:78px;top:294px;width:234px;height:160px;border:8px solid #faf9f1;box-shadow:0 2px 7px #4442;transform:rotate(2deg);background:#d2cfc4;overflow:hidden}.live canvas{width:100%;height:100%;object-fit:cover}.preview{display:none}.guide{top:272px;font-size:16px}.shutter{position:absolute;left:168px;top:480px;border:3px solid #292922;background:#fff;width:54px;height:54px;border-radius:50%;box-shadow:inset 0 0 0 5px #e6e4dc}.cam-status{bottom:122px;font-size:11px}.bottom{bottom:18px}.comparison{position:absolute;inset:80px 30px 105px;z-index:15;background:#f9f7ef;padding:22px 14px;box-shadow:0 4px 20px #0002;text-align:center}.comparison[hidden]{display:none}.comparison h2{font-size:24px;margin:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:24px 0}.pair canvas,.pair img{width:100%;height:205px;object-fit:cover}.pair small{display:block;text-transform:uppercase;letter-spacing:2px;font-size:9px;margin:8px}.countdown{position:absolute;top:350px;width:100%;text-align:center;z-index:12;font-size:60px;font-weight:800;color:white;text-shadow:0 2px 5px #0008}",'<div class="guide">Imita l\u2019espressione</div><div class="pose-pair"><div class="meme-photo-frame meme-reference-frame" data-focal="wet-kitty"><img class="meme-reference" alt="Espressione da imitare" src="./assets/meme-4.png"></div><div class="live"><canvas class="selfie" width="400" height="400"></canvas><div class="countdown"></div></div></div><video class="preview" playsinline autoplay muted></video><div class="status cam-status" role="status" aria-live="polite" hidden></div><div class="bottom"><button class="capability cam-enable">Attiva fotocamera</button><button class="shutter" aria-label="Scatta foto" hidden disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/></svg><span class="shutter-label">Scatta foto</span></button></div><section class="comparison" hidden aria-label="Risultato del confronto" aria-describedby="meme-result-description"><div class="match-summary"><div class="match-value" data-ready="false" aria-live="polite" aria-atomic="true"><strong class="match-number">\u2014</strong><span class="match-percent-sign">%</span></div><p class="match-label" id="meme-result-description">La tua versione del meme.</p></div><div class="pair"><div><div class="meme-photo-frame meme-result-frame" data-focal="wet-kitty"><img alt="Espressione originale"></div></div><div><canvas width="320" height="320" aria-label="La foto che hai scattato"></canvas></div></div><button class="pill next">Avanti</button></section><div class="flash"></div>',"#e6e4dc"),Ct();function It(t,e=32,o=32){let a=e*o,n=new Float64Array(a),i=new Float64Array(12),r=new Float64Array(64),c=new Uint16Array(64),g=new Float64Array(64),m=0,u=0;for(let p=0;p<a;p++){let B=t[p*4],L=t[p*4+1],V=t[p*4+2],S=.2126*B+.7152*L+.0722*V;n[p]=S,m+=S,u+=S*S,i[Math.min(3,B>>6)]+=1/a,i[4+Math.min(3,L>>6)]+=1/a,i[8+Math.min(3,V>>6)]+=1/a;let ot=p%e,at=Math.floor(p/e),K=Math.floor(at*8/o)*8+Math.floor(ot*8/e);r[K]+=S,c[K]++}m/=a;let Z=Math.sqrt(Math.max(0,u/a-m*m)),ht=0;for(let p=0;p<64;p++)r[p]/=Math.max(1,c[p]),ht+=(r[p]-m)**2;let Tt=Math.max(6,Math.sqrt(ht/64));for(let p=0;p<64;p++)r[p]=Math.max(-2.5,Math.min(2.5,(r[p]-m)/Tt));for(let p=1;p<o-1;p++)for(let B=1;B<e-1;B++){let L=p*e+B,V=n[L+1]-n[L-1],S=n[L+e]-n[L-e],ot=Math.hypot(V,S),at=(Math.atan2(S,V)+Math.PI)%Math.PI,K=Math.min(3,Math.floor(at/Math.PI*4)),Pt=Math.floor(p*4/o)*4+Math.floor(B*4/e);g[Pt*4+K]+=ot}return{mean:m,deviation:Z,blocks:r,edges:g,colors:i}}function zt(t,e){let o=Math.max(0,1-Math.abs(t.mean-e.mean)/255),a=0;for(let u=0;u<12;u++)a+=Math.min(t.colors[u],e.colors[u]);if(a/=3,t.deviation<4&&e.deviation<4)return Math.round(100*(.6*o+.4*a));if(t.deviation<4||e.deviation<4)return Math.round(100*(.25*o+.15*a));let n=0,i=0,r=0,c=0;for(let u=0;u<64;u++)n+=Math.abs(t.blocks[u]-e.blocks[u]),i+=t.edges[u]*e.edges[u],r+=t.edges[u]**2,c+=e.edges[u]**2;let g=Math.max(0,1-n/128),m=r&&c?Math.min(1,i/Math.sqrt(r*c)):0;return Math.round(100*Math.max(0,Math.min(1,(.65*g+.25*m+.1*a)*(.75+.25*o))))}function ut(t){var a;let e=document.createElement("canvas");e.width=e.height=32;let o=e.getContext("2d",{willReadFrequently:!0});if(((a=t.dataset)==null?void 0:a.memeFocal)==="wet-kitty"){let n=t.naturalWidth||t.width,i=t.naturalHeight||t.height;if(!n||!i)throw Error("Image not ready");o.drawImage(t,0,i*25/640,n*360/594,i*360/640,0,0,32,32)}else if(!_(o,t,0,0,32,32))throw Error("Image not ready");return It(o.getImageData(0,0,32,32).data)}let G=0;async function At(t,e){let o=++G,a=l(".match-value"),n=l(".match-number"),i=l(".match-label");a.dataset.ready="false",n.textContent="\u2014",i.textContent=h("La tua versione del meme.","La tua versione del meme."),delete s.dataset.matchScore;try{if(!e.complete||!e.naturalWidth)if(typeof e.decode=="function")await e.decode();else throw Error("L\u2019immagine di riferimento si sta caricando");let r=zt(ut(t),ut(e));if(o!==G||!N)return;n.textContent=String(r),a.dataset.ready="true",s.dataset.matchScore=String(r)}catch{o===G&&(i.textContent=h("Riprova il confronto con un\u2019altra foto.","Riprova il confronto con un\u2019altra foto."))}}function St(){let t=document.createElement("style");t.textContent=`#root .comparison{left:30px;right:30px;top:50%;bottom:auto;transform:translateY(-50%);width:auto;max-height:calc(100% - 80px);padding:22px 18px;display:flex;flex-direction:column;align-items:stretch;gap:16px;overflow-y:auto;text-align:center}
 #root .comparison[hidden]{display:none!important}
 #root .comparison .match-summary{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
 #root .comparison .match-value{white-space:nowrap;font:700 52px/1 UIBody,system-ui,sans-serif;letter-spacing:-2px;font-variant-numeric:tabular-nums}
 #root .comparison .match-percent-sign{font-size:26px;letter-spacing:0;margin-left:1px}
 #root .comparison .match-value[data-ready="false"] .match-percent-sign{visibility:hidden}
 #root .comparison .match-label{max-width:100%;margin:0;text-align:center;font:400 16px/1.4 UIBody,system-ui,sans-serif;text-wrap:balance;overflow-wrap:anywhere}
 #root .comparison .pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin:0}
 #root .comparison .pair>div{min-width:0}
 #root .comparison .pair img,#root .comparison .pair canvas{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover}
 #root .comparison .next{align-self:center;min-width:180px;max-width:100%;min-height:44px;margin:0;padding:10px 20px;white-space:normal}`,document.head.append(t),b.push(()=>t.remove()),l(".match-label").textContent=h("La tua versione del meme.","La tua versione del meme."),l(".comparison .next").textContent=h("Avanti","Avanti")}function Et(){let t=l(".fit"),e=l(".cam-status"),o=document.createElement("style");o.textContent=`#root .fit>.guide{position:absolute;top:30px;left:30px;right:30px;width:auto;margin:0;text-align:center;font:600 18px/1.4 Playful,UIBody,sans-serif}
 #root .pose-pair{grid-template-rows:repeat(2,minmax(0,1fr))}
 #root .cam-status{top:62px;bottom:auto;left:30px;right:30px;margin:0;font:400 12px/1.3 UIBody,system-ui,sans-serif}
 #root .cam-status[hidden]{display:none!important}#root .fit.camera-copy-error .pose-pair{top:110px}`,document.head.append(o),b.push(()=>o.remove()),l(".guide").textContent=h("Imita l\u2019espressione","Imita l\u2019espressione");function a(){let i=s.dataset.camera==="unavailable";e.hidden=!i,i||(e.textContent=""),t.classList.toggle("camera-copy-error",i)}let n=new MutationObserver(a);n.observe(s,{attributes:!0,attributeFilter:["data-camera"]}),b.push(()=>n.disconnect()),a()}Et(),St();let q=0,k=-1,N=!1;function J(){let t=!!j(),e=l(".cam-enable"),o=l(".shutter");if(!e||!o)return;e.hidden=t,o.hidden=!t,o.disabled=!t||k>=0||N;let a=h("Scatta foto","Scatta foto"),n=l(".shutter-label");n&&n.textContent!==a&&(n.textContent=a),o.getAttribute("aria-label")!==a&&o.setAttribute("aria-label",a)}let ft=["./assets/meme-4.png","./assets/meme-1.webp","./assets/meme-2.webp","./assets/meme-3.webp"],U=ft.map(t=>xt(t));U[0].dataset.memeFocal="wet-kitty";function Y(){let t=q===0?"wet-kitty":"none",e=l(".meme-reference"),o=l(".pair img");e.src=U[q].src,o.src=U[q].src;for(let a of s.querySelectorAll(".meme-photo-frame"))a.dataset.focal=t;s.dataset.expression=ft[q],s.dataset.expressionCount=String(U.length)}Y(),Mt(),x(l(".shutter"),"click",()=>{N||k>=0||!j()||(F(),k=3,J(),I("countdown"),C(550,.06,.12))}),x(l(".next"),"click",()=>{F(),G++,q=(q+1)%U.length,N=!1,l(".comparison").hidden=!0,Y(),J(),I("ready")}),gt(t=>{if(J(),kt(l(".selfie"),"#f0ede5"),k>=0){if(!j()){k=-1,l(".countdown").textContent="",I("ready");return}let e=Math.ceil(k);if(k-=t,l(".countdown").textContent=k>0?Math.ceil(k):"",Math.ceil(k)<e&&k>0&&C(550,.05,.1),k<=0){k=-1;let o=wt(320,320);if(!o)return;N=!0,bt(),C(120,.08,.18,"triangle",70),l(".pair canvas").getContext("2d").drawImage(o,0,0),Y(),l(".comparison").hidden=!1,At(o,U[q]),l(".next").focus({preventScroll:!0}),I("comparison")}}}),I("ready"),vt(()=>{if(mt(),Y(),l(".guide")){let t=String(tt("GUIDE","Imita l\u2019espressione"));l(".guide").textContent=["Imita l\u2019espressione","Imita l\u2019espressione \xB7 scatta un selfie","Imita l\u2019espressione \xB7 scatta un selfie"].includes(t)?h("Imita l\u2019espressione","Imita l\u2019espressione"):t}})})();(()=>{let s=document.createElement("style");s.dataset.batch3Ui="20261116",s.textContent=`
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

.eyebrow{top:30px;font-size:12px;line-height:1.4;letter-spacing:2px}
.meme-reference{top:90px;height:150px}
.guide{top:249px;font-size:18px;line-height:1.4}
.live{top:283px;height:153px}
.shutter{top:450px;width:50px;height:50px;left:170px}
.cam-status{top:62px;bottom:auto;font-size:12px;color:#655f54;line-height:1.4}
.comparison{inset:30px 30px 50px;padding:26px 18px;overflow:auto;border-radius:16px}
.comparison h2{font:600 24px/1.3 Playful,UIBody,sans-serif;margin:10px 0 16px}
.pair{gap:12px;margin:18px 0 24px}.pair canvas,.pair img{height:220px}
.pair small{font-size:12px;letter-spacing:1px;margin:8px 0}
`,document.head.append(s)})();(()=>{let s=document.createElement("style");s.textContent=".pose-pair{position:absolute;left:30px;right:30px;top:88px;bottom:128px;display:grid;grid-template-rows:minmax(0,1fr) auto minmax(0,1fr);justify-items:center;gap:10px}.pose-pair .meme-reference,.pose-pair .live{position:relative;inset:auto;display:block;width:auto;height:100%;max-width:100%;aspect-ratio:1;border:0;border-radius:8px;object-fit:cover;transform:none;box-shadow:0 2px 7px #4442}.pose-pair .live canvas{width:100%;height:100%;object-fit:cover}.pose-pair .guide{position:static;inset:auto;width:100%;margin:0;font-size:17px;line-height:1.35}.live .countdown{position:absolute;inset:0;display:grid;place-items:center;font-size:54px;pointer-events:none}.bottom{bottom:50px;gap:0;min-height:48px;justify-content:center}#root .bottom .shutter,#root .bottom .cam-enable{position:static;inset:auto;flex:0 1 230px;width:230px;max-width:100%;height:auto;min-height:48px;margin:0;padding:10px 18px;font-size:16px;line-height:1.3}#root .bottom .shutter{display:flex;align-items:center;justify-content:center;gap:10px;border:2px solid #282723;border-radius:24px;box-shadow:0 2px 0 #2827231c;background:#fbf7e9;color:#282723}#root .bottom .shutter svg{width:22px;height:22px;flex:none}#root .bottom [hidden]{display:none!important}.cam-status{top:54px;font-size:12px;line-height:1.3}.pair canvas,.pair img{height:auto;aspect-ratio:1;object-fit:cover}",document.head.append(s)})();(()=>{let s=document.createElement("style");s.textContent=`
 #root .pose-pair{grid-template-rows:repeat(2,minmax(0,1fr))}
 #root .meme-photo-frame{position:relative;overflow:hidden;isolation:isolate;background:#e9e0c7}
 #root .pose-pair>.meme-reference-frame{display:block;position:relative;inset:auto;width:auto;height:100%;max-width:100%;aspect-ratio:1;border:2px solid #282723;border-radius:7px;box-shadow:3px 4px 0 #2827231e;transform:none}
 #root .comparison .meme-result-frame{display:block;width:100%;height:auto;aspect-ratio:1;border:1px solid #28272340;border-radius:3px}
 #root .meme-photo-frame>img{position:absolute!important;inset:0!important;display:block!important;width:100%!important;height:100%!important;max-width:none!important;aspect-ratio:auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;transform:none!important;object-fit:cover!important}
 #root .meme-photo-frame[data-focal="wet-kitty"]>img{inset:auto!important;left:0!important;top:-6.9444444444%!important;width:165%!important;height:177.7777777778%!important;object-fit:fill!important}
 `,document.head.append(s)})();})();
