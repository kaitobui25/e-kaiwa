import assert from 'node:assert/strict';
import test from 'node:test';

import {OverlayState, UiOverlayController} from '../../web/ui_overlay.js';

class FakeElement {
  constructor({hidden = true} = {}) {
    this.hidden = hidden;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.innerHTML = '';
    this.focused = false;
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  replaceChildren() {
    this.innerHTML = '';
  }

  querySelector() {
    return null;
  }

  focus() {
    this.focused = true;
  }

  emit(type, event = {}) {
    this.listeners.get(type)?.(event);
  }
}

function installFakeDocument() {
  const listeners = new Map();
  const classes = new Set();
  global.document = {
    body: {
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value)
      }
    },
    addEventListener: (type, callback) => listeners.set(type, callback)
  };
  global.requestAnimationFrame = callback => callback();
  return {listeners, classes};
}

function sampleTurn() {
  return {
    no: 7,
    userText: 'I went to Kyoto with my friends.',
    replayPcm: new Int16Array([10, 20, 30]),
    coach: {
      correction: 'I went to Kyoto with my friends.',
      explanation: 'Good sentence.',
      pronunciation: {
        overall_score: 82,
        pronunciation_score: 80,
        problems: [{word: 'Kyoto', sound: 'key-oh-toe', tip: 'Keep the vowels clear.'}]
      }
    }
  };
}

function makeController({allowAudio = true} = {}) {
  const env = installFakeDocument();
  const root = new FakeElement();
  const backdrop = new FakeElement();
  const surface = new FakeElement({hidden: false});
  const dynamic = new FakeElement({hidden: false});
  const settingsPanel = new FakeElement();
  const settingsOpen = new FakeElement({hidden: false});
  const settingsClose = new FakeElement({hidden: false});
  const audioCalls = [];
  const controller = new UiOverlayController({
    mode: 'public',
    root,
    backdrop,
    surface,
    dynamic,
    settingsPanel,
    settingsOpen,
    settingsClose,
    translate: key => key,
    audioActionsAllowed: () => allowAudio,
    onAudioAction: (action, detail) => audioCalls.push({action, detail})
  });
  return {controller, root, backdrop, surface, dynamic, settingsPanel, settingsOpen, settingsClose, audioCalls, env};
}

test('overlay state keeps exactly one active view', () => {
  const state = new OverlayState();
  assert.deepEqual(state.snapshot(), {type: null, turnNo: null, problemIndex: 0});
  state.open('coach', {turnNo: 3});
  assert.deepEqual(state.snapshot(), {type: 'coach', turnNo: 3, problemIndex: 0});
  state.open('word', {turnNo: 3, problemIndex: 2});
  assert.deepEqual(state.snapshot(), {type: 'word', turnNo: 3, problemIndex: 2});
  state.close();
  assert.deepEqual(state.snapshot(), {type: null, turnNo: null, problemIndex: 0});
});

test('settings and dynamic overlays share one backdrop and close on outside click or Escape', () => {
  const {controller, root, backdrop, settingsPanel, settingsOpen, env} = makeController();
  controller.openSettings();
  assert.equal(root.hidden, false);
  assert.equal(settingsPanel.hidden, false);
  assert.equal(root.dataset.overlay, 'settings');
  assert.equal(settingsOpen.attributes.get('aria-expanded'), 'true');
  assert.equal(env.classes.has('overlay-open'), true);

  backdrop.emit('click');
  assert.equal(root.hidden, true);
  assert.equal(settingsPanel.hidden, true);
  assert.equal(env.classes.has('overlay-open'), false);

  controller.openCoach(sampleTurn());
  assert.equal(controller.state.type, 'coach');
  env.listeners.get('keydown')?.({key: 'Escape'});
  assert.equal(controller.state.type, null);
  assert.equal(root.hidden, true);
});

test('coach navigation reuses the overlay instead of stacking panels', () => {
  const {controller, root, dynamic} = makeController();
  const turn = sampleTurn();
  controller.openCoach(turn);
  assert.equal(root.dataset.overlay, 'coach');
  assert.match(dynamic.innerHTML, /score-hero/);

  controller.openCorrection(turn);
  assert.equal(controller.state.type, 'correction');
  assert.equal(root.dataset.overlay, 'correction');
  assert.match(dynamic.innerHTML, /compare-corrected/);

  controller.openWord(turn, 0);
  assert.equal(controller.state.type, 'word');
  assert.equal(controller.state.problemIndex, 0);
  assert.match(dynamic.innerHTML, /word-practice/);

  controller.openReplay(turn);
  assert.equal(controller.state.type, 'replay');
  assert.match(dynamic.innerHTML, /replay-view/);
});

test('overlay delegates audio intents without owning playback state', () => {
  const {controller, dynamic, audioCalls} = makeController();
  const turn = sampleTurn();
  controller.openWord(turn, 0);
  dynamic.emit('click', {
    target: {
      closest: selector => selector === '[data-audio-action]'
        ? {dataset: {audioAction: 'speak-problem', turn: '7', problem: '0'}}
        : null
    }
  });
  assert.deepEqual(audioCalls, [{action: 'speak-problem', detail: {turn: 7, problem: 0}}]);
});

test('replay overlay stays unavailable when manual audio is disabled', () => {
  const {controller, root} = makeController({allowAudio: false});
  controller.openReplay(sampleTurn());
  assert.equal(controller.state.type, null);
  assert.equal(root.hidden, true);
});
