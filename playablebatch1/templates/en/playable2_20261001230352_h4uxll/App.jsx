/* Consolidated CURRENT browser application. Valid JavaScript/JSX-subset source.
 * Rebuild: node check.js --build. No historical authoring version is substituted.
 * External helpers and inline entry code are preserved in their original execution order.
 */
// TEMPLATE_HTML_BASE64: PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CgogIDxtZXRhIGNoYXJzZXQ9IlVURi04IiAvPgogIDxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MS4wLCBtYXhpbXVtLXNjYWxlPTEuMCwgdXNlci1zY2FsYWJsZT1ubyIgLz4KICA8dGl0bGU+VHdpbGlnaHQgR3JheXNjYWxlPC90aXRsZT4KICA8c3R5bGU+CiAgICBodG1sLCBib2R5LCAjcm9vdCB7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDEwMCU7IG1hcmdpbjogMDsgcGFkZGluZzogMDsgb3ZlcmZsb3c6IGhpZGRlbjsgfQogICAgYm9keSB7IGJhY2tncm91bmQ6ICMxMTE1MWQ7IC13ZWJraXQtdGFwLWhpZ2hsaWdodC1jb2xvcjogdHJhbnNwYXJlbnQ7IH0KICA8L3N0eWxlPgo8c3R5bGUgaWQ9ImZlZWQtZW50cnktbW90aW9uIj4KQGtleWZyYW1lcyBmZWVkLXByb21wdC1icmVhdGhlezAlLDEwMCV7b3BhY2l0eToxfTUwJXtvcGFjaXR5Oi43OH19Ci5mZWVkLWZpcnN0LWFjdGlvbnthbmltYXRpb246ZmVlZC1wcm9tcHQtYnJlYXRoZSAyLjRzIGVhc2UtaW4tb3V0IGluZmluaXRlfQouZmVlZC1maXJzdC1hY3Rpb25bYXJpYS1oaWRkZW49InRydWUiXXthbmltYXRpb246bm9uZX0KaHRtbFtkYXRhLWZlZWQtYmFja2dyb3VuZF0gLmZlZWQtZmlyc3QtYWN0aW9ue2FuaW1hdGlvbi1wbGF5LXN0YXRlOnBhdXNlZH0KQG1lZGlhKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246cmVkdWNlKXsuZmVlZC1maXJzdC1hY3Rpb257YW5pbWF0aW9uOm5vbmV9fQo8L3N0eWxlPgo8c3R5bGUgZGF0YS1ndWlkZS1jZW50ZXJpbmc9IjIwMjYxMDIxIj4KLyogVXNlciBvdmVycmlkZSAyMDI2LTEwLTIxOiBmYXZvciB2aXN1YWwgY2VudGVyLCBub3QgYSBmaXhlZCB1cHBlciBiYW5kLiAqLwpodG1sOnJvb3Q6cm9vdDpyb290IDppcygjcm9vdCwjZ2FtZSwjc3RhZ2UpOmlzKCNyb290LCNnYW1lLCNzdGFnZSkgcCNndWlkZXtwb3NpdGlvbjpmaXhlZCFpbXBvcnRhbnQ7dG9wOjI2JSFpbXBvcnRhbnQ7Ym90dG9tOmF1dG8haW1wb3J0YW50O2xlZnQ6NTAlIWltcG9ydGFudDtyaWdodDphdXRvIWltcG9ydGFudDt3aWR0aDptYXgtY29udGVudCFpbXBvcnRhbnQ7bWF4LXdpZHRoOmNhbGMoMTAwdncgLSA2MHB4KSFpbXBvcnRhbnQ7bWluLWhlaWdodDowIWltcG9ydGFudDttYXJnaW46MCFpbXBvcnRhbnQ7dGV4dC1hbGlnbjpjZW50ZXIhaW1wb3J0YW50O3RyYW5zbGF0ZTotNTAlIC01MCUhaW1wb3J0YW50O3RyYW5zZm9ybTpub25lIWltcG9ydGFudDtwb2ludGVyLWV2ZW50czpub25lIWltcG9ydGFudDt6LWluZGV4OjI1IWltcG9ydGFudDtvdmVyZmxvdy13cmFwOmFueXdoZXJlfQpodG1sOnJvb3Q6cm9vdDpyb290ICNyb290IC5odWR7ZmlsdGVyOm5vbmUhaW1wb3J0YW50fQpodG1sOnJvb3Q6cm9vdDpyb290ICNyb290IC5jb3VudGVye2ZpbHRlcjpkcm9wLXNoYWRvdygwIDNweCAxMnB4IHJnYmEoMCwwLDAsLjcyKSl9Cmh0bWw6cm9vdDpyb290OnJvb3QgOmlzKCNyb290LCNnYW1lLCNzdGFnZSk6aXMoI3Jvb3QsI2dhbWUsI3N0YWdlKSBwI2d1aWRle2NvbG9yOiNlZWYzZmY7dGV4dC1zaGFkb3c6MCAycHggOHB4ICMwMDBhfQoKPC9zdHlsZT4KPHN0eWxlIGRhdGEtZ3VpZGUtYnJlYXRoaW5nPSIyMDI2MTAyMSI+Ci8qIEV4aXN0aW5nIGd1aWRlIHRleHQgb25seTsgcG9zaXRpb24sIG9wYWNpdHkgbGlmZWN5Y2xlIGFuZCBoaXQgcmVnaW9ucyByZW1haW4gZ2FtZS1vd25lZC4gKi8KQGtleWZyYW1lcyBiYXRjaC1ndWlkZS1icmVhdGhlezAlLDEwMCV7ZmlsdGVyOm9wYWNpdHkoMSl9NTAle2ZpbHRlcjpvcGFjaXR5KC42NSl9fQpodG1sOnJvb3Q6cm9vdCA6aXMocCNndWlkZSl7YW5pbWF0aW9uOmJhdGNoLWd1aWRlLWJyZWF0aGUgMi40cyBlYXNlLWluLW91dCBpbmZpbml0ZSFpbXBvcnRhbnR9Cmh0bWxbZGF0YS1ndWlkZS1icmVhdGhpbmctcGF1c2VkXTpyb290OnJvb3QgOmlzKHAjZ3VpZGUpe2FuaW1hdGlvbi1wbGF5LXN0YXRlOnBhdXNlZCFpbXBvcnRhbnR9CkBtZWRpYShwcmVmZXJzLXJlZHVjZWQtbW90aW9uOnJlZHVjZSl7aHRtbDpyb290OnJvb3QgOmlzKHAjZ3VpZGUpe2FuaW1hdGlvbjpub25lIWltcG9ydGFudH19Cgo8L3N0eWxlPgoKPC9oZWFkPgo8Ym9keT4KICA8ZGl2IGlkPSJyb290Ij48L2Rpdj4KICA8c2NyaXB0IGlkPSJwbGF5YWJsZS1jb25maWctaW5saW5lIiB0eXBlPSJhcHBsaWNhdGlvbi9qc29uIj57CiAgInR3ZWFrcyI6IFsKICAgIHsKICAgICAgImlkIjogIkNMT1VEX1NQRUVEIiwKICAgICAgImtpbmQiOiAibnVtYmVyIiwKICAgICAgImxhYmVsIjogIkNsb3VkIFNwZWVkIiwKICAgICAgInZhbHVlIjogMC4zNCwKICAgICAgImRlZmF1bHQiOiAwLjM0LAogICAgICAibWluIjogMC4xLAogICAgICAibWF4IjogMSwKICAgICAgInN0ZXAiOiAwLjAyCiAgICB9LAogICAgewogICAgICAiaWQiOiAiQ0xPVURfREVOU0lUWSIsCiAgICAgICJraW5kIjogIm51bWJlciIsCiAgICAgICJsYWJlbCI6ICJDbG91ZCBEZW5zaXR5IiwKICAgICAgInZhbHVlIjogMTgsCiAgICAgICJkZWZhdWx0IjogMTgsCiAgICAgICJtaW4iOiA4LAogICAgICAibWF4IjogMzAsCiAgICAgICJzdGVwIjogMQogICAgfSwKICAgIHsKICAgICAgImlkIjogIkxJR0hUTklOR19HTE9XIiwKICAgICAgImtpbmQiOiAibnVtYmVyIiwKICAgICAgImxhYmVsIjogIkxpZ2h0bmluZyBHbG93IiwKICAgICAgInZhbHVlIjogMzAsCiAgICAgICJkZWZhdWx0IjogMzAsCiAgICAgICJtaW4iOiAxMCwKICAgICAgIm1heCI6IDYwLAogICAgICAic3RlcCI6IDIKICAgIH0sCiAgICB7CiAgICAgICJpZCI6ICJUSFVOREVSX1ZPTFVNRSIsCiAgICAgICJraW5kIjogIm51bWJlciIsCiAgICAgICJsYWJlbCI6ICJUaHVuZGVyIFZvbHVtZSIsCiAgICAgICJ2YWx1ZSI6IDAuMjgsCiAgICAgICJkZWZhdWx0IjogMC4yOCwKICAgICAgIm1pbiI6IDAsCiAgICAgICJtYXgiOiAwLjYsCiAgICAgICJzdGVwIjogMC4wMgogICAgfQogIF0sCiAgInRleHRzIjogWwogICAgewogICAgICAiaWQiOiAiR0FNRV9USVRMRSIsCiAgICAgICJsYWJlbCI6ICJHYW1lIFRpdGxlIiwKICAgICAgInZhbHVlIjogIlR3aWxpZ2h0IEdyYXlzY2FsZSIsCiAgICAgICJkZWZhdWx0IjogIlR3aWxpZ2h0IEdyYXlzY2FsZSIsCiAgICAgICJtYXhfbGVuZ3RoIjogMzAKICAgIH0sCiAgICB7CiAgICAgICJpZCI6ICJHVUlERV9URVhUIiwKICAgICAgImxhYmVsIjogIkd1aWRlIFRleHQiLAogICAgICAidmFsdWUiOiAiVGFwIHRoZSBjbG91ZHMgdG8gY2FsbCBsaWdodG5pbmciLAogICAgICAiZGVmYXVsdCI6ICJUYXAgdGhlIGNsb3VkcyB0byBjYWxsIGxpZ2h0bmluZyIsCiAgICAgICJtYXhfbGVuZ3RoIjogNDQKICAgIH0KICBdLAogICJpbWFnZXMiOiBbXSwKICAibW90aW9ucyI6IFtdLAogICJjb25maWdfdmVyc2lvbiI6ICIyLjAiLAogICJwbGF5YWJsZSI6IHsKICAgICJwb3N0X2lkIjogIjk5MjgwMTUwOTY1MjM4NTc1IiwKICAgICJ2ZXJzaW9uX2lkIjogIjk5MjgwMTUwOTY1MTM1NTQ3IiwKICAgICJydW50aW1lX3RhcmdldCI6ICJoNSIsCiAgICAiaDVfcGxheXN0eWxlX3R5cGUiOiAiaW1hZ2VfZXhwcmVzc2lvbiIsCiAgICAiY29udGVudF9sb2NhbGUiOiAiZW4iLAogICAgIm1pbl9jYXBhYmlsaXR5X2xldmVsIjogMSwKICAgICJmdWxsX2NhcGFiaWxpdHlfbGV2ZWwiOiAxCiAgfQp9PC9zY3JpcHQ+CiAgCiAgCgoKPHNjcmlwdCBzcmM9Ii4vYnVuZGxlLmpzIj48L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==

