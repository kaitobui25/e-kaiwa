import assert from 'node:assert/strict';
import test from 'node:test';

import {CONVERSATION_MODES} from '../../web/preferences.js';
import {publicTurnHtml} from '../../web/ui.js';

const translations = new Proxy({}, {get: (_target, key) => String(key)});
const t = key => translations[key];

function sampleTurn() {
  return {
    no: 1,
    userText: 'I like listening music.',
    aiText: 'What music do you like?',
    replayPcm: new Int16Array([1, 2, 3]),
    coachEligible: true,
    coach: {
      correction: 'I like listening to music.',
      explanation: 'Use “listen to”.',
      pronunciation: {
        overall_score: 82,
        problems: [{word: 'listening', sound: '/ˈlɪsənɪŋ/', tip: 'Keep the final ng.'}]
      }
    }
  };
}

function countScore(html, value) {
  return html.match(new RegExp(`>${value}<`, 'g'))?.length || 0;
}

test('push-to-talk puts replay icon then coach score inline after learner text', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.PUSH_TO_TALK);
  assert.match(html, /class="user-inline-actions"/);
  assert.match(html, /class="inline-audio-button"[^>]*data-action="replay-user"[^>]*>🔊<\/button>/);
  assert.match(html, /class="score-pill coach-toggle"[^>]*data-coach-toggle="1"/);
  assert.ok(html.indexOf('data-action="replay-user"') < html.indexOf('data-coach-toggle="1"'));
  assert.match(html, /data-coach-panel="1" hidden/);
  assert.match(html, /data-action="speak-correction"/);
  assert.match(html, /data-action="speak-problem"/);
  assert.equal(countScore(html, 82), 1);
  assert.doesNotMatch(html, />you</);
  assert.doesNotMatch(html, />coach</);
});

test('hands-free keeps inline coach score but hides every manual audio action', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.HANDS_FREE);
  assert.doesNotMatch(html, /data-action="replay-user"/);
  assert.doesNotMatch(html, /data-action="speak-correction"/);
  assert.doesNotMatch(html, /data-action="speak-problem"/);
  assert.match(html, /class="user-inline-actions"/);
  assert.match(html, /data-coach-toggle="1"/);
  assert.match(html, /I like /);
  assert.match(html, /class="pron-problem severity-yellow">listening</);
  assert.match(html, / music\./);
  assert.match(html, /I like listening to music\./);
  assert.equal(countScore(html, 82), 1);
  assert.doesNotMatch(html, />you</);
  assert.doesNotMatch(html, />coach</);
});
