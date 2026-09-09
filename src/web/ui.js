import {normalizeAppLanguage, normalizeTheme} from './preferences.js';

const COPY = Object.freeze({
  ja: {
    appTagline: '気軽に、たくさん話そう！',
    settings: '設定',
    close: '閉じる',
    language: '表示・コーチ言語',
    theme: 'テーマ',
    light: 'ライト',
    dark: 'ダーク',
    speed: 'AIの再生速度',
    pronunciation: '発音コーチ',
    start: '話し始める',
    stop: '会話を停止',
    reconnect: '再接続',
    connecting: '接続中…',
    loading: '設定を読み込み中…',
    ready: '準備できました',
    listening: '聞いています…自然に話してください',
    aiSpeaking: 'AIが話しています…',
    stopped: '会話を停止しました',
    noConversation: '会話を始めると、ここに内容が表示されます。',
    you: 'あなた',
    ai: 'AI',
    coach: '発音・表現のフィードバック',
    correction: 'より自然な表現',
    replayMine: '自分の声',
    playCorrect: '正しい文を聞く',
    problem: '注目の単語',
    coachRunning: 'コーチが分析中…',
    score: '総合スコア',
    appLanguageJa: '日本語',
    appLanguageVi: 'Tiếng Việt'
  },
  vi: {
    appTagline: 'Cứ nói nhiều, tiếng Anh sẽ gần hơn!',
    settings: 'Cài đặt',
    close: 'Đóng',
    language: 'Ngôn ngữ UI & Coach',
    theme: 'Giao diện',
    light: 'Sáng',
    dark: 'Tối',
    speed: 'Tốc độ giọng AI',
    pronunciation: 'Coach phát âm',
    start: 'Bắt đầu nói',
    stop: 'Dừng hội thoại',
    reconnect: 'Kết nối lại',
    connecting: 'Đang kết nối…',
    loading: 'Đang tải cài đặt…',
    ready: 'Sẵn sàng',
    listening: 'Đang nghe… cứ nói tự nhiên',
    aiSpeaking: 'AI đang nói…',
    stopped: 'Đã dừng hội thoại',
    noConversation: 'Bắt đầu nói để xem hội thoại ở đây.',
    you: 'Bạn',
    ai: 'AI',
    coach: 'Phản hồi phát âm & diễn đạt',
    correction: 'Cách nói tự nhiên hơn',
    replayMine: 'Nghe giọng tôi',
    playCorrect: 'Nghe câu chuẩn',
    problem: 'Từ cần chú ý',
    coachRunning: 'Coach đang phân tích…',
    score: 'Điểm tổng',
    appLanguageJa: '日本語',
    appLanguageVi: 'Tiếng Việt'
  }
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function score(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function severityClass(problem) {
  return problem?.severity === 'red' ? 'severity-red' : 'severity-yellow';
}

function highlightProblems(text, pronunciation) {
  const raw = String(text || '…');
  const problems = Array.isArray(pronunciation?.problems) ? pronunciation.problems.slice(0, 4) : [];
  if (!problems.length) return escapeHtml(raw);

  const byWord = new Map();
  for (const problem of problems) {
    const word = String(problem?.word || '').trim();
    if (!word) continue;
    byWord.set(word.toLocaleLowerCase('en-US'), problem);
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
  html += escapeHtml(raw.slice(lastIndex));
  return html;
}

function coachHtml(turn, t) {
  if (!turn.coach) return `<div class="coach-card coach-pending">${escapeHtml(t('coachRunning'))}</div>`;
  const pronunciation = turn.coach.pronunciation;
  const overall = pronunciation ? score(pronunciation.overall_score ?? pronunciation.pronunciation_score) : null;
  const correction = turn.coach.correction || turn.userText || '';
  const explanation = turn.coach.explanation || '';
  const problems = Array.isArray(pronunciation?.problems) ? pronunciation.problems.slice(0, 4) : [];

  return `<details class="coach-card">
    <summary>
      <span>${escapeHtml(t('coach'))}</span>
      ${overall == null ? '' : `<span class="score-pill" aria-label="${escapeHtml(t('score'))} ${overall}">${overall}</span>`}
    </summary>
    <div class="coach-body">
      <div class="coach-section">
        <div class="coach-label">${escapeHtml(t('correction'))}</div>
        <div class="coach-correction-row">
          <div class="coach-correction">${escapeHtml(correction)}</div>
          <button class="icon-button" type="button" data-action="speak-correction" data-turn="${turn.no}" aria-label="${escapeHtml(t('playCorrect'))}">🔊</button>
        </div>
        ${explanation ? `<div class="coach-explanation">${escapeHtml(explanation)}</div>` : ''}
      </div>
      ${problems.map((problem, index) => `<div class="coach-problem ${severityClass(problem)}">
        <div class="coach-problem-head">
          <strong>${escapeHtml(problem.word || '')}</strong>
          <button class="icon-button" type="button" data-action="speak-problem" data-turn="${turn.no}" data-problem="${index}" aria-label="${escapeHtml(t('problem'))}">🔊</button>
        </div>
        ${problem.sound ? `<div class="coach-sound">${escapeHtml(problem.sound)}</div>` : ''}
        ${problem.tip ? `<div>${escapeHtml(problem.tip)}</div>` : ''}
      </div>`).join('')}
    </div>
  </details>`;
}

function publicTurnHtml(turn, t, pronunciationEnabled) {
  const pronunciation = pronunciationEnabled ? turn.coach?.pronunciation : null;
  const userText = pronunciation
    ? highlightProblems(turn.userText || '…', pronunciation)
    : escapeHtml(turn.userText || '…');
  const overall = pronunciation ? score(pronunciation.overall_score ?? pronunciation.pronunciation_score) : null;

  const userRow = `<div class="message-row user-row">
    <div class="message-stack user-stack">
      <div class="message-meta"><span>${escapeHtml(t('you'))}</span>${overall == null ? '' : `<span class="score-inline">${overall}</span>`}</div>
      <div class="bubble user-bubble"><div class="message-text">${userText}</div></div>
      ${turn.replayPcm?.length ? `<button class="replay-button" type="button" data-action="replay-user" data-turn="${turn.no}">▶ ${escapeHtml(t('replayMine'))}</button>` : ''}
      ${turn.coachEligible ? coachHtml(turn, t) : ''}
    </div>
    <div class="avatar user-avatar" aria-hidden="true">YOU</div>
  </div>`;

  const aiRow = `<div class="message-row ai-row">
    <div class="avatar ai-avatar" aria-hidden="true">AI</div>
    <div class="message-stack ai-stack">
      <div class="message-meta">${escapeHtml(t('ai'))}</div>
      <div class="bubble ai-bubble"><div class="message-text">${escapeHtml(turn.aiText || '…')}</div></div>
    </div>
  </div>`;

  return `<article class="turn public-turn">${userRow}${aiRow}</article>`;
}

function devTurnHtml(turn, pronunciationEnabled) {
  const pronunciation = pronunciationEnabled ? turn.coach?.pronunciation : null;
  const userText = pronunciation ? highlightProblems(turn.userText || '…', pronunciation) : escapeHtml(turn.userText || '…');
  const overall = pronunciation ? score(pronunciation.overall_score ?? pronunciation.pronunciation_score) : null;
  const coach = turn.coach
    ? `<div class="dev-coach"><strong>Coach${overall == null ? '' : ` ${overall}`}:</strong> ${escapeHtml(turn.coach.correction || turn.userText || '')}${turn.coach.explanation ? `<br><span class="muted">${escapeHtml(turn.coach.explanation)}</span>` : ''}</div>`
    : (turn.coachEligible ? '<div class="muted">Coach running…</div>' : '');
  return `<div class="turn dev-turn">
    <div class="who who-you">You</div><div class="text">${userText}</div>
    <div class="who who-ai">AI</div><div class="text">${escapeHtml(turn.aiText || '…')}</div>
    ${coach}
  </div>`;
}

export class UiController {
  constructor({mode = 'dev', elements, onAction = () => {}}) {
    this.mode = mode === 'public' ? 'public' : 'dev';
    this.elements = elements;
    this.onAction = onAction;
    this.language = 'ja';
    this.theme = 'light';
    this.lastStatus = '';
    this.lastStatusError = false;
    this._bind();
    this.applyMode(this.mode);
  }

  _bind() {
    this.elements.conversation?.addEventListener('click', event => {
      const button = event.target.closest?.('[data-action]');
      if (!button) return;
      this.onAction(button.dataset.action, {
        turn: Number(button.dataset.turn || 0),
        problem: Number(button.dataset.problem || 0)
      });
    });
    this.elements.settingsOpen?.addEventListener('click', () => this.openSettings());
    this.elements.settingsClose?.addEventListener('click', () => this.closeSettings());
  }

  t(key) {
    return COPY[this.language]?.[key] || COPY.ja[key] || key;
  }

  applyMode(mode) {
    this.mode = mode === 'public' ? 'public' : 'dev';
    document.body.dataset.appMode = this.mode;
    if (this.elements.settingsPanel) this.elements.settingsPanel.hidden = this.mode === 'public';
    if (this.elements.settingsOpen) this.elements.settingsOpen.hidden = this.mode !== 'public';
  }

  setLanguage(language) {
    this.language = normalizeAppLanguage(language, this.language);
    document.documentElement.lang = this.language;
    for (const node of document.querySelectorAll('[data-i18n]')) {
      const key = node.dataset.i18n;
      if (key) node.textContent = this.t(key);
    }
    if (this.elements.feedbackLanguage) this.elements.feedbackLanguage.value = this.language;
    if (this.lastStatus) this.setStatus(this.lastStatus, {error: this.lastStatusError});
  }

  setTheme(theme) {
    this.theme = normalizeTheme(theme, this.theme);
    document.body.dataset.theme = this.theme;
    if (this.elements.theme) this.elements.theme.value = this.theme;
  }

  setStatus(text, {error = false} = {}) {
    this.lastStatus = String(text || '');
    this.lastStatusError = error;
    if (!this.elements.status) return;
    this.elements.status.textContent = this.lastStatus;
    this.elements.status.className = error ? 'status error' : 'status';
  }

  setSetupReady(ready) {
    if (this.elements.setupDot) this.elements.setupDot.className = ready ? 'setup-dot on' : 'setup-dot';
    if (this.elements.setupLabel) this.elements.setupLabel.textContent = `setupReady=${Boolean(ready)}`;
  }

  setTalkState(state) {
    const button = this.elements.talk;
    if (!button) return;
    button.dataset.state = state;
    button.className = state === 'recording' ? 'recording' : 'ready';
    button.disabled = state === 'connecting';
    const labels = {
      connecting: this.t('connecting'),
      ready: this.t('start'),
      recording: this.t('stop'),
      reconnect: this.t('reconnect')
    };
    button.textContent = this.mode === 'public'
      ? (state === 'recording' ? '■' : state === 'connecting' ? '…' : state === 'reconnect' ? '↻' : '🎙')
      : labels[state] || labels.ready;
    if (this.elements.talkLabel) this.elements.talkLabel.textContent = labels[state] || labels.ready;
  }

  openSettings() {
    if (this.mode !== 'public' || !this.elements.settingsPanel) return;
    this.elements.settingsPanel.hidden = false;
    document.body.classList.add('settings-open');
  }

  closeSettings() {
    if (this.mode !== 'public' || !this.elements.settingsPanel) return;
    this.elements.settingsPanel.hidden = true;
    document.body.classList.remove('settings-open');
  }

  render(turns, {pronunciationEnabled = true} = {}) {
    const target = this.elements.conversation;
    if (!target) return;
    if (!turns.length) {
      target.innerHTML = `<div class="empty-state">${escapeHtml(this.mode === 'public' ? this.t('noConversation') : 'No conversation yet.')}</div>`;
      return;
    }
    target.innerHTML = this.mode === 'public'
      ? turns.map(turn => publicTurnHtml(turn, key => this.t(key), pronunciationEnabled)).join('')
      : turns.slice().reverse().map(turn => devTurnHtml(turn, pronunciationEnabled)).join('');
    if (this.mode === 'public') target.lastElementChild?.scrollIntoView?.({block: 'end', behavior: 'smooth'});
  }
}
