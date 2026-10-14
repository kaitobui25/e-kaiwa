import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const live = await readFile(new URL('../../web/live/main.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../../web/live.html', import.meta.url), 'utf8');
const controller = await readFile(new URL('../../web/ui/controller.js', import.meta.url), 'utf8');

function section(start, end) {
  const from = live.indexOf(start);
  const to = live.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing section ${start}`);
  return live.slice(from, to);
}

test('voice control is part of public settings and is translated in all supported languages', () => {
  assert.ok(html.includes('id="ai-voice"'));
  assert.ok(html.indexOf('id="ai-voice"') < html.indexOf('id="ai-speed"'));
  for (const key of ['aiVoice', 'aiVoiceAuto', 'aiVoiceDescription', 'aiVoicePending', 'aiVoiceFallback']) {
    assert.equal((controller.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length, 3);
  }
});

test('Gemini Live setup uses selected voice in the generation config, preserving Auto', () => {
  const setup = section('socket.onopen = () => {', 'socket.onmessage =');
  assert.match(setup, /state\.activeAiVoice = normalizeAiVoice\(state\.selectedAiVoice\)/);
  assert.match(setup, /generationConfig: liveAudioGenerationConfig\(state\.activeAiVoice\)/);
  assert.match(setup, /sessionResumption: resumptionConfig/);
});

test('voice switch does not clear chat, interrupt microphone, or cut live playback', () => {
  const change = section("elements.aiVoice.addEventListener('change'", "elements.aiVolume.addEventListener('input'");
  assert.match(change, /state\.preferences\.setAiVoice\(elements\.aiVoice\.value\)/);
  assert.match(change, /voiceChangeMustWait\(\)/);
  assert.doesNotMatch(change, /endInputBeforeModeChange|clearConversationHistory|state\.playback\.clear\(/);
  const draining = section('function armPushToTalkAfterPlayback()', 'function finishTurn(');
  assert.match(draining, /voice_change_after_playback/);
  assert.match(draining, /state\.recovery\.clearHandle\(\)/);
  const finished = section('function finishTurn(', 'async function webSocketDataToText(');
  assert.match(finished, /sessionSettingsChanged\(\) && !voiceChangeMustWait\(\)/);
  const stop = section('function stopHandsFreeConversation()', 'async function beginPushToTalk()');
  assert.match(stop, /sessionSettingsChanged\(\)/);
  const replay = section('let played = true;', "elements.feedbackLanguage.addEventListener('change'");
  assert.match(replay, /state\.selectedAiVoice !== state\.activeAiVoice && !voiceChangeMustWait\(\)/);
  assert.match(replay, /requestSessionReconnect\(state\.ui\.t\('connecting'\)\)/);
  assert.match(change, /state\.practiceView !== 'talk'/);
});

test('unsupported voice can fall back to Auto exactly once without masking unrelated setup errors', () => {
  const error = section('if (message.error)', "if (Object.prototype.hasOwnProperty.call(message, 'setupComplete'))");
  assert.match(error, /isVoiceSetupError\(detail\)/);
  assert.match(error, /state\.preferences\.setAiVoice\(DEFAULT_AI_VOICE\)/);
  assert.match(error, /voice_fallback_auto/);
  assert.match(error, /retryWithRealtimeFallback\(detail\)/);
});
