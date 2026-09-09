import assert from 'node:assert/strict';
import test from 'node:test';

import {PlaybackCoordinator} from '../../web/audio.js';

function fakeAudioContext() {
  const sources = [];
  return {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: async () => {},
    createBuffer(_channels, length, sampleRate) {
      return {duration: length / sampleRate, copyToChannel() {}};
    },
    createBufferSource() {
      const source = {
        playbackRate: {value: 1},
        buffer: null,
        onended: null,
        connect() {},
        disconnect() {},
        start(when = 0) { source.startedAt = when; },
        stop() { source.onended?.(); }
      };
      sources.push(source);
      return source;
    },
    sources
  };
}

test('manual speech blocks microphone forwarding only for playback lifetime', async () => {
  const changes = [];
  const speechService = {
    cancel() {},
    async speak(text, options) {
      assert.equal(text, 'hello');
      assert.equal(options.lang, 'en-US');
      return true;
    }
  };
  const coordinator = new PlaybackCoordinator({
    speechService,
    getEchoGuardMs: () => 0,
    onBlockedChange: blocked => changes.push(blocked)
  });

  assert.equal(await coordinator.speak('hello', {lang: 'en-US'}), true);
  assert.deepEqual(changes, [true, false]);
  assert.equal(coordinator.busy, false);
});

test('live PCM queue owns playback timing and blocks input', async () => {
  const context = fakeAudioContext();
  const changes = [];
  const coordinator = new PlaybackCoordinator({
    audioContextFactory: () => context,
    getEchoGuardMs: () => 250,
    onBlockedChange: blocked => changes.push(blocked)
  });
  await coordinator.ensureContext();

  const pcmBytes = new Uint8Array([0, 0, 0, 0]);
  const base64 = Buffer.from(pcmBytes).toString('base64');
  assert.equal(coordinator.queueLivePcm(base64, 0.8), true);
  assert.equal(changes[0], true);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].playbackRate.value, 0.8);
  assert.ok(coordinator.livePlaybackRemainingMs > 0);

  coordinator.clear();
  assert.equal(coordinator.liveSources.size, 0);
  assert.equal(changes.at(-1), false);
});
