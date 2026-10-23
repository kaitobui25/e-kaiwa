import assert from 'node:assert/strict';
import test from 'node:test';
import {archiveTurnRecordings, captureGeminiAudio, MAX_RECORDING_PCM_BYTES} from '../../web/live/recordings.js';

function turn(saveRecording = true) {
  return {
    saveRecording,
    sessionId: 'test-session-id',
    no: 1,
    replayPcm: Int16Array.from([10, -10, 250]),
    aiPcmBase64Chunks: [],
    aiPcmBytes: 0,
    aiRecordingOverflow: false
  };
}

test('archives the captured PCM and Gemini 24k PCM separately without delaying turn completion', async () => {
  const input = turn();
  const ai = Uint8Array.from([1, 0, 2, 0, 3, 0]);
  captureGeminiAudio(input, Buffer.from(ai.subarray(0, 2)).toString('base64'));
  captureGeminiAudio(input, Buffer.from(ai.subarray(2)).toString('base64'));
  const requests = [];
  let scheduled = null;
  archiveTurnRecordings(input, {
    schedule: callback => { scheduled = callback; },
    decode: value => Buffer.from(value, 'base64').toString('binary'),
    send: async (url, options) => { requests.push({url, options}); return {ok: true}; }
  });
  assert.equal(requests.length, 0, 'network work must be deferred');
  assert.equal(input.aiPcmBase64Chunks.length, 0, 'release streaming chunks on completion');
  scheduled();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  const user = requests.find(request => request.options.headers['X-Audio-Role'] === 'user');
  const output = requests.find(request => request.options.headers['X-Audio-Role'] === 'ai');
  assert.equal(user.url, '/api/recording');
  assert.equal(user.options.headers['X-Sample-Rate'], '16000');
  assert.deepEqual(new Uint8Array(user.options.body), new Uint8Array(input.replayPcm.buffer));
  assert.equal(output.options.headers['X-Sample-Rate'], '24000');
  assert.deepEqual(output.options.body, ai);
});

test('disabled recording never buffers Gemini audio or uploads a turn', () => {
  const input = turn(false);
  captureGeminiAudio(input, 'AAAA');
  assert.equal(input.aiPcmBase64Chunks.length, 0);
  archiveTurnRecordings(input, {schedule: () => { throw new Error('must not schedule'); }});
});

test('Gemini recording cap bounds memory even for many output chunks', () => {
  const input = turn();
  const chunk = 'A'.repeat(4096);
  for (let i = 0; i < 2000; i++) captureGeminiAudio(input, chunk);
  assert.equal(input.aiRecordingOverflow, true);
  assert.deepEqual(input.aiPcmBase64Chunks, []);
  assert.ok(input.aiPcmBytes <= MAX_RECORDING_PCM_BYTES);
});
