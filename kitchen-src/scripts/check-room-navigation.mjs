import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRoomNavigator, canTraverseRoomSegment} from '../src/room-navigation.js';

const bounds = {minX: 0, maxX: 8, minZ: 0, maxZ: 8};
const safe = (x, z) => x >= .15 && x <= 7.85 && z >= .15 && z <= 7.85;
const checkPath = (start, path, canWalk, placements = []) => {
  assert(path.length, 'A reachable click produces a route');
  let previous = start;
  for (const waypoint of path) {
    assert(canTraverseRoomSegment(previous, waypoint, canWalk, placements), 'Every simplified segment stays in walkable floor');
    previous = waypoint;
  }
};
const start = {x: 1, z: 1}, destination = {x: 7, z: 1};
const open = createRoomNavigator({bounds, canWalk: safe});
assert.deepEqual(open.findPath(start, destination), [destination]);
assert.deepEqual(open.findPath(start, {x: 20, z: 20}), []);
assert.deepEqual(open.findPath(start, {x: NaN, z: 4}), []);
const doorway = (x, z) => safe(x, z) && !(x > 3.5 && x < 4.5 && z < 5.5);
const route = createRoomNavigator({bounds, canWalk: doorway}).findPath(start, destination);
checkPath(start, route, doorway);
assert(route.some(point => point.z >= 5.5), 'Routing goes around the wall through the opening');
assert.deepEqual(createRoomNavigator({bounds, canWalk: (x, z) => safe(x, z) && !(x > 3.5 && x < 4.5)}).findPath(start, destination), [], 'Disconnected rooms do not produce a path');
const prop = [{position: [4, 0, 1], radius: .7}];
const withProps = (x, z, placements = []) => safe(x, z) && placements.every(item => Math.hypot(x - item.position[0], z - item.position[2]) >= item.radius);
const aroundProp = createRoomNavigator({bounds, canWalk: withProps}).findPath(start, destination, prop);
checkPath(start, aroundProp, withProps, prop);
assert(aroundProp.length > 1, 'Floor props are routed around');

// Use the production placement implementation and actual V10 geometry mask.
let placementSource = await readFile(new URL('../src/room-placement.js', import.meta.url), 'utf8');
for (const [name, file] of [['surfaceV7', 'room-v7-surfaces.json'], ['surfaceV10', 'room-v10-surfaces.json'], ['layoutV10', 'room-v10-layout.json']]) {
  const json = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  placementSource = placementSource.replace(new RegExp(`import ${name} from '[^']+';`), `const ${name} = ${json};`);
}
const {getRoomPlacement} = await import(`data:text/javascript;base64,${Buffer.from(placementSource).toString('base64')}`);
const room = getRoomPlacement(10);
const publishedLayout = JSON.parse(await readFile(new URL('../src/room-v10-layout.json', import.meta.url), 'utf8'));
const expectedIds = ['seed-squad', 'smarttester', 'h3-otome', 'toad-defense', 'games-computer', 'a-bot-can-do-better'];
assert.deepEqual(room.ROOM_ITEMS.map(item => item.id), expectedIds, 'Publishing a layout retains all six project objects');
assert.equal(publishedLayout.version, 1, 'Published layout uses the supported data version');
assert.deepEqual(publishedLayout.items.map(item => item.id), expectedIds, 'Published positions cover every project object');
for (const expected of publishedLayout.items) {
  const actual = room.ROOM_ITEMS.find(item => item.id === expected.id);
  for (let axis = 0; axis < 3; axis++) {
    assert(Math.abs(actual.position[axis] - expected.position[axis]) < .000001, `${expected.id} keeps its published coordinate on axis ${axis}, including its snapped support height`);
  }
  assert(Number.isFinite(actual.rotationY), `${expected.id} has a finite published rotation`);
}
assert(Math.abs(room.ROOM_ITEMS.find(item => item.id === 'seed-squad').rotationY - Math.PI / 4) < .000001, 'The vegetables bag retains its authored 45-degree turn');
const roomNavigator = createRoomNavigator({bounds: room.ROOM_BOUNDS, canWalk: room.canWalk});
const placements = room.sanitizeRoomPlacements(null);
const roomStart = room.getPlayerStart(placements);
const targets = [{x: -1.8, z: 3}, {x: 1.8, z: -2}, {x: 4.2, z: 1.8}, {x: 2.3, z: 4.8}, {x: 1.8, z: -4.5}].filter(point => room.canWalk(point.x, point.z, placements));
let reached = 0;
for (const target of targets) {
  const path = roomNavigator.findPath(roomStart, target, placements);
  checkPath(roomStart, path, room.canWalk, placements);
  let player = {...roomStart};
  for (const waypoint of path) {
    let frames = 0;
    while (Math.hypot(player.x - waypoint.x, player.z - waypoint.z) >= .035 && frames++ < 1500) {
      const dx = waypoint.x - player.x, dz = waypoint.z - player.z, distance = Math.hypot(dx, dz);
      const amount = Math.min(1, distance / (room.PLAYER_SPEED / 60));
      player = room.stepRoomPlayer(player, {x: dx / distance * amount, z: dz / distance * amount}, 1 / 60, placements);
      assert(room.canWalk(player.x, player.z, placements), 'Movement remains inside production floor clearance');
    }
    assert(frames < 1500, 'Production movement reaches every waypoint without getting stuck');
  }
  assert(Math.hypot(player.x - target.x, player.z - target.z) < .05);
  reached++;
}
console.log(`Published V10 layout and room navigation passed: direct route, wall detour, props, unreachable destination, ${reached} real V10 routes with simulated walking.`);
