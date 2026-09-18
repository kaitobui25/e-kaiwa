export class LiveIdleCoordinator {
  constructor({
    timeoutSeconds = 0,
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
    onTimeout = () => {}
  } = {}) {
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.onTimeout = onTimeout;
    this.timer = null;
    this.timeoutMs = 0;
    this.setTimeoutSeconds(timeoutSeconds);
  }

  setTimeoutSeconds(value) {
    const seconds = Number(value);
    this.timeoutMs = Number.isFinite(seconds) && seconds > 0
      ? Math.round(seconds * 1000)
      : 0;
    this.cancel();
  }

  arm() {
    this.cancel();
    if (!this.timeoutMs || typeof this.setTimeoutFn !== 'function') return false;

    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      this.onTimeout();
    }, this.timeoutMs);
    return true;
  }

  cancel() {
    if (this.timer !== null && typeof this.clearTimeoutFn === 'function') {
      this.clearTimeoutFn(this.timer);
    }
    this.timer = null;
  }

  dispose() {
    this.cancel();
  }

  get armed() {
    return this.timer !== null;
  }
}
