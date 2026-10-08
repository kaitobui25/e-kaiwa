// Full local Silent Coach simulation: finger swipe -> fake microphone -> fake
// Gemini WebSocket -> fake Coach HTTP -> one gated report after Stop.
import assert from 'node:assert/strict';
import test from 'node:test';
import {SilentCoachEngine} from '../../web/live/silent_coach.js';
import {SilentView} from '../../web/ui/silent_view.js';

class FakeElement {
  constructor() { this.hidden = false; this.innerHTML = ''; this.textContent = ''; this.handlers = new Map(); }
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); }
  removeEventListener(name, fn) { this.handlers.set(name, (this.handlers.get(name) || []).filter(value => value !== fn)); }
  setAttribute() {}
  removeAttribute() {}
  fire(name, data = {}) { for (const fn of this.handlers.get(name) || []) fn(data); }
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); }

test('emulated mobile swipe, microphone, live transcript, fallback and final report', async () => {
  const names = ['conversationCard', 'controlDock', 'silentPanel', 'silentDock', 'silentStart',
    'silentStop', 'silentStatus', 'silentProgress', 'silentReport', 'modeTalk',
    'modeSilent', 'experienceSwitch'];
  const elements = Object.fromEntries(names.map(key => [key, new FakeElement()]));
  const sockets = [];
  const network = [];
  const storage = new Map();
  let view;
  const engine = new SilentCoachEngine({
    delay: async () => {},
    store: {
      async clear() { storage.clear(); },
      async save(key, pcm) { storage.set(key, pcm); },
      async load(key) { return storage.get(key) || null; },
      async remove(key) { storage.delete(key); }
    },
    fetcher: async (url, params = {}) => {
      network.push(url);
      const body = params.body && JSON.parse(params.body);
      if (url.startsWith('/api/silent/session')) return {
        ok: true, async json() { return {token: 'EMULATED', session_id: 'abcdefghijklmnopqrstuvwxyz_123456'}; }
      };
      if (url === '/api/silent/log') return {ok: true};
      if (url === '/api/silent/transcribe') {
        assert.equal(body.sample_rate, 16000);
        return {ok: true, async json() { return {text: 'Can you helping me?'}; }};
      }
      if (url === '/api/coach') return {
        ok: true, async json() { return {
          correction: body.transcript === 'Can you helping me?' ? 'Can you help me?' : 'Did you finish your homework?',
          explanation: 'Use the base verb.', pronunciation: {overall_score: 80, problems: []}
        }; }
      };
      throw new Error('Unexpected URL ' + url);
    },
    socketFactory: () => {
      const socket = {
        sent: [], readyState: 1, bufferedAmount: 0,
        send(text) { this.sent.push(JSON.parse(text)); },
        close() { this.readyState = 3; },
        emit(message) { this.onmessage({data: JSON.stringify(message)}); }
      };
      sockets.push(socket);
      return socket;
    },
    onChange: data => view.setState(data.state, data)
  });
  const events = [];
  view = new SilentView({
    elements, translate: key => key,
    onAction: (action, detail) => {
      events.push(action);
      if (action === 'silent-start') void engine.start();
      if (action === 'silent-stop') void engine.stop();
    }
  });
  const pointer = (x, y) => ({pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, target: {closest: () => null}});
  elements.controlDock.fire('pointerdown', pointer(210, 60));
  elements.controlDock.fire('pointerup', pointer(30, 60));
  assert.equal(view.experienceMode, 'silent');
  elements.silentStart.fire('click');
  await flush();
  sockets[0].onopen();
  assert.deepEqual(sockets[0].sent[0].setup.generationConfig.responseModalities, ['TEXT']);
  sockets[0].emit({setupComplete: {}});
  const speech = new Int16Array(1600).fill(3200);
  const silence = new Int16Array(1600);
  for (let i = 0; i < 5; i++) engine.feedPcm(speech);
  for (let i = 0; i < 10; i++) engine.feedPcm(silence);
  await flush();
  sockets[0].emit({serverContent: {inputTranscription: {text: 'Did you finished your homework?', languageCode: 'en-US'}}});
  await flush();
  assert.equal(elements.silentReport.hidden, true);
  assert.equal(elements.silentReport.innerHTML, '');
  for (let i = 0; i < 5; i++) engine.feedPcm(speech);
  for (let i = 0; i < 10; i++) engine.feedPcm(silence);
  await flush();
  elements.silentStop.fire('click');
  await flush();
  await flush();
  assert.equal(view.state, 'complete');
  assert.equal(elements.silentReport.hidden, false);
  assert.match(elements.silentReport.innerHTML, /Did you finish your homework/);
  assert.match(elements.silentReport.innerHTML, /Can you help me/);
  assert.ok(network.includes('/api/silent/transcribe'));
  assert.equal(network.filter(url => url === '/api/coach').length, 2);
  assert.ok(events.includes('silent-start'));
  assert.ok(events.includes('silent-stop'));
  assert.equal(storage.size, 0);
});
