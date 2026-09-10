const ACTIVE_STATES = new Set(['preparing', 'stopping', 'updating', 'dependencies', 'testing', 'checks_complete', 'starting', 'health']);
const TERMINAL_STATES = new Set(['complete', 'already_latest', 'failed', 'start_failed']);

function defaultDelay(status, hidden) {
  if (status && ACTIVE_STATES.has(status.state)) return 750;
  return hidden ? 5000 : 2000;
}

export class LongPressController {
  constructor(button, {durationMs = 5000, onComplete = () => {}, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout} = {}) {
    this.button = button;
    this.durationMs = durationMs;
    this.onComplete = onComplete;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.timer = null;
    this.pointerId = null;
    this._bind();
  }

  _bind() {
    if (!this.button) return;
    this.button.addEventListener('pointerdown', event => {
      if (this.button.disabled) return;
      event.preventDefault();
      this.pointerId = event.pointerId;
      try { this.button.setPointerCapture?.(event.pointerId); } catch {}
      this.start();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.button.addEventListener(type, event => {
        if (event?.pointerId != null && this.pointerId != null && event.pointerId !== this.pointerId) return;
        this.cancel();
      });
    }
    this.button.addEventListener('keydown', event => {
      if (event.repeat || ![' ', 'Enter'].includes(event.key) || this.button.disabled) return;
      event.preventDefault();
      this.start();
    });
    this.button.addEventListener('keyup', event => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      this.cancel();
    });
    this.button.addEventListener('blur', () => this.cancel());
  }

  start() {
    if (this.timer != null || !this.button || this.button.disabled) return;
    this.button.dataset.holding = 'true';
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      this.button.dataset.holding = 'false';
      this.button.disabled = true;
      this.onComplete();
    }, this.durationMs);
  }

  cancel() {
    if (this.timer != null) this.clearTimeoutFn(this.timer);
    this.timer = null;
    this.pointerId = null;
    if (this.button) this.button.dataset.holding = 'false';
  }
}

export class MaintenanceController {
  constructor({
    overlay,
    updateButton = null,
    statusUrl = '/maintenance/status.json',
    triggerUrl = '/api/update',
    pauseForMaintenance = () => {},
    reload = () => window.location.reload(),
    fetchFn = (...args) => fetch(...args),
    documentRef = document,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    this.overlay = overlay;
    this.updateButton = updateButton;
    this.statusUrl = statusUrl;
    this.triggerUrl = triggerUrl;
    this.pauseForMaintenance = pauseForMaintenance;
    this.reload = reload;
    this.fetchFn = fetchFn;
    this.documentRef = documentRef;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.timer = null;
    this.running = false;
    this.initialized = false;
    this.knownUpdateId = '';
    this.activeUpdateId = '';
    this.paused = false;
    this.lastStatus = null;
    this.longPress = null;
    this._onVisibility = () => this.checkNow();
  }

  bindLongPress() {
    if (!this.updateButton || this.longPress) return;
    this.longPress = new LongPressController(this.updateButton, {
      durationMs: 5000,
      onComplete: () => this.triggerUpdate(),
    });
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.bindLongPress();
    this.documentRef?.addEventListener?.('visibilitychange', this._onVisibility);
    await this.checkNow();
  }

  stop() {
    this.running = false;
    if (this.timer != null) this.clearTimeoutFn(this.timer);
    this.timer = null;
    this.longPress?.cancel();
    this.documentRef?.removeEventListener?.('visibilitychange', this._onVisibility);
  }

  _schedule() {
    if (!this.running) return;
    if (this.timer != null) this.clearTimeoutFn(this.timer);
    const hidden = Boolean(this.documentRef?.hidden);
    this.timer = this.setTimeoutFn(() => this.checkNow(), defaultDelay(this.lastStatus, hidden));
  }

  async _readStatus() {
    const response = await this.fetchFn(this.statusUrl, {cache: 'no-store'});
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`maintenance status HTTP ${response.status}`);
    return response.json();
  }

  async checkNow() {
    if (!this.running) return null;
    try {
      const status = await this._readStatus();
      if (status) this._handleStatus(status);
      return status;
    } catch {
      return null;
    } finally {
      this._schedule();
    }
  }

  async triggerUpdate() {
    if (!this.updateButton) return;
    try {
      const response = await this.fetchFn(this.triggerUrl, {method: 'POST'});
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      await this.checkNow();
    } catch (error) {
      this.updateButton.disabled = false;
      this.overlay?.showResult({state: 'failed', progress: 100, message: 'Update request failed', failures: [String(error.message || error)]}, {blocking: false});
      this.setTimeoutFn(() => this.overlay?.hide(), 1800);
    }
  }

  _pauseOnce(updateId) {
    if (this.paused) return;
    this.paused = true;
    this.activeUpdateId = updateId || this.activeUpdateId;
    this.pauseForMaintenance();
  }

  _handleStatus(status) {
    this.lastStatus = status;
    const updateId = String(status.update_id || '');
    const newCycle = this.initialized && Boolean(updateId) && updateId !== this.knownUpdateId;

    if (!this.initialized) {
      this.initialized = true;
      this.knownUpdateId = updateId;
      if (!ACTIVE_STATES.has(status.state)) return;
    } else if (newCycle) {
      this.knownUpdateId = updateId;
    }

    if (ACTIVE_STATES.has(status.state)) {
      this._pauseOnce(updateId);
      this.overlay?.showProgress(status);
      return;
    }

    if (!TERMINAL_STATES.has(status.state)) return;

    const belongsToActiveCycle = Boolean(updateId && updateId === this.activeUpdateId);
    if (!belongsToActiveCycle && !newCycle) return;

    if (status.state === 'complete') {
      this._pauseOnce(updateId);
      this.overlay?.showResult(status, {blocking: true});
      this.setTimeoutFn(() => this.reload(), 1200);
      return;
    }

    if (status.state === 'start_failed') {
      this._pauseOnce(updateId);
      this.overlay?.showResult(status, {blocking: true});
      return;
    }

    this.overlay?.showResult(status, {blocking: false});
    if (this.updateButton) this.updateButton.disabled = false;
    this.setTimeoutFn(() => this.overlay?.hide(), 1800);
  }
}
