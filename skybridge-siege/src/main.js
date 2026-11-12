import { Duel } from './game/duel.mjs';
import { MotionCaster, MOTION_DEFAULTS } from './tracking/motions.mjs';
import { CALIBRATION_STEPS, Calibrator, clearCalibration, describeSettings, fitSettings, loadCalibration, saveCalibration } from './tracking/calibration.mjs';
import { CameraTracker, KeyboardSource } from './tracking/camera.js';
import { describeStartError } from './tracking/errors.mjs';
import { GameView } from './view/gameView.js';
import { Hud } from './view/hud.js';
import { Sfx } from './view/audio.js';

const $ = id => document.getElementById(id);

// An icon that has not been made yet (tools/build-icons.mjs) shows its emoji instead.
for (const img of document.querySelectorAll('img.icon')) {
  const fallback = () => {
    const span = document.createElement('span');
    span.className = `${img.className} icon-fallback`;
    span.setAttribute('aria-hidden', 'true');
    span.textContent = img.dataset.fallback;
    img.replaceWith(span);
  };
  if (img.complete && !img.naturalWidth) fallback();
  else img.addEventListener('error', fallback, { once: true });
}
const params = new URLSearchParams(location.search);

// Live tuning without code edits: ?pose=image  ?extend=1.2
const poseSource = params.get('pose') === 'image' ? 'image' : 'world';
const extendRatio = Number(params.get('extend')) || undefined;

const NO_HANDS = { left: null, right: null };
const AUTO_PAUSE_MS = 4000; // long enough to rest your arms between spells

const video = $('video');
const duel = new Duel();
// Thresholds fitted by calibration, if this device has any, on top of the defaults.
let calibration = loadCalibration();
const caster = new MotionCaster({ options: calibration?.settings ?? {}, poseSource, pose: extendRatio ? { extendRatio } : {} });
const hud = new Hud();
const sfx = new Sfx();
const camera = new CameraTracker(video);
const keyboard = new KeyboardSource();

let view = null;
let source = null;
let tracked = NO_HANDS;
let gesture = null;
let lastFrame = performance.now();
let lastHandSeen = 0;
let trackingPaused = false;
let frameRate = 60;
let startInFlight = false;
let calibrator = null; // set while the calibration routine runs

// Music starts with the first click or key (browsers allow audio only after one): softer on the
// title, fuller in the duel.
function startMusic() {
  sfx.unlock();
  sfx.startMusic();
}
window.addEventListener('pointerdown', startMusic, { once: true });
window.addEventListener('keydown', startMusic, { once: true });

function show(screen) {
  for (const id of ['title', 'end', 'calibrate-screen']) $(id).hidden = id !== screen;
  sfx.setMusicLevel(screen === 'title' ? 0.3 : 0.45);
  if (screen !== 'end') view?.lookUp(screen === 'title'); // the title looks at the sky; play rolls down
  $('hud').hidden = screen === 'title' || !source;
  document.body.classList.toggle('calibrating', screen === 'calibrate-screen');
}

function setTitleMessage(text, isError = false) {
  $('title-message').textContent = text;
  $('title-message').classList.toggle('error', isError);
}

function setBusy(busy, label = 'Start camera') {
  $('start-camera').disabled = busy;
  $('start-camera').textContent = label;
  $('start-keyboard').disabled = busy;
  $('calibrate').disabled = busy;
}

function resetInputState() {
  caster.reset();
  tracked = NO_HANDS;
  gesture = null;
  trackingPaused = false;
  lastHandSeen = performance.now();
}

/** Stops everything and returns to the title. The page never needs a reload. */
function endSession(message = '', isError = false) {
  camera.stop();
  source = null;
  calibrator = null;
  startInFlight = false;
  resetInputState();
  view?.clearHands();
  duel.reset();
  duel.drainEvents();
  hud.reset();
  hud.setPreviewVisible(false);
  setBusy(false);
  setTitleMessage(message, isError);
  showCalibrationStatus();
  show('title');
}

function beginSession(nextSource) {
  source = nextSource;
  resetInputState();
  duel.reset();
  duel.drainEvents();
  hud.reset();
  hud.setPreviewVisible(source.kind === 'camera');
  $('stop').setAttribute('aria-label', source.kind === 'camera' ? 'Stop camera and leave' : 'Leave duel');
  show('none');
}

/** Starts the camera, then the duel, or the calibration routine when calibrate is true. */
async function startCamera({ calibrate = false } = {}) {
  if (startInFlight) return;
  startInFlight = true;
  startMusic();
  setTitleMessage('');
  try {
    if (!view) throw Object.assign(new Error('3D graphics are unavailable'), { stage: 'graphics' });
    const started = await camera.start(stage => {
      setBusy(true, stage === 'model' ? 'Loading hand tracking…' : 'Waiting for the camera…');
    });
    if (started) {
      beginSession(camera);
      if (calibrate) startCalibration();
    }
  } catch (error) {
    console.error(error);
    endSession(describeStartError(error, error.stage), true);
  } finally {
    startInFlight = false;
  }
}

