export const LANGUAGE_POLICY_VERSION = 'target-language-rescue-v4';

const SUPPORT_LANGUAGES = {
  vi: 'Vietnamese',
  ja: 'Japanese'
};

const UNKNOWN_LANGUAGE_CODES = new Set(['und', 'zxx']);
const ASCII_ENGLISH_TEXT = /^[\x00-\x7F]+$/;
const ENGLISH_LETTER = /[A-Za-z]/;
const CJK_TRANSCRIPT_BOUNDARY = /[\u3040-\u30ff\u3400-\u9fff]/;
const LATIN_ALNUM_TRANSCRIPT_BOUNDARY = /[A-Za-z0-9]/;
const NO_SPACE_BEFORE_TRANSCRIPT_BOUNDARY = /[.,!?;:%)\]}>，。！？；：、）」』】》〉]/;
const NO_SPACE_AFTER_TRANSCRIPT_BOUNDARY = /[(\[{<（「『【《〈]/;
const ENGLISH_APOSTROPHE_SUFFIX = /^['’](?:s|t|re|ve|ll|d|m)\b/i;
export const TARGET_LANGUAGE_ALIASES = Object.freeze({
  en: 'en', 'en-us': 'en', 'en-gb': 'en', english: 'en',
  ja: 'ja', 'ja-jp': 'ja', japanese: 'ja',
  zh: 'zh-Hans', 'zh-cn': 'zh-Hans', 'zh-hans': 'zh-Hans', cmn: 'zh-Hans',
  'cmn-hans': 'zh-Hans', mandarin: 'zh-Hans', chinese: 'zh-Hans'
});
export const TARGET_LANGUAGE_METADATA = Object.freeze({
  en: Object.freeze({name: 'English', speechLocale: 'en-US'}),
  ja: Object.freeze({name: 'Japanese', speechLocale: 'ja-JP'}),
  'zh-Hans': Object.freeze({name: 'Mandarin Chinese (Simplified)', speechLocale: 'zh-CN'})
});
export const SUPPORTED_TARGET_LANGUAGES = Object.freeze(Object.keys(TARGET_LANGUAGE_METADATA));
const TARGET_LANGUAGES = new Set(SUPPORTED_TARGET_LANGUAGES);

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

export function normalizeTargetLanguage(value) {
  const raw = String(value || '').trim().toLowerCase().replaceAll('_', '-');
  const normalized = TARGET_LANGUAGE_ALIASES[raw] || raw;
  return TARGET_LANGUAGES.has(normalized) ? normalized : 'en';
}

// Detection must never use the preference fallback. An unrecognised detector
// code is evidence of a non-target turn, not evidence that it was English.
function detectedTargetLanguage(code) {
  const raw = String(code || '').trim().toLowerCase().replaceAll('_', '-');
  if (!raw || UNKNOWN_LANGUAGE_CODES.has(raw.split('-', 1)[0])) return '';
  return TARGET_LANGUAGE_ALIASES[raw] || TARGET_LANGUAGE_ALIASES[raw.split('-', 1)[0]] || raw;
}

export function textLooksLikeTarget(text, targetLanguage) {
  const value = String(text || '').trim();
  const target = normalizeTargetLanguage(targetLanguage);
  if (target === 'ja') return /[\u3040-\u30ff\u3400-\u9fff]/.test(value);
  if (target === 'zh-Hans') return /[\u3400-\u9fff]/.test(value) && !/[\u3040-\u30ff]/.test(value);
  return Boolean(value) && ENGLISH_LETTER.test(value) && ASCII_ENGLISH_TEXT.test(value);
}

function transcriptSeparator(oldText, newText) {
  const left = oldText.at(-1) || '';
  const right = newText.at(0) || '';

  // CJK scripts normally have no inter-word spaces, even when Gemini streams
  // a sentence in multiple transcription fragments.
  if (CJK_TRANSCRIPT_BOUNDARY.test(left) || CJK_TRANSCRIPT_BOUNDARY.test(right)) return '';

  // Latin/alphanumeric words do need a space regardless of the session target.
  // This is important for rescue turns such as English spoken in a ja/zh session.
  if (LATIN_ALNUM_TRANSCRIPT_BOUNDARY.test(left) && LATIN_ALNUM_TRANSCRIPT_BOUNDARY.test(right)) return ' ';

  if (LATIN_ALNUM_TRANSCRIPT_BOUNDARY.test(left) && ENGLISH_APOSTROPHE_SUFFIX.test(newText)) return '';
  if (NO_SPACE_BEFORE_TRANSCRIPT_BOUNDARY.test(right) || NO_SPACE_AFTER_TRANSCRIPT_BOUNDARY.test(left)) return '';
  return ' ';
}

export function concatTargetTranscript(previous, incoming, _targetLanguage = 'en') {
  const oldText = String(previous || '').trim();
  const newText = String(incoming || '').trim();
  if (!oldText) return newText;
  if (!newText || oldText.endsWith(newText)) return oldText;
  if (newText.startsWith(oldText)) return newText;
  return oldText + transcriptSeparator(oldText, newText) + newText;
}

export function finalizeLanguageMode(turn) {
  const target = normalizeTargetLanguage(turn?.targetLanguage);
  const normalized = [...(turn?.inputLanguageCodes || [])]
    .map(detectedTargetLanguage)
    .filter(Boolean);

  if (normalized.some(language => language !== target)) {
    turn.languageMode = 'non_target';
    turn.coachEligible = false;
    turn.coachSkipReason = 'non_target_input';
  } else if (normalized.some(language => language === target)) {
    turn.languageMode = 'target';
    turn.coachEligible = true;
    turn.coachSkipReason = null;
  } else if (textLooksLikeTarget(turn?.userText, target)) {
    turn.languageMode = 'target';
    turn.coachEligible = true;
    turn.coachSkipReason = null;
  } else {
    turn.languageMode = 'non_target';
    turn.coachEligible = false;
    turn.coachSkipReason = 'non_target_or_unknown_text';
  }

  return turn.languageMode;
}

export function isCoachEligible(turn) {
  return turn?.coachEligible !== false;
}

export function buildLiveLanguageInstruction(supportLanguage, targetLanguage = 'en') {
  const language = selectedSupportLanguage(supportLanguage);
  const languageName = SUPPORT_LANGUAGES[language];
  const target = normalizeTargetLanguage(targetLanguage);
  const targetName = TARGET_LANGUAGE_METADATA[target].name;

  return `Language policy ${LANGUAGE_POLICY_VERSION}.
You are a ${targetName} conversation partner for a ${targetName} learner.
Keep normal conversation in ${targetName}. The configured support language is ${languageName} (${language}).
If the learner clearly speaks an utterance outside ${targetName}, treat it as a short rescue turn rather than switching the conversation language. If their intent is clear, briefly help in ${languageName}, give the natural ${targetName} phrase, and ask them to say it in ${targetName}. If their intent is unclear or the speech may have been misheard, do not confidently translate it; briefly ask in ${languageName} for another attempt in ${targetName}.
Never choose the rescue language from the detected input language; always use ${languageName}. Keep rescue responses short and return immediately to ${targetName} practice.`;
}
