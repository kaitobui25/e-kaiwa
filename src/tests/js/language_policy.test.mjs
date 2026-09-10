import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../web/language_policy.js', import.meta.url), 'utf8');
const policy = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function turn(targetLanguage, codes = [], userText = '') {
  return {targetLanguage, inputLanguageCodes: new Set(codes), outputLanguageCodes: new Set(), userText, languageMode: 'unknown', coachEligible: true, coachSkipReason: null};
}

test('normalizes target aliases', () => {
  assert.equal(policy.normalizeTargetLanguage('en-US'), 'en');
  assert.equal(policy.normalizeTargetLanguage('ja-JP'), 'ja');
  assert.equal(policy.normalizeTargetLanguage('zh-CN'), 'zh-Hans');
  assert.equal(policy.normalizeTargetLanguage('cmn'), 'zh-Hans');
});

test('English baseline still accepts English metadata and English-only fallback text', () => {
  const fromMetadata = turn('en', ['en-GB'], 'Hello there.');
  assert.equal(policy.finalizeLanguageMode(fromMetadata), 'target');
  assert.equal(fromMetadata.coachEligible, true);

  for (const text of ['Can you hear me?', "I'm learning English.", 'Play this single song on loop.']) {
    const fromText = turn('en', ['und'], text);
    assert.equal(policy.finalizeLanguageMode(fromText), 'target');
  }
  assert.equal(policy.finalizeLanguageMode(turn('en', [], 'Hôm nay trời đẹp.')), 'non_target');
  assert.equal(policy.finalizeLanguageMode(turn('en', [], '日本語 is hard')), 'non_target');
});

test('records raw input and output language codes without duplicates', () => {
  const value = turn('en');
  policy.recordLanguageCode(value, 'ja-JP', 'input');
  policy.recordLanguageCode(value, 'ja-JP', 'input');
  policy.recordLanguageCode(value, 'en-US', 'output');
  assert.deepEqual([...value.inputLanguageCodes], ['ja-JP']);
  assert.deepEqual([...value.outputLanguageCodes], ['en-US']);
});

test('metadata matching each target is coach eligible', () => {
  for (const [target, code] of [['en', 'en-US'], ['ja', 'ja-JP'], ['zh-Hans', 'cmn-Hans']]) {
    const value = turn(target, [code]);
    assert.equal(policy.finalizeLanguageMode(value), 'target');
    assert.equal(value.coachEligible, true);
  }
});

test('non-target and mixed input skips Coach', () => {
  for (const value of [
    turn('en', ['vi-VN']),
    turn('en', ['fr-FR']),
    turn('en', ['en-US', 'vi-VN']),
    turn('ja', ['en-US']),
    turn('zh-Hans', ['zh-CN', 'ja-JP'])
  ]) {
    assert.equal(policy.finalizeLanguageMode(value), 'non_target');
    assert.equal(value.coachEligible, false);
    assert.equal(value.coachSkipReason, 'non_target_input');
  }
});

test('preference fallback is not used when evaluating detector codes', () => {
  assert.equal(policy.normalizeTargetLanguage('vi-VN'), 'en');
  const value = turn('en', ['vi-VN']);
  assert.equal(policy.finalizeLanguageMode(value), 'non_target');
  assert.equal(value.coachEligible, false);
});

test('unknown metadata uses deterministic target-looking text fallback', () => {
  assert.equal(policy.finalizeLanguageMode(turn('en', ['und'], 'Hello there.')), 'target');
  assert.equal(policy.finalizeLanguageMode(turn('ja', [], 'こんにちは')), 'target');
  assert.equal(policy.finalizeLanguageMode(turn('zh-Hans', [], '你好世界')), 'target');
  assert.equal(policy.finalizeLanguageMode(turn('zh-Hans', [], 'こんにちは')), 'non_target');
});

test('transcript concatenation preserves English spacing and CJK adjacency', () => {
  assert.equal(policy.concatTargetTranscript('Hello', 'world', 'en'), 'Hello world');
  assert.equal(policy.concatTargetTranscript('今日は', '天気です', 'ja'), '今日は天気です');
  assert.equal(policy.concatTargetTranscript('你好', '世界', 'zh-Hans'), '你好世界');
  assert.equal(policy.concatTargetTranscript('今日は天気です', '天気です', 'ja'), '今日は天気です');
});

test('support language remains independent and live instruction is target-specific', () => {
  const instruction = policy.buildLiveLanguageInstruction('vi', 'ja');
  assert.equal(policy.selectedSupportLanguage('ja'), 'ja');
  assert.match(instruction, new RegExp(policy.LANGUAGE_POLICY_VERSION));
  assert.match(instruction, /Japanese conversation partner/);
  assert.match(instruction, /Vietnamese \(vi\)/);
});
