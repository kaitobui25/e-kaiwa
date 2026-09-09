export const SUPPORTED_APP_LANGUAGES = Object.freeze(['ja', 'vi']);
export const SUPPORTED_THEMES = Object.freeze(['light', 'dark']);
export const SUPPORTED_TARGET_LANGUAGES = Object.freeze(['en']);
export const TARGET_LANGUAGE = 'en';

const STORAGE_KEYS = Object.freeze({
  appLanguage: 'e-kaiwa.app-language',
  theme: 'e-kaiwa.theme',
  playbackRate: 'e-kaiwa.playback-rate',
  pronunciationEnabled: 'e-kaiwa.pronunciation-enabled'
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
    // App language is a learner/browser preference, never a server-global setting.
    // This keeps dev support_language from leaking into public UI defaults.
    const defaultLanguage = detectDefaultAppLanguage(this.browserLanguage);
    const defaultTheme = normalizeTheme(defaults.theme, this.prefersDark ? 'dark' : 'light');
    const defaultRate = normalizePlaybackRate(defaults.playbackRate, 0.8);
    const defaultPronunciation = normalizePronunciationEnabled(defaults.pronunciationEnabled, true);

    this.value = {
      appLanguage: normalizeAppLanguage(this._read(STORAGE_KEYS.appLanguage), defaultLanguage),
      theme: normalizeTheme(this._read(STORAGE_KEYS.theme), defaultTheme),
      playbackRate: normalizePlaybackRate(this._read(STORAGE_KEYS.playbackRate), defaultRate),
      pronunciationEnabled: normalizePronunciationEnabled(
        this._read(STORAGE_KEYS.pronunciationEnabled),
        defaultPronunciation
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
}
