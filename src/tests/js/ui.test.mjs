import assert from 'node:assert/strict';
import test from 'node:test';

import {CONVERSATION_MODES} from '../../web/preferences.js';
import {
  coachOverviewHtml,
  correctionOverlayHtml,
  publicTurnHtml,
  replayDuration,
  replayOverlayHtml,
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

test('push-to-talk keeps learner replay and score inline inside the speech bubble', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.PUSH_TO_TALK);
  assert.match(html, /class="message-text user-message-text"/);
  assert.match(html, /data-ui-action="open-replay"/);
  assert.match(html, /data-ui-action="open-coach"/);
  assert.ok(html.indexOf('data-ui-action="open-replay"') < html.indexOf('data-ui-action="open-coach"'));
  assert.match(html, /class="score-pill score-button"/);
  assert.match(html, /<svg class="ui-svg"/);
  assert.doesNotMatch(html, />YOU</);
});

test('hands-free hides manual replay but keeps coach score and problem highlighting', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.HANDS_FREE);
  assert.doesNotMatch(html, /data-ui-action="open-replay"/);
  assert.match(html, /data-ui-action="open-coach"/);
  assert.match(html, /class="pron-problem severity-yellow">listening</);
  assert.match(html, />82<\/button>/);
});

test('coach overview renders only real pronunciation metrics and drill-down actions', () => {
  const html = coachOverviewHtml(sampleTurn(), t);
  assert.match(html, /score-hero/);
  assert.match(html, />82<small>\/100<\/small>/);
  assert.match(html, />accuracy<\/span><strong>80<\/strong>/);
  assert.match(html, />fluency<\/span><strong>85<\/strong>/);
  assert.match(html, />intonation<\/span><strong>82<\/strong>/);
  assert.match(html, /data-ui-action="open-word"/);
  assert.match(html, /data-ui-action="open-correction"/);
  assert.match(html, /Clear and easy to understand\./);

  const sparse = sampleTurn();
  delete sparse.coach.pronunciation.fluency_score;
  const sparseHtml = coachOverviewHtml(sparse, t);
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

test('replay overlay uses local PCM for waveform and duration without extra data dependency', () => {
  const turn = sampleTurn();
  assert.equal(replayDuration(turn.replayPcm), '0:02');
  const html = replayOverlayHtml(turn, t);
  assert.match(html, /class="waveform"/);
  assert.match(html, /--wave:/);
  assert.match(html, /data-audio-action="replay-user"/);
  assert.match(html, />0:02<\/span>/);
});
