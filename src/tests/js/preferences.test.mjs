import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PreferencesStore,
  TARGET_LANGUAGE,
  detectDefaultAppLanguage,
  normalizeAppLanguage,
  normalizePlaybackRate,
  normalizeTheme,
  targetSpeechLocale
} from '../../web/preferences.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('public language defaults to Japanese except Vietnamese browser locale', () => {
  assert.equal(detectDefaultAppLanguage('ja-JP'), 'ja');
  assert.equal(detectDefaultAppLanguage('en-US'), 'ja');
  assert.equal(detectDefaultAppLanguage('vi-VN'), 'vi');
  assert.equal(normalizeAppLanguage('zh', 'ja'), 'ja');
});

test('theme and playback rate normalization fail closed to supported values', () => {
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('neon'), 'light');
  assert.equal(normalizePlaybackRate(1.2), 1.2);
  assert.equal(normalizePlaybackRate(3), 0.8);
});

test('preferences persist without coupling target language to app language', () => {
  const storage = memoryStorage();
  const first = new PreferencesStore({storage, browserLanguage: 'ja-JP'});
  first.load({playbackRate: 0.8, pronunciationEnabled: true});
  first.setAppLanguage('vi');
  first.setTheme('dark');
  first.setPlaybackRate(0.9);
  first.setPronunciationEnabled(false);

  const second = new PreferencesStore({storage, browserLanguage: 'ja-JP'});
  const value = second.load();
  assert.equal(value.appLanguage, 'vi');
  assert.equal(value.theme, 'dark');
  assert.equal(value.playbackRate, 0.9);
  assert.equal(value.pronunciationEnabled, false);
  assert.equal(value.targetLanguage, TARGET_LANGUAGE);
  assert.equal(TARGET_LANGUAGE, 'en');
  assert.equal(targetSpeechLocale(TARGET_LANGUAGE), 'en-US');
});
