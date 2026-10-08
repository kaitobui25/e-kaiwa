import assert from 'node:assert/strict';
import test from 'node:test';
import {SilentEventLogger} from '../../web/live/silent_log.js';
import {SilentCoachEngine} from '../../web/live/silent_coach.js';

const SESSION = 'abcdefghijklmnopqrstuvwxyz_123456';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('logs are sent in sequence to one session and never include microphone or token payloads', async () => {
  const sent = [];
  const logger = new SilentEventLogger({
    fetcher: async (url, options) => {
      assert.equal(url, '/api/silent/log');
      sent.push(JSON.parse(options.body));
      return {ok: true};
    }
  });
  logger.log('silent_start', {model: 'gemini-3.5-transcribe-live'});
  logger.log('silent_segment_captured', {turn: 1, pcm_bytes: 3200});
  assert.equal(sent.length, 0, 'do not send until a valid session has been issued');
  logger.setSession(SESSION);
  await tick();
  assert.deepEqual(sent.map(row => row.sequence), [1, 2]);
  assert.deepEqual(sent.map(row => row.event), ['silent_start', 'silent_segment_captured']);
  assert.ok(sent.every(row => row.session_id === SESSION));
  assert.ok(sent.every(row => !JSON.stringify(row).includes('audio/pcm')));
});

test('transient log transport errors retry without rejecting microphone work', async () => {
  const received = [];
  let online = false;
  const logger = new SilentEventLogger({
    retryMs: 5,
    fetcher: async (_url, options) => {
      if (!online) throw new Error('offline');
      received.push(JSON.parse(options.body));
      return {ok: true};
    }
  });
  logger.setSession(SESSION);
  logger.log('silent_network_offline');
  await tick();
  assert.equal(logger.queue.length, 1);
  online = true;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'silent_network_offline');
  assert.equal(logger.queue.length, 0);
});

test('reconnecting Gemini Live reuses the same server session and logs final results', async () => {
  const emitted = [];
  const sockets = [];
  const responses = [];
  const pcmMap = new Map();
  const fetcher = async (url, options = {}) => {
    if (url.startsWith('/api/silent/session')) {
      responses.push(url);
      return {ok: true, json: async () => ({session_id: SESSION, token: 'ephemeral-token'})};
    }
    if (url === '/api/silent/log') {
      emitted.push(JSON.parse(options.body));
      return {ok: true};
    }
    if (url === '/api/silent/transcribe') {
      return {ok: true, json: async () => ({text: 'Did you finished it?'})};
    }
    if (url === '/api/coach') {
      return {ok: true, json: async () => ({
        correction: 'Did you finish it?', explanation: 'Use the base verb.',
        correction_effective_model: 'gemini-3.5-flash-lite',
        pronunciation_effective_model: 'gemini-3.5-flash-lite',
        pronunciation: {overall_score: 87, problems: []},
        coach_wall_s: 0.12
      })};
    }
    throw new Error(url);
  };
  const engine = new SilentCoachEngine({
    fetcher,
    delay: async () => {},
    store: {
      async clear() { pcmMap.clear(); },
      async save(key, value) { pcmMap.set(key, value); },
      async load(key) { return pcmMap.get(key); },
      async remove(key) { pcmMap.delete(key); }
    },
    socketFactory: () => {
      const socket = {
        readyState: 1, bufferedAmount: 0, send() {},
        close() { this.readyState = 3; }
      };
      sockets.push(socket);
      return socket;
    }
  });
  await engine.start();
  await tick();
  sockets[0].onopen();
  sockets[0].onmessage({data: JSON.stringify({setupComplete: {}})});
  sockets[0].onclose({code: 1006, reason: 'network'});
  await tick();
  assert.equal(sockets.length, 2);
  assert.equal(responses[1], `/api/silent/session?session_id=${SESSION}`);
  sockets[1].onopen();
  sockets[1].onmessage({data: JSON.stringify({setupComplete: {}})});
  const speech = new Int16Array(1600).fill(4000);
  const silence = new Int16Array(1600);
  for (let i = 0; i < 5; i++) engine.feedPcm(speech);
  for (let i = 0; i < 10; i++) engine.feedPcm(silence);
  await tick();
  sockets[1].onmessage({data: JSON.stringify({serverContent: {
    inputTranscription: {text: 'Did you finished it?', languageCode: 'en-US'}
  }})});
  await engine.stop();
  await tick();
  assert.ok(emitted.some(row => row.event === 'silent_ws_close'));
  assert.ok(emitted.some(row => row.event === 'silent_coach_result'));
  assert.ok(emitted.some(row => row.event === 'silent_review_complete'));
  assert.equal(new Set(emitted.map(row => row.session_id)).size, 1);
  assert.ok(!JSON.stringify(emitted).includes('ephemeral-token'));
  assert.ok(!JSON.stringify(emitted).includes('pcm_b64'));
});