;/* Current runtime segment: inline-0 */

// Active only inside the feed reviewer. Ordinary standalone games are unchanged.
(() => {
  if (new URLSearchParams(location.search).get('feedReview') !== '1') return;
  let active=false,alive=true;
  const waiting=new Set(),contexts=new Set(),media=new Set(),streams=new Set();
  const wait=()=>alive ? new Promise((resolve,reject)=>waiting.add({resolve,reject})) : Promise.reject(new DOMException('Feed closed','AbortError'));
  if(navigator.mediaDevices?.getUserMedia){
    const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{
      if(!active)await wait();if(!alive)throw new DOMException('Feed closed','AbortError');
      const stream=await native(constraints);
      if(!alive||!active){stream.getTracks().forEach(track=>track.stop());throw new DOMException('Feed inactive','AbortError');}
      streams.add(stream);return stream;
    };
  }
  for(const key of ['AudioContext','webkitAudioContext']){
    const Native=window[key];if(!Native)continue;
    window[key]=class FeedAudioContext extends Native {
      constructor(...args){super(...args);contexts.add(this);if(!active)super.suspend().catch(()=>{});}
      async resume(){if(!active)await wait();if(alive)return super.resume();}
    };
  }
  const nativePlay=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=async function(...args){media.add(this);if(!active)await wait();if(alive)return nativePlay.apply(this,args);};
  addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='playable-active')return;
    active=alive&&event.data.active===true;
    if(active){for(const job of waiting)job.resolve();waiting.clear();for(const context of contexts)if(context.state!=='closed')context.resume().catch(()=>{});}
    else {for(const context of contexts)if(context.state!=='closed')context.suspend().catch(()=>{});for(const item of media)item.pause();for(const stream of streams)stream.getTracks().forEach(track=>track.stop());streams.clear();}
  });
  addEventListener('pagehide',()=>{alive=false;active=false;for(const job of waiting)job.reject(new DOMException('Feed closed','AbortError'));waiting.clear();for(const context of contexts)if(context.state!=='closed')context.close().catch(()=>{});for(const item of media)item.pause();for(const stream of streams)stream.getTracks().forEach(track=>track.stop());},{once:true});
})();

