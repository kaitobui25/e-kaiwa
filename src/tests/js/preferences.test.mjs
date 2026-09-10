import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVERSATION_MODES,
  PreferencesStore,
  TARGET_LANGUAGE,
  detectDefaultAppLanguage,
  isHandsFreeMode,
  normalizeAppLanguage,
  normalizeConversationMode,
  normalizePlaybackRate,
  normalizeTargetLanguage,
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

test('server defaults cannot override browser-owned app language', () => {
  const storage = memoryStorage();
  const store = new PreferencesStore({storage, browserLanguage: 'ja-JP'});
  const value = store.load({appLanguage: 'vi'});
  assert.equal(value.appLanguage, 'ja');
});

test('theme and playback rate normalization fail closed to supported values', () => {
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('neon'), 'light');
  assert.equal(normalizePlaybackRate(1.2), 1.2);
  assert.equal(normalizePlaybackRate(3), 0.8);
});

test('push-to-talk is the default conversation mode', () => {
  const store = new PreferencesStore({storage: memoryStorage(), browserLanguage: 'ja-JP'});
  const value = store.load();
  assert.equal(value.conversationMode, CONVERSATION_MODES.PUSH_TO_TALK);
  assert.equal(normalizeConversationMode('unknown'), CONVERSATION_MODES.PUSH_TO_TALK);
  assert.equal(isHandsFreeMode(CONVERSATION_MODES.PUSH_TO_TALK), false);
});

test('conversation mode persists locally and normalizes to supported values', () => {
  const storage = memoryStorage();
  const first = new PreferencesStore({storage});
  first.load();
  assert.equal(first.setConversationMode(CONVERSATION_MODES.HANDS_FREE), CONVERSATION_MODES.HANDS_FREE);

  const second = new PreferencesStore({storage});
  const value = second.load();
  assert.equal(value.conversationMode, CONVERSATION_MODES.HANDS_FREE);
  assert.equal(isHandsFreeMode(value.conversationMode), true);
  assert.equal(normalizeConversationMode('bad', CONVERSATION_MODES.HANDS_FREE), CONVERSATION_MODES.HANDS_FREE);
});

test('preferences persist without coupling target language to app language', () => {
  const storage = memoryStorage();
  const first = new PreferencesStore({storage, browserLanguage: 'ja-JP'});
  first.load({playbackRate: 0.8, pronunciationEnabled: true});
  first.setAppLanguage('vi');
  first.setTheme('dark');
  first.setPlaybackRate(0.9);
  first.setPronunciationEnabled(false);
  first.setConversationMode(CONVERSATION_MODES.HANDS_FREE);
  first.setTargetLanguage('zh-CN');

  const second = new PreferencesStore({storage, browserLanguage: 'ja-JP'});
  const value = second.load();
  assert.equal(value.appLanguage, 'vi');
  assert.equal(value.theme, 'dark');
  assert.equal(value.playbackRate, 0.9);
  assert.equal(value.pronunciationEnabled, false);
  assert.equal(value.conversationMode, CONVERSATION_MODES.HANDS_FREE);
  assert.equal(value.targetLanguage, 'zh-Hans');
  assert.equal(TARGET_LANGUAGE, 'en');
  assert.equal(targetSpeechLocale(TARGET_LANGUAGE), 'en-US');
  assert.equal(targetSpeechLocale('ja'), 'ja-JP');
  assert.equal(targetSpeechLocale('zh-Hans'), 'zh-CN');
  assert.equal(normalizeTargetLanguage('cmn'), 'zh-Hans');
  assert.equal(normalizeTargetLanguage('unsupported'), 'en');
});
