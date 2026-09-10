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
    this.isConnected = true;
    this.disabled = false;
    this.tabIndex = 0;
    this.children = [];
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  replaceChildren() {
    this.innerHTML = '';
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return this.children;
  }

  contains(node) {
    return this.children.includes(node);
  }

  closest(selector) {
    return selector.includes('[hidden]') && this.hidden ? this : null;
  }

  getClientRects() {
    return this.hidden ? [] : [{}];
  }

  focus() {
    this.focused = true;
    global.document.activeElement = this;
  }

  emit(type, event = {}) {
    this.listeners.get(type)?.(event);
  }
}

function installFakeDocument() {
  const listeners = new Map();
  const classes = new Set();
  global.document = {
    activeElement: null,
    body: {
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value)
      }
    },
    addEventListener: (type, callback) => listeners.set(type, callback),
    querySelectorAll: () => []
  };
  global.getComputedStyle = () => ({visibility: 'visible'});
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

function installDynamicMarkupHarness(dynamic) {
  let markup = '';
  let children = [];
  let scroll = {scrollTop: 0};
  let close = new FakeElement({hidden: false});
  Object.defineProperty(dynamic, 'innerHTML', {
    configurable: true,
    get: () => markup,
    set: value => {
      for (const child of children) child.isConnected = false;
      markup = String(value);
      scroll = {scrollTop: 0};
      close = new FakeElement({hidden: false});
      const actionMatch = markup.match(/data-audio-action="([^"]+)"/);
      children = actionMatch ? [new FakeElement({hidden: false})] : [];
      if (actionMatch) children[0].dataset.audioAction = actionMatch[1];
      dynamic.children = children;
    }
  });
  dynamic.querySelector = selector => selector === '.overlay-scroll' ? scroll : (selector === '.overlay-icon' ? close : null);
  dynamic.querySelectorAll = () => children;
  dynamic.contains = node => children.includes(node);
  return {getChildren: () => children, getScroll: () => scroll};
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

test('overlay restores focus to the opener after closing', () => {
  const {controller, settingsOpen, env} = makeController();
  global.document.activeElement = settingsOpen;
  controller.openSettings();
  env.listeners.get('keydown')?.({key: 'Escape', preventDefault() {}});
  assert.equal(settingsOpen.focused, true);
});

test('Tab containment skips disabled and hidden controls and wraps focus', () => {
  const {controller, settingsPanel, settingsClose, env} = makeController();
  const first = new FakeElement({hidden: false});
  const disabled = new FakeElement({hidden: false});
  disabled.disabled = true;
  const hidden = new FakeElement({hidden: true});
  const last = new FakeElement({hidden: false});
  settingsPanel.children = [first, disabled, hidden, last];
  controller.openSettings();

  global.document.activeElement = last;
  const forward = {key: 'Tab', shiftKey: false, preventDefault() { this.prevented = true; }};
  env.listeners.get('keydown')?.(forward);
  assert.equal(forward.prevented, true);
  assert.equal(global.document.activeElement, first);

  global.document.activeElement = first;
  const backward = {key: 'Tab', shiftKey: true, preventDefault() { this.prevented = true; }};
  env.listeners.get('keydown')?.(backward);
  assert.equal(backward.prevented, true);
  assert.equal(global.document.activeElement, last);
  assert.notEqual(global.document.activeElement, disabled);
  assert.notEqual(settingsClose, disabled);
});

test('detached opener falls back to the visible settings trigger', () => {
  const {controller, settingsOpen, env} = makeController();
  const opener = new FakeElement({hidden: false});
  global.document.activeElement = opener;
  controller.openSettings();
  opener.isConnected = false;
  env.listeners.get('keydown')?.({key: 'Escape', preventDefault() {}});
  assert.equal(settingsOpen.focused, true);
});

test('empty dialog traps Tab on the dialog itself', () => {
  const {controller, settingsPanel, env} = makeController();
  controller.openSettings();
  const event = {key: 'Tab', shiftKey: false, preventDefault() { this.prevented = true; }};
  env.listeners.get('keydown')?.(event);
  assert.equal(event.prevented, true);
  assert.equal(settingsPanel.focused, true);
});

test('refresh replaces focused action while preserving its identity and scroll position', () => {
  const {controller, dynamic} = makeController();
  const harness = installDynamicMarkupHarness(dynamic);
  const firstTurn = sampleTurn();
  controller.openWord(firstTurn, 0);
  const oldAction = harness.getChildren()[0];
  global.document.activeElement = oldAction;
  harness.getScroll().scrollTop = 42;

  const updated = sampleTurn();
  updated.coach.pronunciation.problems[0].tip = 'Updated tip.';
  controller.refresh([updated]);

  const replacement = harness.getChildren()[0];
  assert.equal(oldAction.isConnected, false);
  assert.notEqual(replacement, oldAction);
  assert.equal(global.document.activeElement, replacement);
  assert.equal(harness.getScroll().scrollTop, 42);
});

test('unchanged refresh does not replace markup or steal focus', () => {
  const {controller, dynamic} = makeController();
  const harness = installDynamicMarkupHarness(dynamic);
  const turn = sampleTurn();
  controller.openWord(turn, 0);
  const action = harness.getChildren()[0];
  global.document.activeElement = action;
  let replacements = 1;
  const originalSetter = Object.getOwnPropertyDescriptor(dynamic, 'innerHTML').set;
  Object.defineProperty(dynamic, 'innerHTML', {
    configurable: true,
    get: () => dynamic._markup || '',
    set: value => { replacements += 1; dynamic._markup = value; originalSetter(value); }
  });
  controller.refresh([turn]);
  assert.equal(replacements, 1);
  assert.equal(global.document.activeElement, action);
});

test('detached dynamic opener restores to the matching replacement action', () => {
  const {controller, settingsOpen, env} = makeController();
  const opener = new FakeElement({hidden: false});
  opener.dataset = {uiAction: 'open-coach', turn: '7'};
  const replacement = new FakeElement({hidden: false});
  replacement.dataset = {uiAction: 'open-coach', turn: '7'};
  global.document.activeElement = opener;
  global.document.querySelectorAll = () => [replacement];
  controller.openSettings();
  opener.isConnected = false;
  env.listeners.get('keydown')?.({key: 'Escape', preventDefault() {}});
  assert.equal(replacement.focused, true);
  assert.equal(settingsOpen.focused, false);
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
