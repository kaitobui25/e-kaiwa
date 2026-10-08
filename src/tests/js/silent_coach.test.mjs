import assert from 'node:assert/strict';
import test from 'node:test';
import {SilentCoachEngine} from '../../web/live/silent_coach.js';
import {SilentAudioStore} from '../../web/live/silent_audio_store.js';
import {SilentSegmenter} from '../../web/live/silent_segmenter.js';

const loud = new Int16Array(1600).fill(3000);
const quiet = new Int16Array(1600);

function fakeEnvironment({live = true, fallbackText = 'Did you finished your homework?', coachFailure = false, transcriptWaitMs = 5500} = {}) {
  const requests = [];
  const sockets = [];
  const saved = new Map();
  const changes = [];
  const store = {
    async save(key, pcm) { saved.set(key, new Int16Array(pcm)); },
    async load(key) { return saved.get(key) || null; },
    async remove(key) { saved.delete(key); }
  };
  const fetcher = async (url, options = {}) => {
    requests.push({url, body: options.body ? JSON.parse(options.body) : null});
    if (url === '/api/silent/session') {
      return {ok: true, async json() { return {token: 'TEST_TOKEN', session_id: 'abcdefghijklmnopqrstuvwxyz_123456', model: 'gemini-3.5-transcribe-live'}; }};
    }
    if (url === '/api/silent/transcribe') {
      return {ok: true, async json() { return {text: fallbackText, model: 'gemini-3.5-transcribe'}; }};
    }
    if (url === '/api/coach') {
      return coachFailure ? {ok: false, async json() { return {error: 'simulated coach failure'}; }} : {
        ok: true, async json() {
          return {correction: 'Did you finish your homework?', explanation: 'Use the base verb after did.', pronunciation: {overall_score: 82, problems: []}};
        }
      };
    }
    throw new Error('Unexpected request: ' + url);
  };
  const socketFactory = url => {
    const socket = {
      url, sent: [], readyState: 1, bufferedAmount: 0,
      send(data) { this.sent.push(JSON.parse(data)); },
      close() { this.readyState = 3; },
      emit(content) { this.onmessage({data: JSON.stringify(content)}); }
    };
    sockets.push(socket);
    return socket;
  };
  const engine = new SilentCoachEngine({
    fetcher, socketFactory, store,
    onChange: data => changes.push(data),
    delay: async () => {},
    transcriptWaitMs,
    targetLanguage: () => 'en'
  });
  return {engine, sockets, requests, changes, saved, live};
}

async function connected(env) {
  await env.engine.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.sockets.length, 1);
  env.sockets[0].onopen();
  assert.equal(env.sockets[0].sent[0].setup.model, 'models/gemini-3.5-transcribe-live');
  assert.deepEqual(env.sockets[0].sent[0].setup.generationConfig.responseModalities, ['TEXT']);
  assert.equal(env.sockets[0].sent[0].setup.inputAudioTranscription.mode, 'SMART');
  env.sockets[0].emit({setupComplete: {}});
}

async function spokenUtterance(env) {
  for (let i = 0; i < 5; i++) env.engine.feedPcm(loud);
  for (let i = 0; i < 10; i++) env.engine.feedPcm(quiet);
  await new Promise(resolve => setImmediate(resolve));
}

test('local VAD only emits speech segments and caps continuous speech', () => {
  const values = [];
  const detector = new SilentSegmenter(pcm => values.push(pcm), {maxMs: 1000});
  for (let i = 0; i < 20; i++) detector.feed(quiet);
  assert.equal(values.length, 0);
  for (let i = 0; i < 12; i++) detector.feed(loud);
  assert.equal(values.length, 1);
  assert.ok(values[0].length > 0);
});

test('IndexedDB-unavailable audio store uses bounded memory and removes processed audio', async () => {
  const store = new SilentAudioStore({indexedDB: null, maxMemoryBytes: 800});
  await store.save('one', new Int16Array(200));
  await store.save('two', new Int16Array(200));
  await store.save('three', new Int16Array(200));
  assert.equal(await store.load('one'), null);
  assert.equal((await store.load('three')).length, 200);
  await store.remove('two');
  assert.equal(await store.load('two'), null);
  await store.clear();
  assert.equal(await store.load('three'), null);
});