function startKeyboard() {
  if (!view) return;
  startMusic();
  setTitleMessage('');
  beginSession(keyboard);
}

// ---- Calibration: fits the thresholds to how this player moves (tracking/calibration.mjs) ----

function startCalibration() {
  calibrator = new Calibrator();
  calibrator.begin(0, performance.now());
  $('cal-steps').hidden = false;
  $('cal-summary').hidden = true;
  show('calibrate-screen');
  renderCalibration();
}

function renderCalibration() {
  if (!calibrator) return;
  if (calibrator.done) {
    if (!$('cal-summary').hidden) return;
    const settings = fitSettings(calibrator.measurements);
    calibrator.settings = settings;
    const rows = describeSettings(settings);
    $('cal-rows').innerHTML = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const value of [row.label, row.before, row.after]) {
        const td = document.createElement('td');
        td.textContent = String(value);
        tr.append(td);
      }
      $('cal-rows').append(tr);
    }
    if (!rows.length) $('cal-rows').innerHTML = '<tr><td colspan="3">Every step was skipped, so nothing changes.</td></tr>';
    $('cal-steps').hidden = true;
    $('cal-summary').hidden = false;
    return;
  }
  const step = calibrator.step;
  $('cal-count').textContent = `Step ${calibrator.index + 1} of ${CALIBRATION_STEPS.length}`;
  $('cal-title').textContent = step.title;
  $('cal-say').textContent = step.say;
  $('cal-bar').style.width = `${Math.round(calibrator.progress * 100)}%`;
  $('cal-tally').textContent = step.count ? `${calibrator.samples.length} of ${step.count}` : calibrator.progress >= 1 ? 'Done' : 'Hold…';
  $('cal-message').textContent = calibrator.message;
}

/** Applies thresholds to the live caster: the defaults, with any calibrated ones on top. */
function applySettings(settings = {}) {
  caster.options = { ...MOTION_DEFAULTS, ...settings };
  caster.reset();
}

function finishCalibration(save) {
  if (save && calibrator?.settings) {
    calibration = { savedAt: Date.now(), settings: calibrator.settings, measurements: calibrator.measurements };
    saveCalibration(calibration);
    applySettings(calibration.settings);
    calibrator = null;
    resetInputState();
    show('none'); // straight into the duel, camera still on
  } else {
    endSession('Calibration discarded.');
  }
}

function showCalibrationStatus() {
  $('calibration-status').hidden = !calibration;
}

function restart() {
  duel.restart();
  caster.reset();
  show('none');
}

function showEnd() {
  const won = duel.phase === 'victory';
  $('end').dataset.result = won ? 'victory' : 'defeat';
  const { stats } = duel;
  $('end-stats').textContent = `${stats.hitsLanded} hits landed, ${stats.warded} warded. Hexes: ${stats.blocks} blocked, ${stats.dodges} dodged, ${stats.hitsTaken} taken.`;
  $('end-hint').textContent = source?.kind === 'keyboard' ? 'Hold and release Space to duel again.' : 'Throw a fireball to duel again.';
  show('end');
}

function processInput(now) {
  const sample = source?.sample(now);
  if (!sample) return;
  tracked = sample.hands;
  const aspect = source.kind === 'camera' && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  gesture = caster.update(tracked, now, { aspect });
  view.setHands(tracked, gesture, now);
  hud.gestureHint(gesture.failed);

  const handCount = ['left', 'right'].filter(side => gesture.poses[side] !== 'missing').length;
  if (handCount > 0) lastHandSeen = now;

  const { aimRange } = duel.config.throw;
  if (calibrator) {
    // Measuring, not playing: no spell reaches the duel.
    calibrator.update(caster, gesture, now);
    renderCalibration();
  } else if (gesture.cast) {
    const { spell, hand, aim, dir } = gesture.cast;
    const wasEnded = duel.phase === 'victory' || duel.phase === 'defeat';
    // A Water Ball starts between the hands; other spells from the hand that cast them.
    const between = () => {
      const [a, b] = [view.handWorldPoint('left'), view.handWorldPoint('right')];
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 } : a ?? b;
    };
    const origin = hand === 'both' ? between() : view.handWorldPoint(hand);
    const result = duel.cast(spell, { origin, aimX: aim === undefined ? null : duel.player.x + aim * aimRange, dir });
    if (wasEnded && result.ok) show('none');
  }

  if (source.kind === 'camera') {
    hud.drawPreview(video, tracked);
    if (hud.showDebug) $('pose-readout').textContent = hud.poseReadout(tracked, gesture, poseSource);
  }
  const detail = source.kind === 'camera' ? `${Math.round(frameRate)} fps · tracking ${camera.delegate} ${camera.inferenceMs.toFixed(0)} ms` : `${Math.round(frameRate)} fps`;
  hud.setTracking(handCount, source.kind, detail);
}

