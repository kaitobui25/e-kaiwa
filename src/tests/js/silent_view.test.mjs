import assert from 'node:assert/strict';
import test from 'node:test';

import {SilentView, renderSilentReport} from '../../web/ui/silent_view.js';
import {installHorizontalSwipe} from '../../web/ui/swipe.js';
import {UiController} from '../../web/ui/controller.js';

class Element {
  constructor() {
    this.hidden = false;
    this.innerHTML = '';
    this.textContent = '';
    this.attributes = new Map();
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  setAttribute(key, value) {
    this.attributes.set(key, value);
  }

  removeAttribute(key) {
    this.attributes.delete(key);
  }

  getAttribute(key) {
    return this.attributes.get(key);
  }

  emit(type, details = {}) {
    for (const callback of this.listeners.get(type) || []) callback(details);
  }
}

function harness() {
  const keys = ['conversationCard', 'controlDock', 'silentPanel', 'silentDock', 'silentStart',
    'silentStop', 'silentStatus', 'silentProgress', 'silentProgressLabel', 'silentReturnHint',
    'silentReport', 'modeTalk',
    'modeSilent', 'experienceSwitch'];
  const elements = Object.fromEntries(keys.map(key => [key, new Element()]));
  const calls = [];
  const copy = {
    silentReady: 'Ready', silentListening: 'Listening privately', silentReviewing: 'Reviewing',
    silentComplete: 'Review ready', silentError: 'Error',
    silentAnalyzedCount: 'Analyzed: {done} / {total}',
    silentFinishToSwitch: 'Stop & Review before returning'
  };
  const view = new SilentView({
    elements,
    translate: key => copy[key] || key,
    onAction: (action, detail) => calls.push({action, detail})
  });
  return {elements, calls, view};
}

test('clickable modes update visible panels and emit one mode action', () => {
  const {elements, calls, view} = harness();
  assert.equal(elements.controlDock.hidden, false);
  assert.equal(elements.silentPanel.hidden, true);
  elements.modeSilent.emit('click');
  assert.equal(elements.controlDock.hidden, true);
  assert.equal(elements.conversationCard.hidden, true);
  assert.equal(elements.silentPanel.hidden, false);
  assert.equal(elements.silentDock.hidden, false);
  assert.equal(elements.modeSilent.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(calls, [{action: 'silent-mode-change', detail: {mode: 'silent'}}]);
  elements.modeSilent.emit('click');
  assert.equal(calls.length, 1);
  elements.modeTalk.emit('click');
  assert.equal(view.experienceMode, 'talk');
  assert.equal(elements.controlDock.hidden, false);
  assert.equal(elements.silentPanel.hidden, true);
  assert.equal(elements.modeTalk.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(calls.at(-1), {action: 'silent-mode-change', detail: {mode: 'talk'}});
});

test('start and stop gate progress and all feedback until review completes', () => {
  const {elements, calls, view} = harness();
  elements.modeSilent.emit('click');
  elements.silentStart.emit('click');
  assert.equal(view.state, 'listening');
  assert.equal(elements.silentStart.hidden, true);
  assert.equal(elements.silentStop.hidden, false);
  assert.equal(elements.silentProgress.hidden, true);
  assert.equal(elements.silentReport.hidden, true);
  assert.equal(elements.silentReport.innerHTML, '');
  assert.deepEqual(calls.at(-1), {action: 'silent-start', detail: undefined});

  view.setState('listening', {report: {summary: 'premature feedback'}});
  assert.equal(elements.silentReport.innerHTML, '');
  elements.silentStop.emit('click');
  assert.equal(view.state, 'reviewing');
  assert.equal(elements.silentProgress.hidden, false);
  assert.equal(elements.silentStop.hidden, true);
  assert.deepEqual(calls.at(-1), {action: 'silent-stop', detail: undefined});
  view.setState('reviewing', {progress: {captured: 4, analyzed: 2, pending: 2}});
  assert.equal(elements.silentProgress.value, 50);
  assert.equal(elements.silentProgressLabel.hidden, false);
  assert.match(elements.silentProgressLabel.textContent, /2 \/ 4/);
  assert.equal(elements.silentReport.hidden, true);

  view.setState('complete', {report: {summary: 'Review complete', totals: {total: 2, reviewed: 1, failed: 1}}});
  assert.equal(elements.silentProgress.hidden, true);
  assert.equal(elements.silentReport.hidden, false);
  assert.match(elements.silentReport.innerHTML, /Review complete/);
  assert.match(elements.silentReport.innerHTML, /1/);
  elements.silentStart.emit('click');
  assert.equal(elements.silentReport.innerHTML, '');
  assert.equal(elements.silentReport.hidden, true);
});

test('complete state cannot reveal feedback without a prior stop', () => {
  const {elements, view} = harness();
  view.setState('listening');
  view.setState('complete', {report: {summary: 'Must stay private'}});
  assert.equal(elements.silentReport.hidden, true);
  assert.equal(elements.silentReport.innerHTML, '');
});

test('switching to Talk is blocked while recording or reviewing', () => {
  const {elements, calls, view} = harness();
  elements.modeSilent.emit('click');
  elements.silentStart.emit('click');
  assert.equal(elements.modeTalk.disabled, true);
  elements.modeTalk.emit('click'); // Programmatic clicks must also respect the guard.
  assert.equal(view.experienceMode, 'silent');
  assert.match(elements.silentReturnHint.textContent, /Stop & Review before returning/);
  elements.silentStop.emit('click');
  elements.modeTalk.emit('click');
  assert.equal(view.experienceMode, 'silent');
  view.setState('complete', {report: {items: []}});
  assert.equal(elements.modeTalk.disabled, false);
  elements.modeTalk.emit('click');
  assert.equal(view.experienceMode, 'talk');
  assert.equal(calls.filter(call => call.action === 'silent-mode-change').length, 2);
});

test('horizontal swipe switches modes outside the Hold-to-Talk button only', () => {
  const {elements, calls, view} = harness();
  const ordinary = {closest: () => null};
  const button = {closest: selector => selector.includes('button') ? {} : null};
  const pointer = (x, y, target = ordinary) => ({
    isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y, target
  });
  elements.controlDock.emit('pointerdown', pointer(200, 100, button));
  elements.controlDock.emit('pointerup', pointer(60, 100, button));
  assert.equal(view.experienceMode, 'talk');
  elements.controlDock.emit('pointerdown', pointer(200, 100));
  elements.controlDock.emit('pointerup', pointer(60, 100));
  assert.equal(view.experienceMode, 'silent');
  elements.silentDock.emit('pointerdown', pointer(50, 100));
  elements.silentDock.emit('pointerup', pointer(180, 100));
  assert.equal(view.experienceMode, 'talk');
  assert.deepEqual(calls.map(call => call.detail?.mode), ['silent', 'talk']);
});

test('vertical gestures, short drags and cancelled gestures do not navigate', () => {
  const element = new Element();
  const detected = [];
  const dispose = installHorizontalSwipe(element, direction => detected.push(direction));
  const target = {closest: () => null};
  const pointer = (type, x, y) => element.emit(type, {button: 0, pointerId: 5, clientX: x, clientY: y, target});
  pointer('pointerdown', 200, 100);
  pointer('pointerup', 180, 100);
  pointer('pointerdown', 200, 100);
  pointer('pointerup', 90, 190);
  pointer('pointerdown', 200, 100);
  pointer('pointercancel', 200, 100);
  pointer('pointerup', 80, 100);
  assert.deepEqual(detected, []);
  dispose();
  pointer('pointerdown', 200, 100);
  pointer('pointerup', 80, 100);
  assert.deepEqual(detected, []);
});

test('final report displays per-segment feedback, partial failures and escapes unsafe text', () => {
  const html = renderSilentReport({
    summary: 'A complete review',
    totals: {total: 2, reviewed: 1, failed: 1},
    items: [
      {no: 1, text: '<script>alert(1)</script>', correction: 'I went home.',
        explanation: 'Use the past tense', pronunciation: {overall_score: 88, summary: 'Clear'}},
      {no: 2, text: 'Second segment', status: 'failed', error: 'Service temporarily unavailable'}
    ]
  }, key => key);
  assert.match(html, /I went home/);
  assert.match(html, /Service temporarily unavailable/);
  assert.match(html, /88\/100/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<details class="silent-item-details">/);
  assert.doesNotMatch(html, /<details class="silent-item-details" open/);
  assert.match(html, /data-silent-audio="suggestion"/);
  assert.match(html, /data-silent-audio="original"/);
  assert.match(html, /disabled/, 'audio from older reports without a captured PCM must be disabled');
});

test('compact Silent report shows two audio buttons and disclosure of hidden details', () => {
  const html = renderSilentReport({items: [{
    no: 4, text: 'I goes home', correction: 'I go home', status: 'done',
    audioAvailable: true, explanation: 'Use go with I',
    pronunciation: {overall_score: 92, summary: 'Clear speech'}
  }]}, key => key);
  assert.match(html, /silent-compact-row/);
  assert.match(html, /I goes home/);
  assert.match(html, /I go home/);
  assert.match(html, /data-silent-audio="original" data-segment="4"/);
  assert.match(html, /data-silent-audio="suggestion" data-segment="4"/);
  assert.match(html, /<details class="silent-item-details">/);
  assert.match(html, /silent-details-toggle/);
  assert.match(html, /Use go with I/);
  assert.match(html, /92\/100/);
  assert.doesNotMatch(html, /data-silent-audio="original" data-segment="4"[^>]*disabled/);
});

test('audio clicks are delegated only after review and ignore disabled or invalid buttons', () => {
  const {elements, calls, view} = harness();
  const button = (kind, segment, disabled = false) => ({
    disabled, dataset: {silentAudio: kind, segment: String(segment)}
  });
  const click = control => elements.silentReport.emit('click', {
    target: {closest: () => control}
  });
  elements.modeSilent.emit('click');
  click(button('original', 1));
  assert.equal(calls.filter(call => call.action.startsWith('silent-replay')).length, 0);
  elements.silentStart.emit('click');
  elements.silentStop.emit('click');
  view.setState('complete', {report: {items: [{no: 1, text: 'hello', correction: 'Hello'}]}});
  click(button('original', 1));
  click(button('suggestion', 1));
  click(button('original', 1, true));
  click(button('original', 0));
  assert.deepEqual(calls.slice(-2), [
    {action: 'silent-replay-user', detail: {segment: 1}},
    {action: 'silent-speak-suggestion', detail: {segment: 1}}
  ]);
  view.setPlaybackStatus('Cannot play audio');
  assert.equal(elements.silentStatus.textContent, 'Cannot play audio');
  view.setPlaybackStatus();
  assert.equal(elements.silentStatus.textContent, 'Review ready');
});

test('engine flat summary reports correction counts, score and SMART caveat', () => {
  const html = renderSilentReport({
    total: 3, corrected: 1, failed: 1, score: 83,
    note: 'SMART may clean disfluencies',
    items: [{no: 1, text: 'I goes', correction: 'I go', status: 'done'}]
  }, key => key);
  assert.match(html, /83\/100/);
  assert.match(html, /silentCorrected/);
  assert.match(html, /SMART may clean disfluencies/);
  assert.match(html, /silentFailed/);
});

test('Silent Coach controls and reports have EN, JA and VI translations', () => {
  for (const language of ['en', 'ja', 'vi']) {
    const ui = {language};
    for (const key of ['silentCoach', 'silentStart', 'silentStop', 'silentListening', 'silentFallback',
      'silentReviewing', 'silentComplete', 'silentProgress', 'silentReportTitle', 'silentSegment',
      'silentYourSpeech', 'silentUnavailable', 'silentCorrected', 'silentFinishToSwitch',
      'silentPlayOriginal', 'silentPlaySuggested', 'silentShowDetails', 'silentAudioUnavailable']) {
      const localized = UiController.prototype.t.call(ui, key);
      assert.notEqual(localized, key, `${language} missing ${key}`);
    }
  }
});
