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

(()=>{function he(l,J){if(!l)throw new Error("Game mount target is missing");let x=String(J??""),V=w=>w.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(y,m)=>{if(m[0]==="#"){let p=m[1].toLowerCase()==="x",f=parseInt(m.slice(p?2:1),p?16:10);return f>0&&f<=1114111?String.fromCodePoint(f):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[m.toLowerCase()]||y});for(;l.firstChild;)l.removeChild(l.firstChild);let z=[{element:l,tag:"",svg:l.namespaceURI==="http://www.w3.org/2000/svg"}],ae=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,v=0;for(;v<x.length;){if(x.startsWith("<!--",v)){let h=x.indexOf("-->",v+4);v=h<0?x.length:h+3;continue}if(x[v]!=="<"){let h=x.indexOf("<",v),$=h<0?x.length:h;z[z.length-1].element.appendChild(document.createTextNode(V(x.slice(v,$)))),v=$;continue}let w=v+1,y="";for(;w<x.length;w++){let h=x[w];if(y)h===y&&(y="");else if(h==='"'||h==="'")y=h;else if(h===">")break}if(w>=x.length)throw new Error("Incomplete game markup");let m=x.slice(v+1,w);if(v=w+1,/^\s*!/.test(m))continue;let p=/^\s*\/\s*([\w:-]+)/.exec(m);if(p){for(let h=z.length-1;h>0;h--)if(z[h].tag.toLowerCase()===p[1].toLowerCase()){z.length=h;break}continue}let f=/^\s*([\w:-]+)/.exec(m);if(!f)throw new Error("Invalid game markup");let P=f[1],u=z[z.length-1],X=P.toLowerCase()==="svg"||u.svg&&u.tag.toLowerCase()!=="foreignobject",q=X?document.createElementNS("http://www.w3.org/2000/svg",P):document.createElement(P),B=m.slice(f[0].length).replace(/\/\s*$/,""),F=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,M;for(;M=F.exec(B);){let h=M[1],$=V(M[2]??M[3]??M[4]??"");q.setAttribute(h,$)}u.element.appendChild(q),!ae.test(P)&&!/\/\s*$/.test(m)&&z.push({element:q,tag:P,svg:X})}return x}document.documentElement.lang="it";(()=>{"use strict";let l=document.getElementById("root"),J=(e,t,i)=>Math.max(t,Math.min(i,e)),x=(e,t)=>e+Math.random()*(t-e),V=e=>e[Math.floor(Math.random()*e.length)],z=e=>e[e.length-1],ae=e=>{for(let t=e.length-1;t>0;t--){let i=Math.floor(Math.random()*(t+1));[e[t],e[i]]=[e[i],e[t]]}return e},v=[],w=[],y=!0,m=!1,p;function f(e,t,i,a){e.addEventListener(t,i,a),v.push(()=>e.removeEventListener(t,i,a))}function P(e,t,i="#faf8f1"){let a=document.createElement("style");a.textContent="@font-face{font-family:Playful;src:url('./assets/playful.woff2')}*{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:Arial,sans-serif;color:#24252a;-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;cursor:pointer;touch-action:manipulation;min-height:42px;color:inherit}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #5ca1d5;outline-offset:4px}.fit{position:absolute;width:390px;height:598px;transform-origin:0 0;overflow:hidden}canvas.stage{display:block;width:390px;height:598px;touch-action:none}.hud{position:absolute;left:30px;right:30px;top:28px;display:flex;justify-content:space-between;align-items:center;z-index:6;font-size:28px;font-weight:700;pointer-events:none}.hud.center{justify-content:center}.guide{position:absolute;z-index:9;top:185px;left:30px;right:30px;text-align:center;font-size:18px;font-weight:700;line-height:1.4;pointer-events:none;animation:breathe 2.2s ease-in-out infinite;transition:opacity .22s}.guide.gone{opacity:0;visibility:hidden}.pill{padding:11px 22px;background:#26262a;color:#fff;border-radius:26px;font-size:15px;font-weight:700}.quiet{background:transparent;color:inherit;border:1px solid #24252a40}.bottom{position:absolute;left:30px;right:30px;bottom:32px;display:flex;gap:10px;justify-content:center;align-items:center;z-index:8}.capability{font-size:13px;padding:9px 17px;border:1px solid #25252a25;border-radius:24px;background:#ffffffcf;min-height:40px}.status{position:absolute;left:30px;right:30px;bottom:82px;z-index:8;text-align:center;font-size:12px;color:#777;pointer-events:none}.modal{position:absolute;inset:0;z-index:30;background:#22242c33;display:grid;place-items:center;padding:30px}.modal[hidden]{display:none}.result{width:100%;max-width:320px;border-radius:22px;padding:32px 22px;background:#fffcf3;text-align:center;box-shadow:0 12px 50px #0002}.result h2{font-size:24px;line-height:1.2;margin:0 0 13px}.result .value{font-size:48px;font-weight:800;margin:12px 0}.result p{font-size:15px;line-height:1.5}.result button{margin-top:14px}.smallcaps{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase}.flash{position:absolute;inset:0;z-index:25;background:white;pointer-events:none;opacity:0}.flash.fire{animation:flash .35s ease-out}@keyframes flash{from{opacity:.95}to{opacity:0}}@keyframes breathe{50%{opacity:.66;transform:scale(.975)}}@media(prefers-reduced-motion:reduce){.guide{animation:none}}"+e,document.head.append(a),l.style.background=i,he(l,'<div class="fit">'+t+"</div>");let n=l.querySelector(".fit");function o(){let s=l.getBoundingClientRect(),r=Math.min(s.width/390,s.height/598);n.style.transform=`translate(${(s.width-390*r)/2}px,${(s.height-598*r)/2}px) scale(${r})`,l.dataset.layout=`${Math.round(s.width)}x${Math.round(s.height)}`}o(),f(window,"resize",o)}function u(e){return l.querySelector(e)}function X(){var e;(e=u(".guide"))==null||e.classList.add("gone")}function q(e){l.dataset.phase=e}function B(){F(),X()}function F(){try{p||(p=new(window.AudioContext||window.webkitAudioContext)),p.state==="suspended"&&p.resume().catch(()=>{})}catch{}}function M(e=450,t=.08,i=.18,a="sine",n=0){if(!(!p||!y))try{let o=p.createOscillator(),s=p.createGain(),r=p.currentTime;o.type=a,o.frequency.setValueAtTime(e,r),n&&o.frequency.exponentialRampToValueAtTime(Math.max(30,n),r+t),s.gain.setValueAtTime(.001,r),s.gain.exponentialRampToValueAtTime(i,r+.006),s.gain.exponentialRampToValueAtTime(.001,r+t),o.connect(s),s.connect(p.destination),o.start(r),o.stop(r+t+.02),o.onended=()=>{o.disconnect(),s.disconnect()}}catch{}}function h(){M(523,.12,.18),setTimeout(()=>M(784,.17,.16),100)}function $(){M(180,.22,.18,"triangle",65)}function me(e){let t=0;function i(a){if(m)return;let n=Math.min(.035,(a-(t||a))/1e3);t=a,document.hidden||e(y?n:0,a/1e3),requestAnimationFrame(i)}requestAnimationFrame(i)}function ge(){let e=u("canvas.stage"),t=e.getContext("2d"),i=Math.min(2,window.devicePixelRatio||1);return e.width=390*i,e.height=598*i,t.scale(i,i),{canvas:e,ctx:t}}function Pe(e,t=u("canvas.stage")){let i=t.getBoundingClientRect();return{x:(e.clientX-i.left)*390/i.width,y:(e.clientY-i.top)*598/i.height}}function be(e,t,i,a,n,o){o=Math.min(Math.abs(a)/2,Math.abs(n)/2,o),e.moveTo(t+o,i),e.lineTo(t+a-o,i),e.quadraticCurveTo(t+a,i,t+a,i+o),e.lineTo(t+a,i+n-o),e.quadraticCurveTo(t+a,i+n,t+a-o,i+n),e.lineTo(t+o,i+n),e.quadraticCurveTo(t,i+n,t,i+n-o),e.lineTo(t,i+o),e.quadraticCurveTo(t,i,t+o,i),e.closePath()}function qe(e,t,i,a,n,o,s,r){e.beginPath(),be(e,t,i,a,n,o),s&&(e.fillStyle=s,e.fill()),r&&(e.strokeStyle=r,e.stroke())}function Re(e,t,i,a,n,o){e.beginPath(),e.arc(t,i,Math.max(.01,a),0,Math.PI*2),n&&(e.fillStyle=n,e.fill()),o&&(e.strokeStyle=o,e.stroke())}function Ue(e,t,i,a,n,o,s=2){e.beginPath(),e.moveTo(t,i),e.lineTo(a,n),e.strokeStyle=o,e.lineWidth=s,e.stroke()}function Ee(e,t,i,a,n=18,o="#25252a",s="UIBody",r="center"){e.font=`700 ${n}px ${s}`,e.fillStyle=o,e.textAlign=r,e.textBaseline="middle",e.fillText(t,i,a)}let se=[];function K(e){let t=e.split("/").pop().replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9]/g,"_").toUpperCase();return String(ce(t,e))}function Be(e){let t=new Image;return t.onerror=()=>{l.dataset.assetIssue="image"},t.src=K(e),se.push({im:t,path:e}),t}function xe(e,t,i,a,n,o){if(!t||!t.width)return;let s=t.videoWidth||t.width,r=t.videoHeight||t.height;if(!s||!r)return;let C=Math.max(n/s,o/r);e.save(),e.beginPath(),e.rect(i,a,n,o),e.clip(),e.drawImage(t,i+(n-s*C)/2,a+(o-r*C)/2,s*C,r*C),e.restore()}function $e(e,t,i,a,n){e.save(),e.beginPath(),e.arc(i,a,n,0,Math.PI*2),e.clip(),xe(e,t,i-n,a-n,n*2,n*2),e.restore()}function ve(e,t,i,a){let n=u(".modal");if(!n)return;n.hidden=!1,n.querySelector("h2").textContent=e,n.querySelector(".value").textContent=t,n.querySelector("p").textContent=i;let o=n.querySelector("button");o.onclick=()=>{n.hidden=!0,B(),a()},q("result")}function ye(e="Rigioca"){return`<div class="modal" hidden><section class="result"><h2></h2><div class="value"></div><p></p><button class="pill">${e}</button></section></div>`}function Le(){let e=u(".flash");e&&(e.classList.remove("fire"),e.offsetWidth,e.classList.add("fire"))}let Q=[];function re(e){y=e,e||p==null||p.suspend().catch(()=>{});for(let t of Q)t(e)}f(window,"message",e=>{var t;e.source===parent&&((t=e.data)==null?void 0:t.type)==="playable-active"&&re(e.data.active===!0)}),f(document,"visibilitychange",()=>{re(!document.hidden)}),f(window,"pagehide",()=>{m=!0,v.splice(0).forEach(e=>e()),w.splice(0).forEach(e=>e()),p==null||p.close().catch(()=>{})});let le={};function ce(e,t){return le[e]??t}async function we(e=()=>{}){let t=new AbortController,i=setTimeout(()=>t.abort(),1600);try{let a=await fetch("./game.config.json",{signal:t.signal});if(!a.ok)throw Error("Configurazione non disponibile");let n=await a.json();for(let o of["texts","tweaks","images"])for(let s of n[o]||[])le[s.id]=o==="images"?s.path:s.value;for(let o of se){let s=K(o.path);o.im.getAttribute("src")!==s&&(o.im.src=s)}for(let o of l.querySelectorAll('img[src^="./assets/"]'))o.src=K(o.getAttribute("src"));e(),l.dataset.config="loaded"}catch{l.dataset.config="defaults"}finally{clearTimeout(i)}}let c=null,d=null,A=null,O=null,H=!1,L=!1,k="",ue=()=>{};function I(){c==null||c.getTracks().forEach(e=>e.stop()),c=null,d==null||d.close().catch(()=>{}),d=A=O=null,H=!1}async function fe(){var e;if(!H){H=!0;try{if(!((e=navigator.mediaDevices)!=null&&e.getUserMedia))throw Error("Microfono non disponibile");if(c=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,autoGainControl:!1}}),m||!y||k==="hold"){I();return}d=new(window.AudioContext||window.webkitAudioContext),await d.resume();let t=d.createMediaStreamSource(c);A=d.createAnalyser(),A.fftSize=1024,t.connect(A),O=new Float32Array(A.fftSize),u(".mic-enable").textContent="Mic attivo",u(".mic-status").textContent="In ascolto \xB7 puoi anche tenere premuto o usare Spazio",l.dataset.microphone="enabled"}catch{H=!1,u(".mic-enable").textContent="Attiva microfono",u(".mic-status").textContent="Microfono non disponibile \xB7 tieni premuto per giocare",l.dataset.microphone="unavailable"}}}function Ce(){if(L)return .9;if(!A||!y)return 0;A.getFloatTimeDomainData(O);let e=0;for(let t of O)e+=t*t;return J((Math.sqrt(e/O.length)-.012)*14,0,1)}function Me(){f(u(".mic-enable"),"click",()=>{F(),fe()});let e=u(".voice-hold");f(e,"pointerdown",t=>{t.preventDefault(),B(),ee("hold"),L=!0,e.setPointerCapture(t.pointerId)});for(let t of["pointerup","pointercancel","lostpointercapture"])f(e,t,()=>L=!1);f(window,"keydown",t=>{t.code==="Space"&&!t.repeat&&(t.preventDefault(),B(),ee("hold"),L=!0)}),f(window,"keyup",t=>{t.code==="Space"&&(L=!1)}),Q.push(t=>{if(t){if(d==null||d.resume().catch(()=>{}),c)for(let i of c.getTracks())i.enabled=!0}else if(L=!1,d==null||d.suspend().catch(()=>{}),c)for(let i of c.getTracks())i.enabled=!1}),w.push(I),Se()}function ke(e="Tieni premuto"){return`<div class="status mic-status" hidden></div><div class="bottom"><button class="capability mic-enable">Attiva microfono</button><button class="capability voice-hold">${e}</button></div>`}function ee(e){k=e,e==="hold"&&(c||H)&&I(),ue()}function Se(){let e=u(".mic-enable"),t=u(".voice-hold"),i=e.parentElement,a=u(".mic-status"),n=!0,o=document.createElement("style");o.textContent="#root .bottom.voice-mode-selected{display:flex!important;justify-content:center!important;align-items:center!important}#root .bottom.voice-mode-selected>.capability{flex:0 1 auto!important;width:auto!important;min-width:150px;max-width:260px}#root .bottom>.capability[hidden]{display:none!important}",document.head.append(o);function s(){m||(e.hidden=k==="hold",t.hidden=k==="voice",i.classList.toggle("voice-mode-selected",!!k),l.dataset.voiceControl=k||"choice",k==="hold"&&(a.textContent="",a.hidden=!0))}ue=s,f(e,"click",()=>ee("voice"),{capture:!0});let r=new MutationObserver(()=>{let C=l.dataset.microphone;k==="voice"&&["unavailable","error","off"].includes(C)&&(k=""),k==="hold"&&c&&I(),s()});r.observe(l,{attributes:!0,attributeFilter:["data-microphone"]}),w.push(()=>r.disconnect()),s()}function ze(){let e=u(".mic-enable"),t=u(".mic-status"),i=new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en",n=!0?{idle:"Mic spento",requesting:"Connessione\u2026",active:"Mic attivo",paused:"Mic in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Non disponibile \xB7 usa il pulsante"}:{idle:"Mic spento",requesting:"Connessione\u2026",active:"Mic attivo",paused:"Mic in pausa",start:"Attiva microfono",stop:"Disattiva microfono",listening:"",fallback:"",unavailable:"Microfono non disponibile \xB7 tieni premuto per giocare"},o=document.createElement("style");o.textContent=".bottom .capability.mic-enable{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;flex:1 1 174px}.mic-enable .mic-icon{width:18px;height:18px;flex:none}.mic-enable .mic-record-dot{width:10px;height:10px;flex:none;background:currentColor;border-radius:50%}.bottom .capability.mic-enable.is-listening{background:#d94646;border-color:#d94646;color:#fff;box-shadow:0 2px 8px #bd333326}.mic-enable .mic-button-label{white-space:nowrap}",document.head.append(o);let s=!1,r=!1,C="",W=null,N=null;function Te(){var D;let b=((D=c==null?void 0:c.getAudioTracks)==null?void 0:D.call(c))||[];return y&&!!A&&(d==null?void 0:d.state)==="running"&&b.some(T=>T.readyState==="live"&&T.enabled&&!T.muted)}function S(){var pe;if(m)return;let b=Te(),D=!!((pe=c==null?void 0:c.getAudioTracks)!=null&&pe.call(c).some(ie=>ie.readyState==="live")),T=s?"requesting":b?"active":D?"paused":r?"unavailable":"idle";if(e.disabled=s,e.setAttribute("aria-pressed",String(b)),e.classList.toggle("is-listening",b),e.setAttribute("aria-label",D?n.stop:n.start),e.dataset.micState=T,l.dataset.microphone=b?"enabled":T==="idle"?"off":T,T!==C){let ie=b?'<span class="mic-record-dot" aria-hidden="true"></span>':'<svg class="mic-icon" viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M6 1h4v1h1v7h-1v1H6V9H5V2h1zM3 7h1v3h1v1h6v-1h1V7h1v4h-1v1H9v2h3v1H4v-1h3v-2H4v-1H3z"/></svg>',Ie=s?n.requesting:b?n.active:D?n.paused:n.idle;he(e,ie+'<span class="mic-button-label">'+Ie+"</span>"),t.textContent=b?n.listening:r?n.unavailable:n.fallback,C=T}}function oe(){if(c&&W!==c){W=c;for(let b of c.getAudioTracks())f(b,"ended",()=>{I(),r=!1,S()}),f(b,"mute",S),f(b,"unmute",S)}d&&N!==d&&(N=d,f(d,"statechange",S))}f(e,"click",async b=>{if(b.preventDefault(),b.stopImmediatePropagation(),!(s||m)){if(c){I(),r=!1,S();return}if(F(),r=!1,s=!0,S(),await fe(),s=!1,m||!y){I(),S();return}(!c||!d||!A)&&(I(),r=!0),oe(),C="",S()}},{capture:!0}),Q.push(()=>{Promise.resolve().then(()=>{oe(),S()})}),oe(),S()}function Ae(e){let t=u(e==="camera"?".cam-status":".mic-status");if(!t)return;let i=!0;t.setAttribute("role","status"),t.setAttribute("aria-live","polite");function a(){var W;let r="";if(e==="camera")["requesting","unavailable"].includes(l.dataset.camera)&&(r=t.textContent);else{let N=((W=u(".mic-enable"))==null?void 0:W.dataset.micState)||l.dataset.microphone;N==="requesting"?r="Consenti l\u2019accesso al microfono":["unavailable","error"].includes(N)&&(r="Microfono non disponibile")}t.textContent!==r&&(t.textContent=r);let C=!r.trim();t.hidden!==C&&(t.hidden=C)}let n=new MutationObserver(a);n.observe(t,{childList:!0,characterData:!0,subtree:!0});let o=new MutationObserver(a);o.observe(l,{attributes:!0,attributeFilter:[e==="camera"?"data-camera":"data-microphone"]});let s=u(".mic-enable");s&&o.observe(s,{attributes:!0,attributeFilter:["data-mic-state"]}),a(),w.push(()=>{n.disconnect(),o.disconnect()})}P(".fit{background:#fff;color:#292929}.hud{font:24px monospace;justify-content:flex-end}.guide{top:200px;font:18px monospace}.capability{font-family:monospace;border-radius:0;border:2px solid #333}.status{font-family:monospace;font-size:10px}.result{background:#fff;border:3px solid #333;border-radius:0;box-shadow:7px 7px #3333}.result h2{font-family:monospace}.result .value{font:38px monospace}.pill{border-radius:0;background:#292929;font-family:monospace}",`<canvas class="stage" aria-label="Dinosauro pixel: salta con la voce"></canvas><div class="hud"><span class="score">00000</span></div><div class="guide">Fai un suono per saltare</div>${ke("Tieni per saltare")}${ye("Corri ancora")}`,"#fff"),Ae("microphone");let{ctx:g}=ge(),R="ready",U=0,G=0,E=210,_=0,te=0,Y=1.4,j=[],Z=!0,ne=["00000001111110","00000001110110","00000001111110","00000001110000","10000001111100","11000011100000","11100111111000","01111111101000","00111111100000","00011111000000","00001101000000","00001001000000"];function de(){R="ready",U=0,G=0,E=210,_=0,Y=1.4,j=[],Z=!0,u(".score").textContent="00000",q("ready")}Me(),ze(),me((e,t)=>{let i=Ce();if(i<.12&&(Z=!0),i>.32&&Z&&U<=.1&&R!=="result"&&(B(),Z=!1,G=440,R==="ready"&&(R="playing",q("playing")),M(340,.08,.1,"square",550)),R==="playing"){_+=E*e,E=Math.min(450,E+e*5),te=(te+E*e)%40,G-=1150*e,U=Math.max(0,U+G*e),U===0&&(G=0),Y-=e,Y<=0&&(j.push({x:440,w:V([15,22,30]),h:V([32,40,48])}),Y=x(1.1,1.6)*210/E+.35);for(let n of j)n.x-=E*e,n.x<119&&n.x+n.w>84&&U<n.h-8&&(R="result",$(),ve("Fine partita",Math.floor(_/20).toString().padStart(5,"0"),"Un po\u2019 pi\xF9 forte, un po\u2019 prima.",de));j=j.filter(n=>n.x>-40),u(".score").textContent=Math.floor(_/20).toString().padStart(5,"0"),l.dataset.distance=Math.floor(_)}g.fillStyle="#fff",g.fillRect(0,0,390,598),g.fillStyle="#e2e2df";for(let[n,o]of[[32,140],[260,235],[350,110]])g.fillRect(n,o,36,2),g.fillRect(n+7,o-9,22,2),g.fillRect(n+5,o-7,2,7),g.fillRect(n+29,o-7,2,7);g.fillStyle="#4b4b49",g.fillRect(0,451,390,2);for(let n=-te;n<390;n+=40)g.fillRect(n,460+n%3*3,8,1);let a=414-U;for(let n=0;n<ne.length;n++)for(let o=0;o<ne[n].length;o++)if(ne[n][o]==="1"){if(n>9&&R==="playing"&&Math.sin(t*16)>0&&o>6)continue;g.fillRect(73+o*3,a+n*3,3,3)}for(let n of j)g.fillRect(n.x+n.w*.4,451-n.h,n.w*.26,n.h),g.fillRect(n.x,451-n.h*.7,n.w*.25,n.h*.4),g.fillRect(n.x,451-n.h*.35,n.w*.5,5),g.fillRect(n.x+n.w*.8,451-n.h*.8,n.w*.2,n.h*.5),g.fillRect(n.x+n.w*.6,451-n.h*.4,n.w*.4,5)}),de(),we(()=>{u(".guide")&&(u(".guide").textContent=String(ce("GUIDE","Fai un suono per saltare")))})})();(()=>{let l=document.createElement("style");l.dataset.batch3Ui="20261116",l.textContent=`
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

@font-face{font-family:UIPixel;src:url('./assets/ui/Silkscreen-Regular.ttf') format('truetype');font-display:swap}
.hud{justify-content:center;font:400 28px/1.25 UIPixel,monospace}
.guide{font:400 18px/1.5 UIPixel,monospace}
.bottom{gap:8px}.bottom .capability{font:400 13px/1.4 UIPixel,monospace;padding:9px 9px}
.status{font:400 12px/1.5 UIPixel,monospace;color:#555}
.result h2,.result .value{font-family:UIPixel,monospace}.pill{font-family:UIPixel,monospace;font-size:14px}
`,document.head.append(l)})();})();
