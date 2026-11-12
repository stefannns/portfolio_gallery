// A sea of cartoon clouds far below the sky bridge (assets/scene/cloud-sea.jpg, a seamless
// tile), so the open sides of the bridge look down onto something. It drifts slowly toward the
// player and fades out with distance into the painted sky behind it, so it has no edge.

import * as THREE from 'three';

const BELOW = 40; // metres under the deck
const TILE = 150; // metres per repeat of the tile: clouds some 35 m across
const DRIFT = 1.5; // metres a second
const FADE = [120, 250]; // metres from the player: fully there, then gone (the camera sees 260)
const HAZE = new THREE.Color().setStyle('#fb8137', THREE.SRGBColorSpace); // the sky's horizon orange

export function createCloudSea(scene, url = './assets/scene/cloud-sea.jpg') {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  const uniforms = { map: { value: texture }, drift: { value: 0 }, haze: { value: HAZE } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float drift;
      uniform vec3 haze;
      varying vec3 vWorld;
      void main() {
        vec3 c = texture2D(map, vec2(vWorld.x, vWorld.z - drift) / ${TILE.toFixed(1)}).rgb;
        float distance = length(vWorld.xz - cameraPosition.xz);
        // Further clouds take on the evening glow, then thin out into the sky.
        c = mix(c, haze, 0.4 * smoothstep(60.0, ${FADE[1].toFixed(1)}, distance));
        float alpha = 1.0 - smoothstep(${FADE[0].toFixed(1)}, ${FADE[1].toFixed(1)}, distance);
        gl_FragColor = vec4(c, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * FADE[1], 2 * FADE[1]), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, -BELOW, 0);
  mesh.renderOrder = -5; // under everything else that blends
  scene.add(mesh);

  return {
    mesh,
    update(now = performance.now()) {
      uniforms.drift.value = ((now / 1000) * DRIFT) % TILE;
    },
  };
}
