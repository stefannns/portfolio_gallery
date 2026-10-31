import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRoomNavigator, canTraverseRoomSegment} from '../src/room-navigation.js';
import {resolveCabinetArmClearance} from '../src/cabinet-arm-clearance.js';

let source = await readFile(new URL('../src/room-placement.js', import.meta.url), 'utf8');
for (const [name, file] of [['surfaceV7', 'room-v7-surfaces.json'], ['surfaceV10', 'room-v10-surfaces.json'], ['layoutV10', 'room-v10-layout.json']]) {
  const json = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  source = source.replace(new RegExp(`import ${name} from '[^']+';`), `const ${name} = ${json};`);
}
const room = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).getRoomPlacement(10);
// Facing the cabinet keeps the old close approach; turning sideways adds
// shoulder-width clearance by moving the root away without scaling the mesh.
for (const x of [-2.1, -1.8, -1, 0, .5, 1.2]) {
  const close = {x, z: 4.15};
  assert(room.canWalk(x, close.z));
  const facing = resolveCabinetArmClearance(close, 0, room.canWalk);
  assert.deepEqual(facing, close, 'Forward-facing approach stays close');
  for (const hz of [30, 60, 144]) {
    let p = {...close}, heading = 0;
    for (let frame = 0; frame < hz; frame++) {
      heading += (Math.PI / 2 - heading) * (1 - Math.exp(-17 / hz));
      const next = resolveCabinetArmClearance(p, heading, room.canWalk);
      assert(next && room.canWalk(next.x, next.z), 'Every turn adjustment stays on free floor');
      assert(Math.abs(next.x - p.x) < 1e-8, 'Front-face correction only slides away from the cabinet');
      assert(Math.hypot(next.x - p.x, next.z - p.z) < .13, 'Turning produces bounded nudges');
      p = next;
    }
    assert(p.z > 3.89 && p.z < 3.91, 'Sideways arms keep the wider clearance');
    const returned = resolveCabinetArmClearance(p, 0, room.canWalk);
    assert.deepEqual(returned, p, 'Turning back does not pull the player into the cabinet');
  }
}
assert.equal(resolveCabinetArmClearance({x: -1.8, z: 4.15}, Math.PI / 2, () => false), null, 'Other blocked fixtures prevent nudging');
for (const point of [{x: 1.95, z: 3.85}, {x: 2.3, z: 4.1}, {x: 2.4, z: 4.2}, {x: 4.4, z: 5.4}, {x: 4.5, z: -5.4}]) {
  assert(room.canWalk(point.x, point.z), 'Cabinet ends and front corners remain open');
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
console.log('Directional cabinet clearance passed: 18 smooth-turn cases, close forward approach, blocked-nudge safety, click routes and interactions.');
