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

(()=>{var Z={tweaks:[{id:"FALL_ANGLE",kind:"number",label:"Fall Angle (rad)",value:1.25,default:1.25,min:.5,max:2,step:.05},{id:"BASE_WOBBLE",kind:"number",label:"Base Wobble Force",value:.005,default:.005,min:.001,max:.02,step:.001},{id:"WOBBLE_INC",kind:"number",label:"Wobble Variance",value:5e-4,default:5e-4,min:1e-4,max:.005,step:1e-4}],texts:[{id:"TITLE",label:"Game Title",value:"Keep Him Steady",default:"Keep Him Steady",max_length:30},{id:"BTN_START",label:"Start Button",value:"Start Feeding",default:"Start",max_length:20},{id:"BTN_RESTART",label:"Restart Button",value:"Reset",default:"Reset",max_length:20}],images:[{id:"CHAR_MAIN",label:"Stickman Character",path:"./assets/char_main.webp",replaceable:!0}],config_version:"2.0",playable:{post_id:"99278827033041520",version_id:"99278827033158626",runtime_target:"h5",h5_playstyle_type:"image_expression",content_locale:"en",min_capability_level:1,full_capability_level:1}},D=`
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}


.temperature-game{padding:30px 30px 50px!important}.temperature-game header h1{display:none}

/* User override 2026-10-21: favor visual center, not a fixed upper band. */
html:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) .reaction.feed-first-action{position:fixed!important;top:24%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}
`,B=document.createElement("style");B.textContent=D;document.head.append(B);for(let t of["playable-inline-config","playable-config-inline"]){let n=document.createElement("script");n.id=t,n.type="application/json",n.textContent=JSON.stringify(Z),document.body.append(n)}document.documentElement.lang="en";(function(){"use strict";var t=document.getElementById("root"),n=50,d=0,c=null,y="chili",h=0,p=null,s=[],b=0,a=null,u=0,f=0,w=0,m=!0,r=!1;function i(){var e=f===0?Math.random()<.5?-1:1:Math.sign(f)*(Math.random()<.7?-1:1);f=e*(7.5+Math.random()*7.5),w=1.2+Math.random()*1.2}function g(){b&&window.cancelAnimationFrame(b),b=0,a=null}function v(){!r||b||c||document.hidden||!m||(a=null,b=window.requestAnimationFrame(k))}function k(e){if(b=0,c||document.hidden||!m){a=null;return}if(a!==null){var l=Math.min(.05,Math.max(0,(e-a)/1e3));if(w-=l,w<=0&&i(),u+=(f-u)*(1-Math.exp(-l*2.6)),n=Math.max(0,Math.min(100,n+u*l)),E(),n===100||n===0){A(n===100?"chili":"ice"),q(n===100?"hot":"cold");return}}a=e,S()}function S(){b=window.requestAnimationFrame(k)}function C(e,l){var o=Math.round(l*.78);return e==="ice"?'<svg viewBox="0 0 90 116" width="'+o+'" height="'+l+'" aria-hidden="true"><path d="M24 65 45 111 67 65Z" fill="#d99c61" stroke="#8f5b3c" stroke-width="2"/><path d="M27 73 61 73M32 83 58 83M37 94 53 94" stroke="#ad7449" stroke-width="2"/><path d="M19 63c0-10 8-14 10-21-2-10 7-17 14-15-2-8 6-13 12-9 6 3 6 10 3 14 10 2 14 12 7 19 9 8 2 17-7 17H28c-6 0-9-2-9-5Z" fill="#e9f9ff" stroke="#a9ccd8" stroke-width="2"/><path d="M29 48c15-4 20 8 34 3M28 60c12-5 24 2 35-3" fill="none" stroke="#b0d8e4" stroke-width="3"/></svg>':'<svg viewBox="0 0 90 116" width="'+o+'" height="'+l+'" aria-hidden="true"><path d="M46 24c0-12 9-19 19-17" fill="none" stroke="#456333" stroke-width="5" stroke-linecap="round"/><path d="M45 26c17-10 31 0 27 25-4 27-22 48-51 59 16-15 18-31 17-48-1-14-4-26 7-36Z" fill="#e45563" stroke="#9a3347" stroke-width="3"/><path d="M53 31c14 2 15 15 11 27" fill="none" stroke="#ff9ba4" stroke-width="4" stroke-linecap="round"/></svg>'}function R(){return'<svg viewBox="0 0 180 270" class="stickman" aria-label="Smiling stickman"><g fill="none" stroke="#222" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round"><path d="M90 7c39-1 40 58 1 58-38 1-40-57-1-58Z" fill="#fbfaf4"/><path class="neck" d="M90 65 90 78"/><path class="torso" d="M90 78C82 78 77 86 75 96L70 152Q70 172 82 172L98 172Q110 172 110 152L105 96C103 86 98 78 90 78Z" fill="#fbfaf4"/><path class="arms" d="M75 96Q60 117 48 151M105 96Q120 117 132 151"/><ellipse cx="48" cy="160" rx="5" ry="9"/><ellipse cx="132" cy="160" rx="5" ry="9"/><path class="legs" d="M82 172C81 202 79 230 74 249M98 172C99 202 103 230 108 249"/><path class="feet" d="M74 249Q60 249 48 257Q64 262 74 253ZM108 249Q124 249 134 257Q118 262 108 253Z" fill="#fbfaf4"/><path class="mouth" d="M80 48q10 12 20 0"/></g><circle cx="80" cy="31" r="3.4"/><circle cx="100" cy="31" r="3.4"/><g class="cheeks" fill="#e7897c" opacity="0"><ellipse cx="72" cy="43" rx="7" ry="4"/><ellipse cx="108" cy="43" rx="7" ry="4"/></g></svg>'}function I(){var e=[[46,58],[235,84],[53,145],[251,161],[37,230],[245,267],[75,314],[224,346],[110,42],[192,51],[31,302],[262,322],[104,370],[187,375]],l=[[40,235,-12],[225,223,13],[69,139,-8],[208,128,11],[62,317,-10],[216,312,10]];return'<svg class="weather" viewBox="0 0 300 400" aria-hidden="true"><g class="cold-weather" fill="none" stroke="#367fa6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'+e.map(function(o,x){return'<g transform="translate('+o[0]+" "+o[1]+')"><g class="snowflake" style="--delay:'+-x*.37+'s"><path d="M-1-13 1 13M-12-7 12 7M-11 8 11-8M-5-10 0-6 5-10M-5 10 0 6 5 10M-11-1-6-3-7-9M11 1 6 3 7 9M-10 3-5 4-5 10M10-3 5-4 5-10"/></g></g>'}).join("")+'</g><g class="hot-weather" stroke-linecap="round" stroke-linejoin="round">'+l.map(function(o,x){return'<g transform="translate('+o[0]+" "+o[1]+") rotate("+o[2]+')"><g class="flame" style="--delay:'+-x*.31+'s"><path d="M2 35C-20 26-19 9-7-7-4 1 2 0 1-8 0-21 11-32 15-37 12-13 35-2 26 20 22 32 13 38 2 35Z" fill="#f6a153" stroke="#9c4935" stroke-width="2.4"/><path d="M7 29C-5 20 1 8 7 2 8 13 17 11 17 21 16 27 13 31 7 29Z" fill="#ffe5a1" stroke="#cf7643" stroke-width="1.7"/><path d="M-17 32-23 27M28-13 33-20" fill="none" stroke="#bb6740" stroke-width="2"/></g></g>'}).join("")+'<path class="fire-breath" d="M178 82c12-8 20-3 29-12l-4 12 23-2-14 10 21 10-27-2 5 10c-15-7-26-5-34-14" fill="#ffd17c" stroke="#ad5934" stroke-width="2.4"/><g class="embers" fill="#e58b45" stroke="#ac5035" stroke-width="1.5">'+[[57,260],[229,244],[86,157],[210,151],[99,310],[204,308]].map(function(o,x){return'<g transform="translate('+o[0]+" "+o[1]+')"><path class="ember" style="--delay:'+-x*.28+'s" d="M0-5 4 0 0 6-3 0Z"/></g>'}).join("")+'</g></g><g class="cold-weather frost-streaks" fill="none" stroke="#508bad" stroke-width="2.2" stroke-linecap="round"><path d="M86 73 78 63M95 66 93 51M207 68 213 54M218 79 234 74M49 195 35 183M246 202 262 190M106 292 91 305M199 295 211 306"/></g></svg>'}function N(){return'<svg class="tap-impact" viewBox="0 0 300 400" aria-hidden="true"><g class="impact-lines" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M73 72 91 85M62 98 82 102M221 71 204 84M237 98 216 103M71 137 88 126M228 136 211 126M123 54 128 72M177 53 172 71"/></g><g class="impact-dots" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M64 161 73 166M230 163 238 157M88 45 92 53M211 43 207 51M108 157 113 149M191 160 186 151"/></g></svg>'}function F(){t.innerHTML=['<main class="temperature-game">',"<header>",'<div class="temperature-track" role="meter" aria-label="Stickman temperature" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">','<span class="cold-label">COLD</span><span class="hot-label">HOT</span><div class="temperature-marker"></div>',"</div>","</header>",'<div class="speech-region">','<div class="reaction feed-first-action" role="status" aria-live="polite">Tap treats to balance him</div>','<section class="recovery-bubble" hidden aria-label="Help the stickman">','<p class="bubble-message" aria-live="polite"></p>','<div class="bubble-options"><button type="button" class="help-button"></button></div>',"</section></div>",'<div class="character-stage"><div class="scene-motion"><div class="stage-wash" aria-hidden="true"></div><div class="person">'+I()+R()+N()+"</div></div></div>",'<div class="food-controls">','<button class="food-button ice-button" type="button" data-food="ice" aria-label="Tap to feed ice cream">'+C("ice",82)+"<span>ICE CREAM</span></button>",'<div class="reset-slot"><button class="reset-button" type="button" hidden>Reset</button></div>','<button class="food-button chili-button" type="button" data-food="chili" aria-label="Tap to feed chili">'+C("chili",82)+"<span>CHILI</span></button>","</div>","</main>"].join(""),t.querySelectorAll(".food-button").forEach(function(e){e.addEventListener("click",function(){O(e.dataset.food)})}),t.querySelector(".reset-button").addEventListener("click",T),t.querySelector(".help-button").addEventListener("click",T),t.querySelector(".scene-motion").addEventListener("animationend",function(e){e.target===e.currentTarget&&(e.currentTarget.classList.remove("tap-chili","tap-ice"),e.currentTarget.style.animation="")}),E()}function A(e){var l=t.querySelector(".scene-motion");l.classList.remove("tap-chili","tap-ice"),l.style.animation="none",l.style.setProperty("--shake",(n===100||n===0?10:5+Math.abs(n-50)*.06)+"px"),l.offsetWidth,l.classList.add("tap-"+e),l.style.animation=""}function L(e){try{var l=window.AudioContext||window.webkitAudioContext;if(!l)return;for(p||(p=new l),p.state==="suspended"&&p.resume().catch(function(){});s.length>=4;)s.shift().stop();var o=p.createOscillator(),x=p.createGain(),M=p.currentTime,_=e==="hot"?210:e==="cold"?540:e==="reset"?440:e==="chili"?330:620;o.type="sine",o.frequency.setValueAtTime(_,M),o.frequency.exponentialRampToValueAtTime(e==="hot"?110:e==="cold"?260:_*1.3,M+.2),x.gain.setValueAtTime(.001,M),x.gain.linearRampToValueAtTime(.2,M+.012),x.gain.exponentialRampToValueAtTime(.001,M+.25),o.connect(x),x.connect(p.destination),s.push(o),o.onended=function(){o.disconnect(),x.disconnect(),s=s.filter(function(j){return j!==o})},o.start(M),o.stop(M+.27)}catch{}}function O(e){c||e!=="chili"&&e!=="ice"||(r||(r=!0,t.querySelector(".reaction").classList.remove("feed-first-action"),v()),y=e,n=Math.max(0,Math.min(100,n+(e==="chili"?17:-17))),d+=1,E(),A(e),n===100||n===0?q(n===100?"hot":"cold"):(z(e==="chili"?"Spicy!":"Brrr... so cold!",e),L(e)),t.querySelector(".reset-button").hidden=!1)}function q(e){c=e,g(),clearTimeout(h),h=0;var l=t.querySelector(".temperature-game"),o=t.querySelector(".recovery-bubble");l.classList.add("is-"+e),t.querySelector(".reaction").hidden=!0,t.querySelector(".bubble-message").textContent=e==="hot"?"Too spicy! Can I have some milk?":"I'm freezing! Can you warm me up?",t.querySelector(".help-button").textContent=e==="hot"?"Milk, please!":"Warm me up!",o.hidden=!1,t.querySelectorAll(".food-button").forEach(function(x){x.disabled=!0}),L(e);try{navigator.vibrate&&navigator.vibrate([30,40,30])}catch{}t.querySelector(".help-button").focus({preventScroll:!0})}function E(){var e=t.querySelector(".temperature-track");e.setAttribute("aria-valuenow",String(Math.round(n*10)/10)),t.querySelector(".temperature-marker").style.left="calc("+n+"% - "+n*.08+"px)",t.querySelector(".stickman").style.filter=n<34?"drop-shadow(0 0 10px #83cdf0)":n>66?"drop-shadow(0 0 10px #e76e75)":"none",t.querySelector(".mouth").setAttribute("d",n===100?"M79 48q11-10 22 0":n===0?"M80 49l5-3 5 3 5-3 5 3":"M80 48q10 12 20 0")}function z(e,l){var o=t.querySelector(".reaction");o.textContent=e,o.className="reaction reaction-pop "+l,o.style.animation="none",o.offsetWidth,o.style.animation="",clearTimeout(h),h=window.setTimeout(function(){o.textContent="",o.className="reaction"},1100)}function T(){g(),clearTimeout(h),h=0,n=50,d=0,c=null,f=0,i(),u=0,t.querySelector(".temperature-game").classList.remove("is-hot","is-cold"),t.querySelector(".scene-motion").classList.remove("tap-chili","tap-ice"),t.querySelector(".scene-motion").style.animation="none",t.querySelector(".recovery-bubble").hidden=!0,t.querySelectorAll(".food-button").forEach(function(e){e.disabled=!1}),E(),t.querySelector(".reaction").hidden=!1,t.querySelector(".reaction").textContent="Tap treats to balance him",t.querySelector(".reaction").className="reaction",t.querySelector(".reset-button").hidden=!0,L("reset"),t.querySelector('[data-food="'+y+'"]').focus({preventScroll:!0}),v()}function G(){var e=document.createElement("style");e.textContent=["*{box-sizing:border-box}","html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}","body{background:#f9f6ec;color:#1d2731;font-family:'Chalkboard SE','Comic Sans MS',system-ui,sans-serif;overscroll-behavior:none}","button{font:inherit}button:focus-visible{outline:3px solid #1d2731;outline-offset:3px}[hidden]{display:none!important}",".temperature-game{position:relative;width:100%;max-width:520px;height:100%;margin:0 auto;padding:calc(40px + env(safe-area-inset-top)) calc(25px + env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom)) calc(25px + env(safe-area-inset-left));display:flex;flex-direction:column;gap:10px;overflow:hidden;background:#f9f6ec;touch-action:manipulation;user-select:none}","header{flex:none}.temperature-track{position:relative;height:18px;margin-bottom:24px;border:2px solid #1d2731;border-radius:10px;background:linear-gradient(90deg,#9bd4fa,#f3eee8,#e8899c);box-shadow:0 3px 8px #0002}",".temperature-marker{position:absolute;top:0;bottom:0;width:8px;border-radius:3px;background:#202020}",".cold-label,.hot-label{position:absolute;top:21px;font-size:12px;font-weight:700;line-height:1.2;letter-spacing:1px}.cold-label{left:2px;color:#22688b}.hot-label{right:2px;color:#a42e43}",".temperature-game h1{margin:0;text-align:center;font-size:clamp(23px,6vw,29px);line-height:1.15}",".speech-region{flex:none;min-height:112px;display:grid;place-items:center;padding-bottom:9px}.reaction{min-height:27px;text-align:center;font-size:18px;font-weight:700;line-height:1.35}",".reaction.ice{color:#22688b}.reaction.chili{color:#a42e43}.reaction-pop{animation:reaction-pop .25s ease}",".recovery-bubble{position:relative;width:100%;padding:10px 12px;background:#fffdf6;border:2px solid #34342e;border-radius:22px 18px 23px 16px;box-shadow:3px 3px 0 #34342e16}.recovery-bubble:after{content:'';position:absolute;width:14px;height:14px;bottom:-9px;left:50%;background:#fffdf6;border-right:2px solid #34342e;border-bottom:2px solid #34342e;transform:rotate(45deg)}",".bubble-message{margin:0 0 8px;text-align:center;font-size:16px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}.bubble-options{display:flex;gap:10px}.bubble-options button{flex:1;min-width:0;min-height:48px;padding:7px 8px;border:2px solid #34342e;border-radius:12px 15px 11px 14px;background:#fff4de;color:#34342e;font-weight:700;font-size:15px;line-height:1.2;cursor:pointer}.bubble-options button:active{background:#e9dfc8}.is-hot .help-button{background:#fce2c6}.is-cold .help-button{background:#d8edf6}","@keyframes reaction-pop{0%{transform:scale(.75);opacity:.2}100%{transform:scale(1);opacity:1}}",".character-stage{flex:1;min-height:0;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}.scene-motion{position:relative;width:100%;height:100%;padding:12px;display:flex;align-items:center;justify-content:center;--shake:6px}.scene-motion.tap-chili,.scene-motion.tap-ice{animation:stage-shake .55s ease-out}.person{position:relative;width:min(100%,260px);height:min(100%,340px);display:flex;justify-content:center;align-items:center}.stickman{position:relative;width:auto;max-width:100%;height:100%;overflow:visible;transition:filter .25s ease}.weather,.tap-impact{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.hot-weather,.cold-weather{opacity:0}.is-hot .hot-weather,.is-cold .cold-weather{opacity:1}.is-hot .stickman{color:#a84433;animation:hot-wobble .65s ease-in-out infinite alternate}.is-hot .stickman>g:first-child{stroke:currentColor}.is-hot .cheeks{opacity:.65}.is-cold .stickman>g:first-child{stroke:#386f92}.is-cold .stickman{animation:shiver .19s ease-in-out infinite alternate}.snowflake{animation:snow-drift 2.3s ease-in-out infinite alternate;animation-delay:var(--delay)}.flame{animation:flame-dance .8s ease-in-out infinite alternate;animation-delay:var(--delay);transform-origin:center bottom}.ember{animation:ember-rise 1.65s ease-out infinite;animation-delay:var(--delay)}.fire-breath{transform-origin:177px 90px;animation:fire-puff 1.1s ease-in-out infinite alternate}",".stage-wash{position:absolute;inset:12px;border-radius:44% 48% 40% 45%;pointer-events:none;opacity:0;transition:opacity .35s ease;background:radial-gradient(ellipse,#efb37d55,transparent 72%)}.is-hot .stage-wash{opacity:1}.is-cold .stage-wash{opacity:1;background:radial-gradient(ellipse,#91c9e25c,transparent 72%)}.tap-impact{opacity:0;color:#b55b35}.tap-ice .tap-impact{color:#387d9f}.tap-chili .tap-impact,.tap-ice .tap-impact{animation:impact-burst .55s ease-out}.impact-dots{transform-origin:150px 105px;animation:impact-scatter .55s ease-out}","@keyframes stage-shake{0%,100%{transform:translate(0,0) rotate(0)}12%{transform:translate(calc(var(--shake)*-1),-3px) rotate(-.6deg)}26%{transform:translate(var(--shake),2px) rotate(.6deg)}40%{transform:translate(calc(var(--shake)*-.75),-2px) rotate(-.4deg)}55%{transform:translate(calc(var(--shake)*.65),1px) rotate(.3deg)}70%{transform:translate(calc(var(--shake)*-.4),0)}85%{transform:translate(calc(var(--shake)*.2),0)}}","@keyframes impact-burst{0%{opacity:0;transform:scale(.86)}15%{opacity:.9}100%{opacity:0;transform:scale(1.18)}}@keyframes impact-scatter{from{transform:scale(.8)}to{transform:scale(1.25)}}@keyframes snow-drift{from{transform:translateY(-9px) rotate(-14deg)}to{transform:translateY(15px) rotate(18deg)}}@keyframes flame-dance{from{transform:scale(.95,1.17) rotate(-5deg)}to{transform:scale(1.18,.94) rotate(5deg)}}@keyframes shiver{from{transform:translateX(-3px) rotate(-.7deg)}to{transform:translateX(3px) rotate(.7deg)}}@keyframes hot-wobble{from{transform:rotate(-2deg) translateY(0)}to{transform:rotate(2deg) translateY(-2px)}}@keyframes ember-rise{0%{opacity:0;transform:translateY(4px)}20%{opacity:.8}100%{opacity:0;transform:translate(8px,-44px)}}@keyframes fire-puff{from{transform:scale(.9,1)}to{transform:scale(1.2,1.08)}}",".food-controls{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px}.food-button{flex:1;max-width:114px;min-width:0;min-height:106px;padding:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:0;border-radius:18px;background:transparent;color:#34424b;font-weight:700;font-size:12px;line-height:1.25;cursor:pointer;touch-action:manipulation;transition:background .12s ease}.food-button svg{max-width:100%;flex:none;pointer-events:none}.food-button:active{background:#fff8}.food-button:disabled{opacity:.4;cursor:default}",".reset-slot{flex:0 0 66px}.reset-button{width:100%;min-height:48px;padding:8px 4px;border:1.5px solid #737977;border-radius:12px 10px 13px 11px;background:#fffdf6;color:#34342e;font-weight:700;font-size:14px;box-shadow:0 3px 0 #0001;cursor:pointer;touch-action:manipulation}.reset-button:active{background:#ece5d7}","@media(max-height:620px){.temperature-game{gap:6px}.temperature-game h1{font-size:23px}.temperature-track{margin-bottom:21px}.speech-region{min-height:102px}.recovery-bubble{padding:8px 10px}.bubble-message{font-size:15px}.food-button{min-height:88px}.food-button svg{height:68px;width:auto}}","@media(prefers-reduced-motion:reduce){.reaction-pop,.scene-motion.tap-chili,.scene-motion.tap-ice,.is-cold .stickman,.is-hot .stickman,.snowflake,.flame,.ember,.fire-breath,.tap-impact,.impact-dots{animation:none}.stickman,.stage-wash{transition:none}.tap-chili .tap-impact,.tap-ice .tap-impact{opacity:.6}}"].join(""),document.head.appendChild(e)}G(),F(),i(),v(),document.addEventListener("visibilitychange",function(){document.hidden?g():v()}),window.addEventListener("pageshow",function(){m=!0,v()}),window.addEventListener("pagehide",function(){m=!1,g(),clearTimeout(h),s.forEach(function(e){try{e.stop()}catch{}}),p&&p.close().catch(function(){}),p=null,s=[]})})();(function(){"use strict";var b,a;let t={getAttribute(u){return{"data-subject":".person","data-game":"",defer:null,src:"./feed-entry-motion.js?v=feed-first-20261008-1"}[u]??null},dataset:{subject:".person",game:""}},n=(t==null?void 0:t.getAttribute("data-subject"))||"#root canvas",d=(b=window.matchMedia)==null?void 0:b.call(window,"(prefers-reduced-motion: reduce)"),c,y,h=!1;function p(){y==null||y.cancel(),y=null}function s(){if(h||document.hidden)return;let u=document.querySelector(n);if(!u||u.closest('[hidden], [aria-hidden="true"]'))return;let f=window.getComputedStyle(u);if(f.display==="none"||f.visibility==="hidden")return;if(u.tagName==="IMG"&&!u.complete){u.addEventListener("load",s,{once:!0});return}if(h=!0,c==null||c.disconnect(),d!=null&&d.matches)return;let w=Number(window.getComputedStyle(u).opacity)||1;typeof u.animate=="function"&&(y=u.animate([{opacity:w*.76},{opacity:w}],{duration:650,easing:"ease-out"}),y.onfinish=()=>{y=null})}c=new MutationObserver(s),c.observe(document.body,{childList:!0,subtree:!0}),s(),document.addEventListener("visibilitychange",()=>{document.documentElement.toggleAttribute("data-feed-background",document.hidden),document.hidden?p():s()}),window.addEventListener("pagehide",()=>{c.disconnect(),p()}),window.addEventListener("pageshow",()=>{h||c.observe(document.body,{childList:!0,subtree:!0}),s()}),document.addEventListener("pointerdown",p,{capture:!0,passive:!0}),(a=d==null?void 0:d.addEventListener)==null||a.call(d,"change",()=>{d.matches&&p()})})();(()=>{var w;let t=[".reaction.feed-first-action"],n=new Set([].map(m=>m.replace(/\s+/g," ").trim().toLowerCase())),d=window.matchMedia("(prefers-reduced-motion: reduce)"),c=new Map,y=!1,h=!0,p=/^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;function s(){y=!1;for(let[r,i]of c)r.isConnected||(i.cancel(),c.delete(r));if(d.matches){for(let r of c.values())r.cancel();c.clear();return}let m=new Set;for(let r of t)try{document.querySelectorAll(r).forEach(i=>m.add(i))}catch{}for(let r of document.querySelectorAll("p,span,div,label,text")){if(r.children.length||r.closest('button,a,input,select,textarea,[role="button"]'))continue;let i=(r.textContent||"").replace(/\s+/g," ").trim();i.length>=5&&i.length<=140&&(n.has(i.toLowerCase())||!t.length&&p.test(i))&&m.add(r)}for(let r of m){if(c.has(r)||typeof r.animate!="function"||[...m].some(S=>S!==r&&r.contains(S)))continue;let i=getComputedStyle(r);if(/breath/i.test(i.animationName))continue;let g=i.filter.replace(/opacity\([^)]*\)/g,"").replace(/^none$/,"").trim(),v=S=>(g?g+" ":"")+"opacity("+S+")",k=r.animate([{filter:v(1)},{filter:v(.65)},{filter:v(1)}],{duration:2400,iterations:1/0,easing:"ease-in-out"});c.set(r,k),(document.hidden||!h)&&k.pause()}}let b=()=>{y||(y=!0,requestAnimationFrame(s))},a=()=>{for(let m of c.values())document.hidden||!h?m.pause():m.play()},u=new MutationObserver(b);u.observe(document.documentElement,{childList:!0,subtree:!0,characterData:!0});let f=typeof IntersectionObserver=="function"?new IntersectionObserver(m=>{h=m.some(r=>r.isIntersecting),a()}):null;document.body?f==null||f.observe(document.body):document.addEventListener("DOMContentLoaded",()=>f==null?void 0:f.observe(document.body),{once:!0}),document.addEventListener("visibilitychange",a),(w=d.addEventListener)==null||w.call(d,"change",b),b(),window.addEventListener("pagehide",()=>{u.disconnect(),f==null||f.disconnect();for(let m of c.values())m.cancel();c.clear()},{once:!0})})();(()=>{"use strict";let t=Number({getAttribute(i){return{"data-subject":"#root canvas","data-game":"","data-batch3-game":"46"}[i]??null},dataset:{subject:"#root canvas",game:"",batch3Game:"46"}}.dataset.batch3Game),n=new URLSearchParams(location.search).get("feedReview")==="1"&&window.parent!==window,d=document.documentElement;d.toggleAttribute("data-batch3-preview",n);let c={12:{text:"Tap to pop the bubbles",top:"80px",color:"#a2355a",action:"bubble"},20:{text:"Tap the bug",top:"32%",color:"#fff",action:"bug"},27:{text:"Guess their age",top:"10.5%",color:"#fff",action:"age"},37:{text:"Tap to add balls",top:"24%",color:"#fff",action:"add-ball"},39:{text:"Tap squares to find the animal",top:"22%",color:"#29202e",action:"cell"},49:{text:"Guess the hidden code",top:"40%",color:"#fff",action:"digit"},60:{text:"Steer into the parking spot",top:"34%",color:"#fff",action:"drive"}},h=`
    .b3-guide{position:fixed;left:30px;right:30px;z-index:120;margin:0;text-align:center;
      font:700 18px/1.3 var(--font-display,system-ui,sans-serif);pointer-events:none;
      text-shadow:0 1px 3px rgba(0,0,0,.25);animation:b3-breathe 2.4s ease-in-out infinite}
    @keyframes b3-breathe{0%,100%{opacity:1}50%{opacity:.68}}
    html[data-b3-hidden] .b3-guide,html[data-b3-hidden] #opening .opening-heading p{animation-play-state:paused!important}
    @media(prefers-reduced-motion:reduce){.b3-guide,html[data-batch3-preview] #opening .opening-heading p{animation:none!important}}
    ${{8:"html[data-batch3-preview] #root button {visibility:hidden!important}",11:"html[data-batch3-preview] .screen-container div:has(>button.btn-option){transform:translateY(-8vh) scale(.84);transform-origin:center center}",13:"html[data-batch3-preview] #root button {visibility:hidden!important}",25:"html[data-batch3-preview] #root button {visibility:hidden!important}",27:"html[data-batch3-preview] .age-controls {transform:translateY(-16vh) scale(.9);transform-origin:bottom center}",30:"html[data-batch3-preview] .btn-control {visibility:hidden!important}",34:"html[data-batch3-preview] #root button {visibility:hidden!important}",37:"html[data-batch3-preview] #root button {bottom:34%!important}",38:"html[data-batch3-preview] .pendulum-actions {visibility:hidden!important}",39:'html[data-batch3-preview] [aria-label="8 by 8 animal search map"] {transform:scale(.84);transform-origin:center top}',43:"html[data-batch3-preview] .meme-controls {visibility:hidden!important}",48:"html[data-batch3-preview] #root button {visibility:hidden!important}",49:"html[data-batch3-preview] #root button {visibility:hidden!important}",52:"html[data-batch3-preview] .fate-wheel-wrap {transform:scale(.84)}",54:"html[data-batch3-preview] .control {visibility:hidden!important}",56:"html[data-batch3-preview] .drive-controls {visibility:hidden!important}",60:'html[data-batch3-preview] #root div:has(>div>button[aria-label="Steer left"]) {visibility:hidden!important}',73:"html[data-batch3-preview] #opening .opening-heading p {animation:b3-breathe 2.4s ease-in-out infinite}",74:"html[data-batch3-preview] #photo-controls {visibility:hidden!important}"}[t]||""}
  `,p=document.createElement("style");p.setAttribute("data-batch3-polish",""),p.textContent=h,document.head.append(p);let s,b=!1,a=c[t];function u(){!a||s||b||(s=document.createElement("p"),s.className="b3-guide",s.textContent=a.text,s.style.top=a.top,s.style.color=a.color,document.body.append(s))}function f(i){let g=i.target;if(!(g instanceof Element))return!1;if((a==null?void 0:a.action)==="bug")return!!g.closest('#root div[tabindex="0"]');if((a==null?void 0:a.action)==="bubble"){if(g.closest('#root div[tabindex="0"],#root canvas'))return!0;let k=g.closest("button");return!!k&&/^(Sand Art|Spinner)$/.test(k.textContent.trim())}if((a==null?void 0:a.action)==="age")return!!g.closest('input[type="range"],button.guess');let v=g.closest("button");return!v||v.disabled?!1:(a==null?void 0:a.action)==="add-ball"?v.textContent.trim()==="Add Ball":(a==null?void 0:a.action)==="cell"?/^Check cell \d+$/.test(v.getAttribute("aria-label")||""):(a==null?void 0:a.action)==="digit"?/^\d$/.test(v.textContent.trim()):(a==null?void 0:a.action)==="drive"?/^(Steer left|Steer right|Drive forward|Reverse)$/.test(v.getAttribute("aria-label")||""):!1}function w(i){d.hasAttribute("data-batch3-preview")||f(i)&&(b=!0,s==null||s.remove(),s=null)}document.addEventListener("pointerdown",w,!0),document.addEventListener("keydown",i=>{(i.key==="Enter"||i.key===" ")&&w(i)},!0),window.addEventListener("message",i=>{var g;!n||i.source!==parent||i.origin!==location.origin||((g=i.data)==null?void 0:g.type)!=="playable-active"||d.toggleAttribute("data-batch3-preview",i.data.active!==!0)}),document.addEventListener("visibilitychange",()=>{d.toggleAttribute("data-b3-hidden",document.hidden)});let m=new MutationObserver(u),r=()=>{u(),m.observe(document.getElementById("root")||document.body,{childList:!0,subtree:!0})};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",r,{once:!0}):r(),window.addEventListener("pagehide",()=>{m.disconnect()},{once:!0})})();})();
