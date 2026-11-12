// Video-backed art. The Warden clips and the starfield are mp4 files generated with
// MiniMax; each one becomes a THREE.VideoTexture that the game plays like a sprite.

import * as THREE from 'three';

/** Loads an mp4 as a texture. Returns null when the file is missing, so a checkout
 *  without the generated art still runs. */
export function createVideoClip(url, { loop = true } = {}) {
  const video = document.createElement('video');
  video.src = url;
  video.loop = loop;
  video.muted = true; // muted autoplay is allowed, and the clips have no useful audio
  video.playsInline = true;
  video.preload = 'auto';

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const clip = {
    url,
    video,
    texture,
    ready: false,
    failed: false,
    lastTry: 0,
    start() {
      if (clip.failed) return;
      video.play().catch(error => {
        // AbortError only means another clip took over before this one started.
        if (error?.name !== 'AbortError') console.warn('[clip] play rejected', url, error && error.name, error && error.message);
      }); // needs a user gesture the first time
    },
    /** Keeps the decoder alive; browsers can pause hidden videos on their own. */
    update() {
      if (clip.failed) return;
      if (video.readyState >= 2 && video.paused && !video.ended) {
        const now = performance.now();
        if (now - clip.lastTry < 1000) return; // play() needs a gesture, so retry once a second
        clip.lastTry = now;
        video.play().catch(error => {
          // AbortError only means another clip took over before this one started.
        if (error?.name !== 'AbortError') console.warn('[clip] play rejected', url, error && error.name, error && error.message);
        });
      }
    },
  };

  video.addEventListener('loadeddata', () => { clip.ready = true; }, { once: true });
  video.addEventListener('error', () => {
    clip.failed = true;
    console.warn('[clip] load error', url, video.error && video.error.code, video.error && video.error.message);
  }, { once: true });
  return clip;
}

/**
 * A green-screen video cut out in the shader and drawn over a fill image: the see-through
 * comic middle of the player's shield and the Warden's ward. `flash` pushes it toward white.
 */
export function keyedVideoMaterial(video, fill, { depthTest = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: video }, fill: { value: fill }, opacity: { value: 0 }, flash: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform sampler2D fill;
      uniform float opacity;
      uniform float flash;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        float strongest = max(c.r, c.b);
        // The key, tightened to about a screen pixel: the video's soft, chroma-subsampled edge
        // would otherwise draw a blurred rim round the art. fwidth keeps it a pixel wide at any size.
        float greenness = c.g - strongest;
        float edge = max(fwidth(greenness), 0.02);
        float a = 1.0 - smoothstep(0.16 - edge, 0.16 + edge, greenness);
        vec3 art = vec3(c.r, min(c.g, strongest), c.b);
        vec4 f = texture2D(fill, vUv);
        float outA = a + f.a * (1.0 - a);
        vec3 rgb = (art * a + f.rgb * f.a * (1.0 - a)) / max(outA, 0.0001);
        gl_FragColor = vec4(mix(rgb, vec3(1.0), flash), outA * opacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthTest,
    side: THREE.DoubleSide,
  });
}

/** A set of clips with one of them playing at a time. */
export class ClipPlayer {
  constructor(clips) {
    this.clips = clips;
    this.name = null;
    this.clip = null;
    this.window = { from: 0, to: null, rate: 1 };
    this.held = false;
  }

  get available() {
    return Object.values(this.clips).some(clip => clip && !clip.failed);
  }

  /** Plays a clip, optionally between two timestamps and at a set speed, holding the last frame after. */
  play(name, { from = 0, to = null, rate = 1 } = {}) {
    const clip = this.clips[name];
    if (!clip || clip.failed) return false;
    if (this.name === name && this.window.from === from && this.window.to === to && this.window.rate === rate) return true;
    if (this.clip && this.clip !== clip) this.clip.video.pause();
    this.name = name;
    this.clip = clip;
    this.window = { from, to, rate };
    this.held = false;
    clip.video.loop = to === null;
    clip.video.currentTime = from;
    clip.video.playbackRate = rate;
    clip.start();
    return true;
  }

  stop() {
    this.clip?.video.pause();
    this.name = null;
    this.clip = null;
  }

  update() {
    const clip = this.clip;
    if (!clip || this.held) return; // a held frame must not be restarted by the keep-alive
    clip.update();
    const { to } = this.window;
    if (to !== null && !clip.video.loop && clip.video.currentTime >= to) {
      // Pause where it is. Seeking here would land on frame 0 from a server without range
      // requests, which includes python3 -m http.server.
      clip.video.pause();
      this.held = true;
    }
  }
}
