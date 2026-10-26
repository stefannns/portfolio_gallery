import {Quaternion, Vector3} from 'three';

const nativeUp = new Vector3(0, 1, 0), nativeSide = new Vector3(0, 0, 1);
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => {const x = clamp(value);return x * x * (3 - 2 * x);};
const mix = (a, b, progress) => a + (b - a) * progress;
const empty = {upperYaw: 0, upperLift: 0, foreYaw: 0, foreLift: 0};
const reach = {upperYaw: .24, upperLift: .10, foreYaw: .20, foreLift: .23};
const windup = {upperYaw: -.05, upperLift: .26, foreYaw: -.08, foreLift: .76};
const follow = {upperYaw: .42, upperLift: -.04, foreYaw: .42, foreLift: -.12};

/** Angles are offsets from this frame's corrected idle/walk pose. */
export function tomatoArmPose(action) {
  const time = action?.active && Number.isFinite(action.elapsed) ? action.elapsed : -1;
  if (time < 0 || time >= 1.45) return {...empty};
  let first, second, progress;
  if (time < .4) {first = empty;second = reach;progress = ease(time / .4);}
  else if (time < .72) {first = reach;second = windup;progress = ease((time - .4) / .32);}
  else if (time < .9) {first = windup;second = follow;progress = ease((time - .72) / .18);}
  else {first = follow;second = empty;progress = ease((time - .9) / .55);}
  return Object.fromEntries(Object.keys(empty).map(key => [key, mix(first[key], second[key], progress)]));
}

/** A small visual hop; the player's logical position stays on the floor. */
export function tomatoBodyLift(action) {
  const time = action?.active && Number.isFinite(action.elapsed) ? action.elapsed : -1;
  if (time < .08 || time >= 1.1) return 0;
  if (time < .4) return .22 * ease((time - .08) / .32);
  if (time <= .72) return .22;
  return .22 * (1 - ease((time - .72) / .38));
}

function visiblePawSamples(scene) {
  const all = [], names = /^R_(Hand|Thumb|Index|Mid|Ring|Pinky)/;
  scene.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const weights = mesh.geometry.attributes.skinWeight, indices = mesh.geometry.attributes.skinIndex;
    for (let index = 0; index < weights.count; index++) {
      let weight = 0;
      for (let slot = 0; slot < 4; slot++) {
        if (names.test(mesh.skeleton.bones[indices.getComponent(index, slot)]?.name || '')) weight += weights.getComponent(index, slot);
      }
      if (weight > .55) all.push({mesh, index, weight});
    }
  });
  if (all.length <= 48) return all;
  return Array.from({length: 48}, (_, index) => all[Math.floor((index + .5) * all.length / 48)]);
}

/** A temporary right-arm gesture. Restore before the mixer, apply after it. */
export function createCapybaraTomatoPose(scene) {
  const upper = scene.getObjectByName('R_Upperarm'), forearm = scene.getObjectByName('R_Forearm');
  const bones = [upper, forearm].filter(Boolean), saved = bones.map(() => new Quaternion());
  const samples = visiblePawSamples(scene), point = new Vector3();
  const actorRotation = new Quaternion(), parentRotation = new Quaternion(), inverseParent = new Quaternion();
  const yaw = new Quaternion(), lift = new Quaternion(), delta = new Quaternion();
  const up = new Vector3(), side = new Vector3();
  let applied = false;

  function updateScene() {
    scene.parent?.updateWorldMatrix(true, false);
    // SkinnedMesh updates its attached bind inverse in updateMatrixWorld.
    scene.updateMatrixWorld(true);
  }

  function restore() {
    if (!applied) return;
    bones.forEach((bone, index) => bone.quaternion.copy(saved[index]));
    applied = false;
  }

  function rotate(bone, yawAngle, liftAngle) {
    if (!bone) return;
    bone.parent.getWorldQuaternion(parentRotation);
    inverseParent.copy(parentRotation).invert();
    yaw.setFromAxisAngle(up, yawAngle);lift.setFromAxisAngle(side, liftAngle);
    delta.copy(inverseParent).multiply(lift).multiply(yaw).multiply(parentRotation).normalize();
    bone.quaternion.premultiply(delta).normalize();
    bone.updateWorldMatrix(false, true);
  }

  function apply(action) {
    const pose = tomatoArmPose(action);
    if (!Object.values(pose).some(value => Math.abs(value) > 1e-6)) return;
    bones.forEach((bone, index) => saved[index].copy(bone.quaternion));
    updateScene();
    scene.getWorldQuaternion(actorRotation);
    up.copy(nativeUp).applyQuaternion(actorRotation);side.copy(nativeSide).applyQuaternion(actorRotation);
    rotate(upper, pose.upperYaw, pose.upperLift);
    rotate(forearm, pose.foreYaw, pose.foreLift);
    applied = bones.length > 0;
  }

  function handPosition(target) {
    updateScene();
    target.set(0, 0, 0);
    let total = 0;
    for (const sample of samples) {
      sample.mesh.getVertexPosition(sample.index, point).applyMatrix4(sample.mesh.matrixWorld);
      target.addScaledVector(point, sample.weight);total += sample.weight;
    }
    if (total) target.divideScalar(total);
    else if (forearm) forearm.getWorldPosition(target);
    else scene.getWorldPosition(target);
    // The tomato's center rests just above the paw rather than inside its mesh.
    target.y += .11;
    return target;
  }

  return {restore, apply, handPosition, bones: bones.map(bone => bone.name), sampleCount: samples.length};
}
