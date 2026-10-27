import {Box3, DynamicDrawUsage, Group, Mesh, Vector3} from 'three';
import {FISH_LENGTH} from './fish-flop-state.js';
const noRaycast = () => {};

/** Clone the generated geometry so no shared GLTF asset is deformed. */
export function createFishModel(scene) {
  scene.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(scene), size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  if (bounds.isEmpty() || !(size.x > 0)) throw new Error('The kitchen fish has no visible geometry.');
  const scale = FISH_LENGTH / Math.max(size.x, size.z);
  const object = new Group();object.name = 'flopping-fish';
  const meshes = [], materials = [];
  scene.traverse(node => {
    if (!node.isMesh) return;
    const geometry = node.geometry.clone();geometry.applyMatrix4(node.matrixWorld);
    geometry.translate(-center.x, -center.y, -center.z);geometry.scale(scale, scale, scale);
    geometry.attributes.position.setUsage(DynamicDrawUsage);
    geometry.attributes.normal?.setUsage(DynamicDrawUsage);
    const own = material => {const clone = material.clone();materials.push(clone);return clone;};
    const mesh = new Mesh(geometry, Array.isArray(node.material) ? node.material.map(own) : own(node.material));
    mesh.name = 'fish-body';mesh.castShadow = true;mesh.receiveShadow = true;mesh.raycast = noRaycast;mesh.frustumCulled = false;
    object.add(mesh);
    meshes.push({mesh, geometry, positions: geometry.attributes.position.array.slice(), normals: geometry.attributes.normal?.array.slice()});
  });
  return {object, meshes, materials, length: size.x * scale};
}

/** Bend positions and normals together, and support the rotated fish above its surface. */
export function updateFishModel(models, motion, elapsed) {
  models.object.rotation.set(motion.roll, motion.yaw, motion.pitch);models.object.updateMatrix();
  const rotation = models.object.matrix.elements;
  let lowest = Infinity;
  for (const {geometry, positions, normals} of models.meshes) {
    const target = geometry.attributes.position.array, targetNormal = geometry.attributes.normal?.array;
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index], y = positions[index + 1], z = positions[index + 2];
      const tail = Math.max(0, Math.min(1, .5 - x / models.length)), weight = tail * tail;
      const wave = elapsed * 34 + x * 7 / models.length;
      const dy = motion.bend * weight * Math.sin(wave), dz = motion.bend * .35 * weight * Math.cos(wave);
      target[index] = x;target[index + 1] = y + dy;target[index + 2] = z + dz;
      lowest = Math.min(lowest, rotation[1] * x + rotation[5] * target[index + 1] + rotation[9] * target[index + 2]);
      if (targetNormal && normals) {
        const dw = -2 * tail / models.length;
        const slopeY = motion.bend * (dw * Math.sin(wave) + weight * Math.cos(wave) * 7 / models.length);
        const slopeZ = motion.bend * .35 * (dw * Math.cos(wave) - weight * Math.sin(wave) * 7 / models.length);
        const nx = normals[index] - slopeY * normals[index + 1] - slopeZ * normals[index + 2], ny = normals[index + 1], nz = normals[index + 2];
        const length = Math.hypot(nx, ny, nz) || 1;
        targetNormal[index] = nx / length;targetNormal[index + 1] = ny / length;targetNormal[index + 2] = nz / length;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    if (targetNormal) geometry.attributes.normal.needsUpdate = true;
  }
  // Support the rotated/deformed mesh on the counter or floor, rather than
  // letting a roll or tail bend push it through the surface underneath.
  models.object.position.set(motion.x, motion.y - lowest, motion.z);
  models.object.updateMatrixWorld(true);
}
