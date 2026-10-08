import {SilentAudioStore} from './silent_audio_store.js';
import {SilentSegmenter} from './silent_segmenter.js';
import {SilentEventLogger} from './silent_log.js';
import {textLooksLikeTarget, normalizeTargetLanguage} from '../shared/language_policy.js';

const LIVE_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live';
const MAX_WS_BUFFER = 512_000;
const RECONNECT_LIMIT = 2;
const ROTATE_AFTER_MS = 8 * 60 * 1000;
const TRANSCRIPT_WAIT_MS = 5500;

export function pcmBase64(pcm) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
}

async function jsonResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

// Owns a transcription session; never sends a request asking Gemini to speak.
// Audio segments and authoritative transcripts are paired by utterance order.
// In uncertain cases, feedback is marked incomplete instead of inventing scores.
export class SilentCoachEngine {
  constructor({
    fetcher = (...args) => fetch(...args),
    socketFactory = url => new WebSocket(url),
    store = new SilentAudioStore(),
    logger = new SilentEventLogger({fetcher}),
    onChange = () => {},
    targetLanguage = () => 'en',
    feedbackLanguage = () => 'vi',
    pronunciationEnabled = () => true,
    teacher = () => 'Normal',
    now = () => Date.now(),
    delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
    transcriptWaitMs = TRANSCRIPT_WAIT_MS
  } = {}) {
    this.fetcher = fetcher;
    this.socketFactory = socketFactory;
    this.store = store;
    this.logger = logger;
    this.onChange = onChange;
    this.targetLanguage = targetLanguage;
    this.feedbackLanguage = feedbackLanguage;
    this.pronunciationEnabled = pronunciationEnabled;
    this.teacher = teacher;
    this.now = now;
    this.delay = delay;
    this.transcriptWaitMs = transcriptWaitMs;
    this.state = 'idle';
    this.sequence = 0;
    this.generation = 0;
    this.socket = null;
    this.ready = false;
    this.connecting = false;
    this.retryCount = 0;
    this.fallback = false;
    this.sessionId = null;
    this.segments = [];
    this.transcripts = [];
    this.results = [];
    this.writes = new Set();
    this.jobs = new Set();
    this.queued = [];
    this.runningJobs = 0;
    this.connectedAt = 0;
    this.startedAt = 0;
    this.connectionNo = 0;
    this.sentAudioFrames = 0;
    this.droppedAudioFrames = 0;
    this.lastBackpressureLog = 0;
    this.sessionTarget = 'en';
    this.segmenter = new SilentSegmenter(pcm => this.captureSegment(pcm));
  }

  emit(status = '') {
    this.onChange({
      state: this.state,
      status,
      progress: {
        captured: this.sequence,
        analyzed: this.results.length,
        pending: this.jobs.size,
        fallback: this.fallback
      },
      report: this.state === 'complete' ? this.report() : null
    });
  }

  get isRecording() { return this.state === 'listening'; }

  logEvent(event, details = {}) {
    this.logger.log(event, {elapsed_ms: this.startedAt ? this.now() - this.startedAt : 0, ...details});
  }

