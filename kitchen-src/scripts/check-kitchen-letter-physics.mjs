import assert from 'node:assert/strict';
import {createKitchenLetterPhysics, KITCHEN_LETTER_FLOOR} from '../src/kitchen-letter-physics.js';

const speed = 3.8;
const frameRates = [30, 60, 90, 120, 144, 180, 240, 360];
let cases = 0;

async function walk(deltas, {pause = false, letter = false} = {}) {
  const root = {dataset: {}};
  const fixture = {character: 'test', position: [1.2, KITCHEN_LETTER_FLOOR.y + .2, 0], halfExtents: [.2, .2, .2], rotation: {x: 0, y: 0, z: 0, w: 1}};
  const physics = await createKitchenLetterPhysics(letter ? [fixture] : [], {rootRef: root});
  let player = {x: 0, z: 0}, elapsed = 0, starts = 0, wasMoving = false;
  try {
    for (let frame = 0; frame < deltas.length; frame++) {
      const dt = deltas[frame];
      if (pause && frame === Math.floor(deltas.length * .4)) {
        const before = {...player};
        const beforeLetters = physics.letters.map(({body}) => ({...body.translation()}));
        for (let i = 0; i < 30; i++) {
          const stopped = physics.step(player, {...player, moving: false}, 1 / 60, {paused: true});
          assert.equal(stopped.moving, false, 'Inspection pauses the walking animation');
          assert.equal(stopped.x, before.x);
          assert.equal(stopped.z, before.z);
        }
        assert.deepEqual(physics.letters.map(({body}) => ({...body.translation()})), beforeLetters, 'Letters also remain paused while inspecting');
        wasMoving = false;
      }
      const next = physics.step(player, {x: player.x + speed * dt, z: 0, moving: true}, dt);
      assert(next.moving, `Continuous input cannot report a stopped frame (dt=${dt})`);
      if (!wasMoving) starts++;
      wasMoving = next.moving;
      if (!letter) assert(Math.abs(next.x - player.x - speed * dt) < .00001, 'Each displayed frame advances smoothly at the requested speed');
      player = next;elapsed += dt;
    }
    assert.equal(starts, pause ? 2 : 1, 'The walking clip starts only initially and after an intentional inspection pause');
    if (letter) {
      assert(Number(root.dataset.letterPushes) > 0, 'Player still collides with and pushes a letter');
      assert(physics.letters[0].body.translation().x > fixture.position[0] + .1, 'The letter moves rather than allowing the player through it');
      assert(player.x > speed * elapsed - .1 && player.x <= speed * elapsed + .0001, 'Letter contacts preserve the intended movement speed');
    } else assert(Math.abs(player.x - speed * elapsed) < .0001, 'Total distance stays independent of refresh rate');
    cases++;
  } finally {physics.dispose();}
}

for (const fps of frameRates) {
  const deltas = Array(fps).fill(1 / fps);
  await walk(deltas);
  await walk(deltas, {pause: true});
  await walk(deltas, {pause: true, letter: true});
}
await walk(Array.from({length: 180}, (_, i) => [1 / 60, 1 / 144, 1 / 240, 1 / 90][i % 4]), {pause: true});
console.log(`Letter physics passed ${cases} movement cases: 30–360 Hz, variable frame times, inspection pause/resume, and letter collisions without false walk restarts.`);
