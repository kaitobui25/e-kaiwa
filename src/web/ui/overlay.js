import {
  coachOverviewHtml,
  correctionOverlayHtml,
  replayOverlayHtml,
  wordOverlayHtml
} from './render.js';
import {hasPlayableReplay} from '../shared/replay_policy.js';

const DYNAMIC_OVERLAYS = new Set(['coach', 'correction', 'word', 'replay']);
const FOCUSABLE = 'button, select, input, textarea, a[href], [tabindex]';

function canFocus(node) {
  return node && node.isConnected !== false && !node.disabled && node.tabIndex >= 0
    && !node.closest('[hidden], [inert]') && node.getClientRects().length > 0
    && getComputedStyle(node).visibility !== 'hidden';
}

function actionKey(node) {
  if (!node?.dataset) return null;
  const {uiAction, audioAction, turn, problem} = node.dataset;
  return uiAction || audioAction ? JSON.stringify([uiAction, audioAction, turn, problem]) : null;
}

export class OverlayState {
  constructor() {
    this.type = null;
    this.turnNo = null;
    this.problemIndex = 0;
  }

  open(type, {turnNo = null, problemIndex = 0} = {}) {
    this.type = type;
    this.turnNo = turnNo;
    this.problemIndex = problemIndex;
    return this.snapshot();
  }

  close() {
    this.type = null;
    this.turnNo = null;
    this.problemIndex = 0;
    return this.snapshot();
  }

  snapshot() {
    return {type: this.type, turnNo: this.turnNo, problemIndex: this.problemIndex};
  }
}

export class UiOverlayController {
  constructor({
    mode = 'dev',
    root,
    backdrop,
    surface,
    dynamic,
    settingsPanel,
    settingsOpen,
    settingsClose,
    translate = key => key,
    audioActionsAllowed = () => true,
    onAudioAction = () => {}
  }) {
    this.mode = mode;
    this.root = root;
    this.backdrop = backdrop;
    this.surface = surface;
    this.dynamic = dynamic;
    this.settingsPanel = settingsPanel;
    this.settingsOpen = settingsOpen;
    this.settingsClose = settingsClose;
    this.translate = translate;
    this.audioActionsAllowed = audioActionsAllowed;
    this.onAudioAction = onAudioAction;
    this.state = new OverlayState();
    this.turn = null;
    this.coachMetricsExpanded = false;
    this.previousFocus = null;
    this.previousFocusKey = null;
    this.renderedMarkup = null;
    this._bind();
  }

  setMode(mode) {
    this.mode = mode === 'public' ? 'public' : 'dev';
    if (this.mode === 'public') this.settingsPanel?.setAttribute('aria-modal', 'true');
    else this.settingsPanel?.removeAttribute('aria-modal');
    if (this.mode !== 'public') this.close();
  }

