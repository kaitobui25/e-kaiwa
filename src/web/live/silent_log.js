// Best-effort, ordered diagnostics. Network failures never block the mic/Coach.
// Audio buffers, credentials and websocket URLs must never be logged.
export class SilentEventLogger {
  constructor({fetcher = (...args) => fetch(...args), maxPending = 300, retryMs = 2000} = {}) {
    this.fetcher = fetcher;
    this.maxPending = maxPending;
    this.retryMs = retryMs;
    this.sessionId = null;
    this.queue = [];
    this.sequence = 0;
    this.running = false;
    this.retryTimer = null;
    this.dropped = 0;
  }

  begin() {
    // A fresh listening run never reuses the previous run's session ID.
    this.sessionId = null;
    this.sequence = 0;
    this.queue = [];
    this.dropped = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  setSession(sessionId) {
    if (!sessionId || this.sessionId === sessionId) return;
    this.sessionId = sessionId;
    this.pump();
  }

  log(event, details = {}) {
    if (this.queue.length >= this.maxPending) {
      this.queue.shift();
      this.dropped++;
    }
    this.queue.push({event, details, sequence: ++this.sequence});
    this.pump();
  }

  async pump() {
    if (this.running || !this.sessionId || this.retryTimer) return;
    this.running = true;
    const sessionId = this.sessionId;
    try {
      while (this.queue.length && this.sessionId === sessionId) {
        if (this.dropped) {
          this.queue.unshift({
            event: 'silent_storage_error',
            details: {reason: 'log_queue_overflow', processed: this.dropped},
            sequence: ++this.sequence
          });
          this.dropped = 0;
        }
        const payload = this.queue[0];
        try {
          const response = await this.fetcher('/api/silent/log', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({session_id: sessionId, ...payload}),
            keepalive: true
          });
          if (!response.ok) throw new Error('Silent log request failed');
          if (this.sessionId === sessionId && this.queue[0] === payload) this.queue.shift();
        } catch {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.pump();
          }, this.retryMs);
          this.retryTimer.unref?.();
          break;
        }
      }
    } finally {
      this.running = false;
      // begin()/setSession() may have swapped sessions while a request was in flight.
      if (this.queue.length && this.sessionId && this.sessionId !== sessionId && !this.retryTimer) {
        this.pump();
      }
    }
  }
}
