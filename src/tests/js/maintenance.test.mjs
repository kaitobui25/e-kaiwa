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

test('long press logs lifecycle, cancel duration, and five-second completion', () => {
  const button = new FakeTarget();
  const timers = fakeTimers();
  const events = [];
  let now = 1000;
  let completed = 0;
  new LongPressController(button, {
    durationMs: 5000,
    onComplete: () => completed++,
    onEvent: event => events.push(event),
    nowFn: () => now,
    setTimeoutFn: fn => timers.set(fn),
    clearTimeoutFn: id => timers.clear(id),
  });

  button.dispatch('pointerdown', {pointerId: 1});
  assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'pointerdown_received'));
  assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'pointer_capture_set'));
  assert.ok(events.some(event => event.event === 'update_press_start' && event.input === 'pointer'));
  assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'timer_scheduled'));

  now = 3134;
  button.dispatch('pointerup', {pointerId: 1});
  assert.equal(completed, 0);
  assert.equal(timers.ids().length, 0);
  const cancel = events.find(event => event.event === 'update_press_cancel');
  assert.equal(cancel.reason, 'pointerup');
  assert.equal(cancel.elapsed_ms, 2134);
  assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'pointerup_received'));
  assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'cancel_enter' && event.state === 'active'));
  assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'timer_cleared'));

  now = 5000;
  button.dispatch('pointerdown', {pointerId: 2});
  const [timerId] = timers.ids();
  now = 10004;
  timers.run(timerId);
  assert.equal(completed, 1);
  assert.equal(button.disabled, true);
  assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'timer_fired' && event.elapsed_ms === 5004));
  assert.equal(events.at(-1).event, 'update_press_complete');
  assert.equal(events.at(-1).elapsed_ms, 5004);
});

test('pointer cancellation records the browser event that cleared the timer', () => {
  const button = new FakeTarget();
  const timers = fakeTimers();
  const events = [];
  let now = 1000;
  new LongPressController(button, {
    durationMs: 5000,
    onEvent: event => events.push(event),
    nowFn: () => now,
    setTimeoutFn: fn => timers.set(fn),
    clearTimeoutFn: id => timers.clear(id),
  });

  button.dispatch('pointerdown', {pointerId: 9});
  now = 2600;
  button.dispatch('pointercancel', {pointerId: 9});

  assert.equal(timers.ids().length, 0);
  assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'pointercancel_received'));
  assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'timer_cleared' && event.reason === 'pointercancel'));
  assert.ok(events.some(event => event.event === 'update_press_cancel' && event.reason === 'pointercancel' && event.elapsed_ms === 1600));
});

test('timer scheduling exception is logged before it propagates', () => {
  const button = new FakeTarget();
  const events = [];
  let now = 1000;
  new LongPressController(button, {
    durationMs: 5000,
    onEvent: event => events.push(event),
    nowFn: () => now,
    setTimeoutFn: () => { throw new TypeError('timer boom'); },
  });

  assert.throws(() => button.dispatch('pointerdown', {pointerId: 4}), /timer boom/);
  assert.ok(events.some(event => event.event === 'update_press_start'));
  const failure = events.find(event => event.event === 'update_press_debug' && event.phase === 'timer_schedule_failed');
  assert.equal(failure.reason, 'timer boom');
  assert.equal(failure.elapsed_ms, 0);
  assert.equal(events.some(event => event.event === 'update_press_debug' && event.phase === 'timer_scheduled'), false);
});

test('maintenance controller pauses on active update and reloads on complete', async () => {
  const statuses = [
    {update_id: 'old', state: 'complete', progress: 100},
    {update_id: 'new', state: 'testing', progress: 60, message: 'Testing'},
    {update_id: 'new', state: 'complete', progress: 100, to_version: '0.4', failures: []},
  ];
  const overlayCalls = [];
  const events = [];
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
    logEvent: event => events.push(event),
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
  assert.ok(events.some(event => event.event === 'maintenance_pause' && event.update_id === 'new'));
  await controller.checkNow();
  assert.deepEqual(overlayCalls.at(-1), ['result', 'complete']);
  assert.ok(events.some(event => event.event === 'maintenance_result' && event.state === 'complete'));
  const ids = timers.ids();
  for (const id of ids) timers.run(id);
  assert.equal(reloaded, 1);
  controller.stop();
});

test('update request logs HTTP response and failure state', async () => {
  const button = new FakeTarget();
  const events = [];
  const overlayCalls = [];
  const timers = fakeTimers();
  const controller = new MaintenanceController({
    updateButton: button,
    overlay: {
      showResult: value => overlayCalls.push(value),
      hide() {},
    },
    logEvent: event => events.push(event),
    fetchFn: async url => {
      if (url === '/api/update') {
        return {ok: false, status: 503, json: async () => ({error: 'updater unavailable'})};
      }
      return {ok: true, status: 200, json: async () => ({state: 'idle'})};
    },
    documentRef: {hidden: false, addEventListener() {}, removeEventListener() {}},
    setTimeoutFn: fn => timers.set(fn),
    clearTimeoutFn: id => timers.clear(id),
  });

  await controller.triggerUpdate();
  assert.equal(events[0].event, 'update_request_sent');
  assert.equal(events[1].event, 'update_request_response');
  assert.equal(events[1].http_status, 503);
  assert.equal(events[2].event, 'update_request_failed');
  assert.equal(button.disabled, false);
  assert.equal(overlayCalls.at(-1).state, 'failed');
});
