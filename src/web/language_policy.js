export const LANGUAGE_POLICY_VERSION = 'english-first-rescue-v2';

const SUPPORT_LANGUAGES = {
  vi: 'Vietnamese',
  ja: 'Japanese'
};

const UNKNOWN_LANGUAGE_CODES = new Set(['und', 'zxx']);
const ASCII_ENGLISH_TEXT = /^[\x00-\x7F]+$/;
const ENGLISH_LETTER = /[A-Za-z]/;

export function normalizeLanguageCode(code) {
  const raw = String(code || '').trim().toLowerCase();
  if (!raw) return '';
  const primary = raw.split(/[-_]/, 1)[0];
  return UNKNOWN_LANGUAGE_CODES.has(primary) ? '' : primary;
}

export function selectedSupportLanguage(value) {
  return value === 'ja' ? 'ja' : 'vi';
}

export function recordLanguageCode(turn, code, direction) {
  if (!turn) return;
  const raw = String(code || '').trim();
  if (!raw) return;

  const target = direction === 'output'
    ? turn.outputLanguageCodes
    : turn.inputLanguageCodes;
  if (target instanceof Set) target.add(raw);
}

export function isEnglishText(text) {
  const value = String(text || '').trim();
  return Boolean(value) && ENGLISH_LETTER.test(value) && ASCII_ENGLISH_TEXT.test(value);
}

export function finalizeLanguageMode(turn) {
  const normalized = [...(turn?.inputLanguageCodes || [])]
    .map(normalizeLanguageCode)
    .filter(Boolean);

  if (normalized.some(language => language !== 'en')) {
    turn.languageMode = 'non_english';
    turn.coachEligible = false;
    turn.coachSkipReason = 'non_english_input';
  } else if (normalized.includes('en')) {
    turn.languageMode = 'english';
    turn.coachEligible = true;
    turn.coachSkipReason = null;
  } else if (isEnglishText(turn?.userText)) {
    turn.languageMode = 'english';
    turn.coachEligible = true;
    turn.coachSkipReason = null;
  } else {
    turn.languageMode = 'non_english';
    turn.coachEligible = false;
    turn.coachSkipReason = 'non_english_or_unknown_text';
  }

  return turn.languageMode;
}

export function isCoachEligible(turn) {
  return turn?.coachEligible !== false;
}

export function buildLiveLanguageInstruction(supportLanguage) {
  const language = selectedSupportLanguage(supportLanguage);
  const languageName = SUPPORT_LANGUAGES[language];

  return `Language policy ${LANGUAGE_POLICY_VERSION}.
You are an English conversation partner for an English learner.
Keep normal conversation in English. The configured support language is ${languageName} (${language}).
If the learner clearly speaks a non-English utterance, treat it as a short rescue turn rather than switching the conversation language. If their intent is clear, briefly help in ${languageName}, give the natural English phrase, and ask them to say it in English. If their intent is unclear or the speech may have been misheard, do not confidently translate it; briefly ask in ${languageName} for another attempt in English.
Never choose the rescue language from the detected input language; always use ${languageName}. Keep rescue responses short and return immediately to English practice.`;
}
