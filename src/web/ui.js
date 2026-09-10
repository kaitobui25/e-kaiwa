import {
  CONVERSATION_MODES,
  isHandsFreeMode,
  normalizeAppLanguage,
  normalizeConversationMode,
  normalizeTheme
} from './preferences.js';
import {icon} from './ui_icons.js';
import {devTurnHtml, escapeHtml, publicTurnHtml} from './ui_render.js';
import {UiOverlayController} from './ui_overlay.js';

const COPY = Object.freeze({
  ja: {
    appTagline: '気軽に、たくさん話そう！',
    settings: '設定',
    close: '閉じる',
    language: '表示・コーチ言語',
    targetLanguage: '学習言語',
    targetLanguageDescription: '練習する言語です。変更するとLiveセッションを再接続します。',
    theme: 'テーマ',
    light: 'ライト',
    dark: 'ダーク',
    talkMode: 'Talk',
    talkDescription: 'ON: 自動会話 / OFF: 長押しして話す',
    speed: 'AIの再生速度',
    pronunciation: '発音コーチ',
    start: '話し始める',
    stop: '会話を停止',
    holdToTalk: '長押しして話す',
    releaseToSend: '離して送信',
    waiting: 'AIの返答を待っています…',
    reconnect: '再接続',
    connecting: '接続中…',
    loading: '設定を読み込み中…',
    ready: '準備できました',
    listening: '聞いています…自然に話してください',
    aiSpeaking: 'AIが話しています…',
    stopped: '会話を停止しました',
    noConversation: 'マイクを押して、会話を始めましょう。',
    you: 'あなた',
    ai: 'AI',
    coach: '発音・表現のフィードバック',
    correction: 'より自然な表現',
    replayMine: '自分の声を聞く',
    playCorrect: '正しい文を聞く',
    problem: '注目の単語',
    coachRunning: 'コーチが分析中…',
    score: '総合スコア',
    playbackUnavailable: '音声を再生できませんでした。',
    appLanguageJa: '日本語',
    appLanguageVi: 'Tiếng Việt',
    accuracy: '発音の正確さ',
    fluency: '流暢さ',
    intonation: 'イントネーション',
    pronunciationDetails: '発音の詳細',
    problemWords: '注目の単語',
    naturalExpression: 'より自然な表現',
    yourSpeech: 'あなたの発話',
    naturalExample: 'より自然な表現（例）',
    onePoint: 'ワンポイント解説',
    wordPractice: '単語の発音練習',
    heardLike: '聞こえ方',
    focusHere: 'ここを意識しよう',
    replayHint: '自分の声を聞き返すことで、発音やリズムを客観的に確認できます。'
  },
  vi: {
    appTagline: 'Cứ nói nhiều, giao tiếp sẽ tự nhiên hơn!',
    settings: 'Cài đặt',
    close: 'Đóng',
    language: 'Ngôn ngữ UI & Coach',
    targetLanguage: 'Ngôn ngữ đang học',
    targetLanguageDescription: 'Ngôn ngữ luyện tập; đổi lựa chọn sẽ tạo lại phiên Live.',
    theme: 'Giao diện',
    light: 'Sáng',
    dark: 'Tối',
    talkMode: 'Talk',
    talkDescription: 'Bật: hội thoại tự động / Tắt: giữ nút để nói',
    speed: 'Tốc độ giọng AI',
    pronunciation: 'Coach phát âm',
    start: 'Bắt đầu nói',
    stop: 'Dừng hội thoại',
    holdToTalk: 'Chạm và giữ để nói',
    releaseToSend: 'Thả để gửi',
    waiting: 'Đang chờ AI trả lời…',
    reconnect: 'Kết nối lại',
    connecting: 'Đang kết nối…',
    loading: 'Đang tải cài đặt…',
    ready: 'Sẵn sàng',
    listening: 'Đang nghe… cứ nói tự nhiên',
    aiSpeaking: 'AI đang nói…',
    stopped: 'Đã dừng hội thoại',
    noConversation: 'Nhấn mic để bắt đầu hội thoại.',
    you: 'Bạn',
    ai: 'AI',
    coach: 'Phản hồi phát âm & diễn đạt',
    correction: 'Cách nói tự nhiên hơn',
    replayMine: 'Nghe giọng tôi',
    playCorrect: 'Nghe câu chuẩn',
    problem: 'Từ cần chú ý',
    coachRunning: 'Coach đang phân tích…',
    score: 'Điểm tổng',
    playbackUnavailable: 'Không thể phát âm thanh.',
    appLanguageJa: '日本語',
    appLanguageVi: 'Tiếng Việt',
    accuracy: 'Độ chính xác',
    fluency: 'Độ trôi chảy',
    intonation: 'Ngữ điệu',
    pronunciationDetails: 'Chi tiết phát âm',
    problemWords: 'Từ cần chú ý',
    naturalExpression: 'Cách nói tự nhiên hơn',
    yourSpeech: 'Câu bạn đã nói',
    naturalExample: 'Cách nói tự nhiên hơn',
    onePoint: 'Gợi ý nhanh',
    wordPractice: 'Luyện phát âm từ',
    heardLike: 'Nghe gần giống',
    focusHere: 'Điểm cần chú ý',
    replayHint: 'Nghe lại giọng của bạn giúp kiểm tra phát âm và nhịp điệu khách quan hơn.'
  }
});

