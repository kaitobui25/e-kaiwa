import assert from 'node:assert/strict';
import test from 'node:test';

import {LiveRecoveryCoordinator, durationToMilliseconds} from '../../web/live_recovery.js';

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
    ids() { return [...callbacks.keys()]; },
    delay(id) { return delays.get(id); },
  };
}

test('duration parser accepts Gemini duration shapes', () => {
  assert.equal(durationToMilliseconds('5s'), 5000);
  assert.equal(durationToMilliseconds(2.5), 2500);
  assert.equal(durationToMilliseconds({seconds: 3, nanos: 500_000_000}), 3500);
  assert.equal(durationToMilliseconds('invalid'), 0);
});

test('resumption stores only latest resumable handle and never exposes it for fresh setup', () => {
  const recovery = new LiveRecoveryCoordinator();
  assert.deepEqual(recovery.setupConfig({resume: false}), {});
  assert.equal(recovery.updateResumption({resumable: true, newHandle: 'first'}), true);
  assert.deepEqual(recovery.setupConfig({resume: true}), {handle: 'first'});
  assert.equal(recovery.updateResumption({resumable: true, newHandle: 'latest'}), true);
  assert.deepEqual(recovery.setupConfig({resume: true}), {handle: 'latest'});
  assert.equal(recovery.updateResumption({resumable: false, newHandle: 'bad'}), false);
  assert.deepEqual(recovery.setupConfig({resume: true}), {handle: 'latest'});
  recovery.clearHandle();
  assert.equal(recovery.hasHandle(), false);
  assert.deepEqual(recovery.setupConfig({resume: true}), {});
});

test('response watchdog is re-armed by valid traffic and cancelled on completion', () => {
  const timers = fakeTimers();
  const timedOut = [];
  const recovery = new LiveRecoveryCoordinator({
    responseTimeoutMs: 25000,
    setTimeoutFn: (fn, ms) => timers.set(fn, ms),
    clearTimeoutFn: id => timers.clear(id),
    onResponseTimeout: turnNo => timedOut.push(turnNo),
  });

  recovery.armResponseWatchdog(7);
  const first = timers.ids()[0];
  assert.equal(timers.delay(first), 25000);
  recovery.touchResponse(7);
  assert.equal(timers.ids().includes(first), false);
  const second = timers.ids()[0];
  timers.run(second);
  assert.deepEqual(timedOut, [7]);

  recovery.armResponseWatchdog(8);
  recovery.finishResponse(8);
  assert.equal(timers.ids().length, 0);
});

test('GoAway reconnects shortly before the server deadline', () => {
  const timers = fakeTimers();
  let reconnects = 0;
  const recovery = new LiveRecoveryCoordinator({
    reconnectLeadMs: 1200,
    setTimeoutFn: (fn, ms) => timers.set(fn, ms),
    clearTimeoutFn: id => timers.clear(id),
    onReconnectDue: () => reconnects++,
  });

  const schedule = recovery.scheduleGoAway('5s');
  assert.deepEqual(schedule, {remainingMs: 5000, delayMs: 3800});
  const [id] = timers.ids();
  assert.equal(timers.delay(id), 3800);
  timers.run(id);
  assert.equal(reconnects, 1);
});