;

;/* Current runtime segment: inline-1 */

    if (location.protocol === "file:") {
      const config = document.getElementById("playable-config-inline").textContent;
      const originalFetch = window.fetch.bind(window);
      window.fetch = function(input, options) {
        const url = typeof input === "string" ? input : input && input.url;
        if (url && /(?:^|\/)game\.config\.json(?:[?#]|$)/.test(url)) {
          return Promise.resolve(new Response(config, {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }));
        }
        return originalFetch(input, options);
      };
    }
  
;

;/* Current runtime segment: scene-audio.js */
/* Original procedural audio. No third-party recordings or runtime dependencies. */
(() => {
  'use strict';
  const randomFor = seed => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  class PlayableSceneAudio {
    constructor({ profile, context = null } = {}) {
      this.profile = profile;
      this.context = context;
      this.ownsContext = !context;
      this.buffers = new Map();
      this.voices = new Set();
      this.loopVoice = null;
      this.loopWanted = false;
      this.disposed = false;
      this.visibility = () => {
        if (document.hidden) {
          this.stopAll();
          if (this.profile === 'carve') this.loopWanted = false;
          if (this.ownsContext) this.context?.suspend?.().catch(() => {});
        } else if (this.profile === 'maze' && this.loopWanted) this.setLoop(true);
      };
      this.pageHide = () => {
        this.stopAll();
        if (this.profile === 'carve') this.loopWanted = false;
        if (this.ownsContext) this.context?.suspend?.().catch(() => {});
      };
      this.pageShow = () => {
        if (this.profile === 'maze' && this.loopWanted && !document.hidden) this.setLoop(true);
      };
      document.addEventListener('visibilitychange', this.visibility);
      window.addEventListener('pagehide', this.pageHide);
      window.addEventListener('pageshow', this.pageShow);
    }

    unlock() {
      if (this.disposed || document.hidden) return null;
      try {
        if (!this.context) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return null;
          this.context = new Audio();
        }
        if (this.context.state === 'closed') return null;
        if (this.context.state === 'suspended') this.context.resume().catch(() => {});
        return this.context;
      } catch (_) { return null; }
    }

    buffer(kind, variant = 0) {
      const key = kind + variant;
      if (this.buffers.has(key)) return this.buffers.get(key);
      const ctx = this.context;
      const seconds = { maze: 8, carve: 1.7, thunder: 3.4, step: .09, scare: .3, win: .55 }[kind];
      const stereo = kind === 'thunder';
      const buffer = ctx.createBuffer(stereo ? 2 : 1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        const random = randomFor(4027 + variant * 89 + channel * 193);
        let low = 0, grain = 0, peak = 0;
        const smoothing = Math.exp(-2 * Math.PI * (kind === 'maze' ? 140 : 85) / ctx.sampleRate);
        const highSmoothing = Math.exp(-2 * Math.PI * 420 / ctx.sampleRate);
        for (let i = 0; i < samples.length; i++) {
          const t = i / ctx.sampleRate;
          const white = random() * 2 - 1;
          low = low * smoothing + white * (1 - smoothing);
          grain = grain * highSmoothing + white * (1 - highSmoothing);
          let value;
          if (kind === 'maze') {
            // Slow, non-pitched air, deliberately behind footsteps and encounters.
            value = low * (.68 + .16 * Math.sin(t * Math.PI / 2) + .08 * Math.sin(t * Math.PI));
          } else if (kind === 'carve') {
            const stroke = .42 + .26 * Math.sin(t * 18) ** 2 + .16 * Math.sin(t * 31 + .7) ** 2;
            value = (white - grain) * stroke * .3 + (random() > .997 ? white * .34 : 0);
          } else if (kind === 'thunder') {
            const crack = Math.exp(-t * 26) * .65 + Math.exp(-Math.abs(t - .07) * 60) * .2;
            const rolling = Math.exp(-t * 1.15) * (1 - Math.exp(-t * 24)) *
              (.65 + .3 * Math.sin(t * 12 + variant) ** 2);
            const echoes = Math.exp(-Math.abs(t - .28) * 15) * .28 +
              Math.exp(-Math.abs(t - .64) * 9) * .2 + Math.exp(-Math.abs(t - 1.12) * 7) * .12;
            value = white * crack + low * 9 * (rolling + echoes);
            value *= Math.min(1, t / .003, (seconds - t) / .28);
          } else if (kind === 'win') {
            value = [261.63, 329.63, 392].reduce((sum, hz) => sum + Math.sin(t * Math.PI * 2 * hz), 0) *
              Math.min(1, t / .02) * Math.exp(-t / .12) * Math.min(1, (seconds - t) / .05);
          } else {
            const length = kind === 'step' ? .03 : .09;
            value = (low * 3 + white * .08) * Math.exp(-t / length) * Math.min(1, t / .006);
          }
          samples[i] = value;
          peak = Math.max(peak, Math.abs(value));
        }
        const scale = .8 / Math.max(.001, peak);
        for (let i = 0; i < samples.length; i++) samples[i] *= scale;
        if (kind === 'maze' || kind === 'carve') {
          // Match loop endpoints to avoid clicks at the buffer boundary.
          const blend = Math.round(ctx.sampleRate * .02);
          for (let i = 0; i < blend; i++) {
            const mix = i / blend;
            samples[samples.length - blend + i] = samples[samples.length - blend + i] * (1 - mix) + samples[i] * mix;
          }
        }
      }
      this.buffers.set(key, buffer);
      return buffer;
    }

    play(kind, { loop = false, volume = .12, variant = 0 } = {}) {
      const ctx = this.unlock();
      if (!ctx) return null;
      try {
        // Rapid touches cannot accumulate unbounded audio nodes or excessive level.
        const limit = kind === 'thunder' ? 3 : 4;
        const active = [...this.voices].filter(v => !v.stopping);
        while (active.length >= limit) this.stopVoice(active.shift(), .025);
        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        source.buffer = this.buffer(kind, variant);
        source.loop = loop;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(kind === 'maze' ? 500 : kind === 'carve' ? 4600 : kind === 'thunder' ? 3200 : 1700, ctx.currentTime);
        if (kind === 'thunder') filter.frequency.exponentialRampToValueAtTime(230, ctx.currentTime + 2.9);
        filter.Q.value = .45;
        const level = Math.min(.4, Math.max(0, volume)) / Math.sqrt(active.length + 1);
        const attack = kind === 'maze' ? 1.2 : kind === 'carve' ? .035 : .004;
        gain.gain.setValueAtTime(.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(.0001, level), ctx.currentTime + attack);
        source.connect(filter).connect(gain).connect(ctx.destination);
        const voice = { source, filter, gain, stopping: false };
        this.voices.add(voice);
        source.onended = () => {
          source.disconnect(); filter.disconnect(); gain.disconnect();
          this.voices.delete(voice);
          if (this.loopVoice === voice) this.loopVoice = null;
        };
        source.start();
        if (!loop) source.stop(ctx.currentTime + source.buffer.duration + .02);
        return voice;
      } catch (_) { return null; }
    }

    setLoop(wanted) {
      this.loopWanted = Boolean(wanted);
      if (!wanted || document.hidden) {
        if (this.loopVoice) this.stopVoice(this.loopVoice, .12);
        this.loopVoice = null;
        return;
      }
      if (!this.loopVoice) this.loopVoice = this.play(this.profile, {
        loop: true, volume: this.profile === 'maze' ? .035 : .14
      });
    }

    stopVoice(voice, fade = .08) {
      if (!voice || voice.stopping) return;
      voice.stopping = true;
      try {
        const at = this.context.currentTime;
        const param = voice.gain.gain;
        if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(at);
        else { param.cancelScheduledValues(at); param.setValueAtTime(Math.max(.0001, param.value), at); }
        param.exponentialRampToValueAtTime(.0001, at + fade);
        // A finite source already has a stop scheduled; replace it with the fade's end.
        voice.source.stop(at + fade + .01);
      } catch (_) {}
    }

    stopAll() {
      for (const voice of this.voices) this.stopVoice(voice);
      this.loopVoice = null;
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.loopWanted = false;
      this.stopAll();
      document.removeEventListener('visibilitychange', this.visibility);
      window.removeEventListener('pagehide', this.pageHide);
      window.removeEventListener('pageshow', this.pageShow);
      if (this.ownsContext) this.context?.close?.().catch(() => {});
      this.buffers.clear();
    }
  }
  window.PlayableSceneAudio = PlayableSceneAudio;
})();

;

;/* Current runtime segment: bundle.js */
(()=>{
  'use strict';

  const flattenConfig = raw => {
    const out = {};
    for (const section of ['tweaks', 'texts', 'images', 'motions']) {
      for (const item of raw[section] || []) {
        if (section === 'motions') {
          out[item.id + '_BASE'] = item.base_path;
          out[item.id + '_COUNT'] = item.frame_count;
        } else out[item.id] = item.value ?? item.path;
      }
    }
    return out;
  };

  const loadConfig = async () => {
    try {
      const response = await fetch('./game.config.json', { cache: 'no-store' });
      if (response.ok) return flattenConfig(await response.json());
    } catch (_) {}
    const inline = document.getElementById('playable-config-inline');
    return inline ? flattenConfig(JSON.parse(inline.textContent)) : {};
  };

  const start = async () => {
    const cfg = await loadConfig();
    const root = document.getElementById('root');
    const style = document.createElement('style');
    style.textContent = `
      :root { --ui-unit: min(0.2564102564vw, 0.1672240803vh); color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { background: #11151d; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
      .storm { position: relative; width: 100%; height: 100%; overflow: hidden; background: #11151d; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; cursor: crosshair; }
      .hud {
        position: absolute;
        z-index: 2;
        top: calc(30 * var(--ui-unit) + env(safe-area-inset-top));
        left: calc(30 * var(--ui-unit) + env(safe-area-inset-left));
        right: calc(30 * var(--ui-unit) + env(safe-area-inset-right));
        pointer-events: none;
        text-align: center;
        filter: drop-shadow(0 3px 12px rgba(0,0,0,.72));
      }
      .guide {
        max-width: 420px;
        margin: 0 auto;
        color: rgba(226,232,242,.72);
        font-size: calc(18 * var(--ui-unit));
        overflow-wrap: anywhere;
        font-weight: 600;
        line-height: 1.35;
        transition: opacity .35s ease, transform .35s ease;
      }
      .counter { display: flex; align-items: center; justify-content: center; gap: 8px; color: #eef3ff; font-size: calc(28 * var(--ui-unit)); line-height: 1.2; font-weight: 700; font-variant-numeric: tabular-nums; margin-bottom: 14px; }
      .counter svg { width: 19px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; }
      .storm-controls { position: absolute; z-index: 3; bottom: calc(50 * var(--ui-unit) + env(safe-area-inset-bottom)); left: calc(30 * var(--ui-unit) + env(safe-area-inset-left)); right: calc(30 * var(--ui-unit) + env(safe-area-inset-right)); display: flex; justify-content: center; gap: 12px; }
      .storm-control { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; min-width: 112px; padding: 10px 14px; border: 1px solid rgba(221,231,255,.38); border-radius: 24px; background: rgba(15,21,34,.88); color: #edf3ff; font: inherit; font-size: calc(18 * var(--ui-unit)); font-weight: 600; line-height: 1.25; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: background .15s ease, border-color .15s ease; }
      .storm-control svg { flex: 0 0 auto; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .storm-control[aria-pressed="true"] { background: #334264; border-color: #bed0f7; }
      .storm-control:active { background: #455779; }
      .storm-control:focus-visible { outline: 3px solid #d6e6ff; outline-offset: 4px; }
      .storm-control[aria-busy="true"] svg { opacity: .5; }
      .guide.hidden { opacity: 0; transform: translateY(-5px); }
      .storm[data-feed-preview="true"] .storm-controls,.storm[data-feed-preview="true"] .counter{visibility:hidden;pointer-events:none}
      .storm[data-feed-preview="true"] .counter{display:none}
      .storm[data-feed-preview="true"] .hud{top:18%}
      .tap-ripple {
        position: absolute;
        z-index: 2;
        width: 28px;
        height: 28px;
        border: 2px solid rgba(216,231,255,.85);
        border-radius: 50%;
        pointer-events: none;
        transform: translate(-50%, -50%) scale(.25);
        animation: ripple .55s ease-out forwards;
      }
      @keyframes ripple { to { opacity: 0; transform: translate(-50%, -50%) scale(3.2); } }
      @media (prefers-reduced-motion: reduce) {
        .tap-ripple { animation-duration: .2s; }
        .guide { transition-duration: .01ms; }
        .storm-control { transition-duration: .01ms; }
      }
    `;
    document.head.appendChild(style);

    root.innerHTML = `
      <main class="storm">
        <canvas id="sky" aria-label="Moving storm clouds. Tap anywhere to create lightning."></canvas>
        <header class="hud">
          <div class="counter" aria-label="0 strikes" id="strike-counter"><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M14 2 4 16h8l-2 10 10-15h-8z"/></svg><span id="strike-count">0</span></div>
          <p class="guide" id="guide"></p>
        </header>
        <nav class="storm-controls" aria-label="Storm options">
          <button type="button" class="storm-control" id="color-toggle" aria-pressed="false" aria-label="Colored lightning"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7z"/></svg><span>Color</span></button>
          <button type="button" class="storm-control" id="music-toggle" aria-pressed="false" aria-busy="false" aria-label="Rock music"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg><span id="music-label">Rock off</span></button>
        </nav>
      </main>
    `;

    const canvas = document.getElementById('sky');
    const ctx = canvas.getContext('2d', { alpha: false });
    const guide = document.getElementById('guide');
    const strikeCount = document.getElementById('strike-count');
    const strikeCounter = document.getElementById('strike-counter');
    const colorToggle = document.getElementById('color-toggle');
    const musicToggle = document.getElementById('music-toggle');
    const musicLabel = document.getElementById('music-label');
    guide.textContent = cfg.GUIDE_TEXT || 'Tap the clouds to call lightning';
    const storm=root.querySelector('.storm');
    let feedPreview=new URLSearchParams(location.search).has('review')||new URLSearchParams(location.search).get('feedReview')==='1';
    storm.dataset.feedPreview=String(feedPreview);
    let previewElapsed=0,previewPlayed=false;
    let previewVisible=false;
    const previewObserver=new IntersectionObserver(entries=>{previewVisible=entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>.1);},{threshold:[0,.1]});
    previewObserver.observe(storm);
    addEventListener('pagehide',()=>previewObserver.disconnect(),{once:true});
    addEventListener('message',e=>{
      if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='playable-active')return;
      feedPreview=e.data.active!==true;storm.dataset.feedPreview=String(feedPreview);
      if(!feedPreview){bolts=[];flash=0;}
    });

    const cloudSpeed = Math.max(.05, Number(cfg.CLOUD_SPEED) || .34);
    const cloudDensity = Math.max(8, Math.min(30, Math.round(Number(cfg.CLOUD_DENSITY) || 18)));
    const lightningGlow = Math.max(8, Number(cfg.LIGHTNING_GLOW) || 30);
    const configuredThunder = Number(cfg.THUNDER_VOLUME);
    const thunderVolume = Math.max(0, Math.min(.6, Number.isFinite(configuredThunder) ? configuredThunder : .28));
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let clouds = [];
    let bolts = [];
    let puffSprites = [];
    let lastFrame = performance.now();
    let flash = 0;
    let flashColor = [221, 234, 255];
    let strikes = 0;
    let colored = false;
    const lightningColors = [[161, 196, 255], [202, 149, 255], [255, 145, 217], [138, 232, 238], [255, 202, 125]];
    let lastColor = -1;
    const muted = false;
    let audio = null;
    let thunderSound = null;
    let thunderIndex = 0;
    let rainBuffer = null;
    let rainSource = null;
    let rainGain = null;
    let hasInteracted = false;
    let rockMusic = null;
    let musicWanted = false;
    let musicRevision = 0;
    let musicFrame = null;

    const seeded = seed => {
      let value = seed >>> 0;
      return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 4294967296;
      };
    };

    const makePuffSprite = (depth, shadow = false) => {
      const sprite = document.createElement('canvas');
      sprite.width = 768;
      sprite.height = 768;
      const g = sprite.getContext('2d');
      const base = depth === 0 ? 155 : depth === 1 ? 125 : 92;
      const center = sprite.width / 2;
      const gradient = g.createRadialGradient(center, center * .86, 5, center, center, center);
      if (shadow) {
        const low = Math.max(12, base - 72);
        gradient.addColorStop(0, 'rgba(' + low + ',' + (low + 6) + ',' + (low + 16) + ',.34)');
        gradient.addColorStop(.48, 'rgba(' + low + ',' + (low + 6) + ',' + (low + 16) + ',.2)');
        gradient.addColorStop(.78, 'rgba(' + low + ',' + (low + 6) + ',' + (low + 16) + ',.055)');
      } else {
        const lift = Math.min(228, base + 42);
        gradient.addColorStop(0, 'rgba(' + lift + ',' + (lift + 5) + ',' + Math.min(244, lift + 14) + ',.9)');
        gradient.addColorStop(.46, 'rgba(' + base + ',' + (base + 5) + ',' + (base + 14) + ',.66)');
        gradient.addColorStop(.78, 'rgba(' + Math.max(18, base - 55) + ',' + Math.max(22, base - 48) + ',' + Math.max(30, base - 35) + ',.12)');
      }
      gradient.addColorStop(1, 'rgba(15,19,28,0)');
      g.fillStyle = gradient;
      g.fillRect(0, 0, sprite.width, sprite.height);
      return sprite;
    };

    const buildSprites = () => {
      puffSprites = Array.from({ length: 3 }, (_, depth) => ({
        light: makePuffSprite(depth, false),
        shadow: makePuffSprite(depth, true)
      }));
    };

    const makeCloudPuffs = seed => {
      const random = seeded(seed);
      const puffs = [];
      for (let i = 0; i < 7; i++) {
        puffs.push({
          shadow: true,
          x: .1 + random() * .8,
          y: .56 + random() * .22,
          w: .25 + random() * .2,
          h: .48 + random() * .24
        });
      }
      for (let i = 0; i < 16; i++) {
        puffs.push({
          shadow: false,
          x: .06 + random() * .88,
          y: .19 + random() * .5,
          w: .2 + random() * .24,
          h: .48 + random() * .4
        });
      }
      return puffs;
    };

    const createCloud = (index, randomX = true) => {
      const depth = index % 3;
      const scale = (.72 + Math.random() * .62) * (depth === 0 ? .8 : depth === 1 ? 1 : 1.2);
      return {
        depth,
        x: randomX ? Math.random() * (width + 500) - 250 : -650,
        y: height * (.12 + Math.random() * .66),
        w: 420 * scale,
        h: 184 * scale,
        speed: (9 + depth * 7 + Math.random() * 8) * cloudSpeed * (reducedMotion ? .45 : 1),
        opacity: depth === 0 ? .36 : depth === 1 ? .5 : .66,
        drift: Math.random() * Math.PI * 2,
        puffs: makeCloudPuffs(Math.floor(Math.random() * 1000000000))
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (!puffSprites.length) buildSprites();
      clouds = Array.from({ length: cloudDensity }, (_, index) => createCloud(index, true));
      clouds.sort((a, b) => a.depth - b.depth);
    };

    const drawSky = time => {
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#111723');
      sky.addColorStop(.42, '#252a35');
      sky.addColorStop(.72, '#3a3a43');
      sky.addColorStop(1, '#171a22');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      const twilight = ctx.createRadialGradient(width * .5, height * .64, 0, width * .5, height * .64, width * .78);
      twilight.addColorStop(0, 'rgba(198,202,213,.13)');
      twilight.addColorStop(.48, 'rgba(119,125,140,.07)');
      twilight.addColorStop(1, 'rgba(20,23,31,0)');
      ctx.fillStyle = twilight;
      ctx.fillRect(0, 0, width, height);

      const mist = ctx.createLinearGradient(0, height * .68, 0, height);
      mist.addColorStop(0, 'rgba(18,22,31,0)');
      mist.addColorStop(.56, 'rgba(13,17,24,.19)');
      mist.addColorStop(1, 'rgba(7,10,15,.58)');
      ctx.fillStyle = mist;
      ctx.fillRect(0, height * .68, width, height * .32);
    };

    const drawClouds = (dt, time) => {
      for (const cloud of clouds) {
        cloud.x += cloud.speed * dt;
        if (cloud.x > width + cloud.w * .55) {
          const fresh = createCloud(cloud.depth, false);
          Object.assign(cloud, fresh, { depth: cloud.depth, x: -fresh.w * .72 });
        }
        const bob = Math.sin(time * .00018 + cloud.drift) * (3 + cloud.depth * 2);
        ctx.save();
        ctx.globalAlpha = cloud.opacity;
        for (const puff of cloud.puffs) {
          const puffWidth = cloud.w * puff.w;
          const puffHeight = cloud.h * puff.h;
          const puffX = cloud.x - cloud.w / 2 + cloud.w * puff.x - puffWidth / 2;
          const puffY = cloud.y - cloud.h / 2 + bob + cloud.h * puff.y - puffHeight / 2;
          const sprite = puff.shadow ? puffSprites[cloud.depth].shadow : puffSprites[cloud.depth].light;
          ctx.drawImage(sprite, puffX, puffY, puffWidth, puffHeight);
        }
        ctx.restore();
      }
    };

    const makePath = (startX, startY, endX, endY, segments, spread) => {
      const points = [{ x: startX, y: startY }];
      for (let i = 1; i < segments; i++) {
        const progress = i / segments;
        const center = startX + (endX - startX) * progress;
        const taper = Math.sin(progress * Math.PI);
        points.push({
          x: center + (Math.random() - .5) * spread * taper,
          y: startY + (endY - startY) * progress
        });
      }
      points.push({ x: endX, y: endY });
      return points;
    };

    const createBolt = (x, y) => {
      // Crop the bolt at the viewport, not at its visible rounded endpoints.
      const overflow = Math.max(100, height * .16, lightningGlow * 3);
      const endY = height + overflow;
      const startY = -overflow;
      const startX = Math.max(18, Math.min(width - 18, x + (Math.random() - .5) * 92));
      const main = makePath(startX, startY, x, endY, 15, Math.min(132, width * .32));
      const branches = [];
      for (let i = 2; i < main.length - 2; i += 2) {
        if (Math.random() < .88) {
          const point = main[i];
          const direction = Math.random() < .5 ? -1 : 1;
          branches.push(makePath(point.x, point.y, point.x + direction * (45 + Math.random() * 100), point.y + 75 + Math.random() * 115, 6, 44));
        }
      }
      let color = [177, 211, 255];
      if (colored) {
        // Vary new strikes without recoloring bolts that are already fading.
        lastColor = (lastColor + 1 + Math.floor(Math.random() * (lightningColors.length - 1))) % lightningColors.length;
        color = lightningColors[lastColor];
      }
      bolts.push({ main, branches, color, colored, born: performance.now(), duration: 620 });
      flashColor = color.map(channel => Math.round(channel * .45 + 255 * .55));
      flash = 1;
    };

    const strokePath = points => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    };

    const drawBolts = now => {
      bolts = bolts.filter(bolt => now - bolt.born < bolt.duration);
      for (const bolt of bolts) {
        const age = now - bolt.born;
        const fade = Math.max(0, 1 - age / bolt.duration);
        const flicker = age < 110 ? 1 : .48 + Math.abs(Math.sin(age * .055)) * .45;
        const alpha = fade * flicker;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const tint = bolt.color.join(',');
        const core = bolt.color.map(channel => Math.round(channel * .3 + 255 * .7)).join(',');
        ctx.shadowColor = 'rgba(' + tint + ',' + alpha + ')';
        ctx.shadowBlur = lightningGlow * 1.45;
        ctx.strokeStyle = 'rgba(' + tint + ',' + (alpha * .42) + ')';
        ctx.lineWidth = 15;
        strokePath(bolt.main);
        ctx.strokeStyle = 'rgba(' + (bolt.colored ? core : '236,246,255') + ',' + alpha + ')';
        ctx.lineWidth = 4.2;
        strokePath(bolt.main);
        for (const branch of bolt.branches) {
          ctx.strokeStyle = 'rgba(' + core + ',' + (alpha * .72) + ')';
          ctx.lineWidth = 2.1;
          strokePath(branch);
        }
        ctx.restore();
      }
    };

    const drawFlash = dt => {
      if (flash <= .002) return;
      ctx.fillStyle = 'rgba(' + flashColor.join(',') + ',' + (flash * (reducedMotion ? .09 : .34)) + ')';
      ctx.fillRect(0, 0, width, height);
      flash *= Math.pow(.075, dt);
    };

    const frame = now => {
      const dt = Math.min(.04, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      if(!document.hidden&&previewVisible&&feedPreview&&!previewPlayed&&!reducedMotion){
        previewElapsed+=dt*1000;
        if(previewElapsed>=900){previewPlayed=true;createBolt(width*.48,height*.5);storm.dataset.previewStrikes='1';}
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSky(now);
      drawClouds(dt, now);
      drawBolts(now);
      drawFlash(dt);
      requestAnimationFrame(frame);
    };

    const ensureAudio = () => {
      try {
        if (!audio) {
          const AudioCtor = window.AudioContext || window.webkitAudioContext;
          if (AudioCtor) audio = new AudioCtor();
        }
        if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
      } catch (_) { audio = null; }
    };

    const makeRainBuffer = () => {
      const seconds = 3;
      const length = Math.round(audio.sampleRate * seconds);
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const samples = buffer.getChannelData(0);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        low = low * .985 + white * .015;
        samples[i] = (white - low) * .42 + low * .18;
      }
      for (let drop = 0; drop < 85; drop++) {
        const start = Math.floor(Math.random() * (length - audio.sampleRate * .04));
        const frequency = 650 + Math.random() * 850;
        const duration = Math.floor(audio.sampleRate * .035);
        for (let i = 0; i < duration; i++) {
          samples[start + i] += Math.sin(2 * Math.PI * frequency * i / audio.sampleRate) * Math.exp(-i / (audio.sampleRate * .007)) * .28;
        }
      }
      return buffer;
    };

    const stopRain = () => {
      if (!rainSource || !audio) return;
      const source = rainSource, gain = rainGain, at = audio.currentTime;
      rainSource = null;
      rainGain = null;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(Math.max(.0001, gain.gain.value), at);
      gain.gain.exponentialRampToValueAtTime(.0001, at + .2);
      source.stop(at + .22);
    };

    const startRain = () => {
      if (muted || !hasInteracted || document.hidden || rainSource) return;
      ensureAudio();
      if (!audio) return;
      try {
        rainBuffer = rainBuffer || makeRainBuffer();
        const source = audio.createBufferSource();
        const highpass = audio.createBiquadFilter();
        const lowpass = audio.createBiquadFilter();
        const gain = audio.createGain();
        source.buffer = rainBuffer;
        source.loop = true;
        highpass.type = 'highpass';
        highpass.frequency.value = 280;
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 6200;
        gain.gain.setValueAtTime(.0001, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(.055, audio.currentTime + .45);
        source.connect(highpass).connect(lowpass).connect(gain).connect(audio.destination);
        source.onended = () => { source.disconnect(); highpass.disconnect(); lowpass.disconnect(); gain.disconnect(); };
        source.start();
        rainSource = source;
        rainGain = gain;
      } catch (_) {}
    };

    const thunder = () => {
      if (muted || thunderVolume <= 0 || document.hidden) return;
      ensureAudio();
      if (!audio || !window.PlayableSceneAudio) return;
      if (!thunderSound) thunderSound = new window.PlayableSceneAudio({ profile: 'thunder', context: audio });
      thunderSound.play('thunder', { volume: thunderVolume, variant: thunderIndex++ % 2 });
    };

    const updateMusicControl = (busy = false) => {
      musicToggle.setAttribute('aria-pressed', String(musicWanted));
      musicToggle.setAttribute('aria-busy', String(busy));
      musicLabel.textContent = busy ? 'Loading…' : musicWanted ? 'Rock on' : 'Rock off';
    };

    const cancelMusicFade = () => {
      if (musicFrame !== null) cancelAnimationFrame(musicFrame);
      musicFrame = null;
    };

    const fadeMusic = (target, finished) => {
      cancelMusicFade();
      if (!rockMusic) return;
      const from = rockMusic.volume, started = performance.now();
      const tick = now => {
        if (!rockMusic) return;
        const fraction = Math.max(0, Math.min(1, (now - started) / 350));
        rockMusic.volume = Math.max(0, Math.min(1, from + (target - from) * fraction));
        if (fraction < 1) musicFrame = requestAnimationFrame(tick);
        else { musicFrame = null; finished?.(); }
      };
      musicFrame = requestAnimationFrame(tick);
    };

    const pauseMusic = () => {
      cancelMusicFade();
      if (rockMusic) { rockMusic.volume = 0; rockMusic.pause(); }
    };

    const musicFailed = revision => {
      if (revision !== musicRevision || !musicWanted || document.hidden) return;
      musicWanted = false;
      musicRevision++;
      pauseMusic();
      updateMusicControl();
      musicToggle.setAttribute('aria-label', 'Rock music unavailable. Tap to retry');
    };

    const startMusic = () => {
      if (!musicWanted || document.hidden) return;
      const revision = musicRevision;
      try {
        if (!rockMusic) {
          if (!window.Audio) { musicFailed(revision); return; }
          rockMusic = new window.Audio('./assets/audio/rock-theme-song-loop.mp3');
          rockMusic.loop = true;
          rockMusic.preload = 'none';
          rockMusic.volume = 0;
          rockMusic.addEventListener('error', () => musicFailed(musicRevision));
        }
        if (rockMusic.error) rockMusic.load();
        updateMusicControl(true);
        const playing = rockMusic.play();
        Promise.resolve(playing).then(() => {
          if (!musicWanted || document.hidden) { pauseMusic(); return; }
          if (revision !== musicRevision) return;
          musicToggle.setAttribute('aria-label', 'Rock music');
          updateMusicControl();
          fadeMusic(.3);
        }).catch(() => musicFailed(revision));
      } catch (_) { musicFailed(revision); }
    };

    colorToggle.addEventListener('click', () => {
      colored = !colored;
      colorToggle.setAttribute('aria-pressed', String(colored));
    });
    musicToggle.addEventListener('click', () => {
      musicWanted = !musicWanted;
      musicRevision++;
      updateMusicControl();
      if (musicWanted) startMusic();
      else fadeMusic(0, () => { if (!musicWanted) { rockMusic.pause(); rockMusic.currentTime = 0; } });
    });

    const ripple = (x, y) => {
      const el = document.createElement('div');
      el.className = 'tap-ripple';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      root.querySelector('.storm').appendChild(el);
      setTimeout(() => el.remove(), 620);
    };

    canvas.addEventListener('pointerdown', event => {
      if (feedPreview || event.isPrimary === false || event.button > 0) return;
      hasInteracted = true;
      startRain();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      createBolt(x, y);
      strikes++;
      strikeCount.textContent = String(strikes);
      strikeCounter.setAttribute('aria-label', strikes + (strikes === 1 ? ' strike' : ' strikes'));
      ripple(x, y);
      guide.classList.add('hidden');
      guide.setAttribute('aria-hidden', 'true');
      thunder();
      if (navigator.vibrate) navigator.vibrate(22);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { stopRain(); pauseMusic(); }
      else { startRain(); startMusic(); }
    });

    window.addEventListener('pagehide', stopRain);
    window.addEventListener('pagehide', pauseMusic);
    window.addEventListener('pageshow', startRain);
    window.addEventListener('pageshow', startMusic);
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  };

  start();
})();

