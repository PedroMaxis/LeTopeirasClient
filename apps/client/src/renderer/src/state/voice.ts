import {
  ConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  type LocalTrack,
  type LocalVideoTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import { errorMessage, type Api } from '../lib/api';
import { MicProcessor, type MicOptions } from '../lib/audio';
import { logEvent, watchShareStats } from '../lib/diagnostics';
import { NOISE_SAMPLE_RATE } from '../lib/noise';
import {
  applyShareMode,
  audioCaptureOptions,
  roomOptions,
  screenAudioPublishOptions,
  screenCaptureOptions,
  screenPublishOptions,
  type ShareMode,
  type ShareQuality,
} from '../lib/media';
import { AudioMixer } from '../lib/mixer';
import { settings, updateSettings, type Settings } from '../lib/settings';
import { playSound } from '../lib/sounds';
import { Store } from '../lib/store';
import { startSystemAudio, type SystemAudio } from '../lib/system-audio';
import { showToast } from '../lib/toast';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export interface VoiceState {
  channelId: number | null;
  status: VoiceStatus;
  room: Room | null;
  muted: boolean;
  deafened: boolean;
  screenTrack: LocalVideoTrack | null;
  shareMode: ShareMode;
  shareQuality: ShareQuality;
  /** Whether to send PC audio with the next screen share (picker toggle). */
  shareAudio: boolean;
  /** Our own share is sending audio. */
  sharingAudio: boolean;
  /** Identities whose screen share audio we muted locally. */
  mutedShares: ReadonlySet<string>;
  /** Identities whose screen share we stopped watching (unsubscribed until they share again). */
  unwatchedShares: ReadonlySet<string>;
  /** Round trip to the LiveKit server, for the "Voz conectada" panel. */
  pingMs: number | null;
  /** Bumped on every LiveKit event that can change what the UI shows. */
  version: number;
}

const RERENDER_EVENTS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.ParticipantNameChanged,
] as const;

const MAX_REJOIN_ATTEMPTS = 3;

const isShareSource = (source: Track.Source) =>
  source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio;

/** Owns the LiveKit room of the voice channel we are in (at most one). */
export class VoiceClient {
  readonly store = new Store<VoiceState>({
    channelId: null,
    status: 'idle',
    room: null,
    muted: false,
    deafened: false,
    screenTrack: null,
    shareMode: settings.get().defaultShareMode,
    shareQuality: settings.get().defaultShareQuality,
    shareAudio: true,
    sharingAudio: false,
    mutedShares: new Set(),
    unwatchedShares: new Set(),
    pingMs: null,
    version: 0,
  });

  private readonly audioContainer = document.createElement('div');
  private readonly mixer = new AudioMixer();
  /** Remote audio in the mixer, tagged so volumes apply per participant and per source. */
  private readonly audioSources = new Map<string, { identity: string; screen: boolean }>();
  private systemAudio: { capture: SystemAudio; track: LocalTrack } | null = null;
  private micProcessor: MicProcessor | null = null;
  private audioContext: AudioContext | null = null;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private unsubscribeSettings: () => void;
  private unsubscribePushToTalk: () => void;
  /** Push-to-talk key state from main; kept here so a new mic processor starts in sync. */
  private pttDown = false;
  private joinSeq = 0;

  constructor(
    private readonly api: Api,
    private readonly reportState: (muted: boolean, deafened: boolean) => void,
  ) {
    this.audioContainer.hidden = true;
    document.body.appendChild(this.audioContainer);
    let previous = settings.get();
    this.unsubscribeSettings = settings.subscribe(() => {
      const next = settings.get();
      void this.applySettings(previous, next);
      previous = next;
    });
    this.unsubscribePushToTalk = window.api.onPushToTalk((down) => {
      this.pttDown = down;
      this.micProcessor?.setPushToTalkDown(down);
    });
  }

  get state(): VoiceState {
    return this.store.get();
  }

  async join(channelId: number, attempt = 0): Promise<void> {
    if (this.state.channelId === channelId && this.state.status !== 'idle' && attempt === 0) return;
    await this.leave();
    const seq = ++this.joinSeq;
    this.store.set({ channelId, status: attempt ? 'reconnecting' : 'connecting' });

    const room = new Room(roomOptions(settings.get()));
    try {
      const { url, token } = await this.api.voiceToken(channelId);
      if (seq !== this.joinSeq) return;
      this.bindRoom(room, channelId, attempt);
      await room.connect(url, token);
    } catch (err) {
      await room.disconnect();
      if (seq !== this.joinSeq) return;
      this.reset();
      showToast(`Não foi possível entrar no canal de voz: ${errorMessage(err)}`);
      return;
    }
    if (seq !== this.joinSeq) {
      await room.disconnect();
      return;
    }

    this.store.set({ room, status: 'connected' });
    if (attempt === 0) playSound('join');
    // No room.startAudio(): Electron doesn't block autoplay, and startAudio unmutes every
    // attached element, which would play voices a second time outside the mixer.
    await this.mixer.setSinkId(settings.get().outputDeviceId);
    await this.syncMicrophone();
    await this.syncPushToTalk(settings.get());
    this.applyOutput();
    this.reportState(this.state.muted, this.state.deafened);
    this.pingTimer = setInterval(() => {
      const rtt = room.engine.client.rtt;
      this.store.set({ pingMs: rtt > 0 ? Math.round(rtt) : null });
    }, 2000);
  }

