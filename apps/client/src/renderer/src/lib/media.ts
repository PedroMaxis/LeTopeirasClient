import {
  AudioPresets,
  Track,
  VideoPreset,
  type AudioCaptureOptions,
  type LocalVideoTrack,
  type RoomOptions,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
} from 'livekit-client';
import type { Settings } from './settings';

/** "Jogo" favors smooth motion; "Texto/Código" favors sharp detail. */
export type ShareMode = 'motion' | 'detail';

export const shareModeLabels: Record<ShareMode, string> = {
  motion: 'Jogo',
  detail: 'Texto / Código',
};

export type ShareQuality = '720p30' | '720p60' | '1080p60';

export const shareQualities: Record<
  ShareQuality,
  { label: string; width: number; height: number; fps: number; maxBitrate: number }
> = {
  '720p30': { label: '720p 30', width: 1280, height: 720, fps: 30, maxBitrate: 2_500_000 },
  '720p60': { label: '720p 60', width: 1280, height: 720, fps: 60, maxBitrate: 4_000_000 },
  '1080p60': { label: '1080p 60', width: 1920, height: 1080, fps: 60, maxBitrate: 6_000_000 },
};

export function audioCaptureOptions(s: Settings): AudioCaptureOptions {
  return {
    deviceId: s.inputDeviceId,
    echoCancellation: s.echoCancellation,
    // With RNNoise on, Chromium's filter would only stack a second pass on top.
    noiseSuppression: s.noiseSuppression === 'browser',
    autoGainControl: s.autoGainControl,
  };
}

export function roomOptions(s: Settings): RoomOptions {
  return {
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: audioCaptureOptions(s),
    audioOutput: { deviceId: s.outputDeviceId },
    publishDefaults: {
      dtx: true,
      red: true,
    },
  };
}

export function degradationFor(mode: ShareMode): RTCDegradationPreference {
  return mode === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
}

/** Switches the mode of a screen share that is already being published. */
export async function applyShareMode(track: LocalVideoTrack, mode: ShareMode): Promise<void> {
  track.mediaStreamTrack.contentHint = mode;
  await track.setDegradationPreference(degradationFor(mode));
}

export function screenCaptureOptions(
  mode: ShareMode,
  quality: ShareQuality,
): ScreenShareCaptureOptions {
  const q = shareQualities[quality];
  return {
    audio: false,
    resolution: { width: q.width, height: q.height, frameRate: q.fps },
    contentHint: mode,
  };
}

/** PC audio that goes with a screen share: stereo music quality, no voice-oriented tricks. */
export const screenAudioPublishOptions: TrackPublishOptions = {
  source: Track.Source.ScreenShareAudio,
  audioPreset: AudioPresets.musicHighQualityStereo,
  forceStereo: true,
  dtx: false,
  red: false,
};

/**
 * Chromium only offers H.265 for WebRTC when the GPU can encode it (there is no software
 * H.265 encoder), so its presence means a hardware encoder.
 */
function canEncodeH265(): boolean {
  return (
    RTCRtpSender.getCapabilities('video')?.codecs.some((c) => c.mimeType === 'video/H265') ?? false
  );
}

export function screenPublishOptions(mode: ShareMode, quality: ShareQuality): TrackPublishOptions {
  const q = shareQualities[quality];
  // H.264 always lands on the software encoder: LiveKit negotiates Constrained Baseline
  // (42e01f), which Chromium never encodes in hardware (TD-1). H.265 runs on the GPU;
  // viewers that can't decode it get LiveKit's VP8 backup codec. Hardware H.265 does a
  // single layer only, so no simulcast.
  const h265 = canEncodeH265();
  return {
    source: Track.Source.ScreenShare,
    videoCodec: h265 ? 'h265' : 'h264',
    // A 720p layer lets weak connections keep watching a 1080p share.
    simulcast: !h265 && quality === '1080p60',
    screenShareEncoding: { maxBitrate: q.maxBitrate, maxFramerate: q.fps },
    screenShareSimulcastLayers: [new VideoPreset(1280, 720, 2_500_000, 30)],
    degradationPreference: degradationFor(mode),
  };
}
