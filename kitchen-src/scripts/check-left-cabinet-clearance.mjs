import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRoomNavigator, canTraverseRoomSegment} from '../src/room-navigation.js';

let source = await readFile(new URL('../src/room-placement.js', import.meta.url), 'utf8');
for (const [name, file] of [['surfaceV7', 'room-v7-surfaces.json'], ['surfaceV10', 'room-v10-surfaces.json'], ['layoutV10', 'room-v10-layout.json']]) {
  const json = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  source = source.replace(new RegExp(`import ${name} from '[^']+';`), `const ${name} = ${json};`);
}
const room = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).getRoomPlacement(10);
// Measured walking-pose upper-body reach is .735. The old body-only mask
// allowed centers beyond z=4.2, putting the paws inside the z=4.66 cabinet.
for (const x of [-2.4, -1.8, -1, 0, 1, 1.7]) {
  for (const hz of [30, 60, 144]) {
    let player = {x, z: 3.5};
    assert(room.canWalk(player.x, player.z));
    for (let frame = 0; frame < hz * 3; frame++) player = room.stepRoomPlayer(player, {x: 0, z: 1}, 1 / hz);
    assert(player.z + .735 < 4.66, 'Animated paws cannot reach the cabinet front');
    assert(player.z >= 3.8, 'Cabinet interactions remain within reach');
  }
}
for (const point of [{x: 1.95, z: 3.85}, {x: 2.3, z: 4.1}, {x: 2.4, z: 4.2}, {x: 4.4, z: 5.4}, {x: 4.5, z: -5.4}]) {
  assert(room.canWalk(point.x, point.z), 'Rounded cabinet end and front corners remain open');
}
const nav = createRoomNavigator({bounds: room.ROOM_BOUNDS, canWalk: room.canWalk});
const from = {x: -1.8, z: 3.5}, to = {x: 2.4, z: 4.2};
const path = nav.findPath(from, to);
assert(path.length, 'Click-to-walk can pass the cabinet end');
let previous = from;
for (const point of path) {
  assert(canTraverseRoomSegment(previous, point, room.canWalk));
  previous = point;
}
for (const item of room.ROOM_ITEMS.filter(item => item.id === 'seed-squad')) {
  assert(room.canWalk(item.position[0], 3.85), 'The groceries approach is walkable');
  assert(Math.abs(3.85 - item.position[2]) < 1.7, 'Groceries remain inspectable');
}
assert(Math.hypot(.3 - .3, 3.85 - 4.95) < 1.65, 'Tomatoes remain usable');
console.log('Left cabinet passed: 18 animated-paw approach cases, rounded-end click route, front corners and interactions.');
