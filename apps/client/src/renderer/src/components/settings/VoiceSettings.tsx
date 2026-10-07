import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../lib/api';
import { levelFromDb, startMicMeter } from '../../lib/audio';
import { settings, updateSettings } from '../../lib/settings';
import { useStore } from '../../lib/store';
import { showToast } from '../../lib/toast';
import { FieldLabel, ToggleRow } from '../ui/controls';

const METER_SEGMENTS = 30;

function useDevices(kind: 'audioinput' | 'audiooutput'): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void navigator.mediaDevices.enumerateDevices().then((list) => {
        if (!cancelled) setDevices(list.filter((d) => d.kind === kind));
      });
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [kind]);
  return devices;
}

function DeviceSelect(props: {
  id: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  value: string;
  onChange(deviceId: string): void;
}) {
  const devices = useDevices(props.kind);
  const known = devices.some((d) => d.deviceId === props.value);
  return (
    <div className="field">
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <select
        id={props.id}
        className="select"
        value={known ? props.value : 'default'}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {devices.length === 0 && <option value="default">Padrão do Windows</option>}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.deviceId === 'default'
              ? `Padrão do Windows (${d.label.replace(/^(Default|Padrão) - /, '')})`
              : d.label || 'Dispositivo sem nome'}
          </option>
        ))}
      </select>
    </div>
  );
}

function Slider(props: {
  id: string;
  label: string;
  value: number;
  max: number;
  min?: number;
  unit?: string;
  onChange(value: number): void;
}) {
  const min = props.min ?? 0;
  const unit = props.unit ?? '%';
  return (
    <div className="field">
      <FieldLabel htmlFor={props.id}>
        {props.label}{' '}
        <span className="slider-value">
          {props.value}
          {unit}
        </span>
      </FieldLabel>
      <input
        id={props.id}
        type="range"
        className="slider"
        min={min}
        max={props.max}
        value={props.value}
        style={{ ['--fill' as string]: `${((props.value - min) / (props.max - min)) * 100}%` }}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

function MicTest() {
  const s = useStore(settings, (x) => x);
  const [level, setLevel] = useState<number | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const toggle = async () => {
    if (stop.current) {
      stop.current();
      stop.current = null;
      setLevel(null);
      return;
    }
    try {
      stop.current = await startMicMeter(
        {
          deviceId: s.inputDeviceId,
          gain: s.inputVolume / 100,
          constraints: {
            echoCancellation: s.echoCancellation,
            noiseSuppression: s.noiseSuppression,
            autoGainControl: s.autoGainControl,
          },
        },
        setLevel,
      );
      setLevel(0);
    } catch (err) {
      showToast(`Não foi possível abrir o microfone: ${errorMessage(err)}`);
    }
  };

  const lit = Math.round((level ?? 0) * METER_SEGMENTS);
  // With the voice gate on, only the part above the threshold is "transmitting".
  const gate = s.voiceGate ? levelFromDb(s.voiceGateThreshold) : null;
  const gateSegment = gate === null ? 0 : Math.round(gate * METER_SEGMENTS);
  return (
    <div className="field">
      <div className="field-label">TESTE DE MICROFONE</div>
      <div className="mic-test">
        <button type="button" className="button primary" onClick={() => void toggle()}>
          {level === null ? 'Vamos checar' : 'Parar teste'}
        </button>
        <div className="meter" aria-hidden="true">
          {Array.from({ length: METER_SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={i < lit ? (gate !== null && lit <= gateSegment ? 'on muted' : 'on') : ''}
            />
          ))}
          {gate !== null && <i className="meter-threshold" style={{ left: `${gate * 100}%` }} />}
        </div>
      </div>
    </div>
  );
}

export function VoiceSettings() {
  const s = useStore(settings, (x) => x);
  return (
    <>
      <h2 className="settings-title">Voz e áudio</h2>
      <div className="field-row">
        <DeviceSelect
          id="input-device"
          label="DISPOSITIVO DE ENTRADA"
          kind="audioinput"
          value={s.inputDeviceId}
          onChange={(inputDeviceId) => updateSettings({ inputDeviceId })}
        />
        <DeviceSelect
          id="output-device"
          label="DISPOSITIVO DE SAÍDA"
          kind="audiooutput"
          value={s.outputDeviceId}
          onChange={(outputDeviceId) => updateSettings({ outputDeviceId })}
        />
      </div>
      <div className="field-row">
        <Slider
          id="input-volume"
          label="VOLUME DE ENTRADA"
          value={s.inputVolume}
          max={200}
          onChange={(inputVolume) => updateSettings({ inputVolume })}
        />
        <Slider
          id="output-volume"
          label="VOLUME DE SAÍDA"
          value={s.outputVolume}
          max={100}
          onChange={(outputVolume) => updateSettings({ outputVolume })}
        />
      </div>
      <MicTest />
      <div className="settings-divider" />
      <div className="field">
        <div className="field-label">MODO DE ENTRADA</div>
        <div className="radio-list" role="radiogroup">
          <button
            type="button"
            role="radio"
            aria-checked={!s.voiceGate}
            className={`radio-row ${!s.voiceGate ? 'selected' : ''}`}
            onClick={() => updateSettings({ voiceGate: false })}
          >
            <span className="radio-dot" />
            <span>
              <span className="radio-title">Detecção de voz automática</span>
              <span className="radio-description">
                O microfone transmite sempre; o navegador cuida do resto.
              </span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={s.voiceGate}
            className={`radio-row ${s.voiceGate ? 'selected' : ''}`}
            onClick={() => updateSettings({ voiceGate: true })}
          >
            <span className="radio-dot" />
            <span>
              <span className="radio-title">Limiar manual</span>
              <span className="radio-description">
                Só transmite quando sua voz passa da marca no medidor.
              </span>
            </span>
          </button>
        </div>
        {s.voiceGate && (
          <Slider
            id="gate-threshold"
            label="LIMIAR"
            value={s.voiceGateThreshold}
            min={-60}
            max={0}
            unit=" dB"
            onChange={(voiceGateThreshold) => updateSettings({ voiceGateThreshold })}
          />
        )}
      </div>
      <div className="settings-divider" />
      <div className="toggle-list">
        <ToggleRow
          label="Cancelamento de eco"
          description="Evita que o som dos fones volte pelo microfone."
          checked={s.echoCancellation}
          onChange={(echoCancellation) => updateSettings({ echoCancellation })}
        />
        <ToggleRow
          label="Supressão de ruído"
          description="Tira teclado mecânico, ventilador e barulho de fundo."
          checked={s.noiseSuppression}
          onChange={(noiseSuppression) => updateSettings({ noiseSuppression })}
        />
        <ToggleRow
          label="Controle automático de ganho"
          description="Mantém sua voz num volume constante."
          checked={s.autoGainControl}
          onChange={(autoGainControl) => updateSettings({ autoGainControl })}
        />
      </div>
    </>
  );
}
