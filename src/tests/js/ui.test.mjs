import assert from 'node:assert/strict';
import test from 'node:test';

import {CONVERSATION_MODES} from '../../web/preferences.js';
import {hasPlayableReplay} from '../../web/replay_policy.js';
import {targetLanguageLabel} from '../../web/ui.js';
import {
  coachOverviewHtml,
  correctionOverlayHtml,
  highlightProblems,
  publicTurnHtml,
  replayDuration,
  replayOverlayHtml,
  scoreTier,
  wordOverlayHtml
} from '../../web/ui_render.js';

const translations = new Proxy({}, {get: (_target, key) => String(key)});
const t = key => translations[key];

function sampleTurn() {
  return {
    no: 1,
    userText: 'I like listening music.',
    aiText: 'What music do you like?',
    replayPcm: new Int16Array(32000).fill(12000),
    coachEligible: true,
    coach: {
      correction: 'I like listening to music.',
      explanation: 'Use “listen to”.',
      pronunciation: {
        overall_score: 82,
        pronunciation_score: 80,
        fluency_score: 85,
        intonation_score: 82,
        summary: 'Clear and easy to understand.',
        problems: [{
          word: 'listening',
          severity: 'yellow',
          sound: '/ˈlɪsənɪŋ/',
          heard_like: 'listenin',
          tip: 'Keep the final ng.'
        }]
      }
    }
  };
}

test('push-to-talk learner message keeps only the coach score action', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.PUSH_TO_TALK);
  assert.match(html, /class="turn public-turn" data-turn="1"/);
  assert.match(html, /class="message-text user-message-text" data-turn-text="user"/);
  assert.match(html, /data-turn-text="ai"/);
  assert.match(html, /class="message-actions"/);
  assert.doesNotMatch(html, /data-ui-action="open-replay"/);
  assert.match(html, /data-ui-action="open-coach"/);
  assert.ok(html.indexOf('class="message-actions"') > html.indexOf('data-turn-text="user"'));
  assert.match(html, /class="score-pill score-button"/);
  assert.doesNotMatch(html, /replay-inline/);
  assert.doesNotMatch(html, />YOU</);
});

test('hands-free hides manual replay but keeps coach score and problem highlighting', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.HANDS_FREE);
  assert.doesNotMatch(html, /data-ui-action="open-replay"/);
  assert.match(html, /data-ui-action="open-coach"/);
  assert.match(html, /class="pron-problem severity-yellow">listening</);
  assert.match(html, /<span class="score-pill-num">82<\/span>/);
  assert.match(html, /data-score-tier="teal"/);
  assert.match(html, /class="score-pill-ring"/);
  assert.match(html, /class="score-pill-arc"/);
});

