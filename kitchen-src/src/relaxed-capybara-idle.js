import {Float32BufferAttribute, MathUtils, Matrix3, Matrix4, PropertyBinding, Quaternion, Vector3} from 'three';

const down = new Vector3(0, -1, 0);
// Ease the upper arms only a little so the sleeves retain their shoulder shape.
const sideAngles = {L: {Upperarm: 12, Forearm: 16}, R: {Upperarm: 7, Forearm: 10}};
const pawName = side => new RegExp(`^${side}_(Hand|Thumb|Index|Mid|Ring|Pinky)`);
const armName = /^(L|R)_(Upperarm|Forearm|Elbow|Hand|Thumb|Index|Mid|Ring|Pinky)/;

function skinMatrix(mesh, index, target) {
  const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
  const boneMatrix = new Matrix4();
  target.elements.fill(0);
  for (let slot = 0; slot < 4; slot++) {
    const weight = weights.getComponent(index, slot);
    if (!weight) continue;
    const joint = indices.getComponent(index, slot);
    boneMatrix.multiplyMatrices(mesh.skeleton.bones[joint].matrixWorld, mesh.skeleton.boneInverses[joint]);
    for (let element = 0; element < 16; element++) target.elements[element] += boneMatrix.elements[element] * weight;
  }
  return target.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
}

function pawRegion(scene, side) {
  const names = pawName(side), samples = [], center = new Vector3(), point = new Vector3();
  let total = 0;
  scene.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const weights = mesh.geometry.attributes.skinWeight, indices = mesh.geometry.attributes.skinIndex;
    for (let index = 0; index < weights.count; index++) {
      let weight = 0;
      for (let slot = 0; slot < 4; slot++) if (names.test(mesh.skeleton.bones[indices.getComponent(index, slot)]?.name || '')) weight += weights.getComponent(index, slot);
      if (weight <= .55) continue;
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      center.addScaledVector(point, weight);total += weight;
      samples.push({mesh, index, weight});
    }
  });
  return total ? {center: center.divideScalar(total), samples, total} : null;
}

function currentPawCenter(region) {
  const center = new Vector3(), point = new Vector3();
  for (const {mesh, index, weight} of region.samples) center.addScaledVector(mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld), weight);
  return center.divideScalar(region.total);
}

/**
 * Relax just the idle pose. Walking retains its existing clip, rest transforms,
 * geometry positions, and skin weights. World-space axes come from the fitted
 * paw regions; the asymmetric fitted rig needs different left/right angles.
 */