test('ten consecutive sentences are analyzed in background with only one final report', async () => {
  const env = fakeEnvironment();
  await connected(env);
  for (let index = 0; index < 10; index++) {
    await spokenUtterance(env);
    env.sockets[0].emit({serverContent: {
      inputTranscription: {text: 'Did you finished your homework?', languageCode: 'en-US'}
    }});
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.requests.filter(item => item.url === '/api/coach').length, 10);
  assert.ok(env.changes.every(change => change.report === null));
  const result = await env.engine.stop();
  assert.equal(result.total, 10);
  assert.equal(result.corrected, 10);
  assert.equal(result.items.length, 10);
  assert.equal(env.changes.filter(change => change.report !== null).length, 1);
});

test('silent transcription streams SMART TEXT, grades final utterances and hides report until stop', async () => {
  const env = fakeEnvironment();
  await connected(env);
  env.sockets[0].emit({serverContent: {interimInputTranscription: {text: 'Did you'}}});
  await spokenUtterance(env);
  assert.equal(env.requests.filter(item => item.url === '/api/coach').length, 0);
  env.sockets[0].emit({serverContent: {inputTranscription: {text: 'Did you finished your homework?', languageCode: 'en-US'}}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.requests.filter(item => item.url === '/api/coach').length, 1);
  assert.ok(env.changes.every(change => change.report === null));
  assert.equal(env.requests.find(item => item.url === '/api/coach').body.silent_private, true);
  const result = await env.engine.stop();
  assert.equal(result.total, 1);
  assert.equal(result.corrected, 1);
  assert.equal(result.score, 82);
  assert.equal(env.changes.at(-1).state, 'complete');
  assert.equal(env.saved.size, 0);
  assert.ok(env.sockets[0].sent.some(item => item.realtimeInput?.audioStreamEnd));
  assert.ok(env.sockets[0].sent.some(item => item.realtimeInput?.audio));
  assert.ok(env.sockets[0].sent.every(item => !item.setup || !item.setup.outputAudioTranscription));
});

test('falls back to audio-only SMART when a finalized live transcript is missing', async () => {
  const env = fakeEnvironment();
  await connected(env);
  await spokenUtterance(env);
  const report = await env.engine.stop();
  assert.equal(env.requests.filter(item => item.url === '/api/silent/transcribe').length, 1);
  assert.equal(env.requests.filter(item => item.url === '/api/coach').length, 1);
  assert.equal(report.total, 1);
  assert.equal(report.corrected, 1);
});

test('a stalled live transcript automatically falls back while still recording', async () => {
  const env = fakeEnvironment({transcriptWaitMs: 1});
  await connected(env);
  await spokenUtterance(env);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(env.engine.isRecording, true);
  assert.equal(env.requests.filter(item => item.url === '/api/silent/transcribe').length, 1);
  assert.ok(env.changes.every(change => change.report === null));
  const report = await env.engine.stop();
  assert.equal(report.total, 1);
});

test('does not invent a score when Coach fails', async () => {
  const env = fakeEnvironment({coachFailure: true});
  await connected(env);
  await spokenUtterance(env);
  env.sockets[0].emit({serverContent: {inputTranscription: {text: 'I like English.', languageCode: 'en-US'}}});
  const report = await env.engine.stop();
  assert.equal(report.score, null);
  assert.equal(report.failed, 1);
  assert.equal(report.items[0].status, 'error');
});

test('skips a clearly non-target-language utterance', async () => {
  const env = fakeEnvironment();
  await connected(env);
  await spokenUtterance(env);
  env.sockets[0].emit({serverContent: {inputTranscription: {text: 'Xin chào', languageCode: 'vi-VN'}}});
  const report = await env.engine.stop();
  assert.equal(report.total, 1);
  assert.equal(report.items.length, 0);
  assert.match(report.summary, /ngoài ngôn ngữ học/);
  assert.equal(report.score, null);
  assert.equal(env.requests.filter(item => item.url === '/api/coach').length, 0);
});

test('live connection failures trigger retry and bounded fallback mode', async () => {
  const env = fakeEnvironment();
  await connected(env);
  env.sockets[0].onclose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.sockets.length, 2);
  env.sockets[1].onclose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.sockets.length, 3);
  env.sockets[2].onclose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.engine.fallback, true);
  await spokenUtterance(env);
  const report = await env.engine.stop();
  assert.equal(report.total, 1);
  assert.equal(env.requests.filter(item => item.url === '/api/silent/transcribe').length, 1);
});
