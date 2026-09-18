import {hasPlayableReplay} from './replay_policy.js';
import {icon} from './ui_icons.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function scoreValue(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function severityClass(problem) {
  return problem?.severity === 'red' ? 'severity-red' : 'severity-yellow';
}

function escapedRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function usesAsciiWordBoundary(value) {
  return /^[A-Za-z0-9_'’-]+$/.test(value);
}

export function highlightProblems(text, pronunciation) {
  const raw = String(text || '…');
  const problems = Array.isArray(pronunciation?.problems) ? pronunciation.problems.slice(0, 4) : [];
  if (!problems.length) return escapeHtml(raw);

  const candidates = problems
    .map(problem => ({problem, word: String(problem?.word || '').trim()}))
    .filter(item => item.word)
    .sort((a, b) => b.word.length - a.word.length);
  if (!candidates.length) return escapeHtml(raw);

  const ranges = [];
  for (const candidate of candidates) {
    const escaped = escapedRegex(candidate.word);
    const source = usesAsciiWordBoundary(candidate.word) ? `\\b${escaped}\\b` : escaped;
    const regex = new RegExp(source, 'gi');
    for (const match of raw.matchAll(regex)) {
      const start = match.index ?? -1;
      if (start < 0) continue;
      const end = start + match[0].length;
      if (ranges.some(range => start < range.end && end > range.start)) continue;
      ranges.push({start, end, problem: candidate.problem});
    }
  }

  if (!ranges.length) return escapeHtml(raw);
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  let html = '';
  let cursor = 0;
  for (const range of ranges) {
    html += escapeHtml(raw.slice(cursor, range.start));
    html += `<span class="pron-problem ${severityClass(range.problem)}">${escapeHtml(raw.slice(range.start, range.end))}</span>`;
    cursor = range.end;
  }
  return html + escapeHtml(raw.slice(cursor));
}

export function turnScore(turn) {
  const pronunciation = turn?.coach?.pronunciation;
  if (!pronunciation) return null;
  return scoreValue(pronunciation.overall_score ?? pronunciation.pronunciation_score);
}

export function scoreTier(value) {
  if (value >= 90) return 'gold';
  if (value >= 70) return 'teal';
  return 'muted';
}
function inlineScore(turn, t, pronunciationEnabled) {
  if (!pronunciationEnabled || !turn?.coachEligible) return '';
  const overall = turnScore(turn);
  if (overall == null) return '';
  const tier = scoreTier(overall);
  const circumference = 2 * Math.PI * 15;
  const offset = circumference * (1 - overall / 100);
  return `<button class="score-pill score-button" type="button" data-ui-action="open-coach" data-turn="${turn.no}" data-score-tier="${tier}" aria-label="${escapeHtml(t('score'))} ${overall}">
    <svg class="score-pill-ring" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="15" fill="none" stroke-width="3" class="score-pill-track"/>
      <circle cx="17" cy="17" r="15" fill="none" stroke-width="3" stroke-linecap="round" transform="rotate(-90 17 17)"
        style="stroke-dasharray:${circumference};stroke-dashoffset:${offset}" class="score-pill-arc"/>
    </svg>
    <span class="score-pill-num">${overall}</span>
  </button>`;
}

export function publicTurnHtml(turn, t, pronunciationEnabled, conversationMode) {
  const pronunciation = pronunciationEnabled ? turn.coach?.pronunciation : null;
  const userText = pronunciation
    ? highlightProblems(turn.userText || '…', pronunciation)
    : escapeHtml(turn.userText || '…');
  const userActions = inlineScore(turn, t, pronunciationEnabled);
  const actionRow = userActions ? `<div class="message-actions">${userActions}</div>` : '';

  const userRow = `<div class="message-row user-row">
    <div class="message-stack user-stack">
      <div class="bubble user-bubble">
        <div class="message-text user-message-text" data-turn-text="user">${userText}</div>
        ${actionRow}
      </div>
    </div>
    <div class="avatar user-avatar" aria-hidden="true">${icon('user')}</div>
  </div>`;

  const aiRow = `<div class="message-row ai-row">
    <div class="avatar ai-avatar" aria-hidden="true">${icon('sparkle')}</div>
    <div class="message-stack ai-stack">
      <div class="message-meta">${escapeHtml(t('ai'))}</div>
      <div class="bubble ai-bubble"><div class="message-text" data-turn-text="ai">${escapeHtml(turn.aiText || '…')}</div></div>
    </div>
  </div>`;

  return `<article class="turn public-turn" data-turn="${turn.no}">${userRow}${aiRow}</article>`;
}

export function devTurnHtml(turn, pronunciationEnabled) {
  const pronunciation = pronunciationEnabled ? turn.coach?.pronunciation : null;
  const userText = pronunciation ? highlightProblems(turn.userText || '…', pronunciation) : escapeHtml(turn.userText || '…');
  const overall = turnScore(turn);
  const coach = turn.coach
    ? `<div class="dev-coach"><strong>Coach${overall == null ? '' : ` ${overall}`}:</strong> ${escapeHtml(turn.coach.correction || turn.userText || '')}${turn.coach.explanation ? `<br><span class="muted">${escapeHtml(turn.coach.explanation)}</span>` : ''}</div>`
    : (turn.coachEligible ? '<div class="muted">Coach running…</div>' : '');
  return `<div class="turn dev-turn">
    <div class="who who-you">You</div><div class="text">${userText}</div>
    <div class="who who-ai">AI</div><div class="text">${escapeHtml(turn.aiText || '…')}</div>
    ${coach}
  </div>`;
}

function overlayHeader(title, t, {back = false} = {}) {
  return `<header class="overlay-header">
    ${back ? `<button class="overlay-icon" type="button" data-ui-action="back-coach" aria-label="${escapeHtml(t('back'))}">${icon('back')}</button>` : '<span class="overlay-header-spacer"></span>'}
    <h2>${escapeHtml(title)}</h2>
    <button class="overlay-icon" type="button" data-ui-action="close-overlay" aria-label="${escapeHtml(t('close'))}">${icon('close')}</button>
  </header>`;
}

function scoreBar(value) {
  const normalized = scoreValue(value);
  if (normalized == null) return '';
  return `<div class="score-track" aria-hidden="true"><span style="width:${normalized}%"></span></div>`;
}

function scoreRingSvg(value) {
  const normalized = scoreValue(value);
  if (normalized == null) return '';
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - normalized / 100);
  return `<svg class="score-ring" width="112" height="112" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-soft)" stroke-width="10"/>
    <circle class="score-ring-fg" cx="60" cy="60" r="${r}" fill="none" stroke="var(--primary)"
      stroke-width="10" stroke-linecap="round" transform="rotate(-90 60 60)"
      style="stroke-dasharray:${circumference};stroke-dashoffset:${offset}"/>
  </svg>`;
}

