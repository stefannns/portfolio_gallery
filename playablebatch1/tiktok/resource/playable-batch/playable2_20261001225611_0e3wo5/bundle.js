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

(()=>{var pe={tweaks:[{id:"GRID_SIZE",kind:"number",label:"Grid Size",value:15,default:15,min:10,max:20,step:1},{id:"INITIAL_SPEED",kind:"number",label:"Initial Speed",value:300,default:300,min:100,max:500,step:10},{id:"MIN_SPEED",kind:"number",label:"Min Speed",value:80,default:80,min:50,max:150,step:10}],texts:[{id:"GAME_TITLE",label:"Game Title",value:"CATS SNAKE",default:"CATS SNAKE",max_length:20},{id:"BTN_START",label:"Start Button",value:"START GAME",default:"START GAME",max_length:20},{id:"BTN_RESTART",label:"Restart Button",value:"PLAY AGAIN",default:"PLAY AGAIN",max_length:20},{id:"TEXT_SCORE",label:"Score Label",value:"SCORE",default:"SCORE",max_length:10},{id:"TEXT_BEST",label:"Best Score Label",value:"BEST",default:"BEST",max_length:10},{id:"TEXT_POST_PLAY",label:"Post Play Button",value:"POST MY PLAY",default:"POST MY PLAY",max_length:30}],images:[{id:"BG_MAIN",label:"Cats Background Image",path:"./assets/bg_main.webp",replaceable:!0},{id:"CHAR_CAT",label:"Snake Cat Head",path:"./assets/char_cat_clear.png",replaceable:!0}],config_version:"2.0",playable:{post_id:"99278216795270197",version_id:"99278216795338640",runtime_target:"h5",h5_playstyle_type:"general_game",content_locale:"en",min_capability_level:1,full_capability_level:1}},me=`
    html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #050510; -webkit-tap-highlight-color: transparent; }
  

@keyframes feed-prompt-breathe{0%,100%{opacity:1}50%{opacity:.78}}
.feed-first-action{animation:feed-prompt-breathe 2.4s ease-in-out infinite}
.feed-first-action[aria-hidden="true"]{animation:none}
html[data-feed-background] .feed-first-action{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.feed-first-action{animation:none}}


.meme-controls{flex:0 0 24%!important;box-sizing:border-box;min-height:130px;padding:8px 30px calc(18px + env(safe-area-inset-bottom))!important;justify-content:center}.joystick{width:clamp(90px,calc(24vh - 30px),132px)!important;height:clamp(90px,calc(24vh - 30px),132px)!important;flex-shrink:0}.joystick-knob{width:44px!important;height:44px!important}.joystick-knob span{top:7px!important;width:6px!important;height:12px!important}.joystick-cross{inset:12px!important}.meme-scores{justify-content:center!important;text-align:center!important}

.meme-game .meme-hint{position:fixed!important;top:23%!important;bottom:auto!important;left:50%!important;right:auto!important;transform:translate(-50%,-50%);width:max-content!important;max-width:calc(100vw - 60px);padding:4px 14px!important;z-index:25;text-align:center}`,ee=document.createElement("style");ee.textContent=me;document.head.append(ee);for(let g of["playable-inline-config","playable-config-inline"]){let u=document.createElement("script");u.id=g,u.type="application/json",u.textContent=JSON.stringify(pe),document.body.append(u)}document.documentElement.lang="en";(function(){"use strict";var g=[{name:"Apple",src:"./assets/meme_apple.webp"},{name:"Pear",src:"./assets/meme_pear.webp"},{name:"Mango",src:"./assets/meme_mango.webp"},{name:"Pineapple",src:"./assets/meme_pineapple.webp"},{name:"Peach",src:"./assets/meme_peach.webp"},{name:"Watermelon",src:"./assets/meme_watermelon.webp"},{name:"Tomato",src:"./assets/meme_tomato.webp"},{name:"Coconut",src:"./assets/meme_coconut.webp"}],u=document.getElementById("root"),f={},v=[],y,a,k,s=0,m=0,c=1,p="loading",h=0,w=0,l=[],d={x:1,y:0},r=null,x=0,A=0,S=null,L=!1,M=null,I=!1,F,R=.9;try{w=Number(localStorage.getItem("meme-snake-best")||0)}catch{}function te(e){var t={};return["tweaks","texts","images","mentions","motions"].forEach(function(i){(e[i]||[]).forEach(function(n){t[n.id]=n.path!=null?n.path:n.value})}),t}function ae(){return fetch("./game.config.json",{cache:"no-store"}).then(function(e){return e.json()}).catch(function(){return{}}).then(te)}function ne(e){return new Promise(function(t){var i=new Image;i.onload=function(){t(i)},i.onerror=function(){t(null)},i.src=e})}function z(e){if(window.crypto&&window.crypto.getRandomValues){var t=new Uint32Array(1);return window.crypto.getRandomValues(t),t[0]%e}return Math.floor(Math.random()*e)}function q(e,t,i){return Math.max(t,Math.min(i,e))}function G(e,t){var i=e.x-t.x,n=e.y-t.y;return Math.sqrt(i*i+n*n)}function ie(){u.innerHTML=['<main class="meme-game">','<header class="meme-hud">','<div class="meme-scores">','<div><strong id="score-value" aria-label="Score 0">0</strong></div>',"</div>","</header>",'<section class="meme-arena" aria-label="Cats Snake play area">',"<canvas></canvas>",'<div class="meme-hint">Drag to steer</div>','<div class="meme-pickup" aria-live="polite"></div>',"</section>",'<section class="meme-controls">','<div class="joystick" role="application" tabindex="0" aria-label="Analog movement joystick. Drag in any direction; left and right keys rotate.">','<div class="joystick-cross" aria-hidden="true"></div>','<div class="joystick-knob" aria-hidden="true"></div>',"</div>","</section>",'<div class="meme-overlay" id="game-overlay">','<div class="meme-card">','<img class="head-preview" alt="Random cat head preview">','<p class="overlay-kicker" hidden></p>',"<h1 hidden></h1>",'<p class="overlay-copy">Steer with the joystick. Eat squares to grow.</p>','<button class="primary-button" type="button"></button>','<button class="post-button" type="button" hidden></button>',"</div>","</div>","</main>"].join(""),y=u.querySelector("canvas"),a=y.getContext("2d"),k=u.querySelector(".meme-arena"),u.querySelector(".primary-button").textContent=f.BTN_START||"START GAME",u.querySelector(".post-button").textContent=f.TEXT_POST_PLAY||"POST MY PLAY",B(),de(),window.ResizeObserver?(F=new ResizeObserver(O),F.observe(k)):window.addEventListener("resize",O),O()}function O(){if(!(!y||!k)){var e=k.getBoundingClientRect(),t=s||e.width,i=m||e.height;s=Math.max(1,e.width),m=Math.max(1,e.height),c=Math.min(2,window.devicePixelRatio||1),y.width=Math.round(s*c),y.height=Math.round(m*c),y.style.width=s+"px",y.style.height=m+"px",a.setTransform(c,0,0,c,0,0),l.length&&t&&i&&(l.forEach(function(n){n.x=q(n.x/t*s,30,s-30),n.y=q(n.y/i*m,30,m-30)}),r&&(r.x=q(r.x/t*s,34,s-34),r.y=q(r.y/i*m,34,m-34))),Y()}}function B(){var e=document.getElementById("score-value"),t=document.getElementById("best-value");e&&(e.textContent=h,e.setAttribute("aria-label","Score "+h)),t&&(t.textContent=w)}function oe(){var e=Number(f.INITIAL_SPEED)||300;return q(55e3/e,120,250)}function re(){var e=Number(f.MIN_SPEED)||80;return q(24e3/e,220,380)}function X(){h=0,I=!1,L=!1,M=null,d={x:1,y:0};var e=z(g.length);l=[{x:s*.42,y:m*.5,meme:e}],V(),B();var t=u.querySelector(".head-preview");t.src=g[e].src,t.alt=g[e].name+" cat head",u.querySelector(".meme-hint").hidden=!1,D(),Y()}function V(){for(var e={x:s*.72,y:m*.45,meme:z(g.length)},t=0;t<60;t+=1){e.x=42+Math.random()*Math.max(1,s-84),e.y=42+Math.random()*Math.max(1,m-84);var i=l.every(function(n){return G(e,n)>92});if(i)break}r=e}function $(){try{var e=window.AudioContext||window.webkitAudioContext;if(!e)return;if(S=S||new e,S.state==="suspended"){var t=S.resume();t&&t.catch&&t.catch(function(){})}}catch{}}function W(e){try{if(!S)return;var t=S.currentTime,i=S.createOscillator(),n=S.createGain();i.type=e==="eat"?"triangle":"square",i.frequency.setValueAtTime(e==="eat"?480:170,t),i.frequency.exponentialRampToValueAtTime(e==="eat"?780:95,t+.17),n.gain.setValueAtTime(1e-4,t),n.gain.exponentialRampToValueAtTime(.2,t+.015),n.gain.exponentialRampToValueAtTime(1e-4,t+.22),i.connect(n).connect(S.destination),i.start(t),i.stop(t+.24)}catch{}}function J(e){p!=="idle"&&p!=="over"||(e!==!1&&$(),p==="over"&&X(),p="playing",u.querySelector("#game-overlay").classList.add("overlay-hidden"),x=performance.now())}function U(){p="over";var e=u.querySelector(".joystick"),t=M;L=!1,M=null,t!==null&&e.hasPointerCapture(t)&&e.releasePointerCapture(t),D(),W("over");try{navigator.vibrate&&navigator.vibrate([35,35,55])}catch{}w=Math.max(w,h);try{localStorage.setItem("meme-snake-best",String(w))}catch{}B();var i=u.querySelector("#game-overlay"),n=u.querySelector(".meme-card");n.querySelector(".overlay-kicker").textContent="GAME OVER",n.querySelector(".overlay-kicker").hidden=!1,n.querySelector("h1").hidden=!1,n.querySelector("h1").textContent="SCORE "+h,n.querySelector(".overlay-copy").textContent="You collected "+h+" cat"+(h===1?"":"s")+". Try another random head.",n.querySelector(".head-preview").src=g[l[0].meme].src;var b=n.querySelector(".primary-button");b.textContent=f.BTN_RESTART||"PLAY AGAIN";var o=n.querySelector(".post-button");o.hidden=!(window.tt&&typeof window.tt.playableRecordingSubmission=="function"),i.classList.remove("overlay-hidden")}function se(e){var t=u.querySelector(".meme-pickup");t.innerHTML='<img src="'+g[e].src+'" alt=""><span>'+g[e].name.toUpperCase()+" CAT +1</span>",t.classList.remove("pickup-pop"),t.offsetWidth,t.classList.add("pickup-pop")}function ce(e){if(!(p!=="playing"||!I||!l.length)){var t=l[0],i=Math.min(re(),oe()+h*6);t.x+=d.x*i*e,t.y+=d.y*i*e;var n=24*R;if(t.x<n||t.x>s-n||t.y<n||t.y>m-n){U();return}for(var b=42*R,o=1;o<l.length;o+=1){var E=l[o-1],T=l[o],P=E.x-T.x,N=E.y-T.y,_=Math.sqrt(P*P+N*N)||1;_>b&&(T.x=E.x-P/_*b,T.y=E.y-N/_*b)}if(r&&G(t,r)<n+22){var j=l[l.length-1];l.push({x:j.x,y:j.y,meme:r.meme}),h+=1,w=Math.max(w,h),B(),se(r.meme),W("eat");try{navigator.vibrate&&navigator.vibrate(12)}catch{}V()}if(l.length>6){for(var C=5;C<l.length;C+=1)if(G(t,l[C])<25*R){U();return}}}}function le(e,t,i,n){var b=e-i/2,o=t-i/2;a.beginPath(),a.moveTo(b+n,o),a.arcTo(b+i,o,b+i,o+i,n),a.arcTo(b+i,o+i,b,o+i,n),a.arcTo(b,o+i,b,o,n),a.arcTo(b,o,b+i,o,n),a.closePath()}function H(e,t,i){var n=v[e.meme];a.save(),a.translate(e.x,e.y),a.shadowColor=i?"rgba(255,221,110,.8)":"rgba(0,0,0,.45)",a.shadowBlur=i?16:8,a.shadowOffsetY=3,n?a.drawImage(n,-t/2,-t/2,t,t):(a.fillStyle=i?"#f2d16f":"#59c7a0",a.beginPath(),a.arc(0,0,t*.38,0,Math.PI*2),a.fill()),a.restore()}function Y(){if(!(!a||!s||!m)){a.clearRect(0,0,s,m);var e=a.createLinearGradient(0,0,0,m);e.addColorStop(0,"#183941"),e.addColorStop(1,"#0a2128"),a.fillStyle=e,a.fillRect(0,0,s,m);var t=Number(f.GRID_SIZE)||15,i=Math.max(30,s/t*2);a.strokeStyle="rgba(137,220,196,.08)",a.lineWidth=1;for(var n=0;n<s;n+=i)a.beginPath(),a.moveTo(n,0),a.lineTo(n,m),a.stroke();for(var b=0;b<m;b+=i)a.beginPath(),a.moveTo(0,b),a.lineTo(s,b),a.stroke();r&&(a.save(),a.shadowColor="rgba(246,205,101,.65)",a.shadowBlur=17,le(r.x,r.y,38,6),a.fillStyle="#f2d16f",a.fill(),a.lineWidth=3,a.strokeStyle="#fff0bb",a.stroke(),a.shadowBlur=0,a.fillStyle="#18343b",a.font="600 23px DynaPuff, sans-serif",a.textAlign="center",a.textBaseline="middle",a.fillText("?",r.x,r.y+1),a.restore());for(var o=l.length-1;o>=1;o-=1)H(l[o],52*R,!1);l.length&&H(l[0],62*R,!0)}}function K(e){var t=Math.min(.034,Math.max(0,(e-x)/1e3));x=e,ce(t),Y(),A=requestAnimationFrame(K)}function de(){var e=u.querySelector(".joystick"),t=u.querySelector(".joystick-knob");function i(o,E){var T=e.getBoundingClientRect(),P=T.left+T.width/2,N=T.top+T.height/2,_=o-P,j=E-N,C=Math.sqrt(_*_+j*j)||1,Z=T.width*.31,Q=Math.min(Z,C);t.style.transform="translate(calc(-50% + "+_/C*Q+"px),calc(-50% + "+j/C*Q+"px))",C>Math.max(3,T.width*.025)&&(d={x:_/C,y:j/C},I=!0,u.querySelector(".meme-hint").hidden=!0)}e.addEventListener("pointerdown",function(o){p!=="playing"||M!==null||o.isPrimary===!1||o.button!=null&&o.button!==0||(o.preventDefault(),$(),M=o.pointerId,L=!0,e.setPointerCapture(o.pointerId),e.classList.add("joystick-active"),i(o.clientX,o.clientY))}),e.addEventListener("pointermove",function(o){!L||o.pointerId!==M||p!=="playing"||(o.preventDefault(),i(o.clientX,o.clientY))});function n(o){if(!(o&&o.pointerId!=null&&o.pointerId!==M)){var E=M;M=null,L=!1,e.classList.remove("joystick-active"),E!==null&&e.hasPointerCapture(E)&&e.releasePointerCapture(E),D()}}e.addEventListener("pointerup",n),e.addEventListener("pointercancel",n),e.addEventListener("lostpointercapture",n),e.addEventListener("keydown",function(o){if(!(p!=="playing"||o.key!=="ArrowLeft"&&o.key!=="ArrowRight")){o.preventDefault(),I=!0,u.querySelector(".meme-hint").hidden=!0;var E=o.key==="ArrowLeft"?-Math.PI/12:Math.PI/12,T=Math.cos(E),P=Math.sin(E);d={x:d.x*T-d.y*P,y:d.x*P+d.y*T}}});function b(){n(),p==="playing"&&(I=!1,u.querySelector(".meme-hint").hidden=!1),x=performance.now()}window.addEventListener("blur",b),document.addEventListener("visibilitychange",function(){document.hidden&&b()}),u.querySelector(".primary-button").addEventListener("click",J),u.querySelector(".post-button").addEventListener("click",function(){window.tt&&typeof window.tt.playableRecordingSubmission=="function"&&window.tt.playableRecordingSubmission({success:function(){},fail:function(){}})})}function D(){var e=u.querySelector(".joystick");e&&e.classList.remove("joystick-active");var t=u.querySelector(".joystick-knob");t&&(t.style.transform="translate(-50%,-50%)")}function ue(){var e=document.createElement("style");e.textContent=["@font-face{font-family:DynaPuff;src:url('./assets/fonts/dynapuff/DynaPuff-SemiBold.woff2') format('woff2');font-style:normal;font-weight:600;font-display:swap}","@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}",":root{--ui-unit:min(0.2564102564vw,0.1672240803vh);--font-playful:DynaPuff,system-ui,sans-serif;--font-readable:Poppins,system-ui,sans-serif}","*{box-sizing:border-box}","html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}","body{background:#06161b;color:#f6fff9;font-family:var(--font-readable);font-weight:400;font-synthesis:none;overscroll-behavior:none}","button{font:inherit}[hidden]{display:none!important}",".meme-game{position:relative;width:100%;height:100%;margin:0 auto;display:flex;flex-direction:column;overflow:hidden;background:#0a2228;box-shadow:0 0 50px #0008}",".meme-hud{position:relative;z-index:2;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit) + env(safe-area-inset-right)) 12px calc(30 * var(--ui-unit) + env(safe-area-inset-left));background:#102c33;border-bottom:1px solid #79c9b344}",".meme-scores{display:flex;width:100%;justify-content:space-between;align-items:center;gap:14px;text-align:right}",".meme-scores div{display:flex;align-items:baseline;gap:8px}",".meme-scores span{font-family:var(--font-playful);font-size:calc(14 * var(--ui-unit));font-weight:600;letter-spacing:.5px;color:#c6e8df}",".meme-scores strong{font-family:var(--font-playful);font-weight:600;font-size:calc(28 * var(--ui-unit));line-height:1.2;color:#fff;font-variant-numeric:tabular-nums}",".meme-arena{position:relative;flex:1;min-height:0;margin:0;border:2px solid #72c6b0;border-left:0;border-right:0;border-radius:0;overflow:hidden;background:#102d34;box-shadow:inset 0 0 28px #0007,0 10px 24px #0005}",".meme-arena canvas{display:block;width:100%;height:100%;touch-action:none}",".meme-hint{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:calc(100% - 32px);padding:7px 12px;border-radius:16px;background:#06171de6;color:#e9fff8;font-size:calc(18 * var(--ui-unit));line-height:1.35;font-weight:800;letter-spacing:.3px;text-align:center;pointer-events:none}",".meme-pickup{position:absolute;left:50%;top:20px;display:flex;align-items:center;gap:8px;min-height:42px;padding:5px 12px 5px 6px;border:1px solid #f4d77f;border-radius:999px;background:#142d32ed;color:#fff0b8;font-size:12px;font-weight:900;opacity:0;transform:translate(-50%,-12px);pointer-events:none}",".meme-pickup img{width:34px;height:34px;object-fit:contain}",".pickup-pop{animation:pickup-pop 1.15s ease both}","@keyframes pickup-pop{0%{opacity:0;transform:translate(-50%,-12px) scale(.85)}15%,75%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-8px) scale(.95)}}",".meme-controls{position:relative;z-index:2;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;padding:12px calc(30 * var(--ui-unit)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom) + 22px);background:#102c33}",".meme-controls p{margin:7px 0 0;color:#9bd6c6;font-size:10px;font-weight:900;letter-spacing:1.6px}",".joystick{position:relative;width:142px;height:142px;border:2px solid #83d2bd;border-radius:50%;background:radial-gradient(circle,#183e46 0 29%,#102b32 30% 58%,#0a2026 59%);box-shadow:inset 0 0 18px #0008,0 8px 18px #0006;touch-action:none;cursor:grab;outline:none}",".joystick:focus-visible{outline:3px solid #fff3bc;outline-offset:4px}",".joystick-active{cursor:grabbing;border-color:#f0d17d}",".joystick-cross{position:absolute;inset:14px;border-radius:50%;background:linear-gradient(90deg,transparent 49.5%,#a9d9cc33 50%,transparent 50.5%),linear-gradient(0deg,transparent 49.5%,#a9d9cc33 50%,transparent 50.5%);pointer-events:none}",".joystick-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;transform:translate(-50%,-50%);border:3px solid #ffebb0;border-radius:50%;background:linear-gradient(145deg,#f2d16f,#bb8148);box-shadow:0 7px 14px #0009,inset 0 2px #fff8;pointer-events:none;transition:box-shadow .12s ease}",".joystick-knob span{position:absolute;left:50%;top:9px;width:8px;height:15px;transform:translateX(-50%);border-radius:5px;background:#18343b}",".meme-overlay{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit) + env(safe-area-inset-right)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom)) calc(30 * var(--ui-unit) + env(safe-area-inset-left));background:#06161bf2;backdrop-filter:blur(6px);opacity:1;visibility:visible;transition:opacity .25s ease,visibility .25s ease}",".overlay-hidden{opacity:0;visibility:hidden;pointer-events:none}",".meme-card{width:100%;max-width:370px;padding:24px 20px;border:1.5px solid #6fc1ad;border-radius:24px;background:#102d34;text-align:center;box-shadow:0 20px 50px #000b}",".head-preview{width:132px;height:132px;object-fit:contain;filter:drop-shadow(0 9px 10px #0008)}",".overlay-kicker{margin:8px 0 6px;color:#f2d16f;font-size:11px;font-weight:900;letter-spacing:1.8px}",".meme-card h1{margin:0;font-family:var(--font-playful);font-size:calc(28 * var(--ui-unit));font-weight:600;line-height:1.2;letter-spacing:.2px;color:#fff;text-shadow:0 2px 0 #663f33}",".overlay-copy{max-width:29ch;margin:14px auto 20px;color:#c6e8df;font-size:calc(18 * var(--ui-unit));line-height:1.4}",".primary-button,.post-button{width:100%;min-height:54px;padding:10px 16px;border:0;border-radius:13px;background:#f0d17d;color:#17343a;font-size:17px;font-weight:900;box-shadow:0 5px 0 #92763b;cursor:pointer;touch-action:manipulation}",".primary-button:active,.post-button:active{filter:brightness(.92);box-shadow:0 2px 0 #92763b}",".primary-button:focus-visible,.post-button:focus-visible{outline:3px solid #fff;outline-offset:3px}",".post-button{margin-top:11px;border:1px solid #7bcab6;background:#173b43;color:#e9fff8;box-shadow:none}",".primary-button,.post-button,.overlay-kicker,.meme-pickup{font-family:var(--font-playful);font-weight:600}",".meme-hint{font-weight:400;letter-spacing:0}","@media(max-height:700px){.meme-hud{padding-bottom:8px}.meme-controls{padding-top:8px}.joystick{width:116px;height:116px}.joystick-knob{width:48px;height:48px}.meme-controls p{margin-top:4px}.head-preview{width:105px;height:105px}.meme-card{padding-top:18px;padding-bottom:18px}}","@media(prefers-reduced-motion:reduce){.meme-overlay{transition:none}.pickup-pop{animation-duration:.2s}}"].join(""),document.head.appendChild(e)}ue(),Promise.all([ae(),Promise.all(g.map(function(e){return ne(e.src)}))]).then(function(e){f=e[0],v=e[1],ie(),X(),p="idle",J(!1),cancelAnimationFrame(A),x=performance.now(),A=requestAnimationFrame(K)})})();(function(){"use strict";var m,c;let g={getAttribute(p){return{"data-subject":".meme-arena","data-game":"",defer:null,src:"./feed-entry-motion.js?v=feed-first-20261008-1"}[p]??null},dataset:{subject:".meme-arena",game:""}},u=(g==null?void 0:g.getAttribute("data-subject"))||"#root canvas",f=(m=window.matchMedia)==null?void 0:m.call(window,"(prefers-reduced-motion: reduce)"),v,y,a=!1;function k(){y==null||y.cancel(),y=null}function s(){if(a||document.hidden)return;let p=document.querySelector(u);if(!p||p.closest('[hidden], [aria-hidden="true"]'))return;let h=window.getComputedStyle(p);if(h.display==="none"||h.visibility==="hidden")return;if(p.tagName==="IMG"&&!p.complete){p.addEventListener("load",s,{once:!0});return}if(a=!0,v==null||v.disconnect(),f!=null&&f.matches)return;let w=Number(window.getComputedStyle(p).opacity)||1;typeof p.animate=="function"&&(y=p.animate([{opacity:w*.76},{opacity:w}],{duration:650,easing:"ease-out"}),y.onfinish=()=>{y=null})}v=new MutationObserver(s),v.observe(document.body,{childList:!0,subtree:!0}),s(),document.addEventListener("visibilitychange",()=>{document.documentElement.toggleAttribute("data-feed-background",document.hidden),document.hidden?k():s()}),window.addEventListener("pagehide",()=>{v.disconnect(),k()}),window.addEventListener("pageshow",()=>{a||v.observe(document.body,{childList:!0,subtree:!0}),s()}),document.addEventListener("pointerdown",k,{capture:!0,passive:!0}),(c=f==null?void 0:f.addEventListener)==null||c.call(f,"change",()=>{f.matches&&k()})})();(()=>{var w;let g=[".meme-hint"],u=new Set([].map(l=>l.replace(/\s+/g," ").trim().toLowerCase())),f=window.matchMedia("(prefers-reduced-motion: reduce)"),v=new Map,y=!1,a=!0,k=/^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;function s(){y=!1;for(let[d,r]of v)d.isConnected||(r.cancel(),v.delete(d));if(f.matches){for(let d of v.values())d.cancel();v.clear();return}let l=new Set;for(let d of g)try{document.querySelectorAll(d).forEach(r=>l.add(r))}catch{}for(let d of document.querySelectorAll("p,span,div,label,text")){if(d.children.length||d.closest('button,a,input,select,textarea,[role="button"]'))continue;let r=(d.textContent||"").replace(/\s+/g," ").trim();r.length>=5&&r.length<=140&&(u.has(r.toLowerCase())||!g.length&&k.test(r))&&l.add(d)}for(let d of l){if(v.has(d)||typeof d.animate!="function"||[...l].some(L=>L!==d&&d.contains(L)))continue;let r=getComputedStyle(d);if(/breath/i.test(r.animationName))continue;let x=r.filter.replace(/opacity\([^)]*\)/g,"").replace(/^none$/,"").trim(),A=L=>(x?x+" ":"")+"opacity("+L+")",S=d.animate([{filter:A(1)},{filter:A(.65)},{filter:A(1)}],{duration:2400,iterations:1/0,easing:"ease-in-out"});v.set(d,S),(document.hidden||!a)&&S.pause()}}let m=()=>{y||(y=!0,requestAnimationFrame(s))},c=()=>{for(let l of v.values())document.hidden||!a?l.pause():l.play()},p=new MutationObserver(m);p.observe(document.documentElement,{childList:!0,subtree:!0,characterData:!0});let h=typeof IntersectionObserver=="function"?new IntersectionObserver(l=>{a=l.some(d=>d.isIntersecting),c()}):null;document.body?h==null||h.observe(document.body):document.addEventListener("DOMContentLoaded",()=>h==null?void 0:h.observe(document.body),{once:!0}),document.addEventListener("visibilitychange",c),(w=f.addEventListener)==null||w.call(f,"change",m),m(),window.addEventListener("pagehide",()=>{p.disconnect(),h==null||h.disconnect();for(let l of v.values())l.cancel();v.clear()},{once:!0})})();(()=>{"use strict";let g=Number({getAttribute(r){return{"data-subject":"#root canvas","data-game":"","data-batch3-game":"43"}[r]??null},dataset:{subject:"#root canvas",game:"",batch3Game:"43"}}.dataset.batch3Game),u=new URLSearchParams(location.search).get("feedReview")==="1"&&window.parent!==window,f=document.documentElement;f.toggleAttribute("data-batch3-preview",u);let v={12:{text:"Tap to pop the bubbles",top:"80px",color:"#a2355a",action:"bubble"},20:{text:"Tap the bug",top:"32%",color:"#fff",action:"bug"},27:{text:"Guess their age",top:"10.5%",color:"#fff",action:"age"},37:{text:"Tap to add balls",top:"24%",color:"#fff",action:"add-ball"},39:{text:"Tap squares to find the animal",top:"22%",color:"#29202e",action:"cell"},49:{text:"Guess the hidden code",top:"40%",color:"#fff",action:"digit"},60:{text:"Steer into the parking spot",top:"34%",color:"#fff",action:"drive"}},a=`
    .b3-guide{position:fixed;left:30px;right:30px;z-index:120;margin:0;text-align:center;
      font:700 18px/1.3 var(--font-display,system-ui,sans-serif);pointer-events:none;
      text-shadow:0 1px 3px rgba(0,0,0,.25);animation:b3-breathe 2.4s ease-in-out infinite}
    @keyframes b3-breathe{0%,100%{opacity:1}50%{opacity:.68}}
    html[data-b3-hidden] .b3-guide,html[data-b3-hidden] #opening .opening-heading p{animation-play-state:paused!important}
    @media(prefers-reduced-motion:reduce){.b3-guide,html[data-batch3-preview] #opening .opening-heading p{animation:none!important}}
    ${{8:"html[data-batch3-preview] #root button {visibility:hidden!important}",11:"html[data-batch3-preview] .screen-container div:has(>button.btn-option){transform:translateY(-8vh) scale(.84);transform-origin:center center}",13:"html[data-batch3-preview] #root button {visibility:hidden!important}",25:"html[data-batch3-preview] #root button {visibility:hidden!important}",27:"html[data-batch3-preview] .age-controls {transform:translateY(-16vh) scale(.9);transform-origin:bottom center}",30:"html[data-batch3-preview] .btn-control {visibility:hidden!important}",34:"html[data-batch3-preview] #root button {visibility:hidden!important}",37:"html[data-batch3-preview] #root button {bottom:34%!important}",38:"html[data-batch3-preview] .pendulum-actions {visibility:hidden!important}",39:'html[data-batch3-preview] [aria-label="8 by 8 animal search map"] {transform:scale(.84);transform-origin:center top}',43:"html[data-batch3-preview] .meme-controls {visibility:hidden!important}",48:"html[data-batch3-preview] #root button {visibility:hidden!important}",49:"html[data-batch3-preview] #root button {visibility:hidden!important}",52:"html[data-batch3-preview] .fate-wheel-wrap {transform:scale(.84)}",54:"html[data-batch3-preview] .control {visibility:hidden!important}",56:"html[data-batch3-preview] .drive-controls {visibility:hidden!important}",60:'html[data-batch3-preview] #root div:has(>div>button[aria-label="Steer left"]) {visibility:hidden!important}',73:"html[data-batch3-preview] #opening .opening-heading p {animation:b3-breathe 2.4s ease-in-out infinite}",74:"html[data-batch3-preview] #photo-controls {visibility:hidden!important}"}[g]||""}
  `,k=document.createElement("style");k.setAttribute("data-batch3-polish",""),k.textContent=a,document.head.append(k);let s,m=!1,c=v[g];function p(){!c||s||m||(s=document.createElement("p"),s.className="b3-guide",s.textContent=c.text,s.style.top=c.top,s.style.color=c.color,document.body.append(s))}function h(r){let x=r.target;if(!(x instanceof Element))return!1;if((c==null?void 0:c.action)==="bug")return!!x.closest('#root div[tabindex="0"]');if((c==null?void 0:c.action)==="bubble"){if(x.closest('#root div[tabindex="0"],#root canvas'))return!0;let S=x.closest("button");return!!S&&/^(Sand Art|Spinner)$/.test(S.textContent.trim())}if((c==null?void 0:c.action)==="age")return!!x.closest('input[type="range"],button.guess');let A=x.closest("button");return!A||A.disabled?!1:(c==null?void 0:c.action)==="add-ball"?A.textContent.trim()==="Add Ball":(c==null?void 0:c.action)==="cell"?/^Check cell \d+$/.test(A.getAttribute("aria-label")||""):(c==null?void 0:c.action)==="digit"?/^\d$/.test(A.textContent.trim()):(c==null?void 0:c.action)==="drive"?/^(Steer left|Steer right|Drive forward|Reverse)$/.test(A.getAttribute("aria-label")||""):!1}function w(r){f.hasAttribute("data-batch3-preview")||h(r)&&(m=!0,s==null||s.remove(),s=null)}document.addEventListener("pointerdown",w,!0),document.addEventListener("keydown",r=>{(r.key==="Enter"||r.key===" ")&&w(r)},!0),window.addEventListener("message",r=>{var x;!u||r.source!==parent||r.origin!==location.origin||((x=r.data)==null?void 0:x.type)!=="playable-active"||f.toggleAttribute("data-batch3-preview",r.data.active!==!0)}),document.addEventListener("visibilitychange",()=>{f.toggleAttribute("data-b3-hidden",document.hidden)});let l=new MutationObserver(p),d=()=>{p(),l.observe(document.getElementById("root")||document.body,{childList:!0,subtree:!0})};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",d,{once:!0}):d(),window.addEventListener("pagehide",()=>{l.disconnect()},{once:!0})})();})();