  async request(url, options = {}, timeoutMs = 90000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await jsonResponse(await this.fetcher(url, {...options, signal: controller.signal}));
    } finally {
      clearTimeout(timer);
    }
  }

  async start() {
    if (this.state === 'listening' || this.state === 'reviewing') return false;
    this.logger.begin();
    this.startedAt = this.now();
    this.logEvent('silent_mode_enter', {reason: 'start_listening'});
    this.logEvent('silent_start', {
      target_language: normalizeTargetLanguage(this.targetLanguage()),
      feedback_language: this.feedbackLanguage(),
      pronunciation_enabled: this.pronunciationEnabled(),
      teacher: this.teacher(), model: TRANSCRIBE_MODEL
    });
    // The previous listening session never persists as conversation history.
    await this.store.clear?.();
    this.generation += 1;
    this.sequence = 0;
    this.retryCount = 0;
    this.connectionNo = 0;
    this.sentAudioFrames = 0;
    this.droppedAudioFrames = 0;
    this.fallback = false;
    this.segments = [];
    this.transcripts = [];
    this.results = [];
    this.writes.clear();
    this.jobs.clear();
    this.queued = [];
    this.runningJobs = 0;
    this.segmenter.reset();
    this.sessionTarget = normalizeTargetLanguage(this.targetLanguage());
    this.state = 'listening';
    this.sessionId = null;
    this.emit();
    const generation = this.generation;
    this.connect(generation).catch(() => this.recover(generation));
    return true;
  }

  async connect(generation) {
    if (generation !== this.generation || this.connecting || !this.isRecording) return;
    this.connecting = true;
    const connection = ++this.connectionNo;
    this.logEvent('silent_connection_attempt', {connection, model: TRANSCRIBE_MODEL, retry: this.retryCount, fallback: this.fallback});
    try {
      const url = this.sessionId
        ? `/api/silent/session?session_id=${encodeURIComponent(this.sessionId)}`
        : '/api/silent/session';
      const data = await this.request(url, {cache: 'no-store'}, 25000);
      if (generation !== this.generation || !this.isRecording) return;
      this.sessionId = data.session_id;
      this.logger.setSession(data.session_id);
      const socket = this.socketFactory(`${LIVE_WS}?access_token=${encodeURIComponent(data.token)}`);
      this.socket = socket;
      this.ready = false;
      socket.onopen = () => {
        if (this.socket !== socket) return;
        this.logEvent('silent_ws_open', {connection, model: TRANSCRIBE_MODEL});
        socket.send(JSON.stringify({setup: {
          model: `models/${TRANSCRIBE_MODEL}`,
          generationConfig: {responseModalities: ['TEXT']},
          inputAudioTranscription: {mode: 'SMART', languageCodes: []}
        }}));
      };
      socket.onmessage = async event => {
        if (this.socket !== socket) return;
        let message;
        try {
          const raw = event.data instanceof Blob ? await event.data.text()
            : event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data)
            : event.data;
          message = JSON.parse(raw);
        }
        catch {
          this.logEvent('silent_ws_message_error', {connection, reason: 'invalid_json'});
          return;
        }
        if (message.setupComplete) {
          this.ready = true;
          this.connectedAt = this.now();
          this.retryCount = 0;
          this.logEvent('silent_setup_complete', {connection, model: TRANSCRIBE_MODEL});
          this.emit();
        }
        if (message.error) {
          this.logEvent('silent_ws_error', {
            connection, code: message.error.code ?? null,
            error: String(message.error.message || 'Gemini Live error').slice(0, 350)
          });
        }
        const content = message.serverContent;
        if (content?.inputTranscription?.text && ['listening', 'reviewing'].includes(this.state)) {
          this.transcripts.push({
            text: String(content.inputTranscription.text).trim(),
            languageCode: content.inputTranscription.languageCode || ''
          });
          this.logEvent('silent_transcript_final', {
            connection, text: String(content.inputTranscription.text).trim().slice(0, 4000),
            language_code: content.inputTranscription.languageCode || ''
          });
          this.matchSegments();
        }
      };
      socket.onclose = event => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.ready = false;
        this.logEvent('silent_ws_close', {
          connection, code: event?.code ?? null, reason: String(event?.reason || '').slice(0, 160),
          recording: this.isRecording
        });
        if (this.isRecording) {
          this.resolveRemaining(true);
          this.recover(generation);
        }
      };
      socket.onerror = () => {
        if (this.socket === socket) this.logEvent('silent_ws_error', {connection, reason: 'socket_error'});
        // onclose owns retry to avoid two simultaneous connections.
      };
    } catch (error) {
      this.logEvent('silent_ws_error', {connection, phase: 'connect', error: String(error.message || error).slice(0, 350)});
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  async recover(generation) {
    if (generation !== this.generation || !this.isRecording || this.connecting || this.fallback) return;
    this.retryCount += 1;
    this.logEvent('silent_connection_attempt', {phase: 'recovery', retry: this.retryCount, reason: 'connection_lost'});
    if (this.retryCount > RECONNECT_LIMIT) {
      this.fallback = true;
      this.logEvent('silent_fallback_enabled', {reason: 'live_retry_limit', retry: this.retryCount, fallback_model: 'gemini-3.5-transcribe'});
      this.emit('Live transcription unavailable; using audio fallback.');
      this.matchSegments();
      return;
    }
    await this.delay(this.retryCount * 300);
    if (generation !== this.generation || !this.isRecording) return;
    this.connect(generation).catch(() => this.recover(generation));
  }

  feedPcm(pcm) {
    if (!this.isRecording) return;
    this.segmenter.feed(pcm);
    const socket = this.socket;
    if (this.ready && socket?.readyState === 1 && socket.bufferedAmount < MAX_WS_BUFFER) {
      this.sentAudioFrames += pcm.length;
      socket.send(JSON.stringify({realtimeInput: {
        audio: {data: pcmBase64(pcm), mimeType: 'audio/pcm;rate=16000'}
      }}));
    } else {
      this.droppedAudioFrames += pcm.length;
      if (this.now() - this.lastBackpressureLog > 2500) {
        this.lastBackpressureLog = this.now();
        this.logEvent('silent_audio_backpressure', {
          reason: this.fallback ? 'fallback_only' : this.ready ? 'socket_buffered' : 'live_not_ready',
          socket_buffered_bytes: socket?.bufferedAmount || 0,
          frames: this.droppedAudioFrames
        });
      }
    }
  }

  captureSegment(pcm) {
    if (!this.isRecording && this.state !== 'reviewing') return;
    const id = ++this.sequence;
    const key = `${this.generation}-${this.now()}-${id}`;
    this.logEvent('silent_segment_captured', {turn: id, frames: pcm.length,
      pcm_bytes: pcm.byteLength, audio_ms: Math.round(pcm.length * 1000 / 16000)});
    const task = this.store.save(key, pcm).then(() => {
      if (this.state !== 'listening' && this.state !== 'reviewing') {
        return this.store.remove(key);
      }
      const segment = {id, key, matched: false, timer: null};
      this.segments.push(segment);
      this.logEvent('silent_segment_stored', {turn: id, pcm_bytes: pcm.byteLength,
        captured: this.sequence});
      this.matchSegments();
      if (this.fallback) this.resolveRemaining(true);
      if (!segment.matched && this.state === 'listening') {
        segment.timer = setTimeout(() => {
          if (segment.matched || this.state !== 'listening') return;
          // Do not mix late Live finals with subsequent fallback segments.
          this.fallback = true;
          this.closeSocket();
          this.transcripts = [];
          this.logEvent('silent_fallback_enabled', {turn: id,
            reason: 'transcript_timeout', fallback_model: 'gemini-3.5-transcribe'});
          this.resolveRemaining(true);
          this.emit('Live transcript stalled; using audio fallback.');
        }, this.transcriptWaitMs);
      }
      if (this.ready && this.connectedAt && this.now() - this.connectedAt >= ROTATE_AFTER_MS) {
        this.logEvent('silent_rotation', {reason: 'session_age', connection: this.connectionNo,
          duration_ms: this.now() - this.connectedAt});
        this.ready = false;
        const socket = this.socket;
        this.socket = null;
        try { socket?.send(JSON.stringify({realtimeInput: {audioStreamEnd: true}})); } catch {}
        try { socket?.close(); } catch {}
        this.resolveRemaining(true);
        this.connect(this.generation).catch(() => this.recover(this.generation));
      }
    }).catch(error => {
      this.logEvent('silent_storage_error', {turn: id,
        error: String(error?.message || error).slice(0, 300), pcm_bytes: pcm.byteLength});
      this.results.push({no: id, text: '', status: 'error', error: 'Audio could not be stored.'});
    }).finally(() => this.writes.delete(task));
    this.writes.add(task);
    this.emit();
  }

  matchSegments() {
    while (this.transcripts.length) {
      const next = this.segments.find(item => !item.matched);
      if (!next) break;
      const transcript = this.transcripts.shift();
      if (!transcript?.text) continue;
      next.matched = true;
      if (next.timer) clearTimeout(next.timer);
      this.logEvent('silent_segment_matched', {turn: next.id,
        language_code: transcript.languageCode, source: 'live', text: transcript.text});
      this.schedule(next, transcript.text, transcript.languageCode);
    }
  }

  queue(task) {
    const promise = new Promise(resolve => {
      this.queued.push(async () => {
        try { await task(); } finally { resolve(); }
      });
      this.pump();
    });
    this.jobs.add(promise);
    promise.finally(() => this.jobs.delete(promise));
    return promise;
  }

  pump() {
    while (this.runningJobs < 2 && this.queued.length) {
      const job = this.queued.shift();
      this.runningJobs += 1;
      Promise.resolve().then(job).catch(() => {}).finally(() => {
        this.runningJobs -= 1;
        this.pump();
      });
    }
  }

  schedule(segment, text = '', languageCode = '') {
    const generation = this.generation;
    this.logEvent('silent_coach_request', {turn: segment.id, phase: 'queued',
      source: text ? 'live' : 'fallback', queue_depth: this.queued.length + 1});
    this.queue(async () => {
      let transcript = text;
      const beganAt = this.now();
      try {
        if (generation !== this.generation) return;
        const pcm = await this.store.load(segment.key);
        if (!pcm?.length) throw new Error('Audio unavailable');
        if (!transcript) {
          this.logEvent('silent_fallback_request', {turn: segment.id,
            model: 'gemini-3.5-transcribe', pcm_bytes: pcm.byteLength});
          const data = await this.request('/api/silent/transcribe', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              session_id: this.sessionId, turn: segment.id,
              pcm_b64: pcmBase64(pcm), sample_rate: 16000,
              target_language: this.sessionTarget
            })
          });
          transcript = String(data.text || '').trim();
        }
        if (!transcript) throw new Error('No transcription returned');
        const target = this.sessionTarget;
        const detectedPrimary = String(languageCode).toLowerCase().split(/[-_]/, 1)[0];
        const targetPrimary = target === 'zh-Hans' ? 'zh' : target;
        if ((detectedPrimary && detectedPrimary !== targetPrimary) ||
            (!languageCode && !textLooksLikeTarget(transcript, target))) {
          if (generation === this.generation) {
            this.logEvent('silent_segment_skipped', {turn: segment.id,
              reason: 'outside_target_language', text: transcript, language_code: languageCode});
            this.results.push({no: segment.id, text: transcript, status: 'skipped', error: 'Outside the selected practice language.'});
          }
          return;
        }
        const coach = await this.request('/api/coach', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            session_id: this.sessionId, turn: segment.id,
            transcript, pcm_b64: pcmBase64(pcm), sample_rate: 16000,
            target_language: this.sessionTarget,
            feedback_language: this.feedbackLanguage(),
            pronunciation_enabled: this.pronunciationEnabled(),
            teacher: this.teacher(),
            silent_private: true
          })
        });
        if ('correction_effective_model' in coach && !coach.correction_effective_model) {
          throw new Error('Correction model did not return a result');
        }
        const missingPronunciation = this.pronunciationEnabled() &&
          'pronunciation_effective_model' in coach && !coach.pronunciation_effective_model;
        this.logEvent('silent_coach_result', {
          turn: segment.id, status: missingPronunciation ? 'partial' : 'done',
          duration_ms: this.now() - beganAt,
          model: coach.correction_effective_model || coach.coach_requested_model || null,
          text: transcript, correction: coach.correction || transcript,
          explanation: coach.explanation || '',
          pronunciation_score: coach.pronunciation?.overall_score ?? null,
          coach_wall_s: coach.coach_wall_s ?? null
        });
        if (generation === this.generation) this.results.push({
          no: segment.id, text: transcript,
          correction: coach.correction || transcript,
          explanation: coach.explanation || '',
          pronunciation: missingPronunciation ? null : coach.pronunciation,
          status: missingPronunciation ? 'partial' : 'done',
          error: missingPronunciation ? 'Pronunciation assessment unavailable.' : ''
        });
      } catch (error) {
        this.logEvent('silent_segment_error', {turn: segment.id, phase: 'analysis',
          duration_ms: this.now() - beganAt,
          error: String(error?.message || error).slice(0, 350), text: transcript});
        if (generation === this.generation) this.results.push({no: segment.id, text: transcript, status: 'error', error: error.message});
      } finally {
        await this.store.remove(segment.key);
        this.emit();
      }
    });
  }

  resolveRemaining(force = false) {
    if (!force && !this.fallback) return;
    for (const segment of this.segments) {
      if (segment.matched) continue;
      segment.matched = true;
      if (segment.timer) clearTimeout(segment.timer);
      this.logEvent('silent_segment_matched', {turn: segment.id, source: 'fallback',
        reason: 'missing_live_transcript'});
      this.schedule(segment);
    }
  }

  report() {
    const items = [...this.results].sort((a, b) => a.no - b.no);
    const scored = items.filter(item => item.status === 'done' || item.status === 'partial');
    const normalize = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const changed = scored.filter(item => normalize(item.correction) !== normalize(item.text) ||
      (item.pronunciation?.problems?.length || 0) > 0);
    const scores = scored.map(item => item.pronunciation?.overall_score).filter(value => Number.isFinite(value));
    const score = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
    const failed = items.filter(item => item.status === 'error' || item.status === 'partial');
    const skipped = items.filter(item => item.status === 'skipped');
    const language = this.feedbackLanguage();
    const summary = language === 'vi'
      ? `Đã đánh giá ${scored.length} lượt nói; ${changed.length} lượt cần chú ý.${skipped.length ? ` Bỏ qua ${skipped.length} lượt ngoài ngôn ngữ học.` : ''}${score == null ? '' : ` Điểm phát âm trung bình: ${score}/100.`}`
      : language === 'ja'
        ? `${scored.length}件を評価し、${changed.length}件に改善点があります。${skipped.length ? ` 対象外の言語を${skipped.length}件スキップしました。` : ''}${score == null ? '' : ` 発音の平均スコア: ${score}/100。`}`
        : `${scored.length} utterances reviewed; ${changed.length} need attention.${skipped.length ? ` ${skipped.length} outside the practice language.` : ''}${score == null ? '' : ` Average pronunciation score: ${score}/100.`}`;
    const note = language === 'vi'
      ? 'SMART có thể tự làm sạch lời nói; nhận xét phát âm được đánh giá từ âm thanh thu được.'
      : language === 'ja'
        ? 'SMARTは言いよどみを自動修正する場合があります。発音は録音音声に基づいて評価します。'
        : 'SMART transcription may clean disfluencies; pronunciation feedback is based on captured audio.';
    return {
      items: [...new Map([...changed, ...failed].map(item => [item.no, item])).values()].sort((a, b) => a.no - b.no),
      total: items.length, corrected: changed.length, failed: failed.length,
      score,
      totals: {total: items.length, reviewed: scored.length, failed: failed.length},
      summary, note
    };
  }

  async stop() {
    if (!this.isRecording) return null;
    this.logEvent('silent_stop', {captured: this.sequence, analyzed: this.results.length,
      pending: this.jobs.size, fallback: this.fallback, frames: this.sentAudioFrames,
      pcm_bytes: this.sentAudioFrames * 2, duration_ms: this.now() - this.startedAt});
    this.state = 'reviewing';
    this.emit();
    this.segmenter.flush();
    const socket = this.socket;
    if (this.ready && socket?.readyState === 1) {
      try { socket.send(JSON.stringify({realtimeInput: {audioStreamEnd: true}})); } catch {}
    }
    await Promise.all([...this.writes]);
    await this.delay(900); // Let Gemini emit the final transcript after audioStreamEnd.
    this.matchSegments();
    this.resolveRemaining(true);
    await Promise.all([...this.jobs]);
    // Any text without aligned local audio is recorded without a fabricated score.
    while (this.transcripts.length) {
      const text = this.transcripts.shift().text;
      this.logEvent('silent_transcript_unmatched', {text, reason: 'missing_audio'});
      this.results.push({no: ++this.sequence, text, status: 'error', error: 'Audio alignment unavailable'});
    }
    this.closeSocket();
    this.state = 'complete';
    const report = this.report();
    this.logEvent('silent_review_complete', {
      captured: this.sequence, analyzed: report.totals.reviewed,
      failed: report.failed, corrected: report.corrected, score: report.score,
      duration_ms: this.now() - this.startedAt,
      detail: {sent_audio_frames: this.sentAudioFrames, dropped_audio_frames: this.droppedAudioFrames}
    });
    this.emit();
    return report;
  }

  closeSocket() {
    this.ready = false;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(); } catch {}
  }

  cancel(reason = 'user_left_silent_mode') {
    if (this.state === 'reviewing') return false;
    if (this.state === 'listening') {
      this.logEvent('silent_cancel', {phase: this.state, captured: this.sequence, reason});
    }
    this.generation += 1;
    this.state = 'idle';
    this.closeSocket();
    for (const segment of this.segments) {
      if (segment.timer) clearTimeout(segment.timer);
      this.store.remove(segment.key).catch(() => {});
    }
    this.segmenter.reset();
    this.emit();
    return true;
  }

  fail(error) {
    this.logEvent('silent_fatal', {phase: this.state,
      error: String(error?.message || error || 'Review failed.').slice(0, 350)});
    this.generation += 1;
    this.closeSocket();
    for (const segment of this.segments) if (segment.timer) clearTimeout(segment.timer);
    this.state = 'error';
    this.emit(String(error?.message || error || 'Review failed.'));
  }
}
