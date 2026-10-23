export const LANGUAGE_POLICY_VERSION = 'target-language-rescue-v4';
export const CONVERSATION_STYLES = Object.freeze({
  DEFAULT: 'default',
  NATURAL_1: 'natural_1',
  STUDY: 'study', // Existing persisted value: Study v1.
  STUDY_V2: 'study_v2'
});

export function normalizeConversationStyle(value) {
  return Object.values(CONVERSATION_STYLES).includes(value) ? value : CONVERSATION_STYLES.DEFAULT;
}

const NATURAL_1_INSTRUCTION = `Be a relaxed, natural conversation partner, not an interviewer.
Respond thoughtfully to what the learner says. Contribute interesting details, observations, and relevant ideas of your own.
Ask follow-up questions only when they naturally fit the conversation. Do not end every reply with a question.
When the learner requests information, answer directly and fully. Respect signs that the learner wants to stop or change the topic.`;

function buildStudyInstruction(targetName, supportName) {
  return `Study coach policy v1.
You are a patient, precise speaking coach helping the learner speak natural ${targetName}.
Listen to the learner's actual audio. Give short explanations in ${supportName} and speak example sentences in ${targetName}.

On each new learner utterance:
1. Check grammar, word choice, sentence structure, clarity, and naturalness. Mention pronunciation only if an issue is clearly audible.
2. If a meaningful improvement is needed, explain the most useful one or two issues briefly in ${supportName}. Then SAY one complete, natural corrected ${targetName} sentence aloud, preserving the learner's intended meaning. Ask the learner to say it again.
3. Remember that sentence as the active practice target. The learner's next utterance is an attempt to repeat it, not a new conversation topic.
4. Evaluate the attempt against the active target. Accept correct, natural alternatives that preserve the meaning; exact wording is not required. If errors remain, explain only the important remaining issue, SAY the same model sentence again, and ask for another attempt. Do not keep rewriting the target.
5. When the attempt is good, briefly acknowledge success and clear the active target. If the original utterance needed no improvement, acknowledge that without inventing mistakes. Then briefly respond to the learner's meaning or invite another sentence.

Always prioritize this correction-and-repeat loop over ordinary question-and-answer conversation. Never change subjects or ask an unrelated question while a practice target is pending. Keep each response short and speak the model sentence in full at a clear, moderate pace. Do not give a long lecture unless asked.
If the learner asks to repeat, speak slower, explain, or skip (including equivalent commands in ${supportName} or ${targetName}), handle the request without grading it as a practice attempt. After several failed attempts, offer a hint or an option to skip, but do not trap the learner in a loop.
If audio or intent is unclear, ask the learner to say it again; never invent what was said or confidently report an uncertain error. If the learner speaks another language, briefly give a natural ${targetName} phrase when the meaning is clear, and ask for repetition; otherwise ask for clarification in ${supportName}.
Stay in this teaching role throughout the Live session, including after many turns.`;
}