export function createRelaxedCapybaraIdle(correctedIdle, scene) {
  const clip = correctedIdle.clone();
  clip.name = `${correctedIdle.name}-hands-down`;
  scene.updateMatrixWorld(true);
  const bones = [], meshes = [], saved = new Map(), corrections = new Map();
  scene.traverse(node => {
    if (node.isBone) {bones.push(node);saved.set(node, {quaternion: node.quaternion.clone(), position: node.position.clone()});}
    if (node.isSkinnedMesh) meshes.push(node);
  });
  const reference = new Map(), point = new Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (const mesh of meshes) {
    const positions = [], matrices = [];
    for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
      positions.push(mesh.getVertexPosition(index, new Vector3()));
      matrices.push(skinMatrix(mesh, index, new Matrix4()));
      point.copy(positions[index]).applyMatrix4(mesh.matrixWorld);minY = Math.min(minY, point.y);maxY = Math.max(maxY, point.y);
    }
    reference.set(mesh, {positions, matrices});
  }
  const regions = {L: pawRegion(scene, 'L'), R: pawRegion(scene, 'R')};
  const report = {arms: {}, bodyCorrective: true};

  for (const side of ['L', 'R']) {
    const upper = scene.getObjectByName(`${side}_Upperarm`), forearm = scene.getObjectByName(`${side}_Forearm`), region = regions[side];
    if (!upper || !forearm || !region) continue;
    const outward = region.center.clone().sub(upper.getWorldPosition(new Vector3()));
    outward.y = 0;
    const axis = outward.normalize().cross(down).normalize();
    if (axis.lengthSq() < .5) continue;
    for (const bone of [upper, forearm]) {
      scene.updateMatrixWorld(true);
      const parentRotation = bone.parent.getWorldQuaternion(new Quaternion());
      const kind = bone === upper ? 'Upperarm' : 'Forearm';
      const delta = parentRotation.clone().invert().multiply(new Quaternion().setFromAxisAngle(axis, MathUtils.degToRad(sideAngles[side][kind]))).multiply(parentRotation).normalize();
      corrections.set(bone.name, {rotation: delta, position: new Vector3()});
      bone.quaternion.premultiply(delta).normalize();
    }
    scene.updateMatrixWorld(true);
    // Keep each paw's original horizontal footprint while lowering it. This
    // counteracts the auto-rig's low and asymmetrical elbow placement.
    const shifted = currentPawCenter(region);
    const worldOffset = region.center.clone().sub(shifted);worldOffset.y = 0;
    let influenced = 0;
    for (const {mesh, index, weight} of region.samples) {
      const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
      let descendantWeight = 0;
      for (let slot = 0; slot < 4; slot++) {
        let bone = mesh.skeleton.bones[indices.getComponent(index, slot)];
        while (bone && bone !== forearm) bone = bone.parent;
        if (bone === forearm) descendantWeight += weights.getComponent(index, slot);
      }
      influenced += descendantWeight * weight;
    }
    const influence = influenced / region.total;
    if (influence > .2) {
      worldOffset.multiplyScalar(1 / influence);
      const localOffset = worldOffset.applyMatrix3(new Matrix3().setFromMatrix4(forearm.parent.matrixWorld).invert());
      corrections.get(forearm.name).position.copy(localOffset);forearm.position.add(localOffset);
    }
    scene.updateMatrixWorld(true);
    report.arms[side] = {axis: axis.toArray(), angles: sideAngles[side], pawBefore: region.center.toArray(), pawAfter: currentPawCenter(region).toArray()};
  }

  const morphs = [], disposable = [];
  const characterHeight = Math.max(1e-6, maxY - minY);
  for (const mesh of meshes) {
    const source = mesh.geometry, geometry = source.clone(), attributes = source.attributes;
    const count = attributes.position.count, deltas = new Float32Array(count * 3), normalDeltas = attributes.normal ? new Float32Array(count * 3) : null;
    const matrix = new Matrix4(), inverse = new Matrix4(), inverseLinear = new Matrix3(), currentLinear = new Matrix3(), originalLinear = new Matrix3();
    const relaxed = new Vector3(), desired = new Vector3(), normal = new Vector3(), desiredNormal = new Vector3(), baseNormal = new Vector3();
    for (let index = 0; index < count; index++) {
      const rest = reference.get(mesh).positions[index];
      point.copy(rest).applyMatrix4(mesh.matrixWorld);
      const y = (point.y - minY) / characterHeight;
      let armWeight = 0;
      for (let slot = 0; slot < 4; slot++) if (armName.test(mesh.skeleton.bones[attributes.skinIndex.getComponent(index, slot)]?.name || '')) armWeight += attributes.skinWeight.getComponent(index, slot);
      const mask = MathUtils.smoothstep(Math.abs(point.z) / characterHeight, .19, .32) * MathUtils.smoothstep(y, .20, .31) * (1 - MathUtils.smoothstep(y, .47, .57)) * MathUtils.smoothstep(armWeight, .30, .75);
      skinMatrix(mesh, index, matrix);
      inverse.copy(matrix).invert();
      relaxed.copy(rest).lerp(mesh.getVertexPosition(index, desired), mask);
      desired.copy(relaxed).applyMatrix4(inverse).sub(point.fromBufferAttribute(attributes.position, index)).toArray(deltas, index * 3);
      if (normalDeltas) {
        normal.fromBufferAttribute(attributes.normal, index);
        currentLinear.setFromMatrix4(matrix);originalLinear.setFromMatrix4(reference.get(mesh).matrices[index]);inverseLinear.setFromMatrix4(inverse);
        baseNormal.copy(normal).applyMatrix3(originalLinear);
        desiredNormal.copy(normal).applyMatrix3(currentLinear).lerp(baseNormal, 1 - mask).applyMatrix3(inverseLinear).sub(normal).toArray(normalDeltas, index * 3);
      }
    }
    const index = geometry.morphAttributes.position?.length || 0;
    geometry.morphTargetsRelative = true;
    const target = new Float32BufferAttribute(deltas, 3);target.name = 'capybara-relaxed-idle-body';
    geometry.morphAttributes.position = [...(geometry.morphAttributes.position || []), target];
    if (normalDeltas) geometry.morphAttributes.normal = [...(geometry.morphAttributes.normal || []), new Float32BufferAttribute(normalDeltas, 3)];
    mesh.geometry = geometry;mesh.updateMorphTargets();mesh.morphTargetInfluences[index] = 0;
    morphs.push({mesh, index});disposable.push(geometry);
  }

  for (const bone of bones) {bone.quaternion.copy(saved.get(bone).quaternion);bone.position.copy(saved.get(bone).position);}
  scene.updateMatrixWorld(true);
  for (const track of clip.tracks) {
    const binding = PropertyBinding.parseTrackName(track.name), correction = corrections.get(binding.nodeName);
    if (!correction) continue;
    if (binding.propertyName === 'quaternion') {
      for (let index = 0; index < track.values.length; index += 4) new Quaternion().fromArray(track.values, index).premultiply(correction.rotation).normalize().toArray(track.values, index);
    } else if (binding.propertyName === 'position') {
      for (let index = 0; index < track.values.length; index += 3) new Vector3().fromArray(track.values, index).add(correction.position).toArray(track.values, index);
    }
  }
  return {clip, morphs, report, dispose: () => disposable.forEach(geometry => geometry.dispose())};
}