  async leave(): Promise<void> {
    this.joinSeq++;
    const { room } = this.state;
    if (room) playSound('leave');
    this.reset();
    await room?.disconnect();
  }

  async toggleMute(): Promise<void> {
    // Unmuting while deafened also undeafens, like Discord.
    const muted = !this.state.muted;
    this.store.set(muted ? { muted } : { muted, deafened: false });
    playSound(muted ? 'mute' : 'unmute');
    await this.afterSelfChange();
  }

  async toggleDeafen(): Promise<void> {
    const deafened = !this.state.deafened;
    this.store.set({ deafened });
    playSound(deafened ? 'deafen' : 'undeafen');
    await this.afterSelfChange();
  }

  /** Someone's voice volume for us, 0–200 %. Saved per user. */
  setUserVolume(userId: number, volume: number): void {
    updateSettings({ userVolumes: { ...settings.get().userVolumes, [userId]: volume } });
  }

  async startScreenShare(
    sourceId: string,
    mode: ShareMode,
    quality: ShareQuality,
    withAudio: boolean,
  ): Promise<void> {
    const { room } = this.state;
    if (!room) return;
    await this.stopScreenShare();
    this.store.set({ shareMode: mode, shareQuality: quality, shareAudio: withAudio });
    try {
      await window.api.selectScreenSource(sourceId);
      const tracks = await room.localParticipant.createScreenTracks(
        screenCaptureOptions(mode, quality),
      );
      const video = tracks.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
      if (!video) throw new Error('nenhuma trilha de vídeo foi capturada');
      // Sharing can also end outside the app (window closed, display unplugged).
      video.once(TrackEvent.Ended, () => {
        logEvent('share.ended');
        void this.stopScreenShare();
      });
      const options = screenPublishOptions(mode, quality, settings.get().preferH264);
      await room.localParticipant.publishTrack(video, options);
      this.store.set({ screenTrack: video });
      playSound('streamStart');
      logEvent('share.start', {
        kind: sourceId.split(':')[0],
        mode,
        quality,
        codec: options.videoCodec,
        simulcast: options.simulcast,
        audio: withAudio,
      });
      watchShareStats(video, () => this.state.screenTrack === video);
    } catch (err) {
      logEvent('share.error', { error: errorMessage(err) });
      showToast(`Não foi possível compartilhar a tela: ${errorMessage(err)}`);
      return;
    }
    if (withAudio) await this.startShareAudio(room, sourceId);
  }

  async stopScreenShare(): Promise<void> {
    const { room, screenTrack } = this.state;
    await this.stopShareAudio();
    if (!screenTrack) return;
    this.store.set({ screenTrack: null });
    playSound('streamStop');
    logEvent('share.stop');
    await room?.localParticipant.unpublishTrack(screenTrack, true);
  }

  /** Someone's screen share audio volume for us, 0–200 %. Saved per user. */
  setShareVolume(userId: number, volume: number): void {
    updateSettings({ shareVolumes: { ...settings.get().shareVolumes, [userId]: volume } });
  }

  /**
   * Stops or resumes watching someone's screen share. A remote share is unsubscribed (video
   * and audio), so it costs no bandwidth; our own just stops showing the preview.
   */
  setWatching(identity: string, watching: boolean): void {
    this.store.set((s) => {
      const unwatchedShares = new Set(s.unwatchedShares);
      if (watching) unwatchedShares.delete(identity);
      else unwatchedShares.add(identity);
      return { unwatchedShares };
    });
    const participant = this.state.room?.remoteParticipants.get(identity);
    for (const source of [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]) {
      participant?.getTrackPublication(source)?.setSubscribed(watching);
    }
  }

  /** Mutes or unmutes, for us only, the audio of someone's screen share. */
  toggleShareAudio(identity: string): void {
    this.store.set((s) => {
      const mutedShares = new Set(s.mutedShares);
      if (!mutedShares.delete(identity)) mutedShares.add(identity);
      return { mutedShares };
    });
    this.applyOutput();
  }

