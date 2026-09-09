import {
  LANGUAGE_POLICY_VERSION,
  buildLiveLanguageInstruction,
  finalizeLanguageMode,
  isCoachEligible,
  recordLanguageCode,
  selectedSupportLanguage
} from './language_policy.js';

(() => {
  'use strict';

  const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
  const AI_SPEED_VALUES = ['0.5', '0.6', '0.7', '0.8', '0.9', '1.0', '1.1', '1.2', '1.3', '1.4', '1.5'];
  const DEFAULT_AI_SPEED = '0.8';

  const talk = document.getElementById('talk');
  const statusEl = document.getElementById('status');
  const setupDotEl = document.getElementById('setup-dot');
  const setupLabelEl = document.getElementById('setup-label');
  const metricEl = document.getElementById('metric');
  const conversationEl = document.getElementById('conversation');
  const teacherEl = document.getElementById('teacher');
  const feedbackLanguageEl = document.getElementById('feedback-language');
  const realtimeModelEl = document.getElementById('realtime-model');
  const coachModelEl = document.getElementById('coach-model');
  const aiSpeedEl = document.getElementById('ai-speed');
  const silenceDurationEl = document.getElementById('silence-duration');
  const pronEl = document.getElementById('pron');

  const state = {
    ws: null,
    sessionId: null,
    configuredRealtimeModel: '',
    realtimeFallbackModel: '',
    effectiveRealtimeModel: '',
    sessionRequestedModel: '',
    sessionFallbackTried: false,
    supportLanguage: 'vi',
    sessionSilenceDurationMs: 1000,
    echoGuardMs: 0,
    setupReady: false,
    reconnectNeeded: false,
    reconnectAfterConnect: false,
    connecting: false,
    recording: false,
    inputForwarding: false,
    inputCtx: null,
    micStream: null,
    micSource: null,
    processor: null,
    micAudioSettings: {},
    playCtx: null,
    playAt: 0,
    playbackSources: new Set(),
    armTimer: null,
    turnNo: 1,
    activeTurn: null,
    turns: []
  };

  // ---------------------------------------------------------------------------
  // UI + settings
  // ---------------------------------------------------------------------------
  function setStatus(text, className = '') {
    statusEl.className = `muted ${className}`.trim();
    statusEl.textContent = text;
  }

  function updateSetupIndicator() {
    setupDotEl.className = state.setupReady ? 'setup-dot on' : 'setup-dot';
    setupLabelEl.textContent = `setupReady=${state.setupReady}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function readJsonResponse(response) {
    return response.text().then(text => {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
      }
    });
  }

  function modelLabel(model) {
    const labels = {
      auto: 'Auto (recommended)',
      'gemini-3.1-flash-live-preview': 'Gemini 3.1 Flash Live (recommended)',
      'gemini-2.5-flash-native-audio-preview-12-2025': 'Gemini 2.5 Native Audio',
      'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
      'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
      'gemini-3.6-flash': 'Gemini 3.6 Flash'
    };
    return labels[model] || model;
  }

  function setSelectChoices(element, choices, selected) {
    const values = Array.isArray(choices) ? choices : [];
    element.innerHTML = values
      .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(modelLabel(value))}</option>`)
      .join('');
    element.value = selected;
  }

  function applySettingsPayload(payload) {
    const settings = payload?.settings || {};
    const models = payload?.models || {};
    const choices = payload?.choices || {};

    teacherEl.value = settings.teacher || 'Normal';
    feedbackLanguageEl.value = settings.support_language || 'vi';
    aiSpeedEl.value = AI_SPEED_VALUES.includes(String(settings.ai_playback_rate))
      ? String(settings.ai_playback_rate)
      : DEFAULT_AI_SPEED;
    silenceDurationEl.value = String(settings.silence_duration_ms || 1000);
    pronEl.checked = settings.pronunciation_enabled !== false;

    const echoGuardMs = Number(settings.echo_guard_ms);
    state.echoGuardMs = Number.isFinite(echoGuardMs) && echoGuardMs >= 0 ? echoGuardMs : 0;

    state.configuredRealtimeModel = models.realtime_conversation || '';
    state.realtimeFallbackModel = models.realtime_fallback || '';
    setSelectChoices(
      realtimeModelEl,
      choices.realtime_conversation,
      state.configuredRealtimeModel
    );
    const coachSelected = models.coach_mode === 'auto' ? 'auto' : models.coach_model;
    setSelectChoices(coachModelEl, choices.coach, coachSelected);

    if (!state.ws && !state.connecting && !state.setupReady) {
      state.supportLanguage = selectedSupportLanguage(feedbackLanguageEl.value);
    }
  }

  async function loadSettings() {
    const response = await fetch('/api/settings', {cache: 'no-store'});
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Could not load settings');
    applySettingsPayload(data);
    return data;
  }

  async function persistSettings(changes) {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(changes)
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Could not save settings');
    applySettingsPayload(data);
    return data;
  }

  async function recoverSettings(error) {
    try {
      await loadSettings();
    } catch {}
    setStatus(`Settings error: ${error.message}`, 'error');
  }

  function requestSessionReconnect(message) {
    if (state.recording) {
      setStatus(`${message} It will apply after you stop this conversation.`);
      return;
    }
    if (state.connecting) {
      state.reconnectAfterConnect = true;
      setStatus(`${message} It will apply as soon as the current connection finishes.`);
      return;
    }
    newLiveSession().catch(error => {
      showReconnect(`Connection error: ${error.message}. Tap Reconnect.`);
    });
  }

  // ---------------------------------------------------------------------------
  // Conversation rendering
  // ---------------------------------------------------------------------------
  function concatTranscript(previous, incoming) {
    const oldText = (previous || '').trim();
    const newText = (incoming || '').trim();
    if (!oldText) return newText;
    if (!newText || oldText.endsWith(newText)) return oldText;
    if (newText.startsWith(oldText)) return newText;
    return oldText + (/[\s,.!?]$/.test(oldText) ? '' : ' ') + newText;
  }

  function pronunciationProblemSpan(word, problem) {
    const severity = problem?.severity === 'red' ? 'red' : 'yellow';
    const tip = problem?.tip || problem?.tip_ja || '';
    const details = [];
    if (problem?.sound) details.push(`<strong>${escapeHtml(problem.sound)}</strong>`);
    if (problem?.heard_like) details.push(`heard ≈ ${escapeHtml(problem.heard_like)}`);
    if (tip) details.push(escapeHtml(tip));

    const tooltip = details.join('<br>');
    const tooltipHtml = tooltip
      ? `<span class="tooltip" role="tooltip">${tooltip}</span>`
      : '';
    const tooltipClass = tooltip ? ' has-tooltip' : '';
    const tabIndex = tooltip ? ' tabindex="0"' : '';
    return `<span class="pron-problem severity-${severity}${tooltipClass}"${tabIndex}>${escapeHtml(word)}${tooltipHtml}</span>`;
  }

  function highlightPronunciationProblems(text, result) {
    const rawText = String(text || '…');
    const problems = Array.isArray(result?.problems) ? result.problems.slice(0, 3) : [];
    if (!problems.length) return escapeHtml(rawText);

    const byWord = new Map();
    for (const problem of problems) {
      const word = String(problem?.word || '').trim();
      if (!word) continue;
      const key = word.toLocaleLowerCase('en-US');
      const existing = byWord.get(key);
      if (!existing || (existing.severity !== 'red' && problem.severity === 'red')) {
        byWord.set(key, problem);
      }
    }

    const words = [...byWord.keys()].sort((a, b) => b.length - a.length);
    if (!words.length) return escapeHtml(rawText);

    const pattern = words
      .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const regex = new RegExp(`\\b(${pattern})\\b`, 'gi');
    let html = '';
    let lastIndex = 0;

    rawText.replace(regex, (match, _captured, offset) => {
      html += escapeHtml(rawText.slice(lastIndex, offset));
      const problem = byWord.get(match.toLocaleLowerCase('en-US'));
      html += pronunciationProblemSpan(match, problem);
      lastIndex = offset + match.length;
      return match;
    });

    html += escapeHtml(rawText.slice(lastIndex));
    return html;
  }

  function pronunciationHtml(result) {
    if (!result) return '';

    const score = value => Math.max(0, Math.min(100, Math.round(Number(value || 0))));
    const overall = score(result.overall_score ?? result.pronunciation_score);
    const summary = result.summary || result.summary_ja || '';
    const scoreDetails = [
      `Pronunciation ${score(result.pronunciation_score)} · Fluency ${score(result.fluency_score)} · Intonation ${score(result.intonation_score)}`,
      summary
    ].filter(Boolean).map(escapeHtml).join('<br>');

    return `<span class="pron-score has-tooltip" tabindex="0" aria-label="Pronunciation score ${overall}">${overall}<span class="tooltip" role="tooltip">${scoreDetails}</span></span>`;
  }

  function coachDetailsHtml(turn) {
    if (!turn.coach) return '<span class="muted">Coach running…</span>';

    let details = `<div><strong>Correction:</strong> ${escapeHtml(turn.coach.correction || turn.userText || '')}</div>`;
    const explanation = turn.coach.explanation || turn.coach.explanation_ja || '';
    if (explanation) details += `<div class="coach-explanation">${escapeHtml(explanation)}</div>`;
    details += `<div class="coach-runtime">${Number(turn.coach.coach_wall_s || 0).toFixed(2)}s</div>`;
    return details;
  }

  function render() {
    if (!state.turns.length) {
      conversationEl.innerHTML = '<span class="muted">No conversation yet.</span>';
      return;
    }

    conversationEl.innerHTML = state.turns.slice().reverse().map(turn => {
      const latency = turn.firstAudioMs == null
        ? ''
        : `<span class="good">first audio ${Math.round(turn.firstAudioMs)} ms</span>`;

      const pronunciation = pronEl.checked ? turn.coach?.pronunciation : null;
      const userHtml = pronunciation
        ? highlightPronunciationProblems(turn.userText || '…', pronunciation)
        : escapeHtml(turn.userText || '…');

      let coachSection = '';
      if (isCoachEligible(turn)) {
        const coachDetails = coachDetailsHtml(turn);
        const scoreHtml = pronEl.checked ? pronunciationHtml(turn.coach?.pronunciation) : '';
        coachSection = `<div class="coach-summary">
          <span class="who who-coach coach-trigger has-tooltip" tabindex="0">Coach<span class="tooltip coach-tooltip" role="tooltip">${coachDetails}</span></span>
          ${scoreHtml}
        </div>`;
      }

      return `<div class="turn">
        <div class="who who-you">You</div><div class="text">${userHtml}</div>
        <div class="who who-ai">AI ${latency}</div><div class="text">${escapeHtml(turn.aiText || '…')}</div>
        ${coachSection}
      </div>`;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Small data helpers
  // ---------------------------------------------------------------------------
  function b64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToB64(bytes) {
    let output = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      output += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(output);
  }

  function pcmToBase64(pcm) {
    return bytesToB64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }

  function joinPcm(chunks) {
    const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
    const joined = new Int16Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return joined;
  }

  function aiPlaybackRate() {
    const value = aiSpeedEl.value;
    return AI_SPEED_VALUES.includes(value) ? Number(value) : Number(DEFAULT_AI_SPEED);
  }

  // ---------------------------------------------------------------------------
  // Audio input/output
  // ---------------------------------------------------------------------------
  async function ensurePlayContext() {
    if (!state.playCtx) {
      state.playCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.playCtx.state === 'suspended') await state.playCtx.resume();
  }

  function downsample(input, inputRate, outputRate = 16000) {
    if (inputRate === outputRate) return new Float32Array(input);
    const ratio = inputRate / outputRate;
    const length = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      output[i] = sum / (end - start);
    }
    return output;
  }

  function floatToPcm16(floatData) {
    const pcm = new Int16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
      const sample = Math.max(-1, Math.min(1, floatData[i]));
      pcm[i] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    }
    return pcm;
  }

  function pauseInputForAiPlayback() {
    if (!state.recording) return;
    state.inputForwarding = false;
    setStatus('AI speaking…');
  }

  function clearAiPlayback() {
    for (const source of state.playbackSources) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    state.playbackSources.clear();
    state.playAt = state.playCtx ? state.playCtx.currentTime : 0;
  }

  function queueAiPcm(base64) {
    if (!state.playCtx) return;
    const bytes = b64ToBytes(base64);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (!sampleCount) return;

    pauseInputForAiPlayback();

    const floats = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < sampleCount; i++) {
      floats[i] = view.getInt16(i * 2, true) / 32768;
    }

    const buffer = state.playCtx.createBuffer(1, sampleCount, 24000);
    buffer.copyToChannel(floats, 0);
    const source = state.playCtx.createBufferSource();
    const rate = aiPlaybackRate();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(state.playCtx.destination);
    state.playbackSources.add(source);
    source.onended = () => {
      state.playbackSources.delete(source);
      try { source.disconnect(); } catch {}
    };

    const now = state.playCtx.currentTime;
    if (state.playAt < now + 0.025) state.playAt = now + 0.025;
    source.start(state.playAt);
    state.playAt += buffer.duration / rate;
  }

  function cleanupMic() {
    clearTimeout(state.armTimer);
    state.armTimer = null;
    state.inputForwarding = false;

    try { state.processor?.disconnect(); } catch {}
    try { state.micSource?.disconnect(); } catch {}
    state.micStream?.getTracks().forEach(track => track.stop());
    try { state.inputCtx?.close(); } catch {}

    state.processor = null;
    state.micSource = null;
    state.micStream = null;
    state.inputCtx = null;
    state.micAudioSettings = {};
  }

  // ---------------------------------------------------------------------------
  // Per-turn lifecycle
  // ---------------------------------------------------------------------------
  function createTurn() {
    if (state.activeTurn || !state.recording) return null;
    const turn = {
      no: state.turnNo,
      pcmChunks: [],
      userText: '',
      aiText: '',
      inputLanguageCodes: new Set(),
      outputLanguageCodes: new Set(),
      languageMode: 'unknown',
      coachEligible: true,
      coachSkipReason: null,
      supportLanguage: state.supportLanguage,
      languagePolicyVersion: LANGUAGE_POLICY_VERSION,
      firstAudioMs: null,
      coachSent: false,
      coach: null,
      finished: false
    };
    state.activeTurn = turn;
    state.turns.push(turn);
    render();
    return turn;
  }

  async function runCoach(turn) {
    if (!isCoachEligible(turn) || turn.coachSent || !turn.userText.trim() || !turn.pcmChunks.length) return;
    turn.coachSent = true;
    const pcm = joinPcm(turn.pcmChunks);

    try {
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          session_id: state.sessionId,
          turn: turn.no,
          transcript: turn.userText,
          teacher: teacherEl.value,
          feedback_language: feedbackLanguageEl.value,
          pronunciation_enabled: pronEl.checked,
          sample_rate: 16000,
          pcm_b64: pcmToBase64(pcm)
        })
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || 'coach failed');
      turn.coach = data;
    } catch (error) {
      turn.coach = {
        correction: turn.userText,
        explanation: `Coach error: ${error.message}`,
        pronunciation: null,
        coach_wall_s: 0
      };
    }
    render();
  }

  function postTurnMetric(turn) {
    const frontendState = {
      recording: state.recording,
      activeTurn: state.activeTurn ? state.activeTurn.no : null,
      buttonEnabled: !talk.disabled,
      setupReady: state.setupReady
    };
    console.log('[TURN STATE]', turn.no, frontendState);

    fetch('/api/metric', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        session_id: state.sessionId,
        turn: turn.no,
        user_text: turn.userText,
        ai_text: turn.aiText,
        first_audio_ms: turn.firstAudioMs,
        input_language_codes: [...turn.inputLanguageCodes],
        output_language_codes: [...turn.outputLanguageCodes],
        language_mode: turn.languageMode,
        support_language: turn.supportLanguage,
        language_policy_version: turn.languagePolicyVersion,
        coach_eligible: turn.coachEligible,
        coach_called: turn.coachSent,
        coach_skip_reason: turn.coachSkipReason,
        mic_audio_settings: state.micAudioSettings,
        settings: {
          teacher: teacherEl.value,
          pronunciation_enabled: pronEl.checked,
          silence_duration_ms: state.sessionSilenceDurationMs,
          ai_playback_rate: aiPlaybackRate(),
          echo_guard_ms: state.echoGuardMs,
          realtime_model: state.effectiveRealtimeModel,
          coach_model: coachModelEl.value
        },
        frontend_state: frontendState
      })
    }).catch(() => {});
  }

  function armNextTurnAfterPlayback() {
    clearTimeout(state.armTimer);
    const playbackMs = state.playCtx
      ? Math.max(0, (state.playAt - state.playCtx.currentTime) * 1000)
      : 0;
    const remainingMs = playbackMs + state.echoGuardMs;

    setStatus(remainingMs > 0 ? 'AI speaking…' : 'Listening…');
    state.armTimer = setTimeout(() => {
      state.armTimer = null;
      if (!state.recording || !state.setupReady || state.ws?.readyState !== WebSocket.OPEN) return;
      createTurn();
      state.inputForwarding = true;
      setStatus('Listening… speak naturally.');
    }, remainingMs);
  }

  function finishTurn(turn) {
    if (!turn || turn.finished || turn !== state.activeTurn) return;
    turn.finished = true;
    finalizeLanguageMode(turn);

    if (isCoachEligible(turn)) runCoach(turn);
    state.turnNo += 1;
    state.activeTurn = null;
    state.inputForwarding = false;

    postTurnMetric(turn);
    render();

    if (state.recording && state.setupReady && state.ws?.readyState === WebSocket.OPEN) {
      armNextTurnAfterPlayback();
    } else if (!state.setupReady || state.ws?.readyState !== WebSocket.OPEN) {
      showReconnect('Live session ended. Tap Reconnect.');
    }
  }

  // ---------------------------------------------------------------------------
  // Gemini Live session lifecycle
  // ---------------------------------------------------------------------------
  async function webSocketDataToText(data) {
    if (typeof data === 'string') return data;
    if (data instanceof Blob) return await data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
    return String(data);
  }

  function showReconnect(message) {
    state.recording = false;
    state.inputForwarding = false;
    state.activeTurn = null;
    clearAiPlayback();
    cleanupMic();
    state.setupReady = false;
    state.reconnectNeeded = true;
    state.connecting = false;
    updateSetupIndicator();

    talk.disabled = false;
    talk.className = 'ready';
    talk.textContent = '↻ Reconnect';
    setStatus(message || 'Live session ended. Tap Reconnect.');
  }

  async function retryWithRealtimeFallback(reason) {
    if (
      state.setupReady ||
      state.sessionFallbackTried ||
      !state.realtimeFallbackModel ||
      state.realtimeFallbackModel === state.effectiveRealtimeModel
    ) {
      return false;
    }

    state.sessionFallbackTried = true;
    state.connecting = false;
    setStatus(`Primary realtime model failed (${reason}). Trying fallback…`);
    try {
      await newLiveSession({fallback: true});
    } catch (error) {
      showReconnect(`Fallback connection error: ${error.message}. Tap Reconnect.`);
    }
    return true;
  }

  async function onLiveMessage(event, socket) {
    if (state.ws !== socket) return;

    let message;
    try {
      message = JSON.parse(await webSocketDataToText(event.data));
    } catch (error) {
      setStatus(`Could not decode Gemini message: ${error.message}`, 'error');
      return;
    }

    if (message.error) {
      const detail = message.error.message || JSON.stringify(message.error);
      if (!state.setupReady) {
        state.connecting = false;
        if (await retryWithRealtimeFallback(detail)) return;
        showReconnect(`Gemini setup error: ${detail}. Tap Reconnect.`);
        return;
      }
      setStatus(`Gemini error: ${detail}`, 'error');
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'setupComplete')) {
      state.connecting = false;
      state.reconnectNeeded = false;
      state.setupReady = true;
      updateSetupIndicator();
      talk.disabled = false;
      talk.className = 'ready';
      talk.textContent = '🎙 Start conversation';
      setStatus(`Ready · ${modelLabel(state.effectiveRealtimeModel)}`);

      if (state.reconnectAfterConnect && !state.recording) {
        state.reconnectAfterConnect = false;
        newLiveSession().catch(error => {
          showReconnect(`Connection error: ${error.message}. Tap Reconnect.`);
        });
      }
      return;
    }

    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) clearAiPlayback();

    const turn = state.activeTurn;
    if (!turn) return;

    if (content.inputTranscription?.languageCode) {
      recordLanguageCode(turn, content.inputTranscription.languageCode, 'input');
    }
    if (content.inputTranscription?.text) {
      turn.userText = concatTranscript(turn.userText, content.inputTranscription.text);
      render();
    }
    if (content.outputTranscription?.languageCode) {
      recordLanguageCode(turn, content.outputTranscription.languageCode, 'output');
    }
    if (content.outputTranscription?.text) {
      turn.aiText = concatTranscript(turn.aiText, content.outputTranscription.text);
      render();
    }

    for (const part of (content.modelTurn?.parts || [])) {
      if (part.inlineData?.data) queueAiPcm(part.inlineData.data);
    }

    if (content.turnComplete) finishTurn(turn);
  }

  async function newLiveSession({fallback = false} = {}) {
    if (state.connecting) return;
    state.connecting = true;
    state.reconnectNeeded = false;
    state.setupReady = false;
    if (!fallback) state.sessionFallbackTried = false;
    updateSetupIndicator();

    talk.disabled = true;
    talk.className = 'ready';
    talk.textContent = 'Connecting…';
    setStatus(fallback ? 'Connecting fallback realtime model…' : 'Creating secure live session…');
    clearAiPlayback();

    const oldSocket = state.ws;
    state.ws = null;
    if (oldSocket && oldSocket.readyState < WebSocket.CLOSING) {
      try { oldSocket.close(); } catch {}
    }

    const response = await fetch(`/api/session${fallback ? '?fallback=1' : ''}`, {cache: 'no-store'});
    const data = await readJsonResponse(response);
    if (!response.ok) {
      state.connecting = false;
      throw new Error(data.error || 'Could not create live session');
    }

    state.sessionId = data.session_id;
    state.effectiveRealtimeModel = data.model;
    state.sessionRequestedModel = data.requested_model || state.configuredRealtimeModel;
    state.realtimeFallbackModel = data.fallback_model || state.realtimeFallbackModel;
    if (data.fallback_used) state.sessionFallbackTried = true;

    const url = `${WS_BASE}?access_token=${encodeURIComponent(data.token)}`;
    const socket = new WebSocket(url);
    state.ws = socket;
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      if (state.ws !== socket) return;
      state.supportLanguage = selectedSupportLanguage(feedbackLanguageEl.value);
      state.sessionSilenceDurationMs = Number(silenceDurationEl.value);
      setStatus(`WebSocket open · configuring ${modelLabel(data.model)}…`);
      socket.send(JSON.stringify({
        setup: {
          model: `models/${data.model}`,
          generationConfig: {responseModalities: ['AUDIO']},
          systemInstruction: {
            parts: [{text: buildLiveLanguageInstruction(state.supportLanguage)}]
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              silenceDurationMs: state.sessionSilenceDurationMs
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      }));
    };

    socket.onmessage = event => onLiveMessage(event, socket);
    socket.onerror = () => {
      if (state.ws === socket && state.setupReady) {
        setStatus('Gemini Live WebSocket error.', 'error');
      }
    };
    socket.onclose = async event => {
      if (state.ws !== socket) return;
      state.ws = null;
      state.connecting = false;
      const reason = event.reason ? `: ${event.reason}` : '';

      if (!state.setupReady) {
        if (await retryWithRealtimeFallback(`WebSocket closed ${event.code}${reason}`)) return;
      }

      showReconnect(
        event.code === 1008
          ? 'Live session paused after being idle. Tap Reconnect.'
          : `Live session closed (${event.code})${reason}. Tap Reconnect.`
      );
    };
  }

  // ---------------------------------------------------------------------------
  // Microphone lifecycle
  // ---------------------------------------------------------------------------
  async function startConversation() {
    if (!state.setupReady || state.recording) return;
    await ensurePlayContext();
    metricEl.textContent = '';

    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    const audioTrack = state.micStream.getAudioTracks()[0];
    const actualSettings = audioTrack?.getSettings?.() || {};
    state.micAudioSettings = {
      echoCancellation: actualSettings.echoCancellation ?? null,
      noiseSuppression: actualSettings.noiseSuppression ?? null,
      autoGainControl: actualSettings.autoGainControl ?? null
    };
    console.log('[MIC SETTINGS]', state.micAudioSettings);

    state.inputCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (state.inputCtx.state === 'suspended') await state.inputCtx.resume();

    state.micSource = state.inputCtx.createMediaStreamSource(state.micStream);
    state.processor = state.inputCtx.createScriptProcessor(4096, 1, 1);
    state.recording = true;
    createTurn();
    state.inputForwarding = true;

    state.processor.onaudioprocess = event => {
      if (!state.recording || !state.inputForwarding || state.ws?.readyState !== WebSocket.OPEN) return;

      const mono = event.inputBuffer.getChannelData(0);
      const pcm = floatToPcm16(downsample(mono, state.inputCtx.sampleRate, 16000));
      if (state.activeTurn) state.activeTurn.pcmChunks.push(new Int16Array(pcm));

      state.ws.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: pcmToBase64(pcm),
            mimeType: 'audio/pcm;rate=16000'
          }
        }
      }));
    };

    state.micSource.connect(state.processor);
    state.processor.connect(state.inputCtx.destination);
    talk.className = 'recording';
    talk.textContent = '■ Stop conversation';
    setStatus('Listening… speak naturally.');
  }

  function sessionSettingsChanged() {
    return (
      selectedSupportLanguage(feedbackLanguageEl.value) !== state.supportLanguage ||
      realtimeModelEl.value !== state.sessionRequestedModel ||
      Number(silenceDurationEl.value) !== state.sessionSilenceDurationMs
    );
  }

  function stopConversation() {
    if (!state.recording) return;
    state.recording = false;
    state.inputForwarding = false;
    state.activeTurn = null;
    clearAiPlayback();
    cleanupMic();

    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({realtimeInput: {audioStreamEnd: true}}));
    }

    talk.disabled = false;
    talk.className = 'ready';

    if (sessionSettingsChanged()) {
      talk.textContent = 'Connecting…';
      setStatus('Applying session settings…');
      newLiveSession().catch(error => {
        showReconnect(`Connection error: ${error.message}. Tap Reconnect.`);
      });
    } else {
      talk.textContent = '🎙 Start conversation';
      setStatus('Conversation stopped.');
    }
  }

  // ---------------------------------------------------------------------------
  // Events + bootstrap
  // ---------------------------------------------------------------------------
  teacherEl.addEventListener('change', async () => {
    try {
      await persistSettings({teacher: teacherEl.value});
      setStatus(`Teacher ${teacherEl.value} saved.`);
    } catch (error) {
      await recoverSettings(error);
    }
  });

  feedbackLanguageEl.addEventListener('change', async () => {
    try {
      await persistSettings({support_language: feedbackLanguageEl.value});
      requestSessionReconnect('Support / correction language saved.');
    } catch (error) {
      await recoverSettings(error);
    }
  });

  realtimeModelEl.addEventListener('change', async () => {
    try {
      await persistSettings({realtime_conversation_model: realtimeModelEl.value});
      requestSessionReconnect('Realtime model saved.');
    } catch (error) {
      await recoverSettings(error);
    }
  });

  coachModelEl.addEventListener('change', async () => {
    try {
      await persistSettings({coach_model: coachModelEl.value});
      setStatus(`Coach model ${modelLabel(coachModelEl.value)} saved.`);
    } catch (error) {
      await recoverSettings(error);
    }
  });

  aiSpeedEl.addEventListener('change', async () => {
    const value = AI_SPEED_VALUES.includes(aiSpeedEl.value) ? aiSpeedEl.value : DEFAULT_AI_SPEED;
    aiSpeedEl.value = value;
    try {
      await persistSettings({ai_playback_rate: Number(value)});
      setStatus(`AI response speed ${value}× saved.`);
    } catch (error) {
      await recoverSettings(error);
    }
  });

  silenceDurationEl.addEventListener('change', async () => {
    try {
      await persistSettings({silence_duration_ms: Number(silenceDurationEl.value)});
      requestSessionReconnect(`Silence timeout ${silenceDurationEl.value} ms saved.`);
    } catch (error) {
      await recoverSettings(error);
    }
  });

  pronEl.addEventListener('change', async () => {
    render();
    try {
      await persistSettings({pronunciation_enabled: pronEl.checked});
      setStatus(`Pronunciation coaching ${pronEl.checked ? 'on' : 'off'} saved.`);
    } catch (error) {
      await recoverSettings(error);
      render();
    }
  });

  talk.addEventListener('click', async () => {
    try {
      if (state.reconnectNeeded || !state.setupReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
        await newLiveSession();
        return;
      }
      if (state.recording) stopConversation();
      else await startConversation();
    } catch (error) {
      showReconnect(`Connection error: ${error.message}. Tap Reconnect.`);
    }
  });

  window.addEventListener('beforeunload', () => {
    clearAiPlayback();
    cleanupMic();
    try { state.ws?.close(); } catch {}
  });

  async function bootstrap() {
    updateSetupIndicator();
    render();
    try {
      await loadSettings();
      setStatus('Settings loaded. Creating secure live session…');
      await newLiveSession();
    } catch (error) {
      showReconnect(`Startup error: ${error.message}. Tap Reconnect.`);
    }
  }

  bootstrap();
})();
