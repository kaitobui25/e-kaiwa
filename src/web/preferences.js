export const SUPPORTED_APP_LANGUAGES = Object.freeze(['ja', 'vi']);
export const SUPPORTED_THEMES = Object.freeze(['light', 'dark']);
export const SUPPORTED_TARGET_LANGUAGES = Object.freeze(['en']);
export const CONVERSATION_MODES = Object.freeze({
  PUSH_TO_TALK: 'push_to_talk',
  HANDS_FREE: 'hands_free'
});
export const TARGET_LANGUAGE = 'en';

const STORAGE_KEYS = Object.freeze({
  appLanguage: 'e-kaiwa.app-language',
  theme: 'e-kaiwa.theme',
  playbackRate: 'e-kaiwa.playback-rate',
  pronunciationEnabled: 'e-kaiwa.pronunciation-enabled',
  conversationMode: 'e-kaiwa.conversation-mode'
});

const PLAYBACK_RATES = Object.freeze(
  Array.from({length: 11}, (_, index) => Number((0.5 + index * 0.1).toFixed(1)))
);

export function normalizeAppLanguage(value, fallback = 'ja') {
  const normalized = String(value || '').trim().toLowerCase();
  if (SUPPORTED_APP_LANGUAGES.includes(normalized)) return normalized;
  return SUPPORTED_APP_LANGUAGES.includes(fallback) ? fallback : 'ja';
}

export function detectDefaultAppLanguage(browserLanguage = '') {
  return String(browserLanguage || '').toLowerCase().startsWith('vi') ? 'vi' : 'ja';
}

export function normalizeTheme(value, fallback = 'light') {
  const normalized = String(value || '').trim().toLowerCase();
  if (SUPPORTED_THEMES.includes(normalized)) return normalized;
  return SUPPORTED_THEMES.includes(fallback) ? fallback : 'light';
}

export function normalizePlaybackRate(value, fallback = 0.8) {
  const numeric = Number(value);
  const rounded = Number.isFinite(numeric) ? Number(numeric.toFixed(1)) : NaN;
  if (PLAYBACK_RATES.includes(rounded)) return rounded;
  return PLAYBACK_RATES.includes(Number(fallback)) ? Number(fallback) : 0.8;
}

export function normalizePronunciationEnabled(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return Boolean(fallback);
}

export function normalizeConversationMode(value, fallback = CONVERSATION_MODES.PUSH_TO_TALK) {
  const normalized = String(value || '').trim().toLowerCase();
  if (Object.values(CONVERSATION_MODES).includes(normalized)) return normalized;
  return Object.values(CONVERSATION_MODES).includes(fallback)
    ? fallback
    : CONVERSATION_MODES.PUSH_TO_TALK;
}

export function isHandsFreeMode(value) {
  return normalizeConversationMode(value) === CONVERSATION_MODES.HANDS_FREE;
}

export function targetSpeechLocale(targetLanguage = TARGET_LANGUAGE) {
  const locales = {
    en: 'en-US'
  };
  return locales[targetLanguage] || 'en-US';
}

export class PreferencesStore {
  constructor({storage = null, browserLanguage = '', prefersDark = false} = {}) {
    this.storage = storage;
    this.browserLanguage = browserLanguage;
    this.prefersDark = Boolean(prefersDark);
    this.value = {
      appLanguage: detectDefaultAppLanguage(browserLanguage),
      theme: this.prefersDark ? 'dark' : 'light',
      playbackRate: 0.8,
      pronunciationEnabled: true,
      conversationMode: CONVERSATION_MODES.PUSH_TO_TALK,
      targetLanguage: TARGET_LANGUAGE
    };
  }

  _read(key) {
    try {
      return this.storage?.getItem?.(key) ?? null;
    } catch {
      return null;
    }
  }

  _write(key, value) {
    try {
      this.storage?.setItem?.(key, String(value));
    } catch {}
  }

  load(defaults = {}) {
    // App language and conversation mode are learner/browser preferences,
    // never server-global settings.
    const defaultLanguage = detectDefaultAppLanguage(this.browserLanguage);
    const defaultTheme = normalizeTheme(defaults.theme, this.prefersDark ? 'dark' : 'light');
    const defaultRate = normalizePlaybackRate(defaults.playbackRate, 0.8);
    const defaultPronunciation = normalizePronunciationEnabled(defaults.pronunciationEnabled, true);
    const defaultConversationMode = normalizeConversationMode(
      defaults.conversationMode,
      CONVERSATION_MODES.PUSH_TO_TALK
    );

    this.value = {
      appLanguage: normalizeAppLanguage(this._read(STORAGE_KEYS.appLanguage), defaultLanguage),
      theme: normalizeTheme(this._read(STORAGE_KEYS.theme), defaultTheme),
      playbackRate: normalizePlaybackRate(this._read(STORAGE_KEYS.playbackRate), defaultRate),
      pronunciationEnabled: normalizePronunciationEnabled(
        this._read(STORAGE_KEYS.pronunciationEnabled),
        defaultPronunciation
      ),
      conversationMode: normalizeConversationMode(
        this._read(STORAGE_KEYS.conversationMode),
        defaultConversationMode
      ),
      targetLanguage: TARGET_LANGUAGE
    };
    return {...this.value};
  }

  setAppLanguage(value) {
    this.value.appLanguage = normalizeAppLanguage(value, this.value.appLanguage);
    this._write(STORAGE_KEYS.appLanguage, this.value.appLanguage);
    return this.value.appLanguage;
  }

  setTheme(value) {
    this.value.theme = normalizeTheme(value, this.value.theme);
    this._write(STORAGE_KEYS.theme, this.value.theme);
    return this.value.theme;
  }

  setPlaybackRate(value) {
    this.value.playbackRate = normalizePlaybackRate(value, this.value.playbackRate);
    this._write(STORAGE_KEYS.playbackRate, this.value.playbackRate);
    return this.value.playbackRate;
  }

  setPronunciationEnabled(value) {
    this.value.pronunciationEnabled = normalizePronunciationEnabled(
      value,
      this.value.pronunciationEnabled
    );
    this._write(STORAGE_KEYS.pronunciationEnabled, this.value.pronunciationEnabled);
    return this.value.pronunciationEnabled;
  }

  setConversationMode(value) {
    this.value.conversationMode = normalizeConversationMode(value, this.value.conversationMode);
    this._write(STORAGE_KEYS.conversationMode, this.value.conversationMode);
    return this.value.conversationMode;
  }
}