  // Failing here keeps the video share going; only the audio is missing.
  private async startShareAudio(room: Room, sourceId: string): Promise<void> {
    let capture: SystemAudio;
    try {
      capture = await startSystemAudio(sourceId);
    } catch (err) {
      logEvent('share.audio-error', { error: errorMessage(err) });
      showToast(`Transmitindo sem áudio: ${errorMessage(err)}`, 'info');
      return;
    }
    try {
      const publication = await room.localParticipant.publishTrack(
        capture.track,
        screenAudioPublishOptions,
      );
      if (!publication.track) throw new Error('a trilha não foi publicada');
      this.systemAudio = { capture, track: publication.track };
      this.store.set({ sharingAudio: true });
    } catch (err) {
      logEvent('share.audio-error', { error: errorMessage(err) });
      capture.stop();
      showToast(`Transmitindo sem áudio: ${errorMessage(err)}`, 'info');
    }
  }

  private async stopShareAudio(): Promise<void> {
    const systemAudio = this.systemAudio;
    if (!systemAudio) return;
    this.systemAudio = null;
    this.store.set({ sharingAudio: false });
    systemAudio.capture.stop();
    await this.state.room?.localParticipant.unpublishTrack(systemAudio.track, true);
  }

  async setShareMode(mode: ShareMode): Promise<void> {
    this.store.set({ shareMode: mode });
    const { screenTrack } = this.state;
    if (screenTrack) await applyShareMode(screenTrack, mode);
  }

  dispose(): void {
    this.unsubscribeSettings();
    this.unsubscribePushToTalk();
    void this.leave();
    this.mixer.close();
    this.audioContainer.remove();
  }

  // -------------------------------------------------------------------------

