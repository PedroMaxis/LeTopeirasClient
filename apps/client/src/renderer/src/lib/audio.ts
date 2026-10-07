import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { createNoiseSuppressor, NOISE_SAMPLE_RATE } from './noise';

/** dBFS of an RMS level; silence maps to -100. */
export const toDb = (rms: number) => (rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100);

export interface MicOptions {
  /** Input volume, 1 = unchanged. */
  gain: number;
  /** Voice gate threshold in dBFS, or null to send everything. */
  gateDb: number | null;
  /** Push-to-talk: only send while the key is held (see `setPushToTalkDown`). Overrides the gate. */
  pushToTalk: boolean;
  /** RNNoise before everything else. The context must run at NOISE_SAMPLE_RATE. */
  rnnoise: boolean;
}

/** Keeps the gate open this long after the voice drops, so word endings aren't cut. */
const GATE_HOLD_MS = 300;
const GATE_POLL_MS = 20;
/** Same idea for push-to-talk: keep sending briefly after the key is released. */
const PTT_RELEASE_MS = 200;

/**
 * Microphone processing through Web Audio: optional RNNoise, input volume (can amplify) and
 * an optional gate that sends silence while the level stays under the threshold, or while
 * the push-to-talk key is up.
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'letopeiras-mic';
  processedTrack?: MediaStreamTrack;
  private source?: MediaStreamAudioSourceNode;
  private context?: AudioContext;
  private noise: RnnoiseWorkletNode | undefined;
  private gainNode?: GainNode;
  private gateNode?: GainNode;
  private analyser?: AnalyserNode;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastVoiceAt = 0;
  private pttDown = false;
  private pttReleasedAt = 0;

  constructor(private options: MicOptions) {}

  async init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    this.context = audioContext;
    this.source = audioContext.createMediaStreamSource(new MediaStream([track]));
    this.gainNode = audioContext.createGain();
    this.gainNode.gain.value = this.options.gain;
    this.gateNode = audioContext.createGain();
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    const destination = audioContext.createMediaStreamDestination();
    await this.wireInput();
    this.gainNode.connect(this.analyser);
    this.gainNode.connect(this.gateNode).connect(destination);
    const [processed] = destination.stream.getAudioTracks();
    if (processed) this.processedTrack = processed;

    const samples = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => this.updateGate(samples, audioContext), GATE_POLL_MS);
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    clearInterval(this.timer);
    this.dropNoise();
    this.source?.disconnect();
    this.gainNode?.disconnect();
    this.gateNode?.disconnect();
    this.processedTrack?.stop();
  }

  setOptions(options: MicOptions): void {
    const rewire = options.rnnoise !== this.options.rnnoise;
    this.options = options;
    if (this.gainNode) this.gainNode.gain.value = options.gain;
    if (rewire) void this.wireInput();
  }

  /** source → [RNNoise] → gain. Only the input side changes, so processedTrack stays the same. */
  private async wireInput(): Promise<void> {
    const { source, gainNode, context } = this;
    if (!source || !gainNode || !context) return;
    const noise = this.options.rnnoise ? await createNoiseSuppressor(context) : undefined;
    // Options or the track may have changed while the worklet loaded.
    if (this.source !== source || Boolean(noise) !== this.options.rnnoise) {
      noise?.destroy();
      return;
    }
    source.disconnect();
    this.dropNoise();
    if (noise) {
      this.noise = noise;
      source.connect(noise).connect(gainNode);
    } else {
      source.connect(gainNode);
    }
  }

  private dropNoise(): void {
    this.noise?.disconnect();
    this.noise?.destroy();
    this.noise = undefined;
  }

  setPushToTalkDown(down: boolean): void {
    if (this.pttDown && !down) this.pttReleasedAt = performance.now();
    this.pttDown = down;
  }

  private updateGate(samples: Float32Array<ArrayBuffer>, context: BaseAudioContext): void {
    if (!this.analyser || !this.gateNode) return;
    const { gateDb, pushToTalk } = this.options;
    let open = true;
    if (pushToTalk) {
      open = this.pttDown || performance.now() - this.pttReleasedAt < PTT_RELEASE_MS;
    } else if (gateDb !== null) {
      this.analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const now = performance.now();
      if (toDb(Math.sqrt(sum / samples.length)) >= gateDb) this.lastVoiceAt = now;
      open = now - this.lastVoiceAt < GATE_HOLD_MS;
    }
    // Short ramps avoid clicks when the gate opens or closes.
    this.gateNode.gain.setTargetAtTime(open ? 1 : 0, context.currentTime, open ? 0.005 : 0.05);
  }
}

/** Meter position 0..1 for -60..0 dBFS (the range the settings meter shows). */
export const levelFromDb = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));

/**
 * Opens the microphone and reports its level (0..1) about 30 times a second, for the
 * "Teste de microfone" meter. Returns a function that stops everything.
 */
export async function startMicMeter(
  options: {
    deviceId: string;
    gain: number;
    constraints: MediaTrackConstraints;
    rnnoise: boolean;
  },
  onLevel: (level: number) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...options.constraints, deviceId: { ideal: options.deviceId } },
  });
  const context = new AudioContext({ sampleRate: NOISE_SAMPLE_RATE });
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();
  gain.gain.value = options.gain;
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  let noise: Awaited<ReturnType<typeof createNoiseSuppressor>> | undefined;
  try {
    if (options.rnnoise) noise = await createNoiseSuppressor(context);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void context.close();
    throw err;
  }
  (noise ? source.connect(noise) : source).connect(gain).connect(analyser);

  const samples = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    const rms = Math.sqrt(sum / samples.length);
    onLevel(levelFromDb(toDb(rms)));
  }, 33);

  return () => {
    clearInterval(timer);
    noise?.destroy();
    stream.getTracks().forEach((t) => t.stop());
    void context.close();
  };
}
