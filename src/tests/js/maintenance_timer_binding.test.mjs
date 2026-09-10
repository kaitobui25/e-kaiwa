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

function withWindowBrandedTimers(run) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduled = null;
  const cleared = [];
  try {
    globalThis.setTimeout = function (fn, ms) {
      assert.equal(this, globalThis, 'setTimeout receiver must be Window/globalThis');
      scheduled = {id: 41, fn, ms};
      return scheduled.id;
    };
    globalThis.clearTimeout = function (id) {
      assert.equal(this, globalThis, 'clearTimeout receiver must be Window/globalThis');
      cleared.push(id);
    };
    run({getScheduled: () => scheduled, cleared});
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

test('default long-press timer preserves Window/globalThis receiver', () => {
  withWindowBrandedTimers(({getScheduled}) => {
    const button = new FakeTarget();
    const events = [];
    let completed = 0;
    new LongPressController(button, {
      durationMs: 5000,
      onEvent: event => events.push(event),
      onComplete: () => completed++,
    });

    button.dispatch('pointerdown', {pointerId: 7});
    const scheduled = getScheduled();
    assert.equal(scheduled.ms, 5000);
    assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'timer_scheduled'));

    scheduled.fn();
    assert.equal(completed, 1);
    assert.ok(events.some(event => event.event === 'update_press_debug' && event.phase === 'timer_fired'));
    assert.ok(events.some(event => event.event === 'update_press_complete'));
  });
});

test('maintenance polling default timers preserve Window/globalThis receiver', () => {
  withWindowBrandedTimers(({getScheduled, cleared}) => {
    const controller = new MaintenanceController({
      documentRef: {hidden: false, addEventListener() {}, removeEventListener() {}},
    });
    controller.running = true;

    controller._schedule();
    assert.equal(getScheduled().ms, 2000);
    assert.equal(controller.timer, 41);

    controller.stop();
    assert.deepEqual(cleared, [41]);
  });
});
