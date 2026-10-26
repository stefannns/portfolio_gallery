import assert from 'node:assert/strict';
import {attachRoomMovementInput} from '../src/room-movement-input.js';

// Two-phase surface models a dialog stopping events before they bubble to window.
class Surface {
  listeners = new Map();
  hidden = false;
  addEventListener(type, listener, capture = false) {
    const list = this.listeners.get(type) || [];
    list.push({listener, capture: capture === true});this.listeners.set(type, list);
  }
  removeEventListener(type, listener, capture = false) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value.listener !== listener || value.capture !== (capture === true)));
  }
  send(type, values = {}, stoppedByDialog = false) {
    const event = {target: {tagName: 'DIV'}, defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}, ...values};
    const list = this.listeners.get(type) || [];
    for (const {listener} of list.filter(value => value.capture)) listener(event);
    if (!stoppedByDialog) for (const {listener} of list.filter(value => !value.capture)) listener(event);
    return event;
  }
  count() {return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0);}
}

const windowTarget = new Surface(), documentTarget = new Surface();
const engine = {keys: new Set(), moving: false, paused: false, joystick: {x: 0, z: 0}};
let route = ['old destination'], press = {pointerId: 1}, focuses = 0, inspections = 0, status = '', cancelled = 0;
let state = {paused: false, editable: false, dragging: false,
  finishDrag: () => cancelled++, inspectNearby: () => {inspections++;return true;}, onStatus: text => {status = text;}};
const clear = () => {engine.keys.clear();engine.moving = false;engine.joystick.x = engine.joystick.z = 0;route = [];press = null;};
const stop = attachRoomMovementInput({windowTarget, documentTarget, engine, readState: () => state,
  cancelRoute: () => {route = [];press = null;}, clear, focusStage: () => focuses++});

windowTarget.send('keydown', {code: 'KeyW'});
assert(engine.keys.has('KeyW'));assert.equal(focuses, 1);assert.deepEqual(route, []);assert.equal(press, null);
windowTarget.send('keyup', {code: 'KeyW'}, true);
assert.equal(engine.keys.size, 0, 'A dialog stopping bubbling cannot swallow movement release');

windowTarget.send('keydown', {code: 'KeyD'});
clear();state = {...state, paused: true};engine.paused = true;
windowTarget.send('keydown', {code: 'KeyW'});
windowTarget.send('room-joystick', {detail: {x: 1, z: -1}});
windowTarget.send('keydown', {code: 'KeyE'});
assert.equal(engine.keys.size, 0);assert.deepEqual(engine.joystick, {x: 0, z: 0});assert.equal(inspections, 0);
state = {...state, paused: false};engine.paused = false;
windowTarget.send('keydown', {code: 'KeyD', repeat: true});
assert.equal(engine.keys.size, 0, 'Held keys cannot restart walking after a project closes');
windowTarget.send('keyup', {code: 'KeyD'}, true);
windowTarget.send('keydown', {code: 'KeyD'});
assert(engine.keys.has('KeyD'), 'Fresh movement works immediately after a project closes');
windowTarget.send('keyup', {code: 'KeyD'});
assert.equal(engine.keys.size, 0);

state = {...state, inspectNearby: () => {inspections += 10;return true;}};
windowTarget.send('keydown', {code: 'KeyE'});
windowTarget.send('keydown', {code: 'KeyE', repeat: true});
assert.equal(inspections, 10, 'Inspection uses the latest callback without a new input subscription');
state = {...state, inspectNearby: () => false};
windowTarget.send('keydown', {code: 'KeyE'});
assert.equal(status, 'Move closer to inspect.');
windowTarget.send('keydown', {key: 'Escape'});
assert.equal(cancelled, 0);state = {...state, dragging: true};
windowTarget.send('keydown', {key: 'Escape'});
assert.equal(cancelled, 1);state = {...state, dragging: false};

windowTarget.send('keydown', {code: 'KeyW', target: {tagName: 'INPUT'}});
windowTarget.send('keydown', {code: 'KeyW', defaultPrevented: true});
assert.equal(engine.keys.size, 0, 'Form and already-handled keys do not move the player');
windowTarget.send('room-joystick', {detail: {x: 4, z: NaN}});
assert.deepEqual(engine.joystick, {x: 1, z: 0});
windowTarget.send('keydown', {code: 'KeyA'});engine.moving = true;route = ['stale'];
windowTarget.send('blur');
assert.equal(engine.keys.size, 0);assert.equal(engine.moving, false);assert.deepEqual(engine.joystick, {x: 0, z: 0});assert.deepEqual(route, []);
documentTarget.hidden = true;
windowTarget.send('keydown', {code: 'KeyW'});
assert.equal(engine.keys.size, 0);
documentTarget.send('visibilitychange');documentTarget.hidden = false;
assert.equal(windowTarget.count(), 4, 'Modal/target changes keep one input subscription');
stop();assert.equal(windowTarget.count(), 0);assert.equal(documentTarget.count(), 0);
windowTarget.send('keydown', {code: 'KeyW'});assert.equal(engine.keys.size, 0);
console.log('Room input lifecycle passed: swallowed releases, paused modal input, fresh resume, latest inspect, forms, joystick, blur and cleanup.');