function metricRow(label, value) {
  const normalized = scoreValue(value);
  if (normalized == null) return '';
  return `<div class="coach-metric">
    <div class="coach-metric-head"><span>${escapeHtml(label)}</span><strong>${normalized}</strong></div>
    ${scoreBar(normalized)}
  </div>`;
}

function pronunciationMetrics(pronunciation, t, {expanded = false} = {}) {
  if (!pronunciation) return '';
  const rows = [
    metricRow(t('accuracy'), pronunciation.pronunciation_score),
    metricRow(t('fluency'), pronunciation.fluency_score),
    metricRow(t('intonation'), pronunciation.intonation_score)
  ].filter(Boolean).join('');
  if (!rows) return '';
  return `<section id="coach-pronunciation-details" class="overlay-section coach-pronunciation-details"${expanded ? '' : ' hidden'}>
    <h3>${escapeHtml(t('pronunciationDetails'))}</h3>
    <div class="coach-metrics">${rows}</div>
  </section>`;
}

function problemCards(turn, t) {
  const problems = Array.isArray(turn?.coach?.pronunciation?.problems)
    ? turn.coach.pronunciation.problems.slice(0, 4)
    : [];
  if (!problems.length) return '';
  return `<section class="overlay-section">
    <h3>${escapeHtml(t('problemWords'))}</h3>
    <div class="problem-list">${problems.map((problem, index) => `<button class="problem-card ${severityClass(problem)}" type="button" data-ui-action="open-word" data-turn="${turn.no}" data-problem="${index}">
      <span class="problem-icon">${icon('star')}</span>
      <span class="problem-copy"><strong>${escapeHtml(problem.word || '')}</strong>${problem.sound ? `<small>${escapeHtml(problem.sound)}</small>` : ''}</span>
      <span class="problem-chevron">${icon('chevron')}</span>
    </button>`).join('')}</div>
  </section>`;
}

