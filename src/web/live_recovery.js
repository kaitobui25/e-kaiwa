const defaultSetTimeout = (fn, ms) => globalThis.setTimeout(fn, ms);
const defaultClearTimeout = id => globalThis.clearTimeout(id);

export function durationToMilliseconds(value) {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value * 1000);
  if (typeof value === 'string') {
    const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)s$/i);
    return match ? Math.max(0, Number(match[1]) * 1000) : 0;
  }
  if (typeof value === 'object') {
    const seconds = Number(value.seconds || 0);
    const nanos = Number(value.nanos || 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanos)) {
      return Math.max(0, seconds * 1000 + nanos / 1e6);
    }
  }
  return 0;
}

export class LiveRecoveryCoordinator {
  constructor({
    responseTimeoutMs = 20000,
    reconnectLeadMs = 1200,
    setTimeoutFn = defaultSetTimeout,
    clearTimeoutFn = defaultClearTimeout,
    onResponseTimeout = () => {},
    onReconnectDue = () => {},
  } = {}) {
    this.responseTimeoutMs = responseTimeoutMs;
    this.reconnectLeadMs = reconnectLeadMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.onResponseTimeout = onResponseTimeout;
    this.onReconnectDue = onReconnectDue;
    this.latestHandle = '';
    this.waitingTurnNo = null;
    this.responseTimer = null;
    this.reconnectTimer = null;
  }

  setupConfig({resume = false} = {}) {
    return resume && this.latestHandle ? {handle: this.latestHandle} : {};
  }

  updateResumption(update) {
    if (!update || update.resumable !== true || !update.newHandle) return false;
    this.latestHandle = String(update.newHandle);
    return true;
  }

  clearHandle() {
    this.latestHandle = '';
  }

  hasHandle() {
    return Boolean(this.latestHandle);
  }

  _clearResponseTimer() {
    if (this.responseTimer != null) this.clearTimeoutFn(this.responseTimer);
    this.responseTimer = null;
  }

  armResponseWatchdog(turnNo) {
    this._clearResponseTimer();
    this.waitingTurnNo = Number(turnNo) || null;
    if (!this.waitingTurnNo) return;
    const expectedTurn = this.waitingTurnNo;
    this.responseTimer = this.setTimeoutFn(() => {
      this.responseTimer = null;
      if (this.waitingTurnNo !== expectedTurn) return;
      this.onResponseTimeout(expectedTurn);
    }, this.responseTimeoutMs);
  }

  touchResponse(turnNo) {
    if (this.waitingTurnNo == null || Number(turnNo) !== this.waitingTurnNo) return;
    this.armResponseWatchdog(this.waitingTurnNo);
  }

  finishResponse(turnNo) {
    if (turnNo != null && Number(turnNo) !== this.waitingTurnNo) return;
    this.waitingTurnNo = null;
    this._clearResponseTimer();
  }

  scheduleGoAway(timeLeft) {
    if (this.reconnectTimer != null) this.clearTimeoutFn(this.reconnectTimer);
    const remainingMs = durationToMilliseconds(timeLeft);
    const delayMs = Math.max(0, remainingMs - this.reconnectLeadMs);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.onReconnectDue();
    }, delayMs);
    return {remainingMs, delayMs};
  }

  clearReconnectTimer() {
    if (this.reconnectTimer != null) this.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  clearTimers() {
    this.waitingTurnNo = null;
    this._clearResponseTimer();
    this.clearReconnectTimer();
  }
}