const DEV_TALK_LABELS = Object.freeze({
  connecting: 'Connecting…',
  ready: '🎙 Start conversation',
  recording: '■ Stop conversation',
  reconnect: '↻ Reconnect'
});

export {publicTurnHtml};

function resolveUiElements(elements) {
  return {
    ...elements,
    overlayRoot: elements.overlayRoot || document.getElementById('overlay-root'),
    overlayBackdrop: elements.overlayBackdrop || document.getElementById('overlay-backdrop'),
    overlaySurface: elements.overlaySurface || document.getElementById('overlay-surface'),
    overlayDynamic: elements.overlayDynamic || document.getElementById('overlay-dynamic'),
    quickLanguage: elements.quickLanguage || document.getElementById('quick-language'),
    quickSpeed: elements.quickSpeed || document.getElementById('quick-speed')
  };
}

export class UiController {
  constructor({mode = 'dev', elements, onAction = () => {}}) {
    this.mode = mode === 'public' ? 'public' : 'dev';
    this.elements = resolveUiElements(elements);
    this.onAction = onAction;
    this.language = 'ja';
    this.theme = 'light';
    this.playbackRate = 0.8;
    this.turns = [];
    this.conversationMode = this.mode === 'public'
      ? CONVERSATION_MODES.PUSH_TO_TALK
      : CONVERSATION_MODES.HANDS_FREE;
    this.lastStatus = '';
    this.lastStatusError = false;

    this.overlay = new UiOverlayController({
      mode: this.mode,
      root: this.elements.overlayRoot,
      backdrop: this.elements.overlayBackdrop,
      surface: this.elements.overlaySurface,
      dynamic: this.elements.overlayDynamic,
      settingsPanel: this.elements.settingsPanel,
      settingsOpen: this.elements.settingsOpen,
      settingsClose: this.elements.settingsClose,
      translate: key => this.t(key),
      audioActionsAllowed: () => !isHandsFreeMode(this.conversationMode),
      onAudioAction: (action, detail) => this.onAction(action, detail)
    });

    this._bindConversation();
    this.elements.aiSpeed?.addEventListener('change', () => this.setPlaybackRate(this.elements.aiSpeed.value));
    this.applyMode(this.mode);
  }

  _bindConversation() {
    this.elements.conversation?.addEventListener('click', event => {
      const trigger = event.target.closest?.('[data-ui-action]');
      if (!trigger) return;
      const turnNo = Number(trigger.dataset.turn || 0);
      const turn = this.turns.find(item => item.no === turnNo);
      if (!turn) return;
      if (trigger.dataset.uiAction === 'open-coach') this.overlay.openCoach(turn);
      else if (trigger.dataset.uiAction === 'open-replay') this.overlay.openReplay(turn);
    });
  }

  t(key) {
    return COPY[this.language]?.[key] || COPY.ja[key] || key;
  }

  applyMode(mode) {
    this.mode = mode === 'public' ? 'public' : 'dev';
    document.body.dataset.appMode = this.mode;
    this.overlay.setMode(this.mode);
    if (this.elements.settingsPanel) this.elements.settingsPanel.hidden = this.mode === 'public';
    if (this.elements.settingsOpen) this.elements.settingsOpen.hidden = this.mode !== 'public';
  }

