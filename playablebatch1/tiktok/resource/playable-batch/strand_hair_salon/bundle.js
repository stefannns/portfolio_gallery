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

(()=>{function Z(f,$){if(!f)throw new Error("Game mount target is missing");let l=String($??""),i=I=>I.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(s,M)=>{if(M[0]==="#"){let T=M[1].toLowerCase()==="x",w=parseInt(M.slice(T?2:1),T?16:10);return w>0&&w<=1114111?String.fromCodePoint(w):"\uFFFD"}return{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0"}[M.toLowerCase()]||s});for(;f.firstChild;)f.removeChild(f.firstChild);let R=[{element:f,tag:"",svg:f.namespaceURI==="http://www.w3.org/2000/svg"}],P=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i,k=0;for(;k<l.length;){if(l.startsWith("<!--",k)){let h=l.indexOf("-->",k+4);k=h<0?l.length:h+3;continue}if(l[k]!=="<"){let h=l.indexOf("<",k),C=h<0?l.length:h;R[R.length-1].element.appendChild(document.createTextNode(i(l.slice(k,C)))),k=C;continue}let I=k+1,s="";for(;I<l.length;I++){let h=l[I];if(s)h===s&&(s="");else if(h==='"'||h==="'")s=h;else if(h===">")break}if(I>=l.length)throw new Error("Incomplete game markup");let M=l.slice(k+1,I);if(k=I+1,/^\s*!/.test(M))continue;let T=/^\s*\/\s*([\w:-]+)/.exec(M);if(T){for(let h=R.length-1;h>0;h--)if(R[h].tag.toLowerCase()===T[1].toLowerCase()){R.length=h;break}continue}let w=/^\s*([\w:-]+)/.exec(M);if(!w)throw new Error("Invalid game markup");let S=w[1],u=R[R.length-1],z=S.toLowerCase()==="svg"||u.svg&&u.tag.toLowerCase()!=="foreignobject",L=z?document.createElementNS("http://www.w3.org/2000/svg",S):document.createElement(S),H=M.slice(w[0].length).replace(/\/\s*$/,""),B=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,x;for(;x=B.exec(H);){let h=x[1],C=i(x[2]??x[3]??x[4]??"");L.setAttribute(h,C)}u.element.appendChild(L),!P.test(S)&&!/\/\s*$/.test(M)&&R.push({element:L,tag:S,svg:z})}return l}document.documentElement.lang="it";(()=>{"use strict";var vt,Mt;let f=document.getElementById("root"),$=document.createElement("style");$.textContent="*{box-sizing:border-box}html,body,#root{height:100%;width:100%;margin:0;overflow:hidden;background:#09090b;color:white;font-family:system-ui,sans-serif}button{font:700 13px system-ui;color:white;background:#111;border:2px solid #eee;border-radius:30px;padding:8px 11px;touch-action:manipulation}.scene{height:100%;position:relative;overflow:hidden}canvas{position:absolute;width:100%;height:100%;touch-action:none}.guide{position:absolute;top:15%;width:100%;text-align:center;font-weight:800;font-size:19px;pointer-events:none}.top{position:absolute;top:3%;left:4%;right:4%;display:flex;justify-content:space-between;gap:5px}.reset{border-color:#ff5559;color:#ff6a6c}.tools{position:absolute;bottom:4%;left:3%;right:3%;display:flex;justify-content:center;flex-wrap:wrap;gap:5px}.tools button.active{background:#fff;color:#111}.hold-tool{position:relative;display:flex}.drop{position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);z-index:3;min-height:36px;white-space:nowrap}.palette{position:absolute;z-index:5;top:11%;left:5%;width:min(245px,65%);background:#101010;border:2px solid #eee;border-radius:10px;padding:12px;box-shadow:0 4px 20px #0008}.palette-head{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700}.palette .done{font-size:12px;padding:4px 9px}.color-wheel{width:145px;height:145px;max-width:90%;aspect-ratio:1;border-radius:50%;margin:14px auto;touch-action:none;background:radial-gradient(circle,white,transparent 70%),conic-gradient(red,#ff0,lime,cyan,blue,magenta,red);border:2px solid white}.brightness-label{display:flex;justify-content:space-between;font-size:11px;color:#ddd}.brightness{width:100%;accent-color:white;margin:7px 0}.color-preview{height:25px;border:2px solid white;border-radius:5px}.hidden{display:none}",document.head.append($),Z(f,'<div class="scene"><canvas aria-label="Area per acconciare i capelli"></canvas><div class="guide">Scegli uno strumento</div><div class="top"><button class="reset">Ricomincia</button><button class="brush">Pennello: S</button><button class="pause">Pausa</button></div><div class="palette hidden"></div><div class="tools"></div></div>');let l=f.querySelector("canvas"),i=l.getContext("2d"),R=f.querySelector(".guide"),P=f.querySelector(".palette");$.textContent+=`#root .top{top:30px;left:30px;right:30px;gap:12px;align-items:center}
#root .top button{min-height:44px;padding:0 4px;border:0;border-radius:0;background:transparent;box-shadow:none;font:700 14px/1.3 UIBody,system-ui,sans-serif;color:#d3d3d9}
#root .top .reset{color:#ff777b}#root .top button:active{opacity:.65}
#root .guide{top:18%;left:30px;right:30px;width:auto;font:700 18px/1.4 UIBody,system-ui,sans-serif}
#root .tools{left:30px;right:30px;bottom:calc(50px + env(safe-area-inset-bottom,0px));display:block;overflow:visible}
#root .tool-scroll{width:100%;padding:4px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;touch-action:pan-x;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;user-select:none;-webkit-user-select:none}
#root .tool-scroll::-webkit-scrollbar{display:none}
#root .tool-scroll,#root .tool-scroll button{cursor:grab}#root .tool-scroll.is-dragging,#root .tool-scroll.is-dragging button{cursor:grabbing}
#root .tool-row{display:flex;flex-wrap:nowrap;align-items:center;justify-content:flex-start;width:max-content;min-width:100%;gap:8px}
#root .tool-row button{flex:none;min-height:44px;padding:9px 12px;font:700 14px/1.3 UIBody,system-ui,sans-serif;white-space:nowrap;touch-action:pan-x}
#root .hold-tool{flex:none;display:flex}
#root .tool-hint{position:absolute;right:4px;bottom:calc(100% + 9px);display:flex;align-items:center;gap:7px;max-width:170px;color:#d0d0d7;font:400 13px/1.4 UIBody,system-ui,sans-serif;white-space:nowrap;pointer-events:none}
#root .tool-hint svg{width:20px;height:14px;flex:none}
#root .tool-hint[hidden]{display:none!important}
#root .tools>.drop{position:absolute;bottom:calc(100% + 7px);z-index:4;min-height:44px;padding:9px 12px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
`;let k={Hand:"Mano",Hold:"Tieni",Scissors:"Forbici",Regrow:"Ricrescita",Colors:"Colori",Wash:"Lava",Blow:"Asciuga"},I=[["Hand","Hold","Scissors","Regrow"],["Colors","Wash","Blow"]],s="Hand",M="#fafafa",T=0,w=!1,S=!1,u=null,z=new URLSearchParams(location.search).get("feedReview")!=="1",L=[],H=[],B=[],x=[],h=null;Z(P,'<div class="palette-head"><span>Scegli il colore</span><button class="done">Fatto</button></div><div class="color-wheel" role="slider" aria-label="Scegli il colore dei capelli" tabindex="0"></div><div class="brightness-label"><span>Scuro</span><span>Chiaro</span></div><input class="brightness" aria-label="Luminosit\xE0 del colore" type="range" min="0" max="100" value="100"><div class="color-preview"></div>');let C=50,dt=1,tt=1,F=P.querySelector(".color-wheel"),ct=P.querySelector(".brightness"),kt=P.querySelector(".color-preview");function et(){let t=tt*dt,e=t*(1-Math.abs(C/60%2-1)),o=tt-t;M=`rgb(${(C<60?[t,e,0]:C<120?[e,t,0]:C<180?[0,t,e]:C<240?[0,e,t]:C<300?[e,0,t]:[t,0,e]).map(a=>Math.round((a+o)*255)).join(",")})`,kt.style.background=M}function pt(t){let e=F.getBoundingClientRect(),o=(t.clientX-e.left-e.width/2)/(e.width/2),n=(t.clientY-e.top-e.height/2)/(e.height/2);C=(Math.atan2(o,-n)*180/Math.PI+360)%360,dt=Math.min(1,Math.hypot(o,n)),et()}F.addEventListener("pointerdown",t=>{F.setPointerCapture(t.pointerId),pt(t)}),F.addEventListener("pointermove",t=>{F.hasPointerCapture(t.pointerId)&&pt(t)}),ct.addEventListener("input",()=>{tt=Number(ct.value)/100,et()}),P.querySelector(".done").onclick=()=>P.classList.add("hidden"),et(),Z(f.querySelector(".tools"),'<div class="tool-scroll" role="toolbar" aria-label="Strumenti per capelli"><div class="tool-row">'+I.flat().map(t=>{let e=`<button data-tool="${t}" class="${t===s?"active":""}">${k[t]}</button>`;return t==="Hold"?`<span class="hold-tool">${e}<button class="drop hidden" data-action="drop">Lascia</button></span>`:e}).join("")+"</div></div>");let q=f.querySelector(".drop"),ot=f.querySelector(".tools"),m=f.querySelector(".tool-scroll");m.setAttribute("aria-orientation","horizontal");let g=null,_=!1;function ft(t){if(!g||t.pointerId!==g.id)return;let e=t.clientX-g.x,o=t.clientY-g.y;if((Math.hypot(e,o)>=8||Math.abs(m.scrollLeft-g.left)>2)&&(g.moved=!0),g.desktop&&(g.dragging||Math.abs(e)>=8&&Math.abs(e)>=Math.abs(o))){if(g.dragging=!0,m.classList.add("is-dragging"),!m.hasPointerCapture(t.pointerId))try{m.setPointerCapture(t.pointerId)}catch{}m.scrollLeft=g.left-e,t.preventDefault()}}m.addEventListener("pointerdown",t=>{t.button!==0||t.isPrimary===!1||(_=!1,g={id:t.pointerId,x:t.clientX,y:t.clientY,left:m.scrollLeft,moved:!1,desktop:t.pointerType==="mouse"||t.pointerType==="pen",dragging:!1})},{passive:!0}),m.addEventListener("pointermove",ft,{passive:!1});function nt(t,e=!1){!g||t.pointerId!==g.id||(e||ft(t),_=e||g.moved,g=null,m.classList.remove("is-dragging"))}window.addEventListener("pointerup",t=>nt(t),{passive:!1}),window.addEventListener("pointercancel",t=>nt(t,!0),{passive:!0}),m.addEventListener("lostpointercapture",t=>nt(t,!0),{passive:!0}),m.addEventListener("scroll",()=>{g&&Math.abs(m.scrollLeft-g.left)>2&&(g.moved=!0)},{passive:!0}),m.addEventListener("click",t=>{_&&t.detail!==0&&(_=!1,t.preventDefault(),t.stopPropagation())},!0),ot.append(q);let U=document.createElement("span"),ht=(new URLSearchParams(location.search).get("lang")||document.documentElement.lang||"en").toLowerCase().startsWith("it");U.className="tool-hint",U.setAttribute("aria-label",ht?"Scorri con il dito o trascina gli strumenti":"Swipe or press and drag tools left or right"),Z(U,'<span>Scorri / trascina</span><svg viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h20M6 3 2 8l4 5M18 3l4 5-4 5"/></svg>'),ot.append(U);function it(){if(U.hidden=m.scrollWidth<=m.clientWidth+1,!U.hidden&&!q.classList.contains("hidden")){let t=U.getBoundingClientRect(),e=q.getBoundingClientRect();t.left<e.right+8&&t.right>e.left-8&&t.top<e.bottom+4&&t.bottom>e.top-4&&(U.hidden=!0)}}requestAnimationFrame(it),(Mt=(vt=document.fonts)==null?void 0:vt.ready)==null||Mt.then(it);function Y(){let t=ot.getBoundingClientRect(),e=f.querySelector('[data-tool="Hold"]').getBoundingClientRect(),o=(q.offsetWidth||64)/2;q.style.left=Math.max(o+4,Math.min(t.width-o-4,e.left+e.width/2-t.left))+"px",it()}m.addEventListener("scroll",Y,{passive:!0}),window.addEventListener("resize",Y);function G(t,e,o){let n=Math.min(e*.22,o*.16);t.x=.5+t.u*n/e,t.top=.4-Math.sqrt(Math.max(0,1-t.u*t.u))*n/o}function ut(){let t=l.clientWidth||390,e=l.clientHeight||598;B=[],x=[],q.classList.add("hidden"),L=Array.from({length:170},(o,n)=>{let a={u:2*n/169-1,dx:0,dy:0,v:0,vy:0,held:!1,curveSpan:1,dye:[],growRemaining:0,wet:0};return G(a,t,e),a.len=.65-a.top+Math.random()*.015,a})}function Lt(){let t=Math.min(devicePixelRatio||1,2),e=l.clientWidth,o=l.clientHeight;return(l.width!==e*t||l.height!==o*t)&&(l.width=e*t,l.height=o*t),i.setTransform(t,0,0,t,0,0),[e,o]}let gt=t=>3*(1-t)*(1-t)*t*.1+3*(1-t)*t*t*.65+t*t*t;function at(t,e){let o=t.curveSpan||1;return gt(e*o)/gt(o)}function D(t,e,o,n){let a=at(t,e);return[(t.x+t.dx*a)*o,(t.top+t.len*e+t.dy*a)*n]}function rt(t,e,o,n,a){let r=Math.max(2,Math.ceil((o-e)*48));i.beginPath();for(let c=0;c<=r;c++){let d=D(t,e+(o-e)*c/r,n,a);c?i.lineTo(...d):i.moveTo(...d)}i.stroke()}function Tt(t,e){let o=t.dye.find(n=>e>=n.from&&e<=n.to);return o?o.color:"#fafafa"}function Ct(t,e,o,n){if(e=Math.max(0,e),o=Math.min(t.len,o),o<=e)return;let a=[];for(let r of t.dye)r.to<=e||r.from>=o?a.push(r):(r.from<e&&a.push({...r,to:e}),r.to>o&&a.push({...r,from:o}));a.push({from:e,to:o,color:n}),a.sort((r,c)=>r.from-c.from),t.dye=[];for(let r of a){let c=t.dye[t.dye.length-1];c&&c.color===r.color&&r.from<=c.to+1e-5?c.to=Math.max(c.to,r.to):t.dye.push(r)}}function Rt(t,e){if(!(e<=0)){t.len+=e;for(let o of t.dye)o.from+=e,o.to+=e}}function Bt(t=.14){for(let e of L)e.growRemaining+=t}function N(){let[t,e]=Lt();i.clearRect(0,0,t,e),i.strokeStyle="#f8f8f8",i.lineWidth=Math.max(2,t*.006),i.lineCap="round",i.lineJoin="round",i.beginPath(),i.arc(t*.5,e*.4,Math.min(t*.22,e*.16),0,Math.PI*2),i.stroke(),i.beginPath(),i.moveTo(t*.16,e*.71),i.lineTo(t*.5,e*.62),i.lineTo(t*.84,e*.71),i.stroke();for(let o of B){i.save(),i.translate((o.cx+o.x)*t,(o.cy+o.y)*e),i.rotate(o.angle),i.globalAlpha=Math.min(1,Math.max(0,(2.5-o.age)*2)),i.lineWidth=Math.max(2.7,t*.0061);for(let n=1;n<o.points.length;n++){let a=o.points[n-1],r=o.points[n];i.strokeStyle=r.color,i.beginPath(),i.moveTo((a.x-o.cx)*t,(a.y-o.cy)*e),i.lineTo((r.x-o.cx)*t,(r.y-o.cy)*e),i.stroke()}i.restore()}for(let o of L){G(o,t,e),i.lineWidth=Math.max(2.9,t*.0065),i.strokeStyle="#fafafa",rt(o,0,1,t,e);for(let n of o.dye)i.strokeStyle=n.color,rt(o,n.from/o.len,Math.min(1,n.to/o.len),t,e);o.wet>.01&&(i.save(),i.globalAlpha=o.wet*.32,i.strokeStyle="#70c8f0",rt(o,0,1,t,e),i.restore())}for(let o of x)i.save(),i.globalAlpha=Math.max(0,1-o.age/o.life),i.lineWidth=1.4,i.strokeStyle=o.kind==="air"?"#f7ebd4":"#b4eaff",o.kind==="drop"?(i.beginPath(),i.moveTo(o.x*t,o.y*e),i.lineTo((o.x-o.vx*.035)*t,(o.y-o.vy*.035)*e),i.stroke()):o.kind==="bubble"?(i.fillStyle="#dff6ff",i.globalAlpha*=.75,i.beginPath(),i.arc(o.x*t,o.y*e,o.r*t,0,Math.PI*2),i.fill(),i.globalAlpha*=1.2,i.stroke()):(i.beginPath(),i.moveTo(o.x*t,o.y*e),i.quadraticCurveTo((o.x+.025)*t,(o.y+.003)*e,(o.x+.06)*t,(o.y+.015)*e),i.stroke()),i.restore();S&&u&&(s==="Wash"||s==="Blow")&&Pt(u,t,e)}function Pt(t,e,o){if(i.save(),i.translate(t.x*e,t.y*o),i.lineCap="round",i.lineJoin="round",s==="Wash"){i.translate(23,-52),i.rotate(.35),i.lineWidth=7,i.strokeStyle="#a8b9c6",i.beginPath(),i.moveTo(0,-24),i.lineTo(0,-3),i.stroke(),i.fillStyle="#e6f3ff",i.strokeStyle="#7fa9c3",i.lineWidth=2,i.beginPath(),i.roundRect(-18,-7,36,13,6),i.fill(),i.stroke(),i.fillStyle="#4d7b9a";for(let n=-12;n<=12;n+=6)i.fillRect(n-1,2,2,2)}else{i.translate(43,19),i.rotate(.35),i.fillStyle="#ffd59a",i.strokeStyle="#f5f2ec",i.lineWidth=2,i.beginPath(),i.roundRect(-12,-14,42,28,12),i.fill(),i.stroke(),i.fillStyle="#eeeeee",i.fillRect(-26,-9,17,18),i.fillStyle="#efab77",i.beginPath(),i.roundRect(8,7,12,29,5),i.fill(),i.stroke(),i.strokeStyle="#8e633e";for(let n=14;n<=24;n+=4)i.beginPath(),i.moveTo(n,-7),i.lineTo(n,7),i.stroke()}i.restore()}let J=0;function It(t,e){let o=l.clientWidth||390,n=l.clientHeight||598,a=([.055,.085,.12][T]+(s==="Blow"?.035:0))*o,r=e*60,c=!1;for(let d of L){let b=lt(d,t,o,n);if(b.closest>a)continue;c=!0;let v=1-b.closest/a;s==="Wash"?(d.wet=Math.min(1,d.wet+e*1.8*(.3+v)),d.held||(d.v*=Math.pow(.94,r),d.vy+=1e-4*v*r)):(d.wet=Math.max(0,d.wet-e*1.6*(.3+v)),d.held||(d.v=Math.max(-.016,d.v-.0016*v*r),d.vy=Math.max(-.012,d.vy-5e-4*v*r)))}for(J+=e*(s==="Wash"?65:25);J>=1;)J-=1,s==="Wash"?(x.push({kind:"drop",x:t.x+.055+(Math.random()-.5)*.06,y:t.y-.08,vx:-.06+(Math.random()-.5)*.08,vy:.38+Math.random()*.2,age:0,life:.55+Math.random()*.2}),c&&Math.random()<.34&&x.push({kind:"bubble",x:t.x+(Math.random()-.5)*a*2/o,y:t.y+(Math.random()-.5)*a/n,vx:(Math.random()-.5)*.014,vy:-.025,age:0,life:.8+Math.random()*.7,r:.003+Math.random()*.006})):x.push({kind:"air",x:t.x+.03,y:t.y+(Math.random()-.5)*.09,vx:-.45,vy:-.04,age:0,life:.32+Math.random()*.12});x.length>200&&x.splice(0,x.length-200)}let p=null,O=null,Q=null,j=null,K=null,st=!1;function V(){let t=j;if(t){j=null;try{t.source.stop()}catch{}t.source.disconnect(),t.filter.disconnect(),t.gain.disconnect()}}function Et(){if(!(st||!S||s!=="Scissors"||!z||w||document.hidden||!p||p.state==="closed")){st=!0;try{if(V(),!K){K=p.createBuffer(1,Math.floor(p.sampleRate*.095),p.sampleRate);let a=K.getChannelData(0);for(let r=0;r<a.length;r++)a[r]=Math.random()*2-1}let t=p.createBufferSource(),e=p.createBiquadFilter(),o=p.createGain(),n=p.currentTime;t.buffer=K,e.type="bandpass",e.frequency.value=2400,e.Q.value=.8,o.gain.setValueAtTime(.001,n),o.gain.linearRampToValueAtTime(.1,n+.003),o.gain.exponentialRampToValueAtTime(.001,n+.027),o.gain.linearRampToValueAtTime(.075,n+.037),o.gain.exponentialRampToValueAtTime(.001,n+.085),t.connect(e).connect(o).connect(p.destination),j={source:t,filter:e,gain:o},t.onended=()=>{(j==null?void 0:j.source)===t&&(j=null),t.disconnect(),e.disconnect(),o.disconnect()},t.start(n),t.stop(n+.09)}catch{V()}}}function qt(){if(s==="Scissors"){try{p??(p=new(window.AudioContext||window.webkitAudioContext)),p.resume().catch(V)}catch{}return}if(!(s!=="Wash"&&s!=="Blow"))try{if(p??(p=new(window.AudioContext||window.webkitAudioContext)),p.resume().catch(()=>{}),!Q){Q=p.createBuffer(1,p.sampleRate*2,p.sampleRate);let n=Q.getChannelData(0);for(let a=0;a<n.length;a++)n[a]=Math.random()*2-1}xt();let t=p.createBufferSource(),e=p.createBiquadFilter(),o=p.createGain();t.buffer=Q,t.loop=!0,e.type=s==="Wash"?"bandpass":"lowpass",e.frequency.value=s==="Wash"?2800:680,e.Q.value=.6,o.gain.setValueAtTime(0,p.currentTime),o.gain.linearRampToValueAtTime(s==="Wash"?.055:.075,p.currentTime+.12),t.connect(e).connect(o).connect(p.destination),t.start(),O={source:t,gain:o}}catch{}}function xt(){if(!O||!p)return;let{source:t,gain:e}=O;O=null,e.gain.cancelScheduledValues(p.currentTime),e.gain.setTargetAtTime(0,p.currentTime,.025);try{t.stop(p.currentTime+.15)}catch{}}let mt=0;function yt(t){let e=Math.min(.034,Math.max(0,(t-(mt||t))/1e3));if(mt=t,z&&!w&&!document.hidden){let o=e*60;S&&u&&(s==="Wash"||s==="Blow")&&It(u,e);for(let n of L){if(S&&s==="Regrow"&&(n.growRemaining=Math.max(n.growRemaining,.02)),n.growRemaining>0){let a=Math.min(n.growRemaining,.14*e);Rt(n,a),n.growRemaining-=a}n.wet=Math.max(0,n.wet-e*.008),!n.held&&(n.v+=-n.dx*.018*o,n.v*=Math.pow(.91,o),n.dx+=n.v*o,n.vy+=-n.dy*.018*o,n.vy*=Math.pow(.91,o),n.dy+=n.vy*o)}for(let n of B)n.age+=e,n.vy+=.9*e,n.x+=n.vx*e,n.y+=n.vy*e,n.angle+=n.spin*e;B=B.filter(n=>n.age<2.5&&n.cy+n.y<1.7);for(let n of x)n.age+=e,n.kind==="drop"&&(n.vy+=.6*e),n.x+=n.vx*e,n.y+=n.vy*e;x=x.filter(n=>n.age<n.life),N()}requestAnimationFrame(yt)}function wt(t){let e=l.getBoundingClientRect();return{x:(t.clientX-e.left)/e.width,y:(t.clientY-e.top)/e.height}}function lt(t,e,o,n){let a=1/0,r=0,c=D(t,0,o,n);for(let d=1;d<=48;d++){let b=D(t,d/48,o,n),v=b[0]-c[0],E=b[1]-c[1],y=Math.max(0,Math.min(1,((e.x*o-c[0])*v+(e.y*n-c[1])*E)/(v*v+E*E||1))),W=Math.hypot(c[0]+v*y-e.x*o,c[1]+E*y-e.y*n);W<a&&(a=W,r=(d-1+y)/48),c=b}return{closest:a,t:r}}function At(t,e,o,n){let a=t.len,r=Math.max(.012,a*e);if(a-r<.003)return;let c=r/a,d=[];for(let y=0;y<=20;y++){let W=c+(1-c)*y/20,St=D(t,W,o,n);d.push({x:St[0]/o,y:St[1]/n,color:Tt(t,a*W)})}let b=d.reduce((y,W)=>y+W.x,0)/d.length,v=d.reduce((y,W)=>y+W.y,0)/d.length;B.push({points:d,cx:b,cy:v,x:0,y:0,vx:(Math.random()-.5)*.055,vy:.025,angle:0,spin:(Math.random()-.5)*.8,age:0}),B.length>420&&B.splice(0,B.length-420);let E=at(t,c);t.dx*=E,t.dy*=E,t.curveSpan=(t.curveSpan||1)*c,t.len=r,t.dye=t.dye.filter(y=>y.from<r).map(y=>({...y,to:Math.min(y.to,r)})),t.v=0,t.vy=0,t.growRemaining=0,Et()}function bt(t,e){if(s==="Regrow"||s==="Wash"||s==="Blow")return;let o=l.clientWidth||390,n=l.clientHeight||598,a=[.045,.075,.115][T]*o;for(let r of L){G(r,o,n);let c=lt(r,t,o,n);if(!(c.closest>a)){if(s==="Scissors")At(r,c.t,o,n);else if(s==="Colors"){let d=null;for(let b=0;b<=96;b++){let v=D(r,b/96,o,n),E=Math.hypot(v[0]-t.x*o,v[1]-t.y*n)<=a;E&&d===null&&(d=Math.max(0,(b-.5)/96*r.len)),d!==null&&(!E||b===96)&&(Ct(r,d,Math.min(r.len,(b+.5)/96*r.len),M),d=null)}}else if(s==="Hand"){r.held=!1;let d=(t.x-((e==null?void 0:e.x)??t.x))*1.4;r.v+=Math.max(-.025,Math.min(.025,d))*(1-c.closest/a)}}}}function Wt(t){H=[];let e=l.clientWidth||390,o=l.clientHeight||598,n=[.045,.075,.115][T]*e;for(let a of L){G(a,e,o);let r=lt(a,t,e,o);if(r.closest<=n){let c=Math.max(.08,at(a,r.t));a.held=!0,a.v=0,a.vy=0,H.push({strand:a,dx:a.dx,dy:a.dy,k:c})}}H.length&&(q.classList.remove("hidden"),Y())}function zt(t){if(X)for(let e of H)e.strand.dx=e.dx+(t.x-X.x)/e.k,e.strand.dy=e.dy+(t.y-X.y)/e.k}let X=null;function A(){S=!1,h=null,X=null,J=0,xt();for(let t of H)t.strand.v=0,t.strand.vy=0;H=[]}l.addEventListener("pointerdown",t=>{!z||w||S||t.isPrimary===!1||(S=!0,h=t.pointerId,l.setPointerCapture(t.pointerId),u=wt(t),R.classList.add("hidden"),st=!1,qt(),s==="Hold"?(X=u,Wt(u)):bt(u,u))}),l.addEventListener("pointermove",t=>{if(!S||t.pointerId!==h)return;let e=wt(t);if(s==="Hold")zt(e);else{let o=Math.max(1,Math.ceil(Math.hypot(e.x-u.x,e.y-u.y)/.012));for(let n=1;n<=o;n++)bt({x:u.x+(e.x-u.x)*n/o,y:u.y+(e.y-u.y)*n/o},u)}u=e}),l.addEventListener("pointerup",t=>{t.pointerId===h&&A()}),l.addEventListener("pointercancel",t=>{t.pointerId===h&&A()}),l.addEventListener("lostpointercapture",t=>{t.pointerId===h&&A()}),f.querySelector(".tools").addEventListener("click",t=>{let e=t.target.closest("button");if(e){if(A(),e.dataset.action==="drop"){for(let o of L)o.held=!1,o.v=0,o.vy=0;q.classList.add("hidden"),N();return}s=e.dataset.tool,q.classList.toggle("hidden",s!=="Hold"&&!L.some(o=>o.held)),f.querySelectorAll("[data-tool]").forEach(o=>o.classList.toggle("active",o===e)),P.classList.toggle("hidden",s!=="Colors"),R.classList.add("hidden"),s==="Regrow"&&Bt(),Y()}}),f.querySelector(".reset").onclick=()=>{A(),ut(),P.classList.add("hidden"),N()},f.querySelector(".brush").onclick=t=>{T=(T+1)%3,t.currentTarget.textContent="Pennello: "+["S","M","L"][T]},f.querySelector(".pause").onclick=t=>{w=!w,w&&(A(),V()),t.currentTarget.textContent=w?"Riprendi":"Pausa"},document.addEventListener("visibilitychange",()=>{document.hidden&&(A(),V())}),window.addEventListener("pagehide",A),window.addEventListener("pagehide",()=>{V(),p==null||p.close().catch(()=>{})}),window.addEventListener("message",t=>{var e;t.source===parent&&((e=t.data)==null?void 0:e.type)==="playable-active"&&(z=!!t.data.active,z||(A(),V()),N())}),ut(),N(),requestAnimationFrame(yt)})();(()=>{let f=document.createElement("style");f.dataset.batch3Ui="20261116",f.textContent=`
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

.top{top:30px;left:30px;right:30px;gap:8px}
.top button{min-height:44px;padding:9px 13px;font:700 14px/1.3 UIBody,system-ui,sans-serif}
.guide{top:24%;left:30px;right:30px;width:auto;font:700 18px/1.4 UIBody,system-ui,sans-serif}
.tools button{font:700 14px/1.3 UIBody,system-ui,sans-serif;min-height:44px;padding:9px 11px}
.tool-row{gap:6px}
.palette{top:90px;left:30px;width:min(245px,calc(100% - 60px));font-family:UIBody,system-ui,sans-serif}
.palette-head{font-size:16px}.palette .done{font-size:14px;min-height:40px}
.brightness-label{font-size:13px}.drop{min-height:44px!important}
@media(max-width:350px){.tools{left:25px;right:25px}.tools button{padding:9px 8px}.top button{padding:9px 10px}}
`,document.head.append(f)})();})();
