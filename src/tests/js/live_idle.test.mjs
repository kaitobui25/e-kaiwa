import assert from 'node:assert/strict';
import test from 'node:test';

import {LiveIdleCoordinator} from '../../web/live_idle.js';

function fakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  const delays = new Map();
  return {
    set(fn, ms) {
      const id = nextId++;
      callbacks.set(id, fn);
      delays.set(id, ms);
      return id;
    },
    clear(id) {
      callbacks.delete(id);
      delays.delete(id);
    },
    run(id) {
      const fn = callbacks.get(id);
      callbacks.delete(id);
      delays.delete(id);
      fn?.();
    },
    ids() {
      return [...callbacks.keys()];
    },
    delay(id) {
      return delays.get(id);
    }
  };
}

test('idle coordinator arms using configured seconds', () => {
  const timers = fakeTimers();
  const idle = new LiveIdleCoordinator({
    timeoutSeconds: 180,
    setTimeoutFn: (fn, ms) => timers.set(fn, ms),
    clearTimeoutFn: id => timers.clear(id)
  });

  assert.equal(idle.arm(), true);
  const [id] = timers.ids();
  assert.equal(timers.delay(id), 180000);
  assert.equal(idle.armed, true);
});

test('rearming replaces the previous idle timer', () => {
  const timers = fakeTimers();
  const idle = new LiveIdleCoordinator({
    timeoutSeconds: 120,
    setTimeoutFn: (fn, ms) => timers.set(fn, ms),
    clearTimeoutFn: id => timers.clear(id)
  });

  idle.arm();
  const [first] = timers.ids();
  idle.arm();
  const [second] = timers.ids();

  assert.notEqual(second, first);
  assert.equal(timers.ids().includes(first), false);
  assert.equal(timers.delay(second), 120000);
});

test('timeout fires once and disarms itself', () => {
  const timers = fakeTimers();
  let calls = 0;
  const idle = new LiveIdleCoordinator({
    timeoutSeconds: 60,
    setTimeoutFn: (fn, ms) => timers.set(fn, ms),
    clearTimeoutFn: id => timers.clear(id),
    onTimeout: () => calls++
  });

  idle.arm();
  const [id] = timers.ids();
  timers.run(id);

  assert.equal(calls, 1);
  assert.equal(idle.armed, false);
});

test('zero disables idle timeout and reconfiguration cancels pending timer', () => {
  const timers = fakeTimers();
  const idle = new LiveIdleCoordinator({
    timeoutSeconds: 60,
    setTimeoutFn: (fn, ms) => timers.set(fn, ms),
    clearTimeoutFn: id => timers.clear(id)
  });

  idle.arm();
  assert.equal(timers.ids().length, 1);
  idle.setTimeoutSeconds(0);
  assert.equal(timers.ids().length, 0);
  assert.equal(idle.arm(), false);
});
