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

(()=>{var Y={tweaks:[{id:"TARGET_MIN",kind:"number",label:"Minimum Target Time",value:1.5,default:1.5,min:.5,max:4,step:.1},{id:"TARGET_MAX",kind:"number",label:"Maximum Target Time",value:4.5,default:4.5,min:2,max:8,step:.1},{id:"ROUNDS",kind:"number",label:"Rounds",value:5,default:5,min:1,max:10,step:1},{id:"PERFECT_WINDOW",kind:"number",label:"Perfect Window",value:.05,default:.05,min:.02,max:.2,step:.01}],texts:[{id:"TITLE",label:"Game Title",value:"Hit the Time",default:"Hit the Time",max_length:24},{id:"TARGET_LABEL",label:"Target Label",value:"TARGET",default:"TARGET",max_length:16},{id:"PLAY_TEXT",label:"Play Button",value:"PLAY",default:"PLAY",max_length:14},{id:"STOP_TEXT",label:"Stop Button",value:"STOP",default:"STOP",max_length:14},{id:"NEXT_TEXT",label:"Next Button",value:"NEXT",default:"NEXT",max_length:14},{id:"AGAIN_TEXT",label:"Replay Button",value:"PLAY AGAIN",default:"PLAY AGAIN",max_length:20}],images:[],config_version:"2.0",playable:{post_id:"99279729722908290",version_id:"99279729722770773",runtime_target:"h5",h5_playstyle_type:"general_game",content_locale:"en",min_capability_level:1,full_capability_level:1}},q=`
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #08080d; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}
`,B=document.createElement("style");B.textContent=q;document.head.append(B);for(let m of["playable-inline-config","playable-config-inline"]){let g=document.createElement("script");g.id=m,g.type="application/json",g.textContent=JSON.stringify(Y),document.body.append(g)}document.documentElement.lang="en";(()=>{"use strict";let m=n=>{let s={};for(let f of["tweaks","texts","images"])for(let t of n[f]||[])s[t.id]=t.value??t.path;return s},g=async()=>{try{let s=await fetch("./game.config.json",{cache:"no-store"});if(s.ok)return m(await s.json())}catch{}let n=document.getElementById("playable-config-inline");return n?m(JSON.parse(n.textContent)):{}};(async()=>{let n=await g(),s=document.getElementById("root"),f=document.createElement("style");f.textContent=`
      @font-face{font-family:Audiowide;src:url('./assets/fonts/audiowide/Audiowide-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}
      :root {
        --ui-unit:min(0.2564102564vw,0.1672240803vh);
        --font-display:Audiowide,"PingFang SC",system-ui,sans-serif;
        --font-body:-apple-system,"Helvetica Neue","PingFang SC",system-ui,sans-serif;
        --font-mono:ui-monospace,Menlo,monospace;
        --color-bg:#070b19;--color-accent:#00e5ff;--color-text-main:#fff;
        --color-text-dim:rgba(255,255,255,.6);--color-panel:rgba(7,11,25,.85);
        color-scheme:dark;font-family:var(--font-display);
      }
      *{box-sizing:border-box}
      html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}
      body{background:var(--color-bg);touch-action:manipulation;user-select:none;-webkit-user-select:none}
      button{font:inherit;-webkit-tap-highlight-color:transparent}
      .game {
        position:relative;width:100%;height:100%;overflow:hidden;container-type:inline-size;
        display:flex;flex-direction:column;align-items:center;gap:calc(12 * var(--ui-unit));
        padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit) + env(safe-area-inset-right)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom) + 7px) calc(30 * var(--ui-unit) + env(safe-area-inset-left));
        background:var(--color-bg);color:var(--color-text-main);
      }
      .hud{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;width:100%;gap:16px;min-height:calc(34 * var(--ui-unit));font-size:calc(28 * var(--ui-unit));font-weight:400;line-height:1.2;font-variant-numeric:tabular-nums}
      .target-card{flex:0 0 auto;width:100%;min-height:calc(100 * var(--ui-unit));display:grid;place-content:center;gap:8px;padding:12px;text-align:center;border:1px solid #00e5ff33;border-radius:8px;background:var(--color-panel)}
      .label{color:var(--color-text-dim);font:400 calc(18 * var(--ui-unit))/1.3 var(--font-body);overflow-wrap:anywhere}
      .target{color:var(--color-accent);font-size:clamp(28px,8cqi,42px);font-weight:400;line-height:1.2;font-variant-numeric:tabular-nums}
      .timer-wrap{flex:1;min-height:calc(132 * var(--ui-unit));width:100%;display:flex;flex-direction:column;justify-content:center;text-align:center}
      .timer{color:var(--color-text-main);font:400 clamp(60px,18cqi,100px)/1 var(--font-mono);letter-spacing:-.035em;font-variant-numeric:tabular-nums}
      .feedback{min-height:calc(50 * var(--ui-unit));margin-top:16px;color:var(--color-accent);font-size:calc(18 * var(--ui-unit));line-height:1.4;font-weight:400;overflow-wrap:anywhere}
      .game[data-phase="ready"] .feedback{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
      .feedback.perfect{color:#00e5ff}.feedback.close{color:#ffd75a}.feedback.miss{color:#ff7e83}
      .control{flex:0 0 auto;width:100%;display:grid;place-items:center;min-height:calc(100 * var(--ui-unit))}
      .action{width:min(100%,calc(220 * var(--ui-unit)));min-width:48px;min-height:56px;padding:12px 24px;border:1px solid var(--color-accent);border-radius:8px;background:#00e5ff1a;color:var(--color-accent);font:400 clamp(14px,4cqi,18px)/1.3 var(--font-display);text-transform:uppercase;letter-spacing:1px;overflow-wrap:anywhere;cursor:pointer;transition:background-color .15s,transform .15s}
      .action.stop{background:var(--color-accent);color:var(--color-bg)}
      .action.next{background:#00e5ff1a;color:var(--color-accent)}
      .action:focus-visible{outline:3px solid #fff;outline-offset:4px}
      .action:active{background:#00e5ff4d;transform:scale(.96)}
      @media(prefers-reduced-motion:reduce){.action{transition:none}.game[data-phase="ready"] .feedback{animation:none}}
    `,document.head.appendChild(f),s.innerHTML=`
      <main class="game">
        <header class="hud">
          <span id="round" aria-label="Round"></span>
          <span id="score" aria-label="Score">0</span>
        </header>
        <section class="target-card" aria-label="Target time">
          <div class="label" id="targetLabel"></div>
          <div class="target" id="target"></div>
        </section>
        <section class="timer-wrap">
          <div class="timer" id="timer">00.00</div>
          <div class="feedback" id="feedback" role="status" aria-live="polite">PLAY, then STOP at the target</div>
        </section>
        <section class="control"><button class="action" id="action" type="button"></button></section>
      </main>
    `;let t={targetLabel:document.getElementById("targetLabel"),target:document.getElementById("target"),round:document.getElementById("round"),timer:document.getElementById("timer"),feedback:document.getElementById("feedback"),action:document.getElementById("action"),score:document.getElementById("score")},c=Math.max(1,Math.round(Number(n.ROUNDS)||5)),v=Math.max(.01,Number(n.PERFECT_WINDOW)||.05),a=Math.max(.25,Number(n.TARGET_MIN)||1.5),d=Math.max(a+.25,Number(n.TARGET_MAX)||4.5),o="ready",p=1,r=0,e=0,i=0,u=1/0,b=0,T=0,A=!1,M=!1,y=null,I=()=>{r=Math.round((a+Math.random()*(d-a))*100)/100},P=h=>Math.min(99.99,h).toFixed(2).padStart(5,"0"),R=()=>{try{if(!y){let h=window.AudioContext||window.webkitAudioContext;h&&(y=new h)}y&&y.state==="suspended"&&y.resume().catch(()=>{})}catch{y=null}},k=(h,x,_="sine",L=.08,S=0)=>{if(A||(R(),!y))return;let w=y.currentTime+S,E=y.createOscillator(),C=y.createGain();E.type=_,E.frequency.setValueAtTime(h,w),C.gain.setValueAtTime(1e-4,w),C.gain.exponentialRampToValueAtTime(L,w+.012),C.gain.exponentialRampToValueAtTime(1e-4,w+x),E.connect(C).connect(y.destination),E.start(w),E.stop(w+x+.02)},N=()=>{s.querySelector(".game").dataset.phase=o,t.targetLabel.textContent=n.TARGET_LABEL||"TARGET",t.target.textContent=r.toFixed(2)+"s",t.round.textContent=p+"/"+c,t.round.setAttribute("aria-label","Round "+p+" of "+c),t.timer.textContent=P(e),t.score.textContent=String(i),t.score.setAttribute("aria-label","Score "+i),t.action.className="action",o==="ready"?t.action.textContent=n.PLAY_TEXT||"PLAY":o==="running"?(t.action.textContent=n.STOP_TEXT||"STOP",t.action.classList.add("stop")):(t.action.textContent=o==="complete"?n.AGAIN_TEXT||"PLAY AGAIN":n.NEXT_TEXT||"NEXT",t.action.classList.add("next"))},G=h=>{if(o==="running"){if(e=(h-b)/1e3,e>=9.99){e=9.99,O(!0);return}t.timer.textContent=P(e),T=requestAnimationFrame(G)}},F=()=>{o="running",e=0,b=performance.now(),M=!0,t.feedback.textContent="",t.feedback.className="feedback",k(360,.08,"sine",.055),N(),T=requestAnimationFrame(G)},O=h=>{if(o!=="running")return;cancelAnimationFrame(T),h||(e=(performance.now()-b)/1e3);let x=Math.abs(e-r);u=Math.min(u,x);let _=x<=v,L="MISS",S="miss",w=Math.max(0,Math.round(70-x*70));_?(L="PERFECT",S="perfect",w=100):x<=.14?(L="GREAT",S="perfect",w=85):x<=.35&&(L="CLOSE",S="close",w=60),i+=w,o=p>=c?"complete":"result";let E=e-r,C=E===0?"":E<0?" early":" late";t.feedback.textContent=L+" \xB7 "+x.toFixed(2)+"s"+C,t.feedback.className="feedback "+S,_?(k(620,.13,"sine",.08),k(820,.16,"sine",.07,.08)):x<=.35?k(470,.12,"triangle",.065):k(160,.2,"sawtooth",.045),navigator.vibrate&&navigator.vibrate(_?[18,28,18]:18),N()},X=()=>{o==="complete"?(p=1,i=0,u=1/0,M=!1):p+=1,o="ready",e=0,I(),t.feedback.textContent=M?"":"PLAY, then STOP at the target",t.feedback.className="feedback",k(300,.07,"sine",.045),N()};t.action.addEventListener("click",()=>{R(),o==="ready"?F():o==="running"?O(!1):X()}),window.addEventListener("keydown",h=>{h.code==="Space"&&(h.preventDefault(),t.action.click())}),I(),N()})()})();(function(){"use strict";var v,a;let m={getAttribute(d){return{"data-subject":"#root button","data-game":"",defer:null,src:"./feed-entry-motion.js?v=feed-first-20261008-1"}[d]??null},dataset:{subject:"#root button",game:""}},g=(m==null?void 0:m.getAttribute("data-subject"))||"#root canvas",l=(v=window.matchMedia)==null?void 0:v.call(window,"(prefers-reduced-motion: reduce)"),n,s,f=!1;function t(){s==null||s.cancel(),s=null}function c(){if(f||document.hidden)return;let d=document.querySelector(g);if(!d||d.closest('[hidden], [aria-hidden="true"]'))return;let o=window.getComputedStyle(d);if(o.display==="none"||o.visibility==="hidden")return;if(d.tagName==="IMG"&&!d.complete){d.addEventListener("load",c,{once:!0});return}if(f=!0,n==null||n.disconnect(),l!=null&&l.matches)return;let p=Number(window.getComputedStyle(d).opacity)||1;typeof d.animate=="function"&&(s=d.animate([{opacity:p*.76},{opacity:p}],{duration:650,easing:"ease-out"}),s.onfinish=()=>{s=null})}n=new MutationObserver(c),n.observe(document.body,{childList:!0,subtree:!0}),c(),document.addEventListener("visibilitychange",()=>{document.documentElement.toggleAttribute("data-feed-background",document.hidden),document.hidden?t():c()}),window.addEventListener("pagehide",()=>{n.disconnect(),t()}),window.addEventListener("pageshow",()=>{f||n.observe(document.body,{childList:!0,subtree:!0}),c()}),document.addEventListener("pointerdown",t,{capture:!0,passive:!0}),(a=l==null?void 0:l.addEventListener)==null||a.call(l,"change",()=>{l.matches&&t()})})();(()=>{var p;let m=["#feedback"],g=new Set([].map(r=>r.replace(/\s+/g," ").trim().toLowerCase())),l=window.matchMedia("(prefers-reduced-motion: reduce)"),n=new Map,s=!1,f=!0,t=/^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;function c(){s=!1;for(let[e,i]of n)e.isConnected||(i.cancel(),n.delete(e));if(l.matches){for(let e of n.values())e.cancel();n.clear();return}let r=new Set;for(let e of m)try{document.querySelectorAll(e).forEach(i=>r.add(i))}catch{}for(let e of document.querySelectorAll("p,span,div,label,text")){if(e.children.length||e.closest('button,a,input,select,textarea,[role="button"]'))continue;let i=(e.textContent||"").replace(/\s+/g," ").trim();i.length>=5&&i.length<=140&&(g.has(i.toLowerCase())||!m.length&&t.test(i))&&r.add(e)}for(let e of r)e.id==="feedback"&&(e.textContent||"").trim()!=="PLAY, then STOP at the target"&&r.delete(e);for(let[e,i]of n)r.has(e)||(i.cancel(),n.delete(e));for(let e of r){if(n.has(e)||typeof e.animate!="function"||[...r].some(A=>A!==e&&e.contains(A)))continue;let i=getComputedStyle(e);if(/breath/i.test(i.animationName))continue;let u=i.filter.replace(/opacity\([^)]*\)/g,"").replace(/^none$/,"").trim(),b=A=>(u?u+" ":"")+"opacity("+A+")",T=e.animate([{filter:b(1)},{filter:b(.65)},{filter:b(1)}],{duration:2400,iterations:1/0,easing:"ease-in-out"});n.set(e,T),(document.hidden||!f)&&T.pause()}}let v=()=>{s||(s=!0,requestAnimationFrame(c))},a=()=>{for(let r of n.values())document.hidden||!f?r.pause():r.play()},d=new MutationObserver(v);d.observe(document.documentElement,{childList:!0,subtree:!0,characterData:!0});let o=typeof IntersectionObserver=="function"?new IntersectionObserver(r=>{f=r.some(e=>e.isIntersecting),a()}):null;document.body?o==null||o.observe(document.body):document.addEventListener("DOMContentLoaded",()=>o==null?void 0:o.observe(document.body),{once:!0}),document.addEventListener("visibilitychange",a),(p=l.addEventListener)==null||p.call(l,"change",v),v(),window.addEventListener("pagehide",()=>{d.disconnect(),o==null||o.disconnect();for(let r of n.values())r.cancel();n.clear()},{once:!0})})();(()=>{"use strict";let m=Number({getAttribute(i){return{"data-subject":"#root canvas","data-game":"","data-batch3-game":"54"}[i]??null},dataset:{subject:"#root canvas",game:"",batch3Game:"54"}}.dataset.batch3Game),g=new URLSearchParams(location.search).get("feedReview")==="1"&&window.parent!==window,l=document.documentElement;l.toggleAttribute("data-batch3-preview",g);let n={12:{text:"Tap to pop the bubbles",top:"80px",color:"#a2355a",action:"bubble"},20:{text:"Tap the bug",top:"32%",color:"#fff",action:"bug"},27:{text:"Guess their age",top:"10.5%",color:"#fff",action:"age"},37:{text:"Tap to add balls",top:"24%",color:"#fff",action:"add-ball"},39:{text:"Tap squares to find the animal",top:"22%",color:"#29202e",action:"cell"},49:{text:"Guess the hidden code",top:"40%",color:"#fff",action:"digit"},60:{text:"Steer into the parking spot",top:"34%",color:"#fff",action:"drive"}},f=`
    .b3-guide{position:fixed;left:30px;right:30px;z-index:120;margin:0;text-align:center;
      font:700 18px/1.3 var(--font-display,system-ui,sans-serif);pointer-events:none;
      text-shadow:0 1px 3px rgba(0,0,0,.25);animation:b3-breathe 2.4s ease-in-out infinite}
    @keyframes b3-breathe{0%,100%{opacity:1}50%{opacity:.68}}
    html[data-b3-hidden] .b3-guide,html[data-b3-hidden] #opening .opening-heading p{animation-play-state:paused!important}
    @media(prefers-reduced-motion:reduce){.b3-guide,html[data-batch3-preview] #opening .opening-heading p{animation:none!important}}
    ${{8:"html[data-batch3-preview] #root button {visibility:hidden!important}",11:"html[data-batch3-preview] .screen-container div:has(>button.btn-option){transform:translateY(-8vh) scale(.84);transform-origin:center center}",13:"html[data-batch3-preview] #root button {visibility:hidden!important}",25:"html[data-batch3-preview] #root button {visibility:hidden!important}",27:"html[data-batch3-preview] .age-controls {transform:translateY(-16vh) scale(.9);transform-origin:bottom center}",30:"html[data-batch3-preview] .btn-control {visibility:hidden!important}",34:"html[data-batch3-preview] #root button {visibility:hidden!important}",37:"html[data-batch3-preview] #root button {bottom:34%!important}",38:"html[data-batch3-preview] .pendulum-actions {visibility:hidden!important}",39:'html[data-batch3-preview] [aria-label="8 by 8 animal search map"] {transform:scale(.84);transform-origin:center top}',43:"html[data-batch3-preview] .meme-controls {visibility:hidden!important}",48:"html[data-batch3-preview] #root button {visibility:hidden!important}",49:"html[data-batch3-preview] #root button {visibility:hidden!important}",52:"html[data-batch3-preview] .fate-wheel-wrap {transform:scale(.84)}",54:"html[data-batch3-preview] .control {visibility:hidden!important}",56:"html[data-batch3-preview] .drive-controls {visibility:hidden!important}",60:'html[data-batch3-preview] #root div:has(>div>button[aria-label="Steer left"]) {visibility:hidden!important}',73:"html[data-batch3-preview] #opening .opening-heading p {animation:b3-breathe 2.4s ease-in-out infinite}",74:"html[data-batch3-preview] #photo-controls {visibility:hidden!important}"}[m]||""}
  `,t=document.createElement("style");t.setAttribute("data-batch3-polish",""),t.textContent=f,document.head.append(t);let c,v=!1,a=n[m];function d(){!a||c||v||(c=document.createElement("p"),c.className="b3-guide",c.textContent=a.text,c.style.top=a.top,c.style.color=a.color,document.body.append(c))}function o(i){let u=i.target;if(!(u instanceof Element))return!1;if((a==null?void 0:a.action)==="bug")return!!u.closest('#root div[tabindex="0"]');if((a==null?void 0:a.action)==="bubble"){if(u.closest('#root div[tabindex="0"],#root canvas'))return!0;let T=u.closest("button");return!!T&&/^(Sand Art|Spinner)$/.test(T.textContent.trim())}if((a==null?void 0:a.action)==="age")return!!u.closest('input[type="range"],button.guess');let b=u.closest("button");return!b||b.disabled?!1:(a==null?void 0:a.action)==="add-ball"?b.textContent.trim()==="Add Ball":(a==null?void 0:a.action)==="cell"?/^Check cell \d+$/.test(b.getAttribute("aria-label")||""):(a==null?void 0:a.action)==="digit"?/^\d$/.test(b.textContent.trim()):(a==null?void 0:a.action)==="drive"?/^(Steer left|Steer right|Drive forward|Reverse)$/.test(b.getAttribute("aria-label")||""):!1}function p(i){l.hasAttribute("data-batch3-preview")||o(i)&&(v=!0,c==null||c.remove(),c=null)}document.addEventListener("pointerdown",p,!0),document.addEventListener("keydown",i=>{(i.key==="Enter"||i.key===" ")&&p(i)},!0),window.addEventListener("message",i=>{var u;!g||i.source!==parent||i.origin!==location.origin||((u=i.data)==null?void 0:u.type)!=="playable-active"||l.toggleAttribute("data-batch3-preview",i.data.active!==!0)}),document.addEventListener("visibilitychange",()=>{l.toggleAttribute("data-b3-hidden",document.hidden)});let r=new MutationObserver(d),e=()=>{d(),r.observe(document.getElementById("root")||document.body,{childList:!0,subtree:!0})};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",e,{once:!0}):e(),window.addEventListener("pagehide",()=>{r.disconnect()},{once:!0})})();})();
