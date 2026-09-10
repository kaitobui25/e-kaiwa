import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PlaybackCoordinator,
  microphoneCaptureReusable,
  pauseMicrophoneCapture,
  releaseMicrophoneCapture,
  resumeMicrophoneCapture
} from '../../web/audio.js';

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

function fakeMicCapture() {
  const calls = {resume: 0, suspend: 0, close: 0, stop: 0, sourceDisconnect: 0, processorDisconnect: 0};
  const track = {
    enabled: true,
    readyState: 'live',
    stop() { calls.stop += 1; track.readyState = 'ended'; }
  };
  const context = {
    state: 'running',
    async resume() { calls.resume += 1; context.state = 'running'; },
    async suspend() { calls.suspend += 1; context.state = 'suspended'; },
    async close() { calls.close += 1; context.state = 'closed'; }
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track]
  };
  const source = {disconnect() { calls.sourceDisconnect += 1; }};
  const processor = {disconnect() { calls.processorDisconnect += 1; }};
  return {calls, track, context, stream, source, processor};
}

function pcmBase64() {
  return Buffer.from(new Uint8Array([0, 0, 0, 0])).toString('base64');
}

test('microphone pause keeps granted capture reusable without stopping tracks', async () => {
  const capture = fakeMicCapture();
  assert.equal(microphoneCaptureReusable(capture), true);

  pauseMicrophoneCapture(capture);
  await Promise.resolve();
  assert.equal(capture.track.enabled, false);
  assert.equal(capture.calls.suspend, 1);
  assert.equal(capture.calls.stop, 0);
  assert.equal(microphoneCaptureReusable(capture), true);

  assert.equal(await resumeMicrophoneCapture(capture), true);
  assert.equal(capture.track.enabled, true);
  assert.equal(capture.calls.resume, 1);
});

test('microphone release is reserved for page teardown and destroys capture', async () => {
  const capture = fakeMicCapture();
  releaseMicrophoneCapture(capture);
  await Promise.resolve();

  assert.equal(capture.track.enabled, false);
  assert.equal(capture.calls.stop, 1);
  assert.equal(capture.calls.sourceDisconnect, 1);
  assert.equal(capture.calls.processorDisconnect, 1);
  assert.equal(capture.calls.close, 1);
  assert.equal(microphoneCaptureReusable(capture), false);
});

test('ended microphone tracks are not reusable', () => {
  const capture = fakeMicCapture();
  capture.track.readyState = 'ended';
  assert.equal(microphoneCaptureReusable(capture), false);
});

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

  assert.equal(coordinator.queueLivePcm(pcmBase64(), 0.8), true);
  assert.equal(changes[0], true);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].playbackRate.value, 0.8);
  assert.ok(coordinator.livePlaybackRemainingMs > 0);

  coordinator.clear();
  assert.equal(coordinator.liveSources.size, 0);
  assert.equal(changes.at(-1), false);
});

test('echo guard counts as live playback and rejects manual replay during guard', async () => {
  const context = fakeAudioContext();
  let speechCalls = 0;
  const coordinator = new PlaybackCoordinator({
    audioContextFactory: () => context,
    speechService: {
      cancel() {},
      async speak() { speechCalls += 1; return true; }
    },
    getEchoGuardMs: () => 20
  });
  await coordinator.ensureContext();
  coordinator.queueLivePcm(pcmBase64(), 1);
  context.sources[0].onended?.();
  context.currentTime = 1;

  let armed = false;
  coordinator.armAfterLive(() => { armed = true; });
  assert.equal(coordinator.livePlaying, true);
  assert.equal(await coordinator.speak('should not play'), false);
  assert.equal(speechCalls, 0);

  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(armed, true);
  assert.equal(coordinator.blocked, false);
});

test('live output taking over manual playback cannot be unblocked by stale manual cleanup', async () => {
  const context = fakeAudioContext();
  let resolveSpeech = null;
  const speechService = {
    cancel() { resolveSpeech?.(false); },
    speak() {
      return new Promise(resolve => { resolveSpeech = resolve; });
    }
  };
  const coordinator = new PlaybackCoordinator({
    audioContextFactory: () => context,
    speechService,
    getEchoGuardMs: () => 0
  });
  await coordinator.ensureContext();

  const manualPromise = coordinator.speak('manual');
  await Promise.resolve();
  assert.equal(coordinator.blockReason, 'manual');

  coordinator.queueLivePcm(pcmBase64(), 1);
  await manualPromise;
  assert.equal(coordinator.blockReason, 'live');
  assert.equal(coordinator.blocked, true);

  coordinator.clear();
  assert.equal(coordinator.blocked, false);
});

test('new manual playback cannot be unblocked by stale cleanup from the replaced playback', async () => {
  const context = fakeAudioContext();
  const changes = [];
  const coordinator = new PlaybackCoordinator({
    audioContextFactory: () => context,
    getEchoGuardMs: () => 0,
    onBlockedChange: (blocked, reason) => changes.push([blocked, reason])
  });
  await coordinator.ensureContext();

  const first = coordinator.playUserPcm(new Int16Array([1, 2]), 16000);
  await Promise.resolve();
  assert.equal(coordinator.blockReason, 'manual');
  assert.equal(context.sources.length, 1);

  const second = coordinator.playUserPcm(new Int16Array([3, 4]), 16000);
  await Promise.resolve();
  await first;

  assert.equal(context.sources.length, 2);
  assert.equal(coordinator.blockReason, 'manual');
  assert.equal(coordinator.manualPlaying, true);

  context.sources[1].onended?.();
  assert.equal(await second, true);
  assert.equal(coordinator.blocked, false);
  assert.deepEqual(changes.at(-1), [false, 'manual']);
});
