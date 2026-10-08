import {escapeHtml} from './render.js';
import {icon} from './icons.js';
import {installHorizontalSwipe} from './swipe.js';

const STATES = new Set(['idle', 'listening', 'reviewing', 'complete', 'error']);

function text(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function paragraph(value, cssClass = '') {
  const content = text(value);
  return content ? `<p class="${cssClass}">${escapeHtml(content)}</p>` : '';
}

function list(values) {
  if (!Array.isArray(values) || !values.length) return '';
  const content = values.map(value => {
    const item = text(value) || text(value?.text) || text(value?.message);
    return item ? `<li>${escapeHtml(item)}</li>` : '';
  }).join('');
  return content ? `<ul class="silent-feedback-list">${content}</ul>` : '';
}

function section(title, body) {
  return body ? `<section class="silent-report-section"><h4>${escapeHtml(title)}</h4>${body}</section>` : '';
}

function renderPronunciation(pronunciation, t) {
  if (!pronunciation) return '';
  if (typeof pronunciation === 'string') return section(t('silentPronunciation'), paragraph(pronunciation));
  if (typeof pronunciation !== 'object') return '';
  const summary = paragraph(pronunciation.summary, 'silent-report-body');
  const score = pronunciation.overall_score ?? pronunciation.overallScore;
  const numericScore = Number(score);
  const scoreMarkup = score !== undefined && score !== null && Number.isFinite(numericScore)
    ? paragraph(`${t('silentScore')}: ${Math.round(numericScore)}/100`, 'silent-score')
    : '';
  const problems = list((Array.isArray(pronunciation.problems) ? pronunciation.problems : []).map(problem => {
    if (typeof problem === 'string') return problem;
    return [problem?.word, problem?.tip].filter(Boolean).join(' — ');
  }));
  return section(t('silentPronunciation'), scoreMarkup + summary + problems);
}

function renderItem(item, index, t) {
  if (!item || typeof item !== 'object') return '';
  const number = item.no ?? index + 1;
  const status = text(item.status).toLowerCase();
  const message = text(item.error);
  const speech = text(item.text || item.transcript);
  const suggested = text(item.correction) ||
    (['done', 'partial'].includes(status) ? speech : '');
  const unavailable = (message || (status === 'error' || status === 'failed' ? t('silentUnavailable') : ''));
  const details = [
    section(t('silentExplanation'), paragraph(item.explanation)),
    renderPronunciation(item.pronunciation, t),
    paragraph(unavailable, 'silent-report-error')
  ].join('') || paragraph(t('silentNoFeedback'), 'silent-report-body');
  const audioButton = (kind, label, enabled) => `<button class="silent-audio-button" type="button"
    data-silent-audio="${kind}" data-segment="${escapeHtml(String(number))}"
    aria-label="${escapeHtml(label)}"${enabled ? '' : ' disabled'}
    title="${escapeHtml(enabled ? label : t('silentAudioUnavailable'))}">${icon('speaker')}</button>`;
  return `<article class="silent-report-item">
    <h3>${escapeHtml(t('silentSegment'))} ${escapeHtml(String(number))}</h3>
    <div class="silent-compact-row">
      <div class="silent-compact-text"><h4>${escapeHtml(t('silentYourSpeech'))}</h4>
        ${paragraph(speech || t('silentUnavailable'))}</div>
      ${audioButton('original', t('silentPlayOriginal'), Boolean(item.audioAvailable))}
    </div>
    <div class="silent-compact-row silent-compact-row--suggestion">
      <div class="silent-compact-text"><h4>${escapeHtml(t('silentCorrection'))}</h4>
        ${paragraph(suggested || t('silentUnavailable'))}</div>
      ${audioButton('suggestion', t('silentPlaySuggested'), Boolean(suggested))}
    </div>
    <details class="silent-item-details">
      <summary class="silent-details-toggle">${escapeHtml(t('silentShowDetails'))}${icon('down', 'silent-detail-chevron')}</summary>
      <div class="silent-item-details-body">${details}</div>
    </details>
  </article>`;
}

export function renderSilentReport(report, t) {
  if (typeof report === 'string') {
    return `<h3>${escapeHtml(t('silentReportTitle'))}</h3>${paragraph(report, 'silent-report-body')}`;
  }
  if (!report || typeof report !== 'object') return '';
  const totals = report.totals && typeof report.totals === 'object' ? report.totals : null;
  const count = totals?.total ?? totals?.count ?? totals?.segments ?? report.total ?? report.items?.length;
  const failed = totals?.failed ?? totals?.errors ?? report.failed;
  const reviewed = totals?.reviewed ?? totals?.analyzed ?? totals?.completed ??
    (Number.isFinite(Number(count)) && Number.isFinite(Number(failed)) ? Number(count) - Number(failed) : null);
  const metrics = [
    [t('silentTotal'), count],
    [t('silentReviewed'), reviewed],
    [t('silentFailed'), failed],
    [t('silentCorrected'), report.corrected],
    [t('silentScore'), report.score == null ? null : `${report.score}/100`]
  ].filter(([_label, value]) => value !== undefined && value !== null && (typeof value === 'string' ? value.trim() !== '' : Number.isFinite(Number(value))));
  const metricsHtml = metrics.length
    ? `<dl class="silent-report-totals">${metrics.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}</dl>`
    : '';
  const items = Array.isArray(report.items) ? report.items : [];
  const itemsHtml = items.map((item, index) => renderItem(item, index, t)).join('');
  const overview = [
    paragraph(report.summary, 'silent-report-body'),
    section(t('silentReviewNote'), paragraph(report.note, 'silent-report-body')),
    section(t('silentStrengths'), list(report.strengths)),
    section(t('silentImprovements'), list(report.improvements)),
    section(t('silentSuggestions'), list(report.suggestions))
  ].join('');
  const fallback = !overview && !metricsHtml && !itemsHtml
    ? paragraph(text(report.message) || t('silentNoFeedback'), 'silent-report-body')
    : '';
  return `<h3>${escapeHtml(t('silentReportTitle'))}</h3>${metricsHtml}${overview}${itemsHtml}${fallback}`;
}

export class SilentView {
  constructor({elements, translate, onAction}) {
    this.elements = elements;
    this.translate = translate;
    this.onAction = onAction;
    this.experienceMode = 'talk';
    this.state = 'idle';
    this.status = '';
    this.progress = null;
    this.report = null;
    this.stoppedForReview = false;

    elements.modeTalk?.addEventListener('click', () => this.requestMode('talk'));
    elements.modeSilent?.addEventListener('click', () => this.requestMode('silent'));
    elements.silentStart?.addEventListener('click', () => {
      if (this.experienceMode !== 'silent' || !['idle', 'complete', 'error'].includes(this.state)) return;
      this.setState('listening');
      this.onAction('silent-start');
    });
    elements.silentStop?.addEventListener('click', () => {
      if (this.experienceMode !== 'silent' || this.state !== 'listening') return;
      this.setState('reviewing');
      this.onAction('silent-stop');
    });
    elements.silentReport?.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-silent-audio]');
      if (!button || button.disabled || this.state !== 'complete' || this.experienceMode !== 'silent') return;
      const segment = Number(button.dataset.segment);
      if (!Number.isSafeInteger(segment) || segment <= 0) return;
      if (button.dataset.silentAudio === 'original') this.onAction('silent-replay-user', {segment});
      else if (button.dataset.silentAudio === 'suggestion') this.onAction('silent-speak-suggestion', {segment});
    });
    this.disposeSwipes = [
      installHorizontalSwipe(elements.controlDock, direction => this._handleSwipe(direction)),
      installHorizontalSwipe(elements.silentDock, direction => this._handleSwipe(direction)),
      installHorizontalSwipe(elements.experienceSwitch, direction => this._handleSwipe(direction))
    ];
    this.setExperienceMode('talk');
    this.setState('idle');
  }

  _handleSwipe(direction) {
    if (this.experienceMode === 'talk' && direction === 'left') this.requestMode('silent');
    else if (this.experienceMode === 'silent' && direction === 'right') this.requestMode('talk');
  }

  requestMode(mode) {
    const next = mode === 'silent' ? 'silent' : 'talk';
    if (next === this.experienceMode) return;
    if (next === 'talk' && ['listening', 'reviewing'].includes(this.state)) return;
    this.setExperienceMode(next);
    if (next === 'talk') this.setState('idle');
    this.onAction('silent-mode-change', {mode: next});
  }

  setExperienceMode(mode) {
    this.experienceMode = mode === 'silent' ? 'silent' : 'talk';
    const isSilent = this.experienceMode === 'silent';
    if (this.elements.conversationCard) this.elements.conversationCard.hidden = isSilent;
    if (this.elements.controlDock) this.elements.controlDock.hidden = isSilent;
    if (this.elements.silentPanel) this.elements.silentPanel.hidden = !isSilent;
    if (this.elements.silentDock) this.elements.silentDock.hidden = !isSilent;
    this.elements.modeTalk?.setAttribute('aria-pressed', String(!isSilent));
    this.elements.modeSilent?.setAttribute('aria-pressed', String(isSilent));
    if (globalThis.document?.body?.dataset) globalThis.document.body.dataset.experienceMode = this.experienceMode;
  }

  setState(state, {status, progress, report} = {}) {
    this.state = STATES.has(state) ? state : 'idle';
    if (this.state === 'idle' || this.state === 'listening') {
      this.stoppedForReview = false;
      this.report = null;
    }
    if (this.state === 'reviewing') {
      this.stoppedForReview = true;
      this.report = null;
    }
    if (this.state === 'complete' && report !== undefined) this.report = report;
    this.status = typeof status === 'string' ? status : '';
    this.progress = progress === undefined ? null : progress;
    this.refresh();
  }

  setPlaybackStatus(message = '') {
    if (this.state !== 'complete' || !this.elements.silentStatus) return;
    this.elements.silentStatus.textContent = message || this.translate('silentComplete');
  }

  refresh() {
    const t = this.translate;
    const {
      silentStatus, silentProgress, silentProgressLabel, silentReturnHint,
      silentReport, silentStart, silentStop, modeTalk
    } = this.elements;
    const labelKey = {
      idle: 'silentReady',
      listening: 'silentListening',
      reviewing: 'silentReviewing',
      complete: 'silentComplete',
      error: 'silentError'
    }[this.state];
    if (silentStatus) {
      silentStatus.textContent = this.state === 'error' && this.status
        ? this.status
        : this.state === 'listening' && this.progress?.fallback
          ? t('silentFallback')
          : t(labelKey);
    }
    if (silentStart) silentStart.hidden = !['idle', 'complete', 'error'].includes(this.state);
    if (silentStop) silentStop.hidden = this.state !== 'listening';
    const active = this.experienceMode === 'silent' && ['listening', 'reviewing'].includes(this.state);
    if (modeTalk) modeTalk.disabled = active;
    if (silentReturnHint) silentReturnHint.textContent = t(active ? 'silentFinishToSwitch' : 'silentSwipeRight');
    const counts = this.progress && typeof this.progress === 'object'
      ? {total: Number(this.progress.captured), done: Number(this.progress.analyzed)}
      : null;
    if (silentProgress) {
      silentProgress.hidden = this.state !== 'reviewing';
      const value = counts && counts.total > 0 && Number.isFinite(counts.done)
        ? 100 * counts.done / counts.total
        : Number(this.progress);
      if (this.progress !== null && Number.isFinite(value)) {
        silentProgress.value = Math.min(100, Math.max(0, value));
      } else {
        silentProgress.removeAttribute?.('value');
      }
    }
    if (silentProgressLabel) {
      silentProgressLabel.hidden = this.state !== 'reviewing' || !counts || !(counts.total > 0);
      silentProgressLabel.textContent = counts && counts.total > 0
        ? t('silentAnalyzedCount').replace('{done}', String(counts.done)).replace('{total}', String(counts.total))
        : '';
    }
    if (silentReport) {
      const visible = this.state === 'complete' && this.stoppedForReview && this.report != null;
      silentReport.hidden = !visible;
      silentReport.innerHTML = visible ? renderSilentReport(this.report, t) : '';
    }
  }

  destroy() {
    for (const dispose of this.disposeSwipes) dispose();
  }
}
