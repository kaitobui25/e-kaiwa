import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../web/language_policy.js', import.meta.url), 'utf8');
const policy = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function turn(codes = [], userText = '') {
  return {
    inputLanguageCodes: new Set(codes),
    outputLanguageCodes: new Set(),
    userText,
    languageMode: 'unknown',
    coachEligible: true,
    coachSkipReason: null
  };
}

test('normalizes English regional codes', () => {
  assert.equal(policy.normalizeLanguageCode('en-US'), 'en');
  assert.equal(policy.normalizeLanguageCode('en-GB'), 'en');
});

test('classifies English language metadata as coach eligible', () => {
  const value = turn(['en-US'], 'Hello there.');
  assert.equal(policy.finalizeLanguageMode(value), 'english');
  assert.equal(value.coachEligible, true);
  assert.equal(value.coachSkipReason, null);
});

test('classifies Japanese and Vietnamese metadata as non-English', () => {
  for (const code of ['ja-JP', 'vi-VN']) {
    const value = turn([code], 'Hello there.');
    assert.equal(policy.finalizeLanguageMode(value), 'non_english');
    assert.equal(value.coachEligible, false);
    assert.equal(value.coachSkipReason, 'non_english_input');
  }
});

test('mixed English plus non-English metadata skips Coach', () => {
  const value = turn(['en-US', 'ja-JP'], 'Hello there.');
  assert.equal(policy.finalizeLanguageMode(value), 'non_english');
  assert.equal(policy.isCoachEligible(value), false);
});

test('missing language metadata falls back to English transcript text', () => {
  for (const text of [
    'Can you hear me?',
    "I'm learning English.",
    'Play this single song on loop.'
  ]) {
    const value = turn([], text);
    assert.equal(policy.finalizeLanguageMode(value), 'english');
    assert.equal(value.coachEligible, true);
    assert.equal(value.coachSkipReason, null);
  }
});

test('missing language metadata skips Coach for non-English or empty transcript text', () => {
  for (const text of [
    '日本語は難しい。',
    'Hôm nay trời đất đẹp.',
    '진짜 진짜',
    '재반이 is hot',
    ''
  ]) {
    const value = turn([], text);
    assert.equal(policy.finalizeLanguageMode(value), 'non_english');
    assert.equal(value.coachEligible, false);
    assert.equal(value.coachSkipReason, 'non_english_or_unknown_text');
  }
});

test('undefined language metadata also falls back to transcript text', () => {
  const english = turn(['und'], 'This is English.');
  assert.equal(policy.finalizeLanguageMode(english), 'english');
  assert.equal(english.coachEligible, true);

  const japanese = turn(['und'], 'これは日本語です。');
  assert.equal(policy.finalizeLanguageMode(japanese), 'non_english');
  assert.equal(japanese.coachEligible, false);
});

test('English transcript fallback only accepts ASCII English-form text', () => {
  assert.equal(policy.isEnglishText('Hello, how are you?'), true);
  assert.equal(policy.isEnglishText("Let's go!"), true);
  assert.equal(policy.isEnglishText('Hôm nay trời đẹp.'), false);
  assert.equal(policy.isEnglishText('日本語 is hard'), false);
  assert.equal(policy.isEnglishText('진짜 is real'), false);
  assert.equal(policy.isEnglishText('12345'), false);
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
