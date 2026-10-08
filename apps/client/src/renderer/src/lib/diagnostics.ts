import type { LocalVideoTrack } from 'livekit-client';
import { BitrateMeter, readOutboundVideo } from './stats';

// Events for the local session log (main/diagnostics.ts), read when something breaks.
// Never log tokens, message text or window titles.

const SHARE_SAMPLE_MS = 10_000;
/** Encoder stats are logged on every change, and at least this often while sharing. */
const SHARE_HEARTBEAT_MS = 60_000;

export function logEvent(event: string, data?: Record<string, unknown>): void {
  void window.api.logEvent(event, data).catch(() => undefined);
}

function errorText(value: unknown): string {
  return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
}

/** Uncaught errors and device changes (unplugging a headset, an app closing a virtual device). */
export function watchRendererEvents(): void {
  logEvent('renderer.start');
  window.addEventListener('error', (e) =>
    logEvent('renderer.error', { message: e.message, file: e.filename, line: e.lineno }),
  );
  window.addEventListener('unhandledrejection', (e) =>
    logEvent('renderer.rejection', { reason: errorText(e.reason) }),
  );
  navigator.mediaDevices.addEventListener('devicechange', () => logEvent('renderer.devices'));
}

/**
 * Samples the screen share encoder while `isActive()` holds. Its implementation name tells
 * hardware from software, so a fallback (or a dying GPU encoder) shows up in the log.
 */
export function watchShareStats(track: LocalVideoTrack, isActive: () => boolean): void {
  const meter = new BitrateMeter();
  let lastSignature = '';
  let lastLoggedAt = 0;
  const timer = setInterval(() => {
    if (!isActive()) {
      clearInterval(timer);
      return;
    }
    void track
      .getRTCStatsReport()
      .then((report) => {
        if (!report || !isActive()) return;
        const { layers } = readOutboundVideo(report, meter);
        const signature = layers.map((l) => `${l.rid}:${l.codec}:${l.encoder}`).join('|');
        const now = Date.now();
        if (signature === lastSignature && now - lastLoggedAt < SHARE_HEARTBEAT_MS) return;
        lastSignature = signature;
        lastLoggedAt = now;
        logEvent('share.stats', {
          layers: layers.map((l) => ({
            rid: l.rid,
            codec: l.codec,
            encoder: l.encoder,
            hardware: l.powerEfficient,
            size: `${l.width ?? '?'}x${l.height ?? '?'}`,
            fps: l.fps,
            kbps: l.bitrateKbps === undefined ? undefined : Math.round(l.bitrateKbps),
            limitation: l.qualityLimitation,
          })),
        });
      })
      .catch((err: unknown) => logEvent('share.stats-error', { error: errorText(err) }));
  }, SHARE_SAMPLE_MS);
}
