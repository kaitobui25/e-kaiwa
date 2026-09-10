import test from 'node:test';
import assert from 'node:assert/strict';
import {LongPressController, MaintenanceController} from '../../web/maintenance.js';

class FakeTarget {
  constructor() {
    this.disabled = false;
    this.dataset = {};
    this.listeners = new Map();
  }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  dispatch(type, event = {}) { this.listeners.get(type)?.({preventDefault() {}, ...event}); }
  setPointerCapture() {}
}

function fakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    set(fn) { const id = nextId++; callbacks.set(id, fn); return id; },
    clear(id) { callbacks.delete(id); },
    run(id) { const fn = callbacks.get(id); callbacks.delete(id); fn?.(); },
    ids() { return [...callbacks.keys()]; },
  };
}

test('long press only completes after timer fires', () => {
  const button = new FakeTarget();
  const timers = fakeTimers();
  let completed = 0;
  new LongPressController(button, {
    durationMs: 5000,
    onComplete: () => completed++,
    setTimeoutFn: fn => timers.set(fn),
    clearTimeoutFn: id => timers.clear(id),
  });

  button.dispatch('pointerdown', {pointerId: 1});
  button.dispatch('pointerup', {pointerId: 1});
  assert.equal(completed, 0);
  assert.equal(timers.ids().length, 0);

  button.dispatch('pointerdown', {pointerId: 2});
  const [timerId] = timers.ids();
  timers.run(timerId);
  assert.equal(completed, 1);
  assert.equal(button.disabled, true);
});

test('maintenance controller pauses on active update and reloads on complete', async () => {
  const statuses = [
    {update_id: 'old', state: 'complete', progress: 100},
    {update_id: 'new', state: 'testing', progress: 60, message: 'Testing'},
    {update_id: 'new', state: 'complete', progress: 100, to_version: '0.3', failures: []},
  ];
  const overlayCalls = [];
  let paused = 0;
  let reloaded = 0;
  const timers = fakeTimers();
  const documentRef = {hidden: false, addEventListener() {}, removeEventListener() {}};
  const controller = new MaintenanceController({
    overlay: {
      showProgress: value => overlayCalls.push(['progress', value.progress]),
      showResult: value => overlayCalls.push(['result', value.state]),
      hide() {},
    },
    pauseForMaintenance: () => paused++,
    reload: () => reloaded++,
    fetchFn: async () => ({ok: true, status: 200, json: async () => statuses.shift()}),
    documentRef,
    setTimeoutFn: fn => timers.set(fn),
    clearTimeoutFn: id => timers.clear(id),
  });

  await controller.start();
  assert.equal(paused, 0, 'old complete status is baseline only');
  await controller.checkNow();
  assert.equal(paused, 1);
  assert.deepEqual(overlayCalls.at(-1), ['progress', 60]);
  await controller.checkNow();
  assert.deepEqual(overlayCalls.at(-1), ['result', 'complete']);
  const ids = timers.ids();
  for (const id of ids) timers.run(id);
  assert.equal(reloaded, 1);
  controller.stop();
});
