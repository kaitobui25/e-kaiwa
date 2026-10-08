// Lightweight local VAD; segmentation is only a best-effort audio/transcript
// alignment hint, not a source of linguistic judgments.
export class SilentSegmenter {
  constructor(onSegment, {sampleRate = 16000, silenceMs = 850, maxMs = 20000} = {}) {
    this.onSegment = onSegment;
    this.sampleRate = sampleRate;
    this.silenceFrames = Math.round(sampleRate * silenceMs / 1000);
    this.maxFrames = Math.round(sampleRate * maxMs / 1000);
    this.preRollFrames = Math.round(sampleRate * 0.25);
    this.reset();
  }

  reset() {
    this.chunks = [];
    this.frames = 0;
    this.quiet = 0;
    this.speechFrames = 0;
    this.preRoll = [];
    this.preRollLength = 0;
  }

  feed(pcm) {
    if (!(pcm instanceof Int16Array) || !pcm.length) return;
    const chunk = new Int16Array(pcm);
    let energy = 0;
    for (const sample of chunk) energy += sample * sample;
    const speaking = Math.sqrt(energy / chunk.length) / 32768 >= 0.012;

    if (!this.frames) {
      this.preRoll.push(chunk);
      this.preRollLength += chunk.length;
      while (this.preRoll.length > 1 && this.preRollLength > this.preRollFrames) {
        this.preRollLength -= this.preRoll.shift().length;
      }
      if (!speaking) return;
      this.chunks = this.preRoll;
      this.frames = this.preRollLength;
      this.preRoll = [];
      this.preRollLength = 0;
    } else {
      this.chunks.push(chunk);
      this.frames += chunk.length;
    }

    if (speaking) {
      this.speechFrames += chunk.length;
      this.quiet = 0;
    } else {
      this.quiet += chunk.length;
    }
    if (this.quiet >= this.silenceFrames || this.frames >= this.maxFrames) this.flush();
  }

  flush() {
    if (!this.frames) return;
    const frames = this.frames;
    const pcm = new Int16Array(frames);
    let cursor = 0;
    for (const chunk of this.chunks) {
      pcm.set(chunk, cursor);
      cursor += chunk.length;
    }
    const keep = this.speechFrames >= this.sampleRate * 0.20;
    this.reset();
    if (keep) this.onSegment(pcm);
  }
}