  private bindRoom(room: Room, channelId: number, attempt: number): void {
    const bump = () => this.store.set((s) => ({ version: s.version + 1 }));
    // ActiveSpeakersChanged covers isSpeaking for everyone, including us.
    for (const event of RERENDER_EVENTS) room.on(event, bump);

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const tag = {
          identity: participant.identity,
          screen: publication.source === Track.Source.ScreenShareAudio,
        };
        const keeper = track.attach();
        this.audioContainer.appendChild(keeper);
        this.audioSources.set(publication.trackSid, tag);
        this.mixer.add(publication.trackSid, track.mediaStreamTrack, keeper, this.gainFor(tag));
      },
    );
    room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (track.kind !== Track.Kind.Audio) return;
        track.detach();
        this.audioSources.delete(publication.trackSid);
        this.mixer.remove(publication.trackSid);
      },
    );
    room.on(RoomEvent.ParticipantConnected, () => playSound('userJoin'));
    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      playSound('userLeave');
      if (this.isUnwatched(participant.identity)) this.forgetUnwatched(participant.identity);
    });
    room.on(
      RoomEvent.TrackPublished,
      (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (publication.source === Track.Source.ScreenShare) playSound('streamStart');
        // Share audio published after we stopped watching (or a resumed connection) stays off.
        if (isShareSource(publication.source) && this.isUnwatched(participant.identity)) {
          publication.setSubscribed(false);
        }
      },
    );
    room.on(
      RoomEvent.TrackUnpublished,
      (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (publication.source !== Track.Source.ScreenShare) return;
        playSound('streamStop');
        // Their next share starts watched again.
        if (this.isUnwatched(participant.identity)) this.forgetUnwatched(participant.identity);
      },
    );

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (this.state.room !== room) return;
      if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
        this.store.set({ status: 'reconnecting' });
      } else if (state === ConnectionState.Connected) {
        this.store.set({ status: 'connected' });
      }
    });

    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (this.state.room !== room) return;
      logEvent('voice.disconnected', { reason, attempt });
      if (reason === undefined || reason === DisconnectReason.CLIENT_INITIATED) return;
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        this.reset();
        showToast('Você entrou nesse canal de voz em outro lugar.', 'info');
        return;
      }
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        // The server removes people who lost access to a private channel.
        this.reset();
        playSound('leave');
        showToast('Você foi removido do canal de voz.', 'info');
        return;
      }
      if (reason === DisconnectReason.ROOM_DELETED || attempt >= MAX_REJOIN_ATTEMPTS) {
        this.reset();
        playSound('disconnect');
        showToast('A conexão de voz caiu.');
        return;
      }
      // LiveKit gave up on resuming; start over with a fresh token.
      setTimeout(() => void this.join(channelId, attempt + 1), 1000 * (attempt + 1));
    });
  }

  private reset(): void {
    this.systemAudio?.capture.stop();
    this.systemAudio = null;
    clearInterval(this.pingTimer);
    for (const id of this.audioSources.keys()) this.mixer.remove(id);
    this.audioSources.clear();
    this.micProcessor = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.store.set({
      channelId: null,
      status: 'idle',
      room: null,
      screenTrack: null,
      sharingAudio: false,
      unwatchedShares: new Set(),
      pingMs: null,
    });
    void this.syncPushToTalk(settings.get());
  }

  private async afterSelfChange(): Promise<void> {
    this.applyOutput();
    await this.syncMicrophone();
    if (this.state.room) this.reportState(this.state.muted, this.state.deafened);
  }

  /** Mic is on unless muted or deafened; applies the input gain processor. */
  private async syncMicrophone(): Promise<void> {
    const { room, muted, deafened } = this.state;
    if (!room) return;
    const s = settings.get();
    try {
      await room.localParticipant.setMicrophoneEnabled(!muted && !deafened, audioCaptureOptions(s));
    } catch (err) {
      showToast(`Microfone indisponível: ${errorMessage(err)}`);
      this.store.set({ muted: true });
      return;
    }
    await this.applyMicProcessing(s);
  }

  private micTrack(): LocalAudioTrack | undefined {
    const track = this.state.room?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    return track instanceof LocalAudioTrack ? track : undefined;
  }

  /** Watches the push-to-talk key only while in a room with push-to-talk on. */
  private async syncPushToTalk(s: Settings): Promise<void> {
    if (this.state.room && s.pushToTalk && s.pttKey) {
      await window.api.startPushToTalk(s.pttKey.vk);
      return;
    }
    await window.api.stopPushToTalk();
    this.pttDown = false;
    this.micProcessor?.setPushToTalkDown(false);
  }

  /** Input volume, voice gate and push-to-talk; the processor is only inserted when needed. */
  private async applyMicProcessing(s: Settings): Promise<void> {
    const track = this.micTrack();
    if (!track) return;
    const options: MicOptions = {
      gain: s.inputVolume / 100,
      gateDb: s.voiceGate && !s.pushToTalk ? s.voiceGateThreshold : null,
      // Without a key yet the mic stays closed, which is what "push to talk" promises.
      pushToTalk: s.pushToTalk,
      rnnoise: s.noiseSuppression === 'rnnoise',
    };
    if (this.micProcessor && track.getProcessor() === this.micProcessor) {
      this.micProcessor.setOptions(options);
      return;
    }
    if (options.gain === 1 && options.gateDb === null && !options.pushToTalk && !options.rnnoise)
      return;
    this.audioContext ??= new AudioContext({ sampleRate: NOISE_SAMPLE_RATE });
    track.setAudioContext(this.audioContext);
    this.micProcessor = new MicProcessor(options);
    this.micProcessor.setPushToTalkDown(this.pttDown);
    await track.setProcessor(this.micProcessor);
  }

  private isUnwatched(identity: string): boolean {
    return this.state.unwatchedShares.has(identity);
  }

  private forgetUnwatched(identity: string): void {
    this.store.set((s) => {
      const unwatchedShares = new Set(s.unwatchedShares);
      unwatchedShares.delete(identity);
      return { unwatchedShares };
    });
  }

  private gainFor(tag: { identity: string; screen: boolean }): number {
    const { deafened, mutedShares } = this.state;
    const s = settings.get();
    // Deafen silences voices only; a share's audio has its own mute button and volume.
    if (tag.screen) {
      return mutedShares.has(tag.identity) ? 0 : (s.shareVolumes[tag.identity] ?? 100) / 100;
    }
    if (deafened) return 0;
    return (s.userVolumes[tag.identity] ?? 100) / 100;
  }

  private applyOutput(): void {
    this.mixer.setMasterGain(settings.get().outputVolume / 100);
    for (const [id, tag] of this.audioSources) this.mixer.setGain(id, this.gainFor(tag));
  }

  private async applySettings(prev: Settings, next: Settings): Promise<void> {
    const { room } = this.state;
    if (!room) return;
    if (
      prev.outputVolume !== next.outputVolume ||
      prev.userVolumes !== next.userVolumes ||
      prev.shareVolumes !== next.shareVolumes
    ) {
      this.applyOutput();
    }
    if (
      prev.inputVolume !== next.inputVolume ||
      prev.voiceGate !== next.voiceGate ||
      prev.voiceGateThreshold !== next.voiceGateThreshold ||
      prev.pushToTalk !== next.pushToTalk ||
      prev.noiseSuppression !== next.noiseSuppression
    ) {
      await this.applyMicProcessing(next);
    }
    if (prev.pushToTalk !== next.pushToTalk || prev.pttKey !== next.pttKey) {
      await this.syncPushToTalk(next);
    }
    if (prev.outputDeviceId !== next.outputDeviceId) {
      await this.mixer.setSinkId(next.outputDeviceId);
    }
    const captureChanged =
      prev.inputDeviceId !== next.inputDeviceId ||
      prev.echoCancellation !== next.echoCancellation ||
      prev.noiseSuppression !== next.noiseSuppression ||
      prev.autoGainControl !== next.autoGainControl;
    if (captureChanged) await this.micTrack()?.restartTrack(audioCaptureOptions(next));
  }
}
