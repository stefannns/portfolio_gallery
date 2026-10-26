import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {KITCHEN_TOYS, chooseRoomTarget, isNearRoomTarget} from '../src/kitchen-toy-state.js';

const layout = JSON.parse(await readFile(new URL('../src/room-v10-layout.json', import.meta.url), 'utf8'));
const bag = layout.items.find(item => item.id === 'seed-squad');
const tomatoes = KITCHEN_TOYS.find(item => item.id === 'tomato-throw');
const objects = [bag, tomatoes];

// Both objects are reachable here. Task/hover hints must not steal the closer target.
for (const [player, expected, staleHint] of [
  [{x: 0, z: 4}, 'tomato-throw', 'seed-squad'],
  [{x: -.9, z: 4}, 'seed-squad', 'tomato-throw'],
]) {
  assert(objects.every(item => isNearRoomTarget(player, item)));
  for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    assert.equal(chooseRoomTarget({...player, facing}, objects)?.id, expected);
    // Legacy callers may still provide stale hints; selection remains distance-only.
    assert.equal(chooseRoomTarget({...player, facing}, objects, staleHint, staleHint)?.id, expected);
  }
}
assert.equal(chooseRoomTarget({x: 0, z: 0}, objects), null);
assert.equal(chooseRoomTarget({x: NaN, z: 4}, objects), null);
assert.equal(chooseRoomTarget({x: 0, z: 4}, []), null);
const shortReach = {id: 'short', position: [0, 0, 0], interactionRange: .5};
const longReach = {id: 'long', position: [2, 0, 0], interactionRange: 2};
assert.equal(chooseRoomTarget({x: .8, z: 0}, [shortReach, longReach])?.id, 'long');
const boundary = {id: 'edge', position: [0, 0, 0], interactionRange: 1.65};
assert.equal(chooseRoomTarget({x: 1.65, z: 0}, [boundary])?.id, 'edge');
assert.equal(chooseRoomTarget({x: 1.6501, z: 0}, [boundary]), null);
const left = {id: 'left', position: [-1, 0, 0]}, right = {id: 'right', position: [1, 0, 0]};
assert.equal(chooseRoomTarget({x: 0, z: 0}, [left, right])?.id, 'left');
assert.equal(chooseRoomTarget({x: .01, z: 0}, [left, right])?.id, 'right');
console.log('Room targeting passed: closest object in overlap, all facing directions, stale hover/task hints, range boundaries, and stable ties.');
