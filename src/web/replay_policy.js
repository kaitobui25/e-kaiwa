export const MIN_REPLAY_SAMPLES = 800;

export function hasPlayableReplay(turn) {
  const pcm = turn?.replayPcm;
  return pcm instanceof Int16Array && pcm.length >= MIN_REPLAY_SAMPLES;
}
