// Optional archive sidecar. The Live audio stream never waits on this module.
export const MAX_RECORDING_PCM_BYTES = 3_840_000;

export function captureGeminiAudio(turn, base64) {
  if (!turn?.saveRecording || turn.aiRecordingOverflow || !base64) return;
  const size = Math.floor(base64.length * 3 / 4); // Upper bound including padding.
  if (turn.aiPcmBytes + size > MAX_RECORDING_PCM_BYTES) {
    turn.aiRecordingOverflow = true;
    turn.aiPcmBase64Chunks = [];
    return;
  }
  turn.aiPcmBytes += size;
  turn.aiPcmBase64Chunks.push(base64);
}

function decodeChunks(chunks, decoder) {
  const buffers = chunks.map(chunk => {
    const binary = decoder(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  });
  const size = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  if (!size || size % 2 || size > MAX_RECORDING_PCM_BYTES) return null;
  const result = new Uint8Array(size);
  let offset = 0;
  for (const buffer of buffers) {
    result.set(buffer, offset);
    offset += buffer.length;
  }
  return result;
}

export function archiveTurnRecordings(turn, {
  send = (url, options) => fetch(url, options),
  schedule = callback => setTimeout(callback, 0),
  decode = value => atob(value),
  warn = (...args) => console.warn(...args)
} = {}) {
  if (!turn?.saveRecording || !turn.sessionId) return;
  const userPcm = turn.replayPcm;
  const aiChunks = turn.aiPcmBase64Chunks;
  const aiOverflow = turn.aiRecordingOverflow;
  turn.aiPcmBase64Chunks = [];

  function upload(bytes, role, rate) {
    Promise.resolve().then(() => send('/api/recording', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Session-ID': turn.sessionId,
        'X-Turn': String(turn.no),
        'X-Sample-Rate': String(rate),
        'X-Audio-Role': role
      },
      body: bytes
    })).then(response => {
      if (!response.ok) warn('Recording upload failed:', role, response.status);
    }).catch(() => warn('Recording upload unavailable:', role));
  }

  schedule(() => {
    if (userPcm?.length && userPcm.byteLength <= MAX_RECORDING_PCM_BYTES) {
      upload(new Uint8Array(userPcm.buffer, userPcm.byteOffset, userPcm.byteLength), 'user', 16000);
    }
    if (!aiChunks?.length || aiOverflow) return;
    try {
      const ai = decodeChunks(aiChunks, decode);
      if (ai) upload(ai, 'ai', 24000);
    } catch {
      warn('Could not decode Gemini audio for recording');
    }
  });
}
