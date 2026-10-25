import {MathUtils, PropertyBinding, Quaternion, Vector3} from 'three';

const identity = new Quaternion();

function targetNode(scene, binding) {
  let node = PropertyBinding.findNode(scene, binding.nodeName);
  if (!node || !binding.objectName) return node;
  if (binding.objectName !== 'bones') return null;
  const index = binding.objectIndex;
  if (node.skeleton) {
    node = node.skeleton.getBoneByName(index) || node.skeleton.bones[Number(index)];
  } else {
    node = node.getObjectByName(index);
  }
  return node || null;
}

function normalizedQuaternion(values, offset, fallback) {
  const q = new Quaternion().fromArray(values, offset);
  if (![q.x, q.y, q.z, q.w].every(Number.isFinite) || q.lengthSq() < 1e-12) return fallback.clone();
  return q.normalize();
}

function flipQuaternion(q) {
  return q.set(-q.x, -q.y, -q.z, -q.w);
}

/**
 * Transfer Tripo's motion deltas onto the fitted capybara rest pose.
 * Call before a mixer poses `scene`: its local bone transforms are the target
 * rest pose. The input clip, track arrays, scene and skeleton remain untouched.
 * This corrects the animation's pose offset; it does not change skin weights.
 */
export function correctCapybaraClip(clip, scene, {motion = 'walk', strength = 1} = {}) {
  const corrected = clip.clone();
  corrected.name = `${clip.name || motion}-capybara-corrected`;
  if (!scene) return corrected;
  const amount = MathUtils.clamp(Number.isFinite(strength) ? strength : 1, 0, 1);

  corrected.tracks = corrected.tracks.filter(track => {
    let binding;
    try {binding = PropertyBinding.parseTrackName(track.name);} catch {return true;}
    const property = binding.propertyName;
    if (!['quaternion', 'position', 'scale'].includes(property) || binding.propertyIndex !== undefined) return true;
    const node = targetNode(scene, binding);
    if (!node) return false;
    if (!node.isBone) return true;

    const width = property === 'quaternion' ? 4 : 3;
    const count = track.times.length;
    // Tripo exports ordinary STEP/LINEAR tracks. Preserve unfamiliar packed
    // formats (for example glTF cubic-spline tangents) instead of corrupting them.
    if (!count || track.values.length !== count * width) return true;
    const values = track.values;
    const start = track.times[0], duration = track.times[count - 1] - start;
    const progress = index => duration > 0 ? (track.times[index] - start) / duration : 0;

    if (property === 'quaternion') {
      const rest = node.quaternion.clone().normalize();
      const firstInverse = normalizedQuaternion(values, 0, rest).invert();
      const finalDelta = firstInverse.clone().multiply(normalizedQuaternion(values, (count - 1) * 4, rest)).normalize();
      if (finalDelta.w < 0) flipQuaternion(finalDelta);
      const closingRotation = finalDelta.invert();
      let previous = null;
      for (let i = 0; i < count; i++) {
        const source = normalizedQuaternion(values, i * 4, rest);
        const delta = firstInverse.clone().multiply(source).normalize();
        // Remove residual cycle drift so the final key meets the first key.
        delta.multiply(identity.clone().slerp(closingRotation, progress(i))).normalize();
        const q = rest.clone().multiply(identity.clone().slerp(delta, amount)).normalize();
        if (previous && previous.dot(q) < 0) flipQuaternion(q);
        q.toArray(values, i * 4);
        previous = q;
      }
    } else if (property === 'position') {
      const rest = node.position;
      const first = new Vector3().fromArray(values, 0);
      const drift = new Vector3().fromArray(values, (count - 1) * 3).sub(first);
      for (let i = 0; i < count; i++) {
        const value = new Vector3().fromArray(values, i * 3).sub(first).addScaledVector(drift, -progress(i));
        value.multiplyScalar(amount).add(rest).toArray(values, i * 3);
      }
    } else {
      // Keep the fitted proportions and avoid scale noise accumulating through
      // 78 nested bones or while cross-fading idle and walking clips.
      for (let i = 0; i < count; i++) node.scale.toArray(values, i * 3);
    }
    return true;
  });
  return corrected;
}
