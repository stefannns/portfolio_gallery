import assert from 'node:assert/strict';
import {createTomatoInventory, TOMATO_TIMING, tomatoThrowPose} from '../src/tomato-throw-state.js';

const inventory = createTomatoInventory();
assert.equal(inventory.remaining, 4);
assert.equal(inventory.start({blocked: true}), null, 'Pauses/far or disabled actions cannot consume stock.');
assert.equal(inventory.remaining, 4);
const consumed = [];
for (let remaining = 3; remaining >= 0; remaining--) {
  const index = inventory.start();consumed.push(index);
  assert.equal(index, remaining, 'Pick the top tomato, then individual lower tomatoes.');
  assert.equal(inventory.has(index), false, 'Picked model stays absent.');
  assert.equal(inventory.remaining, remaining);
  assert.equal(inventory.start(), null, 'An in-flight action cannot consume a second tomato.');
  inventory.finish(); // Same operation used by completion and reset/cancel.
  inventory.finish();
  assert.equal(inventory.remaining, remaining, 'Cancelling or finishing never replenishes.');
  assert.equal(inventory.start({blocked: true}), null);
  assert.equal(inventory.remaining, remaining, 'Pause/resume gating does not change stock.');
}
assert.deepEqual(consumed, [3, 2, 1, 0]);
assert.equal(inventory.start(), null, 'Fifth throw is blocked.');
assert.equal(inventory.remaining, 0);
assert.equal(createTomatoInventory(inventory.remaining).remaining, 0, 'A remount can retain visit stock from engine.');
assert.equal(createTomatoInventory(2).start(), 1, 'Partial visit stock retains top-first order.');
assert.equal(tomatoThrowPose(.4).phase, 'windup');
assert.equal(tomatoThrowPose(.72).phase, 'throw');
assert.equal(tomatoThrowPose(1.28).phase, 'impact');
assert.equal(TOMATO_TIMING.end, 1.45);
assert.equal(tomatoThrowPose(1.45).active, false);
for (let ms = 0; ms <= 1600; ms++) {
  const pose = tomatoThrowPose(ms / 1000);
  assert.notEqual(pose.phase, 'refill');
  for (const key of ['grabProgress', 'windupProgress', 'throwProgress']) assert(pose[key] >= 0 && pose[key] <= 1);
}
console.log('Tomato inventory passed: four distinct consumptions, blocked fifth, busy/pause gating, reset preservation, remount stock, and 1.45s timeline.');
