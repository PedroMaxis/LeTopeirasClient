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
    { source: MediaStreamAudioSourceNode; gain: GainNode; keeper: HTMLMediaElement }
  >();
  private sinkId = 'default';
  private masterGain = 1;

  private ensure(): { context: AudioContext; master: GainNode } {
    if (!this.context || !this.master) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = this.masterGain;
      this.master.connect(this.context.destination);
      void this.applySink();
    }
    return { context: this.context, master: this.master };
  }

  /**
   * `keeper` is the muted element LiveKit attached the track to: Chromium only feeds remote
   * WebRTC audio into Web Audio while the track is also playing in a media element.
   */
  add(id: string, track: MediaStreamTrack, keeper: HTMLMediaElement, gain: number): void {
    this.remove(id);
    const { context, master } = this.ensure();
    keeper.muted = true;
    // Something unmuting the keeper (e.g. LiveKit's Room.startAudio) would play the track a
    // second time, bypassing per-user volume and deafen.
    keeper.addEventListener('volumechange', () => {
      if (!keeper.muted) keeper.muted = true;
    });
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const gainNode = context.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode).connect(master);
    this.sources.set(id, { source, gain: gainNode, keeper });
    if (context.state === 'suspended') void context.resume();
  }

  remove(id: string): void {
    const entry = this.sources.get(id);
    if (!entry) return;
    entry.source.disconnect();
    entry.gain.disconnect();
    entry.keeper.remove();
    this.sources.delete(id);
  }

  setGain(id: string, gain: number): void {
    const entry = this.sources.get(id);
    if (entry) entry.gain.gain.value = gain;
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
  }
}
