import assert from 'node:assert/strict';
import {createMusicVolumeFade} from '../src/music-volume-fade.js';

function clock() {
  let time = 0, serial = 0;
  const pending = new Map();
  return {
    now: () => time,
    requestFrame: callback => {const id = ++serial;pending.set(id, callback);return id;},
    cancelFrame: id => pending.delete(id),
    queued: () => [...pending.values()],
    tick: elapsed => {
      time += elapsed;
      const batch = [...pending.values()];pending.clear();
      batch.forEach(callback => callback(time));
    },
  };
}

const timing = clock(), fade = createMusicVolumeFade(timing);
const audio = {volume: .35};
let paused = 0, restored = 0;
fade.fade(audio, 0, {onComplete: () => paused++});
timing.tick(150);
assert(Math.abs(audio.volume - .175) < .000001, 'Music fades rather than cutting off');
assert.equal(paused, 0, 'Audio is not paused before the fade finishes');
timing.tick(150);
assert.equal(audio.volume, 0);assert.equal(paused, 1);
assert.equal(timing.queued().length, 0, 'A finished fade leaves no frame running');

audio.volume = .35;
fade.fade(audio, 0, {onComplete: () => paused++});
timing.tick(120);
const staleDuckFrame = timing.queued()[0], reversalVolume = audio.volume;
fade.fade(audio, .35, {onComplete: () => restored++});
staleDuckFrame();
assert.equal(paused, 1, 'A superseded duck cannot pause newly resumed music');
assert.equal(audio.volume, reversalVolume, 'Retargeting preserves the current volume');
timing.tick(300);
assert.equal(audio.volume, .35);assert.equal(restored, 1);

audio.volume = 0;
fade.fade(audio, .35, {onComplete: () => restored++});
timing.tick(100);
const staleResumeFrame = timing.queued()[0];
fade.cancel();
const manuallyPausedVolume = audio.volume;
staleResumeFrame();timing.tick(1000);
assert.equal(restored, 1, 'Manual pause/unmount cancellation cannot finish an old resume');
assert.equal(audio.volume, manuallyPausedVolume);
assert.equal(timing.queued().length, 0);

fade.fade(audio, 0, {onComplete: () => paused++});
timing.tick(300);
fade.fade(audio, .35, {duration: 0, onComplete: () => restored++});
assert.equal(audio.volume, .35);assert.equal(restored, 2);
fade.cancel();
console.log('Music fades passed: gradual duck, pause after silence, rapid reversal, stale-frame cancellation and immediate completion.');
