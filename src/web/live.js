(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // DOM + runtime configuration
  // ---------------------------------------------------------------------------
  const MODEL = 'gemini-3.1-flash-live-preview';
  const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

  const talk = document.getElementById('talk');
  const statusEl = document.getElementById('status');
  const setupDotEl = document.getElementById('setup-dot');
  const setupLabelEl = document.getElementById('setup-label');
  const metricEl = document.getElementById('metric');
  const conversationEl = document.getElementById('conversation');
  const teacherEl = document.getElementById('teacher');
  const feedbackLanguageEl = document.getElementById('feedback-language');
  const silenceDurationEl = document.getElementById('silence-duration');
  const pronEl = document.getElementById('pron');

  const savedSilence = localStorage.getItem('silenceDurationMs');
  if (['700', '1000', '1200', '1500'].includes(savedSilence)) {
    silenceDurationEl.value = savedSilence;
  }

  const state = {
    ws: null,
    sessionId: null,
    setupReady: false,
    reconnectNeeded: false,
    connecting: false,
    recording: false,
    inputForwarding: false,
    inputCtx: null,
    micStream: null,
    micSource: null,
    processor: null,
    playCtx: null,
    playAt: 0,
    armTimer: null,
    turnNo: 1,
    activeTurn: null,
    turns: []
  };

  // ---------------------------------------------------------------------------
  // UI + rendering
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

  function concatTranscript(previous, incoming) {
    const oldText = (previous || '').trim();
    const newText = (incoming || '').trim();
    if (!oldText) return newText;
    if (!newText || oldText.endsWith(newText)) return oldText;
    if (newText.startsWith(oldText)) return newText;
    return oldText + (/[\s,.!?]$/.test(oldText) ? '' : ' ') + newText;
  }

  function pronunciationHtml(result) {
    if (!result) return '<span class="muted">Pronunciation unavailable.</span>';
    const score = value => Math.max(0, Math.min(100, Math.round(Number(value || 0))));
    let html = `<b>Pronunciation ${score(result.pronunciation_score)}</b> · fluency ${score(result.fluency_score)} · intonation ${score(result.intonation_score)}`;

    const problems = Array.isArray(result.problems) ? result.problems.slice(0, 3) : [];
    for (const problem of problems) {
      html += `<br>• <b>${escapeHtml(problem.word || '?')}</b> ${escapeHtml(problem.sound || '')}`;
      const tip = problem.tip || problem.tip_ja || '';
      if (tip) html += ` — ${escapeHtml(tip)}`;
    }

    const summary = result.summary || result.summary_ja || '';
    if (summary) html += `<br>${escapeHtml(summary)}`;
    return html;
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

      let coach = '<span class="muted">Coach running…</span>';
      if (turn.coach) {
        coach = `<b>Correction:</b> ${escapeHtml(turn.coach.correction || turn.userText || '')}`;
        const explanation = turn.coach.explanation || turn.coach.explanation_ja || '';
        if (explanation) coach += `<br>${escapeHtml(explanation)}`;
        if (pronEl.checked) coach += `<br><br>${pronunciationHtml(turn.coach.pronunciation)}`;
        coach += `<br><span class="muted">coach ${Number(turn.coach.coach_wall_s || 0).toFixed(2)}s</span>`;
      }

      return `<div class="turn">
        <div class="who">You</div><div class="text">${escapeHtml(turn.userText || '…')}</div>
        <div class="who">AI ${latency}</div><div class="text">${escapeHtml(turn.aiText || '…')}</div>
        <div class="who">Coach</div><div class="coach">${coach}</div>
      </div>`;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Small data helpers
  // ---------------------------------------------------------------------------
  async function readJsonResponse(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    }
  }

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

  function queueAiPcm(base64) {
    if (!state.playCtx) return;
    const bytes = b64ToBytes(base64);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (!sampleCount) return;

    const floats = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < sampleCount; i++) {
      floats[i] = view.getInt16(i * 2, true) / 32768;
    }

    const buffer = state.playCtx.createBuffer(1, sampleCount, 24000);
    buffer.copyToChannel(floats, 0);
    const source = state.playCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(state.playCtx.destination);

    const now = state.playCtx.currentTime;
    if (state.playAt < now + 0.025) state.playAt = now + 0.025;
    source.start(state.playAt);
    state.playAt += buffer.duration;
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
    if (turn.coachSent || !turn.userText.trim() || !turn.pcmChunks.length) return;
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
        frontend_state: frontendState
      })
    }).catch(() => {});
  }

  function armNextTurnAfterPlayback() {
    clearTimeout(state.armTimer);
    const remainingMs = state.playCtx
      ? Math.max(0, (state.playAt - state.playCtx.currentTime) * 1000 + 100)
      : 100;

    setStatus(remainingMs > 150 ? 'AI speaking…' : 'Listening…');
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

    // Coach is intentionally fire-and-forget relative to the spoken Live response.
    runCoach(turn);
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
      setStatus(`Gemini error: ${message.error.message || JSON.stringify(message.error)}`, 'error');
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
      setStatus('Ready. Tap once, then talk hands-free.');
      return;
    }

    const content = message.serverContent;
    const turn = state.activeTurn;
    if (!content || !turn) return;

    if (content.inputTranscription?.text) {
      turn.userText = concatTranscript(turn.userText, content.inputTranscription.text);
      render();
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

  async function newLiveSession() {
    if (state.connecting) return;
    state.connecting = true;
    state.reconnectNeeded = false;
    state.setupReady = false;
    updateSetupIndicator();

    talk.disabled = true;
    talk.className = 'ready';
    talk.textContent = 'Connecting…';
    setStatus('Creating secure live session…');

    const oldSocket = state.ws;
    state.ws = null;
    if (oldSocket && oldSocket.readyState < WebSocket.CLOSING) {
      try { oldSocket.close(); } catch {}
    }

    const response = await fetch('/api/session', {cache: 'no-store'});
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Could not create live session');

    state.sessionId = data.session_id;
    const url = `${WS_BASE}?access_token=${encodeURIComponent(data.token)}`;
    const socket = new WebSocket(url);
    state.ws = socket;
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      if (state.ws !== socket) return;
      setStatus('WebSocket open. Configuring Gemini Live…');
      socket.send(JSON.stringify({
        setup: {
          model: `models/${MODEL}`,
          generationConfig: {responseModalities: ['AUDIO']},
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              silenceDurationMs: Number(silenceDurationEl.value)
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      }));
    };

    socket.onmessage = event => onLiveMessage(event, socket);
    socket.onerror = () => {
      if (state.ws === socket) setStatus('Gemini Live WebSocket error.', 'error');
    };
    socket.onclose = event => {
      if (state.ws !== socket) return;
      state.ws = null;
      const reason = event.reason ? `: ${event.reason}` : '';
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

  function stopConversation() {
    if (!state.recording) return;
    state.recording = false;
    state.inputForwarding = false;
    state.activeTurn = null;
    cleanupMic();

    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({realtimeInput: {audioStreamEnd: true}}));
    }

    talk.disabled = false;
    talk.className = 'ready';
    talk.textContent = '🎙 Start conversation';
    setStatus('Conversation stopped.');
  }

  // ---------------------------------------------------------------------------
  // Events + bootstrap
  // ---------------------------------------------------------------------------
  silenceDurationEl.addEventListener('change', () => {
    localStorage.setItem('silenceDurationMs', silenceDurationEl.value);
    setStatus(`Silence timeout ${silenceDurationEl.value} ms saved. Reconnect to apply.`);
  });

  pronEl.addEventListener('change', render);

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
    cleanupMic();
    try { state.ws?.close(); } catch {}
  });

  updateSetupIndicator();
  render();
  newLiveSession().catch(error => {
    showReconnect(`Startup error: ${error.message}. Tap Reconnect.`);
  });
})();
