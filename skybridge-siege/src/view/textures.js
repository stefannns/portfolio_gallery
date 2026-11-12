import * as THREE from 'three';

/** Inked dashes for the attack lane on the floor. White fill, so the material can tint them. */
export function laneTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#201714';
  ctx.fillStyle = '#ffffff';
  for (let y = 10; y < canvas.height - 40; y += 62) {
    ctx.beginPath();
    ctx.roundRect(14, y, canvas.width - 28, 36, 10);
    ctx.fill();
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
