export class MaintenanceOverlay {
  constructor({root, appShell, percent, message, detail, ring, closeButton} = {}) {
    this.root = root || null;
    this.appShell = appShell || null;
    this.percent = percent || null;
    this.message = message || null;
    this.detail = detail || null;
    this.ring = ring || null;
    this.closeButton = closeButton || null;
    this.closeAction = null;

    this.closeButton?.addEventListener('click', () => {
      const action = this.closeAction;
      if (typeof action === 'function') action();
    });
  }

  _setCloseAction(action = null) {
    this.closeAction = typeof action === 'function' ? action : null;
    if (this.closeButton) this.closeButton.hidden = !this.closeAction;
  }

  _open({blocking = true} = {}) {
    if (!this.root) return;
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    this.root.dataset.blocking = blocking ? 'true' : 'false';
    document.body.classList.add('maintenance-open');
    if (this.appShell && blocking) this.appShell.inert = true;
  }

  showProgress(status = {}) {
    this._setCloseAction(null);
    this._open({blocking: true});
    const value = Math.max(0, Math.min(100, Number(status.progress) || 0));
    if (this.percent) this.percent.textContent = `${Math.round(value)}%`;
    if (this.message) this.message.textContent = status.message || 'Updating E-KAIWA';
    if (this.detail) this.detail.textContent = 'Please wait…';
    if (this.ring) this.ring.style.setProperty('--maintenance-progress', `${value * 3.6}deg`);
    this.root?.setAttribute('aria-label', `${status.message || 'Updating E-KAIWA'} ${Math.round(value)}%`);
  }

  showResult(status = {}, {blocking = false, onClose = null} = {}) {
    this._setCloseAction(onClose);
    this._open({blocking});
    const failures = Array.isArray(status.failures) ? status.failures.filter(Boolean) : [];
    const version = status.to_version ? `v${status.to_version}` : '';
    const failed = status.state === 'failed' || status.state === 'start_failed';
    const warning = !failed && failures.length > 0;
    const prefix = failed ? '✕' : warning ? '⚠' : '✓';
    if (this.percent) this.percent.textContent = failed ? '!' : '100%';
    if (this.ring) this.ring.style.setProperty('--maintenance-progress', '360deg');
    if (this.message) {
      const label = status.state === 'already_latest' ? 'Already latest' : failed ? 'Update incomplete' : warning ? 'Update completed with warnings' : 'Update complete';
      this.message.textContent = `${prefix} ${label}${version ? ` · ${version}` : ''}`;
    }
    if (this.detail) this.detail.textContent = failures.length ? `Failed: ${failures.slice(0, 2).join(' · ')}` : '';
  }

  hide() {
    if (!this.root) return;
    this._setCloseAction(null);
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.dataset.blocking = 'false';
    document.body.classList.remove('maintenance-open');
    if (this.appShell) this.appShell.inert = false;
  }
}
