import assert from 'node:assert/strict';
import {attachProjectEndGesture} from '../src/project-end-gesture.js';

class Element {
  constructor(parent = null, tagName = 'DIV', attrs = {}) {
    Object.assign(this, {parentElement: parent, tagName, attrs, nodeType: 1, scrollTop: 0,
      clientHeight: 400, scrollHeight: 1600, clientWidth: 600, scrollWidth: 600,
      overflowY: 'visible', overflowX: 'visible', listeners: new Map(),
      ownerDocument: {defaultView: {getComputedStyle: node => node}}});
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector === '[data-project-next]' ? node.attrs.next
        : ['BUTTON','A','INPUT','TEXTAREA','SELECT','VIDEO','IFRAME'].includes(node.tagName) || node.attrs.editable) return node;
    }
    return null;
  }
  matches(selector) {return selector === '[data-project-next]' && !!this.attrs.next;}
  addEventListener(type, handler, options) {this.listeners.set(type, {handler, options});}
  removeEventListener(type, handler) {if (this.listeners.get(type)?.handler === handler) this.listeners.delete(type);}
  send(type, values = {}) {
    const event = {target: this, cancelable: true, defaultPrevented: false,
      preventDefault() {this.defaultPrevented = true;}, ...values};
    this.listeners.get(type)?.handler(event);return event;
  }
}
function fixture() {
  const element = new Element();
  let time = 0, sequence = 0, advances = 0, progress = -1;
  let current = {projectKey: 'one', enabled: true};
  const timers = new Map();
  const setTimer = (handler, delay) => {const id = ++sequence;timers.set(id, {handler, due: time + delay});return id;};
  const clearTimer = id => timers.delete(id);
  const tick = amount => {
    const end = time + amount;
    while (true) {
      const next = [...timers.entries()].filter(([, value]) => value.due <= end).sort((a,b) => a[1].due - b[1].due)[0];
      if (!next) break;
      time = next[1].due;timers.delete(next[0]);next[1].handler();
    }
    time = end;
  };
  const stop = attachProjectEndGesture({element, readState: () => current,
    onAdvance: () => advances++, onProgress: value => {progress = value;}, now: () => time, setTimer, clearTimer});
  return {element, tick, stop, timers,
    bottom: () => {element.scrollTop = element.scrollHeight - element.clientHeight;},
    state: value => {current = {...current, ...value};},
    advances: () => advances, progress: () => progress,
    wheel: (deltaY, other = {}) => element.send('wheel', {deltaY, deltaX: 0, deltaMode: 0, ...other})};
}
const touch = (x, y, id = 1) => ({identifier: id, clientX: x, clientY: y});
const swipe = (f, distance, target = f.element, across = 0) => {
  const start = touch(200, 250), end = touch(200 + across, 250 - distance);
  f.element.send('touchstart', {target, touches: [start]});
  const move = f.element.send('touchmove', {target, touches: [end]});
  const up = f.element.send('touchend', {target, changedTouches: [end], touches: []});
  return {move, up};
};

