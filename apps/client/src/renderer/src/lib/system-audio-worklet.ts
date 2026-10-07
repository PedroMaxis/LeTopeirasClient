// AudioWorklet that plays the PCM blocks coming from the native capture (main process).
// Blocks arrive on a MessagePort transferred straight into this thread, so the renderer's
// main thread never touches the audio. Input: interleaved float32 stereo, 48 kHz.

// Minimal AudioWorkletGlobalScope typings (not part of the DOM lib).
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const CHANNELS = 2;
/** Start playing once this much is buffered, to ride out IPC jitter. */
const PRIME_MS = 40;
/** If we fall this far behind (e.g. after a hiccup), skip ahead to keep latency low. */
const MAX_LATENCY_MS = 200;
const TARGET_LATENCY_MS = 60;
const CAPACITY_MS = 500;

class PcmPlayer extends AudioWorkletProcessor {
  private readonly ring = new Float32Array(Math.ceil((sampleRate * CAPACITY_MS) / 1000) * CHANNELS);
  private readonly capacityFrames = this.ring.length / CHANNELS;
  private readIndex = 0; // in frames
  private buffered = 0; // in frames
  private primed = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ port: MessagePort }>) => {
      event.data.port.onmessage = (block: MessageEvent<Float32Array>) => this.write(block.data);
    };
  }

  private write(block: Float32Array): void {
    const frames = block.length / CHANNELS;
    if (this.buffered + frames > this.capacityFrames) {
      // Overflow: drop the oldest audio.
      const drop = this.buffered + frames - this.capacityFrames;
      this.readIndex = (this.readIndex + drop) % this.capacityFrames;
      this.buffered -= drop;
    }
    let writeFrame = (this.readIndex + this.buffered) % this.capacityFrames;
    for (let i = 0; i < frames; i++) {
      this.ring[writeFrame * CHANNELS] = block[i * CHANNELS] ?? 0;
      this.ring[writeFrame * CHANNELS + 1] = block[i * CHANNELS + 1] ?? 0;
      writeFrame = (writeFrame + 1) % this.capacityFrames;
    }
    this.buffered += frames;

    const maxFrames = (sampleRate * MAX_LATENCY_MS) / 1000;
    if (this.buffered > maxFrames) {
      const skip = this.buffered - (sampleRate * TARGET_LATENCY_MS) / 1000;
      this.readIndex = (this.readIndex + skip) % this.capacityFrames;
      this.buffered -= skip;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1];
    if (!left || !right) return true;
    const frames = left.length;

    if (!this.primed && this.buffered >= (sampleRate * PRIME_MS) / 1000) this.primed = true;
    if (!this.primed || this.buffered < frames) {
      // Underrun: output silence and wait to build the buffer up again.
      this.primed = false;
      left.fill(0);
      right.fill(0);
      return true;
    }

    for (let i = 0; i < frames; i++) {
      left[i] = this.ring[this.readIndex * CHANNELS] ?? 0;
      right[i] = this.ring[this.readIndex * CHANNELS + 1] ?? 0;
      this.readIndex = (this.readIndex + 1) % this.capacityFrames;
    }
    this.buffered -= frames;
    return true;
  }
}

registerProcessor('letopeiras-pcm-player', PcmPlayer);

// Keeps the declarations above local to this module.
export {};
