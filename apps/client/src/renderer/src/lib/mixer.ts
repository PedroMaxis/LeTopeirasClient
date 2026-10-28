import { rms, toDb } from './audio';
import { DUCK_ATTACK_TC, DUCK_RELEASE_TC } from './ducking';

const LEVEL_FFT_SIZE = 512;

/**
 * Plays every remote voice and screen share audio through one AudioContext, so each source
 * can have its own volume (up to 200%, which <audio>.volume can't do) and the output device
 * is switched in one place.
 */
export class AudioMixer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly sources = new Map<
    string,
    {
      source: MediaStreamAudioSourceNode;
      gain: GainNode;
      analyser: AnalyserNode;
      keeper: HTMLMediaElement;
    }
  >();
  private samples = new Float32Array(LEVEL_FFT_SIZE);
  private sinkId = 'default';
  private masterGain = 1;
  /** Screen share audio goes through this one, so it alone can be ducked. */
  private shareBus: GainNode | null = null;
  private duck = 1;
  private localSound: AudioBufferSourceNode | null = null;

  private ensure(): { context: AudioContext; master: GainNode; shareBus: GainNode } {
    if (!this.context || !this.master) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = this.masterGain;
      this.master.connect(this.context.destination);
      this.shareBus = this.context.createGain();
      this.shareBus.gain.value = this.duck;
      this.shareBus.connect(this.master);
      void this.applySink();
    }
    return { context: this.context, master: this.master, shareBus: this.shareBus as GainNode };
  }

  /**
   * `keeper` is the muted element LiveKit attached the track to: Chromium only feeds remote
   * WebRTC audio into Web Audio while the track is also playing in a media element.
   */
  add(
    id: string,
    track: MediaStreamTrack,
    keeper: HTMLMediaElement,
    gain: number,
    screen = false,
  ): void {
    this.remove(id);
    const { context, master, shareBus } = this.ensure();
    keeper.muted = true;
    // Something unmuting the keeper (e.g. LiveKit's Room.startAudio) would play the track a
    // second time, bypassing per-user volume and deafen.
    keeper.addEventListener('volumechange', () => {
      if (!keeper.muted) keeper.muted = true;
    });
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const gainNode = context.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode).connect(screen ? shareBus : master);
    // Before the gain, so per-user volume and deafen don't change who looks like speaking.
    const analyser = context.createAnalyser();
    analyser.fftSize = LEVEL_FFT_SIZE;
    source.connect(analyser);
    this.sources.set(id, { source, gain: gainNode, analyser, keeper });
    if (context.state === 'suspended') void context.resume();
  }

  remove(id: string): void {
    const entry = this.sources.get(id);
    if (!entry) return;
    entry.source.disconnect();
    entry.gain.disconnect();
    entry.analyser.disconnect();
    entry.keeper.remove();
    this.sources.delete(id);
  }

  /** Current level of a source in dBFS (-100 when silent or unknown). */
  level(id: string): number {
    const entry = this.sources.get(id);
    if (!entry) return -100;
    entry.analyser.getFloatTimeDomainData(this.samples);
    return toDb(rms(this.samples));
  }

  setGain(id: string, gain: number): void {
    const entry = this.sources.get(id);
    if (entry) entry.gain.gain.value = gain;
  }

  /** Scales every screen share by `factor` (1 = not ducked), easing in ~100 ms / out ~600 ms. */
  setShareDuck(factor: number): void {
    const down = factor < this.duck;
    this.duck = factor;
    if (!this.context || !this.shareBus) return;
    this.shareBus.gain.setTargetAtTime(
      factor,
      this.context.currentTime,
      down ? DUCK_ATTACK_TC : DUCK_RELEASE_TC,
    );
  }

  /** Plays a soundboard sound for us (the room hears it through the mic). One at a time. */
  playLocal(buffer: AudioBuffer, volume: number): void {
    const { context, master } = this.ensure();
    try {
      this.localSound?.stop();
    } catch {
      // Already finished.
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(master);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    if (context.state === 'suspended') void context.resume();
    source.start();
    this.localSound = source;
  }

  setMasterGain(gain: number): void {
    this.masterGain = gain;
    if (this.master) this.master.gain.value = gain;
  }

  async setSinkId(deviceId: string): Promise<void> {
    this.sinkId = deviceId;
    await this.applySink();
  }

  private async applySink(): Promise<void> {
    const ctx = this.context as (AudioContext & { setSinkId?(id: string): Promise<void> }) | null;
    await ctx?.setSinkId?.(this.sinkId === 'default' ? '' : this.sinkId).catch(() => undefined);
  }

  close(): void {
    for (const id of [...this.sources.keys()]) this.remove(id);
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.shareBus = null;
  }
}