;

;/* Current runtime segment: guide-breathing.js */
/* Decorative guide visibility only: no inputs, timers, sound or game state. */
(() => {
  const root=document.documentElement;
  let intersecting=true;
  const update=()=>root.toggleAttribute('data-guide-breathing-paused',document.hidden||!intersecting);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    intersecting=entries.some(entry=>entry.isIntersecting);update();
  }):null;
  if(document.body)observer?.observe(document.body);
  document.addEventListener('visibilitychange',update);update();
  window.addEventListener('pagehide',()=>{observer?.disconnect();document.removeEventListener('visibilitychange',update);},{once:true});
})();

;

;/* Current runtime segment: feed-entry-motion.js */
var __PLAYABLE_TEMPLATE_SCRIPT_5=(()=>{var node=document.createElement("script");for(var entry of Object.entries({"defer":"","src":"./feed-entry-motion.js?v=feed-first-20261008-1","data-subject":"#root canvas"}))node.setAttribute(entry[0],entry[1]);return node;})();
/* Decorative entry motion only. No game state, audio, timers or synthetic input. */
(function () {
  'use strict';
  const script = __PLAYABLE_TEMPLATE_SCRIPT_5;
  const selector = script?.getAttribute('data-subject') || '#root canvas';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let observer, animation, entered = false;
  function stop() { animation?.cancel(); animation = null; }
  function enter() {
    if (entered || document.hidden) return;
    const subject = document.querySelector(selector);
    if (!subject || subject.closest('[hidden], [aria-hidden="true"]')) return;
    const computed = window.getComputedStyle(subject);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (subject.tagName === 'IMG' && !subject.complete) {
      subject.addEventListener('load', enter, { once: true });
      return;
    }
    entered = true;
    observer?.disconnect();
    if (media?.matches) return;
    const opacity = Number(window.getComputedStyle(subject).opacity) || 1;
    if (typeof subject.animate === 'function') {
      animation = subject.animate([{ opacity: opacity * .76 }, { opacity }], { duration: 650, easing: 'ease-out' });
      animation.onfinish = () => { animation = null; };
    }
  }
  observer = new MutationObserver(enter);
  observer.observe(document.body, { childList: true, subtree: true });
  enter();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-feed-background', document.hidden);
    if (document.hidden) stop(); else enter();
  });
  window.addEventListener('pagehide', () => { observer.disconnect(); stop(); });
  window.addEventListener('pageshow', () => {
    if (!entered) observer.observe(document.body, { childList: true, subtree: true });
    enter();
  });
  document.addEventListener('pointerdown', stop, { capture: true, passive: true });
  media?.addEventListener?.('change', () => { if (media.matches) stop(); });
})();

;
