import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {getLandedFishCollider, recoverFishOverlap} from '../src/fish-ground-collision.js';
import {FISH_BOUNCE_END, FISH_DURATION, createFishFlopState, startFishFlop, advanceFishFlop} from '../src/fish-flop-state.js';
import {createRoomNavigator, canTraverseRoomSegment} from '../src/room-navigation.js';

const source = new URL('../src/', import.meta.url);
let placementSource = await fs.readFile(new URL('room-placement.js', source), 'utf8');
for (const [name, file] of [['surfaceV7','room-v7-surfaces.json'], ['surfaceV10','room-v10-surfaces.json'], ['layoutV10','room-v10-layout.json']]) {
  placementSource = placementSource.replace(new RegExp(`import ${name} from '[^']+';`), `const ${name} = ${await fs.readFile(new URL(file, source), 'utf8')};`);
}
const room = (await import(`data:text/javascript;base64,${Buffer.from(placementSource).toString('base64')}`)).getRoomPlacement(10);
const props = room.sanitizeRoomPlacements(null), radius = room.PLAYER_RADIUS;
const state = createFishFlopState();
assert.equal(getLandedFishCollider(state), null);
assert.equal(getLandedFishCollider(undefined), null);
assert.equal(getLandedFishCollider({used: false, elapsed: FISH_DURATION}), null);
assert(startFishFlop(state));
for (const elapsed of [0, 1, 2.69, FISH_BOUNCE_END - 1e-6]) assert.equal(getLandedFishCollider({...state, elapsed}), null, 'Airborne/bouncing fish must not make an invisible floor wall.');
const landedState = {...state, elapsed: FISH_BOUNCE_END};
const collider = getLandedFishCollider(landedState);
assert(collider);
assert.equal(getLandedFishCollider({...landedState, elapsed: FISH_DURATION}), collider, 'Pause/remount/final poses reuse one stable obstacle.');
const [cx, , cz] = collider.position;
const withFish = [...props, collider];
const capsuleDistance = (point, item = collider) => {
  const [x, , z] = item.position, half = item.collisionHalfLength;
  return Math.hypot(point.x - Math.max(x - half, Math.min(x + half, point.x)), point.z - z);
};
const outside = point => capsuleDistance(point) >= collider.collisionRadius + radius - 1e-7;
assert(room.canWalk(cx, cz, props), 'The fish lands on walkable aisle floor.');
assert(!room.canWalk(cx, cz, withFish));
for (const point of [{x: cx - .35, z: cz}, {x: cx + .35, z: cz}, {x: cx, z: cz + .2}, {x: cx, z: cz - .2}]) assert(!room.canWalk(point.x, point.z, withFish), 'Actual fish body footprint blocks the capybara.');
assert(room.canWalk(cx + .9, cz, withFish), 'The blocker does not cover a huge unrelated area.');

// All directions use the actual production movement implementation on an open
// patch of the same room. This includes the side hidden behind the real counter.
const openCollider = {...collider, position: [3.4, collider.position[1], 0]}, openProps = [...props, openCollider];
let heldCases = 0;
for (const rate of [30, 60, 144]) for (let direction = 0; direction < 8; direction++) {
  const angle = direction * Math.PI / 4, dx = Math.cos(angle), dz = Math.sin(angle);
  let player = {x: 3.4 + .9 * dx, z: .9 * dz};
  assert(room.canWalk(player.x, player.z, openProps));
  for (let frame = 0; frame < rate; frame++) {
    player = room.stepRoomPlayer(player, {x: -dx, z: -dz}, 1 / rate, openProps);
    assert(capsuleDistance(player, openCollider) >= openCollider.collisionRadius + radius - 1e-7, 'Held movement and diagonal slides cannot penetrate the fish.');
    assert(room.canWalk(player.x, player.z, openProps));
  }
  if (direction % 2 === 0) assert.equal(player.moving, false, 'A blocked cardinal approach stops the walk animation.');
  heldCases++;
}

const baseCanWalk = (x, z) => room.canWalk(x, z, props), combinedCanWalk = (x, z) => room.canWalk(x, z, withFish);
const staticTraverse = (from, to) => canTraverseRoomSegment(from, to, room.canWalk, props);
const validOutside = {x: cx + 1, z: cz, y: room.ROOM_FLOOR_Y};
assert.equal(recoverFishOverlap(validOutside, collider, {canWalk: combinedCanWalk, canTraverse: staticTraverse}), validOutside);
assert.equal(recoverFishOverlap(validOutside, null, {canWalk: combinedCanWalk, canTraverse: staticTraverse}), validOutside);
const overlaps = [{x: -2.75, z: cz}, {x: cx, z: cz}, {x: -2.8, z: cz}];
for (const initial of overlaps) {
  assert(baseCanWalk(initial.x, initial.z), 'The recovery case starts on valid static room floor.');
  const player = {...initial, y: room.ROOM_FLOOR_Y, moving: false};
  const recovered = recoverFishOverlap(player, collider, {playerRadius: radius, canWalk: combinedCanWalk, canTraverse: staticTraverse});
  assert(recovered, 'Landing overlap finds a nearby free floor point.');
  assert(outside(recovered) && combinedCanWalk(recovered.x, recovered.z));
  assert(staticTraverse(player, recovered));
  assert(Math.hypot(recovered.x - player.x, recovered.z - player.z) < .8, 'Recovery is local rather than a teleport to spawn.');
  assert.equal(recovered.y, player.y);assert.equal(recovered.moving, false);
  assert(Math.hypot(recovered.x - room.PLAYER_START.x, recovered.z - room.PLAYER_START.z) > 1);
  const resumed = room.stepRoomPlayer(recovered, {x: 1, z: 0}, 1 / 60, withFish);
  assert(combinedCanWalk(resumed.x, resumed.z), 'Walking resumes from the corrected point without spawn fallback.');
}
assert.equal(recoverFishOverlap({x: cx, z: cz}, collider, {canWalk: () => false, canTraverse: () => true}), null, 'A trapped player must be held rather than teleported.');
assert.equal(recoverFishOverlap({x: cx, z: cz}, collider, {canWalk: () => true, canTraverse: () => false}), null, 'Recovery cannot cross an actual room obstacle.');

const navigator = createRoomNavigator({bounds: room.ROOM_BOUNDS, canWalk: room.canWalk});
const start = {x: cx, z: cz - 1}, destination = {x: cx, z: cz + 1};
assert(baseCanWalk(start.x, start.z) && baseCanWalk(destination.x, destination.z));
assert(canTraverseRoomSegment(start, destination, room.canWalk, props));
assert(!canTraverseRoomSegment(start, destination, room.canWalk, withFish));
const path = navigator.findPath(start, destination, withFish);
assert(path.length > 1, 'Click-to-walk routes around the landed fish.');
let previous = start;
for (const point of path) {assert(canTraverseRoomSegment(previous, point, room.canWalk, withFish));previous = point;}
assert(Math.hypot(previous.x - destination.x, previous.z - destination.z) < .05);
const paused = {...landedState};advanceFishFlop(paused, .5, true);assert.equal(paused.elapsed, landedState.elapsed);assert.equal(getLandedFishCollider(paused), collider);
console.log(`Fish ground collision passed: phase gating, stable capsule, ${heldCases} movement/diagonal cases, click routing, local landing-overlap recovery and blocked recovery.`);