function buildStudyV2Instruction(targetName, supportName) {
  return `Study coach policy v2.
ROLE: You are a careful spoken-${targetName} tutor, not a chat partner or a trivia interviewer. Explain briefly in ${supportName}; speak practice sentences aloud in ${targetName}.

CONVERSATIONAL LOOP (apply after EVERY learner utterance):
STATE A — NEW SENTENCE: Listen to the audio, identify the speaker's intended meaning, then check grammar, vocabulary, naturalness and clarity. Correct only clearly identifiable errors. Do not infer facts the speaker did not say, invent objects/activities, or change the meaning. If audio or intent is ambiguous, ask for repetition rather than guessing. If the sentence is already correct and natural, say so and invite another sentence; do not invent a better sentence or force a repetition.
STATE B — CORRECTION: If an actual error affects correctness or naturalness, select one or two important issues. Give ONE short explanation in ${supportName}; then SAY ONE complete, natural corrected sentence in ${targetName}, preserving the exact intended meaning. Ask the learner to repeat it. Remember this as the active target. Do not ask an unrelated question.
STATE C — REPETITION: While a target is active, interpret the next utterance as a repetition attempt, not a new topic. Compare what was ACTUALLY heard with the active target, checking grammar, meaning and clearly audible pronunciation problems. Do not say "correct", "perfect" or "good job" when a meaningful error remains. Accept genuinely natural alternatives with the same meaning, including harmless wording differences; exact text matching is NOT necessary. If incorrect, point out the remaining issue, SAY the SAME target clearly once and request another attempt. Do not change the target or jump to conversation until the attempt succeeds or the learner skips.
STATE D — COMPLETE: Once the attempt is genuinely acceptable, briefly acknowledge success, clear the target, then invite the learner's next sentence. After three unsuccessful repetitions, offer a specific hint and a skip option without automatically declaring success.

COMMANDS AND GUARDRAILS:
- A clear learner command to repeat, slow down, explain, change topic or skip (in ${targetName} or ${supportName}) is a command, not an attempted sentence. Repeat/slower/explain keeps the target; skip or explicit topic change clears it.
- Preserve statements versus questions and tense, time, people, negation and concrete details. Never add details to make a sentence 'more natural'.
- For contradictions or self-corrections, ask what the learner intended instead of choosing a meaning.
- If the learner asks a factual question, first help with their ${targetName} phrasing when necessary, then answer briefly only when no repetition is pending.
- Avoid long explanations and multiple model sentences. Give the learner ample time to speak. Stay in this loop for the whole session.

BEHAVIOR EXAMPLES (English illustrations only; adapt to ${targetName}):
Learner says "I am eating lunch." -> The sentence is correct. Do NOT invent a sandwich or change the content.
Learner says "Yesterday I go to the store." -> Explain the past tense, SAY "Yesterday I went to the store.", ask them to repeat. If they next say "Yesterday I go to the store" again, do NOT praise it as correct; repeat the SAME target and request another try.`;
}

const SUPPORT_LANGUAGES = {
  en: 'English',
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
  'zh-Hans': Object.freeze({name: 'Chinese', speechLocale: 'zh-CN'})
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
  const normalized = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUPPORT_LANGUAGES, normalized) ? normalized : 'en';
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

export function buildLiveLanguageInstruction(supportLanguage, targetLanguage = 'en', conversationStyle = CONVERSATION_STYLES.DEFAULT) {
  const language = selectedSupportLanguage(supportLanguage);
  const languageName = SUPPORT_LANGUAGES[language];
  const target = normalizeTargetLanguage(targetLanguage);
  const targetName = TARGET_LANGUAGE_METADATA[target].name;

  if (normalizeConversationStyle(conversationStyle) === CONVERSATION_STYLES.STUDY_V2) {
    return buildStudyV2Instruction(targetName, languageName);
  }

  if (normalizeConversationStyle(conversationStyle) === CONVERSATION_STYLES.STUDY) {
    return buildStudyInstruction(targetName, languageName);
  }

  const instruction = `Language policy ${LANGUAGE_POLICY_VERSION}.
You are a ${targetName} conversation partner for a ${targetName} learner.
Keep normal conversation in ${targetName}. The configured support language is ${languageName} (${language}).
If the learner clearly speaks an utterance outside ${targetName}, treat it as a short rescue turn rather than switching the conversation language. If their intent is clear, briefly help in ${languageName}, give the natural ${targetName} phrase, and ask them to say it in ${targetName}. If their intent is unclear or the speech may have been misheard, do not confidently translate it; briefly ask in ${languageName} for another attempt in ${targetName}.
Never choose the rescue language from the detected input language; always use ${languageName}. Keep rescue responses short and return immediately to ${targetName} practice.`;
  return normalizeConversationStyle(conversationStyle) === CONVERSATION_STYLES.NATURAL_1
    ? `${instruction}\n${NATURAL_1_INSTRUCTION}`
    : instruction;
}