function learnerReplayCard(turn, t, allowAudioActions) {
  if (!allowAudioActions || !hasPlayableReplay(turn)) return '';
  return `<section class="overlay-section coach-replay-section">
    <button class="coach-replay-row" type="button" data-audio-action="replay-user" data-turn="${turn.no}" aria-label="${escapeHtml(t('replayMine'))}" aria-pressed="false">
      <span class="coach-replay-progress" aria-hidden="true">
        <svg viewBox="0 0 48 48" focusable="false">
          <circle cx="24" cy="24" r="20" class="coach-replay-progress-track"/>
          <circle cx="24" cy="24" r="20" pathLength="100" class="coach-replay-progress-ring" data-replay-progress-ring data-turn="${turn.no}" style="stroke-dasharray:100;stroke-dashoffset:100"/>
        </svg>
        <span class="coach-replay-mic">${icon('mic')}</span>
      </span>
      <span class="coach-replay-copy">
        <strong>${escapeHtml(t('replayMine'))}</strong>
        <small>${replayDuration(turn?.replayPcm)}</small>
      </span>
    </button>
  </section>`;
}

function naturalExpressionCard(turn, t, allowAudioActions) {
  const correction = String(turn?.coach?.correction || '').trim();
  const userText = String(turn?.userText || '').trim();
  const explanation = String(turn?.coach?.explanation || '').trim();
  if (!correction && !explanation) return '';
  const sentence = correction || userText;
  return `<section class="overlay-section natural-expression-section">
    <h3>${escapeHtml(t('naturalExpression'))}</h3>
    <div class="natural-row">
      <button class="natural-main" type="button" data-ui-action="open-correction" data-turn="${turn.no}">
        <span>${escapeHtml(sentence)}</span>
        <span class="problem-chevron">${icon('chevron')}</span>
      </button>
      ${allowAudioActions && sentence ? `<button class="round-audio natural-audio" type="button" data-audio-action="speak-correction" data-turn="${turn.no}" aria-label="${escapeHtml(t('playCorrect'))}">${icon('speaker')}</button>` : ''}
    </div>
  </section>`;
}

export function coachOverviewHtml(turn, t, {metricsExpanded = false, allowAudioActions = true} = {}) {
  const overall = turnScore(turn);
  const pronunciation = turn?.coach?.pronunciation;
  return `${overlayHeader(t('coach'), t)}
    <div class="overlay-scroll">
      ${overall == null ? '' : `<button class="score-hero score-hero-ring coach-score-toggle" type="button" data-ui-action="toggle-coach-metrics" data-turn="${turn.no}" aria-expanded="${metricsExpanded}" aria-controls="coach-pronunciation-details">
        ${scoreRingSvg(overall)}
        <span class="score-hero-copy">
          <span>${escapeHtml(t('score'))}</span>
          <strong id="score-number" data-target="${overall}">0<small>/100</small></strong>
        </span>
        <span class="coach-score-chevron">${icon('chevron')}</span>
      </button>`}
      ${pronunciationMetrics(pronunciation, t, {expanded: metricsExpanded})}
      ${learnerReplayCard(turn, t, allowAudioActions)}
      ${naturalExpressionCard(turn, t, allowAudioActions)}
      ${problemCards(turn, t)}
      ${pronunciation?.summary ? `<section class="coach-note">${icon('check')}<span>${escapeHtml(pronunciation.summary)}</span></section>` : ''}
    </div>`;
}

