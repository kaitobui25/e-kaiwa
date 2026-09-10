import {
  LANGUAGE_POLICY_VERSION,
  buildLiveLanguageInstruction,
  concatTargetTranscript,
  finalizeLanguageMode,
  isCoachEligible,
  recordLanguageCode,
  selectedSupportLanguage,
  TARGET_LANGUAGE_METADATA
} from './language_policy.js';
import {
  CONVERSATION_MODES,
  PreferencesStore,
  TARGET_LANGUAGE,
  isHandsFreeMode,
  normalizePlaybackRate,
  normalizeTargetLanguage,
  targetSpeechLocale
} from './preferences.js';
import {PlaybackCoordinator} from './audio.js';
import {UiController} from './ui.js';
import {LiveRecoveryCoordinator} from './live_recovery.js';

(() => {
  'use strict';

  const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
  const AI_SPEED_VALUES = ['0.5', '0.6', '0.7', '0.8', '0.9', '1.0', '1.1', '1.2', '1.3', '1.4', '1.5'];
  const DEFAULT_AI_SPEED = '0.8';
  const REPLAY_TURN_LIMIT = 8;
  const RESPONSE_TIMEOUT_MS = 25000;

  const elements = {
    talk: document.getElementById('talk'),
    talkLabel: document.getElementById('talk-label'),
    talkMode: document.getElementById('talk-mode'),
    status: document.getElementById('status'),
    setupDot: document.getElementById('setup-dot'),
    setupLabel: document.getElementById('setup-label'),
    metric: document.getElementById('metric'),
    conversation: document.getElementById('conversation'),
    teacher: document.getElementById('teacher'),
    feedbackLanguage: document.getElementById('feedback-language'),
    targetLanguage: document.getElementById('target-language'),
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
    conversationMode: CONVERSATION_MODES.HANDS_FREE,
    conversationActive: false,
    pushToTalkPressed: false,
    pushActivityOpen: false,
    pushHoldGeneration: 0,
    ws: null,
    sessionId: null,
    configuredRealtimeModel: '',
    realtimeFallbackModel: '',
    effectiveRealtimeModel: '',
    sessionRequestedModel: '',
    sessionFallbackTried: false,
    supportLanguage: 'ja',
    // selectedTargetLanguage is the control/preference value. targetLanguage is
    // frozen for the active Live session and every turn it creates.
    selectedTargetLanguage: TARGET_LANGUAGE,
    targetLanguage: TARGET_LANGUAGE,
    sessionSilenceDurationMs: 1000,
    echoGuardMs: 250,
    setupReady: false,
    reconnectNeeded: false,
    reconnectAfterConnect: false,
    reconnectPending: false,
    resumeHandsFreeAfterReconnect: false,
    connecting: false,
    browserOnline: navigator.onLine !== false,
    inputForwarding: false,
    inputCtx: null,
    micReadyPromise: null,
    micAcquireGeneration: 0,
    micStream: null,
    micSource: null,
    processor: null,
    micAudioSettings: {},
    turnNo: 1,
    activeTurn: null,
    turns: [],
    ui: null,
    playback: null,
    preferences: null,
    recovery: null
  };

  state.recovery = new LiveRecoveryCoordinator({
    responseTimeoutMs: RESPONSE_TIMEOUT_MS,
    onResponseTimeout: turnNo => handleResponseTimeout(turnNo),
    onReconnectDue: () => handleScheduledReconnect()
  });

  function emitUiEvent(payload) {
    try {
      fetch('/api/ui-event', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          session_id: state.sessionId || '',
          active_turn: state.activeTurn?.no || null,
          ...payload
        }),
        keepalive: true
      }).catch(() => {});
    } catch {}
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

  function setTargetLanguageChoices(choices, selected) {
    if (!elements.targetLanguage) return;
    const values = [...new Set((Array.isArray(choices) ? choices : [])
      .filter(value => Object.prototype.hasOwnProperty.call(TARGET_LANGUAGE_METADATA, value)))];
    const supported = values.length ? values : [TARGET_LANGUAGE];
    const selectedValue = supported.includes(selected)
      ? selected
      : (supported.includes(TARGET_LANGUAGE) ? TARGET_LANGUAGE : supported[0]);
    elements.targetLanguage.replaceChildren(...supported.map(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = TARGET_LANGUAGE_METADATA[value]?.name || value;
      return option;
    }));
    elements.targetLanguage.value = selectedValue;
  }

  function publicOrDev(publicKey, devText) {
    return state.appMode === 'public' ? state.ui?.t(publicKey) || publicKey : devText;
  }

  function setStatus(publicKey, devText, {error = false, suffix = ''} = {}) {
    state.ui?.setStatus(`${publicOrDev(publicKey, devText)}${suffix}`, {error});
  }

  function handsFree() {
    return state.appMode !== 'public' || isHandsFreeMode(state.conversationMode);
  }

  function inputBusy() {
    return state.conversationActive || state.pushToTalkPressed || state.pushActivityOpen;
  }

  function render() {
    state.ui?.render(state.turns, {
      pronunciationEnabled: elements.pron.checked,
      conversationMode: state.conversationMode
    });
  }

  function updateStreamingTurn(turn) {
    if (!state.ui?.updateStreamingTurn(turn)) render();
  }

  function concatTranscript(previous, incoming, targetLanguage = state.targetLanguage) {
    return concatTargetTranscript(previous, incoming, targetLanguage);
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
    state.conversationMode = state.appMode === 'public'
      ? CONVERSATION_MODES.PUSH_TO_TALK
      : CONVERSATION_MODES.HANDS_FREE;
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
    state.ui.setConversationMode(state.conversationMode);

    state.playback = new PlaybackCoordinator({
      getEchoGuardMs: () => state.echoGuardMs,
      onBlockedChange: (blocked, reason) => {
        if (blocked) {
          state.inputForwarding = false;
          if (reason === 'live') {
            state.ui?.setTalkState('speaking');
            setStatus('aiSpeaking', 'AI speaking…');
          }
          return;
        }

        // Only hands-free mode may automatically reopen microphone forwarding.
        // Push-to-talk forwarding is owned exclusively by press/release events.
        if (handsFree()) {
          state.inputForwarding = Boolean(
            state.conversationActive &&
            state.activeTurn &&
            state.setupReady &&
            state.ws?.readyState === WebSocket.OPEN
          );
        } else {
          state.inputForwarding = false;
        }
      }
    });
  }

  function applySettingsPayload(payload) {
    const settings = payload?.settings || {};
    const models = payload?.models || {};
    const choices = payload?.choices || {};
    setTargetLanguageChoices(payload?.target_languages, state.selectedTargetLanguage);

    elements.teacher.value = settings.teacher || 'Normal';
    elements.silenceDuration.value = String(settings.silence_duration_ms || 1000);
    state.sessionSilenceDurationMs = Number(elements.silenceDuration.value);
    const echoGuardMs = Number(settings.echo_guard_ms);
    state.echoGuardMs = Number.isFinite(echoGuardMs) && echoGuardMs >= 0 ? echoGuardMs : 250;

    if (state.appMode === 'public') {
      const preferences = state.preferences.load({
        appLanguage: settings.support_language || 'ja',
        playbackRate: settings.ai_playback_rate ?? 0.8,
        pronunciationEnabled: settings.pronunciation_enabled !== false,
        targetLanguage: TARGET_LANGUAGE,
        conversationMode: CONVERSATION_MODES.PUSH_TO_TALK
      });
      elements.feedbackLanguage.value = preferences.appLanguage;
      elements.targetLanguage.value = preferences.targetLanguage;
      state.selectedTargetLanguage = preferences.targetLanguage;
      elements.aiSpeed.value = String(preferences.playbackRate);
      elements.pron.checked = preferences.pronunciationEnabled;
      state.conversationMode = preferences.conversationMode;
      state.ui.setLanguage(preferences.appLanguage);
      state.ui.setTheme(preferences.theme);
      state.ui.setConversationMode(state.conversationMode);
    } else {
      elements.feedbackLanguage.value = settings.support_language || 'vi';
      // Saving server settings must not overwrite the developer's selected
      // target while the existing Live socket still has its old instruction.
      elements.targetLanguage.value = normalizeTargetLanguage(
        elements.targetLanguage.value || state.selectedTargetLanguage
      );
      state.selectedTargetLanguage = elements.targetLanguage.value;
      elements.aiSpeed.value = AI_SPEED_VALUES.includes(String(settings.ai_playback_rate))
        ? String(settings.ai_playback_rate)
        : DEFAULT_AI_SPEED;
      elements.pron.checked = settings.pronunciation_enabled !== false;
      state.conversationMode = CONVERSATION_MODES.HANDS_FREE;
      state.ui.setConversationMode(state.conversationMode);
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
    // Settings changes require a fresh setup because instruction/model/VAD may differ.
    if (inputBusy() || state.activeTurn) {
      state.reconnectPending = true;
      state.ui.setStatus(message);
      return;
    }
    if (state.connecting) {
      state.reconnectAfterConnect = true;
      state.ui.setStatus(message);
      return;
    }
    state.recovery.clearHandle();
    newLiveSession({reason: 'settings_change'}).catch(error => showReconnect(`Connection error: ${error.message}.`));
  }

  function cleanupMic({clearSettings = true} = {}) {
    state.inputForwarding = false;
    state.micAcquireGeneration += 1;
    try { state.processor?.disconnect(); } catch {}
    try { state.micSource?.disconnect(); } catch {}
    state.micStream?.getTracks().forEach(track => track.stop());
    try { state.inputCtx?.close(); } catch {}
    state.processor = null;
    state.micSource = null;
    state.micStream = null;
    state.inputCtx = null;
    if (clearSettings) state.micAudioSettings = {};
  }

  async function ensureMicReady() {
    if (state.processor && state.micStream && state.inputCtx) return true;
    if (state.micReadyPromise) return state.micReadyPromise;

    const generation = state.micAcquireGeneration;
    state.micReadyPromise = (async () => {
      await state.playback.ensureContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true},
        video: false
      });

      if (generation !== state.micAcquireGeneration) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }

      state.micStream = stream;
      const audioTrack = stream.getAudioTracks()[0];
      const actualSettings = audioTrack?.getSettings?.() || {};
      state.micAudioSettings = {
        echoCancellation: actualSettings.echoCancellation ?? null,
        noiseSuppression: actualSettings.noiseSuppression ?? null,
        autoGainControl: actualSettings.autoGainControl ?? null
      };
      console.log('[MIC SETTINGS]', state.micAudioSettings);

      state.inputCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (state.inputCtx.state === 'suspended') await state.inputCtx.resume();
      state.micSource = state.inputCtx.createMediaStreamSource(stream);
      state.processor = state.inputCtx.createScriptProcessor(4096, 1, 1);
      state.processor.onaudioprocess = event => {
        if (!state.inputForwarding || state.ws?.readyState !== WebSocket.OPEN || !state.activeTurn) return;
        const mono = event.inputBuffer.getChannelData(0);
        const pcm = floatToPcm16(downsample(mono, state.inputCtx.sampleRate, 16000));
        state.activeTurn.pcmChunks.push(new Int16Array(pcm));
        state.ws.send(JSON.stringify({
          realtimeInput: {audio: {data: pcmToBase64(pcm), mimeType: 'audio/pcm;rate=16000'}}
        }));
      };

      state.micSource.connect(state.processor);
      state.processor.connect(state.inputCtx.destination);
      return true;
    })();

    try {
      return await state.micReadyPromise;
    } finally {
      state.micReadyPromise = null;
    }
  }

  function createTurn() {
    if (state.activeTurn) return null;
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
      targetLanguage: state.targetLanguage,
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

  function abortActiveTurn(reason = 'connection_recovery') {
    const turn = state.activeTurn;
    if (!turn) return;
    state.recovery.finishResponse(turn.no);
    turn.finished = true;
    turn.coachEligible = false;
    turn.coachSkipReason = reason;
    turn.pcmChunks = [];
    turn.replayPcm = null;
    if (!turn.userText.trim() && !turn.aiText.trim()) {
      state.turns = state.turns.filter(item => item !== turn);
    }
    state.turnNo += 1;
    state.activeTurn = null;
    state.pushActivityOpen = false;
    state.inputForwarding = false;
    render();
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
          target_language: turn.targetLanguage,
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
      recording: handsFree() ? state.conversationActive : state.pushToTalkPressed,
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
        target_language: turn.targetLanguage,
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

  function armHandsFreeAfterPlayback() {
    const delay = state.playback.armAfterLive(() => {
      if (!state.conversationActive || !state.setupReady || state.ws?.readyState !== WebSocket.OPEN) return;
      createTurn();
      state.inputForwarding = true;
      state.ui.setTalkState('recording');
      setStatus('listening', 'Listening… speak naturally.');
    });
    state.ui.setTalkState(delay > 0 ? 'speaking' : 'recording');
    setStatus(delay > 0 ? 'aiSpeaking' : 'listening', delay > 0 ? 'AI speaking…' : 'Listening…');
  }

  function armPushToTalkAfterPlayback() {
    const delay = state.playback.armAfterLive(() => {
      if (!state.setupReady || state.ws?.readyState !== WebSocket.OPEN || state.activeTurn) return;
      state.ui.setTalkState('ready');
      state.ui.setStatus(state.ui.t('holdToTalk'));
    });
    state.ui.setTalkState(delay > 0 ? 'speaking' : 'ready');
    if (delay > 0) setStatus('aiSpeaking', 'AI speaking…');
    else state.ui.setStatus(state.ui.t('holdToTalk'));
  }

  function finishTurn(turn) {
    if (!turn || turn.finished || turn !== state.activeTurn) return;
    state.recovery.finishResponse(turn.no);
    turn.finished = true;
    finalizeLanguageMode(turn);
    turn.replayPcm = joinPcm(turn.pcmChunks);
    turn.pcmChunks = [];
    boundReplayHistory();

    if (isCoachEligible(turn)) runCoach(turn);
    state.turnNo += 1;
    state.activeTurn = null;
    state.inputForwarding = false;
    state.pushActivityOpen = false;
    postTurnMetric(turn);
    render();

    if (sessionSettingsChanged()) {
      state.reconnectPending = false;
      state.recovery.clearHandle();
      newLiveSession({reason: 'settings_change_after_turn'}).catch(error => showReconnect(`Connection error: ${error.message}.`));
      return;
    }

    if (state.reconnectPending) {
      state.reconnectPending = false;
      if (handsFree() && state.conversationActive) state.resumeHandsFreeAfterReconnect = true;
      newLiveSession({resume: true, reason: 'deferred_recovery'}).catch(error => showReconnect(`Connection error: ${error.message}.`));
      return;
    }

    if (!state.setupReady || state.ws?.readyState !== WebSocket.OPEN) {
      recoverLiveSession('turn_complete_socket_unavailable', {resume: true, force: true});
      return;
    }

    if (handsFree() && state.conversationActive) armHandsFreeAfterPlayback();
    else if (!handsFree()) armPushToTalkAfterPlayback();
  }

  async function webSocketDataToText(data) {
    if (typeof data === 'string') return data;
    if (data instanceof Blob) return await data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
    return String(data);
  }

  function resetInputState() {
    state.conversationActive = false;
    state.pushToTalkPressed = false;
    state.pushActivityOpen = false;
    state.inputForwarding = false;
    state.activeTurn = null;
  }

  function showReconnect(message) {
    state.recovery.clearTimers();
    resetInputState();
    state.playback?.clear();
    cleanupMic();
    state.setupReady = false;
    state.reconnectNeeded = true;
    state.connecting = false;
    state.ui?.setSetupReady(false);
    state.ui?.setTalkState('reconnect');
    state.ui?.setStatus(message || publicOrDev('reconnect', 'Live session ended. Tap Reconnect.'));
  }

  async function recoverLiveSession(reason, {resume = true, force = true} = {}) {
    if (!state.browserOnline) return;
    if (state.connecting) return;
    if ((inputBusy() || state.activeTurn) && !force) {
      state.reconnectPending = true;
      return;
    }

    if (handsFree() && state.conversationActive) state.resumeHandsFreeAfterReconnect = true;
    if (force) abortActiveTurn(reason);
    state.inputForwarding = false;
    state.pushToTalkPressed = false;
    state.pushActivityOpen = false;
    state.playback?.clear();
    cleanupMic({clearSettings: false});
    emitUiEvent({event: 'reconnect_attempt', reason, resume_requested: Boolean(resume && state.recovery.hasHandle())});

    try {
      await newLiveSession({resume, reason});
    } catch (error) {
      emitUiEvent({event: 'reconnect_result', reason, ok: false, error: String(error.message || error).slice(0, 120)});
      showReconnect(`Connection error: ${error.message}.`);
    }
  }

  function handleScheduledReconnect() {
    emitUiEvent({event: 'go_away_reconnect_due'});
    if (!handsFree() && (inputBusy() || state.activeTurn)) {
      state.reconnectPending = true;
      return;
    }
    recoverLiveSession('go_away', {resume: true, force: true});
  }

  function handleResponseTimeout(turnNo) {
    if (!state.activeTurn || state.activeTurn.no !== turnNo) return;
    emitUiEvent({event: 'response_timeout', turn: turnNo, timeout_ms: RESPONSE_TIMEOUT_MS});
    recoverLiveSession('response_timeout', {resume: true, force: true});
  }

  async function retryWithRealtimeFallback(reason) {
    if (state.setupReady || state.sessionFallbackTried || !state.realtimeFallbackModel || state.realtimeFallbackModel === state.effectiveRealtimeModel) return false;
    state.sessionFallbackTried = true;
    state.connecting = false;
    state.recovery.clearHandle();
    state.ui.setStatus(`Primary realtime model failed (${reason}). Trying fallback…`);
    try {
      await newLiveSession({fallback: true, reason: 'model_fallback'});
    } catch (error) {
      showReconnect(`Fallback connection error: ${error.message}.`);
    }
    return true;
  }

  async function retryFreshAfterResume(socket, reason) {
    if (!socket?.__ekaiwaResumeAttempted) return false;
    state.connecting = false;
    state.recovery.clearHandle();
    emitUiEvent({event: 'reconnect_result', reason: socket.__ekaiwaReason || 'resume', ok: false, resumed: false, error: String(reason).slice(0, 120)});
    try {
      await newLiveSession({reason: 'resume_fallback_fresh'});
    } catch (error) {
      showReconnect(`Connection error: ${error.message}.`);
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

    if (message.sessionResumptionUpdate) {
      const stored = state.recovery.updateResumption(message.sessionResumptionUpdate);
      emitUiEvent({
        event: 'session_resumption_update',
        resumable: message.sessionResumptionUpdate.resumable === true,
        handle_stored: stored
      });
    }

    if (message.goAway) {
      const schedule = state.recovery.scheduleGoAway(message.goAway.timeLeft);
      emitUiEvent({event: 'go_away', time_left_ms: Math.round(schedule.remainingMs), reconnect_delay_ms: Math.round(schedule.delayMs)});
    }

    if (message.error) {
      const detail = message.error.message || JSON.stringify(message.error);
      if (!state.setupReady) {
        state.connecting = false;
        if (await retryFreshAfterResume(socket, detail)) return;
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
      emitUiEvent({
        event: 'ws_setup_complete',
        resumed: Boolean(socket.__ekaiwaResumeAttempted),
        reason: socket.__ekaiwaReason || 'initial'
      });
      if (socket.__ekaiwaReason && socket.__ekaiwaReason !== 'initial') {
        emitUiEvent({event: 'reconnect_result', reason: socket.__ekaiwaReason, ok: true, resumed: Boolean(socket.__ekaiwaResumeAttempted)});
      }
      state.ui.setStatus(
        state.appMode === 'public'
          ? (handsFree() ? state.ui.t('ready') : state.ui.t('holdToTalk'))
          : `Ready · ${modelLabel(state.effectiveRealtimeModel)}`
      );
      if (state.reconnectAfterConnect && !inputBusy()) {
        state.reconnectAfterConnect = false;
        state.recovery.clearHandle();
        newLiveSession({reason: 'settings_change_after_connect'}).catch(error => showReconnect(`Connection error: ${error.message}.`));
        return;
      }
      if (state.resumeHandsFreeAfterReconnect && handsFree()) {
        state.resumeHandsFreeAfterReconnect = false;
        startHandsFreeConversation().catch(error => showReconnect(`Microphone error: ${error.message}.`));
      }
      return;
    }

    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) state.playback.interruptLive();

    const turn = state.activeTurn;
    if (!turn) return;
    state.recovery.touchResponse(turn.no);
    if (content.inputTranscription?.languageCode) recordLanguageCode(turn, content.inputTranscription.languageCode, 'input');
    if (content.inputTranscription?.text) {
      turn.userText = concatTranscript(turn.userText, content.inputTranscription.text, turn.targetLanguage);
      updateStreamingTurn(turn);
    }
    if (content.outputTranscription?.languageCode) recordLanguageCode(turn, content.outputTranscription.languageCode, 'output');
    if (content.outputTranscription?.text) {
      turn.aiText = concatTranscript(turn.aiText, content.outputTranscription.text, turn.targetLanguage);
      updateStreamingTurn(turn);
    }

    for (const part of (content.modelTurn?.parts || [])) {
      if (!part.inlineData?.data) continue;
      if (turn.firstAudioMs == null) turn.firstAudioMs = performance.now() - turn.startedAtMs;
      state.playback.queueLivePcm(part.inlineData.data, aiPlaybackRate());
    }
    if (content.turnComplete) finishTurn(turn);
  }

  function liveVadConfig() {
    if (!handsFree()) return {disabled: true};
    return {
      disabled: false,
      silenceDurationMs: state.sessionSilenceDurationMs
    };
  }

  async function newLiveSession({fallback = false, resume = false, reason = 'initial'} = {}) {
    if (state.connecting) return;
    if (!state.browserOnline) throw new Error('Browser is offline');
    state.connecting = true;
    state.reconnectNeeded = false;
    state.reconnectPending = false;
    state.setupReady = false;
    state.recovery.clearTimers();
    if (!resume) state.recovery.clearHandle();
    if (!fallback) state.sessionFallbackTried = false;
    state.ui.setSetupReady(false);
    state.ui.setTalkState('connecting');
    setStatus('connecting', fallback ? 'Connecting fallback realtime model…' : 'Creating secure live session…');
    state.playback.clear();
    resetInputState();
    cleanupMic();

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

    const resumptionConfig = state.recovery.setupConfig({resume});
    const resumeAttempted = Boolean(resumptionConfig.handle);
    const socket = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(data.token)}`);
    socket.__ekaiwaResumeAttempted = resumeAttempted;
    socket.__ekaiwaReason = reason;
    state.ws = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      if (state.ws !== socket) return;
      emitUiEvent({event: 'ws_open', reason, resume_attempted: resumeAttempted});
      state.supportLanguage = selectedSupportLanguage(elements.feedbackLanguage.value);
      state.selectedTargetLanguage = normalizeTargetLanguage(elements.targetLanguage.value);
      state.targetLanguage = state.selectedTargetLanguage;
      state.ui.setStatus(state.appMode === 'public' ? state.ui.t('connecting') : `WebSocket open · configuring ${modelLabel(data.model)}…`);
      socket.send(JSON.stringify({
        setup: {
          model: `models/${data.model}`,
          generationConfig: {responseModalities: ['AUDIO']},
          systemInstruction: {parts: [{text: buildLiveLanguageInstruction(state.supportLanguage, state.targetLanguage)}]},
          realtimeInputConfig: {
            automaticActivityDetection: liveVadConfig()
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          sessionResumption: resumptionConfig
        }
      }));
    };
    socket.onmessage = event => onLiveMessage(event, socket);
    socket.onerror = () => {
      if (state.ws !== socket) return;
      emitUiEvent({event: 'ws_error', reason, setup_ready: state.setupReady});
      if (state.setupReady) state.ui.setStatus('Gemini Live WebSocket error.', {error: true});
    };
    socket.onclose = async event => {
      if (state.ws !== socket) return;
      state.ws = null;
      state.connecting = false;
      state.setupReady = false;
      const detail = event.reason ? `: ${event.reason}` : '';
      emitUiEvent({event: 'ws_close', code: event.code, reason: String(event.reason || '').slice(0, 120), was_ready: Boolean(state.ui)});
      if (!state.browserOnline) return;
      if (await retryFreshAfterResume(socket, `WebSocket closed ${event.code}${detail}`)) return;
      if (!socket.__ekaiwaResumeAttempted && !state.reconnectNeeded && !state.sessionFallbackTried && !state.recovery.hasHandle() && await retryWithRealtimeFallback(`WebSocket closed ${event.code}${detail}`)) return;
      recoverLiveSession(`ws_close_${event.code}`, {resume: true, force: true});
    };
  }

  async function startHandsFreeConversation() {
    if (!handsFree() || !state.setupReady || state.conversationActive) return;
    if (!await ensureMicReady()) return;
    elements.metric.textContent = '';
    state.conversationActive = true;
    createTurn();
    state.inputForwarding = true;
    state.ui.setTalkState('recording');
    setStatus('listening', 'Listening… speak naturally.');
  }

  function sessionSettingsChanged() {
    return selectedSupportLanguage(elements.feedbackLanguage.value) !== state.supportLanguage || state.selectedTargetLanguage !== state.targetLanguage || (
      state.appMode === 'dev' && (
        elements.realtimeModel.value !== state.sessionRequestedModel ||
        Number(elements.silenceDuration.value) !== state.sessionSilenceDurationMs
      )
    );
  }

  function stopHandsFreeConversation() {
    if (!state.conversationActive) return;
    state.resumeHandsFreeAfterReconnect = false;
    state.conversationActive = false;
    state.inputForwarding = false;
    state.activeTurn = null;
    state.recovery.clearTimers();
    state.playback.clear();
    cleanupMic();
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({realtimeInput: {audioStreamEnd: true}}));
    }
    if (sessionSettingsChanged()) {
      state.ui.setTalkState('connecting');
      state.recovery.clearHandle();
      newLiveSession({reason: 'settings_change'}).catch(error => showReconnect(`Connection error: ${error.message}.`));
    } else {
      state.ui.setTalkState('ready');
      setStatus('stopped', 'Conversation stopped.');
    }
  }

  async function beginPushToTalk() {
    if (handsFree() || state.appMode !== 'public' || state.pushToTalkPressed) return false;
    if (state.reconnectNeeded || !state.setupReady || state.ws?.readyState !== WebSocket.OPEN) return false;
    if (state.activeTurn || state.playback.livePlaying) return false;

    state.playback.stopManual();
    const holdGeneration = ++state.pushHoldGeneration;
    state.pushToTalkPressed = true;
    state.ui.setTalkState('pressed');
    state.ui.setStatus(state.ui.t('releaseToSend'));

    try {
      const micReady = await ensureMicReady();
      if (!micReady) return false;
    } catch (error) {
      state.pushToTalkPressed = false;
      state.ui.setTalkState('ready');
      throw error;
    }

    if (
      holdGeneration !== state.pushHoldGeneration ||
      !state.pushToTalkPressed ||
      handsFree() ||
      !state.setupReady ||
      state.ws?.readyState !== WebSocket.OPEN
    ) {
      state.inputForwarding = false;
      if (!state.pushToTalkPressed) cleanupMic({clearSettings: false});
      return false;
    }

    const turn = createTurn();
    if (!turn) {
      state.pushToTalkPressed = false;
      state.ui.setTalkState('ready');
      return false;
    }

    state.ws.send(JSON.stringify({realtimeInput: {activityStart: {}}}));
    state.pushActivityOpen = true;
    state.inputForwarding = true;
    emitUiEvent({event: 'ptt_start', turn: turn.no});
    setStatus('listening', 'Listening…');
    return true;
  }

  function endPushToTalk() {
    if (handsFree() || state.appMode !== 'public' || !state.pushToTalkPressed) return;
    state.pushToTalkPressed = false;
    state.pushHoldGeneration += 1;
    state.inputForwarding = false;

    if (state.pushActivityOpen && state.ws?.readyState === WebSocket.OPEN) {
      const turnNo = state.activeTurn?.no || null;
      state.ws.send(JSON.stringify({realtimeInput: {activityEnd: {}}}));
      state.pushActivityOpen = false;
      cleanupMic({clearSettings: false});
      state.ui.setTalkState('waiting');
      state.ui.setStatus(state.ui.t('waiting'));
      if (turnNo) state.recovery.armResponseWatchdog(turnNo);
      emitUiEvent({event: 'ptt_end', turn: turnNo});
      return;
    }

    if (!state.micReadyPromise) cleanupMic({clearSettings: false});
    emitUiEvent({event: 'ptt_end', turn: state.activeTurn?.no || null, socket_ready: false});
    recoverLiveSession('ptt_end_socket_unavailable', {resume: true, force: true});
  }

  function endInputBeforeModeChange() {
    state.resumeHandsFreeAfterReconnect = false;
    state.inputForwarding = false;
    if (state.ws?.readyState === WebSocket.OPEN) {
      if (handsFree() && state.conversationActive) {
        state.ws.send(JSON.stringify({realtimeInput: {audioStreamEnd: true}}));
      } else if (!handsFree() && state.pushActivityOpen) {
        state.ws.send(JSON.stringify({realtimeInput: {activityEnd: {}}}));
      }
    }
    state.recovery.clearTimers();
    resetInputState();
    state.playback.clear();
    cleanupMic();
  }

  async function handleUiAction(action, detail) {
    if (handsFree() || state.pushToTalkPressed || state.pushActivityOpen || state.activeTurn) {
      state.ui.setStatus(state.ui.t('playbackUnavailable'), {error: true});
      return;
    }
    const turn = state.turns.find(item => item.no === detail.turn);
    if (!turn || !state.playback || state.playback.livePlaying) {
      state.ui.setStatus(state.ui.t('playbackUnavailable'), {error: true});
      return;
    }

    let played = true;
    if (action === 'replay-user' && turn.replayPcm?.length) {
      played = await state.playback.playUserPcm(turn.replayPcm, 16000);
    } else if (action === 'speak-correction') {
      played = await state.playback.speak(turn.coach?.correction || turn.userText, {
        lang: targetSpeechLocale(turn.targetLanguage),
        rate: Math.min(1, aiPlaybackRate())
      });
    } else if (action === 'speak-problem') {
      const problems = turn.coach?.pronunciation?.problems || [];
      const word = problems[detail.problem]?.word;
      if (word) played = await state.playback.speak(word, {lang: targetSpeechLocale(turn.targetLanguage), rate: 0.8});
    }

    if (!played) state.ui.setStatus(state.ui.t('playbackUnavailable'), {error: true});
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

  elements.targetLanguage.addEventListener('change', () => {
    const target = normalizeTargetLanguage(elements.targetLanguage.value);
    elements.targetLanguage.value = target;
    state.selectedTargetLanguage = target;
    if (state.appMode === 'public') state.preferences.setTargetLanguage(target);
    requestSessionReconnect(state.appMode === 'public' ? state.ui.t('language') : 'Target language changed.');
  });

  elements.theme.addEventListener('change', () => {
    if (state.appMode !== 'public') return;
    state.ui.setTheme(state.preferences.setTheme(elements.theme.value));
  });

  elements.talkMode?.addEventListener('change', async () => {
    if (state.appMode !== 'public') return;
    const nextMode = elements.talkMode.checked
      ? CONVERSATION_MODES.HANDS_FREE
      : CONVERSATION_MODES.PUSH_TO_TALK;
    if (nextMode === state.conversationMode) return;

    try {
      const wasConnecting = state.connecting;
      endInputBeforeModeChange();
      state.conversationMode = state.preferences.setConversationMode(nextMode);
      state.ui.setConversationMode(state.conversationMode);
      render();
      if (wasConnecting) {
        state.reconnectAfterConnect = true;
        return;
      }
      state.recovery.clearHandle();
      await newLiveSession({reason: 'conversation_mode_change'});
    } catch (error) {
      showReconnect(`Connection error: ${error.message}.`);
    }
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

  elements.talk.addEventListener('pointerdown', event => {
    if (state.appMode !== 'public' || handsFree() || elements.talk.disabled) return;
    event.preventDefault();
    try { elements.talk.setPointerCapture?.(event.pointerId); } catch {}
    beginPushToTalk().catch(error => showReconnect(`Microphone error: ${error.message}.`));
  });

  elements.talk.addEventListener('pointerup', event => {
    if (state.appMode !== 'public' || handsFree()) return;
    event.preventDefault();
    endPushToTalk();
    try { elements.talk.releasePointerCapture?.(event.pointerId); } catch {}
  });

  elements.talk.addEventListener('pointercancel', event => {
    if (state.appMode !== 'public' || handsFree()) return;
    event.preventDefault();
    endPushToTalk();
  });

  elements.talk.addEventListener('lostpointercapture', () => {
    if (state.appMode === 'public' && !handsFree()) endPushToTalk();
  });

  elements.talk.addEventListener('keydown', event => {
    if (state.appMode !== 'public' || handsFree() || event.repeat || ![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    beginPushToTalk().catch(error => showReconnect(`Microphone error: ${error.message}.`));
  });

  elements.talk.addEventListener('keyup', event => {
    if (state.appMode !== 'public' || handsFree() || ![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    endPushToTalk();
  });

  elements.talk.addEventListener('click', async () => {
    try {
      if (state.appMode === 'public' && !handsFree()) {
        if (state.reconnectNeeded || !state.setupReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
          await newLiveSession({resume: state.recovery.hasHandle(), reason: 'manual_reconnect'});
        }
        return;
      }
      if (state.reconnectNeeded || !state.setupReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
        await newLiveSession({resume: state.recovery.hasHandle(), reason: 'manual_reconnect'});
        return;
      }
      if (state.conversationActive) stopHandsFreeConversation();
      else await startHandsFreeConversation();
    } catch (error) {
      showReconnect(`Connection error: ${error.message}.`);
    }
  });

  function handleBrowserOffline() {
    if (!state.browserOnline) return;
    state.browserOnline = false;
    emitUiEvent({event: 'browser_offline'});
    state.recovery.clearTimers();
    abortActiveTurn('browser_offline');
    state.resumeHandsFreeAfterReconnect = handsFree() && state.conversationActive;
    const socket = state.ws;
    state.ws = null;
    state.connecting = false;
    try { socket?.close(); } catch {}
    showReconnect(state.appMode === 'public' ? 'Network offline. Reconnecting when connection returns…' : 'Browser offline.');
  }

  function handleBrowserOnline() {
    if (state.browserOnline && state.setupReady && state.ws?.readyState === WebSocket.OPEN) return;
    state.browserOnline = true;
    emitUiEvent({event: 'browser_online'});
    recoverLiveSession('browser_online', {resume: true, force: true});
  }

  window.addEventListener('offline', handleBrowserOffline);
  window.addEventListener('online', handleBrowserOnline);

  window.addEventListener('beforeunload', () => {
    state.inputForwarding = false;
    state.recovery.clearTimers();
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
      await newLiveSession({reason: 'initial'});
    } catch (error) {
      if (!state.ui) initializeUi({app_mode: 'dev'});
      showReconnect(`Startup error: ${error.message}.`);
    }
  }

  bootstrap();
})();
