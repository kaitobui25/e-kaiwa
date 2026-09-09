function b64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pcm16ToFloat32(pcm) {
  const floats = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index += 1) floats[index] = pcm[index] / 32768;
  return floats;
}

function decodePcm16Base64(base64) {
  const bytes = b64ToBytes(base64);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const pcm = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < sampleCount; index += 1) pcm[index] = view.getInt16(index * 2, true);
  return pcm;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));
}

export class BrowserSpeechService {
  constructor(speechSynthesisObject = globalThis.speechSynthesis) {
    this.engine = speechSynthesisObject || null;
    this.pendingResolve = null;
  }

  get supported() {
    return Boolean(this.engine && globalThis.SpeechSynthesisUtterance);
  }

  cancel() {
    try { this.engine?.cancel?.(); } catch {}
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve(false);
    }
  }

  speak(text, {lang = 'en-US', rate = 0.9} = {}) {
    const value = String(text || '').trim();
    if (!value || !this.supported) return Promise.resolve(false);

    this.cancel();
    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        if (this.pendingResolve === finish) this.pendingResolve = null;
        resolve(result);
      };
      this.pendingResolve = finish;

      const utterance = new SpeechSynthesisUtterance(value);
      utterance.lang = lang;
      utterance.rate = Math.max(0.5, Math.min(1.5, Number(rate) || 0.9));
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      try {
        this.engine.speak(utterance);
      } catch {
        finish(false);
      }
    });
  }
}

export class PlaybackCoordinator {
  constructor({
    audioContextFactory = null,
    speechService = new BrowserSpeechService(),
    getEchoGuardMs = () => 0,
    onBlockedChange = () => {}
  } = {}) {
    this.audioContextFactory = audioContextFactory || (() => new (window.AudioContext || window.webkitAudioContext)());
    this.speechService = speechService;
    this.getEchoGuardMs = getEchoGuardMs;
    this.onBlockedChange = onBlockedChange;

    this.context = null;
    this.playAt = 0;
    this.liveSources = new Set();
    this.manualSource = null;
    this.resumeTimer = null;
    this.blockReason = null;
    this.manualPlaying = false;
    this.manualGeneration = 0;
  }

  async ensureContext() {
    if (!this.context) this.context = this.audioContextFactory();
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  get blocked() {
    return this.blockReason !== null;
  }

  _block(reason) {
    const nextReason = String(reason || 'playback');
    if (this.blockReason === nextReason) return;
    this.blockReason = nextReason;
    this.onBlockedChange(true, nextReason);
  }

  _unblock(reason) {
    if (this.blockReason !== reason) return;
    this.blockReason = null;
    this.onBlockedChange(false, reason);
  }

  _forceUnblock(reason = 'clear') {
    if (this.blockReason === null) return;
    this.blockReason = null;
    this.onBlockedChange(false, reason);
  }

  _disconnect(source) {
    try { source?.disconnect?.(); } catch {}
  }

  _guardMs() {
    const value = Number(this.getEchoGuardMs());
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  get livePlaybackRemainingMs() {
    if (!this.context) return 0;
    return Math.max(0, (this.playAt - this.context.currentTime) * 1000);
  }

  get livePlaying() {
    return this.livePlaybackRemainingMs > 5 || this.liveSources.size > 0 || this.resumeTimer !== null;
  }

  get busy() {
    return this.livePlaying || this.manualPlaying;
  }

  queueLivePcm(base64, playbackRate = 1) {
    if (!this.context) return false;
    const pcm = decodePcm16Base64(base64);
    if (!pcm.length) return false;

    // Live output owns the speaker whenever it arrives. Invalidate any older
    // manual playback before switching the block reason so stale cleanup can
    // never reopen input while the AI is speaking.
    this._block('live');
    this.stopManual({releaseBlock: false});

    const rate = Math.max(0.5, Math.min(1.5, Number(playbackRate) || 1));
    const floats = pcm16ToFloat32(pcm);
    const buffer = this.context.createBuffer(1, floats.length, 24000);
    buffer.copyToChannel(floats, 0);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(this.context.destination);
    this.liveSources.add(source);

    source.onended = () => {
      this.liveSources.delete(source);
      this._disconnect(source);
    };

    const now = this.context.currentTime;
    if (this.playAt < now + 0.025) this.playAt = now + 0.025;
    source.start(this.playAt);
    this.playAt += buffer.duration / rate;
    return true;
  }

  clearLive() {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    for (const source of this.liveSources) {
      try { source.stop(); } catch {}
      this._disconnect(source);
    }
    this.liveSources.clear();
    this.playAt = this.context ? this.context.currentTime : 0;
  }

  interruptLive() {
    this.clearLive();
    this._unblock('live');
  }

  armAfterLive(callback) {
    clearTimeout(this.resumeTimer);
    const delay = this.livePlaybackRemainingMs + this._guardMs();

    const finish = () => {
      if (this.manualPlaying) {
        this.resumeTimer = setTimeout(finish, 50);
        return;
      }
      this.resumeTimer = null;
      try {
        callback?.();
      } finally {
        this._unblock('live');
      }
    };

    this.resumeTimer = setTimeout(finish, delay);
    return delay;
  }

  async _playPcm(pcm, sampleRate) {
    const context = await this.ensureContext();
    const samples = pcm instanceof Int16Array ? pcm : new Int16Array(pcm || 0);
    if (!samples.length) return false;

    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(pcm16ToFloat32(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.manualSource = source;

    return new Promise(resolve => {
      source.onended = () => {
        if (this.manualSource === source) this.manualSource = null;
        this._disconnect(source);
        resolve(true);
      };
      try {
        source.start();
      } catch {
        this._disconnect(source);
        if (this.manualSource === source) this.manualSource = null;
        resolve(false);
      }
    });
  }

  async _runManual(action) {
    if (this.livePlaying) return false;

    this.stopManual({releaseBlock: false});
    const generation = ++this.manualGeneration;
    this.manualPlaying = true;
    this._block('manual');

    let result = false;
    try {
      result = Boolean(await action());
      if (this.manualGeneration === generation) await wait(this._guardMs());
    } finally {
      // A newer manual playback or Live audio may have invalidated this run.
      // Only the current generation is allowed to release the manual block.
      if (this.manualGeneration === generation) {
        this.manualPlaying = false;
        this._unblock('manual');
      }
    }
    return result;
  }

  playUserPcm(pcm, sampleRate = 16000) {
    return this._runManual(() => this._playPcm(pcm, sampleRate));
  }

  speak(text, options = {}) {
    return this._runManual(() => this.speechService.speak(text, options));
  }

  stopManual({releaseBlock = true} = {}) {
    this.manualGeneration += 1;
    this.speechService.cancel();
    if (this.manualSource) {
      try { this.manualSource.stop(); } catch {}
      this._disconnect(this.manualSource);
      this.manualSource = null;
    }
    this.manualPlaying = false;
    if (releaseBlock) this._unblock('manual');
  }

  clear() {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    this.clearLive();
    this.stopManual({releaseBlock: false});
    this._forceUnblock('clear');
  }
}
