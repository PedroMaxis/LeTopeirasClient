import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';

/** dBFS of an RMS level; silence maps to -100. */
export const toDb = (rms: number) => (rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100);

export interface MicOptions {
  /** Input volume, 1 = unchanged. */
  gain: number;
  /** Voice gate threshold in dBFS, or null to send everything. */
  gateDb: number | null;
}

/** Keeps the gate open this long after the voice drops, so word endings aren't cut. */
const GATE_HOLD_MS = 300;
const GATE_POLL_MS = 20;

/**
 * Microphone processing through Web Audio: input volume (can amplify) and an optional
 * voice gate that sends silence while the level stays under the threshold.
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'letopeiras-mic';
  processedTrack?: MediaStreamTrack;
  private source?: MediaStreamAudioSourceNode;
  private gainNode?: GainNode;
  private gateNode?: GainNode;
  private analyser?: AnalyserNode;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastVoiceAt = 0;

  constructor(private options: MicOptions) {}

  async init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    this.source = audioContext.createMediaStreamSource(new MediaStream([track]));
    this.gainNode = audioContext.createGain();
    this.gainNode.gain.value = this.options.gain;
    this.gateNode = audioContext.createGain();
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    const destination = audioContext.createMediaStreamDestination();
    this.source.connect(this.gainNode);
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
    this.source?.disconnect();
    this.gainNode?.disconnect();
    this.gateNode?.disconnect();
    this.processedTrack?.stop();
  }

  setOptions(options: MicOptions): void {
    this.options = options;
    if (this.gainNode) this.gainNode.gain.value = options.gain;
  }

  private updateGate(samples: Float32Array<ArrayBuffer>, context: BaseAudioContext): void {
    if (!this.analyser || !this.gateNode) return;
    const { gateDb } = this.options;
    let open = true;
    if (gateDb !== null) {
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
  options: { deviceId: string; gain: number; constraints: MediaTrackConstraints },
  onLevel: (level: number) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...options.constraints, deviceId: { ideal: options.deviceId } },
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();
  gain.gain.value = options.gain;
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(gain).connect(analyser);

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
    stream.getTracks().forEach((t) => t.stop());
    void context.close();
  };
}