function updateAutoPause(now) {
  if (source?.kind !== 'camera') return;
  const anyVisible = gesture && (gesture.poses.left !== 'missing' || gesture.poses.right !== 'missing');
  if (duel.phase === 'fighting' && !trackingPaused && now - lastHandSeen > AUTO_PAUSE_MS) {
    trackingPaused = true;
    duel.setPaused(true);
  } else if (trackingPaused && (anyVisible || duel.phase !== 'fighting')) {
    trackingPaused = false;
    duel.setPaused(false);
  }
}

function tick(now) {
  requestAnimationFrame(tick);
  if (!view) return;
  const dt = Math.min(50, now - lastFrame);
  lastFrame = now;
  if (dt > 0) frameRate += (1000 / dt - frameRate) * 0.05;

  try {
    if (source?.live) {
      processInput(now);
      updateAutoPause(now);
    }
  } catch (error) {
    console.error(error);
    endSession(`Hand tracking stopped (${error.message}). Start again.`, true);
    return;
  }

  keyboard.aimNx = Math.max(-1, Math.min(1, (duel.enemy.x - duel.player.x) / duel.config.throw.aimRange));
  duel.update(dt);
  const events = duel.drainEvents();
  view.handleEvents(events);
  if (source) {
    hud.handleEvents(events);
    events.forEach(event => sfx.play(event));
    const handCount = gesture ? ['left', 'right'].filter(side => gesture.poses[side] !== 'missing').length : 0;
    hud.update(duel, gesture, handCount, trackingPaused);
    if (events.some(event => event.type === 'victory' || event.type === 'defeat')) showEnd();
  }
  view.frame(dt, now);
}

function onKey(event, down) {
  if (event.repeat) return;
  const { code } = event;
  if (down && code === 'KeyM') toggleMute();
  if (down && code === 'Escape' && source && !calibrator) endSession(source.kind === 'camera' ? 'Camera stopped.' : '');
  if (down && code === 'KeyD' && source) hud.toggleDebug();
  if (down && code === 'KeyR' && source && (duel.phase === 'victory' || duel.phase === 'defeat' || duel.phase === 'fighting')) restart();
  if (source?.kind !== 'keyboard') return;

  if (code === 'Space') {
    event.preventDefault();
    keyboard.fist = down;
    if (!down) keyboard.play('throw');
  } else if (code === 'KeyW') keyboard.shield = down;
  else if (down && code === 'KeyE') keyboard.play('circle');
  else if (code === 'KeyQ') {
    keyboard.storm = down;
    if (!down) keyboard.play('slam');
  } else if (down && (code === 'ArrowLeft' || code === 'ArrowRight')) {
    // One hand swiped outward: one lane. Pressing again quickly queues another swipe.
    keyboard.play(code === 'ArrowLeft' ? 'dodge-left' : 'dodge-right');
  }
}

$('start-camera').addEventListener('click', () => startCamera());
$('calibrate').addEventListener('click', () => startCamera({ calibrate: true }));
$('cal-redo').addEventListener('click', () => { calibrator?.redo(performance.now()); renderCalibration(); });
$('cal-skip').addEventListener('click', () => { calibrator?.skip(performance.now()); renderCalibration(); });
$('cal-cancel').addEventListener('click', () => endSession('Calibration cancelled.'));
$('cal-save').addEventListener('click', () => finishCalibration(true));
$('cal-discard').addEventListener('click', () => finishCalibration(false));
$('calibration-reset').addEventListener('click', () => {
  clearCalibration();
  calibration = null;
  applySettings();
  showCalibrationStatus();
  setTitleMessage('Back to the default thresholds.');
});
$('start-keyboard').addEventListener('click', startKeyboard);
$('stop').addEventListener('click', () => endSession(source?.kind === 'camera' ? 'Camera stopped.' : ''));
$('again').addEventListener('click', restart);
$('leave').addEventListener('click', () => endSession(source?.kind === 'camera' ? 'Camera stopped.' : ''));
function toggleMute() {
  const muted = sfx.toggleMute();
  $('mute').classList.toggle('off', muted);
  $('mute').setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
}
$('mute').addEventListener('click', toggleMute);
window.addEventListener('keydown', event => onKey(event, true));
window.addEventListener('keyup', event => onKey(event, false));
window.addEventListener('resize', () => view?.resize());
window.addEventListener('pagehide', () => camera.stop());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (camera.live || startInFlight)) endSession('The camera stopped because you left this tab. Start again when you are ready.');
});
camera.onEnded = () => endSession('The camera disconnected. Reconnect it and start again.', true);

try {
  view = new GameView($('game'), duel);
} catch (error) {
  console.error(error);
  setTitleMessage('3D graphics are unavailable. Turn on hardware acceleration or WebGL in your browser, then reload this page.', true);
  $('start-camera').disabled = true;
  $('start-keyboard').disabled = true;
}
showCalibrationStatus();
show('title');
requestAnimationFrame(tick);

if (params.has('debug')) {
  window.__wizardDuel = { duel, caster, keyboard, camera, hud, get gesture() { return gesture; }, get source() { return source; }, get view() { return view; }, get calibrator() { return calibrator; }, startCalibration, finishCalibration };
}
