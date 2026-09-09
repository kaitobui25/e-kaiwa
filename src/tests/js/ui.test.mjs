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

test('push-to-talk turn keeps learner replay and Coach audio actions', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.PUSH_TO_TALK);
  assert.match(html, /data-action="replay-user"/);
  assert.match(html, /data-action="speak-correction"/);
  assert.match(html, /data-action="speak-problem"/);
  assert.match(html, />82</);
});

test('hands-free turn hides every manual audio action but keeps Coach text and score', () => {
  const html = publicTurnHtml(sampleTurn(), t, true, CONVERSATION_MODES.HANDS_FREE);
  assert.doesNotMatch(html, /data-action="replay-user"/);
  assert.doesNotMatch(html, /data-action="speak-correction"/);
  assert.doesNotMatch(html, /data-action="speak-problem"/);
  assert.match(html, /I like listening to music\./);
  assert.match(html, /listening/);
  assert.match(html, />82</);
});
