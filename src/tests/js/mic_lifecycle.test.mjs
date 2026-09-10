import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const liveSource = await readFile(new URL('../../web/live.js', import.meta.url), 'utf8');

function functionSource(startMarker, endMarker) {
  const start = liveSource.indexOf(startMarker);
  const end = liveSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return liveSource.slice(start, end);
}

test('Gemini session reconnect pauses microphone capture instead of releasing permission lease', () => {
  const source = functionSource('async function newLiveSession', 'async function startHandsFreeConversation');
  assert.match(source, /pauseMicCapture\(\)/);
  assert.doesNotMatch(source, /releaseMicCapture\(\)/);
});

test('push-to-talk release keeps microphone capture reusable for the next turn', () => {
  const source = functionSource('function endPushToTalk', 'function endInputBeforeModeChange');
  assert.match(source, /pauseMicCapture\(\)/);
  assert.doesNotMatch(source, /releaseMicCapture\(\)/);
});

test('page teardown fully releases microphone hardware', () => {
  const source = functionSource("window.addEventListener('beforeunload'", 'async function bootstrap');
  assert.match(source, /releaseMicCapture\(\)/);
});
