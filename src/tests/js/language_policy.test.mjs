import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../web/language_policy.js', import.meta.url), 'utf8');
const policy = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function turn(...codes) {
  return {
    inputLanguageCodes: new Set(codes),
    outputLanguageCodes: new Set(),
    languageMode: 'unknown',
    coachEligible: true,
    coachSkipReason: null
  };
}

test('normalizes English regional codes', () => {
  assert.equal(policy.normalizeLanguageCode('en-US'), 'en');
  assert.equal(policy.normalizeLanguageCode('en-GB'), 'en');
});

test('classifies English as coach eligible', () => {
  const value = turn('en-US');
  assert.equal(policy.finalizeLanguageMode(value), 'english');
  assert.equal(value.coachEligible, true);
  assert.equal(value.coachSkipReason, null);
});

test('classifies Japanese and Vietnamese as non-English', () => {
  for (const code of ['ja-JP', 'vi-VN']) {
    const value = turn(code);
    assert.equal(policy.finalizeLanguageMode(value), 'non_english');
    assert.equal(value.coachEligible, false);
    assert.equal(value.coachSkipReason, 'non_english_input');
  }
});

test('mixed English plus non-English skips Coach', () => {
  const value = turn('en-US', 'ja-JP');
  assert.equal(policy.finalizeLanguageMode(value), 'non_english');
  assert.equal(policy.isCoachEligible(value), false);
});

test('missing or undefined language code stays backward compatible', () => {
  const missing = turn();
  assert.equal(policy.finalizeLanguageMode(missing), 'unknown');
  assert.equal(missing.coachEligible, true);

  const undefinedCode = turn('und');
  assert.equal(policy.finalizeLanguageMode(undefinedCode), 'unknown');
  assert.equal(undefinedCode.coachEligible, true);
});

test('support language follows user setting, not detected input', () => {
  assert.equal(policy.selectedSupportLanguage('vi'), 'vi');
  assert.equal(policy.selectedSupportLanguage('ja'), 'ja');
  assert.equal(policy.selectedSupportLanguage('en'), 'vi');
});

test('records raw input and output language codes without duplicates', () => {
  const value = turn();
  policy.recordLanguageCode(value, 'ja-JP', 'input');
  policy.recordLanguageCode(value, 'ja-JP', 'input');
  policy.recordLanguageCode(value, 'en-US', 'output');
  assert.deepEqual([...value.inputLanguageCodes], ['ja-JP']);
  assert.deepEqual([...value.outputLanguageCodes], ['en-US']);
});

test('live instruction is versioned and pins the selected support language', () => {
  const vi = policy.buildLiveLanguageInstruction('vi');
  const ja = policy.buildLiveLanguageInstruction('ja');

  assert.match(vi, new RegExp(policy.LANGUAGE_POLICY_VERSION));
  assert.match(vi, /Vietnamese \(vi\)/);
  assert.match(ja, /Japanese \(ja\)/);
  assert.match(ja, /Never choose the rescue language from the detected input language/);
  assert.match(ja, /return immediately to English practice/);
});
