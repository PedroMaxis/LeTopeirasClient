// Extracts the numbers shown in the debug panel from WebRTC stats reports.

type RawStat = Record<string, unknown> & { id: string; type: string; timestamp: number };

const num = (stat: RawStat | undefined, key: string): number | undefined => {
  const value = stat?.[key];
  return typeof value === 'number' ? value : undefined;
};
const str = (stat: RawStat | undefined, key: string): string | undefined => {
  const value = stat?.[key];
  return typeof value === 'string' ? value : undefined;
};
const bool = (stat: RawStat | undefined, key: string): boolean | undefined => {
  const value = stat?.[key];
  return typeof value === 'boolean' ? value : undefined;
};

export interface OutboundLayerStats {
  rid: string;
  width: number | undefined;
  height: number | undefined;
  fps: number | undefined;
  bitrateKbps: number | undefined;
  codec: string | undefined;
  encoder: string | undefined;
  powerEfficient: boolean | undefined;
  qualityLimitation: string | undefined;
}

export interface OutboundVideoStats {
  layers: OutboundLayerStats[];
  rttMs: number | undefined;
}

export interface InboundVideoStats {
  width: number | undefined;
  height: number | undefined;
  fps: number | undefined;
  bitrateKbps: number | undefined;
  codec: string | undefined;
  decoder: string | undefined;
  powerEfficient: boolean | undefined;
  framesDropped: number | undefined;
  packetsLost: number | undefined;
  jitterMs: number | undefined;
}

/** Turns cumulative byte counters into kbps between two consecutive samples. */
export class BitrateMeter {
  private readonly previous = new Map<string, { bytes: number; timestamp: number }>();

  kbps(id: string, bytes: number | undefined, timestamp: number): number | undefined {
    if (bytes === undefined) return undefined;
    const prev = this.previous.get(id);
    this.previous.set(id, { bytes, timestamp });
    if (!prev || timestamp <= prev.timestamp) return undefined;
    return ((bytes - prev.bytes) * 8) / (timestamp - prev.timestamp);
  }
}

function statsOf(report: RTCStatsReport): RawStat[] {
  return Array.from(report.values()) as RawStat[];
}

function codecName(report: RTCStatsReport, stat: RawStat): string | undefined {
  const codecId = str(stat, 'codecId');
  const codec = codecId ? (report.get(codecId) as RawStat | undefined) : undefined;
  return str(codec, 'mimeType')?.replace(/^video\//, '');
}

function roundTripMs(stats: RawStat[]): number | undefined {
  const pair = stats.find(
    (s) => s.type === 'candidate-pair' && (s['nominated'] === true || s['state'] === 'succeeded'),
  );
  const rtt = num(pair, 'currentRoundTripTime');
  return rtt === undefined ? undefined : rtt * 1000;
}

export function readOutboundVideo(report: RTCStatsReport, meter: BitrateMeter): OutboundVideoStats {
  const stats = statsOf(report);
  const layers = stats
    .filter((s) => s.type === 'outbound-rtp' && s['kind'] === 'video')
    .map((s): OutboundLayerStats => ({
      rid: str(s, 'rid') ?? '-',
      width: num(s, 'frameWidth'),
      height: num(s, 'frameHeight'),
      fps: num(s, 'framesPerSecond'),
      bitrateKbps: meter.kbps(s.id, num(s, 'bytesSent'), s.timestamp),
      codec: codecName(report, s),
      encoder: str(s, 'encoderImplementation'),
      powerEfficient: bool(s, 'powerEfficientEncoder'),
      qualityLimitation: str(s, 'qualityLimitationReason'),
    }))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return { layers, rttMs: roundTripMs(stats) };
}

export function readInboundVideo(
  report: RTCStatsReport,
  meter: BitrateMeter,
): InboundVideoStats | undefined {
  const s = statsOf(report).find((stat) => stat.type === 'inbound-rtp' && stat['kind'] === 'video');
  if (!s) return undefined;
  const jitter = num(s, 'jitter');
  return {
    width: num(s, 'frameWidth'),
    height: num(s, 'frameHeight'),
    fps: num(s, 'framesPerSecond'),
    bitrateKbps: meter.kbps(s.id, num(s, 'bytesReceived'), s.timestamp),
    codec: codecName(report, s),
    decoder: str(s, 'decoderImplementation'),
    powerEfficient: bool(s, 'powerEfficientDecoder'),
    framesDropped: num(s, 'framesDropped'),
    packetsLost: num(s, 'packetsLost'),
    jitterMs: jitter === undefined ? undefined : jitter * 1000,
  };
}