test('coach overview starts collapsed and follows score, replay, natural expression, problem words order', () => {
  const html = coachOverviewHtml(sampleTurn(), t, {allowAudioActions: true});
  assert.match(html, /score-hero-ring coach-score-toggle/);
  assert.match(html, /data-ui-action="toggle-coach-metrics"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="coach-pronunciation-details" class="overlay-section coach-pronunciation-details" hidden/);
  assert.match(html, /id="score-number" data-target="82">0<small>\/100<\/small>/);
  assert.match(html, /data-audio-action="replay-user"/);
  assert.match(html, /class="coach-replay-progress-ring"/);
  assert.match(html, /data-ui-action="open-correction"/);
  assert.match(html, /data-audio-action="speak-correction"/);
  assert.match(html, /data-ui-action="open-word"/);
  assert.ok(html.indexOf('coach-replay-row') < html.indexOf('natural-expression-section'));
  assert.ok(html.indexOf('natural-expression-section') < html.indexOf('problemWords'));
  assert.match(html, /Clear and easy to understand\./);

  const expanded = coachOverviewHtml(sampleTurn(), t, {metricsExpanded: true, allowAudioActions: true});
  assert.match(expanded, /aria-expanded="true"/);
  assert.doesNotMatch(expanded, /coach-pronunciation-details" hidden/);
  assert.match(expanded, />accuracy<\/span><strong>80<\/strong>/);
  assert.match(expanded, />fluency<\/span><strong>85<\/strong>/);
  assert.match(expanded, />intonation<\/span><strong>82<\/strong>/);

  const sparse = sampleTurn();
  delete sparse.coach.pronunciation.fluency_score;
  const sparseHtml = coachOverviewHtml(sparse, t, {metricsExpanded: true});
  assert.doesNotMatch(sparseHtml, />fluency<\/span>/);
});

test('correction and word detail expose audio only when manual audio is allowed', () => {
  const turn = sampleTurn();
  const correctionPtt = correctionOverlayHtml(turn, t, true);
  const correctionHandsFree = correctionOverlayHtml(turn, t, false);
  assert.match(correctionPtt, /data-audio-action="speak-correction"/);
  assert.doesNotMatch(correctionHandsFree, /data-audio-action="speak-correction"/);

  const wordPtt = wordOverlayHtml(turn, 0, t, true);
  const wordHandsFree = wordOverlayHtml(turn, 0, t, false);
  assert.match(wordPtt, /data-audio-action="speak-problem"/);
  assert.match(wordPtt, /listenin/);
  assert.doesNotMatch(wordHandsFree, /data-audio-action="speak-problem"/);
});

test('problem highlighting supports Japanese and Chinese without breaking English word boundaries', () => {
  const japanese = highlightProblems('今日は天気です。', {problems: [{word: '天気', severity: 'yellow'}]});
  assert.match(japanese, /今日は<span class="pron-problem severity-yellow">天気<\/span>です。/);

  const chinese = highlightProblems('你好世界', {problems: [{word: '世界', severity: 'red'}]});
  assert.match(chinese, /你好<span class="pron-problem severity-red">世界<\/span>/);

  const english = highlightProblems('scatter cat', {problems: [{word: 'cat', severity: 'yellow'}]});
  assert.doesNotMatch(english, /s<span[^>]*>cat<\/span>ter/);
  assert.match(english, /scatter <span class="pron-problem severity-yellow">cat<\/span>/);
});

test('replay overlay uses local PCM for waveform and duration without extra data dependency', () => {
  const turn = sampleTurn();
  assert.equal(replayDuration(turn.replayPcm), '0:02');
  const html = replayOverlayHtml(turn, t);
  assert.match(html, /class="waveform"/);
  assert.match(html, /--wave:/);
  assert.match(html, /data-audio-action="replay-user"/);
  assert.match(html, />0:02<\/span>/);
});

test('coach learner replay only renders when PCM is playable and manual audio is allowed', () => {
  const base = sampleTurn();
  assert.equal(hasPlayableReplay(base), true);
  assert.match(coachOverviewHtml(base, t, {allowAudioActions: true}), /data-audio-action="replay-user"/);
  assert.doesNotMatch(coachOverviewHtml(base, t, {allowAudioActions: false}), /data-audio-action="replay-user"/);
  assert.doesNotMatch(publicTurnHtml(base, t, true, CONVERSATION_MODES.PUSH_TO_TALK), /data-ui-action="open-replay"/);

  for (const replayPcm of [new Int16Array(0), new Int16Array(10), [1,2,3], null]) {
    const turn = {...base, replayPcm};
    assert.equal(hasPlayableReplay(turn), false);
    assert.doesNotMatch(coachOverviewHtml(turn, t, {allowAudioActions: true}), /data-audio-action="replay-user"/);
  }
});

test('target-language dock labels are independent from UI language', () => {
  assert.equal(targetLanguageLabel('en'), 'English');
  assert.equal(targetLanguageLabel('ja'), '日本語');
  assert.equal(targetLanguageLabel('zh-Hans'), '中文');
});

test('score tier boundaries match 70/90 spec and ring renders accessible markup', () => {
  assert.equal(scoreTier(90), 'gold');
  assert.equal(scoreTier(95), 'gold');
  assert.equal(scoreTier(100), 'gold');
  assert.equal(scoreTier(89), 'teal');
  assert.equal(scoreTier(82), 'teal');
  assert.equal(scoreTier(70), 'teal');
  assert.equal(scoreTier(69), 'muted');
  assert.equal(scoreTier(0), 'muted');
  assert.equal(scoreTier(45), 'muted');
});

test('score pill renders tiered SVG ring with correct stroke math and aria label', () => {
  const cases = [
    {score: 95, tier: 'gold'},
    {score: 82, tier: 'teal'},
    {score: 45, tier: 'muted'}
  ];
  for (const {score, tier} of cases) {
    const turn = {...sampleTurn(), coach: {pronunciation: {overall_score: score}}};
    const html = publicTurnHtml(turn, t, true, CONVERSATION_MODES.PUSH_TO_TALK);
    assert.match(html, new RegExp(`data-score-tier="${tier}"`));
    assert.match(html, new RegExp(`<span class="score-pill-num">${score}<\\/span>`));
    assert.match(html, /class="score-pill-ring"/);
    assert.match(html, /stroke-dasharray:94\./);
    assert.match(html, /stroke-dashoffset:/);
    assert.match(html, new RegExp(`aria-label="score ${score}"`));
  }
});
