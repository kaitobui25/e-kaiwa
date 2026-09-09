import {isHandsFreeMode} from './preferences.js';
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

export function highlightProblems(text, pronunciation) {
  const raw = String(text || '…');
  const problems = Array.isArray(pronunciation?.problems) ? pronunciation.problems.slice(0, 4) : [];
  if (!problems.length) return escapeHtml(raw);

  const byWord = new Map();
  for (const problem of problems) {
    const word = String(problem?.word || '').trim();
    if (word) byWord.set(word.toLocaleLowerCase('en-US'), problem);
  }
  const words = [...byWord.keys()].sort((a, b) => b.length - a.length);
  if (!words.length) return escapeHtml(raw);

  const pattern = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`\\b(${pattern})\\b`, 'gi');
  let html = '';
  let lastIndex = 0;
  raw.replace(regex, (match, _captured, offset) => {
    html += escapeHtml(raw.slice(lastIndex, offset));
    const problem = byWord.get(match.toLocaleLowerCase('en-US'));
    html += `<span class="pron-problem ${severityClass(problem)}">${escapeHtml(match)}</span>`;
    lastIndex = offset + match.length;
    return match;
  });
  return html + escapeHtml(raw.slice(lastIndex));
}

export function turnScore(turn) {
  const pronunciation = turn?.coach?.pronunciation;
  if (!pronunciation) return null;
  return scoreValue(pronunciation.overall_score ?? pronunciation.pronunciation_score);
}

function inlineReplay(turn, t, allowAudioActions) {
  if (!allowAudioActions || !turn?.replayPcm?.length) return '';
  return `<button class="inline-action replay-inline" type="button" data-ui-action="open-replay" data-turn="${turn.no}" aria-label="${escapeHtml(t('replayMine'))}">${icon('play')}</button>`;
}

function inlineScore(turn, t, pronunciationEnabled) {
  if (!pronunciationEnabled || !turn?.coachEligible) return '';
  const overall = turnScore(turn);
  if (overall == null) return '';
  return `<button class="score-pill score-button" type="button" data-ui-action="open-coach" data-turn="${turn.no}" aria-label="${escapeHtml(t('score'))} ${overall}">${overall}</button>`;
}

export function publicTurnHtml(turn, t, pronunciationEnabled, conversationMode) {
  const pronunciation = pronunciationEnabled ? turn.coach?.pronunciation : null;
  const userText = pronunciation
    ? highlightProblems(turn.userText || '…', pronunciation)
    : escapeHtml(turn.userText || '…');
  const allowAudioActions = !isHandsFreeMode(conversationMode);
  const userActions = `${inlineReplay(turn, t, allowAudioActions)}${inlineScore(turn, t, pronunciationEnabled)}`;

  const userRow = `<div class="message-row user-row">
    <div class="message-stack user-stack">
      <div class="bubble user-bubble"><div class="message-text user-message-text">${userText}${userActions}</div></div>
    </div>
    <div class="avatar user-avatar" aria-hidden="true">${icon('user')}</div>
  </div>`;

  const aiRow = `<div class="message-row ai-row">
    <div class="avatar ai-avatar" aria-hidden="true">${icon('sparkle')}</div>
    <div class="message-stack ai-stack">
      <div class="message-meta">${escapeHtml(t('ai'))}</div>
      <div class="bubble ai-bubble"><div class="message-text">${escapeHtml(turn.aiText || '…')}</div></div>
    </div>
  </div>`;

  return `<article class="turn public-turn">${userRow}${aiRow}</article>`;
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

function overlayHeader(title, {back = false} = {}) {
  return `<header class="overlay-header">
    ${back ? `<button class="overlay-icon" type="button" data-ui-action="back-coach" aria-label="Back">${icon('back')}</button>` : '<span class="overlay-header-spacer"></span>'}
    <h2>${escapeHtml(title)}</h2>
    <button class="overlay-icon" type="button" data-ui-action="close-overlay" aria-label="Close">${icon('close')}</button>
  </header>`;
}

function scoreBar(value) {
  const normalized = scoreValue(value);
  if (normalized == null) return '';
  return `<div class="score-track" aria-hidden="true"><span style="width:${normalized}%"></span></div>`;
}

function metricRow(label, value) {
  const normalized = scoreValue(value);
  if (normalized == null) return '';
  return `<div class="coach-metric">
    <div class="coach-metric-head"><span>${escapeHtml(label)}</span><strong>${normalized}</strong></div>
    ${scoreBar(normalized)}
  </div>`;
}

function pronunciationMetrics(pronunciation, t) {
  if (!pronunciation) return '';
  const rows = [
    metricRow(t('accuracy'), pronunciation.pronunciation_score),
    metricRow(t('fluency'), pronunciation.fluency_score),
    metricRow(t('intonation'), pronunciation.intonation_score)
  ].filter(Boolean).join('');
  if (!rows) return '';
  return `<section class="overlay-section"><h3>${escapeHtml(t('pronunciationDetails'))}</h3><div class="coach-metrics">${rows}</div></section>`;
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

function naturalExpressionCard(turn, t) {
  const correction = String(turn?.coach?.correction || '').trim();
  const userText = String(turn?.userText || '').trim();
  const explanation = String(turn?.coach?.explanation || '').trim();
  if (!correction && !explanation) return '';
  return `<section class="overlay-section">
    <h3>${escapeHtml(t('naturalExpression'))}</h3>
    <button class="natural-card" type="button" data-ui-action="open-correction" data-turn="${turn.no}">
      <span>${escapeHtml(correction || userText)}</span>
      <span class="problem-chevron">${icon('chevron')}</span>
    </button>
  </section>`;
}

export function coachOverviewHtml(turn, t) {
  const overall = turnScore(turn);
  const pronunciation = turn?.coach?.pronunciation;
  return `${overlayHeader(t('coach'))}
    <div class="overlay-scroll">
      ${overall == null ? '' : `<section class="score-hero">
        <div><span>${escapeHtml(t('score'))}</span><strong>${overall}<small>/100</small></strong></div>
        ${scoreBar(overall)}
      </section>`}
      ${pronunciationMetrics(pronunciation, t)}
      ${problemCards(turn, t)}
      ${naturalExpressionCard(turn, t)}
      ${pronunciation?.summary ? `<section class="coach-note">${icon('check')}<span>${escapeHtml(pronunciation.summary)}</span></section>` : ''}
    </div>`;
}

export function correctionOverlayHtml(turn, t, allowAudioActions) {
  const original = turn?.userText || '';
  const correction = turn?.coach?.correction || original;
  const explanation = turn?.coach?.explanation || '';
  return `${overlayHeader(t('naturalExpression'), {back: true})}
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
  return `${overlayHeader(t('wordPractice'), {back: true})}
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
  return `${overlayHeader(t('replayMine'))}
    <div class="overlay-scroll replay-view">
      <section class="replay-transcript"><h3>${escapeHtml(t('yourSpeech'))}</h3><p>${escapeHtml(turn?.userText || '')}</p></section>
      <div class="waveform" aria-hidden="true">${waveformBars(turn?.replayPcm)}</div>
      <div class="replay-time"><span>0:00</span><span>${replayDuration(turn?.replayPcm)}</span></div>
      <button class="replay-main" type="button" data-audio-action="replay-user" data-turn="${turn.no}" aria-label="${escapeHtml(t('replayMine'))}">${icon('play')}</button>
      <p class="replay-note">${escapeHtml(t('replayHint'))}</p>
    </div>`;
}
