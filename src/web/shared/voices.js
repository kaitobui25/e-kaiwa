// Gemini Live prebuilt voices. Keep the UI choices and Live setup whitelist in
// one place; "auto" preserves the existing model-selected voice.
export const DEFAULT_AI_VOICE = 'auto';
export const AI_VOICE_NAMES = Object.freeze([
  'Aoede', 'Puck', 'Kore', 'Charon', 'Zephyr', 'Leda', 'Achird'
]);

export function normalizeAiVoice(value) {
  const candidate = String(value ?? '').trim();
  if (candidate.toLowerCase() === DEFAULT_AI_VOICE) return DEFAULT_AI_VOICE;
  return AI_VOICE_NAMES.find(name => name.toLowerCase() === candidate.toLowerCase()) || DEFAULT_AI_VOICE;
}

export function liveAudioGenerationConfig(voice) {
  const selected = normalizeAiVoice(voice);
  const config = {responseModalities: ['AUDIO']};
  if (selected !== DEFAULT_AI_VOICE) {
    config.speechConfig = {voiceConfig: {prebuiltVoiceConfig: {voiceName: selected}}};
  }
  return config;
}

export function isVoiceSetupError(message) {
  return /\bvoice\b|speech.?config|prebuilt/i.test(String(message || ''));
}
