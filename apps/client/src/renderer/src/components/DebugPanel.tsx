import { useEffect, useRef, useState } from 'react';
import { Track, type Room } from 'livekit-client';
import {
  BitrateMeter,
  readInboundVideo,
  readOutboundVideo,
  type InboundVideoStats,
  type OutboundVideoStats,
} from '../lib/stats';

interface Snapshot {
  outbound: OutboundVideoStats | null;
  inbound: { name: string; stats: InboundVideoStats }[];
}

const POLL_MS = 1000;

const fmt = (value: number | undefined, digits = 0) =>
  value === undefined ? '–' : value.toFixed(digits);
const res = (w: number | undefined, h: number | undefined) =>
  w === undefined || h === undefined ? '–' : `${w}×${h}`;
const hw = (powerEfficient: boolean | undefined) =>
  powerEfficient === undefined ? '' : powerEfficient ? ' (hardware)' : ' (software)';

async function sample(room: Room, meter: BitrateMeter): Promise<Snapshot> {
  const localTrack = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
  const localReport = await localTrack?.getRTCStatsReport();
  const outbound = localReport ? readOutboundVideo(localReport, meter) : null;

  const inbound: Snapshot['inbound'] = [];
  for (const participant of room.remoteParticipants.values()) {
    const track = participant.getTrackPublication(Track.Source.ScreenShare)?.track;
    const report = await track?.getRTCStatsReport();
    const stats = report && readInboundVideo(report, meter);
    if (stats) inbound.push({ name: participant.name || participant.identity, stats });
  }
  return { outbound, inbound };
}

interface Props {
  room: Room | null;
  onClose(): void;
}

export function DebugPanel({ room, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const meter = useRef(new BitrateMeter());

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    const tick = () => {
      sample(room, meter.current)
        .then((s) => !cancelled && setSnapshot(s))
        .catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [room]);

  return (
    <div className="debug-panel">
      <header>
        <strong>Debug de mídia</strong>
        <span className="muted">Ctrl+Shift+D</span>
        <button type="button" className="ghost" onClick={onClose}>
          ✕
        </button>
      </header>

      {!room && <p className="muted">Não conectado.</p>}

      {room && (
        <>
          <h3>Enviando (sua tela)</h3>
          {!snapshot?.outbound?.layers.length ? (
            <p className="muted">Você não está transmitindo.</p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Camada</th>
                    <th>Resolução</th>
                    <th>FPS</th>
                    <th>kbps</th>
                    <th>Codec</th>
                    <th>Limitação</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.outbound.layers.map((layer) => (
                    <tr key={layer.rid}>
                      <td>{layer.rid}</td>
                      <td>{res(layer.width, layer.height)}</td>
                      <td>{fmt(layer.fps)}</td>
                      <td>{fmt(layer.bitrateKbps)}</td>
                      <td>{layer.codec ?? '–'}</td>
                      <td>{layer.qualityLimitation ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {snapshot.outbound.layers.map((layer) => (
                <p key={layer.rid} className="encoder">
                  Encoder [{layer.rid}]: {layer.encoder ?? '–'}
                  {hw(layer.powerEfficient)}
                </p>
              ))}
              <p className="muted">RTT: {fmt(snapshot.outbound.rttMs)} ms</p>
            </>
          )}

          <h3>Recebendo</h3>
          {!snapshot?.inbound.length ? (
            <p className="muted">Nenhuma tela remota.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>De</th>
                  <th>Resolução</th>
                  <th>FPS</th>
                  <th>kbps</th>
                  <th>Codec</th>
                  <th>Decoder</th>
                  <th>Perdidos</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.inbound.map(({ name, stats }) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{res(stats.width, stats.height)}</td>
                    <td>{fmt(stats.fps)}</td>
                    <td>{fmt(stats.bitrateKbps)}</td>
                    <td>{stats.codec ?? '–'}</td>
                    <td>
                      {stats.decoder ?? '–'}
                      {hw(stats.powerEfficient)}
                    </td>
                    <td>
                      {fmt(stats.packetsLost)} pkts / {fmt(stats.framesDropped)} frames
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