// A normal scroll that reaches bottom never becomes an advance mid-burst.
{
  const f = fixture();
  assert.equal(f.wheel(160).defaultPrevented, false);
  f.bottom();f.tick(30);assert.equal(f.wheel(400).defaultPrevented, false);
  assert.equal(f.advances(), 0);assert.equal(f.progress(), 0);
  f.tick(180);assert.equal(f.wheel(210).defaultPrevented, true);
  assert.equal(f.advances(), 1, 'A fresh deliberate bottom gesture advances');f.stop();
}
// Trackpad accumulation, one advance, consumed momentum, cooldown and fresh burst.
{
  const f = fixture();f.bottom();
  assert.equal(f.wheel(80).defaultPrevented, true, 'The first weak bottom wheel is claimed while still cancelable');
  assert.equal(f.advances(), 0, 'Claiming bottom overscroll does not bypass the deliberate threshold');assert(f.progress() > .3);
  f.tick(30);f.wheel(80);f.tick(30);assert.equal(f.wheel(60).defaultPrevented, true);
  assert.equal(f.advances(), 1);
  f.state({projectKey: 'two'});f.element.scrollTop = 0;
  f.tick(40);assert.equal(f.wheel(350).defaultPrevented, true, 'Old momentum does not scroll the new project');
  assert.equal(f.advances(), 1);f.bottom();
  f.tick(200);f.wheel(250);assert.equal(f.advances(), 1, 'A fresh burst during cooldown cannot advance');
  f.tick(1000);f.wheel(220);assert.equal(f.advances(), 2);
  f.stop();assert.equal(f.timers.size, 0);assert.equal(f.element.listeners.size, 0);assert.equal(f.progress(), 0);
}
// A continuous stream still cannot skip repeatedly after cooldown expires.
{
  const f = fixture();f.bottom();f.wheel(250);f.state({projectKey: 'two'});
  for (let i = 0; i < 20; i++) {f.tick(100);f.wheel(250);}
  assert.equal(f.advances(), 1);f.tick(180);f.wheel(220);assert.equal(f.advances(), 2);f.stop();
}
// Mouse line/page deltas normalize, while horizontal, reverse and zoom gestures cancel.
{
  for (const [amount, deltaMode] of [[14,1],[1,2]]) {
    const f = fixture();f.bottom();f.wheel(amount, {deltaMode});assert.equal(f.advances(), 1);f.stop();
  }
  for (const extra of [{deltaX: 300}, {ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {defaultPrevented: true}]) {
    const f = fixture();f.bottom();f.wheel(250, extra);f.tick(30);f.wheel(300);
    assert.equal(f.advances(), 0, 'Rejected gestures cannot re-arm within the burst');f.stop();
  }
  const f = fixture();f.bottom();f.wheel(-20);f.wheel(300);assert.equal(f.advances(), 0);f.stop();
}
// Interactive/nested regions are left entirely alone; next footer is intentional surface.
{
  for (const tag of ['BUTTON','A','INPUT','TEXTAREA','SELECT','VIDEO','IFRAME']) {
    const f = fixture();f.bottom();const child = new Element(f.element, tag);
    assert.equal(f.wheel(300, {target: child}).defaultPrevented, false);assert.equal(f.advances(), 0);
    assert.equal(swipe(f, 130, child).move.defaultPrevented, false);assert.equal(f.advances(), 0);f.stop();
  }
  for (const axis of ['Y','X']) {
    const f = fixture();f.bottom();const nested = new Element(f.element);
    nested[`overflow${axis}`] = 'auto';if (axis === 'X') nested.scrollWidth = 1000;
    const child = new Element(nested);
    assert.equal(f.wheel(400, {target: child}).defaultPrevented, false);assert.equal(f.advances(), 0);f.stop();
  }
  const f = fixture();f.bottom();const footer = new Element(f.element, 'BUTTON', {next: true});
  f.wheel(250, {target: new Element(footer, 'SPAN')});assert.equal(f.advances(), 1);f.stop();
  const t = fixture();t.bottom();const button = new Element(t.element, 'BUTTON', {next: true});
  swipe(t, 125, new Element(button, 'SPAN'));assert.equal(t.advances(), 1);t.stop();
}
// Touch must physically begin at bottom, clear swipe threshold, and remain vertical.
{
  const f = fixture(), start = touch(100, 250), end = touch(100, 80);
  f.element.send('touchstart', {touches: [start]});f.bottom();
  assert.equal(f.element.send('touchmove', {touches: [end]}).defaultPrevented, false);
  f.element.send('touchend', {changedTouches: [end], touches: []});assert.equal(f.advances(), 0);
  assert.equal(swipe(f, 100).up.defaultPrevented, false);assert.equal(f.advances(), 0);
  const result = swipe(f, 115);assert.equal(result.move.defaultPrevented, true);assert.equal(result.up.defaultPrevented, true);
  assert.equal(f.advances(), 1);
  swipe(f, 160);assert.equal(f.advances(), 1, 'Cooldown blocks a second immediate swipe');
  f.tick(1000);swipe(f, 150, f.element, 140);assert.equal(f.advances(), 1, 'Horizontal swipes cancel');
  swipe(f, -80);assert.equal(f.advances(), 1, 'Downward swipes never advance');
  swipe(f, 130);assert.equal(f.advances(), 2);f.stop();
}
// Touch cancellation, multiple fingers, project switch and final project cannot advance.
{
  const f = fixture();f.bottom();const start = touch(100, 250), end = touch(100, 60);
  f.element.send('touchstart', {touches: [start]});f.element.send('touchcancel');
  f.element.send('touchend', {changedTouches: [end], touches: []});assert.equal(f.advances(), 0);
  f.element.send('touchstart', {touches: [start]});
  f.element.send('touchmove', {touches: [end, touch(150, 60, 2)]});
  f.element.send('touchend', {changedTouches: [end], touches: []});assert.equal(f.advances(), 0);
  f.element.send('touchstart', {touches: [start]});f.state({projectKey: 'two'});
  f.element.send('touchend', {changedTouches: [end], touches: []});assert.equal(f.advances(), 0);
  f.state({enabled: false});swipe(f, 150);f.wheel(500);assert.equal(f.advances(), 0);
  f.stop();f.stop();assert.equal(f.element.listeners.size, 0);
}
// Partial wheel intent expires visibly and cleanup cancels all scheduled work.
{
  const f = fixture();f.bottom();f.wheel(60);assert(f.progress() > 0);
  f.tick(180);assert.equal(f.progress(), 0);f.wheel(70);f.stop();f.tick(1000);assert.equal(f.progress(), 0);
  assert.equal(f.advances(), 0);
}
console.log('Project-end gestures passed: fresh-bottom intent, wheel/touch thresholds, momentum/cooldown, controls, nested scrollers, footer, project switches, final project and cleanup.');
