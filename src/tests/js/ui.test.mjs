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

test('push-to-talk keeps audio actions but uses one compact score entry', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.PUSH_TO_TALK);
  assert.match(html, /data-action="replay-user"/);
  assert.match(html, /data-action="speak-correction"/);
  assert.match(html, /data-action="speak-problem"/);
  assert.equal(countScore(html, 82), 1);
  assert.doesNotMatch(html, />you</);
  assert.doesNotMatch(html, />coach</);
});

test('hands-free shows sentence plus one clickable score and no manual audio actions', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.HANDS_FREE);
  assert.doesNotMatch(html, /data-action="replay-user"/);
  assert.doesNotMatch(html, /data-action="speak-correction"/);
  assert.doesNotMatch(html, /data-action="speak-problem"/);
  assert.match(html, /I like /);
  assert.match(html, /class="pron-problem severity-yellow">listening</);
  assert.match(html, / music\./);
  assert.match(html, /I like listening to music\./);
  assert.equal(countScore(html, 82), 1);
  assert.doesNotMatch(html, />you</);
  assert.doesNotMatch(html, />coach</);
});
