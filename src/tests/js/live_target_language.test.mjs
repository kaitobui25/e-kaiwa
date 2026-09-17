import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const liveSource = await readFile(new URL('../../web/live.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = liveSource.indexOf(startMarker);
  const end = liveSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return liveSource.slice(start, end);
}

test('target language change clears current conversation before reconnecting', () => {
  const source = sourceBetween(
    "elements.targetLanguage.addEventListener('change'",
    "elements.theme.addEventListener('change'"
  );
  assert.match(source, /const previousTarget = state\.selectedTargetLanguage/);
  assert.match(source, /if \(target === previousTarget\) return/);
  assert.ok(source.indexOf('clearConversationHistory()') < source.indexOf('requestSessionReconnect('));
  assert.ok(source.indexOf('endInputBeforeModeChange()') < source.indexOf('clearConversationHistory()'));
});
