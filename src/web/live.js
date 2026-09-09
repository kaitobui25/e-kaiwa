import {
  LANGUAGE_POLICY_VERSION,
  buildLiveLanguageInstruction,
  finalizeLanguageMode,
  isCoachEligible,
  recordLanguageCode,
  selectedSupportLanguage
} from './language_policy.js';
import {
  PreferencesStore,
  TARGET_LANGUAGE,
  normalizePlaybackRate,
  targetSpeechLocale
} from './preferences.js';
import {PlaybackCoordinator} from './audio.js';
import {UiController} from './ui.js';

(() => {
  'use strict';

  const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
  const AI_SPEED_VALUES = ['0.5', '0.6', '0.7', '0.8', '0.9', '1.0', '1.1', '1.2', '1.3', '1.4', '1.5'];
  const DEFAULT_AI_SPEED = '0.8';
  const REPLAY_TURN_LIMIT = 8;

  const elements = {
    talk: document.getElementById('talk'),
    talkLabel: document.getElementById('talk-label'),
    status: document.getElementById('status'),
    setupDot: document.getElementById('setup-dot'),
    setupLabel: document.getElementById('setup-label'),
    metric: document.getElementById('metric'),
    conversation: document.getElementById('conversation'),
    teacher: document.getElementById('teacher'),
    feedbackLanguage: document.getElementById('feedback-language'),
    theme: document.getElementById('theme'),
    realtimeModel: document.getElementById('realtime-model'),
    coachModel: document.getElementById('coach-model'),
    aiSpeed: document.getElementById('ai-speed'),
    silenceDuration: document.getElementById('silence-duration'),
    pron: document.getElementById('pron'),
    settingsPanel: document.getElementById('settings-panel'),
    settingsOpen: document.getElementById('settings-open'),
    settingsClose: document.getElementById('settings-close')
  };

  const state = {
    appMode: 'dev',
    ws: null,
    sessionId: null,
    configuredRealtimeModel: '',
    realtimeFallbackModel: '',
    effectiveRealtimeModel: '',
    sessionRequestedModel: '',
    sessionFallbackTried: false,
    supportLanguage: 'ja',
    targetLanguage: TARGET_LANGUAGE,
    sessionSilenceDurationMs: 1000,
    echoGuardMs: 250,
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
    turnNo: 1,
    activeTurn: null,
    turns: [],
    ui: null,
    playback: null,
    preferences: null
  };

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
    if (!element) return;
    const values = Array.isArray(choices) ? choices : [];
    element.replaceChildren(...values.map(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = modelLabel(value);
      return option;
    }));
    element.value = selected || values[0] || '';
  }

  function publicOrDev(publicKey, devText) {
    return state.appMode === 'public' ? state.ui?.t(publicKey) || publicKey : devText;
  }

  function setStatus(publicKey, devText, {error = false, suffix = ''} = {}) {
    state.ui?.setStatus(`${publicOrDev(publicKey, devText)}${suffix}`, {error});
  }

  function render() {
    state.ui?.render(state.turns, {pronunciationEnabled: elements.pron.checked});
  }

  function concatTranscript(previous, incoming) {
    const oldText = (previous || '').trim();
    const newText = (incoming || '').trim();
    if (!oldText) return newText;
    if (!newText || oldText.endsWith(newText)) return oldText;
    if (newText.startsWith(oldText)) return newText;
    return oldText + (/[\s,.!?]$/.test(oldText) ? '' : ' ') + newText;
  }

  function bytesToB64(bytes) {
    let output = '';
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) {
      output += String.fromCharCode(...bytes.subarray(index, index + step));
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

  function downsample(input, inputRate, outputRate = 16000) {
    if (inputRate === outputRate) return new Float32Array(input);
    const ratio = inputRate / outputRate;
    const length = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const start = Math.floor(index * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
      let sum = 0;
      for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += input[sourceIndex];
      output[index] = sum / (end - start);
    }
    return output;
  }

  function floatToPcm16(floatData) {
    const pcm = new Int16Array(floatData.length);
    for (let index = 0; index < floatData.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, floatData[index]));
      pcm[index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    }
    return pcm;
  }

  function aiPlaybackRate() {
    const value = elements.aiSpeed.value;
    return AI_SPEED_VALUES.includes(value) ? Number(value) : Number(DEFAULT_AI_SPEED);
  }

  function initializeUi(payload) {
    state.appMode = payload?.app_mode === 'public' ? 'public' : 'dev';
    state.preferences = new PreferencesStore({
      storage: state.appMode === 'public' ? window.localStorage : null,
      browserLanguage: navigator.language,
      prefersDark: window.matchMedia?.('(prefers-color-scheme: dark)')?.matches || false
    });

    state.ui = new UiController({
      mode: state.appMode,
      elements,
      onAction: handleUiAction
    });

    state.playback = new PlaybackCoordinator({
      getEchoGuardMs: () => state.echoGuardMs,
      onBlockedChange: (blocked, reason) => {
        state.inputForwarding = !blocked && Boolean(
          state.recording && state.activeTurn && state.setupReady && state.ws?.readyState === WebSocket.OPEN
        );
        if (blocked && reason === 'live') setStatus('aiSpeaking', 'AI speaking…');
      }
    });
  }

  function applySettingsPayload(payload) {
    const settings = payload?.settings || {};
    const models = payload?.models || {};
    const choices = payload?.choices || {};

    elements.teacher.value = settings.teacher || 'Normal';
    elements.silenceDuration.value = String(settings.silence_duration_ms || 1000);
    state.sessionSilenceDurationMs = Number(elements.silenceDuration.value);
    const echoGuardMs = Number(settings.echo_guard_ms);
    state.echoGuardMs = Number.isFinite(echoGuardMs) && echoGuardMs >= 0 ? echoGuardMs : 250;

    if (state.appMode === 'public') {
      const preferences = state.preferences.load({
        appLanguage: settings.support_language || 'ja',
        playbackRate: settings.ai_playback_rate ?? 0.8,
        pronunciationEnabled: settings.pronunciation_enabled !== false
      });
      elements.feedbackLanguage.value = preferences.appLanguage;
      elements.aiSpeed.value = String(preferences.playbackRate);
      elements.pron.checked = preferences.pronunciationEnabled;
      state.ui.setLanguage(preferences.appLanguage);
      state.ui.setTheme(preferences.theme);
    } else {
      elements.feedbackLanguage.value = settings.support_language || 'vi';
      elements.aiSpeed.value = AI_SPEED_VALUES.includes(String(settings.ai_playback_rate))
        ? String(settings.ai_playback_rate)
        : DEFAULT_AI_SPEED;
      elements.pron.checked = settings.pronunciation_enabled !== false;
      state.ui.setTheme('dark');
      state.configuredRealtimeModel = models.realtime_conversation || '';
      state.realtimeFallbackModel = models.realtime_fallback || '';
      setSelectChoices(elements.realtimeModel, choices.realtime_conversation, state.configuredRealtimeModel);
      const coachSelected = models.coach_mode === 'auto' ? 'auto' : models.coach_model;
      setSelectChoices(elements.coachModel, choices.coach, coachSelected);
    }

    state.supportLanguage = selectedSupportLanguage(elements.feedbackLanguage.value);
    render();
  }

  async function loadSettings() {
    const response = await fetch('/api/settings', {cache: 'no-store'});
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Could not load settings');
    if (!state.ui) initializeUi(data);
    applySettingsPayload(data);
    return data;
  }

  async function persistSettings(changes) {
    if (state.appMode === 'public') throw new Error('Public settings are local/read-only');
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
    try { await loadSettings(); } catch {}
    state.ui?.setStatus(`Settings error: ${error.message}`, {error: true});
  }

  function requestSessionReconnect(message) {
    if (state.recording) {
      state.ui.setStatus(message);
      return;
    }
    if (state.connecting) {
      state.reconnectAfterConnect = true;
      state.ui.setStatus(message);
      return;
    }
    newLiveSession().catch(error => showReconnect(`Connection error: ${error.message}.`));
  }

  function cleanupMic() {
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

  function createTurn() {
    if (state.activeTurn || !state.recording) return null;
    const turn = {
      no: state.turnNo,
      pcmChunks: [],
      replayPcm: null,
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
      startedAtMs: performance.now(),
      coachSent: false,
      coach: null,
      finished: false
    };
    state.activeTurn = turn;
    state.turns.push(turn);
    render();
    return turn;
  }

  function boundReplayHistory() {
    const withAudio = state.turns.filter(turn => turn.replayPcm?.length);
    for (const oldTurn of withAudio.slice(0, Math.max(0, withAudio.length - REPLAY_TURN_LIMIT))) {
      oldTurn.replayPcm = null;
    }
  }

  async function runCoach(turn) {
    if (!isCoachEligible(turn) || turn.coachSent || !turn.userText.trim() || !turn.replayPcm?.length) return;
    turn.coachSent = true;
    try {
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          session_id: state.sessionId,
          turn: turn.no,
          transcript: turn.userText,
          teacher: elements.teacher.value,
          feedback_language: elements.feedbackLanguage.value,
          pronunciation_enabled: elements.pron.checked,
          sample_rate: 16000,
          pcm_b64: pcmToBase64(turn.replayPcm)
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
      buttonEnabled: !elements.talk.disabled,
      setupReady: state.setupReady
    };
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
          teacher: elements.teacher.value,
          pronunciation_enabled: elements.pron.checked,
          silence_duration_ms: state.sessionSilenceDurationMs,
          ai_playback_rate: aiPlaybackRate(),
          echo_guard_ms: state.echoGuardMs,
          realtime_model: state.effectiveRealtimeModel,
          coach_model: elements.coachModel.value || 'server'
        },
        frontend_state: frontendState
      })
    }).catch(() => {});
  }

  function armNextTurnAfterPlayback() {
    const delay = state.playback.armAfterLive(() => {
      if (!state.recording || !state.setupReady || state.ws?.readyState !== WebSocket.OPEN) return;
      createTurn();
      state.inputForwarding = true;
      setStatus('listening', 'Listening… speak naturally.');
    });
    setStatus(delay > 0 ? 'aiSpeaking' : 'listening', delay > 0 ? 'AI speaking…' : 'Listening…');
  }

  function finishTurn(turn) {
    if (!turn || turn.finished || turn !== state.activeTurn) return;
    turn.finished = true;
    finalizeLanguageMode(turn);
    turn.replayPcm = joinPcm(turn.pcmChunks);
    turn.pcmChunks = [];
    boundReplayHistory();

    if (isCoachEligible(turn)) runCoach(turn);
    state.turnNo += 1;
    state.activeTurn = null;
    state.inputForwarding = false;
    postTurnMetric(turn);
    render();

    if (state.recording && state.setupReady && state.ws?.readyState === WebSocket.OPEN) {
      armNextTurnAfterPlayback();
    } else if (!state.setupReady || state.ws?.readyState !== WebSocket.OPEN) {
      showReconnect(publicOrDev('reconnect', 'Live session ended. Tap Reconnect.'));
    }
  }

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
    state.playback?.clear();
    cleanupMic();
    state.setupReady = false;
    state.reconnectNeeded = true;
    state.connecting = false;
    state.ui?.setSetupReady(false);
    state.ui?.setTalkState('reconnect');
    state.ui?.setStatus(message || publicOrDev('reconnect', 'Live session ended. Tap Reconnect.'));
  }

  async function retryWithRealtimeFallback(reason) {
    if (state.setupReady || state.sessionFallbackTried || !state.realtimeFallbackModel || state.realtimeFallbackModel === state.effectiveRealtimeModel) return false;
    state.sessionFallbackTried = true;
    state.connecting = false;
    state.ui.setStatus(`Primary realtime model failed (${reason}). Trying fallback…`);
    try {
      await newLiveSession({fallback: true});
    } catch (error) {
      showReconnect(`Fallback connection error: ${error.message}.`);
    }
    return true;
  }

  async function onLiveMessage(event, socket) {
    if (state.ws !== socket) return;
    let message;
    try {
      message = JSON.parse(await webSocketDataToText(event.data));
    } catch (error) {
      state.ui.setStatus(`Could not decode Gemini message: ${error.message}`, {error: true});
      return;
    }

    if (message.error) {
      const detail = message.error.message || JSON.stringify(message.error);
      if (!state.setupReady) {
        state.connecting = false;
        if (await retryWithRealtimeFallback(detail)) return;
        showReconnect(`Gemini setup error: ${detail}.`);
        return;
      }
      state.ui.setStatus(`Gemini error: ${detail}`, {error: true});
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'setupComplete')) {
      state.connecting = false;
      state.reconnectNeeded = false;
      state.setupReady = true;
      state.ui.setSetupReady(true);
      state.ui.setTalkState('ready');
      state.ui.setStatus(state.appMode === 'public' ? state.ui.t('ready') : `Ready · ${modelLabel(state.effectiveRealtimeModel)}`);
      if (state.reconnectAfterConnect && !state.recording) {
        state.reconnectAfterConnect = false;
        newLiveSession().catch(error => showReconnect(`Connection error: ${error.message}.`));
      }
      return;
    }

    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) state.playback.clearLive();

    const turn = state.activeTurn;
    if (!turn) return;
    if (content.inputTranscription?.languageCode) recordLanguageCode(turn, content.inputTranscription.languageCode, 'input');
    if (content.inputTranscription?.text) {
      turn.userText = concatTranscript(turn.userText, content.inputTranscription.text);
      render();
    }
    if (content.outputTranscription?.languageCode) recordLanguageCode(turn, content.outputTranscription.languageCode, 'output');
    if (content.outputTranscription?.text) {
      turn.aiText = concatTranscript(turn.aiText, content.outputTranscription.text);
      render();
    }

    for (const part of (content.modelTurn?.parts || [])) {
      if (!part.inlineData?.data) continue;
      if (turn.firstAudioMs == null) turn.firstAudioMs = performance.now() - turn.startedAtMs;
      state.playback.queueLivePcm(part.inlineData.data, aiPlaybackRate());
    }
    if (content.turnComplete) finishTurn(turn);
  }

  async function newLiveSession({fallback = false} = {}) {
    if (state.connecting) return;
    state.connecting = true;
    state.reconnectNeeded = false;
    state.setupReady = false;
    if (!fallback) state.sessionFallbackTried = false;
    state.ui.setSetupReady(false);
    state.ui.setTalkState('connecting');
    setStatus('connecting', fallback ? 'Connecting fallback realtime model…' : 'Creating secure live session…');
    state.playback.clear();

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
    state.sessionRequestedModel = data.requested_model || data.model;
    state.realtimeFallbackModel = data.fallback_model || state.realtimeFallbackModel;
    state.sessionSilenceDurationMs = Number(data.silence_duration_ms || state.sessionSilenceDurationMs);
    state.echoGuardMs = Number(data.echo_guard_ms ?? state.echoGuardMs);
    if (data.fallback_used) state.sessionFallbackTried = true;

    const socket = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(data.token)}`);
    state.ws = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      if (state.ws !== socket) return;
      state.supportLanguage = selectedSupportLanguage(elements.feedbackLanguage.value);
      state.ui.setStatus(state.appMode === 'public' ? state.ui.t('connecting') : `WebSocket open · configuring ${modelLabel(data.model)}…`);
      socket.send(JSON.stringify({
        setup: {
          model: `models/${data.model}`,
          generationConfig: {responseModalities: ['AUDIO']},
          systemInstruction: {parts: [{text: buildLiveLanguageInstruction(state.supportLanguage)}]},
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
      if (state.ws === socket && state.setupReady) state.ui.setStatus('Gemini Live WebSocket error.', {error: true});
    };
    socket.onclose = async event => {
      if (state.ws !== socket) return;
      state.ws = null;
      state.connecting = false;
      const reason = event.reason ? `: ${event.reason}` : '';
      if (!state.setupReady && await retryWithRealtimeFallback(`WebSocket closed ${event.code}${reason}`)) return;
      showReconnect(event.code === 1008 ? publicOrDev('reconnect', 'Live session paused after being idle. Tap Reconnect.') : `Live session closed (${event.code})${reason}.`);
    };
  }

  async function startConversation() {
    if (!state.setupReady || state.recording) return;
    await state.playback.ensureContext();
    elements.metric.textContent = '';
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true},
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
        realtimeInput: {audio: {data: pcmToBase64(pcm), mimeType: 'audio/pcm;rate=16000'}}
      }));
    };

    state.micSource.connect(state.processor);
    state.processor.connect(state.inputCtx.destination);
    state.ui.setTalkState('recording');
    setStatus('listening', 'Listening… speak naturally.');
  }

  function sessionSettingsChanged() {
    return selectedSupportLanguage(elements.feedbackLanguage.value) !== state.supportLanguage || (
      state.appMode === 'dev' && (
        elements.realtimeModel.value !== state.sessionRequestedModel ||
        Number(elements.silenceDuration.value) !== state.sessionSilenceDurationMs
      )
    );
  }

  function stopConversation() {
    if (!state.recording) return;
    state.recording = false;
    state.inputForwarding = false;
    state.activeTurn = null;
    state.playback.clear();
    cleanupMic();
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({realtimeInput: {audioStreamEnd: true}}));
    }
    if (sessionSettingsChanged()) {
      state.ui.setTalkState('connecting');
      newLiveSession().catch(error => showReconnect(`Connection error: ${error.message}.`));
    } else {
      state.ui.setTalkState('ready');
      setStatus('stopped', 'Conversation stopped.');
    }
  }

  async function handleUiAction(action, detail) {
    const turn = state.turns.find(item => item.no === detail.turn);
    if (!turn || !state.playback || state.playback.livePlaying) return;
    if (action === 'replay-user' && turn.replayPcm?.length) {
      await state.playback.playUserPcm(turn.replayPcm, 16000);
      return;
    }
    if (action === 'speak-correction') {
      await state.playback.speak(turn.coach?.correction || turn.userText, {
        lang: targetSpeechLocale(state.targetLanguage),
        rate: Math.min(1, aiPlaybackRate())
      });
      return;
    }
    if (action === 'speak-problem') {
      const problems = turn.coach?.pronunciation?.problems || [];
      const word = problems[detail.problem]?.word;
      if (word) await state.playback.speak(word, {lang: targetSpeechLocale(state.targetLanguage), rate: 0.8});
    }
  }

  elements.feedbackLanguage.addEventListener('change', async () => {
    if (state.appMode === 'public') {
      const language = state.preferences.setAppLanguage(elements.feedbackLanguage.value);
      state.ui.setLanguage(language);
      render();
      requestSessionReconnect(state.ui.t('language'));
      return;
    }
    try {
      await persistSettings({support_language: elements.feedbackLanguage.value});
      requestSessionReconnect('Support / correction language saved.');
    } catch (error) { await recoverSettings(error); }
  });

  elements.theme.addEventListener('change', () => {
    if (state.appMode !== 'public') return;
    state.ui.setTheme(state.preferences.setTheme(elements.theme.value));
  });

  elements.teacher.addEventListener('change', async () => {
    if (state.appMode !== 'dev') return;
    try { await persistSettings({teacher: elements.teacher.value}); } catch (error) { await recoverSettings(error); }
  });

  elements.realtimeModel.addEventListener('change', async () => {
    if (state.appMode !== 'dev') return;
    try {
      await persistSettings({realtime_conversation_model: elements.realtimeModel.value});
      requestSessionReconnect('Realtime model saved.');
    } catch (error) { await recoverSettings(error); }
  });

  elements.coachModel.addEventListener('change', async () => {
    if (state.appMode !== 'dev') return;
    try { await persistSettings({coach_model: elements.coachModel.value}); } catch (error) { await recoverSettings(error); }
  });

  elements.aiSpeed.addEventListener('change', async () => {
    const value = String(normalizePlaybackRate(elements.aiSpeed.value, 0.8));
    elements.aiSpeed.value = value;
    if (state.appMode === 'public') {
      state.preferences.setPlaybackRate(value);
      return;
    }
    try { await persistSettings({ai_playback_rate: Number(value)}); } catch (error) { await recoverSettings(error); }
  });

  elements.silenceDuration.addEventListener('change', async () => {
    if (state.appMode !== 'dev') return;
    try {
      await persistSettings({silence_duration_ms: Number(elements.silenceDuration.value)});
      requestSessionReconnect(`Silence timeout ${elements.silenceDuration.value} ms saved.`);
    } catch (error) { await recoverSettings(error); }
  });

  elements.pron.addEventListener('change', async () => {
    render();
    if (state.appMode === 'public') {
      state.preferences.setPronunciationEnabled(elements.pron.checked);
      return;
    }
    try { await persistSettings({pronunciation_enabled: elements.pron.checked}); } catch (error) { await recoverSettings(error); render(); }
  });

  elements.talk.addEventListener('click', async () => {
    try {
      if (state.reconnectNeeded || !state.setupReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
        await newLiveSession();
        return;
      }
      if (state.recording) stopConversation();
      else await startConversation();
    } catch (error) {
      showReconnect(`Connection error: ${error.message}.`);
    }
  });

  window.addEventListener('beforeunload', () => {
    state.playback?.clear();
    cleanupMic();
    try { state.ws?.close(); } catch {}
  });

  async function bootstrap() {
    try {
      const payload = await loadSettings();
      state.ui.setSetupReady(false);
      state.ui.setTalkState('connecting');
      state.ui.setStatus(state.appMode === 'public' ? state.ui.t('connecting') : 'Settings loaded. Creating secure live session…');
      applySettingsPayload(payload);
      await newLiveSession();
    } catch (error) {
      if (!state.ui) initializeUi({app_mode: 'dev'});
      showReconnect(`Startup error: ${error.message}.`);
    }
  }

  bootstrap();
})();
