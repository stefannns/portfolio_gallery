import assert from 'node:assert/strict';
import {FISH_DURATION, FISH_FLOOR_Y, FISH_POSITION, FISH_HOP_DURATION, FISH_HOPS_END, FISH_LAUNCH_END, FISH_LAND_TIME, FISH_BOUNCE_END, advanceFishFlop, createFishFlopState, fishFlopPose, startFishFlop} from '../src/fish-flop-state.js';
import {KITCHEN_TOYS, chooseRoomTarget, isKitchenToyAvailable} from '../src/kitchen-toy-state.js';

const state = createFishFlopState(), fish = KITCHEN_TOYS.find(toy => toy.id === 'fish-flop');
const engine = {fishToy: state}, player = {x: -2.75, z: -2.78};
assert(isKitchenToyAvailable(fish, engine));
assert.equal(chooseRoomTarget(player, [fish])?.id, 'fish-flop');
assert.equal(startFishFlop(state, {blocked: true}), false);
assert.equal(state.used, false);
assert.equal(startFishFlop(state), true);
assert.equal(state.uses, 1);
assert.equal(isKitchenToyAvailable(fish, engine), false);
assert.equal(startFishFlop(state), false);
advanceFishFlop(state, .5, true);assert.equal(state.elapsed, 0);
advanceFishFlop(state, Infinity);assert.equal(state.elapsed, 0);
advanceFishFlop(state, 10);assert.equal(state.elapsed, .05);
advanceFishFlop(state, -1);assert.equal(state.elapsed, .05);
for (let n = 0; n < 400; n++) advanceFishFlop(state, 1 / 60);
assert.equal(state.elapsed, FISH_DURATION);
assert.equal(startFishFlop(state), false);
assert.equal(state.uses, 1);
const remounted = engine.fishToy;assert.equal(remounted, state);
assert.equal(isKitchenToyAvailable(fish, {fishToy: remounted}), false);
for (const reduced of [false, true]) {
  for (const time of [FISH_HOPS_END, FISH_LAUNCH_END, FISH_LAND_TIME, FISH_BOUNCE_END, FISH_DURATION]) {
    const before = fishFlopPose(time - 1e-7, reduced), after = fishFlopPose(time + 1e-7, reduced);
    for (const key of ['x','y','z','roll','pitch','yaw','bend']) assert(Math.abs(before[key] - after[key]) < 1e-5, `${key} jumps at ${time}`);
  }
  if (!reduced) {
    for (let hop=0;hop<3;hop++) assert(fishFlopPose(FISH_HOP_DURATION*(hop+.5),reduced).y-FISH_POSITION[1] >= [.55,.85,1.15][hop] - 1e-6, 'The stronger hops retain their authored height.');
  }
  const rest = fishFlopPose(-1, reduced), finish = fishFlopPose(FISH_DURATION, reduced);
  assert.equal(rest.phase, 'idle');assert.equal(rest.x, FISH_POSITION[0]);
  assert.equal(finish.phase, 'escaped');assert.equal(finish.active, false);assert.equal(finish.y, FISH_FLOOR_Y);
  assert(finish.x > -3.30 + .4, 'The whole fish must clear the counter before resting on the floor.');
  for(let t=0;t<=FISH_DURATION;t+=.01) {
    const pose=fishFlopPose(t,reduced);
    for(const key of ['x','y','z','roll','pitch','yaw','bend']) assert(Number.isFinite(pose[key]));
    if(pose.phase==='falling') assert(pose.x >= -2.8, 'Do not descend through the cabinet.');
    assert(pose.y >= FISH_FLOOR_Y - 1e-6);
  }
}
console.log('Fish flop passed: proximity, once-only availability, pause/resume, bounded time, continuous poses, cabinet clearance and floor landing.');