  setConversationMode(mode) {
    this.conversationMode = this.mode === 'public'
      ? normalizeConversationMode(mode)
      : CONVERSATION_MODES.HANDS_FREE;
    document.body.dataset.conversationMode = this.conversationMode;
    if (this.elements.talkMode) this.elements.talkMode.checked = isHandsFreeMode(this.conversationMode);
    this.overlay.refresh(this.turns);
  }

  setLanguage(language) {
    this.language = normalizeAppLanguage(language, this.language);
    document.documentElement.lang = this.language;
    for (const node of document.querySelectorAll('[data-i18n]')) {
      const key = node.dataset.i18n;
      if (key) node.textContent = this.t(key);
    }
    if (this.elements.feedbackLanguage) this.elements.feedbackLanguage.value = this.language;
    if (this.elements.quickLanguage) this.elements.quickLanguage.textContent = this.t(this.language === 'vi' ? 'appLanguageVi' : 'appLanguageJa');
    if (this.lastStatus) this.setStatus(this.lastStatus, {error: this.lastStatusError});
    this.overlay.refresh(this.turns);
  }

  setTheme(theme) {
    this.theme = normalizeTheme(theme, this.theme);
    document.body.dataset.theme = this.theme;
    if (this.elements.theme) this.elements.theme.value = this.theme;
  }

  setPlaybackRate(rate) {
    const numeric = Number(rate);
    this.playbackRate = Number.isFinite(numeric) ? numeric : 0.8;
    if (this.elements.quickSpeed) this.elements.quickSpeed.textContent = `${this.playbackRate.toFixed(1)}×`;
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
    button.className = `talk-button talk-${state}`;
    button.disabled = ['connecting', 'waiting', 'speaking'].includes(state);

    if (this.mode === 'dev') {
      const label = DEV_TALK_LABELS[state] || DEV_TALK_LABELS.ready;
      button.textContent = label;
      if (this.elements.talkLabel) this.elements.talkLabel.textContent = label;
      return;
    }

    const handsFree = isHandsFreeMode(this.conversationMode);
    const labels = handsFree
      ? {
          connecting: this.t('connecting'),
          ready: this.t('start'),
          recording: this.t('stop'),
          waiting: this.t('waiting'),
          speaking: this.t('aiSpeaking'),
          reconnect: this.t('reconnect')
        }
      : {
          connecting: this.t('connecting'),
          ready: this.t('holdToTalk'),
          pressed: this.t('releaseToSend'),
          waiting: this.t('waiting'),
          speaking: this.t('aiSpeaking'),
          reconnect: this.t('reconnect')
        };

    const label = labels[state] || labels.ready;
    button.innerHTML = state === 'reconnect' ? '<span class="reconnect-glyph">↻</span>' : icon('mic', 'talk-icon');
    button.setAttribute('aria-label', label);
    if (this.elements.talkLabel) this.elements.talkLabel.textContent = label;
  }

  openSettings() {
    this.overlay.openSettings();
  }

  closeSettings() {
    this.overlay.close();
  }

  render(turns, {pronunciationEnabled = true, conversationMode = this.conversationMode} = {}) {
    const target = this.elements.conversation;
    this.turns = Array.isArray(turns) ? turns : [];
    this.setPlaybackRate(this.elements.aiSpeed?.value ?? this.playbackRate);
    if (!target) return;
    if (!this.turns.length) {
      target.innerHTML = `<div class="empty-state">${escapeHtml(this.mode === 'public' ? this.t('noConversation') : 'No conversation yet.')}</div>`;
      this.overlay.refresh(this.turns);
      return;
    }
    target.innerHTML = this.mode === 'public'
      ? this.turns.map(turn => publicTurnHtml(turn, key => this.t(key), pronunciationEnabled, conversationMode)).join('')
      : this.turns.slice().reverse().map(turn => devTurnHtml(turn, pronunciationEnabled)).join('');
    this.overlay.refresh(this.turns);
    if (this.mode === 'public') target.lastElementChild?.scrollIntoView?.({block: 'end', behavior: 'smooth'});
  }
}
