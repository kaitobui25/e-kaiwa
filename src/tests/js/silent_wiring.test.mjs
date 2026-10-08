import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const js = await readFile(new URL('../../web/live/main.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../../web/live.html', import.meta.url), 'utf8');

test('Silent Coach is connected to the existing mic stream and public UI without speech generation', () => {
  assert.match(js, /import \{SilentCoachEngine\}/);
  assert.match(js, /new SilentCoachEngine\(/);
  assert.match(js, /state\.silentCoach\.feedPcm\(floatToPcm16\(downsample\(/);
  assert.match(js, /if \(action === 'silent-mode-change'\)/);
  assert.match(js, /if \(action === 'silent-start'\)/);
  assert.match(js, /if \(action === 'silent-stop'\)/);
  assert.match(js, /state\.silentCoach\.stop\(\)/);
  assert.match(js, /state\.practiceView !== 'talk'/);
  assert.match(html, /id="silent-panel"/);
  assert.match(html, /id="mode-silent"/);
  assert.match(html, /id="silent-start"/);
  assert.match(html, /id="silent-stop"/);
});

test('Silent Coach report speakers use actual recorded PCM and suggested-sentence speech synthesis', () => {
  assert.match(js, /action === 'silent-replay-user' \|\| action === 'silent-speak-suggestion'/);
  assert.match(js, /state\.silentCoach\.getReplayPcm\(segment\)/);
  assert.match(js, /state\.playback\.playUserPcm\(pcm, 16000\)/);
  assert.match(js, /state\.playback\.speak\(suggestion/);
  assert.match(js, /targetSpeechLocale\(state\.selectedTargetLanguage\)/);
});