  _bind() {
    this.settingsOpen?.addEventListener('click', () => this.openSettings());
    this.settingsClose?.addEventListener('click', () => this.close());
    this.backdrop?.addEventListener('click', () => this.close());

    this.dynamic?.addEventListener('click', event => {
      const uiTrigger = event.target.closest?.('[data-ui-action]');
      if (uiTrigger) {
        this._handleUiAction(uiTrigger);
        return;
      }
      const audioTrigger = event.target.closest?.('[data-audio-action]');
      if (!audioTrigger) return;
      this.onAudioAction(audioTrigger.dataset.audioAction, {
        turn: Number(audioTrigger.dataset.turn || this.state.turnNo || 0),
        problem: Number(audioTrigger.dataset.problem || this.state.problemIndex || 0)
      });
    });

    document.addEventListener('keydown', event => {
      if (!this.state.type) return;
      if (event.key === 'Escape') {
        event.preventDefault?.();
        this.close();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = this.state.type === 'settings' ? this.settingsPanel : this.surface;
      const focusable = [...(container?.querySelectorAll(FOCUSABLE) || [])].filter(canFocus);
      if (!focusable.length) {
        event.preventDefault();
        container?.focus({preventScroll: true});
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!focusable.includes(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  _handleUiAction(trigger) {
    const action = trigger.dataset.uiAction;
    if (action === 'close-overlay') {
      this.close();
      return;
    }
    if (!this.turn) return;
    if (action === 'back-coach') {
      this.openCoach(this.turn, {resetMetrics: false});
    } else if (action === 'toggle-coach-metrics') {
      this._toggleCoachMetrics(trigger);
    } else if (action === 'open-correction') {
      this.openCorrection(this.turn);
    } else if (action === 'open-word') {
      this.openWord(this.turn, Number(trigger.dataset.problem || 0));
    }
  }

  _toggleCoachMetrics(trigger) {
    this.coachMetricsExpanded = !this.coachMetricsExpanded;
    trigger?.setAttribute?.('aria-expanded', String(this.coachMetricsExpanded));
    const details = this.dynamic?.querySelector?.('#coach-pronunciation-details');
    if (details) details.hidden = !this.coachMetricsExpanded;
  }

  _show(type) {
    if (this.mode !== 'public' || !this.root) return false;
    if (!this.state.type) {
      this.previousFocus = document.activeElement;
      this.previousFocusKey = actionKey(document.activeElement);
    }
    this.root.hidden = false;
    this.root.dataset.overlay = type;
    this.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overlay-open');
    return true;
  }

  _showDynamic(type, turn, problemIndex = 0) {
    if (!this._show(type)) return;
    this.turn = turn;
    this.state.open(type, {turnNo: turn?.no ?? null, problemIndex});
    if (this.settingsPanel) this.settingsPanel.hidden = true;
    if (this.surface) this.surface.hidden = false;
    this.renderActive({initialFocus: true});
  }

  openSettings() {
    if (!this._show('settings')) return;
    this.turn = null;
    this.state.open('settings');
    if (this.surface) this.surface.hidden = true;
    if (this.settingsPanel) this.settingsPanel.hidden = false;
    this.settingsOpen?.setAttribute?.('aria-expanded', 'true');
    this.settingsPanel?.setAttribute('aria-modal', 'true');
    this.settingsClose?.focus({preventScroll: true});
  }

  openCoach(turn, {resetMetrics = true} = {}) {
    if (!turn?.coach) return;
    if (resetMetrics) this.coachMetricsExpanded = false;
    this._showDynamic('coach', turn);
  }

  openCorrection(turn) {
    if (!turn?.coach) return;
    this._showDynamic('correction', turn);
  }

  openWord(turn, problemIndex = 0) {
    if (!turn?.coach?.pronunciation?.problems?.[problemIndex]) return;
    this._showDynamic('word', turn, problemIndex);
  }

  openReplay(turn) {
    if (!hasPlayableReplay(turn) || !this.audioActionsAllowed()) return;
    this._showDynamic('replay', turn);
  }

  renderActive({initialFocus = false} = {}) {
    if (!this.dynamic || !DYNAMIC_OVERLAYS.has(this.state.type) || !this.turn) return;
    const t = key => this.translate(key);
    const allowAudio = this.audioActionsAllowed();
    let markup;
    if (this.state.type === 'coach') markup = coachOverviewHtml(this.turn, t, {
      metricsExpanded: this.coachMetricsExpanded,
      allowAudioActions: allowAudio
    });
    else if (this.state.type === 'correction') markup = correctionOverlayHtml(this.turn, t, allowAudio);
    else if (this.state.type === 'word') markup = wordOverlayHtml(this.turn, this.state.problemIndex, t, allowAudio);
    else if (this.state.type === 'replay') markup = replayOverlayHtml(this.turn, t);
    const focusedInside = this.dynamic.contains(document.activeElement);
    const key = focusedInside ? actionKey(document.activeElement) : null;
    if (markup !== this.renderedMarkup) {
      const scrollTop = this.dynamic.querySelector('.overlay-scroll')?.scrollTop || 0;
      this.dynamic.innerHTML = markup;
      this.renderedMarkup = markup;
      if (this.state.type === 'coach') this._animateScoreNumber();
      const scroll = this.dynamic.querySelector('.overlay-scroll');
      if (scroll && !initialFocus) scroll.scrollTop = scrollTop;
      if (focusedInside && !initialFocus) {
        const replacement = [...this.dynamic.querySelectorAll(FOCUSABLE)]
          .find(node => key && actionKey(node) === key && canFocus(node));
        (replacement || this.dynamic.querySelector('.overlay-icon'))?.focus({preventScroll: true});
      }
    }
    if (initialFocus) this.dynamic.querySelector('.overlay-icon')?.focus({preventScroll: true});
  }

  _animateScoreNumber() {
    const el = this.dynamic?.querySelector('#score-number');
    if (!el) return;
    const target = Number(el.dataset.target || 0);
    const reduceMotion = globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
    if (reduceMotion || !target || typeof globalThis.requestAnimationFrame !== 'function') {
      el.firstChild.textContent = String(target);
      return;
    }
    const duration = 900;
    const start = performance.now();
    const step = now => {
      const p = Math.min(1, (now - start) / duration);
      el.firstChild.textContent = String(Math.round(target * p));
      if (p < 1) globalThis.requestAnimationFrame(step);
    };
    globalThis.requestAnimationFrame(step);
  }

  refresh(turns) {
    if (!DYNAMIC_OVERLAYS.has(this.state.type) || this.state.turnNo == null) return;
    const updated = turns.find(turn => turn.no === this.state.turnNo);
    if (!updated) {
      this.close();
      return;
    }
    this.turn = updated;
    this.renderActive();
  }

  setReplayProgress(turnNo, progress = 0, playing = false) {
    if (this.state.type !== 'coach' || Number(this.state.turnNo) !== Number(turnNo)) return;
    const normalized = Math.max(0, Math.min(100, Number(progress) || 0));
    const turn = Number(turnNo);
    const ring = this.dynamic?.querySelector?.(`[data-replay-progress-ring][data-turn="${turn}"]`);
    if (ring?.style) ring.style.strokeDashoffset = String(100 - normalized);
    const button = this.dynamic?.querySelector?.(`[data-audio-action="replay-user"][data-turn="${turn}"]`);
    if (button) {
      button.dataset.playing = playing ? 'true' : 'false';
      button.setAttribute?.('aria-pressed', String(Boolean(playing)));
    }
  }

  close() {
    if (!this.state.type && this.mode === 'public') return;
    this.state.close();
    this.turn = null;
    this.coachMetricsExpanded = false;
    if (this.root) {
      this.root.hidden = true;
      this.root.dataset.overlay = '';
      this.root.setAttribute('aria-hidden', 'true');
    }
    if (this.surface) this.surface.hidden = false;
    if (this.dynamic) this.dynamic.replaceChildren();
    this.renderedMarkup = null;
    if (this.settingsPanel && this.mode === 'public') this.settingsPanel.hidden = true;
    this.settingsOpen?.setAttribute?.('aria-expanded', 'false');
    document.body.classList.remove('overlay-open');
    const restore = this.previousFocus;
    this.previousFocus = null;
    const replacement = this.previousFocusKey
      ? [...document.querySelectorAll('[data-ui-action]')].find(node => actionKey(node) === this.previousFocusKey && canFocus(node))
      : null;
    const target = canFocus(restore) ? restore : (replacement || this.settingsOpen);
    this.previousFocusKey = null;
    if (canFocus(target)) target.focus({preventScroll: true});
  }
}