export function correctionOverlayHtml(turn, t, allowAudioActions) {
  const original = turn?.userText || '';
  const correction = turn?.coach?.correction || original;
  const explanation = turn?.coach?.explanation || '';
  return `${overlayHeader(t('naturalExpression'), t, {back: true})}
    <div class="overlay-scroll">
      <section class="compare-card compare-original">
        <h3>${escapeHtml(t('yourSpeech'))}</h3>
        <div class="compare-sentence">${escapeHtml(original)}</div>
      </section>
      <div class="compare-arrow">${icon('down')}</div>
      <section class="compare-card compare-corrected">
        <h3>${escapeHtml(t('naturalExample'))}</h3>
        <div class="compare-sentence-row"><div class="compare-sentence">${escapeHtml(correction)}</div>${allowAudioActions ? `<button class="round-audio" type="button" data-audio-action="speak-correction" data-turn="${turn.no}" aria-label="${escapeHtml(t('playCorrect'))}">${icon('speaker')}</button>` : ''}</div>
      </section>
      ${explanation ? `<section class="tip-card"><span class="tip-icon">${icon('star')}</span><div><strong>${escapeHtml(t('onePoint'))}</strong><p>${escapeHtml(explanation)}</p></div></section>` : ''}
    </div>`;
}

export function wordOverlayHtml(turn, problemIndex, t, allowAudioActions) {
  const problems = turn?.coach?.pronunciation?.problems || [];
  const problem = problems[problemIndex] || {};
  return `${overlayHeader(t('wordPractice'), t, {back: true})}
    <div class="overlay-scroll word-practice">
      <section class="word-hero">
        <div><h3>${escapeHtml(problem.word || '')}</h3>${problem.sound ? `<p>${escapeHtml(problem.sound)}</p>` : ''}</div>
        ${allowAudioActions && problem.word ? `<button class="round-audio round-audio-large" type="button" data-audio-action="speak-problem" data-turn="${turn.no}" data-problem="${problemIndex}" aria-label="${escapeHtml(t('problem'))}">${icon('speaker')}</button>` : ''}
      </section>
      ${problem.heard_like ? `<section class="heard-card"><span>${escapeHtml(t('heardLike'))}</span><strong>${escapeHtml(problem.heard_like)}</strong></section>` : ''}
      ${problem.tip ? `<section class="tip-card"><span class="tip-icon">${icon('star')}</span><div><strong>${escapeHtml(t('focusHere'))}</strong><p>${escapeHtml(problem.tip)}</p></div></section>` : ''}
    </div>`;
}

function waveformBars(pcm, count = 44) {
  if (!pcm?.length) return '';
  const bars = [];
  const bucket = Math.max(1, Math.floor(pcm.length / count));
  for (let index = 0; index < count; index += 1) {
    const start = index * bucket;
    const end = Math.min(pcm.length, start + bucket);
    let peak = 0;
    for (let sample = start; sample < end; sample += 1) peak = Math.max(peak, Math.abs(pcm[sample]));
    const height = Math.max(12, Math.min(100, Math.round((peak / 32768) * 100)));
    bars.push(`<span style="--wave:${height}%"></span>`);
  }
  return bars.join('');
}

export function replayDuration(pcm, sampleRate = 16000) {
  if (!pcm?.length || !sampleRate) return '0:00';
  const seconds = Math.max(0, Math.round(pcm.length / sampleRate));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function replayOverlayHtml(turn, t) {
  return `${overlayHeader(t('replayMine'), t)}
    <div class="overlay-scroll replay-view">
      <section class="replay-transcript"><h3>${escapeHtml(t('yourSpeech'))}</h3><p>${escapeHtml(turn?.userText || '')}</p></section>
      <div class="waveform" aria-hidden="true">${waveformBars(turn?.replayPcm)}</div>
      <div class="replay-time"><span>0:00</span><span>${replayDuration(turn?.replayPcm)}</span></div>
      <button class="replay-main" type="button" data-audio-action="replay-user" data-turn="${turn.no}" aria-label="${escapeHtml(t('replayMine'))}">${icon('play')}</button>
      <p class="replay-note">${escapeHtml(t('replayHint'))}</p>
    </div>`;
}
